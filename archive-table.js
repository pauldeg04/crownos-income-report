/* Collapsible "Archive" table shown under a list's main table.
   CrownArchive.create(mainTbody) clones the main table's header into a
   second table inside a <details>, and returns { body, finish(count) }. */
window.CrownArchive = (function(){
    function create(mainTbody, label){
        const mainTable = mainTbody.closest("table");
        const wrap = mainTable.closest(".table-responsive") || mainTable;

        const details = document.createElement("details");
        details.className = "archive-section";
        details.innerHTML = `
            <summary>
                <span class="archive-title">${label || "Archive"}</span>
                <span class="archive-count">0</span>
            </summary>
            <div class="table-responsive archive-table-wrap">
                <table class="${mainTable.className} archive-table">
                    <thead>${mainTable.querySelector("thead").innerHTML}</thead>
                    <tbody></tbody>
                </table>
            </div>
            <div class="archive-empty">Nothing archived.</div>
        `;
        wrap.insertAdjacentElement("afterend", details);

        const body = details.querySelector("tbody");
        const counter = details.querySelector(".archive-count");
        const empty = details.querySelector(".archive-empty");
        const tableWrap = details.querySelector(".archive-table-wrap");

        return {
            body: body,
            reset: function(){ body.innerHTML = ""; },
            finish: function(count){
                counter.textContent = count;
                empty.hidden = count > 0;
                tableWrap.hidden = count === 0;
            }
        };
    }

    return { create: create };
})();
