/* ==========================================================================
   Crown Head Spa — Local data store (IndexedDB behind localStorage)

   Every synced "crown*" key used to live in localStorage. Safari (Mac,
   iPhone, iPad) caps localStorage at about 5 MB per site, and the shared
   dataset outgrew that in September 2026 — Safari then silently refused
   every new record while the sidebar still said "Synced to Cloud", so
   Safari showed old data while Chrome showed the latest.

   This file moves those keys into IndexedDB (a far larger quota) without
   touching any page's code: the pages keep calling
   localStorage.getItem/setItem/removeItem/key/length exactly as before,
   and the Storage.prototype overrides below answer from an in-memory copy
   that is loaded from IndexedDB and written back to it.

   The catch is that IndexedDB is async and every page reads its data
   synchronously the moment its scripts run. So the pages' own scripts
   don't run straight away: every <script> after this one is marked
   type="text/crown-deferred" in the HTML, and this file starts them — in
   their original order — only once the data is loaded. DOMContentLoaded
   and window "load" listeners those scripts add are held and called after
   they have all run, so pages that init on those events still work.

   What stays in real localStorage: device-local keys (login session,
   selected branch — same list as EXCLUDED_KEYS in firebase-sync.js), any
   non-"crown" key, and crownClientMasterList (already in its own
   IndexedDB database, see client-store.js).

   Load this first — before firebase-init.js, client-store.js and
   firebase-sync.js — so the overrides are underneath firebase-sync's and
   sidebar's own setItem/removeItem wrappers.
   ========================================================================== */

(function(){
    const DB_NAME = "crownLocalStore";
    const DB_VERSION = 1;
    const KV_STORE = "kv";

    /* Written synchronously on pagehide with any writes still on their way
       to IndexedDB, and replayed on the next load — an IndexedDB
       transaction isn't guaranteed to finish once the page is going away.
       Doesn't start with "crown", so it is never synced or managed. */
    const JOURNAL_KEY = "__crownStoreJournal";

    /* When this device first moved its data into IndexedDB. The old
       localStorage copies are left in place for NATIVE_CLEANUP_AFTER_MS
       rather than deleted straight away: a CrownOS tab still running the
       previous code (open since before the update, never navigated) keeps
       reading and writing them, and its own cloud listener keeps them
       current. Deleting them under it would let that tab read an empty
       list, add one record, and push that over the real data. This code
       never reads them again once the move is done. */
    const MIGRATED_KEY = "__crownStoreMigratedAt";
    const NATIVE_CLEANUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

    const OPEN_TIMEOUT_MS = 6000;
    const REVEAL_TIMEOUT_MS = 10000;

    const DEVICE_LOCAL_KEYS = [
        "crownCurrentUser",
        "crownLoggedIn",
        "crownSelectedBranch",
        "crownUsername",
        "crownPassword"
    ];

    const CLIENT_MASTER_LIST_KEY = "crownClientMasterList";

    function isManaged(key){
        return (
            typeof key === "string" &&
            key.startsWith("crown") &&
            key !== CLIENT_MASTER_LIST_KEY &&
            !DEVICE_LOCAL_KEYS.includes(key)
        );
    }

    const nativeGetItem = Storage.prototype.getItem;
    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    const nativeKey = Storage.prototype.key;
    const nativeClear = Storage.prototype.clear;
    const nativeLengthGetter =
        Object.getOwnPropertyDescriptor(Storage.prototype, "length").get;

    let nativeLocalStorage = null;

    try{
        nativeLocalStorage = window.localStorage;
    }catch(error){
        nativeLocalStorage = null;
    }

    /* "loading" → "idb" (normal) or "native" (IndexedDB unavailable —
       everything falls through to real localStorage, the old behaviour). */
    let mode = "loading";
    let lastError = null;

    const mem = new Map();
    let keyListCache = null;

    const pendingWrites = new Map();   // key -> value | null, not yet sent
    const inflightWrites = new Map();  // key -> value | null, sent, not confirmed
    let writeScheduled = false;
    let db = null;
    let writeWaiters = [];
    let lastJournalText = null;

    function isLocal(storage){
        return nativeLocalStorage !== null && storage === nativeLocalStorage;
    }

    /* Managed-key writes made before the store has loaded (none of the
       deferred page scripts can, but be safe) — applied on top once it has. */
    const preReadyWrites = new Map();

    function useMem(storage, key){
        return mode === "idb" && isLocal(storage) && isManaged(key);
    }

    function useBuffer(storage, key){
        return mode === "loading" && isLocal(storage) && isManaged(key);
    }

    function invalidateKeys(){
        keyListCache = null;
    }

    function keyList(storage){
        if(keyListCache){
            return keyListCache;
        }

        const keys = [];
        const nativeLength = nativeLengthGetter.call(storage);

        for(let index = 0; index < nativeLength; index++){
            const key = nativeKey.call(storage, index);

            if(!isManaged(key)){
                keys.push(key);
            }
        }

        mem.forEach(function(value, key){
            keys.push(key);
        });

        keyListCache = keys;
        return keys;
    }

    /* Edits made on THIS page (not cloud updates, not other tabs) —
       activity-log.js listens here to record who changed what. */
    const localWriteListeners = [];

    function notifyLocalWrite(key, oldValue, newValue){
        if(oldValue === newValue){
            return;
        }

        localWriteListeners.forEach(function(listener){
            try{
                listener(key, oldValue, newValue);
            }catch(error){
                console.error("CrownStore: local-write listener failed.", error);
            }
        });
    }

    /* ---------- Storage.prototype overrides ---------- */

    Storage.prototype.getItem = function(key){
        key = String(key);

        if(useMem(this, key)){
            return mem.has(key) ? mem.get(key) : null;
        }

        if(useBuffer(this, key)){
            console.warn("CrownStore: '" + key + "' read before the store loaded.");
            return preReadyWrites.has(key) ? preReadyWrites.get(key) : null;
        }

        return nativeGetItem.call(this, key);
    };

    Storage.prototype.setItem = function(key, value){
        key = String(key);

        if(useMem(this, key)){
            value = String(value);
            const isNew = !mem.has(key);
            notifyLocalWrite(key, isNew ? null : mem.get(key), value);
            mem.set(key, value);

            if(isNew){
                invalidateKeys();
            }

            queueWrite(key, value);
            broadcast(key, value);
            return;
        }

        if(useBuffer(this, key)){
            preReadyWrites.set(key, String(value));
            return;
        }

        nativeSetItem.call(this, key, value);

        if(isLocal(this)){
            invalidateKeys();
        }
    };

    Storage.prototype.removeItem = function(key){
        key = String(key);

        if(useMem(this, key)){
            if(mem.has(key)){
                notifyLocalWrite(key, mem.get(key), null);
            }

            if(mem.delete(key)){
                invalidateKeys();
            }

            queueWrite(key, null);
            broadcast(key, null);
            return;
        }

        if(useBuffer(this, key)){
            preReadyWrites.set(key, null);
            return;
        }

        nativeRemoveItem.call(this, key);

        if(isLocal(this)){
            invalidateKeys();
        }
    };

    Storage.prototype.key = function(index){
        if(mode === "idb" && isLocal(this)){
            const keys = keyList(this);
            return index >= 0 && index < keys.length ? keys[index] : null;
        }

        return nativeKey.call(this, index);
    };

    Object.defineProperty(Storage.prototype, "length", {
        configurable: true,
        enumerable: true,
        get: function(){
            if(mode === "idb" && isLocal(this)){
                return keyList(this).length;
            }

            return nativeLengthGetter.call(this);
        }
    });

    Storage.prototype.clear = function(){
        if(mode === "idb" && isLocal(this)){
            Array.from(mem.keys()).forEach(function(key){
                queueWrite(key, null);
                broadcast(key, null);
            });

            mem.clear();
        }

        nativeClear.call(this);

        if(isLocal(this)){
            invalidateKeys();
        }
    };

    window.addEventListener("storage", invalidateKeys);

    /* ---------- IndexedDB writes ---------- */

    function queueWrite(key, value){
        pendingWrites.set(key, value);

        if(!writeScheduled){
            writeScheduled = true;
            Promise.resolve().then(sendWrites);
        }
    }

    function sendWrites(){
        writeScheduled = false;

        if(!db || pendingWrites.size === 0){
            settleWaitersIfIdle();
            return;
        }

        const batch = new Map(pendingWrites);
        pendingWrites.clear();

        batch.forEach(function(value, key){
            inflightWrites.set(key, value);
        });

        function finish(ok, error){
            batch.forEach(function(value, key){
                if(inflightWrites.get(key) === value){
                    inflightWrites.delete(key);
                }

                /* Put failed writes back unless something newer replaced them. */
                if(!ok && !pendingWrites.has(key)){
                    pendingWrites.set(key, value);
                }
            });

            if(ok){
                if(lastError){
                    lastError = null;
                    reportStatus();
                }
            }else{
                lastError = error || new Error("IndexedDB write failed");
                console.error("CrownStore: could not save to IndexedDB — will retry.", lastError);
                reportStatus();
                setTimeout(function(){
                    if(pendingWrites.size > 0 && !writeScheduled){
                        writeScheduled = true;
                        sendWrites();
                    }
                }, 3000);
            }

            settleWaitersIfIdle();
        }

        try{
            const tx = db.transaction(KV_STORE, "readwrite");
            const store = tx.objectStore(KV_STORE);

            batch.forEach(function(value, key){
                if(value === null){
                    store.delete(key);
                }else{
                    store.put(value, key);
                }
            });

            tx.oncomplete = function(){ finish(true); };
            tx.onerror = function(){ finish(false, tx.error); };
            tx.onabort = function(){ finish(false, tx.error); };
        }catch(error){
            finish(false, error);
        }
    }

    function settleWaitersIfIdle(){
        if(pendingWrites.size > 0 || inflightWrites.size > 0){
            return;
        }

        /* A journal written while the tab was hidden is now out of date —
           everything in it has reached IndexedDB. Left in place, the next
           page would replay it over anything saved since. */
        if(lastJournalText !== null){
            try{
                if(nativeGetItem.call(nativeLocalStorage, JOURNAL_KEY) === lastJournalText){
                    nativeRemoveItem.call(nativeLocalStorage, JOURNAL_KEY);
                }
            }catch(error){
                /* ignore */
            }

            lastJournalText = null;
        }

        const waiters = writeWaiters;
        writeWaiters = [];
        waiters.forEach(function(resolve){ resolve(); });
    }

    /* Resolves once every write so far has reached IndexedDB (or right
       away if nothing is pending). Never rejects. */
    function flush(){
        if(mode !== "idb" || (pendingWrites.size === 0 && inflightWrites.size === 0)){
            return Promise.resolve();
        }

        return new Promise(function(resolve){
            writeWaiters.push(resolve);

            if(pendingWrites.size > 0 && !writeScheduled){
                writeScheduled = true;
                Promise.resolve().then(sendWrites);
            }

            /* Don't hold a navigation hostage to a stuck database. */
            setTimeout(resolve, 3000);
        });
    }

    function writeJournal(){
        if(mode !== "idb" || !nativeLocalStorage){
            return;
        }

        const unsaved = {};
        let count = 0;

        inflightWrites.forEach(function(value, key){ unsaved[key] = value; count++; });
        pendingWrites.forEach(function(value, key){ unsaved[key] = value; count++; });

        if(count === 0){
            return;
        }

        try{
            let existing = {};

            try{
                existing = JSON.parse(nativeGetItem.call(nativeLocalStorage, JOURNAL_KEY) || "{}") || {};
            }catch(error){
                existing = {};
            }

            lastJournalText = JSON.stringify(Object.assign(existing, unsaved));
            nativeSetItem.call(nativeLocalStorage, JOURNAL_KEY, lastJournalText);
        }catch(error){
            console.error("CrownStore: could not write the unload journal.", error);
        }
    }

    window.addEventListener("pagehide", writeJournal);

    document.addEventListener("visibilitychange", function(){
        if(document.visibilityState === "hidden"){
            writeJournal();
        }
    });

    /* ---------- Other tabs ---------- */

    /* Other CrownOS tabs keep their own in-memory copy, so tell them about
       local edits (the cloud listener would get there too, just later). */
    let channel = null;

    try{
        channel = "BroadcastChannel" in window ? new BroadcastChannel("crownStore") : null;
    }catch(error){
        channel = null;
    }

    function broadcast(key, value){
        if(channel){
            try{
                channel.postMessage({ key: key, value: value });
            }catch(error){
                /* ignore */
            }
        }
    }

    if(channel){
        channel.onmessage = function(event){
            const data = event.data || {};

            if(mode !== "idb" || !isManaged(data.key)){
                return;
            }

            if(applyToMem(data.key, data.value)){
                window.dispatchEvent(new CustomEvent("crownCloudUpdate", {
                    detail: { keys: [data.key] }
                }));
            }
        };
    }

    /* Updates the in-memory copy only (the sending tab or firebase-sync
       handles persistence). Returns whether the value changed. */
    function applyToMem(key, value){
        if(value === null || value === undefined){
            if(mem.delete(key)){
                invalidateKeys();
                return true;
            }

            return false;
        }

        value = String(value);

        if(mem.get(key) === value){
            return false;
        }

        if(!mem.has(key)){
            invalidateKeys();
        }

        mem.set(key, value);
        return true;
    }

    /* For firebase-sync.js: a value that came FROM the cloud. Saved here
       but not broadcast (every tab gets it from its own listener) and not
       routed through setItem (so it isn't queued for a push back up). */
    function applyRemote(key, value){
        if(mode !== "idb" || !isManaged(key)){
            if(value === null){
                nativeRemoveItem.call(nativeLocalStorage, key);
            }else{
                nativeSetItem.call(nativeLocalStorage, key, value);
            }

            invalidateKeys();
            return;
        }

        if(applyToMem(key, value)){
            queueWrite(key, value === null ? null : String(value));
        }
    }

    /* ---------- Startup ---------- */

    function openDb(){
        return new Promise(function(resolve, reject){
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(){
                if(!request.result.objectStoreNames.contains(KV_STORE)){
                    request.result.createObjectStore(KV_STORE);
                }
            };

            request.onsuccess = function(){ resolve(request.result); };
            request.onerror = function(){ reject(request.error); };
            request.onblocked = function(){ reject(new Error("IndexedDB open blocked")); };
        });
    }

    function readAll(database){
        return new Promise(function(resolve, reject){
            const tx = database.transaction(KV_STORE, "readonly");
            const store = tx.objectStore(KV_STORE);
            const out = new Map();
            const request = store.openCursor();

            request.onsuccess = function(){
                const cursor = request.result;

                if(cursor){
                    out.set(String(cursor.key), cursor.value);
                    cursor.continue();
                }
            };

            tx.oncomplete = function(){ resolve(out); };
            tx.onerror = function(){ reject(tx.error); };
            tx.onabort = function(){ reject(tx.error); };
        });
    }

    function readJournal(){
        try{
            return JSON.parse(nativeGetItem.call(nativeLocalStorage, JOURNAL_KEY) || "{}") || {};
        }catch(error){
            return {};
        }
    }

    function nativeManagedKeys(){
        const keys = [];
        const nativeLength = nativeLengthGetter.call(nativeLocalStorage);

        for(let index = 0; index < nativeLength; index++){
            const key = nativeKey.call(nativeLocalStorage, index);

            if(isManaged(key)){
                keys.push(key);
            }
        }

        return keys;
    }

    /* Brings into IndexedDB, on top of what it already has:
       - the first time only, every managed key in real localStorage (the
         move from the old storage — left in place, see MIGRATED_KEY);
       - the unload journal from the last page, if any. */
    function absorbFromLocalStorage(database, loaded){
        return new Promise(function(resolve, reject){
            const migratedAt = Number(nativeGetItem.call(nativeLocalStorage, MIGRATED_KEY) || 0);
            const journal = readJournal();
            const journalKeys = Object.keys(journal).filter(isManaged);
            const toMigrate = migratedAt ? [] : nativeManagedKeys();

            if(migratedAt && Date.now() - migratedAt > NATIVE_CLEANUP_AFTER_MS){
                nativeManagedKeys().forEach(function(key){
                    nativeRemoveItem.call(nativeLocalStorage, key);
                });
            }

            if(toMigrate.length === 0 && journalKeys.length === 0){
                if(!migratedAt){
                    nativeSetItem.call(nativeLocalStorage, MIGRATED_KEY, String(Date.now()));
                }

                if(nativeGetItem.call(nativeLocalStorage, JOURNAL_KEY) !== null){
                    nativeRemoveItem.call(nativeLocalStorage, JOURNAL_KEY);
                }

                resolve();
                return;
            }

            const tx = database.transaction(KV_STORE, "readwrite");
            const store = tx.objectStore(KV_STORE);

            toMigrate.forEach(function(key){
                const value = nativeGetItem.call(nativeLocalStorage, key);

                if(value !== null){
                    store.put(value, key);
                    loaded.set(key, value);
                }
            });

            journalKeys.forEach(function(key){
                const value = journal[key];

                if(value === null){
                    store.delete(key);
                    loaded.delete(key);
                }else{
                    store.put(String(value), key);
                    loaded.set(key, String(value));
                }
            });

            tx.oncomplete = function(){
                if(!migratedAt){
                    nativeSetItem.call(nativeLocalStorage, MIGRATED_KEY, String(Date.now()));
                    console.info("CrownStore: moved " + toMigrate.length + " key(s) from localStorage into IndexedDB.");
                }

                nativeRemoveItem.call(nativeLocalStorage, JOURNAL_KEY);
                resolve();
            };

            tx.onerror = function(){ reject(tx.error); };
            tx.onabort = function(){ reject(tx.error); };
        });
    }

    async function loadStore(){
        if(!("indexedDB" in window) || !nativeLocalStorage){
            throw new Error("IndexedDB or localStorage unavailable");
        }

        const database = await openDb();
        const loaded = await readAll(database);
        await absorbFromLocalStorage(database, loaded);

        database.onversionchange = function(){
            database.close();
        };

        return { database: database, loaded: loaded };
    }

    function withTimeout(promise, ms){
        return new Promise(function(resolve, reject){
            const timer = setTimeout(function(){
                reject(new Error("IndexedDB did not respond within " + ms + " ms"));
            }, ms);

            promise.then(
                function(value){ clearTimeout(timer); resolve(value); },
                function(error){ clearTimeout(timer); reject(error); }
            );
        });
    }

    const readyPromise = withTimeout(loadStore(), OPEN_TIMEOUT_MS).then(
        function(result){
            db = result.database;
            result.loaded.forEach(function(value, key){
                mem.set(key, value);
            });
            invalidateKeys();
            mode = "idb";
            applyPreReadyWrites();
            return true;
        },
        function(error){
            /* Old behaviour: everything in real localStorage. Safari's size
               limit applies again, but the app keeps working. */
            console.error("CrownStore: IndexedDB unavailable — falling back to localStorage.", error);
            lastError = error;
            mode = "native";
            invalidateKeys();
            applyPreReadyWrites();
            return false;
        }
    );

    function applyPreReadyWrites(){
        preReadyWrites.forEach(function(value, key){
            if(value === null){
                localStorage.removeItem(key);
            }else{
                localStorage.setItem(key, value);
            }
        });

        preReadyWrites.clear();
    }

    function reportStatus(){
        window.dispatchEvent(new CustomEvent("crownStoreStatus", {
            detail: { mode: mode, error: lastError }
        }));
    }

    /* ---------- Deferred page scripts ---------- */

    /* Hide the page until its scripts have run — it used to be scripts in
       <head> (access check, redirects) that ran before anything painted. */
    const hideStyle = document.createElement("style");
    hideStyle.textContent = "html.crown-store-loading body{visibility:hidden}";
    document.head.appendChild(hideStyle);
    document.documentElement.classList.add("crown-store-loading");

    function reveal(){
        document.documentElement.classList.remove("crown-store-loading");
    }

    setTimeout(reveal, REVEAL_TIMEOUT_MS);

    /* DOMContentLoaded / load listeners added by the deferred scripts are
       held here and called once they have all run. */
    const heldListeners = { DOMContentLoaded: [], load: [] };
    let holdPhase = "hold";   // "hold" → "dcl" (running DCL listeners) → "done"

    const nativeDocAdd = document.addEventListener;
    const nativeDocRemove = document.removeEventListener;
    const nativeWinAdd = window.addEventListener;
    const nativeWinRemove = window.removeEventListener;

    function holdable(target, type){
        return (
            (target === document && type === "DOMContentLoaded") ||
            (target === window && (type === "load" || type === "DOMContentLoaded"))
        );
    }

    function listenerFn(listener){
        return typeof listener === "function"
            ? listener
            : listener && typeof listener.handleEvent === "function"
                ? function(event){ listener.handleEvent(event); }
                : null;
    }

    function patchedAdd(nativeAdd){
        return function(type, listener, options){
            if(holdPhase !== "done" && holdable(this, type) && listener){
                if(type === "DOMContentLoaded" && holdPhase === "dcl"){
                    /* Added while DCL listeners are running — the event has
                       already happened, so just run it next. */
                    const target = this;
                    const fn = listenerFn(listener);

                    if(fn){
                        Promise.resolve().then(function(){
                            fn.call(target, new Event("DOMContentLoaded"));
                        });
                    }

                    return;
                }

                heldListeners[type].push({ target: this, listener: listener });
                return;
            }

            return nativeAdd.call(this, type, listener, options);
        };
    }

    function patchedRemove(nativeRemove){
        return function(type, listener, options){
            if(holdPhase !== "done" && holdable(this, type)){
                const list = heldListeners[type];
                const index = list.findIndex(function(entry){
                    return entry.target === this && entry.listener === listener;
                }, this);

                if(index >= 0){
                    list.splice(index, 1);
                    return;
                }
            }

            return nativeRemove.call(this, type, listener, options);
        };
    }

    function runHeld(type){
        const list = heldListeners[type];
        heldListeners[type] = [];

        list.forEach(function(entry){
            const fn = listenerFn(entry.listener);

            if(!fn){
                return;
            }

            try{
                fn.call(entry.target, new Event(type));
            }catch(error){
                console.error(error);
            }
        });
    }

    function whenDomParsed(){
        return document.readyState === "loading"
            ? new Promise(function(resolve){
                nativeDocAdd.call(document, "DOMContentLoaded", resolve, { once: true });
            })
            : Promise.resolve();
    }

    function whenWindowLoaded(){
        return document.readyState === "complete"
            ? Promise.resolve()
            : new Promise(function(resolve){
                nativeWinAdd.call(window, "load", resolve, { once: true });
            });
    }

    /* Starts every deferred script in document order. External and inline
       scripts are both inserted as async=false external scripts (inline
       ones via a blob URL), so the browser fetches them in parallel but
       still runs them strictly in order. */
    function runDeferredScripts(){
        const originals =
            Array.from(document.querySelectorAll('script[type="text/crown-deferred"]'));

        if(originals.length === 0){
            return Promise.resolve();
        }

        return new Promise(function(resolve){
            let remaining = originals.length;

            function done(){
                remaining--;

                if(remaining === 0){
                    resolve();
                }
            }

            originals.forEach(function(original){
                const script = document.createElement("script");
                script.async = false;

                if(original.src){
                    script.src = original.src;
                }else{
                    script.src = URL.createObjectURL(new Blob(
                        [original.textContent],
                        { type: "text/javascript" }
                    ));
                }

                script.onload = done;
                script.onerror = function(){
                    console.error("CrownStore: failed to load " + (original.src || "an inline script"));
                    done();
                };

                original.parentNode.insertBefore(script, original.nextSibling);
            });
        });
    }

    async function startPage(){
        await readyPromise;
        reportStatus();

        /* Every deferred <script> is in the DOM once parsing is done. */
        await whenDomParsed();

        document.addEventListener = patchedAdd(nativeDocAdd);
        document.removeEventListener = patchedRemove(nativeDocRemove);
        window.addEventListener = patchedAdd(nativeWinAdd);
        window.removeEventListener = patchedRemove(nativeWinRemove);

        await runDeferredScripts();

        holdPhase = "dcl";
        runHeld("DOMContentLoaded");

        /* Let listeners added during DCL run before anything else. */
        await Promise.resolve();

        reveal();

        await whenWindowLoaded();

        holdPhase = "done";
        document.addEventListener = nativeDocAdd;
        document.removeEventListener = nativeDocRemove;
        window.addEventListener = nativeWinAdd;
        window.removeEventListener = nativeWinRemove;

        runHeld("load");
    }

    startPage().catch(function(error){
        console.error("CrownStore: page start failed.", error);
        reveal();
    });

    window.CrownStore = {
        ready: function(){ return readyPromise; },
        mode: function(){ return mode; },
        lastError: function(){ return lastError; },
        isManaged: isManaged,
        applyRemote: applyRemote,
        flush: flush,
        onLocalWrite: function(listener){
            localWriteListeners.push(listener);
        },
        hasPendingWrites: function(){
            return pendingWrites.size > 0 || inflightWrites.size > 0;
        },
        keys: function(){
            const keys = [];

            for(let index = 0; index < localStorage.length; index++){
                keys.push(localStorage.key(index));
            }

            return keys;
        }
    };
})();
