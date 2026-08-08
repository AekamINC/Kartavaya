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

- [ ] No tasks load anywhere `!!` `web` `api`
  Reported as "none of the task is loading". Not reproduced yet — find it before anything else.

- [ ] CRM client EDIT does not save, for an org_admin with full access `!!` `web` `api`
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

- [ ] Two org_admins carry `users.role='client'` `!!` `db` `@me`
  The access rules now bypass the column so nothing is broken for the user, but the rows are
  still wrong. Cleaning them is a production write — staging and production share one database,
  so this needs you watching. See `incident_drawer_403_two_role_tables`.

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
  Note while applying: **migration 127 (connector credentials) is still NOT applied** — confirmed
  by probe, no credential columns exist. P7 needs it.

- [ ] **P2 · Public route `GET /api/v1/pay/{token}`** `api`
  Unauthenticated, rate-limited per IP. Returns payee, invoice number, amount due, status, lines.
  Refuses a settled or cancelled invoice. Nothing in the response that is not on the paper invoice.

- [ ] **P3 · The page at `pay.kartavaya.com/i/{token}`** `web`
  Doorstep first — sender, number, due date, amount, billed-to — then View invoice / Pay.
  Full invoice, PDF download, branded service buttons, generic `upi://`, QR on desktop.
  Platform branch: Android `intent://` with `browser_fallback_url`, iOS scheme-with-timer,
  desktop QR only. Currently the subdomain serves the staging SPA, which must be replaced.

- [ ] **P4 · Server-rendered Open Graph tags + thumbnail** `api` `web`
  WhatsApp's crawler does not run JavaScript. Without this there is no preview card and the
  WhatsApp route loses most of its point. Edge function on `/i/:token` + generated OG image.

- [ ] **P5 · Ganit send options — web AND mobile, in the same stage** `web` `api` `app`
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
