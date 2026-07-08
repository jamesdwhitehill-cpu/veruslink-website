// VerusLink Sync — owner write endpoint (service key, session-gated).
//
// Replaces the browser's direct anon-key writes to vl_codes / vl_available_blocks
// / vl_change_log. The owner is re-derived from the verified httpOnly session
// cookie — the client cannot specify which code it is editing; the code_id is
// taken from the token, not the request body.
//
// POST /api/sync-save
//   { action:'settings', slot_duration_minutes?, business_hours_start?, business_hours_end?, days_ahead? }
//     -> updates the owner's vl_codes settings row.
//   { action:'save-blocks', blocks:[{block_date,start_time,end_time,provider}] }
//     -> replaces the owner's date-specific vl_available_blocks + writes a change_log row.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SYNC_TOKEN_SECRET.

import { sessionFromRequest, sbHeaders, sbUrl, sbGet, ensureOwnerParticipant } from './_sync-token.js';

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
      if (b.days_ahead != null) {
        const v = Number(b.days_ahead);
        if (![7, 14, 30, 60, 90].includes(v)) return res.status(400).json({ error: 'invalid days_ahead' });
        patch.days_ahead = v;
      }
      await sbSend('PATCH', `vl_codes?id=eq.${encodeURIComponent(codeId)}`, patch);
      return res.status(200).json({ ok: true });
    }

    if (action === 'save-blocks') {
      const raw = Array.isArray(req.body && req.body.blocks) ? req.body.blocks : null;
      if (!raw) return res.status(400).json({ error: 'blocks array required' });
      if (raw.length > 5000) return res.status(400).json({ error: 'too many blocks' });

      // Resolve the owner's participant row so the owner's blocks carry a
      // participant_id (uniform overlap engine). Best-effort: if the
      // vl_participants table isn't migrated yet, fall back to legacy NULL blocks.
      let ownerPid = null;
      try {
        const op = await ensureOwnerParticipant(codeId, sess.owner_id);
        ownerPid = op ? op.id : null;
      } catch (_) { ownerPid = null; /* pre-migration tolerance */ }

      // Validate + normalise every block; force code_id to the session's code.
      // New model: each block is a concrete date (block_date) + time range.
      const blocks = [];
      for (const b of raw) {
        if (!isDate(b.block_date)) return res.status(400).json({ error: 'invalid block_date' });
        if (!isTime(b.start_time) || !isTime(b.end_time)) return res.status(400).json({ error: 'invalid time' });
        const provider = b.provider === 'unavailable' ? 'unavailable' : 'manual';
        const block = {
          code_id: codeId,
          block_date: b.block_date,
          start_time: b.start_time,
          end_time: b.end_time,
          provider,
        };
        if (ownerPid) block.participant_id = ownerPid;
        blocks.push(block);
      }

      // Replace only the OWNER's blocks. Participants' blocks share this code_id,
      // so a blanket delete-by-code would wipe everyone's availability. Scope the
      // delete to the owner's participant_id (plus legacy NULL owner rows).
      if (ownerPid) {
        await sbSend(
          'DELETE',
          `vl_available_blocks?code_id=eq.${encodeURIComponent(codeId)}&or=(participant_id.is.null,participant_id.eq.${encodeURIComponent(ownerPid)})`
        );
      } else {
        // Pre-migration: no participant_id column yet, old single-party semantics.
        await sbSend('DELETE', `vl_available_blocks?code_id=eq.${encodeURIComponent(codeId)}`);
      }
      if (blocks.length) {
        await sbSend('POST', 'vl_available_blocks', blocks);
      }
      await sbSend('POST', 'vl_change_log', {
        code_id: codeId,
        change_summary: `Availability updated, ${blocks.length} block(s)`,
      });
      await sbSend('PATCH', `vl_codes?id=eq.${encodeURIComponent(codeId)}`, { updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, blocks: blocks.length });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
