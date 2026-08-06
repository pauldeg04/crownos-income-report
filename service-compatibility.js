/* ==========================================================================
   CrownOS — Service Compatibility Helper
   Optional helper for Scheduling and Daily Income
   ========================================================================== */

window.CrownServices = {
    storageKey: "crownServiceMasterList",

    getAll: function(){
        try{
            const raw =
                localStorage.getItem(
                    this.storageKey
                );

            const parsed =
                raw ? JSON.parse(raw) : [];

            return Array.isArray(parsed)
                ? parsed
                : [];
        }catch(error){
            return [];
        }
    },

    getActive: function(){
        return this
            .getAll()
            .filter(function(service){
                if(typeof service === "string"){
                    return true;
                }

                return (
                    (service.status || "Active") === "Active"
                );
            });
    },

    getByName: function(name){
        return this
            .getAll()
            .find(function(service){
                return (
                    typeof service === "string"
                        ? service === name
                        : service.name === name
                );
            }) || null;
    },

    getPrice: function(
        serviceName,
        priceType = "regular"
    ){
        const service =
            this.getByName(serviceName);

        if(!service || typeof service === "string"){
            return 0;
        }

        if(priceType === "vip"){
            return Number(service.vipPrice) || 0;
        }

        if(priceType === "firstTimer"){
            return Number(service.firstTimerPrice) || 0;
        }

        return Number(service.regularPrice) || 0;
    },

    getVoucherServices: function(){
        return this
            .getActive()
            .filter(function(service){
                return (
                    typeof service !== "string" &&
                    service.availableForVoucher === true &&
                    Number(service.voucherValue) > 0
                );
            });
    },

    getPurchasableVoucherProducts: function(){
        return this
            .getVoucherServices()
            .map(function(service){
                return {
                    name: `Voucher — ${service.name}`,
                    sourceServiceName: service.name,
                    sellingPrice: Number(service.voucherValue) || 0,
                    productKind: "Service Voucher",
                    virtualProduct: true
                };
            });
    },

    getDuration: function(serviceName){
        const service =
            this.getByName(serviceName);

        if(!service || typeof service === "string"){
            return 0;
        }

        return Number(service.duration) || 0;
    }
};
