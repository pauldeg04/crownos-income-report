/* ==========================================================================
   Crown Head Spa — shared capacity/overlap math for the public booking
   Cloud Functions. Mirrors the semantics of Income Report/scheduling.js's
   timeToMinutes/hasOverlap so a slot considered "available" here is
   consistent with how CrownOS itself detects conflicts.
   ========================================================================== */

const SLOT_STEP_MINUTES = 30;

function timeToMinutes(timeValue){
    const parts = String(timeValue || "00:00").split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
}

function minutesToTimeValue(totalMinutes){
    return (
        String(Math.floor(totalMinutes / 60)).padStart(2, "0") +
        ":" +
        String(totalMinutes % 60).padStart(2, "0")
    );
}

function formatDisplayTime(timeValue){
    const total = timeToMinutes(timeValue);
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";

    return (hour24 % 12 || 12) + ":" + String(minute).padStart(2, "0") + " " + suffix;
}

function hasOverlap(startA, endA, startB, endB){
    return (
        timeToMinutes(startA) < timeToMinutes(endB) &&
        timeToMinutes(endA) > timeToMinutes(startB)
    );
}

/* `occupants` is a flat list of { startTime, endTime } — merged schedule
   entries (status != "Cancelled") and active holds. Returns the number of
   occupants overlapping [startTime, endTime). */
function countOverlapping(startTime, endTime, occupants){
    return occupants.reduce(function(count, occupant){
        return hasOverlap(startTime, endTime, occupant.startTime, occupant.endTime)
            ? count + 1
            : count;
    }, 0);
}

/* Generates every SLOT_STEP_MINUTES-aligned start time within
   [openingTime, closingTime) for which the full service duration fits
   before closing (no overtime booked from the public website — staff can
   still do that manually in CrownOS), annotated with availability against
   `occupants` and the branch's bed count. */
function computeSlots({ openingTime, closingTime, durationMinutes, beds, occupants }){
    const openingMinutes = timeToMinutes(openingTime);
    const closingMinutes = timeToMinutes(closingTime);
    const slots = [];

    for(
        let start = openingMinutes;
        start + durationMinutes <= closingMinutes;
        start += SLOT_STEP_MINUTES
    ){
        const startTime = minutesToTimeValue(start);
        const endTime = minutesToTimeValue(start + durationMinutes);
        const occupied = countOverlapping(startTime, endTime, occupants);

        if(occupied < beds){
            slots.push({
                startTime: startTime,
                endTime: endTime,
                label: formatDisplayTime(startTime)
            });
        }
    }

    return slots;
}

module.exports = {
    SLOT_STEP_MINUTES,
    timeToMinutes,
    minutesToTimeValue,
    formatDisplayTime,
    hasOverlap,
    countOverlapping,
    computeSlots
};
