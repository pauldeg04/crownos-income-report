const BRANCH_KEY = "crownSelectedBranch";
const NEW_ITEM_VALUE = "__new__";

let items = [];
let branchStock = [];
let requests = [];
let requestLines = [];

document.addEventListener("DOMContentLoaded", function(){
    loadData();
    attachEvents();
    render();

    window.addEventListener("crownGlobalFiltersChanged", function(){
        loadData();
        render();
    });
});

function getCurrentBranch(){
    return localStorage.getItem(BRANCH_KEY) || "";
}

function loadData(){
    items = CrownInventory.getItems();
    branchStock = CrownInventory.getBranchStock();
    requests = CrownInventory.getRequests();
}

function attachEvents(){
    document
        .getElementById("requestStockBtn")
        .addEventListener("click", function(){
            openRequestModal(null);
        });

    document
        .getElementById("closeRequestModalBtn")
        .addEventListener("click", closeRequestModal);

    document
        .getElementById("cancelRequestBtn")
        .addEventListener("click", closeRequestModal);

    document
        .getElementById("addRequestLineBtn")
        .addEventListener("click", function(){
            addRequestLine(null);
        });

    document
        .getElementById("sendRequestBtn")
        .addEventListener("click", submitRequest);

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
        "requestModalBackdrop",
        "historyModalBackdrop"
    ].forEach(function(id){
        document
            .getElementById(id)
            .addEventListener("click", function(event){
                if(event.target === this){
                    closeRequestModal();
                    closeHistoryModal();
                }
            });
    });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeRequestModal();
            closeHistoryModal();
        }
    });
}

function render(){
    const branch = getCurrentBranch();

    const hasBranch =
        Boolean(branch);

    document
        .getElementById("noBranchNotice")
        .classList.toggle("d-none", hasBranch);

    document
        .getElementById("stockSection")
        .classList.toggle("d-none", !hasBranch);

    document
        .getElementById("pendingSection")
        .classList.toggle("d-none", !hasBranch);

    if(!hasBranch){
        return;
    }

    document.getElementById("branchNameLabel").textContent =
        branch;

    renderStockTable();
    renderPendingTable();
}

function renderStockTable(){
    const branch = getCurrentBranch();

    const tbody =
        document.getElementById("stockBody");

    tbody.innerHTML = "";

    const sortedItems =
        items
            .slice()
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            });

    sortedItems.forEach(function(item){
        const row =
            CrownInventory.getBranchRow(branch, item.id, branchStock);

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
                    <button type="button" class="btn btn-sm btn-success request-btn">
                        Request Stock
                    </button>
                </div>
            </td>
        `;

        tr.querySelector(".request-btn")
            .addEventListener("click", function(){
                openRequestModal(item.id);
            });

        tbody.appendChild(tr);
    });

    document
        .getElementById("stockEmptyState")
        .classList.toggle("d-none", sortedItems.length > 0);
}

function renderPendingTable(){
    const branch = getCurrentBranch();

    const tbody =
        document.getElementById("pendingBody");

    tbody.innerHTML = "";

    const pendingLines = [];

    requests
        .filter(function(request){
            return request.branch === branch;
        })
        .forEach(function(request){
            (request.items || []).forEach(function(line){
                if(
                    line.status === "Awaiting Response" ||
                    line.status === "Ready for Delivery"
                ){
                    pendingLines.push({ request, line });
                }
            });
        });

    pendingLines
        .sort(function(a, b){
            return String(b.request.date || "").localeCompare(String(a.request.date || ""));
        })
        .forEach(function(entry){
            const item =
                CrownInventory.getItemById(entry.line.itemId);

            const canReceive =
                entry.line.status === "Ready for Delivery";

            const row =
                document.createElement("tr");

            row.innerHTML = `
                <td>${CrownInventory.formatDate(entry.request.date)}</td>
                <td><strong>${CrownInventory.escapeHtml(item?.name || "Unknown Item")}</strong></td>
                <td>${entry.line.qty}</td>
                <td>
                    <span class="inv-status ${statusClass(entry.line.status)}">
                        ${CrownInventory.escapeHtml(entry.line.status)}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button type="button" class="btn btn-sm btn-danger cancel-btn">
                            Cancel
                        </button>

                        <button type="button" class="btn btn-sm btn-success received-btn" ${canReceive ? "" : "disabled"}>
                            Received
                        </button>
                    </div>
                </td>
            `;

            row.querySelector(".cancel-btn")
                .addEventListener("click", function(){
                    cancelRequestLine(entry.request.id, entry.line.lineId);
                });

            row.querySelector(".received-btn")
                .addEventListener("click", function(){
                    receiveRequestLine(entry.request.id, entry.line.lineId);
                });

            tbody.appendChild(row);
        });

    document
        .getElementById("pendingEmptyState")
        .classList.toggle("d-none", pendingLines.length > 0);
}

function statusClass(status){
    if(status === "Awaiting Response"){ return "status-awaiting"; }
    if(status === "Ready for Delivery"){ return "status-ready"; }
    if(status === "Received"){ return "status-received"; }
    if(status === "Cancelled"){ return "status-cancelled"; }
    return "";
}

function cancelRequestLine(requestId, lineId){
    const request =
        requests.find(function(item){ return item.id === requestId; });

    if(!request){ return; }

    const line =
        (request.items || []).find(function(item){ return item.lineId === lineId; });

    if(!line){ return; }

    if(
        line.status !== "Awaiting Response" &&
        line.status !== "Ready for Delivery"
    ){
        return;
    }

    if(!confirm("Cancel this stock request item?")){
        return;
    }

    if(line.status === "Ready for Delivery" && line.sentQty){
        CrownInventory.adjustWarehouseStock(line.itemId, Number(line.sentQty) || 0);

        CrownInventory.addWarehouseLog({
            type: "IN",
            date: CrownInventory.getTodayValue(),
            itemId: line.itemId,
            qty: Number(line.sentQty) || 0,
            branch: request.branch,
            note: "Returned from cancelled branch request"
        });
    }

    line.status = "Cancelled";
    line.receivedDate = CrownInventory.getTodayValue();

    CrownInventory.saveRequests(requests);

    loadData();
    render();
}

function receiveRequestLine(requestId, lineId){
    const request =
        requests.find(function(item){ return item.id === requestId; });

    if(!request){ return; }

    const line =
        (request.items || []).find(function(item){ return item.lineId === lineId; });

    if(!line || line.status !== "Ready for Delivery"){ return; }

    const today =
        CrownInventory.getTodayValue();

    CrownInventory.adjustBranchStock(
        request.branch,
        line.itemId,
        Number(line.sentQty) || 0,
        today
    );

    line.status = "Received";
    line.receivedDate = today;

    CrownInventory.saveRequests(requests);

    loadData();
    render();

    alert("Item marked as received and added to branch stock.");
}

/* Request Stock modal */

function openRequestModal(prefillItemId){
    requestLines = [];

    document.getElementById("requestLinesContainer").innerHTML = "";
    document.getElementById("requestDateInput").value =
        CrownInventory.getTodayValue();

    addRequestLine(prefillItemId);

    document
        .getElementById("requestModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeRequestModal(){
    document
        .getElementById("requestModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    requestLines = [];
}

function addRequestLine(prefillItemId){
    const lineId =
        CrownInventory.createId("LINE");

    const wrapper =
        document.createElement("div");

    wrapper.className = "inv-request-line";

    const sortedItems =
        items
            .slice()
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            });

    wrapper.innerHTML = `
        <div>
            <label class="form-label">Item *</label>
            <select class="form-select line-item-select">
                <option value="">Select Item</option>
                ${sortedItems.map(function(item){
                    return `<option value="${item.id}">${CrownInventory.escapeHtml(item.name)}</option>`;
                }).join("")}
                <option value="${NEW_ITEM_VALUE}">+ New Item</option>
            </select>
        </div>

        <div>
            <label class="form-label">Quantity *</label>
            <input type="number" class="form-control line-qty-input" min="1" step="1" placeholder="0">
        </div>

        <div>
            <button type="button" class="inv-remove-line-btn line-remove-btn">Remove</button>
        </div>

        <div class="new-item-field d-none">
            <label class="form-label">New Item Name *</label>
            <input type="text" class="form-control line-new-name-input" placeholder="Enter new item name">
        </div>
    `;

    const itemSelect =
        wrapper.querySelector(".line-item-select");

    const newNameField =
        wrapper.querySelector(".new-item-field");

    itemSelect.addEventListener("change", function(){
        newNameField.classList.toggle(
            "d-none",
            itemSelect.value !== NEW_ITEM_VALUE
        );
    });

    wrapper.querySelector(".line-remove-btn")
        .addEventListener("click", function(){
            wrapper.remove();

            requestLines =
                requestLines.filter(function(entry){
                    return entry.lineId !== lineId;
                });
        });

    if(prefillItemId){
        itemSelect.value = prefillItemId;
    }

    document
        .getElementById("requestLinesContainer")
        .appendChild(wrapper);

    requestLines.push({
        lineId: lineId,
        wrapper: wrapper,
        itemSelect: itemSelect,
        qtyInput: wrapper.querySelector(".line-qty-input"),
        newNameInput: wrapper.querySelector(".line-new-name-input")
    });
}

function submitRequest(){
    const branch = getCurrentBranch();

    if(!branch){
        alert("Please select a branch first.");
        return;
    }

    const date =
        document.getElementById("requestDateInput").value;

    if(!date){
        alert("Please select a date.");
        return;
    }

    if(requestLines.length === 0){
        alert("Please add at least one item.");
        return;
    }

    const finalItems = [];

    for(const entry of requestLines){
        const selectedValue = entry.itemSelect.value;
        const qty = Number(entry.qtyInput.value);

        if(!selectedValue){
            alert("Please select an item for every line.");
            return;
        }

        if(!qty || qty <= 0){
            alert("Please enter a valid quantity for every line.");
            return;
        }

        let itemId = selectedValue;

        if(selectedValue === NEW_ITEM_VALUE){
            const newName =
                entry.newNameInput.value.trim();

            if(!newName){
                alert("Please enter the name of the new item.");
                return;
            }

            const duplicate =
                items.find(function(item){
                    return String(item.name || "").toLowerCase() === newName.toLowerCase();
                });

            if(duplicate){
                itemId = duplicate.id;
            }else{
                const newItem = {
                    id: CrownInventory.createId("ITM"),
                    name: newName,
                    category: "Others",
                    unit: "",
                    description: "",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                items.push(newItem);
                CrownInventory.saveItems(items);

                itemId = newItem.id;
            }
        }

        finalItems.push({
            lineId: CrownInventory.createId("RLN"),
            itemId: itemId,
            qty: qty,
            status: "Awaiting Response",
            sentQty: 0,
            sentDate: "",
            receivedDate: ""
        });
    }

    const request = {
        id: CrownInventory.createId("REQ"),
        branch: branch,
        date: date,
        createdAt: new Date().toISOString(),
        items: finalItems
    };

    requests.push(request);
    CrownInventory.saveRequests(requests);

    loadData();
    render();
    closeRequestModal();

    alert("Stock request sent to the Warehouse.");
}

/* History modal */

function openHistoryModal(){
    const branch = getCurrentBranch();

    const tbody =
        document.getElementById("historyBody");

    tbody.innerHTML = "";

    const historyLines = [];

    requests
        .filter(function(request){
            return request.branch === branch;
        })
        .forEach(function(request){
            (request.items || []).forEach(function(line){
                if(
                    line.status === "Received" ||
                    line.status === "Cancelled"
                ){
                    historyLines.push({ request, line });
                }
            });
        });

    historyLines
        .sort(function(a, b){
            return String(b.line.receivedDate || "").localeCompare(String(a.line.receivedDate || ""));
        })
        .forEach(function(entry){
            const item =
                CrownInventory.getItemById(entry.line.itemId);

            const row =
                document.createElement("tr");

            row.innerHTML = `
                <td>${CrownInventory.formatDate(entry.line.receivedDate || entry.request.date)}</td>
                <td>${CrownInventory.escapeHtml(item?.name || "Unknown Item")}</td>
                <td>${entry.line.qty}</td>
                <td>
                    <span class="inv-status ${statusClass(entry.line.status)}">
                        ${CrownInventory.escapeHtml(entry.line.status)}
                    </span>
                </td>
            `;

            tbody.appendChild(row);
        });

    document
        .getElementById("historyEmptyState")
        .classList.toggle("d-none", historyLines.length > 0);

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
