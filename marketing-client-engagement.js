/* ==========================================================================
   Crown Head Spa — Marketing / Client Engagement

   Lets Marketing compose a free-form promo email or SMS blast and pick
   which clients receive it, from the same Client Database used by
   clients.html (CrownClientStore — one synced blob, see client-store.js).

   Preference / unsubscribe:
     Firestore collection "marketingUnsubscribes" (doc ID = lowercased
     email) is the source of truth for opt-outs — written only by the
     unsubscribeMarketingEmail Cloud Function when a client clicks the
     unsubscribe link in a promo email (see functions/index.js). It is
     deliberately NOT stored on the client record itself: the Client
     Database blob is pushed as one whole document per device, so an
     unauthenticated visitor's opt-out could otherwise race a staff
     device's own save and get silently clobbered either way. This page
     just reads that collection on load and overlays "Not Interested" +
     a disabled, unchecked Action checkbox on top of whatever the Client
     Database says — it never touches booking confirmations or any other
     send path.

   SMS character limit:
     Semaphore bills per 160-character segment (see toGsm7Safe /
     shortBranchName in functions/index.js for the same reasoning used by
     the existing booking-confirmation SMS) — this page mirrors that
     160-char-per-segment counter and blocks sending past 3 segments
     (480 chars), and refuses a message containing a link, since Smart
     silently drops SMS containing a URL from this sender.

   Batching a large send:
     sendMarketingEmailBlast/sendMarketingSmsBlast refuse more than
     MARKETING_BATCH_MAX (150 — see functions/index.js) recipients in one
     call, and even under that cap, sending one-by-one on a list of a
     couple thousand clients used to blow past both the function's own
     timeout and the callable client's default 70s deadline ("could not
     send... deadline-exceeded"). So a send here always goes out in
     BATCH_SIZE-sized calls, one batch at a time, with the button showing
     "Sending batch X of Y..." — each batch itself completes quickly
     because the Cloud Function works its recipients with concurrency,
     not strictly one-by-one.
   ========================================================================== */

(function(){
    const UNSUBSCRIBE_COLLECTION = "marketingUnsubscribes";
    const UNDELIVERABLE_COLLECTION = "marketingUndeliverable";
    const SENT_LOG_COLLECTION = "marketingSentLog";
    const SCHEDULED_SENDS_COLLECTION = "marketingScheduledSends";
    const SMS_SEGMENT_LENGTH = 160;
    const SMS_MAX_SEGMENTS = 3;
    const BATCH_SIZE = 100;
    const CALLABLE_TIMEOUT_MS = 120000;

    function chunkArray(items, size){
        const chunks = [];

        for(let i = 0; i < items.length; i += size){
            chunks.push(items.slice(i, i + size));
        }

        return chunks;
    }

    let clients = [];
    let unsubscribedEmails = new Set();
    let undeliverableEmails = new Set();
    let activeTab = "email";
    let searchTerm = "";
    let selectedClientIds = new Set();
    let pendingAttachment = null; // { name, size, url, path }
    let archiveLoaded = false;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatDate(dateValue){
        if(!dateValue){
            return "—";
        }

        return new Date(dateValue + "T00:00:00").toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    function normalizeEmail(email){
        return String(email || "").trim().toLowerCase();
    }

    function isUnsubscribed(client){
        const email = normalizeEmail(client.email);
        return email.length > 0 && unsubscribedEmails.has(email);
    }

    function isUndeliverable(client){
        const email = normalizeEmail(client.email);
        return email.length > 0 && undeliverableEmails.has(email);
    }

    function formatDateTime(isoString){
        if(!isoString){
            return "—";
        }

        const date = new Date(isoString);

        if(Number.isNaN(date.getTime())){
            return "—";
        }

        return date.toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    /* ---- Data loading ---- */

    async function loadClients(){
        try{
            const allClients = await window.CrownClientStore.getAll();
            /* VIP-only, per request — the full Client Database can run
               into the thousands, and most promo blasts target VIPs
               anyway; keeping this list to VIPs only is what keeps the
               table usable instead of crowded. */
            clients = allClients.filter(function(client){ return client.vip === "Yes"; });
        }catch(error){
            console.error("Failed to load clients:", error);
            clients = [];
        }
    }

    async function loadUnsubscribes(){
        try{
            const snapshot = await firebase.firestore().collection(UNSUBSCRIBE_COLLECTION).get();
            unsubscribedEmails = new Set(snapshot.docs.map(function(doc){ return doc.id; }));
        }catch(error){
            console.error("Failed to load marketing unsubscribe list:", error);
            unsubscribedEmails = new Set();
        }
    }

    async function loadUndeliverable(){
        try{
            const snapshot = await firebase.firestore().collection(UNDELIVERABLE_COLLECTION).get();
            undeliverableEmails = new Set(snapshot.docs.map(function(doc){ return doc.id; }));
        }catch(error){
            console.error("Failed to load marketing undeliverable list:", error);
            undeliverableEmails = new Set();
        }
    }

    /* A real-world 2000+ recipient send hit this exact failure mode: the
       mail account's own 500-recipients/24h relay quota got exceeded
       partway through, and every send after that failed with an SMTP AUTH
       rejection (GoDaddy locks the account out once over quota) — none of
       which says anything bad about any of those recipients' addresses.
       That first version of markUndeliverable() didn't know the
       difference and would have permanently greyed out ~1,665 perfectly
       good client emails from one quota hiccup. isAccountLevelFailure()
       is the fix: only a failure that's actually about the recipient (a
       RCPT TO rejection, not AUTH/CONN, and no quota/rate-limit wording)
       is ever eligible to be marked undeliverable. */
    const ACCOUNT_LEVEL_ERROR_PATTERN = /relay quota|sending limit|rate limit|too many|authentication rejected|invalid login|econnreset|connection closed|greeting never received|timed?\s*out/i;

    function isAccountLevelFailure(result){
        if(result.command && result.command !== "RCPT TO"){
            return true;
        }

        return ACCOUNT_LEVEL_ERROR_PATTERN.test(String(result.error || ""));
    }

    /* Called right after a send completes — any address sendMail() rejected
       for a genuinely recipient-specific reason (see isAccountLevelFailure
       above) is written here (doc ID = lowercased email) so the Action
       checkbox greys out for future blasts without waiting for a page
       reload. Email only, per spec — a bad send doesn't say anything
       about whether the client's mobile number still works, so SMS
       eligibility is untouched. */
    async function markUndeliverable(emails){
        const uniqueEmails = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));

        if(uniqueEmails.length === 0){
            return;
        }

        try{
            const db = firebase.firestore();
            const chunks = chunkArray(uniqueEmails, 450); // stay under the 500-write batch limit

            for(const chunk of chunks){
                const batch = db.batch();

                chunk.forEach(function(email){
                    batch.set(db.collection(UNDELIVERABLE_COLLECTION).doc(email), {
                        email: email,
                        markedAt: new Date().toISOString()
                    });
                });

                await batch.commit();
            }

            uniqueEmails.forEach(function(email){ undeliverableEmails.add(email); });
        }catch(error){
            console.error("Failed to record undeliverable emails:", error);
        }
    }

    /* Merges the full originally-selected recipient list (which has
       name) with the per-recipient send results (which don't carry
       name back from the Cloud Function) into one array suitable for
       storing on the marketingSentLog doc and later showing in the
       Archive "View" modal. Anyone in `recipients` with no matching
       result (e.g. a batch after the point a send stopped early) is
       recorded as not attempted, so the Archive view always accounts
       for the complete original selection, not just what went out. */
    function buildLoggedResults(recipients, results, channel){
        const key = channel === "email" ? "email" : "mobile";
        const resultsByKey = new Map(results.map(function(r){ return [r[key], r]; }));

        return recipients.map(function(recipient){
            const result = resultsByKey.get(recipient[key]);

            const row = {
                name: recipient.name || "",
                ok: result ? result.ok : false,
                error: result ? (result.error || "") : "Not attempted (send stopped early)"
            };

            row[key] = recipient[key];

            return row;
        });
    }

    async function logSentBatch(entry){
        try{
            const currentUser = window.CrownAuth?.getCurrentUser?.();

            await firebase.firestore().collection(SENT_LOG_COLLECTION).add(Object.assign({
                sentAt: new Date().toISOString(),
                sentBy: currentUser?.nickname || currentUser?.account || "Unknown"
            }, entry));
        }catch(error){
            console.error("Failed to record sent log entry:", error);
        }
    }

    /* ---- Table rendering ---- */

    function matchesSearch(client){
        if(!searchTerm){
            return true;
        }

        const haystack = (
            String(client.name || "") + " " +
            String(client.email || "") + " " +
            String(client.contactNumber || "")
        ).toLowerCase();
        return haystack.includes(searchTerm);
    }

    function getVisibleClients(){
        return clients
            .filter(matchesSearch)
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            });
    }

    function isEligibleForChannel(client, channel){
        if(channel === "email"){
            return Boolean(normalizeEmail(client.email)) && !isUnsubscribed(client) && !isUndeliverable(client);
        }

        if(channel === "sms"){
            return Boolean(String(client.contactNumber || "").trim());
        }

        return false;
    }

    function isEligibleForActiveTab(client){
        return isEligibleForChannel(client, activeTab);
    }

    function getSelectedRecipients(channel){
        return clients
            .filter(function(client){ return isEligibleForChannel(client, channel) && selectedClientIds.has(client.id); })
            .map(function(client){
                return channel === "email"
                    ? { email: client.email, name: client.name }
                    : { mobile: client.contactNumber, name: client.name };
            });
    }

    function renderClientsTable(){
        const tbody = document.getElementById("ceClientsTableBody");
        const emptyState = document.getElementById("ceClientsEmptyState");
        const contactHeader = document.getElementById("ceContactColumnHeader");
        const visible = getVisibleClients();

        contactHeader.textContent = activeTab === "sms" ? "Mobile Number" : "Email Address";

        tbody.innerHTML = "";
        emptyState.classList.toggle("d-none", visible.length > 0);

        visible.forEach(function(client){
            const undeliverable = isUndeliverable(client);
            const unsubscribed = isUnsubscribed(client);
            const eligible = isEligibleForActiveTab(client);
            const checked = eligible && selectedClientIds.has(client.id);
            const contactValue = activeTab === "sms" ? client.contactNumber : client.email;

            let prefLabel = "Interested";
            let prefTone = "status-active";

            if(undeliverable){
                prefLabel = "Unavailable";
                prefTone = "status-inactive";
            }else if(unsubscribed){
                prefLabel = "Not Interested";
                prefTone = "status-inactive";
            }

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${escapeHtml(client.name || "—")}</td>
                <td>${escapeHtml(contactValue || "—")}</td>
                <td>${formatDate(client.lastVisit)}</td>
                <td>${Number(client.totalVisits) || 0}</td>
                <td class="ce-pref-cell">
                    <span class="marketing-status-pill ${prefTone}">${prefLabel}</span>
                </td>
                <td>
                    <input type="checkbox" class="ce-action-checkbox" data-client-id="${escapeHtml(client.id)}"
                        ${checked ? "checked" : ""} ${eligible ? "" : "disabled"}>
                </td>
            `;

            tbody.appendChild(tr);
        });

        updateSelectAllCheckboxState();
        updateSelectedCountReadouts();
    }

    function eligibleVisibleClients(){
        return getVisibleClients().filter(isEligibleForActiveTab);
    }

    function updateSelectAllCheckboxState(){
        const selectAll = document.getElementById("ceSelectAllCheckbox");
        const eligible = eligibleVisibleClients();
        const allChecked = eligible.length > 0 && eligible.every(function(client){ return selectedClientIds.has(client.id); });

        selectAll.checked = allChecked;
        selectAll.disabled = eligible.length === 0;
    }

    function updateSelectedCountReadouts(){
        const count = eligibleVisibleClients().filter(function(client){ return selectedClientIds.has(client.id); }).length;
        const label = `${count} client(s) selected`;

        document.getElementById("ceEmailSelectedCount").textContent = label;
        document.getElementById("ceSmsSelectedCount").textContent = label;
    }

    /* ---- Archive ---- */

    async function loadAndRenderArchive(){
        sentLogCache = {};

        await Promise.all([
            loadAndRenderArchiveChannel("email", "ceArchiveEmailTableBody", "ceArchiveEmailEmptyState", renderEmailArchiveRow),
            loadAndRenderArchiveChannel("sms", "ceArchiveSmsTableBody", "ceArchiveSmsEmptyState", renderSmsArchiveRow),
            loadAndRenderScheduled()
        ]);
    }

    async function loadAndRenderScheduled(){
        const tbody = document.getElementById("ceArchiveScheduledTableBody");
        const emptyState = document.getElementById("ceArchiveScheduledEmptyState");

        try{
            const snapshot = await firebase.firestore()
                .collection(SCHEDULED_SENDS_COLLECTION)
                .orderBy("createdAt", "desc")
                .limit(50)
                .get();

            tbody.innerHTML = "";
            emptyState.classList.toggle("d-none", !snapshot.empty);
            scheduledBatchesCache = {};

            snapshot.forEach(function(doc){
                scheduledBatchesCache[doc.id] = doc.data();
                tbody.insertAdjacentHTML("beforeend", renderScheduledRow(doc.id, doc.data()));
            });
        }catch(error){
            console.error("Failed to load scheduled sends:", error);
            tbody.innerHTML = "";
            emptyState.classList.remove("d-none");
        }
    }

    function renderScheduledRow(id, entry){
        const preview = entry.channel === "email" ? entry.subject : String(entry.message || "").slice(0, 60);
        const isPending = entry.status === "scheduled";
        const statusTone = entry.status === "sent" ? "status-active" : entry.status === "cancelled" ? "status-inactive" : "status-active";

        const actions = [
            `<button type="button" class="btn btn-sm btn-outline-secondary ce-view-batch-btn" data-schedule-id="${escapeHtml(id)}">View</button>`
        ];

        if(isPending){
            actions.push(`<button type="button" class="btn btn-sm btn-outline-primary ce-sendnow-schedule-btn" data-schedule-id="${escapeHtml(id)}">Send Now</button>`);
            actions.push(`<button type="button" class="btn btn-sm btn-outline-secondary ce-reschedule-btn" data-schedule-id="${escapeHtml(id)}">Reschedule</button>`);
            actions.push(`<button type="button" class="btn btn-sm btn-outline-danger ce-cancel-schedule-btn" data-schedule-id="${escapeHtml(id)}">Cancel</button>`);
        }

        return `
            <tr>
                <td>${entry.channel === "email" ? "Email" : "SMS"}</td>
                <td>${escapeHtml(preview || "—")}</td>
                <td>${Number(entry.batchNumber) || 1} of ${Number(entry.totalBatches) || 1}</td>
                <td>${Number(entry.totalRecipients) || 0}</td>
                <td>${formatDateTime(entry.nextRunAt)}</td>
                <td>${Number(entry.sentCount) || 0} / ${Number(entry.failCount) || 0}</td>
                <td><span class="marketing-status-pill ${statusTone}">${escapeHtml(entry.status || "—")}</span></td>
                <td class="d-flex gap-1 flex-wrap">${actions.join("")}</td>
            </tr>
        `;
    }

    async function loadAndRenderArchiveChannel(channel, tbodyId, emptyStateId, rowRenderer){
        const tbody = document.getElementById(tbodyId);
        const emptyState = document.getElementById(emptyStateId);

        try{
            const snapshot = await firebase.firestore()
                .collection(SENT_LOG_COLLECTION)
                .where("channel", "==", channel)
                .orderBy("sentAt", "desc")
                .limit(100)
                .get();

            tbody.innerHTML = "";
            emptyState.classList.toggle("d-none", !snapshot.empty);

            snapshot.forEach(function(doc){
                sentLogCache[doc.id] = doc.data();
                tbody.insertAdjacentHTML("beforeend", rowRenderer(doc.id, doc.data()));
            });
        }catch(error){
            console.error(`Failed to load ${channel} sent log:`, error);
            tbody.innerHTML = "";
            emptyState.classList.remove("d-none");
        }
    }

    function viewResultsButton(id, hasResults){
        return hasResults
            ? `<button type="button" class="btn btn-sm btn-outline-secondary ce-view-sentlog-btn" data-log-id="${escapeHtml(id)}">View</button>`
            : `<span class="text-muted small">—</span>`;
    }

    function renderEmailArchiveRow(id, entry){
        return `
            <tr>
                <td>${formatDateTime(entry.sentAt)}</td>
                <td>${escapeHtml(entry.subject || "—")}</td>
                <td>${Number(entry.totalRecipients) || 0}</td>
                <td>${Number(entry.successCount) || 0}</td>
                <td>${Number(entry.failCount) || 0}</td>
                <td>${escapeHtml(entry.sentBy || "—")}</td>
                <td>${viewResultsButton(id, Array.isArray(entry.results))}</td>
            </tr>
        `;
    }

    function renderSmsArchiveRow(id, entry){
        const preview = String(entry.message || "").slice(0, 80);

        return `
            <tr>
                <td>${formatDateTime(entry.sentAt)}</td>
                <td>${escapeHtml(preview)}${preview.length < String(entry.message || "").length ? "…" : ""}</td>
                <td>${Number(entry.totalRecipients) || 0}</td>
                <td>${Number(entry.successCount) || 0}</td>
                <td>${Number(entry.failCount) || 0}</td>
                <td>${escapeHtml(entry.sentBy || "—")}</td>
                <td>${viewResultsButton(id, Array.isArray(entry.results))}</td>
            </tr>
        `;
    }

    function toggleArchiveSection(toggleId, bodyId){
        const toggle = document.getElementById(toggleId);
        const body = document.getElementById(bodyId);
        const expanded = toggle.classList.toggle("expanded");

        body.classList.toggle("d-none", !expanded);
    }

    function initDefaultSelection(){
        // "By default nakacheck" — every eligible client starts selected.
        selectedClientIds = new Set(
            clients.filter(function(client){
                const hasEmail = Boolean(normalizeEmail(client.email)) && !isUnsubscribed(client) && !isUndeliverable(client);
                const hasMobile = Boolean(String(client.contactNumber || "").trim());
                return hasEmail || hasMobile;
            }).map(function(client){ return client.id; })
        );
    }

    /* ---- Tabs ---- */

    function setActiveTab(tab){
        activeTab = tab;

        document.getElementById("ceTabEmailBtn").classList.toggle("active", tab === "email");
        document.getElementById("ceTabSmsBtn").classList.toggle("active", tab === "sms");
        document.getElementById("ceTabArchiveBtn").classList.toggle("active", tab === "archive");
        document.getElementById("cePanelEmail").classList.toggle("d-none", tab !== "email");
        document.getElementById("cePanelSms").classList.toggle("d-none", tab !== "sms");
        document.getElementById("cePanelArchive").classList.toggle("d-none", tab !== "archive");
        document.getElementById("ceClientsCard").classList.toggle("d-none", tab === "archive");

        if(tab === "archive" && !archiveLoaded){
            archiveLoaded = true;
            loadAndRenderArchive();
        }

        renderClientsTable();
    }

    /* ---- SMS character counter ---- */

    function updateSmsCharCount(){
        const textarea = document.getElementById("ceSmsMessage");
        const length = textarea.value.length;
        const segments = Math.max(1, Math.ceil(length / SMS_SEGMENT_LENGTH));
        const maxLength = SMS_SEGMENT_LENGTH * SMS_MAX_SEGMENTS;

        const readout = document.getElementById("ceSmsCharCount");
        readout.textContent = `${length} / ${SMS_SEGMENT_LENGTH} characters (${segments} segment${segments > 1 ? "s" : ""})`;
        readout.classList.toggle("text-danger", length > maxLength);
        readout.classList.toggle("text-muted", length <= maxLength);
    }

    /* ---- Attachment upload ---- */

    function toSyncSafeName(name){
        return String(name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
    }

    function uploadAttachment(file){
        return new Promise(function(resolve, reject){
            const safeName = toSyncSafeName(file.name);
            const path = `marketingAttachments/${Date.now()}_${safeName}`;
            const ref = firebase.storage().ref().child(path);
            const task = ref.put(file);

            task.on("state_changed", null, function(error){
                reject(error);
            }, function(){
                ref.getDownloadURL().then(function(url){
                    resolve({ name: file.name, size: file.size, path: path, url: url });
                }).catch(reject);
            });
        });
    }

    function renderAttachmentReadout(){
        const nameEl = document.getElementById("ceEmailAttachmentName");
        const removeBtn = document.getElementById("ceEmailAttachmentRemoveBtn");

        if(pendingAttachment){
            nameEl.textContent = `${pendingAttachment.name} (${Math.round(pendingAttachment.size / 1024)} KB)`;
            removeBtn.classList.remove("d-none");
        }else{
            nameEl.textContent = "";
            removeBtn.classList.add("d-none");
        }
    }

    /* ---- Send status feedback ---- */

    function renderSendStatus(containerId, results, channelLabel){
        const container = document.getElementById(containerId);
        const succeeded = results.filter(function(r){ return r.ok; }).length;
        const failed = results.filter(function(r){ return !r.ok; });

        const alertClass = failed.length === 0 ? "alert-success" : "alert-warning";

        let html = `<div class="alert ${alertClass} py-2 px-3 mb-0">`;
        html += `${succeeded} of ${results.length} ${channelLabel} sent successfully.`;

        if(failed.length > 0){
            html += `<ul class="mb-0 mt-1 small">`;
            failed.forEach(function(item){
                html += `<li>${escapeHtml(item.email || item.mobile || "—")} — ${escapeHtml(item.error || "Failed")}</li>`;
            });
            html += `</ul>`;
        }

        html += `</div>`;
        container.innerHTML = html;
    }

    function renderSendError(containerId, message){
        document.getElementById(containerId).innerHTML =
            `<div class="alert alert-danger py-2 px-3 mb-0">${escapeHtml(message)}</div>`;
    }

    /* ---- Send confirmation ---- */

    function formatPeso(amount){
        return "₱" + (Number(amount) || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function confirmSend(message, subnote){
        return new Promise(function(resolve){
            const backdrop = document.getElementById("ceConfirmBackdrop");
            const messageEl = document.getElementById("ceConfirmMessage");
            const subnoteEl = document.getElementById("ceConfirmSubnote");
            const yesBtn = document.getElementById("ceConfirmYesBtn");
            const noBtn = document.getElementById("ceConfirmNoBtn");
            const closeBtn = document.getElementById("ceConfirmCloseBtn");

            messageEl.textContent = message;
            subnoteEl.textContent = subnote || "";
            subnoteEl.classList.toggle("d-none", !subnote);
            backdrop.classList.remove("d-none");

            function cleanup(result){
                backdrop.classList.add("d-none");
                yesBtn.removeEventListener("click", onYes);
                noBtn.removeEventListener("click", onNo);
                closeBtn.removeEventListener("click", onNo);
                resolve(result);
            }

            function onYes(){ cleanup(true); }
            function onNo(){ cleanup(false); }

            yesBtn.addEventListener("click", onYes);
            noBtn.addEventListener("click", onNo);
            closeBtn.addEventListener("click", onNo);
        });
    }

    /* ---- Send: Email ---- */

    async function handleSendEmail(){
        const subject = document.getElementById("ceEmailSubject").value.trim();
        const message = document.getElementById("ceEmailMessage").value.trim();
        const statusId = "ceEmailSendStatus";

        if(!subject){
            renderSendError(statusId, "Please enter a subject.");
            return;
        }

        if(!message){
            renderSendError(statusId, "Please enter a message.");
            return;
        }

        const recipients = getSelectedRecipients("email");

        if(recipients.length === 0){
            renderSendError(statusId, "Select at least one client with an email address.");
            return;
        }

        const confirmed = await confirmSend(
            `Are you sure you want to send email to ${recipients.length} Client${recipients.length === 1 ? "" : "s"}?`
        );

        if(!confirmed){
            return;
        }

        const sendBtn = document.getElementById("ceSendEmailBtn");
        sendBtn.disabled = true;

        try{
            let attachmentUrl = "";
            let attachmentName = "";

            const fileInput = document.getElementById("ceEmailAttachmentInput");

            if(fileInput.files && fileInput.files[0] && !pendingAttachment){
                sendBtn.textContent = "Uploading attachment...";
                pendingAttachment = await uploadAttachment(fileInput.files[0]);
                renderAttachmentReadout();
            }

            if(pendingAttachment){
                attachmentUrl = pendingAttachment.url;
                attachmentName = pendingAttachment.name;
            }

            const batches = chunkArray(recipients, BATCH_SIZE);
            const callable = firebase.functions().httpsCallable("sendMarketingEmailBlast", { timeout: CALLABLE_TIMEOUT_MS });
            const allResults = [];
            let stoppedEarly = false;

            for(let i = 0; i < batches.length; i++){
                sendBtn.textContent = batches.length > 1
                    ? `Sending batch ${i + 1} of ${batches.length}...`
                    : "Sending...";

                const response = await callable({
                    subject: subject,
                    message: message,
                    recipients: batches[i],
                    attachmentUrl: attachmentUrl,
                    attachmentName: attachmentName
                });

                allResults.push(...response.data.results);
                renderSendStatus(statusId, allResults, "email(s)");

                /* If most of THIS batch failed for an account-level reason
                   (mail account over its sending quota, auth rejected,
                   etc.), every remaining batch is going to fail the same
                   way — stop instead of grinding through the rest. */
                const batchResults = response.data.results;
                const accountLevelCount = batchResults.filter(isAccountLevelFailure).length;

                if(batchResults.length > 0 && accountLevelCount / batchResults.length > 0.5){
                    stoppedEarly = true;
                    renderSendError(
                        statusId,
                        `Stopped after batch ${i + 1} of ${batches.length}: the mail account appears to have hit its own sending ` +
                        `limit (not a problem with the recipients' addresses). ${allResults.filter(function(r){ return r.ok; }).length} ` +
                        `sent before this happened. Wait for the account's quota to reset, then send the rest of the list.`
                    );
                    break;
                }
            }

            const genuineFailures = allResults.filter(function(r){ return !r.ok && !isAccountLevelFailure(r); });

            await markUndeliverable(genuineFailures.map(function(r){ return r.email; }));

            await logSentBatch({
                channel: "email",
                subject: subject,
                message: message,
                attachmentName: attachmentName || "",
                totalRecipients: recipients.length,
                successCount: allResults.filter(function(r){ return r.ok; }).length,
                failCount: allResults.filter(function(r){ return !r.ok; }).length,
                stoppedEarly: stoppedEarly,
                results: buildLoggedResults(recipients, allResults, "email")
            });

            if(!stoppedEarly){
                renderSendStatus(statusId, allResults, "email(s)");
            }

            archiveLoaded = false;
            renderClientsTable();
        }catch(error){
            console.error("Failed to send marketing email blast:", error);
            renderSendError(statusId, "Could not send the email blast. Reason: " + (error?.message || "Unknown error"));
        }finally{
            sendBtn.disabled = false;
            sendBtn.textContent = "Send Email";
        }
    }

    /* ---- Send: SMS ---- */

    async function handleSendSms(){
        const message = document.getElementById("ceSmsMessage").value.trim();
        const statusId = "ceSmsSendStatus";

        if(!message){
            renderSendError(statusId, "Please enter a message.");
            return;
        }

        if(/https?:\/\//i.test(message)){
            renderSendError(statusId, "Links are silently dropped from SMS by Smart — remove the URL from the message.");
            return;
        }

        if(message.length > SMS_SEGMENT_LENGTH * SMS_MAX_SEGMENTS){
            renderSendError(statusId, `Message is too long (${message.length} characters). Keep it under ${SMS_SEGMENT_LENGTH * SMS_MAX_SEGMENTS} characters.`);
            return;
        }

        const recipients = getSelectedRecipients("sms");

        if(recipients.length === 0){
            renderSendError(statusId, "Select at least one client with a mobile number.");
            return;
        }

        const smsCost = recipients.length * 0.5;
        const segments = Math.max(1, Math.ceil(message.length / SMS_SEGMENT_LENGTH));

        const confirmed = await confirmSend(
            `Are you sure you want to send SMS to ${recipients.length} Client${recipients.length === 1 ? "" : "s"}? ` +
            `It will cost you ${formatPeso(smsCost)} of your SMS Credits.`,
            segments > 1
                ? `Message is ${segments} segments — Semaphore bills per segment, so the actual cost may be higher than shown.`
                : ""
        );

        if(!confirmed){
            return;
        }

        const sendBtn = document.getElementById("ceSendSmsBtn");
        sendBtn.disabled = true;

        try{
            const batches = chunkArray(recipients, BATCH_SIZE);
            const callable = firebase.functions().httpsCallable("sendMarketingSmsBlast", { timeout: CALLABLE_TIMEOUT_MS });
            const allResults = [];

            for(let i = 0; i < batches.length; i++){
                sendBtn.textContent = batches.length > 1
                    ? `Sending batch ${i + 1} of ${batches.length}...`
                    : "Sending...";

                const response = await callable({
                    message: message,
                    recipients: batches[i]
                });

                allResults.push(...response.data.results);
                renderSendStatus(statusId, allResults, "SMS message(s)");
            }

            await logSentBatch({
                channel: "sms",
                message: message,
                totalRecipients: recipients.length,
                successCount: allResults.filter(function(r){ return r.ok; }).length,
                failCount: allResults.filter(function(r){ return !r.ok; }).length,
                results: buildLoggedResults(recipients, allResults, "sms")
            });

            archiveLoaded = false;
        }catch(error){
            console.error("Failed to send marketing SMS blast:", error);
            renderSendError(statusId, "Could not send the SMS blast. Reason: " + (error?.message || "Unknown error"));
        }finally{
            sendBtn.disabled = false;
            sendBtn.textContent = "Send SMS";
        }
    }

    /* ---- Schedule Send ---- */

    let scheduleChannel = "email";
    let scheduledBatchesCache = {}; // id -> data, refreshed by loadAndRenderScheduled()
    let sentLogCache = {}; // id -> data, refreshed by loadAndRenderArchiveChannel()

    const DEFAULT_BATCH_LIMIT = { email: 400, sms: 400 };

    function updateScheduleBatchPreview(){
        const recipients = getSelectedRecipients(scheduleChannel);
        const limit = Math.max(1, Number(document.getElementById("ceScheduleDailyLimit").value) || 1);
        const batchCount = Math.max(1, Math.ceil(recipients.length / limit));

        document.getElementById("ceScheduleRecipientCount").textContent =
            `${recipients.length} client${recipients.length === 1 ? "" : "s"}`;
        document.getElementById("ceScheduleLimitPreview").textContent = limit;
        document.getElementById("ceScheduleBatchCountPreview").textContent = batchCount;
    }

    function openScheduleModal(channel){
        scheduleChannel = channel;

        document.getElementById("ceScheduleDailyLimit").value = DEFAULT_BATCH_LIMIT[channel];

        const dateInput = document.getElementById("ceScheduleStartDate");
        const today = new Date().toISOString().slice(0, 10);
        dateInput.min = today;
        dateInput.value = today;

        updateScheduleBatchPreview();

        document.getElementById("ceScheduleBackdrop").classList.remove("d-none");
    }

    function closeScheduleModal(){
        document.getElementById("ceScheduleBackdrop").classList.add("d-none");
    }

    /* Philippine Standard Time is a fixed UTC+8 year-round (no DST), so a
       literal "+08:00" offset on the chosen date is always correct without
       needing a timezone library. 7:00 AM matches
       SCHEDULED_SEND_CRON/SCHEDULED_SEND_TIMEZONE in functions/index.js —
       change both together if that ever moves. */
    function buildNextRunAtIso(dateString, dayOffset){
        const date = new Date(`${dateString}T07:00:00+08:00`);
        date.setDate(date.getDate() + (dayOffset || 0));
        return date.toISOString();
    }

    async function handleScheduleConfirm(){
        const dateString = document.getElementById("ceScheduleStartDate").value;
        const batchLimit = Number(document.getElementById("ceScheduleDailyLimit").value);
        const statusId = scheduleChannel === "email" ? "ceEmailSendStatus" : "ceSmsSendStatus";

        if(!dateString){
            renderSendError(statusId, "Please choose a start date.");
            return;
        }

        if(!Number.isFinite(batchLimit) || batchLimit < 1){
            renderSendError(statusId, "Please enter a valid per-batch limit.");
            return;
        }

        let subject = "";
        let message = "";
        let attachmentUrl = "";
        let attachmentName = "";

        if(scheduleChannel === "email"){
            subject = document.getElementById("ceEmailSubject").value.trim();
            message = document.getElementById("ceEmailMessage").value.trim();

            if(!subject){
                renderSendError(statusId, "Please enter a subject.");
                return;
            }
        }else{
            message = document.getElementById("ceSmsMessage").value.trim();

            if(/https?:\/\//i.test(message)){
                renderSendError(statusId, "Links are silently dropped from SMS by Smart — remove the URL from the message.");
                return;
            }

            if(message.length > SMS_SEGMENT_LENGTH * SMS_MAX_SEGMENTS){
                renderSendError(statusId, `Message is too long (${message.length} characters). Keep it under ${SMS_SEGMENT_LENGTH * SMS_MAX_SEGMENTS} characters.`);
                return;
            }
        }

        if(!message){
            renderSendError(statusId, "Please enter a message.");
            return;
        }

        const recipients = getSelectedRecipients(scheduleChannel);

        if(recipients.length === 0){
            renderSendError(statusId, `Select at least one client with ${scheduleChannel === "email" ? "an email address" : "a mobile number"}.`);
            return;
        }

        const confirmBtn = document.getElementById("ceScheduleConfirmBtn");
        confirmBtn.disabled = true;

        try{
            if(scheduleChannel === "email"){
                const fileInput = document.getElementById("ceEmailAttachmentInput");

                if(fileInput.files && fileInput.files[0] && !pendingAttachment){
                    confirmBtn.textContent = "Uploading attachment...";
                    pendingAttachment = await uploadAttachment(fileInput.files[0]);
                    renderAttachmentReadout();
                }

                if(pendingAttachment){
                    attachmentUrl = pendingAttachment.url;
                    attachmentName = pendingAttachment.name;
                }
            }

            const batches = chunkArray(recipients, batchLimit);

            closeScheduleModal();

            const confirmed = await confirmSend(
                `Create ${batches.length} batch${batches.length === 1 ? "" : "es"} of up to ${batchLimit} for ${recipients.length} ` +
                `Client${recipients.length === 1 ? "" : "s"}, one per day starting ${dateString} at 7:00 AM?`
            );

            if(!confirmed){
                return;
            }

            const currentUser = window.CrownAuth?.getCurrentUser?.();
            const createdBy = currentUser?.nickname || currentUser?.account || "Unknown";
            const createdAt = new Date().toISOString();
            const groupId = firebase.firestore().collection(SCHEDULED_SENDS_COLLECTION).doc().id;

            const writeBatch = firebase.firestore().batch();

            batches.forEach(function(batchRecipients, index){
                const docRef = firebase.firestore().collection(SCHEDULED_SENDS_COLLECTION).doc();

                writeBatch.set(docRef, {
                    channel: scheduleChannel,
                    subject: subject,
                    message: message,
                    attachmentUrl: attachmentUrl,
                    attachmentName: attachmentName,
                    groupId: groupId,
                    batchNumber: index + 1,
                    totalBatches: batches.length,
                    originalRecipients: batchRecipients,
                    recipients: batchRecipients,
                    totalRecipients: batchRecipients.length,
                    sentCount: 0,
                    failCount: 0,
                    status: "scheduled",
                    nextRunAt: buildNextRunAtIso(dateString, index),
                    createdAt: createdAt,
                    createdBy: createdBy
                });
            });

            await writeBatch.commit();

            document.getElementById(statusId).innerHTML =
                `<div class="alert alert-success py-2 px-3 mb-0">Created ${batches.length} batch(es) for ${recipients.length} clients, starting ${dateString}. See the Archive tab's Scheduled Sends section.</div>`;

            archiveLoaded = false;
        }catch(error){
            console.error("Failed to schedule send:", error);
            renderSendError(statusId, "Could not schedule the send. Reason: " + (error?.message || "Unknown error"));
        }finally{
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Create Batches";
        }
    }

    /* Shared by the Scheduled Sends "View" (a batch's fixed composition,
       nothing sent yet) and the Email/SMS Sent Archive "View" (what
       actually happened to each recipient) — `rows` is an array of
       { name, contact, status } where status is "" for the former and
       "Sent"/"Failed: <reason>" for the latter. */
    function openViewRecipientsModal(title, channel, rows){
        document.getElementById("ceViewRecipientsTitle").textContent = title;
        document.getElementById("ceViewRecipientsContactHeader").textContent =
            channel === "email" ? "Email Address" : "Mobile Number";

        const statusHeader = document.getElementById("ceViewRecipientsStatusHeader");
        const showStatus = rows.some(function(row){ return row.status; });
        statusHeader.classList.toggle("d-none", !showStatus);

        document.getElementById("ceViewRecipientsTableBody").innerHTML = rows.map(function(row){
            return `
                <tr>
                    <td>${escapeHtml(row.name || "—")}</td>
                    <td>${escapeHtml(row.contact || "—")}</td>
                    ${showStatus ? `<td>${escapeHtml(row.status || "—")}</td>` : ""}
                </tr>
            `;
        }).join("");

        document.getElementById("ceViewRecipientsBackdrop").classList.remove("d-none");
    }

    function handleViewBatch(scheduleId){
        const entry = scheduledBatchesCache[scheduleId];

        if(!entry){
            return;
        }

        const recipients = Array.isArray(entry.originalRecipients) ? entry.originalRecipients : [];

        openViewRecipientsModal(
            `Batch ${Number(entry.batchNumber) || 1} of ${Number(entry.totalBatches) || 1} — Recipients`,
            entry.channel,
            recipients.map(function(recipient){
                return {
                    name: recipient.name,
                    contact: entry.channel === "email" ? recipient.email : recipient.mobile,
                    status: ""
                };
            })
        );
    }

    function handleViewSentResults(logId){
        const entry = sentLogCache[logId];

        if(!entry || !Array.isArray(entry.results)){
            return;
        }

        openViewRecipientsModal(
            `${entry.channel === "email" ? "Email" : "SMS"} Sent ${formatDateTime(entry.sentAt)} — Results`,
            entry.channel,
            entry.results.map(function(result){
                return {
                    name: result.name,
                    contact: entry.channel === "email" ? result.email : result.mobile,
                    status: result.ok ? "Sent" : `Failed: ${result.error || "Unknown error"}`
                };
            })
        );
    }

    async function handleSendBatchNow(scheduleId){
        const confirmed = await confirmSend("Send this batch right now instead of waiting for its scheduled date?");

        if(!confirmed){
            return;
        }

        try{
            const response = await firebase.functions().httpsCallable("sendScheduledBatchNow", { timeout: CALLABLE_TIMEOUT_MS })({ scheduleId: scheduleId });
            await loadAndRenderScheduled();
            archiveLoaded = false;
            alert(`Sent — ${response.data.successCount} succeeded, ${response.data.failCount} failed.`);
        }catch(error){
            console.error("Failed to send batch now:", error);
            alert("Could not send this batch. Reason: " + (error?.message || "Unknown error"));
        }
    }

    let rescheduleTargetId = null;

    function openRescheduleModal(scheduleId){
        rescheduleTargetId = scheduleId;

        const entry = scheduledBatchesCache[scheduleId];
        const dateInput = document.getElementById("ceRescheduleDate");
        const today = new Date().toISOString().slice(0, 10);

        dateInput.min = today;
        dateInput.value = entry?.nextRunAt ? entry.nextRunAt.slice(0, 10) : today;

        document.getElementById("ceRescheduleBackdrop").classList.remove("d-none");
    }

    function closeRescheduleModal(){
        document.getElementById("ceRescheduleBackdrop").classList.add("d-none");
        rescheduleTargetId = null;
    }

    async function handleRescheduleConfirm(){
        const dateString = document.getElementById("ceRescheduleDate").value;

        if(!dateString || !rescheduleTargetId){
            return;
        }

        try{
            await firebase.firestore().collection(SCHEDULED_SENDS_COLLECTION).doc(rescheduleTargetId).update({
                nextRunAt: buildNextRunAtIso(dateString, 0)
            });

            closeRescheduleModal();
            await loadAndRenderScheduled();
        }catch(error){
            console.error("Failed to reschedule batch:", error);
            alert("Could not reschedule this batch. Reason: " + (error?.message || "Unknown error"));
        }
    }

    async function handleCancelSchedule(scheduleId){
        const confirmed = await confirmSend("Cancel this scheduled send? Recipients not yet reached will not receive it.");

        if(!confirmed){
            return;
        }

        try{
            await firebase.firestore().collection(SCHEDULED_SENDS_COLLECTION).doc(scheduleId).update({ status: "cancelled" });
            await loadAndRenderScheduled();
        }catch(error){
            console.error("Failed to cancel scheduled send:", error);
            alert("Could not cancel the scheduled send. Reason: " + (error?.message || "Unknown error"));
        }
    }

    /* ---- Wiring ---- */

    function wireEvents(){
        document.getElementById("ceTabEmailBtn").addEventListener("click", function(){ setActiveTab("email"); });
        document.getElementById("ceTabSmsBtn").addEventListener("click", function(){ setActiveTab("sms"); });
        document.getElementById("ceTabArchiveBtn").addEventListener("click", function(){ setActiveTab("archive"); });

        document.getElementById("ceArchiveEmailToggle").addEventListener("click", function(){
            toggleArchiveSection("ceArchiveEmailToggle", "ceArchiveEmailBody");
        });

        document.getElementById("ceArchiveSmsToggle").addEventListener("click", function(){
            toggleArchiveSection("ceArchiveSmsToggle", "ceArchiveSmsBody");
        });

        document.getElementById("ceArchiveScheduledToggle").addEventListener("click", function(){
            toggleArchiveSection("ceArchiveScheduledToggle", "ceArchiveScheduledBody");
        });

        document.getElementById("ceArchiveScheduledTableBody").addEventListener("click", function(event){
            const cancelBtn = event.target.closest(".ce-cancel-schedule-btn");
            const viewBtn = event.target.closest(".ce-view-batch-btn");
            const sendNowBtn = event.target.closest(".ce-sendnow-schedule-btn");
            const rescheduleBtn = event.target.closest(".ce-reschedule-btn");

            if(cancelBtn){
                handleCancelSchedule(cancelBtn.dataset.scheduleId);
            }else if(viewBtn){
                handleViewBatch(viewBtn.dataset.scheduleId);
            }else if(sendNowBtn){
                handleSendBatchNow(sendNowBtn.dataset.scheduleId);
            }else if(rescheduleBtn){
                openRescheduleModal(rescheduleBtn.dataset.scheduleId);
            }
        });

        document.getElementById("ceArchiveEmailTableBody").addEventListener("click", function(event){
            const viewBtn = event.target.closest(".ce-view-sentlog-btn");

            if(viewBtn){
                handleViewSentResults(viewBtn.dataset.logId);
            }
        });

        document.getElementById("ceArchiveSmsTableBody").addEventListener("click", function(event){
            const viewBtn = event.target.closest(".ce-view-sentlog-btn");

            if(viewBtn){
                handleViewSentResults(viewBtn.dataset.logId);
            }
        });

        document.getElementById("ceViewRecipientsCloseBtn").addEventListener("click", function(){
            document.getElementById("ceViewRecipientsBackdrop").classList.add("d-none");
        });
        document.getElementById("ceViewRecipientsCloseFooterBtn").addEventListener("click", function(){
            document.getElementById("ceViewRecipientsBackdrop").classList.add("d-none");
        });

        document.getElementById("ceRescheduleCloseBtn").addEventListener("click", closeRescheduleModal);
        document.getElementById("ceRescheduleCancelBtn").addEventListener("click", closeRescheduleModal);
        document.getElementById("ceRescheduleConfirmBtn").addEventListener("click", handleRescheduleConfirm);

        document.getElementById("ceClientSearch").addEventListener("input", function(event){
            searchTerm = event.target.value.trim().toLowerCase();
            renderClientsTable();
        });

        document.getElementById("ceSelectAllCheckbox").addEventListener("change", function(event){
            const eligible = eligibleVisibleClients();

            eligible.forEach(function(client){
                if(event.target.checked){
                    selectedClientIds.add(client.id);
                }else{
                    selectedClientIds.delete(client.id);
                }
            });

            renderClientsTable();
        });

        document.getElementById("ceClientsTableBody").addEventListener("change", function(event){
            const checkbox = event.target.closest(".ce-action-checkbox");

            if(!checkbox){
                return;
            }

            if(checkbox.checked){
                selectedClientIds.add(checkbox.dataset.clientId);
            }else{
                selectedClientIds.delete(checkbox.dataset.clientId);
            }

            updateSelectAllCheckboxState();
            updateSelectedCountReadouts();
        });

        document.getElementById("ceSmsMessage").addEventListener("input", updateSmsCharCount);

        document.getElementById("ceEmailAttachmentInput").addEventListener("change", function(event){
            pendingAttachment = null;
            renderAttachmentReadout();

            if(event.target.files && event.target.files[0]){
                document.getElementById("ceEmailAttachmentName").textContent = event.target.files[0].name + " (not yet uploaded)";
            }
        });

        document.getElementById("ceEmailAttachmentRemoveBtn").addEventListener("click", function(){
            pendingAttachment = null;
            document.getElementById("ceEmailAttachmentInput").value = "";
            renderAttachmentReadout();
        });

        document.getElementById("ceSendEmailBtn").addEventListener("click", handleSendEmail);
        document.getElementById("ceSendSmsBtn").addEventListener("click", handleSendSms);

        document.getElementById("ceScheduleEmailBtn").addEventListener("click", function(){ openScheduleModal("email"); });
        document.getElementById("ceScheduleSmsBtn").addEventListener("click", function(){ openScheduleModal("sms"); });
        document.getElementById("ceScheduleCloseBtn").addEventListener("click", closeScheduleModal);
        document.getElementById("ceScheduleCancelBtn").addEventListener("click", closeScheduleModal);
        document.getElementById("ceScheduleConfirmBtn").addEventListener("click", handleScheduleConfirm);
        document.getElementById("ceScheduleDailyLimit").addEventListener("input", updateScheduleBatchPreview);
    }

    document.addEventListener("DOMContentLoaded", async function(){
        wireEvents();
        updateSmsCharCount();

        await Promise.all([loadClients(), loadUnsubscribes(), loadUndeliverable()]);

        initDefaultSelection();
        renderClientsTable();
    });
})();
