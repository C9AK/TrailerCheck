from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import admin, auth, export, feed, lookups, notes, telemetry, tickets, uploads
from app.api.routes.uploads import MEDIA_DIR
from app.core.database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience; replace with Alembic migrations for production.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Dispatch Trailer Check & QC Platform", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/api/health")
def health():
    return {"status": "ok"}
