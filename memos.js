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

    function renderSent(memos){
        const list = document.getElementById("memoSentList");
        const empty = document.getElementById("memoSentEmpty");

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
                    </div>
                    <div class="memo-body">${escapeHtml(memo.body || "")}</div>
                    <div class="memo-ack-list">${ackRows}</div>
                </div>
            `;
        }).join("");
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
                document.getElementById("memoSubjectInput").value = "";
                document.getElementById("memoBodyInput").value = "";
                document.getElementById("memoGroupSelect").value = "";
                renderRecipientOptions("memoRecipientList");
                backdrop.classList.remove("d-none");
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
                backdrop.classList.add("d-none");
            });

            document.getElementById("memoComposeCancelBtn").addEventListener("click", function(){
                backdrop.classList.add("d-none");
            });

            backdrop.addEventListener("click", function(event){
                if(event.target === backdrop){
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

                    backdrop.classList.add("d-none");
                }catch(error){
                    console.error("Unable to send memo:", error);
                    alert("Unable to send this memo. Please try again.");
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
