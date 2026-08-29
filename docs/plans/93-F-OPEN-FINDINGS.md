# 93 §F — the open findings ledger

**Every defect found by proposal 93 that is REPORTED AND NOT FIXED, with its
evidence and its verdict. Written 2026-08-29.**

## Why this file exists

Each of these was also filed as a one-click background task. **This file is the
durable record, so the chips can be dismissed without losing anything.** A chip
is a convenience for starting the work; the finding lives here.

Every entry states what was MEASURED, not what was suspected. Nothing here is a
hunch: where a count appears, it came from a live query on the date shown.

**Ranked by customer impact, with a new customer's first week at the top — that
is the owner's stated goal and the reason the programme exists.**

---

## 1. ~~Cron-minted invoices are born `final` and skip the Rule 46 gate~~ FIXED
**Statutory · was ACTIVE, and it HAD ALREADY FIRED · `client_billing.sweep_client_auto_invoices`**
**Closed 2026-08-29. Uncommitted at the time of writing — the lead commits.**

The sweep INSERTed into `staging.ganit_invoices` without naming `doc_status`,
which DEFAULTS to `'final'` — **confirmed from `pg_attrdef`, not from a
migration file**. So every invoice automatic billing minted was born final and
never passed `_refuse_final_if_incomplete`, the Rule 46 completeness gate every
manually-issued invoice must clear. Created unattended.

**⚠ THE FIRST EXPOSURE READING SAID "LATENT" AND WAS WRONG.** Live today:
`client_invoice_lines` **0**, `ganit_invoices WHERE created_by='system'` **0**,
service lines with `auto_invoice` **0 of 9**. But `PROGRESS.md`'s own Phase 3.3
acceptance records `/cron/billing` raising **INV-2026-0093 (₹88,500)** and
**INV-2026-0094 (₹17,700)** on 2026-08-27 — both `final`, both numbered out of
Unicode's live serial sequence. The 93 Stage 2 reseed deleted them on 08-28.
**A zero that means "wiped", not "never".** And `billing` IS in `cron-daily`'s
start command (Railway service config, read 2026-08-29); STATUS.md said that
step was still owed, and both of its cells are now corrected.

**DECIDED: the sweep writes `'draft'`.** Running the gate first would need an
answer for a row that FAILS it, and every answer is worse than a draft —
skipping leaves a monthly retainer silently unbilled, which is the shape of the
"invoiced exactly once, for ever" defect the period logic already exists to
prevent. Nothing is thrown away: the invoice is created, numbered, on the
register, and issued by a person via `Mark final`, which DOES run the gate. It
is also what the sibling `generate_usage_invoice` in the same file already
writes to the same column.

**The sibling blind spot was CHECKED, not assumed.** A swept invoice names a
company and no person — exactly the shape that 422'd on 08-29 — and
`ganit.update_invoice_status` allows `draft → final` and passes `client_id`, so
the Rule 46(e) company fallback fires and the draft can actually be issued.

⚠ **NOT PROVABLE BY DRIVING THE PRODUCT**, because nothing in the UI runs the
sweep. That is a finding as much as the fix is. 17.11 now asserts over whatever
the sweep has ever left in the org — zero today — and its log says the check
proved nothing this run rather than reporting a vacuous pass.

## 2. ~~Converted invoices store a blank `place_of_supply`~~ FIXED
**Statutory · was ACTIVE · `vikray.generate_invoice_from_order`**
**Closed 2026-08-29. Uncommitted at the time of writing — the lead commits.**

The INSERT hardcoded `''`. Measured over all 65 invoices: **31 blank**; **10
came from an order and every one of them is blank**; **6 of those are
inter-state**.

`parse_state_code('')` returns `""` — read, not guessed — and `gstr1_json` then
splits two ways: an INTRA-state supply falls back to the supplier's own state
and files correctly, while an INTER-state one is **held out of the return
entirely** ("no place of supply recorded, and it cannot be inferred"), so the
sale never appears. Those six are the live exposure.

`_order_place_of_supply` derives it from `gstr1_json.supplier_state_code` and
the counterparty — the person's GSTIN prefix, then the company's, then either
address, the order `InvoiceForm.jsx` already derives in — reading every
candidate through `parse_state_code`, the same function that reads this column
back. It writes the state NAME: what 32 of the 34 populated rows already carry,
what Rule 46(n) asks for ("along with the name of the State"), and what
`invoice_pdf.py:259` prints raw onto the customer's document.

**⚠ A candidate equal to the supplier's own state is SKIPPED on an inter-state
supply.** Three live clients carry a `24` GSTIN at a Maharashtra or Karnataka
address, and writing `24` onto an IGST invoice is `doc_validation`'s BLOCKING
"Tax split" gap — a document stating one treatment and carrying another.
Unresolvable stays `''`, which is what was written before, so this can only
improve the column and never blank a populated one. GSTIN/PAN/TAN still block
nothing.

⚠ **STILL OPEN, AND IT IS A NUMBER FOR THE OWNER RATHER THAN A TASK:** **10**
order-generated invoices carry a blank place of supply, **6** of them
inter-state and therefore absent from GSTR-1; **19** are blank-and-inter-state
from all sources; **31** are blank in total. Not backfilled — re-stating a Rule
46 particular on an issued tax invoice is a data change to live rows
(`OWNER-ACTIONS.md` item 22). 10.08 names every one of them in its log.

## 3. The outbound freeze cannot stop a mention or comment email
**Safety — about OUR OWN guarantee, not the product's · ACTIVE**

`POST /tasks/{id}/comments` declares no org dependency, so `outbound.set_org`
never runs, `begin()` files the send with `org_id = NULL`, and
`_org_suppressed(None)` returns **False BY DESIGN**.

    MEASURED 2026-08-29: 180 rows in staging.outbound_log with org_id IS NULL
                         since 2026-08-07.

**R1's freeze is what makes staging safe to drive, and it never covered the core
PM surface.** `middleware/org_resolver.py` documents the family: **233 of 743
route/method pairs resolve no org, and 74 of those are core PM.**

The three candidate fixes are (a) give those routes an org dependency, (b)
derive the org in the send path from the task/team the notification is about, or
(c) make `_org_suppressed(None)` fail CLOSED — safest for the freeze, but it
would suppress genuinely org-less mail such as password resets and invitations,
which must keep working.

⚠ `outbound.py`'s header explains why the capture must stay in `begin()`, on the
caller's thread: reading it later inside `outbound_log.write()` would ERASE the
org already captured, leaving `org_id = NULL` with nothing looking wrong.

## 4. `graha` inbound-emails 500s on a column that does not exist
**ACTIVE (route), LATENT (no caller) · `routers/graha.py`**

    staging.graha_inbound_emails columns (staging only; ABSENT from public):
      id, org_id, sender, subject, body_text, parsed_data, status, created_at
    There is NO contact_id column.

`list_inbound_emails` (~:3209) SELECTs `contact_id`, so
`GET /api/v1/graha/inbound-emails` has answered **500 for its entire life**. The
ingest path (~:3168) UPDATEs the same missing column **after** inserting the
contact and its activity — so an inbound lead 500s halfway and leaves a PARTIAL
WRITE.

Inbound email is not wired in this product and the route has no caller, so it is
latent. That argues for the cheaper fix, but the choice must be justified.

## 5. A date picker inside a modal is unclickable
**Interaction · ACTIVE · `frontend/src/components/ui/DateInput.jsx`**

    MEASURED at 1280x720:
      modal panel      y 203 - 517
      popover (316px)  flips UP to y 65 - 381
      Clear button     y 106 - 133   <-- outside BOTH clipping ancestors
      document.elementFromPoint(Clear centre) -> div.modal__scrim

**A person aiming at Clear closes the dialog.** `DateInput` never portals its
popover. Independently, its calendar also flips up UNDER the board toolbar —
month nav and days 1-8 unreachable at the same size.

Only 4 files pair `<Modal>` with `<DateInput>` today, so the blast radius LOOKS
small — but the fault is in the shared component, native date inputs are banned
repo-wide, and ~64 call sites use it. Not changed mid-session, deliberately.

## 6. A solo administrator cannot approve a purchase order, ever
**New-customer blocker · ACTIVE**

Read verbatim off the drawer: *"You raised this purchase order, and this
organisation does not allow self-approval."* With exactly one administrator
there is nobody else, so above-threshold orders are permanently stuck.

**A new customer is very often one person.** The separation-of-duties rule is
correct; what is missing is that the product neither predicts the deadlock nor
names the setting that resolves it. **Do not remove the separation rule** —
"whoever defines what people are paid does not release the money" is deliberate.

Beside it: `DELETE /purchase-orders/{id}` exists with no control, so a draft
raised by mistake can now be CORRECTED (fixed 2026-08-29) but not discarded.

## 7. A scheduled campaign never sends
**ACTIVE · Prachar**

`POST /campaigns/{id}/schedule` — described in the code as "the only way into
that state" — has NO caller. The calendar drag PATCHes `scheduled_at`, leaving
`status = 'draft'`, and the cron only picks up scheduled campaigns.

    MEASURED 2026-08-29: 12 campaigns all carry a date, 0 are 'scheduled'.

Closing it needs a control AND a product decision — does dragging a draft onto a
day also ARM it, or is arming a separate act? Its consumer `cron-daily` is
disarmed at `0 0 1 1 *`.

## 8. Pahchan policy overrides have four working routes and no screen
**ACTIVE · blocks §4**

Four complete routes for department / site / person overrides, and
`staging.pahchan_policy_overrides` holds **0 rows** for its entire life. Nothing
in `frontend/src` or `mobile/src` calls any of them.

An attendance policy that cannot vary by department or site is one policy for
the whole company. §4's "policy · department overrides — 1 · 4" is
**unachievable** as things stand.

## 9. Thirty-one request fields no screen has ever sent
**ACTIVE · the class itself**

254 request-body models swept against every path literal in `frontend/src` and
`mobile/src`. Measured examples:

    tasks.recurrence     286 tasks,  0 recurring
    reporting_to         0 of 30 employees
    max_carry_forward    0 of 6 leave types
    other_allowances     0 of 30 salary structures
    auto_assign_to       0 of 2

**Triage before building.** Each is one of: a real feature with no door; dead
weight to remove so the API stops advertising it; or reached another way —
⚠ and the third is the trap, because the same sweep's naive first pass reported
361 orphans against a true 109, the difference being dynamically-composed base
paths and `mobile/` as a SECOND CLIENT.

## 10. `lost_reason` and `pipeline_id` are writable and unreachable
**ACTIVE · `routers/graha.py` `_DEAL_COLS`**

A grep across `frontend/src` AND `mobile/` returns **zero** writers for each.
Live: **6 Lost deals and 0 reasons**, on a field the router itself calls "the
single most valuable free-text field in the module"; 2 pipelines with all 30
deals on one.

That makes **four** `_DEAL_COLS` columns with the same disease — `territory_id`
and `contact_id` are documented in that file's own comments.

## 11. The DPDP data surface is built, unreachable, and documented as absent
**Privacy/compliance · ACTIVE**

`/api/v1/me/sessions` **answers 200 today** — measured. The screen that should
expose it was never wired, and `TabData.jsx:9` still carries a comment saying
the endpoints DO NOT EXIST.

⚠ A comment disagreeing with its code is a recurring, expensive failure here:
the support feature was unreachable for its entire life because
`ADMIN_SURFACE_ROLES` said "the union of the rows above" and computed three of
four. **Fix the comment even if nothing else.**

India's DPDP Act gives a person rights over their own data, and this product
holds biometric punches and enrolment photos.

## 12. Three tabs announce nothing while loading
**Accessibility · ACTIVE**

`RateCardsTab`, `SLACreditsTab` and `AgeingTab` render a bare `<SkeletonList/>`
instead of `<SkeletonRegion>`, so there is no `role="status"` / `aria-busy`.
**To a screen reader, and to anything automated, "loading" and "empty" are the
same screen.**

Keyboard and screen-reader behaviour here was fixed BY HAND and React Aria was
deliberately rejected — nothing keeps it correct. **The ratchet is the valuable
half**, not the three components.

## 13. The live-SQL ratchet counts a string, not a behaviour
**Our own tooling · ACTIVE**

`test_every_writer_has_a_live_sql_test.py` detects coverage with the bare
substring `"prepare("` matched against the whole file — so a test that only
MENTIONS `prepare()` in a docstring credits every router it imports with
live-SQL coverage it does not have.
`test_date_params_are_parsed_not_bound_as_str.py` is exactly that shape today.

**Third time a static ratchet here has been caught counting a string.** It does
not matter today because a real test exists beside it — but the next name could
leave the baseline on a docstring alone.

## 14. The task-approval admin hatch is still unscoped in one place
**Security · LATENT · `services/task_transitions.py:259`**

    return await is_org_admin(user["user_id"])

The unscoped one-argument form: True for an `org_owner`/`org_admin` in ANY
organisation. `approvals_router.py`'s four sibling WRITE routes were fixed on
2026-08-29 (`007f39ec`); this is the last of the family. Full triage in
`93-D-APPROVALS-CROSS-TENANT-RISK-REPORT.md`.

⚠ Not every remaining unscoped call is a bug — `get_pending_approvals` is
deliberately unscoped and documented, because BOTH its queries require a
`project_assignments` row. Follow that pattern rather than "fixing" it.

## 15. Kray: duplicate approver rows, and budget dates that do nothing
**ACTIVE**

`/approver-candidates` has no DISTINCT over `staging.user_roles` — Unicode
returns **9 rows for 8 people**, so `POSettingsPanel` renders a duplicate React
key and two checkboxes for one human.

Budget `period_start` / `period_end` are captured, stored, returned and **never
used**: `budget_state()` sums every open order regardless of date, and
`BudgetsTab` does not render them. A budget dated FY 2026-27 counts an order
from any year. ⚠ If the period is made to bind, remember: **a budget WARNS, it
must NEVER BLOCK.**

---

## 16. "Seen by" names people who never saw the message
**Correctness · ACTIVE · Sanvaad**

    staging.samvada_read_receipts   0 rows — in the ENTIRE HISTORY of the
                                    database — no writer, no reader.

The feature does not use that table. It is DERIVED from `last_read_at`, and
`add_member` stamps `last_read_at = NOW()` — so **a person added to a channel is
reported as having seen every earlier message in it.** Read live off the screen:
`"Seen by Anaya, Rajesh +2"`.

**A fabricated receipt is worse than no receipt, because somebody acts on it.**
"They've seen it" changes whether a person chases, escalates, or assumes a
decision was noticed.

Three candidate fixes: write real receipts into the table that already exists
and is unused; stop stamping `last_read_at` on `add_member` (cheapest, honest
from now on, repairs nothing); or stop showing "Seen by" until it is real.
⚠ Re-stamping existing rows is a data change and is the owner's.

## 17. "Jump to latest" covers the controls beneath it
**Interaction · ACTIVE · Sanvaad**

`.m2jump` OVERLAYS and intercepts the message controls under it — evidenced from
Playwright's own actionability log. The **mouse path is broken and the keyboard
path works**, which is the shape that survives review: it looks fine, and it is
unusable with the input almost everyone uses.

## 18. There is no way to delete a channel
**ACTIVE or by-design — undecided · Sanvaad**

No DELETE route exists anywhere in the product; archive is the only retirement.
That may be deliberate. **Decide, and record it somewhere durable**, because
this programme's own probe channels cannot be cleaned up and the next person
will re-derive the same question. Suite 13 left 5 named probe channels for
exactly this reason rather than pretending it had swept them.

---

## 19. Applying a project template duplicates every column
**ACTIVE · Core PM**

Verified on `S3 Project 05`: `To Do`, `In Progress`, `In Review`, `Approval` and
`Done` each exist **TWICE, at the SAME `sort_order`** (0,0 / 1,1 / 2,2 / 3,3 /
4,4) — so the board is duplicated AND its ordering is ambiguous. The arithmetic
closes exactly across the org: 4x9 + 3x14 + 1x5 = 83 rows.

Apply is additive server-side: each insert takes a FRESH `col_` primary key, so
its `ON CONFLICT DO NOTHING` can never fire — it guards a key that is new every
time.

⚠ Columns live in `public.project_columns`. NOT `board_columns` — and both
`public.boards` and `public.board_columns` hold **0 rows in the whole
database**, so querying those will suggest there is no problem.

Three defensible fixes: make apply idempotent by name; refuse on a non-empty
board and say so; or merge and renumber. **Whichever is chosen, `sort_order`
must come out unambiguous** — a kanban board's column order is not cosmetic.

## 20. Four active employees are missing from the employee list
**ACTIVE · Manav — found by Suite 16, on Suite 07's ground**

`GET /api/v1/manav/employees` returns **26 of 30** for Unicode Group. Measured:
30 rows carry `status='active'`, and **four have a PAST
`manav_offboarding.last_working_day`**; the four with a FUTURE one are listed.
So the list silently filters on a date in a joined table while the employee's
own row still says active.

**Two of the four hold the org's only usable leave balances — 170 days each —
now unspendable**, because the person cannot be selected on any screen fed by
this list.

Which is wrong is a real decision: the LIST (someone serving notice is still an
employee), or the STATUS (offboarding should have moved it, and something must
do that). ⚠ The payroll leaver flag is DELIBERATE — a leaver is paid part-month
— so a filter change must not quietly alter who a payroll run picks up.

## 21. Niyam — quiet hours cannot work, and five more gaps
**ACTIVE · found by Suite 16, none fixed**

⚠ **§10's quiet-hours clause is unachievable behind TWO walls**, and both are
needed for it to work at all:
1. **The builder has no channel control.** `blankStep()` hardcodes `inapp`, so
   **no authorable rule can ever use push or email** — the only channels
   `send.INTERRUPTING` covers.
2. **There is no deferral.** `deliver` returns `refused`, `run_pipeline` calls
   `_finish`, `wake_at` is NULLed.
The mechanism is real and simply not wired here: a `wait` step DOES defer —
4 slept, 4 woke, 4 ran the step after.

Also open, each walked live:
- **3 of 6 action verbs have NO configuration fields** — `invoice.remind_
  customer`, `task.add_comment`, `task.create` (1 select, 0 inputs each).
- **`@org_admins` is not offerable.** Five live instances each fired, evaluated,
  reached the action step and recorded *"nobody to notify on this event"*.
- 4 of 11 families have no filter chip (esign, marketing, payroll, whatsapp).
- **10 of 10 rule-editor controls have no accessible name**, 5 carrying a DEAD
  `label="…"` attribute — `ui/Field.jsx` spreads the prop onto a bare `<input>`.
  A shared-component cause, so it will not be the last.

## 22. Report email carries no attachment size guard, and a bounce is invisible
**ACTIVE · raised by the owner 2026-08-29**

`email_service.send_report_email` computes
`attachment_bytes = len(pdf_bytes or b"") + len(excel_bytes or b"")` **for the
outbound record only — nothing checks it against any limit.** There is no cap,
no refusal and no degradation path.

That matters because of what sits underneath it: **there is no bounce handling
in this product at all** — no `bounced` status in `outbound_log`
(`queued · sent · suppressed · failed`) and no SNS/webhook endpoint. Confirmed
by grep. So a recipient server answering **552 (message too large)** would
arrive asynchronously **to nobody**, while the row already reads `sent`.

⚠ This is the exact shape that has already burned this product once: **SES
accepted 960 payslips and bounced them seconds later.** Base64 inflates an
attachment by roughly a third, and receiving limits are commonly lower than the
sender's — Gmail around 25 MB, many corporate servers 10 MB.

**So the risk is not the bounce. It is that we would never learn of it.** Any
attachment work must cap the size and refuse or degrade deliberately rather than
send something that can vanish silently.

### 22a. Line length — ASKED, MEASURED, CLOSED, AND GUARDED (2026-08-29)

The owner then raised the OTHER 552, which is a different fault with the same
number: **`552 message line is too long`**, from a colleague's live incident on
another stack where Microsoft 365 rejected every PDF they attached.

RFC 5321 §4.5.3.1.6 caps an SMTP line at 1000 octets including the CRLF. Base64
that is not wrapped is ONE line as long as the encoding — a 90 KB PDF becomes
~123,000 characters. Their Node sender hand-built raw MIME
(`boundary="aws-sdk-js-attachment"`) and pasted `buf.toString("base64")` in with
no wrap.

**We do not have that bug.** Measured on our own senders with a 90 KB payload:

    encoded message   125,170 chars
    total lines         1,643
    base64 body lines   1,617, each exactly 76
    LONGEST LINE           84   (a header, not the payload)

All four attachment sites — `email_service.py` ×2 (PDF and Excel),
`services/employee_email.py`, `services/pdf_email.py` — call
`encoders.encode_base64`, which wraps at 76. It is `set_payload` on the line
before and `encode_base64` on the line after, in all four.

Guarded by `backend/tests/test_pdf_attachments_are_line_wrapped.py` (4 tests):
three drive the REAL senders end to end and measure the exact bytes handed to
`send_raw_email`; the fourth is a contract sweep so the FIFTH sender — P5's
invoice PDF, the reason `services/pdf_email.py` exists at all — cannot arrive
unwrapped.

⚠ **The mutation proof found something the fix did not.** Deleting
`encode_base64` from `services/pdf_email.py`, the **998-character assertion
stayed GREEN** — the raw payload carried a `0x0A` often enough that no single
line breached the limit. Only the "1,600 lines of exactly 76" assertion went
red. **A guard that measured line length alone would have passed over a document
with raw binary in it**, which is a worse fault than the one it was written for.
Both assertions are in the file, and this is why.

**Still open in 22:** the size cap and the invisible bounce. Neither is
addressed by the above.

---

## Also open, from the suites, not separately chipped

- **eSign field placement stores nothing.** `staging.sign_fields` exists
  (migration 114) with **no writer**: the deployed `DocumentCreate` carries no
  `fields` member and **Pydantic v2 drops unknown members silently**, so 24
  placed fields vanish. `CreateTab` detects it and warns rather than lying.
- **eSign signing order is decorative.** `/send` mails every signer at once and
  `submit_signature` has no predecessor check, while the UI renders a numbered
  rail. Proved read-only: both of one document's ordered signers held a live
  invitation before signer 1 signed.
- **An eSign decline does not move the document** — it still reads "Sent" and
  can never complete.
- **The project status report has never worked.** `POST /v1/documents/projects/
  {id}/report/pdf` answers 404 because it looks the project up in
  `public.boards`, which holds **0 rows in the whole database**.
- **`errText` swallows a structured refusal in three more copies** —
  `manav/_shared.jsx:114`, `vetana/_shared.jsx:56`, `prachar/_shared.jsx:268`.
  Fixed in `hub` and `sahayak` on 2026-08-29; the pattern remains elsewhere.
- **Suite 14's ordering defect is in the PLAN, not the code.** Every credit
  top-up route is `require_platform_role`, so the only door is Suite 19 — which
  §14 schedules in wave 6, AFTER Suite 14. Most of Suite 14's volume is
  structurally unreachable in the stated order.

---

## Not in this file, deliberately

**Owner decisions** live in `docs/OWNER-ACTIONS.md` items 21 and 22 — the four
data changes to live rows, and the two feature sets that are NOT BUILT
(`mkt_*` landing pages / tracked links / clicks / referrals, and Prachar
automations). Those are not developer tasks and must not be picked up as if
they were.

**The full orphaned-capability matrix** is
`docs/plans/93-E-ORPHANED-CAPABILITY-SWEEP.md` — 958 operations, 849 reached,
**67 genuinely orphaned**. This file carries only the ones worth acting on first.
