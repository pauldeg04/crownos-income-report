/* ==========================================================================
   Crown Head Spa — Inventory System Shared Data Layer
   ========================================================================== */

(function(){
    const ITEMS_KEY = "crownInventoryItemsList";
    const WAREHOUSE_KEY = "crownWarehouseStock";
    const WAREHOUSE_LOG_KEY = "crownWarehouseLog";
    const BRANCH_STOCK_KEY = "crownBranchStock";
    const REQUESTS_KEY = "crownStockRequests";

    const CATEGORIES = [
        "Head Spa",
        "Body Massage",
        "House Keeping",
        "Retail Products",
        "Tea room Supplies",
        "Pantry Supplies",
        "Others"
    ];

    const UNITS = [
        "Pcs",
        "Pack",
        "Bot",
        "Cup"
    ];

    function createId(prefix){
        return (
            prefix + "-" +
            Date.now().toString(36).toUpperCase() +
            Math.random().toString(36).slice(2, 7).toUpperCase()
        );
    }

    function escapeHtml(value){
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function readList(key){
        try{
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            console.error("Unable to load " + key, error);
            return [];
        }
    }

    function writeList(key, list){
        localStorage.setItem(key, JSON.stringify(list));
    }

    function getItems(){
        return readList(ITEMS_KEY);
    }

    function saveItems(items){
        writeList(ITEMS_KEY, items);
    }

    function getItemById(itemId){
        return getItems().find(function(item){
            return item.id === itemId;
        }) || null;
    }

    function getWarehouseStock(){
        return readList(WAREHOUSE_KEY);
    }

    function saveWarehouseStock(rows){
        writeList(WAREHOUSE_KEY, rows);
    }

    function getWarehouseRow(itemId, rows){
        const list = rows || getWarehouseStock();

        return list.find(function(row){
            return row.itemId === itemId;
        }) || null;
    }

    function adjustWarehouseStock(itemId, delta, date){
        const rows = getWarehouseStock();
        let row = getWarehouseRow(itemId, rows);

        if(!row){
            row = { itemId: itemId, qty: 0, lastDate: "" };
            rows.push(row);
        }

        row.qty = Math.max(0, (Number(row.qty) || 0) + delta);

        if(date){
            row.lastDate = date;
        }

        saveWarehouseStock(rows);
        return row;
    }

    function getWarehouseLog(){
        return readList(WAREHOUSE_LOG_KEY);
    }

    function addWarehouseLog(entry){
        const log = getWarehouseLog();

        log.unshift(Object.assign({
            id: createId("WLOG"),
            createdAt: new Date().toISOString()
        }, entry));

        writeList(WAREHOUSE_LOG_KEY, log);
    }

    function getBranchStock(){
        return readList(BRANCH_STOCK_KEY);
    }

    function saveBranchStock(rows){
        writeList(BRANCH_STOCK_KEY, rows);
    }

    function getBranchRow(branch, itemId, rows){
        const list = rows || getBranchStock();

        return list.find(function(row){
            return row.branch === branch && row.itemId === itemId;
        }) || null;
    }

    function adjustBranchStock(branch, itemId, delta, date){
        const rows = getBranchStock();
        let row = getBranchRow(branch, itemId, rows);

        if(!row){
            row = { branch: branch, itemId: itemId, qty: 0, lastDate: "" };
            rows.push(row);
        }

        row.qty = Math.max(0, (Number(row.qty) || 0) + delta);

        if(date){
            row.lastDate = date;
        }

        saveBranchStock(rows);
        return row;
    }

    function getRequests(){
        return readList(REQUESTS_KEY);
    }

    function saveRequests(requests){
        writeList(REQUESTS_KEY, requests);
    }

    function getPendingRequestCount(){
        const requests = getRequests();
        let count = 0;

        requests.forEach(function(request){
            (request.items || []).forEach(function(line){
                if(line.status === "Awaiting Response"){
                    count++;
                }
            });
        });

        return count;
    }

    function formatDate(value){
        if(!value){
            return "—";
        }

        const date = new Date(value + "T00:00:00");

        if(Number.isNaN(date.getTime())){
            return value;
        }

        return date.toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    function getTodayValue(){
        const today = new Date();

        return [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, "0"),
            String(today.getDate()).padStart(2, "0")
        ].join("-");
    }

    window.CrownInventory = {
        CATEGORIES,
        UNITS,
        createId,
        escapeHtml,
        formatDate,
        getTodayValue,
        getItems,
        saveItems,
        getItemById,
        getWarehouseStock,
        saveWarehouseStock,
        getWarehouseRow,
        adjustWarehouseStock,
        getWarehouseLog,
        addWarehouseLog,
        getBranchStock,
        saveBranchStock,
        getBranchRow,
        adjustBranchStock,
        getRequests,
        saveRequests,
        getPendingRequestCount
    };
})();
