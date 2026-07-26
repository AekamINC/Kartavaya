# Multi-Tenancy Audit & `org_id` Cutover Plan

**Branch:** `audit/tenancy-org-id-cutover`
**Scope:** whole-schema tenancy audit, join-path enforcement audit, RLS posture, phased `org_id` backfill plan, `public.team_members` retirement, spend-gate interaction.
**Method:** live schema read via `pg_catalog` on Supabase project `toacecaewujfxjfrjwco` (read-only `SELECT` only — no writes, no DDL, no migrations), cross-checked against backend source. Backend SQL was extracted by an AST walk over all 37k lines of `backend/**.py` — 1,674 statements — not by eyeballing.

> **Migration files were not trusted as evidence.** They diverge from live materially — see F-3. Every schema claim below was re-read from `pg_catalog`.

---

## THE FINDING THAT CHANGES EVERY OTHER FINDING

**Tenancy in this system is enforced by application code alone. There is no database-level backstop of any kind, in either schema.**

- All 41 `public` tables have RLS **enabled** and **zero policies**. Not weak policies — none.
- 57 `staging` tables have policies keyed on `current_setting('app.current_org_id')`. **The backend never sets that GUC.** Zero occurrences in 37k lines. Those policies have never once been evaluated.
- The remaining 126 `staging` tables have no RLS at all — including `vetana_payslips`, `vetana_salary_structures`, `vetana_payroll_runs`, `manav_employees`, and every `ganit_*`, `graha_*`, `hub_*`, `sign_*` table.
- `relforcerowsecurity` is `false` on all ~224 tables, and the backend connects as the table owner. **Owners bypass RLS.** Even if policies existed, they would not apply to the application.

The consequence, stated plainly: **a single missing `WHERE org_id = $1` is a cross-tenant data breach, not a bug.** There is nothing underneath to catch it. Every unscoped query listed in §4 should be read at that severity, and every "correctly scoped by discipline" query in §4.1 should be read as one careless edit away from the same.

Nothing has leaked *yet*, and the reason is not the controls: the live database holds **2 organisations and 12 users, 10 of whom are platform staff**. This is still a pre-customer dataset. Every finding here is about the day the second real customer lands.

---

## 0. Executive summary

| # | Finding | Severity |
|---|---|---|
| **F-1** | **Application is the sole tenancy enforcement.** No RLS policy in either schema is operative at runtime. | **Critical** |
| **F-2** | 57 `staging` RLS policies key off a GUC the backend never sets. Written, correct, and dead since the day they landed. | **Critical** |
| **F-3** | All 41 `public` tables: RLS enabled, **zero policies**. `backend/migrations/007_rls_and_indexes.sql`, marked "✅ Applied" in the migrations README, defines ~30 policies that **do not exist in the live database**. | **High** |
| **F-4** | `get_visible_team_ids()` returns **every team in the database** for any user with the legacy flag `public.users.role = 'admin'` — a Tier-0 backdoor that bypasses `staging.user_roles` and the whole four-tier model. | **High** |
| **F-5** | The `team_members` retirement claim is **false**. `public.team_members` holds 186 rows and is read at **64 call sites across 17 non-test backend modules**, including authorization paths, plus one live view. | **High** |
| **F-6** | 13 table names exist in **both** schemas. The `staging` twin has `org_id`; the `public` twin does not; **all live data is in `public`**. The org-scoped twins are empty decoys. | **High** |
| **F-7** | The gap is not "48 scattered child tables". It is **the entire pre-org PM core**: 39 of 41 `public` tables, reachable only via `teams.org_id` — and **8 of 39 teams have `org_id IS NULL`**. | **High** |
| **F-8** | `staging.user_roles.org_id IS NULL` **means "platform scope"** and is load-bearing for every platform guard including the spend gate. This column must stay nullable — the obvious cutover step would lock out every god-mode account. | **Landmine** |
| **F-9** | `org_resolver.py` is **not** the tenancy boundary it appears to be: any platform-scoped role resolves **any** org via the `X-Org-Id` header, upstream of every per-route guard. | **High** |

---

## 1. Schema topology — what actually exists

The two schemas are **not** two copies of one app. They are one logical database cut in half.

| | `public` | `staging` |
|---|---|---|
| Tables | 41 | 183 |
| Views | 0 | 2 |
| Indexes | 72 | 551 |
| Tables with `org_id` | **2** (`teams`, `channels`) | **172** |
| Tables with RLS enabled | 41 (100%) | 57 (31%) |
| Policies defined | **0** | 57 |

- `public` holds the **original PM core**: `users`, `tasks`, `teams`, `team_members`, `task_comments`, `messages`, `channels`, `boards`, `invites`, `categories`, `whatsapp_*`.
- `staging` holds **every newer module**: `graha_*`, `ganit_*`, `manav_*`, `hub_*`, `vetana_*`, `vikray_*`, `prachar_*`, `mkt_*`, `sales_*`, `pay_*`, `hr_*`, `crm_*`, `sign_*`, `pahchan_*`, `dristi_*`, plus `organisations` and `user_roles`.
- `staging` has **no** `users`, `tasks`, `teams`, or `team_members`. Any query saying `FROM team_members` resolves to `public.*` regardless of `search_path`.

**Reconciling the "~48 tables" figure.** 39 `public` tables lack `org_id` + 11 `staging` tables lack it = **50**. The remembered "~48" is right in magnitude but wrong in shape: it reads as scattered child tables, when it is in fact one contiguous block — the whole pre-org product — plus eleven deliberate global catalogs.

### 1.1 The eleven `staging` tables without `org_id`

| Table | Why | Verdict |
|---|---|---|
| `add_on_modules`, `plans`, `hub_tiers`, `hub_ai_providers`, `hub_scraper_catalog`, `hub_skill_templates` | Global catalogs | Correct |
| `organisations` | **Is** the tenant (`id` is the org) | Correct |
| `notifications`, `notification_prefs`, `push_tokens`, `push_web_subscriptions` | Duplicates of `public.*`; 0–1 rows; unused | Decoys — §1.2 |

Only the last four are a problem, and for a different reason: they are shadows.

### 1.2 The thirteen shadowed names — F-6 in detail

Thirteen names exist in **both** schemas. Live row counts, read directly:

| Name | `public` rows | `staging` rows | `public` `org_id` | `staging` `org_id` |
|---|---:|---:|---|---|
| `notifications` | **748** | 1 | no | no |
| `activity_events` | **506** | 0 | no | **yes** |
| `task_reminders` | **235** | 0 | no | **yes** |
| `project_assignments` | **58** | 0 | no | **yes** |
| `time_entries` | **6** | 0 | no | **yes** |
| `approvals` | **5** | 0 | no | **yes** |
| `push_web_subscriptions` | **4** | 0 | no | no |
| `field_definitions` | 0 | 0 | no | **yes** |
| `field_values` | 0 | 0 | no | **yes** |
| `org_settings` | 0 | 0 | no | **yes** |
| `report_schedules` | 0 | 0 | no | **yes** |
| `notification_prefs` | 0 | 0 | no | no |
| `push_tokens` | 0 | 0 | no | no |

Backend code qualifies `staging.` explicitly wherever it means the module schema (`staging.user_roles`, `staging.vetana_payslips`, …) and uses bare names for the PM core. The `postgres` role's default `search_path` is `"$user", public, extensions` — **`staging` is not on it**. Bare names resolve to `public`, which is where the data is.

The consequence is a trap worth stating plainly: **someone adding `org_id` scoping to `staging.activity_events` would be writing correct-looking, correctly-scoped code against an empty table, while the 506 real rows continue to be served unscoped from `public`.** There are 138 unqualified references to these thirteen names across the backend — 29 to `project_assignments` in `server.py` alone.

### 1.3 Code referencing tables that do not exist

The AST scan found SQL against tables absent from **both** schemas:

| Reference | Site |
|---|---|
| `staging.projects`, `staging.tasks` | `routers/graha.py:1431`, `services/skills/data/kpi_aggregator.py:42`, `services/skills/data/deadline_scanner.py:16` |
| `samvada_channels`, `samvada_messages`, `samvada_channel_members`, `samvada_message_reactions` | `routers/messaging.py` (~50 refs) — entire Sanvaad module unbacked |
| `varta_messages`, `varta_contacts`, `varta_conversations`, `varta_business_accounts`, `varta_templates`, `varta_auto_replies` | `routers/whatsapp.py` (~25 refs) — entire Varta module unbacked |
| `graha_automations`, `graha_territories`, `graha_web_forms`, `graha_inbound_emails`, `graha_contact_merges`, `graha_scoring_rules`, `graha_custom_fields` | `routers/graha.py` |
| `hub_oauth_states` | `routers/hub_publish.py` — OAuth state store missing (see G-7) |
| `task_assignees` | `invite_router.py:237-238` — user-deletion cleanup targets a non-existent table |
| `staging.user_roles.name`, `.email` | `deadline_scanner.py:16`, `notification_fan_out.py:30` — `user_roles` has only `id, user_id, org_id, role_code, granted_by, granted_at` |

Out of scope for a tenancy audit, but it bears on it: **a table that does not exist cannot be audited for scoping, and cannot be assumed safe.** When these are created they must be born with `org_id NOT NULL`. That is the cheapest tenancy win in this codebase and today it costs nothing.

---

## 2. Row Level Security — the evidence for the headline

### 2.1 `public`: RLS on, zero policies

```
41 of 41 tables: relrowsecurity = true, relforcerowsecurity = false, policy count = 0
```

RLS enabled with no policies is **deny-all** for any role subject to RLS. Two consequences:

1. **PostgREST is fully locked out of `public`.** `anon` and `authenticated` read nothing. This is the only tenancy control in the system that currently works — and it works by accident of having no policies, not by design.
2. **The backend is unaffected.** Owner + `relforcerowsecurity = false` = bypass. Every backend query sees every row of every tenant.

`backend/migrations/007_rls_and_indexes.sql` defines ~30 policies on `tasks`, `teams`, `users`, `task_comments`, `approvals`, `project_assignments`, `notifications` and others; `backend/migrations/README.md` records it as applied. **None exist.** Either it was never run against this database or they were later dropped. Either way the ledger asserts a protection that is not there — the concrete case for verifying against live, not against migration files.

### 2.2 `staging`: 57 policies, all inert

Exactly two distinct expressions across the 57, both `FOR ALL`, both to `PUBLIC` (no role restriction):

```sql
-- 53 tables: crm_*, hr_*, mkt_*, pay_*, sales_*, subscription*, usage_tracking, module_subscriptions
USING (org_id = (current_setting('app.current_org_id'))::uuid)

-- 1 table: crm_deal_stage_history — one hop through the parent
USING (deal_id IN (SELECT id FROM staging.crm_deals
                   WHERE org_id = (current_setting('app.current_org_id'))::uuid))
```

The design is right. The wiring is absent:

- `grep -rn "app.current_org_id\|current_org_id\|set_config\|SET LOCAL" backend/` → **no matches**, on any connection, ever.
- Because the backend bypasses RLS as owner, the policies are never evaluated, so the missing GUC never surfaces as an error. Silently non-functional since written.
- **If anyone "turns RLS on properly"** — `FORCE ROW LEVEL SECURITY`, or moving to a non-owner role — **every query against those 53 tables fails immediately** with `unrecognized configuration parameter "app.current_org_id"`. It fails *closed*, which is the good outcome; but it is a total outage of CRM, HR, payroll, marketing, sales and billing, not graceful degradation. **Set the GUC first** (§5.4, Phase 6a).

---

## 3. The join-path audit — table by table

### 3.1 `public` — 39 tables without `org_id`

`teams.org_id` is the only anchor. Hops counted to `teams`.

| Table | Rows | Scope column | Hops | Path | Enforced in every query? |
|---|---:|---|:---:|---|---|
| `teams` | 39 | `org_id` | **0** | anchor | **8 rows have `org_id IS NULL`** |
| `channels` | — | `org_id` | **0** | anchor | Second anchor, independent of `teams` |
| `tasks` | 200 | `team_id` | 1 | `→ teams` | No — `team_id` nullable, **35 rows have none** |
| `team_members` | 186 | `team_id` | 1 | `→ teams` | Membership source; §6 |
| `project_assignments` | 58 | `team_id` | 1 | `→ teams` | Yes, via `get_visible_team_ids` |
| `activity_events` | 506 | `team_id` | 1 | `→ teams` | Yes (`routers/activity.py` membership check) |
| `notifications` | 748 | `user_id` (+ nullable `team_id`) | 1 or ∞ | `→ teams`, or user-owned | By `user_id`; **75 rows have no `team_id`** |
| `approvals` | 5 | `team_id` | 1 | `→ teams` | Yes (`approvals_router.py`) |
| `boards` | — | `team_id` | 1 | `→ teams` | Yes |
| `project_columns` | — | `team_id` | 1 | `→ teams` | Yes |
| `saved_views` | — | `team_id` | 1 | `→ teams` | Yes |
| `automations` | — | `team_id` | 1 | `→ teams` | Yes (`routers/automations.py`) |
| `task_templates` | — | `team_id` | 1 | `→ teams` | Yes (`routers/templates.py`) |
| `field_definitions` | 0 | `team_id` | 1 | `→ teams` | Yes (`routers/fields.py`) |
| `report_schedules` | 0 | `team_id` | 1 | `→ teams` | Yes |
| `task_comments` | 23 | `task_id` | **2** | `→ tasks → teams` | Yes, via `client_can_access_task` |
| `task_reminders` | 235 | `task_id` | **2** | `→ tasks → teams` | Yes |
| `time_entries` | 6 | `task_id` | **2** | `→ tasks → teams` | Yes (`routers/time_entries.py`) |
| `task_clients` | — | `task_id` | **2** | `→ tasks → teams` | Yes |
| `field_values` | 0 | `task_id`, `field_id` | **2** | `→ tasks → teams` | Yes |
| `board_columns` | — | `board_id` | **2** | `→ boards → teams` | Yes |
| `mentions` | — | `comment_id` | **3** | `→ task_comments → tasks → teams` | Weak — `services/mentions.py` |
| `messages` | — | `channel_id` | 1 | `→ channels.org_id` | Router unbacked (§1.3) |
| `message_attachments` | — | `message_id` | **2** | `→ messages → channels` | Router unbacked |
| `message_reactions` | — | `message_id` | **2** | `→ messages → channels` | Router unbacked |
| `channel_members` | — | `channel_id` | 1 | `→ channels.org_id` | Router unbacked |
| `users` | 12 | — | **∞ — none** | no org column, no FK to one | **Global. `users.role='admin'` is F-4.** |
| `invites` | — | `email` | **∞ — none** | no `team_id`, no `org_id` | **Unscoped by construction** |
| `categories` | — | `user_id` | ∞ | user-owned | Per-user only |
| `dashboards` | — | `user_id` | ∞ | user-owned | Per-user only |
| `user_preferences` | — | `user_id` | ∞ | user-owned | Per-user only |
| `notification_prefs` | 0 | `user_id` | ∞ | user-owned | Per-user only |
| `push_tokens` | 0 | `user_id` | ∞ | user-owned | Per-user only |
| `push_web_subscriptions` | 4 | `user_id` | ∞ | user-owned | Per-user only |
| `push_subscriptions` | — | `user_id` | ∞ | user-owned | Per-user only |
| `user_whatsapp` | — | `user_id` | ∞ | user-owned | Per-user only |
| `whatsapp_messages` | — | `user_id` | ∞ | user-owned | Router unbacked |
| `whatsapp_sessions` | — | `phone` | **∞ — none** | phone number only | **Unscoped by construction** |
| `project_templates` | — | — | **∞ — none** | no `team_id`, no `org_id` | **Global pool, shared across all orgs** |
| `org_settings` | 0 | `key` | **∞ — none** | bare key/value | **Name says org; schema has none** |
| `app_settings` | — | `key` | n/a | global by intent | Correct |

**Four `public` tables have no scoping path at all** — not zero hops, *no path*: `invites`, `whatsapp_sessions`, `project_templates`, `org_settings`. `org_settings` is the sharpest: a table literally named for per-org configuration, storing `(key, value)` with no org column, while its `staging` twin *does* have `org_id` and is empty. `project_templates` means a template authored inside one customer is visible to every other.

### 3.2 `staging` — the 172 with `org_id`

All 172 carry the column, and `org_id` is genuinely used as the predicate: the module routers consistently pass `org_id` from `Depends(get_org_id)`. **`user_roles` is confirmed as the sole tenant path** for org resolution — `middleware/org_resolver.py` reads `staging.user_roles` exclusively, with no `team_members` fallback. That specific claim from the brief is true.

### 3.3 But the resolver is not the boundary it looks like — F-9

`get_org_id` resolves the active org from an `X-Org-Id` header, validated against `staging.user_roles` membership. The validation has a second arm:

```python
# org_resolver.py:31-40
if not is_member:
    is_platform = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[])",
        user["user_id"], list(ALL_PLATFORM_ROLES),
    )
    if not is_platform:
        raise HTTPException(403, "You do not belong to this organisation")
```

`ALL_PLATFORM_ROLES` is **every** Tier-1 code — including `COMMERCIAL_ONLY_ROLES` (`account_manager`, `account_finance`, `srijan_admin`) and `SUPPORT_ROLES` (`platform_support`). But `role_tiers.modules_for()` deliberately returns `frozenset()` for exactly those four roles: they are documented as reaching **no operational module**.

So the resolver grants org context to four roles the tier model says have zero reach, **upstream of every per-route guard**. Whether that becomes a read depends entirely on each route's own `require_module` / `_gate` check — which is precisely the "one missing check is a breach" exposure of §0. The resolver is a *widening* step, not the boundary. Anything reasoning about tenancy should treat the per-route guard as the only boundary, and there are 34 routers' worth of them.

*(A sibling agent is fixing this narrowly. Recorded here because it changes what the resolver can be relied upon for: it authenticates org membership, it does not authorize module reach.)*

---

## 4. Every query touching org-scoped data without an `org_id` predicate

1,674 SQL statements extracted by AST walk (f-string fragments merged; tests, migrations and scripts excluded). 406 statements touch an org-scoped `staging` table with no `org_id` predicate. Statement-level counting overstates the problem, so each was re-analysed **at function level**: a query with no `org_id` predicate is only a finding if *nothing in its enclosing function* establishes org scope.

That reduced 406 statements to **61 functions**, of which **25 never mention `org_id` at all**. Each of the 25 was then read in source.

### 4.1 Correctly scoped — guard-then-act (verified, no action)

The dominant safe pattern: fetch the parent `WHERE id=$1 AND org_id=$2`, 404 if absent, then use the derived id unqualified.

| Function | File | Guard verified |
|---|---|---|
| `run_payroll` | `routers/vetana.py:370` | `vetana_payroll_runs WHERE org_id=$1 AND month=$2` before every `run_id` use |
| `approve_run` | `routers/vetana.py:664` | `WHERE id=$1 AND org_id=$2` + `_require_payroll_admin` |
| `disburse_payslip` | `routers/vetana.py:~830` | `vetana_payslips WHERE id=$1 AND org_id=$2` |
| `update_salary_structure` | `routers/vetana.py:286` | dynamic SQL ends `AND org_id=$N` |
| `update_loan` | `routers/vetana.py:1151` | dynamic SQL ends `AND org_id=$N` |
| `action_leave_request` | `routers/manav.py:755` | `manav_leave_requests WHERE id=$1 AND org_id=$2` first |
| `action_swap` | `routers/manav.py:1527` | `manav_swap_requests WHERE id=$1 AND org_id=$2` first |
| `list_contacts` | `routers/graha.py:268` | `WHERE c.org_id=$1` appended by string build |

Vetana is the best-guarded module in the codebase — every path parameter re-validated against `org_id`, and payroll-admin authority checked separately from module membership.

**But note what this pattern is:** correct *by discipline*, not by construction — and §0 established there is nothing underneath it.

### 4.2 Cross-org by design, correctly gated (no action)

| Function | File | Gate |
|---|---|---|
| `provider_costs` | `routers/admin_orgs.py:442` | `require_platform_role(*FINANCE_CONSOLE_ROLES)` — aggregates `hub_ai_logs`/`hub_scraper_runs` across all orgs. Intended. |
| `revoke_role` | `routers/admin_orgs.py:801` | `require_platform_role(*SUPERUSER_ONLY_ROLES)` |
| `process_scheduled_posts` | `services/social_publisher.py:559` | Background worker, no HTTP caller |
| `process_pending_reminders` | `services/reminder_service.py:122` | Background worker, no HTTP caller |

### 4.3 Capability-token endpoints — scoped by unguessable token (no action, one note)

Public e-signature links; the token *is* the authorization, and there is no session to derive an org from.

| Function | File | Predicate |
|---|---|---|
| `send_otp` | `routers/esign.py:353` | `sign_signers WHERE s.token=$1` |
| `verify_otp` | `routers/esign.py:394` | `sign_signers WHERE token=$1` |
| `decline_signing` | `routers/esign.py:509` | `sign_signers WHERE s.token=$1` |
| `issue_otp` / `verify_otp` / `submit_signature` | `services/esign_service.py:97/127/160` | `ganit_contract_signers WHERE token=$1` |

Correct by design. The note: these are the only endpoints where **token entropy *is* the tenancy boundary**, so token generation quality is a tenancy control. Worth a separate look.

### 4.4 Genuine gaps — 15 findings requiring action

| # | Location | Table(s) | What is wrong | Severity |
|---|---|---|---|---|
| **G-1** | `utils.py:72` `get_visible_team_ids`, and `server.py:183` (cached twin) | `teams` | `if users.role == 'admin': SELECT team_id FROM teams` — **every team in the database, no org filter.** Bypasses `staging.user_roles` and the four-tier model via a legacy per-user column. All 4 current holders happen to also be platform staff; the column is not managed by the role system, so that alignment is coincidence, not control. | **High** |
| **G-2** | `utils.py:72` vs `server.py:183` | `teams`, `project_assignments`, `team_members` | **Two implementations of the same visibility rule**, one with a request cache and one without. They agree today; nothing enforces that they keep agreeing. `routers/search.py` and `routers/tasks_bulk.py` defer-import the `server.py` one *specifically* to avoid drift — the risk was already understood, then left in place. | **Medium** |
| **G-3** | `routers/search.py:285`, `routers/tasks_bulk.py:226` | `teams` | `AND (org_id IS NULL OR org_id = $2::uuid)` — the 8 org-less teams are visible from **every** org context. Benign alone (intersected with the caller's grants), but combines with G-1: a `users.role='admin'` user sees all 8 org-less teams' tasks from inside any org. | **Medium** |
| **G-4** | `services/ai_router.py:606` `deduct_credits` | `hub_credit_wallets`, `hub_credit_transactions` | `WHERE client_id=$1 FOR UPDATE` then debit. No `org_id` anywhere in the function. Scope depends entirely on every caller having validated `client_id`. A money-moving function must not delegate its own tenancy check. | **Medium** |
| **G-5** | `services/rag.py:92/137/260` | `hub_kb_documents`, `hub_kb_chunks` | Ingest, hybrid search and delete scoped by `client_id` only. `search_hybrid` returns document **content** — the highest-value leak surface in the Srijan hub. | **Medium** |
| **G-6** | `services/social_publisher.py:41/50/471` | `hub_social_accounts`, `hub_publish_queue`, `hub_content_items` | `_get_account` / `_refresh_token_if_needed` fetch by bare `id`; `publish_content` joins queue→content→account with no org predicate. These rows hold **OAuth access and refresh tokens**. | **Medium** |
| **G-7** | `routers/hub_publish.py:223` `oauth_callback` | `hub_social_accounts` | `INSERT … (client_id, …)` with `client_id` from OAuth state. `hub_oauth_states` **does not exist** (§1.3), so the state cannot currently be validated against an org at all. | **Medium** |
| **G-8** | `routers/prachar.py:384` `_dispatch` | `prachar_campaigns`, `prachar_campaign_contacts` | Marks campaigns sent by bare `id`. Caller-dependent. | **Low** |
| **G-9** | `routers/esign.py:632` `_generate_signed_certificate` | `sign_documents`, `sign_signers`, `sign_audit_log` | **Takes `org_id` as a parameter and never uses it in a predicate** — reads and updates by bare `document_id`. The scoping value is in the signature, unused. | **Medium** |
| **G-10** | `routers/esign.py:691` `_audit`, `services/esign_service.py:232` `_log_audit` | `sign_audit_log`, `ganit_contract_audit_trail` | Audit rows written with no `org_id`, though the tables have the column. An audit trail that cannot be filtered by tenant is not usable as evidence for one. | **Low** |
| **G-11** | `services/skills/action/notification_fan_out.py:8` | `user_roles`, `reminders` | `SELECT user_id, email FROM staging.user_roles WHERE user_id = ANY($1)` — no `org_id`, and **`user_roles` has no `email` column**. Broken *and* unscoped. | **Medium** |
| **G-12** | `services/skills/data/deadline_scanner.py:7`, `workload_calculator.py:9`, `kpi_aggregator.py:42` | `user_roles`, `project_assignments`, `staging.tasks`, `staging.projects` | Scoped by `project_id` only; two referenced tables do not exist, and `staging.project_assignments` is the **empty decoy** twin (§1.2). | **Medium** |
| **G-13** | `routers/graha.py:278` `list_contacts` | `graha_clients` | `LEFT JOIN staging.graha_clients cl2 ON cl2.id = c.client_id` carries no `org_id` predicate. Safe only while no contact row holds a foreign `client_id`. Defence-in-depth. | **Low** |
| **G-14** | `public.project_templates`, `public.org_settings` | — | No scoping column exists, so no query *can* be scoped. Structural. | **Medium** |
| **G-15** | `public.invites`, `public.whatsapp_sessions` | — | Keyed by email / phone with no org linkage. An invite does not record which org it is for. | **Medium** |

**Summary:** of 25 hard candidates — 4 correctly gated cross-org, 6 capability-token, **15 genuine gaps**. None is exploitable across two paying customers today, because there are not yet two paying customers. G-1, G-4, G-5, G-6 and G-9 become exploitable the day there are.

---

## 5. Phased `org_id` cutover

Six proposals, each with a rollback. **None executes. None has been run.** `staging` and `public` live in the same Supabase project as production, so every one is a proposal for a human to schedule.

**Numbered 076–081.** `_COORDINATION.md` says "take 071 next", but by the time I resumed, `PROPOSED_071_vetana_approver_backfill.sql` had been created on another ref, and the same doc *also* recommends 071 for the unowned `056` rename — a latent double-claim. 074 and 075 are taken (`module_approvers`, `module_grant_composite_key`). **076–081 were verified unused across all refs** (`git log --all --diff-filter=A -- '*PROPOSED_*'`) and leave 072–073 free for whoever takes the `056` renumber.

| Phase | File | What it does | Reversible |
|---|---|---|---|
| 1 | `PROPOSED_076_org_id_add_nullable.sql` | Add `org_id uuid NULL` + 20 indexes to 20 `public` tables | Yes — `DROP COLUMN` |
| 2 | `PROPOSED_077_org_id_backfill.sql` | Backfill from the join path, in dependency order | Yes — `SET org_id = NULL` |
| 3 | `PROPOSED_078_org_id_verify.sql` | **Read-only.** 6 reconciliation queries; no DDL, no DML | N/A |
| 4 | `PROPOSED_079_org_id_constrain.sql` | `CHECK … NOT VALID` then `VALIDATE` — never bare `SET NOT NULL` | Yes — `DROP CONSTRAINT` |
| 5 | `PROPOSED_080_team_members_retire.sql` | Rename (never drop) `public.team_members` | Yes — rename back |
| 6 | `PROPOSED_081_rls_enable.sql` | GUC wiring + policies + `FORCE RLS` | Yes — `NO FORCE` |

### 5.1 Lock duration — the honest answer

Every affected table is small. Largest is `public.notifications` at 480 kB; `tasks` and `activity_events` at 312 kB each; the rest under 160 kB. Total across the 21 tables is under 3 MB.

**On today's data, no phase takes a measurable lock.** Since PostgreSQL 11, `ADD COLUMN … NULL` with no default is a catalog-only change — no rewrite regardless of size. Claiming an outage risk here would be inventing one.

What *is* real, and independent of table size:

- **`ALTER TABLE` takes `ACCESS EXCLUSIVE`.** Instant to execute, but it must *acquire* the lock, and while waiting it **queues behind every other lock request on that table**. One slow `SELECT` on `notifications` at the wrong moment stalls all traffic to `notifications` for as long as that query runs. Mitigation in every phase: `SET lock_timeout = '3s'` — fail fast and retry rather than convoy.
- **The backfill `UPDATE` rewrites every row it touches**, holding `ROW EXCLUSIVE`. At 748 rows the largest is sub-second. The batching in Phase 2 is not needed today; it is written in because the same script will be re-run after growth, and a backfill that only works while the table is small is a trap.
- **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block** and takes two table scans. Phase 1 is written to be run statement-by-statement, not as one transaction.
- **`SET NOT NULL` requires a full table scan under `ACCESS EXCLUSIVE`.** That is the one operation that genuinely becomes an outage at scale. Phase 4 therefore uses `ADD CONSTRAINT … CHECK (org_id IS NOT NULL) NOT VALID` followed by a separate `VALIDATE CONSTRAINT`, which takes only `SHARE UPDATE EXCLUSIVE` and blocks neither reads nor writes. The column stays nullable in the catalog; the constraint does the work.

### 5.2 Backfill coverage — measured, not estimated

This is why it is six phases and not one migration. Live counts:

| Table | Total | Resolvable via join | Residue | Cause |
|---|---:|---:|---:|---|
| `teams` | 39 | 31 | **8** | `org_id IS NULL` — pre-org teams, no parent to inherit from |
| `tasks` | 200 | 165 | **35** | `team_id IS NULL` — personal tasks, no project |
| `team_members` | 186 | 170 | **16** | on org-less teams |
| `project_assignments` | 58 | 42 | **16** | on org-less teams |
| `notifications` | 748 | 652 | **96** | 75 with `team_id IS NULL`, 21 on org-less teams |
| `task_reminders` | 235 | 186 | **49** | parent task has no team |
| `task_comments` | 23 | 19 | **4** | parent task has no team |
| `activity_events` | 506 | **506** | 0 | clean |

**Every table except `activity_events` leaves residue.** A single-migration `ADD COLUMN NOT NULL` fails outright on all of them; even two-step add-then-constrain fails at the constrain step on seven of eight.

The residue splits into two categories needing different decisions — **neither of which this audit should make**:

1. **The 8 org-less teams** (and the 16+16+21 child rows hanging off them). They predate the `org_id` column. Someone who knows which customer they belong to must assign or retire them. With only 2 organisations this is a short manual exercise, but it is a data-ownership judgement, not a schema operation.
2. **The 35 team-less tasks, 75 team-less notifications, 49 orphan reminders, 4 orphan comments.** Personal/system records with no project. Needs a product decision: does a personal task belong to an org, or is it genuinely user-global? Phase 4's constraint is written to permit `org_id IS NULL` **only** where `team_id IS NULL` — encoding "user-global is legitimate" without permitting "we forgot to set it". If the answer is that personal tasks belong to the user's org, Phase 2 gains a `user_roles` fallback and Phase 4 tightens to unconditional.

### 5.3 Risk per phase, against live production data

| Phase | Risk | Blast radius if wrong |
|---|---|---|
| 1 — add nullable | **Low.** Additive; no existing query names the column. `SELECT *` consumers gain a column — `row_to_task()` in `utils.py` maps fields explicitly, so it tolerates this. | None. `DROP COLUMN` is clean. |
| 2 — backfill | **Medium.** `UPDATE` on live rows. Wrong join path ⇒ wrong `org_id`, which Phase 4 then *enforces*. | Correctable while nothing reads the column. This is precisely why Phase 3 is a separate gate. |
| 3 — verify | **None.** `SELECT` only. | N/A |
| 4 — constrain | **Medium-High.** First phase that can reject writes. Any insert path without `org_id` starts failing. | `DROP CONSTRAINT` restores service in one statement. Run Phase 3 immediately before. |
| 5 — retire `team_members` | **High — do not schedule yet.** §6. | Rename is instantly reversible; the 64 call sites are not. |
| 6 — enable RLS | **High.** First phase where a mistake denies service broadly. Must not run before the GUC is wired (§5.4). | `NO FORCE ROW LEVEL SECURITY` restores in one statement per table. |

**One ordering constraint that is easy to miss and expensive to get wrong.** No backend code currently sets `public.*.org_id` on insert — the column does not exist in the application's world. A constraint added before the application writes the column fails every task creation, comment and notification immediately. The sequence is: 076 → 077 → 078 → **ship the application change that populates `org_id` on insert** → re-run 077 to catch rows created in between → 078 again → only then 079. `PROPOSED_079` states this in its header.

**And one in Phase 6 that is worse.** `set_config('app.current_org_id', $1, true)` — the third argument must be `true` (transaction-local). With `false` the setting persists on the pooled connection and the next request to borrow it inherits the previous request's org. `db.py` creates an asyncpg pool with `min_size=3, max_size=15`, so connections are reused constantly. That single boolean is the difference between RLS preventing cross-tenant reads and RLS *causing* them.

### 5.4 The phase that matters most, and is not schema work

Phases 1–4 add a *column*. They do not add *enforcement* — every query in §4 stays exactly as unscoped as it is today, now with an unused column beside it. **Backfilling `org_id` without then using it buys nothing but storage.**

The enforcement work, in order:

- **6a — set the GUC.** Add `SET app.current_org_id` to the connection/request path so the 57 existing `staging` policies become live. A small change in `db.py` / `org_resolver.py`, and the highest-leverage single change available: it activates 53 tables' worth of already-written, already-correct policy. **Must land before any `FORCE ROW LEVEL SECURITY`**, or §2.2 becomes an outage.
- **6b — write policies for `public`.** 41 tables have RLS enabled and no policies; once `org_id` exists (Phase 4) the policy is the same one-liner already used in `staging`.
- **6c — `FORCE ROW LEVEL SECURITY`.** Only this makes policies apply to the owner the backend connects as. Until it runs, everything above is advisory.
- **6d — close G-1.** Retire the `users.role='admin'` branch in both copies of `get_visible_team_ids` in favour of `staging.user_roles`.
- **6e — narrow `ALL_PLATFORM_ROLES` in the resolver** (F-9): the four zero-reach roles should not resolve arbitrary orgs.

6a–6e are application code plus a policy set, they depend on decisions in §5.2, and each is large enough to deserve its own review rather than being buried in a schema audit.

---

## 6. `public.team_members` — not dead, not close

**Reported retired on 2026-07-23. It is not.**

- **186 rows**, all `status='active'`.
- **64 references across 17 non-test backend modules**: `server.py`, `utils.py`, `auth_router.py`, `approvals_router.py`, `invite_router.py`, `routers/{activity,admin_orgs,automations,dashboards,fields,org_members,templates,time_entries,uploads,views}.py`, `services/{automation_engine,mentions}.py`.
- It is **load-bearing for authorization**, not decorative:
  - `utils.py:82` and `server.py:205` — `get_visible_team_ids` UNIONs it with `project_assignments`. Remove it and users invited before registering lose access to their teams.
  - `server.py:228` `is_project_member` — explicit fallback after `project_assignments` misses.
  - `routers/activity.py:49`, `routers/automations.py:58/90/127`, `routers/templates.py:21/234`, `routers/uploads.py:99` — membership gates.
  - `server.py:994` — `role IN ('owner','admin')` checks.
- **`staging.user_org_context` (a live view) depends on it:**
  ```sql
  SELECT u.user_id, …, o.id AS org_id, o.name AS org_name
    FROM users u
    JOIN team_members tm ON tm.user_id = u.user_id
    JOIN staging.organisations o ON o.team_id = tm.team_id
   WHERE tm.status = 'active';
  ```
  Dropping or renaming the table breaks this view. It also reveals a second, undocumented org path — `organisations.team_id` — parallel to `teams.org_id` and pointing the opposite direction.

**What was probably removed on 2026-07-23** is the `team_members` fallback *inside the org resolver*. That is true: `middleware/org_resolver.py` reads `staging.user_roles` exclusively. **"`user_roles` is the sole tenant path" is confirmed — for org resolution.** It does not generalise to project-level membership, which still runs entirely on `team_members`.

**`PROPOSED_075` is a rename, not a drop**, and it is **not ready to schedule**. Correct order:

1. Reconcile `team_members` into `project_assignments` (170 of 186 resolve; 16 sit on org-less teams, needing §5.2 decision 1 first).
2. Replace all 64 call sites.
3. Replace `staging.user_org_context` with a `user_roles`-based definition.
4. Rename the table; watch for errors a full cycle.
5. Only then drop.

Steps 1–3 are the work. The proposal covers 4 and 5.

---

## 7. Spend analytics gate — does the cutover break it?

**Yes, in one specific and avoidable way. Do not add `NOT NULL` to `staging.user_roles.org_id`.**

The gate is `require_platform_role(*FINANCE_CONSOLE_ROLES)` where `FINANCE_CONSOLE_ROLES = GOD_MODE_ROLES + ("account_finance",)`, guarding `routers/admin_orgs.py:442 provider_costs` and the `top_orgs_by_spend` summary at `:363`. `middleware/role_tiers.py` is genuinely well-built — it fails closed for unknown roles, and its comments document two real lockout bugs it was created to fix.

It resolves through:

```sql
SELECT 1 FROM staging.user_roles
 WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])
```

**`org_id IS NULL` is the encoding of "platform scope."** Live distribution:

| `role_code` | `org_id IS NULL` | rows |
|---|---|---:|
| `platform_admin` | **yes** | 4 |
| `platform_staff` | **yes** | 4 |
| `platform_manager` | **yes** | 2 |
| `org_admin` | no | 4 |
| `org_member` | no | 6 |
| `org_owner` | no | 1 |

`org_id IS NULL` appears in this load-bearing sense at **11 further sites**: `middleware/roles.py:41,73,108,133,140,169`, `middleware/org_resolver.py:35`, `middleware/subscription.py:77`, `routers/activity.py:34`, `routers/admin_orgs.py:757`, `auth_router.py:220`.

So:

- **The gate does not depend on anything Phases 1–4 change.** Those touch `public` tables only; `staging.user_roles` already has `org_id` and is out of scope. **The spend gate is safe as written.**
- **The trap is the generalisation.** "Make `org_id` NOT NULL everywhere" is the natural next sentence after this audit, and applying it to `staging.user_roles` deletes the platform tier: all 10 platform-scoped rows become invalid, `require_platform_role` matches nothing, and every platform console — spend analytics, billing, org admin, role assignment — locks out at once. It fails *closed*, so a total outage rather than a leak; but the god-mode accounts that would fix it are the ones locked out.
- **`PROPOSED_074` therefore names `staging.user_roles` in an explicit exclusion list, with the reason in a comment.** A future reader without this report needs that comment in the file.

One genuine weakness, separate from the cutover: `org_id IS NULL` does double duty as both "platform-wide scope" and "value not set". Those are different facts sharing an encoding. A `scope` column (`'platform'` / `'org'`) with `CHECK ((scope='platform') = (org_id IS NULL))` would separate them and make `NOT NULL` safe to reason about. Schema redesign, not a cutover step — noted, not proposed.

---

## 8. What I did not do

- **Nothing was written to the database.** Read-only `SELECT` against `pg_catalog` and exact row counts. No migration run, no DDL issued, no `apply_migration` call made.
- **No proposal file is executable in place** — all are `PROPOSED_*`, none referenced by any runner.
- Phases 6a–6e (GUC wiring, `public` policies, `FORCE RLS`, G-1, F-9) are specified but not written; each needs a decision from §5.2 first.
- The 15 gaps in §4.4 are reported, not fixed. Fixing them touches 9 routers and 6 services — a different change with a different review.
- Table sizes are `pg_total_relation_size` at audit time; `reltuples` was ignored in favour of exact `count(*)` because planner statistics are stale (`staging.organisations` reports 31, actual 2).
- The unbacked modules in §1.3 (Sanvaad, Varta, parts of Graha) were catalogued, not investigated — their absence is someone else's finding, recorded here only because absent tables cannot be audited for scoping.
