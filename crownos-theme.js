(function(global){
    "use strict";

    const PAYMENT_COLORS = Object.freeze({
        Cash: "#3D8B5A",
        GCash: "#007DFF",
        "Bank Transfer": "#003DA5",
        Terminal: "#6F42C1",
        Other: "#64748B"
    });

    const SYSTEM_COLORS = Object.freeze({
        revenue: "#3D8B5A",
        cash: PAYMENT_COLORS.Cash,
        gcash: PAYMENT_COLORS.GCash,
        bank: PAYMENT_COLORS["Bank Transfer"],
        terminal: PAYMENT_COLORS.Terminal,
        gold: "#C6A15B",
        warning: "#F59E0B",
        danger: "#DC3545",
        neutral: "#CBD5E1",
        neutralDark: "#64748B",
        navy: "#13233F",
        noData: "#CBD5E1"
    });

    function normalizePaymentMethod(method){
        const value = String(method || "").trim().toLowerCase();

        if(value === "cash") return "Cash";
        if(value === "gcash" || value === "g-cash") return "GCash";
        if(value === "bank transfer" || value === "bank" || value === "transfer"){
            return "Bank Transfer";
        }
        if(value === "terminal" || value === "card" || value === "credit card" || value === "debit card"){
            return "Terminal";
        }

        return "Other";
    }

    function getPaymentColor(method){
        return PAYMENT_COLORS[normalizePaymentMethod(method)] || PAYMENT_COLORS.Other;
    }

    function getPaymentClass(method){
        const normalized = normalizePaymentMethod(method);
        if(normalized === "Cash") return "payment-cash";
        if(normalized === "GCash") return "payment-gcash";
        if(normalized === "Bank Transfer") return "payment-bank";
        if(normalized === "Terminal") return "payment-terminal";
        return "payment-default";
    }

    global.CrownOSTheme = Object.freeze({
        PAYMENT_COLORS,
        SYSTEM_COLORS,
        normalizePaymentMethod,
        getPaymentColor,
        getPaymentClass
    });

    /* Backward-friendly globals for existing and future CrownOS pages. */
    global.PAYMENT_COLORS = PAYMENT_COLORS;
    global.SYSTEM_COLORS = SYSTEM_COLORS;
})(window);
