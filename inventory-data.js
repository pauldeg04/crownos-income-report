/* ==========================================================================
   Crown Head Spa — Inventory System Shared Data Layer
   ========================================================================== */

(function(){
    const ITEMS_KEY = "crownInventoryItemsList";
    const WAREHOUSE_KEY = "crownWarehouseStock";
    const WAREHOUSE_LOG_KEY = "crownWarehouseLog";
    const BRANCH_STOCK_KEY = "crownBranchStock";
    const REQUESTS_KEY = "crownStockRequests";
    const STOCK_AUDIT_KEY = "crownStockAudit";
    const SERVICE_MASTER_KEY = "crownServiceMasterList";
    const THERAPIST_MASTER_KEY = "crownTherapistMasterList";
    const PRODUCT_MASTER_KEY = "crownProductMasterList";

    /* What an item is used for. "Services" is the only one that consumes
       stock automatically off the Daily Income Report — see
       getItemServices() / syncSaleStockAudit(). */
    const TRANSACTION_TYPES = [
        "Retail",
        "Branch Consumption",
        "Services"
    ];

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

    /* ----------------------------------------------------------------
       Service linking + Stock Audit

       An item can be tagged in Inventory Settings with the service it
       is consumed by. When that service is sold in the Daily Income
       Report, the sale pushes itself here and every linked item becomes
       a Stock Audit row (with the sale's date / therapist / client) and
       is deducted from that branch's available stock.
       ---------------------------------------------------------------- */

    function normalizeName(value){
        return String(value ?? "").trim().toLowerCase();
    }

    function getServiceNames(){
        return readList(SERVICE_MASTER_KEY)
            .map(function(service){
                if(typeof service === "string"){
                    return { name: service, status: "Active" };
                }

                return {
                    name: service?.name || "",
                    status:
                        service?.status ||
                        (service?.active === false ? "Archived" : "Active")
                };
            })
            .filter(function(service){
                return service.name && service.status === "Active";
            })
            .map(function(service){
                return service.name;
            })
            .sort(function(a, b){
                return a.localeCompare(b);
            });
    }

    function getTherapistNames(branch){
        return readList(THERAPIST_MASTER_KEY)
            .map(function(therapist){
                if(typeof therapist === "string"){
                    return { name: therapist, branches: [], status: "Active" };
                }

                return {
                    name: therapist?.name || "",
                    branches:
                        Array.isArray(therapist?.branches)
                            ? therapist.branches
                            : [],
                    status: therapist?.status || "Active"
                };
            })
            .filter(function(therapist){
                return (
                    therapist.name &&
                    therapist.status === "Active" &&
                    (
                        !branch ||
                        therapist.branches.length === 0 ||
                        therapist.branches.includes(branch)
                    )
                );
            })
            .map(function(therapist){
                return therapist.name;
            })
            .sort(function(a, b){
                return a.localeCompare(b);
            });
    }

    function getProductNames(){
        return readList(PRODUCT_MASTER_KEY)
            .map(function(product){
                if(typeof product === "string"){
                    return { name: product, status: "Active" };
                }

                return {
                    name: product?.name || "",
                    status:
                        product?.status ||
                        (product?.active === false ? "Archived" : "Active")
                };
            })
            .filter(function(product){
                return product.name && product.status === "Active";
            })
            .map(function(product){
                return product.name;
            })
            .sort(function(a, b){
                return a.localeCompare(b);
            });
    }

    /* An item can be linked to several services. Items saved before that
       was possible carry a single `service` string, so both shapes are
       read here and everything downstream only ever sees an array. */
    function getConsumableProductNames(){
        return readList(PRODUCT_MASTER_KEY)
            .filter(function(product){
                return (
                    product &&
                    typeof product === "object" &&
                    product.availableForConsumable === true &&
                    (product.status || "Active") === "Active" &&
                    Boolean(String(product.name || "").trim())
                );
            })
            .map(function(product){
                return product.name;
            })
            .sort(function(a, b){
                return a.localeCompare(b);
            });
    }

    function getItemServices(item){
        if(Array.isArray(item?.services)){
            return item.services.filter(function(name){
                return Boolean(String(name || "").trim());
            });
        }

        const single = String(item?.service || "").trim();

        return single ? [single] : [];
    }

    function getItemsForService(serviceName){
        const target = normalizeName(serviceName);

        if(!target){
            return [];
        }

        return getItems().filter(function(item){
            return getItemServices(item).some(function(name){
                return normalizeName(name) === target;
            });
        });
    }

    /* Retail-transaction items link to a single product (item.linkedProduct)
       instead of a list of services — see applyTransactionVisibility() in
       inventory-items.js. Selling that product on the Daily Income Report
       consumes the linked item the same way selling a service does. */
    function getItemsForProduct(productName){
        const target = normalizeName(productName);

        if(!target){
            return [];
        }

        return getItems().filter(function(item){
            return (
                item.transaction === "Retail" &&
                normalizeName(item.linkedProduct) === target
            );
        });
    }

    function getStockAudit(){
        return readList(STOCK_AUDIT_KEY);
    }

    function saveStockAudit(rows){
        writeList(STOCK_AUDIT_KEY, rows);
    }

    /* adjustBranchStock() floors stock at zero, so consuming an item the
       branch has already run out of takes less than asked for. Recording
       what was ACTUALLY taken keeps the give-back exact — otherwise
       voiding that sale would hand the branch stock it never had. */
    function consumeBranchStock(branch, itemId, qty, date){
        const row = getBranchRow(branch, itemId);

        const available =
            row ? Math.max(0, Number(row.qty) || 0) : 0;

        const applied =
            Math.min(available, Math.max(0, Number(qty) || 0));

        if(applied > 0){
            adjustBranchStock(branch, itemId, -applied, date);
        }

        return applied;
    }

    /* Audit rows written before `deducted` existed fall back to qty. */
    function getDeductedQty(row){
        return row?.deducted === undefined
            ? Number(row?.qty) || 0
            : Number(row.deducted) || 0;
    }

    function returnBranchStock(row){
        const applied = getDeductedQty(row);

        if(applied > 0){
            adjustBranchStock(row.branch, row.itemId, applied, row.date);
        }

        return applied;
    }

    function isManualField(row, field){
        return (
            Array.isArray(row?.manualFields) &&
            row.manualFields.includes(field)
        );
    }

    /* Rebuilds the audit rows one income-report sale should own and
       reconciles them against what is already stored, so re-saving or
       editing the same sale never duplicates a row:

         - a line that is new deducts its qty from branch stock
         - a line that disappeared (service removed from the sale, or its
           item untagged in Settings) gives the stock back
         - a surviving line keeps its Serial No. and any field the user
           edited by hand, while untouched fields re-follow the sale

       `sale` is { id, branch, date, lines: [{ saleItemId, service,
       therapist, client }] }. */
    function syncSaleStockAudit(sale){
        if(!sale || !sale.id){
            return;
        }

        const desired = [];

        (sale.lines || []).forEach(function(line){
            const linkedItems =
                line.kind === "product"
                    ? getItemsForProduct(line.product)
                    : getItemsForService(line.service);

            linkedItems.forEach(function(item){
                desired.push({
                    id: [
                        "AUD",
                        sale.id,
                        line.saleItemId,
                        item.id
                    ].join("::"),
                    saleId: sale.id,
                    saleItemId: line.saleItemId,
                    sourceItemId: item.id,
                    itemId: item.id,
                    branch: sale.branch || "",
                    date: sale.date || "",
                    product: item.name || "",
                    transaction: item.transaction || "",
                    service: line.service || "",
                    therapist: line.therapist || "",
                    client: line.client || "",
                    qty: Math.max(1, Number(line.qty) || 1)
                });
            });
        });

        const desiredById = new Map(
            desired.map(function(row){
                return [row.id, row];
            })
        );

        const rows = getStockAudit();
        const kept = [];

        rows.forEach(function(row){
            if(row.saleId !== sale.id){
                kept.push(row);
                return;
            }

            const match = desiredById.get(row.id);

            if(!match){
                returnBranchStock(row);
                return;
            }

            desiredById.delete(row.id);

            /* Stock moves only when the consumed quantity itself changes;
               the descriptive fields below are just labels. */
            const oldQty = Number(row.qty) || 0;
            const newQty = Number(match.qty) || 0;

            if(!isManualField(row, "qty") && newQty !== oldQty){
                returnBranchStock(row);

                row.qty = newQty;

                row.deducted =
                    consumeBranchStock(
                        row.branch,
                        row.itemId,
                        newQty,
                        match.date
                    );
            }

            ["date", "service", "therapist", "client"].forEach(function(field){
                if(!isManualField(row, field)){
                    row[field] = match[field];
                }
            });

            if(!isManualField(row, "product")){
                row.product = match.product;
                row.itemId = match.itemId;
                row.transaction = match.transaction;
            }

            row.branch = match.branch;

            kept.push(row);
        });

        desiredById.forEach(function(row){
            const deducted =
                consumeBranchStock(
                    row.branch,
                    row.itemId,
                    row.qty,
                    row.date
                );

            kept.push(
                Object.assign({}, row, {
                    deducted: deducted,
                    serialNo: "",
                    manualFields: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                })
            );
        });

        saveStockAudit(kept);
    }

    /* Deleting / voiding a sale un-consumes everything it logged. */
    function removeSaleStockAudit(saleId){
        if(!saleId){
            return;
        }

        const rows = getStockAudit();
        const kept = [];

        rows.forEach(function(row){
            if(row.saleId !== saleId){
                kept.push(row);
                return;
            }

            returnBranchStock(row);
        });

        if(kept.length !== rows.length){
            saveStockAudit(kept);
        }
    }

    /* Audit rows for one branch, newest first. `from`/`to` are inclusive
       yyyy-mm-dd bounds — pass the same value for both to get a single
       day, or omit them for everything. */
    function getStockAuditFor(branch, from, to){
        return getStockAudit()
            .filter(function(row){
                if(row.branch !== branch){
                    return false;
                }

                const date = String(row.date || "");

                if(from && date < from){
                    return false;
                }

                if(to && date > to){
                    return false;
                }

                return true;
            })
            .sort(function(a, b){
                return (
                    String(b.date || "").localeCompare(String(a.date || "")) ||
                    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
                );
            });
    }

    function getStockAuditRow(auditId){
        return getStockAudit().find(function(row){
            return row.id === auditId;
        }) || null;
    }

    /* Applies a manual edit from the Stock Audit table. Every field the
       user actually changes is remembered in manualFields so a later
       re-save of the source sale does not overwrite it again. */
    function updateStockAuditRow(auditId, changes){
        const rows = getStockAudit();

        const row = rows.find(function(entry){
            return entry.id === auditId;
        });

        if(!row){
            return null;
        }

        const manualFields =
            Array.isArray(row.manualFields)
                ? row.manualFields.slice()
                : [];

        const markManual = function(field){
            if(!manualFields.includes(field)){
                manualFields.push(field);
            }
        };

        if(
            changes.itemId &&
            changes.itemId !== row.itemId
        ){
            const replacement = getItemById(changes.itemId);

            returnBranchStock(row);

            row.itemId = changes.itemId;
            row.product = replacement ? replacement.name : row.product;
            row.transaction = replacement ? (replacement.transaction || "") : row.transaction;

            row.deducted =
                consumeBranchStock(
                    row.branch,
                    row.itemId,
                    row.qty,
                    changes.date || row.date
                );

            markManual("product");
        }

        ["date", "service", "therapist", "client"].forEach(function(field){
            if(
                changes[field] !== undefined &&
                changes[field] !== row[field]
            ){
                row[field] = changes[field];
                markManual(field);
            }
        });

        if(changes.qty !== undefined){
            const newQty = Math.max(1, Number(changes.qty) || 1);
            const oldQty = Number(row.qty) || 0;

            if(newQty !== oldQty){
                returnBranchStock(row);

                row.qty = newQty;

                row.deducted =
                    consumeBranchStock(
                        row.branch,
                        row.itemId,
                        newQty,
                        row.date
                    );

                markManual("qty");
            }
        }

        if(changes.serialNo !== undefined){
            row.serialNo = String(changes.serialNo).trim();
        }

        row.manualFields = manualFields;
        row.updatedAt = new Date().toISOString();

        saveStockAudit(rows);

        return row;
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

    /* Shifts a yyyy-mm-dd value by whole days, for the date steppers. */
    function shiftDateValue(value, days){
        const base =
            value
                ? new Date(value + "T00:00:00")
                : new Date();

        if(Number.isNaN(base.getTime())){
            return getTodayValue();
        }

        base.setDate(base.getDate() + days);

        return [
            base.getFullYear(),
            String(base.getMonth() + 1).padStart(2, "0"),
            String(base.getDate()).padStart(2, "0")
        ].join("-");
    }

    window.CrownInventory = {
        CATEGORIES,
        UNITS,
        TRANSACTION_TYPES,
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
        getPendingRequestCount,
        getServiceNames,
        getTherapistNames,
        getProductNames,
        getConsumableProductNames,
        getItemServices,
        getItemsForService,
        getItemsForProduct,
        shiftDateValue,
        getStockAudit,
        saveStockAudit,
        getStockAuditFor,
        getStockAuditRow,
        updateStockAuditRow,
        syncSaleStockAudit,
        removeSaleStockAudit
    };
})();
