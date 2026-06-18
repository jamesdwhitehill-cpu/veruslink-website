// VerusLink Sync — one-click unsubscribe.
// POST /api/sync-unsubscribe { sub: "<vl_subscribers.id>" } -> { ok: true }
//
// Needed server-side because RLS intentionally grants anon only INSERT on
// vl_subscribers (subscriber emails stay private), so the update runs with the
// service key. Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }

  const sub = (req.body && req.body.sub || '').toString().trim();
  // Basic UUID shape guard
  if (!/^[0-9a-fA-F-]{36}$/.test(sub)) return res.status(400).json({ error: 'invalid subscriber id' });

  const key = process.env.SUPABASE_SERVICE_KEY;
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/vl_subscribers?id=eq.${encodeURIComponent(sub)}&unsubscribed_at=is.null`,
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
      }
    );
    if (!r.ok) return res.status(500).json({ error: `Supabase ${r.status}` });
    const rows = await r.json();
    // rows empty = already unsubscribed or unknown id; treat as success (idempotent)
    return res.status(200).json({ ok: true, updated: rows.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
