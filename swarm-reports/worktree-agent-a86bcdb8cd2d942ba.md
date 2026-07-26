# Agent a86bcdb8cd2d942ba — API contract map + dead code / duplication

Branch: `worktree-agent-a86bcdb8cd2d942ba`. Base: `staging` @ `666b0ea`.

Two jobs: (1) the definitive frontend↔backend API contract; (2) prove-then-delete
dead code and map duplication.

**Note on the worktree.** This worktree was created off `main`, not `staging` — it
started 272 commits behind `origin/staging` and 13 ahead with production-only
commits (`1aa4985 feat: add admin endpoint to recover corrupted R2 attachments`
and 12 others, all reachable from `origin/main`, so nothing was lost). I reset to
`origin/staging` before doing any work. **Any other agent whose worktree shows
`1aa4985` at HEAD is also on the wrong base and should check.**

---

## Method

Both sides were extracted mechanically, not by grep-and-eyeball:

- **Backend** — every `@app|@router.<verb>("...")` decorator across `backend/**/*.py`,
  joined to its file's `APIRouter(prefix=...)`, then filtered by whether that router
  is actually `include_router`'d in `backend/server.py`. 639 decorators, 636 mounted.
- **Frontend + mobile** — every `api|apiClient.<verb>(...)` call in `frontend/src/**`
  and `mobile/src/**`, with a real balanced-brace template-literal reader (a plain
  regex mis-parses `${a ? `?x=${b}` : ''}` and produced 8 false "missing route" hits
  on the first pass — those are excluded below). 739 call sites.
- Path params normalised to `{}` on both sides; ternaries expanded into every
  string-literal alternative so `/modules/${on ? 'deactivate' : 'activate'}` matches.

Every defect below was then **re-read at the source line on both sides** before
being listed. Nothing here is inferred from a name match.

---

# JOB 1 — THE API CONTRACT

## 1.1 Summary

| Outcome | Count |
|---|---|
| Frontend calls that match a mounted backend route | 689 |
| **Frontend calls to a route that does not exist (404 at runtime)** | **17** |
| **Frontend calls to a route whose router is never mounted** | **1** |
| Calls with a computed path (verified by hand, see §1.5) | 29 |
| Backend routes with no caller in web or mobile | 164 / 639 |
| **Backend route files never mounted at all** | **2 (3 routes)** |

## 1.2 Calls to routes that DO NOT EXIST — confirmed 404s

These are ordered by blast radius. Each row was verified by reading both the call
site and the backend router file.

### A. All of Sanvaad (messaging) — 11 call sites, module is entirely non-functional

`backend/routers/messaging.py:1` declares `APIRouter(prefix="/api/v1/messaging")` and
`backend/server.py:2791` mounts it. Every frontend call omits the `/v1`.

| Method | Frontend calls | Backend actually serves | Call site |
|---|---|---|---|
| GET | `/api/messaging/channels` | `/api/v1/messaging/channels` | `frontend/src/pages/sanvaad/ChannelsTab.jsx:31` |
| POST | `/api/messaging/channels` | `/api/v1/messaging/channels` | `frontend/src/pages/sanvaad/ChannelsTab.jsx:45` |
| GET | `/api/messaging/messages/{id}/thread` | `/api/v1/messaging/messages/{message_id}/thread` | `frontend/src/pages/sanvaad/ThreadPanel.jsx:37` |
| POST | `/api/messaging/channels/{id}/messages` | `/api/v1/messaging/channels/{channel_id}/messages` | `frontend/src/pages/sanvaad/ThreadPanel.jsx:56` |
| DELETE | `/api/messaging/messages/{id}/reactions/{emoji}` | `/api/v1/messaging/...` | `frontend/src/pages/sanvaad/ThreadPanel.jsx:94` |
| POST | `/api/messaging/messages/{id}/reactions` | `/api/v1/messaging/...` | `frontend/src/pages/sanvaad/ThreadPanel.jsx:95` |
| GET | `/api/messaging/channels/{id}/messages` | `/api/v1/messaging/...` | `frontend/src/pages/sanvaad/useChannelMessages.js:45` |
| POST | `/api/messaging/channels/{id}/read` | `/api/v1/messaging/channels/{channel_id}/read` | `frontend/src/pages/sanvaad/useChannelMessages.js:72` |
| POST | `/api/messaging/channels/{id}/messages` | `/api/v1/messaging/...` | `frontend/src/pages/sanvaad/useChannelMessages.js:91` |
| DELETE | `/api/messaging/messages/{id}/reactions/{emoji}` | `/api/v1/messaging/...` | `frontend/src/pages/sanvaad/useChannelMessages.js:135` |
| POST | `/api/messaging/messages/{id}/reactions` | `/api/v1/messaging/...` | `frontend/src/pages/sanvaad/useChannelMessages.js:139` |

Corroborating evidence: **all 14 routes in `messaging.py` show zero callers** in the
uncalled-route sweep (§1.4). Both halves independently say the same thing.

No path-rewriting middleware exists — `backend/server.py:184-271` registers only
SlowAPI, a write rate limiter, security headers, CORS and a request-cache cleaner.

### B. All of Varta (WhatsApp) — 7 call sites, module is entirely non-functional

`backend/routers/whatsapp.py` declares `APIRouter(prefix="/api/v1/whatsapp")`. Same
missing `/v1`.

| Method | Frontend calls | Call site |
|---|---|---|
| GET | `/api/whatsapp/conversations/{id}/messages` | `frontend/src/pages/sanvaad/varta/WAChat.jsx:41` |
| POST | `/api/whatsapp/conversations/{id}/messages` | `frontend/src/pages/sanvaad/varta/WAChat.jsx:68` |
| GET | `/api/whatsapp/templates` | `frontend/src/pages/sanvaad/varta/TemplatePicker.jsx:19` |
| GET | `/api/whatsapp/conversations` | `WhatsAppTab.jsx:23` (via `ENDPOINT` map, called at `:88`) |
| GET | `/api/whatsapp/templates` | `WhatsAppTab.jsx:24` |
| GET | `/api/whatsapp/auto-replies` | `WhatsAppTab.jsx:25` |
| GET | `/api/whatsapp/accounts` | `WhatsAppTab.jsx:26` |

The last four are the `ENDPOINT` constant at `WhatsAppTab.jsx:22-27`; the call at
`:88` is `api.get(ENDPOINT[sub], params)`, so a path-literal scan misses them. All
13 `whatsapp.py` routes show zero callers.

### C. Onboarding cannot send invites

`frontend/src/pages/onboarding/OnboardingPage.jsx:176` — `api.post('/invites', ...)`
→ `/api/invites`. `backend/invite_router.py:274` is `@router.post("/invites")` under
`APIRouter(prefix="/api/admin")`, so the real route is **`/api/admin/invites`**.
There is no `/api/invites` anywhere. The loop at `:173-180` catches per-invite and
reports "failed", so this presents as *every* invite failing, not as a crash.

### D. Mobile notifications — two wrong paths

| Call | Reality |
|---|---|
| `mobile/src/api/notifications.ts:9` — `GET /notifications/unread_count`, expects `{count:number}` | **No such route.** Nearest is `GET /api/notifications/poll` (`server.py:2675`) returning `{unread, fresh}` — different name *and* different shape. |
| `mobile/src/api/notifications.ts:15` — `POST /notifications/mark_read` | Backend is `POST /api/notifications/mark-read` (`server.py:2639`) — **hyphen, not underscore**. The web client at `frontend/src/context/NotificationContext.jsx:213,230` uses the hyphen correctly, so this is mobile-only drift. |

### E. Command palette search hits an unmounted router

`frontend/src/components/CommandPalette.jsx:107` calls `GET /api/search`.
`backend/routers/search.py:481` defines exactly that route — but see §1.3: the file
is never imported and never mounted. This is a 404, and it is the one defect that
*looks* fine from either side alone.

## 1.3 Backend router files that exist but are never mounted

`backend/server.py:57-87` imports 31 routers and `:2756-2793` includes 36. Two
router modules are in neither list:

| File | Routes it defines | Status |
|---|---|---|
| `backend/routers/search.py` | `GET /api/search` (`:481`) | **Never imported, never mounted.** Called by `CommandPalette.jsx:107`. |
| `backend/routers/tasks_bulk.py` | `PATCH /api/v1/tasks/bulk` (`:273`), `DELETE /api/v1/tasks/bulk` (`:383`) | **Never imported, never mounted.** No caller either — dead on both sides. |

Proof: `grep -rn "include_router" backend/` returns 36 hits, all in `server.py`, none
naming these; `grep -rn "tasks_bulk\|routers.search" backend/ --include=*.py` returns
only two hits, both inside `tasks_bulk.py`'s own docstring.

`search.py` is a genuine bug — a working implementation is sitting unmounted while a
shipped UI calls it. `tasks_bulk.py` is orphaned feature work.

## 1.4 Backend routes with no caller (164 / 639)

Not all of these are dead — cron endpoints and OAuth callbacks are called by
infrastructure, not by the app. Grouped by why:

**Legitimately uncalled by design (26)** — `routers/scheduler.py` (13 `/api/internal/cron/*`
routes, invoked by Railway cron), `routers/whatsapp.py` webhook GET+POST (Meta calls
these), `routers/hub_publish.py:GET /api/v1/hub/oauth/{platform}/callback` (OAuth
redirect), `POST /api/reports/dispatch`, `POST /api/task-reminders/dispatch`,
`POST /api/v1/hub/publish/dispatch`, `GET /api/health`, `GET /api/`,
`POST /api/v1/graha/inbound-leads`, `POST /api/v1/graha/f/{slug}` (public form post),
`backend/routers/ganit.py` `/sign/{token}/*` × 4 (public e-sign flow, opened by URL).

**Uncalled because the caller uses the wrong prefix (27)** — all 14 of
`routers/messaging.py` and all 13 of `routers/whatsapp.py`. See §1.2 A and B. These
are the *same* defect counted from the other direction.

**Genuinely unreachable — feature built, no UI (the interesting ones):**

| Route | File |
|---|---|
| `PATCH` / `DELETE /api/v1/tasks/bulk` | `routers/tasks_bulk.py` — router not mounted |
| `GET /api/v1/admin/orgs/{org_id}/cost-breakdown`, `/credits/usage`, `/storage`, `/cost-summary`, `/provider-costs` | `routers/admin_orgs.py` |
| `POST /api/v1/admin/orgs/{org_id}/credits/topup`, `PUT .../r2`, `GET|PUT .../members/{id}/modules` | `routers/admin_orgs.py` |
| `GET|POST|PUT|DELETE /api/dashboards/*` (all 5) | `routers/dashboards.py` — entire router has no caller |
| `GET /api/v1/hub/ai-feedback`, `POST /api/v1/hub/ai-feedback`, `GET /api/v1/hub/ai-feedback/stats` | `routers/hub.py` |
| `GET|PUT|DELETE /api/v1/hub/ai-conversations/{context_type}` | `routers/hub.py` |
| `GET /api/v1/hub/analytics/spend`, `GET /api/v1/hub/clients/{id}/analytics/spend` | `routers/hub.py` — spend analytics is gated, see memory |
| `GET|POST /api/v1/graha/pipelines`, `GET /api/v1/graha/scoring-rules`, `PATCH /api/v1/graha/scoring-rules/{id}` | `routers/graha.py` |
| `GET /api/v1/graha/inbound-emails`, `/inbound-emails/{id}`, `/follow-ups`, `/activities` | `routers/graha.py` |
| `POST /api/v1/graha/territories/{id}/assign-next`, `PATCH /api/v1/graha/territories/{id}` | `routers/graha.py` |
| `GET|POST /api/v1/manav/availability`, `GET /api/v1/manav/leaves/check-conflicts` | `routers/manav.py` |
| `POST /api/v1/manav/shift-bids/{bid_id}/accept/{employee_id}`, `POST /api/v1/manav/schedules/bulk` | `routers/manav.py` |
| `GET /api/v1/pahchan/me`, `/sites` (GET+POST), `/enrollment/{employee_id}`, `POST /punch/photo` | `routers/pahchan.py` — Pahchan is an unfinished module |
| `GET /api/v1/prachar/campaigns/{id}/audience`, `/stats`, `GET /api/v1/prachar/events/{id}` | `routers/prachar.py` |
| `GET /api/v1/scrapers/admin/runs`, `/admin/usage` | `routers/scrapers.py` |
| `GET /api/v1/vikray/targets/leaderboard`, `DELETE /api/v1/vikray/targets/{id}` | `routers/vikray.py` |
| `GET /api/v1/vetana/payslips`, `/statutory-summary`, `DELETE /salary-structures/{sid}` | `routers/vetana.py` |
| `GET /api/v1/esign/documents`, `/documents/{id}/audit` | `routers/esign.py` |
| `POST /api/admin/migrate-data-uris`, `PUT /api/settings/brand-colors`, `PATCH /api/teams/{id}/brand`, `POST /api/projects/{id}/columns/reorder`, `PATCH /api/tasks/{id}/toggle`, `POST|DELETE /api/tasks/{id}/clients/{user_id}` | `backend/server.py` |

Full machine-readable list is reproducible from the method in §1 — I have not
committed the JSON, since it goes stale the moment another agent lands a route.

I am **not** recommending deleting any of these. An uncalled route is a missing UI
far more often than it is dead code, and several (`admin_orgs` cost/credits,
`pahchan/*`) are known in-flight work.

## 1.5 Computed-path call sites (verified by hand)

29 call sites pass a variable rather than a literal. All were opened and checked;
none is a defect except `WhatsAppTab.jsx:88` already counted in §1.2 B. The pattern
is a module-level `ENDPOINT`/`TAB` constant map plus `api.get(MAP[tab], params)` —
used by `ganit/*Tab.jsx`, `graha/*Tab.jsx`, `manav/*Tab.jsx`, `esign/DocumentsTab.jsx`,
`VetanaPage.jsx`, `VikrayPage.jsx`, `BoardsPage.jsx`, `TasksListPage.jsx`,
`ApprovalsPage.jsx`, `admin/orgScope.js`. `mobile/src/offline/mutationQueue.ts:168-171`
dispatches a queued verb against a stored URL — correct by construction.

---

## 1.6 Response-SHAPE mismatches — the ones that render blank instead of erroring

These are the most valuable findings and every one was verified by reading the
Pydantic model, the handler's `response_model=`, and the consuming component.

### Background: the client shape landed on the server, and three consumers were not updated

During this revamp `GET /api/client/tasks` (`server.py:968`) changed to
`response_model=List[ClientTaskOut]`, and `GET /api/client/approvals`
(`server.py:1031`) to `List[ClientApprovalOut]`. Both new models are **allow-lists with
camelCase wire aliases** (`server.py:609-655`):

| Internal `TaskOut` field | `ClientTaskOut` wire name |
|---|---|
| `task_id` | `taskId` |
| `description` | `note` |
| `due_at` | `expectedAt` |
| `updated_at` / `created_at` | `updatedAt` / `createdAt` |
| `team_id` | `projectId` |
| `attachments` | `files` |
| `status` (6 values) | `state` (3 values) — **and the raw status is gone** |
| `created_by_name` | `requestedBy` |
| `priority`, `tags`, `category_id`, `column_id`, `assignee_*`, `custom_fields`, `subtasks`, `estimated_minutes`, `user_id`, `created_by_user_id`, `approval_status`, `approved_by`, `completed_at`, `archived_at`, `reminders` | **absent by design** |

`ClientApprovalOut`: `approval_id`→`approvalId`, `task_id`→`taskId`, plus `ref`, `title`,
`ask`, `requestedBy`, `requestedAt`. **No `approval_status`, no `request_data`, no
`task_title`, no `notes`, no `created_at`, no `priority`, no `team_id`.**

**One consumer was updated and is correct.** `frontend/src/pages/client/clientShape.js`
handles *both* wire shapes — it discriminates on `typeof raw.taskId === 'string'`
(`:90`) and reduces either. The web client portal at `/client/*` therefore works.
**The claim that `clientShape.js` is broken is FALSE — it is the reference for how
this should be done.** Three other consumers were not updated.

### MISMATCH 1 — `mobile/src/screens/ClientPortalScreen.tsx` — live for every mobile client

`:32` — `apiClient.get<Task[]>('/client/tasks')`. `Task` in `mobile/src/api/types.ts:61-82`
is the internal shape (`task_id`, `status`, `description`, `due_at`). The generic is an
**unchecked cast**, so TypeScript cannot catch this — it compiles clean and fails at runtime.

`mobile/src/nav/RootStack.tsx:187` sends every `user.role === 'client'` straight to this
screen with no further gate, so this is unconditionally live on mobile.

| Line | Reads | Server sends | Result on screen |
|---|---|---|---|
| `:125` | `item.task_id` as FlatList `keyExtractor` | `taskId` | key is `undefined` for **every** row |
| `:137` | `item.status` | `state` | the status pill renders **empty** |
| `:141` | `item.description` | `note` | description line **never renders** |
| `:144` | `item.due_at` | `expectedAt` | due line **never renders** |
| `:134` | `item.title` | `title` | correct — which is why the screen looks half-alive |
| `:39` | `` `/tasks/${selected.task_id}/comments` `` | — | requests **`/api/tasks/undefined/comments`** → 404, swallowed by `.catch(() => {})` at `:41`, so the thread is permanently empty |
| `:47` | `POST` to the same undefined path | — | every comment fails with the generic `'Could not post comment'` alert |

Net effect: a mobile client sees title-only cards with a blank status chip, and the
screen's single interactive feature is broken with a misleading error.

### MISMATCH 2 — `frontend/src/pages/ApprovalsPage.jsx` — the approve buttons cannot render

`:41` fetches `/client/approvals` when `isClient`, then renders each row (`:227-250`)
against the pre-change dict shape.

| Line | Reads | Server sends | Result |
|---|---|---|---|
| `:228` | `r.request_data` | absent | `data = {}` |
| `:229` | `data?.title \|\| r.task_title` | `title` | **every row reads "Untitled task"** while the real title sits in an unread field |
| `:230` | `data?.description \|\| r.notes` | `ask` | description always blank |
| `:232` | `r.requester_name \|\| r.requested_by_name` | `requestedBy` | falls through to the literal `'You'` — attributes the firm's request to the client |
| `:235` | `key={r.approval_id}` | `approvalId` | duplicate `undefined` React key on every row |
| `:233` | `deciding[r.approval_id]` | — | spinner state keyed on `undefined` |
| `:249` | `r.approval_id?.startsWith('task_approval--') && r.approval_status === 'pending_client'` | neither field exists | **the client's Approve / Reject buttons never render.** Two independent reasons: `approval_id` is `undefined`, and `ClientApprovalOut` omits `approval_status` *deliberately* (its docstring at `server.py:641` calls it internal vocabulary) |
| `:243` | `r.created_at` | `requestedAt` | no timestamp |
| `:239` | `r.task_id` → `setDrawerTaskId` | `taskId` | title is not clickable; drawer never opens |

A client on this page sees rows all titled "Untitled task", requested by "You", undated,
**with no way to approve anything** — which is the page's entire purpose.

### MISMATCH 3 — `frontend/src/pages/TasksListPage.jsx`

`:105-107` fetches `/client/tasks` when `isClient`, then filters and renders as `TaskOut`.

| Line | Reads | Server sends | Result |
|---|---|---|---|
| `:154` | `t.user_id`, `t.assignee_user_ids` | absent | the **"Mine" filter matches nothing** |
| `:155`,`:157` | `t.status` | `state` | **"Done" filter always empty**; "All" accidentally matches everything |
| `:156` | `t.due_at` | `expectedAt` | **"Overdue" filter always empty** |
| `:166` | `t.priority` | absent | every task lands in the "Other" priority group |
| `:180` | `t.team_id` | `projectId` | every project group is empty |
| `:325`,`:332` | `key={t.task_id}` / `setDrawerTaskId(t.task_id)` | `taskId` | duplicate `undefined` keys; **clicking a row does nothing** (`open={!!drawerTaskId}` at `:434` stays false) |
| `:341` | `t.attachments` | `files` | attachment count never shows |
| `:406` | `t.due_at`, `t.status`, `t.completed_at` | — | the Due chip renders empty |
| `:412` | `t.updated_at` | `updatedAt` | Last-Updated column reads `—` |
| `:418` | `t.status`, `t.approval_status` | — | the Status chip renders empty |

**Reachability — I checked this rather than assuming it.** `Protected.jsx:115` confines a
client to `/client/*` using `navContext().isClient`, which is
`role === 'client' && orgRoles.length === 0` (`navConfig.js:106`). But `TasksListPage:67`
and `ApprovalsPage:36` use the **bare** `user?.role === 'client'`. The two predicates
disagree for a user who is flagged `client` *and* holds an org role: `Protected` correctly
admits them to the staff shell, and then these two pages decide they are a client and
fetch the client-shaped endpoints. So mismatches 2 and 3 are live for exactly that
population — narrow, but real, and invisible in testing because the pages render without
throwing.

**This predicate split is itself the defect.** `navConfig.js` documents the full
definition and `Protected.jsx:27-31` explains why it matters; six call sites never got the
memo: `TasksListPage.jsx:67`, `ApprovalsPage.jsx:36`, `BoardsPage.jsx:32`,
`NewTaskModal.jsx:44`, `TaskDrawer.jsx:543`, `mobile/src/components/NewTaskSheet.tsx:56`.
The fix is to export the predicate and use it in all seven places.

### MISMATCH 4 — `POST /api/client/tasks/request` still returns the internal shape (the reported suspect — CONFIRMED)

`backend/server.py:1158` — `@api_router.post("/client/tasks/request", response_model=TaskOut)`,
and `:1161` is `if user.get("role") != "client": raise HTTPException(403, ...)`. **The one
endpoint that can only ever be called by a client is the one still serving `TaskOut`.**
This is precisely the pattern `ClientTaskOut` was introduced to eliminate.

Impact per caller — this one is more a leak than a render bug:

- `frontend/src/pages/client/RequestWork.jsx:55` — `await` with the response discarded;
  `onCreated?.()` takes no arguments. No render bug. **The full internal task object still
  crosses the wire to the client's browser**, where anything can read it.
- `frontend/src/components/NewTaskModal.jsx:299` — `onCreated?.(res.data)`. The three
  staff pages that mount this (`BoardsPage:338`, `ProjectBoardPage:355`,
  `TasksListPage:450`) all pass an `onCreated` that ignores its argument and refetches,
  so nothing renders the mismatched object today. It is a live trap for the next caller
  that does use it.
- `mobile/src/components/NewTaskSheet.tsx:159` — same endpoint choice, same exposure.

Practical severity of the leak is limited *right now* because the handler inserts a fresh
row with no assignees, `custom_fields='{}'` and `subtasks='[]'` (`server.py:1177-1184`), so
the internal-heavy fields come back empty. But the response does carry `user_id`,
`team_id`, `column_id`, `created_by_user_id`, `priority`, `approval_status` and the
unfiltered `attachments` list, and — more to the point — the shape is an **allow-everything
default**, so the next field added to `TaskOut` reaches a client with nobody deciding it
should. That is the exact failure `19-client-portal.md` describes.

**Recommended fix (deliberately not applied — this is `server.py`, which several agents are
editing):** change `response_model=TaskOut` to `ClientTaskOut` and build it through the same
serializer `/client/tasks` uses. `clientShape.js` already accepts that shape, so the web
side needs no change.

### MISMATCH 5 — `GET /api/client/projects` never got a client shape at all

`server.py:1012` — `@api_router.get("/client/projects")` with **no `response_model`**,
returning `SELECT DISTINCT ON (t.team_id) t.*` from `teams` (`:1015-1016`). Every column of
the teams row reaches a client, including `brand_settings` and `created_by` (an internal
user id) — cf. `TeamOut` at `server.py:480-483`, which is what the staff endpoint returns.

Consumers only read `team_id` and `name` (`TasksListPage.jsx:117`, `BoardsPage.jsx:56-57`),
so **there is no render bug here** — this is a disclosure gap, not a shape mismatch, and I
list it because it is the same class as MISMATCH 4 and the two should be fixed together.

## 1.7 Suspects that were reported but are NOT defects

Re-read and cleared, so nobody spends time on them again:

| Reported | Verdict |
|---|---|
| `frontend/src/pages/client/clientShape.js` | **Not a defect.** Handles both wire shapes via `isShapedTask` (`:90`). It is the model the other three consumers should copy. |
| `DELETE /api/admin/users/{id}` from `AdminPage.jsx:220` | Fine. The template's trailing `${reassign ? '?reassign_to=…' : ''}` is a query string; `invite_router.py:139` serves it. |
| `POST /approvals/by-token/${token}/${act}` — `ApprovePage.jsx:64` | Fine. `act` is `'approve'`/`'reject'`; both exist at `approvals_router.py:499,570`. |
| `POST /approvals/task_approval--${taskId}/review` — `mobile/src/api/tasks.ts:76` | Fine. `server.py:1409` is `/approvals/{approval_id}/review`; the prefix is part of the id. The comment at `tasks.ts:58-72` is accurate. |
| `PATCH /v1/manav/expense-claims/${claimId}/${decision}` — `ExpensesTab.jsx:56` | Fine. `decision` is `'approve'`/`'reject'`; `manav.py:1657,1687` serve both. |
| `POST /v1/subscription/modules/${on ? 'deactivate' : 'activate'}` — `AdminBillingPage.jsx:176` | Fine; `subscription.py:190,242`. |
| `/v1/graha/*${params}`, `/v1/vikray/stock${...}`, `/v1/hub/org/content${params}` | Fine — all query strings. |
