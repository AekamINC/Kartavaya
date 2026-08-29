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

## 1. Cron-minted invoices are born `final` and skip the Rule 46 gate
**Statutory · ACTIVE · `client_billing.sweep_client_auto_invoices`**

The sweep INSERTs into `staging.ganit_invoices` without naming `doc_status`,
which DEFAULTS to `'final'`. So every invoice automatic billing mints is born
final and never passes `_refuse_final_if_incomplete` — the Rule 46 completeness
gate every manually-issued invoice must clear. It is created unattended.

The gate's own refusal text is *"Nothing has been invented to fill the gap."*
An invoice reaching `final` without passing it is precisely the document the
gate was written to prevent.

**Decision needed:** run the gate before the sweep writes (and decide what
happens to a row that FAILS it), or write `draft` and leave issuing to a person.

## 2. Converted invoices store a blank `place_of_supply`, and GSTR-1 reads it
**Statutory · ACTIVE · `vikray.generate_invoice_from_order`**

The INSERT hardcodes `''` for `place_of_supply`. `services/gstr1_json.py` reads
that exact column via `parse_state_code(row["place_of_supply"])`. Place of
supply decides CGST/SGST vs IGST on a GST return.

The order already knows the answer — it carries `is_igst`, and the org's
`state_code` became settable on 2026-08-29.

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
