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

- [ ] 

---

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

## Payments — the shared invoice link · approved 2026-08-08

Demos: `docs/proposals/32`–`37`. Flow approved in full: Ganit → send → doorstep → invoice + pay.
No payment gateway, ever — the customer pays the org's VPA directly, Kartavaya never touches the
money. Ships in this order; each stage is usable on its own.

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
  **REMAINING: `pay.kartavaya.com` still serves the staging SPA** — the subdomain has not been
  pointed anywhere, so the page is reachable at `/i/{token}` on staging only.
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

- [ ] **P6 · Scan log + Collections tab** `db` `api` `web`
  New `ganit_pay_scans`: token, service, device, OS, browser, truncated IP, city, outcome.
  `ganit_payments` gains `payer_vpa`, `service`, `attribution`. Service is inferred from the payer
  handle (`@ybl` → PhonePe) — never from UPI itself, which does not report the app.
  DPDP: full IP 30 days, then truncate to city. Needs a line in the privacy notice.

- [ ] **P7 · WhatsApp Cloud API as the fourth send option** `api` `db` `web`
  Demo and full spec: `docs/proposals/38-whatsapp-automation.html`. Approved 2026-08-08.
  Gated on the org's own `whatsapp_business` connector, which already verifies live against
  Meta's Graph API (`hub_connectors.py:358`). Six parts:
  - Inbound **webhook** with Meta signature verification — `sent / delivered / read / failed`
    plus replies. Without it the button sends into silence, which is what option 3 already does
    for free. This is the piece that makes P7 worth paying for.
  - Finish `send_wa_message` (`whatsapp.py:334`, `TODO: Call Meta Cloud API`). It already
    enforces the 24-hour window server-side; templates are exempt and that branch must know it.
  - **Template registry** — category, Meta approval state, and which rule each one gates.
    A rejection disables one rule with Meta's reason, never the feature.
  - **Opt-in ledger** — timestamp and source per contact. Meta requires it before any template.
  - **Reminder rules + scheduler**: on finalise, 3 days before due, on due date, overdue at
    7/15/30, on settled, monthly statement. Guardrails are not optional — stop when paid, quiet
    hours, one message per invoice per day, skip contacts with no opt-in, STOP unsubscribes.
  - Verify migration `127_connector_credentials.sql` is actually applied; my note says it is not,
    and without it there is nowhere to store an org's own WABA token.
  Meta bills the org, not Aekam — sell the automation, never the messages. "Paid" still comes
  from bank reconciliation, so the receipt message is never instant.

- [ ] **P8 · Build the APK — last, and only on green** `app` `!`
  Runs after P1–P7. **No app code is written in this stage.** The mobile screens were built in P5;
  if this stage finds itself designing anything, P5 was left unfinished and that is the bug.
  1. **Every suite green before a build is started.** Backend pytest **from `backend/`**, not the
     repo root — the root invocation reports 58 spurious failures from the wrong rootdir. Mobile
     jest + `tsc`. Frontend `npm run check` **and `npm run build`** — check exits 0 on
     unparseable CSS, so it alone proves nothing. Then the e2e suites.
  2. **Build the release APK locally** — `scripts/build-apk.sh`, 2 GB metaspace or the Gradle
     daemon "disappears". Not EAS: 1.0 GB archive, ~16 minute upload, 3–4 hour queue.
  3. **Smoke-test it on a device before it counts as done** — sign in, force-stop, reopen (the
     auth race), then the invoice send options. A built APK nobody has opened is not a shipped
     APK; that is exactly the state the current one is in.
  4. **Push to staging last**, with the version bumped in the same commit.
  Nothing after `c5b1dead` has touched `mobile/`, so no build is needed until P5 lands.

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

- [ ] **Plan first: the automation engine** `@me` `!`
  A real workflow builder, Jira/Monday class — not the per-module toys we have. You asked for a
  plan before any code, including what it means for custom fields and per-module triggers.
  "Sales automation" in CRM is also the wrong name for what it does.

- [ ] **Plan first: CRM reports and export** `@me` `!`
  CSV, Excel, and a PDF that is actually presentable, carrying org details. Plan before code.

- [ ] Sort + filter on every column, pagination 25/50/100 — every table, every module `web` `!!`
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

- [ ] Project disable / archive / delete `api` `web` `!!`
  Owner and admin only. Delete is soft for 7 days. Email the org owner on disable or delete,
  naming who did it and which project.

- [ ] Kanban and CRM pipeline: status colour behind each card, as on Boards `web` `!!`

- [ ] Auto-archive done / won / lost cards after 7 days in that status `api`

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
