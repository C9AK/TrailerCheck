# 02 Database Schema Specification

Implement this relational structure in PostgreSQL. Enforce foreign keys and timestamps strictly.

## 1. Users Table
* `id` (UUID, PK)
* `username` (String, Unique)
* `password_hash` (String)
* `role` (Enum: 'employee', 'qc', 'manager')
* `performance_score` (Integer, default 100)
* `is_active` (Boolean, default True)

## 2. Motor_Carriers Table
* `id` (UUID, PK)
* `name` (String, Unique) - e.g., "Company A"
* `api_endpoint` (String)
* `api_key` (String, encrypted/masked)

## 3. Trailers Table (For the LOT Trailer 7-Day Logic)
* `id` (UUID, PK)
* `trailer_number` (String, Unique)
* `last_pti_date` (DateTime)
* `is_lot_trailer` (Boolean)

## 4. Pickup_Tickets Table
* `id` (UUID, PK)
* `created_by` (UUID, FK -> Users.id)
* `mc_id` (UUID, FK -> Motor_Carriers.id)
* `truck_number` (String)
* `state` (Enum as defined in Architecture)
* **Telematics Data (Auto-filled):**
  * `driver_name` (String)
  * `truck_location` (String)
  * `truck_model` (String)
  * `fuel_percentage` (Float)
* **Checklist Fields:**
  * `registration_verified` (Boolean)
  * `inspection_paper_verified` (Boolean)
  * `bol_present` (Boolean)
  * `weight` (Float, nullable)
  * `trailer_condition` (String: Good, Fair, Damaged)
  * `condition_notes` (Text, nullable)
  * `needs_scale` (Boolean)
  * `scale_ticket_received` (Boolean)
  * `scale_requested_at` (DateTime, nullable) - USED FOR UI TIMERS
* **PTI Verification (NO FILES):**
  * `pti_verified` (Boolean)
* `timestamps` (created_at, updated_at)

## 5. QC_Audit_Flags Table
* `id` (UUID, PK)
* `ticket_id` (UUID, FK -> Pickup_Tickets.id)
* `flagged_by` (UUID, FK -> Users.id)
* `error_category` (Enum: 'Missing_BOL', 'Incorrect_Weight', 'Missed_PTI', etc.)
* `notes` (Text)
* `created_at` (DateTime)
---

## Revision R2 (2026-07-09)

### Pickup_Tickets — added columns
* `is_lot_trailer` (Boolean) and `trailer_id` (UUID, FK -> Trailers.id, nullable) — LOT identity persisted so the 7-day PTI rule is evaluated at the AWAITING_DRIVER -> PENDING_QC transition.
* `sticker_verified` (Boolean) — part of the QC-readiness gate.
* `is_ca_fl_destination` (Boolean) — prominent CA/FL checkbox, plain flag.
* `tires_inspected` (Boolean) — drives the hourly tire-check UI reminder.
* `truck_latitude`, `truck_longitude` (Float, nullable) — full location; `truck_model` now stores "YEAR MAKE MODEL".

### QC_Audit_Flags — added columns
* `severity` (Integer 1-10, nullable) — set only for `Didnt_Text_In_Group`.
* `error_category` enum extended: Missing_Inspection, Missing_Sticker, Missing_Registration, Missed_KPRA_Reminder, PTI_Video_Missing_Light_Test, Didnt_Text_In_Group (legacy values retained).

### Flag_Media (NEW)
* `id` (UUID, PK), `flag_id` (FK -> QC_Audit_Flags), `media_url` (String), `media_type` (Enum: image, video), `uploaded_by` (FK -> Users), `created_at`. QC proof uploads/URLs. The pickup form itself remains upload-free.

### Audit_Logs (NEW)
* `id` (UUID, PK), `ticket_id` (FK), `actor_id` (FK -> Users), `event` (Enum: TICKET_CREATED, TICKET_FLAGGED, TICKET_RESOLVED, TICKET_APPROVED), `created_at` — exact lifecycle timestamps; powers the manager archive and per-employee stats.

## Revision R3 (2026-07-09) — Live_Activity_Feed (NEW)
* `id` (UUID, PK), `ticket_id` (FK), `event` (AuditEvent enum + new TICKET_SENT_TO_QC), `actor_id` (FK -> Users), `created_at`.
* Denormalized immutable snapshots: `actor_username`, `employee_username`, `truck_number`, `mc_name`, `message` (fully rendered at write time). Insert-only — no update/delete endpoints exist, protecting both employees and QC in disputes.

## Revision R6 (2026-07-09) — Shift_Notes (NEW)
* `id` (UUID, PK), `created_by` (FK -> Users), `content` (Text), `truck_number` (String, nullable), `mc_name` (String, nullable), `is_auto_generated` (Boolean), `status` (Enum: DRAFT/PUBLISHED/RESOLVED), `resolved_by` (FK -> Users, nullable), `created_at`/`updated_at`/`resolved_at`.

## Revision R7 (2026-07-11)
* Pickup_Tickets: `tires_inspected` REMOVED; `weight` is now String(100) (free text, e.g. "34,500 lbs (light)").
* Audit_Logs: `ticket_id` now nullable — on ticket deletion, log rows are detached (ticket_id -> NULL), never destroyed. New AuditEvent value: TICKET_DELETED.
* Migration for existing SQLite DBs: `python -m app.scripts.migrate_r7` (in-place, writes dev.db.bak-r7 backup).

## Revision R8 (2026-07-12)
* Pickup_Tickets: + `pti_checklist` (JSON dict item->bool — source of truth; `pti_verified` is DERIVED server-side from it), + `is_urgent_flag` (Boolean, default False), + `resolved_by` (UUID FK -> Users, nullable; who fixed the flag, reset on each new flag).
* Migration: `python -m app.scripts.migrate_r8` (additive).

## Revision R9 (2026-07-13)
* Pickup_Tickets: + `submitted_to_qc_at` (DateTime, nullable) — stamped on the FIRST transition to PENDING_QC (directly at creation or via PATCH promotion); never overwritten. Powers leaderboard Efficiency. Migration: `python -m app.scripts.migrate_r9` (additive, backfills from audit logs).

## Revision R11 (2026-07-13)
* Pickup_Tickets: + `is_unresolvable` (Boolean, default False), + `unresolvable_reason` (Text, nullable) — the exception data is permanent, surviving Force Approve. New AuditEvent: TICKET_UNRESOLVABLE. Migration: `python -m app.scripts.migrate_r10` (adds columns + rebuilds event tables for the new enum value).

## Revision R12 (2026-07-13)
* Pickup_Tickets: + `is_chassis` (Boolean, default False). Chassis PTI items (locks_horizontal, zip_ties_on_locks) are mandatory ONLY when true. Migration: `python -m app.scripts.migrate_r11` (additive).
