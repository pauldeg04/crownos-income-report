/* VIP Point System: ₱1 spent earns 1 point (so ₱500 = 500 points);
   100 points redeem for ₱1 credit on a future visit. */
const VIP_POINTS_PER_PESO = 1;
const VIP_POINTS_PER_PESO_CREDIT = 100;

function computeEarnedPoints(amount){
    return Math.floor(Math.max(0, Number(amount) || 0) * VIP_POINTS_PER_PESO);
}

const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SELECTED_BRANCH_KEY = "crownSelectedBranch";
const SALES_PREFIX = "crownDailySales_";

let clients = [];
let editingClientId = null;
let viewingClientId = null;
let activeVipFilter = "Yes";

/* Therapist accounts can open this page (to fill in Forms on the Client
   Card) but must not manage client records — only Admin, Executive
   Assistant and Receptionist can add/edit/delete/import clients. */
function isTherapistOnlyUser(){
    const user = window.CrownAuth?.getCurrentUser?.();
    const role = window.CrownAuth?.getEffectiveRole?.(user) || user?.role;

    return role === "Therapist";
}

function applyRoleRestrictions(){
    if(!isTherapistOnlyUser()){
        return;
    }

    ["openAddClientBtn"].forEach(function(id){
        const el = document.getElementById(id);

        if(el){
            el.classList.add("d-none");
        }
    });
}

document.addEventListener("DOMContentLoaded", async function(){
    await loadClients();
    loadBranchOptions();
    applyRoleRestrictions();
    renderClients();

    document
        .getElementById("openAddClientBtn")
        .addEventListener("click", openAddClientModal);

    document
        .getElementById("closeAddClientBtn")
        .addEventListener("click", closeAddClientModal);

    document
        .getElementById("cancelAddClientBtn")
        .addEventListener("click", closeAddClientModal);

    document
        .getElementById("saveClientBtn")
        .addEventListener("click", saveClient);

    document
        .getElementById("vipStatus")
        .addEventListener("change", function(){
            toggleVipPointsWrapper("vipPointsWrapper", this.value === "Yes");
        });

    document
        .getElementById("editVipStatus")
        .addEventListener("change", function(){
            toggleVipPointsWrapper("editVipPointsWrapper", this.value === "Yes");
        });

    document
        .getElementById("closeViewClientBtn")
        .addEventListener("click", closeViewClientModal);

    document
        .getElementById("closeViewClientFooterBtn")
        .addEventListener("click", closeViewClientModal);

    document
        .getElementById("closeEditClientBtn")
        .addEventListener("click", closeEditClientModal);

    document
        .getElementById("cancelEditClientBtn")
        .addEventListener("click", closeEditClientModal);

    document
        .getElementById("updateClientBtn")
        .addEventListener("click", updateClient);

    document
        .getElementById("deleteClientBtn")
        .addEventListener("click", function(){
            deleteClient(editingClientId);
        });

    document
        .getElementById("searchClient")
        .addEventListener("input", renderClients);

    [
        document.getElementById("vipTabBtn"),
        document.getElementById("nonVipTabBtn")
    ].forEach(function(tabBtn){
        tabBtn.addEventListener("click", function(){
            activeVipFilter = tabBtn.dataset.vip;

            document
                .querySelectorAll(".client-vip-tab")
                .forEach(function(btn){
                    btn.classList.toggle("active", btn === tabBtn);
                });

            renderClients();
        });
    });

    [
        "addClientBackdrop",
        "viewClientBackdrop",
        "editClientBackdrop"
    ].forEach(function(id){
        document.getElementById(id).addEventListener("click", function(event){
            if(event.target === this){
                this.classList.add("d-none");
            }
        });
    });
});

function createId(){
    return Date.now().toString() +
        Math.random().toString(16).slice(2);
}

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

/* Older client records only have a single "name" field (pre this-update).
   New records store lastName/firstName/middleInitial separately; this
   composes the display/matching name from whichever shape is present. */
function getClientDisplayName(client){
    if(client.lastName || client.firstName){
        const middle =
            String(client.middleInitial || "").trim().replace(/\.+$/, "");

        return [
            client.firstName || "",
            middle ? middle + "." : "",
            client.lastName || ""
        ].filter(Boolean).join(" ").trim();
    }

    return client.name || "";
}

/* Used everywhere getClientDisplayName() is compared for a duplicate
   match — collapses internal whitespace in addition to lowercasing, so
   "Mary  Ann" (double space, e.g. from a phone keyboard) and "Mary Ann"
   (single space) are recognized as the same person instead of quietly
   creating a second client record. */
function normalizeNameForCompare(name){
    return String(name || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/* Best-effort split of a legacy single-field name into last/first, used
   only to prefill the Edit modal for records saved before this update. */
function splitLegacyName(name){
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);

    if(parts.length < 2){
        return { firstName: parts[0] || "", lastName: "" };
    }

    return {
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1]
    };
}

/* VIP Points only means anything for a VIP client, so the field stays
   hidden on the Add/Edit forms until VIP Status is switched to Yes. */
function toggleVipPointsWrapper(wrapperId, show){
    document.getElementById(wrapperId).classList.toggle("d-none", !show);
}

function digitsOnly(value){
    return String(value || "").replace(/\D/g, "");
}

/* Stores contact numbers as "+63" + 10 digits. Falls back to the old
   "mobile" field (e.g. "09XXXXXXXXX") for records saved before this
   field existed, converting the leading 0 to the +63 prefix. */
function formatContactNumber(client){
    if(client.contactNumber){
        return client.contactNumber;
    }

    const legacyDigits = digitsOnly(client.mobile);

    if(!legacyDigits){
        return "—";
    }

    return "+63" + legacyDigits.replace(/^0/, "");
}

function formatDate(dateValue){
    if(!dateValue){
        return "—";
    }

    return new Date(dateValue + "T00:00:00").toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

async function loadClients(){
    try{
        clients = await window.CrownClientStore.getAll();
    }catch(error){
        console.error("Unable to load clients:", error);
        clients = [];
        alert("The saved client database could not be loaded.");
    }
}

/* Fire-and-forget, same as everywhere else in the app that saves to the
   cloud mirror (e.g. resyncLocalSalesRowsToCloud in script.js) — callers
   already update the in-memory `clients` array and re-render from that
   before calling this, so nothing here needs to be awaited. */
function saveClientsToStorage(){
    window.CrownClientStore.saveAll(clients).catch(function(error){
        console.error("Unable to save clients:", error);
        alert("Unable to save the client database.");
    });
}

function getBranchList(){
    try{
        const saved = localStorage.getItem(BRANCH_MASTER_KEY);
        const parsed = saved ? JSON.parse(saved) : [];

        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load branches:", error);
        return [];
    }
}

function loadBranchOptions(){
    [
        "homeBranch",
        "editHomeBranch"
    ].forEach(function(selectId){
        const select = document.getElementById(selectId);
        const branches = getBranchList();

        select.innerHTML = '<option value="">Select Branch</option>';

        branches.forEach(function(branch){
            const option = document.createElement("option");
            option.value = branch.name;
            option.textContent = branch.name;
            select.appendChild(option);
        });
    });
}

function renderBirthdayClients(){
    const tbody = document.getElementById("birthdayClientsBody");
    const emptyState = document.getElementById("birthdayEmptyState");

    if(!tbody){
        return;
    }

    tbody.innerHTML = "";

    const currentMonth = new Date().getMonth();

    const celebrants = clients.filter(function(client){
        if(!client.birthday){
            return false;
        }

        const birthMonth =
            new Date(client.birthday + "T00:00:00").getMonth();

        return birthMonth === currentMonth;
    });

    celebrants.sort(function(a, b){
        const dayA = new Date(a.birthday + "T00:00:00").getDate();
        const dayB = new Date(b.birthday + "T00:00:00").getDate();

        return dayA - dayB;
    });

    celebrants.forEach(function(client){
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHtml(getClientDisplayName(client))}</td>
            <td>${formatDate(client.birthday)}</td>
            <td>${client.contactNumber ? escapeHtml(client.contactNumber) : "—"}</td>
        `;

        tbody.appendChild(row);
    });

    emptyState.classList.toggle("d-none", celebrants.length > 0);
}

function renderClients(){
    const tbody = document.getElementById("clientsBody");
    const emptyState = document.getElementById("emptyState");
    const searchValue =
        document.getElementById("searchClient").value
            .trim()
            .toLowerCase();

    tbody.innerHTML = "";

    document.getElementById("vipTabCount").textContent =
        clients.filter(function(client){ return client.vip === "Yes"; }).length;

    document.getElementById("nonVipTabCount").textContent =
        clients.filter(function(client){ return client.vip !== "Yes"; }).length;

    const filtered = clients.filter(function(client){
        const matchesVip =
            activeVipFilter === "Yes"
                ? client.vip === "Yes"
                : client.vip !== "Yes";

        if(!matchesVip){
            return false;
        }

        const searchableText = [
            getClientDisplayName(client),
            client.contactNumber,
            client.mobile,
            client.email,
            client.loyaltyCardNumber,
            client.sex,
            client.branch,
            client.vip,
            client.notes,
            client.lastVisit,
            client.clientRole,
            (client.principalClients || []).join(" ")
        ].join(" ").toLowerCase();

        return searchableText.includes(searchValue);
    });

    filtered
        .sort(function(a, b){
            return getClientDisplayName(a).localeCompare(getClientDisplayName(b));
        })
        .forEach(function(client, index){
            const row = document.createElement("tr");
            const isCompanion =
                client.clientRole === "Companion";

            if(isCompanion){
                row.classList.add("companion-client-row");
            }

            const principalNames =
                Array.isArray(client.principalClients)
                    ? client.principalClients.filter(Boolean)
                    : [];

            row.innerHTML = `
                <td>${index + 1}</td>

                <td>
                    <div class="client-name-stack">
                        <strong>${escapeHtml(getClientDisplayName(client))}</strong>

                        ${
                            isCompanion
                                ? `
                                    <span class="companion-client-badge">
                                        Companion
                                    </span>
                                  `
                                : ""
                        }

                        ${
                            isCompanion && principalNames.length
                                ? `
                                    <small class="companion-principal-text">
                                        Principal: ${escapeHtml(principalNames.join(", "))}
                                    </small>
                                  `
                                : ""
                        }
                    </div>
                </td>

                <td>
                    <strong>${Number(client.totalVisits) || 0}</strong>
                </td>

                <td>${formatDate(client.lastVisit)}</td>

                <td>
                    <div class="action-buttons">
                        <button type="button" class="btn btn-sm btn-outline-primary view-btn">
                            View
                        </button>

                        ${
                            isTherapistOnlyUser()
                                ? ""
                                : `
                                    <button type="button" class="btn btn-sm btn-warning edit-btn">
                                        Edit
                                    </button>
                                  `
                        }
                    </div>
                </td>
            `;

            row.querySelector(".view-btn").addEventListener("click", function(){
                openViewClientModal(client.id);
            });

            const editBtn = row.querySelector(".edit-btn");

            if(editBtn){
                editBtn.addEventListener("click", function(){
                    openEditClientModal(client.id);
                });
            }

            tbody.appendChild(row);
        });

    document.getElementById("clientCount").textContent = clients.length;

    if(filtered.length === 0){
        emptyState.textContent =
            activeVipFilter === "Yes"
                ? "No VIP clients found."
                : "No Non-VIP clients found.";
        emptyState.classList.remove("d-none");
    }else{
        emptyState.classList.add("d-none");
    }

    renderBirthdayClients();
}

/* ---------- Add Client modal ---------- */

function openAddClientModal(){
    document.getElementById("clientLastName").value = "";
    document.getElementById("clientFirstName").value = "";
    document.getElementById("clientMiddleInitial").value = "";
    document.getElementById("clientSex").value = "";
    document.getElementById("contactNumber").value = "";
    document.getElementById("emailAddress").value = "";
    document.getElementById("birthday").value = "";
    document.getElementById("homeAddress").value = "";

    const selectedBranch =
        localStorage.getItem(SELECTED_BRANCH_KEY) || "";

    document.getElementById("homeBranch").value = selectedBranch;
    document.getElementById("vipStatus").value = "No";
    document.getElementById("vipPoints").value = "0";
    toggleVipPointsWrapper("vipPointsWrapper", false);
    document.getElementById("loyaltyCardNumber").value = "";
    document.getElementById("clientNotes").value = "";

    document.getElementById("addClientBackdrop").classList.remove("d-none");
    document.getElementById("clientLastName").focus();
}

function closeAddClientModal(){
    document.getElementById("addClientBackdrop").classList.add("d-none");
}

function saveClient(){
    const lastName =
        document.getElementById("clientLastName").value.trim();

    const firstName =
        document.getElementById("clientFirstName").value.trim();

    const middleInitial =
        document.getElementById("clientMiddleInitial").value.trim();

    const sex =
        document.getElementById("clientSex").value;

    const contactDigits =
        digitsOnly(document.getElementById("contactNumber").value);

    const email =
        document.getElementById("emailAddress").value.trim();

    const birthday =
        document.getElementById("birthday").value;

    const homeAddress =
        document.getElementById("homeAddress").value.trim();

    const branch =
        document.getElementById("homeBranch").value;

    const vip =
        document.getElementById("vipStatus").value;

    const points =
        vip === "Yes"
            ? Math.max(0, Number(document.getElementById("vipPoints").value) || 0)
            : 0;

    const loyaltyCardNumber =
        document.getElementById("loyaltyCardNumber").value.trim();

    const notes =
        document.getElementById("clientNotes").value.trim();

    if(!lastName || !firstName){
        alert("Please enter the client's last name and first name.");
        document.getElementById(!lastName ? "clientLastName" : "clientFirstName").focus();
        return;
    }

    const name = getClientDisplayName({ firstName, middleInitial, lastName });

    const duplicate = clients.some(function(client){
        return normalizeNameForCompare(getClientDisplayName(client)) === normalizeNameForCompare(name);
    });

    if(duplicate){
        alert("A client with the same name already exists.");
        return;
    }

    clients.push({
        id: createId(),
        name: name,
        lastName: lastName,
        firstName: firstName,
        middleInitial: middleInitial,
        sex: sex,
        contactNumber: contactDigits ? "+63" + contactDigits : "",
        email: email,
        birthday: birthday,
        homeAddress: homeAddress,
        branch: branch,
        vip: vip,
        points: points,
        loyaltyCardNumber: loyaltyCardNumber,
        notes: notes,
        totalVisits: 0,
        lastVisit: "",
        totalSpent: 0,
        clientRole: "Principal",
        principalClients: [],
        salesBranches: [],
        createdAt: new Date().toISOString()
    });

    saveClientsToStorage();
    closeAddClientModal();
    renderClients();

    alert(`"${name}" has been added to the client database.`);
}

/* ---------- View Client modal ---------- */

function normalizeClientName(value){
    return String(value || "").trim();
}

/* Client Database stores aggregates only — visit-level detail is
   read directly from the daily sales records across all branches,
   matching this client either as the principal or as a companion. */
function collectClientVisits(clientName){
    const target =
        normalizeClientName(clientName).toLowerCase();

    if(!target){
        return [];
    }

    const visits = [];

    for(let index = 0; index < localStorage.length; index++){
        const key = localStorage.key(index);

        if(!key || !key.startsWith(SALES_PREFIX)){
            continue;
        }

        let record;

        try{
            record = JSON.parse(localStorage.getItem(key));
        }catch(error){
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

            const itemNames = function(items){
                return (Array.isArray(items) ? items : [])
                    .filter(function(item){
                        return item?.name;
                    })
                    .map(function(item){
                        return item.name;
                    })
                    .join(", ");
            };

            const saleAmount =
                Number.isFinite(Number(sale.netAmount))
                    ? Number(sale.netAmount)
                    : Number(sale.grossAmount) || 0;

            if(
                normalizeClientName(sale.client).toLowerCase() ===
                target
            ){
                visits.push({
                    date: sale.reportDate || record.date || sale.startTime?.slice(0, 10) || "",
                    branch: record.branch || sale.branch || "",
                    items: itemNames(sale.services) || "—",
                    therapist: sale.therapist || "—",
                    payment: sale.payment || (sale.payments?.length ? "Multiple" : "—"),
                    amount: saleAmount,
                    earnedPoints: computeEarnedPoints(saleAmount)
                });
            }

            (Array.isArray(sale.companions) ? sale.companions : [])
                .forEach(function(companion){
                    if(
                        normalizeClientName(companion.name).toLowerCase() !==
                        target
                    ){
                        return;
                    }

                    const companionAmount =
                        (Array.isArray(companion.items) ? companion.items : [])
                            .reduce(function(sum, item){
                                return sum + (Number(item?.amount) || 0);
                            }, 0);

                    visits.push({
                        date: sale.reportDate || record.date || sale.startTime?.slice(0, 10) || "",
                        branch: record.branch || sale.branch || "",
                        items: itemNames(companion.items) || "—",
                        therapist: companion.therapist || "—",
                        payment: "Companion of " + (sale.client || "—"),
                        amount: companionAmount,
                        earnedPoints: computeEarnedPoints(companionAmount)
                    });
                });

            /* Referral: someone else used this client's VIP card for
               their own visit — the card owner still earns points on
               that transaction, per the VIP Point System's referral
               rule. Skipped when the owner is the one who used their
               own card (that's just their own visit above already). */
            if(
                sale.vipCardOwnerName &&
                normalizeClientName(sale.vipCardOwnerName).toLowerCase() === target &&
                normalizeClientName(sale.client).toLowerCase() !== target
            ){
                visits.push({
                    date: sale.reportDate || record.date || sale.startTime?.slice(0, 10) || "",
                    branch: record.branch || sale.branch || "",
                    items: itemNames(sale.services) || "—",
                    therapist: sale.therapist || "—",
                    payment: "VIP Card used by " + (sale.client || "—"),
                    amount: saleAmount,
                    earnedPoints: computeEarnedPoints(saleAmount)
                });
            }
        });
    }

    return visits.sort(function(a, b){
        return String(b.date || "").localeCompare(String(a.date || ""));
    });
}

function openViewClientModal(clientId){
    const client = clients.find(function(item){
        return item.id === clientId;
    });

    if(!client){
        return;
    }

    viewingClientId = client.id;

    document.getElementById("viewClientInfo").innerHTML = `
        <div><span>Client Name</span><strong>${escapeHtml(getClientDisplayName(client))}</strong></div>
        <div><span>Sex</span><strong>${escapeHtml(client.sex || "—")}</strong></div>
        <div><span>Contact Number</span><strong>${escapeHtml(formatContactNumber(client))}</strong></div>
        <div><span>Email Address</span><strong>${escapeHtml(client.email || "—")}</strong></div>
        <div><span>Birthday</span><strong>${formatDate(client.birthday)}</strong></div>
        <div><span>Home Address</span><strong>${escapeHtml(client.homeAddress || "—")}</strong></div>
        <div><span>Home Branch</span><strong>${escapeHtml(client.branch || "—")}</strong></div>
        <div><span>VIP Status</span><strong>${client.vip === "Yes" ? "VIP" : "Non-VIP"}</strong></div>
        <div><span>VIP Points</span><strong>${client.vip === "Yes" ? (Number(client.points) || 0) : "—"}</strong></div>
        <div><span>Loyalty Card Number</span><strong>${escapeHtml(client.loyaltyCardNumber || "—")}</strong></div>
        <div><span>Total Visits</span><strong>${Number(client.totalVisits) || 0}</strong></div>
        <div><span>Last Visit</span><strong>${formatDate(client.lastVisit)}</strong></div>
        <div><span>Total Spent</span><strong>${peso(client.totalSpent)}</strong></div>
        <div class="client-view-notes"><span>Remarks</span><strong>${escapeHtml(client.notes || "—")}</strong></div>
    `;

    renderClientVisitsTable(client);

    document.getElementById("viewClientBackdrop").classList.remove("d-none");
}

/* Rebuilds the Visit History table body for the client currently open in
   the View Client modal — also called by client-forms.js after a form is
   saved, so the new Forms cell reflects the change without a full reopen. */
function renderClientVisitsTable(client){
    const visits =
        collectClientVisits(client.name);

    const tbody =
        document.getElementById("viewClientVisitsBody");

    tbody.innerHTML = visits.map(function(visit){
        const visitKey =
            window.ClientForms
                ? window.ClientForms.buildVisitKey(client, visit)
                : "";

        return `
            <tr>
                <td>${formatDate(visit.date)}</td>
                <td>${escapeHtml(visit.branch)}</td>
                <td class="visit-items-cell">${escapeHtml(visit.items)}</td>
                <td>${escapeHtml(visit.therapist)}</td>
                <td>${escapeHtml(visit.payment)}</td>
                <td class="visit-amount-cell">${peso(visit.amount)}</td>
                <td class="visit-points-cell">${client.vip === "Yes" ? Number(visit.earnedPoints || 0).toLocaleString("en-PH") : "—"}</td>
                <td class="visit-forms-cell">
                    ${
                        window.ClientForms
                            ? window.ClientForms.renderFormsCell(client, visit, visitKey)
                            : "—"
                    }
                </td>
            </tr>
        `;
    }).join("");

    document.getElementById("viewClientVisitsEmpty")
        .classList.toggle("d-none", visits.length > 0);

    if(window.ClientForms){
        window.ClientForms.wireFormsCellButtons(client);
    }
}

function closeViewClientModal(){
    document.getElementById("viewClientBackdrop").classList.add("d-none");
    viewingClientId = null;
}

/* ---------- Edit Client modal ---------- */

function openEditClientModal(clientId){
    const client = clients.find(function(item){
        return item.id === clientId;
    });

    if(!client){
        return;
    }

    editingClientId = client.id;

    const hasSplitName = Boolean(client.lastName || client.firstName);
    const legacy = hasSplitName ? null : splitLegacyName(client.name);

    document.getElementById("editClientLastName").value =
        hasSplitName ? (client.lastName || "") : legacy.lastName;
    document.getElementById("editClientFirstName").value =
        hasSplitName ? (client.firstName || "") : legacy.firstName;
    document.getElementById("editClientMiddleInitial").value = client.middleInitial || "";
    document.getElementById("editClientSex").value = client.sex || "";

    document.getElementById("editContactNumber").value =
        client.contactNumber
            ? digitsOnly(client.contactNumber).replace(/^63/, "")
            : digitsOnly(client.mobile).replace(/^0/, "");

    document.getElementById("editEmailAddress").value = client.email || "";
    document.getElementById("editBirthday").value = client.birthday || "";
    document.getElementById("editHomeAddress").value = client.homeAddress || "";
    document.getElementById("editHomeBranch").value = client.branch || "";
    document.getElementById("editVipStatus").value = client.vip || "No";
    document.getElementById("editVipPoints").value = Number(client.points) || 0;
    toggleVipPointsWrapper("editVipPointsWrapper", client.vip === "Yes");
    document.getElementById("editLoyaltyCardNumber").value = client.loyaltyCardNumber || "";

    document.getElementById("editClientBackdrop").classList.remove("d-none");
}

function closeEditClientModal(){
    document.getElementById("editClientBackdrop").classList.add("d-none");
    editingClientId = null;
}

function updateClient(){
    const client = clients.find(function(item){
        return item.id === editingClientId;
    });

    if(!client){
        return;
    }

    const lastName =
        document.getElementById("editClientLastName").value.trim();

    const firstName =
        document.getElementById("editClientFirstName").value.trim();

    if(!lastName || !firstName){
        alert("Please enter the client's last name and first name.");
        document.getElementById(!lastName ? "editClientLastName" : "editClientFirstName").focus();
        return;
    }

    const middleInitial =
        document.getElementById("editClientMiddleInitial").value.trim();

    const name = getClientDisplayName({ firstName, middleInitial, lastName });

    const duplicate = clients.some(function(item){
        return (
            item.id !== editingClientId &&
            normalizeNameForCompare(getClientDisplayName(item)) === normalizeNameForCompare(name)
        );
    });

    if(duplicate){
        alert("A client with the same name already exists.");
        return;
    }

    const contactDigits =
        digitsOnly(document.getElementById("editContactNumber").value);

    client.name = name;
    client.lastName = lastName;
    client.firstName = firstName;
    client.middleInitial = middleInitial;
    client.sex = document.getElementById("editClientSex").value;
    client.contactNumber = contactDigits ? "+63" + contactDigits : "";
    client.email = document.getElementById("editEmailAddress").value.trim();
    client.birthday = document.getElementById("editBirthday").value;
    client.homeAddress = document.getElementById("editHomeAddress").value.trim();
    client.branch = document.getElementById("editHomeBranch").value;
    client.vip = document.getElementById("editVipStatus").value;

    /* Points stay on the record even if VIP status is toggled off —
       just not shown/used while Non-VIP, so a mistaken toggle doesn't
       wipe an accumulated balance. */
    client.points =
        Math.max(0, Number(document.getElementById("editVipPoints").value) || 0);

    client.loyaltyCardNumber = document.getElementById("editLoyaltyCardNumber").value.trim();

    saveClientsToStorage();
    closeEditClientModal();
    renderClients();

    alert(`"${name}" has been updated.`);
}

function deleteClient(clientId){
    const client = clients.find(function(item){
        return item.id === clientId;
    });

    if(!client){
        return;
    }

    if(!confirm(`Delete "${client.name}" from the client database?`)){
        return;
    }

    clients = clients.filter(function(item){
        return item.id !== clientId;
    });

    saveClientsToStorage();
    closeEditClientModal();
    renderClients();
}

