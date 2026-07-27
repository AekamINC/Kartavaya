# Permission-gate & tenant-scoping audit — every backend route

Branch `audit/permission-gates`, cut fresh from `origin/staging` @ `190fa73a`.
Method: AST parse of every `@router.<verb>` / `@app.<verb>` / `@api_router.<verb>`
across `backend/routers/` (40 files) plus `server.py`, `auth_router.py`,
`invite_router.py`, `approvals_router.py`, `health.py`, `outbound.py`.
Dependencies resolved transitively, including router-local gate aliases
(`_gate`, `_hub_gate`, `_require_admin`, `_review_gate`, `_pii_gate`, `_approver`,
`_esign_gate`, `_ganit`, `_ganit_gate`, `_admin`, `_finance`,
`_require_publish_authority`). SQL in every route body mapped back to owning
module by table prefix.

**670 routes enumerated. 0 could not be classified.** Every route appears in the
table in §7. Where a verdict is `REVIEW-PRODUCT` that is a judgement that the
behaviour is deliberate-looking and changing it decides who can do what — not a
failure to classify it.

Tests after my changes: **1475 passed, 122 skipped, 0 failed** — identical to the
stated baseline.

---

## 1. The headline question

> **Is there any route through which one org can read another's data, or one
> module's grant can read another module's data?**

**Yes to both. Both were live on `origin/staging`.**

**Cross-org — one confirmed leak, now fixed.**
`routers/dashboards.py` · `GET /api/dashboards/{dashboard_id}/data`, the
`deadlines` widget. It returned the fifteen nearest upcoming task titles **and
assignee names from every team in every organisation** to any authenticated user.
Two lines make it:

- `dashboards.py:95` — the membership guard reads
  `if _allowed_teams is not None and widget_team and widget_team not in _allowed_teams`.
  The `and widget_team` term means a widget saved **without** a `team_id` skips
  the check entirely.
- `dashboards.py:120` — that same absent `team_id` is then passed as `$1` into
  `AND ($1::text IS NULL OR t.team_id=$1)`, and `NULL IS NULL` disables the team
  filter altogether.

No special privilege is needed — only a saved dashboard widget of type
`deadlines` with no project selected. The sibling `count` and `chart` widgets are
**not** affected: they compare `team_id=$1`, which matches no row when `$1` is
NULL, so they return zero rather than everything. `my_work` is filtered to the
caller's own id. **Only `deadlines` inverts.** Fixed — see §5.

A second, lower-severity cross-org surface remains and is **not** mine to close:
`org_settings` (F4) is a globally-shared table with no tenant column at all.

**Cross-module — one confirmed, plus a latent one.**
`routers/graha.py:1364` · `GET /api/v1/graha/contacts/{contact_id}/timeline` is
gated on `graha` alone (`_g=Depends(_gate)`, `graha.py:1371`) and its `UNION ALL`
selects from `staging.ganit_invoices` at `graha.py:1403` — invoice number,
payment status and amount. `ganit` is a SENSITIVE module, withheld by default and
audited on platform bypass. This is the Dristi bug's exact shape: the route lives
in one module and returns another's data. It is org-scoped correctly, so it is a
module-boundary break, not a tenant one. **Reported, not fixed — closing it
changes who sees invoice lines in the CRM timeline, which is a product call.**

Dristi itself is now clean. Every data-returning route in `dristi.py` carries a
`reachable_modules()` source check (`:177`, `:283`, `:342`, `:412`, `:480`,
`:762`, `:855`, `:988`, `:1101`). The `/pipeline` and `/sales` holes are closed.

---

## 2. Findings

| id | severity | where | status |
|---|---|---|---|
| F0 | **HIGH — cross-org read** | `dashboards.py:95,120` | **FIXED** |
| F1 | **HIGH — systemic** | 210 write routes | reported (product) |
| F2 | MEDIUM — latent | `dristi.py:667,697` | reported |
| F3 | MEDIUM — cross-module | `graha.py:1364,1403` | reported (product) |
| F4 | MEDIUM — cross-org config | `server.py:1295–1324` | reported (needs migration) |
| F5 | **DELIVERY RISK** | `vetana.py:118` vs `module_levels.py:125` | reported |
| F6 | LOW — cross-team write | `fields.py:197` | reported |
| F7 | LOW — fail-open | `services/storage.py:253` | reported |
| F8 | LOW — timing side-channel | `hub_publish.py:806` | **FIXED** |
| F9 | LOW — fail-closed lockout | `server.py:50` | reported |

### F1 — a `viewer` grant can write on 210 of 234 module-gated write routes

This is the largest finding by reach and it is exactly the gap
`middleware/module_levels.py:1–12` describes in its own header.

`require_module()` checks only that a grant **row exists**
(`subscription.py:128–133` — `SELECT 1 FROM staging.org_member_modules …`). It
never reads `.role`. `DEFAULT_GRANT_LEVEL = VIEWER` (`role_tiers.py:344`), so
**every new grant and every invite is created read-only** and then permitted to
write.

Measured across all 234 module-gated `POST`/`PUT`/`PATCH`/`DELETE` routes:

| enforcement | routes |
|---|---|
| Tier-4 level check (`require_level` / `_require_editor` / `_approver`) | **10** |
| org-role or platform-role check only | 14 |
| **nothing beyond "a grant row exists"** | **210** |

The 10 that do it properly: `messaging.py` `:245 :271 :315 :375 :524 :578 :605
:659` via `_require_editor`, and `ganit.py:598` (invoice cancel) and
`ganit.py:1880` (vendor-bill payment) via `_approver`. `messaging.py` is the
reference pattern the brief names, and it is the only router that applies it
broadly.

Worst-affected: `graha.py` 44 write routes / 2 checked, `manav.py` 38 / 1,
`ganit.py` 29 / 2, `prachar.py` 23 / 0, `vikray.py` 9 / 0, `whatsapp.py` 6 / 0.

**Not fixed — this changes who can do what on 210 routes and is a product
decision.** It also cannot be done blind: `editor` is the right rung for most,
but not for everything, and picking per route is the product's call.

### F2 — Dristi scheduled reports skip the source-module check at creation

`dristi.py:745` (`run-now`) and `dristi.py:842` (`exports`) both enforce
`_REPORT_SOURCE_MODULES` via `reachable_modules()` (`:762`, `:855`).
`create_scheduled_report` (`dristi.py:667–694`) and `update_scheduled_report`
(`dristi.py:697–727`, which can change `report_type`) do **not**. A `dristi`-only
grant holder can persist a report of type `hr` or `revenue` with themselves as
recipient.

**Currently latent, not exploitable.** The delivery path does not exist:
`skill_dispatcher.py:45` maps `dristi_scheduled_reports` to
`services.skills.dristi`, and `scheduler.py:157` imports
`services.skills.report_skills` — **neither module exists** (`services/skills/`
holds only `__init__.py`, `action/`, `data/`, `detect/`), and both call sites
swallow the `ImportError`. It becomes live the day someone implements the
dispatcher. The check belongs at creation regardless, because that is the only
point at which a caller is present to check.

### F4 — `org_settings` is global; every org shares one brand kit

`server.py:1291` reads and `:1308` / `:1321` write
`org_settings(key, value)` with **no tenant column in the table at all**. This is
known and unresolved: `migrations/PROPOSED_076_org_id_add_nullable.sql:104`
names it — "named for per-org config, stores bare" — and the corresponding
`ALTER TABLE public.org_settings ADD COLUMN … org_id` at `:113` is **commented
out**.

So one firm's admin sets brand colours and fonts that the other firm sees, and
either can overwrite the other's. Both writes are gated on
`user.get("role") not in ("admin","owner")` — the **legacy `users.role` JWT
claim**, which `tasks_bulk.py:78–82` explicitly documents as superseded by the
RBAC overhaul and still live in any token minted before the flag was revoked.

Closing this needs a migration and a backfill. **Out of scope — the DB is
read-only for me and staging shares the production Supabase project.** Flagging
it because two firms take delivery on one instance on 15 August.

### F5 — Vetana and Ganit resolve "approver" from two different tables, and only one has a fallback

Same concept, two sources:

- **Ganit** — `_approver = require_level("ganit", APPROVER)` (`ganit.py:46`) →
  `module_levels.py:125` reads `staging.org_module_approvers`. If that table is
  absent it falls back to org_owner/org_admin (`module_levels.py:188–192`), so
  nobody is locked out.
- **Vetana** — `_require(levels, _RELEASE_LEVEL)` where `_RELEASE_LEVEL = APPROVER`
  (`vetana.py:118`) → `held_module_levels` → `role_tiers.py:444` reads
  `staging.org_member_modules.role`. **There is no fallback.**

Because `level_satisfies` refuses `admin` at the approver rung for separated-duty
modules (`role_tiers.py:319–322`), and because org_owner/org_admin resolve to
exactly `{admin}` (`role_tiers.py:424–431`), **payroll approval, revert and
disbursement are refused for everyone** unless an explicit `approver` row exists
in `org_member_modules` for `vetana`.

`vetana.py:110–117` says so itself, in capitals: *"DO NOT MERGE THIS BRANCH UNTIL
PROPOSED_071 … HAS RUN … it empties it, and payroll stops company-wide."*
`migrations/PROPOSED_071_vetana_approver_backfill.sql` exists but is still
labelled PROPOSED. This fails **closed**, so it is not a leak — it is a delivery
risk. **I did not query the database to check whether the backfill has run;
somebody must, against the live catalog, before 15 August.**

Note also that `PROPOSED_065` forbids per-member grant rows for `vetana`
entirely, which is in direct tension with Vetana reading its approver grant out
of `org_member_modules`. Ganit's `org_module_approvers` is the design that
resolves this; Vetana has not been moved onto it.

Separately: `vetana.py:788` carries a **stale comment** — "Held at ADMIN until
PROPOSED_071 backfills an approver" — directly above
`_require(levels, _RELEASE_LEVEL)` where `_RELEASE_LEVEL` is `APPROVER`. The code
is correct; the comment describes an earlier state and should go.

**Separated duty is otherwise intact.** I found no place where `admin` has been
made to satisfy `approver` in either module.

### F6 — `fields.py` sets values using an unvalidated `field_id`

`PUT /api/fields/task/{task_id}/values` (`fields.py:197`) checks membership of the
**task's** team (`:200–201`) but never checks that each `fv.field_id` belongs to
that team before the upsert at `:204–207`. A member of Team A who knows a
`field_id` from Team B can write a `field_values` row against it; reading it back
via `GET /task/{task_id}/values` (`:190`) joins `field_definitions` and returns
the other team's field name, type and config. Leaks field *metadata*, not task
data. Fix is a one-line ownership check, but it is a behaviour change on a write
path, so I left it.

### F7 — storage quota check fails open

`services/storage.py:253` — `check_storage_limit` ends `except Exception: return
True`, i.e. a database error grants the upload. It is a quota control, not a
permission or tenancy control, so it cannot leak data; listing it because the
brief asks for every `except` that falls through to a permissive default.

The other five permissive handlers I found are all audit/log writes
(`services/audit.py:40`, `org_modules.py:162`, `task_reminders.py:147`,
`social_publisher.py:79`, `invite_router.py:300`) and correctly do not fail the
request. `module_levels.py:88` returns `False` on probe failure, which routes to
the documented org-role fallback rather than to an open door.

### F9 — `server.py:50` names platform roles as bare strings

`_require_admin = require_platform_role("platform_admin", "account_manager")`.
This is precisely the pattern `role_tiers.py:155–161` was written to end. Two
consequences, both already described there: it **excludes `platform_owner`**, so
it becomes a total lockout of every god-mode account the day the data migration
renames those rows; and it **omits `platform_manager`** while admitting
`account_manager`, the commercial role that `platform_manager` supersedes. It
guards `DELETE /api/teams/{team_id}`, `/purge`, `/restore` and the task-client
grants — destructive project operations. Fails closed today. Should read a named
set from `role_tiers`; `server.py` belongs to another agent this run so I have
left it.

---

## 3. What is correct, and verified

Recording these so the next sweep does not re-litigate them.

- **The public surface is exactly the documented one.** 43 unauthenticated
  routes, every one accounted for: `PUBLIC_PATHS` (login, invite, reset,
  `/approve`, `/sign/:token`), the two `graha` routes the brief names, the OAuth
  callback, and 17 secret-protected cron/dispatch/webhook endpoints. **No
  undocumented unauthenticated route exists.**
- **Shared secrets fail closed.** `utils.secret_matches` (`utils.py:50–52`)
  returns `False` when either side is empty, so an unset env var cannot be
  matched by an omitted parameter — the classic "both empty compare equal" hole
  is explicitly closed. `scheduler.py:26–33`, `reports.py:403`,
  `task_reminders.py:69–76` all use it, and `hub_publish.py` now does too (F8).
- **The WhatsApp webhook fails closed on a missing `META_APP_SECRET`**
  (`whatsapp.py:339–347`) and verifies HMAC-SHA256 before parsing.
- **`tasks_bulk.py` is the model for tenancy** — visible teams intersected with
  the active org (`:222–229`), per-id authorisation inside savepoints, and 404
  rather than 403 on unreachable rows so existence is not disclosed (`:330–333`).
- **Self-scope is implemented properly in all three `SELF_SCOPED_MODULES`.**
  Vetana `:884–890` and `:930–932`, Manav `:335–336`, `:418`, `:654–655`,
  Pahchan attendance `:90–104`. An empty level set is treated as "own row only",
  and `any_level_satisfies(frozenset(), …)` is `False`, so a route that forgets
  to special-case self scope refuses rather than leaks.
- **The `X-Org-Id` header is validated against membership** on every request
  (`org_resolver.py:55–71`), with `platform_support` deliberately excluded from
  cross-org resolution.
- **Legacy `team_id` tenancy is consistently enforced** on the PM surface via
  `_assert_team_member` / `is_project_member` / `get_visible_team_ids`. I checked
  every route in `fields.py`, `activity.py`, `automations.py`, `templates.py`,
  `time_entries.py`, `views.py`, `reports.py` and the `server.py` task/team
  routes; `dashboards.py` was the only one that had a hole, and F6 is the only
  residual gap.
- **`activity.py:82–86`** catches a failed membership lookup and sets
  `access = None`, i.e. denies. Correct direction.

---

## 4. Cross-module reads that are deliberate (52 routes)

`REVIEW-PRODUCT` in the table. Each returns data from a module it does not gate.
Most are inherent to the feature and I am **not** proposing changes:

- **`vetana` → `manav`** (13 routes) — payroll joins `manav_employees` for the
  name and code on a payslip. Inherent; both are HR modules withheld by default.
- **`ganit` → `graha`** (8 routes) — an invoice showing its customer's name.
  Inherent to invoicing.
- **`pahchan` → `manav`** (6), **`prachar` → `graha`** (3),
  **`vikray` → `graha`** (2) — same shape.
- **`documents.py:622`** — `ganit` gate reading `vetana_payslips`. Reads only
  `SUM(tds)`, `SUM(gross)` and a row count for the ITNS-281 challan; the
  docstring at `:636–639` argues explicitly that a period aggregate is a book
  figure and not an identity document. I agree, and note it only because a
  `ganit` grant does touch payroll rows here.
- **`graha.py:1364`** is the exception — see F3. It is the one I would change.

---

## 5. Changes made

Three, all on `audit/permission-gates`, committed. Nothing weakened; no test
altered.

1. **`routers/dashboards.py`** — F0, the cross-org leak. The `deadlines` widget
   now scopes to `_allowed_teams` when the caller is not platform staff and no
   `team_id` is set, via a second bound parameter
   `AND ($2::text[] IS NULL OR t.team_id = ANY($2::text[]))`. Platform staff keep
   the unrestricted view they have everywhere else (`_allowed_teams is None` →
   `$2` stays NULL); an explicit `team_id` still goes through the existing guard.
   A caller with no teams gets an empty list rather than a query with an empty
   array.
2. **`routers/vetana.py`** — added `AND e.org_id = p.org_id` to all seven
   `JOIN staging.manav_employees e ON e.id = p.employee_id` clauses. This is the
   tightening already applied at `vikray.py:648` and `:690`
   (`c.org_id = o.org_id`), applied to the joins that matter most: three of the
   seven select `e.pan`, `e.uan` and `e.bank_details`. Behaviour-neutral while
   referential integrity holds — defence in depth, not a bug fix.
3. **`routers/hub_publish.py:806`** — F8. Replaced `request_secret != expected`
   with `secret_matches(...)`. It was the only dispatch endpoint of the four
   still using a short-circuiting `!=` on a shared secret, which leaks how many
   leading bytes were correct to an endpoint an attacker may call freely. Matches
   `scheduler.py`, `reports.py` and `task_reminders.py` exactly.

I deliberately did **not** touch: F1 (210 routes; changes who can do what), F3
(product), F4 (needs a migration), F5 (needs a DB check I am not permitted to
make), F6 (write-path behaviour change), F9 (`server.py` belongs to another agent
this run).

---

## 6. Coverage and limits

- 670 routes, 0 unclassified.
- 156 `JOIN`s onto `staging.*` omit `org_id` from the `ON` clause. Nearly all are
  FK lookups off an already-org-filtered parent and are safe **while referential
  integrity holds**. I hardened the seven highest-value ones (§5.2) and did not
  touch the other 149 — mass-editing them is a large behaviour-neutral diff with
  a real chance of a typo, and it is defence in depth rather than a fix.
- **I did not query the database.** Read-only was the constraint; every claim
  here is from source. F5 in particular needs a live-catalog check that I could
  not make.
- Frontend was out of scope. `PUBLIC_PATHS` in `frontend/src/lib/api.js` was read
  only as the reference list of intentionally-public routes.
- Route paths are as written in the decorator plus the router prefix. A handful
  of `server.py` routes mount on `api_router` whose prefix I resolved statically.

---

## 7. Every route

`auth` — the dependency that guarantees `require_user`, directly or transitively.
`module gate` — the module code(s) the route's gate demands.
`level check` — any Tier-4 / org-role / platform-role check beyond mere reach.
`org-scoped` — `org_id` (staging tenancy), `team` (legacy membership), `self`
(own-row), `platform` (Aekam console, cross-org by design), `n/a` (public).

| # | router:line | method + path | auth | module gate | level check | org-scoped | verdict |
|---|---|---|---|---|---|---|---|
| 1 | `approvals_router.py:219` | `POST /api/tasks/{task_id}/request-approval` | require_user | — | - | team | OK |
| 2 | `approvals_router.py:273` | `POST /api/tasks/{task_id}/approve` | require_user | — | - | team | OK |
| 3 | `approvals_router.py:322` | `POST /api/tasks/{task_id}/reject` | require_user | — | - | team | OK |
| 4 | `approvals_router.py:364` | `GET /api/tasks/pending-approval` | require_user | — | - | team | OK |
| 5 | `approvals_router.py:404` | `POST /api/tasks/{task_id}/request-client-approval` | require_user | — | - | self | OK |
| 6 | `approvals_router.py:443` | `POST /api/tasks/{task_id}/client-approve` | require_user | — | - | team | OK |
| 7 | `approvals_router.py:524` | `GET /api/approvals/by-token/{token}` | NONE | — | - | n/a | PUBLIC-OK — signed approval token (`/approve`, PUBLIC_PATHS) |
| 8 | `approvals_router.py:552` | `POST /api/approvals/by-token/{token}/approve` | NONE | — | - | team | PUBLIC-OK — signed approval token (`/approve`, PUBLIC_PATHS) |
| 9 | `approvals_router.py:623` | `POST /api/approvals/by-token/{token}/reject` | NONE | — | - | n/a | PUBLIC-OK — signed approval token (`/approve`, PUBLIC_PATHS) |
| 10 | `approvals_router.py:658` | `POST /api/tasks/{task_id}/client-reject` | require_user | — | - | team | OK |
| 11 | `auth_router.py:218` | `GET /api/auth/invite/{token}` | NONE | — | - | org_id | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 12 | `auth_router.py:324` | `POST /api/auth/invite/{token}/decline` | NONE | — | - | n/a | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 13 | `auth_router.py:350` | `POST /api/auth/accept-invite` | NONE | — | - | org_id | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 14 | `auth_router.py:469` | `POST /api/auth/login` | NONE | — | - | org_id | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 15 | `auth_router.py:497` | `POST /api/auth/refresh` | require_user | — | - | org_id | OK |
| 16 | `auth_router.py:548` | `POST /api/auth/logout` | NONE | — | - | n/a | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 17 | `auth_router.py:572` | `POST /api/auth/forgot-password` | NONE | — | - | self | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 18 | `auth_router.py:594` | `POST /api/auth/reset-password` | NONE | — | - | self | PUBLIC-OK — login / invite / reset (PUBLIC_PATHS) |
| 19 | `auth_router.py:616` | `GET /api/auth/me` | require_user | — | - | org_id | OK |
| 20 | `health.py:8` | `GET /api/health` | NONE | — | - | n/a | PUBLIC-OK — liveness probe, no data |
| 21 | `invite_router.py:169` | `GET /api/admin/users` | _require_admin | — | _require_admin | platform | OK |
| 22 | `invite_router.py:179` | `PATCH /api/admin/users/{user_id}` | _require_admin | — | _require_admin | platform | OK |
| 23 | `invite_router.py:216` | `PUT /api/admin/users/{user_id}/role` | _require_admin | — | _require_admin | platform | OK |
| 24 | `invite_router.py:225` | `DELETE /api/admin/users/{user_id}` | _require_admin | — | _require_admin | platform | OK |
| 25 | `invite_router.py:361` | `POST /api/admin/invites` | _require_admin | — | _require_admin | platform | OK |
| 26 | `invite_router.py:427` | `GET /api/admin/invites` | _require_admin | — | _require_admin | platform | OK |
| 27 | `invite_router.py:457` | `POST /api/admin/users/{user_id}/send-reset-link` | _require_admin | — | _require_admin | platform | OK |
| 28 | `invite_router.py:479` | `DELETE /api/admin/invites/{invite_id}` | _require_admin | — | _require_admin | platform | OK |
| 29 | `invite_router.py:493` | `GET /api/admin/teams` | _require_admin | — | _require_admin | platform | OK |
| 30 | `routers/activity.py:61` | `GET /api/activity/team/{team_id}` | require_user | — | - | team | OK |
| 31 | `routers/activity.py:115` | `GET /api/activity/feed` | require_user | — | - | org_id | OK |
| 32 | `routers/activity.py:180` | `GET /api/activity/task/{task_id}` | require_user | — | - | team | OK |
| 33 | `routers/admin_orgs.py:88` | `POST /api/v1/admin/orgs` | require_platform_role | — | plat-role | platform | OK |
| 34 | `routers/admin_orgs.py:200` | `GET /api/v1/admin/orgs` | require_platform_role | — | plat-role | platform | OK |
| 35 | `routers/admin_orgs.py:247` | `GET /api/v1/admin/orgs/platform-analytics` | require_platform_role | — | plat-role | platform | OK |
| 36 | `routers/admin_orgs.py:381` | `GET /api/v1/admin/orgs/cost-summary` | require_platform_role | — | plat-role | platform | OK |
| 37 | `routers/admin_orgs.py:444` | `GET /api/v1/admin/orgs/provider-costs` | require_platform_role | — | plat-role | platform | OK |
| 38 | `routers/admin_orgs.py:496` | `GET /api/v1/admin/orgs/{org_id}` | require_platform_role | — | plat-role | platform | OK |
| 39 | `routers/admin_orgs.py:550` | `PATCH /api/v1/admin/orgs/{org_id}/deactivate` | require_platform_role | — | plat-role | platform | OK |
| 40 | `routers/admin_orgs.py:567` | `PATCH /api/v1/admin/orgs/{org_id}/settings` | require_platform_role | — | plat-role | platform | OK |
| 41 | `routers/admin_orgs.py:690` | `POST /api/v1/admin/orgs/{org_id}/members` | require_platform_role | — | plat-role | platform | OK |
| 42 | `routers/admin_orgs.py:791` | `DELETE /api/v1/admin/orgs/{org_id}/members/{user_id}` | require_platform_role | — | plat-role | platform | OK |
| 43 | `routers/admin_orgs.py:807` | `GET /api/v1/admin/orgs/users/search` | require_platform_role | — | plat-role | platform | OK |
| 44 | `routers/admin_orgs.py:822` | `GET /api/v1/admin/orgs/roles/platform` | require_platform_role | — | plat-role | platform | OK |
| 45 | `routers/admin_orgs.py:838` | `POST /api/v1/admin/orgs/roles/assign` | require_platform_role | — | plat-role | platform | OK |
| 46 | `routers/admin_orgs.py:887` | `DELETE /api/v1/admin/orgs/roles/{role_id}` | require_platform_role | — | plat-role | platform | OK |
| 47 | `routers/admin_orgs.py:947` | `POST /api/v1/admin/orgs/{org_id}/modules/{module_code}` | require_platform_role | — | plat-role | platform | OK |
| 48 | `routers/admin_orgs.py:974` | `DELETE /api/v1/admin/orgs/{org_id}/modules/{module_code}` | require_platform_role | — | plat-role | platform | OK |
| 49 | `routers/admin_orgs.py:1002` | `PUT /api/v1/admin/orgs/{org_id}/members/{target_user_id}/modules` | require_platform_role | — | plat-role | platform | OK |
| 50 | `routers/admin_orgs.py:1036` | `GET /api/v1/admin/orgs/{org_id}/members/{target_user_id}/modules` | require_platform_role | — | plat-role | platform | OK |
| 51 | `routers/admin_orgs.py:1054` | `POST /api/v1/admin/orgs/r2/verify` | require_platform_role | — | plat-role | platform | OK |
| 52 | `routers/admin_orgs.py:1066` | `PUT /api/v1/admin/orgs/{org_id}/r2` | require_platform_role | — | plat-role | platform | OK |
| 53 | `routers/admin_orgs.py:1103` | `GET /api/v1/admin/orgs/{org_id}/storage` | require_platform_role | — | plat-role | platform | OK |
| 54 | `routers/admin_orgs.py:1136` | `GET /api/v1/admin/orgs/{org_id}/cost-breakdown` | require_platform_role | — | plat-role | platform | OK |
| 55 | `routers/admin_orgs.py:1289` | `GET /api/v1/admin/orgs/{org_id}/cost-report-pdf` | require_platform_role | — | plat-role | platform | OK |
| 56 | `routers/admin_orgs.py:1383` | `POST /api/v1/admin/orgs/{org_id}/credits/topup` | require_platform_role | — | plat-role | platform | OK |
| 57 | `routers/admin_orgs.py:1435` | `GET /api/v1/admin/orgs/{org_id}/credits/usage` | require_platform_role | — | plat-role | platform | OK |
| 58 | `routers/automations.py:44` | `GET /api/automations/team/{team_id}` | require_user | — | - | team | OK |
| 59 | `routers/automations.py:64` | `POST /api/automations/` | require_user | — | - | team | OK |
| 60 | `routers/automations.py:109` | `PUT /api/automations/{automation_id}` | require_user | — | - | team | OK |
| 61 | `routers/automations.py:123` | `DELETE /api/automations/{automation_id}` | require_user | — | - | team | OK |
| 62 | `routers/automations.py:131` | `POST /api/automations/{automation_id}/run` | require_user | — | - | team | OK |
| 63 | `routers/dashboards.py:29` | `GET /api/dashboards/` | require_user | — | - | self | OK |
| 64 | `routers/dashboards.py:38` | `POST /api/dashboards/` | require_user | — | - | self | OK |
| 65 | `routers/dashboards.py:48` | `PUT /api/dashboards/{dashboard_id}` | require_user | — | - | self | OK |
| 66 | `routers/dashboards.py:61` | `DELETE /api/dashboards/{dashboard_id}` | require_user | — | - | self | OK |
| 67 | `routers/dashboards.py:67` | `GET /api/dashboards/{dashboard_id}/data` | require_user | — | - | team | **FIXED** cross-org leak (deadlines widget) |
| 68 | `routers/documents.py:158` | `GET /api/v1/documents/quotations/{invoice_id}/pdf` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 69 | `routers/documents.py:250` | `GET /api/v1/documents/contacts/{contact_id}/statement/pdf` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 70 | `routers/documents.py:435` | `POST /api/v1/documents/gst/gstr3b/{period}/pdf` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 71 | `routers/documents.py:622` | `POST /api/v1/documents/tds/challan/{period}/pdf` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads vetana |
| 72 | `routers/documents.py:739` | `POST /api/v1/documents/contracts/{contract_id}/agreement/pdf` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 73 | `routers/documents.py:827` | `POST /api/v1/documents/projects/{board_id}/report/pdf` | require_user | — | - | org_id | OK |
| 74 | `routers/dristi.py:170` | `GET /api/v1/dristi/overview` | require_user | dristi | - | org_id | REVIEW-PRODUCT — also reads ganit/graha/manav/vetana/vikray |
| 75 | `routers/dristi.py:272` | `GET /api/v1/dristi/revenue` | require_user | dristi | - | org_id | REVIEW-PRODUCT — also reads ganit |
| 76 | `routers/dristi.py:330` | `GET /api/v1/dristi/pipeline` | require_user | dristi | - | org_id | REVIEW-PRODUCT — also reads graha |
| 77 | `routers/dristi.py:400` | `GET /api/v1/dristi/hr` | require_user | dristi | - | org_id | REVIEW-PRODUCT — also reads manav/vetana |
| 78 | `routers/dristi.py:468` | `GET /api/v1/dristi/sales` | require_user | dristi | - | org_id | REVIEW-PRODUCT — also reads graha/vikray |
| 79 | `routers/dristi.py:539` | `GET /api/v1/dristi/dashboards` | require_user | dristi | - | org_id | OK |
| 80 | `routers/dristi.py:554` | `POST /api/v1/dristi/dashboards` | require_user | dristi | - | org_id | OK-reach; **no level check** (F1) |
| 81 | `routers/dristi.py:575` | `PATCH /api/v1/dristi/dashboards/{dash_id}` | require_user | dristi | - | org_id | OK-reach; **no level check** (F1) |
| 82 | `routers/dristi.py:609` | `DELETE /api/v1/dristi/dashboards/{dash_id}` | require_user | dristi | - | org_id | OK-reach; **no level check** (F1) |
| 83 | `routers/dristi.py:654` | `GET /api/v1/dristi/scheduled-reports` | require_user | dristi | - | org_id | OK |
| 84 | `routers/dristi.py:667` | `POST /api/v1/dristi/scheduled-reports` | require_user | dristi | - | org_id | **FINDING F2** no source-module check on create |
| 85 | `routers/dristi.py:697` | `PATCH /api/v1/dristi/scheduled-reports/{report_id}` | require_user | dristi | - | org_id | **FINDING F2** report_type mutable, no source check |
| 86 | `routers/dristi.py:730` | `DELETE /api/v1/dristi/scheduled-reports/{report_id}` | require_user | dristi | - | org_id | OK-reach; **no level check** (F1) |
| 87 | `routers/dristi.py:745` | `POST /api/v1/dristi/scheduled-reports/{report_id}/run-now` | require_user | dristi | - | org_id | OK-reach; **no level check** (F1) |
| 88 | `routers/dristi.py:820` | `GET /api/v1/dristi/scheduled-reports/{report_id}/logs` | require_user | dristi | - | org_id | OK |
| 89 | `routers/dristi.py:842` | `GET /api/v1/dristi/exports/{report_type}` | require_user | dristi | - | org_id | OK |
| 90 | `routers/dristi.py:976` | `POST /api/v1/dristi/query` | require_user | dristi | - | org_id | OK-reach; **no level check** (F1) |
| 91 | `routers/dristi.py:1081` | `GET /api/v1/dristi/widget-types` | require_user | dristi | - | org_id | OK |
| 92 | `routers/esign.py:78` | `GET /api/v1/esign/documents` | require_user | esign | - | org_id | OK |
| 93 | `routers/esign.py:103` | `POST /api/v1/esign/documents` | require_user | esign | - | org_id | OK-reach; **no level check** (F1) |
| 94 | `routers/esign.py:145` | `POST /api/v1/esign/documents/{doc_id}/upload` | require_user | esign | - | org_id | OK-reach; **no level check** (F1) |
| 95 | `routers/esign.py:204` | `GET /api/v1/esign/documents/{doc_id}` | require_user | esign | - | org_id | OK |
| 96 | `routers/esign.py:244` | `POST /api/v1/esign/documents/{doc_id}/send` | require_user | esign | - | org_id | OK-reach; **no level check** (F1) |
| 97 | `routers/esign.py:303` | `GET /api/v1/esign/verify/{token}` | NONE | — | - | org_id | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 98 | `routers/esign.py:352` | `POST /api/v1/esign/verify/{token}/otp/send` | NONE | — | - | n/a | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 99 | `routers/esign.py:393` | `POST /api/v1/esign/verify/{token}/otp/verify` | NONE | — | - | n/a | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 100 | `routers/esign.py:451` | `POST /api/v1/esign/verify/{token}/sign` | NONE | — | - | org_id | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 101 | `routers/esign.py:517` | `POST /api/v1/esign/verify/{token}/decline` | NONE | — | - | n/a | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 102 | `routers/esign.py:548` | `POST /api/v1/esign/documents/{doc_id}/cancel` | require_user | esign | - | org_id | OK-reach; **no level check** (F1) |
| 103 | `routers/esign.py:574` | `POST /api/v1/esign/documents/{doc_id}/resend/{signer_id}` | require_user | esign | - | org_id | OK-reach; **no level check** (F1) |
| 104 | `routers/esign.py:614` | `GET /api/v1/esign/documents/{doc_id}/audit` | require_user | esign | - | org_id | OK |
| 105 | `routers/fields.py:98` | `GET /api/fields/team/{team_id}` | require_user | — | - | team | OK |
| 106 | `routers/fields.py:108` | `GET /api/fields/team/{team_id}/values` | require_user | — | - | team | OK |
| 107 | `routers/fields.py:149` | `POST /api/fields/` | require_user | — | - | team | OK |
| 108 | `routers/fields.py:163` | `PUT /api/fields/{field_id}` | require_user | — | - | team | OK |
| 109 | `routers/fields.py:178` | `DELETE /api/fields/{field_id}` | require_user | — | - | team | OK |
| 110 | `routers/fields.py:186` | `GET /api/fields/task/{task_id}/values` | require_user | — | - | team | OK |
| 111 | `routers/fields.py:197` | `PUT /api/fields/task/{task_id}/values` | require_user | — | - | team | **FINDING F6** field_id not team-checked |
| 112 | `routers/ganit.py:281` | `GET /api/v1/ganit/products` | require_user | ganit | - | org_id | OK |
| 113 | `routers/ganit.py:298` | `POST /api/v1/ganit/products` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 114 | `routers/ganit.py:316` | `PATCH /api/v1/ganit/products/{product_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 115 | `routers/ganit.py:346` | `DELETE /api/v1/ganit/products/{product_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 116 | `routers/ganit.py:363` | `GET /api/v1/ganit/invoices` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 117 | `routers/ganit.py:399` | `POST /api/v1/ganit/invoices` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 118 | `routers/ganit.py:449` | `GET /api/v1/ganit/invoices/{invoice_id}` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 119 | `routers/ganit.py:481` | `GET /api/v1/ganit/invoices/{invoice_id}/pdf` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 120 | `routers/ganit.py:598` | `POST /api/v1/ganit/invoices/{invoice_id}/cancel` | require_user | ganit | _approver=level:approver | org_id | OK |
| 121 | `routers/ganit.py:618` | `POST /api/v1/ganit/invoices/{invoice_id}/payments` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 122 | `routers/ganit.py:661` | `GET /api/v1/ganit/stats` | require_user | ganit | - | org_id | OK |
| 123 | `routers/ganit.py:691` | `GET /api/v1/ganit/cash-position` | require_user | ganit | - | org_id | OK |
| 124 | `routers/ganit.py:795` | `PATCH /api/v1/ganit/invoices/{invoice_id}/status` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 125 | `routers/ganit.py:842` | `POST /api/v1/ganit/invoices/{invoice_id}/accept-estimate` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 126 | `routers/ganit.py:870` | `POST /api/v1/ganit/invoices/{invoice_id}/convert-to-invoice` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 127 | `routers/ganit.py:922` | `GET /api/v1/ganit/expenses` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 128 | `routers/ganit.py:970` | `POST /api/v1/ganit/expenses` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 129 | `routers/ganit.py:995` | `PATCH /api/v1/ganit/expenses/{expense_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 130 | `routers/ganit.py:1032` | `DELETE /api/v1/ganit/expenses/{expense_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 131 | `routers/ganit.py:1057` | `GET /api/v1/ganit/expense-categories` | require_user | ganit | - | org_id | OK |
| 132 | `routers/ganit.py:1088` | `POST /api/v1/ganit/expense-categories` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 133 | `routers/ganit.py:1109` | `GET /api/v1/ganit/contracts` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 134 | `routers/ganit.py:1146` | `POST /api/v1/ganit/contracts` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 135 | `routers/ganit.py:1169` | `PATCH /api/v1/ganit/contracts/{contract_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 136 | `routers/ganit.py:1211` | `GET /api/v1/ganit/contracts/{contract_id}` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 137 | `routers/ganit.py:1259` | `POST /api/v1/ganit/contracts/{contract_id}/send-for-signature` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 138 | `routers/ganit.py:1293` | `GET /api/v1/ganit/sign/{token}` | NONE | — | - | org_id | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 139 | `routers/ganit.py:1317` | `POST /api/v1/ganit/sign/{token}/otp` | NONE | — | - | n/a | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 140 | `routers/ganit.py:1330` | `POST /api/v1/ganit/sign/{token}/verify` | NONE | — | - | n/a | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 141 | `routers/ganit.py:1343` | `POST /api/v1/ganit/sign/{token}/submit` | NONE | — | - | n/a | PUBLIC-OK — signer token (`/sign/:token`, PUBLIC_PATHS) |
| 142 | `routers/ganit.py:1356` | `GET /api/v1/ganit/contracts/{contract_id}/signature-status` | require_user | ganit | - | org_id | OK |
| 143 | `routers/ganit.py:1384` | `POST /api/v1/ganit/contracts/{contract_id}/cancel-signature` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 144 | `routers/ganit.py:1397` | `GET /api/v1/ganit/contracts/{contract_id}/audit-trail` | require_user | ganit | - | org_id | OK |
| 145 | `routers/ganit.py:1420` | `GET /api/v1/ganit/recurring` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 146 | `routers/ganit.py:1441` | `POST /api/v1/ganit/recurring` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 147 | `routers/ganit.py:1471` | `POST /api/v1/ganit/recurring/{recurring_id}/generate` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 148 | `routers/ganit.py:1555` | `DELETE /api/v1/ganit/recurring/{recurring_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 149 | `routers/ganit.py:1573` | `GET /api/v1/ganit/expense-stats` | require_user | ganit | - | org_id | OK |
| 150 | `routers/ganit.py:1621` | `POST /api/v1/ganit/invoices/from-deal/{deal_id}` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads graha |
| 151 | `routers/ganit.py:1692` | `GET /api/v1/ganit/vendors` | require_user | ganit | - | org_id | OK |
| 152 | `routers/ganit.py:1710` | `POST /api/v1/ganit/vendors` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 153 | `routers/ganit.py:1727` | `PATCH /api/v1/ganit/vendors/{vendor_id}` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 154 | `routers/ganit.py:1760` | `GET /api/v1/ganit/vendor-bills` | require_user | ganit | - | org_id | OK |
| 155 | `routers/ganit.py:1787` | `GET /api/v1/ganit/payables-summary` | require_user | ganit | - | org_id | OK |
| 156 | `routers/ganit.py:1817` | `GET /api/v1/ganit/vendor-bills/{bill_id}` | require_user | ganit | - | org_id | OK |
| 157 | `routers/ganit.py:1841` | `POST /api/v1/ganit/vendor-bills` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 158 | `routers/ganit.py:1880` | `POST /api/v1/ganit/vendor-bills/{bill_id}/payments` | require_user | ganit | _approver=level:approver | org_id | OK |
| 159 | `routers/ganit.py:1930` | `POST /api/v1/ganit/bank-statements/import` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 160 | `routers/ganit.py:1981` | `GET /api/v1/ganit/bank-statements` | require_user | ganit | - | org_id | OK |
| 161 | `routers/ganit.py:2004` | `POST /api/v1/ganit/bank-statements/{line_id}/match` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 162 | `routers/ganit.py:2035` | `POST /api/v1/ganit/bank-statements/{line_id}/unmatch` | require_user | ganit | - | org_id | OK-reach; **no level check** (F1) |
| 163 | `routers/ganit.py:2054` | `GET /api/v1/ganit/bank-statements/stats` | require_user | ganit | - | org_id | OK |
| 164 | `routers/ganit.py:2084` | `POST /api/v1/ganit/invoices/from-time-entries` | require_user | ganit | - | org_id | REVIEW-PRODUCT — also reads manav |
| 165 | `routers/graha.py:154` | `GET /api/v1/graha/clients` | require_user | graha | - | org_id | OK |
| 166 | `routers/graha.py:172` | `POST /api/v1/graha/clients` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 167 | `routers/graha.py:192` | `GET /api/v1/graha/clients/{client_id}` | require_user | graha | - | org_id | OK |
| 168 | `routers/graha.py:219` | `PATCH /api/v1/graha/clients/{client_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 169 | `routers/graha.py:250` | `DELETE /api/v1/graha/clients/{client_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 170 | `routers/graha.py:268` | `GET /api/v1/graha/contacts` | require_user | graha | - | org_id | OK |
| 171 | `routers/graha.py:313` | `POST /api/v1/graha/contacts` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 172 | `routers/graha.py:351` | `GET /api/v1/graha/contacts/duplicates` | require_user | graha | - | org_id | OK |
| 173 | `routers/graha.py:408` | `GET /api/v1/graha/contacts/merges` | require_user | graha | - | org_id | OK |
| 174 | `routers/graha.py:431` | `POST /api/v1/graha/contacts/merges/{merge_id}/undo` | get_org_id | graha | org-role | org_id | OK |
| 175 | `routers/graha.py:449` | `GET /api/v1/graha/contacts/{contact_id}/duplicates` | require_user | graha | - | org_id | OK |
| 176 | `routers/graha.py:475` | `POST /api/v1/graha/contacts/{contact_id}/merge` | get_org_id | graha | org-role | org_id | OK |
| 177 | `routers/graha.py:507` | `GET /api/v1/graha/contacts/{contact_id}` | require_user | graha | - | org_id | OK |
| 178 | `routers/graha.py:554` | `PATCH /api/v1/graha/contacts/{contact_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 179 | `routers/graha.py:599` | `DELETE /api/v1/graha/contacts/{contact_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 180 | `routers/graha.py:617` | `GET /api/v1/graha/pipelines` | require_user | graha | - | org_id | OK |
| 181 | `routers/graha.py:633` | `POST /api/v1/graha/pipelines` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 182 | `routers/graha.py:655` | `GET /api/v1/graha/deals` | require_user | graha | - | org_id | OK |
| 183 | `routers/graha.py:692` | `POST /api/v1/graha/deals` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 184 | `routers/graha.py:737` | `GET /api/v1/graha/deals/kanban` | require_user | graha | - | org_id | OK |
| 185 | `routers/graha.py:790` | `GET /api/v1/graha/deals/{deal_id}` | require_user | graha | - | org_id | OK |
| 186 | `routers/graha.py:817` | `PATCH /api/v1/graha/deals/{deal_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 187 | `routers/graha.py:882` | `DELETE /api/v1/graha/deals/{deal_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 188 | `routers/graha.py:898` | `GET /api/v1/graha/pipeline-summary` | require_user | graha | - | org_id | OK |
| 189 | `routers/graha.py:922` | `POST /api/v1/graha/activities` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 190 | `routers/graha.py:951` | `GET /api/v1/graha/activities` | require_user | graha | - | org_id | OK |
| 191 | `routers/graha.py:985` | `PATCH /api/v1/graha/activities/{activity_id}/complete` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 192 | `routers/graha.py:1003` | `GET /api/v1/graha/follow-ups` | require_user | graha | - | org_id | OK |
| 193 | `routers/graha.py:1054` | `POST /api/v1/graha/follow-ups` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 194 | `routers/graha.py:1078` | `PATCH /api/v1/graha/follow-ups/{follow_up_id}/complete` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 195 | `routers/graha.py:1094` | `DELETE /api/v1/graha/follow-ups/{follow_up_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 196 | `routers/graha.py:1111` | `GET /api/v1/graha/labels` | require_user | graha | - | org_id | OK |
| 197 | `routers/graha.py:1126` | `POST /api/v1/graha/labels` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 198 | `routers/graha.py:1145` | `DELETE /api/v1/graha/labels/{label_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 199 | `routers/graha.py:1160` | `POST /api/v1/graha/contacts/{contact_id}/labels/{label_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 200 | `routers/graha.py:1193` | `DELETE /api/v1/graha/contacts/{contact_id}/labels/{label_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 201 | `routers/graha.py:1213` | `POST /api/v1/graha/contacts/{contact_id}/convert` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 202 | `routers/graha.py:1243` | `GET /api/v1/graha/today` | require_user | graha | - | org_id | OK |
| 203 | `routers/graha.py:1364` | `GET /api/v1/graha/contacts/{contact_id}/timeline` | require_user | graha | - | org_id | **FINDING F3** graha gate returns ganit_invoices |
| 204 | `routers/graha.py:1427` | `GET /api/v1/graha/contacts/{contact_id}/projects` | require_user | graha | - | org_id | OK |
| 205 | `routers/graha.py:1460` | `POST /api/v1/graha/inbound-leads` | NONE | — | - | org_id | PUBLIC-OK — HMAC / form slug resolves org_id from form row |
| 206 | `routers/graha.py:1580` | `GET /api/v1/graha/inbound-emails` | require_user | graha | - | org_id | OK |
| 207 | `routers/graha.py:1598` | `GET /api/v1/graha/inbound-emails/{email_id}` | require_user | graha | - | org_id | OK |
| 208 | `routers/graha.py:1713` | `POST /api/v1/graha/contacts/{contact_id}/rescore` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 209 | `routers/graha.py:1725` | `POST /api/v1/graha/contacts/rescore-all` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 210 | `routers/graha.py:1745` | `GET /api/v1/graha/scoring-rules` | require_user | graha | - | org_id | OK |
| 211 | `routers/graha.py:1765` | `PATCH /api/v1/graha/scoring-rules/{rule_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 212 | `routers/graha.py:1805` | `GET /api/v1/graha/automations` | require_user | graha | - | org_id | OK |
| 213 | `routers/graha.py:1821` | `POST /api/v1/graha/automations` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 214 | `routers/graha.py:1854` | `PATCH /api/v1/graha/automations/{auto_id}/toggle` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 215 | `routers/graha.py:1872` | `DELETE /api/v1/graha/automations/{auto_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 216 | `routers/graha.py:1889` | `GET /api/v1/graha/automation-logs` | require_user | graha | - | org_id | OK |
| 217 | `routers/graha.py:1999` | `GET /api/v1/graha/reports/pipeline-velocity` | require_user | graha | - | org_id | OK |
| 218 | `routers/graha.py:2019` | `GET /api/v1/graha/reports/conversion` | require_user | graha | - | org_id | OK |
| 219 | `routers/graha.py:2066` | `GET /api/v1/graha/reports/rep-performance` | require_user | graha | - | org_id | OK |
| 220 | `routers/graha.py:2090` | `GET /api/v1/graha/reports/forecast` | require_user | graha | - | org_id | OK |
| 221 | `routers/graha.py:2115` | `GET /api/v1/graha/reports/source-analysis` | require_user | graha | - | org_id | OK |
| 222 | `routers/graha.py:2148` | `GET /api/v1/graha/territories` | require_user | graha | - | org_id | OK |
| 223 | `routers/graha.py:2163` | `POST /api/v1/graha/territories` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 224 | `routers/graha.py:2182` | `PATCH /api/v1/graha/territories/{territory_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 225 | `routers/graha.py:2202` | `DELETE /api/v1/graha/territories/{territory_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 226 | `routers/graha.py:2220` | `POST /api/v1/graha/territories/{territory_id}/assign-next` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 227 | `routers/graha.py:2258` | `GET /api/v1/graha/custom-fields` | require_user | graha | - | org_id | OK |
| 228 | `routers/graha.py:2276` | `POST /api/v1/graha/custom-fields` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 229 | `routers/graha.py:2305` | `DELETE /api/v1/graha/custom-fields/{field_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 230 | `routers/graha.py:2334` | `GET /api/v1/graha/web-forms` | require_user | graha | - | org_id | OK |
| 231 | `routers/graha.py:2350` | `POST /api/v1/graha/web-forms` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 232 | `routers/graha.py:2379` | `DELETE /api/v1/graha/web-forms/{form_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 233 | `routers/graha.py:2397` | `GET /api/v1/graha/web-forms/{form_id}/submissions` | require_user | graha | - | org_id | OK |
| 234 | `routers/graha.py:2416` | `POST /api/v1/graha/f/{slug}` | NONE | — | - | org_id | PUBLIC-OK — HMAC / form slug resolves org_id from form row |
| 235 | `routers/graha.py:2507` | `GET /api/v1/graha/approval-rules` | require_user | graha | - | org_id | OK |
| 236 | `routers/graha.py:2525` | `POST /api/v1/graha/approval-rules` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 237 | `routers/graha.py:2545` | `PATCH /api/v1/graha/approval-rules/{rule_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 238 | `routers/graha.py:2572` | `DELETE /api/v1/graha/approval-rules/{rule_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 239 | `routers/graha.py:2590` | `GET /api/v1/graha/approval-requests` | require_user | graha | - | org_id | OK |
| 240 | `routers/graha.py:2617` | `POST /api/v1/graha/approval-requests/{req_id}/approve` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 241 | `routers/graha.py:2636` | `POST /api/v1/graha/approval-requests/{req_id}/reject` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 242 | `routers/graha.py:2679` | `GET /api/v1/graha/documents` | require_user | graha | - | org_id | OK |
| 243 | `routers/graha.py:2716` | `POST /api/v1/graha/documents` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 244 | `routers/graha.py:2737` | `GET /api/v1/graha/documents/folders` | require_user | graha | - | org_id | OK |
| 245 | `routers/graha.py:2753` | `GET /api/v1/graha/documents/{doc_id}` | require_user | graha | - | org_id | OK |
| 246 | `routers/graha.py:2773` | `PATCH /api/v1/graha/documents/{doc_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 247 | `routers/graha.py:2807` | `DELETE /api/v1/graha/documents/{doc_id}` | require_user | graha | - | org_id | OK-reach; **no level check** (F1) |
| 248 | `routers/hub.py:175` | `GET /api/v1/hub/org-client` | require_user | srijan | - | org_id | OK |
| 249 | `routers/hub.py:234` | `GET /api/v1/hub/clients` | require_user | srijan | - | org_id | OK |
| 250 | `routers/hub.py:251` | `POST /api/v1/hub/clients` | get_org_id | srijan | plat-role | platform | OK |
| 251 | `routers/hub.py:290` | `GET /api/v1/hub/clients/{client_id}` | require_user | srijan | - | org_id | OK |
| 252 | `routers/hub.py:318` | `PATCH /api/v1/hub/clients/{client_id}` | get_org_id | srijan | plat-role | platform | OK |
| 253 | `routers/hub.py:345` | `GET /api/v1/hub/clients/{client_id}/brand` | require_user | srijan | - | org_id | OK |
| 254 | `routers/hub.py:361` | `PUT /api/v1/hub/clients/{client_id}/brand` | get_org_id | srijan | plat-role | platform | OK |
| 255 | `routers/hub.py:395` | `POST /api/v1/hub/clients/{client_id}/generate` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 256 | `routers/hub.py:459` | `GET /api/v1/hub/clients/{client_id}/content` | require_user | srijan | - | org_id | OK |
| 257 | `routers/hub.py:486` | `GET /api/v1/hub/clients/{client_id}/content/{content_id}` | require_user | srijan | - | org_id | OK |
| 258 | `routers/hub.py:506` | `PATCH /api/v1/hub/clients/{client_id}/content/{content_id}/review` | get_org_id | srijan | plat-role | platform | OK |
| 259 | `routers/hub.py:541` | `GET /api/v1/hub/clients/{client_id}/credits` | require_user | srijan | - | org_id | OK |
| 260 | `routers/hub.py:566` | `POST /api/v1/hub/clients/{client_id}/credits/topup` | get_org_id | srijan | plat-role | platform | OK |
| 261 | `routers/hub.py:606` | `GET /api/v1/hub/dashboard` | require_user | srijan | - | org_id | OK |
| 262 | `routers/hub.py:659` | `GET /api/v1/hub/skills/templates` | require_user | srijan | - | **none** | **REVIEW** no visible tenant scope |
| 263 | `routers/hub.py:671` | `GET /api/v1/hub/skills/templates/{template_id}` | require_user | srijan | - | **none** | **REVIEW** no visible tenant scope |
| 264 | `routers/hub.py:687` | `POST /api/v1/hub/skills/templates` | require_platform_role | srijan | plat-role | platform | OK |
| 265 | `routers/hub.py:723` | `DELETE /api/v1/hub/skills/templates/{template_id}` | require_platform_role | srijan | plat-role | platform | OK |
| 266 | `routers/hub.py:739` | `GET /api/v1/hub/clients/{client_id}/skills` | require_user | srijan | - | org_id | OK |
| 267 | `routers/hub.py:760` | `POST /api/v1/hub/clients/{client_id}/skills/{template_id}` | get_org_id | srijan | plat-role | platform | OK |
| 268 | `routers/hub.py:792` | `DELETE /api/v1/hub/clients/{client_id}/skills/{skill_id}` | get_org_id | srijan | plat-role | platform | OK |
| 269 | `routers/hub.py:811` | `POST /api/v1/hub/clients/{client_id}/skills/{skill_id}/run` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 270 | `routers/hub.py:938` | `GET /api/v1/hub/clients/{client_id}/skills/{skill_id}/runs` | require_user | srijan | - | org_id | OK |
| 271 | `routers/hub.py:959` | `GET /api/v1/hub/clients/{client_id}/content/{content_id}/approvals` | require_user | srijan | - | org_id | OK |
| 272 | `routers/hub.py:992` | `GET /api/v1/hub/analytics/spend` | get_org_id | srijan | plat-role | platform | OK |
| 273 | `routers/hub.py:1049` | `GET /api/v1/hub/clients/{client_id}/analytics/spend` | get_org_id | srijan | plat-role | platform | OK |
| 274 | `routers/hub.py:1120` | `POST /api/v1/hub/ai-feedback` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 275 | `routers/hub.py:1144` | `GET /api/v1/hub/ai-feedback` | require_user | srijan | - | org_id | OK |
| 276 | `routers/hub.py:1181` | `GET /api/v1/hub/ai-feedback/stats` | require_user | srijan | - | org_id | OK |
| 277 | `routers/hub.py:1211` | `GET /api/v1/hub/ai-conversations/{context_type}` | require_user | srijan | - | org_id | OK |
| 278 | `routers/hub.py:1229` | `PUT /api/v1/hub/ai-conversations/{context_type}` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 279 | `routers/hub.py:1252` | `DELETE /api/v1/hub/ai-conversations/{context_type}` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 280 | `routers/hub.py:1272` | `GET /api/v1/hub/org/skills` | require_user | srijan | - | org_id | OK |
| 281 | `routers/hub.py:1292` | `POST /api/v1/hub/org/skills/{template_id}` | get_org_id | srijan | plat-role | platform | OK |
| 282 | `routers/hub.py:1322` | `DELETE /api/v1/hub/org/skills/{skill_id}` | get_org_id | srijan | plat-role | platform | OK |
| 283 | `routers/hub.py:1339` | `POST /api/v1/hub/org/skills/{skill_id}/run` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 284 | `routers/hub.py:1485` | `GET /api/v1/hub/org/skills/{skill_id}/runs` | require_user | srijan | - | org_id | OK |
| 285 | `routers/hub.py:1505` | `GET /api/v1/hub/org/credits` | require_user | srijan | plat-role | org_id | OK |
| 286 | `routers/hub.py:1572` | `POST /api/v1/hub/org/credits/topup` | get_org_id | srijan | plat-role | platform | OK |
| 287 | `routers/hub.py:1615` | `POST /api/v1/hub/org/credits/allocate/{target_user_id}` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 288 | `routers/hub.py:1651` | `GET /api/v1/hub/org/credits/users` | require_user | srijan | - | org_id | OK |
| 289 | `routers/hub.py:1672` | `POST /api/v1/hub/org/generate` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 290 | `routers/hub.py:1749` | `GET /api/v1/hub/org/content` | require_user | srijan | - | org_id | OK |
| 291 | `routers/hub.py:1779` | `GET /api/v1/hub/org/brand` | require_user | srijan | - | org_id | OK |
| 292 | `routers/hub.py:1799` | `PUT /api/v1/hub/org/brand` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 293 | `routers/hub.py:1985` | `POST /api/v1/hub/org/quick-generate` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 294 | `routers/hub_chat.py:49` | `GET /api/v1/hub/clients/{client_id}/kb` | require_user | srijan | - | org_id | OK |
| 295 | `routers/hub_chat.py:75` | `POST /api/v1/hub/clients/{client_id}/kb` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 296 | `routers/hub_chat.py:107` | `POST /api/v1/hub/clients/{client_id}/kb/faq` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 297 | `routers/hub_chat.py:136` | `DELETE /api/v1/hub/clients/{client_id}/kb/{doc_id}` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 298 | `routers/hub_chat.py:155` | `GET /api/v1/hub/clients/{client_id}/kb/search` | require_user | srijan | - | org_id | OK |
| 299 | `routers/hub_chat.py:177` | `GET /api/v1/hub/clients/{client_id}/chat/sessions` | require_user | srijan | - | org_id | OK |
| 300 | `routers/hub_chat.py:196` | `POST /api/v1/hub/clients/{client_id}/chat/sessions` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 301 | `routers/hub_chat.py:227` | `GET /api/v1/hub/chat/sessions/{session_id}/messages` | require_user | srijan | - | org_id | OK |
| 302 | `routers/hub_chat.py:252` | `POST /api/v1/hub/chat/sessions/{session_id}/send` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 303 | `routers/hub_chat.py:418` | `DELETE /api/v1/hub/chat/sessions/{session_id}` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 304 | `routers/hub_publish.py:222` | `GET /api/v1/hub/oauth/{platform}/authorize` | require_user | srijan | - | org_id | OK |
| 305 | `routers/hub_publish.py:298` | `GET /api/v1/hub/oauth/{platform}/callback` | NONE | — | - | org_id | PUBLIC-OK — OAuth callback + PUBLISH_DISPATCH_SECRET |
| 306 | `routers/hub_publish.py:497` | `GET /api/v1/hub/clients/{client_id}/social-accounts` | require_user | srijan | - | org_id | OK |
| 307 | `routers/hub_publish.py:518` | `POST /api/v1/hub/clients/{client_id}/social-accounts` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 308 | `routers/hub_publish.py:557` | `DELETE /api/v1/hub/clients/{client_id}/social-accounts/{account_id}` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 309 | `routers/hub_publish.py:581` | `POST /api/v1/hub/clients/{client_id}/publish/schedule` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 310 | `routers/hub_publish.py:626` | `POST /api/v1/hub/clients/{client_id}/publish/bulk-schedule` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 311 | `routers/hub_publish.py:676` | `POST /api/v1/hub/publish/queue/{queue_id}/publish-now` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 312 | `routers/hub_publish.py:698` | `POST /api/v1/hub/publish/queue/{queue_id}/cancel` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 313 | `routers/hub_publish.py:718` | `GET /api/v1/hub/clients/{client_id}/publish/queue` | require_user | srijan | - | org_id | OK |
| 314 | `routers/hub_publish.py:753` | `GET /api/v1/hub/clients/{client_id}/calendar` | require_user | srijan | - | org_id | OK |
| 315 | `routers/hub_publish.py:796` | `POST /api/v1/hub/publish/dispatch` | NONE | — | - | n/a | PUBLIC-OK — **FIXED** now constant-time |
| 316 | `routers/hub_publish.py:820` | `GET /api/v1/hub/clients/{client_id}/platforms` | require_user | srijan | - | org_id | OK |
| 317 | `routers/hub_publish.py:840` | `PUT /api/v1/hub/clients/{client_id}/platforms` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 318 | `routers/manav.py:314` | `GET /api/v1/manav/employees` | require_user | manav | - | org_id | OK |
| 319 | `routers/manav.py:361` | `POST /api/v1/manav/employees` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 320 | `routers/manav.py:395` | `GET /api/v1/manav/employees/{employee_id}` | require_user | manav | - | org_id | OK |
| 321 | `routers/manav.py:434` | `GET /api/v1/manav/employees/{employee_id}/sensitive` | require_user | manav | org-role | org_id | OK |
| 322 | `routers/manav.py:487` | `PATCH /api/v1/manav/employees/{employee_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 323 | `routers/manav.py:524` | `DELETE /api/v1/manav/employees/{employee_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 324 | `routers/manav.py:544` | `GET /api/v1/manav/departments` | require_user | manav | - | org_id | OK |
| 325 | `routers/manav.py:564` | `POST /api/v1/manav/departments` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 326 | `routers/manav.py:581` | `PATCH /api/v1/manav/departments/{dept_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 327 | `routers/manav.py:601` | `DELETE /api/v1/manav/departments/{dept_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 328 | `routers/manav.py:627` | `GET /api/v1/manav/attendance` | require_user | manav | - | org_id | OK |
| 329 | `routers/manav.py:672` | `POST /api/v1/manav/attendance` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 330 | `routers/manav.py:711` | `GET /api/v1/manav/attendance/summary` | require_user | manav | - | org_id | OK |
| 331 | `routers/manav.py:762` | `GET /api/v1/manav/leave-types` | require_user | manav | - | org_id | OK |
| 332 | `routers/manav.py:778` | `POST /api/v1/manav/leave-types` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 333 | `routers/manav.py:800` | `GET /api/v1/manav/leaves` | require_user | manav | - | org_id | OK |
| 334 | `routers/manav.py:846` | `POST /api/v1/manav/leaves` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 335 | `routers/manav.py:898` | `PATCH /api/v1/manav/leaves/{leave_id}/action` | require_user | manav | level_satisfies | org_id | OK |
| 336 | `routers/manav.py:977` | `GET /api/v1/manav/holidays` | require_user | manav | - | org_id | OK |
| 337 | `routers/manav.py:995` | `POST /api/v1/manav/holidays` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 338 | `routers/manav.py:1012` | `DELETE /api/v1/manav/holidays/{holiday_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 339 | `routers/manav.py:1030` | `GET /api/v1/manav/stats` | require_user | manav | - | org_id | OK |
| 340 | `routers/manav.py:1094` | `GET /api/v1/manav/announcements` | require_user | manav | - | org_id | OK |
| 341 | `routers/manav.py:1117` | `POST /api/v1/manav/announcements` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 342 | `routers/manav.py:1154` | `PATCH /api/v1/manav/announcements/{announcement_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 343 | `routers/manav.py:1192` | `DELETE /api/v1/manav/announcements/{announcement_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 344 | `routers/manav.py:1211` | `GET /api/v1/manav/leaves/check-conflicts` | require_user | manav | - | org_id | OK |
| 345 | `routers/manav.py:1269` | `GET /api/v1/manav/performance/summary` | require_user | manav | - | org_id | OK |
| 346 | `routers/manav.py:1333` | `GET /api/v1/manav/shifts` | require_user | manav | - | org_id | OK |
| 347 | `routers/manav.py:1346` | `POST /api/v1/manav/shifts` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 348 | `routers/manav.py:1364` | `PATCH /api/v1/manav/shifts/{shift_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 349 | `routers/manav.py:1402` | `GET /api/v1/manav/schedules` | require_user | manav | - | org_id | OK |
| 350 | `routers/manav.py:1449` | `POST /api/v1/manav/schedules` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 351 | `routers/manav.py:1480` | `POST /api/v1/manav/schedules/bulk` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 352 | `routers/manav.py:1498` | `GET /api/v1/manav/schedules/coverage` | require_user | manav | - | org_id | OK |
| 353 | `routers/manav.py:1535` | `GET /api/v1/manav/availability` | require_user | manav | - | org_id | OK |
| 354 | `routers/manav.py:1577` | `POST /api/v1/manav/availability` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 355 | `routers/manav.py:1609` | `GET /api/v1/manav/shift-bids` | require_user | manav | - | org_id | OK |
| 356 | `routers/manav.py:1630` | `POST /api/v1/manav/shift-bids` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 357 | `routers/manav.py:1644` | `POST /api/v1/manav/shift-bids/{bid_id}/apply` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 358 | `routers/manav.py:1671` | `POST /api/v1/manav/shift-bids/{bid_id}/accept/{employee_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 359 | `routers/manav.py:1706` | `POST /api/v1/manav/swaps` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 360 | `routers/manav.py:1741` | `GET /api/v1/manav/swaps` | require_user | manav | - | org_id | OK |
| 361 | `routers/manav.py:1761` | `PATCH /api/v1/manav/swaps/{swap_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 362 | `routers/manav.py:1811` | `GET /api/v1/manav/expense-claims` | require_user | manav | - | org_id | OK |
| 363 | `routers/manav.py:1842` | `GET /api/v1/manav/expense-claims/pending-count` | require_user | manav | - | org_id | OK |
| 364 | `routers/manav.py:1859` | `POST /api/v1/manav/expense-claims` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 365 | `routers/manav.py:1896` | `PATCH /api/v1/manav/expense-claims/{claim_id}/approve` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 366 | `routers/manav.py:1926` | `PATCH /api/v1/manav/expense-claims/{claim_id}/reject` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 367 | `routers/manav.py:1959` | `GET /api/v1/manav/job-openings` | require_user | manav | - | org_id | OK |
| 368 | `routers/manav.py:1985` | `POST /api/v1/manav/job-openings` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 369 | `routers/manav.py:2002` | `PATCH /api/v1/manav/job-openings/{opening_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 370 | `routers/manav.py:2031` | `GET /api/v1/manav/candidates` | require_user | manav | - | org_id | OK |
| 371 | `routers/manav.py:2062` | `POST /api/v1/manav/candidates` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 372 | `routers/manav.py:2087` | `PATCH /api/v1/manav/candidates/{candidate_id}/stage` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 373 | `routers/manav.py:2111` | `POST /api/v1/manav/candidates/{candidate_id}/hire` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 374 | `routers/manav.py:2172` | `GET /api/v1/manav/assets` | require_user | manav | - | org_id | OK |
| 375 | `routers/manav.py:2202` | `POST /api/v1/manav/assets` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 376 | `routers/manav.py:2229` | `GET /api/v1/manav/assets/{asset_id}` | require_user | manav | - | org_id | OK |
| 377 | `routers/manav.py:2250` | `PATCH /api/v1/manav/assets/{asset_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 378 | `routers/manav.py:2293` | `DELETE /api/v1/manav/assets/{asset_id}` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 379 | `routers/manav.py:2312` | `POST /api/v1/manav/assets/{asset_id}/assign` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 380 | `routers/manav.py:2349` | `POST /api/v1/manav/assets/{asset_id}/return` | require_user | manav | - | org_id | OK-reach; **no level check** (F1) |
| 381 | `routers/manav.py:2382` | `GET /api/v1/manav/employees/{employee_id}/assets` | require_user | manav | - | org_id | OK |
| 382 | `routers/me.py:150` | `GET /api/v1/me/sessions` | require_user | — | - | self | OK |
| 383 | `routers/me.py:248` | `POST /api/v1/me/devices/deregister` | require_user | — | - | self | OK |
| 384 | `routers/me.py:294` | `POST /api/v1/me/export` | require_user | — | - | self | OK |
| 385 | `routers/me.py:370` | `POST /api/v1/me/delete` | require_user | — | - | org_id | OK |
| 386 | `routers/me.py:482` | `DELETE /api/v1/me/delete` | require_user | — | - | self | OK |
| 387 | `routers/me.py:512` | `GET /api/v1/me/requests` | require_user | — | - | self | OK |
| 388 | `routers/messaging.py:130` | `GET /api/v1/messaging/me` | require_user | sanvaad | level_satisfies | org_id | OK |
| 389 | `routers/messaging.py:158` | `GET /api/v1/messaging/directory` | require_user | sanvaad | org-role | org_id | OK |
| 390 | `routers/messaging.py:197` | `GET /api/v1/messaging/channels` | require_user | sanvaad | - | org_id | OK |
| 391 | `routers/messaging.py:245` | `POST /api/v1/messaging/channels` | require_user | sanvaad | _require_editor | org_id | OK |
| 392 | `routers/messaging.py:271` | `PATCH /api/v1/messaging/channels/{channel_id}` | require_user | sanvaad | _require_editor | org_id | OK |
| 393 | `routers/messaging.py:315` | `POST /api/v1/messaging/dm` | require_user | sanvaad | _require_editor | org_id | OK |
| 394 | `routers/messaging.py:351` | `GET /api/v1/messaging/channels/{channel_id}/members` | require_user | sanvaad | - | org_id | OK |
| 395 | `routers/messaging.py:375` | `POST /api/v1/messaging/channels/{channel_id}/members` | require_user | sanvaad | _require_editor | org_id | OK |
| 396 | `routers/messaging.py:409` | `DELETE /api/v1/messaging/channels/{channel_id}/members/{target_user_id}` | require_user | sanvaad | - | org_id | OK-reach; **no level check** (F1) |
| 397 | `routers/messaging.py:442` | `GET /api/v1/messaging/channels/{channel_id}/messages` | require_user | sanvaad | - | org_id | OK |
| 398 | `routers/messaging.py:524` | `POST /api/v1/messaging/channels/{channel_id}/messages` | require_user | sanvaad | _require_editor | org_id | OK |
| 399 | `routers/messaging.py:578` | `PATCH /api/v1/messaging/messages/{message_id}` | require_user | sanvaad | _require_editor | org_id | OK |
| 400 | `routers/messaging.py:605` | `DELETE /api/v1/messaging/messages/{message_id}` | require_user | sanvaad | _require_editor | org_id | OK |
| 401 | `routers/messaging.py:632` | `GET /api/v1/messaging/messages/{message_id}/thread` | require_user | sanvaad | - | org_id | OK |
| 402 | `routers/messaging.py:659` | `POST /api/v1/messaging/messages/{message_id}/reactions` | require_user | sanvaad | _require_editor | org_id | OK |
| 403 | `routers/messaging.py:693` | `DELETE /api/v1/messaging/messages/{message_id}/reactions/{emoji}` | require_user | sanvaad | - | org_id | OK-reach; **no level check** (F1) |
| 404 | `routers/messaging.py:721` | `POST /api/v1/messaging/channels/{channel_id}/read` | require_user | sanvaad | - | org_id | OK-reach; **no level check** (F1) |
| 405 | `routers/messaging.py:736` | `GET /api/v1/messaging/unread` | require_user | sanvaad | - | org_id | OK |
| 406 | `routers/org_invites.py:222` | `POST /api/v1/org/invites` | require_user | — | org-role | org_id | OK |
| 407 | `routers/org_invites.py:298` | `GET /api/v1/org/invites` | get_org_id | — | org-role | org_id | OK |
| 408 | `routers/org_invites.py:330` | `DELETE /api/v1/org/invites/{invite_id}` | get_org_id | — | org-role | org_id | OK |
| 409 | `routers/org_members.py:72` | `GET /api/v1/org/members` | get_org_id | — | org-role | org_id | OK |
| 410 | `routers/org_members.py:112` | `POST /api/v1/org/members` | get_org_id | — | org-role | org_id | OK |
| 411 | `routers/org_members.py:246` | `DELETE /api/v1/org/members/{target_user_id}` | get_org_id | — | org-role | org_id | OK |
| 412 | `routers/org_members.py:287` | `PUT /api/v1/org/members/{target_user_id}/role` | get_org_id | — | org-role | org_id | OK |
| 413 | `routers/org_members.py:311` | `PUT /api/v1/org/members/{target_user_id}/modules` | get_org_id | — | org-role | org_id | OK |
| 414 | `routers/org_members.py:356` | `GET /api/v1/org/members/search` | require_org_role | — | org-role | **none** | **REVIEW** no visible tenant scope |
| 415 | `routers/org_modules.py:197` | `GET /api/v1/org/modules` | get_org_id | — | org-role | org_id | OK |
| 416 | `routers/org_modules.py:294` | `PATCH /api/v1/org/modules` | get_org_id | — | org-role | org_id | OK |
| 417 | `routers/org_profile.py:190` | `GET /api/v1/org/profile` | require_user | — | - | org_id | OK |
| 418 | `routers/org_profile.py:217` | `PATCH /api/v1/org/profile` | get_org_id | — | org-role | org_id | OK |
| 419 | `routers/org_security.py:377` | `GET /api/v1/org/security` | get_org_id | — | org-role | org_id | OK |
| 420 | `routers/org_security.py:432` | `PATCH /api/v1/org/security` | get_org_id | — | org-role | org_id | OK |
| 421 | `routers/pahchan.py:286` | `POST /api/v1/pahchan/punch/photo` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 422 | `routers/pahchan.py:331` | `POST /api/v1/pahchan/punch` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 423 | `routers/pahchan.py:484` | `GET /api/v1/pahchan/me` | require_user | pahchan | - | org_id | OK |
| 424 | `routers/pahchan.py:528` | `GET /api/v1/pahchan/register` | require_user | pahchan | - | org_id | REVIEW-PRODUCT — also reads manav |
| 425 | `routers/pahchan.py:591` | `PATCH /api/v1/pahchan/punches/{punch_id}/review` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 426 | `routers/pahchan.py:626` | `GET /api/v1/pahchan/punches/{punch_id}/photo` | require_user | pahchan | - | org_id | OK |
| 427 | `routers/pahchan.py:670` | `GET /api/v1/pahchan/sites` | require_user | pahchan | - | org_id | OK |
| 428 | `routers/pahchan.py:685` | `POST /api/v1/pahchan/sites` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 429 | `routers/pahchan.py:714` | `GET /api/v1/pahchan/enrollment/{employee_id}` | require_user | pahchan | - | org_id | OK |
| 430 | `routers/pahchan.py:762` | `GET /api/v1/pahchan/enrollment/photos/{photo_id}/url` | require_user | pahchan | - | org_id | OK |
| 431 | `routers/pahchan.py:828` | `POST /api/v1/pahchan/enrollment` | require_user | pahchan | - | org_id | REVIEW-PRODUCT — also reads manav |
| 432 | `routers/pahchan.py:913` | `POST /api/v1/pahchan/enrollment/{photo_id}/approve` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 433 | `routers/pahchan.py:949` | `GET /api/v1/pahchan/enrollment/queue/pending` | require_user | pahchan | - | org_id | REVIEW-PRODUCT — also reads manav |
| 434 | `routers/pahchan.py:990` | `GET /api/v1/pahchan/policy` | require_user | pahchan | - | org_id | OK |
| 435 | `routers/pahchan.py:1000` | `PATCH /api/v1/pahchan/policy` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 436 | `routers/pahchan_attendance.py:74` | `POST /api/v1/pahchan/regularisations` | require_user | pahchan | - | org_id | REVIEW-PRODUCT — also reads manav |
| 437 | `routers/pahchan_attendance.py:121` | `GET /api/v1/pahchan/regularisations` | get_org_id | pahchan | - | org_id | REVIEW-PRODUCT — also reads manav |
| 438 | `routers/pahchan_attendance.py:149` | `PATCH /api/v1/pahchan/regularisations/{reg_id}` | require_user | pahchan | - | org_id | OK-reach; **no level check** (F1) |
| 439 | `routers/pahchan_attendance.py:203` | `POST /api/v1/pahchan/attendance/publish` | require_user | pahchan | - | org_id | REVIEW-PRODUCT — also reads manav |
| 440 | `routers/prachar.py:87` | `GET /api/v1/prachar/templates` | require_user | prachar | - | org_id | OK |
| 441 | `routers/prachar.py:102` | `POST /api/v1/prachar/templates` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 442 | `routers/prachar.py:120` | `GET /api/v1/prachar/templates/{tmpl_id}` | require_user | prachar | - | org_id | OK |
| 443 | `routers/prachar.py:137` | `PATCH /api/v1/prachar/templates/{tmpl_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 444 | `routers/prachar.py:167` | `DELETE /api/v1/prachar/templates/{tmpl_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 445 | `routers/prachar.py:187` | `GET /api/v1/prachar/campaigns` | require_user | prachar | - | org_id | OK |
| 446 | `routers/prachar.py:205` | `POST /api/v1/prachar/campaigns` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 447 | `routers/prachar.py:223` | `GET /api/v1/prachar/campaigns/{camp_id}` | require_user | prachar | - | org_id | OK |
| 448 | `routers/prachar.py:240` | `PATCH /api/v1/prachar/campaigns/{camp_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 449 | `routers/prachar.py:281` | `DELETE /api/v1/prachar/campaigns/{camp_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 450 | `routers/prachar.py:301` | `GET /api/v1/prachar/campaigns/{camp_id}/audience` | require_user | prachar | - | org_id | OK |
| 451 | `routers/prachar.py:320` | `POST /api/v1/prachar/campaigns/{camp_id}/send` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 452 | `routers/prachar.py:434` | `GET /api/v1/prachar/campaigns/{camp_id}/stats` | require_user | prachar | - | org_id | OK |
| 453 | `routers/prachar.py:465` | `GET /api/v1/prachar/automations` | require_user | prachar | - | org_id | OK |
| 454 | `routers/prachar.py:480` | `POST /api/v1/prachar/automations` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 455 | `routers/prachar.py:498` | `PATCH /api/v1/prachar/automations/{auto_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 456 | `routers/prachar.py:530` | `DELETE /api/v1/prachar/automations/{auto_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 457 | `routers/prachar.py:550` | `GET /api/v1/prachar/unsubscribes` | require_user | prachar | - | org_id | OK |
| 458 | `routers/prachar.py:564` | `POST /api/v1/prachar/unsubscribes` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 459 | `routers/prachar.py:581` | `DELETE /api/v1/prachar/unsubscribes/{unsub_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 460 | `routers/prachar.py:600` | `GET /api/v1/prachar/dashboard` | require_user | prachar | - | org_id | OK |
| 461 | `routers/prachar.py:714` | `GET /api/v1/prachar/sequences` | require_user | prachar | - | org_id | OK |
| 462 | `routers/prachar.py:727` | `POST /api/v1/prachar/sequences` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 463 | `routers/prachar.py:739` | `GET /api/v1/prachar/sequences/{seq_id}` | require_user | prachar | - | org_id | REVIEW-PRODUCT — also reads graha |
| 464 | `routers/prachar.py:766` | `PATCH /api/v1/prachar/sequences/{seq_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 465 | `routers/prachar.py:805` | `POST /api/v1/prachar/sequences/{seq_id}/steps` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 466 | `routers/prachar.py:825` | `DELETE /api/v1/prachar/sequences/{seq_id}/steps/{step_order}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 467 | `routers/prachar.py:837` | `POST /api/v1/prachar/sequences/{seq_id}/enroll` | require_user | prachar | - | org_id | REVIEW-PRODUCT — also reads graha |
| 468 | `routers/prachar.py:888` | `POST /api/v1/prachar/sequences/{seq_id}/pause` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 469 | `routers/prachar.py:904` | `GET /api/v1/prachar/sequences/{seq_id}/stats` | require_user | prachar | - | org_id | OK |
| 470 | `routers/prachar.py:970` | `GET /api/v1/prachar/events` | require_user | prachar | - | org_id | OK |
| 471 | `routers/prachar.py:992` | `POST /api/v1/prachar/events` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 472 | `routers/prachar.py:1017` | `GET /api/v1/prachar/events/{event_id}` | require_user | prachar | - | org_id | OK |
| 473 | `routers/prachar.py:1036` | `PATCH /api/v1/prachar/events/{event_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 474 | `routers/prachar.py:1084` | `DELETE /api/v1/prachar/events/{event_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 475 | `routers/prachar.py:1102` | `POST /api/v1/prachar/events/{event_id}/register` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 476 | `routers/prachar.py:1141` | `GET /api/v1/prachar/events/{event_id}/registrations` | require_user | prachar | - | org_id | REVIEW-PRODUCT — also reads graha |
| 477 | `routers/prachar.py:1159` | `PATCH /api/v1/prachar/events/{event_id}/registrations/{reg_id}` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 478 | `routers/prachar_ads.py:37` | `GET /api/v1/prachar/ads/accounts` | require_user | prachar | - | org_id | REVIEW-PRODUCT — also reads srijan |
| 479 | `routers/prachar_ads.py:50` | `POST /api/v1/prachar/ads/accounts/sync` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 480 | `routers/prachar_ads.py:67` | `GET /api/v1/prachar/ads/campaigns` | require_user | prachar | - | org_id | OK |
| 481 | `routers/prachar_ads.py:95` | `GET /api/v1/prachar/ads/insights` | require_user | prachar | - | org_id | OK |
| 482 | `routers/prachar_ads.py:138` | `GET /api/v1/prachar/ads/overview` | require_user | prachar | - | org_id | OK |
| 483 | `routers/prachar_ads.py:170` | `POST /api/v1/prachar/ads/analyse` | require_user | prachar | - | org_id | OK-reach; **no level check** (F1) |
| 484 | `routers/reports.py:274` | `GET /api/reports/data/{team_id}` | require_user | — | - | team | OK |
| 485 | `routers/reports.py:293` | `GET /api/reports/download/{team_id}` | require_user | — | - | team | OK |
| 486 | `routers/reports.py:340` | `GET /api/reports/schedules/{team_id}` | require_user | — | - | team | OK |
| 487 | `routers/reports.py:355` | `POST /api/reports/schedules/{team_id}` | require_user | — | - | team | OK |
| 488 | `routers/reports.py:386` | `DELETE /api/reports/schedules/{schedule_id}` | require_user | — | - | team | OK |
| 489 | `routers/reports.py:403` | `POST /api/reports/dispatch` | NONE | — | - | n/a | PUBLIC-OK — REPORT_DISPATCH_SECRET or platform JWT |
| 490 | `routers/scheduler.py:36` | `POST /api/internal/cron/reminders` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 491 | `routers/scheduler.py:46` | `POST /api/internal/cron/publish` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 492 | `routers/scheduler.py:55` | `POST /api/internal/cron/retention` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 493 | `routers/scheduler.py:66` | `POST /api/internal/cron/pahchan-retention` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 494 | `routers/scheduler.py:94` | `POST /api/internal/cron/invoices` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 495 | `routers/scheduler.py:110` | `POST /api/internal/cron/crm` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 496 | `routers/scheduler.py:126` | `POST /api/internal/cron/hr` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 497 | `routers/scheduler.py:141` | `POST /api/internal/cron/marketing` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 498 | `routers/scheduler.py:157` | `POST /api/internal/cron/reports` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 499 | `routers/scheduler.py:172` | `POST /api/internal/cron/esign` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 500 | `routers/scheduler.py:187` | `POST /api/internal/cron/stock` | NONE | — | - | n/a | PUBLIC-OK — verified |
| 501 | `routers/scheduler.py:202` | `POST /api/internal/cron/agents` | NONE | — | - | org_id | PUBLIC-OK — verified |
| 502 | `routers/scheduler.py:226` | `POST /api/internal/cron/skills` | NONE | — | - | org_id | PUBLIC-OK — verified |
| 503 | `routers/scrapers.py:81` | `GET /api/v1/scrapers/catalog` | require_user | srijan | - | **none** | **REVIEW** no visible tenant scope |
| 504 | `routers/scrapers.py:110` | `POST /api/v1/scrapers/run` | require_user | srijan | - | org_id | OK-reach; **no level check** (F1) |
| 505 | `routers/scrapers.py:363` | `GET /api/v1/scrapers/runs/{run_id}` | require_user | srijan | plat-role | org_id | OK |
| 506 | `routers/scrapers.py:467` | `POST /api/v1/scrapers/runs/{run_id}/import-to-graha` | require_user | srijan | - | org_id | REVIEW-PRODUCT — also reads graha |
| 507 | `routers/scrapers.py:548` | `GET /api/v1/scrapers/runs` | require_user | srijan | - | org_id | OK |
| 508 | `routers/scrapers.py:586` | `GET /api/v1/scrapers/admin/usage` | require_user | — | - | org_id | OK |
| 509 | `routers/scrapers.py:607` | `GET /api/v1/scrapers/admin/runs` | require_user | — | - | org_id | OK |
| 510 | `routers/search.py:481` | `GET /api/search` | require_user | — | - | org_id | OK |
| 511 | `routers/subscription.py:59` | `GET /api/v1/subscription/plans` | require_user | — | - | platform | OK |
| 512 | `routers/subscription.py:95` | `GET /api/v1/subscription/current` | require_user | — | - | platform | OK |
| 513 | `routers/subscription.py:140` | `POST /api/v1/subscription/admin/set-plan` | get_org_id | — | plat-role | platform | OK |
| 514 | `routers/subscription.py:204` | `POST /api/v1/subscription/modules/activate` | get_org_id | — | plat-role | platform | OK |
| 515 | `routers/subscription.py:279` | `POST /api/v1/subscription/modules/deactivate` | get_org_id | — | plat-role | platform | OK |
| 516 | `routers/subscription.py:321` | `POST /api/v1/subscription/admin/invoices` | get_org_id | — | plat-role | platform | OK |
| 517 | `routers/subscription.py:361` | `PATCH /api/v1/subscription/admin/invoices/{invoice_id}/record-payment` | require_platform_role | — | plat-role | platform | OK |
| 518 | `routers/subscription.py:397` | `GET /api/v1/subscription/admin/invoices/overdue` | require_platform_role | — | plat-role | platform | OK |
| 519 | `routers/subscription.py:412` | `GET /api/v1/subscription/invoices` | get_org_id | — | org-role | platform | OK |
| 520 | `routers/subscription.py:437` | `GET /api/v1/subscription/usage` | require_user | — | - | platform | OK |
| 521 | `routers/subscription.py:472` | `GET /api/v1/subscription/cost-report` | get_org_id | — | org-role | platform | OK |
| 522 | `routers/subscription.py:551` | `GET /api/v1/subscription/cost-report/pdf` | get_org_id | — | org-role | platform | OK |
| 523 | `routers/subscription.py:650` | `GET /api/v1/subscription/my-roles` | require_user | — | - | platform | OK |
| 524 | `routers/task_reminders.py:47` | `POST /api/task-reminders/dispatch` | NONE | — | _require_admin | self | PUBLIC-OK — TASK_REMINDER_DISPATCH_SECRET |
| 525 | `routers/tasks_bulk.py:273` | `PATCH /api/v1/tasks/bulk` | require_user | — | - | org_id | OK |
| 526 | `routers/tasks_bulk.py:383` | `DELETE /api/v1/tasks/bulk` | require_user | — | - | org_id | OK |
| 527 | `routers/templates.py:69` | `GET /api/templates/projects` | require_user | — | - | self | OK |
| 528 | `routers/templates.py:81` | `POST /api/templates/projects` | require_user | — | - | self | OK |
| 529 | `routers/templates.py:92` | `DELETE /api/templates/projects/{template_id}` | require_user | — | - | self | OK |
| 530 | `routers/templates.py:103` | `POST /api/templates/projects/{template_id}/apply` | require_user | — | - | team | OK |
| 531 | `routers/templates.py:151` | `GET /api/templates/tasks` | require_user | — | - | team | OK |
| 532 | `routers/templates.py:180` | `GET /api/templates/tasks/{template_id}` | require_user | — | - | team | OK |
| 533 | `routers/templates.py:190` | `POST /api/templates/tasks` | require_user | — | - | team | OK |
| 534 | `routers/templates.py:209` | `PATCH /api/templates/tasks/{template_id}` | require_user | — | - | team | OK |
| 535 | `routers/templates.py:228` | `POST /api/templates/tasks/{template_id}/set-default` | require_user | — | - | team | OK |
| 536 | `routers/templates.py:248` | `DELETE /api/templates/tasks/{template_id}` | require_user | — | - | team | OK |
| 537 | `routers/time_entries.py:57` | `GET /api/time/task/{task_id}` | require_user | — | - | team | OK |
| 538 | `routers/time_entries.py:76` | `POST /api/time/start` | require_user | — | - | team | OK |
| 539 | `routers/time_entries.py:105` | `POST /api/time/stop` | require_user | — | - | self | OK |
| 540 | `routers/time_entries.py:129` | `POST /api/time/manual` | require_user | — | - | team | OK |
| 541 | `routers/time_entries.py:154` | `DELETE /api/time/{entry_id}` | require_user | — | - | self | OK |
| 542 | `routers/time_entries.py:162` | `GET /api/time/report` | require_user | — | - | team | OK |
| 543 | `routers/uploads.py:88` | `POST /api/upload` | require_user | — | - | org_id | OK |
| 544 | `routers/vetana.py:235` | `GET /api/v1/vetana/salary-structures` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 545 | `routers/vetana.py:272` | `POST /api/v1/vetana/salary-structures` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 546 | `routers/vetana.py:307` | `GET /api/v1/vetana/salary-structures/{sid}` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 547 | `routers/vetana.py:334` | `PATCH /api/v1/vetana/salary-structures/{sid}` | require_user | vetana | - | org_id | OK-reach; **no level check** (F1) |
| 548 | `routers/vetana.py:369` | `DELETE /api/v1/vetana/salary-structures/{sid}` | require_user | vetana | - | org_id | OK-reach; **no level check** (F1) |
| 549 | `routers/vetana.py:436` | `POST /api/v1/vetana/payroll/process` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 550 | `routers/vetana.py:726` | `GET /api/v1/vetana/payroll/runs` | require_user | vetana | - | org_id | OK |
| 551 | `routers/vetana.py:747` | `GET /api/v1/vetana/payroll/runs/{run_id}` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 552 | `routers/vetana.py:776` | `PATCH /api/v1/vetana/payroll/runs/{run_id}/approve` | require_user | vetana | level_satisfies | org_id | REVIEW-PRODUCT — also reads manav |
| 553 | `routers/vetana.py:833` | `PATCH /api/v1/vetana/payroll/runs/{run_id}/revert` | require_user | vetana | - | org_id | OK-reach; **no level check** (F1) |
| 554 | `routers/vetana.py:863` | `GET /api/v1/vetana/payslips` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 555 | `routers/vetana.py:903` | `GET /api/v1/vetana/payslips/{payslip_id}` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 556 | `routers/vetana.py:936` | `PATCH /api/v1/vetana/payslips/{payslip_id}/disburse` | require_user | vetana | - | org_id | OK-reach; **no level check** (F1) |
| 557 | `routers/vetana.py:974` | `GET /api/v1/vetana/payslips/{payslip_id}/pdf` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 558 | `routers/vetana.py:1131` | `GET /api/v1/vetana/dashboard` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 559 | `routers/vetana.py:1180` | `GET /api/v1/vetana/statutory-summary` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 560 | `routers/vetana.py:1226` | `GET /api/v1/vetana/loans` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 561 | `routers/vetana.py:1264` | `POST /api/v1/vetana/loans` | require_user | vetana | - | org_id | REVIEW-PRODUCT — also reads manav |
| 562 | `routers/vetana.py:1308` | `PATCH /api/v1/vetana/loans/{loan_id}` | require_user | vetana | - | org_id | OK-reach; **no level check** (F1) |
| 563 | `routers/views.py:45` | `GET /api/views/team/{team_id}` | require_user | — | - | team | OK |
| 564 | `routers/views.py:55` | `POST /api/views/` | require_user | — | - | team | OK |
| 565 | `routers/views.py:70` | `PUT /api/views/{view_id}` | require_user | — | - | team | OK |
| 566 | `routers/views.py:88` | `DELETE /api/views/{view_id}` | require_user | — | - | team | OK |
| 567 | `routers/vikray.py:153` | `GET /api/v1/vikray/orders` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 568 | `routers/vikray.py:180` | `POST /api/v1/vikray/orders` | require_user | vikray | - | org_id | OK-reach; **no level check** (F1) |
| 569 | `routers/vikray.py:208` | `GET /api/v1/vikray/orders/{order_id}` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 570 | `routers/vikray.py:229` | `PATCH /api/v1/vikray/orders/{order_id}` | require_user | vikray | - | org_id | OK-reach; **no level check** (F1) |
| 571 | `routers/vikray.py:304` | `PATCH /api/v1/vikray/orders/{order_id}/status` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 572 | `routers/vikray.py:340` | `POST /api/v1/vikray/orders/{order_id}/invoice` | require_user | ganit/vikray | - | org_id | OK-reach; **no level check** (F1) |
| 573 | `routers/vikray.py:381` | `DELETE /api/v1/vikray/orders/{order_id}` | require_user | vikray | - | org_id | OK-reach; **no level check** (F1) |
| 574 | `routers/vikray.py:409` | `POST /api/v1/vikray/targets` | require_user | vikray | - | org_id | OK-reach; **no level check** (F1) |
| 575 | `routers/vikray.py:432` | `GET /api/v1/vikray/targets` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 576 | `routers/vikray.py:460` | `GET /api/v1/vikray/targets/leaderboard` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 577 | `routers/vikray.py:492` | `PATCH /api/v1/vikray/targets/{target_id}` | require_user | vikray | - | org_id | OK-reach; **no level check** (F1) |
| 578 | `routers/vikray.py:524` | `DELETE /api/v1/vikray/targets/{target_id}` | require_user | vikray | - | org_id | OK-reach; **no level check** (F1) |
| 579 | `routers/vikray.py:543` | `GET /api/v1/vikray/dashboard` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads ganit/graha |
| 580 | `routers/vikray.py:611` | `GET /api/v1/vikray/pipeline` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 581 | `routers/vikray.py:672` | `GET /api/v1/vikray/customers` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads graha |
| 582 | `routers/vikray.py:707` | `GET /api/v1/vikray/stock` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads ganit |
| 583 | `routers/vikray.py:730` | `PATCH /api/v1/vikray/stock/{product_id}` | require_user | vikray | - | org_id | REVIEW-PRODUCT — also reads ganit |
| 584 | `routers/vikray.py:771` | `GET /api/v1/vikray/stock/{product_id}/moves` | require_user | vikray | - | org_id | OK |
| 585 | `routers/whatsapp.py:68` | `GET /api/v1/whatsapp/accounts` | require_user | varta | - | org_id | OK |
| 586 | `routers/whatsapp.py:84` | `POST /api/v1/whatsapp/accounts` | require_user | varta | - | org_id | OK-reach; **no level check** (F1) |
| 587 | `routers/whatsapp.py:105` | `GET /api/v1/whatsapp/conversations` | require_user | varta | - | org_id | OK |
| 588 | `routers/whatsapp.py:135` | `GET /api/v1/whatsapp/conversations/{conv_id}/messages` | require_user | varta | - | org_id | OK |
| 589 | `routers/whatsapp.py:168` | `POST /api/v1/whatsapp/conversations/{conv_id}/messages` | require_user | varta | - | org_id | OK-reach; **no level check** (F1) |
| 590 | `routers/whatsapp.py:202` | `GET /api/v1/whatsapp/templates` | require_user | varta | - | org_id | OK |
| 591 | `routers/whatsapp.py:216` | `POST /api/v1/whatsapp/templates` | require_user | varta | - | org_id | OK-reach; **no level check** (F1) |
| 592 | `routers/whatsapp.py:235` | `DELETE /api/v1/whatsapp/templates/{template_id}` | require_user | varta | - | org_id | OK-reach; **no level check** (F1) |
| 593 | `routers/whatsapp.py:252` | `GET /api/v1/whatsapp/auto-replies` | require_user | varta | - | org_id | OK |
| 594 | `routers/whatsapp.py:266` | `POST /api/v1/whatsapp/auto-replies` | require_user | varta | - | org_id | OK-reach; **no level check** (F1) |
| 595 | `routers/whatsapp.py:284` | `DELETE /api/v1/whatsapp/auto-replies/{rule_id}` | require_user | varta | - | org_id | OK-reach; **no level check** (F1) |
| 596 | `routers/whatsapp.py:301` | `GET /api/v1/whatsapp/webhook` | NONE | — | - | n/a | PUBLIC-OK — Meta verify token / HMAC-SHA256 signature |
| 597 | `routers/whatsapp.py:322` | `POST /api/v1/whatsapp/webhook` | NONE | — | - | org_id | PUBLIC-OK — Meta verify token / HMAC-SHA256 signature |
| 598 | `server.py:845` | `GET /api/` | NONE | — | - | n/a | PUBLIC-OK — static, no tenant data |
| 599 | `server.py:872` | `POST /api/me/push_tokens` | require_user | — | - | self | OK |
| 600 | `server.py:887` | `DELETE /api/me/push_tokens/{device_id}` | require_user | — | - | self | OK |
| 601 | `server.py:909` | `GET /api/me/notification_prefs` | require_user | — | - | self | OK |
| 602 | `server.py:943` | `PUT /api/me/notification_prefs` | require_user | — | - | self | OK |
| 603 | `server.py:998` | `GET /api/projects/{team_id}/columns` | require_user | — | - | team | OK |
| 604 | `server.py:1007` | `POST /api/projects/{team_id}/columns` | require_user | — | - | team | OK |
| 605 | `server.py:1018` | `PUT /api/projects/{team_id}/columns/{column_id}` | require_user | — | - | team | OK |
| 606 | `server.py:1034` | `DELETE /api/projects/{team_id}/columns/{column_id}` | require_user | — | - | team | OK |
| 607 | `server.py:1046` | `POST /api/projects/{team_id}/columns/reorder` | require_user | — | - | team | OK |
| 608 | `server.py:1129` | `GET /api/client/tasks` | require_user | — | - | team | OK |
| 609 | `server.py:1173` | `GET /api/client/projects` | require_user | — | - | org_id | OK |
| 610 | `server.py:1200` | `GET /api/client/approvals` | require_user | — | - | team | OK |
| 611 | `server.py:1276` | `POST /api/tasks/{task_id}/clients/{target_user_id}` | _require_admin | — | _require_admin | self | OK |
| 612 | `server.py:1282` | `DELETE /api/tasks/{task_id}/clients/{target_user_id}` | _require_admin | — | _require_admin | **none** | **REVIEW** no visible tenant scope |
| 613 | `server.py:1295` | `GET /api/settings` | require_user | — | - | **none** | **FINDING F4** org_settings is global (no org_id) |
| 614 | `server.py:1300` | `PUT /api/settings` | require_user | — | - | **none** | **FINDING F4** global write, legacy JWT role claim |
| 615 | `server.py:1315` | `PUT /api/settings/brand-colors` | require_user | — | - | **none** | **FINDING F4** global write, legacy JWT role claim |
| 616 | `server.py:1327` | `POST /api/client/tasks/request` | require_user | — | - | team | OK |
| 617 | `server.py:1419` | `GET /api/approvals/pending` | require_user | — | - | team | OK |
| 618 | `server.py:1457` | `GET /api/approvals/history` | require_user | — | - | team | OK |
| 619 | `server.py:1484` | `GET /api/approvals/stats` | require_user | — | - | team | OK |
| 620 | `server.py:1601` | `POST /api/approvals/{approval_id}/review` | require_user | — | - | **none** | **REVIEW** no visible tenant scope |
| 621 | `server.py:1710` | `GET /api/tasks/{task_id}/comments` | require_user | — | - | team | OK |
| 622 | `server.py:1740` | `POST /api/tasks/{task_id}/comments` | require_user | — | - | team | OK |
| 623 | `server.py:1797` | `PUT /api/tasks/{task_id}/comments/{comment_id}` | require_user | — | - | self | OK |
| 624 | `server.py:1815` | `DELETE /api/tasks/{task_id}/comments/{comment_id}` | require_user | — | - | self | OK |
| 625 | `server.py:1829` | `POST /api/tasks/{task_id}/subtasks` | require_user | — | - | team | OK |
| 626 | `server.py:1846` | `PATCH /api/tasks/{task_id}/subtasks/{subtask_id}` | require_user | — | - | team | OK |
| 627 | `server.py:1859` | `DELETE /api/tasks/{task_id}/subtasks/{subtask_id}` | require_user | — | - | team | OK |
| 628 | `server.py:1881` | `PUT /api/tasks/{task_id}/subtasks/{subtask_id}` | require_user | — | - | team | OK |
| 629 | `server.py:1905` | `GET /api/teams` | require_user | — | - | team | OK |
| 630 | `server.py:1922` | `GET /api/teams/bin` | _require_admin | — | _require_admin | **none** | **REVIEW** no visible tenant scope |
| 631 | `server.py:1958` | `POST /api/teams` | require_user | — | - | team | OK |
| 632 | `server.py:1970` | `PATCH /api/teams/{team_id}/brand` | require_user | — | - | team | OK |
| 633 | `server.py:1981` | `GET /api/users` | require_user | — | - | org_id | OK |
| 634 | `server.py:2021` | `GET /api/teams/{team_id}` | require_user | — | - | team | OK |
| 635 | `server.py:2038` | `GET /api/teams/{team_id}/clients` | require_user | — | - | team | OK |
| 636 | `server.py:2053` | `GET /api/teams/{team_id}/members` | require_user | — | - | team | OK |
| 637 | `server.py:2067` | `POST /api/teams/{team_id}/members` | require_user | — | - | team | OK |
| 638 | `server.py:2083` | `PUT /api/teams/{team_id}/members/{member_id}` | require_user | — | - | team | OK |
| 639 | `server.py:2100` | `DELETE /api/teams/{team_id}` | _require_admin | — | _require_admin | self | OK |
| 640 | `server.py:2111` | `POST /api/teams/{team_id}/restore` | _require_admin | — | _require_admin | **none** | **REVIEW** no visible tenant scope |
| 641 | `server.py:2122` | `DELETE /api/teams/{team_id}/purge` | _require_admin | — | _require_admin | team | OK |
| 642 | `server.py:2140` | `PATCH /api/teams/{team_id}/color` | require_user | — | - | team | OK |
| 643 | `server.py:2151` | `DELETE /api/teams/{team_id}/members/{member_id}` | require_user | — | - | team | OK |
| 644 | `server.py:2163` | `GET /api/categories` | require_user | — | - | self | OK |
| 645 | `server.py:2168` | `POST /api/categories` | require_user | — | - | self | OK |
| 646 | `server.py:2174` | `DELETE /api/categories/{category_id}` | require_user | — | - | self | OK |
| 647 | `server.py:2183` | `GET /api/tasks` | require_user | — | - | team | OK |
| 648 | `server.py:2260` | `POST /api/tasks/auto-archive` | require_user | — | - | team | OK |
| 649 | `server.py:2281` | `PATCH /api/tasks/{task_id}/archive` | require_user | — | - | team | OK |
| 650 | `server.py:2295` | `PATCH /api/tasks/{task_id}/unarchive` | require_user | — | - | team | OK |
| 651 | `server.py:2309` | `POST /api/tasks` | require_user | — | - | team | OK |
| 652 | `server.py:2491` | `GET /api/tasks/{task_id}` | require_user | — | - | team | OK |
| 653 | `server.py:2518` | `PUT /api/tasks/{task_id}/reminders` | require_user | — | - | team | OK |
| 654 | `server.py:2532` | `PUT /api/tasks/{task_id}` | require_user | — | - | team | OK |
| 655 | `server.py:2675` | `PATCH /api/tasks/{task_id}` | require_user | — | - | team | OK |
| 656 | `server.py:2681` | `POST /api/tasks/{task_id}/attachments` | require_user | — | - | team | OK |
| 657 | `server.py:2755` | `DELETE /api/tasks/{task_id}/attachments/{key:path}` | require_user | — | - | team | OK |
| 658 | `server.py:2780` | `POST /api/admin/migrate-data-uris` | require_user | — | - | **none** | **REVIEW** no visible tenant scope |
| 659 | `server.py:2829` | `DELETE /api/tasks/{task_id}` | require_user | — | - | team | OK |
| 660 | `server.py:2848` | `PATCH /api/tasks/{task_id}/toggle` | require_user | — | - | team | OK |
| 661 | `server.py:2859` | `PATCH /api/tasks/{task_id}/move` | require_user | — | - | team | OK |
| 662 | `server.py:2898` | `GET /api/notifications` | require_user | — | - | self | OK |
| 663 | `server.py:2944` | `POST /api/notifications/mark-read` | require_user | — | - | self | OK |
| 664 | `server.py:2951` | `POST /api/notifications/process` | require_user | — | - | team | OK |
| 665 | `server.py:2964` | `GET /api/dashboard/summary` | require_user | — | - | team | OK |
| 666 | `server.py:2980` | `GET /api/notifications/poll` | require_user | — | - | team | OK |
| 667 | `server.py:3039` | `GET /api/push/vapid-public-key` | require_user | — | - | **none** | **REVIEW** no visible tenant scope |
| 668 | `server.py:3043` | `POST /api/push/subscribe` | require_user | — | - | self | OK |
| 669 | `server.py:3050` | `POST /api/push/unsubscribe` | require_user | — | - | self | OK |
| 670 | `server.py:3131` | `GET /api/verse-of-the-day` | NONE | — | - | n/a | PUBLIC-OK — static, no tenant data |