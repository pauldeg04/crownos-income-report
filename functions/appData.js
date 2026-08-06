/* ==========================================================================
   Crown Head Spa — appData blob reader (Cloud Functions side)

   CrownOS mirrors localStorage keys (branch/service master lists, daily
   schedules) into the Firestore "appData" collection via firebase-sync.js,
   one doc per key, split into chunks past ~900KB. Doc ids are
   encodeURIComponent(key) for chunk 0 and `${encodeURIComponent(key)}__c${n}`
   for further chunks — see Income Report/firebase-sync.js chunkDocRef().
   This module only reads that collection; nothing here ever writes to it,
   since appData is a last-write-wins mirror owned by the CrownOS client.
   ========================================================================== */

const COLLECTION = "appData";

/* Reads and JSON-parses a single localStorage-mirrored key. Returns null if
   the key was never synced or was tombstoned (deleted: true on chunk 0). */
async function readAppDataKey(db, key){
    const base = encodeURIComponent(key);

    const chunk0Snap = await db.collection(COLLECTION).doc(base).get();

    if(!chunk0Snap.exists){
        return null;
    }

    const chunk0 = chunk0Snap.data() || {};

    if(chunk0.deleted){
        return null;
    }

    const chunkCount =
        Number.isInteger(chunk0.chunkCount) ? chunk0.chunkCount : 1;

    let value = chunk0.value || "";

    if(chunkCount > 1){
        const refs = [];

        for(let index = 1; index < chunkCount; index++){
            refs.push(db.collection(COLLECTION).doc(base + "__c" + index));
        }

        const snaps = await db.getAll(...refs);

        for(const snap of snaps){
            if(!snap.exists){
                throw new Error(
                    "appData: missing chunk for key \"" + key + "\" (incomplete sync)"
                );
            }

            value += (snap.data() || {}).value || "";
        }
    }

    try{
        return JSON.parse(value);
    }catch(error){
        throw new Error("appData: could not parse key \"" + key + "\": " + error.message);
    }
}

module.exports = { readAppDataKey };
