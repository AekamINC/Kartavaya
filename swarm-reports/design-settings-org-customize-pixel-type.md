# Settings / Organisation / Customization — pixel and type

Branch `design/settings-org-customize-pixel-type`. Surface: `frontend/src/pages/org/**`,
`components/CustomizePanel.jsx`, `frontend/src/styles/settings.css`, `org.css`, `editorial.css`.

**Every number below is emitted by a script reading `getComputedStyle` on a rendered
page — none is transcribed by hand.** Harness: `frontend/public/__ref/__measure.html`
drives two same-origin iframes (the reference `Settings.html` React harness, and a
build probe that links the build stylesheets in `App.jsx` import order) and POSTs the
measurements to disk, so a sibling agent stealing the browser tab cannot corrupt a
reading. Generated `2026-07-27T06:59:33.773Z`.

Viewport 1440x900, light theme. Windows device scale 1.25, so a CSS `1px` border
measures `0.8px` and `2px` measures `1.6px` throughout — that is device-pixel
snapping, not a spec deviation.

---

## 0. Baseline — and it does NOT match

| | build probe | reference harness |
|---|---|---|
| `data-density` | `comfy` | `cozy` |
| `data-display` | `—` | `serif` |
| `data-language` | `en+sa` | `—` |
| `data-platform` | `mac` | `mac` |
| `data-sidebar` | `wide` | `—` |
| `data-sidebarBg` | `dark` | `—` |
| `data-surfaceKind` | `—` | `mac` |
| `data-theme` | `light` | `light` |
| `data-toastPos` | `tr` | `—` |

### Density tokens at each side's own default

| token | build (`comfy`) | reference (`cozy`) |
|---|---|---|
| `--row-h` | `48px` | `44px` |
| `--pad-page` | `32px` | `28px` |
| `--pad-card` | `20px` | `18px` |
| `--gap-section` | `26px` | `22px` |
| `--gap-tight` | `12px` | `10px` |
| `--t-body` | `14px` | `14px` |
| `--t-body-sm` | `calc(14px * .93)` | `13px` |

### Colour tokens — identical on both sides

| token | build | reference |
|---|---|---|
| `--primary` | `#04837A` | `#04837A` |
| `--primary-text` | `#046B64` | `#046B64` |
| `--on-surface` | `#1B1D1A` | `#1B1D1A` |
| `--on-surface-2` | `#4A4E48` | `#4A4E48` |
| `--on-surface-3` | `#666A61` | `#666A61` |
| `--on-surface-faint` | `#666A61` | `#666A61` |
| `--outline-variant` | `#D8D1BE` | `#D8D1BE` |
| `--surface` | `#FAF7F0` | `#FAF7F0` |
| `--bg` | `#F3EFE6` | `#F3EFE6` |
| `--s-low` | `#F5F1E7` | `#F5F1E7` |
| `--s-container` | `#EEE9DC` | `#EEE9DC` |

All 11 colour tokens above resolve identically. The palette is faithfully implemented.

---

## 1. Component measurements

### Form field

| property | build `.of__i` | reference `.inp` | |
|---|---|---|---|
| rendered height | `39.5` | `39` | **differs** |
| padding (T/B) | `9px / 9px` | `10px / 10px` | **differs** |
| padding (L/R) | `11px / 11px` | `12px / 12px` | **differs** |
| font-size | `13px` | `13px` | match |
| border-radius | `5.8px` | `6.96px` | **differs** |
| background | `rgb(255, 254, 251)` | `rgb(245, 241, 231)` | **differs** |

### Field label and help text

| property | build `.of__l` | reference `.fld__l` | |
|---|---|---|---|
| font-size | `11.5px` | `11px` | **differs** |
| font-weight | `500` | `600` | **differs** |
| colour | `rgb(74, 78, 72)` | `rgb(102, 106, 97)` | **differs** |
| line-height | `17.25px` | `16.5px` | **differs** |

| property | build `.of__h` | reference `.au-f__hint` | |
|---|---|---|---|
| font-size | `11px` | `11px` | match |
| colour | `rgb(102, 106, 97)` | `rgb(102, 106, 97)` | match |
| line-height | `15.95px` | `15.95px` | match |

### Tab bar

| property | build `.tabs__b` | reference `.tabs__b` | |
|---|---|---|---|
| rendered height | `38` | `40` | **differs** |
| min-height | `auto` | `40px` | **differs** |
| padding (T/B) | `10px / 10px` | `9px / 9px` | **differs** |
| padding (L/R) | `16px / 16px` | `13px / 13px` | **differs** |
| font-size | `13.02px` | `12.5px` | **differs** |
| font-weight | `500` | `600` | **differs** |

Active tab:

| property | build `.tabs__b.on` | reference `.tabs__b.on` | |
|---|---|---|---|
| text colour | `rgb(4, 107, 100)` | `rgb(27, 29, 26)` | **differs** |
| underline width | `0px` | `2px` | **differs** |
| underline colour | `rgb(4, 107, 100)` | `rgb(4, 107, 100)` | match |
| font-weight | `500` | `600` | **differs** |

Bar itself: build `39px` high, reference `41px`.

### Segmented control

| property | build `.seg` / `.seg__b` | reference `.sseg` / `.sseg__b` | |
|---|---|---|---|
| track height | `33` | `36` | **differs** |
| track radius | `999px` | `6.96px` | **differs** |
| track background | `rgb(238, 233, 220)` | `color(srgb 0.933333 0.913725 0.862745 / 0.82)` | **differs** |
| track gap | `normal` | `2px` | **differs** |
| button height | `27` | `30` | **differs** |
| button padding | `6px / 14px` | `7px / 14px` | **differs** |
| button radius | `999px` | `4.96px` | **differs** |
| button weight | `500` | `600` | **differs** |

### Setting row and section spacing

| property | build `.sr` | reference `.srow` | |
|---|---|---|---|
| rendered height | `71.25` | `57.75` | **differs** |
| padding (T/B) | `15px / 15px` | `0px / 0px` | **differs** |
| column gap | `18px` | `20px` | **differs** |
| divider width | `1px` | `0px` | **differs** |

| property | build `.sr__t` | reference `.srow__l b` | |
|---|---|---|---|
| font-size | `13.5px` | `13.5px` | match |
| font-weight | `500` | `600` | **differs** |
| colour | `rgb(27, 29, 26)` | `rgb(27, 29, 26)` | match |

| property | build `.sr__d` | reference `.srow__l span` | |
|---|---|---|---|
| font-size | `12px` | `11.5px` | **differs** |
| colour | `rgb(102, 106, 97)` | `rgb(102, 106, 97)` | match |
| line-height | `18px` | `17.25px` | **differs** |

Section block: build `.st__group` margin-bottom `26px`; reference `.setwrap` gap `22px`
and page padding `28px` (reference `--pad-page` at `cozy`).

### Members table row

| property | build `.omt` | reference `.tbl` | |
|---|---|---|---|
| row height | `59.75` | `44` | **differs** |
| row min-height | `0px` | `44px` | **differs** |
| cell padding T | `11px` | `0px` | **differs** |
| cell padding L | `12px` | `0px` | **differs** |
| name size/weight | `13px / 500` | `13px / 500` | match |
| sub-line size | `11.5px` | `11.5px` | match |
| sub-line box height | `17.25` | `15` | **differs** |

Header row: build `33.5px` high, reference `38px`.

### Card and toggle

| property | build `.k-card` | reference `.card` | |
|---|---|---|---|
| padding (T/L) | `20px / 22px` | `0px / 0px` | **differs** |
| border-radius | `14.5px` | `17.4px` | **differs** |
| background | `rgb(250, 247, 240)` | `rgb(250, 247, 240)` | match |

Build toggle `.tgl`: `38` x `22`, radius `999px`, on-state fill `rgb(4, 131, 122)`.
The reference has no equivalent toggle class on the settings surface — it uses
`.sseg` two-state segments where the build uses a switch.

---

## 2. Devanagari — the type rule that was being broken

`.st__gt` (the Latin section heading) computes `font-weight: 700`, `letter-spacing: 1.2px`,
`text-transform: uppercase`. `SoundGrid.jsx:25-27` nests the `.st__gh` Devanagari span
**inside** it, and all three of those inherit.

| | before fix | after fix (measured) | reference `.tabs__hi` |
|---|---|---|---|
| `font-weight` | `700` | `400` | `400` |
| `text-transform` | `uppercase` | `none` | `none` |
| `letter-spacing` | `normal` | `normal` | `normal` |
| `font-size` | `11px` | `11px` | `12px` |

Face resolved: `"Tiro Devanagari Hindi", "Noto Serif Devanagari", "Nirmala UI", "Kohinoor Devanagari", serif`


---

## 3. Findings, in the order they matter

### F1 — BASELINE: "Comfy" means two different things. Every spacing number depends on this.

This is the first thing to settle, because it silently shifts every other measurement.

The reference offers **two** density choices and maps them to **three** token rows:

- `SetCustomize.jsx:268` — the control has exactly `[['compact','Compact'], ['comfy','Comfy']]`.
- `SetCustomize.jsx:470` — its default is `density: 'comfy'`.
- `SetCustomize.jsx:491` — but it writes the attribute as
  `data-density={p.density === 'compact' ? 'compact' : 'cozy'}`.

So in the reference, choosing **"Comfy" emits `data-density="cozy"`**. That is why the
harness `<html>` carries `cozy`. The `comfy` row in the reference `tokens.css:230`
(`--row-h: 54px`) is **unreachable from the UI** — nothing can select it.

The build does not have that mapping. `CustomizePanel.jsx:76` defaults to `'comfy'` and
`:272` writes it literally (`root.setAttribute('data-density', prefs.density)`), and
`kartavaya-design.css` declares only `compact` and `comfy` — **there is no `cozy` row at
all**. So the build's default lands on its own `comfy`:

| token | reference default (`cozy`) | build default (`comfy`) | build is |
|---|---|---|---|
| `--row-h` | 44px | 48px | +4px |
| `--pad-page` | 28px | 32px | +4px |
| `--pad-card` | 18px | 20px | +2px |
| `--gap-section` | 22px | 26px | +4px |
| `--gap-tight` | 10px | 12px | +2px |

Neither build row matches the reference row of the same name either — reference
`compact` is `34/18/12/14/7`, build `compact` is `38/16/14/16/8`.

**The whole product renders looser than the design's default**, and no per-page fix will
correct it. The repair is one of:

1. add a `cozy` row to `kartavaya-design.css` with the reference's five values and mirror
   the reference's `'compact' ? 'compact' : 'cozy'` mapping in `applyPrefs`; or
2. retune the build's `comfy` row to the reference's `cozy` values.

(1) is faithful; (2) is smaller. **I did not ship either.** It moves spacing on every
page in the product, which would silently invalidate the measurements two sibling agents
are taking against the current baseline right now. This needs the owner and a single
coordinated commit. **Flagged, not fixed — deliberately.**

### F2 — Devanagari was faux-bold in the sounds heading · FIXED (`dae8e11`)

`.st__gt` is `700 / .12em / uppercase`. `SoundGrid.jsx:25-27` nests the `.st__gh`
Devanagari span inside it, and `font-weight` and `text-transform` both inherit.
Tiro Devanagari Hindi ships at **weight 400 only**, so the inherited `700` was being
synthesised by the rasteriser — faux-bold, which smears the शिरोरेखा and closes the
counters.

Measured on the rendered span, before `700` / `uppercase`, after `400` / `none`.

`letter-spacing` was **already safe**: `[lang="hi"] { letter-spacing: 0 !important }`
(`editorial.css:2562`) covers it and SoundGrid does pair the span with `lang="hi"`. So the
brief's warning about tracking leaking onto Devanagari was **two-thirds right on this
surface** — weight and case were leaking, tracking was not.

This is exactly the fix `.k-lbl__in` (`editorial.css:2595`) already makes for the four
label classes with the identical shape; its comment even names the faux-bold mechanism.
`.st__gh` was simply never given the same treatment.

### F3 — the active tab has no underline

| | build | reference |
|---|---|---|
| active text | `--primary-text` teal | `--on-surface` ink |
| active underline | **none (`0px`)** | `2px` `--primary-text` |

The reference keeps the label ink-coloured and marks the selection with a 2px primary
rule under the tab. The build drops the rule and recolours the text instead. Selection is
therefore carried by **hue alone** — which is both a fidelity gap and a WCAG 1.4.1
(use of colour) concern, since the only difference between the selected and unselected
tab is its colour.

**Not shipped**: `.tabs__b` lives in `components.css` and is the shared tab component for
every tabbed page in the product, so this belongs to whoever owns that component, not to
the settings surface. Recommended patch is one line —
`.tabs__b.on { color: var(--on-surface); border-bottom: 2px solid var(--primary-text); }`
— plus giving `.tabs__bar` the matching bottom offset.

### F4 — the density control is inert for the members table

The reference member row is `min-height: var(--row-h)` (`app.css:183`), so it tracks the
density preference: 44px at `cozy`, 34px at `compact`, 54px at `comfy`.

The build's `.omt` never references `--row-h`. Its height is whatever the 11px cell
padding plus two stacked lines produce — **measured 59.75px, and it does not change when
the user switches Compact/Comfy.** That is 15.75px (36%) taller than the design, on the
one table where row count matters most.

This is the same class of defect as the `.k-btn` `border-radius: 8px` literal the brief
names: a Customization control that appears to work and does nothing to this component.

Reaching 44px needs two changes together — couple the row to `--row-h`, and recover the
~15px from cell padding (11px) and the sub-line leading (build `.omt__e` box is 17.25px
against the reference's 15px). **Not shipped**: it is a visible layout change to the
members list and overlaps the structure sibling's remit.

### F5 — field label: the build diverges, and I recommend keeping the build's version

| | build `.of__l` | reference `.fld__l` |
|---|---|---|
| size | 11.5px | 11px |
| weight | 500 | 600 |
| colour | `--on-surface-2` `#4A4E48` | `--on-surface-3` `#666A61` |

Three simultaneous differences. **Do not "fix" this toward the reference.** The build's
label is larger and darker; `#4A4E48` on `--surface` is a materially higher contrast than
`#666A61`, and `--on-surface-3` measures 4.82:1 on `--bg` — passing, but with no margin
at 11px. Matching the reference here would trade legibility for fidelity on the smallest
persistent text on the form. Accessibility beats fidelity; recorded as a
**deliberate, correct divergence**.

Help text is already an exact match (11px, `--on-surface-3`, 15.95px leading).

### F6 — two "differences" that are artefacts of the probe, not defects

Reported so nobody re-raises them:

- **`--radius-base` 10px (build) vs 12px (reference).** 12px is only the reference
  `tokens.css` fallback. The reference's own `CUST_DEFAULTS.radius` is `'10'`, same as the
  build's `DEFAULTS.radius`. At runtime both are 10px. The cascade of `--r-sm` 5.8 vs 6.96
  and `--r-lg` 14.5 vs 17.4 in the tables above is downstream of this and is **not** a
  live divergence.
- **`--font-ui` Inter (build) vs Public Sans (reference).** Same story: reference
  `CUST_DEFAULTS.uiFont` is `'inter'`. The stylesheet fallback differs, the runtime value
  does not.

### F7 — the brief's `--on-surface-faint` rule is stale for this build

The brief states `--on-surface-faint` is non-text-only. **Measured, it is now an alias:**
`--on-surface-faint` resolves to `#666A61` on both sides — identical to `--on-surface-3`
(`kartavaya-design.css:174` light, `:261` dark). `swarm-reports/a11y-responsive-audit.md`
records the same conclusion and measures it at 4.82:1 light / 5.81:1 dark on `--bg`.
Its text call sites on this surface are compliant. The 2.3:1 reputation belongs to a
value the token no longer carries.

### F8 — the members table is a real `<table>`, and that is an improvement

The reference builds the member list from `div.tbl__row` CSS grid. The build uses a real
`<table class="omt">` with `<th>`. `org.css:77-79` documents the reason: the div-grid
version had no header/cell association for a screen reader. **Do not regress this toward
the reference markup.** It is why the row-height comparison in F4 is a
padding-vs-`min-height` comparison rather than like-for-like.

### F9 — smaller measured divergences, unshipped

- **Segmented control shape.** Build `.seg` is a **pill** (`--r-pill`, 999px) with a
  999px thumb; the reference `.sseg` is a rounded rectangle (`--r-sm`, ~7px) with a ~5px
  thumb, a 2px inter-segment gap and an 82%-alpha track. Different silhouette entirely.
  Build track 33px vs reference 36px.
- **Field fill.** Build `.of__i` sits on `#FFFEFB` (`--s-lowest`); the reference `.inp`
  sits on `#F5F1E7` (`--s-low`). The build's field is brighter than its card.
- **Card model.** Reference `.card` is a shell with `padding: 0` and padded children;
  build `.k-card` carries `20px/22px` itself. Not interchangeable.
- **Tab metrics.** Build 13.02px/500 with 10px/16px padding and no `min-height`;
  reference 12.5px/600 with 9px/13px padding and `min-height: 40px`.
- **Row model.** Build `.sr` is a 15px-padded row with a divider (71px tall); reference
  `.srow` has no padding and no divider (58px) and relies on `--gap-section`.

---

## 4. Method, and one warning for whoever measures next

`design-reference/Kartavaya Redesign/*.html` are runnable React harnesses; they were
rendered, not read. The build side is a probe page that links the build stylesheets in
`App.jsx` order — `index.css` is a pure `@import` barrel, so one `<link>` reproduces the
real cascade — with markup lifted verbatim from the components (`F` in `TabProfile.jsx`,
`Tabs.jsx`, `MemberTable`, `SoundGrid.jsx`). Build numbers are therefore real computed
values against real stylesheets; the caveat is markup fidelity, not measurement fidelity.
The authenticated app was not driven, because these pages sit behind `Protected` and this
run may not touch the database.

**Warning — the shared browser is contended.** Both the Claude Browser pane and the
Playwright MCP are shared across the swarm, and sibling agents navigate tabs out from
under you between two consecutive tool calls. Three separate readings in this run landed
on a *sibling's* page: twice on a build probe carrying `data-density="comfy"`, once on a
motion probe. Any of those transcribed as "the reference" would have produced a
confidently wrong report.

Two things made this safe, and both are worth reusing:

1. **Every measurement asserts `location.href`** and is discarded if it does not match.
2. **The harness POSTs its results to a local server that writes them to disk.** The
   browser only has to load the page once; nothing needs to be read back through a tab
   that a sibling may have already stolen.

`frontend/public/__ref/` is gitignored, so the harness is not committed. It is
reproducible: copy `design-reference/Kartavaya Redesign/*.{html,jsx,css,png}` into
`frontend/public/__ref/`, serve the worktree root, open `__measure.html`.

## 5. Gates

| gate | result |
|---|---|
| `check-tokens.mjs` | green — 340 declared, 234 referenced, 0 missing |
| `check-classes.mjs` | green — 2120 selectors, 1443 classes, 0 missing a rule |
| `check-contrast.mjs` | **fails, pre-existing** |

`check-contrast` exits 1 on clean `origin/staging` too. I verified this properly rather
than assuming: I restored `origin/staging`'s `settings.css`, re-ran, and diffed the two
outputs — **byte-identical**. The failures are in `components.css` (`.cbx`, `.av`),
`brand.css` (`.k-pill-high`, `.k-badge`), `editorial.css` (five tinted-chip rules),
`sanvaad.css` and `landing.css`. **None is in `settings.css` or `org.css`**, and this
branch changes no colour. Unowned, and worth someone taking.
