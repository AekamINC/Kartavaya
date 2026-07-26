# RBAC rollback — what to do if anyone cannot log in

Written 2026-07-26, before the RBAC hardening pass. Procedure only — no user data.
The data snapshot is at `.backups/user_roles_restore_2026-07-26.sql`, which is
gitignored because it holds user and org IDs.

---

## The short version

**Production login cannot be broken by RBAC work on `staging`.** Verified against
the branch, not assumed — see §1. If production login does break, RBAC is not the
cause and this runbook is the wrong document.

---

## 1 · Why production is insulated

Production deploys `backend/` from **`main`**. Staging deploys from **`staging`**.
They share one Supabase project, so the *database* is common ground — the *code*
is not.

Two facts checked against `origin/main`:

**`main` has no RBAC middleware at all.** `middleware/roles.py`,
`middleware/subscription.py` and `middleware/org_resolver.py` do not exist on that
branch. Nothing the hardening pass changes in those files can reach production
until someone merges `staging` into `main`.

**`main`'s login never reads `staging.user_roles`.** It authenticates against
`public.users` and resolves tenancy through `public.team_members`. The
`staging.user_roles` table — the sole authorisation source on `staging` — is
invisible to it.

So the blast radius of an RBAC change is: **staging only**, until a merge.

### What WOULD reach production

A migration touching `public.*`. `public.users` and `public.team_members` are
production's login path. This is exactly why the RBAC agent was instructed to
write migrations as unapplied `PROPOSED_*.sql` files rather than run them, and why
every migration in this repo qualifies its schema explicitly.

Before applying anything to `public.*`, stop and read §4.

---

## 2 · Baseline at snapshot time

Compare against these before concluding something is broken.

| | |
|---|---|
| `staging.user_roles` rows | 17 |
| Distinct users with a role | 12 |
| Platform-level rows (`org_id IS NULL`) | 6 |
| Org-scoped rows | 11 |
| **Users with NO role** | **0** ← the number that matters |
| `public.users` | 12, all 12 with a password set |
| `public.team_members` | 186, all active |
| Login fingerprint | `354ce82ecff57b408614ad480c84847f` |

Role codes in use: `account_manager`, `org_admin`, `org_member`, `org_owner`,
`platform_admin`.

The fingerprint is `md5` over `user_id` plus the first 8 chars of each password
hash. It changes if credentials are touched and exposes nothing. Recompute with:

```sql
SELECT md5(string_agg(user_id || ':' || COALESCE(left(password_hash,8),'-'), '|' ORDER BY user_id))
  FROM public.users;
```

---

## 3 · Triage — which failure is it?

Run these in the Supabase SQL editor, project `toacecaewujfxjfrjwco`.

```sql
-- A. Has anyone lost their roles? Expect 0.
SELECT count(*) FROM public.users u
 WHERE NOT EXISTS (SELECT 1 FROM staging.user_roles r WHERE r.user_id = u.user_id);

-- B. Are the roles still there at all? Expect 17 / 12.
SELECT count(*) AS rows, count(DISTINCT user_id) AS users FROM staging.user_roles;

-- C. Have credentials been touched? Compare to the fingerprint above.
SELECT md5(string_agg(user_id || ':' || COALESCE(left(password_hash,8),'-'), '|' ORDER BY user_id))
  FROM public.users;
```

| Symptom | Almost certainly |
|---|---|
| A > 0 | Role rows deleted → **§4.1** |
| B low, A = 0 | Partial delete → **§4.1** |
| C differs | Credentials altered → **§4.3**. Not an RBAC failure |
| All three fine, staging still 403s | Code, not data → **§4.2** |
| All three fine, PRODUCTION fails | Not RBAC. See §1 — check the Railway deploy and `main` |

---

## 4 · Restore

### 4.1 · Role rows lost

```
.backups/user_roles_restore_2026-07-26.sql
```

Every statement is `ON CONFLICT DO NOTHING`, so it is safe to run against an
intact table and safe to run twice. It only *adds* rows back.

If the damage is *wrong* rows rather than *missing* rows, this file cannot help on
its own — it does not know what should not be there. Delete the bad rows first, or
prefer a Supabase point-in-time restore if the extent is unclear.

Verify afterwards with the three queries in §3. All three must match §2.

### 4.2 · Code, not data

The hardening pass is one or more commits on `staging`. Nothing is merged to
`main` automatically.

```bash
git log --oneline origin/staging -15          # find the RBAC commit
git revert --no-edit <sha>                    # revert, do not reset — staging is shared
git push origin staging
```

Railway redeploys staging from the branch. Prefer `revert` over `reset --hard`:
staging is pushed and shared, and a force-push loses other people's work.

To check a guard change without deploying:

```bash
cd backend && python -m pytest tests/ -q
```

`test_ganit.py::test_create_invoice_success` fails on a clean tree already —
a pre-existing conftest issue, not a regression.

### 4.3 · Credentials altered

Not something this pass should ever touch. If the fingerprint moved, use Supabase
point-in-time recovery rather than any file here — password hashes are not
snapshotted anywhere in this repo, deliberately.

---

## 5 · The rule that keeps this cheap

`staging.user_roles` is the **sole** authorisation source; the legacy
`team_members` fallback was removed in `2b1c444`. There is no degraded mode: a
user missing a role row does not get reduced access, they get none.

That is why "users with NO role" is the first thing to check and the last thing to
break. Any change that can reduce that count to anything other than zero needs a
migration, a review, and a line in this file.
