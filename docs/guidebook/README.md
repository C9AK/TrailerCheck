# Guidebook — authoring source

This folder is where the two handbooks are written:

| File | What it is |
|---|---|
| `employee-guide.html` | Team Handbook — for every role |
| `qc-guide.html` | QC Auditor Handbook — QC + managers only |
| `img/` | Every screenshot both books reference (`src="img/..."`) |
| `UGL-Team-Handbook.pdf`, `UGL-QC-Handbook.pdf` | Printed copies (open the HTML in a browser → Print → Save as PDF) |

Each HTML file is a complete standalone document: open it straight from disk
and it renders, which is what makes the print-to-PDF step work.

## After editing a handbook

R53 made both books readable inside the app (**Guides** in the sidebar), and
the running app cannot read this folder — Render builds the backend with
`rootDir: backend`, and the frontend serves its own `public/`. So run:

```bash
python scripts/sync_guides.py
```

That copies the HTML to `backend/app/guides/` (served by the auth-gated
`/api/guides` route, which is what keeps the QC book away from employees) and
the screenshots to `frontend/public/guides/img/` (plain static files — the
reader rewrites the relative `img/...` paths to point there). Commit both
copies along with the edit, then redeploy.
