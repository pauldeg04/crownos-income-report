/* ==========================================================================
   Crown Head Spa — Announcement (Admin Hub)

   Single-slot doc in Firestore collection "announcement", id "current".
   Publishing overwrites it (no history) and notifies every active user
   account via CrownClientNotifications (see notifications.js). "Send to
   Archive" copies the current announcement into "announcementArchive"
   (one doc per archived announcement, kept forever) and clears the
   current slot — Admin and Executive Assistant only, per firestore.rules.
   ========================================================================== */

(function(){
    const COLLECTION = "announcement";
    const ARCHIVE_COLLECTION = "announcementArchive";
    const DOC_ID = "current";

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatUpdatedAt(timestamp){
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

    function renderView(data){
        const emptyState = document.getElementById("announcementEmptyState");
        const content = document.getElementById("announcementContent");

        if(!data || (!data.title && !data.body)){
            emptyState.classList.remove("d-none");
            content.classList.add("d-none");
            return;
        }

        emptyState.classList.add("d-none");
        content.classList.remove("d-none");

        document.getElementById("announcementTitle").textContent = data.title || "";
        document.getElementById("announcementBody").textContent = data.body || "";

        const meta = [];
        const stamp = formatUpdatedAt(data.updatedAt);

        if(stamp){
            meta.push(stamp);
        }

        if(data.updatedByName){
            meta.push("by " + data.updatedByName);
        }

        document.getElementById("announcementMeta").textContent = meta.join(" · ");
    }

    function openEditor(data){
        document.getElementById("announcementTitleInput").value = data?.title || "";
        document.getElementById("announcementBodyInput").value = data?.body || "";
        document.getElementById("announcementEditor").classList.remove("d-none");
        document.getElementById("announcementEditTrigger").classList.add("d-none");
    }

    function closeEditor(){
        document.getElementById("announcementEditor").classList.add("d-none");
        document.getElementById("announcementEditTrigger").classList.remove("d-none");
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        const currentUser = window.CrownAuth?.getCurrentUser?.();
        const isEditor = currentUser?.role === "Admin" || currentUser?.role === "Executive Assistant";
        let latest = null;

        if(isEditor){
            document.getElementById("announcementEditTrigger").classList.remove("d-none");
            document.getElementById("announcementViewArchiveBtn").classList.remove("d-none");
        }

        firebase.firestore()
            .collection(COLLECTION)
            .doc(DOC_ID)
            .onSnapshot(function(doc){
                latest = doc.exists ? doc.data() : null;
                renderView(latest);
            }, function(error){
                console.error("Unable to load announcement:", error);
            });

        document.getElementById("announcementEditBtn")?.addEventListener("click", function(){
            openEditor(latest);
        });

        document.getElementById("announcementCancelBtn")?.addEventListener("click", function(){
            closeEditor();
        });

        document.getElementById("announcementSaveBtn")?.addEventListener("click", async function(){
            const title = document.getElementById("announcementTitleInput").value.trim();
            const body = document.getElementById("announcementBodyInput").value.trim();

            if(!title && !body){
                alert("Enter a title or a message before saving.");
                return;
            }

            const btn = document.getElementById("announcementSaveBtn");
            btn.disabled = true;

            try{
                await firebase.firestore()
                    .collection(COLLECTION)
                    .doc(DOC_ID)
                    .set({
                        title,
                        body,
                        updatedBy: currentUser.account || "",
                        updatedByName: currentUser.nickname || currentUser.account || "",
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });

                const recipients = (window.CrownAuth?.getUsers?.() || [])
                    .filter(function(u){ return u.status === "Active"; })
                    .map(function(u){ return u.account; })
                    .filter(Boolean);

                await window.CrownClientNotifications?.broadcast?.(
                    recipients,
                    "New announcement: " + (title || body.slice(0, 60)),
                    "announcement"
                );

                closeEditor();
            }catch(error){
                console.error("Unable to save announcement:", error);
                alert("Unable to save the announcement. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        if(!isEditor){
            return;
        }

        document.getElementById("announcementArchiveBtn")?.addEventListener("click", async function(){
            if(!latest || (!latest.title && !latest.body)){
                alert("There's no announcement to archive.");
                return;
            }

            if(!confirm("Send the current announcement to the archive? It will be cleared from view.")){
                return;
            }

            const btn = this;
            btn.disabled = true;

            try{
                await firebase.firestore().collection(ARCHIVE_COLLECTION).add({
                    title: latest.title || "",
                    body: latest.body || "",
                    updatedBy: latest.updatedBy || "",
                    updatedByName: latest.updatedByName || "",
                    updatedAt: latest.updatedAt || null,
                    archivedBy: currentUser.account || "",
                    archivedByName: currentUser.nickname || currentUser.account || "",
                    archivedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                await firebase.firestore().collection(COLLECTION).doc(DOC_ID).set({
                    title: "",
                    body: "",
                    updatedBy: currentUser.account || "",
                    updatedByName: currentUser.nickname || currentUser.account || "",
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }catch(error){
                console.error("Unable to archive announcement:", error);
                alert("Unable to archive this announcement. Please try again.");
            }finally{
                btn.disabled = false;
            }
        });

        const archiveBackdrop = document.getElementById("announcementArchiveBackdrop");

        function closeArchive(){
            archiveBackdrop.classList.add("d-none");
        }

        document.getElementById("announcementArchiveCloseBtn").addEventListener("click", closeArchive);
        document.getElementById("announcementArchiveCloseFooterBtn").addEventListener("click", closeArchive);

        archiveBackdrop.addEventListener("click", function(event){
            if(event.target === archiveBackdrop){
                closeArchive();
            }
        });

        document.getElementById("announcementViewArchiveBtn").addEventListener("click", async function(){
            const list = document.getElementById("announcementArchiveList");
            const empty = document.getElementById("announcementArchiveEmpty");

            archiveBackdrop.classList.remove("d-none");
            list.innerHTML = "";
            empty.classList.add("d-none");

            try{
                const snapshot = await firebase.firestore()
                    .collection(ARCHIVE_COLLECTION)
                    .orderBy("archivedAt", "desc")
                    .limit(200)
                    .get();

                if(snapshot.empty){
                    empty.classList.remove("d-none");
                    return;
                }

                list.innerHTML = snapshot.docs.map(function(doc){
                    const item = doc.data();

                    return `
                        <div class="announcement-archive-item">
                            <h6>${escapeHtml(item.title || "(No title)")}</h6>
                            <p>${escapeHtml(item.body || "")}</p>
                            <small>Posted ${escapeHtml(formatUpdatedAt(item.updatedAt))} by ${escapeHtml(item.updatedByName || "")} · Archived ${escapeHtml(formatUpdatedAt(item.archivedAt))} by ${escapeHtml(item.archivedByName || "")}</small>
                        </div>
                    `;
                }).join("");
            }catch(error){
                console.error("Unable to load announcement archive:", error);
                empty.classList.remove("d-none");
                empty.textContent = "Unable to load the archive. Please try again.";
            }
        });
    });
})();
/* ==========================================================================
   Crown Head Spa — Memo (Admin Hub)

   Firestore collection "memos", one doc per memo:
     { subject, body, senderAccount, senderName, recipients: string[],
       createdAt, acknowledgements: { "<syncEmail>": { acknowledgedAt } } }
   Only Admin/Executive Assistant may compose. Acknowledgements map keys
   are the recipient's full sync email (crownToSyncEmail, from
   notifications.js) so the Firestore rule can match request.auth.token.email
   directly with no lookup.
   ========================================================================== */

(function(){
    const COLLECTION = "memos";
    let currentUser = null;
    let canCompose = false;
    let editingMemoId = null;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatDate(timestamp){
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

    function sortByCreatedAtDesc(list){
        return list.slice().sort(function(a, b){
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });
    }

    function renderInbox(memos){
        const list = document.getElementById("memoInboxList");
        const empty = document.getElementById("memoInboxEmpty");
        const myEmail = crownToSyncEmail(currentUser.account);

        if(memos.length === 0){
            list.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        list.innerHTML = sortByCreatedAtDesc(memos).map(function(memo){
            const acked = !!memo.acknowledgements?.[myEmail];

            return `
                <div class="memo-card">
                    <div class="memo-card-header">
                        <div>
                            <p class="memo-subject">${escapeHtml(memo.subject || "(No subject)")}</p>
                            <div class="memo-meta">From ${escapeHtml(memo.senderName || memo.senderAccount)} · ${escapeHtml(formatDate(memo.createdAt))}</div>
                        </div>
                        ${acked
                            ? '<span class="badge bg-success">Acknowledged</span>'
                            : `<button type="button" class="btn btn-sm btn-primary memo-ack-btn" data-id="${escapeHtml(memo.id)}">Acknowledge</button>`
                        }
                    </div>
                    <div class="memo-body">${escapeHtml(memo.body || "")}</div>
                </div>
            `;
        }).join("");

        list.querySelectorAll(".memo-ack-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                btn.disabled = true;

                try{
                    /* A sync email always contains a literal "." (the
                       @crownos-sync.com domain), so a plain string key
                       like "acknowledgements." + myEmail gets misread by
                       Firestore as a multi-segment path split on EVERY
                       dot ("acknowledgements" -> "u-name@crownos-sync"
                       -> "com"), not the single flat key this — and the
                       matching firestore.rules check on
                       request.auth.token.email — expects. FieldPath with
                       each segment as its own argument sidesteps that
                       dot-splitting entirely. */
                    await firebase.firestore()
                        .collection(COLLECTION)
                        .doc(btn.dataset.id)
                        .update(
                            new firebase.firestore.FieldPath("acknowledgements", myEmail),
                            { acknowledgedAt: firebase.firestore.FieldValue.serverTimestamp() }
                        );
                }catch(error){
                    console.error("Unable to acknowledge memo:", error);
                    alert("Unable to acknowledge this memo. Please try again.");
                    btn.disabled = false;
                }
            });
        });
    }

    let sentMemosCache = [];

    function renderSent(memos){
        const list = document.getElementById("memoSentList");
        const empty = document.getElementById("memoSentEmpty");

        sentMemosCache = memos;

        if(memos.length === 0){
            list.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        const usersByAccount = {};
        (window.CrownAuth?.getUsers?.() || []).forEach(function(u){
            usersByAccount[u.account] = u;
        });

        list.innerHTML = sortByCreatedAtDesc(memos).map(function(memo){
            const ackRows = (memo.recipients || []).map(function(account){
                const email = crownToSyncEmail(account);
                const ack = memo.acknowledgements?.[email];
                const name = usersByAccount[account]?.nickname || account;

                return ack
                    ? `<div class="memo-ack-row acked">${escapeHtml(name)}<span>${escapeHtml(formatDate(ack.acknowledgedAt))}</span></div>`
                    : `<div class="memo-ack-row pending">${escapeHtml(name)}<span>Pending</span></div>`;
            }).join("");

            return `
                <div class="memo-card">
                    <div class="memo-card-header">
                        <div>
                            <p class="memo-subject">${escapeHtml(memo.subject || "(No subject)")}</p>
                            <div class="memo-meta">${escapeHtml(formatDate(memo.createdAt))}</div>
                        </div>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-sm btn-outline-secondary memo-edit-btn" data-id="${escapeHtml(memo.id)}">Edit</button>
                            <button type="button" class="btn btn-sm btn-outline-danger memo-delete-btn" data-id="${escapeHtml(memo.id)}">Delete</button>
                        </div>
                    </div>
                    <div class="memo-body">${escapeHtml(memo.body || "")}</div>
                    <div class="memo-ack-list">${ackRows}</div>
                </div>
            `;
        }).join("");

        list.querySelectorAll(".memo-edit-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openComposeModal(sentMemosCache.find(function(m){ return m.id === btn.dataset.id; }));
            });
        });

        list.querySelectorAll(".memo-delete-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Delete this memo? This cannot be undone.")){
                    return;
                }

                btn.disabled = true;

                try{
                    await firebase.firestore().collection(COLLECTION).doc(btn.dataset.id).delete();
                }catch(error){
                    console.error("Unable to delete memo:", error);
                    alert("Unable to delete this memo. Please try again.");
                    btn.disabled = false;
                }
            });
        });
    }

    function renderRecipientOptions(containerId){
        const wrap = document.getElementById(containerId);
        const users = (window.CrownAuth?.getUsers?.() || [])
            .filter(function(u){
                return u.status === "Active" && u.account !== currentUser.account;
            });

        wrap.innerHTML = users.map(function(u){
            return `
                <label class="memo-recipient-option">
                    <input type="checkbox" value="${escapeHtml(u.account)}">
                    ${escapeHtml(u.nickname || u.account)} <span class="text-muted">(${escapeHtml(u.role)})</span>
                </label>
            `;
        }).join("");
    }

    let groupsCache = [];

    function renderGroupSelect(){
        const select = document.getElementById("memoGroupSelect");

        select.innerHTML = '<option value="">— Select a group to check its members —</option>' +
            groupsCache.map(function(g){
                return `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${g.members.length})</option>`;
            }).join("");

        document.getElementById("memoGroupPickWrap").classList.toggle("d-none", groupsCache.length === 0);
    }

    function renderGroupManageList(){
        const wrap = document.getElementById("memoGroupExistingList");

        if(groupsCache.length === 0){
            wrap.innerHTML = '<p class="text-muted mb-0">No groups yet — create one below.</p>';
            return;
        }

        wrap.innerHTML = groupsCache.map(function(g){
            return `
                <div class="memo-group-existing-item">
                    <div>
                        <strong>${escapeHtml(g.name)}</strong>
                        <small>${g.members.length} member(s)</small>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger memo-group-delete-btn" data-id="${escapeHtml(g.id)}">Delete</button>
                </div>
            `;
        }).join("");

        wrap.querySelectorAll(".memo-group-delete-btn").forEach(function(btn){
            btn.addEventListener("click", async function(){
                if(!confirm("Delete this group?")){
                    return;
                }

                try{
                    await firebase.firestore().collection("memoGroups").doc(btn.dataset.id).delete();
                }catch(error){
                    console.error("Unable to delete group:", error);
                    alert("Unable to delete this group. Please try again.");
                }
            });
        });
    }

    function openComposeModal(memo){
        editingMemoId = memo ? memo.id : null;

        document.getElementById("memoComposeTitle").textContent = memo ? "Edit Memo" : "Compose Memo";
        document.getElementById("memoComposeSendBtn").textContent = memo ? "Save Changes" : "Send Memo";
        document.getElementById("memoComposeDeleteBtn").classList.toggle("d-none", !memo);

        document.getElementById("memoSubjectInput").value = memo ? (memo.subject || "") : "";
        document.getElementById("memoBodyInput").value = memo ? (memo.body || "") : "";
        document.getElementById("memoGroupSelect").value = "";
        renderRecipientOptions("memoRecipientList");

        if(memo){
            document.querySelectorAll("#memoRecipientList input[type=checkbox]").forEach(function(input){
                input.checked = (memo.recipients || []).includes(input.value);
            });
        }

        document.getElementById("memoComposeBackdrop").classList.remove("d-none");
    }

    function switchTab(tab){
        document.getElementById("memoTabInbox").classList.toggle("active", tab === "inbox");
        document.getElementById("memoTabSent").classList.toggle("active", tab === "sent");
        document.getElementById("memoInboxPane").classList.toggle("d-none", tab !== "inbox");
        document.getElementById("memoSentPane").classList.toggle("d-none", tab !== "sent");
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        canCompose = currentUser.role === "Admin" || currentUser.role === "Executive Assistant";

        if(canCompose){
            document.getElementById("memoComposeBtn").classList.remove("d-none");
            document.getElementById("memoCreateGroupBtn").classList.remove("d-none");
            document.getElementById("memoTabSentWrap").classList.remove("d-none");

            firebase.firestore()
                .collection("memoGroups")
                .onSnapshot(function(snapshot){
                    groupsCache = snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    });
                    renderGroupSelect();
                    renderGroupManageList();
                }, function(error){
                    console.error("Unable to load memo groups:", error);
                });
        }

        document.getElementById("memoTabInbox").addEventListener("click", function(){ switchTab("inbox"); });
        document.getElementById("memoTabSent")?.addEventListener("click", function(){ switchTab("sent"); });

        firebase.firestore()
            .collection(COLLECTION)
            .where("recipients", "array-contains", currentUser.account)
            .onSnapshot(function(snapshot){
                renderInbox(snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                }));
            }, function(error){
                console.error("Unable to load inbox memos:", error);
            });

        if(canCompose){
            firebase.firestore()
                .collection(COLLECTION)
                .where("senderAccount", "==", currentUser.account)
                .onSnapshot(function(snapshot){
                    renderSent(snapshot.docs.map(function(doc){
                        return Object.assign({ id: doc.id }, doc.data());
                    }));
                }, function(error){
                    console.error("Unable to load sent memos:", error);
                });

            const backdrop = document.getElementById("memoComposeBackdrop");

            document.getElementById("memoComposeBtn").addEventListener("click", function(){
                openComposeModal(null);
            });

            document.getElementById("memoComposeDeleteBtn").addEventListener("click", async function(){
                if(!editingMemoId){
                    return;
                }

                if(!confirm("Delete this memo? This cannot be undone.")){
                    return;
                }

                const btn = this;
                btn.disabled = true;

                try{
                    await firebase.firestore().collection(COLLECTION).doc(editingMemoId).delete();
                    backdrop.classList.add("d-none");
                }catch(error){
                    console.error("Unable to delete memo:", error);
                    alert("Unable to delete this memo. Please try again.");
                }finally{
                    btn.disabled = false;
                }
            });

            document.getElementById("memoGroupSelect").addEventListener("change", function(){
                const selectedId = this.value;
                const group = groupsCache.find(function(g){ return g.id === selectedId; });

                if(!group){
                    return;
                }

                document.querySelectorAll("#memoRecipientList input[type=checkbox]").forEach(function(input){
                    if(group.members.includes(input.value)){
                        input.checked = true;
                    }
                });
            });

            document.getElementById("memoComposeCloseBtn").addEventListener("click", function(){
                editingMemoId = null;
                backdrop.classList.add("d-none");
            });

            document.getElementById("memoComposeCancelBtn").addEventListener("click", function(){
                editingMemoId = null;
                backdrop.classList.add("d-none");
            });

            backdrop.addEventListener("click", function(event){
                if(event.target === backdrop){
                    editingMemoId = null;
                    backdrop.classList.add("d-none");
                }
            });

            document.getElementById("memoComposeSendBtn").addEventListener("click", async function(){
                const subject = document.getElementById("memoSubjectInput").value.trim();
                const body = document.getElementById("memoBodyInput").value.trim();

                const recipients = Array.from(
                    document.querySelectorAll("#memoRecipientList input[type=checkbox]:checked")
                ).map(function(input){ return input.value; });

                if(!subject || !body){
                    alert("Enter a subject and a message.");
                    return;
                }

                if(recipients.length === 0){
                    alert("Select at least one recipient.");
                    return;
                }

                const btn = document.getElementById("memoComposeSendBtn");
                btn.disabled = true;

                try{
                    if(editingMemoId){
                        await firebase.firestore()
                            .collection(COLLECTION)
                            .doc(editingMemoId)
                            .update({ subject, body, recipients });

                        editingMemoId = null;
                    }else{
                        await firebase.firestore()
                            .collection(COLLECTION)
                            .add({
                                subject,
                                body,
                                senderAccount: currentUser.account,
                                senderName: currentUser.nickname || currentUser.account,
                                recipients,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                acknowledgements: {}
                            });

                        await window.CrownClientNotifications?.broadcast?.(
                            recipients,
                            "New memo: " + subject,
                            "memo"
                        );
                    }

                    backdrop.classList.add("d-none");
                }catch(error){
                    console.error("Unable to save memo:", error);
                    alert("Unable to save this memo. Please try again.");
                }finally{
                    btn.disabled = false;
                }
            });

            const groupBackdrop = document.getElementById("memoGroupBackdrop");

            document.getElementById("memoCreateGroupBtn").addEventListener("click", function(){
                document.getElementById("memoGroupNameInput").value = "";
                renderRecipientOptions("memoGroupMemberList");
                renderGroupManageList();
                groupBackdrop.classList.remove("d-none");
            });

            document.getElementById("memoGroupCloseBtn").addEventListener("click", function(){
                groupBackdrop.classList.add("d-none");
            });

            document.getElementById("memoGroupCloseFooterBtn").addEventListener("click", function(){
                groupBackdrop.classList.add("d-none");
            });

            groupBackdrop.addEventListener("click", function(event){
                if(event.target === groupBackdrop){
                    groupBackdrop.classList.add("d-none");
                }
            });

            document.getElementById("memoGroupSaveBtn").addEventListener("click", async function(){
                const name = document.getElementById("memoGroupNameInput").value.trim();

                const members = Array.from(
                    document.querySelectorAll("#memoGroupMemberList input[type=checkbox]:checked")
                ).map(function(input){ return input.value; });

                if(!name){
                    alert("Enter a group name.");
                    return;
                }

                if(members.length === 0){
                    alert("Select at least one member.");
                    return;
                }

                const btn = this;
                btn.disabled = true;

                try{
                    await firebase.firestore().collection("memoGroups").add({
                        name,
                        members,
                        createdBy: currentUser.account,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    document.getElementById("memoGroupNameInput").value = "";
                    renderRecipientOptions("memoGroupMemberList");
                }catch(error){
                    console.error("Unable to save group:", error);
                    alert("Unable to save this group. Please try again.");
                }finally{
                    btn.disabled = false;
                }
            });
        }
    });
})();

/* ==========================================================================
   Bulletin Board — tab controller

   Switches between the Announcement and Memo panels above (each panel's
   own script, unchanged, keeps running underneath). Reads ?tab=memo /
   ?tab=announcement so sidebar.js's notification links can land on the
   right tab directly.
   ========================================================================== */

(function(){
    const PANELS = {
        announcement: "announcementTabPanel",
        memo: "memoTabPanel"
    };

    function selectTab(tab){
        if(!PANELS[tab]){
            tab = "announcement";
        }

        document.querySelectorAll('#bulletinTabs [role="tab"]').forEach(function(btn){
            btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
        });

        Object.keys(PANELS).forEach(function(key){
            document.getElementById(PANELS[key]).classList.toggle("d-none", key !== tab);
        });
    }

    document.addEventListener("DOMContentLoaded", function(){
        document.querySelectorAll('#bulletinTabs [role="tab"]').forEach(function(btn){
            btn.addEventListener("click", function(){
                selectTab(btn.dataset.tab);
            });
        });

        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        selectTab(requestedTab || "announcement");
    });
})();
