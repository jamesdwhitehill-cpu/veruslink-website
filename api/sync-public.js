// VerusLink Sync — public code status lookup (service key, read-only).
//
// The public read RLS policy on vl_codes is `USING (is_active = true)`, so the
// anon key cannot see a paused code at all — a paused page and a non-existent
// code are indistinguishable to the browser. This endpoint lets view.html tell
// them apart so it can show a proper "paused" message instead of a generic error.
//
// GET /api/sync-public?code=SYNC-XXXX
//   -> { exists:false }                       (no such code)
//   -> { exists:true, is_active:bool, label } (found)
//
// Only non-sensitive presentation fields are returned. Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

import { sbGet } from './_sync-token.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  const code = (req.query.code || '').toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const rows = await sbGet(`vl_codes?code=eq.${encodeURIComponent(code)}&select=is_active,label`);
    if (!rows.length) return res.status(200).json({ exists: false });
    return res.status(200).json({ exists: true, is_active: rows[0].is_active, label: rows[0].label });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
