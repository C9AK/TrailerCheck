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

## Revision R7 (2026-07-11)
* "Tires inspected" checkbox and the hourly tire reminder are removed everywhere.
* Weight inputs are plain text. Truck number placeholder shows alphanumeric format.
* LOT toggle suppresses the telemetry fetch; unknown trailers show a friendly "will be registered" hint.
* Edit (inline editor: truck #, weight, notes) and Delete buttons on Carryover rows, shown only when ticket.created_by == current user (or manager). Delete also on My History rows and (manager) Archive rows. Non-owned rows' inline checkboxes are disabled for employees.
* Admin page: per-user Edit (role, active, password reset) + Delete; per-MC Edit (endpoint, token).

## Revision R8 (2026-07-12)
* Carryover Edit opens the FULL pickup form at /dashboard/new-pickup?edit=<id>, fully pre-populated (PATCH on save); inline editor removed. PTI column is read-only there.
* Telemetry fields (driver/location/model/fuel) are editable inputs; Samsara misses show a hint and never block manual entry.
* PTI section: structured checklist in 3 groups (Trailer/Lights/Chassis), labels LEFT + checkboxes RIGHT, master "Select All", Left/Right pairs on one line, optional corner-lights pair marked.
* Weight helper: "Type CRVR to route to the scale queue".
* QC flag form: "Urgent Flag (Global Visibility)" toggle. QC cards show persistent flag history (categories, severity, notes, media) — highlighted on RESOLVED tickets for fix verification.
* Flagged section renamed "Action Required": urgent tickets badge "URGENT — anyone can fix" + sorted first + "Open full form" button.
* Layout polls the flagged queue (15s): red count badge on the Carryover nav item + toast when QC flags YOUR ticket (or an urgent flag appears).

## Revision R9 (2026-07-13)
* `/dashboard/leaderboard` (all roles, Trophy nav item): ranked table with medal emoji for top 3, accuracy color-coded (>=95 emerald, >=85 amber, else rose), bold composite score, efficiency/volume/avg-time columns, current user's row highlighted, 30s auto-refresh, formula explainer footnote.

## Revision R11 (2026-07-13)
* Action Required cards gain "Mark Unresolvable / Can't Fix" (amber, ownership-gated). Opens an intentional-friction modal with a MANDATORY explanation (min 10 chars, submit disabled until met) and an "Escalate to QC" action.
* QC queue: unresolvable tickets get a red border + pulsing "EXCEPTION REVIEW" badge, the employee's reason displayed prominently in red, and the approve button becomes a red "Force Approve" (same 3-checkbox confirmation modal).
* Live feed renders TICKET_UNRESOLVABLE entries with an amber warning icon.

## Revision R12 (2026-07-13)
* PTI section: prominent "Is this a Chassis?" toggle at the top. The Chassis section (locks + zip ties) is HIDDEN and excluded from validation when off; pti_verified is re-derived server-side whenever the checklist or the toggle changes (toggling chassis off can auto-promote a waiting ticket). Select All operates on visible items.
