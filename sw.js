/* Crown Head Spa — service worker.
   Primarily exists to satisfy "Add to Home Screen" installability on
   Android/Chrome. Intentionally does NOT cache anything — this app
   is updated frequently and relies on live Firestore sync, so every
   request should always go straight to the network.

   Also handles FCM push delivery while CrownOS itself isn't running —
   see push-notifications.js for the token registration side and
   functions/index.js (sendPushToAccount) for what sends these. */

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
    apiKey: "AIzaSyAwt7ujvJSwB-fiamMG9Se7qJAQUTLT2D8",
    authDomain: "crownos-5f03d.firebaseapp.com",
    projectId: "crownos-5f03d",
    storageBucket: "crownos-5f03d.firebasestorage.app",
    messagingSenderId: "182273921486",
    appId: "1:182273921486:web:99bcb0ece0607bad165b9f"
});

firebase.messaging().onBackgroundMessage(function(payload){
    const title = payload.notification?.title || "CrownOS";
    const body = payload.notification?.body || "";
    const badgeCount = Number(payload.data?.badgeCount || 0);

    self.registration.showNotification(title, {
        body: body,
        icon: "icon-192.png"
    });

    if(self.navigator?.setAppBadge){
        self.navigator.setAppBadge(badgeCount).catch(function(){
            /* Badging API from a service worker isn't supported on every
               platform (notably iOS Safari) — degrade silently. */
        });
    }
});

self.addEventListener("install", function(event){
    self.skipWaiting();
});

self.addEventListener("activate", function(event){
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function(event){
    event.respondWith(fetch(event.request));
});
