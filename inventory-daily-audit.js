/* ==========================================================================
   Crown Head Spa — Inventory > Daily Audit Report

   One tab per branch. Each tab shows the reports that branch has sent,
   and under them today's report: the user lists the items used (Item /
   Qty / Unit) and presses Send Report. Sending locks the report and
   deducts every line from that branch's available stock
   (crownBranchStock). Everyone sees the same layout; Admin and Executive
   Assistant get every branch's tab, anyone else (e.g. a Team Leader) only
   the branches assigned to their account.

   Reports live in one flat, synced array (crownDailyAuditReports), one
   per branch per day. Unsent drafts stay on the device (not synced).
   ========================================================================== */

(function(){
    const REPORTS_KEY = "crownDailyAuditReports";
    const BRANCH_KEY = "crownSelectedBranch";
    const ALL_BRANCH_ROLES = ["Admin", "Executive Assistant"];

    let user = null;
    let tabBranches = [];
    let draftLines = [];
    let activeTab = "";

    const esc = function(value){
        return CrownInventory.escapeHtml(value);
    };

    function byId(id){
        return document.getElementById(id);
    }

    function getReports(){
        try{
            const parsed = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function saveReports(list){
        localStorage.setItem(REPORTS_KEY, JSON.stringify(list));
    }

    /* The branch whose tab is open — it is both the branch being reviewed
       and the branch today's report is filed for. */
    function getCurrentBranch(){
        return activeTab;
    }

    function shortBranch(name){
        return String(name || "").replace(/^Crown Head Spa\s*/i, "") || name;
    }

    function getBranchNames(){
        const names = window.CrownAuth?.getAllBranchNames?.() || [];
        return names.length ? names : ["Crown Head Spa Biñan", "Crown Head Spa Calamba"];
    }

    function findTodayReport(branch){
        const today = CrownInventory.getTodayValue();

        return getReports().find(function(report){
            return report.branch === branch && report.date === today;
        }) || null;
    }

    function draftKey(branch){
        return "dailyAuditDraft:" + branch + ":" + CrownInventory.getTodayValue();
    }

    function loadDraft(branch){
        try{
            const parsed = JSON.parse(localStorage.getItem(draftKey(branch)) || "[]");
            draftLines = Array.isArray(parsed) ? parsed : [];
        }catch(error){
            draftLines = [];
        }
    }

    function saveDraft(branch){
        try{
            localStorage.setItem(draftKey(branch), JSON.stringify(draftLines));
        }catch(error){
            /* A lost draft is not worth interrupting the form. */
        }
    }

    function availableQty(branch, itemId){
        const row = CrownInventory.getBranchRow(branch, itemId);
        return row ? Math.max(0, Number(row.qty) || 0) : 0;
    }

    /* ---------------------------- entry view ---------------------------- */

    function renderEntry(){
        const branch = getCurrentBranch();

        byId("entrySection").classList.toggle("d-none", !branch);

        if(!branch){
            return;
        }

        byId("entryBranchLabel").textContent = branch;
        byId("entryDateLabel").textContent =
            CrownInventory.formatDate(CrownInventory.getTodayValue());

        const sent = findTodayReport(branch);
        const body = byId("entryBody");

        byId("addItemWrap").classList.toggle("d-none", Boolean(sent));
        byId("sendRow").classList.toggle("d-none", Boolean(sent));

        const note = byId("submittedNote");
        note.classList.toggle("d-none", !sent);

        if(sent){
            note.innerHTML =
                `<span><strong>Report sent</strong> — locked, no more edits.</span>` +
                `<span>By ${esc(sent.submittedBy || "—")}</span>` +
                `<span>${esc(formatStamp(sent.submittedAt))}</span>`;

            body.innerHTML = sent.lines.length
                ? sent.lines.map(function(line){
                    return `
                        <tr>
                            <td>${esc(line.name)}</td>
                            <td>${esc(line.qty)}</td>
                            <td>${esc(line.unit)}</td>
                            <td></td>
                        </tr>`;
                }).join("")
                : "";

            return;
        }

        if(!draftLines.length){
            body.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-muted py-4">
                        No items yet. Press <strong>+ Add Item</strong> to start.
                    </td>
                </tr>`;
            return;
        }

        body.innerHTML = draftLines.map(function(line, index){
            const max = availableQty(branch, line.itemId);

            const units = CrownInventory.UNITS.slice();

            if(line.unit && !units.includes(line.unit)){
                units.push(line.unit);
            }

            return `
                <tr data-index="${index}">
                    <td>
                        ${esc(line.name)}
                        <div class="text-muted small">${esc(max)} available</div>
                    </td>
                    <td>
                        <div class="audit-qty">
                            <button type="button" class="btn btn-outline-secondary audit-qty-btn" data-act="minus" aria-label="Decrease">−</button>
                            <input type="number" min="1" max="${esc(max)}" step="1" class="form-control audit-qty-input" value="${esc(line.qty)}" inputmode="numeric">
                            <button type="button" class="btn btn-outline-secondary audit-qty-btn" data-act="plus" aria-label="Increase">+</button>
                        </div>
                    </td>
                    <td>
                        <select class="form-select audit-unit-select">
                            ${units.map(function(unit){
                                return `<option value="${esc(unit)}"${unit === line.unit ? " selected" : ""}>${esc(unit)}</option>`;
                            }).join("")}
                        </select>
                    </td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-act="remove" aria-label="Remove">×</button>
                    </td>
                </tr>`;
        }).join("");
    }

    function formatStamp(iso){
        const date = new Date(iso);

        if(Number.isNaN(date.getTime())){
            return "";
        }

        return date.toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
            hour: "numeric", minute: "2-digit"
        });
    }

    function clampQty(line, value){
        const max = availableQty(getCurrentBranch(), line.itemId);
        const qty = Math.floor(Number(value)) || 1;

        return Math.min(Math.max(1, qty), Math.max(1, max));
    }

    function onBodyClick(event){
        const button = event.target.closest("button[data-act]");
        const row = event.target.closest("tr[data-index]");

        if(!button || !row){
            return;
        }

        const index = Number(row.dataset.index);
        const line = draftLines[index];

        if(!line){
            return;
        }

        if(button.dataset.act === "remove"){
            draftLines.splice(index, 1);
        }else{
            line.qty = clampQty(line, line.qty + (button.dataset.act === "plus" ? 1 : -1));
        }

        saveDraft(getCurrentBranch());
        renderEntry();
    }

    function onBodyChange(event){
        const row = event.target.closest("tr[data-index]");
        const line = row && draftLines[Number(row.dataset.index)];

        if(!line){
            return;
        }

        if(event.target.classList.contains("audit-qty-input")){
            line.qty = clampQty(line, event.target.value);
            event.target.value = line.qty;
        }else if(event.target.classList.contains("audit-unit-select")){
            line.unit = event.target.value;
        }

        saveDraft(getCurrentBranch());
    }

    /* --------------------------- item picker --------------------------- */

    function openPicker(){
        byId("itemPickerSearch").value = "";
        renderPicker();
        byId("itemPickerBackdrop").classList.remove("d-none");
        byId("itemPickerSearch").focus();
    }

    function closePicker(){
        byId("itemPickerBackdrop").classList.add("d-none");
    }

    function renderPicker(){
        const branch = getCurrentBranch();
        const term = byId("itemPickerSearch").value.trim().toLowerCase();

        const added = new Set(draftLines.map(function(line){
            return line.itemId;
        }));

        const available = CrownInventory.getItems()
            .filter(function(item){
                return (
                    !added.has(item.id) &&
                    availableQty(branch, item.id) > 0
                );
            })
            .sort(function(a, b){
                return String(a.name).localeCompare(String(b.name));
            });

        const matches = available.filter(function(item){
            return !term || String(item.name).toLowerCase().includes(term);
        });

        const list = byId("itemPickerList");

        if(!matches.length){
            list.innerHTML = `
                <p class="text-muted text-center mb-0 py-3">
                    ${available.length ? "No item matches your search." : "No items with available stock at this branch."}
                </p>`;
            return;
        }

        list.innerHTML = matches.map(function(item){
            return `
                <button type="button" class="audit-item-option" data-id="${esc(item.id)}">
                    <span>${esc(item.name)}</span>
                    <small>${esc(availableQty(branch, item.id))} ${esc(item.unit || "")} available</small>
                </button>`;
        }).join("");
    }

    function onPickItem(event){
        const option = event.target.closest(".audit-item-option");

        if(!option){
            return;
        }

        const item = CrownInventory.getItemById(option.dataset.id);

        if(!item){
            return;
        }

        draftLines.push({
            itemId: item.id,
            name: item.name,
            qty: 1,
            unit: item.unit || CrownInventory.UNITS[0]
        });

        saveDraft(getCurrentBranch());
        closePicker();
        renderEntry();
    }

    /* ---------------------------- send report ---------------------------- */

    function sendReport(){
        const branch = getCurrentBranch();

        if(!branch || findTodayReport(branch)){
            return;
        }

        if(!draftLines.length){
            alert("Add at least one item before sending the report.");
            return;
        }

        const short = draftLines.filter(function(line){
            return line.qty > availableQty(branch, line.itemId);
        });

        if(short.length){
            alert(
                "Not enough available stock for: " +
                short.map(function(line){ return line.name; }).join(", ") +
                ". Please lower the quantity."
            );
            renderEntry();
            return;
        }

        if(!confirm(
            "Send this Daily Audit Report? It can no longer be edited, " +
            "and the quantities will be deducted from the available stock."
        )){
            return;
        }

        const today = CrownInventory.getTodayValue();

        const lines = draftLines.map(function(line){
            const row = CrownInventory.getBranchRow(branch, line.itemId);
            const before = row ? Math.max(0, Number(row.qty) || 0) : 0;
            const applied = Math.min(before, Math.max(0, Number(line.qty) || 0));

            if(applied > 0){
                CrownInventory.adjustBranchStock(branch, line.itemId, -applied, today);
            }

            return {
                itemId: line.itemId,
                name: line.name,
                qty: line.qty,
                unit: line.unit,
                deducted: applied
            };
        });

        const reports = getReports();

        reports.push({
            id: CrownInventory.createId("DAR"),
            branch: branch,
            date: today,
            submittedBy: user?.nickname || user?.account || "",
            submittedById: user?.id || "",
            submittedAt: new Date().toISOString(),
            lines: lines
        });

        saveReports(reports);

        try{
            localStorage.removeItem(draftKey(branch));
        }catch(error){
            /* nothing to clean up */
        }

        draftLines = [];
        renderEntry();
    }

    /* ----------------------- Admin / EA review view ----------------------- */

    /* Only branches flagged "Show on Admin Dashboard" in List of Branches
       (shown unless explicitly switched off) get a tab — same rule as
       admin-dashboard.js's getBranches(). */
    function isOnAdminDashboard(name){
        try{
            const master = JSON.parse(
                localStorage.getItem("crownBranchMasterList") || "[]"
            );

            return !(Array.isArray(master) ? master : []).some(function(branch){
                return (
                    branch &&
                    typeof branch === "object" &&
                    branch.name === name &&
                    branch.showOnAdminDashboard === false
                );
            });
        }catch(error){
            return true;
        }
    }

    function resolveTabBranches(){
        const everyBranch = ALL_BRANCH_ROLES.includes(
            window.CrownAuth?.getEffectiveRole?.(user) || user?.role
        );

        tabBranches = everyBranch
            ? getBranchNames()
            : (window.CrownAuth?.getAllowedBranches?.(user) || []);

        tabBranches = tabBranches.filter(isOnAdminDashboard);

        if(!tabBranches.includes(activeTab)){
            const selected = localStorage.getItem(BRANCH_KEY) || "";

            activeTab = tabBranches.includes(selected)
                ? selected
                : (tabBranches[0] || "");
        }
    }

    function renderTabs(){
        const tabs = byId("branchTabs");

        tabs.classList.toggle("d-none", !tabBranches.length);

        tabs.innerHTML = tabBranches.map(function(name){
            return `<button type="button" role="tab" data-branch="${esc(name)}" aria-selected="${name === activeTab}">${esc(shortBranch(name))}</button>`;
        }).join("");
    }

    function renderReview(){
        byId("reviewBranchLabel").textContent = activeTab;

        const reports = getReports()
            .filter(function(report){
                return report.branch === activeTab;
            })
            .sort(function(a, b){
                return (
                    String(b.date).localeCompare(String(a.date)) ||
                    String(b.submittedAt).localeCompare(String(a.submittedAt))
                );
            });

        const list = byId("reviewList");

        if(!reports.length){
            list.innerHTML = `<p class="text-muted text-center py-4 mb-0">No reports sent yet by this branch.</p>`;
            return;
        }

        list.innerHTML = reports.map(function(report){
            return `
                <div class="audit-report-card">
                    <h4>${esc(CrownInventory.formatDate(report.date))}</h4>
                    <div class="audit-submitted-note">
                        <span>By ${esc(report.submittedBy || "—")}</span>
                        <span>${esc(formatStamp(report.submittedAt))}</span>
                    </div>

                    <div class="table-responsive">
                        <table class="table table-bordered align-middle inv-table mb-0">
                            <thead>
                                <tr><th>Item</th><th>Qty</th><th>Unit</th></tr>
                            </thead>
                            <tbody>
                                ${(report.lines || []).map(function(line){
                                    return `<tr><td>${esc(line.name)}</td><td>${esc(line.qty)}</td><td>${esc(line.unit)}</td></tr>`;
                                }).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        }).join("");
    }

    /* -------------------------------- boot -------------------------------- */

    function render(){
        resolveTabBranches();

        const hasBranch = Boolean(activeTab);

        byId("noBranchNotice").classList.toggle("d-none", hasBranch);
        byId("reviewSection").classList.toggle("d-none", !hasBranch);

        renderTabs();

        if(!hasBranch){
            byId("entrySection").classList.add("d-none");
            return;
        }

        renderReview();
        loadDraft(activeTab);
        renderEntry();
    }

    document.addEventListener("DOMContentLoaded", function(){
        user = window.CrownAuth?.getCurrentUser?.() || null;

        byId("branchTabs").addEventListener("click", function(event){
            const tab = event.target.closest("[data-branch]");

            if(tab){
                activeTab = tab.dataset.branch;
                render();
            }
        });

        byId("addItemBtn").addEventListener("click", openPicker);
        byId("closeItemPickerBtn").addEventListener("click", closePicker);
        byId("itemPickerSearch").addEventListener("input", renderPicker);
        byId("itemPickerList").addEventListener("click", onPickItem);
        byId("sendReportBtn").addEventListener("click", sendReport);
        byId("entryBody").addEventListener("click", onBodyClick);
        byId("entryBody").addEventListener("change", onBodyChange);

        byId("itemPickerBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closePicker();
            }
        });

        window.addEventListener("crownGlobalFiltersChanged", render);

        render();
    });
})();
