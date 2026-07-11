"""Dev seed data. Run from backend/:  python -m app.scripts.seed

Samsara API tokens are loaded from backend/mc_tokens.json (gitignored — see
mc_tokens.example.json for the shape). Without that file, MCs are seeded with
placeholder tokens and telemetry falls back to mock data.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models import MotorCarrier, Trailer, User, UserRole

# Single bootstrap manager — all other accounts are created in-app via
# the Admin page (/dashboard/admin).
SEED_USERS = [
    ("laith", "laith123!", UserRole.manager),
]

SAMSARA_ENDPOINT = "https://api.samsara.com"

TOKENS_FILE = Path(__file__).resolve().parents[2] / "mc_tokens.json"

_FALLBACK_MC_NAMES = [
    "AL Amin", "Lion's Head", "Abbas Corp", "Adomy", "Tuba",
    "Turon", "SSA Cargo", "HS Transportation", "BMH",
]


def _load_seed_mcs() -> list[tuple[str, str, str]]:
    """(name, api_token, org_id). org_id is informational only — Samsara
    tokens are org-scoped, so API calls need just the token."""
    if TOKENS_FILE.exists():
        data = json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
        return [
            (name, entry["api_token"], entry.get("org_id", ""))
            for name, entry in data.items()
        ]
    print(
        f"WARNING: {TOKENS_FILE} not found — seeding MCs with placeholder tokens "
        "(telemetry will use mock data). Copy mc_tokens.example.json to mc_tokens.json."
    )
    return [(name, "REPLACE_ME", "") for name in _FALLBACK_MC_NAMES]


SEED_MCS = _load_seed_mcs()

now = datetime.now(timezone.utc)
SEED_TRAILERS = [
    # (number, last_pti_date, is_lot) — one fresh (<7d), one stale (>=7d)
    ("LOT-1001", now - timedelta(days=2), True),
    ("LOT-1002", now - timedelta(days=12), True),
    ("TRL-2001", now - timedelta(days=1), False),
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for username, password, role in SEED_USERS:
            if not db.scalar(select(User).where(User.username == username)):
                db.add(User(username=username, password_hash=hash_password(password), role=role))
                print(f"user: {username} / {password} ({role.value})")
        for name, token, _org_id in SEED_MCS:
            if not db.scalar(select(MotorCarrier).where(MotorCarrier.name == name)):
                db.add(MotorCarrier(name=name, api_endpoint=SAMSARA_ENDPOINT, api_key=token))
                print(f"mc: {name}")
        for number, pti_date, is_lot in SEED_TRAILERS:
            if not db.scalar(select(Trailer).where(Trailer.trailer_number == number)):
                db.add(Trailer(trailer_number=number, last_pti_date=pti_date, is_lot_trailer=is_lot))
                print(f"trailer: {number} (pti {pti_date.date()}, lot={is_lot})")
        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
