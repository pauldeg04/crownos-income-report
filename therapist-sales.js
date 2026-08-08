const THERAPIST_SALES_BRANCH_KEY = "crownSelectedBranch";
const THERAPIST_SALES_PREFIX = "crownDailySales_";
const THERAPIST_MASTER_KEY = "crownTherapistMasterList";
const SERVICE_MASTER_KEY = "crownServiceMasterList";

let calendarYear;
let calendarMonth;

document.addEventListener("DOMContentLoaded", function(){
    initializeSelectedDate();
    populateTherapistDropdown();
    initializeCalendar();
    initializeDateDropdown();
    attachEvents();
    updateBranchState();
    renderTherapistSales();
});

function attachEvents(){
    document
        .getElementById("therapistSelect")
        .addEventListener(
            "change",
            function(){
                renderCalendar();
                renderTherapistSales();
            }
        );

    document
        .getElementById("selectedDate")
        .addEventListener(
            "change",
            function(){
                syncCalendarToSelectedDate();
                renderTherapistSales();
                updateDateDropdownLabel();
                document.getElementById("calendarPopover")?.classList.add("d-none");
            }
        );

    document
        .getElementById("prevSalesDayBtn")
        .addEventListener(
            "click",
            function(){
                stepSelectedDate(-1);
            }
        );

    document
        .getElementById("nextSalesDayBtn")
        .addEventListener(
            "click",
            function(){
                stepSelectedDate(1);
            }
        );

    document
        .getElementById("prevMonthBtn")
        .addEventListener(
            "click",
            function(){
                calendarMonth--;

                if(calendarMonth < 0){
                    calendarMonth = 11;
                    calendarYear--;
                }

                renderCalendar();
            }
        );

    document
        .getElementById("nextMonthBtn")
        .addEventListener(
            "click",
            function(){
                calendarMonth++;

                if(calendarMonth > 11){
                    calendarMonth = 0;
                    calendarYear++;
                }

                renderCalendar();
            }
        );
}

/* Drives #selectedDate directly and re-fires its own "change" listener
   (see attachEvents) rather than duplicating that listener's sync/render
   calls here — keeps this the single place that reacts to the date
   actually changing, regardless of whether it came from a stepper click,
   the calendar-grid popover, or (pre-existing) a direct input edit. */
function stepSelectedDate(days){
    const input =
        document.getElementById("selectedDate");

    input.value =
        window.CrownDateStepper?.addDays?.(input.value, days) ||
        input.value;

    input.dispatchEvent(new Event("change"));
}

function initializeSelectedDate(){
    const input =
        document.getElementById(
            "selectedDate"
        );

    if(input.value){
        return;
    }

    const today =
        new Date();

    input.value = [
        today.getFullYear(),
        String(
            today.getMonth() + 1
        ).padStart(2, "0"),
        String(
            today.getDate()
        ).padStart(2, "0")
    ].join("-");
}

function getActiveBranch(){
    return (
        localStorage.getItem(
            THERAPIST_SALES_BRANCH_KEY
        ) || ""
    );
}

function readList(key){
    try{
        const raw =
            localStorage.getItem(key);

        const parsed =
            raw ? JSON.parse(raw) : [];

        return Array.isArray(parsed)
            ? parsed
            : [];
    }catch(error){
        console.error(
            `Unable to read ${key}:`,
            error
        );

        return [];
    }
}

function getTherapists(){
    const branch =
        getActiveBranch();

    return readList(
        THERAPIST_MASTER_KEY
    )
        .map(function(item){
            if(typeof item === "string"){
                return {
                    name: item,
                    branches: [],
                    status: "Active"
                };
            }

            return {
                name: item?.name || "",
                branches:
                    Array.isArray(
                        item?.branches
                    )
                        ? item.branches
                        : [],
                status:
                    item?.status ||
                    "Active"
            };
        })
        .filter(function(item){
            return (
                item.name &&
                item.status === "Active" &&
                (
                    item.branches.length === 0 ||
                    item.branches.includes(
                        branch
                    )
                )
            );
        })
        .map(function(item){
            return item.name;
        })
        .sort(function(a, b){
            return a.localeCompare(b);
        });
}

function getSelfViewTherapistName(){
    const user =
        window.CrownAuth?.getCurrentUser?.();

    /* A dual-role Therapist acting as Receptionist today gets the full
       (unlocked) view, same as a real Receptionist — only locked to
       their own name when today's effective role is Therapist. */
    const effectiveRole =
        window.CrownAuth?.getEffectiveRole?.(user) || user?.role;

    return (
        user &&
        effectiveRole === "Therapist" &&
        user.therapistName
    )
        ? user.therapistName
        : "";
}

function populateTherapistDropdown(){
    const select =
        document.getElementById(
            "therapistSelect"
        );

    const lockedName =
        getSelfViewTherapistName();

    if(lockedName){
        select.innerHTML = `
            <option value="${escapeHtml(lockedName)}">
                ${escapeHtml(lockedName)}
            </option>
        `;

        select.value =
            lockedName;

        select.disabled = true;

        const label =
            document.querySelector(
                'label[for="therapistSelect"]'
            );

        if(label){
            label.textContent =
                "Your Sales Report";
        }

        return;
    }

    const currentValue =
        select.value;

    select.innerHTML =
        '<option value="">Select Therapist</option>' +
        getTherapists()
            .map(function(name){
                return `
                    <option value="${escapeHtml(name)}">
                        ${escapeHtml(name)}
                    </option>
                `;
            })
            .join("");

    if(
        currentValue &&
        getTherapists().includes(
            currentValue
        )
    ){
        select.value =
            currentValue;
    }
}

function getServiceMaster(){
    return readList(
        SERVICE_MASTER_KEY
    )
        .map(function(item){
            if(typeof item === "string"){
                return {
                    name: item,
                    commission: 0,
                    overtimeCommission: 0,
                    duration: 0
                };
            }

            return {
                name: item?.name || "",
                commission:
                    Number(
                        item?.commission ??
                        item?.therapistCommission ??
                        0
                    ) || 0,
                overtimeCommission:
                    Number(item?.overtimeCommission ?? 0) || 0,
                duration:
                    Number(item?.duration) || 0
            };
        })
        .filter(function(item){
            return Boolean(item.name);
        });
}

/* Opening/Closing shift schedule, mirrored from payroll.js's
   SHIFT_SCHEDULES. Kept duplicated (payroll.js also uses its copy for
   hours-worked clamping, unrelated to this page) — but the actual
   overtime-commission FORMULA that reads it is shared now, see
   commission-shared.js's CrownCommission.getServiceCommissionRate(). */
const THERAPIST_SALES_SHIFT_SCHEDULES = {
    Opening: { start: "09:00", end: "18:00" },
    Closing: { start: "13:00", end: "22:00" }
};

function getTherapistUserId(therapistName){
    try{
        const parsed =
            JSON.parse(
                localStorage.getItem("crownUserAccounts")
            );

        const match =
            (Array.isArray(parsed) ? parsed : [])
                .find(function(user){
                    return user?.therapistName === therapistName;
                });

        return match?.id || null;
    }catch(error){
        return null;
    }
}

/* Shift type ("Opening"/"Closing") the therapist clocked under on one
   date/branch, read straight from the attendance log — same source
   payroll.js uses for the Overtime Commission threshold. */
function getShiftTypeForDate(userId, date, branch){
    if(!userId || !date){
        return "";
    }

    try{
        const parsed =
            JSON.parse(
                localStorage.getItem("crownAttendanceLog")
            );

        const entries =
            (Array.isArray(parsed) ? parsed : [])
                .filter(function(entry){
                    return (
                        entry.userId === userId &&
                        entry.date === date &&
                        (!branch || entry.branch === branch) &&
                        entry.clockInAt &&
                        entry.clockOutAt
                    );
                });

        return (
            entries
                .map(function(entry){ return entry.shiftType; })
                .find(Boolean) ||
            ""
        );
    }catch(error){
        return "";
    }
}

function getDailyRecord(
    branch,
    date
){
    if(!branch || !date){
        return [];
    }

    const key =
        `${THERAPIST_SALES_PREFIX}${branch}_${date}`;

    try{
        const raw =
            localStorage.getItem(key);

        const parsed =
            raw ? JSON.parse(raw) : null;

        return Array.isArray(
            parsed?.rows
        )
            ? parsed.rows.filter(function(sale){
                return sale.settled !== false;
            })
            : [];
    }catch(error){
        console.error(
            `Unable to read ${key}:`,
            error
        );

        return [];
    }
}

function getMonthRecords(
    branch,
    month
){
    const rows = [];

    if(!branch || !month){
        return rows;
    }

    const prefix =
        `${THERAPIST_SALES_PREFIX}${branch}_${month}-`;

    for(
        let index = 0;
        index < localStorage.length;
        index++
    ){
        const key =
            localStorage.key(index);

        if(
            !key ||
            !key.startsWith(prefix)
        ){
            continue;
        }

        try{
            const parsed =
                JSON.parse(
                    localStorage.getItem(key)
                );

            const date =
                parsed?.date ||
                key.slice(
                    `${THERAPIST_SALES_PREFIX}${branch}_`.length
                );

            if(
                Array.isArray(
                    parsed?.rows
                )
            ){
                parsed.rows
                    .filter(function(row){
                        return row.settled !== false;
                    })
                    .forEach(
                        function(row){
                            rows.push({
                                ...row,
                                reportDate: date
                            });
                        }
                    );
            }
        }catch(error){
            console.error(
                `Unable to read ${key}:`,
                error
            );
        }
    }

    return rows;
}

function extractTherapistServices(
    rows,
    therapist,
    branch
){
    const entries = [];

    if(!therapist){
        return entries;
    }

    const therapistUserId =
        getTherapistUserId(therapist);

    /* Shift lookup is the same for every item on the same date, so it's
       cached per date instead of re-reading the attendance log per item. */
    const shiftTypeByDate = {};

    function shiftTypeFor(date){
        if(!date){
            return "";
        }

        if(!(date in shiftTypeByDate)){
            shiftTypeByDate[date] =
                getShiftTypeForDate(therapistUserId, date, branch);
        }

        return shiftTypeByDate[date];
    }

    rows.forEach(function(sale){
        const items =
            Array.isArray(
                sale?.services
            )
                ? sale.services
                : [];

        items.forEach(function(item){
            const assignedTherapist =
                String(
                    item?.therapist ||
                    sale?.therapist ||
                    ""
                ).trim();

            if(assignedTherapist !== therapist){
                return;
            }
            const itemType =
                item?.itemType ||
                (
                    String(
                        item?.productKind || ""
                    ).includes("Voucher")
                        ? "Product"
                        : "Service"
                );

            if(itemType !== "Service"){
                return;
            }

            /* A Freebie's amount is always 0 (excluded from the client's
               total) — its real value, and the commission basis, lives
               in freebieValue instead. */
            const serviceCost =
                item?.isFreebie
                    ? (Number(item?.freebieValue) || 0)
                    : (Number(item?.amount) || 0);

            const serviceMeta =
                getServiceMaster()
                    .find(function(entry){
                        return entry.name === item?.name;
                    }) || {};

            const date =
                sale?.reportDate || "";

            const shiftType =
                shiftTypeFor(date);

            const shiftEndTime =
                THERAPIST_SALES_SHIFT_SCHEDULES[shiftType]?.end || "";

            const commissionRate =
                CrownCommission.getServiceCommissionRate(
                    serviceMeta,
                    date,
                    item?.serviceStartTime,
                    shiftEndTime
                );

            const commission =
                serviceCost *
                (
                    commissionRate / 100
                );

            entries.push({
                client:
                    item?.participantName ||
                    sale?.client ||
                    "—",
                service:
                    item?.name || "—",
                serviceCost:
                    serviceCost,
                commissionRate:
                    commissionRate,
                commission:
                    commission,
                reportDate:
                    sale?.reportDate || ""
            });
        });
    });

    return entries;
}

function initializeCalendar(){
    syncCalendarToSelectedDate();
}

/* Collapsed calendar: the month grid only shows inside a popover opened
   from a compact "Select date" pill, so the layout stays clean instead of
   always displaying the full month. */
function initializeDateDropdown(){
    const trigger = document.getElementById("dateDropdownTrigger");
    const popover = document.getElementById("calendarPopover");

    if(!trigger || !popover){
        return;
    }

    trigger.addEventListener("click", function(event){
        event.stopPropagation();
        popover.classList.toggle("d-none");
    });

    popover.addEventListener("click", function(event){
        event.stopPropagation();
    });

    document.addEventListener("click", function(){
        popover.classList.add("d-none");
    });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            popover.classList.add("d-none");
        }
    });

    updateDateDropdownLabel();
}

function updateDateDropdownLabel(){
    const label = document.getElementById("dateDropdownValue");
    const value = document.getElementById("selectedDate").value;

    if(!label){
        return;
    }

    label.textContent =
        value
            ? new Date(value + "T00:00:00").toLocaleDateString(
                "en-PH",
                { month: "long", day: "numeric", year: "numeric" }
              )
            : "Select date";
}

function syncCalendarToSelectedDate(){
    const value =
        document
            .getElementById(
                "selectedDate"
            )
            .value;

    const parts =
        value.split("-");

    calendarYear =
        Number(parts[0]);

    calendarMonth =
        Number(parts[1]) - 1;

    renderCalendar();
}

function renderCalendar(){
    const grid =
        document.getElementById(
            "calendarGrid"
        );

    const title =
        document.getElementById(
            "calendarTitle"
        );

    const selectedDate =
        document
            .getElementById(
                "selectedDate"
            )
            .value;

    const therapist =
        document
            .getElementById(
                "therapistSelect"
            )
            .value;

    const branch =
        getActiveBranch();

    title.textContent =
        new Date(
            calendarYear,
            calendarMonth,
            1
        ).toLocaleDateString(
            "en-PH",
            {
                month: "long",
                year: "numeric"
            }
        );

    grid.innerHTML = "";

    const firstDay =
        new Date(
            calendarYear,
            calendarMonth,
            1
        ).getDay();

    const daysInMonth =
        new Date(
            calendarYear,
            calendarMonth + 1,
            0
        ).getDate();

    for(
        let index = 0;
        index < firstDay;
        index++
    ){
        const filler =
            document.createElement(
                "div"
            );

        filler.className =
            "calendar-cell empty";

        grid.appendChild(filler);
    }

    const today =
        new Date();

    const todayValue = [
        today.getFullYear(),
        String(
            today.getMonth() + 1
        ).padStart(2, "0"),
        String(
            today.getDate()
        ).padStart(2, "0")
    ].join("-");

    for(
        let day = 1;
        day <= daysInMonth;
        day++
    ){
        const dateValue = [
            calendarYear,
            String(
                calendarMonth + 1
            ).padStart(2, "0"),
            String(day).padStart(2, "0")
        ].join("-");

        const cell =
            document.createElement(
                "button"
            );

        cell.type = "button";
        cell.className =
            "calendar-cell";
        cell.textContent = day;

        if(
            dateValue ===
            selectedDate
        ){
            cell.classList.add(
                "selected"
            );
        }

        if(
            dateValue ===
            todayValue
        ){
            cell.classList.add(
                "today"
            );
        }

        if(
            branch &&
            therapist &&
            hasTherapistSalesOnDate(
                branch,
                dateValue,
                therapist
            )
        ){
            cell.classList.add(
                "has-data"
            );
        }

        cell.addEventListener(
            "click",
            function(){
                document
                    .getElementById(
                        "selectedDate"
                    )
                    .value =
                        dateValue;

                renderCalendar();
                renderTherapistSales();
                updateDateDropdownLabel();
                document.getElementById("calendarPopover")?.classList.add("d-none");
            }
        );

        grid.appendChild(cell);
    }
}

function hasTherapistSalesOnDate(
    branch,
    date,
    therapist
){
    const rows =
        getDailyRecord(
            branch,
            date
        );

    return extractTherapistServices(
        rows,
        therapist,
        branch
    ).length > 0;
}

function updateBranchState(){
    const branch =
        getActiveBranch();

    const noBranchState =
        document
            .getElementById(
                "noBranchState"
            );

    const content =
        document
            .getElementById(
                "therapistSalesContent"
            );

    if(!branch){
        noBranchState.classList.remove(
            "d-none"
        );

        content.classList.add(
            "d-none"
        );
    }else{
        noBranchState.classList.add(
            "d-none"
        );

        content.classList.remove(
            "d-none"
        );
    }
}

function renderTherapistSales(){
    updateBranchState();
    populateTherapistDropdown();

    const branch =
        getActiveBranch();

    const therapist =
        document
            .getElementById(
                "therapistSelect"
            )
            .value;

    const selectedDate =
        document
            .getElementById(
                "selectedDate"
            )
            .value;

    if(!branch){
        return;
    }

    const selectedMonth =
        selectedDate.slice(0, 7);

    const dailyRows =
        getDailyRecord(
            branch,
            selectedDate
        );

    const dailyEntries =
        extractTherapistServices(
            dailyRows.map(function(row){
                return {
                    ...row,
                    reportDate:
                        selectedDate
                };
            }),
            therapist,
            branch
        );

    const monthlyRows =
        getMonthRecords(
            branch,
            selectedMonth
        );

    const monthlyEntries =
        extractTherapistServices(
            monthlyRows,
            therapist,
            branch
        );

    renderSalesTable(
        "dailySalesBody",
        dailyEntries
    );

    renderMonthlySalesTable(
        "monthlySalesBody",
        monthlyEntries
    );

    const dailySummary =
        summarizeEntries(
            dailyEntries
        );

    const monthlySummary =
        summarizeEntries(
            monthlyEntries
        );

    setDailySummary(
        dailySummary
    );

    setMonthlySummary(
        monthlySummary
    );

    updateTitles(
        therapist,
        selectedDate
    );
}

function renderSalesTable(
    bodyId,
    entries
){
    const body =
        document.getElementById(
            bodyId
        );

    body.innerHTML = "";

    entries.forEach(
        function(entry, index){
            const row =
                document.createElement(
                    "tr"
                );

            row.innerHTML = `
                <td class="number-cell">
                    ${index + 1}
                </td>

                <td>
                    <strong class="client-name">
                        ${escapeHtml(entry.client)}
                    </strong>
                </td>

                <td>
                    <div class="service-cell">
                        <strong>
                            ${escapeHtml(entry.service)}
                        </strong>

                        <small>
                            Commission Rate:
                            ${formatNumber(entry.commissionRate)}%
                        </small>
                    </div>
                </td>

                <td class="amount-cell">
                    ${peso(entry.serviceCost)}
                </td>

                <td class="commission-cell">
                    ${peso(entry.commission)}
                </td>
            `;

            body.appendChild(row);
        }
    );

    if(entries.length === 0){
        const row =
            document.createElement(
                "tr"
            );

        row.innerHTML = `
            <td
                colspan="5"
                class="no-data-cell"
            >
                No service sales found for the selected therapist.
            </td>
        `;

        body.appendChild(row);
    }
}

function renderMonthlySalesTable(
    bodyId,
    entries
){
    const body =
        document.getElementById(
            bodyId
        );

    body.innerHTML = "";

    const byDate = new Map();

    entries.forEach(function(entry){
        const dateKey =
            entry.reportDate || "";

        if(!byDate.has(dateKey)){
            byDate.set(
                dateKey,
                {
                    serviceCount: 0,
                    sales: 0,
                    commission: 0
                }
            );
        }

        const group =
            byDate.get(dateKey);

        group.serviceCount += 1;

        group.sales +=
            Number(entry.serviceCost) || 0;

        group.commission +=
            Number(entry.commission) || 0;
    });

    const dateKeys =
        Array.from(byDate.keys())
            .sort();

    dateKeys.forEach(function(dateKey){
        const group =
            byDate.get(dateKey);

        const row =
            document.createElement(
                "tr"
            );

        row.innerHTML = `
            <td>
                ${escapeHtml(formatDate(dateKey))}
            </td>

            <td>
                ${formatNumber(group.serviceCount)}
            </td>

            <td class="amount-cell">
                ${peso(group.sales)}
            </td>

            <td class="commission-cell">
                ${peso(group.commission)}
            </td>
        `;

        body.appendChild(row);
    });

    if(dateKeys.length === 0){
        const row =
            document.createElement(
                "tr"
            );

        row.innerHTML = `
            <td
                colspan="4"
                class="no-data-cell"
            >
                No service sales found for the selected therapist.
            </td>
        `;

        body.appendChild(row);
    }
}

function summarizeEntries(entries){
    return entries.reduce(
        function(summary, entry){
            summary.count += 1;

            summary.sales +=
                Number(
                    entry.serviceCost
                ) || 0;

            summary.commission +=
                Number(
                    entry.commission
                ) || 0;

            return summary;
        },
        {
            count: 0,
            sales: 0,
            commission: 0
        }
    );
}

function setDailySummary(summary){
    document
        .getElementById(
            "dailySalesTotal"
        )
        .textContent =
            peso(summary.sales);

    document
        .getElementById(
            "dailyCommissionTotal"
        )
        .textContent =
            peso(
                summary.commission
            );
}

function setMonthlySummary(summary){
    document
        .getElementById(
            "monthlyServiceCount"
        )
        .textContent =
            formatNumber(
                summary.count
            );

    document
        .getElementById(
            "monthlySalesCard"
        )
        .textContent =
            peso(summary.sales);

    document
        .getElementById(
            "monthlyCommissionCard"
        )
        .textContent =
            peso(
                summary.commission
            );
}

function updateTitles(
    therapist,
    selectedDate
){
    const dateLabel =
        formatDate(selectedDate);

    const monthLabel =
        new Date(
            `${selectedDate.slice(0, 7)}-01T00:00:00`
        ).toLocaleDateString(
            "en-PH",
            {
                month: "long",
                year: "numeric"
            }
        );

    document
        .getElementById(
            "dailyReportTitle"
        )
        .textContent =
            therapist
                ? `${therapist} — Daily Service Sales`
                : "Daily Service Sales";

    document
        .getElementById(
            "dailyReportSubtitle"
        )
        .textContent =
            therapist
                ? dateLabel
                : "Select a therapist to view activity.";

    document
        .getElementById(
            "monthlyReportTitle"
        )
        .textContent =
            therapist
                ? `${therapist} — Monthly Service Sales`
                : "Monthly Service Sales";

    document
        .getElementById(
            "monthlyReportSubtitle"
        )
        .textContent =
            therapist
                ? monthLabel
                : "Select a therapist to view activity.";
}

function formatDate(value){
    if(!value){
        return "";
    }

    return new Date(
        `${value}T00:00:00`
    ).toLocaleDateString(
        "en-PH",
        {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        }
    );
}

function formatNumber(value){
    return Number(value || 0)
        .toLocaleString(
            "en-PH",
            {
                maximumFractionDigits: 2
            }
        );
}

function peso(value){
    return (
        "₱" +
        Number(value || 0)
            .toLocaleString(
                "en-PH",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            )
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
