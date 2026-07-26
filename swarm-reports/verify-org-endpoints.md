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
