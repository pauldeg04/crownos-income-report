/* ==========================================================================
   Crown Head Spa — Dashboard Clock In / Clock Out Widget

   Attendance records are kept flat and server-friendly on purpose:
   { id, userId, account, role, dutyRole, shiftType, branch, date,
     clockInAt, clockOutAt, createdAt, updatedAt }
   so this can migrate to a real database table later without reshaping.
   dutyRole ("Therapist"/"Receptionist"/"") is only meaningful for a
   dual-role Therapist+Receptionist account — see payroll.js's
   getDayAttendance() for how same-day sessions tagged with different
   roles get resolved into one day's payroll formula.
   shiftType ("Opening"/"Closing"/"") applies to any staff member and is
   asked once, on the FIRST clock-in of the day (see handleClockAction) —
   later same-day sessions reuse whatever was picked for that day. It
   decides which fixed schedule window (9am-6pm or 1pm-10pm) that day's
   hours get clamped against before payroll.js runs its usual formulas —
   see SHIFT_SCHEDULES below and payroll.js's getDayAttendance().
   ========================================================================== */

const ATTENDANCE_LOG_KEY = "crownAttendanceLog";
const CLOCK_WIDGET_BRANCH_KEY = "crownSelectedBranch";
const CLOCK_WIDGET_BRANCH_MASTER_KEY = "crownBranchMasterList";
const CLOCK_WIDGET_DUTY_LOG_KEY = "crownDutyLog";

/* Opening (9am-6pm) and Closing (1pm-10pm) are both exactly 9 hours,
   so one flat threshold covers either shift type. */
const CLOCK_OUT_REMINDER_HOURS = 9;
const CLOCK_OUT_REMINDER_CHECK_MS = 60000;

const SHIFT_SCHEDULES = {
    Opening: { start: "09:00", end: "18:00" },
    Closing: { start: "13:00", end: "22:00" }
};

let pendingClockInUser = null;

/* Staff must be within this distance of the branch pin for the
   clock-in to be tagged as location-verified. */
const GEO_RADIUS_METERS = 150;

document.addEventListener("DOMContentLoaded", function(){
    if(!document.getElementById("clockWidgetCard")){
        return;
    }

    renderClockWidget();
    checkClockOutReminder();

    setInterval(
        checkClockOutReminder,
        CLOCK_OUT_REMINDER_CHECK_MS
    );

    document
        .getElementById("clockActionBtn")
        .addEventListener("click", handleClockAction);

    document
        .getElementById("shiftOpeningBtn")
        ?.addEventListener("click", function(){
            finishClockInWithShift("Opening");
        });

    document
        .getElementById("shiftClosingBtn")
        ?.addEventListener("click", function(){
            finishClockInWithShift("Closing");
        });

    document
        .getElementById("shiftPickerCancelBtn")
        ?.addEventListener("click", hideShiftPicker);
});

function createAttendanceId(){
    return (
        "ATT-" +
        Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 7).toUpperCase()
    );
}

function getTodayDateString(){
    const today = new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
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

function isDualRoleTherapist(user){
    return (
        !!user &&
        user.role === "Therapist" &&
        user.secondaryRole === "Receptionist"
    );
}

/* Whatever duty was picked at LOGIN for today (see login.js's duty
   picker) — read fresh at clock-in time and stamped onto the new
   entry, so re-picking a different duty later in the day only
   affects sessions started after that point, not this one. */
function getTodaysDutyRole(userId, date){
    try{
        const raw =
            localStorage.getItem(CLOCK_WIDGET_DUTY_LOG_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        const logged =
            (parsed && typeof parsed === "object")
                ? parsed[userId + "_" + date]
                : null;

        return logged === "Receptionist" ? "Receptionist" : "Therapist";
    }catch(error){
        return "Therapist";
    }
}

function getOpenAttendanceEntry(userId, date){
    return getAttendanceLog().find(function(entry){
        return (
            entry.userId === userId &&
            entry.date === date &&
            entry.clockInAt &&
            !entry.clockOutAt
        );
    }) || null;
}

function getTodayAttendanceEntries(userId, date){
    return getAttendanceLog().filter(function(entry){
        return (
            entry.userId === userId &&
            entry.date === date
        );
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

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderClockWidget(){
    const user =
        window.CrownAuth?.getCurrentUser?.();

    if(!user){
        return;
    }

    const card =
        document.getElementById("clockWidgetCard");

    if(user.role === "Admin"){
        card.classList.add("d-none");
        return;
    }

    card.classList.remove("d-none");

    const today =
        getTodayDateString();

    const openEntry =
        getOpenAttendanceEntry(user.id, today);

    const todayEntries =
        getTodayAttendanceEntries(user.id, today);

    const title =
        document.getElementById("clockWidgetTitle");

    const subtitle =
        document.getElementById("clockWidgetSubtitle");

    const button =
        document.getElementById("clockActionBtn");

    if(openEntry){
        title.textContent =
            "Clocked In";

        subtitle.innerHTML =
            `Since <strong>${formatClockTime(openEntry.clockInAt)}</strong> — ${escapeHtml(user.account)}`;

        button.textContent =
            "Clock Out";

        button.className =
            "clock-widget-btn clock-widget-btn-out";

        return;
    }

    if(todayEntries.length > 0){
        const lastEntry =
            todayEntries[todayEntries.length - 1];

        title.textContent =
            "Clocked Out";

        subtitle.innerHTML =
            `Last session ended <strong>${formatClockTime(lastEntry.clockOutAt)}</strong>. Tap Clock In to start a new session.`;
    }else{
        title.textContent =
            "Not Clocked In";

        subtitle.textContent =
            "Tap Clock In when your shift starts.";
    }

    button.textContent =
        "Clock In";

    button.className =
        "clock-widget-btn clock-widget-btn-in";
}

/* Fires a one-time "don't forget to clock out" reminder once a session
   has been open for CLOCK_OUT_REMINDER_HOURS, whether that's an Opening
   (9am-6pm) or Closing (1pm-10pm) shift — both are 9 hours long. Runs on
   load and every minute after, and is deduped per attendance entry via
   clockOutReminderSent so it never repeats for the same session. */
function checkClockOutReminder(){
    const user =
        window.CrownAuth?.getCurrentUser?.();

    if(!user){
        return;
    }

    const today =
        getTodayDateString();

    const openEntry =
        getOpenAttendanceEntry(user.id, today);

    if(!openEntry || openEntry.clockOutReminderSent){
        return;
    }

    const hoursElapsed =
        (Date.now() - new Date(openEntry.clockInAt).getTime()) /
        3600000;

    if(hoursElapsed < CLOCK_OUT_REMINDER_HOURS){
        return;
    }

    const recipient =
        window.getNotificationRecipient?.();

    if(recipient && window.CrownNotifications){
        CrownNotifications.add({
            account: recipient.account,
            therapistName: recipient.therapistName,
            branch: openEntry.branch,
            date: openEntry.date,
            type: "attendance",
            scheduleId: openEntry.id,
            message:
                `Don't forget to clock out — you've reached your ` +
                `${CLOCK_OUT_REMINDER_HOURS}-hour shift.`
        });

        window.updateNotificationBadge?.(recipient);
    }

    const entries =
        getAttendanceLog();

    const entry =
        entries.find(function(item){
            return item.id === openEntry.id;
        });

    if(entry){
        entry.clockOutReminderSent = true;
        saveAttendanceLog(entries);
    }
}

function getBranchCoordinates(branchName){
    if(!branchName){
        return null;
    }

    try{
        const raw =
            localStorage.getItem(CLOCK_WIDGET_BRANCH_MASTER_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        if(!Array.isArray(parsed)){
            return null;
        }

        const branch =
            parsed.find(function(item){
                return (
                    typeof item === "object" &&
                    item?.name === branchName
                );
            });

        const lat = Number(branch?.latitude);
        const lng = Number(branch?.longitude);

        if(
            !branch ||
            branch.latitude === null ||
            branch.latitude === undefined ||
            branch.latitude === "" ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ){
            return null;
        }

        return { lat: lat, lng: lng };
    }catch(error){
        return null;
    }
}

function getDistanceMeters(lat1, lng1, lat2, lng2){
    const EARTH_RADIUS_M = 6371000;

    const toRadians =
        function(degrees){
            return degrees * Math.PI / 180;
        };

    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return (
        EARTH_RADIUS_M *
        2 *
        Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    );
}

function getCurrentPosition(){
    return new Promise(function(resolve){
        if(!navigator.geolocation){
            resolve(null);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            function(position){
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: Math.round(position.coords.accuracy)
                });
            },
            function(){
                resolve(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 30000
            }
        );
    });
}

/* status: "within" | "outside" | "no_location" | "unverified" */
function buildGeoRecord(position, branchName){
    if(!position){
        return { status: "no_location" };
    }

    const branchCoords =
        getBranchCoordinates(branchName);

    if(!branchCoords){
        return {
            status: "unverified",
            lat: position.lat,
            lng: position.lng,
            accuracy: position.accuracy
        };
    }

    const distance =
        Math.round(
            getDistanceMeters(
                position.lat,
                position.lng,
                branchCoords.lat,
                branchCoords.lng
            )
        );

    return {
        status:
            distance <= GEO_RADIUS_METERS
                ? "within"
                : "outside",
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
        distance: distance
    };
}

async function handleClockAction(){
    const user =
        window.CrownAuth?.getCurrentUser?.();

    if(!user){
        return;
    }

    const today =
        getTodayDateString();

    const openEntry =
        getOpenAttendanceEntry(user.id, today);

    if(openEntry){
        await performClockOut(user, openEntry);
        return;
    }

    /* Opening/Closing is asked once per day — later same-day sessions
       (after a break, clocked back in) reuse whatever was already
       picked for today rather than asking again. */
    const todayShiftType =
        getTodayAttendanceEntries(user.id, today)
            .map(function(entry){ return entry.shiftType; })
            .find(Boolean) || "";

    if(todayShiftType){
        await performClockIn(user, todayShiftType);
    }else{
        pendingClockInUser = user;
        showShiftPicker();
    }
}

function showShiftPicker(){
    document.getElementById("shiftPickerBackdrop")
        .classList.remove("d-none");
}

function hideShiftPicker(){
    document.getElementById("shiftPickerBackdrop")
        .classList.add("d-none");

    pendingClockInUser = null;
}

async function finishClockInWithShift(shiftType){
    if(!pendingClockInUser){
        return;
    }

    const user =
        pendingClockInUser;

    document.getElementById("shiftPickerBackdrop")
        .classList.add("d-none");

    pendingClockInUser = null;

    await performClockIn(user, shiftType);
}

async function performClockIn(user, shiftType){
    const button =
        document.getElementById("clockActionBtn");

    button.disabled = true;
    button.textContent = "Getting location…";

    const branchName =
        localStorage.getItem(CLOCK_WIDGET_BRANCH_KEY) || "";

    const position =
        await getCurrentPosition();

    button.disabled = false;

    const geo =
        buildGeoRecord(position, branchName);

    const today =
        getTodayDateString();

    const entries =
        getAttendanceLog();

    entries.push({
        id: createAttendanceId(),
        userId: user.id,
        account: user.account,
        role: user.role,
        dutyRole:
            isDualRoleTherapist(user)
                ? getTodaysDutyRole(user.id, today)
                : "",
        shiftType: shiftType || "",
        branch: branchName,
        date: today,
        clockInAt: new Date().toISOString(),
        clockOutAt: "",
        clockInGeo: geo,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    saveAttendanceLog(entries);

    /* Mobile staff commonly background or close the app right after
       tapping — without an explicit flush here, the 600ms sync debounce
       can get cut off before the write ever reaches Firestore, so the
       clock-in silently never registers for anyone else. Same fix
       pattern as logout()/finishLogin() in login.js and access-control.js. */
    await window.CrownCloud?.flushNow?.();

    alert(getClockInMessage(geo, branchName));

    renderClockWidget();
}

async function performClockOut(user, openEntry){
    const button =
        document.getElementById("clockActionBtn");

    button.disabled = true;
    button.textContent = "Getting location…";

    const branchName =
        localStorage.getItem(CLOCK_WIDGET_BRANCH_KEY) || "";

    const position =
        await getCurrentPosition();

    button.disabled = false;

    const geo =
        buildGeoRecord(position, branchName);

    const entries =
        getAttendanceLog();

    const entry =
        entries.find(function(item){
            return item.id === openEntry.id;
        });

    if(!entry){
        renderClockWidget();
        return;
    }

    entry.clockOutAt =
        new Date().toISOString();

    entry.clockOutGeo = geo;

    entry.updatedAt =
        new Date().toISOString();

    saveAttendanceLog(entries);

    /* Same reasoning as performClockIn() above — force the write out
       before the user can background/close the app. */
    await window.CrownCloud?.flushNow?.();

    alert("Clocked out successfully.");

    renderClockWidget();
}

function getClockInMessage(geo, branchName){
    if(geo.status === "within"){
        return (
            "Clocked in successfully.\n\n" +
            "✔ Location verified at " + branchName + "."
        );
    }

    if(geo.status === "outside"){
        return (
            "Clocked in.\n\n" +
            "⚠ You appear to be about " + geo.distance +
            " meters away from " + branchName + ". " +
            "This entry will be flagged for review."
        );
    }

    if(geo.status === "unverified"){
        return (
            "Clocked in.\n\n" +
            (
                branchName
                    ? "This branch has no GPS location set yet, so the " +
                      "entry could not be location-verified."
                    : "No branch is selected, so the entry could not " +
                      "be location-verified."
            )
        );
    }

    return (
        "Clocked in.\n\n" +
        "⚠ Location unavailable (permission denied or no GPS " +
        "signal). This entry will be marked \"No GPS\"."
    );
}
