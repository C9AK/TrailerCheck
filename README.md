# UGL Trailer Check — Dispatch Trailer Check & QC Platform

Internal platform replacing the shared dispatch spreadsheet: pickup ticket lifecycle
(`AWAITING_DRIVER → PENDING_QC → FLAGGED/RESOLVED → APPROVED`), live Samsara telemetry
auto-fill, QC auditing with media proof, performance scoring, shift handover notes,
manager archive/stats/live feed, and daily CSV export.

Specs live in [`docs/`](docs/) — the four numbered documents (plus their revision
addenda) are the source of truth for business rules.

## Stack

- **Backend:** FastAPI (Python), SQLAlchemy 2.0, JWT auth — `backend/`
- **Frontend:** Next.js 15 (App Router), Tailwind CSS v4, Zustand, Lucide — `frontend/`
- **Database:** PostgreSQL in production; SQLite for local dev (auto-created)

## Quick start (one command)

```powershell
git clone https://github.com/xlaithx/TrailerCheck.git
cd TrailerCheck
.\run.bat
```

`run.bat` handles everything: installs Python/Node via winget if missing, sets up
the venv and npm packages, seeds the database (manager login `laith / laith123!`),
detects this machine's LAN IP and builds the frontend against it, adds firewall
rules (when run as admin), and launches both servers in their own windows. It
prints the URL teammates on the same Wi-Fi can open. Re-running it restarts the
app cleanly and picks up code or IP changes.

Optional: copy `backend\mc_tokens.json` from an existing machine for live Samsara
telemetry (never committed — without it the app runs with mock truck data).

## Manual setup (what run.bat automates)

### Backend (port 8000)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# Samsara tokens (optional — without them telemetry uses mock data):
# copy mc_tokens.example.json to mc_tokens.json and fill in real tokens.

$env:DATABASE_URL = "sqlite:///./dev.db"
.venv\Scripts\python.exe -m app.scripts.seed          # test users + MCs + trailers
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Seeded logins: `laith / laith123!` (employee), `qc_test / qctest123!` (QC),
`manager_test / manager123!` (manager). API docs at http://localhost:8000/docs.

### Frontend (port 3000)

```powershell
cd frontend
npm install
npm run dev        # or: npm run build && npm run start
```

API base URL is `http://localhost:8000` by default (`NEXT_PUBLIC_API_URL` to override).

## Secrets

`backend/mc_tokens.json` (Samsara API tokens) and `backend/.env` (JWT secret,
Postgres URL) are gitignored — never commit them. For production, set
`DATABASE_URL` and `JWT_SECRET_KEY` via environment.
