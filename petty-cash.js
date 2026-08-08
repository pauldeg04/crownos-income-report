/* ==========================================================================
   Crown Head Spa — Petty Cash
   Per-branch petty cash fund tracker. Each "Replenish" starts a new fund
   (a table of its own); every transaction logged against it subtracts from
   the released amount until "Liquidate" closes the fund and files it under
   History. Only one fund can be open per branch at a time — Replenish is
   hidden while a fund is already active, matching how a real petty cash
   custodian works (liquidate the current float before drawing a new one).
   ========================================================================== */

const PETTY_CASH_PREFIX = "crownPettyCash_";
const PETTY_CASH_BRANCH_KEY = "crownSelectedBranch";

/* Liquidating a fund also posts every one of its transactions into
   Expenses Report's Operation Expenses table (crownExpenses_<branch>_<month>,
   same storage shape expenses-report.js reads/writes), so the spend shows up
   there without being re-typed. */
const PETTY_CASH_EXPENSE_PREFIX = "crownExpenses_";
const PETTY_CASH_EXPENSE_CATEGORY = "Branch Expenses";
const PETTY_CASH_EXPENSE_PAYMENT = "Petty Cash";

let pettyCashState = { activeFund: null, history: [] };
let activePettyCashEntryId = null;
let historyDetailFundId = null;

function getSelectedPettyCashBranch(){
    return localStorage.getItem(PETTY_CASH_BRANCH_KEY) || "";
}

document.addEventListener("DOMContentLoaded", function(){
    document.getElementById("branchReadout").textContent = getSelectedPettyCashBranch();
    loadPettyCashState();
    wirePettyCashEvents();

    window.addEventListener("crownGlobalFiltersChanged", function(){
        document.getElementById("branchReadout").textContent = getSelectedPettyCashBranch();
        loadPettyCashState();
    });
});

function peso(amount){
    let value = Number(amount) || 0;
    let sign = value < 0 ? "-" : "";

    return sign + "₱" + Math.abs(value).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function createPettyCashId(){
    return Date.now().toString() + Math.random().toString(16).slice(2);
}

function formatDateText(dateValue){
    if(!dateValue) return "—";

    return new Date(dateValue + "T00:00:00").toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function getTodayDateValue(){
    const today = new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
}

/* ==========================================================================
   Fund math
   ========================================================================== */

function fundTotalSpent(fund){
    return (fund?.entries || []).reduce(function(sum, entry){
        return sum + (Number(entry.totalCost) || 0);
    }, 0);
}

function fundRemaining(fund){
    return (Number(fund?.releasedAmount) || 0) - fundTotalSpent(fund);
}

/* ==========================================================================
   Rendering
   ========================================================================== */

function renderPettyCash(){
    const fund = pettyCashState.activeFund;

    document.getElementById("replenishPettyCashBtn").classList.toggle("d-none", Boolean(fund));
    document.getElementById("pettyCashFundCard").classList.toggle("d-none", !fund);
    document.getElementById("noPettyCashFundState").classList.toggle("d-none", Boolean(fund));

    if(!fund){
        return;
    }

    document.getElementById("pettyCashReleasedAmount").textContent = peso(fund.releasedAmount);
    document.getElementById("pettyCashTotalSpent").textContent = peso(fundTotalSpent(fund));
    document.getElementById("pettyCashRemaining").textContent = peso(fundRemaining(fund));
    document.getElementById("pettyCashReleaseDateReadout").textContent = formatDateText(fund.releaseDate);

    const rows = (fund.entries || [])
        .slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const tbody = document.getElementById("pettyCashBody");

    if(rows.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7">No transactions yet. Click "+ Add Entry" to log a petty cash release.</td>
            </tr>
        `;
    }else{
        tbody.innerHTML = rows.map(entry => `
            <tr>
                <td class="date-text">${formatDateText(entry.date)}</td>
                <td class="particular-cell">${escapeHtml(entry.particular) || "—"}</td>
                <td class="remarks-cell">${escapeHtml(entry.remarks) || "—"}</td>
                <td class="qty-cell">${Number(entry.qty) || 0}</td>
                <td class="amount-cell">${peso(entry.unitCost)}</td>
                <td class="amount-cell">${peso(entry.totalCost)}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openPettyCashEntryModal('${entry.id}')">✎ Edit</button>
                </td>
            </tr>
        `).join("");
    }
}

/* ==========================================================================
   Replenish (opens a new fund)
   ========================================================================== */

function wirePettyCashEvents(){
    document.getElementById("replenishPettyCashBtn")
        .addEventListener("click", openReplenishModal);

    document.getElementById("closeReplenishModalBtn")
        .addEventListener("click", closeReplenishModal);

    document.getElementById("cancelReplenishBtn")
        .addEventListener("click", closeReplenishModal);

    document.getElementById("saveReplenishBtn")
        .addEventListener("click", saveReplenishFromModal);

    document.getElementById("replenishModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this) closeReplenishModal();
        });

    document.getElementById("addPettyCashEntryBtn")
        .addEventListener("click", function(){ openPettyCashEntryModal(null); });

    document.getElementById("closePettyCashModalBtn")
        .addEventListener("click", closePettyCashEntryModal);

    document.getElementById("cancelPettyCashModalBtn")
        .addEventListener("click", closePettyCashEntryModal);

    document.getElementById("savePettyCashEntryBtn")
        .addEventListener("click", savePettyCashEntryFromModal);

    document.getElementById("deletePettyCashEntryBtn")
        .addEventListener("click", deletePettyCashEntryFromModal);

    document.getElementById("pettyCashModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this) closePettyCashEntryModal();
        });

    ["pettyCashModalQty", "pettyCashModalUnitCost"].forEach(function(id){
        document.getElementById(id).addEventListener("input", updatePettyCashModalTotal);
    });

    document.getElementById("liquidatePettyCashBtn")
        .addEventListener("click", openLiquidateModal);

    document.getElementById("closeLiquidateModalBtn")
        .addEventListener("click", closeLiquidateModal);

    document.getElementById("cancelLiquidateBtn")
        .addEventListener("click", closeLiquidateModal);

    document.getElementById("confirmLiquidateBtn")
        .addEventListener("click", confirmLiquidatePettyCash);

    document.getElementById("liquidateModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this) closeLiquidateModal();
        });

    document.getElementById("pettyCashHistoryBtn")
        .addEventListener("click", openHistoryModal);

    document.getElementById("closeHistoryModalBtn")
        .addEventListener("click", closeHistoryModal);

    document.getElementById("historyModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this) closeHistoryModal();
        });

    document.getElementById("historyBackToListBtn")
        .addEventListener("click", showHistoryListView);
}

function openReplenishModal(){
    if(!getSelectedPettyCashBranch()){
        alert("Please select a branch first.");
        return;
    }

    document.getElementById("replenishDate").value = getTodayDateValue();
    document.getElementById("replenishAmount").value = "";
    document.getElementById("replenishRemarks").value = "";
    document.getElementById("replenishModalBackdrop").classList.remove("d-none");
    document.getElementById("replenishAmount").focus();
}

function closeReplenishModal(){
    document.getElementById("replenishModalBackdrop").classList.add("d-none");
}

function saveReplenishFromModal(){
    const date = document.getElementById("replenishDate").value;
    const amount = parseFloat(document.getElementById("replenishAmount").value) || 0;
    const remarks = document.getElementById("replenishRemarks").value.trim();

    if(!date){
        alert("Please enter a release date.");
        return;
    }

    if(amount <= 0){
        alert("Please enter a valid petty cash amount to release.");
        return;
    }

    pettyCashState.activeFund = {
        id: createPettyCashId(),
        releaseDate: date,
        releasedAmount: amount,
        releaseRemarks: remarks,
        entries: [],
        status: "active"
    };

    savePettyCashState();
    renderPettyCash();
    closeReplenishModal();
}

/* ==========================================================================
   Add / Edit transaction
   ========================================================================== */

function updatePettyCashModalTotal(){
    const qty = parseFloat(document.getElementById("pettyCashModalQty").value) || 0;
    const unitCost = parseFloat(document.getElementById("pettyCashModalUnitCost").value) || 0;

    document.getElementById("pettyCashModalTotalReadout").textContent = peso(qty * unitCost);
}

function openPettyCashEntryModal(entryId){
    const fund = pettyCashState.activeFund;

    if(!fund){
        alert("Release petty cash first before logging a transaction.");
        return;
    }

    const entry = entryId ? fund.entries.find(e => e.id === entryId) : null;

    activePettyCashEntryId = entry ? entryId : null;

    document.getElementById("pettyCashModalTitle").textContent =
        entry ? "Edit Petty Cash Transaction" : "Add Petty Cash Transaction";

    document.getElementById("pettyCashModalDate").value = entry?.date || getTodayDateValue();
    document.getElementById("pettyCashModalParticular").value = entry?.particular || "";
    document.getElementById("pettyCashModalRemarks").value = entry?.remarks || "";
    document.getElementById("pettyCashModalQty").value = entry?.qty ?? 1;
    document.getElementById("pettyCashModalUnitCost").value = entry?.unitCost ?? "";

    updatePettyCashModalTotal();

    document.getElementById("deletePettyCashEntryBtn").classList.toggle("d-none", !entry);
    document.getElementById("pettyCashModalBackdrop").classList.remove("d-none");
}

function closePettyCashEntryModal(){
    document.getElementById("pettyCashModalBackdrop").classList.add("d-none");
    activePettyCashEntryId = null;
}

function savePettyCashEntryFromModal(){
    const fund = pettyCashState.activeFund;

    if(!fund) return;

    const date = document.getElementById("pettyCashModalDate").value;
    const particular = document.getElementById("pettyCashModalParticular").value.trim();
    const remarks = document.getElementById("pettyCashModalRemarks").value.trim();
    const qty = parseFloat(document.getElementById("pettyCashModalQty").value) || 0;
    const unitCost = parseFloat(document.getElementById("pettyCashModalUnitCost").value) || 0;

    if(!date){
        alert("Please enter a Date.");
        return;
    }

    if(!particular){
        alert("Please enter a Particular.");
        return;
    }

    if(qty <= 0){
        alert("Please enter a valid QTY.");
        return;
    }

    if(unitCost <= 0){
        alert("Please enter a valid Unit Cost.");
        return;
    }

    const entry = {
        id: activePettyCashEntryId || createPettyCashId(),
        date,
        particular,
        remarks,
        qty,
        unitCost,
        totalCost: qty * unitCost
    };

    if(activePettyCashEntryId){
        const index = fund.entries.findIndex(e => e.id === activePettyCashEntryId);
        if(index > -1) fund.entries[index] = entry;
    }else{
        fund.entries.push(entry);
    }

    savePettyCashState();
    renderPettyCash();
    closePettyCashEntryModal();
}

function deletePettyCashEntryFromModal(){
    const fund = pettyCashState.activeFund;

    if(!fund || !activePettyCashEntryId) return;

    if(!confirm("Delete this petty cash transaction?")) return;

    fund.entries = fund.entries.filter(e => e.id !== activePettyCashEntryId);

    savePettyCashState();
    renderPettyCash();
    closePettyCashEntryModal();
}

/* ==========================================================================
   Liquidate (closes the active fund)
   ========================================================================== */

function openLiquidateModal(){
    const fund = pettyCashState.activeFund;

    if(!fund) return;

    document.getElementById("liquidateReleasedReadout").textContent = peso(fund.releasedAmount);
    document.getElementById("liquidateSpentReadout").textContent = peso(fundTotalSpent(fund));
    document.getElementById("liquidateRemainingReadout").textContent = peso(fundRemaining(fund));
    document.getElementById("liquidateRemarks").value = "";
    document.getElementById("liquidateModalBackdrop").classList.remove("d-none");
}

function closeLiquidateModal(){
    document.getElementById("liquidateModalBackdrop").classList.add("d-none");
}

function confirmLiquidatePettyCash(){
    const fund = pettyCashState.activeFund;

    if(!fund) return;

    fund.status = "closed";
    fund.liquidatedDate = getTodayDateValue();
    fund.liquidatedRemaining = fundRemaining(fund);
    fund.liquidatedRemarks = document.getElementById("liquidateRemarks").value.trim();

    postPettyCashEntriesToExpenses(fund);

    pettyCashState.history.unshift(fund);
    pettyCashState.activeFund = null;

    savePettyCashState();
    renderPettyCash();
    closeLiquidateModal();
}

/* Posts every transaction of a just-liquidated fund into Expenses Report's
   Operation Expenses table, dated the liquidation date (not each
   transaction's own date) per how the custodian actually reports it —
   as one batch on the day the float was liquidated. */
function postPettyCashEntriesToExpenses(fund){
    const entries = fund.entries || [];

    if(entries.length === 0) return;

    const branch = getSelectedPettyCashBranch();

    if(!branch) return;

    const month = fund.liquidatedDate.slice(0, 7);
    const key = PETTY_CASH_EXPENSE_PREFIX + branch + "_" + month;

    let expenseData = {};

    try{
        const saved = localStorage.getItem(key);
        const parsed = saved ? JSON.parse(saved) : {};
        if(parsed && typeof parsed === "object") expenseData = parsed;
    }catch(error){
        console.error("Unable to load expenses data:", error);
    }

    if(!Array.isArray(expenseData.operation)){
        expenseData.operation = [];
    }

    entries.forEach(function(entry){
        expenseData.operation.push({
            id: createPettyCashId(),
            date: fund.liquidatedDate,
            category: PETTY_CASH_EXPENSE_CATEGORY,
            particular: entry.particular,
            amount: Number(entry.totalCost) || 0,
            payment: PETTY_CASH_EXPENSE_PAYMENT,
            remarks: entry.remarks
        });
    });

    localStorage.setItem(key, JSON.stringify(expenseData));
}

/* ==========================================================================
   History
   ========================================================================== */

function openHistoryModal(){
    showHistoryListView();
    document.getElementById("historyModalBackdrop").classList.remove("d-none");
}

function closeHistoryModal(){
    document.getElementById("historyModalBackdrop").classList.add("d-none");
    historyDetailFundId = null;
}

function showHistoryListView(){
    historyDetailFundId = null;

    document.getElementById("historyListView").classList.remove("d-none");
    document.getElementById("historyDetailView").classList.add("d-none");
    document.getElementById("historyBackToListBtn").classList.add("d-none");
    document.getElementById("historyModalTitle").textContent = "Petty Cash History";

    const tbody = document.getElementById("historyListBody");
    const funds = pettyCashState.history;

    if(funds.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">No liquidated petty cash funds yet.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = funds.map(fund => `
        <tr>
            <td class="date-text">${formatDateText(fund.releaseDate)}</td>
            <td class="date-text">${formatDateText(fund.liquidatedDate)}</td>
            <td class="amount-cell">${peso(fund.releasedAmount)}</td>
            <td class="amount-cell">${peso(fundTotalSpent(fund))}</td>
            <td class="amount-cell">${peso(fund.liquidatedRemaining)}</td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openHistoryDetailView('${fund.id}')">View</button>
            </td>
        </tr>
    `).join("");
}

function openHistoryDetailView(fundId){
    const fund = pettyCashState.history.find(f => f.id === fundId);

    if(!fund) return;

    historyDetailFundId = fundId;

    document.getElementById("historyListView").classList.add("d-none");
    document.getElementById("historyDetailView").classList.remove("d-none");
    document.getElementById("historyBackToListBtn").classList.remove("d-none");
    document.getElementById("historyModalTitle").textContent =
        "Petty Cash — Released " + formatDateText(fund.releaseDate);

    document.getElementById("historyDetailReleased").textContent = peso(fund.releasedAmount);
    document.getElementById("historyDetailSpent").textContent = peso(fundTotalSpent(fund));
    document.getElementById("historyDetailRemaining").textContent = peso(fund.liquidatedRemaining);
    document.getElementById("historyDetailRemarks").textContent = fund.liquidatedRemarks || "—";

    const rows = (fund.entries || [])
        .slice()
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const tbody = document.getElementById("historyDetailBody");

    if(rows.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">No transactions were logged for this fund.</td>
            </tr>
        `;
    }else{
        tbody.innerHTML = rows.map(entry => `
            <tr>
                <td class="date-text">${formatDateText(entry.date)}</td>
                <td class="particular-cell">${escapeHtml(entry.particular) || "—"}</td>
                <td class="remarks-cell">${escapeHtml(entry.remarks) || "—"}</td>
                <td class="qty-cell">${Number(entry.qty) || 0}</td>
                <td class="amount-cell">${peso(entry.unitCost)}</td>
                <td class="amount-cell">${peso(entry.totalCost)}</td>
            </tr>
        `).join("");
    }
}

/* ==========================================================================
   Storage
   ========================================================================== */

function getPettyCashStorageKey(){
    const branch = getSelectedPettyCashBranch() || "NoBranch";
    return PETTY_CASH_PREFIX + branch;
}

function savePettyCashState(){
    if(!getSelectedPettyCashBranch()) return;

    localStorage.setItem(getPettyCashStorageKey(), JSON.stringify(pettyCashState));
}

function loadPettyCashState(){
    pettyCashState = { activeFund: null, history: [] };

    const branch = getSelectedPettyCashBranch();

    if(branch){
        const saved = localStorage.getItem(getPettyCashStorageKey());

        if(saved){
            try{
                const parsed = JSON.parse(saved);

                if(parsed && typeof parsed === "object"){
                    pettyCashState = {
                        activeFund: parsed.activeFund || null,
                        history: Array.isArray(parsed.history) ? parsed.history : []
                    };
                }
            }catch(error){
                console.error("Unable to load petty cash data:", error);
            }
        }
    }

    renderPettyCash();
}
