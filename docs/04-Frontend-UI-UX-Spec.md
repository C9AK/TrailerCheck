# 04 Frontend UI/UX Specifications

Build the frontend using Next.js and Tailwind CSS. The UI must be highly functional, prioritizing speed and minimizing clicks.

## 1. Route Structure

* `/login`: Standard auth page.
* `/dashboard/new-pickup`: The main data entry form.
* `/dashboard/carryover`: Shift handover table (`employee` and `manager` view).
* `/dashboard/qc-review`: Auditing queue (`qc` and `manager` view).
* `/dashboard/admin`: User and MC management (`manager` only).

## 2. The "New Pickup" Component Logic

* **Auto-fill UI:** When the user types a Truck Number and triggers the telemetry API, show inline skeleton loaders for `Driver Name`, `Location`, `Model`, and `Fuel`.
* **No File Uploads:** Do not render `<input type="file" />` for PTI. It is strictly a checkbox array.
* **LOT Trailer Toggle:** Include a switch component. If switched to LOT trailer, display a DatePicker showing the `last_pti_date`. Allow the user to overwrite it manually.

## 3. Carryover Dashboard (Timer Logic)

* Render a data table for tickets in `AWAITING_DRIVER`.
* Implement a client-side hook (`useTicketTimer`) that compares the current time against `scale_requested_at`.
* **Visual Rules:**
  * $< 60$ mins: Standard white/dark-mode row background.
  * $60 - 119$ mins: Apply `bg-yellow-100` (or yellow border). Add a small Lucide React `AlertCircle` icon next to the truck number.
  * $\ge 120$ mins: Apply `bg-red-100`, move row to the absolute top of the table sorting, and add a pulsing red dot (`animate-pulse`).
* **Inline Edits:** Render checkboxes directly in the table cells. Clicking one fires the `PATCH /api/tickets/{id}` endpoint immediately. Do not open a modal.

## 4. Intentional Friction (QC Modal)

* In the `/dashboard/qc-review` route, when a QC user clicks "Approve Ticket", DO NOT fire the API immediately.
* Open a `ConfirmationModal`.
* Inside the modal, render 3 un-checked checkboxes:
  1. `Data matches Samsara/Telematics`
  2. `Weights are within legal bounds`
  3. `Documentation is visually confirmed`
* The final "Confirm Approval" button remains `disabled` until all 3 state variables are true.

---

## Revision R2 (2026-07-09)

* New Pickup: added `sticker_verified`, `tires_inspected` checkboxes and a prominent CA/FL destination checkbox. PTI checklist is optional at save (copy explains it gates QC review).
* Carryover timers: scale overdue alert at >= 120 min (yellow + AlertCircle), critical at >= 240 min (red, pulsing dot, sorted to top). New hourly tire reminder: while `tires_inspected` is unchecked, its cell pulses amber each elapsed hour.
* Employee layout: performance score badge permanently top-right.
* QC flag form: multi-select strict categories, notes textarea (required for Other), 1-10 severity slider shown only for "Didn't text in the group", media proof (file upload or pasted URL).
* Employee Carryover shows a "Flagged by QC — fix & resend" section with categories, severity, notes, media, inline fixes, and an explicit resend button.
* New manager routes: `/dashboard/manager/archive` (date-filtered history) and `/dashboard/manager/stats` (daily/monthly/all-time per employee).

## Revision R3 (2026-07-09)

* `/dashboard/my-history` (employee/manager): date-picker-filtered table of ALL own tickets, visible in every state.
* `/dashboard/qc-history` (qc/manager): "My Audits" — Approved/Flagged toggle tabs + date picker, rows dated by the QC action.
* `/dashboard/manager/live-feed` (manager): live-scrolling feed polling every 5s, LIVE indicator, event icons, "[timestamp] message" format, new entries flash-highlighted.

## Revision R4 (2026-07-09)

* Manager Archive: "Export Daily Pickups" button next to the date picker; enabled once a "From" date is selected, downloads the CSV for that day via authenticated fetch.

## Revision R5 (2026-07-09)

* `/dashboard/all-pickups` (all roles): read-only spreadsheet-style Global Sheet — zebra rows, sticky header, checkmark columns, auto-refreshes every 20s.
* Carryover is now the "Active Board": shows awaiting/pending/resolved with status badges ("Sent to QC / Pending", "Back at QC"); rows stay inline-editable after submission and disappear only on APPROVED.

## Revision R6 (2026-07-09)

* `/dashboard/notes` "Notes" tab (all roles; handover section employee/manager only). Section A: auto-compiled gap notes (sparkle badge) + manual note input + "Publish Shift Handover" button. Section B: Global team inbox of published notes with Edit and Done (resolve) actions, 20s auto-refresh.

## Revision R14 (2026-07-14) - Retry interceptor, QC parity UI, LOT badge

* **API retry interceptor (`lib/api.ts`):** requests failing on network error, 30s timeout, or 502/503/504 retry automatically up to 3 times (3s / 5s / 8s backoff). A throttled global `tc-toast` event fires "Waking up secure connection, please wait..." - rendered by the dashboard toast stack and as an inline amber status on the login form. 204 responses no longer crash the client (successful deletes previously showed "Delete failed").
* **QC parity:** New Pickup / Carryover / Notes / My History nav + pages open to `qc`; QC users get the flag-notification poll, the urgent-flag toast, the hourly missing-items reminder, and the performance ScoreBadge.
* **QC Review:** prominent crimson "LOT Trailer" badge next to the truck number when `is_lot_trailer`; a QC user's own pickups show "Your pickup - another QC or a manager must audit it." instead of Approve/Flag buttons (backend enforces 403 regardless).
* **Edit form:** the Motor Carrier select is enabled in edit mode and `mc_id` is sent on PATCH. Error toasts surface the backend `detail` message.

## Revision R16 (2026-07-14) - QC delete power

* QC Review cards gain a trash button (with confirm) that deletes the pickup outright - including on the QC's own conflict-of-interest cards.
* Carryover: the delete icon now appears for QC on every row (edit remains creator/manager-gated).

## Revision R17 (2026-07-15) - CST everywhere, drafts, filters, search

* **Global CST display:** all timestamps render in America/Chicago via `lib/time.ts` (Intl.DateTimeFormat; no new dependency). Applied to All Pickups, My History, QC History, Archive, Live Feed, Notes.
* **Shifts (CST):** First 1 AM-9 AM, Main 9 AM-5 PM, Third 5 PM-1 AM (spans midnight; 12-1 AM belongs to the PREVIOUS day's Third shift). QC Review gains Shift + Employee + Newest/Oldest sort filters; All Pickups and Carryover gain Day (datepicker) + Shift filters.
* **Search:** real-time truck #/MC search bars on QC Review, Carryover, All Pickups, and My History.
* **"Still Sending" drafts:** secondary "Save Draft (Still Sending)" button on the New Pickup form (create + resumed drafts); saving clears the form for the next concurrent pickup. Sidebar "Active Drafts" panel lists parked drafts (truck + MC), one click resumes the full pre-filled form; primary button reads "Submit Ticket" when resuming a draft. STILL SENDING badge (sky blue) in all tables.
* **My History:** Edit button on every row opens the full form pre-filled; APPROVED edits return to My History on save.
* **New checkboxes:** "ELD mentioned" + "Checklist sent" on the form, as inline-editable Carryover columns, All Pickups sheet columns, and QC Review pills.

## Revision R18 (2026-07-15) - Master PTI box, PTI video log, notes for QC

* **New Pickup form:** prominent crimson-bordered master "PTI" checkbox at the top of the PTI section - it alone marks PTI verified. The granular checkboxes remain unchanged below as the video log (Select All intact); the chassis toggle now just shows/hides the chassis rows. Status line reads "PTI status: VERIFIED/NOT VERIFIED (master checkbox) - video log: N item(s) noted".
* **Carryover:** PTI is now an inline-editable checkbox column like the rest (the old read-only "via full checklist" cell is gone) - ticking it can promote the ticket to PENDING_QC.
* **QC Review:** the PTI pill shows the master status; a collapsible read-only "PTI video log - N/M item(s) noted" panel lists exactly which granular items the employee checked, for context without false flags.
* **Notes:** Edit/Done buttons on the global board now show for QC too; delete buttons (trash) on draft and published notes for the author or a manager, wired to the new DELETE endpoint.

## Revision R19 (2026-07-15) - Sticky table scrollbars + bulk note paste

* **Tables:** Carryover and My History table wrappers use `max-h-[calc(100vh-230px)] overflow-auto` with a sticky `<thead>` - vertical scrolling happens inside the wrapper, so the horizontal scrollbar is always visible without scrolling to the last row. (All Pickups already used this pattern; QC Review is a card grid with no horizontal scroll.)
* **Bulk notes:** the manual-note input is a textarea; on submit the text splits on line breaks, trims each line, skips empties, and creates ONE note per line. Button shows "Add N notes" for multi-line input; success shows a banner plus a toast with the created count; partial failures report "Created N of M". Enter submits, Shift+Enter adds a line.

## Revision R20 (2026-07-15) - Discard Draft + Last PTI Date

* **Discard Draft:** trash icon on each row of the Active Drafts sidebar panel, and a "Discard Draft" button (next to Save Draft/Submit) when the New Pickup form is resuming a `DRAFT_IN_PROGRESS` ticket. Both confirm before permanently deleting.
* **Last PTI Date:** QC Review cards show "Last PTI Date: MM/DD/YYYY" (CST, via new `fmtCstDate`) sourced from the backend's per-ticket historical lookup; reads "No prior record" when the truck/trailer has never had a verified PTI before.
