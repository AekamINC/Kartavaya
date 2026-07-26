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

## 5. Before/after role reachability

Exhaustive over every endpoint I own. "Before" is `origin/staging` @ `2a2a27b`.
Rows marked **CHANGED** are the only ones where reachability moved at all.

### 5.1 `backend/approvals_router.py` (prefix `/api`)

| Endpoint | Before | After | Δ |
|---|---|---|---|
| `POST /tasks/{id}/request-approval` | any authenticated user on a team task | unchanged | — |
| `POST /tasks/{id}/approve` | project owner/admin **or** `users.role=='admin'` (legacy column, any user ever flagged admin) | project owner/admin **or** `is_org_admin` (platform roles + `org_owner`/`org_admin` from `staging.user_roles`) | **CHANGED — narrows** |
| `POST /tasks/{id}/reject` | as above | as above | **CHANGED — narrows** |
| `GET /tasks/pending-approval` | `is_org_admin` → own teams; else team_members owner/admin | unchanged | — |
| `POST /tasks/{id}/request-client-approval` | any authenticated user | unchanged | — |
| `POST /tasks/{id}/client-approve` | `task_clients` row **or** `role=='admin'` **read off the JWT** | `task_clients` row **or** `is_org_admin` (live DB read) | **CHANGED — narrows** |
| `POST /tasks/{id}/client-reject` | as above | as above | **CHANGED — narrows** |
| `GET /approvals/by-token/{token}` | public, valid magic-link token | unchanged | — |
| `POST /approvals/by-token/{token}/approve` | public token **+** live `task_clients` re-check | unchanged | — |
| `POST /approvals/by-token/{token}/reject` | as above | unchanged | — |

**On the four CHANGED rows.** The removal is the point, and it is narrowing in
two independent directions:

1. `users.role` is a legacy column that `middleware/roles.py:114-128` documents
   as superseded ("6 role holders rather than every user flagged admin").
2. The two client-approval overrides read `user.get("role")` — **off the JWT**.
   A token minted while its holder was an admin kept the override for the life
   of that token, and a JWT claim cannot be scoped to an org at all.

Who could reach these before but cannot now: a user whose `users.role` column
still says `admin` but who holds no `staging.user_roles` row. That is precisely
the population the role migration exists to retire. Nobody with a current role
grant loses anything. `review_approval` (`server.py:1438`) already used
`is_org_admin`, so this brings the four stragglers onto the path the rest of the
approval surface was already on.

### 5.2 Approvals in `backend/server.py`

| Endpoint | Before | After | Δ |
|---|---|---|---|
| `GET /api/client/approvals` | authenticated; own requests + `task_clients` | unchanged | — |
| `GET /api/approvals/pending` | project owner/admin (`project_assignments` or `team_members`) | unchanged | — |
| `GET /api/approvals/history` | as above | unchanged | — |
| `GET /api/approvals/stats` | as above | unchanged | — |
| `POST /api/approvals/{id}/review` | owner/admin or `is_org_admin` | unchanged | — |
| `POST /api/tasks/{id}/clients/{uid}` | `_require_admin` | unchanged | — |
| `DELETE /api/tasks/{id}/clients/{uid}` | `_require_admin` | unchanged | — |

I changed nothing in `server.py`. Both defects my brief named there were already
fixed (§1).

### 5.3 `backend/routers/activity.py`

The platform bypass previously used `is_platform_staff`, i.e. membership of
`ALL_PLATFORM_ROLES`. Per platform role:

| Platform role | Before | After | Δ |
|---|---|---|---|
| `platform_owner` | bypass; all orgs if no org row | bypass; all orgs | — |
| `platform_admin` (legacy alias) | bypass; all orgs if no org row | bypass; all orgs | — |
| `platform_manager` | bypass; **all orgs** if no org row | bypass; own org only, else empty | **CHANGED — narrows** |
| `platform_staff` | bypass; **all orgs** if no org row | bypass; own org only, else empty | **CHANGED — narrows** |
| `account_manager` | **full bypass** | no bypass — ordinary membership rules | **CHANGED — removes** |
| `account_finance` | **full bypass** | no bypass | **CHANGED — removes** |
| `srijan_admin` | **full bypass** | no bypass | **CHANGED — removes** |
| `platform_support` | **full bypass** | no bypass | **CHANGED — removes** |
| org member / no platform row | team_members / project_assignments only | unchanged | — |

Applies identically to `GET /activity/team/{id}`, `GET /activity/feed` and
`GET /activity/task/{id}`.

**The removals are the explicit point.** `role_tiers.modules_for()` returns
`frozenset()` for all four removed roles — they reach no operational module, and
`platform_support` is documented at `role_tiers.py:40-43` as granting nothing at
all until its approval flow exists. An activity feed is a customer's operational
record. `is_platform_staff`'s own docstring (`roles.py:95-104`) says it means "is
Aekam staff", *not* "may read anything" — the guard was reading it as the latter.

The org narrowing for manager/staff closes the widest read in the file: the
`else` branch selected **every team in every org** (`SELECT team_id FROM teams
WHERE deleted_at IS NULL`) and was reached by the *weakest* roles that got past
the bypass. God mode keeps it, which matches "every module, every org".

### 5.4 `backend/routers/messaging.py`

All 18 endpoints sit behind `require_module("samvada")`. Platform reachability is
unchanged everywhere (governed by `subscription.py`, which I did not touch).
Per-user reachability:

| Endpoint | Before | After | Δ |
|---|---|---|---|
| `GET /channels` | org members; public or joined | unchanged | — |
| `POST /channels` | org members | unchanged | — |
| `PATCH /channels/{id}` | channel admin | unchanged | — |
| `POST /dm` | org member, **any `target_user_id`** | org member, target must hold a role in the caller's org | **CHANGED — narrows** |
| `GET /channels/{id}/members` | org members | unchanged | — |
| `POST /channels/{id}/members` | any channel member, **any `user_id`** | any channel member, target must be in the caller's org | **CHANGED — narrows** |
| `DELETE /channels/{id}/members/{u}` | channel admin, or self | unchanged | — |
| `GET /channels/{id}/messages` | member, or anyone if public | unchanged | — |
| `POST /channels/{id}/messages` | member, or anyone if public (auto-joins) | unchanged | — |
| `PATCH /messages/{id}` | sender only | unchanged | — |
| `DELETE /messages/{id}` | sender only | unchanged | — |
| `GET /messages/{id}/thread` | **any org member** | member of the channel, or anyone if public | **CHANGED — removes** |
| `POST /messages/{id}/reactions` | **any org member** | member of the channel, or anyone if public | **CHANGED — removes** |
| `DELETE /messages/{id}/reactions/{e}` | any org member; deletes own row only | unchanged | — |
| `POST /channels/{id}/read` | own row only | unchanged | — |
| `GET /unread` | own memberships | unchanged | — |

**The two removals are the point.** `GET /messages/{id}/thread` and
`POST /messages/{id}/reactions` checked only that the message was in the
caller's org — never that the caller could see the *channel*. Any colleague
could read the replies under a private channel or a **DM between two other
people** by passing the message id, and react to them. `list_messages` already
enforced the correct rule; the two endpoints simply never got it. They now share
one helper (`_assert_channel_access`) so the three cannot drift apart again.
Public channels stay readable by any org member, as before.

The two DM/member narrowings are cross-tenant **writes**: `user_id` and
`target_user_id` were unvalidated caller-supplied identifiers, so a membership
row could join one org's channel to another org's user. Org filters on every
read meant that user could not actually read anything — but the row shows up in
the member list and member count, and it is the kind of row that becomes a leak
the first time a query forgets its org filter.

`DELETE .../reactions/{emoji}` deliberately left alone: it deletes only the
caller's own row, so gating it could strand a reaction a user wants to remove
after leaving a channel.

---

## 6. Tests

`backend/tests/test_separated_duty.py` — 39 tests, all passing.

**Separated duty** is pinned from both sides, which is the part that matters:

- `admin` does **not** satisfy `approver` in `vetana` and `ganit`
- `admin` **does** satisfy `approver` in all eight `HIERARCHICAL_MODULES`

A blanket `held == required` would pass the first assertion and fail the second,
so the pair actually constrains the rule rather than restating it. Also pinned:
the membership of `SEPARATED_DUTY_MODULES` (adding a money-moving module without
listing it there silently hands its admins approval authority), that the two
module sets are disjoint, and that unknown/None levels never satisfy.

These tests matter *now* precisely because `level_satisfies` has no call sites:
the rule is load-bearing for nothing, so nothing else in the suite would catch
it being flattened into a plain hierarchy before the enforcement lands.

**Cross-tenant** tests supply another org's identifier and assert refusal:
thread and reaction reads on a private channel by a non-member (403), a channel
in another org (404), adding a foreign-org user (404, and `execute` asserted
*not* called), opening a DM with a foreign-org user (404), and a check that the
tenant query hits `staging.user_roles` with the **caller's** org id rather than
one taken from the request.

**Platform reach** tests assert `modules_for()` is empty for all three
`COMMERCIAL_ONLY_ROLES` plus `platform_support`, non-empty for god/manager/staff,
and that `_platform_reach` grants the bypass only to the latter with cross-org
reach only for god mode.

Two existing tests in `test_messaging_security.py` needed their mocks extended
for the added channel hop (`test_thread_replies_returned_for_own_org`,
`test_add_reaction_succeeds_own_org`). Both still assert the same thing — success
for a legitimate caller — with a public channel supplied at the new step.

### Suite and gates

- `python -m pytest` → **304 passed, 1 failed**
- `node scripts/check-tokens.mjs` → 279 declared, 229 referenced, **0 missing**
- `node scripts/check-classes.mjs` → 2096 selectors, **0 missing a rule**

The one failure is `tests/test_ganit.py::test_create_invoice_success`
(`TypeError: 'MagicMock' object is not subscriptable`). **Pre-existing and not
mine** — I confirmed it fails identically on a clean `git stash` of my changes.
Ganit is another agent's file; flagging it rather than fixing it.

Both gate scripts must be run from `frontend/`; from the repo root they print
"src/styles not found" and **still exit 0**, so a root-level invocation looks
like a pass and checks nothing. Worth hardening.

---

## 7. Notification inventory (for the email-template agent)

Every send an approval or activity transition can emit. I did not modify any
template. **No mail was sent while testing** — the whole suite runs against a
`MagicMock` pool with no SMTP path, and `OUTBOUND_MODE` is honoured at the
choke points listed below.

### Kill-switch coverage — verified

| Channel | Choke point | Guarded |
|---|---|---|
| email | `email_service.send_email` → `suppressed("email", ...)` | yes — every template funnels through this one function |
| push (unified) | `services/push_service.py:86` | yes |
| web push | `services/web_push_service.py:58` | yes |
| expo push | `services/expo_push_service.py:17` | yes |

### Approval transitions

| Transition | Source | DB row `type` | Email template | Push |
|---|---|---|---|---|
| Staff requests approval | `approvals_router.py:214` | `request` | `send_approval_request_email` (via `send_approval_notification_email` dispatch) | `send_push` kind `approval_request` |
| Task approved | `approvals_router.py:268` | `approved` | `send_approval_decision_email` (via dispatch) | `send_push` kind `approved` |
| Task rejected | `approvals_router.py:311` | `rejected` | `send_approval_decision_email` (via dispatch) | `send_push` kind `rejected` |
| Client approval requested | `approvals_router.py:383` | — | `send_approval_request_email` **with `approve_token`** (magic link) | — |
| Client approves (in-app) | `approvals_router.py:441-463` | `approved` ×N | `send_team_sync_email` to every project member | web + expo push ×N |
| Client approves (magic link) | `approvals_router.py:551-564` | `approved` ×N | `send_team_sync_email` ×N | web + expo push ×N |
| Client rejects (in-app) | `approvals_router.py:634-639` | `rejected` | decision email to creator **and each assignee** | via `send_push` |
| Client rejects (magic link) | `approvals_router.py:599` | `rejected` | decision email to creator | via `send_push` |
| Approval requested (server path) | `server.py:1210` | — | `send_approval_request_email` | — |
| Sent to client on review | `server.py:1372` | — | `send_approval_request_email` + token | — |
| Task-creation request approved | `server.py:1488` | — | `send_request_approved_email` | — |
| Task approved via review | `server.py:1401` | `approved` | — | via `create_notification(push=True)` |
| Task rejected via review | `server.py:1335` | `rejected` | — | via `create_notification(push=True)` |

**Activity events emit nothing.** `services/activity_logger.py:41` only INSERTs
into `activity_events`. No email, no push, no notification row. The activity
feed is read-only by construction — worth stating so the email agent does not
go looking.

### Two defects for the email agent

**a) The decision email never names the reviewer.**
`send_approval_notification_email` (`email_service.py:1145`) calls
`send_approval_decision_email` with the literal string `"The reviewer"`.
`approvals_router.send_approval_notification` accepts a `requester_name` but has
no parameter for the *approver's* name, so the real one never reaches the
template. The parallel path at `server.py:1486` does it correctly
(`actor_display(user, "")`). Fixing this needs a signature change in
`approvals_router.py` — I left it to the email agent to avoid two agents editing
the same templates and call sites in one run.

**b) The emitted `type` does not match the design's `KINDS` map.**
`design-handover/21-notifications-inbox.md:125-135` enumerates exactly eight
kinds: `assigned · mention · comment · approval · approved · rejected · due ·
support`. The approval-request path writes `type='request'`
(`approvals_router.py:108-117`), which is **not one of the eight**. A row with
`type='request'` matches no entry in `KINDS`, so it renders with no colour, no
icon and no bilingual label, and it will not appear under the Inbox's
"Approvals" tab.

`approved` and `rejected` do match. Only the request kind is wrong.

I did **not** change it: `notifications.type` already holds `request` rows in a
database that staging and production share, so renaming the emitted value splits
live data between two spellings. This needs an owner decision between (i) the
frontend aliasing `request` → `approval` in `KINDS`, which is backwards
compatible and costs nothing, or (ii) a backfill migration. **(i) is my
recommendation.** Either way the design doc and the backend currently disagree,
and the design doc is the one that says a ninth kind must never be added without
its email template and its preference row.

---

## 8. What I did NOT finish

1. **Separated-duty enforcement is not built** (§2). It cannot be until the
   `level` column from `PROPOSED_065`/`066` is applied, and until the conflict
   between RBAC-SPEC's "sensitive modules have no per-member grant row" and the
   Tier-4 level model is settled by the owner. I tested the contract; I did not
   wire it, and no route reads a grant level today.
2. **`middleware/org_resolver.py:31-40`** lets the four no-reach platform roles
   resolve any org via `X-Org-Id` (§3.1). Not fixed — the filename matches my
   `org_*.py` exclusion and it is shared middleware. Recommend a narrower named
   set in `role_tiers.py`.
3. **`middleware/roles.py` hardcodes role strings** — `require_org_role` tests
   `role_code = 'platform_admin'` literally (line 74), which is the exact
   lockout `role_tiers.py:115-121` warns about: it excludes `platform_owner`, so
   it becomes a total lockout on the day the legacy rows are renamed.
   `is_org_admin` (lines 133, 140) embeds the whole platform role list as a SQL
   string literal instead of reading `ALL_PLATFORM_ROLES`. Both should read from
   `role_tiers`. Not fixed: shared middleware, high concurrent-edit risk, and
   `require_org_role` guards other agents' routes.
4. **Frontend caller of `/approvals/stats`** not verified (§1.2).
5. **`test_ganit.py::test_create_invoice_success`** fails on clean staging.
6. **Twelve unmerged frontend commits** stranded on the original worktree
   branch (§0).
7. The **gate scripts exit 0 from the repo root** without checking anything.
