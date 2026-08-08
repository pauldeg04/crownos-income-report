const ATTENDANCE_LOG_KEY = "crownAttendanceLog";
const USER_ACCOUNTS_KEY = "crownUserAccounts";
const BRANCH_MASTER_KEY = "crownBranchMasterList";
const DUTY_LOG_KEY = "crownDutyLog";

const ATTENDANCE_ADMIN_ROLES = ["Admin", "Executive Assistant"];

let currentUser = null;
let editingEntryId = null;

document.addEventListener("DOMContentLoaded", function(){
    currentUser =
        window.CrownAuth?.getCurrentUser?.();

    if(!currentUser){
        return;
    }

    initializeMonth();
    setupAdminView();
    attachEvents();
    renderAttendance();

    /* Retries any attendance entry (any staff member's — Admin can see
       and edit everyone's here, unlike clock-widget.js which only
       retries the signed-in user's own) still flagged pendingCloudSync
       from a save/delete that couldn't reach Firestore at the time. See
       attendance-sync.js. */
    window.CrownAttendanceSync?.retryPending?.();
    window.addEventListener("online", function(){
        window.CrownAttendanceSync?.retryPending?.();
    });
});

function attachEvents(){
    document
        .getElementById("attendanceMonth")
        .addEventListener("change", renderAttendance);

    document
        .getElementById("attendanceDay")
        .addEventListener("change", renderAttendance);

    document
        .getElementById("clearDayFilterBtn")
        .addEventListener("click", function(){
            document.getElementById("attendanceDay").value = "";
            renderAttendance();
        });

    document
        .getElementById("prevAttendanceDayBtn")
        .addEventListener("click", function(){
            stepAttendanceDay(-1);
        });

    document
        .getElementById("nextAttendanceDayBtn")
        .addEventListener("click", function(){
            stepAttendanceDay(1);
        });

    document
        .getElementById("todayAttendanceDayBtn")
        .addEventListener("click", function(){
            const todayValue =
                getTodayDateString();

            document.getElementById("attendanceDay").value = todayValue;
            document.getElementById("attendanceMonth").value = todayValue.slice(0, 7);

            renderAttendance();
        });

    const staffFilter =
        document.getElementById("staffFilter");

    if(staffFilter){
        staffFilter.addEventListener("change", renderAttendance);
    }

    const addEntryBtn =
        document.getElementById("addEntryBtn");

    if(addEntryBtn){
        addEntryBtn.addEventListener("click", openAddModal);
    }

    document
        .getElementById("closeAttendanceModalBtn")
        .addEventListener("click", closeAttendanceModal);

    document
        .getElementById("cancelAttendanceModalBtn")
        .addEventListener("click", closeAttendanceModal);

    document
        .getElementById("saveAttendanceModalBtn")
        .addEventListener("click", saveAttendanceEntry);

    document
        .getElementById("modalAttendanceStaff")
        .addEventListener("change", syncDutyRoleField);

    document
        .getElementById("modalAttendanceDate")
        .addEventListener("change", syncDutyRoleField);

    document
        .getElementById("attendanceModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeAttendanceModal();
            }
        });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeAttendanceModal();
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

function createId(){
    return (
        "ATT-" +
        Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 7).toUpperCase()
    );
}

function getTodayDateString(){
    const today =
        new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
}

/* Stepping always sets an explicit Day filter (even from a month-only
   view) — the Day field takes full priority over Month once set (see
   renderAttendance's matchesPeriod), so Month is only kept in sync here
   for display, not for filtering correctness. */
function stepAttendanceDay(days){
    const dayInput =
        document.getElementById("attendanceDay");

    const monthInput =
        document.getElementById("attendanceMonth");

    const baseValue =
        dayInput.value ||
        (monthInput.value ? monthInput.value + "-01" : getTodayDateString());

    const newValue =
        window.CrownDateStepper?.addDays?.(baseValue, days) ||
        baseValue;

    dayInput.value = newValue;
    monthInput.value = newValue.slice(0, 7);

    renderAttendance();
}

function initializeMonth(){
    const input =
        document.getElementById("attendanceMonth");

    const today =
        new Date();

    input.value = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function isAdminView(){
    return ATTENDANCE_ADMIN_ROLES.includes(currentUser.role);
}

function getUserAccounts(){
    try{
        const raw =
            localStorage.getItem(USER_ACCOUNTS_KEY);

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

function getBranchNames(){
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
        console.error("Unable to load branches:", error);
        return [];
    }
}

function setupAdminView(){
    if(!isAdminView()){
        return;
    }

    document.getElementById("staffFilterWrapper")
        .classList.remove("d-none");

    document.getElementById("addEntryBtn")
        .classList.remove("d-none");

    document.getElementById("actionColumnHeader")
        .classList.remove("d-none");

    const staffFilter =
        document.getElementById("staffFilter");

    staffFilter.innerHTML =
        '<option value="">All Staff</option>' +
        getUserAccounts().map(function(user){
            return `
                <option value="${escapeHtml(user.id)}">
                    ${escapeHtml(user.account)}${user.status !== "Active" ? " (Inactive)" : ""}
                </option>
            `;
        }).join("");
}

/* A Therapist with Receptionist enabled as a secondary role — see
   account-settings.html's "Enable Secondary Role" checkbox and
   payroll.js's isDualRoleTherapist(), which this mirrors. */
function isDualRoleTherapist(user){
    return (
        !!user &&
        user.role === "Therapist" &&
        user.secondaryRole === "Receptionist"
    );
}

function getDutyLog(){
    try{
        const raw =
            localStorage.getItem(DUTY_LOG_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load duty log:", error);
        return {};
    }
}

function saveDutyLog(log){
    localStorage.setItem(DUTY_LOG_KEY, JSON.stringify(log));
}

/* Shows/hides the "Clock In/Out As" dropdown based on whether the
   selected staff member is a dual-role Therapist+Receptionist account,
   and preloads it with whatever duty was already logged for that date
   (payroll.js reads this same crownDutyLog entry to pick the day's
   formula — see getEffectiveRoleForDate). */
function syncDutyRoleField(){
    const userId =
        document.getElementById("modalAttendanceStaff").value;

    const user =
        getUserAccounts().find(function(item){
            return item.id === userId;
        });

    const wrapper =
        document.getElementById("modalAttendanceDutyRoleWrapper");

    if(!isDualRoleTherapist(user)){
        wrapper.classList.add("d-none");
        return;
    }

    wrapper.classList.remove("d-none");

    const dateValue =
        document.getElementById("modalAttendanceDate").value;

    const logged =
        dateValue ? getDutyLog()[userId + "_" + dateValue] : null;

    document.getElementById("modalAttendanceDutyRole").value =
        logged === "Receptionist" ? "Receptionist" : "Therapist";
}

function getAttendanceLog(){
    try{
        const raw =
            localStorage.getItem(ATTENDANCE_LOG_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed)
            ? parsed
            : [];
    }catch(error){
        console.error("Unable to load attendance log:", error);
        return [];
    }
}

function saveAttendanceLog(entries){
    localStorage.setItem(
        ATTENDANCE_LOG_KEY,
        JSON.stringify(entries)
    );
}

function formatDateLabel(dateValue){
    if(!dateValue){
        return "—";
    }

    return new Date(dateValue + "T00:00:00")
        .toLocaleDateString("en-PH", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric"
        });
}

function formatClockTime(isoString){
    if(!isoString){
        return "—";
    }

    return new Date(isoString)
        .toLocaleTimeString("en-PH", {
            hour: "numeric",
            minute: "2-digit"
        });
}

function getEntryDurationMinutes(entry){
    if(!entry.clockInAt || !entry.clockOutAt){
        return null;
    }

    return Math.max(
        0,
        (
            new Date(entry.clockOutAt) -
            new Date(entry.clockInAt)
        ) / 60000
    );
}

function formatDuration(minutes){
    if(minutes === null){
        return "In Progress";
    }

    const hours =
        Math.floor(minutes / 60);

    const mins =
        Math.round(minutes % 60);

    return `${hours}h ${mins}m`;
}

function renderGeoBadge(geo){
    if(!geo || !geo.status){
        return "";
    }

    if(geo.status === "within"){
        return `
            <span
                class="geo-check"
                title="Location verified — about ${geo.distance ?? "?"} m from the branch"
            >✔</span>
        `;
    }

    if(geo.status === "outside"){
        return `
            <span
                class="geo-badge geo-badge-outside"
                title="Clocked in about ${geo.distance ?? "?"} m away from the branch"
            >
                Outside branch${geo.distance ? ` (${geo.distance} m)` : ""}
            </span>
        `;
    }

    if(geo.status === "no_location"){
        return `
            <span
                class="geo-badge geo-badge-nogps"
                title="Location was unavailable or permission was denied"
            >
                No GPS
            </span>
        `;
    }

    return "";
}

function getAccountName(userId){
    const user =
        getUserAccounts().find(function(item){
            return item.id === userId;
        });

    return user ? user.account : "Unknown";
}

/* Daily Logs' Staff column prefers the user's current nickname (Account
   Settings' "Nickname" field, same one List of Therapists shows) over
   their login account name — falls back to the account name snapshotted
   on the entry (entry.account) for staff with no nickname set, or a
   deleted account, same as getAccountName() already did before this. */
function getStaffDisplayName(entry){
    const user =
        getUserAccounts().find(function(item){
            return item.id === entry.userId;
        });

    if(user && user.nickname){
        return user.nickname;
    }

    return entry.account || getAccountName(entry.userId);
}

function renderAttendance(){
    const monthValue =
        document.getElementById("attendanceMonth").value;

    const dayValue =
        document.getElementById("attendanceDay").value;

    const staffFilter =
        document.getElementById("staffFilter");

    const targetUserId =
        isAdminView()
            ? (staffFilter ? staffFilter.value : "")
            : currentUser.id;

    const entries =
        getAttendanceLog()
            .filter(function(entry){
                const matchesPeriod =
                    dayValue
                        ? entry.date === dayValue
                        : String(entry.date || "").startsWith(monthValue);

                const matchesUser =
                    !targetUserId ||
                    entry.userId === targetUserId;

                return matchesPeriod && matchesUser;
            })
            .sort(function(a, b){
                if(a.date !== b.date){
                    return a.date.localeCompare(b.date);
                }

                return String(a.clockInAt || "")
                    .localeCompare(String(b.clockInAt || ""));
            });

    const showStaffColumn =
        isAdminView() && !targetUserId;

    document.getElementById("accountColumnHeader")
        .classList.toggle("d-none", !showStaffColumn);

    const tbody =
        document.getElementById("attendanceBody");

    tbody.innerHTML = "";

    let totalMinutes = 0;

    entries.forEach(function(entry){
        const duration =
            getEntryDurationMinutes(entry);

        if(duration !== null){
            totalMinutes += duration;
        }

        const row =
            document.createElement("tr");

        if(!entry.clockOutAt){
            row.classList.add("attendance-row-open");
        }

        row.innerHTML = `
            <td>${formatDateLabel(entry.date)}</td>

            <td class="${showStaffColumn ? "" : "d-none"}">
                ${escapeHtml(getStaffDisplayName(entry))}
            </td>

            <td>${formatClockTime(entry.clockInAt)}${renderGeoBadge(entry.clockInGeo)}</td>

            <td>
                ${
                    entry.clockOutAt
                        ? formatClockTime(entry.clockOutAt)
                        : `
                            <span class="attendance-status-badge attendance-status-open">
                                Still In
                            </span>
                        `
                }
            </td>

            <td>${escapeHtml(entry.branch || "—")}</td>

            <td>${formatDuration(duration)}</td>

            <td class="${isAdminView() ? "" : "d-none"}">
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

        const editBtn =
            row.querySelector(".edit-btn");

        if(editBtn){
            editBtn.addEventListener("click", function(){
                openEditModal(entry.id);
            });
        }

        const deleteBtn =
            row.querySelector(".delete-btn");

        if(deleteBtn){
            deleteBtn.addEventListener("click", function(){
                deleteAttendanceEntry(entry.id);
            });
        }

        tbody.appendChild(row);
    });

    document.getElementById("totalHoursLabel").textContent =
        formatDuration(totalMinutes);

    document.getElementById("attendanceEmptyState")
        .classList.toggle("d-none", entries.length > 0);
}

function isoToDateInputValue(isoString){
    if(!isoString){
        return "";
    }

    const date =
        new Date(isoString);

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function isoToTimeInputValue(isoString){
    if(!isoString){
        return "";
    }

    const date =
        new Date(isoString);

    return (
        String(date.getHours()).padStart(2, "0") +
        ":" +
        String(date.getMinutes()).padStart(2, "0")
    );
}

function combineDateAndTime(dateValue, timeValue){
    if(!dateValue || !timeValue){
        return "";
    }

    return new Date(`${dateValue}T${timeValue}:00`)
        .toISOString();
}

function renderModalStaffOptions(selectedUserId){
    const select =
        document.getElementById("modalAttendanceStaff");

    select.innerHTML =
        '<option value="">Select Staff</option>' +
        getUserAccounts().map(function(user){
            return `
                <option
                    value="${escapeHtml(user.id)}"
                    ${user.id === selectedUserId ? "selected" : ""}
                >
                    ${escapeHtml(user.account)}${user.status !== "Active" ? " (Inactive)" : ""}
                </option>
            `;
        }).join("");
}

function renderModalBranchOptions(selectedBranch){
    const select =
        document.getElementById("modalAttendanceBranch");

    select.innerHTML =
        '<option value="">No Branch</option>' +
        getBranchNames().map(function(branch){
            return `
                <option
                    value="${escapeHtml(branch)}"
                    ${branch === selectedBranch ? "selected" : ""}
                >
                    ${escapeHtml(branch)}
                </option>
            `;
        }).join("");
}

function openAddModal(){
    editingEntryId = null;

    document.getElementById("attendanceModalTitle").textContent =
        "Add Attendance Entry";

    renderModalStaffOptions("");
    renderModalBranchOptions("");

    document.getElementById("modalAttendanceDate").value =
        document.getElementById("attendanceMonth").value + "-01";

    document.getElementById("modalAttendanceClockIn").value = "";
    document.getElementById("modalAttendanceClockOut").value = "";
    document.getElementById("modalAttendanceShiftType").value = "";

    syncDutyRoleField();

    showAttendanceModal();
}

function openEditModal(entryId){
    const entry =
        getAttendanceLog().find(function(item){
            return item.id === entryId;
        });

    if(!entry){
        return;
    }

    editingEntryId = entry.id;

    document.getElementById("attendanceModalTitle").textContent =
        "Edit Attendance Entry";

    renderModalStaffOptions(entry.userId);
    renderModalBranchOptions(entry.branch || "");

    document.getElementById("modalAttendanceDate").value =
        entry.date || "";

    document.getElementById("modalAttendanceClockIn").value =
        isoToTimeInputValue(entry.clockInAt);

    document.getElementById("modalAttendanceClockOut").value =
        isoToTimeInputValue(entry.clockOutAt);

    document.getElementById("modalAttendanceShiftType").value =
        entry.shiftType || "";

    syncDutyRoleField();

    showAttendanceModal();
}

function showAttendanceModal(){
    document.getElementById("attendanceModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeAttendanceModal(){
    document.getElementById("attendanceModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    editingEntryId = null;
}

function saveAttendanceEntry(){
    const userId =
        document.getElementById("modalAttendanceStaff").value;

    const dateValue =
        document.getElementById("modalAttendanceDate").value;

    const clockInValue =
        document.getElementById("modalAttendanceClockIn").value;

    const clockOutValue =
        document.getElementById("modalAttendanceClockOut").value;

    const branch =
        document.getElementById("modalAttendanceBranch").value;

    const shiftType =
        document.getElementById("modalAttendanceShiftType").value;

    if(!userId){
        alert("Please select a staff member.");
        return;
    }

    if(!dateValue){
        alert("Please select a date.");
        return;
    }

    const clockInAt =
        combineDateAndTime(dateValue, clockInValue);

    const clockOutAt =
        combineDateAndTime(dateValue, clockOutValue);

    if(
        clockInAt &&
        clockOutAt &&
        new Date(clockOutAt) <= new Date(clockInAt)
    ){
        alert("Clock Out must be later than Clock In.");
        return;
    }

    const user =
        getUserAccounts().find(function(item){
            return item.id === userId;
        });

    /* Stamped directly onto the entry (per session) so a staff member
       who works Therapist duty AND Receptionist duty on the same date
       keeps each session's role distinct — payroll.js then picks the
       day's dominant role from actual tagged hours instead of a single
       day-level value. crownDutyLog is still updated as the "last
       picked" default (read by login.js's duty picker and used as the
       fallback role for older entries saved before this field existed). */
    const resolvedDutyRole =
        isDualRoleTherapist(user)
            ? (
                document.getElementById("modalAttendanceDutyRole").value === "Receptionist"
                    ? "Receptionist"
                    : "Therapist"
            )
            : "";

    if(resolvedDutyRole){
        const dutyLog =
            getDutyLog();

        dutyLog[userId + "_" + dateValue] =
            resolvedDutyRole;

        saveDutyLog(dutyLog);
    }

    const entries =
        getAttendanceLog();

    let savedEntryId;

    if(editingEntryId){
        const entry =
            entries.find(function(item){
                return item.id === editingEntryId;
            });

        if(!entry){
            return;
        }

        entry.userId = userId;
        entry.account = user ? user.account : entry.account;
        entry.role = user ? user.role : entry.role;
        entry.dutyRole = resolvedDutyRole;
        entry.shiftType = shiftType;
        entry.date = dateValue;
        entry.clockInAt = clockInAt;
        entry.clockOutAt = clockOutAt;
        entry.branch = branch;
        entry.updatedAt = new Date().toISOString();

        savedEntryId = entry.id;
    }else{
        savedEntryId = createId();

        entries.push({
            id: savedEntryId,
            userId: userId,
            account: user ? user.account : "",
            role: user ? user.role : "",
            dutyRole: resolvedDutyRole,
            shiftType: shiftType,
            branch: branch,
            date: dateValue,
            clockInAt: clockInAt,
            clockOutAt: clockOutAt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    saveAttendanceLog(entries);

    /* Same reasoning as clock-widget.js's performClockIn()/
       performClockOut() — this key opts out of the generic sync flush
       (see firebase-sync.js's queuePush()) in favor of a transactional
       per-entry upsert, since crownAttendanceLog is shared across every
       staff member and a blind whole-array overwrite risks silently
       losing a concurrent clock-in/out from someone else. */
    window.CrownAttendanceSync?.syncEntry?.(savedEntryId);

    closeAttendanceModal();
    renderAttendance();
}

function deleteAttendanceEntry(entryId){
    if(!confirm("Delete this attendance entry?")){
        return;
    }

    const entries =
        getAttendanceLog().filter(function(item){
            return item.id !== entryId;
        });

    saveAttendanceLog(entries);

    window.CrownAttendanceSync?.syncDelete?.(entryId);

    renderAttendance();
}
