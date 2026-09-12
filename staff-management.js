/* ==========================================================================
   Staff Management — tab controller

   Switches between the Staff Schedule / Leave Request / Change Rest Day /
   Incident Report / Payroll panels above. Each panel's own script (loaded
   separately, unchanged) keeps running underneath regardless of which tab
   is visible. Reads ?tab= so sidebar.js's notification links can land on
   the right tab directly.
   ========================================================================== */

(function(){
    const PANELS = {
        schedule: "scheduleTabPanel",
        leave: "leaveTabPanel",
        restday: "restdayTabPanel",
        incident: "incidentTabPanel",
        payroll: "payrollTabPanel"
    };

    function selectTab(tab){
        if(!PANELS[tab]){
            tab = "schedule";
        }

        document.querySelectorAll('#staffManagementTabs [role="tab"]').forEach(function(btn){
            btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
        });

        Object.keys(PANELS).forEach(function(key){
            document.getElementById(PANELS[key]).classList.toggle("d-none", key !== tab);
        });
    }

    /* Tech Support gets this page, but Staff Schedule / Incident Report /
       Payroll aren't relevant to them (no clock in/out, never part of a
       payroll group — see clock-widget.js / payroll.js). Hide those three
       tab buttons entirely rather than gating content, since there's no
       existing per-tab role precedent to extend. */
    const HIDDEN_TABS_FOR_TECH_SUPPORT = ["schedule", "incident", "payroll"];

    document.addEventListener("DOMContentLoaded", function(){
        const currentUser = window.CrownAuth?.getCurrentUser?.();
        const isTechSupport = currentUser?.role === "Tech Support";

        if(isTechSupport){
            HIDDEN_TABS_FOR_TECH_SUPPORT.forEach(function(tab){
                document.querySelector(`#staffManagementTabs [data-tab="${tab}"]`)?.classList.add("d-none");
            });
        }

        document.querySelectorAll('#staffManagementTabs [role="tab"]').forEach(function(btn){
            btn.addEventListener("click", function(){
                selectTab(btn.dataset.tab);
            });
        });

        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        const defaultTab = isTechSupport ? "leave" : "schedule";
        selectTab(requestedTab && !(isTechSupport && HIDDEN_TABS_FOR_TECH_SUPPORT.includes(requestedTab)) ? requestedTab : defaultTab);
    });
})();
