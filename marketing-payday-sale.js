/* ==========================================================================
   Crown Head Spa — Marketing / Payday Sale

   Data model (Firestore):
     paydaySale/{branchSlug_date}
       branch, date ("YYYY-MM-DD"),
       blocked, blockReason, blockedBy, blockedAt,
       beds: { "<bedNumber>": { available, from ("HH:MM"), to ("HH:MM") } },
       slots: [{ id, bed, startTime, endTime, note, createdBy, createdAt }],
       updatedBy, updatedAt

   One doc per branch per day — mirrors how scheduling.js keeps one
   crownSchedule_<branch>_<date> bucket per branch/day, just as a native
   Firestore doc (Pattern B — direct collection, like the other
   marketing-* pages) instead of the appData localStorage mirror. This
   page is intentionally NOT wired to scheduling.js/crownSchedule_* —
   it's a separate, marketing-controlled availability set meant to be
   read later by the public website (same idea as crownBlockedDates /
   crownUnavailableBeds today, just for the Payday Sale campaign).
   ========================================================================== */

(function(){
    const COLLECTION = "paydaySale";
    const BRANCH_MASTER_KEY = "crownBranchMasterList";
    const SELECTED_BRANCH_KEY = "crownSelectedBranch";
    const SCHEDULE_PX_PER_MINUTE = 1.5;
    const SCHEDULE_PX_PER_HOUR = SCHEDULE_PX_PER_MINUTE * 60;

    let currentDoc = null;
    let selectedBed = null;
    let selectedSlotId = null;

    document.addEventListener("DOMContentLoaded", function(){
        initializeDate();
        loadBranchOptions();
        attachEvents();
        renderPaydaySale();
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

        document.getElementById("closePaydayModalBtn").addEventListener("click", closeModal);
        document.getElementById("cancelPaydayModalBtn").addEventListener("click", closeModal);
        document.getElementById("savePaydayModalBtn").addEventListener("click", saveSlot);
        document.getElementById("deletePaydaySlotBtn").addEventListener("click", deleteSlot);

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

    /* ---- Date / branch helpers (same conventions as scheduling.js) ---- */

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

    function docId(branchName, date){
        const slug = String(branchName || "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

        return slug + "_" + date;
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

                /* Merge saved bed entries over the branch's current bed
                   count/defaults, so a branch that gained beds since this
                   doc was last saved still shows the new columns. */
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
            .catch(function(error){
                console.error("Unable to save Payday Sale doc:", error);
                showModalMessage("Could not save — check your connection and try again.");
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

        loadCurrentDoc().then(function(){
            emptyState.classList.add("d-none");
            wrapper.classList.remove("d-none");

            document.getElementById("bedCount").textContent = branch.beds;
            document.getElementById("operatingHours").textContent =
                formatTimeRange(branch.openingTime, branch.closingTime);

            document.getElementById("slotCount").textContent = currentDoc.slots.length;

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

            const bedSlots = currentDoc.slots.filter(function(slot){
                return Number(slot.bed) === bed;
            });

            col.addEventListener("click", function(event){
                if(bedIsUnavailable){
                    return;
                }

                const rect = col.getBoundingClientRect();
                const offsetY = event.clientY - rect.top;
                const rawMinutes = opening + Math.floor(offsetY / SCHEDULE_PX_PER_MINUTE);
                const slotStart = Math.floor(rawMinutes / 10) * 10;

                const occupied = bedSlots.some(function(slot){
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
                button.className = "appointment-card";
                button.style.top = ((clampedStart - opening) * SCHEDULE_PX_PER_MINUTE) + "px";
                button.style.height = ((clampedEnd - clampedStart) * SCHEDULE_PX_PER_MINUTE) + "px";
                button.title =
                    "Payday Sale — " + formatTimeRange(slot.startTime, slot.endTime) +
                    (slot.note ? " (" + slot.note + ")" : "");

                button.innerHTML = `
                    <strong>Payday Sale</strong>
                    <small>${formatTimeRange(slot.startTime, slot.endTime)}</small>
                    ${slot.note ? `<span>${escapeHtml(slot.note)}</span>` : ""}
                `;

                button.addEventListener("click", function(event){
                    event.stopPropagation();
                    openEditModal(slot.id);
                });

                col.appendChild(button);
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

    /* ---- Add / edit / delete slot modal ---- */

    function showModalMessage(message){
        const el = document.getElementById("paydayModalMessage");

        if(!message){
            el.classList.add("d-none");
            el.textContent = "";
            return;
        }

        el.textContent = message;
        el.classList.remove("d-none");
    }

    function openNewModal(bed, startTime){
        selectedBed = bed;
        selectedSlotId = null;

        document.getElementById("paydayModalModeLabel").textContent = "New Sale Slot";
        document.getElementById("paydayModalTitle").textContent = "Add Payday Sale Slot";
        document.getElementById("paydaySelectedSlotLabel").textContent = "Bed " + bed;

        document.getElementById("paydaySlotStartTime").value = startTime;
        document.getElementById("paydaySlotEndTime").value =
            minutesToTimeValue(Math.min(timeToMinutes(startTime) + 60, 23 * 60 + 59));

        document.getElementById("paydaySlotNote").value = "";
        document.getElementById("deletePaydaySlotBtn").classList.add("d-none");
        showModalMessage("");

        document.getElementById("paydayModalBackdrop").classList.remove("d-none");
    }

    function openEditModal(slotId){
        const slot = currentDoc.slots.find(function(item){ return item.id === slotId; });

        if(!slot){
            return;
        }

        selectedBed = slot.bed;
        selectedSlotId = slot.id;

        document.getElementById("paydayModalModeLabel").textContent = "Edit Sale Slot";
        document.getElementById("paydayModalTitle").textContent = "Edit Payday Sale Slot";
        document.getElementById("paydaySelectedSlotLabel").textContent = "Bed " + slot.bed;

        document.getElementById("paydaySlotStartTime").value = slot.startTime;
        document.getElementById("paydaySlotEndTime").value = slot.endTime;
        document.getElementById("paydaySlotNote").value = slot.note || "";
        document.getElementById("deletePaydaySlotBtn").classList.remove("d-none");
        showModalMessage("");

        document.getElementById("paydayModalBackdrop").classList.remove("d-none");
    }

    function closeModal(){
        document.getElementById("paydayModalBackdrop").classList.add("d-none");
        selectedBed = null;
        selectedSlotId = null;
    }

    function saveSlot(){
        const startTime = document.getElementById("paydaySlotStartTime").value;
        const endTime = document.getElementById("paydaySlotEndTime").value;
        const note = document.getElementById("paydaySlotNote").value.trim();

        if(!startTime || !endTime){
            showModalMessage("Start and end time are required.");
            return;
        }

        if(timeToMinutes(endTime) <= timeToMinutes(startTime)){
            showModalMessage("End time must be after start time.");
            return;
        }

        const overlaps = currentDoc.slots.some(function(slot){
            return (
                Number(slot.bed) === Number(selectedBed) &&
                slot.id !== selectedSlotId &&
                timeToMinutes(startTime) < timeToMinutes(slot.endTime) &&
                timeToMinutes(endTime) > timeToMinutes(slot.startTime)
            );
        });

        if(overlaps){
            showModalMessage("This bed already has a sale slot overlapping this time.");
            return;
        }

        if(selectedSlotId){
            currentDoc.slots = currentDoc.slots.map(function(slot){
                return slot.id === selectedSlotId
                    ? Object.assign({}, slot, { startTime, endTime, note })
                    : slot;
            });
        }else{
            currentDoc.slots.push({
                id: createId(),
                bed: selectedBed,
                startTime: startTime,
                endTime: endTime,
                note: note,
                createdBy: currentUserAccount(),
                createdAt: new Date().toISOString()
            });
        }

        saveCurrentDoc().then(function(){
            closeModal();
            document.getElementById("slotCount").textContent = currentDoc.slots.length;
            renderBody(getSelectedBranch());
        });
    }

    function deleteSlot(){
        if(!selectedSlotId){
            return;
        }

        if(!confirm("Remove this Payday Sale slot?")){
            return;
        }

        currentDoc.slots = currentDoc.slots.filter(function(slot){
            return slot.id !== selectedSlotId;
        });

        saveCurrentDoc().then(function(){
            closeModal();
            document.getElementById("slotCount").textContent = currentDoc.slots.length;
            renderBody(getSelectedBranch());
        });
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
