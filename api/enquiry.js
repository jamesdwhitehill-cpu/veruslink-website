// VerusLink homepage enquiry funnel.
// POST /api/enquiry { need, goal, name, email, business, website }  -> { ok: true }
//
// Delivers each enquiry to James on Telegram. If Telegram is not configured or
// refuses the message, the enquiry is emailed to James instead, so a lead is never
// dropped silently. Success means at least one channel confirmed delivery.
//
// Rate limited per IP (api/_rate-limit.js) on top of the honeypot.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (primary), RESEND_API_KEY (fallback).

import { rateLimit, clientIp, tooMany } from './_rate-limit.js';

const FROM = 'VerusLink Website <vero@veruslink.au>';
const ALERT_TO = 'james@veruslink.au';

const NEEDS = {
  admin: "Drowning in repetitive admin",
  leads: 'Leads go cold before we reply',
  start: "Knows AI could help, doesn't know where to start",
};
const GOALS = {
  time: 'Save time',
  win: 'Win more work',
  cost: 'Cut costs',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function sendTelegram(html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, reason: 'telegram not configured' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const body = await r.json().catch(() => null);
    if (r.ok && body && body.ok) return { ok: true };
    return { ok: false, reason: `telegram ${r.status} ${JSON.stringify(body).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, reason: `telegram network error ${e.message}` };
  }
}

async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: 'resend not configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: ALERT_TO, subject, html }),
    });
    if (r.ok) return { ok: true };
    const body = await r.text().catch(() => '');
    return { ok: false, reason: `resend ${r.status} ${body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, reason: `resend network error ${e.message}` };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }

  let data;
  try {
    data = await readBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'bad request' });
  }

  // Honeypot: a filled hidden field means a bot. Report success and drop it.
  if (clean(data.website, 200)) return res.status(200).json({ ok: true });

  const need = NEEDS[data.need];
  const goal = GOALS[data.goal];
  const name = clean(data.name, 80);
  const email = clean(data.email, 160).toLowerCase();
  const business = clean(data.business, 120);

  if (!need || !goal || !name || !business || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'missing or invalid fields' });
  }

  if (!(await rateLimit('enquiry-ip', clientIp(req), { limit: 5, windowSec: 3600 }))) return tooMany(res);

  const when = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
  const lines = [
    '<b>New website enquiry</b>',
    '',
    `<b>${esc(name)}</b>, ${esc(business)}`,
    esc(email),
    '',
    `<b>Needs help with:</b> ${esc(need)}`,
    `<b>Goal:</b> ${esc(goal)}`,
    '',
    `<i>${esc(when)} Sydney, veruslink.au</i>`,
  ];

  const tg = await sendTelegram(lines.join('\n'));
  if (tg.ok) return res.status(200).json({ ok: true });

  console.error('enquiry: telegram failed, falling back to email:', tg.reason);
  const mail = await sendEmail(`Website enquiry: ${name}, ${business}`, lines.join('<br>'));
  if (mail.ok) return res.status(200).json({ ok: true });

  console.error('enquiry: NOT DELIVERED', mail.reason, JSON.stringify({ name, email, business, need, goal }));
  return res.status(502).json({ ok: false, error: 'not delivered' });
}
