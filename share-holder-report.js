const STORAGE_PREFIX = "crownDailySales_";
const EXPENSE_PREFIX = "crownExpenses_";
const BRANCH_KEY = "crownSelectedBranch";
const SHAREHOLDERS_KEY = "crownShareholders";
const NOTES_KEY = "crownShareholderNotes";

const EXPENSE_CATEGORY_KEYS = [
    "operation",
    "salary",
    "utilities",
    "installments",
    "gov",
    "marketing"
];

function getSelectedBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

let shareholders = [];

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    document.getElementById("branchReadout").textContent = getSelectedBranch();
    document.getElementById("shareholderBranchLabel").textContent = getSelectedBranch() || "—";
    loadShareholders();
    renderShareholderEditor();
    refreshReport();
});

function pesoPdf(amount){
    const value = Number(amount) || 0;
    const formatted = Math.abs(value).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return (value < 0 ? "-PHP " : "PHP ") + formatted;
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
    const value = Number(amount) || 0;
    const formatted = Math.abs(value).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return (value < 0 ? "-₱" : "₱") + formatted;
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatMonthLabel(monthValue){
    if(!monthValue){
        return "";
    }

    return new Date(monthValue + "-01T00:00:00").toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric"
    });
}

function getStorageKey(branch, date){
    return STORAGE_PREFIX + branch + "_" + date;
}

function getDaysInMonth(year, month){
    return new Date(year, month, 0).getDate();
}

/* ==========================================================================
   Shareholders — kept per branch, own localStorage key so List of Branches
   (and its rename/migration logic) doesn't need to change. Synced like every
   other crown*-prefixed key via firebase-sync.js's blanket setItem patch.
   ========================================================================== */

function createId(){
    return Date.now().toString() + Math.random().toString(16).slice(2);
}

function loadAllShareholders(){
    try{
        const raw = localStorage.getItem(SHAREHOLDERS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
    }catch(error){
        console.error("Unable to load shareholders:", error);
        return {};
    }
}

function saveAllShareholders(all){
    localStorage.setItem(SHAREHOLDERS_KEY, JSON.stringify(all));
}

function loadShareholders(){
    const branch = getSelectedBranch();
    const all = loadAllShareholders();

    shareholders = Array.isArray(all[branch]) ? all[branch] : [];
}

function persistShareholders(){
    const branch = getSelectedBranch();

    if(!branch){
        return;
    }

    const all = loadAllShareholders();
    all[branch] = shareholders;
    saveAllShareholders(all);
}

function renderShareholderEditor(){
    const tbody = document.getElementById("shareholderEditBody");
    tbody.innerHTML = "";

    shareholders.forEach(function(holder){
        const row = document.createElement("tr");
        row.dataset.id = holder.id;

        row.innerHTML = `
            <td>
                <input type="text" class="form-control shareholder-name-input" placeholder="Share holder name" value="${escapeHtml(holder.name || "")}">
            </td>
            <td>
                <div class="input-group percentage-input">
                    <input type="number" class="form-control shareholder-percentage-input" placeholder="0" min="0" max="100" step="0.01" value="${holder.percentage ?? ""}">
                    <span class="input-group-text">%</span>
                </div>
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-danger">Delete</button>
            </td>
        `;

        row.querySelector(".shareholder-name-input").addEventListener("input", function(){
            holder.name = this.value;
            persistShareholders();
            renderDividendReport();
        });

        row.querySelector(".shareholder-percentage-input").addEventListener("input", function(){
            holder.percentage = this.value === "" ? "" : Number(this.value);
            persistShareholders();
            updatePercentageCheck();
            renderDividendReport();
        });

        row.querySelector(".btn-danger").addEventListener("click", function(){
            if(!confirm(`Remove "${holder.name || "this share holder"}" from ${getSelectedBranch()}?`)){
                return;
            }

            shareholders = shareholders.filter(function(item){
                return item.id !== holder.id;
            });

            persistShareholders();
            renderShareholderEditor();
            renderDividendReport();
        });

        tbody.appendChild(row);
    });

    updatePercentageCheck();
}

function addShareholderRow(){
    if(!getSelectedBranch()){
        alert("Please select a branch first.");
        return;
    }

    shareholders.push({ id: createId(), name: "", percentage: "" });
    persistShareholders();
    renderShareholderEditor();
    renderDividendReport();

    const inputs = document.querySelectorAll("#shareholderEditBody .shareholder-name-input");
    const lastInput = inputs[inputs.length - 1];

    if(lastInput){
        lastInput.focus();
    }
}

function updatePercentageCheck(){
    const totalPercent = shareholders.reduce(function(total, holder){
        return total + (Number(holder.percentage) || 0);
    }, 0);

    const check = document.getElementById("percentageCheck");

    if(shareholders.length === 0){
        check.textContent = "";
        check.className = "percentage-check";
        return;
    }

    check.textContent = `Total share: ${totalPercent}%`;
    check.className = "percentage-check " + (Math.abs(totalPercent - 100) < 0.01 ? "percentage-ok" : "percentage-warn");
}

/* ==========================================================================
   Sales categorization — ported from script.js's getSaleCategoryBreakdown()
   so Loyalty Card / Product totals match what Daily Income already shows.
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

function getSaleCategoryBreakdown(sale){
    const items = Array.isArray(sale?.services) ? sale.services : [];
    const gross = { services: 0, vipCards: 0, products: 0 };

    items.forEach(function(item){
        const amount = Math.max(0, Number(item?.amount) || 0);

        if(isVipCardName(item?.name)){
            gross.vipCards += amount;
        }else if(item?.itemType === "Service"){
            gross.services += amount;
        }else{
            gross.products += amount;
        }
    });

    const grossTotal = gross.services + gross.vipCards + gross.products;

    const voucherValue = Math.min(
        grossTotal,
        Math.max(0, Number(sale?.voucherValue) || 0)
    );

    const net = { services: gross.services, vipCards: gross.vipCards, products: gross.products };

    if(voucherValue <= 0 || grossTotal <= 0){
        return net;
    }

    const targeted = { services: 0, vipCards: 0, products: 0 };

    (Array.isArray(sale?.vouchers) ? sale.vouchers : []).forEach(function(voucher){
        const value = Math.max(0, Number(voucher?.value) || 0);

        if(!value){
            return;
        }

        if(
            voucher?.isExecutive === true ||
            voucher?.itemType === "Executive" ||
            voucher?.itemType === "Service"
        ){
            targeted.services += value;
        }else if(voucher?.itemType === "Product"){
            if(isVipCardName(voucher?.name)){
                targeted.vipCards += value;
            }else{
                targeted.products += value;
            }
        }
    });

    let directlyDeducted = 0;

    ["services", "vipCards", "products"].forEach(function(key){
        const take = Math.min(net[key], targeted[key]);
        net[key] -= take;
        directlyDeducted += take;
    });

    const leftover = Math.min(
        grossTotal - directlyDeducted,
        voucherValue - directlyDeducted
    );

    if(leftover > 0){
        const remainingGross = net.services + net.vipCards + net.products;

        if(remainingGross > 0){
            const ratio = Math.max(0, remainingGross - leftover) / remainingGross;

            net.services *= ratio;
            net.vipCards *= ratio;
            net.products *= ratio;
        }
    }

    return net;
}

function getLegacyGrossAmount(row){
    if(!Array.isArray(row?.services)){
        return 0;
    }

    return row.services.reduce(function(total, item){
        return total + (parseFloat(item?.amount) || 0);
    }, 0);
}

function getNetSaleAmount(row){
    const legacyGross = getLegacyGrossAmount(row);

    const grossAmount = Number.isFinite(Number(row?.grossAmount))
        ? Number(row.grossAmount)
        : legacyGross;

    const voucherValue = Number.isFinite(Number(row?.voucherValue))
        ? Math.max(0, Number(row.voucherValue))
        : 0;

    if(Number.isFinite(Number(row?.netAmount))){
        return Math.max(0, Number(row.netAmount));
    }

    return Math.max(0, grossAmount - voucherValue);
}

/* ==========================================================================
   Monthly Summary — Overhead Expenses / Loyalty Card Sales / Product Sales /
   Monthly Net, plus the Dividend Report split across shareholders.
   ========================================================================== */

let currentMonthlyNet = 0;

function getOverheadExpenses(branch, monthValue){
    const saved = localStorage.getItem(EXPENSE_PREFIX + branch + "_" + monthValue);

    if(!saved){
        return 0;
    }

    let data;

    try{
        data = JSON.parse(saved);
    }catch(error){
        console.error("Unable to load expenses for summary:", error);
        return 0;
    }

    return EXPENSE_CATEGORY_KEYS.reduce(function(total, key){
        const rows = Array.isArray(data?.[key]) ? data[key] : [];

        return total + rows.reduce(function(subtotal, row){
            return subtotal + (parseFloat(row?.amount) || 0);
        }, 0);
    }, 0);
}

function getIncomeTotals(branch, monthValue){
    const [year, month] = monthValue.split("-").map(Number);
    const daysInMonth = getDaysInMonth(year, month);

    let grandTotal = 0;
    let loyaltyCardSales = 0;
    let productSales = 0;

    for(let day = 1; day <= daysInMonth; day++){
        const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const saved = localStorage.getItem(getStorageKey(branch, dateString));

        if(!saved){
            continue;
        }

        try{
            const data = JSON.parse(saved);
            const rows = Array.isArray(data?.rows) ? data.rows : [];

            rows.forEach(function(row){
                if(!row?.settled){
                    return;
                }

                grandTotal += getNetSaleAmount(row);

                const breakdown = getSaleCategoryBreakdown(row);
                loyaltyCardSales += breakdown.vipCards;
                productSales += breakdown.products;
            });
        }catch(error){
            console.error("Unable to load daily sales for summary:", dateString, error);
        }
    }

    return { grandTotal, loyaltyCardSales, productSales };
}

let currentGrandTotal = 0;
let currentOverhead = 0;
let currentLoyalty = 0;
let currentProduct = 0;

function refreshReport(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;
    document.getElementById("shareholderBranchLabel").textContent = branch || "—";
    loadShareholders();
    renderShareholderEditor();
    loadNotes();
    renderNotes();

    const dividendTitle = document.getElementById("dividendTitle");

    if(!branch || !monthValue){
        currentMonthlyNet = 0;
        currentGrandTotal = 0;
        currentOverhead = 0;
        currentLoyalty = 0;
        currentProduct = 0;
        dividendTitle.textContent = "Dividend Report";
        renderMonthlySummary(0, 0, 0, 0, 0);
        renderDividendReport();
        return;
    }

    document.getElementById("monthlySummaryTitle").textContent =
        `${branch} — ${formatMonthLabel(monthValue)}`;

    dividendTitle.textContent =
        `Month of ${formatMonthLabel(monthValue)} Dividend Report`;

    const overhead = getOverheadExpenses(branch, monthValue);
    const { grandTotal, loyaltyCardSales, productSales } = getIncomeTotals(branch, monthValue);

    const monthlyNet = grandTotal - overhead - productSales - loyaltyCardSales;

    currentMonthlyNet = monthlyNet;
    currentGrandTotal = grandTotal;
    currentOverhead = overhead;
    currentLoyalty = loyaltyCardSales;
    currentProduct = productSales;

    renderMonthlySummary(grandTotal, overhead, loyaltyCardSales, productSales, monthlyNet);
    renderDividendReport();
}

function renderMonthlySummary(grand, overhead, loyalty, product, net){
    document.getElementById("sumGrand").textContent = peso(grand);
    document.getElementById("sumOverhead").textContent = peso(overhead);
    document.getElementById("sumLoyalty").textContent = peso(loyalty);
    document.getElementById("sumProduct").textContent = peso(product);

    const netCell = document.getElementById("sumNet");
    netCell.textContent = peso(net);

    document.getElementById("monthlyNetRow").classList.toggle("negative-net", net < 0);
}

function renderDividendReport(){
    const tbody = document.getElementById("dividendBody");
    tbody.innerHTML = "";

    let totalPercent = 0;
    let totalAmount = 0;

    shareholders.forEach(function(holder){
        const percentage = Number(holder.percentage) || 0;
        const amount = currentMonthlyNet * (percentage / 100);

        totalPercent += percentage;
        totalAmount += amount;

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHtml(holder.name || "—")}</td>
            <td>${percentage}%</td>
            <td>${peso(amount)}</td>
        `;

        tbody.appendChild(row);
    });

    if(shareholders.length === 0){
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center text-muted">
                    No shareholders set up for this branch yet.
                </td>
            </tr>
        `;
    }

    document.getElementById("dividendTotalPercent").textContent = `${totalPercent}%`;
    document.getElementById("dividendTotalAmount").textContent = peso(totalAmount);
}

/* ==========================================================================
   Notes — free-text remarks per branch+month (e.g. "Savings fund from
   Loyalty Card Sales will be used for Credit card..."), numbered list,
   one entry added at a time via "+ Add Note".
   ========================================================================== */

let notes = [];

function getNotesKey(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;

    return branch + "_" + monthValue;
}

function loadAllNotes(){
    try{
        const raw = localStorage.getItem(NOTES_KEY);
        const parsed = raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
    }catch(error){
        console.error("Unable to load notes:", error);
        return {};
    }
}

function saveAllNotes(all){
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
}

function loadNotes(){
    const all = loadAllNotes();
    const key = getNotesKey();

    notes = Array.isArray(all[key]) ? all[key] : [];
}

function persistNotes(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;

    if(!branch || !monthValue){
        return;
    }

    const all = loadAllNotes();
    all[getNotesKey()] = notes;
    saveAllNotes(all);
}

function renderNotes(){
    const list = document.getElementById("notesList");
    const emptyState = document.getElementById("notesEmptyState");

    list.innerHTML = "";

    notes.forEach(function(note, index){
        const row = document.createElement("div");
        row.className = "note-row";

        row.innerHTML = `
            <div class="note-number">${index + 1}.</div>
            <textarea class="form-control" rows="2" placeholder="Note">${escapeHtml(note.text || "")}</textarea>
            <button type="button" class="btn btn-sm btn-danger">Delete</button>
        `;

        row.querySelector("textarea").addEventListener("input", function(){
            note.text = this.value;
            persistNotes();
        });

        row.querySelector(".btn-danger").addEventListener("click", function(){
            notes = notes.filter(function(item){
                return item.id !== note.id;
            });

            persistNotes();
            renderNotes();
        });

        list.appendChild(row);
    });

    emptyState.style.display = notes.length === 0 ? "block" : "none";
}

function addNoteRow(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;

    if(!branch || !monthValue){
        alert("Please select branch and month first.");
        return;
    }

    notes.push({ id: createId(), text: "" });
    persistNotes();
    renderNotes();

    const textareas = document.querySelectorAll("#notesList textarea");
    const lastTextarea = textareas[textareas.length - 1];

    if(lastTextarea){
        lastTextarea.focus();
    }
}

/* ==========================================================================
   Export to PDF — branded jsPDF+autoTable export matching the color-coded
   Monthly Summary, the Dividend Report table, and the Notes section.
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
        const monthLabel = formatMonthLabel(monthValue);

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Share Holder Summary Report", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branch, pageWidth - 14, 10, { align: "right" });
            doc.text(monthLabel, pageWidth - 14, 16, { align: "right" });
        }

        drawHeader();

        function drawFooter(pageNumber, pageCount){
            doc.setTextColor(120, 126, 138);
            doc.setFontSize(7.5);
            doc.text(
                `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                14,
                doc.internal.pageSize.getHeight() - 8
            );

            doc.text(
                `Page ${pageNumber} of ${pageCount}`,
                pageWidth - 14,
                doc.internal.pageSize.getHeight() - 8,
                { align: "right" }
            );
        }

        const netIsNegative = currentMonthlyNet < 0;

        const summaryRows = [
            ["Daily Net", pesoPdf(currentGrandTotal), [23, 52, 93], false],
            ["Less: Overhead Expenses", pesoPdf(currentOverhead), [220, 53, 69], false],
            ["Less: Loyalty Card Sale", pesoPdf(currentLoyalty), [198, 161, 91], false],
            ["Less: Product Sale", pesoPdf(currentProduct), [100, 116, 139], false],
            ["Monthly Net", pesoPdf(currentMonthlyNet), netIsNegative ? [220, 53, 69] : [23, 52, 93], true]
        ];

        doc.autoTable({
            startY: 32,
            head: [[`${branch} — ${monthLabel}`, ""]],
            body: summaryRows.map(function(row){ return [row[0], row[1]]; }),
            theme: "plain",
            margin: { left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 10.5,
                cellPadding: { top: 4, bottom: 4, left: 2, right: 2 },
                valign: "middle",
                textColor: [23, 32, 51],
                lineColor: [223, 229, 237],
                lineWidth: { bottom: 0.15 }
            },
            headStyles: {
                fillColor: [11, 24, 73],
                textColor: [255, 255, 255],
                fontStyle: "bold",
                halign: "left",
                lineWidth: 0
            },
            columnStyles: {
                0: { cellWidth: 110, fontStyle: "bold" },
                1: { cellWidth: 66, halign: "right", fontStyle: "bold" }
            },
            didParseCell: function(data){
                if(data.section !== "body"){
                    return;
                }

                const row = summaryRows[data.row.index];

                if(data.column.index === 1){
                    data.cell.styles.textColor = row[2];
                }

                if(row[3]){
                    data.cell.styles.fontSize = 13;
                    data.cell.styles.lineWidth = { top: 0.5, bottom: 0.15 };
                    data.cell.styles.lineColor = [198, 161, 91];
                }
            }
        });

        const dividendStartY = doc.lastAutoTable.finalY + 10;

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(`Month of ${monthLabel} Dividend Report`, pageWidth / 2, dividendStartY, { align: "center" });

        const dividendRows = shareholders.map(function(holder){
            const percentage = Number(holder.percentage) || 0;
            const amount = currentMonthlyNet * (percentage / 100);

            return [holder.name || "—", `${percentage}%`, pesoPdf(amount)];
        });

        const totalPercent = shareholders.reduce(function(total, holder){
            return total + (Number(holder.percentage) || 0);
        }, 0);

        doc.autoTable({
            startY: dividendStartY + 4,
            head: [["Shareholders", "%", "Amount"]],
            body: dividendRows.length ? dividendRows : [["No shareholders set up for this branch yet.", "", ""]],
            foot: [["Total", `${totalPercent}%`, pesoPdf(currentMonthlyNet)]],
            theme: "grid",
            margin: { left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 10,
                cellPadding: 3,
                valign: "middle",
                halign: "center",
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
                fontSize: 11,
                lineColor: [198, 161, 91],
                lineWidth: { top: 0.5, bottom: 0.15, left: 0.15, right: 0.15 }
            },
            columnStyles: {
                0: { halign: "left" }
            }
        });

        let noteStartY = doc.lastAutoTable.finalY + 12;
        const pageHeight = doc.internal.pageSize.getHeight();

        if(notes.length > 0){
            if(noteStartY > pageHeight - 30){
                doc.addPage();
                drawHeader();
                noteStartY = 34;
            }

            doc.setTextColor(11, 24, 73);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text("Note:", 14, noteStartY);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            doc.setTextColor(32, 43, 60);

            let cursorY = noteStartY + 7;

            notes.forEach(function(note, index){
                if(!note.text){
                    return;
                }

                const lines = doc.splitTextToSize(`${index + 1}. ${note.text}`, pageWidth - 28);

                if(cursorY + (lines.length * 5) > pageHeight - 16){
                    doc.addPage();
                    drawHeader();
                    cursorY = 34;
                }

                doc.text(lines, 14, cursorY);
                cursorY += lines.length * 5 + 2;
            });
        }

        const pageCount = doc.internal.getNumberOfPages();

        for(let pageNumber = 1; pageNumber <= pageCount; pageNumber++){
            doc.setPage(pageNumber);
            drawFooter(pageNumber, pageCount);
        }

        doc.save(
            `Crown Head Spa - Share Holder Summary Report - ${branch} - ${monthValue}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to export the share holder summary report.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}
