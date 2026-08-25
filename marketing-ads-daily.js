/* ==========================================================================
   Crown Head Spa — Marketing / Ads Monitoring

   Data model (Firestore):
     marketingCampaigns/{campaignId}
       name, status ("Active" | "Inactive"), archived (bool),
       createdAt, createdBy, endedAt, archivedAt
     marketingCampaigns/{campaignId}/entries/{entryId}
       createdAt ("Date Created" — set once, never edited), cpm, cost,
       impressions, views, inquiries, notes, createdBy

   Each campaign is its own persistent table of append-only "update"
   entries — "Update" always adds a new entry, it never edits a past one.
   A campaign stays visible (with its full entry history) on this page
   regardless of the global date filter until it is archived, at which
   point it only shows up under "History". Feeds marketing-ads-summary.js,
   which reads the same collection/subcollections and rolls each campaign
   up into one summary row.
   ========================================================================== */

(function(){
    const CAMPAIGNS_COLLECTION = "marketingCampaigns";
    const ENTRIES_SUBCOLLECTION = "entries";

    let currentUser = null;
    let campaignsCache = [];
    let updatingCampaignId = null;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatTimestampDate(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "";
        }

        const date = timestamp.toDate();
        const month = date.toLocaleDateString("en-US", { month: "short" });
        const day = String(date.getDate()).padStart(2, "0");
        const year = date.getFullYear();

        return `${month}-${day}-${year}`;
    }

    /* Date + time, stacked on separate lines within one cell (no extra
       column) — used by the full-history View table. */
    function formatTimestampDateTime(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "";
        }

        const date = timestamp.toDate();
        const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

        return `${formatTimestampDate(timestamp)}<br><small class="text-muted">${escapeHtml(time)}</small>`;
    }

    /* Latest-entry snapshot + all-history CPM average, shown as the
       single summary row under each campaign's title on this page —
       same figures marketing-ads-summary.js computes per campaign. */
    function computeCampaignSummary(entries){
        const latest = entries[entries.length - 1] || {};

        const cpmValues = entries
            .map(function(entry){ return Number(entry.cpm); })
            .filter(function(value){ return !isNaN(value); });

        const avgCpm = cpmValues.length
            ? cpmValues.reduce(function(sum, value){ return sum + value; }, 0) / cpmValues.length
            : 0;

        return {
            cpm: avgCpm,
            cost: latest.cost,
            impressions: latest.impressions,
            views: latest.views,
            inquiries: latest.inquiries,
            notes: latest.notes
        };
    }

    function formatCurrency(value){
        const number = Number(value) || 0;

        return "₱" + number.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatNumber(value){
        return (Number(value) || 0).toLocaleString("en-PH");
    }

    function db(){
        return firebase.firestore();
    }

    function campaignRef(campaignId){
        return db().collection(CAMPAIGNS_COLLECTION).doc(campaignId);
    }

    /* ---- Load / render ---- */

    function loadCampaigns(){
        return db()
            .collection(CAMPAIGNS_COLLECTION)
            .where("archived", "==", false)
            .get()
            .then(function(snapshot){
                const campaigns = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });

                return Promise.all(
                    campaigns.map(function(campaign){
                        return campaignRef(campaign.id)
                            .collection(ENTRIES_SUBCOLLECTION)
                            .orderBy("createdAt", "asc")
                            .get()
                            .then(function(entriesSnapshot){
                                campaign.entries = entriesSnapshot.docs.map(function(doc){
                                    return Object.assign({ id: doc.id }, doc.data());
                                });
                                return campaign;
                            });
                    })
                );
            })
            .then(function(campaigns){
                campaignsCache = campaigns.sort(function(a, b){
                    const aTime = a.createdAt?.toMillis?.() || 0;
                    const bTime = b.createdAt?.toMillis?.() || 0;
                    return aTime - bTime;
                });

                renderCampaigns();
            })
            .catch(function(error){
                console.error("Unable to load campaigns:", error);
            });
    }

    function renderCampaigns(){
        const container = document.getElementById("marketingCampaignsContainer");
        const emptyCard = document.getElementById("marketingEmptyCard");

        if(campaignsCache.length === 0){
            container.innerHTML = "";
            emptyCard.classList.remove("d-none");
            return;
        }

        emptyCard.classList.add("d-none");

        container.innerHTML = campaignsCache.map(renderCampaignCard).join("");

        container.querySelectorAll(".marketing-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openViewModal(btn.dataset.id);
            });
        });

        container.querySelectorAll(".marketing-update-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openUpdateModal(btn.dataset.id);
            });
        });

        container.querySelectorAll(".marketing-end-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                endCampaign(btn.dataset.id);
            });
        });

        container.querySelectorAll(".marketing-resume-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                resumeCampaign(btn.dataset.id);
            });
        });

        container.querySelectorAll(".marketing-archive-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                archiveCampaign(btn.dataset.id);
            });
        });
    }

    function renderCampaignCard(campaign){
        const statusClass =
            campaign.status === "Active" ? "status-active" : "status-inactive";

        const summary = computeCampaignSummary(campaign.entries);

        const summaryRow = campaign.entries.length === 0
            ? `<tr><td colspan="6" class="text-center text-muted">No updates yet.</td></tr>`
            : `
                <tr>
                    <td>${escapeHtml(formatCurrency(summary.cpm))}</td>
                    <td>${escapeHtml(formatCurrency(summary.cost))}</td>
                    <td>${escapeHtml(formatNumber(summary.impressions))}</td>
                    <td>${escapeHtml(formatNumber(summary.views))}</td>
                    <td>${escapeHtml(formatNumber(summary.inquiries))}</td>
                    <td>${escapeHtml((summary.notes || "").slice(0, 60))}</td>
                </tr>
            `;

        const actions = campaign.status === "Active"
            ? `
                <button type="button" class="btn btn-sm btn-outline-primary marketing-view-btn" data-id="${escapeHtml(campaign.id)}">View</button>
                <button type="button" class="btn btn-sm btn-primary marketing-update-btn" data-id="${escapeHtml(campaign.id)}">Update</button>
                <button type="button" class="btn btn-sm btn-outline-danger marketing-end-btn" data-id="${escapeHtml(campaign.id)}">End</button>
            `
            : `
                <button type="button" class="btn btn-sm btn-outline-primary marketing-view-btn" data-id="${escapeHtml(campaign.id)}">View</button>
                <button type="button" class="btn btn-sm btn-outline-success marketing-resume-btn" data-id="${escapeHtml(campaign.id)}">Resume</button>
                <button type="button" class="btn btn-sm btn-outline-secondary marketing-archive-btn" data-id="${escapeHtml(campaign.id)}">Archive</button>
            `;

        return `
            <div class="card shadow-sm border-0 mb-4">
                <div class="card-body">
                    <div class="marketing-campaign-header">
                        <h5>
                            ${escapeHtml(campaign.name)} -
                            <span class="marketing-campaign-status-text ${statusClass}">${escapeHtml(campaign.status)}</span>
                        </h5>
                    </div>

                    <div class="table-responsive">
                        <table class="table marketing-table align-middle">
                            <thead>
                                <tr>
                                    <th>CPM</th>
                                    <th>Cost</th>
                                    <th>Impression</th>
                                    <th>Views</th>
                                    <th>Inquiries</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>${summaryRow}</tbody>
                        </table>
                    </div>

                    <div class="marketing-campaign-actions">
                        ${actions}
                    </div>
                </div>
            </div>
        `;
    }

    /* ---- Create Campaign ---- */

    function openCreateModal(){
        document.getElementById("marketingCreateNameInput").value = "";
        document.getElementById("marketingCreateCpmInput").value = "";
        document.getElementById("marketingCreateCostInput").value = "";
        document.getElementById("marketingCreateImpressionInput").value = "";
        document.getElementById("marketingCreateViewsInput").value = "";
        document.getElementById("marketingCreateInquiriesInput").value = "";
        document.getElementById("marketingCreateNotesInput").value = "";

        document.getElementById("marketingCreateBackdrop").classList.remove("d-none");
    }

    function closeCreateModal(){
        document.getElementById("marketingCreateBackdrop").classList.add("d-none");
    }

    async function saveCreate(){
        const name = document.getElementById("marketingCreateNameInput").value.trim();

        if(!name){
            alert("Please enter a campaign name.");
            return;
        }

        const entryPayload = readEntryFields("marketingCreate");

        const btn = document.getElementById("marketingCreateSaveBtn");
        btn.disabled = true;

        try{
            const campaignDoc = await db().collection(CAMPAIGNS_COLLECTION).add({
                name,
                status: "Active",
                archived: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: currentUser.account,
                endedAt: null,
                archivedAt: null
            });

            await campaignDoc.collection(ENTRIES_SUBCOLLECTION).add(Object.assign(
                {},
                entryPayload,
                {
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: currentUser.account
                }
            ));

            closeCreateModal();
            await loadCampaigns();
        }catch(error){
            console.error("Unable to create campaign:", error);
            alert("Unable to create this campaign. Please try again.");
        }finally{
            btn.disabled = false;
        }
    }

    /* ---- Update (append a new entry) ---- */

    function openUpdateModal(campaignId){
        const campaign = campaignsCache.find(function(item){ return item.id === campaignId; });

        if(!campaign){
            return;
        }

        updatingCampaignId = campaignId;

        document.getElementById("marketingUpdateTitle").textContent =
            "Update: " + campaign.name;

        document.getElementById("marketingUpdateCpmInput").value = "";
        document.getElementById("marketingUpdateCostInput").value = "";
        document.getElementById("marketingUpdateImpressionInput").value = "";
        document.getElementById("marketingUpdateViewsInput").value = "";
        document.getElementById("marketingUpdateInquiriesInput").value = "";
        document.getElementById("marketingUpdateNotesInput").value = "";

        document.getElementById("marketingUpdateBackdrop").classList.remove("d-none");
    }

    function closeUpdateModal(){
        document.getElementById("marketingUpdateBackdrop").classList.add("d-none");
        updatingCampaignId = null;
    }

    async function saveUpdate(){
        if(!updatingCampaignId){
            return;
        }

        const entryPayload = readEntryFields("marketingUpdate");

        const btn = document.getElementById("marketingUpdateSaveBtn");
        btn.disabled = true;

        try{
            await campaignRef(updatingCampaignId)
                .collection(ENTRIES_SUBCOLLECTION)
                .add(Object.assign(
                    {},
                    entryPayload,
                    {
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: currentUser.account
                    }
                ));

            closeUpdateModal();
            await loadCampaigns();
        }catch(error){
            console.error("Unable to save campaign update:", error);
            alert("Unable to save this update. Please try again.");
        }finally{
            btn.disabled = false;
        }
    }

    function readEntryFields(prefix){
        return {
            cpm: Number(document.getElementById(prefix + "CpmInput").value) || 0,
            cost: Number(document.getElementById(prefix + "CostInput").value) || 0,
            impressions: Number(document.getElementById(prefix + "ImpressionInput").value) || 0,
            views: Number(document.getElementById(prefix + "ViewsInput").value) || 0,
            inquiries: Number(document.getElementById(prefix + "InquiriesInput").value) || 0,
            notes: document.getElementById(prefix + "NotesInput").value.trim()
        };
    }

    /* ---- View (full, untruncated history) ---- */

    function renderEntriesHistory(entries){
        if(entries.length === 0){
            return '<div class="empty-state">No updates logged yet.</div>';
        }

        const rows = entries.slice().reverse().map(function(entry){
            return `
                <tr>
                    <td>${formatTimestampDateTime(entry.createdAt)}</td>
                    <td>${escapeHtml(formatCurrency(entry.cpm))}</td>
                    <td>${escapeHtml(formatCurrency(entry.cost))}</td>
                    <td>${escapeHtml(formatNumber(entry.impressions))}</td>
                    <td>${escapeHtml(formatNumber(entry.views))}</td>
                    <td>${escapeHtml(formatNumber(entry.inquiries))}</td>
                    <td>${escapeHtml(entry.notes || "")}</td>
                </tr>
            `;
        }).join("");

        return `
            <div class="table-responsive">
                <table class="table marketing-table align-middle">
                    <thead>
                        <tr>
                            <th>Date Created</th>
                            <th>CPM</th>
                            <th>Cost</th>
                            <th>Impression</th>
                            <th>Views</th>
                            <th>Inquiries</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function openViewModal(campaignId){
        const campaign = campaignsCache.find(function(item){ return item.id === campaignId; });

        if(!campaign){
            return;
        }

        document.getElementById("marketingViewTitle").textContent =
            campaign.name + " — Full History";

        document.getElementById("marketingViewBody").innerHTML =
            renderEntriesHistory(campaign.entries);

        document.getElementById("marketingViewBackdrop").classList.remove("d-none");
    }

    async function openArchivedViewModal(campaignId, campaignName){
        document.getElementById("marketingViewTitle").textContent =
            campaignName + " — Full History";

        document.getElementById("marketingViewBody").innerHTML =
            '<div class="empty-state">Loading…</div>';

        document.getElementById("marketingViewBackdrop").classList.remove("d-none");

        try{
            const snapshot = await campaignRef(campaignId)
                .collection(ENTRIES_SUBCOLLECTION)
                .orderBy("createdAt", "asc")
                .get();

            const entries = snapshot.docs.map(function(doc){
                return Object.assign({ id: doc.id }, doc.data());
            });

            document.getElementById("marketingViewBody").innerHTML =
                renderEntriesHistory(entries);
        }catch(error){
            console.error("Unable to load archived campaign history:", error);
            document.getElementById("marketingViewBody").innerHTML =
                '<div class="empty-state">Unable to load this campaign\'s history.</div>';
        }
    }

    function closeViewModal(){
        document.getElementById("marketingViewBackdrop").classList.add("d-none");
    }

    /* ---- End / Resume / Archive ---- */

    async function endCampaign(campaignId){
        if(!confirm("End this campaign? Its status will change to Inactive.")){
            return;
        }

        try{
            await campaignRef(campaignId).update({
                status: "Inactive",
                endedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await loadCampaigns();
        }catch(error){
            console.error("Unable to end campaign:", error);
            alert("Unable to end this campaign. Please try again.");
        }
    }

    async function resumeCampaign(campaignId){
        if(!confirm("Resume this campaign? Its status will change back to Active.")){
            return;
        }

        try{
            await campaignRef(campaignId).update({
                status: "Active",
                endedAt: null
            });

            await loadCampaigns();
        }catch(error){
            console.error("Unable to resume campaign:", error);
            alert("Unable to resume this campaign. Please try again.");
        }
    }

    async function archiveCampaign(campaignId){
        if(!confirm("Archive this campaign? It will move to History.")){
            return;
        }

        try{
            await campaignRef(campaignId).update({
                archived: true,
                archivedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await loadCampaigns();
        }catch(error){
            console.error("Unable to archive campaign:", error);
            alert("Unable to archive this campaign. Please try again.");
        }
    }

    /* ---- History (archived campaigns) ---- */

    async function openHistoryModal(){
        const body = document.getElementById("marketingHistoryTableBody");
        const empty = document.getElementById("marketingHistoryEmptyState");

        body.innerHTML = "";
        empty.classList.add("d-none");

        document.getElementById("marketingHistoryBackdrop").classList.remove("d-none");

        try{
            const snapshot = await db()
                .collection(CAMPAIGNS_COLLECTION)
                .where("archived", "==", true)
                .get();

            const archived = snapshot.docs
                .map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                })
                .sort(function(a, b){
                    const aTime = a.archivedAt?.toMillis?.() || 0;
                    const bTime = b.archivedAt?.toMillis?.() || 0;
                    return bTime - aTime;
                });

            if(archived.length === 0){
                empty.classList.remove("d-none");
                return;
            }

            body.innerHTML = archived.map(function(campaign){
                return `
                    <tr>
                        <td>${escapeHtml(campaign.name)}</td>
                        <td>${escapeHtml(formatTimestampDate(campaign.archivedAt))}</td>
                        <td>
                            <button type="button" class="btn btn-sm btn-outline-primary marketing-history-view-btn" data-id="${escapeHtml(campaign.id)}" data-name="${escapeHtml(campaign.name)}">View</button>
                        </td>
                    </tr>
                `;
            }).join("");

            body.querySelectorAll(".marketing-history-view-btn").forEach(function(btn){
                btn.addEventListener("click", function(){
                    openArchivedViewModal(btn.dataset.id, btn.dataset.name);
                });
            });
        }catch(error){
            console.error("Unable to load campaign history:", error);
        }
    }

    function closeHistoryModal(){
        document.getElementById("marketingHistoryBackdrop").classList.add("d-none");
    }

    /* ---- Wire up ---- */

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        loadCampaigns();

        document.getElementById("marketingCreateCampaignBtn").addEventListener("click", openCreateModal);
        document.getElementById("marketingCreateCloseBtn").addEventListener("click", closeCreateModal);
        document.getElementById("marketingCreateCancelBtn").addEventListener("click", closeCreateModal);
        document.getElementById("marketingCreateSaveBtn").addEventListener("click", saveCreate);

        document.getElementById("marketingCreateBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeCreateModal();
            }
        });

        document.getElementById("marketingUpdateCloseBtn").addEventListener("click", closeUpdateModal);
        document.getElementById("marketingUpdateCancelBtn").addEventListener("click", closeUpdateModal);
        document.getElementById("marketingUpdateSaveBtn").addEventListener("click", saveUpdate);

        document.getElementById("marketingUpdateBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeUpdateModal();
            }
        });

        document.getElementById("marketingViewCloseBtn").addEventListener("click", closeViewModal);
        document.getElementById("marketingViewCloseFooterBtn").addEventListener("click", closeViewModal);

        document.getElementById("marketingViewBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeViewModal();
            }
        });

        document.getElementById("marketingHistoryBtn").addEventListener("click", openHistoryModal);
        document.getElementById("marketingHistoryCloseBtn").addEventListener("click", closeHistoryModal);
        document.getElementById("marketingHistoryCloseFooterBtn").addEventListener("click", closeHistoryModal);

        document.getElementById("marketingHistoryBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeHistoryModal();
            }
        });
    });
})();
