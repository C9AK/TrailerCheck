import asyncio
import traceback
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    admin,
    alerts,
    auth,
    export,
    feed,
    leaderboard,
    lookups,
    notes,
    telemetry,
    tickets,
    trailers,
    uploads,
)
from app.api.routes.uploads import MEDIA_DIR
from app.core.database import Base, engine
from app.services.hazmat_monitor import hazmat_monitor_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience; replace with Alembic migrations for production.
    _migrate_feed_ticket_nullable()
    _migrate_r17()
    _migrate_r21()
    _migrate_r22()
    _migrate_r23()
    _migrate_r25()
    _migrate_r27()
    _migrate_r34()
    Base.metadata.create_all(bind=engine)
    _bootstrap_admin()
    # R25: continuous Samsara movement watch for hazmat loads
    monitor_task = asyncio.create_task(hazmat_monitor_loop())
    yield
    monitor_task.cancel()
    with suppress(asyncio.CancelledError):
        await monitor_task


def _migrate_r17() -> None:
    """R17 in-place migration: DRAFT_IN_PROGRESS enum value (native type on
    Postgres) + eld_mentioned/checklist_sent columns. Idempotent; no-op on a
    fresh database (create_all builds everything correctly)."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    if engine.dialect.name == "postgresql":
        # ADD VALUE is allowed inside a transaction on PG 12+, but AUTOCOMMIT
        # keeps it safe regardless of server version.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(
                text("ALTER TYPE ticket_state ADD VALUE IF NOT EXISTS 'DRAFT_IN_PROGRESS'")
            )

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    false_lit = "FALSE" if engine.dialect.name == "postgresql" else "0"
    with engine.begin() as conn:
        for col in ("eld_mentioned", "checklist_sent"):
            if col not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE pickup_tickets ADD COLUMN {col} "
                        f"BOOLEAN NOT NULL DEFAULT {false_lit}"
                    )
                )
                print(f"R17 migration: added pickup_tickets.{col}")


def _migrate_r21() -> None:
    """R21 in-place migration: last_followed_up_at column (nullable timestamp)
    on pickup_tickets. Idempotent; no-op on a fresh database."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    if "last_followed_up_at" not in cols:
        col_type = "TIMESTAMPTZ" if engine.dialect.name == "postgresql" else "DATETIME"
        with engine.begin() as conn:
            conn.execute(
                text(f"ALTER TABLE pickup_tickets ADD COLUMN last_followed_up_at {col_type}")
            )
        print("R21 migration: added pickup_tickets.last_followed_up_at")


def _migrate_r22() -> None:
    """R22 in-place migration: auto_note_generated flag on pickup_tickets
    (one-shot consolidated auto shift-note). Idempotent; no-op on a fresh DB."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    if "auto_note_generated" not in cols:
        false_lit = "FALSE" if engine.dialect.name == "postgresql" else "0"
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE pickup_tickets ADD COLUMN auto_note_generated "
                    f"BOOLEAN NOT NULL DEFAULT {false_lit}"
                )
            )
        print("R22 migration: added pickup_tickets.auto_note_generated")


def _migrate_r23() -> None:
    """R23 in-place migration: is_dropped flag on pickup_tickets + the
    TICKET_DROPPED audit-event value (native enum on Postgres; SQLite stores
    enums as plain VARCHAR — no change needed). Idempotent."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    if engine.dialect.name == "postgresql":
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(
                text("ALTER TYPE audit_event ADD VALUE IF NOT EXISTS 'TICKET_DROPPED'")
            )

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    if "is_dropped" not in cols:
        false_lit = "FALSE" if engine.dialect.name == "postgresql" else "0"
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE pickup_tickets ADD COLUMN is_dropped "
                    f"BOOLEAN NOT NULL DEFAULT {false_lit}"
                )
            )
        print("R23 migration: added pickup_tickets.is_dropped")


def _migrate_r25() -> None:
    """R25 in-place migration: is_hazmat flag on pickup_tickets (Samsara
    movement watch). The trailer_documents table itself is additive and
    created by create_all. Idempotent; no-op on a fresh database."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    if "is_hazmat" not in cols:
        false_lit = "FALSE" if engine.dialect.name == "postgresql" else "0"
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE pickup_tickets ADD COLUMN is_hazmat "
                    f"BOOLEAN NOT NULL DEFAULT {false_lit}"
                )
            )
        print("R25 migration: added pickup_tickets.is_hazmat")


def _migrate_r27() -> None:
    """R27 in-place migration: pickup_number column + backfill of every
    unnumbered ticket in creation order (continuing after the current max so
    a partial backfill never double-assigns). Idempotent."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    with engine.begin() as conn:
        if "pickup_number" not in cols:
            conn.execute(
                text("ALTER TABLE pickup_tickets ADD COLUMN pickup_number INTEGER")
            )
            print("R27 migration: added pickup_tickets.pickup_number")
        start = (
            conn.execute(
                text("SELECT COALESCE(MAX(pickup_number), 0) FROM pickup_tickets")
            ).scalar()
            or 0
        )
        rows = conn.execute(
            text(
                "SELECT id FROM pickup_tickets WHERE pickup_number IS NULL "
                "ORDER BY created_at"
            )
        ).fetchall()
        for offset, (ticket_id,) in enumerate(rows, start=1):
            conn.execute(
                text(
                    "UPDATE pickup_tickets SET pickup_number = :n WHERE id = :id"
                ),
                {"n": start + offset, "id": ticket_id},
            )
        if rows:
            print(f"R27 migration: numbered {len(rows)} existing pickup(s)")


def _migrate_r34() -> None:
    """R34 in-place migration: pti_driver_called + pti_dispatcher_informed
    columns on pickup_tickets — the "PTI wasn't sent yet" follow-up log.
    Idempotent; no-op on a fresh database."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "pickup_tickets" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("pickup_tickets")}
    false_lit = "FALSE" if engine.dialect.name == "postgresql" else "0"
    with engine.begin() as conn:
        for col in ("pti_driver_called", "pti_dispatcher_informed"):
            if col not in cols:
                conn.execute(
                    text(
                        f"ALTER TABLE pickup_tickets ADD COLUMN {col} "
                        f"BOOLEAN NOT NULL DEFAULT {false_lit}"
                    )
                )
                print(f"R34 migration: added pickup_tickets.{col}")


def _migrate_feed_ticket_nullable() -> None:
    """R14 in-place migration: live_activity_feed.ticket_id becomes nullable
    so feed history survives ticket deletion (rows are detached, never
    destroyed). Runs on every boot; no-op once applied or on a fresh DB.
    Must run BEFORE create_all (the SQLite path rebuilds the table)."""
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    insp = sa_inspect(engine)
    if "live_activity_feed" not in insp.get_table_names():
        return  # fresh database — create_all builds it correctly
    ticket_col = next(
        c for c in insp.get_columns("live_activity_feed") if c["name"] == "ticket_id"
    )
    if ticket_col["nullable"]:
        return  # already migrated

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE live_activity_feed ALTER COLUMN ticket_id DROP NOT NULL")
            )
        print("R14 migration: live_activity_feed.ticket_id is now nullable (postgres)")
        return

    # SQLite can't relax NOT NULL in place — rebuild the table: rename old,
    # drop its carried-over indexes (they keep their names and would collide),
    # create the new table from the model, copy rows, drop old.
    cols = (
        "id, ticket_id, event, actor_id, actor_username, employee_username, "
        "truck_number, mc_name, message, created_at"
    )
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE live_activity_feed RENAME TO live_activity_feed_r14_old")
        )
        stale = conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='live_activity_feed_r14_old' AND name NOT LIKE 'sqlite_%'"
            )
        ).scalars().all()
        for name in stale:
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
        Base.metadata.tables["live_activity_feed"].create(bind=conn)
        conn.execute(
            text(
                f"INSERT INTO live_activity_feed ({cols}) "
                f"SELECT {cols} FROM live_activity_feed_r14_old"
            )
        )
        conn.execute(text("DROP TABLE live_activity_feed_r14_old"))
    print("R14 migration: live_activity_feed rebuilt with nullable ticket_id (sqlite)")


def _bootstrap_admin() -> None:
    """Fresh database (e.g. first cloud deploy): create the bootstrap manager
    so the Admin page is reachable. No-op once any user exists."""
    from sqlalchemy import func, select

    from app.core.config import settings
    from app.core.database import SessionLocal
    from app.core.security import hash_password
    from app.models import User, UserRole

    with SessionLocal() as db:
        if (db.scalar(select(func.count()).select_from(User)) or 0) == 0:
            db.add(
                User(
                    username=settings.BOOTSTRAP_ADMIN_USERNAME,
                    password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                    role=UserRole.manager,
                )
            )
            db.commit()
            print(
                f"Bootstrapped manager account '{settings.BOOTSTRAP_ADMIN_USERNAME}' "
                "(set BOOTSTRAP_ADMIN_PASSWORD in production!)"
            )


app = FastAPI(title="Dispatch Trailer Check & QC Platform", lifespan=lifespan)

from app.core.config import settings  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    # Cloud frontend origins (e.g. the Vercel URL) come from FRONTEND_ORIGINS
    allow_origins=["http://localhost:3000", *settings.frontend_origins],
    # Allow the frontend when served over the LAN (private address ranges)
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Unhandled crashes bypass CORSMiddleware, so the browser hides the 500 and
# the frontend misreads it as a network error ("waking up" retry loop).
# Echo the Origin here so real 500s surface as "Request failed (500)".
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    traceback.print_exception(exc)
    headers = {}
    origin = request.headers.get("origin")
    if origin:
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error — check the backend logs."},
        headers=headers,
    )


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(telemetry.router)
app.include_router(lookups.router)
app.include_router(trailers.router)
app.include_router(alerts.router)
app.include_router(tickets.router)
app.include_router(uploads.router)
app.include_router(feed.router)
app.include_router(export.router)
app.include_router(notes.router)
app.include_router(leaderboard.router)

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/api/health")
def health():
    return {"status": "ok"}
