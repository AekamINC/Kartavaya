# 93 §D — `approvals_router.py` answers a tenancy question with no tenant

**Found 2026-08-29 while verifying `fbb1f0c5`'s TaskDrawer diff against the
server rules it claims to mirror. Triaged by the lead: PRODUCT BUG · LATENT ·
reversible. Not yet fixed.**

## 1. What is wrong

`approvals_router.py` calls `is_org_admin(user["user_id"])` **with no org
argument** at six sites. `middleware/roles.is_org_admin`'s own docstring says
what that means:

> `org_id` is optional because most call sites do not yet carry org context …
> omitting it preserves the previous global behaviour

Unscoped, it is True for an `org_owner`/`org_admin` row **in ANY organisation**.
And `fetch_task_or_404` — read its docstring, it is candid — "CHECKS NOTHING
ELSE … it is one unfiltered `SELECT ... WHERE task_id=$1`".

So the pair is: fetch any task in the database by id, then ask a question that
is True for an administrator of a completely different company.

| line | route | consequence |
|---|---|---|
| 173 | `assert_may_act_on_task` | the act gate returns early — reaches any task |
| 385 | `POST /tasks/{id}/approve` | **cross-org WRITE** |
| 432 | `POST /tasks/{id}/reject` | **cross-org WRITE** |
| 477 | `GET /tasks/pending-approval` | admin branch (SQL may re-filter — verify) |
| 592 | `POST /tasks/{id}/client-approve` | **cross-org WRITE**, skips `task_clients` |
| 824 | `POST /tasks/{id}/client-reject` | **cross-org WRITE**, skips `task_clients` |

⚠ **A comment at :173 already claims the fix.** It reads *"Read at request time
and org-scoped, unlike the JWT claim above."* It is **request-time**, and it is
**not org-scoped**. A comment and its code disagreeing is the exact shape that
made the support feature unreachable for its entire life (02.17).

## 2. Why this is "fixing the symptom, leaving the shape"

`server.py` has **already been swept for precisely this pattern**. Every site
there now reads `is_org_admin(uid, org) if org else await is_org_admin(uid)`,
and `server.delete_task` carries the finding in full:

> `is_org_admin(user_id)` with no org is True for an `org_owner`/`org_admin` row
> in ANY organisation … Measured: an org_admin of one small org permanently
> deleted another tenant's task by id, switcher irrelevant.

`delete_task` was fixed. `approve`/`reject`/`client-approve`/`client-reject`
were not, and **`approvals_router.py` has no `active_org_id` dependency at all**
— it cannot scope without one being added. `services/task_transitions.py:259`
returns the same unscoped answer.

## 3. Live exposure — measured 2026-08-29, read-only

    accounts holding org_admin or org_owner (could walk through)   15
    tasks ever decided (approved_by IS NOT NULL, org_id present)     4
    of those, decided by someone with NO role in the task's org      0

**LATENT. The hole is open and has not been walked through.** Same grade as the
`create_deal` finding, which was also 0 cross-org rows and was fixed anyway.

## 4. The fix, and why it is two predicates and not one

`delete_task` states the rule and it is the one to copy:

> Both halves are needed and neither is sufficient. `is_org_admin(uid, org)`
> says the caller administers THIS org; `task_is_in_org` says the task is IN it.
> `get_task` had the first half only, and still returned every task in the
> database. **A destructive write may not be one predicate short.**

So: add `org=Depends(active_org_id)` to the affected routes; scope the admin
check; and confirm the task is in that org via `server.task_is_in_org(pool, org,
team_id=…, owner_ids=…)`. ⚠ `server.py` imports this router, so a module-level
`from server import …` is circular — import inside the handler, the way
`services/task_transitions.py:254` already does with `is_project_owner`.

⚠ **A stale comment to correct while there:** `task_is_in_org`'s docstring says
*"`tasks.org_id` DOES NOT EXIST … added only in `PROPOSED_076`, which is
unapplied"*. Measured today, `public.tasks.org_id` **does exist**: 280 rows, 240
populated, 40 NULL. The 40 NULLs mean it cannot be the sole predicate, so the
team/owner derivation still earns its place — but the comment is wrong and the
next reader will believe it.

## 5. Reversal

Pure code, no migration, no data change. Reverting the commit restores the prior
behaviour exactly. The only behavioural risk is **narrowing**: an org_admin who
today can approve across orgs would stop being able to — which is the point, and
which `delete_task` already accepted for the same class of caller.
