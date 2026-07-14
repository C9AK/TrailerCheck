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
