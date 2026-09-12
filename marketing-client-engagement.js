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
   ========================================================================== */

(function(){
    const UNSUBSCRIBE_COLLECTION = "marketingUnsubscribes";
    const SMS_SEGMENT_LENGTH = 160;
    const SMS_MAX_SEGMENTS = 3;

    let clients = [];
    let unsubscribedEmails = new Set();
    let activeTab = "email";
    let searchTerm = "";
    let selectedClientIds = new Set();
    let pendingAttachment = null; // { name, size, url, path }

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

    /* ---- Data loading ---- */

    async function loadClients(){
        try{
            clients = await window.CrownClientStore.getAll();
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

    /* ---- Table rendering ---- */

    function matchesSearch(client){
        if(!searchTerm){
            return true;
        }

        const haystack = (String(client.name || "") + " " + String(client.email || "")).toLowerCase();
        return haystack.includes(searchTerm);
    }

    function getVisibleClients(){
        return clients
            .filter(matchesSearch)
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            });
    }

    function isEligibleForActiveTab(client){
        if(activeTab === "email"){
            return Boolean(normalizeEmail(client.email)) && !isUnsubscribed(client);
        }

        return Boolean(String(client.contactNumber || "").trim());
    }

    function renderClientsTable(){
        const tbody = document.getElementById("ceClientsTableBody");
        const emptyState = document.getElementById("ceClientsEmptyState");
        const visible = getVisibleClients();

        tbody.innerHTML = "";
        emptyState.classList.toggle("d-none", visible.length > 0);

        visible.forEach(function(client){
            const unsubscribed = isUnsubscribed(client);
            const eligible = isEligibleForActiveTab(client);
            const checked = eligible && selectedClientIds.has(client.id);

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${escapeHtml(client.name || "—")}</td>
                <td>${escapeHtml(client.email || "—")}</td>
                <td>${formatDate(client.lastVisit)}</td>
                <td>${Number(client.totalVisits) || 0}</td>
                <td class="ce-pref-cell">
                    <span class="marketing-status-pill ${unsubscribed ? "status-inactive" : "status-active"}">
                        ${unsubscribed ? "Not Interested" : "Interested"}
                    </span>
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

    function initDefaultSelection(){
        // "By default nakacheck" — every eligible client starts selected.
        selectedClientIds = new Set(
            clients.filter(function(client){
                const hasEmail = Boolean(normalizeEmail(client.email)) && !isUnsubscribed(client);
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
        document.getElementById("cePanelEmail").classList.toggle("d-none", tab !== "email");
        document.getElementById("cePanelSms").classList.toggle("d-none", tab !== "sms");

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

        const recipients = clients
            .filter(function(client){
                return Boolean(normalizeEmail(client.email)) && !isUnsubscribed(client) && selectedClientIds.has(client.id);
            })
            .map(function(client){ return { email: client.email, name: client.name }; });

        if(recipients.length === 0){
            renderSendError(statusId, "Select at least one client with an email address.");
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

            sendBtn.textContent = "Sending...";

            const response = await firebase.functions().httpsCallable("sendMarketingEmailBlast")({
                subject: subject,
                message: message,
                recipients: recipients,
                attachmentUrl: attachmentUrl,
                attachmentName: attachmentName
            });

            renderSendStatus(statusId, response.data.results, "email(s)");
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

        const recipients = clients
            .filter(function(client){ return isEligibleForActiveTab(client) && selectedClientIds.has(client.id); })
            .map(function(client){ return { mobile: client.contactNumber, name: client.name }; });

        if(recipients.length === 0){
            renderSendError(statusId, "Select at least one client with a mobile number.");
            return;
        }

        const sendBtn = document.getElementById("ceSendSmsBtn");
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending...";

        try{
            const response = await firebase.functions().httpsCallable("sendMarketingSmsBlast")({
                message: message,
                recipients: recipients
            });

            renderSendStatus(statusId, response.data.results, "SMS message(s)");
        }catch(error){
            console.error("Failed to send marketing SMS blast:", error);
            renderSendError(statusId, "Could not send the SMS blast. Reason: " + (error?.message || "Unknown error"));
        }finally{
            sendBtn.disabled = false;
            sendBtn.textContent = "Send SMS";
        }
    }

    /* ---- Wiring ---- */

    function wireEvents(){
        document.getElementById("ceTabEmailBtn").addEventListener("click", function(){ setActiveTab("email"); });
        document.getElementById("ceTabSmsBtn").addEventListener("click", function(){ setActiveTab("sms"); });

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
    }

    document.addEventListener("DOMContentLoaded", async function(){
        wireEvents();
        updateSmsCharCount();

        await Promise.all([loadClients(), loadUnsubscribes()]);

        initDefaultSelection();
        renderClientsTable();
    });
})();
