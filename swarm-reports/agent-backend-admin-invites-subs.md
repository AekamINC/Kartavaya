# Backend — admin, invites, subscriptions

Branch: `agent/backend-admin-invites-subs`
Base: rebased onto `origin/staging` after the spend-limit stop (59 commits landed meanwhile).
Gates: `check-tokens` exit 0, `check-classes` exit 0, both run from `frontend/` with no pipe.
Tests: **424 passed**, 1 failed — `test_ganit.py::test_create_invoice_success`, the known
pre-existing failure in `_COORDINATION.md` §8. Confirmed identical on clean staging.

Files changed: `backend/invite_router.py`, `backend/routers/admin_orgs.py`,
`backend/routers/subscription.py`, `backend/middleware/roles.py`,
`backend/middleware/org_resolver.py`, `frontend/src/pages/AdminPage.jsx`,
plus three test files.

Not touched, as briefed: `role_tiers.py`, `org_modules.py`, `org_profile.py`,
`org_security.py`, `manav.py`, `vetana.py`, `graha.py`, `me.py`, approvals,
messaging, ganit/vikray/prachar/dristi.

> **Worktree note.** The worktree I was handed was 272 commits behind `origin/staging`
> and carried 13 unrelated R2-attachment commits. I branched fresh from `origin/staging`
> rather than rebasing; `worktree-agent-a2c335d7df9bad5be` still points at them.
>
> **Do not use `git stash` in this run.** `refs/stash` is shared across all worktrees of
> one repo. My `stash push` was popped by a sibling agent seconds later and I applied
> theirs. Both were recovered from `git fsck --unreachable` and returned with
> `git stash store`. Use `git diff > file.patch`.

---

## 1. Before/after reachability

**Platform tier.** GOD = `platform_owner`/`platform_admin`, MGR = `platform_manager`,
STF = `platform_staff`, AM = `account_manager`, FIN = `account_finance`,
SRJ = `srijan_admin`, SUP = `platform_support`.

| Capability | Route | Before | After |
|---|---|---|---|
| Read every pending invite's **redemption token** | `GET /api/admin/invites` | GOD MGR STF AM | **nobody** |
| Create an account at legacy `admin` | `POST /api/admin/invites` | GOD MGR STF AM | **GOD** |
| Promote any user to legacy `admin` | `PUT /api/admin/users/{id}/role` | GOD MGR STF AM | **GOD** |
| Invite at `member` / `client` | `POST /api/admin/invites` | GOD MGR STF AM | GOD MGR STF AM (unchanged) |
| Edit / delete a **platform-role holder's** account | `PATCH`/`DELETE /api/admin/users/{id}` | GOD MGR STF AM | **GOD** |
| Edit / delete an ordinary user | same | GOD MGR STF AM | GOD MGR STF AM (unchanged) |
| Top up an org's credit wallet | `POST /v1/admin/orgs/{id}/credits/topup` | GOD MGR STF AM | **GOD MGR AM FIN SRJ** (`SRIJAN_COMMERCIAL_ROLES`) |
| Set `markup_pct` / `monthly_price` | `PATCH /v1/admin/orgs/{id}/settings` | GOD MGR STF AM | **GOD MGR AM FIN** (`BILLING_CONSOLE_ROLES`) |
| Revoke the **last** god-mode role | `DELETE /v1/admin/orgs/roles/{id}` | GOD | **nobody** (409) |
| Assign role `developer` | `POST /v1/admin/orgs/roles/assign` | GOD | **nobody** (400) |
| Resolve **any** org via `X-Org-Id` | `middleware/org_resolver.get_org_id` | GOD MGR STF AM FIN SRJ **SUP** | GOD MGR STF AM FIN SRJ |
| Count as org admin in **every** org | `middleware/roles.is_org_admin` | GOD MGR STF AM FIN SRJ **SUP** | GOD MGR STF AM FIN SRJ |
| Pass `require_org_role` as god mode | `middleware/roles.require_org_role` | `platform_admin` **only** | **GOD** (both spellings) |
| `is_platform_admin` flag | `GET /v1/subscription/my-roles` | `platform_admin` **only** | **GOD** (both spellings) |

**Org tier.**

| Capability | Route | Before | After |
|---|---|---|---|
| Read the org's invoices, totals included | `GET /v1/subscription/invoices` | **any org_member** | org_owner, org_admin |
| Read the org's credit consumption | `GET /v1/subscription/cost-report` | **any org_member** | org_owner, org_admin |
| Download the usage PDF (carries signatory name) | `GET /v1/subscription/cost-report/pdf` | **any org_member** | org_owner, org_admin |
| Read plan name and seat count | `GET /v1/subscription/current`, `/usage` | any org_member | any org_member (unchanged, deliberately) |

**Seats.** Three paths write an org membership row. Before, one of three counted.

| Path | Guard | Seat check before | after |
|---|---|---|---|
| `POST /v1/org/members` | org_admin, org_owner | yes | yes |
| `POST /v1/admin/orgs/{id}/members` | CONSOLE_ROLES | **no** | **yes** |
| `POST /v1/admin/orgs/roles/assign` (org role) | GOD | **no** | **yes** |

**Modules.** Which codes each activation path accepts.

| Path | Before | After |
|---|---|---|
| `POST /v1/admin/orgs/{id}/modules/{code}` | 8 (no `esign`, `varta`, `pahchan`, messaging) | 12 — `role_tiers.ALL_MODULES` *(sibling landed this)* |
| `POST /v1/subscription/modules/activate` | 8, from the `add_on_modules` seed | 12 — same set |

---

## 2. Escalation paths closed

1. **Invite-token disclosure → account takeover.** `GET /api/admin/invites` selected
   `i.token` and returned a ready-made `/accept-invite?token=…` for every invite on the
   platform, 100 per page. `POST /api/auth/accept-invite` asks for nothing but that
   token — it looks the invite up by it, creates the account and sets whatever password
   the caller supplies. So the listing was a set of live credentials for every unclaimed
   account, readable by `platform_staff` and `account_manager`. The link is now returned
   once, by `create_invite`, to the person who created it; the listing has a response
   model with no field to leak it from. `AdminPage.jsx` shows the copy button only for
   the invite that operator just created.
2. **Minting a privileged account.** `create_invite` / `update_user` / `change_user_role`
   validated `role in ("admin","member","client")` and stopped — no comparison against
   the caller. `users.role == 'admin'` is **not** dead: `approvals_router.py:402,610` and
   `server.py:345,1134` still read it. Top rung is now `SUPERUSER_ONLY_ROLES`.
3. **Lateral move against a superior.** Those routes plus `DELETE /users/{id}` would act
   on a `platform_owner`'s account for a `platform_staff` caller — delete it outright, or
   re-point it. Touching a platform-role holder now requires god mode.
4. **Seat cap bypass, two of three paths.** Detailed above.
5. **`platform_support` had no gate at all.** `RBAC-SPEC.md:19` specifies zero access
   until an org admin approves with a time limit and module scope, audited in
   `platform_support_sessions`. That table does not exist, and `role_tiers.py:40-43`
   states the role therefore "gets nothing". It got: any org's context via `X-Org-Id`
   (`org_resolver`), `is_platform_staff() == True`, and `is_org_admin() == True` in every
   org. `require_module` did refuse it, so module routers were never the exposure — the
   exposure was every route taking `get_org_id` without a module gate. Now excluded from
   both helpers.
6. **God-mode lockout, two directions.** `require_org_role` and `/my-roles` probed the
   literal `'platform_admin'`, refusing `platform_owner`; and `revoke_role` would delete
   the last god-mode row with no way back, since the only endpoint that grants platform
   roles is itself god-mode-only.
7. **Org money readable by any member.** Invoices, credit consumption and the signatory
   PDF. The UI gated it, the API did not.
8. **Three modules unactivatable.** `POST /v1/subscription/modules/activate` validated
   against `staging.add_on_modules`, seeded with eight codes. `vikray`, `prachar` and
   `varta` have no row and never did, yet all three have live `require_module()` gates
   and working routers.

---

## 3. Every claim, HELD or STALE

**HELD** = reproduced on `origin/staging`. **STALE** = a prior-report claim that is not true.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| F1 | Invite listing serves raw tokens | **HELD** → fixed | `invite_router.py:341-366` selected `i.token` |
| F2 | The platform invite path has no org at all | **HELD** → open | `create_invite` takes no `org_id`; `accept_invite` writes no `user_roles` row |
| F3 | Invite role unbounded by the inviter's | **HELD** → fixed | no caller comparison anywhere in the three routes |
| F4 | Seat cap enforced on one path only | **HELD** → fixed | `org_members.py:160` had it; `admin_orgs.add_member` and `assign_role` did not |
| F5 | `sanvaad`/`samvada` never string-matches | **HELD** → fixed by sibling | was `add_on_modules.code='sanvaad'` vs `require_module("samvada")`. `role_tiers` now says `sanvaad` throughout; **no live `samvada` module code remains in Python** — the eight hits are all comments |
| F6 | Platform console cannot reach four modules | **HELD** → fixed by sibling | local 8-item `ALL_MODULES` |
| F7 | `platform_support` has no server-side gate | **HELD** → fixed | see escalation 5 |
| F8 | Credit top-up reachable by `platform_staff` | **HELD** → fixed | guard was `CONSOLE_ROLES` |
| F9 | Commercial terms editable by `platform_staff` | **HELD** → fixed | `update_org_settings` was `CONSOLE_ROLES` |
| F10 | Org money readable by any `org_member` | **HELD** → fixed | three routes were `Depends(require_user)` |
| F11 | Hardcoded role strings outside `role_tiers` | **HELD** → fixed, except `server.py` | `roles.py:74`, `roles.py:142,149`, `subscription.py:610`, `admin_orgs.py:678`, `:775` |
| F12 | `accept_invite` claims the invite non-atomically | **HELD** → open | `auth_router.py:153` checks, `:180` sets. Unique email is what actually stops the race |
| F13 | Invite tokens are guessable | **STALE** | `secrets.token_urlsafe(32)` = 256 bits; 7-day expiry enforced; re-invite expires the prior one. The defect was disclosure, not entropy |
| F14 | An org can grant itself an unbought module | **STALE** *(at the access layer)* | `middleware/subscription.py:180-194` checks `module_subscriptions` on every request, and `modules/activate` is platform-role-only. A grant row for an unbought module can still be **stored** and displayed — a data-integrity defect, not an access one |
| F15 | Cross-org billing is scoped from an endpoint parameter | **STALE** | all four `/admin/…` billing writes take `Depends(get_org_id)`, which validates `X-Org-Id` against the caller's own rows before returning it. `record_payment` derives the org from the invoice row and never trusts a caller-supplied org. A sibling reached the same conclusion independently in `frontend/src/pages/admin/orgScope.js` |
| — | "Every platform guard now reads from `role_tiers`" (commit 40124fb) | **STALE** | `server.py:50` is still `require_platform_role("platform_admin", "account_manager")` — omits `platform_owner` and `platform_manager`. Guards team delete/restore/purge. **Not mine; unowned** |

---

## 4. Where the design and the code contradict — and which is wrong

1. **`RBAC-SPEC.md` Tier 1 vs `role_tiers.py`.** The spec has four platform roles and says
   `account_manager` is "removed — it was a duplicate". `role_tiers` has seven and keeps
   `account_manager`. **`role_tiers` is right**: it is dated 2026-07-26, the spec 2026-07-25,
   and `role_tiers` knowingly supersedes it elsewhere (it overrides the spec's
   `DEFAULT_GRANT_LEVEL` of `admin` in as many words). The spec's Tier-1 table is stale.

2. **How many god-mode users.** `RBAC-SPEC.md:18` says "Exactly 3 users" and names them.
   `role_tiers.py:13` says "Four people", and `:21` "all four god-mode accounts". My brief
   says three. **The spec and the brief agree, so `role_tiers`' comment is wrong** — a
   comment, not code, but it is the sentence someone will count seats by. Owner of that
   file should correct it.

3. **Sensitive modules: granted, or role-derived?** `RBAC-SPEC.md:65` — Vetana, Ganit and
   Manav "have no per-member grant row at all… a grant row naming a sensitive module is
   invalid input and must be rejected". `role_tiers` treats them as grantable but withheld
   by default, and `level_satisfies` **requires** a grant row to carry `approver`.
   Both cannot be true. This is `_COORDINATION.md` §5's blocking contradiction; I am
   **not guessing**, and I did not build enforcement either way. It needs the owner.

4. **`11-platform-admin.md` "every platform endpoint needs an explicit org".** The
   product complaint is real — `/admin/billing` acts on the operator's own org while
   showing a cross-org overdue list. But the prescription would move org selection from a
   **validated header** to an **unvalidated path parameter**. If `/v1/admin/orgs/:orgId/…`
   is built, the membership check in `org_resolver.get_org_id:23-40` must be reproduced on
   it, or the fix is a regression. **The design is right about the gap and incomplete
   about the remedy.**

---

## 5. Not finished — handing over

1. **`POST /v1/org/invites` does not exist** (`08-rbac-screens.md` §4 specifies it:
   *email + role + initial grants*). This is the real hole behind F2: `org_members.add_member`
   refuses anyone without an account, and there is no public registration, so **an org admin
   cannot bring in a new person at all** — only Aekam can, through an org-blind platform
   route. Building it needs `org_id` (and grants) on `public.invites`, which has **no
   migration file** — the table predates `backend/migrations/`. That is a `PROPOSED_071`
   (per `_COORDINATION.md` §4, `071` is next free). I did not write it: the endpoint and
   the column should land together, and a migration with no caller is worse than neither.
2. **Invite tokens are stored in plaintext.** Closing F1 removed the reachable path, but
   at-rest hashing (`sha256`, look up by digest) is the defence in depth. Also needs
   `PROPOSED_071` and a dual-read window.
3. **F12 — atomic single-use.** One-line shape:
   `UPDATE invites SET accepted_at=NOW() WHERE token=$1 AND accepted_at IS NULL RETURNING *`.
   Left alone because `accept_invite` is the account-creation path and it is a sibling's
   file this run; the unique email constraint holds the line meanwhile.
4. **`server.py:50`** — the last hardcoded platform guard. Unowned. It is also the wrong
   *set*: team purge is irreversible and `role_tiers` puts irreversible platform actions in
   `SUPERUSER_ONLY_ROLES`. I left `server.py` alone — heavily contended, and outside admin/
   invites/subscriptions.
5. **`org_member_modules_level_is_meaningful` CHECK still lists `samvada`** — noted at
   `org_modules.py:102`. The org_modules agent owns it.
6. **Two `SENSITIVE_MODULES` definitions still disagree.** `role_tiers` = `{manav, vetana,
   ganit}`; `middleware/subscription.py:29` = `{vetana, ganit, manav, pahchan}`. Both are
   arguably intentional (default-grant withholding vs audit-on-access), but one name for
   two sets is a landmine. Not mine to unify.
7. **`add_on_modules` has no row for `vikray`, `prachar`, `varta`, `esign`.** I routed
   around it in code so activation works; the catalogue rows are still missing, so those
   modules carry no `requires_module` dependency data. Data fix, not code.
8. **Pricing-adjacent literals I did not remove**, flagged rather than changed because
   they alter API output: `admin_orgs.py` `r2_cost_per_gb = 0.015`, `margin = 1.20`,
   `"margin_pct": 20`, `DEFAULT_MARKUP_PCT`. These are cost and margin rates, not our plan
   prices. **`routers/subscription.py` is clean** — I checked every column of
   `staging.plans` (`price_monthly`, `price_annual`) and `add_on_modules`
   (`price_per_user_monthly`) against `list_plans`, which pops all three for non-staff;
   `staging.subscriptions` has no price column, so `GET /current` leaks none.

## 6. Confirmations for other agents

- `OUTBOUND_MODE` respected throughout; **no invite email was sent**. `create_invite`'s
  send is wrapped and `email_service` is guarded at the choke point in `outbound.py`.
- No migration written, no database write, `main` untouched, no lockfile committed.
- `test_ganit.py::test_create_invoice_success` fails identically on clean staging
  (`_COORDINATION.md` §8) — I verified this myself before making any change.
