# Backend data-exposure sweep — cross-cutting

Agent `a0e4d12c53e200673`. Branch `rescue/a0e4d12c53e200673`, rebased on `origin/staging`.
Scope: the whole backend, looking for the **class** of bug rather than the instance.
Where another agent owns a file I report rather than edit — except for an unambiguous
live leak, which I fix and flag.

**Method.** Route inventory built by parsing every `@router.<verb>("...")` decorator in
`backend/` and extracting the balanced `Depends(...)` list from each handler signature.
**650 routes; 42 with no auth dependency; 429 resolve an org, 23 of those with no module
gate behind them.** Scripts in the scratchpad (`routes.py`, `orgroutes.py`, `selectstar.py`).

> **Base warning.** This worktree's branch was cut from `origin/main`, not `staging` — 272
> commits behind, with no `design-handover/`, no `role_tiers.py`, and 30 of 40 routers
> missing. This matches `_COORDINATION.md` §1. Reset before any analysis; every line
> number below is against staging as rebased.

---

## Fixed — ranked by severity

### S1. Board list handed out private attachments with live signed R2 URLs
`backend/server.py` · `GET /api/tasks` · **fixed** (superseded on rebase by a sibling's
broader fix covering 4 sites; my regression tests kept)

`GET /api/tasks/{id}` had filtered private attachments since the drawer was written. The
board's list never did — it was the one task read that ran `_refresh_task_attachments`
with no `_filter_private_attachments` in front of it.

**Exposed to:** every member of the task's team, and — via the `task_clients` clause in
that endpoint's own `WHERE` — the **external client** on the task.

Reproduced against the unfixed code before fixing; the response body carried:

```
{"name": "salary-review.pdf",
 "url": "https://r2.example/FRESH?k=org/private.pdf",
 "key": "org/private.pdf", "is_private": true,
 "visible_to": ["user_owner001"]}
```

to a member who is not `user_owner001`. `visible_to` also discloses the firm's own access
list alongside the document. Per `_COORDINATION.md` §6 those URLs live **nine hours**
(`ExpiresIn=32400`), so "re-signed" means a working download link for anyone who ever
received it.

**The ordering half.** `sign_key` does not read a file, it **mints a capability** — the
URL works for anyone holding it until it expires, with no further authorisation. So the
filter must run *before* the signing, and `test_attachment_privacy.py` asserts `sign_key`
was never **called** for a hidden key rather than that the URL is merely absent from the
body. `_fetch_enriched_task` was minting-then-dropping and now filters first.

### S2. API-docs gate still fail-open on the *spelling* of production
`backend/server.py:169-190` · **fixed** · `tests/test_docs_gate.py` (56 cases)

The previous fix (`a7ce481`) closed the empty-variable case and left the denylist behind
it: `_ENVIRONMENT != "production"` has exactly one entry, so every value that is not that
precise ten-character lowercase string turned `/openapi.json`, `/docs` and `/redoc` back
on for anonymous visitors. Measured against the code as it stood:

| `ENVIRONMENT` | before | after |
|---|---|---|
| `production` | off | off |
| `Production` | **ON** | off |
| `PRODUCTION` | **ON** | off |
| `prod` | **ON** | off |
| `main` | **ON** | off |
| `live` | **ON** | off |
| `release` | **ON** | off |
| `pre-production` | **ON** | off |
| `production-eu` | **ON** | off |
| `staging` | ON | ON |

`Production` is not a hypothetical typo: `RAILWAY_ENVIRONMENT` carries whatever the
environment was **named** in the dashboard, and that name is free text. Now an
**allowlist** — served only for a recognised non-production name, so anything
unrecognised is treated as production.

### S3. Four zero-reach platform roles could read every org
`middleware/roles.py`, `middleware/org_resolver.py` · **fixed** ·
`tests/test_platform_role_reach.py` · *(both flagged unowned in `_COORDINATION.md` §6)*

`role_tiers.modules_for()` returns an **empty set** for `account_manager`,
`account_finance`, `srijan_admin` and `platform_support`, so `require_module` refuses all
four every module in every org. Two other gates kept their own copy of the list and
disagreed.

**(a) Cross-tenant read.** `is_org_admin` carried the eight-name list as a SQL literal,
written out twice, both copies including all four:

```
get_visible_team_ids(uid)        server.py:347
  -> is_org_admin(uid)           True for all eight
  -> admin_org_id(uid)           None: platform holders have no org row
  -> SELECT team_id FROM teams   EVERY TEAM IN EVERY ORG
```

So a commercial or support role read every task on the platform through `GET /api/tasks`
and everything else keyed on `get_visible_team_ids`, while `require_module` refused it
every single module.

**(b) Upstream of every route guard.** `get_org_id` accepted `ALL_PLATFORM_ROLES` for the
`X-Org-Id` header, so the same four could name **any** org in a request header. This runs
before every route guard, and **23 routes take `get_org_id` with no module gate behind
it** — on those, the header *was* the authorisation check. `platform_support` is the
sharpest case: `role_tiers.py:40-43` says its session table does not exist yet so it
"currently gets nothing", while this line handed it every org by name.

The 23: `org_members` (5), `org_modules` (2), `org_profile` (2), `org_security` (2),
`search` (1), `subscription` (9), `tasks_bulk` (2). Most carry `require_org_role`, which
independently refuses these roles; `tasks_bulk` relies on `get_visible_team_ids`, which
(a) had already widened to every team.

**(c) God-mode lockout.** `require_org_role` hardcoded `role_code = 'platform_admin'`,
excluding `platform_owner` — the same god mode under its current name, the exact lockout
`role_tiers.py:115-121` warns about. Invisible only because all four god-mode accounts
still carry the legacy row; a total lockout of all four the day those rows are renamed.

Now one home: **`DATA_REACH_PLATFORM_ROLES`** = GOD_MODE + MANAGER + STAFF, i.e. exactly
the roles `modules_for()` gives a non-empty set. The test pins the *invariant* — every
platform code must agree between module reach and data reach — so a role added to the
enum later cannot inherit either by omission.

### S4. WhatsApp webhook was unauthenticated when its secret was unset
`routers/whatsapp.py:322` · **fixed** · `tests/test_whatsapp_security.py`

`if app_secret:` skipped HMAC verification **entirely** when `META_APP_SECRET` was unset
or set-but-empty — the one state where nothing else checks the caller. This route is
unauthenticated by design and it **writes**: it creates rows in `varta_contacts` and
`varta_conversations` for whichever org owns the `phone_number_id` in the body. Anyone
who could read or guess a `phone_number_id` could inject messages into that org's inbox
and invent contacts in it. Now fails closed (503), matching `scheduler._verify_cron`.

**A test asserted the old behaviour as correct** — *"Should succeed — the code skips
signature verification when secret is empty"*. That test pinned the vulnerability; it is
inverted, with the reason written down.

### S5. Customer phone numbers and message bodies written to the application log
`routers/whatsapp.py:336` · **fixed**

`log.info("WhatsApp webhook: %s", json.dumps(payload)[:500])` wrote the customer's phone
number and the text they sent into the application log, where both outlive the retention
policy governing the conversation itself. Now structure only, pinned by a test that fails
if either appears in `caplog`. Note `utils.log_safe` is **control-character stripping
only** (CWE-117) — it is not PII redaction, and nothing else is.

### S6. Shared cron/dispatch secrets: non-constant-time, and in the URL
`reports.py`, `task_reminders.py`, `scheduler.py`, `esign.py` · **fixed** ·
`tests/test_dispatch_secrets.py`

All compared with `==` / `!=`. On a `str` that short-circuits at the first differing byte,
so time-to-fail is a function of how many leading bytes were right — and a cron endpoint
can be called as often as an attacker likes. Now `utils.secret_matches`
(`hmac.compare_digest`, and refuses when either side is empty so an unset variable can
never be satisfied by an omitted parameter — both being `""` compare **equal** under `==`).

Two took the secret as **`?request_secret=`**. A secret in a query string is written to
every access log, proxy log and platform request log the request passes through, and
those outlive and out-scope the secret. Both now accept `X-Dispatch-Secret` and prefer it;
the query form still works so a configured cron does not break on deploy.

`esign.py:424` compared a 6-digit OTP with `!=` while `services/esign_service.py:140` —
the Ganit signing path, same OTP, same length — already used `compare_digest`. Fixed, and
the entered guess is no longer written into the audit row.

---

## Open — reported, not fixed

### O1. `update_task` will delete files the caller was not allowed to see — HIGH
`server.py` · `PUT /api/tasks/{id}`

`update_task` **replaces** `tasks.attachments` with whatever the caller echoes back
(merging only `size` and the uploader fields by `key`). `GET /api/tasks/{id}` filters
private attachments, and `TaskDrawer.jsx:143` populates its state from exactly that
endpoint, then re-sends the list on every save (`:412`, `:424`, `:432`).

So a member who opens a task carrying a private attachment they cannot see, and changes
anything at all, **silently deletes that attachment** from the task. This is a live
data-destruction path that exists today, independent of any fix in this run.

It is also why the three write paths (`create_task`, `update_task`, `move_task`)
deliberately still return **unfiltered** attachment lists — narrowing them before this is
fixed would make the deletion certain instead of conditional. **The two must be fixed
together:** scope the write to "prior attachments the caller could not see are preserved",
then narrow the responses. Needs whoever owns `server.py` + `TaskDrawer.jsx`.

### O2. `org_settings` is a single global table with no tenant column — MEDIUM
`server.py:1121-1156`, table defined at `server.py:2994`

```sql
CREATE TABLE IF NOT EXISTS org_settings (key TEXT PRIMARY KEY, value JSONB ...)
```

`key` is the **entire** primary key. There is no `org_id` or `team_id`. So:

- `GET /api/settings` returns the same brand kit to every authenticated user on the
  platform — including `role='client'`, despite the docstring saying "readable by all
  non-client users".
- `PUT /api/settings` lets anyone whose legacy `users.role` is `admin`/`owner` overwrite
  the brand colours and fonts **for every org on the platform**.

Cross-tenant write. Low data sensitivity (colours and font names), but it is a genuine
tenancy hole and the guard is the legacy `users.role` column rather than `user_roles`.
`teams.brand_settings` (`server.py:2999`) is the per-tenant version that already exists,
so `org_settings` looks like dead legacy — confirm and drop the endpoints rather than
adding a column.

### O3. eSign OTP attempt limiting is in-process and does not survive a restart — MEDIUM
`routers/esign.py:412-422`

The attempt counter is a dict on the function object (`verify_otp._attempts`). It is:

- **lost on every restart or redeploy** — the counter resets to zero;
- **not shared across workers or replicas** — with N workers the effective limit is 5N;
- **never evicted** — entries accumulate for the process lifetime.

A 6-digit OTP is a 10^6 space; durable attempt limiting is the only thing standing between
that and a signed document. `services/esign_service.py:19,101,131` does this correctly with
a database column (`otp_attempts` on `ganit_contract_signers`) — the right pattern already
exists in the codebase, and `sign_signers` needs the same column.

**Needs a migration, so I did not do it** (standing rule: never write to the DB, never run
a migration; staging and production share one Supabase project). Take the next free
`PROPOSED_0NN` per `_COORDINATION.md` §4.

### O4. `POST /api/auth/reset-password` has no rate limit — LOW
`auth_router.py:284`

`accept-invite` is `10/minute`, `login` `5/minute`, `forgot-password` `3/minute`.
`reset-password` has no decorator. The token is `secrets.token_urlsafe(32)` so brute force
is not realistic, and the global write limiter (120/min/IP) still applies — but it is the
one auth route outside the pattern and should join it.

### O5. `GET /api/client/projects` returns `SELECT t.*` from `teams` — LOW/MEDIUM
`server.py:1012-1029`

`return [dict(r) for r in rows]` over `SELECT DISTINCT ON (t.team_id) t.*`, so clients
receive `org_id`, `owner_id`, `created_by`, `deleted_at`, `deleted_by`, `color` and
`brand_settings`. `19-client-portal.md`'s never-see list names internal identifiers, and
the sibling models right above it (`ClientTaskOut`, `ClientApprovalOut`,
`ClientAttachmentOut`) are careful allow-lists. This endpoint never got one. Owned by
whoever holds the client portal.

### O6. `SELECT *` reaching a raw `dict()` response — 40 handlers — INFORMATIONAL

Full list produced by `selectstar.py`. I checked the ones whose tables hold secrets and
they are clean:

- `hub_social_accounts.access_token` / `refresh_token` — `list_social_accounts`
  (`hub_publish.py:415`) selects an explicit column list; only `social_publisher.py:44`
  does `SELECT *` and it is an internal service, not a response.
- `organisations.r2_secret_access_key` — read only by `services/storage.py:56`; never in
  a response.

The rest are same-org reads where the over-return is field noise rather than disclosure.
Worth a sweep, not urgent. The structural point: **an allow-list response model is the
only thing that makes a new column safe by default**, and outside the client-portal models
almost nothing has one.

### O7. Approval magic-link reads are not revocable — LOW
`approvals_router.py:476`

`get_approval_by_token` decodes the JWT and returns the task without re-checking
`task_clients`. `approve_by_token` and `reject_by_token` both do re-check
(`:511`, `:582`) — correct. So a client removed from a task can still **read** it via an
old emailed link until the token expires, though they can no longer act on it. Cheap to
close: add the same `task_clients` check to the read.

---

## Justified — the 42 unauthenticated routes

| Cluster | Count | Why it is acceptable |
|---|---|---|
| `auth/*` — login, logout, accept-invite, forgot/reset-password | 5 | Necessarily anonymous. Rate-limited except reset-password (**O4**). |
| `health`, `/api/`, `verse-of-the-day` | 3 | No data. |
| `approvals/by-token/*` | 3 | Signed JWT capability, `type` claim checked; writes re-verify `task_clients` at decision time. Read does not (**O7**). |
| `esign/verify/{token}/*` | 5 | `secrets.token_hex(32)` = 256-bit token + emailed OTP. Attempt limiting is weak (**O3**). |
| `ganit/sign/{token}/*` | 4 | `secrets.token_urlsafe` + OTP with a durable DB attempt counter. Correct. |
| `internal/cron/*` | 12 | `X-Cron-Secret`, fails closed when unset, now constant-time (**S6**). |
| `reports/dispatch`, `task-reminders/dispatch` | 2 | Shared secret or platform-staff JWT (**S6**). |
| `whatsapp/webhook` GET + POST | 2 | Meta calls these. GET matches a per-org verify token; POST now requires a valid HMAC (**S4**). |
| `graha/inbound-leads`, `graha/f/{slug}` | 2 | Public lead capture — intentionally anonymous ingest. |
| `hub/oauth/{platform}/callback` | 1 | OAuth redirect; state is validated and popped. |
| `hub/publish/dispatch` | 1 | **Verify.** Not covered by my passes — flagging for whoever owns `hub_publish.py`. |

**Enumeration (§4).** No sequential or guessable identifier reached another party's object
on the routes I checked. Public tokens are 256-bit `secrets` values; internal ids are
`uuid4` or `f"{prefix}_{uuid4().hex[:12]}"`. The 6-digit OTPs are the only small space and
are guarded by attempt limits — durable in Ganit, weak in eSign (**O3**).

---

## Process finding — `git stash` is shared across worktrees, and it bit me

`refs/stash` lives in the **common** git directory, so with 20+ agents in worktrees of one
repo the stash is a **single shared stack**. I ran `git stash` → ran tests → `git stash
pop`, and got back **another agent's** in-flight `invite_router.py` privilege-escalation
work, because they had pushed onto the stack in between. `stash@{0}`'s label named *my*
branch while containing a third agent's `server.py` + `DrawerAttachments.jsx`.

I backed the foreign patch up and re-stashed it with a labelled message so its owner's
`pop` recovers it; a copy is in the scratchpad as `RECOVERED-invite_router.patch`. No work
was lost, but it was luck that I read the diff before discarding it.

**Recommendation for the fleet: never use `git stash` in a shared-repo worktree.** Commit
to your own branch, or copy files aside. Worth adding to `_COORDINATION.md`.

---

## Commits

| SHA | What |
|---|---|
| `999897c` | sweep scaffold + route inventory |
| `5cae16c` | S1 — attachment privacy regression tests (server.py fix superseded by sibling on rebase) |
| `a134e2e` | S2 — docs gate allowlist + 56 cases |
| `4209804` | S3 — `DATA_REACH_PLATFORM_ROLES`; org_resolver, is_org_admin, require_org_role |
| `28a78b3` | S4/S5/S6 — webhook fail-closed, PII log, constant-time secrets, header form |

Gates green from `frontend/`: `check-tokens` 0 missing, `check-classes` 0 missing.
Backend suite 492 passed, 1 failed — `test_ganit.py::test_create_invoice_success`, the
pre-existing failure confirmed in `_COORDINATION.md` §8.
