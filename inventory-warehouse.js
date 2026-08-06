let items = [];
let warehouseStock = [];
let requests = [];

let currentAddStockItemId = null;
let currentSendStockItemId = null;
let currentSendStockContext = null;

document.addEventListener("DOMContentLoaded", function(){
    loadData();
    attachEvents();
    renderWarehouseTable();
    renderRequestsTable();
});

function loadData(){
    items = CrownInventory.getItems();
    warehouseStock = CrownInventory.getWarehouseStock();
    requests = CrownInventory.getRequests();
}

function attachEvents(){
    document
        .getElementById("closeAddStockModalBtn")
        .addEventListener("click", closeAddStockModal);

    document
        .getElementById("cancelAddStockBtn")
        .addEventListener("click", closeAddStockModal);

    document
        .getElementById("confirmAddStockBtn")
        .addEventListener("click", confirmAddStock);

    document
        .getElementById("closeSendStockModalBtn")
        .addEventListener("click", closeSendStockModal);

    document
        .getElementById("cancelSendStockBtn")
        .addEventListener("click", closeSendStockModal);

    document
        .getElementById("confirmSendStockBtn")
        .addEventListener("click", confirmSendStock);

    document
        .getElementById("sendStockItemInput")
        .addEventListener("change", updateSendStockAvailableNote);

    document
        .getElementById("showHistoryBtn")
        .addEventListener("click", openHistoryModal);

    document
        .getElementById("closeHistoryModalBtn")
        .addEventListener("click", closeHistoryModal);

    document
        .getElementById("closeHistoryBtn")
        .addEventListener("click", closeHistoryModal);

    [
        "addStockModalBackdrop",
        "sendStockModalBackdrop",
        "historyModalBackdrop"
    ].forEach(function(id){
        document
            .getElementById(id)
            .addEventListener("click", function(event){
                if(event.target === this){
                    closeAllModals();
                }
            });
    });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeAllModals();
        }
    });
}

function closeAllModals(){
    closeAddStockModal();
    closeSendStockModal();
    closeHistoryModal();
}

function getWarehouseQty(itemId){
    const row =
        CrownInventory.getWarehouseRow(itemId, warehouseStock);

    return row ? Number(row.qty) || 0 : 0;
}

function renderWarehouseTable(){
    const tbody =
        document.getElementById("warehouseBody");

    tbody.innerHTML = "";

    const sortedItems =
        items
            .slice()
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            });

    sortedItems.forEach(function(item){
        const row =
            CrownInventory.getWarehouseRow(item.id, warehouseStock);

        const qty =
            row ? Number(row.qty) || 0 : 0;

        const tr =
            document.createElement("tr");

        tr.innerHTML = `
            <td>${CrownInventory.formatDate(row?.lastDate)}</td>
            <td><strong>${CrownInventory.escapeHtml(item.name)}</strong></td>
            <td>${CrownInventory.escapeHtml(item.category)}</td>
            <td>${CrownInventory.escapeHtml(item.description) || "—"}</td>
            <td class="${qty === 0 ? "low-stock-cell" : ""}">${qty}</td>
            <td>${CrownInventory.escapeHtml(item.unit)}</td>
            <td>
                <div class="action-buttons">
                    <button type="button" class="btn btn-sm btn-success add-stock-btn">
                        Add Stock
                    </button>

                    <button type="button" class="btn btn-sm btn-primary send-stock-btn">
                        Send Stock
                    </button>
                </div>
            </td>
        `;

        tr.querySelector(".add-stock-btn")
            .addEventListener("click", function(){
                openAddStockModal(item.id);
            });

        tr.querySelector(".send-stock-btn")
            .addEventListener("click", function(){
                openSendStockModal(item.id, null);
            });

        tbody.appendChild(tr);
    });

    document
        .getElementById("warehouseEmptyState")
        .classList.toggle("d-none", sortedItems.length > 0);
}

function openAddStockModal(itemId){
    currentAddStockItemId = itemId;

    const item =
        items.find(function(row){ return row.id === itemId; });

    document.getElementById("addStockTitle").textContent =
        "Add Stock — " + (item ? item.name : "");

    document.getElementById("addStockDateInput").value =
        CrownInventory.getTodayValue();

    document.getElementById("addStockQtyInput").value = "";

    document
        .getElementById("addStockModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeAddStockModal(){
    document
        .getElementById("addStockModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    currentAddStockItemId = null;
}

function confirmAddStock(){
    if(!currentAddStockItemId){
        return;
    }

    const date =
        document.getElementById("addStockDateInput").value;

    const qty =
        Number(document.getElementById("addStockQtyInput").value);

    if(!date){
        alert("Please select the date replenished.");
        return;
    }

    if(!qty || qty <= 0){
        alert("Please enter a valid quantity.");
        return;
    }

    CrownInventory.adjustWarehouseStock(currentAddStockItemId, qty, date);

    CrownInventory.addWarehouseLog({
        type: "IN",
        date: date,
        itemId: currentAddStockItemId,
        qty: qty
    });

    loadData();
    renderWarehouseTable();
    closeAddStockModal();

    alert("Stock added successfully.");
}

function openSendStockModal(itemId, requestContext){
    currentSendStockItemId = itemId;
    currentSendStockContext = requestContext;

    populateSendStockBranchOptions();
    populateSendStockItemOptions();

    document.getElementById("sendStockDateInput").value =
        CrownInventory.getTodayValue();

    document.getElementById("sendStockItemInput").value =
        itemId || "";

    document.getElementById("sendStockBranchInput").disabled =
        Boolean(requestContext);

    document.getElementById("sendStockItemInput").disabled =
        true;

    if(requestContext){
        document.getElementById("sendStockBranchInput").value =
            requestContext.branch;

        document.getElementById("sendStockQtyInput").value =
            requestContext.qty;

        document.getElementById("sendStockTitle").textContent =
            "Send Stock — Fulfill Request";
    }else{
        document.getElementById("sendStockQtyInput").value = "";

        document.getElementById("sendStockTitle").textContent =
            "Send Stock";
    }

    document.getElementById("sendStockError").classList.add("d-none");

    updateSendStockAvailableNote();

    document
        .getElementById("sendStockModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeSendStockModal(){
    document
        .getElementById("sendStockModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    currentSendStockItemId = null;
    currentSendStockContext = null;
}

function populateSendStockBranchOptions(){
    const select =
        document.getElementById("sendStockBranchInput");

    const branches =
        window.CrownAuth?.getAllBranchNames?.() || [];

    select.innerHTML =
        '<option value="">Select Branch</option>' +
        branches
            .map(function(branch){
                return `<option value="${CrownInventory.escapeHtml(branch)}">${CrownInventory.escapeHtml(branch)}</option>`;
            })
            .join("");
}

function populateSendStockItemOptions(){
    const select =
        document.getElementById("sendStockItemInput");

    select.innerHTML =
        items
            .slice()
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            })
            .map(function(item){
                return `<option value="${item.id}">${CrownInventory.escapeHtml(item.name)}</option>`;
            })
            .join("");
}

function updateSendStockAvailableNote(){
    const itemId =
        document.getElementById("sendStockItemInput").value;

    const available =
        getWarehouseQty(itemId);

    document.getElementById("sendStockAvailableNote").textContent =
        "Available: " + available;
}

function confirmSendStock(){
    const itemId =
        document.getElementById("sendStockItemInput").value;

    const branch =
        document.getElementById("sendStockBranchInput").value;

    const date =
        document.getElementById("sendStockDateInput").value;

    const qty =
        Number(document.getElementById("sendStockQtyInput").value);

    const errorNote =
        document.getElementById("sendStockError");

    errorNote.classList.add("d-none");

    if(!itemId){
        alert("Please select an item.");
        return;
    }

    if(!branch){
        alert("Please select a branch.");
        return;
    }

    if(!date){
        alert("Please select a date.");
        return;
    }

    if(!qty || qty <= 0){
        alert("Please enter a valid quantity.");
        return;
    }

    const available =
        getWarehouseQty(itemId);

    if(qty > available){
        errorNote.textContent =
            `Quantity exceeds available warehouse stock (Available: ${available}).`;

        errorNote.classList.remove("d-none");
        return;
    }

    CrownInventory.adjustWarehouseStock(itemId, -qty, date);

    if(currentSendStockContext){
        applyRequestFulfillment(
            currentSendStockContext.requestId,
            currentSendStockContext.lineId,
            qty,
            date
        );

        CrownInventory.addWarehouseLog({
            type: "OUT",
            date: date,
            itemId: itemId,
            branch: branch,
            qty: qty,
            requestId: currentSendStockContext.requestId
        });
    }else{
        CrownInventory.adjustBranchStock(branch, itemId, qty, date);

        CrownInventory.addWarehouseLog({
            type: "OUT",
            date: date,
            itemId: itemId,
            branch: branch,
            qty: qty
        });
    }

    loadData();
    renderWarehouseTable();
    renderRequestsTable();
    closeSendStockModal();

    alert("Stock sent successfully.");
}

function applyRequestFulfillment(requestId, lineId, sentQty, date){
    const request =
        requests.find(function(item){
            return item.id === requestId;
        });

    if(!request){
        return;
    }

    const line =
        (request.items || []).find(function(item){
            return item.lineId === lineId;
        });

    if(!line){
        return;
    }

    line.status = "Ready for Delivery";
    line.sentQty = sentQty;
    line.sentDate = date;

    CrownInventory.saveRequests(requests);
}

function renderRequestsTable(){
    const tbody =
        document.getElementById("requestsBody");

    tbody.innerHTML = "";

    const pendingLines = [];

    requests.forEach(function(request){
        (request.items || []).forEach(function(line){
            if(line.status === "Awaiting Response"){
                pendingLines.push({
                    request: request,
                    line: line
                });
            }
        });
    });

    pendingLines
        .sort(function(a, b){
            return String(a.request.date || "").localeCompare(String(b.request.date || ""));
        })
        .forEach(function(entry){
            const item =
                CrownInventory.getItemById(entry.line.itemId);

            const row =
                document.createElement("tr");

            row.innerHTML = `
                <td>${CrownInventory.formatDate(entry.request.date)}</td>
                <td>${CrownInventory.escapeHtml(entry.request.branch)}</td>
                <td><strong>${CrownInventory.escapeHtml(item?.name || "Unknown Item")}</strong></td>
                <td>${CrownInventory.escapeHtml(item?.category) || "—"}</td>
                <td>${CrownInventory.escapeHtml(item?.description) || "—"}</td>
                <td>${entry.line.qty}</td>
                <td>${CrownInventory.escapeHtml(item?.unit) || "—"}</td>
                <td>
                    <div class="action-buttons">
                        <button type="button" class="btn btn-sm btn-primary fulfill-btn">
                            Send Stock
                        </button>
                    </div>
                </td>
            `;

            row.querySelector(".fulfill-btn")
                .addEventListener("click", function(){
                    openSendStockModal(entry.line.itemId, {
                        requestId: entry.request.id,
                        lineId: entry.line.lineId,
                        branch: entry.request.branch,
                        qty: entry.line.qty
                    });
                });

            tbody.appendChild(row);
        });

    document
        .getElementById("requestsEmptyState")
        .classList.toggle("d-none", pendingLines.length > 0);

    document.getElementById("pendingRequestCount").textContent =
        pendingLines.length;
}

function openHistoryModal(){
    const tbody =
        document.getElementById("historyBody");

    const log =
        CrownInventory.getWarehouseLog();

    tbody.innerHTML = "";

    log.forEach(function(entry){
        const item =
            CrownInventory.getItemById(entry.itemId);

        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td>${CrownInventory.formatDate(entry.date)}</td>
            <td>${entry.type === "IN" ? "Stock In" : "Stock Out"}</td>
            <td>${CrownInventory.escapeHtml(item?.name || "Unknown Item")}</td>
            <td>${CrownInventory.escapeHtml(entry.branch) || "—"}</td>
            <td>${entry.qty}</td>
        `;

        tbody.appendChild(row);
    });

    document
        .getElementById("historyEmptyState")
        .classList.toggle("d-none", log.length > 0);

    document
        .getElementById("historyModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeHistoryModal(){
    document
        .getElementById("historyModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");
}
