/* Crown Head Spa — minimal service worker.
   Only exists to satisfy "Add to Home Screen" installability on
   Android/Chrome. Intentionally does NOT cache anything — this app
   is updated frequently and relies on live Firestore sync, so every
   request should always go straight to the network. */

self.addEventListener("install", function(event){
    self.skipWaiting();
});

self.addEventListener("activate", function(event){
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function(event){
    event.respondWith(fetch(event.request));
});
