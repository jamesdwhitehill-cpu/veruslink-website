// VerusLink Sync - public code lookup and subscribe (service key).
//
// view.html used to read vl_codes and insert into vl_subscribers straight from
// the browser with the anon Supabase key. It now goes through this endpoint so
// the anon RLS policies can be dropped (migration 007).
//
// GET /api/sync-public?code=SYNC-XXXX
//   -> { exists:false }                                   (no such code)
//   -> { exists:true, is_active:false, label }            (paused)
//   -> { exists:true, is_active:true, label, id, timezone, slot_duration_minutes,
//        business_hours_start, business_hours_end, days_ahead }   (live)
//
// POST /api/sync-public { code, email, name? }  -> { ok:true }
//   Subscribes to updates on a live code. Re-subscribing is a silent no-op.
//   Rate limited per IP.
//
// Only non-sensitive presentation fields are returned. Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

import { sbGet, sbSend, serverError } from './_sync-token.js';
import { rateLimit, clientIp, tooMany } from './_rate-limit.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LIVE_FIELDS = 'id,label,is_active,timezone,slot_duration_minutes,business_hours_start,business_hours_end,days_ahead';

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }

  if (req.method === 'GET') {
    const code = (req.query.code || '').toString().trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'code required' });
    try {
      const rows = await sbGet(`vl_codes?code=eq.${encodeURIComponent(code)}&select=${LIVE_FIELDS}`);
      if (!rows.length) return res.status(200).json({ exists: false });
      const c = rows[0];
      if (!c.is_active) return res.status(200).json({ exists: true, is_active: false, label: c.label });
      return res.status(200).json({ exists: true, ...c });
    } catch (e) {
      return serverError(res, e, 'sync-public');
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const code = (req.body && req.body.code || '').toString().trim().toUpperCase();
  const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
  const name = (req.body && req.body.name || '').toString().trim() || null;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (name && name.length > 120) return res.status(400).json({ error: 'Name is too long' });

  try {
    if (!(await rateLimit('subscribe-ip', clientIp(req), { limit: 20, windowSec: 3600 }))) return tooMany(res);
    const rows = await sbGet(`vl_codes?code=eq.${encodeURIComponent(code)}&is_active=is.true&select=id`);
    if (!rows.length) return res.status(404).json({ error: 'That code does not exist or is no longer active.' });
    await sbSend('POST', 'vl_subscribers?on_conflict=code_id,email',
      { code_id: rows[0].id, email, name },
      { Prefer: 'return=minimal,resolution=ignore-duplicates' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return serverError(res, e, 'sync-public');
  }
}
