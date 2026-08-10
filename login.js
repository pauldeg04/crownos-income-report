const DUTY_LOG_KEY = "crownDutyLog";
const LOGIN_ATTENDANCE_LOG_KEY = "crownAttendanceLog";

let pendingLoginUser = null;

/* Note: CrownAuth.ensureDefaultAdmin() is intentionally NOT called on
   page load — on a fresh device it would fabricate a default admin
   before the cloud sync pulls the real account list. authenticate()
   still calls it internally for true offline first-run setups. */
document.addEventListener("DOMContentLoaded", function(){
    if(CrownAuth.getCurrentUser()){
        location.href = "home.html";
        return;
    }

    document
        .getElementById("loginForm")
        .addEventListener("submit", login);

    document
        .getElementById("dutyTherapistBtn")
        .addEventListener("click", function(){
            finishLoginWithDuty("Therapist");
        });

    document
        .getElementById("dutyReceptionistBtn")
        .addEventListener("click", function(){
            finishLoginWithDuty("Receptionist");
        });

    document
        .getElementById("dutyConflictBackBtn")
        .addEventListener("click", backToLoginFromConflict);
});

function getTodayDateString(){
    const today = new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
}

function getDutyLog(){
    try{
        const raw =
            localStorage.getItem(DUTY_LOG_KEY);

        const parsed =
            raw ? JSON.parse(raw) : {};

        return (parsed && typeof parsed === "object") ? parsed : {};
    }catch(error){
        console.error("Unable to load duty log:", error);
        return {};
    }
}

/* Guards against the case where a dual-role account clocked in as one
   duty, logged out WITHOUT clocking out, then logs back in and picks
   the OTHER duty — that would leave the earlier session open while a
   new one starts under a different role/rate. Returns the duty of an
   still-open (clocked in, not yet out) session today, or null if none. */
function getOpenDutyForToday(userId, date){
    try{
        const raw =
            localStorage.getItem(LOGIN_ATTENDANCE_LOG_KEY);

        const parsed =
            raw ? JSON.parse(raw) : [];

        const entries =
            Array.isArray(parsed) ? parsed : [];

        const openEntry =
            entries.find(function(entry){
                return (
                    entry.userId === userId &&
                    entry.date === date &&
                    entry.clockInAt &&
                    !entry.clockOutAt
                );
            });

        return openEntry
            ? (openEntry.dutyRole || "Therapist")
            : null;
    }catch(error){
        console.error("Unable to check open attendance session:", error);
        return null;
    }
}

function saveDutyChoice(userId, duty){
    const log =
        getDutyLog();

    log[userId + "_" + getTodayDateString()] = duty;

    localStorage.setItem(
        DUTY_LOG_KEY,
        JSON.stringify(log)
    );
}

async function login(event){
    event.preventDefault();

    const account =
        document
            .getElementById("accountInput")
            .value
            .trim();

    const password =
        document
            .getElementById("passwordInput")
            .value;

    const button =
        document.getElementById("loginBtn");

    const error =
        document.getElementById("errorMsg");

    error.style.display = "none";
    button.disabled = true;
    button.textContent = "Signing In...";

    try{
        /* Cloud-first: sign in to Firebase so this device pulls the
           latest shared data (accounts, sales, schedules) before the
           local credential check runs. Falls back to local-only when
           offline or when the cloud account does not exist yet. */
        let cloudStatus = "unavailable";

        if(window.CrownCloud?.isAvailable()){
            cloudStatus =
                await CrownCloud.login(account, password);

            if(cloudStatus === "cloud"){
                /* crownClientMasterList alone is multiple MB and only
                   grows over time — a brand-new device with no local
                   cache yet has to download and parse all of it (plus
                   everything else) before this resolves, and that can
                   genuinely take longer than the previous 20s budget on
                   an ordinary connection. A device that already has a
                   local cache from a prior login barely touches this
                   wait at all, since its pull is mostly incremental. */
                button.textContent = "Syncing Data...";
                await CrownCloud.waitForInitialSync(45000);
            }
        }

        let user =
            await CrownAuth.authenticate(
                account,
                password
            );

        /* On a slow connection (mobile data, a weak branch WiFi signal)
           the pull can still be mid-flight when the wait above times
           out — it keeps running in the background regardless, so a
           short second wait here often catches it landing moments
           later, instead of forcing every sign-in to eat the full
           worst-case wait up front. Without this, a correct password
           on a slow device fails with the same generic error as a
           wrong one, and simply retrying moments later "just works" —
           this makes that retry automatic. */
        if(!user && cloudStatus === "cloud"){
            button.textContent = "Still Syncing...";
            await CrownCloud.waitForInitialSync(30000);

            user = await CrownAuth.authenticate(
                account,
                password
            );
        }

        if(!user){
            if(cloudStatus === "cloud"){
                CrownCloud.signOut();
            }

            error.style.display = "block";
            return;
        }

        /* First cloud login for this account: create its Firebase
           user so the same credentials work on any device next time. */
        if(cloudStatus === "no-account"){
            await CrownCloud.provision(account, password);
            await CrownCloud.waitForInitialSync(12000);
        }

        /* Refresh this session's role claim (see firestore.rules /
           functions.syncMyRole) now that we have a signed-in cloud user
           either way (existing account or just-provisioned). Best-effort:
           a failure here shouldn't block login — it only means this
           session won't pass the role-gated rules until its next login. */
        if(cloudStatus === "cloud" || cloudStatus === "no-account"){
            await CrownCloud.syncRole?.();
        }

        /* Therapist with a Receptionist secondary role: ask which
           duty applies today before finishing login — Payroll needs
           to know before it can compute today's rate correctly. */
        if(
            user.role === "Therapist" &&
            user.secondaryRole === "Receptionist"
        ){
            pendingLoginUser = user;
            showDutyPicker();
            return;
        }

        finishLogin(user);
    }catch(errorObject){
        console.error(errorObject);
        error.textContent =
            "Unable to sign in. Please try again.";
        error.style.display = "block";
    }finally{
        button.disabled = false;
        button.textContent = "Login";
    }
}

function showDutyPicker(){
    document.getElementById("loginFormCard")
        .classList.add("d-none");

    document.getElementById("dutyPickerCard")
        .classList.remove("d-none");
}

async function finishLoginWithDuty(duty){
    if(!pendingLoginUser){
        return;
    }

    const openDuty =
        getOpenDutyForToday(pendingLoginUser.id, getTodayDateString());

    if(openDuty && openDuty !== duty){
        showDutyConflict(openDuty, duty);
        return;
    }

    document.getElementById("dutyTherapistBtn").disabled = true;
    document.getElementById("dutyReceptionistBtn").disabled = true;

    saveDutyChoice(pendingLoginUser.id, duty);
    await finishLogin(pendingLoginUser);
}

function showDutyConflict(openDuty, attemptedDuty){
    document.getElementById("dutyPickerCard")
        .classList.add("d-none");

    document.getElementById("dutyConflictMessage").textContent =
        `You're still clocked in as ${openDuty} from an earlier session today. Please log back in and clock out as ${openDuty} first before switching to ${attemptedDuty} duty.`;

    document.getElementById("dutyConflictCard")
        .classList.remove("d-none");
}

/* authenticate() already wrote a session (see access-control.js) before
   the duty picker ever showed, so a real logout is required here — not
   just hiding the popup — otherwise reloading login.html would bounce
   straight into home.html via the DOMContentLoaded check above. */
async function backToLoginFromConflict(){
    const button =
        document.getElementById("dutyConflictBackBtn");

    button.disabled = true;

    await CrownAuth.logout();

    pendingLoginUser = null;

    document.getElementById("accountInput").value = "";
    document.getElementById("passwordInput").value = "";

    document.getElementById("dutyTherapistBtn").disabled = false;
    document.getElementById("dutyReceptionistBtn").disabled = false;

    document.getElementById("dutyConflictCard")
        .classList.add("d-none");

    document.getElementById("dutyPickerCard")
        .classList.add("d-none");

    document.getElementById("loginFormCard")
        .classList.remove("d-none");

    button.disabled = false;
}

async function finishLogin(user){
    const allowedBranches =
        CrownAuth.getAllowedBranches(user);

    if(allowedBranches.length === 1){
        localStorage.setItem(
            "crownSelectedBranch",
            allowedBranches[0]
        );
    }else{
        localStorage.removeItem(
            "crownSelectedBranch"
        );
    }

    /* Guards against the same navigate-before-flush race the sidebar
       click interceptor covers — this redirect is JS-triggered, not a
       real link click, so it needs its own explicit flush. */
    await window.CrownCloud?.flushNow?.();

    location.href = "home.html";
}
