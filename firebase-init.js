/* ==========================================================================
   Crown Head Spa — Firebase Initialization
   Loaded on every page after the Firebase compat SDK script tags.
   ========================================================================== */

const CROWN_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAwt7ujvJSwB-fiamMG9Se7qJAQUTLT2D8",
    authDomain: "crownos-5f03d.firebaseapp.com",
    projectId: "crownos-5f03d",
    storageBucket: "crownos-5f03d.firebasestorage.app",
    messagingSenderId: "182273921486",
    appId: "1:182273921486:web:99bcb0ece0607bad165b9f"
};

if(
    window.firebase &&
    typeof firebase.initializeApp === "function" &&
    firebase.apps.length === 0
){
    firebase.initializeApp(CROWN_FIREBASE_CONFIG);
}
