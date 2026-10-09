/* ==========================================================================
   Crown Head Spa — Activity Log (recording side)

   Records who did what, for the Admin-only Activity Log page
   (activity-log.html). One Firestore document per activity in the
   "activityLog" collection — deliberately NOT a synced crown* key: one
   ever-growing shared blob is exactly what overflowed Safari's storage
   (see crown-store.js). Documents can only be created, never edited or
   deleted (firestore.rules), and expire on their own after 90 days
   (TTL policy on expireAt, see firestore.indexes.json).

   Two sources:

   1. Automatic — every edit this page makes to a synced crown* key
      (CrownStore.onLocalWrite; cloud updates and other tabs are not
      reported there). Writes to the same key within AUTO_SETTLE_MS are
      merged, then the before/after JSON is compared to describe the
      change ("Petty Cash · Added: Load allowance (₱500)").

   2. Explicit — CrownActivityLog.log({...}) from a page that knows the
      real action. Daily Income uses this for Add to List / Settle /
      Edit / Delete / Clear, and its crownDailySales_* key is left out of
      the automatic path: each tab saves its whole sales list, so a tab
      whose list was behind would otherwise look like it had deleted
      someone else's sale.

   Loaded right after firebase-sync.js on every page.
   ========================================================================== */

(function(){
    const COLLECTION = "activityLog";
    const RETENTION_DAYS = 90;
    const AUTO_SETTLE_MS = 1500;
    const MAX_DETAILS = 8;
    const MAX_TEXT = 300;

    /* UI state and system bookkeeping — not something a person "did". */
    const IGNORED_KEYS = [
        "crownGlobalDate",
        "crownSidebarCollapsed",
        "crownSidebarSectionCollapsed",
        "crownPaydayTab",
        "crownDailyMonitoringDate",
        "crownPushPrompted",
        "crownPushEnabled",
        "crownCloudDisableSync",
        "crownNotifications",
        "crownBackupMetadata",
        "crownDutyLog"
    ];

    /* Logged explicitly by their page (see the header comment) — only on
       that page; other pages that touch these keys (e.g. renaming a
       branch in List of Branches) still go through the automatic path. */
    const EXPLICIT_PREFIXES = [
        { prefix: "crownDailySales_", pages: ["index.html", ""] },
        /* Updated as a side effect of every sale — the sale entry covers it. */
        { prefix: "crownStockAudit", pages: ["index.html", ""] }
    ];

    /* Prefix → module name shown in the log. First match wins. */
    const MODULES = [
        ["crownSchedule_", "Scheduling"],
        ["crownUnavailableBeds", "Scheduling"],
        ["crownBlockedDates", "Scheduling"],
        ["crownExpenses_", "Expenses Report"],
        ["crownRecurring_", "Expenses Report"],
        ["crownCashflow_", "Cash Flow"],
        ["crownPettyCash_", "Petty Cash"],
        ["crownProductPrevFund_", "Product Sales Summary"],
        ["crownProductExpenses_", "Product Sales Summary"],
        ["crownLoyaltyPrevFund_", "Loyalty Card Sales Summary"],
        ["crownLoyaltyExpenses_", "Loyalty Card Sales Summary"],
        ["crownBranchMasterList", "List of Branches"],
        ["crownServiceMasterList", "List of Services"],
        ["crownTherapistMasterList", "List of Therapists"],
        ["crownProductMasterList", "List of Products"],
        ["crownUserAccounts", "Account Settings"],
        ["crownAttendanceLog", "Attendance"],
        ["crownWarehouseStock", "Warehouse Inventory"],
        ["crownWarehouseLog", "Warehouse Inventory"],
        ["crownBranchStock", "Branch Inventory"],
        ["crownStockRequests", "Stock Requests"],
        ["crownStockAudit", "Stock Audit"],
        ["crownDailyAuditReports", "Daily Audit Report"],
        ["crownInventoryItemsList", "Inventory Settings"],
        ["crownVoucherRegistry", "Vouchers"],
        ["crownShareholder", "Share Holder Report"],
        ["crownPayroll", "Payroll"],
        ["crownBackupHistory", "System Health"]
    ];

    /* Field names never copied into a log entry (only their names are
       ever listed, but be strict anyway). */
    const SECRET_FIELD = /pass|hash|pin|token|secret/i;

    /* Bookkeeping fields that change on every save. */
    const NOISE_FIELDS = ["updatedAt", "createdAt", "lastModified", "modifiedAt", "savedAt", "syncedAt"];

    const LABEL_FIELDS = [
        "client", "clientName", "name", "title", "itemName", "item",
        "description", "particulars", "category", "therapist", "staffName",
        "staff", "account", "employee", "label", "subject", "code"
    ];

    const AMOUNT_FIELDS = ["amount", "total", "netAmount", "grossAmount", "price", "value"];

    let autoPaused = 0;
    const pendingAuto = new Map();   // key -> { oldValue, newValue, timer }
    const inflight = new Set();

    /* ---------- helpers ---------- */

    function clip(text, max){
        text = String(text == null ? "" : text);
        max = max || MAX_TEXT;
        return text.length > max ? text.slice(0, max - 1) + "…" : text;
    }

    function localDay(date){
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function peso(value){
        const number = Number(value);

        if(!isFinite(number)){
            return "";
        }

        return "₱" + number.toLocaleString("en-PH", { maximumFractionDigits: 2 });
    }

    function currentSession(){
        try{
            return JSON.parse(localStorage.getItem("crownCurrentUser") || "null") || {};
        }catch(error){
            return {};
        }
    }

    function pageName(){
        return location.pathname.split("/").pop();
    }

    function moduleForKey(key){
        for(const [prefix, name] of MODULES){
            if(key.startsWith(prefix)){
                return name;
            }
        }

        return key.replace(/^crown/, "").replace(/_.*/, "");
    }

    /* crownPettyCash_Calamba_2026-09 → { branch: "Calamba", period: "2026-09" } */
    function branchAndPeriod(key){
        const underscore = key.indexOf("_");

        if(underscore === -1){
            return { branch: "", period: "" };
        }

        const rest = key.slice(underscore + 1);
        const match = rest.match(/^(.*)_(\d{4}-\d{2}(?:-\d{2})?)$/);

        if(match){
            return { branch: match[1], period: match[2] };
        }

        return { branch: rest, period: "" };
    }

    function parse(value){
        if(value === null || value === undefined){
            return undefined;
        }

        try{
            return JSON.parse(value);
        }catch(error){
            return value;
        }
    }

    function isPlainObject(value){
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function itemLabel(item){
        if(!isPlainObject(item)){
            return clip(item, 80);
        }

        let label = "";

        for(const field of LABEL_FIELDS){
            if(item[field] !== undefined && item[field] !== null && String(item[field]).trim() && !SECRET_FIELD.test(field)){
                label = String(item[field]).trim();
                break;
            }
        }

        for(const field of AMOUNT_FIELDS){
            if(item[field] !== undefined && item[field] !== "" && isFinite(Number(item[field]))){
                label += (label ? " " : "") + "(" + peso(item[field]) + ")";
                break;
            }
        }

        return clip(label || item.id || "entry", 100);
    }

    function itemId(item){
        if(!isPlainObject(item)){
            return null;
        }

        for(const field of ["id", "key", "uid", "code"]){
            if(item[field] !== undefined && item[field] !== null && item[field] !== ""){
                return field + ":" + item[field];
            }
        }

        return null;
    }

    function changedFields(before, after){
        const fields = new Set(Object.keys(before || {}).concat(Object.keys(after || {})));
        const changed = [];

        fields.forEach(function(field){
            if(NOISE_FIELDS.includes(field)){
                return;
            }

            if(JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field])){
                changed.push(field);
            }
        });

        return changed;
    }

    function describeFieldChange(field, before, after){
        if(SECRET_FIELD.test(field)){
            return field + " changed";
        }

        const simple = function(value){
            return value === undefined || value === null || typeof value !== "object";
        };

        if(simple(before) && simple(after)){
            return field + ": " + clip(before === undefined || before === "" ? "—" : before, 60) +
                " → " + clip(after === undefined || after === "" ? "—" : after, 60);
        }

        return field + " changed";
    }

    /* Returns { summary, details[] } for one array's before/after. */
    function diffArrays(before, after){
        before = before || [];
        after = after || [];

        const keyed =
            before.concat(after).every(function(item){ return itemId(item) !== null; });

        if(!keyed){
            const added = after.length - before.length;

            if(added > 0){
                return {
                    summary: "Added " + added + " entr" + (added === 1 ? "y" : "ies"),
                    details: after.slice(-Math.min(added, MAX_DETAILS)).map(function(item){ return "+ " + itemLabel(item); })
                };
            }

            if(added < 0){
                return { summary: "Removed " + (-added) + " entr" + (added === -1 ? "y" : "ies"), details: [] };
            }

            return { summary: "Updated entries", details: [] };
        }

        const beforeById = new Map(before.map(function(item){ return [itemId(item), item]; }));
        const afterById = new Map(after.map(function(item){ return [itemId(item), item]; }));
        const added = [];
        const removed = [];
        const edited = [];

        afterById.forEach(function(item, id){
            if(!beforeById.has(id)){
                added.push(item);
            }else{
                const fields = changedFields(beforeById.get(id), item);

                if(fields.length > 0){
                    edited.push({ before: beforeById.get(id), after: item, fields: fields });
                }
            }
        });

        beforeById.forEach(function(item, id){
            if(!afterById.has(id)){
                removed.push(item);
            }
        });

        const parts = [];
        const details = [];

        if(added.length){
            parts.push(added.length === 1 ? "Added: " + itemLabel(added[0]) : "Added " + added.length + " entries");
            added.forEach(function(item){ details.push("+ " + itemLabel(item)); });
        }

        if(edited.length){
            parts.push(edited.length === 1 ? "Edited: " + itemLabel(edited[0].after) : "Edited " + edited.length + " entries");
            edited.forEach(function(entry){
                details.push("✎ " + itemLabel(entry.after) + " — " + entry.fields.slice(0, 4).map(function(field){
                    return describeFieldChange(field, entry.before[field], entry.after[field]);
                }).join("; "));
            });
        }

        if(removed.length){
            parts.push(removed.length === 1 ? "Removed: " + itemLabel(removed[0]) : "Removed " + removed.length + " entries");
            removed.forEach(function(item){ details.push("− " + itemLabel(item)); });
        }

        return { summary: parts.join(" · "), details: details };
    }

    function isEmptyValue(value){
        return (
            value === undefined ||
            value === null ||
            value === "" ||
            (Array.isArray(value) && value.length === 0) ||
            (isPlainObject(value) && Object.keys(value).length === 0)
        );
    }

    /* Returns null when nothing a person would call a change happened
       (e.g. an empty list created, or only timestamps moved). */
    function describeChange(key, oldValue, newValue){
        const change = describeChangeRaw(key, oldValue, newValue);
        return change && change.summary ? change : null;
    }

    function describeChangeRaw(key, oldValue, newValue){
        const before = parse(oldValue);
        const after = parse(newValue);

        if(isEmptyValue(before) && isEmptyValue(after)){
            return null;
        }

        if(after === undefined){
            return { action: "Deleted", summary: "Deleted all data for this record", details: [] };
        }

        if(before === undefined){
            if(Array.isArray(after)){
                const result = diffArrays([], after);
                return { action: "Created", summary: result.summary, details: result.details };
            }

            return { action: "Created", summary: "Created", details: [] };
        }

        if(Array.isArray(before) || Array.isArray(after)){
            const result = diffArrays(Array.isArray(before) ? before : [], Array.isArray(after) ? after : []);
            return { action: "Updated", summary: result.summary, details: result.details };
        }

        /* An object whose main content is one list (e.g. { rows: [...] }). */
        if(isPlainObject(before) && isPlainObject(after)){
            const listField = ["rows", "entries", "items", "records", "list"].find(function(field){
                return Array.isArray(before[field]) || Array.isArray(after[field]);
            });

            const fields = changedFields(before, after);

            if(listField && fields.length === 1 && fields[0] === listField){
                const result = diffArrays(before[listField], after[listField]);
                return { action: "Updated", summary: result.summary, details: result.details };
            }

            if(fields.length === 0){
                return null;
            }

            return {
                action: "Updated",
                summary: fields.length === 1 ? "Changed " + fields[0] : "Changed " + fields.length + " fields",
                details: fields.slice(0, MAX_DETAILS).map(function(field){
                    return describeFieldChange(field, before[field], after[field]);
                })
            };
        }

        return {
            action: "Updated",
            summary: SECRET_FIELD.test(key) ? "Changed" : clip(before, 60) + " → " + clip(after, 60),
            details: []
        };
    }

    /* ---------- sending ---------- */

    function canSend(){
        return (
            window.firebase &&
            firebase.apps &&
            firebase.apps.length > 0 &&
            firebase.firestore &&
            firebase.auth &&
            firebase.auth().currentUser
        );
    }

    /* Entries made before Firebase has signed in on this page wait here. */
    const waitingForAuth = [];

    function send(entry){
        const now = new Date();
        const session = currentSession();

        const record = {
            day: localDay(now),
            clientTime: now.toISOString(),
            account: clip(session.account || "", 80),
            name: clip(session.nickname || session.account || "", 80),
            role: clip(session.role || "", 40),
            branch: clip(entry.branch || "", 80),
            page: clip(pageName() || "index.html", 80),
            module: clip(entry.module || "", 80),
            action: clip(entry.action || "", 80),
            summary: clip(entry.summary || "", MAX_TEXT),
            details: (entry.details || []).slice(0, MAX_DETAILS).map(function(line){ return clip(line, MAX_TEXT); }),
            ref: clip(entry.ref || "", 200)
        };

        if(window.CrownCloud?.isLocalTestEnv){
            console.info("CrownActivityLog (local test, not saved):", record);
            (window.__crownActivityLocal = window.__crownActivityLocal || []).push(record);
            return Promise.resolve();
        }

        if(!canSend()){
            waitingForAuth.push(record);
            return Promise.resolve();
        }

        return write(record);
    }

    function write(record){
        const user = firebase.auth().currentUser;

        const doc = Object.assign({}, record, {
            uid: user.uid,
            email: user.email || "",
            ts: firebase.firestore.FieldValue.serverTimestamp(),
            expireAt: firebase.firestore.Timestamp.fromMillis(
                Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000
            )
        });

        /* With Firestore persistence on, add() is queued locally and
           retried even across page loads if the network is down. */
        const promise = firebase.firestore().collection(COLLECTION).add(doc).catch(function(error){
            console.error("CrownActivityLog: could not save an activity entry.", error);
        });

        inflight.add(promise);
        promise.finally(function(){ inflight.delete(promise); });

        return promise;
    }

    if(window.firebase?.auth && firebase.apps?.length){
        firebase.auth().onAuthStateChanged(function(user){
            if(user && !window.CrownCloud?.isLocalTestEnv){
                waitingForAuth.splice(0).forEach(write);
            }
        });
    }

    /* ---------- automatic ---------- */

    function shouldAutoLog(key){
        return (
            !IGNORED_KEYS.includes(key) &&
            !EXPLICIT_PREFIXES.some(function(rule){
                return key.startsWith(rule.prefix) && rule.pages.includes(pageName());
            })
        );
    }

    function flushAutoKey(key){
        const pending = pendingAuto.get(key);

        if(!pending){
            return;
        }

        pendingAuto.delete(key);
        clearTimeout(pending.timer);

        if(pending.oldValue === pending.newValue){
            return;
        }

        let change;

        try{
            change = describeChange(key, pending.oldValue, pending.newValue);
        }catch(error){
            change = { action: "Updated", summary: "Updated", details: [] };
        }

        if(!change){
            return;
        }

        const where = branchAndPeriod(key);

        /* A schedule bucket is one day, and the Add Appointment modal has its
           own Date field, so say which day this save landed on — otherwise an
           appointment booked for another date looks like it vanished. */
        if(key.startsWith("crownSchedule_") && /^\d{4}-\d{2}-\d{2}$/.test(where.period)){
            const dayLabel = new Date(where.period + "T00:00:00")
                .toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

            change = {
                action: change.action,
                summary: change.summary + " (for " + dayLabel + ")",
                details: (change.details || []).map(function(line){ return line + " [" + dayLabel + "]"; })
            };
        }

        send({
            module: moduleForKey(key),
            action: change.action,
            summary: change.summary,
            details: change.details,
            branch: where.branch || localStorage.getItem("crownSelectedBranch") || "",
            ref: key
        });
    }

    function onLocalWrite(key, oldValue, newValue){
        if(autoPaused > 0 || !shouldAutoLog(key)){
            return;
        }

        const pending = pendingAuto.get(key);

        if(pending){
            pending.newValue = newValue;
            clearTimeout(pending.timer);
            pending.timer = setTimeout(function(){ flushAutoKey(key); }, AUTO_SETTLE_MS);
            return;
        }

        pendingAuto.set(key, {
            oldValue: oldValue,
            newValue: newValue,
            timer: setTimeout(function(){ flushAutoKey(key); }, AUTO_SETTLE_MS)
        });
    }

    function flushAll(){
        Array.from(pendingAuto.keys()).forEach(flushAutoKey);
    }

    /* Resolves once queued entries have been handed to Firestore (capped,
       so a navigation never waits long on a slow network). */
    function flush(){
        flushAll();

        if(inflight.size === 0){
            return Promise.resolve();
        }

        return Promise.race([
            Promise.all(Array.from(inflight)),
            new Promise(function(resolve){ setTimeout(resolve, 1500); })
        ]);
    }

    if(window.CrownStore?.onLocalWrite){
        window.CrownStore.onLocalWrite(onLocalWrite);
    }

    window.addEventListener("pagehide", flushAll);

    document.addEventListener("visibilitychange", function(){
        if(document.visibilityState === "hidden"){
            flushAll();
        }
    });

    window.CrownActivityLog = {
        /* entry: { module, action, summary, details?, branch?, ref? } */
        log: function(entry){
            return send(entry || {});
        },
        flush: flush,
        hasPending: function(){
            return pendingAuto.size > 0 || inflight.size > 0;
        },
        /* Runs fn without automatic entries (e.g. a backup restore that
           rewrites every key — logged once, explicitly, instead). */
        withoutAutoLog: async function(fn){
            autoPaused++;

            try{
                return await fn();
            }finally{
                autoPaused--;
            }
        },
        peso: peso,
        /* Exposed for testing. */
        _describeChange: describeChange
    };
})();
