/* Tab switcher for Product Settings / Branch Settings.
   Each tab lazy-loads the original list page in an iframe (?embed=1 hides
   its sidebar and heading). The chosen tab lives in the URL hash. */
(function(){
    const tabs = Array.from(document.querySelectorAll(".st-tab"));
    const frames = Array.from(document.querySelectorAll(".st-frame"));
    if(!tabs.length){ return; }

    const wasHidden = new Map();

    function show(key){
        if(!tabs.some(t => t.dataset.tab === key)){ key = tabs[0].dataset.tab; }
        tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === key));
        frames.forEach(f => {
            const on = f.dataset.tab === key;
            f.hidden = !on;
            if(on && !f.getAttribute("src")){
                f.setAttribute("src", f.dataset.src);
            }else if(on && f.hidden !== on && wasHidden.get(f)){
                /* Services and Add-ons share one stored list: reload when
                   coming back so a stale copy never overwrites newer edits. */
                try{ f.contentWindow.location.reload(); }catch(e){}
            }
            wasHidden.set(f, !on);
        });
        history.replaceState(null, "", "#" + key);
    }

    tabs.forEach(t => t.addEventListener("click", () => show(t.dataset.tab)));
    show(location.hash.replace("#", ""));
})();
