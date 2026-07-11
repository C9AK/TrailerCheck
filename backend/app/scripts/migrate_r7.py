"""One-shot in-place SQLite migration for revision R7.

- pickup_tickets: drop tires_inspected; weight REAL -> TEXT (values preserved)
- audit_logs + live_activity_feed: rebuilt so ticket_id is nullable (audit_logs)
  and the event CHECK constraint includes TICKET_DELETED

Run from backend/:  python -m app.scripts.migrate_r7
A backup is written to dev.db.bak-r7 before anything is touched.
"""

import shutil
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[2] / "dev.db"
BACKUP = DB.with_name("dev.db.bak-r7")


def main() -> None:
    if not DB.exists():
        print(f"{DB} not found — nothing to migrate (a fresh DB gets the new schema automatically).")
        return

    shutil.copy2(DB, BACKUP)
    print(f"backup: {BACKUP}")

    con = sqlite3.connect(DB)
    cur = con.cursor()

    cols = [r[1] for r in cur.execute("PRAGMA table_info(pickup_tickets)").fetchall()]

    if "tires_inspected" in cols:
        cur.execute("ALTER TABLE pickup_tickets DROP COLUMN tires_inspected")
        print("dropped pickup_tickets.tires_inspected")

    # weight REAL -> TEXT with clean integer formatting ("35000", not "35000.0")
    weight_type = next(
        (r[2] for r in cur.execute("PRAGMA table_info(pickup_tickets)").fetchall() if r[1] == "weight"),
        "",
    )
    if weight_type.upper() != "VARCHAR(100)":
        cur.execute("ALTER TABLE pickup_tickets ADD COLUMN weight_txt VARCHAR(100)")
        cur.execute(
            """UPDATE pickup_tickets SET weight_txt = CASE
                 WHEN weight IS NULL THEN NULL
                 WHEN CAST(weight AS INTEGER) = weight THEN CAST(CAST(weight AS INTEGER) AS TEXT)
                 ELSE CAST(weight AS TEXT)
               END"""
        )
        cur.execute("ALTER TABLE pickup_tickets DROP COLUMN weight")
        cur.execute("ALTER TABLE pickup_tickets RENAME COLUMN weight_txt TO weight")
        print("converted pickup_tickets.weight to TEXT")

    # Rebuild the two event tables (new enum value + nullable audit ticket_id)
    cur.execute("ALTER TABLE audit_logs RENAME TO audit_logs_old")
    cur.execute("ALTER TABLE live_activity_feed RENAME TO live_activity_feed_old")
    # Renames keep index names attached to the old tables — drop them so
    # create_all can recreate identically-named indexes on the new tables.
    stale = [
        r[0]
        for r in cur.execute(
            """SELECT name FROM sqlite_master WHERE type = 'index'
               AND tbl_name IN ('audit_logs_old', 'live_activity_feed_old')
               AND name NOT LIKE 'sqlite_%'"""
        ).fetchall()
    ]
    for name in stale:
        cur.execute(f'DROP INDEX "{name}"')
    con.commit()
    con.close()

    # Let SQLAlchemy create the fresh tables from the current models
    from app.core.database import Base, engine
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute(
        """INSERT INTO audit_logs (id, ticket_id, actor_id, event, created_at)
           SELECT id, ticket_id, actor_id, event, created_at FROM audit_logs_old"""
    )
    cur.execute(
        """INSERT INTO live_activity_feed
             (id, ticket_id, event, actor_id, actor_username, employee_username,
              truck_number, mc_name, message, created_at)
           SELECT id, ticket_id, event, actor_id, actor_username, employee_username,
              truck_number, mc_name, message, created_at FROM live_activity_feed_old"""
    )
    cur.execute("DROP TABLE audit_logs_old")
    cur.execute("DROP TABLE live_activity_feed_old")
    con.commit()

    n_logs = cur.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
    n_feed = cur.execute("SELECT COUNT(*) FROM live_activity_feed").fetchone()[0]
    n_tickets = cur.execute("SELECT COUNT(*) FROM pickup_tickets").fetchone()[0]
    con.close()
    print(f"migrated: {n_tickets} tickets, {n_logs} audit logs, {n_feed} feed entries preserved")
    print("R7 migration complete.")


if __name__ == "__main__":
    main()
