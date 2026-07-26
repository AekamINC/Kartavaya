# Review — `feat/me-account-self-service` (commit 4f15485)

Reviewer branch: `review/me-account-self-service`
Base: `origin/staging` @ 2a2a27b. The feature branch was exactly one commit ahead
of staging, so the review surface is precisely the 920 insertions.

Status legend: **CONFIRMED** = re-read and verified in this worktree.
**STALE** = claimed somewhere but not true of the current tree.

---

## 1. What "the session claim we cannot make" means

It is not a hedge or an apology for sloppy work. It is a precise, and
**CONFIRMED-accurate**, statement that session revocation cannot be implemented
from this router:

* `auth_router._create_token` (backend/auth_router.py:47-52) mints
  `{"sub", "exp", "iat"}` — **no `jti`, no server-side session record.**
* `_decode_token` (backend/auth_router.py:71-77) verifies signature and expiry
  only; `require_user` then asks the DB only "does this user still exist".
* Therefore the set of live tokens for a user is **not knowable**, and no token
  can be invalidated before it expires. Logging out, changing the password —
  neither kills an issued token.

The frontend's Customize → Data screen has a "sign out everywhere" control. The
author's position was that wiring it to anything would be a lie, so
`GET /api/v1/me/sessions` returns `revocation.supported: false` plus a
machine-readable reason, and labels push registrations as *devices*, never as
*sessions*. **I agree with this call.** A dead "sign out everywhere" button is
strictly worse than an absent one, because the user believes they have used it.

### The 7-day claim checks out
me.py tells the user "Every token stops working within 7 days of being issued"
and returns `token_lifetime_days: 7`. **CONFIRMED**: `JWT_TTL_DAYS = 7`
(backend/auth_router.py:34), used for both `exp` and the cookie `max_age`.

Note a **STALE docstring next door**, pre-existing and not from this branch:
`_create_token`'s own docstring says "30-day expiry" (backend/auth_router.py:48)
while the constant is 7. me.py is right; the docstring it sits beside is wrong.

### Password reset really does have the hole described
**CONFIRMED.** Reset mints a new JWT and every previously-issued token for that
account keeps working for up to 7 days. A stolen token survives the password
change made *because* it was stolen. That is a pre-existing auth defect, out of
scope for this branch, and PROPOSED_067 Part B is the schema half of its fix.

---

## 2. Endpoint-by-endpoint audit of `backend/routers/me.py`

All six routes are on `APIRouter(prefix="/api/v1/me")` and every one depends on
`require_user`. **No route accepts a user id from a path, query or body.**

| # | Route | Guard | Returns | Cross-user reachable? |
|---|-------|-------|---------|----------------------|
| 1 | `GET /sessions` | `require_user` | Caller's own decoded token, own push registrations, `revocation.supported:false` | **No** — both reads are `WHERE user_id=$1` from the token |
| 2 | `POST /devices/deregister` | `require_user` | `{removed: bool}` | **No** — `DELETE ... AND user_id=$2` in the same statement |
| 3 | `POST /export` | `require_user` + `@limiter.limit("3/hour")` | Queued request record | **No** — `WHERE user_id=$1` |
| 4 | `POST /delete` | `require_user` + `@limiter.limit("3/hour")` + `GOD_MODE_ROLES` last-admin check | Deletion request + `scheduled_for` | **No** — `WHERE user_id=$1` |
| 5 | `DELETE /delete` | `require_user` | `{cancelled: true}` | **No** — `WHERE user_id=$1 AND status='pending'` |
| 6 | `GET /requests` | `require_user` | Caller's own request history, LIMIT 50 | **No** — `WHERE user_id=$1` |

### Role guards — CONFIRMED CLEAN
No hardcoded role strings anywhere in me.py. The one role check
(last-god-mode-holder, route 4) imports `GOD_MODE_ROLES` from
`backend/middleware/role_tiers.py` (`("platform_owner", "platform_admin")`) and
passes it as a parameter, not interpolated. It also **fails closed**: if the
role query itself errors, the request is refused with 503 rather than allowed.

Beyond authentication, no *additional* role tier is appropriate here — these are
per-caller records that every authenticated user may act on for themselves. A
tier guard on `/me/*` would be wrong, not missing.

### Multi-tenancy — CONFIRMED CLEAN
Project convention is that `user_roles` is the sole tenant path. me.py's only
`user_roles` read is the god-mode count, correctly filtered to `org_id IS NULL`
(the platform tier). The remaining queries are per-user rows (`push_tokens`,
`push_web_subscriptions`, `account_requests`) which carry no `org_id` and are
keyed by the caller's own id. **There is no org boundary to cross here and no
query that could be coaxed across one.**

One deliberate information exposure, judged acceptable: route 4's
`SELECT COUNT(DISTINCT user_id) ... WHERE user_id <> $2` reads across all users
but returns only a boolean-ish count used to refuse. It tells the caller "am I
the last admin", which the caller is entitled to know and cannot act on.

### `staging.` schema prefix — CONFIRMED CORRECT, not a defect
me.py mixes prefixed (`staging.user_roles`, `staging.account_requests`) and
unprefixed (`push_tokens`, `push_web_subscriptions`) names. This looked wrong
and is not: `db.py:44` issues `SET search_path TO staging, public`, and explicit
`staging.` prefixing is the established convention in 20 other routers.

---

## 3. Findings

### FINDING 1 — the entire branch was dead code. **CONFIRMED. FIXED.**
**Severity: high (renders the whole branch inert).**

`backend/routers/me.py` was **never imported and never registered** in
`backend/server.py`. Verified by grep across the whole backend: the only
references to `routers.me` or `/api/v1/me` anywhere were inside me.py itself and
its own migration. All 510 lines were unreachable; all six endpoints would have
returned 404, not 401.

This also **falsifies one line of the commit message**, which claims as a gate
"six endpoints 401 unauthenticated". Against the app as committed they 404. That
gate must have been run against a locally-mounted router, not the real app.

Fixed: added the import and `app.include_router(me_router)` in server.py.
Verified no path collision — the pre-existing `/me/*` routes live on
`api_router` (prefix `/api`, so `/api/me/...`), distinct from `/api/v1/me/...`.

### FINDING 2 — `POST /api/push/unsubscribe` lets any user silence any other user's notifications. **CONFIRMED (pre-existing, not from this branch).**
**Severity: high — horizontal privilege escalation, cross-user modification.**

me.py's docstring reports this and I re-read it rather than trusting it:

* `backend/server.py:2745` — `unsubscribe_push` takes an `endpoint` from the
  request body and calls `wp_remove_subscription(pool, endpoint)`.
* `backend/services/web_push_service.py:51` —
  `DELETE FROM push_web_subscriptions WHERE endpoint=$1`, **no `user_id`**.

Any authenticated user who supplies another user's push endpoint deletes that
user's subscription and silently stops their browser notifications. The victim
gets no error; their notifications simply stop. Endpoints are long random URLs
so this is not trivially guessable, but it is a genuine authorization defect and
the fix is one clause.

### FINDING 3 — the test suite runs with outbound sending ENABLED. **CONFIRMED. FIXED.**
**Severity: high — this is the guarantee that stops tests sending real pushes.**

`backend/outbound.py:34` reads `MODE = os.getenv("OUTBOUND_MODE", "live")`
**once at import time**, and `backend/tests/conftest.py` set `JWT_SECRET`,
`REPORT_DISPATCH_SECRET` and `DATABASE_URL` but **not `OUTBOUND_MODE`**.

So for the entire test run `DRY_RUN` was `False` and `suppressed()` returned
`False` for every channel. The only thing preventing `send_push` from making a
real HTTPS POST to Expo's production API was that the shared `MagicMock` pool
happens to return `[]` for `pool.fetch`. A single test whose mock returns one
row with a token starting `ExponentPushToken[` would have sent a real push.

The task brief asked me to verify no code path can send a real push during
tests. As found, **that did not hold** — it was true only by accident of mock
defaults. Fixed in conftest.py with a forced (not `setdefault`) assignment,
placed above the app imports so it lands before `outbound` is imported.

---

### FINDING 4 — the notification prefs PUT resets quiet hours it was never asked to touch. **CONFIRMED. FIXED.**
**Severity: medium — silent data loss, reported as success.**

`PUT /api/me/notification_prefs` (backend/server.py) read
`body.get("quiet_start", "22:00")`. A field the client OMITS therefore did not
mean "leave it alone", it meant "reset it to the default". A client sending only
`{"prefs": {...}}` to flip one switch silently overwrote a user's customised
overnight window with 22:00–07:00 and returned `{"ok": true}`.

The same endpoint stored `body["prefs"]` **verbatim into jsonb** — any key, any
value, any depth. That is how a mode becomes the string `"Off"` or a nested
object, after which every read has to guess.

`normalise_prefs()` and `normalise_window()` were added to push_service.py by
this branch **for exactly this endpoint and then never called from anywhere** —
dead code, like the router. Both are now wired in, and `current` is passed so an
omitted field means unchanged.

### FINDING 5 — two copies of the notification vocabulary, already drifted. **CONFIRMED. FIXED.**
`server.py` carried its own `DEFAULT_PREFS` dict duplicating push_service's. The
branch added a `reminder` kind to push_service's copy only, so that kind was
**enforced on delivery and invisible in the UI** — the GET merges against
server.py's copy. server.py now imports the one definition.

### FINDING 6 — the double-click race returns 500. **CONFIRMED. FIXED.**
PROPOSED_067 puts a partial unique index on `(user_id, kind) WHERE status IN
('pending','processing')`. me.py's read-then-insert is not atomic, so two rapid
clicks both see no open request and both insert. The index correctly rejects the
second; me.py's handler only special-cased `UndefinedTableError`, so the loser
got a 500 for doing the thing the docstring calls safe. Now returns
`already_open: true`.

### FINDING 7 — the test suite shared one rate-limit budget. **CONFIRMED. FIXED.**
**Severity: medium — makes the whole suite order- and clock-dependent.**

`server.global_write_rate_limit` counts every POST/PUT/PATCH/DELETE per client
IP in a module-level dict, **120 per wall-clock minute**, and nothing reset it
between tests. Under `ASGITransport` every test shares one IP, so the entire
suite drew on a single budget.

This is not theoretical — it bit immediately. Adding my tests pushed the run past
120 writes in a minute and **two entirely unrelated WhatsApp tests started
failing with 429**, pointing at a file I had not touched. Anyone adding tests
anywhere would have hit this and lost time chasing the wrong module.

Fixed with an autouse conftest fixture clearing both limiters per test. No test
asserts 429, so nothing depended on the leaked state.

---

## 4 · `push_service.py` — outbound safety (task item 3)

**Verified by reading every path, then by test.**

* `send_push()` calls `suppressed("push", ...)` as its **first statement**,
  before any DB read and before any HTTP client is constructed. Confirmed by
  `test_send_push_short_circuits_before_any_query`, which asserts zero awaits on
  the pool under dry mode.
* `send_web_push()` and `fan_out_web_push()` are gated the same way
  (`suppressed("push:web", ...)`).
* `fan_out_push()` delegates to `send_push` per recipient, so it inherits the
  gate rather than needing its own.
* The branch's changes to `send_push` are confined to swapping an inline prefs
  block for `prefs_allow()`. **The outbound gate was not moved, weakened or
  bypassed** — it still sits above the `try`.

**The gap was not in push_service.py, it was in the harness** — see FINDING 3.
The guarantee "no real push during tests" did not hold before this branch and
does now, with `test_outbound_mode_is_dry_during_tests` as the tripwire.

`OUTBOUND_MODE` is honoured. Note for operators, unchanged by me: `outbound.MODE`
is read **once at import**, so changing the env var requires a restart, and the
default is `live` — an environment that forgets to set it sends for real.

No notification templates are involved: `send_push` posts a JSON
`{title, body, data}` to Expo and renders no markup, so the email/PDF design
specs do not apply to this file.

---

## 5 · The 067 collision (task item 5)

**Exactly two, as briefed — no third exists.** Searched every ref in the repo:

| Branch | File |
|---|---|
| `salvage/org-endpoints` (43167f2) | `PROPOSED_067_org_profile_fields.sql` |
| this branch (4f15485) | `PROPOSED_067_account_self_service.sql` |

Mine is left at 067 and untouched, per instructions. The highest applied
migration is `061_org_max_users.sql`; everything from 063 up is a proposal.

### The migration itself — reviewed, sound
Column names match every query in me.py. Part A is additive
(`CREATE TABLE IF NOT EXISTS` + three indexes, one FK to `users`). Part B is
commented out with the reason stated. Both parts carry rollback sections, and
Part A's rollback correctly warns that dropping the table destroys pending
requests. It also flags, correctly, that staging and production share one
database so the table is visible to both with no environment marker on rows.

**Nothing was applied. No migration was run. No database write was made.**

---

## 6 · Design fidelity (coordinator's second directive)

Checked `design-handover/09-customization.md` §4, `21-notifications-inbox.md`,
and the reference implementation in
`design-reference/Kartavaya Redesign/SetCustomize.jsx`.

| Design calls for | Reality |
|---|---|
| `GET /v1/me/sessions` | **Live now.** Cannot supply per-session `device`/`ip`/`location`/`last_seen` for *other* sessions — nothing records them |
| `DELETE /v1/me/sessions/:id` · `DELETE /v1/me/sessions` | **Cannot be built** — see §1. Needs a `jti` and a `user_sessions` table, i.e. a migration |
| `POST /v1/me/export` "emails a link valid 7 days" | Endpoint live; **queues only**. No worker, no email. Response says so in `automated_delivery: false` |
| `POST /v1/me/delete` "queued, not immediate" | **Matches exactly** — 30-day grace, cancellable |
| `GET/PATCH /v1/me/preferences`, table `user_preferences` | **Not built** — needs a migration |

### The DND switch had no backend representation — FIXED
The designed control is a **boolean** (`SSwitch on={p.dnd}`) above two time
fields, and `21-notifications-inbox.md`'s `inDND()` returns early on
`!prefs.dnd`. But `notification_prefs` has only `quiet_start`/`quiet_end` and
**no off-switch**, so the designed switch had nothing to bind to and a frontend
would have had to invent local state for it — precisely the "frontend fakes it"
case the directive names.

Fixed without a migration: a zero-length window already means "no quiet hours"
throughout push_service, so `dnd` is **derived, not stored**. `GET` now returns
`dnd`, `dnd_from`, `dnd_to`; `PUT` accepts them. `quiet_start`/`quiet_end` stay
in both directions so the mobile client keeps working. **Delivery behaviour is
unchanged for every existing row** — the UI stops disagreeing with the server
because it now reads the server.

Good fidelity found, worth recording: `_in_quiet_hours` implements exactly the
half-open wrap semantics of the spec's `inDND()`, including the `m >= from ||
m < to` midnight case. And DND suppressing push while the notification row is
still written matches "DND suppresses the toast, the sound and the push. It
never suppresses the notification."

---

## 7 · What I did NOT do, and why

* **Did not build session revocation.** It needs `staging.user_sessions` and a
  `jti` in `_create_token`. The table requires a migration, which is forbidden
  here. PROPOSED_067 Part B is the correct deliverable and is already written.
  Building the endpoint without the table would recreate the exact dishonesty
  the branch was written to avoid.
* **Did not build `/v1/me/preferences`.** Needs the `user_preferences` table —
  same reason.
* **Did not wire TabData.jsx to export/delete.** Those endpoints return **503 on
  every environment today** because PROPOSED_067 is unapplied. Wiring buttons
  that 503 everywhere is the dead-button problem in a new costume. `GET
  /sessions` does work today and is the one piece safe to wire; I left the
  frontend alone rather than half-wire the tab under time pressure. **This is
  the main piece of unfinished work.**
* **Did not renumber any migration**, per instructions.
* **Did not fix `test_ganit.py::test_create_invoice_success`.** It fails
  identically on clean `origin/staging` — pre-existing, unrelated to this
  surface (`'MagicMock' object can't be awaited`).
* **Did not fix `auth_router._create_token`'s stale "30-day" docstring** — one
  word in a file owned elsewhere, reported instead.

---

## 8 · Verification

* Full backend suite: **370 passed, 1 failed** — the single failure is the
  pre-existing `test_ganit` one, verified failing on clean `origin/staging`
  before any of my changes.
* 66 new tests, all passing.
* `node scripts/check-tokens.mjs` → `339 declared, 232 referenced, 0 missing`
* `node scripts/check-classes.mjs` → `2114 selectors, 1439 classes used, 0 missing a rule`
* No database write, no migration run, no email/push/WhatsApp sent.
* `frontend/yarn.lock` and `package-lock.json` untouched.

