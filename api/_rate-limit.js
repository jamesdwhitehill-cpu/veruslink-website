// Shared rate limiter for public endpoints (server-side only; not a route).
//
// Storage: the vl_rate_events table in the Sync Supabase project (see
// supabase/migrations/007_rate_limits_and_close_public_policies.sql). One row is
// written per counted request; a request is refused once its bucket already holds
// `limit` rows inside the window. Buckets are hashed, so no raw IP address or
// email is stored.
//
// Fallback: if the table is missing (migration not yet run) or Supabase errors,
// the limiter counts in this function instance's memory instead. That is weaker
// on serverless (each warm instance counts separately) but never blocks real
// users because of a storage fault.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (optional; memory fallback without them).

import crypto from 'node:crypto';

const TABLE = 'vl_rate_events';
const memory = new Map(); // bucket -> array of ms timestamps
let useMemoryOnly = false;

export function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = (h['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return (h['x-real-ip'] || fwd || (req.socket && req.socket.remoteAddress) || 'unknown').toString();
}

function bucketOf(scope, id) {
  const digest = crypto.createHash('sha256').update(String(id).toLowerCase()).digest('hex').slice(0, 32);
  return `${scope}:${digest}`;
}

function memoryHit(bucket, limit, windowSec) {
  const now = Date.now();
  const since = now - windowSec * 1000;
  const hits = (memory.get(bucket) || []).filter((t) => t > since);
  if (hits.length >= limit) { memory.set(bucket, hits); return false; }
  hits.push(now);
  memory.set(bucket, hits);
  if (memory.size > 5000) memory.clear(); // keep a long-lived instance bounded
  return true;
}

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function storeHit(bucket, limit, windowSec) {
  const base = `${process.env.SUPABASE_URL}/rest/v1/${TABLE}`;
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const countRes = await fetch(
    `${base}?bucket=eq.${encodeURIComponent(bucket)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
    { method: 'HEAD', headers: { ...sbHeaders(), Prefer: 'count=exact' } }
  );
  if (!countRes.ok) {
    const err = new Error(`rate table count ${countRes.status}`);
    err.status = countRes.status;
    throw err;
  }
  const total = Number(((countRes.headers.get('content-range') || '').split('/')[1]) || 0);
  if (total >= limit) return false;
  const ins = await fetch(base, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ bucket }),
  });
  if (!ins.ok) {
    const err = new Error(`rate table insert ${ins.status}`);
    err.status = ins.status;
    throw err;
  }
  // Occasional housekeeping: expired events are useless once outside every window.
  if (Math.random() < 0.02) {
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    fetch(`${base}?created_at=lt.${encodeURIComponent(old)}`, {
      method: 'DELETE', headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    }).catch(() => {});
  }
  return true;
}

// Returns true if the request is allowed (and counts it), false if over the limit.
export async function rateLimit(scope, id, { limit, windowSec }) {
  const bucket = bucketOf(scope, id);
  if (useMemoryOnly || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return memoryHit(bucket, limit, windowSec);
  }
  try {
    return await storeHit(bucket, limit, windowSec);
  } catch (e) {
    // 404 = table not created yet: stop trying the store for this instance.
    if (e.status === 404) useMemoryOnly = true;
    console.error(`[rate-limit] store unavailable (${e.message}); using in-memory count`);
    return memoryHit(bucket, limit, windowSec);
  }
}

export function tooMany(res) {
  res.setHeader('Retry-After', '900');
  return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
}
