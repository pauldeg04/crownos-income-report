/* ==========================================================================
   Crown Head Spa — Booking Requests (staff review of public-website
   submissions)

   Unlike every other CrownOS page, this data does NOT live in the
   crown*-prefixed localStorage / "appData" mirror (see firebase-sync.js) —
   it lives only in a separate Firestore collection, "bookingRequests",
   written directly by the public website (Website/js/main.js) and read/
   updated here directly. Requests are converted into real appointments
   via scheduling.html?fromRequest=<id> (see scheduling.js).
   ========================================================================== */

(function(){
    const COLLECTION = "bookingRequests";

    let unsubscribe = null;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatDate(dateString){
        try{
            return new Date(dateString + "T00:00:00")
                .toLocaleDateString("en-PH", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                });
        }catch(error){
            return dateString;
        }
    }

    function formatSubmittedAt(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "—";
        }

        return timestamp.toDate().toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    /* Fetches the scheduleHolds doc created for each pending request (see
       Income Report/functions/index.js submitBookingRequest) so staff can
       see whether the temporary slot hold is still active before they
       call the guest. Firestore's "in" filter caps at 30 values — fine
       for a pending-requests list, which is never realistically larger. */
    async function fetchHoldsByRequestId(requestIds){
        const holdsByRequestId = {};

        if(requestIds.length === 0){
            return holdsByRequestId;
        }

        try{
            const snapshot = await firebase.firestore()
                .collection("scheduleHolds")
                .where("bookingRequestId", "in", requestIds.slice(0, 30))
                .get();

            snapshot.forEach(function(doc){
                const data = doc.data();
                holdsByRequestId[data.bookingRequestId] = data;
            });
        }catch(error){
            console.error("Unable to load booking-request holds:", error);
        }

        return holdsByRequestId;
    }

    function formatHoldStatus(hold){
        if(!hold){
            return "<span class=\"text-muted\">No hold found</span>";
        }

        if(hold.status === "released"){
            return "<span class=\"text-muted\">Released — slot available again</span>";
        }

        const expiresAtMs = hold.expiresAt?.toMillis?.();

        if(expiresAtMs && expiresAtMs <= Date.now()){
            return "<span class=\"text-warning\">Expired — slot may already be released</span>";
        }

        if(expiresAtMs){
            const expiresLabel = hold.expiresAt.toDate().toLocaleString("en-PH", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });

            return "<span class=\"text-success\">Active until " + escapeHtml(expiresLabel) + "</span>";
        }

        return "<span class=\"text-muted\">Active</span>";
    }

    function partySize(request){
        const companions = Array.isArray(request.companions) ? request.companions : [];
        return 1 + companions.length;
    }

    function renderRequests(requests, holdsByRequestId){
        const tbody = document.getElementById("bookingRequestListBody");
        const emptyState = document.getElementById("bookingRequestEmptyState");
        const table = document.querySelector(".table-responsive");
        const pendingCount = document.getElementById("bookingPendingCount");
        const pendingGuestCount = document.getElementById("bookingPendingGuestCount");

        pendingCount.textContent = requests.length;
        if(pendingGuestCount){
            pendingGuestCount.textContent = requests.reduce(function(sum, request){
                return sum + partySize(request);
            }, 0);
        }

        if(requests.length === 0){
            tbody.innerHTML = "";
            emptyState.classList.remove("d-none");
            table.classList.add("d-none");
            return;
        }

        emptyState.classList.add("d-none");
        table.classList.remove("d-none");

        tbody.innerHTML = requests.map(function(request){
            const contactLines = [
                escapeHtml(request.mobile || "")
            ];

            if(request.email){
                contactLines.push("<small>" + escapeHtml(request.email) + "</small>");
            }

            const companions = Array.isArray(request.companions) ? request.companions : [];
            const companionLabels = companions.map(function(companion){
                return escapeHtml(companion.name) + " (" + escapeHtml(companion.serviceName) + ")";
            });
            const clientCell = companions.length > 0
                ? escapeHtml(request.clientName) +
                  " <span class=\"badge bg-secondary\">Party of " + (companions.length + 1) + "</span>" +
                  "<br><small class=\"text-muted\">+ " + companionLabels.join(", ") + "</small>"
                : escapeHtml(request.clientName);

            return (
                "<tr data-request-id=\"" + escapeHtml(request.id) + "\">" +
                    "<td>" + escapeHtml(request.branch) + "</td>" +
                    "<td>" + escapeHtml(request.serviceName) + "</td>" +
                    "<td class=\"booking-datetime-cell\">" +
                        escapeHtml(formatDate(request.date)) + "<br>" +
                        escapeHtml(request.time) +
                    "</td>" +
                    "<td class=\"booking-client-cell\">" + clientCell + "</td>" +
                    "<td class=\"booking-contact-cell\">" + contactLines.join("<br>") + "</td>" +
                    "<td class=\"booking-notes-cell\">" + (escapeHtml(request.notes) || "—") + "</td>" +
                    "<td class=\"booking-submitted-cell\">" + formatSubmittedAt(request.submittedAt) + "</td>" +
                    "<td class=\"booking-hold-cell\">" + formatHoldStatus(holdsByRequestId[request.id]) + "</td>" +
                    "<td class=\"booking-action-cell\">" +
                        "<a class=\"btn btn-sm btn-primary\" href=\"scheduling.html?fromRequest=" +
                            encodeURIComponent(request.id) + "\">Create Appointment</a>" +
                        "<button type=\"button\" class=\"btn btn-sm btn-outline-secondary\" data-decline=\"" +
                            escapeHtml(request.id) + "\">Decline</button>" +
                    "</td>" +
                "</tr>"
            );
        }).join("");
    }

    async function declineRequest(requestId){
        if(!confirm("Decline this booking request? The visitor will not be notified automatically.")){
            return;
        }

        const currentUser = window.CrownAuth?.getCurrentUser?.();

        try{
            await firebase.firestore()
                .collection(COLLECTION)
                .doc(requestId)
                .update({
                    status: "declined",
                    reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: currentUser?.account || ""
                });
        }catch(error){
            console.error("Unable to decline booking request:", error);
            alert("Could not decline this request. Please try again.");
        }
    }

    let renderToken = 0;

    function startListening(){
        unsubscribe = firebase.firestore()
            .collection(COLLECTION)
            .where("status", "==", "pending")
            .onSnapshot(async function(snapshot){
                /* Admins see every branch (getAllowedBranches returns the
                   full branch list for them) — everyone else only sees
                   requests for branch(es) assigned to their account, same
                   restriction already applied to the Scheduling page's own
                   branch dropdown (see getBranches() in scheduling.js). */
                const allowedBranches =
                    window.CrownAuth?.getAllowedBranches?.() || [];

                const requests = snapshot.docs
                    .map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    })
                    .filter(function(request){
                        return allowedBranches.includes(request.branch);
                    });

                /* Sorted client-side (oldest first) rather than via
                   .orderBy("submittedAt") in the query — avoids requiring
                   a composite Firestore index for an equality + orderBy
                   query on two different fields. */
                requests.sort(function(a, b){
                    const aTime = a.submittedAt?.toMillis?.() || 0;
                    const bTime = b.submittedAt?.toMillis?.() || 0;
                    return aTime - bTime;
                });

                const thisRender = ++renderToken;
                const holdsByRequestId = await fetchHoldsByRequestId(
                    requests.map(function(request){ return request.id; })
                );

                if(thisRender !== renderToken){
                    return; // a newer snapshot already re-rendered
                }

                renderRequests(requests, holdsByRequestId);
            }, function(error){
                console.error("Unable to load booking requests:", error);
                document.getElementById("bookingRequestUnavailableState")
                    .classList.remove("d-none");
                document.querySelector(".table-responsive")
                    .classList.add("d-none");
            });
    }

    document.addEventListener("DOMContentLoaded", async function(){
        document.getElementById("bookingRequestListBody")
            .addEventListener("click", function(event){
                const declineId = event.target.dataset.decline;

                if(declineId){
                    declineRequest(declineId);
                }
            });

        const cloudAvailable =
            window.CrownCloud?.isAvailable?.() &&
            await window.CrownCloud.waitForInitialSync(12000);

        if(!cloudAvailable || !window.firebase || firebase.apps.length === 0){
            document.getElementById("bookingRequestUnavailableState")
                .classList.remove("d-none");
            document.querySelector(".table-responsive")
                .classList.add("d-none");
            return;
        }

        startListening();
    });

    window.addEventListener("beforeunload", function(){
        unsubscribe?.();
    });
})();
