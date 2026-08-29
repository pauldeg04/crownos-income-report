/* ==========================================================================
   Crown Head Spa — Expenses Report
   Category ledgers with Add Particular / Edit via popup, plus two recurring
   trackers (Utilities/Monthly Dues, Installments) with due-date status and
   a branded jsPDF+autoTable export.
   ========================================================================== */

const EXPENSE_PREFIX = "crownExpenses_";
const RECURRING_PREFIX = "crownRecurring_";
const BRANCH_KEY = "crownSelectedBranch";

function getSelectedBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

const expenseTables = [
    {
        key: "operation",
        title: "Operation Expenses",
        headerClass: "operation-header",
        columns: ["Date", "Account Title", "Particular", "Amount", "S.I. No.", "TIN", "Remarks"],
        extraFields: ["siNo", "tin"],
        accountTitleOptions: [
            "Communication",
            "Supplies",
            "Fuel and Oil",
            "Transportation and Travel",
            "Representation",
            "Repairs and Maintenance",
            "Professional Fees",
            "Insurance",
            "Donation",
            "Miscellaneous",
            "Postage",
            "Fixed Asset",
            "Purchase"
        ]
    },
    {
        key: "salary",
        title: "Payroll",
        headerClass: "salary-header",
        columns: ["Date", "Account Title", "Particular", "Amount", "Remarks"],
        extraFields: [],
        accountTitleOptions: ["Salaries and Allowances", "Staff Benefits and Incentives"]
    },
    {
        key: "utilities",
        title: "Utilities / Monthly Dues",
        headerClass: "utilities-header",
        recurring: true,
        columns: ["Particular", "Account Title", "Due Date", "Amount", "Start Date", "End Date", "Status"],
        accountTitleOptions: ["Light and Water", "Rental Expense", "Communication"]
    },
    {
        key: "installments",
        title: "Installments",
        headerClass: "installments-header",
        recurring: true,
        columns: ["Particular", "Account Title", "Due Date", "Amount", "Start Date", "End Date", "Status"],
        accountTitleFixed: "Repairs and Maintenance"
    },
    {
        key: "gov",
        title: "Accounting / Government Dues",
        headerClass: "gov-header",
        columns: ["Date", "Account Title", "Particular", "Amount", "Remarks"],
        extraFields: [],
        accountTitleOptions: ["SSS, PHIC and HDMF Premiums", "Taxes and Licenses"]
    },
    {
        key: "marketing",
        title: "Marketing",
        headerClass: "marketing-header",
        columns: ["Date", "Account Title", "Particular", "Amount", "S.I. No.", "TIN", "Remarks"],
        extraFields: ["siNo", "tin"],
        accountTitleFixed: "Advertising"
    }
];

const recurringTableKeys = expenseTables.filter(t => t.recurring).map(t => t.key);

const EXTRA_FIELD_LABELS = {
    siNo: "S.I. No.",
    tin: "TIN"
};

const RECURRING_STATUS_META = {
    pending: { label: "Pending", class: "status-pending" },
    approaching: { label: "Approaching Due Date", class: "status-approaching" },
    overdue: { label: "Past Due", class: "status-overdue" },
    settled: { label: "Settled", class: "status-settled" }
};

let expenseData = {};
let recurringData = {};
let activeModal = { tableKey: null, entryId: null };
let activeRecurringModal = { tableKey: null, itemId: null };

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    document.getElementById("branchReadout").textContent = getSelectedBranch();
    renderTables();
    loadExpenses();
    wireModalEvents();
    wireRecurringModalEvents();
    showExpenseTab(EXPENSE_VIEW_TABS[0][0]);

    document.getElementById("exportExpensesPdfBtn")
        .addEventListener("click", exportExpensesPDF);
});

function setCurrentMonth(){
    let monthInput = document.getElementById("month");
    let today = new Date();
    let year = today.getFullYear();
    let month = String(today.getMonth() + 1).padStart(2, "0");
    monthInput.value = `${year}-${month}`;
}

function getStorageKey(){
    let branch = getSelectedBranch() || "NoBranch";
    let month = document.getElementById("month").value || "NoMonth";
    return EXPENSE_PREFIX + branch + "_" + month;
}

function getRecurringStorageKey(tableKey){
    let branch = getSelectedBranch() || "NoBranch";
    return RECURRING_PREFIX + tableKey + "_" + branch;
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function createExpenseId(){
    return Date.now().toString() + Math.random().toString(16).slice(2);
}

function createRecurringId(){
    return "r" + Date.now().toString() + Math.random().toString(16).slice(2);
}

function peso(amount){
    return "₱" + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/* jsPDF's built-in helvetica font has no ₱ glyph — it prints as a
   replacement character. Use "PHP" instead for anything drawn on
   the PDF (screen display keeps using peso() above). */
function pesoPdf(amount){
    return "PHP " + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatMonth(monthValue){
    if(!monthValue) return "";

    return new Date(monthValue + "-01T00:00:00").toLocaleDateString("en-PH", {
        month:"long",
        year:"numeric"
    });
}

/* Entries only carry a month now (the modal's Date field is type="month"),
   though petty-cash liquidation still posts a full "YYYY-MM-DD" — slicing
   to the first 7 chars handles both. */
function formatDateText(dateValue){
    if(!dateValue) return "";

    let [year, month] = dateValue.slice(0, 7).split("-");
    if(!year || !month) return "";

    let monthAbbr = new Date(Number(year), Number(month) - 1, 1)
        .toLocaleDateString("en-PH", { month: "short" });

    return `${monthAbbr}-${year.slice(2)}`;
}

function ordinalSuffix(n){
    let j = n % 10, k = n % 100;
    if(j === 1 && k !== 11) return n + "st";
    if(j === 2 && k !== 12) return n + "nd";
    if(j === 3 && k !== 13) return n + "rd";
    return n + "th";
}

function dueDateLabel(day){
    return day ? ordinalSuffix(day) + " of the month" : "—";
}

function changeBranchMonth(){
    loadExpenses();
}

function renderTables(){
    let container = document.getElementById("tablesContainer");
    container.innerHTML = "";

    expenseTables.forEach(table => {
        let panel = document.createElement("div");
        panel.className = "tab-panel";
        panel.dataset.tabPanel = table.key;

        let card = document.createElement("div");
        card.className = "card shadow-sm border-0 mb-4 expense-card";

        if(table.recurring){
            card.innerHTML = `
                <div class="card-body">
                    <div class="expense-header ${table.headerClass} d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <h3 class="fw-bold mb-0">${table.title}</h3>
                        <button type="button" class="btn btn-sm add-particular-btn" onclick="openRecurringModal('${table.key}', null)">+ Add to List</button>
                    </div>

                    <div class="table-responsive">
                        <table class="table table-bordered table-hover expense-table">
                            <thead class="table-light">
                                <tr>
                                    ${table.columns.map(col => `<th>${col}</th>`).join("")}
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="${table.key}Body"></tbody>
                        </table>
                    </div>

                    <div class="d-flex justify-content-end align-items-center mt-3 border-top pt-3">
                        <div class="table-total">
                            ${table.title} Total:
                            <span id="${table.key}Total">₱0.00</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="card-body">
                    <div class="expense-header ${table.headerClass} d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <h3 class="fw-bold mb-0">${table.title}</h3>
                        <button type="button" class="btn btn-sm add-particular-btn" onclick="openExpenseModal('${table.key}', null)">+ Add Particular</button>
                    </div>

                    <div class="table-responsive">
                        <table class="table table-bordered table-hover expense-table">
                            <thead class="table-light">
                                <tr>
                                    ${table.columns.map(col => `<th>${col}</th>`).join("")}
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="${table.key}Body"></tbody>
                        </table>
                    </div>

                    <div class="d-flex justify-content-end align-items-center mt-3 border-top pt-3">
                        <div class="table-total">
                            ${table.title} Total:
                            <span id="${table.key}Total">₱0.00</span>
                        </div>
                    </div>
                </div>
            `;
        }

        panel.appendChild(card);
        container.appendChild(panel);
    });
}

const EXPENSE_VIEW_TABS = [
    ...expenseTables.map(table => [table.key, table.title]),
    ["summary", "Summary"]
];
let currentExpenseTab = EXPENSE_VIEW_TABS[0][0];

function renderExpenseViewTabs(){
    let nav = document.getElementById("expenseViewTabs");
    nav.innerHTML = "";

    EXPENSE_VIEW_TABS.forEach(([id, label]) => {
        let b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(currentExpenseTab === id));
        b.textContent = label;
        b.addEventListener("click", () => showExpenseTab(id));
        nav.appendChild(b);
    });
}

function showExpenseTab(id){
    currentExpenseTab = id;

    document.querySelectorAll("[data-tab-panel]").forEach(panel => {
        panel.classList.toggle("d-none", panel.dataset.tabPanel !== id);
    });

    renderExpenseViewTabs();
}

function sortedEntries(tableKey){
    return [...(expenseData[tableKey] || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

function renderTableBody(tableKey){
    let table = expenseTables.find(t => t.key === tableKey);
    let tbody = document.getElementById(tableKey + "Body");
    let rows = sortedEntries(tableKey);

    if(rows.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="${table.columns.length + 1}">No entries yet. Click "+ Add Particular" to add one.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map(entry => {
        let cells = [`<td class="text-start"><div class="date-text">${entry.date ? formatDateText(entry.date) : "—"}</div></td>`];

        cells.push(`<td>${escapeHtml(entry.accountTitle || table.accountTitleFixed) || "—"}</td>`);

        cells.push(`<td class="text-start">${escapeHtml(entry.particular)}</td>`);
        cells.push(`<td class="amount-cell">${peso(entry.amount)}</td>`);

        table.extraFields.forEach(field => {
            cells.push(`<td>${escapeHtml(entry[field]) || "—"}</td>`);
        });

        cells.push(`<td class="text-start">${escapeHtml(entry.remarks) || "—"}</td>`);
        cells.push(`
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openExpenseModal('${tableKey}','${entry.id}')">✎ Edit</button>
            </td>
        `);

        return `<tr>${cells.join("")}</tr>`;
    }).join("");
}

function renderAllTables(){
    expenseTables.forEach(table => {
        if(table.recurring){
            renderRecurringTableBody(table.key);
        } else {
            renderTableBody(table.key);
        }
    });
    updateTotals();
}

function updateTotals(){
    let totals = {};
    let monthKey = document.getElementById("month").value;

    expenseTables.forEach(table => {
        let total = table.recurring
            ? recurringMonthTotal(table.key, monthKey)
            : (expenseData[table.key] || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

        totals[table.key] = total;
        document.getElementById(table.key + "Total").innerText = peso(total);
    });

    let grandTotal =
        totals.operation +
        totals.salary +
        totals.utilities +
        totals.installments +
        totals.gov +
        totals.marketing;

    document.getElementById("summaryOperation").innerText = peso(totals.operation);
    document.getElementById("summarySalary").innerText = peso(totals.salary);
    document.getElementById("summaryUtilities").innerText = peso(totals.utilities);
    document.getElementById("summaryInstallments").innerText = peso(totals.installments);
    document.getElementById("summaryGov").innerText = peso(totals.gov);
    document.getElementById("summaryMarketing").innerText = peso(totals.marketing);
    document.getElementById("summaryGrand").innerText = peso(grandTotal);

    renderUpcomingPaymentsWidget();
}

/* ==========================================================================
   "For Payment This Week" header widget — surfaces recurring items
   (Utilities/Monthly Dues, Installments) whose due-date instance falls
   inside the current real-world calendar week (Sun-Sat) and isn't
   settled yet. Independent of whichever report month is selected above,
   since it's meant as an always-current "what's coming up" glance.
   ========================================================================== */

function renderUpcomingPaymentsWidget(){
    let list = document.getElementById("upcomingPaymentsList");
    if(!list) return;

    let today = new Date();
    today.setHours(0, 0, 0, 0);

    let startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    let endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    let thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    let nextMonthKey = addMonthsToMonthKey(thisMonthKey, 1);

    let upcoming = [];

    recurringTableKeys.forEach(tableKey => {
        let table = expenseTables.find(t => t.key === tableKey);

        (recurringData[tableKey] || []).forEach(item => {
            [thisMonthKey, nextMonthKey].forEach(monthKey => {
                if(!isRecurringActiveInMonth(item, monthKey)) return;

                let due = dueInstanceDate(item, monthKey);
                due.setHours(0, 0, 0, 0);

                if(due < startOfWeek || due > endOfWeek) return;

                let status = computeRecurringStatus(item, monthKey);
                if(status === "settled") return;

                upcoming.push({
                    tableTitle: table.title,
                    particular: item.particular,
                    due,
                    status,
                    amount: recurringAmountForMonth(item, monthKey)
                });
            });
        });
    });

    upcoming.sort((a, b) => a.due - b.due);

    if(upcoming.length === 0){
        list.innerHTML = `<div class="upcoming-payments-empty">No payments due this week.</div>`;
        return;
    }

    list.innerHTML = upcoming.map(row => {
        let meta = RECURRING_STATUS_META[row.status];
        let dueLabel = row.due.toLocaleDateString("en-PH", { month: "short", day: "numeric" });

        return `
            <div class="upcoming-payment-row">
                <div class="upcoming-payment-main">
                    <span class="upcoming-payment-particular">${escapeHtml(row.particular)}</span>
                    <span class="upcoming-payment-sub">${escapeHtml(row.tableTitle)} · Due ${dueLabel}</span>
                </div>
                <div class="upcoming-payment-meta">
                    <span class="status-badge ${meta.class}">${meta.label}</span>
                    <span class="upcoming-payment-amount">${peso(row.amount)}</span>
                </div>
            </div>
        `;
    }).join("");
}

/* ==========================================================================
   Add / Edit Expense Entry modal (ledger tables)
   ========================================================================== */

function wireModalEvents(){
    document.getElementById("closeExpenseModalBtn").addEventListener("click", closeExpenseModal);
    document.getElementById("cancelExpenseModalBtn").addEventListener("click", closeExpenseModal);
    document.getElementById("saveExpenseEntryBtn").addEventListener("click", saveExpenseEntryFromModal);
    document.getElementById("deleteExpenseEntryBtn").addEventListener("click", deleteExpenseEntryFromModal);

    document.getElementById("expenseModalBackdrop").addEventListener("click", function(event){
        if(event.target === this){
            closeExpenseModal();
        }
    });
}

function openExpenseModal(tableKey, entryId){
    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    let table = expenseTables.find(t => t.key === tableKey);
    let hasAccountTitleSelect = !!table.accountTitleOptions;
    let entry = entryId ? (expenseData[tableKey] || []).find(e => e.id === entryId) : null;

    activeModal = { tableKey, entryId: entry ? entryId : null };

    document.getElementById("expenseModalCategoryWrapper").classList.toggle("d-none", !hasAccountTitleSelect);
    document.getElementById("expenseModalSiNoWrapper").classList.toggle("d-none", !table.extraFields.includes("siNo"));
    document.getElementById("expenseModalTinWrapper").classList.toggle("d-none", !table.extraFields.includes("tin"));

    document.getElementById("expenseModalTitle").textContent =
        (entry ? "Edit " : "Add ") + table.title + " Entry";

    document.getElementById("expenseModalDate").value = entry?.date || "";

    let categorySelect = document.getElementById("expenseModalCategory");
    if(hasAccountTitleSelect){
        categorySelect.innerHTML = `<option value="">Select Account Title</option>` +
            table.accountTitleOptions.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
    }
    categorySelect.value = entry?.accountTitle || "";
    document.getElementById("expenseModalParticular").value = entry?.particular || "";
    document.getElementById("expenseModalAmount").value = entry?.amount || "";
    document.getElementById("expenseModalSiNo").value = entry?.siNo || "";
    document.getElementById("expenseModalTin").value = entry?.tin || "";
    document.getElementById("expenseModalRemarks").value = entry?.remarks || "";

    document.getElementById("deleteExpenseEntryBtn").classList.toggle("d-none", !entry);

    document.getElementById("expenseModalBackdrop").classList.remove("d-none");
}

function closeExpenseModal(){
    document.getElementById("expenseModalBackdrop").classList.add("d-none");
    activeModal = { tableKey: null, entryId: null };
}

function saveExpenseEntryFromModal(){
    let { tableKey, entryId } = activeModal;

    if(!tableKey) return;

    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    let table = expenseTables.find(t => t.key === tableKey);
    let hasAccountTitleSelect = !!table.accountTitleOptions;
    let date = document.getElementById("expenseModalDate").value;
    let accountTitle = hasAccountTitleSelect
        ? document.getElementById("expenseModalCategory").value
        : (table.accountTitleFixed || "");
    let particular = document.getElementById("expenseModalParticular").value.trim();
    let amount = parseFloat(document.getElementById("expenseModalAmount").value) || 0;
    let siNo = document.getElementById("expenseModalSiNo").value.trim();
    let tin = document.getElementById("expenseModalTin").value.trim();
    let remarks = document.getElementById("expenseModalRemarks").value.trim();

    if(!particular){
        alert("Please enter a Particular.");
        return;
    }

    if(amount <= 0){
        alert("Please enter a valid Amount.");
        return;
    }

    if(hasAccountTitleSelect && !accountTitle){
        alert("Please select an Account Title.");
        return;
    }

    let entry = {
        id: entryId || createExpenseId(),
        date,
        accountTitle,
        particular,
        amount,
        remarks
    };

    if(table.extraFields.includes("siNo")) entry.siNo = siNo;
    if(table.extraFields.includes("tin")) entry.tin = tin;

    if(!expenseData[tableKey]){
        expenseData[tableKey] = [];
    }

    if(entryId){
        let index = expenseData[tableKey].findIndex(e => e.id === entryId);
        if(index > -1){
            expenseData[tableKey][index] = entry;
        }
    } else {
        expenseData[tableKey].push(entry);
    }

    saveExpenses();
    renderTableBody(tableKey);
    updateTotals();
    closeExpenseModal();
}

function deleteExpenseEntryFromModal(){
    let { tableKey, entryId } = activeModal;

    if(!tableKey || !entryId) return;

    if(!confirm("Delete this expense entry?")) return;

    expenseData[tableKey] = (expenseData[tableKey] || []).filter(e => e.id !== entryId);

    saveExpenses();
    renderTableBody(tableKey);
    updateTotals();
    closeExpenseModal();
}

/* ==========================================================================
   Recurring items (Utilities / Monthly Dues, Installments)
   Items live outside the month-keyed ledger — stored per branch — and stay
   visible on every month's table from their Start Date until their
   computed End Date (or forever, if "Continues" is checked).
   ========================================================================== */

function daysInMonth(year, month){
    return new Date(year, month, 0).getDate();
}

function monthKeyFromDateStr(dateStr){
    return dateStr ? dateStr.slice(0, 7) : "";
}

function addMonthsToMonthKey(monthKey, delta){
    let [y, m] = monthKey.split("-").map(Number);
    let total = (y * 12 + (m - 1)) + delta;
    let ny = Math.floor(total / 12);
    let nm = (total % 12) + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
}

function computeEndMonth(startDate, durationMonths){
    let startMonth = monthKeyFromDateStr(startDate);
    if(!startMonth || !durationMonths) return startMonth || null;
    return addMonthsToMonthKey(startMonth, durationMonths - 1);
}

function isRecurringActiveInMonth(item, monthKey){
    let startMonth = monthKeyFromDateStr(item.startDate);
    if(!startMonth || !monthKey || monthKey < startMonth) return false;
    if(item.continues) return true;
    return !!item.endMonth && monthKey <= item.endMonth;
}

function dueInstanceDate(item, monthKey){
    let [y, m] = monthKey.split("-").map(Number);
    let day = Math.min(item.dueDay || 1, daysInMonth(y, m));
    return new Date(y, m - 1, day);
}

function computeRecurringStatus(item, monthKey){
    if(item.settledMonths && item.settledMonths[monthKey]) return "settled";

    let due = dueInstanceDate(item, monthKey);
    due.setHours(0, 0, 0, 0);

    let today = new Date();
    today.setHours(0, 0, 0, 0);

    let diffDays = Math.round((due - today) / 86400000);

    if(diffDays < 0) return "overdue";
    if(diffDays <= 5) return "approaching";
    return "pending";
}

function recurringAmountForMonth(item, monthKey){
    if(item.amountType === "varies"){
        return Number((item.monthlyAmounts || {})[monthKey]) || 0;
    }
    return Number(item.fixedAmount) || 0;
}

/* Only settled items count toward the total for a month — an item still
   Pending/Approaching/Past Due hasn't actually been paid out yet. */
function recurringMonthTotal(tableKey, monthKey){
    return (recurringData[tableKey] || [])
        .filter(item => isRecurringActiveInMonth(item, monthKey) && computeRecurringStatus(item, monthKey) === "settled")
        .reduce((sum, item) => sum + recurringAmountForMonth(item, monthKey), 0);
}

function renderRecurringTableBody(tableKey){
    let table = expenseTables.find(t => t.key === tableKey);
    let tbody = document.getElementById(tableKey + "Body");
    let monthKey = document.getElementById("month").value;

    let items = (recurringData[tableKey] || [])
        .filter(item => isRecurringActiveInMonth(item, monthKey))
        .sort((a, b) => (a.dueDay || 0) - (b.dueDay || 0));

    if(items.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="${table.columns.length + 1}">No entries yet. Click "+ Add to List" to add one.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(item => {
        let status = computeRecurringStatus(item, monthKey);
        let meta = RECURRING_STATUS_META[status];

        let amountCell;
        if(item.amountType === "varies"){
            let value = (item.monthlyAmounts || {})[monthKey];
            amountCell = `
                <td>
                    <input type="number" class="form-control form-control-sm varies-amount-input"
                        min="0" step="0.01" value="${value === undefined ? "" : escapeHtml(value)}"
                        onchange="updateVariesAmount('${tableKey}','${item.id}', this.value)">
                </td>
            `;
        } else {
            let mutedClass = status === "settled" ? "" : " amount-unsettled";
            amountCell = `<td class="amount-cell${mutedClass}">${peso(item.fixedAmount)}</td>`;
        }

        let endDateText = item.continues
            ? "Continues"
            : (item.endMonth ? formatDateText(item.endMonth + "-01") : "—");

        return `
            <tr>
                <td class="text-start">${escapeHtml(item.particular)}</td>
                <td>${escapeHtml(item.accountTitle || table.accountTitleFixed) || "—"}</td>
                <td>${dueDateLabel(item.dueDay)}</td>
                ${amountCell}
                <td>${item.startDate ? formatDateText(item.startDate) : "—"}</td>
                <td>${endDateText}</td>
                <td><span class="status-badge ${meta.class}">${meta.label}</span></td>
                <td>
                    ${status === "settled" ? "" : `<button type="button" class="btn btn-sm btn-outline-success settle-btn" onclick="settleRecurringItem('${tableKey}','${item.id}')">Settle</button>`}
                    <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openRecurringModal('${tableKey}','${item.id}')">✎ Edit</button>
                </td>
            </tr>
        `;
    }).join("");
}

function updateVariesAmount(tableKey, itemId, value){
    let item = (recurringData[tableKey] || []).find(i => i.id === itemId);
    if(!item) return;

    let monthKey = document.getElementById("month").value;
    if(!item.monthlyAmounts) item.monthlyAmounts = {};
    item.monthlyAmounts[monthKey] = parseFloat(value) || 0;

    saveRecurringData(tableKey);
    updateTotals();
}

function settleRecurringItem(tableKey, itemId){
    let item = (recurringData[tableKey] || []).find(i => i.id === itemId);
    if(!item) return;

    let monthKey = document.getElementById("month").value;
    if(!item.settledMonths) item.settledMonths = {};
    item.settledMonths[monthKey] = true;

    saveRecurringData(tableKey);
    renderRecurringTableBody(tableKey);
    updateTotals();
}

/* Un-settles an item for one specific month only — its other
   occurrences (past or future) keep whatever settled state they have. */
function revertRecurringItemSettlement(tableKey, itemId, monthKey){
    let item = (recurringData[tableKey] || []).find(i => i.id === itemId);
    if(!item || !item.settledMonths) return;

    delete item.settledMonths[monthKey];

    saveRecurringData(tableKey);
    renderRecurringTableBody(tableKey);
    updateTotals();
}

/* ---- Add / Edit recurring item modal ---------------------------------- */

function wireRecurringModalEvents(){
    document.getElementById("closeRecurringModalBtn").addEventListener("click", closeRecurringModal);
    document.getElementById("cancelRecurringModalBtn").addEventListener("click", closeRecurringModal);
    document.getElementById("saveRecurringItemBtn").addEventListener("click", saveRecurringItemFromModal);
    document.getElementById("deleteRecurringItemBtn").addEventListener("click", deleteRecurringItemFromModal);
    document.getElementById("revertRecurringItemBtn").addEventListener("click", revertRecurringItemFromModal);

    document.getElementById("recurringModalBackdrop").addEventListener("click", function(event){
        if(event.target === this){
            closeRecurringModal();
        }
    });

    document.getElementById("recurringAmountFixed").addEventListener("change", toggleRecurringAmountFields);
    document.getElementById("recurringAmountVaries").addEventListener("change", toggleRecurringAmountFields);
    document.getElementById("recurringContinues").addEventListener("change", toggleRecurringDurationField);
}

function toggleRecurringAmountFields(){
    let isFixed = document.getElementById("recurringAmountFixed").checked;
    document.getElementById("recurringFixedAmountWrapper").classList.toggle("d-none", !isFixed);
}

function toggleRecurringDurationField(){
    let continues = document.getElementById("recurringContinues").checked;
    document.getElementById("recurringDurationWrapper").classList.toggle("d-none", continues);
    document.getElementById("recurringDurationMonths").disabled = continues;
}

function openRecurringModal(tableKey, itemId){
    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    let table = expenseTables.find(t => t.key === tableKey);
    let hasAccountTitleSelect = !!table.accountTitleOptions;
    let item = itemId ? (recurringData[tableKey] || []).find(i => i.id === itemId) : null;

    activeRecurringModal = { tableKey, itemId: item ? itemId : null };

    document.getElementById("recurringModalTitle").textContent =
        (item ? "Edit " : "Add ") + table.title + " Item";

    document.getElementById("recurringParticular").value = item?.particular || "";

    document.getElementById("recurringAccountTitleWrapper").classList.toggle("d-none", !hasAccountTitleSelect);
    let recurringAccountTitleSelect = document.getElementById("recurringAccountTitle");
    if(hasAccountTitleSelect){
        recurringAccountTitleSelect.innerHTML = `<option value="">Select Account Title</option>` +
            table.accountTitleOptions.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
    }
    recurringAccountTitleSelect.value = item?.accountTitle || "";
    document.getElementById("recurringDueDay").value = item?.dueDay || "";
    document.getElementById("recurringStartDate").value = item?.startDate || "";

    let isVaries = item?.amountType === "varies";
    document.getElementById("recurringAmountFixed").checked = !isVaries;
    document.getElementById("recurringAmountVaries").checked = isVaries;
    document.getElementById("recurringFixedAmount").value = item?.fixedAmount || "";
    toggleRecurringAmountFields();

    document.getElementById("recurringContinues").checked = !!item?.continues;
    document.getElementById("recurringDurationMonths").value = item?.durationMonths || "";
    toggleRecurringDurationField();

    document.getElementById("deleteRecurringItemBtn").classList.toggle("d-none", !item);

    let isSettledThisMonth = !!(item && item.settledMonths && item.settledMonths[month]);
    document.getElementById("revertRecurringItemBtn").classList.toggle("d-none", !isSettledThisMonth);

    document.getElementById("recurringModalBackdrop").classList.remove("d-none");
}

function closeRecurringModal(){
    document.getElementById("recurringModalBackdrop").classList.add("d-none");
    activeRecurringModal = { tableKey: null, itemId: null };
}

function saveRecurringItemFromModal(){
    let { tableKey, itemId } = activeRecurringModal;

    if(!tableKey) return;

    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    let table = expenseTables.find(t => t.key === tableKey);
    let hasAccountTitleSelect = !!table.accountTitleOptions;
    let accountTitle = hasAccountTitleSelect
        ? document.getElementById("recurringAccountTitle").value
        : (table.accountTitleFixed || "");
    let particular = document.getElementById("recurringParticular").value.trim();
    let dueDay = parseInt(document.getElementById("recurringDueDay").value, 10);
    let startDate = document.getElementById("recurringStartDate").value;
    let amountType = document.getElementById("recurringAmountVaries").checked ? "varies" : "fixed";
    let fixedAmount = parseFloat(document.getElementById("recurringFixedAmount").value) || 0;
    let continues = document.getElementById("recurringContinues").checked;
    let durationMonths = parseInt(document.getElementById("recurringDurationMonths").value, 10);

    if(!particular){
        alert("Please enter a Particular.");
        return;
    }

    if(hasAccountTitleSelect && !accountTitle){
        alert("Please select an Account Title.");
        return;
    }

    if(!dueDay || dueDay < 1 || dueDay > 31){
        alert("Please enter a valid Due Date (1-31).");
        return;
    }

    if(!startDate){
        alert("Please enter a Start Date.");
        return;
    }

    if(amountType === "fixed" && fixedAmount <= 0){
        alert("Please enter a valid Fixed Amount.");
        return;
    }

    if(!continues && (!durationMonths || durationMonths < 1)){
        alert("Please enter the duration in months, or check Continues.");
        return;
    }

    let existing = itemId ? (recurringData[tableKey] || []).find(i => i.id === itemId) : null;

    let item = {
        id: itemId || createRecurringId(),
        particular,
        accountTitle,
        dueDay,
        startDate,
        amountType,
        fixedAmount,
        monthlyAmounts: existing?.monthlyAmounts || {},
        continues,
        durationMonths: continues ? null : durationMonths,
        endMonth: continues ? null : computeEndMonth(startDate, durationMonths),
        settledMonths: existing?.settledMonths || {}
    };

    if(!recurringData[tableKey]) recurringData[tableKey] = [];

    if(itemId){
        let index = recurringData[tableKey].findIndex(i => i.id === itemId);
        if(index > -1){
            recurringData[tableKey][index] = item;
        }
    } else {
        recurringData[tableKey].push(item);
    }

    saveRecurringData(tableKey);
    renderRecurringTableBody(tableKey);
    updateTotals();
    closeRecurringModal();
}

function deleteRecurringItemFromModal(){
    let { tableKey, itemId } = activeRecurringModal;

    if(!tableKey || !itemId) return;

    if(!confirm("Delete this item from the list?")) return;

    recurringData[tableKey] = (recurringData[tableKey] || []).filter(i => i.id !== itemId);

    saveRecurringData(tableKey);
    renderRecurringTableBody(tableKey);
    updateTotals();
    closeRecurringModal();
}

function revertRecurringItemFromModal(){
    let { tableKey, itemId } = activeRecurringModal;

    if(!tableKey || !itemId) return;

    let monthKey = document.getElementById("month").value;

    if(!confirm("Revert this item to unsettled for " + formatMonth(monthKey) + "?")) return;

    revertRecurringItemSettlement(tableKey, itemId, monthKey);
    closeRecurringModal();
}

/* ==========================================================================
   Storage
   ========================================================================== */

function saveExpenses(){
    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month) return;

    localStorage.setItem(getStorageKey(), JSON.stringify(expenseData));
}

function saveRecurringData(tableKey){
    let branch = getSelectedBranch();
    if(!branch) return;

    localStorage.setItem(getRecurringStorageKey(tableKey), JSON.stringify(recurringData[tableKey] || []));
}

function loadRecurringData(){
    let branch = getSelectedBranch();
    recurringData = {};

    recurringTableKeys.forEach(tableKey => {
        recurringData[tableKey] = [];

        if(branch){
            let saved = localStorage.getItem(getRecurringStorageKey(tableKey));

            if(saved){
                try{
                    let parsed = JSON.parse(saved);
                    if(Array.isArray(parsed)) recurringData[tableKey] = parsed;
                }catch(error){
                    console.error(error);
                }
            }
        }
    });
}

function loadExpenses(){
    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    expenseData = {};
    expenseTables.forEach(table => {
        if(!table.recurring) expenseData[table.key] = [];
    });

    if(branch && month){
        let saved = localStorage.getItem(getStorageKey());

        if(saved){
            let parsed = JSON.parse(saved);

            expenseTables.forEach(table => {
                if(table.recurring) return;

                let rows = Array.isArray(parsed[table.key]) ? parsed[table.key] : [];

                expenseData[table.key] = rows.map(row => {
                    let entry = {
                        id: row.id || createExpenseId(),
                        date: row.date || "",
                        accountTitle: row.accountTitle || row.category || "",
                        particular: row.particular || "",
                        amount: Number(row.amount) || 0,
                        remarks: row.remarks || ""
                    };

                    table.extraFields.forEach(field => {
                        entry[field] = row[field] || "";
                    });

                    return entry;
                });
            });
        }
    }

    loadRecurringData();
    renderAllTables();
}

/* ==========================================================================
   Export to PDF — branded jsPDF+autoTable export: one ledger table per
   category followed by the Summary Table, navy/gold executive styling.
   ========================================================================== */

function exportExpensesPDF(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;

    if(!branch || !monthValue){
        alert("Please select branch and month first.");
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    const button = document.getElementById("exportExpensesPdfBtn");

    if(button){
        button.disabled = true;
        button.textContent = "Generating PDF...";
    }

    try{
        const jsPDF = window.jspdf.jsPDF;

        const doc = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4",
            compress: true
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const monthLabel = formatMonth(monthValue);

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Expense Report", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branch, pageWidth - 14, 10, { align: "right" });
            doc.text(monthLabel, pageWidth - 14, 16, { align: "right" });
        }

        function drawFooter(pageNumber, pageCount){
            doc.setTextColor(120, 126, 138);
            doc.setFontSize(7.5);
            doc.text(
                `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                14,
                pageHeight - 8
            );

            doc.text(
                `Page ${pageNumber} of ${pageCount}`,
                pageWidth - 14,
                pageHeight - 8,
                { align: "right" }
            );
        }

        drawHeader();

        let cursorY = 34;
        let isFirstSection = true;

        expenseTables.forEach(table => {
            const rows = table.recurring
                ? (recurringData[table.key] || [])
                    .filter(item => isRecurringActiveInMonth(item, monthValue))
                    .sort((a, b) => (a.dueDay || 0) - (b.dueDay || 0))
                : sortedEntries(table.key);

            const total = table.recurring
                ? rows.reduce((sum, item) => sum + recurringAmountForMonth(item, monthValue), 0)
                : rows.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

            if(!isFirstSection){
                doc.addPage();
                drawHeader();
                cursorY = 34;
            }
            isFirstSection = false;

            doc.setTextColor(11, 24, 73);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11.5);
            doc.text(table.title, 14, cursorY);
            cursorY += 4;

            const amountColIndex = table.columns.indexOf("Amount");
            const particularColIndex = table.columns.indexOf("Particular");

            const columnValue = (col, entry) => {
                if(table.recurring){
                    switch(col){
                        case "Particular": return entry.particular || "—";
                        case "Account Title": return entry.accountTitle || table.accountTitleFixed || "—";
                        case "Due Date": return dueDateLabel(entry.dueDay);
                        case "Amount": return pesoPdf(recurringAmountForMonth(entry, monthValue));
                        case "Start Date": return entry.startDate ? formatDateText(entry.startDate) : "—";
                        case "End Date": return entry.continues ? "Continues" : (entry.endMonth ? formatDateText(entry.endMonth + "-01") : "—");
                        case "Status": return RECURRING_STATUS_META[computeRecurringStatus(entry, monthValue)].label;
                        default: return "—";
                    }
                }

                switch(col){
                    case "Date": return entry.date ? formatDateText(entry.date) : "—";
                    case "Account Title": return entry.accountTitle || table.accountTitleFixed || "—";
                    case "Particular": return entry.particular || "—";
                    case "Amount": return pesoPdf(entry.amount);
                    case "S.I. No.": return entry.siNo || "—";
                    case "TIN": return entry.tin || "—";
                    case "Remarks": return entry.remarks || "—";
                    default: return "—";
                }
            };

            const head = [table.columns];

            const body = rows.length
                ? rows.map(entry => table.columns.map(col => columnValue(col, entry)))
                : [[{
                    content: "No entries recorded for this period.",
                    colSpan: head[0].length,
                    styles: { halign: "center", textColor: [140, 146, 158], fontStyle: "italic" }
                }]];

            const footRow = table.columns.map((col, index) => {
                if(index === particularColIndex) return "Subtotal";
                if(index === amountColIndex) return pesoPdf(total);
                return "";
            });

            doc.autoTable({
                startY: cursorY,
                margin: { top: 30, left: 14, right: 14, bottom: 16 },
                head,
                body,
                foot: rows.length ? [footRow] : undefined,
                showFoot: "lastPage",
                theme: "grid",
                styles: {
                    font: "helvetica",
                    fontSize: 9,
                    cellPadding: 3,
                    valign: "middle",
                    textColor: [32, 43, 60],
                    lineColor: [216, 222, 232],
                    lineWidth: 0.15
                },
                headStyles: {
                    fillColor: [11, 24, 73],
                    textColor: [255, 255, 255],
                    fontStyle: "bold",
                    fontSize: 8.5
                },
                footStyles: {
                    fillColor: [251, 247, 237],
                    textColor: [23, 52, 93],
                    fontStyle: "bold",
                    lineColor: [198, 161, 91],
                    lineWidth: { top: 0.5, bottom: 0.15, left: 0.15, right: 0.15 }
                },
                columnStyles: {
                    [amountColIndex]: { halign: "right" }
                }
            });

            cursorY = doc.lastAutoTable.finalY + 10;
        });

        doc.addPage();
        drawHeader();
        cursorY = 34;

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Summary Table", 14, cursorY);
        cursorY += 4;

        const totals = {};
        expenseTables.forEach(table => {
            totals[table.key] = table.recurring
                ? recurringMonthTotal(table.key, monthValue)
                : (expenseData[table.key] || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
        });

        const grandTotal =
            totals.operation +
            totals.salary +
            totals.utilities +
            totals.installments +
            totals.gov +
            totals.marketing;

        const summaryRows = [
            ["Operation Expenses", pesoPdf(totals.operation)],
            ["Payroll", pesoPdf(totals.salary)],
            ["Utilities / Monthly Dues", pesoPdf(totals.utilities)],
            ["Installments", pesoPdf(totals.installments)],
            ["Accounting / Government Dues", pesoPdf(totals.gov)],
            ["Marketing", pesoPdf(totals.marketing)]
        ];

        doc.autoTable({
            startY: cursorY,
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            head: [["Expense Category", "Total Amount"]],
            body: summaryRows,
            foot: [["Total Expenses", pesoPdf(grandTotal)]],
            showFoot: "lastPage",
            theme: "grid",
            styles: {
                font: "helvetica",
                fontSize: 10,
                cellPadding: 4,
                valign: "middle",
                textColor: [32, 43, 60],
                lineColor: [216, 222, 232],
                lineWidth: 0.15
            },
            headStyles: {
                fillColor: [11, 24, 73],
                textColor: [255, 255, 255],
                fontStyle: "bold"
            },
            footStyles: {
                fillColor: [251, 247, 237],
                textColor: [23, 52, 93],
                fontStyle: "bold",
                fontSize: 11.5,
                lineColor: [198, 161, 91],
                lineWidth: { top: 0.5, bottom: 0.15, left: 0.15, right: 0.15 }
            },
            columnStyles: {
                0: { halign: "left" },
                1: { halign: "right", fontStyle: "bold" }
            }
        });

        const pageCount = doc.internal.getNumberOfPages();

        for(let pageNumber = 1; pageNumber <= pageCount; pageNumber++){
            doc.setPage(pageNumber);
            drawFooter(pageNumber, pageCount);
        }

        doc.save(
            `Crown Head Spa - Expense Report - ${branch} - ${monthValue}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to export the expense report.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}
