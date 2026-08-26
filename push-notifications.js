/* ==========================================================================
   CrownOS — Push Notification token lifecycle
   Registers this device's FCM token in "staffPushTokens" (one doc per
   token, doc ID = the token itself) so functions/index.js can push to it.
   Actual notification delivery + badge-from-background happens in sw.js;
   this file only manages the opt-in toggle and keeps the token fresh.
   ========================================================================== */

/* From Firebase Console → crownos-5f03d → Project Settings → Cloud
   Messaging → Web configuration → Web Push certificates. */
const CROWN_PUSH_VAPID_KEY = "BIguJM4QEhtjv5FhLABNcuCywiis_wNWjERdRtXMewxtS3lPI6qAZSk2AIRwWL-8aTHpXob6RG6DKfAfQHxKIaA";

const CROWN_PUSH_PERMISSION_KEY = "crownPushEnabled";

function crownPushSupported(){
    return (
        typeof window !== "undefined" &&
        "Notification" in window &&
        "serviceWorker" in navigator &&
        window.firebase &&
        typeof firebase.messaging === "function"
    );
}

function crownPushTokenDoc(token){
    return firebase.firestore().collection("staffPushTokens").doc(token);
}

async function crownRegisterPushToken(){
    if(!crownPushSupported()){
        return null;
    }

    const user = window.CrownAuth?.getCurrentUser?.();

    if(!user?.account || !firebase.apps || firebase.apps.length === 0){
        return null;
    }

    try{
        const registration = await navigator.serviceWorker.ready;

        const token = await firebase.messaging().getToken({
            vapidKey: CROWN_PUSH_VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if(!token){
            return null;
        }

        await crownPushTokenDoc(token).set({
            account: user.account,
            recipientEmail: crownToSyncEmail(user.account),
            token: token,
            userAgent: navigator.userAgent || "",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        return token;
    }catch(error){
        console.error("Unable to register push token:", error);
        return null;
    }
}

async function crownEnablePushNotifications(){
    if(!crownPushSupported()){
        return { ok: false, reason: "unsupported" };
    }

    const permission = await Notification.requestPermission();

    if(permission !== "granted"){
        return { ok: false, reason: "denied" };
    }

    const token = await crownRegisterPushToken();

    if(!token){
        return { ok: false, reason: "token-failed" };
    }

    localStorage.setItem(CROWN_PUSH_PERMISSION_KEY, "true");
    return { ok: true };
}

async function crownDisablePushNotifications(){
    localStorage.removeItem(CROWN_PUSH_PERMISSION_KEY);

    if(!crownPushSupported()){
        return;
    }

    try{
        const token = await firebase.messaging().getToken({
            vapidKey: CROWN_PUSH_VAPID_KEY
        });

        if(token){
            await crownPushTokenDoc(token).delete();
        }

        await firebase.messaging().deleteToken();
    }catch(error){
        console.error("Unable to disable push notifications:", error);
    }

    try{
        await navigator.clearAppBadge?.();
    }catch(error){
        /* Badging API unsupported on this platform — nothing to clean up. */
    }
}

function crownPushIsEnabled(){
    return (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        localStorage.getItem(CROWN_PUSH_PERMISSION_KEY) === "true"
    );
}

const CROWN_PUSH_PROMPTED_KEY = "crownPushPrompted";

/* Defaults every account to notifications ON: the very first time a
   browser reaches this line with an undecided Notification permission,
   it fires the native permission prompt automatically instead of waiting
   for the user to visit Account Settings. The OS/browser permission
   dialog itself can never be skipped (no API can grant it silently) — this
   only removes the extra step of finding the toggle. Fires at most once
   per browser (crownPushPrompted persists the outcome either way, so a
   dismissal/deny isn't re-asked on every login); on every later load where
   permission is already granted, it just keeps the token fresh. */
firebase.auth().onAuthStateChanged(function(user){
    if(!user){
        return;
    }

    if(crownPushIsEnabled()){
        crownRegisterPushToken();
        return;
    }

    if(
        crownPushSupported() &&
        Notification.permission === "default" &&
        !localStorage.getItem(CROWN_PUSH_PROMPTED_KEY)
    ){
        localStorage.setItem(CROWN_PUSH_PROMPTED_KEY, "true");
        crownEnablePushNotifications();
    }
});

window.CrownPush = {
    isSupported: crownPushSupported,
    isEnabled: crownPushIsEnabled,
    enable: crownEnablePushNotifications,
    disable: crownDisablePushNotifications
};
