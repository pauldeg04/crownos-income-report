/* ==========================================================================
   Crown Head Spa — Voucher Masterlist
   Read-only tracking of the voucher registry (crownVoucherRegistry),
   plus Admin-only Void / Reactivate for unredeemed vouchers.
   ========================================================================== */

const VOUCHER_REGISTRY_KEY = "crownVoucherRegistry";

document.addEventListener("DOMContentLoaded", function(){
    document.getElementById("voucherSearch")
        .addEventListener("input", renderVoucherList);

    document.getElementById("voucherStatusFilter")
        .addEventListener("change", renderVoucherList);

    /* Re-render kapag may bagong voucher galing sa ibang device. */
    window.addEventListener("crownCloudUpdate", function(event){
        if(event.detail?.keys?.includes(VOUCHER_REGISTRY_KEY)){
            renderVoucherList();
        }
    });

    renderVoucherList();
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

function getRegistry(){
    try{
        const raw =
            localStorage.getItem(VOUCHER_REGISTRY_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed)
            ? parsed
            : [];
    }catch(error){
        console.error("Unable to load voucher registry:", error);
        return [];
    }
}

function saveRegistry(registry){
    localStorage.setItem(
        VOUCHER_REGISTRY_KEY,
        JSON.stringify(registry)
    );
}

/* Reads the LIVE Firestore-mirrored voucher registry (not the possibly-
   stale localStorage copy) inside a transaction, lets mutateFn(current)
   return the new array to commit or null to abort (e.g. the voucher's
   status already changed from what this action expected), and writes
   the result back atomically. voidVoucher()/reactivateVoucher() used to
   be a plain read-modify-write against localStorage with no concurrency
   guard — two admins acting on the same voucher from different devices
   at once could lose one update. Mirrors scheduling.js's
   transactionalUpdateSchedules() / inventory-warehouse.js's
   transactionalStockTransfer(). Deliberately only handles the
   (overwhelmingly common) single-chunk case, same as those. */
async function transactionalUpdateVoucherRegistry(mutateFn){
    if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
        return { status: "offline" };
    }

    const ref =
        firebase.firestore()
            .collection("appData")
            .doc(encodeURIComponent(VOUCHER_REGISTRY_KEY));

    try{
        const outcome =
            await firebase.firestore().runTransaction(async function(transaction){
                const snap = await transaction.get(ref);
                const data = snap.exists ? snap.data() : null;

                if(data && Number.isInteger(data.chunkCount) && data.chunkCount > 1){
                    return { status: "unsupported" };
                }

                let current = [];

                if(data && !data.deleted && data.value){
                    try{
                        const parsed = JSON.parse(data.value);
                        current = Array.isArray(parsed) ? parsed : [];
                    }catch(error){
                        current = [];
                    }
                }

                const next = mutateFn(current);

                if(next === null){
                    return { status: "conflict" };
                }

                transaction.set(ref, {
                    key: VOUCHER_REGISTRY_KEY,
                    chunkIndex: 0,
                    chunkCount: 1,
                    value: JSON.stringify(next),
                    deleted: false,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                return { status: "ok", registry: next };
            });

        if(outcome.status === "ok"){
            saveRegistry(outcome.registry);
        }

        return outcome;
    }catch(error){
        console.error("transactionalUpdateVoucherRegistry failed:", error);
        return { status: "error" };
    }
}

function isAdmin(){
    return window.CrownAuth?.getCurrentUser?.()?.role === "Admin";
}

function formatDateTime(isoString){
    if(!isoString){
        return "—";
    }

    return new Date(isoString).toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric"
    }) + " · " + new Date(isoString).toLocaleTimeString("en-PH", {
        hour: "numeric",
        minute: "2-digit"
    });
}

function shortBranch(branchName){
    return String(branchName || "")
        .replace("Crown Head Spa ", "");
}

function statusBadge(status){
    if(status === "redeemed"){
        return '<span class="voucher-status-badge voucher-status-redeemed">Redeemed</span>';
    }

    if(status === "cancelled"){
        return '<span class="voucher-status-badge voucher-status-cancelled">Voided</span>';
    }

    return '<span class="voucher-status-badge voucher-status-active">Active</span>';
}

function renderVoucherList(){
    const registry =
        getRegistry()
            .slice()
            .sort(function(a, b){
                return String(b.issuedAt || "")
                    .localeCompare(String(a.issuedAt || ""));
            });

    /* Summary tiles (always the full registry, hindi filtered) */
    const summary = {
        active: { count: 0, value: 0 },
        redeemed: { count: 0, value: 0 },
        cancelled: { count: 0, value: 0 }
    };

    registry.forEach(function(entry){
        const bucket =
            summary[entry.status] || summary.active;

        bucket.count += 1;
        bucket.value += Number(entry.value) || 0;
    });

    document.getElementById("tileTotal").textContent =
        registry.length;

    document.getElementById("tileTotalValue").textContent =
        peso(
            summary.active.value +
            summary.redeemed.value +
            summary.cancelled.value
        );

    document.getElementById("tileActive").textContent =
        summary.active.count;

    document.getElementById("tileActiveValue").textContent =
        peso(summary.active.value);

    document.getElementById("tileRedeemed").textContent =
        summary.redeemed.count;

    document.getElementById("tileRedeemedValue").textContent =
        peso(summary.redeemed.value);

    document.getElementById("tileCancelled").textContent =
        summary.cancelled.count;

    document.getElementById("tileCancelledValue").textContent =
        peso(summary.cancelled.value);

    /* Filters */
    const search =
        document.getElementById("voucherSearch")
            .value.trim().toLowerCase();

    const statusFilter =
        document.getElementById("voucherStatusFilter").value;

    const filtered =
        registry.filter(function(entry){
            const matchesStatus =
                !statusFilter ||
                (entry.status || "active") === statusFilter;

            const matchesSearch =
                !search ||
                String(entry.code || "").toLowerCase().includes(search) ||
                String(entry.client || "").toLowerCase().includes(search);

            return matchesStatus && matchesSearch;
        });

    document.getElementById("voucherShownCount").textContent =
        filtered.length;

    document.getElementById("voucherEmptyState")
        .classList.toggle("d-none", filtered.length > 0);

    const tbody =
        document.getElementById("voucherListBody");

    tbody.innerHTML = "";

    const adminView = isAdmin();

    filtered.forEach(function(entry){
        const tierLabel =
            entry.tier ? ` (${entry.tier})` : "";

        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td class="voucher-code-cell">${escapeHtml(entry.code)}</td>

            <td class="voucher-item-cell">
                ${escapeHtml(entry.name)}${escapeHtml(tierLabel)}
                <small>${escapeHtml(entry.itemType || "")}</small>
            </td>

            <td class="voucher-value-cell">${peso(entry.value)}</td>

            <td>${escapeHtml(entry.client || "—")}</td>

            <td class="voucher-issued-cell">
                ${formatDateTime(entry.issuedAt)}
                <small>${escapeHtml(shortBranch(entry.branch) || "—")}${entry.issuedBy ? " · " + escapeHtml(entry.issuedBy) : ""}</small>
            </td>

            <td>${statusBadge(entry.status)}</td>

            <td class="voucher-issued-cell">
                ${
                    entry.status === "redeemed"
                        ? `
                            ${formatDateTime(entry.redeemedAt)}
                            <small>${escapeHtml(shortBranch(entry.redeemedBranch) || "—")}</small>
                        `
                        : "—"
                }
            </td>

            <td class="voucher-action-cell">
                ${
                    entry.status !== "cancelled"
                        ? '<button type="button" class="btn btn-sm btn-outline-primary print-btn" title="Print / Save as PDF">🖨 Print</button>'
                        : ""
                }
                ${
                    adminView && entry.status === "active"
                        ? '<button type="button" class="btn btn-sm btn-outline-danger void-btn">Void</button>'
                        : ""
                }
                ${
                    adminView && entry.status === "cancelled"
                        ? '<button type="button" class="btn btn-sm btn-outline-success reactivate-btn">Reactivate</button>'
                        : ""
                }
            </td>
        `;

        const printBtn =
            row.querySelector(".print-btn");

        if(printBtn){
            printBtn.addEventListener("click", function(){
                printCrownVoucher(entry);
            });
        }

        const voidBtn =
            row.querySelector(".void-btn");

        if(voidBtn){
            voidBtn.addEventListener("click", function(){
                voidVoucher(entry.code);
            });
        }

        const reactivateBtn =
            row.querySelector(".reactivate-btn");

        if(reactivateBtn){
            reactivateBtn.addEventListener("click", function(){
                reactivateVoucher(entry.code);
            });
        }

        tbody.appendChild(row);
    });
}

async function voidVoucher(code){
    if(!isAdmin()){
        return;
    }

    if(!confirm(
        `Void voucher ${code}?\n\n` +
        "A voided voucher can no longer be used for payment. " +
        "Use this for vouchers that were generated but never paid for."
    )){
        return;
    }

    const outcome =
        await transactionalUpdateVoucherRegistry(function(current){
            const entry =
                current.find(function(item){
                    return item.code === code;
                });

            if(!entry || entry.status === "redeemed"){
                return null;
            }

            entry.status = "cancelled";

            return current;
        });

    if(outcome.status === "conflict"){
        alert("This voucher can no longer be voided — it may have just been redeemed elsewhere.");
    }else if(outcome.status !== "ok"){
        /* Offline/unreachable/chunked — fall back to the old non-atomic
           local save rather than fully blocking an Admin who's
           genuinely offline. Reintroduces the race for just this
           action, same as before this fix existed. */
        const registry = getRegistry();

        const entry =
            registry.find(function(item){
                return item.code === code;
            });

        if(!entry || entry.status === "redeemed"){
            alert("This voucher can no longer be voided.");
        }else{
            entry.status = "cancelled";
            saveRegistry(registry);
        }
    }

    renderVoucherList();
}

async function reactivateVoucher(code){
    if(!isAdmin()){
        return;
    }

    const outcome =
        await transactionalUpdateVoucherRegistry(function(current){
            const entry =
                current.find(function(item){
                    return item.code === code;
                });

            if(!entry || entry.status !== "cancelled"){
                return null;
            }

            entry.status = "active";

            return current;
        });

    if(outcome.status === "conflict"){
        alert("This voucher's status already changed — please refresh and try again.");
    }else if(outcome.status !== "ok"){
        const registry = getRegistry();

        const entry =
            registry.find(function(item){
                return item.code === code;
            });

        if(entry && entry.status === "cancelled"){
            entry.status = "active";
            saveRegistry(registry);
        }
    }

    renderVoucherList();
}
