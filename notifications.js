/* ==========================================================================
   CrownOS — Notifications
   Stored under one "crown"-prefixed key so firebase-sync.js mirrors it to
   Firestore automatically, same as every other CrownOS data list.

   A notification is addressed to a recipient by one or both of:
     - account: the staff member's login username (works for any role)
     - therapistName: the Therapist Master List name (how schedule
       assignments identify a person, independent of their login)
   A lookup matches if EITHER field matches, so a Therapist notified by
   therapistName (schedule assignment) and a Receptionist notified by
   account (attendance reminder) both work through the same lookup.
   ========================================================================== */

const CROWN_NOTIFICATIONS_KEY = "crownNotifications";
const CROWN_NOTIFICATIONS_MAX = 300;

function crownReadNotifications(){
    try{
        const raw = localStorage.getItem(CROWN_NOTIFICATIONS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    }catch(error){
        console.error("Unable to load notifications:", error);
        return [];
    }
}

function crownWriteNotifications(list){
    localStorage.setItem(
        CROWN_NOTIFICATIONS_KEY,
        JSON.stringify(list)
    );
}

function crownNotificationId(){
    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8)
    );
}

function crownNormalize(value){
    return String(value || "").trim().toLowerCase();
}

/* entry: { account, therapistName, branch, date, message, scheduleId, type }
   At least one of account / therapistName must be set. */
function crownAddNotification(entry){
    const account = crownNormalize(entry?.account);
    const therapistName = crownNormalize(entry?.therapistName);

    if(!entry || (!account && !therapistName)){
        return;
    }

    const list = crownReadNotifications();

    list.unshift({
        id: crownNotificationId(),
        account: entry.account || "",
        therapistName: entry.therapistName || "",
        branch: entry.branch || "",
        date: entry.date || "",
        type: entry.type || "schedule",
        message: entry.message || "",
        scheduleId: entry.scheduleId || "",
        read: false,
        createdAt: new Date().toISOString()
    });

    crownWriteNotifications(
        list.slice(0, CROWN_NOTIFICATIONS_MAX)
    );
}

function crownMatchesRecipient(item, recipient){
    const itemAccount = crownNormalize(item.account);
    const itemTherapist = crownNormalize(item.therapistName);
    const account = crownNormalize(recipient?.account);
    const therapistName = crownNormalize(recipient?.therapistName);

    return (
        (account && itemAccount === account) ||
        (therapistName && itemTherapist === therapistName)
    );
}

/* recipient: { account, therapistName } — same shape as an add() entry */
function crownGetNotificationsForUser(recipient){
    if(!recipient || (!recipient.account && !recipient.therapistName)){
        return [];
    }

    return crownReadNotifications().filter(function(item){
        return crownMatchesRecipient(item, recipient);
    });
}

function crownMarkNotificationRead(id){
    const list = crownReadNotifications();

    const match = list.find(function(item){
        return item.id === id;
    });

    if(match && !match.read){
        match.read = true;
        crownWriteNotifications(list);
    }
}

function crownMarkAllNotificationsRead(recipient){
    if(!recipient || (!recipient.account && !recipient.therapistName)){
        return;
    }

    const list = crownReadNotifications();
    let changed = false;

    list.forEach(function(item){
        if(!item.read && crownMatchesRecipient(item, recipient)){
            item.read = true;
            changed = true;
        }
    });

    if(changed){
        crownWriteNotifications(list);
    }
}

window.CrownNotifications = {
    add: crownAddNotification,
    getForUser: crownGetNotificationsForUser,
    markRead: crownMarkNotificationRead,
    markAllRead: crownMarkAllNotificationsRead
};

/* ==========================================================================
   CrownOS — Server-created notifications ("staffNotifications" collection)

   Separate from crownNotifications/CrownNotifications above: that list is
   mirrored 1:1 from localStorage (client-owned, last-write-wins), so a
   Cloud Function can't safely add to it — the next client sync would just
   overwrite the addition. Server-created notices (e.g.
   notifyReceptionistsOnNewBookingRequest in
   Income Report/functions/index.js) live in their own plain Firestore
   collection instead, one doc per notification, and are merged into the
   same bell UI by the caller (see dashboard.js).
   ========================================================================== */

/* Mirrors toSyncEmail() in firebase-sync.js / functions/index.js — see
   the comment on the server-side copy for why this can't just be
   imported/shared instead. */
function crownToSyncEmail(username){
    const slug =
        String(username || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "-");

    return "u-" + slug + "@crownos-sync.com";
}

/* recipient: { account } — listens live for that account's server
   notifications and calls onChange(list) on every update. Returns an
   unsubscribe function (a no-op if Firestore isn't available). Sorted
   client-side (newest first) rather than via .orderBy() in the query —
   an equality filter (recipientEmail) plus an orderBy on a different
   field (createdAt) would otherwise require a composite Firestore index,
   same reasoning as booking-requests.js. */
function crownListenServerNotifications(recipient, onChange){
    if(
        !window.firebase ||
        !firebase.apps ||
        firebase.apps.length === 0 ||
        !recipient?.account
    ){
        onChange([]);
        return function(){};
    }

    return firebase.firestore()
        .collection("staffNotifications")
        .where("recipientEmail", "==", crownToSyncEmail(recipient.account))
        .onSnapshot(function(snapshot){
            const list = snapshot.docs
                .map(function(doc){
                    return Object.assign({ id: doc.id }, doc.data());
                })
                .sort(function(a, b){
                    const aTime = a.createdAt?.toMillis?.() || 0;
                    const bTime = b.createdAt?.toMillis?.() || 0;
                    return bTime - aTime;
                });

            onChange(list);
        }, function(error){
            console.error("Unable to load server notifications:", error);
            onChange([]);
        });
}

function crownMarkServerNotificationRead(id){
    if(!window.firebase || !firebase.apps || firebase.apps.length === 0 || !id){
        return;
    }

    firebase.firestore()
        .collection("staffNotifications")
        .doc(id)
        .update({ read: true })
        .catch(function(error){
            console.error("Unable to mark server notification read:", error);
        });
}

function crownMarkAllServerNotificationsRead(list){
    if(!window.firebase || !firebase.apps || firebase.apps.length === 0){
        return;
    }

    const unread = (list || []).filter(function(item){
        return !item.read;
    });

    if(unread.length === 0){
        return;
    }

    const batch = firebase.firestore().batch();

    unread.forEach(function(item){
        batch.update(
            firebase.firestore().collection("staffNotifications").doc(item.id),
            { read: true }
        );
    });

    batch.commit().catch(function(error){
        console.error("Unable to mark server notifications read:", error);
    });
}

window.CrownServerNotifications = {
    listenForUser: crownListenServerNotifications,
    markRead: crownMarkServerNotificationRead,
    markAllRead: crownMarkAllServerNotificationsRead
};
