let items = [];
let editingItemId = null;

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
        .getElementById("itemModalBackdrop")
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

    const description =
        document.getElementById("itemDescriptionInput").value.trim();

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
        item.description = description;
        item.updatedAt = new Date().toISOString();

        alert("Item updated successfully.");
    }else{
        items.push({
            id: CrownInventory.createId("ITM"),
            name: name,
            category: category,
            unit: unit,
            description: description,
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

            <td>${CrownInventory.escapeHtml(item.description) || "—"}</td>

            <td>${CrownInventory.escapeHtml(item.unit)}</td>

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
