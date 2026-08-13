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

    function buildClientCell(request){
        const companions = Array.isArray(request.companions) ? request.companions : [];

        if(companions.length === 0){
            return escapeHtml(request.clientName);
        }

        const companionLabels = companions.map(function(companion){
            return escapeHtml(companion.name) + " (" + escapeHtml(companion.serviceName) + ")";
        });

        return escapeHtml(request.clientName) +
            " <span class=\"badge bg-secondary\">Party of " + (companions.length + 1) + "</span>" +
            "<br><small class=\"text-muted\">+ " + companionLabels.join(", ") + "</small>";
    }

    function buildContactCell(request){
        const lines = [escapeHtml(request.mobile || "")];

        if(request.email){
            lines.push("<small>" + escapeHtml(request.email) + "</small>");
        }

        return lines.join("<br>");
    }

    /* The shared leading cells — everything up to and including "Submitted" —
       so the pending table and the history table stay column-for-column
       aligned without either one having to know about the other's trailing
       columns (Hold Status + Action vs. Outcome). */
    function buildSharedCells(request){
        return (
            "<td>" + escapeHtml(request.branch) + "</td>" +
            "<td>" + escapeHtml(request.serviceName) + "</td>" +
            "<td class=\"booking-datetime-cell\">" +
                escapeHtml(formatDate(request.date)) + "<br>" +
                escapeHtml(request.time) +
            "</td>" +
            "<td class=\"booking-client-cell\">" + buildClientCell(request) + "</td>" +
            "<td class=\"booking-contact-cell\">" + buildContactCell(request) + "</td>" +
            "<td class=\"booking-notes-cell\">" + (escapeHtml(request.notes) || "—") + "</td>" +
            "<td class=\"booking-submitted-cell\">" + formatSubmittedAt(request.submittedAt) + "</td>"
        );
    }

    function renderRequests(requests, holdsByRequestId){
        const tbody = document.getElementById("bookingRequestListBody");
        const emptyState = document.getElementById("bookingRequestEmptyState");
        const table = document.getElementById("bookingRequestTableWrap");
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
            return (
                "<tr data-request-id=\"" + escapeHtml(request.id) + "\">" +
                    buildSharedCells(request) +
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
            /* firestore.rules only allows this update while the request is
               still "pending" — a permission-denied here almost always
               means someone else already converted or declined it (the
               request re-renders out of the pending list on its own via
               the onSnapshot listener below once that happens). */
            if(error?.code === "permission-denied"){
                alert("This request was already handled by someone else.");
            }else{
                console.error("Unable to decline booking request:", error);
                alert("Could not decline this request. Please try again.");
            }
        }
    }

    /* ----------------------------------------------------------------------
       History — requests that have already been handled.

       Read on demand rather than kept on a live listener: it is reference
       material a receptionist opens occasionally, so paying for a permanent
       second onSnapshot on the whole collection would be wasteful.

       The query orders by submittedAt and filters to non-pending rows in the
       browser, instead of asking Firestore for status != "pending". A status
       filter combined with orderBy on a different field needs a composite
       index, which the pending list already goes out of its way to avoid
       (see the sort comment in startListening). Ordering on one field uses
       the automatic single-field index, so this needs no index deploy.
       ---------------------------------------------------------------------- */

    const HISTORY_FETCH_LIMIT = 200;

    let historyVisible = false;
    let historyLoading = false;

    /* The fetched rows are kept here so the day picker filters what is already
       loaded — changing the date is a local narrowing, not another read. */
    let historyRequests = [];
    let historyReachedLimit = false;

    function historyEl(id){
        return document.getElementById(id);
    }

    function showOnlyHistoryState(visibleId){
        ["bookingHistoryTableWrap",
         "bookingHistoryLoadingState",
         "bookingHistoryEmptyState",
         "bookingHistoryErrorState"].forEach(function(id){
            historyEl(id).classList.toggle("d-none", id !== visibleId);
        });
    }

    function formatReviewedAt(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "";
        }

        return timestamp.toDate().toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function formatOutcome(request){
        const label = request.status === "converted"
            ? "<span class=\"badge bg-success\">Appointment created</span>"
            : "<span class=\"badge bg-secondary\">Declined</span>";

        const details = [];
        const reviewedAt = formatReviewedAt(request.reviewedAt);

        if(reviewedAt){
            details.push(escapeHtml(reviewedAt));
        }

        if(request.reviewedBy){
            details.push("by " + escapeHtml(request.reviewedBy));
        }

        return details.length > 0
            ? label + "<br><small class=\"text-muted\">" + details.join(" · ") + "</small>"
            : label;
    }

    /* Empty means "every day", which is the default the page opens on. */
    function selectedHistoryDate(){
        return historyEl("bookingHistoryDate").value || "";
    }

    /* The day filter matches when the request came in, not the date the guest
       asked for, so submittedAt (a Firestore Timestamp) has to be reduced to
       the same yyyy-mm-dd shape the date input produces. Read in local time so
       the row matches the "Submitted" column beside it, which is also local. */
    function submittedDateValue(timestamp){
        if(!timestamp || typeof timestamp.toDate !== "function"){
            return "";
        }

        const submitted = timestamp.toDate();

        return submitted.getFullYear() + "-" +
            String(submitted.getMonth() + 1).padStart(2, "0") + "-" +
            String(submitted.getDate()).padStart(2, "0");
    }

    function historyNoteText(shownCount, filterDate){
        const noun = shownCount === 1 ? " handled request" : " handled requests";

        if(filterDate){
            return "Showing " + shownCount + noun + " submitted on " + formatDate(filterDate) +
                ", out of " + historyRequests.length + " loaded.";
        }

        return historyReachedLimit
            ? "Showing handled requests from the latest " + HISTORY_FETCH_LIMIT +
              " submissions. Older ones are not listed."
            : "Showing all " + shownCount + noun + ".";
    }

    function renderHistory(){
        const tbody = historyEl("bookingHistoryListBody");
        const note = historyEl("bookingHistoryNote");
        const emptyState = historyEl("bookingHistoryEmptyState");
        const filterDate = selectedHistoryDate();

        historyEl("bookingHistoryDateClear").classList.toggle("d-none", !filterDate);

        const requests = filterDate
            ? historyRequests.filter(function(request){
                return submittedDateValue(request.submittedAt) === filterDate;
            })
            : historyRequests;

        if(requests.length === 0){
            tbody.innerHTML = "";
            note.classList.add("d-none");

            /* Nothing on the chosen day reads very differently from nothing at
               all — the second would have the receptionist wondering whether
               the history is broken. */
            emptyState.textContent = filterDate
                ? "No handled requests were submitted on " + formatDate(filterDate) + "."
                : "No previous requests yet. Once you convert or decline a request, it will show up here.";

            showOnlyHistoryState("bookingHistoryEmptyState");
            return;
        }

        tbody.innerHTML = requests.map(function(request){
            return (
                "<tr>" +
                    buildSharedCells(request) +
                    "<td class=\"booking-outcome-cell\">" + formatOutcome(request) + "</td>" +
                "</tr>"
            );
        }).join("");

        note.textContent = historyNoteText(requests.length, filterDate);
        note.classList.remove("d-none");

        showOnlyHistoryState("bookingHistoryTableWrap");
    }

    async function loadHistory(){
        if(historyLoading){
            return;
        }

        historyLoading = true;
        historyEl("bookingHistoryNote").classList.add("d-none");
        showOnlyHistoryState("bookingHistoryLoadingState");

        try{
            const snapshot = await firebase.firestore()
                .collection(COLLECTION)
                .orderBy("submittedAt", "desc")
                .limit(HISTORY_FETCH_LIMIT)
                .get();

            /* Same branch restriction as the pending list — a receptionist
               should not read back guests from a branch they cannot see. */
            const allowedBranches =
                window.CrownAuth?.getAllowedBranches?.() || [];

            historyRequests = snapshot.docs
                .map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                })
                .filter(function(request){
                    return request.status !== "pending" &&
                        allowedBranches.includes(request.branch);
                });

            historyReachedLimit = snapshot.size === HISTORY_FETCH_LIMIT;

            renderHistory();
        }catch(error){
            console.error("Unable to load booking-request history:", error);
            historyEl("bookingHistoryNote").classList.add("d-none");
            showOnlyHistoryState("bookingHistoryErrorState");
        }finally{
            historyLoading = false;
        }
    }

    /* Re-filters the rows already in memory rather than reading again. While a
       load is still in flight there is nothing to filter yet, and rendering
       would replace the loading state with a misleading "none found" —
       loadHistory renders on its own once it lands. */
    function refreshHistoryView(){
        if(historyLoading){
            return;
        }

        renderHistory();
    }

    function todayDateValue(){
        const now = new Date();

        return now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0");
    }

    /* Same day-math helper the Scheduling page's ‹ › stepper uses (exposed by
       sidebar.js), so a step across a month or DST boundary behaves the same
       in both places. Stepping from the empty "all days" state starts at
       today, which is where the Scheduling stepper starts from too. */
    function stepHistoryDate(days){
        const input = historyEl("bookingHistoryDate");

        input.value =
            window.CrownDateStepper?.addDays?.(
                input.value || todayDateValue(),
                days
            ) || input.value;

        refreshHistoryView();
    }

    function toggleHistory(){
        const section = historyEl("bookingHistorySection");
        const toggle = historyEl("bookingHistoryToggle");

        historyVisible = !historyVisible;
        section.classList.toggle("d-none", !historyVisible);
        toggle.textContent = historyVisible ? "Hide History" : "Show History";

        if(historyVisible){
            /* Re-read on every open so a request handled since the last look
               is already in the list. */
            loadHistory();
            section.scrollIntoView({ behavior: "smooth", block: "start" });
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
                document.getElementById("bookingRequestTableWrap")
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

        document.getElementById("bookingHistoryToggle")
            .addEventListener("click", toggleHistory);

        document.getElementById("bookingHistoryDate")
            .addEventListener("change", refreshHistoryView);

        document.getElementById("bookingHistoryPrevDay")
            .addEventListener("click", function(){
                stepHistoryDate(-1);
            });

        document.getElementById("bookingHistoryNextDay")
            .addEventListener("click", function(){
                stepHistoryDate(1);
            });

        document.getElementById("bookingHistoryDateClear")
            .addEventListener("click", function(){
                document.getElementById("bookingHistoryDate").value = "";
                refreshHistoryView();
            });

        const cloudAvailable =
            window.CrownCloud?.isAvailable?.() &&
            await window.CrownCloud.waitForInitialSync(12000);

        if(!cloudAvailable || !window.firebase || firebase.apps.length === 0){
            document.getElementById("bookingRequestUnavailableState")
                .classList.remove("d-none");
            document.getElementById("bookingRequestTableWrap")
                .classList.add("d-none");

            /* History reads the same collection, so it cannot work either —
               hide the button rather than let it open onto an error. */
            document.querySelector(".booking-history-bar")
                .classList.add("d-none");
            return;
        }

        startListening();
    });

    window.addEventListener("beforeunload", function(){
        unsubscribe?.();
    });
})();
