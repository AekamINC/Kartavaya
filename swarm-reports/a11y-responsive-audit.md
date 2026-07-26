# Accessibility & responsive audit — branch `a11y-responsive-audit`

Measurement-first report. Every ratio below was computed by
`frontend/scripts/check-contrast.mjs` (added by this branch), not estimated.
Every line number cited was opened at the commit it is quoted against.

Run it yourself:

```
cd frontend
node scripts/check-contrast.mjs            # parity + real pairs, exits non-zero on failure
node scripts/check-contrast.mjs --matrix   # adds the full 412-pair token matrix
```

---

## 0 · Status

| Item | State |
|---|---|
| `check-tokens.mjs` | green |
| `check-classes.mjs` | green |
| `check-contrast.mjs` (new) | green |

---

## 1 · STALE CLAIMS — verified against the tree, not inherited

| Claim carried into this run | Verdict | Evidence |
|---|---|---|
| `--on-surface-disabled` is undeclared (reported by four agents) | **STALE — fixed** | Declared in BOTH themes: light `#9DA096` `kartavaya-design.css:181`, dark `#64645F` `kartavaya-design.css:262` |
| Stale workarounds around that gap survive in `drawer.css` and `landing.css` | **TRUE — and I got this wrong first time** | Both are still there. I initially recorded this as "already migrated"; that was a bad grep, not a verified reading. Corrected in §1a — and only ONE of the two should actually switch. |
| `--on-surface-faint` measures 2.3:1 and any text use is a defect | **STALE — resolved by aliasing** | It no longer carries a literal. `kartavaya-design.css:174` (light) and `:261` (dark) alias it to `--on-surface-3`. Measured now: **4.82:1 light / 5.81:1 dark on `--bg`**. Its ~30 text call sites are compliant on `--bg`, `--surface` and `--s-low`; see SPEC-A11Y-2 for the raised surfaces. |
| `PageHeader` hardcodes `lang="sa"` | **STALE — fixed** | see §4 |
| Segmented control uses `aria-selected` on `role="radio"` | **STALE — standard won** | see §5 |
| Avatar comment: "six colours dark enough that white initials clear AA" | **ACCURATE — verified** | 5.87:1 – 7.73:1, see §3 |

### 1a · The two `--on-surface-disabled` workarounds — one switches, one must not

The brief said the workarounds "should switch to the real token" now that it
exists. Half of that is right. The two sites are not the same kind of thing, and
measuring them is what separates them.

**`landing.css` `.lcta:disabled` — SWITCHED.** Its comment said
`--on-surface-disabled` was "DECLARED NOWHERE in src/styles". True when written,
false now (`kartavaya-design.css:181` / `:262`). This is a genuinely **inactive
control** — a primary CTA with no destination yet — and WCAG 1.4.3 exempts
inactive controls from the contrast minimum outright. That exemption is the
entire reason the token exists. Switched; measures 2.19:1 on `--s-container`,
and reading as unmistakably dead is the intent.

**`drawer.css` `.dr__crumb-sep` — LEFT ALONE, deliberately.** Its comment gives
the same expired reason, but the answer does not change with it. A breadcrumb
separator is **not an inactive control**: it is a glyph in the accessibility
tree, on an enabled control, that a sighted user reads to parse the trail.
Completing the migration would move visible text from **4.82:1 to 2.32:1**.
`client.css:194` already reaches the same conclusion for its `·` separator.

So `00 §11` naming `.bar__crumb-sep` as a legitimate `--on-surface-disabled`
user is a **spec defect**, not a migration target. Both comments now record
which case they are, so the next agent does not "finish the job".

This is the one place my own first pass was wrong rather than the brief's, and
the cause is worth recording: I grepped for `--on-surface-3` near the word
"workaround" instead of opening the two files named. Re-reading found both in
under a minute.

---

## 2 · CONTRAST — measured

### 2a · Theme parity

**0 failures.** 216 tokens resolve in light, 216 in dark. Every theme-scoped
token has a counterpart.

> My first version of the parity check reported 9 false failures
> (`--st-requested`, `--st-done`, `--st-rejected`, `--ap-pending`,
> `--ap-approved`, `--ap-rejected`, `--pr-urgent`, `--pr-high`, `--pr-low`).
> Cause was in my script, not the CSS: it treated the selector list
> `:root, [data-theme="light"]` as light-only. `:root` matches the html element
> regardless of its `data-theme` value, so that block applies in **both** themes
> and those tokens correctly inherit the flip from `--ok`/`--warn`/`--danger`.
> Fixed in `selectorThemes()`. Recording it because a checker that manufactures
> failures trains people to ignore checkers.

### 2b · Foreground ramp on surface ramp — the reusable table

GENERATED, never transcribed: `cd frontend && node scripts/check-contrast.mjs --md`.
**Bold = below 4.5:1** (fails body text). Thresholds are WCAG 2.1: 4.5:1 body,
3:1 large text (>=24px, or >=18.66px at >=700 weight) and non-text UI.
Regenerated after rebasing onto staging at 58+ commits, so these are current.

#### LIGHT

| foreground | resolved | `--bg` | `--surface` | `--s-low` | `--s-container` | `--s-high` | `--s-highest` |
|---|---|---|---|---|---|---|---|
| `--on-surface` | #1B1D1A | 14.79 | 15.86 | 15.05 | 14.00 | 13.00 | 11.93 |
| `--on-surface-2` | #4A4E48 | 7.40 | 7.93 | 7.52 | 7.00 | 6.50 | 5.97 |
| `--on-surface-3` | #666A61 | 4.82 | 5.17 | 4.90 | 4.56 | **4.23** | **3.89** |
| `--on-surface-faint` | #666A61 | 4.82 | 5.17 | 4.90 | 4.56 | **4.23** | **3.89** |
| `--on-surface-disabled` | #9DA096 | **2.32** | **2.48** | **2.36** | **2.19** | **2.04** | **1.87** |
| `--primary` | #04837A | **4.04** | **4.33** | **4.11** | **3.82** | **3.55** | **3.26** |
| `--primary-text` | #046B64 | 5.56 | 5.96 | 5.66 | 5.26 | 4.89 | **4.49** |
| `--primary-hover` | #026B64 | 5.56 | 5.97 | 5.66 | 5.27 | 4.89 | **4.49** |
| `--primary-vivid` | #05B7AA | **2.19** | **2.35** | **2.23** | **2.07** | **1.92** | **1.77** |
| `--secondary` | #5C6450 | 5.39 | 5.78 | 5.49 | 5.10 | 4.74 | **4.35** |
| `--tertiary` | #8A5730 | 5.25 | 5.63 | 5.34 | 4.97 | 4.61 | **4.24** |
| `--ok` | #14743A | 5.10 | 5.47 | 5.19 | 4.83 | **4.48** | **4.11** |
| `--warn` | #955806 | 4.98 | 5.34 | 5.06 | 4.71 | **4.38** | **4.02** |
| `--danger` | #B42318 | 5.73 | 6.14 | 5.83 | 5.42 | 5.04 | 4.62 |
| `--outline` | #ADA692 | **2.12** | **2.27** | **2.15** | **2.00** | **1.86** | **1.71** |
| `--st-todo` | #5A6270 | 5.36 | 5.75 | 5.45 | 5.07 | 4.71 | **4.32** |
| `--st-in-progress` | #3E5C8A | 5.90 | 6.33 | 6.00 | 5.58 | 5.19 | 4.76 |
| `--st-in-review` | #6E5AA0 | 5.04 | 5.40 | 5.12 | 4.77 | **4.43** | **4.06** |
| `--pr-medium` | #3E5C8A | 5.90 | 6.33 | 6.00 | 5.58 | 5.19 | 4.76 |
| `--m-graha` | #2F6690 | 5.34 | 5.73 | 5.44 | 5.06 | 4.70 | **4.31** |
| `--m-ganit` | #2E7D52 | **4.39** | 4.71 | **4.46** | **4.15** | **3.86** | **3.54** |
| `--m-manav` | #A65A2E | **4.44** | 4.76 | 4.52 | **4.20** | **3.90** | **3.58** |
| `--m-vikray` | #A83E63 | 5.18 | 5.55 | 5.27 | 4.90 | 4.55 | **4.18** |
| `--m-vetana` | #6B4FA8 | 5.53 | 5.93 | 5.63 | 5.24 | 4.86 | **4.46** |
| `--m-dristi` | #24707F | 4.95 | 5.31 | 5.03 | 4.68 | **4.35** | **3.99** |
| `--m-prachar` | #8A6A18 | **4.40** | 4.72 | **4.48** | **4.17** | **3.87** | **3.55** |
| `--m-esign` | #2B7A6B | **4.46** | 4.79 | 4.54 | **4.23** | **3.93** | **3.60** |
| `--m-sanvaad` | #8E4A86 | 5.27 | 5.65 | 5.36 | 4.99 | 4.63 | **4.25** |
| `--m-hub` | #45569E | 5.95 | 6.38 | 6.05 | 5.63 | 5.23 | 4.80 |
| `--m-srijan` | #7A4E9E | 5.37 | 5.75 | 5.46 | 5.08 | 4.72 | **4.33** |
| `--m-pahchan` | #A24A38 | 5.12 | 5.49 | 5.21 | 4.85 | 4.50 | **4.13** |
| `--m-boards` | #4F5BA6 | 5.42 | 5.81 | 5.51 | 5.13 | 4.76 | **4.37** |
| `--m-approvals` | #5A7A33 | **4.29** | 4.60 | **4.36** | **4.06** | **3.77** | **3.46** |
| `--m-reports` | #2F7268 | 4.91 | 5.27 | 4.99 | 4.65 | **4.32** | **3.96** |

| on-pair | ratio |
|---|---|
| `--on-primary` on `--primary` | 4.63 |
| `--on-primary-container` on `--primary-container` | 13.63 |
| `--on-secondary-container` on `--secondary-container` | 13.16 |
| `--on-tertiary-container` on `--tertiary-container` | 12.75 |
| `--on-ok-container` on `--ok-container` | 11.02 |
| `--on-warn-container` on `--warn-container` | 10.10 |
| `--on-danger-container` on `--danger-container` | 10.45 |
| `--on-danger` on `--danger` | 6.57 |
| `--on-ok` on `--ok` | 5.85 |

#### DARK

| foreground | resolved | `--bg` | `--surface` | `--s-low` | `--s-container` | `--s-high` | `--s-highest` |
|---|---|---|---|---|---|---|---|
| `--on-surface` | #E9E7E1 | 15.63 | 14.79 | 13.98 | 12.93 | 11.54 | 10.02 |
| `--on-surface-2` | #BFBDB6 | 10.28 | 9.73 | 9.19 | 8.51 | 7.59 | 6.59 |
| `--on-surface-3` | #8E8D87 | 5.81 | 5.50 | 5.19 | 4.81 | **4.29** | **3.72** |
| `--on-surface-faint` | #8E8D87 | 5.81 | 5.50 | 5.19 | 4.81 | **4.29** | **3.72** |
| `--on-surface-disabled` | #64645F | **3.25** | **3.08** | **2.90** | **2.69** | **2.40** | **2.08** |
| `--primary` | #4FD8CB | 11.06 | 10.47 | 9.89 | 9.15 | 8.16 | 7.09 |
| `--primary-text` | #4FD8CB | 11.06 | 10.47 | 9.89 | 9.15 | 8.16 | 7.09 |
| `--primary-hover` | #6FE6DA | 12.89 | 12.20 | 11.53 | 10.67 | 9.52 | 8.26 |
| `--primary-vivid` | #05B7AA | 7.69 | 7.28 | 6.88 | 6.37 | 5.68 | 4.93 |
| `--secondary` | #C3CBB0 | 11.49 | 10.88 | 10.28 | 9.51 | 8.48 | 7.37 |
| `--tertiary` | #F0BB90 | 11.24 | 10.64 | 10.05 | 9.30 | 8.30 | 7.21 |
| `--ok` | #5BD98A | 10.80 | 10.22 | 9.66 | 8.94 | 7.97 | 6.92 |
| `--warn` | #E8B45C | 10.23 | 9.68 | 9.15 | 8.46 | 7.55 | 6.56 |
| `--danger` | #F2867A | 7.79 | 7.38 | 6.97 | 6.45 | 5.75 | 5.00 |
| `--outline` | #5B626C | **3.14** | **2.97** | **2.80** | **2.60** | **2.32** | **2.01** |
| `--st-todo` | #9AA3B2 | 7.60 | 7.19 | 6.79 | 6.29 | 5.61 | 4.87 |
| `--st-in-progress` | #8FAEDC | 8.52 | 8.06 | 7.62 | 7.05 | 6.29 | 5.46 |
| `--st-in-review` | #B6A6E0 | 8.76 | 8.29 | 7.83 | 7.25 | 6.47 | 5.62 |
| `--pr-medium` | #8FAEDC | 8.52 | 8.06 | 7.62 | 7.05 | 6.29 | 5.46 |
| `--m-graha` | #8FB8DC | 9.26 | 8.76 | 8.28 | 7.66 | 6.83 | 5.93 |
| `--m-ganit` | #7ED4A2 | 10.88 | 10.30 | 9.73 | 9.01 | 8.03 | 6.98 |
| `--m-manav` | #E8AE82 | 9.95 | 9.42 | 8.89 | 8.23 | 7.34 | 6.38 |
| `--m-vikray` | #E894B4 | 8.58 | 8.12 | 7.67 | 7.10 | 6.34 | 5.50 |
| `--m-vetana` | #B9A6E8 | 8.91 | 8.44 | 7.97 | 7.37 | 6.58 | 5.71 |
| `--m-dristi` | #7CC5D4 | 9.93 | 9.40 | 8.88 | 8.22 | 7.33 | 6.37 |
| `--m-prachar` | #DCC072 | 10.88 | 10.30 | 9.73 | 9.01 | 8.03 | 6.98 |
| `--m-esign` | #7FCFBE | 10.65 | 10.08 | 9.52 | 8.81 | 7.86 | 6.83 |
| `--m-sanvaad` | #DFA2D8 | 9.48 | 8.97 | 8.47 | 7.84 | 7.00 | 6.08 |
| `--m-hub` | #A3AEE8 | 9.00 | 8.52 | 8.05 | 7.45 | 6.64 | 5.77 |
| `--m-srijan` | #C4A2E4 | 8.87 | 8.39 | 7.93 | 7.34 | 6.55 | 5.68 |
| `--m-pahchan` | #E8A08E | 9.07 | 8.58 | 8.11 | 7.50 | 6.69 | 5.81 |
| `--m-boards` | #A8B2E4 | 9.34 | 8.85 | 8.36 | 7.73 | 6.90 | 5.99 |
| `--m-approvals` | #ADC97E | 10.52 | 9.96 | 9.41 | 8.71 | 7.77 | 6.75 |
| `--m-reports` | #85C6BA | 9.93 | 9.39 | 8.87 | 8.21 | 7.33 | 6.36 |

| on-pair | ratio |
|---|---|
| `--on-primary` on `--primary` | 7.93 |
| `--on-primary-container` on `--primary-container` | 7.01 |
| `--on-secondary-container` on `--secondary-container` | 7.23 |
| `--on-tertiary-container` on `--tertiary-container` | 6.96 |
| `--on-ok-container` on `--ok-container` | 8.94 |
| `--on-warn-container` on `--warn-container` | 9.49 |
| `--on-danger-container` on `--danger-container` | 10.00 |
| `--on-danger` on `--danger` | 7.40 |
| `--on-ok` on `--ok` | 7.75 |

### 2c · Agreement with `23-accessibility.md` §Contrast, and where it diverges

The spec ships its own ratio table. Mine reproduces it, which is the check that
the maths is right — then it disagrees in two places, both in the spec's favour
being *optimistic*.

| Token, on `--bg` | `23` says | measured | |
|---|---|---|---|
| `--on-surface` | 14.7 | **14.79** | agrees |
| `--on-surface-2` | 7.4 | **7.40** | agrees |
| `--on-surface-3` `#666A61` | 4.8 | **4.82** | agrees |
| `--ok` `#14743A` | 5.1 | **5.10** | agrees |
| `--warn` `#955806` | 4.9 | **4.98** | agrees |
| `--danger` `#B42318` | 5.8 | **5.73** | agrees |
| `--primary` `#04837A` | 4.04 | **4.04** | agrees |
| `--primary-text` `#046B64` | 5.2 | **5.56** | spec understates; still passes |
| `--on-primary` on `--primary` | 5.1 | **4.63** | **spec overstates by 0.47** — passes AA, but the margin is half what the table claims |
| `--on-surface-faint` | 2.3 | **4.82** | spec is stale; the token was re-aliased after `23` was written |

1. **`--primary` as text is confirmed failing.** 4.04:1 on `--bg`, 3.55:1 on
   `--s-high`. The brief's rule is measured-correct, and `--primary-text` at
   5.56:1 is the right substitute.
2. **`--on-surface-faint` is no longer a defect.** Its 2.3:1 reputation belongs
   to the retired literal `#9DA096`, which now lives on as
   `--on-surface-disabled` for WCAG-1.4.3-exempt inactive controls only. `23`
   §12's row for it is stale — the spec has not caught up with the token.
3. **`--on-surface-3` degrades on the top two surface steps** — light 4.23 on
   `--s-high`, 3.89 on `--s-highest`; dark 4.29 and 3.72.
4. **`--outline` reaches 3:1 exactly once** (dark, on `--bg`, 3.14) and fails on
   all eleven other surface/theme combinations (1.71–2.97).

### 2d · Spec defects — accessibility vs. the design files

Recorded per the escalation rule: measured, reported, **not** silently shipped.

**SPEC-A11Y-1 — `--outline` fails WCAG 1.4.11 (non-text contrast) almost
everywhere.** Light `#ADA692`: 2.12 on `--bg`, 2.27 on `--surface`, 1.71 on
`--s-highest`. Dark `#5B626C`: 3.14 on `--bg` (the only pass), 2.97 on
`--surface`, 2.01 on `--s-highest`. It is the border of text inputs, checkboxes
(`.cbx` `components.css:728`), radios (`.rdo` `components.css:739`) and select
triggers — exactly the "visual information required to identify user interface
components and states" that 1.4.11 requires at 3:1.
**Not fixed here, deliberately.** `--outline` is referenced system-wide; a
luminance change to it is a whole-app visual diff and the single likeliest edit
to collide with a dozen concurrent agents. It wants one deliberate, measured
token change on a quiet tree. Target values that clear 3:1 on the *worst*
surface (`--s-highest`): light ≈ `#78725F`, dark ≈ `#7E8590`.

**SPEC-A11Y-2 — `--on-surface-3` on raised surfaces.** Fails on `--s-high`
(4.23 light / 4.29 dark) and `--s-highest` (3.89 / 3.72). The token comment at
`kartavaya-design.css:143-155` explains why a compliant *fourth* step is
impossible on `--bg`; that argument does not extend to the raised steps. This is
a placement rule rather than a token bug — secondary text should not sit on
`--s-high`/`--s-highest`. No live rule pairs them today, so it is preventive.

**SPEC-A11Y-3 — the tinted-chip pattern loses ~0.9:1 and nobody accounted for
it.** This is the significant new finding, and it is systemic.

The pattern is `background: color-mix(in srgb, var(--X) 14%, transparent);
color: var(--X)` — a chip in one hue. `23` §12 blesses `--ok`/`--warn`/`--danger`
for "chip labels" on the strength of their ratio **against `--bg`**. But a chip
does not sit on `--bg`; it sits on a 14% tint of *its own foreground*, which
moves the background toward the text and costs about 0.9:1. Measured, light:

| foreground | on `--bg` (0%) | 8% tint | 12% tint | 14% tint |
|---|---|---|---|---|
| `--ok` `#14743A` | 5.10 | 4.58 | 4.33 | **4.21** |
| `--warn` `#955806` | 4.98 | 4.48 | 4.25 | **4.13** |
| `--st-in-review` `#6E5AA0` | 5.04 | 4.55 | 4.31 | **4.20** |
| `--on-surface-3` `#666A61` | 4.82 | 4.37 | 4.15 | **4.04** |
| `--danger` `#B42318` | 5.73 | 5.05 | 4.73 | 4.57 |
| `--primary-text` `#046B64` | 5.56 | 4.96 | 4.68 | 4.55 |

Six live rules land below 4.5:1 at 9.5–11px, all in light mode:

| rule | file:line | measured |
|---|---|---|
| `.k-apcard__kind--creative` | `editorial.css:1900` | **4.13** |
| `.k-actitem__verb--attached` | `editorial.css:1984` | **4.13** |
| `.k-rule__status--off` | `editorial.css:2022` | **4.15** |
| `.k-actitem__verb--assigned` | `editorial.css:1986` | **4.20** |
| `.k-actitem__verb--approved` | `editorial.css:1983` | **4.21** |
| `.k-rule__status--on` | `editorial.css:2014` | **4.33** |

Live in `AutomationsPage.jsx`, `TasksListPage.jsx`, `ModuleUI.jsx`.
`--danger` and `--primary-text` survive at 4.57 and 4.55 — a 0.05 margin, so
any future tint increase breaks them too.

Reducing the tint does not fix it: even at 6% the `--ink-3` chip is 4.48.
The remedy is to darken the *text* while keeping the tint, which the file
already does in two places — `.k-actitem__verb--moved` uses `--primary-text`
rather than `--primary`, and `.k-actitem__verb--changed` pairs an `--ink-3`
tint with `--ink-2` text (6.37 light / 8.96 dark). Measured remedies, both
themes:

| chip | remedy | light | dark |
|---|---|---|---|
| `--ok` tint + `--on-ok-container` | same hue, darker | 9.98–10.26 | 11.94–12.49 |
| `--warn` tint + `--on-warn-container` | same hue, darker | 9.12 | 12.15 |
| `--ink-3` tint + `--ink-2` | already the sibling's pattern | 6.37 | 8.96 |

**One is fixed on this branch** — `.k-rule__status--off`, because an identical
sibling rule 30 lines away already demonstrates the intended pairing, so it is
an omission rather than a design choice. The rest need a token decision that is
not mine to invent: `--st-in-review` is a violet with no `on-` counterpart in
the system, and inventing one mid-swarm in the most-edited file in the repo is
how merge conflicts get made. All numbers needed to land it are above.

**SPEC-A11Y-3 — `.k-pill-*` / `.k-role-*` in `brand.css` pair a hardcoded
light background with a theme-flipping foreground.** `brand.css:121`
`.k-pill-high { background: #fff0f0; color: var(--k-danger) }`. `--k-danger` is
`#c0392b` in `brand.css:39` but is REDECLARED as `var(--danger)` in
`kartavaya-design.css:487`, so in dark it resolves to `#F2867A` on a hardcoded
near-white: **2.24:1**. Light is 4.91:1 — passes, barely.
**These classes are dead**: `k-pill-high|k-pill-medium|k-pill-low|k-pill-done|k-role-owner|k-role-admin`
match zero `.jsx`/`.js` files; the only hit in the tree is `brand.css` itself.
Left in place deliberately — deleting dead legacy CSS is another agent's sweep
and would collide. Flagged so it is not revived as-is.

### 2e · False positives my script raised, and why they are not defects

Recorded so the next agent does not "fix" working code.

| Flag | Verdict |
|---|---|
| `.cbx` 1.01:1 light / 1.43:1 dark (`components.css:726`) | **Not a defect.** `color: var(--on-primary)` on `background: var(--s-lowest)`, but `.cbx svg { opacity: 0 }` (`:732`) — the tick is invisible until `.cbx.on`, and `.cbx.on { background: var(--primary) }` (`:733`). The pairing that renders is `--on-primary` on `--primary` = 4.63:1 light / 7.93:1 dark. |
| `.av` 1.31:1 light (`components.css:778`) | **Not a defect in practice.** `background: var(--av-bg, var(--s-high))`; `--av-bg` is always set inline by `Avatar.jsx:29` and `MemberTable.jsx:87`. Only the unreachable fallback measures 1.31:1. Latent, not live. |
| `.cmp__send:disabled`, `.aufld__i:disabled` | **Exempt.** WCAG 1.4.3 excludes inactive components. Script now buckets these separately. |

### 2f · JS-declared palettes (not in CSS, so no CSS checker sees them)

`Avatar.jsx:16` `AV_BG`, white initials at ~10px (`size * 0.41`, default 24) —
body-text threshold applies:

| swatch | white on it | |
|---|---|---|
| `#0F6E66` | 6.10:1 | AA |
| `#8A5A2B` | 5.87:1 | AA |
| `#5B4A7C` | 7.73:1 | AA |
| `#2F6B4F` | 6.29:1 | AA |
| `#8C3F52` | 7.12:1 | AA |
| `#3E5C8A` | 6.77:1 | AA |

The docblock claim at `Avatar.jsx:10-11` is **accurate**. Verified, not assumed.

### 2g · Defects that landed DURING this run, found by re-measuring after rebase

Both arrived in stylesheets between my first pass and my rebase onto staging,
and both are the same bug: a fixed colour paired with a token that flips.
Recorded partly as evidence the script earns its keep — neither was visible to
any existing gate. Both fixed.

| Rule | Was | Measured | Now |
|---|---|---|---|
| `.bc__tick.on`, `.bc__tick:hover` `boards.css:190-191` | `#fff` on `var(--ok)` | 5.85 light, **1.79 dark** | `var(--on-ok)` — 5.85 / **7.75** |
| `.trp__task` `editorial.css:3241`, `.trp__ref` `:3247` | `var(--k-primary)` as 11–13px text | **2.19** on `--bg`, **2.35** on `--surface` | `var(--primary-text)` — 5.56 / 11.06 |

**`--on-ok` is a new token** completing a pattern the system already documents
for `--on-danger`: *"--danger itself is a FILL … and inverts hard between
themes — #B42318 takes white, #F2867A takes near-black."* `--ok` is the
identical case, missed only because `--ok` as a fill is rarer. Declared in both
themes (`kartavaya-design.css:225` light `#FFFFFF`, `:296` dark `#06341A`) and
added to the measured on-pairs so the pair cannot drift apart unnoticed.

**`--primary-vivid` at 2.19:1 is the sharpest single number in this report.**
It is a fixed brand literal that does not flip, reached as `color:` through the
`--k-primary` alias. It is *correct* at every other call site — `auth.css:89`,
`auth.css:132` and `editorial.css:177/255/276` all paint it on the near-black
sidebar or auth brand panel, where it is the only teal that reads, and
`auth.css:128-131` documents that choice explicitly. The two time-report table
cells were the only ones on a page surface. It is now in the measured foreground
set so a third cannot appear silently.

---

## 3 · `lang` — the Devanagari / screen-reader half

`PageHeader` **is fixed** — `lang="hi"` at `PageHeader.jsx:61`, with a docblock
enumerating why none of the 53 values is Sanskrit. Claim confirmed stale.

I then checked every other `lang=` in the tree. Five `lang="sa"` remain and
**four are correct**: `Citation.jsx:9` plus the Gītā verses at
`ReportsPage.jsx:758` and `TimeReportPage.jsx:322` are genuine Sanskrit (note
the visarga in `कालः`), and `CustomizeSettingsPage.jsx:58` is the यथारुचि
epigraph.

**One was wrong, and it is the same defect class the PageHeader sweep was
about.** `Footer.jsx` wrapped `कर्तव्य — that which must be done` in a single
`lang="sa"` span, handing the English gloss to a screen reader's Sanskrit voice.
`CustomizeSettingsPage` already had the right shape — Devanagari inside the
span, English outside — so the fix follows an existing pattern rather than
inventing one. Fixed.

## 4 · Segmented control — the standard won everywhere

Confirmed stale, exhaustively rather than by sampling. **All six**
`role="radio"` components carry `aria-checked` and **none** carries
`aria-selected`: `Seg.jsx:51-52`, `AccentGrid.jsx:26-27`, `FontList.jsx:22-23`,
`SidebarBgCards.jsx:27-28`, `SoundGrid.jsx:36-37`, `Radio.jsx:14-15`.
`Seg.jsx:17-19` records the reasoning.

Every `aria-selected` in the tree sits on a role that permits it —
`role="option"` (`CommandPalette.jsx:428`, `MentionTextarea.jsx:148`,
`Picker.jsx:93`) or `role="tab"` (`ModuleTabs.jsx:24`, `Tabs.jsx:63`).

## 5 · Focus traps — every dialog, and which I verified

`FocusTrap.jsx`, `SkipLink.jsx` and `useRestoreFocus.js` all exist. The
implementation is careful: it captures the trigger *before* moving focus,
rebuilds the focusable list on every keypress filtered on `offsetParent`, uses
`preventScroll`, and checks `isConnected` before restoring — with a
`[data-focus-fallback]` / `<main>` landing for the destructive case where the
trigger itself unmounted.

| Overlay | Trap | Status |
|---|---|---|
| `modal.jsx:57` | `active={open}` | pre-existing |
| `ConfirmDialog.jsx:82` | `initialFocus={cancelRef}`, `role="alertdialog"` | pre-existing |
| `Sheet.jsx:53` | `active={open}` | pre-existing |
| `TaskDrawer.jsx:630` | `active` | pre-existing |
| `CommandPalette.jsx:350` | `initialFocus={inputRef}` | pre-existing |
| `KeyboardShortcuts.jsx:61` | `active` | pre-existing |
| `MobileDrawer.jsx:31` | wraps panel, not scrim | pre-existing |
| `SlideOver.jsx:40` (admin) | `active={open}` | pre-existing |
| **`NewTaskModal.jsx:383`** | `active` | **ADDED — was a documented gap** |
| **`DrawerAttachments.jsx:139`** | `initialFocus={closeRef}` | **ADDED** |

`NewTaskModal` is the product's primary create surface — AppShell's `n`, the
mobile FAB, the command palette and three board pages all open it — and its own
comment had recorded the missing trap as a known gap. Its preview lightbox stays
**outside** the trap deliberately: it portals to `document.body`, so it is not a
DOM descendant of the panel, and a trap here would rebuild its focusable list
from a subtree the lightbox is not in.

`DrawerAttachments`' lightbox declared `aria-modal="true"` — telling a screen
reader the rest of the page was inert — while Tab walked out into the drawer
behind it, which is itself trapped, landing focus in a second modal layer with
no way back. It also used `autoFocus`, which fires on mount only (so previewing
a second file within one mount left focus where it was) and gives no focus
*restore*, dropping a keyboard user at the top of the document on close.

**Non-modal `role="dialog"` panels, correctly left untrapped:**
`NotificationsModal.jsx:99` (no `aria-modal`), `Picker.jsx:87` and
`Popover.jsx:68` — dismissible popovers with their own key handling, where
trapping Tab would be the wrong behaviour.

**Stale:** `ApprovalsPage.jsx:343`'s comment describes a bare fixed div with no
trap, no Escape and no `role`. It now renders `<Modal>`, which traps. The
comment is history, not a live defect.

## 6 · Touch targets — `scripts/check-touch-targets.mjs` (new)

The existing block in `mobile-responsive.css` is careful and measured, but it is
a **hand-maintained list of selectors** — the only thing keeping it complete was
somebody remembering. The script replays the mobile cascade and finds what
nobody remembered. Seven controls were under 44px with nothing raising them:

| Control | Declared | Strategy |
|---|---|---|
| `.cbx` `components.css:726` | 17×17 | pseudo-element overlay |
| `.rdo` `components.css:737` | 17×17 | pseudo-element overlay |
| `.tgl` `components.css:713` | 38×22 | pseudo-element overlay |
| `.k-onboard__iconbtn` | 24×24 | real size |
| `.svbtn` | 26×26 | real size |
| `.k-file__more` | 30×30 | real size |
| `.cmp__send` | 36×36 | real size |

`.cbx` and `.rdo` at 17px fail even WCAG **2.5.8**'s 24×24 Level-AA floor, not
merely the spec's 44px.

**Two strategies, chosen per control, because they fail in opposite
directions.** Real size where the control stands alone in its row — growing it
moves nothing that matters. Overlay where the visual size carries meaning and
the neighbour is text: a 44px checkbox beside a 13px label is not a checkbox any
more. The overlay is a child of the control, so a tap on it still activates the
control, and it overlaps only the label, where stealing the tap is the behaviour
you want anyway.

`.k-onboard__iconbtn` deliberately does **not** get an overlay: its row is
`gap: 2px`, so two 24px buttons expanded to 44px would overlap by 18px and steal
each other's taps — trading a small-target failure for an ambiguous-target one.

**One finding verified as a non-issue and recorded in the script so nobody
re-investigates:** `.side--rail .side__toggle` (32px) is unreachable on mobile
because `editorial.css:89` `@media (max-width: 1023px) { .kv__side { display: none } }`
removes the whole sidebar and swaps in `.kv__mobbar` + `MobileDrawer`.

## 7 · Responsive and fluid layout

**Verified present:** `viewport-fit=cover` (`index.html:5`, required for
`env(safe-area-inset-*)` to resolve); the 16px input floor gated on
`(max-width: 767px), (hover: none) and (pointer: coarse)` — the pointer clause
matters, an iPhone 15 Pro Max in landscape is 932px CSS and still zooms a 13px
field; and hover-only actions given persistent fallbacks under
`@media (hover: none)`.

**No live fixed-width centring on a product page.** Every `margin: 0 auto` in
the tree is one of: empty-state copy (`.k-empty__sub`, `.mempty`, `.k-err`, and
~20 inline `maxWidth: 300` empty states — all legitimately centred *within* an
already-centred empty state), a `margin-left: auto` flex push, dead legacy CSS,
or the marketing landing wrapper. `client.css:28-35` records the owner's rule
overriding the handover's `.cl-main{max-width:1040px;margin:0 auto}`.
`settings.css:7` `.st { max-width: 920px }` caps width but does **not** centre,
and its stated reason — a settings row stretched to 1600px separates label from
control until the pair stops reading as a pair — is a legibility argument.

**Dead, so harmless, but worth knowing before anyone revives it:**
`layout.css` `.content-wrapper` (+ `--dashboard` / `--list` / `--form`) sets
`margin: 0 auto` with `max-width` up to 1800px. It, `.split-layout`,
`.layout-main`, `.grid-2/3/4` and `.card-grid` match **zero** `.jsx` files.

**SPEC-A11Y-4 — the breakpoint count.** `15-mobile-web.md:18` says *"Three, not
five. Every additional breakpoint is another combination nobody tests."* The
build has **16** distinct width breakpoints: 560, 600, 640, 719, 720, 767, 768,
860, 900, 1023, 1024, 1080, 1100, 1280, 1400, plus compound queries. Two are
off-by-one pairs against the spec's own lines (`719`/`720` beside `767`;
`1024` beside `1023`), and **`max-width: 768px` overlaps `min-width: 768px`** —
at exactly 768px CSS, which is iPad portrait, both match. Not fixed here: a
layout-wide change across seven files that would collide with most of the fleet.
Listed so it can be done once, deliberately.

## 8 · Motion

**Resolved:** four spinners had three behaviours under reduced motion.
`animations.css:302-322` sets the policy and argues it — a loading indicator is
*functional* motion, freezing it removes the only feedback a slow request has
and reads as a hung UI — and `.spin`, `.gr__spin` and `.prg--ind .prg__f` all
follow it. `.k-spinner` alone set `animation: none`. Removed; the policy is now
uniform and stated where the exception used to be.

**The trap, recorded in the rule itself:** `.k-spinner`'s `.7s` is deliberately
NOT routed through `--ix`. `16-animations.md:44` gives
`animation: dmSpin calc(.7s * var(--ix)) linear infinite` as its worked example
while the same file sets `--ix: .001` under reduce — a **0.7ms** spinner, the
500–1250Hz strobe measured and removed elsewhere in this run. **The spec
mandates the bug.** Do not "correct" the build toward it.

**`AutomationsPage.jsx:374`** carried `style={{ animation: 'spin 1s linear
infinite' }}` on a hand-rolled SVG. An inline style is invisible to every
stylesheet rule, reduced-motion block included, so this was the one infinite
loop in the build that no CSS could govern — and it duplicated a spinner the
design system already owns. Now `<span className="spin" aria-hidden="true" />`.

**Verified after:** no infinite animation multiplies its duration by `--ix` or
`--motion-scale` anywhere in `src/styles`, and the shortest infinite duration in
the build is **640ms**.

**STALE:** `@keyframes dmPop` is declared **once**, at `components.css:493`.
`drawer.css` does not declare it, and `animations.css:21` documents deliberately
not re-declaring it to avoid exactly that collision.

---

## 9 · What I did NOT fix, and why

Each is a real measured defect left deliberately, with the numbers needed to
land it.

1. **SPEC-A11Y-1 `--outline`** — fails 1.4.11 on 11 of 12 surface/theme
   combinations. A system-wide token; changing its luminance is a whole-app
   visual diff and the likeliest edit in this report to collide. Targets that
   clear 3:1 on the worst surface: light ≈ `#78725F`, dark ≈ `#7E8590`.
2. **SPEC-A11Y-3, the remaining five tinted chips** — needs a token decision
   (`--st-in-review` is a violet with no `on-` counterpart), in the most-edited
   file in the repo. Remedies measured in §2d.
3. **SPEC-A11Y-4 breakpoints** — 16 where the spec says 3, with a real overlap
   at iPad portrait. Seven files.
4. **`brand.css` `.k-pill-*` / `.k-role-*`** — 2.24:1 in dark, but the classes
   match zero `.jsx`. Deleting dead legacy CSS is another agent's sweep.
5. **`.av` fallback** — `var(--av-bg, var(--s-high))` is 1.31:1 if `--av-bg` is
   ever unset. `Avatar.jsx:29` and `MemberTable.jsx:87` always set it, so it is
   latent, not live.

## 10 · The bugs in my own instruments

Recorded because a checker that lies is worse than none, and each was caught by
disagreeing with something already known.

1. **Selector lists.** `:root, [data-theme="light"]` applies in **both** themes,
   because `:root` matches regardless of the attribute. Reading it as light-only
   manufactured 9 parity failures against healthy tokens (`--st-done` and
   friends, which alias `--ok`/`--warn`/`--danger` and flip with them).
2. **Line numbers.** Comments were collapsed to a single space before parsing,
   shifting every line number after them. Now blanked in place, preserving
   newlines. Every citation here was re-opened after the rebase.
3. **Backdrops.** Translucent backgrounds were first skipped entirely (missing
   the whole tinted-chip family), then composited over `--bg` — which flagged 14
   sidebar rules at ~1.1:1. The sidebar is an *inverted* surface; white-on-white
   is only a failure if you think the ground is cream. Now per-region, with an
   explicit `SKIP` where the ground genuinely is not knowable.
4. **Over-broad matching** in the touch-target script: its first regex matched
   any selector containing `dot`, `act`, `x` or `item` and produced 112
   findings, nearly all decoration — a 6px `.k-statuschip__dot` is a dot
   *inside* a tap target, not one. Tightened to 15, then to 7 real ones.

**And one wrong verdict in this report**, corrected in §1a: I recorded the
`--on-surface-disabled` workarounds as "already migrated" on the strength of a
grep instead of opening the two files named. Both were still there. The brief
was right and I was not.

