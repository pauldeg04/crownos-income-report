const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SERVICE_MASTER_KEY = "crownServiceMasterList";
const CLIENT_MASTER_KEY = "crownClientMasterList";
const THERAPIST_MASTER_KEY = "crownTherapistMasterList";
const SELECTED_BRANCH_KEY = "crownSelectedBranch";
const SCHEDULE_PREFIX = "crownSchedule_";
const BLOCKED_DATES_KEY = "crownBlockedDates";
const ALL_BRANCHES_LABEL = "All Branches";

/* Synthetic service, not part of crownServiceMasterList — lets staff book
   a slot (with a flat 1-hour hold) before the client has settled on a
   treatment, same idea as the public booking form's "Not sure yet". Never
   looked up via getServices()/services.find(); getSelectedServiceObjects()
   and getCompanionSelectedServices() special-case it directly. */
const WILL_CHOOSE_SERVICE_NAME = "Will choose upon arrival";
const WILL_CHOOSE_SERVICE_DURATION = 60;

let selectedBed = null;
let selectedStartTime = "";
let selectedScheduleId = null;
let modalServiceRows = [];
let modalCompanions = [];

/* The date the appointment currently being edited actually lives under
   (its crownSchedule_<branch>_<date> bucket) — captured when the modal
   opens so saveSchedule() can tell whether the staff member picked a
   different modalDate (rescheduling to another day) and, if so, remove
   the entry from this original bucket instead of leaving a duplicate
   behind. Null for brand-new appointments. */
let selectedScheduleOriginalDate = null;

/* The blocked-date entry (if any) backing the inline block-date checkbox
   for whichever branch/date is currently on screen — set by
   renderBlockDateControl(), read by toggleBlockDate()/updateBlockDateReason()
   so unchecking or editing the reason acts on the exact entry shown,
   even if it happens to be an old "All Branches" entry rather than one
   scoped to this specific branch. */
let blockedDateEntryId = null;

/* Pending (unexpired) web-booking holds for the currently selected
   branch/date — see Income Report/functions/index.js (scheduleHolds
   collection). Refreshed by renderSchedule() whenever branch/date
   changes; used only for the capacity check in saveSchedule() so a staff
   member creating a brand-new appointment can't push demand past the
   branch's bed count without noticing a pending web request. Holds have
   no bed/therapist, so they never participate in the existing per-bed
   conflict checks (poolHasConflict/poolHasTherapistConflict). */
let activeHoldsCache = [];

/* Set while the "new appointment" modal was opened from a public-website
   booking request (?fromRequest=<id> — see openNewModalFromBookingRequest)
   so a successful save can flip that request to "converted". Cleared by
   closeModal() on cancel, or by saveSchedule() after use. */
let pendingRequestId = null;

/* The mobile/email the guest entered on the public booking form, carried
   alongside pendingRequestId so saveSchedule() can back-fill it onto the
   client's record in crownClientMasterList (see ensureClientExists) —
   otherwise a client created from a booking request would have no
   Contact info recorded anywhere except free-text inside Notes. Cleared
   wherever pendingRequestId is cleared. */
let pendingRequestContact = null;

document.addEventListener("DOMContentLoaded", function(){
    initializeDate();
    loadBranchOptions();
    loadClientOptions();
    attachEvents();
    renderSchedule();
    renderUpcomingAndHistory();
    renderBlockedDatesTable();

    const requestId =
        new URLSearchParams(location.search).get("fromRequest");

    if(requestId){
        openNewModalFromBookingRequest(requestId);
    }
});

function attachEvents(){
    document
        .getElementById("scheduleBranch")
        .addEventListener("change", function(){
            if(this.value){
                localStorage.setItem(
                    SELECTED_BRANCH_KEY,
                    this.value
                );
            }else{
                localStorage.removeItem(
                    SELECTED_BRANCH_KEY
                );
            }

            renderSchedule();
            renderUpcomingAndHistory();
        });

    document
        .getElementById("scheduleDate")
        .addEventListener("change", renderSchedule);

    document
        .getElementById("prevDayBtn")
        .addEventListener("click", function(){
            stepScheduleDate(-1);
        });

    document
        .getElementById("nextDayBtn")
        .addEventListener("click", function(){
            stepScheduleDate(1);
        });

    document
        .getElementById("addServiceBtn")
        .addEventListener("click", addServiceRow);

    document
        .getElementById("modalClient")
        .addEventListener("input", updateCompanionOfHints);

    document
        .getElementById("addCompanionBtn")
        .addEventListener("click", addCompanionRow);

    document
        .getElementById("modalTherapist")
        .addEventListener("change", updateModalPreview);

    document
        .getElementById("modalDate")
        .addEventListener("change", function(){
            updateSelectedSlotLabel();
            updateModalPreview();
        });

    document
        .getElementById("modalBed")
        .addEventListener("change", function(){
            selectedBed = Number(this.value) || null;
            updateModalPreview();
        });

    document
        .getElementById("modalStartTime")
        .addEventListener("change", function(){
            selectedStartTime = this.value;
            updateModalPreview();
        });

    document
        .getElementById("closeModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("cancelModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("saveModalBtn")
        .addEventListener("click", saveSchedule);

    document
        .getElementById("deleteScheduleBtn")
        .addEventListener("click", deleteSelectedSchedule);

    document
        .getElementById("scheduleModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeModal();
            }
        });

    document
        .getElementById("showScheduleHistoryBtn")
        .addEventListener("click", openScheduleHistoryModal);

    document
        .getElementById("closeScheduleHistoryModalBtn")
        .addEventListener("click", closeScheduleHistoryModal);

    document
        .getElementById("closeScheduleHistoryBtn")
        .addEventListener("click", closeScheduleHistoryModal);

    document
        .getElementById("scheduleHistoryModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeScheduleHistoryModal();
            }
        });

    document
        .getElementById("blockDateCheckbox")
        .addEventListener("change", toggleBlockDate);

    document
        .getElementById("blockDateReasonInput")
        .addEventListener("change", updateBlockDateReason);

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeModal();
            closeScheduleHistoryModal();
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

function initializeDate(){
    document.getElementById("scheduleDate").value =
        getTodayDateString();
}

function getTodayDateString(){
    const today = new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
}

/* Uses the shared day-math helper sidebar.js exposes (CrownDateStepper) so
   every page's date stepper agrees on how a day boundary/rollover works,
   rather than each page reimplementing it slightly differently. */
function stepScheduleDate(days){
    const input =
        document.getElementById("scheduleDate");

    input.value =
        window.CrownDateStepper?.addDays?.(
            input.value || getTodayDateString(),
            days
        ) || input.value;

    renderSchedule();
}

function getBranches(){
    try{
        const saved =
            localStorage.getItem(BRANCH_MASTER_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        const allBranches =
            parsed.map(function(branch){
                if(typeof branch === "string"){
                    return {
                        id: createId(),
                        name: branch,
                        beds: 1,
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

function getServices(){
    try{
        const saved =
            localStorage.getItem(SERVICE_MASTER_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        return parsed.map(function(service){
            if(typeof service === "string"){
                return {
                    id: createId(),
                    name: service,
                    duration: inferDuration(service)
                };
            }

            return {
                id: service.id || createId(),
                name: service.name || "",
                duration: Number(service.duration) || 0
            };
        });
    }catch(error){
        console.error("Unable to load services:", error);
        return [];
    }
}

function getClients(){
    try{
        const saved =
            localStorage.getItem(CLIENT_MASTER_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load clients:", error);
        return [];
    }
}

function getTherapists(){
    try{
        const saved =
            localStorage.getItem(THERAPIST_MASTER_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        if(!Array.isArray(parsed)){
            return [];
        }

        const branch =
            getSelectedBranch();

        const branchName =
            branch ? branch.name : "";

        return parsed
            .map(function(therapist){
                if(typeof therapist === "string"){
                    return {
                        name: therapist,
                        branches: [],
                        status: "Active"
                    };
                }

                return {
                    name: therapist.name || "",
                    branches:
                        Array.isArray(therapist.branches)
                            ? therapist.branches
                            : [],
                    status: therapist.status || "Active"
                };
            })
            .filter(function(therapist){
                return (
                    therapist.name &&
                    therapist.status === "Active" &&
                    (
                        therapist.branches.length === 0 ||
                        therapist.branches.includes(branchName)
                    )
                );
            })
            .map(function(therapist){
                return therapist.name;
            })
            .sort();
    }catch(error){
        console.error("Unable to load therapists:", error);
        return [];
    }
}

function inferDuration(name){
    const match =
        String(name || "").match(/(\d+)\s*mins?/i);

    return match ? Number(match[1]) || 0 : 0;
}

function loadBranchOptions(){
    const select =
        document.getElementById("scheduleBranch");

    select.innerHTML =
        '<option value="">Select Branch</option>';

    getBranches().forEach(function(branch){
        const option =
            document.createElement("option");

        option.value = branch.name;
        option.textContent = branch.name;

        select.appendChild(option);
    });

    select.value =
        localStorage.getItem(SELECTED_BRANCH_KEY) || "";
}

function buildServiceOptionsHtml(selectedName){
    let html =
        '<option value="">Select Service</option>';

    html += `
        <option
            value="${escapeHtml(WILL_CHOOSE_SERVICE_NAME)}"
            ${WILL_CHOOSE_SERVICE_NAME === selectedName ? "selected" : ""}
        >
            ${escapeHtml(WILL_CHOOSE_SERVICE_NAME)} (${WILL_CHOOSE_SERVICE_DURATION} mins)
        </option>
    `;

    getServices().forEach(function(service){
        const label =
            service.duration > 0
                ? `${service.name} (${service.duration} mins)`
                : `${service.name} (Duration not set)`;

        html += `
            <option
                value="${escapeHtml(service.name)}"
                ${service.name === selectedName ? "selected" : ""}
            >
                ${escapeHtml(label)}
            </option>
        `;
    });

    return html;
}

function resetModalServices(rowNames){
    const names =
        Array.isArray(rowNames) && rowNames.length > 0
            ? rowNames
            : [""];

    modalServiceRows =
        names.map(function(name){
            return {
                id: createId(),
                name: name || ""
            };
        });

    renderServiceRows();
}

function addServiceRow(){
    modalServiceRows.push({
        id: createId(),
        name: ""
    });

    renderServiceRows();
    updateModalPreview();
}

function removeServiceRow(rowId){
    if(modalServiceRows.length <= 1){
        return;
    }

    modalServiceRows =
        modalServiceRows.filter(function(row){
            return row.id !== rowId;
        });

    renderServiceRows();
    updateModalPreview();
}

function renderServiceRows(){
    const container =
        document.getElementById("modalServicesList");

    container.innerHTML = "";

    modalServiceRows.forEach(function(row){
        const rowEl =
            document.createElement("div");

        rowEl.className = "modal-service-row";

        rowEl.innerHTML = `
            <select class="form-select modal-service-select">
                ${buildServiceOptionsHtml(row.name)}
            </select>

            ${
                modalServiceRows.length > 1
                    ? `
                        <button
                            type="button"
                            class="modal-service-remove-btn"
                            aria-label="Remove service"
                        >
                            ×
                        </button>
                    `
                    : ""
            }
        `;

        rowEl.querySelector(".modal-service-select")
            .addEventListener("change", function(){
                row.name = this.value;
                updateModalPreview();
            });

        const removeBtn =
            rowEl.querySelector(".modal-service-remove-btn");

        if(removeBtn){
            removeBtn.addEventListener("click", function(){
                removeServiceRow(row.id);
            });
        }

        container.appendChild(rowEl);
    });
}

function resolveServiceRowToObject(rowName, services){
    if(rowName === WILL_CHOOSE_SERVICE_NAME){
        return {
            name: WILL_CHOOSE_SERVICE_NAME,
            duration: WILL_CHOOSE_SERVICE_DURATION
        };
    }

    return services.find(function(service){
        return service.name === rowName;
    });
}

function getSelectedServiceObjects(){
    const services =
        getServices();

    return modalServiceRows
        .filter(function(row){
            return row.name;
        })
        .map(function(row){
            return resolveServiceRowToObject(row.name, services);
        })
        .filter(Boolean);
}

function buildTherapistOptionsHtml(selectedName){
    let html =
        '<option value="">To be Assigned</option>';

    getTherapists().forEach(function(name){
        html += `
            <option
                value="${escapeHtml(name)}"
                ${name === selectedName ? "selected" : ""}
            >
                ${escapeHtml(name)}
            </option>
        `;
    });

    return html;
}

function buildBedOptionsHtml(branch, selectedBed){
    let html =
        '<option value="">Select Bed</option>';

    if(!branch){
        return html;
    }

    for(let bed = 1; bed <= branch.beds; bed++){
        html += `
            <option
                value="${bed}"
                ${String(bed) === String(selectedBed) ? "selected" : ""}
            >
                Bed ${bed}
            </option>
        `;
    }

    return html;
}

function resetModalCompanions(existingCompanions){
    modalCompanions =
        Array.isArray(existingCompanions) && existingCompanions.length > 0
            ? existingCompanions.map(function(entry){
                const serviceNames =
                    Array.isArray(entry.services) && entry.services.length > 0
                        ? entry.services
                        : (entry.service ? [entry.service] : [""]);

                return {
                    id: createId(),
                    name: entry.client || "",
                    therapist: entry.therapist || "",
                    bed: entry.bed ? String(entry.bed) : "",
                    startTime: entry.startTime || "",
                    services: serviceNames.map(function(name){
                        return {
                            id: createId(),
                            name: name || ""
                        };
                    })
                };
            })
            : [];

    renderCompanions();
}

function getNearestBedOrder(branch, preferredBed){
    const beds = [];

    for(let bed = 1; bed <= branch.beds; bed++){
        beds.push(bed);
    }

    if(!preferredBed){
        return beds;
    }

    return beds.slice().sort(function(a, b){
        const distanceA =
            Math.abs(a - preferredBed);

        const distanceB =
            Math.abs(b - preferredBed);

        return distanceA !== distanceB
            ? distanceA - distanceB
            : a - b;
    });
}

function recommendCompanionSlot(companion){
    const branch =
        getSelectedBranch();

    if(!branch){
        return;
    }

    const mainServices =
        getSelectedServiceObjects();

    const durationGuess =
        mainServices.length > 0
            ? mainServices.reduce(function(sum, service){
                return sum + service.duration;
            }, 0)
            : 10;

    const bedOrder =
        getNearestBedOrder(branch, Number(selectedBed) || 1);

    const pool =
        getConflictPool(companion.id);

    const startTime =
        companion.startTime || selectedStartTime;

    if(startTime){
        const endTime =
            minutesToTimeValue(
                timeToMinutes(startTime) + durationGuess
            );

        for(let i = 0; i < bedOrder.length; i++){
            const bed = bedOrder[i];

            if(!poolHasConflict(bed, startTime, endTime, pool)){
                companion.bed = String(bed);
                companion.startTime = startTime;
                return;
            }
        }
    }

    const searchFromMinutes =
        timeToMinutes(startTime || selectedStartTime);

    let best = null;

    bedOrder.forEach(function(bed, order){
        const slot =
            findNextAvailableStart(branch, bed, durationGuess, pool, searchFromMinutes);

        if(!slot){
            return;
        }

        if(
            !best ||
            timeToMinutes(slot.startTime) < timeToMinutes(best.startTime) ||
            (
                timeToMinutes(slot.startTime) === timeToMinutes(best.startTime) &&
                order < best.order
            )
        ){
            best = {
                bed: bed,
                startTime: slot.startTime,
                order: order
            };
        }
    });

    if(best){
        companion.bed = String(best.bed);
        companion.startTime = best.startTime;
    }
}

function addCompanionRow(){
    const companion = {
        id: createId(),
        name: "",
        therapist: "",
        bed: "",
        startTime: selectedStartTime || "",
        services: [{ id: createId(), name: "" }]
    };

    recommendCompanionSlot(companion);

    modalCompanions.push(companion);

    renderCompanions();
}

function removeCompanionRow(companionId){
    modalCompanions =
        modalCompanions.filter(function(companion){
            return companion.id !== companionId;
        });

    renderCompanions();
    updateModalPreview();
}

function updateCompanionOfHints(){
    const principalName =
        document.getElementById("modalClient").value.trim() ||
        "the client";

    document.querySelectorAll(".companion-of-name")
        .forEach(function(element){
            element.textContent = principalName;
        });
}

function renderCompanions(){
    const container =
        document.getElementById("modalCompanionsList");

    container.innerHTML = "";

    const branch =
        getSelectedBranch();

    const principalName =
        document.getElementById("modalClient").value.trim() ||
        "the client";

    modalCompanions.forEach(function(companion, index){
        const card =
            document.createElement("div");

        card.className = "companion-card";
        card.dataset.companionId = companion.id;

        card.innerHTML = `
            <div class="companion-card-header">
                <div>
                    <span class="companion-number">
                        Companion ${index + 1}
                    </span>

                    <p class="companion-of-hint">
                        Companion of
                        <span class="companion-of-name">${escapeHtml(principalName)}</span>
                    </p>
                </div>

                <button
                    type="button"
                    class="companion-remove-btn"
                    aria-label="Remove companion"
                >
                    ×
                </button>
            </div>

            <div class="row g-2">
                <div class="col-12">
                    <label class="form-label">
                        Companion Name
                    </label>

                    <input
                        type="text"
                        class="form-control companion-name-input"
                        list="clientOptions"
                        placeholder="Type or select companion"
                        autocomplete="off"
                        value="${escapeHtml(companion.name)}"
                    >
                </div>

                <div class="col-12">
                    <label class="form-label">
                        Services
                    </label>

                    <div class="companion-services-list"></div>

                    <button
                        type="button"
                        class="btn btn-outline-success btn-sm mt-2 companion-add-service"
                    >
                        + Add Service
                    </button>
                </div>

                <div class="col-12">
                    <label class="form-label">
                        Therapist
                    </label>

                    <select class="form-select companion-therapist-select">
                        ${buildTherapistOptionsHtml(companion.therapist)}
                    </select>
                </div>

                <div class="col-md-4">
                    <label class="form-label">
                        Bed
                    </label>

                    <select class="form-select companion-bed-select">
                        ${buildBedOptionsHtml(branch, companion.bed)}
                    </select>
                </div>

                <div class="col-md-4">
                    <label class="form-label">
                        Start Time
                    </label>

                    <input
                        type="time"
                        class="form-control companion-start-input"
                        step="60"
                        value="${escapeHtml(companion.startTime || "")}"
                    >
                </div>

                <div class="col-md-4">
                    <label class="form-label">
                        End Time
                    </label>

                    <div class="modal-readout companion-end-readout">
                        —
                    </div>
                </div>
            </div>

            <div class="companion-message d-none"></div>
        `;

        card.querySelector(".companion-remove-btn")
            .addEventListener("click", function(){
                removeCompanionRow(companion.id);
            });

        card.querySelector(".companion-name-input")
            .addEventListener("input", function(){
                companion.name = this.value;
            });

        card.querySelector(".companion-therapist-select")
            .addEventListener("change", function(){
                companion.therapist = this.value;
                updateModalPreview();
            });

        card.querySelector(".companion-bed-select")
            .addEventListener("change", function(){
                companion.bed = this.value;
                updateModalPreview();
            });

        card.querySelector(".companion-start-input")
            .addEventListener("change", function(){
                companion.startTime = this.value;
                updateModalPreview();
            });

        card.querySelector(".companion-add-service")
            .addEventListener("click", function(){
                addCompanionServiceRow(companion.id);
            });

        container.appendChild(card);

        renderCompanionServiceRows(companion);
        updateCompanionPreview(companion.id);
    });
}

function renderCompanionServiceRows(companion){
    const card =
        document.querySelector(
            `.companion-card[data-companion-id="${companion.id}"]`
        );

    if(!card){
        return;
    }

    const container =
        card.querySelector(".companion-services-list");

    container.innerHTML = "";

    companion.services.forEach(function(row){
        const rowEl =
            document.createElement("div");

        rowEl.className = "companion-service-row";

        rowEl.innerHTML = `
            <select class="form-select companion-service-select">
                ${buildServiceOptionsHtml(row.name)}
            </select>

            ${
                companion.services.length > 1
                    ? `
                        <button
                            type="button"
                            class="companion-service-remove-btn"
                            aria-label="Remove service"
                        >
                            ×
                        </button>
                    `
                    : ""
            }
        `;

        rowEl.querySelector(".companion-service-select")
            .addEventListener("change", function(){
                row.name = this.value;
                updateModalPreview();
            });

        const removeBtn =
            rowEl.querySelector(".companion-service-remove-btn");

        if(removeBtn){
            removeBtn.addEventListener("click", function(){
                removeCompanionServiceRow(companion.id, row.id);
            });
        }

        container.appendChild(rowEl);
    });
}

function addCompanionServiceRow(companionId){
    const companion =
        modalCompanions.find(function(item){
            return item.id === companionId;
        });

    if(!companion){
        return;
    }

    companion.services.push({
        id: createId(),
        name: ""
    });

    renderCompanionServiceRows(companion);
    updateModalPreview();
}

function removeCompanionServiceRow(companionId, rowId){
    const companion =
        modalCompanions.find(function(item){
            return item.id === companionId;
        });

    if(!companion || companion.services.length <= 1){
        return;
    }

    companion.services =
        companion.services.filter(function(row){
            return row.id !== rowId;
        });

    renderCompanionServiceRows(companion);
    updateModalPreview();
}

function getCompanionSelectedServices(companion){
    const services =
        getServices();

    return companion.services
        .filter(function(row){
            return row.name;
        })
        .map(function(row){
            return resolveServiceRowToObject(row.name, services);
        })
        .filter(Boolean);
}

function getMainDraftSlot(){
    if(!selectedBed || !selectedStartTime){
        return null;
    }

    const services =
        getSelectedServiceObjects();

    if(
        services.length === 0 ||
        services.some(function(service){
            return !service.duration || service.duration <= 0;
        })
    ){
        return null;
    }

    const totalDuration =
        services.reduce(function(sum, service){
            return sum + service.duration;
        }, 0);

    return {
        bed: selectedBed,
        startTime: selectedStartTime,
        endTime: minutesToTimeValue(
            timeToMinutes(selectedStartTime) + totalDuration
        )
    };
}

function getCompanionDraftSlot(companion){
    if(!companion.bed || !companion.startTime){
        return null;
    }

    const services =
        getCompanionSelectedServices(companion);

    if(
        services.length === 0 ||
        services.some(function(service){
            return !service.duration || service.duration <= 0;
        })
    ){
        return null;
    }

    const totalDuration =
        services.reduce(function(sum, service){
            return sum + service.duration;
        }, 0);

    return {
        bed: companion.bed,
        startTime: companion.startTime,
        endTime: minutesToTimeValue(
            timeToMinutes(companion.startTime) + totalDuration
        )
    };
}

/* The modal's own Date field, defaulting to the page-level date filter
   for callers outside the modal (e.g. before it has been opened). Reading
   this instead of #scheduleDate directly is what lets staff pick a
   different date inside the "Edit Appointment" modal and have conflict
   checks / saves target that date rather than whichever day the calendar
   view happens to be showing. */
function getModalDate(){
    return (
        document.getElementById("modalDate")?.value ||
        document.getElementById("scheduleDate").value
    );
}

function getPersistedConflictPool(){
    const branch =
        getSelectedBranch();

    const date =
        getModalDate();

    if(!branch || !date){
        return [];
    }

    return getSchedules(branch.name, date).filter(function(item){
        return (
            item.status !== "Cancelled" &&
            item.id !== selectedScheduleId &&
            item.companionOf !== selectedScheduleId
        );
    });
}

function poolHasConflict(bed, startTime, endTime, pool){
    return pool.some(function(item){
        if(!bed || Number(item.bed) !== Number(bed)){
            return false;
        }

        return hasOverlap(
            startTime,
            endTime,
            item.startTime,
            item.endTime
        );
    });
}

function poolHasTherapistConflict(therapistName, startTime, endTime, pool){
    if(!therapistName){
        return false;
    }

    return pool.some(function(item){
        if(item.therapist !== therapistName){
            return false;
        }

        return hasOverlap(
            startTime,
            endTime,
            item.startTime,
            item.endTime
        );
    });
}

function getAllDraftSlots(excludeKey){
    const slots = [];

    if(excludeKey !== "main"){
        const mainSlot =
            getMainDraftSlot();

        if(mainSlot){
            slots.push({
                bed: mainSlot.bed,
                therapist: document.getElementById("modalTherapist").value,
                startTime: mainSlot.startTime,
                endTime: mainSlot.endTime
            });
        }
    }

    modalCompanions.forEach(function(companion){
        if(companion.id === excludeKey){
            return;
        }

        const slot =
            getCompanionDraftSlot(companion);

        if(!slot){
            return;
        }

        slots.push({
            bed: slot.bed,
            therapist: companion.therapist,
            startTime: slot.startTime,
            endTime: slot.endTime
        });
    });

    return slots;
}

function getConflictPool(excludeKey){
    return getPersistedConflictPool().concat(getAllDraftSlots(excludeKey));
}

function findAlternateBed(branch, excludeBed, startTime, endTime, pool){
    for(let bed = 1; bed <= branch.beds; bed++){
        if(bed === Number(excludeBed)){
            continue;
        }

        if(!poolHasConflict(bed, startTime, endTime, pool)){
            return bed;
        }
    }

    return null;
}

function findNextAvailableStart(branch, bed, durationMinutes, pool, searchFromMinutes){
    const opening =
        timeToMinutes(branch.openingTime);

    const closing =
        timeToMinutes(branch.closingTime);

    const earliestStart =
        typeof searchFromMinutes === "number"
            ? Math.max(opening, Math.ceil(searchFromMinutes / 10) * 10)
            : opening;

    for(
        let start = earliestStart;
        start + durationMinutes <= closing;
        start += 10
    ){
        const startTimeValue =
            minutesToTimeValue(start);

        const endTimeValue =
            minutesToTimeValue(start + durationMinutes);

        if(!poolHasConflict(bed, startTimeValue, endTimeValue, pool)){
            return {
                startTime: startTimeValue,
                endTime: endTimeValue
            };
        }
    }

    return null;
}

function showCompanionMessage(element, type, text){
    element.className =
        `companion-message companion-message-${type}`;

    element.textContent = text;
}

function hideCompanionMessage(element){
    element.className =
        "companion-message d-none";

    element.textContent = "";
}

function updateCompanionPreview(companionId){
    const companion =
        modalCompanions.find(function(item){
            return item.id === companionId;
        });

    if(!companion){
        return;
    }

    const card =
        document.querySelector(
            `.companion-card[data-companion-id="${companion.id}"]`
        );

    if(!card){
        return;
    }

    const endReadout =
        card.querySelector(".companion-end-readout");

    const messageEl =
        card.querySelector(".companion-message");

    const branch =
        getSelectedBranch();

    const services =
        getCompanionSelectedServices(companion);

    if(services.length === 0 || !companion.startTime){
        endReadout.textContent = "—";
        hideCompanionMessage(messageEl);
        return;
    }

    const hasMissingDuration =
        services.some(function(service){
            return !service.duration || service.duration <= 0;
        });

    if(hasMissingDuration){
        endReadout.textContent = "—";

        showCompanionMessage(
            messageEl,
            "danger",
            "One or more selected services has no duration set."
        );

        return;
    }

    const totalDuration =
        services.reduce(function(sum, service){
            return sum + service.duration;
        }, 0);

    const endTime =
        minutesToTimeValue(
            timeToMinutes(companion.startTime) + totalDuration
        );

    endReadout.textContent = formatTime(endTime);

    const isOvertime =
        timeToMinutes(endTime) >
        timeToMinutes(branch.closingTime);

    if(!companion.bed){
        hideCompanionMessage(messageEl);
        return;
    }

    const pool =
        getConflictPool(companion.id);

    if(poolHasConflict(companion.bed, companion.startTime, endTime, pool)){
        const altBed =
            findAlternateBed(
                branch,
                companion.bed,
                companion.startTime,
                endTime,
                pool
            );

        const altSlot =
            findNextAvailableStart(
                branch,
                companion.bed,
                totalDuration,
                pool,
                timeToMinutes(companion.startTime)
            );

        let message =
            `Bed ${companion.bed} is already booked during ${formatTimeRange(companion.startTime, endTime)}.`;

        const suggestions = [];

        if(altBed){
            suggestions.push(`Bed ${altBed} is free at this time.`);
        }

        if(altSlot){
            suggestions.push(
                `Bed ${companion.bed} is next free starting ${formatTime(altSlot.startTime)}.`
            );
        }

        if(suggestions.length > 0){
            message += " " + suggestions.join(" Or ");
        }

        showCompanionMessage(messageEl, "danger", message);
        return;
    }

    if(
        companion.therapist &&
        poolHasTherapistConflict(companion.therapist, companion.startTime, endTime, pool)
    ){
        showCompanionMessage(
            messageEl,
            "danger",
            `${companion.therapist} is already assigned to another appointment during this time.`
        );

        return;
    }

    if(isOvertime){
        showCompanionMessage(
            messageEl,
            "warning",
            `Bed ${companion.bed} is available until ${formatTime(endTime)} — this goes past closing time (${formatTime(branch.closingTime)}) and will be booked as overtime.`
        );

        return;
    }

    showCompanionMessage(
        messageEl,
        "success",
        `Bed ${companion.bed} is available until ${formatTime(endTime)}.`
    );
}

function updateAllCompanionPreviews(){
    modalCompanions.forEach(function(companion){
        updateCompanionPreview(companion.id);
    });
}

function loadClientOptions(){
    const datalist =
        document.getElementById("clientOptions");

    datalist.innerHTML = "";

    getClients()
        .slice()
        .sort(function(a, b){
            return String(a.name || "")
                .localeCompare(String(b.name || ""));
        })
        .forEach(function(client){
            const option =
                document.createElement("option");

            option.value = client.name || "";

            option.label = [
                client.mobile,
                client.branch
            ].filter(Boolean).join(" • ");

            datalist.appendChild(option);
        });
}

function loadTherapistOptions(){
    const select =
        document.getElementById("modalTherapist");

    select.innerHTML =
        buildTherapistOptionsHtml(select.value);
}

function getSelectedBranch(){
    const branchName =
        document.getElementById("scheduleBranch").value;

    return getBranches().find(function(branch){
        return branch.name === branchName;
    }) || null;
}

function timeToMinutes(timeValue){
    const parts =
        String(timeValue || "00:00").split(":");

    return (
        Number(parts[0]) * 60 +
        Number(parts[1])
    );
}

function minutesToTimeValue(totalMinutes){
    return (
        String(Math.floor(totalMinutes / 60)).padStart(2, "0") +
        ":" +
        String(totalMinutes % 60).padStart(2, "0")
    );
}

function formatTime(timeValue){
    const total =
        timeToMinutes(timeValue);

    const hour24 =
        Math.floor(total / 60);

    const minute =
        total % 60;

    const suffix =
        hour24 >= 12 ? "PM" : "AM";

    return (
        (hour24 % 12 || 12) +
        ":" +
        String(minute).padStart(2, "0") +
        " " +
        suffix
    );
}

function formatTimeRange(startTime, endTime){
    return (
        formatTime(startTime) +
        " – " +
        formatTime(endTime)
    );
}

function getStorageKey(branchName, date){
    return (
        SCHEDULE_PREFIX +
        branchName +
        "_" +
        date
    );
}

function getSchedules(branchName, date){
    if(!branchName || !date){
        return [];
    }

    try{
        const saved =
            localStorage.getItem(
                getStorageKey(branchName, date)
            );

        const parsed =
            saved ? JSON.parse(saved) : [];

        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load schedules:", error);
        return [];
    }
}

function saveSchedules(branchName, date, schedules){
    localStorage.setItem(
        getStorageKey(branchName, date),
        JSON.stringify(schedules)
    );
}

/* Dates marked unavailable for ONLINE booking (Income Report/functions/
   index.js's getAvailableSlots/submitBookingRequest read this same
   crownBlockedDates key via appData). Blocking a date does NOT touch or
   hide any existing localStorage schedule entries — staff can still
   create/edit appointments manually on a blocked date, it only stops the
   public website from offering it. Stored as a single flat array (small,
   no per-date key needed) of
   { id, branch: "<name>"|"All Branches", date, reason, blockedBy, blockedAt }. */
function getBlockedDates(){
    try{
        const saved =
            localStorage.getItem(BLOCKED_DATES_KEY);

        const parsed =
            saved ? JSON.parse(saved) : [];

        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load blocked dates:", error);
        return [];
    }
}

function saveBlockedDatesList(entries){
    localStorage.setItem(
        BLOCKED_DATES_KEY,
        JSON.stringify(entries)
    );
}

function findBlockedEntry(branchName, date){
    return getBlockedDates().find(function(entry){
        return (
            entry.date === date &&
            (entry.branch === branchName || entry.branch === ALL_BRANCHES_LABEL)
        );
    }) || null;
}

/* Syncs the inline block-date checkbox + reason input to whichever
   branch/date is currently on screen. Always blocks the SPECIFIC branch
   being viewed (unlike the old modal, which could also block "All
   Branches" at once) — if a date happens to already be blocked via an
   older "All Branches" entry, findBlockedEntry() still picks it up here
   so the checkbox shows checked and unchecking removes that entry. */
function renderBlockDateControl(branchName, date){
    const checkbox =
        document.getElementById("blockDateCheckbox");

    const reasonInput =
        document.getElementById("blockDateReasonInput");

    if(!branchName || !date){
        checkbox.checked = false;
        checkbox.disabled = true;
        reasonInput.value = "";
        reasonInput.disabled = true;
        blockedDateEntryId = null;
        return;
    }

    checkbox.disabled = false;

    const entry =
        findBlockedEntry(branchName, date);

    blockedDateEntryId =
        entry ? entry.id : null;

    checkbox.checked = !!entry;
    reasonInput.disabled = !entry;
    reasonInput.value = entry ? (entry.reason || "") : "";
}

function toggleBlockDate(){
    const checkbox =
        document.getElementById("blockDateCheckbox");

    const branch =
        getSelectedBranch();

    const date =
        document.getElementById("scheduleDate").value;

    if(!branch || !date){
        checkbox.checked = false;
        return;
    }

    if(checkbox.checked){
        const currentUser =
            typeof CrownAuth !== "undefined" && CrownAuth.getCurrentUser
                ? CrownAuth.getCurrentUser()
                : null;

        const entries =
            getBlockedDates();

        entries.push({
            id: createId(),
            branch: branch.name,
            date: date,
            reason: "",
            blockedBy: currentUser ? currentUser.account : "",
            blockedAt: new Date().toISOString()
        });

        saveBlockedDatesList(entries);
        renderBlockedDatesTable();
        renderSchedule();

        document.getElementById("blockDateReasonInput").focus();
    }else if(blockedDateEntryId){
        unblockDate(blockedDateEntryId);
    }
}

function updateBlockDateReason(){
    if(!blockedDateEntryId){
        return;
    }

    const reason =
        document.getElementById("blockDateReasonInput").value.trim();

    const entries =
        getBlockedDates().map(function(entry){
            return entry.id === blockedDateEntryId
                ? Object.assign({}, entry, { reason: reason })
                : entry;
        });

    saveBlockedDatesList(entries);
    renderBlockedDatesTable();
}

function unblockDate(id){
    const entries =
        getBlockedDates().filter(function(entry){
            return entry.id !== id;
        });

    saveBlockedDatesList(entries);
    renderBlockedDatesTable();
    renderSchedule();
}

function renderBlockedDatesTable(){
    const body =
        document.getElementById("blockedDatesBody");

    const emptyState =
        document.getElementById("blockedDatesEmptyState");

    const entries =
        getBlockedDates()
            .slice()
            .sort(function(a, b){
                return a.date.localeCompare(b.date);
            });

    if(entries.length === 0){
        body.innerHTML = "";
        emptyState.classList.remove("d-none");
        return;
    }

    emptyState.classList.add("d-none");

    body.innerHTML =
        entries.map(function(entry){
            return `
                <tr>
                    <td>${escapeHtml(entry.date)}</td>
                    <td>${escapeHtml(entry.branch)}</td>
                    <td>${escapeHtml(entry.reason || "—")}</td>
                    <td>${escapeHtml(entry.blockedBy || "—")}</td>
                    <td>
                        <button
                            type="button"
                            class="btn btn-sm btn-outline-secondary"
                            data-unblock-id="${escapeHtml(entry.id)}"
                        >
                            Unblock
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

    body.querySelectorAll("[data-unblock-id]").forEach(function(button){
        button.addEventListener("click", function(){
            unblockDate(this.dataset.unblockId);
        });
    });
}

function hasOverlap(
    startA,
    endA,
    startB,
    endB
){
    return (
        timeToMinutes(startA) < timeToMinutes(endB) &&
        timeToMinutes(endA) > timeToMinutes(startB)
    );
}

/* Refreshes activeHoldsCache for the given branch/date. Fire-and-forget
   (not awaited by callers) — renderSchedule() already renders from the
   locally-mirrored schedule synchronously; this only needs to have
   settled by the time a staff member opens/saves the appointment modal
   a moment later. */
async function refreshActiveHolds(branchName, date){
    if(!window.firebase || !firebase.apps || firebase.apps.length === 0 || !branchName || !date){
        activeHoldsCache = [];
        return;
    }

    try{
        const snapshot = await firebase.firestore()
            .collection("scheduleHolds")
            .where("branch", "==", branchName)
            .where("date", "==", date)
            .get();

        const now = Date.now();

        activeHoldsCache = snapshot.docs
            .map(function(doc){ return doc.data(); })
            .filter(function(hold){
                return (
                    hold.status === "pending" &&
                    hold.expiresAt &&
                    hold.expiresAt.toMillis() > now
                );
            });
    }catch(error){
        console.error("Unable to load active web-booking holds:", error);
        activeHoldsCache = [];
    }
}

/* Counts active holds overlapping [startTime, endTime), excluding the
   hold (if any) tied to `excludeBookingRequestId` — set to
   pendingRequestId during saveSchedule() so converting the very booking
   request that created a hold doesn't count that hold against itself. */
function countActiveHoldsOverlapping(startTime, endTime, excludeBookingRequestId){
    return activeHoldsCache.filter(function(hold){
        return (
            hold.bookingRequestId !== excludeBookingRequestId &&
            hasOverlap(startTime, endTime, hold.startTime, hold.endTime)
        );
    }).length;
}

function renderSchedule(){
    const branch =
        getSelectedBranch();

    const date =
        document.getElementById("scheduleDate").value;

    const emptyState =
        document.getElementById("scheduleEmptyState");

    const wrapper =
        document.getElementById("scheduleTableWrapper");

    if(!branch || !date){
        emptyState.classList.remove("d-none");
        wrapper.classList.add("d-none");

        document.getElementById("bedCount").textContent = "0";
        document.getElementById("operatingHours").textContent = "—";
        document.getElementById("scheduledCount").textContent = "0";

        document.getElementById("scheduleGridTitle").textContent =
            "Branch Schedule";

        document.getElementById("scheduleGridSubtitle").textContent =
            "Select a branch and date.";

        renderBlockDateControl(null, null);

        return;
    }

    const schedules =
        getSchedules(branch.name, date);

    refreshActiveHolds(branch.name, date);
    renderBlockDateControl(branch.name, date);

    emptyState.classList.add("d-none");
    wrapper.classList.remove("d-none");

    document.getElementById("bedCount").textContent =
        branch.beds;

    document.getElementById("operatingHours").textContent =
        formatTimeRange(
            branch.openingTime,
            branch.closingTime
        );

    document.getElementById("scheduledCount").textContent =
        schedules.filter(function(item){
            return item.status !== "Cancelled";
        }).length;

    document.getElementById("scheduleGridTitle").textContent =
        branch.name;

    document.getElementById("scheduleGridSubtitle").textContent =
        new Date(date + "T00:00:00")
            .toLocaleDateString("en-PH", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
            });

    renderHeader(branch.beds);
    renderBody(branch, date, schedules);
}

/* Pixels-per-minute for the timeline body — only controls how tall the
   grid LOOKS (gridlines are drawn once per hour via CSS background,
   see .timeline-bed-col); every appointment card is still positioned
   from its exact start minute, so placement accuracy is unaffected.
   Same approach as the Dashboard's Branch Schedule (dashboard.js). */
const SCHEDULE_PX_PER_MINUTE = 1.5;
const SCHEDULE_PX_PER_HOUR = SCHEDULE_PX_PER_MINUTE * 60;

function setTimelineGridColumns(numberOfBeds){
    document
        .querySelector(".timeline-grid")
        ?.style.setProperty("--bed-count", numberOfBeds);
}

/* Hour marks to label down the Time column: always the branch's exact
   opening time first (even if not on the hour), then every round hour
   after that up to closing. */
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

function renderHeader(numberOfBeds){
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

    document.getElementById("scheduleHead").innerHTML =
        html;
}

function renderBody(branch, date, schedules){
    const body =
        document.getElementById("scheduleBody");

    body.innerHTML = "";

    setTimelineGridColumns(branch.beds);

    body.style.setProperty(
        "--schedule-hour-height",
        SCHEDULE_PX_PER_HOUR + "px"
    );

    const opening =
        timeToMinutes(branch.openingTime);

    const closing =
        timeToMinutes(branch.closingTime);

    const totalHeight =
        Math.max(0, closing - opening) *
        SCHEDULE_PX_PER_MINUTE;

    const isToday =
        date === getTodayDateString();

    const now = new Date();

    const currentMinutes =
        now.getHours() * 60 +
        now.getMinutes();

    const activeSchedules =
        schedules.filter(function(item){
            return item.status !== "Cancelled";
        });

    const timeCol =
        document.createElement("div");

    timeCol.className = "timeline-time-col";
    timeCol.style.height = totalHeight + "px";

    getHourMarks(opening, closing).forEach(function(minute){
        const label =
            document.createElement("div");

        label.className = "timeline-hour-label";

        label.style.top =
            ((minute - opening) * SCHEDULE_PX_PER_MINUTE) + "px";

        label.textContent =
            formatTime(minutesToTimeValue(minute));

        timeCol.appendChild(label);
    });

    body.appendChild(timeCol);

    for(let bed = 1; bed <= branch.beds; bed++){
        const col =
            document.createElement("div");

        col.className = "timeline-bed-col";
        col.style.height = totalHeight + "px";

        const bedSchedules =
            activeSchedules.filter(function(item){
                return Number(item.bed) === bed;
            });

        /* Clicking empty space starts a new booking at the nearest
           10-min mark (matching the modal's own Start Time picker) —
           appointment cards call stopPropagation() so a click on one
           of them opens Edit instead of falling through to this. */
        col.addEventListener("click", function(event){
            const rect =
                col.getBoundingClientRect();

            const offsetY =
                event.clientY - rect.top;

            const rawMinutes =
                opening + Math.floor(offsetY / SCHEDULE_PX_PER_MINUTE);

            const slotStart =
                Math.floor(rawMinutes / 10) * 10;

            const occupied =
                bedSchedules.some(function(item){
                    return (
                        slotStart >= timeToMinutes(item.startTime) &&
                        slotStart < timeToMinutes(item.endTime)
                    );
                });

            if(occupied){
                return;
            }

            openNewModal(bed, minutesToTimeValue(slotStart));
        });

        bedSchedules.forEach(function(appointment){
            const appointmentStart =
                timeToMinutes(appointment.startTime);

            const appointmentEnd =
                timeToMinutes(appointment.endTime);

            const clampedStart =
                Math.max(appointmentStart, opening);

            const clampedEnd =
                Math.min(appointmentEnd, closing);

            if(clampedEnd <= clampedStart){
                return;
            }

            const button =
                document.createElement("button");

            button.type = "button";
            button.className =
                "appointment-card" +
                (appointment.isCompanionEntry ? " companion-entry-card" : "");

            button.style.top =
                ((clampedStart - opening) * SCHEDULE_PX_PER_MINUTE) + "px";

            button.style.height =
                ((clampedEnd - clampedStart) * SCHEDULE_PX_PER_MINUTE) + "px";

            button.title =
                `${appointment.client || "Scheduled Client"} — ${appointment.service || "Service"}` +
                (appointment.therapist ? ` with ${appointment.therapist}` : "") +
                (
                    appointment.isCompanionEntry && appointment.companionOfName
                        ? ` (Companion of ${appointment.companionOfName})`
                        : ""
                ) +
                ` (${formatTimeRange(appointment.startTime, appointment.endTime)})`;

            button.innerHTML = `
                <strong>
                    ${escapeHtml(appointment.client || "Scheduled Client")}
                </strong>

                ${
                    appointment.isCompanionEntry
                        ? '<small class="companion-tag">(Companion)</small>'
                        : ""
                }

                <span>
                    ${escapeHtml(appointment.service || "Service")}${
                        appointment.therapist
                            ? " · " + escapeHtml(appointment.therapist)
                            : ""
                    }
                </span>

                <small>
                    ${formatTimeRange(
                        appointment.startTime,
                        appointment.endTime
                    )}
                </small>
            `;

            button.addEventListener("click", function(event){
                event.stopPropagation();
                openEditModal(appointment.id);
            });

            col.appendChild(button);
        });

        body.appendChild(col);
    }

    if(
        isToday &&
        currentMinutes >= opening &&
        currentMinutes < closing
    ){
        const line =
            document.createElement("div");

        line.className = "timeline-current-line";

        line.style.top =
            ((currentMinutes - opening) * SCHEDULE_PX_PER_MINUTE) + "px";

        body.appendChild(line);
    }
}

/* Upcoming / History tables — a cross-date view (scoped to the currently
   selected branch) built on top of the same per-branch/per-date
   localStorage schedules the grid above reads (getSchedules/
   SCHEDULE_PREFIX). There is no separate "upcoming" or "history" store:
   every crownSchedule_<selectedBranch>_<date> key is scanned, grouped
   back into (main appointment + its companions), and split by whether
   the appointment's end time has already passed (or its status is a
   final one) at render time. */

function parseScheduleStorageKey(key){
    if(!key.startsWith(SCHEDULE_PREFIX)){
        return null;
    }

    const suffix =
        key.slice(SCHEDULE_PREFIX.length);

    const date =
        suffix.slice(-10);

    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
        return null;
    }

    const branchName =
        suffix.slice(0, suffix.length - 11);

    if(!branchName){
        return null;
    }

    return { branchName, date };
}

function getAllScheduleGroups(){
    const selectedBranch =
        getSelectedBranch();

    if(!selectedBranch){
        return [];
    }

    const groups = [];

    Object.keys(localStorage).forEach(function(key){
        const parsedKey =
            parseScheduleStorageKey(key);

        if(!parsedKey || parsedKey.branchName !== selectedBranch){
            return;
        }

        let entries;

        try{
            const saved =
                localStorage.getItem(key);

            const parsed =
                saved ? JSON.parse(saved) : [];

            entries = Array.isArray(parsed) ? parsed : [];
        }catch(error){
            console.error("Unable to load schedules for " + key + ":", error);
            return;
        }

        entries
            .filter(function(item){
                return !item.isCompanionEntry;
            })
            .forEach(function(main){
                const companions =
                    entries.filter(function(item){
                        return (
                            item.isCompanionEntry &&
                            item.companionOf === main.id
                        );
                    });

                groups.push({
                    branch: parsedKey.branchName,
                    date: parsedKey.date,
                    main: main,
                    companions: companions
                });
            });
    });

    return groups;
}

function getClientMobile(clientName){
    const client =
        getClients().find(function(item){
            return (
                String(item.name || "").toLowerCase() ===
                String(clientName || "").toLowerCase()
            );
        });

    return client ? (client.mobile || "") : "";
}

/* Fallback for appointments converted from a booking request before the
   client's mobile was back-filled onto crownClientMasterList (see
   ensureClientExists) — those still carry it as plain text in Notes
   ("Contact: 0917xxxxxxx / email@example.com", written by
   openNewModalFromBookingRequest). */
function getContactFromNotes(notes){
    const match =
        String(notes || "").match(/^Contact:\s*([^\n]+)/);

    return match ? match[1].split(" / ")[0].trim() : "";
}

function statusPillClass(status){
    return (
        "schedule-status-" +
        String(status || "")
            .toLowerCase()
            .replace(/\s+/g, "-")
    );
}

function buildScheduleRowHtml(group){
    const dateLabel =
        new Date(group.date + "T00:00:00")
            .toLocaleDateString("en-PH", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });

    const companionNames =
        group.companions.map(function(companion){
            return companion.client;
        });

    const clientCell =
        companionNames.length > 0
            ? `
                ${escapeHtml(group.main.client)}
                <span class="badge bg-secondary">Party of ${companionNames.length + 1}</span>
                <small class="companion-line">+ ${escapeHtml(companionNames.join(", "))}</small>
            `
            : escapeHtml(group.main.client);

    const mobile =
        getClientMobile(group.main.client) ||
        getContactFromNotes(group.main.notes);

    return `
        <tr>
            <td>${escapeHtml(dateLabel)}</td>
            <td>${clientCell}</td>
            <td>${escapeHtml(group.main.service || "—")}</td>
            <td>${escapeHtml(group.branch)}</td>
            <td>${formatTimeRange(group.main.startTime, group.main.endTime)}</td>
            <td>${escapeHtml(mobile || "—")}</td>
            <td>${escapeHtml(group.main.notes || "—")}</td>
            <td>
                <span class="schedule-status-pill ${statusPillClass(group.main.status)}">
                    ${escapeHtml(group.main.status || "—")}
                </span>
            </td>
        </tr>
    `;
}

function getScheduleSortKey(group){
    return group.date + "T" + (group.main.startTime || "00:00");
}

function renderUpcomingAndHistory(){
    const groups =
        getAllScheduleGroups();

    const todayStr =
        getTodayDateString();

    const now =
        new Date();

    const currentMinutes =
        now.getHours() * 60 +
        now.getMinutes();

    const upcoming = [];
    const history = [];

    groups.forEach(function(group){
        const isFinalStatus =
            group.main.status === "Completed" ||
            group.main.status === "Cancelled";

        const isPast =
            group.date < todayStr ||
            (
                group.date === todayStr &&
                timeToMinutes(group.main.endTime) <= currentMinutes
            );

        if(isFinalStatus || isPast){
            history.push(group);
        }else{
            upcoming.push(group);
        }
    });

    upcoming.sort(function(a, b){
        return getScheduleSortKey(a).localeCompare(getScheduleSortKey(b));
    });

    history.sort(function(a, b){
        return getScheduleSortKey(b).localeCompare(getScheduleSortKey(a));
    });

    const upcomingBody =
        document.getElementById("upcomingScheduleBody");

    upcomingBody.innerHTML =
        upcoming.map(buildScheduleRowHtml).join("");

    document
        .getElementById("upcomingScheduleEmptyState")
        .classList.toggle("d-none", upcoming.length > 0);

    const historyBody =
        document.getElementById("historyScheduleBody");

    historyBody.innerHTML =
        history.map(buildScheduleRowHtml).join("");

    document
        .getElementById("historyScheduleEmptyState")
        .classList.toggle("d-none", history.length > 0);
}

function openScheduleHistoryModal(){
    renderUpcomingAndHistory();

    document
        .getElementById("scheduleHistoryModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeScheduleHistoryModal(){
    document
        .getElementById("scheduleHistoryModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");
}

function openNewModal(bed, startTime){
    const branch =
        getSelectedBranch();

    const date =
        document.getElementById("scheduleDate").value;

    const blockedEntry =
        branch && date
            ? findBlockedEntry(branch.name, date)
            : null;

    if(blockedEntry){
        alert(
            "This date is blocked for scheduling" +
            (blockedEntry.reason ? ` (${blockedEntry.reason})` : "") +
            ". Unblock it from the Blocked Dates list below if you need to add an appointment."
        );
        return;
    }

    selectedScheduleId = null;
    selectedBed = bed;
    selectedStartTime = startTime;
    selectedScheduleOriginalDate = null;

    resetModalFields();
    loadTherapistOptions();

    document.getElementById("modalDate").value = date;

    document.getElementById("modalModeLabel").textContent =
        "New Schedule";

    document.getElementById("modalTitle").textContent =
        "Add Appointment";

    document.getElementById("deleteScheduleBtn")
        .classList.add("d-none");

    document.getElementById("saveModalBtn").textContent =
        "Save Schedule";

    document.getElementById("modalBed").innerHTML =
        buildBedOptionsHtml(getSelectedBranch(), bed);

    document.getElementById("modalStartTime").value =
        startTime;

    updateSelectedSlotLabel();
    updateModalPreview();
    showModal();
}

/* "10:00 AM" / "2:00 PM" (the display format book.html's time <select>
   uses) -> "14:00" (the 24-hour value modalStartTime/timeToMinutes expect). */
function parseDisplayTimeToValue(display){
    const match =
        String(display || "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

    if(!match){
        return "";
    }

    let hour = Number(match[1]) % 12;

    if(match[3].toUpperCase() === "PM"){
        hour += 12;
    }

    return (
        String(hour).padStart(2, "0") +
        ":" +
        match[2]
    );
}

async function openNewModalFromBookingRequest(requestId){
    if(!window.firebase || firebase.apps.length === 0){
        alert("Cloud sync is unavailable right now, so this booking request can't be loaded.");
        return;
    }

    /* Branch/service master data (getBranches()/getServices(), read from
       localStorage) may not have finished its initial cloud pull yet on a
       fresh page load — wait for it so the branch-match check below sees
       the real list, not an empty one. */
    await window.CrownCloud?.waitForInitialSync?.(12000);

    let request;

    try{
        const doc =
            await firebase.firestore()
                .collection("bookingRequests")
                .doc(requestId)
                .get();

        if(!doc.exists){
            alert("This booking request no longer exists.");
            return;
        }

        request = doc.data();
    }catch(error){
        console.error("Unable to load booking request:", error);
        alert("Could not load this booking request. Please try again.");
        return;
    }

    if(request.status !== "pending"){
        alert("This booking request has already been " + request.status + ".");
        return;
    }

    const matchedBranch =
        getBranches().find(function(branch){
            return branch.name === request.branch;
        });

    if(!matchedBranch){
        alert(
            "This request's branch (\"" + request.branch + "\") isn't set up " +
            "in this system, so it can't be opened automatically.\n\n" +
            "Please book it manually using these details:\n" +
            "Client: " + request.clientName + "\n" +
            "Service: " + request.serviceName + "\n" +
            "Date/Time: " + request.date + " " + request.time + "\n" +
            "Contact: " + request.mobile
        );
        return;
    }

    document.getElementById("scheduleBranch").value = request.branch;
    localStorage.setItem(SELECTED_BRANCH_KEY, request.branch);
    document.getElementById("scheduleDate").value = request.date;

    /* The global sidebar toolbar (sidebar.js) independently re-pushes ITS
       OWN stored branch/date onto #scheduleBranch/#scheduleDate a moment
       after page load (once, at startup, and again after the cloud sync
       promise resolves) — without this, that deferred sync would silently
       revert the branch/date set above back to whatever was previously
       selected, right after this function opens the modal. */
    const toolbarBranch = document.getElementById("sidebarDashboardBranch");
    if(toolbarBranch){
        toolbarBranch.value = request.branch;
    }

    const toolbarDate = document.getElementById("sidebarDashboardDate");
    if(toolbarDate){
        toolbarDate.value = request.date;
    }

    localStorage.setItem("crownGlobalDate", request.date);

    renderSchedule();

    openNewModal(null, parseDisplayTimeToValue(request.time));

    document.getElementById("modalClient").value = request.clientName || "";
    resetModalServices(request.serviceName ? [request.serviceName] : []);

    const contactLines = [request.mobile, request.email]
        .filter(Boolean)
        .join(" / ");

    const companions = Array.isArray(request.companions) ? request.companions : [];

    document.getElementById("modalNotes").value =
        [
            contactLines ? "Contact: " + contactLines : "",
            request.notes || ""
        ].filter(Boolean).join("\n");

    /* Pre-fill a companion row per {name, serviceName} pair the guest
       entered on the public booking form. Therapist and bed are still
       left for staff to assign, same as if they'd clicked "+ Add
       Companion" and filled it in manually. saveSchedule() already
       requires those fields before the appointment can be saved, so
       nothing incomplete slips through. */
    companions.forEach(function(requestCompanion){
        const companion = {
            id: createId(),
            name: requestCompanion.name,
            therapist: "",
            bed: "",
            startTime: selectedStartTime || "",
            services: [{ id: createId(), name: requestCompanion.serviceName || "" }]
        };
        recommendCompanionSlot(companion);
        modalCompanions.push(companion);
    });

    if(companions.length > 0){
        renderCompanions();
    }

    updateSelectedSlotLabel();
    updateModalPreview();

    pendingRequestId = requestId;
    pendingRequestContact = {
        mobile: request.mobile || "",
        email: request.email || ""
    };

    /* Drop the query param so refreshing the page doesn't reopen the
       same prefilled modal. */
    history.replaceState(null, "", location.pathname);
}

async function markBookingRequestConverted(requestId, scheduleId){
    try{
        await firebase.firestore()
            .collection("bookingRequests")
            .doc(requestId)
            .update({
                status: "converted",
                reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                reviewedBy: window.CrownAuth?.getCurrentUser?.()?.account || "",
                convertedScheduleId: scheduleId
            });
    }catch(error){
        console.error("Unable to mark booking request as converted:", error);
    }
}

function openEditModal(scheduleId){
    const branch =
        getSelectedBranch();

    const date =
        document.getElementById("scheduleDate").value;

    const allSchedules =
        getSchedules(branch.name, date);

    const item =
        allSchedules.find(function(schedule){
            return schedule.id === scheduleId;
        });

    if(!item){
        return;
    }

    selectedScheduleId = item.id;
    selectedBed = Number(item.bed);
    selectedStartTime = item.startTime;
    selectedScheduleOriginalDate = date;

    document.getElementById("modalDate").value = date;

    document.getElementById("modalModeLabel").textContent =
        "Edit Schedule";

    document.getElementById("modalTitle").textContent =
        "Edit Appointment";

    document.getElementById("modalClient").value =
        item.client || "";

    const savedServiceNames =
        Array.isArray(item.services) && item.services.length > 0
            ? item.services
            : (item.service ? [item.service] : []);

    resetModalServices(savedServiceNames);

    const linkedCompanions =
        allSchedules.filter(function(schedule){
            return schedule.companionOf === item.id;
        });

    resetModalCompanions(linkedCompanions);

    loadTherapistOptions();

    document.getElementById("modalTherapist").value =
        item.therapist || "";

    document.getElementById("modalStatus").value =
        item.status || "Confirmed";

    document.getElementById("modalNotes").value =
        item.notes || "";

    document.getElementById("modalBed").innerHTML =
        buildBedOptionsHtml(branch, Number(item.bed));

    document.getElementById("modalStartTime").value =
        item.startTime || "";

    document.getElementById("deleteScheduleBtn")
        .classList.remove("d-none");

    document.getElementById("saveModalBtn").textContent =
        "Update Schedule";

    updateSelectedSlotLabel();
    updateModalPreview();
    showModal();
}

function updateSelectedSlotLabel(){
    const branch =
        getSelectedBranch();

    const date =
        getModalDate();

    document.getElementById("selectedSlotLabel").textContent =
        `${branch.name} • ${
            new Date(date + "T00:00:00")
                .toLocaleDateString("en-PH", {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                })
        }`;
}

function resetModalFields(){
    document.getElementById("modalClient").value = "";
    document.getElementById("modalTherapist").value = "";
    document.getElementById("modalStatus").value = "Confirmed";
    document.getElementById("modalNotes").value = "";

    modalCompanions = [];
    document.getElementById("modalCompanionsList").innerHTML = "";

    resetModalServices();

    document.getElementById("modalDuration").textContent = "—";
    document.getElementById("modalEndTime").textContent = "—";

    hideModalMessage();
}

function updateModalPreview(){
    const selectedServices =
        getSelectedServiceObjects();

    const branch =
        getSelectedBranch();

    if(selectedServices.length === 0){
        document.getElementById("modalDuration").textContent =
            "—";

        document.getElementById("modalEndTime").textContent =
            "—";

        hideModalMessage();
        updateAllCompanionPreviews();
        return;
    }

    const hasMissingDuration =
        selectedServices.some(function(service){
            return !service.duration || service.duration <= 0;
        });

    if(hasMissingDuration){
        document.getElementById("modalDuration").textContent =
            "Not Set";

        document.getElementById("modalEndTime").textContent =
            "—";

        showModalMessage(
            "warning",
            "One or more selected services has no duration. Please update it in List of Services."
        );

        updateAllCompanionPreviews();
        return;
    }

    const totalDuration =
        selectedServices.reduce(function(sum, service){
            return sum + service.duration;
        }, 0);

    const endTime =
        minutesToTimeValue(
            timeToMinutes(selectedStartTime) +
            totalDuration
        );

    document.getElementById("modalDuration").textContent =
        `${totalDuration} Minutes`;

    document.getElementById("modalEndTime").textContent =
        formatTime(endTime);

    const isOvertime =
        timeToMinutes(endTime) >
        timeToMinutes(branch.closingTime);

    const mainPool =
        getConflictPool("main");

    const bedConflict =
        poolHasConflict(
            selectedBed,
            selectedStartTime,
            endTime,
            mainPool
        );

    if(bedConflict){
        showModalMessage(
            "danger",
            "This bed is not available for the full duration of the selected service."
        );

        updateAllCompanionPreviews();
        return;
    }

    const therapistName =
        document.getElementById("modalTherapist").value;

    const therapistConflict =
        poolHasTherapistConflict(
            therapistName,
            selectedStartTime,
            endTime,
            mainPool
        );

    if(therapistConflict){
        showModalMessage(
            "danger",
            `${therapistName} is already assigned to another appointment during this time.`
        );

        updateAllCompanionPreviews();
        return;
    }

    if(isOvertime){
        showModalMessage(
            "warning",
            `Bed ${selectedBed} is available until ${formatTime(endTime)} — this goes past closing time (${formatTime(branch.closingTime)}) and will be booked as overtime.`
        );

        updateAllCompanionPreviews();
        return;
    }

    showModalMessage(
        "success",
        `Bed ${selectedBed} is available until ${formatTime(endTime)}.`
    );

    updateAllCompanionPreviews();
}

function saveSchedule(){
    const branch =
        getSelectedBranch();

    const date =
        getModalDate();

    if(!date){
        alert("Please pick a date for this appointment.");
        return;
    }

    const client =
        document.getElementById("modalClient").value.trim();

    const services =
        getSelectedServiceObjects();

    const therapist =
        document.getElementById("modalTherapist").value;

    const status =
        document.getElementById("modalStatus").value;

    const notes =
        document.getElementById("modalNotes").value.trim();

    if(!selectedScheduleId && branch && date && findBlockedEntry(branch.name, date)){
        alert("This date is blocked for scheduling. Unblock it from the Blocked Dates list below if you need to add an appointment.");
        return;
    }

    if(!client){
        alert("Please enter or select a client.");
        return;
    }

    if(services.length === 0){
        alert("Please select at least one service.");
        return;
    }

    const hasMissingDuration =
        services.some(function(service){
            return !service.duration || service.duration <= 0;
        });

    if(hasMissingDuration){
        alert("One or more selected services has no valid duration.");
        return;
    }

    const totalDuration =
        services.reduce(function(sum, service){
            return sum + service.duration;
        }, 0);

    const endTime =
        minutesToTimeValue(
            timeToMinutes(selectedStartTime) +
            totalDuration
        );

    const activeCompanions =
        modalCompanions.filter(function(companion){
            return companion.name.trim();
        });

    const companionPayloads = [];

    for(let i = 0; i < activeCompanions.length; i++){
        const companion = activeCompanions[i];
        const companionName = companion.name.trim();

        const companionServices =
            getCompanionSelectedServices(companion);

        if(companionServices.length === 0){
            alert(`Please select at least one service for companion "${companionName}".`);
            return;
        }

        const companionHasMissingDuration =
            companionServices.some(function(service){
                return !service.duration || service.duration <= 0;
            });

        if(companionHasMissingDuration){
            alert(`One or more services selected for companion "${companionName}" has no valid duration.`);
            return;
        }

        if(!companion.bed){
            alert(`Please select a bed for companion "${companionName}".`);
            return;
        }

        if(!companion.startTime){
            alert(`Please select a start time for companion "${companionName}".`);
            return;
        }

        const companionTotalDuration =
            companionServices.reduce(function(sum, service){
                return sum + service.duration;
            }, 0);

        const companionEndTime =
            minutesToTimeValue(
                timeToMinutes(companion.startTime) +
                companionTotalDuration
            );

        companionPayloads.push({
            name: companionName,
            services: companionServices,
            therapist: companion.therapist,
            bed: Number(companion.bed),
            startTime: companion.startTime,
            endTime: companionEndTime,
            duration: companionTotalDuration
        });
    }

    if(status !== "Cancelled"){
        const mainPool =
            getConflictPool("main");

        if(poolHasConflict(selectedBed, selectedStartTime, endTime, mainPool)){
            alert("The selected bed is already occupied during part of this service.");
            return;
        }

        if(poolHasTherapistConflict(therapist, selectedStartTime, endTime, mainPool)){
            alert(`${therapist} is already assigned to another appointment during this time.`);
            return;
        }

        const overlappingHolds =
            countActiveHoldsOverlapping(selectedStartTime, endTime, pendingRequestId);

        const projectedOccupancy =
            mainPool.filter(function(item){
                return hasOverlap(selectedStartTime, endTime, item.startTime, item.endTime);
            }).length +
            overlappingHolds +
            1;

        if(projectedOccupancy > branch.beds){
            alert(
                `${branch.name} only has ${branch.beds} bed(s) — ${overlappingHolds} pending ` +
                `web booking request(s) are temporarily holding a slot during this time, so this ` +
                `appointment would exceed capacity. Confirm or decline the pending request(s) first, ` +
                `or choose a different time.`
            );
            return;
        }

        for(let i = 0; i < activeCompanions.length; i++){
            const companion = activeCompanions[i];
            const payload = companionPayloads[i];
            const companionPool = getConflictPool(companion.id);

            if(poolHasConflict(payload.bed, payload.startTime, payload.endTime, companionPool)){
                alert(`Bed ${payload.bed} is not available for companion "${payload.name}" during the selected time.`);
                return;
            }

            if(poolHasTherapistConflict(payload.therapist, payload.startTime, payload.endTime, companionPool)){
                alert(`${payload.therapist} is already assigned to another appointment during this time (companion "${payload.name}").`);
                return;
            }
        }
    }

    const mainId =
        selectedScheduleId || createId();

    const scheduleData = {
        id: mainId,
        client: client,
        services: services.map(function(service){
            return service.name;
        }),
        service: services.map(function(service){
            return service.name;
        }).join(", "),
        therapist: therapist,
        bed: selectedBed,
        startTime: selectedStartTime,
        endTime: endTime,
        duration: totalDuration,
        status: status,
        notes: notes,
        updatedAt: new Date().toISOString()
    };

    const companionEntries =
        companionPayloads.map(function(payload){
            return {
                id: createId(),
                client: payload.name,
                services: payload.services.map(function(service){
                    return service.name;
                }),
                service: payload.services.map(function(service){
                    return service.name;
                }).join(", "),
                therapist: payload.therapist,
                bed: payload.bed,
                startTime: payload.startTime,
                endTime: payload.endTime,
                duration: payload.duration,
                status: status,
                notes: "",
                isCompanionEntry: true,
                companionOf: mainId,
                companionOfName: client,
                updatedAt: new Date().toISOString()
            };
        });

    let schedules =
        getSchedules(branch.name, date);

    const previousMainEntry =
        schedules.find(function(item){
            return item.id === mainId;
        });

    const previousCompanionEntries =
        schedules.filter(function(item){
            return item.companionOf === mainId;
        });

    schedules =
        schedules.filter(function(item){
            return (
                item.id !== mainId &&
                item.companionOf !== mainId
            );
        });

    schedules.push(scheduleData);

    companionEntries.forEach(function(entry){
        schedules.push(entry);
    });

    schedules.sort(function(a, b){
        return (
            timeToMinutes(a.startTime) -
            timeToMinutes(b.startTime)
        );
    });

    saveSchedules(
        branch.name,
        date,
        schedules
    );

    /* Rescheduled to a different day via the modal's Date field — the
       block above only touched the NEW date's bucket, so the entry (and
       any companions) still needs to be removed from wherever it used to
       live or it would show up on both days. */
    if(selectedScheduleOriginalDate && selectedScheduleOriginalDate !== date){
        const oldDateSchedules =
            getSchedules(branch.name, selectedScheduleOriginalDate)
                .filter(function(item){
                    return (
                        item.id !== mainId &&
                        item.companionOf !== mainId
                    );
                });

        saveSchedules(
            branch.name,
            selectedScheduleOriginalDate,
            oldDateSchedules
        );
    }

    ensureClientExists(
        client,
        branch.name,
        pendingRequestContact?.mobile || ""
    );

    companionPayloads.forEach(function(payload){
        ensureClientExists(payload.name, branch.name);
    });

    notifyScheduleAssignments({
        branch: branch.name,
        date: date,
        client: client,
        status: status,
        mainEntry: scheduleData,
        previousMainEntry: previousMainEntry,
        companionEntries: companionEntries,
        previousCompanionEntries: previousCompanionEntries
    });

    const convertedFromRequestId = pendingRequestId;

    closeModal();
    renderSchedule();
    renderUpcomingAndHistory();

    if(convertedFromRequestId){
        markBookingRequestConverted(convertedFromRequestId, mainId);
    }
}

/* Notifies a therapist only when their assignment actually changed
   (new booking, or a different therapist/time/status) — not on every
   edit, so re-saving unrelated fields (e.g. notes) doesn't spam them. */
function notifyScheduleAssignments(options){
    if(!window.CrownNotifications || options.status === "Cancelled"){
        return;
    }

    function hasChanged(previous, next){
        if(!previous){
            return true;
        }

        return (
            previous.therapist !== next.therapist ||
            previous.startTime !== next.startTime ||
            previous.endTime !== next.endTime ||
            previous.status !== next.status
        );
    }

    if(hasChanged(options.previousMainEntry, options.mainEntry)){
        CrownNotifications.add({
            therapistName: options.mainEntry.therapist,
            branch: options.branch,
            date: options.date,
            scheduleId: options.mainEntry.id,
            message:
                `New schedule: ${options.client} at ` +
                `${formatTime(options.mainEntry.startTime)}–` +
                `${formatTime(options.mainEntry.endTime)} ` +
                `(Bed ${options.mainEntry.bed}).`
        });
    }

    options.companionEntries.forEach(function(entry){
        const previous =
            options.previousCompanionEntries.find(function(item){
                return item.client === entry.client;
            });

        if(hasChanged(previous, entry)){
            CrownNotifications.add({
                therapistName: entry.therapist,
                branch: options.branch,
                date: options.date,
                scheduleId: entry.id,
                message:
                    `New schedule: ${entry.client} (companion of ` +
                    `${options.client}) at ${formatTime(entry.startTime)}–` +
                    `${formatTime(entry.endTime)} (Bed ${entry.bed}).`
            });
        }
    });
}

function ensureClientExists(clientName, branchName, mobile){
    const clients =
        getClients();

    const existing =
        clients.find(function(client){
            return (
                String(client.name || "").toLowerCase() ===
                clientName.toLowerCase()
            );
        });

    if(existing){
        /* Back-fills a blank mobile (e.g. a client first created without
           one) rather than overwriting a number staff already entered on
           the Clients page. */
        if(mobile && !existing.mobile){
            existing.mobile = mobile;

            localStorage.setItem(
                CLIENT_MASTER_KEY,
                JSON.stringify(clients)
            );
        }

        return;
    }

    clients.push({
        id: createId(),
        name: clientName,
        mobile: mobile || "",
        birthday: "",
        branch: branchName,
        vip: "No",
        notes: "",
        totalVisits: 0,
        lastVisit: "",
        totalSpent: 0,
        createdAt: new Date().toISOString()
    });

    localStorage.setItem(
        CLIENT_MASTER_KEY,
        JSON.stringify(clients)
    );

    loadClientOptions();
}

function deleteSelectedSchedule(){
    if(!selectedScheduleId){
        return;
    }

    const branch =
        getSelectedBranch();

    const date =
        document.getElementById("scheduleDate").value;

    let schedules =
        getSchedules(branch.name, date);

    const item =
        schedules.find(function(schedule){
            return schedule.id === selectedScheduleId;
        });

    if(!item){
        return;
    }

    const linkedCompanionsCount =
        schedules.filter(function(schedule){
            return schedule.companionOf === selectedScheduleId;
        }).length;

    const confirmMessage =
        linkedCompanionsCount > 0
            ? `Delete the schedule of "${item.client}" and its ${linkedCompanionsCount} companion booking(s)?`
            : `Delete the schedule of "${item.client}"?`;

    if(!confirm(confirmMessage)){
        return;
    }

    schedules =
        schedules.filter(function(schedule){
            return (
                schedule.id !== selectedScheduleId &&
                schedule.companionOf !== selectedScheduleId
            );
        });

    saveSchedules(
        branch.name,
        date,
        schedules
    );

    closeModal();
    renderSchedule();
    renderUpcomingAndHistory();
}

function showModal(){
    document.getElementById("scheduleModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");

    setTimeout(function(){
        document.getElementById("modalClient").focus();
    }, 50);
}

function closeModal(){
    document.getElementById("scheduleModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    selectedScheduleId = null;
    selectedBed = null;
    selectedStartTime = "";
    pendingRequestId = null;
    pendingRequestContact = null;

    resetModalFields();
}

function showModalMessage(type, text){
    const message =
        document.getElementById("modalMessage");

    message.className =
        `modal-message modal-message-${type}`;

    message.textContent = text;
}

function hideModalMessage(){
    const message =
        document.getElementById("modalMessage");

    message.className =
        "modal-message d-none";

    message.textContent = "";
}
