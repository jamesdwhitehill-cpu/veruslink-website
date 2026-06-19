// VerusLink Sync — owner write endpoint (service key, session-gated).
//
// Replaces the browser's direct anon-key writes to vl_codes / vl_available_blocks
// / vl_change_log. The owner is re-derived from the verified httpOnly session
// cookie — the client cannot specify which code it is editing; the code_id is
// taken from the token, not the request body.
//
// POST /api/sync-save
//   { action:'settings', slot_duration_minutes?, business_hours_start?, business_hours_end? }
//     -> updates the owner's vl_codes settings row.
//   { action:'save-blocks', blocks:[{day_of_week,start_time,end_time,provider,valid_from,valid_until}] }
//     -> replaces all vl_available_blocks for the code + writes a change_log row.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SYNC_TOKEN_SECRET.

import { sessionFromRequest, sbHeaders, sbUrl, sbGet } from './_sync-token.js';

function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s); }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function sbSend(method, path, body) {
  const r = await fetch(sbUrl(path), {
    method,
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase ${method} ${r.status}: ${await r.text()}`);
  return r;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (!process.env.SYNC_TOKEN_SECRET) {
    return res.status(500).json({ error: 'SYNC_TOKEN_SECRET not configured' });
  }

  const sess = sessionFromRequest(req);
  if (!sess) return res.status(401).json({ error: 'not authenticated' });
  const codeId = sess.code_id; // authoritative — from the signed token, not the body

  const action = (req.body && req.body.action || '').toString();

  try {
    // Confirm the code still exists and belongs to the session owner.
    const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=id,owner_id`);
    if (!codes.length) return res.status(404).json({ error: 'code not found' });
    if (codes[0].owner_id !== sess.owner_id) return res.status(403).json({ error: 'owner mismatch' });

    if (action === 'settings') {
      const patch = { updated_at: new Date().toISOString() };
      const b = req.body || {};
      if (b.slot_duration_minutes != null) {
        const v = Number(b.slot_duration_minutes);
        if (![15, 30, 60].includes(v)) return res.status(400).json({ error: 'invalid slot_duration_minutes' });
        patch.slot_duration_minutes = v;
      }
      if (b.business_hours_start != null) {
        if (!isTime(b.business_hours_start)) return res.status(400).json({ error: 'invalid business_hours_start' });
        patch.business_hours_start = b.business_hours_start;
      }
      if (b.business_hours_end != null) {
        if (!isTime(b.business_hours_end)) return res.status(400).json({ error: 'invalid business_hours_end' });
        patch.business_hours_end = b.business_hours_end;
      }
      await sbSend('PATCH', `vl_codes?id=eq.${encodeURIComponent(codeId)}`, patch);
      return res.status(200).json({ ok: true });
    }

    if (action === 'save-blocks') {
      const raw = Array.isArray(req.body && req.body.blocks) ? req.body.blocks : null;
      if (!raw) return res.status(400).json({ error: 'blocks array required' });
      if (raw.length > 5000) return res.status(400).json({ error: 'too many blocks' });

      // Validate + normalise every block; force code_id to the session's code.
      const blocks = [];
      for (const b of raw) {
        if (!Number.isInteger(b.day_of_week) || b.day_of_week < 0 || b.day_of_week > 6) {
          return res.status(400).json({ error: 'invalid day_of_week' });
        }
        if (!isTime(b.start_time) || !isTime(b.end_time)) return res.status(400).json({ error: 'invalid time' });
        const provider = b.provider === 'unavailable' ? 'unavailable' : 'manual';
        const valid_from = b.valid_from == null ? null : (isDate(b.valid_from) ? b.valid_from : null);
        const valid_until = b.valid_until == null ? null : (isDate(b.valid_until) ? b.valid_until : null);
        if (b.valid_from != null && valid_from == null) return res.status(400).json({ error: 'invalid valid_from' });
        if (b.valid_until != null && valid_until == null) return res.status(400).json({ error: 'invalid valid_until' });
        blocks.push({
          code_id: codeId,
          day_of_week: b.day_of_week,
          start_time: b.start_time,
          end_time: b.end_time,
          provider,
          valid_from,
          valid_until,
        });
      }

      // Replace: delete all existing blocks for this code, then insert the new set.
      await sbSend('DELETE', `vl_available_blocks?code_id=eq.${encodeURIComponent(codeId)}`);
      if (blocks.length) {
        await sbSend('POST', 'vl_available_blocks', blocks);
      }
      await sbSend('POST', 'vl_change_log', {
        code_id: codeId,
        change_summary: `Availability updated — ${blocks.length} block(s)`,
      });
      await sbSend('PATCH', `vl_codes?id=eq.${encodeURIComponent(codeId)}`, { updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, blocks: blocks.length });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
