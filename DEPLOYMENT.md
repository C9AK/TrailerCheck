# Deploying UGL Trailer Check to the public internet

The app has two halves that deploy to two (free-tier) services:

| Piece | Where | Why |
|---|---|---|
| Frontend (Next.js) | **Vercel** | Native Next.js hosting |
| Backend (FastAPI) + PostgreSQL | **Render** | Vercel cannot run a persistent Python server or database |

Total setup time: ~15 minutes. Both platforms auto-redeploy on every push to `main`.

## 1. Backend + database on Render

1. Create an account at https://render.com (sign in with GitHub).
2. Click **New + → Blueprint**, connect the `LAEK-Soft/TrailerCheck` repo.
   Render reads `render.yaml` and provisions:
   - `trailercheck-api` — the FastAPI web service
   - `trailercheck-db` — a managed PostgreSQL database (free plan)
3. When prompted for env values:
   - `BOOTSTRAP_ADMIN_PASSWORD`: pick a **strong** password. On first boot the
     server creates the manager account `laith` with it (only when the
     database is empty).
   - Leave `FRONTEND_ORIGINS` as the placeholder for now — you'll set the real
     Vercel URL in step 3.
4. Deploy. Note your API URL, e.g. `https://trailercheck-api.onrender.com`
   (verify `https://.../api/health` returns `{"status":"ok"}`).
5. Add the Samsara MCs from the **Admin page** after first login (Admin → Motor
   Carriers), or temporarily commit-free: use the same names/endpoint
   `https://api.samsara.com` and paste each token. Tokens live only in the
   database.

## 2. Frontend on Vercel

1. Create an account at https://vercel.com (sign in with GitHub).
2. **Add New → Project**, import `LAEK-Soft/TrailerCheck`.
3. Settings before the first deploy:
   - **Root Directory:** `frontend`
   - **Environment variable:** `NEXT_PUBLIC_API_URL` = your Render API URL
     (e.g. `https://trailercheck-api.onrender.com`) — no trailing slash.
4. Deploy. Your app is live at `https://<project>.vercel.app`.

## 3. Connect the two

Back in Render → `trailercheck-api` → Environment: set `FRONTEND_ORIGINS` to
your exact Vercel URL (e.g. `https://trailercheck.vercel.app`). Save — Render
redeploys and CORS now admits the public frontend.

## Post-deploy checklist

- [ ] Log in as `laith` + your `BOOTSTRAP_ADMIN_PASSWORD`, create real accounts
      in Admin, and never share the bootstrap password.
- [ ] Add the Motor Carriers + Samsara tokens via Admin.
- [ ] LOT trailers: create tickets normally — unknown trailers auto-register.

## Known free-tier limitations

- **Render free services sleep** after ~15 min idle; the first request after
  a sleep takes ~30-60 s to wake. Paid plan ($7/mo) removes this.
- **Uploaded flag media is ephemeral** on Render's free filesystem — files are
  lost on redeploy/restart (the flag records and notes remain). Durable media
  needs S3/Cloudinary wiring — ask when it matters.
- **Render free Postgres expires after 90 days** — upgrade the DB plan or
  migrate to https://neon.tech (free, no expiry): create a Neon project, copy
  its connection string into `DATABASE_URL` on the Render service.

## Local development is unchanged

`run.bat` still runs everything locally on SQLite; the office LAN setup keeps
working exactly as before.
