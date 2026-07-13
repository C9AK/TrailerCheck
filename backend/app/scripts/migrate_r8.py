"""Additive in-place SQLite migration for revision R8.

pickup_tickets gains: pti_checklist (JSON), is_urgent_flag (bool, default 0),
resolved_by (UUID, nullable). Existing data untouched.

Run from backend/:  python -m app.scripts.migrate_r8
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
    added = []
    if "pti_checklist" not in cols:
        cur.execute("ALTER TABLE pickup_tickets ADD COLUMN pti_checklist JSON")
        added.append("pti_checklist")
    if "is_urgent_flag" not in cols:
        cur.execute(
            "ALTER TABLE pickup_tickets ADD COLUMN is_urgent_flag BOOLEAN NOT NULL DEFAULT 0"
        )
        added.append("is_urgent_flag")
    if "resolved_by" not in cols:
        cur.execute("ALTER TABLE pickup_tickets ADD COLUMN resolved_by CHAR(32)")
        added.append("resolved_by")
    con.commit()
    con.close()
    print(f"R8 migration complete. Added: {', '.join(added) or 'nothing (already applied)'}")


if __name__ == "__main__":
    main()
