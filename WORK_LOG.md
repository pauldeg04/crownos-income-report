# CrownOS Work Log

Running log of changes made to the CrownOS system, newest entry on top.

---

## 2026-08-26 — VIP Point System, VIP Card usage detection, and auto-generated card numbers

**Requested by:** User — wanted a points program for VIP clients (₱1
spent = 1 point, 100 points = ₱1 credit on a future visit), a way to
record when a VIP is using their own card versus someone borrowing
theirs, and card numbers generated automatically instead of typed by
hand, all following the branch's existing numbering convention
(`C<BranchCode><YY><MM><NNN>`, e.g. `CBIN2608231`).

- [index.html](index.html) / [script.js](script.js): new **VIP Client**
  checkbox and **VIP Card Number** field at the very top of Add Sale,
  above Time. Typing a number that matches an existing client's Loyalty
  Card Number shows who owns it, switches this transaction to VIP
  pricing/status, and auto-picks **Source** — Returning if the Client
  field matches the card owner's own name, Referral if it's someone
  else. `findVipCardOwnerByNumber`, `modalHasValidVipCardNumber`,
  `refreshModalVipCardOwnerHint`.
- [script.js](script.js): `addVipCardToModal()` now auto-generates a
  new Loyalty Card Number for a first-time client (no existing card on
  file) the moment **Add VIP Card** is pressed, following the branch's
  numbering convention — `generateVipCardNumber`,
  `getVipCardBranchCode`, `VIP_CARD_BRANCH_CODES` (BIN / CAL / MAIN /
  DEMO). Never overwrites a client who already has a card.
- [script.js](script.js): `creditVipPointsForSale()` — on every settled
  sale, credits ₱1-spent-=-1-point to the sale's own VIP client and any
  VIP companion (on their own portion only), and credits the **full**
  transaction to the VIP Card owner when someone else used their card
  (a referral). Guarded by a `pointsCredited` flag on the sale so
  editing/re-saving a settled sale never double-credits. Runs after
  `applyModalClientDetailsToDatabase` so a client who becomes VIP on
  this very sale still earns points on it.
- [clients.html](clients.html) / [clients.js](clients.js): new **VIP
  Points** field on the Add/Edit Client forms and View Client panel —
  only shown/used once VIP Status is Yes; toggling VIP off does not
  erase an existing balance. New **Earned Points** column in the Visit
  History table (between Amount and Forms), computed live per visit;
  a visit where someone else used this client's card shows up here too
  as "VIP Card used by …", crediting that visit's points to the card
  owner even though they weren't physically there.
- Client Database data migration: reconciled the historical
  `Copy of MASTERLIST_LOYALTY CARD_PRODUCTS.xlsx` and
  `Calamba LOYALTY CARD RECORDS.xlsx` masterlists against the live
  client database (name/card/phone/email/points), seeding starting VIP
  Point balances and filling in missing Loyalty Card Numbers, phone
  numbers, and emails. Built and then removed two one-off admin tools
  used only for this migration (**Import Clients** with a "fill blanks
  only" merge mode, and **Correct Client Info** for deliberate
  overwrites against a confirmed source-of-truth) — not needed for
  day-to-day reception work, so pulled from clients.html/clients.js
  once the migration was done.
- [manual.html](manual.html): Chapter 7 (Recording a Sale) documents
  the VIP Client checkbox, VIP Card Number field, and auto-generated
  card numbers; Chapter 8 (Vouchers and VIP Cards) gets a new **VIP
  Points** section explaining the earning rule and referral crediting;
  Chapter 12 (Client Database) documents the VIP Points field and
  Earned Points column, and drops its now-removed Import Clients note.

## 2026-08-26 — Client Database: Birthday Celebrants panel is now collapsible

**Requested by:** User — the Birthday Celebrants This Month panel was
always expanded on the Client Database page, making the page feel
crowded.

- [clients.html](clients.html): the panel's table now sits inside a
  Bootstrap `collapse`, closed by default. Clicking the "Birthday
  Celebrants This Month" heading toggles it; a chevron next to the
  heading rotates to show open/closed state.
- [clients.css](clients.css): `.birthday-collapse-icon` rotation
  transition, driven off the toggle's `aria-expanded` attribute (set
  automatically by Bootstrap's collapse JS, already loaded on this
  page — no new script needed).

## 2026-08-26 — Push notifications on the home screen (device-level, not just the in-app bell)

**Requested by:** User — the existing 🔔 bell only surfaces new booking
requests, schedule assignments, and announcements while CrownOS is open;
staff wanted these on the device home screen even when the app isn't
open. Built and deployed earlier; this entry is the first Work Log /
Git record of it.

- [push-notifications.js](push-notifications.js) (new): `CrownPush`
  module — requests browser/device notification permission, registers
  an FCM token per device, and exposes `isSupported`, `isEnabled`,
  `enable`, `disable`. Loaded on every page (see below).
- [account-settings.html](account-settings.html) /
  [account-settings.js](account-settings.js): new "Enable notifications
  on this device" toggle under My Account, backed by `CrownPush`. Shows
  a plain-language reason (unsupported browser, permission denied) when
  it can't be turned on.
- [sw.js](sw.js): service worker now also handles FCM push delivery
  while CrownOS itself isn't running — shows the OS notification and
  sets the home-screen icon badge count via `onBackgroundMessage`.
- [sidebar.js](sidebar.js): the in-app unread bell badge now also calls
  the Badging API (`navigator.setAppBadge` / `clearAppBadge`) so the
  home-screen icon badge stays in sync while the app is open or
  backgrounded; the fully-closed-app case is covered by `sw.js` instead.
- [functions/index.js](functions/index.js): new `sendPushToAccount`
  helper — sends to every device token an account has registered,
  badged with that account's current total unread count across both
  notification collections, and prunes stale/unregistered tokens as
  they're discovered. Wired into the existing new-booking-request
  trigger, plus a new `sendPushOnClientNotification` trigger for
  Admin Hub broadcasts (Announcement publish, Memo send).
- [firestore.rules](firestore.rules): new `staffPushTokens` collection
  — a user may only create/update/delete tokens addressed to their own
  account; direct read is blocked entirely (the sending Cloud Functions
  use the Admin SDK and bypass these rules).
- [manual.html](manual.html): new note under Chapter 20 (Account
  Settings) → My Account, explaining the device notification toggle and
  how it differs from the in-app bell.

## 2026-08-26 — Scheduling: appointment reminder also sends by email, not just SMS

**Requested by:** User — the automatic 2-hour-before reminder shipped
earlier today only covered SMS; the client's email should get the same
reminder too.

- [functions/index.js](functions/index.js): `sendAppointmentReminders`
  now sends by whichever contact channel(s) the schedule entry actually
  has — SMS if a mobile number is on file, email if an email address is,
  both if both. New `buildReminderEmailText` / `buildReminderEmailHtml`
  reuse the confirmation email's branded shell (header/footer, Cinzel
  Decorative branding) with reminder copy in place of the booking-details
  table; unlike the SMS version, the full "Crown Head Spa {City} Branch"
  name is used since email has no 160-char pressure. "Already sent" moved
  from one flag per `appointmentReminders` doc to two —
  `smsSentAt` / `emailSentAt` — so an entry with only one contact detail
  gets exactly that one channel, and a retry after a failed send only
  re-attempts the channel that actually failed.
- [manual.html](manual.html): the "Automatic SMS reminder" note in
  Chapter 13 (Scheduling) updated to cover both channels.

## 2026-08-26 — Scheduling: automatic SMS reminder 2 hours before an appointment

**Requested by:** User — wants clients to automatically get a reminder text
some time before their appointment, instead of only the optional
confirmation sent at booking time.

- [functions/index.js](functions/index.js): new scheduled Cloud Function
  `sendAppointmentReminders`, runs every 15 minutes. Reads today's and
  tomorrow's `crownSchedule_<branch>_<date>` entries from the appData
  mirror (read-only — never writes back to that client-owned blob, same
  reasoning as everywhere else in this file) and, for every entry with a
  mobile number whose `startTime` is 0–120 minutes away, sends: *"Hi
  {client}! A gentle reminder that you booked an appointment at {branch}
  Branch today at {time}. Please arrive earlier than your appointment.
  See you."* — kept to the short branch name (e.g. "Calamba" not "Crown
  Head Spa Calamba") to stay inside the 160-char single-segment SMS
  limit (148 chars as sent). "Already sent" is tracked in a new
  `appointmentReminders` Firestore collection (one doc per schedule entry
  id), so a re-run inside the same window is a no-op — nothing is written
  back onto the schedule entry itself.
- Fires for **any** appointment with a mobile number on file, independent
  of whether the SMS confirmation checkbox was checked at booking time —
  open question from the user still unresolved on whether it should
  instead only fire for opted-in appointments; revisit if that turns out
  to be the wrong default.
- [manual.html](manual.html): new "Automatic SMS reminder" note under
  Chapter 13 (Scheduling), next to the existing confirmation-popup note.

## 2026-08-26 — Fix: "Issue Sales Invoice" silently dropped from saved sales

**Reported by:** User — Receptionists ticking "Issue Sales Invoice" and
entering an Invoice Number said the entry never showed up in the Sales
Invoice Summary, even though nothing looked wrong on their end.

**Found:** `loadDailySales()` ([`script.js`](script.js)) rebuilds every sale
row from its raw stored JSON using an explicit field-by-field whitelist —
this runs on every page load, date change, and incoming cloud sync event.
The whitelist never included `issueInvoice`, `invoiceNumber`, or
`tinNumber`, so those three fields were silently stripped from the
in-memory copy the moment this function ran, on any device. Confirmed live:
a Receptionist ticked the box and entered an invoice number in Biñan, but an
Admin opening the same sale afterward saw the checkbox unchecked. If any
other save happened afterward for that branch/date while the fields were
missing in memory, the whole-day record got overwritten and the invoice
data was permanently lost from storage — explaining why entries never
reached the Sales Invoice Summary (`invoice-report.js`), which reads the
stored record directly.

**Fix applied** (`script.js`, `loadDailySales()`): added `issueInvoice`,
`invoiceNumber`, and `tinNumber` to the row-rebuild whitelist so they
survive every reload/sync going forward.

**Not fixed by this change:** sales entered before this fix that already
lost their invoice flag/number need to be manually reopened and re-checked
by staff — this fix only stops new data loss, it does not recover what was
already stripped.

**Manual:** no update needed — [Chapter 11](manual.html#ch-invoice)'s
description of Sales Invoice Summary already describes the intended
(post-fix) behavior.

**Status:** Deployed — `firebase deploy --only hosting`.

---

## 2026-08-26 — Leave Request: branch-scoped visibility for Team Leaders

**Requested by:** User — Team Leader accounts should be able to view all leave
requests and approve/decline them, but only for staff in their own assigned
branch (not every branch).

**Found:** Team Leader review/approve access already existed
([`leave-requests.js`](leave-requests.js) `isApprover` check includes
`currentUser.teamLeader === true`), but the "All Requests" list was
unfiltered — a Team Leader saw every request from every branch, same as
Admin/Executive Assistant.

**Fix applied** (`leave-requests.js`):
1. New requests now stamp `requesterBranches` (from the requester's account)
   onto the `leaveRequests` doc at submit time.
2. New `getRequestBranches()` helper reads that stamped field, falling back
   to a lookup against `CrownAuth.getUsers()` for older requests submitted
   before this change.
3. The "All Requests" Firestore listener now filters results through
   `CrownAuth.getAllowedBranches(currentUser)` when the viewer is a Team
   Leader (not Admin/Executive Assistant) — same branch-scoping pattern
   already used in `staff-schedule.js`. Admin and Executive Assistant are
   unaffected and continue to see every branch.

**Manual updated:** [manual.html](manual.html) Chapter 27 (Leave Request) —
noted that Team Leaders see only their own branch's requests while
Admin/Executive Assistant see all branches.

**Not changed:** Firestore rules for `leaveRequests` still don't check role
(access control is client-side only, consistent with the rest of the app).

**Status:** Deployed — `firebase deploy --only hosting`.

---

## 2026-08-26 — Marketing: new Daily Report page

**Requested by:** User — branches were filling in an end-of-day recap
(Employee, Working Hours, Daily Summary, Hot Leads, Management Attention
Required) on a separate spreadsheet; wanted it moved into CrownOS under
the Marketing menu, one saved report per day per branch.

- [marketing-daily-report.html](marketing-daily-report.html) /
  [marketing-daily-report.js](marketing-daily-report.js): new page. A
  **+ Create Report** button opens a modal matching the spreadsheet's
  fields (Employee, Date, Working Hours, Daily Summary counts with an
  auto-computed Booking Conversion Rate, an optional Summary Notes field,
  a repeatable Hot Leads table, and Remarks/Prepared by/Time Submitted),
  with **Save** / **Cancel**. Saved reports land in a table — Date,
  Inquiries, Bookings, Cancelled, Conversion Rate (%), a **View** under
  Remarks (just that report's Remarks text), and a **View** under Action
  (the full report). Follows the Branch selector and has its own Month
  picker, same convention as Monthly Summary / Expenses Report.
  Data lives in a new `marketingDailyReports` Firestore collection, one
  doc per branch per day.
- [sidebar.js](sidebar.js), [access-control.js](access-control.js),
  [account-settings.js](account-settings.js): **Daily Report** added
  under the Marketing section (Admin / Marketing Agent, branch-required),
  and made individually grantable through Additional Access.
- [firestore.rules](firestore.rules): added a `marketingDailyReports`
  rule, same open-to-any-authenticated-user pattern as `marketingCampaigns`.
- [marketing.css](marketing.css): small section-title spacing helper for
  the new modal/view layout.
- [manual.html](manual.html): Chapter 29 renamed to cover Ads Monitoring,
  Monitoring Summary, and Daily Report; added a Daily Report walkthrough
  and updated the page-role access matrix.

## 2026-08-26 — Scheduling: booking-request appointments default to the first available bed

**Requested by:** User — opening "Add Appointment" from a booking request
left the Bed dropdown on "Select Bed" since guests don't pick one on the
public form, unlike a companion row which already defaulted to the first
available bed.

- [scheduling.js](scheduling.js): `openNewModalFromBookingRequest` now
  picks the first bed with no scheduling conflict at the request's time
  (via `findAlternateBed`/`getConflictPool`, the same building blocks
  `recommendCompanionSlot` already used for companions) and pre-selects it
  on the modal's Bed dropdown, right after services are filled in so the
  service duration is known. Doing this before the companion-prefill loop
  also lets companion bed recommendations anchor off a real bed number
  instead of always defaulting to bed 1.

## 2026-08-26 — Staff Schedule: multiple Rest Day rows, "Add Therapist" renamed to "Add Row"

**Requested by:** User — the Rest Day row had no way to add a second staff
member on rest the same week, unlike Opening/Closing which already
supported multiple Therapist rows.

- [staff-schedule.js](staff-schedule.js): `restDay` changed from a single
  `{mon..sun}` map to an array of them, mirroring the existing
  `opening.therapists` / `closing.therapists` pattern — same add/remove-row
  handlers now cover all three sections. `normalizeGrid` upgrades old
  single-object `restDay` docs to a one-item array on load, so existing
  saved schedules keep working.
- [staff-schedule.html](staff-schedule.html): added a **+ Add Row** button
  under the Rest Day table in the Create/Edit modal; the Opening and
  Closing **+ Add Therapist** buttons are relabeled **+ Add Row** to match
  (they add a generic staff row, not specifically a therapist).
- [manual.html](manual.html): Staff Schedule section updated — Rest Day
  now described as one-or-more rows, and both add-row buttons referred to
  as **+ Add Row**.

## 2026-08-26 — Scheduling: manual Mobile/Email fields on appointments, SMS text rework

**Requested by:** User — booking confirmations (Email/SMS) previously only
worked for appointments created from a web booking request, since that was
the only path that carried a mobile/email. Staff booking a client directly
in Scheduling had no way to trigger a confirmation.

- [scheduling.html](scheduling.html): added **Mobile Number** and
  **Email Address** fields to the Add/Edit Appointment modal, next to
  Client.
- [scheduling.js](scheduling.js): the modal's mobile/email fields are now
  the single source for the confirmation popup and for backfilling the
  client's contact info (`ensureClientExists`), replacing the old
  `pendingRequestContact` (booking-request-only) path — auto-filled from
  the booking request when the appointment originates from one, but now
  editable and usable for any appointment. Saved onto the schedule record
  as `mobile` / `email`.
- [functions/index.js](functions/index.js): `buildConfirmationSmsText`
  reworked — strips diacritics (`toGsm7Safe`) so an accented character
  (e.g. "Biñan") doesn't silently bump the whole message into Unicode
  encoding, which Smart was dropping despite Semaphore reporting "Sent";
  drops the "Crown Head Spa" prefix from the branch name
  (`shortBranchName`) to stay inside the 160-char single-segment limit;
  adds companion names to the message body.
- [manual.html](manual.html): Chapter 13 (Scheduling) updated — contact
  fields are entered directly on the appointment now, not only inherited
  from a web booking request.

## 2026-08-26 — Notifications: tap/click now navigates to the subject

**Requested by:** User — tapping (mobile) or clicking (desktop) a
notification in the bell panel only marked it read; it should also jump to
whatever the notification is about, e.g. a Memo notification should open
the Memo page.

- [sidebar.js](sidebar.js): notification rows now carry the source item's
  `type` (`data-type`), and clicking one (same handler for tap and click)
  marks it read as before, then routes to the matching page via a new
  `NOTIFICATION_TYPE_PAGES` map — `schedule` → Staff Schedule, `attendance`
  → Attendance, `memo` → Memo, `announcement` → Announcement,
  `booking-request` → Booking Requests. No-ops (stays put) if already on
  that page or the type is unrecognized.
- [manual.html](manual.html): Notifications entry in Chapter — Toolbar
  updated to describe the new tap/click-to-navigate behavior.

## 2026-08-25 — BIR Compliance Desk: fixed zero-padding cards across the whole page

**Requested by:** User — screenshot showed "Next deadline" / "Missing
documents" card headings flush against the card's top-left corner, no
breathing room, across many cards on the page.

- [bir-compliance.css](bir-compliance.css): `shared.css`'s `.card` has no
  padding of its own — it expects a nested `.card-body` wrapper
  (bootstrap's pattern), which the ported `render*()` functions in
  [bir-compliance.js](bir-compliance.js) never include (they build
  `<div class="card">` directly, matching the original CrownADMIN app's
  own `.card`, which carried its own `padding:18px 20px` — lost when that
  rule wasn't ported over). Added `padding:18px 20px; margin-bottom:16px;`
  straight onto `.card` in this stylesheet, matching the original. Since
  nearly every view on this page is built from `.card` blocks, this one
  rule was the fix for every instance of the cramped look, not just the
  Dashboard cards in the screenshot.

## 2026-08-25 — BIR Compliance Desk: fixed the misplaced ₱ marker on money fields

**Requested by:** User — screenshots showed a stray mark floating over each
money field's label instead of sitting inside the input, right after the
page above shipped.

- [bir-compliance.css](bir-compliance.css): `.money-field::before`'s ₱
  marker was positioned with `top:33px` (`top:10px` for `.compact`),
  measured from the top of the field wrapper — which includes the label.
  Any label taller than what those two hardcoded numbers assumed put the
  ₱ sign over the label text instead of inside the input below it. Now
  anchored from the `bottom` of the wrapper instead (`bottom:0` +
  `height:38px` + `align-items:center`), which lines up with the input's
  own box regardless of label height — removes the separate `.compact`
  override entirely, since both cases now use the same rule. Also pinned
  an explicit `font-family` on the marker (shared.css's Inter/Segoe UI
  stack renders the ₱ glyph correctly, but tiny at 13px it can look like
  a flag rather than a peso sign at a glance — confirmed by rendering it
  large side-by-side with a plain "P").

## 2026-08-25 — New page: BIR Compliance Desk, ported from the standalone CrownADMIN app

**Requested by:** User — integrate the separate "CrownADMIN" app (a BIR tax
compliance tracker with its own Google Sign-In, sidebar, theme, and
Firebase project) into CrownOS as a normal page: no separate login, a
sidebar entry, CrownOS's own theme, and its own Firebase project's data
migrated to CrownOS's project (`crownos-5f03d`). Access limited to Admin +
Executive Assistant. The old `CrownADMIN/` folder and its `crown-admin-cfa9e`
Firebase project are left untouched as a dormant backup — not deployed, not
linked from anywhere.

- New [bir-compliance.html](bir-compliance.html) / [bir-compliance.js](bir-compliance.js) /
  [bir-compliance.css](bir-compliance.css): the ported app, unchanged in
  business logic (tax-period tracking, document checklist, accountant/owner
  approval workflow, tax calendar, filings, CSV/print reports, audit trail).
  Its own Google Sign-In gate, allowlist ("Manage access" in Settings), and
  `firebase-config.js` are gone — it now runs on the CrownOS session
  (`window.CrownAuth`) and CrownOS's own Firebase app, syncing to a new
  `birCompliance/state` Firestore document instead of the old project's
  `app/state`. Its own internal sidebar/topbar became a header actions row
  (period selector, workflow role switch, acting-name field, sync status)
  plus a `.tabs` view-switcher, styled with CrownOS's `shared.css` tokens
  instead of its own dark-green theme.
- [sidebar.js](sidebar.js): new "Compliance" section, "🧾 BIR Compliance
  Desk" entry (`roles: ["Admin", "Executive Assistant"]`, no
  `branchRequired` — company-wide).
- [access-control.js](access-control.js): `PAGE_ACCESS["bir-compliance.html"]`
  gate, same two roles.
- [firestore.rules](firestore.rules): new `birCompliance` collection rule,
  same shape as `appDataCashflow` (its own collection rather than a key
  inside `appData`, so a restricted document never breaks the blanket
  "any authenticated user" query other roles rely on).
- [storage.rules](storage.rules): new file — CrownOS had no Cloud Storage
  usage before this. Restricts `birCompliance/**` uploads (BMBE
  certificate, document checklist files, filing/payment proofs) to the
  same two roles. [firebase.json](firebase.json) gained the matching
  `"storage"` config block (explicit `bucket`, since `--only storage:rules`
  alone errored with "Could not find rules for the following storage
  targets: rules" until the bucket was named explicitly and deploy used
  `--only storage` instead).
- [manual.html](manual.html): new **Part Eight · Compliance**, Chapter 30
  "BIR Compliance Desk", inserted before the Reference part (now Part
  Nine, Checklists/Troubleshooting renumbered 31/32). Chapter 3's
  sidebar-layout table gained a Compliance row; Chapter 4's role matrix
  gained a BIR Compliance Desk row (Admin/Executive Assistant only).

## 2026-08-25 — Ads Monitoring: full-history View modal widened + History moved to a collapsed section

**Requested by:** User — two separate "too cramped" complaints, addressed
together in the end: (1) the "View" modal's full update-history table felt
squeezed at the default 640px modal width, and (2) the History
(archived campaigns) table felt crowded on the page.

- [marketing-ads-daily.html](marketing-ads-daily.html): the View modal's
  `.marketing-modal` now also carries `.marketing-modal-wide`. The
  "History" button + popup modal are gone — archived campaigns now live
  in their own card at the very bottom of the page, collapsed by default
  (`marketing-collapse-toggle` / `.expanded` chevron); expanding it loads
  the archived-campaigns table at that point. Each archived row's
  **View** still opens the same (now wide) full-history modal used
  elsewhere on this page.
- [marketing-ads-daily.js](marketing-ads-daily.js): `openHistoryModal()`/
  `closeHistoryModal()` replaced by `toggleHistorySection()` /
  `loadHistorySection()`.
- [marketing.css](marketing.css): new `.marketing-modal-wide` class
  (`max-width:min(1100px, 95vw)`, vs. the default 640px) for the View
  modal's seven columns (Date Created, CPM, Cost, Impression, Views,
  Inquiries, Notes); new `.marketing-collapse-toggle` /
  `.marketing-collapse-chevron` / `.marketing-collapse-body` styles for
  the History section.
- [manual.html](manual.html): Chapter 29's Ads Monitoring section updated
  to describe History as the collapsed section at the bottom of the page
  instead of a header button/modal.

## 2026-08-25 — User Manual: new "Marketing" part covering Ads Monitoring / Monitoring Summary

**Changes applied ([manual.html](manual.html)):**
- New **Part Seven · Marketing**, Chapter 29 "Ads Monitoring and
  Monitoring Summary" — documents the Create Campaign flow, the
  View/Update/End/Resume/Archive buttons, the History view, and how
  Monitoring Summary rolls each campaign up (Active-first, Inactive at
  the bottom). Inserted before the existing Reference part, which shifts
  to **Part Eight** (Checklists/Troubleshooting renumbered 30/31).
- Chapter 4's role access matrix gained rows for **Ads Monitoring** and
  **Monitoring Summary** (Admin/Marketing Agent only, like the sidebar).
- Chapter 3's sidebar-layout table gained a **Marketing** group row.

## 2026-08-25 — Ads Monitoring: per-campaign table now shows one summary row, View is a table with timestamps, Monitoring Summary sorts Active-first

**Requested by:** User — follow-up refinement right after the per-campaign
redesign above.

- [marketing-ads-daily.js](marketing-ads-daily.js): each campaign's visible
  table on the page no longer lists every entry — it now shows a single
  summary row (CPM average / latest Cost, Impression, Views, Inquiries,
  Notes), same figures Monitoring Summary computes per campaign. The full,
  untruncated entry-by-entry history moved entirely into the **View**
  modal, which is now rendered as a table (`renderEntriesHistory()`)
  instead of a stacked list. Its Date Created cell stacks the entry's
  timestamp under the date (`formatTimestampDateTime()`) rather than
  adding a separate column.
- [marketing-ads-summary.js](marketing-ads-summary.js): the campaign list
  now sorts Active campaigns first, Inactive (including archived — a
  campaign is always Inactive by the time it's archived) to the bottom,
  alphabetically within each group. This is now the one real difference
  between the two pages: Monitoring Summary is a single table listing
  every campaign, while Ads Monitoring keeps each campaign as its own
  separate table (just a one-row summary instead of full history).

## 2026-08-25 — Ads Monitoring redesigned: one persistent table per Campaign, append-only updates, End/Resume/Archive/History

**Requested by:** User — reworked the just-added Ads Monitoring page from
a single flat daily-entries table into a per-campaign model, right after
the first version shipped.

**New data model:** the flat `marketingAdsDaily` collection is replaced
by `marketingCampaigns/{campaignId}` (name, status Active/Inactive,
archived flag, createdAt/endedAt/archivedAt) with an append-only
`entries` subcollection per campaign (createdAt = "Date Created", cpm,
cost, impressions, views, inquiries, notes). Nothing carried over from
the short-lived old collection — it was never live.

**[marketing-ads-daily.html](marketing-ads-daily.html) / [marketing-ads-daily.js](marketing-ads-daily.js) — "Ads Monitoring":**
- "+ Create Campaign" (was "+ Add Entry") opens a modal for the campaign
  name plus its first update (CPM/Cost/Impression/Views/Inquiries/Notes).
  Every click always creates a brand-new campaign/table — it never merges
  into an existing one by name.
- Each non-archived campaign renders as its own card/table titled
  "{Campaign Name} - {Status}" (status color-coded text, no more Status
  or Campaign columns in the table itself). Columns are now Date Created
  (auto, immutable — set once per entry, not user-editable) / CPM / Cost
  / Impression / Views / Inquiries / Notes.
- Row-level Edit/Delete is gone. Instead, three campaign-level buttons sit
  bottom-left under each table:
  - **View** — full, untruncated history of every update ever logged for
    that campaign (the on-page table's Notes column stays truncated to
    60 chars for compactness).
  - **Update** — always *adds* a new entry (Date Created = now); it never
    edits a past one. Save/Cancel footer.
  - **End** — flips status Active → Inactive; buttons swap to
    Resume/Archive.
- Inactive campaigns: **Resume** flips status back to Active; **Archive**
  sets `archived: true` and removes the campaign from this page entirely.
- New "History" button (page header) opens a modal listing every archived
  campaign with its own on-demand **View** into its full update history.
- Campaigns are NOT filtered by the sidebar's global date picker — an
  Active campaign keeps showing regardless of the selected date, only
  Archive removes it from the main list.

**[marketing-ads-summary.html](marketing-ads-summary.html) / [marketing-ads-summary.js](marketing-ads-summary.js) — "Monitoring Summary":**
- Same flat-list format as before, but now sourced from
  `marketingCampaigns` + each campaign's `entries` subcollection instead
  of grouping a flat log by campaign-name string. Lists every campaign
  (Active, Inactive, and archived alike) as one row: Status = the
  campaign's own status field; CPM = average across ALL of that
  campaign's entries (whole history, not month-limited); Cost/Impression/
  Views/Inquiries = its most recent entry; Notes = "View" button listing
  every dated note.

**[firestore.rules](firestore.rules):** replaced the `marketingAdsDaily`
rule with `marketingCampaigns/{campaignId}` (+ its `entries`
subcollection) — same open-to-any-authenticated-user CRUD pattern as
staffSchedules/leaveRequests, gated by role in the CrownOS UI. **Deployed**
via `firebase deploy --only firestore:rules`.

## 2026-08-25 — New "Marketing" sidebar menu: Ads Monitoring (daily) + Monitoring Summary [superseded above same day]

## 2026-08-25 — New "Marketing" sidebar menu: Ads Monitoring (daily) + Monitoring Summary

**Requested by:** User — wanted a new sidebar section visible to the
Marketing Agent role and Admin (plus optionally grantable to any other
account), starting with a daily Ads Monitoring log and a per-campaign
Monitoring Summary rollup.

**New pages:**
- [marketing-ads-daily.html](marketing-ads-daily.html) / [marketing-ads-daily.js](marketing-ads-daily.js)
  — "Ads Monitoring". Daily entries in Firestore collection
  `marketingAdsDaily`: Campaign (text), Date (date picker, shown as
  "Aug-25-2026"), Status (Active/Inactive dropdown, green/yellow pill),
  CPM and Cost (₱ amount inputs), Impression/Views/Inquiries (numbers),
  Notes (text). Full add/edit/delete, no branch scoping (marketing spend
  isn't tracked per-branch).
- [marketing-ads-summary.html](marketing-ads-summary.html) / [marketing-ads-summary.js](marketing-ads-summary.js)
  — "Monitoring Summary". Read-only rollup computed client-side from the
  same `marketingAdsDaily` collection, grouped by Campaign: Status and
  Cost/Impression/Views/Inquiries come from that campaign's most recent
  daily entry; CPM is averaged across ALL of that campaign's daily
  entries (not limited to the current month); Notes is a "View" button
  listing every dated note logged for the campaign. No Date or Next Step
  columns (per request).
- [marketing.css](marketing.css) — shared table/status-pill/modal styles
  for both pages, matching the existing incident-report.css pattern.

**Access:**
- [sidebar.js](sidebar.js): new "Marketing" section with both links,
  visible to Admin/Marketing Agent by default.
- [access-control.js](access-control.js): both pages added to
  `PAGE_ACCESS` (Admin/Marketing Agent) — not added to
  `EXTRA_ACCESS_EXCLUDED_PAGES`, so either page can also be granted to
  any other account.
- [account-settings.js](account-settings.js): both pages added to
  `EXTRA_ACCESS_PAGES` so an Admin can tick them under a user's
  "Additional Access" list.
- [firestore.rules](firestore.rules): new `marketingAdsDaily` collection,
  full CRUD for any authenticated user (role/extraAccess gating happens
  in the CrownOS UI, same pattern already used for staffSchedules /
  leaveRequests — Firestore rules can't see custom role/extraAccess
  claims). **Not yet deployed** — run `firebase deploy --only
  firestore:rules` from this folder before Marketing entries can be
  saved in production.

## 2026-08-25 — Expenses Report: month-only Date, S.I. No./TIN/Transaction ID columns, Mode of Payment removed

**Requested by:** User — wanted the Date field to only ask for a month (no
day), shown short like "Aug-25", across all six category tables. Also
wanted Operation Expenses' Mode of Payment column replaced by two new
columns (S.I. No. and TIN); the same two columns added to Utilities /
Monthly Dues and Installments (between Amount and Remarks); and a
Transaction ID column added to Marketing (also between Amount and
Remarks). Salary and Accounting / Government Dues only get the Date
change.

**Changes applied ([expenses-report.js](expenses-report.js), [expenses-report.html](expenses-report.html)):**
- The shared Add/Edit modal's Date field changed from `type="date"` to
  `type="month"`, so every table now stores just a "YYYY-MM" value.
  `formatDateText()` now renders that (or the first 7 chars of any older
  full date) as "MMM-YY", e.g. "Aug-26".
- `expenseTables` config gained an `extraFields` array per table
  (`["siNo","tin"]` for Operation/Utilities/Installments, `["transactionId"]`
  for Marketing, `[]` for Salary/Gov) driving which modal fields show,
  which table columns render, and which fields get saved/loaded — replacing
  the old `isOperation`-only special-casing for Mode of Payment.
  `renderTableBody()` and the PDF export's row-building are now generic
  over `table.columns`/`extraFields` instead of hardcoding the Operation
  layout.
- The old "Mode of Payment" modal field/column is gone everywhere
  (dropped from Operation Expenses; it wasn't used by any other table).
- [petty-cash.js](petty-cash.js): liquidation still auto-posts entries
  into Operation Expenses, minus the now-removed `payment: "Petty Cash"`
  field (`PETTY_CASH_EXPENSE_PAYMENT` constant removed too).
- [manual.html](manual.html): updated the Petty Cash liquidation and
  Expenses Report sections to drop the Mode-of-Payment mention and
  document the month-only Date and the new S.I. No./TIN/Transaction ID
  columns.

**Verified:** served the page locally (temp copy with the Firebase/login
gate stripped, deleted after testing — not committed), added a real
Operation Expenses entry and a Marketing entry through the actual modal,
confirmed the on-screen tables render the new columns with no Mode of
Payment, then captured `exportExpensesPDF()`'s output as a blob and
rendered its pages to PNG — confirmed "Aug-26" date formatting, the new
columns/labels, and correct subtotal placement in the generated PDF.

**Status:** Code changed locally, not yet deployed — run
`firebase deploy --only hosting` from `Income Report/` when ready to push
live.

---

## 2026-08-25 — Expenses Report PDF export: one section per page, totals only on a table's last page

**Requested by:** User — exported PDF was mixing sections together when a
category table only filled part of a page (e.g. Operation Expenses ending
mid-page with Salary starting right below it instead of on its own page),
and wanted every section on its own A4 page. Also wanted a table's
Subtotal/Total row to appear only once, on the last page, if the table
itself spans more than one PDF page.

**Fix applied ([expenses-report.js](expenses-report.js)):**
- `exportExpensesPDF()` now always calls `doc.addPage()` before every
  category ledger table (except the first, which follows the report
  header on page 1) and before the Summary Table, instead of the old
  conditional check (`cursorY > pageHeight - 45`) that only broke to a
  new page when the current section didn't fit in the remaining space.
- Added `showFoot: "lastPage"` to all three `autoTable()` calls (each
  category table + the Summary Table) so a Subtotal/Total row isn't
  repeated on every page of a table that overflows past one page — it
  now prints once, on the table's final page.
- Page format was already `"a4"` — no change needed there.

**Status:** Deployed via `firebase deploy --only hosting`.

---

## 2026-08-24 — New "Admin Hub" sidebar section: Announcement, Memo, Staff Schedule, Leave Request, Incident Report, Payroll relocation

**Requested by:** User — wanted a single sidebar section grouping
day-to-day admin/HR operations that either didn't exist yet or were
scattered elsewhere, with per-role views (Admin/Executive Assistant/Team
Leader manage; Receptionist/Therapist mostly self-service), plus a round
of refinements once the first version was reviewed against real usage.

**New sidebar section ([sidebar.js](sidebar.js), [sidebar.css](sidebar.css)):**
"Admin Hub" inserted right after Booking Requests (inside Operations),
containing Announcement, Memo, Staff Schedule, Leave Request, Incident
Report, and the existing Payroll page (moved here from its old spot,
`payroll.html`/`.js`/`.css` unchanged). Every sidebar section header
(Operations, Admin Hub, Inventory, etc.) is now a click-to-fold/unfold
accordion toggle, independent of the existing whole-sidebar collapse-to-
icons button, remembered per-section in `localStorage`. Fixed a closure
bug found during testing where every section's toggle was silently
folding *Settings'* group instead of its own (all the per-iteration
`pendingSection`/`pendingGroup` variables were shared across the whole
`MENU_ITEMS` loop, so a deferred click handler only ever saw whichever
section was built *last*) — each button now carries its own group
reference (`pendingSection._targetGroup`), set at creation time.
Notification bell widened from Therapist/Receptionist-only to all roles,
merging in a new `staffNotificationsClient`-backed source (see below).

**New page — Announcement ([admin-announcement.html](admin-announcement.html)/[.css](admin-announcement.css)/[.js](admin-announcement.js)):**
single-slot box (Firestore `announcement/current`), editable by Admin and
Executive Assistant, notifies every active account on publish. "Send to
Archive" copies the current announcement into a new `announcementArchive`
collection and clears the slot; "View Archive" lists everything archived.

**New page — Memo ([memos.html](memos.html)/[.css](memos.css)/[.js](memos.js)):**
mailbox in Firestore `memos`, composed by Admin/Executive Assistant to
chosen recipients, with per-recipient Acknowledge + timestamp tracked in
an `acknowledgements` map. "Create Group" saves named recipient sets
(`memoGroups` collection) for reuse. Fixed a bug where Acknowledge always
failed with "Missing or insufficient permissions": the write used a
plain string key (`"acknowledgements." + email`), and since a sync email
always contains a literal "." (`u-name@crownos-sync.com`), Firestore read
that as a 3-segment path instead of one flat key — switched to
`firebase.firestore.FieldPath("acknowledgements", email)`.

**New page — Staff Schedule ([staff-schedule.html](staff-schedule.html)/[.css](staff-schedule.css)/[.js](staff-schedule.js)):**
went through several iterations before landing on: a weekly grid per
branch (Firestore `staffScheduleGrids`, one doc per branch+week) with
Opening/Closing sections (one Receptionist row, one or more Therapist
rows via "+ Add Therapist"), a Rest Day row, and Notes — all cells are
staff dropdowns (now also listing Executive Assistant accounts, so an EA
can be assigned to cover Receptionist duty). The page shows only the
*current* week by default; "History" and "Upcoming Schedule" are
collapsible banners at the bottom (styled as full-width bars with the
label boxed at the right) listing past/future generated weeks. "Create
Schedule" opens a week-picker (dropdown of "Week N (date range)" options)
plus the grid, submitting via "Generate Schedule"; editing an existing
week reuses the same form with "Save Schedule" and a "Clear Schedule"
reset button. Receptionist accounts see the same grid read-only (their
"Edit Schedule" action on Upcoming items was silently opening the real
edit modal — fixed to route non-editors to the read-only view instead)
plus an "On Leave This Week" panel. Therapist accounts (not Team Leaders)
see only their own assignments for a selected week, plus their own
"Upcoming Schedule" list — fixed a routing bug where Team Leaders
(`teamLeader: true` on a Therapist account) were being sent to this
plain view instead of the full editable grid. Leave Request approval
(below) writes directly into a therapist's own-week view via the
separate `staffSchedules` collection, tagged `source: "leave"`.

**New page — Leave Request ([leave-requests.html](leave-requests.html)/[.css](leave-requests.css)/[.js](leave-requests.js)):**
`leaveRequests` collection; any account submits (Leave Type, dates,
reason — Total Days auto-computed from the date range). Admin/Executive
Assistant/Team Leader see all requests; opening one flips it from
Pending to Processing, then Approve/Decline. Approving writes one
`staffSchedules` doc per date in range (`source: "leave"`) so it shows up
automatically on that person's Staff Schedule.

**New page — Incident Report ([incident-report.html](incident-report.html)/[.css](incident-report.css)/[.js](incident-report.js)):**
`incidentReports` collection, submit-only (no approval workflow) —
Admin/Executive Assistant/Team Leader see a history table with full-text
view.

**Account Settings ([account-settings.html](account-settings.html)/[.js](account-settings.js)):**
new "Enable Secondary Role: TL Floater" checkbox, available on both
Receptionist and Therapist accounts (unlike Team Leader / secondary-role-
Receptionist, which are Therapist-only) — saved as `tlFloater: true/false`
on the account record, no behavior wired up yet per request (reserved for
a later task).

**Firestore rules ([firestore.rules](firestore.rules)):** new blocks for
`announcement`, `announcementArchive`, `memos`, `memoGroups`,
`leaveRequests`, `incidentReports`, `staffScheduleGrids`, and
`staffNotificationsClient` (a client-writable notification feed used for
Announcement/Memo broadcasts, kept separate from the existing
Cloud-Function-only `staffNotifications` so that collection's server-only
guarantee stays intact). **Known accepted gap:** Staff Schedule and Leave
Request approve/edit writes are open to any authenticated user at the
rules level, not restricted to Admin/Executive Assistant/Team Leader,
because `teamLeader` is a plain field on the account record, not a
Firebase Auth custom claim rules can check — enforcement for that case is
UI-only for now, by the user's choice, until/unless a `syncMyRole`-style
claim is added later. **Deployed to the live project** (`firebase deploy
--only firestore:rules`) — this part is already live regardless of when
the hosting files below go out.

**User Manual ([manual.html](manual.html)):** new "Part Six · Admin Hub"
(Chapters 24–28: Announcement, Memo, Staff Schedule, Leave Request,
Incident Report), pushing the old Part Six "Reference" to Part Seven
(Checklists/Troubleshooting renumbered 29–30). Updated the Chapter 3
sidebar layout table and the Chapter 4 access matrix to match, and added
a short note under Payroll (Chapter 10) pointing at its new location.

**Deployed:** `firebase deploy --only firestore:rules` and `firebase
deploy --only hosting` from `Income Report/`. Live at
`crownos-5f03d.web.app`.

---

## 2026-08-24 — User Account: "Set as Team Leader" checkbox with auto-granted access

**Requested by:** User — wanted a way to mark a Therapist as a Team Leader
when creating/editing their account, with its actual behavior to be defined
in a later task; then asked for it to automatically grant the pages a Team
Leader needs. Also asked to drop the helper text under Enable Secondary
Role: Receptionist.

**Change ([account-settings.html](account-settings.html)):** new "Set as
Team Leader" checkbox directly under Enable Secondary Role: Receptionist,
inside a `#teamLeaderField` container that shows only when Type of User is
Therapist — same show/hide pattern as the Secondary Role field next to it.
Also removed the Secondary Role field's `<small>` helper text per request.

**Change ([account-settings.js](account-settings.js)):**
- `updateTeamLeaderFieldState()` mirrors `updateSecondaryRoleFieldState()`:
  shows the field only for Therapist, force-unchecks it otherwise.
- The checkbox state is reset on new-account, populated on edit
  (`user.teamLeader === true`), and saved as a plain `teamLeader: true/false`
  field on the user record — same as `secondaryRole` — with no behavior
  attached to it yet.
- `applyTeamLeaderAutoAccess()`: when the checkbox is checked, auto-checks
  the three `.extra-access-checkbox` boxes for `index.html` (Daily Income
  Report), `statistics.html`, and `scheduling.html`, so they get saved into
  `extraAccess` like any manually-granted page. Wired to the checkbox's own
  `change` event, and also re-applied when opening an existing Team
  Leader's account for edit (so accounts marked Team Leader before this
  existed self-heal to the same access on next edit+save). Unchecking Team
  Leader does not strip access already granted — intentional, admin removes
  it manually under Additional Access if needed.

**Not yet implemented:** what "Team Leader" actually changes beyond page
access (the user said this comes in a later task).

**Status:** Code changed locally, not yet deployed — run
`firebase deploy --only hosting` from `Income Report/` when ready to push
live.

---

## 2026-08-22 — Booking confirmation modal: styled the Email/SMS options box

**Requested by:** User — the "Send booking confirmation?" popup's Email/SMS
checkboxes sat on plain white with no visual separation from the rest of the
modal, hard to notice.

**Change ([scheduling.html](scheduling.html), [scheduling.css](scheduling.css)):**
wrapped both checkbox rows in a new `.confirm-send-options` container styled
with the app's own cream/gold tokens (`var(--cream)` background, `1px solid
var(--accent-border)`, 12px radius) — the same beige used elsewhere in the
app — so the options read as one grouped, on-theme box instead of two bare
rows. No behavior changed.

**Deployed:** `firebase deploy --only hosting` from `Income Report/`.

---

## 2026-08-22 — Purchase voucher rework: draft-until-settled, redesigned PDF, 6-month expiry

**Requested by:** User — the Add Sale "Generate Voucher" button immediately
wrote to the Voucher Masterlist and had no printable output worth using; the
official record should only exist once the sale is actually paid for, and the
voucher's look/format needed to match the branded design the user had in
mind, laid out for real printing, plus a validity window.

**Change ([index.html](index.html), [script.js](script.js)):**
- "Generate Voucher" renamed **Add Purchase Voucher**; its dialog no longer
  writes to the Voucher Masterlist registry on click. It now only reserves a
  voucher code (`generateVoucherCode()` checks both the registry and every
  other pending/unsaved sale's codes to avoid collisions) and attaches it to
  the sale line item as a draft (`voucherOfficial: false`), then closes the
  dialog immediately — no more confirmation popup.
- New `finalizeSaleVouchers(saleData)` promotes every pending voucher
  purchase on a sale into a real Voucher Masterlist entry, keeping the same
  reserved code. It runs whenever a sale is Settled — both from the sale
  modal's Settle button and the Ongoing Transactions row's quick-settle
  button — never from Add to List / Add to Schedule.

**Change ([voucher-print.js](voucher-print.js), new
[voucher-font-cinzel.js](voucher-font-cinzel.js)):** rewritten from an HTML
print-window (browser Print dialog, `#F4F3EC` background) to direct jsPDF
vector rendering — dark-navy/gold branded card, "CROWN HEAD SPA" set in an
embedded Cinzel Decorative font, code box redesigned from a dashed border to
a solid double-line gold frame. `buildCrownVoucherPdf()` lays out as many
cards as fit per A4 page (3), continuing onto new pages — settling a sale
with vouchers now auto-downloads one combined PDF for everything finalized
in that sale, no print dialog involved. `printCrownVoucher()` (used by the
Voucher Masterlist's reprint button, relabeled "🖨 Download PDF") now goes
through the same renderer.

**Change (validity):** every voucher gets `expiresAt` = issue date + 6
months, set at the moment it becomes official (Settle), not at draft time.
`isCrownVoucherExpired()` in voucher-print.js is the single source of truth,
used by: the sale modal's redemption check (new "Voucher … expired on …"
message), the PDF (an EXPIRED diagonal stamp + a 4th "Valid Until" meta
column), and the Voucher Masterlist ([list-vouchers.js](list-vouchers.js),
[list-vouchers.css](list-vouchers.css)) — new amber "Expired" status badge
(derived live, not stored) and a matching filter option.

**Change ([manual.html](manual.html)):** Chapter 8 rewritten for the
draft→settle life cycle, the auto-downloaded combined PDF, the 6-month
expiry rule, and the new "expired" voucher message; the Add Sale command
reference entry renamed to match the button.

**Status:** Code changed locally, not yet deployed — run
`firebase deploy --only hosting` from `Income Report/` when ready to push
live.

---

## 2026-08-22 — SMS error surfacing + copy update

**Requested by:** User — first live SMS test failed silently with a generic
alert; needed the real reason surfaced, then wanted the message copy
expanded with a website call-to-action.

**Change ([functions/index.js](functions/index.js)):**
- `sendAppointmentSmsConfirmation` previously assumed a failed Semaphore call
  would show up as a non-OK HTTP status. In practice Semaphore returns
  `{"senderName": "No active sender name found..."}` (an error object, not
  the documented array) even on some non-200 responses that don't parse
  cleanly — the function now reads the raw response text first, parses it
  itself, and treats a present `result.message` (or a non-OK status) as a
  failure either way, logging the status/body via `console.error` and
  throwing an `HttpsError` whose message carries the real reason through to
  the client.
- Root cause of the first failure: the Semaphore sender name ("CrownSpa")
  had just been applied for and was still "Pending" — Semaphore requires an
  **approved, active** default Sender Name before it will send anything,
  separate from having credits loaded.
- `buildConfirmationSmsText()` now appends a second line: "For more details,
  visit our website: www.crownheadspa.com".

**Change ([scheduling.js](scheduling.js)):** the SMS failure `alert()` now
appends `error?.message` from the thrown `HttpsError`, so staff see the exact
Semaphore rejection reason instead of a generic "could not send" message.

**Status:** Sender name approval is pending on Semaphore's end as of this
entry — SMS sends will keep failing with "No active sender name found" until
Semaphore approves it, independent of any code here.

**Deployed:** `firebase deploy --only functions:sendAppointmentSmsConfirmation,hosting`.

---

## 2026-08-22 — SMS confirmation wired to Semaphore

**Requested by:** User — signed up for Semaphore (SMS API, Philippines) and loaded
credits, asked to activate the SMS half of the booking-confirmation checkbox
popup that had been left as a provision-only stub.

**Change ([functions/index.js](functions/index.js)):**
- `sendAppointmentSmsConfirmation` no longer returns
  `{ ok: false, reason: "sms_not_configured" }` — it now POSTs to Semaphore's
  `https://api.semaphore.co/api/v4/messages` endpoint (`apikey`, `number`,
  `message`) using Node 20's built-in `fetch`, with the API key stored as the
  `SEMAPHORE_API_KEY` Firebase secret (`firebase functions:secrets:set
  SEMAPHORE_API_KEY`). Throws `HttpsError("internal", ...)` on a non-OK
  response so the staff-side alert in `scheduling.js` fires correctly.
- `buildConfirmationSmsText()` — short single-message text (client name,
  service, branch, date, time, site link), separate from the HTML email copy.
- [scheduling.js](scheduling.js) — the SMS `.then()` no longer special-cases
  `ok:false` as "not configured yet"; a failed send now alerts the staff
  member the same way a failed email send does, while the appointment itself
  still saves regardless.
- No sender name is passed in the request, so Semaphore falls back to
  whatever sender name is registered as default on the account — if that
  registration is still pending, sends may fail until it's approved.

**Deployed:** `firebase deploy --only functions:sendAppointmentSmsConfirmation,hosting`.

---

## 2026-08-22 — Booking confirmation email/SMS (staff-controlled, on Save Schedule)

**Requested by:** User — set up `info@crownheadspa.com` (GoDaddy Professional Email)
and wanted clients to receive a confirmation once staff creates/confirms their
appointment. Later refined into an explicit staff choice per appointment rather
than an automatic send, plus a request to reorder the public booking form and
make the email itself look professional/on-brand.

**1. Cloud Functions ([functions/index.js](functions/index.js))**

- Removed the old `sendBookingConfirmationEmail` Firestore trigger (fired
  automatically whenever a `bookingRequests` doc's status became `"converted"`)
  — replaced with two `onCall` functions the client invokes explicitly, so a
  staff member's choice controls whether anything is sent at all:
  - `sendAppointmentEmailConfirmation` — sends the branded confirmation email
    via GoDaddy/Titan SMTP (`smtpout.secureserver.net:465`), using nodemailer
    with the mailbox password stored as the `EMAIL_PASSWORD` Firebase secret.
  - `sendAppointmentSmsConfirmation` — **provision only**, no SMS provider
    configured yet. Currently a stub that returns
    `{ ok: false, reason: "sms_not_configured" }`; the checkbox flow already
    calls it end-to-end, so wiring a real provider later (e.g. Semaphore) only
    means filling in this function's body.
- Email is HTML + plain-text fallback, branded to match CrownOS/Crown Head Spa:
  royal-blue-to-navy gradient header (`#0E1B3D` → `#16245C`, same as the
  CrownOS sidebar) with gold "CROWN HEAD SPA" wordmark in **Cinzel Decorative**
  (Google Fonts), crown mark logo, a details card (branch/service/date/time —
  date reformatted to "August 25, 2026" style), a Companions list (only shown
  if the appointment has any), arrival/scalp-analysis/discount notes, and a
  footer promoting `www.crownheadspa.com`.
- `nodemailer` added to [functions/package.json](functions/package.json).

**2. Staff panel ([scheduling.html](scheduling.html), [scheduling.js](scheduling.js))**

- Added `firebase-functions-compat.js` script tag (scheduling.html previously
  only loaded app/auth/firestore — never called a Cloud Function directly).
- New popup modal (`#sendConfirmationBackdrop`) — "Send booking confirmation?"
  with two checkboxes, **Email** and **SMS**, both unchecked by default.
  `openSendConfirmationModal()` disables whichever checkbox has no contact
  info available (currently sourced from `pendingRequestContact.email` /
  `.mobile`, only populated when the appointment came from a web booking
  request — a from-scratch walk-in appointment has no email/mobile capture
  point yet, so both stay disabled there).
- Wired into `saveSchedule()` right after all validation/conflict checks pass
  but *before* `claimBookingRequest`/the Firestore write — staff closing the
  popup aborts the save entirely (nothing written yet); confirming proceeds
  with the save and then fires `sendAppointmentConfirmations()` for whichever
  boxes were checked, including the companion list built from
  `companionPayloads`.

**Not changed:** manual/walk-in appointments (no linked booking request) still
have no way to capture a client's email or mobile in the Add Appointment modal
itself — the confirmation popup will show for them too, just with both
checkboxes permanently disabled until that capture point exists.

**Also in this session:**
- [Website/book.html](../Website/book.html) — moved "Preferred Time" to appear
  after the Service field (was between Preferred Date and Contact Number,
  confusingly disabled until Service was picked further down the form).

**Deployed:** `firebase deploy --only functions,hosting` from `Income Report/`
(functions in `us-central1`; old trigger deleted via
`firebase functions:delete sendBookingConfirmationEmail --region asia-southeast1`).
`Website/` deployed separately via `firebase deploy --only hosting` (site
`crownheadspa`) for the book.html field reorder.

---

## 2026-08-22 — Per-bed "Available" toggle in Scheduling; booking form redesign

**Requested by:** User — (1) a checkbox per bed column in Scheduling, checked by
default, that takes a bed offline for the day and reflects on the public booking
page; (2) reorder and simplify the public booking form's fields, replacing the
free-form "Companions" list with a "Number of Guest" count that drives matching
Name/Service row pairs, arranged in two clean columns.

**1. Per-bed availability ([scheduling.js](scheduling.js), [scheduling.css](scheduling.css), [functions/index.js](functions/index.js))**

- New `crownUnavailableBeds` key (flat array of `{ id, branch, date, bed,
  blockedBy, blockedAt }`, same shape/pattern as the existing
  `crownBlockedDates`) — auto-syncs to Firestore `appData` like every other
  `crown*` key, so Cloud Functions can read it with no new plumbing.
- Each bed column header in the Branch Schedule timeline now has an
  "Available" checkbox (`renderHeader`), delegated through a single
  `#scheduleHead` change listener (`attachEvents`) calling
  `toggleBedAvailability(bed, checkbox)`.
- Unchecking warns first via `confirm()` if the bed already has an
  appointment that day (existing appointment is left alone either way), then
  saves an entry and re-renders.
- `getPersistedConflictPool()` — the single function nearly every conflict
  check in the file already reads from (`poolHasConflict`,
  `findNextAvailableStart`, `recommendCompanionSlot`, `findAlternateBed`,
  the Save button's own check) — now appends a synthetic "occupies the whole
  business day" entry per unavailable bed, so no new appointment can be
  placed there without touching any of that logic directly.
- `renderBody` greys out the column (diagonal hatch, `cursor: not-allowed`)
  and ignores clicks on it; `buildBedOptionsHtml` disables and labels the
  bed "(Unavailable)" in the New/Edit Appointment bed dropdown (still
  selectable if it's the appointment's already-saved bed, so editing an
  older appointment doesn't silently lose its bed).
- Server side: new `countUnavailableBeds(branch, date)` helper subtracts
  from `matchedBranch.beds` before both capacity checks — `getAvailableSlots`
  and `submitBookingRequest`'s transaction — so the public website's slot
  count and capacity gate both drop by one for every bed taken offline.

**2. Booking form field order + guest rows ([book.html](../Website/book.html), [main.js](../Website/js/main.js), [style.css](../Website/css/style.css))**

- New field order: Branch, Number of Guest, Preferred Date, Preferred Time,
  Contact Number (Required), Email Address, then a "Name & Services" section,
  then Notes.
- The old "+Add companion" flow is gone. "Number of Guest" now directly
  controls how many Name/Service row pairs render (`initGuestRows`), laid out
  as two columns with one shared "Full Name" / "Service" header instead of a
  label per row. Guest 1's inputs are still the form's real `#name`/`#service`
  fields (unchanged by `initBookingForm`'s slot-availability logic); guests
  2+ reuse the existing `companion`/`companionService` field names, so
  `getCompanions()` and the `submitBookingRequest` payload shape didn't need
  to change.
- `initServiceCatalog()`'s live service list (fetched from
  `getBookableServices`) is now cached in `liveServiceOptionsHtml` and
  applied to every guest row — including ones added after the fetch
  resolves — instead of only the one static `#service` select it used to
  own alone. Init order changed so `initGuestRows()` (which creates
  `#service`) runs before `initServiceCatalog()` looks it up.
- Follow-up per user feedback: "Number of Guest" options are no longer a
  flat 1–6 — they're capped at the selected branch's actual bed count. New
  `exports.getBookableBranches` Cloud Function (`functions/index.js`, mirrors
  `getBookableServices`) exposes `{name, beds}` per branch from
  `crownBranchMasterList`. `initBranchCapacities()` in `main.js` fetches it
  once, rebuilds the guest-count `<option>` list (`populateGuestCountOptions`)
  whenever the branch changes, clamping the current selection down if the
  new branch has fewer beds (which also shrinks the guest rows via the
  existing change-triggered `renderRows`), and shows a hint
  (`updateGuestCountHint`) telling guests booking a bigger group to send a
  second, separate request. Falls back to the static single "1" option
  already in the markup if the function call fails, same fallback style as
  `initServiceCatalog`. Verified locally by stubbing `branchBedCapacities`
  and dispatching a branch-change event (the real function isn't deployed
  yet, so the live fetch 404s and the fallback path is what actually ran
  in-browser).

**Status:** Code changed locally, not yet deployed. Website form changes
verified locally in a browser (dynamic row add/remove, field order,
branch-capacity clamping via a stubbed response). Scheduling changes need to
be verified in CrownOS itself (private, does not run in this sandbox) before
going live — run
`firebase deploy --only functions:getAvailableSlots,functions:submitBookingRequest,functions:getBookableBranches`
plus `firebase deploy --only hosting` when ready.

---

## 2026-08-22 — Booking requests now auto-expire into Previous Requests

**Requested by:** User — "yung mga booking request na nag expire, pwede ba natin ilagay
din sa previous request. then lagyan nalang natin ng status na expired."

**Problem:** A `bookingRequests` doc only ever had three statuses — `pending`,
`declined`, `converted`. If a pending request's requested date passed with no staff
action, it stayed `pending` forever: it kept cluttering the live Pending table and
never showed up in Previous Requests, since History is simply "anything not pending"
(`booking-requests.js` `loadHistory`, filtered client-side to avoid a composite index).

**Fix applied:**
1. [`functions/index.js`](functions/index.js) — new scheduled function
   `expireStaleBookingRequests`, running every 15 minutes (same cadence as the existing
   `releaseExpiredHolds` job). It reads all `pending` requests, compares each `date`
   (Manila time) against today, and batch-updates any with a past date to
   `status: "expired"`. Because History is already "not pending", expired requests
   surface there automatically — no query change needed.
2. `releaseHoldOnRequestReview` trigger — added `"expired"` alongside `"declined"` /
   `"converted"` as a status that releases the request's associated `scheduleHolds`
   entry, so an expired request's slot hold doesn't linger.
3. [`booking-requests.js`](booking-requests.js) `formatOutcome()` — added a distinct
   "Expired" badge (warning/yellow) next to the existing "Appointment created" /
   "Declined" badges in the Previous Requests table.
4. [`manual.html`](manual.html) Chapter 14 — documented that expiry happens
   automatically and needs no manual decline.

**Status:** Code changed locally. Requires
`firebase deploy --only functions:expireStaleBookingRequests,functions:releaseHoldOnRequestReview`
plus `firebase deploy --only hosting` to go live.

---

## 2026-08-20 — Fixed mobile sync/login breaking from a full localStorage quota

**Reported by:** User — a staff iPhone and the Calamba iPad stopped showing new Daily
Income Report entries; after deleting and recreating the iPhone's home-screen icon,
it couldn't log in at all, on any browser, any network, even after a full restart.

**Root cause, found using Safari's Web Inspector over USB (not guessed):**

```
CrownCloud: initial sync failed. — QuotaExceededError: The quota has been exceeded.
— firebase-sync.js:551
```

Queried the live `appData` Firestore collection directly to size what every device
mirrors into its `localStorage`: **~2.83 MB total, 1.9 MB (68%) of it
`crownClientMasterList`** — the whole Client Database as one ever-growing JSON blob,
with no archiving. Mobile Safari/Chrome (WebKit) grants meaningfully less
`localStorage` per origin than desktop, especially on a device low on free storage —
consistent with two separate mobile devices failing while desktop was fine.

Worse: `applySnapshotToLocalStorage()`'s per-key write happened inside one
`forEach` loop with no per-key error handling, so a `QuotaExceededError` on the 1.9 MB
client list threw out of the loop and silently skipped every key `forEach` hadn't
reached yet — including `crownUserAccounts` (11 KB). That's why login itself broke,
not just the client list going stale: `CrownAuth.authenticate()` found no local
accounts to check the password against.

**Fix, two parts:**

1. **Resilience** — `firebase-sync.js` gained a shared `applyKeyToLocalStorage(key)`
   used by both places that apply incoming changes (the collection-snapshot pull and
   the realtime listener, previously two near-duplicate loops). Every key is now
   independently `try`/`catch`— one key failing to apply can never again take any
   other key down with it.
2. **Removed the actual dominant offender from `localStorage`** — new
   `client-store.js`: a small IndexedDB-backed store (`CrownClientStore`, DB
   `crownClientCache`), a much larger and more elastic quota than `localStorage`.
   `crownClientMasterList` is now special-cased out of the normal mirror entirely —
   `firebase-sync.js`'s apply loop, `flushPending()`'s push read, and every direct
   page call site (`clients.js`, `dashboard.js`, `scheduling.js`, `script.js`,
   `list-branches.js`'s branch-rename migration) now read/write it through
   `CrownClientStore` instead. A one-time migration copies over whatever a device
   already has cached under the old `localStorage` key the first time this runs
   there, then removes it, so nothing already-synced just disappears.
   `client-store.js` is loaded on every page, right before `firebase-sync.js` (same
   `<head>` position as `access-control.js` and friends).

**Read-only lookups stayed synchronous on purpose** (`getClientByName`,
`getClientMobile`, the Client datalist in `loadModalOptions`/`loadClientOptions`) —
each file keeps a `cachedClients` snapshot that `getClients()` refreshes, so
`buildScheduleRowHtml()`'s tight `.map()` render loop and similar display code never
had to go `async`. Anything that reads-then-writes (creating/updating a client record)
does go through the real `await CrownClientStore.getAll()`/`saveAll()` for
correctness — and where two such writes could race (e.g. a schedule's main client
plus its companions), calls were sequenced with `await` in a loop instead of
`forEach`, so the second write can't silently clobber the first.

**Status:** deployed — hosting only; no Firestore rules or Cloud Functions changed,
so no separate rules/functions deploy needed this time. The two originally-affected
devices still need their site data cleared once (documented in `manual.html`
Chapter 25) — the quota-exceeded state doesn't clear itself, since it's already
stuck before this fix's code ever gets a chance to run there.

## 2026-08-20 — Add Consumable, live Online Booking filter, Google Reviews, Messenger widget

Four pieces of previously-uncommitted work, found sitting in the working tree from an
earlier session and shipped together after reviewing each one individually.

**1. Add Consumable (Daily Income Report).** A sixth button beside Add Product: logs a
product used on a client without charging them — always ₱0.00 — while still deducting
branch stock and logging to the Stock Audit, the same as a real product sale.
- `list-products.html/js` — new `availableForConsumable` checkbox on the product form
  ("Available for Consumables"), migrated onto existing products defaulting to off.
- `script.js` — `addModalConsumableItem()`, a Product-type item flagged `isConsumable`
  (price locked at 0, excluded from the settle-amount validation), its own picker row
  restricted to `CrownInventory.getConsumableProductNames()`.
- `inventory-data.js` — `getItemsForProduct()` / `getConsumableProductNames()`;
  `syncSaleToStockAudit()` now also walks Product-type sale lines (previously
  Service-only) so a sold or consumed product deducts its linked inventory item.
- `product-sales-summary.js` — excludes `isConsumable` items, so they don't inflate
  product sales figures they were never charged for.
- `index.html`, `style.css` — the button and a light-blue row style to tell a
  consumable line apart from a paid one at a glance.
- `manual.html` — documented in Chapter 7 (Recording a Sale) and Chapter 22 (Master
  Lists → List of Products).

**2. `getBookableServices` now enforces "Available for Online Booking."** Previously
returned every Active service; now also requires `availableForOnlineBooking === true`
(`functions/index.js`). The toggle itself and its migration already existed and were
already live — checked the actual data in Firestore before deploying this: 15 of 26
active services already have it explicitly set, so this was staff-configured in advance,
not an empty gate that would have hidden every service from public booking.
`Website/book.html`'s service dropdown was trimmed to match.

**3. Google Reviews replaces the Elfsight testimonials widget.** New
`functions/googleReviews.js` — `getGoogleReviews` Cloud Function, reading both branches
from the Google Places API (Text Search once per branch, cached forever by Place ID;
review content cached 6 hours in Firestore `publicCache`, within the Google Maps
Platform terms). Needs the `GOOGLE_PLACES_API_KEY` secret — confirmed already configured
in the project before deploying. `Website/js/main.js`'s `initGoogleReviews()` already
called this function in a prior commit, meaning **the live testimonials section was
calling a Cloud Function that did not exist yet** until this deploy — this ships a fix
for an already-broken production feature, not a new risk.

**4. Floating Facebook Messenger chat widget**, added to every page across
`Website/` (`about.html`, `book.html`, `branches.html`, `careers.html`, `contact.html`,
`gallery.html`, `index.html`, `privacy.html`, `promos.html`, `services.html`,
`testimonials.html`) plus `js/main.js` (`initFbChatWidget()`) and `css/style.css`. One
`m.me` link per branch. `branches.html` and `contact.html`'s existing Facebook Page links
were swapped for the same direct Messenger links.

**Also:** `sidebar.js` + `access-control.js` opened the User Manual link to every role
(previously missing for Therapist, Marketing Agent, Branch Device — a read-only
reference page has no reason to be role-gated).

**Status:** deployed and live — `Income Report` hosting + functions
(`npx firebase deploy --project crownos-5f03d`) and `Website` hosting
(`npx -y firebase-tools@latest deploy --only hosting:crownheadspa` from `Website/`, per
the 2026-08-16 entry).

## 2026-08-20 — Booking Requests: remarks show the account's nickname

**Requested by:** User — remarks were showing "by <account>" (the login username);
wanted the account's nickname shown there instead.

**Built:**
1. `access-control.js` — `setCurrentUser()`'s session object gained `nickname:
   user.nickname || ""`. The full user record already had a `nickname` field (set on
   Account Settings, see `account-settings.js`), but the trimmed session object written
   to `localStorage` — what `CrownAuth.getCurrentUser()` actually returns everywhere
   else in the app — never carried it, so nothing outside Account Settings itself could
   read it.
2. `booking-requests.js` — `addRemark()` now stores `by: currentUser?.nickname ||
   currentUser?.account || ""`, falling back to the account name for any account with
   no nickname set (including every remark saved before this change).
3. `manual.html` — updated the "remarks cannot be edited" note to say nickname instead
   of account.

**Remarks already saved keep whatever they recorded at the time** — this only changes
what gets written going forward, not existing history.

**Status:** deployed and live (hosting).
## 2026-08-20 — Booking Requests: fixed remarks getting silently discarded

**Reported by:** User — added a remark, pressed the modal's Update button, it correctly
returned to the Pending table, but reopening Update on the same request showed no
remarks at all.

**Root cause, confirmed by reading the live document directly from Firestore (not
guessed):** the request's `updateTime` was still identical to its `createTime` —
the remark write had never reached the server. `Add Remark` (which writes to Firestore)
and `Update` (which only closes the modal) are two separate buttons; typing a remark and
pressing `Update` without pressing `Add Remark` first silently discarded the typed text —
nothing was ever sent. Firestore rules and the deployed JS were both verified correct and
live, ruling those out.

**Fix, in `booking-requests.js`:** added `flushPendingRemarkText()` — if the remark box
still has unsaved text, it calls `addRemark()` before letting the action proceed, and
blocks the action (leaving the modal open, with `addRemark()`'s own alert already shown)
if that save fails. Wired into all three ways to leave the modal: the footer `Update`
button (`saveAndCloseUpdateModal()`), `Create Appointment`
(`createAppointmentFromUpdateModal()`, now `preventDefault()` + navigates by hand after
flushing), and `Decline` (`declineFromUpdateModal()`). Also widened `addRemark()`'s error
alert to include the actual Firestore error message instead of a generic string, and
moved the whole function body inside its `try` block so a bug elsewhere in it can no
longer fail as a silent unhandled promise rejection.

**Status:** deployed and live (`npx firebase deploy --only hosting --project
crownos-5f03d`) — confirmed the new functions are present in the served
`booking-requests.js`. Not yet re-verified against a real staff login in the browser
(no test credentials available in this session) — worth a quick manual pass: type a
remark, press Update directly (skip Add Remark), reopen the request, confirm it's there.

---

## 2026-08-20 — Booking Requests: one Update button, with remarks

**Requested by:** User — wanted the pending table's Create Appointment / Decline pair
replaced with a single Update button, opening a place to log whether the client was
contacted before acting on the request. History's Outcome column needed a way to read
those remarks back.

**Built:**
1. `booking-requests.html` — the pending table's Action column is now a single
   **Update** button per row. Added two modals: `#bookingUpdateBackdrop` (remarks list,
   Add Remark box, then Update / Create Appointment / Decline in the footer, Update on
   the left) and `#bookingRemarksBackdrop` (read-only remarks view opened from History).
2. `booking-requests.js` — `openUpdateModal()` looks up the request from the pending
   list already held in memory (no extra read), renders its remarks, and wires
   Create Appointment's href and the Decline button to the existing `declineRequest()`
   flow (now returns a boolean so the modal only closes on an actual decline).
   `addRemark()` appends `{ text, by: account, at: Date }` with `arrayUnion` while the
   request is still pending, then pushes the same object onto the modal's local copy so
   it appears immediately without waiting on the next snapshot. The `Update` footer
   button just closes the modal — remarks are already saved the moment
   `Add Remark` is pressed. History's Outcome cell grew a `View Remarks` link that opens
   the same list read-only via `openRemarksModal()`.
3. `booking-requests.css` — `.booking-modal-*` / `.booking-remarks-*` rules, following
   the same backdrop-and-card pattern `clients.css` already uses for its modals (custom
   CSS, not Bootstrap's JS modal component — this codebase doesn't load
   `bootstrap.bundle.js` on this page).
4. `firestore.rules` — `bookingRequests` update rule gained a second allowed shape:
   an update whose only changed key is `remarks`, while `status` is still `'pending'`.
   The existing convert/decline branch (`status`, `reviewedAt`, `reviewedBy`,
   `convertedScheduleId`) is untouched. **Deployed** with
   `npx firebase deploy --only firestore:rules --project crownos-5f03d`.
5. `manual.html` — Chapter 14 (Booking Requests): documented the Update button and
   Add Remark flow, and that remarks cannot be edited or deleted once saved; noted
   History's new View Remarks link.

**Remarks are append-only by design** — there is no edit or delete affordance anywhere
in the UI, so the contact-attempt record a receptionist builds up on a request cannot be
altered after the fact. Each remark carries the account that wrote it (`by`) and a
client-side timestamp (`at`); `arrayUnion` can't take `serverTimestamp()` inside an
array element, so this is a plain `Date`, unlike `reviewedAt` elsewhere on the same
collection.

**First deploy attempt would have silently failed:** the rules file was edited locally in
an earlier session but never pushed, so `addRemark()`'s `arrayUnion` write was rejected
by the still-live old rules — the modal showed the new remark right away (the local
optimistic push happens after the `await` resolves, so this was actually a permission
failure the user caught by reopening the modal and finding the remark gone). Rules are
now deployed; anyone iterating on `firestore.rules` again needs to remember it is a
separate deploy from hosting.

**Status:** deployed and live — Firestore rules via
`npx firebase deploy --only firestore:rules --project crownos-5f03d`, then hosting via
`npx firebase deploy --only hosting --project crownos-5f03d` (this page is under
`Income Report/`, hosting's default site and `public` root per `firebase.json`, so no
`site`/target flag is needed, unlike the `Website/` deploy in the 2026-08-16 entry).

---

## 2026-08-16 — Promo popup on the public booking page

**Requested by:** User — wanted the "Opening Rates Extended" poster shown as a popup when
the booking page opens, closable with an X button.

**Built:**
1. `Website/book.html` — `#promoModal` markup at the top of `<body>`: the poster image, an
   X button, a "Book Now & Save More" button and a "Maybe later" link. The poster carries a
   descriptive `alt`, plus an `.sr-only` `<h2>` for the dialog's accessible name, because all
   the promo wording lives inside the image where a screen reader cannot reach it.
2. `Website/js/main.js` — `initPromoModal()`, called from the shared `DOMContentLoaded`
   block. Opens 600ms after load so the page paints first. Closes on the X, "Maybe later",
   the backdrop, Escape, or the CTA (which then scrolls to the form). Locks `body` scroll
   while open, focuses the X on open, returns focus on close, and keeps Tab inside the card.
3. `Website/css/style.css` — `.promo-modal*` rules in the site's black-and-gold palette,
   plus a general-purpose `.sr-only` utility the stylesheet did not have yet.
4. `Website/images/promo-opening-rates-extended.jpg` — the poster, from
   `WEbsite Materials/Extended Opening Rates.png`.

**Shown once per browser session,** not on every load, via `sessionStorage.crownPromoSeen` —
guests bounce in and out of the booking form while picking a service, and re-showing it each
time would read as broken. Both the read and the write are wrapped in `try/catch`: private-mode
Safari throws on `sessionStorage`, and the popup showing again is a far better failure than the
page's whole init block dying. Clear the key in the console to see it again while testing.

**Poster was re-encoded, not copied as-is:** the source PNG is 1.8 MB, which is a long wait on
mobile data for something that covers the screen on arrival. `sips` to JPEG at 900px wide,
quality 82, brings it to 293 KB with no visible loss. The original stays untouched in
`WEbsite Materials/`.

**Sizing:** the card is `width: auto` inside a flex overlay and the poster is capped at
`max-height: calc(100vh - 190px)`, so the card takes its width from however tall the image is
allowed to be. The poster is 2:3 portrait — at a fixed width it ran past the bottom of a
laptop window and needed scrolling inside the popup to reach the buttons.

**Only book.html carries the markup,** so `initPromoModal()` returns immediately on every
other page even though `main.js` is shared site-wide.

**Status:** deployed and verified live at https://crownheadspa.com/book.html — popup opens,
X closes it, page scroll returns, does not reappear on reload, no console errors. Checked at
desktop and 375px mobile.

**Expiry:** the promo ends **August 31, 2026**. Nothing removes the popup on its own — the
markup in `book.html` has to be deleted (or the image swapped for the next promo) by hand.

**Deploy:** `npx -y firebase-tools@latest deploy --only hosting:crownheadspa` from the
`Website/` directory. See the 2026-08-12 entry for why the directory matters.

---

## 2026-08-13 — Booking-request history, and stock that deducts itself off the sale

Three pieces of work, all now live: a history view for handled booking requests, the
inventory deduction that fires off the Daily Income Report, and a cost per item.

### Booking-request history

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

### Inventory: stock deducted automatically off the Daily Income Report

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

**Status: deployed.** It was held back a day first, on the assumption that shipping it
would immediately start moving real stock. It does not — deduction only fires for items
tagged with a service, and the check that settled it was the data itself: of the 25
items in production, **zero** carried a tag, in either the new `services` array or the
older single `service` string. Nor could any have been tagged, because the live Items
page had no service or transaction field at all — only name, category, unit and
description. So the deploy shipped the new UI and left every stock figure untouched.

The feature stays dormant until someone tags an item, which makes the safe rollout:
tag one item, save one real sale using that service, check the branch's Stock Audit row
and the stock it deducted, then tag the rest. That is also the only way to verify the
*quantities*, which static checks cannot reach — all five touched scripts parse, the
hooks are wired at four call sites in `script.js`, and no TODO markers remain, but none
of that says the arithmetic is right against live data.

**Deploy note:** `firebase deploy --only hosting` from `Income Report/` publishes the
whole folder, so it also carries anything else sitting uncommitted in the working tree.
Check `git status` first. Where that mattered here, the working copies were swapped for
the live ones before deploying and restored afterwards, verified by checksum both ways.

### Item Cost on inventory items

Items recorded what they were and where they went, but not what they were worth, so
there was no basis for costing what a treatment consumes.

Item Cost is now on the add and edit form, optional on both. Left blank it stores 0, so
an item can still be created without anyone stopping to look up a price. Anything that
is not a usable number, negatives included, also stores 0 rather than being written
through — worth knowing that this is silent, so a mistyped `-50` saves as ₱0.00 rather
than warning. It shows in the items table as a new column.

Items created before the field existed carry no `cost` at all. Every read goes through
`readItemCost()`, so they render as ₱0.00 rather than blank or NaN. The edit form still
shows an empty box for them, keeping the placeholder's promise that the field is
optional instead of pre-filling a 0 nobody typed.

Money is formatted the way `peso()` in script.js does it. That file is not loaded on the
inventory pages, so the formatting is repeated locally rather than reached for.

**Status:** deployed. Verified against a stubbed items list: blank saves as numeric 0, a
typed value round-trips exactly, a negative comes out 0, a pre-existing item with no
cost field reads as ₱0.00 and saves as 0, and the three-column row stacks on mobile.

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
