// VerusLink Sync — email + password authentication (single entry point).
//
// Replaces the old client-side passphrase gate and the magic-link-only sign-in.
// Issues the SAME signed, httpOnly session cookie (vl_sync_owner) the rest of the
// Sync app already uses, so the dashboard / manage / save flows recognise the
// session with no further changes. The session is owner-scoped (no code_id) — the
// dashboard "switch" action re-scopes it to a specific code when needed.
//
// POST /api/sync-auth   { email, password, name? }
//   - Owner exists WITH a password_hash  -> verify password; 200 + session, or 401.
//   - Owner exists WITHOUT a password_hash (seeded/legacy) -> set it, 200 + session.
//   - Owner does not exist               -> create owner (name required); 200 + session.
//   Returns { ok:true, owner_id, name }.
//
// GET  /api/sync-auth  -> { authenticated, owner_id?, name? } from the session cookie.
//
// Passwords are hashed with scrypt + a per-user random salt, stored as
// `scrypt$<saltHex>$<hashHex>` (see migration 004_add_password_auth.sql). This runs
// in the Node serverless runtime (like every other api/ handler here), so we use
// node:crypto rather than a SHA-256 digest — same simplicity, far stronger at rest.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SYNC_TOKEN_SECRET.

import crypto from 'node:crypto';
import { makeToken, sessionFromRequest, sessionCookie, sbGet, sbSend } from './_sync-token.js';

const SCRYPT_KEYLEN = 64;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
      const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(sess.owner_id)}&select=name`);
      if (!owners.length) return res.status(200).json({ authenticated: false });
      return res.status(200).json({ authenticated: true, owner_id: sess.owner_id, name: owners[0].name });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ---- POST: sign in / sign up ----
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
  const password = (req.body && req.body.password || '').toString();
  const name = (req.body && req.body.name || '').toString().trim();

  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password.length > 200) return res.status(400).json({ error: 'Password is too long' });
  if (name.length > 120) return res.status(400).json({ error: 'Name is too long' });

  try {
    const existing = await sbGet(
      `vl_owners?email=eq.${encodeURIComponent(email)}&select=id,name,password_hash`
    );

    // --- Existing owner ---
    if (existing.length) {
      const owner = existing[0];
      if (owner.password_hash) {
        // Established password — must match.
        if (!verifyPassword(password, owner.password_hash)) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
      } else {
        // Seeded / legacy account with no password yet — this first sign-in sets it.
        await sbSend('PATCH', `vl_owners?id=eq.${encodeURIComponent(owner.id)}`,
          { password_hash: hashPassword(password) }, { Prefer: 'return=minimal' });
      }
      const session = makeToken({ owner_id: owner.id, kind: 'session' });
      res.setHeader('Set-Cookie', sessionCookie(session));
      return res.status(200).json({ ok: true, owner_id: owner.id, name: owner.name });
    }

    // --- New owner (sign up) ---
    if (!name) return res.status(400).json({ error: 'Name is required to create an account' });
    const created = await sbSend('POST', 'vl_owners',
      { name, email, password_hash: hashPassword(password) }, { Prefer: 'return=representation' });
    const owner = (await created.json())[0];
    const session = makeToken({ owner_id: owner.id, kind: 'session' });
    res.setHeader('Set-Cookie', sessionCookie(session));
    return res.status(200).json({ ok: true, owner_id: owner.id, name: owner.name });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
