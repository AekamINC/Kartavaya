# Agent a86bcdb8cd2d942ba — the API contract, and dead code / duplication

Branch: `swarm/api-contract-a86bcdb8cd2d942ba`. Base: `staging`.

**Rebuilt against current staging after the spend-limit stop.** My pre-stop version
of this file claimed defects that siblings have since fixed. Every claim below was
re-derived from current staging; superseded claims are listed in §5 so nobody chases
them.

---

## 0. Summary

| | |
|---|---|
| Backend route decorators | 650 |
| Mounted and served | **650** — was 647; I registered the last 3 |
| Frontend + mobile call sites | 738 |
| **Calls that 404'd when I started** | **25** |
| **Calls that 404 now** | **0** |
| Backend routes with no caller | 168 / 650 |

§2 is fixed and merged to staging. §3 is the contract table. §4 is Job 2.

---

## 1. Method — why this is a measurement, not a survey

- **Backend** — every `@app|@router.<verb>("…")` decorator in `backend/**/*.py`,
  joined to its file's `APIRouter(prefix=…)`, filtered by whether that router is
  actually `include_router`'d. The mount set is **derived from `server.py`'s own
  import and include lines**, not hardcoded. My first pass *did* hardcode it, and
  that list went stale within the hour as siblings landed routers — which is the same
  mechanism that let §2.4 survive in the first place.
- **Frontend + mobile** — every `api|apiClient.<verb>(…)` call under `frontend/src/**`
  and `mobile/src/**`, parsed with a balanced-brace template-literal reader. A plain
  regex mis-parses nested interpolation like `` `${a ? `?x=${b}` : ''}` `` and gave me
  **8 false "missing route" hits** on the first pass. Ternaries are expanded to every
  string-literal alternative so `/modules/${on ? 'deactivate' : 'activate'}` resolves.
- **The mounted set is confirmed by importing the app and reading `app.openapi()`,
  not by the static scan.** This FastAPI version stores lazy `_IncludedRouter`
  placeholders in `app.routes`, so counting that list reports 42 and means nothing.
  The real figure is **648 operations across 499 paths**.

Every defect was then re-read at the source line on both sides.

---

## 2. Defects found and FIXED (merged to staging)

### 2.1 Sanvaad and Varta — 21 call sites, both modules 404'd entirely

`routers/messaging.py:19` is `APIRouter(prefix="/api/v1/messaging")`; `whatsapp.py:22`
is `/api/v1/whatsapp`. Every web call omitted the `/v1`.

**The tiebreaker that settled which side was wrong:** `mobile/src/api/messages.ts:76-124`
already called `/v1/messaging/*` correctly against the same server. Backend and mobile
agreed; the web client was the sole outlier. So the fix was the frontend, not the prefix.

Fixed in `ChannelsTab.jsx` (2), `ThreadPanel.jsx` (4), `useChannelMessages.js` (8),
`varta/WAChat.jsx` (2), `varta/TemplatePicker.jsx` (1), `varta/WhatsAppTab.jsx` (4 —
these live in an `ENDPOINT` constant map read at `:88`, invisible to a path-literal scan).

**This is not what `4a966c6` fixed.** That commit fixed the `samvada`/`sanvaad`
*module code*, which made every Sanvaad endpoint return **403**. This is the separate
**404** underneath it. After `4a966c6` the 403 simply became a 404; the module needed
both fixes to work at all.

### 2.2 Onboarding could not send a single invite

`OnboardingPage.jsx:176` posted `/invites`. `invite_router.py:274` is
`@router.post("/invites")` under `prefix="/api/admin"`, so the route is
**`/api/admin/invites`** — which `AdminPage.jsx:547` has always used. Onboarding was
the lone exception. Its loop catches per-invite and reports failures, so it presented
as "every invite failed", never as an error.

A sibling concurrently added `noRetry: true` to that same line for a real reason (the
retry interceptor re-sends a request that **sends an email** — one 503 put four
invitations on the wire). The rebase conflicted; I kept both changes.

### 2.3 Mobile notifications — one dead helper, one live 404

| Call | Reality | Action |
|---|---|---|
| `notifications.ts:9` — `GET /notifications/unread_count`, expects `{count}` | **No such route, and zero callers.** `NotificationContext.tsx:34` destructures `unread` from `poll()`; `InboxScreen.tsx:114` counts `!read_at` locally | **Removed.** Deliberately *not* repointed at `/notifications/poll`: `server.py:2822` INSERTs reminder rows as a side effect, so a badge render would send reminders |
| `notifications.ts:15` — `POST /notifications/mark_read` | Route is `mark-read`, **hyphen** (`server.py:2786`) | **Fixed.** Every mark-read tap in `InboxScreen.tsx:88` was silently no-op'ing behind an optimistic UI |

### 2.4 Two finished routers were never registered

| File | Routes | Live caller |
|---|---|---|
| `backend/routers/search.py` | `GET /api/search` | `CommandPalette.jsx:107` |
| `backend/routers/tasks_bulk.py` | `PATCH` + `DELETE /api/v1/tasks/bulk` | `BulkBar.jsx:74,102` |

Both are complete and security-conscious — `search.py` delegates every privilege
decision to `require_module`/`is_org_admin` rather than reimplementing it;
`tasks_bulk.py` uses savepoints so a transactional batch and a per-id result coexist,
and its own header names BulkBar as its destination. **The two halves were built by
different agents and nobody wired them.**

`search.py` is the subtlest defect here: `CommandPalette` keeps a tri-state and
**stops asking after one 404**, so the symptom was a quiet ⌘K that returned only the
30 static commands — no error anywhere, in any log.

Verified before merging, not assumed:
- every symbol imported from `auth_router`, `db`, `middleware.*` exists;
- both modules import cleanly and the full app builds to **648 operations**;
- the OpenAPI schema now serves all three paths;
- **`/api/v1/tasks/bulk` is the only `/api/v1/tasks/*` route**, so the literal cannot
  be shadowed by a `{task_id}` matcher regardless of registration order — the failure
  that would have made this look fixed while staying broken;
- backend suite **498 passed, 0 failed**.

### 2.5 Mobile client portal read the wrong shape

`mobile/src/screens/ClientPortalScreen.tsx:32` — `apiClient.get<Task[]>('/client/tasks')`,
but the endpoint returns `List[ClientTaskOut]` (`server.py:609`). `apiClient.get<T>()`
is an **unchecked cast**, so this compiled clean and failed only at runtime.

The two shapes share exactly one field name — `title` — which is why the screen looked
half-alive rather than broken:

| Read | Sent | Symptom |
|---|---|---|
| `item.status` | `state` | status pill printed `undefined` |
| `item.description` | `note` | description line never rendered |
| `item.due_at` | `expectedAt` | due line never rendered |
| `item.task_id` (`:125`, `:39`, `:47`) | `taskId` | every FlatList key `undefined`; **both comment calls built `/api/tasks/undefined/comments`**, which 404s. Both swallow the failure, so the thread was permanently empty and every post failed with `'Could not post comment'` |

`RootStack.tsx:187` routes every `role === 'client'` straight here with no further
gate, so this was live for **every** mobile client. `e366f50` fixed the web half of
this defect; mobile was not in that change.

Fixed, and I added a real `ClientTask` type to `mobile/src/api/types.ts` mirroring
`ClientTaskOut`, so the next drift is a compile error rather than a blank cell. The
comments endpoint was never at fault — `server.py:1641-1647` authorises a client
against the task and returns only client-visible rows.

---

## 3. THE CONTRACT TABLE

### 3.1 Router → URL prefix — read this before writing a call

| Prefix | Router file |
|---|---|
| `/api` | `server.py` (`api_router`), `approvals_router.py`, `routers/uploads.py`, `routers/search.py` |
| `/api/auth` | `auth_router.py` |
| `/api/admin` | `invite_router.py` |
| `/api/activity` · `/api/automations` · `/api/dashboards` · `/api/fields` · `/api/views` · `/api/templates` · `/api/time` · `/api/reports` · `/api/task-reminders` · `/api/internal` | the same-named `routers/*.py` |
| `/api/v1/admin/orgs` | `routers/admin_orgs.py` |
| `/api/v1/dristi` · `/api/v1/esign` · `/api/v1/ganit` · `/api/v1/graha` · `/api/v1/manav` · `/api/v1/prachar` · `/api/v1/scrapers` · `/api/v1/subscription` · `/api/v1/vetana` · `/api/v1/vikray` | the same-named `routers/*.py` |
| `/api/v1/hub` | `routers/hub.py`, `hub_chat.py`, `hub_publish.py` — three files, one prefix |
| `/api/v1/prachar/ads` | `routers/prachar_ads.py` |
| **`/api/v1/messaging`** | `routers/messaging.py` — **not** `/api/messaging` |
| **`/api/v1/whatsapp`** | `routers/whatsapp.py` — **not** `/api/whatsapp` |
| `/api/v1/org/members` · `/api/v1/org/profile` | `routers/org_members.py`, `org_profile.py` |
| `/api/v1/pahchan` | `routers/pahchan.py` |
| `/api/v1/tasks` | `routers/tasks_bulk.py` — the only `/api/v1/tasks/*` route |
| `""` (root) | `health.py` |

**The trap this table exists to prevent.** Core PM lives at `/api/…` while every
module added since lives at `/api/v1/…`, and both are reachable from the same `api`
axios instance whose `baseURL` already ends in `/api`. Four of the five defects in §2
are this one mistake. If you are writing a call from memory, check here first.

### 3.2 Client-portal shapes — the wire names are not the internal ones

`GET /api/client/tasks` → `List[ClientTaskOut]` · `POST /api/client/tasks/request` →
`ClientTaskOut` · `GET /api/client/approvals` → `List[ClientApprovalOut]` ·
`GET /api/client/projects` → `List[ClientProjectOut]`.

| Internal `TaskOut` | `ClientTaskOut` wire name |
|---|---|
| `task_id` | `taskId` |
| `description` | `note` |
| `due_at` | `expectedAt` |
| `created_at` / `updated_at` | `createdAt` / `updatedAt` |
| `team_id` | `projectId` |
| `attachments` | `files` |
| `created_by_name` | `requestedBy` |
| `status` (6 values) | `state` (3: `with_us` / `with_you` / `done`) |
| `priority`, `tags`, `category_id`, `column_id`, `assignee_*`, `custom_fields`, `subtasks`, `estimated_minutes`, `user_id`, `created_by_user_id`, `approval_status`, `approved_by`, `completed_at`, `archived_at`, `reminders` | **absent by design** |

`ClientApprovalOut`: `approvalId`, `taskId`, `ref`, `title`, `ask`, `requestedBy`,
`requestedAt`. **No `approval_status`, `request_data`, `task_title`, `notes`,
`created_at`, `priority` or `team_id`** — `server.py:641` calls those internal
vocabulary and omits them on purpose.

`frontend/src/pages/client/clientShape.js` is the reference implementation: it
discriminates on `typeof raw.taskId === 'string'` (`:90`) and handles both wire
shapes. Copy it rather than reinventing it. `mobile/src/api/types.ts` now carries the
same shape as `ClientTask`.

### 3.3 Backend routes with no caller — 168 / 650

"Uncalled" and "dead" are not the same thing, so these are grouped by *why*.

**Called by infrastructure, not the app (~26) — do not delete.**
`routers/scheduler.py` (13 × `/api/internal/cron/*`, Railway cron), `whatsapp.py`
webhook GET+POST (Meta calls these), `hub_publish.py: GET /api/v1/hub/oauth/{platform}/callback`
(OAuth redirect), `POST /api/reports/dispatch`, `POST /api/task-reminders/dispatch`,
`POST /api/v1/hub/publish/dispatch`, `GET /api/health`, `GET /api/`,
`POST /api/v1/graha/inbound-leads`, `POST /api/v1/graha/f/{slug}` (public form post),
`ganit.py` `/sign/{token}/*` × 4 (public e-sign, opened from an emailed URL),
`approvals_router.py` `by-token` approve/reject (emailed links).

**Feature built, no UI — the interesting ones**, largest first:

| File | Uncalled | Notable |
|---|---|---|
| `routers/hub.py` | 23 | all of `ai-feedback` (3), all of `ai-conversations` (3), `analytics/spend` × 2 (gated), `org/brand` GET+PUT, `org/credits/*` (3) |
| `routers/graha.py` | 22 | `pipelines` GET+POST, `scoring-rules` GET+PATCH, `inbound-emails` × 2, `follow-ups`, `activities`, `territories` × 2 |
| `routers/manav.py` | 13 | `availability` GET+POST, `leaves/check-conflicts`, `shift-bids/{id}/accept/{employee_id}`, `schedules/bulk` |
| `routers/prachar.py` | 12 | `campaigns/{id}/audience`, `campaigns/{id}/stats`, `events/{id}`, most `PATCH`es |
| `routers/ganit.py` | 11 | `bank-statements` + `/match`, `expenses`, `invoices`, `vendor-bills` list reads |
| `backend/server.py` | 10 | `POST /api/admin/migrate-data-uris`, `PUT /api/settings/brand-colors`, `PATCH /api/teams/{id}/brand`, `POST /api/projects/{id}/columns/reorder`, `PATCH /api/tasks/{id}/toggle`, `POST\|DELETE /api/tasks/{id}/clients/{user_id}`, `GET /api/dashboard/summary`, `GET /api/approvals/pending` |
| `routers/whatsapp.py` | 10 | residual after §2.1: `accounts`, `auto-replies`, `templates` writes |
| `routers/admin_orgs.py` | 7 | `cost-breakdown`, `credits/usage`, `credits/topup`, `storage`, `cost-summary`, `provider-costs`, `r2` |
| `routers/me.py` | 6 | landed this run; UI presumably still coming |
| `routers/dashboards.py` | **5 — the whole router** | `GET\|POST /api/dashboards/`, `GET\|PUT\|DELETE /{id}`, `/{id}/data`. **The strongest dead-code candidate in the backend** — but it is a coherent saved-dashboards feature, so it reads as a missing UI, not rot |
| `routers/messaging.py` | 5 | residual after §2.1: `/dm`, channel members × 3, `/unread` |
| `routers/vikray.py` | 4 | `orders`, `stock/{id}/moves`, `targets/leaderboard`, `DELETE targets/{id}` |
| `routers/vetana.py` | 3 | `payslips`, `statutory-summary`, `DELETE salary-structures/{sid}` |
| `esign.py` · `dristi.py` · `scrapers.py` · `org_modules.py` · `org_security.py` · `subscription.py` · `hub_publish.py` | 2 each | |

**I am not recommending deleting any of these.** An uncalled route is a missing UI far
more often than dead code, and several (`admin_orgs` cost/credits, `pahchan`, `me`) are
known in-flight work. `dashboards.py` is the one worth a decision.

### 3.4 Computed-path call sites — 27, all opened by hand

These pass a variable, so no scanner resolves them. I checked all 27; none is a defect
(the one that was, `varta/WhatsAppTab.jsx:88`, is fixed in §2.1). The pattern is a
module-level `ENDPOINT`/`TAB` constant plus `api.get(MAP[tab], params)` — used by
`ganit/*Tab.jsx`, `graha/*Tab.jsx`, `manav/*Tab.jsx`, `esign/DocumentsTab.jsx`,
`VetanaPage.jsx`, `VikrayPage.jsx`, `TaskDrawer.jsx:377`, `ApprovalsPage.jsx:148`,
`admin/orgScope.js:60`. `mobile/src/offline/mutationQueue.ts:168-171` dispatches a
queued verb against a stored URL — correct by construction.

**This is the blind spot in any grep-based audit**, and exactly how the four WhatsApp
endpoints hid: a constant map defeats a path-literal scan completely.

### 3.5 Cleared — flagged but NOT defects

| Claim | Verdict |
|---|---|
| `POST /approvals/task_approval--${taskId}/review` (`mobile/src/api/tasks.ts:76`) | **Fine.** `server.py` serves `/approvals/{approval_id}/review`; `task_approval--` is part of the id, not a path segment. The comment at `tasks.ts:58-72` is accurate. |
| `POST /approvals/by-token/${token}/${act}` (`ApprovePage.jsx:64`) | **Fine.** `act` is `approve`/`reject`; both exist (`approvals_router.py:499,570`). |
| `PATCH /v1/manav/expense-claims/${claimId}/${decision}` (`ExpensesTab.jsx:56`) | **Fine.** `decision` is `approve`/`reject`; `manav.py:1657,1687`. |
| `POST /v1/subscription/modules/${on ? … }` (`AdminBillingPage.jsx:176`) | **Fine.** `subscription.py:190,242`. |
| `DELETE /admin/users/{id}${reassign ? …}` (`AdminPage.jsx:220`) | **Fine.** Trailing ternary is a query string. |
| `/v1/graha/*${params}`, `/v1/vikray/stock${…}`, `/v1/hub/org/content${params}` | **Fine** — query strings; my first-pass regex mis-parsed them. |
| `clientShape.js` "is broken" | **False.** It handles both wire shapes and is the model. |

### 3.6 One pre-existing footgun I did not touch

`app.openapi()` warns `Duplicate Operation ID me_api_auth_me_get` and
`…logout_api_auth_logout_post`. **`/api/auth/me` and `/api/auth/logout` are each
defined twice** — once in `auth_router.py`, once in `server.py`. FastAPI serves the
first registration and silently ignores the second, so behaviour depends on
`include_router` ordering. Not mine to adjudicate; currently unowned.

---

## 4. JOB 2 — dead code and duplication

### 4.1 Deletions — all four targets resolved

| Target | Outcome |
|---|---|
| `components/TaskEditor.jsx` | **Deleted by a sibling.** Zero importers; the surviving greps were three prose comments and BoardsPage's unrelated `newTaskEditor` state variable. |
| `EmptyState` duplicate in `components/module/Note.jsx` | **Removed by a sibling** — zero importers. |
| `pages/BillingPage.jsx` | **Already deleted** in `a4b186f`, together with ScrapersPage. See below for how the contradiction resolves. |
| `pages/ScrapersPage.jsx` | **Already deleted** in `a4b186f`. |
| `styles/modern-components.css` | **Deleted by me**, with its `@import`, in one commit. |

**The `BillingPage.jsx` contradiction, settled.** One agent found zero importers; a
later grep found 6 references. **Both were right about their own numbers, and the
second was measuring the wrong thing.** Classifying every occurrence:

- `App.jsx:66` — `lazy(() => import('./pages/AdminBillingPage'))`. This is
  **`AdminBillingPage`, a different file**; `BillingPage` matches only as a substring.
- `App.jsx:260` — `<Route path="billing" element={<AdminBillingPage />} />`, same substring.
- `AdminBillingPage.jsx:2` and `:82` — the other file's own name, twice more.
- `App.jsx:62`, `App.jsx:223`, `navConfig.js:94`, `statusColors.js:77`,
  `org/TabBilling.jsx:15`, `kartavaya-design.css:438` — **prose comments**.

So: **zero real importers, and 4 of the 6 "references" were the substring
`AdminBillingPage`.** This is precisely the failure the brief warns about — a grep for
a filename catches comments and strings, and here it also caught a *longer filename
containing the shorter one*. Moot now, but the method is the lesson.

**`ScrapersPage.jsx`** — the "zero importers" claim was correct; already actioned.

**`modern-components.css` — done, and here is the proof, because this one had a
specific trap.** An earlier agent had already emptied the file to a pure comment and
left the handoff in it: *"Delete the file and its `@import './modern-components.css';`
line together."* That pairing is the whole point — an unresolvable `@import` is a hard
Vite error, and splitting the two edits has broken HEAD twice in this repo.

Removed in **one commit**: the file, the `@import` in `styles/index.css`, both
`styles/README.md` entries, and the load-order comment in `mobile-responsive.css`
(which enumerated the barrel and would otherwise have been wrong about its own
position — it said "EIGHTH of thirteen", now "SEVENTH of twelve").

**Verified from a clean checkout of the commit, not from my working tree** — a working
tree still has the deleted file on disk and resolves an import a fresh clone cannot.
Method: `git archive HEAD frontend/src/styles … | tar -x` into a scratch directory,
then resolve every `@import` specifier in that extracted tree against the filesystem,
with `/* … */` comments stripped first so commented-out imports don't mask a real one.
Result: **12 local `@import` specifiers, 0 dangling.** Both gates green.

*Honest limit:* `frontend/node_modules` is not installed in this worktree, and
installing it would risk the lockfile rule, so I could not run a real `vite build`.
The import-resolution check over the committed tree is the strongest proof available
here, and it is the check that catches this specific failure — but it is not a build.

### 4.2 Duplication — measured

**Buttons — the "3×" claim is now stale; it is 2.** `.k-btn-primary` /
`.k-btn-outline` / `.k-btn-ghost` were already collapsed by a sibling: the only two
surviving occurrences of `k-btn-primary` in the whole tree are inside a **comment** in
`brand.css:74,81` recording that removal. Live counts: `k-btn` **939** occurrences,
bare `btn` in a `className` **510**, `k-btn--primary` (BEM) **213**, `k-btn-primary`
(single-dash) **0 in code**.

`.btn` vs `.k-btn` remain two genuinely different vocabularies. Per the coordinator
this is a design decision, not a stylesheet edit — **reported, not converged.** (My
939/510 are occurrence counts, not element counts, so they are not comparable to the
coordinator's 454 figure; different method, same conclusion.)

**Drop zones — 4, and the shared component already exists at 1/4 adoption.** This is
more useful than the raw count:

| Site | Status |
|---|---|
| `components/documents/FileDropZone.jsx` | **the shared component** |
| `pages/esign/CreateTab.jsx:147` | ✅ uses it — the only adopter |
| `components/drawer/DrawerAttachments.jsx` | hand-rolled (2 × `onDragOver`) |
| `components/NewTaskModal.jsx` | hand-rolled |
| `pages/org/LogoUpload.jsx` | hand-rolled |

(`components/views/CalendarView.jsx` also has drag handlers, but it drags *tasks onto
dates*, not files — not a fifth drop zone.) The convergence target is built and
proven; three call sites need to adopt it. Safe, but it touches three files owned by
other agents this batch, so it is a follow-up rather than a mid-swarm edit.

**`.k-segctrl` hand-rolled at 6 sites — the best convergence candidate in the
codebase.** `ViewToolbar.jsx`, `ActivityFeedPage.jsx`, `ApprovalsPage.jsx`,
`BoardsPage.jsx`, `ProjectBoardPage.jsx`, `TasksListPage.jsx` each rebuild the same
`<div className="k-segctrl">` plus mapped
`<button className={'k-segctrl__btn' + (active ? ' is-active' : '')}>`. The CSS is
already shared; only the JSX is duplicated. One small presentational component, six
mechanical call-site edits, no behaviour change.

It also has a correctness payoff: `_SOURCE-MAP.md` records that `26 §5` specifies an
invalid `aria-selected` on `role="radio"`, and **two agents independently had to
rediscover the right answer**. One component means that decision is made once instead
of six times.

**The "same table 9 times" — confirmed as a pattern, with a caveat that changes the
recommendation.** The module tabs (`ganit/*Tab.jsx`, `graha/*Tab.jsx`, `manav/*Tab.jsx`,
`esign/DocumentsTab.jsx`) share a near-identical *shape* — `ENDPOINT` map, `useEffect`
fetch, loading skeleton, `k-table` markup — but **not identical column sets or row
actions**. A shared `<DataTable>` would need a column-descriptor API rich enough to
express all nine, at which point it is a framework, not a component. The
high-value/low-risk extraction is the **fetch + loading/empty/error state machine**,
which genuinely is identical across all nine. The markup is not the duplication that
costs.

---

## 5. Claims from my own pre-stop report that are now STALE

Recorded so nobody acts on the earlier version of this file.

| Pre-stop claim | Status |
|---|---|
| `ApprovalsPage.jsx` renders `/client/approvals` with the wrong shape; client Approve/Reject buttons never render | **Fixed by `e366f50`** — client-endpoint calls are gone from staff pages entirely |
| `TasksListPage.jsx` filters on renamed fields; Mine/Done/Overdue empty for clients | **Fixed by `e366f50`** |
| `POST /client/tasks/request` returns `response_model=TaskOut` | **Fixed by `e366f50`** — now `ClientTaskOut` |
| `GET /client/projects` has no `response_model`, returns `SELECT t.*` | **Fixed by `e366f50`** — now `ClientProjectOut` |
| Six call sites use bare `role === 'client'` vs `navContext().isClient` | **Fixed by `e366f50`** — one shared predicate |
| `pages/BillingPage.jsx` needs adjudicating | **Moot** — deleted in `a4b186f` |
| `pages/ScrapersPage.jsx` reported as dead | **Correct, and already deleted** in `a4b186f` |
| Buttons exist 3× | **Stale — 2 now**; the third vocabulary was already removed |
| `test_ganit.py::test_create_invoice_success` fails | **Fixed by a sibling mid-run.** Suite is 498 passed, 0 failed |

The mobile half of the client-shape defect (§2.5) was **not** in `e366f50`, was still
live, and I fixed it.

---

## 6. What I did not finish

- **No real `vite build`** — `frontend/node_modules` is absent and installing risks the
  lockfile rule. See the honest limit in §4.1.
- **Duplication convergence** — mapped and measured, not converged. `.k-segctrl` (6
  sites) is the one I would do first; drop-zone adoption (3 sites onto the existing
  `FileDropZone`) is second. Both were left because they touch files other agents own
  this batch.
- **`/api/auth/me` and `/api/auth/logout` double registration** (§3.6) — unowned.
- **`routers/dashboards.py`** — whole router uncalled (§3.3). Needs a product decision,
  not a code one.
- The 168 uncalled routes were checked against the static scan plus the 27 hand-checked
  computed paths. A route called *only* from a computed path I misread would still read
  as uncalled; the exposure is small but not zero.
