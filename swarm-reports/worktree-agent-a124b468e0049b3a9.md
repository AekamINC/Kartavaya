# App shell & navigation — STRUCTURE lens

Branch `worktree-agent-a124b468e0049b3a9`. Surface: `frontend/src/components/layout/**`.
Lens: what EXISTS, what it CONTAINS, what ORDER it is in, what is missing. Spacing,
colour and motion belong to the other two agents on this surface.

**Both sides were RENDERED, not read.** Screenshots in `_shots/`:

| File | What it is |
|---|---|
| `a124-ref-shell.png` | `Kartavaya Redesign.html` at 1440×900 |
| `a124-build-shell-before.png` | the build's shell at 1440×1700, before this branch |
| `a124-build-shell-after.png` | the same, after |
| `a124-ref-rail.png` / `a124-build-rail.png` | collapsed sidebar, both sides |
| `a124-ref-preset-ca.png` | the reference with `preset: 'ca'` — see §3 |

How they were produced, since the harness fought me and the next agent will hit
the same walls:

- The shared Vite server on `:5173` serves the **main repo**, not this worktree.
  A file written into this worktree's `frontend/public/__ref/` is not visible
  there. Started an own server: junction `frontend/node_modules` →
  `D:\Projects\Kartavya\frontend\node_modules`, then
  `VITE_BACKEND_URL=http://localhost:8080 node node_modules/vite/bin/vite.js --port 5188`.
  Without that env var the app renders a "Configuration Error" page and nothing else.
- `Protected` verifies the token against a live `/auth/me`, so the real shell
  cannot be reached without credentials. Rendered `Sidebar` + `Topbar` +
  `MobileNav` + `MobileDrawer` directly from a throwaway `frontend/__probe.html`
  / `__probe.jsx` (uncommitted, deleted at the end) wrapped in `MemoryRouter` +
  `CustomizeProvider`, with a seeded `Kartavaya_user`.
- The Claude browser pane cannot screenshot in this session, and the Playwright
  MCP browser is **shared with the other agents** — tabs get stolen between two
  consecutive calls. Screenshots came from headless Chrome directly:
  `chrome.exe --headless=new --screenshot=… --window-size=W,H --virtual-time-budget=7000 --user-data-dir=…`.
  That is contention-free and worked every time.
- The reference's rail and its industry presets are React state with no URL, so
  two derived harnesses were generated into `public/__ref/` (gitignored): one
  that clicks `.side__toggle` after mount, one that seeds `kv_appearance` with
  `preset: 'ca'` before `App.jsx` boots.

---

## 0 · Two things that were true before any comparison

**Staging did not compile.** `frontend/src/pages/DristiPage.jsx` opened a ternary
branch with a `{/* … */}` JSX comment. That spelling is correct in JSX *child*
position; there it was the first thing inside the branch's parentheses, which is
*expression* position — so `{…}` parsed as an object literal and `<DataTable>`
after it became a second expression with no operator. esbuild refused the file,
so `vite dev` and `vite build` both failed to scan the entry graph. Not just
Dristi — the whole frontend. Another agent landed the same fix minutes before
mine, so my commit was skipped during rebase; I verified afterwards that every
`.js`/`.jsx` under `frontend/src` now parses under the jsx loader, and DristiPage
was the only failure.

**`_DESIGN-GAP.md`'s open item 1 is wrong.** It says the reference renders
`WORKSPACE` above `कार्यक्षेत्र` as "a two-line stacked heading". It does not.
`.side__sec` is `display:flex; flex-direction:row`, and measured on the rendered
page the Latin sits at `x=18` and the Devanagari at `x=201` inside a 251px
sidebar — one row, Latin left, Devanagari pushed right by `margin-left:auto`.
The build already does exactly this. Nothing to fix; the ledger entry should be
struck so the next agent does not "correct" a heading that is already right.

---

## 1 · Every structural difference

Sidebar. `≡` = same, `≠` = differs, `∅` = absent from one side.

| # | Element | Reference (rendered) | Build (rendered) | Verdict |
|---|---|---|---|---|
| 1 | Section heading layout | one row: Latin left, Devanagari right | same | ≡ |
| 2 | Section heading is a control | plain `<div>`, sections never collapse | `<button>` + chevron, collapsible, persisted to `kartavya_sidebar_sections` | ≠ — **build wins**, `01 §5` specs the collapse and its localStorage key |
| 3 | Section count | 6 | 8 | ≠ — build adds `Operations`, `Team` |
| 4 | Section order | Workspace · Revenue · People · Growth · **Settings** · Clients | Workspace · Operations · Team · Revenue · People · Growth · Clients · **Settings** | ≠ — **needs a decision**, §4 |
| 5 | Empty sections | dropped (`.filter(g => g.items.length)`) | dropped (`navGroupsFor`) | ≡ |
| 6 | Workspace items | Dashboard · Boards · Tasks | Today · Tasks · Boards · Projects | ≠ — **under-determined**, §4 |
| 7 | Revenue items | CRM · Sales · Finance | CRM · Sales · Invoicing | ≠ label only, §2 |
| 8 | People order | HRMS · Payroll · **Attendance · Messaging** | HRMS · Payroll · **Messages · Attendance** | ≠ — **FIXED** |
| 9 | Growth order | Marketing · **AI Hub · Reports** | Marketing · **Analytics · Srijan** | ≠ — **FIXED** |
| 10 | Clients items | Client Portal · eSign · Approvals | E-Sign | ≠ — **needs a decision**, §4 |
| 11 | Settings items | Roles & access · Customization · Organisation · Aekam admin | Categories · Customize · Organisation · Billing | ≠ — build routes Aekam admin to `AdminShell`; Roles & access has no nav row, §4 |
| 12 | Item markup | icon · (en over hi) · badge | same, plus an `ADMIN` pill | ≡ (build adds) |
| 13 | Badge element & position | `.side__badge`, `margin-left:auto`, last child | same class, same slot | ≡ |
| 14 | Badge coverage | Tasks 12 · Finance 4 · Attendance 3 · Messaging 7 · Roles 1 · Approvals 3 | Approvals · Inbox | ≠ — **not a gap**, §3 |
| 15 | Badges in rail | hidden | hidden | ≡ |
| 16 | Rail exists | yes, 72px | yes, 72px | ≡ |
| 17 | Rail brand | mark only | mark only | ≡ |
| 18 | Rail toggle | present, chevron flips | present, chevron rotates 180° | ≡ |
| 19 | Footer contents | avatar · name · **role · org** · gear→Settings | avatar · name · **role** · sign-out | ≠ role line **FIXED**; gear vs sign-out §4 |
| 20 | Brand block | Kartavaya / कर्तव्य / Aekam Inc | Kartavaya / कर्तव्य / by Aekam Inc | ≈ copy, left alone |

Topbar, left to right.

| # | Element | Reference | Build | Verdict |
|---|---|---|---|---|
| 21 | Org / surface chip | first crumb segment, toggles tenant↔platform | ∅ | **FIXED** as text, §3 |
| 22 | Crumb hi + en | present | present | ≡ |
| 23 | Search | input, `⌘K` | button → palette, `⌘K` | ≡ structurally (`01 §1` mandates the button) |
| 24 | Sync chip | `● Synced` | ∅ | **needs a decision**, §4 |
| 25 | `?` shortcuts button | present | ∅ (key-only) | **FIXED** |
| 26 | Bell + dot | present | present | ≡ |
| 27 | Appearance button → popover | present | ∅ (Customize is a settings page) | **needs a decision**, §4 |
| 28 | Primary action | `+ New` | `+ New task` | ≈ copy |

Mobile.

| # | Element | Reference | Build | Verdict |
|---|---|---|---|---|
| 29 | Compact bar identity | module hi over en | product name "Kartavaya" | ≠ — **FIXED** |
| 30 | Compact bar actions | appearance + bell | bell | ≠ — follows §4 (27) |
| 31 | Bottom bar slots | 5 routes: Home · Tasks · CRM · Chat · Money, Devanagari labels | Today · Tasks · **＋** · Messages · **More**, English labels | ≠ — **build wins**, `01 §1` specs this bar verbatim |
| 32 | Drawer | full Sidebar in an overlay | full Sidebar in an overlay, `forceWide` | ≡ |

---

## 2 · The two label questions, settled

The brief asked me to settle these deliberately. Both go **against** the
reference, and the reasoning is the point.

### `Invoicing` (build) vs `Finance` (reference) — keep `Invoicing`

`Finance` is one word in a mockup with no downstream. `Invoicing` is the word in
seven live places: `navConfig.js`, `lib/commands.js`, `KeyboardShortcuts.jsx`
("Go to Invoicing"), `lib/moduleColors.js`, `GanitPage.jsx`'s own header,
`AdminOrgsPage.jsx` ("Ganit · Invoicing"), `pages/org/catalogue.js`, plus the
landing page's "Invoicing & GST". Changing the nav row alone re-creates exactly
the sidebar/topbar drift `navConfig.js` was extracted to end. It is also the
more accurate word: `onboarding/data.js` describes ganit as "GST invoices,
expenses, e-way bills", which is invoicing, not finance.

If the founder wants the broader word it is a product-naming decision and all
eight surfaces change in one commit. Recorded, not taken.

### `ग्रह` (reference) vs `ग्राहक` (build) for CRM — keep `ग्राहक`

The reference's word is wrong on meaning, and the codebase already knows it.
`pages/marketing/sections/Modules.jsx:28` carries a written decision:

> CRM is ग्राहक — grāhak, customer. Not ग्राह, which means seizing, or a
> crocodile, and was live in both navConfig and here until it was corrected.

`ग्रह` is a third word again — planet, or the root *grah*, seizing. It is a
transliteration of the module's code name "Graha", not a Hindi word for a
customer list. The sub-label's job is wayfinding for a Hindi reader, and
"planet" does not do that job. The naming-pattern argument (every other module
uses its own Sanskrit name) is real but weaker than meaning.

**One genuine problem survives that decision, and it is visible in both
screenshots**: `ग्राहक` appears twice in the sidebar — as CRM's sub-label and as
the **Clients** section heading. The reference avoids the collision only by
accident, because its CRM row says something else. The fix is to rename the
*section*, not the module. That is a copy call — listed in §4.

Same class, found while rendering: eSign is `हस्ताक्षर` (signature) in the
reference and `प्रमाण` (proof/certificate) in the build. `हस्ताक्षर` is the
better word for signing, but `प्रमाण` is consistent across `navConfig.js`,
`moduleColors.js`, `org/catalogue.js` and the landing page, so it falls under
the same "all surfaces or none" rule. Listed, not taken.

---

## 3 · The preset question, answered: **mockup-only affordance, not a gap**

`Chrome.jsx:71-78` defines `PRESETS = { ca, legal, agency, trading, consult, all }`
and `App.jsx:27` turns the chosen one into `enabled`, which the sidebar filters
against; empty sections then disappear. `a124-ref-preset-ca.png` shows it
working — People and Growth vanish entirely under `ca`.

The build already has this, done properly and in two halves:

1. **Onboarding picks the industry.** `pages/onboarding/data.js:38` `OB_PRESETS`
   maps seven industries to starting module sets — the same idea as
   `Chrome.jsx`'s presets, with a better list.
2. **The server decides what the sidebar may show.** `/auth/me` returns
   `module_grants[]` (`auth_router.py::_module_grants`, mirroring
   `require_module` gate for gate); `navContext` reads it and `canSeeNavItem`
   filters on `item.module`; `navGroupsFor` drops the emptied groups. Identical
   visible behaviour, driven by entitlement rather than by a client-side toggle.

Building the mockup's picker would add a **second, contradictory** way to hide
modules — one the server does not know about — so a user could hide a module they
are paying for, or reveal a row that 403s. `RBAC-SPEC.md`'s denied-state rule 1
("No access → absent from the sidebar") is already satisfied by the grant path.

**Do not build it.** The one thing the mockup has that the build does not is a
*user-level* "show me less than I'm entitled to" control. If that is wanted it is
a Customize preference that filters *within* `module_grants`, never outside it.

Badge coverage (row 14) resolves the same way. `01 §4` lists exactly two count
endpoints and says both should arrive in one call (`GET /v1/me/badges →
{inbox, approvals}`). The reference's 12 / 4 / 3 / 7 / 1 are mockup fixtures with
no endpoint behind them. The badge *element and its position* match, which is the
structural claim; inventing four more counters is not a structural fix.

---

## 4 · Open, each needing a decision rather than a patch

1. **Section order (row 4).** The reference puts Settings *fifth of six*, above
   Clients. That reads like an artefact of how the array grew rather than a
   design intent, and the build's "Settings last" is the convention every user
   already has. Not changed. If the reference order is meant literally, it is a
   two-line move in `navConfig.js`.
2. **Workspace items (row 6).** Reference: Dashboard · Boards · Tasks. Build:
   Today · Tasks · Boards · Projects. The build carries a fourth row the
   reference has none of, so "the reference order" does not determine where
   `Projects` goes, and moving Boards above Tasks would split Boards from
   Projects. Left alone deliberately.
3. **Clients has one row (row 10).** Reference: Client Portal · eSign ·
   Approvals. Build: E-Sign. `Approvals` sits in the build-only `Operations`
   group beside Activity and Automations; moving it to Clients strands it from
   its neighbours. `Client Portal` has **no staff route at all** — `/client/*` is
   the client's own shell behind `ClientShell`, which staff are bounced out of
   (`Protected` rule 3). A staff-facing portal-management screen would have to be
   built before the nav row means anything.
4. **`Roles & access` has no sidebar row.** The reference gives it one, with a
   badge. The build has the RBAC screens but reaches them another way. Worth
   checking against `08-rbac-screens.md` — outside this lens.
5. **Sync chip (row 24).** No offline/sync state machine exists on this surface
   to drive it. `Chrome.jsx:233`'s own comment — "never lie about state" — is the
   argument for *not* shipping a chip that would always read "Synced".
6. **Appearance popover (row 27).** The build routes appearance to a full
   settings page (`/settings/customize`) with far more control than the mockup's
   popover. A topbar popover is a new component and a duplicate surface; it is a
   product call whether the quick controls are worth the second place to change
   them.
7. **Footer: gear vs sign-out (row 19).** The reference's footer button opens
   Settings; the build's signs out. Settings already has four sidebar rows;
   sign-out has **no other affordance anywhere**. Swapping to match the mockup
   would remove the only way to log out. Not changed.
8. **`ग्राहक` collides with itself** — CRM's sub-label and the Clients section
   heading are the same word. Rename the section.
9. **`.k-kbd` is declared twice in `editorial.css`** and the later declaration
   silently wins every shared property. Same defect shape as the `.k-sidebar*`
   duplication documented in `Sidebar.jsx`'s header. Worked around, not merged —
   merging is the pixel agent's call.
10. **Two module registries.** `navConfig.js` and `lib/moduleColors.js` each own
    an `en`/`hi` per module and they already disagree — `pahchan` is "Attendance"
    in one and "Pahchan" in the other. `navConfig.js`'s header documents killing
    exactly this drift between the sidebar and the topbar; it has grown back in a
    third file.

---

## 5 · What landed

`76e06b1` — six fixes, all in `frontend/src/components/layout/**` plus the
matching rules in `editorial.css`:

- breadcrumb gains the organisation as its first segment (`.crumb__org`)
- topbar gains the `?` shortcuts button (`.k-kbd--bare`)
- the compact mobile bar names the page instead of the product
  (`.kv__mobbar-crumb` / `-hi` / `-en`, replacing `.kv__mobbar-brand`)
- sidebar footer reads "Owner · Aekam Inc" instead of "owner"
- People: Attendance before Messages
- Growth: Marketing · Srijan · Srijan Admin · Analytics

`navContext()` gained `orgName`, derived from the `org_roles[0].org_name` the
server has always sent, so the breadcrumb and the footer share one definition of
"which org am I in".

Gates green before and after: `check-tokens` 0 missing, `check-classes` 0 missing.
