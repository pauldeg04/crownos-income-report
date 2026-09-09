const STORAGE_PREFIX = "crownDailySales_";
const BRANCH_KEY = "crownSelectedBranch";

function getSelectedBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    document.getElementById("branchReadout").textContent = getSelectedBranch();
    generateReport();

    populateQuarterOptions();
    populateYearOptions();
    generateQuarterlyReport();
    generateYearlyReport();

    /* The sidebar branch/date toolbar dispatches this on every change.
       Monthly picks it up incidentally through #month's own change
       handler (see syncGlobalToolbarToPage in sidebar.js); Quarterly and
       Yearly have no such input for the toolbar to touch, so they need
       their own listener to stay in sync with the selected branch. */
    window.addEventListener("crownGlobalFiltersChanged", function(){
        generateQuarterlyReport();
        generateYearlyReport();
    });
});

function switchReportTab(tab){
    ["monthly", "quarterly", "yearly"].forEach(function(t){
        document.getElementById(t + "TabBtn").classList.toggle("active", t === tab);
        document.getElementById(t + "TabPane").classList.toggle("d-none", t !== tab);
    });
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
   garbled replacement character. Use "PHP" instead for anything
   drawn on the PDF (screen display keeps using peso() above). */
function pesoPdf(amount){
    return "PHP " + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

let currentReportDays = [];
let currentReportTotals = { cash: 0, gcash: 0, bank: 0, terminal: 0 };

function formatDisplayDate(dateString){
    return new Date(dateString + "T00:00:00").toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric",
        year: "numeric"
    });
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

    const grossAmount =
        Number.isFinite(Number(row?.grossAmount))
            ? Number(row.grossAmount)
            : legacyGross;

    const voucherValue =
        Number.isFinite(Number(row?.voucherValue))
            ? Math.max(0, Number(row.voucherValue))
            : 0;

    if(Number.isFinite(Number(row?.netAmount))){
        return Math.max(0, Number(row.netAmount));
    }

    return Math.max(0, grossAmount - voucherValue);
}

function getSalePayments(row){
    if(Array.isArray(row?.payments) && row.payments.length){
        return row.payments
            .filter(function(payment){
                return payment && payment.method && Number(payment.amount) > 0;
            })
            .map(function(payment){
                return {
                    method: payment.method,
                    amount: Math.max(0, Number(payment.amount) || 0)
                };
            });
    }

    const amount = getNetSaleAmount(row);

    if(amount <= 0){
        return [];
    }

    /* Legacy rows saved before the multi-payment feature existed can have
       payment === "Multiple" with no payments[] array behind it — that
       sentinel only means something when a real payments[] array is also
       present. Falls back to Cash so the amount isn't silently dropped
       from the report, matching getSalePayments() in script.js. */
    return [{
        method: (row?.payment && row.payment !== "Multiple") ? row.payment : "Cash",
        amount: amount
    }];
}

function toDateString(date){
    return date.getFullYear() + "-" +
        String(date.getMonth() + 1).padStart(2, "0") + "-" +
        String(date.getDate()).padStart(2, "0");
}

/* Reads and sums one day's saved sales for a branch — shared by the
   Monthly, Quarterly, and Yearly tabs so they all read the same
   localStorage rows the same way. */
function getDaySums(branch, dateString){
    const saved = localStorage.getItem(getStorageKey(branch, dateString));

    let cash = 0;
    let gcash = 0;
    let bank = 0;
    let terminal = 0;

    if(saved){
        try{
            const data = JSON.parse(saved);
            const rows = Array.isArray(data?.rows) ? data.rows : [];

            rows.forEach(function(row){
                /* Matches script.js/statistics.js/therapist-sales.js/
                   payroll.js's convention: a row with no explicit settled
                   field (legacy/imported data) is treated as settled, not
                   excluded. */
                if(row?.settled === false){
                    return;
                }

                getSalePayments(row).forEach(function(payment){
                    if(payment.method === "Cash"){
                        cash += payment.amount;
                    }

                    if(payment.method === "GCash"){
                        gcash += payment.amount;
                    }

                    if(payment.method === "Bank Transfer"){
                        bank += payment.amount;
                    }

                    if(payment.method === "Terminal"){
                        terminal += payment.amount;
                    }
                });
            });
        }catch(error){
            console.error("Unable to load sales data:", dateString, error);
        }
    }

    return { cash: cash, gcash: gcash, bank: bank, terminal: terminal };
}

/* ISO-8601 week number + the Monday-Sunday date range it covers. */
function getIsoWeekInfo(date){
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNumber + 3);

    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

    const week = 1 + Math.round((target - firstThursday) / (7 * 86400000));

    const monday = new Date(date);
    monday.setDate(monday.getDate() - ((date.getDay() + 6) % 7));

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return { week: week, weekYear: target.getUTCFullYear(), monday: monday, sunday: sunday };
}

function formatWeekRange(monday, sunday){
    const mondayLabel = monday.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
    const sundayLabel = sunday.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
    return mondayLabel + " – " + sundayLabel;
}

function generateReport(){
    const branch = getSelectedBranch();
    const monthValue = document.getElementById("month").value;
    const tbody = document.getElementById("monthlyBody");

    tbody.innerHTML = "";

    currentReportDays = [];

    let totalCash = 0;
    let totalGcash = 0;
    let totalBank = 0;
    let totalTerminal = 0;

    if(!branch || !monthValue){
        updateSummary(0, 0, 0, 0);
        return;
    }

    const [year, month] = monthValue.split("-").map(Number);
    const daysInMonth = getDaysInMonth(year, month);

    for(let day = 1; day <= daysInMonth; day++){
        const dayString = String(day).padStart(2, "0");
        const dateString =
            `${year}-${String(month).padStart(2, "0")}-${dayString}`;

        const daySums = getDaySums(branch, dateString);
        const cash = daySums.cash;
        const gcash = daySums.gcash;
        const bank = daySums.bank;
        const terminal = daySums.terminal;

        const dailyTotal =
            cash +
            gcash +
            bank +
            terminal;

        totalCash += cash;
        totalGcash += gcash;
        totalBank += bank;
        totalTerminal += terminal;

        const row = document.createElement("tr");

        row.classList.add(
            dailyTotal > 0
                ? "has-sales"
                : "no-sales"
        );

        row.innerHTML = `
            <td>${formatDisplayDate(dateString)}</td>
            <td>${peso(cash)}</td>
            <td>${peso(gcash)}</td>
            <td>${peso(bank)}</td>
            <td>${peso(terminal)}</td>
            <td><strong>${peso(dailyTotal)}</strong></td>
        `;

        tbody.appendChild(row);

        currentReportDays.push({
            date: dateString,
            cash: cash,
            gcash: gcash,
            bank: bank,
            terminal: terminal,
            total: dailyTotal
        });
    }

    updateSummary(
        totalCash,
        totalGcash,
        totalBank,
        totalTerminal
    );
}

function updateSummary(cash, gcash, bank, terminal){
    const grandTotal =
        cash +
        gcash +
        bank +
        terminal;

    currentReportTotals = {
        cash: cash,
        gcash: gcash,
        bank: bank,
        terminal: terminal
    };

    document.getElementById("sumCash").textContent =
        peso(cash);

    document.getElementById("sumGcash").textContent =
        peso(gcash);

    document.getElementById("sumBank").textContent =
        peso(bank);

    document.getElementById("sumTerminal").textContent =
        peso(terminal);

    document.getElementById("grandTotal").textContent =
        peso(grandTotal);
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function exportPDF(){
    const branch =
        getSelectedBranch();

    const monthValue =
        document.getElementById("month").value;

    if(!branch || !monthValue){
        alert("Please select branch and month first.");
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    generateReport();

    const button =
        document.getElementById("exportPdfBtn");

    if(button){
        button.disabled = true;
        button.textContent = "Generating PDF...";
    }

    try{
        const jsPDF =
            window.jspdf.jsPDF;

        const doc =
            new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4",
                compress: true
            });

        const pageWidth =
            doc.internal.pageSize.getWidth();

        const monthLabel =
            formatMonthLabel(monthValue);

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Monthly Income Summary", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branch, pageWidth - 14, 10, { align: "right" });
            doc.text(monthLabel, pageWidth - 14, 16, { align: "right" });
        }

        drawHeader();

        const grandTotal =
            currentReportTotals.cash +
            currentReportTotals.gcash +
            currentReportTotals.bank +
            currentReportTotals.terminal;

        const tableRows =
            currentReportDays.map(function(day){
                return [
                    formatDisplayDate(day.date),
                    pesoPdf(day.cash),
                    pesoPdf(day.gcash),
                    pesoPdf(day.bank),
                    pesoPdf(day.terminal),
                    pesoPdf(day.total)
                ];
            });

        doc.autoTable({
            startY: 32,
            head: [["Date", "Cash", "GCash", "Bank Transfer", "Terminal", "Total"]],
            body: tableRows,
            foot: [[
                "Grand Total",
                pesoPdf(currentReportTotals.cash),
                pesoPdf(currentReportTotals.gcash),
                pesoPdf(currentReportTotals.bank),
                pesoPdf(currentReportTotals.terminal),
                pesoPdf(grandTotal)
            ]],
            theme: "grid",
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 8,
                cellPadding: 2.5,
                valign: "middle",
                overflow: "linebreak",
                textColor: [32, 43, 60],
                lineColor: [216, 222, 232],
                lineWidth: 0.15
            },
            headStyles: {
                fillColor: [11, 24, 73],
                textColor: [255, 255, 255],
                fontStyle: "bold",
                halign: "center"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold",
                halign: "right"
            },
            alternateRowStyles: {
                fillColor: [250, 249, 244]
            },
            columnStyles: {
                0: { cellWidth: 30 },
                1: { cellWidth: 32, halign: "right" },
                2: { cellWidth: 32, halign: "right" },
                3: { cellWidth: 32, halign: "right" },
                4: { cellWidth: 32, halign: "right" },
                5: { cellWidth: 24, halign: "right" }
            },
            didDrawPage: function(data){
                if(data.pageNumber > 1){
                    drawHeader();
                }

                const pageCount =
                    doc.internal.getNumberOfPages();

                doc.setTextColor(120, 126, 138);
                doc.setFontSize(7.5);
                doc.text(
                    `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                    14,
                    doc.internal.pageSize.getHeight() - 8
                );

                doc.text(
                    `Page ${data.pageNumber} of ${pageCount}`,
                    pageWidth - 14,
                    doc.internal.pageSize.getHeight() - 8,
                    { align: "right" }
                );
            }
        });

        const summaryStartY =
            doc.lastAutoTable.finalY + 10;

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Summary", 14, summaryStartY);

        doc.autoTable({
            startY: summaryStartY + 4,
            head: [["Category", "Total Amount"]],
            body: [
                ["Cash", pesoPdf(currentReportTotals.cash)],
                ["GCash", pesoPdf(currentReportTotals.gcash)],
                ["Bank Transfer", pesoPdf(currentReportTotals.bank)],
                ["Terminal", pesoPdf(currentReportTotals.terminal)]
            ],
            foot: [["Grand Total", pesoPdf(grandTotal)]],
            theme: "grid",
            margin: { left: 14, right: 14, bottom: 16 },
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
                fillColor: [18, 77, 28],
                textColor: [255, 255, 255],
                fontStyle: "bold"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold"
            },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 50, halign: "right" }
            }
        });

        doc.save(
            `Crown Head Spa - Monthly Income Summary - ${branch} - ${monthValue}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to export the monthly report.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}

/* ==========================================================================
   Quarterly tab — same daily data as Monthly, grouped by ISO week instead
   of listed day by day.
   ========================================================================== */

let currentQuarterlyWeeks = [];
let currentQuarterlyTotals = { cash: 0, gcash: 0, bank: 0, terminal: 0 };
let currentQuarterLabel = "";

function populateQuarterOptions(){
    const select = document.getElementById("quarterInput");
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

    const options = [];

    for(let year = currentYear - 4; year <= currentYear + 1; year++){
        for(let quarter = 1; quarter <= 4; quarter++){
            options.push(`<option value="${year}-Q${quarter}">Q${quarter} ${year}</option>`);
        }
    }

    select.innerHTML = options.join("");
    select.value = `${currentYear}-Q${currentQuarter}`;
}

function generateQuarterlyReport(){
    const branch = getSelectedBranch();
    const quarterValue = document.getElementById("quarterInput").value;
    const tbody = document.getElementById("quarterlyBody");

    tbody.innerHTML = "";
    currentQuarterlyWeeks = [];
    currentQuarterLabel = quarterValue;

    if(!branch || !quarterValue){
        updateQuarterlySummary(0, 0, 0, 0);
        return;
    }

    const [yearString, quarterString] = quarterValue.split("-Q");
    const year = Number(yearString);
    const quarter = Number(quarterString);
    const startMonth = (quarter - 1) * 3;

    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, startMonth + 3, 0);

    const weekMap = new Map();

    let totalCash = 0;
    let totalGcash = 0;
    let totalBank = 0;
    let totalTerminal = 0;

    for(let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)){
        const dateString = toDateString(d);
        const daySums = getDaySums(branch, dateString);
        const weekInfo = getIsoWeekInfo(d);
        const key = weekInfo.weekYear + "-W" + weekInfo.week;

        if(!weekMap.has(key)){
            weekMap.set(key, {
                week: weekInfo.week,
                weekYear: weekInfo.weekYear,
                monday: weekInfo.monday,
                sunday: weekInfo.sunday,
                cash: 0, gcash: 0, bank: 0, terminal: 0
            });
        }

        const entry = weekMap.get(key);
        entry.cash += daySums.cash;
        entry.gcash += daySums.gcash;
        entry.bank += daySums.bank;
        entry.terminal += daySums.terminal;

        totalCash += daySums.cash;
        totalGcash += daySums.gcash;
        totalBank += daySums.bank;
        totalTerminal += daySums.terminal;
    }

    const weeks = Array.from(weekMap.values()).sort(function(a, b){
        return a.weekYear - b.weekYear || a.week - b.week;
    });

    weeks.forEach(function(w){
        const total = w.cash + w.gcash + w.bank + w.terminal;
        const label = "Week " + w.week;
        const range = formatWeekRange(w.monday, w.sunday);

        const row = document.createElement("tr");
        row.classList.add(total > 0 ? "has-sales" : "no-sales");
        row.innerHTML = `
            <td>${label}<br><small>${range}</small></td>
            <td>${peso(w.cash)}</td>
            <td>${peso(w.gcash)}</td>
            <td>${peso(w.bank)}</td>
            <td>${peso(w.terminal)}</td>
            <td><strong>${peso(total)}</strong></td>
        `;
        tbody.appendChild(row);

        currentQuarterlyWeeks.push({
            label: label,
            range: range,
            cash: w.cash, gcash: w.gcash, bank: w.bank, terminal: w.terminal,
            total: total
        });
    });

    updateQuarterlySummary(totalCash, totalGcash, totalBank, totalTerminal);
}

function updateQuarterlySummary(cash, gcash, bank, terminal){
    currentQuarterlyTotals = { cash: cash, gcash: gcash, bank: bank, terminal: terminal };

    document.getElementById("sumCashQ").textContent = peso(cash);
    document.getElementById("sumGcashQ").textContent = peso(gcash);
    document.getElementById("sumBankQ").textContent = peso(bank);
    document.getElementById("sumTerminalQ").textContent = peso(terminal);
    document.getElementById("grandTotalQ").textContent = peso(cash + gcash + bank + terminal);
}

function exportQuarterlyPDF(){
    const branch = getSelectedBranch();

    if(!branch || !currentQuarterLabel){
        alert("Please select branch and quarter first.");
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    generateQuarterlyReport();

    const button = document.getElementById("exportQuarterlyPdfBtn");

    if(button){
        button.disabled = true;
        button.textContent = "Generating PDF...";
    }

    try{
        const jsPDF = window.jspdf.jsPDF;
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
        const pageWidth = doc.internal.pageSize.getWidth();

        const [yearString, quarterString] = currentQuarterLabel.split("-Q");
        const quarterLabel = "Q" + quarterString + " " + yearString;

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Quarterly Income Summary", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branch, pageWidth - 14, 10, { align: "right" });
            doc.text(quarterLabel, pageWidth - 14, 16, { align: "right" });
        }

        drawHeader();

        const grandTotal =
            currentQuarterlyTotals.cash +
            currentQuarterlyTotals.gcash +
            currentQuarterlyTotals.bank +
            currentQuarterlyTotals.terminal;

        const tableRows = currentQuarterlyWeeks.map(function(w){
            return [
                w.label + " (" + w.range + ")",
                pesoPdf(w.cash),
                pesoPdf(w.gcash),
                pesoPdf(w.bank),
                pesoPdf(w.terminal),
                pesoPdf(w.total)
            ];
        });

        doc.autoTable({
            startY: 32,
            head: [["Week", "Cash", "GCash", "Bank Transfer", "Terminal", "Total"]],
            body: tableRows,
            foot: [[
                "Grand Total",
                pesoPdf(currentQuarterlyTotals.cash),
                pesoPdf(currentQuarterlyTotals.gcash),
                pesoPdf(currentQuarterlyTotals.bank),
                pesoPdf(currentQuarterlyTotals.terminal),
                pesoPdf(grandTotal)
            ]],
            theme: "grid",
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 8,
                cellPadding: 2.5,
                valign: "middle",
                overflow: "linebreak",
                textColor: [32, 43, 60],
                lineColor: [216, 222, 232],
                lineWidth: 0.15
            },
            headStyles: {
                fillColor: [11, 24, 73],
                textColor: [255, 255, 255],
                fontStyle: "bold",
                halign: "center"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold",
                halign: "right"
            },
            alternateRowStyles: {
                fillColor: [250, 249, 244]
            },
            columnStyles: {
                0: { cellWidth: 42 },
                1: { cellWidth: 30, halign: "right" },
                2: { cellWidth: 30, halign: "right" },
                3: { cellWidth: 30, halign: "right" },
                4: { cellWidth: 30, halign: "right" },
                5: { cellWidth: 20, halign: "right" }
            },
            didDrawPage: function(data){
                if(data.pageNumber > 1){
                    drawHeader();
                }

                const pageCount = doc.internal.getNumberOfPages();

                doc.setTextColor(120, 126, 138);
                doc.setFontSize(7.5);
                doc.text(
                    `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                    14,
                    doc.internal.pageSize.getHeight() - 8
                );

                doc.text(
                    `Page ${data.pageNumber} of ${pageCount}`,
                    pageWidth - 14,
                    doc.internal.pageSize.getHeight() - 8,
                    { align: "right" }
                );
            }
        });

        const summaryStartY = doc.lastAutoTable.finalY + 10;

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Summary", 14, summaryStartY);

        doc.autoTable({
            startY: summaryStartY + 4,
            head: [["Category", "Total Amount"]],
            body: [
                ["Cash", pesoPdf(currentQuarterlyTotals.cash)],
                ["GCash", pesoPdf(currentQuarterlyTotals.gcash)],
                ["Bank Transfer", pesoPdf(currentQuarterlyTotals.bank)],
                ["Terminal", pesoPdf(currentQuarterlyTotals.terminal)]
            ],
            foot: [["Grand Total", pesoPdf(grandTotal)]],
            theme: "grid",
            margin: { left: 14, right: 14, bottom: 16 },
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
                fillColor: [18, 77, 28],
                textColor: [255, 255, 255],
                fontStyle: "bold"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold"
            },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 50, halign: "right" }
            }
        });

        doc.save(`Crown Head Spa - Quarterly Income Summary - ${branch} - ${quarterLabel}.pdf`);
    }catch(error){
        console.error(error);
        alert("Unable to export the quarterly report.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}

/* ==========================================================================
   Yearly tab — same daily data as Monthly, grouped by calendar month
   instead of listed day by day.
   ========================================================================== */

let currentYearlyMonths = [];
let currentYearlyTotals = { cash: 0, gcash: 0, bank: 0, terminal: 0 };
let currentYearLabel = "";

function populateYearOptions(){
    const select = document.getElementById("yearInput");
    const currentYear = new Date().getFullYear();

    const options = [];

    for(let year = currentYear - 4; year <= currentYear + 1; year++){
        options.push(`<option value="${year}">${year}</option>`);
    }

    select.innerHTML = options.join("");
    select.value = String(currentYear);
}

function generateYearlyReport(){
    const branch = getSelectedBranch();
    const yearValue = document.getElementById("yearInput").value;
    const tbody = document.getElementById("yearlyBody");

    tbody.innerHTML = "";
    currentYearlyMonths = [];
    currentYearLabel = yearValue;

    if(!branch || !yearValue){
        updateYearlySummary(0, 0, 0, 0);
        return;
    }

    const year = Number(yearValue);

    let totalCash = 0;
    let totalGcash = 0;
    let totalBank = 0;
    let totalTerminal = 0;

    for(let month = 1; month <= 12; month++){
        const daysInMonth = getDaysInMonth(year, month);

        let cash = 0;
        let gcash = 0;
        let bank = 0;
        let terminal = 0;

        for(let day = 1; day <= daysInMonth; day++){
            const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const daySums = getDaySums(branch, dateString);

            cash += daySums.cash;
            gcash += daySums.gcash;
            bank += daySums.bank;
            terminal += daySums.terminal;
        }

        const total = cash + gcash + bank + terminal;
        const label = formatMonthLabel(`${year}-${String(month).padStart(2, "0")}`);

        const row = document.createElement("tr");
        row.classList.add(total > 0 ? "has-sales" : "no-sales");
        row.innerHTML = `
            <td>${label}</td>
            <td>${peso(cash)}</td>
            <td>${peso(gcash)}</td>
            <td>${peso(bank)}</td>
            <td>${peso(terminal)}</td>
            <td><strong>${peso(total)}</strong></td>
        `;
        tbody.appendChild(row);

        currentYearlyMonths.push({ label: label, cash: cash, gcash: gcash, bank: bank, terminal: terminal, total: total });

        totalCash += cash;
        totalGcash += gcash;
        totalBank += bank;
        totalTerminal += terminal;
    }

    updateYearlySummary(totalCash, totalGcash, totalBank, totalTerminal);
}

function updateYearlySummary(cash, gcash, bank, terminal){
    currentYearlyTotals = { cash: cash, gcash: gcash, bank: bank, terminal: terminal };

    document.getElementById("sumCashY").textContent = peso(cash);
    document.getElementById("sumGcashY").textContent = peso(gcash);
    document.getElementById("sumBankY").textContent = peso(bank);
    document.getElementById("sumTerminalY").textContent = peso(terminal);
    document.getElementById("grandTotalY").textContent = peso(cash + gcash + bank + terminal);
}

function exportYearlyPDF(){
    const branch = getSelectedBranch();

    if(!branch || !currentYearLabel){
        alert("Please select branch and year first.");
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    generateYearlyReport();

    const button = document.getElementById("exportYearlyPdfBtn");

    if(button){
        button.disabled = true;
        button.textContent = "Generating PDF...";
    }

    try{
        const jsPDF = window.jspdf.jsPDF;
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
        const pageWidth = doc.internal.pageSize.getWidth();

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Yearly Income Summary", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branch, pageWidth - 14, 10, { align: "right" });
            doc.text(currentYearLabel, pageWidth - 14, 16, { align: "right" });
        }

        drawHeader();

        const grandTotal =
            currentYearlyTotals.cash +
            currentYearlyTotals.gcash +
            currentYearlyTotals.bank +
            currentYearlyTotals.terminal;

        const tableRows = currentYearlyMonths.map(function(m){
            return [
                m.label,
                pesoPdf(m.cash),
                pesoPdf(m.gcash),
                pesoPdf(m.bank),
                pesoPdf(m.terminal),
                pesoPdf(m.total)
            ];
        });

        doc.autoTable({
            startY: 32,
            head: [["Month", "Cash", "GCash", "Bank Transfer", "Terminal", "Total"]],
            body: tableRows,
            foot: [[
                "Grand Total",
                pesoPdf(currentYearlyTotals.cash),
                pesoPdf(currentYearlyTotals.gcash),
                pesoPdf(currentYearlyTotals.bank),
                pesoPdf(currentYearlyTotals.terminal),
                pesoPdf(grandTotal)
            ]],
            theme: "grid",
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 8,
                cellPadding: 2.5,
                valign: "middle",
                overflow: "linebreak",
                textColor: [32, 43, 60],
                lineColor: [216, 222, 232],
                lineWidth: 0.15
            },
            headStyles: {
                fillColor: [11, 24, 73],
                textColor: [255, 255, 255],
                fontStyle: "bold",
                halign: "center"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold",
                halign: "right"
            },
            alternateRowStyles: {
                fillColor: [250, 249, 244]
            },
            columnStyles: {
                0: { cellWidth: 30 },
                1: { cellWidth: 32, halign: "right" },
                2: { cellWidth: 32, halign: "right" },
                3: { cellWidth: 32, halign: "right" },
                4: { cellWidth: 32, halign: "right" },
                5: { cellWidth: 24, halign: "right" }
            },
            didDrawPage: function(data){
                if(data.pageNumber > 1){
                    drawHeader();
                }

                const pageCount = doc.internal.getNumberOfPages();

                doc.setTextColor(120, 126, 138);
                doc.setFontSize(7.5);
                doc.text(
                    `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                    14,
                    doc.internal.pageSize.getHeight() - 8
                );

                doc.text(
                    `Page ${data.pageNumber} of ${pageCount}`,
                    pageWidth - 14,
                    doc.internal.pageSize.getHeight() - 8,
                    { align: "right" }
                );
            }
        });

        const summaryStartY = doc.lastAutoTable.finalY + 10;

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Summary", 14, summaryStartY);

        doc.autoTable({
            startY: summaryStartY + 4,
            head: [["Category", "Total Amount"]],
            body: [
                ["Cash", pesoPdf(currentYearlyTotals.cash)],
                ["GCash", pesoPdf(currentYearlyTotals.gcash)],
                ["Bank Transfer", pesoPdf(currentYearlyTotals.bank)],
                ["Terminal", pesoPdf(currentYearlyTotals.terminal)]
            ],
            foot: [["Grand Total", pesoPdf(grandTotal)]],
            theme: "grid",
            margin: { left: 14, right: 14, bottom: 16 },
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
                fillColor: [18, 77, 28],
                textColor: [255, 255, 255],
                fontStyle: "bold"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold"
            },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 50, halign: "right" }
            }
        });

        doc.save(`Crown Head Spa - Yearly Income Summary - ${branch} - ${currentYearLabel}.pdf`);
    }catch(error){
        console.error(error);
        alert("Unable to export the yearly report.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}
