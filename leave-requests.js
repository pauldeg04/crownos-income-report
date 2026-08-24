/* ==========================================================================
   Crown Head Spa — Leave Request (Admin Hub)

   Firestore collection "leaveRequests" (see firestore.rules for the exact
   status-transition guard). Approve/Decline/Processing-transition is
   gated in the UI to Admin, Executive Assistant, and accounts with the
   teamLeader flag — see isApprover() below. On Approve, one staffSchedules
   doc per date in range is written with source:"leave" so the requester's
   Staff Schedule picks it up automatically.
   ========================================================================== */

(function(){
    const COLLECTION = "leaveRequests";
    const SCHEDULES_COLLECTION = "staffSchedules";

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

    function datesBetween(from, to){
        const dates = [];
        let cursor = new Date(from + "T00:00:00");
        const end = new Date(to + "T00:00:00");

        while(cursor <= end){
            dates.push(
                cursor.getFullYear() + "-" +
                String(cursor.getMonth() + 1).padStart(2, "0") + "-" +
                String(cursor.getDate()).padStart(2, "0")
            );
            cursor.setDate(cursor.getDate() + 1);
        }

        return dates;
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
        const body = document.getElementById("myLeaveTableBody");
        const empty = document.getElementById("myLeaveEmptyState");
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
                    <td>${escapeHtml(formatDate(r.dateFrom))} – ${escapeHtml(formatDate(r.dateTo))}</td>
                    <td>${escapeHtml(String(r.totalDays))} day(s)</td>
                    <td>${statusBadge(r.status)}</td>
                    <td>${canCancel ? `<button type="button" class="btn btn-sm btn-outline-danger leave-cancel-btn" data-id="${escapeHtml(r.id)}">Cancel</button>` : ""}</td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".leave-cancel-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Cancel this leave request?")){
                    return;
                }

                try{
                    await firebase.firestore().collection(COLLECTION).doc(btn.dataset.id).update({
                        status: "Canceled",
                        cancelReason: ""
                    });
                }catch(error){
                    console.error("Unable to cancel leave request:", error);
                    alert("Unable to cancel this request. It may have already been processed.");
                }
            });
        });
    }

    function renderAllRequests(){
        const body = document.getElementById("allLeaveTableBody");
        const empty = document.getElementById("allLeaveEmptyState");
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
                    <td>${escapeHtml(formatDate(r.dateFrom))} – ${escapeHtml(formatDate(r.dateTo))}</td>
                    <td>${escapeHtml(String(r.totalDays))} day(s)</td>
                    <td>${statusBadge(r.status)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary leave-view-btn" data-id="${escapeHtml(r.id)}">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".leave-view-btn").forEach(function(btn){
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

        const body = document.getElementById("leaveViewBody");

        body.innerHTML = [
            ["Employee Name", request.requesterName],
            ["Position", request.position],
            ["Type of Leave", request.leaveType === "Others" ? ("Others — " + (request.leaveTypeOther || "")) : request.leaveType],
            ["Leave Dates", formatDate(request.dateFrom) + " to " + formatDate(request.dateTo)],
            ["Total Number of Days", String(request.totalDays)],
            ["Reason for Leave", request.reason],
            ["Employee Signature", request.declarationName],
            ["Date of Request", formatDate(request.dateOfRequest)],
            ["Status", request.status]
        ].map(function(pair){
            return `<div class="leave-view-row"><strong>${escapeHtml(pair[0])}</strong><span>${escapeHtml(pair[1] || "")}</span></div>`;
        }).join("");

        const canAct = isApprover && request.status === "Processing";
        document.getElementById("leaveApproveBtn").classList.toggle("d-none", !canAct);
        document.getElementById("leaveDeclineBtn").classList.toggle("d-none", !canAct);
        document.getElementById("leaveApproveBtn").dataset.id = id;
        document.getElementById("leaveDeclineBtn").dataset.id = id;

        document.getElementById("leaveViewBackdrop").classList.remove("d-none");
    }

    async function writeApprovedSchedule(request){
        const users = window.CrownAuth?.getUsers?.() || [];
        const requester = users.find(function(u){ return u.account === request.requesterAccount; });
        const staffRole = requester?.role === "Receptionist" ? "Receptionist" : "Therapist";
        const branches = requester?.branches || [];
        const branch = branches[0] || "";

        const dates = datesBetween(request.dateFrom, request.dateTo);
        const batch = firebase.firestore().batch();

        dates.forEach(function(date){
            const ref = firebase.firestore().collection(SCHEDULES_COLLECTION).doc();
            batch.set(ref, {
                branch,
                date,
                staffAccount: request.requesterAccount,
                staffName: request.requesterName,
                staffRole,
                shiftLabel: "On Leave",
                source: "leave",
                leaveRequestId: request.id,
                createdBy: currentUser.account,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
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

        if(isApprover){
            document.getElementById("allLeaveCard").classList.remove("d-none");
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
                console.error("Unable to load my leave requests:", error);
            });

        if(isApprover){
            firebase.firestore()
                .collection(COLLECTION)
                .onSnapshot(function(snapshot){
                    allRequestsCache = snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    });
                    renderAllRequests();
                }, function(error){
                    console.error("Unable to load all leave requests:", error);
                });
        }

        /* ---- Request Leave Form ---- */

        const formBackdrop = document.getElementById("leaveFormBackdrop");

        function openForm(){
            document.getElementById("leaveEmployeeName").value = currentUser.nickname || currentUser.account;
            document.getElementById("leavePosition").value = currentUser.role || "";
            document.querySelectorAll("input[name=leaveType]").forEach(function(r){ r.checked = false; });
            document.getElementById("leaveTypeOtherInput").value = "";
            document.getElementById("leaveTypeOtherInput").classList.add("d-none");
            document.getElementById("leaveDateFrom").value = "";
            document.getElementById("leaveDateTo").value = "";
            document.getElementById("leaveTotalDays").value = "";
            document.getElementById("leaveReason").value = "";
            document.getElementById("leaveDeclarationName").value = currentUser.nickname || currentUser.account;
            document.getElementById("leaveDateOfRequest").value = todayValue();
            formBackdrop.classList.remove("d-none");
        }

        function closeForm(){
            formBackdrop.classList.add("d-none");
        }

        document.getElementById("leaveRequestBtn").addEventListener("click", openForm);
        document.getElementById("leaveFormCloseBtn").addEventListener("click", closeForm);
        document.getElementById("leaveFormCancelBtn").addEventListener("click", closeForm);

        formBackdrop.addEventListener("click", function(event){
            if(event.target === formBackdrop){
                closeForm();
            }
        });

        document.querySelectorAll("input[name=leaveType]").forEach(function(radio){
            radio.addEventListener("change", function(){
                document.getElementById("leaveTypeOtherInput").classList.toggle("d-none", radio.value !== "Others" || !radio.checked);
            });
        });

        function recomputeTotalDays(){
            const from = document.getElementById("leaveDateFrom").value;
            const to = document.getElementById("leaveDateTo").value;

            if(from && to && to >= from){
                document.getElementById("leaveTotalDays").value = datesBetween(from, to).length;
            }
        }

        document.getElementById("leaveDateFrom").addEventListener("change", recomputeTotalDays);
        document.getElementById("leaveDateTo").addEventListener("change", recomputeTotalDays);

        document.getElementById("leaveFormSubmitBtn").addEventListener("click", async function(){
            const leaveTypeInput = document.querySelector("input[name=leaveType]:checked");
            const dateFrom = document.getElementById("leaveDateFrom").value;
            const dateTo = document.getElementById("leaveDateTo").value;
            const totalDays = Number(document.getElementById("leaveTotalDays").value);
            const reason = document.getElementById("leaveReason").value.trim();
            const declarationName = document.getElementById("leaveDeclarationName").value.trim();

            if(!leaveTypeInput || !dateFrom || !dateTo || !totalDays || !reason || !declarationName){
                alert("Please fill out all required fields.");
                return;
            }

            if(dateTo < dateFrom){
                alert("The 'To' date must be on or after the 'From' date.");
                return;
            }

            const btn = document.getElementById("leaveFormSubmitBtn");
            btn.disabled = true;

            try{
                await firebase.firestore().collection(COLLECTION).add({
                    requesterAccount: currentUser.account,
                    requesterName: currentUser.nickname || currentUser.account,
                    requesterEmail: crownToSyncEmail(currentUser.account),
                    position: document.getElementById("leavePosition").value.trim(),
                    leaveType: leaveTypeInput.value,
                    leaveTypeOther: leaveTypeInput.value === "Others" ? document.getElementById("leaveTypeOtherInput").value.trim() : "",
                    dateFrom,
                    dateTo,
                    totalDays,
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
                console.error("Unable to submit leave request:", error);
                alert("Unable to submit this request. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        /* ---- View / Approve / Decline modal ---- */

        const viewBackdrop = document.getElementById("leaveViewBackdrop");

        function closeView(){
            viewBackdrop.classList.add("d-none");
        }

        document.getElementById("leaveViewCloseBtn").addEventListener("click", closeView);
        document.getElementById("leaveViewCloseFooterBtn").addEventListener("click", closeView);

        viewBackdrop.addEventListener("click", function(event){
            if(event.target === viewBackdrop){
                closeView();
            }
        });

        document.getElementById("leaveApproveBtn").addEventListener("click", async function(){
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

                await writeApprovedSchedule(request);

                closeView();
            }catch(error){
                console.error("Unable to approve leave request:", error);
                alert("Unable to approve this request. It may have already been handled.");
            }finally{
                this.disabled = false;
            }
        });

        document.getElementById("leaveDeclineBtn").addEventListener("click", async function(){
            const id = this.dataset.id;

            if(!confirm("Decline this leave request?")){
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
                console.error("Unable to decline leave request:", error);
                alert("Unable to decline this request. It may have already been handled.");
            }finally{
                this.disabled = false;
            }
        });
    });
})();
