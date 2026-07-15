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

## Revision R14 (2026-07-14) - QC employee parity, COI guard, delete/edit fixes, decoupled notes

* **QC role parity:** `qc` is whitelisted on every employee endpoint - create/edit/delete tickets, resolve/unresolvable, carryover, flagged, my-history, and ALL notes endpoints (drafts/create/publish/resolve/edit). Ownership rules now bind every non-manager role: QC may only edit/delete/resolve their OWN tickets (urgent-flag team triage exception unchanged); Mistake Privacy on `GET /api/tickets/flagged` applies to QC creators too.
* **Conflict of interest (STRICT):** a QC user can NEVER approve or flag a ticket they created (`403 Conflict of interest`). Another QC or a manager must audit it. Managers are exempt.
* **Delete fix:** `DELETE /api/tickets/{id}` now detaches live-feed rows as well as audit logs before deleting; QC flags + media cascade. This removes the FK IntegrityError (500 "delete failed") on Postgres.
* **Edit fix:** `PATCH /api/tickets/{id}` accepts `mc_id` (validated against Motor_Carriers, 404 if unknown; null ignored) so an MC picked wrong at creation is correctable. Endpoint continues to use `exclude_unset=True` + explicit `commit()`/`refresh()`.
* **Decoupled notes:** the auto-note compiler is no longer limited to AWAITING_DRIVER. Any of the caller's tickets - in ANY state, including APPROVED - that still has `needs_scale=true` and `scale_ticket_received=false` generates its "Waiting on Scale Ticket" note until the scale arrives. Published notes were already immortal until resolved; this closes the gap where a ticket approved early made its follow-up vanish.
* **Cloud keep-alive:** production start command is `uvicorn app.main:app --host 0.0.0.0 --port $PORT --timeout-keep-alive 120` (render.yaml).

## Revision R15 (2026-07-14) - CRVR rule removed

* Typing "CRVR" in the weight text no longer auto-sets `needs_scale` (reverses the R8 rule). The Needs Scale checkbox is the only trigger for the scale queue; weight stays pure free text.

## Revision R16 (2026-07-14) - QC delete power

* `DELETE /api/tickets/{id}`: QC may now delete ANY pickup, same as a manager (employees remain limited to their own). Editing other users' tickets is still manager-only. Deletions stay on permanent record in the audit log and live feed.

## Revision R17 (2026-07-15) - Draft lifecycle, history edits, new fields

* `POST /api/tickets` accepts `still_sending: true` -> ticket is created as `DRAFT_IN_PROGRESS` regardless of completeness; `submitted_to_qc_at` stays null while parked.
* `PATCH /api/tickets/{id}` accepts `still_sending`: `true` keeps a draft parked; `false` graduates it into the normal lifecycle (AWAITING_DRIVER, or straight to PENDING_QC + SENT_TO_QC event when the readiness gate passes). The flag is consumed by the route, never stored.
* `GET /api/tickets/drafts` (employee/qc/manager): the caller's own `DRAFT_IN_PROGRESS` pickups, oldest first. Drafts are personal.
* `eld_mentioned` and `checklist_sent` on create/update/read.
* **History edits:** the CREATOR of a ticket may now edit it in ANY state including APPROVED (`created_by == current_user.id`); non-creators still need manager rights. Enables My History fix-ups for employees and QC.

## Revision R18 (2026-07-15) - Decoupled PTI + note deletion

* **Master PTI checkbox:** `pti_verified` IS the master "PTI" boolean and is now set DIRECTLY by the dispatcher (no new column - adding a second flag would have created two sources of truth). The granular `pti_checklist` is a video log only: it is stored verbatim and NEVER derives, gates, or un-verifies PTI. `compute_pti_verified` is no longer called by any route; `is_chassis` is informational. All downstream gates (send-to-QC readiness, LOT 7-day window) read `pti_verified` unchanged.
* `DELETE /api/notes/{id}` (employee/qc/manager): hard delete by the note's AUTHOR or a manager, any status (403 otherwise). Resolve remains the normal close path.
* QC notes parity (create/read/edit/publish/resolve) was shipped in R14 and is unchanged.

## Revision R20 (2026-07-15) - Draft deletion + Last PTI Date on QC queue

* `DELETE /api/tickets/{id}` already had no state restriction, so deleting a `DRAFT_IN_PROGRESS` ticket worked without backend changes (same ownership rules: creator, QC, or manager).
* `GET /api/tickets/qc` now attaches `last_pti_date` to every ticket, taking the MOST RECENT of two sources: (1) the trailer's own `last_pti_date` field when the ticket has a trailer (LOT trailers — the same field the 7-day gate reads, and the authoritative "last checked" date even if no ticket has ever verified it), and (2) the `created_at` of the most recent OTHER ticket for the same truck/trailer with the master `pti_verified` checkbox true (matched by `trailer_id` for LOT trailers, else `truck_number`). `TicketOut.last_pti_date` is optional and defaults to null everywhere except this endpoint.
  * Fix (same day): the initial cut only checked source (2), so a LOT trailer with a known last-PTI date but no fully-verified ticket yet always showed "No prior record." Fixed by including source (1).
