let editingUserId = null;
let currentLoggedInUser = null;

const AUTO_ALL_BRANCH_ROLES = ["Admin", "Executive Assistant"];

/* Pages that can be individually granted as "Additional Access" beyond a
   role's default. home.html and account-settings.html are always available
   to everyone already, and data-protection.html is intentionally excluded —
   Admin-only, never grantable through this mechanism. */
const EXTRA_ACCESS_PAGES = [
    { href: "index.html", label: "Daily Income Report" },
    { href: "statistics.html", label: "Statistics" },
    { href: "petty-cash.html", label: "Petty Cash" },
    { href: "therapist-sales.html", label: "Therapist Sales" },
    { href: "monthly-report.html", label: "Monthly Summary" },
    { href: "expenses-report.html", label: "Expenses Report" },
    { href: "clients.html", label: "Client Database" },
    { href: "scheduling.html", label: "Scheduling" },
    { href: "booking-requests.html", label: "Booking Requests" },
    { href: "attendance.html", label: "Attendance" },
    { href: "invoice-report.html", label: "Invoice Report" },
    { href: "list-vouchers.html", label: "List of Vouchers" },
    { href: "list-services.html", label: "List of Services" },
    { href: "list-products.html", label: "List of Products" },
    { href: "list-therapists.html", label: "List of Therapist" },
    { href: "list-branches.html", label: "List of Branches" },
    { href: "inventory-warehouse.html", label: "Inventory - Warehouse" },
    { href: "inventory-branches.html", label: "Inventory - Branches" },
    { href: "inventory-items.html", label: "Inventory - Settings" },
    { href: "marketing-ads-daily.html", label: "Ads Monitoring" },
    { href: "marketing-ads-summary.html", label: "Monitoring Summary" },
    { href: "marketing-daily-report.html", label: "Daily Report" }
];

/* Set as Team Leader auto-grants these on top of the plain Therapist
   default, so a Team Leader doesn't also need someone to manually tick
   them under Additional Access. */
const TEAM_LEADER_AUTO_ACCESS_PAGES = [
    "index.html",
    "statistics.html",
    "scheduling.html"
];

function applyTeamLeaderAutoAccess(){
    if(!document.getElementById("teamLeaderInput").checked){
        return;
    }

    TEAM_LEADER_AUTO_ACCESS_PAGES.forEach(function(href){
        const checkbox =
            document.querySelector(
                `.extra-access-checkbox[value="${href}"]`
            );

        if(checkbox){
            checkbox.checked = true;
        }
    });
}

document.addEventListener("DOMContentLoaded", async function(){
    await CrownAuth.ensureDefaultAdmin();

    currentLoggedInUser =
        CrownAuth.refreshCurrentUser();

    if(!currentLoggedInUser){
        return;
    }

    displayCurrentUser(currentLoggedInUser);
    attachEvents();

    if(currentLoggedInUser.role === "Admin"){
        document
            .getElementById("openCreateUserBtn")
            .classList.remove("d-none");

        document
            .getElementById("adminUserListSection")
            .classList.remove("d-none");

        renderUsers();
    }
});

function attachEvents(){
    document
        .getElementById("openMyAccountBtn")
        .addEventListener("click", openMyAccountModal);

    document
        .getElementById("closeMyAccountModalBtn")
        .addEventListener("click", closeMyAccountModal);

    document
        .getElementById("cancelMyAccountModalBtn")
        .addEventListener("click", closeMyAccountModal);

    document
        .getElementById("changePasswordBtn")
        .addEventListener("click", changeOwnPassword);

    document
        .getElementById("pushNotificationsToggle")
        .addEventListener("change", handlePushNotificationsToggle);

    const openCreateUserBtn =
        document.getElementById("openCreateUserBtn");

    if(openCreateUserBtn){
        openCreateUserBtn.addEventListener(
            "click",
            openCreateUserModal
        );
    }

    document
        .getElementById("closeUserAccountModalBtn")
        .addEventListener("click", closeUserAccountModal);

    document
        .getElementById("cancelUserModalBtn")
        .addEventListener("click", closeUserAccountModal);

    document
        .getElementById("saveUserBtn")
        .addEventListener("click", saveUserAccount);

    document
        .getElementById("compensationScheduleInput")
        .addEventListener(
            "change",
            updateHideFromAdminGroupFieldState
        );

    document
        .getElementById("userRoleInput")
        .addEventListener(
            "change",
            updateBranchAssignmentState
        );

    document
        .getElementById("userRoleInput")
        .addEventListener(
            "change",
            updateLinkedTherapistFieldState
        );

    document
        .getElementById("userRoleInput")
        .addEventListener(
            "change",
            updateSecondaryRoleFieldState
        );

    document
        .getElementById("userRoleInput")
        .addEventListener(
            "change",
            updateTeamLeaderFieldState
        );

    document
        .getElementById("teamLeaderInput")
        .addEventListener(
            "change",
            applyTeamLeaderAutoAccess
        );

    document
        .getElementById("userRoleInput")
        .addEventListener(
            "change",
            updateTlFloaterFieldState
        );

    document
        .getElementById("userRoleInput")
        .addEventListener(
            "change",
            function(){
                renderExtraAccessCheckboxes(
                    getSelectedExtraAccess()
                );
            }
        );

    document
        .getElementById("myAccountModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeMyAccountModal();
            }
        });

    document
        .getElementById("userAccountModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeUserAccountModal();
            }
        });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeMyAccountModal();
            closeUserAccountModal();
        }
    });
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* Used by Payroll (full name) and List of Therapist (nickname);
   falls back gracefully for accounts created before these fields existed. */
function getFullName(user){
    return [user?.firstName, user?.middleName, user?.lastName]
        .map(function(part){ return String(part || "").trim(); })
        .filter(Boolean)
        .join(" ");
}

function displayCurrentUser(user){
    document.getElementById("currentAccount").textContent =
        user.account || "—";

    document.getElementById("currentRole").textContent =
        user.role || "—";

    const branches =
        CrownAuth.getAllowedBranches(user);

    document.getElementById("currentBranches").textContent =
        AUTO_ALL_BRANCH_ROLES.includes(user.role)
            ? "All Branches"
            : (
                branches.length
                    ? branches.join(", ")
                    : "No Branch Assigned"
            );
}

function openMyAccountModal(){
    clearPasswordFields();
    refreshPushNotificationsToggle();

    document
        .getElementById("myAccountModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function refreshPushNotificationsToggle(){
    const toggle = document.getElementById("pushNotificationsToggle");
    const hint = document.getElementById("pushNotificationsHint");

    if(!window.CrownPush || !CrownPush.isSupported()){
        toggle.checked = false;
        toggle.disabled = true;
        hint.textContent =
            "Not supported on this browser/device.";
        return;
    }

    toggle.disabled = false;
    toggle.checked = CrownPush.isEnabled();
}

async function handlePushNotificationsToggle(event){
    const toggle = event.target;
    const hint = document.getElementById("pushNotificationsHint");

    toggle.disabled = true;

    if(toggle.checked){
        const result = await CrownPush.enable();

        if(!result.ok){
            toggle.checked = false;
            hint.textContent =
                result.reason === "denied"
                    ? "Notifications were blocked — enable them in your browser/phone settings and try again."
                    : "Couldn't enable notifications on this device. Please try again.";
        }else{
            hint.textContent =
                "You'll be notified on this device for new booking requests, schedule assignments, and announcements.";
        }
    }else{
        await CrownPush.disable();
        hint.textContent =
            "Get notified on this device's home screen when there's a new booking request, schedule assignment, or announcement.";
    }

    toggle.disabled = false;
}

function closeMyAccountModal(){
    document
        .getElementById("myAccountModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    clearPasswordFields();
}

function clearPasswordFields(){
    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmNewPassword").value = "";
}

async function changeOwnPassword(){
    const currentUser =
        CrownAuth.getCurrentUser();

    const currentPassword =
        document.getElementById("currentPassword").value;

    const newPassword =
        document.getElementById("newPassword").value;

    const confirmPassword =
        document.getElementById("confirmNewPassword").value;

    if(
        !currentPassword ||
        !newPassword ||
        !confirmPassword
    ){
        alert("Please complete all password fields.");
        return;
    }

    if(newPassword.length < 6){
        alert(
            "The new password must contain at least 6 characters."
        );
        return;
    }

    if(newPassword !== confirmPassword){
        alert(
            "The new password and confirmation do not match."
        );
        return;
    }

    const users =
        CrownAuth.getUsers();

    const user =
        users.find(function(item){
            return item.id === currentUser.id;
        });

    if(!user){
        return;
    }

    const currentHash =
        await CrownAuth.hashPassword(currentPassword);

    if(currentHash !== user.passwordHash){
        alert("The current password is incorrect.");
        return;
    }

    user.passwordHash =
        await CrownAuth.hashPassword(newPassword);

    CrownAuth.saveUsers(users);

    /* Keep the Firebase-side login in step, otherwise this account keeps
       authenticating fine locally but silently stops syncing to the
       cloud from now on (Firebase sign-in would keep failing against the
       old password with no error shown anywhere). */
    await window.CrownCloud?.updateOwnPassword?.(newPassword, currentPassword);

    alert("Your password has been changed successfully.");
    closeMyAccountModal();
}

function openCreateUserModal(){
    editingUserId = null;

    document.getElementById("userModalEyebrow").textContent =
        "Admin Access";

    document.getElementById("userFormTitle").textContent =
        "Create User Account";

    document.getElementById("userAccountInput").value =
        "";

    document.getElementById("userPasswordInput").value =
        "";

    document.getElementById("userPasswordInput").placeholder =
        "Required for new account";

    document.getElementById("userFirstNameInput").value =
        "";

    document.getElementById("userMiddleNameInput").value =
        "";

    document.getElementById("userLastNameInput").value =
        "";

    document.getElementById("userNicknameInput").value =
        "";

    document.getElementById("userEmailInput").value =
        "";

    document.getElementById("userRoleInput").value =
        "";

    document.getElementById("userStatusInput").value =
        "Active";

    document.getElementById("compensationScheduleInput").value =
        "Weekly";

    document.getElementById("hideFromAdminGroupInput").checked =
        false;

    updateHideFromAdminGroupFieldState();

    document.getElementById("secondaryRoleInput").checked =
        false;

    updateSecondaryRoleFieldState();

    document.getElementById("teamLeaderInput").checked =
        false;

    updateTeamLeaderFieldState();

    document.getElementById("tlFloaterInput").checked =
        false;

    updateTlFloaterFieldState();

    renderBranchCheckboxes([]);
    renderLinkedTherapistOptions("");
    updateLinkedTherapistFieldState();
    renderExtraAccessCheckboxes([]);

    document.getElementById("saveUserBtn").textContent =
        "Create Account";

    showUserAccountModal();
}

function openEditUserModal(userId){
    const user =
        CrownAuth.getUsers()
            .find(function(item){
                return item.id === userId;
            });

    if(!user){
        return;
    }

    editingUserId = user.id;

    document.getElementById("userModalEyebrow").textContent =
        "Edit User";

    document.getElementById("userFormTitle").textContent =
        "Edit User Account";

    document.getElementById("userAccountInput").value =
        user.account || "";

    document.getElementById("userPasswordInput").value =
        "";

    document.getElementById("userPasswordInput").placeholder =
        "Leave blank to keep current password";

    document.getElementById("userFirstNameInput").value =
        user.firstName || "";

    document.getElementById("userMiddleNameInput").value =
        user.middleName || "";

    document.getElementById("userLastNameInput").value =
        user.lastName || "";

    document.getElementById("userNicknameInput").value =
        user.nickname || "";

    document.getElementById("userEmailInput").value =
        user.email || "";

    document.getElementById("userRoleInput").value =
        user.role || "";

    document.getElementById("userStatusInput").value =
        user.status || "Active";

    document.getElementById("compensationScheduleInput").value =
        user.compensationSchedule || "Weekly";

    document.getElementById("hideFromAdminGroupInput").checked =
        user.hiddenFromAdminGroup === true;

    document.getElementById("fixedRateInput").checked =
        user.fixedRate === true;

    updateHideFromAdminGroupFieldState();

    renderBranchCheckboxes(
        AUTO_ALL_BRANCH_ROLES.includes(user.role)
            ? CrownAuth.getAllBranchNames()
            : (
                Array.isArray(user.branches)
                    ? user.branches
                    : []
            )
    );

    renderLinkedTherapistOptions(user.therapistName || "");
    updateLinkedTherapistFieldState();

    document.getElementById("secondaryRoleInput").checked =
        user.secondaryRole === "Receptionist";

    updateSecondaryRoleFieldState();

    document.getElementById("teamLeaderInput").checked =
        user.teamLeader === true;

    updateTeamLeaderFieldState();

    document.getElementById("tlFloaterInput").checked =
        user.tlFloater === true;

    updateTlFloaterFieldState();

    renderExtraAccessCheckboxes(
        Array.isArray(user.extraAccess)
            ? user.extraAccess
            : []
    );

    applyTeamLeaderAutoAccess();

    document.getElementById("saveUserBtn").textContent =
        "Update Account";

    showUserAccountModal();
}

function showUserAccountModal(){
    document
        .getElementById("userAccountModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");

    setTimeout(function(){
        document
            .getElementById("userAccountInput")
            .focus();
    }, 50);
}

function closeUserAccountModal(){
    document
        .getElementById("userAccountModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    editingUserId = null;
}

function renderBranchCheckboxes(selectedBranches = []){
    const container =
        document.getElementById("userBranchCheckboxList");

    const branches =
        CrownAuth.getAllBranchNames();

    container.innerHTML = "";

    if(branches.length === 0){
        container.innerHTML = `
            <div class="no-branches-message">
                No branches found. Add a branch first.
            </div>
        `;

        return;
    }

    branches.forEach(function(branch){
        const label =
            document.createElement("label");

        label.className =
            "branch-checkbox-item";

        label.innerHTML = `
            <input
                type="checkbox"
                class="form-check-input user-branch-checkbox"
                value="${escapeHtml(branch)}"
                ${
                    selectedBranches.includes(branch)
                        ? "checked"
                        : ""
                }
            >

            <span>
                ${escapeHtml(branch)}
            </span>
        `;

        container.appendChild(label);
    });

    updateBranchAssignmentState();
}

function updateBranchAssignmentState(){
    const role =
        document.getElementById("userRoleInput").value;

    const checkboxes =
        document.querySelectorAll(
            ".user-branch-checkbox"
        );

    const isAutoAllBranches =
        AUTO_ALL_BRANCH_ROLES.includes(role);

    checkboxes.forEach(function(checkbox){
        checkbox.disabled = isAutoAllBranches;

        if(isAutoAllBranches){
            checkbox.checked = true;
        }
    });
}

function getTherapistMasterList(){
    try{
        const raw =
            localStorage.getItem(
                "crownTherapistMasterList"
            );

        const parsed =
            raw ? JSON.parse(raw) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        return parsed
            .map(function(therapist){
                return typeof therapist === "string"
                    ? therapist
                    : therapist?.name;
            })
            .filter(Boolean);
    }catch(error){
        console.error(
            "Unable to load therapist master list:",
            error
        );

        return [];
    }
}

function renderLinkedTherapistOptions(selectedName = ""){
    const select =
        document.getElementById("linkedTherapistInput");

    if(!select){
        return;
    }

    const names =
        getTherapistMasterList();

    select.innerHTML =
        '<option value="">Select Therapist</option>' +
        names.map(function(name){
            return `
                <option
                    value="${escapeHtml(name)}"
                    ${name === selectedName ? "selected" : ""}
                >
                    ${escapeHtml(name)}
                </option>
            `;
        }).join("");

    if(
        selectedName &&
        !names.includes(selectedName)
    ){
        select.insertAdjacentHTML(
            "beforeend",
            `
                <option value="${escapeHtml(selectedName)}" selected>
                    ${escapeHtml(selectedName)} (Not in Therapist Master List)
                </option>
            `
        );
    }
}

function updateHideFromAdminGroupFieldState(){
    const isBiMonthly =
        document.getElementById("compensationScheduleInput").value ===
        "Bi-Monthly";

    document.getElementById("hideFromAdminGroupField")
        .classList.toggle("d-none", !isBiMonthly);

    document.getElementById("fixedRateField")
        .classList.toggle("d-none", !isBiMonthly);

    if(!isBiMonthly){
        document.getElementById("hideFromAdminGroupInput").checked = false;
        document.getElementById("fixedRateInput").checked = false;
    }
}

function updateLinkedTherapistFieldState(){
    const role =
        document.getElementById("userRoleInput").value;

    const field =
        document.getElementById("linkedTherapistField");

    const select =
        document.getElementById("linkedTherapistInput");

    if(!field || !select){
        return;
    }

    const isTherapistRole =
        role === "Therapist";

    field.classList.toggle(
        "d-none",
        !isTherapistRole
    );

    select.required =
        isTherapistRole;

    if(!isTherapistRole){
        select.value = "";
    }
}

function updateSecondaryRoleFieldState(){
    const role =
        document.getElementById("userRoleInput").value;

    const field =
        document.getElementById("secondaryRoleField");

    const checkbox =
        document.getElementById("secondaryRoleInput");

    if(!field || !checkbox){
        return;
    }

    const isTherapistRole =
        role === "Therapist";

    field.classList.toggle(
        "d-none",
        !isTherapistRole
    );

    if(!isTherapistRole){
        checkbox.checked = false;
    }
}

function updateTeamLeaderFieldState(){
    const role =
        document.getElementById("userRoleInput").value;

    const field =
        document.getElementById("teamLeaderField");

    const checkbox =
        document.getElementById("teamLeaderInput");

    if(!field || !checkbox){
        return;
    }

    const isTherapistRole =
        role === "Therapist";

    field.classList.toggle(
        "d-none",
        !isTherapistRole
    );

    if(!isTherapistRole){
        checkbox.checked = false;
    }
}

/* TL Floater — reserved for an upcoming feature, no behavior wired up
   yet beyond saving the flag. Available on Receptionist and Therapist
   accounts (unlike Team Leader / secondary-role-Receptionist, which are
   Therapist-only). */
function updateTlFloaterFieldState(){
    const role =
        document.getElementById("userRoleInput").value;

    const field =
        document.getElementById("tlFloaterField");

    const checkbox =
        document.getElementById("tlFloaterInput");

    if(!field || !checkbox){
        return;
    }

    const isEligibleRole =
        role === "Therapist" || role === "Receptionist";

    field.classList.toggle(
        "d-none",
        !isEligibleRole
    );

    if(!isEligibleRole){
        checkbox.checked = false;
    }
}

function renderExtraAccessCheckboxes(selectedPages = []){
    const container =
        document.getElementById("extraAccessCheckboxList");

    if(!container){
        return;
    }

    const role =
        document.getElementById("userRoleInput").value;

    const defaultPageAccess =
        CrownAuth.PAGE_ACCESS || {};

    const grantablePages =
        EXTRA_ACCESS_PAGES.filter(function(page){
            const allowedRoles =
                defaultPageAccess[page.href] || [];

            return !allowedRoles.includes(role);
        });

    container.innerHTML = "";

    if(grantablePages.length === 0){
        container.innerHTML = `
            <div class="no-branches-message">
                This Type of User already has access to every available page.
            </div>
        `;

        return;
    }

    grantablePages.forEach(function(page){
        const label =
            document.createElement("label");

        label.className =
            "branch-checkbox-item";

        label.innerHTML = `
            <input
                type="checkbox"
                class="form-check-input extra-access-checkbox"
                value="${escapeHtml(page.href)}"
                ${
                    selectedPages.includes(page.href)
                        ? "checked"
                        : ""
                }
            >

            <span>
                ${escapeHtml(page.label)}
            </span>
        `;

        container.appendChild(label);
    });
}

function getSelectedExtraAccess(){
    return [
        ...document.querySelectorAll(
            ".extra-access-checkbox:checked"
        )
    ].map(function(checkbox){
        return checkbox.value;
    });
}

function getSelectedUserBranches(){
    return [
        ...document.querySelectorAll(
            ".user-branch-checkbox:checked"
        )
    ].map(function(checkbox){
        return checkbox.value;
    });
}

async function saveUserAccount(){
    if(currentLoggedInUser.role !== "Admin"){
        return;
    }

    const account =
        document
            .getElementById("userAccountInput")
            .value
            .trim();

    const password =
        document
            .getElementById("userPasswordInput")
            .value;

    const firstName =
        document
            .getElementById("userFirstNameInput")
            .value
            .trim();

    const middleName =
        document
            .getElementById("userMiddleNameInput")
            .value
            .trim();

    const lastName =
        document
            .getElementById("userLastNameInput")
            .value
            .trim();

    const nickname =
        document
            .getElementById("userNicknameInput")
            .value
            .trim();

    const email =
        document
            .getElementById("userEmailInput")
            .value
            .trim();

    const role =
        document
            .getElementById("userRoleInput")
            .value;

    const status =
        document
            .getElementById("userStatusInput")
            .value;

    const linkedTherapistName =
        document
            .getElementById("linkedTherapistInput")
            .value;

    const secondaryRole =
        role === "Therapist" &&
        document
            .getElementById("secondaryRoleInput")
            .checked
            ? "Receptionist"
            : "";

    const teamLeader =
        role === "Therapist" &&
        document
            .getElementById("teamLeaderInput")
            .checked;

    const tlFloater =
        (role === "Therapist" || role === "Receptionist") &&
        document
            .getElementById("tlFloaterInput")
            .checked;

    const compensationSchedule =
        document
            .getElementById("compensationScheduleInput")
            .value === "Bi-Monthly"
                ? "Bi-Monthly"
                : "Weekly";

    const hiddenFromAdminGroup =
        compensationSchedule === "Bi-Monthly" &&
        document
            .getElementById("hideFromAdminGroupInput")
            .checked;

    const fixedRate =
        compensationSchedule === "Bi-Monthly" &&
        document
            .getElementById("fixedRateInput")
            .checked;

    const extraAccess =
        getSelectedExtraAccess();

    if(!account){
        alert("Please enter a user account.");
        return;
    }

    if(!firstName || !lastName){
        alert("Please enter the First Name and Last Name.");
        return;
    }

    if(!email || !/^\S+@\S+\.\S+$/.test(email)){
        alert("Please enter a valid Email Address — this is where their payroll is sent.");
        return;
    }

    if(!role){
        alert(
            "Please select a Type of User."
        );
        return;
    }

    const branches =
        AUTO_ALL_BRANCH_ROLES.includes(role)
            ? CrownAuth.getAllBranchNames()
            : getSelectedUserBranches();

    if(!editingUserId && password.length < 6){
        alert(
            "Please nominate a password with at least 6 characters."
        );
        return;
    }

    if(
        editingUserId &&
        password &&
        password.length < 6
    ){
        alert(
            "The new password must contain at least 6 characters."
        );
        return;
    }

    if(
        !AUTO_ALL_BRANCH_ROLES.includes(role) &&
        branches.length === 0
    ){
        alert(
            "Please assign at least one branch."
        );
        return;
    }

    if(
        role === "Therapist" &&
        !linkedTherapistName
    ){
        alert(
            "Please select the Linked Therapist for this account."
        );
        return;
    }

    const users =
        CrownAuth.getUsers();

    const duplicate =
        users.some(function(user){
            return (
                user.id !== editingUserId &&
                String(user.account || "").toLowerCase() ===
                account.toLowerCase()
            );
        });

    if(duplicate){
        alert(
            "Another user is already using this account."
        );
        return;
    }

    /* Only one account may be linked to a given therapist name at a time —
       releases any other account previously linked to this Linked
       Therapist, matching the same rule enforced from List of Therapist. */
    if(
        role === "Therapist" &&
        linkedTherapistName
    ){
        users.forEach(function(otherUser){
            if(
                otherUser.id !== editingUserId &&
                otherUser.therapistName === linkedTherapistName
            ){
                otherUser.therapistName = "";
            }
        });
    }

    if(editingUserId){
        const user =
            users.find(function(item){
                return item.id === editingUserId;
            });

        if(!user){
            return;
        }

        const activeAdmins =
            users.filter(function(item){
                return (
                    item.role === "Admin" &&
                    item.status === "Active"
                );
            });

        if(
            user.id === currentLoggedInUser.id &&
            (
                role !== "Admin" ||
                status !== "Active"
            )
        ){
            alert(
                "You cannot remove your own Admin access or deactivate your current account."
            );
            return;
        }

        if(
            user.role === "Admin" &&
            user.status === "Active" &&
            activeAdmins.length === 1 &&
            (
                role !== "Admin" ||
                status !== "Active"
            )
        ){
            alert(
                "At least one active Admin account is required."
            );
            return;
        }

        user.account = account;
        user.firstName = firstName;
        user.middleName = middleName;
        user.lastName = lastName;
        user.nickname = nickname;
        user.email = email;
        user.role = role;
        user.branches = branches;
        user.status = status;
        user.therapistName =
            role === "Therapist"
                ? linkedTherapistName
                : "";
        user.secondaryRole = secondaryRole;
        user.teamLeader = teamLeader;
        user.tlFloater = tlFloater;
        user.extraAccess = extraAccess;
        user.compensationSchedule = compensationSchedule;
        user.hiddenFromAdminGroup = hiddenFromAdminGroup;
        user.fixedRate = fixedRate;
        user.updatedAt = new Date().toISOString();

        if(password){
            user.passwordHash =
                await CrownAuth.hashPassword(password);
        }

        CrownAuth.saveUsers(users);

        /* Push this change to Firestore NOW rather than waiting for the
           debounced background sync — otherwise another device could
           sign in seconds later (Firebase Auth already updated instantly
           via resetStaffCloudLogin below) but still pull the OLD
           passwordHash from appData, since that write was still pending.
           That race is what let a just-reset account fail to log in
           anywhere but the admin's own device. */
        await window.CrownCloud?.flushNow?.();

        if(user.id === currentLoggedInUser.id){
            CrownAuth.setCurrentUser(user);

            /* Editing your OWN account through this admin form is the
               same self-password-change case changeOwnPassword() covers
               — keep Firebase in step here too so this path doesn't
               reopen the same silent-desync bug. */
            if(password){
                await window.CrownCloud?.updateOwnPassword?.(password);
            }

            alert("User account updated successfully.");
        }else if(password){
            /* Changing someone ELSE's password can't be kept in sync with
               Firebase from the client SDK alone — it can only update the
               currently-signed-in user's own password. resetStaffCloudLogin
               (a Cloud Function running with Admin SDK access) does it from
               here instead, so their cloud sync doesn't silently break. */
            const cloudResetOk =
                await window.CrownCloud?.resetOtherUserCloudLogin?.(
                    account,
                    password
                );

            alert(
                cloudResetOk
                    ? "User account updated successfully. Their cloud login was reset too, so sync keeps working on their devices."
                    : "User account updated successfully.\n\nNote: their cloud login could not be reset automatically (no connection, or the Cloud Function isn't deployed yet) — their Daily Income Report \"Cloud Sync Status\" badge in the sidebar will turn red until this is retried or their cloud login is reset manually."
            );
        }else{
            alert("User account updated successfully.");
        }
    }else{
        users.push({
            id: CrownAuth.createId(),
            account: account,
            passwordHash:
                await CrownAuth.hashPassword(password),
            firstName: firstName,
            middleName: middleName,
            lastName: lastName,
            nickname: nickname,
            email: email,
            role: role,
            branches: branches,
            therapistName:
                role === "Therapist"
                    ? linkedTherapistName
                    : "",
            secondaryRole: secondaryRole,
            teamLeader: teamLeader,
            tlFloater: tlFloater,
            extraAccess: extraAccess,
            status: status,
            compensationSchedule: compensationSchedule,
            hiddenFromAdminGroup: hiddenFromAdminGroup,
            fixedRate: fixedRate,
            createdAt: new Date().toISOString(),
            lastLogin: ""
        });

        CrownAuth.saveUsers(users);

        alert(
            `${role} account created successfully.`
        );
    }

    closeUserAccountModal();
    renderUsers();
}

function renderUsers(){
    const tbody =
        document.getElementById("userTableBody");

    if(!tbody){
        return;
    }

    const currentUser =
        CrownAuth.getCurrentUser();

    const users =
        CrownAuth.getUsers()
            .slice()
            .sort(function(a, b){
                return String(a.account || "")
                    .localeCompare(
                        String(b.account || "")
                    );
            });

    tbody.innerHTML = "";

    users.forEach(function(user){
        const row =
            document.createElement("tr");

        const branches =
            AUTO_ALL_BRANCH_ROLES.includes(user.role)
                ? ["All Branches"]
                : (
                    Array.isArray(user.branches)
                        ? user.branches
                        : []
                );

        row.innerHTML = `
            <td>
                <strong>
                    ${escapeHtml(user.account)}
                </strong>

                ${
                    getFullName(user)
                        ? `<small class="linked-account-label">${escapeHtml(getFullName(user))}${user.nickname ? ` "${escapeHtml(user.nickname)}"` : ""}</small>`
                        : ""
                }

                ${
                    user.id === currentUser.id
                        ? '<small class="current-user-label">Current User</small>'
                        : ""
                }
            </td>

            <td>
                <span class="role-badge role-${roleClass(user.role)}">
                    ${escapeHtml(user.role)}
                </span>

                ${
                    user.role === "Therapist" && user.therapistName
                        ? `<small class="linked-therapist-label">Linked: ${escapeHtml(user.therapistName)}</small>`
                        : ""
                }

                ${
                    Array.isArray(user.extraAccess) && user.extraAccess.length
                        ? `<small class="extra-access-label">+ ${user.extraAccess.length} extra page${user.extraAccess.length === 1 ? "" : "s"}</small>`
                        : ""
                }
            </td>

            <td>
                <div class="user-branch-list">
                    ${
                        branches.length
                            ? branches.map(function(branch){
                                return `
                                    <span>
                                        ${escapeHtml(branch)}
                                    </span>
                                `;
                            }).join("")
                            : "No Branch Assigned"
                    }
                </div>
            </td>

            <td>
                <span class="status-badge status-${user.status.toLowerCase()}">
                    ${escapeHtml(user.status)}
                </span>
            </td>

            <td>
                ${formatLastLogin(user.lastLogin)}
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
                        ${
                            user.id === currentUser.id
                                ? "disabled"
                                : ""
                        }
                    >
                        Delete
                    </button>

                </div>
            </td>
        `;

        row
            .querySelector(".edit-btn")
            .addEventListener(
                "click",
                function(){
                    openEditUserModal(user.id);
                }
            );

        row
            .querySelector(".delete-btn")
            .addEventListener(
                "click",
                function(){
                    deleteUser(user.id);
                }
            );

        tbody.appendChild(row);
    });

    document.getElementById("userCount").textContent =
        users.length;
}

function roleClass(role){
    return String(role || "")
        .toLowerCase()
        .replaceAll(" ", "-");
}

function formatLastLogin(value){
    if(!value){
        return "Never";
    }

    return new Date(value)
        .toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
}

function deleteUser(userId){
    const currentUser =
        CrownAuth.getCurrentUser();

    if(userId === currentUser.id){
        alert(
            "You cannot delete your current account."
        );
        return;
    }

    let users =
        CrownAuth.getUsers();

    const user =
        users.find(function(item){
            return item.id === userId;
        });

    if(!user){
        return;
    }

    const activeAdmins =
        users.filter(function(item){
            return (
                item.role === "Admin" &&
                item.status === "Active"
            );
        });

    if(
        user.role === "Admin" &&
        user.status === "Active" &&
        activeAdmins.length === 1
    ){
        alert(
            "The last active Admin account cannot be deleted."
        );
        return;
    }

    if(
        !confirm(
            `Delete the account "${user.account}"?`
        )
    ){
        return;
    }

    users =
        users.filter(function(item){
            return item.id !== userId;
        });

    CrownAuth.saveUsers(users);
    renderUsers();
}
