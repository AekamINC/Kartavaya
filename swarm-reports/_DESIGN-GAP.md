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

1. **Section headings.** The reference renders `WORKSPACE` above `कार्यक्षेत्र` as a
   two-line stacked heading. Confirm the build's heading component matches —
   size, tracking, weight, and the Devanagari line's font (Tiro, weight 400, and
   NOT tracked; `24-bilingual-devanagari.md` forbids tracking on Devanagari and
   the heading style applies it to the Latin line only).
2. **Item labels.** Reference says `Finance` where the build says `Invoicing`,
   and `ग्रह` where the build says `ग्राहक` for CRM. Both are the designer's
   words; the build's are somebody's paraphrase. Settle each deliberately rather
   than silently.
3. **Badges.** The reference carries counts on Tasks (12), Finance (4),
   Attendance (3), Messaging (7), Roles (1), Approvals (3). Confirm the build
   renders a badge in the same position and shape for each.
4. **Per-page layout.** Every module screen in `ScreensBiz.jsx`, `ScreensCore.jsx`,
   `ScreensWork.jsx`, `ScreensMore.jsx` — compare rendered, page by page.
5. **Density and display presets.** The harness sets `data-density="cozy"` and
   `data-display="serif"` on `<html>`. If the build defaults elsewhere, every
   spacing comparison is against the wrong baseline and will look wrong for a
   reason that is not the page's fault.
6. **Preset industry navs.** `Chrome.jsx:72-76` defines per-industry module sets
   (`ca`, `agency`, `trading`, `consult`). The build has no equivalent.

## Not yet diagnosed — scrolling

Reported as "not working at all". First hypothesis — `.kv` grid had no
`grid-template-rows`, so the row sized to content — was **measured and proved
wrong**: an `auto` row in a definite-height grid still stretches, and
`.kv__content` scrolls correctly in isolation. That change was reverted rather
than shipped, because a wrong fix with a confident comment is worse than none.

Ruled out so far:
- `.kv` / `.kv__main` / `.kv__content` in isolation — scrolls (probe measured
  `contentScrollH 3000` vs `clientH 720`).
- The landing page — the document scrolls normally.
- `document.body` scroll locks in `modal.jsx`, `Sheet.jsx`, `SlideOver.jsx` —
  the shell scrolls `.kv__content`, not body, so a body lock cannot cause it.

Needs reproduction inside the authenticated shell — which page, which viewport
width, and whether a drawer or sheet had been opened first.
