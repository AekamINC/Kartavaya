# verify/hr-payroll-self-scope — verification of the salvaged HR/payroll self-scoping work

Branch: `verify/hr-payroll-self-scope`, started from `salvage/hr-payroll-self-scope` (`1819127`),
which itself sits on `staging` (`2a2a27b`). The salvage commit had never been run by anything.

Written incrementally. Each section is appended when the finding is confirmed, not at the end.

---

## 1. What the salvaged commit actually contains

`git diff 2a2a27b 1819127 --stat`

```
 backend/middleware/role_tiers.py | 185 ++++++++++++++++++
 backend/routers/manav.py         | 412 ++++++++++++++++++++++++++++++---------
 backend/routers/vetana.py        | 255 +++++++++++++++---------
 3 files changed, 666 insertions(+), 186 deletions(-)
```

`role_tiers.py` is **purely additive** — the diff starts at the end of the existing file
(`@@ -277,3 +277,188 @@`) and nothing above that line is touched. Three new things:

| Symbol | What it does |
| --- | --- |
| `any_level_satisfies(held, required, module)` | Set-valued `level_satisfies`. Empty/None set → `False`. |
| `held_module_levels(user_id, org_id, module)` | Unions three sources into a level set: a platform role that `can_reach_module` → `admin`; `org_owner`/`org_admin` → `admin`; every row in `staging.org_member_modules` → whatever `role` says. |
| `require_module_or_self(module)` | FastAPI dependency **whose value is the level set**. A caller with no grant is admitted with `frozenset()` = self scope, after checking subscription status and module activation. Raises `ValueError` at import time for a module not in `SELF_SCOPED_MODULES`. |

`manav.py` and `vetana.py` then swap `_g=Depends(_gate)` for `levels=Depends(_gate)` on every
route and add explicit `_require(levels, LEVEL)` calls.

---

## 2. Baseline: the salvaged commit does not pass its own suite

First thing I ran, before changing anything:

```
python -m pytest tests/ -q
20 failed, 223 passed, 23 errors
```

- **23 errors, all in `tests/test_vetana_security.py`** — every one is
  `AttributeError: module 'routers.vetana' has no attribute 'is_org_admin'`.
  The salvage commit deleted `_is_payroll_admin`/`_require_payroll_admin` and dropped the
  `is_org_admin` import; the suite's `not_payroll_admin` / `is_payroll_admin` fixtures
  monkeypatch `routers.vetana.is_org_admin` and now fail at *setup*. So those 23 assertions
  were not merely failing — they were **not running at all**.
- **20 failures in `tests/test_manav.py`** — that suite's autouse fixture overrides `_gate`
  with `lambda: None`, which under the new model means "no grant" = self scope, so every
  admin-level route correctly returns 403 where the test expects 200. Two more fail with
  `KeyError: 'user_id'` because `get_employee` now reads `row["user_id"]` and the fixture rows
  do not carry that column.

Neither is a defect in the production code — both suites are written against the *old* model.
They have to be ported, and porting them is where the real assertions get made. Recorded here
because "the salvage branch was never verified" is now a measured fact, not a presumption.

---

## 3. Claims from the brief: HELD / STALE

### Claim: "a module *viewer* could read any colleague's Aadhaar number and bank account"

**STALE as stated — already fixed on `staging` before this branch existed.**

`backend/routers/manav.py` at the *base* commit `2a2a27b` already carried `_EMP_SAFE_COLS`,
`_SENSITIVE_COLS`, `_mask_employee_pii()` and the separate `/employees/{id}/sensitive`
endpoint behind `_pii_gate`. None of those appear as additions in the salvage diff, which is
the proof they pre-date it. `GET /employees/{id}` has been returning
`aadhaar` grouped-masked to the last 4, `pan` masked to the last 4 and `bank_details` through
`mask_bank()` since before this work started.

**What *was* still true and *is* fixed by this branch**: a module viewer could still read the
*existence, masked identifiers and full non-PII personnel record* of every colleague — name,
personal email, phone, DOB, address, emergency contact, UAN, ESI number. `get_employee` now
404s a colleague's row for a caller with no grant. That is the genuine delta.

### Claim: "`admin` does NOT satisfy `approver` in vetana/ganit"

**HELD, and correctly implemented.** `role_tiers.level_satisfies` short-circuits:

```python
if module_code in SEPARATED_DUTY_MODULES and required == APPROVER:
    return held == APPROVER
```

`vetana.py` routes it through `any_level_satisfies` at every call site and never compares
levels by index locally. I re-read every `_require(` in `vetana.py`: `APPROVER` is demanded by
`approve_run`, `revert_run` and `disburse_payslip`, and nothing in the file reduces a set to a
"strongest" level, which would have destroyed the separation. Test added — see §6.

### Claim: `role_tiers.py` is the only place roles are defined

**HELD for the diff.** The salvage commit introduces **zero** new hardcoded role strings, and
`vetana.py` is now completely free of them — it dropped `is_org_admin` entirely. Verified with
`grep -n "platform_admin\|platform_owner\|org_admin\|org_owner\|account_manager\|platform_manager\|platform_staff" routers/manav.py routers/vetana.py`;
the only hits in `vetana.py` are prose in a comment and one audit *label* string.

**One pre-existing exception in `manav.py`**, which I fixed — see §5.3.

---

## 4. Defects I found in the salvaged diff (real, re-read, fixed on this branch)

### 4.1 `GET /employees/{employee_id}/assets` lost its guard — WIDENING

`backend/routers/manav.py`, `employee_assets`. The diff changed `_g=Depends(_gate)` to
`levels=Depends(_gate)` and added **no** `_require` and **no** self-scope filter.

- Before: `_gate` was `require_module("manav")`, so the caller needed an `org_member_modules`
  row, or `org_owner`/`org_admin`, or god mode.
- After the salvage commit: `_gate` admits any employee with no grant at all, so **any**
  employee could read **any** colleague's issued equipment by putting their employee id in the
  path — while every other asset route in the file requires `VIEWER` precisely because the rows
  name the employee they are issued to.

Fixed: own kit at self scope, anyone else's needs `VIEWER`.

### 4.2 `POST /swaps` lost its guard, and never validated the schedule — WIDENING + cross-tenant

`backend/routers/manav.py`, `create_swap`. Same `_g` → `levels` change with no `_require`.
`requester_schedule_id` and `target_employee_id` were taken straight from the body and inserted
with no check that either belongs to the caller *or to this org*.

Two consequences, the second pre-existing but newly reachable by everyone:

1. Any employee could offer away **any colleague's** shift.
2. A `requester_schedule_id` from **another tenant** could be attached to a row in this org.
   `GET /swaps` joins `manav_swap_requests → manav_schedules → manav_employees` and selects
   `e1.name`, so the foreign tenant's employee name would be printed to this org's viewers.

Fixed: the schedule must exist in this org; if it is not the caller's own, `EDITOR` is
required; `target_employee_id`, when given, must be an employee of this org.

---

### 4.3 A `viewer` grant on Vetana was opening the whole payroll register — SPEC VIOLATION

The single most consequential thing in the diff, and the reason to read the spec before
trusting a comment.

The salvaged commit set **all nine** read checks in `vetana.py` to `VIEWER`, with a comment
arguing that a grant must mean more than no grant:

> Reading it is what a Vetana grant is FOR, so `viewer` is the right bar now that a grant
> carries a level

`design-reference/Kartavaya Redesign/RBAC-SPEC.md` had already answered that, twice:

> `Vetana (Payroll) ⚠️ | Viewer: **View own payslips**`
>
> **Viewer on Vetana is scoped to self**, not to the org. It is the only module where viewer
> means "my own record".

So a `viewer` grant was reaching every colleague's gross, net, PAN and account number, the
org's whole salary bill, the statutory register, and every salary structure and loan. All nine
moved to `EDITOR` — "prepare payroll runs" in the same matrix, which is the level that has to
read the register to do its job.

**Nobody loses access.** The pre-salvage bar on these was `is_org_admin`, i.e. org_owner /
org_admin / platform staff. `org_owner` and `org_admin` resolve to `admin`, and Vetana's
separation only refuses admin at the `APPROVER` rung — `level_satisfies(admin, editor,
"vetana")` falls through to the ordinary ladder and is True. Asserted directly rather than
reasoned about (`test_org_wide_reads_still_admit_an_org_admin`).

**One thing I asserted wrongly and the code had right.** My first version of the test claimed
`approver` alone must not reach the register. It does, and it should: RBAC-SPEC defines the
rung as "`approver` — everything editor can, plus approve/reject workflows", and an approver
who cannot see the run they are approving is useless. The separation is one-directional —
admin must not climb *up* to approver — and the over-correction of making the two rungs
mutually exclusive is the more tempting mistake. The test now says so explicitly.

---

## 5. Other changes I made

### 5.1 `held_module_levels` no longer 500s when `org_member_modules.role` is absent

See §8.1 for why this matters. Wrapped in `except asyncpg.UndefinedColumnError`, degrading to
"a grant row exists, at `DEFAULT_GRANT_LEVEL`" — which is exactly the value PROPOSED_066 gives
the column (`DEFAULT 'viewer'`), so behaviour does not change on the day the migration lands.
Not a bypass: org_owner/org_admin and god mode reach `admin` through two other queries that
never touch that column.

### 5.2 Two test-harness defects that made the suite fail as a function of its own size

Both pre-existing, both in `backend/tests/conftest.py`, both found by adding tests:

- **`server._write_rate_buckets`** is a module-level dict allowing 120 mutating requests per
  minute per client IP. Every test in the session shares one key, because they all come from
  the same fake ASGI client — so the real limit is "120 POST/PATCH/DELETEs per suite per
  wall-clock minute", and the 121st test to mutate anything gets a 429 regardless of what it
  was asserting. Adding my tests 429'd four tests in `test_whatsapp_security.py` and one in
  `test_vetana_security.py`, all of the form `assert 429 == <the real expectation>`. Now
  cleared per test by an autouse fixture.
- **The acquired-connection mock had no awaitable `fetchval`/`fetchrow`.** `make_pool()` gave
  `conn_mock` an AsyncMock `execute` and `fetch` but left the other two as bare MagicMocks, so
  anything doing `async with pool.acquire()` and then awaiting one of them died on
  `TypeError: 'MagicMock' object can't be awaited`. That is `utils.next_doc_number`, which
  every invoice and payslip number goes through, and it was failing
  `test_ganit.py::test_create_invoice_success` on staging before this branch existed —
  confirmed by stashing my work and re-running.

### 5.3 `_pii_gate` hardcoded Tier-2 role strings

`manav.py:36` was `require_org_role("org_owner", "org_admin")` — literal role strings in a
router, which is what `role_tiers.py` exists to end. `role_tiers.py` had constants for Tier 1
(platform) and Tier 4 (module levels) but **none for Tier 2 (org)**. Added `ORG_ADMIN_ROLES`
and used it. Nine other call sites across `graha.py`, `org_members.py`, `org_profile.py` and
`pahchan.py` have the same literal strings; those are other agents' files and I left them —
logged in §8.

---

## 6. Tests written

`backend/tests/test_vetana_security.py` — rewritten (23 → 49 tests) and
`backend/tests/test_manav.py` — extended (32 → 63 tests). Both now declare what the caller
HOLDS by overriding the one dependency whose value is the level set, which is how the model is
meant to be tested; neither monkeypatches a role helper any more.

The three the brief asked for, by name:

| Asked for | Test |
| --- | --- |
| (a) a module viewer CANNOT read a colleague's Aadhaar or bank details | `test_viewer_cannot_read_a_colleagues_aadhaar_or_bank_details` — asserts the raw Aadhaar, PAN and account number appear nowhere in the serialized body, not merely that the parsed field differs. Plus `test_viewer_cannot_reach_the_unmasked_endpoint_at_all`, which satisfies the org-role gate and shows the module level still refuses `/sensitive`. |
| (b) the same viewer CAN read their own | `test_viewer_can_read_their_own_record`, and `test_own_record_is_readable_with_no_grant_at_all` for the stronger self-scope promise. `test_own_record_is_masked_too` pins that reading your own row is not a way to read your own Aadhaar back out of the database. |
| (c) admin does not satisfy approver in vetana | `test_admin_does_not_satisfy_approver_in_vetana`, parametrized over approve / revert / disburse. Its converse `test_an_explicit_approver_grant_does_reach_them` is parametrized over the same three, so the separation cannot be "satisfied" by refusing everybody. `test_holding_both_levels_is_allowed` covers the owner's "one user can have both FYI but auditable". |

Also added: `test_manav_is_hierarchical_so_admin_does_approve`, so that adding Manav to
`SEPARATED_DUTY_MODULES` becomes a visible decision rather than a silent behaviour change.

**Result: 323 passed, 0 failed.** Both gates green — `check-tokens: 279 declared, 229
referenced, 0 missing`; `check-classes: 2096 selectors defined, 1416 classes used, 0 missing a
rule`.

---

## 7. Before / after reachability

`_gate` changed from `require_module("manav"|"vetana")` to `require_module_or_self(...)`, so
the **column headings differ by design**:

- **Before** — "module member" = a row in `org_member_modules`, or org_owner/org_admin, or a
  platform role `can_reach_module` admits (for HR: god mode only, audited).
- **After** — a *level set*. No grant = `∅` (self scope). org_owner/org_admin and god mode
  resolve to `{admin}`. A grant row contributes whatever level it names.

### Vetana

| Endpoint | Before | After | Verdict |
| --- | --- | --- | --- |
| `GET /payslips` | own only unless org admin | own only unless `editor` | same set. Intended |
| `GET /payslips/{id}` | own, else org admin | own, else `editor` | same set |
| `GET /payslips/{id}/pdf` | own free; else org admin | own free; else `admin` | **narrowed** — an unmasked identity document is now above reading a figure. Org admins keep it (`admin`) |
| `GET /salary-structures`, `/{id}` | own only unless org admin | own only unless `editor` | same set |
| `POST/PATCH/DELETE /salary-structures` | org admin | `admin` | same set + module-admin grantees. Intended |
| `POST /payroll/process` | org admin | `admin` | same + grantees |
| `GET /payroll/runs`, `/runs/{id}` | org admin | `editor` | same + grantees at editor/approver |
| **`PATCH /runs/{id}/approve`** | **org admin** | **`approver` only** | **DELIBERATE LOCKOUT.** An org_owner or org_admin who could approve payroll yesterday cannot today. That is the entire point of `SEPARATED_DUTY_MODULES` and the owner's "admin cannot approve a payroll run". **Every org needs one explicit `approver` grant on vetana or payroll cannot be released.** |
| **`PATCH /runs/{id}/revert`** | org admin | `approver` only | same deliberate lockout — reverting un-does an approval |
| **`PATCH /payslips/{id}/disburse`** | org admin | `approver` only | same deliberate lockout — this is the release of money |
| `GET /dashboard`, `/statutory-summary` | org admin | `editor` | same + grantees |
| `GET /loans` | own only unless org admin | own only unless `editor` | same set |
| `POST/PATCH /loans` | org admin | `admin` | same + grantees |

### Manav

| Endpoint | Before | After | Verdict |
| --- | --- | --- | --- |
| `GET /employees` | any module member → whole directory | `viewer` → directory; no grant → own row only | **narrowed.** Matches RBAC-SPEC's "Manav Viewer: view org chart, own profile" |
| `GET /employees/{id}` | any module member, masked | `viewer`, masked; own row at any level | **narrowed** |
| `GET /employees/{id}/sensitive` | org owner/admin + audit | org owner/admin **and** `admin` + audit | **narrowed** (see §8.2 — `platform_owner` is caught by a pre-existing bug here) |
| `POST/PATCH/DELETE /employees`, `/hire` | any module member | `admin` | **narrowed**. A personnel file carries the identity kit |
| `GET/POST /departments`, `/leave-types`, `/holidays`, `/shifts` (writes) | any module member | `admin` | narrowed |
| `GET /leave-types`, `/holidays`, `/announcements`, `/shifts`, `/shift-bids` | any module member | **self scope** | **widened** — reference data naming nobody. An employee cannot request leave without the types and the calendar |
| `POST /attendance`, `/schedules`, `/schedules/bulk`, `/shift-bids`, `/shift-bids/{}/accept`, announcements, job openings, candidates, assets | any module member | `editor` | narrowed |
| `PATCH /leaves/{id}/action`, `/swaps/{id}` | any module member | `approver` (admin satisfies — Manav is hierarchical) | narrowed |
| `GET /attendance`, `/attendance/summary`, `/leaves`, `/schedules`, `/availability` | any module member → everyone's | `viewer` → everyone's; no grant → own only, and asking for a colleague's id is a 403 not a silent empty list | narrowed |
| `POST /leaves`, `/availability`, `/shift-bids/{}/apply`, `/expense-claims` | any module member | **self scope**, employee id resolved from the caller and never from the body | widened, deliberately — submitting your own leave request has never been an HR permission |
| `POST /leaves` **for someone else** | `user.role=="admin"` OR org admin | `editor` | **narrowed** — the legacy JWT-claim prefix is gone |
| `GET /employees/{id}/assets` | any module member | own at self scope, else `viewer` | **fixed by me** — the diff left it with no check at all (§4.1) |
| `POST /swaps` | any module member, no validation | own schedule at self scope, else `editor`; schedule and target must be in this org | **fixed by me** (§4.2) |
| `GET/PATCH /expense-claims/*` | `is_org_admin` | `is_org_admin`, unchanged | **not migrated.** See §9 |

---

## 8. Findings that belong to other agents' files

### 8.1 BLOCKER — `staging.org_member_modules.role` does not exist in any applied migration

`held_module_levels` runs `SELECT role FROM staging.org_member_modules`. The column is added
only by `PROPOSED_065` / `PROPOSED_066`, and `PROPOSED_*` files are by definition unapplied.
The highest applied migration in `backend/migrations/` is `061_org_max_users.sql`.

This is **not introduced by this branch** — `backend/routers/org_members.py`, already merged to
`staging` in `95916b1`, does `SELECT module_code, role FROM staging.org_member_modules` and
`INSERT ... (user_id, org_id, module_code, role, granted_by)`. If the column is genuinely
absent, that endpoint is already broken on staging today. But this branch widens the blast
radius from "adding an org member" to "every Manav and Vetana request", because
`held_module_levels` runs on all of them.

Mitigation applied on this branch — see §5. I cannot verify the live schema: the standing rule
for this repo is read-only DB inspection and I did not have a session to use.

### 8.2 `require_org_role` in `middleware/roles.py` locks out `platform_owner`

`backend/middleware/roles.py`, `require_org_role._check`, hardcodes
`AND role_code = 'platform_admin'` for its platform bypass. `role_tiers.GOD_MODE_ROLES` is
`("platform_owner", "platform_admin")`, and `role_tiers.py`'s own docstring names this exact
failure mode:

> `require_platform_role("platform_admin")` locks out `platform_owner`. […] It becomes a total
> lockout […] on the day those rows are renamed.

Consequence on my surface: after this branch, `GET /employees/{id}/sensitive` requires **both**
`_pii_gate` and module `ADMIN`. A `platform_owner` gets `ADMIN` from `held_module_levels`
(via `can_reach_module`, which honours both spellings) but is refused by `_pii_gate`. So the
unmasked-Aadhaar endpoint is unreachable for `platform_owner` and reachable for
`platform_admin` — the two halves of god mode disagree. Same for `pahchan.py`'s `_review_gate`.

`middleware/roles.py` is not in my assigned file set and is imported by most of the router
tree, so I did not edit it. One-line fix: `role_code = ANY($2::text[])` with
`list(GOD_MODE_ROLES)`.

### 8.3 Tier-2 role strings are still written out by hand in nine other places

`graha.py` ×2, `org_members.py` ×6, `org_profile.py` ×1, `pahchan.py` ×1. `role_tiers.py` now
has `ORG_ADMIN_ROLES` for them; I only converted the one in my own file. Note `graha.py` uses
`require_org_role("org_admin")` **without `org_owner`**, which locks the owner of an
organisation out of two Graha routes — worth a look by whoever owns that file.

---

## 9. What I did not finish

### 9.1 Manav's expense claims were never migrated to the level model

`list_expense_claims`, `approve_expense_claim` and `reject_expense_claim` in `manav.py` still
gate on `_is_org_admin`. The salvaged commit renamed their `_g` parameter to `levels` and then
did not use it. Consequences, both pre-existing and both unchanged by this branch:

- An HR person holding a Manav `admin` **grant** but not an org role cannot approve an expense
  claim, and sees only their own claims in the list.
- RBAC-SPEC puts expenses at the approver rung ("Manav Approver: approve leave, **expenses**"),
  so the correct bar is `_require(levels, APPROVER)`, matching `action_leave_request`.

I left it because changing it moves who can approve money in a module I was asked to verify
rather than redesign, and because the org-role check is strictly the *safer* of the two while
the question is open. It should be `APPROVER`.

### 9.2 The payslip PDF does not match its specification

`design-reference/Kartavaya Redesign/docs/Payslip.html` is the specification for this document.
`backend/services/payslip_pdf.py` (283 lines) renders a substantially simpler payslip. Missing
from the **renderer**, all present in the spec:

| Spec element | Status |
| --- | --- |
| "Joined 14 Mar 2023" in the employee block | data now supplied by me; **not rendered** |
| "ESI 3101234567" in the statutory block | data now supplied by me; **not rendered** |
| Leave-balance table (Type / Opening / Taken / Balance) | data now supplied by me; **not rendered** |
| "HDFC Bank · A/c ending 4417" | `bank_account_last4` now supplied by me; renderer still prints the **full account number** |
| "PF A/c MH/BAN/12345/0042" | **no column exists** on `manav_employees` |
| "UTR HDFCN52026073118420" | **no column exists** on `vetana_payslips` |
| "Net pay in words — Rupees one lakh…" | not implemented |
| "Pay date 31 Jul 2026", "Payable days 31 of 31", "Mode Bank transfer" | `present_days`/`working_days` exist; pay date and mode not supplied |
| Location on the designation line ("Manager — Finance · Mumbai") | not supplied |
| Bilingual "Payslip / वेतन पर्ची" and "Generated by कर्तव्य Kartavaya" | not implemented |

What I did: `GET /payslips/{id}/pdf` now selects `date_of_joining` and `esi_number` (both
already exist on `staging.manav_employees` — they are in manav's `_EMP_SAFE_COLS`), joins
`manav_leave_balances` for the leave table, and supplies `bank_account_last4`. Proven by
`test_payslip_pdf_payload_carries_the_specified_employee_fields`, which captures the dict
handed to the renderer. So the data layer is ready and the renderer rewrite is unblocked.

What I did **not** do: rewrite `services/payslip_pdf.py` to match the document, or propose the
migration for PF account number and UTR. That is a self-contained piece of work on a file
outside my set, and doing it badly on a statutory document is worse than not doing it.

### 9.3 I could not verify the live schema

Standing rule for this repo is read-only DB inspection; I had no session, so §8.1 rests on
reading `backend/migrations/` rather than on `information_schema`. Whoever can query should
check `staging.org_member_modules` for a `role` column before this deploys.

---

## 10. Spec defects and divergences found

Added to the list in `design-handover/_SOURCE-MAP.md` rather than acted on unilaterally.

1. **RBAC-SPEC: "Sensitive modules are role-derived, not granted. Vetana, Ganit and Manav have
   no per-member grant row at all […] a grant row naming a sensitive module is invalid input
   and must be rejected."** — Superseded. `role_tiers.SELF_SCOPED_MODULES` (owner's decision,
   2026-07-26, one day later) presupposes grants on vetana and manav, and `PROPOSED_066`
   explicitly drops `PROPOSED_065`'s `org_member_modules_not_sensitive` constraint that would
   have enforced the spec's rule. The code is deliberately newer than the spec here.
2. **RBAC-SPEC: "Default level on a new grant (non-sensitive only): `admin`."** — Contradicted
   in `role_tiers.py` on purpose, with the reasoning written down: a default of admin means
   every grant is full control and the four levels never get used. `DEFAULT_GRANT_LEVEL` is
   `viewer`. Code wins, already documented.
3. **RBAC-SPEC denied-states rule 2: "Field-level: send the column as *absent* with a plain
   reason. Never a `••••` mask — a mask confirms the value exists and invites a screenshot."**
   — **Directly contradicted by shipped code.** `manav._mask_employee_pii` and
   `vetana._mask_payslip_row` both emit `••••` masks, and there are tests on `staging` asserting
   they do. This is a real unresolved conflict on the exact surface I was asked to verify, and
   it needs an owner's call: the mask is currently load-bearing for the HR UI ("last four
   survive so HR can confirm which document is on file"), so switching to absent columns is a
   product decision, not a refactor. **I did not change it.**
4. **`Payslip.html` prints only the last four of the bank account** ("A/c ending 4417") while
   `vetana.py`'s comment claims "the PDF is the one place full PAN, UAN and account number
   still appear". The spec is stricter than the code believes it is. PAN, UAN, ESI and PF
   number *are* shown in full on the spec's payslip; the account number is not.

