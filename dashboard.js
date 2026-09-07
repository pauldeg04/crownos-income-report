const BRANCH_KEY = "crownSelectedBranch";
const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SCHEDULE_PREFIX = "crownSchedule_";
const SERVICE_MASTER_KEY = "crownServiceMasterList";
const TIMER_URGENT_THRESHOLD_SECONDS = 10 * 60;

/* Schedule of the bed timeline currently on screen — kept up to date by
   every renderSchedule() call so the once-a-second ticker below can
   refresh the Bed-column countdowns without re-reading localStorage or
   re-rendering the whole table 60 times a minute. */
let currentRenderedSchedule = [];

/* Client records, loaded for the appointment card's Forms section
   (client-forms.js reads/writes this same in-memory array; the storage
   itself lives in CrownClientStore — see client-store.js). */
let clients = [];
let currentScheduleDetailContext = null;

const DEFAULT_BRANCHES = [
    {
        id: "default-binan",
        name: "Crown Head Spa Biñan",
        beds: 4,
        openingTime: "10:00",
        closingTime: "22:00"
    },
    {
        id: "default-calamba",
        name: "Crown Head Spa Calamba",
        beds: 7,
        openingTime: "10:00",
        closingTime: "22:00"
    }
];

document.addEventListener("DOMContentLoaded", async function(){
    ensureDefaultBranches();
    await loadClients();
    loadBranchDropdown();
    initializeScheduleDate();
    syncDashboardControlsFromSidebar();
    applyBranchState();

    document.addEventListener("crownClientFormSaved", function(event){
        if(
            currentScheduleDetailContext &&
            currentScheduleDetailContext.client.id === event.detail?.clientId
        ){
            renderScheduleDetailForms();
        }
    });

    document.addEventListener("crownDashboardFilterChanged", function(){
        syncDashboardControlsFromSidebar();
        applyBranchState();
    });

    document
        .querySelectorAll(".branch-required")
        .forEach(function(link){
            link.addEventListener("click", function(event){
                if(!localStorage.getItem(BRANCH_KEY)){
                    event.preventDefault();
                    alert("Please select a branch first.");
                }
            });
        });

    document
        .getElementById("scheduleDetailCloseBtn")
        .addEventListener("click", closeScheduleDetailModal);

    document
        .getElementById("scheduleDetailBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeScheduleDetailModal();
            }
        });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeScheduleDetailModal();
        }
    });

    document
        .getElementById("scheduleDetailTimerBtn")
        .addEventListener("click", handleTimerButtonClick);

    /* firebase-sync.js's realtime listener writes an incoming remote
       change straight into localStorage and fires this event — without
       it, a bed timer started/stopped by a therapist on one device (or
       an appointment created/edited from scheduling.js) would only show
       up here after a manual reload. Re-render whenever any
       crownSchedule_ key changed, same pattern scheduling.js uses. */
    window.addEventListener("crownCloudUpdate", function(event){
        const keys = event.detail?.keys || [];

        if(keys.some(function(key){ return key.startsWith(SCHEDULE_PREFIX); })){
            applyBranchState();
            refreshOpenScheduleDetailContext();
        }
    });

    /* Single shared ticker for every countdown on the page (the Bed
       column labels plus the modal's own readout) — cheap DOM text
       updates only, no re-fetch or re-render, since the underlying
       timerStartedAt/timerDurationSeconds don't change between renders. */
    setInterval(function(){
        updateBedTimers(currentRenderedSchedule);
        updateScheduleDetailTimerRemaining();
    }, 1000);
});

function ensureDefaultBranches(){
    if(localStorage.getItem(BRANCH_MASTER_KEY) !== null){
        return;
    }

    localStorage.setItem(
        BRANCH_MASTER_KEY,
        JSON.stringify(DEFAULT_BRANCHES)
    );
}

function getBranches(){
    try{
        const saved = localStorage.getItem(BRANCH_MASTER_KEY);
        const parsed = saved ? JSON.parse(saved) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        const allBranches =
            parsed.map(function(branch){
                if(typeof branch === "string"){
                    return {
                        id: createId(),
                        name: branch,
                        beds:
                            branch === "Crown Head Spa Biñan"
                                ? 4
                                : branch === "Crown Head Spa Calamba"
                                    ? 7
                                    : 1,
                        openingTime: "10:00",
                        closingTime: "22:00"
                    };
                }

                return {
                    id: branch.id || createId(),
                    name: branch.name || "",
                    beds: Number(branch.beds) || 1,
                    openingTime: branch.openingTime || "10:00",
                    closingTime: branch.closingTime || "22:00"
                };
            });

        const allowedBranches =
            CrownAuth.getAllowedBranches();

        return allBranches.filter(function(branch){
            return allowedBranches.includes(branch.name);
        });
    }catch(error){
        console.error("Unable to load branches:", error);
        return [];
    }
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

function normalizeClientName(value){
    return String(value || "").trim();
}

async function loadClients(){
    try{
        clients = await window.CrownClientStore.getAll();
    }catch(error){
        console.error("Unable to load clients:", error);
        clients = [];
    }
}

/* Fire-and-forget, same as everywhere else in the app that saves to the
   cloud mirror — callers already update the in-memory `clients` array
   before calling this, so nothing here needs to be awaited. */
function saveClientsToStorage(){
    window.CrownClientStore.saveAll(clients).catch(function(error){
        console.error("Unable to save clients:", error);
    });
}

/* Finds the client record matching an appointment's client name (same
   case-insensitive match scheduling.js's ensureClientExists uses), or
   creates a bare one so a Forms entry has somewhere to be saved — mirrors
   how scheduling.js auto-creates client records for new bookings. */
async function ensureClientRecordForForms(clientName, branchName){
    const target = normalizeClientName(clientName).toLowerCase();

    let client = clients.find(function(item){
        return normalizeClientName(item.name).toLowerCase() === target;
    });

    if(!client){
        /* `clients` was loaded once at DOMContentLoaded and can be stale
           by the time an appointment card is opened (e.g. clients were
           imported or edited on another page since). Re-read the master
           list fresh before appending, then adopt it as this page's copy
           too — otherwise saveClientsToStorage() below would serialize
           this page's outdated snapshot and silently wipe out any newer
           records that aren't in it. */
        let freshClients;

        try{
            freshClients = await window.CrownClientStore.getAll();
        }catch(error){
            freshClients = clients;
        }

        client = freshClients.find(function(item){
            return normalizeClientName(item.name).toLowerCase() === target;
        });

        if(!client){
            client = {
                id: createId(),
                name: normalizeClientName(clientName),
                branch: branchName || "",
                vip: "No",
                notes: "",
                totalVisits: 0,
                lastVisit: "",
                totalSpent: 0,
                forms: [],
                createdAt: new Date().toISOString()
            };

            freshClients.push(client);
        }

        clients = freshClients;
        saveClientsToStorage();
    }

    return client;
}

function getTodayDateString(){
    const today = new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
}

function initializeScheduleDate(){
    const dateInput =
        document.getElementById("scheduleDate");

    if(!dateInput.value){
        dateInput.value = getTodayDateString();
    }

    updateSelectedDateLabel();
}

function updateSelectedDateLabel(){
    const dateValue =
        document.getElementById("scheduleDate").value;

    const label =
        document.getElementById("selectedDateLabel");

    if(!label){
        return;
    }

    if(!dateValue){
        label.textContent = "No date selected";
        return;
    }

    label.textContent =
        new Date(dateValue + "T00:00:00")
            .toLocaleDateString("en-PH", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
            });
}

function syncDashboardControlsFromSidebar(){
    const sidebarBranch =
        document.getElementById("sidebarDashboardBranch");

    const sidebarDate =
        document.getElementById("sidebarDashboardDate");

    const hiddenBranch =
        document.getElementById("branchSelect");

    const hiddenDate =
        document.getElementById("scheduleDate");

    if(sidebarBranch && hiddenBranch){
        hiddenBranch.innerHTML =
            sidebarBranch.innerHTML;

        hiddenBranch.value =
            sidebarBranch.value;
    }

    if(sidebarDate && hiddenDate){
        hiddenDate.value =
            sidebarDate.value || getTodayDateString();
    }

    updateSelectedDateLabel();
}

function loadBranchDropdown(){
    const hiddenSelect =
        document.getElementById("branchSelect");

    const sidebarSelect =
        document.getElementById("sidebarDashboardBranch");

    const branches = getBranches();

    const optionsHtml =
        '<option value="">Select Branch</option>' +
        branches.map(function(branch){
            return (
                '<option value="' +
                escapeHtml(branch.name) +
                '">' +
                escapeHtml(branch.name) +
                '</option>'
            );
        }).join("");

    if(hiddenSelect){
        hiddenSelect.innerHTML = optionsHtml;
    }

    if(sidebarSelect){
        sidebarSelect.innerHTML = optionsHtml;
    }
}

function changeBranch(){
    const sidebarSelect =
        document.getElementById("sidebarDashboardBranch");

    const hiddenSelect =
        document.getElementById("branchSelect");

    const selectedBranch =
        sidebarSelect
            ? sidebarSelect.value
            : hiddenSelect.value;

    if(selectedBranch){
        localStorage.setItem(
            BRANCH_KEY,
            selectedBranch
        );
    }else{
        localStorage.removeItem(BRANCH_KEY);
    }

    if(hiddenSelect){
        hiddenSelect.value = selectedBranch;
    }

    applyBranchState();
}

function applyBranchState(){
    const branches = getBranches();
    const branchSelect =
        document.getElementById("branchSelect");

    let selectedBranch =
        localStorage.getItem(BRANCH_KEY) || "";

    const branch =
        branches.find(function(item){
            return item.name === selectedBranch;
        });

    if(selectedBranch && !branch){
        localStorage.removeItem(BRANCH_KEY);
        selectedBranch = "";
    }

    branchSelect.value = selectedBranch;

    const sidebarBranch =
        document.getElementById("sidebarDashboardBranch");

    if(sidebarBranch){
        sidebarBranch.value = selectedBranch;
    }

    if(!selectedBranch){
        currentRenderedSchedule = [];

        document.getElementById("branchHint").textContent =
            "Please select a branch.";

        document.getElementById("scheduleEmptyState")
            .classList.remove("d-none");

        document.getElementById("scheduleTableWrapper")
            .classList.add("d-none");

        document.getElementById("scheduleLegend")
            .classList.add("d-none");

        document.getElementById("bedCount").textContent = "0";
        document.getElementById("operatingHours").textContent = "—";
        document.getElementById("scheduledCount").textContent = "0";
        document.getElementById("nextSchedule").textContent = "—";

        document.getElementById("scheduleTitle").textContent =
            "Branch Schedule";

        document.getElementById("scheduleSubtitle").textContent =
            "Select a branch to display its schedule.";

        return;
    }

    document.getElementById("branchHint").innerHTML =
        `Selected branch: <strong>${escapeHtml(selectedBranch)}</strong>`;

    renderSchedule(branch);
}

function timeToMinutes(timeValue){
    const parts = timeValue.split(":");

    return (
        Number(parts[0]) * 60 +
        Number(parts[1])
    );
}

function minutesToTime(totalMinutes){
    const hour24 = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;

    return (
        hour12 +
        ":" +
        String(minute).padStart(2, "0") +
        " " +
        suffix
    );
}

function formatTimeRange(startTime, endTime){
    return (
        minutesToTime(timeToMinutes(startTime)) +
        " – " +
        minutesToTime(timeToMinutes(endTime))
    );
}

function getScheduleStorageKey(branchName, date){
    return (
        SCHEDULE_PREFIX +
        branchName +
        "_" +
        date
    );
}

function getSchedule(branchName, date){
    const key =
        getScheduleStorageKey(
            branchName,
            date
        );

    try{
        const saved = localStorage.getItem(key);
        const parsed = saved ? JSON.parse(saved) : [];

        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load schedule:", error);
        return [];
    }
}

function renderSchedule(branch){
    const sidebarDate =
        document.getElementById("sidebarDashboardDate");

    const selectedDate =
        sidebarDate?.value ||
        document.getElementById("scheduleDate").value ||
        getTodayDateString();

    if(!selectedDate){
        return;
    }

    const schedule =
        getSchedule(branch.name, selectedDate);

    document.getElementById("scheduleEmptyState")
        .classList.add("d-none");

    document.getElementById("scheduleTableWrapper")
        .classList.remove("d-none");

    document.getElementById("scheduleLegend")
        .classList.remove("d-none");

    updateLegendForTherapist();

    document.getElementById("scheduleTitle").textContent =
        branch.name;

    document.getElementById("scheduleSubtitle").textContent =
        "Bed schedule for " +
        new Date(selectedDate + "T00:00:00")
            .toLocaleDateString("en-PH", {
                month: "long",
                day: "numeric",
                year: "numeric"
            });

    document.getElementById("bedCount").textContent =
        branch.beds;

    document.getElementById("operatingHours").textContent =
        formatTimeRange(
            branch.openingTime,
            branch.closingTime
        );

    document.getElementById("scheduledCount").textContent =
        schedule.length;

    document.getElementById("nextSchedule").textContent =
        getNextScheduleText(schedule, selectedDate);

    currentRenderedSchedule = schedule;

    renderScheduleHeader(branch.beds, schedule);
    renderScheduleBody(branch, schedule, selectedDate);
}

function getNextScheduleText(schedule, selectedDate){
    if(schedule.length === 0){
        return "No schedule";
    }

    const sorted = schedule
        .slice()
        .sort(function(a, b){
            return timeToMinutes(a.startTime) -
                timeToMinutes(b.startTime);
        });

    const today = getTodayDateString();

    if(selectedDate < today){
        return "Completed";
    }

    if(selectedDate > today){
        const first = sorted[0];

        return (
            minutesToTime(timeToMinutes(first.startTime)) +
            " · " +
            (first.client || "Scheduled Client") +
            " · Bed " +
            first.bed
        );
    }

    const now = new Date();
    const currentMinutes =
        now.getHours() * 60 + now.getMinutes();

    const next = sorted.find(function(item){
        return timeToMinutes(item.startTime) >= currentMinutes;
    });

    if(!next){
        return "No more schedule";
    }

    return (
        minutesToTime(timeToMinutes(next.startTime)) +
        " · " +
        (next.client || "Scheduled Client") +
        " · Bed " +
        next.bed
    );
}

/* Pixels-per-minute for the timeline body — the only thing this
   controls is how tall the grid LOOKS (gridlines are drawn once per
   hour via CSS background, see .timeline-bed-col); every appointment
   card is still positioned from its exact start minute, so placement
   accuracy is unaffected by this scale. */
const SCHEDULE_PX_PER_MINUTE = 1.5;
const SCHEDULE_PX_PER_HOUR = SCHEDULE_PX_PER_MINUTE * 60;

function setTimelineGridColumns(numberOfBeds){
    document
        .querySelector(".timeline-grid")
        ?.style.setProperty("--bed-count", numberOfBeds);
}

function renderScheduleHeader(numberOfBeds, schedule){
    const head =
        document.getElementById("scheduleHead");

    setTimelineGridColumns(numberOfBeds);

    let html = `
        <div class="timeline-header-cell timeline-corner">
            Time
        </div>
    `;

    for(let bed = 1; bed <= numberOfBeds; bed++){
        html += `
            <div class="timeline-header-cell">
                Bed ${bed}
                <span class="bed-timer d-none" data-bed-timer="${bed}"></span>
            </div>
        `;
    }

    head.innerHTML = html;

    updateBedTimers(schedule || []);
}

/* Whichever appointment on this bed currently has its countdown running
   (Started but not yet Stopped) — that's the one whose remaining time
   shows under the "Bed N" label. At most one appointment per bed is
   ever "running" at a time in normal use. */
function findRunningAppointmentForBed(schedule, bedNumber){
    return schedule.find(function(item){
        return (
            Number(item.bed) === bedNumber &&
            item.timerStatus === "running"
        );
    }) || null;
}

function updateBedTimers(schedule){
    document
        .querySelectorAll("[data-bed-timer]")
        .forEach(function(el){
            const bed = Number(el.getAttribute("data-bed-timer"));
            const appointment = findRunningAppointmentForBed(schedule || [], bed);

            if(!appointment){
                el.classList.add("d-none");
                el.textContent = "";
                return;
            }

            const remaining = getRemainingSeconds(appointment);

            el.textContent = formatCountdown(remaining);
            el.classList.remove("d-none");

            el.classList.toggle(
                "timer-urgent",
                remaining <= TIMER_URGENT_THRESHOLD_SECONDS
            );
        });
}

function updateLegendForTherapist(){
    const isTherapistView =
        Boolean(getLinkedTherapistName());

    const bookedLabel =
        document.getElementById("legendBookedLabel");

    const otherLegend =
        document.getElementById("legendOtherTherapist");

    if(bookedLabel){
        bookedLabel.textContent =
            isTherapistView
                ? "My Schedule"
                : "Scheduled";
    }

    if(otherLegend){
        otherLegend.classList.toggle(
            "d-none",
            !isTherapistView
        );
    }
}


function getLinkedTherapistName(){
    const user =
        window.CrownAuth
            ? CrownAuth.getCurrentUser()
            : null;

    if(
        !user ||
        user.role !== "Therapist"
    ){
        return "";
    }

    return String(user.therapistName || "")
        .trim()
        .toLowerCase();
}

/* Hour marks to label down the Time column: always the branch's exact
   opening time first (even if not on the hour), then every round hour
   after that up to closing — so a 9:30 opening still reads correctly
   instead of silently skipping to 10:00. */
function getHourMarks(openingMinutes, closingMinutes){
    const marks = [openingMinutes];

    let next = Math.ceil(openingMinutes / 60) * 60;

    if(next === openingMinutes){
        next += 60;
    }

    for(; next < closingMinutes; next += 60){
        marks.push(next);
    }

    return marks;
}

function renderScheduleBody(branch, schedule, selectedDate){
    const body =
        document.getElementById("scheduleBody");

    body.innerHTML = "";

    setTimelineGridColumns(branch.beds);

    body.style.setProperty(
        "--schedule-hour-height",
        SCHEDULE_PX_PER_HOUR + "px"
    );

    const linkedTherapist =
        getLinkedTherapistName();

    const openingMinutes =
        timeToMinutes(branch.openingTime);

    const closingMinutes =
        timeToMinutes(branch.closingTime);

    const totalHeight =
        Math.max(0, closingMinutes - openingMinutes) *
        SCHEDULE_PX_PER_MINUTE;

    const isToday =
        selectedDate === getTodayDateString();

    const now = new Date();
    const currentMinutes =
        now.getHours() * 60 + now.getMinutes();

    const timeCol =
        document.createElement("div");

    timeCol.className = "timeline-time-col";
    timeCol.style.height = totalHeight + "px";

    getHourMarks(openingMinutes, closingMinutes).forEach(function(minute){
        const label =
            document.createElement("div");

        label.className = "timeline-hour-label";

        label.style.top =
            ((minute - openingMinutes) * SCHEDULE_PX_PER_MINUTE) + "px";

        label.textContent = minutesToTime(minute);

        timeCol.appendChild(label);
    });

    body.appendChild(timeCol);

    for(let bed = 1; bed <= branch.beds; bed++){
        const col =
            document.createElement("div");

        col.className = "timeline-bed-col";
        col.style.height = totalHeight + "px";

        schedule
            .filter(function(item){
                return Number(item.bed) === bed;
            })
            .forEach(function(appointment){
                const appointmentStart =
                    timeToMinutes(appointment.startTime);

                const appointmentEnd =
                    timeToMinutes(appointment.endTime);

                const clampedStart =
                    Math.max(appointmentStart, openingMinutes);

                const clampedEnd =
                    Math.min(appointmentEnd, closingMinutes);

                if(clampedEnd <= clampedStart){
                    return;
                }

                const isOtherTherapist =
                    linkedTherapist &&
                    String(appointment.therapist || "")
                        .trim()
                        .toLowerCase() !== linkedTherapist;

                const isPastAppointment =
                    !isToday
                        ? selectedDate < getTodayDateString()
                        : appointmentEnd <= currentMinutes;

                const card =
                    document.createElement("button");

                card.type = "button";

                card.className =
                    "appointment-card" +
                    (
                        isOtherTherapist
                            ? " other-appointment"
                            : (
                                appointment.isCompanionEntry
                                    ? " companion-entry-card"
                                    : ""
                            )
                    ) +
                    (isPastAppointment ? " past-appointment" : "");

                card.style.top =
                    ((clampedStart - openingMinutes) * SCHEDULE_PX_PER_MINUTE) + "px";

                card.style.height =
                    ((clampedEnd - clampedStart) * SCHEDULE_PX_PER_MINUTE) + "px";

                card.innerHTML = `
                    <strong>
                        ${escapeHtml(appointment.client || "Scheduled Client")}
                    </strong>

                    <span>
                        ${escapeHtml(appointment.service || "Service")}
                    </span>

                    <small>
                        ${formatTimeRange(
                            appointment.startTime,
                            appointment.endTime
                        )}
                    </small>
                `;

                card.addEventListener("click", function(){
                    openScheduleDetailModal(
                        appointment,
                        branch,
                        selectedDate
                    );
                });

                col.appendChild(card);
            });

        body.appendChild(col);
    }

    if(
        isToday &&
        currentMinutes >= openingMinutes &&
        currentMinutes < closingMinutes
    ){
        const line =
            document.createElement("div");

        line.className = "timeline-current-line";

        line.style.top =
            ((currentMinutes - openingMinutes) * SCHEDULE_PX_PER_MINUTE) + "px";

        body.appendChild(line);
    }
}

function getAppointmentServiceList(appointment){
    if(
        Array.isArray(appointment.services) &&
        appointment.services.length > 0
    ){
        return appointment.services;
    }

    if(appointment.service){
        return String(appointment.service)
            .split(",")
            .map(function(name){
                return name.trim();
            })
            .filter(Boolean);
    }

    return ["Service"];
}

async function openScheduleDetailModal(appointment, branch, selectedDate){
    document.getElementById("scheduleDetailEyebrow").textContent =
        appointment.isCompanionEntry
            ? "Companion Appointment"
            : "Scheduled Appointment";

    document.getElementById("scheduleDetailName").textContent =
        appointment.client || "Scheduled Client";

    const companionLine =
        document.getElementById("scheduleDetailCompanion");

    if(appointment.isCompanionEntry && appointment.companionOfName){
        companionLine.textContent =
            `Companion of ${appointment.companionOfName}`;

        companionLine.classList.remove("d-none");
    }else{
        companionLine.textContent = "";
        companionLine.classList.add("d-none");
    }

    document.getElementById("scheduleDetailServices").innerHTML =
        getAppointmentServiceList(appointment)
            .map(function(name){
                return `<li>${escapeHtml(name)}</li>`;
            })
            .join("");

    document.getElementById("scheduleDetailTherapist").textContent =
        appointment.therapist || "—";

    document.getElementById("scheduleDetailBed").textContent =
        appointment.bed ? `Bed ${appointment.bed}` : "—";

    document.getElementById("scheduleDetailDate").textContent =
        new Date(selectedDate + "T00:00:00")
            .toLocaleDateString("en-PH", {
                month: "long",
                day: "numeric",
                year: "numeric"
            });

    document.getElementById("scheduleDetailTime").textContent =
        formatTimeRange(appointment.startTime, appointment.endTime);

    document.getElementById("scheduleDetailStatus").textContent =
        appointment.status || "Confirmed";

    const notesWrapper =
        document.getElementById("scheduleDetailNotesWrapper");

    if(appointment.notes){
        document.getElementById("scheduleDetailNotes").textContent =
            appointment.notes;

        notesWrapper.classList.remove("d-none");
    }else{
        notesWrapper.classList.add("d-none");
    }

    const scheduleDetailVipBadge =
        document.getElementById("scheduleDetailVipBadge");

    scheduleDetailVipBadge.classList.add("d-none");

    currentScheduleDetailContext = {
        appointment: appointment,
        branch: branch,
        selectedDate: selectedDate,
        client: null,
        visitLike: {
            date: selectedDate,
            branch: branch.name,
            items: getAppointmentServiceList(appointment).join(", ")
        }
    };

    if(window.ClientForms){
        const client =
            await ensureClientRecordForForms(appointment.client || "", branch.name);

        if(client && client.vip === "Yes"){
            scheduleDetailVipBadge.classList.remove("d-none");
        }

        currentScheduleDetailContext.client = client;

        renderScheduleDetailForms();
    }

    renderScheduleDetailTimerButton();

    document.getElementById("scheduleDetailBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function renderScheduleDetailForms(){
    if(!currentScheduleDetailContext){
        return;
    }

    const { client, visitLike } = currentScheduleDetailContext;
    const visitKey = window.ClientForms.buildVisitKey(client, visitLike);
    const container = document.getElementById("scheduleDetailForms");

    container.innerHTML =
        window.ClientForms.renderFormsCell(client, visitLike, visitKey);

    window.ClientForms.wireFormsCellButtons(client, container);
}

function closeScheduleDetailModal(){
    document.getElementById("scheduleDetailBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");
    currentScheduleDetailContext = null;
}

/* --- Per-appointment service timer (Start/Stop → Done) ------------------

   Each schedule entry (main appointment or companion entry, they're both
   plain items in the same crownSchedule_<branch>_<date> array) can carry:
     timerStatus          "running" | "done"  (absent/undefined = not started)
     timerDurationSeconds total countdown length, frozen at Start time
     timerStartedAt        Date.now() when Start was pressed
     timerStoppedAt         Date.now() when Stop was pressed

   Remaining time is always derived (duration - elapsed), never stored, so
   every viewer's ticker stays correct without needing its own sync. */

function getServiceMasterList(){
    try{
        const saved = localStorage.getItem(SERVICE_MASTER_KEY);
        const parsed = saved ? JSON.parse(saved) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        return parsed.map(function(service){
            if(typeof service === "string"){
                return { name: service, duration: 0 };
            }

            return {
                name: service.name || "",
                duration: Number(service.duration) || 0
            };
        });
    }catch(error){
        console.error("Unable to load services:", error);
        return [];
    }
}

/* appointment.duration (minutes) is already the sum of every service's
   duration, computed once at booking time by scheduling.js. Only fall
   back to re-summing from the service master list for older/edge-case
   entries that don't carry it. */
function getAppointmentTotalSeconds(appointment){
    let minutes = Number(appointment.duration) || 0;

    if(minutes <= 0){
        const services = getServiceMasterList();

        minutes = getAppointmentServiceList(appointment)
            .reduce(function(sum, name){
                const match = services.find(function(service){
                    return (
                        normalizeClientName(service.name).toLowerCase() ===
                        normalizeClientName(name).toLowerCase()
                    );
                });

                return sum + (match ? match.duration : 0);
            }, 0);
    }

    return minutes * 60;
}

function getRemainingSeconds(appointment){
    const total =
        Number(appointment.timerDurationSeconds) ||
        getAppointmentTotalSeconds(appointment);

    if(appointment.timerStatus !== "running" || !appointment.timerStartedAt){
        return total;
    }

    const elapsed =
        Math.floor((Date.now() - appointment.timerStartedAt) / 1000);

    return Math.max(0, total - elapsed);
}

function formatCountdown(totalSeconds){
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0")
    );
}

/* Stop patch — records when it stopped AND how long the service
   actually ran (timerStoppedAt - timerStartedAt), separate from the
   planned countdown length so both numbers stay on record: what was
   scheduled (timerDurationSeconds) vs. what actually happened
   (actualDurationSeconds). */
function buildStopTimerPatch(appointment){
    const stoppedAt = Date.now();

    const actualDurationSeconds =
        appointment.timerStartedAt
            ? Math.max(0, Math.round((stoppedAt - appointment.timerStartedAt) / 1000))
            : 0;

    return {
        timerStatus: "done",
        timerStoppedAt: stoppedAt,
        actualDurationSeconds: actualDurationSeconds
    };
}

/* Mirrors scheduling.js's transactionalUpdateSchedules() but scoped to
   patching a single appointment by id — timer start/stop doesn't need
   the double-booking conflict handling that function guards against, so
   a plain read-patch-write transaction is enough here. Optimistically
   updates localStorage + the on-screen table first so the therapist who
   pressed the button sees it instantly, then syncs to Firestore so
   every other signed-in dashboard picks it up via crownCloudUpdate. */
async function updateAppointmentTimer(branchName, date, appointmentId, patch){
    const schedule = getSchedule(branchName, date);

    const index = schedule.findIndex(function(item){
        return item.id === appointmentId;
    });

    if(index === -1){
        return;
    }

    schedule[index] = Object.assign({}, schedule[index], patch);

    localStorage.setItem(
        getScheduleStorageKey(branchName, date),
        JSON.stringify(schedule)
    );

    if(localStorage.getItem(BRANCH_KEY) === branchName){
        const branch =
            getBranches().find(function(item){
                return item.name === branchName;
            });

        if(branch){
            renderSchedule(branch);
        }
    }

    if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
        return;
    }

    const key = getScheduleStorageKey(branchName, date);

    const ref =
        firebase.firestore()
            .collection("appData")
            .doc(encodeURIComponent(key));

    try{
        await firebase.firestore().runTransaction(async function(transaction){
            const snap = await transaction.get(ref);
            const data = snap.exists ? snap.data() : null;

            if(data && Number.isInteger(data.chunkCount) && data.chunkCount > 1){
                return;
            }

            let current = [];

            if(data && !data.deleted && data.value){
                try{
                    const parsed = JSON.parse(data.value);
                    current = Array.isArray(parsed) ? parsed : [];
                }catch(error){
                    current = [];
                }
            }

            const currentIndex =
                current.findIndex(function(item){
                    return item.id === appointmentId;
                });

            if(currentIndex === -1){
                return;
            }

            current[currentIndex] =
                Object.assign({}, current[currentIndex], patch);

            transaction.set(ref, {
                key: key,
                chunkIndex: 0,
                chunkCount: 1,
                value: JSON.stringify(current),
                deleted: false,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
    }catch(error){
        console.error("Unable to sync appointment timer:", error);
    }
}

/* Only a signed-in Therapist gets the Start/Stop control — everyone else
   on the Dashboard (Admin, EA, etc.) still sees the Bed-column countdown
   once it's running, they just can't drive it. */
function canControlAppointmentTimer(){
    const user =
        window.CrownAuth ? CrownAuth.getCurrentUser() : null;

    return Boolean(user && user.role === "Therapist");
}

function renderScheduleDetailTimerButton(){
    const footer = document.getElementById("scheduleDetailTimerFooter");
    const btn = document.getElementById("scheduleDetailTimerBtn");

    if(!footer || !btn || !currentScheduleDetailContext){
        return;
    }

    renderScheduleDetailActualDuration();

    if(!canControlAppointmentTimer()){
        footer.classList.add("d-none");
        return;
    }

    footer.classList.remove("d-none");

    const status = currentScheduleDetailContext.appointment.timerStatus || "idle";

    btn.classList.remove("btn-success", "btn-danger", "btn-secondary");

    if(status === "running"){
        btn.textContent = "Stop";
        btn.disabled = false;
        btn.classList.add("btn-danger");
    }else if(status === "done"){
        btn.textContent = "Done";
        btn.disabled = true;
        btn.classList.add("btn-secondary");
    }else{
        btn.textContent = "Start";
        btn.disabled = false;
        btn.classList.add("btn-success");
    }

    updateScheduleDetailTimerRemaining();
}

function renderScheduleDetailActualDuration(){
    const wrapper =
        document.getElementById("scheduleDetailActualDurationWrapper");

    const valueEl =
        document.getElementById("scheduleDetailActualDuration");

    if(!wrapper || !valueEl || !currentScheduleDetailContext){
        return;
    }

    const appointment = currentScheduleDetailContext.appointment;

    if(appointment.timerStatus !== "done" || !appointment.timerStoppedAt){
        wrapper.classList.add("d-none");
        return;
    }

    valueEl.textContent =
        formatCountdown(Number(appointment.actualDurationSeconds) || 0) +
        " (" +
        new Date(appointment.timerStoppedAt).toLocaleTimeString("en-PH", {
            hour: "numeric",
            minute: "2-digit"
        }) +
        ")";

    wrapper.classList.remove("d-none");
}

function updateScheduleDetailTimerRemaining(){
    const remainingEl =
        document.getElementById("scheduleDetailTimerRemaining");

    if(!remainingEl || !currentScheduleDetailContext){
        return;
    }

    const appointment = currentScheduleDetailContext.appointment;

    if(appointment.timerStatus !== "running"){
        remainingEl.classList.add("d-none");
        return;
    }

    const remaining = getRemainingSeconds(appointment);

    remainingEl.textContent = formatCountdown(remaining);
    remainingEl.classList.remove("d-none");

    remainingEl.classList.toggle(
        "timer-urgent",
        remaining <= TIMER_URGENT_THRESHOLD_SECONDS
    );
}

async function handleTimerButtonClick(){
    if(!currentScheduleDetailContext || !canControlAppointmentTimer()){
        return;
    }

    const { appointment, branch, selectedDate } = currentScheduleDetailContext;
    const status = appointment.timerStatus || "idle";

    if(status === "done"){
        return;
    }

    const btn = document.getElementById("scheduleDetailTimerBtn");
    btn.disabled = true;

    const patch =
        status === "running"
            ? buildStopTimerPatch(appointment)
            : {
                timerStatus: "running",
                timerStartedAt: Date.now(),
                timerDurationSeconds: getAppointmentTotalSeconds(appointment)
            };

    await updateAppointmentTimer(
        branch.name,
        selectedDate,
        appointment.id,
        patch
    );

    Object.assign(appointment, patch);
    renderScheduleDetailTimerButton();
}

/* Keeps the open modal's Start/Stop/Done state in sync when a
   crownCloudUpdate arrives (e.g. another device stopped this same
   appointment's timer while this therapist still has the card open). */
function refreshOpenScheduleDetailContext(){
    if(!currentScheduleDetailContext){
        return;
    }

    const { appointment, branch, selectedDate } = currentScheduleDetailContext;

    const fresh =
        getSchedule(branch.name, selectedDate).find(function(item){
            return item.id === appointment.id;
        });

    if(fresh){
        currentScheduleDetailContext.appointment = fresh;
        renderScheduleDetailTimerButton();
    }
}
