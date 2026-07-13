"""Additive in-place SQLite migration for revision R12.

pickup_tickets gains is_chassis (bool, default 0).

Run from backend/:  python -m app.scripts.migrate_r11
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
    if "is_chassis" in cols:
        print("R12 already applied.")
    else:
        cur.execute(
            "ALTER TABLE pickup_tickets ADD COLUMN is_chassis BOOLEAN NOT NULL DEFAULT 0"
        )
        con.commit()
        print("R12 migration complete — is_chassis added.")
    con.close()


if __name__ == "__main__":
    main()
