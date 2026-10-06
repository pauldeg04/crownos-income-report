const RECEPTIONIST_SALES_BRANCH_KEY = "crownSelectedBranch";
const RECEPTIONIST_SALES_PREFIX = "crownDailySales_";

let calendarYear;
let calendarMonth;

document.addEventListener("DOMContentLoaded", function(){
    initializeSelectedDate();
    initializeCalendar();
    initializeDateDropdown();
    attachEvents();
    updateBranchState();
    renderReceptionistSales();
});

function attachEvents(){
    document
        .getElementById("selectedDate")
        .addEventListener(
            "change",
            function(){
                syncCalendarToSelectedDate();
                renderReceptionistSales();
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
            RECEPTIONIST_SALES_BRANCH_KEY
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

function getDailyRecord(
    branch,
    date
){
    if(!branch || !date){
        return [];
    }

    const key =
        `${RECEPTIONIST_SALES_PREFIX}${branch}_${date}`;

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
        `${RECEPTIONIST_SALES_PREFIX}${branch}_${month}-`;

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
                    `${RECEPTIONIST_SALES_PREFIX}${branch}_`.length
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
            getDailyRecord(branch, dateValue).length > 0
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
                renderReceptionistSales();
                updateDateDropdownLabel();
                document.getElementById("calendarPopover")?.classList.add("d-none");
            }
        );

        grid.appendChild(cell);
    }
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
                "receptionistSalesContent"
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

/* ---- Point system (from the Receptionist Sales point table) ----
   Services are matched by name keywords first (the service master uses
   "Crown Reset", "The Reset Duo", etc.), then by cost as a fallback so a
   renamed/new service still earns points when its price is on the table.
   Anything that can't be matched earns 0 and is flagged in the table. */
const POINTS_BY_COST = {
    600: 3, 900: 4, 1000: 5, 1400: 7, 1500: 7,
    2000: 10, 2300: 11, 3400: 17
};

function getPointsForItem(item, unitCost){
    const name = String(item?.name || "").toLowerCase();
    const qty = Math.max(Number(item?.quantity) || 1, 1);

    const itemType =
        item?.itemType ||
        (String(item?.productKind || "").includes("Voucher") ? "Product" : "Service");

    if(itemType === "Product"){
        return { points: 1 * qty, known: true, category: "Products" };
    }

    if(/add[\s-]?ons?\b/.test(name)){
        return { points: 1 * qty, known: true, category: "Add-ons" };
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
        ? { points: 0, known: false, category: category }
        : { points: each * qty, known: true, category: category };
}

/* One entry per item; transaction number is shared by items of one sale. */
function extractEntries(rows, date){
    const entries = [];

    rows.forEach(function(sale, saleIndex){
        const items = Array.isArray(sale?.services) ? sale.services : [];

        items.forEach(function(item, itemIndex){
            const qty = Math.max(Number(item?.quantity) || 1, 1);

            const cost = item?.isFreebie
                ? (Number(item?.freebieValue) || 0)
                : (Number(item?.amount) || 0);

            const result = getPointsForItem(item, cost / qty);

            entries.push({
                txn: saleIndex + 1,
                first: itemIndex === 0,
                client: item?.participantName || sale?.client || "—",
                clientOwner: sale?.client || "—",
                service: (item?.name || "—") + (qty > 1 ? ` × ${qty}` : ""),
                baseName: item?.name || "—",
                category: result.category,
                cost: cost,
                points: result.points,
                known: result.known,
                reportDate: date
            });
        });
    });

    return entries;
}

/* Receptionist(s) clocked in at this branch on this date, from the
   attendance log. */
function getReceptionistsOnDuty(branch, date){
    let log = [];
    let users = [];

    try{ log = JSON.parse(localStorage.getItem("crownAttendanceLog")) || []; }catch(e){}
    try{ users = JSON.parse(localStorage.getItem("crownUserAccounts")) || []; }catch(e){}

    const names = [];

    (Array.isArray(log) ? log : []).forEach(function(entry){
        if(
            entry.date !== date ||
            (branch && entry.branch !== branch) ||
            !entry.clockInAt ||
            (entry.dutyRole || entry.role) !== "Receptionist"
        ){
            return;
        }

        const user = users.find(function(u){ return u.id === entry.userId; });

        const name =
            user?.nickname ||
            user?.firstName ||
            user?.account ||
            entry.account ||
            "";

        if(name && !names.includes(name)){
            names.push(name);
        }
    });

    return names;
}

function renderReceptionistSales(){
    updateBranchState();

    const branch = getActiveBranch();
    const selectedDate = document.getElementById("selectedDate").value;

    if(!branch){
        return;
    }

    const dailyEntries =
        extractEntries(getDailyRecord(branch, selectedDate), selectedDate);

    renderDailyTable(dailyEntries);

    const dailySales = dailyEntries.reduce(function(s, e){ return s + e.cost; }, 0);
    const dailyPoints = dailyEntries.reduce(function(s, e){ return s + e.points; }, 0);

    document.getElementById("dailySalesTotal").textContent = peso(dailySales);
    document.getElementById("dailyPointsTotal").textContent = formatNumber(dailyPoints);

    renderMonthly(branch, selectedDate.slice(0, 7));
    updateTitles(selectedDate);
}

function renderDailyTable(entries){
    const body = document.getElementById("dailySalesBody");

    body.innerHTML = entries.map(function(entry){
        return `
            <tr>
                <td class="number-cell">${entry.first ? entry.txn : ""}</td>
                <td>${entry.first ? `<strong class="client-name">${escapeHtml(entry.clientOwner)}</strong>` : ""}</td>
                <td>
                    <div class="service-cell">
                        <strong>${escapeHtml(entry.service)}</strong>
                        ${entry.known ? "" : "<small>No point value set</small>"}
                    </div>
                </td>
                <td class="amount-cell">${peso(entry.cost)}</td>
                <td class="commission-cell">${formatNumber(entry.points)}</td>
            </tr>
        `;
    }).join("");

    if(entries.length === 0){
        body.innerHTML = `
            <tr>
                <td colspan="5" class="no-data-cell">
                    No sales found for the selected date.
                </td>
            </tr>
        `;
    }
}

function renderMonthly(branch, month){
    const body = document.getElementById("monthlySalesBody");
    const prefix = `${RECEPTIONIST_SALES_PREFIX}${branch}_${month}-`;
    const days = [];
    const monthEntries = [];

    for(let i = 0; i < localStorage.length; i++){
        const key = localStorage.key(i);

        if(!key || !key.startsWith(prefix)){
            continue;
        }

        const date = key.slice(`${RECEPTIONIST_SALES_PREFIX}${branch}_`.length);
        const entries = extractEntries(getDailyRecord(branch, date), date);

        if(entries.length === 0){
            continue;
        }

        monthEntries.push.apply(monthEntries, entries);

        days.push({
            date: date,
            names: getReceptionistsOnDuty(branch, date),
            sales: entries.reduce(function(s, e){ return s + e.cost; }, 0),
            points: entries.reduce(function(s, e){ return s + e.points; }, 0),
            txns: entries.filter(function(e){ return e.first; }).length
        });
    }

    days.sort(function(a, b){ return a.date.localeCompare(b.date); });

    body.innerHTML = days.map(function(day){
        return `
            <tr>
                <td>${escapeHtml(formatDate(day.date))}</td>
                <td>${day.names.length ? escapeHtml(day.names.join(", ")) : "—"}</td>
                <td class="amount-cell">${peso(day.sales)}</td>
                <td class="commission-cell">${formatNumber(day.points)}</td>
            </tr>
        `;
    }).join("");

    if(days.length === 0){
        body.innerHTML = `
            <tr>
                <td colspan="4" class="no-data-cell">
                    No sales found for the selected month.
                </td>
            </tr>
        `;
    }

    renderServicePoints(monthEntries);

    document.getElementById("monthlyServiceCount").textContent =
        formatNumber(days.reduce(function(s, d){ return s + d.txns; }, 0));
    document.getElementById("monthlySalesCard").textContent =
        peso(days.reduce(function(s, d){ return s + d.sales; }, 0));
    document.getElementById("monthlyPointsCard").textContent =
        formatNumber(days.reduce(function(s, d){ return s + d.points; }, 0));
}

/* Month totals per service/product name; every add-on and product is its
   own row. */
function renderServicePoints(entries){
    const body = document.getElementById("servicePointsBody");
    const groups = new Map();

    entries.forEach(function(entry){
        const key = entry.category + "|" + entry.baseName;

        if(!groups.has(key)){
            groups.set(key, {
                name: entry.baseName,
                category: entry.category,
                sales: 0,
                points: 0
            });
        }

        const group = groups.get(key);
        group.sales += entry.cost;
        group.points += entry.points;
    });

    const order = ["Head Spa", "Massage", "Combo", "Add-ons", "Products", "Other"];

    const rows = Array.from(groups.values()).sort(function(a, b){
        return (order.indexOf(a.category) - order.indexOf(b.category)) ||
            a.name.localeCompare(b.name);
    });

    body.innerHTML = rows.map(function(row){
        return `
            <tr>
                <td><strong>${escapeHtml(row.name)}</strong></td>
                <td>${escapeHtml(row.category)}</td>
                <td class="amount-cell">${peso(row.sales)}</td>
                <td class="commission-cell">${formatNumber(row.points)}</td>
            </tr>
        `;
    }).join("");

    if(rows.length === 0){
        body.innerHTML = `
            <tr>
                <td colspan="4" class="no-data-cell">
                    No sales found for the selected month.
                </td>
            </tr>
        `;
    }
}

function updateTitles(selectedDate){
    const monthLabel = new Date(`${selectedDate.slice(0, 7)}-01T00:00:00`)
        .toLocaleDateString("en-PH", { month: "long", year: "numeric" });

    document.getElementById("dailyReportSubtitle").textContent = formatDate(selectedDate);
    document.getElementById("monthlyReportSubtitle").textContent = monthLabel;
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
