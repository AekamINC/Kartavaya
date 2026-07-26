# Client portal — verification and repair

Agent branch: `worktree-agent-a8d83f1b28b6e5edd`
Base: `staging` @ `2a2a27b`
Scope: `frontend/src/pages/client/**`, client portal styles, and the backend
endpoints those pages consume.
Governing spec: `design-handover/19-client-portal.md` (identified by reading the
handover index — it is the only file in `design-handover/` that covers this
surface; `08-rbac-screens.md`, `13-module-pages.md` and `02-common-components.md`
are named by 19 as its prerequisites).

> **Worktree note.** This worktree was cut from `main`, not `staging` — `HEAD`
> equalled `origin/main` (`1aa4985`) and was 271 commits behind `origin/staging`
> with 13 commits `staging` does not have. Everything below was re-verified after
> `git reset --hard origin/staging` on the agent branch. `main` was not touched.
> Any earlier report written from this worktree without that reset was reading
> production code, not the branch under review.

---

## Verdicts at a glance

| # | Claim as handed to me | Verdict |
|---|---|---|
| 1 | `TasksListPage.jsx` ~106 still on the OLD client shape | **HELD** (live for one user class) |
| 2 | `ApprovalsPage.jsx` ~41 still on the OLD client shape | **HELD** (live for one user class) |
| 3 | `client/__tests__/smoke.test.jsx` ~76-77 still on the OLD shape | **STALE** |
| 4 | `clientShape.js` normalisers are now redundant | **STALE** — deliberately dual-shape |
| 5 | `POST /client/tasks/request` returns internal `TaskOut` | **HELD** (also fixed concurrently by a sibling agent — see below) |
| 6 | Route guard was a 7-path DENY-list, reportedly fixed to an allow-list | **STALE** (already fixed) |
| 7 | Client API returned every comment; gated by unapplied `PROPOSED_056` | **STALE** — safe without it |

Detail and evidence for each below.

---

## 1-2 · The two staff call sites — HELD, but not for the reason given

The backend contract did change and both call sites do read the old shape. What
the hand-off got wrong is *who is affected*.

**Current backend contract, read directly:**

- `backend/server.py:968` — `@api_router.get("/client/tasks", response_model=List[ClientTaskOut])`
- `backend/server.py:1031` — `@api_router.get("/client/approvals", response_model=List[ClientApprovalOut])`

`ClientTaskOut` (server.py:609) and `ClientApprovalOut` (server.py:641) both set
`model_config = ConfigDict(populate_by_name=True)` and alias every multi-word
field to camelCase. FastAPI serialises response models with
`response_model_by_alias=True` by default, so the **wire** shape is camelCase:
`taskId`, `expectedAt`, `updatedAt`, `requestedBy`, `projectId`, `awaitingMe`,
`approvalId`, `requestedAt`.

**What the two staff pages do with it:**

- `frontend/src/pages/TasksListPage.jsx:105-114` puts the raw response into
  `tasks`, then filters on `t.status`, `t.user_id`, `t.assignee_user_ids`,
  `t.due_at` (lines 149-158) and archives by `t.task_id` (line 134). None of
  those keys exist on `ClientTaskOut`.
- `frontend/src/pages/ApprovalsPage.jsx:41-43` puts the raw response into
  `requests`, then reads `r.approval_id`, `r.approval_status`,
  `r.requested_by_name`, `r.task_title`, `r.request_data` (lines 226-300). All
  snake_case; `ClientApprovalOut` carries none of them, and deliberately has no
  status field at all.

**But a genuine client can never reach either page.** `Protected.jsx:114-118` is
an allow-list — see §6 — so `role === 'client'` with no org membership is
redirected to `/client` from anything outside `/client/*`, and `/tasks` and
`/approvals` are children of the staff `AppShell` route.

The live defect is a **predicate mismatch**, which is the part the hand-off
missed:

| Site | Predicate |
|---|---|
| `Protected.jsx` (the guard) | `navContext(user).isClient` = `role === 'client' && orgRoles.length === 0` (`navConfig.js:106`) |
| `TasksListPage.jsx:67` | `user?.role === 'client'` |
| `ApprovalsPage.jsx:36` | `user?.role === 'client'` |
| `BoardsPage.jsx:32` | `me?.role === 'client'` |
| `NewTaskModal.jsx:44` | `currentUser()?.role === 'client'` |

So a user who is **flagged `client` *and* holds an org role** — staff who happen
to carry the flag; `Protected`'s own comment calls this out and refuses to
confine them — is *not* confined by the guard, *is* treated as a client by all
four pages, and therefore fetches client-shaped payloads into staff-shaped
renderers. That is the actual live break.

**Fix applied:** all four sites now use the same `navContext(user).isClient`
predicate as the guard, so "who is a client" has one definition. For a hybrid
user the branches now resolve to the staff endpoints, which is correct — they
have org membership. For a genuine client the branches are unreachable by
construction. The client endpoint calls were then removed from those staff
pages, so no staff page calls a `/client/*` endpoint at all.

---

## 3 · The smoke test — STALE

`frontend/src/pages/client/__tests__/smoke.test.jsx:74-81` is the `APPROVALS`
fixture and lines 76-77 are inside it. It is snake_case *on purpose*: the file
carries **two** describe blocks, and the second one (from line ~323) mounts the
same pages against `SHAPED_TASKS` / `SHAPED_APPROVALS` camelCase fixtures at
lines 359-361, with its own header explaining that the API now builds the shape
itself. The test exercises **both** wire arms deliberately. Nothing to fix.

---

## 4 · `clientShape.js` normalisers — STALE, and they should stay

The claim is that the stopgap normalisers are now redundant because the server
shapes the payload. They are not redundant, for a reason the module itself
records at `clientShape.js:28-35` and which I re-verified:

- The backend deploys to Railway and the frontend to Vercel — **two independent
  deploys**. A rollback of either half is a real window, not a hypothetical.
- During that window the legacy arm is the only thing keeping the portal from
  rendering empty. `toClientTasks` (line 254) applies `isMine` to legacy rows
  **only**; a shaped row has no `created_by_user_id` / `assignee_user_ids` /
  `approved_by` to test, so running the same filter across both arms would
  reject every row.

Kept as-is. The discriminators (`isShapedTask` → `taskId`, `isShapedApproval` →
`approvalId`) are correct against the current models.

---

## 5 · `POST /client/tasks/request` — HELD

`backend/server.py:1158` is `response_model=TaskOut` and line 1223 returns
`row_to_task(row)`.

**The hand-off's reasoning holds, with a correction.** It is not a live
third-party leak: the row is `INSERT ... RETURNING *` from this same handler
(lines 1179-1185) with `created_by_user_id` = the caller, `created_by_name` =
the caller, `custom_fields='{}'`, `subtasks='[]'` and attachments straight from
the caller's own payload. `assignee_user_ids` / `assignee_emails` /
`assignee_names` are never set, so they come back empty. Nothing belonging to
another party is on the row.

It is still a **shape violation**, and 19's rule is about the shape rather than
about today's contents: *"The endpoint returns a client shape, or this will leak
eventually."* What does cross today is the firm's internals rather than another
client's data — `column_id`, `sort_order`, `board`/`team_id`, `approval_id`, the
raw `status='requested'` and `priority`, i.e. the firm's triage and board
structure, all on 19's never-see list. And the eventual leak is exactly the one
19 describes: a field added to `TaskOut` next month arrives here by default.

**Fix applied:** `response_model=ClientTaskOut`, returning
`_to_client_task(row_to_task(row), uid)`.

Caller audit before changing it:
- `frontend/src/pages/client/RequestWork.jsx:55` — the portal's own caller,
  `await`s and discards the response. Unaffected.
- `frontend/src/components/TaskEditor.jsx:176` — behind a `clientMode` prop
  that defaults to `false` (line 30) and **is passed by nobody** (grepped the
  whole of `frontend/src`). Dead code.
- `frontend/src/components/NewTaskModal.jsx:299` — passes `res.data` to
  `onCreated`. Reachable only by the hybrid user of §1-2, who after the
  predicate fix posts to `/tasks` instead.

---

## 6 · The route guard — STALE, already an allow-list

`frontend/src/components/layout/Protected.jsx:114-118`, read just now:

```js
// 2 · Client confinement. Allow-list, not deny-list.
if (ctx.isClient) {
  if (!underPath(path, CLIENT_HOME)) return <Navigate to={CLIENT_HOME} replace />;
  return children;
}
```

`CLIENT_HOME = '/client'` (line 50) and `underPath` (line 55) matches the prefix
exactly or a `/`-delimited descendant, so a path like `/clientele` cannot slip
through. Line 124 adds the converse — a non-client inside `/client/*` is sent to
`/dashboard`.

The deny-list is gone. Confirmed fixed; no change needed.

---

## 7 · Comments — STALE, and the portal is safe without `PROPOSED_056`

`backend/migrations/PROPOSED_056_task_comment_client_visibility.sql` is not
applied. What the code does **today**, at `backend/server.py:1518-1546`:

```py
is_client = user.get("role")=="client"
if is_client:
    if not await client_can_access_task(pool, task_id, user["user_id"]):
        raise HTTPException(403, ...)
has_flag = await _has_client_visible_column(pool)
if not has_flag and is_client:
    return []
```

The column is **probed** at runtime (`_has_client_visible_column`, line 1508,
querying `information_schema.columns`) rather than assumed. Pre-migration the
probe is `False`, and a client gets `[]` — fail-closed. Post-migration the same
code path adds `AND c.is_client_visible IS TRUE` with no redeploy. `CommentCreate`
also defaults `is_client_visible=False` (line 563), so a comment is internal
unless deliberately marked.

That probe matters here for a reason beyond this endpoint: staging and
production **share one Supabase database**, so this file has to run correctly on
both schemas at once. Probing is what makes that true.

Independently, the portal never reaches this endpoint at all: grepping
`frontend/src/pages/client/` and `ClientPages.jsx` for `comments` returns only
two prose comments in source, no `api.get`. The client shape carries the task
`description` and nothing else prose-shaped (`_to_client_task`, server.py:953).

So the portal is safe without the migration on both counts. No change needed.

---

### Convergence note on §5

A sibling agent fixed `POST /client/tasks/request` concurrently, and staging
carried their version by the time I rebased to merge. We reached the same
verdict independently — the claim HELD, and it was a shape violation rather
than a live third-party leak. **Their implementation is strictly better and is
the one that survives:** they also run `_filter_private_attachments` and
`_refresh_task_attachments` before reducing, in the same order as
`/client/tasks`, so the attachment URLs on the returned row are freshly signed.
Mine reduced the row directly. I resolved the conflict in their favour and kept
one paragraph of my docstring naming the specific fields that used to cross
(`column_id`, `sort_order`, `approval_id`, raw `status`/`priority`).

Two independent confirmations of the same finding is worth more than either
alone; recording it so the next reader does not treat it as one agent's opinion.

---

## 8 · One more leak, not on the list — `GET /client/projects`

Found while auditing the endpoints the portal actually calls. It was the one
client endpoint still returning a raw row:

```py
rows = await pool.fetch("SELECT DISTINCT ON (t.team_id) t.* FROM teams t ...")
return [dict(r) for r in rows]
```

So every column of `teams` reached an external browser — `created_by` (an
internal user id), `org_id` (tenancy internals), `brand_settings`, `deleted_at`
— for the sake of the two fields the portal reads. Now
`response_model=List[ClientProjectOut]`, the SELECT names only `team_id`,
`name` and the `created_at` its own `DISTINCT ON` orders by, and the handler
builds the model by hand.

---

## The exact response shape each portal page now consumes

All three views share **one** fetch (`useClientPortal.js`) and every payload
crosses `clientShape.js` before a component sees it. The hook exposes no raw
row.

### `GET /api/client/tasks` → `List[ClientTaskOut]`

```
{ taskId, ref, title, note, state, expectedAt, updatedAt, createdAt,
  requestedBy, projectId,
  files: [{ name, url, size, sharedBy, sharedAt }],
  decision: { outcome, note, at } | null,
  awaitingMe }
```

`state` is one of `with_us` | `with_you` | `done` — the six internal statuses
collapse in `_client_state` (server.py:916) so the portal cannot drift from the
mapping. `ref` is `#` + the last six of the task id.

### `GET /api/client/approvals` → `List[ClientApprovalOut]`

```
{ approvalId, taskId, ref, title, ask, requestedBy, requestedAt }
```

No `files`: the portal joins to the task by `taskId` and reads them there, so
attachment filtering has one home rather than two.

### `GET /api/client/projects` → `List[ClientProjectOut]`  *(newly shaped)*

```
{ projectId, name }
```

### `POST /api/client/tasks/request` → `ClientTaskOut`  *(newly shaped)*

Same shape as a row of `/client/tasks`, so a request a client just submitted
comes back exactly as the list will hand it to them a moment later.

### `GET /v1/org/profile` → reduced by `toFirm` to `{ name, logoUrl }`

Optional by design: the hook `.catch`es it, because a portal-only account may
have no org membership and the firm's wordmark is a nicety while the work is the
page.

### Which page reads what

| Page | Consumes |
|---|---|
| `ClientHome` (Overview) | `tasks` split by `state`; `approvals.length` for the banner; `projects` for Request work |
| `ClientApprovals` | `approvals` for the queue; `tasks` for the decision log (`decision`) |
| `ClientFiles` | `tasks[].files` flattened |
| `ClientProject` | `tasks` filtered by `projectId` |
| `ClientShell` | `firm`, `approvals.length`, the client's own name |

---

## Design fidelity

`19-client-portal.md` supplies its own CSS for this surface, and the reference
implementation under `design-reference/Kartavaya Redesign/` has **no dedicated
client-portal screen** — the client block at `ScreensRBAC2.jsx:313`
(`RolesClient`) is an illustration inside the RBAC gallery, built from
`lvlmock` / `mockcard` gallery classes, showing what a guest sees conceptually.
It is not the portal's pixel source. `ScreensMore.jsx:255` "Hub (Client Portal)"
is the **Hub module** — the firm-side view of its clients — a different surface.
So 19's own CSS block is the specification here, and `styles/client.css`
implements it.

Checked line by line against 19:
- Shell structure (`header` → `nav` → main) matches `ClientShell.jsx` exactly,
  including "three items, horizontal, no icons".
- `.cl-appr`, `.cl-appr__ask`, `.cl-appr__act` match 19's declarations.
- Approve is one click with no confirm; Request changes keeps Send disabled
  until there is text and the disabled button says why — both behavioural rules
  are implemented and covered by the smoke test.
- Firm logo from `/v1/org/profile`, falling back to the firm's **name** in
  `--font-display`, never a Kartavaya mark.
- `--primary` is used only as a 2px rule on the current nav tab; every coloured
  text token in `client.css` is `--primary-text`. `--on-surface-faint` is not
  used in the file at all.
- Fixed Devanagari sub-labels use `--font-hindi`, per the known spec defect in
  `_SOURCE-MAP.md` (`--font-indic` resolves to Noto Sans Gujarati under EN+GU,
  which has zero Devanagari coverage).

### Spec defects recorded (not silently deviated from)

1. **`19` · Shell specifies `.cl-main{max-width:1040px;margin:0 auto}`.**
   Overridden by the owner's standing rule that all pages are fluid and
   left-aligned with no fixed-width centring. `client.css` implements the fluid
   form and documents why in its header. A centred column was also the one thing
   in the portal that did not match what the firm's own staff see — on the one
   surface where a mismatch reads as two different products.
2. **`19` · Endpoints says "The two `POST`s are new"** and names
   `/api/client/approvals/:id/approve` and `.../request-changes`. They are not
   new. `backend/approvals_router.py` already carries
   `POST /tasks/{id}/client-approve` and `POST /tasks/{id}/client-reject`, with
   the required-note rule enforced server-side. Building the two 19 names would
   be a second way to approve the same thing. The portal uses the existing pair.
3. **`19` · Files to modify/create/delete is stale in four of its six lines** —
   `ClientPagesImpl.jsx` and `ClientPortalPage.jsx` do not exist, and
   `ClientPages.jsx` is the implementation rather than a barrel over them. This
   was already recorded in `ClientPages.jsx`'s header; re-verified.

### Generated documents

The coordinator flagged the eight print documents under
`design-reference/Kartavaya Redesign/docs/` as in scope because the portal is
where clients receive them. **The portal does not currently render or link to
any of them**, and `19` does not ask it to: its Files section is scoped to
task attachments ("Only attachments marked client-visible… name, size, who
shared it, when. Download, no delete."), and its Endpoints block lists no
document endpoint. Those documents reach a client by email and via the public
`/sign/:token` route, neither of which is this surface. I have not invented a
documents panel; flagging it as a genuine product gap rather than a defect —
see "Not done" below.

---

## Route changes

`/client/approvals` and `/client/files` were `<Navigate>` redirects to
`/client?view=…`; they are real routes now, mounted on `ClientProjectsPage`
inside `<Protected>`. The justification for the redirect ("making them real
needs a `view` prop on `ClientProjectsPage`") was wrong: `viewFromLocation`
(`ClientPages.jsx:64`) already resolves the view from the pathname first, and
`client/__tests__/smoke.test.jsx:122` already mounted all three paths on the
same element. The redirect cost the canonical URL — a client who bookmarked the
`/client/approvals` link from their email watched the address bar rewrite
itself. The `?view=` fallback is retained so links already emailed keep working.

---

## Verification

| Check | Result |
|---|---|
| `node frontend/scripts/check-tokens.mjs` | **pass** — 339 declared, 233 referenced, 0 missing |
| `node frontend/scripts/check-classes.mjs` | **pass** — 2096 selectors, 1413 classes, 0 missing a rule |
| `npx vitest run` (frontend, all) | **226 passed**, 14 files |
| `pytest tests/` (backend, all) | **314 passed, 1 failed** |

The one backend failure is `tests/test_ganit.py::test_create_invoice_success`
(`TypeError: 'MagicMock' object can't be awaited` inside
`utils.next_doc_number`). **Pre-existing and unrelated** — it fails identically
with my backend changes stashed, and its call path (`routers/ganit.py`,
`utils.py`) is in no file this branch touches.

Both gates and both suites were re-run after the final rebase onto
`origin/staging`, which had advanced (the token gate itself changed, from 279
declared tokens to 339).

Note: this worktree had no `node_modules`, so the frontend suite could not run
at first. I junctioned `frontend/node_modules` to the main checkout's rather
than installing — installing would have rewritten `yarn.lock`, and Windows yarn
rewrites esbuild `linux-x64` → `win32-x64`, which breaks the Vercel and Railway
Linux builds. `frontend/.gitignore:5` ignores `node_modules/`, so nothing from
it can be committed. Neither lockfile is modified on this branch.

---

## Not done / open

- **No documents panel in the portal.** The eight print documents
  (`design-reference/Kartavaya Redesign/docs/`) — Tax Invoice, Statement of
  Account, Quotation, Service Agreement and the rest — have no client-facing
  surface here, and `19` does not spec one. If clients are meant to receive
  invoices and statements *in* the portal rather than only by email and signing
  link, that needs a spec and an endpoint (there is no
  `GET /client/documents`). Flagged rather than invented.
- **`PROPOSED_056` is still unapplied**, so a client sees no comments at all.
  That is the correct fail-closed state and the portal does not request comments
  anyway, but until the migration lands there is no way for the firm to say
  something to a client on a task. I did not apply it — migrations are out of
  scope for this run and staging shares a database with production.
- **The `isClient` UI conditionals in `TasksListPage` / `ApprovalsPage` /
  `BoardsPage` are now provably unreachable** (the guard redirects every portal
  client away from those routes). I removed the client *endpoint* calls, which
  were the hazard, and left the cosmetic branches — ripping ~25 conditionals out
  of three files I do not own is a larger risk than the reward. Worth a
  follow-up cleanup by whoever owns those pages.
- **`GET /api/client/files` and `GET /api/client/files/:id/download`** from
  19's endpoint list do not exist and were not built: the portal derives its
  file list from `tasks[].files`, which is already filtered and re-signed
  server-side, so a second endpoint would be a second place to get attachment
  filtering right. Recorded as a deliberate deviation, not an omission.
