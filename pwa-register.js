if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
        navigator.serviceWorker.register("/sw.js").catch(function(error){
            console.warn("Service worker registration failed:", error);
        });
    });
}
