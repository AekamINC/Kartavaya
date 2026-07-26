# Srijan + Graha security audit — `agent-srijan-graha-security`

Branch base: `origin/staging` @ `2a2a27b`.
Scope: `backend/routers/graha.py`, `backend/routers/hub.py`, `hub_chat.py`,
`hub_publish.py`, `backend/routers/scrapers.py`, `backend/services/social_publisher.py`,
`backend/services/ai_router.py`, `backend/services/ad_insights.py` (token reader only).

**Status: IN PROGRESS — written incrementally. Findings are appended the moment
they are confirmed by re-reading the file, per the standing "re-read before you
claim" rule.**

---

## 0. Worktree note (process, not a defect)

The worktree arrived checked out on `worktree-agent-a674b371d7e9ee944`, whose HEAD
was `1aa4985` — **13 commits of unrelated older work** (R2 attachments, CORS spelling,
PgBouncer retries) sitting on a merge-base of `294e9e2`, far behind `origin/staging`
(`2a2a27b`). None of the files in my scope existed at that commit: no `graha.py`,
no `middleware/`, no Srijan routers.

I did **not** reset or force anything. I branched fresh off `origin/staging` as
`agent-srijan-graha-security` and left the old branch untouched. Anyone auditing
that stale branch should check whether those 13 commits are already in staging
under different SHAs before discarding them.

---

## 1. OAuth token path — complete trace

Every hop an OAuth access token takes, from grant to use. Table
`staging.hub_social_accounts`, keyed on `client_id` → `staging.hub_clients.org_id`.

**`hub_social_accounts` has NO `org_id` column of its own.** Its only tenant path is
the join `hub_social_accounts.client_id → hub_clients.id → hub_clients.org_id`.
That makes every read of the table a place where the join must be present, and
that is exactly where the two live defects are.

### 1a. Ingress — how a token gets stored

| # | Hop | File:line | Org check |
|---|-----|-----------|-----------|
| 1 | `GET /api/v1/hub/oauth/{platform}/authorize` — mints `state`, stores `{platform, client_id, org_id, user_id}` in `hub_oauth_states` | `hub_publish.py:161-219` | **MISSING — see FINDING-1** |
| 2 | Provider consent screen (facebook / linkedin / google) | external | n/a |
| 3 | `GET /api/v1/hub/oauth/{platform}/callback` — **unauthenticated by design**, trusts `state` | `hub_publish.py:222-306` | relies entirely on hop 1 |
| 4 | Code→token exchange over httpx to `config["token_url"]` | `hub_publish.py:242-254` | n/a |
| 5 | For Meta, the *user* token is swapped for a **Page token** via `/me/accounts` | `hub_publish.py:309-343` | n/a |
| 6 | `INSERT INTO staging.hub_social_accounts … ON CONFLICT (client_id, platform, account_id) DO UPDATE` — keyed on `state_data["client_id"]` **only** | `hub_publish.py:288-300` | **`state_data["org_id"]` is stored at hop 1 and then never used** |
| 6b | Manual path: `POST /clients/{client_id}/social-accounts` takes a raw `access_token` in the body | `hub_publish.py:425-460` | OK — inline `hub_clients … AND org_id=$2` at :436 |

### 1b. Egress — how a token gets read and used

| # | Reader | File:line | Org check |
|---|--------|-----------|-----------|
| A | `social_publisher._get_account()` — `SELECT * … WHERE id=$1 AND is_active` | `social_publisher.py:41-47` | none, but **unreachable from HTTP** (no caller; dead code) |
| B | `social_publisher.publish_content(queue_id)` — joins queue→content→`hub_social_accounts`, pulls `sa.access_token` | `social_publisher.py:475-484` | none *inside*, but both callers gate first — see below |
| C | → caller `POST /publish/queue/{queue_id}/publish-now` | `hub_publish.py:581-599` | **OK** — pre-flight join `hub_publish_queue → hub_clients … c.org_id=$2` at :590-595 |
| D | → caller `process_scheduled_posts()` (cron) | `social_publisher.py:559-571` | n/a — system context, no caller org |
| E | `_refresh_token_if_needed` → writes a **new** token back by `id` | `social_publisher.py:50-83` | inherits B's scoping |
| F | `ad_insights.sync_meta_account` — `SELECT id, access_token … WHERE id=$1::uuid` | `ad_insights.py:85-89` | **MISSING — see FINDING-2** |

### 1c. Does a token ever reach the frontend?

**No — verified by reading every SELECT against `hub_social_accounts`.**

- `list_social_accounts` (`hub_publish.py:414-421`) enumerates columns explicitly:
  `id, platform, account_name, account_id, page_id, token_expires_at, is_active,
  connected_at`. No `access_token`, no `refresh_token`.
- `connect_social_account` returns `RETURNING id, platform, account_name` only.
- `list_publish_queue` / `content_calendar` select `sa.platform, sa.account_name` only.
- The two `SELECT *` sites (`social_publisher._get_account`, `publish_content`) are
  **service-internal**; neither return value is serialised to an HTTP response.
  `publish_content`'s return is `{status, platform_post_id, platform_url}`.

### 1d. Is a token ever logged?

**No token value reaches a log line.** Checked every `log.*` in `social_publisher.py`,
`hub_publish.py`, `ad_insights.py`: they log `account["id"]`, `platform`, `queue_id`,
never the token. Two adjacent notes:

- `scrapers.py:189-192` actively **redacts** `token=` out of Apify exception text
  before putting it in a 502 body. Good pattern, worth copying.
- `social_publisher.py:548-555` writes `str(exc)[:500]` into
  `hub_publish_queue.error_message`. `httpx.HTTPStatusError` messages contain the
  request URL. For Facebook/Instagram/Threads/Telegram the token travels in the
  **POST body**, not the URL, so it is not in the message. For Telegram the *bot
  token is in the path* (`/bot{token}/sendMessage`) — see FINDING-8.

---

## 2. Findings

*(appended as confirmed — severity, then file:line, then the reasoning)*

### FINDING-1 — CRITICAL — cross-org OAuth token injection via `/oauth/{platform}/authorize`

`backend/routers/hub_publish.py:161-187`

```python
async def oauth_authorize(
    platform: str,
    client_id: UUID,                       # ← attacker-controlled, never validated
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    ...
    await _store_oauth_state(state, {
        "platform": platform,
        "client_id": str(client_id),       # ← trusted verbatim at callback
        "org_id": org_id,
        "user_id": user["user_id"],
    })
```

There is no `await _require_client_in_org(pool, str(client_id), org_id)`. This file
*defines* that helper at :36 with a docstring explaining that exactly this class of
bug was fixed elsewhere ("half the routes in this file did this inline and half did
not"). Every other `/clients/{client_id}/…` route in the file now calls it or checks
inline. **`oauth_authorize` is the one that was missed** — and it is the highest-value
one, because it is the route that writes tokens.

**Exploit:** a member of Org A holding any Srijan grant calls
`/api/v1/hub/oauth/facebook/authorize?client_id=<Org B's client uuid>`. The state row
is written with Org B's `client_id` and Org A's `org_id`. The attacker completes
consent with **their own** Facebook account. The callback (`:288`) inserts the
resulting Page token into `hub_social_accounts` under **Org B's client**.

Org B's operators now see an extra connected account on their client and will
schedule their customer's content to it. Every post Org B publishes through that row
goes to the attacker's Page. Nothing is forged — the client id is simply never checked.
The `ON CONFLICT (client_id, platform, account_id) DO UPDATE` also means an attacker
who can match an existing `(platform, account_id)` **overwrites the live token**.

The callback compounds it: `state_data["org_id"]` is stored at :185 and **never read
again**. The insert at :288 is keyed on `client_id` alone.

**Fix applied:** validate client∈org at authorize time, *and* re-validate at callback
time from the state's own `org_id` (defence in depth — org membership or client
ownership can change during the consent round-trip).

### FINDING-2 — CRITICAL — `sync_meta_account` uses an unscoped token read

`backend/services/ad_insights.py:85-93`

```python
row = await pool.fetchrow(
    "SELECT id, access_token, platform_data FROM staging.hub_social_accounts "
    "WHERE id=$1::uuid",              # ← no org join
    social_account_id,
)
...
token = await _refresh_meta_token(pool, str(row["id"]), row["access_token"])
```

`org_id` is a *separate* parameter, used only to write the results into
`prachar_ad_accounts`. The token is fetched by bare id. The caller
(`prachar_ads.py:56-58`) passes `body.social_account_id` straight from the request
body:

```python
result = await sync_meta_account(await get_pool(), org_id, body.social_account_id)
```

So a user in Org A submits Org B's `social_account_id` and the server calls the Meta
Marketing API **with Org B's OAuth token**, then files Org B's ad accounts, campaigns,
budgets and spend into Org A's `prachar_ad_accounts`. That is a direct read of another
tenant's advertising data using their credential — the precise failure my brief names.

`prachar_ads.py` belongs to another agent, so I fixed the **token boundary** — the read
inside `sync_meta_account` — rather than the caller. Scoping it at the source is the
correct layer anyway: it closes the hole for every future caller, not just this one.

### FINDING-3 — HIGH (live crash) — `_refresh_meta_token` called with 3 args, takes 1

`backend/services/ad_insights.py:93` vs `backend/services/social_publisher.py:86`

```python
# definition
async def _refresh_meta_token(current_token: str) -> str:
# call
token = await _refresh_meta_token(pool, str(row["id"]), row["access_token"])
```

`TypeError: _refresh_meta_token() takes 1 positional argument but 3 were given`.
`sync_meta_account` cannot ever have succeeded in this form — the Meta ad sync is
**broken in production right now**, not merely mis-scoped. Had it run, `pool` would
have been sent to Facebook as the token.

This is why FINDING-2 has not yet been exploited: the function crashes before it
reaches the network. Fixing one without the other would arm the vulnerability, so
both are fixed in the same change.

---

*(report continues — sections 3 reachability table, 4 stale claims, 5 unfinished)*
