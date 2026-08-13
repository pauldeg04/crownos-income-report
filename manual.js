/* ==========================================================================
   Crown Head Spa — User Manual page

   Read-only reference page. It stores nothing and syncs nothing — there is
   deliberately no localStorage write here, so opening the manual can never
   queue a Firestore push (see firebase-sync.js).
   ========================================================================== */

(function(){
    document.addEventListener("DOMContentLoaded", function(){

        /* ---------- Print / Save PDF ---------- */

        const printButton =
            document.getElementById("manualPrintBtn");

        if(printButton){
            printButton.addEventListener("click", function(){
                window.print();
            });
        }

        /* Troubleshooting answers are collapsed on screen to keep the page
           scannable, but a collapsed <details> prints as a bare heading with
           no answer underneath — so open them all for the print job and put
           them back afterwards. */

        function openAllAnswers(){
            document
                .querySelectorAll(".manual-doc details")
                .forEach(function(item){
                    item.dataset.wasOpen = item.open ? "true" : "false";
                    item.open = true;
                });
        }

        function restoreAllAnswers(){
            document
                .querySelectorAll(".manual-doc details")
                .forEach(function(item){
                    item.open = item.dataset.wasOpen === "true";
                });
        }

        window.addEventListener("beforeprint", openAllAnswers);
        window.addEventListener("afterprint", restoreAllAnswers);

        /* Safari fires a matchMedia change instead of beforeprint/afterprint. */
        if(window.matchMedia){
            const printQuery =
                window.matchMedia("print");

            printQuery.addEventListener("change", function(event){
                if(event.matches){
                    openAllAnswers();
                }else{
                    restoreAllAnswers();
                }
            });
        }

        /* ---------- Back to contents ---------- */

        const topButton =
            document.getElementById("manualTopBtn");

        if(topButton){
            topButton.addEventListener("click", function(){
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            });

            let ticking = false;

            window.addEventListener("scroll", function(){
                if(ticking){
                    return;
                }

                ticking = true;

                window.requestAnimationFrame(function(){
                    topButton.classList.toggle(
                        "is-visible",
                        window.scrollY > 700
                    );

                    ticking = false;
                });
            }, { passive: true });
        }

        /* ---------- Deep links ---------- */

        /* Landing on manual.html#ch-payroll (e.g. a link pasted into a group
           chat) should jump to that chapter. The browser's own jump fires
           before sidebar.js has prepended the fixed toolbar, which then sits
           over the heading — so re-run the jump once the chrome is in place.
           scroll-margin-top in manual.css handles every later in-page click. */

        if(location.hash){
            const target =
                document.getElementById(
                    location.hash.slice(1)
                );

            if(target){
                window.requestAnimationFrame(function(){
                    target.scrollIntoView();
                });
            }
        }
    });
})();
