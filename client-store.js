/* ==========================================================================
   Crown Head Spa — Client Database local cache (IndexedDB)

   crownClientMasterList is the one synced key kept out of the normal
   localStorage mirror (see CLIENT_MASTER_LIST_KEY in firebase-sync.js) —
   it holds the whole Client Database as one ever-growing JSON blob, and
   localStorage's per-origin quota is small and varies a lot by device.
   Mobile Safari/Chrome in particular can grant far less than desktop,
   especially on a device low on free storage — which is what broke sync
   (and even login, since one oversized key could take the whole pull down
   with it) on a couple of staff phones. IndexedDB has a much larger, more
   elastic quota, so this is purely a storage-location change: same shape
   (one JSON string holding one array), same pages reading/writing it,
   just async instead of synchronous.

   Everything here is one record, in one object store, in one database —
   deliberately as simple as the localStorage value it replaces.

   Load this script before firebase-sync.js (see every page's <head>) —
   the one-time migration below needs to run before firebase-sync.js
   installs its Storage.prototype.setItem/removeItem override, so the
   plain localStorage.removeItem call here is a real native call, not
   something that needs to bypass a sync-push trigger.
   ========================================================================== */

(function(){
    const DB_NAME = "crownClientCache";
    const DB_VERSION = 1;
    const STORE_NAME = "clientList";
    const RECORD_KEY = "current";
    const LEGACY_LOCALSTORAGE_KEY = "crownClientMasterList";

    function openDb(){
        return new Promise(function(resolve, reject){
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function(){
                if(!request.result.objectStoreNames.contains(STORE_NAME)){
                    request.result.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = function(){
                resolve(request.result);
            };

            request.onerror = function(){
                reject(request.error);
            };
        });
    }

    /* Moves whatever a device already has cached in localStorage under the
       old key into the new store, once, so a device that synced before
       this shipped doesn't just find its local client list gone. Uses the
       store directly (not withStore()) since withStore() depends on this
       having already finished — see the module-level readyDb below. */
    function migrateFromLocalStorageIfNeeded(db){
        return new Promise(function(resolve){
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const getRequest = store.get(RECORD_KEY);

            getRequest.onsuccess = function(){
                if(getRequest.result !== undefined){
                    resolve();
                    return;
                }

                let legacyValue = null;

                try{
                    legacyValue = window.localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
                }catch(error){
                    // Storage unavailable — nothing to migrate.
                }

                if(legacyValue === null){
                    resolve();
                    return;
                }

                store.put(legacyValue, RECORD_KEY);

                tx.oncomplete = function(){
                    try{
                        window.localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
                    }catch(error){
                        /* Not fatal — worst case this key stays in both
                           places until the next write here removes it. */
                    }

                    resolve();
                };
            };

            getRequest.onerror = function(){
                resolve(); // Best-effort — treat as "nothing to migrate".
            };
        });
    }

    /* Resolves to the open database, or null if IndexedDB is unavailable
       (very old browser, private-mode restrictions on some platforms) —
       every method below degrades to a no-op/empty-result in that case,
       same as firebase-sync.js already does when persistence is
       unavailable. */
    const readyDb = (async function(){
        if(!("indexedDB" in window)){
            return null;
        }

        let db;

        try{
            db = await openDb();
        }catch(error){
            console.error("CrownClientStore: IndexedDB unavailable — client list will not be cached locally.", error);
            return null;
        }

        await migrateFromLocalStorageIfNeeded(db);

        return db;
    })();

    function withStore(mode, run){
        return readyDb.then(function(db){
            if(!db){
                return undefined;
            }

            return new Promise(function(resolve, reject){
                const tx = db.transaction(STORE_NAME, mode);
                const store = tx.objectStore(STORE_NAME);
                const request = run(store);

                request.onsuccess = function(){
                    resolve(request.result);
                };

                request.onerror = function(){
                    reject(request.error);
                };
            });
        });
    }

    async function getRaw(){
        try{
            const result = await withStore("readonly", function(store){
                return store.get(RECORD_KEY);
            });

            return result === undefined ? null : result;
        }catch(error){
            console.error("CrownClientStore: read failed.", error);
            return null;
        }
    }

    async function saveRaw(value){
        try{
            await withStore("readwrite", function(store){
                return store.put(value, RECORD_KEY);
            });
        }catch(error){
            console.error("CrownClientStore: write failed.", error);
        }
    }

    async function clear(){
        try{
            await withStore("readwrite", function(store){
                return store.delete(RECORD_KEY);
            });
        }catch(error){
            console.error("CrownClientStore: clear failed.", error);
        }
    }

    async function getAll(){
        const raw = await getRaw();

        if(!raw){
            return [];
        }

        try{
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            console.error("CrownClientStore: could not parse the stored client list.", error);
            return [];
        }
    }

    /* Page-facing save — a genuine local edit, so this also queues the
       cloud push (see notifyClientListChanged in firebase-sync.js). Use
       saveRaw() instead when applying a change that came FROM the cloud;
       pushing that back would just be a pointless round trip. */
    async function saveAll(clients){
        await saveRaw(JSON.stringify(clients));
        window.CrownCloud?.notifyClientListChanged?.();
    }

    window.CrownClientStore = {
        getAll: getAll,
        saveAll: saveAll,
        getRaw: getRaw,
        saveRaw: saveRaw,
        clear: clear
    };
})();
