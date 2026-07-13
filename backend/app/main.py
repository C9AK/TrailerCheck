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
    Base.metadata.create_all(bind=engine)
    _bootstrap_admin()
    yield


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
