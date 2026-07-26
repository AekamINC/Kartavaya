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
| `.k-apcard__kind--creative` | `editorial.css:1820` | **4.13** |
| `.k-actitem__verb--attached` | `editorial.css:1904` | **4.13** |
| `.k-rule__status--off` | `editorial.css:1935` | **4.15** |
| `.k-actitem__verb--assigned` | `editorial.css:1906` | **4.20** |
| `.k-actitem__verb--approved` | `editorial.css:1903` | **4.21** |
| `.k-rule__status--on` | `editorial.css:1934` | **4.33** |

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
light background with a theme-flipping foreground.** `brand.css:114`
`.k-pill-high { background: #fff0f0; color: var(--k-danger) }`. `--k-danger` is
`#c0392b` in `brand.css:39` but is REDECLARED as `var(--danger)` in
`kartavaya-design.css:459`, so in dark it resolves to `#F2867A` on a hardcoded
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

