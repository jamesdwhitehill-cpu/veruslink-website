// VerusLink Sync — shared overlap engine (server-side only, not a route).
//
// Computes, for a code, how many participants are available in each time slot.
// Every participant's availability lives in vl_available_blocks tagged with a
// participant_id (the owner included — see ensureOwnerParticipant). Blocks are
// expanded onto the code's canonical slot grid (slot_duration_minutes), then
// counted per (day_of_week, slot).
//
// Returns:
//   {
//     total_participants, responded,
//     participants: [{ id, name, role, status }],
//     slots: [{ day_of_week, start_time, end_time, available_count, available_by[], is_full_overlap }],
//     best_slots: [ top 5 slots by count desc, then earliest ]
//   }

import { sbGet } from './_sync-token.js';

function toMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
function toTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function computeOverlap(codeId) {
  const codes = await sbGet(
    `vl_codes?id=eq.${encodeURIComponent(codeId)}&select=id,slot_duration_minutes,business_hours_start,business_hours_end`
  );
  if (!codes.length) throw new Error('code not found');
  const dur = Number(codes[0].slot_duration_minutes) || 30;

  const participants = await sbGet(
    `vl_participants?code_id=eq.${encodeURIComponent(codeId)}&select=id,name,role,status&order=role.desc,invited_at.asc`
  );
  const total_participants = participants.length;
  const responded = participants.filter((p) => p.status === 'responded').length;

  // Only 'manual' blocks mean "available". Unavailable/other providers are ignored
  // for the positive overlap count.
  const blocks = await sbGet(
    `vl_available_blocks?code_id=eq.${encodeURIComponent(codeId)}&provider=eq.manual&select=participant_id,day_of_week,start_time,end_time`
  );

  // Expand each block onto the slot grid: slotMap['day|startMin'] -> Set(participant_id)
  const slotMap = new Map();
  for (const b of blocks) {
    // Legacy owner blocks may have a NULL participant_id; skip them here (they are
    // backfilled to the owner participant on the next owner save). Counting a NULL
    // as a distinct participant would corrupt the denominator.
    if (!b.participant_id) continue;
    const from = toMin(b.start_time);
    const to = toMin(b.end_time);
    for (let s = from; s + dur <= to; s += dur) {
      const key = `${b.day_of_week}|${s}`;
      let set = slotMap.get(key);
      if (!set) { set = new Set(); slotMap.set(key, set); }
      set.add(b.participant_id);
    }
  }

  const slots = [];
  for (const [key, set] of slotMap.entries()) {
    const [day, startMin] = key.split('|').map(Number);
    const available_by = Array.from(set);
    const available_count = available_by.length;
    slots.push({
      day_of_week: day,
      start_time: toTime(startMin),
      end_time: toTime(startMin + dur),
      available_count,
      available_by,
      is_full_overlap: responded > 0 && available_count === responded,
    });
  }

  slots.sort((a, b) =>
    a.day_of_week - b.day_of_week ||
    toMin(a.start_time) - toMin(b.start_time)
  );

  const best_slots = [...slots]
    .sort((a, b) =>
      b.available_count - a.available_count ||
      a.day_of_week - b.day_of_week ||
      toMin(a.start_time) - toMin(b.start_time)
    )
    .slice(0, 5);

  return { total_participants, responded, participants, slots, best_slots };
}
