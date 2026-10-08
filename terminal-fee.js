/* ==========================================================================
   Crown Head Spa — Maya Terminal fee (auto expense)
   The Daily Income Report records Terminal payments at their gross amount.
   The processing fee (TERMINAL_FEE_RATE) is NOT deducted there; it is
   computed here from the month's Terminal payments, per branch, and shown
   as an auto line under Expenses > Utilities / Monthly Dues > "Maya Terminal".

   Nothing is stored — it is recalculated from crownDailySales_<branch>_<date>
   every time, so editing or deleting a sale updates the fee automatically.
   Unsettled rows (settled === false) are skipped, same as every other sales
   report; a voided/deleted transaction no longer exists, so it drops out too.

   Used by expenses-report.js, share-holder-report.js and admin-dashboard.js
   so all three show the same Utilities total.
   ========================================================================== */

const TERMINAL_FEE_RATE = 0.035;
/* First month the fee applies. Earlier months are left untouched. */
const TERMINAL_FEE_START_MONTH = "2026-10";
const TERMINAL_FEE_PARTICULAR = "Maya Terminal (3.5% fee, auto)";

function terminalSalesForMonth(branch, monthKey){
    if(!branch || !monthKey) return 0;

    const [year, month] = monthKey.split("-").map(Number);
    if(!year || !month) return 0;

    const days = new Date(year, month, 0).getDate();
    let total = 0;

    for(let day = 1; day <= days; day++){
        const dateString = monthKey + "-" + String(day).padStart(2, "0");
        const saved = localStorage.getItem("crownDailySales_" + branch + "_" + dateString);
        if(!saved) continue;

        try{
            const rows = JSON.parse(saved)?.rows;
            if(!Array.isArray(rows)) continue;

            rows.forEach(function(row){
                if(row?.settled === false) return;

                if(Array.isArray(row?.payments) && row.payments.length){
                    row.payments.forEach(function(payment){
                        if(payment?.method === "Terminal"){
                            total += Math.max(0, Number(payment.amount) || 0);
                        }
                    });
                }else if(row?.payment === "Terminal"){
                    /* Legacy single-payment row — same net-amount fallback as getSalePayments(). */
                    const legacyGross = Array.isArray(row.services)
                        ? row.services.reduce((sum, item) => sum + (parseFloat(item?.amount) || 0), 0)
                        : 0;
                    const gross = Number.isFinite(Number(row.grossAmount)) ? Number(row.grossAmount) : legacyGross;
                    const voucher = Number.isFinite(Number(row.voucherValue)) ? Math.max(0, Number(row.voucherValue)) : 0;
                    total += Number.isFinite(Number(row.netAmount))
                        ? Math.max(0, Number(row.netAmount))
                        : Math.max(0, gross - voucher);
                }
            });
        }catch(error){
            console.error("Unable to read sales for terminal fee:", dateString, error);
        }
    }

    return total;
}

function terminalFeeForMonth(branch, monthKey){
    if(!monthKey || monthKey < TERMINAL_FEE_START_MONTH) return 0;
    return Math.round(terminalSalesForMonth(branch, monthKey) * TERMINAL_FEE_RATE * 100) / 100;
}
