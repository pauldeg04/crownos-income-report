/* ==========================================================================
   Crown Head Spa — Cash Flow
   Personal, Admin-only ledger: Date / Activity / Cash / Gcash / BDO / RCBC /
   Remarks. Standalone — reads and writes only its own storage key, no
   connection to any other report's calculations.

   Activity is captured as a direction (In / Out / Transfer) rather than
   free text, so the Cash/Gcash/BDO/RCBC columns are always derived
   automatically from a single Amount field instead of four separate boxes.
   ========================================================================== */

const CASHFLOW_PREFIX = "crownCashflow_";
const CASHFLOW_BRANCH_KEY = "crownSelectedBranch";

const CASHFLOW_ACCOUNTS = ["cash", "gcash", "bdo", "rcbc"];

const CASHFLOW_ACCOUNT_LABELS = {
    cash: "Cash",
    gcash: "Gcash",
    bdo: "BDO",
    rcbc: "RCBC"
};

const CASHFLOW_IN_OPTIONS = [
    { value: "cash", label: "Cash in" },
    { value: "gcash", label: "Gcash in" },
    { value: "bdo", label: "BDO in" },
    { value: "rcbc", label: "RCBC in" },
    { value: "others", label: "Others" }
];

const CASHFLOW_OUT_OPTIONS = [
    { value: "cash", label: "Cash out" },
    { value: "gcash", label: "Gcash out" },
    { value: "bdo", label: "BDO out" },
    { value: "rcbc", label: "RCBC out" }
];

/* Mirrors the Expense Report's table keys/titles/account-title lists
   (expenses-report.js) so an Out entry's "Additional Information" can be
   pushed straight into the matching Expense Report ledger. Utilities/Monthly
   Dues and Installments are excluded from the "Add to Expenses Report" sync
   since those tables use a recurring due-date model, not a plain ledger row. */
const CASHFLOW_EXPENSE_TYPES = [
    { value: "operation", label: "Operation Expenses", accountTitles: [
        "Communication", "Supplies", "Fuel and Oil", "Transportation and Travel",
        "Representation", "Repairs and Maintenance", "Professional Fees",
        "Insurance", "Donation", "Miscellaneous", "Postage", "Fixed Asset", "Purchase"
    ] },
    { value: "salary", label: "Payroll", accountTitles: ["Salaries and Allowances", "Staff Benefits and Incentives"] },
    { value: "utilities", label: "Utilities / Monthly Dues", accountTitles: ["Light and Water", "Rental Expense", "Communication"] },
    { value: "installments", label: "Installments", accountTitleFixed: "Repairs and Maintenance" },
    { value: "gov", label: "Accounting / Government Dues", accountTitles: ["SSS, PHIC and HDMF Premiums", "Taxes and Licenses"] },
    { value: "marketing", label: "Marketing", accountTitleFixed: "Advertising" }
];

const CASHFLOW_EXPENSE_SYNC_EXCLUDED = ["utilities", "installments"];
const CASHFLOW_EXPENSE_PREFIX = "crownExpenses_";

let cashflowEntries = [];
let activeCashflowEntryId = null;

function getSelectedCashflowBranch(){
    return localStorage.getItem(CASHFLOW_BRANCH_KEY) || "";
}

document.addEventListener("DOMContentLoaded", function(){
    setCurrentCashflowMonth();
    document.getElementById("branchReadout").textContent = getSelectedCashflowBranch();
    loadCashflowEntries();
    wireCashflowModalEvents();

    document.getElementById("addCashflowEntryBtn")
        .addEventListener("click", function(){ openCashflowModal(null); });

    document.getElementById("clearCashflowDayBtn")
        .addEventListener("click", function(){
            document.getElementById("cashflowDateFilter").value = "";
            renderCashflow();
        });

    document.getElementById("todayCashflowDayBtn")
        .addEventListener("click", function(){
            const today = new Date();

            const todayValue = [
                today.getFullYear(),
                String(today.getMonth() + 1).padStart(2, "0"),
                String(today.getDate()).padStart(2, "0")
            ].join("-");

            const monthInput = document.getElementById("month");
            const dayInput = document.getElementById("cashflowDateFilter");

            dayInput.value = todayValue;

            const todayMonth = todayValue.slice(0, 7);

            if(monthInput.value !== todayMonth){
                monthInput.value = todayMonth;
                loadCashflowEntries();
            }else{
                renderCashflow();
            }
        });

    /* The global toolbar's branch switcher (sidebar.js) lets staff change
       branch without leaving this page. Without this listener, switching
       branches left #branchReadout and the in-memory cashflowEntries
       pointed at the OLD branch — so the next Add/Edit/Delete would
       persist the old branch's entries under the new branch's storage
       key, silently overwriting its real data. */
    window.addEventListener("crownGlobalFiltersChanged", function(){
        document.getElementById("branchReadout").textContent = getSelectedCashflowBranch();
        document.getElementById("cashflowDateFilter").value = "";
        loadCashflowEntries();
    });
});

function setCurrentCashflowMonth(){
    let monthInput = document.getElementById("month");
    let today = new Date();
    let year = today.getFullYear();
    let month = String(today.getMonth() + 1).padStart(2, "0");
    monthInput.value = `${year}-${month}`;
}

function getCashflowStorageKey(){
    let branch = getSelectedCashflowBranch() || "NoBranch";
    let month = document.getElementById("month").value || "NoMonth";
    return CASHFLOW_PREFIX + branch + "_" + month;
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function createCashflowId(){
    return Date.now().toString() + Math.random().toString(16).slice(2);
}

function peso(amount){
    let value = Number(amount) || 0;
    let sign = value < 0 ? "-" : "";

    return sign + "₱" + Math.abs(value).toLocaleString("en-PH", {
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

function formatDateText(dateValue){
    if(!dateValue) return "";

    return new Date(dateValue + "T00:00:00").toLocaleDateString("en-PH", {
        weekday:"long",
        month:"long",
        day:"numeric",
        year:"numeric"
    });
}

function changeBranchMonth(){
    document.getElementById("cashflowDateFilter").value = "";
    loadCashflowEntries();
}

function getCashflowDateFilter(){
    return document.getElementById("cashflowDateFilter").value;
}

function changeCashflowDateFilter(){
    renderCashflow();
}

/* cashflowEntries is loaded scoped to the selected Month (see
   loadCashflowEntries), so stepping the day filter across a month
   boundary has to also update #month and reload — a plain re-render
   would otherwise show zero rows against the wrong month's data. */
function stepCashflowDate(days){
    const dayInput =
        document.getElementById("cashflowDateFilter");

    const monthInput =
        document.getElementById("month");

    const today =
        new Date();

    const todayValue = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");

    const baseValue =
        dayInput.value ||
        (monthInput.value ? monthInput.value + "-01" : todayValue);

    const newValue =
        window.CrownDateStepper?.addDays?.(baseValue, days) ||
        baseValue;

    dayInput.value = newValue;

    const newMonth =
        newValue.slice(0, 7);

    if(monthInput.value !== newMonth){
        monthInput.value = newMonth;
        loadCashflowEntries();
    }else{
        renderCashflow();
    }
}

function sortedCashflowEntries(){
    let dateFilter = getCashflowDateFilter();

    return cashflowEntries
        .filter(entry => !dateFilter || entry.date === dateFilter)
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

function amountCellHtml(value){
    let amount = Number(value) || 0;
    let className = amount > 0 ? "amount-positive" : (amount < 0 ? "amount-negative" : "");

    return `<td class="amount-cell ${className}">${peso(amount)}</td>`;
}

/* Builds the Activity column label and (for the "Others In" case, which
   has no ledger column of its own) an auto-prefixed remarks note so the
   amount is never silently dropped from the entry. */
function cashflowActivityLabel(entry){
    if(entry.label){
        return entry.label;
    }

    if(entry.entryType === "in"){
        if(entry.account === "others"){
            return "Others In";
        }
        return `${CASHFLOW_ACCOUNT_LABELS[entry.account] || "—"} In`;
    }

    if(entry.entryType === "out"){
        return `${CASHFLOW_ACCOUNT_LABELS[entry.account] || "—"} Out`;
    }

    if(entry.entryType === "transfer"){
        return `Transfer: ${CASHFLOW_ACCOUNT_LABELS[entry.fromAccount] || "—"} → ${CASHFLOW_ACCOUNT_LABELS[entry.toAccount] || "—"}`;
    }

    return "—";
}

function cashflowRemarksDisplay(entry){
    if(entry.entryType === "in" && entry.account === "others"){
        let note = `Others: ${peso(entry.amount)}`;
        return entry.remarks ? `${note} — ${entry.remarks}` : note;
    }

    return entry.remarks || "";
}

function renderCashflowTotalsRow(){
    let totalsBody = document.getElementById("cashflowTotalsBody");

    let sums = { cash: 0, gcash: 0, bdo: 0, rcbc: 0 };

    sortedCashflowEntries().forEach(entry => {
        CASHFLOW_ACCOUNTS.forEach(account => {
            sums[account] += Number(entry[account]) || 0;
        });
    });

    let grandTotal = sums.cash + sums.gcash + sums.bdo + sums.rcbc;

    totalsBody.innerHTML = `
        <tr class="totals-row">
            <td colspan="2">Totals</td>
            ${amountCellHtml(sums.cash)}
            ${amountCellHtml(sums.gcash)}
            ${amountCellHtml(sums.bdo)}
            ${amountCellHtml(sums.rcbc)}
            <td></td>
            <td></td>
        </tr>
    `;

    document.getElementById("cashflowGrandTotal").innerText = peso(grandTotal);
}

function renderCashflowBody(){
    let tbody = document.getElementById("cashflowBody");
    let rows = sortedCashflowEntries();

    if(rows.length === 0){
        let message = getCashflowDateFilter()
            ? "No entries for this date. Clear the Date filter to see the whole month."
            : "No entries yet. Click \"+ Add Entry\" to add one.";

        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="8">${message}</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map(entry => `
        <tr>
            <td class="date-text">${entry.date ? formatDateText(entry.date) : "—"}</td>
            <td class="activity-cell">${escapeHtml(cashflowActivityLabel(entry))}</td>
            ${amountCellHtml(entry.cash)}
            ${amountCellHtml(entry.gcash)}
            ${amountCellHtml(entry.bdo)}
            ${amountCellHtml(entry.rcbc)}
            <td class="remarks-cell">${escapeHtml(cashflowRemarksDisplay(entry)) || "—"}</td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openCashflowModal('${entry.id}')">✎ Edit</button>
            </td>
        </tr>
    `).join("");
}

function renderCashflow(){
    renderCashflowTotalsRow();
    renderCashflowBody();
}

/* ==========================================================================
   Add / Edit Cash Flow Entry modal
   ========================================================================== */

function wireCashflowModalEvents(){
    document.getElementById("closeCashflowModalBtn").addEventListener("click", closeCashflowModal);
    document.getElementById("cancelCashflowModalBtn").addEventListener("click", closeCashflowModal);
    document.getElementById("saveCashflowEntryBtn").addEventListener("click", saveCashflowEntryFromModal);
    document.getElementById("deleteCashflowEntryBtn").addEventListener("click", deleteCashflowEntryFromModal);

    document.getElementById("cashflowModalBackdrop").addEventListener("click", function(event){
        if(event.target === this){
            closeCashflowModal();
        }
    });

    document.getElementById("cashflowModalType")
        .addEventListener("change", function(){
            applyCashflowTypeUI(this.value);
            refreshCashflowOutUI();
        });

    applyCashflowExpenseTypeOptions();

    document.getElementById("cashflowModalExpenseType")
        .addEventListener("change", function(){
            applyCashflowExpenseAccountTitleOptions(this.value);
            refreshCashflowOutUI();
        });
}

function applyCashflowExpenseTypeOptions(){
    let select = document.getElementById("cashflowModalExpenseType");

    select.innerHTML =
        '<option value="">Select Type</option>' +
        CASHFLOW_EXPENSE_TYPES.map(type => `<option value="${type.value}">${escapeHtml(type.label)}</option>`).join("");
}

/* Populates the Account Title dropdown from the selected Type. A Type with
   only one possible Account Title (Installments, Marketing) auto-fills and
   locks the field instead of asking the user to pick from a list of one. */
function applyCashflowExpenseAccountTitleOptions(typeValue, preserveTitle){
    let def = CASHFLOW_EXPENSE_TYPES.find(type => type.value === typeValue);
    let select = document.getElementById("cashflowModalExpenseAccountTitle");

    if(!def){
        select.innerHTML = '<option value="">Select Account Title</option>';
        select.disabled = false;
        return;
    }

    if(def.accountTitleFixed){
        select.innerHTML = `<option value="${escapeHtml(def.accountTitleFixed)}">${escapeHtml(def.accountTitleFixed)}</option>`;
        select.value = def.accountTitleFixed;
        select.disabled = true;
        return;
    }

    select.disabled = false;
    select.innerHTML =
        '<option value="">Select Account Title</option>' +
        def.accountTitles.map(title => `<option value="${escapeHtml(title)}">${escapeHtml(title)}</option>`).join("");

    if(preserveTitle && def.accountTitles.includes(preserveTitle)){
        select.value = preserveTitle;
    }
}

/* Shows/hides the "Additional Information" block (Out only) and the
   "Add to Expenses Report" checkbox (Out only, and only for Types that
   have a plain-ledger match in the Expense Report). */
function refreshCashflowOutUI(){
    let activityType = document.getElementById("cashflowModalType").value;
    let expenseType = document.getElementById("cashflowModalExpenseType").value;
    let isOut = activityType === "out";

    document.getElementById("cashflowModalOutInfoWrapper").classList.toggle("d-none", !isOut);

    let excluded = CASHFLOW_EXPENSE_SYNC_EXCLUDED.includes(expenseType);
    let showAddToExpenses = isOut && !!expenseType && !excluded;

    document.getElementById("cashflowModalAddToExpensesWrapper").classList.toggle("d-none", !showAddToExpenses);

    if(!showAddToExpenses){
        document.getElementById("cashflowModalAddToExpenses").checked = false;
    }
}

/* Shows/hides the Account vs. From/To fields and repopulates the Account
   dropdown's options (In includes "Others", Out doesn't). Preserves the
   currently selected account value when it still exists in the new list. */
function applyCashflowTypeUI(type, preserveAccount){
    let accountWrapper = document.getElementById("cashflowModalAccountWrapper");
    let fromWrapper = document.getElementById("cashflowModalFromWrapper");
    let toWrapper = document.getElementById("cashflowModalToWrapper");
    let accountLabel = document.getElementById("cashflowModalAccountLabel");
    let accountSelect = document.getElementById("cashflowModalAccount");

    let isTransfer = type === "transfer";
    let isInOrOut = type === "in" || type === "out";

    accountWrapper.classList.toggle("d-none", !isInOrOut);
    fromWrapper.classList.toggle("d-none", !isTransfer);
    toWrapper.classList.toggle("d-none", !isTransfer);

    if(isInOrOut){
        let options = type === "in" ? CASHFLOW_IN_OPTIONS : CASHFLOW_OUT_OPTIONS;

        accountLabel.textContent = type === "in" ? "Money In To" : "Money Out From";

        accountSelect.innerHTML =
            '<option value="">Select Account</option>' +
            options.map(option => `<option value="${option.value}">${option.label}</option>`).join("");

        if(preserveAccount && options.some(option => option.value === preserveAccount)){
            accountSelect.value = preserveAccount;
        }
    }
}

function openCashflowModal(entryId){
    let branch = getSelectedCashflowBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    let entry = entryId ? cashflowEntries.find(e => e.id === entryId) : null;

    activeCashflowEntryId = entry ? entryId : null;

    document.getElementById("cashflowModalTitle").textContent =
        entry ? "Edit Cash Flow Entry" : "Add Cash Flow Entry";

    document.getElementById("cashflowModalDate").value = entry?.date || "";
    document.getElementById("cashflowModalType").value = entry?.entryType || "";
    document.getElementById("cashflowModalFromAccount").value = entry?.fromAccount || "";
    document.getElementById("cashflowModalToAccount").value = entry?.toAccount || "";
    document.getElementById("cashflowModalAmount").value = entry?.amount || "";
    document.getElementById("cashflowModalRemarks").value = entry?.remarks || "";

    document.getElementById("cashflowModalExpenseType").value = entry?.expenseType || "";
    applyCashflowExpenseAccountTitleOptions(entry?.expenseType || "", entry?.expenseAccountTitle || "");
    document.getElementById("cashflowModalExpenseParticular").value = entry?.expenseParticular || "";
    document.getElementById("cashflowModalExpenseSiNo").value = entry?.siNo || "";
    document.getElementById("cashflowModalExpenseTin").value = entry?.tin || "";
    document.getElementById("cashflowModalAddToExpenses").checked = !!entry?.addToExpenses;

    applyCashflowTypeUI(entry?.entryType || "", entry?.account || "");
    refreshCashflowOutUI();

    document.getElementById("deleteCashflowEntryBtn").classList.toggle("d-none", !entry);

    document.getElementById("cashflowModalBackdrop").classList.remove("d-none");
}

function closeCashflowModal(){
    document.getElementById("cashflowModalBackdrop").classList.add("d-none");
    activeCashflowEntryId = null;
}

function saveCashflowEntryFromModal(){
    let branch = getSelectedCashflowBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    let date = document.getElementById("cashflowModalDate").value;
    let entryType = document.getElementById("cashflowModalType").value;
    let account = document.getElementById("cashflowModalAccount").value;
    let fromAccount = document.getElementById("cashflowModalFromAccount").value;
    let toAccount = document.getElementById("cashflowModalToAccount").value;
    let amount = parseFloat(document.getElementById("cashflowModalAmount").value) || 0;
    let remarks = document.getElementById("cashflowModalRemarks").value.trim();

    let isOut = entryType === "out";
    let expenseType = isOut ? document.getElementById("cashflowModalExpenseType").value : "";
    let expenseAccountTitle = isOut ? document.getElementById("cashflowModalExpenseAccountTitle").value : "";
    let expenseParticular = isOut ? document.getElementById("cashflowModalExpenseParticular").value.trim() : "";
    let siNo = isOut ? document.getElementById("cashflowModalExpenseSiNo").value.trim() : "";
    let tin = isOut ? document.getElementById("cashflowModalExpenseTin").value.trim() : "";
    let addToExpenses = isOut && document.getElementById("cashflowModalAddToExpenses").checked;

    if(!date){
        alert("Please enter a Date.");
        return;
    }

    if(!entryType){
        alert("Please select an Activity (In, Out, or Transfer).");
        return;
    }

    if(amount <= 0){
        alert("Please enter a valid Amount.");
        return;
    }

    if((entryType === "in" || entryType === "out") && !account){
        alert("Please select an Account.");
        return;
    }

    if(entryType === "transfer"){
        if(!fromAccount || !toAccount){
            alert("Please select both Transfer From and Transfer To accounts.");
            return;
        }

        if(fromAccount === toAccount){
            alert("Transfer From and Transfer To must be different accounts.");
            return;
        }
    }

    if(isOut){
        if(!expenseType){
            alert("Please select a Type.");
            return;
        }

        if(!expenseAccountTitle){
            alert("Please select an Account Title.");
            return;
        }

        if(!expenseParticular){
            alert("Please enter a Particular.");
            return;
        }
    }

    let previousEntry = activeCashflowEntryId
        ? cashflowEntries.find(e => e.id === activeCashflowEntryId)
        : null;

    let entry = {
        id: activeCashflowEntryId || createCashflowId(),
        date,
        entryType,
        account: entryType !== "transfer" ? account : "",
        fromAccount: entryType === "transfer" ? fromAccount : "",
        toAccount: entryType === "transfer" ? toAccount : "",
        amount,
        cash: 0,
        gcash: 0,
        bdo: 0,
        rcbc: 0,
        remarks,
        expenseType,
        expenseAccountTitle,
        expenseParticular,
        siNo,
        tin,
        addToExpenses
    };

    if(entryType === "in" && account !== "others"){
        entry[account] = amount;
    }

    if(entryType === "out"){
        entry[account] = -amount;
    }

    if(entryType === "transfer"){
        entry[fromAccount] = -amount;
        entry[toAccount] = amount;
    }

    entry.expenseSyncRef = syncCashflowEntryToExpenses(entry, previousEntry, branch, month);

    if(activeCashflowEntryId){
        let index = cashflowEntries.findIndex(e => e.id === activeCashflowEntryId);
        if(index > -1){
            cashflowEntries[index] = entry;
        }
    } else {
        cashflowEntries.push(entry);
    }

    saveCashflowEntries();
    renderCashflow();
    closeCashflowModal();
}

function deleteCashflowEntryFromModal(){
    if(!activeCashflowEntryId) return;

    if(!confirm("Delete this cash flow entry?")) return;

    let entry = cashflowEntries.find(e => e.id === activeCashflowEntryId);
    if(entry?.expenseSyncRef){
        removeCashflowExpenseSyncRecord(entry.expenseSyncRef);
    }

    cashflowEntries = cashflowEntries.filter(e => e.id !== activeCashflowEntryId);

    saveCashflowEntries();
    renderCashflow();
    closeCashflowModal();
}

/* ==========================================================================
   Expense Report sync — "Add to Expenses Report" checkbox (Out entries only)
   Writes directly to the Expense Report's own localStorage key rather than
   going through expenses-report.js, since that script isn't loaded on this
   page. Cash Flow's date is already "YYYY-MM-DD", and the Expense Report
   only ever reads the first 7 characters of it, so no conversion is needed.
   ========================================================================== */

function getCashflowExpenseStorageKey(branch, month){
    return CASHFLOW_EXPENSE_PREFIX + (branch || "NoBranch") + "_" + (month || "NoMonth");
}

function loadCashflowExpenseData(branch, month){
    try{
        let raw = localStorage.getItem(getCashflowExpenseStorageKey(branch, month));
        let parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(e){
        return {};
    }
}

function saveCashflowExpenseData(branch, month, data){
    localStorage.setItem(getCashflowExpenseStorageKey(branch, month), JSON.stringify(data));
}

function removeCashflowExpenseSyncRecord(ref){
    if(!ref) return;

    let data = loadCashflowExpenseData(ref.branch, ref.month);
    if(!Array.isArray(data[ref.tableKey])) return;

    data[ref.tableKey] = data[ref.tableKey].filter(row => row.id !== ref.entryId);
    saveCashflowExpenseData(ref.branch, ref.month, data);
}

/* Creates, updates, or removes the Expense Report ledger row tied to this
   Cash Flow entry, based on the current addToExpenses checkbox state (and
   the entry's Type, in case it changed since the last save). Returns the
   ref to store on the Cash Flow entry (or null if nothing is synced). */
function syncCashflowEntryToExpenses(entry, previousEntry, branch, month){
    let prevRef = previousEntry?.expenseSyncRef || null;
    let excluded = CASHFLOW_EXPENSE_SYNC_EXCLUDED.includes(entry.expenseType);
    let shouldSync = entry.entryType === "out" && entry.addToExpenses && !excluded;

    if(!shouldSync){
        if(prevRef) removeCashflowExpenseSyncRecord(prevRef);
        return null;
    }

    let sameTarget = prevRef
        && prevRef.branch === branch
        && prevRef.month === month
        && prevRef.tableKey === entry.expenseType;

    let record = {
        id: sameTarget ? prevRef.entryId : createCashflowId(),
        date: entry.date,
        accountTitle: entry.expenseAccountTitle,
        particular: entry.expenseParticular,
        amount: entry.amount,
        siNo: entry.siNo || "",
        tin: entry.tin || "",
        remarks: entry.remarks || ""
    };

    if(!sameTarget && prevRef){
        removeCashflowExpenseSyncRecord(prevRef);
    }

    let data = loadCashflowExpenseData(branch, month);
    if(!Array.isArray(data[entry.expenseType])) data[entry.expenseType] = [];

    if(sameTarget){
        let index = data[entry.expenseType].findIndex(row => row.id === prevRef.entryId);
        if(index > -1){
            data[entry.expenseType][index] = record;
        } else {
            data[entry.expenseType].push(record);
        }
    } else {
        data[entry.expenseType].push(record);
    }

    saveCashflowExpenseData(branch, month, data);

    return { branch, month, tableKey: entry.expenseType, entryId: record.id };
}

/* ==========================================================================
   Storage
   ========================================================================== */

function saveCashflowEntries(){
    let branch = getSelectedCashflowBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month) return;

    localStorage.setItem(getCashflowStorageKey(), JSON.stringify(cashflowEntries));
}

function loadCashflowEntries(){
    let branch = getSelectedCashflowBranch();
    let month = document.getElementById("month").value;

    cashflowEntries = [];

    if(branch && month){
        let saved = localStorage.getItem(getCashflowStorageKey());

        if(saved){
            let parsed = JSON.parse(saved);

            if(Array.isArray(parsed)){
                cashflowEntries = parsed.map(row => ({
                    id: row.id || createCashflowId(),
                    date: row.date || "",
                    entryType: row.entryType || "",
                    account: row.account || "",
                    fromAccount: row.fromAccount || "",
                    toAccount: row.toAccount || "",
                    amount: Number(row.amount) || 0,
                    cash: Number(row.cash) || 0,
                    gcash: Number(row.gcash) || 0,
                    bdo: Number(row.bdo) || 0,
                    rcbc: Number(row.rcbc) || 0,
                    remarks: row.remarks || "",
                    label: row.label || "",
                    expenseType: row.expenseType || "",
                    expenseAccountTitle: row.expenseAccountTitle || "",
                    expenseParticular: row.expenseParticular || "",
                    siNo: row.siNo || "",
                    tin: row.tin || "",
                    addToExpenses: !!row.addToExpenses,
                    expenseSyncRef: row.expenseSyncRef || null
                }));
            }
        }
    }

    renderCashflow();
}
