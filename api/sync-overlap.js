// VerusLink Sync — overlap read endpoint.
//
// GET /api/sync-overlap?code_id=UUID
//   -> { total_participants, responded, participants[], slots[], best_slots[] }
//
// Read-only aggregate over everyone's availability. Not owner-gated: the merged
// overlap (counts, not identities beyond names) is shown on the public view page
// and the manage page alike. Participant tokens and emails are never returned.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.

import { computeOverlap } from './_sync-overlap.js';

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env not configured' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const codeId = (req.query.code_id || '').toString();
  if (!codeId) return res.status(400).json({ error: 'code_id required' });

  try {
    const overlap = await computeOverlap(codeId);
    return res.status(200).json(overlap);
  } catch (e) {
    const status = /code not found/.test(e.message) ? 404 : 500;
    return res.status(status).json({ error: e.message });
  }
}
