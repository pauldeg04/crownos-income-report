/* ==========================================================================
   Crown Head Spa — Shared Overtime Commission Formula

   payroll.js and therapist-sales.js each independently recomputed "did
   this service run past the therapist's shift end" (and, from that,
   whether to charge commission or overtimeCommission) with copy-pasted
   logic. Being identical today doesn't mean they'd stay that way — a
   future edit to one (e.g. how the shift-end comparison handles
   midnight-crossing shifts) with no shared function to catch it would
   let Payroll's payslip commission total silently diverge from what
   Therapist Sales reports for the same therapist/period, with nothing
   forcing them back in sync.

   Only the FORMULA lives here, not the Opening/Closing shift-time data
   itself — payroll.js's SHIFT_SCHEDULES and therapist-sales.js's
   THERAPIST_SALES_SHIFT_SCHEDULES stay local to each (payroll.js also
   uses its copy for hours-worked clamping, outside this module's
   scope), so callers pass in the shift's end time directly.
   ========================================================================== */

(function(){
    /* True if a service starting at serviceStartTime on `date`, running
       durationMinutes long, ends after shiftEndTime ("HH:MM"). False
       (never overtime) if any input is missing — matches both callers'
       existing "nothing to compare against" fallback (e.g. a service
       item saved before serviceStartTime existed, or a day with no
       recognized shift type). */
    function isServiceOvertime(date, serviceStartTime, durationMinutes, shiftEndTime){
        if(!shiftEndTime || !date || !serviceStartTime || !(durationMinutes > 0)){
            return false;
        }

        const serviceEndAt =
            new Date(`${date}T${serviceStartTime}:00`);

        serviceEndAt.setMinutes(
            serviceEndAt.getMinutes() + durationMinutes
        );

        const shiftEndAt =
            new Date(`${date}T${shiftEndTime}:00`);

        return serviceEndAt.getTime() > shiftEndAt.getTime();
    }

    /* Commission rate (a percentage, e.g. 10 for 10%) for one service
       item — serviceMeta.overtimeCommission when isServiceOvertime() is
       true, serviceMeta.commission otherwise. */
    function getServiceCommissionRate(serviceMeta, date, serviceStartTime, shiftEndTime){
        const meta = serviceMeta || {};

        const durationMinutes =
            Number(meta.duration) || 0;

        if(isServiceOvertime(date, serviceStartTime, durationMinutes, shiftEndTime)){
            return Number(meta.overtimeCommission) || 0;
        }

        return Number(meta.commission) || 0;
    }

    window.CrownCommission = {
        isServiceOvertime: isServiceOvertime,
        getServiceCommissionRate: getServiceCommissionRate
    };
})();
