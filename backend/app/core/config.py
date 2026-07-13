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
    # env in production.
    BOOTSTRAP_ADMIN_USERNAME: str = "laith"
    BOOTSTRAP_ADMIN_PASSWORD: str = "laith123!"

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
