# audit-remaining-gaps

Third pass. Scope was the NOT VERIFIED list left by `audit-contrast-dark.md`,
`audit-responsive-a11y.md`, `audit-payload-agreement.md`, `verify-mobile.md`,
`verify-srijan-hub-workflow.md` and `wire-documents-gst.md` — their declared
gaps, not their findings.

Branch `agent-remaining-gaps`, cut fresh from `origin/staging` at **`032455c1`**
and verified 0 behind. (The worktree seeded 796 commits stale, as the brief
warned.) Nothing was run against production. **The database was read only** —
`information_schema` and `to_regclass`, no writes, no migrations. No email,
WhatsApp or push was sent. No sign-in occurred: every route was reached by
mounting the real `src/App.jsx` with `api.defaults.adapter` replaced and a
fixture `/auth/me`.

---

## 1 · The nine unreached routes — all nine now verified

Reached on a private Vite dev server on **:5766** (never `:5173`), serving this
worktree with a fixture adapter. Evidence is **rendered DOM and measured
computed style** via `javascript_tool` — screenshots failed all session, as they
did for every peer. `read_page` was used only for structure.

| Route | Contrast light | Contrast dark | Keyboard | loading/empty/ERROR distinct |
|---|---|---|---|---|
| `/admin` | 2 pre-existing¹ | **clean** | 11–13 tabbable, 0 unreachable, 0 unnamed | ✓ |
| `/admin/orgs` | **clean** (was 8) | **clean** (was 2) | 22 tabbable, 0/0 | ✓ |
| `/admin/billing` | 1 pre-existing¹ | **clean** | 9–18 tabbable, 0/0 | ✓ |
| `/admin/costs` | **clean** | **clean** | 14–16 tabbable, 0/0 | ✓ |
| `/client` | 1 documented² | **clean** | 7 tabbable, 0/0 | ✓ |
| `/client/projects` | **clean** | **clean** | 7 tabbable, 0/0 | ✓ |
| `/client/project/:projectId` | **clean** | **clean** | 7 tabbable, 0/0 | ✓ |
| `/client/approvals` | 1 documented² | **clean** | 8 tabbable, 0/0 | ✓ |
| `/client/files` | **clean** | **clean** | 7 tabbable, 0/0 | ✓ |

Every tab panel was opened and measured separately, not just the default one —
`/admin` ×5 panels, `/admin/billing` ×5, `/admin/costs` ×3.

¹ `span.tabs__n` 4.27:1 and `span.tag` 4.31:1 — inside the **4.13–4.33 marginal
translucent-tint chip band `audit-contrast-dark.md` already recorded as
pre-existing**. Confirmed to occur on the admin console too. Not new, not mine.

² `.btn--fill` white on `--primary` `#00897f` = **4.30:1**. This is the repo's
own documented residual: `node scripts/check-accent-contrast.mjs` prints
`light 4.30 Teal — #FFFFFF on #00897f` under *"residual, needs the accent ramp
changed (design decision, not a bug)"*. My live measurement independently
confirms the static gate's number on a rendered page. **A design decision —
proposed below, not imposed.**

### What the nine routes hid — two real defects, both fixed

**(a) `/admin/orgs` — the suspended-organisation row was below AA in both
themes.** `.adm-sus { opacity: .6 }` (`styles/admin.css:67`) faded the *glyph*
as well as the fill. Measured at 1280:

- light: **8 cells failed** — org name, plan, credits, MRR, storage, seats and
  status all at **4.38:1** against 4.5, and the owner's email at **2.40:1**
- dark: the owner's email at **2.77:1**

WCAG's "inactive user interface component" exemption does not apply: the row is
`tabIndex={0}`, clickable and opens the org on Enter (`admin/OrgTable.jsx:96-99`).
A suspended org is precisely the row an operator opens the console to read.

Fixed by replacing the fade with a tint, keeping the "withdrawn" reading and the
existing danger keyline. **The first fix I wrote was wrong and the instrument
caught it** — see §6. Measured sweep of the tint strength, binding constraint
being the 11px `--on-surface-3` email:

| tint | light | dark |
|---|---|---|
| 18% | 3.83 ✗ | 4.10 ✗ |
| 12% | 4.25 ✗ | clean |
| **8%** | **clean** | **clean** |

Shipped at 8% — `light rgb(244,230,223)`, `dark rgb(36,30,34)`.

**(b) The admin sidebar's active row lost its Devanagari label in dark.**
`.adm__l-hi` is `--side-fg-mute`, chosen against the *unlit* rail; `.adm__item.on`
lightens its own background to `rgb(40,33,63)`, where `rgba(255,255,255,.46)`
measures **4.36:1**. Present on **all four** admin routes and every panel. Light
passes at `.5` on `rgb(51,44,71)`, so it is dark-only in effect. The EN label
already steps to `#fff` on that row; the Devanagari now steps with it to the
rail's own `--side-fg`. No new literal, no new token.

**After both fixes, re-measured on a fresh load: all four admin routes are 0
failures in dark, and `/admin/orgs` is 0 in both themes.**

### The `HeadCell` crash holds, and it has no siblings

`/admin` and `/admin/billing` both render. The guard at `ui/Table.jsx:50`
(`if (!sortKey || !onSort)` *before* `dir` is derived) is doing its job. I looked
for the same shape elsewhere — a `a?.b === c ? c.d : null` where the undefined ===
undefined branch dereferences — and found none in `components/ui/`.

---

## 2 · The three surfaces that compiled but were never rendered — all three now rendered

**`TableView`** — reached through `/projects/t-1` (which imports it *statically*;
`/boards` lazy-loads it and the chunk did not resolve under the harness).
Rendered with 4 populated rows. `audit-responsive-a11y.md`'s unverified claim is
**verified true**: all row title controls are real `<button>`s, focusable and
named. 80 tabbable, **0 unreachable, 0 unnamed**, no horizontal overflow, both
themes. `.tb__ttlbtn` is 101.7×19.5 with a 44px row pitch and **24.5px vertical
clearance** — under the 24×24 minimum but **passing WCAG 2.5.8 by the spacing
exception**, which is why it needs no change.

**`CampaignsTab`** — reached through `/prachar` → Campaigns with two populated
campaigns. Row controls are real `<button class="pr__pill">`, focusable, named.
65 tabbable, **0 unreachable, 0 unnamed**. Verified true.
*New, unfixed:* `span.pr__pill-t` (campaign name on its channel-coloured pill)
measures **4.09:1** in light. Left alone — see §7.

**`/sign/:token` authenticated branch** — the page a client's customer signs on,
and previously only ever seen unauthenticated. `SigningPage.jsx:47` builds its
own `axios.create(...)`; because the page is `lazy()`, that instance is created
*after* boot, so setting `axios.defaults.adapter` globally does reach it. Four of
the six steps driven end to end:

| step | 1280 light | 1280 dark | 393 dark |
|---|---|---|---|
| `otp_send` | 4.30² only | — | clean, no overflow |
| `otp_verify` | 4.30² only | — | clean, no overflow |
| `sign` | 4.30² only | — | — |
| `done` | **clean** | **clean** | clean, no overflow |

0 unreachable and 0 unnamed controls at every step; tab order is sensible
(`a.pub__link` → `button.btn` → `button.btn`). `a.pub__link` "View document (PDF)"
is 136.6×19.5 — under 24 tall; noted, not changed, because it is a text link.

---

## 3 · Field-name agreement — closed against the live schema

`audit-payload-agreement.md` left 156 of 279 GET routes open because `SELECT *`,
`**dict(row)` and computed returns make a missing key invisible from source. Read
`information_schema.columns` for `staging` + `public`: **243 tables, 2 860 columns,
1 009 distinct names.** Union that with every SQL alias, dict-literal key,
Pydantic field and alias= the backend can emit (**2 395 names**), then test every
snake_case property read in `frontend/src` (**645 distinct names**).

**22 reads resolve to no real column and no alias.** Method note: normalising
CRLF first is load-bearing — `.` does not match `\r` in JS, so `/\/\/.*$/` never
anchors on a CRLF line and every `//` comment survives the strip. That one detail
was the difference between 28 candidates and 22.

### The one that is not a frontend problem at all

Chasing `avatar_url` (10 reads) found a **backend defect that breaks an entire
module in production**:

```
to_regclass('staging.users')                    → NULL      (does not exist)
column avatar_url on public.users               → absent    (the column is `avatar`)
db.py:44  SET search_path TO staging, public
```

`routers/messaging.py` joined **`staging.users` in six places** and selected
`u.avatar_url` in four. Both are hard errors — `UndefinedTableError` and
`UndefinedColumnError` — not silent nulls. **Every read endpoint in Sanvaad
answered 500 against a real database:** the member directory (`:184`), the channel
member list (`:367`), message listing in both the paged and unpaged arm (`:494`,
`:506`, `:516`), and the thread view (`:648`). Sanvaad could not load a message.

`routers/org_members.py:82` and `:364` selected `avatar_url` off the unqualified
`users` — the Org settings → Members list and the add-member search, both 500.

This was **half-known and left open**. `routers/search.py:386` already noted
`staging.users` "does not exist on this database" and deliberately joined the
unqualified `users`. `migrations/PROPOSED_065_module_role_levels.sql:248-255`
posed it as a question — *"Either that object exists and was created outside this
directory, or those four Sanvaad queries are broken — worth resolving on its own
account."* It is the latter, and it was six sites rather than four. The live
catalogue settles it; both notes are updated.

Fixed: `staging.users` → `users`, and `u.avatar → … AS avatar_url` /
`AS sender_avatar` so the **wire names the frontend already reads are unchanged**
and no client needs touching.

### The remaining 21, triaged

**Resolve to nothing and the UI silently degrades — real, unfixed:**

| Read | Frontend | Backend truth |
|---|---|---|
| `active_entry` | `components/TaskDrawer.jsx:178` | `routers/time_entries.py:73` returns `{entries, total_minutes}` only → a running timer is never restored after a reload |
| `open_task_count`, `done_this_week` | `pages/TeamsPage.jsx:198`, `:199` | `server.py:2031` members carry `tm.*` + `display_name/position/company_name/member_role` → every member card reads **0 open / 0 done** permanently |
| `workspace_name` | `pages/ProjectsPage.jsx:356` | produced only by `email_service.py` for invite mail, never by an API → every project card reads **"Internal"** |
| `comment_count` | `components/views/TaskCard.jsx:109-112` | no column, no alias, no aggregate anywhere in `backend/` → the board card's comment badge can never appear |

**Resolve to nothing but a fallback covers it — dead code, harmless:**
`subject_title` (`ActivityFeedPage.jsx:181`, falls back to `task_title`, which
`routers/activity.py:97,164` really does alias) · `task_ref`
(`TimeReportPage.jsx:318` → `'KAR'`) · `job_title` (`DrawerMeta.jsx:53` and two
others, third in a chain after `member_role || position`, both of which exist).

**Not payload reads — local state or another vendor's API, no action:**
`trigger_event` and the four `form.*` names in `srijan/GenerateTab.jsx`
(`email_subject`, `ad_type`, `target_url`, `post_type`), `brand_name`
(`SkillsTab.jsx` template vars), `cost_inr` (derived locally at
`AdminCostDashboardPage.jsx:246`), `in_review` (a local map key in
`StatusChip.jsx`), `online_at` (Supabase presence), `action_label` / `action_href`
(`sanvaad/Message.jsx:106` — read off a message's own `meta` JSONB, whose keys are
not schema columns).

**Documented as deliberately absent — correct as written:** `onboarding_complete`
(`Protected.jsx:218`; the `=== false` test is explicitly designed for a field
`/auth/me` does not send) and `pahchan_active_users` (`AdminOrgsPage.jsx:571`
gates the whole column on the payload carrying it).

---

## 4 · The mobile 400 blind spot — fixed, with the first tests `mobile/` has ever had

`resolveScreenState` had `errorKind`'s old defect: any 4xx that was not 403 fell
through to `error` and told the user *"Something went wrong on our end. Pull down
or tap retry"* — blaming us for a 400/404/409/422/429 and offering a retry that
will be refused identically every time.

The decision moved to **`mobile/src/components/screenStatus.ts`**, which imports
nothing. That is the whole reason it had no test: `ScreenState.tsx` imports
`react-native` and `@expo/vector-icons` at module scope and cannot load outside a
bundler. `ScreenState.tsx` re-exports everything, so **no caller changed**.

Seventh status `request` added, placed with `forbidden` above `offline` for the
reason the file already gives for `forbidden`: a 422 *arrived*. Copy is the web's
`ErrorState` `request` copy verbatim, so the two products say the same sentence
about the same condition.

**`mobile/src/components/__tests__/screenStatus.test.ts` — 13 tests, all passing,
exit 0.** No new dependency: Node 24 strips the types and `node:test` runs it.
`"test": "node --test \"src/**/*.test.ts\""` added to `mobile/package.json`.
`tsconfig.json` gains `allowImportingTsExtensions` + `noEmit` (Node's ESM resolver
needs the explicit `.ts`; the build never emits — Metro compiles the app).

`node node_modules/typescript/bin/tsc --noEmit` → **exit 0**.

**Known limitation, stated rather than hidden:** 401 is classified as `request`.
It is a 4xx, so that is truer than "something broke on our end", but what it
really means is the session ended and this primitive has no state for that.
`api/client.ts:43` already writes the right sentence as `friendlyMessage`. A
dedicated `expired` state needs a navigation decision, not a copy change.

---

## 5 · Touch targets — measured on the rendered page, and solved

`.k-trow__tick` rendered at **17×17**; the archive chip beside it at **28×18**;
their edges **18px** apart; row height 44px. Both under WCAG 2.5.8 (AA)
**24×24**, and the spacing exception does not rescue them — 24px undisplaced
circles at those centres intersect.

The responsive pass was right that 44×44 is not available: the centres are
**40.5px** apart, so two 44px-wide areas overlap by 3.5px and each control starts
taking taps meant for the other. On a "complete this task" / "archive this task"
pair, a mis-hit is a silent wrong write — worse than a small target.

So the hit areas grow to **24 wide** (the AA bar exactly) and **32 tall**, through
a pseudo-element, leaving the visual geometry untouched. Width is the constrained
axis; height is free because nothing is stacked inside a 44px row, and 32 leaves
6px of clearance to the rows either side so no tap is ambiguous about which row
it hit.

Verified by `elementFromPoint` hit-testing, not by reading CSS:

```
visual tick   17 × 17     (unchanged)
visual chip   28 × 18     (unchanged)
hit tick      24 × 32     570.5 – 594.5
hit chip      28 × 32     609   – 637
clearance     14.5px      overlap: false
both fully inside the 44px row: true
elementFromPoint at tick hit-area L edge  → k-trow__tick
elementFromPoint at tick hit-area R edge  → k-trow__tick
elementFromPoint at chip hit-area L edge  → k-row-action--archive
```

`.bc__tick` on the board takes the identical rule, because `editorial.css`
already states the invariant — *"the same touch rule as the board's `.bc__tick`,
because a tick that behaves differently on the list than on the board is two
features to learn."*

**Newly measured, deliberately NOT fixed:** `.cbx` (the shared Checkbox) renders
**17×17** in `TableView` — 5 instances, select-all plus one per row. Same class of
defect, but `.cbx` is the system-wide checkbox and changing it touches every
form in the product. I could not verify that blast radius in the time left, and
a change I cannot verify is not a fix. **The numbers are here; the change is not.**

---

## 6 · Instrument faults I found in my own tooling — all three would have produced false reports

Recorded because the next pass will hit them, and because two of them nearly
became findings in this report.

**(a) A hidden tab freezes CSS transitions, and `getComputedStyle` then returns
the value being transitioned *from*, indefinitely.** After a theme flip, the two
routes measured first reported `.cl-nav a[aria-current]` at **1.08:1** — the light
`--on-surface` on the dark canvas — while the three measured later reported clean.
Same component, two answers. A genuine fresh page load at `?theme=dark` gave
**0 failures** and the correct colours. Fixed by injecting
`*{transition:none!important;animation:none!important}` before measuring.
**I would have reported "the client portal has no dark theme" — which is false.**

**(b) Forcing `data-theme` desyncs from `applyPrefs`.** `audit-contrast-dark.md`
warned about exactly this and I walked into it anyway. `applyPrefs` writes
`--primary`, `--primary-text` and `--on-primary` as **inline** properties on
`<html>`, derived from `prefs.mode` — inline beats the `[data-theme="dark"]`
block. A bare `setAttribute` leaves the light accent on a dark canvas and
manufactures a wall of 2.13:1 findings. Theme changes must go through
`applyPrefs`. Verified: `--primary-text` is `#005650` in light and `#05b7aa` in
dark, and only `applyPrefs` moves it.

**(c) A colour parser that only knows `rgba?()` silently mis-reads `color-mix`.**
Chrome serialises `color-mix(in srgb, …)` as `color(srgb r g b)`. A parser that
returns null for it makes the backdrop walk step *past* a painted surface and
report what is behind it. **This is not hypothetical: my first `.adm-sus` fix
measured "clean" at an 18% tint and was actually 3.83:1**, because the instrument
never saw the tint it had just been given. This codebase uses `color-mix` in
roughly forty rules, so any prior contrast reading over a `color-mix` surface is
worth re-checking. Fixed; the corrected parser is what produced the 8% value.

**(d) `setTimeout` is throttled to ~1/minute in a backgrounded tab.** A sweep
built on `sleep(450)` does not fail, it takes an hour and looks like a hang. A
`MessageChannel` port message is not throttled, and React 18's scheduler rides on
the same primitive, so it also guarantees a render got its chance.

The instrument was validated against six controls before any reading was trusted:
genuine low contrast → flagged (1.96); transparent-stop gradient → **not** flagged
(the 52-phantom trap, avoided); all-opaque gradient → flagged; `disabled` control
→ **not** flagged (WCAG exempts inactive components — this alone was 5 of my
first 6 "findings"); enabled at 42% opacity → flagged (1.40); good contrast →
not flagged.

---

## 7 · Proposed, not imposed

**The accent ramp.** `check-accent-contrast.mjs` names four residuals as design
decisions, and one of them — `light 4.30 Teal — #FFFFFF on #00897f` — is the
**default** accent on the **primary button**, which I measured live on the client
portal's Approve, the signing page's Sign document, and the app's New task.
Reaching 4.5:1 needs `--primary` about 4% darker at the same hue. That is a brand
decision and I have not touched it.

**`lib/utils.js` palettes.** Not re-audited — `audit-contrast-dark.md` covers
them and the brief marks a replacement as a design decision. Left for the owner.

**`span.pr__pill-t` at 4.09:1** (Prachar campaign name on its channel pill,
light) — newly measured on a surface nobody had rendered. Unfixed: the pill's
fill is channel-derived, so the correct repair is a foreground rule per channel
tone, which is a palette decision of the same kind as above.

---

## 8 · STILL NOT VERIFIED after this pass

The deliverable for the owner's own review before 15 August.

- **`cost_report_pdf.py` renders tofu.** Not attempted. It was the last item on
  the optional list and the time went to §3's backend defect instead. WeasyPrint
  is at `~/wpvenv/bin/python` inside WSL and the render is still available to
  whoever picks it up. **The one client-facing PDF of nine that bypasses the font
  contract is still bypassing it.**
- **`lib/utils.js` avatar and project palettes** — 7/7 and 9/10 failing
  white-on-swatch, worst 2.15, still carrying retired literals. Untouched.
- **`.cbx` at 17×17** — measured (§5), not fixed. System-wide blast radius.
- **The Sanvaad fix is not proven against a live database.** The catalogue proves
  the *old* SQL could not execute and the new SQL names only objects that exist;
  no query was executed against real rows, because that is a read I was not asked
  to make and a write I must not. `pytest` covers these routes against a mocked
  pool, so **the tests passed before the fix too** — they could not have caught
  this, and they do not confirm it. Someone should open Sanvaad on staging.
- **`/boards` → List** — `TableView` was verified through `/projects/:id`
  (static import). The `lazy()` chunk on `/boards` never resolved under the
  harness and I could not tell whether that is a harness artefact or real. Worth
  one look.
- **The two remaining `/sign` steps** — `already_signed` and `declined` were not
  driven. Four of six were.
- **Pixel appearance anywhere.** No frame was ever composited. Everything here is
  measured geometry and computed style. Spacing, type scale, shadow and how any
  of it *looks* remain unverified across all nine routes.
- **Modals, drawers, overlays, hover and real `Tab`-key focus** — still unreached,
  exactly as `audit-contrast-dark.md` left them. Focus was measured from the
  tabbable set and accessible names, not by pressing Tab.
- **Mobile rendering.** Still no simulator. The mobile work here is a pure-logic
  fix with 13 passing tests and a clean `tsc`; **nothing about how a mobile screen
  looks is asserted**, and `mobile/` still has no lint config.
- **Request-body field agreement** — §3 closed the *response* side. The 169
  unresolved write bodies from `audit-payload-agreement.md` are untouched.
- **The 4 other `information_schema` schemas** were not read; only `staging` and
  `public`, which is where `search_path` points.

---

## 9 · Files changed (11)

**Backend (3)**
- `routers/messaging.py` — 6 × `staging.users` → `users`; 4 × `u.avatar_url` →
  `u.avatar AS …`; header records the catalogue evidence.
- `routers/org_members.py` — 2 × `avatar_url` → `avatar AS avatar_url`.
- `migrations/PROPOSED_065_module_role_levels.sql` — the open question at :248
  answered.

**Frontend (3, CSS only)**
- `styles/admin.css` — `.adm-sus` fade → 8% danger tint.
- `styles/editorial.css` — `.adm__item.on .adm__l-hi`; `.k-trow__tick` /
  `.k-row-action` hit areas.
- `styles/boards.css` — `.bc__tick` hit area.

**Mobile (5)**
- `src/components/screenStatus.ts` *(new)* — the pure decision, seventh status.
- `src/components/__tests__/screenStatus.test.ts` *(new)* — 13 tests.
- `src/components/ScreenState.tsx` — re-exports; `request` copy and icon rule.
- `package.json` — `test` script.
- `tsconfig.json` — `allowImportingTsExtensions`, `noEmit`.

No `yarn.lock`, no `package-lock.json`. The line-ending-only churn in
`__snapshots__/visual-regression.test.jsx.snap` was reverted (`git diff
--ignore-all-space` empty). The fixture harness lived in `frontend/harness/` with
its own `vite.harness.config.mjs` and both were deleted before committing. No
pricing figure appears anywhere, including comments.

---

## 10 · Gates

```
frontend/
  node scripts/check-tokens.mjs   → 356 declared, 244 referenced, 0 missing   EXIT 0
  node scripts/check-classes.mjs  → 3545 selectors, 2728 classes, 0 missing   EXIT 0
  npx vite build                  → built in 6.35s                            EXIT 0
  npx vitest run                  → 47 files / 720 tests passed               EXIT 0
  grep -ci unhandled              → 0

backend/
  python -m pytest -q             → 1488 passed, 122 skipped, 0 failed        EXIT 0

mobile/
  node node_modules/typescript/bin/tsc --noEmit                               EXIT 0
  npm test                        → 13 tests, 13 pass, 0 fail                 EXIT 0
```

Baselines met exactly: 47 files / 720 tests, and 1488 / 122 / 0.
`check-accent-contrast.mjs` → **ok**, the same four documented residuals.

The narrow-viewport tab strip was **not** touched. Three agents have now flagged
it; it matches the reference structurally and adds an edge fade the reference
lacks. Four.
