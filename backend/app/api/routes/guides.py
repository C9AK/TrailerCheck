"""R53: the handbooks, readable inside the app.

Both guidebooks (`docs/guidebook/*.html`, copied here by
`scripts/sync_guides.py`) are complete standalone documents. They are served
as data — the HTML body in a JSON envelope — rather than as a static mount,
because access is role-dependent: the QC Auditor Handbook documents how
audits are scored and when a flag is raised, so it is limited to the people
who actually run the queue (qc + manager/admin). The Team Handbook is for
everyone.

The screenshots those documents reference are NOT served here. They are
plain static files on the frontend (`/guides/img/...`), which keeps ~3 MB of
JPEGs off the free-tier backend entirely; the frontend rewrites the relative
`img/` paths before rendering. The text of the handbook is the part worth
gating — a screenshot of a form is not.
"""

from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.models import MANAGER_ROLES, User, UserRole

router = APIRouter(prefix="/api/guides", tags=["guides"])

GUIDES_DIR = Path(__file__).resolve().parents[2] / "guides"

# R52's MANAGER_ROLES keeps admin in every manager-level audience for free.
EVERYONE = (UserRole.employee, UserRole.qc, *MANAGER_ROLES)
QC_AND_UP = (UserRole.qc, *MANAGER_ROLES)


@dataclass(frozen=True)
class Guide:
    slug: str
    title: str
    subtitle: str
    audience: str
    filename: str
    roles: tuple[UserRole, ...]


GUIDES: tuple[Guide, ...] = (
    Guide(
        slug="team-handbook",
        title="Team Handbook",
        subtitle=(
            "Everything you do in Trailer Check, in the order you'll do it — from "
            "signing in to getting a pickup past QC."
        ),
        audience="Everyone",
        filename="employee-guide.html",
        roles=EVERYONE,
    ),
    Guide(
        slug="qc-handbook",
        title="QC Auditor Handbook",
        subtitle=(
            "How to work the review queue: what every field on a card means, when "
            "to fix it yourself, when to flag, and the rules that stop you auditing "
            "your own work."
        ),
        audience="QC & managers",
        filename="qc-guide.html",
        roles=QC_AND_UP,
    ),
)

BY_SLUG = {g.slug: g for g in GUIDES}

# Read once per process, then serve from memory — the files are static for the
# life of a deploy and together weigh ~150 KB.
_cache: dict[str, str] = {}


def _html(guide: Guide) -> str:
    if guide.slug not in _cache:
        path = GUIDES_DIR / guide.filename
        if not path.is_file():
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    f"Guide file '{guide.filename}' is missing from the deploy — "
                    "run scripts/sync_guides.py and redeploy."
                ),
            )
        _cache[guide.slug] = path.read_text(encoding="utf-8")
    return _cache[guide.slug]


def _summary(guide: Guide) -> dict:
    return {
        "slug": guide.slug,
        "title": guide.title,
        "subtitle": guide.subtitle,
        "audience": guide.audience,
    }


@router.get("")
def list_guides(current_user: User = Depends(get_current_user)) -> list[dict]:
    """Only the handbooks this user may open — the QC one never even appears
    in an employee's list, so there is nothing to click and be refused."""
    return [_summary(g) for g in GUIDES if current_user.role in g.roles]


@router.get("/{slug}")
def read_guide(slug: str, current_user: User = Depends(get_current_user)) -> dict:
    guide = BY_SLUG.get(slug)
    if guide is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No such guide"
        )
    if current_user.role not in guide.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This handbook is for QC and managers only.",
        )
    return {**_summary(guide), "html": _html(guide)}
