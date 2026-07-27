# Audit — contrast over `color-mix()` / `color(srgb …)` surfaces

Branch `audit/colormix-contrast`, cut fresh from `origin/staging` at `a1f5dffa`.
Every ratio below came from a calibrated instrument; none was transcribed by hand.

---

## 1 · Calibration — stated before any finding

Three independent instruments were built and cross-checked against each other.
**No reading was taken until all three reproduced the 14 `--outline` ratios
documented in `kartavaya-design.css` (:249-262 light, :379-390 dark).**

### Gate 1 — the 14 documented ratios, reproduced to delta 0.00

| theme | surface | documented | Node engine | in-browser | delta |
|---|---|---|---|---|---|
| light | `--s-lowest` | 4.76 | 4.76 | 4.76 | +0.0038 |
| light | `--surface` | 4.49 | 4.49 | 4.49 | +0.0006 |
| light | `--s-low` | 4.26 | 4.26 | 4.26 | −0.0002 |
| light | `--bg` | 4.19 | 4.19 | 4.19 | −0.0031 |
| light | `--s-container` | 3.96 | 3.96 | 3.96 | +0.0037 |
| light | `--s-high` | 3.68 | 3.68 | 3.68 | +0.0009 |
| light | `--s-highest` | 3.38 | 3.38 | 3.38 | −0.0016 |
| dark | `--s-lowest` | 5.33 | 5.33 | 5.33 | +0.0001 |
| dark | `--bg` | 5.20 | 5.20 | 5.20 | −0.0047 |
| dark | `--surface` | 4.92 | 4.92 | 4.92 | −0.0025 |
| dark | `--s-low` | 4.65 | 4.65 | 4.65 | −0.0047 |
| dark | `--s-container` | 4.30 | 4.30 | 4.30 | −0.0010 |
| dark | `--s-high` | 3.83 | 3.83 | 3.83 | +0.0048 |
| dark | `--s-highest` | 3.33 | 3.33 | 3.33 | +0.0004 |

14/14, max |delta| 0.0048, in **both** the offline engine and the in-browser
instrument, the latter re-run in every theme before every batch of readings.

### Gate 2 — the four capabilities the brief names

| capability | proof | result |
|---|---|---|
| `color-mix(in srgb, X 40%, transparent)` over a **non-white** parent | resolves to `#04837A` @ α0.40 (hue intact — premultiplied, not dragged to black). Composited over `--s-highest #DFD8C5` → `rgb(135.4, 182, 167)`; over white → `rgb(154.6, 205.4, 201.8)`. Ink reads **7.51:1** on the real backdrop vs **9.70:1** on white | pass — a 2.19 spread, so the backdrop is demonstrably wired |
| `color(srgb r g b)` notation | `color(srgb 0.470588 0.447059 0.372549)` → `#78725f`, and reproduces the Gate-1 value `--outline` on `--s-high` = 3.68 through that path. `/ 0.4` alpha form parsed. An unsupported space returns `null`, never a silent white | pass |
| nested `var()` → `color-mix` | `var(--alias2)`→`var(--alias)`→`var(--rule-soft)`→`color-mix(…var(--outline-variant) 60%…)` → `#d8d1be` @ α0.60. Cycles terminate to `null`. An undefined var inside a mix **voids** the declaration, matching CSS | pass |
| gradient with a fully transparent stop | compositing `transparent` over `--surface` is bit-identical to `--surface`; the ratio is unchanged to 1e-9. (Had it been mistaken for opaque black it would read 1.24:1 and be reported as catastrophic — that is the shape of the 52 phantom failures) | pass |

### Gate 2b — a fifth capability, added after it caught a bug in my own instrument

`color-mix(in srgb, var(--pr-urgent) var(--tint-mid), transparent)` puts a
**`var()` in the percentage slot**. My first parser matched only a literal
trailing `%`, so it read no percentage and fell back to a 50/50 mix. That
inflated `.k-pri--urgent` from a true 4.62:1 to a false 2.40:1 and produced
eleven phantom failures before I caught it. Now asserted: the token resolves to
14%, and a `var(--nope, 20%)` fallback resolves to 20%.

**This is the same bug class the audit was commissioned to hunt, found in the
auditing instrument itself. It is also — independently — the defect in the
shipped gate (§3).**

### Gates 3–5 — independent anchors

- **WCAG anchors, no codebase involvement:** `#000`/`#fff` = 21.00, `#777`/`#fff` = 4.48, `#767676`/`#fff` = 4.54, `#0000ff`/`#fff` = 8.59, luminance of white = 1.0 / black = 0.0. 50% black over white composites to channel 127.5 **exactly** (3.9767), not the byte-rounded `#808080` (3.9494) — the instrument keeps the float.
- **20 cross-checks** against ratios documented in the stylesheets (retired `--outline-variant #ADA692` 2.12/1.71, retired dark `--outline #5B626C` 3.14/2.01, `--primary` 4.04/4.63/6.38, `--primary-text` 5.56, default-accent 4.30, dark `#00332F` on `#4FD8CB` 7.93, …) — all reproduced.
- **400-pair cross-validation against the repo's own `contrast()`** in `src/lib/accent.js` — the function `check-accent-contrast.mjs` already trusts. **Max absolute delta 0.000e+0** across every pairing of 20 shipped colours.

---

## 2 · What is actually out there — count it yourself

The brief's "roughly 40" is low by about **6×**.

| measure | count |
|---|---|
| raw grep hits for `color-mix(` / `color(srgb` in `src/styles` + `src/lib` | 273 |
| …of which are **prose inside comments**, not code | 6 |
| real declarations | **270** |
| **in a paint position** (background / border / outline / box-shadow) | **250** |
| token definitions that are themselves a mix (`--focus-ring`, `--seg-bg`, …) | 13 |
| `color` (text) declarations using a mix | 7 |

By role, of the 250: **background 154 · border 63 · box-shadow 18 · outline 1 ·
background-image 1** (plus 13 token defs counted separately above).

Two facts worth stating plainly:

- **`color(srgb …)` appears ZERO times in the source.** All six textual hits are
  prose. It exists only as **Chrome's serialisation of a resolved `color-mix()`**
  — `getComputedStyle` returns `color(srgb 0.847059 0.819608 0.745098 / 0.6)`
  where the stylesheet said `color-mix(in srgb, var(--outline-variant) 60%, transparent)`.
  That is precisely why a parser reading computed styles and not knowing the
  notation reports a clean number: it fails to parse, falls back, and the
  fallback looks fine. Confirmed live, repeatedly, in this audit.
- **14 of the surfaces are Tailwind utility selectors** (`.bg-card\/50`,
  `.bg-background\/30`, …) shipped in `App.css`. Across every page rendered they
  matched **zero** elements. They are inert and are marked *(util)* in the table.

---

## 3 · The number the brief asks for

> **How many pairs did a prior pass report as passing that actually fail?**

# 5

Five component selectors (seven declarations — two are duplicated across
`editorial.css` and `kartavaya-design.css`). All in **light**; all clear in dark.

| selector | declared at | foreground | light | dark | threshold | verdict |
|---|---|---|---|---|---|---|
| `.k-inboxkind--assign` | `editorial.css:2419` | `var(--ok)` `#14743A` | **4.21** | 6.87 | 4.5 (14px, 400) | **FAIL light** |
| `.k-inboxkind--approval` | `editorial.css:2420` | `var(--warn)` `#955806` | **4.13** | 6.61 | 4.5 | **FAIL light** |
| `.k-inboxkind--comment` | `editorial.css:2421` | `var(--st-in-review)` `#6E5AA0` | **4.20** | 5.89 | 4.5 | **FAIL light** |
| `.k-pri--high` | `editorial.css:2445` + `kartavaya-design.css:1031` | `var(--pr-high)` → `--warn` | **4.13** | 6.61 | 4.5 | **FAIL light** |
| `.k-pri--low` | `editorial.css:2447` + `kartavaya-design.css:1033` | `var(--pr-low)` → `--on-surface-3` | **4.37** | 4.92 | 4.5 | **FAIL light** |

### Why they were reported clean

Not a rounding error and not a compositing disagreement. `check-contrast.mjs`
**never measured them at all**, and a rule that is skipped is indistinguishable
from a rule that passes in a green report.

Its `color-mix` component parser required a **literal trailing `%`**:

```js
const pct = /(-?[\d.]+)%\s*$/.exec(s.trim());
```

Twelve rules in this codebase write the percentage as a **token** —
`color-mix(in srgb, var(--ok) var(--tint-mid), transparent)`. For those the
regex misses, the whole component `var(--ok) var(--tint-mid)` is handed to
`parseColor` as if it were a colour, that returns `null`, the `color-mix`
returns `null`, `bgRes` is `null`, and the rule hits `continue`.

The controlled comparison that proves it — identical colour maths, one measured
and one invisible, differing only in how the percentage is written:

| rule | percentage written as | measured ratio | reported by the gate before this audit? |
|---|---|---|---|
| `.k-actitem__verb--approved` (`editorial.css:2580`) | literal `14%` | 4.21 | **yes** |
| `.k-inboxkind--assign` (`editorial.css:2419`) | `var(--tint-mid)` (= 14%) | 4.21 | **no — never reached** |

### Verified three ways

| instrument | `.k-inboxkind--assign` | `.k-pri--low` |
|---|---|---|
| offline engine (Node) | 4.21 | 4.37 |
| live browser, `getComputedStyle`, calibration re-passed in the same call | **4.21** | **4.37** |
| `check-contrast.mjs` after the parser fix in this branch | **4.21** | **4.37** |

The browser reported the background as `color(srgb 0.0784314 0.454902 0.227451 / 0.14)`
— confirming both Chrome's serialisation and that `--tint-mid` resolved to 14%.

### And the honest other half

**Of the 23 token-model verdict flips found across the whole stylesheet, ZERO
involve a `color-mix` surface.** The premise that any earlier reading over a
mix may be wrong did **not** hold, for a specific and checkable reason: the
gate's mix arithmetic is *premultiplied and correct*, and it already composites
translucent surfaces over a real backdrop rather than white. Its own docblock
(`check-contrast.mjs:40`) claims "non-premultiplied" — **the comment is stale;
the code is right.** The peer's warning generalised from *their* broken parser,
not from this repo's gate.

The five failures above are a **coverage** hole, not an arithmetic one.

---

## 4 · Fixed in this branch

### 4a · `--k-deep` renders the light-theme colour in dark (a genuine false pass)

Not a `color-mix` surface, but it *is* "reported clean, actually failing", so it
belongs in this report.

`kartavaya-design.css:600` declares `--k-deep: var(--primary-hover)` — which is
theme-varying. But `applyPrefs` (`CustomizePanel.jsx:192`) overwrites it inline
with `acc.deep` and **does not branch on theme**, so `--k-deep` renders
`#005650` in *both* themes. A checker reading the stylesheet sees the
theme-varying declaration and measures a comfortable pass.

| site | live? | stylesheet model said | actually renders | threshold |
|---|---|---|---|---|
| `.gr__export-go` `generate-report.css:530` | yes — `ReportsPage.jsx:774,787`, carries the export **Arrow** glyph | 13.23 | **2.31** | 3:1 (non-text graphic, 1.4.11) |
| `.gr__block-action:hover` `generate-report.css:78` | yes — `ReportsPage.jsx:609-634` | 12.20 | **2.13** | 4.5:1 |
| `.gr__hrow-go` `generate-report.css:627` | no — `.gr__hrow` renders no `-go` child | 13.23 | 2.31 | — |

**Fix:** `var(--k-deep)` → `var(--primary-text)` at the three **text** sites.
`--primary-text` is the token `00 §7` designates for primary-coloured text, and
`applyPrefs` *does* branch it by theme. In light both tokens are `#005650`, so
**light is pixel-identical**; dark goes 2.31 → **7.89** and 2.13 → **7.28**.
Verified in the live browser in both themes.

The `border-color: var(--k-mid)` sites (`generate-report.css:135, 284, 316`)
were left alone: `#00897f` measures 4.26:1 on dark `--surface`, clearing the 3:1
a boundary needs.

### 4b · The gate's blind spot

`scripts/check-contrast.mjs` now resolves a `var()` in the percentage slot
before deciding there is no percentage. It reports 13 → **20** rows; the seven
new ones are the five components above. This is a measurement fix with no design
content, and it is what stops this class of miss recurring.

---

## 5 · Proposed, not applied — needs a design decision

The five failures are 4.13–4.37 against 4.5, and every one is a chip sitting on
a tint **of its own foreground**. `editorial.css:2612-2618` already documents
this exact trap and the design's chosen remedy:

> a chip sits on a 12% tint OF ITS OWN FOREGROUND, so the background moves
> toward the text and costs ~0.7:1 that the token's rating against `--bg` never
> accounted for

and the fix taken there for `.k-rule__status--off` was to keep the tint and
darken the **label** one step (`--ink-3` → `--ink-2`, 4.15 → 6.37).

That precedent transfers cleanly to **`.k-pri--low`** only, whose foreground
`--pr-low` *is* `--on-surface-3` — the identical neutral-grey case. I did not
apply it, because `00 §9` deliberately routes priority through the `--pr-*` map
so priority "does not get a private colour map", and swapping the label to
`--on-surface-2` reintroduces exactly that. Two coherent options, both design
calls:

1. Redefine `--pr-low` (and the tint pairing) so the pair clears 4.5 — keeps the map intact.
2. Let these chips pair a `--pr-*` tint with an `--on-surface-2` label, and record the exception.

For the three **hue-carrying** chips (`--ok` green, `--warn` amber,
`--st-in-review` purple) the precedent does **not** transfer: darkening the
label to a neutral destroys the colour coding that is the whole point of the
component. The options are to darken the `--ok` / `--warn` / `--st-in-review`
ramps (system-wide blast radius) or to weaken the tint from `--tint-mid` 14% to
`--tint-weak`/`--tint-soft` so the ground stays closer to `--bg`. Both are
accent-ramp decisions of the same kind as the documented 4.30 residual.

---

## 6 · Phantom failures I rejected — and why

The brief warned that a large failure count should make me suspect myself first.
It did, four times.

| candidate | first count | after scrutiny | why rejected |
|---|---|---|---|
| border strokes below 3:1 | 29 of 37 | **decorative** | 23 were `--outline-variant` `#D8D1BE`. The token file is explicit that `--outline` "is the border of every text input, checkbox, radio and select trigger" and IS the component-identifying information; `--outline-variant` / `--rule` / `--rule-soft` are the soft editorial rules between adjacent content. WCAG 1.4.11 governs information "required to **identify** UI components", not decorative separation. Real form-control borders use `--outline` and measure **4.19:1**. |
| my own first table | 77 BELOW | **66**, then triaged | I was scoring 1px hairlines against the 4.5:1 **text** bar because the rule block happened to declare a `color`. A stroke is a boundary at 3:1, judged against the ground it separates — not against the text inside the box. |
| `.k-pri--*` at 2.40–2.73 | 11 rows | **0** | My own percentage-slot bug (Gate 2b). True values 4.57–4.85; most pass. |
| "backdrop sensitivity" — tints grounded on `--bg` that fail on a card | 8 | **0 confirmed** | The gate grounds unmatched selectors on `--bg`. In dark that is *darker* than the card surfaces, so the assumption reads optimistically — a real concern. But the one I could reach in the DOM, `.tabs__b.on`, genuinely grounds on `--bg` (the `.kv` shell) at **7.69:1**. Unverified speculation about the other seven is exactly how 52 phantoms get manufactured, so they are recorded as unverified, not as failures. |
| `brand.css` findings | 4 | **0 — dead file** | **`brand.css` is never imported.** No `import` anywhere in `src`; it appears only in README tables. Every rule in it is dead. Note this cuts the other way too: the shipped gate currently reports `.k-badge` (3.67) and `.k-pill-high` (2.24) from this file as **false positives**. |
| `.pcal__d` tint | 2 | **0** | `var(--c, transparent)` — with `--c` unset the mix is `transparent 18%, transparent`, fully transparent. Not a tinted surface; the fallback path, not a finding. |

---

## 7 · Focus rings

The visible focus indicator in this build is **`outline: 2px solid var(--primary)`**
(global rule, `components.css:530`, plus ~20 component-specific repeats). The
`color-mix` token `--focus-ring` is the *soft halo underneath it*, not the
indicator — `kartavaya-design.css:516` says so outright.

**Indicator — `--primary` at runtime, 2px solid, vs each surface (needs 3:1):**

| theme | worst surface | ratio | all seven |
|---|---|---|---|
| light `#00897f` | `--s-highest` | **3.02** | 3.02 – 4.26, all pass |
| dark `#05b7aa` | `--s-highest` | **4.93** | 4.93 – 7.89, all pass |

Light clears by 0.02 on the deepest surface — thin, but it clears, and note this
is the **runtime** accent `#00897f`, not the stylesheet's `#04837A`.

**Halo — `color-mix(in srgb, var(--primary) var(--focus-mix), transparent)`,
16% light / 26% dark:** measures **1.19–1.59:1** against its ground in both
themes. That is not a violation because it is never the sole indicator, but it
would be if it ever became one. Only one rule uses it as the focus treatment —
`workflow.css:196` `.hcl-card:focus-visible` — and that rule *also* sets
`border-color: var(--primary)`, which carries the 3:1. `ganit.css:141-148`
records a peer having already fixed four rules that misused `--focus-ring` as if
it were a colour. No remaining site relies on the halo alone.

---

## 8 · Documentation defects found while calibrating

Both are comments, not code. Neither changes a shipped colour; both would
mislead the next person to calibrate against them.

| where | claim | measured | note |
|---|---|---|---|
| `kartavaya-design.css:408` | dark `--on-ok #06341A` on `--ok #5BD98A` is **8.34:1** | **7.75:1** | The repo's own `check-contrast.mjs` also prints 7.75. Token is fine (clears AA); the figure is stale. |
| `check-contrast.mjs:40` | color-mix is computed "non-premultiplied" | code **is** premultiplied | The code is correct; the docblock defames it. Left as-is — flagged rather than silently edited, since this file's own header argues stale numbers should be recorded rather than quietly corrected. |

---

## 9 · Method, and the limits of it

- **Theme was never forced via `data-theme`.** `applyPrefs` writes `data-theme`
  *and* the inline accent tokens together, so setting the attribute directly
  desyncs them. I seeded `k_prefs = {mode:'system'}` and drove the OS-level
  `prefers-color-scheme`, then asserted coherence before reading:
  `--bg` = `#0C0E11` **and** inline `--primary` = `#05b7aa` simultaneously.
- **The tab was fronted before measuring** — the first probe returned
  `visibilityState: "hidden"` with an unmounted tree.
- **Runtime tokens, not stylesheet tokens.** `applyPrefs` overwrites `--primary`,
  `--primary-hover`, `--primary-text`, `--primary-vivid`, `--on-primary`,
  `--k-primary`, `--k-mid`, `--k-deep` and `--side-active` inline. Light
  `--primary` is **`#00897f`**, not `#04837A`; dark is **`#05b7aa`**, not
  `#4FD8CB`; dark `--on-primary` is **`#000000`**, not `#00332F`. `--side-active`'s
  `color-mix` is overwritten outright and never renders.
- **No sign-in, no database.** The `__verify` harness stubs
  `api.defaults.adapter` before any component mounts; nothing left the page. The
  server ran on **:5823** (not :5173), with a private `cacheDir` so the shared
  `node_modules/.vite` was untouched. Only tabs whose ports I had probed dead
  were reclaimed.
- **Coverage limit, stated plainly.** Live DOM measurement covered the routes
  the harness exposes (dashboard, inbox, sanvaad, pahchan) plus in-situ probes
  for specific components. The other ~200 surfaces were measured **statically
  with runtime token values** and are reported as such. Where a surface's ground
  could not be established it is marked rather than guessed — 38 rows resolve to
  a component-scoped var (`--c`, `--fg`, `--border`, `rgb(var(--card))`) that is
  undefined at `:root`, and those are marked *voided*, not failed.
- `origin/staging` advanced 3 commits (peer work) while this ran. The change
  here touches `generate-report.css` and `scripts/check-contrast.mjs` only, so
  there is no overlap.

---

## 10 · Every `color-mix` / `color(srgb` surface in a paint position

250 rows, generated — not transcribed. `light` / `dark` are the measured ratio
for the pair the rule states; strokes are scored as UI boundaries at 3:1 against
the ground they separate, backgrounds against the `color` the same rule declares
(`—` where the foreground is inherited and no single pair is stated).
*(util)* marks the inert Tailwind selectors.

| # | file:line | selector | prop | role | fg stated | light | dark | need | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `admin.css:295` | `.adm-danger` | `border` | border | — | 2.22 | 2.89 | 3 | BELOW |
| 2 | `admin.css:84` | `.adm-sus > td` | `background-color` | background | — | — | — | 3 | surface only (fg inherited) |
| 3 | `animations.css:509` | `.ix-drag-card:hover` | `border-color` | border | — | 2.16 | 3.47 | 3 | BELOW |
| 4 | `animations.css:557` | `.ix-drop-target.is-over` | `background-color` | background | — | — | — | 3 | surface only (fg inherited) |
| 5 | `animations.css:558` | `.ix-drop-target.is-over` | `box-shadow` | box-shadow | — | 1.84 | 2.58 | 3 | BELOW |
| 6 | `auth.css:359` | `.au__spin` | `border` | border | — | 1.05 | 1.03 | 3 | BELOW |
| 7 | `auth.css:458` | `.auinv__tag` | `background` | background | `var(--on-surface)` | — | — | 4.5 | voided (undefined var) |
| 8 | `auth.css:459` | `.auinv__tag` | `border` | border | `var(--on-surface)` | — | — | 3 | voided (undefined var) |
| 9 | `boards.css:142` | `.bd__composein` | `box-shadow` | box-shadow | `var(--on-surface)` | 1.22 | 1.26 | 3 | BELOW |
| 10 | `boards.css:208` | `.bc:hover` | `border-color` | border | — | 2.16 | 3.47 | 3 | BELOW |
| 11 | `boards.css:325` | `.bc__prio` | `background` | background | `color-mix(in srgb, var(--c` | — | — | 4.5 | voided (undefined var) |
| 12 | `boards.css:340` | `.bc__appr` | `border` | border | `var(--warn)` | 1.76 | 2.52 | 3 | BELOW |
| 13 | `boards.css:349` | `.bc__ghost` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 14 | `boards.css:392` | `.tb__grip:hover, .tb__grip.on` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 15 | `boards.css:516` | `.pb__toggle[aria-pressed="true"],
.pb__toggle` | `border-color` | border | `var(--on-primary-container` | 1.66 | 2.13 | 3 | BELOW |
| 16 | `boards.css:59` | `.bd__col.over` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 17 | `boards.css:60` | `.bd__col.over` | `border-color` | border | — | 1.84 | 2.58 | 3 | BELOW |
| 18 | `boards.css:606` | `.tl__month` | `border-right` | border | `var(--on-surface-3)` | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 19 | `boards.css:620` | `.tl__day.is-today` | `background` | background | `var(--primary-text)` | 6.90 | 6.12 | 4.5 | pass |
| 20 | `boards.css:633` | `.tl__grp` | `border-bottom` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 21 | `boards.css:645` | `.tl__row` | `border-bottom` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 22 | `boards.css:661` | `.tl__wknd` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 23 | `client.css:308` | `.cl-note:focus` | `box-shadow` | box-shadow | — | 1.22 | 1.26 | 3 | BELOW |
| 24 | `components.css:113` | `.card--glass` | `border-color` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 25 | `components.css:154` | `.tag` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 26 | `components.css:235` | `.tabs__b.on .tabs__n` | `background` | background | `var(--primary-text)` | 6.23 | 6.24 | 4.5 | pass |
| 27 | `components.css:27` | `.btn--tonal:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 28 | `components.css:354` | `.btn--dangerfill:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 29 | `components.css:38` | `.btn--danger` | `border` | border | `var(--danger)` | 2.44 | 3.19 | 3 | BELOW |
| 30 | `components.css:612` | `0%` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 31 | `components.css:66` | `.inp:focus` | `box-shadow` | box-shadow | — | 1.22 | 1.26 | 3 | BELOW |
| 32 | `components.css:668` | `.fldx__in:focus` | `box-shadow` | box-shadow | — | 1.23 | 1.28 | 3 | BELOW |
| 33 | `components.css:677` | `.fldx.is-error .fldx__in:focus` | `box-shadow` | box-shadow | — | 1.32 | 1.29 | 3 | BELOW |
| 34 | `components.css:68` | `.inp[aria-invalid="true"]:focus` | `box-shadow` | box-shadow | — | 1.29 | 1.26 | 3 | BELOW |
| 35 | `components.css:758` | `.pk__row.on:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 36 | `components.css:872` | `.chip[role="button"].on:hover, button.chip.on:` | `background` | background | `var(--on-secondary-contain` | 9.62 | 4.90 | 4.5 | pass |
| 37 | `components.css:877` | `.chip__x:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 38 | `dark-theme.css:51` | `::selection` | `background` | background | `var(--on-surface)` | 10.72 | 10.13 | 4.5 | pass |
| 39 | `dark-theme.css:55` | `[data-theme="dark"] ::selection` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 40 | `documents.css:58` | `.docdz:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 41 | `documents.css:67` | `.docdz--drag` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 42 | `drawer.css:153` | `.dr__title:focus, .dr__title--edit` | `box-shadow` | box-shadow | — | 1.22 | 1.26 | 3 | BELOW |
| 43 | `drawer.css:221` | `.dr__stage.past` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 44 | `drawer.css:238` | `.dr__stage.past:not(:last-child)::after` | `border-left-color` | border | — | — | — | 3 | voided (undefined var) |
| 45 | `drawer.css:271` | `.dr__ta:focus` | `box-shadow` | box-shadow | — | 1.22 | 1.26 | 3 | BELOW |
| 46 | `drawer.css:392` | `.dr__st-as .pk__tr:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 47 | `drawer.css:406` | `.dr__cm-av` | `background` | background | `var(--primary-text)` | 6.64 | 5.79 | 4.5 | pass |
| 48 | `drawer.css:442` | `.dr__tm-row` | `border-bottom` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 49 | `drawer.css:487` | `.dr__drop` | `background` | background | `var(--primary-text)` | 7.26 | 6.53 | 4.5 | pass |
| 50 | `drawer.css:530` | `.dr__lb` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 51 | `editorial.css:1059` | `.k-due--danger` | `border-color` | border | `var(--danger)` | 2.08 | 2.70 | 3 | BELOW |
| 52 | `editorial.css:1059` | `.k-due--danger` | `background` | background | `var(--danger)` | 5.40 | 6.60 | 4.5 | pass |
| 53 | `editorial.css:1060` | `.k-due--warn` | `border-color` | border | `var(--warn)` | 1.90 | 3.06 | 3 | BELOW |
| 54 | `editorial.css:1060` | `.k-due--warn` | `background` | background | `var(--warn)` | 4.79 | 8.44 | 4.5 | pass |
| 55 | `editorial.css:1061` | `.k-due--soon` | `border-color` | border | `var(--warn)` | 1.72 | 2.61 | 3 | BELOW |
| 56 | `editorial.css:1065` | `.k-due--done` | `border-color` | border | `var(--ok)` | 1.93 | 3.13 | 3 | BELOW |
| 57 | `editorial.css:1065` | `.k-due--done` | `background` | background | `var(--ok)` | 4.89 | 8.87 | 4.5 | pass |
| 58 | `editorial.css:1074` | `.k-statuschip` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 59 | `editorial.css:1076` | `.k-statuschip` | `border` | border | `var(--c)` | — | — | 3 | voided (undefined var) |
| 60 | `editorial.css:1084` | `.k-priochip` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 61 | `editorial.css:1419` | `.k-taskrow` | `border-bottom` | border | `inherit` | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 62 | `editorial.css:1668` | `.k-segctrl__btn.is-active .k-segctrl__count` | `background` | background | `var(--primary-text)` | 6.41 | 5.90 | 4.5 | pass |
| 63 | `editorial.css:1779` | `.k-trow:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 64 | `editorial.css:1925` | `.k-assignee-pill` | `background` | background | — | — | — | 3 | voided (undefined var) |
| 65 | `editorial.css:1926` | `.k-assignee-pill` | `border` | border | — | — | — | 3 | voided (undefined var) |
| 66 | `editorial.css:1952` | `.k-cat-chip` | `background` | background | `color-mix(in srgb, var(--c` | — | — | 4.5 | voided (undefined var) |
| 67 | `editorial.css:1953` | `.k-cat-chip` | `border` | border | `color-mix(in srgb, var(--c` | — | — | 3 | voided (undefined var) |
| 68 | `editorial.css:2054` | `.k-projectpicker__chip.is-active` | `background` | background | `var(--ink)` | 14.49 | 12.85 | 4.5 | pass |
| 69 | `editorial.css:2110` | `.k-bcol__body.is-over` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 70 | `editorial.css:2112` | `.k-bcol__body.is-over` | `outline` | outline | — | 1.40 | 2.13 | 3 | BELOW |
| 71 | `editorial.css:2125` | `.k-bdrop-placeholder` | `border` | border | — | 1.52 | 2.70 | 3 | BELOW |
| 72 | `editorial.css:2127` | `.k-bdrop-placeholder` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 73 | `editorial.css:2143` | `.k-bcol--requested` | `border-color` | border | — | 2.63 | 4.94 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 74 | `editorial.css:2144` | `.k-bcol--requested` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 75 | `editorial.css:2160` | `.k-bcard:hover` | `border-color` | border | — | 1.70 | 3.15 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 76 | `editorial.css:2317` | `[data-theme="dark"] .k-skeleton` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 77 | `editorial.css:2325` | `[data-theme="dark"] .k-skeleton::after` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 78 | `editorial.css:234` | `.kv__content::-webkit-scrollbar-thumb` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 79 | `editorial.css:2404` | `.k-inboxrow.is-unread` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 80 | `editorial.css:2404` | `.k-inboxrow.is-unread` | `border-color` | border | — | 1.56 | 2.47 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 81 | `editorial.css:2418` | `.k-inboxkind--mention` | `background` | background | `var(--primary-text)` | 6.31 | 5.44 | 4.5 | pass |
| 82 | `editorial.css:2419` | `.k-inboxkind--assign` | `background` | background | `var(--ok)` | 4.21 | 6.87 | 4.5 | BELOW |
| 83 | `editorial.css:2420` | `.k-inboxkind--approval` | `background` | background | `var(--warn)` | 4.13 | 6.61 | 4.5 | BELOW |
| 84 | `editorial.css:2421` | `.k-inboxkind--comment` | `background` | background | `var(--st-in-review)` | 4.20 | 5.89 | 4.5 | BELOW |
| 85 | `editorial.css:2444` | `.k-pri--urgent` | `background` | background | `var(--pr-urgent)` | 4.57 | 5.47 | 4.5 | pass |
| 86 | `editorial.css:2445` | `.k-pri--high` | `background` | background | `var(--pr-high)` | 4.13 | 6.61 | 4.5 | BELOW |
| 87 | `editorial.css:2446` | `.k-pri--medium` | `background` | background | `var(--pr-medium)` | 4.85 | 5.77 | 4.5 | pass |
| 88 | `editorial.css:2447` | `.k-pri--low` | `background` | background | `var(--pr-low)` | 4.37 | 4.92 | 4.5 | BELOW |
| 89 | `editorial.css:2453` | `.k-approvals__counter` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 90 | `editorial.css:2454` | `.k-approvals__counter` | `border` | border | — | 1.90 | 3.06 | 3 | BELOW |
| 91 | `editorial.css:2495` | `.k-apcard__kind--invoice` | `background` | background | `var(--danger)` | 4.57 | 6.40 | 4.5 | pass |
| 92 | `editorial.css:2496` | `.k-apcard__kind--contract` | `background` | background | `var(--primary-text)` | 6.31 | 6.35 | 4.5 | pass |
| 93 | `editorial.css:2497` | `.k-apcard__kind--creative` | `background` | background | `var(--warn)` | 4.13 | 8.02 | 4.5 | BELOW |
| 94 | `editorial.css:2501` | `.k-apcard__urgent` | `background` | background | `var(--danger)` | 4.89 | 6.85 | 4.5 | pass |
| 95 | `editorial.css:2576` | `.k-actitem__verb--created` | `background` | background | `var(--primary-text)` | 6.63 | 6.35 | 4.5 | pass |
| 96 | `editorial.css:2578` | `.k-actitem__verb--moved` | `background` | background | `var(--primary-text)` | 6.31 | 6.35 | 4.5 | pass |
| 97 | `editorial.css:2579` | `.k-actitem__verb--commented` | `background` | background | `var(--ink-2)` | 6.17 | 8.38 | 4.5 | pass |
| 98 | `editorial.css:2580` | `.k-actitem__verb--approved` | `background` | background | `var(--ok)` | 4.21 | 8.40 | 4.5 | BELOW |
| 99 | `editorial.css:2581` | `.k-actitem__verb--attached` | `background` | background | `var(--warn)` | 4.13 | 8.02 | 4.5 | BELOW |
| 100 | `editorial.css:2583` | `.k-actitem__verb--assigned` | `background` | background | `var(--st-in-review)` | 4.20 | 7.01 | 4.5 | BELOW |
| 101 | `editorial.css:2584` | `.k-actitem__verb--changed` | `background` | background | `var(--ink-2)` | 6.37 | 8.96 | 4.5 | pass |
| 102 | `editorial.css:2596` | `.k-rule--new` | `border-color` | border | — | 1.70 | 3.15 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 103 | `editorial.css:2611` | `.k-rule__status--on` | `background` | background | `var(--ok)` | 4.33 | 8.79 | 4.5 | BELOW |
| 104 | `editorial.css:2619` | `.k-rule__status--off` | `background` | background | `var(--ink-2)` | 6.37 | 8.96 | 4.5 | pass |
| 105 | `editorial.css:2628` | `.k-rule__step--when` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 106 | `editorial.css:2630` | `.k-rule__step--then` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 107 | `editorial.css:266` | `.side::before` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 108 | `editorial.css:272` | `.side::after` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 109 | `editorial.css:2855` | `.k-cm-compose__field:focus-within` | `border-color` | border | — | 1.79 | 3.70 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 110 | `editorial.css:2867` | `.k-cm-compose textarea:focus` | `border-color` | border | — | 1.79 | 3.70 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 111 | `editorial.css:2896` | `.k-file-attach:hover` | `background` | background | `var(--ink)` | 15.03 | 13.68 | 4.5 | pass |
| 112 | `editorial.css:2934` | `.k-modal__head` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 113 | `editorial.css:2958` | `.k-modal__prio.is-active` | `background` | background | `var(--ink)` | — | — | 4.5 | voided (undefined var) |
| 114 | `editorial.css:2966` | `.k-modal__person.is-active` | `background` | background | `var(--ink)` | 14.23 | 12.42 | 4.5 | pass |
| 115 | `editorial.css:2975` | `.k-modal__attach:hover` | `background` | background | `var(--ink)` | 15.03 | 13.68 | 4.5 | pass |
| 116 | `editorial.css:3023` | `.k-cust__head` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 117 | `editorial.css:3057` | `.k-input:focus` | `border-color` | border | — | 1.88 | 4.33 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 118 | `editorial.css:3067` | `.k-select:focus` | `border-color` | border | — | 1.88 | 4.33 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 119 | `editorial.css:3285` | `.k-modcard:hover` | `box-shadow` | box-shadow | — | 1.11 | 1.17 | 3 | BELOW |
| 120 | `editorial.css:3312` | `.k-modtable tbody tr:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 121 | `editorial.css:3350` | `.k-shimmer__tile` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 122 | `editorial.css:34` | `::selection` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 123 | `editorial.css:3409` | `.k-formpanel__input:focus` | `box-shadow` | box-shadow | — | 1.11 | 1.17 | 3 | BELOW |
| 124 | `editorial.css:3481` | `.k-netbox` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 125 | `editorial.css:3482` | `.k-netbox` | `border` | border | — | 1.32 | 1.49 | 3 | BELOW |
| 126 | `editorial.css:3542` | `.k-inbox__row.is-unread` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 127 | `editorial.css:3543` | `.k-inbox__row.is-unread` | `border-color` | border | — | 1.56 | 2.47 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 128 | `editorial.css:3565` | `.k-approval-row:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 129 | `editorial.css:3790` | `.k-onboard-pill__count` | `background` | background | `var(--primary-text)` | 6.63 | 6.35 | 4.5 | pass |
| 130 | `editorial.css:3875` | `.trp__ref` | `background` | background | `var(--primary-text)` | 6.86 | 6.79 | 4.5 | pass |
| 131 | `editorial.css:3907` | `.k-tmpl-tab.is-active .k-tmpl-tab__count` | `background` | background | `var(--primary-text)` | 6.75 | 6.58 | 4.5 | pass |
| 132 | `editorial.css:3908` | `.k-tmpl-tab.is-active .k-tmpl-tab__count` | `border-color` | border | `var(--primary-text)` | 1.24 | 1.51 | 3 | BELOW |
| 133 | `editorial.css:3929` | `.k-tmpl-card--new:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 134 | `editorial.css:3971` | `.k-cmdk` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 135 | `editorial.css:3974` | `.k-cmdk` | `border` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 136 | `editorial.css:4009` | `.k-cmdk__item:hover, .k-cmdk__item--active` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 137 | `editorial.css:4025` | `.k-shortcuts` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 138 | `editorial.css:4028` | `.k-shortcuts` | `border` | border | — | 1.15 | 1.24 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 139 | `editorial.css:4063` | `.k-kbd` | `background` | background | `var(--ink-2)` | 6.51 | 7.66 | 4.5 | pass |
| 140 | `editorial.css:4088` | `.k-glass` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 141 | `editorial.css:4091` | `.k-glass` | `border` | border | — | 1.12 | 1.18 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 142 | `editorial.css:417` | `.side__item.on` | `background` | background | `#fff` | — | — | 4.5 | unresolvable |
| 143 | `editorial.css:4175` | `[data-theme="dark"] .k-trow:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 144 | `editorial.css:4176` | `[data-theme="dark"] .k-approval-row:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 145 | `editorial.css:4177` | `[data-theme="dark"] .k-file-attach:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 146 | `editorial.css:4178` | `[data-theme="dark"] .k-tmpl-card--new:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 147 | `editorial.css:4179` | `[data-theme="dark"] .k-btn--reject:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 148 | `editorial.css:4181` | `[data-theme="dark"] .k-inboxrow.is-unread` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 149 | `editorial.css:4182` | `[data-theme="dark"] .k-inboxrow.is-unread` | `border-color` | border | — | 1.68 | 3.05 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 150 | `editorial.css:464` | `.side__badge` | `background` | background | `var(--primary-vivid)` | — | — | 4.5 | unresolvable |
| 151 | `editorial.css:784` | `.adm__badge` | `background` | background | `#fff` | — | — | 4.5 | unresolvable |
| 152 | `editorial.css:822` | `.adm__item.on` | `background` | background | `#fff` | — | — | 4.5 | unresolvable |
| 153 | `editorial.css:840` | `.adm__count` | `background` | background | `#fff` | — | — | 4.5 | unresolvable |
| 154 | `editorial.css:972` | `.k-btn--primary` | `box-shadow` | box-shadow | `var(--on-primary)` | 3.01 | 1.52 | 3 | BELOW |
| 155 | `editorial.css:984` | `.k-btn--primary:hover` | `box-shadow` | box-shadow | — | 1.38 | 2.03 | 3 | BELOW |
| 156 | `editorial.css:994` | `.k-btn--reject` | `border` | border | `var(--danger)` | 2.08 | 2.70 | 3 | BELOW |
| 157 | `editorial.css:996` | `.k-btn--reject:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 158 | `ganit.css:331` | `.gnd__wa` | `border-color` | border | — | 2.01 | 3.51 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 159 | `ganit.css:353` | `.gn-upi` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 160 | `generate-report.css:145` | `.gr__range input[type="date"]:focus` | `box-shadow` | box-shadow | — | 1.25 | 1.19 | 3 | BELOW |
| 161 | `generate-report.css:175` | `.gr__chip.is-active` | `border-color` | border | `var(--ink)` | 1.65 | 2.91 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 162 | `generate-report.css:176` | `.gr__chip.is-active` | `box-shadow` | box-shadow | `var(--ink)` | 1.09 | 1.13 | 3 | BELOW |
| 163 | `generate-report.css:205` | `.gr__person.is-active` | `border-color` | border | — | 1.65 | 2.91 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 164 | `generate-report.css:206` | `.gr__person.is-active` | `box-shadow` | box-shadow | — | 1.09 | 1.13 | 3 | BELOW |
| 165 | `generate-report.css:243` | `.gr__toggle.is-on` | `border-color` | border | — | 1.60 | 2.68 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 166 | `generate-report.css:282` | `.gr__radio.is-on` | `border-color` | border | — | 1.65 | 2.91 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 167 | `generate-report.css:283` | `.gr__radio.is-on` | `box-shadow` | box-shadow | — | 1.09 | 1.13 | 3 | BELOW |
| 168 | `generate-report.css:326` | `.gr__emails input:focus` | `box-shadow` | box-shadow | — | 1.25 | 1.19 | 3 | BELOW |
| 169 | `generate-report.css:495` | `.gr__export-btn.is-busy` | `border-color` | border | — | 1.70 | 3.15 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 170 | `generate-report.css:496` | `.gr__export-btn.is-busy` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 171 | `generate-report.css:642` | `.gr__export-btn--pdf:hover:not(:disabled)` | `border-color` | border | — | 2.25 | 2.94 | 3 | BELOW |
| 172 | `generate-report.css:645` | `.gr__export-btn--xlsx:hover:not(:disabled)` | `border-color` | border | — | 2.06 | 3.47 | 3 | BELOW |
| 173 | `graha.css:149` | `.gr__card--late` | `border-color` | border | — | 2.08 | 2.70 | 3 | BELOW |
| 174 | `graha.css:227` | `.gr__chip` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 175 | `graha.css:246` | `.gr__count` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 176 | `graha.css:306` | `.gr__tldot` | `background` | background | — | — | — | 3 | voided (undefined var) |
| 177 | `graha.css:340` | `.gr__kbcard--warn` | `border-color` | border | — | 1.58 | 2.26 | 3 | BELOW |
| 178 | `graha.css:342` | `.gr__kbcard--crit` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 179 | `graha.css:343` | `.gr__kbcard--crit` | `border-color` | border | — | 1.76 | 2.26 | 3 | BELOW |
| 180 | `graha.css:352` | `.gr__kbstage` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 181 | `graha.css:370` | `.gr__rot` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 182 | `inbox.css:376` | `.k-notifbanner[data-tone="warn"] .k-notifbanne` | `background` | background | `var(--on-warn-container)` | 8.63 | 11.06 | 4.5 | pass |
| 183 | `inbox.css:391` | `.k-notifbanner[data-tone="primary"] .k-notifba` | `background` | background | `var(--on-primary-container` | 11.99 | 11.26 | 4.5 | pass |
| 184 | `kartavaya-design.css:1030` | `.k-pri--urgent` | `background` | background | `var(--pr-urgent)` | 4.57 | 5.47 | 4.5 | pass |
| 185 | `kartavaya-design.css:1031` | `.k-pri--high` | `background` | background | `var(--pr-high)` | 4.13 | 6.61 | 4.5 | BELOW |
| 186 | `kartavaya-design.css:1032` | `.k-pri--medium` | `background` | background | `var(--pr-medium)` | 4.85 | 5.77 | 4.5 | pass |
| 187 | `kartavaya-design.css:1033` | `.k-pri--low` | `background` | background | `var(--pr-low)` | 4.37 | 4.92 | 4.5 | BELOW |
| 188 | `kartavaya-design.css:1213` | `.k-nitem.is-unread` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 189 | `kartavaya-design.css:1252` | `.k-input:focus` | `border-color` | border | — | 1.88 | 4.33 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 190 | `kartavaya-design.css:1270` | `.k-select:focus` | `border-color` | border | — | 1.88 | 4.33 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 191 | `kartavaya-design.css:834` | `.k-hero::after` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 192 | `landing.css:51` | `.lnav.solid` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 193 | `manav.css:284` | `.mn-chip` | `background` | background | `var(--c, var(--on-surface-` | 4.15 | 5.06 | 4.5 | BELOW |
| 194 | `manav.css:291` | `.mn-chip:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 195 | `mobile-responsive.css:317` | `.tbl__wrap::-webkit-scrollbar-thumb,
  .k-tab` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 196 | `mobile-responsive.css:412` | `.bd .bc::before` | `background-image` | background-image | — | — | — | 3 | surface only (fg inherited) |
| 197 | `module.css:110` | `.mt` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 198 | `module.css:197` | `.mwarn:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 199 | `module.css:268` | `.gdeal--stale` | `border-color` | border | — | 2.63 | 4.94 | 3 | BELOW |
| 200 | `module.css:301` | `.note--info` | `background` | background | `var(--on-surface-2)` | 6.72 | 9.35 | 4.5 | pass |
| 201 | `module.css:343` | `.rv__r.is-cursor` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 202 | `module.css:69` | `.mh__ic` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 203 | `org.css:135` | `.gc` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 204 | `org.css:150` | `.rb` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 205 | `org.css:189` | `.amx td, .amx tbody th` | `border-bottom` | border | — | 1.16 | 1.27 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 206 | `org.css:211` | `.amx__cell.set` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 207 | `org.css:232` | `.ogr__r.on` | `border-color` | border | — | — | — | 3 | voided (undefined var) |
| 208 | `org.css:232` | `.ogr__r.on` | `background` | background | — | — | — | 3 | voided (undefined var) |
| 209 | `org.css:267` | `.omod__ic` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 210 | `org.css:318` | `.odz` | `border` | border | — | 1.65 | 1.70 | 3 | BELOW |
| 211 | `org.css:319` | `.odz` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 212 | `org.css:35` | `.of__i:focus` | `box-shadow` | box-shadow | — | 1.22 | 1.26 | 3 | BELOW |
| 213 | `org.css:50` | `.of__i[aria-invalid="true"]:focus` | `box-shadow` | box-shadow | — | 1.32 | 1.29 | 3 | BELOW |
| 214 | `org.css:65` | `.olg__z.over` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 215 | `org.css:88` | `.omt td` | `border-bottom` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 216 | `pahchan.css:331` | `.pcal__d` | `background` | background | `var(--c, var(--on-surface-` | 4.82 | 5.81 | 4.5 | pass |
| 217 | `pahchan.css:337` | `.pcal__key i` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 218 | `prachar.css:304` | `.pr__pill` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 219 | `prachar.css:416` | `.pr__wcard` | `background` | background | — | — | — | 3 | voided (undefined var) |
| 220 | `prachar.css:571` | `.pr__del:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 221 | `reports.css:122` | `.trp-mem__fill` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 222 | `reports.css:189` | `.rep-seg__btn.is-on` | `background` | background | `var(--primary-text)` | 6.63 | 6.79 | 4.5 | pass |
| 223 | `reports.css:65` | `.trp-daily__bar--on` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 224 | `sanvaad.css:1130` | `.msg--sys .msg__glyph` | `background` | background | `var(--glyph, var(--primary` | 3.16 | 6.35 | 4.5 | BELOW |
| 225 | `sanvaad.css:259` | `.sv__newline::before, .sv__newline::after` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 226 | `sanvaad.css:594` | `.cmp__ta:focus` | `box-shadow` | box-shadow | — | 1.22 | 1.26 | 3 | BELOW |
| 227 | `sanvaad.css:840` | `.wahdr__ic` | `background` | background | `var(--wa-green)` | 2.35 | 5.30 | 4.5 | BELOW |
| 228 | `sanvaad.css:954` | `.wa__win` | `border-top` | border | `var(--on-warn-container)` | 1.51 | 1.92 | 3 | BELOW |
| 229 | `settings.css:16` | `.sr` | `border-bottom` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 230 | `settings.css:160` | `.sbg__pv--light i` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 231 | `settings.css:262` | `.nkind__r` | `border-bottom` | border | — | 1.18 | 1.31 | 3 | below 3:1 — decorative rule, 1.4.11 n/a |
| 232 | `settings.css:274` | `.dz` | `border` | border | — | 1.65 | 1.70 | 3 | BELOW |
| 233 | `settings.css:275` | `.dz` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 234 | `settings.css:328` | `.au__mesh` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 235 | `srijan.css:207` | `.hb-btn--danger:hover` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 236 | `srijan.css:219` | `.hb-pill` | `background` | background | `var(--c)` | — | — | 4.5 | voided (undefined var) |
| 237 | `srijan.css:238` | `.hb-chip.on` | `background` | background | `var(--primary-text)` | 6.63 | 6.79 | 4.5 | pass |
| 238 | `srijan.css:376` | `.hb-chat__row.on` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 239 | `srijan.css:47` | `.hb-card--lit` | `border-color` | border | — | 2.14 | 3.42 | 3 | BELOW |
| 240 | `srijan.css:515` | `.hb-ptoggle.on` | `background` | background | `var(--on-surface)` | — | — | 4.5 | voided (undefined var) |
| 241 | `srijan.css:573` | `.hb-acct` | `background` | background | — | — | — | 3 | voided (undefined var) |
| 242 | `srijan.css:574` | `.hb-acct` | `border` | border | — | — | — | 3 | voided (undefined var) |
| 243 | `srijan.css:640` | `.hb-cal__e` | `background` | background | `var(--on-surface)` | — | — | 4.5 | voided (undefined var) |
| 244 | `srijan.css:662` | `.sk-glyph` | `background` | background | `var(--primary-text)` | 6.47 | 6.58 | 4.5 | pass |
| 245 | `srijan.css:731` | `.sk-icon.on` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 246 | `srijan.css:830` | `.sr-pick.on` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 247 | `vetana.css:182` | `.vt-gap` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 248 | `vetana.css:236` | `.vt-cal__i--late` | `border-color` | border | — | 2.64 | 3.46 | 3 | BELOW |
| 249 | `vetana.css:237` | `.vt-cal__i--late` | `background` | background | — | — | — | 3 | surface only (fg inherited) |
| 250 | `workflow.css:53` | `.prj-bin` | `border-color` | border | — | 1.39 | 1.37 | 3 | BELOW |
