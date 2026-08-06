const STATISTICS_BRANCH_KEY = "crownSelectedBranch";
const STATISTICS_SALES_PREFIX = "crownDailySales_";
const STATISTICS_SERVICE_KEY = "crownServiceMasterList";
const STATISTICS_PRODUCT_KEY = "crownProductMasterList";

let currentStatisticsSnapshot = null;

document.addEventListener("DOMContentLoaded", function(){
    initializeStatisticsMonth();

    document
        .getElementById("statisticsMonth")
        .addEventListener("change", renderStatistics);

    renderStatistics();
});

function initializeStatisticsMonth(){
    const input =
        document.getElementById("statisticsMonth");

    if(input.value){
        return;
    }

    const today =
        new Date();

    input.value = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0")
    ].join("-");
}

function getActiveBranch(){
    return (
        localStorage.getItem(
            STATISTICS_BRANCH_KEY
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

function getServiceMaster(){
    return readList(STATISTICS_SERVICE_KEY)
        .map(function(item){
            if(typeof item === "string"){
                return {
                    name: item,
                    category: "Other",
                    status: "Active",
                    availableForVoucher: false,
                    voucherValue: 0
                };
            }

            return {
                ...item,
                name: item?.name || "",
                category: item?.category || "Other",
                status:
                    item?.status ||
                    (
                        item?.active === false
                            ? "Archived"
                            : "Active"
                    ),
                availableForVoucher:
                    item?.availableForVoucher === true ||
                    item?.voucherAvailable === true,
                voucherValue:
                    Number(
                        item?.voucherValue ??
                        item?.voucherCost ??
                        0
                    ) || 0
            };
        })
        .filter(function(item){
            return Boolean(item.name);
        })
        .sort(function(a, b){
            return a.name.localeCompare(b.name);
        });
}

function getProductMaster(){
    return readList(STATISTICS_PRODUCT_KEY)
        .map(function(item){
            if(typeof item === "string"){
                return {
                    name: item,
                    category: "Other",
                    status: "Active",
                    sellingPrice: 0
                };
            }

            return {
                ...item,
                name: item?.name || "",
                category: item?.category || "Other",
                status:
                    item?.status ||
                    (
                        item?.active === false
                            ? "Archived"
                            : "Active"
                    ),
                sellingPrice:
                    Number(
                        item?.sellingPrice ??
                        item?.retailPrice ??
                        item?.regularPrice ??
                        item?.price ??
                        item?.amount ??
                        0
                    ) || 0
            };
        })
        .filter(function(item){
            return Boolean(item.name);
        })
        .sort(function(a, b){
            return a.name.localeCompare(b.name);
        });
}

function normalizeName(value){
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function isVipCard(value){
    const normalized =
        normalizeName(value);

    return (
        normalized === "vipcard" ||
        normalized.includes("vipmembershipcard") ||
        normalized.includes("viployaltycard")
    );
}

function isVoucherProduct(item){
    const name =
        String(item?.name || "");

    return (
        item?.productKind === "Service Voucher" ||
        item?.virtualProduct === true ||
        name.startsWith("Voucher — ") ||
        name.startsWith("Voucher - ") ||
        normalizeName(name).startsWith("voucher")
    );
}

function cleanVoucherServiceName(item){
    const explicit =
        item?.sourceServiceName;

    if(explicit){
        return explicit;
    }

    return String(item?.name || "")
        .replace(/^Voucher\s*[—-]\s*/i, "")
        .trim();
}

function getRedeemedServiceVouchers(sale){
    if(Array.isArray(sale?.vouchers) && sale.vouchers.length){
        return sale.vouchers
            .filter(function(voucher){
                return (
                    voucher?.itemType === "Service" &&
                    voucher?.isExecutive !== true &&
                    Boolean(voucher?.name)
                );
            })
            .map(function(voucher){
                return {
                    name: voucher.name,
                    value:
                        Math.max(
                            0,
                            Number(voucher.value) || 0
                        )
                };
            });
    }

    const voucherType =
        sale?.voucherType ||
        (
            sale?.voucherService
                ? "Service"
                : ""
        );

    const voucherName =
        sale?.voucherName ||
        sale?.voucherService ||
        "";

    if(
        voucherType === "Service" &&
        voucherName &&
        voucherName !== "Executive Voucher"
    ){
        return [{
            name: voucherName,
            value:
                Math.max(
                    0,
                    Number(sale?.voucherValue) || 0
                )
        }];
    }

    return [];
}

function getMonthlySales(branch, month){
    const rows = [];

    if(!branch || !month){
        return rows;
    }

    const prefix =
        `${STATISTICS_SALES_PREFIX}${branch}_${month}-`;

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
            const data =
                JSON.parse(
                    localStorage.getItem(key)
                );

            if(Array.isArray(data?.rows)){
                data.rows
                    .filter(function(sale){
                        return sale.settled !== false;
                    })
                    .forEach(function(sale){
                        rows.push({
                            ...sale,
                            reportDate:
                                data.date ||
                                key.slice(
                                    `${STATISTICS_SALES_PREFIX}${branch}_`.length
                                )
                        });
                    });
            }
        }catch(error){
            console.error(
                `Unable to read saved sales from ${key}:`,
                error
            );
        }
    }

    return rows;
}

function getItemQuantity(item){
    if(item?.itemType === "Product"){
        return Math.max(
            1,
            Number(item?.quantity) || 1
        );
    }

    return 1;
}

function getItemAmount(item){
    const savedAmount =
        Number(item?.amount);

    if(
        Number.isFinite(savedAmount)
    ){
        return savedAmount;
    }

    const quantity =
        getItemQuantity(item);

    const unitPrice =
        Number(item?.unitPrice) || 0;

    return quantity * unitPrice;
}

function createBreakdownMap(masterItems){
    const map =
        new Map();

    masterItems.forEach(function(item){
        map.set(
            item.name,
            {
                ...item,
                quantity: 0,
                amount: 0
            }
        );
    });

    return map;
}

function ensureBreakdownItem(
    map,
    name,
    defaults = {}
){
    if(!name){
        return null;
    }

    if(!map.has(name)){
        map.set(
            name,
            {
                name: name,
                category:
                    defaults.category ||
                    "Historical / Unlisted",
                voucherValue:
                    Number(
                        defaults.voucherValue
                    ) || 0,
                quantity: 0,
                amount: 0
            }
        );
    }

    return map.get(name);
}

function calculateStatistics(sales){
    const services =
        getServiceMaster();

    const products =
        getProductMaster();

    const regularProducts =
        products.filter(function(product){
            return (
                !isVipCard(product.name) &&
                !normalizeName(product.name)
                    .startsWith("voucher")
            );
        });

    const voucherServices =
        services.filter(function(service){
            return (
                service.availableForVoucher === true
            );
        });

    const serviceMap =
        createBreakdownMap(services);

    const productMap =
        createBreakdownMap(regularProducts);

    const voucherSalesMap =
        createBreakdownMap(
            voucherServices.map(function(service){
                return {
                    name: service.name,
                    category: service.category,
                    voucherValue:
                        Number(
                            service.voucherValue
                        ) || 0
                };
            })
        );

    const voucherRedeemMap =
        createBreakdownMap(
            voucherServices.map(function(service){
                return {
                    name: service.name,
                    category: service.category,
                    voucherValue:
                        Number(
                            service.voucherValue
                        ) || 0
                };
            })
        );

    let vipCount = 0;
    let vipAmount = 0;

    sales.forEach(function(sale){
        const items =
            Array.isArray(sale?.services)
                ? sale.services
                : [];

        items.forEach(function(item){
            const itemType =
                item?.itemType ||
                (
                    isVoucherProduct(item)
                        ? "Product"
                        : "Service"
                );

            const quantity =
                getItemQuantity(item);

            const amount =
                getItemAmount(item);

            if(itemType === "Service"){
                const entry =
                    ensureBreakdownItem(
                        serviceMap,
                        item?.name
                    );

                if(entry){
                    entry.quantity += 1;
                    entry.amount += amount;
                }

                return;
            }

            if(isVipCard(item?.name)){
                vipCount += quantity;
                vipAmount += amount;
                return;
            }

            if(isVoucherProduct(item)){
                const serviceName =
                    cleanVoucherServiceName(item);

                const entry =
                    ensureBreakdownItem(
                        voucherSalesMap,
                        serviceName,
                        {
                            voucherValue:
                                Number(
                                    item?.unitPrice
                                ) ||
                                (
                                    quantity > 0
                                        ? amount / quantity
                                        : 0
                                )
                        }
                    );

                if(entry){
                    entry.quantity += quantity;
                    entry.amount += amount;

                    if(
                        !entry.voucherValue
                    ){
                        entry.voucherValue =
                            quantity > 0
                                ? amount / quantity
                                : 0;
                    }
                }

                return;
            }

            const productEntry =
                ensureBreakdownItem(
                    productMap,
                    item?.name
                );

            if(productEntry){
                productEntry.quantity += quantity;
                productEntry.amount += amount;
            }
        });

        getRedeemedServiceVouchers(sale)
            .forEach(function(voucher){
                const redeemedValue =
                    Math.max(
                        0,
                        Number(
                            voucher?.value ??
                            voucher?.voucherValue
                        ) || 0
                    );

                const entry =
                    ensureBreakdownItem(
                        voucherRedeemMap,
                        voucher.name,
                        {
                            voucherValue:
                                redeemedValue
                        }
                    );

                if(entry){
                    entry.quantity += 1;
                    entry.amount += redeemedValue;

                    if(!entry.voucherValue){
                        entry.voucherValue =
                            redeemedValue;
                    }
                }
            });
    });

    return {
        services:
            Array.from(serviceMap.values()),
        products:
            Array.from(productMap.values()),
        vip: {
            quantity: vipCount,
            amount: vipAmount
        },
        voucherSales:
            Array.from(
                voucherSalesMap.values()
            ),
        voucherRedeem:
            Array.from(
                voucherRedeemMap.values()
            )
    };
}

function summarize(items){
    return items.reduce(
        function(summary, item){
            summary.quantity +=
                Number(item?.quantity) || 0;

            summary.amount +=
                Number(item?.amount) || 0;

            return summary;
        },
        {
            quantity: 0,
            amount: 0
        }
    );
}



function getStatisticsCompanionCount(sale){
    if(Array.isArray(sale?.companions)){
        return sale.companions.filter(function(companion){
            return Boolean(
                String(
                    companion?.name || companion || ""
                ).trim()
            );
        }).length;
    }

    if(Array.isArray(sale?.participants)){
        return sale.participants.filter(function(participant){
            const role =
                String(
                    participant?.role ||
                    participant?.type ||
                    ""
                ).toLowerCase();

            return role.includes("companion");
        }).length;
    }

    const numericCount =
        Number(
            sale?.companionCount ||
            sale?.companionsCount ||
            0
        );

    return Number.isFinite(numericCount)
        ? Math.max(0, numericCount)
        : 0;
}

function getStatisticsSourceSummary(sales){
    const summary = {
        Facebook: 0,
        "Walk-in": 0,
        Referral: 0,
        Returning: 0
    };

    (Array.isArray(sales) ? sales : []).forEach(function(sale){
        const source =
            String(
                sale?.source ||
                sale?.clientSource ||
                sale?.acquisitionSource ||
                "Walk-in"
            ).trim() || "Walk-in";

        summary[source] =
            (summary[source] || 0) + 1;

        const companionCount =
            getStatisticsCompanionCount(sale);

        if(companionCount > 0){
            summary.Referral += companionCount;
        }
    });

    return summary;
}

function renderStatistics(){
    const branch =
        getActiveBranch();

    const month =
        document
            .getElementById(
                "statisticsMonth"
            )
            .value;

    document.getElementById(
        "activeBranchLabel"
    ).textContent =
        branch || "No branch selected";

    const noBranchState =
        document.getElementById(
            "noBranchState"
        );

    const content =
        document.getElementById(
            "statisticsContent"
        );

    if(!branch){
        noBranchState.classList.remove(
            "d-none"
        );

        content.classList.add(
            "d-none"
        );

        resetOverview();
        currentStatisticsSnapshot = null;
        return;
    }

    noBranchState.classList.add(
        "d-none"
    );

    content.classList.remove(
        "d-none"
    );

    const sales =
        getMonthlySales(
            branch,
            month
        );

    const statistics =
        calculateStatistics(sales);

    renderBusinessAnalytics(
        sales,
        statistics
    );

    const servicesSummary =
        renderBreakdownTable(
            "servicesStatisticsBody",
            statistics.services,
            {
                secondColumn:
                    function(item){
                        return item.category;
                    }
            }
        );

    const productsSummary =
        renderBreakdownTable(
            "productsStatisticsBody",
            statistics.products,
            {
                secondColumn:
                    function(item){
                        return item.category;
                    }
            }
        );

    const voucherSalesSummary =
        renderBreakdownTable(
            "voucherSalesBody",
            statistics.voucherSales,
            {
                secondColumn:
                    function(item){
                        return peso(
                            item.voucherValue
                        );
                    }
            }
        );

    const voucherRedeemSummary =
        renderBreakdownTable(
            "voucherRedeemBody",
            statistics.voucherRedeem,
            {
                secondColumn:
                    function(item){
                        return peso(
                            item.voucherValue
                        );
                    }
            }
        );

    setSummary(
        "servicesSummaryCount",
        "servicesSummaryAmount",
        servicesSummary
    );

    setSummary(
        "productsSummaryCount",
        "productsSummaryAmount",
        productsSummary
    );

    setSummary(
        "voucherSalesSummaryCount",
        "voucherSalesSummaryAmount",
        voucherSalesSummary
    );

    setSummary(
        "voucherRedeemSummaryCount",
        "voucherRedeemSummaryAmount",
        voucherRedeemSummary
    );

    renderVipStatistics(
        statistics.vip
    );

    renderOverview({
        services: servicesSummary,
        products: productsSummary,
        vip: statistics.vip,
        voucherSales:
            voucherSalesSummary,
        voucherRedeem:
            voucherRedeemSummary
    });

    currentStatisticsSnapshot = {
        branch: branch,
        month: month,
        sales: sales,
        statistics: statistics,
        summary: {
            services: servicesSummary,
            products: productsSummary,
            vip: statistics.vip,
            voucherSales: voucherSalesSummary,
            voucherRedeem: voucherRedeemSummary
        }
    };
}

function renderBreakdownTable(
    bodyId,
    items,
    options = {}
){
    const body =
        document.getElementById(bodyId);

    body.innerHTML = "";

    items.forEach(function(item){
        const row =
            document.createElement("tr");

        const hasActivity =
            Number(item.quantity) > 0;

        if(!hasActivity){
            row.classList.add(
                "zero-activity-row"
            );
        }

        row.innerHTML = `
            <td>
                <strong class="item-name">
                    ${escapeHtml(item.name)}
                </strong>
            </td>

            <td>
                ${escapeHtml(
                    options.secondColumn
                        ? options.secondColumn(item)
                        : item.category || "—"
                )}
            </td>

            <td class="numeric-cell">
                ${formatNumber(item.quantity)}
            </td>

            <td class="amount-cell">
                ${peso(item.amount)}
            </td>
        `;

        body.appendChild(row);
    });

    if(items.length === 0){
        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td
                colspan="4"
                class="no-data-cell"
            >
                No master records are available.
            </td>
        `;

        body.appendChild(row);
    }

    return summarize(items);
}

function renderVipStatistics(vip){
    const quantity =
        Number(vip?.quantity) || 0;

    const amount =
        Number(vip?.amount) || 0;

    const average =
        quantity > 0
            ? amount / quantity
            : 0;

    document.getElementById(
        "vipCardCount"
    ).textContent =
        formatNumber(quantity);

    document.getElementById(
        "vipCardAmount"
    ).textContent =
        peso(amount);

    document.getElementById(
        "vipCardAverage"
    ).textContent =
        peso(average);
}

function renderOverview(data){
    setOverview(
        "overviewServicesCount",
        "overviewServicesAmount",
        data.services
    );

    setOverview(
        "overviewProductsCount",
        "overviewProductsAmount",
        data.products
    );

    setOverview(
        "overviewVipCount",
        "overviewVipAmount",
        data.vip
    );

    setOverview(
        "overviewVoucherSalesCount",
        "overviewVoucherSalesAmount",
        data.voucherSales
    );

    setOverview(
        "overviewVoucherRedeemCount",
        "overviewVoucherRedeemAmount",
        data.voucherRedeem
    );
}

function setOverview(
    countId,
    amountId,
    data
){
    document.getElementById(
        countId
    ).textContent =
        formatNumber(
            data?.quantity || 0
        );

    document.getElementById(
        amountId
    ).textContent =
        peso(
            data?.amount || 0
        );
}

function setSummary(
    countId,
    amountId,
    summary
){
    document.getElementById(
        countId
    ).textContent =
        formatNumber(
            summary.quantity
        );

    document.getElementById(
        amountId
    ).textContent =
        peso(
            summary.amount
        );
}

function resetOverview(){
    [
        [
            "overviewServicesCount",
            "overviewServicesAmount"
        ],
        [
            "overviewProductsCount",
            "overviewProductsAmount"
        ],
        [
            "overviewVipCount",
            "overviewVipAmount"
        ],
        [
            "overviewVoucherSalesCount",
            "overviewVoucherSalesAmount"
        ],
        [
            "overviewVoucherRedeemCount",
            "overviewVoucherRedeemAmount"
        ]
    ].forEach(function(ids){
        document.getElementById(
            ids[0]
        ).textContent = "0";

        document.getElementById(
            ids[1]
        ).textContent = "₱0.00";
    });
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


function getAnalyticsSaleAmount(sale){
    if(sale?.netAmount !== undefined){
        return Math.max(0, Number(sale.netAmount) || 0);
    }

    return (Array.isArray(sale?.services) ? sale.services : [])
        .reduce(function(sum, item){
            return sum + Math.max(0, Number(item?.amount) || 0);
        }, 0);
}

function renderAnalyticsEmpty(container, message){
    container.innerHTML =
        `<div class="analytics-empty">${escapeHtml(message)}</div>`;
}

function renderAnalyticsBars(containerId, items, formatter){
    const container = document.getElementById(containerId);
    if(!container){ return; }

    const cleanItems = (Array.isArray(items) ? items : [])
        .filter(function(item){ return Number(item.value) > 0; })
        .slice(0, 6);

    if(cleanItems.length === 0){
        renderAnalyticsEmpty(container, "No data available for the selected period.");
        return;
    }

    const maximum = Math.max.apply(null, cleanItems.map(function(item){
        return Number(item.value) || 0;
    }));

    container.innerHTML = `
        <div class="analytics-bars">
            ${cleanItems.map(function(item){
                const value = Number(item.value) || 0;
                const width = maximum > 0 ? (value / maximum) * 100 : 0;
                return `
                    <div class="analytics-bar-row">
                        <div class="analytics-bar-meta">
                            <span>${escapeHtml(item.label)}</span>
                            <strong>${formatter ? formatter(value) : value}</strong>
                        </div>
                        <div class="analytics-bar-track">
                            <div class="analytics-bar-fill" style="width:${width}%"></div>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function getMonthlyTrendData(sales, selectedMonth){
    const monthDate =
        selectedMonth
            ? new Date(selectedMonth + "-01T00:00:00")
            : new Date();

    const year = monthDate.getFullYear();
    const monthIndex = monthDate.getMonth();
    const daysInMonth =
        new Date(year, monthIndex + 1, 0).getDate();

    const daily = {};

    for(let day = 1; day <= daysInMonth; day += 1){
        const date = [
            year,
            String(monthIndex + 1).padStart(2, "0"),
            String(day).padStart(2, "0")
        ].join("-");

        daily[date] = {
            date: date,
            revenue: 0,
            clients: 0
        };
    }

    (Array.isArray(sales) ? sales : []).forEach(function(sale){
        const date = String(sale?.reportDate || "");

        if(!date || !daily[date]){
            return;
        }

        daily[date].revenue +=
            getAnalyticsSaleAmount(sale);

        daily[date].clients +=
            Math.max(
                1,
                Number(sale?.companionCount) || 0
            );
    });

    const entries =
        Object.values(daily);

    const totalAmount =
        entries.reduce(function(sum, item){
            return sum + item.revenue;
        }, 0);

    const activeEntries =
        entries.filter(function(item){
            return item.revenue > 0;
        });

    const highest =
        activeEntries.length
            ? activeEntries.reduce(function(best, item){
                return item.revenue > best.revenue ? item : best;
            })
            : null;

    const lowest =
        activeEntries.length
            ? activeEntries.reduce(function(best, item){
                return item.revenue < best.revenue ? item : best;
            })
            : null;

    const average =
        daysInMonth > 0
            ? totalAmount / daysInMonth
            : 0;

    return {
        entries: entries,
        totalAmount: totalAmount,
        activeEntries: activeEntries,
        highest: highest,
        lowest: lowest,
        average: average,
        daysInMonth: daysInMonth
    };
}

function renderMonthlySalesTrend(sales){
    const container = document.getElementById("monthlySalesTrendChart");
    if(!container){ return; }

    const monthInput = document.getElementById("statisticsMonth");
    const selectedMonth =
        String(monthInput?.value || "")
            .match(/^\d{4}-\d{2}$/)
            ? monthInput.value
            : (
                String(
                    (Array.isArray(sales) && sales[0]?.reportDate) || ""
                ).slice(0, 7)
            );

    const trendData =
        getMonthlyTrendData(sales, selectedMonth);

    const entries = trendData.entries;
    const totalAmount = trendData.totalAmount;
    const activeEntries = trendData.activeEntries;
    const highest = trendData.highest;
    const lowest = trendData.lowest;
    const average = trendData.average;
    const daysInMonth = trendData.daysInMonth;

    const totalLabel =
        document.getElementById("analyticsSalesTotal");

    if(totalLabel){
        totalLabel.textContent =
            peso(totalAmount);
    }

    const highestValue =
        document.getElementById("monthlyTrendHighest");

    const highestDate =
        document.getElementById("monthlyTrendHighestDate");

    const averageValue =
        document.getElementById("monthlyTrendAverage");

    const lowestValue =
        document.getElementById("monthlyTrendLowest");

    const lowestDate =
        document.getElementById("monthlyTrendLowestDate");

    if(highestValue){
        highestValue.textContent =
            peso(highest?.revenue || 0);
    }

    if(highestDate){
        highestDate.textContent =
            highest
                ? new Date(
                    highest.date + "T00:00:00"
                ).toLocaleDateString(
                    "en-PH",
                    {
                        month: "short",
                        day: "numeric"
                    }
                )
                : "—";
    }

    if(averageValue){
        averageValue.textContent =
            peso(average);
    }

    if(lowestValue){
        lowestValue.textContent =
            peso(lowest?.revenue || 0);
    }

    if(lowestDate){
        lowestDate.textContent =
            lowest
                ? new Date(
                    lowest.date + "T00:00:00"
                ).toLocaleDateString(
                    "en-PH",
                    {
                        month: "short",
                        day: "numeric"
                    }
                )
                : "—";
    }

    if(activeEntries.length === 0){
        renderAnalyticsEmpty(
            container,
            "No saved sales for the selected month."
        );
        return;
    }

    const width = 980;
    const height = 310;
    const pad = {
        left: 68,
        right: 18,
        top: 18,
        bottom: 44
    };

    const innerW =
        width - pad.left - pad.right;

    const innerH =
        height - pad.top - pad.bottom;

    const maxValue =
        Math.max.apply(
            null,
            entries.map(function(item){
                return item.revenue;
            })
        ) || 1;

    const roundedMax =
        Math.ceil(maxValue / 1000) * 1000 || 1000;

    const slotWidth =
        innerW / entries.length;

    const barWidth =
        Math.max(
            7,
            Math.min(22, slotWidth * 0.66)
        );

    const grid =
        [0, .25, .5, .75, 1]
            .map(function(ratio){
                const y =
                    pad.top +
                    innerH -
                    (ratio * innerH);

                const value =
                    roundedMax * ratio;

                return `
                    <line
                        class="analytics-grid-line"
                        x1="${pad.left}"
                        y1="${y}"
                        x2="${width - pad.right}"
                        y2="${y}"
                    ></line>

                    <text
                        class="analytics-axis-label"
                        x="${pad.left - 10}"
                        y="${y + 4}"
                        text-anchor="end"
                    >
                        ${Math.round(value).toLocaleString()}
                    </text>
                `;
            })
            .join("");

    const bars =
        entries.map(function(item, index){
            const x =
                pad.left +
                (index * slotWidth) +
                ((slotWidth - barWidth) / 2);

            const ratio =
                item.revenue / roundedMax;

            const barHeight =
                item.revenue > 0
                    ? Math.max(3, ratio * innerH)
                    : 2;

            const y =
                pad.top +
                innerH -
                barHeight;

            const averageTicket =
                item.clients > 0
                    ? item.revenue / item.clients
                    : 0;

            const dayOfWeek =
                new Date(
                    item.date + "T00:00:00"
                ).getDay();

            const isWeekend =
                dayOfWeek === 0 ||
                dayOfWeek === 6;

            const className =
                item.revenue === 0
                    ? "monthly-sales-bar zero"
                    : (
                        isWeekend
                            ? "monthly-sales-bar weekend"
                            : "monthly-sales-bar weekday"
                    );

            const labelDay =
                String(index + 1);

            const showLabel =
                entries.length <= 16 ||
                index === 0 ||
                index === entries.length - 1 ||
                index % 5 === 4;

            return `
                <g class="monthly-sales-bar-group">
                    <rect
                        class="${className}"
                        x="${x.toFixed(2)}"
                        y="${y.toFixed(2)}"
                        width="${barWidth.toFixed(2)}"
                        height="${barHeight.toFixed(2)}"
                        rx="4"
                    >
                        <title>
                            ${new Date(item.date + "T00:00:00").toLocaleDateString(
                                "en-PH",
                                {
                                    weekday: "long",
                                    month: "long",
                                    day: "numeric",
                                    year: "numeric"
                                }
                            )}
                            Revenue: ${peso(item.revenue)}
                            Clients: ${item.clients}
                            Average Ticket: ${peso(averageTicket)}
                            Day Type: ${isWeekend ? "Weekend" : "Weekday"}
                        </title>
                    </rect>

                    ${
                        showLabel
                            ? `
                                <text
                                    class="analytics-axis-label"
                                    x="${(
                                        x + (barWidth / 2)
                                    ).toFixed(2)}"
                                    y="${height - 16}"
                                    text-anchor="middle"
                                >
                                    ${labelDay}
                                </text>
                            `
                            : ""
                    }
                </g>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="monthly-sales-chart-scroll">
            <svg
                class="analytics-bar-svg"
                viewBox="0 0 ${width} ${height}"
                role="img"
                aria-label="Monthly sales bar chart"
            >
                ${grid}
                ${bars}

                <line
                    class="analytics-axis-base"
                    x1="${pad.left}"
                    y1="${pad.top + innerH}"
                    x2="${width - pad.right}"
                    y2="${pad.top + innerH}"
                ></line>
            </svg>
        </div>

        <div class="monthly-sales-legend">
            <span>
                <i class="legend-weekday"></i>
                Weekday
            </span>

            <span>
                <i class="legend-weekend"></i>
                Weekend
            </span>

            <span>
                <i class="legend-zero"></i>
                No sales
            </span>
        </div>
    `;
}

function getAnalyticsTherapistData(sales){
    const totals = {};

    (Array.isArray(sales) ? sales : []).forEach(function(sale){
        const items = Array.isArray(sale?.services) ? sale.services : [];

        items.forEach(function(item){
            /* Same attribution rules as therapist-sales.js so both
               pages always report identical totals per therapist. */
            const itemType =
                item?.itemType ||
                (
                    String(item?.productKind || "").includes("Voucher")
                        ? "Product"
                        : "Service"
                );

            if(itemType !== "Service"){ return; }

            const therapist =
                String(
                    item?.therapist ||
                    sale?.therapist ||
                    ""
                ).trim();

            if(!therapist || therapist === "N/A"){ return; }

            /* A Freebie's amount is always 0 (excluded from the client's
               total) — its real value lives in freebieValue instead, same
               as therapist-sales.js's serviceCost. */
            const value =
                item?.isFreebie
                    ? (Number(item?.freebieValue) || 0)
                    : (Number(item?.amount) || 0);

            totals[therapist] =
                (totals[therapist] || 0) +
                Math.max(0, value);
        });
    });

    return Object.entries(totals)
        .map(function(entry){ return {label:entry[0],value:entry[1]}; })
        .sort(function(a,b){ return b.value-a.value; });
}

function getAnalyticsPaymentData(sales){
    const totals = {};

    (Array.isArray(sales) ? sales : []).forEach(function(sale){
        /* Legacy rows saved before the multi-payment feature existed can
           have payment === "Multiple" with no payments[] array behind it —
           that sentinel only means something when a real payments[] array
           is also present. Falls back to "Other" instead of dropping the
           amount, matching the generic-bucket handling below. */
        const payments =
            Array.isArray(sale?.payments) && sale.payments.length
                ? sale.payments
                : (
                    getAnalyticsSaleAmount(sale) > 0
                        ? [{
                            method: (sale?.payment && sale.payment !== "Multiple") ? sale.payment : "Other",
                            amount: getAnalyticsSaleAmount(sale)
                        }]
                        : []
                );

        payments.forEach(function(payment){
            const method = String(payment?.method || "Other").trim() || "Other";
            totals[method] =
                (totals[method] || 0) +
                Math.max(0, Number(payment?.amount) || 0);
        });
    });

    return Object.entries(totals)
        .map(function(entry){ return {label:entry[0],value:entry[1]}; })
        .sort(function(a,b){ return b.value-a.value; });
}

function renderPaymentDonut(sales){
    const container = document.getElementById("paymentDistributionChart");
    if(!container){ return; }

    const items = getAnalyticsPaymentData(sales);
    const total = items.reduce(function(sum,item){return sum+item.value;},0);

    if(total <= 0){
        renderAnalyticsEmpty(container, "No payment data available for the selected period.");
        return;
    }

    const fallbackColors = ["#64748B","#C6A15B","#4F7C77","#806B9B","#B26A5C","#6F7F92"];
    const getCollectionColor = function(label,index){
        if(window.CrownOSTheme){
            const normalized = window.CrownOSTheme.normalizePaymentMethod(label);
            if(normalized !== "Other" || String(label).trim().toLowerCase() === "other"){
                return window.CrownOSTheme.getPaymentColor(label);
            }
        }

        return fallbackColors[index % fallbackColors.length];
    };

    let cursor = 0;
    const segments = items.map(function(item,index){
        const start = cursor;
        const end = cursor + (item.value/total)*360;
        cursor = end;
        return `${getCollectionColor(item.label,index)} ${start}deg ${end}deg`;
    });

    container.innerHTML = `
        <div class="analytics-donut-layout">
            <div class="analytics-donut" style="background:conic-gradient(${segments.join(",")})">
                <div class="analytics-donut-center">
                    <div>${peso(total)}<small>Total collected</small></div>
                </div>
            </div>
            <div class="analytics-legend">
                ${items.map(function(item,index){
                    const percent = total > 0 ? (item.value/total)*100 : 0;
                    return `
                        <div class="analytics-legend-row">
                            <span class="analytics-legend-dot" style="background:${getCollectionColor(item.label,index)}"></span>
                            <span>${escapeHtml(item.label)}</span>
                            <strong>${percent.toFixed(1)}%</strong>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

function renderBusinessAnalytics(sales, statistics){
    renderMonthlySalesTrend(sales);

    const serviceItems = (statistics?.services || [])
        .map(function(item){
            return {label:item.name,value:Number(item.quantity)||0};
        })
        .sort(function(a,b){return b.value-a.value;});

    renderAnalyticsBars(
        "topServicesChart",
        serviceItems,
        function(value){ return `${value} client${value===1?"":"s"}`; }
    );

    renderAnalyticsBars(
        "therapistPerformanceChart",
        getAnalyticsTherapistData(sales),
        function(value){ return peso(value); }
    );

    renderPaymentDonut(sales);

    const sourceSummary = getStatisticsSourceSummary(sales);
    const sourceItems = Object.entries(sourceSummary)
        .map(function(entry){return {label:entry[0],value:Number(entry[1])||0};})
        .sort(function(a,b){return b.value-a.value;});

    renderAnalyticsBars(
        "sourceAcquisitionChart",
        sourceItems,
        function(value){ return `${value} client${value===1?"":"s"}`; }
    );
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

function formatStatisticsMonthLabel(monthValue){
    if(!monthValue){
        return "";
    }

    return new Date(monthValue + "-01T00:00:00").toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric"
    });
}

function exportStatisticsPDF(){
    if(!window.jspdf || !window.jspdf.jsPDF){
        alert("PDF library is unavailable. Please check your internet connection and reload the page.");
        return;
    }

    if(!currentStatisticsSnapshot){
        alert("Please select a branch and month first.");
        return;
    }

    const button =
        document.getElementById("exportStatisticsPdfBtn");

    if(button){
        button.disabled = true;
        button.textContent = "Generating PDF...";
    }

    try{
        const { branch, month, summary } = currentStatisticsSnapshot;

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

        const monthLabel =
            formatStatisticsMonthLabel(month);

        function drawHeader(){
            doc.setFillColor(11, 24, 73);
            doc.rect(0, 0, pageWidth, 26, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text("CROWN HEAD SPA", 14, 11);

            doc.setFontSize(10);
            doc.text("Statistics Report", 14, 18);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(branch, pageWidth - 14, 10, { align: "right" });
            doc.text(monthLabel, pageWidth - 14, 16, { align: "right" });
        }

        function drawFooter(){
            doc.setTextColor(120, 126, 138);
            doc.setFontSize(7.5);
            doc.text(
                `Generated ${new Date().toLocaleDateString("en-PH", {month: "long", day: "numeric", year: "numeric"})}`,
                14,
                doc.internal.pageSize.getHeight() - 8
            );
        }

        /* autoTable's own didDrawPage callback only knows that TABLE's
           local page count, not the final document total (more sections/
           pages are added afterward) — page numbers are stamped in one
           final pass over every page, right before doc.save(). */
        function stampPageNumbers(){
            const totalPages =
                doc.internal.getNumberOfPages();

            for(let page = 1; page <= totalPages; page += 1){
                doc.setPage(page);

                doc.setTextColor(120, 126, 138);
                doc.setFontSize(7.5);
                doc.text(
                    `Page ${page} of ${totalPages}`,
                    pageWidth - 14,
                    doc.internal.pageSize.getHeight() - 8,
                    { align: "right" }
                );
            }
        }

        function drawSectionTitle(title, y){
            doc.setTextColor(11, 24, 73);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text(title, 14, y);
            return y + 4;
        }

        function hexToRgb(hex){
            const clean = String(hex || "").replace("#", "");

            return [
                parseInt(clean.substring(0, 2), 16) || 0,
                parseInt(clean.substring(2, 4), 16) || 0,
                parseInt(clean.substring(4, 6), 16) || 0
            ];
        }

        function paymentColorRgb(label, index){
            const fallbackColors = ["#64748B", "#C6A15B", "#4F7C77", "#806B9B", "#B26A5C", "#6F7F92"];

            if(window.CrownOSTheme){
                const normalized = window.CrownOSTheme.normalizePaymentMethod(label);

                if(normalized !== "Other" || String(label).trim().toLowerCase() === "other"){
                    return hexToRgb(window.CrownOSTheme.getPaymentColor(label));
                }
            }

            return hexToRgb(fallbackColors[index % fallbackColors.length]);
        }

        function truncateToWidth(text, maxWidth){
            let str = String(text ?? "");

            if(doc.getTextWidth(str) <= maxWidth){
                return str;
            }

            while(str.length > 1 && doc.getTextWidth(str + "…") > maxWidth){
                str = str.slice(0, -1);
            }

            return str + "…";
        }

        function drawBarListChart(x, y, width, items, colorRgb, formatter){
            const cleanItems = (Array.isArray(items) ? items : [])
                .filter(function(item){ return Number(item.value) > 0; })
                .slice(0, 6);

            if(cleanItems.length === 0){
                doc.setFont("helvetica", "italic");
                doc.setFontSize(7.5);
                doc.setTextColor(140, 144, 150);
                doc.text("No data available for the selected period.", x, y + 4);
                return y + 10;
            }

            const maxValue =
                Math.max.apply(null, cleanItems.map(function(item){ return Number(item.value) || 0; }));

            let cursorY = y;

            cleanItems.forEach(function(item){
                doc.setFont("helvetica", "bold");
                doc.setFontSize(7.5);
                doc.setTextColor(36, 50, 74);
                doc.text(truncateToWidth(item.label, width * 0.6), x, cursorY + 3);

                const valueText = formatter ? formatter(Number(item.value) || 0) : String(item.value);
                doc.setFont("helvetica", "normal");
                doc.setTextColor(19, 35, 63);
                doc.text(valueText, x + width, cursorY + 3, { align: "right" });

                const trackY = cursorY + 4.6;
                doc.setFillColor(237, 241, 246);
                doc.roundedRect(x, trackY, width, 2.6, 1, 1, "F");

                const ratio = maxValue > 0 ? (Number(item.value) || 0) / maxValue : 0;
                const fillWidth = Math.max(1.5, width * ratio);
                doc.setFillColor(colorRgb[0], colorRgb[1], colorRgb[2]);
                doc.roundedRect(x, trackY, fillWidth, 2.6, 1, 1, "F");

                cursorY += 9.6;
            });

            return cursorY;
        }

        function drawPieChart(centerX, centerY, radius, items){
            const total =
                items.reduce(function(sum, item){ return sum + (Number(item.value) || 0); }, 0);

            if(total <= 0){
                return;
            }

            let angle = -90;

            items.forEach(function(item, index){
                const value = Number(item.value) || 0;

                if(value <= 0){
                    return;
                }

                const sliceDeg = (value / total) * 360;
                const steps = Math.max(1, Math.ceil(sliceDeg / 4));
                const stepDeg = sliceDeg / steps;
                const color = paymentColorRgb(item.label, index);

                doc.setFillColor(color[0], color[1], color[2]);

                for(let s = 0; s < steps; s += 1){
                    const a1 = (angle + s * stepDeg) * Math.PI / 180;
                    const a2 = (angle + (s + 1) * stepDeg) * Math.PI / 180;

                    const x1 = centerX + radius * Math.cos(a1);
                    const y1 = centerY + radius * Math.sin(a1);
                    const x2 = centerX + radius * Math.cos(a2);
                    const y2 = centerY + radius * Math.sin(a2);

                    doc.triangle(centerX, centerY, x1, y1, x2, y2, "F");
                }

                angle += sliceDeg;
            });

            doc.setFillColor(255, 255, 255);
            doc.circle(centerX, centerY, radius * 0.55, "F");
        }

        function drawPaymentDistributionCard(x, y, width, items){
            const cleanItems =
                (Array.isArray(items) ? items : [])
                    .filter(function(item){ return Number(item.value) > 0; });

            if(cleanItems.length === 0){
                doc.setFont("helvetica", "italic");
                doc.setFontSize(7.5);
                doc.setTextColor(140, 144, 150);
                doc.text("No payment data available for the selected period.", x, y + 4);
                return y + 10;
            }

            const total =
                cleanItems.reduce(function(sum, item){ return sum + item.value; }, 0);

            const radius = 15;
            const centerX = x + radius + 2;
            const centerY = y + radius;

            drawPieChart(centerX, centerY, radius, cleanItems);

            const legendX = x + (radius * 2) + 8;
            let legendY = y + 2;

            cleanItems.forEach(function(item, index){
                const color = paymentColorRgb(item.label, index);

                doc.setFillColor(color[0], color[1], color[2]);
                doc.rect(legendX, legendY - 2.2, 2.6, 2.6, "F");

                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                doc.setTextColor(36, 50, 74);

                const percent =
                    total > 0 ? ((item.value / total) * 100).toFixed(1) + "%" : "0%";

                doc.text(
                    truncateToWidth(`${item.label} — ${percent}`, width - (radius * 2) - 12),
                    legendX + 4,
                    legendY
                );

                legendY += 5;
            });

            return Math.max(y + (radius * 2) + 4, legendY);
        }

        function drawMonthlyTrendChart(x, y, width, height, trendData){
            const entries = trendData.entries;

            if(!entries.length){
                return y;
            }

            const padLeft = 16;
            const padRight = 2;
            const padTop = 4;
            const padBottom = 9;

            const innerW = width - padLeft - padRight;
            const innerH = height - padTop - padBottom;

            const maxValue =
                Math.max.apply(null, entries.map(function(item){ return item.revenue; })) || 1;

            const roundedMax =
                Math.ceil(maxValue / 1000) * 1000 || 1000;

            doc.setLineWidth(0.15);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6);

            [0, .25, .5, .75, 1].forEach(function(ratio){
                const gy = y + padTop + innerH - (ratio * innerH);

                doc.setDrawColor(226, 230, 238);
                doc.line(x + padLeft, gy, x + width - padRight, gy);

                doc.setTextColor(140, 144, 150);
                doc.text(String(Math.round(roundedMax * ratio)), x + padLeft - 2, gy + 1, { align: "right" });
            });

            const slotWidth = innerW / entries.length;
            const barWidth = Math.max(0.6, Math.min(3.2, slotWidth * 0.6));

            entries.forEach(function(item, index){
                const bx = x + padLeft + (index * slotWidth) + ((slotWidth - barWidth) / 2);
                const ratio = item.revenue / roundedMax;
                const barHeight = item.revenue > 0 ? Math.max(0.4, ratio * innerH) : 0.3;
                const by = y + padTop + innerH - barHeight;

                const dayOfWeek = new Date(item.date + "T00:00:00").getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                const color =
                    item.revenue === 0
                        ? [222, 226, 232]
                        : (isWeekend ? [176, 138, 62] : [19, 35, 63]);

                doc.setFillColor(color[0], color[1], color[2]);
                doc.rect(bx, by, barWidth, barHeight, "F");

                const showLabel =
                    entries.length <= 16 ||
                    index === 0 ||
                    index === entries.length - 1 ||
                    index % 5 === 4;

                if(showLabel){
                    doc.setFontSize(5.5);
                    doc.setTextColor(140, 144, 150);
                    doc.text(String(index + 1), bx + (barWidth / 2), y + height - 2, { align: "center" });
                }
            });

            doc.setDrawColor(180, 186, 196);
            doc.line(x + padLeft, y + padTop + innerH, x + width - padRight, y + padTop + innerH);

            return y + height;
        }

        function breakdownTableOptions(startY, head, body, foot){
            return {
                startY: startY,
                head: [head],
                body: body,
                foot: [foot],
                theme: "grid",
                margin: { top: 30, left: 14, right: 14, bottom: 16 },
                styles: {
                    font: "helvetica",
                    fontSize: 8,
                    cellPadding: 2.5,
                    valign: "middle",
                    overflow: "linebreak",
                    textColor: [32, 43, 60],
                    lineColor: [216, 222, 232],
                    lineWidth: 0.15
                },
                headStyles: {
                    fillColor: [11, 24, 73],
                    textColor: [255, 255, 255],
                    fontStyle: "bold",
                    halign: "center"
                },
                footStyles: {
                    fillColor: [255, 244, 207],
                    textColor: [11, 24, 73],
                    fontStyle: "bold",
                    halign: "right"
                },
                alternateRowStyles: {
                    fillColor: [250, 249, 244]
                },
                didDrawPage: function(data){
                    if(data.pageNumber > 1){
                        drawHeader();
                    }

                    drawFooter();
                }
            };
        }

        drawHeader();

        let cursorY = 32;

        cursorY = drawSectionTitle("Overview", cursorY);

        doc.autoTable(breakdownTableOptions(
            cursorY + 3,
            ["Category", "Quantity", "Total Amount"],
            [
                ["Services Availed", formatNumber(summary.services.quantity), pesoPdf(summary.services.amount)],
                ["Products Sold", formatNumber(summary.products.quantity), pesoPdf(summary.products.amount)],
                ["VIP Cards Sold", formatNumber(summary.vip.quantity), pesoPdf(summary.vip.amount)],
                ["Voucher Sales", formatNumber(summary.voucherSales.quantity), pesoPdf(summary.voucherSales.amount)],
                ["Voucher Redeemed", formatNumber(summary.voucherRedeem.quantity), pesoPdf(summary.voucherRedeem.amount)]
            ],
            ["", "", ""]
        ));

        const { sales } = currentStatisticsSnapshot;

        const trendData =
            getMonthlyTrendData(sales, month);

        const serviceItems =
            currentStatisticsSnapshot.statistics.services
                .map(function(item){
                    return { label: item.name, value: Number(item.quantity) || 0 };
                })
                .sort(function(a, b){ return b.value - a.value; });

        const therapistItems =
            getAnalyticsTherapistData(sales);

        const paymentItems =
            getAnalyticsPaymentData(sales);

        const sourceSummary =
            getStatisticsSourceSummary(sales);

        const sourceItems =
            Object.entries(sourceSummary)
                .map(function(entry){ return { label: entry[0], value: Number(entry[1]) || 0 }; })
                .sort(function(a, b){ return b.value - a.value; });

        doc.addPage();
        drawHeader();

        let analyticsY = 32;
        analyticsY = drawSectionTitle("Business Analytics Dashboard", analyticsY);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(111, 116, 111);
        doc.text("Visual performance overview for the selected branch and month.", 14, analyticsY);
        analyticsY += 6;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(11, 24, 73);
        doc.text("Monthly Sales Trend", 14, analyticsY);

        doc.setFontSize(10);
        doc.text(pesoPdf(trendData.totalAmount), pageWidth - 14, analyticsY, { align: "right" });
        analyticsY += 3;

        analyticsY =
            drawMonthlyTrendChart(14, analyticsY, pageWidth - 28, 45, trendData) + 5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(90, 96, 104);
        doc.text(
            `Highest Day: ${pesoPdf(trendData.highest?.revenue || 0)}   •   Daily Average: ${pesoPdf(trendData.average)}   •   Lowest Day: ${pesoPdf(trendData.lowest?.revenue || 0)}`,
            14,
            analyticsY
        );
        analyticsY += 9;

        const chartGap = 10;
        const chartColWidth = (pageWidth - 28 - chartGap) / 2;
        const chartCol1X = 14;
        const chartCol2X = 14 + chartColWidth + chartGap;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(11, 24, 73);
        doc.text("Most Availed Services", chartCol1X, analyticsY);
        doc.text("Therapist Performance", chartCol2X, analyticsY);

        const row1Bottom = Math.max(
            drawBarListChart(
                chartCol1X, analyticsY + 5, chartColWidth,
                serviceItems, [19, 35, 63],
                function(value){ return value + " client" + (value === 1 ? "" : "s"); }
            ),
            drawBarListChart(
                chartCol2X, analyticsY + 5, chartColWidth,
                therapistItems, [47, 112, 72],
                function(value){ return pesoPdf(value); }
            )
        );

        analyticsY = row1Bottom + 8;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(11, 24, 73);
        doc.text("Payment Method Distribution", chartCol1X, analyticsY);
        doc.text("Client Acquisition Sources", chartCol2X, analyticsY);

        drawPaymentDistributionCard(chartCol1X, analyticsY + 5, chartColWidth, paymentItems);

        drawBarListChart(
            chartCol2X, analyticsY + 5, chartColWidth,
            sourceItems, [176, 138, 62],
            function(value){ return value + " client" + (value === 1 ? "" : "s"); }
        );

        drawFooter();

        doc.addPage();
        drawHeader();

        cursorY = 32;
        cursorY = drawSectionTitle("Services", cursorY);

        doc.autoTable(breakdownTableOptions(
            cursorY + 3,
            ["Service", "Category", "Qty Availed", "Total Amount"],
            currentStatisticsSnapshot.statistics.services.map(function(item){
                return [item.name, item.category || "—", formatNumber(item.quantity), pesoPdf(item.amount)];
            }),
            ["Services Summary", "", formatNumber(summary.services.quantity), pesoPdf(summary.services.amount)]
        ));

        cursorY = doc.lastAutoTable.finalY + 10;
        cursorY = drawSectionTitle("Products", cursorY);

        doc.autoTable(breakdownTableOptions(
            cursorY + 3,
            ["Product", "Category", "Qty Sold", "Total Amount"],
            currentStatisticsSnapshot.statistics.products.map(function(item){
                return [item.name, item.category || "—", formatNumber(item.quantity), pesoPdf(item.amount)];
            }),
            ["Products Summary", "", formatNumber(summary.products.quantity), pesoPdf(summary.products.amount)]
        ));

        cursorY = doc.lastAutoTable.finalY + 10;
        cursorY = drawSectionTitle("VIP Card", cursorY);

        const vipAverage =
            summary.vip.quantity > 0
                ? summary.vip.amount / summary.vip.quantity
                : 0;

        doc.autoTable(breakdownTableOptions(
            cursorY + 3,
            ["Total Number Sold", "Total Sales Amount", "Average Selling Price"],
            [[
                formatNumber(summary.vip.quantity),
                pesoPdf(summary.vip.amount),
                pesoPdf(vipAverage)
            ]],
            ["", "", ""]
        ));

        cursorY = doc.lastAutoTable.finalY + 10;
        cursorY = drawSectionTitle("Voucher Sales", cursorY);

        doc.autoTable(breakdownTableOptions(
            cursorY + 3,
            ["Service Voucher", "Voucher Value", "Qty Sold", "Total Amount"],
            currentStatisticsSnapshot.statistics.voucherSales.map(function(item){
                return [item.name, pesoPdf(item.voucherValue), formatNumber(item.quantity), pesoPdf(item.amount)];
            }),
            ["Voucher Sales Summary", "", formatNumber(summary.voucherSales.quantity), pesoPdf(summary.voucherSales.amount)]
        ));

        cursorY = doc.lastAutoTable.finalY + 10;
        cursorY = drawSectionTitle("Voucher Redeem", cursorY);

        doc.autoTable(breakdownTableOptions(
            cursorY + 3,
            ["Service Voucher", "Voucher Value", "Times Redeemed", "Total Redeemed Value"],
            currentStatisticsSnapshot.statistics.voucherRedeem.map(function(item){
                return [item.name, pesoPdf(item.voucherValue), formatNumber(item.quantity), pesoPdf(item.amount)];
            }),
            ["Voucher Redeem Summary", "", formatNumber(summary.voucherRedeem.quantity), pesoPdf(summary.voucherRedeem.amount)]
        ));

        stampPageNumbers();

        doc.save(
            `Crown Head Spa - Statistics - ${branch} - ${month}.pdf`
        );
    }catch(error){
        console.error(error);
        alert("Unable to export the statistics report.");
    }finally{
        if(button){
            button.disabled = false;
            button.textContent = "Export to PDF";
        }
    }
}
