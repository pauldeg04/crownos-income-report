const BRANCH_KEY = "crownSelectedBranch";
const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SCHEDULE_PREFIX = "crownSchedule_";

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

    renderScheduleHeader(branch.beds);
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

function renderScheduleHeader(numberOfBeds){
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
            </div>
        `;
    }

    head.innerHTML = html;
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

    if(window.ClientForms){
        const client =
            await ensureClientRecordForForms(appointment.client || "", branch.name);

        currentScheduleDetailContext = {
            client: client,
            visitLike: {
                date: selectedDate,
                branch: branch.name,
                items: getAppointmentServiceList(appointment).join(", ")
            }
        };

        renderScheduleDetailForms();
    }

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
