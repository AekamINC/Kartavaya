# Swarm coordination — verified facts, updated live

Written by the coordinator. Everything here I checked myself against the live repo
or database. If your brief contradicts this file, this file is right.

---

## 0. YOU WERE STOPPED BY A SPEND LIMIT, NOT BY AN ERROR

22 agents were terminated mid-task by the account's monthly spend limit. Nothing you
did caused it. **Your work was rescued before it could be lost.**

**Find your work before redoing anything:**
```
git fetch origin
git branch -r | grep <your-agent-id>
git log --oneline origin/staging..origin/rescue/<your-agent-id>
```
Your in-flight changes were committed and pushed to `rescue/<your-agent-id>`, and in
some cases to the topic branch you had already created. **Check both.** The rescue
commit is unverified by definition — gates were not necessarily run on it. Check it
out, verify it, finish it. Do not start from scratch.

Some rescue branches were force-pushed to a fresh ref because your original branch had
been rebased and no longer fast-forwarded. Your original branch is untouched if it
exists; the rescue ref is additive.

**The lesson that applies to you now:** commit and push after every unit of work. This
is the second time a run has been stopped without warning. Uncommitted work is the only
work that dies.

---

## 1. Your worktree may be cut from `main`, not `staging`

**28 worktree branches in this run descend from `main`'s tip.** On `main` there is no
`design-handover/`, no `design-reference/`, no `frontend/scripts/check-*.mjs`, and no
`frontend/src/pages/sanvaad/`. It is 271 commits behind. Three agents hit this; one was
still working from production's code with no design specs at all.

Check yourself:
```
git merge-base --is-ancestor origin/main HEAD && echo "MAIN-BASED — FIX REQUIRED"
```
Fix:
```
git fetch origin
git branch backup/<your-branch>-premain
git rebase --onto origin/staging $(git merge-base origin/main HEAD) HEAD
```

**If a file in your brief "does not exist", check this before concluding the claim is stale.**

## 2. The gate scripts DO exit 1 from the repo root — three agents got this wrong

Both `check-tokens.mjs` (line 62) and `check-classes.mjs` (line 109) call
`process.exit(1)` when `src/styles` is absent. A root invocation is a **loud failure**,
not a silent pass. Verified from source and by running them three ways.

Three agents independently reported "exit 0, silent false pass". The cause is almost
certainly a shell pipeline — `node script.mjs 2>&1 | tail -2` reports **`tail`'s** exit
status, which is always 0. Do not "fix" these scripts; they are correct.

Run them from `frontend/`:
```
cd frontend && node scripts/check-tokens.mjs && node scripts/check-classes.mjs
```

## 3. Never merge `main` into `staging`

`main` has 13 commits staging lacks, but **staging already contains functional
equivalents of every one** — I verified each directly: the PgBouncer 6543→5432 fallback
(`db.py:50-87`), both CORS spellings (`server.py:229-234`), R2 re-signing
(`storage.py:201`), the `brand_settings` validator (`server.py:485`). The divergence is
historical, not functional. At eventual merge time the rule is: **take staging.**

## 4. Migration numbering

`067` is taken twice over and was resolved. Current state:

| Number | Owner |
|---|---|
| `PROPOSED_067_account_self_service.sql` | `feat/me-account-self-service` |
| `PROPOSED_068_org_profile_fields.sql` | org-endpoints (renumbered) |
| `PROPOSED_069_org_security.sql` | org-endpoints (renumbered) |
| `PROPOSED_070_sanvaad_spelling.sql` | org-endpoints (renumbered) |
| `074` | claimed by the ganit/vikray agent |
| `PROPOSED_075_module_grant_composite_key.sql` | migrations agent — **on staging** |
| `PROPOSED_071_vetana_approver_backfill.sql` | vetana agent — landed mid-run |
| `PROPOSED_072_task_comment_client_visibility.sql` | was the colliding `056` — **resolved, see below** |

**Take `073` next** (`073` and `076+` are free). `071` was still listed as free above
until it was claimed mid-run — **survey before taking a number, this table goes stale
within the hour.**

### ✅ `056` COLLISION — RESOLVED

Renamed to **`PROPOSED_072_task_comment_client_visibility.sql`** by the org-endpoints
agent. `071` was taken by then, so it went to `072`.

**The earlier recommendation said "nothing references the filename". That was wrong,
and acting on it would have broken the build.** There were five references:

| File | Reference |
|---|---|
| the SQL file itself | header line 1 |
| `backend/server.py`:570 | full filename, in a comment beside the query |
| `backend/server.py`:1610, :1637 | `PROPOSED_056` — one inside a docstring explaining a live client-portal fallback |
| `backend/tests/test_client_portal.py`:263 | `PROPOSED_056` in a test docstring |
| `SWARM-FINDINGS-LEDGER.md`:79 | `PROPOSED_056` |

All five repointed. This is the second time this run that "nothing references it" was
asserted without a grep — **run the grep over `.py`, `.sql` AND `.md` before any
renumber.** The `067` renumber found 11 references, three inside runtime HTTP 503 bodies.

### The original problem, for the record

`backend/migrations/` on staging contains **both**:

- `056_publish_platforms_expansion.sql` — **APPLIED** (verified against the live schema)
- `PROPOSED_056_task_comment_client_visibility.sql` — an unapplied proposal

Anyone applying in numeric order saw `056` twice and could apply one and skip the
other silently — the same defect as the `067` collision, caught only because two
agents happened to be looking.

Safe to take because the file was **not** in flight: its last commit was the base
snapshot `2a2a27b`, and no branch had touched it since. That check is the one that
makes this different from the `067` situation, where two agents were both writing.

### ⚠️ The sanvaad spelling fix is HALF LANDED right now

Re-verified live by the migrations agent after the restart. The **code half is on
staging**; the **SQL half is not applied**:

| Where | Spelling |
|---|---|
| `role_tiers.py:75, 82, 248, 267` | `sanvaad` ✅ |
| `org_modules.py` — the `_ENTITLEMENT_SPELLING` bridge is deleted | `sanvaad` ✅ |
| `staging.module_subscriptions` | `sanvaad` ✅ |
| **live CHECK `org_member_modules_level_is_meaningful`** | **`samvada`** ❌ |

`PROPOSED_070` warned that code-before-SQL is the worse order. It does **not**
crash — a `sanvaad` grant at viewer/editor/admin inserts fine because the CHECK's
`samvada` list cannot match, and approver-on-sanvaad is refused 400 by Python
before the CHECK is reached. The real cost is that **the CHECK is now dead**: it
constrains a string the code can no longer produce, so "Sanvaad has no approver
level" is enforced in Python only, with no database backstop.

**What to do: run only the CHECK re-creation from `PROPOSED_070`.** Do not
re-apply its step 2 (already done) and do not revert the Python to restore the
documented order. Its two `UPDATE`s are verified no-ops. `org_member_modules` is
still empty, so this is free today.

**Do not re-run `PROPOSED_066` after that lands** — its §1 re-creates the same
CHECK with the old `samvada` spelling and would silently revert the fix. 066 is
already applied; a guard header now says so.

Related, and it settles an open question: `role_tiers.py:71` records that the
TABLES deliberately keep the `samvada_` prefix. So `058_sanvaad_messaging.sql`
creating `staging.samvada_channels` is correct as written — no rename needed.

### Gaps that are NOT missing files

`003`–`006`, `054`, `062` have never existed on any ref. `README.md` lists
`003`–`006` as "pending" from `V2_PLAN.md §4`. Do not go looking for them, and do
not reuse the numbers — `README.md`'s own rule is "never re-number", and the two
renumbers this run were forced by collisions, not preference.

**Before reporting a defect whose evidence is a line number, check that the line is CODE
and not PROSE.** Twice this run a comment *describing an already-fixed bug* was
re-reported as live. `admin_orgs.py:812-816` is the clearest case: it is the comment
"held EIGHT codes where role_tiers holds twelve", describing a bug fixed in `40124fb`.
The live assignment is line **831**, and it resolves to **12** codes. A `git grep` hit
inside a `#` block is not a finding.

When renumbering a run of files, **rename highest-first**. Renaming in file order makes
`067→068` overwrite the branch's own `068`, and `git mv` reports success while the file
is silently lost.

## 5. Separated duty is defined but enforced NOWHERE — verified by me

`level_satisfies` (`role_tiers.py:241`) encodes the rule correctly and has **zero call
sites in the entire backend**. There is no `require_module_level` dependency. `require_module`
only checks that a grant row *exists*, never its level.

**Today an `org_admin` can approve a payroll run** (`PATCH /payroll/runs/{run_id}/approve`,
`vetana.py:664`). This is structural, not one bad route.

**There is an unresolved contradiction blocking the fix**, and it needs the owner:
- `RBAC-SPEC.md:65` — *"Sensitive modules are role-derived, not granted. Vetana, Ganit and
  Manav have no per-member grant row at all."* A grant row naming a sensitive module is
  invalid input and must be rejected.
- The Tier-4 level model assumes a grant row **carrying a level** is exactly how
  approver is held.

Both cannot be true. Building enforcement against the wrong one is **worse than the
current gap**, because it would look enforced. Do not guess — flag it.

**Sharpened by the migrations agent — the spec contradicts ITSELF, ten lines apart,
and one branch of it is provably unimplementable:**

- `RBAC-SPEC.md:56-58` gives Vetana, Ganit and Manav a full four-level ladder with
  named per-level capabilities. The Vetana Approver cell reads *"Approve payroll,
  release payments"*; Ganit's reads *"Approve entries, close periods"*.
- `RBAC-SPEC.md:65`, immediately below, says those same three modules have **no
  per-member grant row at all**.

So the spec defines four levels for exactly the three modules it then says cannot
carry a level. **The kill shot is the code block at `:67`:**

```
SENS_BY_ROLE = { org_owner: 'admin', org_admin: 'admin', manager: 'none',
                 member: 'none', client: 'none' }
```

**There is no `approver` value anywhere in it.** Under the role-derived model the
strongest thing anyone can hold on Vetana or Ganit is `admin` — and
`role_tiers.level_satisfies` says admin does NOT satisfy approver in those two
modules. Follow `:65` literally and **nobody in any org can ever approve a payroll
run or close a period.** Not a gap in enforcement: an unreachable state by
construction.

That is why `PROPOSED_074` had to invent a separate `org_module_approvers` table —
it is the only way to hold an approver once `:65` forbids the grant row. `074` and
`PROPOSED_075` are therefore **alternatives, not complements**; applying both leaves
two places to look for one fact. The fork:

| If the owner picks | Then | And |
|---|---|---|
| `:65` role-derived | `074` required | `075` is pointless — vetana/ganit are the ONLY separated-duty modules |
| Tier-4 grant rows (live today; `065`'s CHECK is NOT applied) | `075` required and sufficient | `074` adds a second reach story and a per-process probe that latches |

**Do not resolve this by picking one in code.** Whichever loses, its file must be
DELETED, not left in `backend/migrations/` for someone to apply later by reading
numbers. Full analysis in `swarm-reports/worktree-agent-a54bd25b975919175.md` §4-5
and `PROPOSED_075` §5.

Third divergence, same area, already settled and worth not re-litigating:
`RBAC-SPEC.md:69` says a new grant defaults to `admin`. The live column defaults to
`viewer` and `role_tiers.DEFAULT_GRANT_LEVEL = VIEWER`. `PROPOSED_066` overrode the
spec deliberately and documented why — a default of admin means every grant is full
control and the four levels never get used. **The build is right; the spec is wrong.**

## 6. Confirmed live defects worth knowing

- **Sanvaad 403'd for EVERY user in EVERY org, `org_owner` included** — `require_module()`
  uses one string for both the grant lookup (`org_member_modules`) and the entitlement
  lookup (`module_subscriptions`), and the org-role short-circuit skips only the grant
  half. `messaging.py` gated on `require_module("samvada")`, a code
  `module_subscriptions` has never held. **Fixed** in `4a966c6`, with `search.py`'s
  `_ENTITY_MODULE["messages"]` and 4 workarounds. `staging.samvada_*` TABLES keep their
  names — a table name is not a module code.
- **Three modules cannot be activated via `POST /v1/subscription/modules/activate`** —
  it validates against `staging.add_on_modules WHERE is_active=TRUE`. `varta` has **no
  catalogue row at all**; `prachar` and `vikray` have rows with `is_active=false`. All
  three are still reachable through the platform-console path (`admin_orgs.py`), which
  validates against `role_tiers.ALL_MODULES` instead. **This is DATA state, not code —
  it needs a row/flag change nobody in this run may make.** `esign`/`srijan` having no
  usable row is correct: they are `BUNDLED_MODULES` and gate on the plan's `features`.
- **There are TWO writers of `module_subscriptions`, not one** — `admin_orgs.py:850` and
  `subscription.py:228` — and they validate against different sources. Any audit of "can
  this module be turned on" has to check both.
- **Attachment leak was 4 sites, not 1** — `GET /api/tasks`, `PUT /api/tasks/{id}`,
  `PATCH /api/tasks/{id}/move` had no filter at all; `GET /api/tasks/{id}` filtered
  *after* minting. Signed R2 URLs last **9 hours** (`ExpiresIn=32400`). Now fixed.
- **The reduced-motion strobe was real and measured**: 2.000ms (~500Hz), 1.5ms, and
  0.8ms (~1250Hz). Now fixed. **The spec mandates it** — see spec defects below.
- **Every generated PDF font was silently DejaVu.** `report_generator.py` named five
  faces; the Dockerfile installs only `fonts-dejavu-core` and `fonts-noto`. Font stacks
  fixed; vendoring the real TTFs is still open and needs a human on the Dockerfile.
- **`org_resolver.py:31-40`** lets four zero-reach roles resolve ANY org via `X-Org-Id`.
  Upstream of every route guard. **Unowned.**
- **`roles.py:74`** hardcodes `role_code = 'platform_admin'`, excluding `platform_owner` —
  the exact lockout `role_tiers.py:115-121` warns about. **Unowned.**

## 7. Spec defects found this run

Recorded in `design-handover/_SOURCE-MAP.md`. Highlights:
- **`16-animations.md:44` mandates the strobe** — it gives
  `animation: dmSpin calc(.7s * var(--ix)) linear infinite` as its worked example, and
  reference `motion.css:117` implements it. That is a 0.7ms spinner under reduce.
- `motion.css` has no per-element stop and contradicts itself (`.tt2__dot:371` is fixed 2s).
- `tokens.css:241` zeroes durations to `0s` where two other spec files require `.001`.
- `--motion-scale` is a build invention absent from the reference **and better than it** —
  do not "correct" it toward the spec.
- Tooltip dwell: **300ms wins** (`MOTION-SPEC.md:53` and `:147`). `02` and `16` carry the defect.
- `02` vs `app.css:150` disagree on `.card` (`--r-md`+`--shadow-1` vs `--r-lg`+no shadow).
- The "no fixed-width centring" owner rule contradicts the reference's own public
  surfaces (`auth.css` centres a 392px card). **Owner rule wins.**

## 8. Known pre-existing test failure — not yours

`test_ganit.py::test_create_invoice_success` fails identically on clean staging.
Cause: `conftest.make_pool()` leaves `conn_mock.fetchval` a bare MagicMock. Three agents
have now confirmed it independently. Do not chase it.

## 9. Standing owner rules

- **No pricing figures anywhere** — UI, comments, docs. Rendering a customer's own
  invoice amounts is fine; publishing OUR prices is not.
- Brand **Kartavaya**, domain **kartavaya.com**.
- All pages fluid and left-aligned; no fixed-width centring.
- Never write to the database. Never run a migration. staging and production share ONE
  Supabase project.
- Never send a real email, push, WhatsApp or social post.
- Never touch `main`. Never force-push anything but your own topic branch.
- Never commit `frontend/yarn.lock` or `package-lock.json` — Windows yarn rewrites
  esbuild `linux-x64` → `win32-x64` and breaks the Vercel and Railway builds.
