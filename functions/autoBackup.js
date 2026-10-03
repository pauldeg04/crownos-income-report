/* ==========================================================================
   Crown Head Spa — nightly automatic backup, emailed.

   Reads the cloud copy of CrownOS (the appData / appDataCashflow mirrors
   that firebase-sync.js maintains, one or more chunk docs per localStorage
   key) and rebuilds the same JSON the Data Protection page's "Export Full
   Backup" produces, so the file can be restored with that page's Restore.
   birCompliance and activityLog are not synced keys, so they are added as a
   separate section (cloudCollections). The Activity Log is also attached as
   a CSV so it can be opened in Excel / Google Sheets.
   ========================================================================== */

const zlib = require("zlib");

const SYNC_COLLECTIONS = ["appData", "appDataCashflow"];
const EXTRA_COLLECTIONS = ["birCompliance", "activityLog"];
const STATUS_DOC = ["systemStatus", "autoBackup"];

async function collectSyncedKeys(db){
    const byKey = new Map();

    for(const name of SYNC_COLLECTIONS){
        const snap = await db.collection(name).get();

        snap.forEach(function(doc){
            const data = doc.data() || {};

            if(typeof data.key !== "string") return;

            const index = Number.isInteger(data.chunkIndex) ? data.chunkIndex : 0;

            if(!byKey.has(data.key)) byKey.set(data.key, new Map());

            byKey.get(data.key).set(index, data);
        });
    }

    const out = {};

    for(const [key, chunks] of byKey){
        const first = chunks.get(0);

        if(!first || first.deleted) continue;

        const count = Number.isInteger(first.chunkCount) ? first.chunkCount : 1;
        let value = "";

        for(let i = 0; i < count; i++){
            const chunk = chunks.get(i);

            if(!chunk){
                throw new Error('Incomplete chunks for key "' + key + '"');
            }

            value += chunk.value || "";
        }

        out[key] = value;
    }

    return out;
}

async function collectExtra(db){
    const out = {};

    for(const name of EXTRA_COLLECTIONS){
        const snap = await db.collection(name).get();
        out[name] = {};
        snap.forEach(function(doc){ out[name][doc.id] = doc.data(); });
    }

    return out;
}

const CSV_COLUMNS = [
    "ts", "day", "clientTime", "name", "account", "role", "branch", "page",
    "module", "action", "summary", "details", "ref", "email", "uid"
];

function csvCell(value){
    if(value && typeof value.toDate === "function") value = value.toDate().toISOString();
    if(Array.isArray(value)) value = value.join(" | ");
    if(value === undefined || value === null) value = "";
    return '"' + String(value).replace(/"/g, '""') + '"';
}

/* Newest first; BOM so Excel reads the Filipino/UTF-8 text correctly. */
function activityLogToCsv(entries){
    const rows = Object.values(entries || {}).sort(function(a, b){
        const ta = a.ts && a.ts.toMillis ? a.ts.toMillis() : 0;
        const tb = b.ts && b.ts.toMillis ? b.ts.toMillis() : 0;
        return tb - ta;
    });

    const lines = [CSV_COLUMNS.join(",")].concat(rows.map(function(row){
        return CSV_COLUMNS.map(function(col){ return csvCell(row[col]); }).join(",");
    }));

    return "\ufeff" + lines.join("\r\n") + "\r\n";
}

function manilaStamp(date){
    const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
    return shifted.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

async function runAutoBackup({ db, admin, buildMailer, from, to }){
    const now = new Date();
    const statusRef = db.collection(STATUS_DOC[0]).doc(STATUS_DOC[1]);

    try{
        const data = await collectSyncedKeys(db);
        const keyCount = Object.keys(data).length;

        if(keyCount === 0){
            throw new Error("No CrownOS data found in the cloud — nothing to back up.");
        }

        const payload = {
            crownBackup: true,
            application: "CrownOS",
            formatVersion: "1.0",
            createdAt: now.toISOString(),
            createdBy: "Automatic nightly backup (cloud)",
            reason: "auto",
            keyCount,
            data,
            cloudCollections: await collectExtra(db)
        };

        const logCount = Object.keys(payload.cloudCollections.activityLog || {}).length;

        const json = JSON.stringify(payload);
        const gz = zlib.gzipSync(Buffer.from(json, "utf8"));
        const stamp = manilaStamp(now);
        const fileName = "CrownOS_Full_Backup_" + stamp + ".json.gz";

        await buildMailer().sendMail({
            from: '"CrownOS Backup" <' + from + ">",
            to,
            subject: "CrownOS Daily Backup — " + manilaStamp(now).slice(0, 10),
            text:
                "Automatic CrownOS backup.\n\n" +
                "Data keys: " + keyCount + "\n" +
                "Activity Log entries: " + logCount + " (also attached as CSV)\n" +
                "Size: " + Math.round(json.length / 1024) + " KB (" +
                Math.round(gz.length / 1024) + " KB compressed)\n\n" +
                "To restore: unzip the attachment (double-click it) to get the .json file, " +
                "then use Data Protection > Restore in CrownOS.\n" +
                "Keep this email private — it contains client and financial data.",
            attachments: [
                { filename: fileName, content: gz, contentType: "application/gzip" },
                {
                    filename: "CrownOS_Activity_Log_" + stamp + ".csv",
                    content: activityLogToCsv(payload.cloudCollections.activityLog),
                    contentType: "text/csv; charset=utf-8"
                }
            ]
        });

        await statusRef.set({
            ok: true,
            at: admin.firestore.Timestamp.fromDate(now),
            file: fileName,
            to,
            keyCount,
            bytes: json.length
        });
    }catch(error){
        console.error("Auto backup failed", error);

        await statusRef.set({
            ok: false,
            at: admin.firestore.Timestamp.fromDate(now),
            error: String(error && error.message || error).slice(0, 500),
            to
        }).catch(function(){});

        try{
            await buildMailer().sendMail({
                from: '"CrownOS Backup" <' + from + ">",
                to,
                subject: "⚠ CrownOS Daily Backup FAILED",
                text: "Tonight's automatic backup did not complete.\n\n" +
                    String(error && error.message || error)
            });
        }catch(mailError){
            console.error("Failure email also failed", mailError);
        }
    }
}

module.exports = { runAutoBackup };
