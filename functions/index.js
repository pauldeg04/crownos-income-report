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
const admin = require("firebase-admin");

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

const BRANCH_MASTER_KEY = "crownBranchMasterList";
const SERVICE_MASTER_KEY = "crownServiceMasterList";
const SCHEDULE_PREFIX = "crownSchedule_";
const BLOCKED_DATES_KEY = "crownBlockedDates";
const ALL_BRANCHES_LABEL = "All Branches";
const HOLDS_COLLECTION = "scheduleHolds";
const BOOKING_REQUESTS_COLLECTION = "bookingRequests";
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

/* ---------- getBookableServices ---------- */

/* Lets the public site build its "Select a treatment" list from the same
   crownServiceMasterList staff edit in CrownOS (List of Services), instead
   of a hardcoded copy that silently goes stale whenever a name or duration
   changes there. Only the name/duration are exposed — never pricing or
   commission fields, which live on the same record. Inactive services are
   left out entirely. */
exports.getBookableServices = onCall(async () => {
    const raw = await readAppDataKey(db, SERVICE_MASTER_KEY);
    const list = Array.isArray(raw) ? raw : [];

    const services = list
        .filter(function(service){
            return (
                service &&
                typeof service === "object" &&
                service.status === "Active" &&
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

    const [scheduleEntries, holds] = await Promise.all([
        getScheduleEntries(matchedBranch.name, date),
        getActiveHolds(matchedBranch.name, date)
    ]);

    let slots = computeSlots({
        openingTime: matchedBranch.openingTime,
        closingTime: matchedBranch.closingTime,
        durationMinutes: durationMinutes,
        beds: matchedBranch.beds,
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

    const scheduleEntries = await getScheduleEntries(matchedBranch.name, date);

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

        if(occupied >= matchedBranch.beds){
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

/* ---------- releaseHoldOnRequestReview (trigger) ---------- */

exports.releaseHoldOnRequestReview = onDocumentUpdated(
    { document: BOOKING_REQUESTS_COLLECTION + "/{requestId}", region: "asia-southeast1" },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();

        const justReviewed =
            before.status !== after.status &&
            (after.status === "declined" || after.status === "converted");

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
