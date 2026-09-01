(function(){
  const firestore = firebase.firestore();
  const storage = firebase.storage();

  // ---------- Static reference data ----------
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const YEAR = 2026;

  const ACCOUNT_TITLES = [
    {id:1, name:'Salaries AND Allowances'},
    {id:2, name:'Staff Benefits AND Incentives'},
    {id:3, name:'SSS, PHIC AND HDMF Premiums'},
    {id:4, name:'Light AND Water'},
    {id:5, name:'Communication'},
    {id:6, name:'Rental Expense'},
    {id:7, name:'Supplies'},
    {id:8, name:'Fuel AND Oil'},
    {id:9, name:'Transportation AND Travel'},
    {id:10, name:'Representation'},
    {id:11, name:'Repairs AND Maintenance'},
    {id:12, name:'Professional Fees'},
    {id:13, name:'Advertising'},
    {id:14, name:'Insurance'},
    {id:15, name:'Donation'},
    {id:16, name:'Taxes AND Licenses'},
    {id:17, name:'Miscellaneous'},
    {id:18, name:'Postage'},
    {id:19, name:'Fixed Asset'},
    {id:20, name:'Purchase'}
  ];
  const ACCOUNT_TITLE_LABEL = Object.fromEntries(ACCOUNT_TITLES.map(t => [t.id, t.name]));

  const BRANCHES = [
    {id:'binan', name:'Biñan (Head Office)'},
    {id:'calamba', name:'Calamba'}
  ];
  const BRANCH_LABEL = Object.fromEntries(BRANCHES.map(b => [b.id, b.name]));

  // Jan-Mar are one combined ledger; Apr onward split per branch, matching
  // the source workbook (CrownADMIN/2026 JS WELLNESS PURCHASED (CONSOLIDATED).xlsx).
  const MONTHS = Array.from({length:12}, (_,i) => {
    const num = i+1;
    return {
      key: `${YEAR}-${String(num).padStart(2,'0')}`,
      num, year: YEAR,
      label: `${MONTH_NAMES[i]} ${YEAR}`,
      quarter: Math.floor(i/3)+1,
      splitByBranch: num >= 4
    };
  });
  const MONTH_BY_KEY = Object.fromEntries(MONTHS.map(m => [m.key, m]));
  const QUARTERS = [1,2,3,4].map(q => ({num:q, months: MONTHS.filter(m => m.quarter === q)}));

  // ---------- State ----------
  let state = null;

  function branchKeysFor(monthMeta){ return monthMeta.splitByBranch ? BRANCHES.map(b=>b.id) : ['combined']; }

  function buildSeedMonths(){
    const seed = window.BIR_LEDGER_SEED || {};
    const months = {};
    MONTHS.forEach(m => {
      const entries = {};
      branchKeysFor(m).forEach(bk => { entries[bk] = []; });
      const s = seed[m.key];
      if (s && s.entries){
        Object.keys(s.entries).forEach(bk => {
          entries[bk] = (s.entries[bk]||[]).map(e => Object.assign({}, e));
        });
      }
      months[m.key] = { entries };
    });
    return months;
  }

  function defaultState(){
    return {
      settings: {
        businessName: 'JS Wellness Corporation',
        tin: '659-275-863-000',
        branches: BRANCHES,
        actingName: ''
      },
      ledger: { months: buildSeedMonths() },
      reminders: [],
      incomeSummary: [],
      birForms: { entries: [] }
    };
  }

  function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  // ---------- Firestore sync ----------
  // Whole-app state kept as one JSON string in a single shared Firestore
  // document, same self-contained pattern the previous version of this
  // module used — every signed-in device sees the same data in real time.
  let docRef = null;
  let saveTimer = null;

  function setSyncStatus(mode, label){
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.className = 'sync-status' + (mode === 'saving' ? ' saving' : mode === 'err' ? ' err' : '');
    el.innerHTML = `<span class="dot"></span>${label || (mode === 'saving' ? 'Saving…' : mode === 'err' ? 'Sync error' : 'Synced')}`;
  }

  function startFirestoreSync(onFirstLoad){
    docRef = firestore.collection('birCompliance').doc('state');
    let firstSnapshot = true;
    docRef.onSnapshot(snap => {
      if (snap.exists && snap.data().json){
        try { state = JSON.parse(snap.data().json); } catch(e){ state = defaultState(); }
      } else {
        state = defaultState();
      }
      if (!state.settings) state.settings = defaultState().settings;
      if (!state.ledger || !state.ledger.months) state.ledger = defaultState().ledger;
      if (!Array.isArray(state.reminders)) state.reminders = [];
      if (!Array.isArray(state.incomeSummary)) state.incomeSummary = [];
      if (!state.birForms || !Array.isArray(state.birForms.entries)) state.birForms = { entries: [] };
      // Backfill any month missing from state (e.g. app updated with new months) without touching existing data.
      MONTHS.forEach(m => {
        if (!state.ledger.months[m.key]){
          const entries = {}; branchKeysFor(m).forEach(bk => entries[bk] = []);
          state.ledger.months[m.key] = { entries };
        }
      });
      if (firstSnapshot){
        firstSnapshot = false;
        onFirstLoad();
      } else if (!snap.metadata.hasPendingWrites){
        renderAll();
        setSyncStatus('saved');
      }
    }, err => {
      console.error(err);
      setSyncStatus('err', 'Sync error — check connection');
    });
  }

  function save(){
    setSyncStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!docRef) return;
      docRef.set({ json: JSON.stringify(state), updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .then(() => setSyncStatus('saved'))
        .catch(err => { console.error(err); setSyncStatus('err', 'Could not save — retrying'); });
    }, 600);
  }

  // ---------- Helpers ----------
  function peso(n){ n = Number(n)||0; return '₱' + n.toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function fmtDate(s){ if(!s) return '—'; const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-PH',{month:'short', day:'numeric', year:'numeric'}); }
  function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function icon(path, extra){ return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${extra||''}<path d="${path}"/></svg>`; }

  // ---------- VAT split & rollups (mirrors the xlsx formulas) ----------
  // VAT base = Invoice / 1.12, Input Tax = VAT base * 0.12, Non-VAT = 0,
  // unless the entry is explicitly marked Non-VAT — then the full invoice
  // amount goes to Non-VAT and VAT base/Input Tax are 0.
  function splitVat(invoiceAmount, nonVatOverride){
    const amt = Number(invoiceAmount)||0;
    if (nonVatOverride || !amt) return {vatBase:0, nonVat:amt, inputTax:0};
    const vatBase = amt/1.12;
    return {vatBase, nonVat:0, inputTax: vatBase*0.12};
  }

  function emptyTotals(){ return {invoiceAmount:0, vatBase:0, nonVat:0, inputTax:0}; }
  function addInto(dst, amt, split){
    dst.invoiceAmount += amt; dst.vatBase += split.vatBase; dst.nonVat += split.nonVat; dst.inputTax += split.inputTax;
  }

  // SUMIF-equivalent: group a flat entry list by account title, 20 rows + Total.
  function summarizeEntries(entries){
    const byTitle = {};
    ACCOUNT_TITLES.forEach(t => byTitle[t.id] = emptyTotals());
    const total = emptyTotals();
    entries.forEach(e => {
      const amt = Number(e.invoiceAmount)||0;
      const split = splitVat(amt, e.nonVatOverride);
      const row = byTitle[e.accountTitleId] || (byTitle[e.accountTitleId] = emptyTotals());
      addInto(row, amt, split);
      addInto(total, amt, split);
    });
    return {byTitle, total};
  }

  function monthEntries(monthKey, branchKey){
    const m = state.ledger.months[monthKey];
    if (!m) return [];
    if (branchKey) return m.entries[branchKey] || [];
    return Object.values(m.entries).flat();
  }

  function monthTotal(monthKey){ return summarizeEntries(monthEntries(monthKey)).total; }

  // ---------- Reminders (Upcoming Payments + Calendar) ----------
  const RECURRENCE_LABEL = {once:'One-time', monthly:'Monthly', quarterly:'Quarterly', yearly:'Yearly'};
  function daysInMonth(y, m){ return new Date(y, m, 0).getDate(); } // m is 1-indexed
  function dateKey(y, m, d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

  // Generates every occurrence date for a reminder rule within `year`, matching
  // its recurrence pattern (day-of-month clamped to short months, e.g. an
  // anchor of the 31st lands on Feb 28).
  function generateOccurrenceDates(rule, year){
    year = year || YEAR;
    const [ay, am, ad] = rule.anchorDate.split('-').map(Number);
    const dates = [];
    if (rule.recurrence === 'once'){
      if (ay === year) dates.push(rule.anchorDate);
    } else if (rule.recurrence === 'yearly'){
      if (ay <= year) dates.push(dateKey(year, am, Math.min(ad, daysInMonth(year, am))));
    } else if (ay === year){
      // Reminders are only ever created via the calendar, which is scoped to
      // `year`, so the anchor's year always matches — this is the live path.
      const step = rule.recurrence === 'quarterly' ? 3 : 1;
      for (let m = am; m <= 12; m += step){
        dates.push(dateKey(year, m, Math.min(ad, daysInMonth(year, m))));
      }
    }
    return dates.sort();
  }

  function occurrenceStatus(rule, dateStr){
    const override = rule.occurrenceStatus && rule.occurrenceStatus[dateStr];
    if (override === 'settled' || override === 'cancelled') return override;
    const [y,m,d] = dateStr.split('-').map(Number);
    const due = new Date(y, m-1, d); due.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    const diffDays = Math.round((due - today) / 86400000);
    if (diffDays < 0) return 'overdue';
    if (diffDays <= 5) return 'approaching';
    return 'pending';
  }

  const REMINDER_STATUS_META = {
    pending:     {label:'For Payment', cls:'rem-pending'},
    approaching: {label:'For Payment', cls:'rem-approaching'},
    overdue:     {label:'For Payment', cls:'rem-overdue'},
    settled:     {label:'Settled', cls:'rem-settled'},
    cancelled:   {label:'Cancelled', cls:'rem-cancelled'}
  };

  // Flat, sorted list of every occurrence across every rule for `year` — the
  // single source both the Upcoming Payments list and the calendar read from.
  function allOccurrences(year){
    const out = [];
    (state.reminders||[]).forEach(rule => {
      generateOccurrenceDates(rule, year).forEach(date => {
        out.push({ruleId: rule.id, date, particulars: rule.particulars, recurrence: rule.recurrence, status: occurrenceStatus(rule, date)});
      });
    });
    return out.sort((a,b) => a.date.localeCompare(b.date));
  }

  function getRule(ruleId){ return (state.reminders||[]).find(r => r.id === ruleId); }

  function renderReminderBadge(status){
    const meta = REMINDER_STATUS_META[status] || REMINDER_STATUS_META.pending;
    return `<span class="badge rem-badge ${meta.cls}">${meta.label}</span>`;
  }

  // ---------- Modal ----------
  function showModal(title, bodyHtml, actions){
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
    overlay.innerHTML = `<div class="modal-box"><div class="mh"><h3>${title}</h3><button class="modal-close" id="modalX">${icon('M18 6 6 18M6 6l12 12')}</button></div><div class="mb">${bodyHtml}</div><div class="mf" id="modalFoot"></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('modalX').addEventListener('click', closeModal);
    const foot = document.getElementById('modalFoot');
    actions.forEach(a => {
      const b = document.createElement('button'); b.className = 'btn ' + a.cls; b.textContent = a.label;
      b.addEventListener('click', a.action); foot.appendChild(b);
    });
  }
  function closeModal(){ const o = document.getElementById('modalOverlay'); if (o) o.remove(); }

  // ---------- File attachment (optional, e.g. a receipt photo/PDF) ----------
  // Uploads to Firebase Storage rather than embedding base64 in the synced
  // Firestore document, which has a 1MB size limit.
  function uploadFile(file, pathPrefix, cb){
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `birCompliance/${pathPrefix}/${Date.now()}_${safeName}`;
    const ref = storage.ref().child(path);
    const task = ref.put(file);
    task.on('state_changed', null, (err) => {
      alert('Upload failed: ' + (err.message || err.code || 'unknown error'));
    }, () => {
      ref.getDownloadURL().then(url => {
        cb({name: file.name, size: file.size, path, url});
      });
    });
  }

  // ============================================================
  // TOP-LEVEL TABS: Dashboard / Income Summary / Purchases
  // ============================================================
  const TOP_TABS = [['dashboard','Dashboard'], ['income','Income Summary'], ['purchases','Purchases'], ['birforms','BIR Forms']];
  let currentView = 'dashboard';

  function renderViewTabs(){
    const nav = document.getElementById('viewTabs');
    nav.innerHTML = '';
    TOP_TABS.forEach(([id,label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(currentView === id));
      b.textContent = label;
      b.addEventListener('click', () => { currentView = id; renderAll(); });
      nav.appendChild(b);
    });
  }

  function renderAll(){
    renderViewTabs();
    document.getElementById('viewTitle').textContent = TOP_TABS.find(([id])=>id===currentView)[1];
    const content = document.getElementById('content');
    content.innerHTML = '';
    ({dashboard: renderDashboard, income: renderIncomeSummary, purchases: renderPurchases, birforms: renderBirForms})[currentView](content);
  }

  // ---------- Dashboard: Upcoming Payments + Reminder Calendar ----------
  const today = new Date();
  let calendarYear = YEAR;
  let calendarMonth = (today.getFullYear() === YEAR) ? (today.getMonth()+1) : 1;

  function renderDashboard(el){
    el.innerHTML = `
      <div class="card" id="upcomingCard">
        <div class="card-head"><h3>Upcoming Payments</h3><span class="badge b-neutral" id="upcomingCount"></span></div>
        <div id="upcomingList"></div>
      </div>
      <div class="card" id="calendarCard">
        <div class="card-head">
          <h3 id="calTitle"></h3>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" id="calPrev">${icon('M15 18l-6-6 6-6')}</button>
            <button class="btn btn-ghost btn-sm" id="calNext">${icon('M9 18l6-6-6-6')}</button>
          </div>
        </div>
        <div id="calendarGrid"></div>
      </div>
    `;
    renderUpcomingList(el.querySelector('#upcomingList'), el.querySelector('#upcomingCount'));
    renderCalendar(el.querySelector('#calendarGrid'), el.querySelector('#calTitle'));
    el.querySelector('#calPrev').addEventListener('click', () => { shiftCalendarMonth(-1); renderAll(); });
    el.querySelector('#calNext').addEventListener('click', () => { shiftCalendarMonth(1); renderAll(); });
  }

  function shiftCalendarMonth(delta){
    calendarMonth += delta;
    if (calendarMonth < 1){ calendarMonth = 12; calendarYear -= 1; }
    if (calendarMonth > 12){ calendarMonth = 1; calendarYear += 1; }
  }

  function renderUpcomingList(el, countEl){
    const occ = allOccurrences(YEAR).filter(o => {
      if (o.status === 'settled' || o.status === 'cancelled') return false;
      const [y,m,d] = o.date.split('-').map(Number);
      const diffDays = Math.round((new Date(y,m-1,d) - new Date(today.getFullYear(),today.getMonth(),today.getDate())) / 86400000);
      return diffDays <= 90; // overdue items have negative diffDays, always included
    });
    countEl.textContent = occ.length;
    if (!occ.length){
      el.innerHTML = `<div class="empty-note">No upcoming payments. Add a reminder from the calendar below.</div>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="simple-table"><tbody>
      ${occ.map(o => `
        <tr class="upcoming-row" data-rule="${o.ruleId}" data-date="${o.date}" style="cursor:pointer;">
          <td>${renderReminderBadge(o.status)}</td>
          <td style="font-weight:700;">${o.particulars}</td>
          <td class="mono">${fmtDate(o.date)}</td>
          <td><span class="badge b-neutral">${RECURRENCE_LABEL[o.recurrence]}</span></td>
        </tr>
      `).join('')}
    </tbody></table></div>`;
    el.querySelectorAll('.upcoming-row').forEach(row => row.addEventListener('click', () => {
      openReminderDetailModal(row.dataset.rule, row.dataset.date);
    }));
  }

  function renderCalendar(el, titleEl){
    titleEl.textContent = `${MONTH_NAMES[calendarMonth-1]} ${calendarYear}`;
    const occ = allOccurrences(calendarYear).filter(o => o.date.slice(0,7) === `${calendarYear}-${String(calendarMonth).padStart(2,'0')}`);
    const byDate = {};
    occ.forEach(o => { (byDate[o.date] = byDate[o.date]||[]).push(o); });

    const firstWeekday = new Date(calendarYear, calendarMonth-1, 1).getDay();
    const totalDays = daysInMonth(calendarYear, calendarMonth);
    const cells = [];
    for (let i=0;i<firstWeekday;i++) cells.push(null);
    for (let d=1; d<=totalDays; d++) cells.push(d);

    const weekdayHeader = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(w => `<div class="cal-weekday">${w}</div>`).join('');
    const dayCells = cells.map(d => {
      if (d === null) return `<div class="cal-cell cal-cell-empty"></div>`;
      const dateStr = dateKey(calendarYear, calendarMonth, d);
      const items = byDate[dateStr] || [];
      const isToday = dateStr === dateKey(today.getFullYear(), today.getMonth()+1, today.getDate());
      return `<div class="cal-cell${isToday?' cal-cell-today':''}" data-date="${dateStr}">
        <div class="cal-cell-head"><span class="cal-daynum">${d}</span><button class="cal-add-btn" data-add="${dateStr}" title="Add reminder">+</button></div>
        <div class="cal-chips">${items.map(o => `<div class="cal-chip rem-${occurrenceStatusClassOnly(o.status)}" data-rule="${o.ruleId}" data-date="${o.date}" title="${o.particulars}">${o.particulars}</div>`).join('')}</div>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="cal-grid">${weekdayHeader}${dayCells}</div>`;
    el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openNewReminderModal(b.dataset.add); }));
    el.querySelectorAll('.cal-chip').forEach(c => c.addEventListener('click', (e) => { e.stopPropagation(); openReminderDetailModal(c.dataset.rule, c.dataset.date); }));
  }
  function occurrenceStatusClassOnly(status){ return (REMINDER_STATUS_META[status] || REMINDER_STATUS_META.pending).cls.replace('rem-',''); }

  function openNewReminderModal(dateStr){
    showModal('Add reminder', `
      <div class="field"><label>Date</label><input class="fctl" id="rmDate" type="date" value="${dateStr}" min="${YEAR}-01-01" max="${YEAR}-12-31"></div>
      <div class="field"><label>Particulars</label><input class="fctl" id="rmPart" placeholder="e.g. BIR 1601-C Filing"></div>
      <div class="field"><label>Recurrence</label><select class="fctl" id="rmRecur">
        <option value="once">One-time</option>
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
        <option value="yearly">Yearly</option>
      </select></div>
    `, [
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const particulars = document.getElementById('rmPart').value.trim();
        if (!particulars){ alert('Particulars is required.'); return; }
        state.reminders.push({
          id: uid(),
          particulars,
          recurrence: document.getElementById('rmRecur').value,
          anchorDate: document.getElementById('rmDate').value || dateStr,
          occurrenceStatus: {}
        });
        save(); closeModal(); renderAll();
      }}
    ]);
  }

  function openReminderDetailModal(ruleId, date){
    const rule = getRule(ruleId);
    if (!rule) return;
    const status = occurrenceStatus(rule, date);
    showModal('Reminder details', `
      <div class="field"><label>Particulars</label><div style="font-weight:700;font-size:14px;">${rule.particulars}</div></div>
      <div class="field"><label>Date</label><div class="mono">${fmtDate(date)}</div></div>
      <div class="field"><label>Recurrence</label><div>${RECURRENCE_LABEL[rule.recurrence]}</div></div>
      <div class="field"><label>Status</label><div>${renderReminderBadge(status)}</div></div>
    `, [
      {label:'Delete reminder', cls:'btn-danger', action: () => {
        state.reminders = state.reminders.filter(r => r.id !== ruleId);
        save(); closeModal(); renderAll();
      }},
      {label:'Cancel', cls:'btn-ghost', action: () => {
        rule.occurrenceStatus = rule.occurrenceStatus || {};
        rule.occurrenceStatus[date] = 'cancelled';
        save(); closeModal(); renderAll();
      }},
      {label:'Settled', cls:'btn-primary', action: () => {
        rule.occurrenceStatus = rule.occurrenceStatus || {};
        rule.occurrenceStatus[date] = 'settled';
        save(); closeModal(); renderAll();
      }}
    ]);
  }

  // ---------- Income Summary (auto-pulled from Daily Income Report's Sales Invoice Summary, plus manual entries) ----------
  const DAILY_SALES_PREFIX = 'crownDailySales_';

  // Same computation invoice-report.js uses (not shared/exported anywhere in
  // this codebase — every report page keeps its own copy of this helper).
  function getNetSaleAmount(sale){
    if (Number.isFinite(Number(sale?.netAmount))) return Math.max(0, Number(sale.netAmount));
    const gross = Number.isFinite(Number(sale?.grossAmount)) ? Number(sale.grossAmount)
      : (Array.isArray(sale?.services) ? sale.services.reduce((s,i) => s + (Number(i?.amount)||0), 0) : 0);
    const voucher = Math.max(0, Number(sale?.voucherValue)||0);
    return Math.max(0, gross - voucher);
  }
  // Service master list lives under its own localStorage key (also synced by
  // firebase-sync.js like everything else) — maps a service's exact name to
  // its category (e.g. "Head Spa", "Massage", "Combo"), same lookup
  // getServiceCategoryMap() builds in script.js.
  const SERVICE_MASTER_KEY = 'crownServiceMasterList';
  function getServiceCategoryMap(){
    const map = {};
    try {
      const raw = localStorage.getItem(SERVICE_MASTER_KEY);
      const list = raw ? JSON.parse(raw) : [];
      (Array.isArray(list) ? list : []).forEach(item => {
        const name = typeof item === 'string' ? item : item?.name;
        const category = typeof item === 'string' ? '' : item?.category;
        if (name) map[String(name).trim().toLowerCase()] = category || 'Other';
      });
    } catch(e){}
    return map;
  }

  // User-specified display mapping: Head Spa -> "Head Spa", Massage ->
  // "Massage", Package (or a sale mixing both) -> "Head Spa + Massage",
  // anything else -> "Others".
  function salesServicesLabel(sale, categoryMap){
    if (!Array.isArray(sale?.services) || !sale.services.length) return 'Others';
    const cats = new Set(sale.services.map(item => String(categoryMap[String(item?.name||'').trim().toLowerCase()] || 'Other').trim().toLowerCase()));
    if (cats.has('package')) return 'Head Spa + Massage';
    const hasHeadSpa = cats.has('head spa');
    const hasMassage = cats.has('massage');
    if (hasHeadSpa && hasMassage) return 'Head Spa + Massage';
    if (hasHeadSpa) return 'Head Spa';
    if (hasMassage) return 'Massage';
    return 'Others';
  }

  const INCOME_CATEGORY_OPTIONS = ['Head Spa', 'Massage', 'Head Spa + Massage', 'Others'];

  // Daily Income Report branch names are whatever free text an Admin typed
  // into Master Lists > Branches, not necessarily an exact match to the
  // 'Biñan (Head Office)'/'Calamba' labels configured here — match loosely
  // by keyword instead of requiring an exact string.
  function normalizeBranch(name){
    const n = String(name||'').trim().toLowerCase();
    if (n.includes('binan') || n.includes('biñan')) return 'binan';
    if (n.includes('calamba')) return 'calamba';
    return 'other';
  }

  // Reads the same crownDailySales_<branch>_<date> records invoice-report.js
  // reads, synced into localStorage by firebase-sync.js — no separate
  // Firestore call needed.
  function collectDailySalesIncome(year){
    const out = [];
    const categoryMap = getServiceCategoryMap();
    for (let i=0; i<localStorage.length; i++){
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DAILY_SALES_PREFIX)) continue;
      const dateStr = key.slice(-10);
      if (!dateStr.startsWith(String(year))) continue;
      let record;
      try { record = JSON.parse(localStorage.getItem(key)); } catch(e){ continue; }
      if (!record || !Array.isArray(record.rows)) continue;
      const branch = normalizeBranch(record.branch);
      record.rows.forEach((sale, idx) => {
        if (sale?.settled === false) return;
        if (sale?.issueInvoice !== true) return;
        out.push({
          id: 'auto-' + key + '-' + idx,
          source: 'auto',
          branch,
          date: record.date || dateStr,
          salesServices: salesServicesLabel(sale, categoryMap),
          client: sale?.client || '—',
          invoiceNumber: sale?.invoiceNumber || '',
          tin: sale?.tinNumber || '',
          amount: getNetSaleAmount(sale)
        });
      });
    }
    return out;
  }

  function allIncomeEntries(){
    const auto = collectDailySalesIncome(YEAR);
    const manual = (state.incomeSummary||[]).map(e => Object.assign({source:'manual'}, e));
    return auto.concat(manual).sort((a,b) => (a.date||'').localeCompare(b.date||''));
  }
  function incomeTotal(entries){ return entries.reduce((s,e) => s + (Number(e.amount)||0), 0); }

  let incomeMonthKey = (new Date().getFullYear() === YEAR) ? MONTH_BY_KEY[`${YEAR}-${String(new Date().getMonth()+1).padStart(2,'0')}`].key : MONTHS[0].key;

  function incomeTableHtml(label, entries){
    return `
      <div class="card">
        <div class="qtr-branch-head">${label}</div>
        <div class="table-wrap"><table class="simple-table ledger-table"><thead><tr>
          <th>Date</th><th>Sales / Services</th><th>Client</th><th>Invoice Number</th><th>TIN Number</th><th>Amount</th><th></th>
        </tr></thead><tbody>
          ${entries.map(e => `
            <tr>
              <td class="mono">${fmtDate(e.date)}</td>
              <td>${e.salesServices || 'Others'}</td>
              <td>${e.client || '—'}</td>
              <td class="mono">${e.invoiceNumber || '—'}</td>
              <td class="mono">${e.tin || '—'}</td>
              <td class="mono num">${peso(e.amount)}</td>
              <td>${e.source === 'manual' ? `<button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button>` : ''}</td>
            </tr>
          `).join('')}
          <tr class="summary-total-row"><td colspan="5">Subtotal — ${label}</td><td class="mono num">${peso(incomeTotal(entries))}</td><td></td></tr>
        </tbody></table></div>
        ${entries.length ? '' : `<div class="empty-note">No invoiced sales for ${label} this month.</div>`}
      </div>
    `;
  }

  // ---------- Income Summary: Monthly / Quarterly / Yearly sub-tabs ----------
  let incomeSubTab = 'monthly';
  let incomeQuarter = 1;

  function renderIncomeSummary(el){
    const tabs = [['monthly','Monthly Summary'], ['quarterly','Quarterly Summary'], ['yearly','Year Summary']];
    el.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k,l]) => `<button role="tab" data-subtab="${k}" aria-selected="${incomeSubTab===k}">${l}</button>`).join('')}</div><div id="incomeBody"></div>`;
    el.querySelectorAll('[role="tab"]').forEach(b => b.addEventListener('click', () => { incomeSubTab = b.dataset.subtab; renderAll(); }));
    const body = document.getElementById('incomeBody');
    ({monthly: renderIncomeMonthlyTab, quarterly: renderIncomeQuarterlyTab, yearly: renderIncomeYearTab})[incomeSubTab](body);
  }

  // Groups a list of income entries into per-branch totals (Biñan / Calamba / Other Branches).
  function groupIncomeByBranch(entries){
    const g = {binan:0, calamba:0, other:0};
    entries.forEach(e => {
      const b = (e.branch === 'binan' || e.branch === 'calamba') ? e.branch : 'other';
      g[b] += Number(e.amount)||0;
    });
    g.total = g.binan + g.calamba + g.other;
    return g;
  }

  function renderIncomeQuarterlyTab(el){
    const entriesAll = allIncomeEntries();
    const q = QUARTERS.find(x => x.num === incomeQuarter);
    const monthRows = q.months.map(m => ({m, g: groupIncomeByBranch(entriesAll.filter(e => (e.date||'').slice(0,7) === m.key))}));
    const qTotal = monthRows.reduce((acc,{g}) => { acc.binan+=g.binan; acc.calamba+=g.calamba; acc.other+=g.other; acc.total+=g.total; return acc; }, {binan:0,calamba:0,other:0,total:0});

    el.innerHTML = `
      <div class="ledger-subnav">
        <select id="incQSelect" class="form-select form-select-sm"></select>
      </div>
      <div class="card">
        <div class="card-head"><h3>Q${q.num} ${YEAR} — Sales Invoice Income by Month</h3></div>
        <div class="table-wrap"><table class="simple-table"><thead><tr><th>Month</th><th>Biñan (Head Office)</th><th>Calamba</th><th>Other Branches</th><th>Total</th></tr></thead><tbody>
          ${monthRows.map(({m,g}) => `<tr><td>${m.label}</td><td class="mono num">${peso(g.binan)}</td><td class="mono num">${peso(g.calamba)}</td><td class="mono num">${peso(g.other)}</td><td class="mono num">${peso(g.total)}</td></tr>`).join('')}
          <tr class="summary-total-row"><td>Total</td><td class="mono num">${peso(qTotal.binan)}</td><td class="mono num">${peso(qTotal.calamba)}</td><td class="mono num">${peso(qTotal.other)}</td><td class="mono num">${peso(qTotal.total)}</td></tr>
        </tbody></table></div>
      </div>
    `;
    const sel = el.querySelector('#incQSelect');
    [1,2,3,4].forEach(n => {
      const o = document.createElement('option'); o.value = n; o.textContent = `Q${n} ${YEAR}`;
      if (n === incomeQuarter) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { incomeQuarter = Number(sel.value); renderAll(); });
  }

  function renderIncomeYearTab(el){
    const entriesAll = allIncomeEntries();
    const rows = QUARTERS.map(q => ({ q: q.num, g: groupIncomeByBranch(entriesAll.filter(e => q.months.some(m => m.key === (e.date||'').slice(0,7)))) }));
    const grand = rows.reduce((acc,{g}) => { acc.binan+=g.binan; acc.calamba+=g.calamba; acc.other+=g.other; acc.total+=g.total; return acc; }, {binan:0,calamba:0,other:0,total:0});
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${state.settings.businessName} — Summary of ${YEAR} Sales Invoice Income</h3></div>
        <div class="table-wrap"><table class="simple-table"><thead><tr><th>Quarter</th><th>Biñan (Head Office)</th><th>Calamba</th><th>Other Branches</th><th>Total</th></tr></thead><tbody>
          ${rows.map(({q,g}) => `<tr><td>Q${q}</td><td class="mono num">${peso(g.binan)}</td><td class="mono num">${peso(g.calamba)}</td><td class="mono num">${peso(g.other)}</td><td class="mono num">${peso(g.total)}</td></tr>`).join('')}
          <tr class="summary-total-row"><td>Total</td><td class="mono num">${peso(grand.binan)}</td><td class="mono num">${peso(grand.calamba)}</td><td class="mono num">${peso(grand.other)}</td><td class="mono num">${peso(grand.total)}</td></tr>
        </tbody></table></div>
      </div>
    `;
  }

  function renderIncomeMonthlyTab(el){
    const monthEntries = allIncomeEntries().filter(e => (e.date||'').slice(0,7) === incomeMonthKey);
    const binanEntries = monthEntries.filter(e => e.branch === 'binan');
    const calambaEntries = monthEntries.filter(e => e.branch === 'calamba');
    const otherEntries = monthEntries.filter(e => e.branch !== 'binan' && e.branch !== 'calamba');

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Sales Invoice Summary</h3>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" id="exportIncomePdfBtn">${icon('M6 2h9l5 5v15H6zM14 2v6h6')} Export to PDF</button>
            <button class="btn btn-primary btn-sm" id="addIncomeBtn">+ Add Entry</button>
          </div>
        </div>
        <div class="ledger-subnav" style="margin-top:-4px;margin-bottom:0;">
          <select id="incomeMonthSelect" class="form-select form-select-sm"></select>
        </div>
      </div>
      ${incomeTableHtml('Biñan (Head Office)', binanEntries)}
      ${incomeTableHtml('Calamba', calambaEntries)}
      ${otherEntries.length ? incomeTableHtml('Other Branches', otherEntries) : ''}
      <div class="card">
        <div class="totals-strip" style="border-top:none;margin-top:0;padding-top:0;">
          <div class="t-item"><div class="l">Grand Total — ${MONTH_BY_KEY[incomeMonthKey].label}</div><div class="v mono">${peso(incomeTotal(monthEntries))}</div></div>
        </div>
      </div>
    `;
    const monthSelect = el.querySelector('#incomeMonthSelect');
    MONTHS.forEach(m => {
      const o = document.createElement('option'); o.value = m.key; o.textContent = `${m.label} · Q${m.quarter}`;
      if (m.key === incomeMonthKey) o.selected = true;
      monthSelect.appendChild(o);
    });
    monthSelect.addEventListener('change', () => { incomeMonthKey = monthSelect.value; renderAll(); });

    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openIncomeModal(state.incomeSummary.find(x => x.id === b.dataset.edit))));
    el.querySelector('#addIncomeBtn').addEventListener('click', () => openIncomeModal(null));
    el.querySelector('#exportIncomePdfBtn').addEventListener('click', () => exportIncomePDF({binan: binanEntries, calamba: calambaEntries, other: otherEntries}));
  }

  function openIncomeModal(entry){
    const isNew = !entry;
    showModal(isNew ? 'Add sales invoice entry' : 'Edit sales invoice entry', `
      <div class="field"><label>Date</label><input class="fctl" id="inDate" type="date" value="${entry?entry.date:todayStr()}" min="${YEAR}-01-01" max="${YEAR}-12-31"></div>
      <div class="field"><label>Branch</label><select class="fctl" id="inBranch">${BRANCHES.map(b => `<option value="${b.id}" ${entry&&entry.branch===b.id?'selected':''}>${b.name}</option>`).join('')}</select></div>
      <div class="field"><label>Sales / Services</label><select class="fctl" id="inSvc">${INCOME_CATEGORY_OPTIONS.map(c => `<option value="${c}" ${entry&&entry.salesServices===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Client</label><input class="fctl" id="inClient" value="${entry?entry.client:''}"></div>
      <div class="field"><label>Invoice Number</label><input class="fctl" id="inInv" value="${entry?entry.invoiceNumber:''}"></div>
      <div class="field"><label>TIN Number</label><input class="fctl" id="inTin" value="${entry?entry.tin:''}"></div>
      <div class="field money-field"><label>Amount</label><input class="fctl" id="inAmt" type="number" step="0.01" min="0" value="${entry?entry.amount:0}"></div>
    `, [
      ...(isNew?[]:[{label:'Delete', cls:'btn-danger', action: () => {
        state.incomeSummary = state.incomeSummary.filter(x => x.id !== entry.id);
        save(); closeModal(); renderAll();
      }}]),
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const data = {
          date: document.getElementById('inDate').value || todayStr(),
          branch: document.getElementById('inBranch').value,
          salesServices: document.getElementById('inSvc').value,
          client: document.getElementById('inClient').value,
          invoiceNumber: document.getElementById('inInv').value,
          tin: document.getElementById('inTin').value,
          amount: parseFloat(document.getElementById('inAmt').value)||0
        };
        if (isNew) state.incomeSummary.push(Object.assign({id:uid()}, data));
        else Object.assign(entry, data);
        save(); closeModal(); renderAll();
      }}
    ]);
  }

  // jsPDF's built-in helvetica font has no ₱ glyph — use "PHP" for anything
  // drawn on the PDF (screen display keeps using peso()), same convention
  // as the existing Sales Invoice Summary PDF export (invoice-report.js).
  function pesoPdf(amount){ return 'PHP ' + (Number(amount)||0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}); }

  function exportIncomePDF(groups){
    if (!window.jspdf || !window.jspdf.jsPDF){
      alert('PDF library is unavailable. Please check your internet connection and reload the page.');
      return;
    }
    const monthEntries = allIncomeEntries().filter(e => (e.date||'').slice(0,7) === incomeMonthKey);
    groups = groups || {
      binan: monthEntries.filter(e => e.branch === 'binan'),
      calamba: monthEntries.filter(e => e.branch === 'calamba'),
      other: monthEntries.filter(e => e.branch !== 'binan' && e.branch !== 'calamba')
    };
    const sections = [['Biñan (Head Office)', groups.binan||[]], ['Calamba', groups.calamba||[]]];
    if ((groups.other||[]).length) sections.push(['Other Branches', groups.other]);
    const btn = document.getElementById('exportIncomePdfBtn');
    btn.disabled = true; btn.textContent = 'Generating PDF...';
    try {
      const jsPDF = window.jspdf.jsPDF;
      const doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a4', compress:true});
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const NAVY = [11,24,73], GOLD = [232,179,33], GOLD_SOFT = [255,244,207], CREAM = [244,243,236], MUTED = [110,116,132];

      function drawHeader(){
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, pageWidth, 30, 'F');
        doc.setFillColor(...GOLD);
        doc.rect(0, 30, pageWidth, 1.2, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text(state.settings.businessName.toUpperCase(), 14, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(200, 206, 226);
        doc.text(`TIN: ${state.settings.tin}`, 14, 18);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.text('Sales Invoice Summary', pageWidth - 14, 12, {align:'right'});
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(200, 206, 226);
        doc.text(MONTH_BY_KEY[incomeMonthKey].label, pageWidth - 14, 18, {align:'right'});
      }
      drawHeader();

      // ---- KPI summary strip ----
      const grandTotal = sections.reduce((s,[,entries]) => s + entries.reduce((s2,e) => s2 + (Number(e.amount)||0), 0), 0);
      const cardData = sections.map(([label, entries]) => [label, entries.reduce((s,e)=>s+(Number(e.amount)||0),0), entries.length]);
      const cardGap = 5, cardsY = 37, cardH = 20;
      const cardW = (pageWidth - 28 - cardGap*cardData.length) / (cardData.length + 1);
      let cx = 14;
      cardData.forEach(([label, total, count]) => {
        doc.setFillColor(...CREAM);
        doc.roundedRect(cx, cardsY, cardW, cardH, 2, 2, 'F');
        doc.setDrawColor(...GOLD);
        doc.setLineWidth(0.3);
        doc.roundedRect(cx, cardsY, cardW, cardH, 2, 2, 'S');
        doc.setFont('helvetica','bold');
        doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text(label.toUpperCase(), cx + 4, cardsY + 6);
        doc.setFont('helvetica','bold');
        doc.setFontSize(11.5);
        doc.setTextColor(...NAVY);
        doc.text(pesoPdf(total), cx + 4, cardsY + 13);
        doc.setFont('helvetica','normal');
        doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text(`${count} invoice${count===1?'':'s'}`, cx + 4, cardsY + 17.5);
        cx += cardW + cardGap;
      });
      doc.setFillColor(...NAVY);
      doc.roundedRect(cx, cardsY, cardW, cardH, 2, 2, 'F');
      doc.setFont('helvetica','bold');
      doc.setFontSize(7);
      doc.setTextColor(210, 216, 236);
      doc.text('GRAND TOTAL', cx + 4, cardsY + 6);
      doc.setFont('helvetica','bold');
      doc.setFontSize(12.5);
      doc.setTextColor(255,255,255);
      doc.text(pesoPdf(grandTotal), cx + 4, cardsY + 14);

      let cursorY = cardsY + cardH + 10;
      const columnStyles = {
        0: {cellWidth:20}, 1: {cellWidth:30}, 2: {cellWidth:32},
        3: {cellWidth:26, halign:'center'}, 4: {cellWidth:34, halign:'center'}, 5: {cellWidth:26, halign:'right'}
      };
      sections.forEach(([label, entries]) => {
        if (cursorY > pageHeight - 50){ doc.addPage(); cursorY = 38; }

        // Section band
        doc.setFillColor(...GOLD_SOFT);
        doc.rect(14, cursorY, pageWidth - 28, 8, 'F');
        doc.setFont('helvetica','bold');
        doc.setFontSize(10);
        doc.setTextColor(...NAVY);
        doc.text(label, 17, cursorY + 5.5);
        doc.setFont('helvetica','normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`${entries.length} invoice${entries.length===1?'':'s'}`, pageWidth - 17, cursorY + 5.5, {align:'right'});
        cursorY += 11;

        const subtotal = entries.reduce((s,e) => s + (Number(e.amount)||0), 0);
        const tableRows = entries.length
          ? entries.map(e => [fmtDate(e.date), e.salesServices||'Others', e.client||'—', e.invoiceNumber||'—', e.tin||'—', pesoPdf(e.amount)])
          : [['—','No invoiced sales this month','—','—','—', pesoPdf(0)]];

        doc.autoTable({
          startY: cursorY,
          head: [['Date','Sales / Services','Client','Invoice Number','TIN Number','Amount']],
          body: tableRows,
          foot: [['','','','','Subtotal', pesoPdf(subtotal)]],
          theme: 'grid',
          margin: {top:34, left:14, right:14, bottom:18},
          styles: {font:'helvetica', fontSize:8.7, cellPadding:{top:3.5,bottom:3.5,left:3,right:3}, valign:'middle', overflow:'linebreak', textColor:[32,43,60], lineColor:[224,227,235], lineWidth:0.15},
          headStyles: {fillColor:NAVY, textColor:[255,255,255], fontStyle:'bold', fontSize:8, halign:'left'},
          footStyles: {fillColor:GOLD_SOFT, textColor:NAVY, fontStyle:'bold', halign:'right'},
          alternateRowStyles: {fillColor:[250,249,246]},
          columnStyles,
          didDrawPage: function(data){
            if (data.pageNumber > 1) drawHeader();
            const pageCount = doc.internal.getNumberOfPages();
            doc.setDrawColor(224,227,235);
            doc.setLineWidth(0.2);
            doc.line(14, pageHeight-14, pageWidth-14, pageHeight-14);
            doc.setTextColor(...MUTED);
            doc.setFont('helvetica','normal');
            doc.setFontSize(7.5);
            doc.text(`Generated ${new Date().toLocaleDateString('en-PH', {month:'long', day:'numeric', year:'numeric'})}`, 14, pageHeight-9);
            doc.text('CrownOS — BIR Compliance Desk', pageWidth/2, pageHeight-9, {align:'center'});
            doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth-14, pageHeight-9, {align:'right'});
          }
        });
        cursorY = doc.lastAutoTable.finalY + 12;
      });

      if (cursorY > pageHeight - 28){ doc.addPage(); cursorY = 38; }
      doc.setFillColor(...NAVY);
      doc.roundedRect(14, cursorY, pageWidth - 28, 14, 2, 2, 'F');
      doc.setFont('helvetica','bold');
      doc.setFontSize(10);
      doc.setTextColor(210, 216, 236);
      doc.text('GRAND TOTAL — ALL BRANCHES', 20, cursorY + 6);
      doc.setFontSize(13);
      doc.setTextColor(255,255,255);
      doc.text(pesoPdf(grandTotal), pageWidth - 20, cursorY + 9.5, {align:'right'});

      doc.save(`${state.settings.businessName} - Sales Invoice Summary - ${MONTH_BY_KEY[incomeMonthKey].label}.pdf`);
    } catch(err){
      console.error(err);
      alert('Unable to generate the Income Summary PDF.');
    } finally {
      btn.disabled = false; btn.innerHTML = `${icon('M6 2h9l5 5v15H6zM14 2v6h6')} Export to PDF`;
    }
  }

  // ============================================================
  // PURCHASES — live disbursement ledger (xlsx replica)
  // ============================================================
  let purchasesSubTab = 'ledger';
  let selectedMonthKey = MONTHS[0].key;
  let selectedBranch = 'binan';
  let selectedQuarter = 1;

  function renderPurchases(el){
    const tabs = [['ledger','Monthly Ledger'], ['quarterly','Quarterly Summary'], ['yearly','Year Summary']];
    el.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k,l]) => `<button role="tab" data-subtab="${k}" aria-selected="${purchasesSubTab===k}">${l}</button>`).join('')}</div><div id="purchasesBody"></div>`;
    el.querySelectorAll('[role="tab"]').forEach(b => b.addEventListener('click', () => { purchasesSubTab = b.dataset.subtab; renderAll(); }));
    const body = document.getElementById('purchasesBody');
    ({ledger: renderLedgerTab, quarterly: renderQuarterlyTab, yearly: renderYearTab})[purchasesSubTab](body);
  }

  // ---------- Monthly Ledger ----------
  function renderLedgerTab(el){
    const meta = MONTH_BY_KEY[selectedMonthKey];
    const branchKey = meta.splitByBranch ? selectedBranch : 'combined';
    const entries = monthEntries(selectedMonthKey, branchKey).slice().sort((a,b) => (a.date||'').localeCompare(b.date||''));

    el.innerHTML = `
      <div class="ledger-subnav">
        <select id="monthSelect" class="form-select form-select-sm"></select>
        ${meta.splitByBranch ? `<div class="branch-pills" id="branchPills"></div>` : ''}
        <button class="btn btn-primary btn-sm" id="addEntryBtn" style="margin-left:auto;">+ Add Entry</button>
      </div>
      <div class="card">
        <div class="card-head"><h3>${meta.label}${meta.splitByBranch ? ' — ' + BRANCH_LABEL[branchKey] : ''}</h3><span class="badge b-neutral">${entries.length} ${entries.length===1?'entry':'entries'}</span></div>
        <div class="table-wrap"><table class="simple-table ledger-table"><thead><tr>
          <th>Date</th><th>Account Title</th><th>Particulars</th><th>TIN</th><th>Invoice Amount</th><th>VAT</th><th>Non-VAT</th><th>Input Tax</th><th></th>
        </tr></thead><tbody id="ledgerBody"></tbody></table></div>
        ${entries.length ? '' : '<div class="empty-note">No entries yet for this ledger.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Monthly Summary</h3></div>
        <div class="table-wrap" id="ledgerSummary"></div>
      </div>
    `;

    const monthSelect = el.querySelector('#monthSelect');
    MONTHS.forEach(m => {
      const o = document.createElement('option'); o.value = m.key; o.textContent = `${m.label} · Q${m.quarter}`;
      if (m.key === selectedMonthKey) o.selected = true;
      monthSelect.appendChild(o);
    });
    monthSelect.addEventListener('change', () => { selectedMonthKey = monthSelect.value; renderAll(); });

    if (meta.splitByBranch){
      const pills = el.querySelector('#branchPills');
      BRANCHES.forEach(b => {
        const btn = document.createElement('button');
        btn.textContent = b.name; btn.className = selectedBranch === b.id ? 'active' : '';
        btn.addEventListener('click', () => { selectedBranch = b.id; renderAll(); });
        pills.appendChild(btn);
      });
    }

    const tbody = el.querySelector('#ledgerBody');
    entries.forEach(e => {
      const split = splitVat(e.invoiceAmount, e.nonVatOverride);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${fmtDate(e.date)}</td>
        <td>${ACCOUNT_TITLE_LABEL[e.accountTitleId] || '—'}</td>
        <td>${e.particulars || '—'}${e.attachment ? ` <a href="${e.attachment.url}" target="_blank" rel="noopener" title="${e.attachment.name}" style="color:var(--green);">📎</a>` : ''}</td>
        <td class="mono">${e.tin || '—'}</td>
        <td class="mono num">${peso(e.invoiceAmount)}</td>
        <td class="mono num readonly">${peso(split.vatBase)}</td>
        <td class="mono num readonly">${peso(split.nonVat)}</td>
        <td class="mono num readonly">${peso(split.inputTax)}</td>
        <td><div class="ledger-row-actions"><button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button></div></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      openEntryModal(selectedMonthKey, branchKey, entries.find(x => x.id === b.dataset.edit));
    }));
    el.querySelector('#addEntryBtn').addEventListener('click', () => openEntryModal(selectedMonthKey, branchKey, null));

    el.querySelector('#ledgerSummary').innerHTML = renderSummaryTable(summarizeEntries(entries));
  }

  function renderSummaryTable(summary){
    const rows = ACCOUNT_TITLES.map(t => {
      const r = summary.byTitle[t.id] || emptyTotals();
      return `<tr><td>${t.name}</td><td class="mono num">${peso(r.invoiceAmount)}</td><td class="mono num">${peso(r.vatBase)}</td><td class="mono num">${peso(r.nonVat)}</td><td class="mono num">${peso(r.inputTax)}</td></tr>`;
    }).join('');
    return `<table class="simple-table"><thead><tr><th>Account Title</th><th>Invoice Amount</th><th>VAT</th><th>Non-VAT</th><th>Input Tax</th></tr></thead><tbody>
      ${rows}
      <tr class="summary-total-row"><td>Total</td><td class="mono num">${peso(summary.total.invoiceAmount)}</td><td class="mono num">${peso(summary.total.vatBase)}</td><td class="mono num">${peso(summary.total.nonVat)}</td><td class="mono num">${peso(summary.total.inputTax)}</td></tr>
    </tbody></table>`;
  }

  function openEntryModal(monthKey, branchKey, entry){
    const isNew = !entry;
    const attachment = entry ? entry.attachment : null;
    showModal(isNew ? 'Add ledger entry' : 'Edit ledger entry', `
      <div class="field"><label>Date</label><input class="fctl" id="enDate" type="date" value="${entry?entry.date:todayStr()}" min="${YEAR}-01-01" max="${YEAR}-12-31"></div>
      <div class="field"><label>Account Title</label><select class="fctl" id="enTitle">${ACCOUNT_TITLES.map(t=>`<option value="${t.id}" ${entry&&entry.accountTitleId===t.id?'selected':''}>${t.name}</option>`).join('')}</select></div>
      <div class="field"><label>Particulars (Vendor)</label><input class="fctl" id="enPart" value="${entry?entry.particulars:''}"></div>
      <div class="field"><label>TIN</label><input class="fctl" id="enTin" value="${entry?entry.tin:''}"></div>
      <div class="field money-field"><label>Invoice Amount</label><input class="fctl" id="enAmt" type="number" step="0.01" min="0" value="${entry?entry.invoiceAmount:0}"></div>
      <div class="field" style="display:flex;align-items:center;gap:10px;">
        <label style="margin:0;display:flex;align-items:center;gap:6px;white-space:nowrap;"><input type="checkbox" id="enNonVat" ${entry&&entry.nonVatOverride?'checked':''}> Mark as Non-VAT</label>
        <span style="font-size:11.5px;color:var(--soft-text);">Skips the 12% VAT split. The attachment below is optional.</span>
      </div>
      <div class="field" id="enFileField">
        <label>Attach File (optional — e.g. receipt)</label>
        <input class="fctl" id="enFile" type="file" accept="image/*,.pdf">
        <div id="enFileCurrent" style="font-size:12px;margin-top:4px;">${attachment ? `📎 <a href="${attachment.url}" target="_blank" rel="noopener" style="color:var(--green);">${attachment.name}</a>` : ''}</div>
      </div>
    `, [
      ...(isNew?[]:[{label:'Delete', cls:'btn-danger', action: () => {
        const list = state.ledger.months[monthKey].entries[branchKey];
        state.ledger.months[monthKey].entries[branchKey] = list.filter(x => x.id !== entry.id);
        save(); closeModal(); renderAll();
      }}]),
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const data = {
          date: document.getElementById('enDate').value || todayStr(),
          accountTitleId: Number(document.getElementById('enTitle').value),
          particulars: document.getElementById('enPart').value,
          tin: document.getElementById('enTin').value,
          invoiceAmount: parseFloat(document.getElementById('enAmt').value)||0,
          nonVatOverride: document.getElementById('enNonVat').checked,
          attachment
        };
        const commit = () => {
          const list = state.ledger.months[monthKey].entries[branchKey];
          if (isNew) list.push(Object.assign({id:uid()}, data));
          else Object.assign(entry, data);
          save(); closeModal(); renderAll();
        };
        const file = document.getElementById('enFile').files[0];
        if (file){
          uploadFile(file, `ledger/${monthKey}/${branchKey}`, (fileObj) => { data.attachment = fileObj; commit(); });
        } else {
          commit();
        }
      }}
    ]);
  }

  // ---------- Quarterly Summary ----------
  function renderQuarterlyTab(el){
    const q = QUARTERS.find(x => x.num === selectedQuarter);
    const monthTotals = q.months.map(m => ({m, t: monthTotal(m.key)}));
    const grand = emptyTotals();
    monthTotals.forEach(({t}) => { grand.invoiceAmount+=t.invoiceAmount; grand.vatBase+=t.vatBase; grand.nonVat+=t.nonVat; grand.inputTax+=t.inputTax; });

    const anySplit = q.months.some(m => m.splitByBranch);

    el.innerHTML = `
      <div class="ledger-subnav">
        <select id="qSelect" class="form-select form-select-sm"></select>
      </div>
      <div class="card">
        <div class="card-head"><h3>Q${q.num} ${YEAR} — Disbursement by Month</h3></div>
        <div class="table-wrap"><table class="simple-table"><thead><tr><th>Month</th><th>Invoice Amount</th><th>VAT</th><th>Non-VAT</th><th>Input Tax</th></tr></thead><tbody>
          ${monthTotals.map(({m,t}) => `<tr><td>${m.label}</td><td class="mono num">${peso(t.invoiceAmount)}</td><td class="mono num">${peso(t.vatBase)}</td><td class="mono num">${peso(t.nonVat)}</td><td class="mono num">${peso(t.inputTax)}</td></tr>`).join('')}
          <tr class="summary-total-row"><td>Total</td><td class="mono num">${peso(grand.invoiceAmount)}</td><td class="mono num">${peso(grand.vatBase)}</td><td class="mono num">${peso(grand.nonVat)}</td><td class="mono num">${peso(grand.inputTax)}</td></tr>
        </tbody></table></div>
      </div>
      ${anySplit ? BRANCHES.map(b => {
        const entries = q.months.flatMap(m => m.splitByBranch ? monthEntries(m.key, b.id) : []);
        return `<div class="card"><div class="qtr-branch-head">Summary — ${b.name}</div>${renderSummaryTable(summarizeEntries(entries))}</div>`;
      }).join('') : ''}
      <div class="card">
        <div class="qtr-branch-head">Combined (All Branches) Summary</div>
        ${renderSummaryTable(summarizeEntries(q.months.flatMap(m => monthEntries(m.key))))}
      </div>
    `;
    const qSelect = el.querySelector('#qSelect');
    [1,2,3,4].forEach(n => {
      const o = document.createElement('option'); o.value = n; o.textContent = `Q${n} ${YEAR}`;
      if (n === selectedQuarter) o.selected = true;
      qSelect.appendChild(o);
    });
    qSelect.addEventListener('change', () => { selectedQuarter = Number(qSelect.value); renderAll(); });
  }

  // ---------- Year Summary ----------
  function renderYearTab(el){
    const rows = QUARTERS.map(q => ({ q: q.num, t: summarizeEntries(q.months.flatMap(m => monthEntries(m.key))).total }));
    const grand = emptyTotals();
    rows.forEach(({t}) => { grand.invoiceAmount+=t.invoiceAmount; grand.vatBase+=t.vatBase; grand.nonVat+=t.nonVat; grand.inputTax+=t.inputTax; });
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${state.settings.businessName} — Summary of ${YEAR} Disbursement</h3></div>
        <div class="table-wrap"><table class="simple-table"><thead><tr><th>Quarter</th><th>Invoice Amount</th><th>VAT</th><th>Non-VAT</th><th>Input Tax</th></tr></thead><tbody>
          ${rows.map(({q,t}) => `<tr><td>Q${q}</td><td class="mono num">${peso(t.invoiceAmount)}</td><td class="mono num">${peso(t.vatBase)}</td><td class="mono num">${peso(t.nonVat)}</td><td class="mono num">${peso(t.inputTax)}</td></tr>`).join('')}
          <tr class="summary-total-row"><td>Total</td><td class="mono num">${peso(grand.invoiceAmount)}</td><td class="mono num">${peso(grand.vatBase)}</td><td class="mono num">${peso(grand.nonVat)}</td><td class="mono num">${peso(grand.inputTax)}</td></tr>
        </tbody></table></div>
      </div>
    `;
  }

  // ============================================================
  // BIR FORMS — filing tracker (Monthly / Quarterly / Annual / Yearly Summary)
  // ============================================================
  const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const BIR_FORM_OPTIONS = {
    monthly: ['1601-C', '0619-E'],
    quarterly: ['2551-Q', '1601-EQ', '1702-Q'],
    annual: ['1702-ANNUAL', '1604-C', '1604-E', '2316']
  };
  const BIR_PERIOD_LABEL = {monthly:'Monthly', quarterly:'Quarterly', annual:'Annual'};
  let birFormsSubTab = 'monthly';

  function birFormsEntries(period){
    return (state.birForms.entries||[]).filter(e => e.period === period);
  }

  function birCoverageLabel(period, coverage){
    if (period === 'monthly') return MONTH_BY_KEY[coverage] ? `${MONTH_ABBR[MONTH_BY_KEY[coverage].num-1]} ${YEAR}` : coverage;
    if (period === 'quarterly') return `Q${coverage} ${YEAR}`;
    return String(coverage);
  }

  function birCoverageSortKey(period, coverage){
    if (period === 'monthly') return coverage;
    if (period === 'quarterly') return `${YEAR}-Q${coverage}`;
    return String(coverage);
  }

  function renderBirForms(el){
    const tabs = [['monthly','Monthly'], ['quarterly','Quarterly'], ['annual','Annual'], ['yearly','Yearly Summary']];
    el.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k,l]) => `<button role="tab" data-subtab="${k}" aria-selected="${birFormsSubTab===k}">${l}</button>`).join('')}</div><div id="birFormsBody"></div>`;
    el.querySelectorAll('[role="tab"]').forEach(b => b.addEventListener('click', () => { birFormsSubTab = b.dataset.subtab; renderAll(); }));
    const body = document.getElementById('birFormsBody');
    ({
      monthly: (e) => renderBirFormsPeriodTab(e, 'monthly'),
      quarterly: (e) => renderBirFormsPeriodTab(e, 'quarterly'),
      annual: (e) => renderBirFormsPeriodTab(e, 'annual'),
      yearly: renderBirFormsYearlyTab
    })[birFormsSubTab](body);
  }

  function birAttachmentCellHtml(slot){
    if (!slot || !slot.attachment) return '—';
    return `<div class="bir-file-cell"><a href="${slot.attachment.url}" target="_blank" rel="noopener">📎 ${slot.attachment.name}</a>${slot.dateSubmitted ? `<div class="bir-file-date">Date Submitted: ${fmtDate(slot.dateSubmitted)}</div>` : ''}</div>`;
  }

  function renderBirFormsPeriodTab(el, period){
    const entries = birFormsEntries(period).slice().sort((a,b) => birCoverageSortKey(period,a.coverage).localeCompare(birCoverageSortKey(period,b.coverage)));
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${BIR_PERIOD_LABEL[period]} Filings</h3><span class="badge b-neutral">${entries.length} ${entries.length===1?'entry':'entries'}</span></div>
        <div class="table-wrap"><table class="simple-table ledger-table"><thead><tr>
          <th>Coverage</th><th>Forms</th><th>Reference</th><th>Proof of Payment</th><th>Accomplished Forms</th><th>Remarks</th><th></th>
        </tr></thead><tbody id="birFormsRows"></tbody></table></div>
        ${entries.length ? '' : `<div class="empty-note">No ${BIR_PERIOD_LABEL[period].toLowerCase()} filing records yet.</div>`}
        <div style="margin-top:14px;"><button class="btn btn-primary btn-sm" id="birAddEntryBtn">+ Add Entry</button></div>
      </div>
    `;
    const tbody = el.querySelector('#birFormsRows');
    entries.forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${birCoverageLabel(period, e.coverage)}</td>
        <td><span class="badge b-brand">${e.form}</span></td>
        <td>${birAttachmentCellHtml(e.reference)}</td>
        <td>${birAttachmentCellHtml(e.proofOfPayment)}</td>
        <td>${birAttachmentCellHtml(e.accomplishedForms)}</td>
        <td>${e.remarks ? e.remarks : '—'}</td>
        <td><div class="ledger-row-actions"><button class="btn btn-ghost btn-sm" data-view="${e.id}">View</button><button class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit</button></div></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => openBirFormViewModal(entries.find(x => x.id === b.dataset.view))));
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openBirFormModal(period, entries.find(x => x.id === b.dataset.edit))));
    el.querySelector('#birAddEntryBtn').addEventListener('click', () => openBirFormModal(period, null));
  }

  function birCoverageOptionsHtml(period, selected){
    if (period === 'monthly') return MONTHS.map(m => `<option value="${m.key}" ${selected===m.key?'selected':''}>${MONTH_ABBR[m.num-1]}</option>`).join('');
    if (period === 'quarterly') return [1,2,3,4].map(q => `<option value="${q}" ${Number(selected)===q?'selected':''}>Q${q} ${YEAR}</option>`).join('');
    return `<option value="${YEAR}" selected>${YEAR}</option>`;
  }

  function birFormOptionsHtml(period, selected){
    return BIR_FORM_OPTIONS[period].map(f => `<option value="${f}" ${selected===f?'selected':''}>${f}</option>`).join('');
  }

  function birFileFieldHtml(key, label, slot){
    const attachment = slot && slot.attachment;
    return `
      <div class="field"><label>${label}</label>
        <input class="fctl" id="bir_${key}_file" type="file" accept="image/*,.pdf">
        <div id="bir_${key}_current" style="font-size:12px;margin-top:4px;">${attachment ? `📎 <a href="${attachment.url}" target="_blank" rel="noopener" style="color:var(--green);">${attachment.name}</a>` : ''}</div>
      </div>
      <div class="field"><label>Date Submitted</label><input class="fctl" id="bir_${key}_date" type="date" value="${slot && slot.dateSubmitted ? slot.dateSubmitted : ''}"></div>
    `;
  }

  function openBirFormModal(period, entry){
    const isNew = !entry;
    const coverage = entry ? entry.coverage : (period === 'monthly' ? MONTHS[0].key : period === 'quarterly' ? 1 : YEAR);
    showModal(isNew ? `Add ${BIR_PERIOD_LABEL[period]} filing` : `Edit ${BIR_PERIOD_LABEL[period]} filing`, `
      <div class="field"><label>Coverage</label><select class="fctl" id="birCoverage">${birCoverageOptionsHtml(period, coverage)}</select></div>
      <div class="field"><label>Forms</label><select class="fctl" id="birForm">${birFormOptionsHtml(period, entry?entry.form:BIR_FORM_OPTIONS[period][0])}</select></div>
      ${birFileFieldHtml('ref', 'Reference', entry?entry.reference:null)}
      ${birFileFieldHtml('pop', 'Proof of Payment', entry?entry.proofOfPayment:null)}
      ${birFileFieldHtml('acc', 'Accomplished Forms', entry?entry.accomplishedForms:null)}
      <div class="field"><label>Remarks</label><textarea class="fctl" id="birRemarks">${entry&&entry.remarks?entry.remarks:''}</textarea></div>
    `, [
      ...(isNew?[]:[{label:'Delete', cls:'btn-danger', action: () => {
        state.birForms.entries = state.birForms.entries.filter(x => x.id !== entry.id);
        save(); closeModal(); renderAll();
      }}]),
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const coverageRaw = document.getElementById('birCoverage').value;
        const data = {
          period,
          coverage: period === 'annual' ? YEAR : (period === 'quarterly' ? Number(coverageRaw) : coverageRaw),
          form: document.getElementById('birForm').value,
          remarks: document.getElementById('birRemarks').value,
          reference: entry ? entry.reference : null,
          proofOfPayment: entry ? entry.proofOfPayment : null,
          accomplishedForms: entry ? entry.accomplishedForms : null
        };
        const slots = [['ref','reference'], ['pop','proofOfPayment'], ['acc','accomplishedForms']];
        let pending = 0;
        slots.forEach(([key, field]) => {
          const dateVal = document.getElementById(`bir_${key}_date`).value;
          const file = document.getElementById(`bir_${key}_file`).files[0];
          const existing = data[field];
          if (file){
            pending++;
            uploadFile(file, `birForms/${period}/${key}`, (fileObj) => {
              data[field] = {attachment: fileObj, dateSubmitted: dateVal || (existing?existing.dateSubmitted:'')};
              pending--; if (pending === 0) commit();
            });
          } else {
            data[field] = existing ? Object.assign({}, existing, {dateSubmitted: dateVal || existing.dateSubmitted}) : (dateVal ? {attachment:null, dateSubmitted:dateVal} : null);
          }
        });
        function commit(){
          if (isNew) state.birForms.entries.push(Object.assign({id:uid()}, data));
          else Object.assign(entry, data);
          save(); closeModal(); renderAll();
        }
        if (pending === 0) commit();
      }}
    ]);
  }

  function openBirFormViewModal(entry){
    if (!entry) return;
    showModal(`${entry.form} — ${birCoverageLabel(entry.period, entry.coverage)}`, `
      <div class="field"><label>Coverage</label><div>${birCoverageLabel(entry.period, entry.coverage)}</div></div>
      <div class="field"><label>Forms</label><div>${entry.form}</div></div>
      <div class="field"><label>Reference</label>${birAttachmentCellHtml(entry.reference)}</div>
      <div class="field"><label>Proof of Payment</label>${birAttachmentCellHtml(entry.proofOfPayment)}</div>
      <div class="field"><label>Accomplished Forms</label>${birAttachmentCellHtml(entry.accomplishedForms)}</div>
      <div class="field"><label>Remarks</label><div>${entry.remarks || '—'}</div></div>
    `, [
      {label:'Close', cls:'btn-ghost', action: closeModal}
    ]);
  }

  // ---------- Yearly Summary: overview matrix ----------
  // One grid: months down the side, every form across the top — a quarterly
  // form's cell spans its 3 months and an annual form's cell spans all 12,
  // matching the source workbook's layout.
  const BIR_MATRIX_COLUMNS = [
    {form:'1601-C', period:'monthly'},
    {form:'0619-E', period:'monthly'},
    {form:'2551-Q', period:'quarterly'},
    {form:'1601-EQ', period:'quarterly'},
    {form:'1702-Q', period:'quarterly'},
    {form:'1702-ANNUAL', period:'annual'},
    {form:'1604-C', period:'annual'},
    {form:'1604-E', period:'annual'},
    {form:'2316', period:'annual'}
  ];

  function findBirEntry(period, coverage, form){
    return (state.birForms.entries||[]).find(e => e.period === period && String(e.coverage) === String(coverage) && e.form === form);
  }

  function birMatrixCellHtml(entry){
    if (!entry) return '';
    const rows = [['Reference', entry.reference], ['Proof of Payment', entry.proofOfPayment], ['Accomplished Forms', entry.accomplishedForms]];
    return `<div class="bir-matrix-cell">${rows.map(([label, slot]) => {
      const done = slot && slot.attachment;
      return done
        ? `<button type="button" class="bir-matrix-line done" data-print="${slot.attachment.url}" data-print-name="${slot.attachment.name}">${label} — DONE</button>`
        : `<div class="bir-matrix-line pending">${label} — PENDING</div>`;
    }).join('')}</div>`;
  }

  // Every BIR Forms entry is implicitly YEAR (2026) — same single-year
  // architecture the rest of CrownOS uses (dashboard/purchases/income are
  // all pinned to the YEAR constant). The picker is kept here so the matrix
  // is ready to filter the moment a future year's coverage options exist.
  let birMatrixYear = YEAR;
  const BIR_MATRIX_YEARS = [YEAR];

  function renderBirFormsYearlyTab(el){
    const headerHtml = `<tr><th>Coverage</th>${BIR_MATRIX_COLUMNS.map(c => `<th>${c.form}</th>`).join('')}</tr>`;
    const rowsHtml = MONTHS.map((m, idx) => {
      const cellsHtml = BIR_MATRIX_COLUMNS.map(c => {
        if (c.period === 'monthly'){
          return `<td>${birMatrixCellHtml(m.year === birMatrixYear ? findBirEntry('monthly', m.key, c.form) : null)}</td>`;
        }
        if (c.period === 'quarterly'){
          if ((m.num - 1) % 3 !== 0) return ''; // only the quarter's first month renders the cell
          return `<td rowspan="3">${birMatrixCellHtml(m.year === birMatrixYear ? findBirEntry('quarterly', m.quarter, c.form) : null)}</td>`;
        }
        if (idx !== 0) return ''; // annual: only January renders the cell
        return `<td rowspan="12">${birMatrixCellHtml(findBirEntry('annual', birMatrixYear, c.form))}</td>`;
      }).join('');
      return `<tr><td class="bir-matrix-month">${MONTH_ABBR[idx]}</td>${cellsHtml}</tr>`;
    }).join('');

    el.innerHTML = `
      <div class="ledger-subnav">
        <select id="birYearSelect" class="form-select form-select-sm"></select>
      </div>
      <div class="card">
        <div class="card-head"><h3>${state.settings.businessName} — ${birMatrixYear} BIR Filing Overview</h3></div>
        <div class="table-wrap"><table class="simple-table bir-matrix"><thead>${headerHtml}</thead><tbody>${rowsHtml}</tbody></table></div>
      </div>
    `;
    const yearSelect = el.querySelector('#birYearSelect');
    BIR_MATRIX_YEARS.forEach(y => {
      const o = document.createElement('option'); o.value = y; o.textContent = y;
      if (y === birMatrixYear) o.selected = true;
      yearSelect.appendChild(o);
    });
    yearSelect.addEventListener('change', () => { birMatrixYear = Number(yearSelect.value); renderAll(); });
    el.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => openBirPrintPreview(b.dataset.print, b.dataset.printName)));
  }

  // Opens the attachment in an A4-sized, print-ready layout — used by the
  // Yearly Summary matrix so a finished filing's proof can be reviewed/printed
  // without leaving the app in an image-viewer/PDF tab instead.
  function openBirPrintPreview(url, name){
    const w = window.open('', '_blank');
    if (!w){ alert('Please allow pop-ups to preview/print this file.'); return; }
    const isPdf = /\.pdf($|\?)/i.test(url) || /\.pdf($|\?)/i.test(name||'');
    const safeName = (name||'Attachment').replace(/[<>&]/g, '');
    w.document.write(`<!DOCTYPE html><html><head><title>${safeName}</title>
      <style>
        @page{ size:A4; margin:0; }
        html,body{ margin:0; padding:0; background:#525659; }
        .a4-page{ width:210mm; min-height:297mm; margin:12px auto; background:#fff; box-shadow:0 0 12px rgba(0,0,0,.3); display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .a4-page img{ max-width:100%; max-height:297mm; object-fit:contain; }
        .a4-page iframe{ width:100%; height:297mm; border:none; }
        .toolbar{ position:sticky; top:0; background:#2b2f33; padding:8px 16px; display:flex; justify-content:flex-end; gap:8px; z-index:10; }
        .toolbar button{ font:inherit; font-size:13px; font-weight:700; padding:7px 14px; border-radius:6px; border:none; cursor:pointer; background:#fff; color:#111; }
        @media print{ .toolbar{ display:none; } body{ background:#fff; } .a4-page{ margin:0; box-shadow:none; } }
      </style></head><body>
        <div class="toolbar"><button onclick="window.print()">Print</button></div>
        <div class="a4-page">${isPdf ? `<iframe src="${url}"></iframe>` : `<img src="${url}" alt="${safeName}">`}</div>
      </body></html>`);
    w.document.close();
  }

  // ---------- Access & init ----------
  function enforceAccess(){
    const user = window.CrownAuth?.refreshCurrentUser?.();
    if (!user){
      location.href = 'login.html';
      return false;
    }
    const role = window.CrownAuth.getEffectiveRole ? window.CrownAuth.getEffectiveRole(user) : user.role;
    if (!['Admin', 'Executive Assistant'].includes(role)){
      alert('Only an Admin or Executive Assistant account can access the BIR Compliance Desk.');
      location.href = 'home.html';
      return false;
    }
    return true;
  }

  function bindHeader(){
    const nameInput = document.getElementById('actingName');
    nameInput.value = state.settings.actingName || '';
    nameInput.addEventListener('change', () => { state.settings.actingName = nameInput.value; save(); });
  }

  // Re-render when Daily Income Report sales sync in from Firestore, so the
  // Income Summary tab picks up newly invoiced sales without a reload —
  // same pattern invoice-report.js uses for the same crownDailySales_ keys.
  window.addEventListener('crownCloudUpdate', (event) => {
    const keys = event.detail?.keys || [];
    if (state && currentView === 'income' && keys.some(k => k.startsWith(DAILY_SALES_PREFIX))){
      renderAll();
    }
  });

  if (enforceAccess()){
    startFirestoreSync(() => { bindHeader(); renderAll(); });
  }
})();
