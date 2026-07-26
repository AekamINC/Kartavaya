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
| 5 | `POST /client/tasks/request` returns internal `TaskOut` | **HELD** |
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

*(Sections below are appended as work lands.)*
