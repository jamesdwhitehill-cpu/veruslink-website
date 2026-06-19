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

import { makeToken, verifyToken, sessionFromRequest, sessionCookie, sbGet, sbHeaders, sbUrl } from './_sync-token.js';

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
      res.setHeader('Location', `/sync/manage.html?code=${encodeURIComponent(codeStr)}`);
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
        return res.status(200).json({ code: c });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(400).json({ error: 'token or session required' });
  }

  // ---- POST: request a magic link ----
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const code = (req.body && req.body.code || '').toString().trim().toUpperCase();
  const action = (req.body && req.body.action || '').toString();
  if (action !== 'request-link') return res.status(400).json({ error: 'unknown action' });
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
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
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
