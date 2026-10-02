/* ==========================================================================
   Crown Head Spa — Gift Certificates (Voucher Masterlist, "Gift Certificate" tab)
   Gift certificates are stored in the same registry as vouchers
   (crownVoucherRegistry) with kind: "giftcertificate", so codes stay unique
   across both and the registry's cloud sync / Void / Reactivate / Download
   PDF machinery is shared with list-vouchers.js, which must load first.
   ========================================================================== */

const GC_KIND = "giftcertificate";
const GC_MAX_QUANTITY = 100;

function gcGetCurrentUserAccount(){
    return window.CrownAuth?.getCurrentUser?.()?.account || "";
}

/* "GC-XXXX-XXXX" — same unambiguous alphabet as voucher codes. */
function gcGenerateCode(takenCodes){
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    for(let attempt = 0; attempt < 100; attempt++){
        let body = "";

        for(let i = 0; i < 8; i++){
            body += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }

        const code = "GC-" + body.slice(0, 4) + "-" + body.slice(4);

        if(!takenCodes.has(code)){
            takenCodes.add(code);
            return code;
        }
    }

    const fallback = "GC-" + Date.now().toString(36).toUpperCase();
    takenCodes.add(fallback);
    return fallback;
}

/* Local-date YYYY-MM-DD for an ISO timestamp. */
function gcDayKey(iso){
    if(!iso){
        return "";
    }

    const d = new Date(iso);

    if(isNaN(d.getTime())){
        return "";
    }

    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
}

function gcShowError(message){
    const box = document.getElementById("gcFormError");
    box.textContent = message || "";
    box.classList.toggle("d-none", !message);
}

async function generateGiftCertificates(){
    const amount = Number(document.getElementById("gcAmount").value);
    const quantity = Number(document.getElementById("gcQuantity").value);
    const validity = document.getElementById("gcValidity").value;

    if(![100, 200, 300].includes(amount)){
        return gcShowError("Please select an amount.");
    }

    if(!Number.isInteger(quantity) || quantity < 1 || quantity > GC_MAX_QUANTITY){
        return gcShowError(`Quantity must be a whole number from 1 to ${GC_MAX_QUANTITY}.`);
    }

    if(!validity){
        return gcShowError("Please choose the validity (valid-until) date.");
    }

    /* End of the chosen day, local time. */
    const expires = new Date(validity + "T23:59:59");

    if(isNaN(expires.getTime()) || expires.getTime() < Date.now()){
        return gcShowError("Validity date must be today or later.");
    }

    gcShowError("");

    const button = document.getElementById("gcGenerateBtn");
    button.disabled = true;

    const issuedAt = new Date().toISOString();
    const branch = localStorage.getItem("crownSelectedBranch") || "";
    const createdBy = gcGetCurrentUserAccount();
    let created = [];

    function build(current){
        const taken = new Set(current.map(function(entry){ return entry.code; }));

        created = [];

        for(let i = 0; i < quantity; i++){
            created.push({
                kind: GC_KIND,
                code: gcGenerateCode(taken),
                itemType: "Gift Certificate",
                name: "Gift Certificate",
                tier: "",
                value: amount,
                client: "",
                branch: branch,
                issuedAt: issuedAt,
                expiresAt: expires.toISOString(),
                issuedBy: createdBy,
                status: "active",
                redeemedAt: "",
                redeemedSaleId: "",
                redeemedBranch: ""
            });
        }

        return current.concat(created);
    }

    const outcome = await transactionalUpdateVoucherRegistry(build);

    if(outcome.status !== "ok"){
        /* Offline/unreachable — same non-atomic local fallback as Void. */
        saveRegistry(build(getRegistry()));
    }

    button.disabled = false;
    document.getElementById("gcQuantity").value = 1;

    renderVoucherList();

    if(window.CrownActivityLog?.log){
        try{
            window.CrownActivityLog.log({
                module: "Gift Certificates",
                action: "Generated",
                summary: `${created.length} × ₱${amount} gift certificate(s)`
            });
        }catch(error){}
    }
}

function gcRow(entry, adminView){
    const status = effectiveVoucherStatus(entry);
    const row = document.createElement("tr");

    row.innerHTML = `
        <td class="voucher-code-cell">${escapeHtml(entry.code)}</td>
        <td class="voucher-value-cell">${peso(entry.value)}</td>
        <td class="voucher-issued-cell">${formatDateTime(entry.issuedAt)}
            <small>${escapeHtml(shortBranch(entry.branch) || "—")}</small></td>
        <td>${entry.expiresAt ? escapeHtml(crownVoucherDateLabel(entry.expiresAt)) : "—"}</td>
        <td>${statusBadge(status)}</td>
        <td class="voucher-issued-cell">${
            entry.status === "redeemed"
                ? formatDateTime(entry.redeemedAt) +
                  `<small>${escapeHtml(shortBranch(entry.redeemedBranch) || "—")}</small>`
                : "—"
        }</td>
        <td>${escapeHtml(entry.issuedBy || "—")}</td>
        <td class="voucher-action-cell">
            ${entry.status !== "cancelled"
                ? '<button type="button" class="btn btn-sm btn-outline-primary print-btn">🖼 Download PNG</button>' : ""}
            ${adminView && entry.status === "active"
                ? '<button type="button" class="btn btn-sm btn-outline-danger void-btn">Void</button>' : ""}
            ${adminView && entry.status === "cancelled"
                ? '<button type="button" class="btn btn-sm btn-outline-success reactivate-btn">Reactivate</button>' : ""}
        </td>
    `;

    row.querySelector(".print-btn")?.addEventListener("click", function(){
        downloadCrownGiftCertificatePng(entry);
    });
    row.querySelector(".void-btn")?.addEventListener("click", function(){
        voidVoucher(entry.code);
    });
    row.querySelector(".reactivate-btn")?.addEventListener("click", function(){
        reactivateVoucher(entry.code);
    });

    return row;
}

window.renderGiftCertificateLists = function(){
    const from = document.getElementById("gcFromDate").value;
    const to = document.getElementById("gcToDate").value;
    const adminView = isAdmin();

    const all = getRegistry()
        .filter(function(entry){ return entry.kind === GC_KIND; })
        .filter(function(entry){
            const day = gcDayKey(entry.issuedAt);
            return (!from || day >= from) && (!to || day <= to);
        })
        .sort(function(a, b){
            return String(b.issuedAt || "").localeCompare(String(a.issuedAt || ""));
        });

    const issued = all.filter(function(entry){ return entry.status !== "redeemed"; });
    const used = all.filter(function(entry){ return entry.status === "redeemed"; });

    const body = document.getElementById("gcListBody");
    const usedBody = document.getElementById("gcUsedBody");
    body.innerHTML = "";
    usedBody.innerHTML = "";

    issued.forEach(function(entry){ body.appendChild(gcRow(entry, adminView)); });
    used.forEach(function(entry){ usedBody.appendChild(gcRow(entry, adminView)); });

    document.getElementById("gcShownCount").textContent = issued.length;
    document.getElementById("gcUsedCount").textContent = used.length;
    document.getElementById("gcEmptyState").classList.toggle("d-none", issued.length > 0);
    document.getElementById("gcUsedEmptyState").classList.toggle("d-none", used.length > 0);
};

function gcSwitchTab(tab){
    const gift = tab === "gift";

    document.getElementById("giftPane").classList.toggle("d-none", !gift);
    document.querySelectorAll('[data-pane="voucher"]').forEach(function(el){
        el.classList.toggle("d-none", gift);
    });
    document.getElementById("tabVoucherBtn").classList.toggle("active", !gift);
    document.getElementById("tabGiftBtn").classList.toggle("active", gift);

    try{ sessionStorage.setItem("crownVoucherPageTab", tab); }catch(error){}
}

document.addEventListener("DOMContentLoaded", function(){
    if(!document.getElementById("giftPane")){
        return;
    }

    const today = gcDayKey(new Date().toISOString());
    document.getElementById("gcValidity").min = today;

    document.getElementById("tabVoucherBtn").addEventListener("click", function(){ gcSwitchTab("voucher"); });
    document.getElementById("tabGiftBtn").addEventListener("click", function(){ gcSwitchTab("gift"); });
    document.getElementById("gcGenerateBtn").addEventListener("click", generateGiftCertificates);

    ["gcFromDate", "gcToDate"].forEach(function(id){
        document.getElementById(id).addEventListener("change", window.renderGiftCertificateLists);
    });

    document.getElementById("gcClearDates").addEventListener("click", function(){
        document.getElementById("gcFromDate").value = "";
        document.getElementById("gcToDate").value = "";
        window.renderGiftCertificateLists();
    });

    document.getElementById("gcUsedToggle").addEventListener("click", function(){
        const open = this.getAttribute("aria-expanded") !== "true";
        this.setAttribute("aria-expanded", String(open));
        document.getElementById("gcUsedWrap").classList.toggle("d-none", !open);
    });

    let startTab = "voucher";
    try{ startTab = sessionStorage.getItem("crownVoucherPageTab") || "voucher"; }catch(error){}
    gcSwitchTab(startTab);

    window.renderGiftCertificateLists();
});
