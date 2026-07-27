# Dashboard + Tasks — pixel and type, measured

Branch `design/dashboard-tasks-pixel-type`. Surface: `pages/DashboardPage.jsx`,
`pages/TasksListPage.jsx`, `styles/editorial.css`. Lens: **measurement**. Two
siblings own structure and motion; nothing here changes what exists or how it
moves, only what it measures.

## How these numbers were produced

The reference was **rendered, not read**. `design-reference/Kartavaya Redesign/`
is a runnable React harness; it was served alongside a probe page carrying the
build's own stylesheets and the build's exact class names, and
`getComputedStyle` was read on both sides for matched selector pairs.

The shared browser and the shared `:5173` dev server are contended by sibling
agents — every navigation was being stolen mid-run. So the measurement runs in a
**private headless Chrome** against a **private static server**, and the page
POSTs its own results back to that server. Nothing depends on a tab surviving.

```
scratchpad/pixserve.js        static server (5243): /ref, /css, /probe, POST /collect
scratchpad/build.html         build CSS + build class names, real shell chain
scratchpad/a9dd-measure.html  loads both in an iframe, measures, POSTs
scratchpad/a9dd-deva.html     walks every node whose OWN text is Devanagari
scratchpad/a9dd-diff.js       emits the tables below
```

`chrome.exe --headless=new --virtual-time-budget=30000 --dump-dom <url>`

---

## 1. The baseline was wrong, and it invalidated every prior spacing comparison

The harness ships `data-density="cozy"` on `<html>`. **The build has no `cozy`.**

`CustomizePanel.jsx:76` defaults `density: 'comfy'`, and
`pages/customize/TabLayout.jsx:35` offers only `Compact` and `Comfy`. The middle
tier the whole design is drawn at cannot be selected, and the loosest tier is
what every user gets.

The tell that this is a dropped tier rather than a decision: the build's
**unlabelled `:root` block already holds cozy's exact numbers.**

| token | build `:root` | reference `[data-density="cozy"]` | |
|---|---|---|---|
| `--row-h` | 44px | 44px | same |
| `--pad-page` | 28px | 28px | same |
| `--pad-card` | 18px | 18px | same |
| `--gap-section` | 22px | 22px | same |
| `--gap-tight` | 10px | 10px | same |

Measured at the two defaults, every spacing token is loose:

| token | reference (cozy) | build (default comfy) | delta |
|---|---|---|---|
| `--pad-page` | `28px` | `32px` | +4 |
| `--pad-card` | `18px` | `20px` | +2 |
| `--gap-section` | `22px` | `26px` | +4 |
| `--gap-tight` | `10px` | `12px` | +2 |
| `--row-h` | `44px` | `48px` | +4 |
| `--radius-base` | `12px` | `10px` | −2 |

**Forcing the build to `cozy` makes every density token match the reference
exactly** — `--pad-page`, `--pad-card`, `--gap-section`, `--gap-tight`,
`--row-h`, `--r-xs/sm/md/lg` all identical. So the density gap is entirely a
default-and-missing-option problem, not a rule problem.

Every table below is therefore reported **against the build forced to cozy**, so
what remains is a real rule difference rather than the baseline.

### `--radius-base` — reported, not changed

Reference 12px, build 10px, and the build's radius control offers `4 | 10 | 20`
with a comment stating the default is deliberately one of the options. Changing
it moves every corner in the product, which is outside this surface. Recorded
for whoever owns the global token set.

---

## 2. The type scale is a different mechanism reaching the same numbers

Not a defect. The reference states the scale literally; the build derives it
from the user's font-size control. At the default 14px they agree:

| token | reference | build formula | build @14px |
|---|---|---|---|
| `--t-display` | `40px` | `calc(14px * 2.86)` | 40.04px |
| `--t-headline` | `28px` | `calc(14px * 2)` | 28px |
| `--t-title-lg` | `20px` | `calc(14px * 1.43)` | 20.02px |
| `--t-title` | `16px` | `calc(14px * 1.14)` | 15.96px |
| `--t-body` | `14px` | `14px` | 14px |
| `--t-body-sm` | `13px` | `calc(14px * .93)` | 13.02px |
| `--t-label` | `12px` | `max(11.5px, calc(14px * .86))` | 12.04px |
| `--t-label-sm` | `11px` | `max(11px, calc(14px * .79))` | 11.06px |

The build's version is the better one — it keeps the scale proportional when the
user changes font size, and floors the two smallest steps at 11px. **Where the
build then hardcodes a literal instead of consuming these tokens, that is a
defect, and §4 lists each one.**

---

## 3. Devanagari tracking — the reference is defective, the build is right

The brief flagged this as load-bearing. Measured on every node whose **own** text
node contains Devanagari (`[ऀ-ॿ]`), on both pages, both sides:

| side | Devanagari nodes | tracked or uppercased |
|---|---|---|
| reference Dashboard | 67 | **2** |
| reference Tasks | 50 | **2** |
| build Dashboard + Tasks | 15 | **0** |

The two reference offenders, on both screens:

| selector | text | font-size | letter-spacing | text-transform | resolved family |
|---|---|---|---|---|---|
| `.ph__kick` | `Workspace · कार्यक्षेत्र` | 10.5px | **2.1px (0.2em)** | **uppercase** | **Public Sans** (Latin) |
| `.ph__hi` | `कर्तव्य` | 28px | **−0.56px (−0.02em)** | none | Tiro Devanagari Hindi |

`app.css:142` — `.ph__kick` sets `letter-spacing: .2em` and `text-transform:
uppercase` on a single node that carries Latin **and** Devanagari, and declares
no family, so the Devanagari inherits `--font-ui`. Three violations of
`24-bilingual-devanagari.md` in one line.

`app.css:144` — `.ph__hi` sets family and colour but **never resets
letter-spacing**, so it inherits `−.02em` from `.ph__h1:143`.

The build cannot have this bug by construction. `editorial.css:2562`:

```css
[lang="hi"], [lang="sa"], [lang="gu"] { letter-spacing: 0 !important; }
```

plus `:2556` giving Devanagari `line-height: calc(var(--line-height-base) * 1.18)`
for the शिरोरेखा. A declarative guard that cannot be forgotten per-rule.

**Recorded as a reference spec defect. Not ported.** Accessibility and script
correctness beat fidelity.

### But the guard is `lang`-keyed, and five render sites on this surface omit it

The guard only fires on `[lang]`. `StatTile.jsx:52` and `PageHeader.jsx:61`
already carry `lang="hi"` — the convention exists. These five render Devanagari
without it, and all five are on Dashboard or Tasks:

| file | line | class | text |
|---|---|---|---|
| `components/editorial/Card.jsx` | 12 | `.k-card__sans` | every Dashboard card sub-title |
| `pages/TasksListPage.jsx` | 340 | `.k-group__sans` | अत्यावश्यक / उच्च / मध्यम / न्यून |
| `components/editorial/WeekStrip.jsx` | 27 | `.k-week__hi` | सोम…रवि |
| `components/editorial/Hero.jsx` | 28 | `.k-hero__samvat` | गुरुवार · विक्रम संवत् |
| `components/editorial/ProjectTag.jsx` | 9 | `.k-ptag__sans` | project sub-labels |

They are not visibly tracked today only because no ancestor happens to track
them. They are missing the Devanagari **leading**, and they are one tracked
ancestor away from the reference's bug. Fixed — see §5.

---

## 4. Measured rule differences, build @cozy vs reference

Only genuine rule differences; baseline effects removed.

### Page and section rhythm

| element | property | reference | build | note |
|---|---|---|---|---|
| `.kv__content` | padding | `28px` | `28px` | matches at cozy |
| `.screen` → `.k-screen` | `gap` | `22px` `var(--gap-section)` | `24px` `var(--sp-6)` | **hardcoded; ignores density** |
| `.two` → `.k-twocol` | `gap` | `22px` `var(--gap-section)` | `20px` | **hardcoded** |
| `.col` → `.k-col` | `gap` | `22px` `var(--gap-section)` | `20px` `var(--sp-5)` | **hardcoded** |

`today.css` already documents the `.k-screen` one — it worked *around* it by
moving the skeleton to `--sp-6` rather than fixing the rule, so the page and its
skeleton agree on the wrong number. `--gap-section` is defined by all three
density tiers and **consumed by nothing**.

### Stat tiles

| element | property | reference | build | note |
|---|---|---|---|---|
| `.stats` → `.k-stats` | `gap` | `10px` `var(--gap-tight)` | `11px` | hardcoded |
| | `grid` min | `180px` | `196px` | wraps early |
| | `margin-top` | `0` | `20px` | **added to the parent's gap** |
| `.stat` → `.k-stat` | `padding` | `18px` `var(--pad-card)` | `16px 17px` | hardcoded |
| | `border-radius` | `17.4px` `var(--r-lg)` | `12px` `var(--r-md)` | wrong step |
| | `gap` | `3px` | `4px` | |
| `.stat__lbl` → `.k-stat__lbl` | `font-size` | `10px` | `9.5px` | |
| | `letter-spacing` | `.15em` (1.5px) | `.16em` (1.52px) | |
| | `gap` | `8px` | `7px` | |
| `.stat__hi` → `.k-stat__hi` | `font-size` | `12px` | `11px` | |
| `.stat__v` → `.k-stat__val` | `font-size` | `34px` | `31px` | |
| | `line-height` | `1.16` (39.44px) | `1.1` (34.09px) | |
| | `letter-spacing` | `−.025em` | `−.03em` | |
| | `margin-top` | `6px` | `8px` | |

`.k-stats { margin-top: var(--sp-5) }` is in `kartavaya-design.css:801`;
`editorial.css:913` redeclares `display` and `gap` but not `margin-top`, so 20px
leaks through **on top of** `.k-screen`'s own gap. Two rules, one gap.

### Cards

| element | property | reference | build |
|---|---|---|---|
| `.card__head` → `.k-card__head` | `padding` | `18px 18px 12.6px` — `var(--pad-card)` with a `.7` bottom | `16px 20px` |
| `.card__body` → `.k-card__body` | `padding` | `0 18px 18px` | `16px 20px 20px` |
| `.card__title` → `.k-card__title` | `font-size` | `20px` `var(--t-title-lg)` | `18px` |
| | `letter-spacing` | `−.01em` | `−.005em` |
| | `line-height` | `1.4` | `1.5` |
| `.card__hi` → `.k-card__sans` | `color` | `var(--primary-text)` | `var(--ink-3)` |

The card head/body padding pair is one shape in the reference — `--pad-card`
everywhere with a `× .7` bottom on the head, so the head's bottom gap is
deliberately tighter than its top. The build uses two unrelated spacing steps and
loses that relationship.

### Table — Tasks

| element | property | reference | build |
|---|---|---|---|
| `.tbl__head` → `.k-table__head` | `padding` | `0 16px` | `10px 18px` |
| | `height` | `38px` fixed | `36.75px` from padding |
| | `font-size` | `10px` | `10.5px` |
| | `letter-spacing` | `.14em` (1.4px) | `.16em` (1.68px) |
| | `gap` | `14px` | `16px` |
| `.tbl__row` → `.k-trow` | `padding` | `0 16px` | `0 18px` |
| | `gap` | `14px` | `16px` |
| | `min-height` | `44px` `var(--row-h)` | `44px` | matches at cozy |
| `.tbl__group` → `.k-group__head` | `font-size` | `11px` | `14px` |
| | `font-weight` | `700` | `400` |
| | `letter-spacing` | `.1em` (1.1px) | `normal` |
| | `text-transform` | `uppercase` | `none` |
| | `padding` | `9px 16px` | `10px 18px` |
| `.tbl__group-n` → `.k-group__count` | `font-size` | `11px` | `12px` |
| | `font-weight` | `700` | `400` |
| `.tbl__t` → `.k-trow__title` | `font-size` | `13px` `var(--t-body-sm)` | `13.5px` |
| `.tbl__id` → `.k-trow__id` | `font-size` | `10.5px` | `11px` |

The group header is the largest single divergence on Tasks: the reference draws
it as a 11px uppercase tracked bold eyebrow, the build as 14px regular body text
— it reads as a row rather than as a section rule.

### Chips and segmented control

| element | property | reference | build |
|---|---|---|---|
| `.seg` → `.k-segctrl` | `border-radius` | `6.96px` `var(--r-sm)` | `10px` |
| | `border` | none | `1px solid` |
| | `padding` / `gap` | `3px` / `2px` | — / `normal` |
| | `height` | `34px` | `36px` |
| `.seg__b.on` → `.k-segctrl__btn.is-active` | `box-shadow` | `var(--shadow-1)` | `none` |
| `.seg__n` → `.k-segctrl__count` | `font-size` | `10.5px` | `11.06px` |
| `.tag` → `.k-statuschip` | `border-radius` | `999px` | `99px` |
| | `font-size` | `11.5px` | `12px` |
| | `font-weight` | `600` | `500` |
| | `border` | none | `1px solid` |
| | `height` | `19px` | `21px` |

---

## 5. Not comparable — recorded, not touched

**The Dashboard header is a different component in each.** The reference renders
the same `PH` header every other screen uses (`.ph`, transparent, 110px). The
build renders a bespoke `.k-hero` — tonal background, 1px border, 17.4px radius,
a watermark, 254px tall. That is a structural decision, not a measurement, and it
belongs to the sibling holding structure. Every `ph` row in the Dashboard tables
is that mismatch, not a defect.

**Stat tile count.** Reference Dashboard renders five tiles (Pipeline,
Receivables, Collected MTD, GST due, Team in today), the build renders four
(Open, Due today, Overdue, Done this week). Content, not pixels.

**`--font-ui`.** Reference `"Public Sans", ui-sans-serif, …`; build `"Inter",
…`. Public Sans is **never loaded anywhere in the reference** — not by
`tokens.css`'s `@import`, not by the harness's Google Fonts link — so the
reference's entire UI face silently falls back to system sans. `tokens.css` does
import Inter and then never uses it. The build's reading is the correct one.
Recorded as a second reference spec defect.

---

## 6. Changes made

See the next section of this report, appended as each lands.
