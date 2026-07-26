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

*(report continues — appended as findings are confirmed)*
