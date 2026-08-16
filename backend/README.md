# backend/

FastAPI application. Deployed on Railway. Python 3.11+.

## Entry point

`server.py` — app factory, middleware, and router mounts only.
It should stay thin. **No route logic lives here.** If you are adding
a new endpoint, add it to the correct file in `routers/` and mount
the router at the bottom of `server.py`.

## Folder map

```
backend/
├── server.py               ← app setup + router mounts (touch when: adding a new router, changing CORS, changing middleware)
├── auth_router.py          ← /auth/* routes + require_user / require_admin deps (touch when: changing auth flow, JWT config, cookie behaviour)
├── approvals_router.py     ← /approvals/* routes (touch when: changing approval workflow logic)
├── invite_router.py        ← /invite/* routes (touch when: changing invitation flow)
├── health.py               ← GET /health (touch when: adding readiness checks)
├── db.py                   ← asyncpg connection pool (touch when: changing DB URL handling or pool settings)
├── email_service.py        ← AWS SES email sending + all email templates (touch when: adding a new email type or changing templates)
├── cors_config.py          ← CORS origin list helper (touch when: adding a new frontend deploy URL)
├── storage.py              ← Legacy base64 storage shim (superseded by services/storage.py — do not add new usage here)
├── seed.py                 ← Full dev seed script (touch when: adding new tables that need seed data)
├── seed_admin.py           ← Minimal admin-user seed (touch when: changing admin bootstrap)
├── requirements.txt        ← Pinned prod dependencies (touch when: adding/removing a package)
├── requirements_r2_additions.txt ← Extra deps for R2 upload (merge into requirements.txt when R2 goes stable)
├── railway.toml            ← Railway build + start config (touch when: changing start command or build steps)
├── .env.example            ← All required env vars documented (touch when: adding a new env var anywhere in the codebase)
│
├── routers/                ← One file per feature domain (see routers/README.md)
├── services/               ← Shared business logic used by multiple routers (see services/README.md)
└── migrations/             ← SQL + Python migration scripts (see migrations/README.md)
```

## Cross-folder rules

| When you touch… | You must also check… |
|---|---|
| `db.py` | every router and service that calls `get_pool()` |
| `auth_router.py` `require_user` / `require_admin` | every router that imports these deps |
| `email_service.py` | `server.py` startup log, `.env.example` (SES vars), Railway env vars |
| `cors_config.py` | `server.py` CORS middleware block |
| Any `routers/*.py` | `server.py` router mount list at the bottom |
| Any new env var | `.env.example` — add it with a comment |
| `requirements.txt` | `railway.toml` if the package needs a system dep |

## Key shared helpers (defined in server.py, imported by routers)

- `get_db()` → returns the asyncpg pool  
- `get_visible_team_ids(pool, user_id)` → returns list of team_ids the user can see  
- `create_notification(pool, ...)` → inserts a notification row  
- `ensure_default_columns(pool, team_id)` → creates default kanban columns for a new project  
- `client_can_access_task(pool, task_id, user_id)` → auth check for client-role users  
- `now_utc()` → timezone-aware datetime  
- `parse_dt(value)` → ISO string → datetime with UTC tz  
- `row_to_task(r)` → asyncpg Record → `TaskOut` Pydantic model  

These helpers will move to a `backend/utils.py` module in the next tidy pass
(V2_PLAN.md was never committed; the split is tracked nowhere — treat the current layout as the design).

## Running locally

```bash
cd backend
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, etc.
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```
