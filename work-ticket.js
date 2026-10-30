/* ==========================================================================
   Crown Head Spa — Work Ticket (Admin Hub)

   Tasks and Planned Activities, stored in the "crownWorkTickets" list (the
   "crown" prefix makes firebase-sync.js mirror it). Creating a Task notifies
   the chosen user; a Planned Activity is always for the creator.
   Shift End Report tab is a placeholder for now.
   ========================================================================== */

(function(){
    const KEY = "crownWorkTickets";
    const REPORT_KEY = "crownShiftReports";

    let currentUser = null;
    let createType = "Task";
    let viewId = null;

    function $(id){ return document.getElementById(id); }

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function todayKey(){
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function formatDay(key){
        if(!key){ return ""; }
        return new Date(key + "T00:00:00")
            .toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
    }

    function readTickets(){
        try{
            const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function writeTickets(list){
        localStorage.setItem(KEY, JSON.stringify(list));
    }

    function userLabel(user){
        return user.nickname ? user.nickname + " (" + user.account + ")" : user.account;
    }

    function labelFor(account){
        const user = (window.CrownAuth?.getUsers?.() || []).find(function(u){
            return u.account === account;
        });
        return user ? userLabel(user) : account;
    }

    function isActive(user){
        return !user.status || String(user.status).toLowerCase() === "active";
    }

    /* ---- Table ---- */

    function visibleTickets(){
        const user = $("wtUserFilter").value;
        const type = $("wtTypeFilter").value;

        return readTickets().filter(function(t){
            return (isAdmin() || t.account === currentUser.account || t.createdBy === currentUser.account) &&
                (!user || t.account === user) &&
                (!type || t.type === type);
        });
    }

    function statusHtml(t){
        if(t.status === "Done"){
            return `<span class="wt-done">Done</span>`;
        }

        return t.deadline < todayKey()
            ? `<span class="wt-overdue">Overdue</span>`
            : `<span class="wt-open">Open</span>`;
    }

    function renderTable(){
        const all = visibleTickets();
        const rows = all.filter(function(t){ return t.status === "Open"; })
            .sort(function(a, b){ return String(a.deadline).localeCompare(String(b.deadline)); });
        const done = all.filter(function(t){ return t.status === "Done" || t.status === "Cancelled"; })
            .sort(function(a, b){ return String(b.completedAt || "").localeCompare(String(a.completedAt || "")); });

        $("wtDoneBody").innerHTML = done.map(function(t){
            return `<tr>
                <td><span class="wt-type">${escapeHtml(t.type)}</span></td>
                <td>${escapeHtml(t.title)}</td>
                <td>${escapeHtml(labelFor(t.account))}</td>
                <td>${formatDay(t.startDate)}</td>
                <td>${formatDay(t.deadline)}</td>
                <td>${t.status === "Cancelled" ? "Cancelled · " : ""}${t.completedAt ? formatDay(t.completedAt.slice(0, 10)) : ""}</td>
                <td>${escapeHtml(labelFor(t.createdBy))}</td>
                <td><button type="button" class="btn btn-sm btn-outline-primary" data-view="${escapeHtml(t.id)}">View</button></td>
            </tr>`;
        }).join("");

        $("wtDoneEmpty").classList.toggle("d-none", done.length > 0);

        $("wtTableBody").innerHTML = rows.map(function(t){
            const canComplete = t.status === "Open" &&
                (t.account === currentUser.account || t.createdBy === currentUser.account);

            return `<tr>
                <td><span class="wt-type">${escapeHtml(t.type)}</span></td>
                <td>${escapeHtml(t.title)}</td>
                <td>${escapeHtml(labelFor(t.account))}</td>
                <td>${formatDay(t.startDate)}</td>
                <td>${formatDay(t.deadline)}</td>
                <td>${escapeHtml(labelFor(t.createdBy))}</td>
                <td>${statusHtml(t)}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-view="${escapeHtml(t.id)}">View</button>
                    ${canComplete ? `<button type="button" class="btn btn-sm btn-success" data-done="${escapeHtml(t.id)}">Done</button>` : ""}
                </td>
            </tr>`;
        }).join("");

        $("wtEmptyState").classList.toggle("d-none", rows.length > 0);

        document.querySelectorAll("#wtTableBody [data-view], #wtDoneBody [data-view]").forEach(function(btn){
            btn.addEventListener("click", function(){ openView(btn.dataset.view); });
        });

        $("wtTableBody").querySelectorAll("[data-done]").forEach(function(btn){
            btn.addEventListener("click", function(){ markDone(btn.dataset.done); });
        });
    }

    function markDone(id){
        const list = readTickets();
        const t = list.find(function(x){ return x.id === id; });

        if(!t){ return; }

        t.status = "Done";
        t.completedAt = new Date().toISOString();
        writeTickets(list);

        /* Tell the creator when someone else finishes their task. */
        if(t.createdBy && t.createdBy !== currentUser.account && window.crownAddNotification){
            crownAddNotification({
                account: t.createdBy,
                type: "work-ticket",
                date: todayKey(),
                message: labelFor(currentUser.account) + " completed the task: " + t.title
            });
        }

        renderTable();
    }

    /* ---- Modals ---- */

    function show(id){ $(id).classList.remove("d-none"); }
    function hide(id){ $(id).classList.add("d-none"); }

    function openForm(type){
        createType = type;

        const users = (window.CrownAuth?.getUsers?.() || []).filter(isActive);
        const select = $("wtUserInput");

        $("wtFormTitle").textContent = type === "Task" ? "Create Task" : "Create Planned Activity";

        if(type === "Task"){
            select.innerHTML = users.map(function(u){
                return `<option value="${escapeHtml(u.account)}">${escapeHtml(userLabel(u))}</option>`;
            }).join("");
            select.disabled = false;
        }else{
            select.innerHTML = `<option value="${escapeHtml(currentUser.account)}">${escapeHtml(labelFor(currentUser.account))}</option>`;
            select.disabled = true;
        }

        ["wtTitleInput", "wtDescInput", "wtNotesInput", "wtDeadlineInput"].forEach(function(id){
            $(id).value = "";
        });
        $("wtStartInput").value = todayKey();

        hide("wtChooseBackdrop");
        show("wtFormBackdrop");
    }

    function submitForm(){
        if(createType === "Task" && !isAdmin()){ return alert("Only Admin can create a Task."); }

        const title = $("wtTitleInput").value.trim();
        const startDate = $("wtStartInput").value;
        const deadline = $("wtDeadlineInput").value;
        const account = createType === "Task" ? $("wtUserInput").value : currentUser.account;

        if(!account){ return alert("Please choose a user."); }
        if(!title){ return alert("Please enter the Task."); }
        if(!startDate || !deadline){ return alert("Please set the Start Date and Deadline."); }
        if(deadline < startDate){ return alert("Deadline cannot be before the Start Date."); }

        const ticket = {
            id: "WT-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
            type: createType,
            account: account,
            title: title,
            description: $("wtDescInput").value.trim(),
            startDate: startDate,
            deadline: deadline,
            notes: $("wtNotesInput").value.trim(),
            createdBy: currentUser.account,
            status: "Open",
            createdAt: new Date().toISOString()
        };

        const list = readTickets();
        list.unshift(ticket);
        writeTickets(list);

        if(createType === "Task" && account !== currentUser.account && window.crownAddNotification){
            crownAddNotification({
                account: account,
                type: "work-ticket",
                date: todayKey(),
                message: "New task from " + labelFor(currentUser.account) + ": " + title + " (due " + formatDay(deadline) + ")"
            });
        }

        hide("wtFormBackdrop");
        renderTable();
    }

    function openView(id){
        const t = readTickets().find(function(x){ return x.id === id; });

        if(!t){ return; }

        const row = function(label, value){
            return `<div class="wt-view-row"><strong>${label}</strong><span>${escapeHtml(value || "—")}</span></div>`;
        };

        viewId = id;
        $("wtViewTitle").textContent = t.type;
        $("wtViewBody").innerHTML =
            row("Task", t.title) +
            row("User", labelFor(t.account)) +
            row("Description", t.description) +
            row("Start Date", formatDay(t.startDate)) +
            row("Deadline", formatDay(t.deadline)) +
            row("Notes", t.notes) +
            row("Created by", labelFor(t.createdBy)) +
            row("Status", t.status) +
            updatesHtml(t) + updateFormHtml();

        $("wtAddUpdateBtn").addEventListener("click", addUpdate);

        const canCancel = t.status === "Open" &&
            (t.account === currentUser.account || t.createdBy === currentUser.account);
        const canBudget = window.CrownAuth?.canAccessPage?.("budget-request.html");

        $("wtViewActions").innerHTML =
            (canCancel ? `<button type="button" class="btn btn-outline-danger" id="wtCancelBtn">Cancel ${t.type === "Task" ? "Task" : "Activity"}</button>` : "") +
            (canBudget ? `<button type="button" class="btn btn-outline-primary" id="wtRequestBudgetBtn">Request Budget</button>` : "");

        $("wtRequestBudgetBtn")?.addEventListener("click", function(){
            window.location.href = "budget-request.html?fromTicket=" + encodeURIComponent(t.title);
        });
        $("wtCancelBtn")?.addEventListener("click", function(){ cancelTicket(id); });
        show("wtViewBackdrop");
    }

    function cancelTicket(id){
        const list = readTickets();
        const t = list.find(function(x){ return x.id === id; });

        if(!t || !confirm("Cancel this " + t.type.toLowerCase() + "?")){ return; }

        t.status = "Cancelled";
        t.completedAt = new Date().toISOString();
        writeTickets(list);

        const other = t.account === currentUser.account ? t.createdBy : t.account;

        if(other && other !== currentUser.account && window.crownAddNotification){
            crownAddNotification({
                account: other,
                type: "work-ticket",
                date: todayKey(),
                message: labelFor(currentUser.account) + " cancelled the task: " + t.title
            });
        }

        hide("wtViewBackdrop");
        renderTable();
    }

    function updatesHtml(t){
        const updates = Array.isArray(t.updates) ? t.updates : [];

        return `<div class="wt-view-row"><strong>Updates</strong></div>` +
            (updates.length === 0
                ? `<div class="text-muted small mb-2">No updates yet.</div>`
                : updates.map(function(u){
                    const when = new Date(u.at).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

                    return `<div class="wt-update">
                        <div class="wt-update-meta">${escapeHtml(labelFor(u.by))} · ${when}</div>
                        ${u.note ? `<div class="wt-update-note">${escapeHtml(u.note)}</div>` : ""}
                        ${(u.attachments || []).map(function(a){
                            return `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(a.name)}</a>`;
                        }).join("")}
                    </div>`;
                }).join(""));
    }

    function updateFormHtml(){
        return `<div class="mt-3">
            <label class="form-label fw-semibold" for="wtUpdateNote">Add Note</label>
            <textarea class="form-control mb-2" id="wtUpdateNote" rows="2" maxlength="1000"></textarea>
            <label class="form-label fw-semibold" for="wtUpdateFiles">Add Attachment</label>
            <input type="file" class="form-control mb-2" id="wtUpdateFiles" multiple>
            <button type="button" class="btn btn-primary btn-sm" id="wtAddUpdateBtn">Add</button>
        </div>`;
    }

    function uploadFile(file, ticketId){
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `workTicketFiles/${ticketId}/${Date.now()}_${safeName}`;
        const ref = firebase.storage().ref().child(path);

        return ref.put(file).then(function(){
            return ref.getDownloadURL();
        }).then(function(url){
            return { name: file.name, path: path, url: url };
        });
    }

    function addUpdate(){
        const note = $("wtUpdateNote").value.trim();
        const files = Array.from($("wtUpdateFiles").files);
        const id = viewId;

        if(!note && files.length === 0){
            return alert("Please add a note or an attachment.");
        }

        const btn = $("wtAddUpdateBtn");
        btn.disabled = true;
        btn.textContent = "Adding...";

        Promise.all(files.map(function(f){ return uploadFile(f, id); })).then(function(attachments){
            const list = readTickets();
            const t = list.find(function(x){ return x.id === id; });

            if(!t){ return; }

            t.updates = Array.isArray(t.updates) ? t.updates : [];
            t.updates.push({
                id: Date.now().toString(36),
                by: currentUser.account,
                at: new Date().toISOString(),
                note: note,
                attachments: attachments
            });
            writeTickets(list);

            /* Let the other party know. */
            const other = t.account === currentUser.account ? t.createdBy : t.account;

            if(other && other !== currentUser.account && window.crownAddNotification){
                crownAddNotification({
                    account: other,
                    type: "work-ticket",
                    date: todayKey(),
                    message: labelFor(currentUser.account) + " updated the task: " + t.title
                });
            }

            openView(id);
        }).catch(function(error){
            console.error("Unable to add update:", error);
            alert("Unable to upload the attachment. Please try again.");
            btn.disabled = false;
            btn.textContent = "Add";
        });
    }

    /* ---- Shift End Report ---- */

    /* Only Admin sees everything; Executive Assistant and Marketing see
       only tickets they own or created, and their own reports. */
    function isAdmin(){
        return currentUser.role === "Admin";
    }

    function canReviewReports(){
        return isAdmin();
    }

    function readReports(){
        try{
            const parsed = JSON.parse(localStorage.getItem(REPORT_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function lines(text){
        return String(text || "").split("\n").map(function(l){ return l.trim(); }).filter(Boolean);
    }

    function renderReports(){
        const user = $("srUserFilter").value;
        const date = $("srDateFilter").value;

        const rows = readReports().filter(function(r){
            return (canReviewReports() || r.account === currentUser.account) &&
                (!user || r.account === user) &&
                (!date || r.date === date);
        }).sort(function(a, b){
            return String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt));
        });

        $("srTableBody").innerHTML = rows.map(function(r){
            return `<tr>
                <td>${formatDay(r.date)}</td>
                <td>${escapeHtml(r.shift)}</td>
                <td>${escapeHtml(labelFor(r.account))}</td>
                <td>${r.done.length}</td>
                <td>${escapeHtml(r.notFinished || "")}</td>
                <td><button type="button" class="btn btn-sm btn-outline-primary" data-report="${escapeHtml(r.id)}">View</button></td>
            </tr>`;
        }).join("");

        $("srEmptyState").classList.toggle("d-none", rows.length > 0);

        $("srTableBody").querySelectorAll("[data-report]").forEach(function(btn){
            btn.addEventListener("click", function(){ openReport(btn.dataset.report); });
        });

        renderMissing();
    }

    /* Who on this page has not filed anything today (reviewers only). */
    function renderMissing(){
        const box = $("srMissing");

        if(!canReviewReports()){
            box.classList.add("d-none");
            return;
        }

        const filed = {};
        readReports().forEach(function(r){
            if(r.date === todayKey()){ filed[r.account] = true; }
        });

        const missing = (window.CrownAuth?.getUsers?.() || []).filter(function(u){
            return isActive(u) && !filed[u.account] &&
                (window.CrownAuth.canAccessPage("work-ticket.html", u));
        });

        box.classList.toggle("d-none", missing.length === 0);
        box.textContent = "Not yet filed today: " + missing.map(userLabel).join(", ");
    }

    function openReportForm(){
        $("srDateInput").value = todayKey();
        ["srDoneInput", "srNotFinishedInput", "srPlanInput", "srIssuesInput"].forEach(function(id){
            $(id).value = "";
        });

        const mine = readTickets().filter(function(t){
            return t.status === "Open" && t.account === currentUser.account;
        });

        $("srTicketList").innerHTML = mine.length === 0
            ? `<div class="text-muted small">No open tickets.</div>`
            : mine.map(function(t){
                return `<label class="d-block small"><input type="checkbox" class="sr-ticket" value="${escapeHtml(t.id)}"> ${escapeHtml(t.title)} <span class="text-muted">(${escapeHtml(t.type)})</span></label>`;
            }).join("");

        show("srFormBackdrop");
    }

    function submitReport(){
        const date = $("srDateInput").value;
        const ticketIds = Array.from(document.querySelectorAll(".sr-ticket:checked")).map(function(c){ return c.value; });
        const extra = lines($("srDoneInput").value);

        if(!date){ return alert("Please set the Date."); }
        if(ticketIds.length === 0 && extra.length === 0){ return alert("Please enter what you completed today."); }

        /* Ticked tickets are marked Done, so they land in Accomplished Tasks. */
        const tickets = readTickets();
        const done = [];

        ticketIds.forEach(function(id){
            const t = tickets.find(function(x){ return x.id === id; });

            if(t){
                t.status = "Done";
                t.completedAt = new Date().toISOString();
                done.push(t.title);
            }
        });

        writeTickets(tickets);

        const report = {
            id: "SR-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
            account: currentUser.account,
            date: date,
            shift: $("srShiftInput").value,
            done: done.concat(extra),
            notFinished: $("srNotFinishedInput").value.trim(),
            plan: $("srPlanInput").value.trim(),
            issues: $("srIssuesInput").value.trim(),
            createdAt: new Date().toISOString()
        };

        const list = readReports();
        list.unshift(report);
        localStorage.setItem(REPORT_KEY, JSON.stringify(list));

        /* Tell the Admins when something needs their attention. */
        if(report.issues && window.crownAddNotification){
            (window.CrownAuth?.getUsers?.() || []).filter(function(u){
                return u.role === "Admin" && isActive(u) && u.account !== currentUser.account;
            }).forEach(function(u){
                crownAddNotification({
                    account: u.account,
                    type: "work-ticket",
                    date: todayKey(),
                    message: labelFor(currentUser.account) + " needs help (Shift End Report): " + report.issues
                });
            });
        }

        hide("srFormBackdrop");
        renderReports();
        renderTable();
    }

    function openReport(id){
        const r = readReports().find(function(x){ return x.id === id; });

        if(!r){ return; }

        const block = function(label, value){
            return `<div class="wt-view-row"><strong>${label}</strong><span>${escapeHtml(value || "—")}</span></div>`;
        };

        $("srViewBody").innerHTML =
            block("User", labelFor(r.account)) +
            block("Date", formatDay(r.date) + " · " + r.shift) +
            block("Completed Today", r.done.map(function(d){ return "• " + d; }).join("\n")) +
            block("Not Finished and Why", r.notFinished) +
            block("Plan for Tomorrow", r.plan) +
            block("Issues or Support Needed from Admin", r.issues);

        show("srViewBackdrop");
    }

    function selectTab(tab){
        document.querySelectorAll("#wtTabs .nav-link").forEach(function(btn){
            btn.classList.toggle("active", btn.dataset.tab === tab);
        });
        $("wtTaskPanel").classList.toggle("d-none", tab !== "task");
        $("wtDonePanel").classList.toggle("d-none", tab !== "task");
        $("wtShiftPanel").classList.toggle("d-none", tab !== "shift");
    }

    document.addEventListener("DOMContentLoaded", function(){
        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        const users = (window.CrownAuth?.getUsers?.() || []).filter(isActive);

        $("wtUserFilter").parentElement.classList.toggle("d-none", !isAdmin());
        $("wtUserFilter").innerHTML = `<option value="">All Users</option>` + users.map(function(u){
            return `<option value="${escapeHtml(u.account)}">${escapeHtml(userLabel(u))}</option>`;
        }).join("");

        ["wtUserFilter", "wtTypeFilter"].forEach(function(id){
            $(id).addEventListener("change", renderTable);
        });

        document.querySelectorAll("#wtTabs .nav-link").forEach(function(btn){
            btn.addEventListener("click", function(){ selectTab(btn.dataset.tab); });
        });

        /* Only Admin can assign Tasks; everyone else files Planned
           Activities for themselves, so they skip the chooser. */
        if(!isAdmin()){
            $("wtCreateBtn").textContent = "Create Planned Activity";
        }

        $("wtCreateBtn").addEventListener("click", function(){
            if(isAdmin()){
                show("wtChooseBackdrop");
            }else{
                openForm("Planned Activity");
            }
        });

        document.querySelectorAll("#wtChooseBackdrop [data-type]").forEach(function(btn){
            btn.addEventListener("click", function(){ openForm(btn.dataset.type); });
        });

        document.querySelectorAll("[data-close]").forEach(function(btn){
            btn.addEventListener("click", function(){ hide(btn.dataset.close); });
        });

        ["wtChooseBackdrop", "wtFormBackdrop", "wtViewBackdrop"].forEach(function(id){
            $(id).addEventListener("click", function(event){
                if(event.target === $(id)){ hide(id); }
            });
        });

        $("wtDoneToggle").addEventListener("click", function(){
            const opening = $("wtDoneSection").classList.contains("d-none");

            $("wtDoneSection").classList.toggle("d-none", !opening);
            $("wtDoneToggle").textContent = opening ? "Hide ▴" : "Show ▾";
        });

        const reportUsers = users.filter(function(u){
            return window.CrownAuth.canAccessPage("work-ticket.html", u);
        });

        $("srUserFilter").innerHTML = `<option value="">All Users</option>` + reportUsers.map(function(u){
            return `<option value="${escapeHtml(u.account)}">${escapeHtml(userLabel(u))}</option>`;
        }).join("");
        $("srFilters").classList.toggle("d-none", !canReviewReports());

        $("srUserFilter").addEventListener("change", renderReports);
        $("srDateFilter").addEventListener("change", renderReports);
        $("srClearDateBtn").addEventListener("click", function(){
            $("srDateFilter").value = "";
            renderReports();
        });
        $("srCreateBtn").addEventListener("click", openReportForm);
        $("srSubmitBtn").addEventListener("click", submitReport);

        ["srFormBackdrop", "srViewBackdrop"].forEach(function(id){
            $(id).addEventListener("click", function(event){
                if(event.target === $(id)){ hide(id); }
            });
        });

        $("wtSubmitBtn").addEventListener("click", submitForm);

        renderTable();
        renderReports();
    });
})();
