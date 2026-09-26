// CPD hour sign-up. POST /api/cpd-signup { name, firm, email, phone?, website? }
//
// Emails the submission to James from the already-verified veruslink.au sender.
// Nothing is stored: the email to James is the record. Zero-dependency, same
// Resend call shape as sync-notify.js. Env: RESEND_API_KEY.
//
// `website` is the honeypot. A filled honeypot gets the normal success reply so
// a bot learns nothing, and nothing is sent.

const FROM = 'VerusLink <vero@veruslink.au>';
const TO = 'james@veruslink.au';
const ALLOWED_ORIGINS = ['https://www.veruslink.au', 'https://veruslink.au'];

// Best-effort per-instance throttle. A serverless instance is short-lived, so this
// only blunts a burst from one address; it is not a durable limit.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'origin not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }

  if (clean(body.website, 200)) return res.status(200).json({ ok: true });

  const name = clean(body.name, 120);
  const firm = clean(body.firm, 160);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  if (!name || !firm || !email) return res.status(400).json({ error: 'name, firm and email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email looks wrong' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (throttled(ip)) return res.status(429).json({ error: 'too many requests' });

  if (!process.env.RESEND_API_KEY) {
    console.error('[cpd-signup] RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'not configured' });
  }

  const html =
    `<p>New CPD hour booking request from veruslink.au/cpd-hour.</p>` +
    `<p><strong>Name:</strong> ${esc(name)}<br>` +
    `<strong>Firm:</strong> ${esc(firm)}<br>` +
    `<strong>Email:</strong> ${esc(email)}<br>` +
    `<strong>Phone:</strong> ${phone ? esc(phone) : '(not given)'}</p>` +
    `<p>Reply within one business day to lock a time. Replying to this email goes to them.</p>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: email,
        subject: `CPD hour request: ${firm}`.slice(0, 150),
        html,
      }),
    });
    const out = await r.json().catch(() => ({ _unparseable: true }));
    console.error(`[cpd-signup] resend status=${r.status} body=${JSON.stringify(out)}`);
    // Success means a confirmed Resend 2xx and nothing else.
    if (!r.ok) return res.status(502).json({ error: 'send failed' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[cpd-signup] network error: ${err.message}`);
    return res.status(502).json({ error: 'send failed' });
  }
}
