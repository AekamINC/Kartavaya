# Platform roles — `platform_manager` and `platform_staff`

Owner's decision, 2026-07-26. Extends Tier 1 of `RBAC-SPEC.md`, which had only
`platform_admin`, `platform_support`, `account_finance` and `srijan_admin` and
removed `account_manager` as a duplicate.

These two roles replace `account_manager`, which currently reaches **every module
in every org, silently and with no audit row** — HR records, payroll and
attendance included.

---

## 1 · The roles

### `platform_manager`

Everything **except HR and Payroll**. Aekam staff who run client accounts
end-to-end and need commercial and operational visibility, but have no business
seeing an employee's salary or personnel file.

### `platform_staff`

A narrower working set: the modules Aekam staff actually operate in on a client's
behalf. No finance, no employee data.

Explicitly granted for staff: **Srijan includes creating skills and publishing**,
and **Automations includes creating automations for client orgs** — both are
authoring capabilities, not read-only.

---

## 2 · Module matrix

Module codes are the real ones from `require_module(...)` in `backend/routers/`.

| Module | Code | What it is | `platform_admin` | `platform_manager` | `platform_staff` |
|---|---|---|:--:|:--:|:--:|
| Core PM | — | Tasks, boards, approvals, reports | ✅ | ✅ | ✅ |
| Automations | — | Rules; staff may CREATE for client orgs | ✅ | ✅ | ✅ |
| Graha | `graha` | CRM | ✅ | ✅ | ✅ |
| Vikray | `vikray` | Sales | ✅ | ✅ | ✅ |
| Prachar | `prachar` | Marketing | ✅ | ✅ | ✅ |
| Srijan | `srijan` | AI — incl. create skills, publish | ✅ | ✅ | ✅ |
| Dristi | `dristi` | Analytics | ✅ | ✅ | ✅ |
| Sanvaad | `samvada` | Messaging | ✅ | ✅ | ✅ |
| Ganit | `ganit` | Invoicing / GST | ✅ | ✅ | ❌ |
| Pramaan | `esign` | E-signatures | ✅ | ✅ | ❓ §4.3 |
| Varta | `varta` | WhatsApp | ✅ | ✅ | ❓ §4.3 |
| Pahchan | `pahchan` | Attendance | ✅ | ❓ §4.2 | ❌ |
| **Manav** | `manav` | **HRMS** | ✅ | ❌ | ❌ |
| **Vetana** | `vetana` | **Payroll** | ✅ | ❌ | ❌ |

Manav and Vetana are denied to both, per the decision. They stay reachable only by
the three `platform_admin` accounts.

---

## 3 · Why this is not just a rename

`account_manager` is not merely too broad — it is *invisibly* too broad.
`middleware/subscription.py` lets `platform_admin` and `account_manager` bypass
the module check with a bare `return` and no audit entry, so today there is no
record of an account manager reading a client's payroll.

Both new roles must therefore be enforced at the gate, not in the UI:

- `require_module(code)` gains a **platform allow-list per role**, replacing the
  blanket bypass. A role reaches a module only if the matrix above says so.
- Every platform-role access to another org's data writes an audit row. The
  standing rule (`_IMPLEMENTATION-LEDGER.md` §8) is that support access is never
  silent, and it currently is.
- `require_org_role(...)` passes platform staff unconditionally. That has to
  become role-aware, or `platform_staff` inherits org-admin powers by accident.

Hiding a nav item is not access control. The matrix has to hold at the API.

---

## 4 · Three things I need decided before this is enforced

These are genuinely ambiguous, and each one changes what a real person can see.

### 4.1 · Kasti and Sneha — manager or staff?

The instruction said both: *"Kasti and Sneha will be platform manager"* and then
*"kasti and sneha will be platform staff"*.

They are different: **manager sees Ganit (invoicing and GST), staff does not.**

**Proceeding with `platform_staff`** — it came last and it is the narrower grant,
so if it is wrong it is wrong in the safe direction. Say the word and it becomes
manager.

| | |
|---|---|
| Kasti Pranami | `aekaminc1@gmail.com` |
| Sneha Kshatriya | `aekaminc2@gmail.com` |

### 4.2 · Does `platform_manager` get Pahchan (attendance)?

Strictly, "no HR and Payroll, rest yes" includes it — Pahchan is its own module.

But Pahchan holds **photographs of employees' faces**, twice a day, plus their
locations. It is the most sensitive employee data in the product, and the stated
intent behind excluding Manav and Vetana is clearly *no employee personal data*.

**Proceeding with DENIED for manager**, on the reading that attendance belongs
with HR rather than with commercial operations. Reversing it is one row in the
matrix.

### 4.3 · Does `platform_staff` get Pramaan (e-sign) and Varta (WhatsApp)?

Neither was named. Varta sits beside Sanvaad, which staff do get; Pramaan handles
signed client agreements, which is closer to Ganit.

**Proceeding with DENIED for staff on both** — a role's default should be no.

---

## 5 · The fourth `platform_admin`

`RBAC-SPEC.md` names exactly three: `bhoomi@aekaminc.com`, `sid@aekaminc.com`,
`kevalvshah03@gmail.com`. There are currently four.

`admin@aekaminc.com` (Keval Shah) holds `platform_admin` **and** `org_owner` of
Aekam Inc with 37 team memberships. It is not on the spec's list. Either the list
is stale or that account should drop to `org_owner` only.

Not changing it without a decision — removing god mode from an account that owns
the primary org is the single most disruptive thing in this document.

---

## 6 · Rollback

`RBAC-ROLLBACK.md`, and the data snapshot at
`.backups/user_roles_restore_2026-07-26.sql`.

Production cannot be affected: `main` has no RBAC middleware and its login never
reads `staging.user_roles`. Verified against the branch, not assumed.
