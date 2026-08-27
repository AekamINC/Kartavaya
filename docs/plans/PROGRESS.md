# Progress log — append-only

One line per landed change. Newest first. Evidence is a `file:line`, a
`table + row count`, or a commit SHA — never "done". This is the running record
behind `docs/STATUS.md`; when you tick a row there, add a line here.

Format: `YYYY-MM-DD · <phase/area> · <what changed> · <evidence> · <verified how>`

## Who is writing these entries

**Lead Principal Systems Architect** — ten years building SaaS in this domain,
three years on Python automation and integration, and Python lead for the skills
layer and its CRUD operations. Schema, write-paths, the skills that read them,
and the seams between the three.

**Migrations are approved by default** (owner, 2026-08-26): apply without
waiting, but STILL state the write-path side effects and the risk first — the
database is shared with production, and pre-approval removes the wait, not the
report. Verify from `pg_constraint` and the live catalogue afterwards, never
from the migration file. Data changes to live customer rows are NOT covered by
that standing approval and are still raised before they run, with the reversal
statement written down. See `README.md` for the full terms.


---

## 2026-08-27

Six agents, partitioned by file so no two shared one, plus a cloud session's
branch merged in. Everything below is either a live read-only `SELECT` or a test
run; the only writes are named as writes.

### Cloud session merged — Pahchan clock in and out from a browser

`e9ffd373`, merged at `07f082a6`. `POST /v1/pahchan/punch` had been complete for
months — geofence, altitude, accuracy flags, idempotency, photo — with exactly
ONE caller in the repo: mobile `ClockScreen.tsx`, on a platform that has no iOS
build. So an employee on an iPhone could not clock in from anywhere, while the
web carried every reviewer screen and no way to punch. Frontend only: no
endpoint, no table, no migration, 28 tests, and `npm run build` green here
(the cloud sandbox could not run it — `@samasante/liquid-glass` will not install
there, which fails identically on an untouched tree).

It ships 🟡 and says so on the screen rather than offering a button that always
fails: `manav_employees.user_id` is NULL on every row, so `create_punch` 409s
for every account. **Phase 0.23 is what turns it ✅**, and the same gap blocks
mobile.

Not merged, and deliberately: `claude/ios-clockin-out-no-app-dnu7o8` builds a
SECOND attendance stack — `migrations/010_attendance.sql`, `routers/attendance.py`,
`AttendancePage.jsx` — on top of `1aa49855`, which is production's ancient main.
A parallel model beside Pahchan is exactly what Phase 6 exists to retire.

### 0.20 — Ganit's vendor form was a stripped four fields

`ganit/PayablesTab.jsx` created vendors carrying NONE of the six MSME/TDS
columns Phase 1 turned on. The owner's call was "point it at the same component
Kray uses; do not fork the fields" — so the form, which existed only as inline
JSX in `kray/VendorsTab.jsx:151-233`, is now `components/VendorForm.jsx` and both
tabs call it. `PayablesTab` 361 → 335 lines, `VendorsTab` 272 → 124, and the
duplicate is deleted rather than copied.

All six — `is_msme`, `enterprise_class`, `vendor_kind`, `udyam_number`,
`tds_section`, `payment_terms_days` — now render on Ganit → Payables → + Vendor
and ride the POST. 13 new tests, including **set equality of the field labels
across both tabs**, which is the ratchet against a future fork. GSTIN/PAN/TAN
still block nothing: the only refusal is a blank name.

Live, read-only 2026-08-26: E2E `64e7bea6` **75 vendors, 12 carry all six**;
Unicode `fae87907` **9 and 0**. No probe rows written.

### 4.6, 4.7, 4.8 — three endpoints that had no caller at all

- **4.6 billing anchor.** `PATCH /admin/billing-anchor` has existed since
  proposal 86 with nothing calling it. Now a control on the Plan tab, days 1–28
  only, saying why: an anchor of 29–31 has no day to land on in February, so the
  period would move by itself. Owner decision 0.13 — flexible, default 1.
- **4.7 pause / resume.** The plan said there was no endpoint; there is —
  `POST /admin/pause` — and what was missing was the control. It is not a
  cosmetic flag: `middleware/subscription.py:696` refuses EVERY module for a
  paused org. So the card states that beside the button and takes a
  confirmation, because an operator pausing the wrong org from a console that
  lists every org takes a working firm offline.
- **4.8 quota proration.** `GET /quota-proration` had no caller either. Surfaced
  where targets are actually set — Vikray → Targets — as an optional "joined
  mid-period on" date. The SERVER does the arithmetic: 0.17 is calendar days
  minus Sundays, and re-deriving that in a browser would be the second
  convention that 0.17 was raised to end.

### 🔴 Changing a plan has ALWAYS 500'd — found by Phase 3.2's own acceptance

`POST /v1/subscription/admin/set-plan` bound `user["user_id"]` into
`staging.subscriptions.activated_by`, which is `uuid` and carries a real FK to
`users(id)`. **`public.users` has BOTH** — `id` (uuid) and `user_id` (text,
`user_f798947b8a2e`). asyncpg refused it before Postgres ever saw the statement:

    DataError: invalid input for query argument $4: 'user_f798947b8a2e'
    (invalid UUID: length must be between 32..36 characters, got 17)

So an operator has never been able to move an organisation to another plan —
and that is also why the proration path had never run and `subscription_invoices`
is still 0 rows. Confirmed live: **5 subscriptions, 0 with `activated_by` set.**

**This is what writing the acceptance was for.** Phase 3.2's credit arithmetic
was correct and tested; the screen that reaches it could not complete a single
call. A row count would never have shown it — there was nothing to count.

The FK stays: it is real integrity, it works, and the row it points at exists.
What was wrong was the value. `_user_row_id` resolves `users.user_id` →
`users.id`, and is deliberately NOT the existing `_actor_uuid` — that one serves
`subscription_invoices`, whose uuid columns have **no** foreign key, so when the
caller's id is not a uuid there is nothing to look up and NULL is the honest
answer. Here there is something to look up. It returns None if it cannot
resolve, because a plan change must not fail over the row recording who made it.

### 4.3 — the acknowledgement table was locked from the inside

`skill_finding_ack` **0 → 1**, written by the DEPLOYED endpoint against E2E, not
by a script touching the table. Re-running the skill afterwards returned **2
products instead of 3**, with `counts.products_short` recomputed 3 → 2.

The reason it held zero could not have been fixed from the frontend.
`apply_wiring` attaches the key/state to a finding **but returns the output
untouched when the org holds no acknowledgements**, and the dispatcher
short-circuits on the same condition. Both guards are individually right — they
stop a "0 acknowledged" line appearing on a list nobody has touched — but
together they meant no finding ever carried a key, so no client could ever ask
for the FIRST ack. A door locked from the inside. The key is now attached
separately from the filter, in `hub.py`, without touching the wiring module.

Three things it found on the way:

  · **`_MAX_FINDING_CHARS` is the real ceiling on this feature.** Of 18 wired
    data-only skills run against E2E, **8 came back truncated** (`data: null`),
    and a truncated finding renders as clipped text — so no dismiss control can
    ever appear on it. The handle costs +3% to +19% of the character budget;
    one skill already sits at 19,353 of 20,000. The control is dropped rather
    than tipping a finding into truncation: big lists lose the button, never the
    rows. The durable fix is raising the bound or storing findings outside the
    run row.
  · **Neither ack endpoint has a role check** — any user who can reach Sahayak
    for the org can hide a finding for everyone. The control is left ungated to
    match, rather than adding frontend theatre over an open endpoint.
  · **"78 skills" is the template count.** Live: 111 templates, 93 skill
    functions, 32 wired, 61 unwired — of which only **17** are list-shaped
    read-only skills that would actually benefit. None were wired here: one per
    commit, as the standing rule says.

### 0.27 — the rate card, seeded as an estimate that cannot be read as fact

There was **no WhatsApp rate card table anywhere** — checked before building:
`%rate_card%|%pricing%|%price%` returned only `vendor_rate_cards` (Ganit
supplier rates, an unrelated thing sharing a noun) and `credit_prices` (Aekam's
own meter). Different money, correctly separate.

Migration 227 (renumbered from 224 when a peer's untracked migration appeared —
225 left as a hole so a peer mid-write could not collide). Five rows, and the
owner's "must be visibly an estimate" is carried four different ways, each
failing differently:

  · `rate_basis` **defaults to `'estimate'`** — the safe value is the default
    and the unsafe one has to be typed;
  · a CHECK makes an estimate row **without a note uninsertable**;
  · another allows the `meta_rate_card` claim **only while citing a Meta-owned
    host**, so 0.27's guess cannot be laundered into 0.26's real card by an
    UPDATE to one column;
  · `source_url` and `source_read_on` are NOT NULL with no default — an
    uncited, undated figure cannot exist.

On the API the caveat is **inside the number string** (`"₹0.8631 (estimate)"`)
so a future template cannot drop it by forgetting a sibling field, and a row
that somehow arrives as an estimate with no note has its **number withheld**:
the failure mode is "no number", never "bare number".

**Meta moved from per-conversation to per-message billing on 1 July 2025**, so
the per-conversation pricing the task named no longer exists to seed;
`pricing_model` records which model each row describes. India moved to INR
billing on 1 Jan 2026. Three sources agree on the marketing and utility figures;
one dissents (~26% higher, probably a BSP list price) and the disagreement is
written into the affected rows' `notes`. No margin column, and there must not be
one — that would be a schema contradicting decision 0.18.

`varta.cost_per_conversation` stays ABSENT, with its reason corrected rather
than left false: of **250 outbound messages, 0 carry a `template_name`** and 0
join to `varta_templates`, so no message can be placed in a billing category —
and Meta prices per category. A cost from a guessed rate × a guessed category is
two inventions multiplied.

### 0.24 — the PT ladder goes 3 states to 7, and nobody's pay moves

Migration 224, applied and verified from `information_schema` / `pg_constraint`
/ `pg_indexes`. **9 rows → 23**, states 3 → 7, all shared (`org_id IS NULL`,
`month IS NULL`), every band checked against the ₹2,500/year ceiling in Article
276(2) and every state carrying its source in the file:

| State | Source |
|---|---|
| **Assam '18'** | Govt of Assam notification 2 Apr 2025, substituting Entry 1 of the 1947 Act's Schedule |
| **West Bengal '19'** | The state's own Directorate of Commercial Taxes PDF, Schedule to the 1979 Act, w.e.f. 1 Apr 2014 |
| **Telangana '36'** | First Schedule of the 1987 Act, carried over from undivided AP on the 2014 appointed day |
| **Andhra Pradesh '37'** | G.O.Ms.No. 82 of 4 Feb 2013, in force 6 Feb 2013 |

**Nobody moved.** E2E's 60 latest payslips still total **₹11,800** and Unicode's
24 still total **₹4,800** — 84 of 84 agree, 0 differ, because no employee row
carries any of the four new states. Re-running the file inserts 0 (guarded per
state). No deploy needed: no DDL, so the running backend reads the new rows.

**The boundaries carry paise on purpose.** `_pt_from_slabs` matches inclusively
at both ends, and the existing whole-rupee ladders leave a **99-paise dead zone
at every band top** — a gross of ₹10,000.50 matches neither Maharashtra
neighbour and silently returns ₹0. One live payslip already carries a fractional
gross (₹3,657.69). The four new ladders are contiguous to the paise.

**Fifteen states deliberately left out**, each with its reason: seven set bands
on ANNUAL income (dividing by twelve is an inference the statute does not make),
three are half-yearly and set by the local body (Tamil Nadu is the most valuable
one still owed — it needs a period/local-body schema conversation, not a guess),
Punjab is a flat levy rather than a gross band, and four fit the model but rest
on a single stale aggregator. Assam is the proof that matters: the same
aggregator tables were still showing its pre-April-2025 slabs.

**One disagreement recorded rather than smoothed** — one source puts Assam's
middle band ceiling at ₹24,999 where two others put the break after ₹25,000,
which matches the standard drafting. Seeded two-to-one; the whole dispute is
worth ₹28/month to somebody grossing exactly ₹25,000.

**And a defect the work found, fixed here.** `_pt_from_slabs` read
`monthly_tax` AFTER choosing the winner, while its own comment claimed every
field was read inside the guarded loop "because it means the row this function
returns is known to carry all of them". So a row whose rate would not parse WON
the ranking, failed to convert, and returned ₹0 — with a good row for the same
state and band underneath it, never consulted. Never-blocking was never
violated; the difference is whether the fallback is the right ladder or nothing.
The rate is now parsed in the loop, and the test that pinned the old behaviour
asserts the new one.

**Also fixed: a test that had been failing on every live run since 220.**
`test_live_the_state_column_shape_parses_once_the_column_exists` built its
statement inside the live connection's coroutine, and `capture().find()` drives
the handler through its own `asyncio.run`. That branch was unreachable until
`manav_employees.state` existed — so the day the column landed, the test about
that column started raising `asyncio.run() cannot be called from a running event
loop`. Three steps now: ask the catalogue, build the SQL on its own loop, plan
it.

**Three findings left for the owner, all with zero live exposure today:**

1. **Gujarat's shared ladder is four years stale.** Two rows (₹80 and ₹150) were
   superseded by notification GHN-35-PFT-2022 w.e.f. 1 Apr 2022, which replaced
   the ladder with "up to ₹12,000 nil, above ₹12,000 ₹200". No Unicode payslip
   has ever fallen in ₹6,000–₹11,999.99 — but any future low-paid Gujarat hire
   is over-deducted ₹80–₹150 a month that Gujarat does not levy. Correcting it
   is an UPDATE/DELETE of live shared rows, which is a decision, not a migration.
2. **Karnataka's is stale too** — exemption raised ₹15,000 → ₹25,000 w.e.f.
   1 Apr 2023. 0 employees in KA. Same class of fix. Note a new row cannot repair
   either one: the stale rows are dated 2024-04-01 and outrank an honest earlier
   date.
3. **Maharashtra has a gender dimension this table cannot express.** Since
   1 Apr 2023 women are exempt to ₹25,000/month while men are exempt to ₹7,500.
   The seeded '27' ladder is the male one. `manav_employees.gender` exists and is
   populated; `pay_professional_tax` has no gender column. 0 of E2E's 30
   Maharashtra women gross under ₹25,000 — one salary revision away from
   mattering. That needs a column, not a row.

Reversal for the whole migration:
`DELETE FROM staging.pay_professional_tax WHERE org_id IS NULL AND state_code IN ('18','19','36','37');`
— exact and complete; no FK references this table.

### 4.2 Pahchan consent — and the bridge that has never written a row

12 faces enrolled, **zero consents ever recorded against them**, and an employee
who declined biometric attendance had no other way to be marked present. Both
are real now: an employee reads what is captured, why, their own org's retention
figure and how to withdraw, then agrees or declines; an admin sees the whole
roster with photos-on-file beside each answer and records a declining
employee's day straight into `manav_attendance`.

`POST /consent/me` writes `method='self_acknowledged'` — a value migration 209's
CHECK has always admitted and which `EmployeeConsentBody`'s
`^(paper|verbal_witnessed)$` could **never** produce. No route could write it.
And `GET /consent` lists rows that EXIST, which is zero, so it could not show
the gap; the roster LEFT JOINs roster → enrolment → consent, so "2 photos, no
answer" is a row somebody can look at.

An opted-out caller is refused at `POST /punch/photo` **before**
`storage.upload_file` — the face never reaches R2 — and `create_punch` drops the
key while keeping the punch, because §2 is that nothing blocks a punch. No new
flag, deliberately: `Punch.is_eligible` treats any flag with a NULL verdict as
unpayable, so a flag would quietly make every opted-out day need a reviewer
before it became pay.

**🔴 THE FINDING THAT MATTERS MORE THAN THE FEATURE.**
`attendance_bridge.MARKED_BY_BRIDGE = "pahchan"`;
`manav_attendance_marked_by_check` admits only
`('system','manual','biometric','geo')`. Every bridge write raises
CheckViolation, so **biometric attendance has never reached payroll**. Live:
**699 punches, 518 attendance rows, `marked_by='pahchan'` = 0.** Not fixed here
— it is another file, and the fix is a choice (widen the CHECK, or change the
constant) that has to agree with the publish upsert's `IS DISTINCT FROM` guard.
It is why the opt-out row writes `'manual'`: the one value that guard protects.

**And a correction to this ledger.** The cloud session's clock-in commit says
`manav_employees.user_id` is NULL on every row, and the entry above repeated it.
Live 2026-08-27: **5 of 109 carry one**. The web clock works for those accounts
today. The gap is that almost nobody else has a login — which is 0.23 — not that
the feature is dead.

Withdrawal does not delete stored photographs (`purge_reference_photos` only
reaches a terminated employee) and the copy says exactly that, with a test
asserting the flattering sentence is absent. "Code-based" attendance is named in
the enrolment refusal and does not exist; only manual does.

🟡 until the first consent row exists — no write probe was run.

### 4.1 compliance settings, 4.4 storage browser — and the two faults wiring them found

Both were "a table, a route and tests, and no caller". Neither turned out to be
just a screen.

**4.1.** `module_compliance_settings` held **0 rows across all five orgs** and
`grep '/v1/org/compliance'` across `frontend/src` returned nothing. The panel now
records not-applicable / applicable / enforced per rule, with the consequence
stated before the confirm and the decision's author, date and reason on the row —
name, never an id. The never-claim rule is now STRUCTURAL rather than a
docstring: `Rule.enforced_at = None` means recorded-only, `set_rule` refuses
`enforced` for a rule no code reads ("enforcing it would block nothing"), the
segmented control is built from `rule.states` so the option is not offered, one
test asserts every non-null `enforced_at` names a file on disk containing that
symbol, and another bans claim phrases from the registry outright. Two of five
modules registered deliberately — `manav` and `kray` are policy configuration
that migration 210 explicitly keeps out, and `pahchan`'s four belong to 4.2,
which is building the path that would read them.

**4.4.** `storage_browser.py`: 390 lines, 19 tests, no caller — and the wiring
found two faults it had been hiding.

  · **`resolve` matched none of the 137 stored keys.** It prepended the tenant
    root and looked up only that spelling; every stored key predates the grammar
    and carries no root. It now tries both, with `org_id = $2::uuid` still in
    every predicate — what is looked up widened, what can be seen did not.
  · **The listing would have drawn ids on the first click.** The live folders are
    `personal/user_…`, `pahchan/{uuid}`, `projects/team_…`. Filtering them out
    would make all 95 objects unreachable, so they are resolved to names,
    org-scoped.

Counted live: 95 R2 objects and 137 stored keys across both orgs, **zero in the
new key grammar**. The backfill is recorded as owed and was not run.

It also declines to repeat a number it knows is wrong. `organisations.storage_used_bytes`
says **20,182 bytes for Unicode against a bucket holding 89,591,092** — 85 MB —
because `update_org_storage` is called from two upload paths while eSign,
Pahchan, Srijan and the scrapers increment nothing. The tile reads "Recorded as
used" and the server sends a note naming the gap. **A recount job is owed.**

**And a memory was stale.** The note that 32 MB of files sit inside six
`tasks.attachments` rows is no longer true: the column holds 93 rows, **17,923
characters in total**, largest 1,358, and not one `data:` URI. The warning was
written onto the screen from that note and then removed — a screen must not warn
about a state the database has left.

### 0.22 — a task can finally name its customer

`public.tasks` has 41 columns and had no `client_id`, which is exactly why client
profitability answers 0%: a firm could record every hour it worked and never say
who for. Migration 226 adds it — nullable, no default, partial index on
`(org_id, client_id)`.

**Not `task_clients`**, which already exists and is a different fact: its columns
are `(id, task_id, user_id, invited_by, org_id)` and `approvals_router.py:554`
writes one when somebody is invited to approve. That is a grant of read access to
a PERSON. A CRM client is the COMPANY — "contacts come and go; the customer
stays" — so tying profitability to whoever was invited to a task would be the
wrong join, changing for the wrong reasons.

**No foreign key, and that is this table's own pattern** — read from
`pg_constraint`, not assumed: `public.tasks` carries three CHECKs and no FKs at
all. An FK would not give the integrity that matters here anyway.
`graha_clients.id` is unique table-wide, so it would happily accept ANOTHER
organisation's customer — the documented join leak. Tenancy is enforced where it
can be: `_assert_client_in_org` carries the org in the predicate and **refuses**
rather than dropping a value it cannot use, because silently creating the task
with no customer reports success and the hours get moved by hand later.

483 tasks, all NULL. No backfill: a task names a team and a column, not a
customer, and guessing from a title puts one firm's name on another's work.

7 live-parse tests. The drawer gets a `ServerPicker` — not a plain one, because
`/v1/graha/clients` is LIMIT 200 and filtering a truncated list hides customers
silently, which is how a duplicate company gets created. While there:
`DrawerMeta`'s hooks moved above its `if (!task) return null` — React counts
hooks, not branches, and `labelSuggestions` had been sitting below it.

### Phase 6 — the rule shipped, and two of the four "duplicates" were not

**A planner statistic is not a row count, and this is where that mattered.**
`pg_stat_user_tables.n_live_tup` reports **0** for `pay_professional_tax` and
**0** for `dristi_scheduled_reports`. Both are wrong: exact `count(*)` says 9
and 7. A DROP decided from the first number would have deleted the live PT
ladder.

- **6.2 is wrong in the plan, and dangerously.** "Prove the `hr_*`/`pay_*`
  tables are empty, back up, drop" — seventeen of eighteen are empty (all ten
  `hr_*`, plus `pay_runs`, `pay_slips`, `pay_esi_records`, `pay_pf_records`,
  `pay_tds_records`, `pay_loans`, `pay_it_declarations`). **`pay_professional_tax`
  is live**: 9 shared rows (`org_id IS NULL`) that `vetana.py::_pt_slabs` reads
  on every payroll run for both in-scope orgs, extended by migration 221 six
  days ago. Dropping the stack as written takes professional tax to ₹0 for
  every employee. Excluded by name; the phase file now says so.
- ~~**6.4 has no work in it.** `staging.report_schedules` does not exist — a live
  query returns `42P01`.~~ **WRONG — corrected 2026-08-27, see below.** The 42P01
  is a fact about `staging` and I read it as one about the database:
  `public.report_schedules` exists, and it is a second live scheduler with an
  armed hourly cron. Left standing rather than rewritten, because a log that
  edits out what it got wrong is worth less than one that shows it.
  `dristi_scheduled_reports`, 7 rows, is still the only one that has ever sent
  mail — that half was right.
- **6.3 decided: keep both allocators.** `next_po_number` is a different
  algorithm, not a copy. A purchase order is numbered at ISSUE, so drafts carry
  NULL, so `next_doc_number`'s `ORDER BY created_at` reads a draft as newest and
  restarts the series at 0001 against an order issued last week. The reasoning
  was already in `services/purchase_orders.py:330`; nothing held the line.
  `tests/test_two_serial_allocators.py` — 5 tests — now fails if a PO table
  enters `_ALLOWED_DOC_TABLES`, if the allowlist changes without a decision, if
  either allocator stops zero-padding to four, or if either takes its advisory
  lock outside a transaction (asyncpg autocommit releases it before the read it
  protects, and two callers mint the same serial).
- **6.1 confirmed and NOT dropped.** `sales_commissions` 0,
  `sales_commission_slabs` 0, `sales_commission_assignments` 0. A DROP is named
  and confirmed regardless of the standing migration approval — owner OK (0.30)
  still owed.
- **The process rule is a ratchet now.**
  `tests/test_every_writer_has_a_live_sql_test.py`, 4 tests. **36 routers write
  to `staging.*`; 6 have a test that PREPAREs their statements against the real
  schema.** The other 30 are baselined by name and the baseline only shrinks:
  a new writing router with no live test fails immediately; a baselined one that
  gains a test must be removed; a name that no longer writes must be deleted.
  That last check is the one that stops it rotting the way
  `migrations/README.md`'s status column did — still marking 002-006 "Pending"
  against a database of 214 tables.

### The e2e suite cannot reach staging — Vercel is 403ing Playwright

`phase3-acceptance.spec.ts` is written and committed, and it cannot run: every
`page.goto` returns Vercel's own 403 page (`X-Vercel-Id: lhr1::…`) while `curl`
against the same URL returns 200 — including with a HeadlessChrome user agent.
Deployment protection is OFF on the project (password, SSO and trusted-IP all
`enabled: false`, read from the API), so this is edge bot mitigation reacting to
the automated browser, not a project setting. A real browser loads the site
normally. ~~**Phase 3.2's acceptance is therefore still owed**, not passed and
not skipped.~~ **SUPERSEDED — it passed at 00:24:12 on 27 Aug**, once
`real.config.ts` gained `channel: 'chrome'`: mitigation was fingerprinting
Playwright's bundled `chromium-headless-shell`, and the real Chrome on the
machine — still headless — answers 200. The two lines are live and read back:
`credit` ₹3,200 against `setup` ₹2,400, both `one_off`, same timestamp, netting
−₹800 through `_SIGNED_AMOUNT_SQL`, in E2E. Left standing with a line through it
because the diagnosis above is correct and worth keeping; only the verdict
moved.

## 2026-08-26

Seven parallel agents, partitioned by file so no two shared one. Every live
figure below is a read-only `SELECT`; **no write-probe touched the shared
database** and the vendor/holiday counters were re-read afterwards to prove it.
The two exceptions are the PT slab re-point and the two employee-state
backfills, each run on the owner's explicit instruction with the before-state
captured and the reversal written down.

### Phase 7 researched, Phase 8 written — and three of the corrections are licence text

`9c211b28`. **Research and plans only. No code, no migration, no row moved** —
Phase 7 stays ⬜ and Phase 8 opens at 🔵. Recording it here because the plans it
amends are now different documents, not because anything shipped.

`docs/proposals/92-map-integration-market-research.html` — ~40 sources across
competitor idea boards, vendor docs, licence terms, Indian government policy and
conversion benchmarks. **The demand answer: the most-requested map feature is not
a map.** It is "plot my records, and tell me who owns which area", and the routing
half is the half vendors charge for — Badger sells territory management as **four
separate add-ons** on top of a $58–95/user/mo base, Salesforce Maps is a
$75–150/user/mo add-on, Zoho RouteIQ starts at $12. Phase 7 was already aimed
there, in that order, so the ordering survives unchanged.

**Four premises corrected. Three are Mappls licence text, read off their published
terms — not preferences, and each one changes an acceptance criterion:**

- **7.5's attribution does not satisfy the licence.** The plan specified the string
  *"Basemap © Mappls"*. The terms require the **"Powered by Mappls [logo]"** to be
  "clearly presented" and say it shall never be removed or hidden. Fixed in the plan
  before the render test gets written, because a test would otherwise lock in the
  wrong thing.
- **No Mappls map "with or near a non-Mappls Map in a Customer Application."** That
  permanently closes off mixing MapLibre/OSM/Google anywhere in the app, mobile
  fallback included — and it is a second, independent reason the already-rejected
  Protomaps option stays rejected rather than blended in.
- **What we send to Mappls, we licence to Mappls.** Submitting content to their
  servers grants a perpetual, worldwide, sub-licensable licence to reproduce, sell
  and distribute it — and an autosuggest call on a client's premises is a
  submission. 7.6 now sends the **query fragment only**, never the stored record,
  never for an already-saved address, and **never on the public inbound form**, with
  Mappls named as a processor in the privacy notice. Their terms also forbid caching
  "to avoid paying fees", so a results cache is not available as a cost lever.
- **Google's rejection reasons were stale.** The plan rejected it on "USD billing,
  card required". India-based customers are **billed in INR**, and India gets
  **70,000 free monthly events per Essentials SKU** — 7× the global 10,000, and far
  beyond any volume we approach. The standing no-Google-spend rule still settles it,
  which is the owner's call; the wrong reasons are gone. Separately: **Maps URLs take
  no API key, no quota and no billing account**, which is what Phase 8.0 is built on.

**Competitive facts worth the search on their own.** Zoho CRM's native Map View is
**powered by Mappls**, on all paid editions, and exists **only in the IN data
centre** — the Indian incumbent our customers already know picked the same vendor.
HubSpot's equivalent is Enterprise-only, still in beta, caps at **500 records**, and
geocodes from **City/State/Country/Postal code**, not the street line — the market
leader works at postcode granularity, so nobody should argue us up to rooftop
precision. And **no Indian CA practice-management competitor advertises a map at
all** (Suvit, QwikCA, PracticeStacks, Jamku, Zoho Practice): maps are not table
stakes in our category, they are uncontested differentiation.

**Indian addressing, measured, not assumed:** only ~40% of Indian addresses geocode
to 500 m precision and only ~30% are written in a structured format. That is the
evidence behind 7.6's "reset the expectation" lede, and it belongs in the copy.

`docs/plans/PHASE-8-maps-across-modules.md` — **Phase 7 is 100% Graha** (every file
it names is `graha.py`, `graha/*.jsx` or `TerritoryMap.jsx`). Phase 8 is the other
six modules, ordered so the free parts ship first: **8.0 `<AddressBlock>`** across
Graha / Ganit / Kray / Manav / Vikray / Pahchan — no key, no quota, no CSP change,
and it needs nothing from Phase 7 — then **8.1 the Pahchan geofence map**, then the
free PIN popover (reuses 7.3, zero vendor calls), autosuggest reuse, and last a
stored coordinate carrying `geo_source` + `geo_fetched_at`, which is what unlocks
DIGIPIN at no vendor cost.

**Altitude on attendance turned out to be already built** — the owner raised it as a
gap and it is not one: migration 193, `routers/pahchan.py` (validation +
`_altitude_gap_m`), `mobile/src/offline/punchQueue.ts`, `Sites.jsx` / `Rules.jsx` /
`Register.jsx`, and `test_pahchan_altitude.py`. Ruled out in the plan: a **barometer**
(many Android devices carry no pressure sensor, and pressure altitude drifts ±100 m
with the weather) and **correcting the geoid offset** (India sits over a ~−105 m
anomaly, but site and punch are measured by the same phones — correcting one side
breaks every existing site). **One open item, and it is data not code: does any live
site actually carry an `altitude_m`?** Migration 193 recorded 9 sites and 1,659
punches with all four columns NULL. The real Pahchan gap is the **map** —
`Sites.jsx:31` already names the risk of "a radius typed as 15 instead of 150".

**A shared-tree hazard caught in passing.** `git worktree list` shows **one**
worktree, so a peer session's uncommitted work is visible in the same `git status`
— and any `git add -A` would sweep it up. This commit staged five explicit paths.
The plan's line **"next migration number is 222"** went stale inside ten minutes:
the peer committed 222 (`billing_credit_kind`) and started 223
(`service_line_invoice_from`) while this was being written. The plan now teaches
the check instead of naming a number — **`ls backend/migrations/`**, not
`git ls-files`, because only `ls` sees the untracked migration a peer holds
mid-flight.

**Still owed from the owner before 7.1 can be built** — the three open questions,
with recommendations in proposal 92 §8: a priority integer for a PIN claimed by two
territories (Salesforce's mechanism; never blocks a save), **territory always / rep
only when unassigned** (unanimous in the routing literature, and 42 of 54 Unicode
contacts already have an owner, so a rep-setting router would reassign live work on
its first run), and an optional six-digit PIN on the public form shipped **after**
7.0. **STATUS: 🔵 research + plans landed; nothing built.**

### Phase 3.3 acceptance — the first client auto-invoices this product has ever raised

`/cron/billing` fired twice by hand against the deploy (`785d487f`, confirmed
SUCCESS on Railway before firing — the old code would have back-billed April).

| | before | after |
|---|---|---|
| `client_invoice_lines` | **0** | **2** |
| `ganit_invoices WHERE billing_profile_id IS NOT NULL` | **0** | **2** |

Both for Unicode Group, both for **2026-08-01 – 2026-09-01**:

| Invoice | Line | Net | GST | Total |
|---|---|---|---|---|
| `INV-2026-0093` | Monthly accounting retainer | ₹75,000 | ₹13,500 | **₹88,500** |
| `INV-2026-0094` | Payroll processing (up to 50 employees) | ₹15,000 | ₹2,700 | **₹17,700** |

Intra-state — `place_of_supply` **24**, `is_igst` false, CGST ₹6,750 + SGST
₹6,750 on the first and ₹1,350 each on the second, which is Gujarat supplying
Gujarat and the tax split Phase 2 taught this file to refuse rather than guess.
`payment_status` `unpaid` with `balance_due = total`, so neither is born paid.
`line_items` carries description, rate, amount, `gst_rate` and `cost_basis` —
the empty-body defect from 2.3 stays fixed. Serials drawn in sequence from
Unicode's own series (they were at 92).

**Second run, same day: `created: 0, skipped: 2`.** Both halves of the written
acceptance in one afternoon — a period boundary produces an invoice, a second
run inside the period produces nothing.

**April, May, June and July were NOT raised.** The floor held.

### The live-row write behind that — owner-approved, two rows

**Owner, 2026-08-26, asked and answered before anything was armed:** the sweep
would have back-billed Unicode's client to April — ten documents, ₹4,50,000 +
₹81,000 GST. He chose *start the clock in August*.

    UPDATE staging.client_service_lines
       SET invoice_from = DATE '2026-08-01', updated_at = NOW()
     WHERE id IN ('e80256b7-15d1-4398-8e61-42bf883b3366',    -- retainer ₹75,000
                  'a674a0fe-b502-41ce-9bd7-bb668e1c584e');   -- payroll  ₹15,000

Before-state: both NULL (the column was minutes old). Reversal:
`SET invoice_from = NULL` on the same two ids — which restores the April
backlog, so it is only to be run if those four months are wanted after all.
`period_start` still reads 2026-04-01 on both, which is the point of doing it
this way: the contract's start date was not rewritten to change what gets
invoiced.

**3.4 is verified but NOT SCHEDULED.** The endpoint returns 200 and behaves on a
repeat run; `billing` still has to be added to `cron-daily`'s curl loop
(`hr invoices crm stock marketing skills scraper-prices`), and that config edit
needs a FRESH deploy — a redeploy reuses the old config snapshot.

### Phase 3.2 — the plan-change credit was a second charge

`services/proration.py` computed the credit for the unused days at the old rate
correctly and then wrote it as `kind='setup'`, which is a CHARGE, because
`services/billing_lines.py:300` refuses a negative amount. **A mid-cycle change
raised two debits.** ₹8,000 → ₹3,000 halfway through August billed ₹5,500 where
it should have credited ₹4,000 against ₹1,500 of new charges — a ₹8,000 swing
on one plan change, in Aekam's favour, every time.

The column is not the thing to change. `amount NUMERIC(12,2) CHECK (amount >= 0)`
is deliberate — 096 argues it out — and a signed column would make every `SUM`
in the product answer a different question from the one its caller is asking. So
the magnitude stays positive and **the KIND carries the sign**:

- **Migration 222 applied and verified from `pg_constraint`** — `org_billing_lines_kind_check`
  gains `'credit'`; new `org_billing_lines_credit_ck` refuses a monthly credit
  (a discount that runs for ever is not a proration). Locks: ACCESS EXCLUSIVE on
  8 rows, milliseconds. No row written, no row re-read differently. Migration
  first, then the backend — `create_line(kind='credit')` against the old CHECK
  is a CheckViolation the operator sees as a 500.
- `_signed_amount` / `_SIGNED_AMOUNT_SQL` — **one rule, two languages, defined
  next to each other.** `list_lines`' two totals, `lines_due_in_period`'s total,
  and `record_billed`'s INSERT fallback all go through it. `one_off_total` can
  now go negative, and saying so is the point: a month where Aekam owes the
  client ₹2,500 is not a month it bills ₹5,500.
- `record_billed` accepts a signed figure for `invoice_billing_lines.amount`
  (no `>= 0` CHECK there, deliberately, since 096) **and refuses a sign that
  contradicts the line** — a credit recorded as a charge bills the refund; a
  support line recorded negative forgives a fee nobody approved. Neither is
  normalised silently.
- `_row_to_line` now sends `signed_amount` beside `amount`, so no screen derives
  the sign for itself. `InvoiceBuilder.jsx` loads that, and its amount field
  loses `min="0"` — the browser would otherwise have refused a form on a row the
  server had just sent.

**And the day-count, decision 0.17 — a third convention was hiding here.**
`days_in_period` counted plain calendar days: **31 for August 2026**, where
`vetana.py` puts **26** on every payslip and `client_billing.py` counted 21
before Phase 2 fixed it. Every proration this module has ever computed was
priced against a month the payroll beside it did not recognise. Now
calendar-minus-Sundays, through one `_working_days` helper that `prorate` and
`should_waive` both call, so the fraction and the waiver cannot disagree.
August 2026 splits 13 + 13, which is exact.

### Phase 3.3 — a monthly retainer invoiced once, for ever

`sweep_client_auto_invoices` computed the period as
`next_anchor(anchor, sl["period_start"])` — **recomputed from the service line's
own origin on every run**, so it was a constant. The first sweep invoiced it,
`client_invoice_lines` held that period for ever, and every later run fell into
the duplicate guard and reported `skipped` — the same word it uses for a line
that is not due yet. Nothing in the product said a retainer had stopped
recurring.

It now advances from **the last invoiced period** (`MAX(period_start)` over
`client_invoice_lines`, the row that already exists to stop double-billing),
stepping by `period_end_for` so a quarterly line moves a quarter. **One period
per run, deliberately**: a line dormant for a year catches up a period a day on
a daily sweep rather than minting twelve tax invoices on the morning somebody
notices. Four new tests, including the acceptance both ways — twice across a
period boundary is two invoices, twice inside one period is one.

`sweep_client_auto_invoices` also takes an optional `org_id` now. The cron does
not pass it. It exists because this function writes tax invoices with serials
from a firm's live sequence, and the phase's own definition of done says the
rows may move off zero *in staging test data only*.

**Live-parsed, nothing executed.** `tests/test_billing_credit_sql_is_valid.py`
drives `list_lines`, `lines_due_in_period` and `record_billed` through a
recording connection and `prepare()`s every statement against the real
catalogue — Parse and Describe, no row read, none written — and reads migration
222 back from `pg_constraint` rather than from the file. 7 green under
`railway run`; `tests/test_client_billing_invoices.py` 33 green the same way.
Offline: `test_proration.py` 23, `test_billing_lines.py` 84.

**3.4 is NOT armed, and the reason is a live-data decision — see `STATUS.md`.**
All four `client_service_lines` belong to Unicode Group, two auto-invoice at
₹75,000 + ₹15,000 a month since 2026-04-01, and nothing records them as billed.
The first tick would raise April, and one more month each day after that: ten
documents, ₹4,50,000 + ₹81,000 GST, in a real customer's books.

### Nikhil Desai removed — and the payroll-header defect it exposed

**Owner, 2026-08-26: delete the employee entirely.** The alternative on the
table was building a way to re-run a `processed` payroll month; the owner chose
removal, which is coherent given that none of this data is live.

The figure had already been corrected once. It was published as ₹72,322 — a
calendar-day number **the product cannot emit**. Every vetana payslip in both
orgs uses `working_days = 26` for August 2026, and August has exactly 26 Mon–Sat
days: the engine runs a six-day week. On its own basis the shortfall was
**₹73,076.92** (July ₹38,000 + August ₹38,000 × 24/26).

Removed in one transaction, children before parent — the deletion order is fatal
reversed — with every row captured to `ledger_repair_20260826.nikhil_*` first:

| Table | Rows |
|---|---|
| `manav_employees` | 1 |
| `vetana_payslips` | 3 (2026-04/05/06, all `disbursed`) |
| `vetana_salary_structures` | 1 |
| `manav_offboarding` | 1 (`completed`, last day 2026-08-28 — a future date on an inactive employee, the contradiction that made him unpayable) |
| `manav_leave_balances` | 4 |
| `manav_leave_requests` | 1 |
| `manav_exit_interviews` | 1 |

Unicode headcount 27 → 26.

**THE DEFECT THIS EXPOSED, and the correction to what I claimed while doing it.**
His three payslips sat inside `disbursed` runs whose `employee_count` and
`total_gross` included him, so the transaction decremented those three headers by
exactly his contribution — stated at the time as "keeping the runs consistent".

**They were never consistent.** The pre-deletion snapshot settles it: the
2026-04 header already read 24 against **29** payslips. The decrement was
correct arithmetic on a number that was already wrong, and the runs are still
wrong now — five of Unicode's eight disagree with the rows beneath them, while
**E2E is clean on all seventeen**.

That is recorded as an open finding in `STATUS.md` and is deliberately NOT fixed
today: it is not obvious whether the header is wrong or whether payslips exist
that should never have been written, and it deserves the same written risk
report the ledger repair got.

### Six junk vendors removed, and a retention rule for the backup schemas

**Owner, 2026-08-26: "this data just remove it thanks."** Four vendors named
`p` and two named `probe`, created in Unicode Group in a 72-second burst on
2026-07-28 — write probes from an earlier session, left live. Six of the org's
fifteen, and `ganit.py:2677` filters only on `is_active`, so all six rendered in
the vendor picker.

Checked before deleting rather than after: **zero references** across every
column in the database whose name matches a vendor id — `ganit_expenses`,
`ganit_purchase_orders`, `ganit_vendor_bills`, `vendor_rate_cards`,
`vendor_sla_credits`. All six were orphans. Backed up to
`ledger_repair_20260826.junk_vendors_removed` first. Unicode's vendor master is
now **9 rows, every one a real supplier**.

**THE RETENTION RULE — the gap decision 0.30 could not have covered.** Three
backup schemas survive, and until now only one of them said when it may go.

| Schema | Holds | Drop when |
|---|---|---|
| `ledger_repair_20260826` | 5 tables, 23 rows, 80 kB | **Not before 2026-09-02.** It is the only reversal path for data changed today, and today is the worst possible moment to discard it. Nothing reads it; the only reason to keep it is the one that matters |
| `dead_tables_20260822` | 2 tables, 1 row, 56 kB | Governed by `migrations/194_drop_dead_crm_products.sql`, which documents the restore recipe. Droppable once nobody wants `project_templates_before_200` |
| `tenancy_195_backup` | 2 tables, 290 rows, 96 kB | Condition already written at `migrations/195...sql:210` — **"only once the 64 call sites have been migrated"**. Not yet verified, so it stays |

The rule this establishes: **a backup schema is created with its drop condition,
in the same commit.** 195 did this and 0.30's three did not, which is why they
needed an owner decision at all. 176 kB across all three is not a cost worth
optimising; an un-reversible repair is.

### The dunning cron was chasing 54 documents nobody owes money on

Found by reading a live reminder rather than the code, which is the only way it
could have been found: every test in the suite passed, and the four surfaces
Phase 2 fixed all still read correctly.

**Phase 2 closed "draft invoices are dunned and counted as revenue" across four
surfaces and missed the fifth — the one that actually sends the email.**
`services/reminder_service.py::_INVOICE_SCAN` filtered on
`payment_status NOT IN ('paid','void')`, `due_date < NOW()` and `is_active`, and
nothing else. The four that were fixed all *display* a number; this one puts a
letter in front of a customer.

Live before the guard, both organisations: **359** `invoice_overdue` rows aimed
at documents that cannot owe anything — 347 in E2E Test & Associates, where the
outbound fence held them at `suppressed`, and **12 in Unicode Group, where it
did not, all at `status='sent'`**. Of the 228 invoices the selector matched,
**174 survive it**.

Three guards, the same family `record_payment` already refuses, seen from the
other side:

| Guard | Why |
|---|---|
| `doc_status <> 'draft'` | Nobody has been sent the document, so nobody can be late paying it. 52 overdue drafts across the two orgs, one for ₹6,03,997 |
| `invoice_type <> 'credit_note'` | Money owed the other way — dunning one asks the customer to pay for a refund you owe them |
| `balance_due > 0` | Nothing is outstanding |

**The third guard is the one the status column could not have supplied**, and it
is why this was visible at all. `payment_status='unpaid'` on a zero-total
invoice is not a contradiction the product prevents: at 13:04 UTC today the cron
emailed Unicode Group *"Invoice INV-2026-0007 is overdue. Balance: ₹0.00"*, and
would have repeated it every three days indefinitely. Status is a label somebody
set; the balance is arithmetic. Guard on the arithmetic.

**One honest attribution.** This session's ledger repair flipped INV-2026-0007
from `paid` to `unpaid`, which is what made it dunnable *with a zero balance*.
But it was already in the dunning stream — the same invoice was emailed on 19
and 22 August reading ₹74,340 — and INV-2026-0047 has the identical zero-balance
shape and was never touched by the repair. The repair changed what the letter
said; it did not create the letter.

`test_dunning_refuses_documents_nobody_owes.py` — 7 tests, three of which fail
against the pre-guard selector, verified by removing the guard and watching them
go red.

### The ledger repaired — owner confirmed none of it is live

**Owner, 2026-08-26: "no live users or legal payslip, all are seeded."** That
resolved the seven items the brake had held as NEEDS-OWNER: its caution was
built on reading Unicode as a real customer's ledger, and it is not one. Every
figure below is now internally consistent.

Captured first into `ledger_repair_20260826` (payments, invoice states, expense
claims, the 2020 run) so every step reverses.

**Six payments removed, and their invoices restored to unpaid:**

| what it asserted | doc | amount |
|---|---|---|
| a receipt against a DRAFT | Unicode INV-2026-0005 | ₹2,06,500 |
| a receipt against a DRAFT | E2E INV-2026-0012 | ₹5,000 |
| a receipt against a DRAFT | E2E INV-2026-0016 | ₹5,000 |
| a receipt against a DRAFT | E2E INV-2026-0147 | ₹590 |
| a receipt against a CREDIT NOTE | E2E CN-2026-0148 | ₹2,950 |
| ₹60,000 received on a ₹0 invoice | Unicode INV-2026-0007 | ₹60,000 |

**`INV-2026-0048` born paid** — ₹53,100 total, ₹0 balance, no payment row —
corrected to owe its full amount.

**Three approved expense claims detached** from payslips that were voided and
never disbursed (₹800 + ₹1,200 + ₹5,000, all Unicode). They promised
reimbursement on a slip nobody was paid from.

**The January 2020 payroll run deleted.** The brake had ranked this DO-NOT on
the grounds that `org.spec.ts:197-211` asserts it — reading the spec settles it
the other way: that test POSTs `{month:'2020-01'}` and asserts a **refusal**
(`>= 400`), so it never depends on the run existing. The row was residue from a
run that once succeeded with an admin token: `employee_count 0`, `total_gross 0`,
zero payslips, sitting in a payroll list a tester scrolls.

**Nothing left to delete on holidays.** The sweep's "15 duplicates" were
DISTINCT NAMES sharing a date — Dussehra and Gandhi Jayanti both fall on
2025-10-02, and each e2e run adds its own tagged holiday. Zero exact duplicates
on (org, date, name) remain after the single genuine twin was removed earlier.

**Verified after, both orgs:** 0 payments against a draft, credit note or
zero-total invoice · 0 invoices where `balance_due <> total − Σpayments` · 0
born-paid · 0 expense claims pointing at a voided payslip · 0 phantom runs.

**Still owed and NOT done:** Nikhil Desai's missing July and August pay
(~₹72,322). His last working day is 2026-08-28 — still in the future — and the
August run is already `processed`, which `process_payroll` refuses to re-run. It
needs a deliberate remediation, not a data edit.

### The data/code consistency sweep — and the answer it actually gave

Owner: make the data go hand in hand with how the system behaves, and delete
what does not. **Six read-only sweeps plus an adversarial brake said the data is
mostly right and the READS are wrong**, which is the opposite of what was
expected and the reason nothing was deleted in bulk.

**Only TWO data changes survived review.** Unicode's two employees with no work
state → `'24'` (0 remain), and one duplicate "New Year" holiday of two rows 33
seconds apart. Everything else was ranked NEEDS-OWNER (7) or DO-NOT (5).

**Two proposed deletes were acceptance evidence.** The E2E January-2020 payroll
run is asserted by `frontend/e2e-real/org.spec.ts:197-211`; two payments the
sweep called fabricated are Playwright fixtures. Deleting them would have
broken a test AND removed the only live proof the door was open.

**THE FLAG IS NOT STALE DATA.** Ten E2E employees are `is_active=true` with past
exits, and clearing it was the obvious "fix". `routers/manav.py:1958` records
why it would be wrong: offboarding used to clear the flag, which dropped the
person out of payroll and left an outstanding advance unrecoverable. Live, two
of the ten carry advances totalling **₹1,15,000**. Unicode shows the mirror
image — its one leaver WAS deactivated early, his last working day is
**2026-08-28, still in the future**, and he is missing July and August pay of
about **₹72,322**. The flag is load-bearing in both directions.

**So 31 READS were guarded instead**, across 9 files, all through one new
`services/on_the_rolls.py` — zero hand-written copies added. E2E figures:
directory / `/stats` / Vetana dashboard / Pahchan enrolment queue / skill KPI
all **83 → 73**; department counts 8→6 and 7→6; schedule coverage stopped
reporting every day under-staffed by ten; **announcements 83 → 73 recipients**,
all ten of whom hold an address and were receiving every internal announcement;
and asset assignment, the route that issued the **8 assets still out with the
ten**. Unicode is 26 → 26 everywhere, which is the defect's whole shape.

**The brake caught a regression in that work too.** The Dristi pivot's
`employees` source declares `date_col: date_of_joining`, so with a window it is
a joiners cohort — a FLOW — and the guard would have erased everyone who joined
in the period and has since left. Inverted, and the test that defended it
inverted with it.

**And it caught a claim of mine before it shipped.** I wrote that Pahchan seat
BILLING was charging for ten departed people. Nothing invoices off that roster:
one read-only consumer, no org has `max_pahchan_seats` set, and there is no
payment gateway in this product. Corrected in the code and to the owner.

**Four code fixes replaced the deletes** (`routers/ganit.py`): `invoice_stats`
counted drafts as outstanding/overdue/collected beside Dristi figures that
already excluded them; `record_payment` accepted receipts against CREDIT NOTES
(reporting refunds as collected revenue) and against DRAFTS (four exist live,
one ₹2,06,500); `update_vendor` never set `updated_at`, NULL on all 80 rows, on
the facts a 43B(h) position is argued from. Plus both `manav_leave_requests` →
`manav_employees` joins scoped on `org_id`, not the employee id alone.

**Still owed, owner decisions:** three expense claims on voided payslips (arms a
₹7,000 payout), the ₹2,06,500 and ₹60,000 draft receipts, `INV-2026-0048`'s
balance (+₹53,100 outstanding), the 2020-01 run, 14 duplicate holidays, and
Nikhil Desai's missing pay. Newly found and not acted on: E2E's July run paid
nine of the ten leavers a full month; one employee holds a `disbursed` payslip
dated a month BEFORE her joining date; `ganit_invoices.line_items` holds two
incompatible schemas in one column.

### Territories folded into the plan as Phase 7, and the 60 rows deleted

**`docs/HANDOVER-2026-08-26-territory-maps.md` is now `PHASE-7-territory-and-address.md`.**
A parallel session produced it from a live conversation with the owner rather
than from this plan, and handed it over unowned. Reconciled against Phases 0–6
before writing: no phase owned territories or CRM address capture, and its
findings contradict nothing marked done. Phase 4 is the nearest neighbour in
shape — a table with no screen — but enumerates eight named screens, so this is
an addition rather than a fit.

**One thing was re-ordered on the way in.** The handover lists routing LAST of
six while calling it "the part the owner is actually selling". Phase 7 puts it
FIRST: `rules.pincodes` has zero backend consumers, so **territories route
nothing today**, and fixing that is string equality on a PIN — no polygon, no
SDK, no CSP change, no vendor. It is the cheapest item on the list and the only
one with revenue attached. The map explains a territory; routing is what it does.

**60 post-exit attendance rows deleted from E2E**, on the owner's instruction.
All 60 `marked_by='system'`, all `holiday`/`weekend`, dated 2026-08-08 to
2026-08-23 across 10 people whose recorded last working day had passed — written
by the `/cron/hr` bug fixed earlier today. Proven safe before the delete rather
than after: **0** of the 60 carried a pay-affecting status, no table in the
schema has an `attendance_id` column, and the one August payslip among those
people is the mid-month leaver whose 2 days come from the employment window, not
from attendance. Every row captured in full first. Verified after: 0 post-exit
rows remain, E2E attendance 426 → **366** (exactly −60), Unicode untouched at
152, and the August run still reads 51 payslips / ₹10,000 PT — nothing moved.

**Standing rule recorded:** seed and test data is KEPT by default. The rows a
test creates are the acceptance evidence; deleting them re-opens the question
the run just answered. Delete only when provably safe and there is a reason,
proven by a live SELECT beforehand.

### Phase 2 acceptance — 10/10, driven as a real user

`phase2-acceptance.spec.ts`, against the deployed site in E2E Test &
Associates, month 2026-08. The outbound fence is asserted against the org the
SESSION is in before a single write — `POST /payroll/process` emails every
employee their payslip with a PDF attached, unconditionally.

| | proved |
|---|---|
| 2.1 leavers | run paid **51, not 60** — the nine dated before the month are out, the tenth (last day inside it) correctly still in |
| 2.1 pro-rating | `present_days` across the run spans **2 to 26**; the 3-August leaver got 2 |
| 2.2 professional tax | **₹10,000** from the Maharashtra ladder across 51 payslips |
| 2.4 drafts | overview **₹11,14,93,756.12** invoiced, **₹2,71,54,767** outstanding, with **₹54,78,968.92** of drafts on the books and excluded |
| 2.5 tenancy | a profile for another org's client is refused |
| 2.6 pahchan | catalogue offers the geofence metrics and cites no unapplied migration |
| 2.2 ladder | a February band added through the settings screen, resolved, and removed — ladder left at 9 shared rows, 0 org-owned, 0 month-specific |

**₹10,000, not the ₹10,200 predicted.** Pro-rating drops the leaver's gross to
about ₹3,438, which falls in Maharashtra's lowest band at ₹0. Two fixes
composing, and the number nobody would have predicted from either alone.

**Four of the six failures on the way were the harness, not the product** — a
wrong endpoint path (`/manav/exits` for `/manav/offboarding`), the wrong
response envelope, a `hasText` filter that matched the statutory summary's own
"Professional tax" heading instead of the ladder section, and a spec that
always POSTed a payroll month the endpoint refuses to reprocess. Each is
recorded in the spec so the next reader does not re-derive it.

### Phase 2 FINISHED — the six fixes, and the nine things verifying them found

**The acceptance the plan actually wrote** is "all six re-verified with a
read-only live query showing the wrong output is gone" — not "the code shipped".
Four of the six had never been exercised at all. Twelve independent verifiers
plus a completeness critic went at them; the result was 1 green, 11 amber, 0
red, and nine defects nobody had recorded. Every one below carries a live
figure, and every fix carries a test proven to fail without it.

**Payroll paid a part-month as a whole one.** `vetana.py:1240` promised a
mid-month leaver is "pro-rated by the attendance arithmetic below"; that
arithmetic falls back to the WHOLE month whenever nobody has been marked present
or absent, and live, in both orgs, ZERO August rows carry a status in
(present, late, half_day, absent). The fallback is right and stays — "nobody has
said" must never silently dock pay — but it is now bounded by the employment
window, a fact the system already holds. Of 51 payable in E2E, 50 keep ratio
exactly 1; the one that moves is a leaver with a 3 August last day and a ₹44,700
monthly gross, employed 2 of 26 working days: **₹44,700 → ₹3,438, an overpayment
of ₹41,262 avoided on one payslip**. An earlier report of this said "all 75 are
affected" — that was wrong, and the correction is the point: for 74 of them a
full month is the correct answer.

**`/cron/hr` was marking attendance for people who had left.**
`attendance_auto_mark.py` selected `is_active` with no offboarding guard; E2E's
3 August leaver carries six system-marked August rows running to 2026-08-23,
three weeks past his exit.

**Dristi's `/overview` tile was the largest wrong number in the product.** It
was `WHERE org_id=$1::uuid` and nothing else, printed directly above a trend
chart that Phase 2.4 HAD fixed — so the two disagreed on screen. E2E invoiced
read ₹12,29,86,008.58 against a draft-free ₹11,14,93,756.12: **a ₹1,14,92,252.46
phantom over 97 drafts**, with outstanding ₹3,86,36,429.46 against
₹2,71,54,767.00. Outstanding matters more than the headline — an unissued
document is not a receivable, and that figure is what a partner chases a client
over. The agent also found a case nobody had named: **a draft can be marked
paid**, and Unicode holds one worth ₹2,06,500, so `payment_status='paid'`
narrowed the leak without closing it.

**Phase 2.5's ratchet covered one module, and the ledger said so without the
qualifier.** Re-running its own logic across `backend/` finds 114 party joins,
**42 still on the id alone**. Four are on `graha_clients` — the table the plan
calls the leak — including the unpaid-invoice pay-link list a dunning letter is
written from. Those four are fixed and still LEFT JOINs, so a row failing the
predicate drops to a NULL name rather than falling off the collections list. The
other 38 are carried in a named allowlist that fails if the count GROWS.

**Two statements the product made to users were false.** The PT brief still
printed "nothing records which state each employee works in" on every run, over
96 of 98 employees who now carry one; `pahchan.py:25` still called an applied
migration "not yet applied". Both corrected, and the second now records why the
file keeps its PROPOSED_ name.

**Phase 2.3's repaired invoice writer violated Phase 1.3** — it builds lines
inline with no cost, and 1.3's two AST ratchets parse `ganit` and `vikray` by
name and cannot see that file. Resolved as an explicit `cost_basis` marker
rather than a call to `apply_line_costs`: there is no product behind a retainer
or a metered GB, and a zero would report every rupee of service revenue as pure
profit — 184's ABSENT, NEVER ZERO rule.

**Analytics disagreed with payroll by exactly nine.** `vetana.salary_bands`
banded 60 while the run pays 51. Fixed with the distinction that matters: a
STOCK (who is on the rolls today) carries the offboarding guard, a FLOW
(`payroll_cost` — money paid in months they were employed) deliberately does
not.

### Professional tax became something a person can set

Owner's call: do both, and bear in mind not everything is mandatory — it must be
optional and settable per module, never blocking.

**The gap was bigger than February.** Nothing in this product could write
`pay_professional_tax`; every backend reference was a read, and the nine rows
existed because a migration put them there. A state nobody seeded, a rate
change, or Maharashtra's different February figure could only be fixed by
shipping another migration — the same shape as every Phase-1 defect, a column
with no write path.

**Migration 221 APPLIED**, verified from `pg_constraint`: `month smallint NULL`,
CHECK 1–12, nine rows all NULL. NULL means EVERY month, so the migration is a
no-op until somebody seeds a month row. Resolution order falls back and never
refuses: `org + this month → org + every month → shared + this month → shared +
every month → ₹0`.

**A shared row is read by everyone and editable by nobody.** All three write
endpoints are scoped `org_id = $1::uuid` with no NULL branch; an org that wants
a different figure adds its own band, which outranks the shared one. Somebody
else's row answers 404, not 403 — a distinct refusal confirms the row is there.
The screen lists shared rows without controls, because hiding them would present
an empty ladder as "nothing is deducted".

**The February figure is NOT seeded.** `statute_calendar` holds zero
professional-tax rows to check it against, and writing an assumed statutory
number into 51 people's deductions is the failure mode this work exists to end.
The acceptance run creates the band, proves the whole chain, and removes it.

### Both deploys confirmed — everything below is RUNNING

**Check BOTH, always** (owner, 2026-08-26). Backend and frontend ship from the
same push but deploy independently; verifying one and calling it a deploy check
is half an answer, and Phase 1 is mostly frontend.

`120d106c` deployed to the Railway staging service at **04:14 UTC 2026-08-26,
status SUCCESS**, read from the deployment list rather than inferred from git.
**Superseded thirteen deploys later:** the active deployment is now `cc371297`
at 12:25:42 UTC, and `1963c128` — the commit the Phase-2 acceptance needed —
went live at 08:45:24, 84 seconds before the acceptance payroll run — the branch has silently tracked `main` before. So all
six Phase-2 fixes and all six Phase-1 write-paths are live, and the earlier
"deploy owed" wording in `STATUS.md` was stale; corrected there.

**Frontend — resolved from OUTSIDE, not from the Vercel list.** Every Vercel
deployment in this project carries `target: null`, so "READY" never establishes
what the domain serves. Fetched `staging.kartavaya.com` and hashed what it
actually returns: 3 entry assets + 123 lazy chunks, 3.17 MB js / 580 KB css,
carrying `--m-niyam` (76b7c6f), `.blx` (0ef99dcb) and `st__group--flush`
(5980a63b). The deployed frontend calls
`https://kartavya-staging.up.railway.app` — the staging backend, confirmed from
its own network traffic.

**Phase-1 UI driven live with the godmode token** (session restore of
`localStorage.auth_token`, never a credential typed into a form; forms opened
and dismissed, nothing saved): 1.2 renders MSME, Udyam, TDS section, payment
terms AND vendor kind · 1.5 renders the work-State field · 1.1 renders the
Salesperson picker · 1.6's Add-holiday form renders "**Applies to**" with
`Whole country` plus all 36 states/UTs, and the list has an `Applies to` column.
Zero failing `/v1/` responses across all four screens. The org switcher offers
Aekam Inc, Unicode Group and E2E Test & Associates; switched into Unicode and
Manav read **26 employees**, matching the database exactly.

**Two of my own checks were wrong, and neither was a product fault.** A
`price_monthly`-absent assertion failed because the string legitimately survives
on `AdminBillingPage.jsx:555`, the platform-staff surface where a price SHOULD
render — `PlanComparison.jsx` is deleted and `.opl` is gone, which is what
04d30ba2 actually promised. And a `state` assertion failed on the Holidays
list because the product says "Applies to", not "State". **The earlier ledger
claim that `price_monthly` "no longer appears anywhere in the deployed JS bundle
at all" is corrected here: it does appear, correctly, via AdminBillingPage.**

**One real defect, found only by reading the DEPLOYED console.** `index.html`
carries ONE inline `<script>`; `script-src 'self'` allows it solely by a sha256
hardcoded in `vercel.json`, and the two had drifted — one script, one allowed
hash, no match. The browser refused it on every load, so `data-theme`,
`data-conv-pattern`/`data-conv-ground` and `data-platform` never ran: a frame of
the wrong theme for every dark-mode user, Sanvaad snapping from the default
ground at mount, and on Windows a frame of blurred sidebar snapping solid —
precisely the first-paint jumps that script exists to prevent. Invisible to the
build, the suite and every source-level check. Fixed in `2ef060a9` and
`scripts/check-csp-hash.mjs` added as the FIRST gate in `npm run check`, failing
both ways (script with no hash, hash with no script) and proven to fail before
being trusted. Verified after deploy: `data-theme` follows
`prefers-color-scheme` in both schemes, `data-platform=win` is set, zero CSP
refusals.

**Deployed is not exercised.** No payroll run and no billing create has happened
since 04:14, so 2.1–2.4 have executed against nothing. E2E's latest run is
2026-07 and Unicode's `2026-09` "draft" dates from **23 July** — pre-deploy, so
it is not evidence of the new PT mechanism. The first real run is the proof —
**and it has since run**: E2E 2026-08 at 08:46:48 UTC, 51 payslips, ₹10,000 of
professional tax, `present_days` from 2 to 26.

**Phase-1 acceptance counters, read live, two orgs only** — the "a row moves off
0" test, which is what separates 🟡 from ✅:

**Re-read live 2026-08-26 after `775b1bcc`. All six have moved.** The table
below previously recorded five zeros; it was written at 06:48 and never
refreshed after the acceptance ran at 08:36, while five later commits edited
this file around it. That is the exact failure this document exists to prevent.

| Acceptance | rows set / total | when |
|---|---|---|
| 1.1 `salesperson_id`, invoices | **5 / 800** | all 5 created today |
| 1.1 `salesperson_id`, orders | **3 / 380** | all 3 created today |
| 1.2 vendor MSME/TDS (any of 5 cols) | **12 / 90** | all 12 created today |
| 1.4 expense → client contact | **9 / 385** | all 9 created today |
| 1.5 employee `state` | **110 / 110** | backfill + 12 UI creates |
| 1.6 holiday `state_code` | **11 / 48** | all 11 created today |

Every set row is in E2E Test & Associates, created through the UI as a real
user. The written criterion is per-column, not per-org (`PHASE-1-write-paths.md`),
so all six are ✅ — but Unicode Group is still at 0 on five of the six, and a
second org exercising the same form is worth having before Phase 3.

### The only two orgs that matter — what is owed, per org

**Owner's scope call, 2026-08-26: E2E Test & Associates and Unicode Group.
The other three organisations (Aekam Inc, Demo - Kartavaya, UK AekamINC) are
explicitly out of scope and nothing below is written for them.**

|  | E2E Test & Associates | Unicode Group |
|---|---|---|
| org_id | `64e7bea6-6abe-490c-a2a4-27a60c6be916` | `fae87907-2f99-4b35-a241-c94d9e1e4a17` |
| `organisations.state_code` | **`27`** Maharashtra | **`24`** Gujarat |
| Active employees | 71 | 26 |
| `manav_employees.state` — at session start | 0 | 0 |
| …derivable from `address->>'state'` | **0 — nothing to derive from** | **24 of 26** |
| **`state` set now** (backfilled 26 Aug) | **71 of 71** from org `state_code` | **25 of 26** from address |
| Own `pay_professional_tax` rows | 0 | 0 |
| Slabs it resolves (shared, `org_id IS NULL`) | 3 (Maharashtra `27`) | 4 (Gujarat `24`) |

All figures read-only except the two backfills, 2026-08-26. The slab table holds
9 rows total, all now shared: MH `27`×3, GJ `24`×4, KA `29`×2 — verified live
from the table, not from the migration.

**1 · The billing tax split never blocks either of them.** `_tax_split` refuses
to guess when the supplier's state is unknown, and BOTH of these carry a
`state_code`, so the refusal path cannot fire for either. Nothing is owed here.
(It does fire for the three out-of-scope orgs; that is intended and left alone.)

**2 · Professional tax is ₹0 for both until slabs reach them — and the cheapest
fix is one UPDATE.** Neither org owns a single `pay_professional_tax` row. All
nine live rows belong to Aekam Inc, and they happen to be exactly the two
ladders these two orgs need: **Maharashtra (3 bands) for E2E, Gujarat (4 bands)
for Unicode**. Since `_pt_slabs` now reads a NULL-`org_id` row as a SHARED
ladder, re-pointing those nine rows —

    UPDATE staging.pay_professional_tax SET org_id = NULL;   -- 9 rows

**RUN 2026-08-26 on the owner's instruction**, scoped to the owning org id
rather than as a bare table-wide UPDATE, with the before-state captured first.
Verified after: both in-scope orgs resolve all 9 rows — 3 Maharashtra bands for
E2E, 4 Gujarat for Unicode. Reversible with `SET org_id =
'045b76ad-654b-42dd-b4b1-731700efc6c3' WHERE org_id IS NULL`.

A SECOND consumer had to be aligned first, and checking for it is what stopped
this being a regression: `services/skills/data/payroll_statutory.py:769` also
read `WHERE org_id = $1::uuid`, so after the UPDATE the PT brief would have
found ZERO slabs for every org and stopped naming which states it covers. It now
reads `org_id = $1 OR org_id IS NULL`, matching `_pt_slabs`, and its limitation
text — which asserted the table is per-organisation — was corrected.

⚠ **The UPDATE alone does not make PT non-zero.** A slab is matched on the
EMPLOYEE's state. The ladders are now VISIBLE to both orgs; entering employee
work states is what makes them APPLY — and that is the second write, recorded
below. Both halves are now done for both in-scope orgs (71 of 71 and 25 of 26).

**3 · Employee work state — Unicode BACKFILLED 2026-08-26, E2E still owed.**

*Unicode Group — done.* 25 employees (24 active + 1 inactive) set to `'24'`.
The residential-vs-workplace caveat I raised earlier turned out NOT to apply
here, and checking before writing is what established that: every address state
read exactly `Gujarat` — ONE distinct value across all 25 — and Gujarat is also
the organisation's own state, so there is no commuter case to get wrong and no
mapping to guess. Scoped to the org, to `state IS NULL`, and to an explicit
`ILIKE 'gujarat'` match. Reversal is `SET state = NULL` for that org: nothing
was set before, so it restores exactly.

Verified after: all 25 gross ₹18,000–₹150,000, every one above Gujarat's
₹12,000 top band, so the ladder charges **₹200 — identical to the flat rule they
were already paying**. No payslip figure moves. What changed is that the ₹200 is
now DERIVED from the Gujarat ladder instead of being a constant, and — the part
that matters — **this backfill is what stops Unicode's PT dropping to ₹0 on
deploy.** Two employees carry no address state and stay unset.

*E2E Test & Associates — RUN 2026-08-26 on the owner's instruction, 71 of 71.*
No employee carries an address state — re-confirmed at the point of writing,
`address->>'state'` is absent on all 71, ONE distinct value and that value is
NULL — so unlike Unicode there was nothing to derive from and the organisation's
own `state_code` (`27`, Maharashtra, read live) is the only defensible answer.
Scoped to the org and to `state IS NULL`; the CHECK
(`manav_employees_state_ck`, numeric 1–2 digits or 2–3 uppercase) accepts `'27'`.
Reversal restores exactly, because 0 rows were set before:
`SET state = NULL WHERE org_id = '64e7bea6-…' AND state = '27'`.

    UPDATE staging.manav_employees SET state = '27'
     WHERE org_id = '64e7bea6-6abe-490c-a2a4-27a60c6be916' AND state IS NULL;

Verified after: **71 set, 0 still NULL.** Simulated against the DEPLOYED leaver
predicate and the Maharashtra ladder, using each employee's own last payslip
gross: of the 60 in the 2026-07 run, **51 remain payable** and all 51 sit above
the ₹10,001 top band, so the next run charges **₹10,200** where the last charged
₹12,000. The ₹1,800 difference is exactly the 9 leavers × ₹200 — the Phase-2.1
guard, not a PT regression. **This is what stops E2E's PT going to ₹0**, which
was live-exposed from 04:14 UTC when the deploy landed.

Both in-scope orgs are now complete on 2 and 3, so the ₹0-fallback path no
longer fires for either. It remains the designed behaviour for any org whose
employees carry no state — not a fault.

### Phase 1 — the six write-paths

- `phase-1.2` · Vendor MSME + TDS enterable. Proved live first: all six columns
  exist on `staging.ganit_vendors`, nullable, with all three CHECKs present in
  **`pg_constraint`** (not merely in migration 175 — an inline CHECK on
  `ADD COLUMN IF NOT EXISTS` is skipped whole when the column exists), and
  **0 of 80** vendors carried any. The plan lists five columns; the live schema
  has a **sixth, `vendor_kind`**, which the 43B(h) skill explicitly tests
  ("not traders") — wired too, or the trader exclusion could never fire.
  Update uses `model_fields_set` (the pattern `billing.py:1187` documents) so a
  value entered by mistake can be cleared back to NULL; blank → NULL, never `''`
  (fails the CHECK) and never `0` (0 days is a real answer) · `ganit.py`,
  `VendorsTab.jsx`, `ganit.css` · `test_vendor_msme_fields.py` **19 passed**.
- `phase-1.3` · `cost_price` snapshotted onto each line at write time. Lines are
  **JSONB array elements, not rows** — `vikray_order_items`/`ganit_invoice_items`
  do not exist, so **no migration**. One helper `apply_line_costs`
  (`vikray.py:278`), one org-scoped batch lookup, imported by `ganit.py`. Copy,
  never join: `update_order`/`update_invoice` replace all lines, so an existing
  cost is carried forward or an old order would silently re-price at today's
  cost. Key OMITTED when unresolvable — never `0`, which reads as 100% margin.
  `InvoiceForm.jsx` never set `product_id` at all, so the invoice half was dead
  on arrival; fixed. Costs are internal — any client-sent value is discarded ·
  `test_line_cost_snapshot.py` **19 passed**.
- `phase-1.4` · Expense → client tagging. **The backend was already complete** —
  `contact_id` was in the model, the INSERT and the PATCH loop, and the list
  already returned `contact_name`; the entire gap was one missing key in the
  form's `BLANK`. Labelled "Client contact", not "Client": the column stores
  `graha_contacts.id`, a PERSON, and a heading saying "Client" would promise a
  company link the table cannot make · `ExpensesTab.jsx` · **7 passed**, proven
  to fail without the fix (2 of 7 red when the key is removed).
- `phase-1.5` · Employee `state`, numeric GST code (`'27'`). The convention is
  load-bearing: `pay_professional_tax.state_code` is numeric, so an alphabetic
  employee state would join to nothing and **silently compute zero PT for
  everybody**. Codelist imported from `client_register.py`, never copied.
  **Migration 220 APPLIED 26 Aug** — catalogue-only, 98 rows, 0 backfilled;
  column + CHECK verified live in `pg_constraint` afterwards.
  **The department FK was deliberately left out**: an FK skips NULL but not
  `''`, and 12 rows hold `''` plus 1 orphan `'Labour'` — 13 of 98 would violate
  it, so passing needs UPDATEs to live personnel rows. Independently re-verified
  (98/86/12/0-null, 30 depts, 3 inactive, 0 dup groups, 1 orphan). A unique
  index is blocked separately: `delete_department` is a SOFT delete, so plain
  UNIQUE turns delete-then-re-add into a 500, and a partial index cannot back an
  FK · `manav.py`, `EmployeesTab.jsx`, `220_employee_state.sql`.
- `phase-1.6` · Holiday `state_code` — **the column already existed** (migration
  175, widened by 180), so no migration. `list_holidays` never SELECTed it, so
  a written value was invisible. Also rewrote `attendance_auto_mark.py`, which
  is what the acceptance criterion actually turns on: it marked EVERY active
  employee org-wide. NULL holiday state = everywhere; NULL employee state =
  still marked ("nobody has said" must never silently un-mark someone) ·
  `HolidaysTab.jsx` · `test_employee_state_and_regional_holidays.py` **41 passed**.
  Fixed `test_cron_column_names.py`, whose column set had been lying about
  `state_code` since 175 landed.

### Phase 2 — the six correctness fixes

- `phase-2.1` · Payroll no longer pays leavers · `vetana.py:1221` `NOT EXISTS`
  on `manav_offboarding`, mirroring `analytics/metrics/manav.py:79`. Live
  dry-read: org `64e7bea6` 60 → 51 paid. The tenth leaver (last working day
  2026-08-03) is **correctly still paid**, pro-rated — the guard is not
  over-broad. `list_structures` deliberately NOT filtered: hiding a leaver's
  structure from HR is data-hiding, not a fix.
- `phase-2.2` · PT reads the slab table · `vetana.py:746`. ⚠ **Owner decision
  26 Aug: fall back to ₹0, per the plan.** As written this line was true: all 9
  slab rows belonged to ONE org (`045b76ad`), the two payroll orgs had none, and
  the deploy at 04:14 UTC did briefly expose both to a ₹0 PT run. **Closed the
  same day by two writes** — the slabs re-pointed to `org_id IS NULL` (shared)
  and employee states backfilled for both orgs. Next E2E run: ₹10,200 across 51.
  Unicode: ₹200/head, unchanged, now derived rather than constant. Phase 0.24
  per-org seeding is no longer what stands between these two orgs and correct PT.
- `phase-2.3` · The two billing INSERTs can execute · `client_billing.py`.
  Verifying the whole column list rather than the one the plan named turned up a
  **second** bug: `balance_due` is NOT NULL DEFAULT 0, so the invoice would be
  born reading as fully paid — ₹0 on the customer's pay link. Same defect
  `vikray.py:683` already paid for.
- `phase-2.4` · Drafts excluded from 4 surfaces · `documents.py:307,852`,
  `dristi.py:354,161`. **The plan's premise was wrong in a useful way:** the
  statement was not printing ₹1.16 cr of drafts — it bound ISO date *strings*
  into `$3::date` and 500'd, so it never rendered at all. Seven bindings fixed
  with the repo's own `::text::date` pattern. The export twin was fixed too, or
  the tile and its own CSV would have disagreed — which is the criterion.
- `phase-2.5` · Cross-tenant leak closed · `client_billing.py:220`. The plan
  named 2 id-alone joins; there were **7**. AST ratchet added. 0 rows had leaked.
- `phase-2.6` · Pahchan absence guards deleted · `analytics/metrics/pahchan.py`.
  All five columns proved live on `staging.pahchan_punches` and **populated**
  (699 punches). The guards' own test *required* the stale
  `PROPOSED_064_pahchan.sql` string — it was pinning the lie in place, and is
  now inverted. Two other guards were left ABSENT with honest reasons:
  `attendance_by_shift` has no `shift_id` anywhere (confirmed live), and
  `late_arrivals` is blocked by the **DPDP pin**, not by schema.

### Gate

Clean-HEAD baseline in a detached worktree at `119cad66`: **27 failed, 13,853
passed**. Three agents independently reproduced the same 27. Every failure in
this session's runs is one of those 27 or a transient mid-write state of a file
another agent was editing — **this work adds none**. The 27 are pre-existing:
`test_org_settings_amendable` ×11, `test_billing_lines_wiring` ×6, and the
`kray`-in-`SENSITIVE_MODULES` gating family (`middleware/subscription.py:66`
declares five, its test asserts four — a module wired into gating without its
tests). `npm run build` + all nine `npm run check` ratchets green.

### Owed, and NOT faked

~~Every Phase-1 acceptance is "a row moves off 0" ... None was done, so every
1.x row stays 🟡.~~ **SUPERSEDED the same day.** `775b1bcc` ran the acceptance
through the UI at 08:36 and all six counters moved; see the refreshed table
above. This paragraph stood uncorrected through five later edits to this file. Also newly found and NOT fixed: the project report is dead
on `staging.time_entries` (exists only in `public`); `dristi.py` `/overview` and
the pivot dashboard still count drafts and the pivot has the same date-bind bug;
`analytics/metrics/vetana.py:240` counts the same ten leavers.

## 2026-08-25

- `phase-1.1` · `salesperson_id` wired on invoice + order, create + update, with
  a name-only members picker (`/v1/org/members`, 403-tolerant) · `ganit.py`
  (InvoiceCreate $26, update SET, get_invoice name join), `vikray.py` (OrderCreate
  $19, OrderUpdate SET), `InvoiceForm.jsx`, `OrderForm.jsx` · column is `text`
  on both tables (live), backend 1023 green (1 unrelated pre-existing fail),
  build+check green. Acceptance (row moves off 0 via UI create) still owed —
  no write-probe on the shared DB.
- `design/glass` · Liquid-glass enriched: static `:root` defaults (fixes
  shadowless first paint), four-sided Apple rim on `--lg-inset`, hover-lift +
  press-squish motion tokens, dark-shadow arms, reduced-motion as token flips,
  3 no-op backdrop-filters deleted (`.tbl th`/`.tst`/`.k-dock`, opaque bg) ·
  `liquid-glass.css` · verified live on staging: `--lg-lift`/`--lg-scale-p` were
  empty on deployed CSS, resolve after change; KPI cards gain depth+rim; build clean.
- `docs` · Proposal 90 gap-analysis (50–88) + §7 comparison vs all prior status
  docs · `docs/proposals/90-*.html` · commit `cbb75307`.
- `docs` · Proposal 89 liquid-glass rescope (report+plan) · `docs/proposals/89-*.html`
  · commit `07185401`.
- `docs` · Phased execution plan created · `docs/plans/PHASE-0..6` · commit `cbb75307`.
- `docs` · Final verdict 00–90 · `docs/FINAL-VERDICT-00-90.md` (00–29 + 50–88
  live-verified; 30–49 from memory pending re-scan).
- `docs` · Living status system created · `docs/STATUS.md` + this file.
- `ui/laptop-fit` · viewport-fit.css — shell tightens on laptop screens; 2→5 rows
  at 1366×768 · `viewport-fit.css`, `CustomizePanel.jsx` (Fit-to-screen toggle) ·
  verified before/after on staging · commit `628703fe`. **STATUS: ✅ shipped.**
- `copy/landing` · "Indian accounting firms" → "one place to run an Indian
  business", all 6 places · commit `a53fed38`.
- `chore` · Restored `backend/server.py` after a stash mishap; removed 17 root
  debris files ($c + screenshots).

- `design/glass` · Apple-style pass on 3 of the 4 demoed components (buttons,
  icon tiles, confirm modal — popover/menu needed no change, already carried
  the same rim+blur+spring via the liquid-glass architecture): `.btn` gets a
  rounder squircle radius, a static top sheen on `--fill`, and a spring release
  on press (`--ease-spring`, was a flat `scale(.975)`); `.mh__ic` gets a
  diagonal tint gradient + the same 4-sided rim/hover-lift/press-squish as
  cards (added to `liquid-glass.css`'s `:is()` lists, respects the off-toggle
  and reduced-motion for free); ConfirmDialog gains a `--r-xl` radius, a
  grabber bar, a deeper contact shadow, and a spring entrance — scoped to
  `.modal__panel[data-intent]` (only ConfirmDialog sets it) so every other
  modal's documented MOTION-SPEC choreography is untouched · `components.css`,
  `module.css`, `liquid-glass.css`, `ConfirmDialog.jsx` · build clean; first
  verified by computed-style injection against the real loaded stylesheet
  (couldn't log in interactively — typing test credentials into a login
  field is a hard-blocked action regardless of context), then properly
  verified live and authenticated on `staging.kartavaya.com` via
  `e2e-real/mint-state.mjs` (owner token from `.env.e2e`, restores
  `localStorage.auth_token` — a session restore, not credential entry, so it
  doesn't trip the same block) driving real Playwright against the deployed
  site: real button on the Products tab, the Finance module header icon tile
  (screenshotted), and a real delete confirm dialog opened and cancelled
  (no write). All 4 approved sections confirmed — popover/menu needed no
  code change, already had rim+blur+spring via the existing liquid-glass
  architecture.

- `design/glass` fix · Settings rows (`.sr` in Customize → Appearance etc.) were
  getting a floating-card drop shadow (`--lg-shadow`) despite `border-radius: 0`
  and sitting flush against neighbours with only a `border-bottom` divider — the
  shadow had nowhere to round off to and bled past the row's own left/right
  edges into the panel margin, visible as a stray halo along the settings
  panel's outer edge (reported by the owner from screenshots). `.sr`/`.sr:hover`
  removed from `liquid-glass.css`'s glass treatment entirely — a bordered list
  row was never a card and doesn't need `--lg-shadow`/`--lg-shine`/hover-lift on
  any preset · `liquid-glass.css`. `.top`/`.mnav` checked and left alone: both
  are viewport-edge-to-edge, so the same shadow's left/right components fall
  outside the viewport and are never visible — not the same bug.

- `design/glass` fix 2 · Pipeline stage cards (`.vk-pl__st`, vikray → Pipeline
  tab) had `border-left: 3px` beside a 1px border on the other three sides,
  inside a rounded `border-radius` — an asymmetric border width breaks the arc
  a uniform border draws cleanly, and liquid-glass.css's own 1px rim inset
  (sized for a uniform border) landed inside that 3px stripe, producing a
  visible seam/step at the top-left and bottom-left corners (screenshotted by
  the owner at high zoom). Moved the stage-colour accent (`--c`, set inline
  per card) from `border-left` to `box-shadow: inset 3px 0 0 var(--c)` — insets
  clip to `border-radius` correctly at any width. `.is-on` now reassigns `--c`
  itself rather than `border-color`, so both the ungated base rule (liquid
  glass off) and liquid-glass.css's composed rule pick up the primary colour
  · `vikray.css`, `liquid-glass.css` (`.vk-pl__st` pulled out of the shared
  `:is()` lists into its own dedicated, composed rule — same reason as the
  confirm-modal shadow fix earlier this session: two rules fighting over one
  `box-shadow` property always loses to source order, so it's one rule now).
  Build clean; verified live post-deploy via the same Playwright+godmode-token
  approach — a non-selected stage card's `border-left` measured `1px` (was
  `3px`) and a 3x-DPI zoom of its corner showed a clean curve, no step.

- `design/glass` fix 3 · Same anti-pattern swept across the whole frontend
  (owner flagged it recurring — "so many places, not one" — after fix 2 above,
  plus a third, larger-scale case: a full-height panel getting an unbounded
  OUTER shadow with nowhere to land). Two shapes of the same bug:
  (a) `border-left: 2–3px` beside a thinner/absent border on the other three
  sides, inside a rounded `border-radius` — the asymmetric width breaks the
  arc a uniform border draws, worse wherever `liquid-glass.css`'s own rim
  inset (sized for a uniform border) layered on top. Fixed on `.tst` (toast),
  `.sa__card` (connectors), `.cn__card`, `.mkq__row`, `.k-notifbanner`,
  `.niyam-steps > li`, `.m2link`, `.vk-tg__unclaimed`, `.vk-mix__b`,
  `.pr__wcard`, `.hb-cal__e`, `.k-cust__hint`, `.ap__note` — all moved from
  `border-left` to `box-shadow: inset Npx 0 0 var(--accent)`, which clips to
  `border-radius` correctly at any width; `.tst` and `.sa__card` (both wired
  into liquid-glass.css) pulled out of the shared `:is()` lists into their own
  rules that compose the accent and the rim in one declaration instead of two
  rules fighting over `box-shadow`. (b) `.side` (the sidebar) — its own
  `--lg-shadow` in `liquid-glass.css` was completely overriding editorial.css's
  already-correct, contained inset-only shadow + `border-right: 1px`; the
  outer 20px-blur shadow that replaced it had nowhere to fall but onto the
  content pane, a soft vertical band running the sidebar's full height
  (screenshotted by the owner). Removed `.side` from that rule entirely —
  editorial.css's own treatment already covers it, on every preset.
  Deliberately NOT touched: `.lgl__note`, `.cl-appr__ask`, `.cn__setup`,
  `.sa__setup`, `.k-citation`, `.msg__sysb` all zero the border-radius on the
  accented side (`border-radius: 0 Xpx Xpx 0`), so there's no arc for the
  border to fight — not the same bug. `.mn-quote`, `.k-total`, `.sr-rt__q`,
  `.msg__b blockquote`, `.m2th`, `.sk-sched__next` have no border-radius at
  all (square corners) — also not the bug. · `components.css`, `connectors.css`,
  `editorial.css`, `hub.css`, `inbox.css`, `liquid-glass.css`, `marketplace.css`,
  `module.css`, `niyam.css`, `prachar.css`, `public.css`, `sanvaad.css`. Build
  clean, `npm run check` clean (no new contrast/write-gate/rendered-id
  failures). Verified live post-deploy: `.side`'s computed box-shadow dropped
  to editorial.css's bare `inset -1px 0 0, inset 0 1px 0` (the outer bleed is
  gone), screenshotted at 2x DPI — clean edge, no band; `.sr` still `none`.

- `design/glass` fix 4 · `Section` (`components/editorial/ModuleUI.jsx`, 35
  call sites across 16 files — Vetana, Pahchan, Dristi) rendered as a bare
  heading with no border, background, or padding of its own. On pages whose
  siblings are actual cards (Ganit's `.mk__c` KPI tiles) it sat at the same
  page inset as everything else — numerically identical, verified live — but
  read as unbounded next to surfaces that clearly have a boundary (owner
  screenshotted Payroll → Dashboard: "Year to date"/"Payroll coverage"/
  "Department split" all flush against the page edge with nothing framing
  them). Not a CSS bug (the padding numbers checked out equally on the
  "good" and "bad" pages) — a missing design treatment, confirmed with the
  owner before touching a 35-site shared component: **wrap in a card**.
  `.k-section` now carries the same border/background/radius/padding every
  other card in the system uses, `.k-section__head` gets a bottom rule
  separating it from the body, and `.k-section` joins `liquid-glass.css`'s
  static depth+rim list (no hover-lift — same as `.gn-panel`/`.tv-card`,
  since a `Section` can wrap a full-width table) · `editorial.css`,
  `liquid-glass.css`. Build clean, `npm run check` clean. Not yet verified
  live — need to check Vetana (the reported page) AND at least one Pahchan/
  Dristi call site for double-carding (a `Section` already sitting inside
  another bordered container would now show a card-in-a-card).

  Verified live post-deploy: Vetana → Payroll → Dashboard screenshotted —
  "Year to date"/"Payroll coverage"/"Department split" now read as proper
  bordered cards, matching the KPI tiles above them. Pahchan → Attendance →
  Corrections (a confirmed `Section` call site) screenshotted too — single
  clean card boundary, no double-carding. **STATUS: ✅ shipped.**

- `design/glass` fix 5 · Same bare-bar anti-pattern as `Section`, found on the
  original page the owner first flagged (Ganit → Invoices' TYPE/STATUS filter
  row) and swept across every module: `.gn-bar` (Ganit), `.mn-bar` (Manav),
  `.vk-bar` (Vikray), `.rep-bar` (Reports), `.hb-filters` (Hub), `.niyam-filters`
  (Niyam), `.bl__filter` (Billing) — all had no border/background/padding of
  their own, sitting flush between bordered surfaces above and below. All 7
  given the same card chrome as `Section` and added to `liquid-glass.css`'s
  static depth+rim list · `ganit.css`, `manav.css`, `module.css` (`.vk-bar`),
  `reports.css`, `hub.css`, `niyam.css`, `billing.css`, `liquid-glass.css`.

  Separately: 3 Vetana tabs (`PayrollTab`, `LoansTab`, `PayslipsTab`) hand-roll
  `.k-section__head`/`.k-section__title` directly instead of using the
  `Section` component, and all 3 were missing the outer `.k-section` wrapper
  entirely — so fix 4 above never reached them even though they use the exact
  same class names. `StructuresTab` had the identical gap (caught from an
  owner screenshot after I'd already "finished" checking this page — the
  earlier double-carding sweep only walks `.k-section` elements that exist;
  it can't catch a `.k-section__head` with no `.k-section` ancestor at all,
  which is a different failure mode). Added `className="k-section"` to the
  outer wrapper in all 4 files. `EmployeesTab`/`AttendanceTab` (Manav) already
  wrap correctly — checked, no fix needed · `StructuresTab.jsx`,
  `PayrollTab.jsx`, `LoansTab.jsx`, `PayslipsTab.jsx`. Build clean.

  Verified live post-deploy: Ganit invoices' TYPE/STATUS row (the page that
  started this whole thread), Vetana → Structures ("Salary structures"), and
  Manav → Employees ("Department/All logins/Filter" — the very first
  screenshot in this thread) all screenshotted — proper bordered cards now,
  matching every other surface on the page. **STATUS: ✅ shipped.**

- `design/glass` fix 6 · Owner asked for all 13 modules + non-module pages
  checked, not just the ones screenshotted. Audited every module by grepping
  its JSX for toolbar/filter classNames (not guessing from CSS alone) and
  checking each hit's CSS for the same bare-row shape: `.k-filterbar` (Tasks,
  Activity), `.k-tfilters` (Time Report — had padding but no border/bg,
  never actually read as the "filter card" its own comment called it),
  `.bl__bar` (Billing period selector), `.docfilt` (E-Sign documents),
  `.vtb__bar` (`ViewToolbar` — shared by Boards/Table/Kanban, reaches all
  three at once), `.gr__bar` (Graha), `.pr__bar` (Prachar's own
  `.k-section__head` equivalent, per its own code comment). All 7 given the
  same card chrome and added to `liquid-glass.css`'s depth+rim list ·
  `editorial.css`, `billing.css`, `documents.css`, `boards.css`, `graha.css`,
  `prachar.css`, `liquid-glass.css`.

  Coverage confirmed per module: Ganit/Vikray/Manav/Reports/Hub/Niyam (fix 5)
  · Vetana/Pahchan/Dristi (fix 4, `Section`) · Kray (reuses `.gn-bar`) ·
  Graha/Prachar/Billing/E-Sign/Boards (this fix). Sanvaad checked and
  confirmed NOT affected — it's a chat interface (channels/messages/threads),
  structurally not a tabular list view, so this pattern doesn't apply there.
  Admin/Org/Templates/Marketplace/Connectors/Customize checked — no bar/filter
  classNames found; they use the already-safe `TableToolbar`/`.tv` (paired
  with `.tv-card`) or have no such row.

  Verified live post-deploy: `.k-filterbar`, `.k-tfilters`, `.pr__bar`,
  `.vtb__bar` all confirmed (padding/border/background/radius present).
  While verifying Graha's Pipeline tab, found ONE more instance of the
  corner-seam shape (fix 3's `.vk-pl__st` pattern, not the bare-row shape):
  `.gpipe__head` (the coloured stage-header strip on each Kanban column) had
  `border-top: 3px solid var(--c)` alone against `border-radius: var(--r-md)`
  on all four corners — same seam, screenshotted at 3x DPI to confirm.
  Fixed the same way: `box-shadow: inset 0 3px 0 0 var(--c)` instead of the
  border. Re-swept the whole codebase for `border-top`/`border-bottom`/
  `border-right` used as a lone accent (this pattern isn't limited to
  `border-left`) — nothing else matched; the rest are legitimate hairline
  dividers on square-cornered elements or already-clipped by a parent's
  `overflow: hidden` (`.m2rec__top` in Sanvaad, checked specifically) ·
  `module.css`. Build clean.

  Sanvaad re-examined at the owner's request ("doesn't matter if it's
  tabular, all pages have the issue") — checked the main channel list AND an
  open channel (header, pinned-message strip, composer) via computed styles,
  not just a screenshot glance. The pinned strip already has its own padding
  and background; the chat pane itself has no card border, but it's a
  full-height full-bleed panel (Slack/Discord shape), not built as a card the
  way table pages are — a different, apparently deliberate layout, not the
  same bug. No fix applied there; told the owner to point at a specific spot
  if one still looks wrong rather than guessing further.

  `.gpipe__head` verified live post-deploy: `border-top-width` measured `0px`
  (was `3px`), and a 3x-DPI zoom of the corner shows a clean curve, no step.
  **STATUS: ✅ shipped.**

- `design/glass` fix 7 · Owner pointed at `.ix-panel` directly from devtools
  and asked to remove ITS depth, not the child cards'. `.ix-panel` is the
  `role="tabpanel"` wrapper for every module's tab content (Ganit, Vikray,
  Graha, Prachar, Manav, Dristi, Vetana, Hub, Kray, Sahayak) — a layout
  container, not a card — and it was in `liquid-glass.css`'s depth-shadow
  list, putting a floating-card shadow around the ENTIRE content area on
  every module page, in addition to (and separate from) the correct shadows
  its children already carry individually. Removed `.ix-panel` from the list
  · `liquid-glass.css`. Verified live post-deploy: computed `box-shadow` on
  `.ix-panel` is now `none`. **STATUS: ✅ shipped.**

- `design/glass` fix 8 · Owner asked for Organisation settings' Senders and UPI
  IDs tabs redesigned so each repeating item (one sender purpose, one UPI
  platform) reads as its own card — currently a bare heading + two fields per
  item, no boundary, six-plus stacked with nothing separating them. New
  `.oc-card` class (combined with the existing `.st__group` spacing, never
  alone — the intro banners and the trailing Save button stay unstyled,
  they're not repeating items) gives each one border/background/radius/
  padding · `settings.css`, `TabSenders.jsx`, `TabUpi.jsx`. Build clean. Not
  yet verified live.

- `design/glass` fix 9 · Font-picker investigated — not a bug. `--font-display`
  (what the Headings picker writes) is correctly read by 27 files including
  `.k-pageh__h1`, `.k-stat__val`, and the sidebar wordmark; verified live by
  overriding the token and reading computed `font-family` on each. What
  doesn't change is `.mh__en` (the small English module label, e.g. "TASKS")
  — deliberately `--font-ui`, per ModuleHeader.jsx's own comments: the
  Devanagari term is the actual heading and lives on `--font-indic`, a
  separate font axis the picker was never wired to (different script, needs
  different font files). No code change; the picker's scope is narrower than
  "headings everywhere" implies, not broken.

- `design/glass` fix 10 · Niyam promoted to a full module, as agreed. Kept its
  existing sidebar entry (`settings/automations`, `orgAdminOnly`) rather than
  moving it — that gate is a deliberate access decision documented in
  navConfig.js, not something this touches. Added: `niyam` to `MODULES`
  (`moduleColors.js`) with a new `--m-niyam` token (light `#96354A` / dark
  `#E8A4B4`, distinct from all 16 existing module hues); wired the nav entry
  to the `automations` icon (a lightning-bolt SVG that already existed in
  `navIcons.jsx` unused — the row was drawing the generic `customize` gear
  instead) and added `module: 'niyam'` for grant-gating consistency (verified
  safe: `orgAdminOnly` already restricts visibility to org admins, who get
  `moduleGrants: null` — "no opinion" — so the new `module` check never hides
  the row for anyone who could already see it); switched `NiyamPage.jsx` from
  the generic `PageHeader` to `ModuleHeader`, matching all 12 other modules
  (icon tile, "SETTINGS · व्यवस्था" kicker via the auto-seeded
  `section.settings` label, module-colour accent) · `moduleColors.js`,
  `module.css`, `navConfig.js`, `NiyamPage.jsx`. Build clean, `npm run check`
  clean. Verified live post-deploy: screenshotted `/settings/automations` —
  icon tile in the new rose accent, "SETTINGS · व्यवस्था" kicker, "नियम
  AUTOMATIONS" title, matching Ganit/Vetana/etc. exactly.

  **Regression, caught by the owner within the hour:** `module: 'niyam'` on
  the nav entry (added "for grant-gating consistency") made the row vanish
  entirely from Settings on the owner's own real Aekam Inc account (confirmed
  org_admin — `Roles & access`/`Organisation`, both `orgAdminOnly`, were both
  visible to them). There is no backend grant system for a `niyam` code, so
  for any admin whose `moduleGrants` happens to be a real array rather than
  the documented "absent = no opinion" state, the module check silently hid
  a row `orgAdminOnly` alone already gated correctly. My test session (a
  different account) didn't reproduce it, which is why "verified live"
  missed this — one account confirming a nav change is not enough when
  visibility depends on account-specific grant state. Reverted `module` from
  the nav entry; `ModuleHeader`'s own `module="niyam"` (drives the icon
  colour and the write-gate) is left as-is since `canWriteModule` takes the
  same "absent levels = true" path for a genuine org_admin/owner, a
  different code path than the one that broke · `navConfig.js`.
  **STATUS: ✅ shipped, fix included.**

- `product` fix · Owner's call: plan pricing is entirely per-org negotiated,
  so no rupee figure should ever render on the org-facing plan comparison
  card, regardless of who's viewing it. Previously `p.price_monthly != null
  ? inr(...) : 'On quote'` — `list_plans` sends `price_monthly` only to
  accounts the backend treats as platform staff, so a real number was
  showing for those sessions. `price_monthly` is now never read here at all;
  every card unconditionally shows "On quote". Build
  clean. Verified live post-deploy: `price_monthly` no longer appears
  anywhere in the deployed JS bundle at all. **STATUS: ✅ shipped, superseded
  below.**

- `product` fix 2 · Owner's follow-up: with pricing hidden and the current
  plan already stated in the stat cards above it ("PLAN · Growth"), the
  4-card "Plans" comparison grid on Billing added nothing — no price to
  differentiate the tiers, no self-serve upgrade to act on ("handled by your
  account manager"). Removed the section entirely rather than keep four
  identical-looking "On quote" cards. `PlanComparison.jsx` had no other
  importer — deleted, along with the now-dead `/v1/subscription/plans` fetch
  and `plans` state in `TabBilling.jsx` (nothing read it once the section
  was gone — the exact "fetched but never rendered" bug `PlanComparison.jsx`
  was originally written to fix) and its CSS (`.opl*`, `org.css`), removed by
  hand since I know exactly which classes were only ever used there ·
  `TabBilling.jsx`, `org.css`, `PlanComparison.jsx` (deleted). Build clean,
  `npm run check` clean, no new unused-class or contrast regressions.

- `design/glass` investigation · Chased a false "Usage & Spend section is
  missing from Billing" lead after two automated
  `innerText.includes('Usage & spend')` checks both came back `false` post
  deploy of the fix above. It was never missing — `page.innerText` reflects
  rendered (CSS-transformed) text, and `.st__gt` applies
  `text-transform: uppercase`, so the actual DOM text is "USAGE & SPEND", not
  "Usage & spend" as written in the JSX; the check was case-sensitive and
  could never match. A full-page screenshot at the same URL showed the
  section fully rendered and populated (Balance: allowance/purchased/total
  held/spent-this-period, "Where the credits went" beneath it). No code
  change — the lesson is to grep rendered text case-insensitively (or match
  a stable data attribute) when a CSS transform is in play, not to trust one
  case-sensitive `includes()` as proof of absence. Section content/layout
  density (several stacked stat-tile cards) is still unassessed against the
  owner's original "billing/analytics pages feel disorganized" complaint —
  not yet actioned, owner has not chosen a direction (leave as-is / simplify
  / defer) at time of writing.

- `design/glass` fix 11 · Owner: "all this buttons are way shiny this is not
  how apple ui works." `.btn--fill` carried a static `::before` overlay — a
  fixed `linear-gradient(180deg, rgba(255,255,255,.28), transparent 58%)`
  glass highlight always present on every filled button, independent of the
  existing `::after` hover sweep ("THE SHEEN," a travelling light band that
  only appears on hover — transient, not what a static screenshot would
  show, so not the thing being flagged). The permanent top-highlight is the
  skeuomorphic "glossy button" look Apple's actual UI doesn't use; removed
  the `::before` rule and its block comment entirely, leaving `.btn--fill`
  with only its box-shadow depth · `components.css`. Build clean. Verified
  live post-deploy: computed `::before` on `.btn--fill` (e.g. Vikray's
  "+ New order") is `content: none; background-image: none` — flat fill,
  no highlight band. **STATUS: ✅ shipped.**

- `design/glass` fix 12 · Owner: "redesign the security and members tabs too
  and everywhere else this glossy type ui." Security and Members were bare
  — same pattern as Senders/UPI before fix 8, just never touched — because
  `.st__group` (the ONLY section wrapper the entire settings surface uses:
  org Profile/Members/Billing/Modules/Security/Danger zone AND all six
  personal Customization tabs, 14 files) was `margin-bottom: 26px` alone,
  nothing else. Fix 8's `.oc-card` modifier only ever reached the two files
  it was added to by hand. Rather than repeat that per-file, gave
  `.st__group` itself the card chrome (border/background/padding/radius),
  which fixes all 14 files from one rule, and dropped `.oc-card` — folded
  into `.st__group`, so keeping it as a separate modifier would just be two
  names for the same thing now — from `TabSenders.jsx`/`TabUpi.jsx`
  · `settings.css`, `TabSenders.jsx`, `TabUpi.jsx`. Build clean, `npm run
  check` clean (no new contrast/write-gate/row-height regressions). Verified
  live post-deploy: screenshotted Security, Members, Senders and a
  Customization tab (Notifications) — every section is now a bounded card;
  Senders' per-item cards (fix 8) read correctly with no double border, the
  intro info-banner cards nest cleanly since `.opend` is a filled tint, not
  a bordered card. **STATUS: ✅ shipped.**

- `design/glass` fix 13 · Owner: "check the modules tabs too." Fix 12's
  blanket `.st__group` card chrome double-carded the Modules tab
  specifically — its middle section wraps `.omod` (`ModuleCard`s, each
  already `border + background` on `.omod__c`), so the grid ended up in a
  card whose children are cards. Added a `.st__group--flush` exemption
  (`padding: 0; border: 0; background: none`) and applied it to only that
  one section in `TabModules.jsx`; the intro banner and the "Sensitive
  modules" footer note above/below it keep the normal card chrome ·
  `settings.css`, `TabModules.jsx`. Checked every other `.st__group` call
  site (`TabProfile.jsx` — plain form fields, no self-carded children;
  `TabDanger.jsx` — `.odz` is typography only, no border; the six
  Customization tabs — `TabAppearance.jsx`'s colour/pattern swatches are
  small picker chips nested one level inside a single section card, the
  normal picker pattern, not a repeated-full-identity-card grid) for the
  same shape of bug — none found. Build clean, `npm run check` clean.
  Verified live post-deploy: computed `border` on the module-grid section is
  `0px none`, its siblings stay `1px solid`; screenshot confirms the grid
  reads as one flush row of independently-carded tiles rather than a card
  full of cards. **STATUS: ✅ shipped.**

- `design/glass` fix 14 · Owner: "checkbilling tabs too." Fix 12 double-carded
  three of `TabBilling.jsx`'s five `.st__group` sections, worse than
  Modules: `CreditUsage` and the "Usage & spend" section (`BillingUsageSection`)
  each render one or more `<Card>`s directly, and "Invoices" renders `<Table>`
  directly — `.tbl__wrap` is already bordered whenever an ancestor
  `.card__body`/`.dcard__b` hasn't reset it, and `.st__group` wasn't on that
  reset list. Extended the existing reset (`components.css`) to include
  `.st__group .tbl__wrap` — the same convention the file already documents
  for exactly this shape of bug — and marked the two `<Card>`-wrapping
  sections `st__group--flush` · `components.css`, `TabBilling.jsx`.

  Verifying the fix surfaced a second, unrelated bug: the "Usage & spend"
  card stack (Balance, Where the credits went, Who spent what, What was
  sent) was rendering squeezed into a narrow centred column instead of
  full width. Root cause: `.bl` was defined TWICE at equal specificity —
  `components.css`'s BrandLoader spinner root (`align-items: center;
  justify-content: center`, unrelated: the mark shown at boot and after
  sign-in) and `billing.css`'s card-stack wrapper (`flex-direction:
  column`) for this exact section, imported directly by
  `BillingUsageSection.jsx` rather than through the barrel. Which one won
  depended on final bundle order, not anything either file declared, and on
  `org/TabBilling` it was BrandLoader's. Renamed the billing one to `.blx`
  (only one JSX call site) rather than touch the shared spinner class ·
  `billing.css`, `BillingUsageSection.jsx`. This also fixes `/admin/usage`,
  the component's other mount, per its own file header.

  Build clean, `npm run check` clean. Verified live post-deploy: computed
  `border` on the Credits/Usage-&-spend sections is `0px none`; the
  Invoices section's `.tbl__wrap` has no border of its own; `.blx` computes
  `flex-direction: column`; full-page screenshot shows every stat/card grid
  at full width, no narrow-centred column, no box-in-a-box anywhere on the
  tab. **STATUS: ✅ shipped.**

- `design/glass` check · Owner: "check profile tabs too." No separate
  personal-profile page exists — `org/TabProfile.jsx` (Logo, Company, Tax,
  Registered address, Bank details, Invoice footer) is the only Profile tab;
  Customization's six tabs (Appearance/Typography/Layout/Language/
  Notifications/Security/Data & privacy) were already covered by fix 13's
  audit. Screenshotted live: every section reads as its own card, no bare
  rows, no double-carding (the logo dropzone's own border is a normal
  nested-control boundary, not a duplicate card edge). No defect found, no
  code change.

- Pahchan **web clock-in** · Owner: "How can an iOS user clock in and out
  without the app?" They cannot, and it was not an iOS gap — it was a missing
  caller. `POST /v1/pahchan/punch` (geofence, altitude, accuracy flags,
  idempotency, photo) had one caller in the repo: `ClockScreen.tsx`, in an app
  with no iOS build. `frontend/src/pages/pahchan/` held seven reviewer and
  employee screens and no way to punch.

  Added `pages/pahchan/Clock.jsx` + `lib/pahchanClock.js`, first tab in
  `PahchanPage`. **No backend change and no migration** — the three things
  asked for were already in the schema or already true: device time is
  `captured_at` alongside the server's `received_at` (07 §4 keeps them
  un-derived from each other precisely so a moved device clock shows up); an
  unclosed shift cannot block the next morning because `nextDirection` scopes
  to today and §2 refuses nothing anyway; a new flag is `flags TEXT[]`, which
  064 says "should not be a migration".

  Selfie **mandatory** per the owner, enforced in front of the person — no skip
  control, no send button until a frame exists — but NOT as a server refusal.
  §2 is that nothing blocks a punch, and `ClockScreen.tsx` records what happened
  the one time a client tried: it hid the shutter after three camera errors and
  "three camera errors in a dark doorway locked someone out of clocking in
  entirely". After three failures this screen offers a flagged photo-less punch
  instead. Both halves are asserted in `pahchanClockScreen.test.jsx`; a change
  that keeps one and drops the other turns it red.

  Photo compressed before it leaves — `MAX_PHOTO_BYTES` is 768 KB and a front
  camera gives 2–4 MB, so without the quality ladder the mandatory selfie is
  the thing that loses the punch. Photo uploaded BEFORE the punch, the opposite
  of mobile, because mobile has an offline queue to attach a key later and this
  screen does not.

  28 tests added, all green; `npm run check` clean (no new contrast failures);
  full suite 2,808 pass with 6 pre-existing failures unchanged. `vite build`
  could not be run here — `@samasante/liquid-glass` is in `package.json` and
  will not install in this sandbox, and it fails identically on an untouched
  tree, so CI is the first real build. **STATUS: 🟡 shipped, unusable.**
  `manav_employees.user_id` is null for every row, so `create_punch` 409s for
  everybody and the screen says so instead of offering a dead button. One
  employee↔login link turns this ✅; the same gap blocks the mobile app.

## 2026-08-27 · Phase 6.1 answered by seeding, plus the three housekeeping items

**6.1 — the owner chose seeding over dropping.** The audit framed commission as
a model built twice and proposed retiring the dead half. Confirming that is what
surfaced the more useful fact: the LIVE half held 2 schemes and 4 bands and
**every one of them was Unicode Group's**. E2E Test & Associates had 83 people
on the register and **zero arrangements between them** — a model no spec could
drive end to end in the org every spec runs against.

`frontend/e2e-real/commission-seed.spec.ts` (2 tests, green) drives the real
screen: register → person → form → ladder editor → button. Nothing is INSERTed.

  manav_commission_schemes   E2E  0 → 1
  manav_commission_bands     E2E  0 → 3
  (Unicode unchanged at 2 / 4 — `useOrg` proves the session's org from the
   server before a single field is filled, which is the check that failed on
   26 Aug and put a Phase-1 vendor in the wrong organisation.)

The ladder is the owner's own, from 2026-08-21: **3% from ₹1L, 4% from ₹5L,
7.5% from ₹10L**, marginal — ₹12,00,000 of turnover pays ₹47,000, not ₹90,000.
The rungs are typed into the editor **7.5 / 3 / 4** and come back **3 / 4 /
7.5**: `Scheme.__post_init__` sorts and de-duplicates once, so a payout cannot
depend on which row was read first. The spec recognises its own ladder on a
re-run and verifies instead of writing again — proven by the passing run, which
took the no-write branch and left the counts at 1 / 3.

The dead `sales_commission*` three are still 0/0/0 and still **not dropped** —
a DROP is named and confirmed regardless of the standing migration approval, and
that OK is 0.30. They were never the half worth keeping: their `user_id` is
`uuid` where `public.users.user_id` is `text`, so there is no join to make.

**Housekeeping — all three, each behind a live check.**

*The `PROPOSED_080` collision.* Two unrelated proposals shared one number in a
directory whose only job is ordering. Proposal 82 reported it; Phase 6 reported
it again; neither moved a file. `PROPOSED_080_statutory_document_identifiers.sql`
→ `PROPOSED_090_…` (four references against the other's nine), all four updated
in this commit, the move recorded in the file's header. Neither file is applied,
so no database changed. `tests/test_migration_numbers_are_unique.py` (4) fails on
any duplicate in either series — applied and PROPOSED checked apart, because
they have always numbered independently.

*Migration 183.* Claimed "IS NOT APPLIED" in `routers/prachar.py:81` and at four
write sites. Live 2026-08-27: `compliance_class` on both tables, both CHECK
constraints, all three tables created, `prachar_compliance_rules` seeded with 6
rows, **57 of 60 templates and 11 of 104 campaigns classed**. So
`prachar_compliance.column_exists` and its four guards were a per-process query
defending an impossible state, under comments telling every later reader the
column was missing. Removed. `table_exists` stays — it degrades two audit writes
rather than guarding a column — but its log lines no longer blame 183; a log
naming the wrong cause sends the next reader to the wrong place. 261 prachar
tests green after.

*`ai_router.py`.* The plan said it "passes `user_id=user_id` into a function
with no such param". `upload_file` takes `user_id` fine — the fault is that
**`generate_rich_content` does not**, and its body read the name anyway.
`NameError` on the first inline image the rich model ever returned, before the
picture was touched. Latent only because `routers/hub.py` imports the function
and no route calls it — the same shape as everything else Phase 6 exists to
catch: code that reads correctly and has never run. Now a parameter defaulting
to `""`, with two tests in `test_image_brief.py` (one executing the whole branch
against a real one-pixel PNG, one on the signature), **both verified failing
against the old code before the fix went in**.

## 2026-08-27 · what 0.30 actually approved, and the second live `pay_*` table

Two corrections found while closing 6.1, both from live reads rather than from
the plan.

**0.30's three restore schemas are already gone.** `qa_cleanup_20260822`,
`punch_cleanup_20260823` and `owner_actions_20260823` do not exist — checked
`information_schema.schemata` 2026-08-27, along with `pg_depend` and every view
definition, all clean. Nothing to drop and nothing to go hunting for. That item
is done.

**But 0.30 does not approve the drop Phase 6 is waiting on.** Its answer reads
"DROP the three restore schemas" and names those three. It names none of the
twenty product tables in 6.1 and 6.2 (~~twenty~~ **22**, corrected 27 Aug —
see below; **23** once 6.4's `public.report_schedules` joins them). Phase 6's
header says it blocks on 0.30
and 0.30's answer says "Unblocks Phase 6" — and an OK for three backup schemas
is not an OK for 23 product tables. Written down rather than assumed,
because the assumption is how a `pay_*` drop takes payroll with it.

**`pay_income_tax_slabs` is the second live `pay_*` table.** The plan excludes
`pay_professional_tax` by name from any `pay_*` drop and warns that including it
would take PT to ₹0 for every employee. That warning is now half the story:
`pay_income_tax_slabs` holds **23 rows**, did not exist when the warning was
written — migration 230 created it during Phase 5.2b, last week — and is read by
`services/income_tax.py::ladder_for` for every TDS figure on every payslip, with
`routers/income_tax_slabs.py` and a screen behind it. `pay_professional_tax` has
meanwhile grown 9 → 23 as 0.24's states were entered.

A prefix is not a stack, and a `count(*)` older than the last deploy is a count
of a different database. Exact, live, 2026-08-27:

    hr_* (all ten)                    0
    pay_esi_records     0   pay_it_declarations   0   pay_loans      0
    pay_pf_records      0   pay_runs              0   pay_slips      0
    pay_tds_records     0
    pay_professional_tax             23   <-- LIVE, EXCLUDE
    pay_income_tax_slabs             23   <-- LIVE, EXCLUDE
    sales_commissions   0   sales_commission_slabs  0
    sales_commission_assignments      0

## 2026-08-27 · the online repo, checked — and the one thing the cloud branch was right about

`git fetch --all` against `origin`. Local `staging` and `origin/staging` are the
same commit, so nothing of mine is unpushed and nothing of anyone's is unpulled.
Four `claude/*` branches exist; three carry **nothing** staging does not already
have (`kartavaya-folio-2-wire`, `pahchan-web-clock`, `staging-last-update` — all
0 ahead). One does:

    origin/claude/ios-clockin-out-no-app-dnu7o8
      4df1bbc9  Add self-service clock in/out with geolocation capture
      0 commits of staging in it — it is 1,747 BEHIND

**Do not merge it.** It is a second, independent implementation of a feature
staging already has: `e9ffd373 Pahchan: clock in and out from a browser` is in
this branch, and `ClockScreen.jsx` with its 28 tests is the version that was
reviewed. Merging a 1,747-commit-behind branch to gain a duplicate would cost
more than it could possibly return.

Its three *independent* findings were worth reading, and two are already closed
on staging: `index.html` does link `manifest.json`, and the
`apple-mobile-web-app-*` tags are present, so Add to Home Screen opens
standalone. Checked, not assumed.

**The third was live, and is now fixed.** `frontend/public/index.html` was a
Create-React-App leftover — a whole HTML document with `<div id="root">`, **no
script tag**, the old brand colour `#0082c6`, no `viewport-fit=cover`, no
manifest link and none of the pre-paint theme bootstrap. Everything in
`publicDir` is copied to the output root, so this file lands beside the built
entry and survives only because Vite writes the real one afterwards. Built and
read `dist/index.html` to confirm the root file wins today: module script
present, bootstrap present, `#04837A`. It does.

That is the whole protection, and it is build-step ordering. This project has
twice shipped a deploy that failed with a green build and no logs — the
`vercel.json` `"//"` key, and the CSP hash drift that left the bootstrap dead on
staging for days. A blank page one Vite upgrade away belongs in the same family,
so the file is deleted and `scripts/check-one-index-html.mjs` is wired into
`npm run check`, **verified failing** by restoring the file and passing again
once removed. Capacitor is unaffected: `android/app/src/main/assets/public/
index.html` is a copy of the BUILT entry (`#04837A`, bundle present), not of the
leftover.

The check is deliberately narrow. Its first draft walked the tree and reported
five files, none of which was the bug — two Capacitor entries, a Gradle
intermediate and two scratch directories. A check needing five exemptions to say
one true thing is a check that gets silenced.

Also tidied while here: `scripts/orphan-selectors-baseline.json` claimed
`.k-cust__hint` was orphaned and it is not. 546 → 545. A baseline that only
shrinks is the same discipline as `test_every_writer_has_a_live_sql_test.py`.

**0.24 re-verified, and it is still ✅ — but three findings under it are open.**
Migration 224 already took the shared ladder 9 rows → 23 and 3 states → 7, and
STATUS.md records it. Re-read live 2026-08-27 to be sure the count had not moved
under Phase 6's `pay_*` work: still 23 rows across state codes 18, 19, 24, 27,
29, 36, 37, all `org_id IS NULL`. `manav_employees.state` across both in-scope
orgs is **27 (83 people) and 24 (26 people)** and nothing else, so every employee
this product pays sits in a covered state.

What has NOT moved is the three findings 0.24 raised for the owner, all still
open and all still zero live exposure: **Gujarat's shared ladder is four years
stale**, **Karnataka's is stale**, and **Maharashtra has a gender dimension the
table cannot express** (women exempt to ₹25,000 since 2023). The first two are
live-row edits and the third needs a column — none of them is a migration, which
is why the standing migration approval does not reach them. They are the only
part of 0.24 still owed, and they are owed to a decision rather than to work.

## 2026-08-27 · an adversarial audit of my own claims, and the one that was FALSE

I asked a subagent to try to break every numeric and state claim I had published
for phases 3, 4, 5, 6 and 0.24, read-only, against the live database. Everything
material reproduced — every count, sign, total and invoice number. The failures
were of SCOPE and CURRENCY, and one of them closed a phase item on nothing.

**6.4 — `report_schedules` "does not exist" is FALSE, and it is the worst place
this project could have made that mistake.**

    public.report_schedules            EXISTS · 15 columns · 0 rows
    staging.dristi_scheduled_reports   EXISTS ·             · 7 rows
    staging.report_schedules           42P01  — and only this was checked

I ran a live query, got `42P01`, and read "not in that schema" as "nowhere".
`public.report_schedules` carries an `org_id` from migration 212, three indexes,
RLS policies from migration 008, a complete CRUD in `routers/reports.py`
(`:454`/`:480`/`:506`/`:619`/`:684`), writes from `invite_router.py:519-520`,
and `POST /api/reports/dispatch` on an **armed hourly Railway cron**
(`cron-report-dispatch`, `7 * * * *`). An empty table is not an idle one: that
endpoint runs 24 times a day and finds nothing to do, which is why nobody
noticed. There are two schedulers. 6.4 is OPEN and Phase 6's own "one report
scheduler" is not met.

Phase 6 exists to install: *no proposal may assert a table, route or column is
missing without a live query in the document.* **There was a live query in the
document.** The rule does not say which schema, so it was followed and the wrong
answer was published into three files. Its missing half, now written down:

> A negative result from a schema-qualified query is a fact about THAT SCHEMA.
> Reading it as a fact about the database is how a phase item gets closed on
> nothing.

`backend/tests/test_two_report_schedulers.py` (4) pins the second scheduler and
fails if any ledger republishes the claim — verified by appending the sentence
to STATUS.md and watching it go red. `~~struck~~` lines are exempt on purpose:
PROGRESS is append-only, and a log that edits out what it got wrong is worth
less than one that shows it.

**The same blindness was inside the ratchet Phase 6 shipped.**
`test_every_writer_has_a_live_sql_test.py`'s `_WRITES` matched `staging.` only,
so `reports`, `org_invites` and `templates` — all writing to `public.` — were
invisible to a rule whose entire job is finding untested writers. Widened to
both schemas. The published figures were wrong too: **40 writing routers, 8
covered, 32 baselined**, not 36/6/30. The baseline grew by exactly those three,
once, because the LENS widened and not because a standard slipped — the
distinction is the file's whole value, so it is recorded beside them.

**Phase 5 was marked 🟢 COMPLETE with zero rows behind its money-moving half.**
The ladder was seeded 03:43:57 UTC; **0 of 1,160 payslips have been computed
since**. Every TDS figure in the database still comes from the year-stale
literal ladder 5.2b exists to replace — the latest E2E run, 26 Aug 08:46:53,
`total_tds ₹6,88,924.66`. `income_tax.ladder_for` has never priced a real
payslip. That is code-without-data, which this project's own rule calls 🟡, and
I published 🟢. Corrected. One action closes it — re-run payroll for E2E 2026-08
through the screen — and it is not taken unasked, because `process_payroll`
deletes and re-inserts a month's payslips and would overwrite the rows that ARE
Phase 2's acceptance evidence. That is a live-row change to name, not to take.

**Numbers and comments corrected, each verified rather than accepted:**

- "the twenty product tables" is **22** (10 `hr_*` + 7 empty `pay_*` + 2 live
  `pay_*` + 3 `sales_commission*`), and `public.report_schedules` now joins the
  list. A DROP list put to the owner that is short by two is a list with two
  tables nobody named.
- "`n_live_tup` reports 0 for both live tables" now reads 23 and **14** against
  two tables that both hold 23. The lesson survives; the figures rotted.
- `vetana.py:1262` said "0.75% and 3.25% stay literal because
  `statute_calendar` holds no key for them" **three lines above the code that
  reads them from the store**. Migration 232 seeded both the same week. A
  comment contradicting the code beneath it is worse than none — it sends the
  next reader to seed a key that exists.
- `services/income_tax.py` cited `migrations/228_income_tax_slabs.sql` in two
  places; 228 is `228_epf_rates_are_dated_law.sql` and the slabs are **230**.
  The migration's own first line said 228 too.
- The STATUS deploy header named `cc371297` — **33 commits behind** what Railway
  was running. A deploy line nobody re-reads is worse than none, because it
  reads as verification. Now `43961e25`, with the domain's asset hash checked
  from outside.
- STATUS still said `module_compliance_settings` and `pahchan_employee_consents`
  were "still 0" hours after both rows were written, and both the Phase 3 plan
  and PROGRESS still said 3.2's acceptance was "still owed" after it passed at
  00:24:12. The dashboard and the log disagreed in both directions.

**What I did NOT accept from the audit**: its Phase 5 framing said the store now
carries income-tax bands. It does not — the bands are in `pay_income_tax_slabs`
and `statute_calendar` carries only the advance-tax instalment percentages. The
STATUS row was already right about that.

## 2026-08-27 · the backend suite: 30 red → 1, and the one that is left is real

CI had been red on `staging` and I had been calling it "the known baseline". It
was not. Reading each failure rather than the count took it from **30 failed /
14,474 passed** to **1 failed / 14,520 passed**, and not one of the thirty was a
product defect in the code under test. Every one was a pinned set, a fixture or
a source-string test that a *correct* change had moved past.

**Nineteen were one bug: a fixture that stopped matching its query.**
`b8e1bfa1` (24 Aug) added three email-cap columns to `organisations`;
`update_org_settings` returns all three off its read-back row; three separate
fixtures modelled the row as it was before. Eleven tests in
`test_org_settings_amendable.py`, six in `test_billing_lines_wiring.py` and one
in `test_seat_limit_and_console_guards.py` died on `KeyError: 'email_cap_daily'`
while the production query was correct. Three more in
`test_billing_line_cost_basis.py` were MINE — Phase 3.3 added
`client_service_lines.invoice_from` to the sweep's SELECT and I did not carry it
into the fixture. A fixture that models a query it has stopped matching tests
nothing; `mock-pool-hides-bad-sql` in reverse.

**Seven were `kray`.** Procurement became its own module in `7770045b` on
23 Aug and five pinned sets did not follow. One of them was a **live defect**:
`MODULE_TABS` did not list `kray`, so `KrayPage.jsx` saved tab preferences the
router refused — a Kray user could rearrange their tabs, watch it work, and find
the arrangement gone on the next load, with nothing said.
`test_the_page_module_keys_are_exactly_module_tabs` had been naming it for four
days. The rest were the pins doing their job: `SENSITIVE_MODULES` gained `kray`
(procurement holds vendor bills, payments and supplier bank details — financial
records, the same category as Ganit's) and the reason is now written beside the
set, because `test_module_grant_enforcement` asks for exactly that. Two more
were fixtures overriding `_gate` and not `_payables_gate`
(`require_any_module("ganit", "kray")`), so a 403 from the wrong door was
standing in for the 404 the test meant to prove.

**One was a source test breaking on an improvement.**
`test_admin_console_add_member_refuses_a_system_target` split on the literal
`if target.get("is_system"):`, somebody made the condition null-safe, and it
died on `IndexError: list index out of range` — a message that says nothing
about system accounts. The guard was intact throughout
(`admin_orgs.py:1984`, refusing above every write). Both this test and its
sibling now anchor on the READ, not the whole `if` line. A source test that
breaks when the code it approves of is improved teaches people to delete source
tests.

**One was an endpoint count**: 18 cron handlers, pinned at 17 since
`run_analytics_sync` landed unarmed on 24 Aug.

── AND ONE IS A REAL FINDING, LEFT RED DELIBERATELY ─────────────────────────

`test_platform_privacy::test_every_aekam_side_leak_is_either_fixed_or_named`
reported three leaks. **Two were the scanner, not the code**: the `email-column`
pattern matched a route path (`"/{org_id}/email-usage"`), a docstring, and
`AND channel = 'email'` — a VALUE in a query that returns two `COUNT(*)`s and
names nobody. The pattern is quote-aware now and drops the function's own
docstring and bare single-word literals, keeping `u.email`. Two `ALLOWED`
exemptions had already been spent papering over that same false positive, one of
which said so in as many words — "the only `email` in it is the literal
`channel = 'email'`". That is not a reason Aekam may see something; it is a
scanner bug written down and lived with. Both retired.

What remains is true, and it is not mine to sign off:

> **`server.py::add_team_member` returns a customer's email address to Aekam.**
> `POST /api/teams/{team_id}/members` resolves `SELECT user_id, email FROM users`
> and answers with `TeamMemberOut`, whose `email: str` is required.
> `is_platform_staff` bypasses the project-membership check at `server.py:3865`,
> so platform staff can call it against any customer's project and read the
> address back.

The standing rule is that Aekam must not see client emails. The remedy the test
itself proposes is the one `routers/billing.py::_balance_body` and
`services/credits.py::usage_by_person` already use — split it behind an
`include_contact` argument defaulting to False — but that changes a response
shape the frontend consumes, and an `ALLOWED` entry would be a claim that Aekam
MAY see it. Neither is a call to take unasked, so the gate stays red on exactly
one true thing. **It was already red before this session**; it now names one
finding instead of three, two of which were noise.

## 2026-08-27 · CI reproduces what this machine cannot — a live 422, found by reading it

Arming the gates paid for itself the same afternoon. With CI finally running the
things it claimed to run, it failed on eleven tests that pass here, and the cause
was a shipped defect rather than an environment quirk.

**`POST /offboarding/{employee_id}/lines` has answered 422 to every caller for as
long as the router has existed.**

    {"type":"missing","loc":["query","body"],"msg":"Field required"}

`routers/custody.py` carried `from __future__ import annotations`, which makes
every parameter annotation a STRING that FastAPI resolves against the handler's
`__globals__` — and its three handlers are wrapped by `@limiter.limit`, whose
`functools.wraps` wrapper carries **slowapi's** globals, not this module's.
`CustodyLine` is unresolvable from there, so FastAPI gave up on the body
parameter and treated it as a **query** parameter. Nobody could record a custody
line. The register shipped in migrations 160–164 and its write path has never
worked.

**It does not reproduce here, and that is the durable part.** Python 3.14
resolves these through PEP 649's `__annotate__` closure and gets the right
answer; the container pins **3.13**, which goes through `__globals__` and does
not. The local suite was green at 14,521 passing while CI failed eleven tests on
`PydanticUserError: TypeAdapter[Annotated[ForwardRef('CustodyLine'), Query(...)]]
is not fully defined`. `memory/backend_suite_27_failures_at_head` already records
the general form — *a green suite hid a live 422* — and this is the same
sentence with a different 422 under it.

**The live counts settle it.** Read after the fix, before any new write:

    staging.manav_offboarding            10 rows   (all E2E)
    staging.manav_offboarding_custody     0 rows

Ten people offboarded, and not one custody line recorded against any of them —
no laptop, no DSC token, no keys. The register shipped in migrations 160–164 and
its only write path has never once succeeded. A 422, seen from the data side.

And the uncomfortable part: `tests/test_custody_router.py` EXISTS and was passing
the whole time. It is a live-SQL test of the kind Phase 6's rule demands, and it
runs on 3.14 where the bug does not exist. The rule is right and it was followed;
what it does not say is *on which interpreter*.

`custody.py` was the ONLY router combining postponed annotations with
`@limiter.limit` and Pydantic body models; the other five `__future__` routers
carry no limiter at all. The import is gone.
`tests/test_postponed_annotations_and_wrappers.py` (2) fails on the COMBINATION
rather than the runtime symptom, because the symptom appears only under 3.13 and
a runtime test would be useless on the machine where the code is written.
Verified by putting the import back and watching it name
`custody.py::record_custody_line`.

── THE E2E SMOKE JOB, WHICH HAS NEVER RUN A SPEC ────────────────────────────

Its own comment records one earlier version of this: *"`--project=chromium` NAMED
NOTHING … the job was green for years without running a single spec."* That was
fixed. Three more faults were standing behind it, each hiding the next:

1. `mint-state.mjs` exited 1 whenever `.env.e2e` was absent, and CI has no file —
   it passes tokens as secrets. The job died on its FIRST step, every run.
2. Past that, `Cannot find package '@playwright/test'`. The job ran
   `npm install -g playwright` and **never `npm ci` at all**, so
   `frontend/node_modules` did not exist. The global `playwright` package is not
   `@playwright/test`. It also installed only chromium, while `real.config.ts`
   sets `channel: 'chrome'` — load-bearing, because Vercel's bot mitigation
   fingerprints the bundled `chromium-headless-shell` and 403s every navigation.
3. **The dangerous one.** The mint step was never given `E2E_ORG_ID`, which
   disabled the wrong-org guard: `mint-state` can only ask "is this token a
   member of that org?" if it is told which org. Without it the guard was skipped
   and `owner.json` was minted from `E2E_ADMIN_TOKEN` — a **Unicode Group**
   account that 403s on E2E. The browser would have signed in and written into a
   real customer's books while every `api()` call 403'd. That is exactly how a
   Phase-1 vendor landed in the wrong organisation on 26 Aug.

All three fixed. `E2E_GODMODE_TOKEN` does not exist as a repository secret, so
with the guard active the job now **refuses and stays red until one is added** —
written into the workflow beside the variable. A red job that explains itself
beats a green one writing to a customer's books.

That is three gates in one day found armed in name only: `check-csp-hash`, the
mobile suite (840 tests, blocked by Node 20's inability to glob `**`), and this.
`check-ci-runs-every-gate.mjs` stops the first kind recurring; the other two were
each their own accident, which is the argument for reading a red build rather
than recognising it.

## 2026-08-27 · CI's first mobile run found a signed zero

The mobile job moved to Node 24 and the suite ran in CI for the first time ever.
839 of 840. The one failure was `corrections.test.ts`, and it was the TEST, not
the product: it asserts that a Pahchan correction carries the device's own UTC
offset rather than a `Z` instant — which matters, because
`attendance_bridge.py` assigns `at_time` verbatim and prices the span in hours,
so a shifted clock value is somebody's pay. It was deliberately written against
the machine's own offset "so it holds on a runner in any zone", and it holds in
every zone except one. In UTC `getTimezoneOffset()` returns `0`, so the expected
value is `-0` while `+00:00` parses to `0`; the file imports
`node:assert/strict`, whose `equal` compares with `Object.is`, which holds those
apart. `+ 0` on both sides normalises the sign and changes nothing else.
Verified by running the whole suite under `TZ=UTC`: 840 passed.

Worth keeping: this suite had only ever run in IST, where the numbers are 330
and the sign of zero never comes up. CI is now the only place it runs outside
IST, which is a second zone for free.

## 2026-08-27 · Phase 7.0 — a contact can carry an address and a sales patch

**All three of 7.0's faults were real, all three are closed, and 7.1a is welded
on as the plan demands.**

1. **The contact create form had no address fields at all.**
   `graha_contacts.billing_address` has been a live `jsonb` column since
   migration 023 and `ContactCreate`/`ContactUpdate` have always accepted it —
   nothing could ever put anything in it. Live: E2E Test & Associates **0 of 235
   contacts and 0 of 61 clients carry a pincode**. Now line1 / line2 / city /
   state / pincode on the create form AND the edit panel, written once and
   shared, because two surfaces writing the same jsonb is exactly how a field
   set forks — the Ganit/Kray vendor form did it and needed a set-equality test
   to stop it.
2. **`graha_contacts.territory_id` was unreachable from every API path** — not
   on `ContactCreate`, not on `ContactUpdate`, and in neither the INSERT nor the
   PATCH SET-build. `graha_deals.territory_id`, added in the SAME migration, was
   always writable. So a deal could carry a territory and the person it belongs
   to could not. Live: 0 of 289 contacts and **0 of 162 deals** routed.
3. **`PATCH /territories/{id}` had zero callers.** It is org-scoped,
   admin-gated and validates its members through `_validated_territory_users` —
   and there was no Edit control, so the only way to fix a typo in a pincode
   list was to delete the territory and lose its round-robin position.

**7.1a, in the same commit.** Migration 023 wrote a bare
`REFERENCES staging.graha_territories(id)` with no `org_id` in it — the same
shape `graha_contacts.client_id` has, which is why `resolve_contact_company`
exists. The moment `territory_id` became writable, the database alone would have
accepted one organisation filing its contact under another's territory, and
`assign-next` reads that territory's `assigned_users` to hand out a lead: the
leak would have handed one firm's customer to a different firm's salesperson.
`resolve_contact_territory` closes it on `org_id` **and** `is_active` — the
DELETE is a soft delete that only flips the flag, so without the second
predicate a deleted territory stays assignable for ever.

**The `{}` trap, which changed how this is accepted.** All 235 of E2E's contacts
have `billing_address IS NOT NULL`. Every one of them is literally `{}`. A
null-check acceptance passes on day zero and measures nothing, so 7.0 accepts on
a KEY carrying a value, and the tests assert the posted body down to
`billing_address.pincode`. The key vocabulary is the one
`services/invoice_pdf.py:123` reads — `line1, line2, city, state, pincode,
country` — plus `state_code`, which live rows carry and the form preserves
rather than captures.

**Two findings on the way through.**

- **The contact edit panel offered `Mobile` and `Website` boxes for columns that
  have never existed.** `graha_contacts` has 31 columns — read live in BOTH
  `staging` and `public` — and neither is one of them; `ContactUpdate` never
  listed them either, so pydantic dropped the values before the SQL was built. A
  person typed, the toast said "Contact updated", and the value went nowhere,
  twice over. Both removed rather than added: `phone` already exists, and a
  website belongs to the company, where `graha_clients.website` already holds
  it.
- **`staging.sales_territories` is a SECOND territory model** — `state_codes
  varchar[]`, `city_names text[]`, `pincode_ranges jsonb`, `assigned_to uuid[]`,
  `manager_id`, `parent_id`. **0 rows table-wide, every org.** It is a richer PIN
  schema than the one in use, it is not on Phase 6's DROP list, and it needs
  naming to the owner as a 24th table. Not dropped, not built on: a DROP is
  approved by name.

Still ⬜ on routing: **0 territories carry a PIN and 0 carry a member** (17 in
E2E, 0 in Unicode; 3 hold an empty `pincodes` key). 7.0 is the capture; 7.1 is
the resolver.

## 2026-08-27 · Corrections from a live re-read

Four published figures were wrong. Each is corrected where it was published
rather than only here.

- **Phase 0.23's denominator.** "0 of 73 → 12" is **12 of 83**; Unicode is 2 of
  26. The twelve links are real and verified by name.
- **The Pahchan web clock is not ✅, and the reason changed.** The blocker this
  was written about — no employee carries a `user_id` — is GONE. But the single
  E2E punch did not come through `Clock.jsx`: its `client_punch_id` is the
  literal `e2e-phase023-first-linked-clock-in` where the screen mints a
  `crypto.randomUUID()`, `photo_key` is NULL where that screen always uploads a
  selfie first, and `lat`/`lng` are NULL. It is a scripted POST from a browser —
  `audit_log.user_agent` says desktop Chrome — not a person operating the tab.
  ⚠ **`pahchan_punches` cannot tell web from mobile at all**: `source` is
  CHECK-constrained to `('live','offline')`, which is connectivity. The only
  platform record anywhere is `audit_log.user_agent`, and Unicode's 699 punches
  have no audit rows at all.
- **The punch count is 700, not 1,659** (230 June, 425 July, 45 August). The
  altitude finding survives — 0 of 700 carry `altitude_m`, 0 of 9 sites carry
  `altitude_m` or `altitude_tolerance_m` — but an acceptance written against
  1,659 measures against a number that no longer exists. Where the ~959 rows
  went is NOT established and is not guessed at: `punch_cleanup_20260823` has
  been dropped and cannot be queried.
- **"0 of 81 employee rows carry a user_id today"** appeared as a present-tense
  fact in `routers/pahchan.py`, `services/seat_model.py`, `pahchan/Notice.jsx`
  and the premise of `dpdpNotice.test.jsx`. It is 14 of 109. The dated
  measurements elsewhere are left alone — they are history and correct as such.

## 2026-08-27 · Phase 8.0 — `<AddressBlock>`, and a second id on screen

One component, five surfaces, no vendor. The link is an ANCHOR to the Google
Maps URLs scheme: no API key, no quota, no billing account, and an anchor is not
a fetch, so `vercel.json` is untouched by the whole component. The URL is built
in exactly one place, which is what makes the Mappls fallback a one-function
change if the "a link out is navigation, not a map" reading is ever contested.

Wired: Graha client detail, Graha contact detail, Kray vendor list, Manav
employee detail, Vikray order *Ship to*, Pahchan punch. The punch passes a
coordinate rather than an address, and a coordinate always beats address text —
an Indian PIN averages ~82 km², and 699 of the 700 live punches carry lat/lng.

**Written against what is STORED, not against the DDL.** All six address columns
are `jsonb` in `staging` only, and the contents are not uniform:

- The empty branch tests EMPTINESS, never null. All 235 E2E contacts, all 83
  `manav_employees.address` and all 322 `vikray_orders.shipping_address` are
  `IS NOT NULL` and every one is `{}`. A plain falsy check on the address would
  be wrong on the majority of live rows.
- A record with nothing usable renders NOTHING. A link to an empty `query=`
  opens Google Maps on the reader's own location, which looks exactly like the
  product having found the client's premises — confidently wrong is the worst
  failure available here.
- `Navrang Polymers` stores its address as a JSON string exploded into
  single-character keys `"0"`–`"41"` — **plus a genuine 43rd `city` key reading
  "Navi Mumbai" which contradicts the exploded copy's "Mumbai"**. The plan did
  not mention the 43rd. Reading the seven known keys BY NAME renders "Navi
  Mumbai" and ignores the noise; joining values in key order renders a line of
  punctuation. The test asserts the output contains no brace, no quote, and not
  "Maharashtra" — which exists only spelled across keys 26–37, so if it ever
  appears, something has started guessing.
- `INC UK` (`pincode = 'NW1 245'`, city Uganda, line1 London, state New York)
  renders without throwing. No Indian-PIN validation blanks the record.

29 tests. `npm run check` (12 gates), `npm run build` and the baselined vitest
run all clean, no new failures.

**Three findings the plan did not have.**

1. **There is no vendor DETAIL surface**, so the address went on the list — and
   `VendorForm.jsx` captures **no address field at all** (`BLANK_VENDOR` has no
   `address` key) while `POST /v1/ganit/vendors` has always written
   `body.address` and 6 of 9 Unicode vendors carry one. API-writable, populated,
   and unenterable through the UI. Its own change.
2. **The plan's Ganit invoice consumer is a backend PDF surface.**
   `invoice_pdf.py` renders the address server-side; `ganit/InvoiceDetail.jsx`
   renders none at all. That row needs a new screen, not a swap.
3. **The two backend address renderers disagree on field order** —
   `invoice_pdf.py:_fmt_addr` is `city, state, pincode, country`,
   `doc_render.py:fmt_addr` is `city, pincode, state, country`. The component
   follows `invoice_pdf.py`; the two need reconciling.

**Mobile deferred, with the reason.** `GET /v1/vikray/orders/{id}` is
`SELECT o.*`, so `shipping_address` already reaches the phone — only the TS
types omit it. But no module is shared between `frontend/` and `mobile/`, so
wiring `OrderDetailSheet.tsx` means forking the reader **and** the 40-row
statutory `GST_STATES` table into TypeScript, which destroys the single-place
property the licence fallback rests on.

## 2026-08-27 · A user id on screen, twice, and the ratchet that walked past it

Found while wiring the contact detail. `graha/ContactsTab.jsx` drew a truncated
`assigned_to` through `substring(0, 8)` inside a template literal inside a
ternary — eight characters of a `users.user_id`, which identifies nobody — and
`graha/ReportsTab.jsx` drew `assigned_to` through `slice(0, 12)` on the
rep-performance table, the one report whose own endpoint comment says *"these
figures sit against a person"*. `services/crm_report.py` has joined `users` for
the DOWNLOADABLE version of that same report since it was written, so the file a
customer sends to their partner carried names while the screen they read it off
did not.

**`check-rendered-ids` missed both, for two independent reasons**, and the first
is a repeat:

1. `assigned_to` was not in `ID_PATH`. The vocabulary knew `_id`, `_by`, `uid`
   and `uuid` — and this product's assignee column is a `_to`. Note 1 in that
   script already records `requested_by` being invisible for want of a `_by`.
   Same class of miss, second outing. `assigned_to` is now named EXPLICITLY
   rather than bought with a generic `_to` suffix, which would drag in `due_to`,
   `sent_to` and every other preposition-shaped field: a vocabulary that fires
   on prose is one people write exemptions against.
2. The ternary. A `?` in the expression put the whole thing in `NOT_A_RENDER`,
   so **every ternary in the product was invisible to this check**. Both obvious
   fixes are wrong, and this was MEASURED rather than reasoned: removing `?`
   from `NOT_A_RENDER` produced 15 findings across the app and every single one
   was a false positive of one shape — an id used as the CONDITION with two
   string literals as the arms. The condition is not drawn. The arms are. So
   `splitTernary` judges the two arms and ignores the condition.

Proved before it was fixed, per the house rule: both shapes went into
`fixtures/rendered-ids/Offenders.jsx` first and the check found 4 of 6. After
the vocabulary widening it found 5; after `splitTernary`, 6. Against the real
tree it is now clean at 589 components with a strictly stronger check — the 15
false positives never appear, because the condition is no longer read.

Fixed at the source, not on the screen: `report_rep_performance` and the contact
detail both carry a name from the server now, through a new module-level
`_USER_NAME_SQL` — one definition where the same ladder had been written out in
six places, and it stops at `name` and never reaches `u.email`, which
`test_audit_actors.py` enforces backend-wide. The contact detail also gained
`territory_name`, so 7.0's capture is visible on the record it was written to,
and BOTH new joins are org-scoped: `graha_territories.id` is unique table-wide,
so joining on the id alone would surface another organisation's territory name.
That is one more of the nine joins `memory/graha_clients_join_leak` counted.

## 2026-08-27 · Phase 7.0 ACCEPTED — a pincode reaches the database

Driven as a real user against the deploy (`phase7-address-capture.spec.ts`,
3 tests, all passing), then read back live. Both counts the plan names moved:

    E2E Test & Associates      before     after
      contacts                   235       236
      with billing pincode         0         1
      with territory_id            0         1
      territories with a PIN       0         1   (of 17)

    Unicode Group — untouched, re-verified after the run:
      54 contacts · 38 pincodes · 0 territory_id · 0 territories

The row is *Phase 7.0 Pincode Acceptance*:
`{"city": "Surat", "line1": "Plot 44, Pandesara GIDC", "state": "Gujarat",
"pincode": "395002"}`, routed to the **Gujarat** territory, which now holds
`{"pincodes": ["395002"]}`.

**395002 and Gujarat agree with each other on purpose.** 7.1 routes a contact by
matching its PIN against a territory's list; seeding a PIN into a patch nobody
would actually put it in would make 7.1's acceptance a tautology.

**Idempotent, and it asserts that about itself** — exactly one contact by that
name, and the territory half verifies instead of writing when it finds its own
PIN already there. A seed that writes a fresh copy on every run inflates the
count it exists to prove, and the inflation looks like progress.

Four selector faults on the way, each worth recording because each looked like a
product failure and was not:

1. `getByRole('tab')` found no Territories tab. Graha has TWENTY tabs and the
   strip shows only what fits; the rest sit behind a "More +N" popover, which is
   what `openTab` exists for. The failure message said "Graha has no territories
   tab" about a tab one click away.
2. `getByRole('button', {name: /^add$/})` resolved to 2 elements — the form has
   an Add for `assigned_users` and an Add for `rules.pincodes`. Two identical
   button labels in one form is a real accessibility smell; scoped here rather
   than renamed, because that is a UI change and this is a test.
3. `getByText(PIN, {exact: true})` never matched the chip: a chip is the pincode
   AND its remove button, so its text is `395002×`.
4. **The instructive one.** `getByLabel(/^territory$/i)` matched nothing, and
   `pickOption` reported "the territory picker never loaded any options" about a
   picker that was on screen with its options in it. A Graha field is
   `<label class="gr__f"><span class="gr__fl">…</span><control/></label>`, and
   the accessible name is computed from the whole label subtree — which for a
   `<select>` includes every option's text. The text inputs happened to work,
   which is worse than if none had: it read as a data problem rather than a
   selector problem. The spec now walks `.gr__fl`, which is what the unit tests
   for these forms already do.

<!-- Next: when Phase 1/2 work lands, add lines here and flip STATUS.md rows. -->
