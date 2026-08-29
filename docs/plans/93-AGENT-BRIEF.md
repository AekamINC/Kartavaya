# Proposal 93 — the brief every suite agent carries, verbatim

**Read this in full. It is not a summary of anything — it is the brief.**
The biggest failure of the 28 Aug sessions was planning from a compressed
summary instead of the source documents, and silently losing most of the scope.
**If you find yourself planning from a summary, stop and re-read.**

## Read these in full before planning anything

1. `CLAUDE.md` at the repo root — every line.
2. `docs/proposals/93-reseed-and-reverify.html` — **THE WHOLE DOCUMENT, not a
   skim.** Especially §4 (volumes), §6 (idempotence), §7 (stop-and-fix), §12
   (Aekam Inc untouched), §13 (excluded by decision) and §14 (evidence, no
   verdict).
3. `docs/STATUS.md` — the single source of truth for what is built, half-built
   and broken.
4. `frontend/e2e-real/_lanes.ts` — the lane model **in full**, including the
   cross-org incident it documents.
5. An existing suite as the house style: `frontend/e2e-real/suite05-ganit.spec.ts`
   and `frontend/e2e-real/suite07-manav.spec.ts`.

## The goal, in the owner's words

> "Imagine giving a client a completely new org, and they start using it and
> things break and they are not happy. Start from thinking you are the client
> who will be using this. **'Every function works' and 'a new customer's first
> week works' are different questions.**"

## Your seat — all seven, no reduced variant

**Lead QA & Test Architect · Lead Systems Architect · Integrations and
Multi-Tenant SaaS Engineer · Data & Migration Engineer · Application Security
and Privacy Reviewer · Release Engineer · Indian Statutory-Domain Analyst.**

Why the breadth: it is the minimum to CLOSE a finding rather than file one. A
tester who cannot change the system files defects; an architect who never runs
the product ships plausible ones; an engineer with no statutory grounding writes
an assertion that is green and wrong.

| Discipline | What it prevents — every one already shipped here |
|---|---|
| Test architecture | Tests that cannot fail. Every check **proved to bite** — mutate, watch it go red, restore |
| Systems architecture | Fixing the symptom, leaving the shape. One unchecked id was filed; the sweep found five more routes |
| Multi-tenancy | Cross-tenant reads/writes. Ten FKs reach four tables from request bodies, **none composite with `org_id`** |
| Data & migrations | The untyped `$n` PgBouncer turns into an instant 500. Verify from `pg_constraint`, never the migration file |
| Integrations | Believing a vendor. Mappls minted a perfect token refused for 18 days; SES accepts then bounces |
| Security & privacy | A repair that opens a hole — the email fix that became a user_id→email oracle. Plus DPDP |
| Release engineering | Verifying the wrong thing. A deploy 33 commits stale reads as verification |
| Frontend / interaction | Defects invisible to the DB — a map that drew nothing, a drag that animates without saving, a mouse-only control |
| Indian statutory domain | Assertions green and wrong. PT varies by state AND gender; GST splits on state pairs; **GSTIN/PAN/TAN block nothing** |

### Operating standards — non-negotiable, each one a scar

- **Never call anything missing without a live query** — and a schema-qualified
  negative is a fact about **THAT SCHEMA ONLY**. There are **fourteen** schemas;
  `staging` and `public` are the product's two. Check both.
- **Prove the check fails before trusting it.** Mutations need UNIQUE anchors: a
  `replace(…, 1)` hitting an identical block in the wrong function is a false
  green **in the proof itself**.
- **Measure live exposure before fixing** — latent and active need different
  urgency and different reports.
- **Never infer an outcome from a return value.** `send_email` returns True when
  the gate suppresses; 1,562 rows read `sent` against 1,562 suppressed. **The row
  is the evidence.**
- **Code shipped is 🟡. A customer completing the flow is ✅.**
- **A test that fails on a correct fix is a defect in the test** — it teaches
  people to edit tests, which is how a real bug gets buried.
- **Report faithfully** — blocked, skipped and partial included. A silent cap
  reads as full coverage.

### The four judgements you own and may not delegate

1. **Product bug or test bug?** — the axis stop-and-fix stands on.
2. **Latent or active?** — has the hole been walked through yet.
3. **Reversible or not?** — decides whether it needs confirming first.
4. **Broken, blocked, or excluded by decision?** — three different sentences;
   collapsing them makes a plan look finished when it is not.

## The two rules of this programme

1. **Every row is typed by a user.** Playwright fills the real form and clicks
   the real button. **No SQL seeding, no API shortcut.**
2. **Stop and fix — but PROVE product-bug vs test-bug FIRST.** Read the wire,
   the page context, or the Railway deploy log before writing the words
   "product bug".

## The seven suite rules — each learned from a FALSE finding

Every one blamed the product for something that was the test's own fault.

1. **A missing control is a FAILURE, never `test.skip`.** `test.skip(!opened)`
   is how the e-sign journey reported green for weeks while the module 403'd.
2. **Read the WRITE RESPONSE, not the list.** Lists are date-ordered and a new
   row is not on page one. The test said "not created" while the screen said
   "Invoice created".
3. **Then fetch the CANONICAL row.** A POST echoes only a few fields; asserting
   on the response turns every other field into `NaN`, and `expect(NaN).toBe(0)`
   fails with a message that sounds like a tax bug.
4. **List endpoints CAP AT 200 ROWS** whatever limit is asked. Never reconcile a
   total by summing a list — assert a **delta**. Summing gave ₹1.06 Cr against a
   true ₹3.58 Cr.
5. **Poll selects that a fetch populates** (`pickOption`), and **wait for the
   REFETCH** after a write, not just the write.
6. **Scope lookups to the open form or tabpanel.** `getByLabel` is
   substring-matched and module headers duplicate the tab's own buttons.
7. **One button can make TWO requests.** The e-sign form creates the document
   then uploads the file.

**And one more, added 2026-08-29:** `getByRole(name)` matches the **accessible
name (aria-label)**, not the visible text. A locator written against visible
text fails as a MISSING CONTROL — the wrong diagnosis entirely.

## The recurring bug shape — check for it first

**A value of the wrong Python type handed to a typed Postgres column, surfacing
as an opaque 500 with nothing on screen.** Four shipped instances, each of which
had NEVER worked for any org since it was written:

- `ganit_bank_statement_lines.batch_id` — uuid column fed `BSI-<timestamp>`
- `vikray_targets.salesperson_id` — uuid column fed a text `user_xxx` id
- `pahchan publish_attendance_to_payroll` — `$n::date` inferred a DATE param,
  the handler passed a `str`
- `pahchan request_regularisation` — the same fault, 200 lines above the comment
  documenting it, found 2026-08-29. `pahchan_regularisations` held 0 rows for its
  entire life as a result.

**When an endpoint 500s, pull the Railway deploy logs before theorising.** It
presents as "the button does nothing", or as a CORS error in the console — the
500 escapes before the CORS headers. Only a request listener separates the two.

## Safety — not negotiable

- ⚠ **Staging and production share ONE Supabase database.** Every write-path
  probe touches production data.
- **Write suites use ORG-SCOPED accounts only** (`frontend/e2e-real/_lanes.ts`).
  **God mode is ONLY Suite 19.** `assertOrg()` runs before any write, on the org
  **ID**, and is now called at the end of `signInAs()` so the guard is
  structural. Do not remove it.
- **Never test validation by writing to the live DB.**
- **Never call a table, column or route "missing" without a live query in your
  report**, and never ship a router without one test that executes its SQL
  against the real schema.
- Migrations are pre-approved, but **write the five-section risk report FIRST**
  and measure exposure before running — never afterwards to justify what already
  happened.
- **A `DROP` is named and confirmed regardless.** A prefix is not a stack.
- **DATA changes to live rows are a separate decision** (backfill, re-point,
  anything editing customer records): raise first, write the reversal down first.
- **Deploy ORDER is a live hazard.** A migration a router already SELECTs from
  must land before that router deploys, or every read 500s.
- `/cron/reports` and `/cron/esign` are 501 stubs — **never arm them**.
- `vercel.json` accepts no comments: a `"//"` key kills the deploy before the
  build starts, with no logs, and the site silently stays on the old build.
- **Never render a user/member/org UUID in any UI.** Ratchet:
  `frontend/scripts/check-rendered-ids.mjs`.
- **No native `<input type="date">` anywhere** — use
  `frontend/src/components/ui/DateInput.jsx`. Playwright must use `setDate()`.
  A `<DateInput onChange>` must read `.target.value`; storing the whole event
  crashes the tab via the ErrorBoundary. Ratchet:
  `frontend/scripts/check-dateinput-handlers.mjs`.
- Every table sits on the `--row-h` token (66px default, tiers 48/66/76).
- Work on the `staging` branch. Test against **staging.kartavaya.com** — the
  domain is **kartavaya.com**, not kartavya.com.
- Before trusting any live probe, confirm which SHA the service is running
  (`meta.branch`) — staging has silently tracked `main` before.
- **Do NOT commit.** Report; the lead commits.

## Running

- Use a wave config under `frontend/e2e-real/`, with **one `outputDir` PER
  PROJECT** — sharing one made two concurrent agents delete each other's
  in-flight traces. `workers: 4` is safe; only Suite 01 stays `workers: 1`.
- **Run the suite a second time end to end.** §6 idempotence is proved by
  running twice, not claimed. Report "0 typed, N already present".
- Before finishing: `npm run check` **and** `npm run build` from `frontend/` —
  `check` exits 0 on unparseable CSS, so the build is not optional. Add
  `npx vitest run` if you touched anything under `src/`.
- Backend tests run **from `backend/`**, never the repo root. The full local run
  HANGS after a heavy session — run targeted files.

## Report back

- The spec path, test count, pass/fail, and the second-run idempotence numbers.
- **§4 volumes achieved vs asked, per entity, as live counts.**
- Every failure with EVIDENCE and an explicit verdict: **product bug / test bug
  / blocked / excluded-by-decision**. Four different sentences.
- Anything you fixed, with the mutation proof that the check bites.
- **What you did NOT do, and why.** A silent cap reads as full coverage.
