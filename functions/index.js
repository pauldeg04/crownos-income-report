/* ==========================================================================
   Crown Head Spa — Cloud Functions backing the public booking flow.

   Two callables (getAvailableSlots, submitBookingRequest) are the only way
   the public website touches scheduling data — they compute availability
   and create tentative holds server-side, using data read live from the
   appData mirror (see appData.js) rather than a separate cached copy, so
   there's nothing here that can drift out of sync with CrownOS.

   A "hold" (scheduleHolds collection) is a capacity placeholder, not a
   real appointment — it has no bed/therapist assignment. Staff still
   convert it into a real appointment through the existing CrownOS
   "Create Appointment" flow (scheduling.js openNewModalFromBookingRequest
   / saveSchedule), which is unchanged by any of this.
   ========================================================================== */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

const EMAIL_PASSWORD = defineSecret("EMAIL_PASSWORD");
const SEMAPHORE_API_KEY = defineSecret("SEMAPHORE_API_KEY");
const BOOKING_EMAIL_FROM = "info@crownheadspa.com";

admin.initializeApp();
const db = admin.firestore();

const { readAppDataKey } = require("./appData");
const {
    computeSlots,
    countOverlapping,
    timeToMinutes,
    minutesToTimeValue,
    formatDisplayTime
} = require("./capacity");
const { buildGetGoogleReviews } = require("./googleReviews");

const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SERVICE_MASTER_KEY = "crownServiceMasterList";
const SCHEDULE_PREFIX = "crownSchedule_";
const BLOCKED_DATES_KEY = "crownBlockedDates";
const ALL_BRANCHES_LABEL = "All Branches";
const HOLDS_COLLECTION = "scheduleHolds";
const BOOKING_REQUESTS_COLLECTION = "bookingRequests";
const UNAVAILABLE_BEDS_KEY = "crownUnavailableBeds";
const USER_ACCOUNTS_KEY = "crownUserAccounts";
const STAFF_NOTIFICATIONS_COLLECTION = "staffNotifications";

/* Mirrors firebase-sync.js's toSyncEmail/toSyncPassword exactly — CrownOS
   usernames map to synthetic Firebase Auth emails, and a fixed suffix
   satisfies Firebase's 6-character password minimum. Duplicated here
   (rather than shared) because firebase-sync.js is a browser-only IIFE
   that assumes `window`. */
function toSyncEmail(username){
    const slug =
        String(username || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "-");

    return "u-" + slug + "@crownos-sync.com";
}

function toSyncPassword(password){
    return String(password || "") + "::CrownOS#sync";
}

const DEFAULT_UNKNOWN_SERVICE_MINUTES = 45; // used only for "Not sure yet"
const MANILA_UTC_OFFSET_MINUTES = 8 * 60;

/* Holds no longer expire on a flat duration from submission — instead
   every hold expires at a fixed 3PM Manila cutoff: requests submitted
   before noon expire 3PM that same day; requests submitted at noon or
   later expire 3PM the following day. */
const HOLD_CUTOFF_HOUR = 12; // noon — the before/after boundary
const HOLD_EXPIRY_HOUR = 15; // 3PM — the expiration time itself

/* ---------- shared lookups (never write appData; CrownOS owns it) ---------- */

async function getBranches(){
    const raw = await readAppDataKey(db, BRANCH_MASTER_KEY);
    if(!Array.isArray(raw)) return [];

    return raw.map(function(branch){
        if(typeof branch === "string"){
            return { name: branch, beds: 1, openingTime: "10:00", closingTime: "22:00" };
        }
        return {
            name: branch.name || "",
            beds: Number(branch.beds) || 1,
            openingTime: branch.openingTime || "10:00",
            closingTime: branch.closingTime || "22:00"
        };
    });
}

async function getServices(){
    const raw = await readAppDataKey(db, SERVICE_MASTER_KEY);
    if(!Array.isArray(raw)) return [];

    return raw.map(function(service){
        if(typeof service === "string"){
            return { name: service, duration: DEFAULT_UNKNOWN_SERVICE_MINUTES };
        }
        return {
            name: service.name || "",
            duration: Number(service.duration) || DEFAULT_UNKNOWN_SERVICE_MINUTES
        };
    });
}

async function getScheduleEntries(branchName, date){
    const raw = await readAppDataKey(db, SCHEDULE_PREFIX + branchName + "_" + date);
    if(!Array.isArray(raw)) return [];

    return raw
        .filter(function(item){ return item && item.status !== "Cancelled"; })
        .map(function(item){
            return { startTime: item.startTime, endTime: item.endTime };
        });
}

/* Staff-set "Block Date" entries from CrownOS's Scheduling page — see
   Income Report/scheduling.js. Checked by both getAvailableSlots and
   submitBookingRequest so a blocked date is refused server-side even if
   a stale page/cached slot list is submitted anyway. */
async function findBlockedEntry(branchName, date){
    const raw = await readAppDataKey(db, BLOCKED_DATES_KEY);
    const entries = Array.isArray(raw) ? raw : [];

    return entries.find(function(entry){
        return (
            entry &&
            entry.date === date &&
            (entry.branch === branchName || entry.branch === ALL_BRANCHES_LABEL)
        );
    }) || null;
}

/* Beds staff have taken offline for a specific branch+date (the "Available"
   checkbox on each bed column in Scheduling — see scheduling.js's
   crownUnavailableBeds). Subtracted from matchedBranch.beds before both
   capacity checks below so the public site's slot count/capacity gate stays
   consistent with what CrownOS itself will actually let staff book into. */
async function countUnavailableBeds(branchName, date){
    const raw = await readAppDataKey(db, UNAVAILABLE_BEDS_KEY);
    const entries = Array.isArray(raw) ? raw : [];

    return entries.filter(function(entry){
        return entry && entry.branch === branchName && entry.date === date;
    }).length;
}

/* Active holds for a branch/date, read outside a transaction (used by the
   read-only getAvailableSlots). submitBookingRequest re-reads inside its
   own transaction instead of trusting this snapshot. */
async function getActiveHolds(branchName, date){
    const snapshot = await db.collection(HOLDS_COLLECTION)
        .where("branch", "==", branchName)
        .where("date", "==", date)
        .get();

    const now = Date.now();

    return snapshot.docs
        .map(function(doc){ return doc.data(); })
        .filter(function(hold){
            return (
                hold.status === "pending" &&
                hold.expiresAt &&
                hold.expiresAt.toMillis() > now
            );
        })
        .map(function(hold){
            return { startTime: hold.startTime, endTime: hold.endTime };
        });
}

function nowInManila(){
    const manilaMs = Date.now() + MANILA_UTC_OFFSET_MINUTES * 60 * 1000;
    const manila = new Date(manilaMs);

    const dateString =
        manila.getUTCFullYear() + "-" +
        String(manila.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(manila.getUTCDate()).padStart(2, "0");

    const minutesOfDay = manila.getUTCHours() * 60 + manila.getUTCMinutes();

    return { dateString, minutesOfDay };
}

/* 3PM Manila on "today" if the current Manila time is before noon,
   otherwise 3PM Manila on "tomorrow" — see the HOLD_CUTOFF_HOUR/
   HOLD_EXPIRY_HOUR comment above. Returns a real UTC epoch-ms instant. */
function computeHoldExpiryMillis(){
    const manilaMs = Date.now() + MANILA_UTC_OFFSET_MINUTES * 60 * 1000;
    const manila = new Date(manilaMs);

    const minutesOfDay = manila.getUTCHours() * 60 + manila.getUTCMinutes();
    const daysToAdd = minutesOfDay < HOLD_CUTOFF_HOUR * 60 ? 0 : 1;

    const expiryAsManilaWallClockMs = Date.UTC(
        manila.getUTCFullYear(),
        manila.getUTCMonth(),
        manila.getUTCDate() + daysToAdd,
        HOLD_EXPIRY_HOUR, 0, 0, 0
    );

    return expiryAsManilaWallClockMs - MANILA_UTC_OFFSET_MINUTES * 60 * 1000;
}

function findBranch(branches, name){
    return branches.find(function(b){ return b.name === name; }) || null;
}

function findService(services, name){
    return services.find(function(s){ return s.name === name; }) || null;
}

function resolveDuration(services, serviceName){
    if(serviceName === "Not sure yet"){
        return DEFAULT_UNKNOWN_SERVICE_MINUTES;
    }
    const service = findService(services, serviceName);
    return service ? service.duration : null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------- getBookableBranches ---------- */

/* Lets the public site cap "Number of Guest" at each branch's actual bed
   count instead of guessing a fixed max — pulled from the same
   crownBranchMasterList staff edit in CrownOS (Master Lists > Branches).
   Only name/beds are exposed. */
exports.getBookableBranches = onCall(async () => {
    const branches = await getBranches();

    return {
        branches: branches.map(function(branch){
            return { name: branch.name, beds: branch.beds };
        })
    };
});

/* ---------- getBookableServices ---------- */

/* Lets the public site build its "Select a treatment" list from the same
   crownServiceMasterList staff edit in CrownOS (List of Services), instead
   of a hardcoded copy that silently goes stale whenever a name or duration
   changes there. Only the name/duration are exposed — never pricing or
   commission fields, which live on the same record. Inactive services and
   services not marked "Available for Online Booking" are left out entirely. */
exports.getBookableServices = onCall(async () => {
    const raw = await readAppDataKey(db, SERVICE_MASTER_KEY);
    const list = Array.isArray(raw) ? raw : [];

    const services = list
        .filter(function(service){
            return (
                service &&
                typeof service === "object" &&
                service.status === "Active" &&
                service.availableForOnlineBooking === true &&
                service.name &&
                Number(service.duration) > 0
            );
        })
        .map(function(service){
            return {
                name: service.name,
                duration: Number(service.duration)
            };
        })
        .sort(function(a, b){ return a.name.localeCompare(b.name); });

    return { services };
});

/* ---------- getGoogleReviews ---------- */

/* Backs the public testimonials page (see googleReviews.js). */
exports.getGoogleReviews = buildGetGoogleReviews(db);

/* ---------- getAvailableSlots ---------- */

exports.getAvailableSlots = onCall(async (request) => {
    const { branch, date, serviceName } = request.data || {};

    if(typeof branch !== "string" || typeof date !== "string" || typeof serviceName !== "string"){
        throw new HttpsError("invalid-argument", "branch, date, and serviceName are required.");
    }

    if(!DATE_PATTERN.test(date)){
        throw new HttpsError("invalid-argument", "date must be YYYY-MM-DD.");
    }

    const { dateString: today } = nowInManila();
    if(date < today){
        return { slots: [], durationMinutes: 0 };
    }

    const [branches, services] = await Promise.all([getBranches(), getServices()]);

    const matchedBranch = findBranch(branches, branch);
    if(!matchedBranch){
        throw new HttpsError("invalid-argument", "Unknown branch.");
    }

    const durationMinutes = resolveDuration(services, serviceName);
    if(!durationMinutes){
        throw new HttpsError("invalid-argument", "Unknown service.");
    }

    const blockedEntry = await findBlockedEntry(matchedBranch.name, date);
    if(blockedEntry){
        return { slots: [], durationMinutes: 0, blocked: true, reason: blockedEntry.reason || "" };
    }

    const [scheduleEntries, holds, unavailableBedCount] = await Promise.all([
        getScheduleEntries(matchedBranch.name, date),
        getActiveHolds(matchedBranch.name, date),
        countUnavailableBeds(matchedBranch.name, date)
    ]);

    let slots = computeSlots({
        openingTime: matchedBranch.openingTime,
        closingTime: matchedBranch.closingTime,
        durationMinutes: durationMinutes,
        beds: Math.max(0, matchedBranch.beds - unavailableBedCount),
        occupants: scheduleEntries.concat(holds)
    });

    if(date === today){
        const { minutesOfDay } = nowInManila();
        slots = slots.filter(function(slot){
            return timeToMinutes(slot.startTime) > minutesOfDay;
        });
    }

    return { slots, durationMinutes };
});

/* ---------- submitBookingRequest ---------- */

exports.submitBookingRequest = onCall(async (request) => {
    const data = request.data || {};
    const branch = String(data.branch || "");
    const serviceName = String(data.serviceName || "");
    const date = String(data.date || "");
    const startTime = String(data.startTime || "");
    const clientName = String(data.clientName || "").trim();
    const mobile = String(data.mobile || "").trim();
    const email = String(data.email || "").trim();
    const notes = String(data.notes || "").trim();
    /* Each companion now carries their own preferred service (previously
       just a name) so staff reviewing the request in CrownOS know what to
       book each guest in for — still purely informational, same as
       before: it does not add to the capacity/hold math below, which
       only reserves a slot for the primary booker. */
    const companions = Array.isArray(data.companions)
        ? data.companions
            .map(function(companion){
                return {
                    name: String(companion?.name || "").trim(),
                    serviceName: String(companion?.serviceName || "").trim()
                };
            })
            .filter(function(companion){
                return (
                    companion.name.length > 0 &&
                    companion.name.length <= 80 &&
                    companion.serviceName.length > 0 &&
                    companion.serviceName.length <= 120
                );
            })
            .slice(0, 10)
        : [];

    if(!DATE_PATTERN.test(date)){
        throw new HttpsError("invalid-argument", "date must be YYYY-MM-DD.");
    }
    if(!TIME_PATTERN.test(startTime)){
        throw new HttpsError("invalid-argument", "startTime must be HH:MM (24h).");
    }
    if(clientName.length < 2 || clientName.length > 80){
        throw new HttpsError("invalid-argument", "clientName must be 2-80 characters.");
    }
    if(mobile.length < 7 || mobile.length > 15){
        throw new HttpsError("invalid-argument", "mobile must be 7-15 characters.");
    }
    if(email.length > 120){
        throw new HttpsError("invalid-argument", "email is too long.");
    }
    if(notes.length > 500){
        throw new HttpsError("invalid-argument", "notes is too long.");
    }

    const { dateString: today } = nowInManila();
    if(date < today){
        throw new HttpsError("invalid-argument", "date is in the past.");
    }

    const [branches, services] = await Promise.all([getBranches(), getServices()]);

    const matchedBranch = findBranch(branches, branch);
    if(!matchedBranch){
        throw new HttpsError("invalid-argument", "Unknown branch.");
    }

    const durationMinutes = resolveDuration(services, serviceName);
    if(!durationMinutes){
        throw new HttpsError("invalid-argument", "Unknown service.");
    }

    const blockedEntry = await findBlockedEntry(matchedBranch.name, date);
    if(blockedEntry){
        return { ok: false, reason: "date_blocked" };
    }

    /* Drop any companion whose service doesn't resolve to a real one —
       normal visitors can't hit this (the form only offers real service
       names), this only guards a direct/malformed call to this function. */
    const validCompanions = companions.filter(function(companion){
        return (
            companion.serviceName === "Not sure yet" ||
            findService(services, companion.serviceName)
        );
    });

    if(date === today){
        const { minutesOfDay } = nowInManila();
        if(timeToMinutes(startTime) <= minutesOfDay){
            return { ok: false, reason: "no_capacity" };
        }
    }

    const endTime = minutesToTimeValue(timeToMinutes(startTime) + durationMinutes);

    const closingMinutes = timeToMinutes(matchedBranch.closingTime);
    if(timeToMinutes(endTime) > closingMinutes){
        return { ok: false, reason: "no_capacity" };
    }

    const [scheduleEntries, unavailableBedCount] = await Promise.all([
        getScheduleEntries(matchedBranch.name, date),
        countUnavailableBeds(matchedBranch.name, date)
    ]);

    const effectiveBeds = Math.max(0, matchedBranch.beds - unavailableBedCount);

    const holdsQuery = db.collection(HOLDS_COLLECTION)
        .where("branch", "==", matchedBranch.name)
        .where("date", "==", date);

    const result = await db.runTransaction(async (transaction) => {
        const holdsSnapshot = await transaction.get(holdsQuery);
        const now = Date.now();

        const activeHolds = holdsSnapshot.docs
            .map(function(doc){ return doc.data(); })
            .filter(function(hold){
                return (
                    hold.status === "pending" &&
                    hold.expiresAt &&
                    hold.expiresAt.toMillis() > now
                );
            });

        const occupied = countOverlapping(
            startTime, endTime,
            scheduleEntries.concat(activeHolds)
        );

        if(occupied >= effectiveBeds){
            return { ok: false, reason: "no_capacity" };
        }

        const requestRef = db.collection(BOOKING_REQUESTS_COLLECTION).doc();
        const holdRef = db.collection(HOLDS_COLLECTION).doc();

        transaction.set(requestRef, {
            branch: matchedBranch.name,
            serviceName: serviceName,
            date: date,
            time: formatDisplayTime(startTime),
            clientName: clientName,
            mobile: mobile,
            email: email,
            notes: notes,
            companions: validCompanions,
            status: "pending",
            source: "public-website",
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewedBy: "",
            convertedScheduleId: ""
        });

        transaction.set(holdRef, {
            branch: matchedBranch.name,
            date: date,
            startTime: startTime,
            endTime: endTime,
            durationMinutes: durationMinutes,
            serviceName: serviceName,
            clientName: clientName,
            mobile: mobile,
            email: email,
            notes: notes,
            status: "pending",
            bookingRequestId: requestRef.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromMillis(computeHoldExpiryMillis())
        });

        return { ok: true };
    });

    return result;
});

/* ---------- resetStaffCloudLogin ---------- */

/* Fixes the "silent cloud desync" bug documented in account-settings.js
   and firebase-sync.js: the Firebase client SDK can only change the
   password of the CURRENTLY signed-in user, so when an Admin resets
   someone ELSE's password from User Accounts, only the local (hashed,
   localStorage/appData) password changes — the target's Firebase Auth
   user keeps the old password forever and their device silently stops
   syncing on their next login. Running the same update with the Admin
   SDK here has no such restriction, so this keeps both in step in one
   step, from the Admin's own session, instead of leaving a manual
   re-provisioning step for later. */
exports.resetStaffCloudLogin = onCall(async (request) => {
    if(!request.auth || !request.auth.token || !request.auth.token.email){
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const targetUsername = String(request.data?.username || "").trim();
    const newPassword = String(request.data?.newPassword || "");

    if(!targetUsername){
        throw new HttpsError("invalid-argument", "username is required.");
    }
    if(newPassword.length < 6){
        throw new HttpsError("invalid-argument", "newPassword must be at least 6 characters.");
    }

    const users = await readAppDataKey(db, USER_ACCOUNTS_KEY);
    const accountList = Array.isArray(users) ? users : [];

    const caller = accountList.find(function(u){
        return toSyncEmail(u.account) === request.auth.token.email;
    });

    if(!caller || caller.role !== "Admin" || caller.status !== "Active"){
        throw new HttpsError("permission-denied", "Only an active Admin can reset another user's cloud login.");
    }

    const target = accountList.find(function(u){
        return u.account === targetUsername;
    });

    if(!target){
        throw new HttpsError("not-found", "No such CrownOS user account.");
    }

    const targetEmail = toSyncEmail(targetUsername);
    const syncedPassword = toSyncPassword(newPassword);

    try{
        const existing = await admin.auth().getUserByEmail(targetEmail);
        await admin.auth().updateUser(existing.uid, { password: syncedPassword });
    }catch(error){
        if(error.code === "auth/user-not-found"){
            await admin.auth().createUser({ email: targetEmail, password: syncedPassword });
        }else{
            throw new HttpsError("internal", "Could not update cloud login: " + error.message);
        }
    }

    return { ok: true };
});

/* Mints/refreshes a Firebase Auth custom claim (`role`) on the caller's
   OWN user, read from their current crownUserAccounts entry. Firestore
   security rules can't parse the JSON blobs the appData mirror stores
   role/account data in (see appData.js), so there was previously no way
   for rules to enforce CrownOS's Admin-only pages (access-control.js
   PAGE_ACCESS) — any authenticated user could read/write any appData
   doc directly via the SDK, bypassing the client-side page gate
   entirely. This claim is what firestore.rules checks instead.

   Called by the client right after every login (see firebase-sync.js
   CrownCloud.syncRole(), invoked from login.js) — the client must
   force an ID token refresh immediately after this call for the new
   claim to take effect on that session's Firestore requests. */
exports.syncMyRole = onCall(async (request) => {
    if(!request.auth || !request.auth.token || !request.auth.token.email){
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const users = await readAppDataKey(db, USER_ACCOUNTS_KEY);
    const accountList = Array.isArray(users) ? users : [];

    const account = accountList.find(function(u){
        return toSyncEmail(u.account) === request.auth.token.email;
    });

    if(!account || account.status !== "Active"){
        throw new HttpsError("permission-denied", "No active CrownOS account for this login.");
    }

    await admin.auth().setCustomUserClaims(request.auth.uid, {
        role: account.role
    });

    return { role: account.role };
});

/* ---------- releaseExpiredHolds (scheduled) ---------- */

exports.releaseExpiredHolds = onSchedule("every 15 minutes", async () => {
    const now = admin.firestore.Timestamp.now();

    const snapshot = await db.collection(HOLDS_COLLECTION)
        .where("status", "==", "pending")
        .where("expiresAt", "<=", now)
        .get();

    if(snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach(function(doc){
        batch.update(doc.ref, { status: "released" });
    });
    await batch.commit();
});

/* ---------- expireStaleBookingRequests (scheduled) ---------- */

/* A pending request whose requested date has already passed (Manila time)
   without staff action can no longer be honored — the guest's slot is gone.
   Marking it "expired" (rather than leaving it "pending" forever) both stops
   it cluttering the live pending list and, since history is simply "anything
   not pending" (see loadHistory below), surfaces it in Previous Requests
   automatically. */
exports.expireStaleBookingRequests = onSchedule(
    { schedule: "every 15 minutes", region: "asia-southeast1" },
    async () => {
        const nowManila = new Date(Date.now() + MANILA_UTC_OFFSET_MINUTES * 60 * 1000);
        const todayManila = nowManila.getUTCFullYear() + "-" +
            String(nowManila.getUTCMonth() + 1).padStart(2, "0") + "-" +
            String(nowManila.getUTCDate()).padStart(2, "0");

        const snapshot = await db.collection(BOOKING_REQUESTS_COLLECTION)
            .where("status", "==", "pending")
            .get();

        const stale = snapshot.docs.filter(function(doc){
            return String(doc.data().date || "") < todayManila;
        });

        if(stale.length === 0) return;

        const batch = db.batch();
        stale.forEach(function(doc){
            batch.update(doc.ref, {
                status: "expired",
                reviewedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
    }
);

/* ---------- releaseHoldOnRequestReview (trigger) ---------- */

exports.releaseHoldOnRequestReview = onDocumentUpdated(
    { document: BOOKING_REQUESTS_COLLECTION + "/{requestId}", region: "asia-southeast1" },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();

        const justReviewed =
            before.status !== after.status &&
            (after.status === "declined" || after.status === "converted" || after.status === "expired");

        if(!justReviewed) return;

        const snapshot = await db.collection(HOLDS_COLLECTION)
            .where("bookingRequestId", "==", event.params.requestId)
            .where("status", "==", "pending")
            .get();

        if(snapshot.empty) return;

        const batch = db.batch();
        snapshot.docs.forEach(function(doc){
            batch.update(doc.ref, { status: "released" });
        });
        await batch.commit();
    }
);

/* ---------- sendAppointmentEmailConfirmation / sendAppointmentSmsConfirmation (callable) ----------

   Staff now choose per-appointment, via a checkbox popup in the
   scheduling.js "Save Schedule" flow, whether to send a confirmation —
   replacing the old automatic send-on-convert trigger (which could not
   distinguish staff intent and would fire for every booking-request
   conversion regardless of whether the client wanted one). */

function buildMailer(){
    return nodemailer.createTransport({
        host: "smtpout.secureserver.net",
        port: 465,
        secure: true,
        auth: {
            user: BOOKING_EMAIL_FROM,
            pass: EMAIL_PASSWORD.value()
        }
    });
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

function formatDisplayDate(dateStr){
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));

    if(!match){
        return dateStr;
    }

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);

    return `${MONTH_NAMES[month]} ${day}, ${year}`;
}

function escapeHtml(value){
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function buildCompanionLinesText(companions){
    if(!Array.isArray(companions) || companions.length === 0){
        return "";
    }

    return (
        "\n\nCompanions:\n" +
        companions
            .map(function(companion){ return `- ${companion.name} (${companion.serviceName})`; })
            .join("\n")
    );
}

function buildConfirmationEmailText({ clientName, branch, serviceName, date, time, companions }){
    return (
        `Hi ${clientName || "there"},\n\n` +
        `Your booking at Crown Head Spa is confirmed!\n\n` +
        `Branch: ${branch}\n` +
        `Service: ${serviceName}\n` +
        `Date: ${date}\n` +
        `Time: ${time}` +
        buildCompanionLinesText(companions) +
        `\n\nThank you for booking with us\n\n` +
        `Kindly arrive early for check-in\n` +
        `Head spa clients: please avoid washing your hair before your visit for better checking of "Scalp Analysis" (For Serenity & Detox and Glow service).\n\n` +
        `Note: Discounts will be applied on the day of your visit.\n\n` +
        `See you soon\n\nCrown Head Spa\nwww.crownheadspa.com`
    );
}

function buildConfirmationEmailHtml({ clientName, branch, serviceName, date, time, companions }){
    const row = function(label, value){
        return `
            <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e4ddc9;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b645a;">${label}</td>
                <td style="padding:10px 0;border-bottom:1px solid #e4ddc9;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1a16;text-align:right;font-weight:600;">${escapeHtml(value)}</td>
            </tr>`;
    };

    const companionsSection =
        Array.isArray(companions) && companions.length > 0
            ? `
        <p style="margin:20px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b645a;">Companions</p>
        <ul style="margin:0;padding-left:18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1a16;line-height:1.7;">
            ${companions.map(function(companion){
                return `<li>${escapeHtml(companion.name)} &mdash; ${escapeHtml(companion.serviceName)}</li>`;
            }).join("")}
        </ul>`
            : "";

    return `
<!doctype html>
<html>
<head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#efeae0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#efeae0;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#f7f5f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(20,17,10,0.12);">

<tr>
    <td style="background-color:#0E1B3D;background-image:linear-gradient(180deg, #0E1B3D 0%, #16245C 100%);padding:28px 32px;text-align:center;">
        <img src="https://crownheadspa.com/images/crown-mark.png" width="44" height="44" alt="Crown Head Spa" style="display:block;margin:0 auto 10px;">
        <div style="font-family:'Cinzel Decorative',Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:.06em;color:#d4af37;font-weight:700;">CROWN HEAD SPA</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.18em;color:#e0c877;text-transform:uppercase;margin-top:4px;">Relax &middot; Renew &middot; Reign</div>
    </td>
</tr>

<tr>
    <td style="padding:32px;">
        <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1a16;">Hi ${escapeHtml(clientName) || "there"},</p>
        <p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1a16;">Your booking at <strong>Crown Head Spa</strong> is confirmed. We look forward to welcoming you.</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e4ddc9;border-radius:12px;padding:18px 20px;">
            ${row("Branch", branch)}
            ${row("Service", serviceName)}
            ${row("Date", date)}
            ${row("Time", time)}
        </table>
        ${companionsSection}

        <p style="margin:24px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1a16;font-weight:600;">Thank you for booking with us</p>

        <ul style="margin:0 0 16px;padding-left:18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b645a;line-height:1.6;">
            <li>Kindly arrive early for check-in</li>
            <li>Head spa clients: please avoid washing your hair before your visit for better checking of &quot;Scalp Analysis&quot; (For Serenity &amp; Detox and Glow service).</li>
        </ul>

        <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b645a;font-style:italic;">Note: Discounts will be applied on the day of your visit.</p>

        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1a16;">See you soon!</p>
    </td>
</tr>

<tr>
    <td style="background-color:#e4ddc9;padding:18px 32px;text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b645a;">Bi&ntilde;an: 0939 588 4068 &nbsp;&bull;&nbsp; Calamba: 0961 440 2807</div>
        <div style="margin-top:8px;">
            <a href="https://crownheadspa.com" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a9790a;text-decoration:none;font-weight:700;letter-spacing:.02em;">www.crownheadspa.com</a>
        </div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9c7d1c;margin-top:8px;">&copy; 2026 Crown Head Spa. All rights reserved.</div>
    </td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

exports.sendAppointmentEmailConfirmation = onCall(
    { secrets: [EMAIL_PASSWORD] },
    async (request) => {
        const data = request.data || {};
        const email = String(data.email || "").trim();

        if(!email){
            throw new HttpsError("invalid-argument", "email is required.");
        }

        const mailer = buildMailer();

        const companions = Array.isArray(data.companions)
            ? data.companions
                .map(function(companion){
                    return {
                        name: String(companion?.name || "").trim(),
                        serviceName: String(companion?.serviceName || "").trim()
                    };
                })
                .filter(function(companion){
                    return companion.name.length > 0 && companion.serviceName.length > 0;
                })
                .slice(0, 10)
            : [];

        const details = {
            clientName: String(data.clientName || "").trim(),
            branch: String(data.branch || "").trim(),
            serviceName: String(data.serviceName || "").trim(),
            date: formatDisplayDate(String(data.date || "").trim()),
            time: String(data.time || "").trim(),
            companions: companions
        };

        await mailer.sendMail({
            from: `"Crown Head Spa" <${BOOKING_EMAIL_FROM}>`,
            to: email,
            subject: "Your Crown Head Spa booking is confirmed",
            text: buildConfirmationEmailText(details),
            html: buildConfirmationEmailHtml(details)
        });

        return { ok: true };
    }
);

/* Strips diacritics (e.g. "Biñan" -> "Binan") so the SMS body stays in
   plain GSM-7 characters — a single accented letter forces the whole
   message into Unicode (UCS-2) encoding, which Smart appears to silently
   drop even though Semaphore reports it as "Sent". Display strings
   elsewhere (dashboard, BIR compliance, payroll) keep the real spelling;
   this only affects the outgoing SMS text. */
function toGsm7Safe(text){
    return String(text || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
}

/* Every branch name is "Crown Head Spa {City}" — the prefix is dropped
   here since it's already implied by the "Your Crown Head Spa booking..."
   opening line, keeping the message inside the 160-char single-segment
   limit (Semaphore bills per 160-char segment; going over doubles the
   cost of every send). */
function shortBranchName(branch){
    return String(branch || "").replace(/^Crown Head Spa\s*/i, "");
}

/* No link in this text — Smart silently drops SMS containing a URL from
   a sender name that isn't separately whitelisted for link content
   (confirmed via isolated test sends; a bare URL alone never arrived).
   The email confirmation still carries the website link. */
function buildConfirmationSmsText({ clientName, branch, serviceName, date, time, companions }){
    const companionNames =
        Array.isArray(companions)
            ? companions.map(function(companion){ return companion.name; }).filter(Boolean)
            : [];

    const companionLine =
        companionNames.length > 0
            ? `\nCompanion: ${companionNames.join(", ")}`
            : "";

    return toGsm7Safe(
        `Hi ${clientName || "there"}! Your Crown Head Spa booking is confirmed:\n` +
        `Service: ${serviceName}\n` +
        `Branch: ${shortBranchName(branch)}\n` +
        `Date: ${date}, ${time}` +
        companionLine +
        `\nSee you soon!`
    );
}

exports.sendAppointmentSmsConfirmation = onCall(
    { secrets: [SEMAPHORE_API_KEY] },
    async (request) => {
        const data = request.data || {};
        const mobile = String(data.mobile || "").trim();

        if(!mobile){
            throw new HttpsError("invalid-argument", "mobile is required.");
        }

        const companions =
            Array.isArray(data.companions) ? data.companions : [];

        const message = buildConfirmationSmsText({
            clientName: String(data.clientName || "").trim(),
            branch: String(data.branch || "").trim(),
            serviceName: String(data.serviceName || "").trim(),
            date: formatDisplayDate(String(data.date || "").trim()),
            time: String(data.time || "").trim(),
            companions: companions
        });

        let response;
        let bodyText;

        try {
            response = await fetch("https://api.semaphore.co/api/v4/messages", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    apikey: SEMAPHORE_API_KEY.value(),
                    number: mobile,
                    message: message
                })
            });
            bodyText = await response.text();
        } catch (networkError) {
            console.error("Semaphore request failed (network):", networkError);
            throw new HttpsError("unavailable", "Could not reach Semaphore: " + networkError.message);
        }

        let result;

        try {
            result = JSON.parse(bodyText);
        } catch (parseError) {
            console.error("Semaphore returned a non-JSON response:", response.status, bodyText);
            throw new HttpsError(
                "internal",
                `Semaphore returned an unexpected response (HTTP ${response.status}): ${bodyText.slice(0, 300)}`
            );
        }

        console.log("Semaphore response:", response.status, JSON.stringify(result));

        if(!response.ok || result?.message){
            const reason = result?.message || JSON.stringify(result);
            console.error("Semaphore API error:", response.status, reason);
            throw new HttpsError("internal", `Semaphore error: ${reason}`);
        }

        return { ok: true, result };
    }
);

/* ---------- notifyReceptionistsOnNewBookingRequest (trigger) ----------

   Fires once per new pending request regardless of whether any staff
   browser happens to be open — the client-owned "crownNotifications" list
   (mirrored 1:1 from localStorage, see appData.js) can't be written here
   safely (the next client sync would just overwrite it), so this uses its
   own plain Firestore collection instead. CrownOS reads it via a direct
   query in notifications.js (staffNotifications where recipientEmail ==
   the signed-in user's synthetic sync email), merged into the same
   notification bell as therapist schedule-assignment notices. */

exports.notifyReceptionistsOnNewBookingRequest = onDocumentCreated(
    { document: BOOKING_REQUESTS_COLLECTION + "/{requestId}", region: "asia-southeast1" },
    async (event) => {
        const request = event.data?.data();

        if(!request){
            return;
        }

        const users = await readAppDataKey(db, USER_ACCOUNTS_KEY);

        if(!Array.isArray(users)){
            return;
        }

        const recipients = users.filter(function(user){
            return (
                user &&
                user.role === "Receptionist" &&
                user.status === "Active" &&
                user.account &&
                Array.isArray(user.branches) &&
                user.branches.includes(request.branch)
            );
        });

        if(recipients.length === 0){
            return;
        }

        const message =
            `New booking request: ${request.clientName || "Guest"} — ` +
            `${request.serviceName || "Service"} on ${request.date} ` +
            `${request.time} (${request.branch}).`;

        const batch = db.batch();

        recipients.forEach(function(user){
            const ref = db.collection(STAFF_NOTIFICATIONS_COLLECTION).doc();

            batch.set(ref, {
                account: user.account,
                recipientEmail: toSyncEmail(user.account),
                branch: request.branch,
                date: request.date,
                type: "booking-request",
                message: message,
                requestId: event.params.requestId,
                read: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
    }
);
