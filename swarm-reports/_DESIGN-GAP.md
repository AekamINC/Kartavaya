# Design gap — what pixel-perfect actually requires, and why it did not happen

## The mistake that cost a night

The 30-agent run was pointed at `design-handover/*.md` (prose) and
`design-reference/Kartavaya Redesign/*.jsx` (components). `design-handover/_SOURCE-MAP.md`
said in bold that the JSX "is where pixel-perfect actually lives" and filed the
`.html` files under **"Rendered mockups"** in the last row of a table.

That was backwards in the way that mattered. Those HTML files are **runnable React
harnesses** — they load the JSX through Babel standalone from a CDN and render the
whole product. Opening one in a browser shows you exactly what the design looks
like.

Nobody opened one. Thirty agents read descriptions of a design that was sitting
there executable. So every gap that is only visible — grouping, spacing, order,
what exists at all — was invisible to all of them, and no agent could have
caught it by reading, however carefully.

## How to render the reference

```
mkdir -p frontend/public/__ref
cp "design-reference/Kartavaya Redesign"/*.{html,jsx,css,png} frontend/public/__ref/
# dev server, then open:
#   http://localhost:5173/__ref/Kartavaya%20Redesign.html
```

`frontend/public/__ref/` is gitignored — it is a copy for comparison, so the
reference stays single-source in `design-reference/`.

Renders confirmed working. Needs network access for the unpkg CDN scripts.

The other harnesses are worth the same treatment: `Settings.html`,
`Auth Screens.html`, `Mobile App.html`, `Onboarding.html`, `Pahchan v1.html`,
`Landing Page.html`, `Component Inventory.html`, `Interaction Catalogue.html`.
`Component Inventory.html` and `Interaction Catalogue.html` are the two that show
components and interactions in isolation, which is where per-component fidelity
should be judged.

## Confirmed gap #1 — navigation grouping · FIXED

`Chrome.jsx:36` NAV, which is what the mockup renders:

| Section | Devanagari | Items |
|---|---|---|
| Workspace | कार्यक्षेत्र | Dashboard, Boards, Tasks |
| **Revenue** | राजस्व | CRM, Sales, Finance |
| **People** | जन | HRMS, Payroll, Attendance, Messaging |
| **Growth** | वृद्धि | Marketing, AI Hub, Reports |
| Settings | व्यवस्था | Roles & access, Customization, Organisation, Aekam admin |
| **Clients** | ग्राहक | Client Portal, eSign, Approvals |

The build had a flat `modules` group holding all ten modules, so CRM sat under a
generic heading instead of beside Sales and Finance. Fixed — the build now has
Revenue / People / Growth / Clients. `01-navigation.md` describes the sidebar
without listing it, so reading the prose could never have caught this.

## Still open — verify each against the RENDERED mockup, not the prose

Ordered by how visible each is.

1. ~~**Section headings.** The reference renders `WORKSPACE` above `कार्यक्षेत्र`
   as a two-line stacked heading.~~ **WRONG — struck.** It does not. `.side__sec`
   is `display:flex; flex-direction:row`; measured on the rendered page the Latin
   sits at `x=18` and the Devanagari at `x=201` in a 251px sidebar — one row,
   Devanagari pushed right by `margin-left:auto`. The build already matches. This
   entry was written from the JSX, which is the mistake this whole file exists to
   warn about. Type treatment of the two spans is still a fair question; the
   LAYOUT is not.
2. **Item labels.** Reference says `Finance` where the build says `Invoicing`,
   and `ग्रह` where the build says `ग्राहक` for CRM. **SETTLED — both kept as the
   build has them**, see `worktree-agent-a124b468e0049b3a9.md` §2. Short version:
   `Invoicing` is live in eight surfaces and describes what the module does;
   `ग्रह` means *planet*, and `Modules.jsx:28` carries a written prior decision
   that CRM is `ग्राहक`, customer. The mockup is not right about everything.
   Still open, and found while doing this: `ग्राहक` is now the CRM sub-label AND
   the Clients section heading — rename the section.
3. **Badges.** ~~Confirm the build renders a badge in the same position and shape
   for each.~~ **DONE.** Element and slot match exactly (`.side__badge`,
   `margin-left:auto`, last child, hidden in the rail). The reference's
   12/4/3/7/1 are mockup fixtures; `01 §4` specs exactly two counts
   (`{inbox, approvals}`) and the build has both. Not a gap.
4. **Per-page layout.** Every module screen in `ScreensBiz.jsx`, `ScreensCore.jsx`,
   `ScreensWork.jsx`, `ScreensMore.jsx` — compare rendered, page by page.
5. **Density and display presets.** The harness sets `data-density="cozy"` and
   `data-display="serif"` on `<html>`. If the build defaults elsewhere, every
   spacing comparison is against the wrong baseline and will look wrong for a
   reason that is not the page's fault.
6. **Preset industry navs.** ~~The build has no equivalent.~~ **ANSWERED — do not
   build it.** It has a better one, in two halves: `onboarding/data.js`'s
   `OB_PRESETS` picks the starting modules per industry, and `/auth/me`'s
   `module_grants[]` drives `canSeeNavItem`, with `navGroupsFor` dropping the
   emptied groups — the same visible behaviour, decided by entitlement rather
   than a client toggle the server knows nothing about. A second filter would let
   a user reveal a row that 403s. Full reasoning in
   `worktree-agent-a124b468e0049b3a9.md` §3.

## Also settled — the app shell's structure

Sidebar, toolbar, breadcrumb, rail, mobile bar: enumerated element by element
against the rendered mockup in `worktree-agent-a124b468e0049b3a9.md` §1, with
screenshots of both sides in `swarm-reports/_shots/`. Six differences fixed in
`76e06b1`; nine left open as decisions rather than patches (section order,
`Client Portal` having no staff route, the sync chip, the appearance popover,
gear-vs-sign-out in the footer, and a duplicate `.k-kbd` declaration).

**Two build-harness facts worth having before you start**: the shared dev server
on `:5173` serves the MAIN repo, not your worktree, and the Playwright MCP
browser is shared — tabs get stolen mid-task. Headless Chrome
(`chrome.exe --headless=new --screenshot=… --virtual-time-budget=7000`) is
contention-free.

## Scrolling — DIAGNOSED AND FIXED (`699d51f`)

**`.kv` had no `grid-template-rows`.** It is `display:grid` with `height:100vh`,
so the single implicit row was `auto` and sized to its TALLEST ITEM rather than
to the 100vh box. Measured on a 720px viewport with a long page and a long nav:
the row computed to **3078px**. `.kv__main` and `.side` inherited it, so
`.kv__content` and `.side__nav` were each exactly as tall as their own content —
their `overflow-y: auto` had nothing left to scroll — while `overflow: hidden` on
`.kv` silently clipped everything past the fold.

Measured A/B on one loaded page:

| `grid-template-rows` | `.kv__content` | `.side__nav` |
|---|---|---|
| `auto` → 3078px | **cannot scroll** | **cannot scroll** |
| `minmax(0, 1fr)` → 720px | 699 / 3056 ✓ | 666 / 3024 ✓ |

`minmax(0, 1fr)` and not a bare `1fr` — `1fr` floors at min-content, which is the
same bug wearing a different hat.

### The methodology lesson, which is the reusable part

**This exact diagnosis was made, shipped, and then REVERTED** — because a probe
reported the row already resolving to 720px on its own. The probe was the thing
that was wrong: it loaded **two of the four stylesheets** `App.jsx` imports and
left the sidebar **empty**, so nothing was tall enough to stretch the row and the
bug could not appear. A reassuring measurement beat a correct hypothesis.

What made it reproducible was the owner saying the **sidebar** would not scroll
either. One clipped region can be a page bug; two is the shell.

If you build a probe, make it faithful: **all four stylesheets in `App.jsx` order**
(`index.css`, `kartavaya-design.css`, `editorial.css`, `settings.css`) and real
content in every region you are not testing. An unfaithful probe does not fail
loudly — it agrees with you.
