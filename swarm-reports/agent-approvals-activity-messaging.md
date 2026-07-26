# Agent report — approvals, activity feed, messaging (backend)

Branch: `agent-approvals-activity-messaging`
Base: `origin/staging` @ `2a2a27b`
Scope: `backend/approvals_router.py`, the approvals/activity endpoints in
`backend/server.py`, `backend/routers/activity.py`, `backend/routers/messaging.py`.
Out of scope by instruction: `manav.py`, `vetana.py`, `graha.py`, `org_*.py`, `me.py`.

> Written incrementally. Every line-number claim below was opened and read at the
> commit named beside it, not carried over from a prior report.

---

## 0. Worktree note (read this first)

The worktree handed to me was checked out at `1aa4985`, twelve commits of
unrelated frontend attachment work, with a merge-base of `294e9e2` against
staging. `backend/middleware/role_tiers.py` **did not exist** at that commit.
Rebasing conflicted in `frontend/src/components/drawer/DrawerAttachments.jsx`.

I abandoned that branch rather than drag another agent's frontend work through a
conflict resolution I have no context for, and branched clean off
`origin/staging`. **Those twelve commits are still unmerged and unowned** — if
nobody else is carrying them, they need a home.

---

## 1. Stale claims (checked, found already fixed)

Two of the four defects named in my brief were already fixed on staging. I
re-read both rather than trusting the brief.

### 1.1 STALE — "approvals leaked the requester's email and a `SELECT a.*`"

Fixed. `backend/server.py:1031-1105` (`GET /api/client/approvals`).

The client-facing path is now narrow, and narrow in the right way — the
allow-list is enforced by the *response model*, not by the SELECT list, so a
column added to `approvals` later cannot leak by default:

- `ClientApprovalOut` (`server.py:641-659`) has six fields and **no email field
  to populate**. `reviewed_by`, `review_notes`, `request_type` and the raw
  `status` have no home in the model.
- The SQL selects named columns (`a.approval_id, a.task_id, t.title,
  a.request_data, a.created_at`) plus `COALESCE(u.full_name,u.name,u.email) AS
  requested_by_name`. Note the `u.email` inside that COALESCE is a *fallback for
  a display name*, not an email disclosure — it only surfaces when the user row
  has neither `full_name` nor `name`. Worth knowing it can still emit an email
  string in that edge case; it is the same COALESCE used across the codebase.
- Both result sets are scoped to `a.requested_by = $1` OR an explicit
  `task_clients` row. The old `project_assignments`-only scoping that handed a
  client the firm's internal queue is gone.

### 1.2 STALE — "headline count computed off a capped list"

Fixed. `backend/server.py:1292-1323` (`GET /api/approvals/stats`).

Counts come from `COUNT(*) FILTER (WHERE ...)` in SQL, not `len()` of a page.
`/approvals/history` (`server.py:1265-1289`) is still `LIMIT 50`, which is
correct — it is a list, and the count no longer derives from it. The stats query
repeats the *same* visibility predicate as history, so the two cannot disagree.
"Today" is `Asia/Kolkata` civil day.

**Frontend follow-up (not verified by me):** I did not confirm the approvals page
actually calls `/approvals/stats` rather than still counting `/approvals/history`
client-side. The endpoint is right; the caller needs a look from whoever owns
that page.

---

## 2. Separated duty — **NOT ENFORCED ANYWHERE** (headline finding)

My brief said "verify the approval routes honour it". They do not, and the
reason is structural rather than a bug in any one route.

`middleware/role_tiers.py:241-259` defines the contract correctly:

```python
if module_code in SEPARATED_DUTY_MODULES and required == APPROVER:
    return held == APPROVER
```

**`level_satisfies` has zero call sites in the entire backend.** Verified by
grep across `backend/**/*.py`: the only hits are its own definition and
`role_tiers.py` internals. There is no `require_module_level` dependency. No
route anywhere reads the *level* of a module grant.

Concretely, in Vetana — the module the rule was written for:

- `PATCH /payroll/runs/{run_id}/approve` (`routers/vetana.py:664-692`) guards
  with `_require_payroll_admin`.
- `_require_payroll_admin` → `_is_payroll_admin` (`vetana.py:63-78`) →
  `is_org_admin(user_id, org_id)`.
- `is_org_admin` (`middleware/roles.py:114-144`) returns True for
  `org_owner`/`org_admin` and for every platform role.

So **an `org_admin` can approve a payroll run** — the exact act the model says
admin must not reach. Whoever defines what people are paid can also release the
money.

Why it is structural: `require_module` (`middleware/subscription.py:117-138`)
checks only for the *existence* of a row in `staging.org_member_modules`. The
`level` column that `level_satisfies` needs exists only in
`migrations/PROPOSED_065_module_role_levels.sql` and
`PROPOSED_066_tier3_tier4_roles.sql` — **proposed, not applied.** Until that
column is live, no guard can read a level, so the separated-duty rule cannot be
enforced regardless of which router you edit.

Also note `vetana.py:42-44` quotes RBAC-SPEC as saying sensitive modules have
**no per-member grant row at all** ("access is a function of the org role"). That
is in direct tension with the Tier-4 level model, which assumes a grant row
carrying a level. **These two designs cannot both be right.** Someone with the
owner's ear needs to settle which one governs Vetana and Ganit before the
enforcement is built — building it against the wrong one is worse than the
current gap, because it would look enforced.

I did not edit `vetana.py` (out of scope). Recorded here for its owner and for
whoever applies 065/066.

### What I could do about it

I tested the contract at the only layer where it currently exists —
`level_satisfies` itself — so that when enforcement is wired up, a regression in
the rule fails a test rather than shipping. See §6.

---

## 3. Cross-tenant findings

### 3.1 `get_org_id` admits commercial roles into any org — REPORTED, NOT FIXED

`middleware/org_resolver.py:12-49`. The `X-Org-Id` header is the "supply another
org's id" vector my brief asked about. It is validated:

```python
is_member = ... role_code IN ('org_owner','org_admin','org_member')  # for THIS org
if not is_member:
    is_platform = ... role_code = ANY(ALL_PLATFORM_ROLES)            # any org
```

The fallback set is `ALL_PLATFORM_ROLES`, which includes `COMMERCIAL_ONLY_ROLES`
(`account_manager`, `account_finance`, `srijan_admin`) and `platform_support`.
`role_tiers.modules_for()` gives every one of those `frozenset()` — they reach no
operational module. `platform_support` is documented at `role_tiers.py:40-43` as
granting *nothing* because its approval flow does not exist yet.

So the org boundary itself is crossable by four roles that the tier model says
reach nothing. For *module* routes `require_module` catches them a step later
(`subscription.py:85-90` calls `can_reach_module`). But `get_org_id` is also used
by routes with **no** `require_module` gate, where nothing catches them.

I did not fix this: `middleware/org_resolver.py` matches the `org_*.py`
exclusion in my brief, and it is shared middleware where a second concurrent edit
would be expensive. **Recommend** `ALL_PLATFORM_ROLES` here become a narrower
named set in `role_tiers.py` — the roles that may cross an org boundary at all,
which by the tier model is god mode + manager + staff, not the commercial four.

### 3.2 Activity feed hands platform roles every org — FIXED (§5.1)

### 3.3 Messaging thread/reaction reads skip channel membership — FIXED (§5.2)

### 3.4 Messaging member-add accepts a foreign-org user — FIXED (§5.2)

---

## 4. Cross-tenant queries verified CLEAN

Every query below I opened and confirmed scopes by the caller's identity or org,
and cannot be walked by supplying another org's id.

| Endpoint | File:line | Scoping predicate | Verdict |
|---|---|---|---|
| `GET /api/client/approvals` (approvals set) | server.py:1050-1069 | `a.requested_by=$1` OR `EXISTS task_clients tc WHERE tc.user_id=$1` | clean — caller identity, no org param |
| `GET /api/client/approvals` (tasks set) | server.py:1070-1089 | `EXISTS project_assignments` OR `EXISTS task_clients`, both on `$1` | clean |
| `GET /api/approvals/pending` (approvals) | server.py:1232-1238 | `EXISTS project_assignments WHERE team_id=a.team_id AND user_id=$1 AND role IN('owner','admin')` | clean |
| `GET /api/approvals/pending` (tasks) | server.py:1240-1262 | `project_assignments` OR `team_members` on `$1`, role owner/admin | clean |
| `GET /api/approvals/history` | server.py:1269-1288 | same predicate as pending | clean |
| `GET /api/approvals/stats` | server.py:1306-1319 | same predicate again, in a COUNT | clean |
| `GET /api/tasks/pending-approval` (admin) | approvals_router.py:322-334 | `EXISTS project_assignments` OR `EXISTS team_members` on `$1` | clean — admins are *not* given org-wide reach here |
| `GET /api/tasks/pending-approval` (member) | approvals_router.py:336-347 | `JOIN team_members ... user_id=$1 AND role IN('owner','admin')` | clean |
| `POST /approvals/by-token/{t}/approve` | approvals_router.py:511-515 | re-checks `task_clients` at decision time — token alone insufficient | clean, and correctly defensive |
| `POST /approvals/by-token/{t}/reject` | approvals_router.py:582-586 | same re-check | clean |
| `GET /api/v1/messaging/channels` | messaging.py:70-76 | `c.org_id=$1::uuid` AND (public OR member) | clean |
| `PATCH /channels/{id}` | messaging.py:113-116, 139-143 | org-scoped on both the read and the UPDATE WHERE | clean |
| `POST /dm` | messaging.py:155-161 | `c.org_id=$1::uuid` | clean for read |
| `GET /channels/{id}/members` | messaging.py:189-194 | channel existence checked org-scoped first | clean |
| `DELETE /channels/{id}/members/{u}` | messaging.py:245-250 | org-scoped channel check + admin-or-self | clean |
| `GET /channels/{id}/messages` | messaging.py:284-291 | org-scoped channel + membership unless public | clean |
| `POST /channels/{id}/messages` | messaging.py:332-346 | membership, else org-scoped public check | clean |
| `PATCH /messages/{id}` | messaging.py:373-380 | `id=$1 AND org_id=$2` + sender-only | clean |
| `DELETE /messages/{id}` | messaging.py:398-405 | `id=$1 AND org_id=$2` + sender-only | clean |
| `POST /channels/{id}/read` | messaging.py:496-499 | updates only `user_id=$2` own row | clean |
| `GET /unread` | messaging.py:510-522 | `c.org_id=$1 AND cm.user_id=$2` | clean |

---

*(sections 5 and 6 — fixes applied and tests — appended below as work lands)*
