/* ==========================================================================
   Crown Head Spa — Inventory > Tech Support (Maintenance / Collaterals)

   Two independent Firestore collections, "maintenanceRequests" and
   "collateralsRequests" — same status ladder on both:
   Request Submitted -> Processing -> Done (or Canceled by the requester
   while still open). See firestore.rules for the transition guard. Every
   role can submit; only Admin/Tech Support can view "All Requests" and
   act on them (mirrors Warehouse's own Admin/Tech Support access). Every
   submission also notifies Admin, Executive Assistant, and Tech Support
   accounts via CrownClientNotifications.
   ========================================================================== */

(function(){
    const MAINTENANCE_COLLECTION = "maintenanceRequests";
    const COLLATERALS_COLLECTION = "collateralsRequests";

    const COLLATERAL_ITEMS = [
        "Flyers",
        "Welcome Card",
        "Temporary Loyalty Card",
        "Loyalty Card",
        "Giveaways",
        "Bottled Water Sticker"
    ];

    let currentUser = null;
    let isProcessor = false;

    let myMaintenanceCache = [];
    let allMaintenanceCache = [];
    let myCollateralsCache = [];
    let allCollateralsCache = [];

    let collateralsLines = [];

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
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
            "Request Submitted": "status-submitted",
            "Processing": "status-processing",
            "Done": "status-done",
            "Canceled": "status-canceled"
        };

        return `<span class="inv-status ${map[status] || "status-canceled"}">${escapeHtml(status)}</span>`;
    }

    function sortByField(list, field){
        return list.slice().sort(function(a, b){
            const aTime = a[field]?.toMillis?.() || 0;
            const bTime = b[field]?.toMillis?.() || 0;
            return bTime - aTime;
        });
    }

    function notifyRequestSubmitted(kind, message){
        const users = window.CrownAuth?.getUsers?.() || [];
        const recipients = users
            .filter(function(u){
                return ["Admin", "Executive Assistant", "Tech Support"].includes(u.role);
            })
            .map(function(u){ return u.account; });

        window.CrownClientNotifications?.broadcast?.(recipients, message, kind);
    }

    function populateBranchSelect(selectEl){
        const branches = window.CrownAuth?.getAllBranchNames?.() || [];
        const preferred = localStorage.getItem("crownSelectedBranch") || currentUser?.branches?.[0] || "";

        selectEl.innerHTML = branches.map(function(branch){
            return `<option value="${escapeHtml(branch)}">${escapeHtml(branch)}</option>`;
        }).join("");

        if(preferred && branches.includes(preferred)){
            selectEl.value = preferred;
        }
    }

    /* ---------------------------------------------------------------- */
    /* Maintenance                                                       */
    /* ---------------------------------------------------------------- */

    function renderMyMaintenance(){
        const body = document.getElementById("myMaintenanceTableBody");
        const empty = document.getElementById("myMaintenanceEmptyState");
        const rows = sortByField(myMaintenanceCache, "submittedAt");

        if(rows.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = rows.map(function(r){
            const canCancel = r.status === "Request Submitted" || r.status === "Processing";

            return `
                <tr>
                    <td>${escapeHtml(formatTimestamp(r.submittedAt))}</td>
                    <td>${escapeHtml(r.subject)}</td>
                    <td>${escapeHtml(r.description)}</td>
                    <td>${escapeHtml(formatDate(r.deadline))}</td>
                    <td>${escapeHtml(r.remarks || "")}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td class="action-buttons">
                        <button type="button" class="btn btn-sm btn-outline-primary maintenance-view-btn" data-id="${escapeHtml(r.id)}" data-scope="my">View</button>
                        ${canCancel ? `<button type="button" class="btn btn-sm btn-outline-danger maintenance-cancel-btn" data-id="${escapeHtml(r.id)}">Cancel</button>` : ""}
                    </td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".maintenance-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openMaintenanceViewModal(btn.dataset.id, myMaintenanceCache);
            });
        });

        body.querySelectorAll(".maintenance-cancel-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Cancel this maintenance request?")){
                    return;
                }

                try{
                    await firebase.firestore().collection(MAINTENANCE_COLLECTION).doc(btn.dataset.id).update({
                        status: "Canceled",
                        cancelReason: ""
                    });
                }catch(error){
                    console.error("Unable to cancel maintenance request:", error);
                    alert("Unable to cancel this request. It may have already been processed.");
                }
            });
        });
    }

    function renderAllMaintenance(){
        const body = document.getElementById("allMaintenanceTableBody");
        const empty = document.getElementById("allMaintenanceEmptyState");
        const rows = sortByField(allMaintenanceCache, "submittedAt");

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
                    <td>${escapeHtml(r.subject)}</td>
                    <td>${escapeHtml(r.description)}</td>
                    <td>${escapeHtml(formatDate(r.deadline))}</td>
                    <td>${escapeHtml(r.remarks || "")}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary maintenance-view-btn" data-id="${escapeHtml(r.id)}" data-scope="all">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".maintenance-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openMaintenanceViewModal(btn.dataset.id, allMaintenanceCache);
            });
        });
    }

    async function openMaintenanceViewModal(id, cache){
        const request = cache.find(function(r){ return r.id === id; });

        if(!request){
            return;
        }

        if(isProcessor && request.status === "Request Submitted"){
            try{
                await firebase.firestore().collection(MAINTENANCE_COLLECTION).doc(id).update({
                    status: "Processing",
                    processingAt: firebase.firestore.FieldValue.serverTimestamp(),
                    processingBy: currentUser.account
                });
                request.status = "Processing";
            }catch(error){
                console.error("Unable to mark maintenance request as processing:", error);
            }
        }

        const attachments = Array.isArray(request.attachments) ? request.attachments : [];

        const body = document.getElementById("maintenanceViewBody");
        body.innerHTML = [
            ["Requested By", request.requesterName],
            ["Branch", request.branch],
            ["Subject", request.subject],
            ["Description", request.description],
            ["Deadline", formatDate(request.deadline)],
            ["Status", request.status]
        ].map(function(pair){
            return `<div class="tech-support-view-row"><strong>${escapeHtml(pair[0])}</strong><span>${escapeHtml(pair[1] || "")}</span></div>`;
        }).join("") + (attachments.length > 0 ? `
            <div class="tech-support-attachment-list">
                ${attachments.map(function(file){
                    return `<div class="tech-support-attachment-row"><span>${escapeHtml(file.name)}</span><a href="${escapeHtml(file.url)}" target="_blank" rel="noopener">Open</a></div>`;
                }).join("")}
            </div>
        ` : "");

        const remarksWrap = document.getElementById("maintenanceRemarksWrap");
        const remarksInput = document.getElementById("maintenanceRemarksInput");
        const markDoneWrap = document.getElementById("maintenanceMarkDoneWrap");
        const markDoneCheckbox = document.getElementById("maintenanceMarkDoneCheckbox");

        const canAct = isProcessor && request.status === "Processing";

        remarksInput.value = request.remarks || "";
        remarksWrap.classList.toggle("d-none", !canAct);
        markDoneWrap.classList.toggle("d-none", !canAct);
        markDoneCheckbox.checked = false;
        markDoneCheckbox.dataset.id = id;

        document.getElementById("maintenanceViewBackdrop").classList.remove("d-none");
    }

    function initMaintenance(){
        firebase.firestore()
            .collection(MAINTENANCE_COLLECTION)
            .where("requesterAccount", "==", currentUser.account)
            .onSnapshot(function(snapshot){
                myMaintenanceCache = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });
                renderMyMaintenance();
            }, function(error){
                console.error("Unable to load my maintenance requests:", error);
            });

        if(isProcessor){
            document.getElementById("allMaintenanceCard").classList.remove("d-none");

            firebase.firestore()
                .collection(MAINTENANCE_COLLECTION)
                .onSnapshot(function(snapshot){
                    allMaintenanceCache = snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    });
                    renderAllMaintenance();
                }, function(error){
                    console.error("Unable to load all maintenance requests:", error);
                });
        }

        const formBackdrop = document.getElementById("maintenanceFormBackdrop");
        const attachmentInput = document.getElementById("maintenanceAttachmentInput");
        const attachmentList = document.getElementById("maintenanceAttachmentList");

        function openForm(){
            populateBranchSelect(document.getElementById("maintenanceBranchInput"));
            document.getElementById("maintenanceDeadlineInput").value = "";
            document.getElementById("maintenanceSubjectInput").value = "";
            document.getElementById("maintenanceDescriptionInput").value = "";
            attachmentInput.value = "";
            attachmentList.innerHTML = "";
            formBackdrop.classList.remove("d-none");
        }

        function closeForm(){
            formBackdrop.classList.add("d-none");
        }

        document.getElementById("maintenanceRequestBtn").addEventListener("click", openForm);
        document.getElementById("maintenanceFormCloseBtn").addEventListener("click", closeForm);
        document.getElementById("maintenanceFormCancelBtn").addEventListener("click", closeForm);

        formBackdrop.addEventListener("click", function(event){
            if(event.target === formBackdrop){
                closeForm();
            }
        });

        attachmentInput.addEventListener("change", function(){
            const files = Array.from(attachmentInput.files || []);
            attachmentList.innerHTML = files.map(function(file){
                return `<div class="tech-support-attachment-row"><span>${escapeHtml(file.name)}</span></div>`;
            }).join("");
        });

        function uploadMaintenanceAttachment(file, branch){
            return new Promise(function(resolve, reject){
                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                const safeBranch = String(branch || "NoBranch").replace(/[^a-zA-Z0-9._-]/g, "_");
                const path = `maintenanceAttachments/${safeBranch}/${Date.now()}_${safeName}`;
                const ref = firebase.storage().ref().child(path);
                const task = ref.put(file);

                task.on("state_changed", null, function(err){
                    reject(err);
                }, function(){
                    ref.getDownloadURL().then(function(url){
                        resolve({ name: file.name, size: file.size, path: path, url: url });
                    });
                });
            });
        }

        document.getElementById("maintenanceFormSubmitBtn").addEventListener("click", async function(){
            const branch = document.getElementById("maintenanceBranchInput").value;
            const deadline = document.getElementById("maintenanceDeadlineInput").value;
            const subject = document.getElementById("maintenanceSubjectInput").value.trim();
            const description = document.getElementById("maintenanceDescriptionInput").value.trim();
            const files = Array.from(attachmentInput.files || []);

            if(!branch || !deadline || !subject || !description){
                alert("Please fill out all required fields.");
                return;
            }

            const btn = this;
            btn.disabled = true;

            try{
                const attachments = await Promise.all(
                    files.map(function(file){ return uploadMaintenanceAttachment(file, branch); })
                );

                await firebase.firestore().collection(MAINTENANCE_COLLECTION).add({
                    requesterAccount: currentUser.account,
                    requesterName: currentUser.nickname || currentUser.account,
                    requesterEmail: crownToSyncEmail(currentUser.account),
                    branch,
                    subject,
                    description,
                    deadline,
                    attachments,
                    status: "Request Submitted",
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    processingAt: null,
                    processingBy: null,
                    doneAt: null,
                    doneBy: null,
                    remarks: "",
                    cancelReason: null
                });

                notifyRequestSubmitted(
                    "tech-support-maintenance",
                    `New maintenance request from ${currentUser.nickname || currentUser.account}: ${subject}`
                );

                closeForm();
            }catch(error){
                console.error("Unable to submit maintenance request:", error);
                alert("Unable to submit this request. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        const viewBackdrop = document.getElementById("maintenanceViewBackdrop");

        function closeView(){
            viewBackdrop.classList.add("d-none");
        }

        document.getElementById("maintenanceViewCloseBtn").addEventListener("click", closeView);
        document.getElementById("maintenanceViewCloseFooterBtn").addEventListener("click", closeView);

        viewBackdrop.addEventListener("click", function(event){
            if(event.target === viewBackdrop){
                closeView();
            }
        });

        document.getElementById("maintenanceMarkDoneCheckbox").addEventListener("change", async function(){
            if(!this.checked){
                return;
            }

            const id = this.dataset.id;
            const remarks = document.getElementById("maintenanceRemarksInput").value.trim();

            this.disabled = true;

            try{
                await firebase.firestore().collection(MAINTENANCE_COLLECTION).doc(id).update({
                    status: "Done",
                    doneAt: firebase.firestore.FieldValue.serverTimestamp(),
                    doneBy: currentUser.account,
                    remarks
                });

                closeView();
            }catch(error){
                console.error("Unable to mark maintenance request as done:", error);
                alert("Unable to update this request. It may have already been handled.");
                this.checked = false;
            }finally{
                this.disabled = false;
            }
        });
    }

    /* ---------------------------------------------------------------- */
    /* Collaterals                                                       */
    /* ---------------------------------------------------------------- */

    function formatCollateralItems(items){
        return (items || []).map(function(line){
            return `${line.qty}× ${line.item}`;
        }).join(", ");
    }

    function renderMyCollaterals(){
        const body = document.getElementById("myCollateralsTableBody");
        const empty = document.getElementById("myCollateralsEmptyState");
        const rows = sortByField(myCollateralsCache, "submittedAt");

        if(rows.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = rows.map(function(r){
            const canCancel = r.status === "Request Submitted" || r.status === "Processing";

            return `
                <tr>
                    <td>${escapeHtml(formatTimestamp(r.submittedAt))}</td>
                    <td>${escapeHtml(formatCollateralItems(r.items))}</td>
                    <td>${escapeHtml(formatDate(r.deadline))}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td class="action-buttons">
                        <button type="button" class="btn btn-sm btn-outline-primary collaterals-view-btn" data-id="${escapeHtml(r.id)}" data-scope="my">View</button>
                        ${canCancel ? `<button type="button" class="btn btn-sm btn-outline-danger collaterals-cancel-btn" data-id="${escapeHtml(r.id)}">Cancel</button>` : ""}
                    </td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".collaterals-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openCollateralsViewModal(btn.dataset.id, myCollateralsCache);
            });
        });

        body.querySelectorAll(".collaterals-cancel-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Cancel this collaterals request?")){
                    return;
                }

                try{
                    await firebase.firestore().collection(COLLATERALS_COLLECTION).doc(btn.dataset.id).update({
                        status: "Canceled",
                        cancelReason: ""
                    });
                }catch(error){
                    console.error("Unable to cancel collaterals request:", error);
                    alert("Unable to cancel this request. It may have already been processed.");
                }
            });
        });
    }

    function renderAllCollaterals(){
        const body = document.getElementById("allCollateralsTableBody");
        const empty = document.getElementById("allCollateralsEmptyState");
        const rows = sortByField(allCollateralsCache, "submittedAt");

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
                    <td>${escapeHtml(formatCollateralItems(r.items))}</td>
                    <td>${escapeHtml(formatDate(r.deadline))}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary collaterals-view-btn" data-id="${escapeHtml(r.id)}" data-scope="all">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".collaterals-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openCollateralsViewModal(btn.dataset.id, allCollateralsCache);
            });
        });
    }

    async function openCollateralsViewModal(id, cache){
        const request = cache.find(function(r){ return r.id === id; });

        if(!request){
            return;
        }

        if(isProcessor && request.status === "Request Submitted"){
            try{
                await firebase.firestore().collection(COLLATERALS_COLLECTION).doc(id).update({
                    status: "Processing",
                    processingAt: firebase.firestore.FieldValue.serverTimestamp(),
                    processingBy: currentUser.account
                });
                request.status = "Processing";
            }catch(error){
                console.error("Unable to mark collaterals request as processing:", error);
            }
        }

        const itemsHtml = (request.items || []).map(function(line){
            return `<div class="tech-support-view-row"><strong>${escapeHtml(line.item)}</strong><span>Qty: ${escapeHtml(String(line.qty))}${line.description ? " — " + escapeHtml(line.description) : ""}</span></div>`;
        }).join("");

        const body = document.getElementById("collateralsViewBody");
        body.innerHTML = [
            ["Requested By", request.requesterName],
            ["Branch", request.branch],
            ["Deadline", formatDate(request.deadline)],
            ["Status", request.status]
        ].map(function(pair){
            return `<div class="tech-support-view-row"><strong>${escapeHtml(pair[0])}</strong><span>${escapeHtml(pair[1] || "")}</span></div>`;
        }).join("") + `<h6 class="fw-bold text-primary mt-3 mb-2">Items</h6>` + itemsHtml;

        const canAct = isProcessor && request.status === "Processing";
        const sendStockBtn = document.getElementById("collateralsSendStockBtn");
        sendStockBtn.classList.toggle("d-none", !canAct);
        sendStockBtn.dataset.id = id;

        document.getElementById("collateralsViewBackdrop").classList.remove("d-none");
    }

    function addCollateralsLine(){
        const lineId = "CLN" + Date.now() + Math.floor(Math.random() * 1000);

        const wrapper = document.createElement("div");
        wrapper.className = "inv-request-line";

        wrapper.innerHTML = `
            <div>
                <label class="form-label">Item *</label>
                <select class="form-select line-item-select">
                    <option value="">Select Item</option>
                    ${COLLATERAL_ITEMS.map(function(name){
                        return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                    }).join("")}
                </select>
            </div>

            <div>
                <label class="form-label">Quantity *</label>
                <input type="number" class="form-control line-qty-input" min="1" step="1" placeholder="0">
            </div>

            <div>
                <button type="button" class="inv-remove-line-btn line-remove-btn">Remove</button>
            </div>

            <div class="tech-support-line-desc">
                <label class="form-label">Description</label>
                <input type="text" class="form-control line-desc-input" placeholder="Optional notes for this item">
            </div>
        `;

        wrapper.querySelector(".line-remove-btn").addEventListener("click", function(){
            wrapper.remove();
            collateralsLines = collateralsLines.filter(function(entry){ return entry.lineId !== lineId; });
        });

        document.getElementById("collateralsLinesContainer").appendChild(wrapper);

        collateralsLines.push({
            lineId,
            wrapper,
            itemSelect: wrapper.querySelector(".line-item-select"),
            qtyInput: wrapper.querySelector(".line-qty-input"),
            descInput: wrapper.querySelector(".line-desc-input")
        });
    }

    function initCollaterals(){
        firebase.firestore()
            .collection(COLLATERALS_COLLECTION)
            .where("requesterAccount", "==", currentUser.account)
            .onSnapshot(function(snapshot){
                myCollateralsCache = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });
                renderMyCollaterals();
            }, function(error){
                console.error("Unable to load my collaterals requests:", error);
            });

        if(isProcessor){
            document.getElementById("allCollateralsCard").classList.remove("d-none");

            firebase.firestore()
                .collection(COLLATERALS_COLLECTION)
                .onSnapshot(function(snapshot){
                    allCollateralsCache = snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    });
                    renderAllCollaterals();
                }, function(error){
                    console.error("Unable to load all collaterals requests:", error);
                });
        }

        const formBackdrop = document.getElementById("collateralsFormBackdrop");

        function openForm(){
            populateBranchSelect(document.getElementById("collateralsBranchInput"));
            document.getElementById("collateralsDeadlineInput").value = "";
            document.getElementById("collateralsLinesContainer").innerHTML = "";
            collateralsLines = [];
            addCollateralsLine();
            formBackdrop.classList.remove("d-none");
        }

        function closeForm(){
            formBackdrop.classList.add("d-none");
        }

        document.getElementById("collateralsRequestBtn").addEventListener("click", openForm);
        document.getElementById("collateralsFormCloseBtn").addEventListener("click", closeForm);
        document.getElementById("collateralsFormCancelBtn").addEventListener("click", closeForm);
        document.getElementById("addCollateralsLineBtn").addEventListener("click", function(){ addCollateralsLine(); });

        formBackdrop.addEventListener("click", function(event){
            if(event.target === formBackdrop){
                closeForm();
            }
        });

        document.getElementById("collateralsFormSubmitBtn").addEventListener("click", async function(){
            const branch = document.getElementById("collateralsBranchInput").value;
            const deadline = document.getElementById("collateralsDeadlineInput").value;

            if(!branch || !deadline){
                alert("Please fill out all required fields.");
                return;
            }

            if(collateralsLines.length === 0){
                alert("Please add at least one item.");
                return;
            }

            const items = [];

            for(const line of collateralsLines){
                const item = line.itemSelect.value;
                const qty = Number(line.qtyInput.value);

                if(!item){
                    alert("Please select an item for every line.");
                    return;
                }

                if(!qty || qty <= 0){
                    alert("Please enter a valid quantity for every line.");
                    return;
                }

                items.push({
                    item,
                    qty,
                    description: line.descInput.value.trim()
                });
            }

            const btn = this;
            btn.disabled = true;

            try{
                await firebase.firestore().collection(COLLATERALS_COLLECTION).add({
                    requesterAccount: currentUser.account,
                    requesterName: currentUser.nickname || currentUser.account,
                    requesterEmail: crownToSyncEmail(currentUser.account),
                    branch,
                    items,
                    deadline,
                    status: "Request Submitted",
                    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    processingAt: null,
                    processingBy: null,
                    doneAt: null,
                    doneBy: null,
                    cancelReason: null
                });

                notifyRequestSubmitted(
                    "tech-support-collaterals",
                    `New collaterals request from ${currentUser.nickname || currentUser.account}: ${formatCollateralItems(items)}`
                );

                closeForm();
            }catch(error){
                console.error("Unable to submit collaterals request:", error);
                alert("Unable to submit this request. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        const viewBackdrop = document.getElementById("collateralsViewBackdrop");

        function closeView(){
            viewBackdrop.classList.add("d-none");
        }

        document.getElementById("collateralsViewCloseBtn").addEventListener("click", closeView);
        document.getElementById("collateralsViewCloseFooterBtn").addEventListener("click", closeView);

        viewBackdrop.addEventListener("click", function(event){
            if(event.target === viewBackdrop){
                closeView();
            }
        });

        document.getElementById("collateralsSendStockBtn").addEventListener("click", async function(){
            const id = this.dataset.id;

            this.disabled = true;

            try{
                await firebase.firestore().collection(COLLATERALS_COLLECTION).doc(id).update({
                    status: "Done",
                    doneAt: firebase.firestore.FieldValue.serverTimestamp(),
                    doneBy: currentUser.account
                });

                closeView();
            }catch(error){
                console.error("Unable to send stock for this request:", error);
                alert("Unable to update this request. It may have already been handled.");
            }finally{
                this.disabled = false;
            }
        });
    }

    /* ---------------------------------------------------------------- */
    /* Tab controller                                                    */
    /* ---------------------------------------------------------------- */

    const PANELS = {
        maintenance: "maintenanceTabPanel",
        collaterals: "collateralsTabPanel"
    };

    function selectTab(tab){
        if(!PANELS[tab]){
            tab = "maintenance";
        }

        document.querySelectorAll('#techSupportTabs [role="tab"]').forEach(function(btn){
            btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
        });

        Object.keys(PANELS).forEach(function(key){
            document.getElementById(PANELS[key]).classList.toggle("d-none", key !== tab);
        });
    }

    document.addEventListener("DOMContentLoaded", function(){
        document.querySelectorAll('#techSupportTabs [role="tab"]').forEach(function(btn){
            btn.addEventListener("click", function(){
                selectTab(btn.dataset.tab);
            });
        });

        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        selectTab(requestedTab || "maintenance");

        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        isProcessor = currentUser.role === "Admin" || currentUser.role === "Tech Support";

        initMaintenance();
        initCollaterals();
    });
})();
