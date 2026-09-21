"""R53: copy the authored handbooks out to the two places the running app
serves them from.

The authoring source of truth stays `docs/guidebook/` (the HTML files and
their screenshots live side by side there, which is what makes the local
"open it in a browser and print to PDF" workflow work). The deployed app
cannot read that folder:

  * Render builds the backend with `rootDir: backend`, so anything outside
    `backend/` simply isn't there — the HTML is copied to
    `backend/app/guides/`, where the auth-gated /api/guides route reads it.
  * The screenshots are served as plain static files by the frontend (CDN,
    no cold start, no 3 MB through the free-tier backend), so they're
    copied to `frontend/public/guides/img/`.

Run this after editing either handbook:

    python scripts/sync_guides.py
"""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "guidebook"
HTML_DEST = ROOT / "backend" / "app" / "guides"
IMG_DEST = ROOT / "frontend" / "public" / "guides" / "img"

HTML_FILES = ("employee-guide.html", "qc-guide.html")


def main() -> None:
    HTML_DEST.mkdir(parents=True, exist_ok=True)
    IMG_DEST.mkdir(parents=True, exist_ok=True)

    for name in HTML_FILES:
        shutil.copy2(SOURCE / name, HTML_DEST / name)
        print(f"html  -> {(HTML_DEST / name).relative_to(ROOT)}")

    count = 0
    for image in sorted((SOURCE / "img").iterdir()):
        if image.is_file():
            shutil.copy2(image, IMG_DEST / image.name)
            count += 1
    print(f"img   -> {IMG_DEST.relative_to(ROOT)} ({count} screenshots)")


if __name__ == "__main__":
    main()
