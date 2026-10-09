/* ==========================================================================
   Crown Head Spa — Budget Request (Admin Hub)

   Firestore collection "budgetRequests". Requestors (Executive Assistant,
   Marketing Agent, Tech Support, Team Leader) file a request and only see
   their own; Admin sees every request and can Decline or Mark as Done
   (proof-of-payment attachment required, stored in Cloud Storage under
   budgetRequestAttachments/).

   Status stored: Pending | Declined | Done. Admin sees Pending as
   "New Request", coloured by how close the deadline is.
   ========================================================================== */

(function(){
    const COLLECTION = "budgetRequests";
    const DETAILS_COLLECTION = "budgetPaymentDetails";
    const ACCOUNT_MOPS = ["Gcash", "Gotyme", "Bank Transfer", "Others"];

    let currentUser = null;
    let isAdmin = false;
    let requestsCache = [];
    let activeId = null;
    let detailsCache = [];

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

    function formatMoney(value){
        return "₱" + Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function daysUntil(deadlineKey){
        const today = new Date(todayKey() + "T00:00:00");
        const deadline = new Date(deadlineKey + "T00:00:00");
        return Math.round((deadline - today) / 86400000);
    }

    /* Urgency class for a still-open request, from today vs. deadline. */
    function urgencyClass(request){
        if(request.status !== "Pending" || !request.deadline){
            return "";
        }

        const days = daysUntil(request.deadline);

        if(days <= 0){ return "budget-urgent"; }
        if(days <= 3){ return "budget-soon"; }
        return "budget-normal";
    }

    function statusHtml(request){
        if(request.status === "Declined"){
            return `<span class="budget-declined">Declined</span>`;
        }

        if(request.status === "Done"){
            return `<span class="budget-done">Done</span>`;
        }

        if(isAdmin){
            return `<span class="${urgencyClass(request)}">New Request</span>`;
        }

        return `<span class="budget-pending">Pending</span>`;
    }

    function mopText(request){
        return request.mop || "";
    }

    /* ---- Table ---- */

    function visibleRequests(){
        const month = $("budgetMonthFilter").value;
        const date = $("budgetDateFilter").value;
        const branch = $("budgetBranchFilter").value;

        return requestsCache.filter(function(r){
            if(branch && r.branch !== branch){
                return false;
            }

            if(date){
                return r.createdDate === date;
            }

            return !month || (r.createdDate || "").slice(0, 7) === month;
        });
    }

    function renderTable(){
        const body = $("budgetTableBody");
        const empty = $("budgetEmptyState");
        const list = visibleRequests();

        if(list.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = list.map(function(r){
            return `
                <tr>
                    <td>${escapeHtml(formatDay(r.createdDate))}</td>
                    <td>${escapeHtml(r.branch)}</td>
                    <td>${escapeHtml(r.purpose)}</td>
                    <td class="${urgencyClass(r)}">${escapeHtml(formatDay(r.deadline))}</td>
                    <td>${escapeHtml(mopText(r))}</td>
                    <td class="budget-amount">${escapeHtml(formatMoney(r.amount))}</td>
                    <td>${escapeHtml(r.requestedByName)}</td>
                    <td>${escapeHtml(r.note || "")}</td>
                    <td>${statusHtml(r)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary budget-view-btn" data-id="${escapeHtml(r.id)}">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".budget-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){ openView(btn.dataset.id); });
        });
    }

    /* ---- View modal ---- */

    function openView(id){
        const r = requestsCache.find(function(item){ return item.id === id; });

        if(!r){ return; }

        activeId = id;

        const rows = [
            ["Date Requested", formatDay(r.createdDate)],
            ["Branch", r.branch],
            ["Purpose", r.purpose],
            ["Deadline", formatDay(r.deadline)],
            ["Mode of Payment", r.mop]
        ];

        if(r.mop === "Bank Transfer" || r.mop === "Others"){
            /* Older Bank Transfer requests stored this as "bank". */
            rows.push(["Service Provider", r.serviceProvider || r.bank]);
        }

        if(ACCOUNT_MOPS.includes(r.mop)){
            rows.push(["Account Name", r.accountName]);
            rows.push(["Account Number", r.accountNumber]);
        }

        rows.push(["Amount", formatMoney(r.amount)]);
        rows.push(["Requested by", r.requestedByName]);
        rows.push(["Note", r.note]);

        let html = rows.map(function(pair){
            return `<div class="budget-view-row"><strong>${escapeHtml(pair[0])}</strong><span>${escapeHtml(pair[1] || "")}</span></div>`;
        }).join("");

        if(r.attachmentUrl){
            html += `<div class="budget-view-row"><strong>Attachment</strong><span><a href="${escapeHtml(r.attachmentUrl)}" target="_blank" rel="noopener">${escapeHtml(r.attachmentName || "View attachment")}</a></span></div>`;
        }

        html += `<div class="budget-view-row"><strong>Status</strong><span>${statusHtml(r)}</span></div>`;

        if(r.status === "Done" && r.proofUrl){
            html += `<div class="budget-view-row"><strong>Proof of Payment</strong><span><a href="${escapeHtml(r.proofUrl)}" target="_blank" rel="noopener">${escapeHtml(r.proofName || "View attachment")}</a></span></div>`;
        }

        $("budgetViewBody").innerHTML = html;

        const canAct = isAdmin && r.status === "Pending";
        $("budgetDeclineBtn").classList.toggle("d-none", !canAct);
        $("budgetDoneBtn").classList.toggle("d-none", !canAct);
        $("budgetDeclineBtn").disabled = false;

        $("budgetViewBackdrop").classList.remove("d-none");
    }

    function closeView(){
        $("budgetViewBackdrop").classList.add("d-none");
    }

    function actorFields(){
        return {
            actedByAccount: currentUser.account,
            actedByName: currentUser.nickname || currentUser.account,
            actedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
    }

    async function declineActive(){
        if(!activeId || !confirm("Decline this budget request?")){ return; }

        const btn = $("budgetDeclineBtn");
        btn.disabled = true;

        try{
            await firebase.firestore().collection(COLLECTION).doc(activeId)
                .update(Object.assign({ status: "Declined" }, actorFields()));
            closeView();
        }catch(error){
            console.error("Unable to decline budget request:", error);
            alert("Unable to decline this request. Please try again.");
            btn.disabled = false;
        }
    }

    /* ---- Proof of payment ---- */

    function openProof(){
        $("budgetProofInput").value = "";
        $("budgetProofBackdrop").classList.remove("d-none");
    }

    function closeProof(){
        $("budgetProofBackdrop").classList.add("d-none");
    }

    function uploadFile(file, branch, folder){
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const safeBranch = String(branch || "NoBranch").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${folder}/${safeBranch}/${Date.now()}_${safeName}`;
        const ref = firebase.storage().ref().child(path);

        return ref.put(file).then(function(){
            return ref.getDownloadURL();
        }).then(function(url){
            return { name: file.name, path: path, url: url };
        });
    }

    async function confirmDone(){
        const file = $("budgetProofInput").files[0];
        const r = requestsCache.find(function(item){ return item.id === activeId; });

        if(!r){ return; }

        if(!file){
            alert("Please attach the proof of payment.");
            return;
        }

        const btn = $("budgetProofConfirmBtn");
        btn.disabled = true;
        btn.textContent = "Uploading…";

        try{
            const proof = await uploadFile(file, r.branch, "budgetRequestAttachments");

            await firebase.firestore().collection(COLLECTION).doc(activeId).update(
                Object.assign({
                    status: "Done",
                    proofUrl: proof.url,
                    proofPath: proof.path,
                    proofName: proof.name
                }, actorFields())
            );

            closeProof();
            closeView();
        }catch(error){
            console.error("Unable to mark budget request done:", error);
            alert("Unable to complete this request: " + (error.message || "please try again."));
        }finally{
            btn.disabled = false;
            btn.textContent = "Confirm";
        }
    }

    /* ---- Saved payment details ---- */

    function detailLabel(d){
        const parts = [d.mop];

        if(d.serviceProvider){ parts.push(d.serviceProvider); }

        parts.push(d.accountName + " (" + d.accountNumber + ")");
        return parts.join(" — ");
    }

    function renderSavedSelect(){
        const mop = $("budgetMopInput").value;
        const matches = detailsCache.filter(function(d){ return d.mop === mop; });
        const field = $("budgetSavedField");

        if(!ACCOUNT_MOPS.includes(mop) || matches.length === 0){
            field.classList.add("d-none");
            $("budgetSavedSelect").innerHTML = "";
            return;
        }

        $("budgetSavedSelect").innerHTML =
            `<option value="">— Choose saved details (or type below) —</option>` +
            matches.map(function(d){
                return `<option value="${escapeHtml(d.id)}">${escapeHtml(detailLabel(d))}</option>`;
            }).join("");

        field.classList.remove("d-none");
    }

    function applySavedDetail(){
        const d = detailsCache.find(function(item){ return item.id === $("budgetSavedSelect").value; });

        if(!d){ return; }

        $("budgetProviderInput").value = d.serviceProvider || "";
        $("budgetAccountNameInput").value = d.accountName || "";
        $("budgetAccountNumberInput").value = d.accountNumber || "";
    }

    function renderDetailsList(){
        const list = $("budgetDetailsList");

        if(detailsCache.length === 0){
            list.innerHTML = `<div class="text-muted">Nothing saved yet.</div>`;
            return;
        }

        list.innerHTML = detailsCache.map(function(d){
            return `<div class="budget-detail-item"><span>${escapeHtml(detailLabel(d))}</span><button type="button" class="btn btn-sm btn-outline-danger budget-detail-delete" data-id="${escapeHtml(d.id)}">Delete</button></div>`;
        }).join("");

        list.querySelectorAll(".budget-detail-delete").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Delete these saved payment details?")){ return; }

                try{
                    await firebase.firestore().collection(DETAILS_COLLECTION).doc(btn.dataset.id).delete();
                }catch(error){
                    console.error("Unable to delete payment details:", error);
                    alert("Unable to delete. Please try again.");
                }
            });
        });
    }

    function syncDetailProviderField(){
        const mop = $("budgetDetailMop").value;
        $("budgetDetailProviderField").classList.toggle("d-none", mop !== "Bank Transfer" && mop !== "Others");
    }

    function openDetails(){
        $("budgetDetailMop").value = "Gcash";
        $("budgetDetailProvider").value = "";
        $("budgetDetailAccountName").value = "";
        $("budgetDetailAccountNumber").value = "";
        syncDetailProviderField();
        renderDetailsList();
        $("budgetDetailsBackdrop").classList.remove("d-none");
    }

    function closeDetails(){
        $("budgetDetailsBackdrop").classList.add("d-none");
    }

    async function saveDetail(){
        const mop = $("budgetDetailMop").value;
        const needsProvider = mop === "Bank Transfer" || mop === "Others";
        const serviceProvider = $("budgetDetailProvider").value.trim();
        const accountName = $("budgetDetailAccountName").value.trim();
        const accountNumber = $("budgetDetailAccountNumber").value.trim();

        if(needsProvider && !serviceProvider){ alert("Please enter the Service Provider."); return; }
        if(!accountName || !accountNumber){ alert("Please enter the Account Name and Account Number."); return; }

        const btn = $("budgetDetailSaveBtn");
        btn.disabled = true;

        try{
            await firebase.firestore().collection(DETAILS_COLLECTION).add({
                mop,
                serviceProvider: needsProvider ? serviceProvider : "",
                accountName,
                accountNumber,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            $("budgetDetailProvider").value = "";
            $("budgetDetailAccountName").value = "";
            $("budgetDetailAccountNumber").value = "";
        }catch(error){
            console.error("Unable to save payment details:", error);
            alert("Unable to save. Please try again.");
        }finally{
            btn.disabled = false;
        }
    }

    /* ---- Request form ---- */

    function syncAccountFields(){
        const mop = $("budgetMopInput").value;
        const show = ACCOUNT_MOPS.includes(mop);

        renderSavedSelect();

        $("budgetProviderField").classList.toggle("d-none", mop !== "Bank Transfer" && mop !== "Others");

        document.querySelectorAll(".budget-account-field").forEach(function(el){
            el.classList.toggle("d-none", !show);
        });
    }

    function openForm(){
        $("budgetBranchInput").value = "Biñan";
        $("budgetPurposeInput").value = "";
        $("budgetDeadlineInput").value = "";
        $("budgetDeadlineInput").min = todayKey();
        $("budgetMopInput").value = "Cash";
        $("budgetProviderInput").value = "";
        $("budgetAccountNameInput").value = "";
        $("budgetAccountNumberInput").value = "";
        $("budgetAmountInput").value = "";
        $("budgetNoteInput").value = "";
        $("budgetAttachmentInput").value = "";
        syncAccountFields();
        $("budgetFormBackdrop").classList.remove("d-none");
    }

    function closeForm(){
        $("budgetFormBackdrop").classList.add("d-none");
    }

    async function submitForm(){
        const branch = $("budgetBranchInput").value;
        const purpose = $("budgetPurposeInput").value.trim();
        const deadline = $("budgetDeadlineInput").value;
        const mop = $("budgetMopInput").value;
        const provider = $("budgetProviderInput").value.trim();
        const needsProvider = mop === "Bank Transfer" || mop === "Others";
        const accountName = $("budgetAccountNameInput").value.trim();
        const accountNumber = $("budgetAccountNumberInput").value.trim();
        const amount = parseFloat($("budgetAmountInput").value);
        const note = $("budgetNoteInput").value.trim();

        if(!purpose){ alert("Please enter the Purpose."); return; }
        if(!deadline){ alert("Please select a Deadline."); return; }

        if(needsProvider && !provider){
            alert("Please enter the Service Provider.");
            return;
        }

        if(ACCOUNT_MOPS.includes(mop) && (!accountName || !accountNumber)){
            alert("Please enter the Account Name and Account Number.");
            return;
        }

        if(!(amount > 0)){ alert("Please enter a valid Amount."); return; }

        const needsAccount = ACCOUNT_MOPS.includes(mop);
        const attachmentFile = $("budgetAttachmentInput").files[0];
        const btn = $("budgetFormSubmitBtn");
        btn.disabled = true;

        try{
            let attachment = null;

            if(attachmentFile){
                attachment = await uploadFile(attachmentFile, branch, "budgetRequestFiles");
            }

            await firebase.firestore().collection(COLLECTION).add({
                branch,
                purpose,
                deadline,
                mop,
                serviceProvider: needsProvider ? provider : "",
                accountName: needsAccount ? accountName : "",
                accountNumber: needsAccount ? accountNumber : "",
                amount,
                note,
                attachmentUrl: attachment ? attachment.url : "",
                attachmentPath: attachment ? attachment.path : "",
                attachmentName: attachment ? attachment.name : "",
                status: "Pending",
                createdDate: todayKey(),
                requestedByAccount: currentUser.account,
                requestedByName: currentUser.nickname || currentUser.account,
                requesterEmail: crownToSyncEmail(currentUser.account),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            closeForm();
            alert("Budget request submitted.");
        }catch(error){
            console.error("Unable to submit budget request:", error);
            alert("Unable to submit this request. Please try again.");
        }finally{
            btn.disabled = false;
        }
    }

    /* ---- Init ---- */

    function bindBackdropClose(backdropId, closeFn){
        const el = $(backdropId);
        el.addEventListener("click", function(event){
            if(event.target === el){ closeFn(); }
        });
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        isAdmin = currentUser.role === "Admin";

        $("budgetMonthFilter").value = todayKey().slice(0, 7);
        $("budgetMonthFilter").addEventListener("change", renderTable);
        $("budgetDateFilter").addEventListener("change", renderTable);
        $("budgetBranchFilter").addEventListener("change", renderTable);
        $("budgetClearDateBtn").addEventListener("click", function(){
            $("budgetDateFilter").value = "";
            renderTable();
        });

        /* Admin reads everything; everyone else only their own requests
           (matches the firestore.rules read condition). */
        let query = firebase.firestore().collection(COLLECTION);

        if(!isAdmin){
            query = query.where("requesterEmail", "==", crownToSyncEmail(currentUser.account));
        }

        query.limit(1000).onSnapshot(function(snapshot){
            requestsCache = snapshot.docs.map(function(doc){
                return Object.assign({ id: doc.id }, doc.data());
            }).sort(function(a, b){
                const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Date.now();
                const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Date.now();
                return tb - ta;
            });
            renderTable();
        }, function(error){
            console.error("Unable to load budget requests:", error);
        });

        firebase.firestore().collection(DETAILS_COLLECTION).onSnapshot(function(snapshot){
            detailsCache = snapshot.docs.map(function(doc){
                return Object.assign({ id: doc.id }, doc.data());
            }).sort(function(a, b){
                return detailLabel(a).localeCompare(detailLabel(b));
            });
            renderSavedSelect();
            renderDetailsList();
        }, function(error){
            console.error("Unable to load payment details:", error);
        });

        if(isAdmin){
            $("budgetDetailsBtn").classList.remove("d-none");
        }

        $("budgetDetailsBtn").addEventListener("click", openDetails);
        $("budgetDetailsCloseBtn").addEventListener("click", closeDetails);
        $("budgetDetailsDoneBtn").addEventListener("click", closeDetails);
        $("budgetDetailMop").addEventListener("change", syncDetailProviderField);
        $("budgetDetailSaveBtn").addEventListener("click", saveDetail);
        $("budgetSavedSelect").addEventListener("change", applySavedDetail);
        bindBackdropClose("budgetDetailsBackdrop", closeDetails);

        $("budgetRequestBtn").addEventListener("click", openForm);
        $("budgetFormCloseBtn").addEventListener("click", closeForm);
        $("budgetFormCancelBtn").addEventListener("click", closeForm);
        $("budgetFormSubmitBtn").addEventListener("click", submitForm);
        $("budgetMopInput").addEventListener("change", syncAccountFields);
        bindBackdropClose("budgetFormBackdrop", closeForm);

        $("budgetViewCloseBtn").addEventListener("click", closeView);
        $("budgetBackBtn").addEventListener("click", closeView);
        $("budgetDeclineBtn").addEventListener("click", declineActive);
        $("budgetDoneBtn").addEventListener("click", openProof);
        bindBackdropClose("budgetViewBackdrop", closeView);

        $("budgetProofCloseBtn").addEventListener("click", closeProof);
        $("budgetProofCancelBtn").addEventListener("click", closeProof);
        $("budgetProofConfirmBtn").addEventListener("click", confirmDone);
    });
})();
