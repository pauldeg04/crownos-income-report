/* ==========================================================================
   Crown Head Spa — Firestore Sync Engine

   Mirrors every "crown*" localStorage key to the Firestore "appData"
   collection (one document per key) so all branches and devices share
   the same live data. Existing pages keep reading/writing localStorage
   exactly as before — this file intercepts those writes and pushes them
   to the cloud, and applies remote changes back into localStorage.

   Device-local keys (login session, selected branch) are never synced.
   Conflict strategy: last write wins.
   ========================================================================== */

(function(){
    if(
        !window.firebase ||
        !firebase.firestore ||
        !firebase.auth ||
        firebase.apps.length === 0
    ){
        console.warn(
            "CrownCloud: Firebase SDK not loaded — running in offline/local mode."
        );

        window.CrownCloud = {
            isAvailable: function(){ return false; },
            login: function(){ return Promise.resolve("unavailable"); },
            provision: function(){ return Promise.resolve(false); },
            waitForInitialSync: function(){ return Promise.resolve(false); },
            updateOwnPassword: function(){ return Promise.resolve(false); },
            resetOtherUserCloudLogin: function(){ return Promise.resolve(false); },
            flushNow: function(){ return Promise.resolve(); },
            signOut: function(){}
        };

        return;
    }

    const db = firebase.firestore();

    /* Firestore's default transport is a bidirectional streaming
       connection (WebChannel) — some mobile carriers and restrictive
       networks silently break that specific kind of connection while
       plain HTTPS (what Firebase Auth uses) works fine, so sign-in
       succeeds but every Firestore read/write on that device hangs or
       fails with no visible error. Auto-detecting falls back to
       long-polling only when needed, so it costs nothing on networks
       where streaming already works. Must be set before any other
       Firestore call. */
    db.settings({ experimentalAutoDetectLongPolling: true });

    /* Caches Firestore reads in IndexedDB across page loads. This app
       does a full page reload for every navigation (not an SPA), so
       without this, EVERY page — not just the first-ever login —
       redownloads the entire shared dataset from network before it can
       render anything, even on a device that already has it all from
       five minutes ago. See the cache-first fast path in
       onAuthStateChanged below, which is what actually benefits from
       this. synchronizeTabs lets multiple CrownOS tabs open in the same
       browser share one persisted cache instead of the second tab's
       persistence attempt failing outright because the first already
       claimed it. Best-effort: a browser without the needed IndexedDB
       support just falls back to a network fetch on every page, same
       as before this existed. Must be called before any other
       Firestore operation. */
    db.enablePersistence({ synchronizeTabs: true }).catch(function(error){
        console.warn(
            "CrownCloud: Firestore persistence unavailable — falling back to per-page network fetches.",
            error
        );
    });

    const COLLECTION = "appData";
    const CASHFLOW_COLLECTION = "appDataCashflow";
    const FLUSH_DELAY_MS = 600;

    /* Running this app off a local dev server (or straight from disk)
       must never write test data into the shared production database.
       Pulling stays on — read-only, so local testing still sees a
       realistic snapshot — but every outgoing path (queuePush, the
       first-run seed, and the exposed flushNow()) is blocked below. */
    /* Previously only matched localhost/127.0.0.1/file: — testing from a
       LAN IP (e.g. a phone/tablet hitting a dev machine at 192.168.x.x)
       or a .local mDNS hostname slipped through entirely, pushing
       whatever was typed there straight into the live production
       appData collection. Widened to cover private LAN ranges and
       .local hostnames, plus a manual localStorage escape hatch
       (crownCloudDisableSync) for any other non-production host this
       hardcoded list can't anticipate (a staging domain, for example) —
       set it from that browser's devtools console once, no code change
       needed. */
    const isLocalTestEnv = (
        ["localhost", "127.0.0.1"].includes(location.hostname) ||
        location.protocol === "file:" ||
        location.hostname.endsWith(".local") ||
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) ||
        localStorage.getItem("crownCloudDisableSync") === "true"
    );

    if(isLocalTestEnv){
        console.info(
            "CrownCloud: local test environment detected — cloud pulls " +
            "stay on, but nothing typed here will be pushed to the live " +
            "database."
        );
    }

    /* Firestore rejects a single string field over ~1,048,487 bytes. A
       key like crownClientMasterList can grow well past that as the
       client list grows, so a value is split across multiple documents
       (one per chunk) instead of relying on one document per key. Kept
       comfortably under the limit to leave room for field overhead. */
    const MAX_CHUNK_BYTES = 900000;
    const utf8Encoder = new TextEncoder();

    /* Splits by Unicode code point (not UTF-16 code unit) so a
       surrogate pair or multi-byte character is never cut in half. */
    function splitIntoChunks(value){
        if(value === ""){
            return [""];
        }

        const chunks = [];
        let current = "";
        let currentBytes = 0;

        for(const ch of value){
            const chBytes = utf8Encoder.encode(ch).length;

            if(current && currentBytes + chBytes > MAX_CHUNK_BYTES){
                chunks.push(current);
                current = "";
                currentBytes = 0;
            }

            current += ch;
            currentBytes += chBytes;
        }

        if(current){
            chunks.push(current);
        }

        return chunks;
    }

    /* Keys that stay on this device only. */
    const EXCLUDED_KEYS = [
        "crownCurrentUser",
        "crownLoggedIn",
        "crownSelectedBranch",
        "crownUsername",
        "crownPassword"
    ];

    let applyingRemote = false;
    let flushTimer = null;
    let listenerStarted = false;
    let initialSyncDone = false;

    const pendingKeys = new Set();

    let resolveInitialSync;
    const initialSyncPromise = new Promise(function(resolve){
        resolveInitialSync = resolve;
    });

    function shouldSync(key){
        return (
            typeof key === "string" &&
            key.startsWith("crown") &&
            !EXCLUDED_KEYS.includes(key)
        );
    }

    /* crownCashflow_* lives in its own Firestore collection (see the
       diagMigrateCashflow migration and firestore.rules) so the
       generic appData pull below — an unfiltered collection query run
       by every role on every login — never has an Admin/EA-only
       document in its potential result set. Firestore rejects an
       entire list query outright if it could return even one document
       the caller isn't allowed to read, so mixing that one restricted
       key into the same collection as everything else broke every
       non-Admin/EA account's very first pull, regardless of role claim
       timing. */
    function collectionForKey(key){
        return key.startsWith("crownCashflow_") ? CASHFLOW_COLLECTION : COLLECTION;
    }

    /* Chunk 0 keeps the plain encodeURIComponent(key) doc id used before
       chunking existed, so a key that never needs splitting (almost
       every key except crownClientMasterList) stays byte-for-byte
       compatible with any device still running the old single-doc
       code. Only chunk 1+ gets a suffixed id. */
    function chunkDocRef(key, index){
        const base = encodeURIComponent(key);
        return db
            .collection(collectionForKey(key))
            .doc(index === 0 ? base : base + "__c" + index);
    }

    /* Persistent, incrementally-updated view of every chunk doc seen so
       far (key -> Map(chunkIndex -> {value, deleted, chunkCount})). The
       realtime listener only reports docs that changed in a given
       snapshot — reconstructing straight from that event would miss
       chunks that arrived earlier, so this cache carries them forward. */
    const chunkCache = new Map();

    function ingestChunkDoc(data){
        if(!data || !shouldSync(data.key)){
            return;
        }

        const index =
            Number.isInteger(data.chunkIndex) ? data.chunkIndex : 0;

        const count =
            Number.isInteger(data.chunkCount) ? data.chunkCount : 1;

        if(!chunkCache.has(data.key)){
            chunkCache.set(data.key, new Map());
        }

        chunkCache.get(data.key).set(index, {
            value: data.value,
            deleted: Boolean(data.deleted),
            chunkCount: count
        });
    }

    function forgetChunkDoc(key, index){
        if(chunkCache.has(key)){
            chunkCache.get(key).delete(index);
        }
    }

    /* Returns { deleted } or { deleted: false, value } once every chunk
       for `key` has been seen, or null while still waiting on more. */
    function reconstructIfComplete(key){
        const chunkMap = chunkCache.get(key);

        if(!chunkMap){
            return null;
        }

        const chunk0 = chunkMap.get(0);

        if(!chunk0){
            return null;
        }

        if(chunk0.deleted){
            return { deleted: true };
        }

        for(let index = 0; index < chunk0.chunkCount; index++){
            if(!chunkMap.has(index)){
                return null;
            }
        }

        let value = "";

        for(let index = 0; index < chunk0.chunkCount; index++){
            value += chunkMap.get(index).value;
        }

        return { deleted: false, value: value };
    }

    /* ---------- Outgoing: localStorage → Firestore ---------- */

    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.setItem = function(key, value){
        nativeSetItem.call(this, key, value);

        if(
            this === window.localStorage &&
            !applyingRemote &&
            shouldSync(key)
        ){
            queuePush(key);
        }
    };

    Storage.prototype.removeItem = function(key){
        nativeRemoveItem.call(this, key);

        if(
            this === window.localStorage &&
            !applyingRemote &&
            shouldSync(key)
        ){
            queuePush(key);
        }
    };

    /* crownAttendanceLog opts out of this generic whole-array flush —
       see clock-widget.js's transactionalSyncAttendanceEntry(). That key
       is a single shared array across every staff member/branch/date,
       and clock-ins/outs cluster tightly in time (everyone clocking in
       around shift start), making the generic "read localStorage, blind-
       overwrite the whole doc" flush the highest-collision-risk path in
       the app — two people clocking in around the same moment could
       silently lose one entry. clock-widget.js instead pushes each
       attendance action individually via a Firestore transaction that
       reads the live doc fresh and merges in just that one entry. Still
       excluded from `shouldSync()`'s EXCLUDED_KEYS on purpose — this
       device still needs the normal INCOMING pull/listener so it sees
       other devices' attendance changes; only the generic OUTGOING path
       is skipped here. */
    function queuePush(key){
        if(isLocalTestEnv || key === "crownAttendanceLog"){
            return;
        }

        pendingKeys.add(key);

        clearTimeout(flushTimer);
        flushTimer = setTimeout(flushPending, FLUSH_DELAY_MS);
    }

    async function flushPending(){
        if(isLocalTestEnv){
            pendingKeys.clear();
            return;
        }

        if(pendingKeys.size === 0 || !firebase.auth().currentUser){
            return;
        }

        /* Never push anything until the first pull has finished — a
           fresh device must not overwrite cloud data with its own
           locally-seeded defaults. The keys stay queued; retry once the
           pull completes instead of dropping them (a write that lands
           here before initial sync finishes would otherwise never be
           pushed, and the next page's pull would silently wipe it). */
        if(!initialSyncDone){
            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushPending, 500);
            return;
        }

        const keys = Array.from(pendingKeys);
        pendingKeys.clear();

        try{
            const batch = db.batch();
            const now = Date.now();

            /* Sequential (not Promise.all) since this only runs once
               per debounced flush and keeps each key's read-then-write
               easy to reason about; pushes are infrequent enough that
               the extra round trips don't matter. */
            for(const key of keys){
                const value = localStorage.getItem(key);

                const existingSnapshot =
                    await db.collection(collectionForKey(key))
                        .where("key", "==", key)
                        .get();

                const existingByIndex = new Map();

                existingSnapshot.forEach(function(doc){
                    const data = doc.data() || {};

                    const index =
                        Number.isInteger(data.chunkIndex)
                            ? data.chunkIndex
                            : 0;

                    existingByIndex.set(index, doc.ref);
                });

                if(value === null){
                    /* Soft delete: write a tombstone instead of removing
                       the doc, so the key stays "known to the cloud".
                       Otherwise a device that hasn't caught up yet still
                       has the old value locally, sees the key missing
                       remotely, and the seed step below wrongly
                       re-uploads it as if it were new data. */
                    batch.set(chunkDocRef(key, 0), {
                        key: key,
                        chunkIndex: 0,
                        chunkCount: 1,
                        value: null,
                        deleted: true,
                        updatedAt: now
                    });

                    existingByIndex.forEach(function(ref, index){
                        if(index !== 0){
                            batch.delete(ref);
                        }
                    });

                    continue;
                }

                const chunks = splitIntoChunks(value);

                chunks.forEach(function(chunk, index){
                    batch.set(chunkDocRef(key, index), {
                        key: key,
                        chunkIndex: index,
                        chunkCount: chunks.length,
                        value: chunk,
                        deleted: false,
                        updatedAt: now
                    });
                });

                /* The value shrank and/or needs fewer chunks than
                   before — drop the now-unused higher-index docs so a
                   future read doesn't wait forever on a chunk that will
                   never be rewritten. */
                existingByIndex.forEach(function(ref, index){
                    if(index >= chunks.length){
                        batch.delete(ref);
                    }
                });
            }

            await batch.commit();

            reportPushDiagnostic(keys, null);
        }catch(error){
            console.error("CrownCloud: push failed, will retry.", error);

            reportPushDiagnostic(keys, error);

            keys.forEach(function(key){
                pendingKeys.add(key);
            });

            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushPending, 5000);
        }
    }

    /* TEMPORARY — incident diagnostics only. Remove once resolved. */
    async function reportPushDiagnostic(keys, error){
        try{
            const authUser = firebase.auth().currentUser;

            if(!authUser){
                return;
            }

            await db.collection("syncDiagnostics").add({
                email: authUser.email || "",
                page: location.pathname.split("/").pop() || "",
                pushKeys: keys,
                errorMessage: error ? String(error.message || error) : null,
                errorCode: error?.code || null,
                userAgent: navigator.userAgent,
                online: navigator.onLine,
                createdAt: Date.now()
            });
        }catch(reportError){
            console.error("CrownCloud: push syncDiagnostics write failed.", reportError);
        }
    }

    document.addEventListener("visibilitychange", function(){
        if(document.visibilityState === "hidden"){
            flushPending();
        }
    });

    window.addEventListener("pagehide", function(){
        flushPending();
    });

    window.addEventListener("beforeunload", function(){
        flushPending();
    });

    /* This app navigates between pages with full reloads (plain <a href>
       links, no SPA router), and writes are debounced by FLUSH_DELAY_MS
       before they reach Firestore. Clicking to another page within that
       window tears down the JS context and silently drops the pending
       write — the change looks saved locally but never reaches the
       cloud, then gets overwritten by the next login's pull. Intercept
       same-page-app link clicks and flush first, then navigate. */
    document.addEventListener("click", function(event){
        if(pendingKeys.size === 0){
            return;
        }

        const link = event.target.closest("a[href]");

        if(!link || link.target === "_blank"){
            return;
        }

        const href = link.getAttribute("href");

        if(
            !href ||
            href.startsWith("#") ||
            href.startsWith("http://") ||
            href.startsWith("https://") ||
            href.startsWith("mailto:") ||
            href.startsWith("tel:") ||
            href.startsWith("javascript:")
        ){
            return;
        }

        event.preventDefault();

        clearTimeout(flushTimer);

        flushPending().finally(function(){
            location.href = href;
        });
    }, true);

    /* ---------- Incoming: Firestore → localStorage ---------- */

    /* Applies one collection snapshot (cached or from the server) to
       localStorage. Shared by the cache-first fast path and the
       authoritative network fetch below — same reconstruction/skip
       logic either way, just a different source for the snapshot. */
    function applySnapshotToLocalStorage(snapshot){
        const remoteKeys = new Set();
        const changedKeys = [];

        applyingRemote = true;

        snapshot.forEach(function(doc){
            const data = doc.data();

            if(!data || !shouldSync(data.key)){
                return;
            }

            /* A tombstone still counts as "known to the cloud" so
               the seed step below never mistakes a deleted key for
               brand-new local-only data. */
            remoteKeys.add(data.key);
            ingestChunkDoc(data);
        });

        remoteKeys.forEach(function(key){
            /* If the user makes a local change (e.g. an import) while a
               fetch is in flight, queuePush() already queued it in
               pendingKeys — but this snapshot still reflects the OLD
               cloud value from before that change. Applying it now
               would silently clobber the newer local write before its
               own queued push ever runs. Skip it here; the queued push
               (retried until initialSyncDone, see flushPending) will
               bring the cloud up to date instead. */
            if(pendingKeys.has(key)){
                return;
            }

            const result = reconstructIfComplete(key);

            if(!result){
                return;
            }

            if(result.deleted){
                if(localStorage.getItem(key) !== null){
                    nativeRemoveItem.call(localStorage, key);
                    changedKeys.push(key);
                }

                return;
            }

            if(localStorage.getItem(key) !== result.value){
                nativeSetItem.call(
                    localStorage,
                    key,
                    result.value
                );

                changedKeys.push(key);
            }
        });

        applyingRemote = false;

        /* Pages that finished their first render before this resolved
           are otherwise stuck showing whatever was in localStorage at
           DOMContentLoaded. The realtime listener only covers changes
           that arrive AFTER it starts, so without this, any data that
           already existed in the cloud before the page opened never
           appears until something else forces a re-read. */
        if(changedKeys.length > 0){
            window.dispatchEvent(
                new CustomEvent("crownCloudUpdate", {
                    detail: { keys: changedKeys }
                })
            );
        }

        return remoteKeys;
    }

    firebase.auth().onAuthStateChanged(async function(user){
        if(!user){
            return;
        }

        try{
            /* Discard anything queued before authentication — those
               writes (e.g. an auto-created default admin on a fresh
               device) must never reach the cloud. */
            pendingKeys.clear();

            /* Must happen before ANY Firestore read below, not just
               before login.js's own wait — this onAuthStateChanged
               listener fires independently the instant sign-in
               completes, racing login.js's own post-login code rather
               than waiting for it. firestore.rules' appData rule
               evaluates request.auth.token.role for crownCashflow_*
               documents, and the collection query below returns
               documents of every key, cashflow included — Firestore
               rejects the ENTIRE list query as permission-denied if
               that evaluation throws on even one matched document,
               which it does whenever this session's ID token doesn't
               carry a role claim yet. Every account's very first pull
               of a fresh session was hitting exactly that wall,
               regardless of what order login.js awaited things in,
               because nothing here was actually waiting for it.
               syncRole() reads the role server-side via the Admin SDK
               (functions/index.js syncMyRole), so it has no dependency
               on any of the data this handler is about to fetch. */
            await syncRole();

            /* Fast path: this app does a full page reload for every
               navigation (not an SPA), so without this, EVERY page —
               not just the first-ever login — blocks on a fresh
               multi-megabyte network fetch of the whole shared dataset
               before it can render anything, even on a device that
               already has all of it cached from five minutes ago.
               enablePersistence() (see below) keeps that cache in
               IndexedDB across page loads; reading from it here is
               near-instant when it exists, so a returning device stops
               waiting on the network at all just to reconfirm what it
               already knows. Silently does nothing on a device with no
               cache yet (first-ever visit, or persistence unavailable)
               — the network fetch further down covers that case
               exactly as before. */
            try{
                const cacheSnapshot =
                    await db.collection(COLLECTION).get({ source: "cache" });

                if(!cacheSnapshot.empty){
                    applySnapshotToLocalStorage(cacheSnapshot);
                    resolveInitialSync(true);
                }
            }catch(cacheError){
                // No local cache yet — the network fetch below is the real path.
            }

            const snapshot =
                await db.collection(COLLECTION).get();

            const remoteKeys =
                applySnapshotToLocalStorage(snapshot);

            /* Separate collection, separate query — see collectionForKey().
               Best-effort: a non-Admin/EA session gets permission-denied
               here every time by design (firestore.rules), same as it
               already can't open cashflow.html itself. That's expected,
               not a failure — this is the ONE query in the whole sync
               engine allowed to fail like that, since it's the only one
               a rule can legitimately reject per-role. */
            try{
                const cashflowSnapshot =
                    await db.collection(CASHFLOW_COLLECTION).get();

                applySnapshotToLocalStorage(cashflowSnapshot)
                    .forEach(function(key){
                        remoteKeys.add(key);
                    });
            }catch(cashflowError){
                // Not Admin/EA — expected, nothing to seed/reconcile here.
            }

            /* Seed: push keys that exist only on this device
               (first run migrates all existing data to the cloud).
               Skipped in a local test environment — same reasoning as
               queuePush() above, this must never upload local-only test
               data to the live database.

               crownCashflow_* is deliberately excluded here regardless
               of role: a non-Admin/EA session's cashflow query above
               always fails permission-denied (by design) and so never
               adds cashflow keys to remoteKeys, even for cashflow data
               that already exists in Firestore just fine — every
               device that still has a crownCashflow_* key in
               localStorage from before that collection was split out
               of appData (i.e. everyone who used the app before this
               fix) would otherwise have it "discovered" as local-only
               data here on every single pull, forever, and try to push
               it. That push always fails the same permission check,
               and because Firestore batch writes are all-or-nothing,
               it took down every OTHER pending key bundled in the same
               batch with it — which is why non-Admin/EA staff have had
               real, legitimate saves (Petty Cash, Daily Income, etc.)
               silently never reach the cloud: they were stuck in the
               same failing batch as a cashflow key that can never
               succeed for their role, retried every 5s, forever. */
            if(!isLocalTestEnv){
                for(let index = 0; index < localStorage.length; index++){
                    const key = localStorage.key(index);

                    if(
                        shouldSync(key) &&
                        !remoteKeys.has(key) &&
                        !key.startsWith("crownCashflow_")
                    ){
                        pendingKeys.add(key);
                    }
                }
            }

            initialSyncDone = true;

            if(pendingKeys.size > 0){
                flushPending();
            }

            startListener();
            resolveInitialSync(true);

            reportSyncDiagnostic(null);
        }catch(error){
            applyingRemote = false;
            console.error("CrownCloud: initial sync failed.", error);
            resolveInitialSync(false);

            reportSyncDiagnostic(error);
        }
    });

    /* TEMPORARY — incident diagnostics only. Writes a breadcrumb after
       every completed (or failed) initial sync, so a failure can be
       read back (which account, what Firestore error) without needing
       console access on whatever device hit it. Remove once resolved
       (see the matching write-only syncDiagnostics rule in
       firestore.rules). */
    async function reportSyncDiagnostic(error){
        try{
            const authUser = firebase.auth().currentUser;

            if(!authUser){
                return;
            }

            await db.collection("syncDiagnostics").add({
                email: authUser.email || "",
                page: location.pathname.split("/").pop() || "",
                errorMessage: error ? String(error.message || error) : null,
                errorCode: error?.code || null,
                userAgent: navigator.userAgent,
                online: navigator.onLine,
                createdAt: Date.now()
            });
        }catch(reportError){
            console.error("CrownCloud: syncDiagnostics write failed.", reportError);
        }
    }

    /* Shared by both collection listeners below — the actual
       reconstruction/apply logic doesn't care which collection a change
       came from, only the `key` field on each doc. */
    function handleListenerSnapshot(snapshot){
        const changedKeys = [];
        const touchedKeys = new Set();

        applyingRemote = true;

        snapshot.docChanges().forEach(function(change){
            if(change.doc.metadata.hasPendingWrites){
                return;
            }

            const data = change.doc.data();
            const key = data ? data.key : null;

            if(!shouldSync(key)){
                return;
            }

            touchedKeys.add(key);

            /* "removed" only fires for a hard Firestore delete
               (kept for any leftover docs from before tombstones);
               deletes going forward are soft tombstones instead. */
            if(change.type === "removed"){
                const index =
                    Number.isInteger(data?.chunkIndex)
                        ? data.chunkIndex
                        : 0;

                forgetChunkDoc(key, index);

                return;
            }

            ingestChunkDoc(data);
        });

        touchedKeys.forEach(function(key){
            /* Same reasoning as the initial-sync pull: don't clobber
               a local write this tab already queued but hasn't
               pushed yet. */
            if(pendingKeys.has(key)){
                return;
            }

            const result = reconstructIfComplete(key);

            if(!result){
                return;
            }

            if(result.deleted){
                if(localStorage.getItem(key) !== null){
                    nativeRemoveItem.call(localStorage, key);
                    changedKeys.push(key);
                }

                return;
            }

            if(localStorage.getItem(key) !== result.value){
                nativeSetItem.call(localStorage, key, result.value);
                changedKeys.push(key);
            }
        });

        applyingRemote = false;

        if(changedKeys.length > 0){
            window.dispatchEvent(
                new CustomEvent("crownCloudUpdate", {
                    detail: { keys: changedKeys }
                })
            );
        }
    }

    function startListener(){
        if(listenerStarted){
            return;
        }

        listenerStarted = true;

        db.collection(COLLECTION).onSnapshot(handleListenerSnapshot);

        /* Best-effort — a non-Admin/EA session gets permission-denied
           here every time by design (firestore.rules), same as the
           equivalent one-time get() above. A listener reports that
           through the error callback instead of a rejected promise, so
           it needs its own no-op handler rather than a try/catch. */
        db.collection(CASHFLOW_COLLECTION).onSnapshot(
            handleListenerSnapshot,
            function(){ /* not Admin/EA — expected */ }
        );
    }

    /* ---------- Authentication helpers ---------- */

    /* CrownOS usernames map to synthetic sync emails; staff never see
       or use these directly — they keep logging in with their username. */
    function toSyncEmail(username){
        const slug =
            String(username || "")
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9._-]/g, "-");

        return "u-" + slug + "@crownos-sync.com";
    }

    /* Suffix guarantees Firebase's 6-character password minimum
       without changing what staff actually type. */
    function toSyncPassword(password){
        return String(password || "") + "::CrownOS#sync";
    }

    async function cloudLogin(username, password){
        try{
            await firebase.auth().signInWithEmailAndPassword(
                toSyncEmail(username),
                toSyncPassword(password)
            );

            return "cloud";
        }catch(error){
            const code = error?.code || "";

            if([
                "auth/user-not-found",
                "auth/wrong-password",
                "auth/invalid-credential",
                "auth/invalid-login-credentials"
            ].includes(code)){
                return "no-account";
            }

            console.error("CrownCloud: sign-in failed.", error);
            return "unavailable";
        }
    }

    async function provision(username, password){
        try{
            await firebase.auth().createUserWithEmailAndPassword(
                toSyncEmail(username),
                toSyncPassword(password)
            );

            return true;
        }catch(error){
            if(error?.code !== "auth/email-already-in-use"){
                console.error("CrownCloud: provisioning failed.", error);
            }

            return false;
        }
    }

    /* Keeps the Firebase-side password in step with a self-service local
       password change. Without this, the local login stays correct (it
       reads crownUserAccounts) but the synthetic Firebase user silently
       keeps the OLD password forever — every future login then fails
       Firebase sign-in (wrong-password) while local auth still succeeds,
       so the account quietly stops syncing with no error anywhere. Only
       covers a user changing THEIR OWN password (the client SDK can only
       update the currently-signed-in user); an Admin changing someone
       ELSE's password can't be fixed from the client at all — that still
       needs a manual re-provision (delete the stale Firebase user so
       their next login self-heals via provision()) or a future Cloud
       Function with Admin SDK access. */
    async function updateOwnPassword(newPassword, oldPassword){
        const cloudUser =
            firebase.auth().currentUser;

        if(!cloudUser){
            return false;
        }

        try{
            await cloudUser.updatePassword(
                toSyncPassword(newPassword)
            );

            return true;
        }catch(error){
            /* Firebase requires a "fresh" sign-in for sensitive operations
               like a password change — a session established a while ago
               (e.g. during login's initial provisioning, possibly hours
               earlier) commonly trips this, and updatePassword() alone
               then always fails with auth/requires-recent-login. Retry
               once after re-proving identity with the password the user
               just typed as their "current password" in this same form. */
            if(
                error?.code === "auth/requires-recent-login" &&
                oldPassword
            ){
                try{
                    const credential =
                        firebase.auth.EmailAuthProvider.credential(
                            cloudUser.email,
                            toSyncPassword(oldPassword)
                        );

                    await cloudUser.reauthenticateWithCredential(
                        credential
                    );

                    await cloudUser.updatePassword(
                        toSyncPassword(newPassword)
                    );

                    return true;
                }catch(retryError){
                    console.error(
                        "CrownCloud: password sync retry failed.",
                        retryError
                    );

                    return false;
                }
            }

            console.error(
                "CrownCloud: password sync failed.",
                error
            );

            return false;
        }
    }

    /* Admin-side counterpart to updateOwnPassword() — routes through the
       resetStaffCloudLogin Cloud Function so an Admin resetting someone
       ELSE's password keeps their Firebase Auth login in step too,
       instead of leaving that account's cloud sync silently broken (see
       the account-settings.js saveUserAccount() comment on this bug).
       Requires firebase-functions-compat.js to be loaded on the page. */
    async function resetOtherUserCloudLogin(username, newPassword){
        if(!window.firebase || !firebase.functions){
            console.error(
                "CrownCloud: firebase-functions-compat.js not loaded — cannot reset another user's cloud login."
            );

            return false;
        }

        try{
            await firebase.functions().httpsCallable("resetStaffCloudLogin")({
                username: username,
                newPassword: newPassword
            });

            return true;
        }catch(error){
            console.error("CrownCloud: resetStaffCloudLogin failed.", error);

            return false;
        }
    }

    /* Calls the syncMyRole Cloud Function so this session's Firebase Auth
       user carries a fresh `role` custom claim (see functions/index.js),
       then forces an ID token refresh so firestore.rules sees it on this
       session's very next request — without the forced refresh the SDK
       would keep using the token it already cached (with no/stale role
       claim) until it naturally expires. Called once per login (see
       login.js) rather than on every page load, since the claim only
       needs to be current as of sign-in. Requires
       firebase-functions-compat.js to be loaded on the page. */
    async function syncRole(){
        if(!window.firebase || !firebase.functions || !firebase.auth().currentUser){
            return false;
        }

        try{
            await firebase.functions().httpsCallable("syncMyRole")();
            await firebase.auth().currentUser.getIdToken(true);
            return true;
        }catch(error){
            console.error("CrownCloud: syncMyRole failed.", error);
            return false;
        }
    }

    function waitForInitialSync(timeoutMs){
        const timeout = new Promise(function(resolve){
            setTimeout(function(){
                resolve(false);
            }, timeoutMs || 10000);
        });

        return Promise.race([initialSyncPromise, timeout]);
    }

    window.CrownCloud = {
        isAvailable: function(){ return true; },
        isLocalTestEnv: isLocalTestEnv,
        login: cloudLogin,
        provision: provision,
        syncRole: syncRole,
        waitForInitialSync: waitForInitialSync,
        updateOwnPassword: updateOwnPassword,
        resetOtherUserCloudLogin: resetOtherUserCloudLogin,
        flushNow: function(){
            if(isLocalTestEnv){
                return Promise.resolve();
            }

            clearTimeout(flushTimer);
            return flushPending();
        },
        signOut: function(){
            try{
                firebase.auth().signOut();
            }catch(error){
                /* ignore */
            }
        }
    };
})();
