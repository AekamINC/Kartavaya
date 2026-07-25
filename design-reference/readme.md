# Kartavya Design System

**Product:** Kartavya — task & project management SaaS for Indian professional services firms
**Company:** Aekam Inc · [aekaminc.com](https://aekaminc.com)
**Repo:** [github.com/kevalvshah/Kartavya](https://github.com/kevalvshah/Kartavya) · branch `main`
**Owner / Designer:** Keval Shah

---

## Product context

Kartavya (कर्तव्य — "duty" in Sanskrit) is a bilingual task-management platform aimed at Indian SMBs: chartered accountancy firms, legal practices, marketing agencies, and consultancies. It features Kanban boards, task lists, team management, approval workflows, time tracking, automations, report generation, and a client portal.

The product's identity is rooted in **editorial typography** — serif display headings, a warm paper-like canvas, and prominent Devanagari script labels alongside English. The system serves three audiences: **admins** (full workspace control), **members** (project-level work), and **clients** (collaborative portal with request/approval flow).

### Surfaces

| Surface | Stack | Notes |
|---|---|---|
| **Web app** (internal) | CRA + React + editorial CSS | 13 screens + drawer + modals |
| **Client portal** | Same codebase, role-gated | Subset of screens, request/approval flow |
| **Transactional emails** | HTML table-based templates | 5 types: invite, welcome, approval-request, approved, task-done |
| **Mobile app** | React Native / Expo | Separate codebase, not covered here |

### Source materials

- GitHub repo: `kevalvshah/Kartavya` (frontend + backend + mobile)
- Prototype: HTML+React-via-Babel prototype with 13 screens (in this project's `src/` and `Kartavya App.html`)
- Design handoff documents in `design_handoff_kartavya_v2/`

---

## Visual Foundations

### Color philosophy

Kartavya uses a **warm, paper-like canvas** (`#F6F3EC`) instead of pure white — evoking the feel of a printed editorial page. The ink scale runs from near-black (`#1A2230`) through progressively muted slates. The brand accent is a **blue→teal gradient** (`#0082c6 → #03a1b6 → #05b7aa`), with four swappable accent presets (Teal, Blue, Saffron, Indigo).

- **Backgrounds:** Warm cream canvas, not cold gray. `--bg: #F6F3EC`, `--surface: #FCFAF5`
- **Text:** Warm dark ink, not pure black. `--ink: #1A2230`
- **Borders/rules:** Warm golden-beige, not gray. `--rule: #E2DCC9`
- **Sidebar:** Always dark (`#050E1A`), regardless of light/dark theme
- **Dark theme:** Deep navy (`#050E1A`) base, not pure black

### Typography

The typographic system pairs **serif display** with **sans-serif UI** and **Devanagari script**:

| Role | Family | Usage |
|---|---|---|
| **Display** | Newsreader (serif) | Page titles, hero greetings, card titles, stat values, drawer headings |
| **UI** | Inter (sans-serif) | Body text, labels, buttons, navigation, form fields |
| **Hindi/Sanskrit** | Tiro Devanagari Hindi | Bilingual labels, section names, kickers, watermarks |
| **Monospace** | JetBrains Mono | Task IDs (`KAR-104`), counts, timestamps, code |

Key type patterns:
- Hero H1: `clamp(40px, 5vw, 64px)`, weight 400, italic greeting + name
- Page H1: `clamp(32px, 4vw, 44px)`, weight 400, with Devanagari suffix in `--k-primary`
- Card titles: 18px Newsreader, weight 500
- Stat values: 44px Newsreader, weight 400
- Kickers: 11px Inter, weight 700, `letter-spacing: 0.22em`, uppercase, `--k-mid` color
- Body: 14px Inter, weight 400, `line-height: 1.5`
- Task row titles: 13.5px Inter, weight 500
- Task IDs: 11px JetBrains Mono
- Section labels on sidebar: 9px uppercase, `letter-spacing: 0.22em`

### Spacing

4px base grid with 8 named steps: 4, 8, 12, 16, 20, 28, 40, 56.
Two density modes:
- **Comfy** (default): `--row-h: 48px`, standard spacing
- **Compact**: Row height 36px, spacing steps shrink ~25%

### Corner radii

- `--r-sm: 8px` — buttons, chips, small controls
- `--r-md: 12px` — cards, stat tiles, kanban cards
- `--r-lg: 18px` — major cards, table wraps
- `--r-xl: 22px` — hero section

### Shadows

Three levels, all warm-toned (not pure black):
- **sm:** Subtle lift for cards at rest
- **md:** Hover state, elevated cards
- **lg:** Overlays, drawers, modals

### Borders & rules

- Borders use warm golden-beige tones (`--rule: #E2DCC9`), never gray
- Dashed rules (`border-bottom: 1px dashed var(--rule-soft)`) separate items within cards
- Solid rules separate sections and card headers
- Color bars (4px wide, rounded) indicate status/project/priority with direct color

### Backgrounds & surfaces

- **No gradients on backgrounds** except the sidebar's subtle radial glow decorations
- **No images or patterns** as page backgrounds
- Cards sit on `--surface` (slightly warmer than `--bg`)
- Hero section uses a subtle vertical gradient from `--surface` to `--bg`
- Large Devanagari watermark (कर्तव्य) at 7% opacity in the hero section

### Hover & press states

- **Cards/rows:** Background shifts to `--rule-soft` on hover; kanban cards lift 1px with `--shadow-md`
- **Buttons (primary):** `translateY(-1px)` on hover
- **Buttons (ghost):** Background fills to `--surface`, border strengthens
- **Sidebar items:** Background fills `--side-hover`, text brightens
- **Links:** Underline on hover with `text-underline-offset: 3px`
- No opacity-based hovers; no scale transforms except `-1px` lift

### Animation

- Drawer slide-in: `0.2s cubic-bezier(.2,.7,.3,1)`, translateX from 8%
- Scrim fade: `0.15s ease-out`
- Progress bars: `0.4s` transition on width
- Card hover lift: `translateY(-1px)` or `translateY(-2px)`, no bounce
- No infinite animations; no decorative loops
- Respect `prefers-reduced-motion`

### Layout

- App shell: CSS Grid, `auto 1fr` columns (sidebar + main)
- Content area: max-width `1400px`, centered, `gap: 28px` flex-column
- Two-column layouts: `1.6fr / 1fr` grid
- Stats: 4-column grid
- Project/team grids: `auto-fill, minmax(280px, 1fr)`
- Kanban: 4-column grid, scrolls horizontally below 1280px

### Breakpoints

- `≤1280px`: Kanban → horizontal scroll
- `≤1100px`: Two-column → single column, stats → 2-column, watermark shrinks
- `≤720px`: Stats → 2-column, board → 1-column, search hidden

---

## Content Fundamentals

### Tone & voice

Kartavya's copy is **concise, professional, warm** — never playful or casual. It speaks to Indian business professionals who value efficiency and clarity.

- **First person plural** avoided; labels are direct and factual
- **Second person** ("You have 4 open tasks") for dashboard; otherwise neutral labels
- Page ledes are brief, informative sentences: "The list of what's worth doing today."
- No exclamation marks in UI copy
- No emoji anywhere in the interface

### Bilingual labels

Every section, page header, card title, navigation item, and status has a **paired Devanagari label** alongside English. This is a core brand element, not decorative:

- Page headers: `Tasks` + `कर्तव्य` (in teal/primary color)
- Sidebar sections: `WORKSPACE` + `कार्यक्षेत्र`
- Card titles: `"My tasks today"` + `"आज के कार्य"`
- Nav items show both: `Today · अद्य`
- Status columns: `In progress` + `चालू`

The Hindi/Sanskrit labels use `--font-hindi` (Tiro Devanagari Hindi) and are typically rendered at a slightly smaller or matching size in `--ink-3` or `--k-primary`.

### Casing conventions

- **Kickers:** ALL CAPS, `letter-spacing: 0.22em` (e.g., `WORKSPACE`, `REVIEW`)
- **Page titles:** Title Case in display serif (e.g., `Approvals`)
- **Card titles:** Sentence case (e.g., `My tasks today`)
- **Labels:** ALL CAPS, smaller size (e.g., `DUE TODAY`, `TASKS`, `DONE`)
- **Buttons:** Sentence case (e.g., `New task`, `Approve`)
- **Status chips:** Title Case (e.g., `In Progress`, `To Do`)

### IDs & monospace

Task IDs follow the pattern `KAR-###` (e.g., `KAR-104`), always rendered in `--font-mono` at a smaller size with muted color.

### Cultural elements

- Sanskrit/Hindi quotes appear as citations: `"कर्तव्ये अधिकारस्ते…"` — Bhagavad Gita 2.47
- Hindu calendar dates shown in hero: Vikram Samvat year, Tithi
- Week days in Devanagari: सोम, मंगल, बुध, गुरु, शुक्र, शनि, रवि
- Brand tagline: "by Aekam Inc" (small, uppercase, muted)

---

## Iconography

- **Icon system:** Inline SVG, stroke-based, 16×16 viewBox, `strokeWidth="1.4"`
- **Production lib:** `lucide-react` (already in `package.json`)
- The prototype defines a custom set of 15 nav icons in `chrome.jsx` — stroke-based SVGs matching Lucide's weight and style
- **No icon font** — all icons are inline SVG elements
- **No emoji** used anywhere
- **No decorative illustrations** — the UI is text-forward

### Nav icon set

dashboard, projects, tasks, approvals, activity, automations, time, templates, reports, teams, categories, notifications, inbox, admin, logout — all 16×16 stroke SVGs.

---

## Component inventory

### Editorial primitives (`components/editorial/`)

| Component | Description |
|---|---|
| `Hero` | Dashboard greeting with watermark, date line, week strip |
| `PageHeader` | Kicker + display title + Sanskrit + lede + right actions |
| `Card` | Surface container with serif title + Sanskrit + body |
| `StatTile` | Metric card with label, large value, sub text, color variant |
| `DueChip` | Pill showing relative due date with danger/warn/normal/muted tones |
| `StatusChip` | Colored dot + label chip for task/approval status |
| `PriorityDot` | Colored circle for urgent/high/medium/low |
| `ProjectTag` | Dot + name + optional Sanskrit label |
| `AvatarStack` | Overlapping initials circles with +N overflow |
| `WeekStrip` | 7-day Hindi calendar strip with task dots |
| `Citation` | Sanskrit quote with left border accent |

### Chrome (`components/layout/`)

| Component | Description |
|---|---|
| `Sidebar` | Dark ink sidebar with bilingual grouped nav, brand mark, user footer |
| `Topbar` | Breadcrumb (कर्तव्य / Page), pill search, notification + new task buttons |
| `AppShell` | Grid layout wrapper with sidebar + topbar + content outlet |

### Controls

| Component | Description |
|---|---|
| `Button` | Primary (gradient), ghost (outline), small variant |
| `IconButton` | 34×34 square with notification dot |
| `SegmentedControl` | Pill-shaped radio group with active highlight |
| `Input` | Text field with focus ring in accent color |
| `Select/Field` | Label + native select with custom arrow |

### Composite patterns

| Pattern | Description |
|---|---|
| `TaskRow` | Grid row: priority dot, ID, title, project tag, avatars, due chip |
| `KanbanCard` | Card with ID, priority, title, footer (avatars + meta) |
| `KanbanColumn` | Column with color bar, title, Sanskrit, count, card list |
| `ProjectCard` | Card with color bar, Sanskrit name, client, stats, progress bar |
| `MemberCard` | Card with avatar, name, role badge, stats, recent tasks |
| `InboxRow` | Row with avatar, kind badge, summary, time, actions |
| `ApprovalCard` | Card with rail color, meta, title, requester, actions |
| `TaskDrawer` | Right-side panel with header, title, props grid, tabs, body |

---

## File index

```
├── readme.md                    ← this file
├── styles.css                   ← root CSS entry (imports only)
├── SKILL.md                     ← agent skill definition
├── tokens/
│   ├── colors.css               ← brand accents, canvas, ink, semantic
│   ├── typography.css           ← font stacks, type scale, weights
│   ├── spacing.css              ← spacing grid, radii, density
│   ├── shadows.css              ← elevation levels
│   └── themes.css               ← dark theme overrides
├── guidelines/                  ← foundation specimen cards
│   ├── brand-identity.html
│   ├── colors-brand.html
│   ├── colors-canvas.html
│   ├── colors-semantic.html
│   ├── colors-sidebar.html
│   ├── type-display.html
│   ├── type-ui.html
│   ├── type-hindi.html
│   ├── type-mono.html
│   ├── spacing-scale.html
│   ├── spacing-density.html
│   ├── radii.html
│   ├── shadows.html
│   ├── status-colors.html
│   └── accent-presets.html
├── components/
│   ├── core/                    ← Button, IconButton, Input, Avatar, Badge
│   ├── editorial/               ← Hero, PageHeader, Card, StatTile, Citation
│   ├── data-display/            ← StatusChip, DueChip, PriorityDot, ProjectTag
│   ├── navigation/              ← Sidebar, Topbar, SegmentedControl
│   └── composite/               ← TaskRow, KanbanCard, ProjectCard, MemberCard
├── ui_kits/
│   └── app/                     ← Full interactive Kartavya web app recreation
│       ├── index.html
│       ├── App.jsx
│       ├── Screens.jsx
│       └── Chrome.jsx
└── assets/
    └── (icon SVGs, brand mark)
```
