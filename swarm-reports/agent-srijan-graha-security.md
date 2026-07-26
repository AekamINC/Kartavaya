# Srijan + Graha security audit — `agent-srijan-graha-security`

Branch: `agent-srijan-graha-security-v2` (see §7 for why the name changed).
Base: `origin/staging`.
Scope: `backend/routers/graha.py`, `hub.py`, `hub_chat.py`, `hub_publish.py`,
`scrapers.py`; `backend/services/social_publisher.py`, `ai_router.py`,
`ad_insights.py` (token reader only), `middleware/role_tiers.py`.

**Gates: both green.** `check-tokens` 279 declared / 0 missing;
`check-classes` 2096 selectors / 0 missing a rule.
**Backend suite: 285 passed, 1 pre-existing failure** (`test_ganit.py::
test_create_invoice_success` — verified failing on clean `origin/staging`,
not caused by this branch; ganit is another agent's territory).

---

## 1. OAuth token path — complete trace

`staging.hub_social_accounts` holds live per-client OAuth tokens for 11
platforms. **The table has no `org_id` column.** Its only tenant path is

```
hub_social_accounts.client_id → hub_clients.id → hub_clients.org_id
```

so every read and write of that table is a place where the join must appear.
Both live defects were at points where it did not.

### 1a. Ingress — how a token gets stored

| # | Hop | Location | Org check |
|---|-----|----------|-----------|
| 1 | `GET /hub/oauth/{platform}/authorize` — mints `state`, stores `{platform, client_id, org_id, user_id}` in `hub_oauth_states` | `hub_publish.py` `oauth_authorize` | **was MISSING → FIXED** (FINDING-1) |
| 2 | Provider consent screen | external | n/a |
| 3 | `GET /hub/oauth/{platform}/callback` — **unauthenticated by necessity**; the provider redirects a browser here, no bearer token exists | `hub_publish.py` `oauth_callback` | **now re-proves the pairing from the state row** |
| 4 | Code→token exchange, `httpx.post(config["token_url"])` | same | n/a |
| 5 | Meta only: user token swapped for a **Page token** via `/me/accounts` | `_fetch_meta_accounts` | n/a |
| 6 | `INSERT INTO hub_social_accounts … ON CONFLICT (client_id, platform, account_id) DO UPDATE` | same | keyed on `client_id`; the pairing is proved at hop 3 |
| 6b | Manual path: `POST /clients/{client_id}/social-accounts`, raw token in the request body | `connect_social_account` | OK — inline `hub_clients … AND org_id=$2`, and now also publish-authority gated |

`state` is 32 bytes from `secrets.token_urlsafe`, single-use (`DELETE …
RETURNING`) and expires in 10 minutes. That part was already sound.

### 1b. Egress — how a token gets read and used

| # | Reader | Location | Org check |
|---|--------|----------|-----------|
| A | `_get_account()` — `SELECT *` by id | `social_publisher.py` | none — but **no caller anywhere**; dead code |
| B | `publish_content(queue_id)` — joins queue→content→accounts, pulls `sa.access_token` | `social_publisher.py` | none inside; both callers gate first (C, D) |
| C | `POST /hub/publish/queue/{queue_id}/publish-now` | `hub_publish.py` | **OK** — pre-flight join `hub_publish_queue → hub_clients … c.org_id=$2`, plus the new publish-authority gate |
| D | `process_scheduled_posts()` (cron via `/hub/publish/dispatch`) | `social_publisher.py` | n/a — system context, no caller org |
| E | `_refresh_token_if_needed` → writes the refreshed token back by id | `social_publisher.py` | inherits B |
| F | `ad_insights.sync_meta_account` — `SELECT … WHERE id=$1` | `ad_insights.py` | **was MISSING → FIXED** (FINDING-2) |

### 1c. Does a token ever reach the frontend? **No.**

Verified by reading every `SELECT` against `hub_social_accounts`:

- `list_social_accounts` enumerates columns explicitly — `id, platform,
  account_name, account_id, page_id, token_expires_at, is_active, connected_at`.
  No token column.
- `connect_social_account` returns `RETURNING id, platform, account_name`.
- `list_publish_queue` and `content_calendar` take `sa.platform, sa.account_name`.
- The two `SELECT *` sites are service-internal; neither return value is
  serialised to a response. `publish_content` returns
  `{status, platform_post_id, platform_url}`.
- `oauth_authorize` returns `auth_url` + `state`; the app **secret** never
  leaves the server, only the app **id** (which is public by design in an OAuth
  authorize URL).

Pinned by `test_list_social_accounts_never_selects_token_columns`, which also
fails on a `SELECT *` regression.

### 1d. Is a token ever logged? **No.**

Every `log.*` in `social_publisher.py`, `hub_publish.py` and `ad_insights.py`
logs `account["id"]`, `platform` or `queue_id` — never the token. Two notes:

- `scrapers.py` **actively redacts** `token=` out of Apify exception text before
  putting it in a 502 body. Good pattern; worth copying elsewhere.
- `social_publisher.publish_content` writes `str(exc)[:500]` into
  `hub_publish_queue.error_message`. `httpx` error messages carry the request
  **URL**. For Facebook / Instagram / Threads the token is in the POST **body**,
  so it is not captured. **Telegram is the exception — its bot token is in the
  URL path** (`/bot{token}/sendMessage`). See FINDING-8; not fixed, flagged.

### 1e. Tokens are stored in plaintext — FINDING-7

`whatsapp.py` encrypts its Meta token (`access_token_enc`, via
`services/encryption.py` Fernet). `hub_social_accounts.access_token` and
`.refresh_token` are **plaintext**. Same company, same Meta credentials, two
different standards.

**Not fixed deliberately.** `encrypt()` is idempotent and `decrypt()` passes
plaintext through, so an app-layer change looks safe — but staging and
production share one Supabase project. Encrypting at write time would put
ciphertext into the live table the moment staging deployed, and any production
reader not yet carrying the decrypt path would send `enc::…` to Facebook as a
bearer token. That is a coordinated two-deploy change plus a backfill, not a
drive-by. Owner decision required.

---

## 2. Findings

### FINDING-1 — CRITICAL — cross-org OAuth token injection · FIXED

`hub_publish.py` `oauth_authorize`. `client_id` arrived as an unvalidated query
parameter and was written straight into the state row, which the callback then
trusted. This file *defines* `_require_client_in_org` with a docstring
explaining that this exact class of bug was fixed elsewhere — "half the routes
in this file did this inline and half did not". **The route that writes tokens
is the one that was missed.**

Exploit: a member of Org A with any Srijan grant calls
`/hub/oauth/facebook/authorize?client_id=<Org B's client>`, completes consent
with **their own** Facebook account, and the callback files that Page token
under Org B's client. Org B's operators then schedule their customer's content
to the attacker's Page. `ON CONFLICT … DO UPDATE` additionally lets a matching
`(platform, account_id)` **overwrite a live token**.

Compounding it: `state_data["org_id"]` was stored and then never read.

Fixed at both ends — ownership proved at authorize, and re-proved at callback
before the insert (org membership or client ownership can change during the
consent round-trip). The callback check runs **before** the code-for-token
exchange; the test enforces that ordering by failing on any outbound call.

### FINDING-2 — CRITICAL — unscoped token read in the Meta ad sync · FIXED

`ad_insights.sync_meta_account` fetched the account by bare id while `org_id`
was used only to *file the results*. Caller `prachar_ads.py` passes
`body.social_account_id` straight from the request body. So Org A submits Org
B's account id → the server calls the Meta Marketing API **with Org B's OAuth
token** → Org B's ad accounts, campaigns, budgets and spend land in Org A's
tables.

Fixed at the **token boundary** (the read inside the service) rather than at the
caller, both because `prachar_ads.py` is another agent's file and because
scoping at the source closes it for every future caller.

### FINDING-3 — HIGH (live crash) — `_refresh_meta_token` arity · FIXED

`ad_insights.py` called `_refresh_meta_token(pool, id, token)` against a
one-argument signature. `TypeError` — **the Meta ad sync has never worked**.
Had it run, `pool` would have been sent to Facebook as the access token.

This is the only reason FINDING-2 was never exploited: the function crashed
before reaching the network. Fixing the scoping without the arity would have
*armed* the vulnerability, so both landed in one change. Pinned by an arity test.

### FINDING-4 — MEDIUM — cross-org read of content approval history · FIXED

`hub.py` `list_approvals` proved the **client** belonged to the org, then read
`hub_content_approvals` by `content_item_id` **alone**. `client_id` and
`content_id` are separate path parameters, so a caller could pair their own
client with another org's content id and read that org's review history —
reviewer identity, timestamps, and review notes verbatim.

The sibling write path (`review_content`) has always scoped its `UPDATE` with
`AND client_id=$5`. Only the read was missing it. Now joins through
`hub_content_items`.

### FINDING-5 — HIGH — publishing was reachable by the weakest Srijan grant · FIXED

`require_module("srijan")` answers only "does this user have Srijan at all". The
grant carries no level, because `org_member_modules` **has no `role` column** —
it is added by `PROPOSED_065_module_role_levels.sql`, which is not applied. So
every route in `hub_publish.py` was reachable by the weakest possible grant,
including connecting an OAuth account, disconnecting one, and `publish-now`.

`RBAC-SPEC.md`'s module matrix puts all three at Srijan **admin** (viewer = "use
chatbot", editor = "manage KB docs", admin = "configure models, publish bots";
Srijan has no approver level). **The guard and the designed screens contradicted
each other, and the guard was wrong** — a viewer able to post publicly as a
customer's brand is not a design anyone chose.

Fixed with `_require_publish_authority` on the five credential-and-publish
routes. Since the level column does not exist, it uses the coarser control the
schema supports — the org role — which is the same fallback PROPOSED_065 records
for Vetana. **Aekam operators are admitted first** via
`OPERATIONS_CONSOLE_ROLES`; gating on the org role alone would have locked out
`platform_staff`, the role created for exactly this work. That is also why it
does not use `require_org_role`, which admits only the literal string
`platform_admin`.

**Scheduling was left open** to any Srijan grant. A scheduled post is visible in
the calendar and cancellable; `publish-now` is neither. The sharp edges are
gated, ordinary work is not.

### FINDING-6 — HIGH — scraper surfaces exposed our cost basis and margin · FIXED

Three separate leaks, all customer-facing:

1. `GET /scrapers/catalog` did `SELECT *` on `hub_scraper_catalog`, a table that
   carries **`cost_per_run`** (our supplier cost) and **`margin_pct`** (our
   markup). Every org user with a Srijan grant received both on an ordinary
   catalog listing. Also dropped `apify_actor_id` — it names the exact
   marketplace actor behind each entry, the other half of reproducing the
   offering without us. Columns are now enumerated, so a new commercial column
   is not published by default.
2. `GET /scrapers/runs` and `/runs/{id}` returned `cost_usd` — what we paid
   Apify — beside `billed_inr`, which the customer is entitled to see. Together
   that is our exact per-run margin. `cost_usd` removed from both.
3. `GET /scrapers/admin/usage` sums cost against billing **per org, across every
   org** — Aekam's own P&L — and sat on `OPERATIONS_CONSOLE_ROLES`, so every
   `platform_staff` holder could read the margin on every customer. Moved to
   `FINANCE_CONSOLE_ROLES`, which `role_tiers.py` already defines for
   "platform-wide KPIs, cost summaries, provider reconciliation, margin". The
   operating set "deliberately excludes finance" by its own definition, so this
   is the documented intent, not new policy. `/admin/runs` stays on the
   operating set — that one is genuine triage.

**Rule 6, unresolved and needing an owner decision:** `SCRAPER_MARGIN` in
`scrapers.py` is a hardcoded markup rate, and its comment restated the figure in
prose. I scrubbed the prose. I did **not** move the constant, because
`hub_scraper_catalog.margin_pct` already exists as its proper home and switching
to it would change what runs actually cost — a pricing decision, not mine. Same
class: `CREDIT_PRICE_INR` in `ai_router.py`, served to clients as
`price_per_credit_inr`, and a hardcoded fallback for the same value in
`frontend/src/pages/OrgSrijanPage.jsx`.

### FINDING-7 — MEDIUM — OAuth tokens stored in plaintext · NOT FIXED

See §1e. Needs a two-deploy migration plan; unsafe as a drive-by on a shared DB.

### FINDING-8 — LOW — Telegram bot token can reach an error column · NOT FIXED

`publish_to_telegram` puts the bot token in the **URL path**. `publish_content`
stores `str(exc)[:500]` into `hub_publish_queue.error_message`, and httpx error
messages include the URL. A failed Telegram publish can therefore persist the
bot token into a column that `list_publish_queue` returns to the browser.

Not fixed because the fix belongs with the redaction helper, and `scrapers.py`
already has the right pattern (`token=` → `token=***`) that should be lifted into
a shared util rather than copy-pasted a third time.

### FINDING-9 — LOW — `require_org_role("org_admin")` locked out `org_owner` · FIXED

`graha.py`'s two destructive merge routes hardcoded `"org_admin"`, omitting
`org_owner` — the org's **most** privileged role could not undo a merge its own
admin could perform. Now `require_org_role(*ORG_MANAGEMENT_ROLES)`.

### FINDING-10 — LOW — `require_org_role` will lock out god mode on migration day

`middleware/roles.py` passes platform staff by testing
`role_code = 'platform_admin'` as a bare literal. `role_tiers.py` documents
exactly this trap: the day the data migration renames those rows to
`platform_owner`, every god-mode account loses org access at once.
`GOD_MODE_ROLES` exists for it. **Not fixed** — `roles.py` is shared middleware
that several agents are editing this run, and a rebase conflict there costs more
than the fix is worth today (the failure is dormant until the rename). One-line
change, flagged for whoever owns middleware.

---

## 3. Reachability table — before / after

Guard shown is the strongest that applies. Every route below also passes
`require_module("srijan"|"graha")`, which enforces subscription + per-user grant
and routes platform roles through `role_tiers.can_reach_module`.

### `hub_publish.py` — the credential surface (14 routes)

| Route | Before | After |
|---|---|---|
| `GET /hub/oauth/{platform}/authorize` | any member w/ grant, **any client id** | **publish authority**, own client only |
| `GET /hub/oauth/{platform}/callback` | public (state only) | public + **pairing re-proved** |
| `POST /hub/clients/{id}/social-accounts` | any member w/ grant | **publish authority** |
| `DELETE /hub/clients/{id}/social-accounts/{aid}` | any member w/ grant | **publish authority** |
| `POST /hub/publish/queue/{qid}/publish-now` | any member w/ grant | **publish authority** |
| `PUT /hub/clients/{id}/platforms` | any member w/ grant | **publish authority** |
| `POST /hub/publish/dispatch` | shared secret | unchanged |
| schedule / bulk-schedule / cancel / queue list / calendar / social-account list | any member w/ grant | unchanged (reversible, visible) |

"publish authority" = `OPERATIONS_CONSOLE_ROLES` (platform_owner, platform_admin,
platform_manager, platform_staff, account_manager, srijan_admin) **or**
`ORG_MANAGEMENT_ROLES` (org_owner, org_admin).

### `scrapers.py` (7 routes)

| Route | Before | After |
|---|---|---|
| `GET /scrapers/catalog` | any member w/ grant, **incl. cost_per_run + margin_pct** | same roles, commercial columns removed |
| `GET /scrapers/runs`, `/runs/{id}` | any member w/ grant, **incl. cost_usd** | same roles, `cost_usd` removed |
| `POST /scrapers/run`, `/runs/{id}/import-to-graha` | any member w/ grant | unchanged |
| `GET /scrapers/admin/usage` | `OPERATIONS_CONSOLE_ROLES` | **`FINANCE_CONSOLE_ROLES`** |
| `GET /scrapers/admin/runs` | `OPERATIONS_CONSOLE_ROLES` | unchanged |

### `hub.py` (46 routes) — unchanged except FINDING-4

32 any-member-with-grant · 8 `SRIJAN_COMMERCIAL_ROLES` (client CRUD, brand,
content review, credit top-ups, spend analytics) · 6 `OPERATIONS_CONSOLE_ROLES`
(skill templates, skill assignment). This split already matches the design:
authoring is operations, anything that bills is commercial.
`GET /clients/{id}/content/{cid}/approvals` keeps its roles and gains a tenant scope.

### `hub_chat.py` (10 routes) — unchanged, no defects found

All 10 are any-member-with-grant. `hub_chat_sessions` **has** an `org_id`
column and every route scopes on it, then reads messages through the verified
session. Correct parent-join scoping throughout.

### `graha.py` (83 routes)

| Route | Before | After |
|---|---|---|
| `POST /graha/contacts/{id}/merge` | `require_org_role("org_admin")` — **excluded org_owner** | `ORG_MANAGEMENT_ROLES` |
| `POST /graha/contacts/merges/{mid}/undo` | same | `ORG_MANAGEMENT_ROLES` |
| `POST /graha/inbound-leads` | public + HMAC | unchanged |
| `POST /graha/f/{slug}` | public web form | unchanged |
| other 79 | any member w/ grant | unchanged |

**No legitimate user loses access anywhere except FINDING-5 and FINDING-6.3,
where that is the explicit point.** FINDING-9 *widens* access to org_owner.

---

## 4. Cross-tenant verification (task item 3)

`user_roles` is the sole tenant path; `get_org_id` resolves it and validates
`X-Org-Id` against membership before trusting it.

Machine-scanned every SQL statement in all five routers, then hand-read each hit:

- **graha.py — 83 routes, 81 carry `get_org_id`.** The two that do not are
  `POST /inbound-leads` and `POST /f/{slug}`, both public by design. **Both
  derive `org_id` from server-side data, never from client input** — the org's
  configured `lead_capture_email`, and the form's own `org_id`. `/inbound-leads`
  is HMAC-SHA256 signed and compared with `hmac.compare_digest`. Correct.
- **21 graha queries touch a table without `org_id` in the SQL. All 21 are
  child reads after a verified parent** — `get_contact` proves the contact
  against `org_id` and then reads deals/activities/follow-ups/labels by
  `contact_id`; `get_client` does the same via `client_id`. `add_contact_label`
  proves **both** the contact and the label against `org_id` before the
  unscoped join-table insert. This is the "scope through a parent that has it"
  pattern, correctly applied.
- **hub_chat.py — 7 unscoped-looking queries, all keyed on a session already
  proved against `org_id`.** Clean.
- **hub.py — 17.** All but `list_approvals` (FINDING-4) either operate on
  platform-global tables (`hub_skill_templates`, deliberately shared) or follow
  a verified parent. Fixed the one.
- **Child tables with no `org_id` confirmed to scope through a parent:**
  `hub_social_accounts` (→ hub_clients), `hub_publish_queue` (→ hub_clients),
  `hub_content_approvals` (→ hub_content_items → hub_clients),
  `hub_chat_messages` (→ hub_chat_sessions, which has org_id),
  `graha_contact_labels` (→ graha_contacts), `graha_deals` / `graha_activities`
  / `graha_follow_ups` (→ graha_contacts or direct org_id).

Minor, not fixed: `create_client` and `get_or_create_org_client` check slug
uniqueness **globally** (`WHERE slug=$1`, no org filter), so a 409 reveals that
some other org holds that slug. A weak enumeration oracle; changing it needs a
schema look at whether slug uniqueness is meant to be global.

---

## 4b. Module-gate codes — checked, no bug in this scope

A sibling agent found `search.py` and `messaging.py` gated on a module code that
no `module_subscriptions` row can ever match, so those endpoints 403 before
reaching a query. **Srijan and Graha do not have that shape.** My five routers
use exactly two codes:

- **`"srijan"`** — in `subscription.BUNDLED_MODULES`, so it resolves against
  `plans.features` and never consults `module_subscriptions` at all. The
  `enable_module` accepted-code list is irrelevant to it.
- **`"graha"`** — present in `admin_orgs.ALL_MODULES`, so an org can actually
  have it enabled.

Both reachable. For the record, `admin_orgs.ALL_MODULES` lists eight codes and
**omits `esign`, `varta`, `samvada`, `pahchan` and `kartavya`**, which
`role_tiers.ALL_MODULES` does include — that is the gap the sibling agent hit.
Outside my scope, but it corroborates their finding.

## 5. Model cost (standing rule)

**No expensive model is wired into any production path. Nothing to flag.**

`grep -riE "anthropic|claude-|gpt-4|gpt-5|opus|sonnet"` across `backend/`
(excluding tests) returns **zero hits**. Claude is not a runtime dependency
anywhere in this codebase.

`ai_router._select_providers` routes to Gemini Flash Lite / Flash / Pro, Qwen,
GLM-4.5-Air and Groq Llama. **Chatbot is `["gemini", …]` first — the direct
Gemini key, which is the intended grounding route because its web search is
free.** Image generation prefers free HuggingFace FLUX Dev, then Gemini Flash
Lite Image, and only falls through to FLUX.2 Pro / Recraft when both fail.

One cosmetic risk: `_generate_openrouter_image` has a **default** parameter of
`black-forest-labs/flux-pro-1.1`, a premium model. All three call sites pass an
explicit model, so the default is currently unreachable — but it is a loaded gun
for the next caller who omits the argument. Worth changing to a cheap default.
Left alone as it is behaviour-neutral today.

---

## 6. Which claims were STALE

Re-reading before claiming caught several things that would have been wrong:

1. **"`scrapers.py` has a broken `get_org_id` import after a bad
   find-and-replace."** **STALE — it was not broken.** `from middleware.roles
   import require_platform_role, get_org_id` resolved fine, because `roles.py`
   itself imports `get_org_id` and so re-exports it. It was importing from the
   wrong module, not a failing import. Repointed to
   `middleware.org_resolver` and pinned with a test.
2. **"`graha.py` has public unguarded merge endpoints."** **STALE — a parser
   artifact of my own scan.** Both are guarded by `require_org_role`. Re-reading
   the source turned a false critical into the real, much smaller FINDING-9.
3. **"Srijan hub routes require platform_admin/account_manager/srijan_admin and
   lock out platform_staff."** **STALE — already fixed.** `hub.py` now uses
   `OPERATIONS_CONSOLE_ROLES` and `SRIJAN_COMMERCIAL_ROLES` throughout. I had to
   be careful not to *re-introduce* this regression with FINDING-5's gate.
4. **"`hub_publish.py` routes don't check client ownership."** **PARTLY STALE.**
   Most were fixed in a prior pass — `_require_client_in_org` exists and the
   bulk-schedule hole is closed, with comments describing both. Exactly one
   route was still unchecked, and it happened to be the one that writes tokens
   (FINDING-1). "Mostly fixed" is why this was still live.
5. **"Cross-tenant leaks throughout graha."** **STALE.** 21 apparently unscoped
   queries all turned out to scope correctly through a verified parent. Graha's
   tenant isolation is in good shape.
6. **"Spend analytics is ungated."** **STALE.** Both spend endpoints are on
   `SRIJAN_COMMERCIAL_ROLES` and join through `hub_clients.org_id`.
7. **"An expensive model is on a production path."** **STALE.** Zero
   Anthropic/OpenAI references in the entire backend.

---

## 7. Process notes

**The worktree arrived on the wrong base.** It was checked out on
`worktree-agent-a674b371d7e9ee944` at `1aa4985` — 13 commits of unrelated older
work (R2 attachments, CORS spelling, PgBouncer retries) on a merge-base far
behind `origin/staging`. **None of my scope existed at that commit**: no
`graha.py`, no `middleware/`, no Srijan routers. I did not reset or force
anything; I branched fresh off `origin/staging` and left that branch untouched.
Someone should check whether those 13 commits are already in staging under
different SHAs before discarding them.

**Branch renamed to `-v2`.** After rebasing onto the newer `origin/staging` (to
pick up `design-handover/_SOURCE-MAP.md`), my history no longer fast-forwarded
onto the backup branch I had already pushed. Force-push is forbidden, so I
pushed to `agent-srijan-graha-security-v2` rather than rewrite the remote.
`agent-srijan-graha-security` still holds the two pre-rebase commits.

**Warning to other agents — do not use `git stash` in this repo.** I ran
`git stash` with no local modifications (everything was committed), so it
created nothing; the subsequent `git stash pop` then applied a **pre-existing
stash belonging to another branch** (`WIP on staging: caba74f`), producing a
conflicted `DrawerAttachments.jsx` and a modified `server.py`. I verified the
content was not mine, reset, and confirmed the stash entry is still intact in
the stash list for its owner. There are 5 unrelated stashes sitting in this repo.

---

## 8. Not finished / handed on

- **FINDING-7** (plaintext OAuth tokens) — needs a two-deploy plan plus backfill
  on a shared production DB. Owner decision.
- **FINDING-8** (Telegram token in `error_message`) — should land as a shared
  redaction util lifted from `scrapers.py`, not a third copy-paste.
- **FINDING-10** (`roles.py` hardcodes `platform_admin`) — one line, but in
  shared middleware other agents are editing this run. Dormant until the role
  rename.
- **Rule 6 residue** — `SCRAPER_MARGIN`, `CREDIT_PRICE_INR`, and the frontend's
  hardcoded fallback for the latter. All are pricing decisions, not security
  fixes; `hub_scraper_catalog.margin_pct` already exists as the right home.
- **`org_member_modules.role` does not exist** (PROPOSED_065 unapplied), so
  Tier 4 cannot be enforced anywhere in the product. My publish gate is a
  deliberately coarser stand-in. Note that `org_members.py` **already INSERTs
  into that column** — if 065 really is unapplied, adding a member with module
  grants raises `UndefinedColumnError`. I could not verify the live schema
  (read-only, no DB access) and did not build anything that depends on the
  column. **Someone with DB access should check this — it is either a live break
  or a migration that needs renaming out of `PROPOSED_`.**
- **Design fidelity** — I read `RBAC-SPEC.md` and reconciled the guards against
  its module matrix (FINDING-5). I did **not** get to
  `design-handover/13-module-pages.md` for Srijan content-preview /
  scheduled-post-card data requirements, so I cannot say whether an endpoint is
  missing for those screens. That check is unstarted.
- **Nothing was ever published, posted or sent.** The two tests that touch a
  publisher assert suppression and install an `httpx` stub that fails the test on
  any outbound call, so a regression in check ordering surfaces as a test
  failure rather than a real post.
