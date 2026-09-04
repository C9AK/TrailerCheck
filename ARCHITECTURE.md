# TrailerCheck — Full Platform Documentation

**UGL Trailer Check — Dispatch Trailer Check & Quality Control Platform**

This is the complete, as-built technical reference for the system: every backend
module, every database table, every API route, every frontend page and
component, every store, every business rule, and how the pieces talk to each
other. It is generated from the actual source code (not from the design specs),
so if this document and the code ever disagree, the code is correct — open an
issue/PR to fix the doc.

The original **requirement specs** (the four numbered documents that were the
original source of truth during development, plus their revision addenda) live
in [`docs/`](docs/) and are kept for historical/business-rule context. This
document supersedes them as the *as-built* reference and is organized very
differently: by subsystem, not by spec chapter.

> Companion reading: [`README.md`](README.md) (marketing-style overview with
> screenshots) and [`DEPLOYMENT.md`](DEPLOYMENT.md) (cloud deploy walkthrough).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Domain Model & Core Business Rules](#4-domain-model--core-business-rules)
5. [Database Schema](#5-database-schema)
6. [Backend Architecture](#6-backend-architecture)
7. [Frontend Architecture](#7-frontend-architecture)
8. [End-to-End Interaction Flows](#8-end-to-end-interaction-flows)
9. [Cross-Cutting Concerns](#9-cross-cutting-concerns)
10. [Deployment & Environments](#10-deployment--environments)
11. [Local Development](#11-local-development)
12. [Revision Timeline](#12-revision-timeline)

---

## 1. System Overview

TrailerCheck replaces a shared dispatch spreadsheet with a strict, state-driven
web application for a trucking dispatch/QC operation (UGL). Dispatchers
("employees") log every trailer pickup through a structured form; every ticket
must pass a Quality Control (QC) audit before it's considered complete; a
weighted composite scoring engine gamifies both dispatcher and QC performance;
and managers get a real-time command center (live feed, archive, exports,
stats, user/API-key administration).

Three roles, one Postgres/SQLite database, one FastAPI backend, one Next.js
frontend — no microservices, no message queue, no external state store. The
architecture optimizes for a small, latency-sensitive, safety-critical shift
operation, not for massive scale.

### Core capabilities

- **Strict ticket lifecycle** — a `PickupTicket` moves through a fixed state
  machine (`DRAFT_IN_PROGRESS → AWAITING_DRIVER → PENDING_QC → FLAGGED ⇄
  RESOLVED → APPROVED`), enforced server-side.
- **Live telematics** — the backend calls the Samsara Fleet API (or a mocked
  fallback) per Motor Carrier to auto-fill driver name, truck model, GPS
  location, and fuel %.
- **QC auditing with intentional friction** — a QC user must tick 3
  confirmation checkboxes before an approval fires; flags carry structured
  error categories, optional media proof, and a severity gauge.
- **Weighted composite scoring** — a logarithmic-volume-multiplied blend of
  accuracy and speed drives a public leaderboard and per-user performance
  score.
- **Automated shift handover notes** — auto-compiled from each user's open
  carryover gaps, published to a shared team inbox.
- **Persistent trailer identity & papers** — trailers are first-class records;
  inspection/registration papers upload once and are re-used on every future
  pickup of that trailer, regardless of which truck pulls it.
- **Real-time hazmat movement watch** — a background task polls Samsara GPS
  for any ticket flagged hazmat and broadcasts a global, unmissable alert the
  instant the truck starts moving (UGL does not haul hazmat).
- **Manager command center** — live activity feed (5s poll), full ticket
  archive with filters, multi-sheet Excel export (one sheet per day),
  per-employee daily/monthly/all-time stats, user & Motor-Carrier
  administration.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | **FastAPI** (Python), Uvicorn ASGI server |
| ORM / DB toolkit | **SQLAlchemy 2.0** (`Mapped[...]` declarative style) |
| Database | **PostgreSQL** in production; **SQLite** for local/LAN dev (auto-created file `dev.db`) |
| Auth | **JWT** (python-jose, HS256), bcrypt password hashing |
| HTTP client (outbound) | **httpx** (async) — Samsara / generic fleet APIs |
| Excel export | **openpyxl** |
| Frontend framework | **Next.js 15** (App Router), **React 19** |
| Styling | **Tailwind CSS v4** (`@theme` tokens, dark mode via `dark:` classes) |
| Client state | **Zustand 5** (with `persist` middleware for two stores) |
| Icons | **lucide-react** |
| Language | TypeScript throughout the frontend; Python 3.12 on the backend |
| Real-time transport | **Server-Sent Events** (`EventSource`) for hazmat alerts; plain polling (`setInterval`) for everything else |
| Hosting (prod) | **Vercel** (frontend) + **Render** (FastAPI + managed Postgres) |
| Hosting (LAN/dev) | `run.bat` → local Uvicorn + `next start`, auto-detected LAN IP, Windows Firewall rules |

No message broker, no cache layer, no ORM migrations tool in active use
(Alembic is a dependency but the project uses **hand-written idempotent
in-place migrations** executed at FastAPI startup instead — see
[§6.1](#61-application-startup--lifespan)).

---

## 3. Repository Layout

```text
TrailerCheck/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, CORS, startup migrations, router mounting
│   │   ├── core/
│   │   │   ├── config.py           # Settings (env vars) via pydantic-settings
│   │   │   ├── database.py         # SQLAlchemy engine/session/Base
│   │   │   └── security.py         # bcrypt hashing, JWT encode/decode
│   │   ├── api/
│   │   │   ├── deps.py             # get_current_user, require_roles()
│   │   │   └── routes/             # one router module per resource (13 files)
│   │   ├── models/                 # SQLAlchemy ORM models (1 file per table) + enums.py
│   │   ├── schemas/                # Pydantic request/response models
│   │   ├── services/               # business logic: scoring, telemetry, pti, ticket_lifecycle, activity, alerts, hazmat_monitor
│   │   └── scripts/                # seed.py, reset_data.py, one-off migrate_rN.py scripts
│   ├── media/                      # QC flag-proof uploads (gitignored; ephemeral on Render free tier)
│   ├── requirements.txt
│   ├── .env.example
│   └── mc_tokens.example.json      # shape for the (gitignored) Samsara token file used by seed.py
├── frontend/
│   ├── app/
│   │   ├── layout.tsx              # root HTML shell, fonts, metadata
│   │   ├── page.tsx                # "/" — redirects to role's home route or /login
│   │   ├── login/page.tsx
│   │   └── dashboard/
│   │       ├── layout.tsx          # sidebar nav, global toasts, SSE hazmat banner, polling loops
│   │       ├── new-pickup/page.tsx         # the pickup intake form (largest page, ~1900 lines)
│   │       ├── carryover/page.tsx          # scale-chase + flagged "Action Required" board
│   │       ├── all-pickups/page.tsx        # global read-only spreadsheet
│   │       ├── my-pickups/page.tsx         # personal history
│   │       ├── notes/page.tsx              # shift handover notes
│   │       ├── trailer-issues/page.tsx     # non-punitive trailer problem board
│   │       ├── leaderboard/page.tsx        # composite score rankings
│   │       ├── qc-review/page.tsx          # QC audit queue (largest logic surface, ~1280 lines)
│   │       ├── qc-history/page.tsx         # "My Audits" — a QC's own approve/flag history
│   │       ├── admin/page.tsx              # user + Motor Carrier administration (manager/admin)
│   │       └── manager/
│   │           ├── live-feed/page.tsx      # 5s-polling immutable activity feed
│   │           ├── archive/page.tsx        # full ticket history + Excel export
│   │           └── stats/page.tsx          # per-employee completed-pickup counts
│   ├── components/                 # ui.tsx (shared primitives), GuardedLink, RequireRole, UnsavedChangesModal, qc/ConfirmationModal
│   ├── hooks/useTicketTimer.ts     # carryover waiting-timer logic
│   ├── lib/                        # api.ts (fetch client), types.ts, time.ts, pti.ts
│   ├── store/                      # authStore, formGuardStore, timeStore (Zustand)
│   └── public/logo.png
├── docs/                           # original design-spec documents (historical source of truth for business rules)
│   ├── 01-System-Architecture.md
│   ├── 02-Database-Schema.md
│   ├── 03-Backend-API-Spec.md
│   └── 04-Frontend-UI-UX-Spec.md
├── scripts/run-all.ps1             # what run.bat invokes — full bootstrap + launch
├── run.bat                         # one-command Windows entry point
├── render.yaml                     # Render Blueprint (backend + Postgres)
└── DEPLOYMENT.md
```

---

## 4. Domain Model & Core Business Rules

### 4.1 Roles (RBAC)

Four roles, stored on `User.role`:

| Role | Can do |
|---|---|
| `employee` | Create/edit/delete their own tickets, work the Carryover board, publish shift notes, view Leaderboard/All Pickups/My Pickups/Trailer Issues. Cannot approve/flag tickets or see the QC queue. |
| `qc` | Everything an employee can do (QC creates pickups too, R14) **plus** the QC Review queue, approve/flag actions, "My Audits" history, non-punitive Trailer Issue reports, and delete-any-pickup power. A QC user can never approve/flag a ticket **they created themselves** (409 "Conflict of interest" — enforced server-side, not just hidden in the UI). |
| `manager` | Full access: everything above, on **any** user's tickets in any state (including `APPROVED`), plus Admin (user + Motor Carrier CRUD), Live Feed, Archive, Stats. Cannot demote/deactivate/delete their own account (self-lockout guard). |
| `admin` (R52) | Carries **every** manager capability (see [§6.4](#64-dependency-injection--rbac)) but sits above it: a manager can never edit, deactivate, delete, or change the password of an admin account — only the admin account's own owner can. See [§4.12](#412-the-admin-role--account-security-protections-r52). |

Route-level enforcement is `require_roles(...)` (a FastAPI dependency,
[§6.4](#64-dependency-injection--rbac)); the frontend additionally wraps every
page in `<RequireRole roles={[...]}>` for client-side redirect-on-mismatch —
**the backend is the actual authority**, the frontend guard is UX only.

### 4.2 The Ticket Lifecycle State Machine

`PickupTicket.state` is an enum (`TicketState`) with exactly these values:

```
DRAFT_IN_PROGRESS ──(submit)──► AWAITING_DRIVER ──(readiness gate passes)──► PENDING_QC
                                       ▲                                         │
                                       │                                    approve/flag
                          (PATCH updates fields in place)                       │
                                       │                                        ▼
                                                                          FLAGGED ⇄ RESOLVED
                                                                                │
                                                                          (QC approves)
                                                                                ▼
                                                                            APPROVED  (terminal)
```

- **`DRAFT_IN_PROGRESS`** ("Still Sending", R17) — a deliberately parked
  pickup; excluded from Carryover, the QC queue, and shift-note compilation
  until the dispatcher explicitly submits it. Lets a dispatcher juggle several
  concurrent pickups.
- **`AWAITING_DRIVER`** — saved but not yet complete enough for QC (missing a
  checklist field, or waiting on a scale ticket).
- **`PENDING_QC`** — every readiness-gate field is satisfied; visible in the
  QC queue.
- **`FLAGGED`** — QC rejected it; bounces to the creator's (or, if urgent,
  *any* employee's) Carryover "Action Required" section.
- **`RESOLVED`** — the employee explicitly resent a fixed `FLAGGED` ticket;
  back in the QC queue for re-verification.
- **`APPROVED`** — QC passed it. Terminal for the *lifecycle*, but **not**
  necessarily off every board: a ticket needing a scale ticket stays on
  Carryover even after approval until the scale box is checked (R23's
  "scale-chase" redefinition of Carryover — see [§4.6](#46-the-carryover--scale-chase-board)).

Two flags ride alongside `state` and can end a ticket's *active* life without
being a state themselves:

- **`is_dropped`** (R23) — "the truck dropped its trailer, nothing left to
  process." Any role can set it (`POST /api/tickets/{id}/dropped`). It
  freezes the ticket's last state and removes it from every active
  board/queue; it lives on only in historical views (My Pickups → All,
  Archive, All Pickups → Full Sheet).
- **`is_unresolvable`** (R11 escape hatch) — an employee marks a `FLAGGED`
  ticket they *cannot* physically fix, with a mandatory ≥10-character written
  reason. This routes the ticket straight back to `PENDING_QC` as an
  "Exception Review" card; QC can either **Force Approve** it (closes the
  lifecycle with the exception permanently on record) or flag it again
  (clears `is_unresolvable`, restarts the normal fix loop).

**State transitions are never client-driven.** The frontend PATCHes raw field
values; `is_ready_for_qc()` (`services/ticket_lifecycle.py`) is re-evaluated
server-side on every `PATCH /api/tickets/{id}` and promotes
`DRAFT`/`AWAITING_DRIVER` → `PENDING_QC` automatically the moment the gate
passes — this is what makes Carryover's inline checkboxes feel instant with
"no modals."

### 4.3 PTI (Pre-Trip Inspection) Verification

Two independent things share the "PTI" name and must not be confused:

1. **`pti_verified`** (the *master* boolean, R18) — set **directly** by the
   dispatcher via one prominent checkbox on the New Pickup form. This alone
   determines whether PTI is "done." It is the only thing the QC-readiness
   gate and the LOT 7-day rule read.
2. **`pti_checklist`** (a `dict[str, bool]`, R8) — a granular video-log of
   ~20 individual items (DOT tape, tires, lights in Left/Right pairs, ABS
   light, chassis locks/zip-ties, etc. — see `services/pti.py` /
   `lib/pti.ts` for the exact item list). This is **informational only**
   since R18: it never derives, gates, or un-verifies `pti_verified`. QC sees
   it as a read-only collapsible "PTI video log" for context, never as a
   flag trigger by itself.

A ticket is "PTI-gate-passed" (`_pti_gate_passed()`) when EITHER:
- `pti_verified` is `True`, **or**
- it's a LOT trailer whose linked `Trailer.last_pti_date` is **< 7 days old**.

Checking the master PTI box on a LOT trailer's pickup **stamps
`Trailer.last_pti_date = now()`** (R50) — a fresh PTI check resets that
trailer's 7-day clock for its *next* pickup, on both ticket creation and edit
(only on the `false → true` transition, never on a resave).

If PTI isn't verified yet, the form surfaces an **informational-only**
follow-up log — "Driver called" / "Informed dispatcher" (R34) — that never
gates anything, just records that dispatch is chasing it.

### 4.4 LOT Trailers, Trailer Identity & Persistent Papers

`Trailer` is a first-class entity, not just a field on the ticket.

- **LOT trailer** = a trailer kept on UGL's own lot rather than arriving with
  a specific load; toggled on the New Pickup form. LOT tickets *require* a
  `trailer_number` (400 otherwise).
- **Since R25, every pickup (LOT or not) that has a trailer number links to a
  `Trailer` row** — this is what makes inspection/registration papers
  persist across pickups regardless of which truck pulls the trailer next.
  An unknown trailer number is silently registered on the fly
  (`resolve_trailer_by_number`).
- Editing an *already-linked* ticket's trailer number **renames the existing
  `Trailer` row in place** (R39) rather than creating a new one and orphaning
  the old row's saved documents — unless the corrected number collides with a
  *different* already-known trailer, in which case the ticket re-links to
  that trailer's own identity/papers.
- **`TrailerDocument`** rows (Inspection / Registration) are keyed to the
  trailer, one *current* document per type (a new upload replaces the old
  row). Since **R42**, uploaded file bytes are stored **in the database row
  itself** (`LargeBinary`), not on local disk — Render's free-tier
  filesystem is wiped on every dyno sleep/restart, which was silently
  orphaning every uploaded paper. A pasted external URL is unaffected (no
  bytes stored either way, `media_url` points off-site).
- **"Who had this trailer last?"** (R43) and **"Still using trailer XXXX?"**
  (R46) are proactive lookups: typing a trailer number surfaces the last
  truck that used it; typing a *truck* number with no trailer entered yet
  surfaces that truck's most recent pickup (trailer identity, PTI date,
  saved papers, what was verified) as a one-click "yes, same trailer"
  confirmation.

### 4.5 Scoring Engine — Weighted Composite Score

Two things exist and must not be confused:

1. **`User.performance_score`** — a simple running integer (starts at 100,
   floored at 0), adjusted by discrete events:
   - `+10` on ticket approval (`apply_approval_bonus`, credited to the
     ticket's **creator**, not the approver).
   - `+5` "teamwork bonus" (`apply_teamwork_bonus`) to whoever **resolves an
     urgent flag they didn't create** — shared-credit for team triage.
   - A penalty per flagged error category (`apply_flag_penalty`,
     `FLAG_PENALTIES` dict — e.g. `Missed_PTI`: 20, `Missing_BOL`: 15,
     `Other`: 5). `Didnt_Text_In_Group` uses the QC's own 1–10 severity
     slider as the penalty instead of a fixed value.
   - This score is what the `ScoreBadge` in the dashboard header shows.

2. **The Leaderboard composite score** (`GET /api/leaderboard`,
   `services/scoring.calculate_qc_score`) — a *separate*, formula-derived
   score recomputed live from history, covering **both** employees and QC:

   ```
   Final = (0.70 × Accuracy + 0.30 × Efficiency) × min(1, log10(N+1) / log10(51))

   Employees:
     Accuracy   = (total tickets created − tickets ever flagged) / total × 100
     Efficiency = 100, minus 10 per minute the avg (created_at → submitted_to_qc_at)
                  exceeds 15 minutes
     N          = tickets created

   QC:
     Accuracy   = fixed at 100 (no counter-signal exists yet to penalize a QC user)
     Efficiency = 100, minus 10 per minute the avg (submitted_to_qc_at → verdict)
                  exceeds 15 minutes
     N          = tickets processed (approve + flag actions)
   ```

   The `log10(N+1)/log10(51)` **volume multiplier** solves the "one perfect
   ticket" problem: a single flawless pickup scores ≈17.6, not 100 — full
   weight is reached only at the target volume (50 tickets). Ranking sorts
   by score, then volume, then name.

### 4.6 The Carryover / "Scale Chase" Board

Renamed in meaning (not in code) by **R23**: `GET /api/tickets/carryover`
returns every ticket — **in any state including `APPROVED`** — that has
`needs_scale=true` and `scale_ticket_received=false`, excluding
`DRAFT_IN_PROGRESS` and `FLAGGED` (which get their own "Action Required"
section on the same page, sourced from `/api/tickets/flagged`). A row leaves
the board the instant its scale checkbox is checked, whatever lifecycle state
it's in — **QC approval does not end the scale chase.**

Timer UI (`hooks/useTicketTimer.ts`):
- The visible "waiting" clock starts at `scale_requested_at`, but a
  **"Followed up"** action (R21, `PATCH /api/tickets/{id}/follow-up`) can
  restart it from `last_followed_up_at` if that's newer — the *original*
  request time stays on permanent record either way.
- **< 120 min**: normal row.
- **≥ 120 min**: amber row + pulsing `AlertCircle` icon ("warning" tier).
- **≥ 240 min**: red row, pulsing red dot, sorted to the **absolute top** of
  the table ("critical" tier).

### 4.7 Shift Definitions (Central Time)

All operational bucketing is Central Time regardless of the viewer's device
(dispatch runs on CST); a separate *display* preference (CST vs. device-local,
R24) only changes how timestamps are *printed*, never how shifts/days are
computed for filtering.

| Shift | Central Time window |
|---|---|
| First | 1:00 AM – 9:00 AM |
| Main | 9:00 AM – 5:00 PM |
| Third | 5:00 PM – 1:00 AM (spans midnight) |

A timestamp between 12:00 AM–1:00 AM belongs to the **previous calendar day's**
Third shift (`shiftOf()` in `lib/time.ts`).

### 4.8 Mistake Privacy, Urgent Flags & Conflict of Interest

- **Mistake Privacy** (R8): a standard `FLAGGED` ticket is visible/fixable
  only by its **creator** (plus QC/managers) — nobody else on the team sees
  another employee's mistake by default.
- **Urgent flags** (`is_urgent`, set by QC at flag time) bypass Mistake
  Privacy entirely: the ticket appears in **every** employee's "Action
  Required" section with a pulsing "Urgent — anyone can fix" badge, and
  whoever resolves it (if not the original creator) earns the +5 teamwork
  bonus.
- **Conflict of interest** (R14, strict): a `qc`-role user can **never**
  approve or flag a ticket they personally created — 403 from
  `POST /api/tickets/{id}/approve|flag`, enforced identically regardless of
  what the UI shows. Only another QC user or a manager can audit it. Managers
  are exempt from this rule entirely.

### 4.9 Trailer Issues — Non-Punitive Problem Tracking (R44)

When QC finds a genuine physical problem with the trailer (damage, mechanical
fault) that is **not the employee's fault**, flagging them would misattribute
blame and could block an otherwise-fine approval. `POST
/api/tickets/{id}/trailer-issue` records a free-text `TrailerIssue` row
instead — no error category, **zero score impact**, doesn't block approval,
available even on a QC's own conflict-of-interest pickup (it isn't an audit
verdict). It's broadcast to the whole team (`GET /api/trailer-issues`) and
nags with a toast every ~2 hours until any user marks it resolved.

### 4.10 Manager PTI Date Overrides & Cross-Fleet Trailer Lookup (R51)

A trailer that's new to the truck on a given ticket is not necessarily new
to the **fleet** — another truck may have hauled it recently with a fully
verified PTI already on record. Before R51, the QC Review card showed
`last_pti_date` purely as a read-only historical hint
([§4.3](#43-pti-pre-trip-inspection-verification)); there was no way to correct it
in place, which risked a false "missing/stale PTI" flag on a trailer that
was, in reality, current — the reviewer just had no visibility into its
history under a *different* truck.

Two additions, both on the QC Review card:

- **Trailer Lookup** (`components/qc/TrailerHistoryLookup.tsx`) — a small
  popover next to the Trailer # field. Any role can query a trailer number
  (defaulting to whatever's currently linked, but freely editable — useful
  for checking a *different* trailer before correcting a typo) against the
  existing `GET /api/trailers/{number}` and `GET
  /api/trailers/{number}/last-used` lookups, surfacing its registered Last
  PTI Date and the truck that hauled it most recently. **Only a manager**
  can press "Apply to Ticket" — everyone else sees the same read-only
  result with the button disabled.
- **Manager-editable Last PTI Date** — for `role === "manager"` only, the
  card's Last PTI Date becomes an inline `<input type="date">` (a small
  "mgr" badge marks it as an override control) instead of the plain
  `Detail` display every other role still sees. Saving calls
  `PATCH /api/tickets/{id}/pti-date-override`.

That endpoint writes to **`Trailer.last_pti_date`** (the same field the LOT
7-day gate and every other historical lookup on this trailer reads), not a
ticket-local field — the correction is visible everywhere the trailer shows
up next, not just on this one ticket. It validates the new date isn't more
than a day in the future (a PTI inspection can't happen tomorrow), re-runs
the same `AWAITING_DRIVER → PENDING_QC` auto-promotion `PATCH
/api/tickets/{id}` already performs (so a stale PTI date genuinely was the
only thing blocking QC eligibility, fixing it can complete the readiness
gate immediately), and records a `TICKET_PTI_DATE_OVERRIDDEN` audit-log +
live-feed row with the actor and the exact old→new date change — the same
"immutable, human-readable, queryable-by-a-manager-in-the-Live-Feed" audit
trail every other lifecycle action already gets, deliberately not a new,
separate audit mechanism.

A third, read-only field — **"Last Hauled By"** — is attached to every
ticket returned by `GET /api/tickets/qc` (`last_hauled_truck_number` /
`last_hauled_truck_date`, `services.ticket_lifecycle.get_last_hauled_truck`)
so the cross-fleet history is visible **without** even opening the lookup
popover: it's the most recent *other* ticket for the same `trailer_id`,
matched exactly like [§4.3](#43-pti-pre-trip-inspection-verification)'s
`last_pti_date` and [§4.9](#49-trailer-issues--non-punitive-problem-tracking-r44)'s
sibling `last_qc_approved_date` — trailer-identity-scoped, not
truck-scoped, since this is about the trailer's own haul history.
`get_last_hauled_truck_for_trailer` is a shared helper: it also backs the
pre-existing `GET /api/trailers/{number}/last-used` route (R43, used on the
New Pickup form) so the "most recent other pickup for this trailer" query
can't drift between the two call sites.

### 4.11 Hazmat Movement Watch (R25)

UGL does not haul hazmat. Toggling **Hazmat load** on a pickup arms a
continuous background watch (`services/hazmat_monitor.py`) for as long as the
ticket stays "active" (not dropped; if approved, only while its scale chase is
still open). The watch polls the Motor Carrier's Samsara GPS speed for every
watched truck (batched into one `/fleet/vehicles/stats` call per MC) with **no
fixed poll interval** — the loop re-runs back-to-back, paced only by the
network round-trip itself, so movement is caught within one round-trip. The
instant a watched truck exceeds 5 mph, every logged-in user gets a full-width,
un-dismissable-until-acknowledged red banner over SSE
(`GET /api/alerts/stream`); re-alerts are throttled to once per 5 minutes per
continuously-moving truck, and the alert re-arms the moment the truck stops.

### 4.12 The Admin Role & Account-Security Protections (R52)

`admin` is a fourth role sitting **above** `manager`. It exists for exactly
one purpose: give the platform's actual owner an account that cannot be
tampered with by anyone who merely has manager access — including having
its role, active status, or password changed.

**Privilege direction.** Admin is a strict superset of manager
capability-wise (`api.deps.require_roles()` treats any check written for
`UserRole.manager` as satisfied by `UserRole.admin` too, so none of the
~30 existing manager-gated routes needed to be individually rewritten; the
handful of inline `current_user.role == ...` comparisons that don't go
through `require_roles` instead read a shared `MANAGER_ROLES = (manager,
admin)` tuple from `models/enums.py`). The frontend mirrors this with
`isManagerLike(role)` / `roleAllows(allowedRoles, role)` helpers
(`lib/types.ts`) used by `RequireRole`, the sidebar nav filter, and every
page-level `role === "manager"` check.

**Protection direction runs the opposite way** and is enforced entirely in
`api/routes/admin.py`, inline (not through the generic role-dependency
system, since it depends on *which account* is being acted on, not just who's
asking):

- `PATCH /api/admin/users/{id}` and `DELETE /api/admin/users/{id}` both 403
  immediately if the **target** user has `role == admin` and the caller
  isn't that exact same account — a manager (or a hypothetical second
  admin) cannot edit or delete an admin account at all, full stop. This is
  the literal mechanism behind "no one can change my password": the
  password field is just one of several fields this blanket check refuses
  to touch on someone else's behalf.
- `DELETE` additionally refuses to delete **any** admin account even by its
  own owner — there is no path to hard-deleting the account at all.
- `POST /api/admin/users` (create) and `PATCH .../{id}` (promote) both 403
  a `role: "admin"` payload unless the caller is *already* an admin —
  otherwise a manager could simply create or promote their way around the
  entire protection model.
- The self-lockout guard (originally manager-only: "you can't demote or
  deactivate yourself") was generalized to `payload.role != user.role` for
  *any* role editing themselves, so it applies identically to admin without
  a special case.
- On the frontend, `admin/page.tsx`'s role-assignment dropdown only offers
  `admin` as an option when the viewer is themselves an admin, and an
  admin-role row's Edit/Delete icons are replaced with a
  "🔒 Protected" label for any non-admin viewer — pure UX (the backend
  enforces the real rule regardless), so a manager isn't shown a control
  that would just 403.

**Bootstrapping.** A fresh database's very first user
(`_bootstrap_admin()` in `main.py`, named `BOOTSTRAP_ADMIN_USERNAME` —
"laith" by default) is now created with `role=admin` directly, not
`manager`. An **idempotent migration** (`_migrate_r52`) handles the
already-existing case: on every boot, if a user named exactly
`BOOTSTRAP_ADMIN_USERNAME` still has `role=manager`, it's promoted to
`admin` once; harmless no-op on every later boot.

**Backup/recovery passwords.** An admin account may additionally
authenticate with up to two operator-configured recovery passwords
(`ADMIN_BACKUP_PASSWORD_1`/`_2`, [§6.2](#62-configuration)), checked in
`api/routes/auth.py`'s `login()` via `secrets.compare_digest` (constant-time,
avoids leaking timing information) only when the primary bcrypt check fails
and only for `role == admin`. This is a deliberate, narrow safety net so the
real owner can never be locked out — of the primary password being lost,
forgotten, or (despite the protections above) somehow changed. **These two
values are never committed to source control** — they exist only as
environment variables (`backend/.env`, gitignored, or the hosting
platform's own env var UI), sourced from `pydantic-settings` with a
`None` default in the tracked `config.py`. Leaving both unset simply
disables backup-password login.

**Password-change audit trail.** Every time `PATCH /api/admin/users/{id}`
changes a password on an account that **isn't the caller's own**, a
`PasswordChangeAudit` row is written ([§5](#5-database-schema)) recording
who changed whose password and when. `GET /api/admin/password-changes` (a
second, *stricter* role dependency pinned to literally `UserRole.admin` —
manager is not enough here, unlike the rest of the router) exposes this as
the admin's personal, persistent security feed; the dashboard layout
additionally polls it (15s, admin-only) and toasts a red "Security alert"
the moment a new entry appears, mirroring the existing flag/resolved-ticket
notification pattern. Deliberately **not** folded into the ticket-shaped
`audit_logs`/`live_activity_feed` pipeline ([§6.5](#65-services-business-logic-layer))
— this concerns account security, not a ticket lifecycle event, and forcing
it through a schema built for trucks/MCs/tickets would be a worse fit than
a small dedicated table, the same reasoning behind `TrailerIssue` and
`ShiftNote` existing as their own tables rather than overloaded QC flags.

---

## 5. Database Schema

All tables use a UUID primary key (`uuid.uuid4()`, native `UUID` on Postgres,
`CHAR(32)` hex on SQLite). Enums are native Postgres enum types where
supported; SQLite stores them as plain `VARCHAR` (unconstrained — this is why
the `ticket_state`/`audit_event` in-place migrations only need `ALTER TYPE
... ADD VALUE` on Postgres and are no-ops on SQLite).

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| username | String, unique, indexed | |
| password_hash | String | bcrypt |
| role | Enum `user_role` | employee / qc / manager / admin (R52) |
| performance_score | Integer, default 100 | see [§4.5](#45-scoring-engine--weighted-composite-score) |
| is_active | Boolean, default true | deactivated users can't log in |

### `motor_carriers`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | String, unique | |
| api_endpoint | String | e.g. `https://api.samsara.com` |
| api_key | String | plaintext in the DB column; **never returned unmasked** to the frontend — `mask_api_key()` shows only the last 4 chars |

### `trailers`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trailer_number | String, unique, indexed | |
| last_pti_date | DateTime(tz) | drives the 7-day LOT gate |
| is_lot_trailer | Boolean | |
| documents (relationship) | → `trailer_documents`, cascade delete-orphan | |

### `trailer_documents` (R25, content bytes added R42)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| trailer_id | FK → trailers, indexed | unique together with doc_type |
| doc_type | Enum `trailer_doc_type` | `inspection` \| `registration` |
| media_url | String | `/api/trailers/documents/{id}/file` for DB-stored files, or an external URL for pasted links |
| content | LargeBinary, nullable | the actual file bytes (R42) |
| content_type | String, nullable | MIME type |
| uploaded_by | FK → users | |
| created_at / updated_at | DateTime(tz) | |

### `pickup_tickets` (the central table)
~45 columns; grouped by concern:

**Identity & ownership**
`id`, `pickup_number` (R27 — permanent sequential "#N" assigned at creation,
`max+1` inside the transaction), `created_by` (FK users), `mc_id` (FK
motor_carriers), `truck_number`, `is_lot_trailer`, `trailer_id` (FK trailers,
nullable), `state` (Enum `ticket_state`).

**Telematics snapshot** (auto-filled once at creation from the MC's fleet
API, always manually overridable)
`driver_name`, `truck_location`, `truck_latitude`, `truck_longitude`,
`truck_model` ("YEAR MAKE MODEL"), `fuel_percentage`.

**Checklist / readiness gate fields**
`registration_verified`, `inspection_paper_verified`, `sticker_verified`,
`kpra_group` (String, validated against `KpraGroup` enum at the API layer —
see below), `bol_present`, `eld_mentioned`, `checklist_sent` (both R17,
informational only), `weight` (free-text String — scale tickets sometimes
carry annotations, not just numbers), `trailer_condition` (Enum
`trailer_condition`: Good/Fair/Damaged), `condition_notes`, `needs_scale`,
`scale_ticket_received`, `scale_requested_at` (nullable — drives the
Carryover timer), `last_followed_up_at` (R21), `submitted_to_qc_at` (R9 —
first PENDING_QC transition, powers the leaderboard efficiency calc).

**PTI**
`pti_checklist` (JSON dict, R8 — video log, informational since R18),
`pti_verified` (the master boolean), `is_chassis` (R12 — shows/requires the
chassis rows), `pti_driver_called`, `pti_dispatcher_informed` (R34,
informational).

**Triage / lifecycle flags**
`is_urgent_flag`, `resolved_by` (FK users, nullable), `is_dropped` (R23),
`is_hazmat` (R25), `auto_note_generated` (R22 — one-shot flag so the
auto-shift-note is never regenerated after a user edits/deletes it),
`is_unresolvable`, `unresolvable_reason` (R11).

**Timestamps**
`created_at`, `updated_at` (server-side `func.now()` / `onupdate`).

`kpra_group` (R35) replaced an earlier single boolean
`is_ca_fl_destination` — the old column was dropped (R37, after a
production-breaking bug where it kept its `NOT NULL` constraint after the ORM
stopped populating it; see [§12](#12-revision-timeline)). Three values today:
`CA_FL_40FT`, `GROUP_41FT`, `GROUP_43FT` — the three real
Kingpin-to-Rear-Axle distance-to-center legal limits by destination state
group (see `KPRA_GROUP_LABELS`).

### `qc_audit_flags`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| ticket_id | FK pickup_tickets, indexed | |
| flagged_by | FK users, indexed | |
| error_category | Enum `error_category` | see below |
| severity | Integer, nullable | 1–10, set **only** for `Didnt_Text_In_Group` |
| notes | Text, nullable | required for `Other` |
| created_at | DateTime(tz) | |
| media (relationship) | → `flag_media`, cascade delete-orphan | |

`ErrorCategory` values: `Missing_BOL`, `Incorrect_Weight`, `Missed_PTI`
(legacy, kept so old rows stay valid) plus the current strict set:
`Missing_Inspection`, `Missing_Sticker`, `Missing_Registration`,
`Missed_KPRA_Reminder`, `PTI_Video_Missing_Light_Test`,
`Didnt_Text_In_Group`, `Other`. **One flag action can cite several
categories** — one `QCAuditFlag` row (and one score penalty) is written per
category (`POST /api/tickets/{id}/flag` accepts `error_categories: [...]`).

### `flag_media`
QC's proof attachments on a flag action — `flag_id` (FK), `media_url`,
`media_type` (Enum `image`\|`video`), `uploaded_by`, `created_at`. Uploaded
files (via `POST /api/uploads`) are written to `backend/media/` and served at
`/media/*` (a `StaticFiles` mount) — **note this is disk-based and therefore
ephemeral on Render's free tier**, unlike trailer documents (R42 moved those
into the DB specifically to survive redeploys; flag-proof media was left as
disk files since it's evidentiary, not operational, and the flag record
itself survives regardless).

### `audit_logs`
Normalized, exact-timestamp lifecycle events — powers the manager archive,
stats, and the leaderboard's timing calculations. `ticket_id` is **nullable**
(R14): when a ticket is deleted, its logs are **detached** (`ticket_id →
NULL`), never destroyed, so the deletion event itself stays on permanent
record. `AuditEvent` values: `TICKET_CREATED`, `TICKET_SENT_TO_QC`,
`TICKET_FLAGGED`, `TICKET_RESOLVED`, `TICKET_APPROVED`, `TICKET_DELETED`,
`TICKET_UNRESOLVABLE`, `TICKET_DROPPED` (R23),
`TICKET_PTI_DATE_OVERRIDDEN` (R51 — a manager's correction to the linked
trailer's Last PTI Date; the old→new value rides in the rendered
`live_activity_feed.message`, not a new structured column, matching every
other event's "snapshot everything human-readable at write time" approach).

### `live_activity_feed`
Denormalized, **immutable**, insert-only mirror of `audit_logs` for the
manager Live Feed page — snapshots `actor_username`, `employee_username`,
`truck_number`, `mc_name`, and a fully-rendered human message **at write
time** (`services/activity._render_message`), so the record reads correctly
forever even if the underlying ticket/users later change or are deleted. No
update/delete endpoint exists for this table at all. `ticket_id` is nullable
for the same detach-on-delete reason as `audit_logs`.

### `shift_notes`
`created_by` (FK), `content` (Text), `ticket_id` (FK, nullable, R45 — jumps
the "Edit Pickup" button straight to the source ticket, detached not
cascaded on deletion), `truck_number`, `mc_name`, `is_auto_generated`,
`status` (Enum `note_status`: `DRAFT`/`PUBLISHED`/`RESOLVED`), `resolved_by`,
timestamps. See [§6.6](#notespy--shift-handover-notes) for the full
auto-compilation logic.

### `trailer_issues` (R44)
`ticket_id` (FK, nullable, detached on ticket delete), `trailer_id` (FK,
nullable), snapshotted `truck_number`/`trailer_number`/`mc_name` (readable
even after the ticket is gone), `description` (Text), `reported_by` (FK),
`is_resolved`, `resolved_by`, `resolved_at`, `created_at`.

### `password_change_audits` (R52)
`target_user_id` / `changed_by` (both real FKs → users, **not** nullable/
detached like the ticket-history tables — `DELETE /api/admin/users/{id}`
already refuses to hard-delete any user this table references, so there's
nothing to detach from). Snapshotted `target_username` /
`changed_by_username` so the record reads correctly even after a rename.
Written only when `PATCH /api/admin/users/{id}` changes a password on an
account other than the caller's own; see
[§4.12](#412-the-admin-role--account-security-protections-r52).

### Entity-relationship summary

```mermaid
erDiagram
    USERS ||--o{ PICKUP_TICKETS : creates
    USERS ||--o{ QC_AUDIT_FLAGS : raises
    USERS ||--o{ PASSWORD_CHANGE_AUDITS : "changed by / target of"
    MOTOR_CARRIERS ||--o{ PICKUP_TICKETS : "fleet API for"
    TRAILERS ||--o{ PICKUP_TICKETS : "linked by"
    TRAILERS ||--o{ TRAILER_DOCUMENTS : "papers for"
    PICKUP_TICKETS ||--o{ QC_AUDIT_FLAGS : "flagged with"
    QC_AUDIT_FLAGS ||--o{ FLAG_MEDIA : "proof"
    PICKUP_TICKETS |o--o{ AUDIT_LOGS : "lifecycle (detach on delete)"
    PICKUP_TICKETS |o--o{ LIVE_ACTIVITY_FEED : "lifecycle (detach on delete)"
    PICKUP_TICKETS |o--o{ SHIFT_NOTES : "auto-note source (detach)"
    PICKUP_TICKETS |o--o{ TRAILER_ISSUES : "reported against (detach)"
```

---

## 6. Backend Architecture

### 6.1 Application Startup & Lifespan

`app/main.py` builds the FastAPI app with an `asynccontextmanager` lifespan
that, **in this exact order**, on every boot:

1. Runs ~12 idempotent, hand-written **in-place schema migrations**
   (`_migrate_feed_ticket_nullable`, `_migrate_r17` … `_migrate_r52`) — each
   inspects the live schema via `sqlalchemy.inspect` and only executes its
   `ALTER TABLE`/`ALTER TYPE` if the target column/constraint doesn't already
   match, so re-running on an already-migrated database is a safe no-op. This
   is the project's **substitute for Alembic** — Alembic is in
   `requirements.txt` but not actively used; every schema change since the
   initial cut has instead shipped as one of these numbered functions,
   keeping "add a column" a one-file, one-function, self-documenting change
   with its own inline changelog comment.
2. Calls `Base.metadata.create_all(bind=engine)` — creates any table that
   doesn't exist yet (a brand-new database needs **none** of the above
   migrations; `create_all` builds the current schema directly).
3. `_bootstrap_admin()` — if the `users` table is completely empty (a fresh
   cloud deploy), creates one **admin** account (R52 — was manager) from
   `BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_PASSWORD` env vars so the
   Admin page is reachable at all on day one, already protected from every
   manager created afterward.
4. Spawns the hazmat monitor as a background `asyncio.Task`
   (`hazmat_monitor_loop()`), cancelled cleanly on shutdown.

Two migrations are worth calling out as cautionary examples of the pattern's
sharp edges (both are described in their own docstrings in `main.py`):
- **R14** (`_migrate_feed_ticket_nullable`) rebuilds the entire
  `live_activity_feed` table on SQLite (which can't relax a `NOT NULL`
  constraint in place) — rename, drop stale indexes, recreate from the
  current model, copy rows, drop the old table.
- **R37** fixes a **production incident** caused by R35: dropping a column
  from the ORM model without dropping it from the physical table left a
  `NOT NULL` constraint with no default on a column the ORM no longer
  populated, which broke every `INSERT` on Postgres. R37 drops the column
  outright once its data has been safely backfilled elsewhere.

### 6.2 Configuration

`app/core/config.py` — a `pydantic-settings` `Settings` class reads
`backend/.env` (`.env.example` documents the shape) plus environment
variables directly (cloud):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://postgres:postgres@localhost:5432/trailercheck` | Normalized from Render/Heroku/Neon's `postgres://` prefix automatically |
| `JWT_SECRET_KEY` | `"change-me"` | **must** be overridden in production |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` (8 hours) | |
| `FRONTEND_ORIGINS` | `""` | comma-separated extra CORS origins (the Vercel URL) |
| `BOOTSTRAP_ADMIN_USERNAME` | `laith` | first-run **admin** account (R52 — was manager) |
| `BOOTSTRAP_ADMIN_PASSWORD` | `laith123!` | **change this in production** |
| `ADMIN_BACKUP_PASSWORD_1` | `None` | R52 — optional admin-only recovery credential; **set only via env, never in tracked source** |
| `ADMIN_BACKUP_PASSWORD_2` | `None` | R52 — second optional recovery credential, same rule |

`app/core/database.py` builds the SQLAlchemy `engine` with
`pool_pre_ping=True` (transparently replaces a dropped idle connection) and
`pool_recycle=1800` (retires connections before managed-Postgres/LAN-firewall
idle-kill windows).

### 6.3 Security

`app/core/security.py`:
- `hash_password` / `verify_password` — bcrypt via the `bcrypt` package
  directly (not `passlib`).
- `create_access_token(user_id, role)` — a JWT with `sub` (user UUID
  string), `role`, and `exp`, signed HS256.
- `decode_access_token` — raises `JWTError` on invalid/expired tokens.

`app/api/routes/auth.py`'s `login()` additionally accepts, for `role ==
admin` only, one of up to two operator-configured backup passwords
(`_admin_backup_password_ok`, R52) when the primary bcrypt check fails —
see [§4.12](#412-the-admin-role--account-security-protections-r52). Compared
with `secrets.compare_digest`, not `==`, to avoid a timing side-channel.

CORS (`main.py`) allows `localhost:3000` and any `FRONTEND_ORIGINS` value
explicitly, **plus a regex** matching any private-LAN origin
(`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) on any port — this is what lets
`run.bat`'s auto-detected-LAN-IP frontend talk to the backend from any
device on the office Wi-Fi without per-machine CORS configuration.

A global `Exception` handler re-adds CORS headers to unhandled 500s
specifically because an exception thrown *before* `CORSMiddleware` runs
would otherwise reach the browser with no `Access-Control-Allow-Origin`
header — the browser then reports it as an opaque network error, and the
frontend's retry interceptor ([§7.3](#73-the-api-client--retry-interceptor))
would misinterpret a real bug as "the server is asleep, retry."

### 6.4 Dependency Injection & RBAC

`app/api/deps.py` — two dependencies used everywhere:

- **`get_current_user`** — extracts the Bearer token, decodes it, loads the
  `User`, 401s on any failure (missing header, bad/expired token, user
  deleted or deactivated since the token was issued).
- **`require_roles(*roles)`** — returns a dependency that 403s unless
  `current_user.role in roles`. Applied either per-route
  (`Depends(require_roles(UserRole.manager))`) or per-router
  (`APIRouter(dependencies=[...])`, e.g. the entire `admin.py` router is
  manager-only at the router level). **R52:** any tuple containing
  `UserRole.manager` is automatically treated as also containing
  `UserRole.admin` — admin carries every manager capability, so none of the
  routes above needed editing when the admin role was introduced. The
  narrower rule that *protects* admin accounts **from** managers is the
  opposite direction and isn't expressible by this generic gate — it's
  enforced inline, per-route, in `admin.py` instead (see
  [§4.12](#412-the-admin-role--account-security-protections-r52)). A small
  number of inline `current_user.role == ...` checks that don't go through
  `require_roles` (in `tickets.py`, `trailers.py`, `notes.py`) instead read
  a shared `MANAGER_ROLES = (UserRole.manager, UserRole.admin)` tuple from
  `models/enums.py`, so the "admin ⊇ manager" rule has exactly two places
  it's ever defined, not one per call site.

### 6.5 Services (Business Logic Layer)

Routes stay thin; the actual rules live here.

**`services/ticket_lifecycle.py`** — the state machine's brain:
- `resolve_trailer_by_number` / `rename_or_relink_trailer` /
  `resolve_ticket_trailer` — trailer identity resolution described in
  [§4.4](#44-lot-trailers-trailer-identity--persistent-papers).
- `_pti_gate_passed` — the master-checkbox-or-fresh-LOT-window check.
- `get_last_pti_date` — historical context shown on the QC card: the
  **more recent** of (a) the linked `Trailer.last_pti_date` and (b) the most
  recent *other* ticket for the same truck/trailer with `pti_verified=true`.
  Fixed same-day after an initial cut only checked source (b), which showed
  "No prior record" for a LOT trailer with a known PTI date but no
  fully-verified ticket yet.
- `get_last_qc_approved_date` (R47) — the most recent time a *different*
  ticket for the **same trailer_id** was approved; `None` for tickets with
  no linked trailer (no comparable history).
- `get_last_hauled_truck_for_trailer` / `get_last_hauled_truck` (R51) — the
  former is the raw "most recent OTHER ticket's `(truck_number,
  created_at)` for this `trailer_id`" query, shared by both the QC Review
  card's `last_hauled_truck_number` context (below) and the pre-existing
  `GET /api/trailers/{number}/last-used` route (R43) so the definition
  can't drift between the two call sites; the latter is the
  ticket-scoped convenience wrapper used by `GET /api/tickets/qc`.
- `is_ready_for_qc` — the full readiness gate: registration verified AND
  (inspection paper OR sticker — either suffices) AND BOL present AND (no
  scale needed, or scale received) AND the PTI gate.

**`services/pti.py`** — `compute_pti_verified` (the *legacy* derivation
function, kept for reference/tests; **no route calls it since R18** — the
master checkbox stands alone now). Defines the exact required/optional/pair
item keys mirrored in `frontend/lib/pti.ts`.

**`services/scoring.py`** — `calculate_qc_score` (the leaderboard formula,
[§4.5](#45-scoring-engine--weighted-composite-score)) and the three
score-mutation helpers (`apply_approval_bonus`, `apply_teamwork_bonus`,
`apply_flag_penalty`) that write directly to `User.performance_score`.

**`services/telemetry.py`** — the multi-MC fleet API proxy:
- If `mc.api_endpoint` contains `"samsara"`: real Samsara Fleet API calls —
  `GET /fleet/vehicles` (paginated, name-matched case/whitespace-insensitively
  to the truck number) → `GET /fleet/vehicles/stats` (GPS + fuel%) →
  `GET /fleet/driver-vehicle-assignments` (current driver, falling back to
  the vehicle's `staticAssignedDriver`).
- Otherwise: a **generic** `GET {endpoint}/trucks/{truck_number}` contract
  (for a hypothetical non-Samsara MC).
- Any transport/auth error **other than a real "truck not found" answer**
  falls back to **deterministic mock data** (`_mock_telemetry`, seeded by an
  MD5 hash of the truck number so the same truck always gets the same mock
  driver/location/model/fuel across calls) — this is what lets the whole app
  function with zero real API keys configured. A genuine 404-equivalent
  (`TruckNotFoundError`) is **not** mocked — it's surfaced as a real 404 to
  the frontend ("Truck not found in Samsara's fleet").

**`services/activity.py`** — `record_event()` is the single call site every
lifecycle-mutating route uses; it writes **both** an `AuditLog` row and a
`LiveActivityFeed` row (with the human message rendered once, at write time,
via `_render_message`) so the two tables can never drift out of sync. An
optional `detail` string (R51) is folded into the rendered message only —
`audit_logs` stays a plain `(ticket_id, actor_id, event, created_at)` row;
anything that needs to be reconstructible in full (e.g. a PTI-date
override's old→new value) rides in `live_activity_feed.message` instead,
consistent with every other event's write-time-snapshot approach.

**`services/alerts.py`** — `AlertHub`, an in-process pub/sub: each SSE
client (`GET /api/alerts/stream`) holds a bounded `asyncio.Queue`
(`maxsize=100`, drops rather than blocks a stalled client);
`hub.broadcast(payload)` fans out to every subscriber. Single-process design
— correct for the current one-Uvicorn-worker deployment, would need a
Redis/Postgres LISTEN-NOTIFY layer to scale past that.

**`services/hazmat_monitor.py`** — the continuous background task described
in [§4.11](#411-hazmat-movement-watch-r25). Caches Samsara vehicle-ID lookups
per `(mc_id, normalized truck number)` so repeat polls skip the
`/fleet/vehicles` pagination; batches every watched truck for the same MC
into one `/fleet/vehicles/stats` call.

### 6.6 API Routes — Full Reference

All routes are prefixed `/api/...` and, except `POST /api/auth/login` and
`GET /api/health`, require a valid Bearer JWT. Role requirements are noted
per route.

#### `auth.py`
| Method & Path | Role | Notes |
|---|---|---|
| `POST /api/auth/login` | public | `{username, password}` → `{access_token, role, username}`. 401 on bad creds, 403 if `is_active=false`. |
| `GET /api/users/me` | any | current user's profile (drives the `ScoreBadge`). |

#### `admin.py` (router-level: manager **or admin** — the R52 protections below run in the opposite direction, per-route)
| Method & Path | Notes |
|---|---|
| `POST /api/admin/users` | create employee/qc/manager/admin account; 409 on duplicate username. **R52:** `role: "admin"` 403s unless the caller is already an admin. |
| `GET /api/admin/users` | list all, alphabetical. |
| `PATCH /api/admin/users/{id}` | change username/password/role/is_active. **R52:** 403 if the *target* is an admin account and the caller isn't that same account — this is the enforcement behind "no one can change my password." Promoting anyone to `admin` also 403s unless the caller already is one. **Self-lockout guard** (generalized R52): 409 if you try to change your own role or deactivate yourself, any role. A password change on an account other than the caller's own writes a `PasswordChangeAudit` row. |
| `DELETE /api/admin/users/{id}` | **hard delete**, but only if the user has **zero** recorded activity (tickets/flags/notes/audit rows/feed rows/password-change-audit rows) — otherwise 409 "deactivate instead," preserving referential history. Cannot delete yourself. **R52:** admin accounts can never be deleted, by anyone, full stop (403 before the self-delete check even runs). |
| `GET /api/admin/password-changes` | **R52, admin-only** (a second, stricter `require_roles(UserRole.admin)` pinned on this one route — the router's manager-or-admin gate isn't enough here). The admin's personal security feed: every password change performed on an account other than the changer's own, newest first. |
| `POST /api/admin/mcs` | create a Motor Carrier `{name, api_endpoint, api_key}`. |
| `PATCH /api/admin/mcs/{id}` | update endpoint/key; omit `api_key` to keep the current one. |
| `GET /api/admin/mcs` | list, with `api_key` **masked** (`****last4`) — the raw key never leaves the server after creation. |

#### `telemetry.py`
| Method & Path | Notes |
|---|---|
| `GET /api/telemetry/truck/{mc_id}/{truck_number}` | proxies to `services.telemetry.fetch_truck_telemetry`; 404 on a genuine "not in this fleet" answer, otherwise falls back to mock data. |

#### `lookups.py`
| Method & Path | Notes |
|---|---|
| `GET /api/mcs` | Motor Carrier dropdown source (id+name only). |
| `GET /api/trailers/{trailer_number}` | raw trailer lookup (last PTI date, is_lot) — 404 if unknown. |

#### `trailers.py` (persistent papers, R25)
| Method & Path | Notes |
|---|---|
| `GET /api/trailers/{number}/documents` | saved papers for a trailer — `[]` (not 404) if the trailer is unknown. |
| `GET /api/trailers/{number}/last-used` | R43 — most recent *other* pickup that used this trailer; `null` if none. |
| `GET /api/trucks/{truck_number}/last-pickup` | R46 — the truck's most recent pickup snapshot (trailer, PTI date, papers, what was verified); optional `mc_id` narrows the match; `null` if none. |
| `POST /api/trailers/{number}/documents` | multipart: `doc_type` + either a `file` (image/PDF, ≤100 MB) or a `media_url`. Replaces the existing document of that type. Registers the trailer on the fly (non-LOT) if unknown. |
| `GET /api/trailers/documents/{id}/file` | serves the stored bytes; **no auth check** by design (a plain `<a target="_blank">` can't carry a Bearer header — an unguessable UUID is the access control, matching the `/media/*` static mount's posture). |
| `DELETE /api/trailers/documents/{id}` | uploader or manager only. |

#### `tickets.py` (the largest router)
| Method & Path | Role | Notes |
|---|---|---|
| `POST /api/tickets` | employee/qc/manager | Creates a ticket. Validates `mc_id` exists (404 otherwise, R36). Resolves/creates the linked `Trailer` (R25). Stamps `Trailer.last_pti_date=now()` if PTI is verified on a LOT pickup (R50). Starts the scale timer if needed. Assigns the next `pickup_number`. Sets state to `DRAFT_IN_PROGRESS` if `still_sending`, else `PENDING_QC` or `AWAITING_DRIVER` per the readiness gate. Records `TICKET_CREATED`. |
| `PATCH /api/tickets/{id}` | employee/qc/manager | The universal inline-edit endpoint (Carryover checkboxes, QC quick-fixes, the full edit form). Ownership: employees only their own; QC any ticket for *field corrections* (R30) though still not for approve/flag; managers any. `APPROVED` is otherwise locked (409) **except** to its own creator, QC, or a manager (R17). Re-resolves trailer identity if `trailer_number`/`is_lot_trailer`/`last_pti_date_override` are present (R21/R39). Re-checks `is_ready_for_qc` after every update and auto-promotes to `PENDING_QC`, recording `TICKET_SENT_TO_QC`. |
| `PATCH /api/tickets/{id}/follow-up` | same as PATCH | R21 — stamps `last_followed_up_at=now()`, restarting the visible waiting timer. |
| `PATCH /api/tickets/{id}/pti-date-override` | **manager only** | R51 — corrects the linked **`Trailer.last_pti_date`** (not a ticket-local field) after Trailer Lookup surfaces a more accurate historical date from a different truck's haul. Validates the date isn't >1 day in the future; re-runs the same `AWAITING_DRIVER → PENDING_QC` auto-promotion `PATCH /api/tickets/{id}` performs; records `TICKET_PTI_DATE_OVERRIDDEN` with the old→new value. 400 if the ticket has no linked trailer. |
| `DELETE /api/tickets/{id}` | employee (own only) / qc (any, R16) / manager (any) | Records `TICKET_DELETED` first, **then** detaches (`ticket_id=NULL`) every `audit_logs`, `live_activity_feed`, `trailer_issues`, and `shift_notes` row referencing it (required on Postgres to avoid an FK `IntegrityError`), then hard-deletes the ticket (cascading its own `qc_audit_flags`/`flag_media`). |
| `POST /api/tickets/{id}/dropped` | any | R23 — sets `is_dropped=true`, records `TICKET_DROPPED`. 409 if already dropped. |
| `POST /api/tickets/{id}/resolve` | employee/qc/manager | `FLAGGED → RESOLVED`. Standard flags: creator only. Urgent flags: any employee (awards the teamwork bonus if not the creator). |
| `POST /api/tickets/{id}/unresolvable` | same ownership as resolve | R11 — requires `{reason}` (min 5 chars); sets `is_unresolvable=true`, jumps straight to `PENDING_QC`, records `TICKET_UNRESOLVABLE`. |
| `GET /api/tickets/flagged` | employee/qc/manager | "Action Required" queue — own flags + all urgent flags (managers see everything). |
| `GET /api/tickets/carryover` | employee/qc/manager | The scale-chase board, [§4.6](#46-the-carryover--scale-chase-board). |
| `GET /api/tickets/drafts` | employee/qc/manager | Caller's own `DRAFT_IN_PROGRESS` tickets ("Active Drafts" sidebar panel). |
| `GET /api/tickets/all` | any | Global Sheet — every ticket, no cap. |
| `GET /api/tickets/qc?include_awaiting=` | qc/manager | The audit queue (`PENDING_QC`+`RESOLVED`, optionally `+AWAITING_DRIVER`); attaches the transient `last_pti_date`/`last_qc_approved_date` context fields per ticket. |
| `GET /api/tickets/my-history?on_date=` | employee/qc/manager | every ticket the caller created, any state. |
| `GET /api/tickets/qc-history?outcome=&on_date=` | qc/manager | tickets the caller personally approved or flagged, dated by the **action** timestamp (joins `audit_logs`). |
| `GET /api/tickets/archive` | manager | full history, filterable by date range/state/employee, paginated (`limit≤200`, `offset`). |
| `GET /api/stats/employees` | manager | per-employee daily/monthly/all-time **approved** counts. |
| `POST /api/tickets/{id}/approve` | qc/manager | Conflict-of-interest 403; 409 if dropped or in a non-approvable state; awards `+10` to the creator; records `TICKET_APPROVED`. |
| `POST /api/tickets/{id}/refresh-fuel` | qc/manager | R48 — re-pulls a live fuel % from the fleet API (fuel is otherwise only ever set once, at creation). |
| `POST /api/tickets/{id}/flag` | qc/manager | Conflict-of-interest 403; accepts `error_categories[]` (one `QCAuditFlag` row + one score penalty **per category**), optional `notes`/`severity`/`media[]`/`is_urgent`; clears any prior `is_unresolvable`; records `TICKET_FLAGGED`. |
| `GET /api/tickets/{id}` | any | single-ticket fetch (edit-form prefill). **Must be declared last** — it's a catch-all path param that would otherwise shadow the literal routes above it. |

#### `uploads.py`
`POST /api/uploads` (qc/manager) — multipart image/video ≤100 MB, written to
`backend/media/<uuid><ext>`, returns `{url, media_type}` for use in a flag's
`media[]`.

#### `trailer_issues.py` (R44)
`POST /api/tickets/{id}/trailer-issue` (qc/manager, no conflict-of-interest
restriction) · `GET /api/trailer-issues?include_resolved=` (any role) ·
`POST /api/trailer-issues/{id}/resolve` (any role).

#### `notes.py` — Shift Handover Notes
The auto-note compiler (`_compute_auto_notes`) is the most intricate piece of
read-only logic in the backend:
- Scans the caller's own tickets that are **not** `DRAFT_IN_PROGRESS`,
  **not** `is_dropped`, and haven't had their one-shot auto-note persisted
  yet (`auto_note_generated=false`).
- For a ticket still `AWAITING_DRIVER`: lists **every** missing item
  (Inspection Paper — *and* Inspection Sticker only if the paper is also
  missing, since either satisfies the gate —, Registration, BOL, PTI, Scale
  Ticket) as **one consolidated note per truck** (R22, replacing an earlier
  one-note-per-missing-item design).
- For a ticket in **any later state** (including `APPROVED`, R14): the only
  possible follow-up is an unfinished scale ticket — surfaced the same way,
  so a truck that left before its scale arrived still nags dispatch.
- A KPRA destination group on the ticket appends an extra "ALERT: KPRA
  destination (...)" line regardless of which group.
- `POST /api/notes/publish` persists the computed auto-notes (skipping ones
  whose exact text is already an open published auto-note) and flips the
  caller's manual `DRAFT` notes to `PUBLISHED` in the same call, then sets
  `auto_note_generated=true` on every source ticket **whether or not** its
  note was actually written (dedup skip included) — this one-shot flag is
  what keeps a user's deliberate delete or edit of a published note from
  being silently regenerated on the next publish.
- `GET /api/notes/global` — the shared "team inbox" of unresolved published
  notes; `PATCH .../resolve`, `PATCH /api/notes/{id}` (edit — drafts
  author-only, published notes team-editable, resolved notes locked), and
  `DELETE /api/notes/{id}` (author or manager, any status, R18) round out the
  CRUD.

#### `feed.py`
`GET /api/feed/live?limit=` (manager only) — read-only view over the
immutable `live_activity_feed` table; no mutation endpoint exists.

#### `leaderboard.py`
`GET /api/leaderboard` (any role) — implements the composite-score query
described in [§4.5](#45-scoring-engine--weighted-composite-score) entirely
in one route function: pulls every ticket/audit-log row once, aggregates
per-user in Python (not SQL `GROUP BY`, since the accuracy/efficiency/volume
formula is easiest expressed imperatively), scores every active
employee+qc user, sorts, and returns ranked entries.

#### `export.py`
`GET /api/export/pickups?start_date=&end_date=` (manager only) — builds an
in-memory `openpyxl` **multi-sheet workbook**, one sheet per calendar day in
the requested range (even empty days get a header-only sheet, capped at 366
days), with every relational field resolved to a human string (MC name,
employee username, approving QC + timestamp, flag category labels, flaggers
— no raw UUIDs). Column order follows a manager-specified fixed layout (see
the `HEADERS` list and its "R40: fixed report order" comment) with everything
else appended as extra context columns. Streamed back as an `.xlsx`
attachment.

#### `alerts.py` (SSE)
`GET /api/alerts/stream?token=` — see [§4.11](#411-hazmat-movement-watch-r25)
and [§9.2](#92-real-time-transport-sse-vs-polling). The JWT rides in the
**query string** because `EventSource` cannot set request headers; it's
verified with the same `decode_access_token` + active-user check as the
Bearer dependency. Sends a 15-second keepalive comment frame so
proxies/load-balancers don't kill the idle connection.

### 6.7 Scripts

`app/scripts/`:
- **`seed.py`** — creates one bootstrap manager (`laith`/`laith123!`), a set
  of Motor Carriers (from the gitignored `backend/mc_tokens.json`, falling
  back to placeholder-token MCs with a printed warning if that file is
  absent), and 3 sample trailers (one fresh LOT, one stale LOT, one
  standard). Idempotent — skips anything that already exists by name.
- **`reset_data.py`** — wipes all *operational* data (tickets, flags, media
  rows, audit logs, feed, notes) and resets every score to 100, while
  **keeping** user accounts, Motor Carriers, and trailers (and their saved
  papers — it collects the trailer-document filenames *before* wiping the
  media directory so it doesn't delete files a kept `TrailerDocument` row
  still points at).
- **`migrate_r7.py` … `migrate_r11.py`** — early one-off migration scripts
  from before the `main.py`-embedded in-place-migration pattern was
  established; superseded by that pattern for every change since R14, kept
  for historical reference on databases that predate it.

---

## 7. Frontend Architecture

### 7.1 Routing (Next.js App Router)

```
/                                    → redirect to role's home route, or /login
/login
/dashboard/                          layout: sidebar nav + global notification plumbing
  new-pickup                         create/edit a pickup (also handles /new-pickup?edit={id})
  carryover                          scale-chase board + "Action Required" flagged section
  all-pickups                        global read-only spreadsheet (Active + Full Sheet)
  my-pickups                         personal history (Active / All tabs)
  notes                              shift handover notes
  trailer-issues                     non-punitive trailer problem board
  leaderboard                        composite score rankings
  qc-review                          [qc, manager] audit queue
  qc-history                         [qc, manager] "My Audits"
  admin                              [manager] users + Motor Carriers
  manager/live-feed                  [manager] 5s-polling activity feed
  manager/archive                    [manager] full history + Excel export
  manager/stats                      [manager] per-employee completed-pickup counts
```

`homeRoute(role)` (`store/authStore.ts`): `qc` → `/dashboard/qc-review`,
`manager`/`admin` (R52) → `/dashboard/carryover`, `employee` → `/dashboard/new-pickup`.

Every dashboard page is wrapped `<RequireRole roles={[...]}>` — a
client-side guard that redirects to `homeRoute()` if the hydrated role
doesn't match. This is **UX polish only**; the backend independently
enforces every permission via `require_roles()`. **R52:** `RequireRole`
checks `roleAllows(roles, role)` rather than a bare `roles.includes(role)`,
so a page guarded `roles={["manager"]}` (or any array containing it) admits
`admin` too without needing its own array updated — the same superset
relationship as the backend's `require_roles()`.

### 7.2 State Management (Zustand)

Three small, single-purpose, `persist`-backed-where-needed stores — no Redux,
no Context API for app state.

- **`authStore`** — `{token, role, username, hasHydrated}`. Persisted to
  `localStorage` under `"trailercheck-auth"`. `hasHydrated` exists because
  Zustand's `persist` middleware hydrates from `localStorage`
  **asynchronously** after first render — every page gates its guard logic
  on `hasHydrated` to avoid a flash-of-login-page on refresh.
- **`timeStore`** (R24) — `{mode: "cst" | "local"}`, persisted as
  `"trailercheck-timezone"`. A per-device display preference; every
  `fmtCst*` helper in `lib/time.ts` reads it live. The dashboard layout keys
  its `<main>` element on `timeMode` so flipping the toggle **remounts the
  entire page**, forcing every rendered timestamp to re-format immediately.
- **`formGuardStore`** (R41) — the "unsaved changes" coordination layer
  described in [§9.4](#94-the-unsaved-changes-guard). *Not* persisted — it's
  purely an in-memory cross-component signaling mechanism for the current
  session.

### 7.3 The API Client & Retry Interceptor

`lib/api.ts` exports one function, `api<T>(path, init)`, used by virtually
every page. It:

1. Reads the JWT from `authStore` and attaches `Authorization: Bearer ...`.
2. Delegates the actual fetch to `fetchWithRetry` — **retries up to 3
   times** (2s/4s/8s backoff) on a network error, a per-attempt 30-second
   timeout (`AbortSignal.timeout`), or a `502`/`503`/`504` response. This
   specifically absorbs Render's free-tier cold start (~30–60s to wake a
   sleeping instance) without the user seeing a raw failure. A throttled
   (max once per 15s) global `tc-toast` CustomEvent fires "Waking up secure
   connection, please wait..." — the dashboard layout's toast stack and the
   login page's inline banner both listen for it.
3. On a **401** (except from the login endpoint itself, where a 401 means
   "wrong password," not "expired session"): calls `authStore.logout()` and
   hard-redirects to `/login`.
4. On any other non-2xx: throws `ApiError(status, detail)` — `detail` is
   read from the JSON body's `detail` field when present, else a generic
   `"Request failed ({status})"`.
5. Explicitly special-cases **204 No Content** (a successful `DELETE`) to
   avoid calling `res.json()` on an empty body, which previously made
   successful deletes render as failures.

Two separate functions (`uploadMedia`, `uploadTrailerDocument`) bypass the
retry wrapper entirely — large video uploads legitimately run long, and
blindly retrying a body that may have already landed risks duplicate
uploads.

`mediaUrl(url)` resolves a backend-relative `/media/...` or
`/api/trailers/documents/.../file` path to an absolute URL using
`NEXT_PUBLIC_API_URL`.

### 7.4 `lib/` Helpers

- **`types.ts`** — every API shape as a TypeScript interface, mirroring the
  Pydantic schemas 1:1 (`Ticket`, `AuditFlag`, `ShiftNote`, `TrailerIssue`,
  `LeaderboardEntry`, etc.), plus small pure helpers used across pages:
  `isActivePickup(t)` (the "still in play" predicate — an `APPROVED` ticket
  counts as active only while its scale chase is unfinished),
  `matchesStatus(t, filter)`, and the `STATUS_FILTER_LABELS` map that turns
  raw enum values into the dropdown's human labels.
- **`time.ts`** — CST-vs-local formatting (`fmtCst`, `fmtCstFull`,
  `fmtCstTime`, `fmtCstDate`, all reading `timeStore` live and caching one
  `Intl.DateTimeFormat` per kind×mode), the shift-bucketing logic
  ([§4.7](#47-shift-definitions-central-time)), and `matchesSearch`/
  `matchesDayShift` used by every list page's filter bar.
- **`pti.ts`** — the exact PTI checklist structure (`PTI_SECTIONS`),
  mirroring `backend/app/services/pti.py` item-for-item so the frontend's
  "Select All" and read-only QC log render the identical set of rows the
  backend's (now-unused-for-gating, informational) `compute_pti_verified`
  understands.

### 7.5 Shared Components

- **`components/ui.tsx`** — `Skeleton`, `Toggle` (an accessible switch,
  `role="switch"`), `StateBadge` (color-codes every `TicketState` +
  overrides to a "DROPPED" pill when `is_dropped`), `HazmatBadge`,
  `StatusFilter` (the reusable per-page status dropdown), `ErrorBanner`,
  `SuccessBanner`.
- **`GuardedLink`** — a drop-in `<Link>` replacement that routes every
  sidebar/nav click through `formGuardStore.requestNavigation()` instead of
  navigating directly, so an in-progress New Pickup form can intercept it.
- **`RequireRole`** — the client-side RBAC gate described in
  [§7.1](#71-routing-nextjs-app-router).
- **`UnsavedChangesModal`** — rendered **once, globally**, in the dashboard
  layout (not per-page) so it can catch navigation attempts from *anywhere*
  regardless of which page is currently mounted; offers Save as Draft /
  Discard / Cancel.
- **`qc/TrailerHistoryLookup`** (R51) — the Trailer Lookup popover next to
  the QC Review card's Trailer # field; see
  [§4.10](#410-manager-pti-date-overrides--cross-fleet-trailer-lookup-r51).
  Available to every role for the read-only lookup; the "Apply to Ticket"
  action is disabled client-side (and 403s server-side regardless) unless
  `role === "manager"`.
- **`qc/ConfirmationModal`** — the **intentional-friction** approval dialog:
  three unchecked boxes ("Data matches Samsara/Telematics," "Weights are
  within legal bounds," "Documentation is visually confirmed") that must
  *all* be ticked before "Confirm Approval" enables. Resets to all-unchecked
  every time it opens — the friction is deliberate, not a one-time
  onboarding nag.

### 7.6 Dashboard Layout — The App Shell

`app/dashboard/layout.tsx` is the single largest piece of "glue" logic in the
frontend. Besides rendering the sidebar/mobile nav (role-filtered from a
static `NAV_ITEMS` table) and the CST/Local `TimeZoneToggle`, it owns **six
independent polling/streaming effects**, all scoped to the dashboard shell so
they run continuously regardless of which page is open:

| Concern | Mechanism | Interval |
|---|---|---|
| Flag notifications + nav badge | poll `GET /api/tickets/flagged` | 15s |
| QC "resent for re-verification" toast | poll `GET /api/tickets/qc`, diff for new `RESOLVED` rows | 15s |
| Hourly missing-items reminder | poll `GET /api/notes/drafts`, `localStorage`-throttled | check every 5 min, nag at most hourly |
| Trailer-issue nag | poll `GET /api/trailer-issues`, `localStorage`-throttled | check every 15s, nag at most every 2h |
| Active Drafts sidebar panel | poll `GET /api/tickets/drafts` | 15s, plus on every route change |
| **Hazmat alert banner** | **SSE** `GET /api/alerts/stream` | push, not poll |
| Performance score badge | fetch `GET /api/users/me` | on every route change |
| **Admin security alert** (R52, admin-only) | poll `GET /api/admin/password-changes` | 15s |

The SSE connection has its own **resilience layer** (R26): `EventSource`
only auto-retries *transient* errors — a background tab, a sleeping laptop,
or a non-200 initial response lands the connection in `CLOSED` and it stays
dead forever on its own. The layout rebuilds the connection with exponential
backoff (capped at 30s) on `onerror` when `readyState === CLOSED`, and
additionally forces an immediate reconnect attempt on `visibilitychange`
(tab refocused), `window focus`, and `online` events.

### 7.7 Pages — Behavioral Reference

This section covers what each page *does* beyond its obvious CRUD table,
focusing on the non-obvious interaction design choices.

#### `login/page.tsx`
Plain username/password form. Surfaces the retry interceptor's
"waking up" toast inline (amber banner) rather than only as a floating
toast, since the dashboard toast stack doesn't exist pre-login.

#### `new-pickup/page.tsx` (~1,900 lines — the largest page)
The intake form, doing triple duty as **create**, **edit** (`?edit={id}`),
and **resume-a-parked-draft** (also `?edit={id}`, distinguished by the
loaded ticket's state).

Key mechanics:
- **Debounced telemetry auto-fill** (600ms after the MC+truck-number pair
  stabilizes) populates driver/location/model/fuel — every field stays
  manually editable, and a 404 ("truck not in fleet") or any transport error
  just shows an inline hint rather than blocking the form.
- **"Still using trailer XXXX?"** (R46) — a debounced probe fires the moment
  a truck number is typed (only while no trailer number is entered yet, and
  only on create, not edit); accepting the modal copies over the trailer
  number + PTI date only — **not** the papers/PTI checkboxes, since those
  need fresh verification for *this* pickup.
- **Saved trailer papers panel** — appears the instant a trailer number is
  present; supports (a) file upload, (b) **clipboard paste** — a copied
  screenshot/photo *or* a copied link — via a two-tier strategy: try the
  modern async Clipboard API first (works on HTTPS/localhost), and if the
  browser blocks that (plain-HTTP LAN), "arm" the slot and fall back to a
  document-level `paste` event listener that auto-disarms after 20s.
- **The PTI section**: the master checkbox is visually dominant (a
  crimson-bordered box at the top); the granular per-item checklist below is
  explicitly framed as "a log of what you saw in the video — it never blocks
  verification," with a live-updating status line.
- **The "Still Sending" flow** (R17): a secondary "Save Draft" button
  persists the ticket as `DRAFT_IN_PROGRESS` and **clears the form** for the
  next concurrent pickup (dispatchers routinely juggle several trucks at
  once); the sidebar's "Active Drafts" panel resumes any parked draft with
  one click.
- **The unsaved-changes guard**: every typeable/toggleable field feeds a
  JSON snapshot compared against a "clean baseline" re-captured only on a
  deliberate reset/load (never on ordinary re-renders); a mismatch marks the
  global `formGuardStore` dirty, which every navigation trigger in the app
  (sidebar links, logout, Active Drafts, the page's own Cancel button)
  checks before actually navigating. A `beforeunload` listener adds a
  native browser confirmation as the last line of defense for a tab
  close/refresh/typed URL, which no client-side router hook can intercept.
- **The "DOT Predictive Balancer"** (`ScaleTicketBox`, shown only when
  "Needs scale" is checked): a self-contained axle-weight calculator —
  dispatcher types steer/drive/trailer scale weights, drags 5th-wheel and
  tandem "hole" sliders, and the box computes projected weights after a
  slide, flags anything over the 12k/34k/34k legal limits, factors in a
  "KPRA locked" (California-hole) constraint that blocks sliding tandems
  backward, and prints a step-by-step "Dispatcher Action Plan" (which
  direction to slide, how many holes, and a safe max fuel % if the drive
  axle would otherwise go over once topped off). This is pure client-side
  arithmetic — it is never sent to the backend; it exists purely as an
  in-form scratch-pad tool for the dispatcher.

#### `carryover/page.tsx`
Two independently-fetched sections rendered together: **"Action Required"**
(from `/api/tickets/flagged`, card grid) and the **scale-chase table** (from
`/api/tickets/carryover`, sorted critical-timer-first then by longest wait).
Every checkbox column PATCHes immediately and optimistically updates local
state before the network call resolves (with a rollback on failure);
`InlineTextCell` (trailer #, weight) commits only on blur/Enter and only if
the trimmed value actually changed, to avoid a stray-focus PATCH storm.
Role-gated action buttons use three tiers of permission
(`canModify`/`canQuickEdit`/`canDelete`) that mirror — but don't replace —
the backend's own per-route checks.

#### `all-pickups/page.tsx`
A genuinely global, read-only "spreadsheet" (zebra rows, sticky header,
20s auto-refresh) split into an "Active Pickups — all employees" section
(top) and the complete "Full Sheet" (bottom). Managers get an inline Edit
pencil reaching **any** ticket in **any** state, including `APPROVED`.

#### `my-pickups/page.tsx`
Active/All tabs over the caller's own `my-history` endpoint; the creator can
edit their own ticket even after `APPROVED` (R17) — this is the one place a
non-manager, non-QC user can touch a terminal-state ticket.

#### `qc-review/page.tsx` (~1,280 lines — the densest interaction surface)
Each card renders the full ticket detail plus inline editable fields
(trailer #, weight — same `EditableDetail` pattern as Carryover) so a QC
user can fix a small miss **without** opening a flag at all (R30). Notable
elements:
- A **live "Last PTI Date" / "Last QC Approved" / "Last Hauled By" context
  trio** (server-computed, R20/R47/R51) so QC isn't auditing blind on a
  returning trailer. For a manager, Last PTI Date is additionally an inline
  `<input type="date">` (a small "mgr" badge marks the override control);
  every other role keeps the plain read-only value. A **Trailer Lookup**
  popover (`TrailerHistoryLookup`, next to the Trailer # field) lets any
  role query a trailer's registered PTI date and last-hauling truck on
  demand — including a trailer *other* than the one currently linked — with
  a manager-only "Apply to Ticket" action. See
  [§4.10](#410-manager-pti-date-overrides--cross-fleet-trailer-lookup-r51).
- A **fuel-refresh button** (R48) next to the (otherwise stale-since-intake)
  fuel reading.
- The **saved trailer papers** box, fetched independently per card
  (`TrailerPapers`), rendering a distinct visible state for "no trailer
  linked" / "checking..." / "fetch failed" / "none on file" / the actual
  links — deliberately never silently blank, so an absent-papers state can't
  be mistaken for a broken feature.
- The **flag form** supports multi-category selection (one flag action, N
  categories, N score penalties), a conditional 1–10 severity slider (only
  for "Didn't text in the group"), a conditional required-notes rule (only
  for "Other"), an "Urgent Flag" toggle, and proof media (file upload *or*
  pasted URL, auto-detected as image/video by extension).
- A **conflict-of-interest branch**: if the logged-in QC user is the
  ticket's own creator, Approve/Flag are replaced entirely by a "Your
  pickup — another QC or a manager must audit it" notice — the Trailer Issue
  and Delete actions remain available (neither is an audit verdict).
- **"Exception Review"** cards (`is_unresolvable=true`) get a red border and
  the employee's mandatory written reason surfaced verbatim, with the
  Approve button relabeled "Force Approve."

#### `qc-history/page.tsx`, `manager/stats/page.tsx`, `manager/archive/page.tsx`, `manager/live-feed/page.tsx`, `leaderboard/page.tsx`, `notes/page.tsx`, `trailer-issues/page.tsx`
Comparatively conventional list/table/form pages layered on the endpoints
described in [§6.6](#66-api-routes--full-reference); each is covered in
detail inline in its own source file's comments. Two are worth a specific
callout:
- **`manager/archive`**'s Excel export button is disabled until a "From"
  date is picked, and downloads via an authenticated `fetch` +
  `URL.createObjectURL` (not a plain `<a href>`, since the endpoint requires
  a Bearer header).
- **`notes/page.tsx`**'s manual-note composer is a `<textarea>` where
  **every non-empty line becomes its own separate note** on submit (R19) —
  pasting a multi-line list of missing items creates N independently
  resolvable notes, not one blob.

#### `admin/page.tsx`
User + Motor Carrier CRUD as described in [§6.6](#66-api-routes--full-reference).
**R52** additions, all gated on the viewer's own role
(`useAuthStore((s) => s.role)`), purely to avoid presenting a control the
backend would just 403:
- The role-assignment `<select>` (both the create-user form and the
  inline per-row editor) only lists `admin` as an option when the viewer is
  themselves an admin.
- A row whose `role === "admin"` shows a "🔒 Protected" label instead of
  Edit/Delete icons for any non-admin viewer.
- A `SecurityLogSection`, rendered only for `role === "admin"`, lists every
  `GET /api/admin/password-changes` entry (who changed whose password,
  when) — the persistent counterpart to the live toast alert fired from
  `dashboard/layout.tsx` ([§7.6](#76-dashboard-layout--the-app-shell)) the
  instant a new one appears, so a change is never visible only in the
  moment it happens.

---

## 8. End-to-End Interaction Flows

### 8.1 Login

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant FE as Next.js (login page)
    participant API as FastAPI /api/auth/login
    participant DB as Postgres/SQLite

    U->>FE: submit username + password
    FE->>API: POST /api/auth/login {username, password}
    API->>DB: SELECT user WHERE username=...
    DB-->>API: user row (or none)
    API->>API: bcrypt.checkpw(password, user.password_hash)
    alt invalid credentials
        API-->>FE: 401 "Invalid username or password"
        FE-->>U: inline error banner
    else account deactivated
        API-->>FE: 403 "Account is deactivated"
    else success
        API->>API: create_access_token(user.id, role) — HS256, 8h expiry
        API-->>FE: 200 {access_token, role, username}
        FE->>FE: authStore.setAuth(...) → persisted to localStorage
        FE-->>U: redirect to homeRoute(role)
    end
```

### 8.2 Create a Pickup Ticket → State Machine Auto-Advance

```mermaid
sequenceDiagram
    participant E as Employee
    participant FE as New Pickup form
    participant TEL as Samsara Fleet API
    participant API as FastAPI
    participant DB as Database

    E->>FE: pick MC, type truck number
    FE->>API: GET /api/telemetry/truck/{mc_id}/{truck}  (debounced 600ms)
    API->>TEL: GET /fleet/vehicles, /stats, /driver-vehicle-assignments
    TEL-->>API: driver, location, model, fuel% (or transport error → mock data)
    API-->>FE: {driver_name, location, model, fuel_percentage, lat, lon}
    FE->>FE: auto-fill fields (still manually editable)
    E->>FE: fill checklist, tick master PTI box, Create Ticket
    FE->>API: POST /api/tickets {...payload}
    API->>DB: validate mc_id exists; resolve/create Trailer row
    API->>API: is_ready_for_qc(ticket)?
    alt all required fields + PTI gate satisfied
        API->>DB: state = PENDING_QC, submitted_to_qc_at = now()
    else missing something
        API->>DB: state = AWAITING_DRIVER
    end
    API->>DB: assign pickup_number = max+1; record_event(TICKET_CREATED)
    DB-->>API: audit_logs + live_activity_feed rows written
    API-->>FE: 201 TicketOut
    FE-->>E: success banner, form resets for the next pickup
```

### 8.3 QC Approve — Intentional Friction + Scoring

```mermaid
sequenceDiagram
    participant Q as QC user
    participant FE as QC Review page
    participant API as FastAPI
    participant DB as Database

    Q->>FE: click "Approve Ticket"
    FE->>FE: open ConfirmationModal (3 unchecked boxes)
    Q->>FE: check all 3 boxes
    FE->>FE: "Confirm Approval" enables
    Q->>FE: click Confirm Approval
    FE->>API: POST /api/tickets/{id}/approve
    API->>API: current_user.role==qc && ticket.created_by==current_user.id ?
    alt conflict of interest
        API-->>FE: 403 "you cannot approve a pickup you created"
    else ticket is_dropped or in a non-approvable state
        API-->>FE: 409
    else OK
        API->>DB: state = APPROVED
        API->>DB: creator.performance_score += 10
        API->>DB: record_event(TICKET_APPROVED) → audit_logs + live_activity_feed
        API-->>FE: 200 TicketOut
        FE-->>Q: notice "Truck X approved (+10 to creator)"
    end
```

### 8.4 QC Flag → Employee Fix → Resend Loop

```mermaid
sequenceDiagram
    participant Q as QC user
    participant E as Employee
    participant API as FastAPI
    participant DB as Database

    Q->>API: POST /api/tickets/{id}/flag {error_categories[], notes, severity, media[], is_urgent}
    API->>DB: state=FLAGGED, is_urgent_flag=is_urgent, resolved_by=NULL
    loop one row per category
        API->>DB: INSERT qc_audit_flags; creator.performance_score -= penalty
    end
    API->>DB: record_event(TICKET_FLAGGED)
    API-->>Q: 200 (ticket removed from QC queue)
    Note over E: dashboard layout's 15s poll of /api/tickets/flagged detects the new row
    API-->>E: toast "QC flagged your ticket for truck X"
    E->>E: fix the checklist gaps inline on Carryover ("Action Required" card)
    E->>API: POST /api/tickets/{id}/resolve
    API->>DB: state=RESOLVED, resolved_by=E; record_event(TICKET_RESOLVED)
    Note over Q: QC's 15s poll of /api/tickets/qc detects the new RESOLVED row
    API-->>Q: toast "E resent truck X after fixes — ready to verify"
```

### 8.5 Hazmat Movement Alert (Server-Sent Events)

```mermaid
sequenceDiagram
    participant Mon as hazmat_monitor_loop (background task)
    participant Sam as Samsara GPS
    participant Hub as AlertHub (in-process)
    participant SSE as GET /api/alerts/stream
    participant U as Every logged-in user's browser

    loop continuous, paced only by the HTTP round-trip
        Mon->>Mon: query DB for active tickets with is_hazmat=true
        Mon->>Sam: GET /fleet/vehicles/stats (batched per MC)
        Sam-->>Mon: speedMilesPerHour per vehicle
        alt speed > 5 mph and not re-alerted in the last 5 min
            Mon->>Hub: broadcast({type: hazmat_movement, ticket_id, truck_number, speed_mph, message})
            Hub->>SSE: push to every subscriber queue
            SSE-->>U: EventSource onmessage
            U->>U: full-width red banner, animate-ping dot, stays until dismissed
        end
    end
```

### 8.6 Shift Handover Notes — Auto-Compile → Publish

```mermaid
sequenceDiagram
    participant E as Employee
    participant FE as Notes page
    participant API as FastAPI /api/notes
    participant DB as Database

    FE->>API: GET /api/notes/drafts
    API->>DB: scan caller's tickets (AWAITING_DRIVER missing-items scan, or any-state unfinished-scale scan)
    API-->>FE: {auto_notes: [...one per truck...], manual_drafts: [...]}
    FE-->>E: render auto-notes (sparkle icon) + manual drafts + "Add note" textarea
    E->>FE: click "Publish Shift Handover"
    FE->>API: POST /api/notes/publish
    API->>DB: for each auto-note not already open on the board: INSERT shift_notes (PUBLISHED); ticket.auto_note_generated = true
    API->>DB: caller's manual DRAFT notes → PUBLISHED
    API-->>FE: {published_auto, published_manual, skipped_duplicates}
    Note over DB: auto_note_generated is now permanently true for those tickets — <br/>a later delete/edit of the published note is never silently regenerated
```

---

## 9. Cross-Cutting Concerns

### 9.1 Authorization: Defense in Depth

Every permission rule exists **twice** — once as a client-side UX guard
(`RequireRole`, per-page `canModify`/`canQuickEdit` predicates, disabled
buttons) and once, independently, as a server-side check
(`require_roles()`, inline `if current_user.role ...` branches in
`tickets.py`). The frontend checks exist purely to avoid showing a control
the backend would reject; **every** authorization decision that actually
matters is re-verified server-side, including the conflict-of-interest rule,
which the QC Review page also hides the buttons for but which the backend
enforces with a 403 regardless of what the client sends.

The admin/manager relationship (R52,
[§4.12](#412-the-admin-role--account-security-protections-r52)) runs this
principle in **both directions at once**: `admin` is a privilege superset of
`manager` (checked once, centrally, in `require_roles()` and the shared
`MANAGER_ROLES` tuple — not duplicated at ~30 call sites), while the
protection of admin accounts *from* managers is the opposite relationship,
enforced inline in `admin.py` precisely because it depends on which
*account* a request targets, not just which role is making it — a question
`require_roles()`'s generic role-only gate has no way to answer.

### 9.2 Real-Time Transport: SSE vs. Polling

The system deliberately uses **two different real-time strategies** for two
different urgency profiles:
- **Server-Sent Events** (one-way push) for the hazmat movement alert — the
  one case where seconds matter and a global broadcast (not a per-user poll)
  is the natural shape.
- **Plain `setInterval` polling** (5s–30s depending on the page) for
  everything else — the live feed, flag notifications, QC resend
  notifications, drafts, trailer-issue nags, the leaderboard, all list pages.
  This is a deliberate simplicity trade-off for a small-team internal tool:
  no WebSocket infrastructure, no reconnection state machine to build twice,
  and the staleness window (a few seconds) is operationally irrelevant for
  everything except the truck-is-moving-right-now case SSE covers.

### 9.3 Optimistic UI & Rollback

Carryover's inline checkboxes update local state **before** the PATCH
resolves (feels instant), then either reconcile with the server's response
or **roll back to the pre-edit ticket object** on failure — this is the
`patchField` pattern repeated (with small variations) across Carryover, QC
Review, and the inline text cells.

### 9.4 The Unsaved-Changes Guard

Next.js's App Router has no built-in "block this navigation" hook (unlike
React Router). `store/formGuardStore.ts` (R41) is the from-scratch
substitute: any page that wants navigation protection calls
`registerHandlers({saveDraft, discard})` and toggles `setDirty(bool)`; every
navigation trigger anywhere in the app — sidebar links (via `GuardedLink`),
the logout button, the Active Drafts sidebar buttons, even the New Pickup
form's own Cancel button — calls `requestNavigation(execute)` instead of
navigating directly. If nothing is dirty, `execute()` runs immediately;
otherwise it's deferred behind the single globally-rendered
`UnsavedChangesModal` until the user picks Save/Discard/Cancel. A
`beforeunload` listener is the separate, unavoidably native-browser-styled
fallback for a tab close, refresh, or typed URL, which no JS-level router
hook can intercept at all.

### 9.5 Timezone Handling

Two independent axes:
1. **Display** (`timeStore`, per-device, persisted) — every timestamp in the
   UI is rendered in either Central Time or the viewer's own local zone,
   toggled by the sidebar's CST/Local switch. Purely cosmetic.
2. **Operational bucketing** (shift windows, the "day" filters) — **always**
   Central Time regardless of the display preference, because "First shift"
   and "today" are dispatch-operational concepts anchored to the physical
   location of the operation, not to wherever the viewer happens to be
   logged in from (the codebase's own comment notes this matters for a
   remote viewer in, e.g., Jordan or Lebanon).

### 9.6 Data Integrity on Deletion

Deleting a `PickupTicket` **never** deletes its history. `audit_logs`,
`live_activity_feed`, `trailer_issues`, and `shift_notes` rows referencing
it are explicitly `UPDATE`d to `ticket_id = NULL` ("detached") in the same
transaction, immediately before the ticket row itself is deleted — this
preserves the deletion event and every prior event on permanent record while
still letting Postgres's foreign-key constraints succeed. Only
`qc_audit_flags` (and their `flag_media`) are allowed to cascade-delete with
the ticket, since a flag has no independent meaning once its ticket is gone.

---

## 10. Deployment & Environments

| Environment | Frontend | Backend | Database | Notes |
|---|---|---|---|---|
| **Production (cloud)** | Vercel | Render (`trailercheck-api`, free web service) | Render managed Postgres (free tier) | `render.yaml` Blueprint provisions both Render resources together. See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact click-through. |
| **Office LAN** | `next start` on a machine on the local network | local Uvicorn on the same machine | SQLite (`backend/dev.db`) | `run.bat` auto-detects the host's private IP, bakes it into `NEXT_PUBLIC_API_URL` at build time, and opens Windows Firewall ports 3000/8000 (best-effort, needs admin). |
| **Solo local dev** | `next dev` | local Uvicorn | SQLite | Manual setup per [README.md](README.md#manual-setup). |

**Known free-tier constraints** (documented in DEPLOYMENT.md, mitigated in
code):
- Render free services **sleep after ~15 min idle**; first request after
  waking takes 30–60s — absorbed by the frontend's retry interceptor
  ([§7.3](#73-the-api-client--retry-interceptor)).
- Render's free Postgres **expires after 90 days** — the fix is either the
  paid DB plan or migrating `DATABASE_URL` to Neon (free, no expiry).
- Flag-proof media (`backend/media/*`, disk-based) is **ephemeral** on
  Render's free filesystem — wiped on every redeploy/restart. Trailer
  documents are immune to this since R42 moved them into the database as
  bytes; flag proof was intentionally left as-is (evidentiary, not
  operational — the flag record and its category/notes survive regardless).

CORS in production is opened specifically for the `FRONTEND_ORIGINS`
env var (the exact Vercel URL) — set this **after** the first Vercel deploy
completes, or the two halves can't talk to each other.

---

## 11. Local Development

### Fully automated (Windows)

```powershell
git clone https://github.com/LAEK-Soft/TrailerCheck.git
cd TrailerCheck
.\run.bat
```

`scripts/run-all.ps1` (what `run.bat` invokes) is fully idempotent: it
installs Python 3.12 and Node LTS via `winget` if missing, creates/reuses the
backend venv, installs frontend deps only if `node_modules` is absent,
rebuilds the frontend only if the detected LAN IP changed or no prior build
exists (the API URL is baked in at Next.js build time via
`NEXT_PUBLIC_API_URL`), stops anything already listening on ports 3000/8000
for a clean restart, and launches both servers in their own titled console
windows.

### Manual (any OS)

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
export DATABASE_URL=sqlite:///./dev.db
python -m app.scripts.seed
uvicorn app.main:app --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Seeded logins: `laith` / `laith123!` (manager), `qc_test` / `qctest123!`
(qc — created via Admin, not seed.py), `manager_test` / `manager123!`
(manager). *(`seed.py` itself only creates the single bootstrap manager,
`laith`; every other test account referenced in project docs was created
afterward via the Admin page.)*

Interactive API docs (Swagger UI) are auto-generated by FastAPI at
`http://localhost:8000/docs`.

---

## 12. Revision Timeline

The codebase evolved through roughly fifty small, additive revisions (each
tagged `R<n>` in code comments and commit history) rather than a small number
of big rewrites — a deliberate incremental style that keeps every change
narrowly scoped and self-documenting inline. The table below covers the
revisions with the widest blast radius; consult `docs/0*-*.md` and the
per-file `R<n>:` comments throughout the codebase for the complete,
line-level record.

| Rev | Change |
|---|---|
| R1 | Initial cut: users, MCs, trailers, tickets, QC flags, JWT auth, the core state machine. |
| R2 | PTI no longer blocks *creation* — only the `AWAITING_DRIVER → PENDING_QC` transition; LOT 7-day PTI window; sticker verification; CA/FL checkbox (later superseded by R35). |
| R3 | Live activity feed; My History; QC History ("My Audits"). |
| R4 | Manager CSV export (later replaced by R40's multi-sheet Excel export). |
| R5 | Employee "active board" visibility rules; Global Sheet (`/api/tickets/all`). |
| R6 | Shift Handover Notes (auto + manual drafts, publish, global inbox). |
| R7 | LOT trailers bypass fleet API validation; free-text weight field. |
| R8 | Structured PTI checklist (video log); Mistake Privacy; Urgent Flags + teamwork bonus; QC proof media uploads. |
| R9 | Weighted Composite Score formula + Leaderboard. |
| R11 | Unresolvable-exception escape hatch (mandatory reason, Force Approve). |
| R12 | Chassis PTI toggle (locks/zip-ties section). |
| R13 | QC "resolved and resent" toast notification. |
| R14 | API retry interceptor for cloud cold-starts; QC role parity on every employee endpoint; strict conflict-of-interest rule; ticket-delete FK fix (detach, don't cascade, audit history). |
| R15 | Removed the "CRVR in weight text" auto-scale-flag rule. |
| R16 | QC given delete-any-pickup power. |
| R17 | `DRAFT_IN_PROGRESS` "Still Sending" drafts; global CST timestamp display; creators can edit their own tickets even after `APPROVED`. |
| R18 | Master PTI checkbox becomes the sole source of truth; granular checklist demoted to an informational video log. |
| R19 | Sticky-scrollbar table wrappers; bulk multi-line note paste. |
| R20 | Discard-draft action; "Last PTI Date" historical context on QC cards. |
| R21 | "Followed up" action restarts the Carryover waiting timer. |
| R22 | Auto-notes consolidated to one-per-truck, one-shot persisted (never regenerated after user edit/delete). |
| R23 | "Dropped" lifecycle-ending flag; Carryover redefined as the scale-chase board (active even after `APPROVED`). |
| R24 | Per-device CST/Local display-timezone toggle. |
| R25 | Persistent trailer identity + papers (any pickup, not just LOT); hazmat load flag + continuous Samsara movement watch + SSE alert broadcast. |
| R27 | Permanent sequential `pickup_number`. |
| R30 | QC given inline quick-edit power on any ticket's checklist fields (no flag round-trip needed for small misses). |
| R34 | PTI-not-sent-yet follow-up log (driver called / dispatcher informed) — informational only. |
| R35 | `kpra_group` (3 real destination-based distance limits) replaces the single CA/FL boolean. |
| R36 | `mc_id` validated on ticket creation (was already validated on update). |
| R37 | **Production-incident fix**: dropped the orphaned `is_ca_fl_destination` column that R35 left with a stale `NOT NULL` constraint, which was blocking every insert on Postgres. |
| R39 | Editing a linked ticket's trailer number renames the trailer record in place instead of orphaning its saved papers. |
| R40 | Excel export honors the full date range (was silently truncating to the first day); fixed manager-specified column order. |
| R41 | Global unsaved-changes guard (`formGuardStore`) across the New Pickup form. |
| R42 | Trailer-document files moved from disk into the database as bytes (Render free-tier filesystem is ephemeral). |
| R43 | "Who had this trailer last?" info line. |
| R44 | Non-punitive Trailer Issue tracker (separate from flags, zero score impact). |
| R45 | `shift_notes.ticket_id` — "Edit Pickup" jump-link from an auto-generated note. |
| R46 | "Still using trailer XXXX?" — proactive last-pickup snapshot on truck-number entry. |
| R47 | "Last QC Approved" historical context on QC cards. |
| R48 | On-demand fuel-percentage refresh from the live fleet API (was a stale intake-time snapshot). |
| R50 | Checking the master PTI box on a LOT trailer's pickup re-stamps that trailer's `last_pti_date` to now. |
| R51 | Manager-only inline override of a ticket's linked trailer's Last PTI Date on the QC Review card, plus a "Trailer Lookup" popover surfacing a queried trailer's registered PTI date and its most recent hauling truck across the whole fleet — distinguishes a trailer genuinely new to the fleet from one merely new to the truck reviewing it. Every override is audit-logged with the old→new date. |
| R52 | New `admin` role: a strict superset of manager capability-wise, but protected *from* managers — no one but the account's own owner can edit, deactivate, delete, or change its password, and it can never be deleted at all. Optional backup-password recovery credentials (env-only, never committed). Every password change performed on someone else's account is now audit-logged and surfaced to the admin as a live toast + a persistent Security Log on the Admin page. |

---

*Generated from the source in this repository. If any statement here proves
wrong against the actual running code, trust the code and send a fix.*
