// VerusLink Sync — shared overlap engine (server-side only, not a route).
//
// Computes, for a code over a date range, how many participants are available in
// each date+time slot. Every participant's availability lives in
// vl_available_blocks tagged with a participant_id (the owner included — see
// ensureOwnerParticipant) and a concrete block_date. Blocks are expanded onto the
// code's canonical slot grid (slot_duration_minutes), then counted per
// (block_date, slot).
//
// Returns:
//   {
//     total_participants, responded,
//     participants: [{ id, name, role, status }],
//     dates: { 'YYYY-MM-DD': { slots: [{ start, end, count, total, full, who[] }] } },
//     best_slots: [ top 5 by count desc, then earliest date/time — { date, start, end, count, full } ],
//     date_summary: { 'YYYY-MM-DD': { has_availability, best_count, is_full } }
//   }

import { sbGet } from './_sync-token.js';

function toMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
function toTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// range: optional { from:'YYYY-MM-DD', to:'YYYY-MM-DD' } to bound the query.
// Omitted -> all date-specific blocks for the code.
export async function computeOverlap(codeId, range = {}) {
  const codes = await sbGet(
    `vl_codes?id=eq.${encodeURIComponent(codeId)}&select=id,slot_duration_minutes,business_hours_start,business_hours_end,days_ahead`
  );
  if (!codes.length) throw new Error('code not found');
  const dur = Number(codes[0].slot_duration_minutes) || 30;

  const participants = await sbGet(
    `vl_participants?code_id=eq.${encodeURIComponent(codeId)}&select=id,name,role,status&order=role.desc,invited_at.asc`
  );
  const total_participants = participants.length;
  const responded = participants.filter((p) => p.status === 'responded').length;

  // Only 'manual' blocks mean "available"; date-specific only (block_date NOT NULL).
  let q = `vl_available_blocks?code_id=eq.${encodeURIComponent(codeId)}&provider=eq.manual&block_date=not.is.null&select=participant_id,block_date,start_time,end_time`;
  if (isDate(range.from)) q += `&block_date=gte.${range.from}`;
  if (isDate(range.to)) q += `&block_date=lte.${range.to}`;
  const blocks = await sbGet(q);

  // Expand each block onto the slot grid: slotMap['YYYY-MM-DD|startMin'] -> Set(participant_id)
  const slotMap = new Map();
  for (const b of blocks) {
    // Legacy owner blocks may have a NULL participant_id; skip (counting NULL as a
    // distinct participant would corrupt the denominator). Backfilled on next save.
    if (!b.participant_id || !b.block_date) continue;
    const date = String(b.block_date).slice(0, 10);
    const from = toMin(b.start_time);
    const to = toMin(b.end_time);
    for (let s = from; s + dur <= to; s += dur) {
      const key = `${date}|${s}`;
      let set = slotMap.get(key);
      if (!set) { set = new Set(); slotMap.set(key, set); }
      set.add(b.participant_id);
    }
  }

  // Group into { date -> [slot,...] } and build a flat list for best_slots.
  const dates = {};
  const flat = [];
  for (const [key, set] of slotMap.entries()) {
    const bar = key.indexOf('|');
    const date = key.slice(0, bar);
    const startMin = Number(key.slice(bar + 1));
    const who = Array.from(set);
    const count = who.length;
    const full = responded > 0 && count === responded;
    const slot = {
      start: toTime(startMin),
      end: toTime(startMin + dur),
      count,
      total: responded,
      full,
      who,
    };
    (dates[date] || (dates[date] = { slots: [] })).slots.push(slot);
    flat.push({ date, startMin, ...slot });
  }

  // Sort each date's slots by time.
  for (const d of Object.keys(dates)) {
    dates[d].slots.sort((a, b) => toMin(a.start) - toMin(b.start));
  }

  const best_slots = [...flat]
    .sort((a, b) =>
      b.count - a.count ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      a.startMin - b.startMin
    )
    .slice(0, 5)
    .map((s) => ({ date: s.date, start: s.start, end: s.end, count: s.count, full: s.full }));

  // Per-date summary for the month calendar dots.
  const date_summary = {};
  for (const d of Object.keys(dates)) {
    const best = dates[d].slots.reduce((m, s) => Math.max(m, s.count), 0);
    date_summary[d] = {
      has_availability: dates[d].slots.length > 0,
      best_count: best,
      is_full: responded > 0 && best === responded,
    };
  }

  return { total_participants, responded, participants, dates, best_slots, date_summary };
}
