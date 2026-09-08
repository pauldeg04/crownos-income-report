/* ==========================================================================
   CrownOS — Daily Monitoring Sheet (Admin Hub)

   Firestore collection "dailyMonitoring" — one doc per (branch, date,
   staff). Write access is open to any authenticated user in
   firestore.rules (same "Team Leader isn't a custom claim" reason as
   staffSchedules / staffScheduleGrids) and gated to Team Leader accounts
   here in the UI. Admin / Executive Assistant can view the sheet but
   cannot edit an inspection — only the account with teamLeader === true
   can.
   ========================================================================== */

(function(){
    const COLLECTION = "dailyMonitoring";
    const BRANCH_KEY = "crownSelectedBranch";
    const ATTENDANCE_LOG_KEY = "crownAttendanceLog";
    const USER_ACCOUNTS_KEY = "crownUserAccounts";
    const MONITOR_DATE_KEY = "crownDailyMonitoringDate";

    const ATTENDANCE_OPTIONS = ["Early", "On-Time", "Late"];
    const UNIFORM_OPTIONS = ["Tidy", "Just Right", "Needs Improvement"];
    const NAME_TAG_OPTIONS = ["Okay", "Forgotten", "Lost", "Not Available"];

    const WALKIE_OPTIONS = [
        "Complete and Working",
        "Low Battery",
        "No Ear Piece",
        "Not Working",
        "Not Available"
    ];

    const READINESS_OPTIONS = ["Ready", "Need Guidance/Assistance", "Not Ready"];

    let currentUser = null;
    let canEdit = false;
    let selectedDate = getTodayValue();
    let monitorDocsCache = {};
    let inspectingRow = null;

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

    function getAttendanceLog(){
        try{
            const raw = localStorage.getItem(ATTENDANCE_LOG_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function getStaffDisplayName(userId, fallbackAccount){
        const user = getUserAccounts().find(function(item){
            return item.id === userId;
        });

        if(user && user.nickname){
            return user.nickname;
        }

        return fallbackAccount || (user ? user.account : "Unknown");
    }

    /* Staff considered "on duty" for a branch/date are the staff who
       clocked in at that branch on that date — see attendance.js, the
       source this reuses instead of duplicating a second roster. */
    function getStaffOnDuty(branch, date){
        const seen = new Set();
        const staff = [];

        getAttendanceLog()
            .filter(function(entry){
                return entry.date === date && entry.branch === branch;
            })
            .forEach(function(entry){
                if(seen.has(entry.userId)){
                    return;
                }

                seen.add(entry.userId);

                staff.push({
                    userId: entry.userId,
                    name: getStaffDisplayName(entry.userId, entry.account)
                });
            });

        staff.sort(function(a, b){
            return a.name.localeCompare(b.name);
        });

        return staff;
    }

    function monitorDocId(branch, date, userId){
        return encodeURIComponent(branch) + "__" + date + "__" + encodeURIComponent(userId);
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
                    data-user-id="${escapeHtml(staff.userId)}"
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

    function cell(value){
        return value
            ? escapeHtml(value)
            : '<span class="monitor-blank">—</span>';
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

        const staffList = getStaffOnDuty(branch, selectedDate);
        const pastCutoff = isPastCutoff(selectedDate);

        const body = document.getElementById("monitorTableBody");

        if(staffList.length === 0){
            body.innerHTML = "";
            emptyState.classList.remove("d-none");
            return;
        }

        emptyState.classList.add("d-none");

        body.innerHTML = staffList.map(function(staff){
            const doc = monitorDocsCache[staff.userId] || null;

            return `
                <tr>
                    <td class="monitor-staff-name">${escapeHtml(staff.name)}</td>
                    <td>${cell(doc && doc.attendance)}</td>
                    <td>${cell(doc && doc.uniform)}</td>
                    <td>${cell(doc && doc.nameTags)}</td>
                    <td>${cell(doc && doc.walkieTalkie)}</td>
                    <td>${cell(doc && doc.readiness)}</td>
                    <td>${cell(doc && doc.notes)}</td>
                    <td>${renderActionCell(doc, staff, pastCutoff)}</td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".monitor-inspect-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openInspectModal(btn.dataset.userId, btn.dataset.staffName);
            });
        });
    }

    async function loadMonitorDocs(){
        monitorDocsCache = {};

        const branch = getCurrentBranch();

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
                monitorDocsCache[data.staffId] = data;
            });
        }catch(error){
            console.error("Unable to load Daily Monitoring Sheet data:", error);
        }
    }

    async function refresh(){
        await loadMonitorDocs();
        renderTable();
    }

    /* ---- Inspect modal ---- */

    function openInspectModal(userId, staffName){
        inspectingRow = { userId, staffName };

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
                .doc(monitorDocId(branch, selectedDate, inspectingRow.userId))
                .set({
                    branch: branch,
                    date: selectedDate,
                    staffId: inspectingRow.userId,
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

        selectedDate = localStorage.getItem(MONITOR_DATE_KEY) || getTodayValue();
        document.getElementById("monitorDateInput").value = selectedDate;

        document.querySelectorAll('#monitoringTabs [role="tab"]').forEach(function(btn){
            btn.addEventListener("click", function(){
                selectTab(btn.dataset.tab);
            });
        });

        selectTab("staff");

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

        document.getElementById("monitorModalCloseBtn").addEventListener("click", closeInspectModal);
        document.getElementById("monitorCancelBtn").addEventListener("click", closeInspectModal);
        document.getElementById("monitorSubmitBtn").addEventListener("click", submitInspection);

        document.getElementById("monitorModalBackdrop").addEventListener("click", function(event){
            if(event.target === this){
                closeInspectModal();
            }
        });

        window.addEventListener("crownGlobalFiltersChanged", function(){
            refresh();
        });

        /* Re-render on a slow tick so a row still open past 11:59 PM
           locks itself (Not Inspected) without needing a manual reload. */
        setInterval(renderTable, 60000);

        refresh();
    });
})();
