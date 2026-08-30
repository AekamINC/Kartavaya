# Kartavya — live status ledger

**This file is the single source of truth for what is built, half-built, and
broken. Keep it current.** It exists so the team never again has to spend a
session reconstructing state from thirty scattered status proposals — which is
exactly how proposals 00, 07, 21, 27, 82 and 90 each came to be written.

- **Update this file the moment a phase item lands or a status changes.** It is
  part of "done", not an afterthought (see `CLAUDE.md` → *Keeping status current*).
- The deep history lives in `docs/proposals/`; the plan in `docs/plans/`; the
  arc in `docs/FINAL-VERDICT-00-90.md`. **This is the dashboard, not the archive.**

Last updated: **2026-08-29**. Proposal 93 **Wave 1 is 28/28 GREEN** and Suite 02
covers all 18 screens §10 asks for. Both of the items that were red are closed
and neither was a flake: **02.17 was not sequencing** — the support-session
feature was unreachable end to end by anybody — and **02.12 is now a real R2
round trip**, upload → delete → bin → restore → second stage → destroyed, with
the object proved unreadable at the end.

**Wave 2 has landed:** Suite 04 (Graha) 15/22 with its seven failures named
below, Suite 07 (Manav) at §4 volumes. Migrations **239** (recycle bin) and
**240** (the UUID columns that made contact merge impossible) are applied.
Migration 238 applied; `platform_support` exists on exactly one account for the
first time (§11). The route for the next session is `docs/plans/93-NEXT-SESSION.md`. **BOTH deploys verified — check both, always.**
Backend: Railway staging at `43961e25`, SUCCESS 05:16:47 UTC, branch `staging`
(this line named `cc371297` until 2026-08-27, by which point it was **33 commits
behind** — a deploy line that is not re-read every time is worse than none,
because it reads as verification). Frontend: Vercel serves the current branch
build, confirmed from OUTSIDE by hashing the assets `staging.kartavaya.com`
actually returns — `assets/index-BDKPplLt.js`, byte-identical to what the
`43961e25` deployment serves. Every Vercel deployment here has `target: null`,
so "READY" alone never establishes what the domain serves.
Everything below marked "fixed 26 Aug" is therefore **running**.

---

## 2026-08-30 — 🔴 NO SENDER DOMAIN AUTHORISES SES, AND kartavaya.com HAS TWO DMARC RECORDS

**Found from the zone file the owner supplied, verified live over DoH.** The
outbound analysis had asked whether the addresses we send TO are safe. It never
asked whether the domains we send FROM can deliver.

| Domain | SPF | DKIM | DMARC | MX |
|---|---|---|---|---|
| `aekaminc.com` — **the default**, `email_service.py:13` | 🔴 `include:_spf.google.com ~all` — **SES not authorised** | 🔴 none (OA-12) | 🟡 `p=none` | ✅ Google |
| `kartavaya.com` | 🔴 `v=spf1 -all` — **authorises nobody** | ✅ 3 SES selectors, all resolve | 🔴 **TWO records** | 🟡 none |
| `unicodegroup.com` | 🔴 `include:_spf-eu.ionos.com ~all` — **SES not authorised** | — | 🟡 `p=none` | ✅ IONOS |

**The default sender fails BOTH authentication legs.** `no-reply@aekaminc.com`
through SES has no DKIM and an SPF record naming Google, not Amazon.

⚠ **`kartavaya.com` has two `_dmarc` TXT records** — `p=none` and
`p=reject; sp=reject; adkim=s; aspf=s`. **RFC 7489 §6.6.3: when more than one is
found the domain is treated as having NO DMARC RECORD AT ALL.** So the strict
policy somebody published is not in force, and neither is the permissive one.

**Why this is a blocker at `OUTBOUND_MODE=live` and not a spam-folder problem:**
repeated authentication failures from one identity are how SES throttles and then
suspends it — and this product has **no bounce webhook** (OA-13, a recorded
decision), so it cannot learn it happened. Same asymmetry as the recipient
scheme. Gate **P3b** (`scripts/check-sender-dns.mjs`) now blocks every wave that
mails.

**Owner DNS actions, and the order matters:** SPF first on whichever domain will
send; **then** delete one of the two `_dmarc.kartavaya.com` records — ⚠ *not* by
keeping `p=reject` while SPF is still broken, which would make the domain reject
its own mail; then DKIM for `aekaminc.com`.

Also in the same zone: `api.kartavaya.com` now CNAMEs to Railway (the Vercel
misdirection is fixed) but **HTTPS fails `SEC_E_WRONG_PRINCIPAL`** — the
certificate does not match, so the custom domain is still unusable. The run is
unaffected; `.env.e2e` uses the `.up.railway.app` hostname directly.

---

## 2026-08-30 — OWNER DECISION: OUTBOUND_MODE = **LIVE**, and what now guards the run

**Real mail leaves the building during the 93 v5 production run.** Read live the
same day, and production is already in that state:

    production   outbound_mode = "live"   suppressed_orgs_digest = "0"
    staging      outbound_mode = "dry"    suppressed_orgs_digest = "0"

⚠ **`"0"` is the EMPTY SET.** No org is shielded. `OUTBOUND_SUPPRESSED_ORGS` is
**not a guard and must not be cited as one** — which is a change of substance,
because gate P3 was written to lean on that digest.

**P3 is rewritten as a check on the DATA:** before any wave that sends, assert
that zero recipient addresses fall outside the three approved shapes —

| Share | Address | Why safe |
|---|---|---|
| 45% | `…@simulator.amazonses.com` | never leaves AWS; its bounce/complaint addresses exercise those paths without touching reputation |
| 50% | `kevalvshah03+<tag>@gmail.com`, `kelisweet+<tag>@gmail.com` | real inboxes the owner controls; gmail honours plus tags, proven 18 Aug |
| 5% | `test@unicodegroup.com` — **plain** | ⚠ the `test+<tag>@` form **BOUNCES**; IONOS rejects the plus tag. One probe cost one bounce; the assumption would have cost ~550 |

**Why the pre-flight is mandatory rather than advisory.** Read live across the 30
accounts that exist today: `gmail.com` 18 · `system.kartavaya.invalid` 5 ·
`aekaminc.com` 3 · **`example.com` 2** · `unicodegroup.com` 2. At `live`, a
single mail to `@example.com` (IANA-reserved) or `.invalid` is a hard bounce
against the verified sender domain — and **this product cannot learn that it
happened**, because there is no bounce webhook (OA-13, a decision not a bug). The
run can only avoid causing one. That asymmetry is why it is a gate.

`.env.e2e` carried a superseded note reading *"set dry on production for the 93
rerun, OWED BACK AFTER: live"*. **Replaced** — the tree should not hold two
instructions that disagree.

---

## 2026-08-30 — THE HARNESS IS NOW DOCUMENTED, AND ONE ACCOUNT CANNOT SIGN IN

Proposal 105 §0.9–§0.11 now carry what was missing: the Playwright configs and
projects, the accounts and how each authenticates, the two AVDs and how mobile is
driven, and every interaction class with what counts as proof.

**Verified live 2026-08-30:**

- ✅ **`E2E_ADMIN_TOKEN` still works** — `GET /api/auth/me` returns KEVAL SHAH,
  role `admin`, `module_levels` present.
- ⚠ **and it resolves `org_id: (none)`** — the unscoped platform credential that
  on 2026-08-28 renamed **Aekam Inc** through `platform_bypass`, wrote a UPI row
  into it, and **left the suite green because the save genuinely succeeded**. It
  is Suite 19 and nothing else. This account is why Rule 3 exists.
- 🔴 **`E2E_ADMIN_PASSWORD` does not exist and cannot** — the owner account signs
  in with Google. So `auth.setup.ts` **always fails on the owner**, and that is
  why four projects carry `dependencies: []`. Not a bug to fix; a shape to know.
  `mint-state.mjs` is the documented way round it.
- ✅ `E2E_APPROVER_PASSWORD` present — the half of `setup` that does succeed.

---

## 2026-08-30 — ⚠ THE x86_64 APK EXISTS AND POINTS AT A DEAD HOST

**A new mobile build is needed, and the reason is worse than "it is stale".**

Two corrections to what was said earlier today, both from reading the artefacts
rather than the ledger:

1. **"Stage 5 has been blocked since 28 Aug on something nobody had attempted"
   is WRONG.** `build/Kartavaya-2.0.4-release-x86_64.apk` was built **29 Aug
   15:50**. Somebody did attempt it, and it worked.
2. **That APK cannot reach the backend.** Commit `22b970c9` — *"the Railway
   hostnames were corrected and 58 files still named the dead ones"* — landed
   **29 Aug 16:09**, nineteen minutes after the build, and changed
   `mobile/src/config.js` and `mobile/src/api/client.ts`:

       - 'https://kartavya-staging.up.railway.app'
       + 'https://kartavaya-staging.up.railway.app'

   The missing "a". `config.js` states in its own header that Expo **INLINES**
   `EXPO_PUBLIC_API_URL` into the bundle at build time, so **the shipped APK
   carries the dead hostname**. It is not a stale build; it is a build that 404s
   on every request.

**And a second commit landed after it too:** `e039ce38` (30 Aug 08:35) rewrote
`mobile/src/nav/ShellFrame.tsx` and `mobile/src/theme/tokens.ts` — 1,466 lines
changed across five files. Neither the shell frame nor the theme tokens are in
the shipped APK.

⚠ **Consequence for proposal 93 Stage 5, stated because it changes what a run
would mean:** any mobile assertion made against that APK was made against a
build that could not talk to the API. A green Suite 21 on it would have been a
green run over nothing.

⚠ **Version numbers disagree** — `mobile/app.json` says `2.0.4`,
`mobile/package.json` says `2.0.2`. Not resolved here; recorded so a build is not
named from the wrong one.

---

## 2026-08-30 — PROPOSAL 93 v5 §0: THE RULES ARE NOW IN THE DOCUMENT

**The first cut of v5 said "carried verbatim: the seat, the four judgements, the
operating standards, Rules 1–3, the seven suite rules" — and then POINTED at them
instead of carrying them.** A pointer is a summary. The document warned against
planning from a summary on its first page while being one on its second.

§0 now writes out, in full: **why** the programme exists (the owner's words and
the three consequences), **the seat** and what each of the seven hats prevents,
**the seven operating standards**, **the four judgements**, **Rules 1–3**, **the
eight suite rules** each with the false finding that produced it, **the
interaction vocabulary** that defines what "driven as a user" means, and **the
five organisations**. An agent holding only that file now has the whole contract.

The governing line, carried verbatim rather than described: *a row landing in a
table proves the write path and says nothing about whether the drawer opened, the
drag persisted, the tooltip appeared, or the button was reachable by keyboard.*

---

## 2026-08-30 — PROPOSAL 93 v5: THE PRODUCTION RUN, RESCOPED

**`docs/proposals/105-93-v5-production-and-the-full-qa-set.html`**, route file
`docs/plans/93-V5-RESCOPE.md`. Same scope, same rules, same six stages, nine
waves, twenty-two suites. Three changes: it runs on **production** behind five
new blocking gates (P1–P5); it carries the **full QA discipline set** — 18
disciplines across 20 gates, each with an owner stage, a proving artefact and a
blocking condition; and volumes drop again, **~1,566 → ~569 rows per org** (30%
on large sets, 50% on small, HELD set-covers and DERIVED quantities exempt).

⚠ **The calendar does not fall with the row count** — 10–13 days against v4's
12–14. Rows fall to a third; paths driven are unchanged and eighteen disciplines
are added.

It also carries, in one place, **everything still outstanding across 105
proposals and 27 plans**: 6 live blockers, 19 open findings, 5 also-open suite
items, 7 from the 00–49 arc, 67 orphaned operations, 13 owner-blocked items and
the 8 from the QA audit below. Every row is a citation, not a measurement —
**Stage 1 re-verifies before Stage 2 acts.**

**Nine facts were re-verified live for the rescope, and three ledger entries
turned out to be wrong:** `manav_employees` is EMPTY (not "0 of 98" — the reseed
took them), `mentions` holds 22 rows (not "never once worked"), and **open
finding 14 is NOT a tenancy hole** — the one unscoped `is_org_admin` at
`approvals_router.py:570` can only widen a list to projects the caller is
already a member of, and membership is org-bounded. Reclassified, and recorded
so the next sweep does not re-file it.

**Owed before Stage 1 opens — five, and only ONE is an owner action.** The
rescope first said three were, and that was wrong; two were checked and turned
out to be dev work.

- **dev:** `pyjwt` → 2.13.0 · the x86_64 APK · the O-13 fix
- **split:** backup retention is answered — the org is on the **Pro** plan, so
  7-day daily backups by default and PITR is a paid add-on. **Whether the add-on
  is enabled is not readable through the API**; that half is one look at the
  dashboard, and it decides the real RPO.
- **OWNER:** the `OUTBOUND_MODE` decision for the window. Whether real mail
  leaves the building during a production run is a decision, not a task.

⚠ **The APK had been listed owner-blocked (OA-8) and is not.** The build script
takes `ARCHS`, the Android SDK is present, and Android Studio ships a JBR 21 that
runs gradle. `android_e2e.py`'s "there is no Java on the PATH here" is true and
is a different statement from "there is no Java" — which is how it had been read.
**Stage 5 has been blocked since 28 Aug on something nobody had attempted.**

---

## 2026-08-30 — THE QA GAP AUDIT: NINE DISCIPLINES CLOSED, TWO OWED TO PEOPLE

A survey of the twenty-one standard QA disciplines against this repo found ten
either absent or present-but-toothless. Nine are now closed in code; two — user
acceptance and usability — cannot be, and are specified in
`docs/proposals/104-uat-and-usability.html` instead.

**Every gate below was proved to bite before it landed.** A gate that cannot
fail is the failure mode this repository has already met four times (contrast,
CSP, Mappls, touch targets), and a new one that has never been shown to go red
is just the fifth.

| Discipline | Was | Now |
|---|---|---|
| Cross-browser / platform | 1 engine, 1 viewport | **7 projects**, matrix + read-only deployed smoke |
| Accessibility | 2 gates that ran nowhere; 1 of them report-only | 9 rendered rules + both gates armed, one ratcheted |
| Performance | nothing, ever | brotli bundle budget + CLS/DOM/API-call budgets |
| Visual regression | script existed, wired nowhere | computed-style contract, 15 selectors, committed |
| i18n | 1 jsdom assertion | 5 rules across all 4 languages, in a browser |
| Mutation testing | by hand, when remembered | `scripts/mutate.py`, 4 operators |
| Dependency scanning | `|| true` on both suites | two ratchets, 41 advisories recorded |
| Disaster recovery | one sentence, never re-read | measured, ratcheted, runbook written |
| UAT / usability | never done | specified, owner-blocked |

### 🔴 THE TWO AUDITS WERE SWALLOWING 41 ADVISORIES

Both dependency audits ran with `|| true`, so neither could ever fail. They were
hiding:

- **Backend, 24 vulnerabilities in 6 shipped packages** — `starlette` 7,
  `cryptography` 6, **`pyjwt` 5**, `python-multipart` 3, `pypdf` 2,
  `weasyprint` 1 (no fix available). `pyjwt` is what signs and verifies every
  session in this product. Fixes exist for all but weasyprint.
- **Frontend, 17 advisories, 4 High** — all in `axios` (10), `react-router` (6)
  and `form-data` (1, transitive under axios). Patched in `axios >=1.18.0` and
  `react-router >=7.18.2`.

Both are now ratchets — the known set recorded by name, the next one fails the
build. **They are not fixed.** The frontend upgrade regenerates `yarn.lock`,
which from Windows rewrites esbuild `linux-x64` to `win32-x64` and breaks the
deploy, so it must come from a Linux checkout. The backend bump needs the full
suite behind it. **`pyjwt` first.**

### 🔴 THE REVERSAL PATH IS NOT A DATABASE BACKUP

`premerge_backup_20260829` was recorded as "258 tables, 29,608 rows, the
reversal path for the consolidation" and never re-read. Measured read-only:
**265 tables, 30,364 rows** — and **42 `public` tables are not in it at all**,
24 of them holding **5,887 rows**: `tasks` (364), `users` (30), `teams` (41),
`team_members` (206), `notifications` (2,850), `activity_events` (1,254) — the
entire core PM domain.

**The backup is correct and is described as bigger than it is.** It snapshots
the pre-merge `staging` schema; tables that already lived in `public` were never
in it. As a consolidation reversal it is complete. As "the backup" it is not,
and in an incident nobody re-reads a migration note — a restore from it would
*succeed* and silently recover no tasks, users or teams.

Full account and runbook: **`docs/DISASTER-RECOVERY.md`**. Repeatable check:
`backend/scripts/check_backup_coverage.py` (read-only; refuses to run without a
DSN rather than skipping). **No restore has ever been rehearsed**, and the
Supabase project's own retention and PITR status — the only full-database path —
is still unknown.

### 🟡 MUTATION TESTING FOUND A CROSS-TENANT GUARD WITH NO TEST BEHIND IT

`backend/scripts/mutate.py` disables a guard and asks whether anything notices.
Against `approvals_router.py` and all five approvals test files: **3 killed, 8
survived.** The one that mattered was line 461 — the fix whose own comment reads
*"THE ADMIN HATCH IS NOW SCOPED TO THIS ORG, AND TO THIS TASK. It was
`is_org_admin(...)`, which is True for an admin row in ANY organisation."*
Disabling that guard entirely left the whole suite green.

So the fix for a cross-tenant hole had nothing pinning it, and anyone
simplifying that line back would have reopened it against a green suite —
exactly how it got in the first time. **Two tests added, both directions; the
mutant now dies (4 killed, 7 survived).** The remaining 7 survivors are listed
by line and are open questions, not confirmed bugs.

### 🟡 PERFORMANCE: `/api/teams` IS FETCHED FOUR TIMES PER PAGE

The first measurement of anything performance-shaped in this repo.

- **Bundle**, brotli — ENTRY **161.1 KB**, largest lazy chunk 41.0 KB, TOTAL
  3.05 MB across 345 files. Budgeted with 5% tolerance.
- **Layout stability is good**: CLS 0.0003–0.009 against a 0.1 threshold.
- **Over-fetching is not.** StrictMode doubles effects in dev, so 2× is an
  artefact and **3× or more cannot be**: `/tasks` requests `/api/teams` **8
  times** (four real callers in production), `/api/tasks` 6×, `/api/categories`
  4×; every page fetches `/api/auth/me` 3×. Baselined by page; a new one fails.

Two earlier versions of this budget were wrong and are recorded in the spec:
gating on total requests measured *Vite's dev module graph* (226–269 per page),
and gating on total API calls measured *StrictMode*.

### 🟡 ACCESSIBILITY: 9 RULES, ONE REAL FIX, TEN BASELINED

Nine rendered rules — image alt, accessible names, label association, ARIA
reference integrity, id uniqueness, heading order, positive tabindex, landmarks
and `lang`, and a keyboard/focus-visibility pass. Written against the DOM
directly rather than adding `@axe-core/playwright`, for the same lockfile reason
as above.

- **Fixed**: the `/tasks` search field was named only by its placeholder — the
  only unlabelled field in a ten-page sweep. Now `aria-label="Search tasks"`.
- **Baselined**: all ten module pages jump **h1 → h3**, so a screen-reader user
  cannot navigate by structure.
- **Not a finding**: 53 `aria-controls` on inactive tabs. That is the standard
  lazy-panel pattern (`ModuleTabs.jsx` sets `aria-selected`; pages render only
  the active panel). The rule was narrowed to the shape that *is* a bug — a
  SELECTED tab whose panel is missing.
- **Armed**: `check-touch-targets.mjs` was **report-only and ran nowhere** — it
  exited 0 no matter what it found. Now ratcheted at 10 known controls under
  44px. `check-accent-contrast.mjs` also ran nowhere. Both are now in
  `npm run check` (20 gates) and in CI.

### 🟡 i18n: ENGLISH IS NOT ENGLISH-ONLY, AND GUJARATI IS HINDI

`src/lib/i18n.js` states the defect by count — *"five of the six are covered and
77 leak, so a user who chose English is reading three scripts"* — and nothing
tested it. Now measured in a browser with `innerText`, which is the load-bearing
choice: it reports **rendered** text, so it can tell the six CSS-hidden class
names from the 77 that are not. jsdom cannot; `textContent` cannot.

- **EN leaks on `/dashboard`**: the Vikram Samvat date, the Sanskrit greeting
  and the Gita verse.
- **EN+GU renders DEVANAGARI on `/dashboard`**, weekday names included —
  `lib/labels.js` predicted exactly this.
- The brand wordmark is exempted **by exact string**: it is the logo, not a
  translation leak.
- Baselined **by surface, not by word** — the weekday strip and the verse rotate
  daily, and a baseline that changes by the day gets deleted.

### ⚠ THE HARNESS BUG THAT WOULD HAVE PRODUCED THREE FALSE FINDINGS

All three new browser suites were seeded with `{data: [], total: 0, …}`, copied
from `f32-write-gating.spec.ts` where it is correct. It is not correct on
`/dashboard`, which reads `/api/tasks` as what its own comment says it is — *"a
bare array"* — and throws `{} is not iterable` into the ErrorBoundary. **The
ErrorBoundary leaves the shell standing**, so a character-count floor passed and
every rule measured a sidebar:

    engine    stub          rendered text
    chromium  envelope       1,255 chars     <- shell only
    chromium  bare-array     2,323 chars
    webkit    envelope         955 chars     <- looked like a WebKit crash
    webkit    bare-array     2,019 chars

Caught before anything was written up. All three suites now use a bare array and
assert **no ErrorBoundary marker**, not merely a length. The first a11y run had
also reported "no `<main>` landmark" on all ten pages and "the page is
unreachable by keyboard" — both the same class of error: measuring before React
had mounted.

---

## 2026-08-30 — CROSS-BROWSER AND CROSS-PLATFORM COVERAGE NOW EXISTS

**Until today every browser-driven test in this repository ran on one engine at
one viewport.** All three Playwright configs declared a single project, `Desktop
Chrome` at 1280×720 — 69 specs against deployed staging, 4 against a stubbed
local build. So "does Kartavaya work in Safari?" and "does it work on a phone?"
were not answered *no*; they were **UNKNOWN, under a green suite**. That is the
same shape as the contrast, CSP and Mappls gates: absence reading as coverage.

`frontend/playwright.matrix.ts` is now the single definition of the matrix —
**seven projects**: Chromium, Firefox, WebKit, an Android phone (Pixel 7, which
is also the Capacitor WebView the APK ships), an iPhone, an iPad and an Android
tablet at the `Tab_A11_Plus` geometry the native Suite 21 already drives.
`PW_BROWSERS` selects (`all`, `desktop`, `mobile`, `tablet`, or names); an
unknown name **throws at config load**, because a typo that silently ran zero
projects would report green over nothing.

**Where it runs, and the blast-radius rule that decides it.** The stubbed suite
(`frontend/playwright.config.ts`) defaults to the whole matrix — it writes
nothing, stubs every `/api/**` and drives a local vite. The two suites that
WRITE stay on `chromium`: staging and production share one database, and seven
passes of real rows to learn something about CSS is not a trade worth making.

### The first run: 150 pass, 44 fail, and 41 of the 44 are real

| | |
|---|---|
| Tests, matrix | **233** (was 35 on one project) |
| Pass | 150 |
| Baselined failures | **44** — `frontend/scripts/playwright-baseline.json` |
| — already failing in Chromium | 3 (proved by `PW_BROWSERS=chromium`, which reproduces the old behaviour exactly) |
| — NEW, Safari or phone-width only | **41**, across 8 distinct tests |
| Firefox | **could not launch on this Windows desk** — 33× `browserType.launch: spawn UNKNOWN`, the same fault `real.config.ts` records for `channel: 'chromium'`. NOT baselined: a browser that will not start is missing coverage, not a known failure. It launches on the ubuntu runner. |

Baselined on the `run-vitest-baselined` contract — a NEW failure fails the
build, a FIXED one is printed, **the file may shrink and never grow**. Runs
nightly (`nightly.yml` → `cross-browser`), not per push: 233 tests every push
against a free org's 2,000-minute month is the largest line on the bill.

### 🔴 NEW — the Skill-pack step editor does not work in Safari, or at phone width

`skill-data-steps.spec.ts` — **7 of its 8 tests** pass on Desktop Chrome and
fail on `webkit`, `ios-safari`, `ipad-safari` and `android-chrome`. The first
one to break says what the rest are downstream of:

    locator('.sk-step').first().getByLabel(/What to read/)
      .locator('optgroup[label="Read your data"]')
    Expected: 1   Received: 0

The grouped function list renders **zero `<optgroup>` elements** in WebKit, so
nothing after it can pick a function and six further tests time out. Not
investigated further today — recorded, not fixed.

### 🔴 NEW — the invoice gate banner does not clear on "Save as draft", in Safari

`invoice-form-gate.spec.ts` → *"Save as draft instead" posts the same form with
doc_status=draft*. Passes on all three Chromium projects; on all three WebKit
ones the Rule 46 danger note stays up:

    locator('.gn-gaps')  Expected: hidden   Received: visible
    <div role="alert" class="note note--danger gn-gaps">

A Safari user saving a draft is still shown a red "gaps" alert for a save that
succeeded.

### 🟡 NEW — `@vercel/analytics` is broken on the Cloudflare Pages origin

Found by `e2e-real/xbrowser-smoke.spec.ts` on its first run, in **all six
engines that launched**. `@vercel/analytics` requests
`/_vercel/insights/script.js`; on **`kartavaya.pages.dev`** — which is where
`E2E_BASE_URL` in `.env.e2e` actually points the whole e2e-real suite —
Cloudflare's SPA fallback answers `200 text/html`, and the browser refuses to
execute it. One console error on every page load. Measured with curl on both
hosts:

    kartavaya.pages.dev/_vercel/insights/script.js  -> 200  text/html
    staging.kartavaya.com/... (Server: Vercel)      -> 200  application/javascript

So it is **host-specific, not engine-specific**, and analytics has never worked
on the Pages origin. Recorded in `KNOWN_DEFECTS` in that spec — new console
errors still fail. The fix is a product decision (drop the package now the site
is on Pages), not a test change.

### ⚠ The harness fault that would have made every WebKit run look like a product failure

`frontend/playwright.config.ts` pointed `VITE_BACKEND_URL` at
`http://127.0.0.1:9` — port 9 is discard, so an escaped request dies loudly.
**WebKit refuses port 9 in the network layer, before Playwright's `page.route`
interception sees the request:**

    Not allowed to use restricted network port 9: http://127.0.0.1:9/api/auth/me

The stub never fired, `/auth/me` never resolved, and the app correctly rendered
"Could not reach Kartavaya". **That alone was 94 of the first run's 142
failures, and not one of them was a product defect.** Chromium hides the
difference because its own bad-port check runs after interception. Now
`59999` — unassigned, above the bad-ports list, closed. 142 → 77 on that one
line. Do not tidy it back to a low port.

### What cross-browser answered that was previously open

`real.config.ts` records at length that Vercel bot mitigation returned
`403 / x-vercel-mitigated: deny` to `chromium-headless-shell`, fixed with
`channel: 'chrome'`, and leaves open whether Firefox and WebKit would get
through. **They do.** Every engine that launched got `HTTP 200` with the header
absent — including WebKit and both mobile Safaris, which have no such channel.
The read-only smoke prints that header on every run, so it stays measured.

Also proven for the first time, on the deployed app: the bundle boots in WebKit,
no page scrolls sideways at 390/412/1080/1138px, and the sign-in controls clear
the 44px tap minimum — the rendered rectangle, not the CSS declaration
`check-touch-targets.mjs` reasons about (a gate which, separately, runs in
neither `npm run check` nor CI).

---

## 2026-08-29, third session — the deploy line, re-read

⚠ **The two lines above are STALE and are kept only as the record of how that
verification was done.** Re-read today:

**Backend:** Railway staging at **`1c749a45`**, deployment `e76030e0`, SUCCESS
07:52:56 UTC, branch `staging`. **Frontend:** Vercel deployment
`dpl_2yNhfY7t…` READY on the same commit — and confirmed FROM OUTSIDE rather
than from "READY", because every deployment here has `target: null`:
`staging.kartavaya.com` serves `assets/OrgSettingsPage-0z0Ul-en.js`, which
**contains the new GST-state control** (`GST state`, `org-state-code`,
`Not set`). ⚠ The main `index-*.js` does NOT contain it and that is not a
failure — this app is code-split, so grepping the entry bundle for a settings
screen proves nothing. Find the chunk.

### `fbb1f0c5` was a save point. It is now verified.

All three gates green on it, unchanged: `npm run check` 0 (16 gates),
`npm run build` 0, `npx vitest run` **3153/3153 across 191 files**. The three
diffs committed unread were read line by line and every claim re-measured live;
all three hold. One number in them did not — "12 of 18 org owners/administrators"
counts GRANT ROWS, not people (18 grants = **15 distinct accounts**, 12
mismatched = **10 accounts**). Corrected in both files.

### The dominant defect class, named — THE ROUTE EXISTS, THE SCREEN CANNOT ASK

**Five instances found today by five independent pieces of work.** This is no
longer a coincidence; it is the shape to sweep for, and
`docs/plans/93-E-ORPHANED-CAPABILITY-SWEEP.md` is the sweep.

- 🔴→✅ **An org's GST state code could not be set by anybody.**
  `_PROFILE_COLUMNS` is one tuple serving the GET projection, the PATCH
  allowlist AND the RETURNING list, and `state_code` was in none. No route, no
  screen, and no `UPDATE` targeting that column existed anywhere in the backend
  — **every organisation was born NULL and nothing could change it**. Meanwhile
  `client_billing` refuses outright: "this organisation has no state_code, so an
  invoice cannot be raised". **2 of 5 live orgs sat permanently unable to
  invoice.** Fixed, deployed and proved live. Aekam Inc and Demo remain NULL —
  a backfill is a data change and is the owner's.
- 🔴 **Sales-target attainment can never move.** `vikray` joins
  `graha_deals.assigned_to = vikray_targets.salesperson_id`; `DealCreate`
  accepts `assigned_to` and **no form in the product sends it**. Live: 30 deals,
  **0 assigned**, 8 won, 10 targets all carrying a salesperson. Ten people hold
  a target that reads zero forever.
- 🔴→🟡 **A purchase order could never be amended.** `PATCH
  /procurement/purchase-orders/{id}` is complete and deployed, and
  `PurchaseOrderDetail.jsx` already RENDERED a "Revision history" panel — and
  nothing ever called the route. `staging.ganit_po_revisions`: **0 rows, all
  orgs, all time.** A draft raised by mistake could not even be corrected.
  Control built; 🟡 until it deploys and a revision row exists.
- 🔴 **Client billing, three dead ends.** `PATCH /billing/service-lines/{id}`
  exists but the ended-lines table has no action cell, so **a paused
  subscription can never be resumed**. `POST /billing/metered-usage/
  generate-invoice` exists but no screen offers the button, so **metered usage
  can never be billed**. And the inverse: the rate-card Delete button calls a
  route that **does not exist** — the deployed OpenAPI publishes PATCH only, so
  the customer is shown a raw **"Method Not Allowed"**.
- The two older ones `routers/graha.py` already documents in its own comments —
  `territory_id` and `contact_id`, both "writable and unreachable".

### Fixed — four approval WRITES asked "is this an admin" without asking "of which company"

`server.py` had already been swept for this exact pattern; **`approvals_router.py`
was left behind.** Every `is_org_admin` call there was the one-argument form,
which is True for an admin row in ANY organisation, paired with
`fetch_task_or_404`, which is one unfiltered `SELECT … WHERE task_id=$1`.
`approve`, `reject`, `client-approve` and `client-reject` all wrote; the two
client routes also skipped the `task_clients` row that is the whole of a
client's authority. ⚠ A comment directly above the call **claimed** it was
org-scoped. It was not.

Exposure measured BEFORE the fix: **15 accounts could walk through it; 4 tasks
have ever been decided; 0 by an outsider — LATENT.** Fixed with both predicates
(`delete_task`'s rule: a destructive write may not be one predicate short),
**4 mutations proved to bite**, 196 tests green. One call site is deliberately
left unscoped and documented as such, with a test pinning the count at one.

### Suites — first runs

    Suite 03 core PM          5 passed  18 failed   11 cascade from 03.4
    Suite 06 Kray (NEW)      10 passed   2 failed   both = the revision finding
    Suite 10 Vikray           5 passed  12 failed    8 from one test-bug helper
    Suite 17 client billing   2 → 8 passed, 10 → 4 failed  after the state_code fix

⚠ **Suite 03's 03.4 is not a server fault.** Railway HTTP logs across the whole
run window show only `OPTIONS` and `GET` on `/api/teams` and **zero 5xx** — no
`POST /api/teams` ever reached the server. The write never left the browser.

**§4 volumes on Unicode Group, measured live** — the shortfalls are named rather
than absorbed: members **8/18**, projects **2/8**, tasks **20/80** (and all 20
are the protected set — Suite 03 created none), orders **0/35**. At or above
target: clients 25, contacts 53, deals 30, invoices 53, employees 30, targets
10, POs 12, PO lines 34, receipts 10, approvals 6, budgets 4.

✅ **The protected set is intact** — `team_ae1d58543b21` "Aekam Inc", exactly 20
tasks, and they are the ONLY tasks in Unicode Group.

### Outbound — measured, and deliberately NOT frozen

`GET /api/health` reports **`outbound_mode: live`**, `suppressed_orgs_digest:
"0"` — nothing shielded. Exposure was measured instead of the mode being
flipped: of 54 sends in 3 days, 40 went to the owner's own gmail tags, 12 to
unroutable `@example.com`, 2 to the owner's own `@unicodegroup.com`, and
**0 to any third party**. Unicode Group holds 53 contacts with **0 third-party
addresses**. Flipping to `dry` would have destroyed §3's ability to assert
ARRIVAL rather than acceptance and added a restore to R9 for no safety gain.
⚠ **Suite 11 is the one suite that mass-sends and must re-measure before it does.**

### ⚠ Two method notes that cost real evidence today

- **Piping Playwright through `tail` truncates the failure blocks AND masks the
  exit code** — a 12-failure run reported `exit 0`, because the pipeline exits
  with `tail`'s status. Read the JSON reporter's `report.json`, and force
  `PYTHONIOENCODING=utf-8` on Windows or cp1252 breaks on this repo's prose.
- **`test_every_writer_has_a_live_sql_test` counts a STRING, not a behaviour.**
  `_PREPARES` is the bare substring `"prepare("` matched against the whole file,
  so a test that only MENTIONS `prepare()` in prose credits the router it
  imports with live-SQL coverage it does not have. One file is exactly that
  shape today. Third time a static ratchet here has been caught this way.
  Tightening it is its own change and is not made yet.

Legend: ✅ done · 🟡 half (code but no data/screen, or partial) · 🔴 wrong now
(broken in the running product) · ⬜ not started · 🔵 research/decision · ➖ n/a

---

## Fixed 2026-08-27 — the custody register's write path had never worked

`POST /offboarding/{employee_id}/lines` answered **422 to every caller** since the
router shipped: `from __future__ import annotations` plus `@limiter.limit` meant
FastAPI could not resolve `CustodyLine` from the wrapper's globals and treated the
body as a **query** parameter. Invisible locally — Python 3.14 resolves it, the
container's **3.13** does not — so a green 14,521-test suite sat on top of it.
Found by reading CI instead of recognising it. Held by
`test_postponed_annotations_and_wrappers.py` (2), which fails on the combination
rather than the runtime symptom.

**The live counts are the proof, and they are stark:**

    staging.manav_offboarding            10 rows   (all E2E)
    staging.manav_offboarding_custody     0 rows

Ten people have been offboarded and **not one custody line has ever been
recorded against any of them** — laptops, DSC tokens, keys, none of it. That is
what a 422 on the only write path looks like from the data side, and it is why
`docs/plans/PHASE-6` insists a router ships with a test that executes its SQL.
There is one now (`test_custody_router.py`) and it was passing throughout: it
runs on 3.14, where the bug does not exist.

## The Aekam-side member-email leak — CLOSED 2026-08-27

✅ **Fixed, not exempted.** `POST/PUT /api/teams/{id}/members` returned a project
member's email address to any of the **10 platform accounts**, in any of **5
organisations**. And the cause was a repair to an earlier repair: the
`GET /api/users` privacy fix removed 50 addresses from one response, which broke
TeamsPage's add button for platform staff, and `79079e14` fixed the button by
resolving `user_id → email` server-side and returning it — **a user_id-to-email
oracle covering all 50 live user rows**, one call at a time. `af74d321` then
added the `is_platform_staff` bypass, opening it across orgs.

Both routes now return an address **only when the same request supplied one**,
and return `display_name` in its place. Two things fell out that were not the
brief: `TeamMemberOut` returned no name at all, so TeamsPage's
`m.display_name || m.full_name || m.email` fell through to the ADDRESS on every
add and every role change — withdrawing the email without adding a name would
have left every fresh card reading `'?'`. And `update_team_member` carried the
same leak **invisibly**: its disclosure is `RETURNING *` plus a model field, so
the SQL-literal scanner can never see it. Fixed alongside.

`test_every_aekam_side_leak_is_either_fixed_or_named` is **green for the first
time in days** — the whole backend suite is now 0 failed. The one `ALLOWED`
entry covers only the WRITE, and was written *after* the fix so it is a true
sentence: `public.team_members.email` is `NOT NULL` and is a pending invitee's
sole identifier (`project_assignments` has no `email`, `status` or `member_id`
at all), so the `INSERT`/`DELETE` literals can never leave. Three cases in
`test_teams.py` pin it, and the guards were reverted to prove they bite.

Live before the fix, read-only: 212 team-member rows over 45 projects in 5 orgs,
**every one carrying an address**, 24 distinct; 10 platform accounts (4 admin,
4 staff, 2 manager).

🟡 **Still open and the owner's call: the bypass itself.** `is_platform_staff`
is unscoped, so those 10 accounts can write membership rows into all 5 orgs —
including the one org none of them belongs to. That contradicts `may_act_in_org`
beside it, but narrowing it would re-break the 403 that `af74d321` fixed. Also
flagged: the picker's de-duplication silently stopped working for platform staff
(same root cause), and `TeamMemberAdd` drops the `receives_approval_emails` and
`company_name` the form posts, though both columns exist.

<details><summary>The finding as originally written, kept for the record</summary>

**`server.py::add_team_member` returns a customer's email address to Aekam.**
`POST /api/teams/{team_id}/members` resolves `SELECT user_id, email FROM users`
and answers with `TeamMemberOut`, whose `email: str` is required.
`is_platform_staff` bypasses the project-membership check (`server.py:3865`), so
platform staff can call it against any customer's project and read the address
back. The standing rule is that Aekam must not see client emails.

Two remedies, both needing a decision rather than a keystroke: split it behind an
`include_contact` argument defaulting to False — what `billing.py::_balance_body`
and `credits.py::usage_by_person` already do — or record in
`tests/test_platform_privacy.py::ALLOWED` why Aekam may see it. The second is a
claim, not a fix. Until one is chosen,
`test_every_aekam_side_leak_is_either_fixed_or_named` stays **red on this one
thing**, which is the gate working. It reported three findings until 2026-08-27;
the other two were the scanner matching a route path and a `'email'` string
literal, and two `ALLOWED` exemptions had already been spent covering for it.

</details>

## Open findings 1, 2, 4, 7, A and D — CLOSED 2026-08-27, three wider than filed

Full detail in `docs/plans/PROGRESS.md`. The headline is that sweeping for the
SHAPE rather than the reported symptom found more in three of six cases.

- ✅ **`create_deal`'s unchecked ids — and FIVE more routes.** Live exposure
  measured first and it is **0 cross-org rows on every pair** (latent, like the
  `territory_id` control). Ten FKs reach these tables from a request body and
  **not one is composite with `org_id`**. Beyond the filed finding: **
  `compute_lead_score` re-read the RAW `body.contact_id` after the guard** — a
  cross-tenant WRITE that survives a perfectly guarded INSERT — and
  `create_activity`, `create_follow_up`, `create_document`, `update_document`
  all carried the same hole. The follow-up one is emailed by the reminder job,
  so it reached another firm's notifications. 27 tests, **19 mutations each
  proved to bite**.
- ✅ **The reason a deal was lost can now be saved.** 22 deals stand in stage
  `Lost`; 2 carry a reason and **neither can have come through the PATCH**. A
  drift ratchet now pins `DealUpdate.model_fields == _DEAL_COLS` both ways. ⚠ A
  latent PgBouncer 500 was found beside it: `pipeline_id` was outside the typed
  branch of the SET-build.
- ✅ **The vendor form captures an address.** Unicode **6 of 9** and E2E **40 of
  75** vendors carry one in a column no screen could write. Non-destruction is
  two independent guards, and the 43-single-character-key fossil is the
  mandatory test case, not an edge case.
- ✅ **The two address renderers agree**, on `city, state, pincode, country`,
  because **a PIN does not imply its state** — 51 of 18,839 cross a state line.
  ⚠ Fixed in passing: `_fmt_addr` joined raw jsonb, so a pincode stored as the
  NUMBER `395002` raised `TypeError` — a **500 on the invoice**.
- ✅ **`TeamMemberAdd` persists what the form posts.** **0 of 212** rows carried
  a company and **0** had the approval flag off — the toggle had never once
  been saved, in any org. Written to `users` as well, because that is where
  `request_task_approval` reads it.
- ✅ **The subtasks 500 is fixed at the cause.** The guard already at HEAD was
  the SYMPTOM, copy-pasted four times: `db.py` registers a jsonb codec, so the
  value arrives decoded. One named helper now, and both its branches are real —
  **54 live rows are double-encoded jsonb strings**. ⚠ The suite stayed green
  because `tests/helpers.py` defaults every jsonb column to a STRING: the
  fixture tested the world of a year ago while the endpoint 500'd.
- ✅ **The picker de-duplicates again** — on `user_id`, never on email. The leak
  fix had left `u.email` undefined, so nobody was filtered and re-adding an
  existing member DELETEd and re-INSERTed their row.

**Still open from this batch:** `doc_validation.py:152` is a THIRD address
vocabulary and omits `country`; **54 double-encoded `tasks.subtasks` rows** need
a data migration (a production write, recorded not done); `tests/helpers.py`'s
jsonb fixtures mis-shape every route they feed; the pending-invitee carry-over
at `auth_router.py:1195`; and one Sentry issue (`PYTHON-FASTAPI-G`) that is
already fixed at HEAD by `ed8e9281` and **needs only a deploy** — its last event
predates the fix by nine minutes.

## Live blockers — wrong in the running product (fix first: `PHASE-2`)

| | Blocker | Where | Status |
|---|---|---|---|
| 🟢 | Dunning chased 54 documents nobody owes money on | `reminder_service.py:_INVOICE_SCAN` | **FIXED 26 Aug.** Phase 2 closed "draft invoices dunned" across four surfaces and **missed the one that sends the email**. Live before the guard: **359** `invoice_overdue` rows against drafts, credit notes and zero-balance invoices — 347 in E2E where the outbound fence suppressed them, **12 in Unicode Group where it did not**. One went out at 13:04 UTC reading *"Invoice INV-2026-0007 is overdue. Balance: ₹0.00"*. Three guards added; 228 dunnable → 174 |
| 🟢 | Payroll pays 10 leavers | `vetana.py:1221` | **DEPLOYED 26 Aug** — guard live at `120d106c`, mirrors `metrics/manav.py:79`. **PROVEN BY A RUN, not a dry-read.** The E2E 2026-08 run executed 08:46:48 UTC against the deploy: **51 payslips, not 60**, `present_days` spanning 2 to 26 — the mid-month leaver credited 2 days, not a month |
| 🟢 | Professional tax is now settable, not hardcoded | `vetana.py`, `PtLadderSection.jsx` | **Migration 221 APPLIED** — `month smallint NULL` (NULL = every month), verified from `pg_constraint`. Nothing could write `pay_professional_tax` before: every backend reference was a read. Now a per-org ladder with a settings screen, resolving `org+month → org+all → shared+month → shared+all → ₹0` — falls back, never refuses. A shared row is read by everyone and editable by nobody. The Maharashtra February figure is deliberately NOT seeded: `statute_calendar` has no PT rows to check it against |
| 🟢 | Flat ₹200 professional tax, every state | `vetana.py:746` | **DEPLOYED 26 Aug** — slab read live. All 9 `pay_professional_tax` rows re-pointed to `org_id IS NULL` (shared): MH `27`×3, GJ `24`×4, KA `29`×2 — verified live. Employee states backfilled for BOTH payroll orgs (Unicode 25/26 → `'24'`, E2E **71/71 → `'27'`**), so PT does NOT drop to ₹0. **The run happened.** Actual: **₹10,000** across 51 — not the ₹10,200 predicted, because pro-rating drops the leaver's gross into the ₹0 band. The two fixes composing correctly, which a prediction from either one alone could not have got right. Phase 0.24 seeding is no longer the blocker it was |
| 🟡 | Two billing endpoints 500 | `client_billing.py:459,705` | **DEPLOYED 26 Aug** — `gst_rate` dropped, `invoice_number` allocated, `balance_due` bound (2nd bug found). Row on the board still owed — needs one real create |
| 🟡 | Draft invoices dunned + counted as revenue | `documents.py:307`, `dristi.py:354` | **DEPLOYED 26 Aug** — 4 surfaces. ⚠ The statement had ALSO been 500ing on a date bind since it shipped; fixed. Still open: project report dead on `staging.time_entries` (exists only in `public`); `dristi.py` `/overview` + the pivot dashboard still count drafts and the pivot carries the same date-bind bug |
| 🟢 | Cross-tenant leak — profile create/list not org-scoped | `client_billing.py:220` | **DEPLOYED 26 Aug** — ownership check + **7** id-alone joins (plan named 2); AST ratchet added. 0 rows had leaked |
| 🟢 | Inline pre-paint bootstrap blocked by a stale CSP hash | `vercel.json`, `index.html` | FIXED + DEPLOYED 26 Aug (`2ef060a9`) — one inline script, one allowed sha256, no match, so `data-theme`/`data-conv-*`/`data-platform` never ran: wrong-theme flash every load, and on Windows a frame of blurred sidebar. Found in the DEPLOYED console, invisible to build and tests. `check-csp-hash.mjs` now first in `npm run check` |
| 🟢 | Applying a project template twice duplicated the whole board | `routers/templates.py`, `TemplatesPage.jsx` | **FIXED 29 Aug — not yet deployed.** Measured on `S3 Project 05`: `To Do`, `In Progress`, `In Review`, `Approval`, `Done` each present **TWICE at the SAME `sort_order`** (0,0 / 1,1 / 2,2 / 3,3 / 4,4) — board doubled AND its order ambiguous; closes exactly across the org at 4×9 + 3×14 + 1×5 = **83 rows**. `ON CONFLICT DO NOTHING` was there and **could never fire**: it guards `column_id`, minted from `uuid4` on the line above, so the key is new every call. Nothing compared the NAME. ⚠ Columns live in **`public.project_columns`** — `public.boards` and `public.board_columns` both hold **0 rows in the whole database**, so the obvious query reports no problem. Second defect in the same loop: `field_definitions.sort_order` was the literal `0` for every field, wrong from the FIRST apply. Now idempotent by normalised name, new columns numbered after whatever the board already has, and `created`/`skipped` report what was WRITTEN — the page said "Applied — 5 columns created" on a call that created nothing. **`test_apply_template_is_idempotent.py`: 13 tests, 13 green including 3 live against the real catalogue; five mutations each bit a different set.** ⚠ The **83 existing duplicate rows are NOT repaired** — a data change to live rows is the owner's (finding 19), and that is also why there is no `UNIQUE (team_id, lower(name))` migration: it would fail on the data already there |
| 🔴 | `/security` page claims no MFA (TOTP shipped 23 Aug); 3 undisclosed sub-processors | `SecurityPage.jsx:161`, `legalFacts.js` | OPEN |

## Seeded-data integrity — repaired 26 Aug

Owner confirmed **"no live users or legal payslip, all are seeded"**, which
released seven items the sweep's adversarial brake had held. All reversible from
schema `ledger_repair_20260826`.

| Repaired | Detail |
|---|---|
| ✅ 6 payments deleted | 4 receipts against DRAFT invoices (₹2,06,500 + ₹5,000 + ₹5,000 + ₹590), 1 against a CREDIT NOTE (₹2,950), 1 of ₹60,000 against a ₹0 invoice. Their invoices reset to unpaid. `record_payment` now refuses all three shapes, so none can recur |
| ✅ 1 born-paid invoice | INV-2026-0048 — ₹53,100 total, ₹0 balance, no payment row — now owes its full amount |
| ✅ 3 expense claims detached | Approved claims (₹800 + ₹1,200 + ₹5,000, Unicode) pointing at payslips that were voided and never disbursed |
| ✅ 1 phantom payroll run | Jan 2020, 0 payslips, 0 employees. `org.spec.ts:197-211` asserts a **refusal** (≥400) for that month, so nothing depended on the row existing |
| ➖ holiday "duplicates" | Not duplicates — distinct names sharing a date (Dussehra and Gandhi Jayanti both 2025-10-02). 0 exact `(org, date, name)` twins remain |

**Verified after, both orgs:** 0 payments against a draft / credit note / ₹0
invoice · 0 invoices where `balance_due <> total − Σpayments` · 0 born-paid · 0
claims on a voided payslip · 0 phantom runs.

**Nikhil Desai — CLOSED by removal, owner's instruction 26 Aug.** He was
missing July and August pay (≈₹73,077 on the product's six-day basis, not the
₹72,322 first published — every August payslip uses `working_days=26`). Rather
than build a re-run path for a `processed` month, the owner chose to delete the
seeded employee outright. Removed: the employee, 3 payslips, 1 salary structure,
1 offboarding row, 4 leave balances, 1 leave request, 1 exit interview — 12 rows,
all backed up to `ledger_repair_20260826.nikhil_*`. Unicode headcount 27 → 26.

**Six junk vendors removed** — four named `p`, two named `probe`, a 72-second
burst of write probes from 2026-07-28, 6 of Unicode's 15 and all six live in the
vendor picker. Verified orphaned across every vendor-referencing column *before*
deleting. Nine real suppliers remain.

## Proposal 93 · WAVE 1 CLOSES AT 28/28, and Wave 2 lands (29 Aug)

**The recycle bin round trip ran end to end for the first time:**

```
93-bin-202608290222: uploaded (449 bytes) -> deleted -> stage 1 -> restored
-> deleted -> stage 2 -> destroyed. Object unreadable at the end.
```

Read back from `staging.deleted_files`, not from the log. That is ✅ by this
file's own definition — a customer completed the flow and rows appeared where
there were none.

The last assertion is the one the feature exists for and the only one a row
count could never fake: after the permanent delete the object's own URL is no
longer readable. So is the third: the object is asserted **still present** after
a stage-1 delete, because a delete that destroys the file immediately is not a
bin.

### The org guard is structural now, and it was not before

`ae7f0510` named two faults and fixed one. It recorded the second as fixed —
*"now called inside `signInAs()`, the only way into the suite"* — and **it was
not**. Measured 2026-08-29: `signInAs` returned without calling `assertOrg`.
Eight files remembered to call it themselves, which is why nothing went wrong;
but a rule every author must re-apply is the rule that renamed Aekam Inc. It is
now a property of getting in. Suite 19 is unaffected and must stay so — a
platform session resolves to Aekam by design.

### Wave 2 — Suite 04 (Graha) 15/22 and Suite 07 (Manav), §4 volumes hit

Suite 04, three runs, §6 proved by running: 25 clients · 53 contacts · 30 deals
(8 won, 6 lost) · **40/40 kanban moves by real mouse drag** · 45 activities · 18
follow-ups · 6 territories · 12 documents · 2 dedupe runs.
Suite 07: **30 employees · 6 leave types · 24 requests · 14 holidays · 24 assets
· 18 candidates** — §4's numbers, essentially exactly.

⚠ **Aekam Inc unchanged throughout at 11 seats / 220 tasks**, measured
repeatedly while both suites wrote concurrently.

### Contact merge has NEVER ONCE WORKED — found, fixed, and it took two fixes

`invalid input syntax for type uuid: "user_21457956f010"`.
`graha_contact_merges.actor_id` was declared UUID against ids that are
`user_` + 12 hex. **The table held zero rows and always had** — the bug's
consequence, not a coincidence beside it. `PROPOSED_083` named this exact column
on 2026-07-28 and nobody applied it.

Two things worth keeping:

- **That proposal listed five columns; the catalogue said four.**
  `graha_web_forms.created_by` was already `text`. Applying the file verbatim
  would have harmed nothing but would have been a statement written against a
  schema that had moved — which is why migration 238 exists.
- ⚠ **The column was only half.** After migration 240 the merge STILL 500d, same
  line: `contact_dedupe.py:458` casts the parameter explicitly,
  `NULLIF($7,'')::uuid`. Three call sites carried that shape. Proved by
  re-running and reading the log again rather than assuming the migration was
  the fix.

### Five Graha features have no way in — OWNER-ACTIONS 19

`lost_reason` has no input anywhere · a web form publishes with no public route
to fill it · no screen AND no route creates a lead-scoring rule · no control
creates a pipeline (`create_deal` silently inserts one nobody typed) · a
territory cannot be given a priority.

⚠ **In every case the column exists, the API accepts the value, and nothing sets
it.** Five features complete except for the part a customer touches — "code
shipped is 🟡" in its purest form.

### ⚠ A SECOND RATCHET BLIND SPOT of the same shape

The Documents register draws a client UUID (`crm/<uuid>/documents`) in its
folder column and filter. **The server builds that string**, so
`check-rendered-ids` — static and positional — reports "no id drawn on screen"
and stays green. The first was a user id behind a helper on the recycle-bin
screen, caught only by mutating the component. **The ratchet cannot see an id
that arrives pre-formatted from the server**, and both times only a person or a
test reading the rendered page caught it.

## Proposal 93 · B — the recycle bin, and the delete path the web actually used (29 Aug)

**There was no delete anywhere in this product that KEPT the file.** Both
`TaskDrawer.jsx:621` and `server.py`'s attachment DELETE dropped the pointer and
left the R2 object in the bucket — billed forever, unreachable by anyone
including Aekam, with no confirmation and no undo.

Owner-approved 28 Aug, shape settled 29 Aug: **two stages, SharePoint/OneDrive.**

| | |
|---|---|
| Stage 1 | days 0–14. Org owner/admin see it and can **Restore**, or **Delete** — which PROMOTES to stage 2 and destroys nothing |
| Stage 2 | days 14–90. Restore still works. **Delete permanently** destroys the R2 object, behind a typed confirmation |
| Day 90 | the sweeper purges what is left — **and it ships DISARMED** |
| Quota | binned files count at BOTH stages; `storage_used_bytes` is credited at purge and nowhere else |
| Never binnable | Ganit invoices, eSign documents — 8-year Income Tax retention, 72-month GST, enforced by a CHECK |
| Storage tab | stays READ-ONLY. That decision stands; delete belongs on the surface that owns the row |

### ⚠ The most important fix is not the bin. It is which door it sits behind.

`DELETE /api/tasks/{id}/attachments/{key}` already existed and is the obvious
place to put a bin. **The web app has never called it.** `TaskDrawer` went
through `PUT /tasks/{id}` — a wholesale replace — and that route's only caller in
the entire product is mobile (`mobile/src/api/tasks.ts:143`).

So binning the delete route alone would have captured mobile deletions, missed
every deletion a customer makes in a browser, and **reported the feature built**.
Both now go through one door.

### What the live-SQL test caught, which is the whole reason that rule exists

**`staging.graha_documents` has no `file_name` column. It is `name`.** My own
earlier column query had shown that and I misread it. The CRM document delete
would have 500'd on the first real use — invisible to a MagicMock pool, which is
exactly how `gst_rate` survived in two INSERTs that had never once succeeded.
`prepare()` against the real catalogue found it in twelve seconds.

### Three corrections to the record

- **`delete_file` does NOT have zero callers.** This file and
  `93-NEXT-SESSION.md` both said so. `services/pahchan_retention.py:90` calls it
  behind an armed daily cron, and `storage.py:838-844` documents a production
  incident from that call site. The true statement is narrower: the storage
  BROWSER has no delete.
- **There WAS already a bin in this product** — projects, 7 days,
  `services/project_purge.py`, owner's decision 2026-08-09. "No delete anywhere"
  was overstated. What was true is that no delete reached an R2 object.
- **`deleted_by` is no longer sent to the browser at all.** It was a raw user id
  resolved client-side against `/v1/org/members`, which misses anybody who has
  LEFT the org and every platform account. ⚠ It also sat in a ratchet blind
  spot: `check-rendered-ids` is positional and reads what a component DRAWS, so
  an id behind a helper is invisible to it — mutating the screen to render the
  id turned the unit tests red and left `npm run check` GREEN.

### And the size that was thrown away on save

`TaskDrawer.handleFileChange` read each file's `size` off the upload response and
all three `saveTask` maps rebuilt the object without it — **53 of the 59
attachment elements in this database carry no size because of it.** It stopped
being cosmetic when the bin landed: `size_bytes` is what the quota is credited by
at purge, so a file saved without its size is one an org can never get its space
back for. `server.py`'s `Attachment` model already carried a comment saying the
other half of this had been fixed while this half went on vanishing one layer up.

### Status

Migration 239 applied and verified from `pg_constraint`; Aekam Inc unchanged at
**11 seats / 220 tasks**. 5/5 live-SQL green against the real catalogue.

⚠ **02.12 is written and NOT YET RUN.** Railway's staging deploy queue wedged for
90+ minutes on 29 Aug — two deployments stuck `DEPLOYING`/`SLEEPING` with
everything after them queued — so `/api/v1/recycle-bin` still answered 404 on the
deployed SHA. **No screen has rendered against a real `deleted_files` row.** By
this file's own rule that is 🟡, not ✅.

⚠ **`sleepApplication` was set to FALSE on the staging `Kartavya` service** to
clear that wedge. It is a deliberate cost setting and **must be set back to true**
— see `docs/plans/PROGRESS.md` and R9.

## Proposal 93 · A.1 — the support-session feature was unreachable by anybody (29 Aug)

**02.17 was filed as sequencing. It was a product bug, and the two halves sat in
different layers, which is why neither side looked broken on its own.**

`platform_support` was created on 28 Aug as the precondition for Suite 19.3. The
plan was: the support account raises a request from `/admin/support`, then 02.17
approves it as the customer. Driving that as a user is what found this.

**MEASURED, not read — deployed staging, real credential, 2026-08-29:**

| Layer | What it does | Evidence |
|---|---|---|
| Server | Admits **only** `platform_support` to raise a request | `GET /v1/support-sessions/organisations` with the support token → **200**, five orgs |
| Server | Refuses every OTHER platform role | `_may_request` gates on `SUPPORT_ROLES`; `_NOT_A_SUPPORT_ROLE` is the 403 |
| Browser | Admitted every role **except** `platform_support` | `/admin/support` → redirected to `/dashboard` |

So every operator who could open the screen was refused by the API, and the one
the API admits never reached the screen.

⚠ **The bounce is the client-side role gate, and that is proved rather than
inferred: not one request to `/v1/support-sessions/*` was made.** The redirect
happens in `Protected.jsx:304` before the page mounts. The legacy
`users.role === 'admin'` hatch does not open it either — that column reads
`'member'` on `user_40223c0afab1`, whose only roles are `platform_support
@PLATFORM` and `org_member @Aekam Inc`.

**`platform_support_sessions` and `platform_support_requests` holding 0 rows in
their entire life is the consequence of this, not a coincidence beside it.**

### The cause was a comment and its code disagreeing

`ADMIN_SURFACE_ROLES` — what `Protected.jsx` bounces `/admin/*` on — said it was
*"the union of the rows above"* and computed the union of **three** hand-listed
role sets. There were **four**. `SUPPORT_CONSOLE_ROLES` was the fourth, so a
role could hold a console row and still be refused by the predicate that means
"may open the console". `adminNav.js` had the gap written down, with the fix, and
left it on the grounds that the test pinning it "belongs to another change in
flight".

### Fixed as a shape, not as an instance

- `SUPPORT_CONSOLE_ROLES` gains `platform_support`.
- **`ADMIN_SURFACE_ROLES` is now DERIVED from `ADMIN_NAV`** rather than re-typed.
  The two agree by construction, so the fifth row and the sixth cannot repeat
  this — there is no second place left to forget. Fixing only the one role would
  have left the shape intact, which is the failure §0 names under systems
  architecture.
- `sahayak_admin` stays out, and now by *having no row* rather than by being
  named — the same exclusion said once instead of twice.

**No landing problem, checked rather than assumed:** `AdminShell` already moves
an operator whose URL resolves to a row they do not hold to `items[0].to`. So
`platform_support` opening `/admin` lands on `/admin/support`, its one and only
row — exactly as `account_finance` already lands on Billing instead of an
Overview where every request 403s.

### Both checks proved to bite by mutation, on unique anchors

| Mutation | Result |
|---|---|
| Drop `platform_support` from the row's role set | **2 red** — the nav row test and "is the ONLY row platform_support sees" |
| Revert `ADMIN_SURFACE_ROLES` to the hand-typed union | **3 red**, including `supportSessions.test.jsx:704` |
| Restored | **61 green** |

That third failure is the important one: **the invariant was already written** —
*"A row whose role set is wider than ADMIN_SURFACE_ROLES gives AdminShell a row
for a user Protected bounces at the door. The two must agree."* It passed for
the row's whole life only because the role was missing from BOTH sides. It had
nothing to catch until now, which is precisely what §0 means by a gate nobody
has seen fail.

`navConfig.test.js`'s assertion that the console row *"hides for sahayak_admin
and platform_support, who hold a platform role and reach nothing"* is **inverted
rather than deleted** — a deleted test leaves no record that the opposite was
once believed.

## Proposal 93 · Wave 1 closes at 26/28 — and the two failures are both real (28 Aug)

**Every remaining failure in Wave 1 was triaged to product-bug or test-bug with
evidence before a word was written about it**, which is rule 2. Three were test
bugs and are fixed; two were product findings and are recorded as such.

**02.14 and 02.10 — TEST BUGS, fixed, and the second one uncovered a real hole.**
02.14 failed with `element was detached from the DOM` on the row-actions menu:
the members list refetches after `openTab`, and the refetch replaces `.omt
tbody` while the menu opened over it is still animating. Nothing about the
product is wrong — a human clicking a settled screen never meets it, which is
precisely why the test met it and the customer does not. `rowMenuItem` now
awaits the in-flight `/org/members` GET first (the actual fix) and re-resolves
at most three times, **only** on the detach signature; any other failure is
rethrown on the first attempt, because a blind retry would paper over a
genuinely missing control, which is the one thing this suite exists to catch.
The retry logs when it fires, so the race stays visible.

⚠ 02.10 failed at **6.0s** in the full run and passed alone — the precondition
read, not the assertion. Two causes, and the second matters far more than the
test: the roster was read before the members tab was opened, *and* `members()`
and `pendingInvites()` sent **no `X-Org-Id` header at all**. `src/lib/api.js:39`
puts the active org on every request the product makes; these helpers did not,
so the server fell back to resolving the org itself — and that fallback is
**oldest membership**, not "the org this lane is testing". A read helper that
can silently answer for a different organisation than the screen beside it is
the same class of fault as the 2026-08-28 cross-org incident, and it was sitting
inside the suite written to catch that. Now pinned to `LANE.orgId`.

Green after the fix: `02.10 org_member -> org_admin -> org_member, badge and row
agreed at each step` · `02.14 revoked → /graha/pipelines 403, nav row absent;
granted → 200, nav row present; revoked → 403, nav row absent`.

**02.17 — the role row is applied, and `platform_support` now exists.**
`kevalvshah03+support@gmail.com` (`user_40223c0afab1`) held `org_member @ Aekam
Inc` and no platform role whatever, so `_may_request` — which admits
`platform_support` alone (`support_sessions.py:137`) — refused it. One row,
owner-approved, applied 19:52:57 UTC: `user_roles(user_id, org_id=NULL,
role_code='platform_support')` = `ff85dac6…`. Reversal is that row deleted.
**Nobody in the system held this role before today.** Measured live at the same
time: `staging.platform_support_sessions` and `platform_support_requests` both
RESOLVE and both hold **0 rows** — support access has never been used once.

The Aekam Inc seat is deliberately LEFT (owner's call). It arrived because the
account was created through a god-mode session, which resolves to Aekam Inc with
nothing on screen saying so — the same defect as the harness one, on a real
action rather than a test. Aekam's §12 baseline moves **10 → 11 seats, 1471 →
1482 rows**; that is now the number to compare against, not the old one.

02.17 still blocks, correctly: the *request* must be raised from the support
console and `_lanes.ts` rule 1 forbids the customer lane from borrowing a
platform credential to manufacture its own precondition. Suite **19.3** raises
it through the real form at `/admin/support`, exactly as 19.0 unblocked modules.

> ⚠ **SUPERSEDED 2026-08-29.** The paragraph above is right that 19.3 is the
> piece that raises the request, and wrong that sequencing was all that stood in
> the way. Driving `/admin/support` with the real `platform_support` credential
> showed the account is **bounced to `/dashboard`** before the page mounts. The
> feature was unreachable end to end by any account in the system. See the
> 2026-08-29 section at the top of this file.

**02.12 — MISSING FEATURE, confirmed, and it is bigger than the storage tab.**
§10 asks for an R2 round trip including delete. Browse and identify work.
Download and delete do not exist, and the measurement went well past the tab:

- `routers/uploads.py` mounts exactly one route, `POST /upload`. No delete.
- `services/storage.py:832` has `delete_file` — **zero callers.** Written,
  never wired to a route or a screen.
- `routers/storage_browser.py` mounts three routes, all reads.
- `TaskDrawer.jsx:621` `removeAttachment` filters the array and saves the task.
  **It drops the pointer and orphans the object.** The R2 file stays forever,
  and because the `key` is gone from the row nobody can find it again —
  including Aekam. No confirmation, no undo. A customer who removes the wrong
  attachment has destroyed it, and is still paying to store it.
- The one surface that does this correctly is `graha.py:4917`: `UPDATE ... SET
  is_active=FALSE`, recording who did it, keeping the object.

**Owner decided 28 Aug — build it on Graha's shape**, and the three questions
that were put alongside it are settled: (1) hidden from the customer at **14
days**, R2 object hard-deleted at **90**, so there is a real recovery window and
a real floor on cost; (2) binned files **do** count against the org's storage
quota, or an org sits permanently over its limit by deleting things; (3) delete
is wired to **task attachments and CRM documents only** — Ganit invoices and
eSign documents get no delete control at all, because books of account carry an
8-year retention under the Income Tax Act and GST records 72 months, and a
customer who deletes a signed invoice discovers it at assessment.

⚠ **The Storage tab itself stays read-only and that is not the same decision.**
`TabStorage.jsx:40-45` argues a delete there removes an object without its row,
producing the exact breakage the tab exists to diagnose. That reasoning survives
the build: delete belongs on the surfaces that own the row.

**A third stale "this table does not exist" header** —
`admin/SupportSessionsPage.jsx:75-79`, matching the two corrected in `a375e03c`.
It reads on a `to_regclass` NULL from 6 August. `isDormant` is computed from the
error response rather than hardcoded, so the page recovers on its own now the
routes answer; the comment is what misleads a reader, and it is corrected in
place with the measurement rather than deleted.


## Proposal 93 · Stage 2 EXECUTED 28 Aug — the three test orgs are wiped

**The reseed's irreversible half is done.** 25,854 rows deleted across `public`
and `staging` for Unicode Group, E2E Test & Associates and UK AekamINC.

- **R1** — 7 of 7 staging crons disarmed (`0 0 1 1 *`), verified by reading the
  schedules back. Restore values: `docs/plans/93-R1-FREEZE-LEDGER.md`.
- **R2** — `reseed_backup_20260828`: 265 relations, 26,064 rows. **A restore was
  performed and content-diffed — 248 tables, 0 mismatches.** ⚠ That schema is now
  **the only copy of the deleted rows**; it is dropped only when the owner names
  it, at R9.
- **R4** — `public` first (2 FKs in the whole schema, so a wrong order would be
  neither prevented nor reported), then `staging` with the delete order
  **discovered by fixpoint** rather than hand-written, raising on a stall instead
  of reaching for CASCADE.

**Verified after, by re-query, not by the migrations reporting success:**
protected 20 intact with all 84 notifications and 56 activity rows · Aekam Inc
untouched at 220 tasks / 30 teams / 164 members · `public.users` 50, never
written · all 5 `organisations` rows intact · every target org still has an owner
and admin, so each can be signed into and rebuilt · 210 rows remain and every one
is accounted for (170 protected + 40 seats).

⚠ **Two things are deliberately NOT done and are not oversights:** the accounts
themselves still exist in the global, production-shared `public.users` (removing
the seat removes the member from the org; deleting the login is a separate act
with a different blast radius), and no `staging.organisations` row was deleted —
152 CASCADEs hang off that table, one crossing into `public.org_settings`.

**↑ The first of those two was reversed on 2026-08-28 — see R4b below.**

## Proposal 93 - the harness wrote to Aekam Inc, and nothing said so (28 Aug)

**23 specs drove a god-mode credential that resolved to Aekam Inc** - the one
organisation this programme guarantees is untouched. Found while sizing Wave 2,
before running any of them. Every link measured, none inferred:

  * `E2E_ADMIN_TOKEN` and `E2E_GODMODE_TOKEN` decode to the SAME subject,
    `user_f798947b8a2e`. They are one account, and it is the platform one.
  * `mint-state.mjs` seeded `auth_token` and NOTHING ELSE into `owner.json`.
  * With no active org, `src/lib/api.js:39` sends no `X-Org-Id`, and in that
    file's own words the server then resolves "the user's OLDEST membership".
    For that account the oldest seat is **Aekam Inc, granted 2026-07-16**.
  * Live proof: `GET /org/profile` on that token returns **"Aekam Inc"**.

**IT WAS SPLIT-BRAINED, which is worse than either half.** `_helpers.api()` DOES
send `X-Org-Id: E2E_ORG_ID`, so the API side read E2E while the browser side
wrote Aekam. That is exactly how a suite goes green having written to the wrong
company - the same shape as the 2026-08-28 cross-org incident.

The 23 include `manav`, `graha`, `ganit`, `vetana`, `pahchan` and `vikray` -
**every Wave 2-5 module suite.** Following §14's "re-point the existing suites at
the volume constants" without this fix would have typed roughly 7,510 records
into Aekam Inc.

**The existing safety probe could not see it.** It probes the token against
`E2E_ORG_ID` and accepts a 200 - but `platform_bypass` answers 200 for EVERY
org, so "can reach that org" and "belongs to that org" are indistinguishable from
a status code. Only asking the server WHICH ORG IT RESOLVED TO tells them apart.

**Fixed at the root:** `mint-state.mjs` now seeds `Kartavaya_active_org`
(`src/lib/orgContext.js:30`) beside the token, so the browser and the API helper
target the same organisation; and it asks the server which org each token
actually resolves to, warning loudly when that is not the intended one. God mode
is deliberately left unpinned - Suite 19's subject IS the console, and it scopes
per call through the admin console's own `scoped()` header.

**Proved, not assumed:**

    no X-Org-Id  -> Aekam Inc                       045b76ad-...
    X-Org-Id set -> E2E Test & Associates [TEST ORG] 64e7bea6-...

and the minted `owner.json` now carries `auth_token` AND `Kartavaya_active_org`.
The warning fires today, naming both ids.

⚠ **The underlying credential question stands and is owed to the owner:**
`E2E_ADMIN_TOKEN` is the platform account, not an org-scoped one. The seeding
makes the harness coherent; an org-scoped credential is the real answer.

## Proposal 93 · Suite 02 members — 12/12, green twice · 28 Aug

**§10 asks for 18 screens and eight had tests.** The members lane is the first
of the ten that did not, and it went first because it produces the accounts
every later wave needs — somebody to put on payroll, assign a task to, approve
leave for. Suite 02 is now **12/12, green on two consecutive full runs**, which
is how §6 idempotence is proved rather than claimed.

New: **02.8** invite -> accept in a clean browser context -> seated ·
**02.9** an address whose account R4b purged can be invited again ·
**02.10** role change, badge and row agreed at each step ·
**02.11** remove takes the seat and warns what it does not take.

**⚠ THE ORG GUARD HAD STILL NEVER RUN — the third time it has been found so.**
`assertOrg()` was written on 2026-08-28 after this suite renamed Aekam Inc.
Commit `ae7f0510`, titled *"the org guard had never run"*, fixed its second half
(the backend echo it compares against) and left its FIRST finding standing: no
spec imported it. A grep today still returned only the file that defines it.
It is now called inside `signInAs()` — the only way into the suite, so a test
cannot reach a form without passing it — and **proved to bite by mutation**:
pointed at another org id it fails with `⚠ WRONG ORG — refusing to write`,
before the test reaches any form. Restored, and green.

**The `E2E_GODMODE_TOKEN` fallback is gone from the lane resolver.** It sat as
the second half of `E2E_UNICODE_TOKEN || E2E_GODMODE_TOKEN`, which put one
expired token between this suite and driving Aekam Inc again — while still
printing `LANE: Unicode Group (reference lane)`. Rule 1 of `_lanes.ts` is
absolute: write suites never use a platform credential.

**Three failures, three TEST bugs, no false accusation filed.** Each was read
off the wire or the captured page before anything was written about the product:
a `RegExp` built from an email, where `+` is a quantifier (the toast was
present, in two places at once); a badge asserted as "Org admin" when
`ROLE_META` renders plain **"Admin"** (the role had changed, at the same
second); and an `openTab` left inside an `if` branch, so a row locator ran
against the dashboard (the snapshot showed Today, not org settings).

⚠ **The suite sends real invitations to a real mailbox, and a human may answer
them.** `audit_log` 5707 records `auth.invite_accepted` from **iPhone Safari on
a different IP** — the owner opened one of these invitations on their phone and
accepted it mid-run. The seat is correct; only the name differs from the
roster's. That is what §3 signed up for by choosing deliverable addresses over
fake ones, so 02.8 no longer asserts the name of a slot it did not create.

**Unicode Group now holds 8 seats**, up from 6 — two people created by
invitation through the real form, no SQL and no API shortcut. The rule-1
ratchet passes at 58 spec files with no new violations.

## Proposal 93 · R4b EXECUTED 28 Aug — the accounts go, and UK gets its state

**§2 said "remove means remove" and R4 kept the logins.** That narrowing was
declared in the paragraph above, but §2 had already weighed the same blast radius
and ruled the other way, so it was a settled instruction reversed as a footnote
rather than a decision raised. Owner's ruling, 2026-08-28: *"any users of aekam is
part of any org keep it rest remove."* Risk report written before the statement
ran: `docs/plans/93-R4B-ACCOUNT-PURGE-RISK-REPORT.md`.

**It was also blocking the next piece of work.** `org_invites.py:455` answers
`409 "Someone with this email already has an account"`, so Suite 02's members
lane could not re-invite any address an orphan account still held.

- **25 accounts deleted** — every `public.users` row holding no `user_roles` seat
  in any org. All test personas; **none created a task, none touches the
  protected 20**, both measured rather than assumed.
- **Two exclusions added on top of the owner's rule:** the 5 `niyam_<org>`
  `is_system` accounts (93 §2's named hazard — they hold no seat *by design* and a
  blanket purge breaks Niyam attribution in the untouched orgs too), and anyone
  touching the protected 20 (measured empty, kept in the query anyway).
- **Collateral, 70 rows:** 46 `notifications`, 3 `pulse_logins`, 1
  `push_web_subscription`. Found by sweeping **all 270 text user-reference columns
  across 166 tables**, not only the 15 with a foreign key — 14 of those 15 are
  `NO ACTION`, so an enforced reference would have failed loudly; the unenforced
  ones would have orphaned silently.
- ⚠ **`staging.audit_log`'s 20 rows are KEPT, deliberately.** The cross-org
  incident was diagnosed *from* `audit_log`; deleting audit rows to tidy a purge
  destroys the evidence. They now reference a `user_id` that no longer
  resolves — which is what a deleted account's audit trail should look like.
- **UK AekamINC `state_code` = `27` Maharashtra** (93 §9, owner-delegated, never
  applied — it was `NULL`). This is what makes Stage 4 a test rather than a
  repeat: against Unicode's Gujarat `24`, identical suites must now produce IGST
  between the orgs and a different professional tax on identical salaries.

**Verified after, by re-query:** users 50 → **25**, `is_system` still **5** ·
Aekam Inc seats **10** and Demo **1**, unchanged · protected tasks still **20** ·
`audit_log` **1757**, unchanged · UK reads `27` · the only seatless accounts left
are the 5 system ones.

**🔴 The plus-addressing probe BOUNCED.** SES accepted all three probe messages,
then reported `attempts=2, bounces=1`. `success@simulator.amazonses.com` never
bounces, so one of `test@unicodegroup.com` / `test+probe@unicodegroup.com` is
undeliverable. **§3's ~550 `test+<tag>@unicodegroup.com` recipients must not be
seeded** until the mailbox says which — on the SES account that sends real
invoices. OWNER-ACTIONS 15.

**🔴 Day one: an inactive module tells the customer the WRONG thing.** Found on
the emptied orgs 28 Aug, and unreproducible without another wipe once modules are
enabled. `/graha` shows *"You do not have access to CRM reports"* while the API
in the same exchange says *"Module 'graha' is not active. Contact your
administrator to activate it."* Those are different problems: the screen's
wording is a **permission** framing that sends a new customer to their role and
their admin's user settings, when the truth is an **org-level activation**. The
accurate sentence exists and is the one nobody sees. Same on `/dashboard` (5
failed requests), `/ganit` (7), `/dristi` (5); `/manav`, `/vetana`, `/sanvaad`
and `/hub/org` DO use activation language — so the product knows the difference
in four places and loses it in four others. ⚠ The good half: a new org is not a
wall of zeroes — a bilingual **Setup guide** ("0 of 4 complete") is already built
and appears on day one.

## Fixed 2026-08-28 — the TAN CHECK ate the whole company profile

**✅ CLOSED, both halves, proved by driving the real form and green twice.**
Found in proposal 93 Wave 1 by typing into `/settings/organisation`, not by
reading code. `staging.organisations.tan` carried
`CHECK (tan IS NULL OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$') NOT VALID` while
`routers/org_profile.py` promised the customer, on screen, *"It has been saved
as typed."* Two ways to break it, one blast radius:

| | what the customer did | what happened |
|---|---|---|
| 🟢 | cleared a TAN they no longer need | router wrote `''`; neither arm of the CHECK accepts it |
| 🟢 | mistyped one character off a certificate | router stored it as typed; the CHECK refused it |

Both raised `asyncpg.CheckViolationError`. **The 500 escaped before the CORS
headers**, so the browser reported `net::ERR_FAILED` and the screen said only
"Failed to save profile", naming no field. ⚠ **And the PATCH carries every
column** — so the firm also lost the legal name, address, state, email, phone
and bank details typed in the same sitting. Invisible to every row count: the
row is simply unchanged, which looks identical to "Save does not work".
**This is the repo's signature failure — a value of the wrong shape handed to a
constrained Postgres column — and it is the fourth of its kind.**

- **The blank half** — `2317dbff`, router writes `NULL`. 5 tests.
- **The malformed half** — **migration 238 APPLIED 28 Aug**, dropping
  `organisations_tan_format`. Verified: `pg_constraint` returns no row.
  **Rows affected: zero** — 5 orgs on the database, none held a TAN at all,
  counted live before it ran. 9 tests (`test_org_profile_tan_malformed.py`).
- **Validation was not lost, it moved to where it bites.** `doc_validation.py`
  refuses to build a TDS challan against an absent or malformed TAN, which is
  the only document a wrong TAN actually damages. The settings page records
  what the customer says about their firm; the statutory document enforces the
  statute.
- **GSTIN and PAN never had a format CHECK.** Read live: TAN was the single
  outlier among six CHECKs on the table. This finishes applying the standing
  rule rather than weakening it.
- ⚠ **The constraint was never recorded as applied.** It is defined in two
  files, `PROPOSED_documents.sql` and `PROPOSED_090`, both headed *"NOT
  APPLIED"*, and they disagree — one admits `NULL`, the other `''`. The live
  form was `PROPOSED_documents.sql`'s; the router was written against
  `PROPOSED_090`'s. That gap **is** the defect. Both blocks are now commented
  out with a pointer to 238, so applying either cannot resurrect it.

**Suite 02 is 8/8 on the Unicode reference lane, green twice consecutively**
(§6 idempotence proved from its own output, not claimed). 02.2b types a
mistyped TAN alongside a changed legal name and asserts **the name survives** —
the assertion that would have caught this originally is not about the TAN.

---

## Open, found 28 Aug during proposal 93 R0 — NOT fixed

**🔴 The release APK cannot run on either emulator, so Suite 21 is blocked.**
Measured, not inferred: installed on `Pixel_9_Pro` and it crash-loops at launch
with `SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so`.
Reading the archive, `build/Kartavaya-2.0.4-release.apk` ships **`arm64-v8a` and
`armeabi-v7a` only**; both AVDs are x86_64. `mobile/scripts/build-apk.sh` strips
the emulator ABIs on purpose, so **the APK is correct for its purpose** — a real
phone — and mobile is untestable on this machine until an x86_64 build exists.
The script now takes an `ARCHS` override and puts the ABI set in the filename so
the two archives cannot be confused. ⚠ This also means `mobile/e2e/android_e2e.py`'s
~10 assertions cannot have run green against a release APK on these AVDs — the
harness never installs one.

**🟢 The emulator camera question is ANSWERED — YES, and mobile is unblocked.**
An x86_64 release APK was built (`build/Kartavaya-2.0.4-release-x86_64.apk`,
x86_64 + `libreactnative.so` + the 3,224,296-byte JS bundle, all verified inside
the archive). On `Pixel_9_Pro` it installs, launches, signs in, and reaches
Attendance with **zero crashes**. The Pahchan clock screen renders a **live
preview from the emulated front camera** into `expo-camera`'s `CameraView`, and
the camera service confirms it independently of the pixels:

    CameraService::connect call (PID 3579 "com.aekaminc.Kartavaya", camera ID 1)
                                and Camera API version 2
    Device 1 is open. Client package: com.aekaminc.Kartavaya

So **Suite 21's photo-carrying punch does not have to be a real-device-only
check** — the assumption in proposal 93 §11 that this might be undrivable is
retired. What is proven is the capture *pipeline* up to a live preview; the
`takePictureAsync` round trip is left for Suite 21 to assert with a real row,
deliberately, because proving it here would mean writing a punch to the
production-shared database outside an approved step.

⚠ Observed while there, not yet diagnosed: the screen offers **"Clock out"**
while simultaneously showing the gate **"Add your two reference photos"**. Worth
a Suite 09/21 assertion — either the clocked-in state or the enrolment gate is
reporting wrongly.

**🔴 `aekaminc.com` SES verification is `Failed`, not merely unverified.** Read
from the API rather than the console: `verify=Failed, dkim=Failed`. SES looked
for the DKIM records, did not find them, and gave up — so publishing them is
necessary but **not sufficient**; re-verification must be triggered afterwards.
`no-reply@aekaminc.com` is `verify=Success, dkim=Failed`, so the production
fallback sender is going out unsigned today. OWNER-ACTIONS 12.

**⚠ SUPERSEDED 2026-08-29 — production and staging now share EVERY table.**
Production was promoted: `main` fast-forwarded to `staging` (1,898 commits) and
`DB_SCHEMA=staging` was set on the production service, so it runs
`search_path = staging, public` exactly as staging does. Verified live:
`production /api/health -> {"schema":"staging","environment":"production"}`.
The two environments are now one code base and one schema set.
**`staging` is therefore a PRODUCTION schema — dropping it deletes the
product** (258 module tables; `public` holds only the 42 core PM tables).

The paragraph below was true until that promotion and is kept because every
delete plan written before 2026-08-29 was written against it:

**⚠ Production and staging share `public.tasks`, `public.teams`, `public.users`.**
`db.py:21` defaults `DB_SCHEMA` to `public` and the production service set it
nowhere; those three tables exist **only** in `public` (`staging.tasks` is
42P01). Not a new bug — but it means core PM and identity are one table set
across both environments, and it is the constraint every delete plan must be
written against. `public.tasks` holds only the five known orgs, so no third
party is reachable by an org-scoped delete.

**⚠ 926 `public.notifications` rows carry `task_id` and no `org_id`**, 3 of them
on the protected 20 tasks. An org-scoped delete misses them entirely; a
join-based sweep without the team guard destroys protected rows that **no
`org_id` predicate could have saved**. `docs/plans/93-R4-DELETE-PLAN.md`.

**⚠ `public` has exactly 2 foreign keys** (`task_reminders_task_id_fkey`,
`org_settings_org_id_fkey`) against `staging`'s 391. `tasks`, `teams`,
`team_members`, `task_comments`, `time_entries`, `mentions`, `notifications` and
`activity_events` have none, so Postgres will neither prevent nor report a wrong
delete order there.

## Open, found 26–27 Aug, NOT fixed

**🟢 Biometric attendance now reaches payroll — FIXED 27 Aug.**
`services/attendance_bridge.MARKED_BY_BRIDGE` was `'pahchan'` and
`manav_attendance_marked_by_check` admits only
`('system','manual','biometric','geo')`, so every row `POST /v1/pahchan/publish`
ever tried to write raised CheckViolation. Read live 2026-08-27 before the fix:
**699 punches, 518 attendance rows, `marked_by='pahchan'` = 0**. A firm could
enrol faces, punch in all month, and the payroll run saw none of it.

Now `'biometric'`, which the CHECK already admits — the column records HOW a day
was marked (auto, typed, biometric, location) and `'pahchan'` is a module name,
a different kind of fact. No migration. It stays distinct from `'manual'`, which
is load-bearing twice over: the upsert's `IS DISTINCT FROM` guard is what stops
the bridge overwriting a hand-typed day AND what lets it re-write its own
earlier rows, which is how the module is meant to be used.
`tests/test_attendance_bridge_marked_by.py` reads the CHECK **from the live
catalogue** and pins both halves — the only assertion that would have caught it,
since a MagicMock pool accepts a value a CHECK refuses.

⚠ Still owed: **nothing has been published yet.** The fix means the next
publish can write; it does not backfill the 699 punches already taken.

**Correction to the record: `manav_employees.user_id` is NOT null on every
row.** The cloud session's Pahchan clock-in commit says it is, and this ledger
repeated it. Live 2026-08-27: **5 of 109 carry a `user_id`**. The web clock and
mobile punch work for those accounts today; the gap is that almost nobody else
has one, which is 0.23's job — not that the feature is dead.



**`/cron/billing` is verified but NOT SCHEDULED — one Railway config change
away.** The endpoint has been run twice by hand against the deploy and behaves
(see 3.3's acceptance below); what has not happened is adding `billing` to
`cron-daily`'s curl loop, which currently reads
`hr invoices crm stock marketing skills scraper-prices`. Until it does, client
auto-invoicing only happens when somebody fires it. Railway V2 does not
shell-interpret `startCommand` — keep it literal — and a redeploy reuses the OLD
config snapshot, so the change needs a FRESH deploy (`DEPLOY_NUDGE`) to take
effect. Read the deployed output back afterwards: a dead backend looks like CORS.

**Resolved on the way there — the back-billing question.** All four
`client_service_lines` in the product belong to **Unicode Group**, the real
customer, and two auto-invoice (₹75,000 + ₹15,000 monthly, running since
2026-04-01) with nothing recording them as billed. Armed as it stood, the first
tick would have raised **April**, then one more month each day — ten tax
invoices, ₹4,50,000 + ₹81,000 GST, into a customer's books unattended.
**Owner's decision, 2026-08-26: start the clock in August.** Migration 223's
`invoice_from` is the mechanism, and it was chosen over moving `period_start`
because `period_start` is when the SERVICE began — the firm's own contract term,
shown on its screen — and rewriting it would have left the true date nowhere.
Set to `2026-08-01` on those two lines only; reversal is
`SET invoice_from = NULL` on the same two ids, which restores the April backlog.

**Unicode's payroll run headers have never matched their payslips.** Five of
their eight runs disagree with the rows beneath them; **E2E is clean on all 17**,
so this is not a code path everyone hits.

**🟡 Pahchan can now be clocked from a browser — and still nobody can use it.**
`POST /v1/pahchan/punch` has been complete for months and had exactly ONE
caller, `mobile/src/screens/pahchan/ClockScreen.tsx`. There is no iOS build of
that app, so an employee on an iPhone could not clock in from anywhere, while
the web carried every reviewer screen and no way to punch. The missing caller
now exists (Pahchan → **Clock in** tab): selfie, compression to fit the 768 KB
cap, geolocation, idempotent retry. No new endpoint, no new table, **no
migration** — `captured_at`/`received_at` and `flags TEXT[]` already carried
everything this needed.

It is 🟡 and not ✅. **The blocker it was written about is GONE, and a second
one is now visible underneath it.**

The old blocker was the join: `create_punch` resolves the employee through
`manav_employees.user_id`, and `routers/pahchan.py` still says in a comment
"0 of 81 employee rows carry a user_id today, so `_employee_for` returns None
for everybody". That sentence is stale on both numbers — **live 2026-08-27, E2E
holds 83 employee rows and 12 of them are linked**, one-to-one, to 12 distinct
logins, across 11 department/designation shapes (Phase 0.23). Unicode Group has
2 of 26. So the 409 no longer fires for everybody.

The condition this row set — "one employee linked AND a punch row appears" — has
now BOTH halves satisfied on paper, and it still does not close, because the
condition was written loosely. `staging.pahchan_punches` holds exactly one E2E
row (2026-08-27 00:13:07 UTC, Isha Desai, direction `in`), and it did arrive
over HTTP from a browser — `audit_log.user_agent` on the single punch audit row
in existence reads desktop Chrome on Windows. **But it did not come through
`Clock.jsx`.** Three tells, all from the row itself: its `client_punch_id` is
the literal `e2e-phase023-first-linked-clock-in`, where the screen mints a
`crypto.randomUUID()` (`lib/pahchanClock.js:128`) and the mobile queue mints
`Crypto.randomUUID()`; `photo_key` is NULL where that screen always uploads a
selfie first; and `lat`/`lng` are NULL with `flags` reading `{geo,accuracy,noref}`.
It is a scripted POST from a browser, not a person operating the tab.

**So the honest state is: the join is fixed, the endpoint answers a browser, and
no human has completed the flow end to end.** ✅ needs one punch whose
`client_punch_id` is a UUID and whose `photo_key` is set — which would also be
the first `photo_key` this table has EVER held (0 of 700 punches carry one).

⚠ **The table cannot tell web from mobile.** `pahchan_punches.source` is
CHECK-constrained to `('live','offline')` — that is connectivity, whether the
punch posted immediately or replayed from the offline queue — and no other
column records a platform. The only place the platform is written down is
`audit_log.user_agent`, and Unicode's 699 punches have no audit rows at all
(they were seeded straight into the database). Any future claim about "the web
clock-in works" has to name the audit row it is reading.

### ⚠ Suite 09 found the reason nobody has ever punched from a browser — TWO of them

Proposal 93 Suite 09 drove the Clock-in tab as a person, 2026-08-29, and the
flow does not merely lack a caller: **two separate faults each independently
make it impossible**, and both are now fixed.

**1. An HTTP header switched the camera and GPS off.** `frontend/vercel.json`
sent `Permissions-Policy: geolocation=(), microphone=(), camera=()` on
`/(.*)`. ⚠ **An empty allowlist is not "no restriction" — it disables the
feature for the document's OWN origin**, so `getUserMedia` and
`geolocation.getCurrentPosition` were refused before any permission prompt
could appear, and no grant the person gives can override it. Pahchan's whole
premise is a selfie inside a geofence; the header removed both. Verified served
on staging AND on `www.kartavaya.com` before the change. Now
`geolocation=(self), microphone=(), camera=(self)` — microphone stays off
because nothing here records audio.

**2. Requesting a regularisation 500'd on every call, always.**
`POST /v1/pahchan/regularisations` bound `body.for_date` (a `str`) to
`$4::date` and `body.requested_at_time` to `$6::timestamptz`. asyncpg infers
the Python type from the cast and refuses a `str` before Postgres sees the
statement — so `staging.pahchan_regularisations` has held **0 rows for its
entire life**, which is the consequence, not a coincidence beside it.

⚠ **The identical fault, with its fix and its history, sits 200 lines below in
the same file.** `publish_attendance_to_payroll` documents that it "did that on
every call, for every org, since it was written" and names the bank-statement
import (`2b864aa8`) and the sales target (`eae0b912`) as the same family. Four
shipped instances now, the fourth reintroduced under the comment explaining it.
That is the argument for a check over a rule, so there is one:
`backend/tests/test_date_params_are_parsed_not_bound_as_str.py`, mutation-proved
to fail when the parse is removed.

Both are 🟡 until a punch and a regularisation are typed by a person — code
shipped is not a customer completing the flow.

### ⚠ Suite 08 found two money defects in payroll — both on live payslips

**A loan was recovered out of a reimbursement, and the employee was paid ₹0.**
`loan_capacity` read `gross_fixed + reimbursement_total - statutory - floor`.
A reimbursement is the employee's OWN money coming back — they paid for
something the firm needed. The 50% take-home floor does not protect it, because
the floor is a share of `gross_fixed`, and half of zero is zero.

**PS-2026-0011, Aarav Trivedi, June 2026, live:** gross ₹0.00, reimbursement
₹750.00, loan deduction **₹750.00**, net pay **₹0.00**. The control case is in
the same run — PS-2026-0019, Aditya Barot, identical ₹0.00 gross, ₹875.00
reimbursement, no active loan, net **₹875.00**. The loan is the only difference
between the two payslips.

⚠ **The comment directly above the line already stated the rule the line
broke** — it explains the capacity uses the FIXED gross so "adding a bonus can
never increase what is taken out of somebody's pay", and the next line added a
reimbursement, which is not even an earning. Payment of Wages Act 1936 s.2(vi)
excludes reimbursed special expenses from "wages", and s.7 deductions are
deductions FROM WAGES, so this also inflated the s.7(3) ceiling with money the
Act says is not wages.

**A June run reimbursed August expenses.** The claim sweep had no upper bound,
so every approved unpaid claim landed on whichever run was processed next.
**2 of the 2 reimbursements this product has ever paid were wrong this way** —
claims dated 5 and 6 August 2026 paid on June 2026 payslips. Bounded to
`expense_date <= month_end` (the END of the period, so a claim approved after
its month still rides the next run rather than being stranded), and aligned to
`is_active=TRUE` so payroll pays what the expenses screen shows.

Both fixed, mutation-proved, and the query parsed against the live catalogue
(6/6 under `railway run`). The two June payslips are **not restated** — a
repair to a generated payslip needs its own written risk report.

### ⚠ Suite 05 — an empty box was a 422 nobody could read

**Rate cards stood at 0 of 3** while every other Ganit volume filled.
`POST /v1/ganit/billing/rate-cards` refused every card that had no note:
`RateCardCreate.notes` was `str = ""` and the form sends `notes: form.notes ||
null`. It was never one field — across the four create/update pairs in
`client_billing`, **eighteen** fields are nullable on update and were not on
create. Blank accepted when you EDIT a row and refused when you CREATE one is
not a rule anybody could guess.

Fixed with a shared `_NullMeansUnset` base rather than eighteen widened
annotations, because widening by hand leaves the nineteenth. A required field is
still required; a field annotated `X | None` still takes `None` as a value.

**And the other half: the screen only ever said "Failed to save".** FastAPI
sends `detail` in three shapes, and 184 call sites handled one of them —
`e.response?.data?.detail || 'Failed to save'`. On a **422 the detail is an
ARRAY OF OBJECTS**, which is truthy, so `||` keeps it and hands an array to a
React child: React error #31, the same crash that replaced a whole tab earlier
in this programme. `frontend/src/lib/apiError.js` now flattens all three shapes
to one readable line, and 184 sites across 90 files use it. The 5 sites that
read `detail` structurally were left alone.

`docs/modules` precedent: `docErrors.js` already argued this case for PDFs —
"a toast reading 'Failed to generate PDF' tells the user nothing and leaves them
clicking the button again". The same sentence was true of every other refusal.

### The frontend test suite was RED before this session, on two ratchets

Neither is in `npm run check` — **`check` does not run vitest**, which is how
both stayed red unnoticed.

**`labelShape` had drifted from 8 leaking label sites to 11.** `TabMembers.jsx`
was converted and four new leaks arrived behind it: three were
`{hi && <span lang="hi">…}`, which guards on the VALUE and not the language so
the Devanagari renders under English, and the fourth was a hardcoded `कर्तव्य`
in the Pay footer. All four converted to `<Secondary>` — which returns `null`
under EN, so the node is absent rather than hidden — and **the baseline is
lowered to 7**, never raised.

**`sanvaadLegacyVocabulary`** wanted `wa__note` inventoried and reasoned. It is
the outbound fence's own row, deliberately not `.m2-msg--failed`: nothing
failed, and "Not delivered" would send a person looking for a fault that is not
there. Varta is §13 excluded-by-decision and the `.m2` migration is parked at
38%, so a new element there takes its file's vocabulary.

**Vitest is now 3153/3153 green across 191 files.**

| Run | Header says | Payslips actually |
|---|---|---|
| 2026-04 `disbursed` | 23 / ₹12,80,846.14 | **28** / ₹15,58,196.14 |
| 2026-05 `disbursed` | 23 / ₹12,79,538.45 | **28** / ₹15,56,888.45 |
| 2026-06 `disbursed` | 24 / ₹13,27,000.00 | **30** / ₹16,19,350.00 |
| 2026-07 `approved` | 24 / ₹14,12,055.56 | **30** / ₹14,65,334.87 |
| 2026-09 `draft` | 0 / ₹0.00 | **6** / ₹2,92,350.00 |

**This predates today and was not caused by the Nikhil removal** — proven from
the pre-deletion snapshot in `ledger_repair_20260826.nikhil_runs_before`: the
April header already said 24 against 29 payslips. The removal decremented three
headers by exactly his contribution, which was correct arithmetic on a number
that was already wrong.

A run header is what every payroll list, cost tile and analytics band reads —
nobody re-sums the payslips. So five Unicode runs report a headcount and a gross
that the payslips beneath them contradict. **Not fixed, and deliberately not
fixed today:** the right repair is not obvious (is the header wrong, or are
there payslips that should never have been written?) and it needs the same
treatment the ledger repair got — a written risk report first.

## Phase progress (`docs/plans/`)

| Phase | What | State |
|---|---|---|
| 0 | Owner unblocks (31 items) | 🟢 **all 31 answered 26 Aug** — 19 decided, 12 parked by the owner. Nothing here awaits him. **0.20 ✅ 27 Aug** — Ganit's stripped 4-field vendor form is gone; Ganit and Kray now share ONE `components/VendorForm.jsx`, so all six MSME/TDS columns are capturable from Payables and the field set cannot fork (a set-equality test across both tabs is the ratchet). Live: E2E 75 vendors, 12 carrying all six; Unicode 9 and 0. **0.22 ✅ 27 Aug** — migration 226 adds `public.tasks.client_id` (nullable, partial index), with the ownership check on the write path rather than a foreign key: `graha_clients.id` is unique table-wide, so an FK would admit another org's customer. A client picker on the task drawer, `ServerPicker` because the clients endpoint is LIMIT 200. 483 tasks, all NULL — no backfill, because a task names a team, not a customer, and guessing bills the wrong firm. **0.24 ✅ 27 Aug** — migration 224: the shared ladder goes **9 rows → 23**, 3 states → 7 (Assam, West Bengal, Telangana, Andhra Pradesh), each band cited to its own notification and checked against the Art. 276(2) ₹2,500/yr ceiling. **Nobody moved**: E2E still ₹11,800 across 60 payslips and Unicode ₹4,800 across 24, 84 of 84 agreeing. Fifteen states left out with a written reason each — seven band on ANNUAL income, three are half-yearly and set by the local body (Tamil Nadu is the valuable one still owed). ⚠ **Three findings for you, all zero live exposure today**: Gujarat's shared ladder is 4 years stale, Karnataka's is stale, and Maharashtra has a gender dimension the table cannot express (women exempt to ₹25,000 since 2023) — the first two are live-row edits, the third needs a column. **0.23 ✅ 27 Aug** — 12 employees linked in E2E through the real screens, 11 distinct role shapes, zero INSERTs; `pahchan_punches` got its **first ever row in E2E**. ⚠ Two corrections to this line, both from a live re-read on 2026-08-27: the denominator is **12 of 83**, not "0 of 73 → 12" (E2E holds 83 employee rows, not 73; Unicode is 2 of 26), and "the web clock-in is unblocked" claims more than the row proves — that punch did not traverse `Clock.jsx`. Its `client_punch_id` is a hand-authored literal where the screen mints a UUID, and it carries neither the selfie nor the geo fix that screen always sends. The JOIN is unblocked, which is what 0.23 was for; the screen is still unproven. See the Pahchan section above. **0.27 ✅** — migration 227 seeds the WhatsApp rate card as estimate data that cannot be read as fact (four mechanisms, incl. a CHECK that makes an uncited figure uninsertable). Build halves still open: **0.29 fresh APK only** — 0.27 is ✅ above, and this trailing line still named it until 2026-08-27 |
| 1 | Six write-paths (turns ~18 features on) | ✅ **ACCEPTANCE PASSED 26 Aug** — all six counters are live non-zero, every set row created through the UI today. Live, both orgs: invoices `salesperson_id` **5**/800 · orders **3**/380 · vendors MSME/TDS **12**/90 · expenses `contact_id` **9**/385 · employees `state` **110**/110 · holidays `state_code` **11**/48. The old "0/790, five of six still need a real create" table was written at 06:48 and never refreshed after `775b1bcc` landed at 08:36 |
| 2 | Six correctness fixes (the blockers above) | ✅ **ACCEPTANCE PASSED 26 Aug — 10/10, driven as a real user against the deploy.** Payroll run for 2026-08: **51 paid, not 60**; the mid-month leaver credited **2 present days of 26**, not a whole month; PT **₹10,000** from the Maharashtra ladder (not ₹10,200 — pro-rating drops that leaver's gross into the ₹0 band, which is the two fixes composing correctly); Dristi overview **₹11,14,93,756.12** invoiced against ₹12,29,86,008.58 before, outstanding **₹2,71,54,767** against ₹3,86,36,429.46, with ₹54,78,968.92 of drafts on the books and excluded; cross-tenant profile create refused; pahchan metrics computing. All six are coded and deployed, and **nine further defects found by verifying them are now fixed**: payroll paid a part-month as a whole one (₹41,262 on one payslip), `/cron/hr` marked attendance for leavers, Dristi `/overview` carried a **₹1,14,92,252.46 draft phantom**, a draft could be marked *paid* (Unicode, ₹2,06,500), the 2.5 ratchet covered one module of 42 id-alone joins, two user-facing claims were false, 2.3's writer violated 1.3, and analytics banded 60 where payroll pays 51. |
| 3 | Billing executable + arm cron | 🟢 **3.1 ✅ · 3.2 ✅ ACCEPTANCE PASSED 27 Aug · 3.3 ✅ ACCEPTANCE PASSED · 3.4 verified, not scheduled.** 3.2 driven through the admin console as an operator: a mid-cycle downgrade wrote **credit ₹3,200** ("unused 4 days at ₹20,000/mo") and **charge ₹2,400** ("4 days at ₹15,000/mo"), both `one_off`, both quoting the same 4 days — **net −₹800**, where the two-debit shape billed ₹5,600. ⚠ **And the acceptance found why it had never run: `POST /admin/set-plan` has ALWAYS 500'd** — it bound `users.user_id` (text) into `subscriptions.activated_by` (uuid, FK to `users(id)`; `public.users` has both columns). 5 subscriptions, 0 with `activated_by` set. Fixed by resolving the id, keeping the FK. 3.3: `/cron/billing` fired twice — `client_invoice_lines` 0 → 2, auto-invoices 0 → 2 (INV-2026-0093 ₹88,500, INV-2026-0094 ₹17,700, both Aug, intra-state Gujarat), then `created 0, skipped 2`. April–July not raised: `invoice_from` held. ⚠ **3.4 IS DONE AND THIS LINE WAS STALE** — `billing` is in `cron-daily`'s start command, read off the Railway service config 2026-08-29 (`for p in hr invoices crm stock marketing skills scraper-prices billing`). The tick SCHEDULE was not read, so "wired" is the claim here, not "firing". ⚠ And that makes the sweep an UNATTENDED invoice writer: it minted both rows above as `doc_status='final'` — the column DEFAULTS to it — so neither passed `ganit._refuse_final_if_incomplete`, the Rule 46 gate every hand-issued invoice clears. Fixed 2026-08-29: the sweep writes `'draft'` and a person issues it with `Mark final`, which runs the gate |
| 4 | Eight invisible-feature screens | 🟢 **ALL EIGHT LANDED 27 Aug — every one an endpoint that had no caller at all.** **4.3 ✅ ACCEPTED**: `skill_finding_ack` **0 → 1** through the deployed endpoint, and re-running the skill then returned 2 findings instead of 3. It was empty for a reason no frontend could fix — `apply_wiring` returns the output untouched when the org holds no acks, so no finding ever carried a key and no client could ask for the FIRST one. A door locked from the inside. **4.1** compliance settings, **4.2** Pahchan consent, **4.4** storage browser, **4.5** the dock Due tab (the `income_tax` typo was worth 22 rows; Finance 7 → 13), **4.6** billing anchor, **4.7** pause/resume, **4.8** quota proration. **Both first rows now exist** (this line said they were still 0 until 2026-08-27, hours after the clicks): `module_compliance_settings` **0 → 1** and `pahchan_employee_consents` **0 → 1**, both E2E, written 27 Aug 00:45:52 and 00:46:10 through the real screens. Verified live. Phase 4 is ✅ on all eight. Storage and Due are read-only surfaces with no row to write |
| 5 | Statute calendar → payroll/invoicing | 🟢 **CLOSED 27 Aug — the ladder has priced a real payslip.** Run **2026-09**, E2E, `processed`, 3 employees: gross ₹5,78,041.00, **TDS ₹85,370.56**, PT ₹600, PF ₹10,800, net ₹4,86,670.44. **The `statutory_treatment` column is the acceptance, not the totals** — PT resolved from the slab table (`"pt_basis": "slab"`, Maharashtra `27`, `slab_from` 10001, `effective_from` 2024-04-01) and TDS priced **per REGIME on one run**: one employee `"tds_regime": "old"` → **₹42,036.90**, two on `"new"` → **₹22,144.83** and **₹21,188.83**. Two ladders giving three different numbers is something a hardcoded rate cannot produce. **Nothing was destroyed:** 2026-09 was chosen because every month 2025-04→2026-08 already holds a non-draft run and `process_payroll` refuses anything but `draft`, so Phase 2's evidence (2026-08: 51 payslips, TDS **₹6,88,924.66** on the stale ladder) is intact and is now the *before* half of a real comparison. ⚠ **The population lever is `vetana_salary_structures.is_active`, NOT employee rows** — payroll excludes people by EXIT DATE on purpose, so deactivating employees would not have shrunk the run at all. 60 structure ids snapshotted to `payroll_smallrun_20260827.structures_before`, 3 kept, all 60 restored and verified twice (60 of 60 back, 0 active outside the snapshot). — *(the prior 🟡 state below)* **the code all landed 27 Aug; the half that moves money has produced no row.** Marked 🟢 COMPLETE until 2026-08-27, and that was this project's own oldest mistake — code-without-data is 🟡. Live: the ladder was seeded 03:43:57 UTC and **0 of 1,160 payslips have been computed since**. The latest E2E run is 2026-08, processed 26 Aug 08:46:53, `total_tds` **₹6,88,924.66** — priced by the year-stale literal ladder this phase exists to replace. `income_tax.ladder_for` has never priced a real payslip. **ONE ACTION CLOSES IT**: re-run payroll for E2E 2026-08 through the screen and read the new `total_tds`. Not done unasked — `process_payroll` deletes and re-inserts a month's payslips, so it would overwrite the rows that ARE Phase 2's acceptance evidence, and that is a live-row change to name rather than to take. 5.1, 5.2, 5.2b and 5.3 all landed: **5.1**: the ESI ceiling (26 Aug), then PF's rate and ceiling (migration 228) and the ESI rates (232). Each stayed a literal for a real reason — **the store held no key for them**: `epf.remittance` and the ESI rows are DUE-DATE rows with NULL figures, and of 45 rows exactly one carried a payroll number. The law is seeded and cited now, and **no payslip moves**: 12% of ₹15,000 is the ₹1,800 the literal carried, and 0.75/3.25 are the same rates. **5.2**: gratuity and statutory bonus — seven keys, each with its section. **LWF deliberately NOT seeded**: it is state law with different rates, periodicity and splits per state and only ~15 states operate one, so a national row would be wrong everywhere; it needs the PT ladder shape, and a test stops anyone adding one to tick the box. **5.2b ⚠ THIS ONE MOVES MONEY**: the hardcoded new-regime ladder was **a year out of date** — AY 2025-26 bands against an FY 2026-27 run — so the product has been **over-deducting TDS**. At ₹2,00,000/month that is ₹8,958 too much every month. Migration 230 puts both regimes in `pay_income_tax_slabs`, one row per band, cited to each Finance Act; the next run deducts the correct figure. An absent ladder deducts ₹0 and **never** falls back to a literal. **5.3**: GST thresholds and the 194Q watch read the dated store, degrading rather than refusing when a row is absent |
| 6 | Retire 4 duplicate models + SQL-test rule | 🟢 **24 of 24 DONE — the list is closed, 27 Aug.** **6.4 ✅**: `public.report_schedules` is gone (migration **236**, verified absent in BOTH schemas from a separate connection). Retiring it was never a DROP: the CRUD and dispatcher left `routers/reports.py`, **`server.py` stopped recreating the table on every startup** — the step that decides whether the drop means anything, since an empty table that has come back is indistinguishable from one never dropped — and `invite_router.py`'s two UNQUALIFIED statements went with them. ⚠ **Those statements would NOT have failed loudly**: `run()` swallows every exception, so the 42P01 would have been a permanent invisible failure on the user-deletion path. **The timer was on the wrong system**: the empty table was swept hourly while `staging.dristi_scheduled_reports` (7 real rows) had never dispatched once. `DRISTI_REPORT_SWEEP_ARMED=true` is now set and **confirmed live** (`armed: true` from the running container). ⚠ **The new sweep had the OLD duplicate-send bug** — it stamped `last_sent_at` AFTER mailing, inside the same try. It now claims the row first, with `IS NOT DISTINCT FROM` not `=`, because six of seven rows have `last_sent_at` NULL and `NULL = NULL` is NULL, so `=` would have claimed nothing on precisely the never-sent rows. Recipients verified before arming: **1 active schedule, mailing the owner**; 6 inactive, all to the owner's own E2E address; no Unicode rows, no recipient outside its own org. Dry run `would_send: []` — nothing due until 31 Aug. **One step left and it is the owner's**: two dashboard fields on `cron-report-dispatch` (start command → the dristi endpoint using `CRON_SECRET`, schedule `7 * * * *` → `*/15`), because the Railway CLI cannot set either and MCP writes are unauthorized. See `docs/OWNER-ACTIONS.md` item 11. — *(235 and the three sales tables below)* **23 of 24 DONE — migration 235 took the last three, 27 Aug.** `sales_territories`, `sales_targets` and `sales_routing_rules` are gone on the owner's "approved", which was owed as THREE tables because the latter two FK into the first and were never named. All three `staging`-only, **0 rows** by `count(*)` in both schemas. ⚠ **And a DROP could not have seen the real dependency**: `staging.crm_deals` carries `trg_stg_deal_close_target` → `sales_update_target_on_deal_close()` → `UPDATE staging.sales_targets`. **A PL/pgSQL body is parsed when it RUNS, so Postgres records no dependency** — the DROP would have SUCCEEDED, reported success, and left a trigger raising 42P01 on the next `crm_deals` update. The house no-CASCADE rule does not reach this class at all, because the statement never fails. Found by reading `pg_proc.prosrc`, not the constraint graph. ⚠ **The schema was NOT recoverable from git** — no migration ever created these three — so the full DDL was read from `pg_catalog` and written into the migration header as the reversal. `touch_updated_at()` (27 triggers) explicitly spared. Verified from a third independent probe: six names absent, trigger 0, function 0, `touch_updated_at` 1, 0 function bodies still naming them. **Only `public.report_schedules` remains of the 24** — 6.4, in flight. — *(the 20-table drop below)* **THE DROP IS DONE — 20 of 24, 27 Aug, on the owner's "go ahead".** Migration **234** dropped ten `hr_*`, seven `pay_*` and three `sales_commission*` tables, all verified at **exactly 0 rows** with `count(*)` (never `n_live_tup`, which reported 23 and 14 today for two tables that both held 23). **FOUR WERE EXCLUDED AND EACH IS NAMED:** `pay_professional_tax` (**23 rows**, the shared PT ladder every payroll run reads) and `pay_income_tax_slabs` (**23 rows**, read by `income_tax.ladder_for` for every TDS figure) — dropping those two takes professional tax AND income tax to ₹0 for every employee, and they were on the list only to be visibly excluded. `public.report_schedules` — **0 rows and still not safe**: `routers/reports.py` holds EIGHT live statements against it and `POST /api/reports/dispatch` is on an ARMED hourly cron, so dropping it 42P01s the CRUD and fails the cron every hour; retiring the second scheduler is 6.4's DECISION and means removing a router and disarming a cron, not dropping a table. And `sales_territories` — 0 rows, but `sales_targets` and `sales_routing_rules` both FK into it and **neither was on the owner's list**, so dropping it necessarily alters two tables he did not name. It needs putting to him as three tables. Checked before writing the migration: every inbound FK to the twenty came from inside the twenty, no view or matview depended on any, and the only code naming three of them (`hr_employees`, `hr_holidays`, `pay_tds_records`) does so in **comments** — nothing executes. ONE statement naming all twenty, because `hr_employees` alone had twelve inbound keys from its own stack and a single statement resolves the order; **NO CASCADE**, so an unfound dependency FAILS the drop instead of being silently discarded. Re-counted a second time INSIDE the transaction, to abort if anything had gained a row since the audit. After: 20 of 20 gone, all four exclusions present with their rows, and payroll's own tables untouched (1,160 payslips, 109 employees). No data to restore — all twenty were empty, which is why they could go; the schema stays recoverable from the migrations that made it. **the rule is shipped and two of the four "duplicates" turned out not to be, one of them dangerously.** ⚠ **TWO `pay_*` tables are live, not one** (re-read 2026-08-27): `pay_professional_tax` **23 rows** and `pay_income_tax_slabs` **23 rows** — the latter created by migration 230 during Phase 5.2b, read by `income_tax.ladder_for` for every TDS figure on every payslip. Neither is part of the dead stack: PT is the shared ladder every payroll run reads (9 rows when this was written, 23 now that 0.24's states are in), and the plan's "drop the `hr_*`/`pay_*` stack" would take professional tax **and** income tax to **₹0 for every employee**. The other 17 are genuinely empty. **6.4 IS OPEN — my "stale premise" verdict was FALSE and is corrected.** `public.report_schedules` exists (15 columns, 0 rows); the `42P01` I read as "no such table" came from a `staging.`-qualified query and says nothing about `public`. It is a full second scheduler — CRUD in `routers/reports.py`, written by `invite_router.py` too, and `POST /api/reports/dispatch` on an **armed hourly cron** (`cron-report-dispatch`, `7 * * * *`). Phase 6 exists to stop exactly this, and its own rule was followed: there WAS a live query — in one of two schemas. The rule's missing half is now written down, and `test_two_report_schedulers.py` (4) fails if any ledger re-publishes the claim. 6.3 decided — KEEP BOTH allocators, because a PO is numbered at ISSUE and `next_doc_number`'s `ORDER BY created_at` would restart the series at 0001 on the next draft; the boundary is now `test_two_serial_allocators.py` (5). **The process rule is a ratchet**: `test_every_writer_has_a_live_sql_test.py` (4) — **40** routers write to `staging.*` or `public.*`, **8** have a live-schema test, **32** baselined. (Published as 36/6/30 until 2026-08-27 — measured wrong, and the pattern was `staging.`-only so it could not see `reports`, `org_invites` or `templates` writing to `public.` at all. Widened; the baseline grew by exactly those three, once, with the reason recorded beside them. It only shrinks otherwise.) **6.1 was answered by seeding, not dropping**: the owner's call. The live half worked and E2E Test & Associates had **0 schemes across 83 people** — a model nobody in the test org could exercise. `commission-seed.spec.ts` drives the real screen and E2E now holds **1 scheme / 3 bands** on the owner's own ladder (3% from ₹1L, 4% from ₹5L, 7.5% from ₹10L, typed 7.5/3/4 and stored 3/4/7.5). The dead `sales_commission*` three stay 0/0/0 and stay put — they cannot be seeded either, their `user_id` is `uuid` where `users.user_id` is `text` — and the DROP is still **not approved**: 0.30 named three restore schemas (`qa_cleanup_20260822`, `punch_cleanup_20260823`, `owner_actions_20260823` — all three already gone, checked live) and named none of the **22** product tables (10 `hr_*` + 7 empty `pay_*` + 2 LIVE `pay_*` + 3 `sales_commission*`), so the 22 need putting to the owner as 22 — plus `public.report_schedules`, which 6.4 adds. Written "twenty" until 2026-08-27; a DROP list that is short by two is a list with two tables nobody named. Housekeeping done in the same pass: the `PROPOSED_080` collision is renumbered (090) with `test_migration_numbers_are_unique.py` (4) holding it, migration 183's "IS NOT APPLIED" scaffolding is removed after a live check found it fully applied, and `generate_rich_content` read a `user_id` it never took — a `NameError` on its first inline image, now a parameter with 2 tests that fail without it. Counts are exact `count(*)`. `n_live_tup` is NOT usable here and today reports 23 and **14** against two tables that both hold 23 — it read 0 for both when this row was written, so the specific figures rot while the lesson does not |
| 7 | Territories ROUTE + Indian address capture | 🟢 **7.6 ✅ ACCEPTED 28 Aug — a person types and Mappls answers, on the deployed site.** `phase76-autosuggest.spec.ts`, real Chrome, signed in, staging.kartavaya.com: typing into the vendor form's address field returns **11 suggestions** with the *Powered by Mappls* credit on `.terr__mapbrand`. That is the row, not the code. ⚠ **AND THE RESULTS ARE POOR — SAID HERE RATHER THAN CELEBRATED AWAY.** The query *"Bopal Ahmedabad"* returns *"D Tale Object — Kandivali East, Mumbai"* first: a different city, 500 km away. `mappls.search` is a **POI/keyword** search, not an address autosuggest, and it is matching on business names. Reproduced identically in the raw SDK probe, so it is Mappls' relevance and not our wiring. **The product that would do this properly is their Autosuggest API — which is the one refused server-side**, so the honest position is that the feature WORKS and is not yet GOOD. Improving it means either a location bias (available, and it must NOT be built from the record being edited — that is the licence rule) or the Autosuggest product once Mappls enables it. ⚠ Nothing here is load-bearing for an address: the pincode → state half runs on our own government directory and is unaffected. — *(prior state below)* **7.6 AUTOSUGGEST MOVED INTO THE BROWSER — 28 Aug, owner's call.** The server-side proxy could not work and the reason is now measured rather than asserted: Mappls' host **accepts our OAuth token as valid** and then refuses on domain grounds (a garbage token gets `invalid_token`; ours gets `Domain validation failed`), identically across six Referer/Origin variants and two endpoints. ⚠ **AND A PLAIN BROWSER `fetch` IS IMPOSSIBLE TOO** — measured in a real browser on the whitelisted origin BEFORE anything was rewritten: `atlas.mappls.com/places/search/json`, `/places/geocode` and `apis.mappls.com/.../autosuggest` are **all CORS-blocked**, *"No Access-Control-Allow-Origin header is present"*. No key, header or whitelist entry changes that — the response is blocked before our code sees it, and assuming otherwise would have shipped a rewrite that failed exactly like the proxy. **What works is the SDK's own `search`**, which ships its own transport: the map bundle we already load has **124 keys and NOT ONE search surface**, the plugins bundle takes it to **139** and adds `search`/`placePicker`/`advancePlacePicker`, and `mappls.search({query})` returned **11 results** live. Loaded LAZILY, only when an address field asks. ⚠ **MY WARNING ABOUT THE COST WAS WRONG AND IN THE OWNER'S FAVOUR**: client-side adds **no** new key exposure — the Static Key is already served to every signed-in browser for the basemap — and it **ANSWERS** the Geospatial Data Guidelines question rather than deepening it, since the data no longer passes through our servers. **What Mappls actually returns, enumerated in a browser rather than read off the docs**: `type, placeAddress, eLoc, placeName, alternateName, keywords, orderIndex, suggester, distance` — **no city, no state, no pincode**, only a comma string. The proxy shaped six fields out of such a string and that shaping was a GUESS. So exactly two things are taken: `placeName` as line1, and the last comma-segment as a pincode **only when it passes the product's own regex** — then our OWN 20,144-row government directory fills state and district, which is authoritative, free, names the district too, and REFUSES to fill when a PIN spans two districts instead of picking one. ⚠ **`eLoc` is deliberately dropped** — Mappls' own primary key for a place becomes a hard dependency the first time anything joins on it; a test asserts it never reaches the parent. The licence rule moved with the transport: `search` is handed an options object with **exactly one key**, asserted as a set, because `mappls.search` accepts `location`/`bounds`/`filter` and the realistic breakage was always sending the record **as well** to sharpen results. Proved to bite: adding a `location` fails 1; passing `eLoc` through fails 3. ⚠ **ONE OWNER ITEM CREATED: rotate `MAPPLS_STATIC_KEY`** — the probe printed it into a run log on its first pass, because a CORS error quotes the full refused URL. Redacted now. The server-side proxy stays in the tree, tested and unused, because it is the better shape if Mappls ever enables it. — *(prior state below)* **§7.6's REQUIRED EXPECTATION RESET WAS MISSING FROM THE PRODUCT — added 28 Aug.** The plan says "put a one-line lede under the address block saying what a PIN can and cannot fill". It lived in the plan and in commit messages and **nowhere a customer could see it**. The owner asked for the UK "type a postcode, get your address" flow and **it does not transfer** — a UK postcode resolves to ~17 addresses, an Indian PIN averages ~82 km². Without the line a person types a pincode, gets a state and no street, and concludes the lookup is broken when it is working exactly as the data allows. Now rendered **on every branch**, deliberately including the one where the lookup returns NOTHING (531 PINs with a published boundary are absent from the directory release) — that is the branch where somebody decides the feature is broken, and the one a happy-path test misses. Not rendered for a non-PIN: nothing is looked up, so there is no expectation to set, and `INC UK`'s `NW1 245` is still not corrected. One definition, so the vendor form and the employee form cannot drift on what a pincode promises. 5 tests, proved to bite (shortening the lede fails 4 of 5). ⚠ **A status line in this session said "no page wires the component up yet" and was already wrong when written** — `AddressSuggest` and `PincodeAutofill` are mounted on **both** surfaces §7.6 names, checked by grep across `src/` rather than assumed. — *(prior state below)* **7.6 — ADDRESS CAPTURE WORKS; the Mappls half is refused by Mappls. 28 Aug.** The phase is called *Indian address capture*, and that now works end to end on vendors and employees **with no vendor at all**: `PincodeAutofill` reads `GET /v1/pincodes/{pin}` over `staging.pin_directory` (20,144 government rows, already in our database), names the district and offers the state. **No key, no quota, no allocation, no vendor call — and no LICENCE**: nothing is submitted, so nothing is licensed, and ⚠ **the Geospatial Data Guidelines question that hangs over the Mappls path does not arise here at all** — this is open government data we already hold under GODL-India, credited on every answer. Verified live against the deploy: `395002 -> fills GUJARAT, shows SURAT` · `400706 -> fills MAHARASHTRA, shows THANE` · `110020 -> fills NOTHING, names SOUTH, DELHI and SOUTH EAST, DELHI` · `999999 -> not listed, and the address still saves`. ⚠ **IT FILLS STATE AND NEVER CITY, because a district is not a city** — 400706 is THANE district and the city is **Navi Mumbai**, which the live `Navrang Polymers` row says in as many words; writing a district into a city box puts a confident wrong answer into a customer's record. ⚠ **And a PIN is not one place**: 1,229 span two or more districts and 51 span two or more STATES, so a multi-row answer fills nothing and names every candidate. The fill is a **button, not an effect** — a form that rewrote a state while somebody was typing would look right and be wrong. It blocks nothing: an unlisted pincode says *"the address saves either way"*, never *"no such pincode"*, the same owner rule that makes GSTIN/PAN/TAN non-mandatory. **The Mappls autosuggest half stays 🟡 and is not ours to fix** — see below. — *(the autosuggest half)* **7.6 WIRED 28 Aug — and BLOCKED on one Mappls console entitlement, not on code.** `AddressSuggest` is now live on **vendors and employees**, the two screens §7.6 names, so it is no longer code nobody can reach. ⚠ **The employee form had NO address input at all** — the same defect shape 8.0 found on vendors: `manav_employees.address` is jsonb, `EmployeeCreate.address` accepts it and the INSERT binds it, and there was nowhere to type it, so **all 83 live rows are `{}`**. Four boxes now exist beside the suggest field. The suggestion **fills** the record and never replaces it (`...(sug.city ? {city: sug.city} : {})`, so a key the vendor did not return is not written — a plain assignment would blank the field on every partial match), and the hand-editable boxes stay the record. The search fragment is stripped from the employee payload explicitly; `vendorPayload` is a whitelist and cannot leak. ⚠ **Neither form seeds the box from the stored address, and a test pins it** — doing so looks helpful and is the one thing that must not happen: the component searches from `onChange`, so a form that wrote a saved address into that box on open would put every existing customer's premises one keystroke from a third party under a perpetual sub-licensable licence, *and it would look like the feature working*. 🔴 **IT DOES NOT ANSWER YET — and the diagnosis was corrected TWICE, so read the final one.** ⚠ **FIRST I RECORDED THIS AS AN OWNER-BLOCKED ENTITLEMENT. THAT WAS WRONG: the bug was OURS.** `atlas.mappls.com` follows OAuth 2.0 and takes a **bearer token in the Authorization header**; this file was sending the **Static Key** as an `?access_token=` query parameter, on the reasoning that the Web Map SDK takes the console key in a parameter of that name. It does not transfer — the two credentials are for different products (**SDK/browser → `MAPPLS_STATIC_KEY` as a query param; REST/server → the OAuth pair as a header**). Fixed in `3914b68c`. ⚠ **This is the SECOND time this codebase has been right that a Mappls credential was missing and wrong about which one** — §7.5 lost months to the mirror image, a dead SDK URL read as a missing key. **PHASE-7 §7.6 specified the OAuth pair from the start and was right; the deviation was mine.** `services/mappls.py` carried a note calling the OAuth token *"not accepted by ANYTHING"* — an over-generalisation from one true measurement (the post-2025 SDK host refuses it) into a claim about every product; corrected there by name. **What is actually left, probed straight from the Railway environment 28 Aug**: the **MINT succeeds — HTTP 200, `bearer`, `scope READ`, `expires_in 67178`** — and the SEARCH answers **401 `"Api Access Denied" / "Domain validation failed"`**. So the credential is fine and the refusal is the **WHITELIST**, the same words the SDK gave during 7.5. ⚠ **And it cannot be satisfied from our side**: a server-side call sends no `Origin`/`Referer`, and sending each explicitly from our own already-whitelisted domain was refused identically (`Referer: https://staging.kartavaya.com/` → 401; `Origin:` → 401). The credential must be permitted for **server-side / no-referer** REST use on the console, or by Mappls support — whose address their own error names. ⚠ **SIX routes tried and all refused, each written down so nobody spends another call re-trying**: the Static Key answers `invalid_token` on `atlas` with or without a Referer (it is not a credential for that host at all), the OAuth token is stopped one stage LATER at the domain check with or without `Referer`/`Origin`, and **moving the call into the browser — which would have needed no server whitelist entry AND mooted the Geospatial Guidelines question, since the data would never pass through our servers — is blocked by CORS**: `atlas` sends no `Access-Control-Allow-Origin`, verified from a real page on `staging.kartavaya.com`. `docs/OWNER-ACTIONS.md` item 14. Six live calls spent in total, all on the same generic public place and never a customer record. ⚠ **And item 2 may make it moot**: if Aekam Inc is a *foreign* entity the Geospatial Data Guidelines 2021 forbid this shape outright, and the fix is a different feature rather than a console toggle. — *(prior state below)* **7.6 BUILT 28 Aug — 7.0–7.5 ✅, 7.6 🟡 (code, no row).** `GET /api/v1/maps/address/suggest` + `AddressSuggest.jsx`: one typed fragment, at most six suggestions, **no page wires it up yet** so it stays 🟡 — no customer has completed the flow. Three deliberate deviations from §7.6, each with a reason that would otherwise be re-litigated: a **new service module** rather than `services/mappls.py`, because `test_mappls_token.py` asserts `"import httpx" not in inspect.getsource(mappls)` and that emptiness is guarded on purpose; the **Static Key**, not the OAuth pair the plan names, since the plan predates 27 Aug and building on the pair would have produced a feature that mints successfully and returns nothing; and `/api/v1/maps/…` not `/v1/graha/…`, because Manav employees, Kray vendors, Vikray shipping and Pahchan sites all take an address. ⚠ **Content submitted to Mappls carries a perpetual, worldwide, sub-licensable licence back to them**, so two constraints are enforced STRUCTURALLY rather than by intent: `suggest(q: str)` has exactly one parameter and a test asserts the signature, so widening it fails as it is written; and the outgoing params are asserted **positively AND negatively** (`== {"query","access_token"}`), because the realistic breakage is not sending the record instead of the fragment but sending it **as well**, in a `near=` built from the saved city. The component has **no `useEffect` on `value`**, and that absence IS the design — the obvious debounced-effect implementation fires on mount, so every form opening a saved client would submit that client's stored premises to a third party for being looked at. **No cache**, asserted by counting calls on the wire rather than by grepping for one, so a memo anywhere in the path fails however it is spelled. The query is **never logged**: the transport failure logs `type(exc).__name__`, because httpx puts the full request URL in several of its exception reprs, which would publish the customer's fragment and the non-expiring key together in the one path nobody exercises by hand. 30/min (the console allocation is **200 hits**), 350 ms debounce, 3-char minimum on both sides. `eLoc` deliberately not stored — a third party's primary key inside our customers' rows becomes a hard dependency the first time something joins on it. ⚠ **The key is NOT proved live against Autosuggest**: every test uses `httpx.MockTransport`, because each of the 200 hits is billable AND a submission under the licence. A 401/403 logs at ERROR naming where to look; the first live keystroke on staging is the real proof. ⚠ **TWO OWNER ITEMS**: the privacy notice must name Mappls as a processor, and **the Geospatial Data Guidelines 2021 question is still unanswered** — a *foreign* entity may license finer-than-threshold Indian map data only through APIs that do not let the data pass through its own servers, and this is a server-side proxy. If Aekam Inc is Indian it is moot; the reason that is not simply asserted is that this repo carries an org named `UK AekamINC`. If the answer is "foreign", this is not a tweak — it is a different feature with a published browser key. 57 backend + 18 frontend tests, proved to bite (a results cache fails on `assert 1 == 2`; a `near=` fails on the params set; logging the exception repr fails with the fragment and the key visible in the assertion). — *(prior state below)* **7.0 ✅ · 7.1 ✅ · 7.1a ✅ · 7.2 ✅ · 7.3 ✅ · 7.4 ✅ · **7.5 ✅** · 7.6 🟡 — 27 Aug.** **7.5 CLOSED — the owner confirmed the outline draws on the deployed site.** The chain that had to be true: Static Key → four whitelisted origins → `mappls.Map` called with an **id string** and a `{lat, lng}` centre → `tile.mappls.com` admitted by the CSP → `fitBounds` in **`[lng, lat]`**. Five links, four broken at some point today, each fixed with a test that fails on the old code. ⚠ **`'unsafe-eval'` was NOT added and must not be** — the SDK evaluates a string and the console says so, but the map draws without it, so the block costs nothing we use; `'unsafe-eval'` is the one directive that materially weakens the policy, on production as well as staging. ⚠ **CORRECTION, and it reverses this morning's note: A KEY IS OWED AFTER ALL — the console's STATIC KEY.** **Mappls replaced its auth mechanism in August 2025.** Their `mappls-web-maps-js` README says the `main` branch documents "the updated Authorization & Authentication mechanism introduced in August 2025" and pushes the OAuth 2.0 flow to an `auth-legacy` branch; the SDK now takes `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=<Static Key>`, a **query** parameter carrying a credential that is NOT the Client ID / Secret pair. So the component that spent eighteen days saying it needed a key was **right that one was missing and wrong about which one**, and "the key was never owed" was right only about `VITE_MAPPLS_KEY` — the key goes on **Railway as `MAPPLS_STATIC_KEY`** and is served by `GET /api/v1/maps/token`, so it stays rotatable without a frontend deploy. **The decisive evidence** (probed live, not inferred): the post-2025 SDK host answers our real minted token and a **randomly generated fake string byte-identically** (`Token was not recognised`), while the legacy host distinguishes them — it knows our token is a real client and denies it one stage later. A credential the new host cannot tell from garbage is not a credential for that host. **Everything else is now RESOLVED and must not be re-raised**: allocations are fine (read off the console 27 Aug — *Vector Map JS SDK Initialization* 10,000, *Vector Tiles SDK* 100,000, *Raster Tiles* 100,000, *Geocode* 250, *Autosuggest* 200, *Vector KeyGen* 2,073,600,000, every one `< 1%` used), the four `kartavaya.com` domains ARE whitelisted, and CORS was enabled on the credential at my request. **ONE value is owed** — see `docs/OWNER-ACTIONS.md`. ⚠ **A security consequence that outlives the fix**: a Static Key **does not expire** and is served to the browser, so the console's domain whitelist stops being a formality and becomes the only control preventing the key being lifted and spent against the allocation. Several whitelist entries carry a **trailing slash** while a browser sends the origin without one — worth tidying before it bites. 7.6 moves 🔴→🟡: it is the same one-value block, not a separate wall. — *(the 7.5 build, unchanged below)* **7.5: the shapes are drawn, the basemap is refused, and the refusal is not ours.** `TerritoryMap.jsx` is rewritten on 7.3's endpoint and 7.3 goes ✅ because a screen now draws its Features. The old component built a map centred on the middle of India and **stopped** — `pincodes` chose zoom 6 or zoom 4 and no polygon was ever added — while rendering *"the territory map needs a MapMyIndia key"*, a sentence that was **false for all eighteen days of its life**: the SDK URL under it had been dead since Aug 2025, and a component claiming to need a credential is believed. New: `services/mappls.py` (token minted from the OAuth pair, cached to expiry less a 5-min skew, **a failure never cached**, `NOT_CONFIGURED` kept distinct from `UNAVAILABLE`), `GET /api/v1/maps/token` (**always 200** — a 4xx collapses "no map here" into "the provider is down", which need opposite responses; and it is NOT under `/v1/graha`, because 8.1–8.3 draw maps in attendance and billing), `lib/mapplsSdk.js`, and `check-mappls-attribution.mjs` wired into `npm run check` **and CI**. The four buckets render as words and `matched + unmatched + unavailable === claimed` is asserted **on screen**; 12 tests, **proven to bite** — merging `unavailable` into `unmatched` fails 3 of them. The map is now reachable from the LIST (it only ever rendered inside `{showForm && …}`, so a saved shape was visible while creating it and never again) and looking is not gated on write permission. 🔴 **THE BASEMAP DOES NOT LOAD AND IT IS AN ACCOUNT MATTER — OWNER ACTION.** Probed live from the staging container: the token mints perfectly (36 chars, 24h, cache confirmed) and then **every Mappls product refuses it**. SDK with no referer, with `staging.kartavaya.com`, with `kartavaya.com`, with `localhost:5173` and with **an unrelated domain** all return the *identical* `401 Domain validation failed` — so this is not a referrer awaiting whitelisting — and the REST geocode answers `401 Token was not recognised` under `bearer`, `Bearer` and a raw token alike. **This contradicts the inference recorded earlier the same day** that "the backend can mint a token and hand it over": the mint half is true and was tested; the SPEND half was never tested until now. Someone must open the Mappls console and confirm the project has an active plan/API entitlements and registered domains. **7.6 is blocked by the same wall**, since autosuggest needs the same token accepted. **7.5 stays deliberately useful meanwhile**: the shapes and the basemap are fetched independently, so the coverage counts, the unmatched list, the invalid list, the outage state and the GODL credit all render with no basemap, and the screen says *"No map is configured in this environment"* rather than inventing a fault. Hardened on the way: `_mint` redacts the credential out of a non-200 body before logging it — `sentry_scrub.py` redacts by variable NAME and cannot see a secret echoed inside a third party's error string. `npm run check` 14/14 · build ✅ · vitest 2,964 pass (2 baselined) · `test_mappls_token.py` **61 passed**. — *(prior state below)* **7.0 ✅ · 7.1 ✅ · 7.1a ✅ · 7.2 ✅ · 7.3 🟡 · 7.4 ✅ — 27 Aug. Only 7.5 and 7.6 remain.** **7.2 ✅ LOADED** on the owner's approval ("go ahead with your recommendation"): migration **233** creates `staging.pin_directory` and **20,144 rows are live**, verified twice — once through the loader and once through independent SQL. `count(*)` **20144**, `count(DISTINCT pincode)` **18839**, `110003` present **3 times**, `110025` spanning **2 states**, `state_lgd` reading **`'07'` as TEXT** not `7`, and `395002` → **GUJARAT / SURAT** — the one PIN any live territory claims. **0 foreign keys** touch it and `public.pin_directory` does not exist, so there is no shadow twin. ⚠ **`pincode` is NOT the primary key** and could not be: 1,229 of 18,839 PINs span more than one district and **51 span more than one STATE**. Both `(pincode, district_lgd)` and `(pincode, state, district)` are enforced as unique — the first is the upsert target because LGD codes survive a district rename, the second because it is what a human-written join will use. **The loader is a SCRIPT, not a route, and deliberately**: 7.1's `route-all` rewrites the calling org's OWN rows so `is_org_admin` fits it, but `pin_directory` has no `org_id` — an org-admin route would let one customer's admin reload platform-wide reference data underneath every other tenant. Same words, inverted tenancy. **Idempotent and observably so**: a second run reported `inserted 0 | updated 0 | unchanged 20,144` with `updated_at` still NULL on every row, so the re-run is a no-op you can use to CHECK the table. All 20,144 rows go in ONE transaction, and the file is refused whole on any parse problem or key collision, so there is no halfway. The CSV's sha256 is checked against a known digest before the write, so "the file at that key" and "the file whose rows were audited" are the same sentence. ⚠ **Two facts §7.2 does not state**: `blocks` is NOT clean — **2,435 rows carry the literal `'NA'`** as a block name and 402 are exactly `["NA"]`, stored as published and never to be presented as authoritative; and the multi-PIN spread is worse than "two or three" — **`192124` resolves to FOUR districts** in J&K, and only **17,610 of 18,839 (93.5%)** resolve to exactly one `(state, district)`. That sharpens 7.6: "a PIN fills district and state" is false for **1,229** PINs, not just the 51 that cross a state line. Reversal is `DROP TABLE IF EXISTS staging.pin_directory;`, exact today and flagged as stopping being exact the moment a customer can add a row. 29 tests. — **7.0 ✅ **7.3** is `services/pin_boundaries.py` (a shard reader with a cached index, deliberately not in the router) + `GET /territories/{id}/geometry`. It is 🟡 and not ✅ for one reason: the endpoint returns a real Feature for a real territory on live rows, and **no customer can see a shape until 7.5 draws it**. Live end-to-end, read-only: E2E's *Gujarat* → **1 Feature, pincode 395002, Polygon, 47 positions, `claimed:1 matched:1`**, all three failure lists empty; the same territory id asked for by **Unicode Group → 404**; `["110001","110009"]` through the real bucket → 1 Feature + `unmatched:["110009"]`, which is the plan's acceptance pair exactly. R2 index measured: **69 objects, 19,406,922 bytes, 19,312 PINs, no duplicate across shards** — shard names 11–85 with **six absent** (29 35 54 55 65 66), which is what makes "prefix not in the index → unmatched with no GET" a real path rather than a theoretical one. ⚠ **THE THREE BUCKETS ARE SEPARATE AND EACH WAS PROVED ON ITS OWN** — `unmatched` (two paths: a prefix the dataset never published, asserted with `client.gets == []` so no GET is even issued, and a PIN absent from a shard that loaded perfectly), `invalid` (`'NW1 245'`, `'ahmedabad'`, a leading-zero `'012345'`, blank, **and a `pincodes` value that is not a list at all** — the shape the product genuinely stores, which used to vanish silently), and `unavailable` (five offline cases plus **two against the real bucket**: a missing vintage listing empty, and a real GET answering `NoSuchKey`/404 after the index had listed the shard). Collapsing `unavailable` into `unmatched` would tell a customer "there is no shape for 110001" when R2 is merely down. `storage.download_file` is never called, and a route test greps for it, because it collapses missing-key and outage into one `None`. **The plan's acceptance arithmetic is corrected**: `features + unmatched === rules.pincodes.length` only holds when nothing is invalid, nothing is duplicated and R2 is up, so the response carries `claimed` and the invariant is `matched + unmatched + unavailable === claimed`. 39 + 6 tests, green offline AND under `railway run` against live R2 and the live schema. ⚠ **An untested snapshot of this went to `staging` early**: `cd0d3608` (a Phase 8.0 commit) swept the in-flight `pin_boundaries.py` and the router change in via `git add -A`, without the test file, which was untracked at that moment. No false status was published — STATUS did not claim 7.3 — and the working tree supersedes it. — **7.0 ✅ ⚠ **THE MAPPLS KEY WAS NEVER OWED, and 7.4/7.5/7.6/8.1/8.2/8.3 were all reported blocked behind it.** Live on Railway staging: `MAPPLS_CLIENT_ID` (88 chars) and `MAPPLS_CLIENT_SECRET` (96 chars) are set and they WORK — `outpost.mappls.com` returns **HTTP 200**, a bearer token, `expires_in 86399`, `scope READ`, project `prj1787726591i922664629` (the token was never printed). What is missing is a DIFFERENT variable: `TerritoryMap.jsx:21` reads the FRONTEND `VITE_MAPPLS_KEY`. The backend holds an OAuth pair, the map component wants a browser key, and nobody noticed the pair because no backend code reads it — `sentry_scrub.py` mentions `MAPPLS_KEY` only to redact it. The backend can mint a token from the pair it already holds; **no new credential is needed from the owner**. **7.4 ✅ VERIFIED ON THE SERVED HEADER**: `sdk.mappls.com` + `apis.mappls.com` on `script-src`, `connect-src` and **both** `style-src` *and* `style-src-elem` (two directives, not one), plus `worker-src 'self' blob:` which was absent entirely — a worker falls back through `child-src` to `script-src`, which does not admit `blob:`. The served header on staging.kartavaya.com is **byte-identical** to `vercel.json`, the site loads with **zero console errors**, and the sha256-allowed pre-paint bootstrap still runs (`data-theme`, `data-conv-pattern`, `data-platform` all set). ⚠ This LOOSENS the production CSP and staging and production serve the same file — narrow, inert until something calls Mappls, and trivially reversible. **7.5 NOT built**: the CSP is inert, a map is a commitment, and Mappls' terms (logo not text credit, no non-Mappls map anywhere in the app, no cost-caching, perpetual sub-licensable licence over every submitted address) are the owner's call. — **ACCEPTED 27 Aug, the whole chain proven on live rows. 7.2–7.6 remain.** The phase is called *PIN → territory → rep* and all three links are now a row: `Phase 7.1 Round-Robin Acceptance` reads **pin=395002 → Gujarat → E2E Test Approver**, created through the form with **neither a territory nor an owner chosen** — both filled by the rule. Five acceptance tests, all passing. Live after: E2E contacts **238**, carrying a pincode **0 → 3**, carrying a `territory_id` **0 → 3**, territories with a PIN **0 → 1** and with a member **0 → 1**. The first two rows read `→ Gujarat → (no rep)` and that is CORRECT, not a gap: they were created before the territory had anybody on it, and routing never retro-assigns. **Unicode Group untouched throughout** — 54 contacts, 38 pincodes, 0 routed, 0 territories. **7.1** is `services/territory_routing.py`, a pure module: `normalise_pin` (`^[1-9][0-9]{5}$` — an Indian PIN never starts with 0), a PIN source ladder (own `billing_address` → own `shipping_address` → its client's `address`), matching, and hand-off to the existing round-robin. Hooked inside `create_contact`'s transaction between the INSERT and `contact_created`, **not `_bg()`**, and behind a **SAVEPOINT** — a plain try/except there is a trap, because a database error aborts the transaction and `contact_created` then dies on `InFailedSQLTransaction`, turning a routing bug into a lost contact AND a lost event. Backfill is `POST /contacts/route-all`, admin-gated, **a route not a migration** (migrations are pre-approved here; rewriting live rows is not) with a confirm and a counts-and-names report on the Territories tab. A PIN no territory claims routes nowhere and **refuses nothing** — same rule as GSTIN/PAN/TAN. Routing never overwrites a territory a person chose, and never reassigns a contact that has an owner. ⚠ **Matching is done in Python and that is load-bearing**: the obvious `jsonb_array_elements_text(rules->'pincodes')` raises *cannot extract elements from a scalar* (verified live) — `TerritoryCreate.rules` is a bare `dict`, so ONE territory saved with a string instead of a list would have 500'd routing for every contact in that org. **7.1a: all three leaks closed** — `list_deals`, `deals_kanban` and `crm_report.py` all joined `graha_territories` on `tr.id` alone and now carry `AND tr.org_id = d.org_id`, held by a scanner that fails on any future unscoped join; `create_deal` wrote `body.territory_id` with no org check and now goes through `resolve_contact_territory`; and `_DEAL_COLS`'s dead `territory_id` entry **got a field rather than a deletion** — deleting it would make a deal's territory settable once at create and unchangeable for ever, the same writable-and-unreachable shape this model already grew a field to fix. Live control: cross-org (contact, territory) and (deal, territory) pairs are **0 and 0** — the leaks were latent. ⚠ **Two plan figures corrected**: the ladder takes Unicode to **41**, not 42, and the split is 38 own + **3** inherited, not 4. 33 + 10 tests. Two adjacent findings NOT fixed (out of brief, flagged): `create_deal` binds `client_id`/`contact_id`/`pipeline_id` with no org check at all, and `DealUpdate` vs `_DEAL_COLS` disagree in both directions — **`lost_reason` is in the model but filtered out, so the reason a deal was lost can never be saved through the PATCH**. — **7.0 ACCEPTED 27 Aug — a pincode reaches the database through the screens. 7.1 next.** Driven as a real user against the deploy, `phase7-address-capture.spec.ts`, 3/3, then read back live: E2E contacts **235 → 236**, contacts carrying `billing_address.pincode` **0 → 1**, contacts carrying `territory_id` **0 → 1**, territories carrying a PIN **0 → 1**. The row is *Phase 7.0 Pincode Acceptance* — `{city: Surat, line1: Plot 44 Pandesara GIDC, state: Gujarat, pincode: 395002}`, routed to the **Gujarat** territory, which now holds `{"pincodes": ["395002"]}`. **Unicode Group untouched** and re-verified: 54 contacts, 38 pincodes, 0 territory_id, 0 territories. 395002 and Gujarat were chosen so they AGREE — 7.1 matches a contact's PIN against a territory's list, and seeding a PIN into a patch nobody would put it in would make 7.1's acceptance a tautology. The spec is idempotent and asserts it (exactly one contact by that name), because a seed that writes a fresh copy per run inflates the very count it exists to prove. **The capture half:** All three of 7.0's faults were real and all three are closed in code: (a) the contact create form had NO address fields at all, and now carries line1/line2/city/state/pincode writing into `billing_address` under the seven-key vocabulary `invoice_pdf.py:123` reads; (b) `graha_contacts.territory_id` (migration 023) was unreachable from EVERY API path — absent from `ContactCreate`, from `ContactUpdate`, and from both the INSERT and the PATCH SET-build, while `graha_deals.territory_id` from the SAME migration was always writable — and is now on both models, both write paths, and a picker that renders territory NAMES; (c) `PATCH /territories/{id}` had ZERO CALLERS, so a pincode list could be created and deleted but never corrected, and the tab now has an Edit control. **7.1a was welded on as the plan demands**: migration 023 wrote a bare `REFERENCES staging.graha_territories(id)` with no `org_id`, so the moment the column became writable one org could file its contact under another's territory — and `assign-next` reads that territory's `assigned_users` to hand out a lead, so the leak would have handed one firm's customer to another firm's salesperson. `resolve_contact_territory` closes it (org + `is_active`, because DELETE is a soft delete), mirroring `resolve_contact_company`. **Two findings on the way through.** First: the contact edit panel rendered **Mobile** and **Website** boxes for columns that have never existed — `graha_contacts` has 31 columns, checked live in both schemas, and neither is one; `ContactUpdate` never listed them either, so pydantic dropped the values before the SQL was built. A person typed, the toast said "Contact updated", the value went nowhere. Both removed. Second: **`staging.sales_territories` is a SECOND territory model** — `state_codes varchar[]`, `city_names text[]`, `pincode_ranges jsonb`, `assigned_to uuid[]`, `manager_id`, `parent_id` — **0 rows table-wide, every org**. It is a richer PIN schema than the one in use and it is not on Phase 6's DROP list; it needs naming to the owner as a 24th table. **Still ⬜: nothing is routed.** Live denominators re-measured 27 Aug and the plan was right on every one — 17 territories (E2E 17, Unicode 0), 3 carrying an EMPTY `pincodes` key, **0 with a PIN, 0 with a member**, 0 of 289 contacts and **0 of 162 deals** routed, E2E **0 pincodes across 235 contacts and 61 clients**, Unicode 42 of 54. ⚠ **`billing_address IS NOT NULL` is TRUE for all 235 E2E rows — every one is `{}`**, so a null-check acceptance passes on day zero and measures nothing; 7.0 accepts on a KEY carrying a value. — **plan rewritten from a live audit 26 Aug** — every claim re-measured. `rules.pincodes` still has ZERO backend consumers, and `assign-next` has zero callers anywhere. **But nothing can route even with a perfect resolver: no contact form captures a PIN, `territory_id` is unreachable from every API path, and no territory edit form exists.** Live: 17 territories, **0 with a PIN, 0 with a member**, 0 of 289 contacts routed. New 7.0 (capture) precedes 7.1; 7.1a closes three cross-tenant territory joins that 7.1 would otherwise activate **Researched 26 Aug (`9c211b28`, proposal 92, ~40 sources) — plan amended, still nothing built.** Three of the amendments are Mappls licence text, not opinion: attribution must be the **“Powered by Mappls” LOGO**, not the `© Mappls` string 7.5 specified; their terms forbid a Mappls map “with or near a non-Mappls Map”, which closes off any MapLibre/OSM/Google fallback anywhere in the app; and content submitted to Mappls carries a **perpetual sub-licensable licence back to them** — an autosuggest call on a client's premises is a submission, so 7.6 now sends the query fragment only and never runs on the public form. Fourth: Google was rejected on “USD billing, card required”, but India bills in **INR** with **70,000 free events per Essentials SKU/month** — the standing no-Google-spend rule still decides it, the stale reasons are gone. Market finding: the most-requested map feature is **not a map** — it is plot-the-list plus postcode routing, and routing is the half vendors charge for (Badger sells it as four add-ons; Salesforce Maps $75–150/user/mo). **The three open questions still need the owner** — recommendations in proposal 92 §8: priority-int for overlapping PINs, territory-always/rep-only-when-unassigned, and yes to an optional six-digit PIN on the public form after 7.0. Migration number is **not** 222 any more — a peer session took 222 and 223 mid-session; the plan now teaches `ls backend/migrations/` instead of naming a number |
| 8 | Maps across the other six modules | 🟢 **8.4 ✅ — 28 Aug. THE PHASE IS CLOSED: 8.0 ✅ · 8.1 ✅ · 8.2 ✅ · 8.3 ✅ · 8.4 ✅.** §8.4's acceptance is met on a live row, driven over HTTP against the deploy: contact *Phase 7.1 Round-Robin Acceptance* carries **21.1702, 72.8311**, `geo_source` **`user_pin`**, `geo_fetched_at` **stamped by the database**, and **DIGIPIN `3LKPCM5PPT`** derived locally with no vendor call. E2E Test & Associates only; Unicode Group untouched. **Migration 237 applied and verified FROM THE CATALOGUE** — 8 columns `numeric(10,7)` matching `pahchan_punches`, 6 constraints all `convalidated=true`, and `count(*) WHERE lat IS NOT NULL` = **0 and 0** immediately after, because there is no INSERT, UPDATE or DELETE anywhere in the file. ⚠ **NEVER A BARE COORDINATE PAIR, and that is the migration's point rather than a nicety**: the two vendors this product can touch have incompatible, time-bound terms — Google permits a cached coordinate for **30 days**, Mappls forbids caching **outright** — so a coordinate with no provenance cannot comply with EITHER, because nobody can say which rule it falls under. `*_geo_complete_ck` makes the bare pair **unrepresentable** (all four NULL or all four NOT NULL), so clearing must null all four in one statement or take a 23514. ⚠ **The allowlist has NO MAPPLS VALUE and none may be added** — a Mappls-derived coordinate has no lawful home in this database, and a CHECK that makes the write fail is the cheapest place to enforce it. 7.6's autosuggest may store the address TEXT the user accepted; it may not store a coordinate. **DIGIPIN — India Post's ~4 m grid code, pure arithmetic, no vendor and no API call — VERIFIED TWO WAYS**: symbol-for-symbol against India Post's own reference implementation (`github.com/INDIAPOST-gov/digipin`) over **20,000 random coordinates, 0 mismatches**, and against the one worked example the Department publishes (Dak Bhawan, 28.622788 / 77.213033). ⚠ **AND THE FORMAT WAS WRONG**: Annexure 1 groups the symbols `XXX-XXX-XXXX` and most third-party write-ups still print that, but India Post's implementation was updated **2026-05-04** and the grouping line is now a no-op — *"Output is a single, uninterrupted string (no spaces or separators)"*. `encode` returns ten characters; `decode` still ACCEPTS the grouped spelling, because that is what a person pastes from an older document; `format_grouped` is for a screen and never for a column, since a stored code carrying punctuation the standard does not have fails equality against every other system holding the same DIGIPIN — **silently, because both strings look right**. It is **derived, never stored** (a stored copy can fall out of step with its own coordinate) and **served, never computed in the browser** (two ten-level traversals drift at the last symbol while agreeing at level 6, so the divergence looks like two systems naming neighbouring 4 m cells rather than like a bug) — a backend test fails if a `digipin` module appears under `frontend/src`. `CoordinateCapture` captures **nothing as a side effect**: no view-time geocode, no effect on mount, and two tests assert no request on mount with and without a saved coordinate, because that failure is silent — every record anybody opened would start writing. The request body is asserted to be **exactly `{lat, lng, geo_source}`**: a caller-supplied `geo_fetched_at` would let a 30-day retention rule be reset by the thing it constrains. ⚠ **`check-write-gates` caught the first version and was right** — `canWrite` was threaded down as a prop, and a control gated on a `canWrite` its own scope does not declare is a **ReferenceError at RENDER**; the hook is now called inside the component. ⚠ **Both agents that built 8.4 died at a spend limit MID-MUTATION**, while running their own bite-proofs; one left `geo_source=NULL` removed from the clear statement, and its own test caught it on the first run here. ⚠ **One defect the live run found and no test did**: the contact detail route served the pair **without** the code — the expression had been written at one call site and not the other, so both now go through one `_with_digipin` helper. Backend 130 + 78 green, 133 under `railway run`; frontend 14 new tests, `check` 14/14, `build` ✓, vitest **3,078 pass** (2 held at baseline). — *(prior state below)* **8.2 ✅ · 8.3 ✅ — 28 Aug. 8.1 ✅ · 8.0 ✅. Only 8.4 remains.** ⚠ **THE FINDING THAT SHAPED BOTH**: two agents building 8.2 and 8.3 independently hit the same wall — the only boundary route is per-**TERRITORY**, and the live orgs are arranged so walking territories finds nothing. Measured live 27 Aug: **E2E Test & Associates 17 territories / 0 client pincodes; Unicode Group 0 territories / 21 client pincodes.** Every client pincode in the product belongs to the org with NO territory, so the popover drew nothing for all 21 of Unicode's addresses — and the failure would have read as *"this pincode has no area"* rather than as an architecture that could not reach the answer. **So `GET /v1/pincodes/{pin}` was built** (`backend/routers/pincodes.py`, registered — written-and-not-registered is exactly how `/api/v1/support-sessions` 404'd). **Its own router, and both halves are deliberate**: not `graha.py`, because Manav employees, Kray vendors, Vikray shipping and Pahchan sites all carry a PIN and none should ask the CRM for permission to name a district; and not `maps.py` either, though the prefix fits, because **nothing here touches Mappls** — no key, no allocation, no quota, no licence over anything submitted, since nothing is submitted. Both datasets are government releases we already hold. ⚠ **THE TWO DATASETS DISAGREE IN BOTH DIRECTIONS and the response shape exists to carry that**: 58 PINs in the 7.2 directory have no published boundary, and **531 PINs WITH a boundary are absent from the directory**. `directory` and `boundary_status` are independent and neither is derived from the other. ⚠ **A PIN IS NOT ONE DISTRICT** — 1,229 span two or more districts and **51 span two or more STATES**; `110020` is genuinely both SOUTH DELHI and SOUTH EAST DELHI. `LOOKUP_SQL` carries **no `LIMIT 1`** and never will: it would answer a two-answer question with one, correctly, for ever, with no way for a reader to know the other existed. **21 tests, all passing under `railway run` against the live schema**, including the statement PREPAREd against the real catalogue (Parse + Describe, nothing written) and `110020` read back as two districts out of the live table. Proved to bite LIVE: a `LIMIT 1` fails on `assert 1 >= 2`; folding `unavailable` into `unmatched` fails on `assert 'unmatched' == 'unavailable'`. ⚠ The registration test first failed for the WRONG reason — `app.routes` is **vacuously false for every router in this FastAPI** (included routers are wrappers with no `.path`), so it reads the OpenAPI schema, as `test_billing_lines_wiring.py` already documents. **8.2 ✅**: `PinAreaPopover.jsx` — a pincode opens its postal area, names the district from 7.2 (`SURAT, GUJARAT`), lists **every** district for a PIN that spans two and says *"spans 2 districts"* out loud, and computes the area in km² **locally from the same coordinates it would draw**, which turns the mandatory caption (*"an Indian PIN averages ~82 km². This shows the postal area, not the building."*) from a slogan into a number the reader can check. 7.3's buckets stay apart; a fourth state reports a PIN that falls out of every bucket rather than guessing. **ONE request, ours** — §8.2's "zero calls to any vendor endpoint" is asserted as an exact URL list. The pincode in `<AddressBlock>` is now clickable on client detail via a **RENDER PROP, not an import**: `AddressBlock` is a `ui/` component on six pages that fetches nothing, and importing the popover would put a component that makes a network call into all six, so a screen could acquire a request it never asked for by rendering an address. Block layout only — an inline table cell grows no trigger. `addressLines` now derives from a new `addressParts`, and the parts are rendered rather than the joined string, because splitting it back on `', '` is wrong for a city called "Navi Mumbai, Thane" — and wrong **invisibly**. **8.3 ✅ but NOT as a drawn map, and the measurement is why.** Two blockers, either fatal alone: no client carries a coordinate (that is 8.4), and every client pincode belongs to the org with no territory. Honest coverage of a PIN-area map today: **21 of 89 companies across both orgs, 0 of 61 in one of them** — it would have been an empty rectangle for the larger org. So `ClientLocations` leads with the **denominator** ("3 of 7 companies listed here carry a pincode… 3 are not placed at all"; "None of the 61 companies listed here carries a pincode" for E2E), groups by PIN, and names **four distinct gaps** rather than one number: a non-Indian pincode (`INC UK` holds `NW1 245`, shown as stored and never corrected), street-line-only, `{}`, and town-only. Live, read-only: **E2E 61 active clients — line1 48, city 43, pincode 0**; **Unicode 28 — 5 with `address == {}`**, pincode 22 of which 21 are six-digit, 19 distinct, **all 19 present in `staging.pin_directory`**. ⚠ The `{}` case is why emptiness is tested by `addressLines(...).length` and never by a null check — the column is `jsonb NOT NULL`, so `!= null` counts all five of Unicode's empty addresses as populated. Per-group *Open in Maps* carries the PIN and the state only, **never a company name or a street line**, so no join key reaches Google. No basemap and therefore **no `.terr__mapbrand`** — correct, not an omission: the file does not import `mapplsSdk` and no credit is owed; both headers say a basemap and its credit arrive in the same commit or not at all. Eight bite-proof mutations, incl. a naive key-joining address reader failing 6 (Navrang Polymers has 43 keys spelling a JSON string one character each) and putting the company name in the Maps query failing 1. `npm run check` 14/14 · `npm run build` ✅ · vitest **3,064 pass, 2 held at baseline** (`labelShape`, `sanvaadLegacyVocabulary` — both in files untouched today). — *(prior state below)* **8.0 ✅ ACCEPTED 27 Aug — read-only, against the deploy, both branches on live records.** `phase8-address-block.spec.ts`, 3/3: a CLIENT with a stored address offers *Open in Maps* and every value stored on that record is in the query; a CONTACT whose `billing_address` is `{}` offers **no link at all**; and the contact 7.0 gave an address to DOES offer one, `query=395002`. The third is what makes the second mean anything — without it, "no link on an empty contact" passes when the page never mounted the component, which is exactly what had happened. Nothing is written: a display-only phase has no business creating rows in a database production shares. ⚠ **Three test faults on the way, each of which accused the product of its own bug** — `GET /contacts` does not return `billing_address` (it is a table shape), so a filter on it called every contact empty and picked one that carries 395002; the contact search is SERVER-side and does not fire on typing, so an unfiltered table was clicked and a different record opened; and nothing asserted WHICH record was on screen, which is why the first two survived three runs. The helper now applies the filter and checks `.gr__dname`. **8.0 BUILT 27 Aug — one component, five surfaces, no vendor and no CSP change.** `<AddressBlock>` renders a stored address and offers *Open in Maps* as an ANCHOR to the Google Maps URLs scheme — no API key, no quota, no billing account, and an anchor is not a fetch, so `vercel.json` is untouched. The URL is built in exactly one place (`mapsHref`), which is what makes the Mappls licence fallback a one-function change if the "link out is navigation, not a map" reading is ever contested. Wired: Graha client detail, **Graha contact detail** (⚠ this row claimed the contact detail was wired for several hours while it was NOT — the component went onto five surfaces and that one was missed, which is the exact fault 8.0 exists to fix, published as done. It is wired now and an acceptance opens the page and reads the anchor), Kray vendor list, Manav employee detail, Vikray order *Ship to*, and a Pahchan punch (coordinate, so `query=lat,lng` — 699 of 700 punches carry lat/lng). A coordinate always beats address text: an Indian PIN averages ~82 km². **29 tests**, written against what is STORED rather than the DDL. ⚠ **The empty branch tests EMPTINESS, never null** — all 235 E2E contacts, all 83 `manav_employees.address` and all 322 `vikray_orders.shipping_address` are `IS NOT NULL` and every one is `{}`, so `if (!address) return null` would be wrong on the majority of live rows. A record with nothing usable renders NOTHING — a link to `?query=` opens Google Maps on the user's own location, which looks exactly like the product having found the client's premises. Both malformed rows are covered: Unicode's `Navrang Polymers` stores its address as a JSON string exploded into 43 single-character keys **plus a genuine 43rd `city` key reading "Navi Mumbai" that contradicts the exploded copy's "Mumbai"** — the component reads the seven known keys by name and renders "Navi Mumbai", ignoring the noise — and `INC UK` (`pincode = 'NW1 245'`, city Uganda, line1 London, state New York) renders without throwing. **Three findings.** (a) **There is no vendor DETAIL surface** — Kray is a list plus the shared `VendorForm`, and that form captures **no address field at all** (`BLANK_VENDOR` has no `address` key) while `POST /v1/ganit/vendors` has always written `body.address` and 6 of 9 Unicode vendors carry one: API-writable, populated, unenterable. (b) The plan's Ganit invoice consumer is a **backend PDF** surface — `invoice_pdf.py` renders it server-side and `InvoiceDetail.jsx` renders no address at all, so that row needs a new screen, not a swap. (c) The two backend renderers **disagree on field order**: `invoice_pdf.py:_fmt_addr` is `city, state, pincode, country` and `doc_render.py:fmt_addr` is `city, pincode, state, country`; the component follows `invoice_pdf.py` and the two need reconciling. **Mobile deferred with a reason**: `shipping_address` already reaches the phone (`SELECT o.*`), but no module is shared between `frontend/` and `mobile/`, so wiring it means forking the reader AND the 40-row statutory `GST_STATES` table into TypeScript — which destroys the single-place property the licence fallback rests on. 8.1 (the Pahchan geofence map) stays blocked on 7.4 (CSP) and 7.5 (SDK loader). — **planned 26 Aug (`9c211b28`).** Phase 7 is **100% Graha**; this is every module it does not touch. Front-loads the parts needing **no vendor, no API key and no CSP change**: `<AddressBlock>` across Graha / Ganit / Kray / Manav / Vikray / Pahchan using Google **Maps URLs** (no key, no quota, an anchor not a fetch). Then the **Pahchan geofence map** — a real defect, not a view: a geofence is configured today by typing two decimals and a radius with no way to see it, and `Sites.jsx:31` names that risk itself. Then the free PIN-area popover (reuses 7.3's geometry, **zero vendor calls**), autosuggest reuse, and last a stored coordinate with `geo_source` + `geo_fetched_at`, which is what unlocks DIGIPIN. **Altitude on attendance is NOT in this phase — it is already built** (migration 193 + `routers/pahchan.py` + the mobile offline queue + three screens + `test_pahchan_altitude.py`); the only open item there is data, not code: **does any live site actually carry an `altitude_m`?** 9 sites / 1,659 punches were all NULL when 193 landed. ⚠ **Re-measured 2026-08-27: the live count is 700 punches, not 1,659** (230 in June, 425 in July, 45 in August). The altitude finding survives — **0 of 700** carry `altitude_m` or `altitude_accuracy_m`, and 0 of 9 sites carry either `altitude_m` or `altitude_tolerance_m` — but an acceptance measured against 1,659 would be measuring against a number that no longer exists. Where the ~959 rows went is NOT established: the obvious candidate, `punch_cleanup_20260823`, has been dropped and cannot be queried. 699 of the 700 carry `lat`/`lng`. |

## Module / proposal state (condensed — full detail in proposal 90)

⚠ **Eight of these rows were reviewed on 2026-08-27 and SEVEN were stale**, most
of them contradicted by the phase table immediately above in this same file —
including one flatly false (`0 of 98 linked`, when it is 14 of 109). This is the
table a reader skims, so a stale row here outranks a correct one further up.

The rows NOT touched were left alone deliberately, because correcting a number
without measuring it is how the stale ones got here: Niyam's 20/35 event types,
Reports' ~23 of 34 missing definitions, R2's 0 objects, the KB index, employee
onboarding and Legal/MFA all carry figures nobody re-counted today. Treat every
figure in this table as "last measured when its row says", not as current.

| Area | Proposals | State |
|---|---|---|
| Core PM (tasks, boards, board-arrange, pulse) | 67, 68 | ✅ |
| Niyam automation | 55–59, 66 | 🟡 armed; 20/35 event types |
| Analytics suite | 60–65 | ✅ through S6 (mobile S7 deferred) |
| Skills / dock / Sahayak | 69–72 | 🟡 **stale — corrected 27 Aug.** The Due tab is NOT dead: Phase 4.5 fixed it (the `income_tax` typo was worth 22 rows; Finance 7 → 13). `skill_finding_ack` is NOT 0 rows: Phase 4.3 took it **0 → 1** through the deployed endpoint and re-running the skill then returned 2 findings instead of 3. Unmeasured today: the 32/78 wiring figure |
| Reports | 70, 73, 75 | 🟡 15 registers; ~23 of 34 defs missing |
| Report delivery passphrase | 93 | ✅ **corrected 30 Aug — a row now exists.** Org settings → **Reports** shipped and is live in the deployed Pages bundle. The write path is PROVEN end to end: the owner set a passphrase through the real screen and `settings->'reports'` went **0 → 1** on **UK AekamINC**, stored **encrypted at rest** (`enc::` + a 100-char Fernet token, 105 chars total; the `reports` object holds only `passphrase`). Backed by `GET`/`PUT /api/v1/org/profile/report-passphrase` (`org_profile.py:1428`) with `tests/test_report_passphrase_sql.py` parsing its SQL against the real schema. ⚠ **Still unproven: DELIVERY.** No scheduled report has yet arrived as an encrypted PDF, and the other 4 orgs have no passphrase, so their reports still leave in the link shape |
| Commission & P&L | 76 | 🟡 **stale — corrected 27 Aug.** `salesperson_id` is NOT NULL: Phase 1 shows **5**/800 invoices carrying one, all created through the UI. And E2E holds **1 scheme / 3 bands** on the owner's own ladder since Phase 6.1. Unmeasured today: whether the rate is still uneditable |
| Procurement / Kray | 77, 85 | 🟡 **"0 rows yet" is stale — corrected 27 Aug.** Phase 0.20 live: E2E **75 vendors, 12 carrying all six** MSME/TDS columns; Unicode 9 and 0. Ganit and Kray now share ONE `VendorForm.jsx`, with a set-equality test so the field set cannot fork. ⚠ **And that shared form captures NO address field at all** (`BLANK_VENDOR` has no `address` key) while `POST /v1/ganit/vendors` has always written `body.address` and 6 of 9 Unicode vendors carry one — found 27 Aug during 8.0. Still true: a PO cannot be sent |
| Compliance settings | 80 | ✅ **corrected 27 Aug** — Phase 4.1 shipped the screen and `module_compliance_settings` went **0 → 1**, written 27 Aug 00:45:52 through the real screen and verified live. "No screen, 0 rows" was true when written and is not now |
| Legal / MFA docs | 81 | 🟡 4 pages, not in prod, 9 owner facts |
| R2 storage | 83 | 🟡 grammar+verifier; no tab, 0 objects |
| Employee onboarding | 84 | ⬜ ~95% unbuilt |
| Platform billing | 86 | 🟢 **corrected 27 Aug** — Phase 3: 3.1 ✅, 3.2 ✅ (a mid-cycle downgrade wrote credit ₹3,200 and charge ₹2,400, net −₹800), 3.3 ✅ (`client_invoice_lines` **0 → 2**, auto-invoices **0 → 2** — INV-2026-0093 ₹88,500 and INV-2026-0094 ₹17,700). ⚠ **`billing` IS in `cron-daily`'s loop** — measured off the Railway start command 2026-08-29; the line that said otherwise was stale. The tick schedule was not read. Both invoices above were born `final` because the sweep omitted `doc_status`, which DEFAULTS to `'final'`; it writes `'draft'` as of 2026-08-29 so the Rule 46 gate is reached by the person who issues it |
| Org-client billing | 87 | 🟡 **no longer 🔴 — corrected 27 Aug.** Both 500s were DEPLOYED-fixed 26 Aug (`gst_rate` dropped, `invoice_number` allocated, `balance_due` bound — a second bug found while fixing the first). It is 🟡 and not ✅ because **no row has been created through the board yet**; recurring-doesn't-recur is unmeasured since |
| Liquid glass | 88, 89 | ✅ record; rescope done; enriched 2026-08-25; Apple-pass (buttons/tiles/modal) 2026-08-25 |
| WhatsApp channel | 38, 39 | ⬜ owner creds (Phase 0.26) |
| RAG / KB index | 08 | 🔴 empty always; answers grounded on nothing |
| Employee↔login join | 05 | 🟡 **"0 of 98" is FALSE — corrected 27 Aug from a live read.** It is **14 of 109**: E2E **12 of 83** (one-to-one, 12 distinct logins, 11 department/designation shapes, all linked through the real screens in Phase 0.23) and Unicode **2 of 26**. It still gates payslips and payroll **for the other 95**, and most of those links are impossible — the largest org has far more employees than logins |

## Structural debt (`PHASE-6`)

- 48 zero-row tables · 16 NULL feature columns with no write path
- ~~4 models built twice (sales_commission* / hr_*+pay_* / 2 doc allocators / 2 report schedulers)~~
  **Corrected 27 Aug and the count moved in both directions.** Two of those four are NOT duplicates: 6.3 decided to KEEP BOTH doc allocators (a PO is numbered at ISSUE, and `next_doc_number`'s `ORDER BY created_at` would restart the series at 0001 on the next draft), and the `pay_*` stack contains **two LIVE tables** — `pay_professional_tax` (23 rows) and `pay_income_tax_slabs` (23 rows) — that every payslip reads. The two report schedulers ARE real and 6.4 is OPEN. **And a fifth turned up**: `staging.sales_territories`, a second territory model with `state_codes`, `city_names`, `pincode_ranges`, `assigned_to`, `manager_id`, `parent_id` — 0 rows table-wide, richer than the model in use, and on nobody's DROP list
- `statute_calendar` read by skills and by payroll's ESI ceiling; PF, PT and both TDS ladders still literal (5.2)
- No router test executes its own SQL ← the rule that would catch every 🔴 above

---

## How to keep this file honest

1. Every landed change: flip the relevant row here, and append a line to
   `docs/plans/PROGRESS.md` with the evidence (file:line, table + row count, or
   commit).
2. Never mark a row ✅ on "the code shipped" alone — this whole document exists
   because "DONE" was claimed on code with no data. ✅ means **a customer can
   complete the flow end to end**, proven by a row appearing where there were
   zero. Otherwise it is 🟡.
3. Verify status claims against the live DB, not the migration folder.
