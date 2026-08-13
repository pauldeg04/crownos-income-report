let items = [];
let editingItemId = null;
let selectedServices = [];

/* script.js owns the peso() every other page formats money with, but it is
   not loaded on the inventory pages — this matches its output. */
function formatCost(value){
    return "₱" + Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/* Cost is optional: blank, or anything that is not a usable number, is worth
   zero. Items created before the field existed have no `cost` at all, and
   read back as 0 through the same path. */
function readItemCost(value){
    const cost = Number(String(value ?? "").trim());

    return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

document.addEventListener("DOMContentLoaded", function(){
    items = CrownInventory.getItems();

    attachEvents();
    populateCategoryFilter();
    populateSelectOptions();
    renderItems();
});

function attachEvents(){
    document
        .getElementById("addItemBtn")
        .addEventListener("click", openAddModal);

    document
        .getElementById("closeModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("cancelModalBtn")
        .addEventListener("click", closeModal);

    document
        .getElementById("saveItemBtn")
        .addEventListener("click", saveItem);

    document
        .getElementById("deleteItemBtn")
        .addEventListener("click", deleteItem);

    document
        .getElementById("itemSearch")
        .addEventListener("input", renderItems);

    document
        .getElementById("categoryFilter")
        .addEventListener("change", renderItems);

    document
        .getElementById("itemNameInput")
        .addEventListener("input", hideDuplicateWarning);

    document
        .getElementById("itemTransactionInput")
        .addEventListener("change", applyTransactionVisibility);

    document
        .getElementById("itemServicesToggle")
        .addEventListener("click", function(event){
            event.stopPropagation();
            toggleServicesPanel();
        });

    document
        .getElementById("itemModalBackdrop")
        .addEventListener("click", function(event){
            if(event.target === this){
                closeModal();
            }
        });

    /* Clicking anywhere outside the checkbox panel closes it, the way a
       native select would — but not when the click lands inside the panel
       itself, which would swallow the checkbox toggle. */
    document.addEventListener("click", function(event){
        if(!document.getElementById("itemServicesSelect").contains(event.target)){
            closeServicesPanel();
        }
    });

    document.addEventListener("keydown", function(event){
        if(event.key === "Escape"){
            if(!document.getElementById("itemServicesPanel").classList.contains("d-none")){
                closeServicesPanel();
                return;
            }

            closeModal();
        }
    });
}

function populateCategoryFilter(){
    const select =
        document.getElementById("categoryFilter");

    select.innerHTML =
        '<option value="">All Categories</option>' +
        CrownInventory.CATEGORIES
            .map(function(category){
                return `<option value="${CrownInventory.escapeHtml(category)}">${CrownInventory.escapeHtml(category)}</option>`;
            })
            .join("");
}

function populateSelectOptions(){
    const categorySelect =
        document.getElementById("itemCategoryInput");

    categorySelect.innerHTML =
        '<option value="">Select Category</option>' +
        CrownInventory.CATEGORIES
            .map(function(category){
                return `<option value="${CrownInventory.escapeHtml(category)}">${CrownInventory.escapeHtml(category)}</option>`;
            })
            .join("");

    const unitSelect =
        document.getElementById("itemUnitInput");

    unitSelect.innerHTML =
        '<option value="">Select Unit</option>' +
        CrownInventory.UNITS
            .map(function(unit){
                return `<option value="${CrownInventory.escapeHtml(unit)}">${CrownInventory.escapeHtml(unit)}</option>`;
            })
            .join("");

    const transactionSelect =
        document.getElementById("itemTransactionInput");

    transactionSelect.innerHTML =
        '<option value="">Not set</option>' +
        CrownInventory.TRANSACTION_TYPES
            .map(function(type){
                return `<option value="${CrownInventory.escapeHtml(type)}">${CrownInventory.escapeHtml(type)}</option>`;
            })
            .join("");
}

/* Retail links to one product; Services links to any number of services;
   Branch Consumption links to neither. Whatever is hidden is also cleared
   on save, so an item can never carry a stale link from a transaction
   type it no longer has. */
function applyTransactionVisibility(){
    const transaction =
        document.getElementById("itemTransactionInput").value;

    document
        .getElementById("itemProductLinkField")
        .classList.toggle("d-none", transaction !== "Retail");

    /* Items saved before Transaction existed have no value yet but may
       already carry service links, so a blank type keeps showing them. */
    document
        .getElementById("itemServicesField")
        .classList.toggle(
            "d-none",
            transaction !== "Services" && transaction !== ""
        );

    if(transaction !== "Services" && transaction !== ""){
        closeServicesPanel();
    }
}

/* The lists come from the master lists, but an item may already point at
   a service or product that was since renamed or archived — those saved
   values are added back as options so opening the item for edit does not
   silently blank out (and then wipe) the existing link. */
function populateProductOptions(currentProduct){
    const productSelect =
        document.getElementById("itemProductInput");

    const names =
        CrownInventory.getProductNames();

    const saved =
        String(currentProduct || "").trim();

    if(
        saved &&
        !names.some(function(name){
            return name.toLowerCase() === saved.toLowerCase();
        })
    ){
        names.push(saved);
    }

    productSelect.innerHTML =
        '<option value="">No linked product</option>' +
        names
            .map(function(name){
                return `<option value="${CrownInventory.escapeHtml(name)}">${CrownInventory.escapeHtml(name)}</option>`;
            })
            .join("");

    productSelect.value = saved;
}

function populateServiceOptions(currentServices){
    selectedServices =
        (Array.isArray(currentServices) ? currentServices : [])
            .map(function(name){
                return String(name || "").trim();
            })
            .filter(Boolean);

    const names =
        CrownInventory.getServiceNames();

    selectedServices.forEach(function(saved){
        if(
            !names.some(function(name){
                return name.toLowerCase() === saved.toLowerCase();
            })
        ){
            names.push(saved);
        }
    });

    const panel =
        document.getElementById("itemServicesPanel");

    if(names.length === 0){
        panel.innerHTML =
            '<div class="inv-multiselect-empty">No active services yet.</div>';
    }else{
        panel.innerHTML =
            names
                .map(function(name){
                    const checked =
                        selectedServices.some(function(selected){
                            return selected.toLowerCase() === name.toLowerCase();
                        });

                    return `
                        <label class="inv-multiselect-option">
                            <input type="checkbox" value="${CrownInventory.escapeHtml(name)}" ${checked ? "checked" : ""}>
                            <span>${CrownInventory.escapeHtml(name)}</span>
                        </label>
                    `;
                })
                .join("");

        panel
            .querySelectorAll("input[type=checkbox]")
            .forEach(function(checkbox){
                checkbox.addEventListener("change", function(){
                    if(checkbox.checked){
                        selectedServices.push(checkbox.value);
                    }else{
                        selectedServices =
                            selectedServices.filter(function(name){
                                return name !== checkbox.value;
                            });
                    }

                    updateServicesSummary();
                });
            });
    }

    updateServicesSummary();
}

function updateServicesSummary(){
    const summary =
        document.getElementById("itemServicesSummary");

    if(selectedServices.length === 0){
        summary.textContent = "No linked service";
        return;
    }

    if(selectedServices.length <= 2){
        summary.textContent = selectedServices.join(", ");
        return;
    }

    summary.textContent =
        `${selectedServices.length} services selected`;
}

function toggleServicesPanel(){
    document
        .getElementById("itemServicesPanel")
        .classList.toggle("d-none");

    document
        .getElementById("itemServicesToggle")
        .setAttribute(
            "aria-expanded",
            String(
                !document
                    .getElementById("itemServicesPanel")
                    .classList.contains("d-none")
            )
        );
}

function closeServicesPanel(){
    document
        .getElementById("itemServicesPanel")
        .classList.add("d-none");

    document
        .getElementById("itemServicesToggle")
        .setAttribute("aria-expanded", "false");
}

function openAddModal(){
    editingItemId = null;

    document.getElementById("modalEyebrow").textContent =
        "New Item";

    document.getElementById("modalTitle").textContent =
        "Add Item";

    document.getElementById("itemNameInput").value = "";
    document.getElementById("itemCategoryInput").value = "";
    document.getElementById("itemUnitInput").value = "";
    document.getElementById("itemDescriptionInput").value = "";
    document.getElementById("itemTransactionInput").value = "";
    document.getElementById("itemCostInput").value = "";

    populateProductOptions("");
    populateServiceOptions([]);
    applyTransactionVisibility();

    document.getElementById("saveItemBtn").textContent =
        "Save Item";

    document
        .getElementById("deleteItemBtn")
        .classList.add("d-none");

    hideDuplicateWarning();
    showModal();
}

function openEditModal(itemId){
    const item =
        items.find(function(row){
            return row.id === itemId;
        });

    if(!item){
        return;
    }

    editingItemId = item.id;

    document.getElementById("modalEyebrow").textContent =
        "Edit Item";

    document.getElementById("modalTitle").textContent =
        "Edit Item";

    document.getElementById("itemNameInput").value =
        item.name || "";

    document.getElementById("itemCategoryInput").value =
        item.category || "";

    document.getElementById("itemUnitInput").value =
        item.unit || "";

    document.getElementById("itemDescriptionInput").value =
        item.description || "";

    document.getElementById("itemTransactionInput").value =
        item.transaction || "";

    /* Shown blank rather than as "0" when there is no cost, so the placeholder
       keeps saying the field is optional. */
    document.getElementById("itemCostInput").value =
        readItemCost(item.cost) > 0 ? readItemCost(item.cost) : "";

    populateProductOptions(item.linkedProduct || "");
    populateServiceOptions(CrownInventory.getItemServices(item));
    applyTransactionVisibility();

    document.getElementById("saveItemBtn").textContent =
        "Update Item";

    document
        .getElementById("deleteItemBtn")
        .classList.remove("d-none");

    hideDuplicateWarning();
    showModal();
}

function deleteItem(){
    const item =
        items.find(function(row){
            return row.id === editingItemId;
        });

    if(!item){
        return;
    }

    const warehouseRow =
        CrownInventory.getWarehouseRow(item.id);

    const branchRows =
        CrownInventory.getBranchStock().filter(function(row){
            return row.itemId === item.id;
        });

    const hasStock =
        (warehouseRow && Number(warehouseRow.qty) > 0) ||
        branchRows.some(function(row){
            return Number(row.qty) > 0;
        });

    if(hasStock){
        alert(
            `"${item.name}" still has existing stock in the Warehouse or a Branch. ` +
            "Please zero out its stock first before deleting this item."
        );
        return;
    }

    if(!confirm(`Delete "${item.name}" from the item list? This cannot be undone.`)){
        return;
    }

    items = items.filter(function(row){
        return row.id !== item.id;
    });

    CrownInventory.saveItems(items);

    closeModal();
    renderItems();
}

function showModal(){
    document
        .getElementById("itemModalBackdrop")
        .classList.remove("d-none");

    document.body.classList.add("modal-open");

    setTimeout(function(){
        document.getElementById("itemNameInput").focus();
    }, 50);
}

function closeModal(){
    document
        .getElementById("itemModalBackdrop")
        .classList.add("d-none");

    document.body.classList.remove("modal-open");

    editingItemId = null;
}

function hideDuplicateWarning(){
    document
        .getElementById("duplicateWarning")
        .classList.add("d-none");
}

function saveItem(){
    const name =
        document.getElementById("itemNameInput").value.trim();

    const category =
        document.getElementById("itemCategoryInput").value;

    const unit =
        document.getElementById("itemUnitInput").value;

    const transaction =
        document.getElementById("itemTransactionInput").value;

    const linkedProduct =
        transaction === "Retail"
            ? document.getElementById("itemProductInput").value
            : "";

    const services =
        transaction === "Retail" || transaction === "Branch Consumption"
            ? []
            : selectedServices.slice();

    const description =
        document.getElementById("itemDescriptionInput").value.trim();

    const cost =
        readItemCost(document.getElementById("itemCostInput").value);

    if(!name){
        alert("Please enter an item name.");
        return;
    }

    if(!category){
        alert("Please select a category.");
        return;
    }

    if(!unit){
        alert("Please select a unit.");
        return;
    }

    const duplicate =
        items.some(function(row){
            return (
                row.id !== editingItemId &&
                String(row.name || "").toLowerCase() === name.toLowerCase()
            );
        });

    if(duplicate){
        document
            .getElementById("duplicateWarning")
            .classList.remove("d-none");
        return;
    }

    if(editingItemId){
        const item =
            items.find(function(row){
                return row.id === editingItemId;
            });

        if(!item){
            return;
        }

        item.name = name;
        item.category = category;
        item.unit = unit;
        item.transaction = transaction;
        item.linkedProduct = linkedProduct;
        item.services = services;
        item.description = description;
        item.cost = cost;

        /* Superseded by `services` — dropped so the two can never
           disagree about what this item is linked to. */
        delete item.service;
        item.updatedAt = new Date().toISOString();

        alert("Item updated successfully.");
    }else{
        items.push({
            id: CrownInventory.createId("ITM"),
            name: name,
            category: category,
            unit: unit,
            transaction: transaction,
            linkedProduct: linkedProduct,
            services: services,
            description: description,
            cost: cost,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        alert("Item added successfully.");
    }

    CrownInventory.saveItems(items);

    closeModal();
    renderItems();
}

function renderItems(){
    const tbody =
        document.getElementById("itemsBody");

    const search =
        document.getElementById("itemSearch").value.trim().toLowerCase();

    const category =
        document.getElementById("categoryFilter").value;

    const filtered =
        items
            .filter(function(item){
                const matchesSearch =
                    !search ||
                    String(item.name || "").toLowerCase().includes(search);

                const matchesCategory =
                    !category ||
                    item.category === category;

                return matchesSearch && matchesCategory;
            })
            .slice()
            .sort(function(a, b){
                return String(a.name || "").localeCompare(String(b.name || ""));
            });

    tbody.innerHTML = "";

    filtered.forEach(function(item){
        const row =
            document.createElement("tr");

        row.innerHTML = `
            <td>
                <strong>${CrownInventory.escapeHtml(item.name)}</strong>
            </td>

            <td>${CrownInventory.escapeHtml(item.category)}</td>

            <td>
                ${CrownInventory.escapeHtml(item.transaction) || "—"}
                ${
                    item.transaction === "Retail" && item.linkedProduct
                        ? `<br><small class="text-muted">${CrownInventory.escapeHtml(item.linkedProduct)}</small>`
                        : ""
                }
            </td>

            <td>${CrownInventory.escapeHtml(CrownInventory.getItemServices(item).join(", ")) || "—"}</td>

            <td>${CrownInventory.escapeHtml(item.description) || "—"}</td>

            <td>${CrownInventory.escapeHtml(item.unit)}</td>

            <td>${CrownInventory.escapeHtml(formatCost(item.cost))}</td>

            <td>
                <div class="action-buttons">
                    <button type="button" class="btn btn-sm btn-warning edit-btn">
                        Edit
                    </button>
                </div>
            </td>
        `;

        row
            .querySelector(".edit-btn")
            .addEventListener("click", function(){
                openEditModal(item.id);
            });

        tbody.appendChild(row);
    });

    document
        .getElementById("itemEmptyState")
        .classList.toggle("d-none", filtered.length > 0);

    document.getElementById("itemCount").textContent =
        items.length;
}
