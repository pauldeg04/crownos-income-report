const SERVICE_KEY = "crownServiceMasterList";

let services = [];
let editingServiceId = null;

document.addEventListener("DOMContentLoaded", function(){
    loadServices();
    migrateExistingServices();
    attachEvents();
    populateCategoryFilter();
    renderServices();
});

function attachEvents(){
    document
        .getElementById("addServiceBtn")
        .addEventListener("click", openAddModal);

    document
        .getElementById("closeModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("cancelModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("saveServiceBtn")
        .addEventListener("click", saveService);

    document
        .getElementById("serviceSearch")
        .addEventListener("input", renderServices);

    document
        .getElementById("categoryFilter")
        .addEventListener("change", renderServices);

    document
        .getElementById("statusFilter")
        .addEventListener("change", renderServices);

    document
        .querySelectorAll(".service-tab")
        .forEach(function(tab){
            tab.addEventListener("click", function(){
                activateTab(this.dataset.tab);
            });
        });

    document
        .getElementById("serviceNameInput")
        .addEventListener("input", hideDuplicateWarning);

    document
        .getElementById("voucherAvailableInput")
        .addEventListener("change", function(){
            toggleVoucherValueField();
        });

    document
        .getElementById("serviceCodeInput")
        .addEventListener("input", function(){
            this.value =
                this.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9_-]/g, "");

            hideDuplicateWarning();
        });

    document
        .getElementById("serviceModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeModal();
            }
        });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            closeModal();
        }
    });
}

function createId(){
    return (
        "SRV-" +
        Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 6).toUpperCase()
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

function loadServices(){
    try{
        const raw =
            localStorage.getItem(SERVICE_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        services =
            Array.isArray(parsed)
                ? parsed
                : [];
    }catch(error){
        console.error(error);
        services = [];
    }
}

function saveServices(){
    localStorage.setItem(
        SERVICE_KEY,
        JSON.stringify(services)
    );
}

function migrateExistingServices(){
    let changed = false;

    services =
        services.map(function(service){
            if(typeof service === "string"){
                changed = true;

                return {
                    id: createId(),
                    name: service,
                    category: "Other",
                    duration: inferDuration(service),
                    bedOccupancy: inferDuration(service),
                    code: "",
                    description: "",
                    regularPrice: 0,
                    firstTimerPrice: 0,
                    vipPrice: 0,
                    seniorPwdPrice: 0,
                    commission: 0,
                    colorTag: "Navy",
                    status: "Active",
                    internalNotes: "",
                    createdAt: new Date().toISOString()
                };
            }

            /* "Package" was renamed to "Combo" — existing services still
               carrying the old value are migrated in place below. */
            if(service.category === "Package"){
                changed = true;
            }

            const migrated = {
                id: service.id || createId(),
                name: service.name || "",
                category:
                    service.category === "Package"
                        ? "Combo"
                        : (service.category || "Other"),
                duration: Number(service.duration) || 0,
                bedOccupancy:
                    Number(service.bedOccupancy) ||
                    Number(service.duration) ||
                    0,
                code: service.code || "",
                description: service.description || "",
                regularPrice:
                    Number(
                        service.regularPrice ??
                        service.price ??
                        0
                    ) || 0,
                firstTimerPrice:
                    Number(service.firstTimerPrice) || 0,
                vipPrice:
                    Number(service.vipPrice) || 0,
                seniorPwdPrice:
                    Number(service.seniorPwdPrice) || 0,
                commission:
                    Number(
                        service.commission ??
                        service.therapistCommission ??
                        0
                    ) || 0,
                overtimeCommission:
                    Number(service.overtimeCommission ?? 0) || 0,
                colorTag: service.colorTag || "Navy",
                status:
                    service.status ||
                    (
                        service.active === false
                            ? "Archived"
                            : "Active"
                    ),
                availableForVoucher:
                    service.availableForVoucher === true ||
                    service.voucherAvailable === true,
                voucherValue:
                    Number(
                        service.voucherValue ??
                        service.voucherCost ??
                        0
                    ) || 0,
                voucherValueRegular:
                    Number(
                        service.voucherValueRegular ??
                        service.voucherValue ??
                        service.voucherCost ??
                        0
                    ) || 0,
                voucherValueFirstTimer:
                    Number(service.voucherValueFirstTimer ?? 0) || 0,
                voucherValueVip:
                    Number(service.voucherValueVip ?? 0) || 0,
                availableForFreebies:
                    service.availableForFreebies === true,
                availableForOnlineBooking:
                    service.availableForOnlineBooking === true,
                internalNotes: service.internalNotes || "",
                createdAt:
                    service.createdAt ||
                    new Date().toISOString(),
                updatedAt:
                    service.updatedAt || ""
            };

            if(
                !service.id ||
                !service.category ||
                service.status === undefined ||
                service.availableForVoucher === undefined ||
                service.voucherValueRegular === undefined ||
                service.availableForFreebies === undefined ||
                service.availableForOnlineBooking === undefined ||
                service.overtimeCommission === undefined
            ){
                changed = true;
            }

            return migrated;
        });

    if(changed){
        saveServices();
    }
}

function inferDuration(name){
    const match =
        String(name || "")
            .match(/(\d+)\s*(?:min|mins|minutes)/i);

    return match
        ? Number(match[1]) || 0
        : 0;
}

function populateCategoryFilter(){
    const select =
        document.getElementById("categoryFilter");

    const categories =
        Array.from(
            new Set(
                services
                    .map(function(service){
                        return service.category;
                    })
                    .filter(Boolean)
            )
        ).sort();

    select.innerHTML =
        '<option value="">All Categories</option>' +
        categories.map(function(category){
            return `
                <option value="${escapeHtml(category)}">
                    ${escapeHtml(category)}
                </option>
            `;
        }).join("");
}

function renderServices(){
    const search =
        document
            .getElementById("serviceSearch")
            .value
            .trim()
            .toLowerCase();

    const category =
        document.getElementById("categoryFilter").value;

    const status =
        document.getElementById("statusFilter").value;

    const filtered =
        services.filter(function(service){
            const matchesSearch =
                !search ||
                service.name.toLowerCase().includes(search) ||
                String(service.code || "")
                    .toLowerCase()
                    .includes(search);

            const matchesCategory =
                !category ||
                service.category === category;

            const matchesStatus =
                !status ||
                service.status === status;

            return (
                matchesSearch &&
                matchesCategory &&
                matchesStatus
            );
        });

    const tbody =
        document.getElementById("serviceTableBody");

    tbody.innerHTML = "";

    filtered.forEach(function(service){
        const row =
            document.createElement("tr");

        if(service.status === "Archived"){
            row.classList.add("archived-row");
        }

        row.innerHTML = `
            <td>
                <div class="service-name-cell">

                    <span class="service-color color-${colorClass(service.colorTag)}"></span>

                    <div>
                        <strong>
                            ${escapeHtml(service.name)}
                        </strong>

                        <small>
                            ${escapeHtml(service.code || "No Code")}
                        </small>
                    </div>

                </div>
            </td>

            <td>
                ${escapeHtml(service.category)}
            </td>

            <td>
                ${Number(service.duration || 0)} mins
            </td>

            <td>
                ${formatCurrency(service.regularPrice)}
            </td>

            <td>
                ${formatCurrency(service.firstTimerPrice)}
            </td>

            <td>
                ${formatCurrency(service.vipPrice)}
            </td>

            <td>
                ${formatCurrency(service.seniorPwdPrice)}
            </td>

            <td>
                ${Number(service.commission || 0)}%
            </td>

            <td>
                ${
                    service.availableForVoucher
                        ? renderVoucherTierBadges(service)
                        : `
                            <span class="voucher-not-available">
                                —
                            </span>
                        `
                }
            </td>

            <td>
                ${
                    service.availableForFreebies
                        ? `<span class="voucher-service-badge">Freebie</span>`
                        : `
                            <span class="voucher-not-available">
                                —
                            </span>
                        `
                }
            </td>

            <td>
                ${
                    service.availableForOnlineBooking
                        ? `<span class="voucher-service-badge">Online</span>`
                        : `
                            <span class="voucher-not-available">
                                —
                            </span>
                        `
                }
            </td>

            <td>
                <span class="service-status status-${service.status.toLowerCase()}">
                    ${escapeHtml(service.status)}
                </span>
            </td>

            <td>
                <div class="action-buttons">

                    <button
                        type="button"
                        class="btn btn-sm btn-warning edit-btn"
                    >
                        Edit
                    </button>

                    ${
                        service.status === "Active"
                            ? `
                                <button
                                    type="button"
                                    class="btn btn-sm btn-outline-secondary archive-btn"
                                >
                                    Archive
                                </button>
                            `
                            : `
                                <button
                                    type="button"
                                    class="btn btn-sm btn-success restore-btn"
                                >
                                    Activate
                                </button>
                            `
                    }

                </div>
            </td>
        `;

        row
            .querySelector(".edit-btn")
            .addEventListener("click", function(){
                openEditModal(service.id);
            });

        const archiveButton =
            row.querySelector(".archive-btn");

        if(archiveButton){
            archiveButton.addEventListener("click", function(){
                changeServiceStatus(
                    service.id,
                    "Archived"
                );
            });
        }

        const restoreButton =
            row.querySelector(".restore-btn");

        if(restoreButton){
            restoreButton.addEventListener("click", function(){
                changeServiceStatus(
                    service.id,
                    "Active"
                );
            });
        }

        tbody.appendChild(row);
    });

    document.getElementById("serviceEmptyState")
        .classList.toggle(
            "d-none",
            filtered.length > 0
        );

    document.getElementById("serviceCount").textContent =
        services.length;

    document.getElementById("activeCount").textContent =
        services.filter(function(service){
            return service.status === "Active";
        }).length;

    document.getElementById("archivedCount").textContent =
        services.filter(function(service){
            return service.status === "Archived";
        }).length;
}

function formatCurrency(value){
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

function renderVoucherTierBadges(service){
    const tiers = [
        ["R", service.voucherValueRegular ?? service.voucherValue],
        ["FT", service.voucherValueFirstTimer],
        ["VIP", service.voucherValueVip]
    ].filter(function(tier){
        return Number(tier[1]) > 0;
    });

    if(tiers.length === 0){
        return `
            <span class="voucher-not-available">
                —
            </span>
        `;
    }

    return `
        <div class="voucher-tier-badge-stack">
            ${tiers.map(function(tier){
                return `
                    <span class="voucher-service-badge">
                        ${tier[0]}: ${formatCurrency(tier[1])}
                    </span>
                `;
            }).join("")}
        </div>
    `;
}

function colorClass(value){
    return String(value || "Navy")
        .toLowerCase()
        .replaceAll(" ", "-");
}

function openAddModal(){
    editingServiceId = null;

    document.getElementById("modalEyebrow").textContent =
        "New Service";

    document.getElementById("modalTitle").textContent =
        "Add Service";

    document.getElementById("saveServiceBtn").textContent =
        "Save Service";

    clearForm();
    activateTab("general");
    showModal();
}

function openEditModal(serviceId){
    const service =
        services.find(function(item){
            return item.id === serviceId;
        });

    if(!service){
        return;
    }

    editingServiceId =
        service.id;

    document.getElementById("modalEyebrow").textContent =
        "Edit Service";

    document.getElementById("modalTitle").textContent =
        "Update Service";

    document.getElementById("saveServiceBtn").textContent =
        "Update Service";

    document.getElementById("serviceNameInput").value =
        service.name || "";

    document.getElementById("serviceCategoryInput").value =
        service.category || "";

    document.getElementById("serviceDurationInput").value =
        service.duration || "";

    document.getElementById("serviceCodeInput").value =
        service.code || "";

    document.getElementById("bedOccupancyInput").value =
        service.bedOccupancy || service.duration || "";

    document.getElementById("serviceDescriptionInput").value =
        service.description || "";

    document.getElementById("regularPriceInput").value =
        service.regularPrice || "";

    document.getElementById("firstTimerPriceInput").value =
        service.firstTimerPrice || "";

    document.getElementById("vipPriceInput").value =
        service.vipPrice || "";

    document.getElementById("seniorPwdPriceInput").value =
        service.seniorPwdPrice || "";

    document.getElementById("commissionInput").value =
        service.commission || "";

    document.getElementById("overtimeCommissionInput").value =
        service.overtimeCommission || "";

    document.getElementById("colorTagInput").value =
        service.colorTag || "Navy";

    document.getElementById("serviceStatusInput").value =
        service.status || "Active";

    document.getElementById("voucherAvailableInput").checked =
        service.availableForVoucher === true;

    document.getElementById("voucherValueRegularInput").value =
        service.voucherValueRegular ||
        service.voucherValue ||
        "";

    document.getElementById("voucherValueFirstTimerInput").value =
        service.voucherValueFirstTimer || "";

    document.getElementById("voucherValueVipInput").value =
        service.voucherValueVip || "";

    document.getElementById("freebieAvailableInput").checked =
        service.availableForFreebies === true;

    document.getElementById("onlineBookingAvailableInput").checked =
        service.availableForOnlineBooking === true;

    document.getElementById("internalNotesInput").value =
        service.internalNotes || "";

    toggleVoucherValueField();
    hideDuplicateWarning();
    activateTab("general");
    showModal();
}

function clearForm(){
    document.getElementById("serviceNameInput").value = "";
    document.getElementById("serviceCategoryInput").value = "";
    document.getElementById("serviceDurationInput").value = "";
    document.getElementById("serviceCodeInput").value = "";
    document.getElementById("bedOccupancyInput").value = "";
    document.getElementById("serviceDescriptionInput").value = "";
    document.getElementById("regularPriceInput").value = "";
    document.getElementById("firstTimerPriceInput").value = "";
    document.getElementById("vipPriceInput").value = "";
    document.getElementById("seniorPwdPriceInput").value = "";
    document.getElementById("commissionInput").value = "";
    document.getElementById("overtimeCommissionInput").value = "";
    document.getElementById("colorTagInput").value = "Navy";
    document.getElementById("serviceStatusInput").value = "Active";
    document.getElementById("voucherAvailableInput").checked = false;
    document.getElementById("voucherValueRegularInput").value = "";
    document.getElementById("voucherValueFirstTimerInput").value = "";
    document.getElementById("voucherValueVipInput").value = "";
    document.getElementById("freebieAvailableInput").checked = false;
    document.getElementById("onlineBookingAvailableInput").checked = false;
    document.getElementById("internalNotesInput").value = "";

    toggleVoucherValueField();
    hideDuplicateWarning();
}

function activateTab(tabName){
    document
        .querySelectorAll(".service-tab")
        .forEach(function(tab){
            tab.classList.toggle(
                "active",
                tab.dataset.tab === tabName
            );
        });

    document
        .querySelectorAll(".service-tab-panel")
        .forEach(function(panel){
            panel.classList.toggle(
                "active",
                panel.dataset.panel === tabName
            );
        });
}

function saveService(){
    const name =
        document
            .getElementById("serviceNameInput")
            .value
            .trim();

    const category =
        document.getElementById("serviceCategoryInput").value;

    const duration =
        Number(
            document.getElementById("serviceDurationInput").value
        );

    const code =
        document
            .getElementById("serviceCodeInput")
            .value
            .trim()
            .toUpperCase();

    const bedOccupancy =
        Number(
            document.getElementById("bedOccupancyInput").value
        ) || duration;

    const availableForVoucher =
        document.getElementById("voucherAvailableInput").checked;

    const voucherValueRegular =
        Number(
            document.getElementById("voucherValueRegularInput").value
        ) || 0;

    const voucherValueFirstTimer =
        Number(
            document.getElementById("voucherValueFirstTimerInput").value
        ) || 0;

    const voucherValueVip =
        Number(
            document.getElementById("voucherValueVipInput").value
        ) || 0;

    const voucherValue =
        voucherValueRegular ||
        voucherValueFirstTimer ||
        voucherValueVip;

    const availableForFreebies =
        document.getElementById("freebieAvailableInput").checked;

    const availableForOnlineBooking =
        document.getElementById("onlineBookingAvailableInput").checked;

    const regularPrice =
        Number(document.getElementById("regularPriceInput").value) || 0;

    const firstTimerPrice =
        Number(document.getElementById("firstTimerPriceInput").value) || 0;

    const vipPrice =
        Number(document.getElementById("vipPriceInput").value) || 0;

    const seniorPwdPrice =
        Number(document.getElementById("seniorPwdPriceInput").value) || 0;

    const commission =
        Number(document.getElementById("commissionInput").value) || 0;

    const overtimeCommission =
        Number(document.getElementById("overtimeCommissionInput").value) || 0;

    if(!name){
        alert("Please enter a Service Name.");
        activateTab("general");
        return;
    }

    if(!category){
        alert("Please select a Category.");
        activateTab("general");
        return;
    }

    if(!duration || duration <= 0){
        alert("Please enter a valid Duration.");
        activateTab("general");
        return;
    }

    if(bedOccupancy < 0){
        alert("Bed Occupancy cannot be negative.");
        activateTab("general");
        return;
    }

    if(
        regularPrice < 0 ||
        firstTimerPrice < 0 ||
        vipPrice < 0 ||
        seniorPwdPrice < 0
    ){
        alert("Prices cannot be negative.");
        activateTab("general");
        return;
    }

    if(commission < 0 || overtimeCommission < 0){
        alert("Commission cannot be negative.");
        activateTab("internal");
        return;
    }

    if(
        availableForVoucher &&
        voucherValueRegular <= 0 &&
        voucherValueFirstTimer <= 0 &&
        voucherValueVip <= 0
    ){
        alert(
            "Please enter a Voucher Value for at least one tier (Regular, First Timer, or VIP)."
        );
        activateTab("internal");
        return;
    }

    const duplicate =
        services.find(function(service){
            if(service.id === editingServiceId){
                return false;
            }

            const sameName =
                service.name.toLowerCase() ===
                name.toLowerCase();

            const sameCode =
                code &&
                String(service.code || "").toLowerCase() ===
                code.toLowerCase();

            return sameName || sameCode;
        });

    if(duplicate){
        showDuplicateWarning();

        alert(
            `A service with the same ${
                duplicate.name.toLowerCase() === name.toLowerCase()
                    ? "name"
                    : "code"
            } already exists. Please edit the existing service instead.`
        );

        return;
    }

    const serviceData = {
        id:
            editingServiceId ||
            createId(),
        name: name,
        category: category,
        duration: duration,
        bedOccupancy: bedOccupancy,
        code: code,
        description:
            document
                .getElementById("serviceDescriptionInput")
                .value
                .trim(),
        regularPrice: regularPrice,
        firstTimerPrice: firstTimerPrice,
        vipPrice: vipPrice,
        seniorPwdPrice: seniorPwdPrice,
        commission: commission,
        overtimeCommission: overtimeCommission,
        colorTag:
            document.getElementById("colorTagInput").value,
        status:
            document.getElementById("serviceStatusInput").value,
        availableForVoucher: availableForVoucher,
        voucherValue:
            availableForVoucher
                ? voucherValue
                : 0,
        voucherValueRegular:
            availableForVoucher
                ? voucherValueRegular
                : 0,
        voucherValueFirstTimer:
            availableForVoucher
                ? voucherValueFirstTimer
                : 0,
        voucherValueVip:
            availableForVoucher
                ? voucherValueVip
                : 0,
        availableForFreebies: availableForFreebies,
        availableForOnlineBooking: availableForOnlineBooking,
        internalNotes:
            document
                .getElementById("internalNotesInput")
                .value
                .trim(),
        createdAt:
            editingServiceId
                ? (
                    services.find(function(service){
                        return service.id === editingServiceId;
                    })?.createdAt ||
                    new Date().toISOString()
                )
                : new Date().toISOString(),
        updatedAt:
            new Date().toISOString()
    };

    if(editingServiceId){
        services =
            services.map(function(service){
                return service.id === editingServiceId
                    ? serviceData
                    : service;
            });
    }else{
        services.push(serviceData);
    }

    services.sort(function(a, b){
        return a.name.localeCompare(b.name);
    });

    saveServices();
    populateCategoryFilter();
    renderServices();
    closeModal();
}

function changeServiceStatus(serviceId, newStatus){
    const service =
        services.find(function(item){
            return item.id === serviceId;
        });

    if(!service){
        return;
    }

    const action =
        newStatus === "Archived"
            ? "archive"
            : "activate";

    if(
        !confirm(
            `Are you sure you want to ${action} "${service.name}"?`
        )
    ){
        return;
    }

    service.status =
        newStatus;

    service.updatedAt =
        new Date().toISOString();

    saveServices();
    renderServices();
}

function getVoucherTierInputs(){
    return [
        document.getElementById("voucherValueRegularInput"),
        document.getElementById("voucherValueFirstTimerInput"),
        document.getElementById("voucherValueVipInput")
    ].filter(Boolean);
}

function toggleVoucherValueField(){
    const checkbox =
        document.getElementById("voucherAvailableInput");

    const field =
        document.getElementById("voucherValueField");

    const inputs =
        getVoucherTierInputs();

    if(!checkbox || !field || inputs.length === 0){
        return;
    }

    field.classList.toggle(
        "d-none",
        !checkbox.checked
    );

    inputs.forEach(function(input){
        if(!checkbox.checked){
            input.value = "";
        }
    });
}

function showDuplicateWarning(){
    document
        .getElementById("duplicateWarning")
        .classList.remove("d-none");
}

function hideDuplicateWarning(){
    document
        .getElementById("duplicateWarning")
        .classList.add("d-none");
}

function showModal(){
    document
        .getElementById("serviceModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");

    setTimeout(function(){
        document.getElementById("serviceNameInput").focus();
    }, 50);
}

function closeModal(){
    document
        .getElementById("serviceModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    editingServiceId = null;
}
