# Multi-Tenancy Audit & `org_id` Cutover Plan

**Branch:** `worktree-agent-af995b4dcc3e7854f`
**Scope:** whole-schema tenancy audit, join-path enforcement audit, RLS posture, phased `org_id` backfill plan, `team_members` retirement.
**Method:** live schema read via `pg_catalog` on project `toacecaewujfxjfrjwco` (read-only), cross-checked against backend source. **Migration files were NOT trusted** — they diverge from live, materially (see F-3).

> **RECOVERED 2026-07-27.** This was the ONLY file in 341 branches that never
> reached `staging` — every other branch's content was already there or had been
> deliberately deleted. It was written incrementally and its branch was never
> merged, so it sat unread while the findings below stayed true.
>
> **F-1 to F-4 re-verified against the live database on recovery:**
>
> | claim | measured |
> |---|---|
> | `public` has RLS on with no policies | **41 of 41 tables RLS-enabled, 0 policies** |
> | staging policies key off a GUC nobody sets | **54 policies; `app.current_org_id` and `set_config` appear NOWHERE in the backend** |
> | `team_members` still load-bearing | **23 references across 12 files in routers/ and middleware/** |
>
> So tenancy rests entirely on application code. That is not a reason to panic —
> the service role bypasses RLS anyway, so no policy would have been protecting
> anything — but it does mean **every cross-tenant guarantee in this product is a
> `WHERE` clause somebody remembered to write.** The dashboard leak found and
> fixed on 2026-07-27 is exactly what that looks like when one is missed.

---

## 0. Executive summary — the five things that matter

| # | Finding | Severity |
|---|---|---|
| **F-1** | **Tenancy is enforced by application code alone.** Every RLS policy that exists is either inert or absent at runtime. A single missing `WHERE` is a cross-tenant breach, not a bug. | **Critical** |
| **F-2** | The 57 `staging` RLS policies key off `current_setting('app.current_org_id')`. **The backend never sets that GUC** — zero occurrences in the codebase. The policies have never been exercised. | **Critical** |
| **F-3** | All 41 `public` tables have `relrowsecurity = true` and **zero policies**. `backend/migrations/007_rls_and_indexes.sql` (marked "✅ Applied") defines ~30 policies that **do not exist in the live database.** | **High** |
| **F-4** | The claim that the `team_members` fallback was removed on 2026-07-23 is **false**. `public.team_members` is read by 8 backend modules across 30+ call sites and is load-bearing for authorization. | **High** |
| **F-5** | The real tenancy gap is not "48 scattered child tables". It is **the entire original PM core in `public`** — `tasks`, `users`, `task_comments`, `messages`, `boards`, `notifications`, … — 39 of 41 tables, reachable only by a join to `teams.org_id`. | **High** |

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
- `staging` holds **every newer module**: `graha_*`, `ganit_*`, `manav_*`, `hub_*`, `vetana_*`, `vikray_*`, `prachar_*`, `mkt_*`, `sales_*`, `pay_*`, `hr_*`, `crm_*`, `sign_*`, `pahchan_*`, `dristi_*`, plus `organisations` / `user_roles`.
- 13 table names exist in **both** schemas (see §1.1) — these are resolved by `search_path` and are the sharpest edge in the system.

`staging` has **no** `users`, `tasks`, `teams`, or `team_members`. So every backend query that says `FROM tasks` or `FROM team_members` resolves to `public.*` no matter what the `search_path` is.

### 1.1 Shadowed table names — present in BOTH schemas

`activity_events`, `approvals`, `field_definitions`, `field_values`, `notification_prefs`, `notifications`, `org_settings`, `project_assignments`, `push_tokens`, `push_web_subscriptions`, `report_schedules`, `task_reminders`, `time_entries`.

In every case the `staging` copy **has** `org_id` and the `public` copy **does not** (except `notification_prefs`/`notifications`/`push_tokens`/`push_web_subscriptions`, which lack it in both). Which row a query hits depends entirely on `search_path` — and the backend never sets one explicitly (§3.3).

---

## 2. RLS posture — the headline finding

### 2.1 `public`: RLS on, zero policies

Confirmed live:

```
SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
-- 41 rows, all relrowsecurity = true, all policy count = 0
```

RLS enabled with no policies is **deny-all** for any role subject to RLS. Two consequences:

1. **PostgREST is fully locked out of `public`.** `anon` and `authenticated` can read nothing. That is good, and is the only tenancy control in the system that actually works.
2. **The backend is entirely unaffected.** It connects over `DATABASE_URL` as the table owner, `relforcerowsecurity` is `false` on every table, and owners bypass RLS. Every backend query sees every row of every tenant.

`backend/migrations/007_rls_and_indexes.sql` is marked "✅ Applied" in `backend/migrations/README.md` and defines ~30 policies on `tasks`, `teams`, `users`, `task_comments`, `approvals`, `project_assignments`, `notifications`, etc. **None of those policies exist in the live database.** The migration ledger is wrong. This is the concrete proof of the "verify against live schema, not migration files" instruction.

### 2.2 `staging`: 57 policies, all inert

There are exactly two distinct policy expressions across the 57 policies, both `FOR ALL`, both applying to `PUBLIC` (no role restriction):

```sql
-- 53 tables (crm_*, hr_*, mkt_*, pay_*, sales_*, subscription*, usage_tracking, module_subscriptions)
USING (org_id = (current_setting('app.current_org_id'))::uuid)

-- 1 table (crm_deal_stage_history), one hop through the parent
USING (deal_id IN (SELECT id FROM staging.crm_deals
                   WHERE org_id = (current_setting('app.current_org_id'))::uuid))
```

The design is correct. The wiring is absent:

- `grep -rn "app.current_org_id\|current_org_id\|set_config\|SET LOCAL" backend/` → **no matches.** The GUC is never set.
- Because the backend bypasses RLS as owner, the policies are never evaluated, so the missing GUC never surfaces as an error.
- If RLS were ever forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`) or the backend switched to a non-owner role, **every query against those 53 tables would immediately fail** with `unrecognized configuration parameter "app.current_org_id"` — not silently leak, but hard-fail. That is worth knowing before anyone "turns RLS on" as a quick win.
- The remaining **126 `staging` tables have no RLS at all**, including `vetana_payslips`, `vetana_salary_structures`, `vetana_loans`, `vetana_payroll_runs`, `manav_employees`, `ganit_*`, `graha_*`, `hub_*`, `sign_*`, `pahchan_*`.

### 2.3 Plain statement

**The application is the only thing enforcing tenancy.** There is no database-level backstop anywhere in either schema. Every one of the ~224 tables is fully readable by the backend role regardless of tenant. The blast radius of one forgotten predicate is one customer reading another customer's payroll — `staging.vetana_payslips` and `staging.pay_slips` have no RLS and no second line of defence.

---

*(sections 3–7 in progress)*
