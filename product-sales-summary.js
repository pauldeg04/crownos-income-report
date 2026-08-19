/* ==========================================================================
   Crown Head Spa — Product Sales Summary
   Lists every settled Product line item straight from Daily Income Report
   data (read-only, one row per item — excludes Loyalty/VIP Card items,
   which belong to Loyalty Card Sales Summary instead), plus an independent
   Product Sales expense ledger (Add/Edit popup, same pattern as Expenses
   Report) that never mixes into crownExpenses_* — this page's totals only.
   ========================================================================== */

const STORAGE_PREFIX = "crownDailySales_";
const PRODUCT_EXPENSE_PREFIX = "crownProductExpenses_";
const PRODUCT_PREV_FUND_PREFIX = "crownProductPrevFund_";
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

    refreshReport();
});

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
   so Product line items exclude Loyalty Card sales, which are reported
   separately on Loyalty Card Sales Summary.
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

/* Voucher detection — ported from statistics.js's isVoucherProduct() so
   this page excludes voucher sales (a client buying a Service Voucher is
   not a physical product sale) the same way Statistics already does. */
function isVoucherProduct(item){
    const name = String(item?.name || "");

    return (
        item?.productKind === "Service Voucher" ||
        item?.virtualProduct === true ||
        name.startsWith("Voucher — ") ||
        name.startsWith("Voucher - ") ||
        normalizeName(name).startsWith("voucher")
    );
}

function getProductLineItems(row){
    const items = Array.isArray(row?.services) ? row.services : [];

    return items.filter(function(item){
        return (
            item?.itemType === "Product" &&
            item?.isConsumable !== true &&
            !isVipCardName(item?.name) &&
            !isVoucherProduct(item)
        );
    });
}

/* ==========================================================================
   Product Sales — read-only, sourced from Daily Income Report
   ========================================================================== */

function changeBranchMonth(){
    refreshReport();
}

function refreshReport(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;
    const tbody = document.getElementById("productSalesBody");

    currentSalesRows = [];
    currentSalesTotal = 0;

    if(!branch || !monthValue){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">No product sales recorded for this period.</td>
            </tr>
        `;

        document.getElementById("productSalesTotal").textContent = peso(0);
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
            console.error("Unable to load daily sales for product summary:", dateString, error);
            continue;
        }

        const rows = Array.isArray(data?.rows) ? data.rows : [];

        rows.forEach(function(row){
            /* Matches script.js/statistics.js/therapist-sales.js/
               payroll.js's convention: a row with no explicit settled
               field (legacy/imported data) is treated as settled, not
               excluded — this used to disagree with every other report
               reading the same data. */
            if(row?.settled === false) return;

            const productItems = getProductLineItems(row);

            productItems.forEach(function(item){
                const quantity = Math.max(1, Number(item?.quantity) || 1);
                const unitCost = Math.max(0, Number(item?.unitPrice) || 0);

                const total =
                    Number.isFinite(Number(item?.amount))
                        ? Number(item.amount)
                        : quantity * unitCost;

                currentSalesTotal += Math.max(0, total);

                currentSalesRows.push({
                    date: dateString,
                    client: row.client || "—",
                    product: item?.name || "—",
                    qty: quantity,
                    unitCost: unitCost,
                    total: Math.max(0, total)
                });
            });
        });
    }

    if(currentSalesRows.length === 0){
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="6">No product sales recorded for this period.</td>
            </tr>
        `;
    }else{
        tbody.innerHTML = currentSalesRows.map(function(entry){
            return `
                <tr>
                    <td class="text-start"><div class="date-text">${formatDateText(entry.date)}</div></td>
                    <td class="text-start">${escapeHtml(entry.client)}</td>
                    <td class="text-start">${escapeHtml(entry.product)}</td>
                    <td>${entry.qty}</td>
                    <td class="amount-cell">${peso(entry.unitCost)}</td>
                    <td class="amount-cell">${peso(entry.total)}</td>
                </tr>
            `;
        }).join("");
    }

    document.getElementById("productSalesTotal").textContent = peso(currentSalesTotal);

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

    return PRODUCT_PREV_FUND_PREFIX + branch + "_" + month;
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
   Product Sales Expenses — independent ledger, own storage key so it never
   mixes into the main Expenses Report (crownExpenses_*).
   ========================================================================== */

function getExpenseStorageKey(){
    const branch = getSelectedBranch() || "NoBranch";
    const month = document.getElementById("month").value || "NoMonth";

    return PRODUCT_EXPENSE_PREFIX + branch + "_" + month;
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
                console.error("Unable to load product sales expenses:", error);
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
    const tbody = document.getElementById("productExpenseBody");
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

    document.getElementById("productExpenseTotal").textContent = peso(total);

    updateSummary();
}

function updateSummary(){
    const expenseTotal = expenseEntries.reduce(function(sum, entry){
        return sum + (Number(entry.amount) || 0);
    }, 0);

    const net = currentPrevFund + currentSalesTotal - expenseTotal;

    document.getElementById("summaryPrevFund").textContent = peso(currentPrevFund);
    document.getElementById("summarySales").textContent = peso(currentSalesTotal);
    document.getElementById("summaryExpenses").textContent = peso(expenseTotal);
    document.getElementById("summaryNet").textContent = peso(net);

    document.getElementById("summaryNetRow").classList.toggle("negative-net", net < 0);
}

/* ==========================================================================
   Add / Edit Product Sales Expense Entry modal
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
        (entry ? "Edit " : "Add ") + "Product Sales Expense Entry";

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
   Export to PDF — Product Sales table, Product Sales Expenses ledger,
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
            doc.text("Product Sales Summary", 14, 18);

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
        doc.text("Product Sales", 14, cursorY);
        cursorY += 4;

        const salesBody = currentSalesRows.length
            ? currentSalesRows.map(function(entry){
                return [
                    formatDateText(entry.date),
                    entry.client || "—",
                    entry.product || "—",
                    String(entry.qty),
                    pesoPdf(entry.unitCost),
                    pesoPdf(entry.total)
                ];
            })
            : [[{
                content: "No product sales recorded for this period.",
                colSpan: 6,
                styles: { halign: "center", textColor: [140, 146, 158], fontStyle: "italic" }
            }]];

        doc.autoTable({
            startY: cursorY,
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            head: [["Date", "Clients", "Product", "Qty", "Unit Cost", "Total"]],
            body: salesBody,
            foot: currentSalesRows.length ? [["", "", "", "", "Grand Total", pesoPdf(currentSalesTotal)]] : undefined,
            theme: "grid",
            styles: {
                font: "helvetica",
                fontSize: 8.5,
                cellPadding: 2.8,
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
                3: { halign: "right" },
                4: { halign: "right" },
                5: { halign: "right" }
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
        doc.text("Product Sales Expenses", 14, cursorY);
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
                ["Product Sales", pesoPdf(currentSalesTotal)],
                ["Less: Product Sales Expenses", pesoPdf(expenseTotal)]
            ],
            foot: [["Product Sales Less Expenses", pesoPdf(net)]],
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
            `Crown Head Spa - Product Sales Summary - ${branch} - ${monthValue}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to export the product sales summary.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}
