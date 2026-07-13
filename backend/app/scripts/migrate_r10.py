"""In-place SQLite migration for revision R11 (script r10 in sequence).

- pickup_tickets gains is_unresolvable (bool, default 0) and
  unresolvable_reason (TEXT).
- audit_logs + live_activity_feed rebuilt so their event CHECK constraints
  include TICKET_UNRESOLVABLE (all rows preserved).

Run from backend/:  python -m app.scripts.migrate_r10
"""

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[2] / "dev.db"


def main() -> None:
    if not DB.exists():
        print(f"{DB} not found — nothing to migrate.")
        return
    con = sqlite3.connect(DB)
    cur = con.cursor()

    cols = [r[1] for r in cur.execute("PRAGMA table_info(pickup_tickets)").fetchall()]
    if "is_unresolvable" in cols:
        print("R11 already applied.")
        con.close()
        return

    cur.execute(
        "ALTER TABLE pickup_tickets ADD COLUMN is_unresolvable BOOLEAN NOT NULL DEFAULT 0"
    )
    cur.execute("ALTER TABLE pickup_tickets ADD COLUMN unresolvable_reason TEXT")

    # Rebuild event tables for the new enum value in their CHECK constraints
    cur.execute("ALTER TABLE audit_logs RENAME TO audit_logs_old")
    cur.execute("ALTER TABLE live_activity_feed RENAME TO live_activity_feed_old")
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
    con.close()
    print(f"R11 migration complete — {n_logs} audit logs, {n_feed} feed entries preserved.")


if __name__ == "__main__":
    main()
