/* ==========================================================================
   CrownOS — Daily Monitoring Sheet (Admin Hub)

   Firestore collection "dailyMonitoring" — one doc per (branch, date,
   staff account). Write access is open to any authenticated user in
   firestore.rules (same "Team Leader isn't a custom claim" reason as
   staffSchedules / staffScheduleGrids) and gated to Team Leader accounts
   here in the UI. Admin / Executive Assistant can view the sheet but
   cannot edit an inspection — only the account with teamLeader === true
   can.

   The Staff column reads the Opening/Closing roster straight out of
   staffScheduleGrids (see staff-schedule.js) instead of duplicating a
   second "who's on duty" list — a branch/date shows nobody here until
   it has an Opening or Closing assignment in Staff Schedule.
   ========================================================================== */

(function(){
    const COLLECTION = "dailyMonitoring";
    const GRID_COLLECTION = "staffScheduleGrids";
    const BRANCH_KEY = "crownSelectedBranch";
    const USER_ACCOUNTS_KEY = "crownUserAccounts";
    const MONITOR_DATE_KEY = "crownDailyMonitoringDate";

    const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    let currentUser = null;
    let canEdit = false;
    let isPersonalView = false;
    let selectedDate = getTodayValue();
    let monitorDocsCache = {};
    let staffListCache = [];
    let inspectingRow = null;

    let selectedMonth = getCurrentMonthValue();
    let personalDocsCache = [];

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getTodayValue(){
        const today = new Date();

        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");
    }

    function addDaysToDateValue(value, days){
        const date = new Date(value + "T00:00:00");
        date.setDate(date.getDate() + days);

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function getCurrentMonthValue(){
        const today = new Date();

        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0")
        ].join("-");
    }

    function addMonthsToMonthValue(value, months){
        const [year, month] = value.split("-").map(Number);
        const date = new Date(year, month - 1 + months, 1);

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0")
        ].join("-");
    }

    /* All calendar days in the given "YYYY-MM" month that have already
       occurred (so a personal history table never shows future dates),
       oldest first. */
    function daysInMonthSoFar(monthValue){
        const [year, month] = monthValue.split("-").map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const today = getTodayValue();

        const days = [];

        for(let day = 1; day <= lastDay; day++){
            const value = [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");

            if(value > today){
                break;
            }

            days.push(value);
        }

        return days;
    }

    function formatDateForRow(value){
        const date = new Date(value + "T00:00:00");

        return date.toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    function getCurrentBranch(){
        return localStorage.getItem(BRANCH_KEY) || "";
    }

    function getUserAccounts(){
        try{
            const raw = localStorage.getItem(USER_ACCOUNTS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function getStaffDisplayNameByAccount(account){
        const user = getUserAccounts().find(function(item){
            return item.account === account;
        });

        return (user && user.nickname) || account;
    }

    function slug(value){
        return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    function mondayOf(dateValue){
        const date = new Date(dateValue + "T00:00:00");
        const day = date.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        date.setDate(date.getDate() + diff);

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function dayKeyOf(dateValue){
        const jsDay = new Date(dateValue + "T00:00:00").getDay();
        return DAY_KEYS[(jsDay + 6) % 7];
    }

    /* Staff considered "on duty" for a branch/date are whoever the Staff
       Schedule (Staff Management → Staff Schedule tab) has in the
       Opening or Closing row for that day — the roster the Team Leader
       and Admin/EA already build there, not a second one duplicated
       here. See staff-schedule.js for the grid's shape:
       staffScheduleGrids/{slug(branch)}_{weekStartDate}. */
    async function getStaffOnDuty(branch, date){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return [];
        }

        const docId = slug(branch) + "_" + mondayOf(date);
        const dayKey = dayKeyOf(date);

        try{
            const doc = await firebase.firestore()
                .collection(GRID_COLLECTION)
                .doc(docId)
                .get();

            if(!doc.exists){
                return [];
            }

            const grid = doc.data();
            const accounts = [];

            function collect(dayMap){
                const value = dayMap && dayMap[dayKey];

                if(value){
                    accounts.push(value);
                }
            }

            collect(grid.opening?.receptionist);
            (grid.opening?.therapists || []).forEach(collect);
            collect(grid.closing?.receptionist);
            (grid.closing?.therapists || []).forEach(collect);

            const seen = new Set();
            const staff = [];

            accounts.forEach(function(account){
                if(seen.has(account)){
                    return;
                }

                seen.add(account);

                staff.push({
                    account: account,
                    name: getStaffDisplayNameByAccount(account)
                });
            });

            staff.sort(function(a, b){
                return a.name.localeCompare(b.name);
            });

            return staff;
        }catch(error){
            console.error("Unable to load the Staff Schedule roster:", error);
            return [];
        }
    }

    function monitorDocId(branch, date, account){
        return encodeURIComponent(branch) + "__" + date + "__" + encodeURIComponent(account);
    }

    function isPastCutoff(date){
        const today = getTodayValue();

        if(date < today){
            return true;
        }

        if(date > today){
            return false;
        }

        const now = new Date();
        return now.getHours() === 23 && now.getMinutes() >= 59 || now.getHours() > 23;
    }

    function formatSubmittedAt(value){
        let jsDate = null;

        if(value && typeof value.toDate === "function"){
            jsDate = value.toDate();
        }else if(value){
            jsDate = new Date(value);
        }

        if(!jsDate || isNaN(jsDate.getTime())){
            return "";
        }

        return jsDate.toLocaleTimeString("en-PH", {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function renderActionCell(doc, staff, pastCutoff){
        if(doc && doc.status === "submitted"){
            return `
                <span class="monitor-status-badge monitor-status-submitted">
                    Inspected at ${escapeHtml(formatSubmittedAt(doc.submittedAt))}
                </span>
            `;
        }

        if(pastCutoff){
            return `
                <span class="monitor-status-badge monitor-status-missed">
                    Not Inspected
                </span>
            `;
        }

        if(canEdit){
            return `
                <button
                    type="button"
                    class="btn btn-sm btn-primary monitor-inspect-btn"
                    data-account="${escapeHtml(staff.account)}"
                    data-staff-name="${escapeHtml(staff.name)}"
                >
                    Inspect
                </button>
            `;
        }

        return `
            <span class="monitor-status-badge monitor-status-pending">
                Pending
            </span>
        `;
    }

    /* Color coding per column — same word can mean a different color in
       a different column (e.g. "Not Available" is purple for both Name
       Tags and Walkie Talkie, but there's no shared meaning across
       columns otherwise), so each column gets its own value → tone map. */
    const TONE_MAPS = {
        attendance: {
            "Early": "green",
            "On-Time": "green",
            "Late": "orange",
            "Absent": "red"
        },
        uniform: {
            "Tidy": "green",
            "Just Right": "green",
            "Needs Improvement": "orange",
            "Inappropriate": "red"
        },
        nameTags: {
            "Okay": "green",
            "Forgotten": "yellow",
            "Lost": "red",
            "Not Available": "purple"
        },
        walkieTalkie: {
            "Complete and Working": "green",
            "Low Battery": "yellow",
            "No Ear Piece": "red",
            "Not Working": "red",
            "Not Available": "purple"
        },
        readiness: {
            "Ready": "green",
            "Need Guidance/Assistance": "light-green",
            "Not Ready": "yellow",
            "Unsubmissive": "red"
        }
    };

    function cell(value){
        return value
            ? escapeHtml(value)
            : '<span class="monitor-blank">—</span>';
    }

    function toneCell(field, value){
        if(!value){
            return '<span class="monitor-blank">—</span>';
        }

        const tone = TONE_MAPS[field]?.[value] || "";

        return `
            <span class="monitor-tag monitor-tag-${tone}">
                ${escapeHtml(value)}
            </span>
        `;
    }

    function renderTable(){
        const branch = getCurrentBranch();

        const branchEmpty = document.getElementById("monitorBranchEmpty");
        const tableWrap = document.getElementById("monitorTableWrap");
        const emptyState = document.getElementById("monitorEmptyState");

        if(!branch){
            branchEmpty.classList.remove("d-none");
            tableWrap.classList.add("d-none");
            emptyState.classList.add("d-none");
            return;
        }

        branchEmpty.classList.add("d-none");
        tableWrap.classList.remove("d-none");

        const pastCutoff = isPastCutoff(selectedDate);

        const body = document.getElementById("monitorTableBody");

        if(staffListCache.length === 0){
            body.innerHTML = "";
            emptyState.classList.remove("d-none");
            return;
        }

        emptyState.classList.add("d-none");

        body.innerHTML = staffListCache.map(function(staff){
            const doc = monitorDocsCache[staff.account] || null;

            return `
                <tr>
                    <td class="monitor-staff-name">${escapeHtml(staff.name)}</td>
                    <td>${toneCell("attendance", doc && doc.attendance)}</td>
                    <td>${toneCell("uniform", doc && doc.uniform)}</td>
                    <td>${toneCell("nameTags", doc && doc.nameTags)}</td>
                    <td>${toneCell("walkieTalkie", doc && doc.walkieTalkie)}</td>
                    <td>${toneCell("readiness", doc && doc.readiness)}</td>
                    <td>${cell(doc && doc.notes)}</td>
                    <td>${renderActionCell(doc, staff, pastCutoff)}</td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".monitor-inspect-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openInspectModal(btn.dataset.account, btn.dataset.staffName);
            });
        });
    }

    async function loadMonitorDocs(branch){
        monitorDocsCache = {};

        if(!branch || !window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        try{
            const snapshot = await firebase.firestore()
                .collection(COLLECTION)
                .where("branch", "==", branch)
                .where("date", "==", selectedDate)
                .get();

            snapshot.docs.forEach(function(doc){
                const data = doc.data();
                monitorDocsCache[data.staffAccount] = data;
            });
        }catch(error){
            console.error("Unable to load Daily Monitoring Sheet data:", error);
        }
    }

    async function refresh(){
        const branch = getCurrentBranch();

        if(!branch){
            staffListCache = [];
            monitorDocsCache = {};
            renderTable();
            return;
        }

        staffListCache = await getStaffOnDuty(branch, selectedDate);
        await loadMonitorDocs(branch);
        renderTable();
    }

    /* ---- Personal view — every non Admin/EA/Team Leader account sees
       only their own accomplished assessments, one row per date instead
       of one row per staff member. Also reused by the Admin / EA / Team
       Leader "Staff Monthly History" picker below, which renders the
       exact same shape for whichever staff account is picked. ---- */

    async function loadMonthDocsForAccount(account, month){
        if(!account || !window.firebase || !firebase.apps || firebase.apps.length === 0){
            return [];
        }

        const monthStart = month + "-01";
        const [year, monthNum] = month.split("-").map(Number);
        const monthEnd = month + "-" + String(new Date(year, monthNum, 0).getDate()).padStart(2, "0");

        try{
            const snapshot = await firebase.firestore()
                .collection(COLLECTION)
                .where("staffAccount", "==", account)
                .where("date", ">=", monthStart)
                .where("date", "<=", monthEnd)
                .get();

            return snapshot.docs.map(function(doc){
                return doc.data();
            });
        }catch(error){
            console.error("Unable to load assessment history:", error);
            return [];
        }
    }

    function renderMonthTable(docs, month, bodyId, emptyStateId){
        const body = document.getElementById(bodyId);
        const emptyState = document.getElementById(emptyStateId);

        const docsByDate = {};
        docs.forEach(function(doc){
            docsByDate[doc.date] = doc;
        });

        const days = daysInMonthSoFar(month);

        if(docs.length === 0){
            body.innerHTML = "";
            emptyState.classList.remove("d-none");
            return;
        }

        emptyState.classList.add("d-none");

        body.innerHTML = days.map(function(dateValue){
            const doc = docsByDate[dateValue] || null;

            return `
                <tr>
                    <td class="monitor-staff-name">${escapeHtml(formatDateForRow(dateValue))}</td>
                    <td>${toneCell("attendance", doc && doc.attendance)}</td>
                    <td>${toneCell("uniform", doc && doc.uniform)}</td>
                    <td>${toneCell("nameTags", doc && doc.nameTags)}</td>
                    <td>${toneCell("walkieTalkie", doc && doc.walkieTalkie)}</td>
                    <td>${toneCell("readiness", doc && doc.readiness)}</td>
                    <td>${cell(doc && doc.notes)}</td>
                    <td>${cell(doc && formatSubmittedAt(doc.submittedAt))}</td>
                </tr>
            `;
        }).join("");
    }

    async function refreshPersonal(){
        personalDocsCache = await loadMonthDocsForAccount(currentUser.account, selectedMonth);
        renderMonthTable(personalDocsCache, selectedMonth, "monitorPersonalTableBody", "monitorPersonalEmptyState");
    }

    function applyMonth(value){
        selectedMonth = value || getCurrentMonthValue();

        document.getElementById("monitorMonthInput").value = selectedMonth;

        refreshPersonal();
    }

    /* ---- Staff Monthly History — Admin / EA / Team Leader picker ---- */

    let selectedHistoryStaff = "";
    let selectedHistoryMonth = getCurrentMonthValue();
    let historyDocsCache = [];

    function getAssessableStaffForBranch(branch){
        return getUserAccounts()
            .filter(function(user){
                return (
                    (user.role === "Therapist" || user.role === "Receptionist") &&
                    Array.isArray(user.branches) &&
                    user.branches.includes(branch)
                );
            })
            .map(function(user){
                return { account: user.account, name: user.nickname || user.account };
            })
            .sort(function(a, b){
                return a.name.localeCompare(b.name);
            });
    }

    function populateStaffPicker(){
        const select = document.getElementById("monitorStaffPickerInput");
        const branch = getCurrentBranch();
        const staff = branch ? getAssessableStaffForBranch(branch) : [];

        const previousValue = selectedHistoryStaff;

        select.innerHTML =
            '<option value="">Select a staff member</option>' +
            staff.map(function(person){
                return `<option value="${escapeHtml(person.account)}">${escapeHtml(person.name)}</option>`;
            }).join("");

        selectedHistoryStaff = staff.some(function(person){ return person.account === previousValue; })
            ? previousValue
            : "";

        select.value = selectedHistoryStaff;
        select.disabled = !branch;
    }

    async function refreshHistory(){
        const staffEmpty = document.getElementById("monitorHistoryStaffEmpty");
        const tableWrap = document.getElementById("monitorHistoryTableWrap");
        const emptyState = document.getElementById("monitorHistoryEmptyState");

        if(!selectedHistoryStaff){
            staffEmpty.classList.remove("d-none");
            tableWrap.classList.add("d-none");
            emptyState.classList.add("d-none");
            return;
        }

        staffEmpty.classList.add("d-none");
        tableWrap.classList.remove("d-none");

        historyDocsCache = await loadMonthDocsForAccount(selectedHistoryStaff, selectedHistoryMonth);
        renderMonthTable(historyDocsCache, selectedHistoryMonth, "monitorHistoryTableBody", "monitorHistoryEmptyState");
    }

    function applyHistoryMonth(value){
        selectedHistoryMonth = value || getCurrentMonthValue();

        document.getElementById("monitorHistoryMonthInput").value = selectedHistoryMonth;

        refreshHistory();
    }

    /* ---- Inspect modal ---- */

    function openInspectModal(account, staffName){
        inspectingRow = { account, staffName };

        document.getElementById("monitorModalTitle").textContent =
            "Inspect — " + staffName;

        document.getElementById("monitorAttendanceInput").value = "";
        document.getElementById("monitorUniformInput").value = "";
        document.getElementById("monitorNameTagInput").value = "";
        document.getElementById("monitorWalkieInput").value = "";
        document.getElementById("monitorReadinessInput").value = "";
        document.getElementById("monitorNotesInput").value = "";

        document.getElementById("monitorModalBackdrop").classList.remove("d-none");
    }

    function closeInspectModal(){
        inspectingRow = null;
        document.getElementById("monitorModalBackdrop").classList.add("d-none");
    }

    async function submitInspection(){
        if(!inspectingRow){
            return;
        }

        const attendance = document.getElementById("monitorAttendanceInput").value;
        const uniform = document.getElementById("monitorUniformInput").value;
        const nameTags = document.getElementById("monitorNameTagInput").value;
        const walkieTalkie = document.getElementById("monitorWalkieInput").value;
        const readiness = document.getElementById("monitorReadinessInput").value;
        const notes = document.getElementById("monitorNotesInput").value.trim();

        if(!attendance || !uniform || !nameTags || !walkieTalkie || !readiness){
            alert("Please fill out every field before submitting.");
            return;
        }

        const branch = getCurrentBranch();
        const btn = document.getElementById("monitorSubmitBtn");
        btn.disabled = true;

        try{
            await firebase.firestore()
                .collection(COLLECTION)
                .doc(monitorDocId(branch, selectedDate, inspectingRow.account))
                .set({
                    branch: branch,
                    date: selectedDate,
                    staffAccount: inspectingRow.account,
                    staffName: inspectingRow.staffName,
                    attendance: attendance,
                    uniform: uniform,
                    nameTags: nameTags,
                    walkieTalkie: walkieTalkie,
                    readiness: readiness,
                    notes: notes,
                    status: "submitted",
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    submittedByAccount: currentUser.account,
                    submittedByName: currentUser.nickname || currentUser.account
                });

            closeInspectModal();
            await refresh();
        }catch(error){
            console.error("Unable to submit inspection:", error);
            alert("Unable to submit this inspection. Please try again.");
        }finally{
            btn.disabled = false;
        }
    }

    /* ---- Date stepper ---- */

    function applyDate(value){
        selectedDate = value || getTodayValue();

        localStorage.setItem(MONITOR_DATE_KEY, selectedDate);

        document.getElementById("monitorDateInput").value = selectedDate;

        refresh();
    }

    /* ---- Tabs ---- */

    const PANELS = {
        staff: "staffTabPanel",
        inventory: "inventoryTabPanel",
        marketing: "marketingTabPanel",
        clients: "clientsTabPanel"
    };

    function selectTab(tab){
        if(!PANELS[tab]){
            tab = "staff";
        }

        document.querySelectorAll('#monitoringTabs [role="tab"]').forEach(function(btn){
            btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
        });

        Object.keys(PANELS).forEach(function(key){
            document.getElementById(PANELS[key]).classList.toggle("d-none", key !== tab);
        });
    }

    document.addEventListener("DOMContentLoaded", function(){
        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        canEdit = currentUser.teamLeader === true;

        const effectiveRole = window.CrownAuth?.getEffectiveRole?.(currentUser) || currentUser.role;
        isPersonalView = !(
            effectiveRole === "Admin" ||
            effectiveRole === "Executive Assistant" ||
            currentUser.teamLeader === true
        );

        document.querySelectorAll('#monitoringTabs [role="tab"]').forEach(function(btn){
            btn.addEventListener("click", function(){
                selectTab(btn.dataset.tab);
            });
        });

        selectTab("staff");

        document.getElementById("monitorModalCloseBtn").addEventListener("click", closeInspectModal);
        document.getElementById("monitorCancelBtn").addEventListener("click", closeInspectModal);
        document.getElementById("monitorSubmitBtn").addEventListener("click", submitInspection);

        document.getElementById("monitorModalBackdrop").addEventListener("click", function(event){
            if(event.target === this){
                closeInspectModal();
            }
        });

        if(isPersonalView){
            document.getElementById("monitorPersonalView").classList.remove("d-none");

            selectedMonth = getCurrentMonthValue();
            document.getElementById("monitorMonthInput").value = selectedMonth;

            document.getElementById("monitorMonthInput").addEventListener("change", function(){
                applyMonth(this.value);
            });

            document.getElementById("monitorPrevMonthBtn").addEventListener("click", function(){
                applyMonth(addMonthsToMonthValue(selectedMonth, -1));
            });

            document.getElementById("monitorNextMonthBtn").addEventListener("click", function(){
                applyMonth(addMonthsToMonthValue(selectedMonth, 1));
            });

            refreshPersonal();
            return;
        }

        document.getElementById("monitorTeamView").classList.remove("d-none");

        selectedDate = localStorage.getItem(MONITOR_DATE_KEY) || getTodayValue();
        document.getElementById("monitorDateInput").value = selectedDate;

        document.getElementById("monitorDateInput").addEventListener("change", function(){
            applyDate(this.value);
        });

        document.getElementById("monitorPrevDayBtn").addEventListener("click", function(){
            applyDate(addDaysToDateValue(selectedDate, -1));
        });

        document.getElementById("monitorNextDayBtn").addEventListener("click", function(){
            applyDate(addDaysToDateValue(selectedDate, 1));
        });

        document.getElementById("monitorTodayBtn").addEventListener("click", function(){
            applyDate(getTodayValue());
        });

        selectedHistoryMonth = getCurrentMonthValue();
        document.getElementById("monitorHistoryMonthInput").value = selectedHistoryMonth;

        document.getElementById("monitorStaffPickerInput").addEventListener("change", function(){
            selectedHistoryStaff = this.value;
            refreshHistory();
        });

        document.getElementById("monitorHistoryMonthInput").addEventListener("change", function(){
            applyHistoryMonth(this.value);
        });

        document.getElementById("monitorHistoryPrevMonthBtn").addEventListener("click", function(){
            applyHistoryMonth(addMonthsToMonthValue(selectedHistoryMonth, -1));
        });

        document.getElementById("monitorHistoryNextMonthBtn").addEventListener("click", function(){
            applyHistoryMonth(addMonthsToMonthValue(selectedHistoryMonth, 1));
        });

        window.addEventListener("crownGlobalFiltersChanged", function(){
            refresh();
            populateStaffPicker();
            refreshHistory();
        });

        /* Re-render on a slow tick so a row still open past 11:59 PM
           locks itself (Not Inspected) without needing a manual reload. */
        setInterval(renderTable, 60000);

        populateStaffPicker();
        refreshHistory();
        refresh();
    });
})();
