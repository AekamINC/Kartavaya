# Migration consolidation — inventory, live-schema drift, apply order

Branch: `worktree-agent-a54bd25b975919175`
Base: `staging`
Live project inspected: `toacecaewujfxjfrjwco` (Supabase, ap-southeast-1, PG 17.6)

**Nothing in this report was applied. Every statement issued against the
database was a `SELECT` against the catalog or a `COUNT(*)`. No DDL, no DML, no
`apply_migration`. `staging` and `public` are two schemas in ONE project and
that project is production's.**

Status: CHECKPOINT 1 — inventory + both defects verified. Proposals to follow.

---

## 1 · Headline findings

1. **Defect one is real and free to fix right now.**
   `staging.org_member_modules` carries `UNIQUE (user_id, org_id, module_code)`
   and holds **0 rows** (verified by `COUNT(*)`, not by reading a migration).
   One user cannot hold both `admin` and `approver` on the same module.

2. **Defect two is real.** The live CHECK `org_member_modules_level_is_meaningful`
   names `samvada`. `staging.module_subscriptions` holds `sanvaad`. The clause
   is dead: it can never match a row.

3. **`PROPOSED_065` is PARTIALLY APPLIED, and not as written.** The `role`
   column exists live with `DEFAULT 'viewer'`; the file says `DEFAULT 'admin'`.
   Its `org_member_modules_not_sensitive` CHECK is **absent**. Its
   `platform_support_sessions` table is **absent**. This is the single biggest
   piece of file-vs-reality divergence in the directory.

4. **`PROPOSED_066` appears applied ahead of `065`** — the
   `level_is_meaningful` CHECK is live and belongs to 066, while 065's own
   constraints are not. The ordering hazard in the brief has already
   partly occurred.

5. **`staging.users` does not exist.** `users`, `teams`, `team_members` and
   `messages` all live in `public`. Any query naming `staging.users` is broken.

---

## 2 · Live-schema facts (verified this session)

`staging.org_member_modules` columns:

| # | column | type | not null | default |
|---|--------|------|----------|---------|
| 1 | id | uuid | yes | `gen_random_uuid()` |
| 2 | user_id | text | yes | — |
| 3 | org_id | uuid | yes | — |
| 4 | module_code | text | yes | — |
| 5 | granted_by | text | no | — |
| 6 | granted_at | timestamptz | no | `now()` |
| 7 | **role** | text | **yes** | **`'viewer'`** |

Constraints live on that table:

- `org_member_modules_pkey` — PRIMARY KEY (id)
- `org_member_modules_user_id_org_id_module_code_key` — **UNIQUE (user_id, org_id, module_code)** ← defect one
- `org_member_modules_org_id_fkey` — FK → `staging.organisations(id)` ON DELETE CASCADE
- `org_member_modules_role_check` — CHECK role IN (viewer, editor, approver, admin)
- `org_member_modules_level_is_meaningful` — CHECK, contains **`samvada`** ← defect two

Row counts:

| table | rows |
|-------|------|
| `staging.org_member_modules` | **0** |
| `staging.user_roles` | 21 |
| `staging.module_subscriptions` | 18 |
| `staging.organisations` | 2 |

`staging.module_subscriptions.module_code` distinct values:
`dristi, ganit, graha, manav, pahchan, prachar, sanvaad, srijan, vetana, vikray`
— **`sanvaad`, never `samvada`**. Also note `kartavya` and `esign` are named in
the CHECK but are not module_subscription codes at all.

`staging.user_roles.role_code` live CHECK admits:
`platform_owner, platform_admin, platform_manager, platform_staff,
platform_support, account_manager, account_finance, srijan_admin, developer,
org_owner, org_admin, org_member`.

Schema table counts: `staging` 183, `public` 41.

---

## 3 · Work log

- Checkpoint 1 — inventory gathered, both defects verified live, drift on 065/066 identified.
