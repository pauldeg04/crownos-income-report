const BRANCH_STORAGE_KEY =
    "crownBranchMasterList";

const SELECTED_BRANCH_KEY =
    "crownSelectedBranch";

const DEFAULT_BRANCHES = [
    {
        name: "Crown Head Spa Biñan",
        beds: 4,
        openingTime: "10:00",
        closingTime: "22:00"
    },
    {
        name: "Crown Head Spa Calamba",
        beds: 7,
        openingTime: "10:00",
        closingTime: "22:00"
    }
];

let branches = [];
let blankRowOpen = false;

document.addEventListener(
    "DOMContentLoaded",
    function(){

        loadBranches();

        if(
            localStorage.getItem(
                BRANCH_STORAGE_KEY
            ) === null
        ){
            seedDefaultBranches();
        }else{
            migrateExistingBranches();
        }

        renderBranches();

        document
            .getElementById("addBranchBtn")
            .addEventListener(
                "click",
                addBlankRow
            );
    }
);

function createId(){
    return Date.now().toString() +
        Math.random().toString(16).slice(2);
}

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function parseCoordinate(value){
    if(
        value === null ||
        value === undefined ||
        value === ""
    ){
        return null;
    }

    const num = Number(value);

    return Number.isFinite(num) ? num : null;
}

/* Accepts "lat, lng" pasted from Google Maps.
   Returns {lat, lng}, null when blank, or "invalid". */
function parseCoordinatePair(text){
    const trimmed =
        String(text || "").trim();

    if(!trimmed){
        return null;
    }

    const parts = trimmed.split(",");

    if(parts.length !== 2){
        return "invalid";
    }

    const lat = Number(parts[0].trim());
    const lng = Number(parts[1].trim());

    if(
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
    ){
        return "invalid";
    }

    return { lat: lat, lng: lng };
}

function formatCoordinates(branch){
    if(
        parseCoordinate(branch.latitude) === null ||
        parseCoordinate(branch.longitude) === null
    ){
        return "";
    }

    return (
        Number(branch.latitude).toFixed(5) +
        ", " +
        Number(branch.longitude).toFixed(5)
    );
}

function formatTime(timeValue){
    if(!timeValue){
        return "—";
    }

    const parts = timeValue.split(":");
    let hour = Number(parts[0]);
    const minute = parts[1] || "00";
    const suffix = hour >= 12 ? "PM" : "AM";

    hour = hour % 12 || 12;

    return `${hour}:${minute} ${suffix}`;
}

function seedDefaultBranches(){
    branches = DEFAULT_BRANCHES.map(
        function(branch){
            return {
                id: createId(),
                name: branch.name,
                beds: Number(branch.beds) || 0,
                openingTime: branch.openingTime,
                closingTime: branch.closingTime,
                latitude: null,
                longitude: null
            };
        }
    );

    saveBranchesToStorage();
}

function migrateExistingBranches(){
    let changed = false;

    branches = branches.map(function(branch){
        if(typeof branch === "string"){
            changed = true;

            return {
                id: createId(),
                name: branch,
                beds:
                    branch === "Crown Head Spa Biñan"
                        ? 4
                        : branch === "Crown Head Spa Calamba"
                            ? 7
                            : 0,
                openingTime: "10:00",
                closingTime: "22:00",
                latitude: null,
                longitude: null
            };
        }

        const migrated = {
            id: branch.id || createId(),
            name: branch.name || "",
            beds: Number(branch.beds) || 0,
            openingTime: branch.openingTime || "10:00",
            closingTime: branch.closingTime || "22:00",
            latitude: parseCoordinate(branch.latitude),
            longitude: parseCoordinate(branch.longitude)
        };

        if(!branch.id){
            changed = true;
        }

        if(
            branch.beds === undefined ||
            branch.beds === null ||
            branch.beds === ""
        ){
            if(migrated.name === "Crown Head Spa Biñan"){
                migrated.beds = 4;
            }else if(migrated.name === "Crown Head Spa Calamba"){
                migrated.beds = 7;
            }

            changed = true;
        }

        if(!branch.openingTime){
            migrated.openingTime = "10:00";
            changed = true;
        }

        if(!branch.closingTime){
            migrated.closingTime = "22:00";
            changed = true;
        }

        return migrated;
    });

    if(changed){
        saveBranchesToStorage();
    }
}

function loadBranches(){
    const saved =
        localStorage.getItem(
            BRANCH_STORAGE_KEY
        );

    if(!saved){
        branches = [];
        return;
    }

    try{
        const parsed = JSON.parse(saved);

        branches =
            Array.isArray(parsed)
                ? parsed
                : [];
    }catch(error){
        console.error(
            "Unable to load branches:",
            error
        );

        branches = [];

        alert(
            "The saved branch list could not be loaded."
        );
    }
}

function saveBranchesToStorage(){
    try{
        localStorage.setItem(
            BRANCH_STORAGE_KEY,
            JSON.stringify(branches)
        );
    }catch(error){
        console.error(
            "Unable to save branches:",
            error
        );

        alert(
            "Unable to save the branch list."
        );
    }
}

function renderBranches(){
    const tbody =
        document.getElementById(
            "branchesBody"
        );

    tbody.innerHTML = "";

    branches.forEach(
        function(branch, index){

            tbody.appendChild(
                createSavedRow(
                    branch,
                    index
                )
            );
        }
    );

    blankRowOpen = false;

    updateBranchCount();
}

function createSavedRow(branch, index){
    const row =
        document.createElement("tr");

    row.className = "saved-row";
    row.dataset.id = branch.id;

    row.innerHTML = `
        <td>
            ${index + 1}
        </td>

        <td class="branch-name-cell">
            <span class="saved-branch-name">
                ${escapeHtml(branch.name)}
            </span>
        </td>

        <td class="branch-beds-cell">
            <span class="saved-bed-count">
                ${Number(branch.beds) || 0}
            </span>
        </td>

        <td class="opening-time-cell">
            <span class="saved-time">
                ${formatTime(branch.openingTime)}
            </span>
        </td>

        <td class="closing-time-cell">
            <span class="saved-time">
                ${formatTime(branch.closingTime)}
            </span>
        </td>

        <td class="location-cell">
            ${
                formatCoordinates(branch)
                    ? `<span class="saved-location">${formatCoordinates(branch).replace(", ", "<br>")}</span>`
                    : '<span class="text-muted">Not set</span>'
            }
        </td>

        <td>
            <div class="action-buttons">

                <button
                    type="button"
                    class="btn btn-sm btn-warning edit-btn"
                >
                    Edit
                </button>

                <button
                    type="button"
                    class="btn btn-sm btn-danger delete-btn"
                >
                    Delete
                </button>

            </div>
        </td>
    `;

    row
        .querySelector(".edit-btn")
        .addEventListener(
            "click",
            function(){
                editBranch(
                    row,
                    branch.id
                );
            }
        );

    row
        .querySelector(".delete-btn")
        .addEventListener(
            "click",
            function(){
                deleteBranch(
                    branch.id
                );
            }
        );

    return row;
}

function addBlankRow(){
    if(blankRowOpen){
        const existingInput =
            document.querySelector(
                ".blank-row .branch-name-input"
            );

        if(existingInput){
            existingInput.focus();
        }

        return;
    }

    const tbody =
        document.getElementById(
            "branchesBody"
        );

    const row =
        document.createElement("tr");

    row.className = "blank-row";

    row.innerHTML = `
        <td>
            ${branches.length + 1}
        </td>

        <td>
            <input
                type="text"
                class="form-control branch-name-input"
                placeholder="Enter branch name"
                autocomplete="off"
            >
        </td>

        <td>
            <input
                type="number"
                class="form-control bed-count-input"
                placeholder="Beds"
                min="1"
                step="1"
            >
        </td>

        <td>
            <input
                type="time"
                class="form-control opening-time-input"
                value="10:00"
            >
        </td>

        <td>
            <input
                type="time"
                class="form-control closing-time-input"
                value="22:00"
            >
        </td>

        <td>
            <input
                type="text"
                class="form-control location-input"
                placeholder="Lat, Lng (optional)"
                autocomplete="off"
            >
        </td>

        <td>
            <div class="action-buttons">

                <button
                    type="button"
                    class="btn btn-sm btn-primary save-btn"
                >
                    Save
                </button>

                <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary cancel-btn"
                >
                    Cancel
                </button>

            </div>
        </td>
    `;

    tbody.appendChild(row);

    blankRowOpen = true;

    const inputs = {
        name: row.querySelector(".branch-name-input"),
        beds: row.querySelector(".bed-count-input"),
        opening: row.querySelector(".opening-time-input"),
        closing: row.querySelector(".closing-time-input"),
        location: row.querySelector(".location-input")
    };

    row
        .querySelector(".save-btn")
        .addEventListener(
            "click",
            function(){
                saveNewBranch(row);
            }
        );

    row
        .querySelector(".cancel-btn")
        .addEventListener(
            "click",
            function(){
                row.remove();
                blankRowOpen = false;
            }
        );

    Object.values(inputs).forEach(function(input){
        input.addEventListener(
            "keydown",
            function(event){

                if(event.key === "Enter"){
                    event.preventDefault();
                    saveNewBranch(row);
                }

                if(event.key === "Escape"){
                    row.remove();
                    blankRowOpen = false;
                }
            }
        );
    });

    inputs.name.focus();
}

function saveNewBranch(row){
    const nameInput =
        row.querySelector(
            ".branch-name-input"
        );

    const bedsInput =
        row.querySelector(
            ".bed-count-input"
        );

    const openingInput =
        row.querySelector(
            ".opening-time-input"
        );

    const closingInput =
        row.querySelector(
            ".closing-time-input"
        );

    const locationInput =
        row.querySelector(
            ".location-input"
        );

    const branchName =
        nameInput.value.trim();

    const bedCount =
        Number(bedsInput.value);

    const openingTime =
        openingInput.value;

    const closingTime =
        closingInput.value;

    if(!branchName){
        alert(
            "Please enter a branch name."
        );

        nameInput.focus();
        return;
    }

    if(
        !Number.isInteger(bedCount) ||
        bedCount <= 0
    ){
        alert(
            "Please enter a valid number of beds."
        );

        bedsInput.focus();
        return;
    }

    if(!openingTime || !closingTime){
        alert(
            "Please enter the opening and closing time."
        );

        return;
    }

    if(openingTime >= closingTime){
        alert(
            "Closing time must be later than opening time."
        );

        return;
    }

    const coordinates =
        parseCoordinatePair(locationInput.value);

    if(coordinates === "invalid"){
        alert(
            "Please enter the GPS location as \"latitude, longitude\" " +
            "(e.g. 14.30590, 121.07770), or leave it blank."
        );

        locationInput.focus();
        return;
    }

    const alreadyExists =
        branches.some(
            function(branch){
                return (
                    branch.name.toLowerCase() ===
                    branchName.toLowerCase()
                );
            }
        );

    if(alreadyExists){
        alert(
            "This branch already exists in the list."
        );

        nameInput.focus();
        return;
    }

    branches.push({
        id: createId(),
        name: branchName,
        beds: bedCount,
        openingTime: openingTime,
        closingTime: closingTime,
        latitude: coordinates ? coordinates.lat : null,
        longitude: coordinates ? coordinates.lng : null
    });

    saveBranchesToStorage();
    renderBranches();

    alert(
        `"${branchName}" has been saved.`
    );
}

function editBranch(row, branchId){
    const branch =
        branches.find(
            function(item){
                return item.id === branchId;
            }
        );

    if(!branch){
        return;
    }

    const nameCell =
        row.querySelector(
            ".branch-name-cell"
        );

    const bedsCell =
        row.querySelector(
            ".branch-beds-cell"
        );

    const openingCell =
        row.querySelector(
            ".opening-time-cell"
        );

    const closingCell =
        row.querySelector(
            ".closing-time-cell"
        );

    const locationCell =
        row.querySelector(
            ".location-cell"
        );

    const actionCell =
        row.querySelector(
            ".action-buttons"
        );

    nameCell.innerHTML = `
        <input
            type="text"
            class="form-control branch-name-input edit-branch-input"
            value="${escapeHtml(branch.name)}"
            autocomplete="off"
        >
    `;

    bedsCell.innerHTML = `
        <input
            type="number"
            class="form-control bed-count-input edit-bed-input"
            value="${Number(branch.beds) || ""}"
            min="1"
            step="1"
        >
    `;

    openingCell.innerHTML = `
        <input
            type="time"
            class="form-control edit-opening-input"
            value="${branch.openingTime || "10:00"}"
        >
    `;

    closingCell.innerHTML = `
        <input
            type="time"
            class="form-control edit-closing-input"
            value="${branch.closingTime || "22:00"}"
        >
    `;

    locationCell.innerHTML = `
        <input
            type="text"
            class="form-control edit-location-input"
            value="${escapeHtml(formatCoordinates(branch))}"
            placeholder="Lat, Lng (optional)"
            autocomplete="off"
        >
    `;

    actionCell.innerHTML = `
        <button
            type="button"
            class="btn btn-sm btn-success update-btn"
        >
            Save
        </button>

        <button
            type="button"
            class="btn btn-sm btn-outline-secondary cancel-btn"
        >
            Cancel
        </button>
    `;

    const nameInput =
        row.querySelector(
            ".edit-branch-input"
        );

    const bedsInput =
        row.querySelector(
            ".edit-bed-input"
        );

    const openingInput =
        row.querySelector(
            ".edit-opening-input"
        );

    const closingInput =
        row.querySelector(
            ".edit-closing-input"
        );

    const locationInput =
        row.querySelector(
            ".edit-location-input"
        );

    row
        .querySelector(".update-btn")
        .addEventListener(
            "click",
            function(){
                updateBranch(
                    branchId,
                    nameInput.value,
                    bedsInput.value,
                    openingInput.value,
                    closingInput.value,
                    locationInput.value
                );
            }
        );

    row
        .querySelector(".cancel-btn")
        .addEventListener(
            "click",
            function(){
                renderBranches();
            }
        );

    [
        nameInput,
        bedsInput,
        openingInput,
        closingInput,
        locationInput
    ].forEach(function(input){
        input.addEventListener(
            "keydown",
            function(event){

                if(event.key === "Enter"){
                    event.preventDefault();

                    updateBranch(
                        branchId,
                        nameInput.value,
                        bedsInput.value,
                        openingInput.value,
                        closingInput.value,
                        locationInput.value
                    );
                }

                if(event.key === "Escape"){
                    renderBranches();
                }
            }
        );
    });

    nameInput.focus();
    nameInput.select();
}


async function migrateBranchReferences(oldName, newName){
    if(!oldName || !newName || oldName === newName){
        return;
    }

    const prefixes = [
        "crownDailySales_",
        "crownExpenses_",
        "crownSchedule_",
        "crownCashflow_"
    ];

    const moves = [];

    for(let index = 0; index < localStorage.length; index++){
        const key = localStorage.key(index);

        if(!key){
            continue;
        }

        prefixes.forEach(function(prefix){
            const oldPrefix = prefix + oldName + "_";

            if(key.startsWith(oldPrefix)){
                moves.push({
                    oldKey: key,
                    newKey: prefix + newName + "_" + key.slice(oldPrefix.length),
                    value: localStorage.getItem(key)
                });
            }
        });
    }

    moves.forEach(function(move){
        if(localStorage.getItem(move.newKey) === null){
            localStorage.setItem(move.newKey, move.value);
        }

        localStorage.removeItem(move.oldKey);
    });

    /* Shared by the two localStorage-backed lists below and by
       crownClientMasterList (kept in IndexedDB — see client-store.js), so
       a branch rename updates every item.branch / item.branches
       reference the same way regardless of where the list lives. Mutates
       `list` in place and returns whether anything changed. */
    function rewriteBranchRefs(list){
        let changed = false;

        list.forEach(function(item){
            if(Array.isArray(item.branches)){
                item.branches = item.branches.map(function(branch){
                    if(branch === oldName){
                        changed = true;
                        return newName;
                    }

                    return branch;
                });
            }

            if(item.branch === oldName){
                item.branch = newName;
                changed = true;
            }
        });

        return changed;
    }

    [
        "crownTherapistMasterList",
        "crownUserAccounts"
    ].forEach(function(storageKey){
        try{
            const parsed = JSON.parse(
                localStorage.getItem(storageKey) || "[]"
            );

            if(!Array.isArray(parsed)){
                return;
            }

            if(rewriteBranchRefs(parsed)){
                localStorage.setItem(
                    storageKey,
                    JSON.stringify(parsed)
                );
            }
        }catch(error){
            console.error("Unable to migrate branch reference:", storageKey, error);
        }
    });

    try{
        const clientList = await window.CrownClientStore.getAll();

        if(rewriteBranchRefs(clientList)){
            await window.CrownClientStore.saveAll(clientList);
        }
    }catch(error){
        console.error("Unable to migrate branch reference:", "crownClientMasterList", error);
    }

    try{
        const raw = localStorage.getItem("crownShareholders");
        const parsed = raw ? JSON.parse(raw) : null;

        if(parsed && typeof parsed === "object" && !Array.isArray(parsed) && oldName in parsed){
            parsed[newName] = parsed[oldName];
            delete parsed[oldName];
            localStorage.setItem("crownShareholders", JSON.stringify(parsed));
        }
    }catch(error){
        console.error("Unable to migrate shareholders:", error);
    }
}

function branchHasRelatedRecords(branchName){
    /* Must stay in sync with migrateBranchReferences()'s prefix list
       above — that one previously included crownCashflow_ while this
       gate didn't, so a branch with ONLY cashflow history could be
       deleted with no warning even though renaming it correctly
       preserved that same data. */
    const prefixes = [
        "crownDailySales_" + branchName + "_",
        "crownExpenses_" + branchName + "_",
        "crownSchedule_" + branchName + "_",
        "crownCashflow_" + branchName + "_"
    ];

    for(let index = 0; index < localStorage.length; index++){
        const key = localStorage.key(index) || "";

        if(prefixes.some(function(prefix){
            return key.startsWith(prefix);
        })){
            return true;
        }
    }

    /* Branch inventory isn't stored under a per-branch prefixed key like
       the above — crownBranchStock/crownStockRequests are each one flat
       array with a `branch` field per row (see inventory-data.js) — so
       it needs its own check rather than a startsWith() match. Without
       this, a branch with existing stock or a pending stock request
       could be deleted and that inventory data orphaned (it isn't
       migrated by migrateBranchReferences() either — a rename doesn't
       carry it forward, a separate gap from what this function guards
       against). */
    const rowArrayKeys = ["crownBranchStock", "crownStockRequests"];

    for(let index = 0; index < rowArrayKeys.length; index++){
        try{
            const parsed =
                JSON.parse(localStorage.getItem(rowArrayKeys[index]) || "[]");

            if(
                Array.isArray(parsed) &&
                parsed.some(function(row){
                    return row?.branch === branchName;
                })
            ){
                return true;
            }
        }catch(error){
            /* Malformed data shouldn't block deletion on its own — the
               prefix-based checks above are the primary guard. */
        }
    }

    return false;
}

async function updateBranch(
    branchId,
    newValue,
    bedsValue,
    openingValue,
    closingValue,
    locationValue
){
    const newName =
        newValue.trim();

    const newBedCount =
        Number(bedsValue);

    if(!newName){
        alert(
            "Branch name cannot be blank."
        );

        return;
    }

    if(
        !Number.isInteger(newBedCount) ||
        newBedCount <= 0
    ){
        alert(
            "Please enter a valid number of beds."
        );

        return;
    }

    if(!openingValue || !closingValue){
        alert(
            "Please enter the opening and closing time."
        );

        return;
    }

    if(openingValue >= closingValue){
        alert(
            "Closing time must be later than opening time."
        );

        return;
    }

    const coordinates =
        parseCoordinatePair(locationValue);

    if(coordinates === "invalid"){
        alert(
            "Please enter the GPS location as \"latitude, longitude\" " +
            "(e.g. 14.30590, 121.07770), or leave it blank."
        );

        return;
    }

    const duplicate =
        branches.some(
            function(branch){
                return (
                    branch.id !== branchId &&
                    branch.name.toLowerCase() ===
                    newName.toLowerCase()
                );
            }
        );

    if(duplicate){
        alert(
            "Another branch with the same name already exists."
        );

        return;
    }

    const branch =
        branches.find(
            function(item){
                return item.id === branchId;
            }
        );

    if(!branch){
        return;
    }

    const oldName = branch.name;

    await migrateBranchReferences(oldName, newName);

    branch.name = newName;
    branch.beds = newBedCount;
    branch.openingTime = openingValue;
    branch.closingTime = closingValue;
    branch.latitude = coordinates ? coordinates.lat : null;
    branch.longitude = coordinates ? coordinates.lng : null;

    if(
        localStorage.getItem(
            SELECTED_BRANCH_KEY
        ) === oldName
    ){
        localStorage.setItem(
            SELECTED_BRANCH_KEY,
            newName
        );
    }

    saveBranchesToStorage();
    renderBranches();

    alert(
        `"${newName}" has been updated.`
    );
}

function deleteBranch(branchId){
    const branch =
        branches.find(
            function(item){
                return item.id === branchId;
            }
        );

    if(!branch){
        return;
    }

    if(branchHasRelatedRecords(branch.name)){
        alert(
            "This branch still has saved sales, expenses, or schedules. Rename the branch instead of deleting it so historical records remain accessible."
        );

        return;
    }

    const confirmed =
        confirm(
            `Delete "${branch.name}" from the branch list?`
        );

    if(!confirmed){
        return;
    }

    branches =
        branches.filter(
            function(item){
                return item.id !== branchId;
            }
        );

    if(
        localStorage.getItem(
            SELECTED_BRANCH_KEY
        ) === branch.name
    ){
        localStorage.removeItem(
            SELECTED_BRANCH_KEY
        );
    }

    saveBranchesToStorage();
    renderBranches();
}

function updateBranchCount(){
    document
        .getElementById("branchCount")
        .innerText =
        branches.length;
}
