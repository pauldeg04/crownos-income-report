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
const PAYROLL_DEDUCTIONS_KEY = "crownPayrollDeductions";
const PAYROLL_STATUS_KEY = "crownPayrollStatus";
const PAYROLL_REFERENCE_KEY = "crownPayrollReferences";
const PAYROLL_ATTACHMENT_KEY = "crownPayrollAttachments";
const PAYROLL_ACK_KEY = "crownPayrollAcknowledgements";
const PAYROLL_GROUP_ARCHIVE_KEY = "crownPayrollGroupArchive";
const PAYROLL_GROUP_ARCHIVED_KEY = "crownPayrollGroupArchived";
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
let currentPayrollGroupViewContext = null;

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

    document.getElementById("payPayslipBtn")
        .addEventListener("click", startPayFlow);

    document.getElementById("payslipAttachmentInput")
        .addEventListener("change", handlePayAttachmentChosen);

    document.getElementById("cancelPayAttachmentBtn")
        .addEventListener("click", cancelPayAttachment);

    document.getElementById("submitPayAttachmentBtn")
        .addEventListener("click", submitPayAttachment);

    document.getElementById("sendEmailPayslipBtn")
        .addEventListener("click", sendPayslipEmailNow);

    document.getElementById("archivePayslipBtn")
        .addEventListener("click", archivePayslip);

    document.getElementById("acknowledgePayslipBtn")
        .addEventListener("click", acknowledgePayslip);

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

    document.getElementById("generatePayrollGroupBtn")
        .addEventListener("click", generatePayrollGroup);

    document.getElementById("togglePayslipArchiveBtn")
        .addEventListener("click", togglePayslipArchiveCollapse);

    document.getElementById("closePayrollGroupViewBtn")
        .addEventListener("click", closePayrollGroupView);

    document.getElementById("closePayrollGroupViewFooterBtn")
        .addEventListener("click", closePayrollGroupView);

    document.getElementById("deletePayrollGroupBtn")
        .addEventListener("click", deletePayrollGroupArchiveEntry);

    document.getElementById("archivePayrollGroupBtn")
        .addEventListener("click", archivePayrollGroupEntry);

    document.getElementById("restorePayrollGroupBtn")
        .addEventListener("click", restorePayrollGroupEntry);

    document.getElementById("payrollGroupViewBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closePayrollGroupView();
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
    document.getElementById("payrollGroupArchiveCard").classList.remove("d-none");
    document.getElementById("payrollGroupArchivedCard").classList.remove("d-none");
    document.getElementById("generatedPayrollCard").classList.remove("d-none");
    document.getElementById("payslipArchiveCard").classList.remove("d-none");

    initializeDates();
    populateGroupDropdown();
    populateRateSetupDropdown();
    renderPayroll();
    renderPayrollGroupArchive();
    renderPayrollGroupArchived();
    renderGeneratedPayroll();
    renderPayslipArchive();

    document.getElementById("payrollStartDate")
        .addEventListener("change", renderPayroll);

    document.getElementById("payrollEndDate")
        .addEventListener("change", renderPayroll);

    document.getElementById("payrollCutoffMonth").value =
        toDateString(new Date()).slice(0, 7);

    document.getElementById("payrollCutoff1Btn")
        .addEventListener("click", function(){ applyPayrollCutoff(1); });

    document.getElementById("payrollCutoff2Btn")
        .addEventListener("click", function(){ applyPayrollCutoff(2); });

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
            keys.includes(PAYROLL_DEDUCTIONS_KEY) ||
            keys.includes(PAYROLL_STATUS_KEY) ||
            keys.includes(PAYROLL_DUTY_LOG_KEY)
        ){
            renderPayroll();
        }

        if(keys.includes(PAYROLL_STATUS_KEY)){
            renderGeneratedPayroll();
            renderPayslipArchive();
        }

        if(keys.includes(PAYROLL_GROUP_ARCHIVE_KEY)){
            renderPayrollGroupArchive();
        }

        if(keys.includes(PAYROLL_GROUP_ARCHIVED_KEY)){
            renderPayrollGroupArchived();
        }

        if(
            currentPayslipContext &&
            (keys.includes(PAYROLL_ATTACHMENT_KEY) || keys.includes(PAYROLL_ACK_KEY))
        ){
            renderPayslipAttachment();
            renderPayslipAckSection();
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
            keys.includes(PAYROLL_ADJUSTMENTS_KEY) ||
            keys.includes(PAYROLL_DEDUCTIONS_KEY)
        ){
            renderMyPayroll();
        }

        if(
            currentPayslipContext &&
            (keys.includes(PAYROLL_ATTACHMENT_KEY) || keys.includes(PAYROLL_ACK_KEY))
        ){
            renderPayslipAttachment();
            renderPayslipAckSection();
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

/* Defaults to last week's Sunday–Saturday (the most recently completed
   week), not just "13 days ago" — that's the range actually checked
   for payroll each time, regardless of which weekday this page happens
   to be opened on. */
function initializeDates(){
    const today = new Date();

    const thisWeekSunday = new Date(today);
    thisWeekSunday.setDate(today.getDate() - today.getDay());

    const lastWeekSaturday = new Date(thisWeekSunday);
    lastWeekSaturday.setDate(thisWeekSunday.getDate() - 1);

    const lastWeekSunday = new Date(lastWeekSaturday);
    lastWeekSunday.setDate(lastWeekSaturday.getDate() - 6);

    document.getElementById("payrollStartDate").value =
        toDateString(lastWeekSunday);

    document.getElementById("payrollEndDate").value =
        toDateString(lastWeekSaturday);
}

/* 1st cutoff: the 26th of the PREVIOUS month through the 10th of the
   selected month. 2nd cutoff: the 11th through the 25th of the selected
   month. */
function pad2(n){ return String(n).padStart(2, "0"); }

function applyPayrollCutoff(which){
    const monthInput =
        document.getElementById("payrollCutoffMonth");

    const [y, m] =
        (monthInput.value || toDateString(new Date()).slice(0, 7))
            .split("-")
            .map(Number);

    if(which === 1){
        const prev = new Date(y, m - 2, 1);

        document.getElementById("payrollStartDate").value =
            `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}-26`;

        document.getElementById("payrollEndDate").value =
            `${y}-${pad2(m)}-10`;
    }else{
        document.getElementById("payrollStartDate").value =
            `${y}-${pad2(m)}-11`;

        document.getElementById("payrollEndDate").value =
            `${y}-${pad2(m)}-25`;
    }

    renderPayroll();
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
        monthlyRate: Number(saved.monthlyRate) || 0,
        mealAllowance: Number(saved.mealAllowance) || 0,
        otMealAllowance: Number(saved.otMealAllowance) || 0,
        secondaryDailyRate: Number(saved.secondaryDailyRate) || 0,
        sssNumber: saved.sssNumber || "",
        pagibigNumber: saved.pagibigNumber || "",
        philhealthNumber: saved.philhealthNumber || "",
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

    document.getElementById("rateMonthlyRate").value =
        rate.monthlyRate || "";

    document.getElementById("rateDailyRateWrapper")
        .classList.toggle("d-none", user.fixedRate === true);

    document.getElementById("rateMonthlyRateWrapper")
        .classList.toggle("d-none", user.fixedRate !== true);

    document.getElementById("rateMealAllowanceLabel").textContent =
        user.fixedRate === true ? "Allowance (₱)" : "Meal Allowance (₱)";

    document.getElementById("rateOtMealAllowanceWrapper")
        .classList.toggle("d-none", user.fixedRate === true);

    document.getElementById("rateGovtIdsWrapper")
        .classList.toggle("d-none", user.compensationSchedule !== "Bi-Monthly");

    document.getElementById("rateSssNumber").value =
        rate.sssNumber || "";

    document.getElementById("ratePagibigNumber").value =
        rate.pagibigNumber || "";

    document.getElementById("ratePhilhealthNumber").value =
        rate.philhealthNumber || "";

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
        monthlyRate: Number(document.getElementById("rateMonthlyRate").value) || 0,
        mealAllowance: Number(document.getElementById("rateMealAllowance").value) || 0,
        otMealAllowance: Number(document.getElementById("rateOtMealAllowance").value) || 0,
        secondaryDailyRate: Number(document.getElementById("rateSecondaryDailyRate").value) || 0,
        sssNumber: document.getElementById("rateSssNumber").value.trim(),
        pagibigNumber: document.getElementById("ratePagibigNumber").value.trim(),
        philhealthNumber: document.getElementById("ratePhilhealthNumber").value.trim(),
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

    const shiftEndTime =
        SHIFT_SCHEDULES[shiftType]?.end || "";

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

                const rate =
                    CrownCommission.getServiceCommissionRate(
                        meta,
                        date,
                        item?.serviceStartTime,
                        shiftEndTime
                    );

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

/* Admin Staff Group only — government contributions + loans/cash advance,
   same fields as GoodSign's payslip Deductions column. Editable per
   payslip period (no per-staff default), keyed like getAdjustment. */
function getDeductions(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_DEDUCTIONS_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll deductions:", error);
        return {};
    }
}

function saveDeductions(deductions){
    localStorage.setItem(
        PAYROLL_DEDUCTIONS_KEY,
        JSON.stringify(deductions)
    );
}

function getDeduction(userId, groupKey, period){
    const saved =
        getDeductions()[compositeKey(userId, groupKey, period)];

    return {
        sssContri: Number(saved?.sssContri) || 0,
        philhealthContri: Number(saved?.philhealthContri) || 0,
        pagibigContri: Number(saved?.pagibigContri) || 0,
        taxWithholding: Number(saved?.taxWithholding) || 0,
        sssLoan: Number(saved?.sssLoan) || 0,
        hdmfLoan: Number(saved?.hdmfLoan) || 0,
        cashAdvance: Number(saved?.cashAdvance) || 0
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

/* "Paid" is a legacy value from an earlier version of this flow (the
   attachment-required, auto-email "Generate Payroll" toggle) — treated the
   same as "Generated" so nothing written by it gets stranded. */
function getStatus(userId, groupKey, period){
    const statuses =
        getStatuses();

    const raw =
        statuses[compositeKey(userId, groupKey, period)];

    if(raw === "Archived"){
        return "Archived";
    }

    if(raw === "Generated" || raw === "Paid"){
        return "Generated";
    }

    return "Pending";
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

/* ---------- Payslip attachment + acknowledgement ---------- */

function getAttachments(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_ATTACHMENT_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll attachments:", error);
        return {};
    }
}

function saveAttachments(attachments){
    localStorage.setItem(
        PAYROLL_ATTACHMENT_KEY,
        JSON.stringify(attachments)
    );
}

function getPayslipAttachment(userId, groupKey, period){
    return getAttachments()[compositeKey(userId, groupKey, period)] || null;
}

function getAcknowledgements(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_ACK_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll acknowledgements:", error);
        return {};
    }
}

function saveAcknowledgements(acknowledgements){
    localStorage.setItem(
        PAYROLL_ACK_KEY,
        JSON.stringify(acknowledgements)
    );
}

function getPayslipAcknowledgement(userId, groupKey, period){
    return getAcknowledgements()[compositeKey(userId, groupKey, period)] || null;
}

/* Mirrors firebase-sync.js's toSyncEmail exactly (see functions/index.js's
   own duplicate of this) — used only to build/match the Storage path each
   staff member's own Firebase Auth token.email already carries, so the
   Storage rule can compare against it without a second identity system. */
function toSyncEmail(username){
    const slug =
        String(username || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "-");

    return "u-" + slug + "@crownos-sync.com";
}

/* Uploads to Firebase Storage (shared, cross-device) instead of embedding
   the file itself in the synced localStorage/Firestore blob — same
   reasoning as bir-compliance.js's uploadFile. */
function uploadPayrollAttachment(file, ownerAccount, cb, onError){
    const safeName =
        file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

    const path =
        `payrollAttachments/${toSyncEmail(ownerAccount)}/${Date.now()}_${safeName}`;

    const ref =
        firebase.storage().ref().child(path);

    const task =
        ref.put(file);

    task.on("state_changed", null, function(err){
        alert("Upload failed: " + (err.message || err.code || "unknown error"));
        onError?.();
    }, function(){
        ref.getDownloadURL().then(function(url){
            cb({ name: file.name, size: file.size, path: path, url: url });
        });
    });
}

/* Returns the callable's promise so callers (sendPayslipEmailNow) can
   react to success/failure themselves — e.g. to stamp emailSentAt and
   grey the Send to Email button out only once the send actually
   succeeded. */
function sendPayslipEmailNotification(user, groupKey, period, result, attachment){
    return firebase.functions().httpsCallable("sendPayslipEmailNotification")({
        email: user.email,
        staffName: getFullName(user),
        period: period.label,
        groupKey: groupKey === ADMIN_GROUP_KEY ? "Admin Staff (All Branches)" : groupKey,
        breakdown: {
            dailyRateTotal: result.dailyRateTotal,
            mealAllowanceTotal: result.mealAllowanceTotal,
            overtimeTotal: result.overtimeTotal,
            commissionTotal: result.commissionTotal,
            grossTotal: result.grossTotal,
            additionalPay: result.adjustment.additionalPay,
            deduction: result.adjustment.deduction,
            netTotal: result.netTotal
        },
        attachmentUrl: attachment.url,
        attachmentName: attachment.name
    });
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

    /* Fixed Rate staff aren't paid per attendance day — they get half of
       their Monthly Rate on both the 1st and 2nd cutoff, regardless of
       the days actually worked. Allowance is the same: half of the
       configured Allowance amount every cutoff, not attendance-driven. */
    const dailyRateTotal =
        user.fixedRate
            ? rate.monthlyRate / 2
            : days.reduce(function(sum, day){ return sum + day.dailyRateAmount; }, 0);

    const mealAllowanceTotal =
        user.fixedRate
            ? rate.mealAllowance / 2
            : days.reduce(function(sum, day){ return sum + day.mealAllowanceAmount; }, 0);

    /* Fixed Rate (salaried) staff don't get separate Overtime pay or
       Commission — their earnings table only shows Daily Rate (half
       Monthly Rate) + Allowance, so Gross Pay must exclude both here too. */
    const overtimeTotal =
        user.fixedRate
            ? 0
            : days.reduce(function(sum, day){ return sum + day.overtimeAmount; }, 0);

    const commissionTotal =
        user.fixedRate
            ? 0
            : days.reduce(function(sum, day){ return sum + day.commission; }, 0);

    const grossTotal =
        dailyRateTotal + mealAllowanceTotal + overtimeTotal + commissionTotal;

    const adjustment =
        getAdjustment(user.id, groupKey, period);

    const deduction =
        getDeduction(user.id, groupKey, period);

    const deductionsTotal =
        deduction.sssContri +
        deduction.philhealthContri +
        deduction.pagibigContri +
        deduction.taxWithholding +
        deduction.sssLoan +
        deduction.hdmfLoan +
        deduction.cashAdvance;

    const netTotal =
        Math.max(
            0,
            grossTotal + adjustment.additionalPay - adjustment.deduction - deductionsTotal
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
        deduction: deduction,
        deductionsTotal: deductionsTotal,
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

    renderPayrollStaffRows(
        document.getElementById("payrollBody"),
        document.getElementById("payrollEmptyState"),
        staff,
        groupKey,
        period
    );
}

/* Shared by the live Payroll Summary table and the Payroll Group Archive's
   "View" popup — both list the same staff/salary/bank/status/view-payslip
   columns for a given group + period, just at different points in time. */
function renderPayrollStaffRows(tbody, emptyStateEl, staff, groupKey, period, totalEl){
    tbody.innerHTML = "";

    emptyStateEl.classList.toggle("d-none", staff.length > 0);

    let totalSalary = 0;

    staff.forEach(function(user){
        const result =
            computeStaffPayroll(user, groupKey, period);

        totalSalary += result.netTotal;

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

    if(totalEl){
        totalEl.textContent = peso(totalSalary);
    }
}

/* ---------- Payroll Group Archive ---------- */

function getGroupArchive(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_GROUP_ARCHIVE_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll group archive:", error);
        return {};
    }
}

function saveGroupArchive(archive){
    localStorage.setItem(
        PAYROLL_GROUP_ARCHIVE_KEY,
        JSON.stringify(archive)
    );
}

function groupArchiveKey(groupKey, period){
    return [groupKey, period.start, period.end].join("::");
}

/* One archive row per Payroll Group + Date range — re-clicking "Generate
   Payroll Group" on the same selection just keeps the existing row (and
   its Exported/Not Exported status) instead of adding a duplicate. */
function generatePayrollGroup(){
    if(!currentPayrollSummaryContext || currentPayrollSummaryContext.staff.length === 0){
        alert("No staff found for this payroll group.");
        return;
    }

    const key =
        groupArchiveKey(currentPayrollSummaryContext.groupKey, currentPayrollSummaryContext.period);

    const archive =
        getGroupArchive();

    if(!archive[key]){
        archive[key] = { status: "Not Exported", createdAt: Date.now() };
        saveGroupArchive(archive);
    }

    renderPayrollGroupArchive();
}

function renderPayrollGroupArchive(){
    const archive =
        getGroupArchive();

    const rows =
        Object.keys(archive)
            .map(function(key){
                const parts = key.split("::");

                return {
                    groupKey: parts[0],
                    start: parts[1],
                    end: parts[2],
                    status: archive[key].status === "Exported" ? "Exported" : "Not Exported",
                    createdAt: archive[key].createdAt || 0
                };
            })
            .sort(function(a, b){
                return b.createdAt - a.createdAt;
            });

    const tbody =
        document.getElementById("payrollGroupArchiveBody");

    tbody.innerHTML = "";

    document.getElementById("payrollGroupArchiveEmptyState")
        .classList.toggle("d-none", rows.length > 0);

    rows.forEach(function(row){
        const groupLabel =
            row.groupKey === ADMIN_GROUP_KEY ? "Admin Staff" : row.groupKey;

        const period = {
            start: row.start,
            end: row.end,
            label: formatDateLabel(row.start) + " – " + formatDateLabel(row.end)
        };

        const statusLabel =
            row.status === "Exported" ? "Exported to PDF" : "Not yet Exported to PDF";

        const tr =
            document.createElement("tr");

        tr.innerHTML = `
            <td>${escapeHtml(groupLabel)}</td>
            <td>${period.label}</td>
            <td>
                <span class="payroll-status-badge payroll-status-${row.status === "Exported" ? "paid" : "pending"}">
                    ${statusLabel}
                </span>
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary view-group-btn">
                    View
                </button>
            </td>
        `;

        tr.querySelector(".view-group-btn")
            .addEventListener("click", function(){
                openPayrollGroupView(row.groupKey, period);
            });

        tbody.appendChild(tr);
    });
}

/* Recomputed live (not a frozen snapshot) so the numbers always reflect
   the current rates/attendance/adjustments — consistent with how every
   other payroll view in this file works. */
function openPayrollGroupView(groupKey, period, fromArchived){
    const groupLabel =
        groupKey === ADMIN_GROUP_KEY ? "Admin Staff" : groupKey;

    const staff =
        getGroupStaff(groupKey)
            .slice()
            .sort(function(a, b){
                return a.account.localeCompare(b.account);
            });

    currentPayrollGroupViewContext = {
        groupKey: groupKey,
        period: period,
        groupLabel: groupLabel,
        staff: staff,
        archived: !!fromArchived
    };

    document.getElementById("payrollGroupViewTitle").textContent =
        groupLabel;

    document.getElementById("payrollGroupViewSubtitle").textContent =
        period.label;

    renderPayrollStaffRows(
        document.getElementById("payrollGroupViewBody"),
        document.getElementById("payrollGroupViewEmptyState"),
        staff,
        groupKey,
        period,
        document.getElementById("payrollGroupViewTotalSalary")
    );

    document.getElementById("archivePayrollGroupBtn").classList.toggle("d-none", !!fromArchived);
    document.getElementById("restorePayrollGroupBtn").classList.toggle("d-none", !fromArchived);

    document.getElementById("payrollGroupViewBackdrop").classList.remove("d-none");
}

function closePayrollGroupView(){
    document.getElementById("payrollGroupViewBackdrop").classList.add("d-none");
    currentPayrollGroupViewContext = null;
}

function deletePayrollGroupArchiveEntry(){
    if(!currentPayrollGroupViewContext){
        return;
    }

    if(!confirm("Delete this payroll group archive record? This only removes it from the list here — it does not change any staff's Paid/Pending status.")){
        return;
    }

    const key =
        groupArchiveKey(currentPayrollGroupViewContext.groupKey, currentPayrollGroupViewContext.period);

    if(currentPayrollGroupViewContext.archived){
        const archived = getArchivedGroupArchive();
        delete archived[key];
        saveArchivedGroupArchive(archived);
        renderPayrollGroupArchived();
    }else{
        const archive = getGroupArchive();
        delete archive[key];
        saveGroupArchive(archive);
        renderPayrollGroupArchive();
    }

    closePayrollGroupView();
}

/* Moves a generated payroll group out of the active "Generated Payroll
   Group" list into the separate "Generated Payroll Group Archive" list —
   a distinct action from Delete above, which removes the record entirely. */
function archivePayrollGroupEntry(){
    if(!currentPayrollGroupViewContext || currentPayrollGroupViewContext.archived){
        return;
    }

    const key =
        groupArchiveKey(currentPayrollGroupViewContext.groupKey, currentPayrollGroupViewContext.period);

    const archive =
        getGroupArchive();

    const record = archive[key];

    if(!record){
        return;
    }

    delete archive[key];
    saveGroupArchive(archive);

    const archived =
        getArchivedGroupArchive();

    archived[key] = Object.assign({}, record, { archivedAt: Date.now() });
    saveArchivedGroupArchive(archived);

    renderPayrollGroupArchive();
    renderPayrollGroupArchived();
    closePayrollGroupView();
}

/* Moves an archived group back into the active "Generated Payroll Group"
   list — the reverse of archivePayrollGroupEntry() above. */
function restorePayrollGroupEntry(){
    if(!currentPayrollGroupViewContext || !currentPayrollGroupViewContext.archived){
        return;
    }

    const key =
        groupArchiveKey(currentPayrollGroupViewContext.groupKey, currentPayrollGroupViewContext.period);

    const archived =
        getArchivedGroupArchive();

    const record = archived[key];

    if(!record){
        return;
    }

    delete archived[key];
    saveArchivedGroupArchive(archived);

    const archive =
        getGroupArchive();

    archive[key] = { status: record.status, createdAt: record.createdAt };
    saveGroupArchive(archive);

    renderPayrollGroupArchive();
    renderPayrollGroupArchived();
    closePayrollGroupView();
}

function getArchivedGroupArchive(){
    try{
        const raw =
            localStorage.getItem(PAYROLL_GROUP_ARCHIVED_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load payroll group archived list:", error);
        return {};
    }
}

function saveArchivedGroupArchive(archived){
    localStorage.setItem(
        PAYROLL_GROUP_ARCHIVED_KEY,
        JSON.stringify(archived)
    );
}

function renderPayrollGroupArchived(){
    const archived =
        getArchivedGroupArchive();

    const rows =
        Object.keys(archived)
            .map(function(key){
                const parts = key.split("::");

                return {
                    groupKey: parts[0],
                    start: parts[1],
                    end: parts[2],
                    status: archived[key].status === "Exported" ? "Exported" : "Not Exported",
                    createdAt: archived[key].createdAt || 0
                };
            })
            .sort(function(a, b){
                return b.createdAt - a.createdAt;
            });

    const tbody =
        document.getElementById("payrollGroupArchivedBody");

    tbody.innerHTML = "";

    document.getElementById("payrollGroupArchivedEmptyState")
        .classList.toggle("d-none", rows.length > 0);

    rows.forEach(function(row){
        const groupLabel =
            row.groupKey === ADMIN_GROUP_KEY ? "Admin Staff" : row.groupKey;

        const period = {
            start: row.start,
            end: row.end,
            label: formatDateLabel(row.start) + " – " + formatDateLabel(row.end)
        };

        const statusLabel =
            row.status === "Exported" ? "Exported to PDF" : "Not yet Exported to PDF";

        const tr =
            document.createElement("tr");

        tr.innerHTML = `
            <td>${escapeHtml(groupLabel)}</td>
            <td>${period.label}</td>
            <td>
                <span class="payroll-status-badge payroll-status-${row.status === "Exported" ? "paid" : "pending"}">
                    ${statusLabel}
                </span>
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary view-group-btn">
                    View
                </button>
            </td>
        `;

        tr.querySelector(".view-group-btn")
            .addEventListener("click", function(){
                openPayrollGroupView(row.groupKey, period, true);
            });

        tbody.appendChild(tr);
    });
}

/* ---------- Generated Payroll (waiting list) + Payroll Archive ---------- */

/* Shared by both tables below — they're the same shape (Staff Name /
   Payroll Date / Status / View), just filtered to a different normalized
   status (see getStatus()). */
function buildPayslipStatusRows(wantedStatus){
    const statuses =
        getStatuses();

    const users =
        CrownAuth.getUsers();

    return Object.keys(statuses)
        .map(function(key){
            const parts = key.split("::");

            const user =
                users.find(function(item){ return item.id === parts[0]; });

            if(!user || !parts[2] || !parts[3]){
                return null;
            }

            const period = {
                start: parts[2],
                end: parts[3],
                label: formatDateLabel(parts[2]) + " – " + formatDateLabel(parts[3])
            };

            return {
                user: user,
                groupKey: parts[1],
                period: period,
                status: getStatus(user.id, parts[1], period)
            };
        })
        .filter(function(row){
            return row && row.status === wantedStatus;
        })
        .sort(function(a, b){
            return b.period.start.localeCompare(a.period.start);
        });
}

function renderPayslipStatusTable(tbodyId, emptyStateId, wantedStatus){
    const rows =
        buildPayslipStatusRows(wantedStatus);

    const tbody =
        document.getElementById(tbodyId);

    tbody.innerHTML = "";

    document.getElementById(emptyStateId)
        .classList.toggle("d-none", rows.length > 0);

    rows.forEach(function(row){
        const tr =
            document.createElement("tr");

        tr.innerHTML = `
            <td>${escapeHtml(getFullName(row.user))}</td>
            <td>${row.period.label}</td>
            <td>
                <span class="payroll-status-badge payroll-status-${row.status.toLowerCase()}">
                    ${row.status}
                </span>
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-primary view-payslip-btn">
                    View
                </button>
            </td>
        `;

        tr.querySelector(".view-payslip-btn")
            .addEventListener("click", function(){
                openPayslipModal(row.user, row.groupKey, row.period);
            });

        tbody.appendChild(tr);
    });
}

function renderGeneratedPayroll(){
    renderPayslipStatusTable("generatedPayrollBody", "generatedPayrollEmptyState", "Generated");
}

function renderPayslipArchive(){
    renderPayslipStatusTable("payslipArchiveBody", "payslipArchiveEmptyState", "Archived");
}

function togglePayslipArchiveCollapse(){
    const collapse =
        document.getElementById("payslipArchiveCollapse");

    const expanded =
        collapse.classList.toggle("d-none") === false;

    document.getElementById("togglePayslipArchiveBtn").textContent =
        expanded ? "Hide" : "Show";
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

                const period = {
                    start: parts[1],
                    end: parts[2]
                };

                return {
                    groupKey: parts[0],
                    start: parts[1],
                    end: parts[2],
                    status: getStatus(user.id, parts[0], period)
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

    const isAdminGroup =
        groupKey === ADMIN_GROUP_KEY;

    document.getElementById("payslipStandardHead").classList.toggle("d-none", isAdminGroup);
    document.getElementById("payslipStandardTableWrap").classList.toggle("d-none", isAdminGroup);
    document.getElementById("payslipStandardSummaryWrap").classList.toggle("d-none", isAdminGroup);
    document.getElementById("payslipAdminSheetWrap").classList.toggle("d-none", !isAdminGroup);

    renderPayslipSummary(result);
    renderPayslipReference();
    renderPayslipAttachment();
    renderPayslipAckSection();
    hidePayAttachmentPreview();
    renderPayslipActionButtons();
    applyPayslipModalMode();

    document.getElementById("payslipBackdrop").classList.remove("d-none");
}

/* Admin Staff Group only — renders the GoodSign-style printable sheet
   (company header, DTR table, Earnings/Adjustments columns, Net Pay
   summary, signature footer) in place of the standard flat table +
   summary used for branch groups. Re-run alongside renderPayslipSummary
   so it stays in sync with adjustment edits. */
function renderAdminPayslipSheet(result){
    if(!currentPayslipContext){
        return;
    }

    document.getElementById("psAdmName").textContent =
        getFullName(result.user);

    document.getElementById("psAdmRole").textContent =
        result.user.role;

    document.getElementById("psAdmPeriod").textContent =
        currentPayslipContext.period.label;

    document.getElementById("psAdmSss").textContent =
        result.rate.sssNumber || "—";

    document.getElementById("psAdmPagibig").textContent =
        result.rate.pagibigNumber || "—";

    document.getElementById("psAdmPhilhealth").textContent =
        result.rate.philhealthNumber || "—";

    document.getElementById("psAdmRef").textContent =
        getPayslipReference(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        ) || "Not yet generated";

    document.getElementById("psAdmDtrBody").innerHTML =
        result.days.map(function(day){
            return `
                <tr>
                    <td>${formatDateLabel(day.date)}</td>
                    <td>${formatTimeLabel(day.timeIn)}</td>
                    <td>${formatTimeLabel(day.timeOut)}</td>
                    <td>${day.hours ? day.hours.toFixed(2) : "—"}</td>
                </tr>
            `;
        }).join("");

    document.getElementById("psAdmEarningsTable").innerHTML =
        result.user.fixedRate
            ? `
                <tr><td class="ps-line-label">Daily Rate</td><td class="ps-line-amount">${peso(result.dailyRateTotal)}</td></tr>
                <tr><td class="ps-line-label">Allowance</td><td class="ps-line-amount">${peso(result.mealAllowanceTotal)}</td></tr>
                <tr class="ps-line-subtotal"><td class="ps-line-label">Gross Pay</td><td class="ps-line-amount">${peso(result.grossTotal)}</td></tr>
            `
            : `
                <tr><td class="ps-line-label">Daily Rate</td><td class="ps-line-amount">${peso(result.dailyRateTotal)}</td></tr>
                <tr><td class="ps-line-label">Meal Allowance</td><td class="ps-line-amount">${peso(result.mealAllowanceTotal)}</td></tr>
                <tr><td class="ps-line-label">Overtime</td><td class="ps-line-amount">${peso(result.overtimeTotal)}</td></tr>
                <tr><td class="ps-line-label">Commission</td><td class="ps-line-amount">${peso(result.commissionTotal)}</td></tr>
                <tr class="ps-line-subtotal"><td class="ps-line-label">Gross Pay</td><td class="ps-line-amount">${peso(result.grossTotal)}</td></tr>
            `;

    renderAdminDeductionsTable(result);

    document.getElementById("psAdmAdjustmentsTable").innerHTML = `
        <tr><td class="ps-line-label">Additional Pay${result.adjustment.additionalPayNote ? ` (${escapeHtml(result.adjustment.additionalPayNote)})` : ""}</td><td class="ps-line-amount">${result.adjustment.additionalPay > 0 ? "+" + peso(result.adjustment.additionalPay) : peso(0)}</td></tr>
        <tr><td class="ps-line-label">Deduction${result.adjustment.deductionNote ? ` (${escapeHtml(result.adjustment.deductionNote)})` : ""}</td><td class="ps-line-amount">${result.adjustment.deduction > 0 ? "−" + peso(result.adjustment.deduction) : peso(0)}</td></tr>
    `;

    document.getElementById("psAdmGross").textContent =
        peso(result.grossTotal);

    document.getElementById("psAdmDeduction").textContent =
        peso(result.adjustment.deduction + result.deductionsTotal);

    document.getElementById("psAdmNet").textContent =
        peso(result.netTotal);
}

/* Government Contribution + Other Deduction line items — editable by
   Admin/EA (canManagePayroll), read-only for staff viewing their own
   payslip. Saved together with the Additional Pay/Deduction adjustment
   via the same "Save Adjustment" action (see savePayslipAdjustment). */
function renderAdminDeductionsTable(result){
    const editable =
        canManagePayroll();

    const disabledAttr =
        editable ? "" : "disabled";

    const deduction =
        result.deduction;

    document.getElementById("psAdmDeductionsTable").innerHTML = `
        <tr><td colspan="2" class="ps-line-label"><strong>Government Contribution</strong></td></tr>
        <tr>
            <td class="ps-line-label">SSS Contribution</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedSssContri" value="${deduction.sssContri || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr>
            <td class="ps-line-label">PhilHealth Contribution</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedPhilhealthContri" value="${deduction.philhealthContri || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr>
            <td class="ps-line-label">Pag-IBIG Contribution</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedPagibigContri" value="${deduction.pagibigContri || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr>
            <td class="ps-line-label">Withholding Tax</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedTaxWithholding" value="${deduction.taxWithholding || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr class="ps-line-subtotal"><td class="ps-line-label">Total Contribution</td><td class="ps-line-amount">${peso(deduction.sssContri + deduction.philhealthContri + deduction.pagibigContri + deduction.taxWithholding)}</td></tr>
        <tr><td colspan="2" class="ps-line-label"><strong>Other Deduction</strong></td></tr>
        <tr>
            <td class="ps-line-label">SSS Loan</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedSssLoan" value="${deduction.sssLoan || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr>
            <td class="ps-line-label">HDMF Loan</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedHdmfLoan" value="${deduction.hdmfLoan || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr>
            <td class="ps-line-label">Cash Advance</td>
            <td class="ps-line-input"><input type="number" min="0" step="0.01" id="psDedCashAdvance" value="${deduction.cashAdvance || ""}" placeholder="0.00" ${disabledAttr}></td>
        </tr>
        <tr class="ps-line-subtotal"><td class="ps-line-label">Total Other Deduction</td><td class="ps-line-amount">${peso(deduction.sssLoan + deduction.hdmfLoan + deduction.cashAdvance)}</td></tr>
        <tr class="ps-line-subtotal"><td class="ps-line-label"><strong>Total Deduction</strong></td><td class="ps-line-amount"><strong>${peso(result.deductionsTotal)}</strong></td></tr>
    `;
}

/* Admin/EA get the editable Adjustment row + the status-driven action
   buttons (Pay / Send to Email / Archive — see renderPayslipActionButtons);
   Receptionist/Therapist viewing their own payslip get a plain read-only
   adjustment line, a status badge, and the Acknowledge Payslip row
   instead. */
function applyPayslipModalMode(){
    const editable =
        canManagePayroll();

    document.getElementById("payslipAdjustmentRow")
        .classList.toggle("d-none", !editable);

    document.getElementById("payslipAdjustmentReadout")
        .classList.toggle("d-none", editable);

    document.getElementById("payslipStatusReadout")
        .classList.toggle("d-none", editable);

    document.getElementById("payslipAckRow")
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

    if(currentPayslipContext && currentPayslipContext.groupKey === ADMIN_GROUP_KEY){
        renderAdminPayslipSheet(result);
    }
}

/* Which of Pay / Send to Email / Archive shows in the Admin/EA footer is
   driven entirely by the current status (Pending/Generated/Archived) —
   there's no separate "mode" to track per table the modal was opened
   from. Staff (non-manager) never see these three; they get the
   read-only status badge instead. */
function renderPayslipActionButtons(){
    if(!currentPayslipContext){
        return;
    }

    const status =
        getStatus(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const editable =
        canManagePayroll();

    document.getElementById("payPayslipBtn")
        .classList.toggle("d-none", !editable || status !== "Pending");

    document.getElementById("archivePayslipBtn")
        .classList.toggle("d-none", !editable || status !== "Generated");

    const sendEmailBtn =
        document.getElementById("sendEmailPayslipBtn");

    sendEmailBtn.classList.toggle("d-none", !editable || status !== "Generated");

    const attachment =
        getPayslipAttachment(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const alreadySent =
        Boolean(attachment?.emailSentAt);

    sendEmailBtn.disabled = alreadySent;
    sendEmailBtn.textContent = alreadySent ? "Email Sent" : "Send to Email";

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

    if(currentPayslipContext.groupKey === ADMIN_GROUP_KEY){
        const deductionValue = function(id){
            return Number(document.getElementById(id).value) || 0;
        };

        const newDeduction = {
            sssContri: deductionValue("psDedSssContri"),
            philhealthContri: deductionValue("psDedPhilhealthContri"),
            pagibigContri: deductionValue("psDedPagibigContri"),
            taxWithholding: deductionValue("psDedTaxWithholding"),
            sssLoan: deductionValue("psDedSssLoan"),
            hdmfLoan: deductionValue("psDedHdmfLoan"),
            cashAdvance: deductionValue("psDedCashAdvance")
        };

        const deductions =
            getDeductions();

        const hasAnyDeduction =
            Object.values(newDeduction).some(function(value){ return value > 0; });

        if(hasAnyDeduction){
            deductions[key] = newDeduction;
        }else{
            delete deductions[key];
        }

        saveDeductions(deductions);
    }

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
    if(!currentPayrollGroupViewContext){
        return;
    }

    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    const context = currentPayrollGroupViewContext;

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

        const key =
            groupArchiveKey(context.groupKey, context.period);

        if(context.archived){
            const archived = getArchivedGroupArchive();
            if(archived[key]){
                archived[key].status = "Exported";
                saveArchivedGroupArchive(archived);
                renderPayrollGroupArchived();
            }
        }else{
            const archive = getGroupArchive();
            if(archive[key]){
                archive[key].status = "Exported";
                saveGroupArchive(archive);
                renderPayrollGroupArchive();
            }
        }
    }finally{
        button.disabled = false;
        button.textContent = "🖨 Export to PDF";
    }
}

/* Admin Staff Group PDF export — captures the on-screen GoodSign-style
   sheet (#psAdmSheet) as an image via html2canvas and drops it into an
   A4 landscape PDF, the same technique GoodSign's own payroll uses so
   the exported PDF matches the sheet pixel-for-pixel. */
async function exportAdminPayslipPdf(user){
    if(!window.html2canvas){
        alert("PDF snapshot library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    const button =
        document.getElementById("exportPayslipPdfBtn");

    button.disabled = true;
    button.textContent = "Generating PDF...";

    const sheet =
        document.getElementById("psAdmSheet");

    /* Export is a summary-only document — the Daily Time Record detail
       stays in-app (still visible/editable in the modal), not on the
       printed/exported payslip. */
    const dtrSection =
        document.getElementById("psAdmDtrSection");

    const dtrOriginalDisplay =
        dtrSection.style.display;

    dtrSection.style.display = "none";

    /* With the DTR hidden, the on-screen split (Earnings/Deductions/
       Adjustments all in the right column) leaves the export lopsided —
       move Earnings and Adjustments into the left column just for the
       capture, then put them back exactly where they came from. */
    const leftCol =
        sheet.querySelector(".ps-left-col");

    const rightCol =
        sheet.querySelector(".ps-right-col");

    const earningsCol =
        document.getElementById("psAdmEarningsTable").closest(".ps-col");

    const adjustmentsCol =
        document.getElementById("psAdmAdjustmentsTable").closest(".ps-col");

    const earningsRestoreBefore =
        earningsCol.nextSibling;

    const adjustmentsRestoreBefore =
        adjustmentsCol.nextSibling;

    leftCol.appendChild(earningsCol);
    leftCol.appendChild(adjustmentsCol);

    /* html2canvas can render an <input>'s typed value blank or clipped —
       swap every Deductions input for a plain-text span before the
       capture, then restore them afterward regardless of outcome. */
    const swappedInputs =
        Array.from(sheet.querySelectorAll("input")).map(function(input){
            const span =
                document.createElement("span");

            span.className = "ps-static-value";
            span.textContent = input.value ? peso(Number(input.value) || 0) : "—";
            input.insertAdjacentElement("afterend", span);
            input.style.display = "none";

            return { input: input, span: span };
        });

    try{
        const canvas =
            await html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });

        const jsPDF =
            window.jspdf.jsPDF;

        const pdf =
            new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });

        /* Fit the whole sheet on one landscape A4 page — scale to
           whichever dimension (width or height) is the tighter fit
           inside a small margin, then center it on the page. */
        const pageWidth = 297;
        const pageHeight = 210;
        const margin = 8;

        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;

        const scale =
            Math.min(
                availableWidth / canvas.width,
                availableHeight / canvas.height
            );

        const imgWidth = canvas.width * scale;
        const imgHeight = canvas.height * scale;
        const offsetX = (pageWidth - imgWidth) / 2;
        const offsetY = (pageHeight - imgHeight) / 2;

        const imgData = canvas.toDataURL("image/jpeg", 0.95);

        pdf.addImage(imgData, "JPEG", offsetX, offsetY, imgWidth, imgHeight);

        pdf.save(
            `Crown Head Spa - Admin Staff Payslip - ${user.account} - ${currentPayslipContext.period.start} to ${currentPayslipContext.period.end}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to generate the payslip PDF.");
    }finally{
        swappedInputs.forEach(function(pair){
            pair.input.style.display = "";
            pair.span.remove();
        });

        rightCol.insertBefore(earningsCol, earningsRestoreBefore);
        rightCol.insertBefore(adjustmentsCol, adjustmentsRestoreBefore);

        dtrSection.style.display = dtrOriginalDisplay;

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

    if(currentPayslipContext.groupKey === ADMIN_GROUP_KEY){
        exportAdminPayslipPdf(user);
        return;
    }

    const result =
        computeStaffPayroll(
            user,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const branchLabel =
        currentPayslipContext.groupKey;

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

/* Holds the File the user picked for Pay, between the file input's
   "change" event and either Cancel or Submit — the upload itself only
   happens on Submit (see submitPayAttachment). Also tracks the object
   URL used for the preview <img> so it can be revoked. */
let pendingPayAttachmentFile = null;
let pendingPayAttachmentPreviewUrl = null;

function startPayFlow(){
    if(!currentPayslipContext){
        return;
    }

    const rateWarningVisible =
        !document.getElementById("payslipRateWarning")?.classList.contains("d-none");

    if(rateWarningVisible){
        const proceed =
            window.confirm(
                "Secondary Daily Rate (Receptionist) is not set for this staff — their Receptionist-duty days in this period will be paid ₱0 base pay. Pay anyway?"
            );

        if(!proceed){
            return;
        }
    }

    const input =
        document.getElementById("payslipAttachmentInput");

    input.value = "";
    input.click();
}

function handlePayAttachmentChosen(){
    const input =
        document.getElementById("payslipAttachmentInput");

    const file =
        input.files && input.files[0];

    if(!file){
        return;
    }

    pendingPayAttachmentFile = file;
    pendingPayAttachmentPreviewUrl = URL.createObjectURL(file);

    document.getElementById("payslipPayPreviewImg").src =
        pendingPayAttachmentPreviewUrl;

    document.getElementById("payslipPayPreviewRow").classList.remove("d-none");
    document.getElementById("payPayslipBtn").classList.add("d-none");
}

function hidePayAttachmentPreview(){
    if(pendingPayAttachmentPreviewUrl){
        URL.revokeObjectURL(pendingPayAttachmentPreviewUrl);
    }

    pendingPayAttachmentFile = null;
    pendingPayAttachmentPreviewUrl = null;

    document.getElementById("payslipPayPreviewImg").src = "";
    document.getElementById("payslipPayPreviewRow").classList.add("d-none");
}

function cancelPayAttachment(){
    hidePayAttachmentPreview();
    document.getElementById("payslipAttachmentInput").value = "";
    renderPayslipActionButtons();
}

function submitPayAttachment(){
    if(!currentPayslipContext || !pendingPayAttachmentFile){
        return;
    }

    const context =
        currentPayslipContext;

    const file =
        pendingPayAttachmentFile;

    const user =
        CrownAuth.getUsers().find(function(item){
            return item.id === context.userId;
        });

    if(!user){
        return;
    }

    document.getElementById("submitPayAttachmentBtn").disabled = true;

    uploadPayrollAttachment(file, user.account, function(attachment){
        const attachments =
            getAttachments();

        attachments[compositeKey(context.userId, context.groupKey, context.period)] = {
            name: attachment.name,
            url: attachment.url,
            path: attachment.path,
            uploadedAt: new Date().toISOString(),
            emailSentAt: ""
        };

        saveAttachments(attachments);

        const statuses =
            getStatuses();

        statuses[compositeKey(context.userId, context.groupKey, context.period)] = "Generated";
        saveStatuses(statuses);

        ensurePayslipReference(context.userId, context.groupKey, context.period);

        document.getElementById("submitPayAttachmentBtn").disabled = false;
        hidePayAttachmentPreview();
        refreshPayslipTables();
    }, function(){
        document.getElementById("submitPayAttachmentBtn").disabled = false;
    });
}

function sendPayslipEmailNow(){
    if(!currentPayslipContext){
        return;
    }

    const context =
        currentPayslipContext;

    const attachment =
        getPayslipAttachment(context.userId, context.groupKey, context.period);

    if(!attachment || attachment.emailSentAt){
        return;
    }

    const user =
        CrownAuth.getUsers().find(function(item){
            return item.id === context.userId;
        });

    if(!user){
        return;
    }

    if(!user.email){
        alert("No email address is on file for this staff — add one in Account Settings first.");
        return;
    }

    const result =
        computeStaffPayroll(user, context.groupKey, context.period);

    const button =
        document.getElementById("sendEmailPayslipBtn");

    button.disabled = true;

    sendPayslipEmailNotification(user, context.groupKey, context.period, result, attachment).then(function(){
        const attachments =
            getAttachments();

        const key =
            compositeKey(context.userId, context.groupKey, context.period);

        if(attachments[key]){
            attachments[key].emailSentAt = new Date().toISOString();
            saveAttachments(attachments);
        }

        renderPayslipActionButtons();
    }).catch(function(error){
        console.error("Failed to send payslip email notification:", error);
        alert("Could not send the email. Please try again.");
        button.disabled = false;
    });
}

function archivePayslip(){
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

    statuses[key] = "Archived";
    saveStatuses(statuses);

    closePayslipModal();
    refreshPayslipTables();
}

/* Re-renders everything that reflects payslip status/attachment across
   the underlying tables (not the modal — callers close it or re-render
   it themselves as appropriate). */
function refreshPayslipTables(){
    renderPayroll();
    renderGeneratedPayroll();

    if(canManagePayroll()){
        renderPayslipArchive();

        if(currentPayrollGroupViewContext){
            renderPayrollStaffRows(
                document.getElementById("payrollGroupViewBody"),
                document.getElementById("payrollGroupViewEmptyState"),
                currentPayrollGroupViewContext.staff,
                currentPayrollGroupViewContext.groupKey,
                currentPayrollGroupViewContext.period,
                document.getElementById("payrollGroupViewTotalSalary")
            );
        }
    }

    if(currentPayslipContext){
        renderPayslipReference();
        renderPayslipAttachment();
        renderPayslipAckSection();
        renderPayslipActionButtons();
    }
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

function renderPayslipAttachment(){
    if(!currentPayslipContext){
        return;
    }

    const attachment =
        getPayslipAttachment(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const row =
        document.getElementById("payslipAttachmentRow");

    const link =
        document.getElementById("payslipAttachmentLink");

    const preview =
        document.getElementById("payslipAttachmentPreviewImg");

    row.classList.toggle("d-none", !attachment);

    if(attachment){
        link.href = attachment.url;
        link.textContent = attachment.name;
        preview.src = attachment.url;
    }else{
        preview.src = "";
    }
}

/* Acknowledge Payslip is staff-only (applyPayslipModalMode gates the row
   itself); re-run whenever the modal opens or a status/ack change happens
   so the button vs. read-only readout stays in sync. */
function renderPayslipAckSection(){
    if(!currentPayslipContext){
        return;
    }

    const acknowledgement =
        getPayslipAcknowledgement(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const button =
        document.getElementById("acknowledgePayslipBtn");

    const readout =
        document.getElementById("payslipAckReadout");

    button.classList.toggle("d-none", Boolean(acknowledgement));
    readout.classList.toggle("d-none", !acknowledgement);

    if(acknowledgement){
        readout.textContent =
            `Acknowledged by ${acknowledgement.ackByName} on ${new Date(acknowledgement.ackAt).toLocaleString("en-PH")}`;
    }
}

function acknowledgePayslip(){
    if(!currentPayslipContext){
        return;
    }

    const key =
        compositeKey(
            currentPayslipContext.userId,
            currentPayslipContext.groupKey,
            currentPayslipContext.period
        );

    const acknowledgements =
        getAcknowledgements();

    if(acknowledgements[key]){
        return;
    }

    acknowledgements[key] = {
        ackByName: getFullName(CrownAuth.getCurrentUser()),
        ackAt: new Date().toISOString()
    };

    saveAcknowledgements(acknowledgements);
    renderPayslipAckSection();
}
