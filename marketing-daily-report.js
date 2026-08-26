/* ==========================================================================
   Crown Head Spa — Marketing / Daily Report

   Data model (Firestore):
     marketingDailyReports/{reportId}
       branch, date ("YYYY-MM-DD"), employee, hoursStart, hoursEnd,
       inquiriesReceived, inquiriesAnswered, confirmedBookings,
       pendingCustomers, cancelledBookings, escalatedConcerns,
       conversionRate, summaryNotes, hotLeads: [{customerName,
       interestedService, followUpSchedule}], remarks, preparedBy,
       timeSubmitted, createdAt, createdBy

   One report per branch per day, filled in from the branch's own
   end-of-day recap (see the "Daily Report" sheet this replaces).
   The reports table on this page is scoped to the branch selected on
   the Dashboard and to the month picked above the table.
   ========================================================================== */

(function(){
    const REPORTS_COLLECTION = "marketingDailyReports";
    const BRANCH_KEY = "crownSelectedBranch";

    let currentUser = null;
    let reportsCache = [];
    let hotLeadRowCount = 0;

    function getSelectedBranch(){
        return localStorage.getItem(BRANCH_KEY) || "";
    }

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function db(){
        return firebase.firestore();
    }

    function formatDisplayDate(dateString){
        if(!dateString){
            return "";
        }

        return new Date(dateString + "T00:00:00").toLocaleDateString("en-PH", {
            month: "short",
            day: "2-digit",
            year: "numeric"
        });
    }

    function formatDisplayTime(timeString){
        if(!timeString){
            return "";
        }

        const [hours, minutes] = timeString.split(":").map(Number);
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);

        return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }

    function computeConversionRate(received, confirmed){
        const receivedNum = Number(received) || 0;
        const confirmedNum = Number(confirmed) || 0;

        if(receivedNum <= 0){
            return 0;
        }

        return Math.round((confirmedNum / receivedNum) * 100);
    }

    /* ---- Month filter ---- */

    function setCurrentMonth(){
        const monthInput = document.getElementById("marketingDailyMonth");

        if(!monthInput.value){
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, "0");

            monthInput.value = `${year}-${month}`;
        }
    }

    /* ---- Load / render ---- */

    function loadReports(){
        const branch = getSelectedBranch();

        if(!branch){
            reportsCache = [];
            renderReports();
            return Promise.resolve();
        }

        return db()
            .collection(REPORTS_COLLECTION)
            .where("branch", "==", branch)
            .get()
            .then(function(snapshot){
                reportsCache = snapshot.docs.map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                });

                renderReports();
            })
            .catch(function(error){
                console.error("Unable to load daily reports:", error);
            });
    }

    function reportsForSelectedMonth(){
        const month = document.getElementById("marketingDailyMonth").value;

        return reportsCache
            .filter(function(report){
                return !month || (report.date || "").slice(0, 7) === month;
            })
            .sort(function(a, b){
                return (b.date || "").localeCompare(a.date || "");
            });
    }

    function renderReports(){
        const body = document.getElementById("marketingDailyTableBody");
        const empty = document.getElementById("marketingDailyEmptyState");

        const reports = reportsForSelectedMonth();

        if(reports.length === 0){
            body.innerHTML = "";
            empty.classList.remove("d-none");
            return;
        }

        empty.classList.add("d-none");

        body.innerHTML = reports.map(function(report){
            return `
                <tr>
                    <td>${escapeHtml(formatDisplayDate(report.date))}</td>
                    <td>${escapeHtml(report.inquiriesReceived ?? 0)}</td>
                    <td>${escapeHtml(report.confirmedBookings ?? 0)}</td>
                    <td>${escapeHtml(report.cancelledBookings ?? 0)}</td>
                    <td>${escapeHtml(report.conversionRate ?? 0)}%</td>
                    <td><button type="button" class="btn btn-sm btn-outline-secondary marketing-daily-remarks-btn" data-id="${escapeHtml(report.id)}">View</button></td>
                    <td><button type="button" class="btn btn-sm btn-outline-primary marketing-daily-view-btn" data-id="${escapeHtml(report.id)}">View</button></td>
                </tr>
            `;
        }).join("");

        body.querySelectorAll(".marketing-daily-remarks-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openRemarksModal(btn.dataset.id);
            });
        });

        body.querySelectorAll(".marketing-daily-view-btn").forEach(function(btn){
            btn.addEventListener("click", function(){
                openViewModal(btn.dataset.id);
            });
        });
    }

    /* ---- Hot leads (repeatable rows) ---- */

    function addHotLeadRow(values){
        hotLeadRowCount++;

        const row = document.createElement("tr");
        row.dataset.rowId = String(hotLeadRowCount);

        row.innerHTML = `
            <td><input type="text" class="form-control form-control-sm hot-lead-name" placeholder="Customer name"></td>
            <td><input type="text" class="form-control form-control-sm hot-lead-service" placeholder="Interested service"></td>
            <td><input type="text" class="form-control form-control-sm hot-lead-followup" placeholder="Follow-up schedule"></td>
            <td><button type="button" class="btn btn-sm btn-outline-danger hot-lead-remove-btn">&times;</button></td>
        `;

        document.getElementById("dailyHotLeadsBody").appendChild(row);

        if(values){
            row.querySelector(".hot-lead-name").value = values.customerName || "";
            row.querySelector(".hot-lead-service").value = values.interestedService || "";
            row.querySelector(".hot-lead-followup").value = values.followUpSchedule || "";
        }

        row.querySelector(".hot-lead-remove-btn").addEventListener("click", function(){
            row.remove();
        });
    }

    function readHotLeads(){
        const rows = document.querySelectorAll("#dailyHotLeadsBody tr");
        const leads = [];

        rows.forEach(function(row){
            const customerName = row.querySelector(".hot-lead-name").value.trim();
            const interestedService = row.querySelector(".hot-lead-service").value.trim();
            const followUpSchedule = row.querySelector(".hot-lead-followup").value.trim();

            if(customerName || interestedService || followUpSchedule){
                leads.push({ customerName, interestedService, followUpSchedule });
            }
        });

        return leads;
    }

    /* ---- Create Report ---- */

    function updateConversionReadout(){
        const received = document.getElementById("dailyInquiriesReceivedInput").value;
        const confirmed = document.getElementById("dailyConfirmedBookingsInput").value;

        document.getElementById("dailyConversionRateReadout").value =
            computeConversionRate(received, confirmed) + "%";
    }

    function openCreateModal(){
        document.getElementById("dailyEmployeeInput").value = "";
        document.getElementById("dailyDateInput").value = new Date().toISOString().slice(0, 10);
        document.getElementById("dailyHoursStartInput").value = "";
        document.getElementById("dailyHoursEndInput").value = "";

        document.getElementById("dailyInquiriesReceivedInput").value = "";
        document.getElementById("dailyInquiriesAnsweredInput").value = "";
        document.getElementById("dailyConfirmedBookingsInput").value = "";
        document.getElementById("dailyPendingCustomersInput").value = "";
        document.getElementById("dailyCancelledBookingsInput").value = "";
        document.getElementById("dailyEscalatedConcernsInput").value = "";
        document.getElementById("dailyConversionRateReadout").value = "0%";
        document.getElementById("dailySummaryNotesInput").value = "";

        document.getElementById("dailyHotLeadsBody").innerHTML = "";
        addHotLeadRow();

        document.getElementById("dailyRemarksInput").value = "None";
        document.getElementById("dailyPreparedByInput").value =
            currentUser?.nickname || currentUser?.account || "";

        const now = new Date();
        document.getElementById("dailyTimeSubmittedInput").value =
            String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

        document.getElementById("marketingDailyCreateBackdrop").classList.remove("d-none");
    }

    function closeCreateModal(){
        document.getElementById("marketingDailyCreateBackdrop").classList.add("d-none");
    }

    async function saveCreate(){
        const employee = document.getElementById("dailyEmployeeInput").value.trim();
        const date = document.getElementById("dailyDateInput").value;
        const branch = getSelectedBranch();

        if(!employee){
            alert("Please enter the employee's name.");
            return;
        }

        if(!date){
            alert("Please select a date.");
            return;
        }

        if(!branch){
            alert("Please select a branch from the Dashboard first.");
            return;
        }

        const inquiriesReceived = Number(document.getElementById("dailyInquiriesReceivedInput").value) || 0;
        const confirmedBookings = Number(document.getElementById("dailyConfirmedBookingsInput").value) || 0;

        const payload = {
            branch,
            date,
            employee,
            hoursStart: document.getElementById("dailyHoursStartInput").value,
            hoursEnd: document.getElementById("dailyHoursEndInput").value,
            inquiriesReceived,
            inquiriesAnswered: Number(document.getElementById("dailyInquiriesAnsweredInput").value) || 0,
            confirmedBookings,
            pendingCustomers: Number(document.getElementById("dailyPendingCustomersInput").value) || 0,
            cancelledBookings: Number(document.getElementById("dailyCancelledBookingsInput").value) || 0,
            escalatedConcerns: Number(document.getElementById("dailyEscalatedConcernsInput").value) || 0,
            conversionRate: computeConversionRate(inquiriesReceived, confirmedBookings),
            summaryNotes: document.getElementById("dailySummaryNotesInput").value.trim(),
            hotLeads: readHotLeads(),
            remarks: document.getElementById("dailyRemarksInput").value.trim() || "None",
            preparedBy: document.getElementById("dailyPreparedByInput").value.trim(),
            timeSubmitted: document.getElementById("dailyTimeSubmittedInput").value,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: currentUser.account
        };

        const btn = document.getElementById("marketingDailyCreateSaveBtn");
        btn.disabled = true;

        try{
            await db().collection(REPORTS_COLLECTION).add(payload);

            closeCreateModal();
            await loadReports();
        }catch(error){
            console.error("Unable to save this daily report:", error);
            alert("Unable to save this report. Please try again.");
        }finally{
            btn.disabled = false;
        }
    }

    /* ---- Remarks view ---- */

    function openRemarksModal(reportId){
        const report = reportsCache.find(function(item){ return item.id === reportId; });

        if(!report){
            return;
        }

        document.getElementById("marketingDailyRemarksBody").innerHTML = `
            <div class="marketing-notes-row">
                <span>${escapeHtml(report.remarks || "None").replace(/\n/g, "<br>")}</span>
            </div>
        `;

        document.getElementById("marketingDailyRemarksBackdrop").classList.remove("d-none");
    }

    function closeRemarksModal(){
        document.getElementById("marketingDailyRemarksBackdrop").classList.add("d-none");
    }

    /* ---- Full report view ---- */

    function renderHotLeadsView(hotLeads){
        if(!hotLeads || hotLeads.length === 0){
            return '<div class="empty-state">No hot leads logged for this day.</div>';
        }

        const rows = hotLeads.map(function(lead){
            return `
                <tr>
                    <td>${escapeHtml(lead.customerName)}</td>
                    <td>${escapeHtml(lead.interestedService)}</td>
                    <td>${escapeHtml(lead.followUpSchedule)}</td>
                </tr>
            `;
        }).join("");

        return `
            <div class="table-responsive">
                <table class="table marketing-table align-middle">
                    <thead>
                        <tr>
                            <th>Customer Name</th>
                            <th>Interested Service</th>
                            <th>Follow-up Schedule</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function openViewModal(reportId){
        const report = reportsCache.find(function(item){ return item.id === reportId; });

        if(!report){
            return;
        }

        document.getElementById("marketingDailyViewTitle").textContent =
            (report.branch || "") + " — " + formatDisplayDate(report.date);

        const hoursLabel = (report.hoursStart && report.hoursEnd)
            ? `${formatDisplayTime(report.hoursStart)} – ${formatDisplayTime(report.hoursEnd)}`
            : "—";

        document.getElementById("marketingDailyViewBody").innerHTML = `
            <div class="row g-3 mb-3">
                <div class="col-md-4">
                    <div class="marketing-notes-row"><strong>Employee</strong><span>${escapeHtml(report.employee)}</span></div>
                </div>
                <div class="col-md-4">
                    <div class="marketing-notes-row"><strong>Date</strong><span>${escapeHtml(formatDisplayDate(report.date))}</span></div>
                </div>
                <div class="col-md-4">
                    <div class="marketing-notes-row"><strong>Working Hours</strong><span>${hoursLabel}</span></div>
                </div>
            </div>

            <h6 class="fw-bold text-uppercase text-muted marketing-daily-section-title">Daily Summary</h6>

            <div class="table-responsive mb-3">
                <table class="table marketing-table align-middle">
                    <thead>
                        <tr>
                            <th>Inquiries Received</th>
                            <th>Inquiries Answered</th>
                            <th>Confirmed Bookings</th>
                            <th>Pending Customers</th>
                            <th>Cancelled Bookings</th>
                            <th>Escalated Concerns</th>
                            <th>Conversion Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>${escapeHtml(report.inquiriesReceived ?? 0)}</td>
                            <td>${escapeHtml(report.inquiriesAnswered ?? 0)}</td>
                            <td>${escapeHtml(report.confirmedBookings ?? 0)}</td>
                            <td>${escapeHtml(report.pendingCustomers ?? 0)}</td>
                            <td>${escapeHtml(report.cancelledBookings ?? 0)}</td>
                            <td>${escapeHtml(report.escalatedConcerns ?? 0)}</td>
                            <td>${escapeHtml(report.conversionRate ?? 0)}%</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            ${report.summaryNotes ? `
                <div class="marketing-notes-row mb-3">
                    <strong>Summary Notes</strong>
                    <span>${escapeHtml(report.summaryNotes).replace(/\n/g, "<br>")}</span>
                </div>
            ` : ""}

            <h6 class="fw-bold text-uppercase text-muted marketing-daily-section-title">Hot Leads (Likely to Book)</h6>

            ${renderHotLeadsView(report.hotLeads)}

            <h6 class="fw-bold text-uppercase text-muted marketing-daily-section-title mt-3">Remarks</h6>

            <div class="marketing-notes-row mb-3">
                <span>${escapeHtml(report.remarks || "None").replace(/\n/g, "<br>")}</span>
            </div>

            <div class="row g-3">
                <div class="col-md-6">
                    <div class="marketing-notes-row"><strong>Prepared by</strong><span>${escapeHtml(report.preparedBy)}</span></div>
                </div>
                <div class="col-md-6">
                    <div class="marketing-notes-row"><strong>Time Submitted</strong><span>${escapeHtml(formatDisplayTime(report.timeSubmitted))}</span></div>
                </div>
            </div>
        `;

        document.getElementById("marketingDailyViewBackdrop").classList.remove("d-none");
    }

    function closeViewModal(){
        document.getElementById("marketingDailyViewBackdrop").classList.add("d-none");
    }

    /* ---- Wire up ---- */

    document.addEventListener("DOMContentLoaded", function(){
        if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
            return;
        }

        currentUser = window.CrownAuth?.getCurrentUser?.();

        if(!currentUser){
            return;
        }

        document.getElementById("marketingDailyBranchReadout").textContent = getSelectedBranch();

        setCurrentMonth();
        loadReports();

        document.getElementById("marketingDailyMonth").addEventListener("change", renderReports);

        document.getElementById("marketingDailyCreateBtn").addEventListener("click", openCreateModal);
        document.getElementById("marketingDailyCreateCloseBtn").addEventListener("click", closeCreateModal);
        document.getElementById("marketingDailyCreateCancelBtn").addEventListener("click", closeCreateModal);
        document.getElementById("marketingDailyCreateSaveBtn").addEventListener("click", saveCreate);

        document.getElementById("marketingDailyCreateBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeCreateModal();
            }
        });

        document.getElementById("dailyAddHotLeadBtn").addEventListener("click", function(){
            addHotLeadRow();
        });

        document.getElementById("dailyInquiriesReceivedInput").addEventListener("input", updateConversionReadout);
        document.getElementById("dailyConfirmedBookingsInput").addEventListener("input", updateConversionReadout);

        document.getElementById("marketingDailyRemarksCloseBtn").addEventListener("click", closeRemarksModal);
        document.getElementById("marketingDailyRemarksCloseFooterBtn").addEventListener("click", closeRemarksModal);

        document.getElementById("marketingDailyRemarksBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeRemarksModal();
            }
        });

        document.getElementById("marketingDailyViewCloseBtn").addEventListener("click", closeViewModal);
        document.getElementById("marketingDailyViewCloseFooterBtn").addEventListener("click", closeViewModal);

        document.getElementById("marketingDailyViewBackdrop").addEventListener("click", function(event){
            if(event.target === event.currentTarget){
                closeViewModal();
            }
        });
    });
})();
