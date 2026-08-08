const CROWN_PREFIX = "crown";
const BACKUP_META_KEY = "crownBackupMetadata";
const BACKUP_HISTORY_KEY = "crownBackupHistory";
const BACKUP_VERSION = "1.0";

let selectedBackup = null;
let selectedBackupName = "";

document.addEventListener("DOMContentLoaded", function(){
    enforceAdminAccess();
    attachEvents();
    refreshSystemHealth();
    renderBackupHistory();
});

function enforceAdminAccess(){
    const user =
        window.CrownAuth?.refreshCurrentUser?.();

    if(!user){
        location.href = "login.html";
        return;
    }

    if(user.role !== "Admin"){
        alert("Only an Admin account can access Data Protection.");
        location.href = "home.html";
    }
}

function attachEvents(){
    document
        .getElementById("exportBackupBtn")
        .addEventListener("click", function(){
            exportFullBackup("manual");
        });

    document
        .getElementById("restoreFileInput")
        .addEventListener("change", readRestoreFile);

    document
        .getElementById("restoreBackupBtn")
        .addEventListener("click", openRestoreModal);

    document
        .getElementById("closeRestoreModalBtn")
        .addEventListener("click", closeRestoreModal);

    document
        .getElementById("cancelRestoreBtn")
        .addEventListener("click", closeRestoreModal);

    document
        .getElementById("restoreConfirmation")
        .addEventListener("change", updateRestoreConfirmState);

    document
        .getElementById("restoreTypedConfirmation")
        .addEventListener("input", updateRestoreConfirmState);

    document
        .getElementById("confirmRestoreBtn")
        .addEventListener("click", performRestore);

    document
        .getElementById("clearHistoryBtn")
        .addEventListener("click", clearHistory);

    document
        .querySelectorAll("[data-export]")
        .forEach(function(button){
            button.addEventListener("click", function(){
                emergencyExport(this.dataset.export);
            });
        });
}

function currentUser(){
    return (
        window.CrownAuth?.getCurrentUser?.()?.account ||
        "Unknown User"
    );
}

function isCrownKey(key){
    return (
        typeof key === "string" &&
        key.startsWith(CROWN_PREFIX) &&
        key !== BACKUP_META_KEY &&
        key !== BACKUP_HISTORY_KEY
    );
}

function collectStorage(){
    const data = {};

    for(let index = 0; index < localStorage.length; index++){
        const key =
            localStorage.key(index);

        if(isCrownKey(key)){
            data[key] =
                localStorage.getItem(key);
        }
    }

    return data;
}

function estimateRecordCount(data){
    let total = 0;

    Object.values(data).forEach(function(rawValue){
        try{
            const parsed =
                JSON.parse(rawValue);

            if(Array.isArray(parsed)){
                total += parsed.length;
            }else if(
                parsed &&
                typeof parsed === "object"
            ){
                total +=
                    Array.isArray(parsed.rows)
                        ? parsed.rows.length
                        : 1;
            }else{
                total += 1;
            }
        }catch(error){
            total += 1;
        }
    });

    return total;
}

function createBackupPayload(reason){
    const data =
        collectStorage();

    return {
        crownBackup: true,
        application: "CrownOS",
        formatVersion: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        createdBy: currentUser(),
        reason: reason,
        keyCount: Object.keys(data).length,
        recordCount: estimateRecordCount(data),
        data: data
    };
}

function createTimestamp(){
    const now = new Date();

    return (
        [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0")
        ].join("-") +
        "_" +
        [
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
            String(now.getSeconds()).padStart(2, "0")
        ].join("-")
    );
}

function exportFullBackup(reason = "manual"){
    const payload =
        createBackupPayload(reason);

    const fileName =
        reason === "pre-restore"
            ? `CrownOS_Safety_Before_Restore_${createTimestamp()}.json`
            : `CrownOS_Full_Backup_${createTimestamp()}.json`;

    downloadTextFile(
        JSON.stringify(payload, null, 2),
        fileName,
        "application/json"
    );

    addHistoryEntry({
        type:
            reason === "pre-restore"
                ? "Safety Backup"
                : "Manual Backup",
        date: payload.createdAt,
        fileName: fileName,
        records: payload.recordCount,
        user: payload.createdBy,
        status: "Success"
    });

    if(reason === "manual"){
        localStorage.setItem(
            BACKUP_META_KEY,
            JSON.stringify({
                lastBackupAt: payload.createdAt,
                lastBackupFile: fileName,
                recordCount: payload.recordCount
            })
        );

        alert(
            "Backup exported successfully. Save another copy to Google Drive, iCloud, or USB."
        );
    }

    refreshSystemHealth();
    renderBackupHistory();

    return payload;
}

function downloadTextFile(content, fileName, mimeType){
    const blob =
        new Blob(
            [content],
            {
                type: mimeType
            }
        );

    const url =
        URL.createObjectURL(blob);

    const link =
        document.createElement("a");

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(function(){
        URL.revokeObjectURL(url);
    }, 1000);
}

async function readRestoreFile(event){
    const file =
        event.target.files?.[0];

    resetVerification();

    if(!file){
        return;
    }

    selectedBackupName =
        file.name;

    document.getElementById("restoreFileName").textContent =
        file.name;

    try{
        const payload =
            JSON.parse(
                await file.text()
            );

        validateBackup(payload);

        selectedBackup =
            payload;

        showVerification(payload);

        document.getElementById("restoreBackupBtn").disabled =
            false;
    }catch(error){
        console.error(error);

        selectedBackup = null;

        document.getElementById("restoreBackupBtn").disabled =
            true;

        document.getElementById("verificationPanel")
            .classList.remove("d-none");

        document.getElementById("verificationStatus").textContent =
            "Invalid Backup";

        document.getElementById("verificationStatus")
            .classList.add("verification-invalid");

        alert(
            "This file is not a valid CrownOS backup."
        );
    }
}

function validateBackup(payload){
    if(
        !payload ||
        payload.crownBackup !== true ||
        !payload.data ||
        typeof payload.data !== "object" ||
        Array.isArray(payload.data)
    ){
        throw new Error("Invalid CrownOS backup.");
    }

    const keys =
        Object.keys(payload.data);

    if(keys.length === 0){
        throw new Error("Backup contains no data.");
    }

    if(
        keys.some(function(key){
            return !key.startsWith(CROWN_PREFIX);
        })
    ){
        throw new Error("Unexpected storage key.");
    }

    if(
        keys.some(function(key){
            const value =
                payload.data[key];

            return (
                value !== null &&
                typeof value !== "string"
            );
        })
    ){
        throw new Error("Invalid stored value.");
    }
}

function showVerification(payload){
    const panel =
        document.getElementById("verificationPanel");

    panel.classList.remove("d-none");

    const status =
        document.getElementById("verificationStatus");

    status.textContent =
        "Valid Backup";

    status.classList.remove(
        "verification-invalid"
    );

    document.getElementById("verificationVersion").textContent =
        `Version ${payload.formatVersion || "Unknown"}`;

    document.getElementById("verificationDate").textContent =
        payload.createdAt
            ? new Date(payload.createdAt)
                .toLocaleString("en-PH")
            : "Unknown";

    document.getElementById("verificationCreator").textContent =
        payload.createdBy || "Unknown";

    document.getElementById("verificationRecords").textContent =
        Number(
            payload.recordCount ??
            estimateRecordCount(payload.data)
        ).toLocaleString("en-PH");

    document.getElementById("verificationKeys").textContent =
        Object.keys(payload.data).length;

    renderCoverage(payload.data);
}

function renderCoverage(data){
    const checks = [
        {
            label: "Clients",
            matched: hasMatchingKey(data, ["client"])
        },
        {
            label: "Sales / Income",
            matched: hasMatchingKey(data, ["sale", "income", "daily"])
        },
        {
            label: "Schedules",
            matched: hasMatchingKey(data, ["schedule"])
        },
        {
            label: "Services",
            matched: hasMatchingKey(data, ["service"])
        },
        {
            label: "Products",
            matched: hasMatchingKey(data, ["product"])
        },
        {
            label: "Users",
            matched: hasMatchingKey(data, ["user", "account"])
        },
        {
            label: "Branches",
            matched: hasMatchingKey(data, ["branch"])
        },
        {
            label: "Therapists",
            matched: hasMatchingKey(data, ["therapist"])
        }
    ];

    document.getElementById("coverageList").innerHTML =
        checks.map(function(item){
            return `
                <span class="${item.matched ? "covered" : "not-covered"}">
                    ${item.matched ? "✓" : "—"} ${item.label}
                </span>
            `;
        }).join("");
}

function hasMatchingKey(data, terms){
    return Object.keys(data).some(function(key){
        const lower =
            key.toLowerCase();

        return terms.some(function(term){
            return lower.includes(term);
        });
    });
}

function resetVerification(){
    selectedBackup = null;
    selectedBackupName = "";

    document.getElementById("restoreFileName").textContent =
        "No file selected";

    document.getElementById("verificationPanel")
        .classList.add("d-none");

    document.getElementById("restoreBackupBtn").disabled =
        true;
}

/* Restoring doesn't just replace this browser's data — performRestore()
   ends with CrownCloud.flushNow(), which pushes the restored snapshot to
   the shared Firestore appData collection and silently overwrites
   whatever every OTHER signed-in device/branch has done since the
   backup was taken (see performRestore()'s comment). A single checkbox
   undersold that risk, so confirming now needs BOTH the checkbox and
   typing "RESTORE" — a deliberately higher-friction gate for an action
   that can erase live data across the whole org with no built-in undo
   for anyone but this one device. */
function updateRestoreConfirmState(){
    const checked =
        document.getElementById("restoreConfirmation").checked;

    const typed =
        document.getElementById("restoreTypedConfirmation").value.trim();

    document.getElementById("confirmRestoreBtn").disabled =
        !checked || typed !== "RESTORE";
}

function openRestoreModal(){
    if(!selectedBackup){
        return;
    }

    document.getElementById("restoreConfirmation").checked =
        false;

    document.getElementById("restoreTypedConfirmation").value =
        "";

    document.getElementById("confirmRestoreBtn").disabled =
        true;

    document.getElementById("restoreModal")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");
}

function closeRestoreModal(){
    document.getElementById("restoreModal")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");
}

async function performRestore(){
    if(
        !document.getElementById("restoreConfirmation").checked ||
        document.getElementById("restoreTypedConfirmation").value.trim() !== "RESTORE"
    ){
        return;
    }

    try{
        validateBackup(selectedBackup);

        exportFullBackup("pre-restore");

        const keysToRemove = [];

        for(let index = 0; index < localStorage.length; index++){
            const key =
                localStorage.key(index);

            if(isCrownKey(key)){
                keysToRemove.push(key);
            }
        }

        keysToRemove.forEach(function(key){
            localStorage.removeItem(key);
        });

        Object.entries(
            selectedBackup.data
        ).forEach(function([key, value]){
            if(value === null){
                localStorage.removeItem(key);
            }else{
                localStorage.setItem(key, value);
            }
        });

        addHistoryEntry({
            type: "Restore",
            date: new Date().toISOString(),
            fileName: selectedBackupName,
            records:
                selectedBackup.recordCount ??
                estimateRecordCount(
                    selectedBackup.data
                ),
            user: currentUser(),
            status: "Success"
        });

        localStorage.removeItem(
            "crownCurrentUser"
        );

        localStorage.removeItem(
            "crownLoggedIn"
        );

        closeRestoreModal();

        await window.CrownCloud?.flushNow?.();

        alert(
            "Backup restored successfully. Please log in again."
        );

        location.href =
            "login.html";
    }catch(error){
        console.error(error);

        alert(
            "Restore failed. A safety backup was downloaded before the restore attempt."
        );
    }
}

function getHistory(){
    try{
        const raw =
            localStorage.getItem(
                BACKUP_HISTORY_KEY
            );

        const parsed =
            raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed)
            ? parsed
            : [];
    }catch(error){
        return [];
    }
}

function addHistoryEntry(entry){
    const history =
        getHistory();

    history.unshift({
        id:
            Date.now().toString() +
            Math.random().toString(16).slice(2),
        ...entry
    });

    localStorage.setItem(
        BACKUP_HISTORY_KEY,
        JSON.stringify(
            history.slice(0, 100)
        )
    );
}

function renderBackupHistory(){
    const history =
        getHistory();

    const container =
        document.getElementById("historyList");

    const empty =
        document.getElementById("historyEmpty");

    container.innerHTML = "";

    if(history.length === 0){
        empty.classList.remove("d-none");
        return;
    }

    empty.classList.add("d-none");

    history.forEach(function(entry){
        const item =
            document.createElement("div");

        item.className =
            "history-item";

        item.innerHTML = `
            <div>
                <strong>
                    ${escapeHtml(entry.type || "Backup")}
                </strong>

                <span>
                    ${formatDate(entry.date)}
                </span>
            </div>

            <div>
                <span>File</span>
                <strong title="${escapeHtml(entry.fileName || "")}">
                    ${escapeHtml(entry.fileName || "—")}
                </strong>
            </div>

            <div>
                <span>Records</span>
                <strong>
                    ${Number(entry.records || 0).toLocaleString("en-PH")}
                </strong>
            </div>

            <div>
                <span>User</span>
                <strong>
                    ${escapeHtml(entry.user || "Unknown")}
                </strong>
            </div>

            <div>
                <span class="history-status">
                    ${escapeHtml(entry.status || "Success")}
                </span>
            </div>
        `;

        container.appendChild(item);
    });
}

function clearHistory(){
    if(
        !confirm(
            "Clear the local backup history? This will not delete downloaded backup files."
        )
    ){
        return;
    }

    localStorage.removeItem(
        BACKUP_HISTORY_KEY
    );

    renderBackupHistory();
}

function refreshSystemHealth(){
    const data =
        collectStorage();

    const recordCount =
        estimateRecordCount(data);

    const databaseHealth =
        document.getElementById("databaseHealth");

    databaseHealth.textContent =
        Object.keys(data).length > 0
            ? "Healthy"
            : "No Data";

    databaseHealth.className =
        Object.keys(data).length > 0
            ? "health-good"
            : "health-warning";

    document.getElementById("databaseHealthNote").textContent =
        `${recordCount.toLocaleString("en-PH")} estimated records`;

    const size =
        calculateStorageBytes(data);

    document.getElementById("storageHealth").textContent =
        formatBytes(size);

    document.getElementById("storageHealthNote").textContent =
        size < 4 * 1024 * 1024
            ? "Storage level is normal"
            : "Storage is becoming large";

    try{
        const metadata =
            JSON.parse(
                localStorage.getItem(
                    BACKUP_META_KEY
                ) || "null"
            );

        if(!metadata){
            setBackupHealthNever();
            return;
        }

        const date =
            new Date(metadata.lastBackupAt);

        const ageHours =
            (
                Date.now() -
                date.getTime()
            ) / 3600000;

        const health =
            document.getElementById("lastBackupHealth");

        health.textContent =
            ageHours <= 24
                ? "Today"
                : formatDate(
                    metadata.lastBackupAt
                );

        health.className =
            ageHours <= 24
                ? "health-good"
                : "health-warning";

        document.getElementById("lastBackupHealthNote").textContent =
            metadata.lastBackupFile ||
            "Manual backup";
    }catch(error){
        setBackupHealthNever();
    }
}

function setBackupHealthNever(){
    const health =
        document.getElementById("lastBackupHealth");

    health.textContent =
        "Never";

    health.className =
        "health-danger";

    document.getElementById("lastBackupHealthNote").textContent =
        "Create a backup before live encoding";
}

function calculateStorageBytes(data){
    return Object.entries(data)
        .reduce(function(total, [key, value]){
            return (
                total +
                new Blob([key]).size +
                new Blob([String(value)]).size
            );
        }, 0);
}

function formatBytes(bytes){
    if(bytes < 1024){
        return `${bytes} Bytes`;
    }

    if(bytes < 1024 * 1024){
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function emergencyExport(type){
    if(type === "clients"){
        exportCategoryCsv(
            "Clients",
            ["client"]
        );
        return;
    }

    if(type === "income"){
        exportCategoryCsv(
            "Daily_Income",
            ["income", "sale", "daily"]
        );
        return;
    }

    if(type === "schedules"){
        exportCategoryCsv(
            "Schedules",
            ["schedule"]
        );
        return;
    }

    exportAllReadableData();
}

function exportCategoryCsv(fileLabel, terms){
    const rows =
        collectMatchingRows(terms);

    if(rows.length === 0){
        alert(
            `No ${fileLabel.replaceAll("_", " ")} records were found.`
        );
        return;
    }

    const csv =
        objectsToCsv(rows);

    downloadTextFile(
        csv,
        `CrownOS_${fileLabel}_${createTimestamp()}.csv`,
        "text/csv;charset=utf-8"
    );

    addHistoryEntry({
        type: `Emergency Export: ${fileLabel.replaceAll("_", " ")}`,
        date: new Date().toISOString(),
        fileName:
            `CrownOS_${fileLabel}_${createTimestamp()}.csv`,
        records: rows.length,
        user: currentUser(),
        status: "Success"
    });

    renderBackupHistory();
}

function collectMatchingRows(terms){
    const rows = [];

    Object.entries(
        collectStorage()
    ).forEach(function([key, raw]){
        const lowerKey =
            key.toLowerCase();

        if(
            !terms.some(function(term){
                return lowerKey.includes(term);
            })
        ){
            return;
        }

        try{
            const parsed =
                JSON.parse(raw);

            if(Array.isArray(parsed)){
                parsed.forEach(function(item){
                    rows.push(
                        normalizeExportRow(
                            key,
                            item
                        )
                    );
                });
            }else{
                rows.push(
                    normalizeExportRow(
                        key,
                        parsed
                    )
                );
            }
        }catch(error){
            rows.push({
                sourceKey: key,
                value: raw
            });
        }
    });

    return rows;
}

function normalizeExportRow(sourceKey, value){
    if(
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ){
        return {
            sourceKey: sourceKey,
            ...flattenObject(value)
        };
    }

    return {
        sourceKey: sourceKey,
        value:
            Array.isArray(value)
                ? JSON.stringify(value)
                : value
    };
}

function flattenObject(object, prefix = "", output = {}){
    Object.entries(object || {})
        .forEach(function([key, value]){
            const finalKey =
                prefix
                    ? `${prefix}.${key}`
                    : key;

            if(
                value &&
                typeof value === "object" &&
                !Array.isArray(value)
            ){
                flattenObject(
                    value,
                    finalKey,
                    output
                );
            }else{
                output[finalKey] =
                    Array.isArray(value)
                        ? JSON.stringify(value)
                        : value;
            }
        });

    return output;
}

function objectsToCsv(rows){
    const headers =
        Array.from(
            new Set(
                rows.flatMap(function(row){
                    return Object.keys(row);
                })
            )
        );

    const lines = [
        headers
            .map(csvEscape)
            .join(",")
    ];

    rows.forEach(function(row){
        lines.push(
            headers
                .map(function(header){
                    return csvEscape(
                        row[header] ?? ""
                    );
                })
                .join(",")
        );
    });

    return "\uFEFF" + lines.join("\n");
}

function csvEscape(value){
    const text =
        String(value ?? "");

    return (
        '"' +
        text.replaceAll('"', '""') +
        '"'
    );
}

function exportAllReadableData(){
    const categories = [
        {
            name: "Clients",
            terms: ["client"]
        },
        {
            name: "Daily_Income",
            terms: ["income", "sale", "daily"]
        },
        {
            name: "Schedules",
            terms: ["schedule"]
        }
    ];

    let exported = 0;

    categories.forEach(function(category){
        const rows =
            collectMatchingRows(
                category.terms
            );

        if(rows.length){
            downloadTextFile(
                objectsToCsv(rows),
                `CrownOS_${category.name}_${createTimestamp()}.csv`,
                "text/csv;charset=utf-8"
            );

            exported += rows.length;
        }
    });

    exportFullBackup("manual");

    alert(
        `Emergency export completed. ${exported.toLocaleString("en-PH")} readable records were exported, together with a full JSON backup.`
    );
}

function formatDate(value){
    if(!value){
        return "—";
    }

    return new Date(value)
        .toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
