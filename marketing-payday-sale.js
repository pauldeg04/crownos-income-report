/* ==========================================================================
   Crown Head Spa — Marketing / Payday Sale

   Data model (Firestore):
     paydaySale/{branchSlug_date}
       branch, date ("YYYY-MM-DD"),
       blocked, blockReason, blockedBy, blockedAt,
       beds: { "<bedNumber>": { available, from ("HH:MM"), to ("HH:MM") } },
       slots: [{
         id, client, mobile, email, services: [name,...], service,
         therapist, bed, startTime, endTime, duration, status, notes,
         isCompanionEntry, companionOf, companionOfName,
         createdBy, createdAt / updatedAt
       }],
       updatedBy, updatedAt

   One doc per branch per day — mirrors how scheduling.js keeps one
   crownSchedule_<branch>_<date> bucket per branch/day, just as a native
   Firestore doc (Pattern B — direct collection, like the other
   marketing-* pages) instead of the appData localStorage mirror. The
   slot form intentionally mirrors scheduling.js's Add/Edit Appointment
   modal (client, contact info, services, therapist, bed, time,
   status, companions, notes) field-for-field, but this page is NOT
   wired to scheduling.js/crownSchedule_* for writing — it's a separate,
   marketing-controlled availability set meant to be read later by the
   public website. Deliberately dropped from the ported modal:
   booking-hold/capacity checks, the send-SMS/email-confirmation popup,
   and Client Database sync — none of those apply to a sale slot that
   isn't a real appointment yet.

   One read-only exception: the grid also reads (never writes)
   scheduling.js's own crownSchedule_<branch>_<date> localStorage bucket,
   so beds already booked on the real Scheduling page show as occupied
   here too — no click-to-add on that time, and saving a Payday Sale
   slot is blocked from overlapping one. Rendered as a plain "Scheduled"
   block with no client details and no click handler — see
   renderActualScheduleBlocks() — since marketing only needs to know the
   bed is taken, not view or edit the real appointment.
   ========================================================================== */

(function(){
    const COLLECTION = "paydaySale";
    const BRANCH_MASTER_KEY = "crownBranchMasterList";
    const SERVICE_MASTER_KEY = "crownServiceMasterList";
    const THERAPIST_MASTER_KEY = "crownTherapistMasterList";
    const SELECTED_BRANCH_KEY = "crownSelectedBranch";
    const SCHEDULE_PREFIX = "crownSchedule_";
    const SCHEDULE_PX_PER_MINUTE = 1.5;
    const SCHEDULE_PX_PER_HOUR = SCHEDULE_PX_PER_MINUTE * 60;

    const WILL_CHOOSE_SERVICE_NAME = "Will choose upon arrival";
    const WILL_CHOOSE_SERVICE_DURATION = 60;

    let currentDoc = null;
    let cachedClients = [];

    let selectedBed = null;
    let selectedStartTime = "";
    let selectedSlotId = null;
    let modalServiceRows = [];
    let modalCompanions = [];

    document.addEventListener("DOMContentLoaded", async function(){
        initializeDate();
        loadBranchOptions();
        await loadClientOptions();
        attachEvents();
        renderPaydaySale();
        startBookingRequestsListener();

        /* firebase-sync.js's realtime listener writes an incoming remote
           change straight into localStorage and fires this event — a real
           appointment created/edited on the Scheduling page elsewhere
           should re-occupy this grid without waiting for a manual
           reload. Same pattern as scheduling.js's own listener. */
        window.addEventListener("crownCloudUpdate", function(event){
            const keys = event.detail?.keys || [];

            if(keys.some(function(key){ return key.startsWith(SCHEDULE_PREFIX); })){
                if(currentDoc){
                    renderBody(getSelectedBranch());
                }
            }
        });
    });

    function attachEvents(){
        document.getElementById("scheduleBranch")
            .addEventListener("change", function(){
                if(this.value){
                    localStorage.setItem(SELECTED_BRANCH_KEY, this.value);
                }else{
                    localStorage.removeItem(SELECTED_BRANCH_KEY);
                }

                renderPaydaySale();
                renderBookingRequests();
            });

        document.getElementById("scheduleDate")
            .addEventListener("change", renderPaydaySale);

        document.getElementById("prevDayBtn")
            .addEventListener("click", function(){ stepDate(-1); });

        document.getElementById("nextDayBtn")
            .addEventListener("click", function(){ stepDate(1); });

        /* Delegated: renderHeader() rebuilds #paydayHead's innerHTML on
           every render, which would otherwise drop per-checkbox/per-input
           listeners attached directly. */
        document.getElementById("paydayHead")
            .addEventListener("change", function(event){
                const availToggle = event.target.closest("[data-bed-available]");
                if(availToggle){
                    toggleBedAvailability(Number(availToggle.dataset.bedAvailable), availToggle);
                    return;
                }

                const timeInput = event.target.closest("[data-bed-from], [data-bed-to]");
                if(timeInput){
                    updateBedAvailabilityTime(timeInput);
                }
            });

        document.getElementById("blockDateCheckbox")
            .addEventListener("change", toggleBlockDate);

        document.getElementById("blockDateReasonInput")
            .addEventListener("change", updateBlockDateReason);

        document.getElementById("paydayAddServiceBtn")
            .addEventListener("click", addServiceRow);

        document.getElementById("paydayModalClient")
            .addEventListener("input", updateCompanionOfHints);

        document.getElementById("paydayAddCompanionBtn")
            .addEventListener("click", addCompanionRow);

        document.getElementById("paydayModalTherapist")
            .addEventListener("change", updateModalPreview);

        document.getElementById("paydayModalBed")
            .addEventListener("change", function(){
                selectedBed = Number(this.value) || null;
                updateModalPreview();
            });

        document.getElementById("paydayModalStartTime")
            .addEventListener("change", function(){
                selectedStartTime = this.value;
                updateModalPreview();
            });

        document.getElementById("closePaydayModalBtn").addEventListener("click", closeModal);
        document.getElementById("cancelPaydayModalBtn").addEventListener("click", closeModal);
        document.getElementById("savePaydayModalBtn").addEventListener("click", saveSlot);
        document.getElementById("deletePaydaySlotBtn").addEventListener("click", deleteSlot);
        document.getElementById("addToScheduleBtn").addEventListener("click", addToSchedule);

        document.getElementById("paydayModalBackdrop")
            .addEventListener("click", function(event){
                if(event.target === this){ closeModal(); }
            });

        document.addEventListener("keydown", function(event){
            if(event.key === "Escape"){ closeModal(); }
        });
    }

    function createId(){
        return Date.now().toString() + Math.random().toString(16).slice(2);
    }

    function escapeHtml(value){
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function db(){
        return firebase.firestore();
    }

    function currentUserAccount(){
        const user =
            typeof CrownAuth !== "undefined" && CrownAuth.getCurrentUser
                ? CrownAuth.getCurrentUser()
                : null;

        return user ? user.account : "";
    }

    /* ---- Date / branch / master-data helpers (same conventions as scheduling.js) ---- */

    function getTodayDateString(){
        const today = new Date();
        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");
    }

    function initializeDate(){
        document.getElementById("scheduleDate").value = getTodayDateString();
    }

    function stepDate(days){
        const input = document.getElementById("scheduleDate");

        input.value =
            window.CrownDateStepper?.addDays?.(
                input.value || getTodayDateString(),
                days
            ) || input.value;

        renderPaydaySale();
    }

    function getBranches(){
        try{
            const saved = localStorage.getItem(BRANCH_MASTER_KEY);
            const parsed = saved ? JSON.parse(saved) : [];

            if(!Array.isArray(parsed)){
                return [];
            }

            const allBranches = parsed.map(function(branch){
                if(typeof branch === "string"){
                    return { id: createId(), name: branch, beds: 1, openingTime: "10:00", closingTime: "22:00" };
                }

                return {
                    id: branch.id || createId(),
                    name: branch.name || "",
                    beds: Number(branch.beds) || 1,
                    openingTime: branch.openingTime || "10:00",
                    closingTime: branch.closingTime || "22:00"
                };
            });

            const allowedBranches = CrownAuth.getAllowedBranches();

            return allBranches.filter(function(branch){
                return allowedBranches.includes(branch.name);
            });
        }catch(error){
            console.error("Unable to load branches:", error);
            return [];
        }
    }

    function loadBranchOptions(){
        const select = document.getElementById("scheduleBranch");
        const branches = getBranches();
        const saved = localStorage.getItem(SELECTED_BRANCH_KEY) || "";

        select.innerHTML =
            '<option value="">Select Branch</option>' +
            branches.map(function(branch){
                return `<option value="${escapeHtml(branch.name)}">${escapeHtml(branch.name)}</option>`;
            }).join("");

        if(saved && branches.some(function(branch){ return branch.name === saved; })){
            select.value = saved;
        }else if(branches.length === 1){
            select.value = branches[0].name;
            localStorage.setItem(SELECTED_BRANCH_KEY, branches[0].name);
        }
    }

    function getSelectedBranch(){
        const branchName = document.getElementById("scheduleBranch").value;

        return getBranches().find(function(branch){
            return branch.name === branchName;
        }) || null;
    }

    function inferDuration(name){
        const match = String(name || "").match(/(\d+)\s*mins?/i);
        return match ? Number(match[1]) || 0 : 0;
    }

    function getServices(){
        try{
            const saved = localStorage.getItem(SERVICE_MASTER_KEY);
            const parsed = saved ? JSON.parse(saved) : [];

            if(!Array.isArray(parsed)){
                return [];
            }

            return parsed.map(function(service){
                if(typeof service === "string"){
                    return { id: createId(), name: service, duration: inferDuration(service), availableForPayday: false, paydaySalePrice: 0 };
                }

                return {
                    id: service.id || createId(),
                    name: service.name || "",
                    duration: Number(service.duration) || 0,
                    availableForPayday: service.availableForPayday === true,
                    paydaySalePrice: Number(service.paydaySalePrice) || 0
                };
            });
        }catch(error){
            console.error("Unable to load services:", error);
            return [];
        }
    }

    function getTherapists(){
        try{
            const saved = localStorage.getItem(THERAPIST_MASTER_KEY);
            const parsed = saved ? JSON.parse(saved) : [];

            if(!Array.isArray(parsed)){
                return [];
            }

            const branch = getSelectedBranch();
            const branchName = branch ? branch.name : "";

            return parsed
                .map(function(therapist){
                    if(typeof therapist === "string"){
                        return { name: therapist, branches: [], status: "Active" };
                    }

                    return {
                        name: therapist.name || "",
                        branches: Array.isArray(therapist.branches) ? therapist.branches : [],
                        status: therapist.status || "Active"
                    };
                })
                .filter(function(therapist){
                    return (
                        therapist.name &&
                        therapist.status === "Active" &&
                        (therapist.branches.length === 0 || therapist.branches.includes(branchName))
                    );
                })
                .map(function(therapist){ return therapist.name; })
                .sort();
        }catch(error){
            console.error("Unable to load therapists:", error);
            return [];
        }
    }

    async function getClients(){
        try{
            cachedClients = await window.CrownClientStore.getAll();
            return cachedClients;
        }catch(error){
            console.error("Unable to load clients:", error);
            return [];
        }
    }

    async function loadClientOptions(){
        const datalist = document.getElementById("paydayClientOptions");
        datalist.innerHTML = "";

        (await getClients())
            .slice()
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            })
            .forEach(function(client){
                const option = document.createElement("option");
                option.value = client.name || "";
                option.label = [client.mobile, client.branch].filter(Boolean).join(" • ");
                datalist.appendChild(option);
            });
    }

    function timeToMinutes(timeValue){
        const parts = String(timeValue || "00:00").split(":");
        return Number(parts[0]) * 60 + Number(parts[1]);
    }

    function minutesToTimeValue(totalMinutes){
        return (
            String(Math.floor(totalMinutes / 60)).padStart(2, "0") +
            ":" +
            String(totalMinutes % 60).padStart(2, "0")
        );
    }

    function formatTime(timeValue){
        const total = timeToMinutes(timeValue);
        const hour24 = Math.floor(total / 60);
        const minute = total % 60;
        const suffix = hour24 >= 12 ? "PM" : "AM";

        return (hour24 % 12 || 12) + ":" + String(minute).padStart(2, "0") + " " + suffix;
    }

    function formatTimeRange(startTime, endTime){
        return formatTime(startTime) + " – " + formatTime(endTime);
    }

    function hasOverlap(startA, endA, startB, endB){
        return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(endA) > timeToMinutes(startB);
    }

    function docId(branchName, date){
        const slug = String(branchName || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

        return slug + "_" + date;
    }

    /* Read-only mirror of scheduling.js's getSchedules() / getStorageKey()
       — same localStorage key (crownSchedule_<branch>_<date>), never
       written to from this page. Only status !== "Cancelled" entries
       actually occupy a bed. */
    function getActualSchedules(branchName, date){
        try{
            const key = SCHEDULE_PREFIX + branchName + "_" + date;
            const saved = localStorage.getItem(key);
            const parsed = saved ? JSON.parse(saved) : [];

            return (Array.isArray(parsed) ? parsed : []).filter(function(item){
                return item.status !== "Cancelled";
            });
        }catch(error){
            console.error("Unable to load actual schedules:", error);
            return [];
        }
    }

    /* ---- Load / save the current branch+date doc ---- */

    function defaultDoc(branch, date){
        const beds = {};

        for(let bed = 1; bed <= branch.beds; bed++){
            beds[bed] = { available: true, from: branch.openingTime, to: branch.closingTime };
        }

        return {
            branch: branch.name,
            date: date,
            blocked: false,
            blockReason: "",
            blockedBy: "",
            blockedAt: null,
            beds: beds,
            slots: [],
            updatedBy: "",
            updatedAt: null
        };
    }

    function loadCurrentDoc(){
        const branch = getSelectedBranch();
        const date = document.getElementById("scheduleDate").value;

        if(!branch || !date){
            currentDoc = null;
            return Promise.resolve(null);
        }

        return db().collection(COLLECTION).doc(docId(branch.name, date)).get()
            .then(function(snap){
                const base = defaultDoc(branch, date);

                if(!snap.exists){
                    currentDoc = base;
                    return currentDoc;
                }

                const data = snap.data();

                currentDoc = Object.assign({}, base, data, {
                    beds: Object.assign({}, base.beds, data.beds || {}),
                    slots: Array.isArray(data.slots) ? data.slots : []
                });

                return currentDoc;
            })
            .catch(function(error){
                console.error("Unable to load Payday Sale doc:", error);
                currentDoc = defaultDoc(branch, date);
                return currentDoc;
            });
    }

    function saveCurrentDoc(){
        if(!currentDoc){
            return Promise.resolve();
        }

        currentDoc.updatedBy = currentUserAccount();
        currentDoc.updatedAt = new Date().toISOString();

        return db().collection(COLLECTION)
            .doc(docId(currentDoc.branch, currentDoc.date))
            .set(currentDoc)
            .then(function(){ return true; })
            .catch(function(error){
                console.error("Unable to save Payday Sale doc:", error);
                showModalMessage("danger", "Could not save — check your connection and try again.");
                return false;
            });
    }

    /* ---- Main render ---- */

    function renderPaydaySale(){
        const branch = getSelectedBranch();
        const date = document.getElementById("scheduleDate").value;

        const emptyState = document.getElementById("paydayEmptyState");
        const wrapper = document.getElementById("paydayTableWrapper");

        if(!branch || !date){
            emptyState.classList.remove("d-none");
            wrapper.classList.add("d-none");

            document.getElementById("bedCount").textContent = "0";
            document.getElementById("operatingHours").textContent = "—";
            document.getElementById("slotCount").textContent = "0";
            document.getElementById("paydayGridTitle").textContent = "Branch Payday Sale";
            document.getElementById("paydayGridSubtitle").textContent = "Select a branch and date.";

            renderBlockDateControl(null);
            return;
        }

        return loadCurrentDoc().then(function(){
            emptyState.classList.add("d-none");
            wrapper.classList.remove("d-none");

            document.getElementById("bedCount").textContent = branch.beds;
            document.getElementById("operatingHours").textContent =
                formatTimeRange(branch.openingTime, branch.closingTime);

            document.getElementById("slotCount").textContent =
                currentDoc.slots.filter(function(slot){ return slot.status !== "Cancelled"; }).length;

            document.getElementById("paydayGridTitle").textContent = branch.name;
            document.getElementById("paydayGridSubtitle").textContent =
                new Date(date + "T00:00:00").toLocaleDateString("en-PH", {
                    weekday: "long", month: "long", day: "numeric", year: "numeric"
                });

            renderBlockDateControl(currentDoc);
            renderHeader(branch);
            renderBody(branch);
        });
    }

    /* ---- Grid header: per-bed Available checkbox + From/To time range ---- */

    function setTimelineGridColumns(numberOfBeds){
        document.querySelector(".timeline-grid")
            ?.style.setProperty("--bed-count", numberOfBeds);
    }

    function renderHeader(branch){
        setTimelineGridColumns(branch.beds);

        let html = `
            <div class="timeline-header-cell timeline-corner">
                Time
            </div>
        `;

        for(let bed = 1; bed <= branch.beds; bed++){
            const bedInfo = currentDoc.beds[bed] || { available: true, from: branch.openingTime, to: branch.closingTime };

            html += `
                <div class="timeline-header-cell${bedInfo.available ? "" : " timeline-header-cell-unavailable"}">
                    <span>Bed ${bed}</span>

                    <label class="bed-available-toggle">
                        <input type="checkbox" data-bed-available="${bed}" ${bedInfo.available ? "checked" : ""}>
                        Available
                    </label>

                    <div class="bed-availability-time-row">
                        <input
                            type="time"
                            data-bed-from="${bed}"
                            value="${escapeHtml(bedInfo.from || branch.openingTime)}"
                            ${bedInfo.available ? "" : "disabled"}
                        >
                        <span>to</span>
                        <input
                            type="time"
                            data-bed-to="${bed}"
                            value="${escapeHtml(bedInfo.to || branch.closingTime)}"
                            ${bedInfo.available ? "" : "disabled"}
                        >
                    </div>
                </div>
            `;
        }

        document.getElementById("paydayHead").innerHTML = html;
    }

    function toggleBedAvailability(bed, checkbox){
        if(!currentDoc){
            return;
        }

        const bedInfo = currentDoc.beds[bed] || {};
        bedInfo.available = checkbox.checked;
        currentDoc.beds[bed] = bedInfo;

        saveCurrentDoc().then(function(){
            renderHeader(getSelectedBranch());
            renderBody(getSelectedBranch());
        });
    }

    function updateBedAvailabilityTime(input){
        if(!currentDoc){
            return;
        }

        const bed = Number(input.dataset.bedFrom || input.dataset.bedTo);
        const bedInfo = currentDoc.beds[bed] || {};

        if(input.dataset.bedFrom){
            bedInfo.from = input.value;
        }else{
            bedInfo.to = input.value;
        }

        currentDoc.beds[bed] = bedInfo;
        saveCurrentDoc();
    }

    /* ---- Grid body: click-to-place Payday Sale slots per bed ---- */

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

    function renderBody(branch){
        const body = document.getElementById("paydayBody");
        body.innerHTML = "";

        setTimelineGridColumns(branch.beds);
        body.style.setProperty("--schedule-hour-height", SCHEDULE_PX_PER_HOUR + "px");

        const opening = timeToMinutes(branch.openingTime);
        const closing = timeToMinutes(branch.closingTime);
        const totalHeight = Math.max(0, closing - opening) * SCHEDULE_PX_PER_MINUTE;

        const date = document.getElementById("scheduleDate").value;
        const isToday = date === getTodayDateString();
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        const activeSlots = currentDoc.slots.filter(function(item){
            return item.status !== "Cancelled";
        });

        const actualSchedules = getActualSchedules(branch.name, date);

        const timeCol = document.createElement("div");
        timeCol.className = "timeline-time-col";
        timeCol.style.height = totalHeight + "px";

        getHourMarks(opening, closing).forEach(function(minute){
            const label = document.createElement("div");
            label.className = "timeline-hour-label";
            label.style.top = ((minute - opening) * SCHEDULE_PX_PER_MINUTE) + "px";
            label.textContent = formatTime(minutesToTimeValue(minute));
            timeCol.appendChild(label);
        });

        body.appendChild(timeCol);

        for(let bed = 1; bed <= branch.beds; bed++){
            const col = document.createElement("div");
            const bedInfo = currentDoc.beds[bed] || { available: true };
            const bedIsUnavailable = !bedInfo.available;

            col.className = bedIsUnavailable
                ? "timeline-bed-col timeline-bed-col-unavailable"
                : "timeline-bed-col";

            col.style.height = totalHeight + "px";

            const bedSlots = activeSlots.filter(function(slot){
                return Number(slot.bed) === bed;
            });

            const bedActualSchedules = actualSchedules.filter(function(item){
                return Number(item.bed) === bed;
            });

            col.addEventListener("click", function(event){
                if(bedIsUnavailable){
                    return;
                }

                const rect = col.getBoundingClientRect();
                const offsetY = event.clientY - rect.top;
                const rawMinutes = opening + Math.floor(offsetY / SCHEDULE_PX_PER_MINUTE);
                const slotStart = Math.floor(rawMinutes / 10) * 10;

                const occupied = bedSlots.concat(bedActualSchedules).some(function(slot){
                    return (
                        slotStart >= timeToMinutes(slot.startTime) &&
                        slotStart < timeToMinutes(slot.endTime)
                    );
                });

                if(occupied){
                    return;
                }

                openNewModal(bed, minutesToTimeValue(slotStart));
            });

            bedSlots.forEach(function(slot){
                const slotStart = timeToMinutes(slot.startTime);
                const slotEnd = timeToMinutes(slot.endTime);
                const clampedStart = Math.max(slotStart, opening);
                const clampedEnd = Math.min(slotEnd, closing);

                if(clampedEnd <= clampedStart){
                    return;
                }

                const button = document.createElement("button");
                button.type = "button";
                button.className =
                    "appointment-card" + (slot.isCompanionEntry ? " companion-entry-card" : "");
                button.style.top = ((clampedStart - opening) * SCHEDULE_PX_PER_MINUTE) + "px";
                button.style.height = ((clampedEnd - clampedStart) * SCHEDULE_PX_PER_MINUTE) + "px";

                button.title =
                    `${slot.client || "Sale Slot"} — ${slot.service || "Service"}` +
                    (slot.therapist ? ` with ${slot.therapist}` : "") +
                    (
                        slot.isCompanionEntry && slot.companionOfName
                            ? ` (Companion of ${slot.companionOfName})`
                            : ""
                    ) +
                    ` (${formatTimeRange(slot.startTime, slot.endTime)})`;

                button.innerHTML = `
                    <strong>${escapeHtml(slot.client || "Sale Slot")}</strong>
                    ${slot.isCompanionEntry ? '<small class="companion-tag">(Companion)</small>' : ""}
                    <span>${escapeHtml(slot.service || "Service")}${slot.therapist ? " · " + escapeHtml(slot.therapist) : ""}</span>
                    <small>${formatTimeRange(slot.startTime, slot.endTime)}</small>
                `;

                button.addEventListener("click", function(event){
                    event.stopPropagation();
                    openEditModal(slot.id);
                });

                col.appendChild(button);
            });

            /* Real Scheduling appointments — read-only occupancy marker,
               no client details and no click handler (see
               getActualSchedules() above). Just tells marketing the bed
               is already taken at this time. */
            bedActualSchedules.forEach(function(item){
                const itemStart = timeToMinutes(item.startTime);
                const itemEnd = timeToMinutes(item.endTime);
                const clampedStart = Math.max(itemStart, opening);
                const clampedEnd = Math.min(itemEnd, closing);

                if(clampedEnd <= clampedStart){
                    return;
                }

                const block = document.createElement("div");
                block.className = "actual-schedule-block";
                block.style.top = ((clampedStart - opening) * SCHEDULE_PX_PER_MINUTE) + "px";
                block.style.height = ((clampedEnd - clampedStart) * SCHEDULE_PX_PER_MINUTE) + "px";
                block.title = "Already scheduled — " + formatTimeRange(item.startTime, item.endTime);
                block.textContent = "Scheduled";

                col.appendChild(block);
            });

            body.appendChild(col);
        }

        if(isToday && currentMinutes >= opening && currentMinutes < closing){
            const line = document.createElement("div");
            line.className = "timeline-current-line";
            line.style.top = ((currentMinutes - opening) * SCHEDULE_PX_PER_MINUTE) + "px";
            body.appendChild(line);
        }
    }

    /* ---- Services (main appointment) ---- */

    function buildServiceOptionsHtml(selectedName){
        let html = '<option value="">Select Service</option>';

        /* Only services ticked "Available for Payday" in List of Services
           are offered here. A service already saved on a slot that has
           since been un-ticked stays selectable so editing that slot
           doesn't silently blank its service. */
        getServices().filter(function(service){
            return service.availableForPayday || service.name === selectedName;
        }).forEach(function(service){
            const price =
                service.availableForPayday && service.paydaySalePrice > 0
                    ? " — ₱" + service.paydaySalePrice.toLocaleString("en-PH")
                    : "";

            const label =
                (service.duration > 0
                    ? `${service.name} (${service.duration} mins)`
                    : `${service.name} (Duration not set)`) + price;

            html += `
                <option value="${escapeHtml(service.name)}" ${service.name === selectedName ? "selected" : ""}>
                    ${escapeHtml(label)}
                </option>
            `;
        });

        return html;
    }

    function resetModalServices(rowNames){
        const names = Array.isArray(rowNames) && rowNames.length > 0 ? rowNames : [""];

        modalServiceRows = names.map(function(name){
            return { id: createId(), name: name || "" };
        });

        renderServiceRows();
    }

    function addServiceRow(){
        modalServiceRows.push({ id: createId(), name: "" });
        renderServiceRows();
        updateModalPreview();
    }

    function removeServiceRow(rowId){
        if(modalServiceRows.length <= 1){
            return;
        }

        modalServiceRows = modalServiceRows.filter(function(row){ return row.id !== rowId; });
        renderServiceRows();
        updateModalPreview();
    }

    function renderServiceRows(){
        const container = document.getElementById("paydayModalServicesList");
        container.innerHTML = "";

        modalServiceRows.forEach(function(row){
            const rowEl = document.createElement("div");
            rowEl.className = "modal-service-row";

            rowEl.innerHTML = `
                <select class="form-select modal-service-select">
                    ${buildServiceOptionsHtml(row.name)}
                </select>

                ${
                    modalServiceRows.length > 1
                        ? '<button type="button" class="modal-service-remove-btn" aria-label="Remove service">×</button>'
                        : ""
                }
            `;

            rowEl.querySelector(".modal-service-select")
                .addEventListener("change", function(){
                    row.name = this.value;
                    updateModalPreview();
                });

            const removeBtn = rowEl.querySelector(".modal-service-remove-btn");

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
            return { name: WILL_CHOOSE_SERVICE_NAME, duration: WILL_CHOOSE_SERVICE_DURATION };
        }

        return services.find(function(service){ return service.name === rowName; });
    }

    function getSelectedServiceObjects(){
        const services = getServices();

        return modalServiceRows
            .filter(function(row){ return row.name; })
            .map(function(row){ return resolveServiceRowToObject(row.name, services); })
            .filter(Boolean);
    }

    function buildTherapistOptionsHtml(selectedName){
        let html = '<option value="">To be Assigned</option>';

        getTherapists().forEach(function(name){
            html += `
                <option value="${escapeHtml(name)}" ${name === selectedName ? "selected" : ""}>
                    ${escapeHtml(name)}
                </option>
            `;
        });

        return html;
    }

    function buildBedOptionsHtml(branch, selectedBedValue){
        let html = '<option value="">Select Bed</option>';

        if(!branch){
            return html;
        }

        for(let bed = 1; bed <= branch.beds; bed++){
            const bedInfo = currentDoc?.beds?.[bed];

            const isUnavailable =
                bedInfo && bedInfo.available === false && String(bed) !== String(selectedBedValue);

            html += `
                <option value="${bed}" ${String(bed) === String(selectedBedValue) ? "selected" : ""} ${isUnavailable ? "disabled" : ""}>
                    Bed ${bed}${isUnavailable ? " (Unavailable)" : ""}
                </option>
            `;
        }

        return html;
    }

    function loadTherapistOptions(){
        const select = document.getElementById("paydayModalTherapist");
        select.innerHTML = buildTherapistOptionsHtml(select.value);
    }

    /* ---- Companions ---- */

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
                            return { id: createId(), name: name || "" };
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
            const distanceA = Math.abs(a - preferredBed);
            const distanceB = Math.abs(b - preferredBed);
            return distanceA !== distanceB ? distanceA - distanceB : a - b;
        });
    }

    function recommendCompanionSlot(companion){
        const branch = getSelectedBranch();

        if(!branch){
            return;
        }

        const mainServices = getSelectedServiceObjects();

        const durationGuess =
            mainServices.length > 0
                ? mainServices.reduce(function(sum, service){ return sum + service.duration; }, 0)
                : 10;

        const bedOrder = getNearestBedOrder(branch, Number(selectedBed) || 1);
        const pool = getConflictPool(companion.id);
        const startTime = companion.startTime || selectedStartTime;

        if(startTime){
            const endTime = minutesToTimeValue(timeToMinutes(startTime) + durationGuess);

            for(let i = 0; i < bedOrder.length; i++){
                const bed = bedOrder[i];

                if(!poolHasConflict(bed, startTime, endTime, pool)){
                    companion.bed = String(bed);
                    companion.startTime = startTime;
                    return;
                }
            }
        }

        const searchFromMinutes = timeToMinutes(startTime || selectedStartTime);
        let best = null;

        bedOrder.forEach(function(bed, order){
            const slot = findNextAvailableStart(branch, bed, durationGuess, pool, searchFromMinutes);

            if(!slot){
                return;
            }

            if(
                !best ||
                timeToMinutes(slot.startTime) < timeToMinutes(best.startTime) ||
                (timeToMinutes(slot.startTime) === timeToMinutes(best.startTime) && order < best.order)
            ){
                best = { bed: bed, startTime: slot.startTime, order: order };
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
        modalCompanions = modalCompanions.filter(function(companion){ return companion.id !== companionId; });
        renderCompanions();
        updateModalPreview();
    }

    function updateCompanionOfHints(){
        const principalName = document.getElementById("paydayModalClient").value.trim() || "the client";

        document.querySelectorAll(".companion-of-name").forEach(function(element){
            element.textContent = principalName;
        });
    }

    function renderCompanions(){
        const container = document.getElementById("paydayModalCompanionsList");
        container.innerHTML = "";

        const branch = getSelectedBranch();
        const principalName = document.getElementById("paydayModalClient").value.trim() || "the client";

        modalCompanions.forEach(function(companion, index){
            const card = document.createElement("div");
            card.className = "companion-card";
            card.dataset.companionId = companion.id;

            card.innerHTML = `
                <div class="companion-card-header">
                    <div>
                        <span class="companion-number">Companion ${index + 1}</span>

                        <p class="companion-of-hint">
                            Companion of
                            <span class="companion-of-name">${escapeHtml(principalName)}</span>
                        </p>
                    </div>

                    <button type="button" class="companion-remove-btn" aria-label="Remove companion">×</button>
                </div>

                <div class="row g-2">
                    <div class="col-12">
                        <label class="form-label">Companion Name</label>

                        <input
                            type="text"
                            class="form-control companion-name-input"
                            list="paydayClientOptions"
                            placeholder="Type or select companion"
                            autocomplete="off"
                            value="${escapeHtml(companion.name)}"
                        >
                    </div>

                    <div class="col-12">
                        <label class="form-label">Services</label>

                        <div class="companion-services-list"></div>

                        <button type="button" class="btn btn-outline-success btn-sm mt-2 companion-add-service">
                            + Add Service
                        </button>
                    </div>

                    <div class="col-12">
                        <label class="form-label">Therapist</label>

                        <select class="form-select companion-therapist-select">
                            ${buildTherapistOptionsHtml(companion.therapist)}
                        </select>
                    </div>

                    <div class="col-md-4">
                        <label class="form-label">Bed</label>

                        <select class="form-select companion-bed-select">
                            ${buildBedOptionsHtml(branch, companion.bed)}
                        </select>
                    </div>

                    <div class="col-md-4">
                        <label class="form-label">Start Time</label>

                        <input
                            type="time"
                            class="form-control companion-start-input"
                            step="60"
                            value="${escapeHtml(companion.startTime || "")}"
                        >
                    </div>

                    <div class="col-md-4">
                        <label class="form-label">End Time</label>

                        <div class="modal-readout companion-end-readout">—</div>
                    </div>
                </div>

                <div class="companion-message d-none"></div>
            `;

            card.querySelector(".companion-remove-btn")
                .addEventListener("click", function(){ removeCompanionRow(companion.id); });

            card.querySelector(".companion-name-input")
                .addEventListener("input", function(){ companion.name = this.value; });

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
                .addEventListener("click", function(){ addCompanionServiceRow(companion.id); });

            container.appendChild(card);

            renderCompanionServiceRows(companion);
            updateCompanionPreview(companion.id);
        });
    }

    function renderCompanionServiceRows(companion){
        const card = document.querySelector(`.companion-card[data-companion-id="${companion.id}"]`);

        if(!card){
            return;
        }

        const container = card.querySelector(".companion-services-list");
        container.innerHTML = "";

        companion.services.forEach(function(row){
            const rowEl = document.createElement("div");
            rowEl.className = "companion-service-row";

            rowEl.innerHTML = `
                <select class="form-select companion-service-select">
                    ${buildServiceOptionsHtml(row.name)}
                </select>

                ${
                    companion.services.length > 1
                        ? '<button type="button" class="companion-service-remove-btn" aria-label="Remove service">×</button>'
                        : ""
                }
            `;

            rowEl.querySelector(".companion-service-select")
                .addEventListener("change", function(){
                    row.name = this.value;
                    updateModalPreview();
                });

            const removeBtn = rowEl.querySelector(".companion-service-remove-btn");

            if(removeBtn){
                removeBtn.addEventListener("click", function(){
                    removeCompanionServiceRow(companion.id, row.id);
                });
            }

            container.appendChild(rowEl);
        });
    }

    function addCompanionServiceRow(companionId){
        const companion = modalCompanions.find(function(item){ return item.id === companionId; });

        if(!companion){
            return;
        }

        companion.services.push({ id: createId(), name: "" });
        renderCompanionServiceRows(companion);
        updateModalPreview();
    }

    function removeCompanionServiceRow(companionId, rowId){
        const companion = modalCompanions.find(function(item){ return item.id === companionId; });

        if(!companion || companion.services.length <= 1){
            return;
        }

        companion.services = companion.services.filter(function(row){ return row.id !== rowId; });
        renderCompanionServiceRows(companion);
        updateModalPreview();
    }

    function getCompanionSelectedServices(companion){
        const services = getServices();

        return companion.services
            .filter(function(row){ return row.name; })
            .map(function(row){ return resolveServiceRowToObject(row.name, services); })
            .filter(Boolean);
    }

    /* ---- Conflict pool — scoped to this branch/date's Payday Sale slots only,
       never the real crownSchedule_* appointments. An unavailable bed
       (Available unchecked in the header) is injected as a synthetic
       all-day block, same idea as scheduling.js's toggleBedAvailability. ---- */

    function getMainDraftSlot(){
        if(!selectedBed || !selectedStartTime){
            return null;
        }

        const services = getSelectedServiceObjects();

        if(services.length === 0 || services.some(function(service){ return !service.duration || service.duration <= 0; })){
            return null;
        }

        const totalDuration = services.reduce(function(sum, service){ return sum + service.duration; }, 0);

        return {
            bed: selectedBed,
            startTime: selectedStartTime,
            endTime: minutesToTimeValue(timeToMinutes(selectedStartTime) + totalDuration)
        };
    }

    function getCompanionDraftSlot(companion){
        if(!companion.bed || !companion.startTime){
            return null;
        }

        const services = getCompanionSelectedServices(companion);

        if(services.length === 0 || services.some(function(service){ return !service.duration || service.duration <= 0; })){
            return null;
        }

        const totalDuration = services.reduce(function(sum, service){ return sum + service.duration; }, 0);

        return {
            bed: companion.bed,
            startTime: companion.startTime,
            endTime: minutesToTimeValue(timeToMinutes(companion.startTime) + totalDuration)
        };
    }

    function getPersistedConflictPool(){
        const branch = getSelectedBranch();

        if(!branch || !currentDoc){
            return [];
        }

        const scheduled = currentDoc.slots.filter(function(item){
            return (
                item.status !== "Cancelled" &&
                item.id !== selectedSlotId &&
                item.companionOf !== selectedSlotId
            );
        });

        const unavailableBlocks = [];

        for(let bed = 1; bed <= branch.beds; bed++){
            const bedInfo = currentDoc.beds[bed];

            if(bedInfo && bedInfo.available === false){
                unavailableBlocks.push({ bed: bed, startTime: branch.openingTime, endTime: branch.closingTime });
            }
        }

        /* Real Scheduling appointments (read-only, see getActualSchedules)
           — a Payday Sale slot can't be placed on top of an actual
           booking, same bed/therapist conflict shape as everything else
           in this pool. */
        const actualSchedules =
            getActualSchedules(currentDoc.branch, currentDoc.date).map(function(item){
                return {
                    bed: item.bed,
                    therapist: item.therapist,
                    startTime: item.startTime,
                    endTime: item.endTime
                };
            });

        return scheduled.concat(unavailableBlocks, actualSchedules);
    }

    function poolHasConflict(bed, startTime, endTime, pool){
        return pool.some(function(item){
            if(!bed || Number(item.bed) !== Number(bed)){
                return false;
            }

            return hasOverlap(startTime, endTime, item.startTime, item.endTime);
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

            return hasOverlap(startTime, endTime, item.startTime, item.endTime);
        });
    }

    function getAllDraftSlots(excludeKey){
        const slots = [];

        if(excludeKey !== "main"){
            const mainSlot = getMainDraftSlot();

            if(mainSlot){
                slots.push({
                    bed: mainSlot.bed,
                    therapist: document.getElementById("paydayModalTherapist").value,
                    startTime: mainSlot.startTime,
                    endTime: mainSlot.endTime
                });
            }
        }

        modalCompanions.forEach(function(companion){
            if(companion.id === excludeKey){
                return;
            }

            const slot = getCompanionDraftSlot(companion);

            if(!slot){
                return;
            }

            slots.push({ bed: slot.bed, therapist: companion.therapist, startTime: slot.startTime, endTime: slot.endTime });
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
        const opening = timeToMinutes(branch.openingTime);
        const closing = timeToMinutes(branch.closingTime);

        const earliestStart =
            typeof searchFromMinutes === "number"
                ? Math.max(opening, Math.ceil(searchFromMinutes / 10) * 10)
                : opening;

        for(let start = earliestStart; start + durationMinutes <= closing; start += 10){
            const startTimeValue = minutesToTimeValue(start);
            const endTimeValue = minutesToTimeValue(start + durationMinutes);

            if(!poolHasConflict(bed, startTimeValue, endTimeValue, pool)){
                return { startTime: startTimeValue, endTime: endTimeValue };
            }
        }

        return null;
    }

    function showCompanionMessage(element, type, text){
        element.className = `companion-message companion-message-${type}`;
        element.textContent = text;
    }

    function hideCompanionMessage(element){
        element.className = "companion-message d-none";
        element.textContent = "";
    }

    function updateCompanionPreview(companionId){
        const companion = modalCompanions.find(function(item){ return item.id === companionId; });

        if(!companion){
            return;
        }

        const card = document.querySelector(`.companion-card[data-companion-id="${companion.id}"]`);

        if(!card){
            return;
        }

        const endReadout = card.querySelector(".companion-end-readout");
        const messageEl = card.querySelector(".companion-message");
        const branch = getSelectedBranch();
        const services = getCompanionSelectedServices(companion);

        if(services.length === 0 || !companion.startTime){
            endReadout.textContent = "—";
            hideCompanionMessage(messageEl);
            return;
        }

        const hasMissingDuration = services.some(function(service){ return !service.duration || service.duration <= 0; });

        if(hasMissingDuration){
            endReadout.textContent = "—";
            showCompanionMessage(messageEl, "danger", "One or more selected services has no duration set.");
            return;
        }

        const totalDuration = services.reduce(function(sum, service){ return sum + service.duration; }, 0);
        const endTime = minutesToTimeValue(timeToMinutes(companion.startTime) + totalDuration);

        endReadout.textContent = formatTime(endTime);

        const isOvertime = timeToMinutes(endTime) > timeToMinutes(branch.closingTime);

        if(!companion.bed){
            hideCompanionMessage(messageEl);
            return;
        }

        const pool = getConflictPool(companion.id);

        if(poolHasConflict(companion.bed, companion.startTime, endTime, pool)){
            const altBed = findAlternateBed(branch, companion.bed, companion.startTime, endTime, pool);
            const altSlot = findNextAvailableStart(branch, companion.bed, totalDuration, pool, timeToMinutes(companion.startTime));

            let message = `Bed ${companion.bed} is already booked during ${formatTimeRange(companion.startTime, endTime)}.`;
            const suggestions = [];

            if(altBed){
                suggestions.push(`Bed ${altBed} is free at this time.`);
            }

            if(altSlot){
                suggestions.push(`Bed ${companion.bed} is next free starting ${formatTime(altSlot.startTime)}.`);
            }

            if(suggestions.length > 0){
                message += " " + suggestions.join(" Or ");
            }

            showCompanionMessage(messageEl, "danger", message);
            return;
        }

        if(companion.therapist && poolHasTherapistConflict(companion.therapist, companion.startTime, endTime, pool)){
            showCompanionMessage(messageEl, "danger", `${companion.therapist} is already assigned to another slot during this time.`);
            return;
        }

        if(isOvertime){
            showCompanionMessage(
                messageEl,
                "warning",
                `Bed ${companion.bed} is available until ${formatTime(endTime)} — this goes past closing time (${formatTime(branch.closingTime)}).`
            );
            return;
        }

        showCompanionMessage(messageEl, "success", `Bed ${companion.bed} is available until ${formatTime(endTime)}.`);
    }

    function updateAllCompanionPreviews(){
        modalCompanions.forEach(function(companion){ updateCompanionPreview(companion.id); });
    }

    /* ---- Add / edit / delete slot modal ---- */

    function getModalDate(){
        return document.getElementById("paydayModalDate")?.value || document.getElementById("scheduleDate").value;
    }

    function updateSelectedSlotLabel(){
        const branch = getSelectedBranch();
        const date = getModalDate();

        document.getElementById("paydaySelectedSlotLabel").textContent =
            `${branch.name} • ${new Date(date + "T00:00:00").toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}`;
    }

    function resetModalFields(){
        document.getElementById("paydayModalClient").value = "";
        document.getElementById("paydayModalMobile").value = "";
        document.getElementById("paydayModalEmail").value = "";
        document.getElementById("paydayModalTherapist").value = "";
        document.getElementById("paydayModalStatus").value = "Confirmed";
        document.getElementById("paydayModalNotes").value = "";

        modalCompanions = [];
        document.getElementById("paydayModalCompanionsList").innerHTML = "";

        resetModalServices();

        document.getElementById("paydayModalDuration").textContent = "—";
        document.getElementById("paydayModalEndTime").textContent = "—";

        hideModalMessage();
    }

    function updateModalPreview(){
        const selectedServices = getSelectedServiceObjects();
        const branch = getSelectedBranch();

        if(selectedServices.length === 0){
            document.getElementById("paydayModalDuration").textContent = "—";
            document.getElementById("paydayModalEndTime").textContent = "—";
            hideModalMessage();
            updateAllCompanionPreviews();
            return;
        }

        const hasMissingDuration = selectedServices.some(function(service){ return !service.duration || service.duration <= 0; });

        if(hasMissingDuration){
            document.getElementById("paydayModalDuration").textContent = "Not Set";
            document.getElementById("paydayModalEndTime").textContent = "—";
            showModalMessage("warning", "One or more selected services has no duration. Please update it in List of Services.");
            updateAllCompanionPreviews();
            return;
        }

        const totalDuration = selectedServices.reduce(function(sum, service){ return sum + service.duration; }, 0);
        const endTime = minutesToTimeValue(timeToMinutes(selectedStartTime) + totalDuration);

        document.getElementById("paydayModalDuration").textContent = `${totalDuration} Minutes`;
        document.getElementById("paydayModalEndTime").textContent = formatTime(endTime);

        const isOvertime = timeToMinutes(endTime) > timeToMinutes(branch.closingTime);
        const mainPool = getConflictPool("main");

        if(poolHasConflict(selectedBed, selectedStartTime, endTime, mainPool)){
            showModalMessage("danger", "This bed is not available for the full duration of the selected service.");
            updateAllCompanionPreviews();
            return;
        }

        const therapistName = document.getElementById("paydayModalTherapist").value;

        if(poolHasTherapistConflict(therapistName, selectedStartTime, endTime, mainPool)){
            showModalMessage("danger", `${therapistName} is already assigned to another slot during this time.`);
            updateAllCompanionPreviews();
            return;
        }

        if(isOvertime){
            showModalMessage(
                "warning",
                `Bed ${selectedBed} is available until ${formatTime(endTime)} — this goes past closing time (${formatTime(branch.closingTime)}).`
            );
            updateAllCompanionPreviews();
            return;
        }

        showModalMessage("success", `Bed ${selectedBed} is available until ${formatTime(endTime)}.`);
        updateAllCompanionPreviews();
    }

    function openNewModal(bed, startTime){
        const branch = getSelectedBranch();

        if(currentDoc && currentDoc.blocked){
            alert(
                "This date is blocked for Payday Sale" +
                (currentDoc.blockReason ? ` (${currentDoc.blockReason})` : "") +
                ". Uncheck \"Block this date\" if you need to add a slot."
            );
            return;
        }

        selectedSlotId = null;
        selectedBed = bed;
        selectedStartTime = startTime;

        resetModalFields();
        loadTherapistOptions();

        document.getElementById("paydayModalDate").value = document.getElementById("scheduleDate").value;

        document.getElementById("paydayModalModeLabel").textContent = "New Sale Slot";
        document.getElementById("paydayModalTitle").textContent = "Add Payday Sale Slot";
        document.getElementById("deletePaydaySlotBtn").classList.add("d-none");
        document.getElementById("addToScheduleBtn").classList.add("d-none");
        document.getElementById("savePaydayModalBtn").textContent = "Save Slot";

        document.getElementById("paydayModalBed").innerHTML = buildBedOptionsHtml(branch, bed);
        document.getElementById("paydayModalStartTime").value = startTime;

        updateSelectedSlotLabel();
        updateModalPreview();
        showModal();
    }

    function openEditModal(slotId){
        const branch = getSelectedBranch();
        const item = currentDoc.slots.find(function(slot){ return slot.id === slotId; });

        if(!item){
            return;
        }

        selectedSlotId = item.id;
        selectedBed = Number(item.bed);
        selectedStartTime = item.startTime;

        document.getElementById("paydayModalDate").value = currentDoc.date;

        document.getElementById("paydayModalModeLabel").textContent = "Edit Sale Slot";
        document.getElementById("paydayModalTitle").textContent = "Edit Payday Sale Slot";

        document.getElementById("paydayModalClient").value = item.client || "";
        document.getElementById("paydayModalMobile").value = item.mobile || "";
        document.getElementById("paydayModalEmail").value = item.email || "";

        const savedServiceNames =
            Array.isArray(item.services) && item.services.length > 0
                ? item.services
                : (item.service ? [item.service] : []);

        resetModalServices(savedServiceNames);

        const linkedCompanions = currentDoc.slots.filter(function(slot){ return slot.companionOf === item.id; });
        resetModalCompanions(linkedCompanions);

        loadTherapistOptions();
        document.getElementById("paydayModalTherapist").value = item.therapist || "";
        document.getElementById("paydayModalStatus").value = item.status || "Confirmed";
        document.getElementById("paydayModalNotes").value = item.notes || "";

        document.getElementById("paydayModalBed").innerHTML = buildBedOptionsHtml(branch, Number(item.bed));
        document.getElementById("paydayModalStartTime").value = item.startTime || "";

        document.getElementById("deletePaydaySlotBtn").classList.remove("d-none");
        document.getElementById("addToScheduleBtn").classList.remove("d-none");
        document.getElementById("savePaydayModalBtn").textContent = "Update Slot";

        updateSelectedSlotLabel();
        updateModalPreview();
        showModal();
    }

    function showModal(){
        document.getElementById("paydayModalBackdrop").classList.remove("d-none");
        document.body.classList.add("modal-open");

        setTimeout(function(){
            document.getElementById("paydayModalClient").focus();
        }, 50);
    }

    function closeModal(){
        document.getElementById("paydayModalBackdrop").classList.add("d-none");
        document.body.classList.remove("modal-open");

        selectedSlotId = null;
        selectedBed = null;
        selectedStartTime = "";
        pendingVoucherRequestId = null;

        resetModalFields();
    }

    function showModalMessage(type, text){
        const message = document.getElementById("paydayModalMessage");
        message.className = `modal-message modal-message-${type}`;
        message.textContent = text;
    }

    function hideModalMessage(){
        const message = document.getElementById("paydayModalMessage");
        message.className = "modal-message d-none";
        message.textContent = "";
    }

    function saveSlot(){
        const branch = getSelectedBranch();
        const date = getModalDate();

        if(!date){
            alert("Please pick a date for this slot.");
            return;
        }

        const client = document.getElementById("paydayModalClient").value.trim();
        const mobile = document.getElementById("paydayModalMobile").value.trim();
        const email = document.getElementById("paydayModalEmail").value.trim();
        const services = getSelectedServiceObjects();
        const therapist = document.getElementById("paydayModalTherapist").value;
        const status = document.getElementById("paydayModalStatus").value;
        const notes = document.getElementById("paydayModalNotes").value.trim();

        if(!client){
            alert("Please enter or select a client.");
            return;
        }

        if(services.length === 0){
            alert("Please select at least one service.");
            return;
        }

        const hasMissingDuration = services.some(function(service){ return !service.duration || service.duration <= 0; });

        if(hasMissingDuration){
            alert("One or more selected services has no valid duration.");
            return;
        }

        const totalDuration = services.reduce(function(sum, service){ return sum + service.duration; }, 0);
        const endTime = minutesToTimeValue(timeToMinutes(selectedStartTime) + totalDuration);

        const activeCompanions = modalCompanions.filter(function(companion){ return companion.name.trim(); });
        const companionPayloads = [];

        for(let i = 0; i < activeCompanions.length; i++){
            const companion = activeCompanions[i];
            const companionName = companion.name.trim();
            const companionServices = getCompanionSelectedServices(companion);

            if(companionServices.length === 0){
                alert(`Please select at least one service for companion "${companionName}".`);
                return;
            }

            const companionHasMissingDuration =
                companionServices.some(function(service){ return !service.duration || service.duration <= 0; });

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
                companionServices.reduce(function(sum, service){ return sum + service.duration; }, 0);

            const companionEndTime =
                minutesToTimeValue(timeToMinutes(companion.startTime) + companionTotalDuration);

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

        if(status !== "Cancelled" && !selectedBed){
            alert("Please select a bed before saving.");
            return;
        }

        if(status !== "Cancelled"){
            const mainPool = getConflictPool("main");

            if(poolHasConflict(selectedBed, selectedStartTime, endTime, mainPool)){
                alert("The selected bed is already occupied during part of this time.");
                return;
            }

            if(poolHasTherapistConflict(therapist, selectedStartTime, endTime, mainPool)){
                alert(`${therapist} is already assigned to another slot during this time.`);
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
                    alert(`${payload.therapist} is already assigned to another slot during this time (companion "${payload.name}").`);
                    return;
                }
            }
        }

        const mainId = selectedSlotId || createId();

        const slotData = {
            id: mainId,
            client: client,
            mobile: mobile,
            email: email,
            services: services.map(function(service){ return service.name; }),
            service: services.map(function(service){ return service.name; }).join(", "),
            therapist: therapist,
            bed: selectedBed,
            startTime: selectedStartTime,
            endTime: endTime,
            duration: totalDuration,
            status: status,
            notes: notes,
            createdBy: currentUserAccount(),
            createdAt: new Date().toISOString()
        };

        const companionEntries = companionPayloads.map(function(payload){
            return {
                id: createId(),
                client: payload.name,
                services: payload.services.map(function(service){ return service.name; }),
                service: payload.services.map(function(service){ return service.name; }).join(", "),
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
                createdBy: currentUserAccount(),
                createdAt: new Date().toISOString()
            };
        });

        currentDoc.slots = currentDoc.slots.filter(function(item){
            return item.id !== mainId && item.companionOf !== mainId;
        });

        currentDoc.slots.push(slotData);
        companionEntries.forEach(function(entry){ currentDoc.slots.push(entry); });

        currentDoc.slots.sort(function(a, b){
            return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
        });

        const plottedRequestId = pendingVoucherRequestId;

        saveCurrentDoc().then(function(saved){
            if(saved === false){
                return;
            }

            closeModal();
            renderPaydaySale();

            if(plottedRequestId){
                markVoucherRequestPlotted(plottedRequestId, mainId);
            }
        });
    }

    function deleteSlot(){
        if(!selectedSlotId){
            return;
        }

        const item = currentDoc.slots.find(function(slot){ return slot.id === selectedSlotId; });

        if(!item){
            return;
        }

        const linkedCompanionsCount =
            currentDoc.slots.filter(function(slot){ return slot.companionOf === selectedSlotId; }).length;

        const confirmMessage =
            linkedCompanionsCount > 0
                ? `Delete the Payday Sale slot for "${item.client}" and its ${linkedCompanionsCount} companion slot(s)?`
                : `Delete the Payday Sale slot for "${item.client}"?`;

        if(!confirm(confirmMessage)){
            return;
        }

        currentDoc.slots = currentDoc.slots.filter(function(slot){
            return slot.id !== selectedSlotId && slot.companionOf !== selectedSlotId;
        });

        saveCurrentDoc().then(function(){
            closeModal();
            renderPaydaySale();
        });
    }

    /* Sends this slot's current form fields to Scheduling's Add Appointment
       modal (see openNewModalFromPaydaySale() in scheduling.js) so staff
       can turn a Payday Sale slot into a real appointment without retyping
       it. Reads straight from the open form (not the saved currentDoc
       entry), so any edit made in this modal before clicking is carried
       over even if it was never saved here. Companions aren't carried
       over — add them again on the Scheduling side if needed. The
       Payday Sale slot itself is left exactly as-is; nothing here deletes
       or marks it converted. */
    function addToSchedule(){
        if(!currentDoc || !selectedBed){
            alert("Please select a bed before sending this to Schedule.");
            return;
        }

        const services =
            getSelectedServiceObjects()
                .map(function(service){ return service.name; })
                .join("|");

        const params = new URLSearchParams({
            fromPaydaySale: "1",
            branch: currentDoc.branch,
            date: currentDoc.date,
            bed: String(selectedBed),
            startTime: selectedStartTime || "",
            client: document.getElementById("paydayModalClient").value.trim(),
            mobile: document.getElementById("paydayModalMobile").value.trim(),
            email: document.getElementById("paydayModalEmail").value.trim(),
            services: services,
            therapist: document.getElementById("paydayModalTherapist").value,
            notes: document.getElementById("paydayModalNotes").value.trim()
        });

        location.href = "scheduling.html?" + params.toString();
    }

    /* ---- Voucher requests from the public Payday Sale page ----

       "Order Voucher" on the public page (submitPaydayVoucherOrder Cloud
       Function) writes a bookingRequests doc with source "payday-promo"
       and a one-hour hold on the chosen beds:
       paydayHold {startTime, endTime, beds[], expiresAt}. This table lists
       the ones still pending and unexpired for the selected branch. Plot on
       Grid opens the normal slot form prefilled from the order (guest on
       the first bed, one companion card per extra bed); saving that slot
       marks the request "converted", which releases the hold — the plotted
       slot itself now keeps those beds occupied. Left alone, the hold
       simply runs out and the beds go back to other clients (the public
       page and the scheduled cleanup both honour expiresAt). */

    const PROMO_TAG = "[Payday Sale Promo]";
    let paydayRequests = [];
    let requestsUnsubscribe = null;
    let pendingVoucherRequestId = null;

    function holdExpiresAtMs(request){
        return request.paydayHold?.expiresAt?.toMillis?.() || 0;
    }

    function startBookingRequestsListener(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        requestsUnsubscribe = db()
            .collection("bookingRequests")
            .where("status", "==", "pending")
            .onSnapshot(function(snapshot){
                paydayRequests = snapshot.docs
                    .map(function(doc){ return Object.assign({ id: doc.id }, doc.data()); })
                    .filter(function(request){
                        return (
                            request.source === "payday-promo" ||
                            String(request.notes || "").startsWith(PROMO_TAG)
                        );
                    })
                    .sort(function(a, b){
                        return (a.date + a.time).localeCompare(b.date + b.time);
                    });

                renderBookingRequests();
            }, function(error){
                console.error("Unable to load Payday Sale voucher requests:", error);
            });

        setInterval(tickVoucherTimers, 1000);
    }

    function formatRequestDate(dateString){
        try{
            return new Date(dateString + "T00:00:00").toLocaleDateString("en-PH", {
                month: "short", day: "numeric", year: "numeric"
            });
        }catch(error){
            return dateString;
        }
    }

    function formatCountdown(ms){
        const secs = Math.max(0, Math.min(3599, Math.floor(ms / 1000)));
        return String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
    }

    function tickVoucherTimers(){
        let expired = false;

        document.querySelectorAll("#paydayRequestsBody [data-expires]").forEach(function(el){
            const remaining = Number(el.dataset.expires) - Date.now();

            if(remaining <= 0){
                expired = true;
            }

            el.textContent = formatCountdown(remaining);
        });

        if(expired){
            renderBookingRequests();
        }
    }

    function renderBookingRequests(){
        const body = document.getElementById("paydayRequestsBody");
        const empty = document.getElementById("paydayRequestsEmpty");
        const count = document.getElementById("paydayRequestCount");
        const branchName = document.getElementById("scheduleBranch").value;
        const now = Date.now();

        const rows = paydayRequests.filter(function(request){
            const expiresAt = holdExpiresAtMs(request);

            return (
                (!branchName || request.branch === branchName) &&
                (!expiresAt || expiresAt > now)
            );
        });

        count.textContent = rows.length;
        empty.classList.toggle("d-none", rows.length > 0);

        body.innerHTML = rows.map(function(request){
            const notes = String(request.notes || "").startsWith(PROMO_TAG)
                ? String(request.notes).slice(PROMO_TAG.length).trim()
                : String(request.notes || "");

            const beds = (request.paydayHold?.beds || []).join(", ");
            const expiresAt = holdExpiresAtMs(request);

            return `
                <tr>
                    <td>${escapeHtml(formatRequestDate(request.date))}</td>
                    <td>${escapeHtml(request.time || "")}${request.paydayHold ? "<br><small>" + escapeHtml(formatTimeRange(request.paydayHold.startTime, request.paydayHold.endTime)) + "</small>" : ""}</td>
                    <td>${escapeHtml(request.clientName || "")}</td>
                    <td>${escapeHtml(request.serviceName || "")}${request.paydayPrice ? "<br><small>₱" + Number(request.paydayPrice).toLocaleString("en-PH") + " each</small>" : ""}</td>
                    <td>${escapeHtml(String(request.guests || 1))} guest${(request.guests || 1) === 1 ? "" : "s"}${beds ? "<br><small>Bed " + escapeHtml(beds) + "</small>" : ""}</td>
                    <td>${escapeHtml(request.mobile || "")}${request.email ? "<br>" + escapeHtml(request.email) : ""}</td>
                    <td>${escapeHtml(notes || "—")}</td>
                    <td>${expiresAt ? `<strong data-expires="${expiresAt}">${formatCountdown(expiresAt - now)}</strong>` : "—"}</td>
                    <td class="text-nowrap">
                        <button type="button" class="btn btn-sm btn-success" data-request-plot="${escapeHtml(request.id)}">Plot on Grid</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-request-view="${escapeHtml(request.id)}">View Date</button>
                    </td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll("[data-request-view]").forEach(function(button){
            button.addEventListener("click", function(){
                const request = paydayRequests.find(function(item){ return item.id === button.dataset.requestView; });
                if(request){ showRequestDate(request); }
            });
        });

        body.querySelectorAll("[data-request-plot]").forEach(function(button){
            button.addEventListener("click", function(){
                const request = paydayRequests.find(function(item){ return item.id === button.dataset.requestPlot; });
                if(request){ plotVoucherRequest(request); }
            });
        });
    }

    /* Jumps the grid below to the request's branch/date. Same three-way
       sync scheduling.js's openNewModalFromBookingRequest() does: the
       hidden page inputs, the global toolbar, and the stored global date
       — otherwise the toolbar re-pushes its old values a moment later.
       Resolves once the day's data has loaded. */
    function showRequestDate(request, skipScroll){
        document.getElementById("scheduleBranch").value = request.branch;
        localStorage.setItem(SELECTED_BRANCH_KEY, request.branch);
        document.getElementById("scheduleDate").value = request.date;

        const toolbarBranch = document.getElementById("sidebarDashboardBranch");
        if(toolbarBranch){ toolbarBranch.value = request.branch; }

        const toolbarDate = document.getElementById("sidebarDashboardDate");
        if(toolbarDate){ toolbarDate.value = request.date; }

        localStorage.setItem("crownGlobalDate", request.date);

        const loaded = renderPaydaySale();
        renderBookingRequests();

        if(!skipScroll){
            document.getElementById("paydayGridTitle").scrollIntoView({ behavior: "smooth", block: "start" });
        }

        return loaded;
    }

    /* Opens the slot form prefilled from a voucher order: guest on the
       first held bed, and one unnamed-guest card per companion on the
       other held beds, same time and service. Saving marks the request
       converted (see markVoucherRequestPlotted) — cancelling leaves it
       pending until its hold runs out. */
    async function plotVoucherRequest(request){
        const hold = request.paydayHold || {};
        const beds = Array.isArray(hold.beds) && hold.beds.length > 0 ? hold.beds.map(Number) : [];
        const startTime = hold.startTime || "";

        await showRequestDate(request, true);

        if(!startTime || beds.length === 0){
            alert("This request has no held bed/time to plot. Use View Date and place it manually.");
            return;
        }

        openNewModal(beds[0], startTime);

        if(document.getElementById("paydayModalBackdrop").classList.contains("d-none")){
            return;
        }

        pendingVoucherRequestId = request.id;

        document.getElementById("paydayModalClient").value = request.clientName || "";
        document.getElementById("paydayModalMobile").value = request.mobile || "";
        document.getElementById("paydayModalEmail").value = request.email || "";
        document.getElementById("paydayModalNotes").value =
            String(request.notes || "").replace(PROMO_TAG, "").trim();

        resetModalServices(request.serviceName ? [request.serviceName] : []);

        modalCompanions = beds.slice(1).map(function(bed, index){
            return {
                id: createId(),
                name: (request.clientName || "Guest") + " – Companion " + (index + 1),
                therapist: "",
                bed: String(bed),
                startTime: startTime,
                services: [{ id: createId(), name: request.serviceName || "" }]
            };
        });

        renderCompanions();
        updateCompanionOfHints();
        updateModalPreview();
    }

    async function markVoucherRequestPlotted(requestId, slotId){
        try{
            await db().collection("bookingRequests").doc(requestId).update({
                status: "converted",
                reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                reviewedBy: currentUserAccount(),
                convertedScheduleId: slotId
            });
        }catch(error){
            console.error("Unable to mark voucher request plotted:", error);
            alert(
                "The slot was saved, but the voucher request couldn't be marked as plotted " +
                "(someone may have already handled it). It will expire on its own."
            );
        }
    }

    /* ---- Block this date ---- */

    function renderBlockDateControl(doc){
        const checkbox = document.getElementById("blockDateCheckbox");
        const reasonInput = document.getElementById("blockDateReasonInput");

        if(!doc){
            checkbox.checked = false;
            checkbox.disabled = true;
            reasonInput.value = "";
            reasonInput.disabled = true;
            return;
        }

        checkbox.disabled = false;
        checkbox.checked = !!doc.blocked;
        reasonInput.disabled = !doc.blocked;
        reasonInput.value = doc.blockReason || "";
    }

    function toggleBlockDate(){
        const checkbox = document.getElementById("blockDateCheckbox");

        if(!currentDoc){
            checkbox.checked = false;
            return;
        }

        currentDoc.blocked = checkbox.checked;

        if(checkbox.checked){
            currentDoc.blockReason = "";
            currentDoc.blockedBy = currentUserAccount();
            currentDoc.blockedAt = new Date().toISOString();
        }else{
            currentDoc.blockReason = "";
            currentDoc.blockedBy = "";
            currentDoc.blockedAt = null;
        }

        saveCurrentDoc().then(function(){
            renderBlockDateControl(currentDoc);

            if(checkbox.checked){
                document.getElementById("blockDateReasonInput").focus();
            }
        });
    }

    function updateBlockDateReason(){
        if(!currentDoc || !currentDoc.blocked){
            return;
        }

        currentDoc.blockReason = document.getElementById("blockDateReasonInput").value.trim();
        saveCurrentDoc();
    }
})();
