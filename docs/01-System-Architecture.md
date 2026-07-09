# 01 System Architecture & Core Rules

## 1. System Overview
This is the Dispatch Trailer Check & Quality Control Platform. It replaces a shared spreadsheet with a strict, state-driven web application. 

**DO NOT HALLUCINATE FEATURES.** Stick strictly to the rules defined in this document set. Do not add generic SaaS features (like billing, social media logins, etc.) unless explicitly requested.

## 2. Tech Stack
* **Frontend:** Next.js (React), Tailwind CSS, Zustand (or Redux) for global state, Lucide React for icons.
* **Backend:** Python (FastAPI).
* **Database:** PostgreSQL (using SQLAlchemy or SQLModel).
* **Authentication:** JWT (JSON Web Tokens) with strict Username/Password login.

## 3. Role-Based Access Control (RBAC)
The system has exactly 3 roles:
1. `employee`: Can create tickets, view `Carryover Dashboard`, inline-edit missing items. Cannot approve or see QC dashboards.
2. `qc`: Can view `QC Queue`, approve tickets, and flag tickets with specific error categories.
3. `manager`: Full access. Can create/manage user accounts, view performance scorecards, configure Motor Carrier (MC) API keys.

## 4. The State Machine (Ticket Lifecycle)
A `Pickup Ticket` MUST follow these exact states (stored as an Enum in the database):
1. `DRAFT`: Being filled out.
2. `AWAITING_DRIVER`: Saved but missing information (e.g., scale ticket).
3. `PENDING_QC`: All fields completed, awaiting QC review.
4. `FLAGGED`: QC rejected it. Bounces back to the employee's dashboard.
5. `RESOLVED`: Employee fixed the flagged issue. Goes back to QC.
6. `APPROVED`: QC passed it. Terminal state.

## 5. Telemetry Integration (Multi-MC API Routing)
When an employee selects an MC and types a Truck Number, the backend must dynamically use the correct API key for that MC to fetch:
`driver_name`, `truck_location`, `truck_model`, and `fuel_percentage`.