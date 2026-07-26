# frontend/src/pages/

One file per route. Each page is lazy-imported in `App.js`.

## Files

| File | Route | Who sees it | Backend calls |
|---|---|---|---|
| `LoginPage.jsx` | `/login` | Everyone | `POST /auth/login`, `POST /auth/register` |
| `LoginPage.js` | *(legacy re-export)* | — | — |
| `LoginPageStandalone.js` | *(unused — safe to delete once LoginPage.jsx is confirmed stable)* | — | — |
| `DashboardPage.jsx` | `/dashboard` | All authed | `GET /api/dashboard/summary`, widget data |
| `ProjectsPage.jsx` | `/projects` | Admin, member | `GET /api/teams` |
| `ProjectBoardPage.jsx` | `/projects/:projectId` | Project members | `GET /api/teams/:id`, `GET /api/projects/:id/columns`, `GET /api/tasks?team_id=` |
| `TasksListPage.jsx` | `/tasks` | All authed | `GET /api/tasks` |
| `TeamsPage.js` | `/teams` | Admin, owner | `GET /api/teams/:id` (members) |
| `ApprovalsPage.jsx` | `/approvals` | Admin, owner | `GET /api/approvals/pending` |
| `ActivityFeedPage.jsx` | `/activity` | All authed | `GET /api/activity?team_id=` |
| `AutomationsPage.jsx` | `/automations` | Admin, owner | `GET /api/automations` |
| `TimeReportPage.jsx` | `/time` | All authed | `GET /api/time` |
| `TemplatesPage.jsx` | `/templates` | All authed | `GET /api/templates` |
| `CategoriesPage.jsx` | `/settings/categories` | All authed | `GET /api/categories` |
| `NotificationsSettingsPage.js` | `/settings/notifications` | All authed | `GET /api/notifications` |
| `AdminPage.jsx` | `/admin` | Admin only | `GET /api/admin/*` |
| `ClientProjectsPage.jsx` | `/client`, `/client/projects` | Client role | `GET /api/client/projects` |
| `ClientBoardPage.jsx` | `/client/project/:projectId` | Client role | re-exports from `ClientPages.jsx` |
| `ClientPages.jsx` | *(implementation — `ClientProjectsPage.jsx` and `ClientBoardPage.jsx` re-export from it)* | Client role | — |

## Rules

- Pages own their own data fetching — no prop-drilling fetch results from
  `App.js`. Use hooks from `hooks/` or fetch directly with `api` from `lib/api.js`.
- Pages that need `teamId` get it from `useOutletContext()` — never from
  a URL param unless the team IS the URL param (e.g. `ProjectBoardPage`).
- Pages should render a loading skeleton while `teamId === null` (see
  `AppShell.jsx` fix note).
- No inline styles more than 2 lines long — extract to a component or
  `styles/` file.

## Cross-folder impact

| When you touch… | Also check… |
|---|---|
| Any page that calls a new API endpoint | Add the endpoint to the router in `backend/routers/`, mount it in `server.py` |
| `ProjectBoardPage.jsx` | `backend/server.py` `GET /teams/:id` response shape (members key), `useFields.js`, `useViews.js` |
| `ApprovalsPage.jsx` | `backend/approvals_router.py` |
| `ActivityFeedPage.jsx` | `useActivity.js` hook, `backend/routers/activity.py` |
| `AutomationsPage.jsx` | `useAutomations.js` hook, `backend/routers/automations.py`, `backend/services/automation_engine.py` |
| `TimeReportPage.jsx` | `useTimeEntries.js` hook, `backend/routers/time_entries.py` |
| `TemplatesPage.jsx` | `backend/routers/templates.py` |
| `DashboardPage.jsx` | `backend/routers/dashboards.py` |
| `LoginPage.jsx` | `lib/auth.js`, `backend/auth_router.py` |
| Adding a new page | `App.js` lazy import + route, `components/layout/Sidebar.jsx` nav link |
