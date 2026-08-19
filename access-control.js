/* ==========================================================================
   Crown Head Spa — Authentication and Role-Based Access Control
   ========================================================================== */

(function(){
    const USERS_KEY = "crownUserAccounts";
    const SESSION_KEY = "crownCurrentUser";
    const LOGIN_FLAG_KEY = "crownLoggedIn";
    const BRANCH_KEY = "crownSelectedBranch";
    const BRANCH_MASTER_KEY = "crownBranchMasterList";
    const DUTY_LOG_KEY = "crownDutyLog";

    /* Pages that can never be unlocked through a user's extraAccess grants,
       regardless of what is stored in localStorage — only the exact roles
       listed in PAGE_ACCESS may open them. */
    const EXTRA_ACCESS_EXCLUDED_PAGES = [
        "data-protection.html",
        "cashflow.html"
    ];

    const PAGE_ACCESS = {
        "home.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist",
            "Therapist",
            "Marketing Agent",
            "Branch Device"
        ],

        "index.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "monthly-report.html": [
            "Admin"
        ],

        "expenses-report.html": [
            "Admin"
        ],

        "cashflow.html": [
            "Admin"
        ],

        "share-holder-report.html": [
            "Admin"
        ],

        "loyalty-card-summary.html": [
            "Admin"
        ],

        "product-sales-summary.html": [
            "Admin"
        ],

        "payroll.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist",
            "Therapist",
            "Marketing Agent"
        ],

        "list-vouchers.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "invoice-report.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "clients.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist",
            "Therapist",
            "Branch Device"
        ],

        "scheduling.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist",
            "Marketing Agent",
            "Branch Device"
        ],

        "booking-requests.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "list-services.html": [
            "Admin",
            "Executive Assistant"
        ],

        "list-products.html": [
            "Admin",
            "Executive Assistant"
        ],

        "list-therapists.html": [
            "Admin",
            "Executive Assistant"
        ],

        "list-branches.html": [
            "Admin",
            "Executive Assistant"
        ],

        "statistics.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "petty-cash.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "therapist-sales.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist",
            "Therapist"
        ],

        "data-protection.html": [
            "Admin"
        ],

        "account-settings.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist",
            "Therapist",
            "Marketing Agent"
        ],

        "attendance.html": [
            "Admin",
            "Executive Assistant",
            "Receptionist"
        ],

        "inventory-items.html": [
            "Admin"
        ],

        "inventory-warehouse.html": [
            "Admin"
        ],

        "inventory-branches.html": [
            "Admin"
        ]
    };

    function createId(){
        return (
            "USR-" +
            Date.now().toString(36).toUpperCase() +
            Math.random().toString(36).slice(2,7).toUpperCase()
        );
    }

    async function hashPassword(password){
        const bytes =
            new TextEncoder().encode(String(password));

        const hash =
            await crypto.subtle.digest("SHA-256", bytes);

        return Array
            .from(new Uint8Array(hash))
            .map(function(byte){
                return byte.toString(16).padStart(2, "0");
            })
            .join("");
    }

    function getAllBranchNames(){
        try{
            const raw =
                localStorage.getItem(BRANCH_MASTER_KEY);

            const parsed =
                raw ? JSON.parse(raw) : [];

            if(!Array.isArray(parsed)){
                return [];
            }

            return parsed
                .map(function(branch){
                    return typeof branch === "string"
                        ? branch
                        : branch?.name;
                })
                .filter(Boolean);
        }catch(error){
            return [];
        }
    }

    function getUsers(){
        try{
            const raw =
                localStorage.getItem(USERS_KEY);

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

    function saveUsers(users){
        localStorage.setItem(
            USERS_KEY,
            JSON.stringify(users)
        );
    }

    async function ensureDefaultAdmin(){
        const existingUsers = getUsers();

        if(existingUsers.length > 0){
            return existingUsers;
        }

        /* This device's local crownUserAccounts is empty — normally
           because the cloud pull hasn't finished yet, NOT because the
           account list is actually empty. Fabricating a bootstrap admin
           here and saving it used to go through the same synced
           localStorage write as any real edit; if that write raced the
           still-in-flight initial pull, firebase-sync.js's "don't clobber
           a newer local write" guard would keep this fake admin instead
           of the real pulled data, and its own queued push then
           overwrote the entire shared account list in Firestore with
           this one fake record — a real incident, not a hypothetical.
           Cloud-connected production devices must never risk that: skip
           the fabrication and let this login attempt fail instead
           (retrying once the pull actually completes works normally).
           Only a genuinely offline/local-test device falls back to the
           old single-admin bootstrap. */
        if(
            window.CrownCloud?.isAvailable?.() &&
            !window.CrownCloud?.isLocalTestEnv
        ){
            return [];
        }

        const oldUsername =
            localStorage.getItem("crownUsername") || "admin";

        const oldPassword =
            localStorage.getItem("crownPassword") || "1234";

        const admin = {
            id: createId(),
            account: oldUsername,
            passwordHash: await hashPassword(oldPassword),
            role: "Admin",
            branches: getAllBranchNames(),
            status: "Active",
            createdAt: new Date().toISOString(),
            lastLogin: ""
        };

        saveUsers([admin]);

        return [admin];
    }

    function getCurrentUser(){
        try{
            const raw =
                localStorage.getItem(SESSION_KEY);

            return raw ? JSON.parse(raw) : null;
        }catch(error){
            return null;
        }
    }

    function setCurrentUser(user){
        const session = {
            id: user.id,
            account: user.account,
            nickname: user.nickname || "",
            role: user.role,
            secondaryRole: user.secondaryRole || "",
            branches: Array.isArray(user.branches)
                ? user.branches
                : [],
            therapistName: user.therapistName || "",
            extraAccess: Array.isArray(user.extraAccess)
                ? user.extraAccess
                : [],
            status: user.status
        };

        localStorage.setItem(
            SESSION_KEY,
            JSON.stringify(session)
        );

        localStorage.setItem(
            LOGIN_FLAG_KEY,
            "true"
        );
    }

    function refreshCurrentUser(){
        const session = getCurrentUser();

        if(!session){
            return null;
        }

        const latest =
            getUsers().find(function(user){
                return user.id === session.id;
            });

        if(
            !latest ||
            latest.status !== "Active"
        ){
            logout();
            return null;
        }

        setCurrentUser(latest);
        return getCurrentUser();
    }

    async function authenticate(account, password){
        await ensureDefaultAdmin();

        const users = getUsers();

        const user =
            users.find(function(item){
                return (
                    item.status === "Active" &&
                    String(item.account || "").toLowerCase() ===
                    String(account || "").trim().toLowerCase()
                );
            });

        if(!user){
            return null;
        }

        const passwordHash =
            await hashPassword(password);

        if(user.passwordHash !== passwordHash){
            return null;
        }

        user.lastLogin =
            new Date().toISOString();

        saveUsers(users);
        setCurrentUser(user);

        return user;
    }

    async function logout(){
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(LOGIN_FLAG_KEY);
        localStorage.removeItem(BRANCH_KEY);

        /* Flush any pending sync writes while still authenticated —
           flushPending() silently no-ops once signed out, so any
           delete/edit made just before logout would otherwise never
           reach Firestore and would reappear on the next login's pull. */
        await window.CrownCloud?.flushNow?.();

        window.CrownCloud?.signOut();
    }

    function getTodayDateString(){
        const today = new Date();

        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");
    }

    /* A Therapist with Receptionist enabled as a secondary role picks
       their duty for the day at login (see login.js) — this account
       should only ever see the ONE role's pages/permissions for today,
       not a union of both. Defaults to the primary role (Therapist)
       when there's no duty log entry for today. Every other account
       (no secondary role) always resolves to its own static role. */
    function getEffectiveRole(user = getCurrentUser()){
        if(
            !user ||
            user.role !== "Therapist" ||
            user.secondaryRole !== "Receptionist"
        ){
            return user?.role;
        }

        try{
            const raw =
                localStorage.getItem(DUTY_LOG_KEY);

            const log =
                raw ? JSON.parse(raw) : {};

            const logged =
                log?.[user.id + "_" + getTodayDateString()];

            return logged === "Receptionist" ? "Receptionist" : "Therapist";
        }catch(error){
            return "Therapist";
        }
    }

    function canAccessPage(
        pageName,
        user = getCurrentUser()
    ){
        const allowedRoles =
            PAGE_ACCESS[pageName];

        if(!allowedRoles){
            return true;
        }

        if(allowedRoles.includes(getEffectiveRole(user))){
            return true;
        }

        if(EXTRA_ACCESS_EXCLUDED_PAGES.includes(pageName)){
            return false;
        }

        return (
            Array.isArray(user?.extraAccess) &&
            user.extraAccess.includes(pageName)
        );
    }

    function getAllowedBranches(user = getCurrentUser()){
        const allBranches =
            getAllBranchNames();

        if(!user){
            return [];
        }

        if(user.role === "Admin"){
            return allBranches;
        }

        const assigned =
            Array.isArray(user.branches)
                ? user.branches
                : [];

        return allBranches.filter(function(branch){
            return assigned.includes(branch);
        });
    }

    function guardCurrentPage(){
        const pageName =
            location.pathname.split("/").pop() ||
            "home.html";

        if(
            pageName === "login.html" ||
            pageName === ""
        ){
            return;
        }

        const user =
            refreshCurrentUser();

        if(
            !user ||
            localStorage.getItem(LOGIN_FLAG_KEY) !== "true"
        ){
            location.href = "login.html";
            return;
        }

        if(!canAccessPage(pageName, user)){
            alert(
                "Your account does not have permission to access this page."
            );

            location.href = "home.html";
        }
    }

    window.CrownAuth = {
        USERS_KEY,
        SESSION_KEY,
        PAGE_ACCESS,
        createId,
        hashPassword,
        ensureDefaultAdmin,
        getUsers,
        saveUsers,
        getCurrentUser,
        setCurrentUser,
        refreshCurrentUser,
        authenticate,
        logout,
        canAccessPage,
        getAllowedBranches,
        getAllBranchNames,
        getEffectiveRole
    };

    document.addEventListener(
        "DOMContentLoaded",
        guardCurrentPage
    );
})();
