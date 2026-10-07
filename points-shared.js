/* ==========================================================================
   CrownOS — Points (shared)
   The point table used by Receptionist Sales and Therapist Sales.
   Services are matched by name keywords first, then by cost as a fallback so
   a renamed/new service still earns points when its price is on the table.
   Anything that can't be matched earns 0 and is flagged known:false.
   ========================================================================== */

(function(){
    function readList(key){
        try{
            const parsed = JSON.parse(localStorage.getItem(key));
            return Array.isArray(parsed) ? parsed : [];
        }catch(error){
            return [];
        }
    }

    /* Point table (from the Receptionist Sales attachment).
       Services are matched by name keywords first (the service master uses
       "Crown Reset", "The Reset Duo", etc.), then by cost as a fallback so a
       renamed/new service still earns points when its price is on the table.
       Anything that can't be matched earns 0 and is flagged in the table. */
    const POINTS_BY_COST = {
        600: 3, 900: 4, 1000: 5, 1400: 7, 1500: 7,
        2000: 10, 2300: 11, 3400: 17
    };

    /* Add-ons are services in the List of Services whose category is Add-on. */
    function isAddOnService(lowerName){
        return readList("crownServiceMasterList").some(function(service){
            return (
                String(service?.name || "").trim().toLowerCase() === lowerName &&
                /add[\s-]?on/i.test(String(service?.category || ""))
            );
        });
    }

    function getPointsForItem(item, unitCost){
        const name = String(item?.name || "").toLowerCase();
        const qty = Math.max(Number(item?.quantity) || 1, 1);

        const itemType =
            item?.itemType ||
            (String(item?.productKind || "").includes("Voucher") ? "Product" : "Service");

        /* VIP Card is counted apart from other products (same names the
           Daily Income Report treats as a VIP card). */
        const compact = name.replace(/[^a-z]/g, "");

        if(
            itemType === "Product" &&
            (
                compact === "vipcard" ||
                compact.includes("vipmembershipcard") ||
                compact.includes("viployaltycard")
            )
        ){
            return { points: 1 * qty, known: true, category: "VIP", rank: 1, tier: "" };
        }

        if(itemType === "Product"){
            return { points: 1 * qty, known: true, category: "Products", rank: 1 };
        }

        if(/add[\s-]?ons?\b/.test(name) || isAddOnService(name)){
            return { points: 1 * qty, known: true, category: "Add-ons", rank: 1 };
        }

        let each = null;
        let category = "";

        if(/reset/.test(name) && /duo/.test(name)){ each = 7; category = "Combo"; }
        else if(/serenity/.test(name) && /set/.test(name)){ each = 11; category = "Combo"; }
        else if(/recovery/.test(name) && /ritual/.test(name)){ each = 17; category = "Combo"; }
        else if(/detox/.test(name) && /glow/.test(name)){ each = 10; category = "Head Spa"; }
        else if(/\breset\b/.test(name)){ each = 3; category = "Head Spa"; }
        else if(/serenity/.test(name)){ each = 5; category = "Head Spa"; }
        else if(/relax/.test(name)){ each = 4; category = "Massage"; }
        else if(/reflief|relief/.test(name)){ each = 7; category = "Massage"; }
        else if(/recovery/.test(name)){ each = 10; category = "Massage"; }

        const byName = Boolean(category);

        if(!category){
            category =
                /massage|foot/.test(name) ? "Massage" :
                /head spa/.test(name) ? "Head Spa" :
                "Other";
        }

        if(each === null){
            const byCost = POINTS_BY_COST[Math.round(unitCost)];
            each = byCost === undefined ? null : byCost;
        }

        return each === null
            ? { points: 0, known: false, category: category, rank: 999, tier: "" }
            : { points: each * qty, known: true, category: category, rank: each, tier: byName ? category + ":" + each : "" };
    }

    window.CrownPoints = {
        getPointsForItem: getPointsForItem
    };
})();
