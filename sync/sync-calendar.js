/* VerusLink Sync — month calendar + day-detail component (date-specific).
 *
 * Replaces the weekly day-of-week grid. Two public factories share one
 * two-panel shell (month calendar on the left, day detail on the right):
 *
 *   SyncCalendar.editor({ monthMount, dayMount, slots, minISO, maxISO, state, onChange })
 *     Interactive. Click a date to edit its slots; each slot cycles
 *     available → unavailable → clear. Multi-select dates (Shift = range,
 *     Ctrl/Cmd = toggle) then "Apply to all selected". getBlocks() returns rows
 *     ready for the API ({ block_date, start_time, end_time, provider }).
 *
 *   SyncCalendar.viewer({ monthMount, dayMount, slots, minISO, maxISO, overlap, mode })
 *     Read-only. Month dots and per-day slot heat come from the overlap engine's
 *     date-keyed payload ({ dates, date_summary, responded, participants }).
 *
 * Model: a slot key is `${'YYYY-MM-DD'}|${HH:MM}`. Everything is timezone-naive —
 * dates are the code owner's local calendar dates, matching the server.
 */
(function () {
  'use strict';

  const DOWH = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ---- date helpers (naive local dates) ----
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function fmtLong(s) { const d = parse(s); return `${DAYFULL[d.getDay()]}, ${d.getDate()} ${MONFULL[d.getMonth()]} ${d.getFullYear()}`; }
  function monthKey(s) { const d = parse(s); return d.getFullYear() * 12 + d.getMonth(); }
  function el(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  // Shared month-grid renderer. `opts` holds view state + a dotFor(iso) callback.
  function buildShell(o) {
    const monthMount = o.monthMount;
    monthMount.innerHTML = '';
    const cal = el('div', 'sc-cal');
    monthMount.appendChild(cal);

    const first = parse(o.minISO);
    const last = parse(o.maxISO);
    const minMonth = first.getFullYear() * 12 + first.getMonth();
    const maxMonth = last.getFullYear() * 12 + last.getMonth();
    let view = minMonth; // current displayed month index

    function render() {
      const y = Math.floor(view / 12), m = view % 12;
      const monthFirst = new Date(y, m, 1);
      const offset = (monthFirst.getDay() + 6) % 7; // Mon=0
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const todayISO = iso(new Date());

      let h = '<div class="sc-cal-head">' +
        `<button type="button" class="sc-nav" data-nav="-1"${view <= minMonth ? ' disabled' : ''} aria-label="Previous month">‹</button>` +
        `<span class="sc-cal-title">${MONFULL[m]} ${y}</span>` +
        `<button type="button" class="sc-nav" data-nav="1"${view >= maxMonth ? ' disabled' : ''} aria-label="Next month">›</button>` +
        '</div><div class="sc-dow">' + DOWH.map((d) => `<span>${d}</span>`).join('') + '</div><div class="sc-grid">';

      for (let i = 0; i < offset; i++) h += '<span class="sc-day is-blank"></span>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
        const inRange = ds >= o.minISO && ds <= o.maxISO;
        const cls = ['sc-day'];
        if (!inRange) cls.push('is-out');
        if (ds === todayISO) cls.push('is-today');
        if (o.selected && o.selected.has(ds)) cls.push('is-selected');
        if (o.primary === ds) cls.push('is-primary');
        const dot = inRange && o.dotFor ? o.dotFor(ds) : '';
        h += `<button type="button" class="${cls.join(' ')}"${inRange ? '' : ' disabled'} data-date="${ds}">` +
          `<span class="sc-dnum">${d}</span>${dot}</button>`;
      }
      h += '</div>';
      cal.innerHTML = h;

      cal.querySelectorAll('.sc-nav').forEach((b) => b.addEventListener('click', () => {
        view = Math.max(minMonth, Math.min(maxMonth, view + Number(b.dataset.nav)));
        render();
      }));
      cal.querySelectorAll('.sc-day[data-date]:not(.is-out)').forEach((b) => {
        b.addEventListener('click', (e) => o.onPick(b.dataset.date, e));
      });
    }

    // Jump the visible month to the one containing `ds`.
    function focusMonth(ds) { const mk = monthKey(ds); if (mk >= minMonth && mk <= maxMonth) { view = mk; } render(); }

    render();
    return { render, focusMonth };
  }

  function bulkBar(count, applyLabel) {
    return `<div class="sc-daybulk"><span class="sc-selcount">${count} day${count === 1 ? '' : 's'} selected</span>` +
      `<button type="button" class="btn btn-ghost btn-sm sc-apply">${applyLabel}</button>` +
      `<button type="button" class="btn btn-ghost btn-sm sc-clearsel">Clear selection</button></div>`;
  }

  // ---- Editor ----------------------------------------------------------
  function editor(o) {
    const slots = o.slots;
    const state = o.state instanceof Map ? o.state : new Map(); // isoDate -> Map(slotStart -> 'avail'|'unavail')
    const onChange = o.onChange || function () {};
    const selected = new Set();
    let primary = null;
    let anchor = null; // for shift-range

    function dayState(ds) { let m = state.get(ds); if (!m) { m = new Map(); state.set(ds, m); } return m; }
    function pruneEmpty(ds) { const m = state.get(ds); if (m && m.size === 0) state.delete(ds); }

    function dotFor(ds) {
      const m = state.get(ds);
      if (!m || !m.size) return '';
      let av = false, un = false;
      m.forEach((v) => { if (v === 'avail') av = true; else if (v === 'unavail') un = true; });
      let dots = '';
      if (av) dots += '<span class="sc-dot sc-dot-avail"></span>';
      if (un) dots += '<span class="sc-dot sc-dot-unavail"></span>';
      return `<span class="sc-dots">${dots}</span>`;
    }

    const shell = buildShell({
      monthMount: o.monthMount, minISO: o.minISO, maxISO: o.maxISO,
      selected, get primary() { return primary; }, dotFor,
      onPick: onPick,
    });

    function rangeBetween(a, b) {
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const out = []; let d = parse(lo); const end = parse(hi);
      while (d <= end) { const s = iso(d); if (s >= o.minISO && s <= o.maxISO) out.push(s); d.setDate(d.getDate() + 1); }
      return out;
    }

    function onPick(ds, e) {
      if (e && (e.metaKey || e.ctrlKey)) {
        if (selected.has(ds)) selected.delete(ds); else selected.add(ds);
        primary = ds; anchor = ds;
      } else if (e && e.shiftKey && anchor) {
        selected.clear(); rangeBetween(anchor, ds).forEach((s) => selected.add(s)); primary = ds;
      } else {
        selected.clear(); selected.add(ds); primary = ds; anchor = ds;
      }
      shell.render(); renderDay();
    }

    // ---- day panel ----
    function renderDay() {
      const mount = o.dayMount;
      if (!primary) {
        mount.innerHTML = '<div class="sc-day-empty"><div class="sc-day-empty-i">🗓️</div><p>Select a date to set your availability.</p></div>';
        return;
      }
      const dm = state.get(primary) || new Map();
      const multi = selected.size > 1;
      let h = `<div class="sc-day-head"><h3>${fmtLong(primary)}</h3></div>`;
      h += '<div class="sc-day-actions"><button type="button" class="btn btn-ghost btn-sm" data-a="all">Mark all available</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-a="clear">Clear all</button></div>';
      if (multi) h += bulkBar(selected.size, `Apply this day to ${selected.size} days`);
      h += '<div class="sc-slots">';
      slots.forEach((s) => {
        const st = dm.get(s.start);
        const cls = 'sc-slot' + (st === 'avail' ? ' is-avail' : st === 'unavail' ? ' is-unavail' : '');
        const tag = st === 'avail' ? '<span class="sc-slot-tag">Available</span>' :
          st === 'unavail' ? '<span class="sc-slot-tag">Unavailable</span>' : '';
        h += `<button type="button" class="${cls}" data-start="${s.start}"><span class="sc-slot-t">${s.label}</span>${tag}</button>`;
      });
      h += '</div>';
      mount.innerHTML = h;

      mount.querySelectorAll('.sc-slot').forEach((b) => b.addEventListener('click', () => {
        const cur = dm.get(b.dataset.start);
        const next = cur === 'avail' ? 'unavail' : cur === 'unavail' ? null : 'avail';
        const m = dayState(primary);
        if (next) m.set(b.dataset.start, next); else m.delete(b.dataset.start);
        pruneEmpty(primary);
        renderDay(); shell.render(); onChange();
      }));
      const allBtn = mount.querySelector('[data-a="all"]');
      if (allBtn) allBtn.addEventListener('click', () => { const m = dayState(primary); slots.forEach((s) => m.set(s.start, 'avail')); renderDay(); shell.render(); onChange(); });
      const clearBtn = mount.querySelector('[data-a="clear"]');
      if (clearBtn) clearBtn.addEventListener('click', () => { state.delete(primary); renderDay(); shell.render(); onChange(); });
      const apply = mount.querySelector('.sc-apply');
      if (apply) apply.addEventListener('click', () => {
        if (!confirm(`Set the same availability for ${selected.size} selected days?`)) return;
        const src = state.get(primary);
        selected.forEach((ds) => {
          if (ds === primary) return;
          if (!src || !src.size) { state.delete(ds); return; }
          const copy = new Map(); src.forEach((v, k) => copy.set(k, v)); state.set(ds, copy);
        });
        shell.render(); onChange();
      });
      const cs = mount.querySelector('.sc-clearsel');
      if (cs) cs.addEventListener('click', () => { selected.clear(); selected.add(primary); shell.render(); renderDay(); });
    }

    renderDay();

    return {
      getBlocks: function () {
        const out = [];
        state.forEach((m, ds) => {
          m.forEach((st, start) => {
            const slot = slots.find((s) => s.start === start);
            out.push({ block_date: ds, start_time: start, end_time: slot ? slot.end : start, provider: st === 'unavail' ? 'unavailable' : 'manual' });
          });
        });
        return out;
      },
      count: function () { let n = 0; state.forEach((m) => { n += m.size; }); return n; },
      selectDate: function (ds) { onPick(ds, null); shell.focusMonth(ds); },
      destroy: function () {},
    };
  }

  // ---- Viewer (read-only overlap) --------------------------------------
  function viewer(o) {
    const slots = o.slots;
    const overlap = o.overlap || { dates: {}, date_summary: {}, responded: 0, participants: [] };
    const responded = overlap.responded || 0;
    const summary = overlap.date_summary || {};
    const byDate = overlap.dates || {};
    const nameById = {};
    (overlap.participants || []).forEach((p) => { nameById[p.id] = p.name; });
    let primary = null;

    function dotFor(ds) {
      const s = summary[ds];
      if (!s || !s.has_availability) return '';
      const cls = s.is_full ? 'sc-dot-full' : 'sc-dot-some';
      return `<span class="sc-dots"><span class="sc-dot ${cls}"></span></span>`;
    }

    const shell = buildShell({
      monthMount: o.monthMount, minISO: o.minISO, maxISO: o.maxISO,
      selected: new Set(), get primary() { return primary; }, dotFor,
      onPick: (ds) => { primary = ds; shell.render(); renderDay(); },
    });

    function renderDay() {
      const mount = o.dayMount;
      if (!primary) {
        mount.innerHTML = '<div class="sc-day-empty"><div class="sc-day-empty-i">🗓️</div><p>Select a date to see who is free.</p></div>';
        return;
      }
      const rec = byDate[primary];
      let h = `<div class="sc-day-head"><h3>${fmtLong(primary)}</h3></div>`;
      if (!rec || !rec.slots.length) {
        h += '<div class="sc-day-empty"><p>No availability shared for this day yet.</p></div>';
        mount.innerHTML = h; return;
      }
      const map = {};
      rec.slots.forEach((s) => { map[s.start] = s; });
      h += '<div class="sc-slots sc-slots-ro">';
      slots.forEach((s) => {
        const cell = map[s.start];
        const count = cell ? cell.count : 0;
        const full = cell ? cell.full : false;
        let cls = 'sc-slot sc-ro';
        if (count > 0) {
          const ratio = responded > 0 ? count / responded : 0;
          const level = full ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.34 ? 2 : 1;
          cls += ' heat-' + level + (full ? ' is-full' : '');
        }
        let who = '';
        if (cell && cell.who && cell.who.length) who = 'Free: ' + cell.who.map((id) => nameById[id] || 'Someone').join(', ');
        const label = count > 0 ? (full ? '✓ all ' + responded : count + ' / ' + responded) : '—';
        h += `<div class="${cls}"${who ? ` title="${who.replace(/"/g, '&quot;')}"` : ''}><span class="sc-slot-t">${s.label}</span><span class="sc-slot-count">${label}</span></div>`;
      });
      h += '</div>';
      mount.innerHTML = h;
    }

    renderDay();
    return {
      selectDate: function (ds) { primary = ds; shell.focusMonth(ds); renderDay(); },
      // Jump to the first date that has any availability (nice default focus).
      focusFirstAvailable: function () {
        const ds = Object.keys(summary).filter((d) => summary[d].has_availability).sort()[0];
        if (ds) { primary = ds; shell.focusMonth(ds); renderDay(); }
      },
      destroy: function () {},
    };
  }

  window.SyncCalendar = { editor: editor, viewer: viewer };
})();
