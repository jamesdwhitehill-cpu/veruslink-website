// VerusLink Sync - email + password authentication (single entry point).
//
// Issues the SAME signed, httpOnly session cookie (vl_sync_owner) the rest of the
// Sync app already uses, so the dashboard / manage / save flows recognise the
// session with no further changes. The session is owner-scoped (no code_id); the
// dashboard "switch" action re-scopes it to a specific code when needed.
//
// POST /api/sync-auth   { email, password, name? }
//   - Owner exists WITH a password_hash -> verify password; 200 + session, or 401.
//   - Owner exists WITHOUT a password_hash (seeded/legacy) -> NO session. A one-time
//     link to set a password is emailed to the address on file, and the response is
//     the same generic 401 an unknown email or a wrong password gets.
//   - Owner does not exist, name given  -> create owner (sign up); 200 + session.
//   - Owner does not exist, no name     -> the same generic 401.
//   Returns { ok:true, owner_id, name } on success.
//
// POST /api/sync-auth   { action:'set-password', password }
//   - Requires a session cookie (minted by the emailed link) for an owner with no
//     password yet. Sets it. 409 if a password is already set.
//
// GET  /api/sync-auth  -> { authenticated, owner_id?, name?, needs_password? }
//
// Rate limits (api/_rate-limit.js): sign-in per IP and per email, account
// creation per IP, set-password emails per address.
//
// Passwords are hashed with scrypt + a per-user random salt, stored as
// `scrypt$<saltHex>$<hashHex>` (see migration 004_add_password_auth.sql).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SYNC_TOKEN_SECRET, RESEND_API_KEY.

import crypto from 'node:crypto';
import { makeToken, sessionFromRequest, sessionCookie, sbGet, sbSend, serverError } from './_sync-token.js';
import { rateLimit, clientIp, tooMany } from './_rate-limit.js';

const SITE = 'https://veruslink.au';
const FROM = 'VerusLink Sync <vero@veruslink.au>';
const SCRYPT_KEYLEN = 64;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// One message for every failed sign-in, so the response never reveals whether an
// email is registered or whether it has a password yet.
const SIGNIN_FAILED = 'Email or password not recognised. If you have not set a password yet, check your inbox for a link to set one.';
// Keeps timing similar when there is no stored hash to check against.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let derived;
  try {
    derived = crypto.scryptSync(password, Buffer.from(parts[1], 'hex'), SCRYPT_KEYLEN);
  } catch { return false; }
  const expected = Buffer.from(parts[2], 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Email the owner on file a 30-minute signed link that signs them in and asks them
// to choose a password (consumed by GET /api/sync-owner?token=...). Never throws.
async function sendSetPasswordLink(ownerId, email) {
  if (!process.env.RESEND_API_KEY) return;
  const magic = makeToken({ owner_id: ownerId, kind: 'magic', dest: 'set-password' });
  const link = `${SITE}/api/sync-owner?token=${encodeURIComponent(magic)}`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0D0D18;font-family:Inter,Arial,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:#fff;margin-bottom:24px">VERUSLINK</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px">
      <h1 style="font-size:21px;margin:0 0 12px">Set your VerusLink Sync password</h1>
      <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px">
        Someone tried to sign in to your account, which has no password yet. Click below to choose one. This link expires in 30 minutes.
      </p>
      <a href="${esc(link)}" style="display:inline-block;background:#2D9CDB;color:#04121c;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:11px;font-size:15px">Set my password</a>
    </div>
    <p style="color:rgba(255,255,255,0.34);font-size:12px;line-height:1.6;margin-top:22px">
      If this was not you, ignore this email. Your account stays as it is.
    </p>
  </div></body></html>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: email, subject: 'Set your VerusLink Sync password', html }),
    });
    if (!r.ok) console.error(`[sync-auth] set-password email failed: ${r.status}`);
  } catch (e) {
    console.error('[sync-auth] set-password email failed:', e.message);
  }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (!process.env.SYNC_TOKEN_SECRET) {
    return res.status(500).json({ error: 'SYNC_TOKEN_SECRET not configured' });
  }

  // ---- GET: session check ----
  if (req.method === 'GET') {
    const sess = sessionFromRequest(req);
    if (!sess) return res.status(200).json({ authenticated: false });
    try {
      const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(sess.owner_id)}&select=name,password_hash`);
      if (!owners.length) return res.status(200).json({ authenticated: false });
      return res.status(200).json({
        authenticated: true, owner_id: sess.owner_id, name: owners[0].name,
        needs_password: !owners[0].password_hash,
      });
    } catch (e) {
      return serverError(res, e, 'sync-auth');
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const ip = clientIp(req);
  const action = (req.body && req.body.action || '').toString();
  const password = (req.body && req.body.password || '').toString();

  // ---- POST set-password: only for a signed-in owner with no password yet ----
  if (action === 'set-password') {
    const sess = sessionFromRequest(req);
    if (!sess) return res.status(401).json({ error: 'not authenticated' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (password.length > 200) return res.status(400).json({ error: 'Password is too long' });
    try {
      // Filtered on password_hash IS NULL so an existing password is never overwritten.
      const r = await sbSend('PATCH',
        `vl_owners?id=eq.${encodeURIComponent(sess.owner_id)}&password_hash=is.null`,
        { password_hash: hashPassword(password) }, { Prefer: 'return=representation' });
      const rows = await r.json();
      if (!rows.length) return res.status(409).json({ error: 'A password is already set for this account. Sign in instead.' });
      return res.status(200).json({ ok: true, owner_id: rows[0].id, name: rows[0].name });
    } catch (e) {
      return serverError(res, e, 'sync-auth');
    }
  }

  // ---- POST: sign in / sign up ----
  const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
  const name = (req.body && req.body.name || '').toString().trim();

  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password.length > 200) return res.status(400).json({ error: 'Password is too long' });
  if (name.length > 120) return res.status(400).json({ error: 'Name is too long' });

  try {
    if (!(await rateLimit('auth-ip', ip, { limit: 30, windowSec: 900 }))) return tooMany(res);
    if (!(await rateLimit('auth-email', email, { limit: 10, windowSec: 900 }))) return tooMany(res);

    const existing = await sbGet(
      `vl_owners?email=eq.${encodeURIComponent(email)}&select=id,name,password_hash`
    );

    // --- Existing owner ---
    if (existing.length) {
      const owner = existing[0];
      if (!owner.password_hash) {
        // Seeded / legacy account with no password. Never set one from an
        // unauthenticated request: email the owner a link to set it instead.
        verifyPassword(password, DUMMY_HASH);
        if (await rateLimit('setpw-email', email, { limit: 3, windowSec: 3600 })) {
          await sendSetPasswordLink(owner.id, email);
        }
        return res.status(401).json({ error: SIGNIN_FAILED });
      }
      if (!verifyPassword(password, owner.password_hash)) {
        return res.status(401).json({ error: SIGNIN_FAILED });
      }
      const session = makeToken({ owner_id: owner.id, kind: 'session' });
      res.setHeader('Set-Cookie', sessionCookie(session));
      return res.status(200).json({ ok: true, owner_id: owner.id, name: owner.name });
    }

    // --- Unknown email on the sign-in form (no name): same answer as a wrong password ---
    if (!name) {
      verifyPassword(password, DUMMY_HASH);
      return res.status(401).json({ error: SIGNIN_FAILED });
    }

    // --- New owner (sign up) ---
    if (!(await rateLimit('signup-ip', ip, { limit: 5, windowSec: 3600 }))) return tooMany(res);
    const created = await sbSend('POST', 'vl_owners',
      { name, email, password_hash: hashPassword(password) }, { Prefer: 'return=representation' });
    const owner = (await created.json())[0];
    const session = makeToken({ owner_id: owner.id, kind: 'session' });
    res.setHeader('Set-Cookie', sessionCookie(session));
    return res.status(200).json({ ok: true, owner_id: owner.id, name: owner.name });
  } catch (e) {
    return serverError(res, e, 'sync-auth');
  }
}
