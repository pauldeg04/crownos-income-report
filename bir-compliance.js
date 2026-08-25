(function(){
  const firestore = firebase.firestore();
  const storage = firebase.storage();

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const STATUS_FLOW = [
    ['not-started','Not Started'],['data-entry','Data Entry in Progress'],['data-complete','Data Complete'],
    ['documents-missing','Documents Missing'],['ready-for-accountant','Ready for Accountant'],
    ['under-accountant-review','Under Accountant Review'],['accountant-adjusted','Accountant Adjusted'],
    ['accountant-approved','Accountant Approved'],['owner-approval','Owner Approval'],
    ['approved-for-filing','Approved for Filing'],['filed','Filed'],['payment-pending','Payment Pending'],
    ['paid','Paid'],['completed','Completed'],['on-hold','On Hold']
  ];
  const STATUS_LABEL = Object.fromEntries(STATUS_FLOW);

  const DOC_CHECKLIST_TEMPLATE = [
    ['Sales', ['Monthly Sales Summary','Branch Sales Summary','Sales Invoice Summary','Discounts Report','Refund/Void Report']],
    ['Expenses', ['Supplier Invoices','Rent Invoice','Utility Bills','Accounting Fees','Professional Fees','Marketing Invoices','Purchase Invoices','Other Receipts']],
    ['Payroll', ['Payroll Summary','Employee List','Compensation Summary','Withholding Summary']],
    ['Withholding', ['2307','Withholding Summary','Supplier/Payee Information']],
    ['Tax', ['Previous Tax Return','Previous Payment Confirmation','Tax Credits','BMBE Certificate']]
  ];
  const DOC_STATUSES = ['missing','requested','uploaded','for-validation','accepted','rejected','not-applicable'];
  const DOC_STATUS_LABEL = {missing:'Missing',requested:'Requested',uploaded:'Uploaded','for-validation':'For Validation',accepted:'Accepted',rejected:'Rejected','not-applicable':'N/A'};

  const FILING_STATUSES = ['prepared','approved','filed','payment-pending','paid','completed','amended','nil-return','no-tax-payable','not-applicable'];
  const FILING_STATUS_LABEL = {prepared:'Prepared',approved:'Approved',filed:'Filed','payment-pending':'Payment Pending',paid:'Paid',completed:'Completed',amended:'Amended','nil-return':'Nil Return','no-tax-payable':'No Tax Payable','not-applicable':'Not Applicable'};

  const OPEX_FIELDS = [['rent','Rent'],['utilities','Utilities'],['salaries','Salaries / Wages'],['professionalFees','Professional / Accounting Fees'],['marketing','Marketing'],['repairs','Repairs & Maintenance'],['renovation','Renovation'],['officeSupplies','Office Supplies'],['software','Software / Subscriptions'],['transportation','Transportation'],['pettyCash','Petty Cash / Miscellaneous'],['other','Other Operating Expenses']];
  const PURCHASE_FIELDS = [['inventory','Inventory Purchases'],['supplies','Supplies'],['equipment','Equipment Purchases'],['other','Other Purchases']];
  const PAYROLL_FIELDS = [['salaries','Total Employee Salaries'],['allowances','Total Allowances'],['commissions','Total Commissions'],['bonuses','Total Bonuses'],['otherComp','Total Other Compensation'],['employeeDeductions','Total Employee Deductions'],['govtContributions','Total Government Contributions'],['compSubjectWH','Total Compensation Subject to Withholding'],['compWHRemitted','Total Compensation Withholding Remitted']];
  const RETAINER_FIELDS = [['retainerPayments','Total Retainer Payments'],['contractorPayments','Total Contractor Payments'],['retainerContractorWH','Total Withholding on Retainers/Contractors']];

  // ---------- State ----------
  let state = null;
  function defaultState(){
    return {
      settings: {
        businessName: 'JS Wellness Corporation',
        entityType: 'Domestic Corporation',
        tin: '659-275-863-000',
        branches: ['Biñan (Head Office)','Calamba'],
        branchDetails: [
          {label:'Biñan (Head Office)', tradeName:'JS Wellness Corporation', branchCode:'659-275-863-00000', rdo:'RDO 057 — Biñan, West Laguna', address:'Ground Floor Lourdes Building, San Antonio, 4024 City of Biñan, Laguna', lineOfBusiness:'Other Personal Services for Wellness Activities, N.E.C. (PSIC 96109)'},
          {label:'Calamba', tradeName:'Crown Head Spa', branchCode:'659-275-863-00001', rdo:'RDO 056 — Central Laguna', address:'Unit 1, Ground Floor Dynasty Building, National Highway, Halang, 4027 City of Calamba, Laguna', lineOfBusiness:'Spa Activities (PSIC 96101)'}
        ],
        vatRegistered: false,
        percentageTaxRate: 0.03,
        incomeTaxRate: 0.25,
        role: 'owner',
        actingName: ''
      },
      bmbe: { certNumber:'', businessName:'', branch:'', effectiveDate:'', expirationDate:'', status:'not-applicable', certFile:null, exemptionConfirmed:false },
      periods: [],
      currentPeriodId: null,
      calendar: [
        {id:uid(), form:'1601-C', taxType:'Withholding Tax — Compensation', coveredPeriod:'Monthly', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'1604-C', taxType:'Withholding Tax — Compensation (Annual Info Return)', coveredPeriod:'Annual', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'0619-E', taxType:'Withholding Tax — Expanded (Monthly Remittance)', coveredPeriod:'Monthly', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'1601-EQ', taxType:'Withholding Tax — Expanded (Quarterly)', coveredPeriod:'Quarterly', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'1604-E', taxType:'Withholding Tax — Expanded (Annual Info Return)', coveredPeriod:'Annual', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'2551Q', taxType:'Percentage Tax', coveredPeriod:'Quarterly', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'1702Q', taxType:'Corporate Income Tax (Quarterly)', coveredPeriod:'Quarterly', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'},
        {id:uid(), form:'1702', taxType:'Corporate Income Tax (Annual)', coveredPeriod:'Annual', officialDeadline:'', internalDeadline:'', accountantDeadline:'', ownerDeadline:'', status:'pending', paymentStatus:'not-applicable'}
      ],
      auditTrail: []
    };
  }

  function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

  // ---------- Firestore sync ----------
  // The whole app state is kept as one JSON string in a single shared
  // Firestore document, so every signed-in device sees the same data in
  // real time. Files are NOT embedded here (see uploadFile) — Firestore
  // documents cap out at 1MB, so binary attachments live in Storage instead.
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
      if (firstSnapshot){
        firstSnapshot = false;
        if (!state.currentPeriodId && state.periods.length) state.currentPeriodId = state.periods[0].id;
        onFirstLoad();
      } else if (!snap.metadata.hasPendingWrites){
        // A confirmed change from another device/tab — refresh the view.
        // Our own optimistic writes (hasPendingWrites: true) are skipped
        // here since we already have the latest state in memory locally.
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

  function logAudit(action, target, prev, next, reason){
    state.auditTrail.unshift({
      id: uid(), ts: new Date().toISOString(), user: state.settings.actingName || '(unnamed)', role: state.settings.role,
      action, target, prev: prev===undefined?'':String(prev), next: next===undefined?'':String(next), reason: reason||''
    });
    if (state.auditTrail.length > 500) state.auditTrail.pop();
  }

  function newPeriodData(month, year){
    const quarter = Math.floor((month-1)/3)+1;
    return {
      id: uid(), month, year, quarter, label: `${MONTHS[month-1]} ${year}`,
      status: 'not-started',
      sales: {
        branches: state.settings.branches.map(n => ({name:n, gross:0, discounts:0, refunds:0})),
        categories: {serviceSales:0, productSales:0, vipCardSales:0, voucherSales:0, otherIncome:0},
        adjustments: {discounts:0, seniorDiscounts:0, pwdDiscounts:0, refunds:0, voids:0, cancelled:0, otherApprovedAdj:0},
        adjustmentOverride: null, manualGross: 0
      },
      purchases: {inventory:0, supplies:0, equipment:0, other:0},
      opex: {rent:0, utilities:0, salaries:0, professionalFees:0, marketing:0, repairs:0, renovation:0, officeSupplies:0, software:0, transportation:0, pettyCash:0, other:0},
      payroll: {salaries:0, allowances:0, commissions:0, bonuses:0, otherComp:0, employeeDeductions:0, govtContributions:0, compSubjectWH:0, compWHRemitted:0, retainerPayments:0, contractorPayments:0, retainerContractorWH:0},
      withholding: {ewt:{potentialBase:0, approvedBase:0, withheld:0, remitted:0, docsAvailable:0, docsMissing:0}, comp:{subjectWH:0, withheld:0, remitted:0}},
      previousPayments: [],
      otherItems: [],
      documents: DOC_CHECKLIST_TEMPLATE.flatMap(([cat, items]) => items.map(name => ({id:uid(), category:cat, name, status:'missing', file:null, notes:''}))),
      adjustments: [],
      approved: { percentageTaxApplicable:true, incomeTaxApplicable:true, taxableSalesOverride:null, opexOverride:null, purchasesOverride:null, percentageTaxRateOverride:null, incomeTaxRateOverride:null, otherCreditsOverride:null },
      ownerAction: { status:'awaiting', comment:'', date:'', by:'' },
      filing: {form:'', coveredPeriod:'', finalTaxPayable:0, filingDate:'', platform:'', referenceNumber:'', paymentDate:'', paymentAmount:0, paymentMethod:'', paymentReference:'', proofFiling:null, proofPayment:null, filedBy:'', reviewedBy:'', approvedBy:'', status:'prepared'},
      taxFund: { reserved: 0 }
    };
  }

  function getPeriod(id){ return state.periods.find(p => p.id === id); }
  function getCurrentPeriod(){ return getPeriod(state.currentPeriodId); }

  function sum(obj, keys){ return keys.reduce((s,[k]) => s + (Number(obj[k])||0), 0); }
  function peso(n){ n = Number(n)||0; return '₱' + n.toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}); }

  // ---------- Computation engine ----------
  function computeTotals(p){
    const branchGross = p.sales.branches.reduce((s,b) => s + (Number(b.gross)||0), 0);
    const branchDiscounts = p.sales.branches.reduce((s,b) => s + (Number(b.discounts)||0), 0);
    const branchRefunds = p.sales.branches.reduce((s,b) => s + (Number(b.refunds)||0), 0);
    const totalGrossSales = p.sales.branches.length ? branchGross : (Number(p.sales.manualGross)||0);
    const adjSum = sum(p.sales.adjustments, Object.entries(p.sales.adjustments));
    const totalAdjustments = p.sales.adjustmentOverride != null ? Number(p.sales.adjustmentOverride) : (adjSum || (branchDiscounts+branchRefunds));
    const netSales = Math.max(totalGrossSales - totalAdjustments, 0);

    const purchasesTotal = PURCHASE_FIELDS.reduce((s,[k]) => s + (Number(p.purchases[k])||0), 0);
    const opexTotalRaw = OPEX_FIELDS.reduce((s,[k]) => s + (Number(p.opex[k])||0), 0);
    const payrollTotal = PAYROLL_FIELDS.reduce((s,[k]) => s + (Number(p.payroll[k])||0), 0) + RETAINER_FIELDS.reduce((s,[k]) => s + (Number(p.payroll[k])||0), 0);
    const prevPaymentsTotal = p.previousPayments.reduce((s,x) => s + (Number(x.amount)||0), 0);

    const taxableSales = p.approved.taxableSalesOverride != null ? Number(p.approved.taxableSalesOverride) : netSales;
    const opexApproved = p.approved.opexOverride != null ? Number(p.approved.opexOverride) : opexTotalRaw;
    const purchasesApproved = p.approved.purchasesOverride != null ? Number(p.approved.purchasesOverride) : purchasesTotal;
    const pctRate = p.approved.percentageTaxRateOverride != null ? Number(p.approved.percentageTaxRateOverride) : state.settings.percentageTaxRate;
    const incRate = p.approved.incomeTaxRateOverride != null ? Number(p.approved.incomeTaxRateOverride) : state.settings.incomeTaxRate;

    const bmbeExempt = state.bmbe.status === 'active' && state.bmbe.exemptionConfirmed;

    const percentageTax = p.approved.percentageTaxApplicable ? taxableSales * pctRate : 0;
    const taxableIncome = Math.max(taxableSales - purchasesApproved - opexApproved, 0);
    const credits = prevPaymentsTotal + (Number(p.withholding.ewt.remitted)||0) + (p.approved.otherCreditsOverride != null ? Number(p.approved.otherCreditsOverride) : 0);
    const incomeTaxBeforeCredits = (p.approved.incomeTaxApplicable && !bmbeExempt) ? taxableIncome * incRate : 0;
    const incomeTax = Math.max(incomeTaxBeforeCredits - credits, 0);
    const otherTaxTotal = p.otherItems.filter(o => o.category === 'tax').reduce((s,x) => s + (Number(x.amount)||0), 0);

    const estEWT = Number(p.withholding.ewt.withheld)||0;
    const estCompWH = Number(p.withholding.comp.withheld)||0;
    const totalEstimatedTaxAll = percentageTax + incomeTax + estEWT + estCompWH + otherTaxTotal;
    const cashToPrepare = percentageTax + incomeTax + otherTaxTotal;

    let estimateStatus = 'system-generated';
    if (p.filing.status === 'paid' || p.filing.status === 'completed') estimateStatus = 'actual-paid';
    else if (p.filing.status === 'filed') estimateStatus = 'final-filed';
    else if (p.ownerAction.status === 'approved') estimateStatus = 'accountant-approved';
    else if (p.adjustments.length) estimateStatus = 'accountant-adjusted';

    return { totalGrossSales, totalAdjustments, netSales, purchasesTotal, opexTotalRaw, payrollTotal, prevPaymentsTotal,
      taxableSales, opexApproved, purchasesApproved, pctRate, incRate, bmbeExempt,
      percentageTax, taxableIncome, credits, incomeTaxBeforeCredits, incomeTax, otherTaxTotal,
      estEWT, estCompWH, totalEstimatedTaxAll, cashToPrepare, estimateStatus };
  }

  function computeCompleteness(p){
    const checks = [];
    checks.push(['Sales Data', p.sales.branches.some(b=>Number(b.gross)>0) || Number(p.sales.manualGross)>0]);
    checks.push(['Purchases', PURCHASE_FIELDS.some(([k]) => Number(p.purchases[k])>0)]);
    checks.push(['Operating Expenses', OPEX_FIELDS.some(([k]) => Number(p.opex[k])>0)]);
    checks.push(['Payroll', PAYROLL_FIELDS.some(([k]) => Number(p.payroll[k])>0)]);
    checks.push(['Withholding Data', Number(p.withholding.ewt.withheld)>0 || Number(p.withholding.comp.withheld)>0]);
    const missingDocs = p.documents.filter(d => d.status === 'missing').length;
    checks.push(['Tax Documents', missingDocs === 0]);
    checks.push(['BMBE Validation', state.bmbe.status !== 'pending-validation']);
    const pct = Math.round((checks.filter(c=>c[1]).length / checks.length) * 100);
    return { checks, pct, missingDocs };
  }

  function daysUntil(dateStr){
    if (!dateStr) return null;
    const [y,m,d] = dateStr.split('-').map(Number);
    const target = new Date(y, m-1, d);
    const now = new Date(); now.setHours(0,0,0,0);
    return Math.round((target - now) / 86400000);
  }
  function fmtDate(s){ if(!s) return '—'; const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-PH',{month:'short', day:'numeric', year:'numeric'}); }
  function fmtDateTime(iso){ const d = new Date(iso); return d.toLocaleDateString('en-PH',{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}); }

  // ---------- Nav ----------
  const NAV = [
    {group:'Overview', items:[
      {id:'dashboard', label:'Dashboard', icon:'M3 12h4v8H3zM10 6h4v14h-4zM17 3h4v17h-4z'},
    ]},
    {group:'Monthly Data', items:[
      {id:'data-entry', label:'Monthly Business Data', icon:'M4 4h16v16H4zM4 9h16M9 9v11'},
      {id:'documents', label:'Documents', icon:'M6 2h9l5 5v15H6zM14 2v6h6'},
    ]},
    {group:'Compliance', items:[
      {id:'estimate', label:'Estimated Tax', icon:'M3 3v18h18M7 15l4-4 4 4 5-6'},
      {id:'accountant', label:'Accountant Review', icon:'M4 20h16M4 4h16M9 4v16M15 4v16'},
      {id:'owner', label:'Owner Approval', icon:'M20 6 9 17l-5-5'},
      {id:'calendar', label:'Tax Calendar', icon:'M8 2v4M16 2v4M3 9h18M4 5h16v16H4z'},
      {id:'filing', label:'Filings & Payments', icon:'M3 7h18v13H3zM3 7l9-4 9 4'},
      {id:'fund', label:'Tax Fund', icon:'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'},
    ]},
    {group:'Insights', items:[
      {id:'compare', label:'Period Comparison', icon:'M4 20V10M12 20V4M20 20v-7'},
      {id:'reports', label:'Reports', icon:'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6'},
      {id:'audit', label:'Audit Trail', icon:'M12 8v4l3 3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z'},
      {id:'assistant', label:'BIR Assistant', icon:'M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5zM6 21v-2a6 6 0 0 1 6-6 6 6 0 0 1 6 6v2'},
    ]},
    {group:'System', items:[
      {id:'settings', label:'Settings', icon:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z'},
    ]}
  ];
  let currentView = 'dashboard';

  function icon(path, extra){ return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${extra||''}<path d="${path}"/></svg>`; }

  function renderViewTabs(){
    const nav = document.getElementById('viewTabs');
    nav.innerHTML = '';
    NAV.forEach(group => {
      group.items.forEach(item => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(currentView === item.id));
        let badge = '';
        if (item.id === 'documents'){
          const p = getCurrentPeriod();
          const n = p ? p.documents.filter(d=>d.status==='missing').length : 0;
          if (n) badge = `<span class="nav-badge">${n}</span>`;
        }
        b.innerHTML = `<span>${item.label}</span>` + badge;
        b.addEventListener('click', () => { currentView = item.id; renderAll(); });
        nav.appendChild(b);
      });
    });
  }

  function renderRoleSwitch(){
    const el = document.getElementById('roleSwitch');
    el.innerHTML = '';
    ['owner','accountant','admin'].forEach(r => {
      const b = document.createElement('button');
      b.textContent = r[0].toUpperCase()+r.slice(1);
      b.className = state.settings.role === r ? 'active' : '';
      b.addEventListener('click', () => { state.settings.role = r; save(); renderAll(); });
      el.appendChild(b);
    });
    const nameInput = document.getElementById('actingName');
    nameInput.value = state.settings.actingName || '';
    nameInput.addEventListener('change', () => { state.settings.actingName = nameInput.value; save(); });
  }

  function renderPeriodSelect(){
    const sel = document.getElementById('periodSelect');
    sel.innerHTML = '';
    if (!state.periods.length){
      const o = document.createElement('option'); o.textContent = 'No periods yet'; sel.appendChild(o);
      sel.disabled = true;
    } else {
      sel.disabled = false;
      state.periods.slice().sort((a,b) => (b.year-a.year) || (b.month-a.month)).forEach(p => {
        const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.label} · Q${p.quarter}`;
        if (p.id === state.currentPeriodId) o.selected = true;
        sel.appendChild(o);
      });
    }
    sel.addEventListener('change', () => { state.currentPeriodId = sel.value; save(); renderAll(); });
    document.getElementById('btnNewPeriod').onclick = openNewPeriodModal;
  }

  function openNewPeriodModal(){
    const now = new Date();
    showModal('New Tax Period', `
      <div class="field"><label>Month</label>
        <select id="npMonth" class="fctl">${MONTHS.map((m,i)=>`<option value="${i+1}" ${i===now.getMonth()?'selected':''}>${m}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Year</label><input id="npYear" type="number" class="fctl" value="${now.getFullYear()}"></div>
      <div class="banner info" style="margin:0;">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Quarter and year are assigned automatically from the month you pick.</span></div>
    `, [
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Create Period', cls:'btn-primary', action: () => {
        const month = Number(document.getElementById('npMonth').value);
        const year = Number(document.getElementById('npYear').value);
        if (state.periods.some(p => p.month===month && p.year===year)){ alert('That period already exists.'); return; }
        const p = newPeriodData(month, year);
        state.periods.push(p);
        state.currentPeriodId = p.id;
        logAudit('Monthly data created', p.label, '', 'Period created');
        save(); closeModal(); currentView = 'data-entry'; renderAll();
      }}
    ]);
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

  // ---------- File helper ----------
  // Uploads to Firebase Storage (shared, cross-device) instead of embedding
  // base64 in the synced Firestore document, which has a 1MB size limit.
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
  // VIEWS
  // ============================================================
  const VIEW_TITLES = {dashboard:'Dashboard', 'data-entry':'Monthly Business Data', documents:'Document Checklist', estimate:'Estimated Tax', accountant:'Accountant Review', owner:'Owner Approval', calendar:'Tax Calendar', filing:'Filings & Payments', fund:'Tax Fund Preparation', compare:'Period Comparison', reports:'Reports', audit:'Audit Trail', assistant:'BIR Assistant', settings:'Settings'};

  function renderAll(){
    renderViewTabs(); renderRoleSwitch(); renderPeriodSelect();
    document.getElementById('viewTitle').textContent = VIEW_TITLES[currentView] || '';
    const content = document.getElementById('content');
    content.innerHTML = '';
    const p = getCurrentPeriod();
    if (!p && currentView !== 'settings' && currentView !== 'audit' && currentView !== 'calendar' && currentView !== 'reports' && currentView !== 'compare'){
      content.innerHTML = `<div class="card"><div class="empty-note">${icon('M4 4h16v16H4zM4 9h16M9 9v11', '')}<h3 style="margin-top:10px;color:var(--ink);">No tax period selected</h3><p>Create a tax period to start entering monthly business data.</p><button class="btn btn-primary" id="emptyNewPeriod" style="margin-top:10px;">+ New Tax Period</button></div></div>`;
      const btn = document.getElementById('emptyNewPeriod'); if (btn) btn.onclick = openNewPeriodModal;
      return;
    }
    const renderers = {dashboard:renderDashboard, 'data-entry':renderDataEntry, documents:renderDocuments, estimate:renderEstimate, accountant:renderAccountant, owner:renderOwner, calendar:renderCalendar, filing:renderFiling, fund:renderFund, compare:renderCompare, reports:renderReports, audit:renderAudit, assistant:renderAssistant, settings:renderSettings};
    (renderers[currentView] || renderDashboard)(content, p);
  }

  // ---------- Dashboard ----------
  function renderDashboard(el, p){
    const totals = computeTotals(p);
    const comp = computeCompleteness(p);
    const nextCal = upcomingDeadline(p);
    el.innerHTML = `
      <div class="dash-grid">
        <div>
          <div class="hero-stat">
            <div class="l">Estimated tax to prepare — ${p.label}</div>
            <div class="v mono">${peso(totals.cashToPrepare)}</div>
            <div class="foot">ESTIMATED ONLY — SUBJECT TO ACCOUNTANT REVIEW · Status: ${estimateStatusLabel(totals.estimateStatus)}</div>
            <button class="btn btn-ghost btn-sm no-print" id="btnCopyAccountant" style="margin-top:12px;background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.3);">${icon('M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2ZM16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2')} Copy summary for Accountant</button>
          </div>
          <div class="card" style="margin-top:16px;">
            <div class="card-head"><h3>Workflow status</h3><span class="badge b-brand">${STATUS_LABEL[p.status]}</span></div>
            <div class="stepper">${STATUS_FLOW.filter(([k])=>k!=='on-hold').map(([k,label],i) => {
              const idx = STATUS_FLOW.findIndex(([sk])=>sk===p.status);
              const cls = i < idx ? 'done' : (k===p.status ? 'current' : '');
              return `<span class="step-chip ${cls}">${label}</span>`;
            }).join('')}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3>Data completeness</h3><span class="badge ${comp.pct===100?'b-ok':'b-warn'}">${comp.pct}%</span></div>
            <div class="progress-bar" style="margin-bottom:12px;"><div style="width:${comp.pct}%;"></div></div>
            <table class="simple-table"><tbody>
              ${comp.checks.map(([label,ok]) => `<tr><td>${label}</td><td style="text-align:right;">${ok?`<span class="badge b-ok">${icon('M20 6 9 17l-5-5')} Complete</span>`:`<span class="badge b-warn">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')} Missing</span>`}</td></tr>`).join('')}
            </tbody></table>
          </div>
        </div>
        <div>
          <div class="card">
            <div class="card-head"><h3>Next deadline</h3></div>
            ${nextCal ? `<div style="font-size:20px;font-weight:800;">${nextCal.form}</div><div class="mono" style="color:var(--ink-soft);margin:4px 0;">${fmtDate(nextCal.officialDeadline)}</div><span class="badge ${daysUntil(nextCal.officialDeadline)<0?'b-danger':daysUntil(nextCal.officialDeadline)<=7?'b-warn':'b-neutral'}">${deadlineText(nextCal.officialDeadline)}</span>` : `<div class="empty-note">No deadlines scheduled. Set dates in the Tax Calendar.</div>`}
          </div>
          <div class="card">
            <div class="card-head"><h3>Your next action</h3></div>
            <p style="font-size:13px;color:var(--ink-soft);margin:0;">${nextActionFor(p, comp)}</p>
          </div>
          <div class="card">
            <div class="card-head"><h3>Missing documents</h3><span class="badge ${comp.missingDocs?'b-danger':'b-ok'}">${comp.missingDocs}</span></div>
            ${comp.missingDocs ? `<ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--ink-soft);">${p.documents.filter(d=>d.status==='missing').slice(0,6).map(d=>`<li>${d.name}</li>`).join('')}</ul>` : `<div class="empty-note">All documents accounted for.</div>`}
          </div>
        </div>
      </div>
    `;
    const copyBtn = document.getElementById('btnCopyAccountant');
    if (copyBtn) copyBtn.addEventListener('click', () => copySummaryForAccountant(p, copyBtn));
  }

  function buildAccountantSummaryText(p){
    const t = computeTotals(p);
    const comp = computeCompleteness(p);
    const missing = p.documents.filter(d => d.status === 'missing');
    const nextCal = upcomingDeadline(p);
    const lines = [];
    lines.push(`${state.settings.businessName} — ${p.label} (Q${p.quarter} ${p.year})`);
    lines.push(`Status: ${STATUS_LABEL[p.status]} · Data completeness: ${comp.pct}%`);
    lines.push('');
    lines.push('SALES');
    lines.push(`Gross Sales: ${peso(t.totalGrossSales)}`);
    lines.push(`Adjustments: ${peso(t.totalAdjustments)}`);
    lines.push(`Net Sales: ${peso(t.netSales)}`);
    lines.push('');
    lines.push(`Purchases: ${peso(t.purchasesTotal)}`);
    lines.push(`Operating Expenses: ${peso(t.opexTotalRaw)}`);
    lines.push(`Payroll & Retainers: ${peso(t.payrollTotal)}`);
    lines.push('');
    lines.push('WITHHOLDING');
    lines.push(`EWT Withheld / Remitted: ${peso(p.withholding.ewt.withheld)} / ${peso(p.withholding.ewt.remitted)}`);
    lines.push(`Compensation WH Withheld / Remitted: ${peso(p.withholding.comp.withheld)} / ${peso(p.withholding.comp.remitted)}`);
    lines.push('');
    lines.push('ESTIMATED TAX (subject to your review)');
    lines.push(`Percentage Tax: ${peso(t.percentageTax)}`);
    lines.push(`Income Tax: ${peso(t.incomeTax)}`);
    lines.push(`Other Taxes: ${peso(t.otherTaxTotal)}`);
    lines.push(`Total to prepare: ${peso(t.cashToPrepare)}`);
    if (p.adjustments.length){
      lines.push('');
      lines.push('ACCOUNTANT ADJUSTMENTS ON FILE');
      p.adjustments.forEach(a => lines.push(`- ${a.fieldLabel}: ${peso(a.original)} → ${peso(a.adjusted)} (${a.reason || 'no reason given'})`));
    }
    if (missing.length){
      lines.push('');
      lines.push(`MISSING DOCUMENTS (${missing.length})`);
      missing.slice(0,10).forEach(d => lines.push(`- ${d.name}`));
      if (missing.length > 10) lines.push(`- ...and ${missing.length-10} more`);
    }
    if (nextCal){
      lines.push('');
      lines.push(`Next deadline: ${nextCal.form} — ${fmtDate(nextCal.officialDeadline)} (${deadlineText(nextCal.officialDeadline)})`);
    }
    lines.push('');
    lines.push(`Generated from BIR Compliance Desk on ${fmtDate(todayStr())}`);
    return lines.join('\n');
  }

  async function copySummaryForAccountant(p, btn){
    const text = buildAccountantSummaryText(p);
    const original = btn.innerHTML;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      btn.innerHTML = icon('M20 6 9 17l-5-5') + ' Copied — paste it anywhere';
    } catch(e){
      btn.innerHTML = 'Could not copy — select text manually';
    }
    setTimeout(() => { btn.innerHTML = original; }, 2200);
  }

  function upcomingDeadline(p){
    return state.calendar.filter(c => c.officialDeadline).sort((a,b)=>a.officialDeadline.localeCompare(b.officialDeadline)).find(c => daysUntil(c.officialDeadline) >= -30);
  }
  function deadlineText(d){ const n = daysUntil(d); if (n===null) return '—'; if (n<0) return `${Math.abs(n)}d overdue`; if (n===0) return 'Due today'; return `${n}d remaining`; }
  function estimateStatusLabel(s){ return {'system-generated':'System-Generated Estimate','partial':'Partial Estimate','accountant-adjusted':'Accountant-Adjusted Estimate','accountant-approved':'Accountant-Approved Estimate','final-filed':'Final Filed Amount','actual-paid':'Actual Paid Amount'}[s] || s; }
  function nextActionFor(p, comp){
    if (state.settings.role === 'accountant'){
      if (p.status === 'ready-for-accountant' || p.status === 'under-accountant-review') return 'Review the monthly figures and record any adjustments needed, then mark the estimate as accountant-approved.';
      if (comp.pct < 100) return 'Waiting on the owner/staff to finish encoding monthly data and documents.';
      return 'No pending accountant action for this period.';
    }
    if (p.status === 'not-started' || p.status === 'data-entry') return 'Finish entering this month’s sales, purchases, expenses, payroll and withholding figures.';
    if (comp.missingDocs > 0) return `Upload the ${comp.missingDocs} missing document(s) in the Document Checklist.`;
    if (p.status === 'data-complete' || p.status === 'documents-missing') return 'Mark the period ready and hand off to your accountant for review.';
    if (p.status === 'accountant-approved') return 'Review the accountant-approved estimate and approve it for filing.';
    if (p.status === 'owner-approval') return 'Go to Owner Approval to approve, return, or place this period on hold.';
    if (p.status === 'approved-for-filing') return 'File the return and record the filing reference in Filings & Payments.';
    if (p.status === 'filed' || p.status === 'payment-pending') return 'Prepare the tax fund and record the payment once made.';
    return 'No action needed right now.';
  }

  // ---------- Data entry ----------
  let dataTab = 'sales';
  function renderDataEntry(el, p){
    const tabs = [['sales','Sales & Branches'],['purchases','Purchases'],['opex','Operating Expenses'],['payroll','Payroll'],['withholding','Withholding'],['previous','Previous Payments'],['bmbe','BMBE'],['other','Other Items']];
    el.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k,l]) => `<button role="tab" data-tab="${k}" aria-selected="${dataTab===k}">${l}</button>`).join('')}</div><div id="tabBody"></div>`;
    el.querySelectorAll('[role="tab"]').forEach(b => b.addEventListener('click', () => { dataTab = b.dataset.tab; renderAll(); }));
    const body = document.getElementById('tabBody');
    const map = {sales:renderTabSales, purchases:renderTabPurchases, opex:renderTabOpex, payroll:renderTabPayroll, withholding:renderTabWithholding, previous:renderTabPrevious, bmbe:renderTabBmbe, other:renderTabOther};
    map[dataTab](body, p);
    markProgress(p);
  }
  function markProgress(p){ if (p.status === 'not-started') { p.status = 'data-entry'; save(); } }

  function bindInputs(container, onEach){
    container.querySelectorAll('input[data-path]').forEach(el => {
      el.addEventListener('input', () => {
        const p = getCurrentPeriod();
        const val = el.type === 'number' ? (parseFloat(el.value)||0) : el.value;
        setPath(p, el.dataset.path, val);
        save();
        if (onEach) onEach();
      });
    });
  }
  function rerenderKeepFocus(){
    const active = document.activeElement;
    const path = active && active.dataset ? active.dataset.path : null;
    const selStart = path && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    renderAll();
    if (path){
      const revived = document.querySelector(`[data-path="${path}"]`);
      if (revived){
        revived.focus();
        if (selStart != null){ try { revived.setSelectionRange(selStart, selStart); } catch(e){} }
      }
    }
  }
  function setPath(obj, path, val){
    const parts = path.split('.'); let cur = obj;
    for (let i=0;i<parts.length-1;i++) cur = cur[parts[i]];
    cur[parts[parts.length-1]] = val;
  }
  function getPath(obj, path){
    return path.split('.').reduce((c,k) => (c==null?c:c[k]), obj);
  }
  function moneyField(label, path, obj, compact){
    const val = getPath(obj, path.split('.').slice(1).join('.')) ?? 0;
    return `<div class="field money-field${compact?' compact':''}"><label>${label}</label><input class="fctl" type="number" step="0.01" min="0" data-path="${path}" value="${val}"></div>`;
  }

  function renderTabSales(el, p){
    const t = computeTotals(p);
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Sales by branch</h3><p class="sub">Business totals are calculated automatically from branch figures.</p></div>
        <div class="table-wrap"><table class="simple-table" id="branchTable"><thead><tr><th>Branch</th><th>Gross Sales</th><th>Discounts</th><th>Refunds</th><th>Net Sales</th></tr></thead><tbody></tbody></table></div>
        <div class="totals-strip">
          <div class="t-item"><div class="l">Total Gross Sales</div><div class="v mono">${peso(t.totalGrossSales)}</div></div>
          <div class="t-item"><div class="l">Total Net Sales</div><div class="v mono">${peso(t.netSales)}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Sales category breakdown</h3><p class="sub">Informational — should reconcile with total gross sales above.</p></div>
        <div class="grid3" id="catFields"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Adjustments to gross sales</h3></div>
        <div class="grid3" id="adjFields"></div>
        <div class="field money-field" style="max-width:280px;">
          <label>Accountant-approved adjustment override (optional)</label>
          <input class="fctl" type="number" step="0.01" data-path="sales.adjustmentOverride" value="${p.sales.adjustmentOverride ?? ''}" placeholder="Leave blank to use sum above">
        </div>
      </div>
    `;
    const tbody = el.querySelector('#branchTable tbody');
    p.sales.branches.forEach((b, i) => {
      const net = (Number(b.gross)||0) - (Number(b.discounts)||0) - (Number(b.refunds)||0);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="font-weight:700;">${b.name}</td>
        <td><input class="fctl mono" style="max-width:130px;" type="number" step="0.01" data-path="sales.branches.${i}.gross" value="${b.gross}"></td>
        <td><input class="fctl mono" style="max-width:130px;" type="number" step="0.01" data-path="sales.branches.${i}.discounts" value="${b.discounts}"></td>
        <td><input class="fctl mono" style="max-width:130px;" type="number" step="0.01" data-path="sales.branches.${i}.refunds" value="${b.refunds}"></td>
        <td class="mono" style="font-weight:700;">${peso(net)}</td>`;
      tbody.appendChild(tr);
    });
    if (!p.sales.branches.length){
      el.querySelector('#branchTable').insertAdjacentHTML('afterend', moneyField('Total Gross Sales (no branches set)', 'sales.manualGross', p.sales, true));
    }
    el.querySelector('#catFields').innerHTML = ['serviceSales','productSales','vipCardSales','voucherSales','otherIncome'].map(k => moneyField(labelize(k), `sales.categories.${k}`, p.sales.categories, true)).join('');
    el.querySelector('#adjFields').innerHTML = Object.keys(p.sales.adjustments).map(k => moneyField(labelize(k), `sales.adjustments.${k}`, p.sales.adjustments, true)).join('');
    bindInputs(el, () => rerenderKeepFocus());
  }
  function labelize(k){ return k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()); }

  function renderTabPurchases(el, p){
    const t = computeTotals(p);
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Monthly purchases</h3></div><div class="grid3" id="pf"></div>
      <div class="totals-strip"><div class="t-item"><div class="l">Total Purchases</div><div class="v mono">${peso(t.purchasesTotal)}</div></div></div>
      </div>`;
    el.querySelector('#pf').innerHTML = PURCHASE_FIELDS.map(([k,l]) => moneyField(l, `purchases.${k}`, p.purchases, true)).join('');
    bindInputs(el, () => rerenderKeepFocus());
  }

  function renderTabOpex(el, p){
    const t = computeTotals(p);
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Operating expenses</h3><p class="sub">Categories aren't auto-classified for tax purposes — your accountant reviews these.</p></div>
      <div class="grid3" id="of"></div>
      <div class="totals-strip"><div class="t-item"><div class="l">Total Operating Expenses</div><div class="v mono">${peso(t.opexTotalRaw)}</div></div></div>
      </div>`;
    el.querySelector('#of').innerHTML = OPEX_FIELDS.map(([k,l]) => moneyField(l, `opex.${k}`, p.opex, true)).join('');
    bindInputs(el, () => rerenderKeepFocus());
  }

  function renderTabPayroll(el, p){
    const t = computeTotals(p);
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Payroll summary</h3></div><div class="grid3" id="pyf"></div></div>
      <div class="card"><div class="card-head"><h3>Retainers / contractors</h3><p class="sub">Accountant classifies workers as employee, retainer, contractor, or needs review.</p></div><div class="grid3" id="rtf"></div>
      <div class="totals-strip"><div class="t-item"><div class="l">Total Payroll & Retainer Payments</div><div class="v mono">${peso(t.payrollTotal)}</div></div></div>
      </div>`;
    el.querySelector('#pyf').innerHTML = PAYROLL_FIELDS.map(([k,l]) => moneyField(l, `payroll.${k}`, p.payroll, true)).join('');
    el.querySelector('#rtf').innerHTML = RETAINER_FIELDS.map(([k,l]) => moneyField(l, `payroll.${k}`, p.payroll, true)).join('');
    bindInputs(el, () => rerenderKeepFocus());
  }

  function renderTabWithholding(el, p){
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Expanded withholding tax (EWT)</h3><p class="sub">Rates and applicability are validated by your accountant, not auto-computed.</p></div>
      <div class="grid3">
        ${moneyField('Total payments potentially subject to EWT','withholding.ewt.potentialBase',p.withholding.ewt,true)}
        ${moneyField('Total approved EWT base','withholding.ewt.approvedBase',p.withholding.ewt,true)}
        ${moneyField('Total EWT withheld','withholding.ewt.withheld',p.withholding.ewt,true)}
        ${moneyField('Total EWT remitted','withholding.ewt.remitted',p.withholding.ewt,true)}
        <div class="field"><label>2307 documents available</label><input class="fctl" type="number" data-path="withholding.ewt.docsAvailable" value="${p.withholding.ewt.docsAvailable}"></div>
        <div class="field"><label>2307 documents missing</label><input class="fctl" type="number" data-path="withholding.ewt.docsMissing" value="${p.withholding.ewt.docsMissing}"></div>
      </div></div>
      <div class="card"><div class="card-head"><h3>Compensation withholding</h3></div>
      <div class="grid3">
        ${moneyField('Total compensation subject to withholding','withholding.comp.subjectWH',p.withholding.comp,true)}
        ${moneyField('Total tax withheld','withholding.comp.withheld',p.withholding.comp,true)}
        ${moneyField('Total tax remitted','withholding.comp.remitted',p.withholding.comp,true)}
      </div></div>`;
    bindInputs(el, () => rerenderKeepFocus());
  }

  function renderTabPrevious(el, p){
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Previous tax payments / credits</h3><button class="btn btn-primary btn-sm" id="addPrev">+ Add entry</button></div>
      <div class="table-wrap"><table class="simple-table"><thead><tr><th>Amount</th><th>Period</th><th>Tax Type</th><th>Reference</th><th>Validated</th><th></th></tr></thead><tbody id="prevBody"></tbody></table></div>
      ${p.previousPayments.length ? '' : '<div class="empty-note">No entries yet.</div>'}
      </div>`;
    const body = el.querySelector('#prevBody');
    p.previousPayments.forEach(x => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mono">${peso(x.amount)}</td><td>${x.period||'—'}</td><td>${x.taxType||'—'}</td><td>${x.reference||'—'}</td>
        <td>${x.validated ? '<span class="badge b-ok">Validated</span>' : '<span class="badge b-warn">Pending</span>'}</td>
        <td><button class="btn btn-ghost btn-sm" data-edit="${x.id}">Edit</button></td>`;
      body.appendChild(tr);
    });
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openPrevModal(p, p.previousPayments.find(x=>x.id===b.dataset.edit))));
    document.getElementById('addPrev').addEventListener('click', () => openPrevModal(p, null));
  }
  function openPrevModal(p, entry){
    const isNew = !entry;
    showModal(isNew ? 'Add previous payment / credit' : 'Edit entry', `
      <div class="field money-field"><label>Amount</label><input class="fctl" id="pvAmt" type="number" step="0.01" value="${entry?entry.amount:0}"></div>
      <div class="field"><label>Period</label><input class="fctl" id="pvPeriod" type="text" placeholder="e.g. Q2 2026" value="${entry?entry.period:''}"></div>
      <div class="field"><label>Tax Type</label><input class="fctl" id="pvType" type="text" placeholder="e.g. Percentage Tax" value="${entry?entry.taxType:''}"></div>
      <div class="field"><label>Reference</label><input class="fctl" id="pvRef" type="text" value="${entry?entry.reference:''}"></div>
      <div class="field"><label><input type="checkbox" id="pvValid" ${entry&&entry.validated?'checked':''}> Accountant-validated</label></div>
    `, [
      ...(isNew?[]:[{label:'Delete', cls:'btn-danger', action: () => { p.previousPayments = p.previousPayments.filter(x=>x.id!==entry.id); save(); closeModal(); renderAll(); }}]),
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const data = {amount: parseFloat(document.getElementById('pvAmt').value)||0, period: document.getElementById('pvPeriod').value, taxType: document.getElementById('pvType').value, reference: document.getElementById('pvRef').value, validated: document.getElementById('pvValid').checked};
        if (isNew) p.previousPayments.push(Object.assign({id:uid()}, data));
        else Object.assign(entry, data);
        save(); closeModal(); renderAll();
      }}
    ]);
  }

  function renderTabBmbe(el, p){
    const b = state.bmbe;
    el.innerHTML = `<div class="card"><div class="card-head"><h3>BMBE registration</h3><span class="badge ${b.status==='active'?'b-ok':b.status==='expired'?'b-danger':'b-neutral'}">${labelize(b.status)}</span></div>
      <div class="grid2">
        <div class="field"><label>BMBE Certificate Number</label><input class="fctl" id="bCert" value="${b.certNumber}"></div>
        <div class="field"><label>Registered Business Name</label><input class="fctl" id="bName" value="${b.businessName}"></div>
        <div class="field"><label>Registered Branch</label><input class="fctl" id="bBranch" value="${b.branch}"></div>
        <div class="field"><label>Status</label><select class="fctl" id="bStatus">${['active','expired','pending-validation','not-applicable','needs-renewal'].map(s=>`<option value="${s}" ${b.status===s?'selected':''}>${labelize(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Effective Date</label><input class="fctl" id="bEff" type="date" value="${b.effectiveDate}"></div>
        <div class="field"><label>Expiration Date</label><input class="fctl" id="bExp" type="date" value="${b.expirationDate}"></div>
      </div>
      <div class="field"><label>Certificate upload</label><input class="fctl" id="bFile" type="file" accept="image/*,.pdf">
        ${b.certFile ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:4px;">Attached: <a href="${b.certFile.url}" target="_blank" rel="noopener" style="color:var(--brand);">${b.certFile.name}</a></div>` : ''}
      </div>
      <div class="field"><label><input type="checkbox" id="bExempt" ${b.exemptionConfirmed?'checked':''}> Accountant confirms income tax exemption applies for this registration</label></div>
      <div class="banner info">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>An active certificate alone does not zero out income tax — exemption is only applied to estimates once the box above is checked by the accountant.</span></div>
      <button class="btn btn-primary" id="bSave">Save BMBE info</button>
      </div>`;
    document.getElementById('bFile').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      uploadFile(f, 'bmbe', (fileObj) => { b.certFile = fileObj; save(); renderAll(); });
    });
    document.getElementById('bSave').addEventListener('click', () => {
      const before = JSON.stringify(b);
      b.certNumber = document.getElementById('bCert').value; b.businessName = document.getElementById('bName').value;
      b.branch = document.getElementById('bBranch').value; b.status = document.getElementById('bStatus').value;
      b.effectiveDate = document.getElementById('bEff').value; b.expirationDate = document.getElementById('bExp').value;
      b.exemptionConfirmed = document.getElementById('bExempt').checked;
      if (before !== JSON.stringify(b)) logAudit('BMBE info updated', 'BMBE', '', b.status);
      save(); renderAll();
    });
  }

  function renderTabOther(el, p){
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Other tax-related items</h3><button class="btn btn-primary btn-sm" id="addOther">+ Add item</button></div>
      <div class="table-wrap"><table class="simple-table"><thead><tr><th>Label</th><th>Category</th><th>Amount</th><th>Notes</th><th></th></tr></thead><tbody id="otherBody"></tbody></table></div>
      ${p.otherItems.length ? '' : '<div class="empty-note">No additional items. Use this for tax credits, exemptions, or other accountant-approved adjustments not covered above.</div>'}
      </div>`;
    const body = el.querySelector('#otherBody');
    p.otherItems.forEach(x => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${x.label}</td><td><span class="badge b-neutral">${labelize(x.category)}</span></td><td class="mono">${peso(x.amount)}</td><td style="color:var(--ink-faint);font-size:12px;">${x.notes||'—'}</td><td><button class="btn btn-ghost btn-sm" data-edit="${x.id}">Edit</button></td>`;
      body.appendChild(tr);
    });
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openOtherModal(p, p.otherItems.find(x=>x.id===b.dataset.edit))));
    document.getElementById('addOther').addEventListener('click', () => openOtherModal(p, null));
  }
  function openOtherModal(p, entry){
    const isNew = !entry;
    showModal(isNew?'Add other item':'Edit item', `
      <div class="field"><label>Label</label><input class="fctl" id="oLabel" value="${entry?entry.label:''}" placeholder="e.g. Prior year tax credit"></div>
      <div class="field"><label>Category</label><select class="fctl" id="oCat">${['credit','adjustment','exemption','tax','other'].map(c=>`<option value="${c}" ${entry&&entry.category===c?'selected':''}>${labelize(c)}</option>`).join('')}</select></div>
      <div class="field money-field"><label>Amount</label><input class="fctl" id="oAmt" type="number" step="0.01" value="${entry?entry.amount:0}"></div>
      <div class="field"><label>Notes</label><textarea class="fctl" id="oNotes">${entry?entry.notes:''}</textarea></div>
    `, [
      ...(isNew?[]:[{label:'Delete', cls:'btn-danger', action:()=>{ p.otherItems = p.otherItems.filter(x=>x.id!==entry.id); save(); closeModal(); renderAll(); }}]),
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const data = {label:document.getElementById('oLabel').value, category:document.getElementById('oCat').value, amount: parseFloat(document.getElementById('oAmt').value)||0, notes:document.getElementById('oNotes').value};
        if (isNew) p.otherItems.push(Object.assign({id:uid()}, data)); else Object.assign(entry, data);
        save(); closeModal(); renderAll();
      }}
    ]);
  }

  // ---------- Documents ----------
  function renderDocuments(el, p){
    const comp = computeCompleteness(p);
    const groups = {};
    p.documents.forEach(d => { (groups[d.category] = groups[d.category]||[]).push(d); });
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Document completeness</h3><span class="badge ${comp.missingDocs?'b-warn':'b-ok'}">${comp.missingDocs} missing</span></div><div class="progress-bar"><div style="width:${Math.round((p.documents.filter(d=>d.status!=='missing').length/p.documents.length)*100)}%;"></div></div></div>
      ${Object.entries(groups).map(([cat, items]) => `
        <div class="card"><div class="card-head"><h3>${cat}</h3></div>${items.map(d => `
          <div class="checklist-item">
            <span class="name">${d.name}</span>
            <select class="fctl" style="width:auto;" data-doc="${d.id}">${DOC_STATUSES.map(s=>`<option value="${s}" ${d.status===s?'selected':''}>${DOC_STATUS_LABEL[s]}</option>`).join('')}</select>
            ${d.file ? `<a href="${d.file.url}" target="_blank" rel="noopener" class="filebtn" style="text-decoration:underline;">📎 ${d.file.name}</a>` : ''}
            <label class="filebtn">${d.file ? 'Replace' : 'Attach'} <input type="file" data-docfile="${d.id}" style="display:none;"></label>
          </div>`).join('')}</div>
      `).join('')}`;
    el.querySelectorAll('[data-doc]').forEach(sel => sel.addEventListener('change', () => {
      const doc = p.documents.find(d=>d.id===sel.dataset.doc);
      const prev = doc.status; doc.status = sel.value;
      logAudit('Document status changed', doc.name, DOC_STATUS_LABEL[prev], DOC_STATUS_LABEL[doc.status]);
      save(); renderAll();
    }));
    el.querySelectorAll('[data-docfile]').forEach(inp => inp.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const doc = p.documents.find(d=>d.id===inp.dataset.docfile);
      uploadFile(f, `documents/${p.id}/${doc.id}`, (fileObj) => {
        doc.file = fileObj; if (doc.status === 'missing') doc.status = 'uploaded';
        logAudit('Document uploaded', doc.name, '', fileObj.name);
        save(); renderAll();
      });
    }));
  }

  // ---------- Estimate ----------
  function renderEstimate(el, p){
    const t = computeTotals(p);
    el.innerHTML = `
      <div class="banner info">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span><strong>ESTIMATED ONLY — SUBJECT TO ACCOUNTANT REVIEW.</strong> This is not a final tax due, exact amount, or confirmed BIR figure.</span></div>
      <div class="grid2">
        <div class="card"><div class="l flabel">Estimated Percentage Tax</div><div class="v mono" style="font-size:22px;font-weight:800;">${peso(t.percentageTax)}</div><span class="badge b-neutral">${p.approved.percentageTaxApplicable ? 'Applicable' : 'Not applicable'}</span></div>
        <div class="card"><div class="l flabel">Estimated Income Tax</div><div class="v mono" style="font-size:22px;font-weight:800;">${peso(t.incomeTax)}</div><span class="badge b-neutral">${p.approved.incomeTaxApplicable ? (t.bmbeExempt ? 'BMBE exempt' : 'Applicable') : 'Not applicable'}</span></div>
        <div class="card"><div class="l flabel">Estimated EWT (reference)</div><div class="v mono" style="font-size:22px;font-weight:800;">${peso(t.estEWT)}</div></div>
        <div class="card"><div class="l flabel">Estimated Compensation Withholding (reference)</div><div class="v mono" style="font-size:22px;font-weight:800;">${peso(t.estCompWH)}</div></div>
        <div class="card"><div class="l flabel">Other Taxes</div><div class="v mono" style="font-size:22px;font-weight:800;">${peso(t.otherTaxTotal)}</div></div>
        <div class="card" style="background:var(--surface-soft);"><div class="l flabel">Total Estimated Tax (all lines)</div><div class="v mono" style="font-size:22px;font-weight:800;">${peso(t.totalEstimatedTaxAll)}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Cash to prepare</h3><p class="sub">Percentage tax + income tax + other taxes — excludes EWT/compensation withholding already remitted.</p></div>
        <div class="v mono" style="font-size:26px;font-weight:800;">${peso(t.cashToPrepare)}</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;">
          <span class="badge b-brand">${estimateStatusLabel(t.estimateStatus)}</span>
          <button class="btn btn-ghost btn-sm no-print" id="btnCopyAccountant2">${icon('M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2ZM16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2')} Copy summary for Accountant</button>
        </div>
      </div>
      <details class="card"><summary style="cursor:pointer;font-weight:800;font-size:13px;">View computation</summary>
        <div class="table-wrap" style="margin-top:12px;"><table class="simple-table">
          <tbody>
            <tr><td>Gross Sales</td><td class="mono">${peso(t.totalGrossSales)}</td></tr>
            <tr><td>Less: Approved Adjustments</td><td class="mono">−${peso(t.totalAdjustments)}</td></tr>
            <tr><td style="font-weight:700;">Net / Taxable Sales</td><td class="mono" style="font-weight:700;">${peso(t.taxableSales)}</td></tr>
            <tr><td>Percentage Tax Rate</td><td class="mono">${(t.pctRate*100).toFixed(2)}%</td></tr>
            <tr><td style="font-weight:700;">Estimated Percentage Tax</td><td class="mono" style="font-weight:700;">${peso(t.percentageTax)}</td></tr>
            <tr><td colspan="2" style="border-top:2px solid var(--rule-strong);padding-top:14px;"></td></tr>
            <tr><td>Taxable Sales</td><td class="mono">${peso(t.taxableSales)}</td></tr>
            <tr><td>Less: Approved Purchases</td><td class="mono">−${peso(t.purchasesApproved)}</td></tr>
            <tr><td>Less: Approved Operating Expenses</td><td class="mono">−${peso(t.opexApproved)}</td></tr>
            <tr><td style="font-weight:700;">Estimated Taxable Income</td><td class="mono" style="font-weight:700;">${peso(t.taxableIncome)}</td></tr>
            <tr><td>Income Tax Rate</td><td class="mono">${(t.incRate*100).toFixed(2)}%</td></tr>
            <tr><td>Estimated Tax Before Credits</td><td class="mono">${peso(t.incomeTaxBeforeCredits)}</td></tr>
            <tr><td>Less: Credits (CWT, previous payments, other)</td><td class="mono">−${peso(t.credits)}</td></tr>
            <tr><td style="font-weight:700;">Estimated Income Tax Payable</td><td class="mono" style="font-weight:700;">${peso(t.incomeTax)}</td></tr>
          </tbody>
        </table></div>
      </details>
    `;
    const copyBtn2 = document.getElementById('btnCopyAccountant2');
    if (copyBtn2) copyBtn2.addEventListener('click', () => copySummaryForAccountant(p, copyBtn2));
  }

  // ---------- Accountant review ----------
  function renderAccountant(el, p){
    const t = computeTotals(p);
    const canAct = state.settings.role !== 'owner';
    el.innerHTML = `
      ${!canAct ? `<div class="banner info">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Switch the role to Accountant or Admin in the sidebar to make adjustments.</span></div>` : ''}
      <div class="card">
        <div class="card-head"><h3>Tax applicability & rates</h3></div>
        <div class="grid4">
          <div class="field"><label><input type="checkbox" id="accPct" ${p.approved.percentageTaxApplicable?'checked':''} ${canAct?'':'disabled'}> Percentage tax applies</label></div>
          <div class="field"><label>Percentage tax rate</label><input class="fctl" id="accPctRate" type="number" step="0.001" value="${p.approved.percentageTaxRateOverride ?? state.settings.percentageTaxRate}" ${canAct?'':'disabled'}></div>
          <div class="field"><label><input type="checkbox" id="accInc" ${p.approved.incomeTaxApplicable?'checked':''} ${canAct?'':'disabled'}> Income tax applies</label></div>
          <div class="field"><label>Income tax rate</label><input class="fctl" id="accIncRate" type="number" step="0.001" value="${p.approved.incomeTaxRateOverride ?? state.settings.incomeTaxRate}" ${canAct?'':'disabled'}></div>
        </div>
        ${canAct ? '<button class="btn btn-primary btn-sm" id="accSaveSettings">Save settings</button>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Adjustments</h3><p class="sub">Original figures are never overwritten — every adjustment is logged.</p></div>
        ${canAct ? `<div class="adj-row" style="margin-bottom:14px;">
          <div class="field" style="margin:0;"><label>Field</label><select class="fctl" id="adjField">
            <option value="taxableSalesOverride">Taxable Sales</option>
            <option value="opexOverride">Operating Expenses</option>
            <option value="purchasesOverride">Purchases</option>
            <option value="otherCreditsOverride">Other Credits</option>
          </select></div>
          <div class="field" style="margin:0;"><label>New amount</label><input class="fctl" id="adjAmt" type="number" step="0.01"></div>
          <div class="field" style="margin:0;"><label>Reason</label><input class="fctl" id="adjReason" type="text" placeholder="e.g. Non-deductible, needs exclusion"></div>
          <button class="btn btn-primary" id="adjAdd">Add</button>
        </div>` : ''}
        <div class="table-wrap"><table class="simple-table"><thead><tr><th>Field</th><th>Original</th><th>Adjusted</th><th>Difference</th><th>Reason</th><th>By</th><th>Date</th></tr></thead><tbody>
          ${p.adjustments.slice().reverse().map(a => `<tr><td>${a.fieldLabel}</td><td class="mono">${peso(a.original)}</td><td class="mono">${peso(a.adjusted)}</td><td class="mono">${peso(a.adjusted-a.original)}</td><td>${a.reason||'—'}</td><td>${a.accountant||'—'}</td><td>${a.date}</td></tr>`).join('')}
        </tbody></table></div>
        ${p.adjustments.length ? '' : '<div class="empty-note">No adjustments recorded yet.</div>'}
      </div>
      ${canAct ? `<div class="card"><div class="card-head"><h3>Move to accountant-approved</h3></div>
        <p style="font-size:13px;color:var(--ink-soft);">Current estimate: <strong class="mono">${peso(t.cashToPrepare)}</strong></p>
        <button class="btn btn-primary" id="accApprove">Mark Accountant-Approved & send to owner</button>
      </div>` : ''}
    `;
    if (canAct){
      document.getElementById('accSaveSettings').addEventListener('click', () => {
        p.approved.percentageTaxApplicable = document.getElementById('accPct').checked;
        p.approved.percentageTaxRateOverride = parseFloat(document.getElementById('accPctRate').value)||0;
        p.approved.incomeTaxApplicable = document.getElementById('accInc').checked;
        p.approved.incomeTaxRateOverride = parseFloat(document.getElementById('accIncRate').value)||0;
        logAudit('Tax setting changed', p.label, '', 'Applicability/rates updated');
        save(); renderAll();
      });
      document.getElementById('adjAdd').addEventListener('click', () => {
        const field = document.getElementById('adjField').value;
        const labelMap = {taxableSalesOverride:'Taxable Sales', opexOverride:'Operating Expenses', purchasesOverride:'Purchases', otherCreditsOverride:'Other Credits'};
        const originalMap = {taxableSalesOverride:t.netSales, opexOverride:t.opexTotalRaw, purchasesOverride:t.purchasesTotal, otherCreditsOverride:0};
        const newVal = parseFloat(document.getElementById('adjAmt').value)||0;
        const reason = document.getElementById('adjReason').value;
        const original = p.approved[field] != null ? p.approved[field] : originalMap[field];
        p.adjustments.push({id:uid(), field, fieldLabel:labelMap[field], original, adjusted:newVal, reason, accountant: state.settings.actingName||'(unnamed)', date: todayStr()});
        p.approved[field] = newVal;
        if (p.status !== 'accountant-adjusted') p.status = 'accountant-adjusted';
        logAudit('Accountant adjustment made', labelMap[field], peso(original), peso(newVal), reason);
        save(); renderAll();
      });
      const btnA = document.getElementById('accApprove');
      if (btnA) btnA.addEventListener('click', () => {
        p.status = 'accountant-approved'; p.ownerAction.status = 'awaiting';
        logAudit('Estimate approved', p.label, '', 'Accountant-approved, sent to owner');
        save(); renderAll();
      });
    }
  }
  function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  // ---------- Owner approval ----------
  function renderOwner(el, p){
    const t = computeTotals(p);
    const cal = state.calendar.find(c => c.form && p.filing.form && c.form.includes(p.filing.form)) || upcomingDeadline(p);
    const canAct = state.settings.role !== 'accountant';
    el.innerHTML = `
      <div class="card">
        <div class="grid2">
          <div><div class="flabel">Tax Period</div><div style="font-size:18px;font-weight:800;">${p.label}</div></div>
          <div><div class="flabel">Status</div><span class="badge b-brand">${STATUS_LABEL[p.status]}</span></div>
          <div><div class="flabel">System estimate</div><div class="mono" style="font-size:16px;">${peso(t.cashToPrepare - p.adjustments.reduce((s,a)=>s+(a.adjusted-a.original),0))}</div></div>
          <div><div class="flabel">Accountant adjustment</div><div class="mono" style="font-size:16px;">${peso(p.adjustments.reduce((s,a)=>s+(a.adjusted-a.original),0))}</div></div>
          <div><div class="flabel">Accountant-approved estimate</div><div class="mono" style="font-size:18px;font-weight:800;">${peso(t.cashToPrepare)}</div></div>
          <div><div class="flabel">Deadline</div><div class="mono">${cal ? fmtDate(cal.officialDeadline) : '—'} ${cal?`· ${deadlineText(cal.officialDeadline)}`:''}</div></div>
        </div>
      </div>
      ${p.ownerAction.status !== 'awaiting' ? `<div class="banner info">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Last action: <strong>${labelize(p.ownerAction.status)}</strong> on ${p.ownerAction.date} by ${p.ownerAction.by}${p.ownerAction.comment?` — "${p.ownerAction.comment}"`:''}</span></div>` : ''}
      ${canAct ? `<div class="card">
        <div class="card-head"><h3>Owner action</h3></div>
        <div class="field"><label>Comment (required for return / hold / clarification)</label><textarea class="fctl" id="ownerComment"></textarea></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="ownApprove">Approve for Filing</button>
          <button class="btn btn-ghost" id="ownReturn">Return to Accountant</button>
          <button class="btn btn-ghost" id="ownClarify">Request Clarification</button>
          <button class="btn btn-ghost" id="ownHold">Place on Hold</button>
        </div>
      </div>` : `<div class="banner info">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Switch role to Owner or Admin to take action here.</span></div>`}
    `;
    if (canAct){
      const act = (statusVal, needsComment, periodStatus) => {
        const comment = document.getElementById('ownerComment').value;
        if (needsComment && !comment.trim()){ alert('A comment is required for this action.'); return; }
        p.ownerAction = {status: statusVal, comment, date: todayStr(), by: state.settings.actingName||'(unnamed)'};
        if (periodStatus) p.status = periodStatus;
        logAudit('Owner approved' === statusVal ? 'Owner approved' : `Owner action: ${labelize(statusVal)}`, p.label, '', statusVal, comment);
        save(); renderAll();
      };
      document.getElementById('ownApprove').addEventListener('click', () => act('approved', false, 'approved-for-filing'));
      document.getElementById('ownReturn').addEventListener('click', () => act('returned', true, 'under-accountant-review'));
      document.getElementById('ownClarify').addEventListener('click', () => act('clarification', true, p.status));
      document.getElementById('ownHold').addEventListener('click', () => act('hold', true, 'on-hold'));
    }
  }

  // ---------- Tax calendar ----------
  function renderCalendar(el){
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Tax calendar</h3><button class="btn btn-primary btn-sm" id="addCal">+ Add deadline</button></div>
      <div class="table-wrap"><table class="simple-table"><thead><tr><th>Form</th><th>Type</th><th>Covered Period</th><th>Official Deadline</th><th>Days Remaining</th><th>Status</th><th></th></tr></thead><tbody id="calBody"></tbody></table></div>
      </div>`;
    const body = el.querySelector('#calBody');
    state.calendar.slice().sort((a,b)=> (a.officialDeadline||'9999').localeCompare(b.officialDeadline||'9999')).forEach(c => {
      const n = daysUntil(c.officialDeadline);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="font-weight:700;">${c.form}</td><td>${c.taxType}</td><td>${c.coveredPeriod}</td>
        <td class="mono">${fmtDate(c.officialDeadline)}</td>
        <td>${c.officialDeadline ? `<span class="badge ${n<0?'b-danger':n<=7?'b-warn':'b-neutral'}">${deadlineText(c.officialDeadline)}</span>` : '—'}</td>
        <td><span class="badge b-neutral">${labelize(c.status)}</span></td>
        <td><button class="btn btn-ghost btn-sm" data-edit="${c.id}">Edit</button></td>`;
      body.appendChild(tr);
    });
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openCalModal(state.calendar.find(c=>c.id===b.dataset.edit))));
    document.getElementById('addCal').addEventListener('click', () => openCalModal(null));
  }
  function openCalModal(c){
    const isNew = !c;
    showModal(isNew?'Add deadline':'Edit deadline', `
      <div class="field"><label>Form</label><input class="fctl" id="cForm" value="${c?c.form:''}"></div>
      <div class="field"><label>Tax Type</label><input class="fctl" id="cType" value="${c?c.taxType:''}"></div>
      <div class="field"><label>Covered Period</label><input class="fctl" id="cCov" value="${c?c.coveredPeriod:''}"></div>
      <div class="field"><label>Official Deadline</label><input class="fctl" id="cOff" type="date" value="${c?c.officialDeadline:''}"></div>
      <div class="field"><label>Internal Deadline</label><input class="fctl" id="cInt" type="date" value="${c?c.internalDeadline:''}"></div>
      <div class="field"><label>Accountant Deadline</label><input class="fctl" id="cAcc" type="date" value="${c?c.accountantDeadline:''}"></div>
      <div class="field"><label>Owner Approval Deadline</label><input class="fctl" id="cOwn" type="date" value="${c?c.ownerDeadline:''}"></div>
    `, [
      ...(isNew?[]:[{label:'Delete', cls:'btn-danger', action:()=>{ state.calendar = state.calendar.filter(x=>x.id!==c.id); save(); closeModal(); renderAll(); }}]),
      {label:'Cancel', cls:'btn-ghost', action: closeModal},
      {label:'Save', cls:'btn-primary', action: () => {
        const data = {form:document.getElementById('cForm').value, taxType:document.getElementById('cType').value, coveredPeriod:document.getElementById('cCov').value, officialDeadline:document.getElementById('cOff').value, internalDeadline:document.getElementById('cInt').value, accountantDeadline:document.getElementById('cAcc').value, ownerDeadline:document.getElementById('cOwn').value};
        if (isNew) state.calendar.push(Object.assign({id:uid(), status:'pending', paymentStatus:'not-applicable'}, data));
        else Object.assign(c, data);
        save(); closeModal(); renderAll();
      }}
    ]);
  }

  // ---------- Filing & payment ----------
  function renderFiling(el, p){
    const f = p.filing;
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Filing & payment record — ${p.label}</h3><span class="badge b-brand">${FILING_STATUS_LABEL[f.status]}</span></div>
      <div class="grid2">
        <div class="field"><label>BIR Form</label><input class="fctl" data-path="filing.form" value="${f.form}"></div>
        <div class="field"><label>Covered Period</label><input class="fctl" data-path="filing.coveredPeriod" value="${f.coveredPeriod}"></div>
        <div class="field money-field"><label>Final Tax Payable</label><input class="fctl" type="number" step="0.01" data-path="filing.finalTaxPayable" value="${f.finalTaxPayable}"></div>
        <div class="field"><label>Status</label><select class="fctl" data-path="filing.status">${FILING_STATUSES.map(s=>`<option value="${s}" ${f.status===s?'selected':''}>${FILING_STATUS_LABEL[s]}</option>`).join('')}</select></div>
        <div class="field"><label>Filing Date</label><input class="fctl" type="date" data-path="filing.filingDate" value="${f.filingDate}"></div>
        <div class="field"><label>Filing Platform</label><input class="fctl" data-path="filing.platform" placeholder="eBIRForms / eFPS" value="${f.platform}"></div>
        <div class="field"><label>Filing Reference Number</label><input class="fctl" data-path="filing.referenceNumber" value="${f.referenceNumber}"></div>
        <div class="field"><label>Payment Date</label><input class="fctl" type="date" data-path="filing.paymentDate" value="${f.paymentDate}"></div>
        <div class="field money-field"><label>Payment Amount</label><input class="fctl" type="number" step="0.01" data-path="filing.paymentAmount" value="${f.paymentAmount}"></div>
        <div class="field"><label>Payment Method</label><input class="fctl" data-path="filing.paymentMethod" value="${f.paymentMethod}"></div>
        <div class="field"><label>Payment Reference</label><input class="fctl" data-path="filing.paymentReference" value="${f.paymentReference}"></div>
        <div class="field"><label>Filed By</label><input class="fctl" data-path="filing.filedBy" value="${f.filedBy}"></div>
        <div class="field"><label>Reviewed By</label><input class="fctl" data-path="filing.reviewedBy" value="${f.reviewedBy}"></div>
        <div class="field"><label>Approved By</label><input class="fctl" data-path="filing.approvedBy" value="${f.approvedBy}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Proof of filing</label><input class="fctl" type="file" id="pfFile">${f.proofFiling?`<div style="font-size:12px;margin-top:4px;">📎 <a href="${f.proofFiling.url}" target="_blank" rel="noopener" style="color:var(--brand);">${f.proofFiling.name}</a></div>`:''}</div>
        <div class="field"><label>Proof of payment</label><input class="fctl" type="file" id="ppFile">${f.proofPayment?`<div style="font-size:12px;margin-top:4px;">📎 <a href="${f.proofPayment.url}" target="_blank" rel="noopener" style="color:var(--brand);">${f.proofPayment.name}</a></div>`:''}</div>
      </div>
      <button class="btn btn-primary" id="filingSave">Save filing record</button>
      </div>`;
    bindInputs(el);
    document.getElementById('pfFile').addEventListener('change', e => { const file=e.target.files[0]; if(!file) return; uploadFile(file, `filing/${p.id}/proof-filing`, fo => { f.proofFiling = fo; save(); renderAll(); }); });
    document.getElementById('ppFile').addEventListener('change', e => { const file=e.target.files[0]; if(!file) return; uploadFile(file, `filing/${p.id}/proof-payment`, fo => { f.proofPayment = fo; save(); renderAll(); }); });
    document.getElementById('filingSave').addEventListener('click', () => {
      if (['filed','payment-pending','paid','completed'].includes(f.status) && p.status !== 'completed') p.status = f.status === 'paid' || f.status === 'completed' ? f.status : f.status;
      logAudit('Filing recorded', p.label, '', f.status);
      save(); renderAll();
    });
  }

  // ---------- Tax fund ----------
  function renderFund(el, p){
    const t = computeTotals(p);
    const reserved = Number(p.taxFund.reserved)||0;
    const shortfall = t.cashToPrepare - reserved;
    const cal = upcomingDeadline(p);
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Tax fund preparation — ${p.label}</h3></div>
      <div class="grid2">
        <div><div class="flabel">Estimated Tax</div><div class="mono" style="font-size:20px;font-weight:800;">${peso(t.cashToPrepare)}</div></div>
        <div><div class="flabel">Already Reserved</div><div class="field money-field compact" style="max-width:220px;margin-top:6px;"><input class="fctl" type="number" step="0.01" data-path="taxFund.reserved" value="${reserved}"></div></div>
        <div><div class="flabel">Possible Shortfall</div><div class="mono" style="font-size:20px;font-weight:800;color:${shortfall>0?'var(--danger)':'var(--ok)'};">${peso(Math.max(shortfall,0))}</div></div>
        <div><div class="flabel">Deadline</div><div class="mono">${cal?fmtDate(cal.officialDeadline):'—'} ${cal?`· ${deadlineText(cal.officialDeadline)}`:''}</div></div>
      </div>
      <div class="banner" style="margin-top:14px;">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Money marked as "Reserved" is a planning figure only — it is not an actual BIR payment until recorded in Filings & Payments.</span></div>
      </div>`;
    bindInputs(el, () => rerenderKeepFocus());
  }

  // ---------- Period comparison ----------
  function renderCompare(el){
    if (state.periods.length < 2){ el.innerHTML = `<div class="card empty-note">Create at least two tax periods to compare them.</div>`; return; }
    const sorted = state.periods.slice().sort((a,b)=>(b.year-a.year)||(b.month-a.month));
    el.innerHTML = `<div class="card"><div class="grid2">
      <div class="field"><label>Period A</label><select class="fctl" id="cmpA">${sorted.map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</select></div>
      <div class="field"><label>Period B</label><select class="fctl" id="cmpB">${sorted.map((p,i)=>`<option value="${p.id}" ${i===1?'selected':''}>${p.label}</option>`).join('')}</select></div>
      </div></div><div id="cmpResult"></div>`;
    const run = () => {
      const a = getPeriod(document.getElementById('cmpA').value), b = getPeriod(document.getElementById('cmpB').value);
      const ta = computeTotals(a), tb = computeTotals(b);
      const row = (label, va, vb) => `<tr><td>${label}</td><td class="mono">${peso(va)}</td><td class="mono">${peso(vb)}</td><td class="mono" style="color:${vb-va>=0?'var(--ok)':'var(--danger)'};">${vb-va>=0?'+':''}${peso(vb-va)}</td></tr>`;
      document.getElementById('cmpResult').innerHTML = `<div class="card"><div class="table-wrap"><table class="simple-table"><thead><tr><th></th><th>${a.label}</th><th>${b.label}</th><th>Change</th></tr></thead><tbody>
        ${row('Net Sales', ta.netSales, tb.netSales)}
        ${row('Total Purchases', ta.purchasesTotal, tb.purchasesTotal)}
        ${row('Operating Expenses', ta.opexTotalRaw, tb.opexTotalRaw)}
        ${row('Estimated Tax (cash to prepare)', ta.cashToPrepare, tb.cashToPrepare)}
      </tbody></table></div></div>`;
    };
    document.getElementById('cmpA').addEventListener('change', run); document.getElementById('cmpB').addEventListener('change', run);
    run();
  }

  // ---------- Reports ----------
  async function saveFile(filename, data){
    if (window.claude && window.claude.use){
      const downloads = await window.claude.use('downloads');
      if (downloads){
        try { await downloads.save({filename, data}); return; }
        catch(e){ if (e && e.code !== 'declined') alert('Could not save file: ' + (e.message||e.code||'unknown error')); return; }
      }
    }
    const blob = data instanceof Blob ? data : new Blob([data], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function csvDownloadable(filename, rows){
    const csv = rows.map(r => r.map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    saveFile(filename, csv);
  }
  function renderReports(el){
    const p = getCurrentPeriod();
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Export reports</h3><p class="sub">CSV opens directly in Excel or Google Sheets. Use Print for a PDF copy.</p></div>
      <div class="grid3" id="reportBtns"></div>
      </div>
      ${p ? `<div class="card print-only" id="printSummary"></div>` : ''}
    `;
    const reports = [
      ['Monthly BIR Summary (current period)', () => printSummary(p)],
      ['Sales Summary (CSV)', () => exportSalesCsv()],
      ['Expense Summary (CSV)', () => exportExpenseCsv()],
      ['Withholding Summary (CSV)', () => exportWithholdingCsv()],
      ['Missing Documents Report (CSV)', () => exportDocsCsv()],
      ['Tax Calendar (CSV)', () => exportCalendarCsv()],
      ['Filing History (CSV)', () => exportFilingCsv()],
      ['Audit Trail (CSV)', () => exportAuditCsv()],
    ];
    const box = el.querySelector('#reportBtns');
    reports.forEach(([label, fn]) => {
      const b = document.createElement('button'); b.className = 'btn btn-ghost'; b.textContent = label;
      b.addEventListener('click', fn); box.appendChild(b);
    });
  }
  function exportSalesCsv(){
    const rows = [['Period','Branch','Gross','Discounts','Refunds','Net']];
    state.periods.forEach(p => p.sales.branches.forEach(b => rows.push([p.label, b.name, b.gross, b.discounts, b.refunds, (Number(b.gross)||0)-(Number(b.discounts)||0)-(Number(b.refunds)||0)])));
    csvDownloadable('sales-summary.csv', rows);
  }
  function exportExpenseCsv(){
    const rows = [['Period', ...OPEX_FIELDS.map(([,l])=>l), 'Total']];
    state.periods.forEach(p => { const vals = OPEX_FIELDS.map(([k])=>p.opex[k]||0); rows.push([p.label, ...vals, vals.reduce((s,v)=>s+v,0)]); });
    csvDownloadable('expense-summary.csv', rows);
  }
  function exportWithholdingCsv(){
    const rows = [['Period','EWT Withheld','EWT Remitted','Comp WH Withheld','Comp WH Remitted']];
    state.periods.forEach(p => rows.push([p.label, p.withholding.ewt.withheld, p.withholding.ewt.remitted, p.withholding.comp.withheld, p.withholding.comp.remitted]));
    csvDownloadable('withholding-summary.csv', rows);
  }
  function exportDocsCsv(){
    const rows = [['Period','Category','Document','Status']];
    state.periods.forEach(p => p.documents.filter(d=>d.status==='missing').forEach(d => rows.push([p.label, d.category, d.name, d.status])));
    csvDownloadable('missing-documents.csv', rows);
  }
  function exportCalendarCsv(){
    const rows = [['Form','Tax Type','Covered Period','Official Deadline','Status']];
    state.calendar.forEach(c => rows.push([c.form, c.taxType, c.coveredPeriod, c.officialDeadline, c.status]));
    csvDownloadable('tax-calendar.csv', rows);
  }
  function exportFilingCsv(){
    const rows = [['Period','Form','Status','Filing Date','Reference','Payment Date','Payment Amount']];
    state.periods.forEach(p => rows.push([p.label, p.filing.form, p.filing.status, p.filing.filingDate, p.filing.referenceNumber, p.filing.paymentDate, p.filing.paymentAmount]));
    csvDownloadable('filing-history.csv', rows);
  }
  function exportAuditCsv(){
    const rows = [['Date','User','Role','Action','Target','Previous','New','Reason']];
    state.auditTrail.forEach(a => rows.push([fmtDateTime(a.ts), a.user, a.role, a.action, a.target, a.prev, a.next, a.reason]));
    csvDownloadable('audit-trail.csv', rows);
  }
  function printSummary(p){
    if (!p){ alert('Select a tax period first.'); return; }
    const t = computeTotals(p);
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:#fff;color:#000;z-index:200;overflow:auto;padding:40px;';
    box.innerHTML = `
      <button id="closePrint" style="float:right;" class="btn btn-ghost no-print">Close</button>
      <h1 style="font-size:22px;">BIR Monthly Summary</h1>
      <p>Business: ${state.settings.businessName}<br>Tax Period: ${p.label} (Q${p.quarter} ${p.year})</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;" border="1" cellpadding="8">
        <tr><td>Gross Sales</td><td>${peso(t.totalGrossSales)}</td></tr>
        <tr><td>Less Adjustments</td><td>${peso(t.totalAdjustments)}</td></tr>
        <tr><td><strong>Net Sales</strong></td><td><strong>${peso(t.netSales)}</strong></td></tr>
        <tr><td>Purchases</td><td>${peso(t.purchasesTotal)}</td></tr>
        <tr><td>Operating Expenses</td><td>${peso(t.opexTotalRaw)}</td></tr>
        <tr><td>Payroll</td><td>${peso(t.payrollTotal)}</td></tr>
        <tr><td>EWT</td><td>${peso(t.estEWT)}</td></tr>
        <tr><td>Compensation Withholding</td><td>${peso(t.estCompWH)}</td></tr>
        <tr><td>Estimated Percentage Tax</td><td>${peso(t.percentageTax)}</td></tr>
        <tr><td>Estimated Income Tax</td><td>${peso(t.incomeTax)}</td></tr>
        <tr><td>Other Taxes</td><td>${peso(t.otherTaxTotal)}</td></tr>
        <tr><td><strong>TOTAL ESTIMATED TAX</strong></td><td><strong>${peso(t.cashToPrepare)}</strong></td></tr>
      </table>
      <p style="margin-top:16px;font-weight:bold;">STATUS: SUBJECT TO ACCOUNTANT REVIEW</p>
      <button class="btn btn-primary no-print" onclick="window.print()">Print / Save as PDF</button>
    `;
    document.body.appendChild(box);
    box.querySelector('#closePrint').addEventListener('click', () => box.remove());
  }

  // ---------- Audit trail ----------
  function renderAudit(el){
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Audit trail</h3><p class="sub">Read-only log of key changes. Only Admin can clear entries.</p></div>
      <div class="table-wrap"><table class="simple-table"><thead><tr><th>Date</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Previous</th><th>New</th><th>Reason</th></tr></thead><tbody>
        ${state.auditTrail.map(a => `<tr><td class="mono">${fmtDateTime(a.ts)}</td><td>${a.user}</td><td><span class="badge b-neutral">${a.role}</span></td><td>${a.action}</td><td>${a.target}</td><td>${a.prev}</td><td>${a.next}</td><td>${a.reason}</td></tr>`).join('')}
      </tbody></table></div>
      ${state.auditTrail.length ? '' : '<div class="empty-note">No activity recorded yet.</div>'}
      </div>`;
  }

  // ---------- BIR Assistant ----------
  function renderAssistant(el, p){
    const t = computeTotals(p);
    const comp = computeCompleteness(p);
    const cal = upcomingDeadline(p);
    const missing = p.documents.filter(d=>d.status==='missing');
    const qa = [
      ['Ano ito?', `Ito ang BIR Compliance Desk ni Crown Head Spa — dito mo ino-organize ang buwanang datos para sa tax filing. Hindi ito nagfa-file sa BIR at hindi rin ito opisyal na kalkulasyon; para lang ito sa paghahanda.`],
      ['Anong period?', `Kasalukuyang tinitingnan: <strong>${p.label}</strong> (Q${p.quarter} ${p.year}). Status: <strong>${STATUS_LABEL[p.status]}</strong>.`],
      ['Magkano ang estimate?', `Estimated tax na ihahanda: <strong>${peso(t.cashToPrepare)}</strong> — ${estimateStatusLabel(t.estimateStatus)}. Tandaan: estimate lang ito, kailangan pa ng confirmation ng accountant.`],
      ['Ano ang status?', `${STATUS_LABEL[p.status]}. Data completeness: ${comp.pct}%.`],
      ['Ano ang kulang?', missing.length ? `May ${missing.length} kulang na document: ${missing.slice(0,5).map(d=>d.name).join(', ')}${missing.length>5?'...':''}.` : (comp.pct<100 ? 'Kulang pa ang ilang monthly data fields — tingnan ang Dashboard para sa listahan.' : 'Kumpleto na ang datos at documents para sa period na ito.')],
      ['Ano ang kailangan kong gawin?', nextActionFor(p, comp)],
      ['Ano ang hinihintay sa accountant?', p.status==='ready-for-accountant'||p.status==='under-accountant-review' ? 'Hinihintay ang review at adjustment ng accountant sa mga figures na na-encode mo.' : (p.adjustments.length && p.status!=='accountant-approved' ? 'May mga adjustment na, hinihintay pa ang final accountant approval.' : 'Wala munang hinihintay sa accountant sa ngayon.')],
      ['Ano ang dapat kong itanong sa accountant?', `Pwede mong itanong: (1) tama ba ang applicable tax rates na ginamit, (2) may mali bang expense classification, (3) ${cal ? `handa na ba tayo para sa deadline ng ${cal.form} sa ${fmtDate(cal.officialDeadline)}` : 'ano ang susunod na deadline na dapat bantayan'}, at (4) kumpleto na ba ang withholding documents.`],
    ];
    el.innerHTML = `<div class="assistant-panel">
      <div class="banner" style="background:transparent;border:none;padding:0 0 14px;">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Sinasagot lang ako base sa datos na na-encode sa system na ito — hindi ako gumagawa ng sariling tax rate, deadline, o final na konklusyon.</span></div>
      ${qa.map(([q,a]) => `<div class="assistant-q">${q}</div><div class="assistant-a">${a}</div>`).join('')}
    </div>`;
  }

  // ---------- Settings ----------
  function renderSettings(el){
    const s = state.settings;
    el.innerHTML = `<div class="card"><div class="card-head"><h3>Business registration</h3><p class="sub">From your BIR Certificate of Registration (Form 2303).</p></div>
      <div class="grid2">
        <div class="field"><label>Registered name</label><input class="fctl" id="stName" value="${s.businessName}"></div>
        <div class="field"><label>Entity type</label><select class="fctl" id="stEntity"><option ${s.entityType==='Domestic Corporation'?'selected':''}>Domestic Corporation</option><option ${s.entityType==='Sole Proprietorship'?'selected':''}>Sole Proprietorship</option><option ${s.entityType==='Partnership'?'selected':''}>Partnership</option><option ${s.entityType==='Self-Employed Individual'?'selected':''}>Self-Employed Individual</option></select></div>
        <div class="field"><label>TIN</label><input class="fctl" id="stTin" value="${s.tin}"></div>
        <div class="field"><label><input type="checkbox" id="stVat" ${s.vatRegistered?'checked':''}> VAT-registered</label><p class="sub" style="margin:4px 0 0;">Leave unchecked if your COR shows Percentage Tax (2551Q) instead of VAT.</p></div>
        <div class="field"><label>Default percentage tax rate</label><input class="fctl" id="stPct" type="number" step="0.001" value="${s.percentageTaxRate}"></div>
        <div class="field"><label>Default income tax rate</label><input class="fctl" id="stInc" type="number" step="0.001" value="${s.incomeTaxRate}"></div>
      </div>
      ${s.entityType==='Domestic Corporation' ? `<div class="banner info">${icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z')}<span>Domestic corporations use regular corporate income tax (20% or 25% of net taxable income depending on size, under the CREATE Act) — not the 8% flat rate for individuals. Confirm the exact rate with your accountant before relying on the default above.</span></div>` : ''}
      <button class="btn btn-primary" id="stSave">Save</button>
      </div>
      <div class="card"><div class="card-head"><h3>Registered branches</h3><p class="sub">Trade name, RDO, and line of business per your COR. Used for per-branch sales entry.</p></div>
        <div id="branchList"></div>
        <div style="display:flex;gap:8px;margin-top:8px;"><input class="fctl" id="newBranch" placeholder="Branch name" style="max-width:220px;"><button class="btn btn-ghost btn-sm" id="addBranch">+ Add branch</button></div>
      </div>
      <div class="card"><div class="card-head"><h3>Data</h3></div>
        <p style="font-size:12.5px;color:var(--ink-soft);">Data is stored in CrownOS's Firestore and shared in real time across every signed-in Admin/Executive Assistant device. File attachments are stored in Firebase Storage.</p>
        <button class="btn btn-ghost" id="exportAll">Export full backup (JSON)</button>
      </div>`;
    const bl = el.querySelector('#branchList');
    s.branches.forEach((b,i) => {
      const detail = (s.branchDetails||[]).find(d => d.label === b);
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--rule);';
      row.innerHTML = `<div style="display:flex;gap:8px;align-items:center;">
          <span style="flex:1;font-size:13px;font-weight:700;">${b}</span>
          <button class="btn btn-ghost btn-sm" data-rm="${i}">Remove</button>
        </div>
        ${detail ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:4px;line-height:1.6;">
          Trade name: <strong>${detail.tradeName}</strong> · Branch code: <span class="mono">${detail.branchCode}</span><br>
          ${detail.rdo}<br>${detail.lineOfBusiness}
        </div>` : ''}`;
      bl.appendChild(row);
    });
    bl.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', () => { s.branches.splice(Number(btn.dataset.rm),1); save(); renderAll(); }));
    document.getElementById('addBranch').addEventListener('click', () => {
      const v = document.getElementById('newBranch').value.trim(); if (!v) return;
      s.branches.push(v); save(); renderAll();
    });
    document.getElementById('stSave').addEventListener('click', () => {
      s.businessName = document.getElementById('stName').value;
      s.entityType = document.getElementById('stEntity').value;
      s.tin = document.getElementById('stTin').value;
      s.vatRegistered = document.getElementById('stVat').checked;
      s.percentageTaxRate = parseFloat(document.getElementById('stPct').value)||0;
      s.incomeTaxRate = parseFloat(document.getElementById('stInc').value)||0;
      save(); renderAll();
    });
    document.getElementById('exportAll').addEventListener('click', () => {
      saveFile('bir-compliance-backup.json', JSON.stringify(state, null, 2));
    });
  }

  // ---------- Access & init ----------
  // Real gate is PAGE_ACCESS in access-control.js (redirects before this
  // script even runs); this is the same belt-and-suspenders re-check
  // data-protection.js does, generalized to Admin + Executive Assistant.
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

  if (enforceAccess()){
    startFirestoreSync(() => renderAll());
  }
})();
