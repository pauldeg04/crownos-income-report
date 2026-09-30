/* ==========================================================================
   Crown Head Spa — Activity Log page (Admin only)

   Shows the "activityLog" Firestore collection written by activity-log.js,
   one day at a time, live. Filtering by user / branch / module / text is
   done here on the loaded day, so the query stays a plain equality on
   `day` (no composite index needed).
   ========================================================================== */

(function(){
    const dateInput = document.getElementById("activityDate");
    const userSelect = document.getElementById("activityUser");
    const branchSelect = document.getElementById("activityBranch");
    const moduleSelect = document.getElementById("activityModule");
    const searchInput = document.getElementById("activitySearch");
    const rowsBody = document.getElementById("activityRows");
    const countLabel = document.getElementById("activityCount");
    const emptyLabel = document.getElementById("activityEmpty");
    const messageBox = document.getElementById("activityMessage");

    let entries = [];
    let unsubscribe = null;

    function localDay(date){
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function shiftDay(days){
        const [year, month, day] = dateInput.value.split("-").map(Number);
        dateInput.value = localDay(new Date(year, month - 1, day + days));
        load();
    }

    function escapeHtml(value){
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function formatTime(entry){
        const date = entry.ts?.toDate ? entry.ts.toDate() : new Date(entry.clientTime);

        return isNaN(date)
            ? ""
            : date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    }

    function sortTime(entry){
        return entry.ts?.toMillis ? entry.ts.toMillis() : Date.parse(entry.clientTime) || 0;
    }

    function actionClass(action){
        const lower = String(action || "").toLowerCase();

        if(lower.includes("settle")){
            return "settle";
        }

        if(lower.includes("delet") || lower.includes("remov") || lower.includes("clear")){
            return "delete";
        }

        return "";
    }

    function showMessage(text){
        messageBox.textContent = text;
        messageBox.classList.toggle("d-none", !text);
    }

    function fillSelect(select, values, allLabel){
        const current = select.value;

        select.innerHTML =
            '<option value="">' + escapeHtml(allLabel) + "</option>" +
            values.map(function(value){
                return '<option value="' + escapeHtml(value.value) + '">' + escapeHtml(value.label) + "</option>";
            }).join("");

        select.value = values.some(function(value){ return value.value === current; }) ? current : "";
    }

    function refreshFilterOptions(){
        const users = new Map();
        const branches = new Set();
        const modules = new Set();

        entries.forEach(function(entry){
            if(entry.account){
                users.set(entry.account, entry.name && entry.name !== entry.account
                    ? entry.name + " (" + entry.account + ")"
                    : entry.account);
            }

            if(entry.branch){
                branches.add(entry.branch);
            }

            if(entry.module){
                modules.add(entry.module);
            }
        });

        fillSelect(userSelect, Array.from(users, function([value, label]){ return { value: value, label: label }; })
            .sort(function(a, b){ return a.label.localeCompare(b.label); }), "All users");

        fillSelect(branchSelect, Array.from(branches).sort().map(function(value){ return { value: value, label: value }; }), "All branches");
        fillSelect(moduleSelect, Array.from(modules).sort().map(function(value){ return { value: value, label: value }; }), "All modules");
    }

    function filtered(){
        const user = userSelect.value;
        const branch = branchSelect.value;
        const module = moduleSelect.value;
        const search = searchInput.value.trim().toLowerCase();

        return entries.filter(function(entry){
            if(user && entry.account !== user){
                return false;
            }

            if(branch && entry.branch !== branch){
                return false;
            }

            if(module && entry.module !== module){
                return false;
            }

            if(search){
                const haystack = [
                    entry.summary, entry.action, entry.module, entry.name,
                    entry.account, entry.branch, (entry.details || []).join(" ")
                ].join(" ").toLowerCase();

                return haystack.includes(search);
            }

            return true;
        });
    }

    function render(){
        const rows = filtered();

        countLabel.textContent =
            rows.length === entries.length
                ? entries.length + " activit" + (entries.length === 1 ? "y" : "ies")
                : rows.length + " of " + entries.length + " activities";

        emptyLabel.classList.toggle("d-none", rows.length > 0);

        rowsBody.innerHTML = rows.map(function(entry, index){
            const details = (entry.details || []).map(function(line){
                return "<li>" + escapeHtml(line) + "</li>";
            }).join("");

            const meta =
                '<li class="activity-meta">Page: ' + escapeHtml(entry.page || "—") +
                (entry.ref ? " · " + escapeHtml(entry.ref) : "") + "</li>";

            return (
                '<tr class="activity-row" data-index="' + index + '">' +
                    '<td class="activity-time">' + escapeHtml(formatTime(entry)) + "</td>" +
                    '<td class="activity-user"><strong>' + escapeHtml(entry.name || entry.account || "—") + "</strong>" +
                        "<small>" + escapeHtml(entry.role || "") + "</small></td>" +
                    "<td>" + escapeHtml(entry.branch || "—") + "</td>" +
                    "<td>" + escapeHtml(entry.module || "—") + "</td>" +
                    "<td>" +
                        '<span class="activity-action ' + actionClass(entry.action) + '">' + escapeHtml(entry.action || "") + "</span>" +
                        escapeHtml(entry.summary || "") +
                        '<ul class="activity-details">' + details + meta + "</ul>" +
                    "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function load(){
        if(unsubscribe){
            unsubscribe();
            unsubscribe = null;
        }

        entries = [];
        render();
        countLabel.textContent = "Loading…";
        showMessage("");

        if(!window.firebase?.apps?.length){
            showMessage("No cloud connection — the Activity Log needs to be online.");
            return;
        }

        unsubscribe = firebase.firestore()
            .collection("activityLog")
            .where("day", "==", dateInput.value)
            .onSnapshot(function(snapshot){
                entries = snapshot.docs
                    .map(function(doc){ return doc.data(); })
                    .sort(function(a, b){ return sortTime(b) - sortTime(a); });

                refreshFilterOptions();
                render();
            }, function(error){
                console.error("Unable to load the Activity Log:", error);
                countLabel.textContent = "";
                showMessage(
                    error?.code === "permission-denied"
                        ? "Only Admin accounts can view the Activity Log. If you are an Admin, log out and log in again."
                        : "Could not load the Activity Log: " + (error?.message || error)
                );
            });
    }

    function exportCsv(){
        const rows = filtered();
        const header = ["Date", "Time", "User", "Account", "Role", "Branch", "Module", "Action", "Summary", "Details", "Page"];

        const csv = [header].concat(rows.map(function(entry){
            return [
                entry.day, formatTime(entry), entry.name, entry.account, entry.role, entry.branch,
                entry.module, entry.action, entry.summary, (entry.details || []).join(" | "), entry.page
            ];
        })).map(function(row){
            return row.map(function(cell){
                return '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"';
            }).join(",");
        }).join("\r\n");

        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
        link.download = "crownos-activity-" + dateInput.value + ".csv";
        link.click();
        setTimeout(function(){ URL.revokeObjectURL(link.href); }, 1000);
    }

    rowsBody.addEventListener("click", function(event){
        event.target.closest(".activity-row")?.classList.toggle("open");
    });

    [userSelect, branchSelect, moduleSelect].forEach(function(select){
        select.addEventListener("change", render);
    });

    searchInput.addEventListener("input", render);
    dateInput.addEventListener("change", load);
    document.getElementById("activityPrevDay").addEventListener("click", function(){ shiftDay(-1); });
    document.getElementById("activityNextDay").addEventListener("click", function(){ shiftDay(1); });
    document.getElementById("activityExport").addEventListener("click", exportCsv);

    dateInput.value = localDay(new Date());

    /* Reads need the Admin role claim on this session's token, which
       firebase-sync.js refreshes (syncRole) before its first pull — wait
       for that, not just for a signed-in user. */
    if(window.firebase?.auth && firebase.apps?.length){
        let started = false;

        firebase.auth().onAuthStateChanged(async function(user){
            if(user && !started){
                started = true;
                await window.CrownCloud?.waitForInitialSync?.(15000);
                load();
            }
        });

        setTimeout(function(){
            if(!started){
                countLabel.textContent = "";
                showMessage("Not signed in to the cloud — log out and log in again to view the Activity Log.");
            }
        }, 10000);
    }else{
        load();
    }
})();
