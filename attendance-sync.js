/* ==========================================================================
   Crown Head Spa — Shared Attendance Cloud-Sync Helper

   crownAttendanceLog is a single array shared across every staff
   member/branch/date, and writes to it cluster tightly in time
   (everyone clocking in around shift start), making the generic
   whole-array debounced flush every other localStorage key goes
   through (see firebase-sync.js) the highest-collision-risk write in
   the app — two people clocking in around the same moment could
   silently lose one entry. firebase-sync.js's queuePush() explicitly
   skips this one key so it can't race the functions here.

   Used by clock-widget.js (staff clock-in/out) AND attendance.js
   (Admin manual add/edit/delete) — both write to the same key, so both
   need to go through the same per-entry transactional path rather than
   one of them silently falling back to the (now-disabled-for-this-key)
   generic flush.
   ========================================================================== */

(function(){
    const ATTENDANCE_LOG_KEY = "crownAttendanceLog";

    function getAttendanceLog(){
        try{
            const raw =
                localStorage.getItem(ATTENDANCE_LOG_KEY);

            const parsed =
                raw ? JSON.parse(raw) : [];

            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            console.error("CrownAttendanceSync: unable to load attendance log:", error);
            return [];
        }
    }

    function saveAttendanceLog(entries){
        localStorage.setItem(
            ATTENDANCE_LOG_KEY,
            JSON.stringify(entries)
        );
    }

    function getAttendanceRef(){
        return firebase.firestore()
            .collection("appData")
            .doc(encodeURIComponent(ATTENDANCE_LOG_KEY));
    }

    function readCurrentRows(data){
        if(data && Number.isInteger(data.chunkCount) && data.chunkCount > 1){
            return null;
        }

        if(!data || data.deleted || !data.value){
            return [];
        }

        try{
            const parsed = JSON.parse(data.value);
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    /* Reads the live crownAttendanceLog doc fresh inside a transaction
       and merges `entry` into it (replacing any existing entry with the
       same id, or appending if new), instead of overwriting the whole
       array based on whatever this device last happened to have
       locally. Safe to retry after being offline for hours: whatever
       every other device added in the meantime is still there when
       this finally lands.

       Deliberately only handles the (overwhelmingly common) single-
       chunk case, same as scheduling.js's transactionalUpdateSchedules()
       / inventory-warehouse.js's transactionalStockTransfer() — falls
       back to "unsupported" if crownAttendanceLog somehow chunked past
       ~900KB. */
    async function transactionalUpsert(entry){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return { status: "offline" };
        }

        const ref = getAttendanceRef();

        try{
            return await firebase.firestore().runTransaction(async function(transaction){
                const snap = await transaction.get(ref);
                const current = readCurrentRows(snap.exists ? snap.data() : null);

                if(current === null){
                    return { status: "unsupported" };
                }

                /* Never write the pendingCloudSync flag itself to the
                   cloud — it's purely a local "still needs to retry"
                   marker. */
                const synced = Object.assign({}, entry);
                delete synced.pendingCloudSync;

                const index =
                    current.findIndex(function(item){
                        return item.id === entry.id;
                    });

                if(index === -1){
                    current.push(synced);
                }else{
                    current[index] = synced;
                }

                transaction.set(ref, {
                    key: ATTENDANCE_LOG_KEY,
                    chunkIndex: 0,
                    chunkCount: 1,
                    value: JSON.stringify(current),
                    deleted: false,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                return { status: "ok" };
            });
        }catch(error){
            console.error("CrownAttendanceSync: transactionalUpsert failed:", error);
            return { status: "error" };
        }
    }

    /* Same idea as transactionalUpsert(), but for Admin deleting an
       entry from attendance.js — reads fresh, removes just this id,
       writes back atomically. */
    async function transactionalDelete(entryId){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return { status: "offline" };
        }

        const ref = getAttendanceRef();

        try{
            return await firebase.firestore().runTransaction(async function(transaction){
                const snap = await transaction.get(ref);
                const current = readCurrentRows(snap.exists ? snap.data() : null);

                if(current === null){
                    return { status: "unsupported" };
                }

                const next =
                    current.filter(function(item){
                        return item.id !== entryId;
                    });

                transaction.set(ref, {
                    key: ATTENDANCE_LOG_KEY,
                    chunkIndex: 0,
                    chunkCount: 1,
                    value: JSON.stringify(next),
                    deleted: false,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                return { status: "ok" };
            });
        }catch(error){
            console.error("CrownAttendanceSync: transactionalDelete failed:", error);
            return { status: "error" };
        }
    }

    /* Syncs one entry (by id, re-read fresh from localStorage — the
       caller may have saved it moments earlier) and, unlike the generic
       sync queue, records success/failure DURABLY on the entry itself
       (pendingCloudSync), not in an in-memory Set that firebase-sync.js
       wipes on every page load/reload. A clock-in made while fully
       offline is already correct in localStorage the instant it's
       saved — this just couldn't confirm it reached the cloud yet, so
       pendingCloudSync stays true and retryPending() (call this on load
       and on the browser's 'online' event) picks it back up later, even
       if the app was fully closed in between. */
    async function syncEntry(entryId){
        const entry =
            getAttendanceLog().find(function(item){
                return item.id === entryId;
            });

        if(!entry){
            return;
        }

        const outcome = await transactionalUpsert(entry);

        /* Re-read rather than reuse the array above — a retry running
           concurrently with a fresh edit to the same entry (unlikely,
           but possible if the 'online' handler fires mid-action) could
           have changed it in the meantime. */
        const freshEntries = getAttendanceLog();

        const target =
            freshEntries.find(function(item){
                return item.id === entryId;
            });

        if(!target){
            return;
        }

        if(outcome.status === "ok"){
            if(target.pendingCloudSync){
                delete target.pendingCloudSync;
                saveAttendanceLog(freshEntries);
            }
        }else{
            target.pendingCloudSync = true;
            saveAttendanceLog(freshEntries);
        }
    }

    /* deleteAttendanceEntry() in attendance.js has already removed the
       entry from localStorage by the time this runs — there's nothing
       left to flag pendingCloudSync on, so a failed delete sync is only
       logged, not retried. A missed delete just leaves a stale entry in
       the cloud copy rather than losing real attendance data, which is
       the safer failure direction for this one action. */
    async function syncDelete(entryId){
        const outcome = await transactionalDelete(entryId);

        if(outcome.status !== "ok"){
            console.error("CrownAttendanceSync: delete of " + entryId + " did not reach the cloud (status: " + outcome.status + ").");
        }
    }

    /* Run on page load and whenever the browser regains connectivity —
       picks up any attendance entries still flagged pendingCloudSync
       (from an action that couldn't reach Firestore at the time) and
       retries them. userId is optional — clock-widget.js scopes this to
       the signed-in staff member's own entries; attendance.js (Admin,
       editing anyone) omits it to retry everyone's. */
    async function retryPending(userId){
        const pending =
            getAttendanceLog().filter(function(entry){
                return (
                    entry.pendingCloudSync &&
                    (!userId || entry.userId === userId)
                );
            });

        for(const entry of pending){
            await syncEntry(entry.id);
        }
    }

    window.CrownAttendanceSync = {
        syncEntry: syncEntry,
        syncDelete: syncDelete,
        retryPending: retryPending
    };
})();
