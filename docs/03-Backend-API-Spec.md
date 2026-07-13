# 03 Backend API & Business Logic

Implement these routes in FastAPI. All routes (except login) require JWT authentication.

## 1. Authentication & Users
* `POST /api/auth/login`: Accepts username/password, returns JWT token with `role` payload.
* `GET /api/users/me`: Returns current logged-in user profile.
* `POST /api/admin/users`: (Manager only) Create new employees.

## 2. Telemetry Proxy
* `GET /api/telemetry/truck/{mc_id}/{truck_number}`: 
  * Looks up the MC API key from the DB.
  * Makes a server-to-server request to the external fleet API.
  * Returns JSON: `{ driver_name, location, model, fuel_percentage }`.
  * *Constraint:* Mock this external API call with dummy data if the real API isn't available yet.

## 3. Ticket CRUD
* `POST /api/tickets`: Create a new pickup ticket.
  * *Logic:* If `Standard Pickup`, `pti_verified` MUST be true.
  * *Logic:* If `LOT Trailer`, backend checks `Trailers.last_pti_date`. If < 7 days, `pti_verified` is optional. If >= 7 days, block creation unless `pti_verified` is true.
* `PATCH /api/tickets/{id}`: Update specific fields (used for inline editing in Carryover).
  * *Logic:* If updating `scale_ticket_received` to True, and all other required fields are true, automatically change `state` to `PENDING_QC`.
* `GET /api/tickets/carryover`: Returns tickets where state = `AWAITING_DRIVER`.
* `GET /api/tickets/qc`: Returns tickets where state = `PENDING_QC` or `RESOLVED`.

## 4. QC Actions
* `POST /api/tickets/{id}/approve`: (QC/Manager only) Changes state to `APPROVED`. Adds +10 points to the `created_by` user's performance score.
* `POST /api/tickets/{id}/flag`: (QC/Manager only) Requires `error_category`. Changes state to `FLAGGED`. Deducts points from `created_by` user based on severity. Writes to `QC_Audit_Flags` table.
---

## Revision R2 (2026-07-09)

* **PTI logic change:** `POST /api/tickets` no longer rejects missing PTI — the ticket saves as AWAITING_DRIVER. The PTI gate applies at the transition to PENDING_QC: `pti_verified` true, OR LOT trailer whose `last_pti_date` is < 7 days old at transition time. `sticker_verified` is also required for readiness.
* `POST /api/tickets/{id}/flag`: accepts `error_categories[]`, `notes`, `severity` (1-10, required iff Didnt_Text_In_Group), `media[] {url, media_type}`. One audit row + one penalty per category.
* `POST /api/tickets/{id}/resolve`: employee sends FLAGGED -> RESOLVED explicitly.
* `GET /api/tickets/flagged`: FLAGGED tickets for the employee dashboard.
* `GET /api/tickets/qc?include_awaiting=true`: QC early review of AWAITING_DRIVER tickets.
* `POST /api/uploads` (qc/manager): multipart image/video, served at `/media/*`.
* `GET /api/tickets/archive` (manager): all tickets; filters start_date, end_date, state, created_by; paginated.
* `GET /api/stats/employees` (manager): completed (= APPROVED) pickups daily/monthly/all-time per employee, from TICKET_APPROVED audit events.
* Telemetry response: adds `latitude`/`longitude`; `model` includes the year; `location` is the full formatted address. Unknown truck -> 404.

## Revision R3 (2026-07-09)
* `GET /api/tickets/my-history?on_date=` (employee/manager): every ticket created by the caller, any state, newest first.
* `GET /api/tickets/qc-history?outcome=approved|flagged&on_date=` (qc/manager): tickets the caller approved/flagged, dated by the QC action timestamp; returns {processed_at, ticket}.
* `GET /api/feed/live?limit=` (manager): newest-first immutable activity feed entries with rendered messages.
* Every lifecycle action now writes BOTH audit_logs and live_activity_feed. New event TICKET_SENT_TO_QC fires when a Carryover ticket completes via PATCH.

## Revision R4 (2026-07-09) — Data Export
* `GET /api/export/pickups?date=YYYY-MM-DD` (manager only): returns a `.csv` attachment (`pickups_<date>.csv`, UTF-8 with BOM for Excel) of all pickups created that day. All relational data resolved to human-readable strings: MC name, creating employee, approving QC + approval timestamp, flag category labels, flaggers — no UUIDs.

## Revision R5 (2026-07-09) — Employee visibility & post-submission editing
* `GET /api/tickets/carryover` now returns AWAITING_DRIVER + PENDING_QC + RESOLVED (the employee "active board"); tickets leave it only when APPROVED. FLAGGED remains served by /api/tickets/flagged.
* `PATCH /api/tickets/{id}` is permitted while PENDING_QC/RESOLVED — fields update live for QC, state unchanged. Only APPROVED is locked (409).
* `GET /api/tickets/all` (any authenticated role): the Global Sheet — every ticket in the system, newest first (cap 500).

## Revision R6 (2026-07-09) — Shift Handover Notes
* `GET /api/notes/drafts` (employee/manager): live auto-notes from the caller's AWAITING_DRIVER tickets — one per missing checklist item, format "Truck N - MC: Waiting on Item" — plus their manual DRAFT notes.
* `POST /api/notes`: create a manual draft. `POST /api/notes/publish`: persist auto-notes + flip drafts to PUBLISHED, deduping identical open auto-notes.
* `GET /api/notes/global` (all roles): PUBLISHED, unresolved notes. `PATCH /api/notes/{id}/resolve`: -> RESOLVED with resolved_by/resolved_at. `PATCH /api/notes/{id}`: edit content (drafts author-only; published notes team-editable; resolved locked).

## Revision R7 (2026-07-11) — RBAC expansion & form logic
* Truck numbers are free strings (Samsara matching normalizes whitespace; "1319 A" works). Weight is free text.
* LOT trailers bypass fleet validation: unknown trailer numbers are auto-registered (stale PTI unless a date is provided) — no 404.
* `PATCH /api/tickets/{id}`: employees only for tickets they created (403 otherwise); managers edit ANY ticket in ANY state, including APPROVED. Accepts truck_number.
* `DELETE /api/tickets/{id}` (NEW): manager any / employee own-only. Logged to audit_logs + live_activity_feed ("X deleted pickup ticket for truck N (MC)"); flags+media delete with the ticket, audit logs and feed entries survive.
* Admin (manager): `PATCH /api/admin/users/{id}` (username/password/role/is_active; self-demote/deactivate blocked), `DELETE /api/admin/users/{id}` (hard delete only when the user has zero recorded activity; otherwise 409 -> deactivate), `PATCH /api/admin/mcs/{id}` (name/endpoint/api_key).

## Revision R8 (2026-07-12) — Triage, CRVR, PTI structure
* CRVR: weight text containing "CRVR" (case-insensitive) forces needs_scale=True on create and PATCH.
* Doc gate: inspection_paper_verified OR sticker_verified (one suffices) + registration + BOL.
* PTI: requests carry `pti_checklist`; server derives pti_verified (all required singles + both sides of required pairs; optional corner-lights pair both-or-none). Legacy pti_verified accepted only when no checklist is sent.
* `GET /api/tickets/{id}` (NEW, any authenticated): single ticket for edit-form prefill.
* Flag: `is_urgent` in payload -> ticket.is_urgent_flag; resolved_by reset per flag cycle.
* /api/tickets/flagged: employees see OWN + URGENT only (Mistake Privacy); managers all; urgent sorted first.
* PATCH: employees may also edit urgent-FLAGGED tickets of others (team triage exception).
* Resolve: standard flags creator-only (403 otherwise); urgent by anyone. resolved_by stamped; non-creator fixer of an urgent flag earns TEAMWORK_BONUS (+5) immediately; creator keeps +10 at approval. Feed logs both distinctly ("resolved URGENT flag ... for X (teamwork bonus)"; "approved ... — approval credit to X").

## Revision R9 (2026-07-13) — Weighted Composite Score
* `services/scoring.py` gains `calculate_qc_score(total, flagged, avg_time_mins)`:
  Final = (0.70*A + 0.30*E) * min(1, log10(N+1)/log10(T+1)); A = (N - flagged_tickets)/N*100 clamped >=0 (flagged = DISTINCT tickets ever flagged); E = 100 at avg <= 15 min, -10/min over, clamped >=0, defaults 100 with no submissions; T = 50 (TARGET_VOLUME).
* `GET /api/leaderboard` (any authenticated role): active employees ranked descending; returns rank, id, name, score, volume, accuracy (+ efficiency, avg_time_mins). Ties break by volume then name.

## Revision R10 (2026-07-13)
* Leaderboard includes active QC accounts: volume = verdicts processed (approve + flag audit events), efficiency = avg QC turnaround (submitted_to_qc_at -> verdict), accuracy fixed at 100 (no counter-signal yet); same composite formula and volume multiplier. Entries carry `role`.
* `python -m app.scripts.reset_data`: wipes operational data (tickets, flags, media, audit logs, feed, notes, uploads) while KEEPING users (scores reset to 100), MCs, and trailers.
