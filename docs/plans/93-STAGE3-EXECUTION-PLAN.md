# Proposal 93 · Stage 3 — the execution plan

**Written 2026-08-28, before execution, so there is nothing to negotiate on "go".**
Siblings: `93-R1-FREEZE-LEDGER.md` · `93-R2-BACKUP-RISK-REPORT.md` ·
`93-R2-OBJECT-INVENTORY.md` · `93-R3-ACCOUNT-RESOLUTION.md` · `93-R4-DELETE-PLAN.md`.
The proposal itself is `docs/proposals/93-reseed-and-reverify.html` — this plan
does not restate it and does not supersede it. Where the two differ, 93 wins.

---

## 0. Why this exists, in the owner's words

> "Imagine giving a client a completely new org, and then they start using it
> and things break and they are not happy. Start from thinking that you are the
> client who will be using this."

Not "does every function work". **"Does a new customer's first week work"** —
a different and harder question, and the one that loses customers.

Every defect this product has shipped in the interaction classes was **invisible
to the database**: a component that rendered a map and drew nothing for eighteen
days; a territory map reachable only while creating a territory; a button whose
only write path answered 422 for its entire life; a page that displayed six wrong
numbers. **Not one would fail a row-count check.** They fail an interaction
check, which is why the interaction check is the deliverable.

---

## 1. State on the day this was written

| | |
|---|---|
| **Done** | R0 · R1 freeze (7/7 crons at `0 0 1 1 *`) · R2 backup **with a proven restore** · R3 · R4 delete (25,854 rows) · Suite 00 (31/31) · Suite 01 (4/4) |
| **Part done** | Suite 02 — 3 of 7 |
| **Not started** | Waves 2–8 · Stage 4 (UK replay) · Stage 5 (mobile) · R9 |
| ⚠ | `reseed_backup_20260828` is still the **only copy** of the deleted rows |
| ⚠ | Seven crons sit at `0 0 1 1 *` — that fires once on 1 January if forgotten |

**R9 is pre-approved** — drop the backup by name and restore the seven crons
from `93-R1-FREEZE-LEDGER.md`. **At R9, not before.**

---

## 2. The two rules, and the third that was missing

**Rule 1 — every row is typed by a user.** Playwright opens the page, fills the
form, picks from the real picker, uploads the real file, clicks the real button.
No SQL seeding, no API shortcut. Enforced by `frontend/scripts/check-e2e-no-bypass.mjs`,
which bans writes-without-a-click and explicitly **allows** auth minting: the
token opens the door, and §2 of the proposal says of that precondition, "this is
not a bypass of the driven-as-a-user rule — it is the precondition for it."

**Rule 2 — stop and fix, but prove product-bug vs test-bug first.** Last session
four of its own checks accused the product and **all four were wrong**. A test
edited green is how a real defect gets buried.

**Rule 3 — never write without asserting the org first.** This was supposed to
already exist. See §3.

---

## 3. The guard that had never run

`_lanes.ts::assertOrg()` was written on 2026-08-28 in response to Suite 02
renaming **Aekam Inc** — the one org this programme guarantees is untouched —
because a `platform_admin` credential resolved every request to Aekam via
`platform_bypass`, and the save genuinely succeeded, so the suite went green.

Two things were then found wrong with the countermeasure itself:

1. **No spec imported it.** A search for `assertOrg` across every spec returned
   nothing.
2. **It could never have passed.** It compares against `id` from
   `GET /api/v1/org/profile`, and that response contained no `id` at all —
   verified live, on both lanes. `actual` was always `undefined`.

> A gate nobody has seen fail is decoration. — proposal 93, §0

**Closed, and each fix proved by mutation (remove the line → red, restore → green):**

| Change | Proof |
|---|---|
| `backend/routers/org_profile.py` — `GET` echoes `d["id"] = org_id`, the resolver's own answer, which is the same dependency the `PATCH` writes against | `backend/tests/test_org_profile_echoes_its_org.py`, 2 tests |
| `frontend/src/pages/OrgSettingsPage.jsx` — the heading names the org **the server resolved**, not `user.org_roles.find(...)` | `frontend/src/__tests__/orgSettingsNamesTheRightOrg.test.jsx`, 3 tests |

The second is a **customer-facing bug, not a test-harness one**, and it is worse
than the "no on-screen indication" it was originally filed as. The screen was not
silent — it was **wrong**, and a wrong label is trusted. `org_roles.find()` takes
the first role on the user object, which differs from the write target in three
live ways: a person with seats in several orgs gets whichever sorts first (the
account that found this holds `org_admin` in three); the org switcher sends
`X-Org-Id` and never touches `org_roles`; and platform staff resolve through
`platform_bypass` into somebody else's organisation entirely.

**The name is rendered and the id is not** — `check-rendered-ids.mjs` still
passes at 595 components, and a UUID is not what tells a person they are in the
wrong company anyway.

---

## 4. Lanes and credentials — settled, nothing owed by the owner

| Lane | Account | Role | Credential |
|---|---|---|---|
| Unicode Group — **reference** | kevalvshah03+1@gmail.com | org_admin | `E2E_UNICODE_TOKEN` |
| UK AekamINC — **brand-new org** | keval.shah@unicodegroup.com | org_owner | `E2E_UK_OWNER_TOKEN` |
| E2E Test & Associates | keval.shah@unicodegroup.com | org_admin | same token |
| Aekam admin | god mode | platform | **ONLY Suite 19** |

Both tokens probed live on 2026-08-28: `200`, correct orgs, Unicode configured
(GSTIN, address, logo) and UK cleared (all null) exactly as R4 left them.

**No password is ever typed into a login form** — a standing owner rule. The
owner authenticates once per account and the suites drive from the token.
Suite 01's login-form and rate-limit tests are the one exception and stay on a
password account: proving the login form with an injected token would assert the
very thing it bypassed.

⚠ `suite02-org-settings.spec.ts` carries a header claiming both tokens expired
2026-08-27. **That is stale**, and it is why the last session silently ran Wave 1
on an E2E fallback lane instead of the reference lane §14 requires. Correcting it
is the first change of Stage 3.

---

## 5. How each interaction class is driven

Suites are repo code, run by `npx playwright test --config e2e-real/<wave>.config.ts`.
**`--headed` is impossible in this environment** (`spawn UNKNOWN`) — every run
records video, trace and an HTML report, and that is the evidence.
The MCP browser tools are **triage only**: reading a screen to rule product-bug
vs test-bug. A finding reproducible only by hand is not a suite.

| Event | Driven by | What must be observably true — never "it did not throw" |
|---|---|---|
| Click | `locator.click()` | One of three, recorded as booleans: a request fired, the DOM changed, or navigation happened. **Zero of three = a dead control** — that triple *is* Suite 22 |
| Type | `pressSequentially()`, **not** `fill()` | `fill()` sets a value without key events. **Contact search is server-side and does not fire on typing** — a Phase 8.0 fault clicked an unfiltered table and opened the wrong record. Real keys → `waitForResponse` → the list narrowed → reload → the value survived |
| Select | `selectOption()`, click-through for comboboxes, `setDate()` for dates | The value binds to the row. **No native `<input type="date">` exists in this product** — `DateInput.jsx` is the only path |
| Drag | `mouse.move/down/move×N/up` | `dragTo()` fires two events and HTML5 dnd libraries ignore it. Assert the **persisted** `column_id`/`sort_order` after a reload. A drag that animates and does not save is the exact defect a screenshot cannot tell from success |
| Hover | `locator.hover()` | The revealed action is visible **and clickable**. An action that only exists on hover and never appears is unreachable |
| Keyboard | `keyboard.press('Tab')` loop reading `document.activeElement` | Focus order sane, Enter and Space activate without a mouse, **Escape closes every modal and drawer**. Fixed by hand once — React Aria was rejected — so it regresses silently |
| Transition | `toBeVisible` / `toBeHidden` plus a focus-trap check | It opens, it is readable, it closes. A toast that never dismisses and a drawer that traps focus are live bugs no row count shows |
| Scroll | `mouse.wheel`, `boundingBox()` | Sticky headers hold; wide tables scroll **inside their container** (`body.scrollWidth <= clientWidth`); page past the 200-row cut |
| Resize | `setViewportSize()`, `emulateMedia({colorScheme})` | Three breakpoints × light and dark. No horizontal page scroll, nothing clipped or overlapping |
| Upload / download | `setInputFiles()`, `page.on('filechooser')`, `waitForEvent('download')` | The object reaches R2 **and the download produces bytes** — a 200 with an empty body is the known failure |
| Load and error | `page.route()` to delay, then abort | A skeleton appears, and the failure **names what failed** rather than rendering an empty table that reads as "no data" |
| Empty state | Visit every screen before its data exists | It says so **in words**. This is day one for a new customer, and the state nobody has looked at since the data arrived |
| Console | `page.on('console')` and `page.on('pageerror')`, shared fixture | Collected per screen and **fails the test**. Zero uncaught errors across the whole run |

---

## 6. The seven suite rules — each learned from a false accusation

1. **A missing control is a FAILURE, never `test.skip`.** A skip on a missing
   affordance is how the eSign journey reported green for weeks while the whole
   module returned 403.
2. **Read the WRITE RESPONSE, not the list.** Ganit orders invoices by date and
   the seed runs to Aug 2026, so a new invoice is not on page one. The test said
   "not created" while the screen said "Invoice created".
3. **Then fetch the CANONICAL row.** `POST /invoices` echoes four fields;
   asserting on the rest turns them into `NaN`, and `expect(NaN).toBe(0)` fails
   with a message that sounds like a tax bug.
4. **List endpoints cap at 200 rows** whatever limit is asked. Never reconcile a
   total by summing a list — assert a **delta**. Summing gave ₹1.06 Cr against a
   true ₹3.58 Cr; the stats figure was correct to the paisa.
5. **Poll selects that a fetch populates**, and wait for the **refetch** after a
   write, not just for the write.
6. **Scope lookups to the open form or tabpanel.** `getByLabel` substring-matches
   and module headers duplicate the tab's own buttons.
7. **One button can make TWO requests.** eSign creates the document then uploads
   the file; reading the row between them says "the PDF was not attached".

**The recurring bug shape — check for it first.** Three of the eight product bugs
found so far are identical in kind: **a value of the wrong Python type handed to
a typed Postgres column, surfacing as an opaque 500 with nothing on screen**
(`batch_id` uuid fed `BSI-<timestamp>`; `salesperson_id` uuid fed `user_xxx`;
`$2::date` handed a `str`). Each had never worked, for any org, since it was
written. **When an endpoint 500s, pull the Railway logs before theorising** —
guessing cost several rounds each time.

---

## 7. Order of work

Volumes run **as sized** (~7,510 records) on the owner's instruction, 2026-08-28.

| Stage | Suites | Lane |
|---|---|---|
| **0** | Wire `assertOrg` into every write suite; correct the stale blocker; re-run Wave 1 | Unicode |
| **W2** | 07 Manav · 04 Graha | Unicode |
| **W3** | 08 Vetana · 09 Pahchan · 05 Ganit | Unicode |
| **W4** | 06 Kray · 10 Vikray · 11 Prachar · 17 billing | Unicode |
| **W5** | 03 core PM · 13 Sanvaad · 14 Sahayak · 15 eSign | Unicode |
| **W6** | 16 Niyam · 18 portal · 19 admin | Unicode |
| **W7** | 12 Dristi · 20 cross-cutting | Unicode |
| **W8** | 22 dead-control sweep | Unicode |
| **Stage 4** | the same suites, **unmodified** | UK AekamINC |
| **Stage 5** | 21 mobile, both AVDs; the camera question answered first | — |
| **R9** | re-arm 7 crons, restore outbound, drop the backup by name | — |

Each wave boundary is a barrier. **R5 fixtures are built before Wave 3 needs
them**: 30 synthetic faces (matching is parked to v2, so a real face buys zero
coverage while creating real biometric records under DPDP for people who do not
exist); 3 bank statements with columns read **out of the parser**, because
parsing is positional; 6 multi-page PDFs so eSign field placement on page 2+ is
exercised; 8 KB documents with answerable facts, or the KB test is unfalsifiable;
one oversized file sized from the limit in the code rather than guessed.

**Stage 4 is the honesty test, not a repeat.** Unicode is Gujarat `24`, UK is
Maharashtra `27`, so identical suites **must** produce a different professional
tax and a different GST split. Identical figures would mean the ladders are not
being read at all. A suite that passes on Unicode and fails on UK has revealed
either a hidden dependency on Unicode's state or a genuine cross-tenant defect —
both worth having, neither a retry.

---

## 8. Concurrency — and why the login limiter is not the ceiling

Proposal 93 §14 caps peak concurrency at 4 because "login is rate-limited to
5/min, and a lane that trips its own limiter produces failures indistinguishable
from defects".

**That cap was costed against password logins, and this programme does not use
them.** `limiter.py` builds `Limiter(key_func=client_ip)` with **no
`default_limits`**, so only decorated routes are limited and every one of them is
auth-shaped. The token bootstrap never calls `POST /auth/login` at all, so a
token-driven lane cannot trip it.

**So the limiter is not raised, and does not need to be.** It is a product
security control that protects real customers; it was repaired only days ago
(staging's start command hardcoded `--workers 2`, which overrode
`WEB_CONCURRENCY=1` and made the limit unenforceable); and weakening it to buy
test throughput would undo that repair and change what staging proves about
production.

The one suite that must stay `workers: 1` is **Suite 01**, whose subject *is* the
login form and which deliberately exhausts the limiter with six bad passwords.

---

## 9. Triage, delegation, and what is never delegated

Agents write and run. **An agent that hits a failure stops, reports, and waits —
it does not diagnose and it does not fix.** An agent that both writes the test
and rules on whether the test or the product is wrong will, under time pressure,
edit the test, and that is the one failure mode that makes the whole programme
worthless: a green run over a broken product.

Held in one pair of hands and never sub-delegated: **product-bug vs test-bug**,
every **delete**, every **migration**, every **go/no-go gate**.

| Cause of a failure | What happens |
|---|---|
| The product is wrong | Stop. Fix. Re-run green. Then continue |
| The test is wrong | Fix the test — **after** proving which it was |
| Blocked on the owner | `docs/OWNER-ACTIONS.md`, and the run continues past it |
| A missing feature, not a bug | `docs/OWNER-ACTIONS.md` with evidence and an estimate; the run continues |
| Excluded by decision (WhatsApp, social publish) | Not a failure. Not run |

Every landing updates `docs/STATUS.md` and appends to `docs/plans/PROGRESS.md`
**in the same commit** — that is part of "done". ✅ means a customer completed the
flow end to end, proven by a row where there were zero. Code without data is 🟡.

---

## 10. What this plan does not promise

**A finish date.** The 17–20 day estimate costed *writing and running* the
suites. It did not cost *fixing what they find*, and the defect count is the very
thing the programme exists to discover — these two orgs have never been driven
end to end before. The calendar is therefore bounded by how broken the product
turns out to be, not by how long the suites take. What can be reported instead,
honestly and as it arrives, is the defect count and the fix rate.

**And a run is not a sprint.** ~31,600 interactions at 1.2–2.0s each is 11–16
hours single-threaded and 3–4 hours sharded. It is designed to run overnight and
to be **re-runnable from empty** — a seed you can only build once is not a test.
