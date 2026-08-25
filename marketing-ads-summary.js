/* ==========================================================================
   Crown Head Spa — Marketing / Monitoring Summary

   Reads the "marketingCampaigns" collection (and each campaign's
   "entries" subcollection) written by marketing-ads-daily.js and lists
   one summary row per campaign — Active, Inactive, and archived alike:
     - Status      -> the campaign's own status field
     - CPM         -> average across ALL of that campaign's entries
                      (its whole history, not limited to the current
                      month — a continuously running campaign's CPM is
                      averaged over every update it's ever logged)
     - Cost / Impression / Views / Inquiries -> its most recent entry
     - Notes       -> "View" opens every dated note left on that campaign
   Purely a read/aggregate view — no separate collection of its own.
   ========================================================================== */

(function(){
    const CAMPAIGNS_COLLECTION = "marketingCampaigns";
    const ENTRIES_SUBCOLLECTION = "entries";

    let summariesCache = [];

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

    function buildSummary(campaign, entries){
        const sorted = entries.slice().sort(function(a, b){
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });

        const latest = sorted[0] || {};

        const cpmValues = entries
            .map(function(entry){ return Number(entry.cpm); })
            .filter(function(value){ return !isNaN(value); });

        const avgCpm = cpmValues.length
            ? cpmValues.reduce(function(sum, value){ return sum + value; }, 0) / cpmValues.length
            : 0;

        return {
            campaign: campaign.name,
            status: campaign.status || "",
            cpm: avgCpm,
            cost: latest.cost,
            impressions: latest.impressions,
            views: latest.views,
            inquiries: latest.inquiries,
            notes: sorted
                .filter(function(entry){ return (entry.notes || "").trim(); })
                .map(function(entry){
                    return { date: entry.createdAt, notes: entry.notes };
                })
        };
    }

    function renderTable(){
        const body = document.getElementById("marketingSummaryTableBody");
        const empty = document.getElementById("marketingSummaryEmptyState");

        if(summariesCache.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = summariesCache.map(function(summary, index){
            const statusClass =
                summary.status === "Active" ? "status-active" : "status-inactive";

            return `
                <tr>
                    <td>${escapeHtml(summary.campaign)}</td>
                    <td><span class="marketing-status-pill ${statusClass}">${escapeHtml(summary.status)}</span></td>
                    <td>${escapeHtml(formatCurrency(summary.cpm))}</td>
                    <td>${escapeHtml(formatCurrency(summary.cost))}</td>
                    <td>${escapeHtml(formatNumber(summary.impressions))}</td>
                    <td>${escapeHtml(formatNumber(summary.views))}</td>
                    <td>${escapeHtml(formatNumber(summary.inquiries))}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-primary marketing-notes-view-btn" data-index="${index}">
                            View (${summary.notes.length})
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".marketing-notes-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openNotes(Number(btn.dataset.index));
            });
        });
    }

    function openNotes(index){
        const summary = summariesCache[index];

        if(!summary){
            return;
        }

        document.getElementById("marketingNotesTitle").textContent =
            summary.campaign + " — Notes";

        const body = document.getElementById("marketingNotesBody");

        if(summary.notes.length === 0){
            body.innerHTML = '<div class="empty-state">No notes logged for this campaign.</div>';
        }else{
            body.innerHTML = summary.notes.map(function(item){
                return `
                    <div class="marketing-notes-row">
                        <strong>${escapeHtml(formatTimestampDate(item.date))}</strong>
                        <span>${escapeHtml(item.notes)}</span>
                    </div>
                `;
            }).join("");
        }

        document.getElementById("marketingNotesBackdrop").classList.remove("d-none");
    }

    function closeNotes(){
        document.getElementById("marketingNotesBackdrop").classList.add("d-none");
    }

    function loadSummary(){
        const db = firebase.firestore();

        return db
            .collection(CAMPAIGNS_COLLECTION)
            .get()
            .then(function(snapshot){
                const campaigns = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });

                return Promise.all(
                    campaigns.map(function(campaign){
                        return db
                            .collection(CAMPAIGNS_COLLECTION)
                            .doc(campaign.id)
                            .collection(ENTRIES_SUBCOLLECTION)
                            .get()
                            .then(function(entriesSnapshot){
                                const entries = entriesSnapshot.docs.map(function(doc){
                                    return Object.assign({ id: doc.id }, doc.data());
                                });

                                return buildSummary(campaign, entries);
                            });
                    })
                );
            })
            .then(function(summaries){
                /* Active campaigns first, Inactive (including archived —
                   they're always Inactive by the time they're archived)
                   sink to the bottom; alphabetical within each group. */
                summariesCache = summaries.sort(function(a, b){
                    const rank = function(status){ return status === "Active" ? 0 : 1; };

                    const rankDiff = rank(a.status) - rank(b.status);

                    if(rankDiff !== 0){
                        return rankDiff;
                    }

                    return a.campaign.localeCompare(b.campaign);
                });

                renderTable();
            })
            .catch(function(error){
                console.error("Unable to load monitoring summary:", error);
            });
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        if(!window.CrownAuth?.getCurrentUser?.()){
            return;
        }

        loadSummary();

        document.getElementById("marketingNotesCloseBtn").addEventListener("click", closeNotes);
        document.getElementById("marketingNotesCloseFooterBtn").addEventListener("click", closeNotes);

        document.getElementById("marketingNotesBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeNotes();
            }
        });
    });
})();
