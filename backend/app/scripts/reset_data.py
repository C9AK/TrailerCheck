"""Reset operational data for a fresh testing phase — KEEPS all user
accounts (scores reset to 100), Motor Carriers, and trailers.

Wipes: tickets, QC flags + media records, audit logs, live feed, shift
notes, and uploaded media files.

Run from backend/:  python -m app.scripts.reset_data
"""

from pathlib import Path

from sqlalchemy import delete, update

from app.core.database import SessionLocal
from app.models import (
    AuditLog,
    FlagMedia,
    LiveActivityFeed,
    PickupTicket,
    QCAuditFlag,
    ShiftNote,
    User,
)

MEDIA_DIR = Path(__file__).resolve().parents[2] / "media"


def reset() -> None:
    db = SessionLocal()
    try:
        # FK-safe order: children before parents
        for model in (FlagMedia, QCAuditFlag, LiveActivityFeed, AuditLog, ShiftNote, PickupTicket):
            count = db.execute(delete(model)).rowcount
            print(f"cleared {model.__tablename__}: {count} row(s)")
        db.execute(update(User).values(performance_score=100))
        db.commit()
        print("performance scores reset to 100 (accounts kept)")
    finally:
        db.close()

    if MEDIA_DIR.exists():
        removed = 0
        for f in MEDIA_DIR.iterdir():
            if f.is_file():
                f.unlink()
                removed += 1
        print(f"cleared media uploads: {removed} file(s)")
    print("Reset complete.")


if __name__ == "__main__":
    reset()
