# Screen → Repo Page Map

Every prototype screen maps to an existing page file in `frontend/src/pages/`.
This is the canonical lookup table. **Do not move routes. Do not rename pages.**

| # | Prototype function | File | Live route | Live page file | API endpoints (existing) | Notes |
|---|---|---|---|---|---|---|
| 1 | `ScreenToday` | `prototype/src/screens.jsx:65` | `/dashboard` | `pages/DashboardPage.jsx` | `GET /api/dashboard/summary`, `GET /api/tasks?assignee=me`, `GET /api/activity?limit=6` | Only screen that uses `<Hero>`. Every other screen uses `<PageHeader>`. |
| 2 | `ScreenTasks` | `prototype/src/screens.jsx:259` | `/tasks` | `pages/TasksListPage.jsx` | `GET /api/tasks` | Filter/group/sort are client-side. |
| 3 | `ScreenBoards` | `prototype/src/screens.jsx:392` | `/projects/:projectId` | `pages/ProjectBoardPage.jsx` | `GET /api/projects/:id/columns`, `GET /api/tasks?team_id=` | Uses `components/views/KanbanView.jsx` + `KanbanCard.jsx`. |
| 4 | `ScreenProjects` | `prototype/src/screens.jsx:468` | `/projects` | `pages/ProjectsPage.jsx` | `GET /api/teams` | Card grid, auto-fill minmax(280px, 1fr). |
| 5 | `ScreenTeam` | `prototype/src/screens.jsx:514` | `/teams` | `pages/TeamsPage.js` | `GET /api/teams/:id` | Member cards with role badge + load. |
| 6 | `ScreenInbox` | `prototype/src/app.jsx:127` | `/inbox` | `pages/InboxPage.jsx` | `GET /api/notifications` | Three kinds: mention/assign/approval — colored badges. |
| 7 | `ScreenApprovals` | `prototype/src/screens-2.jsx:105` | `/approvals` | `pages/ApprovalsPage.jsx` | `GET /api/approvals/pending`, `POST /api/approvals/:id/(approve\|reject)` | Stat row above the pending card. |
| 8 | `ScreenActivity` | `prototype/src/screens-2.jsx:183` | `/activity` | `pages/ActivityFeedPage.jsx` | `GET /api/activity?team_id=` | Filter bar: kind + member + project. |
| 9 | `ScreenAutomations` | `prototype/src/screens-2.jsx:262` | `/automations` | `pages/AutomationsPage.jsx` | `GET /api/automations`, `GET /api/automations/runs` | Keep existing rule editor modal; just restyle the chrome. |
| 10 | `ScreenTimeReport` | `prototype/src/screens-2.jsx:376` | `/time` | `pages/TimeReportPage.jsx` | `GET /api/time` | Recharts stays; restyle wrapper + bar fill. |
| 11 | `ScreenTemplates` | `prototype/src/screens-2.jsx:498` | `/templates` | `pages/TemplatesPage.jsx` | `GET /api/templates` | Three tabs: project / task / workflow. |
| 12 | `ScreenCategories` | `prototype/src/screens-2.jsx:603` | `/settings/categories` | `pages/CategoriesPage.jsx` | `GET /api/categories`, `POST /api/categories` | Two-column: list + new form. |
| 13 | `ScreenAdmin` | `prototype/src/screens-2.jsx:651` | `/admin` | `pages/AdminPage.jsx` | `GET /api/admin/*` | Tabs: Workspace · Members · Invites · Billing · Audit · Danger. |
| — | `TaskDrawer` | `prototype/src/task-drawer.jsx` | (overlay, all routes) | `components/TaskDrawer.jsx` | `GET /api/tasks/:id`, `PATCH /api/tasks/:id`, comments, files | Opens on row click. |
| — | `NewTaskModal` | `prototype/src/modals.jsx` | (modal, all routes) | `components/NewTaskModal.jsx` | `POST /api/tasks` | Keep form schema; restyle chrome. |
| — | `Sidebar` + `Topbar` | `prototype/src/chrome.jsx` | (every route) | `components/layout/Sidebar.jsx`, `Topbar.jsx` | One commit, applied everywhere. |

## Client-portal subset

| # | Source page (internal) | Client page | Route | What changes | What stays |
|---|---|---|---|---|---|
| C1 | `ProjectsPage.jsx` | `ClientProjectsPage.jsx` | `/client`, `/client/projects` | Visual treatment matches §8.4 of README | Reads from `GET /api/client/projects`, not `/api/teams`. Cards open `/client/project/:id`, not `/projects/:id`. |
| C2 | `ProjectBoardPage.jsx` | `ClientBoardPage.jsx` → delegates to `ClientPagesImpl.jsx` | `/client/project/:projectId` | Visual treatment matches §8.3 of README | Read-only Kanban — no drag, no edit. Approvals tab uses `GET /api/client/approvals`. |

See `CLIENT_PORTAL_NOTES.md` for the full rules on the client port.

## Anything not in this table

If you find a page in `frontend/src/pages/` that isn't listed here
(`LoginPage`, `LoginPageStandalone`, `NotificationsSettingsPage`,
`ClientPortal.jsx`, `ClientPortalPage.jsx`):

- **`LoginPage.jsx`** — restyle the auth screen using the editorial paper
  canvas + Newsreader heading. Single column, centered card, max-width 420px.
- **`LoginPageStandalone.js`, `LoginPage.js`, `ClientPortal.jsx`,
  `ClientPortalPage.jsx`** — marked safe to delete in `pages/README.md`.
  Leave them alone in this scope; we'll prune in a separate PR.
- **`NotificationsSettingsPage.js`** — settings form with toggles. Use
  `<PageHeader>` + `<Card>` with `<Toggle>` rows.
