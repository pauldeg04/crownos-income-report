/* ==========================================================================
   Crown Head Spa — Complete Role-Based Sidebar
   Includes Data Protection and System Health
   ========================================================================== */

(function(){
    const BRANCH_KEY = "crownSelectedBranch";
    const COLLAPSE_KEY = "crownSidebarCollapsed";

    /* Quiet substitute for the old daily backup popup: a dot on
       "System Health / Database" instead of an interrupting modal
       on every login. */
    function needsBackupToday(){
        const today =
            new Date();

        const todayKey = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");

        let lastBackup = null;

        try{
            lastBackup =
                JSON.parse(
                    localStorage.getItem(
                        "crownBackupMetadata"
                    ) || "null"
                );
        }catch(error){
            lastBackup = null;
        }

        return !lastBackup?.lastBackupAt?.startsWith(todayKey);
    }

    function getPendingRequestBadge(){
        try{
            const raw =
                localStorage.getItem("crownStockRequests");

            const requests =
                raw ? JSON.parse(raw) : [];

            if(!Array.isArray(requests)){
                return "";
            }

            let count = 0;

            requests.forEach(function(request){
                (request.items || []).forEach(function(line){
                    if(line.status === "Awaiting Response"){
                        count++;
                    }
                });
            });

            return count > 0
                ? `<span class="app-sidebar-badge">${count}</span>`
                : "";
        }catch(error){
            return "";
        }
    }

    const MENU_ICONS = {
        "Dashboard": "⌂",
        "Daily Income Report": "₱",
        "Statistics": "▥",
        "Petty Cash": "¢",
        "Therapist Sales": "♙",
        "Monthly Summary": "Σ",
        "Expenses Report": "−",
        "Cash Flow": "◑",
        "Share Holder Summary Report": "%",
        "Loyalty Card Sales Summary": "◈",
        "Product Sales Summary": "▣",
        "Client Database": "◉",
        "Scheduling": "▦",
        "Booking Requests": "✉",
        "List of Services": "S",
        "List of Products": "P",
        "List of Therapist": "T",
        "List of Branches": "B",
        "System Health / Database": "◆",
        "User Manual": "?",
        "Account Settings": "⚙",
        "Attendance": "◷",
        "Warehouse": "▣",
        "Branches": "▥",
        "Inventory Settings": "▤",
        "201 Files": "🗂",
        "Bulletin Board": "📌",
        "Staff Management": "🧑‍💼",
        "Ads Monitoring": "📣",
        "Monitoring Summary": "📈",
        "Daily Report": "📋",
        "BIR Compliance Desk": "🧾"
    };

    const MENU_ITEMS = [
        {
            label: "Dashboard",
            href: "home.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Therapist", "Marketing Agent", "Branch Device"]
        },

        { section: "Operations" },

        {
            label: "Daily Income Report",
            href: "index.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"],
            branchRequired: true
        },

        {
            label: "Therapist Sales",
            href: "therapist-sales.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Therapist"],
            branchRequired: true
        },

        {
            label: "Sales Invoice Summary",
            href: "invoice-report.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"]
        },

        {
            label: "Client Database",
            href: "clients.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Branch Device"]
        },

        {
            label: "Scheduling",
            href: "scheduling.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Marketing Agent", "Branch Device"]
        },

        {
            label: "Booking Requests",
            href: "booking-requests.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"]
        },

        { section: "Admin Hub" },

        {
            label: "201 Files",
            href: "201-files.html",
            roles: ["Admin", "Executive Assistant"]
        },

        {
            label: "Bulletin Board",
            href: "bulletin-board.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Therapist", "Marketing Agent", "Branch Device"]
        },

        {
            label: "Staff Management",
            href: "staff-management.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Therapist", "Marketing Agent"]
        },

        { section: "Marketing" },

        {
            label: "Ads Monitoring",
            href: "marketing-ads-daily.html",
            roles: ["Admin", "Marketing Agent"]
        },

        {
            label: "Monitoring Summary",
            href: "marketing-ads-summary.html",
            roles: ["Admin", "Marketing Agent"],
            sub: true
        },

        {
            label: "Daily Report",
            href: "marketing-daily-report.html",
            roles: ["Admin", "Marketing Agent"],
            branchRequired: true
        },

        { section: "Inventory" },

        {
            label: "Warehouse",
            href: "inventory-warehouse.html",
            roles: ["Admin"]
        },

        {
            label: "Branches",
            href: "inventory-branches.html",
            roles: ["Admin"],
            branchRequired: true
        },

        { section: "Compliance" },

        {
            label: "BIR Compliance Desk",
            href: "bir-compliance.html",
            roles: ["Admin", "Executive Assistant"]
        },

        { section: "Summary Reports" },

        {
            label: "Statistics",
            href: "statistics.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Petty Cash",
            href: "petty-cash.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Monthly Summary",
            href: "monthly-report.html",
            roles: ["Admin"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Expenses Report",
            href: "expenses-report.html",
            roles: ["Admin"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Cash Flow",
            href: "cashflow.html",
            roles: ["Admin"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Share Holder Summary Report",
            href: "share-holder-report.html",
            roles: ["Admin"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Loyalty Card Sales Summary",
            href: "loyalty-card-summary.html",
            roles: ["Admin"],
            branchRequired: true,
            sub: true
        },

        {
            label: "Product Sales Summary",
            href: "product-sales-summary.html",
            roles: ["Admin"],
            branchRequired: true,
            sub: true
        },

        { section: "Settings" },

        {
            label: "Account Settings",
            href: "account-settings.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Therapist", "Marketing Agent"],
            sub: true
        },

        {
            label: "Attendance",
            href: "attendance.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"],
            sub: true
        },

        {
            label: "List of Services",
            href: "list-services.html",
            roles: ["Admin", "Executive Assistant"],
            sub: true
        },

        {
            label: "Voucher Masterlist",
            href: "list-vouchers.html",
            roles: ["Admin", "Executive Assistant", "Receptionist"],
            sub: true
        },

        {
            label: "List of Products",
            href: "list-products.html",
            roles: ["Admin", "Executive Assistant"],
            sub: true
        },

        {
            label: "List of Therapist",
            href: "list-therapists.html",
            roles: ["Admin", "Executive Assistant"],
            sub: true
        },

        {
            label: "List of Branches",
            href: "list-branches.html",
            roles: ["Admin", "Executive Assistant"],
            sub: true
        },

        {
            label: "Inventory Settings",
            href: "inventory-items.html",
            roles: ["Admin"],
            sub: true
        },

        {
            label: "System Health / Database",
            href: "data-protection.html",
            roles: ["Admin"],
            sub: true
        },

        /* Reference page, open to every role — a Therapist or Branch Device
           needs the manual as much as an Admin does. No branchRequired: it
           reads no branch data, so it must stay reachable before a branch is
           picked (which is exactly when a new staff member needs it). */
        {
            label: "User Manual",
            href: "manual.html",
            roles: ["Admin", "Executive Assistant", "Receptionist", "Therapist", "Marketing Agent", "Branch Device"],
            sub: true
        }
    ];

    document.addEventListener("DOMContentLoaded", function(){
        if(document.body.dataset.noSidebar === "true"){
            return;
        }

        const user =
            window.CrownAuth?.refreshCurrentUser?.();

        if(!user){
            return;
        }

        /* A dual-role Therapist (Receptionist secondary) only ever sees
           the ONE role's menu/pages for today, per their duty picker
           choice at login — not a union of both. */
        const effectiveRole =
            window.CrownAuth?.getEffectiveRole?.(user) || user.role;

        document.body.classList.add("with-app-sidebar");

        if(
            localStorage.getItem(COLLAPSE_KEY) === "true" &&
            window.innerWidth > 900
        ){
            document.body.classList.add("sidebar-collapsed");
        }

        const toggle =
            document.createElement("button");

        toggle.type = "button";
        toggle.className = "sidebar-mobile-toggle";
        toggle.textContent = "☰";

        const sidebar =
            document.createElement("aside");

        sidebar.className = "app-sidebar";

        const collapseButton =
            document.createElement("button");

        collapseButton.type = "button";
        collapseButton.className =
            "sidebar-collapse-toggle";

        collapseButton.setAttribute(
            "aria-label",
            "Collapse sidebar"
        );

        collapseButton.title =
            "Collapse sidebar";

        updateCollapseButton(collapseButton);

        const brand =
            document.createElement("a");

        brand.href = "home.html";
        brand.className = "app-sidebar-brand";

        brand.innerHTML = `
            <img class="app-sidebar-brand-mark" src="crown-mark.png" alt="Crown Head Spa">

            <span class="app-sidebar-brand-copy">
                <strong>Crown Head Spa</strong>
                <span>${escapeHtml(effectiveRole)} Account${effectiveRole !== user.role ? " (Today)" : ""}</span>
            </span>
        `;

        const nav =
            document.createElement("nav");

        nav.className = "app-sidebar-nav";

        const currentPage =
            location.pathname.split("/").pop() ||
            "home.html";

        const hasBranch =
            Boolean(
                localStorage.getItem(BRANCH_KEY)
            );

        let pendingSection = null;
        let pendingGroup = null;
        let sectionVisible = false;

        MENU_ITEMS.forEach(function(item){
            if(item.section){
                pendingSection =
                    document.createElement("button");

                pendingSection.type = "button";

                pendingSection.className =
                    "app-sidebar-section";

                const sectionCollapseKey =
                    "crownSidebarSectionCollapsed:" + item.section;

                const startCollapsed =
                    localStorage.getItem(sectionCollapseKey) === "true";

                pendingSection.innerHTML = `
                    <span>${escapeHtml(item.section)}</span>
                    <span class="app-sidebar-section-chevron" aria-hidden="true">${startCollapsed ? "▸" : "▾"}</span>
                `;

                pendingGroup =
                    document.createElement("div");

                pendingGroup.className =
                    "app-sidebar-section-group" +
                    (startCollapsed ? " collapsed" : "");

                /* pendingSection/pendingGroup are reassigned on every
                   {section} entry in MENU_ITEMS, so a closure over those
                   outer variables would see whatever they happened to
                   hold by the time a click actually fires — in practice
                   always the LAST section built (Settings), which is why
                   only Settings ever collapsed correctly and every other
                   header silently toggled Settings' group instead. Snapshot
                   this iteration's group directly onto the button (and use
                   `this` for the button itself) so each header only ever
                   affects its own group. */
                pendingSection._targetGroup = pendingGroup;

                pendingSection.addEventListener("click", function(){
                    const collapsed =
                        this._targetGroup.classList.toggle("collapsed");

                    localStorage.setItem(
                        sectionCollapseKey,
                        String(collapsed)
                    );

                    this.querySelector(".app-sidebar-section-chevron").textContent =
                        collapsed ? "▸" : "▾";
                });

                sectionVisible = false;
                return;
            }

            const hasRoleAccess =
                item.roles.includes(effectiveRole);

            const hasExtraAccess =
                Array.isArray(user.extraAccess) &&
                user.extraAccess.includes(item.href);

            if(!hasRoleAccess && !hasExtraAccess){
                return;
            }

            if(
                pendingSection &&
                !sectionVisible
            ){
                nav.appendChild(
                    pendingSection
                );

                nav.appendChild(
                    pendingGroup
                );

                sectionVisible = true;
            }

            const link =
                document.createElement("a");

            link.href = item.href;

            link.className =
                "app-sidebar-link" +
                (
                    item.sub
                        ? " app-sidebar-sub-link"
                        : ""
                );

            link.title =
                item.label;

            const showBackupDot =
                item.href === "data-protection.html" &&
                user.role === "Admin" &&
                needsBackupToday();

            const pendingBadge =
                item.href === "inventory-warehouse.html"
                    ? getPendingRequestBadge()
                    : "";

            link.innerHTML = `
                <span class="app-sidebar-link-icon" aria-hidden="true">
                    ${escapeHtml(MENU_ICONS[item.label] || "•")}
                    ${showBackupDot ? '<span class="app-sidebar-link-dot" title="No backup created today"></span>' : ""}
                </span>

                <span class="app-sidebar-link-label">
                    ${escapeHtml(item.label)}
                </span>

                ${pendingBadge}
            `;

            if(currentPage === item.href){
                link.classList.add("active");
            }

            if(
                item.branchRequired &&
                !hasBranch
            ){
                link.classList.add("disabled");

                link.addEventListener(
                    "click",
                    function(event){
                        event.preventDefault();

                        alert(
                            "Please select an assigned branch from the Dashboard first."
                        );
                    }
                );
            }

            (pendingGroup || nav).appendChild(link);
        });

        sidebar.appendChild(collapseButton);
        sidebar.appendChild(brand);
        sidebar.appendChild(nav);

        const globalToolbar =
            createGlobalToolbar(user, currentPage);

        const accountCard =
            document.createElement("div");

        accountCard.className =
            "app-sidebar-branch";

        const selectedBranch =
            localStorage.getItem(BRANCH_KEY) ||
            "No branch selected";

        accountCard.innerHTML = `
            <span>Signed In</span>

            <strong title="${escapeHtml(user.account)}">
                ${escapeHtml(user.account)}
            </strong>

            <span class="sidebar-branch-label">
                Active Branch
            </span>

            <strong title="${escapeHtml(selectedBranch)}">
                ${escapeHtml(selectedBranch)}
            </strong>
        `;

        /* Visible cloud-sync status — a Receptionist's app-level session
           (crownCurrentUser/crownLoggedIn) can stay valid across reloads
           and PC restarts even if her underlying Firebase Auth session is
           gone, since login.html only re-authenticates to Firebase when
           she actually goes through login() again (skipped entirely once
           CrownAuth.getCurrentUser() already has a session). In that state
           everything looks and works normally on her screen — saves still
           write to localStorage fine — but nothing ever reaches the cloud,
           silently, with no error anywhere. This makes that state visible
           without needing DevTools. */
        const syncStatus =
            document.createElement("div");

        syncStatus.className =
            "app-sidebar-sync-status";

        syncStatus.id =
            "appSidebarSyncStatus";

        function renderSyncStatus(){
            if(
                !window.firebase ||
                !firebase.apps ||
                firebase.apps.length === 0
            ){
                syncStatus.className =
                    "app-sidebar-sync-status offline";

                syncStatus.textContent =
                    "⚠ No Cloud Connection";

                return;
            }

            /* Local dev server / opened straight from disk — firebase-sync.js
               still pulls (so this screen shows real data) but has disabled
               every outgoing path, so nothing typed here reaches the live
               database. Surfaced here so that's visible without DevTools. */
            if(window.CrownCloud?.isLocalTestEnv){
                syncStatus.className =
                    "app-sidebar-sync-status local-test";

                syncStatus.textContent =
                    "🧪 Local Test — Not Saving to Live";

                return;
            }

            const cloudUser =
                firebase.auth().currentUser;

            if(cloudUser){
                syncStatus.className =
                    "app-sidebar-sync-status online";

                syncStatus.textContent =
                    "☁ Synced to Cloud";
            }else{
                syncStatus.className =
                    "app-sidebar-sync-status offline";

                syncStatus.textContent =
                    "⚠ NOT Synced — please re-login";
            }
        }

        renderSyncStatus();

        if(window.firebase?.auth){
            firebase.auth().onAuthStateChanged(renderSyncStatus);
        }

        const logoutButton =
            document.createElement("button");

        logoutButton.type = "button";
        logoutButton.className =
            "app-sidebar-logout";

        logoutButton.textContent =
            "Logout";

        logoutButton.addEventListener(
            "click",
            async function(){
                if(
                    !confirm(
                        "Are you sure you want to logout?"
                    )
                ){
                    return;
                }

                await window.CrownAuth?.logout?.();

                location.href =
                    "login.html";
            }
        );

        sidebar.appendChild(accountCard);
        sidebar.appendChild(syncStatus);
        sidebar.appendChild(logoutButton);

        document.body.prepend(sidebar);
        document.body.prepend(globalToolbar);
        document.body.prepend(toggle);

        window.setTimeout(function(){
            syncGlobalToolbarToPage(currentPage);
        }, 0);

        /* The paint above (and the toolbar's own initial value, set earlier
           in buildGlobalToolbar) reads whatever crownGlobalDate already
           happens to be in THIS device's localStorage — on a fresh login/
           restart that can be a long-stale value from a much earlier visit,
           since the real synced value only lands after Firestore's initial
           pull (a network round trip that routinely finishes after this
           synchronous paint already ran). Left uncorrected, new Daily
           Income entries silently save under that stale date instead of
           today's — re-apply once the true cloud value is in. */
        window.CrownCloud?.waitForInitialSync?.(15000).then(function(){
            const toolbarDate =
                document.getElementById("sidebarDashboardDate");

            if(toolbarDate){
                toolbarDate.value =
                    localStorage.getItem("crownGlobalDate") ||
                    getTodayValue();
            }

            syncGlobalToolbarToPage(currentPage);
        });

        collapseButton.addEventListener(
            "click",
            function(event){
                event.stopPropagation();

                if(window.innerWidth <= 900){
                    return;
                }

                const collapsed =
                    document.body.classList.toggle(
                        "sidebar-collapsed"
                    );

                localStorage.setItem(
                    COLLAPSE_KEY,
                    String(collapsed)
                );

                updateCollapseButton(
                    collapseButton
                );

                window.dispatchEvent(
                    new Event("resize")
                );
            }
        );

        toggle.addEventListener(
            "click",
            function(event){
                event.stopPropagation();

                document.body.classList.toggle(
                    "sidebar-open"
                );
            }
        );

        sidebar.addEventListener(
            "click",
            function(event){
                event.stopPropagation();
            }
        );

        document.addEventListener(
            "click",
            function(){
                document.body.classList.remove(
                    "sidebar-open"
                );
            }
        );

        window.addEventListener(
            "resize",
            function(){
                if(window.innerWidth <= 900){
                    document.body.classList.remove(
                        "sidebar-collapsed"
                    );
                }else if(
                    localStorage.getItem(
                        COLLAPSE_KEY
                    ) === "true"
                ){
                    document.body.classList.add(
                        "sidebar-collapsed"
                    );
                }

                updateCollapseButton(
                    collapseButton
                );
            }
        );
    });

    function updateCollapseButton(button){
        const collapsed =
            document.body.classList.contains(
                "sidebar-collapsed"
            );

        button.textContent =
            collapsed
                ? "›"
                : "‹";

        button.title =
            collapsed
                ? "Expand sidebar"
                : "Collapse sidebar";

        button.setAttribute(
            "aria-label",
            button.title
        );
    }

    function createGlobalToolbar(user, currentPage){
        const toolbar =
            document.createElement("header");

        toolbar.className =
            "crown-global-toolbar";

        toolbar.innerHTML = `
            <div class="global-toolbar-context">
                <span class="global-toolbar-eyebrow">
                    CrownOS Control Center
                </span>

                <strong class="global-toolbar-page">
                    ${escapeHtml(getPageTitle(currentPage))}
                </strong>
            </div>

            <div class="global-toolbar-filters">
                <label class="global-toolbar-field">
                    <span>Branch</span>

                    <select
                        id="sidebarDashboardBranch"
                        class="global-toolbar-select"
                    >
                        <option value="">
                            Select Branch
                        </option>
                    </select>
                </label>

                <label class="global-toolbar-field">
                    <span>Date</span>

                    <div class="date-stepper-group">
                        <button
                            type="button"
                            class="date-step-btn"
                            id="sidebarDashboardPrevDay"
                            aria-label="Previous day"
                            title="Previous day"
                        >
                            ‹
                        </button>

                        <input
                            type="date"
                            id="sidebarDashboardDate"
                            class="global-toolbar-input"
                        >

                        <button
                            type="button"
                            class="date-step-btn"
                            id="sidebarDashboardNextDay"
                            aria-label="Next day"
                            title="Next day"
                        >
                            ›
                        </button>
                    </div>
                </label>

                <button
                    type="button"
                    class="global-toolbar-button global-toolbar-refresh"
                    id="globalToolbarRefresh"
                    title="Refresh current page data"
                >
                    Refresh
                </button>

                <button
                    type="button"
                    class="global-toolbar-button global-toolbar-today"
                    id="sidebarDashboardToday"
                >
                    Today
                </button>
            </div>

            <div class="global-toolbar-user">
                <div class="notification-bell-wrap d-none" id="notificationBellWrap">
                    <button
                        type="button"
                        class="notification-bell-btn"
                        id="notificationBellBtn"
                        aria-label="Notifications"
                    >
                        <span aria-hidden="true">🔔</span>
                        <span class="notification-badge d-none" id="notificationBadge">0</span>
                    </button>

                    <div class="notification-panel d-none" id="notificationPanel">
                        <div class="notification-panel-header">
                            <strong>Notifications</strong>

                            <button type="button" id="notificationMarkAllBtn">
                                Mark all read
                            </button>
                        </div>

                        <div class="notification-list" id="notificationList"></div>
                    </div>
                </div>

                <span class="global-toolbar-avatar">
                    ${escapeHtml(
                        String(user?.account || "U")
                            .trim()
                            .charAt(0)
                            .toUpperCase() || "U"
                    )}
                </span>

                <span class="global-toolbar-user-copy">
                    <strong>${escapeHtml(user?.account || "User")}</strong>
                    <small>${escapeHtml(user?.role || "Account")}</small>
                </span>
            </div>
        `;

        const branches =
            window.CrownAuth?.getAllowedBranches?.(user) || [];

        const branchSelect =
            toolbar.querySelector(
                "#sidebarDashboardBranch"
            );

        branchSelect.innerHTML =
            '<option value="">Select Branch</option>' +
            branches
                .map(function(branch){
                    return `
                        <option value="${escapeHtml(branch)}">
                            ${escapeHtml(branch)}
                        </option>
                    `;
                })
                .join("");

        const savedBranch =
            localStorage.getItem(BRANCH_KEY) || "";

        branchSelect.value =
            branches.includes(savedBranch)
                ? savedBranch
                : "";

        const dateInput =
            toolbar.querySelector(
                "#sidebarDashboardDate"
            );

        const today =
            getTodayValue();

        const savedDate =
            localStorage.getItem("crownGlobalDate") || today;

        dateInput.value =
            savedDate;

        branchSelect.addEventListener(
            "change",
            function(){
                if(this.value){
                    localStorage.setItem(
                        BRANCH_KEY,
                        this.value
                    );
                }else{
                    localStorage.removeItem(
                        BRANCH_KEY
                    );
                }

                syncGlobalToolbarToPage(currentPage);
                notifyDashboard();
            }
        );

        function applyToolbarDate(newValue){
            dateInput.value =
                newValue || today;

            localStorage.setItem(
                "crownGlobalDate",
                dateInput.value
            );

            syncGlobalToolbarToPage(currentPage);
            notifyDashboard();
        }

        dateInput.addEventListener(
            "change",
            function(){
                applyToolbarDate(this.value);
            }
        );

        toolbar
            .querySelector(
                "#sidebarDashboardToday"
            )
            .addEventListener(
                "click",
                function(){
                    applyToolbarDate(today);
                }
            );

        toolbar
            .querySelector(
                "#sidebarDashboardPrevDay"
            )
            .addEventListener(
                "click",
                function(){
                    applyToolbarDate(
                        addDaysToDateValue(dateInput.value || today, -1)
                    );
                }
            );

        toolbar
            .querySelector(
                "#sidebarDashboardNextDay"
            )
            .addEventListener(
                "click",
                function(){
                    applyToolbarDate(
                        addDaysToDateValue(dateInput.value || today, 1)
                    );
                }
            );

        toolbar
            .querySelector(
                "#globalToolbarRefresh"
            )
            .addEventListener(
                "click",
                function(){
                    syncGlobalToolbarToPage(currentPage);

                    window.dispatchEvent(
                        new CustomEvent(
                            "crownGlobalFiltersChanged",
                            {
                                detail: {
                                    branch: branchSelect.value,
                                    date: dateInput.value
                                }
                            }
                        )
                    );

                    if(currentPage === "home.html"){
                        notifyDashboard();
                    }else{
                        location.reload();
                    }
                }
            );

        initializeNotificationBell(toolbar);

        return toolbar;
    }

    /* ---- Notification bell (global — every sidebar page, not just
       Dashboard) ----

       Moved here from dashboard.js: the bell/badge only existed on
       home.html before, so a Receptionist working from Scheduling or
       Booking Requests all shift never saw a new-booking-request alert
       until they happened to open the Dashboard. Uses toolbar's own
       subtree (querySelector, not document.getElementById) since this
       runs before the toolbar element is attached to the document. */

    let serverNotificationsCache = [];
    let clientNotificationsCache = [];
    let notificationToolbarEl = null;

    /* Any logged-in Therapist or Receptionist can receive notifications —
       Therapists are addressed by their Therapist Master List name (how
       schedule assignments identify them), Receptionists (and anyone
       else) by their login account, since that's the only identity they
       have. */
    function getNotificationRecipient(){
        const user =
            window.CrownAuth
                ? CrownAuth.getCurrentUser()
                : null;

        if(!user){
            return null;
        }

        const effectiveRole =
            window.CrownAuth?.getEffectiveRole?.(user) || user.role;

        return {
            account: String(user.account || "").trim(),
            therapistName:
                effectiveRole === "Therapist"
                    ? String(user.therapistName || "").trim()
                    : ""
        };
    }

    function initializeNotificationBell(toolbar){
        const recipient =
            getNotificationRecipient();

        const wrap =
            toolbar.querySelector("#notificationBellWrap");

        if(!wrap || !recipient || !window.CrownNotifications){
            return;
        }

        notificationToolbarEl = toolbar;

        wrap.classList.remove("d-none");

        const bellBtn =
            toolbar.querySelector("#notificationBellBtn");

        const panel =
            toolbar.querySelector("#notificationPanel");

        bellBtn.addEventListener("click", function(event){
            event.stopPropagation();
            panel.classList.toggle("d-none");

            if(!panel.classList.contains("d-none")){
                renderNotificationPanel(recipient);
            }
        });

        panel.addEventListener("click", function(event){
            event.stopPropagation();
        });

        document.addEventListener("click", function(){
            panel.classList.add("d-none");
        });

        document.addEventListener("keydown", function(event){
            if(event.key === "Escape"){
                panel.classList.add("d-none");
            }
        });

        toolbar
            .querySelector("#notificationMarkAllBtn")
            .addEventListener("click", function(){
                CrownNotifications.markAllRead(recipient);
                window.CrownServerNotifications?.markAllRead?.(serverNotificationsCache);
                window.CrownClientNotifications?.markAllRead?.(clientNotificationsCache);
                renderNotificationPanel(recipient);
                updateNotificationBadge(recipient);
            });

        window.addEventListener("crownCloudUpdate", function(event){
            if(event.detail?.keys?.includes("crownNotifications")){
                updateNotificationBadge(recipient);

                if(!panel.classList.contains("d-none")){
                    renderNotificationPanel(recipient);
                }
            }
        });

        window.CrownServerNotifications?.listenForUser?.(recipient, function(list){
            serverNotificationsCache = list;
            updateNotificationBadge(recipient);

            if(!panel.classList.contains("d-none")){
                renderNotificationPanel(recipient);
            }
        });

        window.CrownClientNotifications?.listenForUser?.(recipient, function(list){
            clientNotificationsCache = list;
            updateNotificationBadge(recipient);

            if(!panel.classList.contains("d-none")){
                renderNotificationPanel(recipient);
            }
        });

        updateNotificationBadge(recipient);
    }

    /* Combines the client-owned local list (CrownNotifications, mirrored
       from localStorage) with the live server-created list
       (staffNotifications, e.g. new booking requests for a Receptionist
       — see notifications.js / notifyReceptionistsOnNewBookingRequest)
       and the client-writable Admin Hub broadcast list
       (staffNotificationsClient — Announcement publishes, Memo sends),
       newest first. Entries are tagged by source so mark-read routes to
       the right backend. */
    function getMergedNotifications(recipient){
        const local =
            CrownNotifications.getForUser(recipient)
                .map(function(item){
                    return Object.assign({ source: "local" }, item);
                });

        const server =
            serverNotificationsCache.map(function(item){
                return Object.assign({}, item, {
                    source: "server",
                    createdAt: item.createdAt?.toDate?.().toISOString() || null
                });
            });

        const client =
            clientNotificationsCache.map(function(item){
                return Object.assign({}, item, {
                    source: "client",
                    createdAt: item.createdAt?.toDate?.().toISOString() || null
                });
            });

        return local.concat(server, client).sort(function(a, b){
            return (
                new Date(b.createdAt || 0) -
                new Date(a.createdAt || 0)
            );
        });
    }

    function updateNotificationBadge(recipient){
        const badge =
            notificationToolbarEl?.querySelector("#notificationBadge");

        if(!badge || !recipient){
            return;
        }

        const unreadCount =
            getMergedNotifications(recipient)
                .filter(function(item){
                    return !item.read;
                })
                .length;

        badge.textContent =
            unreadCount > 99 ? "99+" : String(unreadCount);

        badge.classList.toggle("d-none", unreadCount === 0);

        /* Home screen icon badge (Badging API) — same count, so it stays
           in sync with the in-app bell whenever CrownOS is open/backgrounded.
           The fully-closed-app case is covered by sw.js's onBackgroundMessage
           instead. */
        if(unreadCount > 0 && navigator.setAppBadge){
            navigator.setAppBadge(unreadCount).catch(function(){});
        }else if(navigator.clearAppBadge){
            navigator.clearAppBadge().catch(function(){});
        }
    }

    function renderNotificationPanel(recipient){
        const list =
            notificationToolbarEl?.querySelector("#notificationList");

        if(!list){
            return;
        }

        const notifications =
            getMergedNotifications(recipient);

        if(notifications.length === 0){
            list.innerHTML =
                '<div class="notification-empty">No notifications yet.</div>';

            return;
        }

        list.innerHTML =
            notifications
                .map(function(item){
                    return `
                        <div
                            class="notification-item ${item.read ? "" : "unread"}"
                            data-id="${escapeHtml(item.id)}"
                            data-source="${escapeHtml(item.source)}"
                            data-type="${escapeHtml(item.type || "")}"
                        >
                            <strong>${escapeHtml(item.message)}</strong>
                            <small>${escapeHtml(formatNotificationDate(item))}</small>
                        </div>
                    `;
                })
                .join("");

        list
            .querySelectorAll(".notification-item")
            .forEach(function(row){
                row.addEventListener("click", function(){
                    if(row.dataset.source === "server"){
                        CrownServerNotifications.markRead(row.dataset.id);
                    }else if(row.dataset.source === "client"){
                        window.CrownClientNotifications?.markRead?.(row.dataset.id);
                    }else{
                        CrownNotifications.markRead(row.dataset.id);
                    }

                    row.classList.remove("unread");
                    updateNotificationBadge(recipient);

                    const destination =
                        getNotificationDestination(row.dataset.type);

                    if(destination){
                        window.location.href = destination;
                    }
                });
            });
    }

    /* Maps a notification's type to the page it's about, so tapping/
       clicking a notification (bell panel or a future push notification)
       takes the user straight there instead of just marking it read. */
    const NOTIFICATION_TYPE_PAGES = {
        schedule: "staff-management.html?tab=schedule",
        attendance: "attendance.html",
        memo: "bulletin-board.html?tab=memo",
        announcement: "bulletin-board.html?tab=announcement",
        "booking-request": "booking-requests.html"
    };

    function getNotificationDestination(type){
        const page = NOTIFICATION_TYPE_PAGES[type || "schedule"];

        if(!page){
            return null;
        }

        const current =
            currentPageFileName() + window.location.search;

        if(page === current){
            return null;
        }

        return page;
    }

    function currentPageFileName(){
        return (
            window.location.pathname.split("/").pop() || "index.html"
        );
    }

    function formatNotificationDate(item){
        const created =
            item.createdAt ? new Date(item.createdAt) : null;

        const stamp =
            created && !isNaN(created)
                ? created.toLocaleString("en-PH", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit"
                  })
                : "";

        return [item.branch, stamp].filter(Boolean).join(" · ");
    }

    function getPageTitle(currentPage){
        const titles = {
            "home.html": "Dashboard",
            "index.html": "Daily Income Report",
            "clients.html": "Client Database",
            "scheduling.html": "Scheduling",
            "booking-requests.html": "Booking Requests",
            "monthly-report.html": "Monthly Summary",
            "expenses-report.html": "Expenses Report",
            "cashflow.html": "Cash Flow",
            "share-holder-report.html": "Share Holder Summary Report",
            "loyalty-card-summary.html": "Loyalty Card Sales Summary",
            "product-sales-summary.html": "Product Sales Summary",
            "statistics.html": "Statistics",
            "petty-cash.html": "Petty Cash",
            "therapist-sales.html": "Therapist Sales",
            "account-settings.html": "Account Settings",
            "list-services.html": "List of Services",
            "list-products.html": "List of Products",
            "list-therapists.html": "List of Therapists",
            "list-branches.html": "List of Branches",
            "data-protection.html": "System Health / Database",
            "attendance.html": "Attendance",
            "payroll.html": "Payroll",
            "list-vouchers.html": "Voucher Masterlist",
            "invoice-report.html": "Sales Invoice Summary",
            "inventory-warehouse.html": "Warehouse",
            "inventory-branches.html": "Branches",
            "inventory-items.html": "Inventory Settings",
            "admin-announcement.html": "Announcement",
            "memos.html": "Memo",
            "staff-schedule.html": "Staff Schedule",
            "leave-requests.html": "Leave Request",
            "incident-report.html": "Incident Report",
            "201-files.html": "201 Files",
            "bulletin-board.html": "Bulletin Board",
            "staff-management.html": "Staff Management",
            "marketing-ads-daily.html": "Ads Monitoring",
            "marketing-ads-summary.html": "Monitoring Summary",
            "marketing-daily-report.html": "Daily Report",
            "bir-compliance.html": "BIR Compliance Desk"
        };

        return titles[currentPage] || "CrownOS";
    }

    function syncGlobalToolbarToPage(currentPage){
        const toolbarBranch =
            document.getElementById("sidebarDashboardBranch");

        const toolbarDate =
            document.getElementById("sidebarDashboardDate");

        const branch =
            toolbarBranch?.value ||
            localStorage.getItem(BRANCH_KEY) ||
            "";

        const date =
            toolbarDate?.value ||
            localStorage.getItem("crownGlobalDate") ||
            getTodayValue();

        const pageBranchSelectors = [
            document.getElementById("branchSelect"),
            document.getElementById("scheduleBranch")
        ].filter(Boolean);

        pageBranchSelectors.forEach(function(select){
            if(
                Array.from(select.options || [])
                    .some(function(option){
                        return option.value === branch;
                    })
            ){
                select.value = branch;
            }

            select.dispatchEvent(
                new Event("change", {
                    bubbles: true
                })
            );
        });

        const pageDateInputs = [
            document.getElementById("scheduleDate"),
            document.getElementById("date"),
            document.getElementById("selectedDate")
        ].filter(Boolean);

        pageDateInputs.forEach(function(input){
            input.value = date;

            input.dispatchEvent(
                new Event("change", {
                    bubbles: true
                })
            );
        });

        const monthValue =
            String(date).slice(0, 7);

        [
            document.getElementById("month"),
            document.getElementById("statisticsMonth")
        ]
            .filter(Boolean)
            .forEach(function(input){
                input.value = monthValue;

                input.dispatchEvent(
                    new Event("change", {
                        bubbles: true
                    })
                );
            });

        window.dispatchEvent(
            new CustomEvent(
                "crownGlobalFiltersChanged",
                {
                    detail: {
                        branch: branch,
                        date: date,
                        page: currentPage
                    }
                }
            )
        );
    }

    function getTodayValue(){
        const today = new Date();

        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");
    }

    /* "YYYY-MM-DD" -> "YYYY-MM-DD", offset by `days` (may be negative).
       Parsed as a local midnight Date (not UTC) so it lines up with what
       a <input type="date"> field itself displays/accepts, then handles
       its own month/year rollover via the native Date object. Exposed on
       window since every page's own date-stepper (scheduling.js,
       attendance.js, etc.) needs the exact same arithmetic. */
    function addDaysToDateValue(dateValue, days){
        const parts =
            String(dateValue || "").split("-").map(Number);

        if(parts.length !== 3 || parts.some(isNaN)){
            return dateValue;
        }

        const date =
            new Date(parts[0], parts[1] - 1, parts[2]);

        date.setDate(date.getDate() + days);

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    window.CrownDateStepper = {
        addDays: addDaysToDateValue
    };

    function notifyDashboard(){
        document.dispatchEvent(
            new CustomEvent(
                "crownDashboardFilterChanged"
            )
        );
    }

    function escapeHtml(value){
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }
})();
