"""Manager live activity feed — read-only view over the immutable
live_activity_feed table. Insert-only elsewhere; no mutation endpoints exist."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.database import get_db
from app.models import LiveActivityFeed, UserRole
from app.schemas.feed import FeedEntryOut

router = APIRouter(tags=["feed"])


@router.get("/api/feed/live", response_model=list[FeedEntryOut])
def get_live_feed(
    limit: int = 150,
    db: Session = Depends(get_db),
    current_user=Depends(require_roles(UserRole.manager)),
):
    return db.scalars(
        select(LiveActivityFeed)
        .order_by(LiveActivityFeed.created_at.desc())
        .limit(min(limit, 500))
    ).all()
