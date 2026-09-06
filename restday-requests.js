/* ==========================================================================
   Crown Head Spa — Change Rest Day (Admin Hub)

   Firestore collection "restDayRequests" (see firestore.rules for the exact
   status-transition guard — mirrors leaveRequests). Approve/Decline/
   Processing-transition is gated in the UI to Admin, Executive Assistant,
   and accounts with the teamLeader flag — see isApprover() below. Unlike
   Leave Request, approving a rest day change does not write to
   staffSchedules; the approver updates the Staff Schedule grid by hand to
   reflect the new rest day.
   ========================================================================== */

(function(){
    const COLLECTION = "restDayRequests";

    let currentUser = null;
    let isApprover = false;
    let myRequestsCache = [];
    let allRequestsCache = [];

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function todayValue(){
        const now = new Date();
        return now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0");
    }

    function formatDate(dateString){
        if(!dateString){
            return "";
        }

        try{
            return new Date(dateString + "T00:00:00")
                .toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
        }catch(error){
            return dateString;
        }
    }

    function formatTimestamp(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "";
        }

        return timestamp.toDate().toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
        });
    }

    function statusBadge(status){
        const map = {
            "Pending": "bg-warning text-dark",
            "Processing": "bg-info text-dark",
            "Approved": "bg-success",
            "Declined": "bg-danger",
            "Canceled": "bg-secondary"
        };

        return `<span class="badge ${map[status] || "bg-secondary"}">${escapeHtml(status)}</span>`;
    }

    function sortByField(list, field){
        return list.slice().sort(function(a, b){
            const aTime = a[field]?.toMillis?.() || 0;
            const bTime = b[field]?.toMillis?.() || 0;
            return bTime - aTime;
        });
    }

    function renderMyRequests(){
        const body = document.getElementById("myRestdayTableBody");
        const empty = document.getElementById("myRestdayEmptyState");
        const rows = sortByField(myRequestsCache, "submittedAt");

        if(rows.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = rows.map(function(r){
            const canCancel = r.status === "Pending" || r.status === "Processing";

            return `
                <tr>
                    <td>${escapeHtml(formatTimestamp(r.submittedAt))}</td>
                    <td>${escapeHtml(formatDate(r.currentDate))}</td>
                    <td>${escapeHtml(formatDate(r.newDate))}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td>${canCancel ? `<button type="button" class="btn btn-sm btn-outline-danger restday-cancel-btn" data-id="${escapeHtml(r.id)}">Cancel</button>` : ""}</td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".restday-cancel-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Cancel this rest day change request?")){
                    return;
                }

                try{
                    await firebase.firestore().collection(COLLECTION).doc(btn.dataset.id).update({
                        status: "Canceled",
                        cancelReason: ""
                    });
                }catch(error){
                    console.error("Unable to cancel rest day change request:", error);
                    alert("Unable to cancel this request. It may have already been processed.");
                }
            });
        });
    }

    function renderAllRequests(){
        const body = document.getElementById("allRestdayTableBody");
        const empty = document.getElementById("allRestdayEmptyState");
        const rows = sortByField(allRequestsCache, "submittedAt");

        if(rows.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = rows.map(function(r){
            return `
                <tr>
                    <td>${escapeHtml(formatTimestamp(r.submittedAt))}</td>
                    <td>${escapeHtml(r.requesterName)}</td>
                    <td>${escapeHtml(formatDate(r.currentDate))}</td>
                    <td>${escapeHtml(formatDate(r.newDate))}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary restday-view-btn" data-id="${escapeHtml(r.id)}">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".restday-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openViewModal(btn.dataset.id);
            });
        });
    }

    async function openViewModal(id){
        const request = allRequestsCache.find(function(r){ return r.id === id; });

        if(!request){
            return;
        }

        if(request.status === "Pending"){
            try{
                await firebase.firestore().collection(COLLECTION).doc(id).update({
                    status: "Processing",
                    processingAt: firebase.firestore.FieldValue.serverTimestamp(),
                    processingBy: currentUser.account
                });
                request.status = "Processing";
            }catch(error){
                console.error("Unable to mark request as processing:", error);
            }
        }

        const body = document.getElementById("restdayViewBody");

        body.innerHTML = [
            ["Employee Name", request.requesterName],
            ["Position", request.position],
            ["Current Rest Day", formatDate(request.currentDate)],
            ["Requested New Rest Day", formatDate(request.newDate)],
            ["Reason for Change", request.reason],
            ["Employee Signature", request.declarationName],
            ["Date of Request", formatDate(request.dateOfRequest)],
            ["Status", request.status]
        ].map(function(pair){
            return `<div class="leave-view-row"><strong>${escapeHtml(pair[0])}</strong><span>${escapeHtml(pair[1] || "")}</span></div>`;
        }).join("");

        const canAct = isApprover && request.status === "Processing";
        document.getElementById("restdayApproveBtn").classList.toggle("d-none", !canAct);
        document.getElementById("restdayDeclineBtn").classList.toggle("d-none", !canAct);
        document.getElementById("restdayApproveBtn").dataset.id = id;
        document.getElementById("restdayDeclineBtn").dataset.id = id;

        document.getElementById("restdayViewBackdrop").classList.remove("d-none");
    }

    function getRequestBranches(request){
        if(Array.isArray(request.requesterBranches) && request.requesterBranches.length > 0){
            return request.requesterBranches;
        }

        const users = window.CrownAuth?.getUsers?.() || [];
        const requester = users.find(function(u){ return u.account === request.requesterAccount; });

        return requester?.branches || [];
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        isApprover = currentUser.role === "Admin" ||
            currentUser.role === "Executive Assistant" ||
            currentUser.teamLeader === true;

        const isBranchScopedApprover =
            currentUser.role !== "Admin" &&
            currentUser.role !== "Executive Assistant" &&
            currentUser.teamLeader === true;

        if(isApprover){
            document.getElementById("allRestdayCard").classList.remove("d-none");
        }

        firebase.firestore()
            .collection(COLLECTION)
            .where("requesterAccount", "==", currentUser.account)
            .onSnapshot(function(snapshot){
                myRequestsCache = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });
                renderMyRequests();
            }, function(error){
                console.error("Unable to load my rest day change requests:", error);
            });

        if(isApprover){
            firebase.firestore()
                .collection(COLLECTION)
                .onSnapshot(function(snapshot){
                    let requests = snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    });

                    if(isBranchScopedApprover){
                        const allowedBranches = window.CrownAuth?.getAllowedBranches?.(currentUser) || [];
                        requests = requests.filter(function(r){
                            return getRequestBranches(r).some(function(b){ return allowedBranches.includes(b); });
                        });
                    }

                    allRequestsCache = requests;
                    renderAllRequests();
                }, function(error){
                    console.error("Unable to load all rest day change requests:", error);
                });
        }

        /* ---- Request Rest Day Change Form ---- */

        const formBackdrop = document.getElementById("restdayFormBackdrop");

        function openForm(){
            document.getElementById("restdayEmployeeName").value = currentUser.nickname || currentUser.account;
            document.getElementById("restdayPosition").value = currentUser.role || "";
            document.getElementById("restdayCurrentDate").value = "";
            document.getElementById("restdayNewDate").value = "";
            document.getElementById("restdayReason").value = "";
            document.getElementById("restdayDeclarationName").value = currentUser.nickname || currentUser.account;
            document.getElementById("restdayDateOfRequest").value = todayValue();
            formBackdrop.classList.remove("d-none");
        }

        function closeForm(){
            formBackdrop.classList.add("d-none");
        }

        document.getElementById("restdayRequestBtn").addEventListener("click", openForm);
        document.getElementById("restdayFormCloseBtn").addEventListener("click", closeForm);
        document.getElementById("restdayFormCancelBtn").addEventListener("click", closeForm);

        formBackdrop.addEventListener("click", function(event){
            if(event.target === formBackdrop){
                closeForm();
            }
        });

        document.getElementById("restdayFormSubmitBtn").addEventListener("click", async function(){
            const currentDate = document.getElementById("restdayCurrentDate").value;
            const newDate = document.getElementById("restdayNewDate").value;
            const reason = document.getElementById("restdayReason").value.trim();
            const declarationName = document.getElementById("restdayDeclarationName").value.trim();

            if(!currentDate || !newDate || !reason || !declarationName){
                alert("Please fill out all required fields.");
                return;
            }

            if(newDate === currentDate){
                alert("The requested new rest day must be different from the current rest day.");
                return;
            }

            const btn = document.getElementById("restdayFormSubmitBtn");
            btn.disabled = true;

            try{
                await firebase.firestore().collection(COLLECTION).add({
                    requesterAccount: currentUser.account,
                    requesterName: currentUser.nickname || currentUser.account,
                    requesterEmail: crownToSyncEmail(currentUser.account),
                    requesterBranches: currentUser.branches || [],
                    position: document.getElementById("restdayPosition").value.trim(),
                    currentDate,
                    newDate,
                    reason,
                    declarationName,
                    dateOfRequest: todayValue(),
                    status: "Pending",
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    processingAt: null,
                    processingBy: null,
                    reviewedAt: null,
                    reviewedBy: null,
                    cancelReason: null
                });

                closeForm();
            }catch(error){
                console.error("Unable to submit rest day change request:", error);
                alert("Unable to submit this request. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        /* ---- View / Approve / Decline modal ---- */

        const viewBackdrop = document.getElementById("restdayViewBackdrop");

        function closeView(){
            viewBackdrop.classList.add("d-none");
        }

        document.getElementById("restdayViewCloseBtn").addEventListener("click", closeView);
        document.getElementById("restdayViewCloseFooterBtn").addEventListener("click", closeView);

        viewBackdrop.addEventListener("click", function(event){
            if(event.target === viewBackdrop){
                closeView();
            }
        });

        document.getElementById("restdayApproveBtn").addEventListener("click", async function(){
            const id = this.dataset.id;
            const request = allRequestsCache.find(function(r){ return r.id === id; });

            if(!request){
                return;
            }

            this.disabled = true;

            try{
                await firebase.firestore().collection(COLLECTION).doc(id).update({
                    status: "Approved",
                    reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: currentUser.account
                });

                closeView();
            }catch(error){
                console.error("Unable to approve rest day change request:", error);
                alert("Unable to approve this request. It may have already been handled.");
            }finally{
                this.disabled = false;
            }
        });

        document.getElementById("restdayDeclineBtn").addEventListener("click", async function(){
            const id = this.dataset.id;

            if(!confirm("Decline this rest day change request?")){
                return;
            }

            this.disabled = true;

            try{
                await firebase.firestore().collection(COLLECTION).doc(id).update({
                    status: "Declined",
                    reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: currentUser.account
                });

                closeView();
            }catch(error){
                console.error("Unable to decline rest day change request:", error);
                alert("Unable to decline this request. It may have already been handled.");
            }finally{
                this.disabled = false;
            }
        });
    });
})();
