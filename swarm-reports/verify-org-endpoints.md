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
