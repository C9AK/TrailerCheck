"""Reset operational data for a fresh testing phase — KEEPS all user
accounts (scores reset to 100), Motor Carriers, and trailers.

Wipes: tickets, QC flags + media records, audit logs, live feed, shift
notes, and uploaded media files EXCEPT trailer papers (R25's
trailer_documents rows are deliberately kept alongside trailers, so their
backing files must survive the media wipe too — otherwise the row lives on
pointing at a file that's gone, and clicking it 404s).

Run from backend/:  python -m app.scripts.reset_data
"""

from pathlib import Path

from sqlalchemy import delete, select, update

from app.core.database import SessionLocal
from app.models import (
    AuditLog,
    FlagMedia,
    LiveActivityFeed,
    PickupTicket,
    QCAuditFlag,
    ShiftNote,
    TrailerDocument,
    User,
)

MEDIA_DIR = Path(__file__).resolve().parents[2] / "media"


def reset() -> None:
    db = SessionLocal()
    try:
        # R25: trailer_documents (and the trailers they belong to) are kept
        # by this reset — collect their backing filenames BEFORE wiping
        # media so those files aren't deleted out from under the surviving
        # rows.
        keep_names = {
            url.rsplit("/", 1)[-1]
            for (url,) in db.execute(select(TrailerDocument.media_url)).all()
            if url.startswith("/media/")
        }

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
        kept = 0
        for f in MEDIA_DIR.iterdir():
            if not f.is_file():
                continue
            if f.name in keep_names:
                kept += 1
                continue
            f.unlink()
            removed += 1
        print(f"cleared media uploads: {removed} file(s) (kept {kept} trailer-paper file(s))")
    print("Reset complete.")


if __name__ == "__main__":
    reset()
