# CrownOS Work Log

Running log of changes made to the CrownOS system, newest entry on top.

---

## 2026-08-13 — Booking-request history, and stock that deducts itself off the sale

Two separate pieces of work. The booking history is live; the inventory work is
committed but **not deployed** — see its status note below.

### Booking-request history (deployed)

**Problem:** Booking Requests only ever listed pending rows, so the moment a request
was converted or declined it left the screen for good. There was no way to check back
on what a guest had asked for, or who handled it.

**Built:** a Show History toggle under the pending table, opening a read-only
Previous Requests table — the same columns plus an Outcome column carrying
"Appointment created" / "Declined", the reviewer's account and the time they acted.

- Read on demand, not on a second `onSnapshot`. It is reference material opened
  occasionally, not a working queue, so a permanent listener on the whole collection
  would be waste.
- The query orders by `submittedAt` and drops pending rows in the browser rather than
  filtering on status in Firestore — an equality filter plus `orderBy` on a different
  field needs a composite index, which the pending list already goes out of its way to
  avoid. Nothing to deploy to `firestore.indexes.json`.
- Fetches the latest 200 submissions; the note under the table says so when that cap
  is what is bounding the list.
- Same branch restriction as the pending list — a receptionist cannot read back guests
  from a branch they cannot see.

**Day picker:** filters rows already in memory, so stepping through days costs no
further reads. Its `‹ ›` buttons reuse the Scheduling page's `.date-stepper-group`
markup and the shared `CrownDateStepper` helper, so month and year rollovers behave
identically in both places.

Filters on **date submitted**, not the guest's preferred date — the point of looking
back is to find a request you remember receiving, not one whose appointment happened
to fall on a given day. `submittedAt` is a Timestamp, so it is reduced to `yyyy-mm-dd`
in local time to match the Submitted column beside it: a request arriving 11:45 PM
belongs to the day the receptionist saw it come in.

**Worth knowing:** there is no such thing as an expired booking request. The three
statuses are `pending`, `converted` and `declined` — what expires is the *slot hold*
(`releaseExpiredHolds` flips `scheduleHolds` to `released`), while the request itself
stays `pending` forever. So the pending list grows without bound, and its count is not
a picture of what still needs acting on. Either decline stale ones by hand, or add a
scheduled function moving them to a new `expired` status — the latter needs
`firestore.rules` widened, which today allows only `converted` and `declined`.

**Status:** deployed and verified at https://crownos-5f03d.web.app/booking-requests.html.

### Inventory: stock deducted automatically off the Daily Income Report (NOT deployed)

**What it does:** an inventory item can be tagged in Inventory Settings with what
consumes it — Retail links to one product, Services links to any number of services,
Branch Consumption links to neither. Saving a sale in the Daily Income Report then
turns every service carrying linked items into a row in that branch's Stock Audit
table, dated and attributed to the sale's therapist and client, and deducts it from
that branch's stock.

Editing the same sale re-runs the sync, which reconciles by sale id instead of
duplicating: a new line deducts, a line that disappeared gives the stock back, and a
surviving line keeps its Serial No. and any field edited by hand. Deleting or voiding
a sale un-consumes everything it logged.

**Two details that are easy to get wrong and were not:**
- `adjustBranchStock()` floors at zero, so consuming an item the branch has already
  run out of takes less than asked for. `consumeBranchStock()` records what was
  *actually* taken, so voiding that sale cannot hand the branch stock it never had.
- Add Stock now runs through `transactionalAddWarehouseStock()`. A local write only
  reaches the cloud via firebase-sync's debounced push, and the send helpers
  re-validate against a live read — so an Add Stock followed quickly by a Send Stock
  could be rejected against the pre-add quantity. Transacting the add closes that
  window without flushing this device's snapshot over another device's commit.

**The one line that makes it work:** `index.html` gains
`<script src="inventory-data.js"></script>`. Without it the Daily Income Report cannot
reach the inventory layer and the whole feature silently does nothing — no error, no
audit rows, no deduction.

**No new sync config needed:** firebase-sync.js selects keys by exclusion, not by
whitelist, so `crownStockAudit` and `crownProductMasterList` mirror on their own.

**Status: committed, NOT deployed.** Deploying it changes real stock numbers across
both branches on the first sale saved afterwards, so it wants a deliberate go-ahead
rather than riding along with an unrelated deploy. Verified only to the extent that
static checks allow — all five touched scripts parse, the hooks are wired at four call
sites in `script.js`, and no TODO markers remain. Whether the *quantities* come out
right has not been checked against live data.

**Deploy note for whoever ships it:** `firebase deploy --only hosting` from
`Income Report/` publishes the whole folder, so it will also carry anything else
uncommitted in the working tree at that moment. Check `git status` first.

---

## 2026-08-12 — Google reviews for both branches on the public testimonials page

**Requested by:** User — the testimonials section showed Google reviews for Biñan only,
via an Elfsight widget whose free tier allows a single source. Wanted Calamba shown too.

**Why not just add a second widget:** Elfsight's free tier is one widget per account, and
working around that with a second Google account would breach their terms and put the
working Biñan widget at risk. Replaced the widget entirely instead.

**Built:**
1. [`functions/googleReviews.js`](functions/googleReviews.js) — new `getGoogleReviews`
   callable. Reads both branches from the Google Places API (New) server-side.
   - Place IDs are resolved once from branch name + coordinates, then cached in Firestore
     (`publicCache/googlePlaceIds`) forever — place IDs never change and are exempt from
     Google's caching limit, so this costs one Text Search call ever.
   - Review payloads cached 6 hours in `publicCache/googleReviews`, far inside the 30-day
     cap Google's terms put on caching place content. Works out to ~240 API calls/month.
   - Falls back to stale cache if Google fails, rather than showing an empty section.
   - API key lives in the `GOOGLE_PLACES_API_KEY` secret, never in client code.
2. `Website/testimonials.html` — Elfsight script and widget divs removed; branch tabs
   (Biñan / Calamba) with one panel each.
3. `Website/js/main.js` — `initBranchTabs()` and `initGoogleReviews()`. All review text is
   set with `textContent`, never `innerHTML` — it is public-authored content.
4. `Website/css/style.css` — `.branch-tab` pills and `.review-card` grid.

**Hard limit worth remembering:** the Places API returns a maximum of **5 reviews per
place**, sorted by relevance, with no way to ask for more or to sort by date. The rating
and total review count are for the whole listing, which is why the summary line above the
cards carries them (Biñan 5.0/389, Calamba 5.0/304 at time of writing).

**Status:** Deployed and verified live at https://crownheadspa.com/testimonials.html —
both branch tabs render real Google data (Biñan 5.0/389, Calamba 5.0/304), no console errors.

**Deploy note:** the public website is a *separate* hosting site (`crownheadspa`) configured
in `Website/firebase.json`, not the `crownos-5f03d` site that `Income Report/firebase.json`
serves. Deploy it with `firebase deploy --only hosting:crownheadspa` **from the `Website/`
directory** — running `--only hosting` from `Income Report/` deploys the internal CrownOS
app instead and silently leaves the public site unchanged.

**Setup friction hit along the way (for future reference):**
- `firebase-tools` was no longer installed (Node upgraded to v24 wiped global npm packages);
  the cached login in `~/.config/configstore/firebase-tools.json` survived. Ran everything
  via `npx -y firebase-tools@latest` instead of reinstalling — no sudo needed.
- The first two `functions:secrets:set` attempts stored an invalid key. Cause: the terminal
  prompt masks input, so Cmd+V landed twice and stored the 39-char key duplicated to 78
  chars. Google reports this as `INVALID_ARGUMENT API key not valid`, which is misleading.

**Follow-up done same day:** the dead `href="#"` "Leave a Review" button was replaced with two
per-branch buttons opening Google's review composer. `getGoogleReviews` now also returns a
`writeReviewUrl` built from each branch's place ID; the markup ships with the plain Maps
listing links as a fallback so the buttons are never dead if the call fails. Added
`CACHE_VERSION` to the cache doc so a deploy that changes the payload shape doesn't serve the
old shape for up to six hours.

**Key secured:** the Places API key is now restricted to **Places API (New)** only, with
Application restrictions left at `None` (Cloud Run has no fixed egress IP, so an IP or
referrer restriction would block our own function). Verified afterwards by bumping
`CACHE_VERSION` to force a real API round trip rather than a cache read — `cached: false`
with both branches returning, so the restricted key works.

**Still open:**
- Elfsight account can be cancelled now that nothing uses it.

---

## 2026-08-11 — New in-app User Manual page

**Requested by:** User — wanted the CrownOS staff manual to live inside the
system itself, in the Settings section of the sidebar, rather than as a
separate link staff have to be sent.

**Change:**
- [`manual.html`](manual.html), [`manual.css`](manual.css),
  [`manual.js`](manual.js) — new read-only reference page. 25 chapters across
  six parts (Getting Started, Daily Operations, Inventory, Reports,
  Administration, Reference), covering login and the duty picker, the
  Dashboard clock-in/GPS rules, the full Add Sale walkthrough, vouchers and
  VIP cards, the payroll formulas per role, inventory, every report page, the
  master lists, backup/restore, plus checklists and troubleshooting. Opens
  with a Contents card linking to each chapter.
- [`sidebar.js`](sidebar.js) — added "User Manual" to `MENU_ITEMS` as the last
  Settings entry, plus a `?` entry in `MENU_ICONS`. Deliberately **not**
  `branchRequired`: the page reads no branch data, so it stays reachable
  before a branch is picked — which is exactly when a new staff member needs
  it.
- [`access-control.js`](access-control.js) — added `manual.html` to
  `PAGE_ACCESS` for all six roles including Branch Device. A Therapist or a
  branch tablet needs the manual as much as an Admin does. Not added to
  `account-settings.js`'s `EXTRA_ACCESS_PAGES` — with every role already
  allowed there is nothing left to grant.

**Notes on the CSS:** every rule in `manual.css` is scoped under `.manual-doc`
(or `.manual-contents`). The page loads `shared.css`, `sidebar.css` and
Bootstrap like any other page, and the manual sets its own heading scale,
table style and link colour — none of which should leak into the rest of the
app. Class names were checked against shared/sidebar/style/crownos-theme for
collisions before use. Two specificity traps found and handled: `.page-eyebrow`
lives in each page's own stylesheet rather than `shared.css` (so it is
repeated here), and `shared.css`'s `.card.shadow-sm{box-shadow:… !important}`
is a two-class selector that a bare `.card` cannot override even with
`!important` — the print block matches its specificity to strip card chrome
on paper.

**Printing:** `@media print` drops all app chrome (sidebar, global toolbar,
the `position:fixed` mobile hamburger, both page buttons), starts each part on
a fresh page, repeats table headers via `display:table-header-group`, and
unfreezes the access matrix's sticky first column while clearing its
`min-width` — without that, four of the six role columns print clipped.
`manual.js` opens the Troubleshooting `<details>` before printing and restores
them after, since a collapsed `<details>` otherwise prints as a bare question
with no answer.

**Verified:** against an isolated offline copy of the app (Firebase SDK and
`firebase-init.js` stripped, so `firebase-sync.js` takes its offline branch and
nothing could reach production), logged in with the local bootstrap admin.
Confirmed: the item appears last under Settings and stays enabled with no
branch selected; the page passes the access guard; all 25 chapters, 6 parts and
25 contents links render with no broken anchors; `canAccessPage` returns true
for all six roles while Cash Flow / Data Protection / Daily Income gating is
unchanged; no layout overflow at 1280px or 375px; contents links land 61px
clear of the fixed toolbar (`scroll-margin-top`); and in print all eight tables
fit a 760px paper column with no chrome and no card shadows. Dashboard still
renders with no console errors after the `sidebar.js` edit.

**Status:** Deployed — `firebase deploy --only hosting` → live at
https://crownos-5f03d.web.app/manual.html

**Noticed during this deploy, NOT fixed (user chose to handle separately):**
`firebase.json`'s hosting block is `"public": "."` with an ignore list that
covers `*.txt`, `**/.*`, `node_modules` and `CrownOS_Full_Backup*.json` — but
nothing else. Every other non-web file in this folder is therefore served
publicly with no authentication. Confirmed live (HTTP 200, no login) before
this deploy, so it predates it:
`crown-clients-import.json` (1,274 client records — name, birthday,
contactNumber, email, sex, notes, totalSpent), `crown-clients-import-pos-2026-07-26.json`,
`Calamba Branch Clients List.xlsx`, `Binan Branch Clients List.xlsx`,
`Cash Flow Data.xlsx`, and `WORK_LOG.md` (this file). The fix is to add them
to the hosting `ignore` array and redeploy — CrownOS itself reads none of
them at runtime (it reads localStorage/Firestore), so removing them from
hosting has no effect on the app.

---

## 2026-08-08 — Local dev/testing no longer pushes to the live database

**Requested by:** User — after the Petty Cash testing incident (see the entry below),
asked whether testing on a local server could be made to never affect live data.

**Change:** [`firebase-sync.js`](firebase-sync.js) — added an `isLocalTestEnv` check
(`location.hostname` is `localhost`/`127.0.0.1`, or `location.protocol` is `file:`).
When true, every outgoing path is blocked: `queuePush()` no-ops immediately,
`flushPending()` clears `pendingKeys` and returns without a batch commit, the
first-run "seed" step (which migrates local-only keys to the cloud) is skipped, and
the exposed `CrownCloud.flushNow()` (called by `access-control.js`'s `logout()`)
also no-ops. **Pulling stays fully on** — the initial sync and the realtime listener
are untouched — so a local server still shows a real, live snapshot of production
data for realistic testing; it just can never write back. [`sidebar.js`](sidebar.js)
surfaces this: the header's cloud-sync badge shows "🧪 Local Test — Not Saving to
Live" (new `.local-test` style in [`sidebar.css`](sidebar.css)) instead of the usual
"Synced to Cloud" whenever `CrownCloud.isLocalTestEnv` is true, so it's visible
without opening DevTools.

**Verified:** ran the local server again, confirmed the badge appeared, replenished a
₱999 test petty cash fund on the (already real, pre-existing) "Demo Branch" branch,
then queried Firestore directly from the page — the live document still showed
`activeFund: null`, proving the local write never left the browser. Reloading pulled
the real cloud state back down, silently discarding the local-only test data.

**Not changed:** the deployed site (`crownos-5f03d.web.app`) has a real hostname, so
this has zero effect on production-to-production sync between real devices/branches
— the guard only ever engages on `localhost`/`127.0.0.1`/`file:`.

**Status:** Deployed — `firebase deploy --only hosting` → live at
https://crownos-5f03d.web.app

---

## 2026-08-08 — Petty Cash polish: Replenish label, auto-post to Operation Expenses on Liquidate

**Requested by:** User — drop the "+" from the Replenish button, and have Liquidate
push every transaction into Expenses Report's Operation Expenses table instead of
staff re-typing them.

**Change:**
- [`petty-cash.html`](petty-cash.html) — Replenish button and empty-state copy no
  longer say "+ Replenish", just "Replenish". Liquidate modal's warning text now
  states up front that confirming also posts the transactions to Operation Expenses.
- [`petty-cash.js`](petty-cash.js) — `confirmLiquidatePettyCash()` now calls
  `postPettyCashEntriesToExpenses(fund)` before filing the fund under History. For
  each transaction it writes one row directly into
  `crownExpenses_<branch>_<liquidatedMonth>`'s `operation` array (same storage shape
  `expenses-report.js` reads): Date = the **liquidation** date (not each
  transaction's own date — reported as one batch, matching how the custodian actually
  turns it in), Category = `"Branch Expenses"`, Particular = the transaction's
  Particular, Amount = its Total Cost, Mode of Payment = `"Petty Cash"`, Remarks =
  its Remarks.
- [`expenses-report.html`](expenses-report.html) — added `"Branch Expenses"` as a
  Category option in the Operation Expenses Add/Edit modal, so entries posted from
  Petty Cash (and any staff wants to file the same way manually) have a real option
  in the dropdown instead of an orphaned value.

**Incident during testing (self-caught, not reported by user):** verified the full
Replenish → Add Entry → Liquidate flow against `localhost`, not realizing this
machine's copy of the app is live-synced to the **real production Firestore**
(`crownos-5f03d` — confirmed by the "☁ Synced to Cloud" badge and real entries like
"Rice Incentive" / "Reimbursement" already sitting in Biñan's August Operation
Expenses). Two test funds (₱5,000 and ₱3,000, both liquidated) and one test Operation
Expenses row ("Coffee for staff", ₱240) were briefly written to live data.
**Cleaned up immediately:** removed `crownPettyCash_Biñan` entirely (no real petty
cash data existed before this feature) and filtered the one test row back out of
`crownExpenses_Biñan_2026-08` — leaving the other 4 real entries (Mobile Data, Bank
Transfer Fee, Reimbursement, Rice Incentive) untouched — then forced an immediate
`CrownCloud.flushNow()` push and reloaded to confirm the cloud copy matches. Verified
clean on both Expenses Report and Petty Cash after the reload.
**Lesson:** test future changes against a disconnected/offline copy (or a scratch
Firebase project) instead of this checked-out copy, since it stays live-synced by
default.

**Status:** Deployed — `firebase deploy --only hosting` → live at
https://crownos-5f03d.web.app

---

## 2026-08-08 — New Petty Cash tracking page

**Requested by:** User — wanted a dedicated Petty Cash page, one tracking table per
release (Replenish → spend → Liquidate), with its own transaction history.

**Change:**
- [`petty-cash.html`](petty-cash.html), [`petty-cash.css`](petty-cash.css),
  [`petty-cash.js`](petty-cash.js) — new page, added to the sidebar (Summary Reports
  section, right after Statistics) and to `access-control.js`'s `PAGE_ACCESS` with the
  same roles as Statistics: Admin, Executive Assistant, Receptionist. Also added to
  `account-settings.js`'s `EXTRA_ACCESS_PAGES` so other roles can be individually
  granted access (not excluded like Cash Flow/Data Protection are).
- Data model, stored per branch at `crownPettyCash_<branch>` (auto-synced to Firestore
  like every other `crown`-prefixed key): `{ activeFund, history[] }`. A fund is
  `{ releaseDate, releasedAmount, entries[], status, liquidatedDate, liquidatedRemaining,
  liquidatedRemarks }`; each entry is `{ date, particular, remarks, qty, unitCost,
  totalCost }` (Total Cost auto-computed from QTY × Unit Cost).
- **Replenish** (header button, only shown when no fund is active) prompts for a
  release date + amount and opens a new table. **+ Add Entry** logs a transaction
  against the active fund; Remaining recalculates live (Released − sum of Total Cost).
  **Liquidate** (bottom of the table) shows a Released/Spent/Remaining summary, takes
  optional remarks, then closes the fund and files it under **History**. Only one fund
  can be open per branch at a time — Replenish is hidden until the current one is
  liquidated. **History** lists every liquidated fund with a View to drill into its
  full transaction table and liquidation remarks.
- Switching branches via the global toolbar reloads the page's fund/history for the
  new branch (`crownGlobalFiltersChanged` listener), same pattern as Cash Flow.

**Verified locally:** ran the page against a local static server, logged in as the
default admin, and walked through the full cycle — Replenish ₱5,000 → added a ₱450
transaction (Remaining updated to ₱4,550) → Liquidated with remarks → confirmed it
appears in History with the correct summary and transaction detail.

**Status:** Deployed — `firebase deploy --only hosting` → live at
https://crownos-5f03d.web.app

---

## 2026-08-07 — Unified Day/Date picker into a joined-pill style (Attendance, Cashflow, global toolbar)

**Requested by:** User — wanted Cashflow's Date filter to match Attendance's Day filter format
(`[‹] [date] [›] [×] [Today]` as one seamless joined pill), then flagged that having `×` right
next to the `›` (next-day) button risked an accidental clear when repeatedly clicking next — so
the `×`/`Today` order was swapped, and the same reordering was extended to the global header
toolbar's date stepper.

**Change:**
- [`cashflow.html`](cashflow.html) — Date filter's `.date-stepper-group` (plain flex, no visual
  joining) replaced with Bootstrap `.input-group` (same pattern as Attendance), and added the
  missing `Today`/`×` buttons: `[‹] [date] [›] [Today] [×]`.
- [`cashflow.js`](cashflow.js) — new `todayCashflowDayBtn`/`clearCashflowDayBtn` click handlers.
  Today mirrors `stepCashflowDate`'s month-boundary handling (reloads entries if jumping to today
  crosses into a different month).
- [`attendance.html`](attendance.html) — reordered the Day filter's existing buttons from
  `[×] [Today]` to `[Today] [×]` so `×` isn't the button directly after `›`.
- [`sidebar.js`](sidebar.js) — global toolbar: swapped `Today`/`Refresh` order so `Refresh` (a
  safe, non-destructive action) sits between the date stepper's `›` and `Today`, not `Today`
  itself.
- [`sidebar.css`](sidebar.css) — `.date-stepper-group` restyled from a 4px-gap flex row into a
  seamless joined pill (collapsed borders, radius only on the outer edges), matching the Day
  filter's look. Confirmed the two other pages sharing this class (`scheduling.html`,
  `therapist-sales.html`) have their date stepper hidden (`d-none`), so no visible UI there was
  affected.

**Status:** Deployed — pushed to GitHub (`origin/main`, commit `d35dd05`) and
`firebase deploy --only hosting` → live at https://crownos-5f03d.web.app

---

## 2026-08-07 — Added a "Today" shortcut button to the Day filter (Attendance)

**Requested by:** User — wanted a quick way to jump the Daily Logs' Day filter back to today
without giving up the ability to still pick any other day manually.

**Change:**
- [`attendance.html`](attendance.html) — added a `Today` button to the Day filter's
  input-group, after the existing `×` (clear) button: `[‹] [date input] [›] [×] [Today]`.
- [`attendance.js`](attendance.js) — new `todayAttendanceDayBtn` click handler sets the Day
  field (and keeps Month in sync) to today's date and re-renders. Extracted the today-date
  calc that `stepAttendanceDay()` already had inline into a shared `getTodayDateString()` so
  both use the same logic.

**Not changed:** the Day input itself is still a normal date picker — staff can still browse
to any other day same as before.

**Status:** Code changed locally, not yet deployed.

---

## 2026-08-07 — Attendance Daily Logs now show nickname instead of account (Attendance)

**Requested by:** User — wanted the Staff column in the Daily Logs table to show each staff
member's nickname (Account Settings' "Nickname" field, same one already used on List of
Therapists) instead of their login account name.

**Change:** [`attendance.js`](attendance.js) — added `getStaffDisplayName(entry)`, which looks
up the entry's `userId` in the live user list and returns `user.nickname` if set. Falls back to
the account name (`entry.account`, or `getAccountName(entry.userId)` for older entries without
a snapshotted account) exactly like before for staff with no nickname configured or a since-
deleted account. Only the Daily Logs table cell (`attendanceBody` rows) was changed — the Staff
filter dropdown and the Add/Edit modal's Staff select still show account names, since only the
table column was requested.

**Status:** Code changed locally, not yet deployed.

---

## 2026-08-07 — Block Date turned into an inline checkbox (Scheduling)

**Requested by:** User — wanted the "Block Date" button/modal replaced with a checkbox +
reason input sitting right under the Legend row, above the schedule grid: grey/disabled
reason field until checked, editable (still optional) once checked.

**Change:**
- [`scheduling.html`](scheduling.html) — removed the "Block Date" button and its whole modal
  (`#blockDateModalBackdrop`, branch/date/reason fields, Save/Cancel). Replaced the old
  read-only `blocked-date-banner` (which sat below the Legend) with `.block-date-inline-control`:
  a checkbox (`#blockDateCheckbox`) + text input (`#blockDateReasonInput`, disabled by default).
- [`scheduling.js`](scheduling.js) — replaced `renderBlockedDateBanner`/`openBlockDateModal`/
  `saveBlockDate`/etc. with `renderBlockDateControl()` (syncs checkbox + reason to whichever
  branch/date is on screen), `toggleBlockDate()` (checking creates a blocked-date entry for the
  branch/date being viewed and focuses the reason field; unchecking removes it via the existing
  `unblockDate()`), and `updateBlockDateReason()` (saves the reason as the field loses focus).
  `findBlockedEntry()`/`getBlockedDates()`/the "Blocked Dates" management table at the bottom of
  the page were untouched — still work as before.
- [`scheduling.css`](scheduling.css) — new `.block-date-inline-control` styling (kept the old
  banner's red/pink coloring) and a grey `:disabled` state for the reason input. Also fixed
  `.schedule-controls-card`'s grid to 3 columns now that Branch/Date live in the header (see
  prior entry) instead of leaving two blank cells where they used to sit.

**Behavior change (by design, confirmed acceptable given the simpler UI):** the old modal could
block a date for **all branches at once**; the checkbox always blocks only the specific branch
currently being viewed. Any pre-existing "All Branches" blocked-date entries still work (the
checkbox shows checked and unchecking removes that entry), but there's no longer a way to
create a new "All Branches" entry from this page — only per-branch, one at a time.

**Status:** Code changed locally, not yet deployed.

---

## 2026-08-07 — Removed redundant per-page branch pickers (8 pages)

**Requested by:** User — same reasoning as the earlier date-picker cleanup: the header
toolbar's branch selector (`sidebar.js`, `#sidebarDashboardBranch`) already drives branch state
for these pages, so their own branch controls were duplicate.

**Change:** Hid (did not delete) the branch control on:
- [`scheduling.html`](scheduling.html) — `#scheduleBranch` select. Already in
  `syncGlobalToolbarToPage()`'s auto-synced id list, so hiding it was a pure UI change; no JS
  behavior needed.
- [`invoice-report.html`](invoice-report.html) — `#invoiceBranch` select. This one was **not**
  in the auto-synced list and had no live listener, so simply hiding it would have frozen the
  report on whatever branch was selected at page load. Added a `crownGlobalFiltersChanged`
  listener in [`invoice-report.js`](invoice-report.js) (same pattern as `cashflow.js`'s existing
  fix) so it now follows header branch changes made while already on the page.
- [`monthly-report.html`](monthly-report.html), [`expenses-report.html`](expenses-report.html),
  [`cashflow.html`](cashflow.html), [`share-holder-report.html`](share-holder-report.html),
  [`loyalty-card-summary.html`](loyalty-card-summary.html),
  [`product-sales-summary.html`](product-sales-summary.html) — these never had an actual
  picker, just a read-only `#branchReadout` text div mirroring the branch name (confirmed each
  page's script only ever writes `.textContent` to it, never reads it back). Hid the label +
  readout on all six; purely cosmetic, no logic touched.

**Status:** Code changed locally, not yet deployed.

---

## 2026-08-07 — Removed redundant per-page date pickers (Scheduling, Daily Income, Therapist Sales)

**Requested by:** User — noticed the header toolbar's date picker (`sidebar.js`,
`#sidebarDashboardDate`) already drives these pages' date state via
`syncGlobalToolbarToPage()`, making each page's own visible date control duplicate work.

**Change:** Hid (did not delete) the visible date picker/stepper UI, plus its label, on:
- [`scheduling.html`](scheduling.html) — `.date-stepper-group` (prev/next day + `#scheduleDate`)
- [`index.html`](index.html) — the `.date-picker-field` calendar dropdown (Daily Income Report),
  its column widened from `col-xl-5`/`col-xl-7` split to a full-width Schedule column
- [`therapist-sales.html`](therapist-sales.html) — its `.date-stepper-group` calendar dropdown

**Why hidden, not removed:** `scheduling.js`, `script.js`, and therapist-sales' script all still
read/write `#scheduleDate` / `#date` / `#selectedDate` directly, and `syncGlobalToolbarToPage()`
targets those exact ids to push the header's date into the page. Deleting the elements would
have broken that sync and thrown null-reference errors; hiding them keeps the same data flow
with the header as the single visible control.

**Left as-is (not redundant):** any date field inside an Add/Edit/Block modal (e.g. Scheduling's
`#modalDate`, `#blockDateInput`), `payroll.html`'s date-range filter, and `cashflow.html`'s
`#cashflowDateFilter` (deliberately reset rather than mirrored on header-date change) — none of
these mean "which day am I currently viewing," so none were touched. `attendance.html`'s day
picker (`#attendanceDay`) is a separate, currently-unsynced gap — flagged for later, not part of
this change.

**Status:** Code changed locally, not yet deployed.

---

## 2026-08-07 — Date picker added to the appointment modal (Scheduling)

**Requested by:** User — wanted an easy way to move a client's appointment to a different
date without recreating it, since Bed/Start Time/End Time were editable but the date was
locked to whatever day the calendar view happened to be on.

**Change:**
- [`scheduling.html`](scheduling.html) — added a `Date` field (`#modalDate`) to the row with
  Bed/Start Time/End Time in the Add/Edit Appointment modal (4 columns now instead of 3).
- [`scheduling.js`](scheduling.js):
  - New `getModalDate()` helper reads `#modalDate`, falling back to the page-level
    `#scheduleDate` filter for any code path that runs before the modal has opened.
  - Conflict checking (`getPersistedConflictPool`) and the slot label
    (`updateSelectedSlotLabel`) now key off the modal's date, so bed/therapist conflicts are
    checked against the date the appointment is being moved *to*, not the calendar's current
    view.
  - `openNewModal`/`openEditModal` prefill `#modalDate` from the current view; `openEditModal`
    also records `selectedScheduleOriginalDate` — the bucket the entry actually lives in.
  - `saveSchedule()` now saves under the modal's date. If that differs from
    `selectedScheduleOriginalDate` (staff picked a new date = reschedule), the entry and its
    companions are also removed from the old date's `crownSchedule_<branch>_<date>` bucket so
    it doesn't linger on both days.

**Not changed:** Blocking a date only stops *new* appointments (matches the existing
`!selectedScheduleId` check) — staff can still reschedule an existing appointment onto a
blocked date, same as they could already create one manually before this change.

**Known limitation:** the web-booking-holds capacity check (`activeHoldsCache`) is still
fetched for the calendar's current viewed date, not the modal's date — rescheduling across
days won't factor in pending web holds on the target day. Bed/therapist conflict checks (the
main safety net) are unaffected.

**Status:** Code changed locally, not yet deployed — run
`firebase deploy --only hosting` from `Income Report/` when ready to push live.

---

## 2026-08-06 — Cashflow branch-mixing bug (Calamba/Biñan)

**Reported by:** User — "hindi pala magkabukod ang records ng cashflow sa calamba at sa binan" /
"kapag nagswitch ako between branches, hindi nagbabago."

**Root cause found:**
- [`cashflow.js`](cashflow.js) only loaded branch data once, on page load. Switching branches
  from the global toolbar while already on the Cash Flow page did not refresh the on-screen
  data or the in-memory entry list.
- If an entry was then added/edited/deleted in that stale state, the save function correctly
  computed the *new* branch's storage key, but wrote the *old* branch's entries into it —
  silently overwriting the other branch's real cashflow data.
- Confirmed on the live app: `crownCashflow_Biñan_2026-08` and `crownCashflow_Calamba_2026-08`
  held byte-identical data (same entry IDs), proving Calamba's real August entries had been
  overwritten by a copy of Biñan's.
- Separately found `migrateBranchReferences()` in [`list-branches.js`](list-branches.js) was
  missing the `crownCashflow_` prefix, so renaming a branch (e.g. "Crown Head Spa Biñan" →
  "Biñan") left old cashflow records orphaned under the old name instead of moving them —
  confirmed orphaned `crownCashflow_Crown Head Spa Biñan_2026-07` /
  `..._Crown Head Spa Calamba_2026-07` keys still in storage.

**Fix applied:**
1. `cashflow.js` — added a `crownGlobalFiltersChanged` listener that re-reads the selected
   branch and reloads entries whenever the toolbar branch switcher changes, without needing a
   full page reload.
2. `list-branches.js` — added `crownCashflow_` to the prefix list in `migrateBranchReferences()`
   so future branch renames carry cashflow history along correctly.

**Deployed:** `firebase deploy --only hosting` → live at https://crownos-5f03d.web.app

**Data cleanup:** Cleared `crownCashflow_Calamba_2026-08` (was a duplicate of Biñan's data, per
user's instruction to treat the merged entries as Biñan's). Biñan's August data (8 entries,
₱17,271.50) verified intact. **Calamba's real August 2026 cashflow entries were not recoverable
and need to be manually re-entered by the user.**

**Not affected (verified):** July 2026 cashflow, and Expenses/Daily Sales records for both
branches — data was distinct per branch, no duplication found.
