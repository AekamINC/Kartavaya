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

## 5. Other changes I made

(section written as the work lands — see git log on this branch)

### 5.3 `_pii_gate` hardcoded Tier-2 role strings

`manav.py:36` was `require_org_role("org_owner", "org_admin")` — literal role strings in a
router, which is what `role_tiers.py` exists to end. `role_tiers.py` had constants for Tier 1
(platform) and Tier 4 (module levels) but **none for Tier 2 (org)**. Added `ORG_ADMIN_ROLES`
and used it. Nine other call sites across `graha.py`, `org_members.py`, `org_profile.py` and
`pahchan.py` have the same literal strings; those are other agents' files and I left them —
logged in §8.

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
