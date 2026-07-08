// VerusLink Sync — owner authentication (magic-link flow).
//
// Replaces the old, bypassable client-side `?email=` equality gate. The owner
// email is NEVER sent to the browser. Ownership is proven by clicking a magic
// link emailed to the address on file for the code.
//
// POST /api/sync-owner  { action:'request-link', code }
//   -> looks up the owner email server-side (service key), emails a signed
//      magic link. Always returns { ok:true } (no account/email enumeration).
//
// GET /api/sync-owner?token=...
//   -> verifies the magic token, sets an httpOnly session cookie scoped to the
//      code, and 302-redirects to /sync/manage.html?code=SYNC-XXXX
//      (no email in the URL).
//
// GET /api/sync-owner?session=1&code=SYNC-XXXX
//   -> returns owner-visible code data IF the session cookie is valid for that
//      code. Used by manage.html to bootstrap the dashboard. 401 if not.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, SYNC_TOKEN_SECRET.

import { makeToken, verifyToken, sessionFromRequest, sessionCookie, sbGet, sbSend, createCodeForOwner, ensureOwnerParticipant } from './_sync-token.js';

const SITE = 'https://veruslink.au';
const FROM = 'VerusLink Sync <vero@veruslink.au>';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function magicEmailHtml({ label, code, link }) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0D0D18;font-family:Inter,Arial,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:#fff;margin-bottom:24px">VERUSLINK</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px">
      <h1 style="font-size:21px;margin:0 0 12px">Open your availability dashboard</h1>
      <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px">
        Click below to manage availability for <b>${esc(label)}</b> (code <b>${esc(code)}</b>). This link expires in 30 minutes and can only be used by you.
      </p>
      <a href="${esc(link)}" style="display:inline-block;background:#2D9CDB;color:#04121c;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:11px;font-size:15px">Open my dashboard →</a>
    </div>
    <p style="color:rgba(255,255,255,0.34);font-size:12px;line-height:1.6;margin-top:22px">
      If you didn't request this, you can safely ignore it. Powered by <a href="${SITE}" style="color:rgba(255,255,255,0.5)">VerusLink</a>
    </p>
  </div></body></html>`;
}

function dashboardEmailHtml({ link }) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0D0D18;font-family:Inter,Arial,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:#fff;margin-bottom:24px">VERUSLINK</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px">
      <h1 style="font-size:21px;margin:0 0 12px">Open your sync dashboard</h1>
      <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px">
        Click below to manage all of your VerusLink Sync codes. This link expires in 30 minutes and can only be used by you.
      </p>
      <a href="${esc(link)}" style="display:inline-block;background:#2D9CDB;color:#04121c;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:11px;font-size:15px">Open my dashboard →</a>
    </div>
    <p style="color:rgba(255,255,255,0.34);font-size:12px;line-height:1.6;margin-top:22px">
      If you didn't request this, you can safely ignore it. Powered by <a href="${SITE}" style="color:rgba(255,255,255,0.5)">VerusLink</a>
    </p>
  </div></body></html>`;
}

// Email an owner a magic link that opens the multi-code dashboard. The owner's
// email is resolved server-side and never exposed to the browser. No-op (silent)
// if the owner has no codes, no email, or Resend is not configured.
async function sendDashboardLink(ownerId) {
  const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(ownerId)}&select=email`);
  if (!owners.length || !owners[0].email || !process.env.RESEND_API_KEY) return;
  const codes = await sbGet(`vl_codes?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&order=created_at.asc&limit=1`);
  if (!codes.length) return; // nothing to manage yet
  const magic = makeToken({ code_id: codes[0].id, owner_id: ownerId, kind: 'magic', dest: 'dashboard' });
  const link = `${SITE}/api/sync-owner?token=${encodeURIComponent(magic)}`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: owners[0].email,
        subject: 'Your VerusLink Sync dashboard link',
        html: dashboardEmailHtml({ link }),
      }),
    });
  } catch (_) { /* swallow — caller still returns ok */ }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (!process.env.SYNC_TOKEN_SECRET) {
    return res.status(500).json({ error: 'SYNC_TOKEN_SECRET not configured' });
  }

  // ---- GET ----
  if (req.method === 'GET') {
    // (a) Consume a magic-link token -> set session cookie + redirect.
    const token = (req.query.token || '').toString();
    if (token) {
      const payload = verifyToken(token, 'magic');
      if (!payload) {
        res.setHeader('Content-Type', 'text/html');
        return res.status(400).send('<p style="font-family:sans-serif">This link is invalid or has expired. Request a new one from the dashboard page.</p>');
      }
      // Resolve the code string for a clean redirect (no email in URL).
      let codeStr = '';
      try {
        const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(payload.code_id)}&select=code`);
        codeStr = codes.length ? codes[0].code : '';
      } catch (_) { /* fall through */ }
      const session = makeToken({ code_id: payload.code_id, owner_id: payload.owner_id, kind: 'session' });
      res.setHeader('Set-Cookie', sessionCookie(session));
      // Owner-scoped links (dest:'dashboard') land on the multi-code dashboard;
      // code-scoped links keep the original single-code manage destination.
      const location = payload.dest === 'dashboard'
        ? '/sync/dashboard.html'
        : `/sync/manage.html?code=${encodeURIComponent(codeStr)}`;
      res.setHeader('Location', location);
      return res.status(302).end();
    }

    // (b) Session bootstrap for manage.html.
    if ((req.query.session || '').toString() === '1') {
      const code = (req.query.code || '').toString().trim().toUpperCase();
      const sess = sessionFromRequest(req);
      if (!sess) return res.status(401).json({ error: 'not authenticated' });
      try {
        const codes = await sbGet(
          `vl_codes?id=eq.${encodeURIComponent(sess.code_id)}&select=id,code,label,timezone,slot_duration_minutes,business_hours_start,business_hours_end,days_ahead,is_active`
        );
        if (!codes.length) return res.status(404).json({ error: 'code not found' });
        const c = codes[0];
        // The session is scoped to one code; the URL code must match it.
        if (code && c.code.toUpperCase() !== code) return res.status(403).json({ error: 'session does not match this code' });

        // Return the owner's OWN availability (not the whole roster's — participants'
        // blocks share this code_id now) plus the owner's participant id. Falls back
        // to the legacy all-blocks read if the participant table isn't migrated yet.
        let owner_participant_id = null;
        let blocks = [];
        try {
          const op = await ensureOwnerParticipant(c.id, sess.owner_id);
          owner_participant_id = op ? op.id : null;
          if (owner_participant_id) {
            blocks = await sbGet(
              `vl_available_blocks?code_id=eq.${encodeURIComponent(c.id)}&or=(participant_id.is.null,participant_id.eq.${encodeURIComponent(owner_participant_id)})&select=day_of_week,start_time,end_time,provider`
            );
          } else {
            blocks = await sbGet(`vl_available_blocks?code_id=eq.${encodeURIComponent(c.id)}&select=day_of_week,start_time,end_time,provider`);
          }
        } catch (_) {
          // Pre-migration: no participant_id column — read all blocks for the code.
          blocks = await sbGet(`vl_available_blocks?code_id=eq.${encodeURIComponent(c.id)}&select=day_of_week,start_time,end_time,provider`);
        }
        return res.status(200).json({ code: c, owner_participant_id, blocks });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(400).json({ error: 'token or session required' });
  }

  // ---- POST ----
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const action = (req.body && req.body.action || '').toString();

  try {
    // (1) Code-scoped magic link (manage.html gate) — emails the owner on file.
    if (action === 'request-link') {
      const code = (req.body && req.body.code || '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'code required' });
      const codes = await sbGet(`vl_codes?code=eq.${encodeURIComponent(code)}&select=id,label,owner_id`);
      // Always return ok to avoid revealing which codes exist.
      if (codes.length) {
        const c = codes[0];
        const owners = await sbGet(`vl_owners?id=eq.${encodeURIComponent(c.owner_id)}&select=email`);
        if (owners.length && owners[0].email && process.env.RESEND_API_KEY) {
          const magic = makeToken({ code_id: c.id, owner_id: c.owner_id, kind: 'magic' });
          const link = `${SITE}/api/sync-owner?token=${encodeURIComponent(magic)}`;
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: FROM,
                to: owners[0].email,
                subject: 'Your VerusLink Sync dashboard link',
                html: magicEmailHtml({ label: c.label, code, link }),
              }),
            });
          } catch (_) { /* swallow — still return ok */ }
        }
      }
      return res.status(200).json({ ok: true });
    }

    // (2) Owner-scoped magic link (dashboard sign-in) — emails by address.
    //     Uniform { ok:true } regardless of whether the email exists (no enumeration).
    if (action === 'request-owner-link') {
      const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
      if (email) {
        const owners = await sbGet(`vl_owners?email=eq.${encodeURIComponent(email)}&select=id`);
        if (owners.length) await sendDashboardLink(owners[0].id);
      }
      return res.status(200).json({ ok: true });
    }

    // (3) Signup — create the first code for a brand-new email and start a session.
    //     If the email already exists we do NOT auto-authenticate (that would be an
    //     account takeover via the public form); instead we email a sign-in link.
    if (action === 'signup') {
      const name = (req.body && req.body.name || '').toString().trim();
      const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
      const label = (req.body && req.body.label || '').toString().trim();
      if (!name || !email || !label) return res.status(400).json({ error: 'name, email and label are required' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });
      if (name.length > 120 || label.length > 200) return res.status(400).json({ error: 'name or label too long' });

      const existing = await sbGet(`vl_owners?email=eq.${encodeURIComponent(email)}&select=id`);
      if (existing.length) {
        await sendDashboardLink(existing[0].id);
        return res.status(200).json({ existing: true });
      }

      const created = await sbSend('POST', 'vl_owners', { name, email }, { Prefer: 'return=representation' });
      const owner = (await created.json())[0];
      const codeRow = await createCodeForOwner(owner.id, label);

      // New account, freshly created by this caller — safe to start a session.
      const session = makeToken({ code_id: codeRow.id, owner_id: owner.id, kind: 'session' });
      res.setHeader('Set-Cookie', sessionCookie(session));
      return res.status(200).json({ ok: true, code: codeRow.code });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
