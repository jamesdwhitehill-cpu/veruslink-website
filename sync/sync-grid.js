/* VerusLink Sync — shared availability grid (weekly, day-of-week based).
 *
 * Two renderers on one module so respond.html, manage.html and view.html all get
 * the exact same look and behaviour:
 *
 *   SyncGrid.editable({ mount, days, slots, state, onChange })
 *     Interactive three-state grid (available / unavailable / not set) with
 *     click-to-cycle, drag-select, all-day column toggle, and touch long-press.
 *     getBlocks() returns rows ready for the API.
 *
 *   SyncGrid.heat({ mount, days, slots, overlap })
 *     Read-only merged grid. Cell intensity scales with how many participants are
 *     available; full overlap glows; hover shows who is free.
 *
 * The model is purely weekly: a slot key is `${day_of_week}|${HH:MM}`. Overlap is
 * computed on the same axis server-side, so what you mark maps 1:1 to the result.
 */
(function () {
  'use strict';

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function keyOf(dow, start) { return dow + '|' + start; }

  // ---- Editable grid ----------------------------------------------------
  function editable(opts) {
    const mount = opts.mount;
    const days = opts.days;              // [{dow,label,dateNum,monthLabel,weekend,isToday}]
    const slots = opts.slots;            // [{start,end,label}]
    const state = opts.state instanceof Map ? opts.state : new Map();
    const onChange = opts.onChange || function () {};

    let bar = null;
    let bulk = [];                       // selected cell elements
    let mouseDown = false, dragStart = null, dragMoved = false, suppressClick = false;
    let selectMode = false, longPressTimer = null, anchor = null;

    const table = el('table', 'sg-grid');
    mount.innerHTML = '';
    mount.appendChild(table);

    function cycle(s) { return s === 'avail' ? 'unavail' : s === 'unavail' ? null : 'avail'; }

    function paint(cell) {
      const st = state.get(cell.dataset.k);
      cell.classList.remove('is-avail', 'is-unavail');
      if (st === 'avail') cell.classList.add('is-avail');
      else if (st === 'unavail') cell.classList.add('is-unavail');
    }

    function render() {
      let head = '<thead><tr><th class="sg-corner"></th>';
      days.forEach(function (d, i) {
        head += '<th class="sg-dayhead' + (d.weekend ? ' is-weekend' : '') + (d.isToday ? ' is-today' : '') +
          '" data-col="' + i + '" title="Click to set the whole day">' +
          '<span class="sg-dow">' + d.label + '</span>' +
          (d.dateNum != null ? '<span class="sg-dnum">' + d.dateNum + '</span>' : '') +
          (d.monthLabel ? '<span class="sg-mon">' + d.monthLabel + '</span>' : '') +
          '</th>';
      });
      head += '</tr></thead><tbody>';
      let body = '';
      slots.forEach(function (s, ri) {
        body += '<tr><td class="sg-time">' + s.label + '</td>';
        days.forEach(function (d, ci) {
          const k = keyOf(d.dow, s.start);
          body += '<td class="sg-td"><div class="sg-cell" data-k="' + k + '" data-dow="' + d.dow +
            '" data-start="' + s.start + '" data-end="' + s.end + '" data-r="' + ri + '" data-c="' + ci + '"></div></td>';
        });
        body += '</tr>';
      });
      table.innerHTML = head + body + '</tbody>';
      table.querySelectorAll('.sg-cell').forEach(paint);
      wireHeaders();
    }

    function wireHeaders() {
      table.querySelectorAll('.sg-dayhead').forEach(function (th) {
        const ci = Number(th.dataset.col);
        th.addEventListener('mouseenter', function () { hlCol(ci, true); });
        th.addEventListener('mouseleave', function () { hlCol(ci, false); });
        th.addEventListener('click', function () { hlCol(ci, false); toggleColumn(ci); });
      });
    }
    function hlCol(ci, on) {
      table.querySelectorAll('.sg-cell[data-c="' + ci + '"], .sg-dayhead[data-col="' + ci + '"]')
        .forEach(function (n) { n.classList.toggle('col-hl', on); });
    }

    function toggleColumn(ci) {
      clearBulk();
      const dow = days[ci].dow;
      let allAvail = true, allUnavail = true;
      slots.forEach(function (s) {
        const st = state.get(keyOf(dow, s.start));
        if (st !== 'avail') allAvail = false;
        if (st !== 'unavail') allUnavail = false;
      });
      const target = allAvail ? 'unavail' : allUnavail ? null : 'avail';
      slots.forEach(function (s) { setState(dow, s.start, target); });
      table.querySelectorAll('.sg-cell[data-c="' + ci + '"]').forEach(paint);
      onChange();
    }

    function setState(dow, start, target) {
      const k = keyOf(dow, start);
      if (target) state.set(k, target); else state.delete(k);
    }

    // --- bulk selection ---
    function info(cell) {
      return { el: cell, dow: Number(cell.dataset.dow), start: cell.dataset.start, r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
    }
    function cellsInRect(r1, c1, r2, c2) {
      const rlo = Math.min(r1, r2), rhi = Math.max(r1, r2), clo = Math.min(c1, c2), chi = Math.max(c1, c2);
      return Array.prototype.filter.call(table.querySelectorAll('.sg-cell'), function (e) {
        const r = +e.dataset.r, c = +e.dataset.c; return r >= rlo && r <= rhi && c >= clo && c <= chi;
      });
    }
    function clearSelecting() { table.querySelectorAll('.sg-cell.is-selecting').forEach(function (c) { c.classList.remove('is-selecting'); }); }
    function highlight(a, b) { clearSelecting(); cellsInRect(a.r, a.c, b.r, b.c).forEach(function (e) { e.classList.add('is-selecting'); }); }
    function finalize() {
      const els = Array.prototype.slice.call(table.querySelectorAll('.sg-cell.is-selecting'));
      els.forEach(function (e) { e.classList.remove('is-selecting'); e.classList.add('is-selected'); });
      bulk = els; showBar();
    }
    function setBulk(els) { clearBulk(); els.forEach(function (e) { e.classList.add('is-selected'); }); bulk = els; }
    function toggleSel(cell) {
      if (cell.classList.contains('is-selected')) { cell.classList.remove('is-selected'); bulk = bulk.filter(function (e) { return e !== cell; }); }
      else { cell.classList.add('is-selected'); bulk.push(cell); }
      showBar();
    }
    function clearBulk() {
      table.querySelectorAll('.sg-cell.is-selected,.sg-cell.is-selecting').forEach(function (c) { c.classList.remove('is-selected', 'is-selecting'); });
      bulk = []; selectMode = false; hideBar();
    }
    function buildBar() {
      bar = el('div', 'sg-bulkbar hidden');
      bar.innerHTML = '<span class="sg-bb-count">0 selected</span>' +
        '<button type="button" class="sg-bb sg-bb-avail">Available</button>' +
        '<button type="button" class="sg-bb sg-bb-unavail">Unavailable</button>' +
        '<button type="button" class="sg-bb sg-bb-clear">Clear</button>' +
        '<button type="button" class="sg-bb sg-bb-done">Done</button>';
      document.body.appendChild(bar);
      bar.querySelector('.sg-bb-avail').addEventListener('click', function () { applyBulk('avail'); });
      bar.querySelector('.sg-bb-unavail').addEventListener('click', function () { applyBulk('unavail'); });
      bar.querySelector('.sg-bb-clear').addEventListener('click', function () { applyBulk(null); });
      bar.querySelector('.sg-bb-done').addEventListener('click', clearBulk);
    }
    function hideBar() { if (bar) bar.classList.add('hidden'); }
    function showBar() {
      if (!bar) buildBar();
      if (!bulk.length) { hideBar(); return; }
      bar.querySelector('.sg-bb-count').textContent = bulk.length + ' selected';
      bar.querySelector('.sg-bb-done').style.display = selectMode ? '' : 'none';
      bar.classList.remove('hidden');
      let minL = Infinity, maxR = -Infinity, minT = Infinity;
      bulk.forEach(function (c) { const r = c.getBoundingClientRect(); minL = Math.min(minL, r.left); maxR = Math.max(maxR, r.right); minT = Math.min(minT, r.top); });
      const cx = (minL + maxR) / 2, bh = bar.offsetHeight;
      let top = minT - bh - 10; if (top < 8) top = minT + 44;
      bar.style.left = cx + 'px'; bar.style.top = top + 'px';
    }
    function applyBulk(target) {
      bulk.forEach(function (c) { const i = info(c); setState(i.dow, i.start, target); paint(c); });
      clearBulk(); onChange();
    }

    function onClick(cell, e) {
      if (suppressClick) { suppressClick = false; return; }
      const i = info(cell);
      if (selectMode) { toggleSel(cell); return; }
      if (e.shiftKey && anchor) { setBulk(cellsInRect(anchor.r, anchor.c, i.r, i.c)); showBar(); return; }
      clearBulk();
      const next = cycle(state.get(cell.dataset.k));
      setState(i.dow, i.start, next);
      paint(cell);
      anchor = { r: i.r, c: i.c };
      onChange();
    }

    // events (delegated on the table)
    table.addEventListener('click', function (e) { const c = e.target.closest('.sg-cell'); if (c && table.contains(c)) onClick(c, e); });
    table.addEventListener('mousedown', function (e) { if (e.button !== 0) return; const c = e.target.closest('.sg-cell'); if (!c) return; suppressClick = false; mouseDown = true; dragStart = info(c); dragMoved = false; });
    table.addEventListener('mousemove', function (e) { if (!mouseDown || !dragStart) return; const c = e.target.closest('.sg-cell'); if (!c) return; if (+c.dataset.r !== dragStart.r || +c.dataset.c !== dragStart.c) dragMoved = true; if (dragMoved) highlight(dragStart, info(c)); });
    document.addEventListener('mouseup', function () { if (!mouseDown) return; mouseDown = false; if (dragMoved) { finalize(); suppressClick = true; } dragStart = null; });
    table.addEventListener('touchstart', function (e) {
      const c = e.target.closest('.sg-cell'); if (!c) return; const cell = c;
      longPressTimer = setTimeout(function () {
        longPressTimer = null; suppressClick = true; selectMode = true; clearSelecting();
        if (!cell.classList.contains('is-selected')) { cell.classList.add('is-selected'); bulk.push(cell); }
        showBar(); if (navigator.vibrate) navigator.vibrate(15);
      }, 420);
    }, { passive: true });
    const cancelLP = function () { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
    table.addEventListener('touchmove', cancelLP, { passive: true });
    table.addEventListener('touchend', cancelLP);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearBulk(); });
    document.addEventListener('click', function (e) { if (!bulk.length) return; if (e.target.closest('.sg-bulkbar')) return; if (e.target.closest('.sg-cell')) return; clearBulk(); });

    render();

    return {
      getBlocks: function () {
        const out = [];
        state.forEach(function (st, k) {
          const i = k.indexOf('|'); const dow = Number(k.slice(0, i)); const start = k.slice(i + 1);
          const slot = slots.find(function (s) { return s.start === start; });
          out.push({ day_of_week: dow, start_time: start, end_time: slot ? slot.end : start, provider: st === 'unavail' ? 'unavailable' : 'manual' });
        });
        return out;
      },
      count: function () { return state.size; },
      clearAll: function () { state.clear(); table.querySelectorAll('.sg-cell').forEach(paint); onChange(); },
      destroy: function () { if (bar) bar.remove(); },
    };
  }

  // ---- Read-only heat grid ---------------------------------------------
  function heat(opts) {
    const mount = opts.mount;
    const days = opts.days;
    const slots = opts.slots;
    const overlap = opts.overlap || { slots: [], responded: 0, participants: [] };
    const nameById = {};
    (overlap.participants || []).forEach(function (p) { nameById[p.id] = p.name; });
    const byKey = {};
    (overlap.slots || []).forEach(function (s) { byKey[keyOf(s.day_of_week, String(s.start_time).slice(0, 5))] = s; });
    const responded = overlap.responded || 0;

    const table = el('table', 'sg-grid sg-heat');
    mount.innerHTML = '';
    mount.appendChild(table);

    let head = '<thead><tr><th class="sg-corner"></th>';
    days.forEach(function (d) {
      head += '<th class="sg-dayhead' + (d.weekend ? ' is-weekend' : '') + '">' +
        '<span class="sg-dow">' + d.label + '</span>' +
        (d.dateNum != null ? '<span class="sg-dnum">' + d.dateNum + '</span>' : '') +
        (d.monthLabel ? '<span class="sg-mon">' + d.monthLabel + '</span>' : '') + '</th>';
    });
    head += '</tr></thead><tbody>';
    let body = '';
    slots.forEach(function (s) {
      body += '<tr><td class="sg-time">' + s.label + '</td>';
      days.forEach(function (d) {
        const cell = byKey[keyOf(d.dow, s.start)];
        const count = cell ? cell.available_count : 0;
        const full = cell ? cell.is_full_overlap : false;
        let cls = 'sg-cell sg-ro';
        if (count > 0) {
          const ratio = responded > 0 ? count / responded : 0;
          const level = full ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.34 ? 2 : 1;
          cls += ' heat-' + level + (full ? ' is-full' : '');
        }
        let tip = '';
        if (cell && cell.available_by && cell.available_by.length) {
          const names = cell.available_by.map(function (id) { return nameById[id] || 'Someone'; });
          tip = 'Available: ' + names.join(', ');
        }
        const label = count > 0 ? (full ? '✓' : count + '/' + responded) : '';
        body += '<td class="sg-td"><div class="' + cls + '"' + (tip ? ' title="' + tip.replace(/"/g, '&quot;') + '"' : '') + '>' +
          (label ? '<span class="sg-heatnum">' + label + '</span>' : '') + '</div></td>';
      });
      body += '</tr>';
    });
    table.innerHTML = head + body + '</tbody>';
    return { destroy: function () {} };
  }

  window.SyncGrid = { editable: editable, heat: heat };
})();
