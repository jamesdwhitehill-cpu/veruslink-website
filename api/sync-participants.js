// VerusLink Sync — participant management (service key, session-gated).
//
// The owner invites people to submit their own availability against a code, lists
// them, resends invites, fetches a copyable respond link, and removes them. Every
// operation is scoped to the owner derived from the verified httpOnly session
// cookie, and the code is re-verified as belonging to that owner before any read
// or write. Participant tokens are the auth for the public respond page, so the
// bulk list NEVER returns them; a copyable link is served one-at-a-time via the
// owner-gated `link_for` read.
//
// GET  /api/sync-participants?code_id=UUID
//   -> { participants:[{id,name,email,role,status,invited_at,responded_at}] }   (no tokens)
// GET  /api/sync-participants?link_for=PARTICIPANT_ID
//   -> { respond_url }                                                          (owner-gated)
// POST /api/sync-participants  { code_id, participants:[{name,email}] }         (invite / resend batch)
//   -> { participants:[{id,name,email,role,status,respond_url}] }
// POST /api/sync-participants  { action:'resend', participant_id }
//   -> { ok:true }
// DELETE /api/sync-participants?participant_id=UUID
//   -> { ok:true }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SYNC_TOKEN_SECRET, RESEND_API_KEY.

import {
  sessionFromRequest, sbGet, sbSend, sbUrl, sbHeaders,
  makeParticipantToken, ensureOwnerParticipant,
} from './_sync-token.js';

const SITE = 'https://veruslink.au';
const FROM = 'VerusLink Sync <vero@veruslink.au>';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function respondUrl(token) {
  return `${SITE}/sync/respond.html?token=${encodeURIComponent(token)}`;
}

// Light, professional invitation email. Matches the v2 executive-grade design.
function inviteEmailHtml({ ownerName, label, participantName, link }) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#FAFBFC;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#1A1A2E">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#2563EB;margin-bottom:28px">VERUSLINK</div>
    <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:0 0 14px;color:#1A1A2E">Find a time that works for everyone</h1>
      <p style="color:#4B5563;font-size:15px;line-height:1.65;margin:0 0 8px">Hi ${esc(participantName)},</p>
      <p style="color:#4B5563;font-size:15px;line-height:1.65;margin:0 0 24px">
        ${esc(ownerName)} shared their availability for <b style="color:#1A1A2E">${esc(label)}</b> and wants to find a time that works for the group. Mark when you are free and everyone will see the best options.
      </p>
      <a href="${esc(link)}" style="display:inline-block;background:#2563EB;color:#FFFFFF;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px">Mark my availability</a>
      <p style="color:#9CA3AF;font-size:13px;line-height:1.6;margin:22px 0 0">No account needed. This link is just for you.</p>
    </div>
    <p style="color:#9CA3AF;font-size:12px;line-height:1.6;margin-top:22px">
      Powered by <a href="${SITE}" style="color:#6B7280">VerusLink</a>
    </p>
  </div></body></html>`;
}

async function sendInvite({ ownerName, label, participant }) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: participant.email,
        subject: `${ownerName} wants to find a time that works for everyone`,
        html: inviteEmailHtml({ ownerName, label, participantName: participant.name, link: respondUrl(participant.token) }),
      }),
    });
  } catch (_) { /* swallow — caller reports created rows regardless */ }
}

// Verify a code belongs to the session owner. Returns { id, label, owner_name } or null.
async function ownedCode(codeId, ownerId) {
  const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=id,label,owner_id`);
  if (!codes.length || codes[0].owner_id !== ownerId) return null;
  const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(ownerId)}&select=name`);
  return { id: codes[0].id, label: codes[0].label, owner_name: (owners[0] && owners[0].name) || 'The organiser' };
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (!process.env.SYNC_TOKEN_SECRET) {
    return res.status(500).json({ error: 'SYNC_TOKEN_SECRET not configured' });
  }

  const sess = sessionFromRequest(req);
  if (!sess) return res.status(401).json({ error: 'not authenticated' });
  const ownerId = sess.owner_id;

  try {
    // ---- GET ----
    if (req.method === 'GET') {
      // Copyable respond link for one participant (owner-gated; never in bulk list).
      const linkFor = (req.query.link_for || '').toString();
      if (linkFor) {
        const rows = await sbGet(`vl_participants?id=eq.${encodeURIComponent(linkFor)}&select=code_id,token`);
        if (!rows.length) return res.status(404).json({ error: 'participant not found' });
        if (!(await ownedCode(rows[0].code_id, ownerId))) return res.status(403).json({ error: 'not your participant' });
        return res.status(200).json({ respond_url: respondUrl(rows[0].token) });
      }

      const codeId = (req.query.code_id || '').toString();
      if (!codeId) return res.status(400).json({ error: 'code_id required' });
      if (!(await ownedCode(codeId, ownerId))) return res.status(403).json({ error: 'not your code' });
      // Owner row is seeded lazily so long-lived codes still expose the owner participant.
      try { await ensureOwnerParticipant(codeId, ownerId); } catch (_) { /* pre-migration tolerance */ }
      const participants = await sbGet(
        `vl_participants?code_id=eq.${encodeURIComponent(codeId)}&select=id,name,email,role,status,invited_at,responded_at&order=role.desc,invited_at.asc`
      );
      return res.status(200).json({ participants });
    }

    // ---- DELETE ----
    if (req.method === 'DELETE') {
      const pid = (req.query.participant_id || '').toString();
      if (!pid) return res.status(400).json({ error: 'participant_id required' });
      const rows = await sbGet(`vl_participants?id=eq.${encodeURIComponent(pid)}&select=code_id,role`);
      if (!rows.length) return res.status(404).json({ error: 'participant not found' });
      if (rows[0].role === 'owner') return res.status(400).json({ error: 'cannot remove the owner' });
      if (!(await ownedCode(rows[0].code_id, ownerId))) return res.status(403).json({ error: 'not your participant' });
      // FK ON DELETE CASCADE removes the participant's availability blocks too.
      await sbSend('DELETE', `vl_participants?id=eq.${encodeURIComponent(pid)}`, null, { Prefer: 'return=minimal' });
      return res.status(200).json({ ok: true });
    }

    // ---- POST ----
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET, POST or DELETE only' });

    const action = (req.body && req.body.action || '').toString();

    // Resend an existing participant's invitation.
    if (action === 'resend') {
      const pid = (req.body.participant_id || '').toString();
      if (!pid) return res.status(400).json({ error: 'participant_id required' });
      const rows = await sbGet(`vl_participants?id=eq.${encodeURIComponent(pid)}&select=code_id,name,email,token,role`);
      if (!rows.length) return res.status(404).json({ error: 'participant not found' });
      const owned = await ownedCode(rows[0].code_id, ownerId);
      if (!owned) return res.status(403).json({ error: 'not your participant' });
      if (rows[0].role === 'owner') return res.status(400).json({ error: 'the owner has no invite to resend' });
      await sendInvite({ ownerName: owned.owner_name, label: owned.label, participant: rows[0] });
      return res.status(200).json({ ok: true });
    }

    // Invite (or re-invite) a batch of participants.
    const codeId = (req.body && req.body.code_id || '').toString();
    if (!codeId) return res.status(400).json({ error: 'code_id required' });
    const owned = await ownedCode(codeId, ownerId);
    if (!owned) return res.status(403).json({ error: 'not your code' });

    const raw = Array.isArray(req.body.participants) ? req.body.participants : null;
    if (!raw || !raw.length) return res.status(400).json({ error: 'participants array required' });
    if (raw.length > 50) return res.status(400).json({ error: 'too many participants at once' });

    // Existing rows for this code, keyed by lowercased email, so re-invites update
    // in place (keeping the same token/link) instead of duplicating.
    const existing = await sbGet(
      `vl_participants?code_id=eq.${encodeURIComponent(codeId)}&select=id,name,email,token,role,status`
    );
    const byEmail = new Map(existing.map((p) => [p.email.toLowerCase(), p]));

    const results = [];
    const seen = new Set();
    for (const p of raw) {
      const name = (p && p.name || '').toString().trim();
      const email = (p && p.email || '').toString().trim().toLowerCase();
      if (!name || !email) return res.status(400).json({ error: 'each participant needs a name and email' });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: `invalid email: ${email}` });
      if (name.length > 120) return res.status(400).json({ error: 'name too long' });
      if (seen.has(email)) continue; // dedupe within the same request
      seen.add(email);

      const found = byEmail.get(email);
      if (found) {
        // Re-invite: refresh the display name, keep the existing token/link.
        if (found.name !== name && found.role !== 'owner') {
          await sbSend('PATCH', `vl_participants?id=eq.${encodeURIComponent(found.id)}`, { name }, { Prefer: 'return=minimal' });
        }
        const participant = { ...found, name: found.role === 'owner' ? found.name : name };
        if (found.role !== 'owner') await sendInvite({ ownerName: owned.owner_name, label: owned.label, participant });
        results.push({ id: participant.id, name: participant.name, email: participant.email, role: participant.role, status: participant.status, respond_url: respondUrl(participant.token) });
        continue;
      }

      // New participant.
      const participant = { code_id: codeId, name, email, token: makeParticipantToken(), role: 'participant', status: 'invited' };
      const created = await sbSend('POST', 'vl_participants', participant, { Prefer: 'return=representation' });
      const row = (await created.json())[0];
      await sendInvite({ ownerName: owned.owner_name, label: owned.label, participant: row });
      results.push({ id: row.id, name: row.name, email: row.email, role: row.role, status: row.status, respond_url: respondUrl(row.token) });
    }

    return res.status(200).json({ participants: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
