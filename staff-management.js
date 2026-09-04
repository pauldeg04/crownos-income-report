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

    document.addEventListener("DOMContentLoaded", function(){
        document.querySelectorAll('#staffManagementTabs [role="tab"]').forEach(function(btn){
            btn.addEventListener("click", function(){
                selectTab(btn.dataset.tab);
            });
        });

        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        selectTab(requestedTab || "schedule");
    });
})();
