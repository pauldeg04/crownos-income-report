/* ==========================================================================
   Crown Head Spa — Admin Dashboard (Admin only)
   Read-only overview of every branch at once: notifications (payments due,
   Budget / Leave / Incident / Booking requests), the Statistics summary,
   the Share Holder summary and the Therapist points list.

   Nothing is stored here — it reads the same crown* localStorage keys and
   Firestore collections the individual pages use, and mirrors their
   calculations (Statistics, Share Holder Summary Report, Expenses Report,
   Therapist / Receptionist Sales points).
   ========================================================================== */

(function(){
    const SALES_PREFIX = "crownDailySales_";
    const EXPENSE_PREFIX = "crownExpenses_";
    const RECURRING_PREFIX = "crownRecurring_";
    const RECURRING_KEYS = ["utilities", "installments"];
    const LEDGER_KEYS = ["operation", "salary", "gov", "marketing"];
    const SHAREHOLDERS_KEY = "crownShareholders";
    const THERAPIST_KEY = "crownTherapistMasterList";

    /* Live Firestore counts, filled by the listeners below. */
    const live = {
        booking: null,
        budget: null,
        leave: null,
        incident: null
    };

    function $(id){ return document.getElementById(id); }

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function peso(amount){
        const value = Number(amount) || 0;
        const formatted = Math.abs(value).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return (value < 0 ? "-₱" : "₱") + formatted;
    }

    function formatNumber(value){
        return (Number(value) || 0).toLocaleString("en-PH");
    }

    function readJson(key, fallback){
        try{
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        }catch(error){
            return fallback;
        }
    }

    /* Branches flagged "Show on Admin Dashboard" in List of Branches
       (shown unless explicitly switched off). */
    function getBranches(){
        const all = window.CrownAuth?.getAllBranchNames?.() || [];
        const master = readJson("crownBranchMasterList", []);

        const hidden = new Set(
            (Array.isArray(master) ? master : [])
                .filter(function(b){ return b && typeof b === "object" && b.showOnAdminDashboard === false; })
                .map(function(b){ return b.name; })
        );

        return all.filter(function(name){ return !hidden.has(name); });
    }

    function getMonth(){
        return $("adMonth").value || currentMonthKey();
    }

    function currentMonthKey(){
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function monthLabel(monthKey){
        return new Date(monthKey + "-01T00:00:00")
            .toLocaleDateString("en-PH", { month: "long", year: "numeric" });
    }

    function daysInMonth(year, month){
        return new Date(year, month, 0).getDate();
    }

    /* ======================================================================
       Sales data
       ====================================================================== */

    function normalizeName(value){
        return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function isVipCard(value){
        const n = normalizeName(value);
        return n === "vipcard" || n.includes("vipmembershipcard") || n.includes("viployaltycard");
    }

    function isVoucherProduct(item){
        const name = String(item?.name || "");
        return (
            item?.productKind === "Service Voucher" ||
            item?.virtualProduct === true ||
            name.startsWith("Voucher — ") ||
            name.startsWith("Voucher - ") ||
            normalizeName(name).startsWith("voucher")
        );
    }

    function itemTypeOf(item){
        return item?.itemType || (isVoucherProduct(item) ? "Product" : "Service");
    }

    function itemQuantity(item){
        return itemTypeOf(item) === "Product" ? Math.max(1, Number(item?.quantity) || 1) : 1;
    }

    function itemAmount(item){
        const saved = Number(item?.amount);
        if(Number.isFinite(saved)){ return saved; }
        return itemQuantity(item) * (Number(item?.unitPrice) || 0);
    }

    /* Settled sale rows of one branch for one month, each tagged with its
       reportDate. Rows with no settled flag (legacy) count as settled,
       matching Statistics. */
    function getMonthlySales(branch, month){
        const rows = [];
        const prefix = SALES_PREFIX + branch + "_" + month + "-";

        for(let i = 0; i < localStorage.length; i++){
            const key = localStorage.key(i);
            if(!key || !key.startsWith(prefix)){ continue; }

            const data = readJson(key, null);
            if(!Array.isArray(data?.rows)){ continue; }

            data.rows.forEach(function(sale){
                if(sale.settled === false){ return; }
                rows.push(Object.assign({}, sale, {
                    reportDate: data.date || key.slice((SALES_PREFIX + branch + "_").length)
                }));
            });
        }

        return rows;
    }

    function saleNet(sale){
        if(sale?.netAmount !== undefined){
            return Math.max(0, Number(sale.netAmount) || 0);
        }
        return (Array.isArray(sale?.services) ? sale.services : [])
            .reduce(function(sum, item){ return sum + Math.max(0, Number(item?.amount) || 0); }, 0);
    }

    function pointsFor(item){
        const qty = Math.max(Number(item?.quantity) || 1, 1);
        const cost = item?.isFreebie ? (Number(item?.freebieValue) || 0) : (Number(item?.amount) || 0);
        return window.CrownPoints?.getPointsForItem?.(item, cost / qty) || { points: 0, category: "Other" };
    }

    function computeBranchStats(branch, month){
        const sales = getMonthlySales(branch, month);
        const stats = {
            services: { quantity: 0, amount: 0 },
            products: { quantity: 0, amount: 0 },
            vip: { quantity: 0, amount: 0 },
            points: 0,
            pointsByCategory: {},
            total: 0,
            daily: [],
            hasData: sales.length > 0
        };

        const [year, mon] = month.split("-").map(Number);
        const days = daysInMonth(year, mon);
        const byDate = {};

        for(let d = 1; d <= days; d++){
            const date = month + "-" + String(d).padStart(2, "0");
            byDate[date] = 0;
        }

        sales.forEach(function(sale){
            if(sale.reportDate in byDate){
                const net = saleNet(sale);
                byDate[sale.reportDate] += net;
                stats.total += net;
            }

            (Array.isArray(sale.services) ? sale.services : []).forEach(function(item){
                const qty = itemQuantity(item);
                const amount = itemAmount(item);

                if(itemTypeOf(item) === "Service"){
                    stats.services.quantity += 1;
                    stats.services.amount += amount;
                }else if(isVipCard(item?.name)){
                    stats.vip.quantity += qty;
                    stats.vip.amount += amount;
                }else if(!isVoucherProduct(item)){
                    stats.products.quantity += qty;
                    stats.products.amount += amount;
                }

                const result = pointsFor(item);
                if(result.points > 0){
                    stats.points += result.points;
                    stats.pointsByCategory[result.category] =
                        (stats.pointsByCategory[result.category] || 0) + result.points;
                }
            });
        });

        stats.daily = Object.keys(byDate).sort().map(function(date){
            return { date: date, revenue: byDate[date] };
        });

        return stats;
    }

    /* ======================================================================
       1. Notifications
       ====================================================================== */

    function addMonthsToKey(monthKey, delta){
        const [y, m] = monthKey.split("-").map(Number);
        const total = y * 12 + (m - 1) + delta;
        return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
    }

    function recurringActive(item, monthKey){
        const start = item.startDate ? item.startDate.slice(0, 7) : "";
        if(!start || monthKey < start){ return false; }
        if(item.continues){ return true; }
        return !!item.endMonth && monthKey <= item.endMonth;
    }

    function recurringDue(item, monthKey){
        const [y, m] = monthKey.split("-").map(Number);
        const due = new Date(y, m - 1, Math.min(item.dueDay || 1, daysInMonth(y, m)));
        due.setHours(0, 0, 0, 0);
        return due;
    }

    function recurringAmount(item, monthKey){
        if(item.amountType === "varies"){
            return Number((item.monthlyAmounts || {})[monthKey]) || 0;
        }
        return Number(item.fixedAmount) || 0;
    }

    /* Same rule as Expenses Report: unsettled items due within 5 days, plus
       anything already past due, until it is marked Settled. */
    function getPaymentsDue(branch){
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thisMonth = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0");
        const months = [addMonthsToKey(thisMonth, -1), thisMonth, addMonthsToKey(thisMonth, 1)];
        const rows = [];

        RECURRING_KEYS.forEach(function(tableKey){
            const items = readJson(RECURRING_PREFIX + tableKey + "_" + branch, []);
            if(!Array.isArray(items)){ return; }

            items.forEach(function(item){
                months.forEach(function(monthKey){
                    if(!recurringActive(item, monthKey)){ return; }
                    if(item.settledMonths && item.settledMonths[monthKey]){ return; }

                    const due = recurringDue(item, monthKey);
                    const diff = Math.round((due - today) / 86400000);
                    if(diff > 5){ return; }

                    rows.push({
                        particular: item.particular,
                        due: due,
                        overdue: diff < 0,
                        amount: recurringAmount(item, monthKey)
                    });
                });
            });
        });

        rows.sort(function(a, b){ return a.due - b.due; });
        return rows;
    }

    function countRow(label, value, href, extra){
        const display = value === null ? "…" : formatNumber(value);
        const cls = value ? "ad-count has-items" : "ad-count";

        return `
            <a class="ad-notice-row" href="${href}">
                <span class="ad-notice-label">${label}</span>
                <span class="ad-notice-right">
                    ${extra ? `<span class="ad-notice-extra">${extra}</span>` : ""}
                    <span class="${cls}">${display}</span>
                </span>
            </a>
        `;
    }

    function countFor(bucket, branch){
        if(!bucket){ return null; }
        return bucket[branch] || 0;
    }

    function renderNotifications(){
        const container = $("adNotifications");
        const branches = getBranches();

        if(branches.length === 0){
            container.innerHTML = `<div class="col-12"><div class="ad-empty">No branches found.</div></div>`;
            return;
        }

        container.innerHTML = branches.map(function(branch){
            const payments = getPaymentsDue(branch);

            const paymentHtml = payments.length === 0
                ? `<div class="ad-empty-sm">No payments due in the next 5 days.</div>`
                : payments.map(function(row){
                    const dueLabel = row.due.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
                    return `
                        <div class="ad-payment-row">
                            <div class="ad-payment-main">
                                <span class="ad-payment-name">${escapeHtml(row.particular)}</span>
                                <span class="ad-payment-sub">Due ${dueLabel}</span>
                            </div>
                            <div class="ad-payment-meta">
                                <span class="ad-badge ${row.overdue ? "ad-badge-danger" : "ad-badge-warn"}">${row.overdue ? "Past Due" : "Due Soon"}</span>
                                <span class="ad-payment-amount">${peso(row.amount)}</span>
                            </div>
                        </div>
                    `;
                }).join("");

            const budgetTotal = live.budget ? (live.budget.amounts[branch] || 0) : 0;

            return `
                <div class="col-lg-6">
                    <div class="ad-card">
                        <h4 class="ad-card-title">${escapeHtml(branch)}</h4>

                        <div class="ad-subhead">For Payment (Next 5 Days)</div>
                        <div class="ad-payments">${paymentHtml}</div>

                        <div class="ad-subhead">Requests</div>
                        ${countRow("Budget Request — New Request", countFor(live.budget?.counts, branch), "budget-request.html",
                            budgetTotal ? peso(budgetTotal) : "")}
                        ${countRow("Leave Request — Pending", countFor(live.leave, branch), "leave-requests.html")}
                        ${countRow("Incident Report — Not yet acknowledged", countFor(live.incident, branch), "incident-report.html")}
                        ${countRow("Booking Request — Pending", countFor(live.booking, branch), "booking-requests.html")}
                    </div>
                </div>
            `;
        }).join("");
    }

    /* ---------- Firestore listeners (counts only) ---------- */

    function bump(map, branch){
        if(!branch){ return; }
        map[branch] = (map[branch] || 0) + 1;
    }

    function leaveBranch(request, users){
        if(Array.isArray(request.requesterBranches) && request.requesterBranches.length > 0){
            return request.requesterBranches[0];
        }
        const user = users.find(function(u){ return u.account === request.requesterAccount; });
        return user?.branches?.[0] || "";
    }

    function startListeners(){
        const db = firebase.firestore();
        const refresh = renderNotifications;

        db.collection("bookingRequests").where("status", "==", "pending")
            .onSnapshot(function(snapshot){
                const counts = {};
                snapshot.forEach(function(doc){ bump(counts, doc.data().branch); });
                live.booking = counts;
                refresh();
            }, function(error){ console.error("Booking requests:", error); });

        db.collection("budgetRequests").where("status", "==", "Pending")
            .onSnapshot(function(snapshot){
                const counts = {};
                const amounts = {};
                snapshot.forEach(function(doc){
                    const r = doc.data();
                    bump(counts, r.branch);
                    amounts[r.branch] = (amounts[r.branch] || 0) + (Number(r.amount) || 0);
                });
                live.budget = { counts: counts, amounts: amounts };
                refresh();
            }, function(error){ console.error("Budget requests:", error); });

        db.collection("leaveRequests").where("status", "in", ["Pending", "Processing"])
            .onSnapshot(function(snapshot){
                const users = window.CrownAuth?.getUsers?.() || [];
                const counts = {};
                snapshot.forEach(function(doc){ bump(counts, leaveBranch(doc.data(), users)); });
                live.leave = counts;
                refresh();
            }, function(error){ console.error("Leave requests:", error); });

        db.collection("incidentReports")
            .onSnapshot(function(snapshot){
                const counts = {};
                snapshot.forEach(function(doc){
                    const r = doc.data();
                    if(r.acknowledged !== true){ bump(counts, r.branch); }
                });
                live.incident = counts;
                refresh();
            }, function(error){ console.error("Incident reports:", error); });
    }

    /* ======================================================================
       2. Statistics
       ====================================================================== */

    function sparkline(daily){
        const width = 320;
        const height = 70;
        const max = Math.max.apply(null, daily.map(function(d){ return d.revenue; }).concat([1]));
        const step = daily.length > 1 ? width / (daily.length - 1) : width;

        const points = daily.map(function(d, i){
            const x = (i * step).toFixed(1);
            const y = (height - 4 - (d.revenue / max) * (height - 12)).toFixed(1);
            return x + "," + y;
        });

        return `
            <svg class="ad-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Daily sales trend">
                <polygon points="0,${height} ${points.join(" ")} ${width},${height}" class="ad-spark-area"></polygon>
                <polyline points="${points.join(" ")}" class="ad-spark-line"></polyline>
            </svg>
        `;
    }

    function statCard(label, quantity, amount){
        return `
            <article class="ad-stat">
                <span>${label}</span>
                <strong>${formatNumber(quantity)}</strong>
                <small>${peso(amount)}</small>
            </article>
        `;
    }

    function renderStatistics(month){
        const branches = getBranches();
        $("adStatsMonthLabel").textContent = "· " + monthLabel(month);

        $("adStatistics").innerHTML = branches.map(function(branch){
            const s = computeBranchStats(branch, month);
            const active = s.daily.filter(function(d){ return d.revenue > 0; });
            const highest = active.length ? active.reduce(function(a, b){ return b.revenue > a.revenue ? b : a; }) : null;
            const average = s.daily.length ? s.total / s.daily.length : 0;

            const categoryChips = Object.keys(s.pointsByCategory)
                .sort(function(a, b){ return s.pointsByCategory[b] - s.pointsByCategory[a]; })
                .map(function(cat){
                    return `<span class="ad-chip">${escapeHtml(cat)} <b>${formatNumber(s.pointsByCategory[cat])}</b></span>`;
                }).join("");

            return `
                <div class="ad-branch-block">
                    <h4 class="ad-card-title">${escapeHtml(branch)}</h4>
                    <div class="ad-stat-grid">
                        ${statCard("Services Availed", s.services.quantity, s.services.amount)}
                        ${statCard("Products Sold", s.products.quantity, s.products.amount)}
                        ${statCard("VIP Cards Sold", s.vip.quantity, s.vip.amount)}

                        <article class="ad-stat ad-stat-wide">
                            <span>Monthly Sales Trend</span>
                            <strong>${peso(s.total)}</strong>
                            ${sparkline(s.daily)}
                            <small class="ad-trend-meta">
                                Avg/day ${peso(average)} · Best day ${highest ? peso(highest.revenue) : "—"}
                            </small>
                            <div class="ad-points">
                                <div class="ad-points-total">Points <b>${formatNumber(s.points)}</b></div>
                                <div class="ad-chips">${categoryChips || `<span class="ad-empty-sm">No points yet.</span>`}</div>
                            </div>
                        </article>
                    </div>
                </div>
            `;
        }).join("");
    }

    /* ======================================================================
       3. Share Holder Summary (mirrors share-holder-report.js)
       ====================================================================== */

    function saleCategoryBreakdown(sale){
        const items = Array.isArray(sale?.services) ? sale.services : [];
        const gross = { services: 0, vipCards: 0, products: 0, other: 0 };

        items.forEach(function(item){
            const amount = Math.max(0, Number(item?.amount) || 0);

            if(isVipCard(item?.name)){
                gross.vipCards += amount;
            }else if(item?.itemType === "Service"){
                gross.services += amount;
            }else if(item?.itemType === "Product" && item?.isConsumable !== true && !isVoucherProduct(item)){
                gross.products += amount;
            }else{
                gross.other += amount;
            }
        });

        const grossTotal = gross.services + gross.vipCards + gross.products + gross.other;
        const voucherValue = Math.min(grossTotal, Math.max(0, Number(sale?.voucherValue) || 0));
        const net = Object.assign({}, gross);

        if(voucherValue <= 0 || grossTotal <= 0){ return net; }

        const targeted = { services: 0, vipCards: 0, products: 0 };

        (Array.isArray(sale?.vouchers) ? sale.vouchers : []).forEach(function(voucher){
            const value = Math.max(0, Number(voucher?.value) || 0);
            if(!value){ return; }

            if(voucher?.isExecutive === true || voucher?.itemType === "Executive" || voucher?.itemType === "Service"){
                targeted.services += value;
            }else if(voucher?.itemType === "Product"){
                if(isVipCard(voucher?.name)){ targeted.vipCards += value; }
                else{ targeted.products += value; }
            }
        });

        let directlyDeducted = 0;

        ["services", "vipCards", "products"].forEach(function(key){
            const take = Math.min(net[key], targeted[key]);
            net[key] -= take;
            directlyDeducted += take;
        });

        const leftover = Math.min(grossTotal - directlyDeducted, voucherValue - directlyDeducted);

        if(leftover > 0){
            const remaining = net.services + net.vipCards + net.products + net.other;
            if(remaining > 0){
                const ratio = Math.max(0, remaining - leftover) / remaining;
                net.services *= ratio;
                net.vipCards *= ratio;
                net.products *= ratio;
                net.other *= ratio;
            }
        }

        return net;
    }

    function netSaleAmount(row){
        const legacyGross = Array.isArray(row?.services)
            ? row.services.reduce(function(t, item){ return t + (parseFloat(item?.amount) || 0); }, 0)
            : 0;

        const gross = Number.isFinite(Number(row?.grossAmount)) ? Number(row.grossAmount) : legacyGross;
        const voucher = Number.isFinite(Number(row?.voucherValue)) ? Math.max(0, Number(row.voucherValue)) : 0;

        if(Number.isFinite(Number(row?.netAmount))){ return Math.max(0, Number(row.netAmount)); }
        return Math.max(0, gross - voucher);
    }

    function recurringSettledTotal(tableKey, branch, monthKey){
        const items = readJson(RECURRING_PREFIX + tableKey + "_" + branch, []);
        if(!Array.isArray(items)){ return 0; }

        return items
            .filter(function(item){
                return recurringActive(item, monthKey) && item.settledMonths && item.settledMonths[monthKey];
            })
            .reduce(function(sum, item){ return sum + recurringAmount(item, monthKey); }, 0);
    }

    function overheadExpenses(branch, monthKey){
        let total = RECURRING_KEYS.reduce(function(sum, key){
            return sum + recurringSettledTotal(key, branch, monthKey);
        }, 0);

        /* Auto Maya Terminal fee (see terminal-fee.js) — part of Utilities / Monthly Dues. */
        total += terminalFeeForMonth(branch, monthKey);

        const data = readJson(EXPENSE_PREFIX + branch + "_" + monthKey, null);
        if(!data){ return total; }

        return LEDGER_KEYS.reduce(function(subtotal, key){
            const rows = Array.isArray(data[key]) ? data[key] : [];
            return subtotal + rows.reduce(function(s, row){ return s + (parseFloat(row?.amount) || 0); }, 0);
        }, total);
    }

    function incomeTotals(branch, monthKey){
        const totals = { grand: 0, loyalty: 0, product: 0 };

        getMonthlySales(branch, monthKey).forEach(function(row){
            totals.grand += netSaleAmount(row);
            const breakdown = saleCategoryBreakdown(row);
            totals.loyalty += breakdown.vipCards;
            totals.product += breakdown.products;
        });

        return totals;
    }

    function renderShareholders(month){
        $("adShareMonthLabel").textContent = "· " + monthLabel(month);

        const allHolders = readJson(SHAREHOLDERS_KEY, {});

        $("adShareholders").innerHTML = getBranches().map(function(branch){
            const income = incomeTotals(branch, month);
            const overhead = overheadExpenses(branch, month);
            const net = income.grand - overhead - income.product - income.loyalty;
            const holders = Array.isArray(allHolders?.[branch]) ? allHolders[branch] : [];

            let totalPercent = 0;
            let totalAmount = 0;

            const holderRows = holders.map(function(holder){
                const percent = Number(holder.percentage) || 0;
                const amount = net * (percent / 100);
                totalPercent += percent;
                totalAmount += amount;

                return `
                    <tr>
                        <td>${escapeHtml(holder.name || "—")}</td>
                        <td class="text-end">${percent}%</td>
                        <td class="text-end">${peso(amount)}</td>
                    </tr>
                `;
            }).join("");

            return `
                <div class="col-lg-6">
                    <div class="ad-card">
                        <h4 class="ad-card-title">${escapeHtml(branch)}</h4>

                        <table class="table table-sm ad-table mb-3">
                            <tbody>
                                <tr><td>Grand Total Income</td><td class="text-end">${peso(income.grand)}</td></tr>
                                <tr><td>Overhead Expenses</td><td class="text-end">${peso(overhead)}</td></tr>
                                <tr><td>Loyalty Card Sales</td><td class="text-end">${peso(income.loyalty)}</td></tr>
                                <tr><td>Product Sales</td><td class="text-end">${peso(income.product)}</td></tr>
                                <tr class="ad-net-row ${net < 0 ? "negative" : ""}">
                                    <td>Monthly Net</td><td class="text-end">${peso(net)}</td>
                                </tr>
                            </tbody>
                        </table>

                        <table class="table table-bordered align-middle ad-table mb-0">
                            <thead class="table-dark">
                                <tr><th>Share Holder</th><th class="text-end">%</th><th class="text-end">Dividend</th></tr>
                            </thead>
                            <tbody>
                                ${holderRows || `<tr><td colspan="3" class="text-center text-muted">No shareholders set up for this branch yet.</td></tr>`}
                            </tbody>
                            <tfoot>
                                <tr><th>Total</th><th class="text-end">${totalPercent}%</th><th class="text-end">${peso(totalAmount)}</th></tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        }).join("");
    }

    /* ======================================================================
       4. List of Therapists (+ points)
       ====================================================================== */

    /* Points of the therapist's own Services in one branch — same rule as
       the Points column on Therapist Sales. */
    function therapistPoints(branch, month){
        const result = {};

        getMonthlySales(branch, month).forEach(function(sale){
            (Array.isArray(sale.services) ? sale.services : []).forEach(function(item){
                if(itemTypeOf(item) !== "Service"){ return; }

                const name = String(item?.therapist || sale?.therapist || "").trim();
                if(!name){ return; }

                result[name] = (result[name] || 0) + pointsFor(item).points;
            });
        });

        return result;
    }

    /* One table per branch: Therapist | Total Points. A therapist is listed
       under every branch they are assigned to (or who earned points there);
       one with no assignment is listed under all. */
    function renderTherapists(month){
        $("adTherapistMonthLabel").textContent = "· " + monthLabel(month);

        const master = readJson(THERAPIST_KEY, []);
        const people = (Array.isArray(master) ? master : []).map(function(entry){
            return {
                name: typeof entry === "string" ? entry : entry?.name,
                status: (typeof entry === "string" ? "Active" : entry?.status) || "Active",
                branches: typeof entry === "string" ? [] : (entry?.branches || [])
            };
        }).filter(function(person){ return person.name; });

        $("adTherapists").innerHTML = getBranches().map(function(branch){
            const points = therapistPoints(branch, month);
            const names = new Set(Object.keys(points));

            people.forEach(function(person){
                const here = person.branches.length === 0 || person.branches.includes(branch);
                if(here && person.status === "Active"){ names.add(person.name); }
            });

            const rows = Array.from(names).map(function(name){
                return { name: name, points: points[name] || 0 };
            }).sort(function(a, b){
                return b.points - a.points || a.name.localeCompare(b.name);
            });

            const total = rows.reduce(function(sum, row){ return sum + row.points; }, 0);

            return `
                <div class="col-lg-6">
                    <div class="ad-card">
                        <h4 class="ad-card-title">${escapeHtml(branch)}</h4>
                        <table class="table table-bordered align-middle ad-table mb-0">
                            <thead class="table-dark">
                                <tr><th>Therapist</th><th class="text-end">Total Points</th></tr>
                            </thead>
                            <tbody>
                                ${rows.length === 0
                                    ? `<tr><td colspan="2" class="text-center text-muted">No therapists found.</td></tr>`
                                    : rows.map(function(row){
                                        /* Pale green for the top scorer (ties share it). */
                                        const top = row.points > 0 && row.points === rows[0].points;
                                        return `<tr${top ? ' class="ad-top-rank"' : ""}><td class="fw-bold">${escapeHtml(row.name)}</td><td class="text-end">${formatNumber(row.points)}</td></tr>`;
                                    }).join("")}
                            </tbody>
                            <tfoot>
                                <tr><th>Total</th><th class="text-end">${formatNumber(total)}</th></tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        }).join("");
    }

    /* ======================================================================
       5. Service Points (mirrors the Services Points table on Receptionist
          Sales: fixed list, variants roll up, Products / Add Ons / VIP are
          one row each, anything else trails at the end)
       ====================================================================== */

    const SERVICE_POINT_ROWS = [
        { name: "Crown Reset", category: "Head Spa", tier: "Head Spa:3" },
        { name: "Crown Serenity", category: "Head Spa", tier: "Head Spa:5" },
        { name: "Crown Detox and Glow", category: "Head Spa", tier: "Head Spa:10" },
        { name: "Crown Relax", category: "Massage", tier: "Massage:4" },
        { name: "Crown Relief", category: "Massage", tier: "Massage:7" },
        { name: "Crown Recovery", category: "Massage", tier: "Massage:10" },
        { name: "The Reset Duo", category: "Combo", tier: "Combo:7" },
        { name: "The Serenity Set", category: "Combo", tier: "Combo:11" },
        { name: "The Recovery Ritual", category: "Combo", tier: "Combo:17" }
    ];

    function servicePointRows(branch, month){
        const fixedByTier = {};
        const groups = new Map();

        SERVICE_POINT_ROWS.forEach(function(row){ fixedByTier[row.tier] = row; });

        getMonthlySales(branch, month).forEach(function(sale){
            (Array.isArray(sale.services) ? sale.services : []).forEach(function(item){
                const result = pointsFor(item);
                const baseName = String(item?.name || "—");
                const fixed = fixedByTier[result.tier];
                const general = result.category === "Products" || result.category === "Add-ons" || result.category === "VIP";
                const little = /little crown head spa/i.test(baseName);

                const key = fixed
                    ? "tier|" + fixed.tier
                    : little
                        ? "special|Little Crown Head Spa"
                        : general
                            ? "general|" + result.category
                            : result.category + "|" + baseName.trim().toLowerCase();

                if(!groups.has(key)){
                    groups.set(key, { name: fixed ? fixed.name : baseName, category: result.category, points: 0 });
                }

                groups.get(key).points += result.points;
            });
        });

        const used = new Set();

        function take(key, name, category){
            used.add(key);
            const group = groups.get(key);
            return { name: name, category: category, points: group ? group.points : 0 };
        }

        const rows = [];

        SERVICE_POINT_ROWS.forEach(function(row){
            rows.push(take("tier|" + row.tier, row.name, row.category));

            if(row.name === "Crown Detox and Glow"){
                rows.push(take("special|Little Crown Head Spa", "Little Crown Head Spa", "Head Spa"));
            }
        });

        rows.push(take("general|Products", "Products", "Others"));
        rows.push(take("general|Add-ons", "Add Ons", "Others"));
        rows.push(take("general|VIP", "VIP", "Others"));

        Array.from(groups.keys())
            .filter(function(key){ return !used.has(key); })
            .map(function(key){ return groups.get(key); })
            .sort(function(a, b){ return a.category.localeCompare(b.category) || a.name.localeCompare(b.name); })
            .forEach(function(group){ rows.push(group); });

        return rows;
    }

    function renderServicePoints(month){
        $("adServicePointsMonthLabel").textContent = "· " + monthLabel(month);

        $("adServicePoints").innerHTML = getBranches().map(function(branch){
            const rows = servicePointRows(branch, month);
            const total = rows.reduce(function(sum, row){ return sum + row.points; }, 0);
            const highest = Math.max.apply(null, rows.map(function(row){ return row.points; }));

            return `
                <div class="col-lg-6">
                    <div class="ad-card">
                        <h4 class="ad-card-title">${escapeHtml(branch)}</h4>
                        <table class="table table-bordered align-middle ad-table mb-0">
                            <thead class="table-dark">
                                <tr><th>Services</th><th>Category</th><th class="text-end">Total Points</th></tr>
                            </thead>
                            <tbody>
                                ${rows.map(function(row){
                                    return `<tr>
                                        <td class="fw-bold">${escapeHtml(row.name)}</td>
                                        <td>${escapeHtml(row.category)}</td>
                                        <td class="text-end${highest > 0 && row.points === highest ? " fw-bold" : ""}">${formatNumber(row.points)}</td>
                                    </tr>`;
                                }).join("")}
                            </tbody>
                            <tfoot>
                                <tr><th colspan="2">Total</th><th class="text-end">${formatNumber(total)}</th></tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        }).join("");
    }

    /* ======================================================================
       Wiring
       ====================================================================== */

    function renderAll(){
        const month = getMonth();
        renderNotifications();
        renderStatistics(month);
        renderShareholders(month);
        renderTherapists(month);
        renderServicePoints(month);
    }

    let refreshTimer = null;

    function scheduleRender(){
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(renderAll, 250);
    }

    async function init(){
        const user = window.CrownAuth?.getCurrentUser?.();
        if(user && user.role !== "Admin"){ return; }

        $("adMonth").value = currentMonthKey();
        $("adMonth").addEventListener("change", renderAll);

        renderAll();

        /* Cloud pulls rewrite localStorage in the background. */
        window.addEventListener("crownCloudUpdate", scheduleRender);
        window.addEventListener("crownStoreStatus", scheduleRender);

        const cloudAvailable =
            window.CrownCloud?.isAvailable?.() &&
            await window.CrownCloud.waitForInitialSync(12000);

        if(cloudAvailable && window.firebase && firebase.apps.length > 0){
            startListeners();
        }

        renderAll();
    }

    if(document.readyState === "loading"){
        document.addEventListener("DOMContentLoaded", init);
    }else{
        init();
    }
})();
