/* ==========================================================================
   Crown Head Spa — Marketing / Pop up Poster

   Data model (Firestore):
     popupPoster/bookPage
       imageUrl, storagePath, active (bool), showUntil ("YYYY-MM-DD" or ""),
       updatedAt, updatedBy

   One poster only. The public Book page (Website/js/main.js,
   initPromoModal) reads this doc and pops the image up. If the doc has
   never been created the page keeps its built-in poster; once it exists,
   this doc is in charge (switch it off to show no popup at all).
   ========================================================================== */

(function(){
    const COLLECTION = "popupPoster";
    const DOC_ID = "bookPage";

    let currentUser = null;
    let current = null;

    function ref(){
        return firebase.firestore().collection(COLLECTION).doc(DOC_ID);
    }

    function el(id){
        return document.getElementById(id);
    }

    function todayKey(){
        const now = new Date();
        const pad = function(n){ return String(n).padStart(2, "0"); };
        return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    }

    function setStatus(message, isError){
        const box = el("popupPosterStatus");
        box.textContent = message || "";
        box.className = "small mt-3 " + (message ? (isError ? "text-danger" : "text-muted") : "d-none");
    }

    function render(){
        const hasPoster = !!(current && current.imageUrl);

        el("popupPosterEditor").classList.toggle("d-none", !hasPoster);
        el("popupPosterEmpty").classList.toggle("d-none", hasPoster);
        el("popupPosterEmpty").textContent = current === null
            ? "No poster set here yet, so the Book page keeps showing its original built-in poster. Upload one to take over."
            : "No pop up poster — the Book page shows no popup. Upload one to bring it back.";

        if(!hasPoster){
            return;
        }

        const expired = current.showUntil && current.showUntil < todayKey();
        const state = el("popupPosterState");

        el("popupPosterImg").src = current.imageUrl;
        el("popupPosterActive").checked = current.active !== false;
        el("popupPosterUntil").value = current.showUntil || "";

        state.textContent = current.active === false ? "Off" : (expired ? "Expired" : "");
        state.classList.toggle("d-none", !state.textContent);
    }

    async function upload(file){
        if(!file || !file.type.startsWith("image/")){
            setStatus("Please choose an image file.", true);
            return;
        }

        setStatus("Uploading…");

        try{
            const blob = await window.CrownPosterTools.compressImage(file);
            const path = COLLECTION + "/" + Date.now() + ".jpg";
            const storageRef = firebase.storage().ref().child(path);

            await storageRef.put(blob, { contentType: "image/jpeg" });
            const imageUrl = await storageRef.getDownloadURL();
            const oldPath = current && current.storagePath;

            await ref().set({
                imageUrl: imageUrl,
                storagePath: path,
                active: true,
                showUntil: "",
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: currentUser.account || ""
            });

            if(oldPath){
                firebase.storage().ref().child(oldPath).delete().catch(function(){});
            }

            setStatus("Poster uploaded — it's live on the Book page.");
            setTimeout(function(){ setStatus(""); }, 3000);
        }catch(error){
            console.error("Pop up poster upload failed:", error);
            setStatus("Upload failed: " + (error.message || error.code || "unknown error"), true);
        }
    }

    async function removePoster(){
        if(!current || !confirm("Remove the pop up poster? The Book page will show no popup.")){
            return;
        }

        /* Keep the doc (inactive, image cleared) rather than deleting it —
           a missing doc would bring back the built-in fallback poster. */
        await ref().set({
            imageUrl: "",
            storagePath: "",
            active: false,
            showUntil: "",
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUser.account || ""
        });

        if(current.storagePath){
            firebase.storage().ref().child(current.storagePath).delete().catch(function(){});
        }
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        const fileInput = el("popupPosterFileInput");

        el("popupPosterUploadBtn").addEventListener("click", function(){ fileInput.click(); });

        fileInput.addEventListener("change", async function(){
            const file = fileInput.files[0];
            await upload(file);
            fileInput.value = "";
        });

        el("popupPosterActive").addEventListener("change", function(){
            ref().update({ active: this.checked, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });

        el("popupPosterUntil").addEventListener("change", function(){
            ref().update({ showUntil: this.value || "", updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });

        el("popupPosterRemoveBtn").addEventListener("click", removePoster);

        ref().onSnapshot(function(doc){
            current = doc.exists ? doc.data() : null;
            render();
        }, function(error){
            console.error("Unable to load pop up poster:", error);
            setStatus("Unable to load: " + (error.message || error.code), true);
        });
    });
})();
