// VerusLink Sync — participant respond endpoint (token-auth, no session cookie).
//
// The participant token in the URL IS the auth. No account, no login. Used by the
// public respond.html page a participant lands on from their invitation email.
//
// GET  /api/sync-respond?token=TOKEN
//   -> { code:{...}, owner_name, participant:{name,status,role}, blocks:[...],
//        counts:{ invited, responded } }   (blocks are date-specific: {block_date,...})
// POST /api/sync-respond  { token, blocks:[{block_date,start_time,end_time,provider}] }
//   -> { ok:true, blocks, responded, total }
// POST /api/sync-respond  { token, action:'decline' }
//   -> { ok:true, declined:true }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY.

import { sbGet, sbSend } from './_sync-token.js';
import { computeOverlap } from './_sync-overlap.js';

const SITE = 'https://veruslink.au';
const FROM = 'VerusLink Sync <vero@veruslink.au>';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s); }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
// Format a 'YYYY-MM-DD' as "Tuesday 15 Jul" (timezone-naive, matches the code's local dates).
function fmtDate(d) {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  return `${DAY_NAMES[dt.getDay()]} ${day} ${MON[m - 1]}`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(t) {
  const [h, m] = String(t).split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

async function participantFromToken(token) {
  if (!token) return null;
  const rows = await sbGet(
    `vl_participants?token=eq.${encodeURIComponent(token)}&select=id,code_id,name,email,role,status&limit=1`
  );
  return rows.length ? rows[0] : null;
}

// Email the owner a short summary when a participant responds or declines.
async function notifyOwner({ codeId, participantName, declined }) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=label,owner_id`);
    if (!codes.length) return;
    const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(codes[0].owner_id)}&select=name,email`);
    if (!owners.length || !owners[0].email) return;
    const label = codes[0].label;

    let overlapLine = '';
    let headline;
    if (declined) {
      headline = `${participantName} can't make the proposed times`;
    } else {
      const ov = await computeOverlap(codeId);
      headline = `${participantName} submitted their availability`;
      const best = ov.best_slots && ov.best_slots[0];
      const progress = `${ov.responded} of ${ov.total_participants} have now responded.`;
      const bestStr = best
        ? `Best time so far: ${fmtDate(best.date)}, ${fmtTime(best.start)} to ${fmtTime(best.end)} (${best.count} of ${ov.responded} available).`
        : '';
      overlapLine = `<p style="color:#4B5563;font-size:15px;line-height:1.65;margin:0 0 8px">${esc(progress)}</p>
        ${bestStr ? `<p style="color:#4B5563;font-size:15px;line-height:1.65;margin:0 0 24px"><b style="color:#1A1A2E">${esc(bestStr)}</b></p>` : ''}`;
    }

    const manageUrl = `${SITE}/sync/dashboard.html`;
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#FAFBFC;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#1A1A2E">
      <div style="max-width:520px;margin:0 auto;padding:40px 24px">
        <div style="font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2563EB;margin-bottom:28px">VERUSLINK</div>
        <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
          <h1 style="font-size:21px;font-weight:700;letter-spacing:-0.02em;margin:0 0 14px">${esc(headline)}</h1>
          <p style="color:#4B5563;font-size:15px;line-height:1.65;margin:0 0 16px">For <b style="color:#1A1A2E">${esc(label)}</b>.</p>
          ${overlapLine}
          <a href="${manageUrl}" style="display:inline-block;background:#2563EB;color:#FFFFFF;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px">View the best times</a>
        </div>
        <p style="color:#9CA3AF;font-size:12px;line-height:1.6;margin-top:22px">Powered by <a href="${SITE}" style="color:#6B7280">VerusLink</a></p>
      </div></body></html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: owners[0].email, subject: headline, html }),
    });
  } catch (_) { /* notification is best-effort */ }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }

  try {
    // ---- GET: validate token, return everything the respond page needs ----
    if (req.method === 'GET') {
      const token = (req.query.token || '').toString();
      const p = await participantFromToken(token);
      if (!p) return res.status(404).json({ error: 'This link is no longer valid or has expired.' });

      const codes = await sbGet(
        `vl_codes?id=eq.${encodeURIComponent(p.code_id)}&select=id,code,label,timezone,slot_duration_minutes,business_hours_start,business_hours_end,days_ahead,is_active,owner_id`
      );
      if (!codes.length) return res.status(404).json({ error: 'This link is no longer valid or has expired.' });
      const c = codes[0];

      const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(c.owner_id)}&select=name`);
      const owner_name = (owners[0] && owners[0].name) || 'The organiser';

      const roster = await sbGet(
        `vl_participants?code_id=eq.${encodeURIComponent(p.code_id)}&select=status`
      );
      const counts = {
        invited: roster.length,
        responded: roster.filter((r) => r.status === 'responded').length,
      };

      const blocks = await sbGet(
        `vl_available_blocks?participant_id=eq.${encodeURIComponent(p.id)}&block_date=not.is.null&select=block_date,start_time,end_time,provider`
      );

      // Never leak owner_id or the token back to the browser.
      const code = {
        id: c.id, code: c.code, label: c.label, timezone: c.timezone,
        slot_duration_minutes: c.slot_duration_minutes,
        business_hours_start: c.business_hours_start, business_hours_end: c.business_hours_end,
        days_ahead: c.days_ahead, is_active: c.is_active,
      };
      return res.status(200).json({
        code, owner_name,
        participant: { name: p.name, status: p.status, role: p.role },
        blocks, counts,
      });
    }

    // ---- POST: save availability, or decline ----
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

    const token = (req.body && req.body.token || '').toString();
    const p = await participantFromToken(token);
    if (!p) return res.status(404).json({ error: 'This link is no longer valid or has expired.' });

    const action = (req.body.action || '').toString();

    if (action === 'decline') {
      await sbSend('PATCH', `vl_participants?id=eq.${encodeURIComponent(p.id)}`,
        { status: 'declined', responded_at: new Date().toISOString() }, { Prefer: 'return=minimal' });
      // Drop any prior availability so a declined participant never skews the overlap.
      await sbSend('DELETE', `vl_available_blocks?participant_id=eq.${encodeURIComponent(p.id)}`, null, { Prefer: 'return=minimal' });
      await notifyOwner({ codeId: p.code_id, participantName: p.name, declined: true });
      return res.status(200).json({ ok: true, declined: true });
    }

    const raw = Array.isArray(req.body && req.body.blocks) ? req.body.blocks : null;
    if (!raw) return res.status(400).json({ error: 'blocks array required' });
    if (raw.length > 5000) return res.status(400).json({ error: 'too many blocks' });

    const blocks = [];
    for (const b of raw) {
      if (!isDate(b.block_date)) return res.status(400).json({ error: 'invalid block_date' });
      if (!isTime(b.start_time) || !isTime(b.end_time)) return res.status(400).json({ error: 'invalid time' });
      const provider = b.provider === 'unavailable' ? 'unavailable' : 'manual';
      blocks.push({
        code_id: p.code_id,
        participant_id: p.id,
        block_date: b.block_date,
        start_time: b.start_time,
        end_time: b.end_time,
        provider,
      });
    }

    // Replace this participant's blocks only.
    await sbSend('DELETE', `vl_available_blocks?participant_id=eq.${encodeURIComponent(p.id)}`, null, { Prefer: 'return=minimal' });
    if (blocks.length) await sbSend('POST', 'vl_available_blocks', blocks, { Prefer: 'return=minimal' });

    await sbSend('PATCH', `vl_participants?id=eq.${encodeURIComponent(p.id)}`,
      { status: 'responded', responded_at: new Date().toISOString() }, { Prefer: 'return=minimal' });

    // Log the change so subscribers' notification pipeline still works.
    await sbSend('POST', 'vl_change_log', {
      code_id: p.code_id, change_summary: `${p.name} submitted availability`,
    }, { Prefer: 'return=minimal' });

    await notifyOwner({ codeId: p.code_id, participantName: p.name, declined: false });

    // Fresh counts for the success state.
    const roster = await sbGet(`vl_participants?code_id=eq.${encodeURIComponent(p.code_id)}&select=status`);
    return res.status(200).json({
      ok: true,
      blocks: blocks.length,
      responded: roster.filter((r) => r.status === 'responded').length,
      total: roster.length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
