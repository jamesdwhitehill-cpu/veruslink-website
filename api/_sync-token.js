// VerusLink Sync — shared owner-token helpers (server-side only).
//
// Issues and verifies a stateless, signed owner session token. The token proves
// the bearer controls the owner email on file for a given code, WITHOUT ever
// exposing that email to the browser. Signing uses HMAC-SHA256 over a server
// secret (env SYNC_TOKEN_SECRET), so tokens cannot be forged client-side.
//
// Token format (URL-safe base64): base64url(JSON payload) + '.' + base64url(hmac)
// Payload: { code_id, owner_id, exp }  (exp = unix seconds)
//
// This module is NOT a serverless route (leading underscore) — it is imported by
// api/sync-owner.js and api/sync-save.js.

import crypto from 'node:crypto';

const ISSUE_TTL_SECONDS = 60 * 60 * 24 * 7;      // session token lives 7 days
const MAGIC_TTL_SECONDS = 60 * 30;               // magic-link token lives 30 min

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function secret() {
  const s = process.env.SYNC_TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error('SYNC_TOKEN_SECRET not configured');
  return s;
}

function sign(payloadB64) {
  return b64urlEncode(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

// kind: 'session' (cookie) or 'magic' (emailed link)
export function makeToken({ code_id, owner_id, kind = 'session' }) {
  const ttl = kind === 'magic' ? MAGIC_TTL_SECONDS : ISSUE_TTL_SECONDS;
  const payload = { code_id, owner_id, kind, exp: Math.floor(Date.now() / 1000) + ttl };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Returns the payload object if valid, otherwise null. Verifies signature
// (constant-time) and expiry. Optionally enforces a required `kind`.
export function verifyToken(token, requiredKind) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  let expected;
  try { expected = sign(payloadB64); } catch { return null; }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')); } catch { return null; }
  if (!payload || !payload.code_id || !payload.owner_id || !payload.exp) return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  if (requiredKind && payload.kind !== requiredKind) return null;
  return payload;
}

// Reads the sync owner session cookie from a request, returns verified payload or null.
export function sessionFromRequest(req) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  const cookies = Object.fromEntries(
    raw.split(';').map((c) => {
      const i = c.indexOf('=');
      return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    })
  );
  return verifyToken(cookies['vl_sync_owner'], 'session');
}

export function sessionCookie(token) {
  // httpOnly so JS cannot read it; SameSite=Lax; 7-day Max-Age to match token TTL.
  return `vl_sync_owner=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ISSUE_TTL_SECONDS}`;
}

export function clearCookie() {
  return 'vl_sync_owner=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

// Shared Supabase REST helpers (service key — bypasses RLS).
export function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
export function sbUrl(path) {
  return `${process.env.SUPABASE_URL}/rest/v1/${path}`;
}
export async function sbGet(path) {
  const r = await fetch(sbUrl(path), { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}
