// VerusLink Sync — overlap read endpoint.
//
// GET /api/sync-overlap?code_id=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> { total_participants, responded, participants[], dates{}, best_slots[], date_summary{} }
//
// Read-only aggregate over everyone's date-specific availability. Not owner-gated:
// the merged overlap (counts, plus participant names for the day panel) is shown
// on the public view page and the manage page alike. Participant tokens and emails
// are never returned. `from`/`to` bound the query to a visible window; omitted, the
// engine returns every date-specific block for the code.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

import { computeOverlap } from './_sync-overlap.js';

function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const codeId = (req.query.code_id || '').toString();
  if (!codeId) return res.status(400).json({ error: 'code_id required' });

  const from = (req.query.from || '').toString();
  const to = (req.query.to || '').toString();
  const range = {};
  if (isDate(from)) range.from = from;
  if (isDate(to)) range.to = to;

  try {
    const overlap = await computeOverlap(codeId, range);
    return res.status(200).json(overlap);
  } catch (e) {
    const status = /code not found/.test(e.message) ? 404 : 500;
    return res.status(status).json({ error: e.message });
  }
}
