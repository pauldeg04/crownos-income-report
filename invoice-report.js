/* ==========================================================================
   Crown Head Spa — Invoice Report
   Lists every sale (any branch) where "Issue Invoice" was checked in the
   Daily Income Report. Read-only ledger + branded PDF export.
   ========================================================================== */

const INVOICE_SALES_PREFIX = "crownDailySales_";
const INVOICE_BRANCH_MASTER_KEY = "crownBranchMasterList";

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    loadBranchOptions();
    renderInvoiceReport();

    document.getElementById("invoiceMonth")
        .addEventListener("change", renderInvoiceReport);

    document.getElementById("invoiceBranch")
        .addEventListener("change", renderInvoiceReport);

    document.getElementById("exportInvoicePdfBtn")
        .addEventListener("click", exportInvoicePDF);

    window.addEventListener("crownCloudUpdate", function(event){
        const keys = event.detail?.keys || [];

        if(keys.some(function(key){
            return key.startsWith(INVOICE_SALES_PREFIX);
        })){
            renderInvoiceReport();
        }
    });

    /* #invoiceBranch is now hidden (branch is picked from the header
       toolbar instead), and isn't one of the ids sidebar.js's
       syncGlobalToolbarToPage() pushes values into directly — so this page
       has to follow the header itself, the same way cashflow.js does. */
    window.addEventListener("crownGlobalFiltersChanged", function(event){
        const branch = event.detail?.branch || "";
        const select = document.getElementById("invoiceBranch");

        if(branch && Array.from(select.options).some(function(option){
            return option.value === branch;
        })){
            select.value = branch;
            renderInvoiceReport();
        }
    });
});

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

function setCurrentMonth(){
    const input =
        document.getElementById("invoiceMonth");

    const today = new Date();

    input.value = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function loadBranchOptions(){
    const select =
        document.getElementById("invoiceBranch");

    try{
        const raw =
            localStorage.getItem(INVOICE_BRANCH_MASTER_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        const names =
            (Array.isArray(parsed) ? parsed : [])
                .map(function(branch){
                    return typeof branch === "string"
                        ? branch
                        : branch?.name;
                })
                .filter(Boolean);

        const savedBranch =
            localStorage.getItem("crownSelectedBranch") || "";

        select.innerHTML =
            names.map(function(name){
                return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            }).join("");

        if(names.includes(savedBranch)){
            select.value = savedBranch;
        }
    }catch(error){
        console.error("Unable to load branches:", error);
    }
}

function formatDisplayDate(dateString){
    if(!dateString){
        return "—";
    }

    return new Date(dateString + "T00:00:00").toLocaleDateString("en-PH", {
        month: "short",
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

function getNetSaleAmount(row){
    if(Number.isFinite(Number(row?.netAmount))){
        return Math.max(0, Number(row.netAmount));
    }

    const gross =
        Number.isFinite(Number(row?.grossAmount))
            ? Number(row.grossAmount)
            : (Array.isArray(row?.services)
                ? row.services.reduce(function(sum, item){
                    return sum + (Number(item?.amount) || 0);
                }, 0)
                : 0);

    const voucher =
        Math.max(0, Number(row?.voucherValue) || 0);

    return Math.max(0, gross - voucher);
}

/* Scans every crownDailySales_<branch>_<date> key for the selected
   month (and branch, if filtered), returning invoiced rows sorted by
   date then client name. */
function collectInvoicedTransactions(month, branchFilter){
    const results = [];

    if(!month || !branchFilter){
        return results;
    }

    for(let index = 0; index < localStorage.length; index++){
        const key =
            localStorage.key(index);

        if(!key || !key.startsWith(INVOICE_SALES_PREFIX)){
            continue;
        }

        const date =
            key.slice(-10);

        if(!date.startsWith(month)){
            continue;
        }

        let record;

        try{
            record =
                JSON.parse(localStorage.getItem(key));
        }catch(error){
            continue;
        }

        const branch =
            record?.branch || "";

        if(branchFilter && branch !== branchFilter){
            continue;
        }

        const rows =
            Array.isArray(record?.rows)
                ? record.rows
                : [];

        rows.forEach(function(sale){
            if(!sale?.settled){
                return;
            }

            if(sale?.issueInvoice !== true){
                return;
            }

            results.push({
                date: record?.date || date,
                client: sale?.client || "—",
                tin: sale?.tinNumber || "",
                invoiceNumber: sale?.invoiceNumber || "",
                amount: getNetSaleAmount(sale),
                branch: branch
            });
        });
    }

    return results.sort(function(a, b){
        if(a.date !== b.date){
            return a.date.localeCompare(b.date);
        }

        return a.client.localeCompare(b.client);
    });
}

function getSelectedPeriod(){
    return {
        month: document.getElementById("invoiceMonth").value,
        branch: document.getElementById("invoiceBranch").value
    };
}

function renderInvoiceReport(){
    const period =
        getSelectedPeriod();

    const entries =
        collectInvoicedTransactions(period.month, period.branch);

    document.getElementById("invoiceSubtitle").textContent =
        formatMonthLabel(period.month) +
        (period.branch ? " · " + period.branch : "");

    const tbody =
        document.getElementById("invoiceBody");

    tbody.innerHTML = "";

    let grandTotal = 0;

    entries.forEach(function(entry){
        grandTotal += entry.amount;

        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHtml(formatDisplayDate(entry.date))}</td>

            <td class="invoice-particulars-cell">${escapeHtml(entry.client)}</td>

            <td>${entry.invoiceNumber ? escapeHtml(entry.invoiceNumber) : "—"}</td>

            <td>${entry.tin ? escapeHtml(entry.tin) : "—"}</td>

            <td class="invoice-amount-cell">${peso(entry.amount)}</td>
        `;

        tbody.appendChild(row);
    });

    document.getElementById("invoiceFooterTotal").textContent =
        peso(grandTotal);

    document.getElementById("invoiceEmptyState")
        .classList.toggle("d-none", entries.length > 0);
}

function exportInvoicePDF(){
    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    const period =
        getSelectedPeriod();

    if(!period.month){
        alert("Please select a month first.");
        return;
    }

    const entries =
        collectInvoicedTransactions(period.month, period.branch);

    const button =
        document.getElementById("exportInvoicePdfBtn");

    button.disabled = true;
    button.textContent = "Generating PDF...";

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

        const branchLabel =
            period.branch || "";

        const monthLabel =
            formatMonthLabel(period.month);

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Sales Invoice Summary", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branchLabel, pageWidth - 14, 10, { align: "right" });
            doc.text(monthLabel, pageWidth - 14, 16, { align: "right" });
        }

        drawHeader();

        const grandTotal =
            entries.reduce(function(sum, entry){
                return sum + entry.amount;
            }, 0);

        const tableRows =
            entries.map(function(entry){
                return [
                    formatDisplayDate(entry.date),
                    entry.client,
                    entry.invoiceNumber || "—",
                    entry.tin || "—",
                    pesoPdf(entry.amount)
                ];
            });

        doc.autoTable({
            startY: 32,
            head: [["Date", "Particulars", "Invoice Number", "TIN Number", "Amount"]],
            body: tableRows,
            foot: [["", "", "", "Total", pesoPdf(grandTotal)]],
            theme: "grid",
            margin: { top: 30, left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 9,
                cellPadding: 3,
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
                0: { cellWidth: 26 },
                1: { cellWidth: 52 },
                2: { cellWidth: 34, halign: "center" },
                3: { cellWidth: 30, halign: "center" },
                4: { cellWidth: 30, halign: "right" }
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

        if(entries.length === 0){
            doc.setTextColor(91, 102, 119);
            doc.setFontSize(11);
            doc.text("No invoiced transactions found for this period.", 14, 40);
        }

        doc.save(
            `Crown Head Spa - Sales Invoice Summary - ${branchLabel} - ${period.month}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to generate the Invoice Report PDF.");
    }finally{
        button.disabled = false;
        button.textContent = "Export as PDF";
    }
}
