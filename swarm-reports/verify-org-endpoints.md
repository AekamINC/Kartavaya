# verify/org-endpoints — salvage verification report

Branch: `verify/org-endpoints` (from `salvage/org-endpoints` @ 43167f2, based on staging @ 2a2a27b)
Written incrementally. Each section was appended when the evidence was in hand.

---

## 1. FINAL MIGRATION NUMBERING — other agents need this

**This branch now owns 068, 069, 070.** Do not reuse them.

| Was (on salvage/org-endpoints) | Is now |
|---|---|
| `PROPOSED_067_org_profile_fields.sql` | `PROPOSED_068_org_profile_fields.sql` |
| `PROPOSED_068_org_security.sql` | `PROPOSED_069_org_security.sql` |
| `PROPOSED_069_sanvaad_spelling.sql` | `PROPOSED_070_sanvaad_spelling.sql` |

### Why, and the survey behind it

`feat/me-account-self-service` (local+remote, 4f15485) had already published a
**different** `PROPOSED_067_account_self_service.sql`. Two files claiming 067 means
whoever applies migrations in numeric order silently applies one and skips the other.

I surveyed `backend/migrations/` on **every** ref, not just the obvious ones —
all 12 remote branches and all 57 local branches, deduped to 9 distinct commits:

| Ref / commit | Highest PROPOSED |
|---|---|
| `origin/staging`, `origin/main` | 066 (main has none) |
| `feat/me-account-self-service` 4f15485 | **067_account_self_service** |
| `salvage/backend-tests` 5f7e3cf | 066 |
| `salvage/boards-toolbar` 5e073b1 | 066 |
| `salvage/dark-tokens-strobe` cba34d2 | 066 |
| `salvage/hr-payroll-self-scope` 1819127 | 066 |
| `fix/attachment-cost-leaks…` 611e982 | 066 |
| `feat/templates`, both `claude/*` | none |
| 294e9e2, 1aa4985 (main lineage) | none |

Highest in use anywhere = **067**. Next free = **068, 069, 070**.

### The trap, and how it was avoided

A naive rename in file order destroys data: `067→068` overwrites this branch's own
`068_org_security`, and `068→069` then overwrites its own `069_sanvaad_spelling`.
Two of three files would be lost with `git mv` reporting success.

Renamed **highest-first** (069→070, then 068→069, then 067→068) so every rename lands
on a slot that is already free. `git status` confirmed three pure `R` renames with zero
content modification.

### Self-references repointed (11 total)

Grepped for the old filenames in SQL *and* Python before renaming, per brief:

- `backend/routers/org_profile.py` — 4 refs to `PROPOSED_067_org_profile_fields.sql` (incl. a runtime 503 message body) → 068
- `backend/routers/org_security.py` — 3 refs (2 in runtime 503 bodies) → 069
- `backend/routers/org_modules.py` — 2 refs to `PROPOSED_069` → 070
- `backend/routers/admin_orgs.py` — 1 ref → 070
- `backend/migrations/PROPOSED_069_org_security.sql:115` — internal "ENFORCEMENT note in 068" → 069

Three of these are strings a user actually sees in a 503 response. A 503 naming a
migration filename that does not exist is worse than no message.

Note: a pre-existing oddity I did **not** touch — `PROPOSED_056_task_comment_client_visibility.sql`
collides with applied `056_publish_platforms_expansion.sql`. Also 054 and 062 are absent.
Both predate this branch.

---

## 2. Router registration — CLAIM HELD, and it was the worst defect on the branch

**`org_modules.py` and `org_security.py` were dead code.** 1,036 lines of router
never imported and never included. `grep -n "org_modules\|org_security" backend/server.py`
returned nothing at 43167f2. `org_profile.py` and `admin_orgs.py` were already wired
(lines 69/82 import, 2775/2788 include), so the two MODIFIED files were live and the
two NEW files were not — consistent with an agent killed partway through.

Fixed: added the two imports next to `org_profile`, and the two `include_router` calls
in the same relative position.

Verified by building the real app and resolving its OpenAPI spec, not by reading the
diff:

```
/api/v1/org/modules  ['get', 'patch']
/api/v1/org/profile  ['get', 'patch']
/api/v1/org/security ['get', 'patch']
```

All three pairs resolve. Before the fix only `/api/v1/org/profile` did.

## 3. Guards — CLAIM PARTIALLY STALE as worded

Brief: "Are they guarded through `role_tiers.py`? No router may hardcode a role string."

- **No new router hardcodes a PLATFORM role string.** That is the rule `role_tiers.py`
  exists to enforce (its docstring: 84 hardcoded strings across five modules). Held.
  `platform_admin` appears in these files only inside docstrings.
- **Org-tier roles are a different matter and the wording does not fit.**
  `role_tiers.py` covers Tier 1 (platform roles) and Tier 4 (module levels). It exports
  **no** org-tier constant — there is no `ORG_ADMIN_ROLES`. The house convention is
  `require_org_role("org_admin", "org_owner")` with literals at the call site, used
  identically in `org_members.py` (6 sites), `manav.py`, `pahchan.py`, `graha.py`.
  The new routers match it exactly. Routing these through `role_tiers.py` would mean
  inventing a Tier-2 constant and changing 15 existing call sites — out of scope here,
  and noted below as work for whoever owns `middleware/roles.py`.

`org_modules.py` does import from `role_tiers` (`ALL_MODULES`, `SENSITIVE_MODULES`).
`org_security.py` does not import it and does not need to — it holds no module logic.

## 4. Backend suite

`python -m pytest -q` in `backend/`: **265 passed, 1 failed**.

The failure is `tests/test_ganit.py::test_create_invoice_success — TypeError: 'MagicMock'`.
**Pre-existing, not mine.** Verified by `git stash`-ing my `server.py` change and
re-running the single test: it fails identically without it. Belongs to whoever owns
`routers/ganit.py` / the invoice fixtures.

## 5. The `sanvaad` / `samvada` split — CLAIM HELD, and worse than described

### What the brief said, and what is actually true

Every part of the brief's description **held**, verified independently against the live DB:

| Source | Spelling | Evidence |
|---|---|---|
| `staging.module_subscriptions` | `sanvaad` | `GROUP BY module_code` → 10 codes; `sanvaad` present, `samvada` absent |
| `staging.org_member_modules` | — | **table is EMPTY, 0 rows** |
| CHECK `org_member_modules_level_is_meaningful` | `samvada` | `pg_get_constraintdef` |
| `role_tiers.py` | `samvada` x4 | lines 64, 71, 209, 228 |
| `navConfig.js`, `moduleColors.js` | `sanvaad` | grep |
| **design reference `SetOrg.jsx`:229** | **`sanvaad`** | keyed on `m.code` |

**The design reference settles it.** In `design-reference/Kartavaya Redesign/`, every
occurrence of `samvada` is a TABLE name (`samvada_channels`, `samvada_messages`, ...).
The module CODE is `sanvaad` — `SetOrg.jsx:229` maps `m.code` through
`{ ..., esign: 'sign', sanvaad: 'chat' }`. Spec, live data and nav all agree on `sanvaad`.

### The brief UNDERSTATED the severity — this was a total outage of the module

`middleware/subscription.require_module(code)` uses the **same single string** for both
lookups:

- grant: `SELECT 1 FROM staging.org_member_modules WHERE ... module_code=$3`
- entitlement: `SELECT 1 FROM staging.module_subscriptions WHERE ... module_code=$2 AND is_active=TRUE`

`messaging.py:21` called `require_module("samvada")`. The entitlement query therefore
searched for a code that table has **never held**, and the org-role short-circuit
(`org_owner`/`org_admin`) skips only the GRANT check — it falls through to the
entitlement check regardless. `samvada` is not in `BUNDLED_MODULES` either, so nothing
short-circuited it.

**Net effect: every Sanvaad endpoint returned `403 "Module 'samvada' is not active"` to
every user in every org, including org_owner, no matter what anyone was subscribed to.**
The module could not be switched on, because the code being switched on was not the code
being checked.

Renaming only `role_tiers.py` — the literal instruction in the brief — would NOT have
fixed this, and would have made it worse: `samvada` would have dropped out of
`ALL_MODULES` while `messaging.py` still gated on it, so `can_reach_module()` would
additionally return False for every platform role. The fix has to include the gate.

### The disproved claim — a spec defect in the salvaged migration

`PROPOSED_070` (as salvaged) asserted:

> "Apply the code FIRST and the SQL second -> for the gap, a grant naming `sanvaad`
> violates the OLD CHECK and returns 500. Worse."

**That is false.** The constraint is a PROHIBITION, not a whitelist — it forbids
`approver` on five named modules; it does not restrict `module_code` to a list. A row it
does not name passes it. Verified by evaluating the live constraint expression against
candidate rows rather than by reading it:

| module_code | role | passes OLD | passes NEW |
|---|---|---|---|
| `sanvaad` | approver | **TRUE** | FALSE |
| `samvada` | approver | FALSE | TRUE |
| `sanvaad` | admin | TRUE | TRUE |
| `kartavya` | viewer | FALSE | FALSE |

Neither ordering can produce a violation or a 500. The orders differ only in which
spelling temporarily loses its *database backstop* for the "no approver on messaging"
rule — which `valid_levels_for` enforces in the application layer either way, over an
empty table. Code-first is therefore safe, which is what let me ship the code half now.
I rewrote that risk section in the file with the measurement.

I also recorded a dependency the salvaged file missed: **`PROPOSED_066` section 1 is what
created this CHECK, is already applied, and still spells it `samvada`.** Re-running 066
after 070 silently reverts the constraint. Noted in 070.

### What changed (code side — authorised by the brief, no schema touched)

Backend: `role_tiers.py` (4 sets + comment), `messaging.py` (**the gate**, + OpenAPI tag),
`search.py` (`_ENTITY_MODULE["messages"]`), `admin_orgs.py`, `org_modules.py`,
`tests/test_messaging_security.py`.
Frontend: `catalogue.js`, `levels.js`, `TabModules.jsx`, `AdminOrgsPage.jsx`.

**NOT changed, deliberately:** `staging.samvada_*` — the six applied messaging tables,
named as such in the design reference. A table name is not a module code.

### The workarounds — FOUR, not three, and all four are gone

The brief named three. There was a fourth.

1. `catalogue.js` `subCode` — removed, with `colorKey` and `subscriptionCode`. Proved
   unused: no entry carries `subCode`/`colorKey` after the rename; `subscriptionCode` had
   exactly two callers (`isModuleActive`, `TabModules.jsx`), both simplified.
2. `TabModules.jsx` — the `|| subscriptionCode(m.code) === code` half of the dedupe filter,
   removed with its comment and its import.
3. `org_modules.py` `_ENTITLEMENT_SPELLING` — removed with `_CANONICAL_SPELLING`,
   `entitlement_code()`, `canonical_code()`, all 13 call sites, and the `entitlement_code`
   response field. Proved unused: grep for `entitlement_code` across all `.jsx/.js/.md`
   returns nothing, so no client consumed it.
4. **`admin_orgs.py:832`** (not in the brief) — `ALL_MODULES = frozenset(ROLE_TIER_MODULES) | {"sanvaad"}`.
   The union existed only to add the entitlement spelling on top of role_tiers'. Now that
   role_tiers says `sanvaad`, it was adding a member already present. Reduced to a straight import.

None were left as identity functions. An identity translator implies a split that no
longer exists, and the next reader has to re-derive that it is a no-op.
