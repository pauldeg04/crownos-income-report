let items = [];
let warehouseStock = [];
let requests = [];

let currentAddStockItemId = null;
let currentSendStockItemId = null;
let currentSendStockContext = null;
let currentStockModalMode = "add";
let currentUser = null;

document.addEventListener("DOMContentLoaded", function(){
    currentUser = window.CrownAuth?.getCurrentUser?.() || null;

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

        const isAdmin =
            currentUser?.role === "Admin";

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

                    ${isAdmin ? `
                    <button type="button" class="btn btn-sm btn-outline-primary edit-stock-btn">
                        Edit
                    </button>
                    ` : ""}
                </div>
            </td>
        `;

        tr.querySelector(".add-stock-btn")
            .addEventListener("click", function(){
                openAddStockModal(item.id);
            });

        const editBtn =
            tr.querySelector(".edit-stock-btn");

        if(editBtn){
            editBtn.addEventListener("click", function(){
                openEditStockModal(item.id);
            });
        }

        tbody.appendChild(tr);
    });

    document
        .getElementById("warehouseEmptyState")
        .classList.toggle("d-none", sortedItems.length > 0);
}

function openAddStockModal(itemId){
    currentAddStockItemId = itemId;
    currentStockModalMode = "add";

    const item =
        items.find(function(row){ return row.id === itemId; });

    document.getElementById("addStockEyebrow").textContent =
        "Stock In";

    document.getElementById("addStockTitle").textContent =
        "Add Stock — " + (item ? item.name : "");

    document.getElementById("addStockQtyLabel").textContent =
        "Quantity *";

    document.getElementById("addStockQtyInput").min = "1";
    document.getElementById("addStockQtyInput").value = "";

    document.getElementById("confirmAddStockBtn").textContent =
        "Add Stock";

    document.getElementById("addStockDateInput").value =
        CrownInventory.getTodayValue();

    document
        .getElementById("addStockModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

/* Admin-only: sets an item's warehouse quantity to an exact value
   instead of adding to it — lets staff correct a miscount (including
   back down to 0) without faking a fictitious stock-in/out movement. */
function openEditStockModal(itemId){
    if(currentUser?.role !== "Admin"){
        return;
    }

    currentAddStockItemId = itemId;
    currentStockModalMode = "edit";

    const item =
        items.find(function(row){ return row.id === itemId; });

    document.getElementById("addStockEyebrow").textContent =
        "Edit Stock";

    document.getElementById("addStockTitle").textContent =
        "Edit Stock — " + (item ? item.name : "");

    document.getElementById("addStockQtyLabel").textContent =
        "New Quantity *";

    document.getElementById("addStockQtyInput").min = "0";
    document.getElementById("addStockQtyInput").value =
        getWarehouseQty(itemId);

    document.getElementById("confirmAddStockBtn").textContent =
        "Save";

    document.getElementById("addStockDateInput").value =
        CrownInventory.getTodayValue();

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
    currentStockModalMode = "add";
}

async function confirmAddStock(){
    if(!currentAddStockItemId){
        return;
    }

    if(currentStockModalMode === "edit" && currentUser?.role !== "Admin"){
        closeAddStockModal();
        return;
    }

    /* Captured before the await below — closing the modal (Escape, a
       backdrop click) clears currentAddStockItemId mid-flight. */
    const itemId = currentAddStockItemId;
    const mode = currentStockModalMode;

    const date =
        document.getElementById("addStockDateInput").value;

    const qtyRaw =
        document.getElementById("addStockQtyInput").value;

    const qty =
        Number(qtyRaw);

    if(!date){
        alert("Please select the date" + (mode === "add" ? " replenished." : "."));
        return;
    }

    if(mode === "edit"){
        if(qtyRaw === "" || qty < 0){
            alert("Please enter a valid quantity.");
            return;
        }

        const previousQty =
            getWarehouseQty(itemId);

        if(qty === previousQty){
            closeAddStockModal();
            return;
        }

        const setOutcome =
            await transactionalSetWarehouseStock(itemId, qty, date);

        /* Offline, local-test, unreachable, or the rare chunked-doc case —
           fall back to the plain local write rather than blocking staff. */
        if(setOutcome.status !== "ok"){
            CrownInventory.setWarehouseStock(itemId, qty, date);
        }

        CrownInventory.addWarehouseLog({
            type: "ADJUST",
            date: date,
            itemId: itemId,
            qty: qty - previousQty
        });

        loadData();
        renderWarehouseTable();
        renderRequestsTable();
        closeAddStockModal();

        alert("Stock updated successfully.");
        return;
    }

    if(!qty || qty <= 0){
        alert("Please enter a valid quantity.");
        return;
    }

    const addOutcome =
        await transactionalAddWarehouseStock(itemId, qty, date);

    /* Offline, local-test, unreachable, or the rare chunked-doc case —
       fall back to the plain local write rather than blocking staff. */
    if(addOutcome.status !== "ok"){
        CrownInventory.adjustWarehouseStock(itemId, qty, date);
    }

    CrownInventory.addWarehouseLog({
        type: "IN",
        date: date,
        itemId: itemId,
        qty: qty
    });

    loadData();
    renderWarehouseTable();

    /* The requests table colours each requested Qty against available
       warehouse stock, so a replenishment has to repaint it too —
       otherwise a request stays flagged red right after the stock that
       covers it was added. */
    renderRequestsTable();

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

/* The transactional helpers below talk to Firestore DIRECTLY instead of
   going through firebase-sync.js, so they have to repeat its local-test
   guard themselves — they are outside everything that enforces it.

   Without this, a dev / LAN / file:// session is broken in a way that
   looks like a stock bug: firebase-sync.js deliberately blocks every
   outgoing push there, so "Add Stock" lands in localStorage only and the
   live appData doc keeps whatever it had (typically 0) — while "Send
   Stock" re-validates against a LIVE read of that untouched doc. The add
   saves, the table shows the new quantity, and the send still reports
   "exceeds available warehouse stock" no matter how much is added.

   Returning "offline" here routes those sessions down the local
   adjust-call fallback in the callers, which reads the same localStorage
   the rest of the page does — and, just as importantly, stops a test
   session from writing into live production stock. */
function canUseCloudStockTransactions(){
    return Boolean(
        window.firebase &&
        firebase.apps &&
        firebase.apps.length > 0 &&
        !window.CrownCloud?.isLocalTestEnv
    );
}

/* Warehouse replenishment, applied to the live doc in one transaction
   for the same reason the send paths are: the local write alone reaches
   the cloud only through firebase-sync.js's debounced push, and both
   send helpers re-validate against a live read. A replenishment still
   sitting in that queue is invisible to them, so an Add Stock followed
   quickly by a Send Stock could be rejected against the pre-add
   quantity. Transacting the add closes that window without weakening
   the concurrency check (no blanket flush of this device's snapshot
   over whatever another device already committed). */
async function transactionalAddWarehouseStock(itemId, qty, date){
    if(!canUseCloudStockTransactions()){
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

                let row =
                    rows.find(function(item){
                        return item.itemId === itemId;
                    });

                if(!row){
                    row = { itemId: itemId, qty: 0, lastDate: "" };
                    rows.push(row);
                }

                row.qty = (Number(row.qty) || 0) + qty;

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
        console.error("transactionalAddWarehouseStock failed:", error);
        return { status: "error" };
    }
}

/* Same shape as transactionalAddWarehouseStock, but sets the row's qty
   to an absolute value instead of adding a delta — used by the Edit
   Stock modal, which lets staff correct the on-hand quantity directly
   (including back down to 0) rather than only ever adding to it. */
async function transactionalSetWarehouseStock(itemId, qty, date){
    if(!canUseCloudStockTransactions()){
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

                let row =
                    rows.find(function(item){
                        return item.itemId === itemId;
                    });

                if(!row){
                    row = { itemId: itemId, qty: 0, lastDate: "" };
                    rows.push(row);
                }

                row.qty = Math.max(0, Number(qty) || 0);

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
        console.error("transactionalSetWarehouseStock failed:", error);
        return { status: "error" };
    }
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
    if(!canUseCloudStockTransactions()){
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
    if(!canUseCloudStockTransactions()){
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

    const requestedQty =
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

    if(!requestedQty || requestedQty <= 0){
        alert("Please enter a valid quantity.");
        return;
    }

    const available =
        getWarehouseQty(itemId);

    /* Fulfilling a branch request is allowed to ship less than what was
       asked for — send whatever the warehouse actually has now, and
       leave the rest pending in Stock Requests (see
       applyRequestFulfillment). A free-form Send Stock with no request
       behind it still has to fit what's on hand. */
    let qty = requestedQty;

    if(qty > available){
        if(currentSendStockContext){
            if(available <= 0){
                errorNote.textContent =
                    "No stock available for this item (Available: 0).";

                errorNote.classList.remove("d-none");
                return;
            }

            qty = available;
        }else{
            errorNote.textContent =
                `Quantity exceeds available warehouse stock (Available: ${available}).`;

            errorNote.classList.remove("d-none");
            return;
        }
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

    alert(
        qty < requestedQty
            ? `Sent ${qty} (only what's available in the warehouse). ${requestedQty - qty} still pending in Stock Requests.`
            : "Stock sent successfully."
    );
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

    const requestedQty =
        Number(line.qty) || 0;

    const shortfall =
        requestedQty - sentQty;

    line.status = "Ready for Delivery";
    line.qty = sentQty;
    line.sentQty = sentQty;
    line.sentDate = date;

    /* Only part of this line's request could be covered — leave a fresh
       line, still Awaiting Response, for the amount that didn't go out
       so it keeps showing in Stock Requests instead of the shortfall
       silently vanishing as if the full request had been met. */
    if(shortfall > 0){
        request.items.push({
            lineId: CrownInventory.createId("RLN"),
            itemId: line.itemId,
            qty: shortfall,
            status: "Awaiting Response",
            sentQty: 0,
            sentDate: "",
            receivedDate: ""
        });
    }

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

            /* Flags at a glance the requests the warehouse cannot cover
               yet, so staff can see which ones need replenishing before
               opening Send Stock only to be rejected there. */
            const requestedQty =
                Number(entry.line.qty) || 0;

            const available =
                getWarehouseQty(entry.line.itemId);

            const shortOfStock =
                requestedQty > available;

            row.innerHTML = `
                <td>${CrownInventory.formatDate(entry.request.date)}</td>
                <td>${CrownInventory.escapeHtml(entry.request.branch)}</td>
                <td><strong>${CrownInventory.escapeHtml(item?.name || "Unknown Item")}</strong></td>
                <td>${CrownInventory.escapeHtml(item?.category) || "—"}</td>
                <td>${CrownInventory.escapeHtml(item?.description) || "—"}</td>
                <td class="${shortOfStock ? "low-stock-cell" : ""}" ${shortOfStock ? `title="Only ${available} available in the warehouse"` : ""}>${entry.line.qty}</td>
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
            <td>${entry.type === "IN" ? "Stock In" : entry.type === "OUT" ? "Stock Out" : "Adjustment"}</td>
            <td>${CrownInventory.escapeHtml(item?.name || "Unknown Item")}</td>
            <td>${CrownInventory.escapeHtml(entry.branch) || "—"}</td>
            <td>${entry.type === "ADJUST" && entry.qty > 0 ? "+" + entry.qty : entry.qty}</td>
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
