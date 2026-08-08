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

/* Atomically moves qty of itemId from the warehouse to a branch: reads
   BOTH the crownWarehouseStock and crownBranchStock appData docs fresh
   inside one Firestore transaction, re-validates warehouse availability
   against that live read (not the possibly-stale `available` the caller
   already checked), and only if it still holds, decrements the
   warehouse row and increments the branch row together in the same
   commit. Without this, adjustWarehouseStock()/adjustBranchStock() were
   two independent localStorage read-modify-writes with a stale
   pre-check: two concurrent sends of the same item (two tabs/devices)
   could each pass validation against their own stale "available"
   snapshot, each floor-clamp the warehouse at 0 on deduct, but the
   branch still always got credited the FULL qty it "sent" regardless —
   minting stock at the branch that was never actually available in the
   warehouse.

   Deliberately only handles the (overwhelmingly common) single-chunk
   case for both docs, same as scheduling.js's
   transactionalUpdateSchedules() — the warehouse/branch stock lists are
   small, nowhere near the ~900KB chunk threshold. Falls back to the old
   non-atomic adjust calls when offline/chunked/unreachable so staff
   aren't fully blocked. */
async function transactionalStockTransfer(itemId, branch, qty, date){
    if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
        return { status: "offline" };
    }

    const warehouseKey = "crownWarehouseStock";
    const branchKey = "crownBranchStock";

    const warehouseRef =
        firebase.firestore().collection("appData").doc(encodeURIComponent(warehouseKey));

    const branchRef =
        firebase.firestore().collection("appData").doc(encodeURIComponent(branchKey));

    function readRows(data){
        if(data && Number.isInteger(data.chunkCount) && data.chunkCount > 1){
            return null;
        }

        if(!data || data.deleted || !data.value){
            return [];
        }

        try{
            const parsed = JSON.parse(data.value);
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    try{
        const outcome =
            await firebase.firestore().runTransaction(async function(transaction){
                const warehouseSnap = await transaction.get(warehouseRef);
                const branchSnap = await transaction.get(branchRef);

                const warehouseData = warehouseSnap.exists ? warehouseSnap.data() : null;
                const branchData = branchSnap.exists ? branchSnap.data() : null;

                const warehouseRows = readRows(warehouseData);
                const branchRows = readRows(branchData);

                if(warehouseRows === null || branchRows === null){
                    return { status: "unsupported" };
                }

                const warehouseRow =
                    warehouseRows.find(function(row){
                        return row.itemId === itemId;
                    });

                const liveAvailable =
                    warehouseRow ? (Number(warehouseRow.qty) || 0) : 0;

                if(qty > liveAvailable){
                    return { status: "insufficient", available: liveAvailable };
                }

                if(warehouseRow){
                    warehouseRow.qty = liveAvailable - qty;
                    if(date){
                        warehouseRow.lastDate = date;
                    }
                }

                let branchRow =
                    branchRows.find(function(row){
                        return row.branch === branch && row.itemId === itemId;
                    });

                if(!branchRow){
                    branchRow = { branch: branch, itemId: itemId, qty: 0, lastDate: "" };
                    branchRows.push(branchRow);
                }

                branchRow.qty = (Number(branchRow.qty) || 0) + qty;
                if(date){
                    branchRow.lastDate = date;
                }

                const now = firebase.firestore.FieldValue.serverTimestamp();

                transaction.set(warehouseRef, {
                    key: warehouseKey,
                    chunkIndex: 0,
                    chunkCount: 1,
                    value: JSON.stringify(warehouseRows),
                    deleted: false,
                    updatedAt: now
                });

                transaction.set(branchRef, {
                    key: branchKey,
                    chunkIndex: 0,
                    chunkCount: 1,
                    value: JSON.stringify(branchRows),
                    deleted: false,
                    updatedAt: now
                });

                return { status: "ok", warehouseRows: warehouseRows, branchRows: branchRows };
            });

        if(outcome.status === "ok"){
            localStorage.setItem(warehouseKey, JSON.stringify(outcome.warehouseRows));
            localStorage.setItem(branchKey, JSON.stringify(outcome.branchRows));
        }

        return outcome;
    }catch(error){
        console.error("transactionalStockTransfer failed:", error);
        return { status: "error" };
    }
}

/* Single-doc counterpart to transactionalStockTransfer() for the
   fulfill-a-pending-request path, where the branch side isn't credited
   here at all (see applyRequestFulfillment() — that just marks the
   request line "Ready for Delivery"; the actual branch credit happens
   later at receipt confirmation, outside this function's scope). Still
   worth closing the warehouse-side race on its own: two concurrent
   fulfillments of the same item could otherwise both pass a stale
   availability check and both floor-clamp the warehouse at 0. */
async function transactionalDeductWarehouseStock(itemId, qty, date){
    if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
        return { status: "offline" };
    }

    const warehouseKey = "crownWarehouseStock";

    const warehouseRef =
        firebase.firestore().collection("appData").doc(encodeURIComponent(warehouseKey));

    try{
        const outcome =
            await firebase.firestore().runTransaction(async function(transaction){
                const snap = await transaction.get(warehouseRef);
                const data = snap.exists ? snap.data() : null;

                if(data && Number.isInteger(data.chunkCount) && data.chunkCount > 1){
                    return { status: "unsupported" };
                }

                let rows = [];

                if(data && !data.deleted && data.value){
                    try{
                        const parsed = JSON.parse(data.value);
                        rows = Array.isArray(parsed) ? parsed : [];
                    }catch(error){
                        rows = [];
                    }
                }

                const row =
                    rows.find(function(item){
                        return item.itemId === itemId;
                    });

                const liveAvailable =
                    row ? (Number(row.qty) || 0) : 0;

                if(qty > liveAvailable){
                    return { status: "insufficient", available: liveAvailable };
                }

                row.qty = liveAvailable - qty;
                if(date){
                    row.lastDate = date;
                }

                transaction.set(warehouseRef, {
                    key: warehouseKey,
                    chunkIndex: 0,
                    chunkCount: 1,
                    value: JSON.stringify(rows),
                    deleted: false,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                return { status: "ok", rows: rows };
            });

        if(outcome.status === "ok"){
            localStorage.setItem(warehouseKey, JSON.stringify(outcome.rows));
        }

        return outcome;
    }catch(error){
        console.error("transactionalDeductWarehouseStock failed:", error);
        return { status: "error" };
    }
}

async function confirmSendStock(){
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

    /* The `available` check above reads a possibly-stale local snapshot
       (fine as a fast first pass) — the transactional helpers below
       re-validate against a LIVE Firestore read and are what actually
       prevent two concurrent sends of the same item from both
       succeeding past what the warehouse really has. See
       transactionalStockTransfer() / transactionalDeductWarehouseStock()
       for why this couldn't just stay two independent adjust calls. */
    const sendOutcome =
        currentSendStockContext
            ? await transactionalDeductWarehouseStock(itemId, qty, date)
            : await transactionalStockTransfer(itemId, branch, qty, date);

    if(sendOutcome.status === "insufficient"){
        errorNote.textContent =
            `Quantity exceeds available warehouse stock (Available: ${sendOutcome.available}).`;

        errorNote.classList.remove("d-none");
        return;
    }

    if(sendOutcome.status === "ok"){
        warehouseStock = CrownInventory.getWarehouseStock();
    }else{
        /* Offline, unreachable, or the rare chunked-doc case — fall back
           to the old non-atomic adjust calls rather than fully blocking
           staff who are genuinely offline. This reintroduces the race
           for just this send, same as before this fix existed. */
        CrownInventory.adjustWarehouseStock(itemId, -qty, date);

        if(!currentSendStockContext){
            CrownInventory.adjustBranchStock(branch, itemId, qty, date);
        }
    }

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
