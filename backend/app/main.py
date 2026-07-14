from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    admin,
    auth,
    export,
    feed,
    leaderboard,
    lookups,
    notes,
    telemetry,
    tickets,
    uploads,
)
from app.api.routes.uploads import MEDIA_DIR
from app.core.database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience; replace with Alembic migrations for production.
    _migrate_feed_ticket_nullable()
    Base.metadata.create_all(bind=engine)
    _bootstrap_admin()
    yield


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

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(telemetry.router)
app.include_router(lookups.router)
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
