# Proposal 93 · v4 rescope — the route file

**The document is `docs/proposals/93b-the-second-run.html`. Read it in full.**
This file is a route, not a substitute — the single biggest failure of the 28 Aug
sessions was planning from a compressed summary of 93 and silently losing most of
its scope. **If you find yourself planning from a summary, stop and re-read.**

Written 2026-08-29, after the promotion, before the consolidation DDL lands.

---

## What v4 is

**Same scope. Same phases, stages and waves. Same two rules, same target, same
reason. Half the work.**

- All 22 suites run. All 9 waves run. All 6 stages run. R0–R9 all run.
- Suite 00 still runs first. Stage 4 still replays on UK. Stage 5 still does both
  AVDs. §12 still guards Aekam Inc. §13 is still *excluded by decision*, never
  *blocked*.
- **What halves is the number of rows behind each assertion**, not the number of
  paths driven. ~3,130 records per org → **~1,565**. 20–25 days → **12–14**.

⚠ **This run drives PRODUCTION.** `main` = `staging` @ `16f6fdfb`, and
production runs the same code *and* the same schema — verified live,
`{"schema":"staging","environment":"production"}`. The rehearsal is the
performance. That is not a reason to do less of it; it is why the gates get
harder.

---

## The two things v4 changes about method

### 0. Stage 1 opens with a three-system inventory — DB · Railway · Cloudflare

Owner's instruction. **Nothing is touched until all three are read**, because the
touch-list and the never-touch list come from those systems on the day, not from
this file.

| System | Read | Decides |
|---|---|---|
| **Supabase** | schema census (names + base-table counts) | which restore points exist; **whether the consolidation DDL has landed** |
| | every distinct `org_id` across all org-bearing tables | **the blast radius** — the touch list must be exactly {Unicode, UK, E2E} |
| | `organisations`: name · id · `state_code` · `r2_bucket_name` · credentials present | which org writes into which bucket |
| | the protected set by id + its nine child predicates | what R4′ must exclude |
| | `users` × `user_roles` via the R3 query | the keep/delete split, **recomputed live** — it moved 20/30 → 25/25 last time |
| | object keys with `nullif(btrim(col),'')` | the R2 key list; the naive predicate inflates it ~3× |
| **Railway** | both environments' services and **cron schedules** | the freeze list — read *before* it changes, because it is also R9′'s restore values |
| | `DB_SCHEMA` · `OUTBOUND_MODE` · `OUTBOUND_SUPPRESSED_ORGS` · `R2_BUCKET_NAME` · `R2_PREFIX` · `sleepApplication`, both envs | which schema each env writes to, and what protection is actually in force |
| | `/api/health` on both — **not the variable list** | ⚠ the list showed a stale value while the process reported another |
| | the SHA each env runs, plus `meta.branch` | whether a probe measures the code we think it does |
| **Cloudflare** | `r2_buckets_list` on the connected account | which buckets this account can actually reach |
| | whether the platform bucket is the one the org rows name | ⚠ last check: this account holds **one** bucket, `aekaminc`, and `kartavya-storage` is **not in it** — that is what surfaced the two-accounts finding |
| | key shapes per org | **settles that a delete can never be a prefix delete** — E2E and Aekam share the platform bucket under `staging/` |

**Output: two written lists — TOUCH and NEVER TOUCH — before anything runs, each
row carrying the query that produced it.**

#### ⚠ One query has been run so far, read-only, and it moved two numbers

Schema census, 2026-08-29:

    reseed_backup_20260828   265      staging     258      dead_tables_20260822   2
    premerge_backup_20260829 262      public       42      tenancy_195_backup     2
    auth                      23      realtime      9      payroll_smallrun_…     1
    ledger_repair_20260826    13      storage       8      supabase_migrations    1

- **SEVENTEEN schemas**, not fourteen/fifteen/sixteen. A measurement with a date,
  not a constant. **Re-run it; do not cite it.**
- **`premerge_backup_20260829` exists — 262 base tables.** A second full-size
  restore point. **R9′ now drops TWO backup schemas by name, one at a time**, and
  neither is dropped to make room for the other.
- **`staging` still holds 258 base tables against `public`'s 42 — the
  consolidation DDL has NOT run.** The identifiers moved in code; the tables did
  not. So R4′'s order is still the two-schema shape today, and re-deriving it is
  **gated on the DDL landing**, not something to do in advance.

### 1. Stage 1 gains a blocking gate — the blast radius

The old safety argument was that `public.tasks` holds only the five known orgs.
**That was measured over 42 tables. It is 258 now, and production serves them.**
Before any DELETE, a per-table `org_id` distinct-count sweep across all 258,
plus:

```sql
SELECT count(*), string_agg(nspname, ', ' ORDER BY nspname)
FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';
```

The schema count is a **measurement with a date, not a constant** — fourteen on
08-27, fifteen after 93's own backup, sixteen on 08-29. Re-run it; do not cite
it. A single third-party org row turns R4′ from a reseed into an incident.

### 2. R4′'s delete order is re-derived, not re-pointed

`93-R4-DELETE-PLAN.md` is split across two schemas — Phase A `public` 18 steps,
Phases B–D `staging` 99. The consolidation (`af774fce`, 3,004 identifiers moved;
the DDL is **not written yet**) removes that shape. `public` carried 2 FKs
against `staging`'s 391; afterwards it carries all 393, so a wrong order starts
hard-failing instead of passing silently. **Derive fresh from `pg_constraint`.**

Carried forward unchanged and still load-bearing:

- **926 null-org rows the `org_id` predicate cannot see**, 3 of them on protected
  tasks. No `org_id` predicate saves them — the rows have no `org_id`. The
  join-based sweep must carry the team guard.
- `task_reminders` deleted **before** `tasks` — the one CASCADE that reaches the
  protected set.
- **Never:** `users` (global, production-shared), `organisations` (152 CASCADE
  edges, one crossing schemas), the global reference tables. `audit_log` last.
- The **21 SET NULLs matter more than the 242 CASCADEs** — a SET NULL mutates a
  *surviving* row and no count reveals it.

---

## The corrections v4 folds in from this directory

| Source | What it overturns |
|---|---|
| `93-R2-OBJECT-INVENTORY.md` | **§5's "Aekam is physically isolated" is FALSE for E2E** — E2E has no bucket config and falls through to the *platform* bucket, the one Aekam uses. A prefix delete there is the catastrophic case §5 thought it had designed away |
| same | **"E2E has no R2" is wrong** — 51 real `sign_documents` objects. Its file suites are no longer skipped |
| same | **Empty string is not NULL.** `file_key IS NOT NULL` counts `''` and inflated the first count ~3×. Use `nullif(btrim(col),'')`, or the sweep hunts ~150 objects that don't exist **and reports them deleted** |
| same | Eleven more key-bearing columns §5 never names; several tables carry only a `*_url`; **`manav_assets` has no key column at all** |
| `93-R3-ACCOUNT-RESOLUTION.md` | §2's **20 keep / 30 delete** was **24 / 26** live, then **25 / 25** after the owner ruled on `Sid` by name. A protected-task creator (`Devang Bhatt`) appears nowhere in §2 and every rule deleted it |
| `93-R4B-…md` | §2's "remove means remove" was **narrowed silently** — R4 removed seats, not accounts — and `org_invites.py:455` then 409'd every re-invite. Recorded as a footnote where §0 requires a decision |
| `93-B-…md` | Migration 239 shipped the recycle bin: delete → bin → hidden at 14d → R2 purge at 90d, **binned files still count against quota**, no delete on Ganit invoices or eSign |
| `93-E-…md` | **109 of 958 deployed operations have no production caller**; 13 are mobile-only and are *not* orphans. Reachability there is route⇢literal, not route⇢rendered control — **the rendered half is Suite 22's job** |
| `93-F-OPEN-FINDINGS.md` | 22 findings; **seven sit inside suites this run re-executes** (#4 #5 #6 #7 #12 #16 #20). Fix those first — largest saving in the plan, costs no coverage |
| `93-STAGE3-EXECUTION-PLAN.md` | `assertOrg()` had **never run** — no spec imported it and it compared against an `id` the API didn't return. Both halves fixed and mutation-proved |
| `docs/STATUS.md` | The first run **did not hit §4 volumes**: members 8/18, projects 2/8, tasks 20/80 (all 20 the protected set), orders 0/35. Half-scale targets are the ones actually reachable |

---

## The volume knob does not exist yet

93 promised the specs take a volume constant. **Eight of 24 do** — 103
`const N_* = n`. The other sixteen embed volume in hand-built arrays
(`suite07` holds a literal 30-employee array) and in *derived* counts — "18
linked to logins", "150 roster cells", "12 employees × 5 days" all descend from
that 30. **Slicing without re-expressing the derived counts breaks them
silently.**

Build `frontend/e2e-real/_volumes.ts`: `SCALE`, a `scaled(n)` flooring at 1, and
a `HELD` registry `scaled()` refuses to touch. Then **prove it bites** — put a
held count through `scaled()`, watch it go red, restore. *A knob nobody has seen
refuse is decoration.* And `SCALE=1` must reproduce v3's numbers exactly before
`0.5` is trusted. **1 day.**

### What is held at full, and why

Six bad passwords (the subject *is* the 5/min limiter) · 3 payroll months (two
points is a line) · 4 PT bands (statutory; Gujarat 4 vs Maharashtra 3 *is*
Stage 4's assertion) · 3 bank files (parsing is positional) · 18 report types ·
9 senders · 6 doc series · 3 UPI platforms · 6 custom field types · 6 leave types
· 6 commission bands · 4 Pahchan sites · 4 geofence refusals · 14 Niyam trigger
families · 5 subscription changes · the >200-row pagination seed · the 20
protected tasks · **Suites 00, 20 and 22 entire**.

The elastic populations are cut past half to pay for those, so the programme
total still lands on **50%**.

---

## Order of work

| | |
|---|---|
| **Stage 1** | R0′ — both deploys, both `/api/health`, tokens, outbound decided, **+ blast radius**. 1 day |
| | the scale knob. 1 day |
| **Stage 2** | R1′ freeze **9** crons across **both** environments (staging's 7 + production's 2) → R2′ backup + key inventory → **restore performed and diffed** → R3′ protect + recompute the account set live → R4′ delete → R5′ fixtures. **No agents run during this stage.** 3.5 days |
| **Stage 3** | Waves 0–8 on Unicode, from genuinely blank screens. Peak 4 workers; **Suite 01 alone stays `workers: 1`**. Run twice for §6 idempotence. 3–4 days |
| **Stage 4** | UK replay, unmodified. **PT and the GST split must differ** or the ladders are not being read. 1 day |
| **Stage 5** | Mobile, both AVDs — ⚠ the release APK will not run on either, carried forward as a known blocker. 1 day |
| **R7** | Dead-control sweep; the dead count is published even if it isn't zero. 1.5 days |
| **Stage 6** | R9′ — re-arm 9 crons, restore `OUTBOUND_MODE` and `sleepApplication=true`, **drop both backup schemas by name, one at a time**. 0.5 days |

⚠ `reseed_backup_20260828` is **still the only copy** of 25,854 rows and 25
purged accounts — the last run's R9 never happened. **It is not dropped to make
room.**

---

## Decisions owed before Stage 2

1. **`OUTBOUND_MODE`.** `OUTBOUND_SUPPRESSED_ORGS` is **EMPTY on both
   environments** despite comments describing it as holding E2E's ~1,600
   `@example.com` addresses, and `outbound.py:181` defaults the mode to `live`.
   `dry` is the only protection there is — and it degrades every mail assertion
   to "SES accepted it", the exact 1,562-row failure §0 exists to prevent.
   **Read the state from `/api/health`, never the variable list** — a bulk paste
   silently reverted it during the promotion while the list still showed the old
   value. Recommendation: measure exposure, run `live`, re-measure immediately
   before Suite 11 (the one suite that mass-sends).
2. **The window.** R0′–R2′ delete nothing and can run in daylight; only R4′
   onward needs a quiet window, and on production that means a genuinely quiet
   one.

Also owed, not blocking: the three bootstrap admins R3 recommends deleting ·
`staging.unicode_emails_backup_20260806` (18 rows, never approved by name) · 12
user-scoped tables / 61 rows where 9 users straddle a target and a kept org ·
any held count you want lifted (it comes off **named**, in the report).

---

**Nothing has been run.** No row deleted, no account touched, no cron disarmed,
no variable changed.
