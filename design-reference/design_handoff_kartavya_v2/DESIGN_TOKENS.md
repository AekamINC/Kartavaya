# Design Tokens — Full Reference

Every CSS variable used by the editorial design system. Copy this into
`frontend/src/styles/editorial.css` verbatim — these names are what every
class in the prototype CSS reads from.

## Brand accents (carry over from existing `tokens.css`)

```css
:root {
  --k-primary: #05b7aa;
  --k-mid:     #03a1b6;
  --k-deep:    #0082c6;
  --k-grad:    linear-gradient(90deg, #0082c6, #03a1b6, #05b7aa);
  --k-gradD:   linear-gradient(135deg, #0082c6, #05b7aa);
}
```

The `CustomizePanel` swaps these via `document.documentElement.style.setProperty()`
for the four accent presets. Don't hardcode `#05b7aa` anywhere — always use
`var(--k-primary)`.

### Accent presets (matches existing `CustomizePanel.jsx`)

| Preset | `--k-primary` | `--k-mid` | `--k-deep` | Gradient (90deg) |
|---|---|---|---|---|
| **teal** (default) | `#05b7aa` | `#03a1b6` | `#0082c6` | `#0082c6 → #03a1b6 → #05b7aa` |
| **blue** | `#0082c6` | `#1d6fcf` | `#0a3d91` | `#0a3d91 → #0082c6 → #1d6fcf` |
| **saffron** | `#d97706` | `#ea580c` | `#9a3412` | `#9a3412 → #d97706 → #f59e0b` |
| **indigo** | `#6366f1` | `#4f46e5` | `#3730a3` | `#3730a3 → #4f46e5 → #818cf8` |

## Light theme (default — paper canvas)

```css
:root {
  --bg:        #F6F3EC;
  --bg-soft:   #F0ECDF;
  --surface:   #FCFAF5;
  --surface-2: #FFFFFF;

  --ink:       #1A2230;
  --ink-2:     #4A5468;
  --ink-3:     #6E7B91;
  --ink-faint: #A5B0C2;

  --rule:        #E2DCC9;
  --rule-soft:   #EFE9D8;
  --rule-strong: #C8C0AA;

  --shadow-sm: 0 1px 0 rgba(20,30,50,.04), 0 1px 3px rgba(20,30,50,.06);
  --shadow-md: 0 1px 0 rgba(20,30,50,.04), 0 8px 24px -10px rgba(20,30,50,.18);
  --shadow-lg: 0 30px 60px -30px rgba(10,20,40,.35);

  --side-bg:        #050E1A;
  --side-fg:        rgba(255,255,255,.72);
  --side-fg-mute:   rgba(255,255,255,.42);
  --side-fg-faint:  rgba(255,255,255,.22);
  --side-rule:      rgba(255,255,255,.06);
  --side-rule-2:    rgba(255,255,255,.12);
  --side-hover:     rgba(255,255,255,.06);
  --side-active:    rgba(5, 183, 170, .16);

  --danger: #C0392B;
  --warn:   #B06A00;
  --ok:     #0A7A6E;
}
```

## Dark theme

```css
[data-theme="dark"] {
  --bg:        #050E1A;
  --bg-soft:   #0A1424;
  --surface:   #0B1828;
  --surface-2: #122035;

  --ink:       #E6EEFC;
  --ink-2:     #B0BDD4;
  --ink-3:     #7D8BA6;
  --ink-faint: #4A5878;

  --rule:        #1A2A45;
  --rule-soft:   #122035;
  --rule-strong: #233655;

  --shadow-sm: 0 1px 0 rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.4);
  --shadow-md: 0 1px 0 rgba(0,0,0,.4), 0 8px 24px -10px rgba(0,0,0,.6);
  --shadow-lg: 0 30px 60px -30px rgba(0,0,0,.8);
}
```

## Typography

```css
:root {
  --font-display: "Newsreader", Georgia, serif;
  --font-ui:      Inter, ui-sans-serif, system-ui, sans-serif;
  --font-hindi:   "Tiro Devanagari Hindi", "Noto Serif Devanagari", "Newsreader", serif;
  --font-mono:    "JetBrains Mono", ui-monospace, "Menlo", monospace;
}
```

Google Fonts (paste into `frontend/public/index.html` `<head>`):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,300;1,6..72,400&family=Inter:wght@400;500;600;700&family=Tiro+Devanagari+Hindi:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Spectral:ital,wght@0,300;0,400;0,500;0,600;1,400&family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&display=swap">
```

Spectral, Instrument Serif, and Geist are needed only if the user keeps the
"font" tweak option (newsreader/spectral/inter/geist). If you trim the
tweak panel to newsreader-only, drop those families from the URL.

### Type scale

| Class | Family | Size | Weight | Line height | Use |
|---|---|---|---|---|---|
| `.k-hero__h1` | `--font-display` | `clamp(40px, 5vw, 64px)` | 400 | 1.05 | Dashboard greeting only |
| `.k-pageh__h1` | `--font-display` | `clamp(32px, 4vw, 44px)` | 400 | 1 | Every non-dashboard page title |
| `.k-card__title` | `--font-display` | 18px | 500 | 1.3 | Card titles |
| `.k-stat__val` | `--font-display` | 44px | 400 | 1 | Stat tile numbers |
| `.k-dr__title h2` | `--font-display` | 26px | 500 | 1.2 | Drawer title |
| Body | `--font-ui` | 14px | 400 | 1.5 | Default text |
| `.k-taskrow__title`, `.k-trow__title`, `.k-bcard__title` | `--font-ui` | 13.5px | 500 | 1.4 | Task titles in rows + cards |
| `.k-pageh__kicker` | `--font-ui` | 11px | 700 | — | `letter-spacing: .22em; text-transform: uppercase` |
| `.k-trow__id`, `.k-bcard__id`, `.k-dr__id` | `--font-mono` | 11px | 400 | — | Task ID prefix (`KAR-104`) |
| `.k-card__sans`, `.k-pageh__sans`, etc. | `--font-hindi` | varies | 400 | — | Devanagari pair labels |

## Spacing scale

```css
:root {
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 28px;
  --sp-7: 40px;
  --sp-8: 56px;
}

[data-density="compact"] {
  --sp-1: 3px;
  --sp-2: 6px;
  --sp-3: 9px;
  --sp-4: 12px;
  --sp-5: 14px;
  --sp-6: 20px;
  --sp-7: 28px;
  --row-h: 36px;
}

[data-density="comfy"] {
  --row-h: 48px;
}
```

## Radius scale

```css
:root {
  --r-sm: 8px;    /* buttons, chips */
  --r-md: 12px;   /* small cards, stat tiles */
  --r-lg: 18px;   /* major cards */
  --r-xl: 22px;   /* hero */
}
```

## Status / priority colors

These are used by `<StatusChip>`, `<PriorityDot>`, `<DueChip>`. The component
sets a `--c` variable on its root and the class reads from it.

### Status (Kanban columns)

| Key | Color | Devanagari label |
|---|---|---|
| `todo` | `#94a3b8` (slate) | कार्य |
| `in_progress` | `#0082c6` (k-deep) | चालू |
| `in_review` | `#a78bfa` (violet-300) | समीक्षा |
| `done` | `#05b7aa` (k-primary) | सम्पन्न |

### Priority

| Key | Color | Label |
|---|---|---|
| `urgent` | `#C0392B` (danger) | Urgent |
| `high` | `#B06A00` (warn) | High |
| `medium` | `#0082c6` (k-deep) | Medium |
| `low` | `#6E7B91` (ink-3) | Low |

### Due chip variants

| Variant | Trigger | Border | Background |
|---|---|---|---|
| `danger` | `due < today` (overdue) | mix(danger 30%, rule) | mix(danger 8%, surface) |
| `warn` | `due ≤ today + 1` | mix(warn 30%, rule) | mix(warn 8%, surface) |
| `normal` | within 7 days | `--rule-strong` | `--surface` |
| `muted` | further out | `--rule` | `--surface` |

## Role badges (Team page, Admin members tab)

| Role | Background | Foreground |
|---|---|---|
| `admin` | `color-mix(in srgb, var(--k-deep) 14%, transparent)` | `var(--k-deep)` |
| `member` | `color-mix(in srgb, var(--k-primary) 14%, transparent)` | `var(--k-primary)` |
| `client` | `color-mix(in srgb, #8b5cf6 14%, transparent)` | `#8b5cf6` |

## Inbox notification kinds

| Kind | Color |
|---|---|
| `mention` | `var(--k-deep)` |
| `assign` | `var(--ok)` |
| `approval` | `var(--warn)` |

## Breakpoints

```css
@media (max-width: 1280px) { /* Kanban → horizontal scroll */ }
@media (max-width: 1100px) { /* twocol → 1col, stats → 2col, watermark shrinks */ }
@media (max-width:  720px) { /* stats → 1col, board → 1col, search hidden */ }
```
