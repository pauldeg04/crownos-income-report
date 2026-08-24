/* ==========================================================================
   Crown Head Spa — Incident Report (Admin Hub)

   Firestore collection "incidentReports" — submit-only log, no
   approve/decline workflow. Admin/Executive Assistant/teamLeader accounts
   see the full history; everyone else only gets the submit form.
   ========================================================================== */

(function(){
    const COLLECTION = "incidentReports";

    let currentUser = null;
    let canView = false;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatTimestamp(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "";
        }

        return timestamp.toDate().toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
        });
    }

    function formatIncidentDateTime(report){
        if(!report.incidentDate){
            return "";
        }

        try{
            const date = new Date(report.incidentDate + "T00:00:00")
                .toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
            return report.incidentTime ? date + " " + report.incidentTime : date;
        }catch(error){
            return report.incidentDate;
        }
    }

    let reportsCache = [];

    function renderTable(){
        const body = document.getElementById("incidentTableBody");
        const empty = document.getElementById("incidentEmptyState");

        if(reportsCache.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = reportsCache.map(function(r){
            return `
                <tr>
                    <td>${escapeHtml(formatIncidentDateTime(r))}</td>
                    <td>${escapeHtml(r.branch)}</td>
                    <td>${escapeHtml((r.involvedPersons || "").slice(0, 60))}</td>
                    <td>${escapeHtml(r.reportedByName)}</td>
                    <td>${escapeHtml(formatTimestamp(r.submittedAt))}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary incident-view-btn" data-id="${escapeHtml(r.id)}">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".incident-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openView(btn.dataset.id);
            });
        });
    }

    function openView(id){
        const report = reportsCache.find(function(r){ return r.id === id; });

        if(!report){
            return;
        }

        const body = document.getElementById("incidentViewBody");

        body.innerHTML = [
            ["Date / Time of Incident", formatIncidentDateTime(report)],
            ["Branch", report.branch],
            ["Involved Persons", report.involvedPersons],
            ["Description", report.description],
            ["Actions Taken", report.actionsTaken],
            ["Reported By", report.reportedByName],
            ["Submitted", formatTimestamp(report.submittedAt)]
        ].map(function(pair){
            return `<div class="incident-view-row"><strong>${escapeHtml(pair[0])}</strong><span>${escapeHtml(pair[1] || "")}</span></div>`;
        }).join("");

        document.getElementById("incidentViewBackdrop").classList.remove("d-none");
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        canView = currentUser.role === "Admin" ||
            currentUser.role === "Executive Assistant" ||
            currentUser.teamLeader === true;

        if(canView){
            document.getElementById("incidentListCard").classList.remove("d-none");

            firebase.firestore()
                .collection(COLLECTION)
                .orderBy("submittedAt", "desc")
                .limit(200)
                .get()
                .then(function(snapshot){
                    reportsCache = snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    });
                    renderTable();
                })
                .catch(function(error){
                    console.error("Unable to load incident reports:", error);
                });
        }

        /* ---- Report Incident form ---- */

        const formBackdrop = document.getElementById("incidentFormBackdrop");
        const branchSelect = document.getElementById("incidentBranchInput");

        function openForm(){
            const branches = window.CrownAuth?.getAllowedBranches?.(currentUser) || [];

            branchSelect.innerHTML = branches.map(function(b){
                return `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`;
            }).join("");

            document.getElementById("incidentDateInput").value = "";
            document.getElementById("incidentTimeInput").value = "";
            document.getElementById("incidentReportedByInput").value = currentUser.nickname || currentUser.account;
            document.getElementById("incidentInvolvedInput").value = "";
            document.getElementById("incidentDescriptionInput").value = "";
            document.getElementById("incidentActionsInput").value = "";
            formBackdrop.classList.remove("d-none");
        }

        function closeForm(){
            formBackdrop.classList.add("d-none");
        }

        document.getElementById("incidentReportBtn").addEventListener("click", openForm);
        document.getElementById("incidentFormCloseBtn").addEventListener("click", closeForm);
        document.getElementById("incidentFormCancelBtn").addEventListener("click", closeForm);

        formBackdrop.addEventListener("click", function(event){
            if(event.target === formBackdrop){
                closeForm();
            }
        });

        document.getElementById("incidentFormSubmitBtn").addEventListener("click", async function(){
            const incidentDate = document.getElementById("incidentDateInput").value;
            const incidentTime = document.getElementById("incidentTimeInput").value;
            const branch = branchSelect.value;
            const involvedPersons = document.getElementById("incidentInvolvedInput").value.trim();
            const description = document.getElementById("incidentDescriptionInput").value.trim();
            const actionsTaken = document.getElementById("incidentActionsInput").value.trim();

            if(!incidentDate || !branch || !description){
                alert("Please fill out the date, branch, and description.");
                return;
            }

            const btn = document.getElementById("incidentFormSubmitBtn");
            btn.disabled = true;

            try{
                await firebase.firestore().collection(COLLECTION).add({
                    incidentDate,
                    incidentTime,
                    branch,
                    involvedPersons,
                    description,
                    actionsTaken,
                    reportedByAccount: currentUser.account,
                    reportedByName: currentUser.nickname || currentUser.account,
                    reportedByEmail: crownToSyncEmail(currentUser.account),
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                closeForm();
                alert("Incident report submitted.");
            }catch(error){
                console.error("Unable to submit incident report:", error);
                alert("Unable to submit this report. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        /* ---- View modal ---- */

        const viewBackdrop = document.getElementById("incidentViewBackdrop");

        function closeView(){
            viewBackdrop.classList.add("d-none");
        }

        document.getElementById("incidentViewCloseBtn").addEventListener("click", closeView);
        document.getElementById("incidentViewCloseFooterBtn").addEventListener("click", closeView);

        viewBackdrop.addEventListener("click", function(event){
            if(event.target === viewBackdrop){
                closeView();
            }
        });
    });
})();
