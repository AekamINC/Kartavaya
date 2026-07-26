# Backend — admin, invites, subscriptions

Branch: `agent/backend-admin-invites-subs`
Base: `origin/staging` @ `666b0ea`
Scope: `backend/invite_router.py`, `backend/auth_router.py` (accept-invite only),
`backend/routers/admin_orgs.py`, `backend/routers/subscription.py`,
`backend/routers/org_members.py`, `backend/middleware/{roles,org_resolver,subscription}.py`.
Explicitly NOT edited: `role_tiers.py`, `org_modules.py`, `org_profile.py`,
`org_security.py`, `manav.py`, `vetana.py`, `graha.py`, `me.py`, approvals,
messaging, ganit/vikray/prachar/dristi.

> **Worktree note.** The worktree I was handed (`worktree-agent-a2c335d7df9bad5be`)
> was 272 commits behind `origin/staging` and carried 13 unrelated commits about R2
> attachments. I did not rebase or discard them — I branched fresh from
> `origin/staging`. That branch ref is untouched and still points at those commits.

---

## Status

IN PROGRESS — this file is updated as work lands. See "Not finished" at the bottom.

---

## 1. Findings, each marked HELD or STALE

Legend: **HELD** = I reproduced it in the code on `origin/staging` today.
**STALE** = a claim from a prior report that is no longer true.

### F1 — HELD (critical) — `GET /api/admin/invites` returns every raw invite token

`backend/invite_router.py:341-366`. The query selects `i.token` and the response
builds `invite_link=f"{FRONTEND_URL}/accept-invite?token={r['token']}"` for **every
invite in the system, every org, 100 at a time**, to anyone holding
`CONSOLE_ROLES` — which includes `platform_staff` and `account_manager`.

`POST /api/auth/accept-invite` (`backend/auth_router.py:147`) accepts a bare token
with no other proof: `SELECT * FROM invites WHERE token=$1`. So any console-role
holder can read a pending invite's token and redeem it themselves, choosing their
own password, and land in the account that was meant for someone else. Tokens are
stored in plaintext, so a read of the `invites` table (backup, log, support query)
is equivalent to a set of live credentials.

Entropy of the token itself is fine (`secrets.token_urlsafe(32)`, 256 bits) — it
cannot be guessed. It does not need to be: it is served.

### F2 — HELD (critical) — the platform invite path has no organisation at all

`POST /api/admin/invites` (`invite_router.py:274`) takes `email`, `role`
(`admin|member|client`) and nothing else. No `org_id`, no seat check, no check of
the inviter's own level. `accept_invite` then creates a `users` row and **never
writes a `staging.user_roles` row**. So:

* an invite cannot place someone in an org — which is the only way to get access,
  since `org_members.add_member` refuses anyone without an existing account and
  there is no public registration;
* the seat cap cannot be applied on this path, because the path has no org;
* `role` on this path is the legacy `users.role` column, which
  `auth_router.require_admin` still reads.

Consequence: a `platform_staff` (operating set — CRM, marketing, Srijan) can mint
an account at legacy `admin`. See F3.

### F3 — HELD (high) — invite role is unbounded by the inviter's own role

`create_invite` validates `body.role in ("admin","member","client")` and stops.
There is no comparison against the caller. Same in `PUT /api/admin/users/{id}/role`
(`invite_router.py:130`) and `PATCH /api/admin/users/{id}` (`:94`), both of which
will set any user to `admin` — including a god-mode account's row — for any
`CONSOLE_ROLES` caller.

### F4 — HELD (high) — seat limit enforced on one of the two add-member paths

* `POST /api/v1/org/members` (`org_members.py:160-180`) **does** enforce it,
  server-side, with `COALESCE(o.max_users, p.max_users)` and a live
  `COUNT(DISTINCT user_id)`. Good.
* `POST /api/v1/admin/orgs/{org_id}/members` (`admin_orgs.py:621`) **does not**.
  Platform console adds are uncapped.

So the cap is real but bypassable by the console that is most likely to be used to
add people. Prior claim "seat limits are display-only" is **STALE** for the org
path and **HELD** for the platform path.

### F5 — HELD (high) — `sanvaad` / `samvada` never string-matches

Hard evidence, three layers:

| Layer | File | Spelling |
|---|---|---|
| seed of `add_on_modules` | `backend/migrations/010_staging_schema_subscription.sql:147` | `sanvaad` |
| `module_subscriptions` rows written by `POST /v1/subscription/modules/activate` | `routers/subscription.py:211-233` (validates against `add_on_modules`) | `sanvaad` |
| the gate that reads them | `routers/messaging.py:21` → `require_module("samvada")` → `middleware/subscription.py:180` | `samvada` |
| grant vocabulary | `middleware/role_tiers.py:63` `ALL_MODULES` | `samvada` |

`require_module("samvada")` queries
`module_subscriptions WHERE module_code='samvada'`, which no org will ever have,
because the only endpoint that writes that table validates the code against
`add_on_modules`, where the row is `sanvaad`. **Messaging is 403 for every org that
has paid for it.** Not a privilege escalation — a total denial. Owner of the fix is
the `role_tiers.py` / `org_modules.py` agent; `PROPOSED_069_sanvaad_spelling.sql`
already exists on another branch, so the migration side is claimed. I have not
touched either file.

Second-order: the same seed row is described as "WhatsApp Business API integration,
templates, broadcasts" — that is `varta`'s description attached to `sanvaad`'s code.
Whoever fixes the spelling should look at that too.

### F6 — HELD (high) — the platform console cannot reach four modules

`admin_orgs.py:812` retypes `ALL_MODULES` as an eight-item **list**:
`graha, ganit, manav, vikray, vetana, dristi, prachar, srijan`. `role_tiers`
holds twelve. Missing: `esign`, `varta`, `pahchan`, `samvada`/`sanvaad`.

`POST/DELETE /{org_id}/modules/{module_code}` and
`PUT /{org_id}/members/{uid}/modules` all 400 on those four. This is the same
defect `org_members.py` already fixed for the org console (its header comment says
so) — it was fixed in one file and left in the other. Exactly the failure
`role_tiers.py` was created to end.

### F7 — HELD (high) — `platform_support` is not gated by anything server-side

`role_tiers.py:40-43` states the role "grants nothing" because
`platform_support_sessions` does not exist. That is **not what the code does**:

* `middleware/org_resolver.py:33-40` — the `X-Org-Id` bypass tests membership
  against `ALL_PLATFORM_ROLES`, **which includes `platform_support`**. A support
  holder can set the header to any org UUID and receive that org's context.
* `middleware/roles.py:95-111` `is_platform_staff()` — same set, returns True.
  Its call sites are templates, views, time entries, activity.
* `middleware/roles.py:114-144` `is_org_admin()` — the literal role list includes
  `platform_support`, so it returns True for **every** org.

What does hold: `require_module` refuses it, because
`modules_for('platform_support')` is empty (`role_tiers.py:94-98`) — so no module
router admits it. And `CONSOLE_ROLES` in both `admin_orgs.py` and `invite_router.py`
excludes it.

**Verdict on the task question — "verify that gate is real and server-side": it is
not. There is no approval gate. There is an absence of module reach, which is a
different thing, and three helpers leak around it.** The docstring claim is
**STALE**.

### F8 — HELD (medium) — credit top-up is reachable by `platform_staff`

`POST /api/v1/admin/orgs/{org_id}/credits/topup` (`admin_orgs.py:1251`) is guarded
by `CONSOLE_ROLES`, which includes `platform_staff`. `role_tiers.py:162-164` names
`SRIJAN_COMMERCIAL_ROLES` and says in as many words that it exists because
"authoring a skill and topping up a client's credit balance are both Srijan, but
only one of them spends." The guard set was written and then not used at the one
call site it was written for.

### F9 — HELD (medium) — commercial terms editable by the operating role

`PATCH /api/v1/admin/orgs/{org_id}/settings` (`admin_orgs.py:564`) writes
`markup_pct`, `monthly_credits` and `monthly_price` under `CONSOLE_ROLES`.
`platform_staff` can rewrite an org's commercial terms. `BILLING_CONSOLE_ROLES`
exists for this.

`POST /api/v1/admin/orgs` (`create_org`, `:85`) is likewise `CONSOLE_ROLES` and sets
`max_users`, `monthly_price`, `markup_pct` **and writes R2 credentials**.
`role_tiers.py:138-141` puts "writing storage credentials" in
`SUPERUSER_ONLY_ROLES` — and `PUT /{org_id}/r2` correctly uses it. `create_org`
takes the same secret through a side door under a much wider guard.

### F10 — HELD (medium) — org money is readable by any org member

`GET /api/v1/subscription/invoices` (`subscription.py:375`) and
`/cost-report`, `/cost-report/pdf` (`:423`, `:497`) are `Depends(require_user)` +
`get_org_id`. Any `org_member` — no billing grant, no module grant — reads the
org's full invoice history with totals, its credit consumption, and a PDF carrying
the authorised signatory's name and designation.

### F11 — HELD (low, but it is a lockout waiting to happen) — hardcoded role strings outside `role_tiers`

* `middleware/roles.py:74` — `require_org_role` tests `role_code = 'platform_admin'`.
  `platform_owner` is **not** admitted. This is verbatim the failure mode
  `role_tiers.py:115-121` warns about, still live in the shared middleware.
* `routers/subscription.py:610` — `"is_platform_admin": "platform_admin" in platform_roles`.
  Returns `False` for a `platform_owner`; the frontend gates on it.
* `admin_orgs.py:678` — `SENSITIVE = {"vetana","ganit","manav"}`, a third
  definition of a set `role_tiers` exports as `SENSITIVE_MODULES`.
* `admin_orgs.py:775` — `platform_roles = set(ALL_PLATFORM_ROLES) | {"developer"}`.
  `developer` is a role code that exists nowhere in `role_tiers`; it is assignable
  and then means nothing.

### F12 — HELD (low) — `accept_invite` claims the invite non-atomically

`auth_router.py:153` checks `accepted_at IS NULL`, then inserts the user, then
`UPDATE invites SET accepted_at=NOW()` at `:180`. Two concurrent redemptions both
pass the check. The `users.email` unique constraint is what actually stops the
second one, which is a database accident rather than a single-use rule. Should be
one atomic claim: `UPDATE ... WHERE token=$1 AND accepted_at IS NULL RETURNING *`.

### F13 — STALE — "invite tokens are guessable"

Not true. `secrets.token_urlsafe(32)` = 256 bits from the OS CSPRNG
(`invite_router.py:289`). Expiry is 7 days and is enforced
(`auth_router.py:156`). Re-inviting the same address expires the previous pending
invite (`invite_router.py:284`). The weakness is disclosure (F1), not entropy.

### F14 — STALE — "an org can grant itself a module it has not bought"

At the **access** layer this does not hold. `middleware/subscription.py:180-194`
checks `module_subscriptions` on every request, after the per-user grant check, and
`POST /v1/subscription/modules/activate` is `require_platform_role(*BILLING_CONSOLE_ROLES)`
— org roles cannot reach it. An `org_admin` who writes themselves a grant row for an
unbought module still gets 403 at the gate.

What **is** true, and is a data-integrity rather than an access defect:
`org_members.set_member_modules` / `add_member` validate the module code against
`ALL_MODULES` but never against the org's `module_subscriptions`, so grants for
unbought modules can be stored and are then displayed to the customer as if they
were live.

### F15 — STALE — "cross-org billing is scoped from an endpoint parameter"

The four `/admin/...` billing writes (`set-plan`, `modules/activate`,
`modules/deactivate`, `invoices`) take their org from `Depends(get_org_id)`, not
from a path parameter, and `get_org_id` validates the `X-Org-Id` header against the
caller's own rows before returning it (`org_resolver.py:23-40`).
`record_payment` takes an `invoice_id` and derives the org from the invoice row —
it never trusts a caller-supplied org. All are `require_platform_role`, i.e.
`org_id IS NULL` rows only, so no org-scoped role reaches any of them.

The genuine cross-org gap is different and is F7: the header bypass in
`get_org_id` admits `platform_support`.

---

## 2. Reachability table

To be filled in as fixes land.

---

## 3. Not finished

To be filled in.
