# Kartavaya — Deployment

by Aekam Inc · rewritten 2026-08-16. The previous version of this file described
MongoDB Atlas and Create React App — a stack this product has not used in its
current form at all. If a step below disagrees with the dashboards, the
dashboards win; update this file when they do.

## Repo

https://github.com/kevalvshah/Kartavya — two branches only. `staging` is where
work happens and what staging.kartavaya.com serves; `main` is production.
**Production is far behind staging** (1,144+ commits as of 2026-08-08) and a
production release is an open, unscheduled piece of work — see TASKS.md.

## Stack

| Piece | Where | Notes |
|---|---|---|
| Frontend | Vercel (Vite + React, `frontend/`) | Hobby account — the licence problem and the planned Cloudflare Pages move are `docs/CLOUDFLARE-MIGRATION.md`; dates lapsed, plan stands |
| Backend | Railway (`backend/`, FastAPI + asyncpg) | staging service watches `backend/**`; sleep staging when idle — the bill is always-on compute, not egress |
| Database | Supabase Postgres, Singapore — **permanently** | ONE database for staging AND production; only `staging` + `public` schemas exist. Every migration touches production data |
| Files | Cloudflare R2, presigned URLs | |
| Email | Resend (staging, Tokyo) · SES quota exists | ten purpose addresses on unicodegroup.com forwarding to keval.shah@ |
| Mobile | Local APK via `bash mobile/scripts/build-apk.sh release` | not EAS (1 GB archive, multi-hour queue); debug APKs carry no JS bundle |
| Crons | Railway `cron-daily` + grouped services, auth via `CRON_SECRET` | `/cron/reports` and `/cron/esign` are 501 stubs — never arm them |
| Pay page | `pay.kartavaya.com` → **staging** branch on Vercel | deliberate: production has no `/i/:token` route; staging and production share the data anyway |

## The rules that prevent incidents

- **Never test write paths against the live DB** — it is production's data. Confirm
  the deployed SHA (`meta.branch`) before trusting any live probe.
- **`vercel.json` accepts no comments.** A `"//"` key kills the deploy before the
  build starts, with no logs, and the site silently stays on the old build.
- Migrations: state write-path side effects and risks BEFORE applying; the
  migration ledger in `backend/migrations/README.md` is historical — trust the
  live catalog.
- Frontend deploys: run `npm run build` locally first — `npm run check` exits 0
  on CSS the browser rejects.
- Domain is **kartavaya.com** (not kartavya.com); DNS currently lives on
  Vercel's nameservers (wildcard zone — see the Cloudflare plan before touching it).
