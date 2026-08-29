/* ==========================================================================
   Crown Head Spa — Loyalty Card Sales Summary
   Reads settled Loyalty/VIP Card line items straight from Daily Income
   Report data (read-only), plus an independent Loyalty Card expense
   ledger (Add/Edit popup, same pattern as Expenses Report) that never
   mixes into crownExpenses_* — this page's totals only.
   ========================================================================== */

const STORAGE_PREFIX = "crownDailySales_";
const LOYALTY_EXPENSE_PREFIX = "crownLoyaltyExpenses_";
const LOYALTY_PREV_FUND_PREFIX = "crownLoyaltyPrevFund_";
const BRANCH_KEY = "crownSelectedBranch";

function getSelectedBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

let expenseEntries = [];
let activeModalEntryId = null;
let currentSalesRows = [];
let currentSalesTotal = 0;
let currentPrevFund = 0;

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    document.getElementById("branchReadout").textContent = getSelectedBranch();
    wireModalEvents();

    document.getElementById("prevMonthFundInput")
        .addEventListener("change", savePrevFund);

    document.getElementById("exportPdfBtn")
        .addEventListener("click", exportPDF);

    showLoyaltyTab(LOYALTY_VIEW_TABS[0][0]);

    refreshReport();
});

const LOYALTY_VIEW_TABS = [
    ["sales", "Loyalty Card Sales"],
    ["expenses", "Loyalty Card Expenses"],
    ["summary", "Summary"]
];
let currentLoyaltyTab = LOYALTY_VIEW_TABS[0][0];

function renderLoyaltyViewTabs(){
    let nav = document.getElementById("loyaltyViewTabs");
    nav.innerHTML = "";

    LOYALTY_VIEW_TABS.forEach(([id, label]) => {
        let b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(currentLoyaltyTab === id));
        b.textContent = label;
        b.addEventListener("click", () => showLoyaltyTab(id));
        nav.appendChild(b);
    });
}

function showLoyaltyTab(id){
    currentLoyaltyTab = id;

    document.querySelectorAll("[data-tab-panel]").forEach(panel => {
        panel.classList.toggle("d-none", panel.dataset.tabPanel !== id);
    });

    renderLoyaltyViewTabs();
}

function setCurrentMonth(){
    const monthInput = document.getElementById("month");

    if(!monthInput.value){
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");

        monthInput.value = `${year}-${month}`;
    }
}

function peso(amount){
    return "₱" + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/* jsPDF's built-in helvetica font has no ₱ glyph — it prints as a
   garbled replacement character. Use "PHP" instead for anything drawn
   on the PDF (screen display keeps using peso() above). */
function pesoPdf(amount){
    return "PHP " + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatDateText(dateValue){
    if(!dateValue) return "";

    return new Date(dateValue + "T00:00:00").toLocaleDateString("en-PH", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    });
}

function formatMonthLabel(monthValue){
    if(!monthValue) return "";

    return new Date(monthValue + "-01T00:00:00").toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric"
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

function createId(){
    return Date.now().toString() + Math.random().toString(16).slice(2);
}

function getIncomeStorageKey(branch, date){
    return STORAGE_PREFIX + branch + "_" + date;
}

function getDaysInMonth(year, month){
    return new Date(year, month, 0).getDate();
}

/* ==========================================================================
   Loyalty / VIP Card detection — ported from script.js's isVipCardName()
   so this page's totals match what Daily Income already records.
   ========================================================================== */

function normalizeName(value){
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function isVipCardName(value){
    const normalized = normalizeName(value);

    return (
        normalized === "vipcard" ||
        normalized.includes("vipmembershipcard") ||
        normalized.includes("viployaltycard")
    );
}

function getLoyaltyLineItems(row){
    const items = Array.isArray(row?.services) ? row.services : [];

    return items.filter(function(item){
        return item?.itemType === "Product" && isVipCardName(item?.name);
    });
}

/* ==========================================================================
   Loyalty Card Sales — read-only, sourced from Daily Income Report
   ========================================================================== */

function changeBranchMonth(){
    refreshReport();
}

function refreshReport(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;
    const tbody = document.getElementById("loyaltySalesBody");

    currentSalesRows = [];
    currentSalesTotal = 0;

    if(!branch || !monthValue){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="4">No loyalty card sales recorded for this period.</td>
            </tr>
        `;

        document.getElementById("loyaltySalesTotal").textContent = peso(0);
        loadPrevFund();
        loadExpenses();
        return;
    }

    const [year, month] = monthValue.split("-").map(Number);
    const daysInMonth = getDaysInMonth(year, month);

    for(let day = 1; day <= daysInMonth; day++){
        const dateString =
            `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const saved = localStorage.getItem(getIncomeStorageKey(branch, dateString));

        if(!saved) continue;

        let data;

        try{
            data = JSON.parse(saved);
        }catch(error){
            console.error("Unable to load daily sales for loyalty summary:", dateString, error);
            continue;
        }

        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const clients = [];
        let count = 0;
        let total = 0;

        rows.forEach(function(row){
            if(!row?.settled) return;

            const loyaltyItems = getLoyaltyLineItems(row);

            if(loyaltyItems.length === 0) return;

            loyaltyItems.forEach(function(item){
                const quantity = Math.max(1, Number(item?.quantity) || 1);

                const amount =
                    Number.isFinite(Number(item?.amount))
                        ? Number(item.amount)
                        : quantity * (Number(item?.unitPrice) || 0);

                count += quantity;
                total += Math.max(0, amount);
            });

            clients.push(row.client || "—");
        });

        if(count === 0) continue;

        currentSalesTotal += total;

        currentSalesRows.push({
            date: dateString,
            clients: clients,
            count: count,
            total: total
        });
    }

    if(currentSalesRows.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="4">No loyalty card sales recorded for this period.</td>
            </tr>
        `;
    }else{
        tbody.innerHTML = currentSalesRows.map(function(entry){
            return `
                <tr>
                    <td class="text-start"><div class="date-text">${formatDateText(entry.date)}</div></td>
                    <td class="text-start">${escapeHtml(entry.clients.join(", "))}</td>
                    <td>${entry.count}</td>
                    <td class="amount-cell">${peso(entry.total)}</td>
                </tr>
            `;
        }).join("");
    }

    document.getElementById("loyaltySalesTotal").textContent = peso(currentSalesTotal);

    loadPrevFund();
    loadExpenses();
}

/* ==========================================================================
   Previous Month Fund — a single carried-over amount per branch+month,
   folded into the Summary alongside this month's Sales/Expenses.
   ========================================================================== */

function getPrevFundStorageKey(){
    const branch = getSelectedBranch() || "NoBranch";
    const month = document.getElementById("month").value || "NoMonth";

    return LOYALTY_PREV_FUND_PREFIX + branch + "_" + month;
}

function loadPrevFund(){
    const branch = getSelectedBranch();
    const month = document.getElementById("month").value;

    currentPrevFund = 0;

    if(branch && month){
        const saved = localStorage.getItem(getPrevFundStorageKey());
        currentPrevFund = Number(saved) || 0;
    }

    document.getElementById("prevMonthFundInput").value =
        currentPrevFund || "";
}

function savePrevFund(){
    const branch = getSelectedBranch();
    const month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    currentPrevFund =
        Math.max(0, parseFloat(document.getElementById("prevMonthFundInput").value) || 0);

    localStorage.setItem(getPrevFundStorageKey(), String(currentPrevFund));

    updateSummary();
}

/* ==========================================================================
   Loyalty Card Expenses — independent ledger, own storage key so it never
   mixes into the main Expenses Report (crownExpenses_*).
   ========================================================================== */

function getExpenseStorageKey(){
    const branch = getSelectedBranch() || "NoBranch";
    const month = document.getElementById("month").value || "NoMonth";

    return LOYALTY_EXPENSE_PREFIX + branch + "_" + month;
}

function sortedExpenses(){
    return [...expenseEntries].sort(function(a, b){
        return (a.date || "").localeCompare(b.date || "");
    });
}

function loadExpenses(){
    const branch = getSelectedBranch();
    const month = document.getElementById("month").value;

    expenseEntries = [];

    if(branch && month){
        const saved = localStorage.getItem(getExpenseStorageKey());

        if(saved){
            try{
                const parsed = JSON.parse(saved);

                expenseEntries = Array.isArray(parsed)
                    ? parsed.map(function(row){
                        return {
                            id: row.id || createId(),
                            date: row.date || "",
                            particular: row.particular || "",
                            amount: Number(row.amount) || 0,
                            remarks: row.remarks || ""
                        };
                    })
                    : [];
            }catch(error){
                console.error("Unable to load loyalty card expenses:", error);
                expenseEntries = [];
            }
        }
    }

    renderExpenseTable();
}

function saveExpenses(){
    const branch = getSelectedBranch();
    const month = document.getElementById("month").value;

    if(!branch || !month) return;

    localStorage.setItem(getExpenseStorageKey(), JSON.stringify(expenseEntries));
}

function renderExpenseTable(){
    const tbody = document.getElementById("loyaltyExpenseBody");
    const rows = sortedExpenses();

    if(rows.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="5">No entries yet. Click "+ Add Particular" to add one.</td>
            </tr>
        `;
    }else{
        tbody.innerHTML = rows.map(function(entry){
            return `
                <tr>
                    <td class="text-start"><div class="date-text">${entry.date ? formatDateText(entry.date) : "—"}</div></td>
                    <td class="text-start">${escapeHtml(entry.particular)}</td>
                    <td class="amount-cell">${peso(entry.amount)}</td>
                    <td class="text-start">${escapeHtml(entry.remarks) || "—"}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openExpenseModal('${entry.id}')">✎ Edit</button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    const total = expenseEntries.reduce(function(sum, entry){
        return sum + (Number(entry.amount) || 0);
    }, 0);

    document.getElementById("loyaltyExpenseTotal").textContent = peso(total);

    updateSummary();
}

function updateSummary(){
    const expenseTotal = expenseEntries.reduce(function(sum, entry){
        return sum + (Number(entry.amount) || 0);
    }, 0);

    const net = currentPrevFund + currentSalesTotal - expenseTotal;

    document.getElementById("summarySales").textContent = peso(currentSalesTotal);
    document.getElementById("summaryExpenses").textContent = peso(expenseTotal);
    document.getElementById("summaryNet").textContent = peso(net);

    document.getElementById("summaryNetRow").classList.toggle("negative-net", net < 0);
}

/* ==========================================================================
   Add / Edit Loyalty Card Expense Entry modal
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

function openExpenseModal(entryId){
    const branch = getSelectedBranch();
    const month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    const entry = entryId ? expenseEntries.find(e => e.id === entryId) : null;

    activeModalEntryId = entry ? entryId : null;

    document.getElementById("expenseModalTitle").textContent =
        (entry ? "Edit " : "Add ") + "Loyalty Card Expense Entry";

    document.getElementById("expenseModalDate").value = entry?.date || "";
    document.getElementById("expenseModalParticular").value = entry?.particular || "";
    document.getElementById("expenseModalAmount").value = entry?.amount || "";
    document.getElementById("expenseModalRemarks").value = entry?.remarks || "";

    document.getElementById("deleteExpenseEntryBtn").classList.toggle("d-none", !entry);

    document.getElementById("expenseModalBackdrop").classList.remove("d-none");
}

function closeExpenseModal(){
    document.getElementById("expenseModalBackdrop").classList.add("d-none");
    activeModalEntryId = null;
}

function saveExpenseEntryFromModal(){
    const branch = getSelectedBranch();
    const month = document.getElementById("month").value;

    if(!branch || !month){
        alert("Please select branch and month first.");
        return;
    }

    const date = document.getElementById("expenseModalDate").value;
    const particular = document.getElementById("expenseModalParticular").value.trim();
    const amount = parseFloat(document.getElementById("expenseModalAmount").value) || 0;
    const remarks = document.getElementById("expenseModalRemarks").value.trim();

    if(!particular){
        alert("Please enter a Particular.");
        return;
    }

    if(amount <= 0){
        alert("Please enter a valid Amount.");
        return;
    }

    const entry = {
        id: activeModalEntryId || createId(),
        date,
        particular,
        amount,
        remarks
    };

    if(activeModalEntryId){
        const index = expenseEntries.findIndex(e => e.id === activeModalEntryId);
        if(index > -1) expenseEntries[index] = entry;
    }else{
        expenseEntries.push(entry);
    }

    saveExpenses();
    renderExpenseTable();
    closeExpenseModal();
}

function deleteExpenseEntryFromModal(){
    if(!activeModalEntryId) return;

    if(!confirm("Delete this expense entry?")) return;

    expenseEntries = expenseEntries.filter(e => e.id !== activeModalEntryId);

    saveExpenses();
    renderExpenseTable();
    closeExpenseModal();
}

/* ==========================================================================
   Export to PDF — Loyalty Card Sales table, Loyalty Card Expenses ledger,
   then the Sales-less-Expenses Summary, navy/gold executive styling
   matching the rest of CrownOS's reports.
   ========================================================================== */

function exportPDF(){
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

    const button = document.getElementById("exportPdfBtn");

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
        const monthLabel = formatMonthLabel(monthValue);

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Loyalty Card Sales Summary", 14, 18);

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

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.text("Loyalty Card Sales", 14, cursorY);
        cursorY += 4;

        const salesBody = currentSalesRows.length
            ? currentSalesRows.map(function(entry){
                return [
                    formatDateText(entry.date),
                    entry.clients.join(", ") || "—",
                    String(entry.count),
                    pesoPdf(entry.total)
                ];
            })
            : [[{
                content: "No loyalty card sales recorded for this period.",
                colSpan: 4,
                styles: { halign: "center", textColor: [140, 146, 158], fontStyle: "italic" }
            }]];

        doc.autoTable({
            startY: cursorY,
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            head: [["Date", "Clients", "Loyalty Card Sale", "Total"]],
            body: salesBody,
            foot: currentSalesRows.length ? [["", "", "Grand Total", pesoPdf(currentSalesTotal)]] : undefined,
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
                3: { halign: "right" }
            }
        });

        cursorY = doc.lastAutoTable.finalY + 10;

        if(cursorY > pageHeight - 45){
            doc.addPage();
            drawHeader();
            cursorY = 34;
        }

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.text("Loyalty Card Expenses", 14, cursorY);
        cursorY += 4;

        const expenseRows = sortedExpenses();

        const expenseTotal = expenseRows.reduce(function(sum, entry){
            return sum + (Number(entry.amount) || 0);
        }, 0);

        const expenseBody = expenseRows.length
            ? expenseRows.map(function(entry){
                return [
                    entry.date ? formatDateText(entry.date) : "—",
                    entry.particular || "—",
                    pesoPdf(entry.amount),
                    entry.remarks || "—"
                ];
            })
            : [[{
                content: "No entries recorded for this period.",
                colSpan: 4,
                styles: { halign: "center", textColor: [140, 146, 158], fontStyle: "italic" }
            }]];

        doc.autoTable({
            startY: cursorY,
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            head: [["Date", "Particular", "Amount", "Remarks"]],
            body: expenseBody,
            foot: expenseRows.length ? [["", "Subtotal", pesoPdf(expenseTotal), ""]] : undefined,
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
                2: { halign: "right" }
            }
        });

        cursorY = doc.lastAutoTable.finalY + 10;

        if(cursorY > pageHeight - 60){
            doc.addPage();
            drawHeader();
            cursorY = 34;
        }

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Summary", 14, cursorY);
        cursorY += 4;

        const net = currentPrevFund + currentSalesTotal - expenseTotal;

        doc.autoTable({
            startY: cursorY,
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            head: [["Category", "Total Amount"]],
            body: [
                ["Previous Month Fund", pesoPdf(currentPrevFund)],
                ["Loyalty Card Sales", pesoPdf(currentSalesTotal)],
                ["Less: Loyalty Card Expenses", pesoPdf(expenseTotal)]
            ],
            foot: [["Loyalty Card Sales Less Expenses", pesoPdf(net)]],
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
            `Crown Head Spa - Loyalty Card Sales Summary - ${branch} - ${monthValue}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to export the loyalty card sales summary.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}
