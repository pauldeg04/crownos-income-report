/* ==========================================================================
   Crown Head Spa — Marketing / Promo Posters

   Data model (Firestore):
     promoPosters/{posterId}
       imageUrl, storagePath, title, active (bool), order (number),
       showUntil ("YYYY-MM-DD" or ""), createdAt, createdBy

   Images live in Cloud Storage under promoPosters/. The public website
   (Website/promos.html -> js/promo-carousel.js) reads this collection
   directly, keeps the active, unexpired posters, and plays them as a
   slideshow in ascending "order".
   ========================================================================== */

(function(){
    const COLLECTION = "promoPosters";
    const MAX_DIMENSION = 1600;
    const JPEG_QUALITY = 0.85;

    let currentUser = null;
    let posters = [];

    function db(){
        return firebase.firestore();
    }

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function todayKey(){
        const now = new Date();
        const pad = function(n){ return String(n).padStart(2, "0"); };
        return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    }

    function setStatus(message, isError){
        const el = document.getElementById("promoPosterStatus");
        el.textContent = message || "";
        el.className = "small mt-3 " + (message ? (isError ? "text-danger" : "text-muted") : "d-none");
    }

    /* Shrinks big phone photos before upload so the website stays fast. */
    function compressImage(file){
        return new Promise(function(resolve, reject){
            const url = URL.createObjectURL(file);
            const img = new Image();

            img.onload = function(){
                const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);

                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);

                canvas.toBlob(function(blob){
                    if(blob){
                        resolve(blob);
                    }else{
                        reject(new Error("Could not process " + file.name));
                    }
                }, "image/jpeg", JPEG_QUALITY);
            };

            img.onerror = function(){
                URL.revokeObjectURL(url);
                reject(new Error(file.name + " is not a readable image."));
            };

            img.src = url;
        });
    }

    window.CrownPosterTools = { compressImage: compressImage };

    async function uploadFiles(files){
        const list = Array.from(files).filter(function(f){ return f.type.startsWith("image/"); });

        if(!list.length){
            setStatus("Please choose image files.", true);
            return;
        }

        let nextOrder = posters.reduce(function(max, p){ return Math.max(max, Number(p.order) || 0); }, 0);
        let done = 0;

        for(const file of list){
            setStatus("Uploading " + (done + 1) + " of " + list.length + "…");

            try{
                const blob = await compressImage(file);
                const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
                const path = COLLECTION + "/" + Date.now() + "_" + baseName + ".jpg";
                const ref = firebase.storage().ref().child(path);

                await ref.put(blob, { contentType: "image/jpeg" });
                const imageUrl = await ref.getDownloadURL();

                nextOrder += 1;

                await db().collection(COLLECTION).add({
                    imageUrl: imageUrl,
                    storagePath: path,
                    title: baseName.replace(/[_-]+/g, " ").trim(),
                    active: true,
                    order: nextOrder,
                    showUntil: "",
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: currentUser.account || ""
                });

                done += 1;
            }catch(error){
                console.error("Poster upload failed:", error);
                setStatus("Upload failed for " + file.name + ": " + (error.message || error.code || "unknown error"), true);
                return;
            }
        }

        setStatus(done + " poster" + (done === 1 ? "" : "s") + " uploaded.");
        setTimeout(function(){ setStatus(""); }, 3000);
    }

    function render(){
        const grid = document.getElementById("promoPosterGrid");
        const empty = document.getElementById("promoPosterEmpty");
        const today = todayKey();

        empty.classList.toggle("d-none", posters.length > 0);

        grid.innerHTML = posters.map(function(p, index){
            const expired = p.showUntil && p.showUntil < today;
            const live = p.active && !expired;
            const stateLabel = !p.active ? "Off" : (expired ? "Expired" : "");

            return `
                <div class="promo-poster-card ${live ? "" : "is-off"}" data-id="${escapeHtml(p.id)}">
                    <div class="promo-poster-thumb">
                        <img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.title)}" loading="lazy">
                        <span class="promo-poster-badge">#${index + 1}</span>
                        ${stateLabel ? `<span class="promo-poster-state">${stateLabel}</span>` : ""}
                    </div>
                    <div class="promo-poster-body">
                        <input type="text" class="form-control form-control-sm promo-poster-title" value="${escapeHtml(p.title)}" placeholder="Label (for your reference)">
                        <label class="small text-muted mb-0">Show until (optional)
                            <input type="date" class="form-control form-control-sm promo-poster-until" value="${escapeHtml(p.showUntil || "")}">
                        </label>
                        <div class="form-check form-switch mb-0">
                            <input class="form-check-input promo-poster-active" type="checkbox" ${p.active ? "checked" : ""}>
                            <label class="form-check-label small">Show on website</label>
                        </div>
                        <div class="promo-poster-actions">
                            <button type="button" class="btn btn-sm btn-outline-secondary promo-poster-up" ${index === 0 ? "disabled" : ""}>↑</button>
                            <button type="button" class="btn btn-sm btn-outline-secondary promo-poster-down" ${index === posters.length - 1 ? "disabled" : ""}>↓</button>
                            <button type="button" class="btn btn-sm btn-outline-danger ms-auto promo-poster-delete">Delete</button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    }

    async function swapOrder(id, direction){
        const index = posters.findIndex(function(p){ return p.id === id; });
        const other = posters[index + direction];
        const mine = posters[index];

        if(!mine || !other){
            return;
        }

        /* Orders can tie (or be missing) on older docs, so renumber the
           whole list rather than swapping two values. */
        const reordered = posters.slice();
        reordered[index] = other;
        reordered[index + direction] = mine;

        const batch = db().batch();
        reordered.forEach(function(p, i){
            batch.update(db().collection(COLLECTION).doc(p.id), { order: i + 1 });
        });
        await batch.commit();
    }

    async function deletePoster(id){
        const poster = posters.find(function(p){ return p.id === id; });

        if(!poster || !confirm("Delete this poster? It will disappear from the website.")){
            return;
        }

        await db().collection(COLLECTION).doc(id).delete();

        if(poster.storagePath){
            firebase.storage().ref().child(poster.storagePath).delete().catch(function(error){
                console.warn("Could not remove poster file:", error);
            });
        }
    }

    function bindEvents(){
        const fileInput = document.getElementById("promoPosterFileInput");

        document.getElementById("promoPosterUploadBtn").addEventListener("click", function(){
            fileInput.click();
        });

        fileInput.addEventListener("change", async function(){
            const files = fileInput.files;
            await uploadFiles(files);
            fileInput.value = "";
        });

        const grid = document.getElementById("promoPosterGrid");

        grid.addEventListener("click", function(event){
            const card = event.target.closest(".promo-poster-card");

            if(!card){
                return;
            }

            const id = card.dataset.id;

            if(event.target.closest(".promo-poster-up")){
                swapOrder(id, -1);
            }else if(event.target.closest(".promo-poster-down")){
                swapOrder(id, 1);
            }else if(event.target.closest(".promo-poster-delete")){
                deletePoster(id);
            }
        });

        grid.addEventListener("change", function(event){
            const card = event.target.closest(".promo-poster-card");

            if(!card){
                return;
            }

            const ref = db().collection(COLLECTION).doc(card.dataset.id);

            if(event.target.classList.contains("promo-poster-active")){
                ref.update({ active: event.target.checked });
            }else if(event.target.classList.contains("promo-poster-until")){
                ref.update({ showUntil: event.target.value || "" });
            }else if(event.target.classList.contains("promo-poster-title")){
                ref.update({ title: event.target.value.trim() });
            }
        });
    }

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        bindEvents();

        db().collection(COLLECTION).onSnapshot(function(snapshot){
            posters = snapshot.docs
                .map(function(doc){ return Object.assign({ id: doc.id }, doc.data()); })
                .sort(function(a, b){ return (Number(a.order) || 0) - (Number(b.order) || 0); });

            render();
        }, function(error){
            console.error("Unable to load promo posters:", error);
            setStatus("Unable to load posters: " + (error.message || error.code), true);
        });
    });
})();
