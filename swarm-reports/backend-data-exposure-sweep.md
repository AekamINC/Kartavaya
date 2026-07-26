# Backend data-exposure sweep — cross-cutting

Agent: `worktree-agent-a0e4d12c53e200673`
Base: `origin/staging` @ `666b0ea`
Scope: the whole backend, looking for the *class* of bug rather than the instance.
Other agents own individual routers; where they do, this report **reports** rather than edits.

> **Note on my base.** This worktree's branch was created from `origin/main`, not
> `origin/staging` — it was 272 commits behind and did not contain `design-handover/`,
> `middleware/role_tiers.py`, or 30 of the 40 routers. Reset to `origin/staging` before
> any analysis. Every line number below is against `666b0ea`. Nothing was lost: the 13
> commits it carried are production's.

---

## Findings, ranked

*(in progress — this file is updated as each finding is confirmed)*

---

## Method

Route inventory built by parsing every `@router.<verb>("...")` decorator in
`backend/` and extracting the balanced `Depends(...)` list from the handler
signature. **639 routes total, 42 with no auth dependency.** Each of the 42 is
justified or flagged below.

