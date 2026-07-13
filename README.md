# UGL Trailer Check — Dispatch Trailer Check & QC Platform

Internal platform replacing the shared dispatch spreadsheet. This system enforces strict pickup ticket lifecycles, automates telematics tracking, and introduces a gamified Quality Control (QC) scoring engine for the dispatch team.

Specs live in [`docs/`](docs/) — the four numbered documents (plus their revision addenda) are the source of truth for all business rules, UI layouts, and database schemas.

## Table of Contents

- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start (Automated)](#quick-start-automated)
- [Manual Setup](#manual-setup)
- [Environment Variables & Secrets](#environment-variables--secrets)

## Core Features

- **Strict Ticket Lifecycle:** Forces tickets through a measured state machine (`AWAITING_DRIVER → PENDING_QC → FLAGGED/RESOLVED → APPROVED`).
- **Live Telemetry Sync:** Integrates with the Samsara API to auto-fill driver names, truck models, locations, and fuel percentages.
- **QC Auditing & Triage:** Dedicated queues for QC with media proof for flags, plus an "Urgent Flag" system for global shift visibility.
- **Automated Performance Scoring:** A mathematically weighted composite scoring engine tracking employee accuracy, speed, and volume.
- **Shift Handover Notes:** Auto-compiling task manager that grabs missing ticket items and passes them to the next shift.
- **Manager Command Center:** Features a real-time timestamped live feed, historical archives, and daily CSV exports.

## Tech Stack

- **Backend:** FastAPI (Python), SQLAlchemy 2.0, JWT Auth
- **Frontend:** Next.js 15 (App Router), Tailwind CSS v4, Zustand, Lucide React
- **Database:** PostgreSQL in production; SQLite for local dev (auto-created)

## Project Structure

```text
TrailerCheck/
├── backend/               # FastAPI server, SQLModel/Alchemy schemas, API routes
│   ├── app/               # Core application logic and services
│   └── .venv/             # Python virtual environment (gitignored)
├── frontend/              # Next.js React application
│   ├── app/               # Next.js App Router pages and layouts
│   └── components/        # Reusable UI components
├── docs/                  # Core architectural specs and business logic rules
└── run.bat                # Automated Windows deployment script
```

## Quick Start (Automated)

**Prerequisites**: You must be on a Windows machine with [Git](https://git-scm.com/) installed.

```PowerShell
git clone [https://github.com/xlaithx/TrailerCheck.git](https://github.com/xlaithx/TrailerCheck.git)
cd TrailerCheck
.\run.bat
```

`run.bat` handles everything: installs Python/Node via `winget` if missing, sets up the venv and npm packages, seeds the database, detects this machine's LAN IP and builds the frontend against it, adds firewall rules (when run as admin), and launches both servers in their own windows.

It prints the URL teammates on the same Wi-Fi can open. Re-running it restarts the app cleanly and picks up code or IP changes.

**Optional:** copy `backend\mc_tokens.json` from an existing machine for live Samsara telemetry (never committed — without it the app runs with mock truck data).

## Manual Setup (What `run.bat` automates)

If you prefer to start the servers manually or are developing on macOS/Linux, follow these steps.

#### Backend (Port 8000)

```PowerShell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# Samsara tokens (optional — without them telemetry uses mock data):
# copy mc_tokens.example.json to mc_tokens.json and fill in real tokens.

$env:DATABASE_URL = "sqlite:///./dev.db"
.venv\Scripts\python.exe -m app.scripts.seed          # test users + MCs + trailers
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

**Seeded Test Logins: - Employee:** `laith / laith123!`

- **QC:** `qc_test / qctest123!`
- **Manager:** `manager_test / manager123!`

API docs are automatically generated and available at <http://localhost:8000/docs>.

#### Frontend (Port 3000)

```PowerShell
cd frontend
npm install
npm run dev        # or: npm run build && npm run start
```

***Note:*** The API base URL is `http://localhost:8000` by default. You can override this by setting `NEXT_PUBLIC_API_URL` in your frontend environment variables.

## Environment Variables & Secrets

`backend/mc_tokens.json` (Samsara API tokens) and `backend/.env` (JWT secret, Postgres URL) are gitignored — never commit them.

For production deployment, ensure the following are configured in your server environment:

- `DATABASE_URL`: Connection string for your production PostgreSQL instance.
- `JWT_SECRET_KEY`: A secure, randomly generated string for signing auth tokens.
