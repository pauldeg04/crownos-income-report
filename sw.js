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
    // Only pass through same-origin GET requests. Firebase Storage uploads
    // (bir-compliance.js's uploadFile(), and every other uploadXAttachment()
    // in the app) are cross-origin, multi-step requests to
    // firebasestorage.googleapis.com — intercepting and re-issuing those via
    // respondWith(fetch(...)) is what was breaking them (surfaced as
    // "Firebase Storage: An unknown error occurred... (storage/unknown)"),
    // most visibly on mobile Safari/the installed PWA. Letting the browser
    // handle non-GET/cross-origin requests directly, untouched, fixes it —
    // this handler existing at all is only needed for installability
    // checks, not for actually serving anything.
    const url = new URL(event.request.url);
    if(event.request.method !== "GET" || url.origin !== self.location.origin){
        return;
    }
    event.respondWith(fetch(event.request));
});
