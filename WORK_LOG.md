# CrownOS Work Log

Running log of changes made to the CrownOS system, newest entry on top.

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
