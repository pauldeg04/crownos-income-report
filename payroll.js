/* ==========================================================================
   Crown Head Spa — Payroll

   Unified model: every staff member has a Daily Rate + Meal Allowance +
   Overtime Meal Allowance (Individual Rate Setup). For each date in the
   selected Payroll Date range, Allowance = dailyRate + mealAllowance +
   (otMealAllowance if worked hours that day exceed the standard 8).
   Commission is pulled from that date's sales via the account's linked
   therapist name.

   Payroll Group determines both WHO shows up and the attendance/commission
   SCOPE used to compute their pay:
   - A branch group (e.g. "Crown Head Spa Biñan") includes Weekly-schedule
     staff assigned to that branch, and only counts attendance/commission
     recorded AT that branch — a staff assigned to both branches gets a
     fully separate row (and DTR) in each branch's group. Commission always
     stays fully attributed to whichever branch the sale happened at, but
     Daily Rate/Meal Allowance/Overtime are whole-DAY amounts — if that
     person clocks hours at BOTH branches on the same date, each row only
     gets its share of that day's amount (split by hour share), so the two
     rows never add up to more than one day's pay (see computeStaffPayroll).
   - "Admin Staff" includes Bi-Monthly-schedule staff (not hidden), and
     counts attendance/commission across ALL branches.
   ========================================================================== */

const PAYROLL_RATES_KEY = "crownPayrollRates";
const PAYROLL_ADJUSTMENTS_KEY = "crownPayrollAdjustments";
const PAYROLL_STATUS_KEY = "crownPayrollStatus";
const PAYROLL_REFERENCE_KEY = "crownPayrollReferences";
const PAYROLL_ATTENDANCE_KEY = "crownAttendanceLog";
const PAYROLL_DUTY_LOG_KEY = "crownDutyLog";
const PAYROLL_SALES_PREFIX = "crownDailySales_";
const PAYROLL_SERVICE_KEY = "crownServiceMasterList";
const BRANCH_MASTER_KEY = "crownBranchMasterList";

const ADMIN_GROUP_KEY = "Admin Staff";
const STANDARD_DAILY_HOURS = 8;

/* Therapist shift rule: 8 working hours + 1 hour break = 9 hours before
   Meal Allowance kicks in; Overtime Meal Allowance only past 9h15m. */
const THERAPIST_SHIFT_HOURS = 9;
const THERAPIST_OT_THRESHOLD_HOURS = 9.25;

/* Receptionist / Marketing Agent shift rule: same 8 working hours + 1 hour
   break = 9 hours, but these roles have no Meal Allowance. Instead the
   Daily Rate itself is prorated when under 9 hours (hourly rate x hours
   worked minus the 1-hour break), paid in full at/above 9 hours, and hours
   worked past 9 earn Overtime at 125% of the hourly rate (dailyRate / 8). */
const OVERTIME_SHIFT_ROLES = ["Receptionist", "Marketing Agent"];
const OVERTIME_SHIFT_HOURS = 9;
const OVERTIME_SHIFT_BREAK_HOURS = 1;
const OVERTIME_RATE_MULTIPLIER = 1.25;

/* Opening (9am-6pm) and Closing (1pm-10pm) shifts — picked once at the
   day's first clock-in (see clock-widget.js), independent of role/duty.
   Staff sometimes arrive at the branch well before their actual shift
   starts; that early time isn't paid, so getDayAttendance() below clamps
   an entry's counted hours to start no earlier than its shift's official
   start. Both shifts are exactly 9 hours long — the same length already
   used by THERAPIST_SHIFT_HOURS/OVERTIME_SHIFT_HOURS above — so clamping
   the START is all that's needed for every existing threshold formula to
   naturally treat "worked past the shift's official end time" as
   overtime, with no separate threshold system required. */
const SHIFT_SCHEDULES = {
    Opening: { start: "09:00", end: "18:00" },
    Closing: { start: "13:00", end: "22:00" }
};

function usesOvertimeShiftRule(role){
    return OVERTIME_SHIFT_ROLES.includes(role);
}

/* A Therapist with Receptionist enabled as a secondary role (max 2 roles
   per account) picks their duty for the day at login — see login.js.
   Payroll looks that choice up per date so a single account's DTR can
   mix Therapist-formula days and Receptionist-formula days within the
   same pay period. */
function isDualRoleTherapist(user){
    return (
        user.role === "Therapist" &&
        user.secondaryRole === "Receptionist"
    );
}

function getDutyLog(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_DUTY_LOG_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load duty log:", error);
        return {};
    }
}

/* Which role a staff member was actually working AS on a given date.
   Defaults to their primary role when there's no duty log entry (e.g.
   a dual-role account that never picked a duty on this particular
   date, or any non-dual-role account). */
function getEffectiveRoleForDate(user, date){
    if(!isDualRoleTherapist(user)){
        return user.role;
    }

    const logged =
        getDutyLog()[user.id + "_" + date];

    return logged === "Receptionist" ? "Receptionist" : "Therapist";
}

let currentPayslipContext = null;
let currentPayrollSummaryContext = null;

/* Admin/Executive Assistant manage payroll for everyone; Receptionist
   and Therapist only ever see their own generated payslips. */
function canManagePayroll(){
    const role =
        window.CrownAuth?.getCurrentUser?.()?.role;

    return role === "Admin" || role === "Executive Assistant";
}

document.addEventListener("DOMContentLoaded", function(){
    document.getElementById("closePayslipBtn")
        .addEventListener("click", closePayslipModal);

    document.getElementById("closePayslipFooterBtn")
        .addEventListener("click", closePayslipModal);

    document.getElementById("savePayslipAdjustmentBtn")
        .addEventListener("click", savePayslipAdjustment);

    document.getElementById("payslipStatusBtn")
        .addEventListener("click", togglePayslipStatus);

    document.getElementById("exportPayslipPdfBtn")
        .addEventListener("click", exportPayslipPdf);

    document.getElementById("exportPayrollSummaryPdfBtn")
        .addEventListener("click", exportPayrollSummaryPdf);

    document.getElementById("payslipBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                this.classList.add("d-none");
            }
        });

    if(canManagePayroll()){
        initializeAdminView();
    }else{
        initializeMyPayrollView();
    }
});

function initializeAdminView(){
    document.getElementById("payrollAdminControls").classList.remove("d-none");
    document.getElementById("periodInfo").classList.remove("d-none");
    document.getElementById("payrollSummaryCard").classList.remove("d-none");

    initializeDates();
    populateGroupDropdown();
    populateRateSetupDropdown();
    renderPayroll();

    document.getElementById("payrollStartDate")
        .addEventListener("change", renderPayroll);

    document.getElementById("payrollEndDate")
        .addEventListener("change", renderPayroll);

    document.getElementById("payrollGroup")
        .addEventListener("change", renderPayroll);

    document.getElementById("rateSetupEditBtn")
        .addEventListener("click", function(){
            openRateSetupModal(
                document.getElementById("rateSetupStaffSelect").value
            );
        });

    document.getElementById("closeRateSetupBtn")
        .addEventListener("click", closeRateSetupModal);

    document.getElementById("cancelRateSetupBtn")
        .addEventListener("click", closeRateSetupModal);

    document.getElementById("saveRateSetupBtn")
        .addEventListener("click", saveRateSetup);

    document.getElementById("rateBankType")
        .addEventListener("change", updateBankOtherFieldState);

    document.getElementById("rateSetupBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                this.classList.add("d-none");
            }
        });

    window.addEventListener("crownCloudUpdate", function(event){
        const keys = event.detail?.keys || [];

        if(
            keys.includes(PAYROLL_ATTENDANCE_KEY) ||
            keys.some(function(key){ return key.startsWith(PAYROLL_SALES_PREFIX); }) ||
            keys.includes(PAYROLL_RATES_KEY) ||
            keys.includes(PAYROLL_ADJUSTMENTS_KEY) ||
            keys.includes(PAYROLL_STATUS_KEY) ||
            keys.includes(PAYROLL_DUTY_LOG_KEY)
        ){
            renderPayroll();
        }
    });
}

function initializeMyPayrollView(){
    document.getElementById("myPayrollCard").classList.remove("d-none");

    renderMyPayroll();

    window.addEventListener("crownCloudUpdate", function(event){
        const keys = event.detail?.keys || [];

        if(
            keys.includes(PAYROLL_STATUS_KEY) ||
            keys.includes(PAYROLL_ADJUSTMENTS_KEY)
        ){
            renderMyPayroll();
        }
    });
}

/* ---------- Helpers ---------- */

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* Falls back to the login account name for staff created before the
   Personal Information fields existed. */
function getFullName(user){
    const fullName =
        [user?.firstName, user?.middleName, user?.lastName]
            .map(function(part){ return String(part || "").trim(); })
            .filter(Boolean)
            .join(" ");

    return fullName || user?.account || "";
}

function peso(amount){
    return "₱" + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/* jsPDF's built-in helvetica font has no ₱ glyph — it prints as a
   garbled replacement character. Use "PHP" instead for anything
   drawn on the PDF (screen display keeps using peso() above). */
function pesoPdf(amount){
    return "PHP " + (Number(amount) || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function toDateString(date){
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatDateLabel(dateValue){
    if(!dateValue){
        return "—";
    }

    return new Date(dateValue + "T00:00:00")
        .toLocaleDateString("en-PH", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric"
        });
}

function formatTimeLabel(isoString){
    if(!isoString){
        return "—";
    }

    return new Date(isoString).toLocaleTimeString("en-PH", {
        hour: "numeric",
        minute: "2-digit"
    });
}

function getDateRange(start, end){
    const dates = [];

    if(!start || !end || start > end){
        return dates;
    }

    let cursor = new Date(start + "T00:00:00");
    const last = new Date(end + "T00:00:00");

    while(cursor <= last){
        dates.push(toDateString(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
}

/* ---------- Period controls ---------- */

function initializeDates(){
    const today = new Date();
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(today.getDate() - 13);

    document.getElementById("payrollStartDate").value =
        toDateString(twoWeeksAgo);

    document.getElementById("payrollEndDate").value =
        toDateString(today);
}

function getSelectedPeriod(){
    const start =
        document.getElementById("payrollStartDate").value;

    const end =
        document.getElementById("payrollEndDate").value;

    if(!start || !end || start > end){
        return null;
    }

    return {
        start: start,
        end: end,
        label:
            formatDateLabel(start) +
            " – " +
            formatDateLabel(end)
    };
}

/* ---------- Branches + Payroll Group ---------- */

function getBranchNames(){
    try{
        const raw =
            localStorage.getItem(BRANCH_MASTER_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        return (Array.isArray(parsed) ? parsed : [])
            .map(function(branch){
                return typeof branch === "string"
                    ? branch
                    : branch?.name;
            })
            .filter(Boolean);
    }catch(error){
        console.error("Unable to load branches:", error);
        return [];
    }
}

function populateGroupDropdown(){
    const select =
        document.getElementById("payrollGroup");

    const branches =
        getBranchNames();

    select.innerHTML =
        branches.map(function(branch){
            return `<option value="${escapeHtml(branch)}">${escapeHtml(branch)}</option>`;
        }).join("") +
        `<option value="${escapeHtml(ADMIN_GROUP_KEY)}">Admin Staff</option>`;
}

/* ---------- Staff accounts ---------- */

function getAllStaffAccounts(){
    return CrownAuth.getUsers().filter(function(user){
        return (
            user.status === "Active" &&
            user.role !== "Admin"
        );
    });
}

function getGroupStaff(groupKey){
    const all =
        getAllStaffAccounts();

    if(groupKey === ADMIN_GROUP_KEY){
        return all.filter(function(user){
            return (
                user.compensationSchedule === "Bi-Monthly" &&
                user.hiddenFromAdminGroup !== true
            );
        });
    }

    return all.filter(function(user){
        return (
            user.compensationSchedule !== "Bi-Monthly" &&
            Array.isArray(user.branches) &&
            user.branches.includes(groupKey)
        );
    });
}

/* ---------- Individual Rate Setup ---------- */

function getPayrollRates(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_RATES_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll rates:", error);
        return {};
    }
}

function savePayrollRates(rates){
    localStorage.setItem(
        PAYROLL_RATES_KEY,
        JSON.stringify(rates)
    );
}

function getStaffRate(userId){
    const saved =
        getPayrollRates()[userId] || {};

    return {
        dailyRate: Number(saved.dailyRate) || 0,
        mealAllowance: Number(saved.mealAllowance) || 0,
        otMealAllowance: Number(saved.otMealAllowance) || 0,
        secondaryDailyRate: Number(saved.secondaryDailyRate) || 0,
        bankType: saved.bankType || "GoTyme",
        bankTypeOther: saved.bankTypeOther || "",
        accountName: saved.accountName || "",
        accountNumber: saved.accountNumber || ""
    };
}

function formatBankLabel(rate){
    return rate.bankType === "Others"
        ? (rate.bankTypeOther || "Others")
        : rate.bankType;
}

function populateRateSetupDropdown(){
    const select =
        document.getElementById("rateSetupStaffSelect");

    const staff =
        getAllStaffAccounts()
            .slice()
            .sort(function(a, b){
                return a.account.localeCompare(b.account);
            });

    select.innerHTML = staff.map(function(user){
        return `<option value="${escapeHtml(user.id)}">${escapeHtml(getFullName(user))} — ${escapeHtml(user.role)}</option>`;
    }).join("");
}

function updateBankOtherFieldState(){
    document.getElementById("rateBankOtherWrapper")
        .classList.toggle(
            "d-none",
            document.getElementById("rateBankType").value !== "Others"
        );
}

function openRateSetupModal(userId){
    const user =
        CrownAuth.getUsers().find(function(item){
            return item.id === userId;
        });

    if(!user){
        alert("Please select a staff member first.");
        return;
    }

    const rate =
        getStaffRate(userId);

    document.getElementById("rateSetupModalTitle").textContent =
        "Individual Rate Setup — " + getFullName(user);

    document.getElementById("rateDailyRate").value =
        rate.dailyRate || "";

    document.getElementById("rateMealAllowance").value =
        rate.mealAllowance || "";

    document.getElementById("rateOtMealAllowance").value =
        rate.otMealAllowance || "";

    document.getElementById("rateSecondaryDailyRate").value =
        rate.secondaryDailyRate || "";

    document.getElementById("rateSecondaryDailyRateWrapper")
        .classList.toggle("d-none", user.secondaryRole !== "Receptionist");

    document.getElementById("rateBankType").value =
        rate.bankType;

    document.getElementById("rateBankOther").value =
        rate.bankTypeOther;

    document.getElementById("rateAccountName").value =
        rate.accountName;

    document.getElementById("rateAccountNumber").value =
        rate.accountNumber;

    updateBankOtherFieldState();

    document.getElementById("rateSetupBackdrop").dataset.userId = userId;
    document.getElementById("rateSetupBackdrop").classList.remove("d-none");
}

function closeRateSetupModal(){
    document.getElementById("rateSetupBackdrop").classList.add("d-none");
}

function saveRateSetup(){
    const userId =
        document.getElementById("rateSetupBackdrop").dataset.userId;

    if(!userId){
        return;
    }

    const bankType =
        document.getElementById("rateBankType").value;

    const rates =
        getPayrollRates();

    rates[userId] = {
        dailyRate: Number(document.getElementById("rateDailyRate").value) || 0,
        mealAllowance: Number(document.getElementById("rateMealAllowance").value) || 0,
        otMealAllowance: Number(document.getElementById("rateOtMealAllowance").value) || 0,
        secondaryDailyRate: Number(document.getElementById("rateSecondaryDailyRate").value) || 0,
        bankType: bankType,
        bankTypeOther:
            bankType === "Others"
                ? document.getElementById("rateBankOther").value.trim()
                : "",
        accountName: document.getElementById("rateAccountName").value.trim(),
        accountNumber: document.getElementById("rateAccountNumber").value.trim()
    };

    savePayrollRates(rates);
    closeRateSetupModal();
    renderPayroll();
}

/* ---------- Attendance ---------- */

function getAttendanceEntries(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_ATTENDANCE_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load attendance:", error);
        return [];
    }
}

/* Returns {timeIn, timeOut, hours, dutyHours, dominantRole, mixedDuty}
   for one staff member on one date, optionally scoped to a single
   branch (branchFilter === null means count attendance from any
   branch — used for the Admin Staff group).

   dominantRole/mixedDuty exist for dual-role Therapist+Receptionist
   accounts: each attendance session can carry its own entry.dutyRole
   (stamped at clock-in by clock-widget.js, or chosen per-entry in the
   attendance.js manual-correction modal), so a staff member who works
   BOTH duties on the same date has their hours split into two buckets
   here instead of one day-level lookup deciding the whole day (the
   previous behavior, which mis-priced whichever session didn't match
   the last-picked duty). Sessions saved before this field existed (or
   any non-dual-role account) have no entry.dutyRole, so they fall
   back to `fallbackRole` — computeStaffPayroll passes in that day's
   getEffectiveRoleForDate() value, preserving old behavior for them.
   The whole day still runs through ONE formula (whichever role has
   the most hours "wins" for Daily Rate/Meal Allowance/Overtime
   purposes) rather than prorating pay across both — see the payslip's
   "Mixed" duty badge for a visible flag when this happens, since it's
   expected to be rare and worth a human glance rather than a fully
   split formula. */
function getDayAttendance(userId, date, branchFilter, fallbackRole){
    const entries =
        getAttendanceEntries().filter(function(entry){
            return (
                entry.userId === userId &&
                entry.date === date &&
                (!branchFilter || entry.branch === branchFilter)
            );
        });

    if(entries.length === 0){
        return {
            timeIn: "",
            timeOut: "",
            hours: 0,
            dutyHours: {},
            dominantRole: fallbackRole || null,
            mixedDuty: false,
            shiftType: ""
        };
    }

    const clockIns =
        entries
            .map(function(entry){ return entry.clockInAt; })
            .filter(Boolean)
            .sort();

    const completed =
        entries.filter(function(entry){
            return entry.clockInAt && entry.clockOutAt;
        });

    const clockOuts =
        completed
            .map(function(entry){ return entry.clockOutAt; })
            .sort();

    const dutyHours = {};
    let hours = 0;

    completed.forEach(function(entry){
        const schedule =
            SHIFT_SCHEDULES[entry.shiftType];

        /* Clamp the counted clock-in to the shift's official start —
           arriving early doesn't add paid hours. Only affects entries
           tagged with a recognized shiftType; untagged (legacy/manual)
           entries keep using their raw clock-in, unchanged. */
        const clockInForPay =
            schedule
                ? new Date(Math.max(
                    new Date(entry.clockInAt).getTime(),
                    new Date(`${entry.date}T${schedule.start}:00`).getTime()
                ))
                : new Date(entry.clockInAt);

        const entryHours =
            Math.max(
                0,
                (new Date(entry.clockOutAt) - clockInForPay) / 3600000
            );

        hours += entryHours;

        const role =
            entry.dutyRole || fallbackRole || "Therapist";

        dutyHours[role] = (dutyHours[role] || 0) + entryHours;
    });

    const dutyRoles =
        Object.keys(dutyHours);

    const dominantRole =
        dutyRoles.length === 0
            ? (fallbackRole || null)
            : dutyRoles.reduce(function(best, role){
                return dutyHours[role] > (dutyHours[best] || 0)
                    ? role
                    : best;
            }, dutyRoles[0]);

    const shiftType =
        completed
            .map(function(entry){ return entry.shiftType; })
            .find(Boolean) || "";

    return {
        timeIn: clockIns[0] || "",
        timeOut: clockOuts.length ? clockOuts[clockOuts.length - 1] : "",
        hours: hours,
        dutyHours: dutyHours,
        dominantRole: dominantRole,
        mixedDuty: dutyRoles.length > 1,
        shiftType: shiftType
    };
}

/* ---------- Commissions ---------- */

/* Per-service metadata needed to compute commission: the normal
   Therapist Commission %, the Overtime Commission % (used instead of
   the normal rate once the service is rendered past the therapist's
   shift), and Duration (minutes, used with a service item's own
   serviceStartTime to find when the service ends). */
function getServiceMasterMeta(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_SERVICE_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        const meta = {};

        (Array.isArray(parsed) ? parsed : []).forEach(function(item){
            if(typeof item === "object" && item?.name){
                meta[item.name] = {
                    commission:
                        Number(
                            item.commission ??
                            item.therapistCommission ??
                            0
                        ) || 0,
                    overtimeCommission:
                        Number(item.overtimeCommission ?? 0) || 0,
                    duration:
                        Number(item.duration) || 0
                };
            }
        });

        return meta;
    }catch(error){
        console.error("Unable to load service master:", error);
        return {};
    }
}

/* Commission earned by the linked therapist name on ONE date, optionally
   scoped to a single branch (null = all branches, for Admin Staff).
   shiftType (e.g. "Opening"/"Closing", from that date's getDayAttendance)
   locates the therapist's official shift end via SHIFT_SCHEDULES — a
   service item whose end time (its own serviceStartTime + the service's
   Duration) falls after that shift end earns Overtime Commission instead
   of the normal rate. Items saved before serviceStartTime existed (or on
   a day with no recognized shiftType) simply fall back to the normal
   rate, since there's nothing to compare against. */
function getDayCommission(therapistName, date, branchFilter, shiftType){
    if(!therapistName){
        return 0;
    }

    const branches =
        branchFilter ? [branchFilter] : getBranchNames();

    const serviceMeta =
        getServiceMasterMeta();

    const shiftSchedule =
        SHIFT_SCHEDULES[shiftType];

    const shiftEndAt =
        shiftSchedule
            ? new Date(`${date}T${shiftSchedule.end}:00`)
            : null;

    let total = 0;

    branches.forEach(function(branch){
        const key =
            PAYROLL_SALES_PREFIX + branch + "_" + date;

        let record;

        try{
            record = JSON.parse(localStorage.getItem(key));
        }catch(error){
            return;
        }

        const rows =
            (Array.isArray(record?.rows) ? record.rows : [])
                .filter(function(sale){
                    return sale.settled !== false;
                });

        rows.forEach(function(sale){
            const items =
                Array.isArray(sale?.services) ? sale.services : [];

            items.forEach(function(item){
                const assignedTherapist =
                    String(item?.therapist || sale?.therapist || "").trim();

                if(assignedTherapist !== therapistName){
                    return;
                }

                const itemType =
                    item?.itemType ||
                    (
                        String(item?.productKind || "").includes("Voucher")
                            ? "Product"
                            : "Service"
                    );

                if(itemType !== "Service"){
                    return;
                }

                const meta =
                    serviceMeta[item?.name] || {};

                /* A Freebie's amount is always 0 (it's excluded from the
                   client's total) — its real value, and the commission
                   basis, lives in freebieValue instead. */
                const amount =
                    item?.isFreebie
                        ? (Number(item?.freebieValue) || 0)
                        : (Number(item?.amount) || 0);

                let rate =
                    meta.commission || 0;

                if(
                    shiftEndAt &&
                    item?.serviceStartTime &&
                    meta.duration > 0
                ){
                    const serviceEndAt =
                        new Date(`${date}T${item.serviceStartTime}:00`);

                    serviceEndAt.setMinutes(
                        serviceEndAt.getMinutes() + meta.duration
                    );

                    if(serviceEndAt.getTime() > shiftEndAt.getTime()){
                        rate = meta.overtimeCommission || 0;
                    }
                }

                total += amount * (rate / 100);
            });
        });
    });

    return total;
}

/* ---------- Adjustments + Status ---------- */

function compositeKey(userId, groupKey, period){
    return [userId, groupKey, period.start, period.end].join("::");
}

function getAdjustments(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_ADJUSTMENTS_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll adjustments:", error);
        return {};
    }
}

function saveAdjustments(adjustments){
    localStorage.setItem(
        PAYROLL_ADJUSTMENTS_KEY,
        JSON.stringify(adjustments)
    );
}

function getAdjustment(userId, groupKey, period){
    const saved =
        getAdjustments()[compositeKey(userId, groupKey, period)];

    return {
        additionalPay: Number(saved?.additionalPay) || 0,
        additionalPayNote: saved?.additionalPayNote || "",
        deduction: Number(saved?.deduction) || 0,
        deductionNote: saved?.deductionNote || ""
    };
}

function getStatuses(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_STATUS_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll status:", error);
        return {};
    }
}

function saveStatuses(statuses){
    localStorage.setItem(
        PAYROLL_STATUS_KEY,
        JSON.stringify(statuses)
    );
}

function getStatus(userId, groupKey, period){
    const statuses =
        getStatuses();

    return statuses[compositeKey(userId, groupKey, period)] === "Paid"
        ? "Paid"
        : "Pending";
}

/* ---------- Payslip reference number ---------- */

/* Unambiguous alphabet: no 0/O/1/I/L, easy to read off a printed slip. */
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function getReferences(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_REFERENCE_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payslip references:", error);
        return {};
    }
}

function saveReferences(references){
    localStorage.setItem(
        PAYROLL_REFERENCE_KEY,
        JSON.stringify(references)
    );
}

function getPayslipReference(userId, groupKey, period){
    return getReferences()[compositeKey(userId, groupKey, period)] || "";
}

/* One reference number is issued the first time a payslip is generated
   (status set to Paid) and stays fixed after that, even if the status is
   later reverted to Pending — it identifies that specific payslip run. */
function ensurePayslipReference(userId, groupKey, period){
    const key =
        compositeKey(userId, groupKey, period);

    const references =
        getReferences();

    if(references[key]){
        return references[key];
    }

    const used =
        new Set(Object.values(references));

    let reference = "";

    for(let attempt = 0; attempt < 50; attempt++){
        let body = "";

        for(let i = 0; i < 6; i++){
            body += REFERENCE_ALPHABET.charAt(
                Math.floor(Math.random() * REFERENCE_ALPHABET.length)
            );
        }

        const candidate = "PS-" + body;

        if(!used.has(candidate)){
            reference = candidate;
            break;
        }
    }

    if(!reference){
        reference = "PS-" + Date.now().toString(36).toUpperCase();
    }

    references[key] = reference;
    saveReferences(references);

    return reference;
}

/* ---------- Payroll computation ---------- */

function computeStaffPayroll(user, groupKey, period){
    const rate =
        getStaffRate(user.id);

    const branchFilter =
        groupKey === ADMIN_GROUP_KEY ? null : groupKey;

    /* A staff assigned to 2 branches gets a fully separate payroll row per
       branch (see file header). The Daily Rate / Meal Allowance / Overtime
       are all whole-DAY amounts, though — if the same person clocks hours
       at both branches on the same date, each branch's row must only pay
       its SHARE of that one day's amount, not the full amount twice. */
    const isMultiBranchStaff =
        Array.isArray(user.branches) && user.branches.length > 1;

    const dates =
        getDateRange(period.start, period.end);

    const days =
        dates.map(function(date){
            /* Fallback for sessions with no entry.dutyRole of their own
               (saved before that field existed) — matches the old,
               purely day-level lookup so those entries behave exactly
               as before. */
            const fallbackRole =
                getEffectiveRoleForDate(user, date);

            const attendance =
                getDayAttendance(user.id, date, branchFilter, fallbackRole);

            const dayAttendance =
                (branchFilter && isMultiBranchStaff)
                    ? getDayAttendance(user.id, date, null, fallbackRole)
                    : attendance;

            const totalHours =
                dayAttendance.hours;

            /* This branch's share of the day's total hours — 1 whenever
               all of that day's hours were at this branch (the normal
               case), less than 1 only on a day actually split across
               both branches, so the two rows' shares add up to 1. */
            const branchShare =
                totalHours > 0
                    ? Math.min(1, attendance.hours / totalHours)
                    : 0;

            const worked =
                totalHours > 0;

            let dailyRateAmount = 0;
            let mealAllowanceAmount = 0;
            let overtimeAmount = 0;

            /* Whichever duty has the most hours that day decides the
               formula for the WHOLE day (see getDayAttendance's header
               comment) — dayAttendance.mixedDuty flags when a day
               actually mixed both duties, so the payslip can show a
               "Mixed" badge instead of silently picking one. */
            const effectiveRole =
                dayAttendance.dominantRole || fallbackRole;

            /* Dual-role Therapist on Receptionist duty that day uses
               the Secondary Role Daily Rate instead of their normal
               Therapist Daily Rate; everyone else always uses dailyRate. */
            const applicableDailyRate =
                isDualRoleTherapist(user) && effectiveRole === "Receptionist"
                    ? rate.secondaryDailyRate
                    : rate.dailyRate;

            if(worked){
                if(usesOvertimeShiftRule(effectiveRole)){
                    const hourlyRate =
                        applicableDailyRate / 8;

                    dailyRateAmount =
                        (
                            totalHours >= OVERTIME_SHIFT_HOURS
                                ? applicableDailyRate
                                : hourlyRate * Math.max(0, totalHours - OVERTIME_SHIFT_BREAK_HOURS)
                        ) * branchShare;

                    if(totalHours > OVERTIME_SHIFT_HOURS){
                        overtimeAmount =
                            hourlyRate *
                            OVERTIME_RATE_MULTIPLIER *
                            (totalHours - OVERTIME_SHIFT_HOURS) *
                            branchShare;
                    }
                }else{
                    dailyRateAmount = applicableDailyRate * branchShare;

                    if(effectiveRole === "Therapist"){
                        let wholeDayMealAllowance = 0;

                        if(totalHours >= THERAPIST_SHIFT_HOURS){
                            wholeDayMealAllowance += rate.mealAllowance;
                        }

                        if(totalHours > THERAPIST_OT_THRESHOLD_HOURS){
                            wholeDayMealAllowance += rate.otMealAllowance;
                        }

                        mealAllowanceAmount = wholeDayMealAllowance * branchShare;
                    }else{
                        const wholeDayMealAllowance =
                            rate.mealAllowance +
                            (
                                totalHours > STANDARD_DAILY_HOURS
                                    ? rate.otMealAllowance
                                    : 0
                            );

                        mealAllowanceAmount = wholeDayMealAllowance * branchShare;
                    }
                }
            }

            const commission =
                getDayCommission(
                    user.therapistName,
                    date,
                    branchFilter,
                    attendance.shiftType
                );

            return {
                date: date,
                timeIn: attendance.timeIn,
                timeOut: attendance.timeOut,
                hours: attendance.hours,
                effectiveRole: effectiveRole,
                mixedDuty: dayAttendance.mixedDuty,
                shiftType: attendance.shiftType,
                dailyRateAmount: dailyRateAmount,
                mealAllowanceAmount: mealAllowanceAmount,
                overtimeAmount: overtimeAmount,
                commission: commission
            };
        });

    const dailyRateTotal =
        days.reduce(function(sum, day){ return sum + day.dailyRateAmount; }, 0);

    const mealAllowanceTotal =
        days.reduce(function(sum, day){ return sum + day.mealAllowanceAmount; }, 0);

    const overtimeTotal =
        days.reduce(function(sum, day){ return sum + day.overtimeAmount; }, 0);

    const commissionTotal =
        days.reduce(function(sum, day){ return sum + day.commission; }, 0);

    const grossTotal =
        dailyRateTotal + mealAllowanceTotal + overtimeTotal + commissionTotal;

    const adjustment =
        getAdjustment(user.id, groupKey, period);

    const netTotal =
        Math.max(
            0,
            grossTotal + adjustment.additionalPay - adjustment.deduction
        );

    return {
        user: user,
        rate: rate,
        days: days,
        dailyRateTotal: dailyRateTotal,
        mealAllowanceTotal: mealAllowanceTotal,
        overtimeTotal: overtimeTotal,
        commissionTotal: commissionTotal,
        grossTotal: grossTotal,
        adjustment: adjustment,
        netTotal: netTotal
    };
}

/* ---------- Rendering: summary table ---------- */

function renderPayroll(){
    const period =
        getSelectedPeriod();

    const groupKey =
        document.getElementById("payrollGroup").value;

    const info =
        document.getElementById("periodInfo");

    if(!period){
        info.textContent = "Please select a valid Start Date and End Date.";
        return;
    }

    info.innerHTML =
        `<strong>${period.label}</strong>`;

    const groupLabel =
        groupKey === ADMIN_GROUP_KEY ? "Admin Staff" : groupKey;

    document.getElementById("payrollGroupTitle").textContent =
        groupLabel;

    document.getElementById("payrollSubtitle").textContent =
        period.label;

    const staff =
        getGroupStaff(groupKey)
            .slice()
            .sort(function(a, b){
                return a.account.localeCompare(b.account);
            });

    currentPayrollSummaryContext = {
        groupKey: groupKey,
        period: period,
        groupLabel: groupLabel,
        staff: staff
    };

    const tbody =
        document.getElementById("payrollBody");

    tbody.innerHTML = "";

    document.getElementById("payrollEmptyState")
        .classList.toggle("d-none", staff.length > 0);

    staff.forEach(function(user){
        const result =
            computeStaffPayroll(user, groupKey, period);

        const status =
            getStatus(user.id, groupKey, period);

        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td class="payroll-staff-cell">
                ${escapeHtml(getFullName(user))}
                <small>${escapeHtml(user.role)}${user.therapistName ? " · " + escapeHtml(user.therapistName) : ""}</small>
            </td>

            <td class="payroll-salary-cell">${peso(result.netTotal)}</td>

            <td class="payroll-bank-cell">
                ${
                    result.rate.accountName
                        ? `
                            ${escapeHtml(formatBankLabel(result.rate))}
                            <small>${escapeHtml(result.rate.accountName)} · ${escapeHtml(result.rate.accountNumber || "—")}</small>
                          `
                        : '<span class="text-muted">Not set</span>'
                }
            </td>

            <td>
                <span class="payroll-status-badge payroll-status-${status.toLowerCase()}">
                    ${status}
                </span>
            </td>

            <td>
                <button type="button" class="btn btn-sm btn-outline-primary view-payslip-btn">
                    View
                </button>
            </td>
        `;

        row.querySelector(".view-payslip-btn")
            .addEventListener("click", function(){
                openPayslipModal(user, groupKey, period);
            });

        tbody.appendChild(row);
    });
}

/* ---------- My Payroll (Receptionist / Therapist, own records only) ---------- */

function renderMyPayroll(){
    const sessionUser =
        window.CrownAuth?.getCurrentUser?.();

    const user =
        sessionUser &&
        CrownAuth.getUsers().find(function(item){
            return item.id === sessionUser.id;
        });

    const tbody =
        document.getElementById("myPayrollBody");

    tbody.innerHTML = "";

    if(!user){
        document.getElementById("myPayrollEmptyState").classList.remove("d-none");
        return;
    }

    const prefix =
        user.id + "::";

    const statuses =
        getStatuses();

    const records =
        Object.keys(statuses)
            .filter(function(key){
                return key.startsWith(prefix);
            })
            .map(function(key){
                const parts =
                    key.slice(prefix.length).split("::");

                return {
                    groupKey: parts[0],
                    start: parts[1],
                    end: parts[2],
                    status: statuses[key] === "Paid" ? "Paid" : "Pending"
                };
            })
            .filter(function(record){
                return record.start && record.end;
            })
            .sort(function(a, b){
                return b.start.localeCompare(a.start);
            });

    document.getElementById("myPayrollEmptyState")
        .classList.toggle("d-none", records.length > 0);

    records.forEach(function(record){
        const period = {
            start: record.start,
            end: record.end,
            label: formatDateLabel(record.start) + " – " + formatDateLabel(record.end)
        };

        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td>${period.label}</td>

            <td>
                <span class="payroll-status-badge payroll-status-${record.status.toLowerCase()}">
                    ${record.status}
                </span>
            </td>

            <td>
                <button type="button" class="btn btn-sm btn-outline-primary view-payslip-btn">
                    View
                </button>
            </td>
        `;

        row.querySelector(".view-payslip-btn")
            .addEventListener("click", function(){
                openPayslipModal(user, record.groupKey, period);
            });

        tbody.appendChild(row);
    });
}

/* ---------- Rendering: payslip modal ---------- */

function openPayslipModal(user, groupKey, period){
    currentPayslipContext = { userId: user.id, groupKey: groupKey, period: period };

    const result =
        computeStaffPayroll(user, groupKey, period);

    document.getElementById("payslipName").textContent =
        getFullName(user);

    document.getElementById("payslipRole").textContent =
        user.role;

    document.getElementById("payslipBranch").textContent =
        groupKey === ADMIN_GROUP_KEY ? "Admin Staff (All Branches)" : groupKey;

    document.getElementById("payslipPeriod").textContent =
        period.label;

    const showDutyBadge =
        isDualRoleTherapist(user);

    document.getElementById("payslipBody").innerHTML =
        result.days.map(function(day){
            const dutyBadge =
                showDutyBadge
                    ? (
                        day.mixedDuty
                            ? `<br><span class="payslip-duty-badge payslip-duty-mixed" title="Both duties were clocked this day — priced as ${escapeHtml(day.effectiveRole)} (majority of hours). Review if this looks wrong.">Mixed (${escapeHtml(day.effectiveRole)})</span>`
                            : `<br><span class="payslip-duty-badge ${day.effectiveRole === "Receptionist" ? "payslip-duty-receptionist" : "payslip-duty-therapist"}">${escapeHtml(day.effectiveRole)}</span>`
                    )
                    : "";

            const shiftBadge =
                day.shiftType
                    ? `<br><span class="payslip-shift-badge" title="Hours for this day are clamped to the ${escapeHtml(day.shiftType)} schedule (${escapeHtml(SHIFT_SCHEDULES[day.shiftType].start)}–${escapeHtml(SHIFT_SCHEDULES[day.shiftType].end)}).">${escapeHtml(day.shiftType)}</span>`
                    : "";

            return `
                <tr>
                    <td>${formatDateLabel(day.date)}${dutyBadge}${shiftBadge}</td>
                    <td>${formatTimeLabel(day.timeIn)}</td>
                    <td>${formatTimeLabel(day.timeOut)}</td>
                    <td>${peso(day.dailyRateAmount)}</td>
                    <td>${peso(day.mealAllowanceAmount)}</td>
                    <td>${peso(day.overtimeAmount)}</td>
                    <td>${day.commission > 0 ? peso(day.commission) : "—"}</td>
                </tr>
            `;
        }).join("");

    /* Dual-role Therapist+Receptionist accounts use rate.secondaryDailyRate
       on Receptionist-duty days — if that field was never set (defaults to
       0), those days silently pay ₱0 base pay. Warn before Admin/EA relies
       on this payslip. */
    const missingSecondaryRate =
        isDualRoleTherapist(user) &&
        Number(result.rate.secondaryDailyRate) <= 0 &&
        result.days.some(function(day){
            return day.effectiveRole === "Receptionist" && day.hours > 0;
        });

    const rateWarning =
        document.getElementById("payslipRateWarning");

    if(rateWarning){
        rateWarning.classList.toggle("d-none", !missingSecondaryRate);
    }

    const rateWarningText =
        document.getElementById("payslipRateWarningText");

    if(rateWarningText && missingSecondaryRate){
        rateWarningText.textContent =
            "Warning: Secondary Daily Rate (Receptionist) is not set for " +
            getFullName(user) +
            " — Receptionist-duty days in this period are being paid ₱0 base pay. Set it in Individual Rate Setup before generating payroll.";
    }

    document.getElementById("payslipAdditionalPay").value =
        result.adjustment.additionalPay || "";

    document.getElementById("payslipAdditionalPayNote").value =
        result.adjustment.additionalPayNote || "";

    document.getElementById("payslipDeduction").value =
        result.adjustment.deduction || "";

    document.getElementById("payslipDeductionNote").value =
        result.adjustment.deductionNote || "";

    const readout =
        document.getElementById("payslipAdjustmentReadout");

    const readoutLines = [];

    if(result.adjustment.additionalPay > 0){
        readoutLines.push(
            `Additional Pay: +${peso(result.adjustment.additionalPay)}` +
            (result.adjustment.additionalPayNote ? ` (${escapeHtml(result.adjustment.additionalPayNote)})` : "")
        );
    }

    if(result.adjustment.deduction > 0){
        readoutLines.push(
            `Deduction: −${peso(result.adjustment.deduction)}` +
            (result.adjustment.deductionNote ? ` (${escapeHtml(result.adjustment.deductionNote)})` : "")
        );
    }

    readout.innerHTML =
        readoutLines.length > 0
            ? readoutLines.join("<br>")
            : "No adjustment for this period.";

    renderPayslipSummary(result);
    renderPayslipReference();
    renderPayslipStatusButton();
    applyPayslipModalMode();

    document.getElementById("payslipBackdrop").classList.remove("d-none");
}

/* Admin/EA get the editable Adjustment row + the Generate/status button;
   Receptionist/Therapist viewing their own payslip get a plain
   read-only adjustment line and a status badge instead. */
function applyPayslipModalMode(){
    const editable =
        canManagePayroll();

    document.getElementById("payslipAdjustmentRow")
        .classList.toggle("d-none", !editable);

    document.getElementById("payslipAdjustmentReadout")
        .classList.toggle("d-none", editable);

    document.getElementById("payslipStatusBtn")
        .classList.toggle("d-none", !editable);

    document.getElementById("payslipStatusReadout")
        .classList.toggle("d-none", editable);
}

function renderPayslipSummary(result){
    document.getElementById("payslipDailyRateTotal").textContent =
        peso(result.dailyRateTotal);

    document.getElementById("payslipMealAllowanceTotal").textContent =
        peso(result.mealAllowanceTotal);

    document.getElementById("payslipOvertimeTotal").textContent =
        peso(result.overtimeTotal);

    document.getElementById("payslipCommissionTotal").textContent =
        peso(result.commissionTotal);

    document.getElementById("payslipGrossTotal").textContent =
        peso(result.grossTotal);

    document.getElementById("payslipAdditionalPayTotal").textContent =
        peso(result.adjustment.additionalPay);

    document.getElementById("payslipDeductionTotal").textContent =
        peso(result.adjustment.deduction);

    document.getElementById("payslipNetTotal").textContent =
        peso(result.netTotal);
}

function renderPayslipStatusButton(){
    if(!currentPayslipContext){
        return;
    }

    const status =
        getStatus(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const button =
        document.getElementById("payslipStatusBtn");

    if(status === "Paid"){
        button.textContent = "Mark as Pending";
        button.className = "btn btn-outline-secondary";
    }else{
        button.textContent = "Generate Payroll";
        button.className = "btn btn-success";
    }

    const readout =
        document.getElementById("payslipStatusReadout");

    readout.textContent = status;
    readout.className =
        "payroll-status-badge payroll-status-" + status.toLowerCase();
}

function closePayslipModal(){
    document.getElementById("payslipBackdrop").classList.add("d-none");
    currentPayslipContext = null;
}

function savePayslipAdjustment(){
    if(!currentPayslipContext){
        return;
    }

    const additionalPay =
        Number(document.getElementById("payslipAdditionalPay").value) || 0;

    const additionalPayNote =
        document.getElementById("payslipAdditionalPayNote").value.trim();

    const deduction =
        Number(document.getElementById("payslipDeduction").value) || 0;

    const deductionNote =
        document.getElementById("payslipDeductionNote").value.trim();

    const adjustments =
        getAdjustments();

    const key =
        compositeKey(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    if(additionalPay > 0 || deduction > 0 || additionalPayNote || deductionNote){
        adjustments[key] = {
            additionalPay: additionalPay,
            additionalPayNote: additionalPayNote,
            deduction: deduction,
            deductionNote: deductionNote
        };
    }else{
        delete adjustments[key];
    }

    saveAdjustments(adjustments);

    const user =
        CrownAuth.getUsers().find(function(item){
            return item.id === currentPayslipContext.userId;
        });

    const result =
        computeStaffPayroll(
            user,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    renderPayslipSummary(result);
    renderPayroll();
}

function exportPayrollSummaryPdf(){
    if(!currentPayrollSummaryContext){
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    const context = currentPayrollSummaryContext;

    const button =
        document.getElementById("exportPayrollSummaryPdfBtn");

    button.disabled = true;
    button.textContent = "Generating PDF...";

    try{
        const jsPDF =
            window.jspdf.jsPDF;

        const doc =
            new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4",
                compress: true
            });

        const pageWidth =
            doc.internal.pageSize.getWidth();

        doc.setFillColor(11, 24, 73);
        doc.rect(0, 0, pageWidth, 26, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("CROWN HEAD SPA", 14, 11);

        doc.setFontSize(10);
        doc.text("Payroll Summary", 14, 18);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(context.groupLabel, pageWidth - 14, 10, { align: "right" });
        doc.text(context.period.label, pageWidth - 14, 16, { align: "right" });

        let totalSalary = 0;

        const rows =
            context.staff.map(function(user){
                const result =
                    computeStaffPayroll(user, context.groupKey, context.period);

                totalSalary += result.netTotal;

                return [
                    getFullName(user),
                    pesoPdf(result.netTotal),
                    result.rate.accountName
                        ? `${formatBankLabel(result.rate)} — ${result.rate.accountName} · ${result.rate.accountNumber || "—"}`
                        : "Not set"
                ];
            });

        doc.autoTable({
            startY: 34,
            head: [["Staff's Name", "Salary", "Bank Account"]],
            body: rows,
            foot: [["Total Salary", pesoPdf(totalSalary), ""]],
            theme: "grid",
            headStyles: { fillColor: [11, 24, 73], textColor: 255 },
            footStyles: { fillColor: [230, 233, 242], textColor: [11, 24, 73], fontStyle: "bold" },
            styles: { font: "helvetica", fontSize: 9, cellPadding: 3 }
        });

        doc.save(
            `Crown Head Spa - Payroll Summary - ${context.groupLabel} - ${context.period.label}.pdf`
        );
    }finally{
        button.disabled = false;
        button.textContent = "🖨 Export to PDF";
    }
}

function exportPayslipPdf(){
    if(!currentPayslipContext){
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    const user =
        CrownAuth.getUsers().find(function(item){
            return item.id === currentPayslipContext.userId;
        });

    if(!user){
        return;
    }

    const result =
        computeStaffPayroll(
            user,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const branchLabel =
        currentPayslipContext.groupKey === ADMIN_GROUP_KEY
            ? "Admin Staff (All Branches)"
            : currentPayslipContext.groupKey;

    const isTherapist =
        user.role === "Therapist";

    const button =
        document.getElementById("exportPayslipPdfBtn");

    button.disabled = true;
    button.textContent = "Generating PDF...";

    try{
        const jsPDF =
            window.jspdf.jsPDF;

        const doc =
            new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4",
                compress: true
            });

        const pageWidth =
            doc.internal.pageSize.getWidth();

        const reference =
            getPayslipReference(
                currentPayslipContext.userId,
                currentPayslipContext.groupKey,
                currentPayslipContext.period
            ) || "Not yet generated";

        const headerHeight =
            isTherapist ? 32 : 26;

        const tableStartY =
            isTherapist ? 58 : 52;

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, headerHeight, "F");

            doc.setTextColor(255, 255, 255);

            if(isTherapist){
                doc.setFont("helvetica", "bold");
                doc.setFontSize(15);
                doc.text("JS Wellness Corp.", 14, 9);

                doc.setFont("helvetica", "normal");
                doc.setFontSize(7.5);
                doc.text(
                    "Address: GF, Lourdes Building, National Highway, Biñan, Laguna",
                    14,
                    14.5
                );

                doc.setFont("helvetica", "bold");
                doc.setFontSize(9.5);
                doc.text("Service Payment Voucher", 14, 21);

                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.text(`Reference No.: ${reference}`, 14, 27);

                doc.text(branchLabel, pageWidth - 14, 9, { align: "right" });
            }else{
                doc.setFont("helvetica", "bold");
                doc.setFontSize(16);
                doc.text("CROWN HEAD SPA", 14, 11);

                doc.setFontSize(10);
                doc.text("Payslip", 14, 18);

                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.text(branchLabel, pageWidth - 14, 10, { align: "right" });
                doc.text(currentPayslipContext.period.label, pageWidth - 14, 16, { align: "right" });
            }
        }

        drawHeader();

        doc.setTextColor(32, 43, 60);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);

        if(isTherapist){
            const monthCovered =
                new Date(currentPayslipContext.period.start + "T00:00:00")
                    .toLocaleDateString("en-PH", { month: "long", year: "numeric" });

            doc.text(`Name of Service Provider: ${getFullName(user)}`, 14, 40);
            doc.text(`Position / Role: ${user.role}`, 14, 46);
            doc.text(`Month Covered: ${monthCovered}`, 14, 52);
        }else{
            doc.text(`Name: ${getFullName(user)}`, 14, 34);
            doc.text(`Role / Position: ${user.role}`, 14, 40);
            doc.text(`Reference Number: ${reference}`, 14, 46);
        }

        const tableRows =
            result.days.map(function(day){
                return [
                    formatDateLabel(day.date),
                    formatTimeLabel(day.timeIn),
                    formatTimeLabel(day.timeOut),
                    pesoPdf(day.dailyRateAmount),
                    pesoPdf(day.mealAllowanceAmount),
                    pesoPdf(day.overtimeAmount),
                    day.commission > 0 ? pesoPdf(day.commission) : "—"
                ];
            });

        doc.autoTable({
            startY: tableStartY,
            head: [["Date", "Time In", "Time Out", "Daily Rate", "Meal Allowance", "Overtime", "Commission"]],
            body: tableRows,
            foot: [["", "", "Total", pesoPdf(result.dailyRateTotal), pesoPdf(result.mealAllowanceTotal), pesoPdf(result.overtimeTotal), pesoPdf(result.commissionTotal)]],
            theme: "grid",
            margin: { top: headerHeight + 4, left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 8.5,
                cellPadding: 2.5,
                valign: "middle",
                halign: "center",
                textColor: [32, 43, 60],
                lineColor: [216, 222, 232],
                lineWidth: 0.15
            },
            headStyles: {
                fillColor: [11, 24, 73],
                textColor: [255, 255, 255],
                fontStyle: "bold"
            },
            footStyles: {
                fillColor: [255, 244, 207],
                textColor: [11, 24, 73],
                fontStyle: "bold"
            },
            alternateRowStyles: {
                fillColor: [250, 249, 244]
            },
            didDrawPage: function(data){
                if(data.pageNumber > 1){
                    drawHeader();
                }

                const pageCount =
                    doc.internal.getNumberOfPages();

                doc.setTextColor(120, 126, 138);
                doc.setFontSize(7.5);
                doc.text(
                    `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                    14,
                    doc.internal.pageSize.getHeight() - 8
                );

                doc.text(
                    `Page ${data.pageNumber} of ${pageCount}`,
                    pageWidth - 14,
                    doc.internal.pageSize.getHeight() - 8,
                    { align: "right" }
                );
            }
        });

        const summaryStartY =
            doc.lastAutoTable.finalY + 10;

        const summaryRows = [
            ["Total Daily Rate + Meal Allowance + Overtime + Commission", pesoPdf(result.grossTotal)]
        ];

        if(result.adjustment.additionalPay > 0){
            summaryRows.push([
                "Additional Pay" + (result.adjustment.additionalPayNote ? ` (${result.adjustment.additionalPayNote})` : ""),
                "+" + pesoPdf(result.adjustment.additionalPay)
            ]);
        }

        if(result.adjustment.deduction > 0){
            summaryRows.push([
                "Less Deduction" + (result.adjustment.deductionNote ? ` (${result.adjustment.deductionNote})` : ""),
                "-" + pesoPdf(result.adjustment.deduction)
            ]);
        }

        const netRowIndex =
            summaryRows.length;

        summaryRows.push(["Net Pay", pesoPdf(result.netTotal)]);

        doc.autoTable({
            startY: summaryStartY,
            body: summaryRows,
            theme: "grid",
            margin: { left: 14, right: 14, bottom: 16 },
            styles: {
                font: "helvetica",
                fontSize: 9.5,
                cellPadding: 3.5,
                textColor: [32, 43, 60],
                lineColor: [216, 222, 232],
                lineWidth: 0.15
            },
            columnStyles: {
                0: { cellWidth: 130, fontStyle: "bold" },
                1: { cellWidth: 46, halign: "right" }
            },
            didParseCell: function(data){
                if(data.row.index === netRowIndex){
                    data.cell.styles.fillColor = [255, 244, 207];
                    data.cell.styles.textColor = [11, 24, 73];
                    data.cell.styles.fontStyle = "bold";
                    data.cell.styles.fontSize = 11;
                }
            }
        });

        if(isTherapist){
            drawApprovalSignatureBlock(doc, pageWidth);
        }

        doc.save(
            (isTherapist
                ? `JS Wellness Corp - Service Payment Voucher - `
                : `Crown Head Spa - Payslip - `
            ) +
            `${user.account} - ${currentPayslipContext.period.start} to ${currentPayslipContext.period.end}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to generate the payslip PDF.");
    }finally{
        button.disabled = false;
        button.textContent = "🖨 Export to PDF";
    }
}

/* "Approval and Acknowledgement" signature block — Approved By / Received
   By side by side, two blank lines below each label, then a signature
   line. Only used on the Therapist "Service Payment Voucher" PDF. */
function drawApprovalSignatureBlock(doc, pageWidth){
    const pageHeight =
        doc.internal.pageSize.getHeight();

    let y =
        doc.lastAutoTable.finalY + 16;

    const blockHeight = 40;

    if(y + blockHeight > pageHeight - 16){
        doc.addPage();
        y = 24;
    }

    doc.setTextColor(11, 24, 73);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Approval and Acknowledgement", 14, y);

    const leftX = 14;
    const rightX = pageWidth / 2 + 6;
    const columnWidth = pageWidth / 2 - 20;

    const labelY = y + 10;

    doc.setFontSize(9.5);
    doc.text("Approved By", leftX, labelY);
    doc.text("Received By", rightX, labelY);

    /* Two blank lines below the label before the signature line. */
    const lineY = labelY + 14;

    doc.setDrawColor(32, 43, 60);
    doc.setLineWidth(0.2);
    doc.line(leftX, lineY, leftX + columnWidth, lineY);
    doc.line(rightX, lineY, rightX + columnWidth, lineY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 126, 138);
    doc.text("Signature over Printed Name", leftX, lineY + 5);
    doc.text("Signature over Printed Name", rightX, lineY + 5);
}

function togglePayslipStatus(){
    if(!currentPayslipContext){
        return;
    }

    const key =
        compositeKey(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const statuses =
        getStatuses();

    const willBePaid =
        statuses[key] !== "Paid";

    const rateWarningVisible =
        !document.getElementById("payslipRateWarning")?.classList.contains("d-none");

    if(willBePaid && rateWarningVisible){
        const proceed =
            window.confirm(
                "Secondary Daily Rate (Receptionist) is not set for this staff — their Receptionist-duty days in this period will be paid ₱0 base pay. Generate payroll anyway?"
            );

        if(!proceed){
            return;
        }
    }

    statuses[key] =
        willBePaid ? "Paid" : "Pending";

    saveStatuses(statuses);

    if(willBePaid){
        ensurePayslipReference(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );
    }

    renderPayslipReference();
    renderPayslipStatusButton();
    renderPayroll();
}

function renderPayslipReference(){
    if(!currentPayslipContext){
        return;
    }

    const reference =
        getPayslipReference(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    document.getElementById("payslipReference").textContent =
        reference || "Not yet generated";
}
