// VerusLink Sync — notification + subscriber-count endpoint.
// GET  /api/sync-notify?code_id=UUID   -> { count }            (active subscriber count)
// POST /api/sync-notify { code_id }     -> { notified }         (emails subscribers, rate-limited 1/hour)
//
// Zero-dependency: uses global fetch against the Supabase REST API (service key,
// bypasses RLS) and the Resend API. Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY.

const SITE = 'https://veruslink.au';
const FROM = 'VerusLink Sync <vero@veruslink.au>';
const ALERT_TO = 'james@veruslink.au';

// Standing outbound email behaviour, ported to a serverless function.
//
// Success means a confirmed Resend 2xx and nothing else. Resend reports most
// failures with a flat body ({statusCode, message, name}), not {error:{...}}, so
// the HTTP status is the only trustworthy signal.
//
// Backoff is deliberately short here. This runs in a Vercel function with a
// platform timeout and loops over every subscriber, so the workspace's 2s/8s/20s
// ladder would risk the whole request being killed mid-send.
const RETRY_DELAYS_MS = [1000, 3000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 and 5xx are worth another go. A 403 (unverified domain) or 422 (bad payload)
// fails identically every time, so retrying only delays the alert.
function isTransient(status) {
  if (status === null) return true; // network error
  return status === 429 || status >= 500;
}

/**
 * Send one email. Resolves { ok: true, id } only on a confirmed 2xx.
 * Every attempt is logged with its status and full body.
 */
async function sendOne({ to, subject, html, idempotencyKey }) {
  const attempts = [];
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) {
    let status = null;
    let body = null;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          // Retries of one logical email reuse this key, so a timeout after Resend
          // already accepted the message cannot produce a duplicate send.
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ from: FROM, to, subject, html }),
      });
      status = r.status;
      body = await r.json().catch(() => ({ _unparseable: true }));
      console.error(`[sync-notify] attempt ${i + 1} to=${to} status=${status} body=${JSON.stringify(body)}`);
      if (r.ok) return { ok: true, id: body && body.id, attempts: attempts.length + 1 };
    } catch (err) {
      body = { error: err.message };
      console.error(`[sync-notify] attempt ${i + 1} to=${to} network error: ${err.message}`);
    }
    attempts.push({ status, body });
    if (!isTransient(status) || i === RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[i]);
  }
  const last = attempts[attempts.length - 1];
  return { ok: false, status: last.status, body: last.body, attempts: attempts.length };
}

/**
 * Escalate undelivered notifications. This project has no Telegram token, so the
 * alert goes to James by email from the already-verified veruslink.au domain.
 * Never throws: a failed alert must not take the request down, but it is logged
 * loudly so the failure is never silent.
 */
async function escalate(code, failures) {
  const lines = failures
    .map((f) => `${f.email} - status ${f.status ?? 'network error'} - ${JSON.stringify(f.body).slice(0, 200)}`)
    .join('<br>');
  const html =
    `<p>Sync notifications for code <strong>${code}</strong> were NOT delivered to ` +
    `${failures.length} subscriber(s).</p><p>${lines}</p>` +
    `<p>These subscribers did not receive the update. Contact them or resend by hand.</p>`;
  console.error(`[sync-notify] ESCALATION: ${failures.length} undelivered for code=${code}`);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: ALERT_TO, subject: `Sync notifications NOT sent (${failures.length})`, html }),
    });
    if (!r.ok) console.error(`[sync-notify] ESCALATION EMAIL FAILED: ${r.status} ${JSON.stringify(await r.json().catch(() => ({})))}`);
  } catch (err) {
    console.error(`[sync-notify] ESCALATION EMAIL FAILED: ${err.message}`);
  }
}

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function sbUrl(path) {
  return `${process.env.SUPABASE_URL}/rest/v1/${path}`;
}

async function sbGet(path) {
  const r = await fetch(sbUrl(path), { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailHtml({ label, code, viewUrl, unsubUrl }) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0D0D18;font-family:Inter,Arial,sans-serif;color:#fff">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:#fff;margin-bottom:24px">VERUSLINK</div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px">
      <h1 style="font-size:21px;margin:0 0 12px">${esc(label)} updated their availability</h1>
      <p style="color:rgba(255,255,255,0.65);font-size:15px;line-height:1.6;margin:0 0 24px">
        There are new available times to see. View the latest below.
      </p>
      <a href="${esc(viewUrl)}" style="display:inline-block;background:#2D9CDB;color:#04121c;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:11px;font-size:15px">View availability →</a>
    </div>
    <p style="color:rgba(255,255,255,0.34);font-size:12px;line-height:1.6;margin-top:22px">
      You're receiving this because you subscribed to availability code <b style="color:rgba(255,255,255,0.6)">${esc(code)}</b>.<br>
      <a href="${esc(unsubUrl)}" style="color:rgba(255,255,255,0.5)">Unsubscribe</a> · Powered by <a href="${SITE}" style="color:rgba(255,255,255,0.5)">VerusLink</a>
    </p>
  </div></body></html>`;
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }

  // ---- GET: active subscriber count ----
  if (req.method === 'GET') {
    const codeId = (req.query.code_id || '').toString();
    if (!codeId) return res.status(400).json({ error: 'code_id required' });
    try {
      const rows = await sbGet(`vl_subscribers?code_id=eq.${encodeURIComponent(codeId)}&unsubscribed_at=is.null&select=id`);
      return res.status(200).json({ count: rows.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const codeId = (req.body && req.body.code_id || '').toString();
  if (!codeId) return res.status(400).json({ error: 'code_id required' });

  try {
    // ---- Rate limit: skip if a notification went out in the last hour ----
    const recent = await sbGet(
      `vl_change_log?code_id=eq.${encodeURIComponent(codeId)}&notified=is.true&order=changed_at.desc&limit=1&select=changed_at`
    );
    if (recent.length) {
      const last = new Date(recent[0].changed_at).getTime();
      if (Date.now() - last < 60 * 60 * 1000) {
        return res.status(200).json({ notified: 0, reason: 'rate_limited' });
      }
    }

    // ---- Fetch code + active subscribers ----
    const codes = await sbGet(`vl_codes?id=eq.${encodeURIComponent(codeId)}&select=code,label`);
    if (!codes.length) return res.status(404).json({ error: 'code not found' });
    const { code, label } = codes[0];

    const subs = await sbGet(
      `vl_subscribers?code_id=eq.${encodeURIComponent(codeId)}&unsubscribed_at=is.null&select=id,email,name`
    );

    // ---- Send emails via Resend ----
    // `sent` counts confirmed 2xx responses only. Anything else lands in `failures`
    // and is escalated to James: a notification is never silently dropped.
    let sent = 0;
    const ids = [];
    const failures = [];
    if (subs.length && process.env.RESEND_API_KEY) {
      const viewUrl = `${SITE}/sync/view.html?code=${encodeURIComponent(code)}`;
      for (const s of subs) {
        const unsubUrl = `${SITE}/sync/unsubscribe.html?sub=${encodeURIComponent(s.id)}`;
        const result = await sendOne({
          to: s.email,
          subject: `${label} updated their availability`,
          html: emailHtml({ label, code, viewUrl, unsubUrl }),
          // Stable per subscriber per change, so a retry cannot double-notify.
          idempotencyKey: `sync-${codeId}-${s.id}`,
        });
        if (result.ok) {
          sent++;
          if (result.id) ids.push({ email: s.email, id: result.id });
        } else {
          failures.push({ email: s.email, status: result.status, body: result.body });
        }
      }
    }
    if (failures.length) await escalate(code, failures);

    // ---- Mark the pending change_log entries as notified ----
    // Still marked even when some sends failed, because the rows are per change_log
    // entry rather than per recipient: leaving them unnotified would re-blast the
    // subscribers who did receive it. The undelivered ones are escalated above
    // instead, so nothing is lost, and the caller sees them in `failed`.
    await fetch(sbUrl(`vl_change_log?code_id=eq.${encodeURIComponent(codeId)}&notified=is.false`), {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ notified: true }),
    });

    // `notified` is confirmed deliveries only. Never report an unsent email as sent.
    return res.status(200).json({ notified: sent, ids, failed: failures.length, failures });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
