# Migration consolidation — inventory, live-schema drift, apply order

Branch: `worktree-agent-a54bd25b975919175`
Base: `staging` @ 2a2a27b
Live project inspected: `toacecaewujfxjfrjwco` (Supabase, ap-southeast-1, PG 17.6)

**Nothing here was applied. Every statement issued against the database was a
`SELECT` against the system catalogs or a `COUNT(*)`. No DDL, no DML, no
`apply_migration`. `staging` and `public` are two schemas in ONE project and
that project is production's.**

Deliverable: `backend/migrations/PROPOSED_075_module_grant_composite_key.sql`.

---

## 1 · Executive summary

1. **Defect one (the UNIQUE) is real, was previously reported as fixed, and is
   not fixed.** `staging.org_member_modules` still carries
   `UNIQUE (user_id, org_id, module_code)` and holds **0 rows**. Proposal 075
   below; free today, expensive after the first grant.

2. **Defect two (the spelling) is real, and is already owned** by
   `verify/org-endpoints` as `PROPOSED_070_sanvaad_spelling.sql`. I have not
   duplicated it. Its position in the order is fixed in §5.

3. **The ordering hazard is real and has ALREADY PARTLY HAPPENED.**
   `PROPOSED_066` is **fully applied** — including its `public.team_members`
   statement, which production reads — while `PROPOSED_065` is **not applied at
   all**. Both files are still labelled "PROPOSED — NOT APPLIED". Detail in §4.

4. **The biggest finding is not in the brief.** Migrations **058, 060 and 061
   are unapplied**, and live code on `staging` reads the objects they create.
   `061` in particular means **org creation and add-member are broken right
   now** with an undefined-column error. Detail in §3.

5. **`staging.users` does not exist.** `users`, `teams`, `team_members` and
   `messages` live in `public`. Four joins in `routers/messaging.py` name
   `staging.users` and cannot resolve.

---

## 2 · The definitive migration inventory

### 2a · Numbered migrations on `origin/staging`

`001, 002` (`.py`), then `.sql`: `007, 008, 009, 010, 011, 012, 013, 014, 015,
016, 017, 018, 019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031,
032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047,
048, 049, 050, 051, 052, 053, 055, 056, 057, 058, 059, 060, 061`.

Gaps, all pre-existing and none of them a lost file:

| Gap | Explanation |
|---|---|
| 003–006 | Never written. `README.md` lists them as "pending" from `V2_PLAN.md §4`; no file has ever existed on any ref. |
| 054 | Never used. No file on any ref. |
| 062 | Never used. No file on any ref. |

`backend/migrations/README.md` is **stale** and should not be used as an index:
it lists `002_custom_fields.sql` (the real `002` is `002_password_reset.py`),
claims `046`/`047` are pending (both applied), and its status column stops at
`047`. Its rule "Never re-number" was correctly overridden this session — see
2c.

### 2b · `PROPOSED_*` files, every branch, deduped

Surveyed with `git log --all --name-only -- backend/migrations/*` plus
`git branch -a --contains` on each introducing commit.

| File | Branch(es) | Owner / subject | State |
|---|---|---|---|
| `PROPOSED_056_task_comment_client_visibility.sql` | `origin/staging` (+ all descendants) | task comment client visibility | **COLLIDES — see 2c** |
| `PROPOSED_063_employee_pii.sql` | `origin/staging` | HRMS PII masking | proposal |
| `PROPOSED_064_pahchan.sql` | `origin/staging` | Pahchan schema | proposal |
| `PROPOSED_065_module_role_levels.sql` | `origin/staging` | module role levels, support sessions | **partly applied — see §4** |
| `PROPOSED_066_tier3_tier4_roles.sql` | `origin/staging` | Tier 3 + Tier 4 roles | **FULLY APPLIED — see §4** |
| `PROPOSED_067_account_self_service.sql` | `feat/me-account-self-service`, `review/me-account-self-service` | account self-service | **holds 067** |
| `PROPOSED_068_org_profile_fields.sql` | `verify/org-endpoints` | org profile fields | renumbered from 067 |
| `PROPOSED_069_org_security.sql` | `verify/org-endpoints` | org security | renumbered from 068 |
| `PROPOSED_070_sanvaad_spelling.sql` | `verify/org-endpoints` | **defect two** | renumbered from 069 |
| `PROPOSED_074_module_approvers.sql` | `worktree-agent-a91ffbcdbce0c3ac0` | separated-duty approver table | proposal, **alternative to 075** |
| `PROPOSED_075_module_grant_composite_key.sql` | **this branch** | **defect one** | proposal |

Superseded and must not be resurrected: `PROPOSED_067_org_profile_fields.sql`,
`PROPOSED_068_org_security.sql`, `PROPOSED_069_sanvaad_spelling.sql` as they
existed on `salvage/org-endpoints` @ 43167f2. They were renamed, not deleted.

**Free numbers: 071, 072, 073, and 076+.**

### 2c · Collisions

| # | Claimants | Status |
|---|---|---|
| **067** | `PROPOSED_067_account_self_service.sql` (`feat/me-account-self-service`) vs `PROPOSED_067_org_profile_fields.sql` (`salvage/org-endpoints`) | **RESOLVED** by `verify/org-endpoints`, which renumbered its own set to 068/069/070 highest-first and repointed 11 self-references, three of them in runtime 503 bodies. `feat/me-account-self-service` keeps 067. I confirm the resolution is correct and complete; no further action. |
| **056** | `PROPOSED_056_task_comment_client_visibility.sql` vs **applied** `056_publish_platforms_expansion.sql` | **UNRESOLVED.** Both sit in `backend/migrations/` on `origin/staging`. Anyone applying in numeric order sees `056` twice. Nobody owns this. **Recommend renaming to `PROPOSED_071_task_comment_client_visibility.sql`** — 071 is free and nothing references the filename. Flagged, not done: the file is not in my scope and renaming another agent's file mid-run is how the 067 collision happened. |

---

## 3 · Drift — files vs. live schema

This is the deliverable the brief asked for. Every row verified by querying the
live catalog, never by reading the migration.

### 3a · Applied and matching

`007`–`053`, `055`, `057`, `059` — spot-verified by probing the specific object
each one creates:

| Migration | Probe | Result |
|---|---|---|
| `050_scraper_results_r2` | `hub_scraper_runs.results_r2_key` | present |
| `051_org_signatory_fields` | `organisations.authorized_signatory_name` / `_designation` | present |
| `052_org_credit_tables` | `hub_org_credits.balance` | present |
| `053_ai_logs_org_id` | `hub_ai_logs.org_id` | present |
| `055_plan_default_credits` | `plans.default_credits` | present |
| `057_file_key_columns` | `graha_documents.file_key`, `ganit_contracts.file_key`, `manav_candidates.resume_key`, `organisations.logo_key` | all four present |
| `059_skills_integration` | `hub_org_skills`, `hub_client_skills.org_id` | present |
| `048_drop_helpdesk` | `helpdesk_tickets` | correctly absent |

`staging` holds 183 base tables; `public` 41.

### 3b · NOT APPLIED — and code depends on them

| Migration | Missing object | Live consequence |
|---|---|---|
| **`058_sanvaad_messaging.sql`** | `staging.samvada_channels`, `samvada_channel_members`, `samvada_messages`, `samvada_message_attachments`, and all `varta_*` tables — **none exist** | `routers/messaging.py` and `routers/search.py` query them. Every Sanvaad endpoint fails at the database. The module is non-functional, not merely ungranted. |
| **`060_audit_log.sql`** | `staging.audit_log` | `services/audit.py::_write` wraps its INSERT in `except Exception: log.warning(...)`, so **every audit event is silently discarded**. Nothing errors and nothing is recorded — including `platform.sensitive_module_access`, the row that makes platform bypass of a sensitive module non-silent. The one control specified as "support access is never silent" is currently silent. |
| **`061_org_max_users.sql`** | `staging.organisations.max_users` | **Hard failures, not silent.** Three live call sites: `admin_orgs.py:143` INSERTs `max_users` on org creation; `org_members.py:161` and `subscription.py:401` both `SELECT COALESCE(o.max_users, p.max_users)`. All three raise undefined-column. **Org creation, add-member and the subscription-usage endpoint are broken.** |

`plans.max_users` DOES exist (from `010`), so only the `organisations` half is
missing — which is why the failure is an undefined column rather than a missing
table.

### 3c · Drift inside the PROPOSED range

| File | Claims | Live reality |
|---|---|---|
| `PROPOSED_065` §2 `ADD COLUMN role ... DEFAULT 'admin'` | not applied | **column exists, `DEFAULT 'viewer'`** — 066's value won |
| `PROPOSED_065` §2 `org_member_modules_not_sensitive` | not applied | **absent** — genuinely not applied |
| `PROPOSED_065` §3 `platform_support_sessions` | not applied | **absent** — genuinely not applied |
| `PROPOSED_065` §1 "the CHECK has never heard of `platform_support`" | stated as a finding | **STALE.** Live `user_roles_role_code_check` admits `platform_owner, platform_admin, platform_manager, platform_staff, platform_support, account_manager, account_finance, srijan_admin, developer, org_owner, org_admin, org_member`. `platform_support` is already there. |
| `PROPOSED_066` §1 (role column, `role_check`, `level_is_meaningful`) | "PROPOSED — Review before running" | **APPLIED** |
| `PROPOSED_066` §2 `public.team_members` role CHECK + `admin` | "PROPOSED", and flagged as the one statement touching production | **APPLIED.** Live `public.team_members_role_check` = `owner, admin, member, client`. |
| `PROPOSED_074` `org_module_approvers` | proposal | absent, consistent |

**Two files labelled "NOT APPLIED" have in fact been applied, one of them to
`public`.** Whatever process applied 066 did not update its header. That is the
mechanism by which this directory and the database diverge, and it matters more
than any individual row above: the labels cannot be trusted, only the catalog
can.

### 3d · Other verified divergences

- **`staging.users` does not exist.** `routers/messaging.py` joins it at lines
  245, 349, 363, 482. `routers/search.py:386` already documents the absence.
  Every other user lookup in the backend uses unqualified `users`, which
  resolves to `public.users`. The four messaging joins are broken.
- **`kartavya` is in no module list that matters.** It appears in the live
  `level_is_meaningful` CHECK and in `role_tiers.HIERARCHICAL_MODULES` /
  `NO_APPROVER_MODULES` / `NO_VIEWER_MODULES`, but **not** in
  `role_tiers.ALL_MODULES` and not in `module_subscriptions`. A grant naming it
  is rejected by `_validate_grant` before the CHECK is ever consulted.
- **`varta` and `esign`** are in `ALL_MODULES` but absent from
  `module_subscriptions`.

---

## 4 · The ordering hazard (065 vs 066) — verified, and worse than stated

The brief asks whether `PROPOSED_065` breaks the Tier-4 model if applied after
`066`. It does, by two independent mechanisms.

**Mechanism 1 — the silent default swap.** Both files open with

```sql
ALTER TABLE staging.org_member_modules
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT <x>;
```

`065` uses `DEFAULT 'admin'`; `066` uses `DEFAULT 'viewer'`. `IF NOT EXISTS`
makes the SECOND one a **no-op that reports success** — the column keeps
whichever default was created first, and the losing file's stated intent
vanishes without an error. Live shows `DEFAULT 'viewer'`, so 066 got there
first. Had the order been reversed, every future grant would silently default
to full control, and `role_tiers.DEFAULT_GRANT_LEVEL = VIEWER` would disagree
with the column that backs it.

**Mechanism 2 — the constraint that removes the model.** `065` §2 adds

```sql
CHECK (module_code NOT IN ('vetana', 'ganit', 'manav', 'pahchan'))
```

`vetana` and `ganit` are precisely `role_tiers.SEPARATED_DUTY_MODULES` — the
only two modules where admin does not satisfy approver, and therefore the only
two where a distinct approver grant means anything. Applying `065` after `066`
keeps 066's four-level ladder and simultaneously **forbids any grant row on the
two modules the ladder exists for**. Tier 4 survives as a column that can never
be exercised where it matters.

That is not a hypothetical: it is why `PROPOSED_074` had to invent a whole
separate table. 074's author read 065 as settled. 066's author wrote a
`COMMENT ON COLUMN` assuming ganit/vetana grants live in `org_member_modules`.
**The two are in direct contradiction and nobody has reconciled them.** That
reconciliation is a product decision, raised and left open by 065 §5(a), and it
is stated as the explicit fork in §5 of my proposal.

**Making it impossible to get wrong:** `065` must never be applied as written.
If the owner wants any part of it, split it —

- `065` §3 (`platform_support_sessions`) is independent, additive, and safe in
  any position. It can go today.
- `065` §2's `not_sensitive` CHECK must be decided against 074/075 first, and
  whichever way it goes, the loser's file must be deleted rather than left in
  the directory to be applied later by someone reading numbers.
- `065` §2's `ADD COLUMN` is already satisfied by 066 and must be struck from
  the file so it cannot mislead.

---

## 5 · Recommended apply order

Position is what matters; the numbers only encode it. **Nothing below has been
run.**

### Stage 0 — repair the drift before adding to it

| # | Action | Risk |
|---|---|---|
| 0.1 | **`061_org_max_users.sql`** | **LOW to apply, HIGH not to.** Two `ADD COLUMN IF NOT EXISTS`, one CHECK, one UPDATE on `plans`. Fixes three broken endpoints. Do this first — org creation is currently failing. |
| 0.2 | **`060_audit_log.sql`** | LOW. New table + four indexes, nothing references it by FK. Restores the audit trail that is currently being discarded. |
| 0.3 | **`058_sanvaad_messaging.sql`** | MEDIUM. Creates ~8 tables. Verify it does not conflict with `public.messages`, and note it creates `samvada_*` while 070 is renaming the module to `sanvaad` — **decide the table-name spelling before applying, or 070's scope grows.** |
| 0.4 | Correct the headers on `PROPOSED_065`/`066` to record that 066 is applied. | None. Documentation. |

### Stage 1 — the two known defects, while `org_member_modules` is EMPTY

Both fixes are cheap only at zero rows. **Run them in one window.**

| # | Action | Owner | Risk |
|---|---|---|---|
| 1.1 | **`PROPOSED_070_sanvaad_spelling.sql`** — SQL half FIRST, then the `role_tiers.py` / `org_modules.py` / `catalogue.js` change in the same deploy. | `verify/org-endpoints` | MEDIUM. Not self-contained. Order is asymmetric: SQL-then-code leaves a harmless gap at zero rows; code-then-SQL returns 500. |
| 1.2 | **Step 1 of `PROPOSED_075`** — deploy the `ON CONFLICT DO NOTHING` code change alone. | this branch | LOW. Valid against both the old and new constraints, so it is safe to ship days ahead. |
| 1.3 | **Step 2 of `PROPOSED_075`** — the SQL. | this branch | LOW at zero rows; the file aborts itself if the table is not empty. |

1.1 before 1.2/1.3 is a recommendation, not a hard dependency — 070 touches a
CHECK, 075 touches a UNIQUE, and they do not overlap.

### Stage 2 — blocked on a product decision

| # | Action | Blocker |
|---|---|---|
| 2.1 | `PROPOSED_065` §3 only (`platform_support_sessions`) | none — can go any time |
| 2.2 | `PROPOSED_065` §2 `not_sensitive` **XOR** `PROPOSED_075` **XOR** `PROPOSED_074` | §4 above. Pick one model. My recommendation, with reasons, is in §5 of the proposal file: apply 075, do not apply `not_sensitive`, stand 074 down. |
| 2.3 | `PROPOSED_074` seeding | If 074 wins, its DDL must ship **with** its seed in one transaction or every org loses the ability to release a payment. |

### Stage 3 — unowned and independent

`PROPOSED_063`, `PROPOSED_064`, `PROPOSED_067` (account self-service),
`PROPOSED_068`, `PROPOSED_069`, and the `056` collision rename. None interact
with the above.

---

## 6 · Coordination

- **`verify/org-endpoints`** owns the sanvaad spelling (`PROPOSED_070`) and the
  067 renumber. I verified both and duplicated neither. Its report's numbering
  table is correct; my only addition is that `PROPOSED_056` remains unresolved
  and 071–073 are free.
- **`worktree-agent-a91ffbcdbce0c3ac0`** owns `PROPOSED_074` and the
  `level_satisfies` enforcement. **`PROPOSED_075` and `PROPOSED_074` are
  alternatives, not complements** — flagged in both directions. That agent's
  finding that `level_satisfies()` has zero call sites is consistent with what I
  see, and it is why 075 is explicitly labelled "not a security fix".
- **`feat/me-account-self-service`** keeps 067. Untouched.

---

## 7 · Work log

- Checkpoint 1 — inventory gathered, both defects verified live, 065/066 drift identified.
- Checkpoint 2 — full drift sweep (058/060/061 unapplied), 066 confirmed applied
  to `public`, ordering hazard verified by both mechanisms, `PROPOSED_075` written.
