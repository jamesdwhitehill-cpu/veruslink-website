/* VerusLink intro call booking. Mount with <div data-booking></div>.
   Availability and bookings come from book.veruslink.au through /api/booking/*. */
(function () {
  var API = '/api/booking';
  var TYPE = 'intro';
  var FALLBACK = 'https://book.veruslink.au/intro';
  var TZ = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Australia/Sydney';
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var css = '' +
    '.bk{max-width:1080px;--bk-line:#E4E9F0;--bk-muted:#5A6470;background:var(--paper,#fff);border:1px solid var(--bk-line);border-radius:var(--r-lg,24px);box-shadow:var(--e3,0 30px 60px -30px rgba(17,24,39,.35));display:grid;grid-template-columns:260px minmax(0,1fr) 230px;min-height:440px;overflow:hidden;text-align:left;color:var(--ink,#111827);font-size:15px;line-height:1.45;}' +
    '.bk *{box-sizing:border-box;}' +
    '.bk button{font:inherit;color:inherit;}' +
    '.bk-info{padding:28px 26px;border-right:1px solid var(--bk-line);}' +
    '.bk-brand{font-weight:700;font-size:13px;letter-spacing:.02em;margin-bottom:18px;}.bk-brand span{color:var(--accent,#2D9CDB);}' +
    '.bk-info h3{font-size:22px;line-height:1.15;letter-spacing:-.015em;margin:0 0 10px;font-weight:700;}' +
    '.bk-info p{color:var(--bk-muted);font-size:14px;margin:0 0 20px;}' +
    '.bk-meta{display:grid;gap:10px;font-size:14px;font-weight:600;}' +
    '.bk-meta div{display:flex;align-items:center;gap:10px;}' +
    '.bk-meta svg{width:16px;height:16px;flex:none;stroke:var(--bk-muted);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}' +
    '.bk-meta .tz{font-weight:500;color:var(--bk-muted);font-size:13px;}' +
    '.bk-cal{padding:26px 26px 22px;}' +
    '.bk-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}' +
    '.bk-month{font-weight:700;font-size:16px;}.bk-month span{color:var(--bk-muted);font-weight:500;}' +
    '.bk-nav{display:flex;gap:6px;}' +
    '.bk-nav button{width:34px;height:34px;border-radius:10px;border:1px solid var(--bk-line);background:var(--paper,#fff);cursor:pointer;display:grid;place-items:center;}' +
    '.bk-nav button:disabled{opacity:.35;cursor:default;}' +
    '.bk-nav button:not(:disabled):hover{border-color:var(--accent,#2D9CDB);color:var(--accent,#2D9CDB);}' +
    '.bk-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}' +
    '.bk-dow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--bk-muted);text-align:center;padding:4px 0 8px;font-weight:600;}' +
    '.bk-day{height:48px;border-radius:12px;border:0;background:transparent;color:rgba(17,24,39,.32);display:grid;place-items:center;position:relative;font-weight:500;cursor:default;}' +
    '.bk-day.open{background:var(--tint,#F0F7FC);color:var(--ink,#111827);font-weight:700;cursor:pointer;transition:background .15s ease,transform .15s ease;}' +
    '.bk-day.open:hover{background:#dcedf9;transform:translateY(-1px);}' +
    '.bk-day.sel{background:var(--ink,#111827)!important;color:#fff!important;}' +
    '.bk-day.today::after{content:"";position:absolute;bottom:6px;width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.6;}' +
    '.bk-times{border-left:1px solid var(--bk-line);padding:26px 18px 22px;display:flex;flex-direction:column;min-height:0;}' +
    '.bk-thead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;}' +
    '.bk-tday{font-weight:700;font-size:15px;}.bk-tday span{color:var(--bk-muted);font-weight:500;}' +
    '.bk-fmt{display:flex;border:1px solid var(--bk-line);border-radius:10px;padding:2px;}' +
    '.bk-fmt button{border:0;background:transparent;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:600;cursor:pointer;color:var(--bk-muted);}' +
    '.bk-fmt button.on{background:var(--tint,#F0F7FC);color:var(--ink,#111827);}' +
    '.bk-list{display:grid;gap:8px;overflow:auto;max-height:340px;padding-right:2px;}' +
    '.bk-slot{min-height:44px;border:1px solid var(--bk-line);border-radius:10px;background:var(--paper,#fff);font-weight:600;cursor:pointer;transition:border-color .15s ease,color .15s ease;}' +
    '.bk-slot:hover,.bk-slot:focus-visible{border-color:var(--accent,#2D9CDB);color:var(--accent,#2D9CDB);outline:none;}' +
    '.bk-empty{color:var(--bk-muted);font-size:14px;}' +
    '.bk-skel{height:44px;border-radius:10px;background:linear-gradient(90deg,#eef2f6 0%,#f7f9fb 50%,#eef2f6 100%);background-size:200% 100%;animation:bkSh 1.2s infinite linear;}' +
    '@keyframes bkSh{to{background-position:-200% 0;}}' +
    '.bk-form,.bk-done{grid-column:2/4;padding:26px 30px;}' +
    '.bk-back{border:0;background:none;cursor:pointer;color:var(--bk-muted);font-size:13px;font-weight:600;padding:10px 0;min-height:44px;}' +
    '.bk-back:hover{color:var(--accent,#2D9CDB);}' +
    '.bk-when{font-weight:700;font-size:18px;margin:4px 0 18px;}' +
    '.bk-form label{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;margin:0 0 6px;}' +
    '.bk-form input,.bk-form textarea{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1px solid var(--bk-line);border-radius:10px;background:var(--paper,#fff);color:var(--ink,#111827);margin-bottom:14px;}' +
    '.bk-form textarea{min-height:84px;resize:vertical;}' +
    '.bk-form input:focus,.bk-form textarea:focus{outline:none;border-color:var(--accent,#2D9CDB);box-shadow:0 0 0 3px rgba(45,156,219,.15);}' +
    '.bk-go{width:100%;min-height:52px;border:0;border-radius:var(--r-sm,10px);background:var(--ink,#111827);color:#fff!important;font-size:12px!important;letter-spacing:.14em;text-transform:uppercase;font-weight:600;cursor:pointer;}' +
    '.bk-go:hover{background:var(--accent,#2D9CDB);}.bk-go[disabled]{opacity:.6;cursor:wait;}' +
    '.bk-err{color:#b42318;font-size:14px;margin:12px 0 0;min-height:1em;}.bk-err a{color:inherit;}' +
    '.bk-tick{width:52px;height:52px;border-radius:50%;background:var(--accent,#2D9CDB);display:grid;place-items:center;margin:8px 0 22px;}' +
    '.bk-tick svg{width:24px;height:24px;stroke:#fff;stroke-width:3;fill:none;}' +
    '.bk-done h3{font-size:26px;letter-spacing:-.02em;margin:0 0 8px;}' +
    '.bk-done p{color:var(--bk-muted);margin:0 0 6px;max-width:30em;}' +
    '.bk-done .bk-when{color:var(--ink,#111827);}' +
    '.bk-off{grid-column:1/-1;padding:40px 30px;}' +
    '@media(max-width:900px){.bk{grid-template-columns:1fr;}.bk-info{border-right:0;border-bottom:1px solid var(--bk-line);padding:22px 20px;}.bk-cal{padding:20px;}.bk-times{border-left:0;border-top:1px solid var(--bk-line);padding:20px;}.bk-list{grid-template-columns:repeat(3,1fr);max-height:none;}.bk-form,.bk-done{grid-column:1;padding:22px 20px;}.bk-info p{display:none;}}' +
    '@media(max-width:420px){.bk-list{grid-template-columns:repeat(2,1fr);}.bk-day{height:42px;border-radius:10px;}.bk-grid{gap:4px;}}' +
    '@media(prefers-reduced-motion:reduce){.bk-skel{animation:none;}.bk-day.open:hover{transform:none;}}';

  var ICON = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    left: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>'
  };

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function monthName(d) { return d.toLocaleDateString('en-AU', { month: 'long' }); }
  function tzLabel() { return TZ.replace(/_/g, ' '); }
  function fmtTime(iso, h24) { return new Date(iso).toLocaleTimeString('en-AU', { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !h24, timeZone: TZ }).replace(/\s?(am|pm)/i, function (m) { return m.trim().toLowerCase(); }); }
  function fmtLong(iso) { return new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }); }

  function mount(root) {
    if (root.dataset.bkReady) return;
    root.dataset.bkReady = '1';
    var state = { dates: {}, months: [], view: null, date: null, slots: [], h24: false, slot: null };
    var card = el('div', 'bk');
    root.appendChild(card);

    var info = el('div', 'bk-info',
      '<div class="bk-brand">VERUS<span>LINK</span></div>' +
      '<h3>15-Minute Intro Call</h3>' +
      '<p>A quick conversation to see if VerusLink is right for your business.</p>' +
      '<div class="bk-meta"><div>' + ICON.clock + '15 min</div><div>' + ICON.video + 'Google Meet</div><div class="tz">' + ICON.globe + tzLabel() + '</div></div>');
    var cal = el('div', 'bk-cal');
    var times = el('div', 'bk-times');
    card.appendChild(info); card.appendChild(cal); card.appendChild(times);

    function offline() {
      card.innerHTML = '';
      card.appendChild(info);
      var o = el('div', 'bk-done', '<h3>Bookings are open on our booking page</h3><p>The calendar didn&rsquo;t load here. You can still pick a time.</p>');
      var a = el('a', 'bk-go', 'Open the booking page');
      a.href = FALLBACK; a.style.display = 'inline-grid'; a.style.placeItems = 'center'; a.style.textDecoration = 'none'; a.style.maxWidth = '320px'; a.style.marginTop = '18px';
      o.appendChild(a); card.appendChild(o);
    }

    function renderCal() {
      cal.innerHTML = '';
      var v = state.view, y = v.getFullYear(), m = v.getMonth();
      var head = el('div', 'bk-head');
      head.appendChild(el('div', 'bk-month', monthName(v) + ' <span>' + y + '</span>'));
      var nav = el('div', 'bk-nav');
      var idx = state.months.indexOf(y + '-' + m);
      var prev = el('button', '', ICON.left); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous month'); prev.disabled = idx <= 0;
      var next = el('button', '', ICON.right); next.type = 'button'; next.setAttribute('aria-label', 'Next month'); next.disabled = idx < 0 || idx >= state.months.length - 1;
      prev.onclick = function () { state.view = new Date(y, m - 1, 1); renderCal(); };
      next.onclick = function () { state.view = new Date(y, m + 1, 1); renderCal(); };
      nav.appendChild(prev); nav.appendChild(next); head.appendChild(nav); cal.appendChild(head);
      var grid = el('div', 'bk-grid');
      DOW.forEach(function (d) { grid.appendChild(el('div', 'bk-dow', d)); });
      var first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      for (var i = 0; i < lead; i++) grid.appendChild(el('div'));
      var today = ymd(new Date());
      for (var d = 1; d <= days; d++) {
        var key = y + '-' + pad(m + 1) + '-' + pad(d);
        var b = el('button', 'bk-day', String(d)); b.type = 'button';
        var n = state.dates[key];
        if (key === today) b.classList.add('today');
        if (n > 0) {
          b.classList.add('open');
          b.setAttribute('aria-label', fmtLong(key + 'T12:00:00') + ', ' + n + ' times open');
          (function (k) { b.onclick = function () { pick(k); if (window.innerWidth < 900) times.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; })(key);
        } else { b.disabled = true; }
        if (key === state.date) b.classList.add('sel');
        grid.appendChild(b);
      }
      cal.appendChild(grid);
    }

    function renderTimes(loading) {
      times.innerHTML = '';
      var head = el('div', 'bk-thead');
      var dd = state.date ? fromYmd(state.date) : null;
      head.appendChild(el('div', 'bk-tday', dd ? dd.toLocaleDateString('en-AU', { weekday: 'short' }) + ' <span>' + dd.getDate() + ' ' + dd.toLocaleDateString('en-AU', { month: 'short' }) + '</span>' : 'Pick a day'));
      var fmt = el('div', 'bk-fmt');
      [['12h', false], ['24h', true]].forEach(function (o) {
        var b = el('button', o[1] === state.h24 ? 'on' : '', o[0]); b.type = 'button';
        b.onclick = function () { state.h24 = o[1]; renderTimes(); };
        fmt.appendChild(b);
      });
      head.appendChild(fmt); times.appendChild(head);
      if (state.flash) { var fl = el('p', 'bk-err', state.flash); fl.setAttribute('role', 'alert'); fl.style.margin = '0 0 10px'; times.appendChild(fl); }
      var list = el('div', 'bk-list');
      if (loading) { for (var i = 0; i < 5; i++) list.appendChild(el('div', 'bk-skel')); }
      else if (!state.date) { list.appendChild(el('p', 'bk-empty', 'Choose a highlighted day to see open times.')); }
      else if (!state.slots.length) { list.appendChild(el('p', 'bk-empty', 'No times left on this day. Try another.')); }
      else state.slots.forEach(function (s) {
        var b = el('button', 'bk-slot', fmtTime(s.start, state.h24)); b.type = 'button';
        b.onclick = function () { state.slot = s.start; state.flash = ''; form(); };
        list.appendChild(b);
      });
      times.appendChild(list);
    }

    function pick(key) {
      state.date = key; state.slots = [];
      renderCal(); renderTimes(true);
      fetch(API + '/slots?type=' + TYPE + '&date=' + key).then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) { if (state.date !== key) return; state.slots = d.slots || []; renderTimes(); })
        .catch(function () { if (state.date !== key) return; state.slots = []; renderTimes(); });
    }

    function calendarView() {
      card.innerHTML = ''; card.appendChild(info); card.appendChild(cal); card.appendChild(times);
      renderCal(); renderTimes();
    }

    function form(msg) {
      card.innerHTML = ''; card.appendChild(info);
      var f = el('form', 'bk-form'); f.noValidate = true;
      var back = el('button', 'bk-back', '&larr; Change time'); back.type = 'button';
      back.onclick = function () { calendarView(); };
      f.appendChild(back);
      f.appendChild(el('div', 'bk-when', fmtLong(state.slot) + ', ' + fmtTime(state.slot, state.h24)));
      f.insertAdjacentHTML('beforeend',
        '<label for="bkName">Your name</label><input id="bkName" autocomplete="name" required maxlength="80">' +
        '<label for="bkEmail">Email</label><input id="bkEmail" type="email" autocomplete="email" required maxlength="160">' +
        '<label for="bkMsg">Biggest admin headache (optional)</label><textarea id="bkMsg" maxlength="1000"></textarea>');
      var go = el('button', 'bk-go', 'Confirm booking'); go.type = 'submit';
      var err = el('p', 'bk-err'); err.setAttribute('role', 'alert'); if (msg) err.textContent = msg;
      f.appendChild(go); f.appendChild(err);
      card.appendChild(f);
      f.querySelector('#bkName').focus({ preventScroll: true });
      f.onsubmit = function (e) {
        e.preventDefault(); err.textContent = '';
        var name = f.querySelector('#bkName').value.trim(), email = f.querySelector('#bkEmail').value.trim(), message = f.querySelector('#bkMsg').value.trim();
        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Please add your name and a valid email.'; return; }
        go.disabled = true; go.textContent = 'Booking...';
        fetch(API + '/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: TYPE, start: state.slot, name: name, email: email, message: message }) })
          .then(function (r) {
            if (r.ok) return done(name, email);
            if (r.status === 409) { state.slot = null; state.flash = 'That time was just taken. Please pick another.'; loadDates().catch(function () {}); calendarView(); if (state.date) pick(state.date); return; }
            throw 0;
          })
          .catch(function () { go.disabled = false; go.textContent = 'Confirm booking'; err.innerHTML = 'That didn&rsquo;t go through. Try again, or use <a href="' + FALLBACK + '">the booking page</a>.'; });
      };
    }

    function done(name, email) {
      card.innerHTML = ''; card.appendChild(info);
      var d = el('div', 'bk-done');
      d.innerHTML = '<div class="bk-tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3></h3><p class="bk-when"></p><p></p><p>Come with your biggest admin headache and we&rsquo;ll talk through what&rsquo;s possible.</p>';
      d.querySelector('h3').textContent = 'You’re booked, ' + name.split(/\s+/)[0] + '.';
      d.querySelector('.bk-when').textContent = fmtLong(state.slot) + ', ' + fmtTime(state.slot, state.h24);
      d.querySelectorAll('p')[1].textContent = 'The invite and Google Meet link are on their way to ' + email + '.';
      card.appendChild(d);
    }

    function loadDates() {
      return fetch(API + '/dates?type=' + TYPE).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
        var list = (d && d.dates) || [];
        state.dates = {}; state.months = [];
        list.forEach(function (x) {
          state.dates[x.date] = x.availableSlots;
          var dt = fromYmd(x.date), k = dt.getFullYear() + '-' + dt.getMonth();
          if (state.months.indexOf(k) < 0) state.months.push(k);
        });
        var firstOpen = list.filter(function (x) { return x.availableSlots > 0; })[0];
        if (!firstOpen) throw 0;
        if (!state.view) { var f = fromYmd(firstOpen.date); state.view = new Date(f.getFullYear(), f.getMonth(), 1); }
        return firstOpen.date;
      });
    }

    cal.appendChild(el('div', 'bk-skel'));
    renderTimes(true);
    loadDates().then(function (first) { renderCal(); pick(first); }).catch(offline);
  }

  function init() {
    if (!document.getElementById('bk-css')) { var s = document.createElement('style'); s.id = 'bk-css'; s.textContent = css; document.head.appendChild(s); }
    document.querySelectorAll('[data-booking]').forEach(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
