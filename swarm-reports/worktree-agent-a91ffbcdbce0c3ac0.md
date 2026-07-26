# Finance & Operations Backend Audit — ganit, vikray, prachar, dristi

Agent branch: `worktree-agent-a91ffbcdbce0c3ac0`
Base: `staging` @ 2a2a27b
Scope: `backend/routers/ganit.py`, `vikray.py`, `prachar.py`, `prachar_ads.py`, `dristi.py`
Out of scope (owned by other agents): `manav.py`, `vetana.py`, `graha.py`, `me.py`, `org_*.py`, approvals, messaging.

Status: IN PROGRESS — appended incrementally as findings are confirmed.

---

## 0. Worktree correction (do not skip when reproducing)

The worktree was created from `origin/main`, **not** `staging` — 271 commits behind,
13 commits ahead on production-only hotfixes. `backend/middleware/` did not exist at
that commit, so every "role_tiers.py is missing" style observation made from this
worktree before the reset was an artefact, not a defect.

Corrected with `git reset --hard origin/staging` before any analysis. Any agent
reporting that ganit/vikray/prachar/dristi "do not exist" was reading `main`.

---

## 1. Ground truth: the role model

`backend/middleware/role_tiers.py` is the single source of truth and is **correct**.

- `SEPARATED_DUTY_MODULES = {"vetana", "ganit"}`
- `level_satisfies(held, required, module_code)` implements the rule exactly:
  for those two modules, `required == APPROVER` is satisfied **only** by
  `held == APPROVER`. `admin` does not climb into it. Verified at
  `role_tiers.py:254-259`.
- Module codes: `ganit`, `vikray`, `prachar`, `dristi` all appear in `ALL_MODULES`
  with the spelling the routers use.

### Claim: "module entitlement uses the wrong module code spelling (sanvaad/samvada class of bug)"
**STALE for my four modules.** All four routers construct their gate with the exact
code listed in `ALL_MODULES`:

| Router | Gate constructed | Code in `ALL_MODULES` | Match |
|---|---|---|---|
| `ganit.py:27` | `require_module("ganit")` | `ganit` | yes |
| `vikray.py` | `require_module("vikray")` | `vikray` | yes |
| `prachar.py` | `require_module("prachar")` | `prachar` | yes |
| `dristi.py` | `require_module("dristi")` | `dristi` | yes |

The `sanvaad`/`samvada` split is real but confined to Sanvaad — `role_tiers.py:62`
documents it in a comment. None of my four are affected.

---

## 2. THE HEADLINE DEFECT — Tier-4 levels are not enforced anywhere

`level_satisfies()` — the function that encodes separated duty — has **zero call
sites in the entire backend**.

```
$ grep -rn "level_satisfies\|require_level" backend/ --include=*.py
backend/middleware/role_tiers.py:241:def level_satisfies(...)
```

Consequences, all of them live:

- The grant **level** is stored (`staging.org_member_modules.role`, written by
  `org_members.py:230`), is returned to the UI, and is **never read by any guard**.
- `require_module("ganit")` checks only: platform-role reach, module grant
  *existence*, and subscription. A grant at `viewer` and a grant at `admin` reach
  exactly the same endpoints.
- Therefore **separated duty in ganit is not honoured** — not because it was
  simplified away, but because the enforcement layer was never built. The rule
  exists only as an uncalled pure function.
- Every mutating ganit endpoint (record payment, cancel invoice, delete product,
  import bank statement, record vendor payment) is reachable by any org member
  holding a bare `ganit` grant at the default level, which is `viewer`.

This is the single largest finding in my scope. Fix landed in this branch — see §6.

---

*(appended below as work proceeds)*
