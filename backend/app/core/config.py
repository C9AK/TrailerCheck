from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/trailercheck"
    JWT_SECRET_KEY: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Comma-separated list of allowed frontend origins for cloud deploys,
    # e.g. "https://trailercheck.vercel.app" (localhost + private-LAN origins
    # are always allowed via the CORS regex).
    FRONTEND_ORIGINS: str = ""

    # First-run bootstrap: created automatically when the users table is empty
    # so a fresh cloud database is immediately usable. CHANGE THE PASSWORD via
    # env in production. R52: this account is bootstrapped with the `admin`
    # role (not `manager`) — it's the one account meant to be protected from
    # every manager, so it should never start out as an editable manager.
    BOOTSTRAP_ADMIN_USERNAME: str = "laith"
    BOOTSTRAP_ADMIN_PASSWORD: str = "laith123!"

    # R52: recovery credentials for the `admin`-role account ONLY — a
    # deliberately separate safety net so a mistaken or malicious password
    # change (which admin.py already blocks from anyone but the account's
    # own owner, but defense in depth costs little here) can never lock the
    # real owner out. Deliberately set ONLY via environment (backend/.env,
    # gitignored, or the hosting platform's env var UI) — NEVER given a
    # real value here, since this file is committed to source control.
    # None (the default) simply disables backup-password login.
    ADMIN_BACKUP_PASSWORD_1: str | None = None
    ADMIN_BACKUP_PASSWORD_2: str | None = None

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        # Render/Heroku/Neon hand out postgres:// which SQLAlchemy no longer
        # accepts — normalize to the psycopg2 dialect.
        if isinstance(v, str):
            if v.startswith("postgres://"):
                return v.replace("postgres://", "postgresql+psycopg2://", 1)
            if v.startswith("postgresql://"):
                return v.replace("postgresql://", "postgresql+psycopg2://", 1)
        return v

    @property
    def frontend_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
