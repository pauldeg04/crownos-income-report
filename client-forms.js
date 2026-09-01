/* Client Forms — Consent, Head Spa, Body Massage, and Combo forms attached
   to a client's Visit History row. Loaded after clients.js (shares its
   globals: clients, escapeHtml, normalizeClientName, saveClientsToStorage,
   renderClientVisitsTable) and after access-control.js (window.CrownAuth). */

const SERVICE_FORMS_KEY = "crownServiceMasterList";

const FORM_TEMPLATES = {
    consent: {
        title: "Consent Form",
        shortTitle: "Consent",
        fields: [
            {
                id: "allergies",
                label: "Do you have any allergies? (e.g. oils, creams, scents)",
                type: "yesno"
            },
            {
                id: "productsNote",
                type: "note",
                text:
                    "We use the following products according to the treatment you availed: " +
                    "Facial Cleanser, Facial Mask, Shampoo, Conditioner, Hair Spa, Massage Oil."
            },
            {
                id: "conditions",
                label: "Do you have or have had any of the following? (check all that apply)",
                type: "checkbox",
                options: [
                    { id: "headaches", label: "Headaches / Migraines" },
                    { id: "scalpConditions", label: "Scalp Conditions (e.g. Psoriasis, Eczema)" },
                    { id: "pregnancy", label: "Pregnancy" },
                    { id: "recentSurgery", label: "Recent Surgery or Injury" },
                    { id: "others", label: "Others", hasText: true }
                ]
            },
            {
                id: "doctorCare",
                label: "Are you currently under a doctor's care? If yes, please inform our staff",
                type: "yesno"
            },
            {
                id: "pregnantBreastfeeding",
                label: "For Female Clients Only: Are you pregnant or breastfeeding?",
                type: "yesno"
            },
            {
                id: "waiverNote",
                type: "note",
                text:
                    "By signing this form: I agree to receive the treatment and understand it is for " +
                    "relaxation only, not medical treatment. I release Crown Head Spa and its staff from " +
                    "any responsibility in case of allergic reactions or unexpected side effects. I will " +
                    "let the staff know immediately if I feel any discomfort so they can adjust the " +
                    "service for my safety and comfort. I confirm that I've shared any allergies, " +
                    "sensitivities, or special preferences before starting the session.\n\n" +
                    "Data Privacy Consent: Crown Head Spa collects and protects your personal data to " +
                    "provide you with safe and personalized service. Your information is used only for " +
                    "service purposes and will not be shared without your permission, unless required by law."
            },
            {
                id: "agree",
                label: 'By checking "YES," you agree to everything stated above.',
                type: "yesno"
            }
        ]
    },

    headspa: {
        title: "Head Spa Form",
        shortTitle: "Head Spa",
        fields: [
            { id: "nickname", label: "Client Nickname", type: "text" },
            {
                id: "scalpStatus",
                label: "What's your scalp status?",
                type: "checkbox",
                options: [
                    { id: "hairFall", label: "Hair Fall" },
                    { id: "itchyScalp", label: "Itchy Scalp" },
                    { id: "dandruff", label: "Dandruff" }
                ]
            },
            {
                id: "scalpCondition",
                label: "Scalp and Hair Condition",
                type: "radio",
                options: [
                    { id: "healthy", label: "Healthy: Clean follicle, no build ups" },
                    { id: "unhealthy", label: "Unhealthy: Dandruff, Sensitive, Thick Cuticle" },
                    { id: "others", label: "Others", hasText: true }
                ]
            },
            {
                id: "eyemask",
                label: "Eyemask Option (Detox and Glow only)",
                type: "radio",
                options: [
                    { id: "heated", label: "Heated Eyemask (Warm & soothing for tired eyes and deeper relaxation)" },
                    { id: "coldJade", label: "Cold Jade Eyemask (Cooling & refreshing for tired or puffy eyes)" }
                ]
            },
            {
                id: "headSpaPressure",
                label: "Head Spa Massage Pressure",
                type: "radio",
                options: [
                    { id: "soft", label: "Soft" },
                    { id: "moderate", label: "Moderate" },
                    { id: "hard", label: "Hard" }
                ]
            },
            {
                id: "waterTemp",
                label: "Water Therapy Temperature",
                type: "radio",
                options: [
                    { id: "warm", label: "Warm" },
                    { id: "cold", label: "Cold" },
                    { id: "both", label: "Both" }
                ]
            },
            {
                id: "neckShoulderPressure",
                label: "Neck and Shoulder Massage Pressure",
                type: "radio",
                options: [
                    { id: "soft", label: "Soft" },
                    { id: "moderate", label: "Moderate" },
                    { id: "hard", label: "Hard" }
                ]
            },
            {
                id: "communication",
                label: "Communication Preference During Procedure",
                type: "radio",
                options: [
                    { id: "light", label: "Light conversation (the therapist may talk with you occasionally)" },
                    { id: "quiet", label: "Quiet & relaxing session (no conversation from the therapist)" }
                ]
            }
        ]
    },

    massage: {
        title: "Body Massage Form",
        shortTitle: "Body Massage",
        fields: [
            {
                id: "mainConcern",
                label: "Main Concern",
                type: "checkbox",
                options: [
                    { id: "stressRelief", label: "Stress Relief / Relaxation" },
                    { id: "muscleTension", label: "Muscle Tension" },
                    { id: "bodyPain", label: "Body Pain" },
                    { id: "fatigue", label: "Fatigue" },
                    { id: "poorSleep", label: "Poor Sleep" },
                    { id: "headacheNeck", label: "Headache / Neck Tension" },
                    { id: "others", label: "Others (please let the therapist know)", hasText: true }
                ]
            },
            {
                id: "areasDiscomfort",
                label: "Areas with Discomfort / Tension",
                type: "checkbox",
                options: [
                    { id: "headNeckShoulders", label: "Head / Neck & Shoulders" },
                    { id: "upperBack", label: "Upper Back" },
                    { id: "lowerBack", label: "Lower Back" },
                    { id: "armsHands", label: "Arms / Hands" },
                    { id: "legsFeet", label: "Legs & Feet" },
                    { id: "fullBody", label: "Full Body" }
                ]
            },
            {
                id: "pressure",
                label: "Pressure Preference",
                type: "radio",
                options: [
                    { id: "soft", label: "Soft" },
                    { id: "moderate", label: "Moderate" },
                    { id: "hard", label: "Hard" }
                ]
            },
            {
                id: "eyemaskOptions",
                label: "Eyemask Options",
                type: "radio",
                options: [
                    { id: "dryTowel", label: "Dry Towel (Simple & lightweight eye cover)" }
                ]
            },
            {
                id: "areasToAvoid",
                label: "Areas to Avoid (please inform your therapist of any areas to avoid during the session)",
                type: "textarea"
            },
            {
                id: "conversationPref",
                label: "Preferred Conversation During Session",
                type: "radio",
                options: [
                    { id: "quiet", label: "Quiet / Relaxing Session — Tahimik, therapist will only talk when needed" },
                    { id: "comfortable", label: "Comfortable with Conversation — open for light conversation" }
                ]
            }
        ]
    },

    combo: {
        title: "Combo Form (Head Spa + Body Massage)",
        shortTitle: "Combo",
        fields: [
            { id: "nickname", label: "Client Nickname", type: "text" },
            {
                id: "scalpStatus",
                label: "Head Spa — What's your scalp status?",
                type: "checkbox",
                options: [
                    { id: "hairFall", label: "Hair Fall" },
                    { id: "itchyScalp", label: "Itchy Scalp" },
                    { id: "dandruff", label: "Dandruff" }
                ]
            },
            {
                id: "scalpCondition",
                label: "Scalp and Hair Condition",
                type: "radio",
                options: [
                    { id: "healthy", label: "Healthy: Clean follicle, no build ups" },
                    { id: "unhealthy", label: "Unhealthy: Dandruff, Sensitive, Thick Cuticle" },
                    { id: "others", label: "Others", hasText: true }
                ]
            },
            {
                id: "eyemask",
                label: "Eyemask Option (Detox and Glow only)",
                type: "radio",
                options: [
                    { id: "heated", label: "Heated Eyemask" },
                    { id: "coldJade", label: "Cold Jade Eyemask" }
                ]
            },
            {
                id: "headSpaPressure",
                label: "Head Spa Massage Pressure",
                type: "radio",
                options: [
                    { id: "soft", label: "Soft" },
                    { id: "moderate", label: "Moderate" },
                    { id: "hard", label: "Hard" }
                ]
            },
            {
                id: "waterTemp",
                label: "Water Therapy Temperature",
                type: "radio",
                options: [
                    { id: "warm", label: "Warm" },
                    { id: "cold", label: "Cold" },
                    { id: "both", label: "Both" }
                ]
            },
            {
                id: "waterfallTherapy",
                label: "Waterfall Therapy (Eyes) — Crown Detox Only",
                type: "yesno"
            },
            {
                id: "neckShoulderPressure",
                label: "Neck and Shoulder Massage Pressure",
                type: "radio",
                options: [
                    { id: "soft", label: "Soft" },
                    { id: "moderate", label: "Moderate" },
                    { id: "hard", label: "Hard" }
                ]
            },
            {
                id: "communication",
                label: "Communication Preference During Procedure",
                type: "radio",
                options: [
                    { id: "light", label: "Light conversation (the therapist may talk with you occasionally)" },
                    { id: "quiet", label: "Quiet & relaxing session (no conversation from the therapist)" }
                ]
            },
            {
                id: "mainConcern",
                label: "Body Massage — Main Concern",
                type: "checkbox",
                options: [
                    { id: "stressRelief", label: "Stress / Relaxation" },
                    { id: "muscleTension", label: "Muscle Tension" },
                    { id: "fatigue", label: "Fatigue" },
                    { id: "poorSleep", label: "Poor Sleep" },
                    { id: "headacheNeck", label: "Headache / Neck Tension" },
                    { id: "others", label: "Others (please let the therapist know)", hasText: true }
                ]
            },
            {
                id: "areasDiscomfort",
                label: "Areas with Discomfort / Tension",
                type: "checkbox",
                options: [
                    { id: "neck", label: "Neck" },
                    { id: "shoulders", label: "Shoulders" },
                    { id: "upperBack", label: "Upper Back" },
                    { id: "lowerBack", label: "Lower Back" },
                    { id: "legs", label: "Legs" },
                    { id: "feet", label: "Feet" },
                    { id: "fullBody", label: "Full Body" }
                ]
            },
            {
                id: "bodyPressure",
                label: "Body Massage Pressure Preference",
                type: "radio",
                options: [
                    { id: "soft", label: "Soft" },
                    { id: "moderate", label: "Moderate" },
                    { id: "hard", label: "Hard" }
                ]
            },
            {
                id: "areasToAvoid",
                label: "Areas to Avoid",
                type: "textarea"
            },
            {
                id: "confirmAccuracy",
                label:
                    "I confirm that the details provided are correct and that I may request pressure " +
                    "adjustments anytime during the session for my comfort.",
                type: "yesno"
            },
            {
                id: "therapistNotes",
                label: "Therapist Notes",
                type: "textarea"
            }
        ]
    }
};

let activeClientFormContext = null;

/* A Therapist can fill a form that hasn't been submitted yet, but once it's
   saved it locks to view-only for them (still visible, just not editable) —
   pass the existing form record (if any) so that check can be made. Every
   other allowed role keeps full edit access regardless of fill status. */
function canEditClientForms(existingForm){
    const user = window.CrownAuth?.getCurrentUser?.();
    const role = window.CrownAuth?.getEffectiveRole?.(user) || user?.role;

    if(!["Admin", "Executive Assistant", "Receptionist", "Therapist"].includes(role)){
        return false;
    }

    if(role === "Therapist" && existingForm){
        return false;
    }

    return true;
}

function getServiceCategoryMap(){
    const map = new Map();

    try{
        const saved = localStorage.getItem(SERVICE_FORMS_KEY);
        const parsed = saved ? JSON.parse(saved) : [];

        (Array.isArray(parsed) ? parsed : []).forEach(function(service){
            if(service?.name){
                map.set(String(service.name).trim().toLowerCase(), service.category || "");
            }
        });
    }catch(error){
        console.error("Unable to load service master list:", error);
    }

    return map;
}

/* Suggests which form(s) belong with a visit, based on the service
   category ("Head Spa" / "Massage" / "Combo" / …) of the items sold.
   Consent always accompanies whichever main form applies. Falls back to
   just Consent when nothing matches — staff can still add any other form
   manually via the "+ Add other form" picker. */
function guessFormTypesForService(itemsString){
    const categoryMap = getServiceCategoryMap();

    const categories = new Set();

    String(itemsString || "")
        .split(",")
        .map(function(name){ return name.trim().toLowerCase(); })
        .filter(Boolean)
        .forEach(function(name){
            const category = categoryMap.get(name);

            if(category){
                categories.add(category);
            }
        });

    if(categories.has("Combo")){
        return ["consent", "combo"];
    }

    const hasHeadSpa = categories.has("Head Spa");
    const hasMassage = categories.has("Massage");

    if(hasHeadSpa && hasMassage){
        return ["consent", "combo"];
    }

    if(hasHeadSpa){
        return ["consent", "headspa"];
    }

    if(hasMassage){
        return ["consent", "massage"];
    }

    return ["consent"];
}

function buildVisitKey(client, visit){
    return [
        visit.date || "",
        visit.branch || "",
        normalizeClientName(client.name).toLowerCase()
    ].join("|");
}

function renderFormsCell(client, visit, visitKey){
    const requiredTypes = guessFormTypesForService(visit.items);
    const existingForms = (client.forms || []).filter(function(form){
        return form.visitKey === visitKey;
    });

    const pills = requiredTypes.map(function(type){
        const template = FORM_TEMPLATES[type];
        const existing = existingForms.find(function(form){
            return form.formType === type;
        });
        const canEdit = canEditClientForms(existing);

        if(existing){
            return `
                <button
                    type="button"
                    class="forms-pill-btn forms-pill-filled"
                    data-form-id="${escapeHtml(existing.id)}"
                    data-form-type="${escapeHtml(type)}"
                    data-visit-key="${escapeHtml(visitKey)}"
                    data-visit-date="${escapeHtml(visit.date)}"
                    data-visit-branch="${escapeHtml(visit.branch)}"
                >${canEdit ? "✓ " + escapeHtml(template.shortTitle) : "View " + escapeHtml(template.shortTitle)}</button>
            `;
        }

        if(!canEdit){
            return `<span class="forms-pill-missing">${escapeHtml(template.shortTitle)} — not filled</span>`;
        }

        return `
            <button
                type="button"
                class="forms-pill-btn forms-pill-empty"
                data-form-id=""
                data-form-type="${escapeHtml(type)}"
                data-visit-key="${escapeHtml(visitKey)}"
                data-visit-date="${escapeHtml(visit.date)}"
                data-visit-branch="${escapeHtml(visit.branch)}"
            >+ Fill ${escapeHtml(template.shortTitle)}</button>
        `;
    }).join("");

    const otherTypes = Object.keys(FORM_TEMPLATES).filter(function(type){
        return (
            !requiredTypes.includes(type) &&
            !existingForms.some(function(form){ return form.formType === type; })
        );
    });

    const addOtherSelect =
        canEditClientForms(null) && otherTypes.length
            ? `
                <select
                    class="form-select form-select-sm forms-add-select"
                    data-visit-key="${escapeHtml(visitKey)}"
                    data-visit-date="${escapeHtml(visit.date)}"
                    data-visit-branch="${escapeHtml(visit.branch)}"
                >
                    <option value="">+ Add other form</option>
                    ${
                        otherTypes.map(function(type){
                            return `<option value="${escapeHtml(type)}">${escapeHtml(FORM_TEMPLATES[type].shortTitle)}</option>`;
                        }).join("")
                    }
                </select>
              `
            : "";

    return `<div class="forms-cell-stack">${pills}${addOtherSelect}</div>`;
}

function wireFormsCellButtons(client, container){
    const root =
        container ||
        document.getElementById("viewClientVisitsBody") ||
        document;

    root.querySelectorAll(".forms-pill-btn").forEach(function(btn){
        btn.addEventListener("click", function(){
            openClientFormModal(
                client,
                {
                    visitKey: btn.dataset.visitKey,
                    date: btn.dataset.visitDate,
                    branch: btn.dataset.visitBranch
                },
                btn.dataset.formType,
                btn.dataset.formId || null
            );
        });
    });

    root.querySelectorAll(".forms-add-select").forEach(function(select){
        select.addEventListener("change", function(){
            if(!select.value){
                return;
            }

            openClientFormModal(
                client,
                {
                    visitKey: select.dataset.visitKey,
                    date: select.dataset.visitDate,
                    branch: select.dataset.visitBranch
                },
                select.value,
                null
            );

            select.value = "";
        });
    });
}

function renderFormField(field, data, readOnly){
    if(field.type === "note"){
        return `<div class="client-form-note">${escapeHtml(field.text)}</div>`;
    }

    if(field.type === "text"){
        return `
            <div class="client-form-field">
                <label class="form-label fw-bold">${escapeHtml(field.label)}</label>
                <input
                    type="text"
                    class="form-control"
                    data-field-id="${escapeHtml(field.id)}"
                    data-field-type="text"
                    value="${escapeHtml(data[field.id] || "")}"
                    ${readOnly ? "disabled" : ""}
                >
            </div>
        `;
    }

    if(field.type === "textarea"){
        return `
            <div class="client-form-field">
                <label class="form-label fw-bold">${escapeHtml(field.label)}</label>
                <textarea
                    class="form-control"
                    rows="2"
                    data-field-id="${escapeHtml(field.id)}"
                    data-field-type="textarea"
                    ${readOnly ? "disabled" : ""}
                >${escapeHtml(data[field.id] || "")}</textarea>
            </div>
        `;
    }

    if(field.type === "yesno"){
        const value = data[field.id] || "";

        return `
            <div class="client-form-field">
                <label class="form-label fw-bold">${escapeHtml(field.label)}</label>
                <div class="client-form-yesno">
                    ${
                        ["Yes", "No"].map(function(option){
                            return `
                                <label class="client-form-yesno-option ${value === option ? "selected" : ""}">
                                    <input
                                        type="radio"
                                        name="f_${escapeHtml(field.id)}"
                                        value="${option}"
                                        ${value === option ? "checked" : ""}
                                        ${readOnly ? "disabled" : ""}
                                    > ${option}
                                </label>
                            `;
                        }).join("")
                    }
                </div>
            </div>
        `;
    }

    if(field.type === "radio" || field.type === "checkbox"){
        const isCheckbox = field.type === "checkbox";
        const selectedValue = data[field.id] || "";
        const selectedList = Array.isArray(data[field.id]) ? data[field.id] : [];

        return `
            <div class="client-form-field">
                <label class="form-label fw-bold">${escapeHtml(field.label)}</label>
                <div class="client-form-options">
                    ${
                        field.options.map(function(option){
                            const checked =
                                isCheckbox
                                    ? selectedList.includes(option.id)
                                    : selectedValue === option.id;

                            const textKey = field.id + "_" + option.id + "_text";

                            return `
                                <label class="client-form-option ${checked ? "selected" : ""}">
                                    <input
                                        type="${isCheckbox ? "checkbox" : "radio"}"
                                        ${isCheckbox ? `data-checkbox-of="${escapeHtml(field.id)}"` : `name="f_${escapeHtml(field.id)}"`}
                                        value="${escapeHtml(option.id)}"
                                        ${checked ? "checked" : ""}
                                        ${readOnly ? "disabled" : ""}
                                    > ${escapeHtml(option.label)}
                                    ${
                                        option.hasText
                                            ? `
                                                <input
                                                    type="text"
                                                    class="form-control form-control-sm client-form-option-text"
                                                    placeholder="Please specify"
                                                    data-field-text-of="${escapeHtml(field.id)}_${escapeHtml(option.id)}"
                                                    value="${escapeHtml(data[textKey] || "")}"
                                                    ${readOnly ? "disabled" : ""}
                                                >
                                              `
                                            : ""
                                    }
                                </label>
                            `;
                        }).join("")
                    }
                </div>
            </div>
        `;
    }

    return "";
}

function collectClientFormData(container, template){
    const data = {};

    template.fields.forEach(function(field){
        if(field.type === "note"){
            return;
        }

        if(field.type === "text" || field.type === "textarea"){
            const el = container.querySelector(`[data-field-id="${field.id}"][data-field-type="${field.type}"]`);
            data[field.id] = el ? el.value.trim() : "";
            return;
        }

        if(field.type === "yesno"){
            const checked = container.querySelector(`input[name="f_${field.id}"]:checked`);
            data[field.id] = checked ? checked.value : "";
            return;
        }

        if(field.type === "radio"){
            const checked = container.querySelector(`input[name="f_${field.id}"]:checked`);
            data[field.id] = checked ? checked.value : "";

            field.options.forEach(function(option){
                if(option.hasText && data[field.id] === option.id){
                    const textEl = container.querySelector(`[data-field-text-of="${field.id}_${option.id}"]`);
                    data[field.id + "_" + option.id + "_text"] = textEl ? textEl.value.trim() : "";
                }
            });
            return;
        }

        if(field.type === "checkbox"){
            const checkedValues = Array.from(
                container.querySelectorAll(`input[data-checkbox-of="${field.id}"]:checked`)
            ).map(function(el){ return el.value; });

            data[field.id] = checkedValues;

            field.options.forEach(function(option){
                if(option.hasText && checkedValues.includes(option.id)){
                    const textEl = container.querySelector(`[data-field-text-of="${field.id}_${option.id}"]`);
                    data[field.id + "_" + option.id + "_text"] = textEl ? textEl.value.trim() : "";
                }
            });
        }
    });

    return data;
}

function openClientFormModal(client, visitMeta, formType, formId){
    const template = FORM_TEMPLATES[formType];

    if(!template){
        return;
    }

    const existing = formId
        ? (client.forms || []).find(function(form){ return form.id === formId; })
        : null;

    const readOnly = !canEditClientForms(existing);

    activeClientFormContext = {
        clientId: client.id,
        visitMeta: visitMeta,
        formType: formType,
        formId: existing ? existing.id : null,
        readOnly: readOnly
    };

    document.getElementById("clientFormTitle").textContent = template.title;

    document.getElementById("clientFormBody").innerHTML = template.fields.map(function(field){
        return renderFormField(field, existing?.data || {}, readOnly);
    }).join("");

    document.getElementById("saveClientFormBtn").classList.toggle("d-none", readOnly);

    document.getElementById("clientFormBackdrop").classList.remove("d-none");
}

function closeClientFormModal(){
    document.getElementById("clientFormBackdrop").classList.add("d-none");
    activeClientFormContext = null;
}

function saveClientForm(){
    if(!activeClientFormContext || activeClientFormContext.readOnly){
        return;
    }

    const client = clients.find(function(item){
        return item.id === activeClientFormContext.clientId;
    });

    if(!client){
        return;
    }

    const template = FORM_TEMPLATES[activeClientFormContext.formType];
    const container = document.getElementById("clientFormBody");
    const data = collectClientFormData(container, template);

    const user = window.CrownAuth?.getCurrentUser?.();
    const role = window.CrownAuth?.getEffectiveRole?.(user) || user?.role;
    const filledBy = {
        name: user?.therapistName || user?.account || "—",
        role: role || "—"
    };

    if(!Array.isArray(client.forms)){
        client.forms = [];
    }

    const now = new Date().toISOString();

    if(activeClientFormContext.formId){
        const existing = client.forms.find(function(form){
            return form.id === activeClientFormContext.formId;
        });

        if(existing){
            existing.data = data;
            existing.updatedAt = now;
            existing.filledBy = filledBy;
        }
    }else{
        client.forms.push({
            id: window.CrownAuth?.createId?.() || createId(),
            visitKey: activeClientFormContext.visitMeta.visitKey,
            formType: activeClientFormContext.formType,
            date: activeClientFormContext.visitMeta.date || "",
            branch: activeClientFormContext.visitMeta.branch || "",
            filledBy: filledBy,
            status: "completed",
            data: data,
            createdAt: now,
            updatedAt: now
        });
    }

    saveClientsToStorage();
    closeClientFormModal();

    if(typeof renderClientVisitsTable === "function"){
        renderClientVisitsTable(client);
    }

    /* Lets other pages (e.g. the Dashboard's appointment/client card) refresh
       their own Forms display after a save, without client-forms.js needing
       to know about every page that embeds it. */
    document.dispatchEvent(new CustomEvent("crownClientFormSaved", {
        detail: { clientId: client.id }
    }));
}

document.addEventListener("DOMContentLoaded", function(){
    document.getElementById("closeClientFormBtn")?.addEventListener("click", closeClientFormModal);
    document.getElementById("cancelClientFormBtn")?.addEventListener("click", closeClientFormModal);
    document.getElementById("saveClientFormBtn")?.addEventListener("click", saveClientForm);

    document.getElementById("clientFormBackdrop")?.addEventListener("click", function(event){
        if(event.target === this){
            this.classList.add("d-none");
        }
    });
});

window.ClientForms = {
    buildVisitKey,
    renderFormsCell,
    wireFormsCellButtons,
    canEditClientForms
};
