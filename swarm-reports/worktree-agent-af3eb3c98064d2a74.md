# End-to-end test suite — `worktree-agent-af3eb3c98064d2a74`

Owner of this branch: the browser-level / end-to-end suite. Backend unit and
router tests belong to a different agent and are not touched here.

**160 tests, 8 files, all green.** Full frontend suite **433 passing across 22
files**. Both mechanical gates exit 0. Rebased onto `origin/staging` twice
(199 sibling commits) and re-verified after each.

```
cd frontend && yarn test:e2e          # the e2e suite alone
cd frontend && yarn test              # everything (CI runs this)
cd frontend && yarn check             # the two gates
```

---

## 0 · Isolation strategy — decided before a line was written

> **Nothing in this suite can reach a network, a backend, or a database.**
> Not "should not". Cannot: the escape routes are removed, and their removal is
> itself asserted by a test.

### The decision

**A fully mocked API layer, running in-process under Vitest + jsdom.**

Staging and production share one Supabase project. Any test that authenticates
against a deployed URL is authenticating against production, and any test that
creates a row creates it in production. That rules out both alternatives:

| Option | Verdict |
|---|---|
| Mocked API layer, in-process | **Chosen.** No socket is opened at any point. No credentials exist to leak. Runs on every PR in ~12s with no service to stand up. |
| Local backend + local Postgres | Rejected. Correct in principle, but it needs Postgres, a migration path and a seed fixture in CI, and the moment `DATABASE_URL` is mis-set in a workflow file it points at the shared project. The failure mode is silent and it writes. |
| Read-only against staging | Rejected outright. "Read-only" is an intention, not a mechanism. `POST /auth/login` writes a session row and bumps `last_login` — **a login is already a write.** The repo's existing Playwright job does exactly this; see §6. |

### How it is enforced, in three layers

1. **The axios instance is stubbed.** Every call the app makes goes through the
   single `api` export in `frontend/src/lib/api.js`. `installMockApi()` replaces
   `get/post/put/patch/delete` with a route table.
2. **An unregistered route is a test failure, not a passthrough.** The mock
   rejects with `MockApi: no route registered for GET /x`. A test cannot fall
   through to a real request by forgetting to stub something — the standard way
   a "mocked" suite quietly starts talking to a server months after anyone
   checked.
3. **The transports themselves are removed.** `installNetworkKillSwitch()`
   replaces `globalThis.fetch`, `XMLHttpRequest`, `WebSocket` and
   `navigator.sendBeacon` with throwers for every e2e test. Anything that
   escapes layer 1 — a raw fetch in a component, the Supabase client, a push
   subscription, an analytics beacon — dies loudly instead of dialling out.

`frontend/src/__tests__/e2e/network-isolation.test.js` asserts all of it. **If
this suite is ever suspected of touching something real, read only that file.**

**No test performs a write against anything.** `api.post` is a spy: assertions
are about *what the app tried to send*, which is the interesting thing anyway,
and nothing receives it. Outbound side effects (invites, mail, WhatsApp, push,
social) are covered by the same mechanism — the invite POST resolves from the
route table and there is no transport in the process to carry it.

---

## 1 · Tool choice

**Vitest + jsdom + `react-dom/client`, building on what the repo already has.**

- `frontend/vitest.config.js` already collects `src/**/__tests__/**`, and the CI
  frontend job already runs `yarn test`. The suite lands inside an existing,
  already-green pipeline rather than beside a second one.
- **Zero new dependencies.** Adding Playwright means regenerating
  `frontend/yarn.lock`, and a Windows-regenerated lockfile rewrites esbuild
  `linux-x64` → `win32-x64` and breaks the Vercel and Railway builds. That is a
  standing rule, and it is the reason Playwright is not the answer here.
- `@testing-library/react` is in `package.json` but its `@testing-library/dom`
  peer is not installed, so importing it throws. Rendering goes through
  `createRoot` directly — the same workaround `pageHeader.test.jsx` and
  `pages/client/__tests__/smoke.test.jsx` already use and document.

### What this costs, stated plainly

jsdom has no layout and applies no author CSS. So this suite **cannot** assert
computed colour, real drag, focus rings, or anything about pixels. Where that
matters the tests say so and use the strongest available substitute — parsing
the stylesheets, which sees declarations but not cascade. Playwright's
`emulateMedia({ reducedMotion: 'reduce' })` + `getAnimations()` is the real
instrument for the motion work and is how a sibling measured the strobe; the
harness for it is shipped (`frontend/scripts/visual-baseline.mjs`) and
deliberately not wired into CI.

---

## 2 · What each test file proves

| File | Tests | What it proves |
|---|---:|---|
| `network-isolation.test.js` | 13 | The four transports throw; the mock refuses unknown routes and wrong verbs; no real credential is in scope. **The suite's safety proof.** |
| `auth-session.test.jsx` | 14 | Login stores token+user together **or neither**; staff land on `/dashboard` and clients on `/client`; a network failure is not reported as bad credentials; `/auth/me` re-verifies on every guarded load and refreshes a stale role; a 401 evicts the token; a guarded page renders nothing while verification is in flight; sign-out clears all six keys it owns and completes even when the server refuses. |
| `client-isolation.test.jsx` | 58 | **The highest-value file.** A client is bounced off every staff path, and off a path nobody has declared yet. Staff are kept out of the portal. `/clients` is not `/client`. A flagged client who also holds an org role keeps the staff product. The client nav offers nothing that leads out. No `/client` route is nested inside the staff shell. |
| `separated-duty.test.jsx` | 21 | On `vetana` and `ganit`, admin does not satisfy approver but still satisfies every rung below it; the picker never offers a level the DB constraint rejects; the frontend mirror agrees with `role_tiers.py` on all three module sets. **Plus two pinned known-open gaps** — see §4. |
| `module-entitlement.test.jsx` | 17 | A granted module is visible and every ungranted one is hidden; an empty grant list hides all modules but not the core workspace; an **absent** list is permissive, not empty; a malformed list is treated as absent; `/auth/me` now sends `module_grants` and serialises `[]` distinctly from absent. **Plus two pinned gaps** — the URL half has no gate. |
| `task-flow.test.jsx` | 16 | Inline create lands in the column it was typed into with the right status; a failed create returns the draft rather than losing it. The move is **one** `PATCH` carrying column and order together; the card appears in the destination before the server answers; a failure rolls back the **whole** previous task, not just its column; drops outside a column, onto the same slot, or onto a synthetic column do not write. Clicking a card opens a dialog labelled for that task. |
| `theme-motion.test.jsx` | 16 | **No infinite animation is scaled by `var(--ix)`**, and none resolves under 100ms of loop period under reduce — the strobe, asserted both as mechanism and as measurement. Every decorative infinite animation has a reduce escape; the loading-indicator exemption is checked for dead and for non-spinner entries. No token exists only in dark. `[data-theme]` is the only theme mechanism and its only values are light/dark. |
| `visual-regression.test.jsx` | 6 | Semantic palette baseline, light and dark side by side. Surface control outlines by role and accessible name, asserted identical across themes. No binary baseline is committed. |

### Deliberate non-duplication

`pages/client/__tests__/smoke.test.jsx` (27 tests, from an earlier pass) already
covers what the client portal *renders* — no staff email, no assignee name, no
internal approval row. None of that is repeated. `client-isolation.test.jsx`
covers the **boundary**: who is allowed to be where.

### Churn resistance

A dozen agents are editing these surfaces. Every path list is **derived at
runtime** from `navConfig.ROUTE_META` and `NAV_FULL`, not transcribed — a module
added to the sidebar next month is covered the day it lands with no edit here.
Selectors are roles, `aria-label`s and generated ids (`#mt-tab-payroll`), not
incidental classes. Where no semantic handle exists (`.k-modcard`, `.bd__add`)
the test says so and names what would be better.

---

## 3 · The two defects the coordinator confirmed, and where they now stand

**The reduced-motion strobe — FIXED by siblings, now locked.** Verified against
rebased staging: **zero** infinite animations are scaled by `var(--ix)`. The
three measured cases (2.000ms ≈ 500Hz, 1.5ms ≈ 666Hz, 0.8ms ≈ 1250Hz) are gone.
Two assertions now hold it shut, one on the mechanism and one on the arithmetic,
so a *new* route to a 2ms loop is caught too.

One correction worth recording: my first draft asserted `a11y.css` still carried
the `--motion-scale: 0 !important` containment. It does not, **on purpose** — a
sibling replaced it with the structural `--motion-scale-user` twin and that file
now says "Do not reinstate the block." Asserting the workaround would have pushed
the next reader to undo a correct fix. The test pins the invariant instead:
`applyPrefs` writes the `-user` twins and never the base tokens, so an inline
style cannot outrank the OS setting.

**A client reaching the staff product — FIXED, now pinned.** The guard is an
allow-list. 38 derived staff paths plus one undeclared path all bounce.

---

## 3a · What the suite caught on the final rebase

Rebasing onto 140 further sibling commits produced exactly four failures. None
was a false alarm and none was noise — this is the suite doing its job on day
one, so it is worth recording what each turned out to be.

| Signal | Verdict |
|---|---|
| `.k-spinner` has no reduced-motion escape | **Intended change, confirmed.** A sibling removed its `animation: none` on purpose (`editorial.css:3613`): it was the only spinner in the build that froze, and a frozen spinner reads as a broken page. Added to the loading-indicator allow-list with the citation. |
| `/hub` hidden when no grant list was sent | **My test was over-broad.** A sibling added `module: 'srijan'` to the two Srijan rows, and `/hub` is *also* `adminOnly`. The permissive-default assertion is about the module predicate, so it now runs over entries where no other predicate is in play. |
| `_safe_user` now sends `module_grants` | **The gap closed while I was writing.** The test was recording the opposite and went red, which is what it was for. **The nav entitlement gate is now LIVE**, not dormant. A second test now pins the subtle half: the field is serialised on `is not None`, not truthiness — an empty list is a real answer ("granted nothing") and dropping it on falsiness would read back as "no opinion" and show every module. |
| Palette snapshot mismatch | **One line: `--on-ok` added, both themes.** A missing `on-` partner filled in — precisely the defect class `25-qa-acceptance.md` §1 lists. Reviewed and accepted. |

The URL half of entitlement is **still open**: `Protected` has no module gate,
so the two `it.fails` pins remain correct and remain red-on-fix.

---

## 4 · Known-open gaps, pinned rather than papered over

Four tests use `it.fails`. That is not a weakened assertion — it passes **only
while the gap is open** and turns red the moment somebody closes it, at which
point the assertion inside is already written the right way round and the fixer
just changes `it.fails` to `it`. A plain assertion of today's behaviour would
have locked the bug in; deleting the test would have lost the record.

### Separated duty is enforced nowhere

`level_satisfies` (`backend/middleware/role_tiers.py:252`) encodes the rule
correctly and has **zero production call sites** — the only callers in the repo
are its own unit tests. **Today an `org_admin` with no approver grant is offered
the "Approve Payroll" button and the request reaches the endpoint.** Both are
pinned in `separated-duty.test.jsx`.

**Do not close this by guessing.** There is an unresolved contradiction that
needs the owner (`_COORDINATION.md` §5):

- `RBAC-SPEC.md:65` — sensitive modules are role-derived, with **no per-member
  grant row at all**. A grant row naming Vetana would be invalid input.
- The Tier-4 level model assumes a grant row **carrying a level** is exactly how
  approver is held.

Both cannot be true. Enforcement built against the wrong one is worse than the
present gap, because it would look enforced.

### Module entitlement does not gate URLs

`Protected` applies three gates — onboarding, client confinement, platform
console — and none of them is entitlement. Hiding a nav link is presentation.
Anyone who bookmarks, guesses or is sent a link reaches the page.

The fix is small and belongs in `Protected.jsx` beside the other three: resolve
the path to a module code via `ROUTE_META`, then apply the same
`null`-is-permissive rule `canSeeNavItem` already uses. Not done here because
this branch owns tests.

**This is now more urgent than when I started.** `/auth/me` *does* send
`module_grants` as of the final rebase (`auth_router.py:126 _safe_user`), so the
nav gate is live: an org can now genuinely hide a module from the sidebar and
believe it is unsubscribed. The URL remains wide open. A gate that works in the
nav and nowhere else is more misleading than one that works nowhere, because it
looks like it is doing something. **Recommend closing this next.**

---

## 5 · Visual regression — and why there are no PNGs

**Binary baselines are not committed, and that is the recommendation, not a
shortcut.**

A pixel baseline is only comparable against a run on the same platform. Font
rasterisation, subpixel hinting and default font substitution differ between the
Windows machines this was authored on and the Linux container CI runs in. A
Windows-authored PNG does not fail occasionally on Linux — it fails on every
glyph, every time. Same class of platform bug as the standing lockfile rule. If
pixel baselines are wanted, they must be generated **inside** the CI container
and kept as artefacts.

Shipped instead, both running in CI:

1. **Semantic palette baseline** — every semantic token's light and dark value
   side by side (91 lines of text). This is what a screenshot diff would be
   *showing* you when a surface changes colour, and a reviewer can see `--danger`
   moved and decide whether that was intended.
2. **Surface outlines** — each surface's landmarks and controls by role and
   accessible name, asserted **identical across themes**. A control that appears
   in one theme and not the other is a real defect; this is the cheapest way to
   catch it. Unlike an innerHTML snapshot it does not churn on a restyle, which
   matters with a dozen agents editing.

`frontend/scripts/visual-baseline.mjs` is the pixel harness for when it is
wanted. It refuses to run without `VISUAL_BASELINE=1`, refuses the production
hostnames outright, refuses any non-localhost host without a second explicit
opt-in, never signs in, and captures public surfaces only — both themes, 393 and
1440, motion frozen. `visual-baselines/` is gitignored.

---

## 6 · The existing Playwright suite is a loaded gun (not mine, flagged)

`playwright.config.ts` + `e2e/*.spec.ts` at the repo root are **orphaned**:
`@playwright/test` is in no `package.json` and there is no root `package.json`,
so nothing can run them locally. The CI job installs Playwright globally and runs
them against `PLAYWRIGHT_BASE_URL` **with `E2E_ADMIN_EMAIL` /
`E2E_ADMIN_PASSWORD`**.

The specs are currently read-only — they open modals, they never submit — but
nothing enforces that, and the next spec added to that directory inherits a live
admin session pointed at a database production shares. I have labelled the job
for what it is and pointed new work at the in-process suite. **I did not delete
or disable it**: it is gated on a repo variable being set, and removing another
agent's tooling on my own judgement is not my call. It is a decision for the
owner.

---

## 7 · What I could not cover

- **Real pixels.** No screenshot diffing in CI. §5 explains the platform reason
  and ships the harness.
- **Real drag.** `@hello-pangea/dnd` measures boxes and jsdom has none, so the
  library is stubbed to a pass-through that captures `onDragEnd`. Everything
  *after* the drop is tested — which is where every bug in that file's history
  has been — but "the card is not draggable" cannot be caught here.
- **Computed CSS.** Contrast sweeps, focus-ring visibility, and the skeleton-CLS
  measurement `25-qa-acceptance.md` §4 describes all need a real browser. The
  motion and theme assertions read declarations, not cascade: a rule overridden
  by a more specific one elsewhere would not be caught.
- **Authenticated surfaces in the pixel harness.** Public pages only, because
  seeded authenticated state needs a local backend — deliberately out of scope
  given the shared database.
- **Mobile breakpoints.** `15-mobile-web.md`'s rule that a hidden desktop nav
  must be *replaced* rather than merely hidden is a layout assertion; jsdom
  reports every element as 0×0.
- **Sanvaad and Pahchan flows.** Not covered — both modules are still in
  progress, and tests against a moving surface would be churn.
- **The onboarding wizard and the invite flow end to end.** The invite POST is
  asserted at the mock boundary (nothing is sent); the six-step wizard is not
  driven.
- **`test_ganit.py::test_create_invoice_success`** fails identically on clean
  staging (`_COORDINATION.md` §8). Not mine, not chased.

---

## 8 · Notes for whoever picks this up

- Add new e2e coverage to `frontend/src/__tests__/e2e/`, not to the root `e2e/`.
- `_harness.jsx` is not collected (no `.test.` in the name). It exposes
  `installMockApi`, `installNetworkKillSwitch`, `makeHost`, `routesWith`,
  `users`, `httpError`, and a media-aware CSS rule scanner (`allCssRules`,
  `underReducedMotion`).
- Every sweep has a **"this is not vacuous"** guard asserting the derived list is
  non-empty. A sweep over an empty list passes and proves nothing — and that
  mistake nearly cost a real result here: two `it.fails` pins were passing
  because `VetanaPage` threw on mount and there was no Approve button *anywhere*.
  The guard caught it, and it is the reason every sweep in this suite has one.
- `frontend/yarn.lock` was **not** modified. `git status` was checked after
  `yarn install --frozen-lockfile` and after every commit.
