/* ==========================================================================
   Crown Head Spa — Receipt Gallery (Compliance)

   Receipts live in the "crownReceipts" list (the "crown" prefix makes
   firebase-sync.js mirror it); attachments go to Cloud Storage under
   receiptGalleryFiles/. Admin and Executive Assistant both see every
   receipt and can upload; only Admin can edit or delete.
   ========================================================================== */

(function(){
    const KEY = "crownReceipts";

    let currentUser = null;
    let editingId = null;

    function $(id){ return document.getElementById(id); }

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function todayKey(){
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function formatDay(key){
        if(!key){ return ""; }
        return new Date(key + "T00:00:00")
            .toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
    }

    function formatMoney(value){
        return "₱" + Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function isAdmin(){
        return currentUser.role === "Admin";
    }

    function readReceipts(){
        try{
            const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    function writeReceipts(list){
        localStorage.setItem(KEY, JSON.stringify(list));
    }

    function userLabel(account){
        const user = (window.CrownAuth?.getUsers?.() || []).find(function(u){
            return u.account === account;
        });

        return user && user.nickname ? user.nickname + " (" + account + ")" : account;
    }

    function isImage(file){
        return /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name || "");
    }

    /* ---- Table ---- */

    function visibleReceipts(){
        const month = $("rgMonthFilter").value;
        const user = $("rgUserFilter").value;
        const search = $("rgSearch").value.trim().toLowerCase();

        return readReceipts().filter(function(r){
            return (!month || String(r.date).slice(0, 7) === month) &&
                (!user || r.uploadedBy === user) &&
                (!search || (r.title + " " + (r.notes || "")).toLowerCase().includes(search));
        }).sort(function(a, b){
            return String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt));
        });
    }

    function filesHtml(r){
        return (r.attachments || []).map(function(a){
            return isImage(a)
                ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img class="rg-thumb" src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}"></a>`
                : `<a class="rg-file" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(a.name)}</a>`;
        }).join("");
    }

    function renderTable(){
        const rows = visibleReceipts();
        let total = 0;

        $("rgTableBody").innerHTML = rows.map(function(r){
            total += Number(r.amount || 0);

            return `<tr>
                <td>${formatDay(r.date)}</td>
                <td>${escapeHtml(r.title)}</td>
                <td style="text-align:right">${formatMoney(r.amount)}</td>
                <td>${escapeHtml(r.notes || "")}</td>
                <td>${filesHtml(r)}</td>
                <td>${escapeHtml(userLabel(r.uploadedBy))}</td>
                <td>${isAdmin()
                    ? `<button type="button" class="btn btn-sm btn-outline-primary" data-edit="${escapeHtml(r.id)}">Edit</button>
                       <button type="button" class="btn btn-sm btn-outline-danger" data-delete="${escapeHtml(r.id)}">Delete</button>`
                    : ""}</td>
            </tr>`;
        }).join("");

        $("rgTotal").textContent = formatMoney(total);
        $("rgEmptyState").classList.toggle("d-none", rows.length > 0);

        $("rgTableBody").querySelectorAll("[data-edit]").forEach(function(btn){
            btn.addEventListener("click", function(){ openForm(btn.dataset.edit); });
        });
        $("rgTableBody").querySelectorAll("[data-delete]").forEach(function(btn){
            btn.addEventListener("click", function(){ deleteReceipt(btn.dataset.delete); });
        });
    }

    /* ---- Form ---- */

    function show(id){ $(id).classList.remove("d-none"); }
    function hide(id){ $(id).classList.add("d-none"); }

    function openForm(id){
        const r = id ? readReceipts().find(function(x){ return x.id === id; }) : null;

        editingId = r ? r.id : null;
        $("rgFormTitle").textContent = r ? "Edit Receipt" : "Upload Receipt";
        $("rgTitleInput").value = r ? r.title : "";
        $("rgDateInput").value = r ? r.date : todayKey();
        $("rgAmountInput").value = r ? r.amount : "";
        $("rgNotesInput").value = r ? (r.notes || "") : "";
        $("rgFilesInput").value = "";
        $("rgFilesRequired").classList.toggle("d-none", !!r);
        $("rgFilesHint").textContent = r
            ? "Choose files to add more attachments. Existing ones are kept."
            : "Images or PDF, up to 10 MB each.";

        show("rgFormBackdrop");
    }

    function uploadFile(file, receiptId){
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `receiptGalleryFiles/${receiptId}/${Date.now()}_${safeName}`;
        const ref = firebase.storage().ref().child(path);

        return ref.put(file).then(function(){
            return ref.getDownloadURL();
        }).then(function(url){
            return { name: file.name, path: path, url: url };
        });
    }

    function saveForm(){
        const title = $("rgTitleInput").value.trim();
        const date = $("rgDateInput").value;
        const amount = parseFloat($("rgAmountInput").value);
        const files = Array.from($("rgFilesInput").files);

        if(!title){ return alert("Please enter the Particular."); }
        if(!date){ return alert("Please set the Date."); }
        if(isNaN(amount) || amount < 0){ return alert("Please enter a valid Amount."); }
        if(!editingId && files.length === 0){ return alert("Please attach the receipt."); }
        if(editingId && !isAdmin()){ return; }

        const id = editingId || "RC-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
        const btn = $("rgSaveBtn");

        btn.disabled = true;
        btn.textContent = "Saving...";

        Promise.all(files.map(function(f){ return uploadFile(f, id); })).then(function(uploaded){
            const list = readReceipts();
            let r = list.find(function(x){ return x.id === id; });

            if(!r){
                r = { id: id, uploadedBy: currentUser.account, createdAt: new Date().toISOString(), attachments: [] };
                list.unshift(r);
            }

            r.title = title;
            r.date = date;
            r.amount = amount;
            r.notes = $("rgNotesInput").value.trim();
            r.attachments = (r.attachments || []).concat(uploaded);

            writeReceipts(list);
            hide("rgFormBackdrop");
            renderTable();
        }).catch(function(error){
            console.error("Unable to save receipt:", error);
            alert("Unable to save the receipt (" + (error && (error.code || error.message) || "unknown error") + "). Please try again.");
        }).finally(function(){
            btn.disabled = false;
            btn.textContent = "Save";
        });
    }

    function deleteReceipt(id){
        const list = readReceipts();
        const r = list.find(function(x){ return x.id === id; });

        if(!r || !isAdmin() || !confirm("Delete this receipt and its attachments?")){ return; }

        (r.attachments || []).forEach(function(a){
            if(a.path){
                firebase.storage().ref().child(a.path).delete().catch(function(){});
            }
        });

        writeReceipts(list.filter(function(x){ return x.id !== id; }));
        renderTable();
    }

    document.addEventListener("DOMContentLoaded", function(){
        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        $("rgMonthFilter").value = todayKey().slice(0, 7);

        const users = (window.CrownAuth.getUsers() || []).filter(function(u){
            return u.role === "Admin" || u.role === "Executive Assistant";
        });

        $("rgUserFilter").innerHTML = `<option value="">All</option>` + users.map(function(u){
            return `<option value="${escapeHtml(u.account)}">${escapeHtml(userLabel(u.account))}</option>`;
        }).join("");

        ["rgMonthFilter", "rgUserFilter"].forEach(function(id){
            $(id).addEventListener("change", renderTable);
        });
        $("rgSearch").addEventListener("input", renderTable);
        $("rgClearBtn").addEventListener("click", function(){
            $("rgMonthFilter").value = "";
            $("rgUserFilter").value = "";
            $("rgSearch").value = "";
            renderTable();
        });

        $("rgAddBtn").addEventListener("click", function(){ openForm(null); });
        $("rgSaveBtn").addEventListener("click", saveForm);

        document.querySelectorAll("[data-close]").forEach(function(btn){
            btn.addEventListener("click", function(){ hide(btn.dataset.close); });
        });
        $("rgFormBackdrop").addEventListener("click", function(event){
            if(event.target === $("rgFormBackdrop")){ hide("rgFormBackdrop"); }
        });

        renderTable();
    });
})();
