/* ==========================================================================
   Crown Head Spa — Expenses Report
   Category ledgers with Add Particular / Edit via popup, plus a branded
   jsPDF+autoTable export.
   ========================================================================== */

const EXPENSE_PREFIX = "crownExpenses_";
const BRANCH_KEY = "crownSelectedBranch";

function getSelectedBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

const expenseTables = [
    {
        key: "operation",
        title: "Operation Expenses",
        headerClass: "operation-header",
        columns: ["Date", "Category", "Particular", "Amount", "Mode of Payment", "Remarks"]
    },
    {
        key: "salary",
        title: "Salary",
        headerClass: "salary-header",
        columns: ["Date", "Particular", "Amount", "Remarks"]
    },
    {
        key: "utilities",
        title: "Utilities / Monthly Dues",
        headerClass: "utilities-header",
        columns: ["Date", "Particular", "Amount", "Remarks"]
    },
    {
        key: "installments",
        title: "Installments",
        headerClass: "installments-header",
        columns: ["Date", "Particular", "Amount", "Remarks"]
    },
    {
        key: "gov",
        title: "Accounting / Government Dues",
        headerClass: "gov-header",
        columns: ["Date", "Particular", "Amount", "Remarks"]
    },
    {
        key: "marketing",
        title: "Marketing",
        headerClass: "marketing-header",
        columns: ["Date", "Particular", "Amount", "Remarks"]
    }
];

let expenseData = {};
let activeModal = { tableKey: null, entryId: null };

document.addEventListener("DOMContentLoaded", function(){
    setCurrentMonth();
    document.getElementById("branchReadout").textContent = getSelectedBranch();
    renderTables();
    loadExpenses();
    wireModalEvents();

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
    loadExpenses();
}

function renderTables(){
    let container = document.getElementById("tablesContainer");
    container.innerHTML = "";

    expenseTables.forEach(table => {
        let card = document.createElement("div");
        card.className = "card shadow-sm border-0 mb-4 expense-card";

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

        container.appendChild(card);
    });
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
        let dateCell = `<td class="text-start"><div class="date-text">${entry.date ? formatDateText(entry.date) : "—"}</div></td>`;

        if(tableKey === "operation"){
            return `
                <tr>
                    ${dateCell}
                    <td>${escapeHtml(entry.category) || "—"}</td>
                    <td class="text-start">${escapeHtml(entry.particular)}</td>
                    <td class="amount-cell">${peso(entry.amount)}</td>
                    <td>${escapeHtml(entry.payment) || "—"}</td>
                    <td class="text-start">${escapeHtml(entry.remarks) || "—"}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openExpenseModal('operation','${entry.id}')">✎ Edit</button>
                    </td>
                </tr>
            `;
        }

        return `
            <tr>
                ${dateCell}
                <td class="text-start">${escapeHtml(entry.particular)}</td>
                <td class="amount-cell">${peso(entry.amount)}</td>
                <td class="text-start">${escapeHtml(entry.remarks) || "—"}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-outline-primary edit-btn" onclick="openExpenseModal('${tableKey}','${entry.id}')">✎ Edit</button>
                </td>
            </tr>
        `;
    }).join("");
}

function renderAllTables(){
    expenseTables.forEach(table => renderTableBody(table.key));
    updateTotals();
}

function updateTotals(){
    let totals = {};

    expenseTables.forEach(table => {
        let total = (expenseData[table.key] || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
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
}

/* ==========================================================================
   Add / Edit Expense Entry modal
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
    let isOperation = tableKey === "operation";
    let entry = entryId ? (expenseData[tableKey] || []).find(e => e.id === entryId) : null;

    activeModal = { tableKey, entryId: entry ? entryId : null };

    document.getElementById("expenseModalCategoryWrapper").classList.toggle("d-none", !isOperation);
    document.getElementById("expenseModalPaymentWrapper").classList.toggle("d-none", !isOperation);

    document.getElementById("expenseModalTitle").textContent =
        (entry ? "Edit " : "Add ") + table.title + " Entry";

    document.getElementById("expenseModalDate").value = entry?.date || "";
    document.getElementById("expenseModalCategory").value = entry?.category || "";
    document.getElementById("expenseModalParticular").value = entry?.particular || "";
    document.getElementById("expenseModalAmount").value = entry?.amount || "";
    document.getElementById("expenseModalPayment").value = entry?.payment || "";
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

    let isOperation = tableKey === "operation";
    let date = document.getElementById("expenseModalDate").value;
    let category = document.getElementById("expenseModalCategory").value;
    let particular = document.getElementById("expenseModalParticular").value.trim();
    let amount = parseFloat(document.getElementById("expenseModalAmount").value) || 0;
    let payment = document.getElementById("expenseModalPayment").value;
    let remarks = document.getElementById("expenseModalRemarks").value.trim();

    if(!particular){
        alert("Please enter a Particular.");
        return;
    }

    if(amount <= 0){
        alert("Please enter a valid Amount.");
        return;
    }

    if(isOperation && !category){
        alert("Please select a Category.");
        return;
    }

    if(isOperation && !payment){
        alert("Please select a Mode of Payment.");
        return;
    }

    let entry = {
        id: entryId || createExpenseId(),
        date,
        particular,
        amount,
        remarks
    };

    if(isOperation){
        entry.category = category;
        entry.payment = payment;
    }

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
   Storage
   ========================================================================== */

function saveExpenses(){
    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    if(!branch || !month) return;

    localStorage.setItem(getStorageKey(), JSON.stringify(expenseData));
}

function loadExpenses(){
    let branch = getSelectedBranch();
    let month = document.getElementById("month").value;

    expenseData = {};
    expenseTables.forEach(table => { expenseData[table.key] = []; });

    if(branch && month){
        let saved = localStorage.getItem(getStorageKey());

        if(saved){
            let parsed = JSON.parse(saved);

            expenseTables.forEach(table => {
                let rows = Array.isArray(parsed[table.key]) ? parsed[table.key] : [];

                expenseData[table.key] = rows.map(row => {
                    let entry = {
                        id: row.id || createExpenseId(),
                        date: row.date || "",
                        particular: row.particular || "",
                        amount: Number(row.amount) || 0,
                        remarks: row.remarks || ""
                    };

                    if(table.key === "operation"){
                        entry.category = row.category || "";
                        entry.payment = row.payment || "";
                    }

                    return entry;
                });
            });
        }
    }

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

        expenseTables.forEach(table => {
            const rows = sortedEntries(table.key);
            const total = rows.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

            if(cursorY > pageHeight - 45){
                doc.addPage();
                drawHeader();
                cursorY = 34;
            }

            doc.setTextColor(11, 24, 73);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11.5);
            doc.text(table.title, 14, cursorY);
            cursorY += 4;

            const isOperation = table.key === "operation";
            const amountColIndex = isOperation ? 3 : 2;

            const head = isOperation
                ? [["Date", "Category", "Particular", "Amount", "Mode of Payment", "Remarks"]]
                : [["Date", "Particular", "Amount", "Remarks"]];

            const body = rows.length
                ? rows.map(entry => isOperation
                    ? [
                        entry.date ? formatDateText(entry.date) : "—",
                        entry.category || "—",
                        entry.particular || "—",
                        pesoPdf(entry.amount),
                        entry.payment || "—",
                        entry.remarks || "—"
                    ]
                    : [
                        entry.date ? formatDateText(entry.date) : "—",
                        entry.particular || "—",
                        pesoPdf(entry.amount),
                        entry.remarks || "—"
                    ])
                : [[{
                    content: "No entries recorded for this period.",
                    colSpan: head[0].length,
                    styles: { halign: "center", textColor: [140, 146, 158], fontStyle: "italic" }
                }]];

            doc.autoTable({
                startY: cursorY,
                margin: { top: 30, left: 14, right: 14, bottom: 16 },
                head,
                body,
                foot: rows.length ? [
                    isOperation
                        ? ["", "", "Subtotal", pesoPdf(total), "", ""]
                        : ["", "Subtotal", pesoPdf(total), ""]
                ] : undefined,
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

        if(cursorY > pageHeight - 60){
            doc.addPage();
            drawHeader();
            cursorY = 34;
        }

        doc.setTextColor(11, 24, 73);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Summary Table", 14, cursorY);
        cursorY += 4;

        const totals = {};
        expenseTables.forEach(table => {
            totals[table.key] = (expenseData[table.key] || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
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
            ["Salary", pesoPdf(totals.salary)],
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
