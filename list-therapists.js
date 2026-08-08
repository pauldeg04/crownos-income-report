const THERAPISTS_STORAGE_KEY = "crownTherapistMasterList";
const BRANCH_STORAGE_KEY = "crownBranchMasterList";
const USER_ACCOUNTS_STORAGE_KEY = "crownUserAccounts";
const DAILY_SALES_STORAGE_PREFIX = "crownDailySales_";

const DEFAULT_THERAPISTS = [
    "Mr. Paui",
    "Ms. Bevs",
    "Ms. Anne",
    "Ms. Daisy",
    "Ms. JC",
    "Ms. Lanie",
    "Ms. Mariz",
    "Ms. Dang"
];

let therapists = [];
let editingTherapistId = null;

document.addEventListener("DOMContentLoaded", function(){
    loadTherapists();

    if(localStorage.getItem(THERAPISTS_STORAGE_KEY) === null){
        seedDefaultTherapists();
    }else{
        migrateExistingTherapists();
    }

    renderTherapists();
    attachEvents();
});

function attachEvents(){
    document
        .getElementById("addTherapistBtn")
        .addEventListener("click", openAddModal);

    document
        .getElementById("closeModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("cancelModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("saveTherapistBtn")
        .addEventListener("click", saveTherapist);

    document
        .getElementById("therapistModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeModal();
            }
        });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeModal();
        }

        if(
            event.key === "Enter" &&
            !document
                .getElementById("therapistModalBackdrop")
                .classList.contains("d-none")
        ){
            saveTherapist();
        }
    });
}

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

function getBranches(){
    try{
        const saved =
            localStorage.getItem(BRANCH_STORAGE_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        return parsed.map(function(branch){
            return typeof branch === "string"
                ? {
                    id: createId(),
                    name: branch
                }
                : {
                    id: branch.id || createId(),
                    name: branch.name || ""
                };
        }).filter(function(branch){
            return branch.name;
        });
    }catch(error){
        console.error("Unable to load branches:", error);
        return [];
    }
}

function getAllBranchNames(){
    return getBranches().map(function(branch){
        return branch.name;
    });
}

function loadUserAccounts(){
    try{
        const raw =
            localStorage.getItem(USER_ACCOUNTS_STORAGE_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed)
            ? parsed
            : [];
    }catch(error){
        console.error("Unable to load user accounts:", error);
        return [];
    }
}

/* Any active, non-Admin account may be linked to a therapist — not just
   Therapist-role accounts — so Receptionist/Marketing Agent staff who also
   perform services and earn commission can have it flow into their own
   Payroll via the same user.therapistName link. */
function getLinkableUserAccounts(){
    return loadUserAccounts().filter(function(user){
        return user.role !== "Admin";
    });
}

/* This is the single source of truth for the Therapist <-> User Account
   link: user.therapistName (string) on the account, matched against this
   therapist's name. Renaming a therapist here keeps a linked account's
   Therapist Sales self-view pointed at the same history; picking a
   different linked account releases the previous one so only one account
   is ever linked to a given therapist name at a time. */
function syncLinkedUserAccount(oldName, newName, linkedUserAccountId){
    const users =
        loadUserAccounts();

    if(users.length === 0){
        return;
    }

    if(oldName && oldName !== newName){
        users.forEach(function(user){
            if(user.therapistName === oldName){
                user.therapistName = newName;
            }
        });
    }

    users.forEach(function(user){
        if(
            user.therapistName === newName &&
            user.id !== linkedUserAccountId
        ){
            user.therapistName = "";
        }
    });

    if(linkedUserAccountId){
        const linkedUser =
            users.find(function(user){
                return user.id === linkedUserAccountId;
            });

        if(linkedUser){
            linkedUser.therapistName = newName;
        }
    }

    localStorage.setItem(
        USER_ACCOUNTS_STORAGE_KEY,
        JSON.stringify(users)
    );
}

/* Every saved Daily Income sale stores the therapist as a plain name
   string at save time (not a reference to this list) — script.js reads
   it straight off the therapist <select>'s value. Renaming a therapist
   here would otherwise strand every past sale under the old name, so
   reports/commission that filter by the current name (therapist-sales.js,
   payroll.js's getDayCommission) would stop finding that history. Walks
   every crownDailySales_* key (all branches, all dates) and rewrites the
   name everywhere it can appear on a sale: the principal's therapist,
   each companion's therapist, and any item-level therapist override. */
function renameTherapistInSalesRecords(oldName, newName){
    if(!oldName || oldName === newName){
        return;
    }

    for(let index = 0; index < localStorage.length; index++){
        const key = localStorage.key(index);

        if(!key || !key.startsWith(DAILY_SALES_STORAGE_PREFIX)){
            continue;
        }

        let record;

        try{
            record = JSON.parse(localStorage.getItem(key));
        }catch(error){
            continue;
        }

        const rows =
            Array.isArray(record?.rows) ? record.rows : null;

        if(!rows){
            continue;
        }

        let changed = false;

        rows.forEach(function(sale){
            if(sale.therapist === oldName){
                sale.therapist = newName;
                changed = true;
            }

            (Array.isArray(sale.services) ? sale.services : [])
                .forEach(function(item){
                    if(item.therapist === oldName){
                        item.therapist = newName;
                        changed = true;
                    }
                });

            (Array.isArray(sale.companions) ? sale.companions : [])
                .forEach(function(companion){
                    if(companion.therapist === oldName){
                        companion.therapist = newName;
                        changed = true;
                    }

                    (Array.isArray(companion.items) ? companion.items : [])
                        .forEach(function(item){
                            if(item.therapist === oldName){
                                item.therapist = newName;
                                changed = true;
                            }
                        });
                });
        });

        if(changed){
            localStorage.setItem(key, JSON.stringify(record));
        }
    }
}

function getLinkedUserAccount(therapistName){
    if(!therapistName){
        return null;
    }

    return getLinkableUserAccounts().find(function(user){
        return user.therapistName === therapistName;
    }) || null;
}

function renderLinkedUserAccountOptions(selectedTherapistName = ""){
    const select =
        document.getElementById("linkedUserAccountInput");

    if(!select){
        return;
    }

    const users =
        getLinkableUserAccounts();

    const availableUsers =
        users.filter(function(user){
            const isCurrentLink =
                Boolean(selectedTherapistName) &&
                user.therapistName === selectedTherapistName;

            const isUnlinked =
                !user.therapistName;

            return (
                isCurrentLink ||
                (isUnlinked && user.status === "Active")
            );
        });

    select.innerHTML =
        '<option value="">No Linked Account</option>' +
        availableUsers.map(function(user){
            const isCurrentLink =
                Boolean(selectedTherapistName) &&
                user.therapistName === selectedTherapistName;

            return `
                <option
                    value="${escapeHtml(user.id)}"
                    ${isCurrentLink ? "selected" : ""}
                >
                    ${escapeHtml(user.nickname ? `${user.nickname} (${user.account})` : user.account)} — ${escapeHtml(user.role)}${user.status !== "Active" ? " (Inactive)" : ""}
                </option>
            `;
        }).join("");
}

function seedDefaultTherapists(){
    const allBranches = getAllBranchNames();

    therapists = DEFAULT_THERAPISTS.map(function(name){
        return {
            id: createId(),
            name: name,
            branches: allBranches.slice(),
            status: "Active"
        };
    });

    saveTherapistsToStorage();
}

function migrateExistingTherapists(){
    const allBranches = getAllBranchNames();
    let changed = false;

    therapists = therapists.map(function(therapist){
        if(typeof therapist === "string"){
            changed = true;

            return {
                id: createId(),
                name: therapist,
                branches: allBranches.slice(),
                status: "Active"
            };
        }

        const migrated = {
            id: therapist.id || createId(),
            name: therapist.name || "",
            branches:
                Array.isArray(therapist.branches)
                    ? therapist.branches
                    : allBranches.slice(),
            status: therapist.status || "Active"
        };

        if(
            !therapist.id ||
            !Array.isArray(therapist.branches) ||
            !therapist.status
        ){
            changed = true;
        }

        return migrated;
    });

    if(changed){
        saveTherapistsToStorage();
    }
}

function loadTherapists(){
    try{
        const saved =
            localStorage.getItem(THERAPISTS_STORAGE_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        therapists =
            Array.isArray(parsed)
                ? parsed
                : [];
    }catch(error){
        console.error("Unable to load therapists:", error);
        therapists = [];

        alert(
            "The saved therapist list could not be loaded."
        );
    }
}

function saveTherapistsToStorage(){
    try{
        localStorage.setItem(
            THERAPISTS_STORAGE_KEY,
            JSON.stringify(therapists)
        );
    }catch(error){
        console.error("Unable to save therapists:", error);

        alert(
            "Unable to save the therapist list."
        );
    }
}

function renderTherapists(){
    const tbody =
        document.getElementById("therapistsBody");

    tbody.innerHTML = "";

    therapists.forEach(function(therapist, index){
        const row =
            document.createElement("tr");

        row.className = "saved-row";

        const branchBadges =
            therapist.branches.length
                ? therapist.branches.map(function(branch){
                    return `
                        <span class="branch-assignment-badge">
                            ${escapeHtml(branch)}
                        </span>
                    `;
                }).join("")
                : `
                    <span class="no-branch-badge">
                        No Branch Assigned
                    </span>
                `;

        row.innerHTML = `
            <td>
                ${index + 1}
            </td>

            <td>
                <span class="saved-therapist-name">
                    ${escapeHtml(therapist.name)}
                </span>

                ${
                    getLinkedUserAccount(therapist.name)
                        ? `<small class="linked-account-label">Linked: ${escapeHtml(getLinkedUserAccount(therapist.name).nickname || getLinkedUserAccount(therapist.name).account)}</small>`
                        : ""
                }
            </td>

            <td>
                <div class="branch-badge-list">
                    ${branchBadges}
                </div>
            </td>

            <td>
                <span class="therapist-status status-${statusClass(therapist.status)}">
                    ${escapeHtml(therapist.status)}
                </span>
            </td>

            <td>
                <div class="action-buttons">

                    <button
                        type="button"
                        class="btn btn-sm btn-warning edit-btn"
                    >
                        Edit
                    </button>

                    <button
                        type="button"
                        class="btn btn-sm btn-danger delete-btn"
                    >
                        Delete
                    </button>

                </div>
            </td>
        `;

        row
            .querySelector(".edit-btn")
            .addEventListener("click", function(){
                openEditModal(therapist.id);
            });

        row
            .querySelector(".delete-btn")
            .addEventListener("click", function(){
                deleteTherapist(therapist.id);
            });

        tbody.appendChild(row);
    });

    document.getElementById("therapistCount").textContent =
        therapists.length;
}

function statusClass(status){
    return String(status || "")
        .toLowerCase()
        .replaceAll(" ", "-");
}

function renderBranchCheckboxes(selectedBranches = []){
    const container =
        document.getElementById("branchCheckboxList");

    const branches = getBranches();

    container.innerHTML = "";

    if(branches.length === 0){
        container.innerHTML = `
            <div class="no-branches-message">
                No branches found. Add a branch first in List of Branches.
            </div>
        `;

        return;
    }

    branches.forEach(function(branch, index){
        const wrapper =
            document.createElement("label");

        wrapper.className = "branch-checkbox-item";

        const checkboxId =
            `branchCheck_${index}`;

        wrapper.innerHTML = `
            <input
                type="checkbox"
                class="form-check-input branch-checkbox"
                id="${checkboxId}"
                value="${escapeHtml(branch.name)}"
                ${
                    selectedBranches.includes(branch.name)
                        ? "checked"
                        : ""
                }
            >

            <span>
                ${escapeHtml(branch.name)}
            </span>
        `;

        container.appendChild(wrapper);
    });
}

function getSelectedBranches(){
    return [
        ...document.querySelectorAll(
            ".branch-checkbox:checked"
        )
    ].map(function(checkbox){
        return checkbox.value;
    });
}

function openAddModal(){
    editingTherapistId = null;

    document.getElementById("modalModeLabel").textContent =
        "New Therapist";

    document.getElementById("modalTitle").textContent =
        "Add Therapist";

    document.getElementById("therapistNameInput").value =
        "";

    document.getElementById("therapistStatusInput").value =
        "Active";

    renderBranchCheckboxes([]);
    renderLinkedUserAccountOptions("");

    document.getElementById("saveTherapistBtn").textContent =
        "Save Therapist";

    showModal();
}

function openEditModal(therapistId){
    const therapist =
        therapists.find(function(item){
            return item.id === therapistId;
        });

    if(!therapist){
        return;
    }

    editingTherapistId = therapist.id;

    document.getElementById("modalModeLabel").textContent =
        "Edit Therapist";

    document.getElementById("modalTitle").textContent =
        "Update Therapist";

    document.getElementById("therapistNameInput").value =
        therapist.name || "";

    document.getElementById("therapistStatusInput").value =
        therapist.status || "Active";

    renderBranchCheckboxes(
        Array.isArray(therapist.branches)
            ? therapist.branches
            : []
    );

    renderLinkedUserAccountOptions(therapist.name);

    document.getElementById("saveTherapistBtn").textContent =
        "Update Therapist";

    showModal();
}

function showModal(){
    document
        .getElementById("therapistModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");

    setTimeout(function(){
        document
            .getElementById("therapistNameInput")
            .focus();
    }, 50);
}

function closeModal(){
    document
        .getElementById("therapistModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    editingTherapistId = null;
}

function saveTherapist(){
    const name =
        document
            .getElementById("therapistNameInput")
            .value
            .trim();

    const status =
        document
            .getElementById("therapistStatusInput")
            .value;

    const assignedBranches =
        getSelectedBranches();

    const linkedUserAccountId =
        document
            .getElementById("linkedUserAccountInput")
            .value;

    if(!name){
        alert("Please enter a therapist name.");
        return;
    }

    if(assignedBranches.length === 0){
        alert("Please assign at least one branch.");
        return;
    }

    const duplicate =
        therapists.some(function(therapist){
            return (
                therapist.id !== editingTherapistId &&
                therapist.name.toLowerCase() ===
                    name.toLowerCase()
            );
        });

    if(duplicate){
        alert(
            "Another therapist with the same name already exists."
        );

        return;
    }

    let oldName = null;

    if(editingTherapistId){
        const therapist =
            therapists.find(function(item){
                return item.id === editingTherapistId;
            });

        if(!therapist){
            return;
        }

        oldName = therapist.name;

        therapist.name = name;
        therapist.branches = assignedBranches;
        therapist.status = status;
    }else{
        therapists.push({
            id: createId(),
            name: name,
            branches: assignedBranches,
            status: status
        });
    }

    saveTherapistsToStorage();

    syncLinkedUserAccount(
        oldName,
        name,
        linkedUserAccountId
    );

    renameTherapistInSalesRecords(oldName, name);

    renderTherapists();
    closeModal();
}

/* Schedules/sales are matched by the therapist's NAME (a plain string
   field on each row), the same way scheduling.js/payroll.js/
   therapist-sales.js already reference therapists — there's no ID link
   to follow. Mirrors list-branches.js's branchHasRelatedRecords(): a
   simple existence check across every crownSchedule_ / crownDailySales_
   key, not an exhaustive deep scan (e.g. a companion's own therapist
   nested inside a sale row's companions array isn't checked — same
   level of rigor as the branch guard this is modeled on). Without this,
   deleting a therapist with past bookings/sales left scheduling.js and
   payroll.js holding a name with nothing behind it (renders as
   "Unknown" or breaks whatever assumed the therapist list still had
   that entry). */
function therapistHasRelatedRecords(therapistName){
    const prefixes = ["crownDailySales_", "crownSchedule_"];

    for(let index = 0; index < localStorage.length; index++){
        const key = localStorage.key(index) || "";

        if(!prefixes.some(function(prefix){
            return key.startsWith(prefix);
        })){
            continue;
        }

        try{
            const parsed =
                JSON.parse(localStorage.getItem(key) || "null");

            const rows =
                Array.isArray(parsed)
                    ? parsed
                    : (Array.isArray(parsed?.rows) ? parsed.rows : []);

            if(rows.some(function(row){
                return row?.therapist === therapistName;
            })){
                return true;
            }
        }catch(error){
            /* Malformed data shouldn't block deletion on its own. */
        }
    }

    return false;
}

function deleteTherapist(therapistId){
    const therapist =
        therapists.find(function(item){
            return item.id === therapistId;
        });

    if(!therapist){
        return;
    }

    if(therapistHasRelatedRecords(therapist.name)){
        alert(
            "This therapist still has saved schedules or sales. Deactivate the therapist instead of deleting so historical records keep showing their name correctly."
        );

        return;
    }

    if(
        !confirm(
            `Delete "${therapist.name}" from the therapist list?`
        )
    ){
        return;
    }

    therapists =
        therapists.filter(function(item){
            return item.id !== therapistId;
        });

    saveTherapistsToStorage();
    renderTherapists();
}
