# Frontend / backend payload agreement — static audit

**Branch** `audit/payload-agreement`, cut fresh from `origin/staging` @ `190fa73a`
(the worktree seeded stale at `1aa49855` with only 11 of 41 routers; verified and re-cut before any reading).
**Database untouched** — no query, no migration, no live call. Every claim below is from reading both sides.

## Result

| | |
|---|---|
| `api.*` call sites in `frontend/src` (code, comments excluded) | **643** |
| — non-test | **636** |
| — in test fixtures (excluded from verdicts) | 7 |
| Backend routes enumerated (`@router/@app.<verb>`) | **670** across 44 files |
| Call sites resolved to a route | **621** |
| Call sites needing one hop through a local wrapper | **15** (one is defect 3) |
| **Call sites that could NOT be resolved statically** | **0** |
| Confirmed defects | **3** |
| Fixed here | **2** |
| Reported for a product decision | **1** |

### The honest limit of this audit

Zero call sites are unresolvable, but *resolution* is not *verification*. Where the
evidence runs out:

| Axis | Checkable | Not checkable | Why |
|---|---|---|---|
| Path + method | 636 / 636 | 0 | every path is a literal or a one-hop local wrapper |
| Envelope vs bare array | 227 / 291 GETs | 64 | the route returns a name or a call, not a literal |
| Response field names | 123 / 279 GET routes | 156 | `SELECT *`, `**dict(row)` spread, or a computed return |
| Request bodies | 113 / 282 writes | 169 | body is a state object or a spread, not a literal |
| Enum values | 13 pairs | 17 `<select>` sets + 17 module enum consts, of which 13 have a backend `valid_*` tuple to compare against | the other 21 have no backend allow-list to drift from; selects built by `.map()` over server data cannot drift |

The 156 open-key-set routes are the real residue: on a `SELECT *` route a
front-end key that does not exist in the table cannot be detected without the
schema, and the schema is in the database this audit is forbidden to touch.
**That is the gap this pass does not close, and it should not be rounded away.**

## Confirmed defects

### 1 · `POST /api/time/manual` omits a required field — 422 on every call — FIXED

`backend/routers/time_entries.py:49-54`

    class TimeEntryCreate(BaseModel):
        task_id: str
        started_at: datetime          # required - no default
        ended_at: Optional[datetime] = None
        minutes: Optional[int] = None
        description: Optional[str] = None

`frontend/src/components/TaskDrawer.jsx:474` (before) sent `task_id`, `minutes`,
`description` and no `started_at`. FastAPI answers 422 before the handler runs, so
**"add manual time entry" in the task drawer had never worked once** — the same
shape as the Manav leave-clash defect. `started_at` is now sent as the current
instant rather than back-dated by `minutes`, because the column is what
`/time/report` orders and filters on and back-dating a long entry logged just
after midnight would file it against the previous day.

### 2 · `POST /api/teams/{id}/members` silently drops two client-invite fields — REPORTED

`backend/server.py:575-576`

    class TeamMemberAdd(BaseModel):
        email:str; role:str="member"

`frontend/src/pages/TeamsPage.jsx:83-88` also sends `receives_approval_emails`
and `company_name`. The model sets no `model_config`, so Pydantic v2's default
`extra="ignore"` applies: **no 422, the two values are just discarded.** The
route (`server.py:2067-2081`) inserts only `email`/`role`, so when an operator
invites a *client* to a project, the "receives approval emails" toggle and the
company name they typed never reach storage. Both fields are real elsewhere —
`invite_router.py:110-164` and `auth_router.py:377-386` carry them through the
invite flow — so the fix is either to route client invites through
`invite_router`, or to widen `TeamMemberAdd` and persist both.
**Which of those is right is a product decision, so this is reported, not patched.**

### 3 · Graha follow-up status filter sent a parameter the route does not have — FIXED

`backend/routers/graha.py:1003-1008` — `list_follow_ups` declares
`assigned_to`, `contact_id`, `deal_id`, `is_completed: Optional[bool]`. **There is
no `status` parameter.** `frontend/src/pages/graha/FollowUpsTab.jsx:32-33` (before)
built `?status=pending|completed|overdue` from the select at l.89-92.

FastAPI ignores unknown query parameters, so the filter did nothing — and because
the route falls back to `AND f.is_completed=FALSE` when `is_completed` is absent
(`graha.py:1027-1028`), **choosing "Completed" kept showing the OPEN follow-ups**:
a wrong answer rendered as a confident one. Now mapped onto `is_completed`;
`overdue` has no server-side equivalent and is narrowed client-side from the open
set, which is sound because overdue is by definition a subset of not-completed.

## What came back clean

- **Envelope vs bare array: no mismatches in 291 GET call sites.** All 83
  envelope-backed reads unwrap correctly; no bare-list route is read as an
  envelope; no object route is read through `rows()`. The `rows()`/`body()`
  promotion in `lib/api.js` did its job.
- **Field names: 9 candidates raised, all 9 false positives.** 8 came from the
  stat-tile check (state variable vs the route's returned keys) and 1 from the
  list-item check (row fields vs the route's explicit `SELECT`). Every one was a
  nested object (`setSub(cur.data.subscription)`, `setPii(r.data.employee)`) or
  regex bleed between two components in one file. Verified against source on both
  sides before being discarded — this is the axis that produced the near-miss
  false defects in the previous pass, so none was reported on tooling alone.
- **Request bodies: 113 literal bodies checked against their Pydantic model**;
  2 defects above, 111 agree. The `POST /sequences` and `ExpensesTab` defects
  named in the brief are **already fixed on `origin/staging`** (see the comments at
  `SequencesTab.jsx:17-19` and `ExpensesTab.jsx:4-5`).
- **Enum drift: 13 frontend value sets have a backend `valid_*` tuple to compare
  against, and all 13 match exactly** — contact/activity/custom-field types,
  employment types, attendance + candidate + asset vocabularies, contract
  statuses, recurrence frequencies, order pipeline stages, approval entity types.
  The other 21 sets have no backend allow-list to drift from. Defect 3 is the one
  break. The SMS step defect named in the brief is already fixed on `origin/staging`.
- **Query parameters: 38 GET sites sending params, 0 undeclared** apart from
  defect 3.

## Still hand-rolling the unwrap (22 sites)

Each is **correct today** — it matches the shape its route actually returns — but
none is indifferent to the route changing shape, which is the whole reason
`rows()` exists. Not changed here: they are spread across five modules that peer
agents are editing in the same pass.

- `pages/ActivityFeedPage.jsx:65` -> `/api/activity/feed` (bare-list|expr)
- `pages/TeamsPage.jsx:39` -> `/api/teams` (bare-list)
- `pages/dristi/DashboardsTab.jsx:74` -> `/api/v1/dristi/dashboards` (envelope)
- `pages/dristi/ReportsTab.jsx:65` -> `/api/v1/dristi/scheduled-reports` (envelope)
- `pages/dristi/ReportsTab.jsx:111` -> `/api/v1/dristi/scheduled-reports/*/logs` (object)
- `pages/esign/DocumentsTab.jsx:38` -> `None` (None)
- `pages/hub/ChatTab.jsx:37` -> `/api/v1/hub/chat/sessions/*/messages` (envelope)
- `pages/onboarding/OnboardingPage.jsx:112` -> `/api/projects/*/columns` (bare-list)
- `pages/sanvaad/ChannelDetails.jsx:55` -> `/api/v1/messaging/channels/*/members` (bare-list)
- `pages/sanvaad/ChannelsTab.jsx:115` -> `/api/v1/messaging/channels` (bare-list)
- `pages/sanvaad/ChannelsTab.jsx:135` -> `/api/v1/messaging/channels` (bare-list)
- `pages/sanvaad/ThreadPanel.jsx:43` -> `/api/v1/messaging/messages/*/thread` (bare-list)
- `pages/sanvaad/useChannelMessages.js:56` -> `/api/v1/messaging/channels/*/messages` (bare-list)
- `pages/sanvaad/useChannelMessages.js:181` -> `/api/v1/messaging/channels/*/messages` (bare-list)
- `pages/sanvaad/varta/WAChat.jsx:41` -> `/api/v1/whatsapp/conversations/*/messages` (bare-list)
- `pages/vetana/LoansTab.jsx:32` -> `/api/v1/manav/employees` (envelope)
- `pages/vetana/StructuresTab.jsx:37` -> `/api/v1/manav/employees` (envelope)
- `pages/vikray/DashboardTab.jsx:45` -> `/api/v1/vikray/dashboard` (object)
- `pages/vikray/DashboardTab.jsx:47` -> `/api/v1/vikray/orders` (envelope)
- `pages/vikray/OrdersTab.jsx:29` -> `/api/v1/vikray/orders` (envelope)
- `pages/vikray/StockTab.jsx:201` -> `/api/v1/vikray/stock` (envelope)
- `pages/vikray/TargetsTab.jsx:203` -> `/api/v1/vikray/targets` (envelope)

## Every resolved call site

`unresolved-1hop` = the `api.*` argument is a variable, resolved by reading the
wrapper's callers in the same or a sibling file; the resolution is given as evidence.

| Frontend | Method + path | Backend | Verdict | Evidence |
|---|---|---|---|---|
| `components/BrandKit.jsx:156` | GET `/api/settings` | `server.py:1295` | agrees | returns expr; reads .data |
| `components/BrandKit.jsx:170` | PUT `/api/settings` | `server.py:1300` | agrees | body sent; route takes no Pydantic model |
| `components/CommandPalette.jsx:115` | GET `/api/search` | `routers/search.py:481` | agrees | returns object |
| `components/NewTaskModal.jsx:125` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list; reads .data |
| `components/NewTaskModal.jsx:151` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object; reads .data |
| `components/NewTaskModal.jsx:156` | GET `/api/templates/tasks` | `routers/templates.py:151` | agrees | returns bare-list; reads .data |
| `components/NewTaskModal.jsx:234` | POST `/api/upload` | `routers/uploads.py:88` | agrees | body sent; route takes no Pydantic model |
| `components/NewTaskModal.jsx:316` | POST `/api/client/tasks/request` | `server.py:1327` | agrees | body sent; route takes no Pydantic model |
| `components/NewTaskModal.jsx:316` | POST `/api/tasks` | `server.py:2309` | agrees | body sent; route takes no Pydantic model |
| `components/NotificationBanner.jsx:65` | GET `/api/push/vapid-public-key` | `server.py:3039` | agrees | returns object; reads .data |
| `components/NotificationBanner.jsx:74` | POST `/api/push/subscribe` | `server.py:3043` | agrees | body sent; route takes no Pydantic model |
| `components/OnboardingChecklist.jsx:47` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `components/OnboardingChecklist.jsx:48` | GET `/api/users` | `server.py:1981` | agrees | returns bare-list |
| `components/OnboardingChecklist.jsx:49` | GET `/api/tasks` | `server.py:2183` | agrees | returns expr |
| `components/TaskDrawer.jsx:168` | GET `/api/categories` | `server.py:2163` | agrees | returns bare-list; reads .data |
| `components/TaskDrawer.jsx:171` | GET `/api/tasks/*` | `server.py:2491` | agrees | returns expr; reads .data |
| `components/TaskDrawer.jsx:172` | GET `/api/tasks/*/comments` | `server.py:1710` | agrees | returns bare-list |
| `components/TaskDrawer.jsx:173` | GET `/api/activity/task/*` | `routers/activity.py:180` | agrees | returns expr |
| `components/TaskDrawer.jsx:174` | GET `/api/time/task/*` | `routers/time_entries.py:57` | agrees | returns object |
| `components/TaskDrawer.jsx:186` | GET `/api/projects/*/columns` | `server.py:998` | agrees | returns bare-list; reads .data+rows() |
| `components/TaskDrawer.jsx:187` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object; reads .data+rows() |
| `components/TaskDrawer.jsx:194` | GET `/api/fields/team/*` | `routers/fields.py:98` | agrees | returns bare-list; reads rows() |
| `components/TaskDrawer.jsx:199` | GET `/api/fields/task/*/values` | `routers/fields.py:186` | agrees | returns bare-list; reads rows() |
| `components/TaskDrawer.jsx:212` | PUT `/api/tasks/*` | `server.py:2532` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:244` | PUT `/api/tasks/*/reminders` | `server.py:2518` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:253` | PUT `/api/fields/task/*/values` | `routers/fields.py:197` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:264` | PUT `/api/tasks/*` | `server.py:2532` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:270` | PATCH `/api/tasks/*/move` | `server.py:2859` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:284` | DELETE `/api/tasks/*` | `server.py:2829` | agrees | no body |
| `components/TaskDrawer.jsx:298` | PATCH `/api/tasks/*/archive` | `server.py:2281` | agrees | no body |
| `components/TaskDrawer.jsx:307` | PATCH `/api/tasks/*/unarchive` | `server.py:2295` | agrees | no body |
| `components/TaskDrawer.jsx:317` | POST `/api/tasks/*/comments` | `server.py:1740` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:323` | DELETE `/api/tasks/*/comments/*` | `server.py:1815` | agrees | no body |
| `components/TaskDrawer.jsx:334` | PUT `/api/tasks/*/comments/*` | `server.py:1797` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:344` | POST `/api/tasks/*/subtasks` | `server.py:1829` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:351` | PATCH `/api/tasks/*/subtasks/*` | `server.py:1846` | agrees | no body |
| `components/TaskDrawer.jsx:356` | DELETE `/api/tasks/*/subtasks/*` | `server.py:1859` | agrees | no body |
| `components/TaskDrawer.jsx:362` | PUT `/api/tasks/*/subtasks/*` | `server.py:1881` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:410` | POST `(dynamic)` | — | unresolved-1hop | `/upload` or `/upload?team_id=..` (ternary, same fn, l.409) |
| `components/TaskDrawer.jsx:469` | POST `/api/time/start` | `routers/time_entries.py:76` | agrees | no body |
| `components/TaskDrawer.jsx:470` | POST `/api/time/stop` | `routers/time_entries.py:105` | agrees | no body |
| `components/TaskDrawer.jsx:474` | POST `/api/time/manual` | `routers/time_entries.py:129` | **body-mismatch** | `TimeEntryCreate` (routers/time_entries.py:51) requires `started_at`; it was never sent -> 422 on every call. FIXED |
| `components/TaskDrawer.jsx:478` | DELETE `/api/time/*` | `routers/time_entries.py:154` | agrees | no body |
| `components/TaskDrawer.jsx:484` | POST `/api/tasks/*/request-approval` | `approvals_router.py:219` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:485` | GET `/api/tasks/*` | `server.py:2491` | agrees | returns expr; reads .data |
| `components/TaskDrawer.jsx:502` | GET `/api/teams/*/clients` | `server.py:2038` | agrees | returns bare-list; reads .data |
| `components/TaskDrawer.jsx:514` | POST `/api/tasks/*/request-client-approval` | `approvals_router.py:404` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:521` | POST `/api/tasks/*/approve` | `approvals_router.py:273` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:522` | GET `/api/tasks/*` | `server.py:2491` | agrees | returns expr; reads .data |
| `components/TaskDrawer.jsx:539` | POST `/api/tasks/*/reject` | `approvals_router.py:322` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:540` | GET `/api/tasks/*` | `server.py:2491` | agrees | returns expr; reads .data |
| `components/TaskDrawer.jsx:555` | POST `/api/tasks/*/client-approve` | `approvals_router.py:443` | agrees | body sent; route takes no Pydantic model |
| `components/TaskDrawer.jsx:566` | POST `/api/tasks/*/client-reject` | `approvals_router.py:658` | agrees | body sent; route takes no Pydantic model |
| `components/admin/AdminShell.jsx:82` | GET `/api/v1/admin/orgs` | `routers/admin_orgs.py:200` | agrees | returns envelope-ish |
| `components/customize/NotifyPrefs.jsx:79` | GET `/api/me/notification_prefs` | `server.py:909` | agrees | returns object |
| `components/customize/NotifyPrefs.jsx:103` | PUT `/api/me/notification_prefs` | `server.py:943` | agrees | body sent; route takes no Pydantic model |
| `components/fields/FilesField.jsx:34` | POST `/api/upload` | `routers/uploads.py:88` | agrees | body sent; route takes no Pydantic model |
| `components/layout/AppShell.jsx:86` | GET `/api/push/vapid-public-key` | `server.py:3039` | agrees | returns object; reads .data |
| `components/layout/AppShell.jsx:93` | POST `/api/push/subscribe` | `server.py:3043` | agrees | body sent; route takes no Pydantic model |
| `components/layout/AppShell.jsx:261` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `components/layout/Protected.jsx:88` | GET `/api/auth/me` | `auth_router.py:616` | agrees | returns expr |
| `components/views/BulkBar.jsx:74` | PATCH `/api/v1/tasks/bulk` | `routers/tasks_bulk.py:273` | agrees | body sent; route takes no Pydantic model |
| `components/views/BulkBar.jsx:102` | DELETE `/api/v1/tasks/bulk` | `routers/tasks_bulk.py:383` | agrees | body sent; route takes no Pydantic model |
| `components/views/CalendarView.jsx:150` | PUT `/api/tasks/*` | `server.py:2532` | agrees | body sent; route takes no Pydantic model |
| `components/views/KanbanView.jsx:182` | PUT `/api/projects/*/columns/*` | `server.py:1018` | agrees | body sent; route takes no Pydantic model |
| `components/views/KanbanView.jsx:195` | DELETE `/api/projects/*/columns/*` | `server.py:1034` | agrees | no body |
| `components/views/KanbanView.jsx:209` | POST `/api/projects/*/columns` | `server.py:1007` | agrees | body sent; route takes no Pydantic model |
| `components/views/KanbanView.jsx:236` | POST `/api/tasks` | `server.py:2309` | agrees | body sent; route takes no Pydantic model |
| `components/views/KanbanView.jsx:267` | PATCH `/api/tasks/*` | `server.py:2675` | agrees | body sent; route takes no Pydantic model |
| `components/views/KanbanView.jsx:387` | PATCH `/api/tasks/*/move` | `server.py:2859` | agrees | body sent; route takes no Pydantic model |
| `components/views/TableView.jsx:191` | PUT `/api/fields/task/*/values` | `routers/fields.py:197` | agrees | body sent; route takes no Pydantic model |
| `context/NotificationContext.jsx:208` | GET `/api/notifications` | `server.py:2898` | agrees | returns bare-list |
| `context/NotificationContext.jsx:265` | GET `/api/notifications` | `server.py:2898` | agrees | returns bare-list |
| `context/NotificationContext.jsx:337` | POST `/api/notifications/mark-read` | `server.py:2944` | agrees | body sent; route takes no Pydantic model |
| `context/NotificationContext.jsx:357` | POST `/api/notifications/mark-read` | `server.py:2944` | agrees | body sent; route takes no Pydantic model |
| `context/NotificationContext.jsx:456` | GET `/api/me/notification_prefs` | `server.py:909` | agrees | returns object |
| `context/NotificationContext.jsx:716` | GET `/api/notifications/poll` | `server.py:2980` | agrees | returns object; reads .data |
| `hooks/useActivity.js:11` | GET `/api/activity/team/*` | `routers/activity.py:61` | agrees | returns bare-list\|expr; reads .data |
| `hooks/useActivity.js:23` | GET `/api/activity/task/*` | `routers/activity.py:180` | agrees | returns expr; reads .data |
| `hooks/useAutomations.js:11` | GET `/api/automations/team/*` | `routers/automations.py:44` | agrees | returns bare-list; reads .data |
| `hooks/useAutomations.js:14` | POST `/api/automations` | `routers/automations.py:64` | agrees | body sent; route takes no Pydantic model |
| `hooks/useAutomations.js:18` | PUT `/api/automations/*` | `routers/automations.py:109` | agrees | body sent; route takes no Pydantic model |
| `hooks/useAutomations.js:22` | DELETE `/api/automations/*` | `routers/automations.py:123` | agrees | no body |
| `hooks/useFields.js:15` | GET `/api/fields/team/*` | `routers/fields.py:98` | agrees | returns bare-list; reads .data |
| `hooks/useFields.js:22` | POST `/api/fields` | `routers/fields.py:149` | agrees | body sent; route takes no Pydantic model |
| `hooks/useFields.js:28` | PUT `/api/fields/*` | `routers/fields.py:163` | agrees | body sent; route takes no Pydantic model |
| `hooks/useFields.js:33` | DELETE `/api/fields/*` | `routers/fields.py:178` | agrees | no body |
| `hooks/useFields.js:47` | GET `/api/fields/task/*/values` | `routers/fields.py:186` | agrees | returns bare-list; reads rows() |
| `hooks/useFields.js:60` | PUT `/api/fields/task/*/values` | `routers/fields.py:197` | agrees | body sent; route takes no Pydantic model |
| `hooks/useFields.js:96` | GET `/api/fields/team/*/values` | `routers/fields.py:108` | agrees | returns expr; reads .data |
| `hooks/useTimeEntries.js:16` | GET `/api/time/task/*` | `routers/time_entries.py:57` | agrees | returns object; reads .data |
| `hooks/useTimeEntries.js:28` | POST `/api/time/start` | `routers/time_entries.py:76` | agrees | no body |
| `hooks/useTimeEntries.js:32` | POST `/api/time/stop` | `routers/time_entries.py:105` | agrees | no body |
| `hooks/useTimeEntries.js:35` | POST `/api/time/manual` | `routers/time_entries.py:129` | agrees | body sent; route takes no Pydantic model |
| `hooks/useTimeEntries.js:38` | DELETE `/api/time/*` | `routers/time_entries.py:154` | agrees | no body |
| `hooks/useViews.js:11` | GET `/api/views/team/*` | `routers/views.py:45` | agrees | returns bare-list; reads .data |
| `hooks/useViews.js:14` | POST `/api/views` | `routers/views.py:55` | agrees | body sent; route takes no Pydantic model |
| `hooks/useViews.js:18` | PUT `/api/views/*` | `routers/views.py:70` | agrees | body sent; route takes no Pydantic model |
| `hooks/useViews.js:22` | DELETE `/api/views/*` | `routers/views.py:88` | agrees | no body |
| `lib/auth.js:44` | POST `/api/auth/login` | `auth_router.py:469` | agrees | body sent; route takes no Pydantic model |
| `lib/auth.js:51` | POST `/api/auth/accept-invite` | `auth_router.py:350` | agrees | body sent; route takes no Pydantic model |
| `lib/auth.js:65` | GET `/api/auth/invite/*` | `auth_router.py:218` | agrees | returns object; reads .data |
| `lib/auth.js:78` | POST `/api/auth/invite/*/decline` | `auth_router.py:324` | agrees | body sent; route takes no Pydantic model |
| `lib/auth.js:96` | POST `/api/auth/refresh` | `auth_router.py:497` | agrees | body sent; route takes no Pydantic model |
| `lib/auth.js:103` | POST `/api/auth/forgot-password` | `auth_router.py:572` | agrees | body sent; route takes no Pydantic model |
| `lib/auth.js:108` | POST `/api/auth/reset-password` | `auth_router.py:594` | agrees | body sent; route takes no Pydantic model |
| `lib/auth.js:118` | POST `/api/auth/logout` | `auth_router.py:548` | agrees | body sent; route takes no Pydantic model |
| `pages/ActivityFeedPage.jsx:49` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object; reads .data |
| `pages/ActivityFeedPage.jsx:65` | GET `/api/activity/feed` | `routers/activity.py:115` | agrees | returns bare-list\|expr; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/AdminBillingPage.jsx:109` | GET `/api/v1/admin/orgs` | `routers/admin_orgs.py:200` | agrees | returns envelope-ish |
| `pages/AdminBillingPage.jsx:110` | GET `/api/v1/subscription/plans` | `routers/subscription.py:59` | agrees | returns object |
| `pages/AdminBillingPage.jsx:111` | GET `/api/v1/subscription/admin/invoices/overdue` | `routers/subscription.py:397` | agrees | returns envelope |
| `pages/AdminBillingPage.jsx:127` | GET `/api/v1/subscription/current` | `routers/subscription.py:95` | agrees | returns object |
| `pages/AdminBillingPage.jsx:128` | GET `/api/v1/subscription/invoices` | `routers/subscription.py:412` | agrees | returns envelope |
| `pages/AdminBillingPage.jsx:129` | GET `/api/v1/subscription/usage` | `routers/subscription.py:437` | agrees | returns object |
| `pages/AdminBillingPage.jsx:165` | POST `/api/v1/subscription/admin/set-plan` | `routers/subscription.py:140` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminBillingPage.jsx:176` | POST `/api/v1/subscription/modules/*` | `routers/subscription.py:204` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminBillingPage.jsx:188` | POST `/api/v1/subscription/admin/invoices` | `routers/subscription.py:321` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminBillingPage.jsx:205` | PATCH `/api/v1/subscription/admin/invoices/*/record-payment` | `routers/subscription.py:361` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminCostDashboardPage.jsx:330` | GET `/api/v1/admin/orgs/*/cost-report-pdf` | `routers/admin_orgs.py:1289` | agrees | returns expr; reads .data |
| `pages/AdminCostDashboardPage.jsx:510` | GET `/api/v1/admin/orgs/platform-analytics` | `routers/admin_orgs.py:247` | agrees | returns object; reads .data |
| `pages/AdminOrgsPage.jsx:128` | POST `/api/v1/admin/orgs/r2/verify` | `routers/admin_orgs.py:1054` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminOrgsPage.jsx:155` | POST `/api/v1/admin/orgs` | `routers/admin_orgs.py:88` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminOrgsPage.jsx:374` | PATCH `/api/v1/admin/orgs/*/settings` | `routers/admin_orgs.py:567` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminOrgsPage.jsx:409` | DELETE `/api/v1/admin/orgs/*/modules/*` | `routers/admin_orgs.py:974` | agrees | no body |
| `pages/AdminOrgsPage.jsx:410` | POST `/api/v1/admin/orgs/*/modules/*` | `routers/admin_orgs.py:947` | agrees | no body |
| `pages/AdminOrgsPage.jsx:460` | DELETE `/api/v1/admin/orgs/*/members/*` | `routers/admin_orgs.py:791` | agrees | no body |
| `pages/AdminOrgsPage.jsx:493` | POST `/api/v1/admin/orgs/*/members` | `routers/admin_orgs.py:690` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminOrgsPage.jsx:521` | PATCH `/api/v1/admin/orgs/*/deactivate` | `routers/admin_orgs.py:550` | agrees | no body |
| `pages/AdminOrgsPage.jsx:559` | GET `/api/v1/admin/orgs` | `routers/admin_orgs.py:200` | agrees | returns envelope-ish |
| `pages/AdminPage.jsx:82` | POST `/api/admin/users/*/send-reset-link` | `invite_router.py:457` | agrees | no body |
| `pages/AdminPage.jsx:115` | PATCH `/api/admin/users/*` | `invite_router.py:179` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminPage.jsx:220` | DELETE `/api/admin/users/**` | `invite_router.py:225` | agrees | no body |
| `pages/AdminPage.jsx:292` | GET `/api/v1/admin/orgs/roles/platform` | `routers/admin_orgs.py:822` | agrees | returns bare-list; reads .data |
| `pages/AdminPage.jsx:304` | GET `/api/v1/admin/orgs/users/search` | `routers/admin_orgs.py:807` | agrees | returns expr; reads .data |
| `pages/AdminPage.jsx:307` | POST `/api/v1/admin/orgs/roles/assign` | `routers/admin_orgs.py:838` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminPage.jsx:410` | DELETE `/api/v1/admin/orgs/roles/*` | `routers/admin_orgs.py:887` | agrees | no body |
| `pages/AdminPage.jsx:509` | GET `/api/admin/users` | `invite_router.py:169` | agrees | returns bare-list; reads .data |
| `pages/AdminPage.jsx:510` | GET `/api/admin/invites` | `invite_router.py:427` | agrees | returns bare-list; reads .data |
| `pages/AdminPage.jsx:511` | GET `/api/admin/teams` | `invite_router.py:493` | agrees | returns bare-list; reads .data |
| `pages/AdminPage.jsx:553` | POST `/api/admin/invites` | `invite_router.py:361` | agrees | body sent; route takes no Pydantic model |
| `pages/AdminPage.jsx:830` | DELETE `/api/admin/invites/*` | `invite_router.py:479` | agrees | no body |
| `pages/ApprovalsPage.jsx:94` | GET `/api/approvals/pending` | `server.py:1419` | agrees | returns bare-list |
| `pages/ApprovalsPage.jsx:111` | GET `/api/approvals/history` | `server.py:1457` | agrees | returns bare-list |
| `pages/ApprovalsPage.jsx:124` | GET `/api/approvals/stats` | `server.py:1484` | agrees | returns object; reads body() |
| `pages/ApprovalsPage.jsx:136` | POST `/api/approvals/*/review` | `server.py:1601` | agrees | body sent; route takes no Pydantic model |
| `pages/ApprovalsPage.jsx:156` | POST `(dynamic)` | — | unresolved-1hop | `/tasks/*/client-approve` \| `/tasks/*/client-reject` (ternary, l.153-154) |
| `pages/ApprovalsPage.jsx:173` | GET `/api/teams/*/clients` | `server.py:2038` | agrees | returns bare-list |
| `pages/ApprovePage.jsx:182` | GET `/api/approvals/by-token/*` | `approvals_router.py:524` | agrees | returns object; reads body() |
| `pages/ApprovePage.jsx:210` | POST `/api/approvals/by-token/*/*` | `approvals_router.py:552` | agrees | body sent; route takes no Pydantic model |
| `pages/AutomationsPage.jsx:72` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `pages/AutomationsPage.jsx:88` | GET `/api/automations/team/*` | `routers/automations.py:44` | agrees | returns bare-list |
| `pages/AutomationsPage.jsx:101` | PUT `/api/automations/*` | `routers/automations.py:109` | agrees | body sent; route takes no Pydantic model |
| `pages/AutomationsPage.jsx:114` | DELETE `/api/automations/*` | `routers/automations.py:123` | agrees | no body |
| `pages/AutomationsPage.jsx:128` | POST `/api/automations/*/run` | `routers/automations.py:131` | agrees | body sent; route takes no Pydantic model |
| `pages/AutomationsPage.jsx:170` | POST `/api/automations` | `routers/automations.py:64` | agrees | body sent; route takes no Pydantic model |
| `pages/BoardsPage.jsx:92` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `pages/BoardsPage.jsx:114` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object |
| `pages/BoardsPage.jsx:115` | GET `/api/projects/*/columns` | `server.py:998` | agrees | returns bare-list |
| `pages/BoardsPage.jsx:116` | GET `/api/tasks` | `server.py:2183` | agrees | returns expr |
| `pages/BoardsPage.jsx:120` | GET `/api/teams/*/members` | `server.py:2053` | agrees | returns bare-list |
| `pages/CategoriesPage.jsx:52` | GET `/api/categories` | `server.py:2163` | agrees | returns bare-list |
| `pages/CategoriesPage.jsx:67` | POST `/api/categories` | `server.py:2168` | agrees | body sent; route takes no Pydantic model |
| `pages/CategoriesPage.jsx:85` | DELETE `/api/categories/*` | `server.py:2174` | agrees | no body |
| `pages/DashboardPage.jsx:97` | GET `/api/tasks` | `server.py:2183` | agrees | returns expr |
| `pages/DashboardPage.jsx:98` | GET `/api/verse-of-the-day` | `server.py:3131` | agrees | returns expr |
| `pages/DashboardPage.jsx:101` | GET `/api/v1/ganit/stats` | `routers/ganit.py:661` | agrees | returns expr |
| `pages/DashboardPage.jsx:139` | GET `/api/activity/feed` | `routers/activity.py:115` | agrees | returns bare-list\|expr; reads .data |
| `pages/DristiPage.jsx:61` | GET `/api/v1/dristi/overview` | `routers/dristi.py:170` | agrees | returns object |
| `pages/GanitPage.jsx:69` | GET `/api/v1/ganit/stats` | `routers/ganit.py:661` | agrees | returns expr |
| `pages/GanitPage.jsx:70` | GET `/api/v1/ganit/payables-summary` | `routers/ganit.py:1787` | agrees | returns object |
| `pages/GanitPage.jsx:102` | GET `/api/v1/ganit/invoices` | `routers/ganit.py:363` | agrees | returns envelope; reads rows() |
| `pages/GrahaPage.jsx:83` | GET `/api/v1/graha/reports/forecast` | `routers/graha.py:2090` | agrees | returns object; reads body() |
| `pages/GrahaPage.jsx:84` | GET `/api/v1/graha/reports/conversion` | `routers/graha.py:2019` | agrees | returns object; reads body() |
| `pages/GrahaPage.jsx:103` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/GrahaPage.jsx:108` | GET `/api/v1/graha/deals` | `routers/graha.py:655` | agrees | returns envelope; reads rows() |
| `pages/GrahaPage.jsx:109` | GET `/api/v1/graha/follow-ups` | `routers/graha.py:1003` | agrees | returns envelope; reads rows() |
| `pages/HubClientDetailPage.jsx:46` | GET `/api/v1/hub/clients/*` | `routers/hub.py:290` | agrees | returns object; reads .data |
| `pages/HubClientsPage.jsx:60` | GET `/api/v1/hub/clients` | `routers/hub.py:234` | agrees | returns envelope |
| `pages/HubClientsPage.jsx:75` | POST `/api/v1/hub/clients` | `routers/hub.py:251` | agrees | body sent; route takes no Pydantic model |
| `pages/HubDashboardPage.jsx:44` | GET `/api/v1/hub/org-client` | `routers/hub.py:175` | agrees | returns object; reads .data |
| `pages/HubDashboardPage.jsx:53` | GET `/api/v1/hub/clients/*` | `routers/hub.py:290` | agrees | returns object; reads .data |
| `pages/HubSkillsPage.jsx:53` | GET `/api/v1/hub/clients/*` | `routers/hub.py:290` | agrees | returns object; reads .data |
| `pages/ManavPage.jsx:44` | GET `/api/v1/manav/stats` | `routers/manav.py:1030` | agrees | returns object; reads .data |
| `pages/OrgSettingsPage.jsx:91` | GET `/api/v1/org/members` | `routers/org_members.py:72` | agrees | returns expr; reads .data |
| `pages/OrgSettingsPage.jsx:94` | GET `/api/v1/subscription/current` | `routers/subscription.py:95` | agrees | returns object; reads .data |
| `pages/OrgSrijanPage.jsx:86` | GET `/api/v1/hub/org/credits` | `routers/hub.py:1505` | agrees | returns object; reads .data |
| `pages/PracharPage.jsx:67` | GET `/api/v1/prachar/dashboard` | `routers/prachar.py:600` | agrees | returns object; reads body() |
| `pages/ProjectBoardPage.jsx:95` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object |
| `pages/ProjectBoardPage.jsx:96` | GET `/api/projects/*/columns` | `server.py:998` | agrees | returns bare-list |
| `pages/ProjectBoardPage.jsx:97` | GET `/api/tasks` | `server.py:2183` | agrees | returns expr |
| `pages/ProjectBoardPage.jsx:115` | POST `/api/tasks/auto-archive` | `server.py:2260` | agrees | no body |
| `pages/ProjectsPage.jsx:79` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `pages/ProjectsPage.jsx:92` | GET `/api/teams/bin` | `server.py:1922` | agrees | returns bare-list |
| `pages/ProjectsPage.jsx:118` | POST `/api/teams` | `server.py:1958` | agrees | body sent; route takes no Pydantic model |
| `pages/ProjectsPage.jsx:145` | DELETE `/api/teams/*` | `server.py:2100` | agrees | no body |
| `pages/ProjectsPage.jsx:156` | POST `/api/teams/*/restore` | `server.py:2111` | agrees | no body |
| `pages/ProjectsPage.jsx:172` | DELETE `/api/teams/*/purge` | `server.py:2122` | agrees | no body |
| `pages/ReportsPage.jsx:93` | GET `/api/reports/schedules/*` | `routers/reports.py:340` | agrees | returns bare-list |
| `pages/ReportsPage.jsx:114` | POST `/api/reports/schedules/*` | `routers/reports.py:355` | agrees | body sent; route takes no Pydantic model |
| `pages/ReportsPage.jsx:140` | DELETE `/api/reports/schedules/*` | `routers/reports.py:386` | agrees | no body |
| `pages/ReportsPage.jsx:382` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list; reads .data |
| `pages/ReportsPage.jsx:409` | GET `/api/teams/*/members` | `server.py:2053` | agrees | returns bare-list; reads .data |
| `pages/ReportsPage.jsx:451` | GET `/api/reports/data/*` | `routers/reports.py:274` | agrees | returns expr; reads .data |
| `pages/ReportsPage.jsx:507` | GET `/api/reports/download/*` | `routers/reports.py:293` | agrees | returns expr; reads .data |
| `pages/TasksListPage.jsx:163` | GET `/api/tasks*` | `server.py:2183` | agrees | returns expr |
| `pages/TasksListPage.jsx:164` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `pages/TasksListPage.jsx:165` | GET `/api/categories` | `server.py:2163` | agrees | returns bare-list |
| `pages/TasksListPage.jsx:186` | POST `/api/tasks/auto-archive` | `server.py:2260` | agrees | no body |
| `pages/TasksListPage.jsx:214` | PATCH `/api/tasks/*/*` | `server.py:2281` | agrees | no body |
| `pages/TasksListPage.jsx:246` | PATCH `/api/tasks/*` | `server.py:2675` | agrees | body sent; route takes no Pydantic model |
| `pages/TeamsPage.jsx:39` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/TeamsPage.jsx:47` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object; reads .data |
| `pages/TeamsPage.jsx:53` | GET `/api/users` | `server.py:1981` | agrees | returns bare-list; reads .data |
| `pages/TeamsPage.jsx:83` | POST `/api/teams/*/members` | `server.py:2067` | **body-mismatch** | `TeamMemberAdd` (server.py:575-576) is `email` + `role` only; `receives_approval_emails` and `company_name` are silently dropped (Pydantic default extra="ignore"). REPORTED, needs product decision |
| `pages/TeamsPage.jsx:94` | PUT `/api/teams/*/members/*` | `server.py:2083` | agrees | body sent; route takes no Pydantic model |
| `pages/TeamsPage.jsx:103` | DELETE `/api/teams/*/members/*` | `server.py:2151` | agrees | no body |
| `pages/TemplatesPage.jsx:90` | GET `/api/templates/projects` | `routers/templates.py:69` | agrees | returns bare-list |
| `pages/TemplatesPage.jsx:91` | GET `/api/templates/tasks` | `routers/templates.py:151` | agrees | returns bare-list |
| `pages/TemplatesPage.jsx:92` | GET `/api/teams` | `server.py:1905` | agrees | returns bare-list |
| `pages/TemplatesPage.jsx:112` | GET `/api/projects/*/columns` | `server.py:998` | agrees | returns bare-list |
| `pages/TemplatesPage.jsx:113` | GET `/api/fields/team/*` | `routers/fields.py:98` | agrees | returns bare-list |
| `pages/TemplatesPage.jsx:120` | POST `/api/templates/projects` | `routers/templates.py:81` | agrees | body sent; route takes no Pydantic model |
| `pages/TemplatesPage.jsx:136` | POST `/api/templates/projects/*/apply` | `routers/templates.py:103` | agrees | no body |
| `pages/TemplatesPage.jsx:155` | DELETE `/api/templates/*/*` | `routers/templates.py:92` | agrees | no body |
| `pages/TemplatesPage.jsx:166` | POST `/api/templates/tasks/*/set-default` | `routers/templates.py:228` | agrees | no body |
| `pages/TimeReportPage.jsx:136` | GET `/api/teams/*` | `server.py:2021` | agrees | returns object; reads .data |
| `pages/TimeReportPage.jsx:149` | GET `/api/time/report` | `routers/time_entries.py:162` | agrees | returns object; reads .data |
| `pages/VetanaPage.jsx:69` | GET `/api/v1/vetana/dashboard` | `routers/vetana.py:1131` | agrees | returns object |
| `pages/VetanaPage.jsx:101` | GET `/api/v1/vetana/statutory-summary` | `routers/vetana.py:1180` | agrees | returns object |
| `pages/VikrayPage.jsx:85` | GET `/api/v1/vikray/dashboard` | `routers/vikray.py:543` | agrees | returns object |
| `pages/client/ClientApprovals.jsx:90` | POST `/api/tasks/*/client-approve` | `approvals_router.py:443` | agrees | body sent; route takes no Pydantic model |
| `pages/client/ClientApprovals.jsx:102` | POST `/api/tasks/*/client-reject` | `approvals_router.py:658` | agrees | body sent; route takes no Pydantic model |
| `pages/client/RequestWork.jsx:55` | POST `/api/client/tasks/request` | `server.py:1327` | agrees | body sent; route takes no Pydantic model |
| `pages/client/useClientPortal.js:45` | GET `/api/client/tasks` | `server.py:1129` | agrees | returns expr |
| `pages/client/useClientPortal.js:46` | GET `/api/client/approvals` | `server.py:1200` | agrees | returns bare-list\|expr |
| `pages/client/useClientPortal.js:47` | GET `/api/client/projects` | `server.py:1173` | agrees | returns bare-list |
| `pages/client/useClientPortal.js:48` | GET `/api/v1/org/profile` | `routers/org_profile.py:190` | agrees | returns expr |
| `pages/customize/TabNotifications.jsx:60` | GET `/api/push/vapid-public-key` | `server.py:3039` | agrees | returns object; reads .data |
| `pages/customize/TabNotifications.jsx:65` | POST `/api/push/subscribe` | `server.py:3043` | agrees | body sent; route takes no Pydantic model |
| `pages/customize/TabNotifications.jsx:76` | POST `/api/push/unsubscribe` | `server.py:3050` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/DashboardsTab.jsx:74` | GET `/api/v1/dristi/dashboards` | `routers/dristi.py:539` | agrees | returns envelope; reads .data+.data.data+isArray(.data); **hand-rolled unwrap** |
| `pages/dristi/DashboardsTab.jsx:88` | POST `/api/v1/dristi/dashboards` | `routers/dristi.py:554` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/DashboardsTab.jsx:100` | DELETE `/api/v1/dristi/dashboards/*` | `routers/dristi.py:609` | agrees | no body |
| `pages/dristi/DashboardsTab.jsx:116` | GET `/api/v1/dristi/widget-types` | `routers/dristi.py:1081` | agrees | returns object; reads .data |
| `pages/dristi/DashboardsTab.jsx:126` | POST `/api/v1/dristi/query` | `routers/dristi.py:976` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/DashboardsTab.jsx:182` | PATCH `/api/v1/dristi/dashboards/*` | `routers/dristi.py:575` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/PivotTab.jsx:47` | GET `/api/v1/dristi/widget-types` | `routers/dristi.py:1081` | agrees | returns object |
| `pages/dristi/PivotTab.jsx:79` | POST `/api/v1/dristi/query` | `routers/dristi.py:976` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/ReportsTab.jsx:65` | GET `/api/v1/dristi/scheduled-reports` | `routers/dristi.py:654` | agrees | returns envelope; reads .data+.data.data+isArray(.data); **hand-rolled unwrap** |
| `pages/dristi/ReportsTab.jsx:79` | POST `/api/v1/dristi/scheduled-reports/*/run-now` | `routers/dristi.py:745` | agrees | no body |
| `pages/dristi/ReportsTab.jsx:88` | DELETE `/api/v1/dristi/scheduled-reports/*` | `routers/dristi.py:730` | agrees | no body |
| `pages/dristi/ReportsTab.jsx:99` | PATCH `/api/v1/dristi/scheduled-reports/*` | `routers/dristi.py:697` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/ReportsTab.jsx:111` | GET `/api/v1/dristi/scheduled-reports/*/logs` | `routers/dristi.py:820` | agrees | returns object; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/dristi/ReportsTab.jsx:142` | POST `/api/v1/dristi/scheduled-reports` | `routers/dristi.py:667` | agrees | body sent; route takes no Pydantic model |
| `pages/dristi/ReportsTab.jsx:167` | GET `/api/v1/dristi/exports/*` | `routers/dristi.py:842` | agrees | returns envelope\|expr; reads .data |
| `pages/dristi/_shared.jsx:77` | GET `(dynamic)` | — | unresolved-1hop | useDristi hook - 5 literal callers (dristi/{HR,Overview,Pipeline,Revenue,Sales}Tab) |
| `pages/esign/CreateTab.jsx:77` | POST `/api/v1/esign/documents` | `routers/esign.py:103` | agrees | body sent; route takes no Pydantic model |
| `pages/esign/CreateTab.jsx:89` | POST `/api/v1/esign/documents/*/upload` | `routers/esign.py:145` | agrees | body sent; route takes no Pydantic model |
| `pages/esign/DetailTab.jsx:48` | GET `/api/v1/esign/documents/*` | `routers/esign.py:204` | agrees | returns object; reads .data |
| `pages/esign/DetailTab.jsx:64` | POST `/api/v1/esign/documents/*/send` | `routers/esign.py:244` | agrees | no body |
| `pages/esign/DetailTab.jsx:75` | POST `/api/v1/esign/documents/*/cancel` | `routers/esign.py:548` | agrees | no body |
| `pages/esign/DetailTab.jsx:86` | POST `/api/v1/esign/documents/*/resend/*` | `routers/esign.py:574` | agrees | no body |
| `pages/esign/DocumentsTab.jsx:38` | GET `(dynamic)` | — | unresolved-1hop | `/v1/esign/documents[?status=]` (ternary, l.37) |
| `pages/ganit/BankTab.jsx:33` | GET `/api/v1/ganit/bank-statements` | `routers/ganit.py:1981` | agrees | returns envelope; reads rows() |
| `pages/ganit/BankTab.jsx:46` | GET `/api/v1/ganit/bank-statements/stats` | `routers/ganit.py:2054` | agrees | returns expr; reads body() |
| `pages/ganit/BankTab.jsx:73` | POST `/api/v1/ganit/bank-statements/import` | `routers/ganit.py:1930` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/BankTab.jsx:91` | POST `/api/v1/ganit/bank-statements/*/unmatch` | `routers/ganit.py:2035` | agrees | no body |
| `pages/ganit/ContractDetail.jsx:31` | GET `/api/v1/ganit/contracts/*` | `routers/ganit.py:1211` | agrees | returns object; reads body() |
| `pages/ganit/ContractDetail.jsx:63` | PATCH `/api/v1/ganit/contracts/*` | `routers/ganit.py:1169` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ContractDetail.jsx:80` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/ganit/ContractDetail.jsx:87` | PATCH `/api/v1/ganit/contracts/*` | `routers/ganit.py:1169` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ContractsTab.jsx:35` | GET `/api/v1/ganit/contracts` | `routers/ganit.py:1109` | agrees | returns envelope; reads rows() |
| `pages/ganit/ContractsTab.jsx:50` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/ganit/ContractsTab.jsx:57` | POST `/api/v1/ganit/contracts` | `routers/ganit.py:1146` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ESignTab.jsx:29` | GET `/api/v1/ganit/contracts` | `routers/ganit.py:1109` | agrees | returns envelope; reads rows() |
| `pages/ganit/ESignTab.jsx:87` | GET `/api/v1/ganit/contracts/*/signature-status` | `routers/ganit.py:1356` | agrees | returns object; reads body() |
| `pages/ganit/ESignTab.jsx:88` | GET `/api/v1/ganit/contracts/*/audit-trail` | `routers/ganit.py:1397` | agrees | returns object; reads body() |
| `pages/ganit/ExpensesTab.jsx:101` | GET `/api/v1/ganit/expenses` | `routers/ganit.py:922` | agrees | returns envelope; reads rows() |
| `pages/ganit/ExpensesTab.jsx:112` | GET `/api/v1/ganit/expense-stats` | `routers/ganit.py:1573` | agrees | returns object; reads body()+rows() |
| `pages/ganit/ExpensesTab.jsx:119` | GET `/api/v1/ganit/expense-categories` | `routers/ganit.py:1057` | agrees | returns envelope; reads rows() |
| `pages/ganit/ExpensesTab.jsx:133` | POST `/api/v1/ganit/expenses` | `routers/ganit.py:970` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ExpensesTab.jsx:159` | PATCH `/api/v1/ganit/expenses/*` | `routers/ganit.py:995` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ExpensesTab.jsx:171` | DELETE `/api/v1/ganit/expenses/*` | `routers/ganit.py:1032` | agrees | no body |
| `pages/ganit/ExpensesTab.jsx:183` | POST `/api/v1/ganit/expense-categories` | `routers/ganit.py:1088` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/InvoiceDetail.jsx:53` | GET `/api/v1/ganit/invoices/*` | `routers/ganit.py:449` | agrees | returns object; reads body() |
| `pages/ganit/InvoiceDetail.jsx:100` | GET `/api/v1/ganit/invoices/*/pdf` | `routers/ganit.py:481` | agrees | returns expr; reads .data |
| `pages/ganit/InvoiceDetail.jsx:120` | POST `/api/v1/ganit/invoices/*/payments` | `routers/ganit.py:618` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/InvoiceDetail.jsx:130` | PATCH `/api/v1/ganit/invoices/*/status` | `routers/ganit.py:795` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/InvoiceDetail.jsx:134` | POST `/api/v1/ganit/invoices/*/accept-estimate` | `routers/ganit.py:842` | agrees | no body |
| `pages/ganit/InvoiceDetail.jsx:138` | POST `/api/v1/ganit/invoices/*/convert-to-invoice` | `routers/ganit.py:870` | agrees | no body |
| `pages/ganit/InvoiceForm.jsx:41` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/ganit/InvoiceForm.jsx:42` | GET `/api/v1/ganit/products` | `routers/ganit.py:281` | agrees | returns envelope; reads rows() |
| `pages/ganit/InvoiceForm.jsx:87` | POST `/api/v1/ganit/invoices` | `routers/ganit.py:399` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/InvoicesTab.jsx:49` | GET `/api/v1/ganit/invoices` | `routers/ganit.py:363` | agrees | returns envelope; reads rows() |
| `pages/ganit/PayablesTab.jsx:53` | GET `/api/v1/ganit/vendor-bills` | `routers/ganit.py:1760` | agrees | returns envelope; reads rows() |
| `pages/ganit/PayablesTab.jsx:66` | GET `/api/v1/ganit/payables-summary` | `routers/ganit.py:1787` | agrees | returns object; reads body()+rows() |
| `pages/ganit/PayablesTab.jsx:73` | GET `/api/v1/ganit/vendors` | `routers/ganit.py:1692` | agrees | returns envelope; reads rows() |
| `pages/ganit/PayablesTab.jsx:93` | POST `/api/v1/ganit/vendors` | `routers/ganit.py:1710` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/PayablesTab.jsx:109` | POST `/api/v1/ganit/vendor-bills` | `routers/ganit.py:1841` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ProductsTab.jsx:75` | GET `/api/v1/ganit/products` | `routers/ganit.py:281` | agrees | returns envelope; reads rows() |
| `pages/ganit/ProductsTab.jsx:91` | POST `/api/v1/ganit/products` | `routers/ganit.py:298` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ProductsTab.jsx:114` | PATCH `/api/v1/ganit/products/*` | `routers/ganit.py:316` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/ProductsTab.jsx:125` | DELETE `/api/v1/ganit/products/*` | `routers/ganit.py:346` | agrees | no body |
| `pages/ganit/RecurringTab.jsx:36` | GET `/api/v1/ganit/recurring` | `routers/ganit.py:1420` | agrees | returns envelope; reads rows() |
| `pages/ganit/RecurringTab.jsx:50` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/ganit/RecurringTab.jsx:66` | POST `/api/v1/ganit/recurring` | `routers/ganit.py:1441` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/RecurringTab.jsx:79` | DELETE `/api/v1/ganit/recurring/*` | `routers/ganit.py:1555` | agrees | no body |
| `pages/ganit/RecurringTab.jsx:90` | POST `/api/v1/ganit/recurring/*/generate` | `routers/ganit.py:1471` | agrees | no body |
| `pages/ganit/SignatureDetail.jsx:64` | POST `/api/v1/ganit/contracts/*/send-for-signature` | `routers/ganit.py:1259` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/SignatureDetail.jsx:90` | POST `/api/v1/ganit/contracts/*/cancel-signature` | `routers/ganit.py:1384` | agrees | no body |
| `pages/ganit/StatsTab.jsx:43` | GET `/api/v1/ganit/stats` | `routers/ganit.py:661` | agrees | returns expr; reads body() |
| `pages/ganit/StatsTab.jsx:44` | GET `/api/v1/ganit/cash-position` | `routers/ganit.py:691` | agrees | returns object; reads body() |
| `pages/ganit/TimesheetTab.jsx:20` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/ganit/TimesheetTab.jsx:45` | POST `/api/v1/ganit/invoices/from-time-entries` | `routers/ganit.py:2084` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/VendorBillDetail.jsx:36` | GET `/api/v1/ganit/vendor-bills/*` | `routers/ganit.py:1817` | agrees | returns object; reads body() |
| `pages/ganit/VendorBillDetail.jsx:69` | POST `/api/v1/ganit/vendor-bills/*/payments` | `routers/ganit.py:1880` | agrees | body sent; route takes no Pydantic model |
| `pages/ganit/_shared.jsx:103` | GET `/api/v1/org/profile` | `routers/org_profile.py:190` | agrees | returns expr |
| `pages/graha/ActivitiesTab.jsx:54` | GET `(dynamic)` | — | unresolved-1hop | `/v1/graha/activities[?activity_type=]` (l.51-53) |
| `pages/graha/ActivitiesTab.jsx:70` | GET `/api/v1/graha/deals` | `routers/graha.py:655` | agrees | returns envelope; reads rows() |
| `pages/graha/ActivitiesTab.jsx:70` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/graha/ActivitiesTab.jsx:80` | POST `/api/v1/graha/activities` | `routers/graha.py:922` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/ActivitiesTab.jsx:92` | PATCH `/api/v1/graha/activities/*/complete` | `routers/graha.py:985` | agrees | no body |
| `pages/graha/ApprovalsTab.jsx:41` | GET `/api/v1/graha/approval-rules*` | `routers/graha.py:2507` | agrees | returns envelope; reads rows() |
| `pages/graha/ApprovalsTab.jsx:42` | GET `/api/v1/graha/approval-requests` | `routers/graha.py:2590` | agrees | returns envelope; reads rows() |
| `pages/graha/ApprovalsTab.jsx:56` | POST `/api/v1/graha/approval-rules` | `routers/graha.py:2525` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/ApprovalsTab.jsx:67` | DELETE `/api/v1/graha/approval-rules/*` | `routers/graha.py:2572` | agrees | no body |
| `pages/graha/ApprovalsTab.jsx:75` | POST `/api/v1/graha/approval-requests/*/approve` | `routers/graha.py:2617` | agrees | no body |
| `pages/graha/ApprovalsTab.jsx:83` | POST `/api/v1/graha/approval-requests/*/reject` | `routers/graha.py:2636` | agrees | no body |
| `pages/graha/AutomationsTab.jsx:38` | GET `/api/v1/graha/automations` | `routers/graha.py:1805` | agrees | returns envelope; reads rows() |
| `pages/graha/AutomationsTab.jsx:48` | GET `/api/v1/graha/automation-logs` | `routers/graha.py:1889` | agrees | returns envelope; reads rows() |
| `pages/graha/AutomationsTab.jsx:57` | POST `/api/v1/graha/automations` | `routers/graha.py:1821` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/AutomationsTab.jsx:66` | PATCH `/api/v1/graha/automations/*/toggle` | `routers/graha.py:1854` | agrees | no body |
| `pages/graha/AutomationsTab.jsx:74` | DELETE `/api/v1/graha/automations/*` | `routers/graha.py:1872` | agrees | no body |
| `pages/graha/ClientsTab.jsx:35` | GET `/api/v1/graha/clients*` | `routers/graha.py:154` | agrees | returns envelope; reads rows() |
| `pages/graha/ClientsTab.jsx:47` | PATCH `/api/v1/graha/clients/*` | `routers/graha.py:219` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/ClientsTab.jsx:50` | POST `/api/v1/graha/clients` | `routers/graha.py:172` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/ClientsTab.jsx:69` | GET `/api/v1/graha/clients/*` | `routers/graha.py:192` | agrees | returns object; reads body() |
| `pages/graha/ClientsTab.jsx:83` | DELETE `/api/v1/graha/clients/*` | `routers/graha.py:250` | agrees | no body |
| `pages/graha/ContactTimeline.jsx:29` | GET `/api/v1/graha/contacts/*/timeline*` | `routers/graha.py:1364` | agrees | returns envelope; reads body() |
| `pages/graha/ContactsTab.jsx:43` | GET `/api/v1/graha/clients` | `routers/graha.py:154` | agrees | returns envelope; reads rows() |
| `pages/graha/ContactsTab.jsx:54` | GET `(dynamic)` | — | unresolved-1hop | `/v1/graha/contacts?[search=][contact_type=]` (l.51-53) |
| `pages/graha/ContactsTab.jsx:67` | POST `/api/v1/graha/contacts` | `routers/graha.py:313` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/ContactsTab.jsx:90` | PATCH `/api/v1/graha/contacts/*` | `routers/graha.py:554` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/ContactsTab.jsx:102` | GET `/api/v1/graha/contacts/*` | `routers/graha.py:507` | agrees | returns object; reads body() |
| `pages/graha/ContactsTab.jsx:116` | DELETE `/api/v1/graha/contacts/*` | `routers/graha.py:599` | agrees | no body |
| `pages/graha/ContactsTab.jsx:125` | POST `/api/v1/graha/contacts/*/convert` | `routers/graha.py:1213` | agrees | no body |
| `pages/graha/ContactsTab.jsx:133` | DELETE `/api/v1/graha/contacts/*/labels/*` | `routers/graha.py:1193` | agrees | no body |
| `pages/graha/CustomFieldsTab.jsx:34` | GET `/api/v1/graha/custom-fields` | `routers/graha.py:2258` | agrees | returns envelope; reads rows() |
| `pages/graha/CustomFieldsTab.jsx:46` | POST `/api/v1/graha/custom-fields` | `routers/graha.py:2276` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/CustomFieldsTab.jsx:56` | DELETE `/api/v1/graha/custom-fields/*` | `routers/graha.py:2305` | agrees | no body |
| `pages/graha/DealsTab.jsx:61` | GET `(dynamic)` | — | unresolved-1hop | `/v1/graha/deals?[stage=]` (l.59-60) |
| `pages/graha/DealsTab.jsx:74` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/graha/DealsTab.jsx:74` | GET `/api/v1/graha/clients` | `routers/graha.py:154` | agrees | returns envelope; reads rows() |
| `pages/graha/DealsTab.jsx:84` | POST `/api/v1/graha/deals` | `routers/graha.py:692` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/DealsTab.jsx:96` | DELETE `/api/v1/graha/deals/*` | `routers/graha.py:882` | agrees | no body |
| `pages/graha/DealsTab.jsx:120` | PATCH `/api/v1/graha/deals/*` | `routers/graha.py:817` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/DealsTab.jsx:137` | POST `/api/v1/ganit/invoices/from-deal/*` | `routers/ganit.py:1621` | agrees | no body |
| `pages/graha/DealsTab.jsx:164` | PATCH `/api/v1/graha/deals/*` | `routers/graha.py:817` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/DealsTab.jsx:175` | PATCH `/api/v1/graha/deals/*` | `routers/graha.py:817` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/DedupeTab.jsx:54` | GET `/api/v1/graha/contacts/duplicates` | `routers/graha.py:351` | agrees | returns envelope; reads rows() |
| `pages/graha/DedupeTab.jsx:67` | GET `/api/v1/graha/contacts/merges` | `routers/graha.py:408` | agrees | returns envelope; reads rows() |
| `pages/graha/DedupeTab.jsx:88` | POST `/api/v1/graha/contacts/*/merge` | `routers/graha.py:475` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/DedupeTab.jsx:101` | POST `/api/v1/graha/contacts/merges/*/undo` | `routers/graha.py:431` | agrees | no body |
| `pages/graha/DocumentsTab.jsx:44` | GET `(dynamic)` | — | unresolved-1hop | `/v1/graha/documents?[folder=][search=]` (l.41-43) |
| `pages/graha/DocumentsTab.jsx:57` | GET `/api/v1/graha/documents/folders` | `routers/graha.py:2737` | agrees | returns envelope; reads rows() |
| `pages/graha/DocumentsTab.jsx:67` | POST `/api/v1/graha/documents` | `routers/graha.py:2716` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/DocumentsTab.jsx:80` | DELETE `/api/v1/graha/documents/*` | `routers/graha.py:2807` | agrees | no body |
| `pages/graha/FollowUpsTab.jsx:34` | GET `(dynamic)` | — | **enum-drift** | Sent `?status=pending\|completed\|overdue`; `list_follow_ups` (routers/graha.py:1003-1008) declares no `status` - only `is_completed: bool`. FastAPI dropped it, so "Completed" showed the OPEN list. FIXED |
| `pages/graha/FollowUpsTab.jsx:46` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/graha/FollowUpsTab.jsx:46` | GET `/api/v1/graha/deals` | `routers/graha.py:655` | agrees | returns envelope; reads rows() |
| `pages/graha/FollowUpsTab.jsx:56` | POST `/api/v1/graha/follow-ups` | `routers/graha.py:1054` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/FollowUpsTab.jsx:67` | PATCH `/api/v1/graha/follow-ups/*/complete` | `routers/graha.py:1078` | agrees | no body |
| `pages/graha/FollowUpsTab.jsx:76` | DELETE `/api/v1/graha/follow-ups/*` | `routers/graha.py:1094` | agrees | no body |
| `pages/graha/KanbanTab.jsx:78` | GET `/api/v1/graha/deals/kanban` | `routers/graha.py:737` | agrees | returns object; reads body() |
| `pages/graha/KanbanTab.jsx:120` | PATCH `/api/v1/graha/deals/*` | `routers/graha.py:817` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/LabelsTab.jsx:37` | GET `/api/v1/graha/labels` | `routers/graha.py:1111` | agrees | returns envelope; reads rows() |
| `pages/graha/LabelsTab.jsx:50` | POST `/api/v1/graha/labels` | `routers/graha.py:1126` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/LabelsTab.jsx:62` | DELETE `/api/v1/graha/labels/*` | `routers/graha.py:1145` | agrees | no body |
| `pages/graha/LabelsTab.jsx:71` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads rows() |
| `pages/graha/LabelsTab.jsx:79` | POST `/api/v1/graha/contacts/*/labels/*` | `routers/graha.py:1160` | agrees | no body |
| `pages/graha/PipelineTab.jsx:63` | GET `/api/v1/graha/deals/kanban` | `routers/graha.py:737` | agrees | returns object; reads body() |
| `pages/graha/PipelineTab.jsx:80` | GET `/api/v1/graha/follow-ups` | `routers/graha.py:1003` | agrees | returns envelope; reads rows() |
| `pages/graha/PipelineTab.jsx:90` | GET `/api/v1/graha/reports/forecast` | `routers/graha.py:2090` | agrees | returns object; reads body() |
| `pages/graha/PipelineTab.jsx:103` | GET `/api/v1/org/members` | `routers/org_members.py:72` | agrees | returns expr; reads rows() |
| `pages/graha/ReportsTab.jsx:39` | GET `/api/v1/graha/reports/conversion` | `routers/graha.py:2019` | agrees | returns object; reads body() |
| `pages/graha/ReportsTab.jsx:40` | GET `/api/v1/graha/reports/forecast` | `routers/graha.py:2090` | agrees | returns object; reads body() |
| `pages/graha/ReportsTab.jsx:41` | GET `/api/v1/graha/reports/pipeline-velocity` | `routers/graha.py:1999` | agrees | returns envelope; reads body() |
| `pages/graha/ReportsTab.jsx:42` | GET `/api/v1/graha/reports/source-analysis` | `routers/graha.py:2115` | agrees | returns envelope; reads body() |
| `pages/graha/ReportsTab.jsx:43` | GET `/api/v1/graha/reports/rep-performance` | `routers/graha.py:2066` | agrees | returns envelope; reads body() |
| `pages/graha/TerritoriesTab.jsx:27` | GET `/api/v1/graha/territories` | `routers/graha.py:2148` | agrees | returns envelope; reads rows() |
| `pages/graha/TerritoriesTab.jsx:39` | POST `/api/v1/graha/territories` | `routers/graha.py:2163` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/TerritoriesTab.jsx:50` | DELETE `/api/v1/graha/territories/*` | `routers/graha.py:2202` | agrees | no body |
| `pages/graha/TodayTab.jsx:41` | GET `/api/v1/graha/today` | `routers/graha.py:1243` | agrees | returns object; reads body() |
| `pages/graha/WebFormsTab.jsx:35` | GET `/api/v1/graha/web-forms` | `routers/graha.py:2334` | agrees | returns envelope; reads rows() |
| `pages/graha/WebFormsTab.jsx:47` | POST `/api/v1/graha/web-forms` | `routers/graha.py:2350` | agrees | body sent; route takes no Pydantic model |
| `pages/graha/WebFormsTab.jsx:58` | DELETE `/api/v1/graha/web-forms/*` | `routers/graha.py:2379` | agrees | no body |
| `pages/graha/WebFormsTab.jsx:66` | GET `/api/v1/graha/web-forms/*/submissions` | `routers/graha.py:2397` | agrees | returns envelope; reads rows() |
| `pages/hub/BrandTab.jsx:37` | PUT `/api/v1/hub/clients/*/brand` | `routers/hub.py:361` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/ChatTab.jsx:37` | GET `/api/v1/hub/chat/sessions/*/messages` | `routers/hub_chat.py:227` | agrees | returns envelope; reads .data.data; **hand-rolled unwrap** |
| `pages/hub/ChatTab.jsx:46` | POST `/api/v1/hub/clients/*/chat/sessions` | `routers/hub_chat.py:196` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/ChatTab.jsx:63` | POST `/api/v1/hub/chat/sessions/*/send` | `routers/hub_chat.py:252` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/ChatTab.jsx:87` | DELETE `/api/v1/hub/chat/sessions/*` | `routers/hub_chat.py:418` | agrees | no body |
| `pages/hub/ContentTab.jsx:39` | PATCH `/api/v1/hub/clients/*/content/*/review` | `routers/hub.py:506` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/CreditsTab.jsx:39` | POST `/api/v1/hub/clients/*/credits/topup` | `routers/hub.py:566` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/GenerateTab.jsx:29` | POST `/api/v1/hub/clients/*/generate` | `routers/hub.py:395` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/KnowledgeTab.jsx:34` | POST `/api/v1/hub/clients/*/kb` | `routers/hub_chat.py:75` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/KnowledgeTab.jsx:48` | POST `/api/v1/hub/clients/*/kb/faq` | `routers/hub_chat.py:107` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/KnowledgeTab.jsx:60` | DELETE `/api/v1/hub/clients/*/kb/*` | `routers/hub_chat.py:136` | agrees | no body |
| `pages/hub/KnowledgeTab.jsx:74` | GET `/api/v1/hub/clients/*/kb/search` | `routers/hub_chat.py:155` | agrees | returns object; reads .data |
| `pages/hub/PublishTab.jsx:59` | GET `/api/v1/hub/clients/*/social-accounts` | `routers/hub_publish.py:497` | agrees | returns envelope |
| `pages/hub/PublishTab.jsx:70` | GET `/api/v1/hub/clients/*/publish/queue` | `routers/hub_publish.py:718` | agrees | returns envelope |
| `pages/hub/PublishTab.jsx:80` | GET `/api/v1/hub/clients/*/platforms` | `routers/hub_publish.py:820` | agrees | returns object; reads .data |
| `pages/hub/PublishTab.jsx:98` | GET `/api/v1/hub/clients/*/calendar` | `routers/hub_publish.py:753` | agrees | returns envelope |
| `pages/hub/PublishTab.jsx:126` | PUT `/api/v1/hub/clients/*/platforms` | `routers/hub_publish.py:840` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/PublishTab.jsx:138` | GET `/api/v1/hub/oauth/*/authorize` | `routers/hub_publish.py:222` | agrees | returns object; reads .data |
| `pages/hub/PublishTab.jsx:150` | POST `/api/v1/hub/clients/*/social-accounts` | `routers/hub_publish.py:518` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/PublishTab.jsx:162` | DELETE `/api/v1/hub/clients/*/social-accounts/*` | `routers/hub_publish.py:557` | agrees | no body |
| `pages/hub/PublishTab.jsx:173` | GET `/api/v1/hub/clients/*/content` | `routers/hub.py:459` | agrees | returns envelope |
| `pages/hub/PublishTab.jsx:185` | POST `/api/v1/hub/clients/*/publish/bulk-schedule` | `routers/hub_publish.py:626` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/PublishTab.jsx:190` | POST `/api/v1/hub/clients/*/publish/schedule` | `routers/hub_publish.py:581` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/PublishTab.jsx:206` | POST `/api/v1/hub/publish/queue/*/*` | `routers/hub_publish.py:676` | agrees | no body |
| `pages/hub/_shared.jsx:202` | GET `(dynamic)` | — | unresolved-1hop | useResource/useList hook - 4 literal callers (hub/{Chat,Content,Credits,Knowledge}Tab) |
| `pages/hub/skills/AssignedTab.jsx:28` | POST `/api/v1/hub/clients/*/skills/*/run` | `routers/hub.py:811` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/skills/AssignedTab.jsx:43` | DELETE `/api/v1/hub/clients/*/skills/*` | `routers/hub.py:792` | agrees | no body |
| `pages/hub/skills/CatalogTab.jsx:23` | POST `/api/v1/hub/clients/*/skills/*` | `routers/hub.py:760` | agrees | body sent; route takes no Pydantic model |
| `pages/hub/skills/CatalogTab.jsx:33` | DELETE `/api/v1/hub/skills/templates/*` | `routers/hub.py:723` | agrees | no body |
| `pages/hub/skills/CreateTab.jsx:40` | POST `/api/v1/hub/skills/templates` | `routers/hub.py:687` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/AnnouncementsTab.jsx:33` | PATCH `/api/v1/manav/announcements/*` | `routers/manav.py:1154` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/AnnouncementsTab.jsx:36` | POST `/api/v1/manav/announcements` | `routers/manav.py:1117` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/AnnouncementsTab.jsx:48` | DELETE `/api/v1/manav/announcements/*` | `routers/manav.py:1192` | agrees | no body |
| `pages/manav/AssetsTab.jsx:61` | POST `/api/v1/manav/assets` | `routers/manav.py:2202` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/AssetsTab.jsx:76` | DELETE `/api/v1/manav/assets/*` | `routers/manav.py:2293` | agrees | no body |
| `pages/manav/AssetsTab.jsx:88` | POST `/api/v1/manav/assets/*/assign` | `routers/manav.py:2312` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/AssetsTab.jsx:101` | POST `/api/v1/manav/assets/*/return` | `routers/manav.py:2349` | agrees | no body |
| `pages/manav/AssetsTab.jsx:123` | PATCH `/api/v1/manav/assets/*` | `routers/manav.py:2250` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/AttendanceTab.jsx:145` | POST `/api/v1/manav/attendance` | `routers/manav.py:672` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/DepartmentsTab.jsx:31` | POST `/api/v1/manav/departments` | `routers/manav.py:564` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/DepartmentsTab.jsx:45` | PATCH `/api/v1/manav/departments/*` | `routers/manav.py:581` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/DepartmentsTab.jsx:56` | DELETE `/api/v1/manav/departments/*` | `routers/manav.py:601` | agrees | no body |
| `pages/manav/EmployeesTab.jsx:53` | POST `/api/v1/manav/employees` | `routers/manav.py:361` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/EmployeesTab.jsx:259` | PATCH `/api/v1/manav/employees/*` | `routers/manav.py:487` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/EmployeesTab.jsx:272` | GET `/api/v1/manav/employees/*/sensitive` | `routers/manav.py:434` | agrees | returns object; reads .data |
| `pages/manav/ExpensesTab.jsx:32` | PATCH `/api/v1/manav/expense-claims/*/*` | `routers/manav.py:1896` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/ExpensesTab.jsx:143` | POST `/api/v1/manav/expense-claims` | `routers/manav.py:1859` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/HolidaysTab.jsx:29` | POST `/api/v1/manav/holidays` | `routers/manav.py:995` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/HolidaysTab.jsx:41` | DELETE `/api/v1/manav/holidays/*` | `routers/manav.py:1012` | agrees | no body |
| `pages/manav/LeavesTab.jsx:54` | PATCH `/api/v1/manav/leaves/*/action` | `routers/manav.py:898` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/LeavesTab.jsx:186` | GET `/api/v1/manav/leaves/check-conflicts` | `routers/manav.py:1211` | agrees | returns object; reads .data |
| `pages/manav/LeavesTab.jsx:325` | POST `/api/v1/manav/leave-types` | `routers/manav.py:778` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/LeavesTab.jsx:383` | POST `/api/v1/manav/leaves` | `routers/manav.py:846` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/RecruitmentTab.jsx:40` | PATCH `/api/v1/manav/candidates/*/stage` | `routers/manav.py:2087` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/RecruitmentTab.jsx:50` | POST `/api/v1/manav/candidates/*/hire` | `routers/manav.py:2111` | agrees | no body |
| `pages/manav/RecruitmentTab.jsx:211` | PATCH `/api/v1/manav/job-openings/*` | `routers/manav.py:2002` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/RecruitmentTab.jsx:215` | POST `/api/v1/manav/job-openings` | `routers/manav.py:1985` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/RecruitmentTab.jsx:268` | POST `/api/v1/manav/candidates` | `routers/manav.py:2062` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/ScheduleGrid.jsx:48` | POST `/api/v1/manav/schedules` | `routers/manav.py:1449` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/ShiftBids.jsx:24` | POST `/api/v1/manav/shift-bids` | `routers/manav.py:1630` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/ShiftBids.jsx:39` | POST `/api/v1/manav/shift-bids/*/apply` | `routers/manav.py:1644` | agrees | no body |
| `pages/manav/ShiftDefinitions.jsx:48` | POST `/api/v1/manav/shifts` | `routers/manav.py:1346` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/ShiftDefinitions.jsx:74` | PATCH `/api/v1/manav/shifts/*` | `routers/manav.py:1364` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/SwapRequests.jsx:32` | PATCH `/api/v1/manav/swaps/*` | `routers/manav.py:1761` | agrees | no body |
| `pages/manav/SwapRequests.jsx:129` | POST `/api/v1/manav/swaps` | `routers/manav.py:1706` | agrees | body sent; route takes no Pydantic model |
| `pages/manav/_shared.jsx:138` | GET `(dynamic)` | — | unresolved-1hop | useResource/useList hook - 28 literal callers across pages/manav/* |
| `pages/onboarding/OnboardingPage.jsx:112` | GET `/api/projects/*/columns` | `server.py:998` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/onboarding/OnboardingPage.jsx:119` | PUT `/api/projects/*/columns/*` | `server.py:1018` | agrees | body sent; route takes no Pydantic model |
| `pages/onboarding/OnboardingPage.jsx:122` | POST `/api/projects/*/columns` | `server.py:1007` | agrees | body sent; route takes no Pydantic model |
| `pages/onboarding/OnboardingPage.jsx:127` | DELETE `/api/projects/*/columns/*` | `server.py:1034` | agrees | no body |
| `pages/onboarding/OnboardingPage.jsx:224` | POST `/api/v1/org/invites` | `routers/org_invites.py:222` | agrees | body sent; route takes no Pydantic model |
| `pages/onboarding/OnboardingPage.jsx:257` | POST `/api/teams` | `server.py:1958` | agrees | body sent; route takes no Pydantic model |
| `pages/org/TabBilling.jsx:34` | GET `/api/v1/subscription/cost-report` | `routers/subscription.py:472` | agrees | returns object; reads .data |
| `pages/org/TabBilling.jsx:117` | GET `/api/v1/subscription/current` | `routers/subscription.py:95` | agrees | returns object |
| `pages/org/TabBilling.jsx:118` | GET `/api/v1/subscription/invoices` | `routers/subscription.py:412` | agrees | returns envelope |
| `pages/org/TabBilling.jsx:119` | GET `/api/v1/subscription/usage` | `routers/subscription.py:437` | agrees | returns object |
| `pages/org/TabBilling.jsx:120` | GET `/api/v1/subscription/plans` | `routers/subscription.py:59` | agrees | returns object |
| `pages/org/TabBilling.jsx:138` | GET `/api/v1/subscription/cost-report/pdf` | `routers/subscription.py:551` | agrees | returns expr; reads .data |
| `pages/org/TabMembers.jsx:177` | GET `/api/v1/org/members` | `routers/org_members.py:72` | agrees | returns expr; reads .data |
| `pages/org/TabMembers.jsx:191` | GET `/api/v1/org/invites` | `routers/org_invites.py:298` | agrees | returns expr; reads .data |
| `pages/org/TabMembers.jsx:202` | GET `/api/v1/subscription/current` | `routers/subscription.py:95` | agrees | returns object; reads .data |
| `pages/org/TabMembers.jsx:245` | PUT `/api/v1/org/members/*/role` | `routers/org_members.py:287` | agrees | no body |
| `pages/org/TabMembers.jsx:260` | DELETE `/api/v1/org/members/*` | `routers/org_members.py:246` | agrees | no body |
| `pages/org/TabMembers.jsx:284` | POST `/api/v1/org/members` | `routers/org_members.py:112` | agrees | body sent; route takes no Pydantic model |
| `pages/org/TabMembers.jsx:298` | POST `/api/v1/org/invites` | `routers/org_invites.py:222` | agrees | body sent; route takes no Pydantic model |
| `pages/org/TabMembers.jsx:313` | DELETE `/api/v1/org/invites/*` | `routers/org_invites.py:330` | agrees | no body |
| `pages/org/TabMembers.jsx:349` | PUT `/api/v1/org/members/*/modules` | `routers/org_members.py:311` | agrees | body sent; route takes no Pydantic model |
| `pages/org/TabModules.jsx:44` | GET `/api/v1/subscription/current` | `routers/subscription.py:95` | agrees | returns object; reads .data |
| `pages/org/TabProfile.jsx:74` | GET `/api/v1/org/profile` | `routers/org_profile.py:190` | agrees | returns expr |
| `pages/org/TabProfile.jsx:102` | POST `/api/upload` | `routers/uploads.py:88` | agrees | body sent; route takes no Pydantic model |
| `pages/org/TabProfile.jsx:133` | PATCH `/api/v1/org/profile` | `routers/org_profile.py:217` | agrees | body sent; route takes no Pydantic model |
| `pages/pahchan/Corrections.jsx:73` | GET `/api/v1/pahchan/regularisations` | `routers/pahchan_attendance.py:121` | agrees | returns bare-list; reads rows() |
| `pages/pahchan/Corrections.jsx:98` | GET `/api/v1/pahchan/regularisations` | `routers/pahchan_attendance.py:121` | agrees | returns bare-list |
| `pages/pahchan/Corrections.jsx:118` | PATCH `/api/v1/pahchan/regularisations/*` | `routers/pahchan_attendance.py:149` | agrees | body sent; route takes no Pydantic model |
| `pages/pahchan/EnrollQueue.jsx:47` | GET `/api/v1/pahchan/enrollment/photos/*/url` | `routers/pahchan.py:762` | agrees | returns object; reads .data |
| `pages/pahchan/EnrollQueue.jsx:93` | GET `/api/v1/pahchan/enrollment/queue/pending` | `routers/pahchan.py:949` | agrees | returns object; reads body()+rows() |
| `pages/pahchan/EnrollQueue.jsx:117` | POST `/api/v1/pahchan/enrollment/*/approve` | `routers/pahchan.py:913` | agrees | no body |
| `pages/pahchan/History.jsx:81` | GET `/api/v1/pahchan/me` | `routers/pahchan.py:484` | agrees | returns object; reads body() |
| `pages/pahchan/PahchanPolicy.jsx:109` | GET `/api/v1/pahchan/policy` | `routers/pahchan.py:990` | agrees | returns expr; reads body() |
| `pages/pahchan/PahchanPolicy.jsx:176` | PATCH `/api/v1/pahchan/policy` | `routers/pahchan.py:1000` | agrees | body sent; route takes no Pydantic model |
| `pages/pahchan/PublishPayroll.jsx:72` | GET `/api/v1/pahchan/policy` | `routers/pahchan.py:990` | agrees | returns expr; reads body() |
| `pages/pahchan/PublishPayroll.jsx:84` | POST `/api/v1/pahchan/attendance/publish` | `routers/pahchan_attendance.py:203` | agrees | body sent; route takes no Pydantic model |
| `pages/pahchan/Register.jsx:131` | GET `(dynamic)` | — | unresolved-1hop | usePhotoUrl hook - 3 literal callers (l.197-199) |
| `pages/pahchan/Register.jsx:452` | GET `/api/v1/pahchan/register` | `routers/pahchan.py:528` | agrees | returns object; reads body()+rows() |
| `pages/pahchan/Register.jsx:471` | GET `/api/v1/pahchan/policy` | `routers/pahchan.py:990` | agrees | returns expr; reads body() |
| `pages/pahchan/Register.jsx:550` | PATCH `/api/v1/pahchan/punches/*/review` | `routers/pahchan.py:591` | agrees | body sent; route takes no Pydantic model |
| `pages/pahchan/Sites.jsx:62` | GET `/api/v1/pahchan/sites` | `routers/pahchan.py:670` | agrees | returns envelope; reads .data.data+rows() |
| `pages/pahchan/Sites.jsx:132` | POST `/api/v1/pahchan/sites` | `routers/pahchan.py:685` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/AdsTab.jsx:62` | GET `/api/v1/prachar/ads/overview` | `routers/prachar_ads.py:138` | agrees | returns expr; reads body()+rows() |
| `pages/prachar/AdsTab.jsx:63` | GET `/api/v1/prachar/ads/accounts` | `routers/prachar_ads.py:37` | agrees | returns bare-list; reads body()+rows() |
| `pages/prachar/AdsTab.jsx:73` | POST `/api/v1/prachar/ads/accounts/sync` | `routers/prachar_ads.py:50` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/AdsTab.jsx:168` | GET `/api/v1/prachar/ads/campaigns` | `routers/prachar_ads.py:67` | agrees | returns bare-list; reads rows() |
| `pages/prachar/AdsTab.jsx:203` | GET `/api/v1/prachar/ads/insights` | `routers/prachar_ads.py:95` | agrees | returns bare-list; reads rows() |
| `pages/prachar/AdsTab.jsx:256` | POST `/api/v1/prachar/ads/analyse` | `routers/prachar_ads.py:170` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/AutomationsTab.jsx:48` | GET `/api/v1/prachar/automations` | `routers/prachar.py:465` | agrees | returns envelope; reads rows() |
| `pages/prachar/AutomationsTab.jsx:56` | POST `/api/v1/prachar/automations` | `routers/prachar.py:480` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/AutomationsTab.jsx:72` | PATCH `/api/v1/prachar/automations/*` | `routers/prachar.py:498` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/AutomationsTab.jsx:81` | DELETE `/api/v1/prachar/automations/*` | `routers/prachar.py:530` | agrees | no body |
| `pages/prachar/CampaignsTab.jsx:63` | GET `/api/v1/prachar/campaigns` | `routers/prachar.py:187` | agrees | returns envelope; reads rows() |
| `pages/prachar/CampaignsTab.jsx:102` | PATCH `/api/v1/prachar/campaigns/*` | `routers/prachar.py:240` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/CampaignsTab.jsx:121` | PATCH `/api/v1/prachar/campaigns/*` | `routers/prachar.py:240` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/CampaignsTab.jsx:122` | POST `/api/v1/prachar/campaigns` | `routers/prachar.py:205` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/CampaignsTab.jsx:405` | GET `/api/v1/prachar/campaigns/*/stats` | `routers/prachar.py:434` | agrees | returns expr; reads body() |
| `pages/prachar/CampaignsTab.jsx:406` | GET `/api/v1/prachar/campaigns/*/audience` | `routers/prachar.py:301` | agrees | returns object; reads body() |
| `pages/prachar/CampaignsTab.jsx:413` | POST `/api/v1/prachar/campaigns/*/send` | `routers/prachar.py:320` | agrees | no body |
| `pages/prachar/DashboardTab.jsx:24` | GET `/api/v1/prachar/dashboard` | `routers/prachar.py:600` | agrees | returns object; reads body() |
| `pages/prachar/EventsTab.jsx:34` | GET `/api/v1/prachar/events` | `routers/prachar.py:970` | agrees | returns envelope; reads rows() |
| `pages/prachar/EventsTab.jsx:60` | PATCH `/api/v1/prachar/events/*` | `routers/prachar.py:1036` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/EventsTab.jsx:61` | POST `/api/v1/prachar/events` | `routers/prachar.py:992` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/EventsTab.jsx:73` | DELETE `/api/v1/prachar/events/*` | `routers/prachar.py:1084` | agrees | no body |
| `pages/prachar/EventsTab.jsx:78` | PATCH `/api/v1/prachar/events/*` | `routers/prachar.py:1036` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/EventsTab.jsx:198` | GET `/api/v1/prachar/events/*/registrations` | `routers/prachar.py:1141` | agrees | returns envelope; reads rows() |
| `pages/prachar/EventsTab.jsx:209` | POST `/api/v1/prachar/events/*/register` | `routers/prachar.py:1102` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/EventsTab.jsx:220` | PATCH `/api/v1/prachar/events/*/registrations/*` | `routers/prachar.py:1159` | agrees | no body |
| `pages/prachar/SequencesTab.jsx:38` | GET `/api/v1/prachar/sequences` | `routers/prachar.py:714` | agrees | returns envelope; reads rows() |
| `pages/prachar/SequencesTab.jsx:47` | POST `/api/v1/prachar/sequences` | `routers/prachar.py:727` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/SequencesTab.jsx:175` | GET `/api/v1/prachar/sequences/*` | `routers/prachar.py:739` | agrees | returns object; reads body()+rows() |
| `pages/prachar/SequencesTab.jsx:176` | GET `/api/v1/prachar/sequences/*/stats` | `routers/prachar.py:904` | agrees | returns object; reads body()+rows() |
| `pages/prachar/SequencesTab.jsx:179` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope; reads body()+rows() |
| `pages/prachar/SequencesTab.jsx:194` | POST `/api/v1/prachar/sequences/*/steps` | `routers/prachar.py:805` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/SequencesTab.jsx:209` | DELETE `/api/v1/prachar/sequences/*/steps/*` | `routers/prachar.py:825` | agrees | no body |
| `pages/prachar/SequencesTab.jsx:216` | POST `/api/v1/prachar/sequences/*/enroll` | `routers/prachar.py:837` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/SequencesTab.jsx:236` | POST `/api/v1/prachar/sequences/*/pause` | `routers/prachar.py:888` | agrees | no body |
| `pages/prachar/SequencesTab.jsx:241` | PATCH `/api/v1/prachar/sequences/*` | `routers/prachar.py:766` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/TemplatesTab.jsx:44` | GET `/api/v1/prachar/templates` | `routers/prachar.py:87` | agrees | returns envelope; reads rows() |
| `pages/prachar/TemplatesTab.jsx:67` | PATCH `/api/v1/prachar/templates/*` | `routers/prachar.py:137` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/TemplatesTab.jsx:68` | POST `/api/v1/prachar/templates` | `routers/prachar.py:102` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/TemplatesTab.jsx:78` | DELETE `/api/v1/prachar/templates/*` | `routers/prachar.py:167` | agrees | no body |
| `pages/prachar/TemplatesTab.jsx:84` | POST `/api/v1/prachar/templates` | `routers/prachar.py:102` | agrees | body sent; route takes no Pydantic model |
| `pages/prachar/UnsubscribesTab.jsx:33` | GET `/api/v1/prachar/unsubscribes` | `routers/prachar.py:550` | agrees | returns envelope; reads rows() |
| `pages/prachar/UnsubscribesTab.jsx:53` | POST `/api/v1/prachar/unsubscribes` | `routers/prachar.py:564` | agrees | no body |
| `pages/prachar/UnsubscribesTab.jsx:65` | DELETE `/api/v1/prachar/unsubscribes/*` | `routers/prachar.py:581` | agrees | no body |
| `pages/sanvaad/ChannelDetails.jsx:55` | GET `/api/v1/messaging/channels/*/members` | `routers/messaging.py:351` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/ChannelDetails.jsx:72` | GET `/api/v1/messaging/directory` | `routers/messaging.py:158` | agrees | returns bare-list; reads .data |
| `pages/sanvaad/ChannelDetails.jsx:84` | PATCH `/api/v1/messaging/channels/*` | `routers/messaging.py:271` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ChannelDetails.jsx:99` | PATCH `/api/v1/messaging/channels/*` | `routers/messaging.py:271` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ChannelDetails.jsx:115` | POST `/api/v1/messaging/channels/*/members` | `routers/messaging.py:375` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ChannelDetails.jsx:132` | DELETE `/api/v1/messaging/channels/*/members/*` | `routers/messaging.py:409` | agrees | no body |
| `pages/sanvaad/ChannelList.jsx:58` | GET `/api/v1/messaging/directory` | `routers/messaging.py:158` | agrees | returns bare-list; reads .data |
| `pages/sanvaad/ChannelsTab.jsx:115` | GET `/api/v1/messaging/channels` | `routers/messaging.py:197` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/ChannelsTab.jsx:135` | GET `/api/v1/messaging/channels` | `routers/messaging.py:197` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/ChannelsTab.jsx:148` | POST `/api/v1/messaging/channels` | `routers/messaging.py:245` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ChannelsTab.jsx:174` | POST `/api/v1/messaging/dm` | `routers/messaging.py:315` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ThreadPanel.jsx:43` | GET `/api/v1/messaging/messages/*/thread` | `routers/messaging.py:632` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/ThreadPanel.jsx:75` | POST `/api/v1/messaging/channels/*/messages` | `routers/messaging.py:524` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ThreadPanel.jsx:112` | PATCH `/api/v1/messaging/messages/*` | `routers/messaging.py:578` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/ThreadPanel.jsx:130` | DELETE `/api/v1/messaging/messages/*` | `routers/messaging.py:605` | agrees | no body |
| `pages/sanvaad/ThreadPanel.jsx:158` | DELETE `/api/v1/messaging/messages/*/reactions/*` | `routers/messaging.py:693` | agrees | no body |
| `pages/sanvaad/ThreadPanel.jsx:159` | POST `/api/v1/messaging/messages/*/reactions` | `routers/messaging.py:659` | agrees | no body |
| `pages/sanvaad/useChannelMessages.js:56` | GET `/api/v1/messaging/channels/*/messages` | `routers/messaging.py:442` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/useChannelMessages.js:91` | POST `/api/v1/messaging/channels/*/read` | `routers/messaging.py:721` | agrees | no body |
| `pages/sanvaad/useChannelMessages.js:127` | POST `/api/v1/messaging/channels/*/messages` | `routers/messaging.py:524` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/useChannelMessages.js:181` | GET `/api/v1/messaging/channels/*/messages` | `routers/messaging.py:442` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/useChannelMessages.js:207` | PATCH `/api/v1/messaging/messages/*` | `routers/messaging.py:578` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/useChannelMessages.js:221` | DELETE `/api/v1/messaging/messages/*` | `routers/messaging.py:605` | agrees | no body |
| `pages/sanvaad/useChannelMessages.js:244` | DELETE `/api/v1/messaging/messages/*/reactions/*` | `routers/messaging.py:693` | agrees | no body |
| `pages/sanvaad/useChannelMessages.js:248` | POST `/api/v1/messaging/messages/*/reactions` | `routers/messaging.py:659` | agrees | no body |
| `pages/sanvaad/useSanvaadAccess.js:37` | GET `/api/v1/messaging/me` | `routers/messaging.py:130` | agrees | returns object |
| `pages/sanvaad/varta/TemplatePicker.jsx:34` | GET `/api/v1/whatsapp/templates` | `routers/whatsapp.py:202` | agrees | returns bare-list |
| `pages/sanvaad/varta/WAChat.jsx:41` | GET `/api/v1/whatsapp/conversations/*/messages` | `routers/whatsapp.py:135` | agrees | returns bare-list; reads .data+isArray(.data); **hand-rolled unwrap** |
| `pages/sanvaad/varta/WAChat.jsx:91` | POST `/api/v1/whatsapp/conversations/*/messages` | `routers/whatsapp.py:168` | agrees | body sent; route takes no Pydantic model |
| `pages/sanvaad/varta/WhatsAppTab.jsx:125` | GET `(dynamic)` | — | unresolved-1hop | ENDPOINT const map, l.25-30: /v1/whatsapp/{conversations,templates,auto-replies,accounts} |
| `pages/srijan/DataCatalogTab.jsx:49` | POST `/api/v1/scrapers/run` | `routers/scrapers.py:110` | agrees | body sent; route takes no Pydantic model |
| `pages/srijan/DataCatalogTab.jsx:63` | GET `/api/v1/scrapers/runs/*` | `routers/scrapers.py:363` | agrees | returns expr; reads .data |
| `pages/srijan/DataRunsTab.jsx:57` | GET `/api/v1/scrapers/runs/*` | `routers/scrapers.py:363` | agrees | returns expr; reads .data |
| `pages/srijan/DataRunsTab.jsx:63` | GET `/api/v1/scrapers/runs/*` | `routers/scrapers.py:363` | agrees | returns expr; reads .data |
| `pages/srijan/DataRunsTab.jsx:106` | POST `/api/v1/scrapers/runs/*/import-to-graha` | `routers/scrapers.py:467` | agrees | no body |
| `pages/srijan/GenerateTab.jsx:39` | POST `/api/v1/hub/org/quick-generate` | `routers/hub.py:1985` | agrees | body sent; route takes no Pydantic model |
| `pages/srijan/SkillsTab.jsx:28` | POST `/api/v1/hub/org/skills/*` | `routers/hub.py:1292` | agrees | body sent; route takes no Pydantic model |
| `pages/srijan/SkillsTab.jsx:42` | POST `/api/v1/hub/org/skills/*/run` | `routers/hub.py:1339` | agrees | body sent; route takes no Pydantic model |
| `pages/templates/TaskTemplateForm.jsx:83` | PATCH `/api/templates/tasks/*` | `routers/templates.py:209` | agrees | body sent; route takes no Pydantic model |
| `pages/templates/TaskTemplateForm.jsx:84` | POST `/api/templates/tasks` | `routers/templates.py:190` | agrees | body sent; route takes no Pydantic model |
| `pages/templates/TaskTemplateForm.jsx:104` | POST `/api/upload` | `routers/uploads.py:88` | agrees | body sent; route takes no Pydantic model |
| `pages/today/ApprovalsCard.jsx:66` | GET `/api/approvals/pending` | `server.py:1419` | agrees | returns bare-list; reads .data |
| `pages/today/ApprovalsCard.jsx:80` | POST `/api/approvals/*/review` | `server.py:1601` | agrees | body sent; route takes no Pydantic model |
| `pages/today/CashPosition.jsx:44` | GET `/api/v1/ganit/cash-position` | `routers/ganit.py:691` | agrees | returns object; reads .data |
| `pages/vetana/LoansTab.jsx:32` | GET `/api/v1/manav/employees` | `routers/manav.py:314` | agrees | returns envelope; reads .data.data; **hand-rolled unwrap** |
| `pages/vetana/LoansTab.jsx:48` | POST `/api/v1/vetana/loans` | `routers/vetana.py:1264` | agrees | body sent; route takes no Pydantic model |
| `pages/vetana/LoansTab.jsx:60` | PATCH `/api/v1/vetana/loans/*` | `routers/vetana.py:1308` | agrees | body sent; route takes no Pydantic model |
| `pages/vetana/PayrollTab.jsx:64` | POST `/api/v1/vetana/payroll/process` | `routers/vetana.py:436` | agrees | body sent; route takes no Pydantic model |
| `pages/vetana/PayrollTab.jsx:210` | POST `/api/v1/pahchan/attendance/publish` | `routers/pahchan_attendance.py:203` | agrees | body sent; route takes no Pydantic model |
| `pages/vetana/PayrollTab.jsx:226` | GET `/api/v1/pahchan/policy` | `routers/pahchan.py:990` | agrees | returns expr |
| `pages/vetana/PayrollTab.jsx:352` | GET `/api/v1/vetana/payroll/runs/*` | `routers/vetana.py:747` | agrees | returns object; reads .data |
| `pages/vetana/PayrollTab.jsx:363` | PATCH `(dynamic)` | — | unresolved-1hop | `act()` helper - 2 literal callers: /v1/vetana/payroll/runs/*/{approve,revert} (l.425,434) |
| `pages/vetana/PayslipsTab.jsx:123` | GET `/api/v1/vetana/payslips/*` | `routers/vetana.py:903` | agrees | returns expr; reads .data |
| `pages/vetana/PayslipsTab.jsx:134` | PATCH `/api/v1/vetana/payslips/*/disburse` | `routers/vetana.py:936` | agrees | no body |
| `pages/vetana/PayslipsTab.jsx:156` | GET `/api/v1/vetana/payslips/*/pdf` | `routers/vetana.py:974` | agrees | returns expr; reads .data |
| `pages/vetana/StructuresTab.jsx:37` | GET `/api/v1/manav/employees` | `routers/manav.py:314` | agrees | returns envelope; reads .data.data; **hand-rolled unwrap** |
| `pages/vetana/StructuresTab.jsx:73` | POST `/api/v1/vetana/salary-structures` | `routers/vetana.py:272` | agrees | body sent; route takes no Pydantic model |
| `pages/vetana/StructuresTab.jsx:252` | GET `/api/v1/vetana/salary-structures/*` | `routers/vetana.py:307` | agrees | returns expr; reads .data |
| `pages/vetana/StructuresTab.jsx:275` | PATCH `/api/v1/vetana/salary-structures/*` | `routers/vetana.py:334` | agrees | body sent; route takes no Pydantic model |
| `pages/vetana/_shared.jsx:79` | GET `(dynamic)` | — | unresolved-1hop | useResource/useList hook - 12 literal callers across pages/vetana/* |
| `pages/vikray/CustomersTab.jsx:40` | GET `/api/v1/vikray/orders` | `routers/vikray.py:153` | agrees | returns envelope; reads rows() |
| `pages/vikray/CustomersTab.jsx:68` | GET `/api/v1/vikray/customers` | `routers/vikray.py:672` | agrees | returns envelope; reads rows() |
| `pages/vikray/DashboardTab.jsx:45` | GET `/api/v1/vikray/dashboard` | `routers/vikray.py:543` | agrees | returns object; reads .data+.data.data; **hand-rolled unwrap** |
| `pages/vikray/DashboardTab.jsx:47` | GET `/api/v1/vikray/orders` | `routers/vikray.py:153` | agrees | returns envelope; reads .data+.data.data; **hand-rolled unwrap** |
| `pages/vikray/OrderDetail.jsx:49` | GET `/api/v1/vikray/orders/*` | `routers/vikray.py:208` | agrees | returns expr; reads .data |
| `pages/vikray/OrderDetail.jsx:92` | PATCH `/api/v1/vikray/orders/*/status` | `routers/vikray.py:304` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/OrderDetail.jsx:96` | POST `/api/v1/vikray/orders/*/invoice` | `routers/vikray.py:340` | agrees | no body |
| `pages/vikray/OrderDetail.jsx:101` | DELETE `/api/v1/vikray/orders/*` | `routers/vikray.py:381` | agrees | no body |
| `pages/vikray/OrderDetail.jsx:118` | PATCH `/api/v1/vikray/orders/*` | `routers/vikray.py:229` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/OrderForm.jsx:30` | GET `/api/v1/graha/contacts` | `routers/graha.py:268` | agrees | returns envelope |
| `pages/vikray/OrderForm.jsx:55` | POST `/api/v1/vikray/orders` | `routers/vikray.py:180` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/OrdersTab.jsx:29` | GET `/api/v1/vikray/orders` | `routers/vikray.py:153` | agrees | returns envelope; reads .data.data; **hand-rolled unwrap** |
| `pages/vikray/PipelineTab.jsx:49` | GET `/api/v1/vikray/pipeline` | `routers/vikray.py:611` | agrees | returns envelope; reads .data+rows() |
| `pages/vikray/StockTab.jsx:55` | PATCH `/api/v1/vikray/stock/*` | `routers/vikray.py:730` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/StockTab.jsx:98` | PATCH `/api/v1/vikray/stock/*` | `routers/vikray.py:730` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/StockTab.jsx:164` | GET `/api/v1/vikray/stock/*/moves` | `routers/vikray.py:771` | agrees | returns envelope |
| `pages/vikray/StockTab.jsx:201` | GET `/api/v1/vikray/stock` | `routers/vikray.py:707` | agrees | returns envelope; reads .data.data; **hand-rolled unwrap** |
| `pages/vikray/StockTab.jsx:271` | PATCH `/api/v1/vikray/stock/*` | `routers/vikray.py:730` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/StockTab.jsx:274` | PATCH `/api/v1/vikray/stock/*` | `routers/vikray.py:730` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/TargetsTab.jsx:68` | GET `/api/v1/org/members` | `routers/org_members.py:72` | agrees | returns expr; reads .data |
| `pages/vikray/TargetsTab.jsx:91` | POST `/api/v1/vikray/targets` | `routers/vikray.py:409` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/TargetsTab.jsx:203` | GET `/api/v1/vikray/targets` | `routers/vikray.py:432` | agrees | returns envelope; reads .data.data; **hand-rolled unwrap** |
| `pages/vikray/TargetsTab.jsx:217` | GET `/api/v1/vikray/targets/leaderboard` | `routers/vikray.py:460` | agrees | returns envelope |
| `pages/vikray/TargetsTab.jsx:234` | PATCH `/api/v1/vikray/targets/*` | `routers/vikray.py:492` | agrees | body sent; route takes no Pydantic model |
| `pages/vikray/TargetsTab.jsx:245` | DELETE `/api/v1/vikray/targets/*` | `routers/vikray.py:524` | agrees | no body |
| `pages/vikray/_shared.jsx:144` | GET `/api/v1/ganit/products` | `routers/ganit.py:281` | agrees | returns envelope |

## Verdict counts

- agrees: 619
- unresolved: 14
- body-mismatch: 2
- enum-drift: 1

_Gates: frontend 43 files / 682 tests, exit 0, 0 unhandled; `vite build` exit 0; check-tokens 0 missing; check-classes 0 missing. Backend 1475 passed, 122 skipped, 0 failed._
