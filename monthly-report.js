const STORAGE_PREFIX = "crownDailySales_";
const BRANCH_KEY = "crownSelectedBranch";

function getSelectedBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    document.getElementById("branchReadout").textContent = getSelectedBranch();
    generateReport();
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

        const saved =
            localStorage.getItem(
                getStorageKey(branch, dateString)
            );

        let cash = 0;
        let gcash = 0;
        let bank = 0;
        let terminal = 0;

        if(saved){
            try{
                const data = JSON.parse(saved);
                const rows = Array.isArray(data?.rows) ? data.rows : [];

                rows.forEach(function(row){
                    if(!row?.settled){
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
                console.error(
                    "Unable to load monthly sales data:",
                    dateString,
                    error
                );
            }
        }

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
