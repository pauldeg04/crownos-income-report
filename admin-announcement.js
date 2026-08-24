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
