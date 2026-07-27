# The component set — pixel and type

Branch `worktree-agent-acaf6b38c2219c9e3`. Everything below was **rendered and
measured**, never read off a stylesheet and typed into a sentence. Two tools
were built to make that true and both are committed:

| tool | what it measures | run it |
|---|---|---|
| `frontend/scripts/check-component-parity.mjs` | reference vs build, rule by rule: class-root coverage, modifier drift, state drift, declaration drift, token literals, hard-coded radii | `cd frontend && node scripts/check-component-parity.mjs --md` |
| `frontend/scripts/check-accent-contrast.mjs` | the 12 accent presets x 2 themes x {rest, hover} — 48 pairs no CSS checker can see | `cd frontend && node scripts/check-accent-contrast.mjs --md` |
| `frontend/public/__ref/_probe.html` + `_compare.html` | **rendered** computed styles for 65 specimens in both CSS systems, diffed in-page | gitignored; see §0 |

---

## 0 · Method, and the three ways it could have lied

**Render both sides, same markup.** `_probe.html?css=ref` links the reference's
`{tokens,app,motion,components}.css`; `?css=build` links the build's real
cascade — and it *fetches* `src/styles/index.css` and parses its `@import` list
at runtime rather than copying it, so the barrel order cannot drift. Identical
fixture markup on both sides, so anything that differs is CSS and nothing else.

**States are resolved, not simulated.** `:hover`, `:focus-visible` and `:active`
cannot be triggered from script. So every rule whose selector matches once the
state pseudo is stripped is collected, its declarations are applied inline to a
clone that already carries the base classes, and the clone is measured — which
resolves `var()` and `color-mix()` to real rgb, something reading the
declaration text never does. `:disabled` uses the real attribute.

**The typeface is neutralised.** `?font=match` forces both sides onto the
reference's stacks. Without it every width in the report is a type difference
wearing a layout difference's clothes — the two systems do not ship the same UI
face (§4).

Four bugs in my own instruments, each caught by the output disagreeing with the
files rather than by re-reading the code:

1. **Copying declarations longhand-by-longhand applied nothing.**
   `background: var(--primary-hover)` is stored as a pending-substitution
   value: iterating the declaration yields nine `background-*` longhands and
   every one reads back as `""`. Every hover state measured identical to rest
   and looked like a finding. Fixed by copying `cssText`.
2. **`requestAnimationFrame` never fires in an offscreen iframe.** The compare
   page sat on "running…" forever. Chrome throttles rAF outside the viewport; a
   timer is not throttled.
3. **The token comparison read `@media (prefers-reduced-motion)` as
   unconditional**, and so accused the build of five duration diffs and two
   glass diffs that do not exist.
4. **`document.fonts.ready` resolves before a face the page has not used yet is
   even requested.** The first pass measured the build's buttons against the
   system fallback and reported 33px where Inter gives 32px. Every face is now
   loaded by name and the geometry re-read until it stops moving.

And one process failure worth recording: **the browser MCP is shared across
every running agent.** Early readings landed on a sibling's page. Every reading
in this report asserts `location.href` before it is believed, per
`_COORDINATION.md §0b`.

---

## 1 · Baseline first — and it moved twice under me

The harness carries `data-density="cozy"` and `data-display="serif"`. A
different build default makes every number meaningless, so this was checked
before anything else. **Both halves have since been fixed by siblings**, and
this section records the verified end state rather than what I found:

| token | ref `compact` | build `compact` | ref `cozy` | build `cozy` | ref `comfy` | build `comfy` |
|---|---|---|---|---|---|---|
| `--row-h` | 34px | 34px | 44px | 44px | 54px | 54px |
| `--pad-page` | 18px | 18px | 28px | 28px | 38px | 38px |
| `--pad-card` | 12px | 12px | 18px | 18px | 24px | 24px |
| `--gap-section` | 14px | 14px | 22px | 22px | 30px | 30px |
| `--gap-tight` | 7px | 7px | 10px | 10px | 14px | 14px |
| `--t-body` | 13px | — | — | — | 15px | — |
| `--t-body-sm` | 12px | — | — | — | — | — |

Generated, not transcribed. **The tiers now match exactly and `cozy` is the
default on both sides.** `--radius-base` likewise moved 10 → 12 mid-run, which
zeroed a −1.16px radius delta that had been on every button, input, chip and
picker row in the product.

**The one residual, and it is a type question, not a spacing one:** the
reference's density tiers also move body size — `--t-body` 13px at compact and
15px at comfy, `--t-body-sm` 12px at compact. The build's do not; its
`--t-body` is `var(--font-size-base)`, driven by an independent Text-size
slider the reference does not have. Coupling the two would make density fight
the slider, so **the build is probably right and this needs the owner, not a
patch.** Named here because it is the last measurable density divergence and it
will otherwise be rediscovered.

---

## 2 · The port is far more faithful than the reports suggest

`check-component-parity.mjs`, current run:

```
roots: ref 220, build 411
missing roots      : 3   .icobtn .offb .rmp
modifier drift     : 2 roots
state drift        : 5 roots
declaration drift  : 17 selectors
token literal drift: 4 differ, 0 missing from build, 190 build-only
hard-coded radii   : 77 real corners + 49 literal pills
```

Rendered, light theme, typeface neutralised, at the start and end of this
session:

| | specimens byte-identical across every state |
|---|---|
| session start | **8 of 65** |
| now | **33 of 65** |

Byte-identical now: `btn--fill` `btn--tonal` `btn--ghost` `btn--text`
`btn--danger` `btn--sm` `btn--lg` `badge` `badge--n` `tgl.on` `tgl.on::after`
`cbx.on` `cbx.mixed` `rdo.on` `fldx__lbl` `fldx__hint` `fldx__err`
`fldx.is-error .fldx__in` `fldx__opt` `fldc__t` `fldc__s` `prg` `prg__f`
`pk__tr` `pk__tr.is-empty` `pk__row` `pk__row.on` `pk__m` `pk__q` `pk__new`
`pk__none` `card__hi` `hi (label)`.

**The entire picker — 71 selectors, the largest component in the system —
matches the reference exactly.** So does every button variant. That is worth
saying plainly, because three reports in a row have implied the component layer
is broadly adrift and the measurement says it is not.

Of the 32 that still differ, by cause:

| cause | specimens | verdict |
|---|---|---|
| `--outline` darkened for WCAG 1.4.11 (§3) | 8 | **deliberate divergence, shipped** |
| `.seg` family: `09-customization.md` overrides `app.css` (§6) | 4 | **build is correct** |
| class exists on one side only (`icobtn`/`k-iconbtn`, `k-btn`, `k-input`, `k-card`, `k-statuschip`, `avs__more`, `btn--dangerfill`) | 9 | fixture artefact + coverage, sibling's lane |
| `.card` — `02-common-components.md` vs `app.css:150` | 2 | known spec conflict, unresolved |
| `.tst` / `.tip` measured mid-entrance-animation | 2 | measurement artefact, not a defect |
| the universal reset (§7) | 3 | deliberate, small |
| `.chip:hover` | 2 | **build is correct** — see §6 |

---

## 3 · SHIPPED · `--outline` failed 1.4.11 on eleven of twelve surfaces

The one item my brief named as squarely mine. It was left open in
`a11y-responsive-audit.md §9` because a luminance change to a system-wide token
is a whole-app visual diff; that reason expired.

`--outline` is the border of every text input, checkbox, radio and select
trigger — exactly the "visual information required to identify user interface
components" that WCAG 1.4.11 wants at 3:1. Measured against **all seven
surfaces in its own theme**, not against `--bg` alone:

#### LIGHT — `#ADA692` → `#78725F`

| | `--s-lowest` | `--surface` | `--s-low` | `--bg` | `--s-container` | `--s-high` | `--s-highest` |
|---|---|---|---|---|---|---|---|
| was | 2.41 | 2.27 | 2.15 | 2.12 | 2.00 | 1.86 | **1.71** |
| now | 4.76 | 4.49 | 4.26 | 4.19 | 3.96 | 3.68 | **3.38** |

#### DARK — `#5B626C` → `#7E8590`

| | `--s-lowest` | `--bg` | `--surface` | `--s-low` | `--s-container` | `--s-high` | `--s-highest` |
|---|---|---|---|---|---|---|---|
| was | 3.22 | 3.14 | 2.97 | 2.80 | 2.60 | 2.32 | **2.01** |
| now | 5.33 | 5.20 | 4.92 | 4.65 | 4.30 | 3.83 | **3.33** |

Chosen with headroom rather than at the 3:1 minimum — light `#7E7663` bottoms
out at 3.17 — and holding the warm khaki hue rather than sliding grey. **No
rule in the tree paints `--outline` as text**: 39 call sites, every one a
border, so 4.5:1 never applied. `--rule-strong` and `--border-strong` alias it
and moved with it. `check-contrast`'s non-text failures went 27 → 16; the
eleven that left are exactly the eleven `--outline` combinations.

This **diverges from the reference**, which still ships `#ADA692`. That is the
point: a spec'd pair below threshold is a spec defect to report, not to ship.

---

## 4 · SHIPPED · `--on-primary` never moved while `--primary` moved twelve ways

**The largest measured defect in the component set, and the light half of it
was not in any brief.**

`applyPrefs` overwrites `--primary`, `--primary-hover`, `--primary-text` and
`--primary-vivid` from the accent the user picks. `--on-primary` — the label on
that fill — was the one half of the pair left behind: declared once per theme,
`#FFFFFF` light and `#00332F` dark. `#00332F` is a near-black **teal**. It only
ever suited a teal accent.

Measured against the fill each preset actually produces at runtime:

| | rest pairs below 4.5:1 | worst |
|---|---|---|
| dark, before | **10 of 12** | **1.96** (Forest `#3f6212`) |
| light, before | **3 of 12** | **3.18** (Saffron) |
| dark, after | 2 of 12 | 3.69 |
| light, after | 2 of 12 | 3.87 |

**The light row indicts the shipped default.** Every earlier report measured
white against the stylesheet's `--primary: #04837A` and got 4.63. `applyPrefs`
never uses that literal — it writes `acc.mid`, which for the default teal is
`#00897f`, where white is **4.30**. *The token that was measured is not the
token that renders.*

`deriveOnAccent` considers white, black and the accent's own hue at every 2%
lightness step, and returns whichever maximises the **worse** of its two ratios
— against `--primary` and against `--primary-hover`, because `.btn--fill:hover`
swaps the background and keeps the label. The incumbent is in the candidate
set, so it can never return something worse than what shipped.

The maths moved to `src/lib/accent.js` with no React in it, because that is the
only reason no gate had ever reached it. Full 48-pair table:
`node scripts/check-accent-contrast.mjs --md`.

**Residual, needs an owner:** four rest pairs stay below 4.5 — light Teal 4.30
and Coral 3.87, dark Violet 3.69 and Slate 4.41. Those fills are mid-tone: *no*
foreground clears 4.5:1 on `#00897f` while staying legible on its own hover.
Closing them means changing the accent **ramp** (`--primary` is `mid` in light
and the raw accent in dark), which is a design decision and not one to make
inside a contrast helper. They are named in `KNOWN_RESIDUAL` so a fifth cannot
appear quietly.

Two ratios in `kartavaya-design.css`'s own `--primary` comment were also wrong,
both inherited from `23-accessibility.md`'s contrast table: it claims 5.1 for
the `--on-primary` pair (measured **4.63** — overstated by 0.47, so the margin
is half what the table advertises) and 5.2 for `--primary-text` (measured
**5.56**). Corrected in the comment and **recorded as a spec defect**, because
the table is what the next person reads.

---

## 5 · SHIPPED · the button reset was missing the three declarations that matter

The reference resets `button` with five declarations (`app.css:7`). The build
had two. The three it dropped — `border: 0`, `background: none`,
`color: inherit` — decide what a button looks like when its class does not say.

`.k-btn` (`editorial.css:702`) is the build's most-used button, 65 files. Its
base rule declares `border: 0` and then no background and no colour, so a bare
`<button className="k-btn">` fell through to the user-agent stylesheet.
Measured, not assumed: **rgb(240,240,240) on rgb(0,0,0) with a 2px `outset`
border, in BOTH themes** — in dark, a pale grey slab with black text on a
near-black page. `PracharPage.jsx` renders it bare at ten call sites, which now
carry `k-btn--ghost`.

An element selector is specificity 0,0,1 and loses to every class rule whatever
the order, so restoring the reset cannot override a styled button. `input,
textarea, select` one line below already inherits colour for this exact reason.

Effect, measured: byte-identical specimens 13 → 18 light and 15 → 18 dark.
`.tgl.on`, `.tgl.on::after` and `.rdo.on` became exact — they had been carrying
UA `buttontext` on controls whose own rules never set a colour.

---

## 6 · The two places the build is RIGHT and the reference is wrong

Both were on their way to being "fixed" toward the reference.

**`.seg` — `09-customization.md:79-81` overrides `app.css:120-125`.**

| | `app.css` | `09-customization.md` | build |
|---|---|---|---|
| group radius | `--r-sm` | **`--r-pill`** | pill |
| group background | `--s-container` @ 80% | `--s-container` | solid |
| button radius | `calc(--r-sm - 2px)` | **`--r-pill`** | pill |
| button weight | 600 | **500** | 500 |
| selected background | `--s-lowest` | **`--surface`** | `--surface` |
| selected weight | (inherits 600) | **600** | 600 |

A sibling's table reads the build as "wrong on weight, radius family and the
count chip". It is wrong only against `app.css`. `09` is the handover for these
exact screens and the newer of the two, and the build follows it verbatim.
**Moving it would be a regression.** The table is now in `settings.css` beside
the rule so the next reader checks the source before the value.

**`.seg__n` — the reference's version is a contrast defect.** `app.css:124`
makes it a tinted chip: `--on-surface-3` on a 14% tint of itself. That is the
SPEC-A11Y-3 pattern, and measured on its **own tinted ground** rather than on
`--bg` it is **4.04:1**. The build's plain `--on-surface-3` on `--s-container`
is **4.56:1**. Accessibility beats fidelity, and here the build already had it.
Not ported.

**`.chip:hover`.** The reference hovers every `.chip`. The build scopes it to
`.chip[role="button"], button.chip, a.chip` — a static chip is not hoverable,
and giving it a hover state is a lie about affordance. Reported by the probe as
"declared / NO RULE"; it is an improvement, not a gap.

**One real gap in the same control, and it is fixed:** `.seg__b` declared
`transition: background, color` and had **no `:hover` rule at all**, so the
transition animated a property nothing ever moved. `app.css:122` has the value
both sources omit — `--on-surface-2`, 7.00:1 on `--s-container` against the
5.07:1 of rest. Placed *before* `.on`, deliberately: same specificity, so
document order decides, and the other way round hovering the selected segment
drops it from `--on-surface` to `--on-surface-2` and reads as losing the
selection.

---

## 7 · SHIPPED · six radii the Corner radius control could never move

`00-tokens.md §96`, verbatim: *"Never hard-code a radius. A literal
`border-radius: 8px` breaks the Sharp and Pill settings in exactly that one
place."* §7 of the parity script finds every one:

- **77 real corners** — of which **64 are >= 4px**, a corner a user would see
  move. The other 13 are 1-3px hairline softening on dots, bars and ticks,
  where a token that scales to 20px under Pill would be wrong.
- **49 pills written the long way** (`99px` instead of `--r-pill`).

Six were converted, all ports of a reference component whose token is known, so
nothing was guessed:

| selector | was | now | reference |
|---|---|---|---|
| `.k-iconbtn` (editorial + kartavaya-design) | `8px` | `var(--r-sm)` | `.icobtn`, `app.css:89` |
| `.k-input` (both) | `8px` | `var(--r-sm)` | `.fldx__in` |
| `.k-select` (both) | `8px` | `var(--r-sm)` | matched to `.k-input` beside it |

Each is declared twice — `editorial.css` wins by document order and
`kartavaya-design.css` carries a copy — so both moved. That is the failure mode
`editorial.css:702`'s own comment already records against itself.

After the change and the base moving to 12, `.k-iconbtn` measures **identical
to the reference's `.icobtn`** on box (34x34), colour, background and type;
only the flex centring padding differs, which is cosmetically invisible on a
`place-items: center` box.

The remaining 77 + 49 are listed with `file:line` and nearest token in the
script's output. They are a sweep across seven stylesheets and a sweep mid-run
is how merge conflicts get made.

---

## 8 · SHIPPED · avatar initials were 600/.01em where the reference is 700/.02em

`.av` (`app.css:203`) is `font-weight: 700; letter-spacing: .02em`. The port
landed on 600/.01em. Both numbers carry more weight here than anywhere else in
the system: `Avatar.jsx:29` sizes the initials at `size * 0.41`, which is ~10px
on the default 24px avatar — **under 11px, white on a mid-tone fill, two
letters with no word shape to fall back on.** Weight and tracking are the only
legibility left and the reference spends both.

`.avstack__n`, the "+3" overflow chip, was 600 for the same reason and is now
700 — which is also what `.k-avstack__more` (`editorial.css:892`) has always
been, so **the build's two overflow chips had been disagreeing with each
other**. `Avatar.jsx` renders the `components.css` one.

---

## 9 · NOT FIXED — measured, and each needs someone else

### 9a · `--font-ui` is Inter; the spec says Public Sans

`00-tokens.md:42` names `"Public Sans"` as `--font-ui`. The build ships
`'Inter'` — as the token default (`kartavaya-design.css:58`), as `UI_FONTS[0]`,
and Public Sans is not among the four UI options nor in `index.html`'s font
link. This is a whole-product type change and the single largest remaining
fidelity gap in the component set.

Measured, "Save changes" at 600 weight / 13px:

| face | width | delta |
|---|---|---|
| Public Sans | 84.22px | — |
| Inter | 87.98px | **+4.46%** |

That 4.46% lands on every button, chip, table cell and label in the product.
The `.btn--fill` specimen is 114.22px in the reference and 109.23px in the
build once radius is equal — the difference is entirely the face.

**Report, do not ship.** Inter and Public Sans are both neutral grotesques;
which one is right is the owner's call, and swapping it mid-swarm would move
every width every other agent is currently measuring. `CustomizePanel.jsx:50`
already records why the option list was trimmed from six to four.

### 9b · `--shadow-4` is a copy-paste bug in the reference

`tokens.css:216` gives dark `--shadow-4` the *light* value —
`rgba(30, 28, 22, .30)` — where `--shadow-1`, `-2` and `-3` all switch to
`rgba(0, 0, 0, …)` in dark. **The build already fixed it** (`0 32px 72px -28px
rgba(0,0,0,.9)`). Recorded so nobody "corrects" the build toward the reference.

### 9c · `.card` — `02-common-components.md` vs `app.css:150`, still unresolved

Measured: reference `--r-lg` (17.4px) + no shadow + `overflow: hidden`; build
`--r-md` (12px) + `--shadow-1` + no `overflow`. Already logged in
`_COORDINATION.md §7` as a spec conflict; adding only the measurements.
`overflow: hidden` is the half nobody has mentioned — without it, content
cannot be clipped to the card's own corners.

### 9d · the universal reset

`src/lib/tokens.css` has `*, ::before, ::after { box-sizing: border-box;
margin: 0; padding: 0 }`; the reference has only `* { box-sizing: border-box }`.
Consequences measured: the picker's search input is 19.5px tall in the build
against 21.5px in the reference (the UA's `1px 2px` input padding), and
`.pk__pop` is 2px shorter. Deliberate and defensible — recorded so the 2px is
not chased as a picker bug. **It also means every `.card` height comparison
against a bare `<p>` fixture is meaningless**, which is why §2 does not list
`.card`'s 51-vs-23 as a defect.

### 9e · `brand.css` is imported by nothing

Not one `.js`/`.jsx` in the tree imports it. So `.k-pill-high`'s 2.24:1 in dark
and `.k-badge`'s 3.16:1 — both currently red in `check-contrast` — are failures
against a file that never loads. Stronger than "the classes are dead": the
whole stylesheet is. Whoever does the dead-CSS sweep should delete the file, and
`check-contrast` should skip stylesheets nothing imports so the gate stops
reporting phantom failures.

### 9f · `check-contrast.mjs` is RED on staging

It exits 1 today, on: the five tinted chips `a11y-responsive-audit.md §9.2`
left open, `.cbx` and `.av` (both documented there as false positives), the two
`brand.css` rules above, and `.wahdr__ic` (`sanvaad.css:644`, 2.35:1) which
landed after that report was written. **`--outline` no longer appears in it.**
The tinted chips still need the `--st-in-review` token decision that report
names; the remedies are measured there and I have not re-litigated them.

---

## 10 · Coverage gaps found while measuring — sibling's lane, listed not claimed

`worktree-agent-a1ce58fa7bfe79d35.md` owns coverage. These surfaced from the
rendered diff and are recorded there or here without duplication:

- **`.icobtn` does not exist in the build.** `.k-iconbtn` is its port under a
  different name and, after §7, is metrically identical.
- **`.avs` / `.avs__more` do not exist.** The build has *three* avatar-stack
  vocabularies: `.avstack` / `.avstack__n` (`components.css`, what `Avatar.jsx`
  renders) and `.k-avstack` / `.k-avstack__more` (`editorial.css`). Measured
  identical on colour, background and 50% radius; they differed on weight until
  §8.
- **`.offb`** (the reference's offline banner) is `.k-offline` in the build.
- **`.rmp`** is the inventory's own spacing-ramp illustration, not a product
  component.
- `.pk:disabled` has no rule in the build, where the reference declares one —
  the inventory demonstrates a disabled field-mode picker.

---

## 11 · A trap in the reference itself

`Components.jsx:151` renders the inventory's own segmented specimen as
`<div className="seg">` with **bare `<button>` children**, but `app.css` styles
`.seg__b`. So the Component Inventory's segmented control renders as three
user-agent buttons in a grey trough. Anyone measuring that specimen measures
the UA stylesheet twice and reports it as a finding — my first pass did exactly
that before the fixture was corrected to use `.seg__b`.

The same class of error produced `.pk__trg`, a class that exists in neither
system; the reference's picker trigger is `.pk__tr` (`components.css:76`). An
invented class name measures the user-agent stylesheet and reports it as a
missing component.

---

## 12 · Commits on this branch

| | |
|---|---|
| `tooling(design)` | `check-component-parity.mjs` — measure the port instead of describing it |
| `fix(a11y)` | `--outline` failed 1.4.11 on eleven of twelve surfaces |
| `fix(a11y)` | `--on-primary` never moved while `--primary` moved twelve ways (+ `src/lib/accent.js`, `check-accent-contrast.mjs`) |
| `fix(components)` | the button reset was missing the three declarations that matter |
| `fix(tokens)` | six radii the Corner radius control could never move (+ parity §7) |
| `docs(tokens)` | two ratios on the `--primary` comment were wrong, both from `23` |
| `fix(type)` | avatar initials were 600/.01em where the reference is 700/.02em |
| `fix(seg)` | the segmented control declared a transition nothing could trigger |
| `fix(tooling)` | the radius ramp is read, not assumed — the base moved 10 to 12 |

Gates green at every push: `check-tokens`, `check-classes`,
`check-touch-targets`, `check-accent-contrast`, `check-component-parity`.
`check-contrast` is red for the pre-existing reasons in §9f.
