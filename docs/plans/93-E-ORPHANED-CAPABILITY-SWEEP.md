# Proposal 93 · E — the ORPHANED-CAPABILITY SWEEP

**A route that exists, is deployed, works — and no screen calls it. Or a control
that exists with no route behind it. Either way the customer cannot do the
thing, and nothing goes red.**

Five instances of this shape were found independently on 2026-08-29 by five
different pieces of work. This document is the systematic sweep. It is
**evidence, not a verdict** (93 §14): every finding carries a live probe, an
OpenAPI extract, a catalogue query or a grep with its result, and an explicit
classification. Nothing here was fixed — see §7 for why, and it is a decision
rather than an omission.

---

## 0 · Method, and exactly what it covers

| | |
|---|---|
| **Route inventory** | The **DEPLOYED** OpenAPI, fetched twice — `curl -s https://kartavya-staging.up.railway.app/openapi.json`. **759 paths → 958 operations.** Both fetches `sha256[:16] = 7aa2b98bf8c1703a`, byte-identical, so the surface did not move under the sweep |
| **Client inventory** | Every path-shaped string literal in `frontend/src` (**7,668**) and `mobile/src` (**2,026**), scanned line-by-line across `'…'`, `"…"` and `` `…` ``, with `${…}` collapsed to `{}` |
| **Matching** | Segment-wise, and **deliberately generous in the route's favour**: a client `{}` matches ANY server segment, so `` `/tasks/${id}/${action}` `` counts as reaching `/api/tasks/{id}/archive`, `/toggle`, `/move` and every other sibling. A route reported orphaned is one that **no literal, no template and no dynamically-composed action segment** in either client can produce |
| **Test files excluded** | `__tests__`, `*.test.*` and `src/__tests__/e2e` literals are recorded separately. A route reached only by a unit test is **not** reached by the product |
| **Result** | **958 operations · 849 reached by a production client · 109 with no production caller · 13 reached ONLY by mobile** |

### The three traps the brief named, and what each cost

- **`/api` prefix.** `frontend/src/lib/api.js:16` sets `baseURL = ${BACKEND_URL}/api`, so the client writes `/v1/ganit/invoices` for the OpenAPI's `/api/v1/ganit/invoices`. Handled by matching both spellings.
- **Dynamically-composed bases.** A naive scan reported **361** orphans. `BillingUsageSection`/`OutboundLog`/`MemberCeilingModal` take a `basePath` prop that is `/v1/billing/me` or `` `/v1/billing/orgs/${orgId}` `` (`AdminUsagePage.jsx:124`, `TabBilling.jsx:365`) — **18 `/api/v1/billing/*` operations were false orphans on that one prop alone.** `CustodyTab.jsx:167` (`` const path = `/v1/custody/offboarding/${employeeId}` ``) accounted for another. Those five call sites are resolved by an explicit alias table; the count fell 361 → 152 → 131 → **109**.
- **Mobile is a second client.** 13 deployed operations have **no web caller and a real mobile one** — they are NOT orphans. Listed in §3.9 so nobody re-files them.

### Deploy state, stated because "verifying the wrong thing" is a named failure

| | |
|---|---|
| Local `HEAD` | `f4f508bc` *(feat: suite 06 Kray, and a revision route that no screen had ever called)* |
| Railway staging, SUCCESS at sweep time | `0684ad8b` = commit `88229cc3`, then `62ae9ce5` = `f9d3c82f` BUILDING |
| `GET /api/health` | `{"status":"ok","db":"connected","schema":"staging","environment":"staging","outbound_mode":"live"}` |
| **Consequence** | The OpenAPI is from a SHA **behind local HEAD**. The path set is identical across both fetches and no route was added by the newer commits, so **Direction A holds**; Direction B is computed client-at-HEAD against api-at-deployed, which can only produce *false* "no such path", and both survivors were confirmed live |

⚠ **There are sixteen schemas now, not fourteen.** `CLAUDE.md` records fourteen measured 2026-08-27. Live, 2026-08-29: the two named there plus **`pgbouncer`** and **`reseed_backup_20260828`**. Every "does not exist" claim below was checked against `pg_class` across all of them, not against one schema.

### What I did NOT sweep — read this before treating the matrix as complete

1. **Reachability is `[route ⇢ literal]`, not `[route ⇢ rendered control]`.** A route a screen calls in a code path no button can trigger reads as REACHED here. This sweep cannot see a disabled button, a tab that never mounts, or a role gate that bounces before the fetch — that is Suite 22's job, and 93 §A.1 (`platform_support`) is exactly a defect this method is blind to.
2. **Query-string-only capability is invisible.** A route reached with `?status=` that no screen ever passes reads as fully reached.
3. **Direction C is `[model field ⇢ identifier anywhere in client source]`.** A field named in a comment counts as sent. That is generous on purpose; §5 corrects the one false positive it produced and I found by re-checking (`resume_key`).
4. **Backend-internal callers are not mapped.** A route with no client caller may still be called by a service or cron; where I could tell (`territory_routing`, `pull_indiamart_for_org`) I say so, but I did not build a call graph.
5. **`docs/` and `e2e-real/` were not counted as clients.** A route only an E2E spec touches is orphaned by this document's definition, and that is the definition the owner's question asks for.
6. **No screenshot, no browser.** Per the assignment this is static analysis plus live read-only probes. Every 200/404/405/500 below came from `curl` with an org-scoped token (`E2E_UNICODE_TOKEN`, `org_admin @ Unicode Group`) or from an unauthenticated request where the status alone was the evidence. **No write probe was made.**

---

## 1 · Ranked — what blocks a NEW CUSTOMER'S FIRST WEEK

The owner's question is *"a client gets a completely new org, starts using it, and things break."* These are ordered by that, not by how interesting they are.

| # | Finding | Evidence | Verdict |
|---|---|---|---|
| **1** | **The rate-card Delete button shows a raw "Method Not Allowed".** `RateCardsTab.jsx:85` calls `DELETE /v1/ganit/billing/rate-cards/{id}`; the deployed API publishes **PATCH only** | Live, unauthenticated (404 would mean no route): `DELETE …/rate-cards/000…000` → **405**; `PATCH` same path → **401**. OpenAPI: `/api/v1/ganit/billing/rate-cards/{card_id}` → `['patch']` | **PRODUCT BUG · ORPHANED (control→no route) · ACTIVE** |
| **2** | **The Vikray "Prorate" button can never work.** `TargetsTab.jsx:157` calls `GET /v1/client-billing/quota-proration`. That path does not exist; the real one is `/v1/ganit/billing/quota-proration` | Live: `/api/v1/client-billing/quota-proration?…` → **404**; `/api/v1/ganit/billing/quota-proration?…` → **401** (route exists, auth refused). The correct route is ALSO in the Direction A orphan list — a matched pair, one route and its only intended caller, neither reaching the other | **PRODUCT BUG · ORPHANED (both directions) · ACTIVE** |
| **3** | **Pausing a Prachar sequence is still a one-way door in the browser.** `SequencesTab.jsx:253` has a Pause button on `POST /sequences/{id}/pause`. **There is no Resume button anywhere.** `POST /sequences/{id}/resume` was added 2026-08-20 with a docstring reading *"Added 2026-08-20 — before this, pause was a ONE-WAY DOOR"* — the route landed, the control never did | `grep -nE "pause\|resume" pages/prachar/SequencesTab.jsx` → one `pause`, zero `resume`. Live: `staging.prachar_sequences` = **3 rows, 0 paused** — LATENT, and it becomes ACTIVE the first time anyone presses Pause | **PRODUCT BUG · ORPHANED (route→no control) · LATENT** |
| **4** | **A scheduled campaign can never be scheduled.** `POST /prachar/campaigns/{id}/schedule` is, in its own words, *"The only way into that state"* — nothing else writes `status='scheduled'`, and the cron sends on that status. `CampaignsTab.jsx:107` drag-to-reschedule sends `PATCH /campaigns/{id}` with `scheduled_at` instead, which the same docstring says leaves the status at `'draft'` | `grep` for `campaigns/.*schedule` in `frontend/src` → one hit, and it is the PATCH. Live: `staging.prachar_campaigns` = **1 row, 0 in `scheduled`** | **PRODUCT BUG · ORPHANED · LATENT** (a date is written that will never fire) |
| **5** | **`GET /api/v1/graha/inbound-emails` has 500'd for its entire life — AND the ingest path writes a column that does not exist** | Live probe, org_admin token → **500**. Railway deploy log `0684ad8b`, `2026-08-29T09:06:58Z`: `Unhandled error on GET /api/v1/graha/inbound-emails` … `File "/app/routers/graha.py", line 3208, in list_inbound_emails`. Line 3208 is inside the projection. **Live catalogue: `staging.graha_inbound_emails` has 8 columns — `id, org_id, sender, subject, body_text, parsed_data, status, created_at`. There is no `contact_id`, in `staging` or `public`.** The handler selects it. Worse: `graha.py:3114` and `:3168` both `UPDATE … SET contact_id=` on the ingest path, so the inbound-lead webhook 500s **after** it has created the contact and the email row | **PRODUCT BUG · ORPHANED and BROKEN · LATENT** (`graha_inbound_emails` = **0 rows**; the webhook needs `_INBOUND_SECRET` + HMAC and has never been called) |
| **6** | **Pahchan department/site/person policy overrides have no screen at all.** `GET/PUT /pahchan/policy/scopes`, `DELETE /policy/scopes/{id}` and `GET /policy/effective` are complete, gated, reviewed and answer 200. `PahchanPolicy.jsx` calls **only** the org-wide `GET/PATCH /v1/pahchan/policy` | `grep "policy/scopes\|policy/effective"` across `frontend/src` + `mobile/src` → **0**. Live: `/api/v1/pahchan/policy/scopes` → `200 {"data":[]}`; **`staging.pahchan_policy_overrides` = 0 rows, all orgs, all time.** §4 asks for "Policy · department overrides | 1 · 4" — **the 4 are unachievable** | **PRODUCT BUG · ORPHANED · LATENT** |
| **7** | **The DPDP data-subject surface is built and unreachable, and the screen says the opposite.** `GET /v1/me/sessions`, `POST /v1/me/export`, `POST`+`DELETE /v1/me/delete`, `GET /v1/me/requests`, `POST /v1/me/devices/deregister` — six operations, none called. `pages/customize/TabData.jsx:9-11` still reads *"None of those endpoints exist in the backend — there is no user_preferences table and no /me/sessions router"* | Live: `/api/v1/me/sessions` → **200** with a real session object. The comment is **false at HEAD**. ⚠ Reported faithfully: `/api/v1/me/requests` → **503**, *"the account_requests table has not been created on this environment. Your request was NOT recorded"* — and I confirmed that: **`account_requests` exists in NO schema** (`pg_class` across all 16). So export/delete are honestly blocked, but `sessions` and `devices/deregister` work today and no screen offers them | **BLOCKED (export/delete, migration owed) + PRODUCT BUG (sessions/deregister, ORPHANED) · LATENT** |
| **8** | **A recurring task cannot be created from any screen.** `TaskCreate.recurrence` / `TaskUpdate.recurrence` are real nested models written to `tasks.recurrence_rule` / `recurrence_interval` (`server.py:4764`, `:5274`). The identifier `recurrence` appears **nowhere** in `frontend/src` or `mobile/src` outside a Hindi label and unrelated billing prose | Live: `public.tasks` = **286 rows, 0 with `recurrence_rule <> 'none'`**. §4 asks for recurrence on 12 tasks per org — **unachievable** | **PRODUCT BUG · ORPHANED (Direction C) · LATENT** |
| **9** | **The invite dead end the `claim` route was written to close is still live.** `POST /auth/invite/{token}/claim` exists with a 30-line docstring about the exact dead end. `lib/auth.js` calls `/auth/accept-invite`, `GET /auth/invite/{token}` and `POST /auth/invite/{token}/decline` — **never `/claim`** | `grep -E "api\.(get\|post)\([^)]*invite"` across `frontend/src` → 8 hits, none of them `claim`. So a person already holding an account, invited to a second org, still gets the 409 and the copy still promises the invite is applied | **PRODUCT BUG · ORPHANED · ACTIVE** for anyone in two orgs |
| **10** | **Six HR/payroll fields the API accepts and no form sends** — every one 0-filled live | `manav_employees.reporting_to` **0 of 30** · `manav_departments.head_employee_id` **0 of 6** · `manav_leave_types.max_carry_forward` **0 of 6** · `vetana_salary_structures.other_allowances` **0 of 30** · `manav_job_openings.department_id` **0 of 5** · `manav_candidates.resume_key` **0 of 18 non-empty** | **PRODUCT BUG · ORPHANED (Direction C) · LATENT** |

---

## 2 · Headline counts

```
958 deployed operations
  849  reached by a production client
   13    of those, by MOBILE ONLY (not orphans - see §3.9)
  109  no production caller
   27    INTENTIONAL      cron / webhook / internal (§3.1)
    1    EXCLUDED BY DECISION  93 §13 (WhatsApp)
   14    SUPERSEDED / dead legacy surface (§3.8)
   67    ORPHANED CAPABILITY  a feature a customer cannot reach

Direction B  959 statically-resolved client call sites, 2 unserved (both live-confirmed)
Direction C  254 request-body models, 31 carrying a field no client has ever named
```

---

## 3 · Direction A — the full matrix

### 3.1 INTENTIONAL — no UI caller is correct (27)

| Route(s) | Why it is not a defect |
|---|---|
| `POST /api/internal/cron/{agents,analytics,billing,crm,esign,hr,invoices,leads,marketing,pahchan-retention,project-bin,publish,recycle-bin,reminders,reports,retention,scraper-prices,skills,stock}` (19) | `routers/scheduler.py`, `CRON_SECRET` via `_verify_cron`. ⚠ `/cron/reports` and `/cron/esign` are the 501 stubs `CLAUDE.md` forbids arming — untouched |
| `GET /api/internal/niyam/status`, `POST /api/internal/niyam/{prune,sweep}` (3) | `routers/niyam.py`, automation engine internals |
| `POST /api/task-reminders/dispatch` | *"Called every few minutes by an external cron"*, `TASK_REMINDER_DISPATCH_SECRET`, constant-time compare |
| `POST /api/v1/hub/publish/dispatch` | `PUBLISH_DISPATCH_SECRET`, same pattern |
| `GET`+`POST /api/v1/whatsapp/webhook` (2) | Meta webhook. Also 93 §13 |
| `POST /api/v1/graha/inbound-leads` | HMAC-signed inbound-email webhook (`x-webhook-signature`). ⚠ **Also carries finding 5's broken `contact_id` write** |

### 3.2 Graha — CRM (11 orphaned, 1 intentional above)

| Route | Evidence | Class |
|---|---|---|
| `GET /graha/scoring-rules`, `PATCH /graha/scoring-rules/{id}` | `grep "scoring-rules"` in `frontend/src` → **0**. Live: `200 {"data":[]}`; `staging.graha_scoring_rules` = **0 rows**. STATUS.md already records "no screen AND no route creates a lead-scoring rule" — **the READ and the EDIT exist**, only create does not, so the finding is narrower and worse: rules could be listed and tuned today if a screen existed | ORPHANED · LATENT |
| `POST /graha/contacts/{id}/rescore` | `grep rescore` → **0** API calls. The org-wide `rescore-all` is also uncalled | ORPHANED · LATENT |
| `GET /graha/inbound-emails`, `GET /graha/inbound-emails/{id}` | **Finding 5.** The list 500s on a column that does not exist | ORPHANED + BROKEN |
| `GET /graha/contacts/{id}/duplicates` | `DedupeTab.jsx:144` calls the **collection** route `/graha/contacts/duplicates`. The per-contact one has no caller — so "is this one contact a duplicate?" is unanswerable from the contact | ORPHANED · LATENT |
| `GET /graha/contacts/{id}/projects` | `grep "contacts/.*projects"` → **0**. A contact's projects are never shown | ORPHANED · LATENT |
| `POST /graha/territories/{id}/assign-next` | Docstring: *"Whose turn is it — **the manual button**"*, and *"Before 2026-08-27 this endpoint had ZERO callers in the repo"*. It still has zero. Phase 7.1 made the shared helper the automatic path, so the SERVICE is used; **the button named in the docstring does not exist**. `staging.graha_territories` = 7 | ORPHANED · LATENT |
| `POST /graha/leads/pull/indiamart` | Docstring: *"**The button.**"* `grep "leads/pull"` → **0**. Only `/cron/leads` reaches the shared function | ORPHANED · LATENT |
| `POST /graha/f/{slug}` | The public web-form submit. No public page posts to it. `staging.graha_web_forms` = **2**, `graha_web_form_submissions` = **0**. Already on OWNER-ACTIONS 19; confirmed independently here | ORPHANED · LATENT |

### 3.3 Manav / Custody — HR and the statutory registers (13)

| Route | Evidence | Class |
|---|---|---|
| `GET`+`POST /manav/availability` | `grep "manav/availability"` → **0**. Live `200 {"data":[],"total":0}`; `staging.manav_availability` = **0 rows**. `POST` is *"Self-service, and only ever for yourself"* — an employee can never say when they are free, so `ShiftBids`/`SwapRequests` route against nothing | ORPHANED · LATENT |
| `POST /manav/schedules/bulk` | `ScheduleGrid.jsx:53` posts `/v1/manav/schedules` one cell at a time. `staging.manav_schedules` = 150, so the roster IS buildable — the bulk path is a performance affordance, not a capability | ORPHANED · **LOW** |
| `GET /manav/employees/{id}/assets` | `grep` → **0**. `staging.manav_assets` = 24 issued; "what kit does this person hold" has no screen | ORPHANED · LATENT |
| `GET /manav/exit-interviews/reasons` | Docstring: *"Why people leave, counted. **The reason the structured fields exist.**"* Live `200` with **real aggregated data** off 4 exit interviews. Nothing draws it | ORPHANED · **ACTIVE data, no screen** |
| `GET /manav/expense-claims/pending-count` | Live `200 {"count":9}` — a badge count that exists and is never shown | ORPHANED · LATENT |
| `GET /custody/udin/windows` | Live `200 {"generate_days":60,"revoke_hours":48,"sources":{"generate":"table","revoke":"table"}}`. The ICAI 60-day generation window and 48-hour revocation window, resolved from `staging.udin_window` (2 rows) — **and no UDIN screen shows either deadline**. `UdinTab.jsx` calls five custody routes; none is this one. `udin_register` = 7 | ORPHANED · **ACTIVE** (a real statutory deadline nobody can see) |
| `GET /custody/udin/syntax` | Advisory UDIN-string describer. No caller | ORPHANED · LATENT |
| `GET /custody/notices/overdue` | *"Live notices whose reply date has already passed, worst first."* No caller. `notice_register` = **0 rows** | ORPHANED · LATENT |
| `GET /custody/dsc/expired`, `GET /custody/dsc/not-in-possession` | Live `200 {"as_of":"2026-08-29","data":[],"count":0}`. `DscTab.jsx` calls four custody routes; neither of these. `dsc_register` = 4 | ORPHANED · LATENT |
| `GET /custody/offboarding/{id}/ledger` | *"the full ledger, including settled lines … A settled line is the evidence the exit was handled"*. `CustodyTab.jsx:167` builds `/v1/custody/offboarding/{id}` (outstanding only) and posts `${path}/lines`; it never reads `/ledger`. **A firm has no way to show an exit was handled** | ORPHANED · **ACTIVE** — live: `manav_offboarding` **8**, `manav_offboarding_custody` **12**. ⚠ STATUS.md still records custody at **0 rows**; the 422 fix has landed and 12 lines now exist — **which is exactly when this orphan starts to matter** |
| `GET /custody/offboarding/inherited/me` | *"What the CALLER has absorbed from other people's exits … a capacity problem worth seeing"*. No screen | ORPHANED · LATENT |

### 3.4 Hub / Sahayak (14 orphaned, 2 superseded)

| Route | Evidence | Class |
|---|---|---|
| `POST /hub/org/credits/topup` | The **org-level** top-up. `CreditsTab.jsx:43` posts the per-CLIENT route; `TopUpDialog.jsx:88` posts the admin route. `staging.hub_org_credits` = 5, `hub_org_credit_transactions` = 18 — so top-ups DO happen, through the other two doors | ORPHANED · LOW |
| `POST`+`DELETE /hub/org/credits/allocate/{user}`, `GET /hub/org/credits/users` (3) | `grep "credits/allocate\|credits/users"` → **0**. The `users` docstring: *"**The over-commitment figure is the point of the screen.**"* There is no screen. Live `200` with a real `commitment` block. `staging.org_member_credits` = 3 (written by the sibling `/v1/billing/*/members/{u}/cap` mechanism instead) | ORPHANED · LATENT |
| `GET`+`PUT /hub/org/brand` (2) | `grep "org/brand"` → **0**. Live `GET` → `200 {}`. `staging.hub_brand_profiles` = 1 (a CLIENT profile, via `/clients/{id}/brand`). An org's own brand profile can never be set | ORPHANED · LATENT |
| `POST /hub/org/generate` | Org-level content generation with org credits. Only the per-client generate is wired | ORPHANED · LATENT |
| `GET`+`PUT`+`DELETE /hub/ai-conversations/{context_type}` (3) | `grep` → **0**. `staging.ai_conversations` = **0 rows** | ORPHANED · LATENT |
| `GET /hub/ai-feedback/stats` | Live `200 {"by_skill_action":[],"total_feedback":0}`. `staging.ai_feedback` = **0 rows**. ⚠ **Already self-documented** — `SahayakTab.jsx:196-208`: *"NOTHING ON THIS [screen writes it] … So `GET /v1/hub/ai-feedback` and `/ai-feedback/stats` keep answering zero"* | ORPHANED · LATENT, **known** |
| `GET /hub/analytics/spend`, `GET /hub/clients/{id}/analytics/spend` (2) | `grep "analytics/spend"` → **0**. AI cost analytics behind `SAHAYAK_COMMERCIAL_ROLES`, no console screen | ORPHANED · LATENT |
| `GET /hub/clients/{id}/content/{cid}/approvals` | Content review history. ⚠ Its own comment documents a cross-tenant read that was fixed here — **the fix is real, the screen is not** | ORPHANED · LATENT |
| `GET /hub/clients/{id}/skills/{sid}/runs` | Per-skill run history. No caller | ORPHANED · LATENT |

### 3.5 Client billing / subscription / scrapers / admin console (11)

| Route | Evidence | Class |
|---|---|---|
| `GET /ganit/billing/quota-proration` | **Finding 2's other half.** The route is fine; its only intended caller misspells the path | ORPHANED · ACTIVE |
| `GET /subscription/admin/proration-preview`, `POST /subscription/admin/backdated-adjustment` (2) | `grep "proration\|backdated"` in `pages/admin` + `AdminBillingPage.jsx` → **0**. §10 Suite 17 asks for *"mid-cycle downgrade quoting credit and charge over the same days"* — **the preview that would quote it has no caller** | ORPHANED · LATENT |
| `GET /subscription/my-roles` | Live `200 {"platform_roles":[],"org_roles":[{…"role":"org_admin"}]}`. Nothing reads it | ORPHANED · LOW |
| `GET /scrapers/admin/usage`, `GET /scrapers/admin/runs` (2) | `grep "scrapers/admin"` → **0**. Per-org scraper cost and margin, behind `_finance`/`_admin`. `staging.hub_scraper_runs` = 1. The Aekam cost console cannot see scraper spend | ORPHANED · LATENT |
| `PUT /v1/admin/orgs/{org}/members/{u}/modules` | **The route's own docstring says it: *"No frontend calls this — it is API-only surface."*** Self-documented orphan | ORPHANED · INTENTIONAL-by-note |
| `GET /v1/admin/orgs/{org}/members/{u}/modules` | Its read sibling. No caller | ORPHANED · LATENT |
| `DELETE /v1/admin/orgs/{org}/members/{user_id}` | Aekam cannot remove a member from a customer org from the console | ORPHANED · LATENT |
| `GET /v1/admin/orgs/{org}/credits/usage` | Credit usage report with a date range. No console screen | ORPHANED · LATENT |
| `GET /v1/audit/summary` | Live `200` with **real data** — `vetana.payslip_pdf_downloaded n=80`. Docstring: *"what makes a single `platform.module_write` against your org visible without reading 800 rows"*. `staging.audit_log` = **2,240 rows** and no screen shows the shape | ORPHANED · **ACTIVE data, no screen** |

### 3.6 Dristi / dashboards / reporting (7)

| Route | Evidence | Class |
|---|---|---|
| `GET`+`POST /api/dashboards/`, `PUT`+`DELETE /api/dashboards/{id}`, `GET /api/dashboards/{id}/data` (5) | An entire personal dashboard-widget CRUD in `backend/routers/dashboards.py` (widgets: count / chart / my_work / deadlines). **Zero callers.** Live `GET /api/dashboards/` → `200 []`. **`public.dashboards` = 0 rows in its entire life.** The product's dashboards are `dristi_dashboards` via `/v1/dristi/dashboards` (`DashboardsTab.jsx:78`) — a **different table and a different router**. ⚠ `staging.dristi_dashboards` is ALSO 0 rows, but that is code-without-data, not an orphan | ORPHANED · **DEAD PARALLEL IMPLEMENTATION** |
| `GET /api/dashboard/summary` | Live `200 {"todo":6,"in_progress":1,"done":6,"overdue":0,"due_24h":0}` — a working task-count summary for a dashboard, with no caller | ORPHANED · LATENT |
| `GET /v1/statute/obligations` | Live `200` with real obligations. `routeModules.js:269` pins `DUE_SOURCE = '/v1/statute/due'`, so the dock reads *due* items only. The **full calendar in force on a date** (`statute_calendar` = 61 rows) has no screen | ORPHANED · LATENT |

### 3.7 Core PM / auth / org (7)

| Route | Evidence | Class |
|---|---|---|
| `POST /auth/invite/{token}/claim` | **Finding 9** | ORPHANED · ACTIVE |
| `GET /api/activity/team/{team_id}` | Paginated per-team activity with actor and type filters. `grep "activity/team"` → **0** | ORPHANED · LATENT |
| `POST`+`DELETE /api/tasks/{id}/clients/{target_user_id}` (2) | Grant/revoke a client user's access to ONE task. `grep "tasks/.*clients"` → **0**. ⚠ Both were hardened in a named security fix; the hardening is real, the control is not | ORPHANED · LATENT |
| `PATCH /api/teams/{team_id}/brand` | *"Update a project's brand kit (colors + fonts)."* `BrandKit.jsx:179` writes the ORG kit via `PUT /settings`. **Per-project branding is unreachable** | ORPHANED · LATENT |
| `PUT /api/admin/users/{user_id}/role` | The second door onto `users.role`. `AdminPage.jsx` uses `/roles/assign`. Legacy but live and admin-gated | SUPERSEDED · LATENT |
| `POST /api/notifications/process` | **Not a cron** — `require_user` + `active_org_id`, processes the CALLER's own due reminders. Superseded by `/cron/reminders` + `/task-reminders/dispatch` | SUPERSEDED · LOW |

### 3.8 SUPERSEDED / dead legacy surface (14) — orphaned, but nothing is missing

| Route(s) | Superseded by |
|---|---|
| `PATCH`+`DELETE /v1/ganit/products/{id}` (2) | `ProductsTab.jsx` moved to `/v1/products/{id}` (its own header explains why). `staging.ganit_products` = 21, edited through the new door |
| `PUT /api/settings/brand-colors` | `PUT /settings` (`BrandKit.jsx:179`). The alias's own comment says it must not be the easier way in |
| `GET /v1/esign/documents/{id}/audit` | `DetailTab.jsx:63` takes `audit_trail` from `GET /v1/esign/documents/{id}`. `staging.sign_audit_log` = 0 |
| `GET /v1/maps/address/suggest` | **Mappls moved client-side.** `AddressSuggest.jsx:260` calls `sdk.search(...)`; its own docstring at line 39 still names the dead route. Live: `200 {"available":false,"reason":"unavailable"}`, and the deploy log says why — *"mappls autosuggest refused the OAuth token (HTTP 401) — the token minted but the Autosuggest product did not accept it"* |
| `POST /api/notifications/process`, `PUT /api/admin/users/{id}/role` | see §3.7 |
| `POST /api/v1/graha/contacts/rescore-all` and 6 others reached only via `{}`-segment composition | Counted as REACHED by the generous matcher; listed here for honesty because I could not prove a specific action value is passed |
| `DELETE /v1/whatsapp/templates/{id}` | **EXCLUDED BY DECISION** — 93 §13, Varta is out of scope |

### 3.9 MOBILE-ONLY — reached, and NOT orphans (13)

The brief's warning, confirmed. Each of these has **no web caller** and a real mobile one:

```
POST   /api/auth/sign-out-everywhere            mobile/src/api/auth.ts:151
POST   /api/me/push_tokens                      mobile/src/api/notifications.ts:36
DELETE /api/me/push_tokens/{device_id}          mobile/src/api/notifications.ts:39
PATCH  /api/teams/{team_id}/color               mobile/src/api/projects.ts:12
GET    /api/v1/graha/pipeline-summary           mobile/src/api/modules.ts:111
GET    /api/v1/graha/pipelines                  mobile/src/api/graha.ts:349
POST   /api/v1/graha/pipelines                  mobile/src/api/graha.ts:349
GET    /api/v1/hub/dashboard                    mobile/src/api/modules.ts:325
POST   /api/v1/pahchan/enrollment               mobile/src/api/pahchan.ts:291
GET    /api/v1/pahchan/enrollment/{employee_id} mobile/src/api/pahchan.ts:287
GET    /api/v1/sync/state                       mobile/src/offline/sessionSync.ts:226
GET    /api/v1/sync/tombstones                  mobile/src/offline/sessionSync.ts:18
GET    /api/v1/vetana/payslips                  mobile/src/api/modules.ts:253
```

⚠ **`POST /api/v1/graha/pipelines` is mobile-only.** STATUS.md records *"no control creates a pipeline (`create_deal` silently inserts one nobody typed)"* — that is true **of the web app**. The mobile client can create one. The sentence needs the qualifier.

---

## 4 · Direction B — controls whose route the deployed API does not serve

**959 of 1,014 client call sites resolved statically.** 24 initially failed to match; segment-wise re-judging cleared 22 as dynamic-action composition (each verified against the published sibling set: `/tasks/{id}/{archive|unarchive|toggle|move}`, `/approvals/by-token/{t}/{approve|reject}`, `/graha/{clients|contacts}/{id}/coordinate`, `/subscription/modules/{activate|deactivate}`, `/templates/{projects|tasks}/{id}`, `/procurement/purchase-orders/{id}/{submit|issue|close|reject|receipts}`, `/manav/expense-claims/{id}/{approve|reject}`, `/hub/publish/queue/{id}/{cancel|publish-now}` — all published).

**Two survive, both confirmed live, both in §1:**

| Call site | Sends | Deployed API answers | Verdict |
|---|---|---|---|
| `frontend/src/pages/ganit/RateCardsTab.jsx:85` | `DELETE /v1/ganit/billing/rate-cards/{id}` | **405 Method Not Allowed** — the path publishes `patch` only | **PRODUCT BUG · ACTIVE** |
| `frontend/src/pages/vikray/TargetsTab.jsx:157` | `GET /v1/client-billing/quota-proration` | **404** — no such path; the real one is `/v1/ganit/billing/quota-proration` | **PRODUCT BUG · ACTIVE** |

One further hit was a **TEST fixture**, not the product: `frontend/src/__tests__/e2e/network-isolation.test.js:89` posts `/invites`, which is not a published path. Recorded so it is not mistaken for a defect.

**55 call sites could not be resolved statically** (the first argument is a variable or a helper parameter). Every one was traced by hand to its base — the five alias sites in §0, plus `dristi/_shared.jsx`, `manav/_shared.jsx`, `vetana/_shared.jsx`, `prachar/_shared.jsx`, `hub/_shared.jsx`, `pahchan/Register.jsx` and `skills/dock/useDockData.js`, all of which take a literal from their caller and are therefore covered by the literal harvest. **No unresolved call site is unaccounted for.**

---

## 5 · Direction C — the model/column variant

`254` Pydantic models are bound as a request body on a POST/PUT/PATCH route. **31 carry at least one field whose identifier appears NOWHERE in `frontend/src` or `mobile/src`** — not in a call, not in a form, not in a comment.

### 5.1 The ones with a customer consequence

| Model · field | Route | Live count | Note |
|---|---|---|---|
| `TaskCreate`/`TaskUpdate`.**`recurrence`** | `POST /tasks`, `PATCH /tasks/{id}` | `public.tasks` **286 rows, 0 recurring** | §4 asks for recurrence on 12 tasks |
| `EmployeeCreate`/`Update`.**`reporting_to`** | `POST`/`PATCH /manav/employees` | **0 of 30** | No reporting line can be recorded |
| `DepartmentCreate`.**`head_employee_id`** | `POST`/`PATCH /manav/departments` | **0 of 6** | No department head |
| `LeaveTypeCreate`.**`max_carry_forward`** | `POST /manav/leave-types` | **0 of 6** | Leave carry-forward cannot be configured — statutory-adjacent |
| `SalaryStructureCreate`/`Update`.**`other_allowances`** | `POST`/`PATCH /vetana/salary-structures` | **0 of 30** non-empty | `StructuresTab.jsx:18` sends `special_allowance`, `conveyance`, `medical` and stops |
| `PayrollProcessRequest`.**`final_settlement`** | `POST /vetana/payroll/process` | — | `ExitsTab.jsx:364` says *"the final settlement all hangs off this record"*; nothing sends the flag |
| `JobOpeningCreate`.**`department_id`** | `POST /manav/job-openings` | **0 of 5** | |
| `CandidateCreate`.**`resume_key`** | `POST /manav/candidates` | **0 of 18** non-empty | The form (`RecruitmentTab.jsx:307`) takes a typed `resume_url` and offers no file input. The router's own comment says the column *"has existed since migration 057 with no writer"* — **still true** |
| `RegularisationCreate`.**`evidence_key`** | `POST /pahchan/regularisations` | table 0 rows | No evidence attachment on an attendance correction |
| `VendorBillCreate`.**`attachment_url`** | `POST /ganit/vendor-bills` | **0 of 17** non-empty | |
| `UdinRevocation`.**`replaced_by_udin`** | `POST /custody/udin/{id}/revoke` | `udin_register` = 7 | ICAI: a revoked UDIN's replacement cannot be recorded |
| `NewCertificate`.**`custody_changed_on`** | `POST /custody/dsc` | `dsc_register` = 4 | |
| `WebFormCreate`.**`auto_assign_to`** | `POST /graha/web-forms` | **0 of 2** | A web form can never route to a person |
| `DealUpdate`.**`lost_reason`** | `PATCH /graha/deals/{id}` | **30 deals, 0 reasons** | Already on OWNER-ACTIONS 19; independently reconfirmed |
| `PolicyScopeBody`.**`scope_kind`, `scope_ref`** | `PUT /pahchan/policy/scopes` | 0 rows | Confirms finding 6 from the model side |
| `AvailabilitySet`.**`is_available`, `preferred_shift_id`** | `POST /manav/availability` | 0 rows | Confirms §3.3 |
| `DeregisterDevice`.**`device_ref`** | `POST /me/devices/deregister` | — | Confirms finding 7 |
| `GenerateUsageInvoice`.**`usage_ids`** | `POST /ganit/billing/metered-usage/generate-invoice` | — | Confirms the brief's finding 4 |

### 5.2 Blocked, not orphaned — reported separately because the sentences differ

**`CommentCreate.is_client_visible` / `CommentUpdate.is_client_visible`** looks like an orphan and is not. `public.task_comments` **has no `is_client_visible` column** (checked live across `staging` and `public`: zero rows in `information_schema.columns`), because PROPOSED_072 is unapplied. `server.py:3353` probes for the column at runtime and **fails closed**, and `list_comments` returns `[]` to a portal client. The consequence is real and is worth the owner knowing: **a client-portal user sees zero task comments, always** — 31 comments live, 0 visible. That is deliberate and documented. **BLOCKED (migration owed), not broken.**

### 5.3 The rest (lower impact, listed for completeness)

`AIFeedbackCreate.tokens_used` · `AgreementBody.{client_obligations, payment_days, notice_days, cure_days, term_months, provider_is_msme, tds_rate, project_ref, status_note}` · `BrandProfileUpdate.{color_accent, social_handles, sample_posts}` · `ContentReview.review_notes` · `FindingAck.snooze_until` · `OrgContentGenerate.aspect_ratio` · `ProjectReportBody.{prepared_by, overall_state, planned_hours, planned_fee, milestone_note, client_contact_id}` · `WATemplateCreate.{header_type, header_content}` (§13) · `SocialAccountConnect.refresh_token` (§13).

⚠ `AgreementBody` and `ProjectReportBody` are the two PDF generators. Their routes **are** called (`ContractDetail.jsx:218`, `ProjectBoardPage.jsx:328`) — but with none of those 15 fields, so every generated agreement and project report is rendered on defaults. That is a partially-wired control, not an orphan.

### 5.4 `_*_COLS` allowlist tuples

`_DEAL_COLS` (`graha.py:2092`) is the reference case and is already fully documented in the file's own header: `territory_id`, `contact_id`, `lost_reason` and `pipeline_id` are **four columns of one tuple** caught by this disease.

I enumerated every `_*_COLS` / `_*_COLUMNS` / `_*_FIELDS` tuple in `backend/` outside `.venv` and `tests` — **25 of them** — and read each one. **Only two are write allowlists**, and both are already accounted for:

- **`graha._DEAL_COLS`** — the reference case, four columns, filed above.
- **`org_profile._WRITABLE_COLUMNS` / `_PROFILE_COLUMNS`** — the brief's finding 1, fixed and deployed at `1c749a45` today. Re-read at HEAD: all 16 columns are now on the form and in `ProfileUpdate`. `logo_key` is deliberately off the tuple and documented as such. **Clean.**

The other 23 are **projections** (`_EMP_SAFE_COLS`, `_ACCOUNT_COLS`, `_LINE_COLS`, `_TALLY_*_COLS`, `income_tax_slabs._COLS`, `_TENANT_RUN_FIELDS`, `_USER_COLUMNS*`, `_KEY_COLUMNS`), sensitive/encrypted-column lists (`_SENSITIVE_COLS`, `_ENCRYPTED_COLS`), ID-column lists (`_LEDGER_ID_COLUMNS`, `_LEAVER_ID_COLUMNS`, `_PLATFORM_ACTOR_COLUMNS`, `_UUID_FIELDS`), or merge/type helpers (`_MERGEABLE_FIELDS`, `_JSON_FIELDS`, `_JSONB_COLUMNS`, `_PENDING_COLUMNS`, `_PT_STATE_COLUMNS`, `_ATTACHMENT_POINTER_FIELDS`). A projection cannot carry this disease in the write direction — **but it can carry it in the read direction, and one does**: `manav._EMP_SAFE_COLS:141` lists **`reporting_to`**, so the API returns the field on every employee read while no form can ever set it. That is finding 10 seen from the other side.

**Caveat, stated rather than implied:** this is a read of 25 tuples, not a proof. A write allowlist spelled some other way (an inline `{...}` set inside a handler, as `_DEAL_COLS` itself is) would not be in this enumeration. `_DEAL_COLS` was found because it is named in `graha.py`'s own header, not because the grep pattern reached inside function bodies.

---

## 6 · Corrections to the record

1. **`AddressSuggest.jsx:39`** documents `GET /api/v1/maps/address/suggest` as the data source. It is not — line 260 calls the Mappls **SDK**. The server route answers `{"available":false}` and the deploy log shows the OAuth token being refused by the Autosuggest product.
2. **`pages/customize/TabData.jsx:9-11`** states the `/v1/me/*` endpoints *"do not exist in the backend"*. Five of six exist and answer today.
3. **STATUS.md: *"no control creates a pipeline"*** — true of the web app only. `POST /v1/graha/pipelines` has a mobile caller (`mobile/src/api/graha.ts:349`).
4. **`CLAUDE.md` says fourteen schemas.** Live 2026-08-29: **sixteen** — `pgbouncer` and `reseed_backup_20260828` were added since the 08-27 measurement.
5. **STATUS.md's custody counts have moved.** It records `manav_offboarding` **10** / `manav_offboarding_custody` **0**. Live 2026-08-29: **8** and **12**. The custody write path works now.
6. **My own first count was wrong and I am recording it.** `manav_candidates.resume_key` read as **18 of 18 filled** until I noticed `count()` counts the empty string, and the model defaults `resume_key: str = ""`. Re-queried with `coalesce(…,'') <> ''`: **0 of 18.** Any 0-fill claim above uses the non-empty form.

---

## 7 · What I fixed — nothing, and the reason is the coordination list

**Zero code changes. Zero commits.** Both of the Direction B defects are small and unambiguous and I did not touch either, because both live inside another agent's declared territory:

| Finding | File | Owner per the brief |
|---|---|---|
| Rate-card `DELETE` → 405 | `frontend/src/pages/ganit/RateCardsTab.jsx` + `backend/routers/client_billing.py` | the client-billing agent (its finding 4) |
| Vikray proration → 404 | `frontend/src/pages/vikray/TargetsTab.jsx` | the Vikray agent |
| Prachar Resume button | `frontend/src/pages/prachar/SequencesTab.jsx` | not named, but `backend/routers/prachar.py` and `suite11-prachar.spec.ts` are, and **that suite is driving these screens right now** — editing them mid-run produces a red nobody can attribute |
| `graha_inbound_emails.contact_id` | `backend/routers/graha.py` | the Vikray/Graha agent. It is also a **migration** question (a column is missing, not a projection typo), and 93 §14 reserves migrations to the lead |
| `_DEAL_COLS` `lost_reason`/`pipeline_id` | `backend/routers/graha.py` | same |

Everything else on the list is a **new control or a new screen**, which is the "the fix is large — a missing feature rather than a bug" case that 93 §7 routes to `OWNER-ACTIONS`, not to an agent's afternoon.

### ⚠ One of these is ALREADY BEING FIXED in the working tree — do not double-fix

`git diff backend/routers/client_billing.py` (uncommitted, +295 lines) contains:

```
+@router.delete("/rate-cards/{card_id}")
+    ... `DELETE /v1/ganit/billing/rate-cards/{id}`. The path published **PATCH and
```

So the client-billing agent has finding 1 in hand. **This does not weaken the finding: the live 405 is what the DEPLOYED SHA answers**, and an uncommitted edit is not a deploy — that is the cross-agent hazard `f9d3c82f`'s own commit message names ("*'the code already does X' must be checked against `HEAD`, not the working tree*"). Applied to my own report: every claim in this document is measured against **deployed staging** or against **committed HEAD**, never against another agent's uncommitted tree — and where the tree already disagrees, it is said here rather than left to be discovered.

`frontend/src/pages/vikray/` is **unmodified** in the working tree, so **finding 2 (the Vikray proration 404) is unclaimed and still open.**

### Gates not run, and why

`npm run check` and `npm run build` were **not** run. I changed no file under `frontend/src`, `backend/` or `mobile/` — the only file this agent wrote is this document. Running the gates now would report **seven other agents' uncommitted edits**, producing a red I could neither own nor attribute. That is a deliberate omission, recorded rather than silent.

**No check was added, therefore no mutation proof is claimed.** I will not report a ratchet as biting when I did not write one. If the lead wants one, the honest shape is a test that reads `app.openapi()['paths']` and asserts a named allowlist of intentionally-uncalled routes — and it must be built against `openapi()`, never `app.routes`, which returns ~7 `_IncludedRouter` entries with no `.path` under FastAPI 0.138.

---

## 8 · Summary for the ledger

| Direction | Swept | Findings |
|---|---|---|
| **A — route with no caller** | 958 deployed operations vs 9,694 client path literals | **109** with no production caller · 27 intentional · 1 excluded by decision · 14 superseded · **67 orphaned capability** |
| **B — control with no route** | 1,014 client call sites (959 static, 55 hand-traced) | **2 live-confirmed** (405 and 404), 1 test fixture |
| **C — model field no form sends** | 254 request-body models · 25 `_*_COLS`-style tuples read individually | **31 models** carrying an unreachable field · 18 with a customer consequence · 1 blocked-not-broken · **0 new write-allowlist instances** (only 2 of the 25 are write allowlists, and both were already known) |

**Three findings are ACTIVE — a customer hits them today:** the rate-card 405, the Vikray proration 404, and the invite `claim` dead end. **Two more are ACTIVE in the sense that the data exists and no screen shows it:** `audit/summary` over 2,240 rows, and the ICAI UDIN windows. Everything else is LATENT — which is not the same as harmless, only not yet walked through.

*Swept 2026-08-29 against deployed staging (`openapi.json` sha256 `7aa2b98b…`, 759 paths) and Supabase `toacecaewujfxjfrjwco`, read-only. Local HEAD `f4f508bc`. No row was written. No file was changed.*
