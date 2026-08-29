/* ==========================================================================
   Crown Head Spa — Staff Schedule (Admin Hub)

   Weekly duty-roster grid, one Firestore doc per (branch, week) in
   collection "staffScheduleGrids":
     {
       branch, weekStartDate, label,
       opening: { receptionist: {mon..sun}, therapists: [{mon..sun}, ...] },
       closing: { receptionist: {mon..sun}, therapists: [{mon..sun}, ...] },
       restDay: [{mon..sun}, ...],
       notes
     }
   Each day cell holds a staff account (or ""). The page shows only the
   CURRENT week's schedule by default; "History" lists past weeks
   (read-only), "Upcoming" lists future weeks that already have a
   generated schedule (each editable), and "Create Schedule" opens a blank
   week to generate one. Admin/Executive Assistant/teamLeader accounts
   edit; Therapist accounts get a read-only list of just their own
   assignments for the week, plus a shared "On Leave This Week" strip fed
   by the "staffSchedules" collection (see leave-requests.js, which writes
   source:"leave" entries there on Leave Request approval).
   ========================================================================== */

(function(){
    const GRID_COLLECTION = "staffScheduleGrids";
    const LEAVE_COLLECTION = "staffSchedules";

    const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const DAY_LABELS = ["MON", "TUE", "WED", "THURS", "FRI", "SAT", "SUN"];

    const CURRENT_IDS = { opening: "scheduleCurrentOpeningTable", closing: "scheduleCurrentClosingTable", rest: "scheduleCurrentRestTable", notes: "scheduleCurrentNotesTable" };
    const VIEW_IDS = { opening: "scheduleViewOpeningTable", closing: "scheduleViewClosingTable", rest: "scheduleViewRestTable", notes: "scheduleViewNotesTable" };
    const EDIT_IDS = { opening: "scheduleEditOpeningTable", closing: "scheduleEditClosingTable", rest: "scheduleEditRestTable", notes: "scheduleEditNotesTable" };

    let currentUser = null;
    let effectiveRole = null;
    let canEdit = false;
    let usersByAccount = {};

    let branchUnsubscribe = null;
    let branchGridsCache = [];
    let editState = null;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function toDateValue(date){
        return date.getFullYear() + "-" +
            String(date.getMonth() + 1).padStart(2, "0") + "-" +
            String(date.getDate()).padStart(2, "0");
    }

    function todayValue(){
        return toDateValue(new Date());
    }

    function mondayOf(dateValue){
        const date = new Date(dateValue + "T00:00:00");
        const day = date.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        date.setDate(date.getDate() + diff);
        return toDateValue(date);
    }

    function addDays(dateValue, days){
        const date = new Date(dateValue + "T00:00:00");
        date.setDate(date.getDate() + days);
        return toDateValue(date);
    }

    function weekDates(weekStart){
        return DAY_KEYS.map(function(_, i){ return addDays(weekStart, i); });
    }

    /* ISO-8601 week number (Mon-Sun weeks, week 1 = the week containing
       the year's first Thursday). */
    function isoWeekOf(weekStart){
        const date = new Date(weekStart + "T00:00:00");
        date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));

        const firstThursday = new Date(date.getFullYear(), 0, 4);
        firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));

        return 1 + Math.round((date - firstThursday) / (7 * 24 * 60 * 60 * 1000));
    }

    function formatDayDate(dateValue){
        try{
            return new Date(dateValue + "T00:00:00")
                .toLocaleDateString("en-PH", { month: "short", day: "numeric" });
        }catch(error){
            return "";
        }
    }

    function formatWeekRange(weekStart){
        const dates = weekDates(weekStart);
        return formatDayDate(dates[0]) + " – " + formatDayDate(dates[6]);
    }

    function slug(value){
        return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    function gridDocId(branch, weekStart){
        return slug(branch) + "_" + weekStart;
    }

    function emptyDayMap(){
        const map = {};
        DAY_KEYS.forEach(function(d){ map[d] = ""; });
        return map;
    }

    function emptyGrid(branch, weekStart){
        return {
            branch,
            weekStartDate: weekStart,
            opening: { receptionist: emptyDayMap(), therapists: [emptyDayMap()] },
            closing: { receptionist: emptyDayMap(), therapists: [emptyDayMap()] },
            restDay: [emptyDayMap()],
            notes: ""
        };
    }

    function normalizeGrid(grid){
        if(!grid.opening){ grid.opening = { receptionist: emptyDayMap(), therapists: [emptyDayMap()] }; }
        if(!grid.closing){ grid.closing = { receptionist: emptyDayMap(), therapists: [emptyDayMap()] }; }
        if(grid.restDay && !Array.isArray(grid.restDay)){ grid.restDay = [grid.restDay]; }
        if(!Array.isArray(grid.restDay) || grid.restDay.length === 0){ grid.restDay = [emptyDayMap()]; }
        if(!Array.isArray(grid.opening.therapists) || grid.opening.therapists.length === 0){ grid.opening.therapists = [emptyDayMap()]; }
        if(!Array.isArray(grid.closing.therapists) || grid.closing.therapists.length === 0){ grid.closing.therapists = [emptyDayMap()]; }
        return grid;
    }

    function staffOptionsHtml(branch, selected){
        const users = Object.values(usersByAccount)
            .filter(function(u){
                return u.status === "Active" &&
                    (u.role === "Receptionist" || u.role === "Therapist" || u.role === "Executive Assistant") &&
                    (!branch || (Array.isArray(u.branches) && u.branches.includes(branch)));
            })
            .sort(function(a, b){
                return (a.nickname || a.account).localeCompare(b.nickname || b.account);
            });

        return '<option value="">—</option>' + users.map(function(u){
            return `<option value="${escapeHtml(u.account)}" ${u.account === selected ? "selected" : ""}>${escapeHtml(u.nickname || u.account)}</option>`;
        }).join("");
    }

    function staffLabel(account){
        const u = usersByAccount[account];
        return u ? (u.nickname || u.account) : "";
    }

    function dayCells(branch, dayMap, rowPath, editable){
        return DAY_KEYS.map(function(day){
            const value = dayMap?.[day] || "";

            if(editable){
                return `<td class="schedule-cell"><select data-path="${rowPath}" data-day="${day}">${staffOptionsHtml(branch, value)}</select></td>`;
            }

            return `<td class="schedule-cell">${escapeHtml(staffLabel(value))}</td>`;
        }).join("");
    }

    function dayHeaderRow(weekStart, extraCol){
        const dates = weekDates(weekStart);

        return "<tr><th class=\"schedule-row-label\"></th>" +
            DAY_LABELS.map(function(d, i){
                return `<th class="schedule-day-header">${d}<br><span class="schedule-day-date">${escapeHtml(formatDayDate(dates[i]))}</span></th>`;
            }).join("") +
            (extraCol ? "<th class=\"schedule-remove-col\"></th>" : "") +
            "</tr>";
    }

    function buildSectionTable(section, sectionKey, branch, editable, weekStart){
        let html = `<colgroup><col class="schedule-label-col">${DAY_KEYS.map(function(){ return "<col>"; }).join("")}${editable ? '<col class="schedule-remove-col">' : ""}</colgroup>`;
        html += `<tr><th colspan="${editable ? 9 : 8}" class="schedule-section-title">${sectionKey.toUpperCase()}</th></tr>`;
        html += dayHeaderRow(weekStart, editable);

        html += `<tr><td class="schedule-row-label">Receptionist</td>${dayCells(branch, section.receptionist, sectionKey + ".receptionist", editable)}${editable ? '<td class="schedule-remove-col"></td>' : ""}</tr>`;

        (section.therapists || []).forEach(function(row, i){
            const label = section.therapists.length > 1 ? "Therapist " + (i + 1) : "Therapist";
            const removeCell = editable
                ? `<td class="schedule-remove-col">${section.therapists.length > 1 ? `<button type="button" class="schedule-row-remove-btn" data-section="${sectionKey}" data-index="${i}" title="Remove this row">&times;</button>` : ""}</td>`
                : "";

            html += `<tr><td class="schedule-row-label">${escapeHtml(label)}</td>${dayCells(branch, row, sectionKey + ".therapists." + i, editable)}${removeCell}</tr>`;
        });

        return html;
    }

    function buildRestTableRows(grid, branch, editable){
        return (grid.restDay || []).map(function(row, i){
            const removeCell = editable
                ? `<td class="schedule-remove-col">${grid.restDay.length > 1 ? `<button type="button" class="schedule-row-remove-btn" data-section="rest" data-index="${i}" title="Remove this row">&times;</button>` : ""}</td>`
                : "";

            return `<tr><td class="schedule-row-label"></td>${dayCells(branch, row, "restDay." + i, editable)}${removeCell}</tr>`;
        }).join("");
    }

    function buildNotesTable(grid, editable){
        let html = `<colgroup><col></colgroup>`;
        html += `<tr><th class="schedule-section-title">NOTES</th></tr>`;

        html += editable
            ? `<tr><td class="schedule-notes-cell"><textarea rows="2" id="scheduleNotesFieldInput">${escapeHtml(grid.notes || "")}</textarea></td></tr>`
            : `<tr><td class="schedule-notes-cell"><span>${escapeHtml(grid.notes || "")}</span></td></tr>`;

        return html;
    }

    function renderTablesInto(ids, grid, branch, weekStart, editable){
        document.getElementById(ids.opening).innerHTML = buildSectionTable(grid.opening, "opening", branch, editable, weekStart);
        document.getElementById(ids.closing).innerHTML = buildSectionTable(grid.closing, "closing", branch, editable, weekStart);

        document.getElementById(ids.rest).innerHTML =
            `<colgroup><col class="schedule-label-col">${DAY_KEYS.map(function(){ return "<col>"; }).join("")}${editable ? '<col class="schedule-remove-col">' : ""}</colgroup>` +
            `<tr><th colspan="${editable ? 9 : 8}" class="schedule-section-title">REST DAY</th></tr>` +
            dayHeaderRow(weekStart, editable) +
            buildRestTableRows(grid, branch, editable);

        document.getElementById(ids.notes).innerHTML = buildNotesTable(grid, editable);
    }

    /* ---- Current week card ---- */

    function renderCurrentCard(){
        const branch = document.getElementById("scheduleBranchSelect").value;
        const weekStart = mondayOf(todayValue());
        const grid = branchGridsCache.find(function(g){ return g.weekStartDate === weekStart; });

        document.getElementById("scheduleTitleBand").textContent =
            (branch ? branch + " " : "") + "Weekly Schedule - Week " + isoWeekOf(weekStart);

        if(!grid){
            document.getElementById("scheduleCurrentGrid").classList.add("d-none");
            document.getElementById("scheduleCurrentEmpty").classList.remove("d-none");
            return;
        }

        normalizeGrid(grid);
        document.getElementById("scheduleCurrentGrid").classList.remove("d-none");
        document.getElementById("scheduleCurrentEmpty").classList.add("d-none");
        renderTablesInto(CURRENT_IDS, grid, branch, weekStart, false);
        document.getElementById("scheduleCurrentEditWrap").classList.toggle("d-none", !canEdit);
    }

    /* ---- History / Upcoming lists ---- */

    function renderWeekList(containerId, emptyId, grids, actionLabel){
        const container = document.getElementById(containerId);
        const empty = document.getElementById(emptyId);

        if(grids.length === 0){
            container.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        container.innerHTML = grids.map(function(g){
            return `
                <div class="schedule-week-item">
                    <div>
                        <span class="schedule-week-item-label">Week ${isoWeekOf(g.weekStartDate)}</span>
                        <span class="schedule-week-item-range">${escapeHtml(formatWeekRange(g.weekStartDate))}</span>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-primary schedule-week-action-btn" data-week="${escapeHtml(g.weekStartDate)}">${actionLabel}</button>
                </div>
            `;
        }).join("");
    }

    function renderHistoryAndUpcoming(){
        const currentMonday = mondayOf(todayValue());

        const history = branchGridsCache
            .filter(function(g){ return g.weekStartDate < currentMonday; })
            .sort(function(a, b){ return b.weekStartDate.localeCompare(a.weekStartDate); });

        const upcoming = branchGridsCache
            .filter(function(g){ return g.weekStartDate > currentMonday; })
            .sort(function(a, b){ return a.weekStartDate.localeCompare(b.weekStartDate); });

        renderWeekList("scheduleHistoryList", "scheduleHistoryEmpty", history, "View");
        renderWeekList("scheduleUpcomingList", "scheduleUpcomingEmpty", upcoming, canEdit ? "Edit Schedule" : "View");
    }

    /* ---- View (read-only) modal ---- */

    function openViewModal(weekStart){
        const grid = branchGridsCache.find(function(g){ return g.weekStartDate === weekStart; });

        if(!grid){
            return;
        }

        normalizeGrid(grid);
        document.getElementById("scheduleViewModalTitle").textContent = "Week " + isoWeekOf(weekStart) + " (" + formatWeekRange(weekStart) + ")";
        renderTablesInto(VIEW_IDS, grid, grid.branch, weekStart, false);
        document.getElementById("scheduleViewBackdrop").classList.remove("d-none");
    }

    /* ---- View Today's Schedule modal ---- */

    /* Monday-first day key for "today", independent of the Sunday-first
       index Date.getDay() returns. */
    function todayDayKey(){
        const jsDay = new Date().getDay();
        return DAY_KEYS[jsDay === 0 ? 6 : jsDay - 1];
    }

    /* Every staff account on duty today (opening/closing/rest), collapsed
       into a flat "Role — Name" list — the weekly grid is too wide to
       screenshot cleanly on a phone, so Team Leaders get just today's
       slice in a single-column list they can capture and post to the
       staff group chat. */
    function collectTodayItems(grid, day){
        const items = [];

        ["opening", "closing"].forEach(function(sectionKey){
            const section = grid[sectionKey];

            if(!section){
                return;
            }

            const label = sectionKey === "opening" ? "Opening" : "Closing";

            if(section.receptionist?.[day]){
                items.push({ role: label + " — Receptionist", name: staffLabel(section.receptionist[day]) });
            }

            (section.therapists || []).forEach(function(row, i){
                if(row[day]){
                    const therapistLabel = section.therapists.length > 1 ? "Therapist " + (i + 1) : "Therapist";
                    items.push({ role: label + " — " + therapistLabel, name: staffLabel(row[day]) });
                }
            });
        });

        (Array.isArray(grid.restDay) ? grid.restDay : (grid.restDay ? [grid.restDay] : [])).forEach(function(row){
            if(row[day]){
                items.push({ role: "Rest Day", name: staffLabel(row[day]) });
            }
        });

        return items;
    }

    function openTodayModal(){
        const branch = document.getElementById("scheduleBranchSelect").value;
        const weekStart = mondayOf(todayValue());
        const grid = branchGridsCache.find(function(g){ return g.weekStartDate === weekStart; });

        const today = new Date();
        const dateLabel = today.toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric" });
        document.getElementById("scheduleTodayModalTitle").textContent =
            (branch ? branch + " — " : "") + "Today's Schedule (" + dateLabel + ")";

        const body = document.getElementById("scheduleTodayBody");
        const empty = document.getElementById("scheduleTodayEmpty");

        if(!grid){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            document.getElementById("scheduleTodayBackdrop").classList.remove("d-none");
            return;
        }

        normalizeGrid(grid);
        const items = collectTodayItems(grid, todayDayKey());

        let html = "";

        if(items.length > 0){
            html += '<div class="schedule-today-section-heading">On Duty Today</div>';
            html += items.map(function(item){
                return `
                    <div class="schedule-today-item">
                        <span class="schedule-today-item-role">${escapeHtml(item.role)}</span>
                        <span class="schedule-today-item-name">${escapeHtml(item.name)}</span>
                    </div>
                `;
            }).join("");
        }

        if(items.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
        }else{
            body.innerHTML = html;
            empty.classList.add("d-none");
        }

        document.getElementById("scheduleTodayBackdrop").classList.remove("d-none");
    }

    /* ---- Create / Edit modal ---- */

    /* Weeks selectable from Create Schedule: the current week plus the
       next 25 (about half a year), each labeled by ISO week number with
       its Monday–Sunday date range spelled out so there's no ambiguity
       about which calendar week "Week 35" refers to. */
    function buildWeekOptions(selectedWeekStart){
        const start = mondayOf(todayValue());

        let html = "";

        for(let i = 0; i < 26; i++){
            const weekStart = addDays(start, i * 7);
            html += `<option value="${escapeHtml(weekStart)}" ${weekStart === selectedWeekStart ? "selected" : ""}>Week ${isoWeekOf(weekStart)} (${escapeHtml(formatWeekRange(weekStart))})</option>`;
        }

        return html;
    }

    function renderEditModal(){
        const titleEl = document.getElementById("scheduleEditModalTitle");
        const weekInput = document.getElementById("scheduleEditWeekInput");

        titleEl.textContent = editState.mode === "create"
            ? "Create Schedule"
            : "Edit Schedule — Week " + isoWeekOf(editState.weekStart);

        if(editState.mode === "create"){
            weekInput.innerHTML = buildWeekOptions(editState.weekStart);
            weekInput.disabled = false;
        }else{
            weekInput.innerHTML = `<option value="${escapeHtml(editState.weekStart)}" selected>Week ${isoWeekOf(editState.weekStart)} (${escapeHtml(formatWeekRange(editState.weekStart))})</option>`;
            weekInput.disabled = true;
        }

        document.getElementById("scheduleEditClearBtn").classList.toggle("d-none", editState.mode !== "edit");
        document.getElementById("scheduleEditSubmitBtn").textContent = editState.mode === "create" ? "Generate Schedule" : "Save Schedule";

        renderTablesInto(EDIT_IDS, editState.grid, editState.branch, editState.weekStart, true);
    }

    function openEditModal(mode, weekStart, existingGrid){
        const branch = document.getElementById("scheduleBranchSelect").value;

        editState = {
            mode,
            branch,
            weekStart,
            grid: normalizeGrid(existingGrid ? JSON.parse(JSON.stringify(existingGrid)) : emptyGrid(branch, weekStart))
        };

        renderEditModal();
        document.getElementById("scheduleEditBackdrop").classList.remove("d-none");
    }

    function closeEditModal(){
        editState = null;
        document.getElementById("scheduleEditBackdrop").classList.add("d-none");
    }

    /* Reads whatever is currently on the edit form back into
       editState.grid before a structural change (add/remove row)
       re-renders the table, so in-progress edits on other rows aren't
       lost. */
    function captureEditFormIntoGrid(){
        if(!editState){
            return;
        }

        document.querySelectorAll("#scheduleEditBackdrop [data-path]").forEach(function(field){
            const path = field.dataset.path.split(".");
            const day = field.dataset.day;

            if(path[0] === "restDay"){
                editState.grid.restDay[Number(path[1])][day] = field.value.trim();
                return;
            }

            const section = editState.grid[path[0]];

            if(path[1] === "receptionist"){
                section.receptionist[day] = field.value.trim();
            }else if(path[1] === "therapists"){
                section.therapists[Number(path[2])][day] = field.value.trim();
            }
        });

        const notesField = document.getElementById("scheduleNotesFieldInput");

        if(notesField){
            editState.grid.notes = notesField.value.trim();
        }
    }

    /* Delegated so add/remove-row handlers are wired exactly once
       regardless of how many times the edit modal re-renders — the
       "+ Add Therapist" buttons live in static HTML outside the tables'
       innerHTML, so attaching a fresh listener on every render stacked up
       duplicate handlers in an earlier version of this page. */
    function wireDelegatedHandlersOnce(){
        document.addEventListener("click", function(event){
            if(!editState){
                return;
            }

            const removeBtn = event.target.closest(".schedule-row-remove-btn");

            if(removeBtn && event.target.closest("#scheduleEditBackdrop")){
                captureEditFormIntoGrid();
                const removeRows = removeBtn.dataset.section === "rest" ? editState.grid.restDay : editState.grid[removeBtn.dataset.section].therapists;
                removeRows.splice(Number(removeBtn.dataset.index), 1);
                renderEditModal();
                return;
            }

            const addBtn = event.target.closest(".schedule-add-link");

            if(addBtn && event.target.closest("#scheduleEditBackdrop")){
                captureEditFormIntoGrid();
                const addRows = addBtn.dataset.section === "rest" ? editState.grid.restDay : editState.grid[addBtn.dataset.section].therapists;
                addRows.push(emptyDayMap());
                renderEditModal();
            }
        });
    }

    /* ---- On Leave this week ---- */

    function renderLeaveThisWeek(weekStart){
        const dates = weekDates(weekStart);

        /* Filtered client-side by date (rather than a Firestore "in" query)
           to avoid needing a composite index on (source, date), matching
           this codebase's usual equality-filter-then-sort-client-side
           convention (see booking-requests.js). */
        firebase.firestore()
            .collection(LEAVE_COLLECTION)
            .where("source", "==", "leave")
            .get()
            .then(function(snapshot){
                const entries = snapshot.docs
                    .map(function(doc){ return doc.data(); })
                    .filter(function(e){ return dates.includes(e.date); });

                const card = document.getElementById("scheduleLeaveCard");
                const list = document.getElementById("scheduleLeaveList");

                if(entries.length === 0){
                    card.classList.add("d-none");
                    return;
                }

                card.classList.remove("d-none");

                const byStaff = {};
                entries.forEach(function(e){
                    byStaff[e.staffName] = byStaff[e.staffName] || [];
                    byStaff[e.staffName].push(e.date);
                });

                list.innerHTML = Object.keys(byStaff).map(function(name){
                    return `<span class="schedule-leave-chip">${escapeHtml(name)} (${byStaff[name].length} day${byStaff[name].length > 1 ? "s" : ""})</span>`;
                }).join("");
            })
            .catch(function(error){
                console.error("Unable to load leave entries for this week:", error);
            });
    }

    /* ---- Therapist's own week ---- */

    function collectOwnItems(grid){
        const items = [];

        ["opening", "closing"].forEach(function(sectionKey){
            const section = grid[sectionKey];

            if(!section){
                return;
            }

            DAY_KEYS.forEach(function(day, i){
                if(section.receptionist?.[day] === currentUser.account){
                    items.push({ day: DAY_LABELS[i], role: (sectionKey === "opening" ? "Opening" : "Closing") + " — Receptionist" });
                }
            });

            (section.therapists || []).forEach(function(row){
                DAY_KEYS.forEach(function(day, i){
                    if(row[day] === currentUser.account){
                        items.push({ day: DAY_LABELS[i], role: (sectionKey === "opening" ? "Opening" : "Closing") + " — Therapist" });
                    }
                });
            });
        });

        (Array.isArray(grid.restDay) ? grid.restDay : (grid.restDay ? [grid.restDay] : [])).forEach(function(row){
            DAY_KEYS.forEach(function(day, i){
                if(row[day] === currentUser.account){
                    items.push({ day: DAY_LABELS[i], role: "Rest Day" });
                }
            });
        });

        return items;
    }

    function renderOwnWeek(weekStart){
        const branches = window.CrownAuth?.getAllowedBranches?.(currentUser) || [];

        const queries = branches.map(function(branch){
            return firebase.firestore()
                .collection(GRID_COLLECTION)
                .doc(gridDocId(branch, weekStart))
                .get();
        });

        Promise.all(queries).then(function(docs){
            const items = [];

            docs.forEach(function(doc){
                if(doc.exists){
                    items.push.apply(items, collectOwnItems(doc.data()));
                }
            });

            const list = document.getElementById("scheduleOwnList");
            const empty = document.getElementById("scheduleOwnEmpty");

            if(items.length === 0){
                list.innerHTML = "";
                empty.classList.remove("d-none");
                return;
            }

            empty.classList.add("d-none");

            list.innerHTML = items.map(function(item){
                return `
                    <div class="schedule-own-item">
                        <span class="schedule-own-item-day">${escapeHtml(item.day)}</span>
                        <span class="schedule-own-item-role">${escapeHtml(item.role)}</span>
                    </div>
                `;
            }).join("");
        }).catch(function(error){
            console.error("Unable to load your schedule:", error);
        });
    }

    /* Every future week (across this therapist's allowed branches) that
       already has a generated schedule containing at least one of their
       own assignments — same "Upcoming" concept as the Admin/EA/Team
       Leader view, but scoped to just this person, with no edit access
       and no visibility into anyone else's roster. */
    function renderOwnUpcoming(){
        const currentMonday = mondayOf(todayValue());
        const branches = window.CrownAuth?.getAllowedBranches?.(currentUser) || [];

        const queries = branches.map(function(branch){
            return firebase.firestore()
                .collection(GRID_COLLECTION)
                .where("branch", "==", branch)
                .get();
        });

        Promise.all(queries).then(function(snapshots){
            const weeks = [];

            snapshots.forEach(function(snapshot){
                snapshot.docs.forEach(function(doc){
                    const grid = doc.data();

                    if(grid.weekStartDate <= currentMonday){
                        return;
                    }

                    const items = collectOwnItems(normalizeGrid(grid));

                    if(items.length > 0){
                        weeks.push({ weekStartDate: grid.weekStartDate, items });
                    }
                });
            });

            weeks.sort(function(a, b){ return a.weekStartDate.localeCompare(b.weekStartDate); });

            const list = document.getElementById("scheduleOwnUpcomingList");
            const empty = document.getElementById("scheduleOwnUpcomingEmpty");

            if(weeks.length === 0){
                list.innerHTML = "";
                empty.classList.remove("d-none");
                return;
            }

            empty.classList.add("d-none");

            list.innerHTML = weeks.map(function(week){
                const rows = week.items.map(function(item){
                    return `
                        <div class="schedule-own-item">
                            <span class="schedule-own-item-day">${escapeHtml(item.day)}</span>
                            <span class="schedule-own-item-role">${escapeHtml(item.role)}</span>
                        </div>
                    `;
                }).join("");

                return `
                    <div class="schedule-own-week-heading">Week ${isoWeekOf(week.weekStartDate)} (${escapeHtml(formatWeekRange(week.weekStartDate))})</div>
                    <div class="schedule-own-list mb-3">${rows}</div>
                `;
            }).join("");
        }).catch(function(error){
            console.error("Unable to load your upcoming schedule:", error);
        });
    }

    /* ---- Branch data listener (Admin / Executive Assistant / Team Leader) ---- */

    function startBranchListener(){
        if(branchUnsubscribe){
            branchUnsubscribe();
            branchUnsubscribe = null;
        }

        const branch = document.getElementById("scheduleBranchSelect").value;
        branchGridsCache = [];

        if(!branch){
            renderCurrentCard();
            renderHistoryAndUpcoming();
            return;
        }

        branchUnsubscribe = firebase.firestore()
            .collection(GRID_COLLECTION)
            .where("branch", "==", branch)
            .onSnapshot(function(snapshot){
                branchGridsCache = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });

                renderCurrentCard();
                renderHistoryAndUpcoming();
            }, function(error){
                console.error("Unable to load staff schedules:", error);
            });

        renderLeaveThisWeek(mondayOf(todayValue()));
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        effectiveRole = window.CrownAuth?.getEffectiveRole?.(currentUser) || currentUser.role;

        canEdit = currentUser.role === "Admin" ||
            currentUser.role === "Executive Assistant" ||
            currentUser.teamLeader === true;

        (window.CrownAuth?.getUsers?.() || []).forEach(function(u){
            usersByAccount[u.account] = u;
        });

        /* A Team Leader is a Therapist account with the teamLeader flag
           set (canEdit true) — they get the full Admin/EA grid view
           below, not this read-only own-schedule view, which is only for
           plain Therapist/Receptionist accounts. */
        if(effectiveRole === "Therapist" && !canEdit){
            document.getElementById("scheduleOwnCard").classList.remove("d-none");
            document.getElementById("staffSchedulePageSubtitle").textContent = "Your duty schedule for the week.";

            const weekInput = document.getElementById("scheduleOwnWeekInput");
            weekInput.innerHTML = buildWeekOptions(mondayOf(todayValue()));

            function refreshOwn(){
                renderOwnWeek(weekInput.value);
            }

            weekInput.addEventListener("change", refreshOwn);

            document.getElementById("scheduleOwnUpcomingToggle").addEventListener("click", function(){
                const body = document.getElementById("scheduleOwnUpcomingBody");
                const collapsed = body.classList.toggle("d-none");
                this.setAttribute("aria-expanded", String(!collapsed));
            });

            refreshOwn();
            renderOwnUpcoming();
            return;
        }

        document.getElementById("scheduleGridCard").classList.remove("d-none");
        wireDelegatedHandlersOnce();

        const branches = window.CrownAuth?.getAllowedBranches?.(currentUser) || [];
        const branchSelect = document.getElementById("scheduleBranchSelect");

        if(branches.length > 1){
            document.getElementById("scheduleBranchWrap").classList.remove("d-none");
        }

        branchSelect.innerHTML = branches.map(function(b){
            return `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`;
        }).join("");

        branchSelect.addEventListener("change", startBranchListener);

        if(canEdit){
            document.getElementById("scheduleCreateBtn").classList.remove("d-none");
        }

        /* History — inline collapsible banner */
        document.getElementById("scheduleHistoryToggle").addEventListener("click", function(){
            const body = document.getElementById("scheduleHistoryBody");
            const collapsed = body.classList.toggle("d-none");
            this.setAttribute("aria-expanded", String(!collapsed));
        });

        document.getElementById("scheduleHistoryList").addEventListener("click", function(event){
            const btn = event.target.closest(".schedule-week-action-btn");

            if(btn){
                openViewModal(btn.dataset.week);
            }
        });

        /* Upcoming — inline collapsible banner */
        document.getElementById("scheduleUpcomingToggle").addEventListener("click", function(){
            const body = document.getElementById("scheduleUpcomingBody");
            const collapsed = body.classList.toggle("d-none");
            this.setAttribute("aria-expanded", String(!collapsed));
        });

        document.getElementById("scheduleUpcomingList").addEventListener("click", function(event){
            const btn = event.target.closest(".schedule-week-action-btn");

            if(!btn){
                return;
            }

            if(!canEdit){
                openViewModal(btn.dataset.week);
                return;
            }

            const weekStart = btn.dataset.week;
            const grid = branchGridsCache.find(function(g){ return g.weekStartDate === weekStart; });

            openEditModal("edit", weekStart, grid);
        });

        /* View modal */
        [
            document.getElementById("scheduleViewCloseBtn"),
            document.getElementById("scheduleViewCloseFooterBtn")
        ].forEach(function(btn){
            btn.addEventListener("click", function(){
                document.getElementById("scheduleViewBackdrop").classList.add("d-none");
            });
        });

        /* Today's Schedule modal */
        document.getElementById("scheduleTodayBtn").addEventListener("click", openTodayModal);

        [
            document.getElementById("scheduleTodayCloseBtn"),
            document.getElementById("scheduleTodayCloseFooterBtn")
        ].forEach(function(btn){
            btn.addEventListener("click", function(){
                document.getElementById("scheduleTodayBackdrop").classList.add("d-none");
            });
        });

        /* Current week's own Edit Schedule button */
        document.getElementById("scheduleCurrentEditBtn").addEventListener("click", function(){
            const weekStart = mondayOf(todayValue());
            const grid = branchGridsCache.find(function(g){ return g.weekStartDate === weekStart; });
            openEditModal("edit", weekStart, grid);
        });

        /* Create Schedule */
        if(canEdit){
            document.getElementById("scheduleCreateBtn").addEventListener("click", function(){
                openEditModal("create", addDays(mondayOf(todayValue()), 7), null);
            });
        }

        /* Create/Edit modal chrome */
        document.getElementById("scheduleEditCloseBtn").addEventListener("click", closeEditModal);
        document.getElementById("scheduleEditCancelBtn").addEventListener("click", closeEditModal);

        document.getElementById("scheduleEditWeekInput").addEventListener("change", function(){
            if(!editState || editState.mode !== "create"){
                return;
            }

            captureEditFormIntoGrid();
            editState.weekStart = mondayOf(this.value);
            editState.grid.weekStartDate = editState.weekStart;
            renderEditModal();
        });

        document.getElementById("scheduleEditClearBtn").addEventListener("click", function(){
            if(!editState){
                return;
            }

            if(!confirm("Clear all entries in this schedule? This won't be saved until you click Save Schedule.")){
                return;
            }

            editState.grid = emptyGrid(editState.branch, editState.weekStart);
            renderEditModal();
        });

        document.getElementById("scheduleEditSubmitBtn").addEventListener("click", async function(){
            if(!editState){
                return;
            }

            captureEditFormIntoGrid();

            const grid = editState.grid;
            grid.branch = editState.branch;
            grid.weekStartDate = editState.weekStart;
            grid.updatedBy = currentUser.account;
            grid.updatedByName = currentUser.nickname || currentUser.account;
            grid.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

            const btn = this;
            btn.disabled = true;

            try{
                await firebase.firestore()
                    .collection(GRID_COLLECTION)
                    .doc(gridDocId(editState.branch, editState.weekStart))
                    .set(grid);

                closeEditModal();
            }catch(error){
                console.error("Unable to save staff schedule:", error);
                alert("Unable to save the schedule. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        startBranchListener();

        window.addEventListener("beforeunload", function(){
            if(branchUnsubscribe){
                branchUnsubscribe();
            }
        });
    });
})();
