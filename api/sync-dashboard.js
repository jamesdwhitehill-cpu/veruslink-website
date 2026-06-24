// VerusLink Sync — owner dashboard data endpoint (service key, session-gated).
//
// All operations are scoped to the owner derived from the verified httpOnly
// session cookie (owner_id is taken from the signed token, never from the body),
// so one owner can never read or mutate another owner's codes.
//
// GET  /api/sync-dashboard
//   -> { owner:{name}, codes:[{id,code,label,is_active,updated_at,subscriber_count}] }
//
// POST /api/sync-dashboard
//   { action:'create', label, slot_duration_minutes?, business_hours_start?, business_hours_end? }
//     -> creates a new code under the session owner. Returns { code:{...,subscriber_count:0} }.
//   { action:'set-active', code_id, is_active }
//     -> pause/resume a code the session owner owns. Returns { ok:true, is_active }.
//   { action:'archive', code_id }
//     -> archive a code the session owner owns: sets archived_at + is_active=false.
//        Data (subscribers, blocks) is retained; the code drops off the dashboard
//        and stops rendering publicly. Reversible. Returns { ok:true }.
//   { action:'signout' }
//     -> clears the session cookie. Returns { ok:true }.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SYNC_TOKEN_SECRET.

import { sessionFromRequest, sbGet, sbSend, createCodeForOwner, clearCookie, makeToken, sessionCookie } from './_sync-token.js';

function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s); }

// Attach an active-subscriber count to each code (one count query per code).
async function withCounts(codes) {
  return Promise.all(codes.map(async (c) => {
    let subscriber_count = 0;
    try {
      const subs = await sbGet(`vl_subscribers?code_id=eq.${encodeURIComponent(c.id)}&unsubscribed_at=is.null&select=id`);
      subscriber_count = subs.length;
    } catch (_) { /* leave at 0 on count failure */ }
    return { ...c, subscriber_count };
  }));
}

const CODE_SELECT = 'id,code,label,is_active,updated_at,slot_duration_minutes,business_hours_start,business_hours_end';

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (!process.env.SYNC_TOKEN_SECRET) {
    return res.status(500).json({ error: 'SYNC_TOKEN_SECRET not configured' });
  }

  // Signout is the only action that is meaningful without a usable session.
  if (req.method === 'POST' && (req.body && req.body.action) === 'signout') {
    res.setHeader('Set-Cookie', clearCookie());
    return res.status(200).json({ ok: true });
  }

  const sess = sessionFromRequest(req);
  if (!sess) return res.status(401).json({ error: 'not authenticated' });
  const ownerId = sess.owner_id; // authoritative — from the signed token, not the body

  try {
    if (req.method === 'GET') {
      const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(ownerId)}&select=name`);
      if (!owners.length) return res.status(404).json({ error: 'owner not found' });
      const codes = await sbGet(
        `vl_codes?owner_id=eq.${encodeURIComponent(ownerId)}&archived_at=is.null&order=created_at.asc&select=${CODE_SELECT}`
      );
      return res.status(200).json({ owner: { name: owners[0].name }, codes: await withCounts(codes) });
    }

    if (req.method === 'POST') {
      const action = (req.body && req.body.action || '').toString();

      if (action === 'create') {
        const label = (req.body.label || '').toString().trim();
        if (!label) return res.status(400).json({ error: 'label required' });
        if (label.length > 200) return res.status(400).json({ error: 'label too long' });
        const opts = {};
        if (req.body.slot_duration_minutes != null) {
          const v = Number(req.body.slot_duration_minutes);
          if (![15, 30, 60].includes(v)) return res.status(400).json({ error: 'invalid slot_duration_minutes' });
          opts.slot_duration_minutes = v;
        }
        const st = req.body.business_hours_start, en = req.body.business_hours_end;
        if (st != null || en != null) {
          if (!isTime(st) || !isTime(en)) return res.status(400).json({ error: 'invalid business hours' });
          // normalise HH:MM -> HH:MM:SS and require end after start
          const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
          if (toMin(en) <= toMin(st)) return res.status(400).json({ error: 'end must be after start' });
          opts.business_hours_start = st;
          opts.business_hours_end = en;
        }
        const row = await createCodeForOwner(ownerId, label, opts);
        return res.status(200).json({
          code: {
            id: row.id, code: row.code, label: row.label, is_active: row.is_active,
            updated_at: row.updated_at, slot_duration_minutes: row.slot_duration_minutes,
            business_hours_start: row.business_hours_start, business_hours_end: row.business_hours_end,
            subscriber_count: 0,
          },
        });
      }

      if (action === 'switch') {
        // Re-scope the session cookie to one of the owner's codes so the existing
        // single-code manage.html / sync-save.js flow (which read code_id from the
        // token) operate on the chosen code. Ownership is re-verified server-side.
        const codeId = (req.body.code_id || '').toString();
        if (!codeId) return res.status(400).json({ error: 'code_id required' });
        const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=owner_id`);
        if (!codes.length) return res.status(404).json({ error: 'code not found' });
        if (codes[0].owner_id !== ownerId) return res.status(403).json({ error: 'not your code' });
        const session = makeToken({ code_id: codeId, owner_id: ownerId, kind: 'session' });
        res.setHeader('Set-Cookie', sessionCookie(session));
        return res.status(200).json({ ok: true });
      }

      if (action === 'set-active') {
        const codeId = (req.body.code_id || '').toString();
        const isActive = req.body.is_active;
        if (!codeId) return res.status(400).json({ error: 'code_id required' });
        if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean' });
        // Verify the code belongs to the session owner before mutating.
        const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=owner_id`);
        if (!codes.length) return res.status(404).json({ error: 'code not found' });
        if (codes[0].owner_id !== ownerId) return res.status(403).json({ error: 'not your code' });
        await sbSend('PATCH', `vl_codes?id=eq.${encodeURIComponent(codeId)}`,
          { is_active: isActive, updated_at: new Date().toISOString() }, { Prefer: 'return=minimal' });
        return res.status(200).json({ ok: true, is_active: isActive });
      }

      if (action === 'archive') {
        const codeId = (req.body.code_id || '').toString();
        if (!codeId) return res.status(400).json({ error: 'code_id required' });
        // Verify the code belongs to the session owner before archiving.
        const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=owner_id`);
        if (!codes.length) return res.status(404).json({ error: 'code not found' });
        if (codes[0].owner_id !== ownerId) return res.status(403).json({ error: 'not your code' });
        // Soft delete: retain subscribers/blocks, drop from dashboard, and
        // deactivate so the public view (which requires is_active=true) stops
        // rendering it. Fully reversible by clearing archived_at.
        const now = new Date().toISOString();
        await sbSend('PATCH', `vl_codes?id=eq.${encodeURIComponent(codeId)}`,
          { archived_at: now, is_active: false, updated_at: now }, { Prefer: 'return=minimal' });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    return res.status(405).json({ error: 'GET or POST only' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
