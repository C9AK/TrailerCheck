from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# pool_pre_ping: verify a pooled connection is alive before every checkout so
# an idle-dropped connection is transparently replaced instead of timing out.
# pool_recycle: retire connections after 30 min — safely under the idle kill
# windows of managed Postgres (Render/Neon) and LAN firewalls.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
