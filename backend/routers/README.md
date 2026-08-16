# backend/routers/

One file per feature domain. Each file exports exactly one `router` object
that is mounted in `server.py`.

## Files

**This folder holds ~46 routers; a hand-maintained table here listed 8 of them for months.**
The accurate, regenerable inventory lives in `docs/modules/*.md` — built by
`scripts/module-facts.mjs` + `scripts/gen-module-docs.mjs` (12 modules, 440 routes). Regenerate
those; never hand-edit them, and never rebuild a hand-list here.

> Note: auth, approvals, and invites are **not** in this folder. They live as top-level
> `*_router.py` files in `backend/` because they predate the routers/ split.

## Rules

- Every router imports `require_user` (and sometimes `require_admin`) from
  `auth_router` — never re-implement auth checks inline.
- Every router imports `get_pool` from `db` via `Depends(get_db)` from
  `server` — never open a direct DB connection.
- Shared helpers (`get_visible_team_ids`, `create_notification`, etc.) are
  imported from `server` until they move to `backend/utils.py`.
- Route logic only — no email sending, no push, no storage decisions.
  Delegate those to `services/`.

## When you add a new router

1. Create `backend/routers/your_feature.py`
2. Define `router = APIRouter(prefix="/api/your-feature", tags=["your-feature"])`
3. Import and mount it at the bottom of `backend/server.py`:
   ```python
   from routers.your_feature import router as your_feature_router
   app.include_router(your_feature_router)
   ```
4. Add a row to the table above in this file.
5. Add an entry to `backend/README.md` cross-folder rules if it introduces
   a new shared dependency.

## Cross-folder impact

| When you touch… | Also check… |
|---|---|
| Any router | `server.py` mount list |
| `fields.py` | `ProjectBoardPage.jsx` field-value fetch, `useFields.js` hook |
| `automations.py` | `AutomationsPage.jsx`, `services/automation_engine.py` |
| `activity.py` | `ActivityFeedPage.jsx`, `services/activity_logger.py` |
| `time_entries.py` | `TimeReportPage.jsx`, `useTimeEntries.js` hook |
| `uploads.py` | `services/storage.py`, `.env.example` R2 vars |
| `views.py` | `useViews.js` hook, `ProjectBoardPage.jsx` saved-view UI |
| `templates.py` | `TemplatesPage.jsx` |
| `dashboards.py` | `DashboardPage.jsx` widget fetches |
