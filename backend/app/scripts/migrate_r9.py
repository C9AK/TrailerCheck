"""Additive in-place SQLite migration for revision R9.

pickup_tickets gains submitted_to_qc_at, backfilled from the audit log
(earliest TICKET_SENT_TO_QC event) or created_at for tickets that went
straight to QC, so historical efficiency data isn't lost.

Run from backend/:  python -m app.scripts.migrate_r9
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
    if "submitted_to_qc_at" in cols:
        print("R9 already applied.")
        con.close()
        return

    cur.execute("ALTER TABLE pickup_tickets ADD COLUMN submitted_to_qc_at DATETIME")
    # Backfill 1: promotion via PATCH -> earliest TICKET_SENT_TO_QC audit event
    cur.execute(
        """UPDATE pickup_tickets SET submitted_to_qc_at = (
               SELECT MIN(a.created_at) FROM audit_logs a
               WHERE a.ticket_id = pickup_tickets.id AND a.event = 'TICKET_SENT_TO_QC')
           WHERE submitted_to_qc_at IS NULL"""
    )
    # Backfill 2: tickets that reached QC some other way -> created_at
    cur.execute(
        """UPDATE pickup_tickets SET submitted_to_qc_at = created_at
           WHERE submitted_to_qc_at IS NULL
             AND state IN ('PENDING_QC', 'FLAGGED', 'RESOLVED', 'APPROVED')"""
    )
    con.commit()
    n = cur.execute(
        "SELECT COUNT(*) FROM pickup_tickets WHERE submitted_to_qc_at IS NOT NULL"
    ).fetchone()[0]
    con.close()
    print(f"R9 migration complete — submitted_to_qc_at added, {n} ticket(s) backfilled.")


if __name__ == "__main__":
    main()
