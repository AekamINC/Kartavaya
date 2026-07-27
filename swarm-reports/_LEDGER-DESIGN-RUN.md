# Design-run ledger — collected, NOT acted on

30 agents, 10 surfaces × 3 lenses. Per the standing rule: collect every report,
act on none, cross-reference when the last lands.

Confidence is assigned at cross-reference time, not here.

---
## CRM/Sales/Finance · MOTION (ac57395f)

- Tab switching had NO motion on all three pages — `.mt__b.on::after` measured
  `animation-name: none`, `transition-duration: 0s`. Underline teleported. FIXED.
- CRM deal board **could not be dragged** — moving a deal meant clicking one of
  five small stage buttons. Now `@hello-pangea/dnd`. FIXED, 8 tests.
- **A failed fetch renders as an empty state in 23 places.** Fixed 9; 14 still
  open with line numbers. Two worse than the pattern: Vikray `DashboardTab`
  shimmer never resolves on failure; `TargetsTab` swallowed the rejection whole,
  so a 500 rendered "No targets set".
- Reduced motion clean: only `dmSpin` at fixed 640ms survives under reduce.
- CORROBORATION: shared `:5173` server serves the MAIN checkout, not worktrees —
  now reported by 4+ agents. Any "after" measured there is staging plus whatever
  a sibling had uncommitted.
- CORROBORATION: `DristiPage.jsx:581` JSX-comment build break — 5th independent
  report. Fixed upstream.
- Pre-existing, verified on clean staging: `semantic-palette` snapshot failure.

---
## Shell/nav · MOTION (af7bd373)

- **Mobile drawer**: scrim had NO fade (`animation-name: none`), drawer had NO
  exit at all (`getAnimations()` during close returned `[]`, node gone same
  tick), enter 220ms where the build's own table says 360ms, travel a fixed
  `-100%` ignoring `--motion-scale`. All four FIXED.
- **Toast layer entirely deaf to `prefers-reduced-motion`** — every duration an
  inline literal, which no media query can reach. Exit == entrance 300ms;
  unmount on a 350ms timeout beside a 300ms transition; progress bar animated
  `width` for 6s continuous; `zIndex: 9999` cleared every rung including
  `--z-sheet`. FIXED.
- Measured proof of a previously-untested assertion: under reduce,
  `animationstart`/`animationend` land on the same tick and the node still
  unmounts — which is why `--ix` bottoms at `.001`, not `0`. Build asserted it
  in a comment; nothing tested it.
- Matched already, left alone: rail (252↔72, 220ms), nav items (140ms),
  breadcrumb (instant, correct in both).
- **CONTRADICTS the boards-motion agent**: that agent changed `--ease-emph` to
  `cubic-bezier(.2,0,0,1)` to match the reference; this one argues
  `00-tokens.md:133` documents the divergence deliberately (M3 emphasised easing
  has no single-cubic form) and reverting collapses two tokens into one.
  → ADJUDICATE. Both measured; they disagree on intent, not on the value.
- Out of surface, reported not changed: `.k-iconbtn` three literal `.12s`;
  `.top__search` no hover timing; `.k-notif` (the chrome's only popover) has
  neither enter nor exit; **the build has no Appearance popover in the chrome at
  all** — the reference hangs one off a sun/moon toolbar button. STRUCTURE.
- `staging` was red on merge from `c41128a` (`--outline` WCAG fix without
  regenerating the palette snapshot). Reconciled in a labelled commit.

---
## Settings/Org/Customization · STRUCTURE (ae427fc5)

- **Aekam admin console was reachable only by typing a URL.** Fully built, fully
  guarded, and listed in `EXTRA_ROUTES` — which is by definition the set of
  routes with NO sidebar entry. Now gated on `ADMIN_SURFACE_ROLES` matching
  `Protected.jsx`, not "any platform role" (`srijan_admin`/`platform_support`
  would get a row into a console where every screen 403s). FIXED.
- **`Roles & access` existed only as a tab of Organisation.** `/settings/roles`
  now mounts the same component on its matrix half — the line the design draws
  at `SetOrg.jsx:130` — rather than duplicating a screen that adds, invites,
  revokes and regrants. FIXED.
- Devanagari + counts added to both hubs' tab bars. Removed the `Billing` nav row
  (pointed at a tab of the row above it; not in the design). Admin `Overview` →
  `Users`, which is what the page renders.
- Tabs themselves were **six-for-six already** on both hubs — the gaps were
  destinations, not panels.
- No backend at all: admin Dashboard, Support sessions, System settings, and 3 of
  10 `Roles & access` tabs. `platform_support_sessions` and `staging.audit_log`
  have NO TABLE. → NOTE: audit_log was created by migration 060 today; recheck.
- METHOD NOTE, worth keeping: rendering corrected the agent twice after it had
  already enumerated from JSX. Tab labels come from a lookup two files away
  (`Data.jsx:134`), invisible in `SetOrg.jsx`. **Render to find what is missing,
  read to find what it should say.**
- CORROBORATION ×6: `DristiPage.jsx` build break. Adds that it had been failing
  since `8131f24`, is lazily imported so the dev server never parsed it, and
  **both design gates pass on a tree that cannot build.**
- CORROBORATION ×2: `c41128a` `--outline` change left the palette snapshot stale.
- CORROBORATION: worktrees handed out predate `design-reference/` and have no
  `node_modules` — "other agents may be verifying less than they think."

---
## Mobile app · MOTION (aeceb4ef)

- **The mandated strobe finally MEASURED, not asserted.** In
  `Interaction Catalogue.html` with `--ix: .001` (what `motion.css:23` sets under
  reduce), `.dm-spin` computes to `animationDuration: 0.0007s`,
  `iterationCount: infinite` — **0.7ms per rotation, ~1429 Hz**. Not ported.
  This is the strongest evidence yet for the `16-animations.md:44` spec defect.
- Milder half in the mobile stylesheet: `.mpulse` (2s) and `.msk` (1.4s) are
  literals not `--ix` multiples — they don't strobe but they don't STOP either,
  contradicting MOTION-SPEC §4's own "disabled under reduced motion".
- `<Modal animationType>` has no duration, no curve and **no reduced-motion
  behaviour available at all** — 11 call sites slid full-height regardless of the
  OS setting. All converted to `Sheet.tsx`; zero left in `src/`.
- **`enqueueMutation` accepted `entity_type`/`entity_id` and stored NEITHER**, so
  `TaskCard`'s `syncing` prop had nothing to tell it which task it applied to and
  was passed by nothing anywhere. A swipe-completed row on a train rendered
  identically to one the server had accepted. FIXED.
- **`tintColor` is iOS-only** — all 14 `RefreshControl` sites set it and nothing
  else, so every Android pull-to-refresh has been Material blue on a teal
  product. Five passed props straight to FlatList, which exposes no colour props
  at all. FIXED, one `Refresher`.
- A successful offline flush was **silent** — `setBanner(null)`, so a sync that
  worked and one that was cancelled looked identical. FIXED.
- **The 72h promise existed only in the past tense** — enforced silently by
  `pruneExpired`, surfaced once as an Alert AFTER a punch aged out. `hoursLeft`
  now shown while the window is open, against the same constant.
- `done` was terminal on ClockScreen — the shutter was dead until remount. FIXED.
- Deliberately NOT collapsed under reduce, with reasons: SwipeRow drag travel
  (direct manipulation), RefreshControl spinner (OS classes it as progress; a
  progress indicator that stops reads as a hang), scrim/banner opacity (carries
  the information).
- CORROBORATION: the sibling's `--ix`/`--motion-scale` split verified against the
  running harness — all five durations and six curves match `motion.ts` exactly.

---
## Boards/views/drawer · PIXELS (ab31e9c6)

- **40 of 40 load-bearing measurements now match the render exactly.** Generated
  table, not transcribed. Corrected: board gap (12px literal → `--gap-tight`),
  column padding/gap/min-height/radius, column head rule, colour mark (8px dot →
  4×16 bar), column title type, count pill; card radius, resting shadow removed,
  gaps, avatar 26→22, priority as a `.tag` pill; **drawer width
  `min(720px,78vw)` → the reference's actual `min(560px,92%)`**; head/body
  padding onto `--pad-card`, props gutter, label type; table shell as a card.
- Devanagari defect found AGAIN: `BoardsPage` passed `फ़लक` inside the kicker —
  measured **2.42px tracking + uppercase**. Moved to `sanskrit` (where the
  reference renders it and the build had no node at all), nuqta spelling fixed,
  and `.k-pageh__sans` now declares `letter-spacing: normal` rather than
  inheriting −.02em. Verified every Devanagari node is Tiro 400, untracked.
- **TWO LEDGER ENTRIES ARE STALE — my own coordination file is wrong:**
  `_COORDINATION.md §0c` says nobody should fix `--radius-base`; a sibling fixed
  it (10→12) mid-flight. Because this agent had corrected the radius STEPS, the
  two composed into exact agreement. Same sibling fixed `--ease-emph`.
  → Fix §0c at cross-reference time.
- Still open with numbers: view toolbar is a different object (underline tabs
  41px + bilingual vs pill segctrl 35px + Latin only); page-header title 44px vs
  28px; board is fluid grid vs rigid 288px flex; `.dr__scrim` easing;
  `--shadow-4`; avatar primitive 1px discrepancies.
- **The palette-snapshot failure was a CRLF/LF artefact**, not the `--outline`
  change — proven by reverting all five of its files and seeing it fail
  identically. `*.snap text eol=lf` is the hardening. → CONTRADICTS two earlier
  agents who attributed it to `c41128a`.
- Confirmed independently: `--font-ui` Inter-vs-Public-Sans is a harness
  artefact, not a defect. Density baseline confirmed and deliberately not touched.

---
## Auth/Onboarding · STRUCTURE (a7503caa)

- **BIGGEST LIVE DEFECT OF THE RUN SO FAR: onboarding's Team step 403'd for
  everyone it was written for.** `sendInvites` posted to `/admin/invites`, guarded
  by `require_platform_role`, which reads `user_roles WHERE org_id IS NULL`. A
  customer's `org_owner` has no such row — so the one wizard step that sends mail
  failed for exactly the people the wizard exists for. Aekam staff were the only
  ones it worked for, and for them it wrote `org_id NULL`: an account belonging
  to no organisation. Now `POST /v1/org/invites`. FIXED.
  → NOTE: my own brief said "onboarding is wired to every endpoint that exists".
    Technically true, and it HID this. Every endpoint it called was real; the
    Team step called the wrong real one. Lesson for how I write briefs.
- `POST /api/auth/refresh` added — sliding window, not resurrection: `require_user`
  rejects an expired JWT, and there is no refresh token or table, so that is the
  honest ceiling. FIXED.
- `api.js` had **no 401 branch at all**. Now ends the session and redirects with
  the attempted path; `/auth/login` is the sole exception (the only route that
  answers 401 by design). Deliberately NOT a refresh-on-401 — the token it would
  send is the rejected one. FIXED.
- **Accept-invite showed nothing about what was being accepted.** Org, inviter,
  role and grants were already stored and applied — the person accepting was the
  only party who could not see them. Added `GET /api/auth/invite/{token}`,
  answering ONE 404 with ONE string for unknown/expired/spent/revoked so it can't
  be swept for live tokens. FIXED.
- **`Protected` treated a dead network as a sign-out** — every `/auth/me` failure
  deleted the token and bounced to `/login`; `api.js` retries 3× then rejects, so
  a lift or a Railway restart signed users out and destroyed their token. FIXED.
- Deliberately not built: AUTH-SPEC's existing-user invite branch is
  **unreachable by construction** — both invite creators 409 on an email that
  already has an account.
- Open, not settled: `StepOrg` collects an org name into a field reaching no
  endpoint (wire to `PATCH /v1/org/profile`, which exists, or drop it); `Done` is
  a rail step in the reference, absent in the build.
- CONTRADICTS ab31e9c6 on the snapshot failure: this agent says `c41128a`
  (`--outline`) landed after the last baseline commit, verified with
  `git merge-base --is-ancestor`. ab31e9c6 says CRLF artefact. → ADJUDICATE.
- Gates on merged tree: 524 frontend / 1260 backend passing, vite build clean.

---
## CRM/Sales/Finance · PIXELS (a3900f10)

- **Density baseline — CORROBORATED ×4 and now the best-characterised finding of
  the run.** Build defined only `compact`/`comfy` and defaulted to `comfy`:
  48/32/20/26/12, a scale appearing NOWHERE in the reference's token file. It
  sits between the design's cozy and comfy and matches neither. `--pad-page` is
  `.kv__content`'s padding on every page, so it moved the whole product.
  `kartavaya-design.css`'s bare `:root` carried the correct cozy numbers all
  along; an attribute selector always beat it. FIXED (+ the missing control
  option). `--radius-base` 10→12 same shape, ladder was at 83%.
- **Devanagari mechanism finally explained, not just observed:** `letter-spacing`
  inherits as a RESOLVED ABSOLUTE LENGTH, so a parent's `-.02em` lands on a
  Devanagari child at the parent's pixel value. Two leaks in the build FIXED
  (`.bd__cn-hi` −0.065px, `.k-pageh__sans` −0.88px). **Two in the REFERENCE
  itself**: `.ph__kick` 2.1px + uppercase, `.ph__hi` −0.56px. The kicker cannot
  be fixed in CSS — `Revenue · राजस्व` is one node with two scripts.
  → This is the root cause behind ~5 separately-reported Devanagari defects.
- **The agent caught THREE of its own wrong measurements** — `.chip` was matching
  the topbar's inline-styled org switcher, producing a padding defect that does
  not exist. Harness now records each matched element's `outerHTML`. Exactly the
  failure mode of confident numbers from the wrong node.
- **`Public Sans` is loaded by NEITHER side** — measured identical to bare
  `serif` (401.08px) on both. The reference's UI is therefore `system-ui`; the
  build's is Inter, which it does load. **Build's position is better — do not
  "fix" toward a font nothing loads.**
- Left alone deliberately, with numbers: stat tile fill (documented decision),
  stat value colour, tab count badge, table head at the 12px a11y floor —
  accessibility beats fidelity, do not take it to 10px.
- Open, component work: `ganit/InvoicesTab.jsx` renders a raw `<table>` with
  inline `padding:'10px'` per cell — no `--row-h`, so Finance ignores density
  entirely. `.mh` inverts the reference's bilingual hierarchy.
- CORROBORATION ×3 to the decimal from independently-built instruments on
  `.ph__kick`, `.ph__hi`, Public Sans, density and radius.
- **`applyPrefs` overwrites `--primary` at runtime from the chosen accent** — the
  stylesheet's `#04837A` is not what renders; default teal gives `#00897f`.
  The token declared is not the token that renders. → affects every file-based
  colour comparison in this run.
- `check-contrast` fails identically on staging; the a11y report records it as
  GREEN. Either stale or something regressed. → ADJUDICATE.

---
## CRM/Sales/Finance · STRUCTURE (a414c546)

- **CONFIRMS the owner's complaint describes the REFERENCE, not a build bug.**
  The design puts 6 tabs inline and 11 behind `More +11`; the build rendered all
  17 in one scrolling strip. → matches what I found and fixed independently.
- **`ScreenGraha` is in `ScreensCore.jsx`, NOT `ScreensBiz.jsx`.** My brief
  pointed at `ScreensBiz.jsx`, which holds only Ganit and Vikray. An audit that
  opens the named file finds nothing and concludes CRM was never designed.
  → MY BRIEF WAS WRONG. Second brief error this run.
- **CRM is pipeline-first** — opens on a stage-column board of deal cards. The
  build opened on `today`, and its `PipelineTab` was a grid of per-stage COUNT
  tiles: a summary of a board that existed nowhere. Board now built and wired.
- Naming settled WITH EVIDENCE, contradicting an earlier agent's call:
  design intends **Finance** not Invoicing (NAV + page title "FINANCE & GST" +
  `Landing2.jsx:265` all agree), and **ग्रह** not ग्राहक (ग्राहक already means
  the `clients` TAB). Changed in all five places + e2e spec.
  → CONTRADICTS a124b468, which settled the opposite on `Modules.jsx:28`.
    ADJUDICATE — and note this moots my मुवक्किल section rename.
- Tab lists already correct: Graha 17, Ganit 10 match id-for-id and in order.
  **Vikray 4-vs-6 divergence is CORRECT and must not be reverted**: `cae0e0a`
  removed `pipeline`/`customers` because neither had an endpoint, and
  `Data.jsx:119` says `MODULE_TABS` was "lifted from staging pages" — the
  reference mirrors the build's OLD tab bar rather than specifying a new one.
- KPI strips on all three, wired to existing endpoints. `KpiStrip` owns
  loading/error so no caller can render a failed fetch as an empty row.
- Took a sibling's equivalent `ModuleTabs` overflow menu wholesale and deleted
  its own duplicate. Same for their `DashboardTab` error fix.
- Still open: `.mt` is two different components (`module.css` vs `boards.css`);
  `TaskDrawer.jsx:196` throws `r.data.forEach is not a function` every test run.
- CORROBORATION ×3 on `c41128a` / palette snapshot.

---
## Component set · MOTION (aad81979)

- **Nine overlays had an entrance and NO EXIT** — modal panel, modal scrim,
  ConfirmDialog, Menu (no animation at all), command-palette scrim and panel,
  admin SlideOver (+ no scrim animation), drawer lightbox, toast. All now have
  measured exit pairs on the ladder. `.pop` transform-origin was `center` —
  popovers grew from their own middle instead of their anchor.
- Under reduce every exit collapses to ~0.14–0.18 **ms but stays non-zero**, so
  `animationend` still fires and no deferred-unmount node leaks. Third
  independent confirmation that `--ix` must bottom at `.001` not `0`.
- **Both of MY "still open" items were already fixed — verified by measurement.**
  `dmPop` is declared once; the drawer.css copy is gone. The spinner
  inconsistency resolved the OTHER way from my brief: all four keep a FIXED
  period under reduce, with a reasoned loading-indicator exemption in
  `theme-motion.test.jsx:88`. → MY BRIEF WAS STALE. Third brief error this run.
- Two duplicate-keyframe defects consolidated: `bcTickPop` ≡ `drStPop`,
  `ixLanded` ≡ `bcJust` — byte-identical bodies under two names each.
  `@keyframes modalIn` was `dmFade` renamed; deleted.
- **NEW GUARD: `e2e/overlay-motion.test.jsx`**, 13 assertions that DERIVE the
  overlay set rather than listing it. Found 4 defects on first run and 2 more
  during rebases, catching `.sv__thread` and `.kv__scrim` within minutes of them
  landing. Blocks: entrance without exit, exit slower than entrance, off-ladder
  duration, `.is-closing` without `animationend`, a fallback timer that can beat
  the animation, half-applied click-through, duplicate/aliased keyframes.
  → This is the most valuable artefact produced in the run: it makes the whole
    class of defect non-recurring.
- Judgment call: renamed a sibling's `[data-closing="1"]` to `.is-closing` — a
  correct exit that was invisible to the test that finds missing ones.
- Two exemptions with stated reasons and no-dead-entry tests so they can't rot:
  `.k-modal`/`.k-modal-scrim` (mid-migration off the retired `--ink` vocabulary)
  and `.k-cmdk-overlay`, whose animation is **dead** — every element carrying
  that class also carries `data-k-palette`, so palette.css outranks it.
- 542/542 vitest, both gates 0 missing, vite build clean.

---
## Pahchan · MOTION (a77c8523)

- **The reviewer's loading state was PERMANENT BY CONSTRUCTION.** Four states
  (`load`/`ok`/`gone`/`err`) but `'load'` was terminal: `api.js:17` creates axios
  with no `timeout` (default 0 = never) and the interceptor retries network
  errors 3× before rejecting. A socket that accepts and never answers had NO
  ENDING. The ellipsis could not resolve. FIXED.
- **The approve control was not gated.** `record('ok')` checked only the server's
  `noref` flag — nothing about whether the images were on screen. Pressing ↵
  against three blank rectangles wrote a verdict on someone's attendance. FIXED,
  8 tests incl. one holding a request open forever and one asserting the cursor
  does NOT advance past a row it refused.
  → Together these are the same defect §3 names: "manufactures a record of
    verification that did not happen." Previously reported as fixed; it was half
    fixed — the photos loaded, the gate did not exist.
- `F` (flag) deliberately never gated — a reviewer who cannot see the faces still
  has an opinion, and gating it would strand the queue on exactly the rows that
  need a person. Good reasoning, keep.
- **The punch confirmation was a spinner that never stopped** — `phase === 'done'`
  rendered an ActivityIndicator and nothing returned to `'idle'`; success was
  indistinguishable from in-flight, and clocking out needed the app killed.
  Sibling fixed the lifecycle; this agent added sent-vs-queued (a queued punch
  showed the same green tick and "Clocked in" while the line below said "Saved on
  this device"), a confirmation haptic, and the capture flash.
- Infinite loops surviving reduce: 6 → **1** (`dmSpin@640ms`, fixed, functional).
- Verified by measurement: **OS `reduce` beats the inline Animations preference
  in all three settings** — the preference can reduce further, never restore.
- Still open, STRUCTURE lane: **there is no clickable approve/reject control at
  all.** Reference `PahchanReview.jsx:184` has `rv__vb ok`/`rv__vb no` on every
  row; the build has only the keyboard path. When buttons land they must read the
  same `compare[p.id]` gate.
- Still open, outside lens: **`retakes` on ClockScreen is mislabelled** — it only
  increments in the `catch`, so it counts FAILED ATTEMPTS, yet at 3 it hides the
  shutter with "You have retaken this 3 times". **Three camera errors lock
  someone out of clocking in.**
- 550 tests pass, both gates 0 missing, vite build clean, mobile tsc exit 0.

---
## Sanvaad/Varta · STRUCTURE (a50b57c3) — LAST OF 30

- **A private channel was permanently a channel of one.** `create_channel`
  inserts exactly one membership row (the creator); `add_member` is the only
  other writer of that table and NOTHING CALLED IT; `list_messages` refuses a
  non-member on a private channel. The form offered "Private", the channel
  appeared, and no second person could ever be added or read a word. FIXED.
- **No DM could ever exist.** `create_channel` rejects `type='dm'` outright and
  `/dm` had no caller — so "Direct messages" sat over a list empty by
  construction. FIXED.
  → Proximate cause of both: the endpoints need a `user_id` the caller had
    nowhere to get, because the only user directory (`GET /v1/org/members`) is
    gated on `org_admin`. Added `GET /directory`.
- 16 endpoints published, 9 called. **Six had zero callers anywhere.**
- **Access hole**: `list_members` checked ORG membership, not CHANNEL access — so
  any org member could enumerate a private channel's members, and a DM's, which
  names who is talking to whom. FIXED.
- `_require_editor()` added to every write path — `require_module` only checked a
  grant ROW EXISTS, so `viewer` (the default for every new grant) could post,
  edit, delete and react exactly like an editor.
  → **LIVE BEHAVIOUR CHANGE**: anyone at default `viewer` loses posting. Safe
    only because 058 landed yesterday and this module has never run in anger.
- Deliberately not built, with reasons: `Request Editor` (reference draws the
  button; no endpoint to request a grant, and a dead button is worse than none),
  attachments (`samvada_message_attachments` has no endpoint at all).

---
## Pahchan · STRUCTURE (a440a014) — 31st report; my "all 30" was wrong

- **`GET /regularisations` 500'd on every call** — selected `e.full_name`, which
  `manav_employees` has never had (it is `name`; `full_name` is on
  `manav_candidates`). This is MY code from the payroll-bridge work. FIXED.
- **A correction could be approved but never declined** — my model matched
  `rejected`; migration 064's CHECK is `declined`. Every decline was a constraint
  violation dressed as a 500. Also MY error. FIXED.
- **The geofence has never existed for any org.** No UI could create a site, so
  `_nearest_site` always returned nothing, `distance_m` stayed null, and the
  geofence branch could never fire — while Policy offered a "geofence radius"
  setting for something uncreatable. FIXED.
- Every flag chip showed the wrong word — `StatusChip` has no `label` prop, so
  the register's was dropped and six attendance conditions collapsed into three
  task-tracker nouns, on the one screen whose job is telling one wrong from
  another. FIXED.
- Built: register detail (`openId` was written and read by nothing), date picker
  (`?on=` existed, nothing sent it), shift/overtime policy UI, sites,
  corrections, payroll push, history. Web tabs 3 → 6.
- Judgment worth keeping: the detail draws its own accuracy geometry rather than
  loading map tiles — OpenStreetMap would put an employee's punch coordinates in
  a URL to a third party, strictly worse than the leak §7 forbids. And history
  never renders "absent": `/me` returns punches, not a muster roll, so an empty
  day could be leave, a weekly off, or a punch still in the 72h buffer.

### RESOLVED: the red `test_separated_duty.py`
Reported as 3 failures on cross-org isolation and left for adjudication. Verified
red, then diagnosed: **not a hole.** `_require_editor()` was added to every
messaging write path (correct, per spec) and runs BEFORE `_assert_same_org`. A
blanket `fetchval -> None` fails the editor gate first, so the refusal arrives as
403 not 404, and `call_args` — the LAST call — returns the editor gate's query
instead of the tenancy one. `_assert_same_org` reads `staging.user_roles`
correctly and always did.

Tests now let the editor gate pass so the tenancy check is what is under test,
and search every recorded call rather than assuming it was last. **Proved not
weakened**: neutering `_assert_same_org` puts all three back to red.
Backend 1266 passed.

→ The agent was right to refuse to turn it green by guessing. Asserting on "the
  last query" is what made a correct new gate look like a regression.
