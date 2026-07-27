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

## 6. A second Devanagari defect, in the build this time

The same probe that cleared the build on tracking caught it on **weight**.

| node | family | declared weight | face ships |
|---|---|---|---|
| `.k-hero__samvat` | Tiro Devanagari Hindi | **600** | 400 only |

`editorial.css:828` `.k-hero__meta` is `font-weight: 600`; `.k-hero__samvat`
reset the family, the tracking and the case but **not** the weight, so गुरुवार
and विक्रम संवत् on Today asked the rasteriser for a weight the font does not
have. It answers by smearing — the शिरोरेखा thickens unevenly.

`editorial.css` already documents exactly this failure for four other label
classes; `.k-hero__samvat` is a fifth it does not name. Fixed.

---

## 7. Changes made

Ten files. Every number below was measured before and after.

### Baseline

| file | change |
|---|---|
| `styles/kartavaya-design.css` | added `[data-density="cozy"]` — the tier the design is drawn at |
| `components/CustomizePanel.jsx` | `DEFAULTS.density` `comfy` → `cozy`; one-time migration for stored prefs |
| `pages/customize/TabLayout.jsx` | Density control now offers three tiers, not two |

The migration is deliberate and has a cost: `setPrefs` persists the whole prefs
object, so `comfy` is frozen in storage for anyone who ever changed any setting,
and changing `DEFAULTS` alone would have fixed new installs only. It runs once,
behind its own flag. Someone who deliberately chose Comfy is moved to Cozy one
time — reversible in two clicks, and their next choice sticks. The old default
and a deliberate choice are the same three bytes in storage, so there is no
version of this that touches only one of them.

### Two rules leaking from `kartavaya-design.css`

Both are cases where `editorial.css` redeclares a selector and overrides some
properties but not all, so the older declaration survives in the gaps.

| selector | leaked | effect | fix |
|---|---|---|---|
| `.k-card` | `padding: var(--sp-5)` | stacked with `__head`/`__body` — cards inset **~38px** instead of 18px, and the head's hairline stopped short of the card edge | `:has(> .k-card__head/__body) { padding: 0 }` |
| `.k-col` | `background`, `border-radius`, `min-height: 200px` from a **kanban** column whose `.k-col__head` no JSX renders | Today's two layout columns and both skeletons drew tinted rounded panels behind content meant to sit on the page | explicit resets |

`.k-card` is scoped with `:has()` rather than zeroed because both shapes exist:
twelve call sites wrap bare content in `.k-card` and legitimately want the 20px.
`:has()` was already in use in `mobile-responsive.css`.

### Literals replaced by the density tokens the build already defines

| selector | was | now |
|---|---|---|
| `.k-screen` | `gap: var(--sp-6)` 24px | `var(--gap-section)` 22px |
| `.k-twocol` | `gap: var(--sp-5)`, `1.6fr` | `var(--gap-section)`, `1.65fr` |
| `.k-col` | `gap: var(--sp-5)` | `var(--gap-section)` |
| `.k-stats` | `gap: 11px`, `minmax(196px)`, leaked `margin-top: 20px` | `var(--gap-tight)`, `minmax(180px)`, `margin-top: 0` |
| `.k-stat` | `padding: 16px 17px`, `radius: var(--r-md)` | `var(--pad-card)`, `var(--r-lg)`, `display:flex` + `gap:3px` |
| `.k-card__head` | `var(--sp-4) var(--sp-5)` | `var(--pad-card) var(--pad-card) calc(var(--pad-card) * .7)` |
| `.k-card__body` | `var(--sp-4) var(--sp-5) var(--sp-5)` | `calc(var(--pad-card) * .7) var(--pad-card) var(--pad-card)` |
| `.k-tasklist` | negative margins in `--sp-*` | same, in `--pad-card`, so the two cannot drift |
| `.k-table__head` | `padding: 10px 18px`, `gap: 16px` | `0 16px`, `gap: 14px`, `min-height: 38px`, `align-items: center` |
| `.k-trow` | `padding: 0 18px`, `gap: 16px`, `--row-h` fallback **48px** | `0 16px`, `gap: 14px`, fallback `44px` |
| `.k-trow__cell` | `gap: 10px` | `9px` |
| `.k-group__head` | `padding: 10px 18px` | `9px 16px` |
| `today.css` skeletons | pinned to `--sp-6` to match the old wrong gap | `--gap-section` |

`--gap-section` was declared by all three density tiers and consumed by nothing.
`.k-table__head` had no `align-items` at all, so the header labels sat at the top
of the band while the rows they head were centred.

### Type

| selector | was | now |
|---|---|---|
| `.k-stat__lbl` | `9.5px / .16em / gap 7px` | `10px / .15em / gap 8px` + `space-between` |
| `.k-stat__hi` | `11px` | `12px` |
| `.k-stat__val` | `31px / 1.1 / −.03em / mt 8px` | `34px / 1.16 / −.025em / mt 6px` |
| `.k-stat__sub` | `margin-top: 3px` stacking on the new gap | `0` |
| `.k-card__title` | `18px / −.005em` | `var(--t-title-lg)` / `−.01em` / `1.4` |
| `.k-group__title` | `16px` display serif 500 | `11px / 700 / .1em / uppercase` |
| `.k-group__sans` | `14px` | `12px`, `text-transform: none` |
| `.k-group__count` | `12px / 400` | `11px / 700 / ls 0` |
| `.k-trow__title` | `13.5px` | `var(--t-body-sm)` |
| `.k-trow__id` | `11px` | `10.5px` |
| `.k-hero__samvat` | inherited **600** into a 400-only face | `400` |

The group header was the largest visible divergence on Tasks: at 16px display
serif it read as another row rather than as the rule between two runs of rows.

### `lang="hi"` on five Devanagari render sites

`Card.jsx`, `WeekStrip.jsx`, `Hero.jsx` (samvat segments only), `ProjectTag.jsx`,
`TasksListPage.jsx`.

This is what makes the group-header change **safe**: `.k-group__title` is now
tracked at `.1em`, and अत्यावश्यक sits directly beside it. Without the attribute
the guard does not fire and the क्ष conjunct splits. The two edits are one edit.

---

## 8. Verified after the change

Same probe, same headless run.

**Every remaining difference is either intentional or an artefact of the
comparison. There are no unexplained residuals.**

| element | property | reference | build | why it stays |
|---|---|---|---|---|
| `.k-stat` | `background` | `#EEE9DC` tonal | `#FAF7F0` + 1px border + 2px accent bar | the build draws an outlined tile with a tone bar, the reference a flat tonal tile — a visual treatment, not a metric. Sibling's call. |
| `.k-stat__hi` | `line-height` | `18px` | `21.24px` | the build's `[lang="hi"]` ×1.18 Devanagari leading. **The build is right.** |
| `.k-card__body` | `padding-top` | `0` | `12.6px` | the build keeps a hairline under the card head, which the reference does not have; the gap is split around the rule rather than collapsed onto it |
| `.k-card__title` | `font-size` | `20px` | `20.02px` | fluid scale, `calc(14px * 1.43)` |
| `.k-trow__title` | `font-size` | `13px` | `13.02px` | fluid scale, `calc(14px * .93)` |
| `.k-group__head` | type | on the container | on `.k-group__title` | different DOM shape — the **child's** type now matches the reference container exactly: `11px / 16.5px / 1.1px / uppercase / 700` |
| `.k-trow` | `background` | zebra `nth-child(even)` | flat | the reference stripes rows, the build does not — visual treatment |
| `.k-c-task` | `gap` | `9px` | `12px` | one cell holding three things; base cell gap is now 9px |

Matched exactly after the change, having differed before:

`.kv__content` padding · `.k-screen` gap · `.k-twocol` gap · `.k-col` gap,
background, radius, min-height · `.k-stats` gap and margin · `.k-stat` padding
and radius · `.k-stat__lbl` size and tracking · `.k-stat__hi` size ·
`.k-stat__val` size, leading, tracking and margin · `.k-card` padding ·
`.k-card__head` padding · `.k-card__body` horizontal padding · `.k-table__head`
height (38px), padding, gap, size and tracking · `.k-trow` height (44px),
padding and gap · `.k-group__head` padding · `.k-group__title` full type ·
`.k-group__count` size and weight · `.k-trow__id` size.

### Devanagari, after

| side | Devanagari nodes | tracked | uppercased | synthesised weight |
|---|---|---|---|---|
| reference Dashboard | 67 | 2 | 1 | — |
| reference Tasks | 50 | 2 | 1 | — |
| **build, both pages** | **15** | **0** | **0** | **0** |

All fifteen resolve to Tiro Devanagari Hindi at its real 400.

### Gates

Run from `frontend/` in this worktree after merging `origin/staging`:

| gate | result |
|---|---|
| `check-tokens` | 340 declared, 235 referenced, **0 missing** |
| `check-classes` | 2125 selectors, 1448 classes used, **0 missing a rule** |
| `check-accent-contrast` | **ok** |
| `check-touch-targets` | **pass** — nothing under 44px without a mobile rule |
| `check-component-parity` | byte-identical to staging (3 missing roots, 17 declaration drift — all pre-existing) |
| `check-contrast` | **FAILS — pre-existing, not this change** |

`check-contrast` was verified against a pristine `origin/staging` extracted with
`git archive`, run with the same Node: **11 failures on staging, 11 on this
branch, and `diff` of the two sorted failure lists is empty.** None of the
eleven selectors (`.cbx`, `.av`, `.k-pill-high`, `.wahdr__ic`, `.k-badge`,
`.k-apcard__kind--creative`, three `.k-actitem__verb--*`, `.k-rule__status--on`)
appears anywhere in this branch's diff.

All eight touched JSX files parse clean under `@babel/parser` with the `jsx`
plugin.

### After merging staging

`origin/staging` moved 28 commits during this work and had to be merged three
times. The third merge conflicted, in three files, because **a sibling reached
the same `cozy` conclusion independently** — convergent findings from two
separate measurements of the same harness.

Conflicts resolved in the sibling's favour wherever they went further:

- **Density tiers.** They took `compact` and `comfy` from the reference's
  `tokens.css:228-230` verbatim (34/18/12/14/7 and 54/38/24/30/14), where I had
  only corrected the missing middle tier. Theirs is strictly more correct.
- **Radius.** They moved the options from `4 | 10 | 20` to `8 | 12 | 20` with
  default 12 — the divergence §1 recorded and deliberately left alone as global.
  Theirs, gladly.
- **Comments.** Theirs cite `App.jsx:3` and `Chrome.jsx:196` directly.

Two defects in that just-landed radius change, found because this branch owns
the migration path and re-measures:

1. **Stored radius stranded.** `setPrefs` persists the whole prefs object, so
   existing users hold `radius: 4` or `10` — values that now match **no option**.
   The control renders with nothing selected and their corners are stuck at a
   value they cannot see or change. The one-time migration is generalised to
   remap `4 → 8` and `10 → 12`; `20` was in both sets and is untouched.
2. **First-paint jump.** `:root --radius-base` was left at `10px` while the
   default moved to 12. `applyPrefs` writes the variable as an inline style, so
   every corner in the product rendered at 10px until React mounted, then
   snapped to 12px. `:root` now says 12px, and its comment — stale on both the
   default and the option list — says `8 | 12 | 20`.

Re-measured after all three merges. **The build's stylesheet-only default path
now equals the reference on every density and radius token**, before any JS runs:

| token | reference | build default |
|---|---|---|
| `--pad-page` | 28px | **28px** |
| `--pad-card` | 18px | **18px** |
| `--gap-section` | 22px | **22px** |
| `--gap-tight` | 10px | **10px** |
| `--row-h` | 44px | **44px** |
| `--radius-base` | 12px | **12px** |
| `--r-md` / `--r-lg` | 12px / ×1.45 | **12px / ×1.45** |

`.k-stat`, `.k-stat__lbl`, `.k-stat__val`, `.k-card`, `.k-card__head`,
`.k-table__head` and `.k-trow` all measure **identical** to their reference
counterparts on padding, radius and type. Table header band 38px against 38px;
row height 44px against 44px. The `.k-stat` background difference noted in §8
also resolved in the merge.

---

## 9. Left for others, deliberately

- **`--radius-base` 10px vs the reference's 12px.** Global; the build's radius
  control offers `4 | 10 | 20` with the default documented as one of the
  options. Moving it moves every corner in the product.
- **The Dashboard header.** `.k-hero` is a bespoke tonal card; the reference
  uses the same `PH` header as every other screen. Structure.
- **Stat tile treatment and row zebra striping.** Visual, above.
- **`.k-card__sans` colour** — reference `--primary-text`, build `--ink-3`.
- **Five stat tiles vs four**, and their subjects. Content.
- **Reference spec defects**, recorded so nobody ports them: Devanagari tracked
  in `.ph__kick` and `.ph__hi`, and `--font-ui: "Public Sans"` naming a family
  the reference never loads.

### Token rules from the brief — checked, and already clean

- `color: var(--primary)` — **zero** occurrences. Every `--primary`/`--k-primary`
  use is `border-color` or a `color-mix` fill. Primary-coloured text uses
  `--primary-text` (#046B64, 5.2:1).
- `--on-surface-faint` — aliased to `--on-surface-3` (#666A61) in **both** the
  build and the reference, so the ~20 `color: var(--ink-faint)` rules resolve to
  an AA-passing value today. The name still reads as non-text; left alone rather
  than churning twenty rules for no measured change.
