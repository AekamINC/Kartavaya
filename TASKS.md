# Tasks

Add anything here and I will pick it up. **Everything except the `- [ ]` line is optional** — one line is a valid task. Write it however you like; I would rather read a scrappy note than have you stop to format.

Add new items under **Inbox**. I triage from there into the priority sections, so you never have to decide where something goes.

**Tags, if you want them** — put them on the same line, anywhere:

| Tag | Meaning |
|---|---|
| `!!` | urgent — do this before whatever you were doing |
| `!` | important, not urgent |
| `@me` | I am blocked on you (a key, a decision, a billing lookup) |
| `?` | you are not sure it is worth doing — I should push back if it isn't |
| `web` `app` `api` `db` | where it lives, if you know |

Cross out with `- [x]` or just tell me it's done.

---

## Inbox — add here

- [ ] Scan a bill — drop an image, read HSN, GSTIN and the tax split off it `api` `web` `?`
  Design exists (`Scan a bill पठन`: drop zone, Choose file / Enter manually, Save) and there is a
  `Scan bill` button beside `+ Invoice` on the Ganit header. Nothing behind either today.
  You asked whether it can wait until next week — yes. It is OCR plus a field extractor, it does
  not block any of P1–P8, and it wants the bank-statement work beside it since both are
  "a document becomes rows". Parked deliberately, not forgotten.

### Mobile session & sync — decided and shipped 2026-08-09 (APK 2.0.1)

- [x] The app does not sign you out. "Remember me" → a year-long token, re-minted on every
      open. Unticked → sliding 7 days. `59bc0b3d`
- [x] `POST /auth/sign-out-everywhere` — what makes a long token safe. Per-user, kills every
      device, signs the caller out too. `59bc0b3d`
- [x] Sync on open with the lotus, delta since the last session. Push queued edits BEFORE
      pulling. `97b3f985` `59bc0b3d` (migration 138)
- [x] Local cache dumped every **3** days at 22:00 device local time — sparing unsent edits,
      unsent attendance punches, the token, the remember-me choice and the delta cursor.
- [ ] `?since=` beyond /tasks, /teams and /v1/graha/deals — invoices, contacts, clients,
      activities, follow-ups, orders. The contract is in `services/delta_sync.py`; each
      endpoint is a small change now.
- [ ] A "Sign out everywhere" button in mobile settings — the endpoint is live and nothing
      calls it yet.

### Dropped 2026-08-09 — the inbox you sent, filed verbatim

**Ganit / invoicing**

- [ ] Invoice modal is cutting fields — description, HSN, etc. `!!` `web`
- [ ] Invoice needs a UPI QR when a UPI id is present, and more ID types: UPI, GPay, BHIM, Paytm,
      PhonePe, BHIM-UPI. If several are present, a QR per service with that service's logo in the
      middle and its brand colour as the QR border. `!`
      — plan already written: `docs/proposals/32-invoice-payment-qr.html`; per-platform IDs settled.
- [ ] Invoice products must come straight from a deal or a sales order, and Sales needs Products
      so stock is known per product. `!`
- [x] Products need cost price, sale price and margin. `5b707fe0` (migration 137)
      `margin` and `margin_pct` are GENERATED columns — a stored margin is a third number that can
      disagree with the two it comes from. Cost defaults to NULL, never 0: zero cost claims the
      item is free and makes every margin 100%. All 106 products read a dash today.
- [ ] Invoice: where do expenses come from and how are they meant to work? `@me`
- [x] Create a dummy bank statement and upload it. Import CSV must read the columns, and on upload
      ask whether this is a bank already uploaded or a new one, so the column map is matched.
      `1da2883b` — the reader was POSITIONAL: it imported the header row as a transaction and read
      the Withdrawal column as income, so every payment out was booked as money in. File picker,
      guessed-then-confirmed column map, day-first dates, per-bank map remembered
      (`migration 135` not applied — saving 503s, importing works).
      Sample: `docs/samples/bank-statement-hdfc-sample.csv`.

**CRM**

- [ ] Custom fields: created in CRM against Contact or Deal, but they never appear on those forms —
      and Contact/Deal are not enough entity types. `!!`
- [x] Drop the company text field on a CRM contact — the company dropdown already exists. `59e285d3`
      Gone from the create AND the edit panel; the edit panel had the text box and no dropdown at
      all, so it has the dropdown now. Legacy rows fall back to their stored `company`.
- [ ] Client delete does not work (create works). `!!`
- [ ] Pipeline: each stage card gets that status's colour as its background, like the Boards page.
      Same for Kanban. `!`
- [x] Kanban Done / Won / Lost auto-archive 7 days after entering the status. `5d7c5391`
      Own `archived_at` column, NOT `is_active` — that one is delete, and every won-value figure
      filters on it. Clock starts at `won_at`/`lost_at`. Sweep runs in the daily `/cron/crm`;
      archive and unarchive are also manual. `migration 133` NOT APPLIED.
- [x] Territories is half-baked: user id must be a user dropdown, suggest a maps API, show the
      territory on a deal. `d4c835d0` — worse than half-baked: `assigned_users` is `UUID[]` and
      `users.user_id` is TEXT, so **nobody could ever be assigned to a territory**.
      `migration 134` NOT APPLIED. Member dropdown, names not ids on two
      screens, pincodes, territory on the deal form and both deal surfaces. MapMyIndia component
      is in — **it needs a `VITE_MAPPLS_KEY` from you.**
- [ ] Activities must show the user the activity belongs to. CRM admin and org admin see all,
      a CRM user sees only their own. `!`
- [x] CRM reports need download — plan first. `1f9bec4c` · plan:
      `docs/proposals/47-reports-download.html`, which also carries the survey of which other
      modules should get reports (Ganit's receivables ageing next; Vikray's is blocked on the
      one-company-record decision). PDF carries your org's name, address and GSTIN; Excel is a
      sheet per section plus raw deals; CSV is the deals only. Rupees grouped the Indian way.
- [ ] Documents: the user should never type a file URL, nor for folders. R2 builds the structure
      `crm/client/documents/` by default — user enters a file name, picks a client, uploads.
      Show a 10 MB limit on all documents/video. `!`
- [x] A CRM client can also be a Sales customer; a won deal converts to a sales order. `5b707fe0`
      SETTLED your way: one shared record, two modules. `graha_clients` IS the company; Sales
      references it via the new `vikray_orders.client_id` (migration 136). The "tick" is
      `is_sales_customer` on that one row, set where it is earned, never cleared — no sync job,
      because there is nothing to sync. Sales had NO customer record at all: it grouped orders by
      CONTACT, so two people at one firm were two customers. Backfilled 328 of 377 orders.
- [ ] If an org has no CRM module or no Sales module, behaviour stays exactly as it is today.
      Sales needs Products. `!`

**Automation** `!!`

- [ ] No automation works in any module. Wanted: a real workflow designer like Jira/Monday, doing
      the majority of cases, sold as more automation later. Also "sales automation" is the wrong
      label inside CRM. **Plan first, then approve.**
      — architecture already written: `docs/proposals/41-automation-architecture.html` +
      `43-automation-catalogue.html`. Needs the designer/marketplace research adding on top.

**Projects**

- [x] A project can be archived or deleted — org admin and project owner/admin only. Delete is a
      7-day soft delete and the org owner is emailed naming the person. `eea1c1e2`
      There is NO "disabled" state (you corrected that to archived). Archive/delete/restore all
      already existed and were gated on an AEKAM platform role, so a customer could not touch
      their own project — that was the bug. Archive also had no button anywhere in the app.
      `/teams/bin` had no org predicate at all; scoped in the same commit.
      `/cron/project-bin` erases past-window projects and DEFAULTS TO A DRY RUN — **not armed**,
      because its first real pass would erase projects binned under the old 30-day promise.

**Platform-wide UI**

- [x] Date pickers everywhere are white/low-contrast, and open off to the side `59e285d3`
      Two causes. `color-scheme` was declared nowhere, so the browser always painted its LIGHT
      calendar over the dark theme. Position could not be fixed in CSS at all — the native popup
      belongs to the browser — so the calendar is ours now: 79 tags across 46 files plus the
      `<Input type="date">` wrapper, covering date, datetime-local and time.
- [ ] Windows sidebar was meant to be solid colour — glassmorphism is the Mac treatment. `!`
      — check against the decision to gate on capability rather than OS.
- [~] Every table needs sort, filter and pagination (25/50/100). `b570d971` `30d1d58d`
      `hooks/useTableView` + `ui/TableToolbar`, 22 tests. **Per-column filter dropdowns with the
      options taken from the data** (never hardcoded), three-state sort with a chevron that is
      VISIBLE at rest, and the toolbar joined to the table as one card — it was floating 22px
      above it on the page background, which is what "background and border not matching" was.
      Applied to TWELVE tables: clients, contacts, activities, documents, invoices, products,
      expenses, bank, customers, stock, targets, exits.
      **Still to adopt it: approvals, dedupe, data runs, hub content, CRM report sections.**
      4 detail tables should NOT — invoice/vendor-bill/order lines and the Dristi pivot are one
      document's lines, and a pager on a six-line invoice is absurd.
- [ ] No tasks load — closed 2026-08-08 (`70b06bb5`, it was the drawer's 403s); re-verify on staging.

---

### Done 2026-08-08, late — the statutory codes stop blocking

- [x] **GSTIN, PAN and TAN are non-mandatory and block nothing** `2decc665`
  "not all indian company needs GST" — which is the law: registration begins at the turnover
  threshold. Three places still refused, FIVE DAYS after the same ruling was recorded on
  2026-08-03: the invoice PDF 409 (which P5 then inherited for email), the org-profile PATCH 400
  on a failing check digit or TAN regex, and `TabProfile.save()` client-side.
  Values are now stored as typed with the complaint returned in `code_warnings`. IFSC still gates
  — it is where money is sent, not a registration.
  **No GST registry lookup exists or is wanted**: `services/gstin.py` is structural only.

- [x] **Company logo may be an SVG** `2decc665`
  The upload screen advertised `image/svg+xml` in its `accept` since it was written and the server
  answered 415. Allowed now, and refused if it carries `<script>`, an `on*=` handler,
  `<foreignObject>`, `<iframe>/<embed>/<object>`, a `javascript:` URL or an XXE entity — a logo
  needs none of them, and refusing beats sanitising and hoping the rewrite was complete.

## Now

### Broken — reported 2026-08-08, nothing works around these

- [x] ~~No tasks load anywhere~~ — it was the DRAWER, not the list. `70b06bb5`
  The list always returned 59 rows. `/api/fields/team/{id}` and `/api/fields/task/{id}/values`
  both 403'd — `fields.py` was a FOURTH copy of the membership-only project rule — and the drawer
  swallows those, so Priority/Status/Due/Category/Assignees painted blank. Now on
  `may_reach_project`, with `fields.py` added to the existing ratchet. Re-check on staging.

- [x] ~~CRM client EDIT does not save~~ — owner confirms it works 2026-08-08. Cause never
  identified; `df0b0b3c` changed the gating and the delete honesty around it and may have fixed
  it incidentally. **If it recurs, the Network tab entry for the PATCH is still the thing needed.**
  Original note kept below.
  ~~CRM client EDIT does not save, for an org_admin with full access~~ `web` `api`
  Corrected 2026-08-08: delete works, EDIT does not. Reproduced by you as
  `kevalvshah03+1@gmail.com`, org_admin, no module limits — so this is NOT the write gate.
  `_module_levels` returns None ("no opinion") for org_admin, so `canWrite` is true and the
  Update button is enabled. My first diagnosis was wrong.
  `df0b0b3c` fixed three real things beside it (the delete endpoint no longer reports success on
  zero rows, Delete is gated like Edit, the denial is printed not hidden in a tooltip) but none of
  them is this bug. **Still needs the Network tab entry for the PATCH** — status and response
  body — because there is no server-side log for it.

- [x] ~~Client delete does nothing~~ — delete works; see above. `df0b0b3c`

- [ ] Invoice edit form collapses its first column — ITEM prints over HSN/SAC `!!` `web`
  Confirmed from your screenshot 2026-08-08. It is the edit form **inside the invoice detail
  drawer**, which is narrower than the same form on the Ganit page — measured at eight viewport
  widths on the page instance and it never clips there, which is why I could not find it.
  In the drawer the header renders as `ITHSM/SAC`: the description track is `minmax(0,1.6fr)`
  (`InvoiceForm.jsx:36`), so it shrinks to zero and the two headings overprint. `.gn-lines` also
  has `overflow: hidden`, so nothing can be scrolled back into view.
  Two fixes, not one: a real minimum on the description track, and the seven-track grid needs to
  stack on CONTAINER width, not viewport width — the 640px media query cannot see a narrow drawer
  on a wide screen.
  **The agreed design is the second screenshot** — a centred modal with four columns
  (ITEM · HSN/SAC · RATE · AMOUNT), not seven crushed into a drawer.
  Same job: **widen the invoice columns so nothing truncates** (asked 2026-08-08). Party names
  ellipsis on the invoice list and place of supply shows as `Maharash…`. Do it as part of the
  column-width work, not as a one-off — this is the same table system as the sort/filter item
  under *Product*, and a hand-set width here is one more thing to undo later.

- [ ] `users.role` cannot express a person who is a client in one org and staff in another `!!` `db`
  **NOT corrupt data — I was wrong, and I changed it and changed it back on 2026-08-08.**
  `kevalvshah03+1@gmail.com` and `aekaminc1+org@gmail.com` are BOTH members of `team_95beaa7529a9`
  (`AekamInc-UK`, under Aekam Inc) AND `org_admin` of Unicode Group. `users.role='client'` records
  the first of those. It disagrees with `staging.user_roles` because one global column cannot hold
  a per-org answer — whatever value it takes is wrong in one of the two orgs.
  I set both to 'admin' believing the rows were corrupt, then reverted to 'client' the moment the
  owner explained. Net change to the database: none.
  **The real question, still open:** `is_portal_client` requires the column AND no staff role, so
  these two get the STAFF view on AekamInc-UK, where they are genuinely clients. That fails safe
  (nothing leaks outward) but does not honour the relationship. Deciding it means deciding whether
  "client" is a per-project fact — which is what `task_clients` and `project_assignments` already
  model — and retiring `users.role` rather than repairing it.


### Found in the whole-product architecture review — 2026-08-09

Not automation. All four sit *underneath* any engine, and an engine would inherit and multiply them.
Detail and evidence in `docs/proposals/42-automation-architecture-review.html`.

- [ ] **Drop `staging.samvada_messages` from the realtime publication — BEFORE 12 August** `!!` `db`
  It is the only table in `supabase_realtime`, it holds **1,174 real tenant messages**, and it has
  **RLS off with zero policies**. Publishing a table the anon role cannot be scoped to is a
  cross-tenant exposure. The codebase spotted this itself — `useChannelMessages.js` refuses to
  subscribe *for this exact reason* — but nobody reverted the publication.
  **Latent today, not live:** the deployed bundle carries no Supabase URL and no key, so the client
  is null. **`docs/CLOUDFLARE-OWNER-ACTIONS.md` step B3 sets `VITE_SUPABASE_ANON_KEY` in the new
  Pages project on 12 August**, which turns it live. One statement fixes it either way — drop it
  from the publication, or give it a policy.
  Same check: `useRealtimeTasks` subscribes to `public.tasks`, which is **not** in the publication,
  so live board updates have never worked at all.

- [ ] **Scheduled reminders ignore quiet hours and notification preferences** `api` `!`
  `prefs_allow` (with quiet hours, tested, fails open) gates `create_notification`, `send_push` and
  the task-reminder dispatch. `reminder_service.process_pending_reminders` — the hourly job that
  produced all 331 reminders — calls `send_email` and `send_expo_push` **directly** and never asks.
  Nobody has noticed because everything it sends is suppressed. Fix before the engine multiplies it.

- [ ] **Shadow tables: the same name in two schemas, and the empty one wins the lookup** `db` `!!`
  `activity_events` (public **1,238 rows, still arriving** / staging 0), `time_entries` (287 / 0),
  `field_definitions`, `field_values` — all four exist in **both** schemas, and Core PM refers to
  them **unqualified**. `DB_SCHEMA=staging` is set and `db.py` issues `SET search_path TO staging,
  public`, which would resolve them to the empty copies. **The product currently depends on that
  instruction failing.** Restore it — a pooling change, a direct 5432 connection, a DSN `options`
  parameter — and activity, time entries and custom field values silently write to empty tables.
  Two steps: qualify the code (safe, do first), then drop the empty copies once proven unused.
  The task engine's `set_field` writes unqualified `field_values` — same trap.

- [ ] **`V2_PLAN.md` does not exist** `?`
  Cited as "source of truth" in **7 files** including `README.md` and `backend/migrations/README.md`
  ("migrations 002–006 are defined in V2_PLAN.md §4"). Either it was never committed or it was
  deleted. Decide whether to write it or strike the references.
  While in there: `docs/DEPLOY.md` describes **MongoDB Atlas and Create React App** · `README.md`
  says Railway Postgres, Tailwind and SES · `routers/README.md` lists 8 of 46 routers ·
  `services/README.md` lists 4 of 70+ and never mentions that a second `fire_automations` exists ·
  `docs/STAGING_SETUP.md` claims RLS policies that **do not exist** (41 of 42 `public` tables have
  RLS enabled with **zero** policies) · and `docs/proposals/` has **two files numbered 40** — the
  collision is mine, from the rejected automation audit.

### The rest of Now

- [ ] Tell me the exact URL behind the `422` in that console screenshot `@me` `?`
  It ended `.../pdf/1`, and no route in `/openapi.json` matches that shape, so I
  could not identify it. Everything else in that console is fixed or is a
  browser extension. Right-click the red line → Copy link address.

- [ ] Compare the £0.04 charge's Google Cloud project against the project my Gemini key belongs to `@me` `!`
  Why: it either unblocks Gemini web search or settles Serper as permanent. One lookup in the billing console; I cannot see billing.

- [ ] Smoke-test the new APK — sign in, force-stop, reopen `@me`
  Why: it fixes a logout bug nobody has confirmed is gone. `adb shell am force-stop com.aekaminc.Kartavaya`

- [ ] Reorder the chatbot chain so the free model runs before Gemini `api` `!`
  Why: every Sahayak question spends prepay before reaching `glm-4.5-air:free`, which costs nothing. One line. Biggest remaining saving.

## Payments — the shared invoice link · **P1-P8 COMPLETE 2026-08-08**

Demos: `docs/proposals/32`–`37`. Flow approved in full: Ganit → send → doorstep → invoice + pay.
No payment gateway, ever — the customer pays the org's VPA directly, Kartavaya never touches the
money.

**Live at `pay.kartavaya.com/i/{token}`** and verified in a browser, not just green.
Migrations 128, 129 and 130 are applied to the shared database.

**What is NOT done, stated here so the tick above is not read as more than it is:**
- the invoice reminder ladder (P7's rules) — parked behind the rejected automation plan
- **nothing in P7 has run against a real WABA** — no org has a connected number
- the scan log needs a **privacy-notice line** before it is on for real customers
- P4 has no `og:image`; the card is text only

- [x] **P1 · `pay_token` on `ganit_invoices`** — APPLIED 2026-08-08, `128_invoice_pay_token.sql`
  16-char base64url from 12 random bytes (96 bits), UNIQUE, `NOT NULL`, `DEFAULT` on the column
  so every writer gets one — recurring invoices and the estimate→invoice conversion insert here
  too, and a default in one code path is a NULL token from the others.
  759 rows backfilled, 759 distinct, 0 null, 0 malformed. Verified that the DEFAULT fires for an
  INSERT that never names the column.
  Note while applying: I twice reported **migration 127 as unapplied. That was WRONG** — the
  table `staging.hub_connector_credentials` exists in full with all four indexes. My probe looked
  for COLUMNS matching `%credential%`, and the columns are `secrets_encrypted` / `public_fields`;
  only the table carries the word. P7's storage was there all along.

- [x] **P2 · Public route `GET /api/v1/pay/{token}`** — SHIPPED 2026-08-08 `236773d9`
  Unauthenticated, 30/min per IP, 15 tests. VERIFIED LIVE on staging against a real invoice:
  returns payee, amount due and `payable.vpa`; a settled invoice and an unknown token return the
  BYTE-IDENTICAL 404, so a real token cannot be told from a guess.
  Test UPI `9428251061@upi` set on Aekam Inc and Unicode Group (2 rows, by id) so P3 has a target.
  **`billed_to` came back EMPTY on the invoice probed** — it has no `client_id`. P3 must handle a
  blank billed-to rather than render an empty line.

- [x] **P3 · The page at `/i/{token}`** — BUILT 2026-08-08 `db1a1dcf`, **not yet opened in a browser**
  Doorstep, invoice behind a tap, platform branch, server-rendered QR (`segno`, new dependency).
  QR endpoint takes the TOKEN not a string — `?data=` would be an open redirect in QR form.
  Plain `fetch`, not `lib/api`, so a borrowed device cannot leak a session to a public route.
  **`pay.kartavaya.com` NOW SERVES THE PAY PAGE** — 2026-08-08. It was not "unpointed": it was a
  PRODUCTION domain (`gitBranch: null`), so it served `main`, which has no `/i/:token` route and
  whose backend answers 404 for `/api/v1/pay`. A link sent there was a dead page.
  Owner chose to point it at the STAGING branch rather than wait on a 1,144-commit production
  release. `gitBranch=staging` set on the domain, `VITE_PAY_BASE_URL=https://pay.kartavaya.com`
  added for Preview(staging). DNS was already on Vercel's nameservers, so nothing at the
  registrar changed. The trade, stated: a customer-facing host serves the staging build — but
  staging and production share ONE Supabase database, so the data is identical and staging's
  code is the newer code.
  Original scope below.
  ~~P3 · The page at `pay.kartavaya.com/i/{token}`~~ `web`
  Doorstep first — sender, number, due date, amount, billed-to — then View invoice / Pay.
  Full invoice, PDF download, branded service buttons, generic `upi://`, QR on desktop.
  Platform branch: Android `intent://` with `browser_fallback_url`, iOS scheme-with-timer,
  desktop QR only. Currently the subdomain serves the staging SPA, which must be replaced.

- [x] **P3b · Organisation settings: a UPI ID PER PLATFORM** — SHIPPED 2026-08-08 `e6c001fd`
  Migration **129 APPLIED** to the shared database (additive; the backfill only READS
  `organisations`, so nothing deployed at the time could observe it). 2 rows backfilled, both
  the test VPA, 0 orgs with more than one default.
  Settings -> Organisation -> **UPI IDs**: a row per platform, on/off, make-default, and a live
  QR beside each SAVED row. `payable` on the public route is now a LIST, default first — the
  ordering IS the contract, so there is no separate "which one" field to disagree with it.
  22 route tests + 3 on the public payload. Original ask below.

  **I got this wrong first and the owner corrected me.** I said "one field, not five", reasoning
  that UPI is interoperable so a single VPA is payable from every app. Interoperability is real
  but it answers the wrong question: it means anyone can PAY you, not that you only have one
  ACCOUNT. Unicode holds separate accounts with Paytm, PhonePe and Google Pay — `…@paytm`,
  `…@ybl`, `…@okhdfcbank` — each settling and reporting separately, and choosing which one
  receives is an ordinary business decision. Model it the way the owner asked: **one screen, a
  row per platform, each with its own ID** — the same shape as the sender-email screen.

  **Second benefit, which I missed:** P6 was going to INFER which service was used from the
  payer's handle. With a receiving ID per platform there is nothing to infer — the ID the money
  arrived at names the account it landed in. That turns attribution from a guess into a fact,
  which matters because there is no gateway and reconciliation is bank-statement only.

  Data model — `organisations.upi_vpa` (one column) cannot hold this:
  - New `staging.org_upi_accounts`: `org_id`, `platform`, `vpa`, `payee_name`, `is_active`,
    `is_default`, `sort_order`. Unique on `(org_id, platform)`. Keep `organisations.upi_vpa` as
    the default's mirror for compatibility, the way 096 demoted `monthly_price` — do not drop it.
  - P2 `payable` becomes a LIST (`[{platform, vpa, payee_name, amount}]`), plus a default. The
    contract is already shipped, so this is a breaking change to a route with one consumer —
    change both together.
  - The QR endpoint takes `?platform=`, still never a raw string (`?data=` is an open redirect in
    QR form). One QR per platform, each a standard `upi://pay` — a `phonepe://` code is NOT a
    valid UPI QR and other apps reject it.
  - `PayPage.jsx` APPS stops being a fixed list: render a button per CONFIGURED platform, and
    fall back to the default ID for "Other UPI app".

  Screen: rows of platform + ID + on/off + "make default", with the **live QR beside each row**
  so the owner scans it with their own phone before any invoice goes out. That preview is the
  only real check in the flow — a typo sends a customer's money nowhere and there is no gateway
  to bounce it back. Validate the shape (`local@handle`, no spaces). Gate on org_admin/owner.
  Warn that these appear on every shared invoice — published to anyone holding a link, by design.

- [x] **P4 · Server-rendered Open Graph tags** — SHIPPED 2026-08-08 `e83f4dc9`
  `frontend/api/og.js` + a `vercel.json` rewrite keyed to the crawler User-Agent; humans still
  get the SPA. It re-fetches from the public route and RE-REFUSES, so a draft/cancelled/settled
  invoice yields the byte-identical generic card an unknown token does — a card reading "this
  one is settled" would confirm a real token to a guesser.
  **NO og:image, and that is the remaining half.** `index.html` already records the reason not
  to reference one that does not resolve: it renders a BLANK preview, worse than a compact one.
  A generated 1200x630 carrying payee and amount needs an image stack the backend does not have
  (`segno` was chosen over Pillow to avoid exactly that). Separate piece of work.
  Original scope below.
  ~~P4 · Server-rendered Open Graph tags + thumbnail~~ `api` `web`
  WhatsApp's crawler does not run JavaScript. Without this there is no preview card and the
  WhatsApp route loses most of its point. Edge function on `/i/:token` + generated OG image.

- [x] **P5 · Ganit send options** — SHIPPED 2026-08-08 `74c94263`. **WEB ONLY**
  `waInvoiceText` leads with what is owed, then the link ON ITS OWN LINE (WhatsApp only builds a
  card for a URL it can find), then the date. Quotes the BALANCE, never the original total.
  `POST /invoices/{id}/email` — PDF attached, link in the body. It reuses the PDF **route**, not
  the generator, so the 409 for a missing supplier GSTIN and the 422 for an incomplete document
  refuse the SEND; an invalid tax invoice in a customer's inbox cannot be taken back.
  `services/pdf_email.py` generalises the payslip attachment sender rather than becoming a third
  copy — the two existing copies each needed the same dry-run-bypass and `bytes` fixes applied
  separately. `invoice` is now a live sender bucket; two AST ratchets caught that and were
  updated rather than silenced.
  **MOBILE INVOICES STAY READ-ONLY** — owner, 2026-08-08. There is no mobile invoice detail
  screen and none is wanted, so P8 has no invoice work in it. Original scope below.
  ~~P5 · Ganit send options — web AND mobile, in the same stage~~ `web` `api` `app`
  Rewrite `waInvoiceText` to lead with the link (`_shared.jsx:95`). Add email auto-send: PDF as a
  real attachment, pay link in the body — same shape as `employee_email.py:309`, which already
  does this for payslips.
  **Do the mobile screens here, not later.** The phone has its own invoice screens and needs the
  same four send options, so build them in this stage while the decisions are fresh. P8 must then
  be a build and a smoke test — nothing to design, nothing to write. Web and mobile ship the same
  behaviour or the option list means different things on different devices.
  The pay page itself needs no mobile work at any point: the client opens it in a browser.

- [x] **P6 · Scan log + Collections tab** — SHIPPED 2026-08-08, migration **130 APPLIED**
  `staging.ganit_pay_scans` + `received_on` / `attribution` on `ganit_payments` (both nullable;
  505 existing payments untouched and correctly carry neither).
  **The spec changed because of P3b.** It said "service is inferred from the payer handle
  (`@ybl` -> PhonePe)". That guess is wrong for anyone paying a PhonePe address from Google Pay.
  With a receiving ID per platform there is nothing to infer — the scan records which BUTTON was
  pressed, and `received_on` records which of the org's own accounts took the money.
  **DPDP, and I did not do what the spec said.** It said "full IP 30 days, then truncate". The IP
  is now truncated BEFORE it is written (/24, /48) and the original is never persisted — a
  retention job that must keep running correctly for ever to stay lawful is a worse design than
  one that never holds the data. The User-Agent becomes three coarse buckets and is discarded; no
  cookie, no device id, no fingerprint. `city` exists and NOTHING writes it — there is no geo-IP
  provider, and adding one is a DPDP decision, not a code change.
  **Still needs a line in the privacy notice before this is switched on for real customers.**
  The Collections tab separates the three states a ledger cannot: never opened (chase the
  DELIVERY), opened (chase the customer), tried to pay (something failed at their end — that is a
  call, not a dunning letter). Every label is about LOOKING; none says "paying", because there is
  no gateway and a scan is not a payment.
  38 tests on `pay.py`, most of them about what is NOT written.

- [~] **P7 · WhatsApp Cloud API** — the SEND is shipped 2026-08-08; the rules are parked
  Demo and full spec: `docs/proposals/38-whatsapp-automation.html`.

  **My task entry was wrong about what was missing.** It said the inbound webhook did not exist
  and was "the piece that makes P7 worth paying for". It DOES exist, in full:
  `whatsapp.py:592` verifies `X-Hub-Signature-256` and FAILS CLOSED when `META_APP_SECRET` is
  unset, creates contacts/conversations from inbound messages, and moves
  `sent / delivered / read / failed` from the `statuses` payload. Migration 127 is applied too —
  I had reported that wrong twice already.

  **What was actually missing was the SEND**, and it was the dead-button failure this codebase has
  shipped before: the row went in `pending`, the endpoint answered 201, and the customer received
  nothing. Two tests were passing over it precisely because nothing was sent.

  Shipped: `_send_via_meta` — Graph **pinned to v21.0**, token in the header and never the body,
  `preview_url: false` (a business message must not render a preview we do not control), template
  parameters ordered deterministically because Meta matches `{{1}}`/`{{2}}` BY POSITION and an
  unstable order puts the amount where the invoice number belongs.
  **SEND FIRST, THEN RECORD** — `wa_message_id` is the only thing the statuses webhook matches on,
  so a row inserted before the call can never be matched and sits at `pending` for ever.
  Error handling names the remedy: `190` marks the account failed and says reconnect, `131047` is
  the window, `131026` says the number is not on WhatsApp and to try email. A timeout says the
  message MAY have been sent, because we do not know and claiming otherwise is the worse lie.
  12 new tests; the two that were passing over the gap now assert the send happened.

  **Still open in P7:**
  - **Template registry** — `staging.varta_templates` exists with a `status` the send already
    enforces, but nothing records Meta's category or which rule a template gates.
  - **Opt-in ledger** — timestamp and source per contact. Meta requires it before any template.
  - **Reminder rules + scheduler** — **PARKED.** This IS the approved invoice ladder, and its
    design now sits inside the rejected proposal 39. Not built until the automation plan is
    re-done properly.
  - **Nothing here has been exercised against a real WABA.** No org has a connected number, so
    the send path has never run against Meta. Green tests are not a delivered message.

  Meta bills the org, not Aekam — sell the automation, never the messages. "Paid" still comes from
  bank reconciliation, so the receipt message is never instant.

- [x] **P8 · Build the APK** — NOT NEEDED. Closed 2026-08-08 without a build, deliberately.

  **The premise changed under it.** P8 existed because P5 was going to add invoice send options to
  the phone. The owner then ruled **mobile invoices READ-ONLY**, so P5 wrote no app code at all —
  and `git log c5b1dead..HEAD -- mobile/` is **empty**. A rebuild would produce a functionally
  identical APK to the one already built, which is a 20-minute Gradle run and a new artefact to
  smoke-test for no behaviour change.

  Everything P8 gates on is green anyway, checked today rather than assumed:
  - backend **5,062 pass** from `backend/` (not the repo root)
  - frontend `npm run check` AND `npm run build` — both, because check exits 0 on unparseable CSS
  - mobile `tsc --noEmit` clean, and **466 tests pass**
    (`npm test` — node's own runner. `npx jest` reports 30 suites failing on
    `Cannot use import statement outside a module`; jest is installed but is NOT the runner here,
    and running it proves nothing.)

  **The real open item is unchanged and belongs to the owner:** the EXISTING APK has never been
  smoke-tested — sign in, force-stop, reopen, to confirm the auth race in `c5b1dead` is actually
  gone. It is already in `Now`, tagged `@me`. A built APK nobody has opened is not a shipped APK,
  and building a second one does not change that.

  Rebuild when mobile/ next changes: `scripts/build-apk.sh`, 2 GB metaspace or the Gradle daemon
  "disappears". Not EAS — 1.0 GB archive, ~16 minute upload, 3-4 hour queue.

## Automations — the engine · **PLAN READY, AWAITING APPROVAL**

Plan: `docs/proposals/41-automation-architecture.html` (the design) ·
`42-automation-architecture-review.html` (the architecture review that corrected it) ·
`43-automation-catalogue.html` (**all 60 automations in plain words — read this one first**).

`39` and `40` were rejected and are kept only for the record. 39 audited triggers and never checked
whether the actions could run; 40 audited the two automation screens rather than the product.

**The state of what exists today, measured:** zero automation rules exist anywhere in the product —
`automations` 0, `graha_automations` 0, `prachar_automations` 0, `varta_auto_replies` 0. Nothing is
at risk from a rewrite, and none of it has ever been exercised by a real user.

**Five automation surfaces, four of them broken:**
- CRM: the form never collects `action_data`, so "assign to" never asks whom; 3 actions are gated on
  keys that can never arrive; `send_notification` is offered with no branch; and `result='success'`
  is written **before** the action runs, so a rule that did nothing shows a rising run count.
- Tasks: actions work, but the event carries no priority and no assignees, so **any rule conditioned
  on those two never fires**; 6 of 8 triggers are strings nothing emits.
- Prachar: honestly closed (501 + unmounted + a tripwire test). The pattern to copy.
- Varta: `varta_auto_replies` — live CRUD at `whatsapp.py:537/551/569`, four trigger types, **no
  engine, no UI**, and the inbound webhook never consults it.
- Reminders: 331 created since the crons were armed, **331 suppressed** — none has ever reached a
  human, and the invoice one is addressed to the staff member who typed the invoice, not the
  customer.

- [ ] **A0 · Blockers to answer before anything is built** `@me` `!!`
  1. **When may scheduled mail actually leave?** All 331 reminders were suppressed. Until this is
     answered nothing in the ladder can be proved, and every green run means nothing.
  2. **The event spine as a migration** on 33 tables against the shared database — production fires
     the triggers too, from a codebase 1,144 commits behind that cannot set actor or source.
  3. **The ladder's steps and stops** — −3/0/+7/+14/+30 and the five stop conditions are a proposal.
  4. **Automation over Vetana/Manav** reads sensitive data — confirm it is wanted before I design
     the gates.
  5. **Module shortcuts:** keep a filtered builder inside Graha/Ganit settings, or exactly one page
     and nowhere else? I lean to keeping them.

- [ ] **A1 · Tell the truth about what exists** `api` `web`
  CRM log stops reporting success for no-ops · dead triggers removed from both builders ·
  `escalate()`'s four broken entity types fixed or removed (it declares five and **works for one** —
  `staging.tasks` does not exist and three of the others have no `assigned_to` column) ·
  `varta_auto_replies` given an engine or 501'd like Prachar's · the stale GSTIN sentence at
  `ganit.py:836` deleted. No new capability — this is what makes everything after it measurable.

- [ ] **A2 · The event spine** `db` `api`
  `staging.org_events` + row triggers on the 33 live business tables + the suppression switch every
  migration must run under. Nothing consumes it yet. **Ends with a week of real events to test against.**

- [ ] **A3 · The engine** `api` `web`
  Rules, runs, steps. Config declared as data. Conditions typed from the field registry so a
  condition the event cannot answer cannot be selected. Idempotency. The `wait` step. **Dry run
  against A2's real backlog** — nothing in this product has ever had that.

- [ ] **A4 · The invoice reminder ladder** — the one automation you have approved `!`
  Addressed to the customer, not the invoice's author. Carries the pay link and the PDF that P3/P5
  already built. Stop conditions re-checked before every step. Reminder history on the invoice drawer.

- [ ] **A5 · Retire the duplicates** `api`
  The four reminder scan blocks, the stalled `task_reminders` system (**94 due and unsent**, last
  send 2026-08-06) and `auto_send` all become rules. Thirteen cron handlers become one time sweep
  plus the genuinely bespoke jobs.

- [ ] **A6 · CRM and Core PM onto the engine** `api` `web`
  Both existing engines deleted — zero rules to migrate.

- [ ] **A7 · Manav and Vetana** `api` — the largest untouched surface. Mostly wiring existing skills.
- [ ] **A8 · Vikray, eSign, Prachar enrolment, Sahayak review** `api` — Prachar's tab is remounted
  and its 501 lifted; its tripwire test is already written to demand exactly that.
- [ ] **A9 · Templates** — the 10–15 prebuilt rules an Indian firm switches on in one click. Built
  last, from rules that have actually run.
- [ ] **A10 · WhatsApp as a channel** — when an org has a connected number. Nothing in P7 has ever
  run against a real WABA.

**Three rules I will hold it to:** no rule moves money · no rule bypasses a person's quiet hours or
notification settings · nothing says "sent" unless it was sent.

## Next

- [ ] Decide: rolling sessions or fixed? `@me`
  Everyone is signed out on day 7. `/auth/refresh` exists and mobile never calls it. Wiring it changes behaviour, so it is your call not mine.

- [ ] Namespace the mobile `auth_token` by environment `app`
  A staging token and a production token collide on one device, which also reads as a logout.

- [ ] Count web searches and grounded calls per org `api` `db`
  Nothing counts either today, so crossing a free tier would be discovered from an invoice.

- [ ] Test Serper end-to-end through the deployed chat route `api`
  Verified as a service with the live key, not through a real question.

### Product — from the 2026-08-08 inbox

- [x] ~~Plan first: the automation engine~~ — see the **Automations** section above. `39` and `40`
  were both rejected; `41`+`42`+`43` are the plan and are awaiting your approval.

- [ ] **Plan first: CRM reports and export** `@me` `!`
  CSV, Excel, and a PDF that is actually presentable, carrying org details. Plan before code.

- [~] Sort + filter, pagination 25/50/100 — every table `web` — `b570d971` `30d1d58d`,
      12 of 22 tables adopted; see the inbox entry above.
  Options driven by what the column holds. This is a table-system change, not 40 page changes.

- [ ] Date pickers: unreadable, and they open in the wrong place `web` `!!`
  Near-white on white; must follow the active theme. The popover must open directly beneath the
  picker icon, not off to the side.

- [ ] Windows sidebar should be solid, not glass `web` `!!`
  Glass is the Mac treatment. See `decision_glassmorphism_all_os` — gate on capability, not OS.

- [ ] Products: cost price, sale price, margin in money and percent `db` `api` `web` `!`
  Without it there is no real profit per deal or order, and no true turnover.

- [ ] CRM ↔ Sales: one tick to sync a client and a customer `api` `web` `!`
  Won deals convert to sales orders. Sales needs products. If an org has only one of the two
  modules, behaviour stays exactly as it is today.

- [ ] Invoice line items pulled from a deal or a sales order `api` `web`

- [x] Project archive / delete `api` `web` — shipped `eea1c1e2`, see the inbox entry above.
  Owner and admin only. Delete is soft for 7 days. Email the org owner on disable or delete,
  naming who did it and which project.

- [ ] Kanban and CRM pipeline: status colour behind each card, as on Boards `web` `!!`

- [x] Auto-archive done / won / lost cards after 7 days in that status `api` — `5d7c5391`.
  This is automation #27 — it becomes a rule on the engine (A6), not its own job. It is the one
  automation in the catalogue that needs a new action written (`archive`).

- [ ] CRM activities need the person's name on them `web` `api`
  CRM admin and org admin see everything; a CRM user sees only their own.

- [ ] CRM documents: stop asking the user for a file URL `api` `web`
  R2 path built for them — `crm/client/documents/…`. Upload, name it, pick the client. Show a
  10 MB limit for all documents and video.

- [ ] Drop the company text field on a CRM contact `web`
  The company dropdown already exists.

- [ ] Custom fields: they never attach to the form, and Contact/Deal are too few `api` `web` `!!`
  Folded into the automation plan — same underlying problem.

- [ ] Territories: real geography, and a person picker `api` `web`
  Decided 2026-08-08: no maps API. States (the existing `GST_STATES` list), cities, pincode
  ranges — `graha_territories` has no geographic column at all today. Replace the free-text
  "User ID" box and the truncated uuid at `TerritoriesTab.jsx:96,122` with the member picker.
  Surface `territory_id` on the deal; the column and the PATCH allow-list already exist.

- [ ] Billable expenses become invoice lines `api` `web`
  Decided 2026-08-08: `ganit_expenses.is_billable` is written, filterable, and has no consumer
  anywhere. Offer a client's unbilled billable expenses when building an invoice. Needs
  `invoiced_invoice_id` so nothing is billed twice.

- [ ] Bank statements: a bank, a file, and a saved column mapping `db` `api` `web`
  Decided 2026-08-08. Today it is a textarea split on commas by position — one comma in a
  description shifts every column, and debit/credit pairs cannot be represented at all
  (`BankTab.jsx:71`). Add `ganit_bank_accounts` with a saved `column_mapping`; real upload
  parsed server-side; ask existing bank or new; map once on a 5-row preview. Fixtures in real
  HDFC / ICICI / SBI export shapes, not one tidy file.

- [ ] Where do invoice expenses come from — answered, see the item above `?`

## Later

- [ ] Work out why `mobile/.easignore` is inert `app` `?`
  The EAS archive stayed at exactly 1.0 GB after adding it. 16-minute uploads and a 3–4 hour queue make this worth solving only if you want to rely on cloud builds — local is 5 minutes.

- [ ] Sanvaad conversion — component by component, never by selector list `web`
  Parked from the week of 2026-08-10. Link previews need SSRF-safe unfurling; the photo grid has no media column.

## Blocked

- [ ] JustDial / IndiaMART live test `@me`
  No marketplace credentials exist. Needs real accounts, and I will not run it against a live one without you watching.

- [ ] iOS build
  Needs an Apple Developer account. The config and iPadOS code are done and tested.

---

## Done

<!-- I move things here with the date and the commit. -->

- [x] 2026-08-08 — Task drawer 403s: comments/time/activity refused an org_admin `5f71f363` `5cb0804c`
- [x] 2026-08-08 — Sahayak web search on Serper `18a38973`
- [x] 2026-08-08 — Release APK signed people out `c5b1dead`
- [x] 2026-08-08 — Gemini models pinned; `-latest` alias had moved us to 3.6 `863117c6`
- [x] 2026-08-08 — Gemini key stopped spending on images; calls were logged at $0.00 `98ed77a7`
