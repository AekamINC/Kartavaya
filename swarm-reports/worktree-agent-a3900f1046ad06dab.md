# CRM · Sales · Finance — pixel and type, measured against the rendered reference

Branch `worktree-agent-a3900f1046ad06dab`. Surface: `graha` (CRM), `vikray`
(Sales), `ganit` (Finance), plus `frontend/src/styles/editorial.css`.

Every number below came out of `getComputedStyle` in a browser and was written
to disk by a script. None was typed by hand. The method is in §7 so it can be
re-run.

---

## 0 · Summary

| | |
|---|---|
| Matched selector pairs measured | 44 |
| Differing declarations, before this branch | 344 |
| Differing declarations, now | 294 |
| Of those, one root cause (the UI face) | 32 |
| Devanagari-bearing elements audited | 19 |
| Devanagari tracking/case violations found | 5 (2 in the reference, 3 in the build) |
| Devanagari violations fixed in the build | 2 of 3 |
| Wrong-node measurements caught and corrected | 3 |

The single biggest finding is §1. It is not a pixel; it is the baseline every
pixel was being measured against, and it was wrong.

---

## 1 · The baseline — every spacing number in the product was measured against a
scale the design does not define

The harness carries `data-density="cozy"` on `<html>`. The build had **no
`cozy` tier at all** — `kartavaya-design.css` defined only `compact` and
`comfy` — and `CustomizePanel.DEFAULTS.density` was `'comfy'`. `applyPrefs`
writes `data-density` unconditionally on every load, so every user got `comfy`.

Measured, at 1440×900:

| token | reference (`cozy`) | build, before | build, now |
|---|---|---|---|
| `--row-h` | 44px | **48px** | 44px |
| `--pad-page` | 28px | **32px** | 28px |
| `--pad-card` | 18px | **20px** | 18px |
| `--gap-section` | 22px | **26px** | 22px |
| `--gap-tight` | 10px | **12px** | 10px |
| `--radius-base` | 12px | **10px** | 12px |
| `--r-lg` | 17.39px | **14.5px** | 17.39px |

The `comfy` column is the important part: 48 / 32 / 20 / 26 / 12 appears
**nowhere in `design-reference/…/tokens.css`**. The reference's three tiers are
34/18/12/14/7, 44/28/18/22/10 and 54/38/24/30/14. The build's shipped default
sat between the middle and the loosest and matched neither.

`--pad-page` is `.kv__content`'s padding on every authenticated page and the
topbar's horizontal padding, so this was not a detail — it moved the whole
product 4px, and `--row-h` made every table row 4px taller than drawn.

`kartavaya-design.css`'s bare `:root` had been carrying exactly the cozy
numbers the whole time. It could never be reached, because an attribute
selector always beat it.

**Fixed** — three tiers with the reference's values, `cozy` as the default,
`cozy` added to the Density control (it had two options for three tiers, so the
default tier had no control that could return you to it). `--radius-base` 10 →
12 in the stylesheet, in `DEFAULTS.radius`, and in `applyPrefs`' fallback,
which had all three disagreeing.

A sibling branch reached the same two conclusions independently and landed
first; this branch merged theirs and kept the better-explained version of each.
Two independent measurements agreeing is the strongest evidence in this report.

### 1a · The type steps are ratios here, and that is deliberate

`tokens.css:228/230` also moves type with density — `--t-body` 13px on compact,
15px on comfy. Copying those literals would break the Text size slider: unlike
the reference, this build derives its whole scale from `--font-size-base`
(`kartavaya-design.css:66-79`) so one control moves everything. A literal 13px
would pin body text for every user at every slider position, but only while
they were on compact.

The tiers now carry `calc(var(--font-size-base) * .93)` and `* 1.07` — the
reference's own steps (13/14 and 15/14) expressed against the base. Both the
design's intent and the slider survive.

---

## 2 · Devanagari — where tracking leaks, and where it does not

19 distinct elements whose own text nodes contain Devanagari were audited by
rendering, across CRM, Sales and Finance on the reference side and the full
component probe on the build side. The rule (24-bilingual-devanagari.md):
Devanagari is `--font-hindi` / `--font-indic`, single weight 400, never tracked
and never uppercased.

`letter-spacing` is the trap. **It inherits as a resolved absolute length**, not
as an em value recomputed against the child's own font-size — so a parent's
`-.02em` lands on a Devanagari child at the parent's pixel value, and a child
that merely sets a smaller `font-size` does not escape it.

### Violations found

| side | element | family | tracking | case | verdict |
|---|---|---|---|---|---|
| REFERENCE | `.ph__kick` (`Revenue · राजस्व`) | UI, not a Devanagari face | **2.1px** (.2em) | uppercase | **spec defect** |
| REFERENCE | `.ph__hi` (the `ग्रह` / `विक्रय` / `गणित` headline) | Tiro | **-0.56px** | none | **spec defect** |
| BUILD | `.k-pageh__kicker` | Inter | **2.42px** (.22em) | uppercase | inherited from the reference; not on these three pages |
| BUILD | `.bd__cn-hi` (board column label) | Tiro | **-0.065px** | none | **FIXED** |
| BUILD | `.k-pageh__sans` | Tiro | **-0.88px** at 1440 | none | **FIXED** |

`.bd__cn-hi` inherited from `.bd__cn`'s `-.005em`; `.k-pageh__sans` from
`.k-pageh__h1`'s `-0.02em`. Both now reset with `letter-spacing: normal` and a
comment saying why, so the next person to add a sibling rule sees the trap.

### The two reference defects

`.ph__h1` sets `letter-spacing: -.02em` and `.ph__hi` — the large Devanagari
word that leads every module header in the design — does not reset it. So the
reference itself tracks its own Devanagari headline. Uppercase on `.ph__kick`
is a no-op for a script with no case, but the 0.2em tracking is real.

The kicker cannot be fixed in CSS alone: `Revenue · राजस्व` is **one text node
with two scripts**, so zeroing tracking for the Devanagari run requires
splitting the node in the component. Reported rather than half-fixed. The build
inherited exactly this shape in `.k-pageh__kicker`, which `BoardsPage` feeds
`AEKAM INC · फ़लक`.

### Clean, and worth recording as clean

`.mh__hi`, `.k-stat__hi`, `.card__hi`, `.k-card__sans` and the sidebar's
`.side__hi` / `.side__sec-hi` all resolve to Tiro at 400 with `letter-spacing:
normal`. `.k-stat__hi` earns this with an explicit `letter-spacing: 0` against
its parent's `.15em` uppercase — the pattern the two fixes above now copy.

A static sweep of all 92 selectors that opt into a Devanagari face found 24
sitting in a block where another rule sets tracking. Rendering showed most are
**siblings, not ancestors**, and therefore safe. The static list is a checklist,
not a verdict; the rendered measurement is the verdict. `.k-stat__sans`,
`.k-col__sans` and `.k-rule__sans` have no JSX renderer at all — dead CSS.

---

## 3 · Three measurements that were wrong, and how they were caught

The instruction for this branch warned that an earlier agent hand-typed four
ratios and got all four wrong. The failure mode is not arithmetic — it is
**measuring the wrong node and reporting the number confidently**. Three
happened here and all three were caught by recording each matched element's
`outerHTML` alongside its computed style.

| pair | what the selector actually hit | the false claim it produced |
|---|---|---|
| `chip` | `Chrome.jsx:254`, the topbar org switcher, inline-styled `padding: 4px 10px; font-size: 12px` | "build chip is 5px 12px against the reference's 4px 10px" — in fact the build matches `app.css:114` exactly |
| `muted text` | a content `.mute` with an inline `fontSize: 11` | "reference `.mute` is 11px" — `.mute` sets only a colour and has no font-size at all |
| `card: body` | the reference's first card on Sales is `flush` | "reference card body has no padding" |

After scoping, **the chip is identical on every measured property except the UI
face**. That row would have read as a defect and cost someone an afternoon.

Provenance capture is now part of the harness. Any row in the generated tables
can be traced to the exact element it came from.

---

## 4 · What was fixed, with before/after numbers

| element | property | reference | build before | build now |
|---|---|---|---|---|
| `.kv__content` | padding | 28px | 32px | 28px |
| table body row | height | 44px | 48px | 44px |
| `.k-stat` | padding | 18px | 16px 17px | 18px |
| `.k-stat` | border-radius | 17.4px | 10px | 17.4px |
| `.k-stat__val` | font-size | 34px | 31px | 34px |
| `.k-stat__lbl` | font-size / tracking | 10px / .15em | 9.5px / .16em | 10px / .15em |
| `.k-stat__hi` | font-size | 12px | 11px | 12px |
| `.k-stats` | track / gap | 180px / `--gap-tight` | 196px / 11px | 180px / `--gap-tight` |
| `.card` | border-radius | 17.4px | 10px | 17.4px |
| `.k-card__title` | font-size | 20px | 18px literal | `--t-title-lg` |
| `.k-card__head` / `__body` | padding | `--pad-card` | `--sp-4`/`--sp-5` | `--pad-card` |
| `.bd__cn-hi` | letter-spacing | normal | -0.065px | normal |
| `.k-pageh__sans` | letter-spacing | normal | -0.88px | normal |

Two structural side-effects worth naming:

**Double padding on `.k-card`.** `kartavaya-design.css` gave the shell
`padding: var(--sp-5)` while `editorial.css` gives `__head` and `__body` their
own. Measured: 20px on the shell **on top of** 16/20 on the head and 16/20/20
on the body, with the head's hairline inset 20px from each edge so it read as a
stray line rather than a divider. Resolved with the sibling's `:has(>
.k-card__head)` scoping, which is more careful than the blanket removal this
branch first reached for — twelve call sites render `.k-card` around bare
content and legitimately need the shell padding.

**Density overrides that defeated density.** `[data-density] .k-stat` and
`.k-card` carried literals that contradicted `--pad-card` in both directions —
`10px 14px` where the token is 12px, `16px 18px` where it is 24px — and beat it
on specificity (0,2,0 against 0,1,0). The two objects the setting is most
visible on were the two that had stopped responding to it. Removed.

---

## 5 · Deliberate divergences — measured, not "fixed"

Each of these is a place the build differs from the reference **on purpose**,
with a rationale already in the code. Recorded with numbers so nobody
"corrects" them in a later pass.

**Stat tile fill.** Reference: `--s-container`, no border. Build: `--surface`,
1px `--outline-variant`, plus a 2px `--c` bar at the top edge. That bar is how
the build carries the semantic tone while leaving the value as ink —
`StatTile.jsx` argues the case, and it is a look decision, not a measurement
error. The *scale* is now the reference's; the *fill* is the build's.

**Stat value colour.** Reference tints the value (`.stat--p .stat__v` →
`--primary-text`, `--ok`, `--warn`, `--danger`). Build keeps it `--on-surface`
always. Deliberate, documented.

**Tab count badge.** Reference `.seg__n` is a pill: 1px 6px, `--r-pill`,
`--on-surface-3` at 14%. Build `.mt__b .mt__n` is a bare inline mono numeral.
`module.css:145-157` states the reasoning, including why it does not use
`--on-surface-faint`. Deliberate.

**Devanagari leading.** Build gives `[lang="hi"]` extra line-height — measured
24.78px against the reference's 21px on `.card__hi`. This is a legibility
improvement over the reference, not a drift.

**Table head size.** Reference: 10px / 700 / .14em. Build `.tbl th`: `--t-label`
(12px floor) / 600 / .04em. The 12px floor is deliberate so the head tracks the
Text size slider and clears the 11px metadata minimum. **Accessibility beats
fidelity** — do not take this to 10px. The tracking gap (.04em vs .14em) is a
genuine open question and is a judgement call, not a measurement.

---

## 6 · Open findings — measured, not fixed, and why

Ordered by how visible each is.

**6.1 · The module tables are not on the table system.** `ganit/InvoicesTab.jsx`
renders a raw `<table>` with `fontSize: 13` inline, `th` at `padding: '8px 10px'`
/ 11px / 600 / uppercase, and every `td` at `padding: '10px'`. No `--row-h`, no
zebra, no sticky head, no card shell. So the Finance invoice list does not
respond to the density control at all, while the reference's `.tbl__row` is
`min-height: var(--row-h)` inside a `--r-lg` card with a sticky `--s-low` head.
`ui/Table.jsx` (`.tbl`) already implements the right object and *does* use
`--row-h`. This is a per-tab rewrite across `pages/ganit/*` and `pages/graha/*`
— too large for this pass and it belongs with whoever owns structure.

**6.2 · The module header inverts the bilingual hierarchy.** Reference `.ph`
leads with Devanagari at 28px display and puts English at 15.68px, 600,
uppercase, `.04em`. Build `.mh` leads with English at 25px display and puts
Devanagari at 15px. `ModuleHeader.jsx` says it is following "the same weighting
rule as the sidebar" — and the reference's *sidebar* does lead with English, but
its *module header* does the opposite. Someone should settle which the design
means; it is a component change, not a stylesheet one.

**6.3 · `Public Sans` is not loaded anywhere — by either side.** 32 of the 294
remaining rows are this one fact. Measured by width, `Handgloves 0123456789` at
40px:

| stack | reference | build |
|---|---|---|
| `var(--font-ui)` | 435.27px | 471.72px |
| `"Public Sans"` | **401.08px** | **401.08px** |
| `Inter` | 471.72px | 471.72px |
| `system-ui` | 435.27px | 435.27px |
| `serif` | 401.08px | 401.08px |

`"Public Sans"` measures **identical to bare `serif`** on both sides — it falls
all the way through, so it is not installed and neither `tokens.css`'s
`@import` nor the harness's font `<link>` requests it. The reference therefore
renders its UI in `system-ui` (435.27px), i.e. whatever the OS supplies, and
the build renders in Inter, which it does load.

This is a **spec/asset gap, not a build defect**, and the build's position is
the better one: a loaded webfont renders the same on every machine, while the
reference's first entry silently resolves to a different face per OS. Either
ship Public Sans or drop it from `--font-ui`. Do not "fix" the build toward a
font nothing loads.

`Tiro Devanagari Hindi` **is** loaded on both (433.92px, distinct from serif).

**6.4 · No `.kbd` rule exists in the build.** The reference styles a keycap —
`--s-high` ground, `--r-xs`, 2px 5px, 10px JetBrains Mono — and puts one in the
Finance page header (`{I.plus} Invoice ⌘N`) and in the topbar search. The build
has no rule for it anywhere; `check-classes.mjs` agrees. Not added here because
adding a rule with no consumer is dead CSS — it should land with the component
that needs it.

**6.5 · `.k-page`'s comfy padding is declared twice**, in
`kartavaya-design.css` (`var(--sp-6)`) and `editorial.css` (`var(--sp-6)
var(--sp-8)`), with the later import winning. Neither is on CRM/Sales/Finance —
all three use `<div style={{padding:'0 0 48px'}}>`, not `.k-page` — but the
duplicate will bite whoever does use it.

**6.6 · `.k-stats`, `.k-stat`, `.k-stat__lbl` and `.k-card` are each declared in
two stylesheets** with different values, resolved only by import order. This
pass changed the winning copy; the losing copies are still there and still
wrong. Deduplication is a separate, mechanical job.

**6.7 · `check-contrast.mjs` fails on staging** and did so before this branch.
Every failing pair is a colour in a file this branch does not touch — `.cbx`
(1.01:1), `.av` (1.31:1), `.k-pill-high`, `.wahdr__ic`, `.k-badge`, several
`.k-actitem__verb--*`. The a11y audit report records this gate as green, so
either that is stale or something regressed after it. Worth someone's
attention; it is colour work, not pixel work.

**6.8 · `--on-surface-faint` is safe as text, contrary to the brief.** The
instruction for this branch said it is NON-TEXT ONLY. Measured on both sides it
resolves to `--on-surface-3` (#666A61) — `tokens.css` aliases it and says so in
a comment. Computed against this surface's grounds: 4.90:1 on `--s-low`, 4.56:1
on `--s-container`. Its uses on this surface (`.bd__cc`, `.bc__id`) pass. The
brief's rule is stale relative to the token file.

**6.9 · `--primary` is never used as text.** Swept every stylesheet: all
`var(--primary)` uses are `background`, `border-color` or `box-shadow`. The rule
is already honoured; no action needed.

---

## 7 · How to re-run this

The mistake this whole exercise exists to correct is reading CSS instead of
rendering it. The harness makes rendering the cheap option.

```
# 1 · reference, served from the build's own origin so localStorage and
#     same-origin fetch both work
mkdir -p frontend/public/__ref
cp "design-reference/Kartavaya Redesign"/*.{jsx,css,png} frontend/public/__ref/
cp "design-reference/Kartavaya Redesign/Kartavaya Redesign.html" \
   frontend/public/__ref/measure.htm
# append to measure.htm: <script src="/__meas.js"></script>
#                        <script src="/__pairs.js"></script>
#                        <script src="/__runref.js"></script>

# 2 · collector — the pages POST their JSON here so numbers land on disk
node collector.js          # 127.0.0.1:5222, writes <name>.json

# 3 · dev server, then open in order, at 1440x900:
#     /__ref/measure.htm    → drives CRM → Sales → Finance, POSTs a3900-ref
#     /__probe.html         → the build's real components, POSTs a3900-build

# 4 · generate the tables
node a3900-diff.js
```

Four rules the harness enforces, each of which cost something to learn:

1. **Keep the harness out of `frontend/public/*.html`.** Vite's dep scanner
   treats every `.html` under the project as an entry and chokes on the JSX.
   `.htm` is not scanned.
2. **Check the viewport before trusting a number.** The first full run recorded
   390×844 — a mobile layout — and every spacing figure in it was worthless.
   The payload now carries `viewport` so a bad run is obvious.
3. **Record what each selector actually matched.** See §3.
4. **Resolve `calc()` before comparing.** `calc(14px * 2)` and `28px` are one
   decision written two ways; a string compare called four tokens different that
   were not.

Harness files are gitignored (`frontend/__probe.html`, `frontend/src/__probe.jsx`,
`frontend/public/__meas.js`, `__pairs.js`, `__runref.js`, `__runbuild.js`,
`__diff.htm`, `frontend/public/__ref/`) — the reference stays single-source in
`design-reference/`.

**The build cannot be measured through the authenticated shell without a
session**, and the shared Supabase database makes that the wrong thing to reach
for. `__probe.jsx` instead mounts the *real* presentational components —
`ModuleHeader`, `ModuleTabs`, `StatTile`, `Card`, `Table`, `Chip`, `Tag`,
`StatusChip` — inside the real `.kv > .kv__main > .kv__content` chain, with the
real CSS barrel and `applyPrefs(DEFAULTS)`. Same cascade, no network, no writes.

---

## 8 · Gates

| gate | result |
|---|---|
| `check-tokens.mjs` | green — 341 declared, 236 referenced, 0 missing |
| `check-classes.mjs` | green — 2166 selectors, 1486 classes, 0 missing a rule |
| `check-component-parity.mjs` | green (exit 0) |
| `vitest run src/__tests__` | 321 passed across 19 files |
| `check-contrast.mjs` | **fails, and fails identically on staging** — see §6.7 |

No database was read or written at any point.
