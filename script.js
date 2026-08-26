const STORAGE_PREFIX = "crownDailySales_";
const BRANCH_KEY = "crownSelectedBranch";
const SERVICE_MASTER_KEY = "crownServiceMasterList";
const PRODUCT_MASTER_KEY = "crownProductMasterList";
const THERAPIST_MASTER_KEY = "crownTherapistMasterList";
const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SCHEDULE_PREFIX = "crownSchedule_";

/* Synchronous snapshot of the client list, kept current by getClients()
   (see client-store.js — the actual storage is IndexedDB, which is
   async). Exists so display-only reads (getClientByName, the Client
   datalist in loadModalOptions) don't have to turn their whole call
   chain async just to look something up. */
let cachedClients = [];

let salesRows = [];
let editingSaleId = null;
let modalItems = [];
let modalCompanions = [];
let modalVouchers = [];
let modalExecutiveVoucher = false;
let modalPayments = [];
let calendarYear;
let calendarMonth;

/* Receptionist can record new sales but cannot edit/delete a saved
   transaction, and cannot bulk-clear or manually re-save a day —
   only Admin / Executive Assistant can, so a mistake requires
   calling a superior to void it. */
function canEditSavedSales(){
  const role =
    window.CrownAuth?.getEffectiveRole?.();

  return role === "Admin" || role === "Executive Assistant";
}

document.addEventListener("DOMContentLoaded", async function(){
  renderStatisticsSourceSummary();

  initializeDate();
  initializeCalendar();
  initializeDateDropdown();
  attachEvents();
  await getClients();
  loadModalOptions();
  loadDailySales();
  resyncLocalSalesRowsToCloud();
  updateSalesRecord();
  updateDailyScheduleOverview();
  applyReceptionistRestrictions();

  /* Re-render kapag may bagong Daily Income entry galing sa ibang
     device/branch (hal. receptionist sa ibang branch) — dati walang
     listener dito kaya kailangan pang i-reload manually bago
     lumabas ang bagong data. */
  window.addEventListener("crownCloudUpdate", function(event){
    const keys = event.detail?.keys || [];
    const branch = getSelectedBranch();
    const branchPrefix = `${STORAGE_PREFIX}${branch}_`;

    const touchesCurrentView =
      keys.includes(getStorageKey());

    const touchesCurrentBranch =
      keys.some(function(key){
        return key.startsWith(branchPrefix);
      });

    if(touchesCurrentView){
      loadDailySales();
    }

    if(touchesCurrentBranch){
      renderCalendar();
    }
  });
});

function applyReceptionistRestrictions(){
  if(canEditSavedSales()){
    return;
  }

  document.getElementById("clearBtn")?.classList.add("d-none");
  document.getElementById("salesActionHeader")?.classList.add("d-none");
}

function attachEvents(){
  document.getElementById("date").addEventListener("change", function(){
    loadDailySales();
    syncCalendarToSelectedDate();
    updateSalesRecord();
    updateDailyScheduleOverview();
    updateDateDropdownLabel();
    document.getElementById("calendarPopover")?.classList.add("d-none");
  });

  document.getElementById("addSaleBtn").addEventListener("click", openNewSaleModal);
  document.getElementById("pdfBtn").addEventListener("click", exportPDF);
  document.getElementById("clearBtn").addEventListener("click", clearDailySales);

  document.getElementById("closeSaleModalBtn").addEventListener("click", closeSaleModal);
  document.getElementById("cancelSaleModalBtn").addEventListener("click", closeSaleModal);
  document.getElementById("saveSaleModalBtn").addEventListener("click", settleModalSale);
  document.getElementById("addToListModalBtn").addEventListener("click", addModalSaleToList);
  document.getElementById("addToScheduleModalBtn").addEventListener("click", addModalSaleToSchedule);

  document.getElementById("modalAddServiceBtn").addEventListener("click", function(){
    addModalItem("Service");
  });

  document.getElementById("modalTimeInput").addEventListener("change", function(){
    syncModalItemStartTimes(this.value);
  });

  document.getElementById("modalAddFreebieBtn").addEventListener("click", function(){
    addModalFreebieItem();
  });

  document.getElementById("modalAddProductBtn").addEventListener("click", function(){
    addModalItem("Product");
  });

  document.getElementById("modalAddConsumableBtn").addEventListener("click", function(){
    addModalConsumableItem();
  });

  document.getElementById("modalAddVipCardBtn").addEventListener("click", function(){
    addVipCardToModal();
  });

  document.getElementById("modalAddCompanionBtn").addEventListener("click", function(){
    addModalCompanion();
  });

  ["input", "change", "blur"].forEach(function(eventName){
    document.getElementById("modalClientInput").addEventListener(eventName, function(){
      refreshModalVipState();
      renderModalItems();
      renderModalCompanions();
    });
  });

  document.getElementById("modalClientMoreBtn").addEventListener("click", function(){
    toggleModalClientDetailsPanel();
  });

  document.getElementById("modalIssueInvoiceInput").addEventListener("change", function(){
    document.getElementById("modalInvoiceFieldsRow")
      .classList.toggle("d-none", !this.checked);
  });

  document.getElementById("modalAddVoucherBtn").addEventListener("click", function(){
    addModalVoucher();
  });

  document.getElementById("modalExecutiveVoucherBtn").addEventListener("click", function(){
    toggleExecutiveVoucher();
  });

  document.getElementById("modalGenerateVoucherBtn").addEventListener("click", function(){
    openVoucherGenerator();
  });

  document.getElementById("voucherGenCloseBtn").addEventListener("click", function(){
    closeVoucherGenerator();
  });

  document.getElementById("voucherGenCreateBtn").addEventListener("click", function(){
    generateVoucherFromDialog();
  });

  document.getElementById("voucherGenBackdrop").addEventListener("click", function(event){
    if(event.target === this){
      closeVoucherGenerator();
    }
  });

  document.getElementById("modalAddPaymentBtn").addEventListener("click", function(){
    addModalPayment();
  });

  document.getElementById("saleModalBackdrop").addEventListener("click", function(event){
    if(event.target === this){
      closeSaleModal();
    }
  });

  document.addEventListener("keydown", function(event){
    if(event.key === "Escape"){
      closeSaleModal();
    }
  });
}


function getDailyScheduleData(branchName, dateValue){
  if(!branchName || !dateValue){
    return [];
  }

  try{
    const raw =
      localStorage.getItem(
        `${SCHEDULE_PREFIX}${branchName}_${dateValue}`
      );

    const parsed =
      raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed
      : [];
  }catch(error){
    console.error("Unable to load schedule overview:", error);
    return [];
  }
}

function dailyTimeToMinutes(timeValue){
  const parts =
    String(timeValue || "00:00").split(":");

  return (
    (Number(parts[0]) || 0) * 60 +
    (Number(parts[1]) || 0)
  );
}

function formatDailyScheduleTime(timeValue){
  const totalMinutes =
    dailyTimeToMinutes(timeValue);

  const hour24 =
    Math.floor(totalMinutes / 60);

  const minute =
    totalMinutes % 60;

  const suffix =
    hour24 >= 12 ? "PM" : "AM";

  const hour12 =
    hour24 % 12 || 12;

  return (
    hour12 +
    ":" +
    String(minute).padStart(2, "0") +
    " " +
    suffix
  );
}

function updateDailyScheduleOverview(){
  const countElement =
    document.getElementById("dailyScheduledCount");

  const nextElement =
    document.getElementById("dailyNextSchedule");

  const countLabel =
    document.getElementById("dailyScheduledLabel");

  const nextMeta =
    document.getElementById("dailyNextScheduleMeta");

  if(
    !countElement ||
    !nextElement ||
    !countLabel ||
    !nextMeta
  ){
    return;
  }

  const branch =
    getSelectedBranch();

  const selectedDate =
    document.getElementById("date")?.value || "";

  if(!branch || !selectedDate){
    countElement.textContent = "0";
    countLabel.textContent =
      "No bookings for selected date";
    nextElement.textContent = "—";
    nextMeta.textContent =
      "Select a branch and date";
    return;
  }

  const schedule =
    getDailyScheduleData(
      branch,
      selectedDate
    );

  const sorted =
    schedule
      .slice()
      .sort(function(a, b){
        return (
          dailyTimeToMinutes(a?.startTime) -
          dailyTimeToMinutes(b?.startTime)
        );
      });

  countElement.textContent =
    sorted.length.toLocaleString("en-PH");

  countLabel.textContent =
    sorted.length === 1
      ? "1 scheduled client"
      : `${sorted.length} scheduled clients`;

  if(sorted.length === 0){
    nextElement.textContent =
      "No schedule";

    nextMeta.textContent =
      formatDate(selectedDate);

    return;
  }

  const today =
    new Date();

  const todayValue = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");

  let nextItem = null;

  if(selectedDate < todayValue){
    nextElement.textContent =
      "Completed";

    nextMeta.textContent =
      `${sorted.length} completed booking${sorted.length === 1 ? "" : "s"}`;

    return;
  }

  if(selectedDate > todayValue){
    nextItem = sorted[0];
  }else{
    const currentMinutes =
      today.getHours() * 60 +
      today.getMinutes();

    nextItem =
      sorted.find(function(item){
        return (
          dailyTimeToMinutes(item?.startTime) >=
          currentMinutes
        );
      }) || null;
  }

  if(!nextItem){
    nextElement.textContent =
      "No more schedule";

    nextMeta.textContent =
      `${sorted.length} booking${sorted.length === 1 ? "" : "s"} today`;

    return;
  }

  nextElement.textContent =
    formatDailyScheduleTime(
      nextItem.startTime
    );

  const clientName =
    String(
      nextItem.client ||
      nextItem.clientName ||
      "Scheduled Client"
    ).trim();

  const bedLabel =
    nextItem.bed
      ? ` · Bed ${nextItem.bed}`
      : "";

  nextMeta.textContent =
    `${clientName}${bedLabel}`;
}


/* DATA */

function createId(){
  return (
    "SALE-" +
    Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 7).toUpperCase()
  );
}

function getSelectedBranch(){
  return localStorage.getItem(BRANCH_KEY) || "";
}

function getStorageKey(){
  return (
    STORAGE_PREFIX +
    (getSelectedBranch() || "NoBranch") +
    "_" +
    (document.getElementById("date").value || "NoDate")
  );
}

function getServiceCategoryMap(){
  const map = {};

  getServices().forEach(function(service){
    map[String(service?.name || "").trim().toLowerCase()] =
      service?.category || "Other";
  });

  return map;
}

function renderDailyKpi(salesCounts, productsCount, vipCardCount, sourceCounts, totalClient){
  const setValue = function(id, value){
    const field = document.getElementById(id);

    if(field){
      field.textContent = Number(value || 0).toLocaleString("en-PH");
    }
  };

  setValue("kpiHeadSpa", salesCounts["Head Spa"]);
  setValue("kpiMassage", salesCounts["Massage"]);
  setValue("kpiPackage", salesCounts["Package"]);
  setValue("kpiAddOn", salesCounts["Add-on"]);
  setValue("kpiKiddie", salesCounts["Kiddie"]);
  setValue("kpiProducts", productsCount);
  setValue("kpiVipCard", vipCardCount);

  setValue("kpiTotalClient", totalClient);
  setValue("kpiFacebook", sourceCounts["Facebook"]);
  setValue("kpiWalkIn", sourceCounts["Walk-in"]);
  setValue("kpiReferral", sourceCounts["Referral"]);
  setValue("kpiReturning", sourceCounts["Returning"]);
}

function readList(key){
  try{
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(error){
    console.error(`Unable to load ${key}:`, error);
    return [];
  }
}

function getServices(){
  return readList(SERVICE_MASTER_KEY)
    .map(function(item){
      if(typeof item === "string"){
        return {
          name: item,
          regularPrice: 0,
          firstTimerPrice: 0,
          vipPrice: 0,
          seniorPwdPrice: 0,
          status: "Active"
        };
      }

      return {
        ...item,
        name: item?.name || "",
        regularPrice: Number(item?.regularPrice ?? item?.price ?? 0) || 0,
        firstTimerPrice: Number(item?.firstTimerPrice ?? 0) || 0,
        vipPrice: Number(item?.vipPrice ?? 0) || 0,
        seniorPwdPrice: Number(item?.seniorPwdPrice ?? 0) || 0,
        availableForVoucher:
          item?.availableForVoucher === true ||
          item?.voucherAvailable === true,
        voucherValue:
          Number(
            item?.voucherValue ??
            item?.voucherCost ??
            0
          ) || 0,
        voucherValueRegular:
          Number(
            item?.voucherValueRegular ??
            item?.voucherValue ??
            item?.voucherCost ??
            0
          ) || 0,
        voucherValueFirstTimer:
          Number(item?.voucherValueFirstTimer ?? 0) || 0,
        voucherValueVip:
          Number(item?.voucherValueVip ?? 0) || 0,
        status: item?.status || (item?.active === false ? "Archived" : "Active")
      };
    })
    .filter(function(item){
      return item.name && item.status === "Active";
    })
    .sort(function(a, b){
      return a.name.localeCompare(b.name);
    });
}

function getServiceVoucherTiers(service){
  const tiers = [
    ["Regular", Number(service?.voucherValueRegular) || 0],
    ["First Timer", Number(service?.voucherValueFirstTimer) || 0],
    ["VIP", Number(service?.voucherValueVip) || 0]
  ].filter(function(tier){
    return tier[1] > 0;
  }).map(function(tier){
    return {
      tier: tier[0],
      value: tier[1]
    };
  });

  if(
    tiers.length === 0 &&
    Number(service?.voucherValue) > 0
  ){
    return [{
      tier: "Regular",
      value: Number(service.voucherValue) || 0
    }];
  }

  return tiers;
}


function getVoucherItems(){
  const services =
    getServices()
      .filter(function(item){
        return item.availableForVoucher === true;
      })
      .flatMap(function(item){
        return getServiceVoucherTiers(item).map(function(tierData){
          return {
            itemType: "Service",
            name: item.name,
            tier: tierData.tier,
            voucherValue: tierData.value
          };
        });
      });

  const products =
    getProducts()
      .filter(function(item){
        return item.availableForVoucher === true && Number(item.voucherValue) > 0;
      })
      .map(function(item){
        return {
          itemType: "Product",
          name: item.name,
          tier: "",
          voucherValue: Number(item.voucherValue) || 0
        };
      });

  return services.concat(products);
}

function getVoucherItemKey(item){
  return `${item.itemType}:${item.name}:${item.tier || ""}`;
}

function findVoucherItem(value){
  return getVoucherItems().find(function(item){
    return getVoucherItemKey(item) === value;
  }) || null;
}

function getProducts(){
  const physicalProducts =
    readList(PRODUCT_MASTER_KEY)
      .map(function(item){
        if(typeof item === "string"){
          return {
            name: item,
            sellingPrice: 0,
            status: "Active",
            productKind: "Product"
          };
        }

        return {
          ...item,
          name: item?.name || "",
          sellingPrice: Number(
            item?.sellingPrice ??
            item?.retailPrice ??
            item?.regularPrice ??
            item?.price ??
            item?.amount ??
            0
          ) || 0,
          availableForVoucher:
            item?.availableForVoucher === true ||
            item?.voucherAvailable === true,
          voucherValue:
            Number(item?.voucherValue ?? item?.voucherCost ?? 0) || 0,
          status: item?.status || (item?.active === false ? "Archived" : "Active"),
          productKind: item?.productKind || "Product"
        };
      })
      .filter(function(item){
        return item.name && item.status === "Active";
      });

  const serviceVoucherProducts =
    getServices()
      .filter(function(service){
        return service.availableForVoucher === true;
      })
      .flatMap(function(service){
        const tiers =
          getServiceVoucherTiers(service);

        const singleRegularTier =
          tiers.length === 1 &&
          tiers[0].tier === "Regular";

        return tiers.map(function(tierData){
          return {
            id: `SERVICE-VOUCHER:${service.name}:${tierData.tier}`,
            name:
              singleRegularTier
                ? `Voucher — ${service.name}`
                : `Voucher — ${service.name} (${tierData.tier})`,
            sourceServiceName: service.name,
            voucherTier: tierData.tier,
            sellingPrice: tierData.value,
            voucherValue: tierData.value,
            status: "Active",
            productKind: "Service Voucher",
            virtualProduct: true
          };
        });
      });

  return physicalProducts
    .concat(serviceVoucherProducts)
    .sort(function(a, b){
      return a.name.localeCompare(b.name);
    });
}

function getTherapists(){
  const branch = getSelectedBranch();

  return readList(THERAPIST_MASTER_KEY)
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
        branches: Array.isArray(item?.branches) ? item.branches : [],
        status: item?.status || "Active"
      };
    })
    .filter(function(item){
      return (
        item.name &&
        item.status === "Active" &&
        (
          item.branches.length === 0 ||
          item.branches.includes(branch)
        )
      );
    })
    .map(function(item){
      return item.name;
    })
    .sort();
}

/* Also refreshes cachedClients (see the top of this file) as a side
   effect, so the display-only call sites that only need a synchronous
   lookup (getClientByName, the datalist in loadModalOptions) don't have
   to go async themselves. */
async function getClients(){
  try{
    cachedClients = await window.CrownClientStore.getAll();
  }catch(error){
    console.error("Unable to load clients:", error);
    cachedClients = [];
  }

  return cachedClients;
}

function findService(name){
  return getServices().find(function(item){
    return item.name === name;
  }) || null;
}

function findProduct(name){
  return getProducts().find(function(item){
    return item.name === name;
  }) || null;
}

function isServiceVoucherProduct(product){
  return (
    product &&
    product.productKind === "Service Voucher" &&
    product.virtualProduct === true
  );
}

function normalizeName(value){
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isVipCardName(value){
  const normalized = normalizeName(value);

  return (
    normalized === "vipcard" ||
    normalized.includes("vipmembershipcard") ||
    normalized.includes("viployaltycard")
  );
}

/* Synchronous on purpose — reads the cachedClients snapshot getClients()
   keeps current, rather than awaiting IndexedDB, since callers use this
   for a plain display lookup (VIP check, prefilling the client-details
   panel). A moment-stale snapshot is an acceptable tradeoff there. */
function getClientByName(clientName){
  const normalizedName =
    normalizeClientName(clientName).toLowerCase();

  if(!normalizedName){
    return null;
  }

  return cachedClients.find(function(client){
    return (
      normalizeClientName(client?.name).toLowerCase() ===
      normalizedName
    );
  }) || null;
}

function clientHasVipStatus(client){
  if(!client){
    return false;
  }

  const vipValue =
    String(client?.vip ?? "").trim().toLowerCase();

  const statusValue =
    String(client?.status ?? "").trim().toLowerCase();

  const typeValue =
    String(client?.clientType ?? "").trim().toLowerCase();

  return (
    client?.vip === true ||
    ["yes", "vip", "active vip", "vip client"].includes(vipValue) ||
    ["vip", "active vip", "vip client"].includes(statusValue) ||
    ["vip", "vip client"].includes(typeValue)
  );
}

function isExistingVipClient(clientName){
  return clientHasVipStatus(
    getClientByName(clientName)
  );
}

/* ---------- "More" client details panel (Client field shortcut) ---------- */

function getBranchListForModal(){
  try{
    const saved = localStorage.getItem(BRANCH_MASTER_KEY);
    const parsed = saved ? JSON.parse(saved) : [];

    return Array.isArray(parsed) ? parsed : [];
  }catch(error){
    return [];
  }
}

function populateModalClientHomeBranch(){
  const select = document.getElementById("modalClientHomeBranch");
  const currentValue = select.value;

  select.innerHTML =
    '<option value="">Select Branch</option>' +
    getBranchListForModal().map(function(branch){
      return `<option value="${escapeHtml(branch.name)}">${escapeHtml(branch.name)}</option>`;
    }).join("");

  select.value = currentValue;
}

function toggleModalClientDetailsPanel(forceShow){
  const panel = document.getElementById("modalClientDetailsPanel");
  const shouldShow =
    typeof forceShow === "boolean"
      ? forceShow
      : panel.classList.contains("d-none");

  panel.classList.toggle("d-none", !shouldShow);
}

function resetModalClientDetailsPanel(){
  populateModalClientHomeBranch();

  document.getElementById("modalClientLoyaltyCardNumber").value = "";
  document.getElementById("modalClientLastName").value = "";
  document.getElementById("modalClientFirstName").value = "";
  document.getElementById("modalClientMiddleInitial").value = "";
  document.getElementById("modalClientSex").value = "";
  document.getElementById("modalClientContactNumber").value = "";
  document.getElementById("modalClientEmail").value = "";
  document.getElementById("modalClientBirthday").value = "";
  document.getElementById("modalClientHomeAddress").value = "";
  document.getElementById("modalClientHomeBranch").value = getSelectedBranch() || "";
  document.getElementById("modalClientVipStatus").value = "No";
  document.getElementById("modalClientRemarks").value = "";

  toggleModalClientDetailsPanel(false);
}

/* When editing a saved sale, prefill the panel from the client's existing
   Client Database profile (if one exists) so it doubles as a quick-edit
   shortcut instead of always starting blank. */
function prefillModalClientDetailsPanel(clientName){
  populateModalClientHomeBranch();

  const client = getClientByName(clientName);

  if(!client){
    resetModalClientDetailsPanel();
    return;
  }

  document.getElementById("modalClientLoyaltyCardNumber").value = client.loyaltyCardNumber || "";
  document.getElementById("modalClientLastName").value = client.lastName || "";
  document.getElementById("modalClientFirstName").value = client.firstName || "";
  document.getElementById("modalClientMiddleInitial").value = client.middleInitial || "";
  document.getElementById("modalClientSex").value = client.sex || "";

  document.getElementById("modalClientContactNumber").value =
    String(client.contactNumber || "").replace(/\D/g, "").replace(/^63/, "");

  document.getElementById("modalClientEmail").value = client.email || "";
  document.getElementById("modalClientBirthday").value = client.birthday || "";
  document.getElementById("modalClientHomeAddress").value = client.homeAddress || "";
  document.getElementById("modalClientHomeBranch").value = client.branch || "";
  document.getElementById("modalClientVipStatus").value = client.vip || "No";
  document.getElementById("modalClientRemarks").value = client.notes || "";

  toggleModalClientDetailsPanel(false);
}

function collectModalClientDetailsInput(){
  return {
    loyaltyCardNumber: document.getElementById("modalClientLoyaltyCardNumber").value.trim(),
    lastName: document.getElementById("modalClientLastName").value.trim(),
    firstName: document.getElementById("modalClientFirstName").value.trim(),
    middleInitial: document.getElementById("modalClientMiddleInitial").value.trim(),
    sex: document.getElementById("modalClientSex").value,
    contactDigits: document.getElementById("modalClientContactNumber").value.replace(/\D/g, ""),
    email: document.getElementById("modalClientEmail").value.trim(),
    birthday: document.getElementById("modalClientBirthday").value,
    homeAddress: document.getElementById("modalClientHomeAddress").value.trim(),
    branch: document.getElementById("modalClientHomeBranch").value,
    vip: document.getElementById("modalClientVipStatus").value,
    notes: document.getElementById("modalClientRemarks").value.trim()
  };
}

function hasAnyModalClientDetail(details){
  return Boolean(
    details.loyaltyCardNumber ||
    details.lastName ||
    details.firstName ||
    details.middleInitial ||
    details.sex ||
    details.contactDigits ||
    details.email ||
    details.birthday ||
    details.homeAddress ||
    details.branch ||
    details.vip === "Yes" ||
    details.notes
  );
}

/* Upserts the "More" panel fields into the Client Database, keyed by the
   Client field's typed name (the same key used to match this client
   against sales elsewhere). Blank fields never overwrite existing data —
   this only fills gaps, matching the Client Database Add/Edit modals. */
async function applyModalClientDetailsToDatabase(clientName){
  const details = collectModalClientDetailsInput();

  if(!hasAnyModalClientDetail(details)){
    return;
  }

  const cleanName = normalizeClientName(clientName);

  if(!cleanName){
    return;
  }

  const clients = await getClients();
  const key = cleanName.toLowerCase();

  let client =
    clients.find(function(item){
      return normalizeClientName(item?.name).toLowerCase() === key;
    });

  if(!client){
    client = {
      id:
        "CLI-" +
        Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 6).toUpperCase(),
      name: cleanName,
      vip: "No",
      notes: "",
      totalVisits: 0,
      lastVisit: "",
      totalSpent: 0,
      clientRole: "Principal",
      principalClients: [],
      salesBranches: [],
      createdAt: new Date().toISOString()
    };

    clients.push(client);
  }

  if(details.loyaltyCardNumber) client.loyaltyCardNumber = details.loyaltyCardNumber;
  if(details.lastName) client.lastName = details.lastName;
  if(details.firstName) client.firstName = details.firstName;
  if(details.middleInitial) client.middleInitial = details.middleInitial;
  if(details.sex) client.sex = details.sex;
  if(details.contactDigits) client.contactNumber = "+63" + details.contactDigits;
  if(details.email) client.email = details.email;
  if(details.birthday) client.birthday = details.birthday;
  if(details.homeAddress) client.homeAddress = details.homeAddress;
  if(details.branch) client.branch = details.branch;
  if(details.vip === "Yes") client.vip = "Yes";
  if(details.notes) client.notes = details.notes;

  client.updatedAt = new Date().toISOString();

  await window.CrownClientStore.saveAll(clients);
}

function currentTimeValue(){
  const now = new Date();

  return (
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0")
  );
}

function formatTimeValue(value){
  if(!value){
    return "—";
  }

  const parts = value.split(":");
  const hour24 = Number(parts[0]) || 0;
  const minute = Number(parts[1]) || 0;
  const suffix = hour24 >= 12 ? "PM" : "AM";

  return (
    (hour24 % 12 || 12) +
    ":" +
    String(minute).padStart(2, "0") +
    " " +
    suffix
  );
}

function peso(value){
  return (
    "₱" +
    Number(value || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

function formatDate(value){
  if(!value){
    return "";
  }

  return new Date(`${value}T00:00:00`)
    .toLocaleDateString("en-PH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* PAGE AND CALENDAR */

function initializeDate(){
  const input = document.getElementById("date");

  if(!input.value){
    const today = new Date();

    input.value = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
  }
}


function initializeCalendar(){
  syncCalendarToSelectedDate();

  document.getElementById("prevMonthBtn").addEventListener("click", function(){
    calendarMonth--;

    if(calendarMonth < 0){
      calendarMonth = 11;
      calendarYear--;
    }

    renderCalendar();
  });

  document.getElementById("nextMonthBtn").addEventListener("click", function(){
    calendarMonth++;

    if(calendarMonth > 11){
      calendarMonth = 0;
      calendarYear++;
    }

    renderCalendar();
  });
}

/* Collapsed calendar: the month grid only shows inside a popover opened
   from a compact "Select date" pill, so the header stays clean instead of
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
  const value = document.getElementById("date").value;

  if(!label){
    return;
  }

  label.textContent = value ? formatDate(value) : "Select date";
}

function syncCalendarToSelectedDate(){
  const parts = document.getElementById("date").value.split("-");

  calendarYear = Number(parts[0]);
  calendarMonth = Number(parts[1]) - 1;

  renderCalendar();
}

function renderCalendar(){
  const grid = document.getElementById("calendarGrid");
  const title = document.getElementById("calendarTitle");
  const selectedDate = document.getElementById("date").value;
  const branch = getSelectedBranch();

  title.textContent =
    new Date(calendarYear, calendarMonth, 1)
      .toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric"
      });

  grid.innerHTML = "";

  const firstDay =
    new Date(calendarYear, calendarMonth, 1).getDay();

  const daysInMonth =
    new Date(calendarYear, calendarMonth + 1, 0).getDate();

  for(let index = 0; index < firstDay; index++){
    const filler = document.createElement("div");
    filler.className = "calendar-cell empty";
    grid.appendChild(filler);
  }

  for(let day = 1; day <= daysInMonth; day++){
    const dateValue = [
      calendarYear,
      String(calendarMonth + 1).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");

    const cell = document.createElement("button");

    cell.type = "button";
    cell.className = "calendar-cell";
    cell.textContent = day;

    if(dateValue === selectedDate){
      cell.classList.add("selected");
    }

    if(
      branch &&
      localStorage.getItem(
        `${STORAGE_PREFIX}${branch}_${dateValue}`
      )
    ){
      cell.classList.add("has-data");
    }

    cell.addEventListener("click", function(){
      document.getElementById("date").value = dateValue;
      document.getElementById("date").dispatchEvent(new Event("change"));
    });

    grid.appendChild(cell);
  }
}

/* MODAL */

function loadModalOptions(){
  const therapistSelect =
    document.getElementById("modalTherapistInput");

  const currentValue =
    therapistSelect.value;

  therapistSelect.innerHTML =
    '<option value="">Select Therapist</option>' +
    getTherapists().map(function(name){
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    }).join("");

  if(currentValue){
    therapistSelect.value = currentValue;
  }

  renderModalVouchers();

  document.getElementById("modalClientOptions").innerHTML =
    cachedClients
      .slice()
      .sort(function(a, b){
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      })
      .map(function(client){
        return `<option value="${escapeHtml(client?.name || "")}"></option>`;
      })
      .join("");
}


function createModalPayment(payment = {}){
  return {
    id: payment.id || createId(),
    method: payment.method || "Cash",
    amount: Math.max(0, Number(payment.amount) || 0)
  };
}

function getModalNetAmount(){
  const gross = getModalGrossAmount();
  const voucher = getSelectedVoucherData();
  const deduction = Math.min(gross, Math.max(0, Number(voucher.value) || 0));
  return Math.max(0, gross - deduction);
}

function getModalPaymentTotal(){
  return modalPayments.reduce(function(sum, payment){
    return sum + Math.max(0, Number(payment.amount) || 0);
  }, 0);
}

function addModalPayment(payment){
  modalPayments.push(createModalPayment(payment));
  renderModalPayments();
}

function removeModalPayment(paymentId){
  modalPayments = modalPayments.filter(function(payment){
    return payment.id !== paymentId;
  });
  renderModalPayments();
}

function syncSinglePaymentToBalance(){
  const net = getModalNetAmount();

  if(net <= 0){
    modalPayments = [];
    return;
  }

  if(modalPayments.length === 0){
    modalPayments = [createModalPayment({method:"Cash", amount:net})];
  }else if(modalPayments.length === 1){
    modalPayments[0].amount = net;
  }
}

function renderModalPayments(){
  const container = document.getElementById("modalPaymentList");
  const addButton = document.getElementById("modalAddPaymentBtn");

  if(!container){
    return;
  }

  const net = getModalNetAmount();

  if(net <= 0){
    modalPayments = [];
    container.innerHTML = `
      <div class="voucher-only-payment-note">
        ${modalExecutiveVoucher ? "Fully covered by Executive Voucher" : "Fully covered by voucher"} — no cash payment required.
      </div>
    `;
    if(addButton){
      addButton.disabled = true;
    }
    updatePaymentBalanceDisplay();
    return;
  }

  if(addButton){
    addButton.disabled = false;
  }

  if(modalPayments.length === 0){
    modalPayments.push(createModalPayment({method:"Cash", amount:net}));
  }

  container.innerHTML = "";

  modalPayments.forEach(function(payment, index){
    const row = document.createElement("div");
    row.className = "multiple-payment-row";

    row.innerHTML = `
      <select class="form-select form-select-sm payment-method-select">
        <option value="Cash" ${payment.method === "Cash" ? "selected" : ""}>Cash</option>
        <option value="GCash" ${payment.method === "GCash" ? "selected" : ""}>GCash</option>
        <option value="Bank Transfer" ${payment.method === "Bank Transfer" ? "selected" : ""}>Bank Transfer</option>
        <option value="Terminal" ${payment.method === "Terminal" ? "selected" : ""}>Terminal</option>
      </select>

      <input
        type="number"
        class="form-control form-control-sm payment-amount-input"
        min="0"
        step="0.01"
        value="${Number(payment.amount || 0).toFixed(2)}"
        placeholder="Amount"
      >

      <button type="button" class="payment-remove-btn" title="Remove payment">
        ×
      </button>
    `;

    row.querySelector(".payment-method-select").addEventListener("change", function(){
      payment.method = this.value;
    });

    row.querySelector(".payment-amount-input").addEventListener("input", function(){
      payment.amount = Math.max(0, Number(this.value) || 0);
      updatePaymentBalanceDisplay();
    });

    row.querySelector(".payment-remove-btn").addEventListener("click", function(){
      removeModalPayment(payment.id);
    });

    container.appendChild(row);
  });

  updatePaymentBalanceDisplay();
}

function updatePaymentBalanceDisplay(){
  const container = document.getElementById("modalPaymentList");
  if(!container || getModalNetAmount() <= 0){
    return;
  }

  let summary = container.querySelector(".payment-balance-summary");
  if(!summary){
    summary = document.createElement("div");
    summary.className = "payment-balance-summary";
    container.appendChild(summary);
  }

  const net = getModalNetAmount();
  const paid = getModalPaymentTotal();
  const difference = Math.round((net - paid) * 100) / 100;

  if(Math.abs(difference) < 0.01){
    summary.className = "payment-balance-summary payment-balanced";
    summary.textContent = `Payment complete: ${peso(paid)}`;
  }else if(difference > 0){
    summary.className = "payment-balance-summary payment-pending";
    summary.textContent = `Remaining balance: ${peso(difference)}`;
  }else{
    summary.className = "payment-balance-summary payment-over";
    summary.textContent = `Overpayment: ${peso(Math.abs(difference))}`;
  }
}

function getSalePayments(sale){
  if(Array.isArray(sale.payments) && sale.payments.length){
    return sale.payments
      .filter(function(payment){
        return payment && payment.method && Number(payment.amount) > 0;
      })
      .map(function(payment){
        return {
          method: payment.method,
          amount: Math.max(0, Number(payment.amount) || 0)
        };
      });
  }

  const amount = Math.max(0, Number(sale.netAmount) || 0);

  if(amount <= 0){
    return [];
  }

  /*
    Legacy rows saved before the multi-payment feature existed can have
    payment === "Multiple" with no payments[] array to back it up (that
    sentinel only ever means something when a real payments[] array is
    also present). Treating it as a literal method name here would make
    the amount invisible to every downstream report bucketing by the real
    payment methods (Cash/GCash/Bank Transfer/Terminal), so it falls back
    to Cash instead — same default used elsewhere for a missing method.
  */
  return [{
    method: (sale.payment && sale.payment !== "Multiple") ? sale.payment : "Cash",
    amount: amount
  }];
}

function openNewSaleModal(){
  if(!getSelectedBranch()){
    alert("Please select a branch first.");
    return;
  }

  loadModalOptions();

  editingSaleId = null;
  modalItems = [];
  modalCompanions = [];
  modalVouchers = [];
  modalExecutiveVoucher = false;
  modalPayments = [];

  document.getElementById("saleModalEyebrow").textContent = "New Sale";
  document.getElementById("saleModalTitle").textContent = "Add Sale";

  document.getElementById("modalTimeInput").value = currentTimeValue();
  document.getElementById("modalClientInput").value = "";
  document.getElementById("modalSeniorPwdIdInput").value = "";
  document.getElementById("modalSourceInput").value = "Facebook";
  document.getElementById("modalTherapistInput").value = "";
  document.getElementById("modalRemarksInput").value = "";
  setModalInvoiceFields(false, "", "");
  renderModalVouchers();

  addModalItem("Service");
  syncSinglePaymentToBalance();
  renderModalPayments();
  refreshModalVipState();
  resetModalClientDetailsPanel();
  showSaleModal();
}

function openEditSaleModal(saleId){
  const sale =
    salesRows.find(function(item){
      return item.id === saleId;
    });

  if(!sale){
    return;
  }

  /* Settled sales stay locked to Admin/Executive Assistant (matches
     deleteSale's own gate) — but an ongoing/unsettled transaction hasn't
     been finalized yet, so Receptionist can still edit it, same as the
     Settle action already allows via canEditOngoingSales(). */
  const canEdit =
    sale.settled === false
      ? canEditOngoingSales()
      : canEditSavedSales();

  if(!canEdit){
    alert(
      sale.settled === false
        ? "Your account cannot edit this transaction."
        : "Your account cannot edit a saved transaction. Please ask an Admin or Executive Assistant to void it."
    );
    return;
  }

  loadModalOptions();

  editingSaleId = sale.id;

  const savedCompanions =
    Array.isArray(sale.companions)
      ? sale.companions
      : [];

  const companionNames =
    new Set(
      savedCompanions.map(function(companion){
        return companion.name;
      })
    );

  modalItems =
    (sale.services || [])
      .filter(function(item){
        return !item.participantType || item.participantType === "Principal";
      })
      .map(function(item){
        return {
          ...item,
          id: item.id || createId(),
          itemType:
            item.itemType ||
            (findProduct(item.name) ? "Product" : "Service")
        };
      });

  modalCompanions =
    savedCompanions.map(function(companion){
      return {
        id: companion.id || createId(),
        name: companion.name || "",
        therapist: companion.therapist || "",
        seniorPwdIdNumber: companion.seniorPwdIdNumber || "",
        items:
          Array.isArray(companion.items)
            ? companion.items.map(function(item){
                return {
                  ...item,
                  id: item.id || createId(),
                  itemType:
                    item.itemType ||
                    (findProduct(item.name) ? "Product" : "Service")
                };
              })
            : (sale.services || [])
                .filter(function(item){
                  return (
                    item.participantType === "Companion" &&
                    item.participantName === companion.name
                  );
                })
                .map(function(item){
                  return {
                    ...item,
                    id: item.id || createId(),
                    itemType:
                      item.itemType ||
                      (findProduct(item.name) ? "Product" : "Service")
                  };
                })
      };
    });

  if(
    modalCompanions.length === 0 &&
    (sale.services || []).some(function(item){
      return item.participantType === "Companion";
    })
  ){
    const grouped = {};

    (sale.services || [])
      .filter(function(item){
        return item.participantType === "Companion";
      })
      .forEach(function(item){
        const name = item.participantName || "Companion";

        if(!grouped[name]){
          grouped[name] = {
            id: createId(),
            name: name,
            therapist: item.therapist || "",
            seniorPwdIdNumber: "",
            items: []
          };
        }

        grouped[name].items.push({
          ...item,
          id: item.id || createId(),
          itemType:
            item.itemType ||
            (findProduct(item.name) ? "Product" : "Service")
        });
      });

    modalCompanions = Object.values(grouped);
  }

  if(modalItems.length === 0){
    modalItems.push({
      id: createId(),
      itemType: "Service",
      name: "",
      priceType: sale.vip ? "VIP" : "Regular",
      amount: 0,
      quantity: 1,
      unitPrice: 0
    });
  }

  document.getElementById("saleModalEyebrow").textContent = "Edit Sale";
  document.getElementById("saleModalTitle").textContent = "Update Sale";

  document.getElementById("modalTimeInput").value =
    sale.startTime || currentTimeValue();

  document.getElementById("modalClientInput").value =
    sale.client || "";

  document.getElementById("modalSeniorPwdIdInput").value =
    sale.seniorPwdIdNumber || "";

  document.getElementById("modalSourceInput").value =
    sale.source || "Facebook";

  document.getElementById("modalTherapistInput").value =
    sale.therapist === "N/A"
      ? ""
      : (sale.therapist || "");

  modalPayments =
    getSalePayments(sale).map(function(payment){
      return createModalPayment(payment);
    });

  modalExecutiveVoucher =
    sale.executiveVoucher === true ||
    (
      Array.isArray(sale.vouchers) &&
      sale.vouchers.some(function(voucher){
        return voucher?.isExecutive === true ||
          voucher?.name === "Executive Voucher";
      })
    ) ||
    sale.voucherName === "Executive Voucher";

  modalVouchers =
    Array.isArray(sale.vouchers) && sale.vouchers.length
      ? sale.vouchers
          .filter(function(voucher){
            return voucher?.isExecutive !== true &&
              voucher?.name !== "Executive Voucher";
          })
          .map(function(voucher){
            return createModalVoucher({
              ...voucher,
              /* Saved rows without a code predate the voucher-number
                 system — keep them editable without requiring one. */
              legacy: voucher?.legacy === true || !voucher?.code
            });
          })
      : (
          sale.voucherName &&
          sale.voucherName !== "Executive Voucher"
            ? [
                createModalVoucher({
                  itemType: sale.voucherType || "Service",
                  name: sale.voucherName || sale.voucherService,
                  value: sale.voucherValue || 0,
                  legacy: true
                })
              ]
            : []
        );

  renderModalVouchers();
  syncSinglePaymentToBalance();
  renderModalPayments();

  document.getElementById("modalRemarksInput").value =
    sale.remarks || "";

  setModalInvoiceFields(
    sale.issueInvoice === true,
    sale.invoiceNumber || "",
    sale.tinNumber || ""
  );

  refreshModalVipState();
  renderModalItems();
  renderModalCompanions();
  prefillModalClientDetailsPanel(sale.client);
  showSaleModal();
}

function showSaleModal(){
  hideModalMessage();

  document.getElementById("saleModalBackdrop")
    .classList.remove("d-none");

  document.body.classList.add("modal-open");

  setTimeout(function(){
    document.getElementById("modalClientInput").focus();
  }, 50);
}

function closeSaleModal(){
  document.getElementById("saleModalBackdrop")
    .classList.add("d-none");

  document.body.classList.remove("modal-open");

  editingSaleId = null;
  modalItems = [];
  modalCompanions = [];
  hideModalMessage();
}


function findVipCardProduct(){
  return getProducts().find(function(product){
    return isVipCardName(product?.name);
  }) || null;
}

function modalHasVipCard(){
  return modalItems.some(function(item){
    return item.itemType === "Product" && isVipCardName(item.name);
  });
}

function applyVipPricingToAllServices(){
  modalItems
    .concat(
      modalCompanions.flatMap(function(companion){
        return companion.items || [];
      })
    )
    .filter(function(item){
      return item.itemType === "Service" && Boolean(item.name);
    })
    .forEach(function(item){
      item.priceType = "VIP";
      item.manualAmount = false;
      recalculateServiceItem(item, true);
    });
}

function revertVipPricingWhenCardRemoved(){
  const clientName =
    document.getElementById("modalClientInput").value.trim();

  if(isExistingVipClient(clientName)){
    applyVipPricingToAllServices();
    return;
  }

  modalItems
    .concat(
      modalCompanions.flatMap(function(companion){
        return companion.items || [];
      })
    )
    .filter(function(item){
      return item.itemType === "Service";
    })
    .forEach(function(item){
      item.priceType = "Regular";
      item.manualAmount = false;
      recalculateServiceItem(item, true);
    });
}

function addVipCardToModal(){
  hideModalMessage();

  if(modalHasVipCard()){
    showModalMessage("A VIP Card is already added to this transaction.");
    return;
  }

  const product = findVipCardProduct();
  const price =
    Number(
      product?.sellingPrice ??
      product?.price ??
      product?.regularPrice ??
      500
    ) || 500;

  modalItems.push({
    id: createId(),
    itemType: "Product",
    name: product?.name || "VIP Card",
    priceType: "Regular",
    quantity: 1,
    unitPrice: price,
    amount: price,
    manualAmount: false,
    manualUnitPrice: false,
    productKind: product?.productKind || "VIP Card",
    sourceServiceName: ""
  });

  applyVipPricingToAllServices();
  refreshModalVipState();
  renderModalItems();
  renderModalCompanions();
}

/* End time (HH:MM) of a Service item, using its own serviceStartTime
   plus the selected service's Duration from the Service Master. Falls
   back to the item's own start time when no duration is known yet
   (e.g. no service selected). */
function getModalItemEndTime(item){
  if(!item?.serviceStartTime){
    return "";
  }

  const duration =
    Number(findService(item.name)?.duration) || 0;

  if(duration <= 0){
    return item.serviceStartTime;
  }

  const parts =
    item.serviceStartTime.split(":").map(Number);

  if(Number.isNaN(parts[0]) || Number.isNaN(parts[1])){
    return item.serviceStartTime;
  }

  const totalMinutes =
    (parts[0] * 60 + parts[1] + duration + 1440) % 1440;

  return (
    String(Math.floor(totalMinutes / 60)).padStart(2, "0") +
    ":" +
    String(totalMinutes % 60).padStart(2, "0")
  );
}

/* "Duration: 5:30 PM - 7:00 PM" subtext shown under a Service item's
   name — the Start Time itself isn't hand-edited in normal use (it
   auto-chains from the previous service, or from the transaction's
   Time field for the first one), so it's shown read-only here instead
   of as its own input. */
function getModalItemDurationLabel(item){
  if(!item?.name || !item?.serviceStartTime){
    return "";
  }

  return (
    "Duration: " +
    formatTimeValue(item.serviceStartTime) +
    " - " +
    formatTimeValue(getModalItemEndTime(item))
  );
}

/* New services default to starting right when the previous one (the
   last Service item with a name picked) ends, so a multi-service
   transaction reads as back-to-back by default — the overall Time
   field is only used for the very first service in the transaction. */
function getDefaultServiceStartTime(){
  const lastService =
    modalItems
      .slice()
      .reverse()
      .find(function(item){
        return (
          item.itemType === "Service" &&
          Boolean(item.name) &&
          Boolean(item.serviceStartTime)
        );
      });

  if(lastService){
    return getModalItemEndTime(lastService);
  }

  return document.getElementById("modalTimeInput").value || "";
}

function addModalItem(itemType){
  modalItems.push({
    id: createId(),
    itemType: itemType,
    name: "",
    priceType:
      isModalVip()
        ? "VIP"
        : "Regular",
    quantity: 1,
    unitPrice: 0,
    amount: 0,
    manualAmount: false,
    manualUnitPrice: false,
    productKind: "",
    sourceServiceName: "",
    isFreebie: false,
    freebieValue: 0,
    isConsumable: false,
    serviceStartTime:
      itemType === "Service"
        ? getDefaultServiceStartTime()
        : "",
    manualStartTime: false
  });

  renderModalItems();
}

/* A Consumable is a normal Product item (itemType stays "Product" so it
   still reaches getItemsForProduct() via syncSaleToStockAudit and is
   deducted from the branch's stock / logged to the Stock Audit exactly
   like a sold product) flagged with isConsumable so it's excluded from
   the client-payable gross/net total — its unit price always stays 0.
   Only products marked "Available for Consumables" in the Product
   Master (list-products.html) show up in its picker. */
function addModalConsumableItem(){
  modalItems.push({
    id: createId(),
    itemType: "Product",
    name: "",
    priceType:
      isModalVip()
        ? "VIP"
        : "Regular",
    quantity: 1,
    unitPrice: 0,
    amount: 0,
    manualAmount: false,
    manualUnitPrice: false,
    productKind: "",
    sourceServiceName: "",
    isFreebie: false,
    freebieValue: 0,
    isConsumable: true,
    serviceStartTime: "",
    manualStartTime: false
  });

  renderModalItems();
}

/* A Freebie is a normal Service item (itemType stays "Service" so it keeps
   earning commission and flows through every existing report/stat that
   reads sale.services[] unchanged) flagged with isFreebie so it's excluded
   from the client-payable gross/net total. Its priced value is kept in
   freebieValue (not amount) purely as the commission basis. */
function addModalFreebieItem(){
  modalItems.push({
    id: createId(),
    itemType: "Service",
    name: "",
    priceType:
      isModalVip()
        ? "VIP"
        : "Regular",
    quantity: 1,
    unitPrice: 0,
    amount: 0,
    manualAmount: false,
    manualUnitPrice: false,
    productKind: "",
    sourceServiceName: "",
    isFreebie: true,
    freebieValue: 0,
    serviceStartTime: getDefaultServiceStartTime(),
    manualStartTime: false
  });

  renderModalItems();
}

/* Keeps each service's Start Time following the transaction's overall
   Time field by default — a service added right when the modal opens
   would otherwise be stuck with whatever time the modal happened to
   open at, even after the receptionist corrects the Time field to the
   client's actual arrival time (e.g. entering a sale after the fact).
   Stops touching a given item once its Start Time has been edited by
   hand (manualStartTime), same pattern as manualAmount. */
function syncModalItemStartTimes(newTime){
  let nextStartTime = newTime;

  modalItems.forEach(function(item){
    if(item.itemType !== "Service"){
      return;
    }

    if(!item.manualStartTime){
      item.serviceStartTime = nextStartTime;
    }

    /* Chain off wherever this item actually ends up starting (synced
       just now, or its own preserved value) so later services keep
       following it back-to-back instead of collapsing to newTime. */
    nextStartTime = getModalItemEndTime(item);
  });

  renderModalItems();
}

function renderModalItems(){
  const vipButton =
    document.getElementById("modalAddVipCardBtn");

  if(vipButton){
    const alreadyAdded = modalHasVipCard();
    vipButton.disabled = alreadyAdded;
    vipButton.textContent =
      alreadyAdded
        ? "VIP Card Added"
        : "Add VIP Card";
  }

  const seniorPwdIdWrapper =
    document.getElementById("modalSeniorPwdIdWrapper");

  if(seniorPwdIdWrapper){
    const principalNeedsSeniorPwdId =
      modalItems.some(function(item){
        return item.priceType === "Senior/PWD" && Boolean(item.name);
      });

    seniorPwdIdWrapper.classList.toggle("d-none", !principalNeedsSeniorPwdId);

    if(!principalNeedsSeniorPwdId){
      document.getElementById("modalSeniorPwdIdInput").value = "";
    }
  }

  const container =
    document.getElementById("modalItemsList");

  container.innerHTML = "";

  modalItems.forEach(function(item){
    const row =
      document.createElement("div");

    row.className =
      item.itemType === "Product"
        ? "modal-item-row modal-product-row"
        : "modal-item-row";

    if(item.isFreebie){
      row.className += " modal-freebie-row";
    }

    if(item.isConsumable){
      row.className += " modal-consumable-row";
    }

    if(item.itemType === "Service"){
      const durationLabel =
        getModalItemDurationLabel(item);

      row.innerHTML = `
        <div class="item-name-wrap">
          <select class="form-select form-select-sm item-name">
            <option value="">${item.isFreebie ? "Select Freebie" : "Select Service"}</option>
            ${getServices()
              .filter(function(service){
                return (
                  !item.isFreebie ||
                  service.availableForFreebies === true ||
                  service.name === item.name
                );
              })
              .map(function(service){
              return `
                <option value="${escapeHtml(service.name)}"
                  ${service.name === item.name ? "selected" : ""}>
                  ${escapeHtml(service.name)}
                </option>
              `;
            }).join("")}
          </select>

          ${durationLabel ? `<small class="item-duration-label">${escapeHtml(durationLabel)}</small>` : ""}
        </div>

        <select class="form-select form-select-sm item-price-type">
          <option value="Regular" ${item.priceType === "Regular" ? "selected" : ""}>
            Regular
          </option>
          <option value="First Timer" ${item.priceType === "First Timer" ? "selected" : ""}>
            First Timer
          </option>
          <option value="VIP" ${item.priceType === "VIP" ? "selected" : ""}>
            VIP
          </option>
          <option value="Senior/PWD" ${item.priceType === "Senior/PWD" ? "selected" : ""}>
            Senior/PWD
          </option>
        </select>

        <input
          type="number"
          class="form-control form-control-sm item-amount"
          min="0"
          step="0.01"
          value="${
            item.isFreebie
              ? Number(item.freebieValue || 0).toFixed(2)
              : Number(item.amount || 0).toFixed(2)
          }"
          placeholder="Amount"
          ${item.isFreebie ? "readonly title=\"Not charged to client — used only to compute therapist commission\"" : ""}
        >

        <button type="button" class="modal-remove-item">×</button>
      `;
    }else if(item.isConsumable){
      row.innerHTML = `
        <select class="form-select form-select-sm item-name">
          <option value="">Select Consumable</option>
          ${(CrownInventory?.getConsumableProductNames?.() || [])
            .concat(
              item.name && !(CrownInventory?.getConsumableProductNames?.() || []).includes(item.name)
                ? [item.name]
                : []
            )
            .map(function(name){
            return `
              <option value="${escapeHtml(name)}"
                ${name === item.name ? "selected" : ""}>
                ${escapeHtml(name)}
              </option>
            `;
          }).join("")}
        </select>

        <input
          type="number"
          class="form-control form-control-sm item-quantity"
          min="1"
          step="1"
          value="${Number(item.quantity) || 1}"
          title="Quantity"
        >

        <input
          type="text"
          class="form-control form-control-sm"
          value="—"
          readonly
          disabled
        >

        <input
          type="text"
          class="form-control form-control-sm item-amount"
          value="Not charged"
          readonly
          title="Consumables are not charged to the client, but are still deducted from branch stock and logged to the Stock Audit."
        >

        <button type="button" class="modal-remove-item">×</button>
      `;
    }else{
      row.innerHTML = `
        <select class="form-select form-select-sm item-name">
          <option value="">Select Product</option>
          ${getProducts()
            .filter(function(product){
              /* Voucher purchases now go through the dedicated
                 "Add Purchase Voucher" button — keep them out of this
                 list, but still show one if an existing sale
                 already references it (so editing old sales works). */
              return (
                !isServiceVoucherProduct(product) ||
                product.name === item.name
              );
            })
            .map(function(product){
            const suffix =
              isServiceVoucherProduct(product)
                ? ` — ${peso(product.sellingPrice)}`
                : "";

            return `
              <option value="${escapeHtml(product.name)}"
                ${product.name === item.name ? "selected" : ""}>
                ${escapeHtml(product.name)}${escapeHtml(suffix)}
              </option>
            `;
          }).join("")}
        </select>

        <input
          type="number"
          class="form-control form-control-sm item-quantity"
          min="1"
          step="1"
          value="${Number(item.quantity) || 1}"
          title="Quantity"
        >

        <input
          type="number"
          class="form-control form-control-sm item-unit-price"
          min="0"
          step="0.01"
          value="${Number(item.unitPrice || 0).toFixed(2)}"
          placeholder="Unit Price"
        >

        <input
          type="number"
          class="form-control form-control-sm item-amount"
          value="${Number(item.amount || 0).toFixed(2)}"
          readonly
        >

        <button type="button" class="modal-remove-item">×</button>
      `;
    }

    attachModalItemEvents(row, item);
    container.appendChild(row);
  });

  updateModalTotal();
  updateTherapistRequirement();
}

function attachModalItemEvents(row, item){
  row.querySelector(".item-name").addEventListener("change", function(){
    item.name = this.value;

    if(!item.name){
      item.amount = 0;
      item.freebieValue = 0;
      item.unitPrice = 0;
      item.quantity = 1;
      item.manualAmount = false;
      item.manualUnitPrice = false;
      item.productKind = "";
      item.sourceServiceName = "";
      refreshModalVipState();
      renderModalItems();
      renderModalCompanions();
      return;
    }

    if(item.itemType === "Service"){
      item.manualAmount = false;
      recalculateServiceItem(item);
    }else{
      item.manualUnitPrice = false;

      const selectedProduct =
        findProduct(item.name);

      item.productKind =
        selectedProduct?.productKind || "Product";

      item.sourceServiceName =
        selectedProduct?.sourceServiceName || "";

      recalculateProductItem(item);
    }

    if(item.isConsumable){
      item.unitPrice = 0;
      item.amount = 0;
    }

    refreshModalVipState();
    renderModalItems();
  });

  if(item.itemType === "Service"){
    row.querySelector(".item-price-type").addEventListener("change", function(){
      item.priceType = this.value;
      item.manualAmount = false;
      recalculateServiceItem(item);

      refreshModalVipState();
      renderModalItems();
      renderModalCompanions();
    });

    if(item.isFreebie){
      /* Freebie amount always follows the service's own tier price
         (via recalculateServiceItem) — no manual override, so the
         commission basis can't drift from what the service is really
         worth. */
    }else{
      row.querySelector(".item-amount").addEventListener("input", function(){
        item.amount = Number(this.value) || 0;
        item.manualAmount = true;
        updateModalTotal();
      });
    }
  }else{
    row.querySelector(".item-quantity").addEventListener("input", function(){
      item.quantity = Math.max(1, Number(this.value) || 1);
      recalculateProductItem(item);

      if(item.isConsumable){
        item.unitPrice = 0;
        item.amount = 0;
      }

      renderModalItems();
    });

    /* Consumables have no unit-price input — they're never charged to
       the client, so there's nothing to wire here. */
    if(!item.isConsumable){
      row.querySelector(".item-unit-price").addEventListener("input", function(){
        item.unitPrice = Number(this.value) || 0;
        item.manualUnitPrice = true;
        item.amount = item.quantity * item.unitPrice;
        updateModalTotal();

        const amountInput = row.querySelector(".item-amount");
        amountInput.value = Number(item.amount || 0).toFixed(2);
      });
    }
  }

  row.querySelector(".modal-remove-item").addEventListener("click", function(){
    const removedVipCard =
      item.itemType === "Product" &&
      isVipCardName(item.name);

    modalItems =
      modalItems.filter(function(existing){
        return existing.id !== item.id;
      });

    if(modalItems.length === 0){
      modalItems.push({
        id: createId(),
        itemType: "Service",
        name: "",
        priceType: isModalVip() ? "VIP" : "Regular",
        quantity: 1,
        unitPrice: 0,
        amount: 0
      });
    }

    if(removedVipCard){
      revertVipPricingWhenCardRemoved();
    }

    refreshModalVipState();
    renderModalItems();
    renderModalCompanions();
  });
}


function createEmptyItem(itemType){
  return {
    id: createId(),
    itemType: itemType,
    name: "",
    priceType: isModalVip() ? "VIP" : "Regular",
    quantity: 1,
    unitPrice: 0,
    amount: 0,
    manualAmount: false,
    manualUnitPrice: false,
    productKind: "",
    sourceServiceName: ""
  };
}

function addModalCompanion(){
  modalCompanions.push({
    id: createId(),
    name: "",
    therapist: "",
    seniorPwdIdNumber: "",
    vip: isModalVip(),
    items: [createEmptyItem("Service")]
  });

  renderModalCompanions();


  requestAnimationFrame(function(){
    const cards =
      document.querySelectorAll("#modalCompanionsList .companion-card");

    const newestCard =
      cards[cards.length - 1];

    if(newestCard){
      newestCard.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      const nameInput =
        newestCard.querySelector(".companion-name-input");

      if(nameInput){
        nameInput.focus({
          preventScroll: true
        });
      }
    }
  });
}

function getCompanionById(companionId){
  return modalCompanions.find(function(companion){
    return companion.id === companionId;
  }) || null;
}

function addCompanionItem(companionId, itemType){
  const companion = getCompanionById(companionId);

  if(!companion){
    return;
  }

  companion.items.push(createEmptyItem(itemType));
  renderModalCompanions();
}

function removeModalCompanion(companionId){
  modalCompanions =
    modalCompanions.filter(function(companion){
      return companion.id !== companionId;
    });

  renderModalCompanions();
}

function renderModalCompanions(){
  const container =
    document.getElementById("modalCompanionsList");

  if(!container){
    return;
  }

  container.innerHTML = "";

  if(modalCompanions.length === 0){
    container.innerHTML = `
      <div class="companions-empty">
        No companion added.
      </div>
    `;

    updateModalTotal();
    updateTherapistRequirement();
    return;
  }

  modalCompanions.forEach(function(companion, companionIndex){
    const card = document.createElement("div");
    card.className = "companion-card";

    const companionNeedsSeniorPwdId =
      (companion.items || []).some(function(item){
        return item.priceType === "Senior/PWD" && Boolean(item.name);
      });

    if(!companionNeedsSeniorPwdId){
      companion.seniorPwdIdNumber = "";
    }

    card.innerHTML = `
      <div class="companion-card-header">
        <div>
          <span class="companion-number">
            Companion ${companionIndex + 1}
          </span>

          ${
            isModalVip()
              ? '<span class="companion-vip-badge">VIP PRIVILEGE</span>'
              : ""
          }
        </div>

        <button
          type="button"
          class="companion-remove-btn"
          aria-label="Remove companion"
        >
          Remove
        </button>
      </div>

      <div class="row g-3">
        <div class="col-md-7">
          <label class="form-label">
            Companion Name *
          </label>

          <input
            type="text"
            class="form-control companion-name-input"
            list="modalClientOptions"
            value="${escapeHtml(companion.name || "")}"
            placeholder="Type or select companion"
            autocomplete="off"
          >
        </div>

        <div class="col-md-5">
          <label class="form-label">
            Therapist
          </label>

          <select class="form-select companion-therapist-input">
            <option value="">Select Therapist</option>

            ${getTherapists().map(function(name){
              return `
                <option
                  value="${escapeHtml(name)}"
                  ${name === companion.therapist ? "selected" : ""}
                >
                  ${escapeHtml(name)}
                </option>
              `;
            }).join("")}
          </select>

          <small class="text-muted">
            Required when the companion has a service.
          </small>
        </div>

        ${
          companionNeedsSeniorPwdId
            ? `
                <div class="col-md-6">
                  <label class="form-label">
                    Senior Citizen / PWD ID Number *
                  </label>

                  <input
                    type="text"
                    class="form-control companion-senior-pwd-id-input"
                    value="${escapeHtml(companion.seniorPwdIdNumber || "")}"
                    placeholder="ID Number"
                    autocomplete="off"
                  >
                </div>
              `
            : ""
        }
      </div>

      <div class="companion-actions">
        <button
          type="button"
          class="btn btn-sm btn-success companion-add-service"
        >
          Add Service
        </button>

        <button
          type="button"
          class="btn btn-sm btn-primary companion-add-product"
        >
          Add Product
        </button>
      </div>

      <div class="companion-items-list"></div>

      <div class="companion-subtotal">
        <span>${escapeHtml(companion.name || `Companion ${companionIndex + 1}`)} Subtotal</span>
        <strong>${peso(getItemsTotal(companion.items))}</strong>
      </div>
    `;

    card.querySelector(".companion-name-input")
      .addEventListener("input", function(){
        companion.name = this.value;
        updateModalTotal();
      });

    card.querySelector(".companion-therapist-input")
      .addEventListener("change", function(){
        companion.therapist = this.value;
      });

    const companionSeniorPwdIdInput =
      card.querySelector(".companion-senior-pwd-id-input");

    if(companionSeniorPwdIdInput){
      companionSeniorPwdIdInput.addEventListener("input", function(){
        companion.seniorPwdIdNumber = this.value;
      });
    }

    card.querySelector(".companion-add-service")
      .addEventListener("click", function(){
        addCompanionItem(companion.id, "Service");
      });

    card.querySelector(".companion-add-product")
      .addEventListener("click", function(){
        addCompanionItem(companion.id, "Product");
      });

    card.querySelector(".companion-remove-btn")
      .addEventListener("click", function(){
        removeModalCompanion(companion.id);
      });

    const itemsContainer =
      card.querySelector(".companion-items-list");

    companion.items.forEach(function(item){
      const row = document.createElement("div");

      row.className =
        item.itemType === "Product"
          ? "modal-item-row modal-product-row companion-item-row"
          : "modal-item-row companion-item-row";

      if(item.itemType === "Service"){
        row.innerHTML = `
          <select class="form-select form-select-sm item-name">
            <option value="">Select Service</option>

            ${getServices().map(function(service){
              return `
                <option
                  value="${escapeHtml(service.name)}"
                  ${service.name === item.name ? "selected" : ""}
                >
                  ${escapeHtml(service.name)}
                </option>
              `;
            }).join("")}
          </select>

          <select
            class="form-select form-select-sm item-price-type"
            ${isModalVip() ? "disabled" : ""}
            title="${isModalVip() ? "VIP Privilege inherited from principal" : "Select price type"}"
          >
            <option value="Regular" ${item.priceType === "Regular" ? "selected" : ""}>
              Regular
            </option>

            <option value="First Timer" ${item.priceType === "First Timer" ? "selected" : ""}>
              First Timer
            </option>

            <option value="VIP" ${item.priceType === "VIP" ? "selected" : ""}>
              VIP
            </option>

            <option value="Senior/PWD" ${item.priceType === "Senior/PWD" ? "selected" : ""}>
              Senior/PWD
            </option>
          </select>

          <input
            type="number"
            class="form-control form-control-sm item-amount"
            min="0"
            step="0.01"
            value="${Number(item.amount || 0).toFixed(2)}"
            placeholder="Amount"
          >

          <button type="button" class="modal-remove-item">×</button>
        `;
      }else{
        row.innerHTML = `
          <select class="form-select form-select-sm item-name">
            <option value="">Select Product</option>

            ${getProducts().map(function(product){
              const suffix =
                isServiceVoucherProduct(product)
                  ? ` — ${peso(product.sellingPrice)}`
                  : "";

              return `
                <option
                  value="${escapeHtml(product.name)}"
                  ${product.name === item.name ? "selected" : ""}
                >
                  ${escapeHtml(product.name)}${escapeHtml(suffix)}
                </option>
              `;
            }).join("")}
          </select>

          <input
            type="number"
            class="form-control form-control-sm item-quantity"
            min="1"
            step="1"
            value="${Number(item.quantity) || 1}"
            title="Quantity"
          >

          <input
            type="number"
            class="form-control form-control-sm item-unit-price"
            min="0"
            step="0.01"
            value="${Number(item.unitPrice || 0).toFixed(2)}"
            placeholder="Unit Price"
          >

          <input
            type="number"
            class="form-control form-control-sm item-amount"
            value="${Number(item.amount || 0).toFixed(2)}"
            readonly
          >

          <button type="button" class="modal-remove-item">×</button>
        `;
      }

      attachCompanionItemEvents(row, companion, item);
      itemsContainer.appendChild(row);
    });

    container.appendChild(card);
  });

  updateModalTotal();
  updateTherapistRequirement();
}

function attachCompanionItemEvents(row, companion, item){
  row.querySelector(".item-name").addEventListener("change", function(){
    item.name = this.value;

    if(item.itemType === "Service"){
      item.manualAmount = false;
      recalculateServiceItem(item);
    }else{
      item.manualUnitPrice = false;

      const selectedProduct = findProduct(item.name);

      item.productKind =
        selectedProduct?.productKind || "Product";

      item.sourceServiceName =
        selectedProduct?.sourceServiceName || "";

      recalculateProductItem(item);
    }

    refreshModalVipState();
    renderModalCompanions();
  });

  if(item.itemType === "Service"){
    row.querySelector(".item-price-type").addEventListener("change", function(){
      item.priceType =
        isModalVip()
          ? "VIP"
          : this.value;

      item.manualAmount = false;
      recalculateServiceItem(item);
      renderModalCompanions();
    });

    row.querySelector(".item-amount").addEventListener("input", function(){
      item.amount = Number(this.value) || 0;
      item.manualAmount = true;
      updateModalTotal();
    });
  }else{
    row.querySelector(".item-quantity").addEventListener("input", function(){
      item.quantity = Math.max(1, Number(this.value) || 1);
      recalculateProductItem(item);
      renderModalCompanions();
    });

    row.querySelector(".item-unit-price").addEventListener("input", function(){
      item.unitPrice = Number(this.value) || 0;
      item.manualUnitPrice = true;
      item.amount = item.quantity * item.unitPrice;

      row.querySelector(".item-amount").value =
        Number(item.amount || 0).toFixed(2);

      updateModalTotal();
    });
  }

  row.querySelector(".modal-remove-item").addEventListener("click", function(){
    companion.items =
      companion.items.filter(function(existing){
        return existing.id !== item.id;
      });

    if(companion.items.length === 0){
      companion.items.push(createEmptyItem("Service"));
    }

    renderModalCompanions();
  });
}

function getItemsTotal(items){
  return (items || []).reduce(function(sum, item){
    return sum + Number(item.amount || 0);
  }, 0);
}

function getAllModalItems(){
  const principalItems =
    modalItems.map(function(item){
      return {
        ...item,
        participantType: "Principal",
        participantName:
          document.getElementById("modalClientInput").value.trim(),
        therapist:
          document.getElementById("modalTherapistInput").value
      };
    });

  const companionItems =
    modalCompanions.flatMap(function(companion){
      return companion.items.map(function(item){
        return {
          ...item,
          participantType: "Companion",
          participantName: companion.name.trim(),
          therapist: companion.therapist
        };
      });
    });

  return principalItems.concat(companionItems);
}

/* ---------- Add to Schedule ----------
   Books the modal's current client + companions directly onto the
   Scheduling grid (crownSchedule_<branch>_<date>), auto-assigning a free
   bed and, if the desired time is fully booked, auto-shifting forward to
   the next open slot. Adapted from scheduling.js's own conflict/bed-pick
   logic (hasOverlap/poolHasConflict/findAlternateBed/findNextAvailableStart,
   ensureClientExists) since that page's script doesn't share globals with
   this one. */

const SCHEDULE_DEFAULT_DURATION_MINUTES = 60;

function minutesToTimeValueLocal(totalMinutes){
  return (
    String(Math.floor(totalMinutes / 60)).padStart(2, "0") +
    ":" +
    String(totalMinutes % 60).padStart(2, "0")
  );
}

function hasOverlapLocal(startA, endA, startB, endB){
  return (
    dailyTimeToMinutes(startA) < dailyTimeToMinutes(endB) &&
    dailyTimeToMinutes(endA) > dailyTimeToMinutes(startB)
  );
}

/* Same rule scheduling.js's poolHasTherapistConflict enforces when
   manually booking — a therapist can only be in one bed at a time, so
   this needs to reject a double-booking here too, not just auto-shift
   like a bed conflict would. */
function poolHasTherapistConflictLocal(therapistName, startTime, endTime, pool){
  if(!therapistName || therapistName === "N/A"){
    return false;
  }

  return pool.some(function(item){
    return (
      item.therapist === therapistName &&
      hasOverlapLocal(startTime, endTime, item.startTime, item.endTime)
    );
  });
}

function getParticipantScheduleDuration(items){
  const total =
    (items || [])
      .filter(function(item){
        return item.itemType === "Service" && item.name;
      })
      .reduce(function(sum, item){
        return sum + (Number(findService(item.name)?.duration) || 0);
      }, 0);

  return total > 0 ? total : SCHEDULE_DEFAULT_DURATION_MINUTES;
}

function findAvailableBedAt(branchRecord, startTime, endTime, pool){
  for(let bed = 1; bed <= (Number(branchRecord.beds) || 0); bed++){
    const conflict =
      pool.some(function(item){
        return (
          Number(item.bed) === bed &&
          hasOverlapLocal(startTime, endTime, item.startTime, item.endTime)
        );
      });

    if(!conflict){
      return bed;
    }
  }

  return null;
}

/* Same idea as findAvailableBedAt, but steps forward in 10-min increments
   (within the branch's operating hours) until some bed is free for the
   full duration — used when the exact requested time is fully booked. */
function findNextAvailableSlot(branchRecord, durationMinutes, pool, searchFromMinutes){
  const opening = dailyTimeToMinutes(branchRecord.openingTime);
  const closing = dailyTimeToMinutes(branchRecord.closingTime);

  let start =
    Math.max(opening, Math.ceil(searchFromMinutes / 10) * 10);

  while(start + durationMinutes <= closing){
    const startTime = minutesToTimeValueLocal(start);
    const endTime = minutesToTimeValueLocal(start + durationMinutes);
    const bed = findAvailableBedAt(branchRecord, startTime, endTime, pool);

    if(bed){
      return { bed: bed, startTime: startTime, endTime: endTime };
    }

    start += 10;
  }

  return null;
}

async function ensureClientExistsForSchedule(clientName, branchName){
  const target = normalizeClientName(clientName).toLowerCase();

  if(!target){
    return;
  }

  const clients = await getClients();

  const exists =
    clients.some(function(client){
      return normalizeClientName(client.name).toLowerCase() === target;
    });

  if(exists){
    return;
  }

  clients.push({
    id: createId(),
    name: normalizeClientName(clientName),
    mobile: "",
    birthday: "",
    branch: branchName,
    vip: "No",
    notes: "",
    totalVisits: 0,
    lastVisit: "",
    totalSpent: 0,
    createdAt: new Date().toISOString()
  });

  await window.CrownClientStore.saveAll(clients);
}

function saveDailySchedule(branchName, dateValue, entries){
  try{
    localStorage.setItem(
      `${SCHEDULE_PREFIX}${branchName}_${dateValue}`,
      JSON.stringify(entries)
    );
  }catch(error){
    console.error("Unable to save schedule:", error);
    alert("Unable to save the schedule.");
  }
}

async function addModalSaleToSchedule(){
  hideModalMessage();

  const branchName = getSelectedBranch();
  const dateValue = document.getElementById("date").value;

  if(!branchName || !dateValue){
    showModalMessage("Please select a branch and date first.");
    return;
  }

  const branchRecord =
    getBranchListForModal().find(function(branch){
      return branch.name === branchName;
    });

  if(!branchRecord || !branchRecord.beds){
    showModalMessage("The selected branch has no bed/schedule configuration.");
    return;
  }

  const rawRequestedStartTime =
    document.getElementById("modalTimeInput").value;

  if(!rawRequestedStartTime){
    showModalMessage("Please select the client time.");
    return;
  }

  /* The Dashboard and Scheduling grids both position appointment cards
     by their exact minute (not snapped to a fixed slot grid), so the
     client's real service time is used as-is here — no rounding. */
  const requestedStartTime =
    rawRequestedStartTime;

  const clientName =
    document.getElementById("modalClientInput").value.trim();

  if(!clientName){
    showModalMessage("Please enter or select a client.");
    return;
  }

  const principalItems =
    modalItems.filter(function(item){
      return Boolean(String(item?.name || "").trim());
    });

  if(principalItems.length === 0){
    showModalMessage("Please add at least one service or product.");
    return;
  }

  const invalidCompanion =
    modalCompanions.find(function(companion){
      return !companion.name.trim();
    });

  if(invalidCompanion){
    showModalMessage("Please enter the name of every companion.");
    return;
  }

  const companionWithoutItems =
    modalCompanions.find(function(companion){
      return !companion.items.some(function(item){
        return item.name;
      });
    });

  if(companionWithoutItems){
    showModalMessage("Please add at least one service or product for every companion.");
    return;
  }

  const existingSchedule =
    getDailyScheduleData(branchName, dateValue);

  const pool =
    existingSchedule.filter(function(item){
      return item.status !== "Cancelled";
    });

  const bookedSummary = [];
  let anyTimeShifted = false;

  const principalDuration =
    getParticipantScheduleDuration(principalItems);

  const principalEndAtRequested =
    minutesToTimeValueLocal(
      dailyTimeToMinutes(requestedStartTime) + principalDuration
    );

  let principalBed =
    findAvailableBedAt(branchRecord, requestedStartTime, principalEndAtRequested, pool);

  let principalStartTime = requestedStartTime;
  let principalEndTime = principalEndAtRequested;

  if(!principalBed){
    const slot =
      findNextAvailableSlot(
        branchRecord,
        principalDuration,
        pool,
        dailyTimeToMinutes(requestedStartTime)
      );

    if(!slot){
      showModalMessage(
        `No available bed for ${clientName} — the branch is fully booked for the rest of the day.`
      );
      return;
    }

    principalBed = slot.bed;
    principalStartTime = slot.startTime;
    principalEndTime = slot.endTime;
    anyTimeShifted = true;
  }

  const principalTherapist =
    document.getElementById("modalTherapistInput").value || "N/A";

  if(
    poolHasTherapistConflictLocal(
      principalTherapist,
      principalStartTime,
      principalEndTime,
      pool
    )
  ){
    showModalMessage(
      `${principalTherapist} is already assigned to another appointment during this time.`
    );
    return;
  }

  pool.push({
    bed: principalBed,
    startTime: principalStartTime,
    endTime: principalEndTime,
    therapist: principalTherapist
  });

  const mainId = createId();

  const principalServiceNames =
    principalItems
      .filter(function(item){ return item.itemType === "Service"; })
      .map(function(item){ return item.name; });

  const newEntries = [{
    id: mainId,
    client: clientName,
    services: principalServiceNames,
    service: principalServiceNames.join(", "),
    therapist: principalTherapist,
    bed: principalBed,
    startTime: principalStartTime,
    endTime: principalEndTime,
    duration: principalDuration,
    status: "Confirmed",
    notes: "",
    updatedAt: new Date().toISOString()
  }];

  bookedSummary.push(
    `${clientName}: Bed ${principalBed} at ${formatTimeValue(principalStartTime)}`
  );

  for(const companion of modalCompanions){
    const companionItems =
      companion.items.filter(function(item){
        return Boolean(item.name);
      });

    const companionDuration =
      getParticipantScheduleDuration(companionItems);

    const companionEndAtPrincipalTime =
      minutesToTimeValueLocal(
        dailyTimeToMinutes(principalStartTime) + companionDuration
      );

    let companionBed =
      findAvailableBedAt(branchRecord, principalStartTime, companionEndAtPrincipalTime, pool);

    let companionStartTime = principalStartTime;
    let companionEndTime = companionEndAtPrincipalTime;

    if(!companionBed){
      const slot =
        findNextAvailableSlot(
          branchRecord,
          companionDuration,
          pool,
          dailyTimeToMinutes(principalStartTime)
        );

      if(!slot){
        showModalMessage(
          `No available bed for ${companion.name} — the branch is fully booked for the rest of the day.`
        );
        return;
      }

      companionBed = slot.bed;
      companionStartTime = slot.startTime;
      companionEndTime = slot.endTime;
      anyTimeShifted = true;
    }

    const companionTherapist =
      companion.therapist || "N/A";

    if(
      poolHasTherapistConflictLocal(
        companionTherapist,
        companionStartTime,
        companionEndTime,
        pool
      )
    ){
      showModalMessage(
        `${companionTherapist} is already assigned to another appointment during this time (companion "${companion.name.trim()}").`
      );
      return;
    }

    pool.push({
      bed: companionBed,
      startTime: companionStartTime,
      endTime: companionEndTime,
      therapist: companionTherapist
    });

    const companionServiceNames =
      companionItems
        .filter(function(item){ return item.itemType === "Service"; })
        .map(function(item){ return item.name; });

    newEntries.push({
      id: createId(),
      client: companion.name.trim(),
      services: companionServiceNames,
      service: companionServiceNames.join(", "),
      therapist: companionTherapist,
      bed: companionBed,
      startTime: companionStartTime,
      endTime: companionEndTime,
      duration: companionDuration,
      status: "Confirmed",
      notes: "",
      isCompanionEntry: true,
      companionOf: mainId,
      companionOfName: clientName,
      updatedAt: new Date().toISOString()
    });

    bookedSummary.push(
      `${companion.name.trim()}: Bed ${companionBed} at ${formatTimeValue(companionStartTime)}`
    );
  }

  const updatedSchedule =
    existingSchedule
      .concat(newEntries)
      .sort(function(a, b){
        return String(a.startTime || "").localeCompare(String(b.startTime || ""));
      });

  saveDailySchedule(branchName, dateValue, updatedSchedule);

  /* Sequential, not fire-and-forget — each call reads the current client
     list fresh before deciding whether to append. Firing them in
     parallel would let two calls read the same "before" snapshot and
     the second save silently drop whatever the first one just added. */
  await ensureClientExistsForSchedule(clientName, branchName);

  for(const companion of modalCompanions){
    await ensureClientExistsForSchedule(companion.name.trim(), branchName);
  }

  updateDailyScheduleOverview();

  alert(
    (
      anyTimeShifted
        ? `Some requested times were fully booked, so the actual assigned time differs from ${formatTimeValue(rawRequestedStartTime)}:\n\n`
        : "Added to the schedule:\n\n"
    ) + bookedSummary.join("\n")
  );
}

function getServicePrice(service, priceType){
  if(!service){
    return 0;
  }

  if(priceType === "VIP"){
    return Number(service.vipPrice) || Number(service.regularPrice) || 0;
  }

  if(priceType === "First Timer"){
    return Number(service.firstTimerPrice) || Number(service.regularPrice) || 0;
  }

  if(priceType === "Senior/PWD"){
    return Number(service.seniorPwdPrice) || Number(service.regularPrice) || 0;
  }

  return Number(service.regularPrice) || 0;
}

function recalculateServiceItem(item, force = false){
  if(item.manualAmount && !force){
    return;
  }

  const price =
    getServicePrice(
      findService(item.name),
      item.priceType
    );

  if(item.isFreebie){
    item.freebieValue = price;
    item.amount = 0;
  }else{
    item.amount = price;
  }
}

function recalculateProductItem(item){
  if(item.isConsumable){
    item.unitPrice = 0;
    item.quantity = Math.max(1, Number(item.quantity) || 1);
    item.amount = 0;
    return;
  }

  if(!item.manualUnitPrice){
    item.unitPrice =
      Number(findProduct(item.name)?.sellingPrice) || 0;
  }

  item.quantity =
    Math.max(1, Number(item.quantity) || 1);

  item.amount =
    item.quantity * item.unitPrice;
}

function modalHasService(){
  return getAllModalItems().some(function(item){
    return (
      item.itemType === "Service" &&
      Boolean(item.name)
    );
  });
}

function updateTherapistRequirement(){
  const hasService =
    modalItems.some(function(item){
      return item.itemType === "Service" && Boolean(item.name);
    });

  const label =
    document.getElementById("modalTherapistLabel");

  const helper =
    document.getElementById("modalTherapistHelper");

  const select =
    document.getElementById("modalTherapistInput");

  if(!label || !helper || !select){
    return;
  }

  if(hasService){
    label.textContent =
      "Therapist *";

    helper.textContent =
      "Required for transactions with a Service.";

    helper.classList.add(
      "therapist-required"
    );

    select.required = true;
  }else{
    label.textContent =
      "Therapist";

    helper.textContent =
      "Optional for Product Only transactions. N/A will appear when left blank.";

    helper.classList.remove(
      "therapist-required"
    );

    select.required = false;
  }
}

function principalHasVipPriceType(){
  return modalItems.some(function(item){
    return (
      item.itemType === "Service" &&
      Boolean(item.name) &&
      item.priceType === "VIP"
    );
  });
}

function isModalVip(){
  const clientName =
    document.getElementById("modalClientInput").value.trim();

  return (
    modalHasVipCard() ||
    isExistingVipClient(clientName) ||
    principalHasVipPriceType()
  );
}

function refreshModalVipState(){
  const isVip = isModalVip();

  const vipBadge =
    document.getElementById("modalVipBadge");

  if(vipBadge){
    vipBadge.classList.toggle("d-none", !isVip);
  }

  modalCompanions.forEach(function(companion){
    companion.vip = isVip;
  });

  if(isVip){
    modalItems
      .concat(
        modalCompanions.flatMap(function(companion){
          return companion.items || [];
        })
      )
      .filter(function(item){
        return item.itemType === "Service";
      })
      .forEach(function(item){
        item.priceType = "VIP";
        item.manualAmount = false;
        recalculateServiceItem(item, true);
      });
  }else if(!modalHasVipCard()){
    modalItems
      .concat(
        modalCompanions.flatMap(function(companion){
          return companion.items || [];
        })
      )
      .filter(function(item){
        return item.itemType === "Service";
      })
      .forEach(function(item){
        if(item.priceType === "VIP"){
          item.priceType = "Regular";
          item.manualAmount = false;
          recalculateServiceItem(item, true);
        }
      });
  }

  updateModalTotal();
}

function getModalGrossAmount(){
  return getAllModalItems()
    .filter(function(item){
      return Boolean(String(item?.name || "").trim());
    })
    .reduce(function(sum, item){
      let amount = 0;

      if(item.itemType === "Product"){
        amount =
          Math.max(1, Number(item.quantity) || 1) *
          Math.max(0, Number(item.unitPrice) || 0);
      }else{
        amount =
          Math.max(0, Number(item.amount) || 0);
      }

      return sum + amount;
    }, 0);
}

function getModalServiceTotal(){
  return getAllModalItems()
    .filter(function(item){
      return Boolean(String(item?.name || "").trim()) &&
        item.itemType === "Service";
    })
    .reduce(function(sum, item){
      return sum + Math.max(0, Number(item.amount) || 0);
    }, 0);
}

function toggleExecutiveVoucher(){
  if(modalExecutiveVoucher){
    modalExecutiveVoucher = false;
    renderModalVouchers();
    updateModalTotal();
    return;
  }

  const serviceTotal = getModalServiceTotal();

  if(serviceTotal <= 0){
    alert("Please add at least one service before applying the Executive Voucher.");
    return;
  }

  const approved = window.confirm(
    "Apply Executive Voucher?\n\n" +
    "This will waive ALL SERVICE charges.\n" +
    "Products are NOT included and must still be paid."
  );

  if(!approved){
    return;
  }

  modalExecutiveVoucher = true;
  renderModalVouchers();
  updateModalTotal();
}

function createModalVoucher(data = {}){
  return {
    id: data.id || createId(),
    itemType: data.itemType || "",
    name: data.name || "",
    tier: data.tier || "",
    value: Math.max(0, Number(data.value ?? data.voucherValue ?? 0) || 0),
    code: normalizeVoucherCode(data.code || ""),
    legacy: data.legacy === true
  };
}

function addModalVoucher(data = {}){
  modalVouchers.push(createModalVoucher(data));
  renderModalVouchers();
  updateModalTotal();
}

function removeModalVoucher(voucherId){
  modalVouchers = modalVouchers.filter(function(voucher){
    return voucher.id !== voucherId;
  });

  renderModalVouchers();
  updateModalTotal();
}

function renderModalVouchers(){
  const container =
    document.getElementById("modalVoucherList");

  if(!container){
    return;
  }

  const executiveMarkup =
    modalExecutiveVoucher
      ? `
          <div class="executive-voucher-active">
            <div>
              <strong>
                Executive Voucher
              </strong>
              <small>All service charges waived: ${peso(getModalServiceTotal())}</small>
            </div>
            <button
              type="button"
              class="executive-voucher-remove"
              title="Remove Executive Voucher"
            >
              ×
            </button>
          </div>
        `
      : "";

  const executiveButton =
    document.getElementById("modalExecutiveVoucherBtn");

  if(executiveButton){
    executiveButton.classList.toggle(
      "executive-voucher-selected",
      modalExecutiveVoucher
    );
    executiveButton.textContent =
      modalExecutiveVoucher
        ? "Executive Voucher Applied"
        : "Executive Voucher";
  }

  if(modalVouchers.length === 0){
    container.innerHTML =
      executiveMarkup ||
      `
        <div class="no-voucher-state">
          No voucher added
        </div>
      `;

    const removeExecutive =
      container.querySelector(".executive-voucher-remove");

    if(removeExecutive){
      removeExecutive.addEventListener("click", function(){
        modalExecutiveVoucher = false;
        renderModalVouchers();
        updateModalTotal();
      });
    }
    return;
  }

  const voucherItems = getVoucherItems();

  container.innerHTML =
    executiveMarkup +
    modalVouchers.map(function(voucher, index){
      const selectedKey =
        voucher.itemType && voucher.name
          ? getVoucherItemKey(voucher)
          : "";

      const options =
        voucherItems.map(function(item){
          const value = getVoucherItemKey(item);
          const selected =
            value === selectedKey
              ? "selected"
              : "";

          const tierLabel =
            item.tier
              ? ` (${item.tier})`
              : "";

          return `
            <option value="${escapeHtml(value)}" ${selected}>
              ${escapeHtml(item.itemType)} — ${escapeHtml(item.name)}${escapeHtml(tierLabel)} — ${peso(item.voucherValue)}
            </option>
          `;
        }).join("");

      const historicalOption =
        selectedKey &&
        !voucherItems.some(function(item){
          return getVoucherItemKey(item) === selectedKey;
        })
          ? `
              <option value="${escapeHtml(selectedKey)}" selected>
                ${escapeHtml(voucher.itemType)} — ${escapeHtml(voucher.name)}${escapeHtml(voucher.tier ? ` (${voucher.tier})` : "")} — ${peso(voucher.value)} (Historical)
              </option>
            `
          : "";

      let codeStatusHtml = "";
      let selectLocked = false;

      if(voucher.legacy){
        codeStatusHtml =
          '<div class="voucher-code-status voucher-code-legacy">Legacy voucher — no number required</div>';
      }else if(voucher.code){
        const registryEntry =
          findVoucherRegistryEntry(voucher.code);

        if(!registryEntry){
          codeStatusHtml =
            '<div class="voucher-code-status voucher-code-invalid">✖ Voucher number not found</div>';
        }else if(registryEntry.status === "cancelled"){
          codeStatusHtml =
            '<div class="voucher-code-status voucher-code-invalid">✖ Voided voucher</div>';
        }else if(
          registryEntry.status === "redeemed" &&
          registryEntry.redeemedSaleId !== (editingSaleId || "")
        ){
          codeStatusHtml =
            '<div class="voucher-code-status voucher-code-invalid">✖ Already used</div>';
        }else{
          codeStatusHtml =
            '<div class="voucher-code-status voucher-code-valid">✔ Verified' +
            (registryEntry.client ? " — " + escapeHtml(registryEntry.client) : "") +
            "</div>";
          selectLocked = true;
        }
      }

      return `
        <div class="multiple-voucher-row" data-voucher-id="${escapeHtml(voucher.id)}">
          <div class="voucher-row-number">
            ${index + 1}
          </div>

          <select class="form-select modal-voucher-select" ${selectLocked ? "disabled" : ""}>
            <option value="">Select Voucher</option>
            ${historicalOption}
            ${options}
          </select>

          <div class="voucher-row-value">
            ${peso(voucher.value)}
          </div>

          <button
            type="button"
            class="btn btn-sm btn-outline-danger modal-remove-voucher"
            title="Remove voucher"
          >
            ×
          </button>

          ${
            voucher.legacy
              ? `<div class="voucher-code-line">${codeStatusHtml}</div>`
              : `
                  <div class="voucher-code-line">
                    <input
                      type="text"
                      class="form-control form-control-sm modal-voucher-code"
                      placeholder="Voucher # (e.g. CHS-XXXX-XXXX)"
                      value="${escapeHtml(voucher.code)}"
                      autocomplete="off"
                    >
                    ${codeStatusHtml}
                  </div>
                `
          }
        </div>
      `;
    }).join("");

  const removeExecutive =
    container.querySelector(".executive-voucher-remove");

  if(removeExecutive){
    removeExecutive.addEventListener("click", function(){
      modalExecutiveVoucher = false;
      renderModalVouchers();
      updateModalTotal();
    });
  }

  container
    .querySelectorAll(".multiple-voucher-row")
    .forEach(function(row){
      const voucherId = row.dataset.voucherId;
      const voucher =
        modalVouchers.find(function(item){
          return item.id === voucherId;
        });

      if(!voucher){
        return;
      }

      row
        .querySelector(".modal-voucher-select")
        .addEventListener("change", function(){
          const selected =
            findVoucherItem(this.value);

          if(selected){
            voucher.itemType = selected.itemType;
            voucher.name = selected.name;
            voucher.tier = selected.tier || "";
            voucher.value = Number(selected.voucherValue) || 0;
          }else{
            voucher.itemType = "";
            voucher.name = "";
            voucher.tier = "";
            voucher.value = 0;
          }

          renderModalVouchers();
          updateModalTotal();
        });

      row
        .querySelector(".modal-remove-voucher")
        .addEventListener("click", function(){
          removeModalVoucher(voucherId);
        });

      const codeInput =
        row.querySelector(".modal-voucher-code");

      if(codeInput){
        codeInput.addEventListener("change", function(){
          voucher.code =
            normalizeVoucherCode(this.value);

          const entry =
            voucher.code
              ? findVoucherRegistryEntry(voucher.code)
              : null;

          const usable =
            entry &&
            entry.status !== "cancelled" &&
            (
              entry.status !== "redeemed" ||
              entry.redeemedSaleId === (editingSaleId || "")
            );

          if(usable){
            /* Auto-fill the voucher row from the registry record. */
            voucher.itemType = entry.itemType;
            voucher.name = entry.name;
            voucher.tier = entry.tier || "";
            voucher.value = Number(entry.value) || 0;
          }

          renderModalVouchers();
          updateModalTotal();
        });
      }
    });
}

function getSelectedVouchersData(){
  const vouchers =
    modalVouchers
      .filter(function(voucher){
        return voucher.name;
      })
      .map(function(voucher){
        return {
          id: voucher.id,
          itemType: voucher.itemType,
          name: voucher.name,
          tier: voucher.tier || "",
          value: Math.max(0, Number(voucher.value) || 0),
          code: voucher.code || "",
          legacy: voucher.legacy === true
        };
      });

  if(modalExecutiveVoucher){
    vouchers.unshift({
      id: "executive-voucher",
      itemType: "Executive",
      name: "Executive Voucher",
      value: getModalServiceTotal(),
      isExecutive: true
    });
  }

  return vouchers;
}

function getSelectedVoucherData(){
  const vouchers =
    getSelectedVouchersData();

  return {
    itemType:
      vouchers.length === 1
        ? vouchers[0].itemType
        : (
            vouchers.length > 1
              ? "Multiple"
              : ""
          ),
    name:
      vouchers.map(function(voucher){
        return voucher.name;
      }).join(", "),
    value:
      vouchers.reduce(function(sum, voucher){
        return sum + Number(voucher.value || 0);
      }, 0),
    vouchers: vouchers
  };
}

function updateModalTotal(){
  const gross =
    getModalGrossAmount();

  const voucher =
    getSelectedVoucherData();

  const deduction =
    Math.min(
      gross,
      Math.max(
        0,
        Number(voucher.value) || 0
      )
    );

  const net =
    Math.max(
      0,
      gross - deduction
    );

  document.getElementById("modalGrossAmount").textContent =
    peso(gross);

  document.getElementById("modalVoucherDeduction").textContent =
    `− ${peso(deduction)}`;

  document.getElementById("modalTotalAmount").textContent =
    peso(net);

  const stickyCompanionCount =
    document.getElementById("stickyCompanionCount");

  const stickyGrossAmount =
    document.getElementById("stickyGrossAmount");

  const stickyVoucherAmount =
    document.getElementById("stickyVoucherAmount");

  const stickyNetAmount =
    document.getElementById("stickyNetAmount");

  if(stickyCompanionCount){
    stickyCompanionCount.textContent =
      String(modalCompanions.length);
  }

  if(stickyGrossAmount){
    stickyGrossAmount.textContent =
      peso(gross);
  }

  if(stickyVoucherAmount){
    stickyVoucherAmount.textContent =
      `− ${peso(deduction)}`;
  }

  if(stickyNetAmount){
    stickyNetAmount.textContent =
      peso(net);
  }  syncSinglePaymentToBalance();
  renderModalPayments();
}


function showModalMessage(text){
  const message =
    document.getElementById("saleModalMessage");

  message.textContent = text;
  message.className = "sale-modal-message sale-message-danger";
}

function hideModalMessage(){
  const message =
    document.getElementById("saleModalMessage");

  message.textContent = "";
  message.className = "sale-modal-message d-none";
}

function setModalInvoiceFields(issueInvoice, invoiceNumber, tinNumber){
  document.getElementById("modalIssueInvoiceInput").checked =
    issueInvoice;

  document.getElementById("modalInvoiceFieldsRow")
    .classList.toggle("d-none", !issueInvoice);

  document.getElementById("modalInvoiceNumberInput").value =
    invoiceNumber;

  document.getElementById("modalInvoiceTinInput").value =
    tinNumber;
}

/* Builds and validates a sale from the modal's current state without
   saving anything — shared by Settle (settledFlag: true) and Add to List
   (settledFlag: false, skips the payment-total checks since an ongoing
   transaction hasn't been paid yet). Returns null (after showing the
   relevant message) on the first validation failure. */
function buildAndValidateSaleData(settledFlag){
  hideModalMessage();

  const validItems =
    getAllModalItems()
      .filter(function(item){
        return Boolean(String(item?.name || "").trim());
      })
      .map(function(item){
        if(item.itemType === "Product"){
          const quantity =
            Math.max(1, Number(item.quantity) || 1);

          const unitPrice =
            Math.max(0, Number(item.unitPrice) || 0);

          return {
            ...item,
            quantity: quantity,
            unitPrice: unitPrice,
            amount: quantity * unitPrice
          };
        }

        return {
          ...item,
          amount: Math.max(0, Number(item.amount) || 0)
        };
      });

  const voucherData =
    getSelectedVoucherData();

  const grossAmount =
    validItems.reduce(function(sum, item){
      return sum + Math.max(0, Number(item.amount) || 0);
    }, 0);

  const voucherValue =
    Math.min(
      grossAmount,
      Math.max(
        0,
        Number(voucherData.value) || 0
      )
    );

  const netAmount =
    Math.max(
      0,
      grossAmount - voucherValue
    );

  const saleData = {
    id: editingSaleId || createId(),
    startTime: document.getElementById("modalTimeInput").value,
    client: document.getElementById("modalClientInput").value.trim(),
    source: document.getElementById("modalSourceInput").value,
    therapist: document.getElementById("modalTherapistInput").value,
    services: validItems.map(function(item){
      return {...item};
    }),
    seniorPwdIdNumber:
      document.getElementById("modalSeniorPwdIdInput").value.trim(),
    companions:
      modalCompanions.map(function(companion){
        return {
          id: companion.id,
          name: companion.name.trim(),
          therapist: companion.therapist,
          seniorPwdIdNumber: (companion.seniorPwdIdNumber || "").trim(),
          vip: isModalVip(),
          items:
            companion.items
              .filter(function(item){
                return item.name;
              })
              .map(function(item){
                return {...item};
              })
        };
      }),
    payments:
      modalPayments
        .filter(function(payment){
          return payment.method && Number(payment.amount) > 0;
        })
        .map(function(payment){
          return {
            id: payment.id,
            method: payment.method,
            amount: Math.max(0, Number(payment.amount) || 0)
          };
        }),
    payment:
      modalPayments.length === 1
        ? modalPayments[0].method
        : (
            modalPayments.length > 1
              ? "Multiple"
              : ""
          ),
    vouchers:
      voucherData.vouchers.map(function(voucher){
        return {...voucher};
      }),
    voucherType: voucherData.itemType,
    voucherName: voucherData.name,
    voucherValue: voucherValue,
    executiveVoucher: modalExecutiveVoucher,
    grossAmount: grossAmount,
    netAmount: netAmount,
    remarks: document.getElementById("modalRemarksInput").value.trim(),
    issueInvoice: document.getElementById("modalIssueInvoiceInput").checked,
    invoiceNumber: document.getElementById("modalInvoiceNumberInput").value.trim(),
    tinNumber: document.getElementById("modalInvoiceTinInput").value.trim(),
    vip: isModalVip(),
    settled: settledFlag,
    updatedAt: new Date().toISOString()
  };

  if(!saleData.startTime){
    showModalMessage("Please select the client time.");
    return null;
  }

  if(!saleData.client){
    showModalMessage("Please enter or select a client.");
    return null;
  }

  if(validItems.length === 0){
    showModalMessage("Please add at least one service or product.");
    return null;
  }

  const invalidCompanion =
    modalCompanions.find(function(companion){
      return !companion.name.trim();
    });

  if(invalidCompanion){
    showModalMessage("Please enter the name of every companion.");
    return null;
  }

  const companionWithoutItems =
    modalCompanions.find(function(companion){
      return !companion.items.some(function(item){
        return item.name;
      });
    });

  if(companionWithoutItems){
    showModalMessage("Please add at least one service or product for every companion.");
    return null;
  }

  const companionMissingTherapist =
    modalCompanions.find(function(companion){
      return (
        companion.items.some(function(item){
          return item.itemType === "Service" && Boolean(item.name);
        }) &&
        !companion.therapist
      );
    });

  if(companionMissingTherapist){
    showModalMessage(
      `Please select a therapist for ${companionMissingTherapist.name || "the companion"}.`
    );
    return null;
  }

  const principalNeedsSeniorPwdId =
    modalItems.some(function(item){
      return item.priceType === "Senior/PWD" && Boolean(item.name);
    });

  if(principalNeedsSeniorPwdId && !saleData.seniorPwdIdNumber){
    showModalMessage(
      `Please enter the Senior Citizen / PWD ID Number for ${saleData.client || "the client"}.`
    );
    return null;
  }

  const companionMissingSeniorPwdId =
    modalCompanions.find(function(companion){
      return (
        companion.items.some(function(item){
          return item.priceType === "Senior/PWD" && Boolean(item.name);
        }) &&
        !String(companion.seniorPwdIdNumber || "").trim()
      );
    });

  if(companionMissingSeniorPwdId){
    showModalMessage(
      `Please enter the Senior Citizen / PWD ID Number for ${companionMissingSeniorPwdId.name || "the companion"}.`
    );
    return null;
  }

  const hasService =
    modalItems.some(function(item){
      return item.itemType === "Service" && Boolean(item.name);
    });

  if(
    hasService &&
    !saleData.therapist
  ){
    showModalMessage(
      "Please select a therapist for the Service transaction."
    );
    return null;
  }

  if(
    !hasService &&
    !saleData.therapist
  ){
    saleData.therapist =
      "N/A";
  }

  if(
    validItems.some(function(item){
      if(item.isConsumable){
        return false;
      }

      return item.isFreebie
        ? Number(item.freebieValue || 0) <= 0
        : Number(item.amount || 0) <= 0;
    })
  ){
    showModalMessage("Please check all service and product prices.");
    return null;
  }

  if(settledFlag){
    const paymentTotal =
      saleData.payments.reduce(function(sum, payment){
        return sum + Number(payment.amount || 0);
      }, 0);

    if(netAmount > 0 && saleData.payments.length === 0){
      showModalMessage("Please add at least one payment method.");
      return null;
    }

    if(Math.abs(paymentTotal - netAmount) >= 0.01){
      showModalMessage(
        `Payment total must equal ${peso(netAmount)}. Current payment total is ${peso(paymentTotal)}.`
      );
      return null;
    }
  }

  const voucherCodeError =
    validateModalVoucherCodes();

  if(voucherCodeError){
    showModalMessage(voucherCodeError);
    return null;
  }

  if(saleData.issueInvoice && !saleData.invoiceNumber){
    showModalMessage("Please enter the Invoice Number, or uncheck Issue Invoice.");
    return null;
  }

  return { saleData: saleData, validItems: validItems };
}

/* ---------- Inventory Stock Audit ----------
   An inventory item can be tagged in Inventory Settings with the service
   it gets consumed by. Every service on this sale that has such items
   linked to it becomes a row in the branch's Stock Audit table, carrying
   this sale's date / therapist / client, and is deducted from that
   branch's available stock. Re-runs on every save of the same sale —
   the inventory layer reconciles by sale id instead of duplicating, so
   editing a sale (adding, removing or reassigning a service) corrects
   both the audit rows and the stock they consumed. */
function syncSaleToStockAudit(saleData){
  if(
    !window.CrownInventory ||
    typeof CrownInventory.syncSaleStockAudit !== "function"
  ){
    return;
  }

  const branch = getSelectedBranch();
  const date = document.getElementById("date").value;

  if(!branch || !date){
    return;
  }

  /* saleData.services already holds the principal's AND every
     companion's items, each stamped with its own participantName /
     therapist by getAllModalItems(), so companion consumption is
     covered without walking saleData.companions a second time. Products
     sold directly consume their linked inventory item the same way a
     service consumes the items linked to it — see getItemsForProduct()
     in inventory-data.js. */
  const lines =
    (saleData.services || [])
      .filter(function(item){
        return (
          (item.itemType === "Service" || item.itemType === "Product") &&
          Boolean(String(item.name || "").trim())
        );
      })
      .map(function(item){
        if(item.itemType === "Product"){
          return {
            saleItemId: item.id,
            kind: "product",
            product: String(item.name).trim(),
            therapist: item.therapist || saleData.therapist || "",
            client: item.participantName || saleData.client || "",
            qty: Number(item.quantity) || 1
          };
        }

        return {
          saleItemId: item.id,
          service: String(item.name).trim(),
          therapist: item.therapist || saleData.therapist || "",
          client: item.participantName || saleData.client || ""
        };
      });

  CrownInventory.syncSaleStockAudit({
    id: saleData.id,
    branch: branch,
    date: date,
    lines: lines
  });
}

function removeSaleFromStockAudit(saleId){
  if(
    !window.CrownInventory ||
    typeof CrownInventory.removeSaleStockAudit !== "function"
  ){
    return;
  }

  CrownInventory.removeSaleStockAudit(saleId);
}

/* Shared persistence tail for Settle and Add to List — the only
   difference between the two is saleData.settled, already baked in by
   buildAndValidateSaleData(). Voucher redemption + VIP-card marking are
   real consequences of a finalized sale, so they only run once settled;
   an ongoing/unpaid entry still registers the client record either way. */
async function persistModalSaleData(saleData, validItems){
  if(editingSaleId){
    salesRows =
      salesRows.map(function(sale){
        return sale.id === editingSaleId
          ? saleData
          : sale;
      });
  }else{
    salesRows.push(saleData);
  }

  salesRows.sort(function(a, b){
    return String(a.startTime || "").localeCompare(String(b.startTime || ""));
  });

  /* Sequential, not fire-and-forget — both read-then-write the client
     list, so running them in parallel risks the second save silently
     dropping whatever the first one just added/changed. */
  let newlyOfficialVouchers = [];

  if(saleData.settled){
    if(
      validItems.some(function(item){
        return item.itemType === "Product" && isVipCardName(item.name);
      })
    ){
      await markClientVip(saleData.client);
    }

    syncVoucherRedemptions(saleData);

    newlyOfficialVouchers = finalizeSaleVouchers(saleData);
  }

  await applyModalClientDetailsToDatabase(saleData.client);

  syncSaleToStockAudit(saleData);

  saveDailySales();
  transactionalSyncSaleRow(saleData.id, saleData);
  renderSalesTable();
  updateSummary();
  updateSalesRecord();
  closeSaleModal();

  /* Any voucher purchase on this sale that just went from "pending" to
     official gets its branded PDF generated and downloaded now — this
     is the only point a purchase voucher's PDF exists, so it can't be
     produced before the sale (and its payment) is actually settled. */
  if(newlyOfficialVouchers.length > 0){
    downloadCrownVoucherPdf(
      newlyOfficialVouchers,
      crownVoucherPdfFilename(newlyOfficialVouchers)
    );
  }
}

async function settleModalSale(){
  const result =
    buildAndValidateSaleData(true);

  if(!result){
    return;
  }

  await persistModalSaleData(result.saleData, result.validItems);
}

async function addModalSaleToList(){
  const result =
    buildAndValidateSaleData(false);

  if(!result){
    return;
  }

  await persistModalSaleData(result.saleData, result.validItems);
}


function normalizeClientName(value){
  return String(value || "").trim();
}

function calculateStoredSaleNet(sale){
  if(sale?.netAmount !== undefined){
    return Math.max(0, Number(sale.netAmount) || 0);
  }

  const gross =
    sale?.grossAmount !== undefined
      ? Number(sale.grossAmount) || 0
      : (sale?.services || []).reduce(function(sum, item){
          return sum + Number(item?.amount || 0);
        }, 0);

  const voucher =
    Math.max(0, Number(sale?.voucherValue) || 0);

  return Math.max(
    0,
    gross - Math.min(gross, voucher)
  );
}

function getCompanionSaleSubtotal(companion, sale){
  if(Array.isArray(companion?.items)){
    return companion.items.reduce(function(sum, item){
      return sum + Number(item?.amount || 0);
    }, 0);
  }

  return (sale?.services || [])
    .filter(function(item){
      return (
        item?.participantType === "Companion" &&
        normalizeClientName(item?.participantName).toLowerCase() ===
          normalizeClientName(companion?.name).toLowerCase()
      );
    })
    .reduce(function(sum, item){
      return sum + Number(item?.amount || 0);
    }, 0);
}

async function syncClientDatabaseFromSales(){
  const existingClients = await getClients();
  const clientMap = new Map();

  existingClients.forEach(function(client){
    const key =
      normalizeClientName(client?.name).toLowerCase();

    if(!key){
      return;
    }

    clientMap.set(key, {
      ...client,
      totalVisits: 0,
      totalSpent: 0,
      lastVisit: "",
      salesBranches: [],
      principalClients: [],
      clientRole:
        client.clientRole === "Companion"
          ? "Companion"
          : "Principal"
    });
  });

  function ensureClient(name, branch, role){
    const cleanName = normalizeClientName(name);
    const key = cleanName.toLowerCase();

    if(!key){
      return null;
    }

    if(!clientMap.has(key)){
      clientMap.set(key, {
        id:
          "CLI-" +
          Date.now().toString(36).toUpperCase() +
          Math.random().toString(36).slice(2, 6).toUpperCase(),
        name: cleanName,
        mobile: "",
        birthday: "",
        branch: branch || "",
        vip: "No",
        notes: "",
        totalVisits: 0,
        lastVisit: "",
        totalSpent: 0,
        clientRole: role,
        salesBranches: [],
        principalClients: [],
        createdAt: new Date().toISOString()
      });
    }

    const client = clientMap.get(key);

    /*
      A client who later appears as a principal client is treated as a
      regular/principal client rather than permanently remaining a companion.
    */
    if(role === "Principal"){
      client.clientRole = "Principal";
    }else if(!client.clientRole){
      client.clientRole = "Companion";
    }

    return client;
  }

  Object.keys(localStorage)
    .filter(function(key){
      return key.startsWith(STORAGE_PREFIX);
    })
    .forEach(function(storageKey){
      let report;

      try{
        report = JSON.parse(localStorage.getItem(storageKey) || "{}");
      }catch(error){
        return;
      }

      const branch =
        normalizeClientName(report?.branch);

      const date =
        normalizeClientName(report?.date);

      const rows =
        Array.isArray(report?.rows)
          ? report.rows
          : [];

      rows
        .filter(function(sale){
          return sale?.settled !== false;
        })
        .forEach(function(sale){
          const principalName =
            normalizeClientName(sale?.client);

          const principal =
            ensureClient(
              principalName,
              branch,
              "Principal"
            );

          const saleCompanions =
            Array.isArray(sale?.companions)
              ? sale.companions
              : [];

          /*
            Companions below add their own item subtotal to their own
            totalSpent. The principal must only get the remainder of the
            sale's net amount (which already includes every companion's
            items) — otherwise companion spend gets counted twice.
          */
          const companionsSubtotal =
            saleCompanions.reduce(function(sum, companionData){
              return sum + getCompanionSaleSubtotal(companionData, sale);
            }, 0);

          if(principal){
            principal.totalVisits =
              Number(principal.totalVisits || 0) + 1;

            principal.totalSpent =
              Number(principal.totalSpent || 0) +
              Math.max(
                0,
                calculateStoredSaleNet(sale) - companionsSubtotal
              );

            if(
              date &&
              (
                !principal.lastVisit ||
                date > principal.lastVisit
              )
            ){
              principal.lastVisit = date;
              principal.branch =
                branch || principal.branch;
            }

            if(
              branch &&
              !principal.salesBranches.includes(branch)
            ){
              principal.salesBranches.push(branch);
            }

            if(sale?.vip === true){
              principal.vip =
                principal.vip === "Yes"
                  ? "Yes"
                  : principal.vip;
            }
          }

          saleCompanions.forEach(function(companionData){
            const companionName =
              normalizeClientName(companionData?.name);

            const companion =
              ensureClient(
                companionName,
                branch,
                "Companion"
              );

            if(!companion){
              return;
            }

            companion.totalVisits =
              Number(companion.totalVisits || 0) + 1;

            companion.totalSpent =
              Number(companion.totalSpent || 0) +
              getCompanionSaleSubtotal(companionData, sale);

            if(
              date &&
              (
                !companion.lastVisit ||
                date > companion.lastVisit
              )
            ){
              companion.lastVisit = date;
              companion.branch =
                branch || companion.branch;
            }

            if(
              branch &&
              !companion.salesBranches.includes(branch)
            ){
              companion.salesBranches.push(branch);
            }

            if(
              principalName &&
              !companion.principalClients.includes(principalName)
            ){
              companion.principalClients.push(principalName);
            }
          });
        });
    });

  const updatedClients =
    Array.from(clientMap.values())
      .map(function(client){
        return {
          ...client,
          totalVisits:
            Number(client.totalVisits) || 0,
          totalSpent:
            Number(client.totalSpent) || 0,
          principalClients:
            Array.isArray(client.principalClients)
              ? client.principalClients
              : [],
          salesBranches:
            Array.isArray(client.salesBranches)
              ? client.salesBranches
              : [],
          updatedAt:
            new Date().toISOString()
        };
      });

  await window.CrownClientStore.saveAll(updatedClients);

  loadModalOptions();
}

async function markClientVip(clientName){
  const clients = await getClients();

  const client =
    clients.find(function(item){
      return (
        String(item?.name || "").trim().toLowerCase() ===
        clientName.trim().toLowerCase()
      );
    });

  if(client){
    client.vip = "Yes";
    client.status = "VIP";
    client.updatedAt = new Date().toISOString();
  }else{
    clients.push({
      id: "CLI-" + Date.now().toString(36).toUpperCase(),
      name: clientName,
      branch: getSelectedBranch(),
      vip: "Yes",
      status: "VIP",
      notes: "Automatically marked VIP after VIP Card purchase.",
      totalVisits: 0,
      totalSpent: 0,
      clientRole: "Principal",
      principalClients: [],
      salesBranches: [],
      createdAt: new Date().toISOString()
    });
  }

  await window.CrownClientStore.saveAll(clients);

  loadModalOptions();
}

/* MAIN TABLE */



function getSaleCompanionCount(sale){
  if(Array.isArray(sale?.companions)){
    return sale.companions.filter(function(companion){
      return Boolean(String(companion?.name || "").trim());
    }).length;
  }

  if(Array.isArray(sale?.participantRows)){
    return sale.participantRows.filter(function(participant, index){
      if(index === 0){
        return false;
      }

      return Boolean(String(participant?.name || "").trim());
    }).length;
  }

  return Math.max(0, Number(sale?.companionCount) || 0);
}

function getSourceSummaryData(sales){
  const summary = {};

  (Array.isArray(sales) ? sales : []).forEach(function(sale){
    const source =
      String(sale?.source || "Walk-in").trim() ||
      "Walk-in";

    summary[source] =
      (summary[source] || 0) + 1;

    const companionCount =
      getSaleCompanionCount(sale);

    if(companionCount > 0){
      summary.Referral =
        (summary.Referral || 0) + companionCount;
    }
  });

  return summary;
}

function renderStatisticsSourceSummary(){
  const container =
    document.getElementById("statisticsSourceSummary");

  if(!container){
    return;
  }

  let sales = [];

  if(typeof dailySales !== "undefined" && Array.isArray(dailySales)){
    sales = dailySales;
  }else{
    try{
      const stored =
        JSON.parse(localStorage.getItem("crownDailySales") || "[]");

      sales = Array.isArray(stored) ? stored : [];
    }catch(error){
      sales = [];
    }
  }

  const summary =
    getSourceSummaryData(sales);

  const entries =
    Object.entries(summary)
      .sort(function(a, b){
        return b[1] - a[1];
      });

  if(entries.length === 0){
    container.innerHTML = `
      <div class="summary-empty-state">
        No source data available for the selected period.
      </div>
    `;
    return;
  }

  container.innerHTML =
    entries.map(function(entry){
      const source = entry[0];
      const count = entry[1];

      return `
        <article class="source-summary-card">
          <span class="source-summary-label">${escapeHtml(source)}</span>
          <strong class="source-summary-count">${count}</strong>
          <small>${count === 1 ? "client" : "clients"}</small>
        </article>
      `;
    }).join("");
}

function getPaymentBadgeMeta(method){
  const normalized =
    String(method || "")
      .trim()
      .toLowerCase();

  if(normalized === "cash"){
    return {
      className: "payment-cash",
      icon: "fa-money-bill-wave"
    };
  }

  if(normalized === "gcash"){
    return {
      className: "payment-gcash",
      icon: "fa-mobile-screen-button"
    };
  }

  if(normalized === "bank transfer"){
    return {
      className: "payment-bank",
      icon: "fa-building-columns"
    };
  }

  if(normalized === "terminal"){
    return {
      className: "payment-terminal",
      icon: "fa-credit-card"
    };
  }

  return {
    className: "payment-default",
    icon: "fa-wallet"
  };
}


function syncSaleParticipantBlockHeights(row){
  if(!row){
    return;
  }

  const participantCells =
    Array.from(
      row.querySelectorAll(".aligned-participant-cell")
    );

  if(participantCells.length < 3){
    return;
  }

  const blockGroups =
    participantCells.map(function(cell){
      return Array.from(
        cell.querySelectorAll(":scope > .aligned-sale-block")
      );
    });

  const largestGroupLength =
    Math.max.apply(
      null,
      blockGroups.map(function(group){
        return group.length;
      })
    );

  blockGroups.forEach(function(group){
    group.forEach(function(block){
      block.style.height = "";
      block.style.minHeight = "";
    });
  });

  for(let index = 0; index < largestGroupLength; index += 1){
    const matchingBlocks =
      blockGroups
        .map(function(group){
          return group[index];
        })
        .filter(Boolean);

    if(matchingBlocks.length === 0){
      continue;
    }

    const tallestHeight =
      Math.max.apply(
        null,
        matchingBlocks.map(function(block){
          return Math.ceil(
            block.getBoundingClientRect().height
          );
        })
      );

    matchingBlocks.forEach(function(block){
      block.style.height =
        `${tallestHeight}px`;

      block.style.minHeight =
        `${tallestHeight}px`;
    });
  }
}

function syncAllSaleParticipantBlockHeights(){
  document
    .querySelectorAll(".sale-summary-row")
    .forEach(function(row){
      syncSaleParticipantBlockHeights(row);
    });
}

let saleHeightSyncResizeTimer = null;

window.addEventListener("resize", function(){
  window.clearTimeout(
    saleHeightSyncResizeTimer
  );

  saleHeightSyncResizeTimer =
    window.setTimeout(function(){
      syncAllSaleParticipantBlockHeights();
    }, 120);
});


/* Shared row-renderer for both the Sales table (settled rows) and the
   Ongoing Transactions table (unsettled rows) — everything about how a
   sale's participants/items/payment cells are built is identical between
   the two; only the Action column's buttons/permission differ, driven by
   actionsConfig. */
function renderSalesRowsCore(rows, tbodyId, actionsConfig){
  const tbody = document.getElementById(tbodyId);

  if(!tbody){
    return;
  }

  tbody.innerHTML = "";

  rows.forEach(function(sale){
    const grossTotal =
      (sale.services || []).reduce(function(sum, item){
        return sum + Number(item.amount || 0);
      }, 0);

    const voucherValue =
      Math.min(
        grossTotal,
        Math.max(
          0,
          Number(sale.voucherValue || 0)
        )
      );

    const total =
      sale.netAmount !== undefined
        ? Number(sale.netAmount) || 0
        : Math.max(
            0,
            grossTotal - voucherValue
          );

    const saleItems =
      (sale.services || []).filter(function(item){
        return Boolean(item.name);
      });

    const principalItems =
      saleItems.filter(function(item){
        return (
          !item.participantType ||
          item.participantType === "Principal"
        );
      });

    const participantRows = [
      {
        type: "Principal",
        name: sale.client || "—",
        therapist:
          principalItems
            .filter(function(item){
              return item.itemType === "Service";
            })
            .map(function(item){
              return item.therapist || sale.therapist;
            })
            .filter(Boolean)[0] ||
          sale.therapist ||
          "N/A",
        items: principalItems,
        vip: sale.vip === true
      }
    ];

    const companionMap = new Map();

    if(Array.isArray(sale.companions)){
      sale.companions.forEach(function(companion){
        const companionItems =
          Array.isArray(companion.items)
            ? companion.items.filter(function(item){
                return Boolean(item.name);
              })
            : saleItems.filter(function(item){
                return (
                  item.participantType === "Companion" &&
                  item.participantName === companion.name
                );
              });

        companionMap.set(companion.name || `Companion ${companionMap.size + 1}`, {
          type: "Companion",
          name: companion.name || `Companion ${companionMap.size + 1}`,
          therapist:
            companionItems
              .filter(function(item){
                return item.itemType === "Service";
              })
              .map(function(item){
                return item.therapist || companion.therapist;
              })
              .filter(Boolean)[0] ||
            companion.therapist ||
            "N/A",
          items: companionItems,
          vip: companion.vip === true || sale.vip === true
        });
      });
    }

    saleItems
      .filter(function(item){
        return item.participantType === "Companion";
      })
      .forEach(function(item){
        const companionName =
          item.participantName || "Companion";

        if(!companionMap.has(companionName)){
          companionMap.set(companionName, {
            type: "Companion",
            name: companionName,
            therapist:
              item.itemType === "Service"
                ? (item.therapist || "N/A")
                : "N/A",
            items: [],
            vip: sale.vip === true
          });
        }

        const rowData =
          companionMap.get(companionName);

        if(
          !rowData.items.some(function(existingItem){
            return existingItem.id && item.id
              ? existingItem.id === item.id
              : existingItem === item;
          })
        ){
          rowData.items.push(item);
        }

        if(
          rowData.therapist === "N/A" &&
          item.itemType === "Service" &&
          item.therapist
        ){
          rowData.therapist = item.therapist;
        }
      });

    participantRows.push(...Array.from(companionMap.values()));

    function getItemLabel(item){
      const quantity =
        item.itemType === "Product" && Number(item.quantity) > 1
          ? ` ×${item.quantity}`
          : "";

      const voucherLabel =
        item.productKind === "Service Voucher"
          ? "Voucher: "
          : "";

      return `${voucherLabel}${item.name}${quantity}`;
    }

    const clientBlocks =
      participantRows.map(function(participant, index){
        const subInfo = [];

        if(participant.type === "Companion"){
          subInfo.push("Companion");
        }

        if(participant.vip){
          subInfo.push("VIP Client");
        }

        return `
          <div class="aligned-sale-block ${index > 0 ? "companion-line" : "principal-line"}">
            <div class="aligned-client-name">
              <strong class="aligned-client-primary-name">
                ${escapeHtml(participant.name)}
              </strong>

              ${
                subInfo.length
                  ? `
                      <div class="aligned-client-subinfo">
                        ${subInfo.map(function(label){
                          return `
                            <span class="${label === "VIP Client" ? "vip-subinfo" : ""}">
                              ${escapeHtml(label)}
                            </span>
                          `;
                        }).join("")}
                      </div>
                    `
                  : ""
              }
            </div>
          </div>
        `;
      }).join("");

    const therapistBlocks =
      participantRows.map(function(participant, index){
        return `
          <div class="aligned-sale-block ${index > 0 ? "companion-line" : "principal-line"}">
            <span>${escapeHtml(participant.therapist || "N/A")}</span>
          </div>
        `;
      }).join("");

    function getCompactItemClass(item){
      if(
        item?.productKind === "Service Voucher" ||
        String(item?.name || "").toLowerCase().includes("voucher")
      ){
        return "compact-item-voucher";
      }

      if(
        String(item?.name || "").trim().toLowerCase() === "vip card"
      ){
        return "compact-item-vip";
      }

      return item?.itemType === "Product"
        ? "compact-item-product"
        : "compact-item-service";
    }

    function renderCompactParticipantItems(items){
      if(!Array.isArray(items) || items.length === 0){
        return '<span class="summary-items-empty">—</span>';
      }

      const visibleLimit = 4;
      const visibleItems = items.slice(0, visibleLimit);
      const hiddenItems = items.slice(visibleLimit);
      const allLabels = items.map(getItemLabel);

      return `
        <div
          class="compact-items-list"
          title="${escapeHtml(allLabels.join(", "))}"
        >
          ${visibleItems.map(function(item, itemIndex){
              return `
                <span class="compact-item-wrapper">
                  <span class="compact-item-chip ${getCompactItemClass(item)}">
                    ${escapeHtml(getItemLabel(item))}
                  </span>${itemIndex < visibleItems.length - 1 || hiddenItems.length ? '<span class="compact-item-comma">,</span>' : ""}
                </span>
              `;
            }).join("")}

          ${
            hiddenItems.length
              ? `
                  <button
                    type="button"
                    class="compact-more-toggle"
                    aria-expanded="false"
                    title="${escapeHtml(hiddenItems.map(getItemLabel).join(", "))}"
                  >
                    +${hiddenItems.length} more
                  </button>

                  <span class="compact-hidden-items">
                    ${hiddenItems.map(function(item, hiddenIndex){
                        return `
                          <span class="compact-item-wrapper">
                            <span class="compact-item-chip ${getCompactItemClass(item)}">
                              ${escapeHtml(getItemLabel(item))}
                            </span>${hiddenIndex < hiddenItems.length - 1 ? '<span class="compact-item-comma">,</span>' : ""}
                          </span>
                        `;
                      }).join("")}
                  </span>
                `
              : ""
          }
        </div>
      `;
    }

    const itemBlocks =
      participantRows.map(function(participant, index){
        return `
          <div class="aligned-sale-block aligned-items-block ${index > 0 ? "companion-line" : "principal-line"}">
            ${renderCompactParticipantItems(participant.items)}
          </div>
        `;
      }).join("");

    const row = document.createElement("tr");

    row.className = "sale-summary-row settled";

    row.innerHTML = `
      <td class="summary-time-cell">
        ${formatTimeValue(sale.startTime)}
      </td>

      <td class="aligned-participant-cell">
        ${clientBlocks}
      </td>

      <td class="aligned-participant-cell">
        ${therapistBlocks}
      </td>

      <td class="summary-items-cell aligned-participant-cell">
        ${itemBlocks}
      </td>

      <td class="summary-amount-cell">
        ${peso(total)}
      </td>

      <td class="payment-column-cell">
        <div class="payment-badge-stack">
          ${
            getSalePayments(sale).map(function(payment){
              return `
                ${
                  (function(){
                    const badgeMeta =
                      getPaymentBadgeMeta(payment.method);

                    return `
                      <span class="payment-badge payment-method-with-amount ${badgeMeta.className}">
                        <strong>${escapeHtml(payment.method)}</strong>
                        <small>${peso(payment.amount)}</small>
                      </span>
                    `;
                  })()
                }
              `;
            }).join("")
          }

          ${
            sale.voucherName || sale.voucherService ||
            (Array.isArray(sale.vouchers) && sale.vouchers.length)
              ? `
                  <span
                    class="voucher-used-badge"
                    title="${escapeHtml(
                      `${sale.voucherType || "Service"}: ${sale.voucherName || sale.voucherService || "Voucher"}`
                    )}"
                  >
                    ${
                      (function(){
                        const isExecutive =
                          sale.executiveVoucher === true ||
                          (
                            Array.isArray(sale.vouchers) &&
                            sale.vouchers.some(function(voucher){
                              return voucher &&
                                (
                                  voucher.isExecutive === true ||
                                  voucher.name === "Executive Voucher"
                                );
                            })
                          ) ||
                          sale.voucherName === "Executive Voucher";

                        return isExecutive ? "Executive Voucher" : "Voucher";
                      })()
                    }
                  </span>
                `
              : ""
          }
        </div>
      </td>

      <td class="${actionsConfig.gate() ? "" : "d-none"}">
        <div class="summary-action-buttons">
          ${actionsConfig.buildButtonsHtml()}
        </div>
      </td>
    `;

    row.querySelectorAll(".compact-more-toggle").forEach(function(button){
      button.addEventListener("click", function(){
        const list = button.closest(".compact-items-list");
        const expanded = list.classList.toggle("is-expanded");

        button.setAttribute(
          "aria-expanded",
          expanded ? "true" : "false"
        );

        button.textContent = expanded
          ? "Show less"
          : button.dataset.moreLabel;
      });

      button.dataset.moreLabel = button.textContent.trim();
    });

    actionsConfig.wireButtons(row, sale);

    tbody.appendChild(row);

    requestAnimationFrame(function(){
      syncSaleParticipantBlockHeights(row);
    });
  });

  requestAnimationFrame(function(){
    syncAllSaleParticipantBlockHeights();
  });
}

function canEditOngoingSales(){
  const role =
    window.CrownAuth?.getEffectiveRole?.();

  return role === "Admin" || role === "Executive Assistant" || role === "Receptionist";
}

function renderSalesTable(){
  const settledRows =
    salesRows.filter(function(sale){
      return sale.settled !== false;
    });

  renderSalesRowsCore(settledRows, "body", {
    gate: canEditSavedSales,
    buildButtonsHtml: function(){
      return `
        <button type="button" class="btn btn-sm btn-warning edit-sale-btn">
          Edit
        </button>

        <button type="button" class="btn btn-sm btn-danger delete-sale-btn">
          Delete
        </button>
      `;
    },
    wireButtons: function(row, sale){
      row.querySelector(".edit-sale-btn")?.addEventListener("click", function(){
        openEditSaleModal(sale.id);
      });

      row.querySelector(".delete-sale-btn")?.addEventListener("click", function(){
        deleteSale(sale.id);
      });
    }
  });

  renderOngoingTransactionsTable();
}

function renderOngoingTransactionsTable(){
  const ongoingRows =
    salesRows.filter(function(sale){
      return sale.settled === false;
    });

  renderSalesRowsCore(ongoingRows, "ongoingBody", {
    gate: canEditOngoingSales,
    buildButtonsHtml: function(){
      return `
        <button type="button" class="btn btn-sm btn-warning edit-sale-btn">
          Edit
        </button>

        <button type="button" class="btn btn-sm btn-success settle-sale-btn">
          Settle
        </button>

        <button type="button" class="btn btn-sm btn-danger delete-sale-btn">
          Delete
        </button>
      `;
    },
    wireButtons: function(row, sale){
      row.querySelector(".edit-sale-btn")?.addEventListener("click", function(){
        openEditSaleModal(sale.id);
      });

      row.querySelector(".settle-sale-btn")?.addEventListener("click", function(){
        settleSaleRow(sale.id);
      });

      row.querySelector(".delete-sale-btn")?.addEventListener("click", function(){
        deleteSale(sale.id);
      });
    }
  });

  const card = document.getElementById("ongoingTransactionsCard");

  if(card){
    card.classList.toggle("d-none", ongoingRows.length === 0);
  }
}

/* Quick one-click promotion from the Ongoing Transactions table row —
   distinct from settleModalSale() which saves from the open modal. */
function settleSaleRow(saleId){
  if(!canEditOngoingSales()){
    alert("Your account cannot settle this transaction.");
    return;
  }

  const sale =
    salesRows.find(function(item){
      return item.id === saleId;
    });

  if(!sale){
    return;
  }

  sale.settled = true;
  sale.updatedAt = new Date().toISOString();

  const newlyOfficialVouchers = finalizeSaleVouchers(sale);

  saveDailySales();
  transactionalSyncSaleRow(sale.id, sale);
  renderSalesTable();
  updateSummary();
  updateSalesRecord();

  if(newlyOfficialVouchers.length > 0){
    downloadCrownVoucherPdf(
      newlyOfficialVouchers,
      crownVoucherPdfFilename(newlyOfficialVouchers)
    );
  }
}

function deleteSale(saleId){
  const sale =
    salesRows.find(function(item){
      return item.id === saleId;
    });

  /* Settled sales stay locked to Admin/Executive Assistant — an ongoing
     transaction hasn't been finalized yet, so Receptionist can also
     delete it (e.g. when it won't push through), same as it can now
     Edit/Settle it. */
  const canDelete =
    sale?.settled === false
      ? canEditOngoingSales()
      : canEditSavedSales();

  if(!canDelete){
    alert(
      sale?.settled === false
        ? "Your account cannot delete this transaction."
        : "Your account cannot delete a saved transaction. Please ask an Admin or Executive Assistant to void it."
    );
    return;
  }

  if(
    !confirm(
      `Delete the ${sale?.settled === false ? "ongoing transaction" : "sale"} of "${sale?.client || "this client"}"?`
    )
  ){
    return;
  }

  salesRows =
    salesRows.filter(function(item){
      return item.id !== saleId;
    });

  removeSaleFromStockAudit(saleId);

  saveDailySales();
  transactionalSyncSaleRow(saleId, null);
  renderSalesTable();
  updateSummary();
  updateSalesRecord();
}

/* STORAGE AND SUMMARY */

function saveDailySales(){
  const branch = getSelectedBranch();
  const date = document.getElementById("date").value;

  if(!branch || !date){
    return;
  }

  localStorage.setItem(
    getStorageKey(),
    JSON.stringify({
      branch: branch,
      date: date,
      rows: salesRows
    })
  );

  /* Fire-and-forget — a full recompute from the stored sales data
     (source of truth), not a targeted add, so back-to-back calls just
     converge on the same result rather than racing to lose an update. */
  syncClientDatabaseFromSales().catch(function(error){
    console.error("Unable to sync the client database from sales:", error);
  });

  renderCalendar();
  updateSalesRecord();
}

/* Reads the LIVE crownDailySales_<branch>_<date> doc fresh inside a
   transaction and merges ONE sale row into it (replace by id, append,
   or remove when row is null) — instead of saveDailySales()'s
   whole-array overwrite based on whatever salesRows happens to hold in
   THIS tab's memory. With multiple staff able to add/edit/settle sales
   for the same branch/date at once through a shift, that whole-array
   overwrite silently discarded whichever staff member's save didn't
   happen to land last — the reported "ongoing sales aren't showing up"
   symptom, confirmed NOT a display-refresh issue (persisted even after
   a full logout/reload) the way the earlier attendance report turned
   out to be.

   This runs ALONGSIDE (not instead of) saveDailySales() — that local
   write and its existing debounced generic flush stay as-is, both for
   backward compatibility with data-protection.js's restore flow (which
   pushes a raw localStorage snapshot, bypassing per-row logic
   entirely) and as an offline-safe fallback. This transactional call is
   what actually reaches the cloud correctly for concurrent edits; the
   generic flush a moment later becomes a redundant, harmless re-push of
   the same data in the common case. Deliberately only handles the
   (overwhelmingly common) single-chunk case, same as scheduling.js's
   transactionalUpdateSchedules(). */
async function transactionalSyncSaleRow(saleId, row){
  if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
    return { status: "offline" };
  }

  const branch = getSelectedBranch();
  const date = document.getElementById("date").value;

  if(!branch || !date){
    return { status: "offline" };
  }

  const key = getStorageKey();

  const ref =
    firebase.firestore()
      .collection("appData")
      .doc(encodeURIComponent(key));

  try{
    return await firebase.firestore().runTransaction(async function(transaction){
      const snap = await transaction.get(ref);
      const data = snap.exists ? snap.data() : null;

      if(data && Number.isInteger(data.chunkCount) && data.chunkCount > 1){
        return { status: "unsupported" };
      }

      let record = { branch: branch, date: date, rows: [] };

      if(data && !data.deleted && data.value){
        try{
          const parsed = JSON.parse(data.value);

          if(parsed && Array.isArray(parsed.rows)){
            record = parsed;
          }
        }catch(error){
          /* keep default */
        }
      }

      const index =
        record.rows.findIndex(function(item){
          return item.id === saleId;
        });

      if(row === null){
        if(index !== -1){
          record.rows.splice(index, 1);
        }
      }else if(index === -1){
        record.rows.push(row);
      }else{
        record.rows[index] = row;
      }

      transaction.set(ref, {
        key: key,
        chunkIndex: 0,
        chunkCount: 1,
        value: JSON.stringify(record),
        deleted: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      return { status: "ok" };
    });
  }catch(error){
    console.error("transactionalSyncSaleRow failed:", error);
    return { status: "error" };
  }
}

/* Runs once on every page load, right after loadDailySales() populates
   salesRows from THIS device's localStorage — pushes every row it
   finds there through transactionalSyncSaleRow(), one at a time. This
   is the recovery path for whatever was entered before this device had
   the fix above: those rows never got individually pushed (only ever
   swept up in the old whole-array flush, which could still lose them to
   another device's concurrent save), so without this they'd just sit
   local-only until something happened to touch them again.

   Safe to run unconditionally, every load, for every branch/date this
   device happens to have local data for — each call is a fresh
   read-and-merge-by-id against the live doc, same as a normal edit, so
   it can never overwrite what other devices already have there, only
   add/update this device's own rows into it. Fire-and-forget: sales
   entry shouldn't wait on this, and any that fail are simply retried on
   the next load. */
function resyncLocalSalesRowsToCloud(){
  if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
    return;
  }

  salesRows.forEach(function(row){
    transactionalSyncSaleRow(row.id, row);
  });
}

function loadDailySales(){
  salesRows = [];

  const raw =
    localStorage.getItem(getStorageKey());

  if(raw){
    try{
      const data = JSON.parse(raw);

      if(Array.isArray(data?.rows)){
        salesRows =
          data.rows.map(function(row){
            return {
              id: row.id || createId(),
              startTime: row.startTime || currentTimeValue(),
              client: row.client || "",
              source: row.source || "Facebook",
              therapist:
                row.therapist ||
                (
                  Array.isArray(row.services) &&
                  row.services.length > 0 &&
                  row.services.every(function(item){
                    return (
                      item.itemType === "Product" ||
                      (
                        !item.itemType &&
                        Boolean(findProduct(item.name))
                      )
                    );
                  })
                    ? "N/A"
                    : ""
                ),
              services:
                Array.isArray(row.services)
                  ? row.services.map(function(item){
                      return {
                        ...item,
                        id: item.id || createId(),
                        itemType:
                          item.itemType ||
                          (findProduct(item.name) ? "Product" : "Service"),
                        quantity: Number(item.quantity) || 1,
                        unitPrice: Number(item.unitPrice) || 0,
                        amount: Number(item.amount) || 0,
                        productKind:
                          item.productKind ||
                          (
                            String(item.name || "").startsWith("Voucher — ")
                              ? "Service Voucher"
                              : "Product"
                          ),
                        sourceServiceName:
                          item.sourceServiceName ||
                          (
                            String(item.name || "").startsWith("Voucher — ")
                              ? String(item.name).replace(/^Voucher — /, "")
                              : ""
                          )
                      };
                    })
                  : [],
              companions:
                Array.isArray(row.companions)
                  ? row.companions.map(function(companion){
                      return {
                        id: companion.id || createId(),
                        name: companion.name || "",
                        therapist: companion.therapist || "",
                        vip: companion.vip === true || row.vip === true,
                        items:
                          Array.isArray(companion.items)
                            ? companion.items.map(function(item){
                                return {
                                  ...item,
                                  id: item.id || createId(),
                                  quantity: Number(item.quantity) || 1,
                                  unitPrice: Number(item.unitPrice) || 0,
                                  amount: Number(item.amount) || 0
                                };
                              })
                            : []
                      };
                    })
                  : [],
              payments:
                Array.isArray(row.payments)
                  ? row.payments
                      .filter(function(payment){
                        return payment &&
                          payment.method &&
                          Number(payment.amount) > 0;
                      })
                      .map(function(payment){
                        return {
                          id: payment.id || createId(),
                          method: payment.method,
                          amount: Math.max(0, Number(payment.amount) || 0)
                        };
                      })
                  : (
                      Number(row.netAmount) > 0
                        ? [{
                            id: createId(),
                            method:
                              row.payment && row.payment !== "Multiple"
                                ? row.payment
                                : "Cash",
                            amount: Math.max(0, Number(row.netAmount) || 0)
                          }]
                        : []
                    ),
              payment:
                Array.isArray(row.payments) && row.payments.length > 1
                  ? "Multiple"
                  : (
                      Array.isArray(row.payments) && row.payments.length === 1
                        ? row.payments[0].method
                        : (row.payment || "")
                    ),
              vouchers:
                Array.isArray(row.vouchers)
                  ? row.vouchers.map(function(voucher){
                      return {
                        ...voucher,
                        id: voucher.id || createId(),
                        value: Math.max(0, Number(voucher.value) || 0),
                        isExecutive:
                          voucher.isExecutive === true ||
                          voucher.name === "Executive Voucher"
                      };
                    })
                  : (
                      row.voucherName || row.voucherService
                        ? [{
                            id: createId(),
                            itemType: row.voucherType || "Service",
                            name: row.voucherName || row.voucherService,
                            value: Math.max(0, Number(row.voucherValue) || 0),
                            isExecutive:
                              row.executiveVoucher === true ||
                              row.voucherName === "Executive Voucher"
                          }]
                        : []
                    ),
              executiveVoucher:
                row.executiveVoucher === true ||
                row.voucherName === "Executive Voucher" ||
                (
                  Array.isArray(row.vouchers) &&
                  row.vouchers.some(function(voucher){
                    return voucher &&
                      (
                        voucher.isExecutive === true ||
                        voucher.name === "Executive Voucher"
                      );
                  })
                ),
              voucherType:
                row.voucherType ||
                (row.voucherService ? "Service" : ""),
              voucherName:
                row.voucherName ||
                row.voucherService ||
                "",
              voucherValue: Number(row.voucherValue) || 0,
              grossAmount:
                row.grossAmount !== undefined
                  ? Number(row.grossAmount) || 0
                  : (
                      Array.isArray(row.services)
                        ? row.services.reduce(function(sum, item){
                            return sum + Number(item.amount || 0);
                          }, 0)
                        : 0
                    ),
              netAmount:
                row.netAmount !== undefined
                  ? Number(row.netAmount) || 0
                  : Math.max(
                      0,
                      (
                        Array.isArray(row.services)
                          ? row.services.reduce(function(sum, item){
                              return sum + Number(item.amount || 0);
                            }, 0)
                          : 0
                      ) -
                      (Number(row.voucherValue) || 0)
                    ),
              remarks: row.remarks || "",
              issueInvoice: row.issueInvoice === true,
              invoiceNumber: row.invoiceNumber || "",
              tinNumber: row.tinNumber || "",
              vip: row.vip === true,
              settled:
                row.settled !== false
            };
          });
      }
    }catch(error){
      console.error(error);
      alert("The saved sales for this date could not be loaded.");
    }
  }

  loadModalOptions();
  renderSalesTable();
  updateSummary();
  updateSalesRecord();
}


function getSelectedMonthDetails(){
  const dateValue =
    document.getElementById("date")?.value || "";

  const match =
    /^(\d{4})-(\d{2})-\d{2}$/.exec(dateValue);

  if(!match){
    return {
      year: "",
      month: "",
      prefix: "",
      label: "Selected month"
    };
  }

  const year =
    match[1];

  const month =
    match[2];

  return {
    year: year,
    month: month,
    prefix: `${year}-${month}-`,
    label:
      new Date(
        Number(year),
        Number(month) - 1,
        1
      ).toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric"
      })
  };
}

function getMonthlyRevenue(branchName, monthPrefix){
  if(!branchName || !monthPrefix){
    return 0;
  }

  const storagePrefix =
    `${STORAGE_PREFIX}${branchName}_${monthPrefix}`;

  let total = 0;

  for(let index = 0; index < localStorage.length; index += 1){
    const key =
      localStorage.key(index);

    if(!key || !key.startsWith(storagePrefix)){
      continue;
    }

    total +=
      calculateSavedDayTotal(
        localStorage.getItem(key)
      );
  }

  return total;
}

function getSaleCategoryBreakdown(sale){
  const items =
    Array.isArray(sale?.services)
      ? sale.services
      : [];

  const gross = { services: 0, vipCards: 0, products: 0 };

  items.forEach(function(item){
    const amount =
      Math.max(0, Number(item?.amount) || 0);

    if(isVipCardName(item?.name)){
      gross.vipCards += amount;
    }else if(item?.itemType === "Service"){
      gross.services += amount;
    }else{
      gross.products += amount;
    }
  });

  const grossTotal =
    gross.services + gross.vipCards + gross.products;

  const voucherValue =
    Math.min(
      grossTotal,
      Math.max(0, Number(sale?.voucherValue) || 0)
    );

  const net = { services: gross.services, vipCards: gross.vipCards, products: gross.products };

  if(voucherValue <= 0 || grossTotal <= 0){
    return net;
  }

  /*
    A voucher only ever discounts the category it was actually redeemed
    against (e.g. the Executive Voucher waives Services only — Products
    must stay untouched). Only the part of voucherValue that can't be
    attributed to a specific category (legacy rows with no itemType, or a
    targeted amount bigger than that category's own gross) falls back to
    a proportional split across whatever's left, same as before.
  */
  const targeted = { services: 0, vipCards: 0, products: 0 };

  (Array.isArray(sale?.vouchers) ? sale.vouchers : []).forEach(function(voucher){
    const value =
      Math.max(0, Number(voucher?.value) || 0);

    if(!value){
      return;
    }

    if(
      voucher?.isExecutive === true ||
      voucher?.itemType === "Executive" ||
      voucher?.itemType === "Service"
    ){
      targeted.services += value;
    }else if(voucher?.itemType === "Product"){
      if(isVipCardName(voucher?.name)){
        targeted.vipCards += value;
      }else{
        targeted.products += value;
      }
    }
  });

  let directlyDeducted = 0;

  ["services", "vipCards", "products"].forEach(function(key){
    const take = Math.min(net[key], targeted[key]);
    net[key] -= take;
    directlyDeducted += take;
  });

  const leftover =
    Math.min(
      grossTotal - directlyDeducted,
      voucherValue - directlyDeducted
    );

  if(leftover > 0){
    const remainingGross =
      net.services + net.vipCards + net.products;

    if(remainingGross > 0){
      const ratio =
        Math.max(0, remainingGross - leftover) / remainingGross;

      net.services *= ratio;
      net.vipCards *= ratio;
      net.products *= ratio;
    }
  }

  return net;
}

function updateSummary(){
  const paymentTotals = {
    Cash: 0,
    GCash: 0,
    "Bank Transfer": 0,
    Terminal: 0
  };

  const salesTotals = {
    services: 0,
    vipCards: 0,
    products: 0
  };

  const settledSales =
    salesRows.filter(function(sale){
      return sale.settled !== false;
    });

  let clientCount = 0;

  const serviceCategoryMap =
    getServiceCategoryMap();

  const kpiSalesCounts = {
    "Head Spa": 0,
    "Massage": 0,
    "Package": 0,
    "Add-on": 0,
    "Kiddie": 0
  };

  let kpiProductsCount = 0;
  let kpiVipCardCount = 0;

  const kpiSourceCounts = {
    "Facebook": 0,
    "Walk-in": 0,
    "Referral": 0,
    "Returning": 0
  };

  settledSales.forEach(function(sale){
    const netTotal =
      calculateSaleTotal(sale);

    const categoryBreakdown =
      getSaleCategoryBreakdown(sale);

    salesTotals.services += categoryBreakdown.services;
    salesTotals.vipCards += categoryBreakdown.vipCards;
    salesTotals.products += categoryBreakdown.products;

    const salePayments =
      getSalePayments(sale);

    if(salePayments.length){
      salePayments.forEach(function(payment){
        if(paymentTotals[payment.method] !== undefined){
          paymentTotals[payment.method] +=
            Number(payment.amount) || 0;
        }
      });
    }else if(paymentTotals[sale.payment] !== undefined){
      paymentTotals[sale.payment] += netTotal;
    }

    clientCount +=
      1 + getSaleCompanionCount(sale);

    (Array.isArray(sale.services) ? sale.services : []).forEach(function(item){
      const quantity =
        Math.max(1, Number(item?.quantity) || 1);

      if(isVipCardName(item?.name)){
        kpiVipCardCount += quantity;
      }else if(item?.itemType === "Service"){
        const category =
          serviceCategoryMap[String(item?.name || "").trim().toLowerCase()];

        if(kpiSalesCounts[category] !== undefined){
          kpiSalesCounts[category] += quantity;
        }
      }else if(item?.itemType === "Product"){
        kpiProductsCount += quantity;
      }
    });

    const saleSource =
      sale.source || "Walk-in";

    if(kpiSourceCounts[saleSource] !== undefined){
      kpiSourceCounts[saleSource] += 1;
    }
  });

  renderDailyKpi(
    kpiSalesCounts,
    kpiProductsCount,
    kpiVipCardCount,
    kpiSourceCounts,
    clientCount
  );

  const paymentTotal =
    paymentTotals.Cash +
    paymentTotals.GCash +
    paymentTotals["Bank Transfer"] +
    paymentTotals.Terminal;

  const salesBreakdownTotal =
    salesTotals.services +
    salesTotals.vipCards +
    salesTotals.products;

  const transactionCount =
    settledSales.length;

  const averageTicket =
    transactionCount > 0
      ? paymentTotal / transactionCount
      : 0;

  document.getElementById("cash").textContent =
    peso(paymentTotals.Cash);

  document.getElementById("gcash").textContent =
    peso(paymentTotals.GCash);

  document.getElementById("bank").textContent =
    peso(paymentTotals["Bank Transfer"]);

  document.getElementById("terminal").textContent =
    peso(paymentTotals.Terminal);

  document.getElementById("paymentBreakdownTotal").textContent =
    peso(paymentTotal);

  document.getElementById("totalServicesSales").textContent =
    peso(salesTotals.services);

  document.getElementById("totalVipCardSales").textContent =
    peso(salesTotals.vipCards);

  document.getElementById("totalProductSales").textContent =
    peso(salesTotals.products);

  document.getElementById("salesBreakdownTotal").textContent =
    peso(salesBreakdownTotal);

  const totalElement =
    document.getElementById("total");

  if(totalElement){
    totalElement.textContent =
      peso(paymentTotal);
  }

  const summaryTransactionsElement =
    document.getElementById("summaryTransactions");

  if(summaryTransactionsElement){
    summaryTransactionsElement.textContent =
      transactionCount.toLocaleString("en-PH");
  }

  const summaryClientsElement =
    document.getElementById("summaryClients");

  if(summaryClientsElement){
    summaryClientsElement.textContent =
      clientCount.toLocaleString("en-PH");
  }

  const summaryAverageTicketElement =
    document.getElementById("summaryAverageTicket");

  if(summaryAverageTicketElement){
    summaryAverageTicketElement.textContent =
      peso(averageTicket);
  }

  const selectedMonth =
    getSelectedMonthDetails();

  const monthlyRevenue =
    getMonthlyRevenue(
      getSelectedBranch(),
      selectedMonth.prefix
    );

  const monthlyRevenueElement =
    document.getElementById("monthlyRevenue");

  const monthlyRevenueLabel =
    document.getElementById("monthlyRevenueLabel");

  if(monthlyRevenueElement){
    monthlyRevenueElement.textContent =
      peso(monthlyRevenue);
  }

  if(monthlyRevenueLabel){
    monthlyRevenueLabel.textContent =
      selectedMonth.label;
  }
}

function clearDailySales(){
  if(
    !confirm(
      `Clear all saved sales for ${getSelectedBranch()} - ${formatDate(
        document.getElementById("date").value
      )}?`
    )
  ){
    return;
  }

  salesRows.forEach(function(sale){
    removeSaleFromStockAudit(sale.id);
  });

  localStorage.removeItem(getStorageKey());
  salesRows = [];

  renderSalesTable();
  updateSummary();
  renderCalendar();
  updateSalesRecord();

  alert("Saved data for this branch and date has been cleared.");
}


/* ==========================================================================
   SALES RECORD
   ========================================================================== */

function calculateSaleTotal(sale){
  if(!sale){
    return 0;
  }

  if(sale.netAmount !== undefined){
    return Math.max(
      0,
      Number(sale.netAmount) || 0
    );
  }

  const grossAmount =
    sale.grossAmount !== undefined
      ? Number(sale.grossAmount) || 0
      : (sale.services || [])
          .reduce(function(sum, item){
            return sum + Number(item?.amount || 0);
          }, 0);

  const voucherValue =
    Math.max(
      0,
      Number(sale.voucherValue) || 0
    );

  return Math.max(
    0,
    grossAmount -
    Math.min(grossAmount, voucherValue)
  );
}

function calculateSavedDayTotal(rawData){
  try{
    const parsed =
      typeof rawData === "string"
        ? JSON.parse(rawData)
        : rawData;

    if(!parsed || !Array.isArray(parsed.rows)){
      return 0;
    }

    return parsed.rows
      .filter(function(sale){
        return sale?.settled !== false;
      })
      .reduce(function(total, sale){
        return total + calculateSaleTotal(sale);
      }, 0);
  }catch(error){
    return 0;
  }
}

function getBranchSalesRecord(){
  const branch =
    getSelectedBranch();

  if(!branch){
    return {
      date: "",
      amount: 0
    };
  }

  const keyPrefix =
    `${STORAGE_PREFIX}${branch}_`;

  let recordDate = "";
  let recordAmount = 0;

  for(let index = 0; index < localStorage.length; index++){
    const key =
      localStorage.key(index);

    if(
      !key ||
      !key.startsWith(keyPrefix)
    ){
      continue;
    }

    const date =
      key.slice(keyPrefix.length);

    const amount =
      calculateSavedDayTotal(
        localStorage.getItem(key)
      );

    if(
      amount > recordAmount ||
      (
        amount === recordAmount &&
        amount > 0 &&
        date > recordDate
      )
    ){
      recordAmount = amount;
      recordDate = date;
    }
  }

  return {
    date: recordDate,
    amount: recordAmount
  };
}

function getCurrentSelectedDayTotal(){
  return salesRows
    .filter(function(sale){
      return sale?.settled !== false;
    })
    .reduce(function(total, sale){
      return total + calculateSaleTotal(sale);
    }, 0);
}

function formatRecordDate(dateValue){
  if(!dateValue){
    return "No saved sales record yet";
  }

  return new Date(`${dateValue}T00:00:00`)
    .toLocaleDateString("en-PH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
}

function updateSalesRecord(){
  const amountElement =
    document.getElementById("recordSalesAmount");

  if(!amountElement){
    return;
  }

  const selectedDate =
    document.getElementById("date").value;

  const record =
    getBranchSalesRecord();

  const selectedTotal =
    getCurrentSelectedDayTotal();

  const selectedIsRecordDate =
    record.date &&
    selectedDate === record.date;

  const comparisonBase =
    record.amount > 0
      ? record.amount
      : selectedTotal;

  const percentage =
    comparisonBase > 0
      ? Math.min(
          100,
          Math.round(
            (selectedTotal / comparisonBase) * 100
          )
        )
      : 0;

  document.getElementById("recordSalesAmount").textContent =
    peso(record.amount);

  document.getElementById("recordSalesDate").textContent =
    formatRecordDate(record.date);

  document.getElementById("selectedDaySalesAmount").textContent =
    peso(selectedTotal);

  document.getElementById("recordPercentage").textContent =
    `${percentage}%`;

  document.getElementById("recordProgressBar").style.width =
    `${percentage}%`;

  const message =
    document.getElementById("recordMessage");

  const badge =
    document.getElementById("newRecordBadge");

  const card =
    document.getElementById("salesRecordCard");

  badge.classList.add("d-none");
  card.classList.remove("record-achieved");

  if(record.amount <= 0){
    message.textContent =
      "Add and save sales to establish the branch record.";

    return;
  }

  if(
    selectedIsRecordDate &&
    selectedTotal >= record.amount &&
    selectedTotal > 0
  ){
    message.textContent =
      "This selected day currently holds the branch sales record.";

    badge.classList.remove("d-none");
    card.classList.add("record-achieved");

    return;
  }

  if(selectedTotal >= record.amount){
    message.textContent =
      "This day has reached or exceeded the current record. Save the report to confirm it.";

    badge.classList.remove("d-none");
    card.classList.add("record-achieved");

    return;
  }

  const remaining =
    Math.max(
      0,
      record.amount - selectedTotal
    );

  message.textContent =
    `${peso(remaining)} remaining to match the record.`;
}


/* PDF EXPORT */

function sanitizePdfFilename(value){
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPdfMoney(value){
  return (
    "PHP " +
    Number(value || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

function getPdfParticipantRows(sale){
  const items =
    Array.isArray(sale?.services)
      ? sale.services.filter(function(item){
          return Boolean(String(item?.name || "").trim());
        })
      : [];

  const principalItems =
    items.filter(function(item){
      return (
        !item.participantType ||
        item.participantType === "Principal"
      );
    });

  const participants = [
    {
      name: sale?.client || "—",
      therapist:
        principalItems
          .filter(function(item){
            return item?.itemType === "Service";
          })
          .map(function(item){
            return item?.therapist || sale?.therapist;
          })
          .filter(Boolean)[0] ||
        sale?.therapist ||
        "N/A",
      items: principalItems,
      label: sale?.vip === true ? "VIP Client" : ""
    }
  ];

  const companionMap =
    new Map();

  if(Array.isArray(sale?.companions)){
    sale.companions.forEach(function(companion, index){
      const name =
        String(
          companion?.name ||
          `Companion ${index + 1}`
        ).trim();

      const companionItems =
        Array.isArray(companion?.items)
          ? companion.items.filter(function(item){
              return Boolean(String(item?.name || "").trim());
            })
          : items.filter(function(item){
              return (
                item?.participantType === "Companion" &&
                item?.participantName === name
              );
            });

      companionMap.set(name, {
        name: name,
        therapist:
          companionItems
            .filter(function(item){
              return item?.itemType === "Service";
            })
            .map(function(item){
              return item?.therapist || companion?.therapist;
            })
            .filter(Boolean)[0] ||
          companion?.therapist ||
          "N/A",
        items: companionItems,
        label: "Companion"
      });
    });
  }

  items
    .filter(function(item){
      return item?.participantType === "Companion";
    })
    .forEach(function(item){
      const name =
        item?.participantName || "Companion";

      if(!companionMap.has(name)){
        companionMap.set(name, {
          name: name,
          therapist:
            item?.itemType === "Service"
              ? (item?.therapist || "N/A")
              : "N/A",
          items: [],
          label: "Companion"
        });
      }

      const participant =
        companionMap.get(name);

      if(!participant.items.includes(item)){
        participant.items.push(item);
      }
    });

  participants.push(
    ...Array.from(companionMap.values())
  );

  return participants;
}

function getPdfItemLabel(item){
  const quantity =
    item?.itemType === "Product" &&
    Number(item?.quantity) > 1
      ? ` x${Number(item.quantity)}`
      : "";

  const prefix =
    item?.productKind === "Service Voucher"
      ? "Voucher: "
      : "";

  return (
    prefix +
    String(item?.name || "Item") +
    quantity
  );
}

function getPdfVoucherText(sale){
  if(sale?.executiveVoucher === true){
    return "Executive Voucher applied";
  }

  const voucherValue =
    Math.max(0, Number(sale?.voucherValue) || 0);

  if(voucherValue > 0){
    return (
      "Voucher: -" +
      formatPdfMoney(voucherValue)
    );
  }

  return "";
}

function getPdfPaymentText(sale){
  const payments =
    getSalePayments(sale);

  const voucherText =
    getPdfVoucherText(sale);

  const lines =
    payments.map(function(payment){
      return (
        `${payment.method}: ` +
        formatPdfMoney(payment.amount)
      );
    });

  if(lines.length === 0){
    if(voucherText){
      lines.push("No cash payment");
    }else{
      lines.push(
        `${sale?.payment || "Unspecified"}: ` +
        formatPdfMoney(calculateSaleTotal(sale))
      );
    }
  }

  if(voucherText){
    lines.push(voucherText);
  }

  return lines.join("\n");
}

function buildPdfTableRows(){
  const rows = [];

  salesRows
    .filter(function(sale){
      return sale?.settled !== false;
    })
    .forEach(function(sale, saleIndex){
      const participants =
        getPdfParticipantRows(sale);

      const participantText =
        participants
          .map(function(participant){
            return (
              participant.name +
              (
                participant.label
                  ? ` (${participant.label})`
                  : ""
              )
            );
          })
          .join("\n");

      const therapistText =
        participants
          .map(function(participant){
            return participant.therapist || "N/A";
          })
          .join("\n");

      const itemsText =
        participants
          .map(function(participant){
            const labels =
              participant.items
                .map(getPdfItemLabel)
                .join(", ");

            return (
              `${participant.name}: ` +
              (labels || "—")
            );
          })
          .join("\n");

      rows.push([
        String(saleIndex + 1),
        formatDailyScheduleTime(
          sale?.startTime || "00:00"
        ),
        participantText,
        therapistText,
        itemsText,
        formatPdfMoney(
          calculateSaleTotal(sale)
        ),
        getPdfPaymentText(sale)
      ]);
    });

  return rows;
}

function getPdfSummaryValues(){
  const paymentTotals = {
    Cash: 0,
    GCash: 0,
    "Bank Transfer": 0,
    Terminal: 0
  };

  const salesTotals = {
    services: 0,
    vipCards: 0,
    products: 0
  };

  const settledSales =
    salesRows.filter(function(sale){
      return sale?.settled !== false;
    });

  settledSales.forEach(function(sale){
    const netTotal =
      calculateSaleTotal(sale);

    const categoryBreakdown =
      getSaleCategoryBreakdown(sale);

    salesTotals.services += categoryBreakdown.services;
    salesTotals.vipCards += categoryBreakdown.vipCards;
    salesTotals.products += categoryBreakdown.products;

    const payments =
      getSalePayments(sale);

    if(payments.length){
      payments.forEach(function(payment){
        if(paymentTotals[payment.method] !== undefined){
          paymentTotals[payment.method] +=
            Number(payment.amount) || 0;
        }
      });
    }else if(paymentTotals[sale?.payment] !== undefined){
      paymentTotals[sale.payment] += netTotal;
    }
  });

  return {
    paymentTotals: paymentTotals,
    salesTotals: salesTotals,
    totalPayments:
      Object.values(paymentTotals)
        .reduce(function(sum, value){
          return sum + value;
        }, 0),
    totalSales:
      salesTotals.services +
      salesTotals.vipCards +
      salesTotals.products
  };
}

function drawPdfSummary(doc, startY, summary){
  const pageWidth =
    doc.internal.pageSize.getWidth();

  const margin = 12;
  const gap = 6;
  const boxWidth =
    (pageWidth - margin * 2 - gap) / 2;

  const boxHeight = 52;

  function drawBox(x, title, rows){
    doc.setDrawColor(216, 222, 232);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(
      x,
      startY,
      boxWidth,
      boxHeight,
      2,
      2,
      "FD"
    );

    doc.setTextColor(23, 52, 93);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(
      title,
      x + 5,
      startY + 7
    );

    let rowY =
      startY + 15;

    rows.forEach(function(row, index){
      if(index === rows.length - 1){
        doc.setDrawColor(200, 207, 218);
        doc.line(
          x + 5,
          rowY - 3,
          x + boxWidth - 5,
          rowY - 3
        );
      }

      doc.setFont("helvetica", "normal");
      doc.setTextColor(92, 104, 123);
      doc.setFontSize(8);
      doc.text(
        row[0],
        x + 5,
        rowY
      );

      doc.setFont("helvetica", "bold");
      doc.setTextColor(23, 32, 51);
      doc.text(
        row[1],
        x + boxWidth - 5,
        rowY,
        { align: "right" }
      );

      rowY += 7;
    });
  }

  drawBox(
    margin,
    "Payment Breakdown",
    [
      ["Cash", formatPdfMoney(summary.paymentTotals.Cash)],
      ["GCash", formatPdfMoney(summary.paymentTotals.GCash)],
      ["Bank Transfer", formatPdfMoney(summary.paymentTotals["Bank Transfer"])],
      ["Terminal", formatPdfMoney(summary.paymentTotals.Terminal)],
      ["Total Payments", formatPdfMoney(summary.totalPayments)]
    ]
  );

  drawBox(
    margin + boxWidth + gap,
    "Sales Breakdown",
    [
      ["Total Services", formatPdfMoney(summary.salesTotals.services)],
      ["Total VIP Card", formatPdfMoney(summary.salesTotals.vipCards)],
      ["Total Product Sales", formatPdfMoney(summary.salesTotals.products)],
      ["Total Sales", formatPdfMoney(summary.totalSales)]
    ]
  );

  return startY + boxHeight;
}

/* Sinong account ang nag-generate ng report — ito ang lalabas
   bilang pirma sa PDF at sa footer ng bawat pahina. */
function getPdfPreparedBy(){
  let session = null;

  try{
    session =
      window.CrownAuth &&
      typeof window.CrownAuth.getCurrentUser === "function"
        ? window.CrownAuth.getCurrentUser()
        : null;
  }catch(error){
    session = null;
  }

  const account =
    String(session?.account || "").trim();

  const role =
    String(session?.role || "").trim();

  const secondaryRole =
    String(session?.secondaryRole || "").trim();

  return {
    account: account,
    role: [role, secondaryRole]
      .filter(Boolean)
      .join(" / ")
  };
}

function formatPdfGeneratedAt(value){
  return new Date(value)
    .toLocaleString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
}

const PDF_SIGNATURE_HEIGHT = 24;

function drawPdfSignature(doc, startY, generatedAt){
  const pageWidth =
    doc.internal.pageSize.getWidth();

  const margin = 12;
  const lineWidth = 78;
  const lineX = pageWidth - margin - lineWidth;
  const lineY = startY + 13;

  const preparedBy =
    getPdfPreparedBy();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(110, 120, 136);
  doc.text(
    "Prepared by",
    lineX,
    startY + 4
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(23, 52, 93);
  doc.text(
    preparedBy.account || "—",
    lineX,
    lineY - 2.5
  );

  doc.setDrawColor(150, 160, 176);
  doc.setLineWidth(0.3);
  doc.line(
    lineX,
    lineY,
    lineX + lineWidth,
    lineY
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(92, 104, 123);
  doc.text(
    preparedBy.role
      ? `${preparedBy.role} — Signature over printed name`
      : "Signature over printed name",
    lineX,
    lineY + 4.5
  );

  doc.setFontSize(7);
  doc.setTextColor(110, 120, 136);
  doc.text(
    `Generated on ${formatPdfGeneratedAt(generatedAt)}`,
    lineX,
    lineY + 9
  );

  doc.setLineWidth(0.2);
}

function addPdfPageFooter(doc, generatedAt){
  const pageCount =
    doc.internal.getNumberOfPages();

  for(let page = 1; page <= pageCount; page += 1){
    doc.setPage(page);

    const width =
      doc.internal.pageSize.getWidth();

    const height =
      doc.internal.pageSize.getHeight();

    doc.setDrawColor(220, 225, 233);
    doc.line(
      12,
      height - 9,
      width - 12,
      height - 9
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(110, 120, 136);

    doc.text(
      "CrownOS Daily Income Report",
      12,
      height - 5
    );

    const preparedBy =
      getPdfPreparedBy();

    if(preparedBy.account){
      doc.text(
        `Generated by ${preparedBy.account}` +
        (preparedBy.role ? ` (${preparedBy.role})` : "") +
        ` — ${formatPdfGeneratedAt(generatedAt)}`,
        width / 2,
        height - 5,
        { align: "center" }
      );
    }

    doc.text(
      `Page ${page} of ${pageCount}`,
      width - 12,
      height - 5,
      { align: "right" }
    );
  }
}

function exportPDF(){
  if(!getSelectedBranch()){
    alert("Please select a branch first.");
    return;
  }

  if(
    !window.jspdf ||
    !window.jspdf.jsPDF
  ){
    alert(
      "PDF library is unavailable. Please check your internet connection and reload the page."
    );
    return;
  }

  saveDailySales();

  const button =
    document.getElementById("pdfBtn");

  if(button){
    button.disabled = true;
    button.textContent = "Generating PDF...";
  }

  try{
    const jsPDF =
      window.jspdf.jsPDF;

    const doc =
      new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
        compress: true
      });

    const branch =
      getSelectedBranch();

    const date =
      document.getElementById("date").value ||
      new Date().toISOString().slice(0, 10);

    const summary =
      getPdfSummaryValues();

    const generatedAt =
      new Date();

    const pageWidth =
      doc.internal.pageSize.getWidth();

    doc.setFillColor(23, 52, 93);
    doc.rect(
      0,
      0,
      pageWidth,
      27,
      "F"
    );

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(
      "CROWN HEAD SPA",
      12,
      11
    );

    doc.setFontSize(11);
    doc.text(
      "Daily Income Report",
      12,
      19
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      branch,
      pageWidth - 12,
      10,
      { align: "right" }
    );

    doc.text(
      formatDate(date),
      pageWidth - 12,
      16,
      { align: "right" }
    );

    const tableRows =
      buildPdfTableRows();

    if(tableRows.length === 0){
      doc.setTextColor(91, 102, 119);
      doc.setFontSize(11);
      doc.text(
        "No settled transactions found for the selected date.",
        12,
        39
      );

      const summaryBottom =
        drawPdfSummary(
          doc,
          50,
          summary
        );

      drawPdfSignature(
        doc,
        summaryBottom + 10,
        generatedAt
      );
    }else{
      doc.autoTable({
        startY: 33,
        head: [[
          "#",
          "Time",
          "Client",
          "Therapist",
          "Services / Products",
          "Total Amount",
          "Payment"
        ]],
        body: tableRows,
        theme: "grid",
        margin: {
          top: 18,
          left: 10,
          right: 10,
          bottom: 15
        },
        styles: {
          font: "helvetica",
          fontSize: 7,
          cellPadding: 2.2,
          valign: "middle",
          overflow: "linebreak",
          textColor: [32, 43, 60],
          lineColor: [216, 222, 232],
          lineWidth: 0.15
        },
        headStyles: {
          fillColor: [47, 87, 137],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          halign: "center",
          fontSize: 7.5
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        columnStyles: {
          0: { cellWidth: 8, halign: "center" },
          1: { cellWidth: 19, halign: "center" },
          2: { cellWidth: 44 },
          3: { cellWidth: 34 },
          4: { cellWidth: 89 },
          5: { cellWidth: 30, halign: "right" },
          6: { cellWidth: 49 }
        },
        didDrawPage: function(data){
          if(data.pageNumber > 1){
            doc.setFillColor(23, 52, 93);
            doc.rect(
              0,
              0,
              pageWidth,
              14,
              "F"
            );

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.text(
              `${branch} — Daily Income Report`,
              10,
              9
            );

            doc.setFont("helvetica", "normal");
            doc.text(
              formatDate(date),
              pageWidth - 10,
              9,
              { align: "right" }
            );
          }
        }
      });

      let summaryY =
        doc.lastAutoTable.finalY + 8;

      const pageHeight =
        doc.internal.pageSize.getHeight();

      if(
        summaryY + 62 + PDF_SIGNATURE_HEIGHT >
        pageHeight - 12
      ){
        doc.addPage();
        summaryY = 22;
      }

      const summaryBottom =
        drawPdfSummary(
          doc,
          summaryY,
          summary
        );

      drawPdfSignature(
        doc,
        summaryBottom + 10,
        generatedAt
      );
    }

    addPdfPageFooter(doc, generatedAt);

    const filename =
      sanitizePdfFilename(
        `${branch} - ${date} Daily Income Report`
      ) + ".pdf";

    doc.save(filename);
  }catch(error){
    console.error(error);
    alert(
      "Unable to generate the PDF report. Please reload the page and try again."
    );
  }finally{
    if(button){
      button.disabled = false;
      button.textContent = "Export as PDF";
    }
  }
}

/* ==========================================================================
   Voucher Registry — official voucher numbers

   Every generated voucher gets a unique code stored in
   crownVoucherRegistry (synced to the cloud like all crown* keys).
   Redemption requires the code; a code can only be used once.
   ========================================================================== */

const VOUCHER_REGISTRY_KEY = "crownVoucherRegistry";

/* Unambiguous alphabet: walang 0/O, 1/I/L para hindi malito sa sulat-kamay */
const VOUCHER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function getVoucherRegistry(){
  try{
    const raw = localStorage.getItem(VOUCHER_REGISTRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(error){
    console.error("Unable to load voucher registry:", error);
    return [];
  }
}

function saveVoucherRegistry(registry){
  localStorage.setItem(
    VOUCHER_REGISTRY_KEY,
    JSON.stringify(registry)
  );
}

function normalizeVoucherCode(value){
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function generateVoucherCode(extraReservedCodes){
  const registry = getVoucherRegistry();
  const reserved = extraReservedCodes || new Set();

  for(let attempt = 0; attempt < 50; attempt++){
    let body = "";

    for(let i = 0; i < 8; i++){
      body += VOUCHER_CODE_ALPHABET.charAt(
        Math.floor(Math.random() * VOUCHER_CODE_ALPHABET.length)
      );
    }

    const code =
      "CHS-" + body.slice(0, 4) + "-" + body.slice(4);

    const exists =
      reserved.has(code) ||
      registry.some(function(entry){
        return entry.code === code;
      });

    if(!exists){
      return code;
    }
  }

  return "CHS-" + Date.now().toString(36).toUpperCase();
}

function findVoucherRegistryEntry(code){
  const normalized = normalizeVoucherCode(code);

  if(!normalized){
    return null;
  }

  return getVoucherRegistry().find(function(entry){
    return entry.code === normalized;
  }) || null;
}

/* ---------- Generator dialog ---------- */

function openVoucherGenerator(){
  const select =
    document.getElementById("voucherGenSelect");

  const voucherItems = getVoucherItems();

  if(voucherItems.length === 0){
    alert(
      "No voucher-enabled services or products found.\n\n" +
      "Enable vouchers and set voucher prices in the Service Master first."
    );
    return;
  }

  select.innerHTML =
    '<option value="">Select Voucher</option>' +
    voucherItems.map(function(item){
      const tierLabel = item.tier ? ` (${item.tier})` : "";
      return `
        <option value="${escapeHtml(getVoucherItemKey(item))}">
          ${escapeHtml(item.itemType)} — ${escapeHtml(item.name)}${escapeHtml(tierLabel)} — ${peso(item.voucherValue)}
        </option>
      `;
    }).join("");

  document.getElementById("voucherGenClient").value =
    document.getElementById("modalClientInput")?.value.trim() || "";

  document.getElementById("voucherGenBackdrop")
    .classList.remove("d-none");
}

function closeVoucherGenerator(){
  document.getElementById("voucherGenBackdrop")
    .classList.add("d-none");
}

/* Codes already reserved by pending (not-yet-official) voucher purchases
   sitting on today's sales and in the modal currently being edited — kept
   out of the Voucher Masterlist registry until Settle, so
   generateVoucherCode() alone wouldn't see them and could hand out the
   same code twice. */
function getPendingVoucherCodes(){
  const codes = new Set();

  const collect = function(items){
    (items || []).forEach(function(item){
      if(item.productKind === "Service Voucher" && item.voucherCode && !item.voucherOfficial){
        codes.add(normalizeVoucherCode(item.voucherCode));
      }
    });
  };

  collect(modalItems);

  (salesRows || []).forEach(function(sale){
    collect(sale.services);
  });

  return codes;
}

function generateVoucherFromDialog(){
  const selectValue =
    document.getElementById("voucherGenSelect").value;

  const item =
    findVoucherItem(selectValue);

  if(!item){
    alert("Please select a voucher item first.");
    return;
  }

  const clientInput =
    document.getElementById("voucherGenClient");

  const clientName =
    clientInput.value.trim();

  if(!clientName){
    alert("Please enter the buyer / client name first. It will be printed on the voucher.");
    clientInput.focus();
    return;
  }

  const code =
    generateVoucherCode(getPendingVoucherCodes());

  /* Not written to the Voucher Masterlist registry yet — this code is
     only reserved. It becomes an official registry entry (and its PDF
     gets generated) in finalizeSaleVouchers(), which runs when this
     sale is Settled. Until then it just rides along on the sale item. */

  /* Add the voucher purchase as a product line on this sale —
     same shape as the existing "Voucher — X" virtual products. */
  const tierLabel =
    item.tier ? ` (${item.tier})` : "";

  modalItems.push({
    id: createId(),
    itemType: "Product",
    name: `Voucher — ${item.name}${tierLabel}`,
    priceType: "Regular",
    quantity: 1,
    unitPrice: Number(item.voucherValue) || 0,
    amount: Number(item.voucherValue) || 0,
    manualAmount: false,
    manualUnitPrice: false,
    productKind: "Service Voucher",
    sourceServiceName: item.itemType === "Service" ? item.name : "",
    voucherCode: code,
    voucherOfficial: false,
    voucherClient: clientName,
    voucherItemType: item.itemType,
    voucherItemName: item.name,
    voucherTier: item.tier || "",
    voucherValue: Number(item.voucherValue) || 0
  });

  renderModalItems();
  updateModalTotal();

  closeVoucherGenerator();
}

/* ---------- Sale-settle finalization ----------
   Turns every still-pending ("not yet official") voucher purchase on a
   just-settled sale into a real Voucher Masterlist entry — the code was
   already reserved when it was added to the sale, so this keeps that
   same code rather than minting a new one. Mutates the sale's items in
   place (voucherOfficial: true) so re-settling the same sale later
   doesn't finalize them twice. Returns the newly-finalized entries so
   the caller can hand them straight to the PDF download. */
function finalizeSaleVouchers(saleData){
  const pendingItems =
    (saleData.services || []).filter(function(item){
      return (
        item.productKind === "Service Voucher" &&
        item.voucherCode &&
        !item.voucherOfficial
      );
    });

  if(pendingItems.length === 0){
    return [];
  }

  const registry =
    getVoucherRegistry();

  const branch =
    localStorage.getItem("crownSelectedBranch") || "";

  const issuedBy =
    window.CrownAuth?.getCurrentUser?.()?.account || "";

  const newlyOfficial = [];

  pendingItems.forEach(function(item){
    const issuedAt = new Date().toISOString();

    const registryEntry = {
      code: normalizeVoucherCode(item.voucherCode),
      itemType: item.voucherItemType || "",
      name: item.voucherItemName || "",
      tier: item.voucherTier || "",
      value: Number(item.voucherValue) || 0,
      client: item.voucherClient || "",
      branch: branch,
      issuedAt: issuedAt,
      expiresAt: crownVoucherExpiresAt(issuedAt),
      issuedBy: issuedBy,
      status: "active",
      redeemedAt: "",
      redeemedSaleId: "",
      redeemedBranch: ""
    };

    registry.push(registryEntry);
    newlyOfficial.push(registryEntry);

    item.voucherOfficial = true;
  });

  saveVoucherRegistry(registry);

  return newlyOfficial;
}

/* ---------- Redemption validation ---------- */

/* Returns "" when OK, or an error message. */
function getVoucherCodeStatus(voucher){
  if(voucher.legacy){
    return "";
  }

  const code =
    normalizeVoucherCode(voucher.code);

  if(!code){
    return "Please enter the voucher number for every voucher used as payment.";
  }

  const entry =
    findVoucherRegistryEntry(code);

  if(!entry){
    return `Voucher ${code} was not found in the system.`;
  }

  if(entry.status === "cancelled"){
    return `Voucher ${code} has been voided and can no longer be used.`;
  }

  if(
    entry.status === "redeemed" &&
    entry.redeemedSaleId !== (editingSaleId || "")
  ){
    return `Voucher ${code} has already been used.`;
  }

  if(entry.status === "active" && isCrownVoucherExpired(entry)){
    return `Voucher ${code} expired on ${crownVoucherDateLabel(entry.expiresAt)} and can no longer be used.`;
  }

  return "";
}

function validateModalVoucherCodes(){
  for(const voucher of modalVouchers){
    if(!voucher.name){
      continue;
    }

    const error =
      getVoucherCodeStatus(voucher);

    if(error){
      return error;
    }
  }

  return "";
}

/* After a sale saves: mark its voucher codes as redeemed, and release
   any codes this sale previously used but no longer does. */
function syncVoucherRedemptions(sale){
  const registry =
    getVoucherRegistry();

  const codesInSale = new Set(
    (sale.vouchers || [])
      .map(function(voucher){
        return normalizeVoucherCode(voucher.code);
      })
      .filter(Boolean)
  );

  let changed = false;

  registry.forEach(function(entry){
    if(codesInSale.has(entry.code)){
      if(
        entry.status !== "redeemed" ||
        entry.redeemedSaleId !== sale.id
      ){
        entry.status = "redeemed";
        entry.redeemedSaleId = sale.id;
        entry.redeemedAt = new Date().toISOString();
        entry.redeemedBranch =
          localStorage.getItem("crownSelectedBranch") || "";
        changed = true;
      }
    }else if(entry.redeemedSaleId === sale.id){
      entry.status = "active";
      entry.redeemedSaleId = "";
      entry.redeemedAt = "";
      entry.redeemedBranch = "";
      changed = true;
    }
  });

  if(changed){
    saveVoucherRegistry(registry);
  }
}
