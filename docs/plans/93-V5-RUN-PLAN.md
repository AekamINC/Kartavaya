# Proposal 93 v5 — the RUN PLAN

**Written 2026-08-30 ~22:45 IST.** The scope is
`docs/proposals/105-93-v5-production-and-the-full-qa-set.html`; the route is
`93-V5-RESCOPE.md`; the entry page is `93-V5-START-HERE.md`; the brief every
agent carries verbatim is `93-AGENT-BRIEF.md`.

**This file is none of those.** It is the *operational* plan: what gets done, in
what order, with which tools, by whom, under what rules, and what counts as
evidence. It does not restate the scope and must not be used as a substitute for
reading it — the single biggest failure of the 28 Aug sessions was planning from
a compressed summary.

---

## 1 · The starting state, re-measured rather than cited

Every row was read live on 2026-08-30 between 16:30 and 17:15 UTC. Four of them
**contradict or refine** `93-V5-START-HERE.md`, and those four change the order.

| # | Read | Result | Against the page |
|---|---|---|---|
| 1 | `GET https://api.kartavaya.com/api/health` | `schema=public` `environment=production` `outbound_mode=live` `suppressed_orgs_digest=0` `rate_limit_store=redis` | ✅ agrees |
| 2 | `node scripts/check-production-targets.mjs` | **exit 0**, 12 of 12 ✓ | ✅ agrees |
| 3 | `node scripts/check-sender-dns.mjs` | **exit 1** — `kartavaya.com` all ✓; `aekaminc.com` and `unicodegroup.com` SPF do not authorise SES | ⚠ **refines** — the page's step 3 only asks about `kartavaya.com` |
| 4 | `SELECT * FROM public.org_email_senders` | **0 rows** | ✎ new |
| 5 | `backend/migrations/110_org_email_senders.sql` | the nine provisioned senders are **all `@unicodegroup.com`** | ✎ new, and it is the load-bearing one |
| 6 | `backend/email_service.py:13` | `FROM_EMAIL = os.environ.get("FROM_EMAIL", "Kartavaya <no-reply@aekaminc.com>")` | ✎ new |
| 7 | `grep -n bounce` over `email_service.py` + `email_senders.py` | **zero matches** — there is no bounce handler | ✎ new |
| 8 | `users` ← `kevalvshah03+e2e-owner@gmail.com` | exists, `fafedd4f-89dc-400b-a8d4-3c9cad2e1e42`, `role='admin'`, **`password_hash` IS NOT NULL** | 🔁 **corrects** — the page says "no credential"; the account and its password exist, we merely do not know the password |
| 9 | `users` ← the twelve `E2E_DUMMY_*` addresses | `emp001`, `emp002` present; **`003`–`012` absent** | ✅ agrees |
| 10 | `SELECT count(*) FROM public.manav_employees` | **0, globally** | ⚠ **escalates** — the page treats blocker 2 as one action; it is two |
| 11 | `backend/auth_router.py:1285` | `send_welcome_email` is now wrapped in `outbound.org_scope(...)` | ✎ the org-attribution hole the dummy spec warns about is **CLOSED** |

### 1.1 · The sender chain, as it actually resolves

Corrected by the owner 2026-08-30 and then read in code, because the first
reading of it was wrong in a way that would have deferred a real blocker.

    org_email_senders row for (org, purpose), is_verified = true
        └─ else ──▶ FROM_EMAIL  ── set on production ──▶ no-reply@kartavaya.com
                        └─ if the variable is ever UNSET ──▶ no-reply@aekaminc.com

Five documented ways to reach the fallback — no purpose, no bucket, no row for
the org, a row that is not verified, or the lookup fails — and **all five return
`FROM_EMAIL`**. Nothing raises. A sender that cannot decide must send from the
address it has always used.

⚠ **There is no bounceback path.** `aekaminc.com` is not reached by a bounce; it
is the *hardcoded default* if `FROM_EMAIL` is ever unset on a service. That is a
narrower door and a worse one — it is one variable write, or one new service
deployed without the variable, away from every message in the product going out
from a domain whose SPF rejects SES. It is also consistent with the known gap:
this product has **no bounce webhook and cannot learn that a bounce happened**.

### 1.2 · Therefore P3b is a REAL blocker, timed

**Green today, red the moment the run seeds senders.** Today
`org_email_senders` is empty, so every message resolves to
`no-reply@kartavaya.com`, which is green on SPF, DKIM and DMARC. But **the nine
senders the programme seeds as a HELD set are all `@unicodegroup.com`**, and
that domain's SPF is `v=spf1 include:_spf-eu.ionos.com ~all` — SES is not
authorised. From the moment wave 1 configures them, every message in the Unicode
lane goes out failing SPF, under `OUTBOUND_MODE=live`, with no bounce webhook to
notice.

| Domain | Live today | Live during the run | Action |
|---|---|---|---|
| `kartavaya.com` | ✅ the only active sender | ✅ still the fallback | none |
| `unicodegroup.com` | inert — 0 sender rows | 🔴 **nine senders, every Unicode-lane message** | **fix SPF before wave 1** |
| `aekaminc.com` | inert — one unset variable away | 🔴 same, plus no DKIM | **fix SPF; add a gate that fails if `FROM_EMAIL` is unset** |

⚠ **My earlier reading — "P3b is a paper red" — was wrong and is retracted here
rather than edited away.** It was built on `org_email_senders` being empty
without asking what the run puts in it. The gate is right to be red; what the
gate does not say is *when* each domain goes live, and that is what to fix.

### 1.3 · What the other corrections mean

**Blocker 1 is smaller than written and still needs the owner.** The account is
not missing. What is missing is a *known* credential. Nothing in the repo can
mint one without either the password or the signing secret.

**Blocker 2 is two steps and carries a bounce cost.** `manav-dummy-logins.spec.ts`
resolves employees by code (`EMP-001…EMP-012`) and *expects them to exist*;
`manav_employees` is empty, so the spec cannot run at all until employees are
typed. And the fence that used to hold the invitations back is gone:
`suppressed_orgs_digest` is `"0"`, the empty set. The org-attribution bug is
fixed, but a correctly-attributed send into an org that is not suppressed still
sends. **Running that spec today is ~20 hard bounces to `@example.com`** (ten
invitations plus ten welcomes) against a sender identity days old, hours before
real users arrive.

---

## 2 · The timing conflict, stated plainly

**Real users arrive 31 Aug 09:00 IST — about ten hours from this writing. The
programme is 10–13 days. Stage 3 is a wipe.**

Those three sentences cannot all be true and comfortable at once, and the plan
below is shaped by that rather than around it.

What protects the new customers is that they are **not among the five
organisations**:

| Org | id | Disposition |
|---|---|---|
| Unicode Group | `fae87907` | data wiped, configuration kept |
| UK AekamINC | `4d7e9380` | data wiped, configuration cleared |
| E2E Test & Associates | `64e7bea6` | wiped and rebuilt at 40% |
| Aekam Inc | `045b76ad` | **NO TOUCH** |
| Demo · Kartavaya | `4ea8208f` | untouched, out of scope |

A new customer org created tomorrow is in none of those rows, so no delete in
this programme names it. **That is an argument, not a measurement, and gate P2
exists to turn it into one.**

### 2.1 · The one change I am making to P2

Proposal 105 places P2 — the per-table `org_id` distinct-count across all 300
base tables — in **Stage 1, once**. That was correct when the org set was
static. It no longer is: **new organisations start arriving at 09:00 tomorrow,
so a blast radius measured tonight is stale before the first delete runs.**

> **P2 re-runs immediately before every delete, not once in Stage 1, and the
> delete is refused if that table's distinct `org_id` set contains any id
> outside the five above.**

A tightening, not a rescope. It costs one query per delete and it is the only
thing that keeps R4′ from becoming an incident on a database growing under it.

### 2.2 · What I will not start tonight

Nothing in Stages 1 and 2 writes a customer row — the three-system inventory is
a read, and Stage 2 is repair. **Stage 3 (the wipe) does not begin in the ten
hours before launch**, and not without you saying so once the morning is stable.
Stated here so that "we ran out of night" is never discovered at 04:00.

---

## 3 · The seat — mine, and every agent's, with no reduced variant

Carried verbatim from `93-AGENT-BRIEF.md` and the standing owner instruction.
**A narrower agent produces exactly the confident-but-wrong output this catches.**

**Lead QA & Test Architect · Lead Systems Architect · Integrations and
Multi-Tenant SaaS Engineer · Data & Migration Engineer · Application Security
and Privacy Reviewer · Release Engineer · Indian Statutory-Domain Analyst.**

Why the breadth: it is the minimum to **close** a finding rather than file one. A
tester who cannot change the system files defects; an architect who never runs
the product ships plausible ones; an engineer with no statutory grounding writes
an assertion that is green and wrong.

### 3.1 · Operating standards — non-negotiable, each one a scar

- **Never call anything missing without a live query in the report.**
- **Prove the check fails before trusting it.** Mutations need UNIQUE anchors — a
  `replace(…, 1)` landing in the wrong identical block is a false green *in the
  proof itself*.
- **Measure live exposure before fixing.** Latent and active need different
  urgency and different reports. *(§1.2 above is this standard applied to
  myself: the same finding is inert today and blocking on Tuesday.)*
- **Never infer an outcome from a return value.** `send_email` returns True when
  the gate suppresses; 1,562 rows read `sent` against 1,562 suppressed. **The row
  is the evidence.**
- **Code shipped is 🟡. A customer completing the flow is ✅.**
- **A test that fails on a correct fix is a defect in the test** — it teaches
  people to edit tests, which is how a real bug gets buried.
- **Report faithfully** — blocked, skipped and partial included. A silent cap
  reads as full coverage.

### 3.2 · The four judgements I own and may not delegate

1. **Product bug or test bug?** — the axis stop-and-fix stands on.
2. **Latent or active?** — has the hole been walked through yet.
3. **Reversible or not?** — decides whether it needs confirming first.
4. **Broken, blocked, or excluded by decision?** — three different sentences;
   collapsing them makes a plan look finished when it is not.

An agent may *propose* a verdict on any of these, with evidence. It may not
*record* one. I adjudicate and I carry it.

### 3.3 · The three programme rules

1. **Every row is typed by a user.** Playwright fills the real form and clicks
   the real button. No SQL seeding, no API shortcut.
2. **Stop and fix — but prove product-bug vs test-bug FIRST.** Read the wire, the
   page context, or the Railway log before writing "product bug".
3. **Never write without asserting the org ID first.** `assertOrg()` runs before
   any write and is called at the end of `signInAs()` so the guard is structural.
   Do not remove it.

### 3.4 · The eight suite rules — each learned from a FALSE finding

1. A missing control is a **FAILURE**, never `test.skip`.
2. Read the **write response**, not the list — lists are date-ordered and a new
   row is not on page one.
3. Then fetch the **canonical row** — a POST echoes a few fields, and asserting
   on the echo turns the rest into `NaN`.
4. **List endpoints cap at 200 rows** whatever limit is asked. Assert a delta;
   never reconcile a total by summing a list.
5. **Poll selects a fetch populates** (`pickOption`), and wait for the refetch.
6. **Scope lookups to the open form or tabpanel** — `getByLabel` is
   substring-matched.
7. **One button can make two requests.**
8. `getByRole(name)` matches the **accessible name**, not visible text — a
   locator written against visible text fails as a *missing control*, which is
   the wrong diagnosis entirely.

### 3.5 · Safety — not negotiable

- ⚠ **One database, one schema (`public`), shared with production.** Every
  write-path probe touches production data.
- **Write suites use org-scoped accounts only.** God mode is **Suite 19 and
  nothing else** — the unscoped platform token resolves every request into Aekam
  Inc through `platform_bypass`, and the suite goes green because the save
  genuinely succeeds. A row count cannot catch it; only asserting the target can.
- **Never test validation by writing to the live DB.**
- **Migrations are pre-approved — the five-section risk report is written FIRST**,
  never afterwards to justify what already ran.
- **A `DROP` is named and confirmed regardless.** A prefix is not a stack.
- **DATA changes to live rows are a separate decision.** Raise first; write the
  reversal down first.
- **Deploy ORDER is a live hazard.** A migration a router already SELECTs from
  must land before that router deploys, or every read 500s.
- **RLS is the only tenancy control and it works by deny-all.** Run the Supabase
  security advisor after **any** DDL; a new `rls_disabled_in_public` is a breach,
  not a lint.
- `/cron/reports` and `/cron/esign` are 501 stubs — **never arm them**.
- Never render a user/member/org UUID. No native `<input type="date">`.
- **GSTIN / PAN / TAN block nothing.** Do not "fix" this.
- `vercel.json` accepts no comments — a `"//"` key kills the deploy silently.

---

## 4 · Rules for agents — the delegation contract

Launching agents is pre-approved, on **Opus 5**, carrying §3 verbatim. **Do not
tier down**, not even for mechanical stages: a Playwright run is deterministic
code and consumes no model, so token cost tracks the *defect count*, not the
interaction count. The two places a cheaper model costs most are **triage**
(three Phase 8.0 test faults each accused the product of their own bug) and
**backend SQL fixes** (the PgBouncer 500: fine in review, broken live).

An agent inherits every limit in §3 and **has no authority the seat lacks**.

### 4.1 · What an agent may never do

| Prohibited | Why — each already cost something here |
|---|---|
| **Commit or push** | The lead commits. An agent's green is not a landed change. |
| **Kill a process by wildcard** | One agent's `*playwright*test*` cleanup took another agent's suite with it; the run reported a worker abort that reads exactly like a product defect. **Kill the PID you started, or leave it and say so.** |
| **Delete or reuse an `outputDir` that is not its own** | Playwright empties it at the start of a run; two agents sharing one delete each other's in-flight traces. **One `outputDir` per project.** |
| **Pipe a test run through `tail`** | A pipeline exits with the last command's status. A 12-failure run reported `exit 0` and read as green. **Redirect to a file, or read `report.json`.** |
| **Write "the code already does X" from the working tree** | Several agents edit this tree at once; the file you read may be another agent's uncommitted work, and the deploy runs only what is committed. **`git show HEAD:<path>` first**, and say so if you verified against a local backend — a local backend serves the working tree and the deploy does not. |
| **Record a verdict on the four judgements** | Propose with evidence; the lead adjudicates. |
| **Chase a backend fix to green** | An agent cannot deploy. Say exactly which tests stay red and why. **Never weaken an assertion to get a green.** |
| **Use god mode in a write lane** | Suite 19 only. This is why Rule 3 exists. |
| **Run a migration, a `DROP`, or a Railway variable write** | Escalate to the lead with the five-section risk report. |

### 4.2 · What every agent report must contain

- Spec path, test count, pass/fail, **and the second-run idempotence numbers**
  ("0 typed, N already present").
- **§4 volumes achieved vs asked, per entity, as live counts.**
- Every failure with evidence and an explicit verdict: **product bug / test bug /
  blocked / excluded-by-decision** — four different sentences.
- Anything fixed, **with the mutation proof that the check bites**.
- **What was NOT done, and why.** A silent cap reads as full coverage.

### 4.3 · The fleet, and why it is this shape

Agents are used where the work **fans out over independent targets** and the
output is a report, not a decision. They are not used for triage, migrations,
deploys, or anything touching the four judgements.

| Lane | Agents | Isolation | Why |
|---|---|---|---|
| Stage 1 inventory | 3 — Supabase · Railway · Cloudflare | none (read-only) | Three independent systems, no shared state; the output is three lists |
| Stage 2 repair | 1 per finding cluster, max 4 concurrent | **worktree** | They edit code in parallel; a shared tree is how "already does X" went wrong |
| Stage 3–4 waves | 1 per wave, **strictly sequential across waves** | none, but one `outputDir` per project | Waves have data dependencies; parallel waves reseed under each other |
| Suite 22 dead controls | 1 | none | A sweep over 958 operations; pure fan-out |
| Stage 5 mobile | 1 | none | Serialised on two AVDs and one adb |

**Concurrency ceiling: 4.** Above that this machine's Playwright runs start
interfering — measured on 29 Aug, not assumed.

---

## 5 · Tools — what each is for, and what it may not do

| Tool | Used for | Hard limit |
|---|---|---|
| **Supabase MCP `execute_sql`** | Every live query in every report; P1 inventory; P2 blast radius; row-count evidence | **Reads only.** No `INSERT`/`UPDATE`/`DELETE` to satisfy a test — Rule 1 |
| **Supabase MCP `apply_migration`** | Schema changes only, after the five-section risk report | Never an agent. Never without the report first |
| **Supabase MCP `get_advisors`** | After **any** DDL | A new `rls_disabled_in_public` is a breach |
| **Railway MCP** | `list-variables` / `set-variables` (the outbound fence), `get-logs` for a 500, `list-deployments` for deploy identity | ⚠ A **variable write** applies new config; a **redeploy reuses the old snapshot**. This is the cron trap |
| **Playwright, local CLI** | Every suite: `npx playwright test --config=e2e-real/<wave>.config.ts` | **Not** the Playwright MCP — the committed spec is the deliverable |
| **Bash / PowerShell** | Gate scripts, `npm run check`, `npm run build`, `pytest`, `adb` | `pytest` from `backend/`, never the repo root. Never pipe a test run through `tail` |
| **`curl`** | `/api/health` before every wave; deploy identity | A status code is not an outcome — read the row |
| **Cloudflare MCP** | DNS reads for P3b; Pages state | DNS **writes** are an owner decision |
| **Sentry MCP** | Correlating a 500 to a stack, after the Railway log | Sentry silence is not evidence of health |
| **`adb` + `uiautomator`** | Stage 5, both AVDs | Cold restart only — hot reload lies. x86_64 APK only |
| **Artifact** | The report at the end of each stage | — |

**Not used:** the Playwright MCP (the repo suite is the artefact), the browser
MCPs for product driving (they produce no committed spec), and any tool that
would write a row a user should have typed.

---

## 6 · The work — the order I will actually run

### Phase A · Clear the blockers

| # | Action | Tool | Done when | Needs you |
|---|---|---|---|---|
| A1 | OWNER credential into `.env.e2e` | you, or the reset flow | `--project=setup` passes 3 of 3 | **yes** |
| A2 | `check-sender-dns.mjs` reports **when** each domain goes live, not just that it is broken | Bash + node | exits 0 today, red the moment a sender row exists; **mutation-proved** by seeding one row and watching it turn | no |
| A3 | **`unicodegroup.com` SPF** — add `include:amazonses.com` | DNS (IONOS) | gate green for that domain | **yes** — not our zone |
| A4 | **`aekaminc.com` SPF + DKIM**, and a boot check that refuses to start with `FROM_EMAIL` unset | DNS + backend | gate green; unset `FROM_EMAIL` fails loudly instead of silently sending from an unauthorised domain | **yes** for DNS |
| A5 | Re-suppress `64e7bea6` on the production API service | Railway `set-variables` | `/api/health` digest changes from `0` | **yes** |
| A6 | Type `EMP-001…EMP-012` through the Manav form | Playwright | 12 rows in `manav_employees` | no |
| A7 | Run `manav-dummy-logins.spec.ts` | Playwright | 12 `users` rows, 12 links, **0 mails outside the fence** | no |
| A8 | Unsuppress `64e7bea6` | Railway `set-variables` | digest back to `0`, **stated in the report** | no |

⚠ **A5 and A8 bracket A7.** Forgetting A8 leaves a fence a later wave reads as
"mail works" when it is being suppressed — the exact 1,562-row `sent`-vs-
suppressed error in §3.1.

⚠ **A3 and A4 must land before wave 1**, because wave 1 is where senders get
configured. They are DNS changes on two zones and they are the long pole.

### Phase B · Stage 1, inventory & freeze — reads only, safe tonight

Gates **P0 P1 P2 P4 P5**, disciplines **D11 SCA · D17 schema · D18 recovery**.

- P0 `check-production-targets.mjs` — green now, re-run before **every** wave
- P1 three-system inventory → **TOUCH / NEVER-TOUCH lists, each row carrying its
  query**
- P2 blast radius across **300** base tables — plus the §2.1 rule that it re-runs
  before every delete
- P4 `backend/scripts/check_backup_coverage.py`, **before** the first delete
- P5 deploy identity — `meta.branch`, SHA and `current_schema()` on both services
- Cron freeze ledger; R0–R3
- **Bump `pyjwt` to 2.13.0** and run the targeted backend files (five known
  vulnerabilities; it signs every session this programme creates)
- Re-verify the §7 ledger: **every row is a citation until Stage 1 measures it**

### Phase C · Stage 2, repair before re-find

Disciplines **D1 integration · D2 contract · D10 tenancy · D20 mutation**.

| Fix | Before |
|---|---|
| **O-13** — the live-SQL ratchet counts a *string*, not a behaviour, so D1's own gate is unsound | anything relying on D1 |
| **L6** — the project status report reads `public.boards`, 0 rows database-wide | wave 2 |
| **L4** — draft invoices dunned and counted as revenue | wave 3 |
| **V7** — `recurring_invoice_generator` can poison a GSTR-1-filed GST serial | wave 3 |
| **L1 / L2** — payroll pays leavers; flat ₹200 PT in every state | wave 4 |
| **L3 / L5** — two billing 500s (missing `gst_rate`); cross-tenant leak in the newest billing router | wave 6 |
| **V1** — the KB index is empty and Sahayak answers "grounded" on nothing | wave 6 |

### Phase D · Stages 3–6 — the nine waves

**Not before you confirm the morning is stable.** Wave order is fixed:

| W | Suites | Also closes | The trap |
|---|---|---|---|
| 1 | 00 cold-start · 01 auth · 02 org settings | D8 · D13 · D19 | GSTIN blank must save; cards show names, never UUIDs |
| 2 | 03 Core PM · 04 Graha | D1 · D2 | `lost_reason` persists; Aekam Inc's team untouched |
| 3 | 05 Ganit · 06 Kray | D9 · D14 | Drafts not dunned, not revenue; budget warns, never blocks |
| 4 | 07 Manav · 08 Vetana | D17 · D7 | No leavers paid; PT by state **and** gender; the re-run must MOVE the figure |
| 5 | 09 Pahchan | D14 · D4 | Geofence refusal is required, not an edge case; the **test provider**, never `adb emu geo fix` |
| 6 | **19 admin** → 17 client billing → 14 Sahayak | D10 · D12 | ⚠ 19 **must** precede 14 — credit top-up is `require_platform_role` |
| 7 | 10 Vikray · 11 Prachar · 15 eSign · 16 Niyam | D2 · D9 | Unsubscribe **then prove exclusion**; `sign_fields` is 0 rows |
| 8 | 18 portal · 20 cross-cutting · 22 dead controls | D10 · D12 · D6 | Another org's project by id must be refused; compare ID SETS, never bytes |
| 9 | 12 Dristi · 13 Sanvaad · 21 mobile · regression replay | D7 · D16 · D14 | Every headline figure reconciled to its module — this page has printed six wrong ones |

⚠ **Stage 5 (mobile) is unblocked** — the x86_64 APK was built and verified on
2026-08-30. It has been a blocker since 28 Aug and must not be re-discovered.

---

## 7 · What tests must be done

### 7.1 · The suites — 22, across the nine waves

Every one drives the real screens. **No SQL seeding, no API shortcut.** Each
interaction class carries its own proof, and it is never "it did not throw":

| Class | Driven by | Proof |
|---|---|---|
| Text | `pressSequentially()`, never `fill()` | the value commits **and survives a reload** — `fill()` skips the keystrokes a controlled React input listens for |
| Forms | every field, the real submit | the write response → **then the canonical row** |
| Buttons | `click()` | a request fired, **or** the DOM changed, **or** navigation happened. Zero of three is a dead control |
| Selects & dates | `selectOption()`, `setDate()` | the value binds to the row; poll options a fetch populates |
| Drag | `mouse.move/down/move×N/up` | the persisted `sort_order` **after a reload** — `dragTo()` is ignored by HTML5 dnd |
| Upload | `setInputFiles()` on the real input | the object exists in R2 **and** the row points at it |
| Download | `waitForEvent('download')` | the file is **opened and parsed** — a 0-byte download satisfies a naive assertion |
| Email | the product's own send control | the `outbound_log` **row**, never the return value |
| Keyboard | Tab loop reading `activeElement` | focus order, Enter/Space, Escape closes every modal, **a visible focus ring** |
| Two-party | `browser.newContext()` | the eSign counterparty signs as a different person in a different session |
| Mobile | `adb` + `uiautomator` | tap at a dumped node's centre; geofence, network loss, **cold start** |

### 7.2 · The gates that run outside Playwright

| Check | Command | When |
|---|---|---|
| Production targets | `node scripts/check-production-targets.mjs` | before **every** wave |
| Sender DNS | `node scripts/check-sender-dns.mjs` | before every wave that mails |
| Backup coverage | `python backend/scripts/check_backup_coverage.py` | before the **first** delete |
| Backend suite | `cd backend && python -m pytest -q <targeted files>` | after every backend change |
| Frontend gate | `cd frontend && npm run check` **and** `npm run build` | before every push |
| Unit | `cd frontend && npx vitest run` | if anything under `src/` changed |
| Mobile | `cd mobile && npm test` | after any mobile change |
| Rendered IDs | `frontend/scripts/check-rendered-ids.mjs` | waves 1 and 9 |
| DateInput handlers | `frontend/scripts/check-dateinput-handlers.mjs` | continuous |
| Bundle budget | `frontend/scripts/check-bundle-budget.mjs` | waves 3, 6, 9 |
| Touch targets / contrast | `check-touch-targets.mjs`, `check-accent-contrast.mjs` | waves 1–9 |
| Mutation | `python backend/scripts/mutate.py` | Stage 2, Stage 5 |
| RLS advisor | Supabase `get_advisors` | after **any** DDL |

⚠ **`npm run check` exits 0 on unparseable CSS.** The build is not optional.
⚠ **The full local backend run HANGS after a heavy session** — run targeted files
and let CI be the full check.

### 7.3 · The two proofs a wave is not finished without

1. **Mutation.** Every new or repaired check is mutated, watched to go red, and
   restored. A check that has never failed is not a check. **The anchor must be
   unique** — an identical block in the wrong function is a false green in the
   proof itself.
2. **Idempotence.** Every suite runs **twice, end to end**. The second run
   reports "0 typed, N already present". §6 idempotence is proved by running
   twice, not claimed.

### 7.4 · The two disciplines this programme cannot close

**D15 usability** (five strangers — proposal 104) and **D12 pen testing** (an
adversarial pass by someone who did not write the code). Both are
**owner-blocked, not skipped.** Those are different sentences, and collapsing
them is what makes a plan look finished when it is not.

---

## 8 · Evidence, and what "done" means

- **✅ means a row appeared where there were zero**, shown as a live count. Code
  shipping is 🟡. This is the entire lesson of the 84–90 era.
- **Never call a table, column or route missing without a live query in the
  report.**
- **`docs/STATUS.md` and `docs/plans/PROGRESS.md` are updated in the same commit
  as the change.** That is part of "done", not paperwork after it.
- Every wave produces: the live counts, the failures with verdicts, the mutation
  proofs, the idempotence numbers, and **the list of what was not done**.

---

## 9 · The recurring bug shape — check for it first

**A value of the wrong Python type handed to a typed Postgres column, surfacing
as an opaque 500 with nothing on screen.** Four shipped instances, each of which
had never worked for any org since it was written — `batch_id` fed a string into
a uuid column, `salesperson_id` fed `user_xxx` into a uuid, and twice a `$n::date`
handed a `str`.

**When an endpoint 500s, pull the Railway deploy log before theorising.** It
presents as "the button does nothing", or as a CORS error in the console — the
500 escapes before the CORS headers are attached. Only a request listener
separates the two.

---

## 10 · Decisions I need from you

| # | Decision | Why it cannot be defaulted |
|---|---|---|
| **1** | **The OWNER credential.** Either the password for `kevalvshah03+e2e-owner@gmail.com`, or your go-ahead for me to drive the shipped forgot-password flow (the mail lands in `kevalvshah03@gmail.com` via the plus tag — inside the approved recipient scheme, but it is real mail leaving) | 23 of 70 specs use `OWNER_STATE`, and nothing in the repo can mint a token without one of the two |
| **2** | **The two SPF records.** `unicodegroup.com` and `aekaminc.com` both need `include:amazonses.com`. Neither zone is ours to edit | Both go live the moment wave 1 configures senders; `aekaminc.com` is also one unset variable from being the global sender |
| **3** | **May I write the outbound fence?** A5/A8 set and clear `OUTBOUND_SUPPRESSED_ORGS` on the **production** API service. Reversible, and it is the difference between 0 and ~20 hard bounces | A variable write on production, hours before launch |
| **4** | **When does Stage 3 open?** My recommendation: not before the morning is stable | It is a wipe, and the database is about to start growing under it |

**Phase A2 and Phase B need none of the four and can start immediately.**

---

## 11 · What I will not do

- Start Stage 3 in the ten hours before launch, unless you say so.
- Run `manav-dummy-logins.spec.ts` with the fence open.
- Configure the nine `@unicodegroup.com` senders before that domain's SPF
  authorises SES.
- Arm `/cron/reports` or `/cron/esign`.
- Weaken an assertion to turn a red green.
- Commit anything an agent produced without reading it against `HEAD`.
- Record a verdict on the four judgements on an agent's say-so.
