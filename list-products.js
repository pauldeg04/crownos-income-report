const PRODUCT_KEY = "crownProductMasterList";

const DEFAULT_PRODUCTS = [
    {
        name: "VIP Card",
        category: "Membership",
        code: "VIP-CARD",
        sellingPrice: 500
    }
];

let products = [];
let editingProductId = null;

document.addEventListener("DOMContentLoaded", function(){
    loadProducts();

    if(products.length === 0){
        seedDefaultProducts();
    }else{
        migrateExistingProducts();
    }

    attachEvents();
    populateCategoryFilter();
    renderProducts();
});

function attachEvents(){
    document
        .getElementById("addProductBtn")
        .addEventListener("click", openAddModal);

    document
        .getElementById("closeModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("cancelModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("saveProductBtn")
        .addEventListener("click", saveProduct);

    document
        .getElementById("productSearch")
        .addEventListener("input", renderProducts);

    document
        .getElementById("categoryFilter")
        .addEventListener("change", renderProducts);

    document
        .getElementById("statusFilter")
        .addEventListener("change", renderProducts);

    document
        .querySelectorAll(".product-tab")
        .forEach(function(tab){
            tab.addEventListener("click", function(){
                activateTab(this.dataset.tab);
            });
        });

    document
        .getElementById("productNameInput")
        .addEventListener("input", hideDuplicateWarning);

    document
        .getElementById("voucherAvailableInput")
        .addEventListener("change", toggleVoucherValueField);

    document
        .getElementById("productCodeInput")
        .addEventListener("input", function(){
            this.value =
                this.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9_-]/g, "");

            hideDuplicateWarning();
        });

    document
        .getElementById("productModalBackdrop")
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
        "PRD-" +
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

function loadProducts(){
    try{
        const raw =
            localStorage.getItem(PRODUCT_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        products =
            Array.isArray(parsed)
                ? parsed
                : [];
    }catch(error){
        console.error(error);
        products = [];
    }
}

function saveProducts(){
    localStorage.setItem(
        PRODUCT_KEY,
        JSON.stringify(products)
    );
}

function seedDefaultProducts(){
    products =
        DEFAULT_PRODUCTS.map(function(product){
            return {
                id: createId(),
                name: product.name,
                category: product.category,
                code: product.code,
                sellingPrice: product.sellingPrice,
                description: "",
                availableForVoucher: false,
                voucherValue: 0,
                availableForConsumable: false,
                status: "Active",
                internalNotes: "",
                createdAt: new Date().toISOString(),
                updatedAt: ""
            };
        });

    saveProducts();
}

function migrateExistingProducts(){
    let changed = false;

    products =
        products.map(function(product){
            if(typeof product === "string"){
                changed = true;

                return {
                    id: createId(),
                    name: product,
                    category:
                        product.toLowerCase().includes("vip card")
                            ? "Membership"
                            : "Other",
                    code:
                        product.toLowerCase().includes("vip card")
                            ? "VIP-CARD"
                            : "",
                    sellingPrice:
                        product.toLowerCase().includes("vip card")
                            ? 500
                            : 0,
                    description: "",
                    availableForVoucher: false,
                    voucherValue: 0,
                    availableForConsumable: false,
                    status: "Active",
                    internalNotes: "",
                    createdAt: new Date().toISOString(),
                    updatedAt: ""
                };
            }

            const migrated = {
                id: product.id || createId(),
                name: product.name || "",
                category:
                    product.category ||
                    (
                        String(product.name || "")
                            .toLowerCase()
                            .includes("vip card")
                            ? "Membership"
                            : "Other"
                    ),
                code: product.code || "",
                sellingPrice:
                    Number(
                        product.sellingPrice ??
                        product.retailPrice ??
                        product.regularPrice ??
                        product.price ??
                        product.amount ??
                        0
                    ) || 0,
                description: product.description || "",
                availableForVoucher:
                    product.availableForVoucher === true ||
                    product.voucherAvailable === true,
                voucherValue:
                    Number(product.voucherValue ?? product.voucherCost ?? 0) || 0,
                availableForConsumable:
                    product.availableForConsumable === true,
                status:
                    product.status ||
                    (
                        product.active === false
                            ? "Archived"
                            : "Active"
                    ),
                internalNotes: product.internalNotes || "",
                createdAt:
                    product.createdAt ||
                    new Date().toISOString(),
                updatedAt: product.updatedAt || ""
            };

            if(
                !product.id ||
                product.sellingPrice === undefined ||
                product.availableForVoucher === undefined ||
                !product.status
            ){
                changed = true;
            }

            return migrated;
        });

    const hasVipCard =
        products.some(function(product){
            return normalizeName(product.name) === "vipcard";
        });

    if(!hasVipCard){
        products.push({
            id: createId(),
            name: "VIP Card",
            category: "Membership",
            code: "VIP-CARD",
            sellingPrice: 500,
            description: "",
            availableForVoucher: false,
            voucherValue: 0,
            availableForConsumable: false,
            status: "Active",
            internalNotes: "",
            createdAt: new Date().toISOString(),
            updatedAt: ""
        });

        changed = true;
    }

    if(changed){
        saveProducts();
    }
}

function normalizeName(value){
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function populateCategoryFilter(){
    const select =
        document.getElementById("categoryFilter");

    const currentValue =
        select.value;

    const categories =
        Array.from(
            new Set(
                products
                    .map(function(product){
                        return product.category;
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

    if(categories.includes(currentValue)){
        select.value = currentValue;
    }
}

function renderProducts(){
    const search =
        document
            .getElementById("productSearch")
            .value
            .trim()
            .toLowerCase();

    const category =
        document.getElementById("categoryFilter").value;

    const status =
        document.getElementById("statusFilter").value;

    const filtered =
        products.filter(function(product){
            const matchesSearch =
                !search ||
                product.name.toLowerCase().includes(search) ||
                String(product.code || "")
                    .toLowerCase()
                    .includes(search);

            const matchesCategory =
                !category ||
                product.category === category;

            const matchesStatus =
                !status ||
                product.status === status;

            return (
                matchesSearch &&
                matchesCategory &&
                matchesStatus
            );
        });

    const tbody =
        document.getElementById("productsBody");

    tbody.innerHTML = "";

    filtered.forEach(function(product){
        const row =
            document.createElement("tr");

        if(product.status === "Archived"){
            row.classList.add("archived-row");
        }

        row.innerHTML = `
            <td>
                <div class="product-name-cell">

                    <div>
                        <strong>
                            ${escapeHtml(product.name)}
                        </strong>

                        <small>
                            ${escapeHtml(product.code || "No Code")}
                        </small>
                    </div>

                    ${
                        normalizeName(product.name) === "vipcard"
                            ? '<span class="vip-product-badge">VIP</span>'
                            : ""
                    }

                </div>
            </td>

            <td>
                ${escapeHtml(product.category)}
            </td>

            <td class="product-price-cell">
                ${formatCurrency(product.sellingPrice)}
            </td>

            <td>
                ${
                    product.availableForVoucher
                        ? `<span class="voucher-product-badge">${formatCurrency(product.voucherValue)}</span>`
                        : `<span class="voucher-not-available">—</span>`
                }
            </td>

            <td>
                <span class="product-status status-${product.status.toLowerCase()}">
                    ${escapeHtml(product.status)}
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
                        product.status === "Active"
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
                                    class="btn btn-sm btn-success activate-btn"
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
                openEditModal(product.id);
            });

        const archiveButton =
            row.querySelector(".archive-btn");

        if(archiveButton){
            archiveButton.addEventListener("click", function(){
                changeProductStatus(
                    product.id,
                    "Archived"
                );
            });
        }

        const activateButton =
            row.querySelector(".activate-btn");

        if(activateButton){
            activateButton.addEventListener("click", function(){
                changeProductStatus(
                    product.id,
                    "Active"
                );
            });
        }

        tbody.appendChild(row);
    });

    document
        .getElementById("productEmptyState")
        .classList.toggle(
            "d-none",
            filtered.length > 0
        );

    document.getElementById("productCount").textContent =
        products.length;

    document.getElementById("activeCount").textContent =
        products.filter(function(product){
            return product.status === "Active";
        }).length;

    document.getElementById("archivedCount").textContent =
        products.filter(function(product){
            return product.status === "Archived";
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

function openAddModal(){
    editingProductId = null;

    document.getElementById("modalEyebrow").textContent =
        "New Product";

    document.getElementById("modalTitle").textContent =
        "Add Product";

    document.getElementById("saveProductBtn").textContent =
        "Save Product";

    clearForm();
    activateTab("general");
    showModal();
}

function openEditModal(productId){
    const product =
        products.find(function(item){
            return item.id === productId;
        });

    if(!product){
        return;
    }

    editingProductId =
        product.id;

    document.getElementById("modalEyebrow").textContent =
        "Edit Product";

    document.getElementById("modalTitle").textContent =
        "Update Product";

    document.getElementById("saveProductBtn").textContent =
        "Update Product";

    document.getElementById("productNameInput").value =
        product.name || "";

    document.getElementById("productCategoryInput").value =
        product.category || "";

    document.getElementById("productCodeInput").value =
        product.code || "";

    document.getElementById("sellingPriceInput").value =
        product.sellingPrice ?? "";

    document.getElementById("productDescriptionInput").value =
        product.description || "";

    document.getElementById("productStatusInput").value =
        product.status || "Active";

    document.getElementById("voucherAvailableInput").checked =
        product.availableForVoucher === true;

    document.getElementById("voucherValueInput").value =
        product.voucherValue || "";

    document.getElementById("consumableAvailableInput").checked =
        product.availableForConsumable === true;

    document.getElementById("internalNotesInput").value =
        product.internalNotes || "";

    toggleVoucherValueField();
    hideDuplicateWarning();
    activateTab("general");
    showModal();
}

function clearForm(){
    document.getElementById("productNameInput").value = "";
    document.getElementById("productCategoryInput").value = "";
    document.getElementById("productCodeInput").value = "";
    document.getElementById("sellingPriceInput").value = "";
    document.getElementById("productDescriptionInput").value = "";
    document.getElementById("productStatusInput").value = "Active";
    document.getElementById("voucherAvailableInput").checked = false;
    document.getElementById("voucherValueInput").value = "";
    document.getElementById("consumableAvailableInput").checked = false;
    document.getElementById("internalNotesInput").value = "";

    toggleVoucherValueField();

    hideDuplicateWarning();
}

function activateTab(tabName){
    document
        .querySelectorAll(".product-tab")
        .forEach(function(tab){
            tab.classList.toggle(
                "active",
                tab.dataset.tab === tabName
            );
        });

    document
        .querySelectorAll(".product-tab-panel")
        .forEach(function(panel){
            panel.classList.toggle(
                "active",
                panel.dataset.panel === tabName
            );
        });
}

function saveProduct(){
    const name =
        document
            .getElementById("productNameInput")
            .value
            .trim();

    const category =
        document.getElementById("productCategoryInput").value;

    const code =
        document
            .getElementById("productCodeInput")
            .value
            .trim()
            .toUpperCase();

    const sellingPrice =
        Number(
            document.getElementById("sellingPriceInput").value
        );

    const availableForVoucher =
        document.getElementById("voucherAvailableInput").checked;

    const voucherValue =
        Number(document.getElementById("voucherValueInput").value) || 0;

    const availableForConsumable =
        document.getElementById("consumableAvailableInput").checked;

    if(!name){
        alert("Please enter a Product Name.");
        activateTab("general");
        return;
    }

    if(!category){
        alert("Please select a Category.");
        activateTab("general");
        return;
    }

    if(
        Number.isNaN(sellingPrice) ||
        sellingPrice < 0
    ){
        alert("Please enter a valid Selling Price.");
        activateTab("general");
        return;
    }

    if(
        availableForVoucher &&
        voucherValue <= 0
    ){
        alert("Please enter a valid Voucher Value for this product.");
        activateTab("internal");
        return;
    }

    const duplicate =
        products.find(function(product){
            if(product.id === editingProductId){
                return false;
            }

            const sameName =
                product.name.toLowerCase() ===
                name.toLowerCase();

            const sameCode =
                code &&
                String(product.code || "").toLowerCase() ===
                code.toLowerCase();

            return sameName || sameCode;
        });

    if(duplicate){
        showDuplicateWarning();

        alert(
            `A product with the same ${
                duplicate.name.toLowerCase() === name.toLowerCase()
                    ? "name"
                    : "code"
            } already exists. Please edit the existing product instead.`
        );

        return;
    }

    const existing =
        editingProductId
            ? products.find(function(product){
                return product.id === editingProductId;
            })
            : null;

    const productData = {
        id:
            editingProductId ||
            createId(),
        name: name,
        category: category,
        code: code,
        sellingPrice: sellingPrice,
        description:
            document
                .getElementById("productDescriptionInput")
                .value
                .trim(),
        availableForVoucher: availableForVoucher,
        voucherValue: availableForVoucher ? voucherValue : 0,
        availableForConsumable: availableForConsumable,
        status:
            document.getElementById("productStatusInput").value,
        internalNotes:
            document
                .getElementById("internalNotesInput")
                .value
                .trim(),
        createdAt:
            existing?.createdAt ||
            new Date().toISOString(),
        updatedAt:
            new Date().toISOString()
    };

    if(editingProductId){
        products =
            products.map(function(product){
                return product.id === editingProductId
                    ? productData
                    : product;
            });
    }else{
        products.push(productData);
    }

    products.sort(function(a, b){
        return a.name.localeCompare(b.name);
    });

    saveProducts();
    populateCategoryFilter();
    renderProducts();
    closeModal();
}

function changeProductStatus(productId, newStatus){
    const product =
        products.find(function(item){
            return item.id === productId;
        });

    if(!product){
        return;
    }

    if(
        normalizeName(product.name) === "vipcard" &&
        newStatus === "Archived"
    ){
        if(
            !confirm(
                "Archiving VIP Card will remove it from new Daily Income transactions. Continue?"
            )
        ){
            return;
        }
    }else{
        const action =
            newStatus === "Archived"
                ? "archive"
                : "activate";

        if(
            !confirm(
                `Are you sure you want to ${action} "${product.name}"?`
            )
        ){
            return;
        }
    }

    product.status =
        newStatus;

    product.updatedAt =
        new Date().toISOString();

    saveProducts();
    renderProducts();
}

function toggleVoucherValueField(){
    const checked =
        document.getElementById("voucherAvailableInput").checked;

    document
        .getElementById("voucherValueField")
        .classList.toggle("d-none", !checked);

    document.getElementById("voucherValueInput").required =
        checked;

    if(!checked){
        document.getElementById("voucherValueInput").value = "";
    }
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
        .getElementById("productModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");

    setTimeout(function(){
        document
            .getElementById("productNameInput")
            .focus();
    }, 50);
}

function closeModal(){
    document
        .getElementById("productModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    editingProductId = null;
}
