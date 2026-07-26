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
| `--on-surface-disabled` is undeclared (reported by four agents) | **STALE — fixed** | Declared in BOTH themes: light `#9DA096` `kartavaya-design.css:163`, dark `#64645F` `kartavaya-design.css:237` |
| Stale workarounds around that gap survive in `drawer.css` and `landing.css` | **STALE — already migrated** | `drawer.css:72` documents `.bar__crumb-sep` as a legitimate `--on-surface-disabled` user; no `--on-surface-3` workaround remains in either file. Nothing to switch. |
| `--on-surface-faint` measures 2.3:1 and any text use is a defect | **STALE — resolved by aliasing** | It no longer carries a literal. `kartavaya-design.css:156` (light) and `:236` (dark) alias it to `--on-surface-3`. Measured now: **5.03:1 light / 5.13:1 dark on `--bg`**. The ~30 text call sites are compliant as-is. |
| `PageHeader` hardcodes `lang="sa"` | **STALE — fixed** | see §4 |
| Segmented control uses `aria-selected` on `role="radio"` | **STALE — standard won** | see §5 |
| Avatar comment: "six colours dark enough that white initials clear AA" | **ACCURATE — verified** | 5.87:1 – 7.73:1, see §3 |

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

Contrast ratios, WCAG 2.1. **Bold = below 4.5:1** (fails body text).
Thresholds: 4.5:1 body, 3:1 large text (>=24px, or >=18.66px at >=700) and non-text UI.

#### LIGHT

| foreground | `--bg` | `--surface` | `--s-low` | `--s-container` | `--s-high` | `--s-highest` |
|---|---|---|---|---|---|---|
| `--on-surface` #1B1D1A | 15.30 | 15.94 | 15.48 | 14.24 | 13.35 | 12.16 |
| `--on-surface-2` #4A4E48 | 8.09 | 8.43 | 8.19 | 7.53 | 7.06 | 6.43 |
| `--on-surface-3` #666A61 | 5.03 | 5.24 | 5.09 | 4.68 | **4.39** | **4.00** |
| `--on-surface-faint` → `-3` | 5.03 | 5.24 | 5.09 | 4.68 | **4.39** | **4.00** |
| `--on-surface-disabled` #9DA096 | **2.32** | **2.48** | **2.36** | **2.19** | **2.04** | **1.87** |
| `--primary` #04837A | **4.04** | **4.21** | **4.09** | **3.76** | **3.53** | **3.21** |
| `--primary-text` #046B64 | 5.71 | 5.95 | 5.78 | 5.31 | 4.98 | **4.54** |
| `--primary-hover` #026B64 | 5.73 | 5.97 | 5.80 | 5.33 | 5.00 | **4.55** |
| `--secondary` #5C6450 | 6.22 | 6.48 | 6.30 | 5.79 | 5.43 | 4.94 |
| `--tertiary` #8A5730 | 5.65 | 5.89 | 5.72 | 5.26 | 4.93 | **4.49** |
| `--ok` #14743A | 5.44 | 5.67 | 5.51 | 5.06 | 4.75 | **4.32** |
| `--warn` #955806 | 5.53 | 5.76 | 5.60 | 5.15 | 4.83 | **4.39** |
| `--danger` #B42318 | 5.53 | 5.76 | 5.60 | 5.15 | 4.82 | **4.39** |
| `--outline` #ADA692 | **2.12** | **2.27** | **2.15** | **2.00** | **1.86** | **1.71** |
| `--st-todo` #5A6270 | 5.66 | 5.89 | 5.73 | 5.27 | 4.93 | **4.49** |
| `--st-in-progress` #3E5C8A | 6.11 | 6.36 | 6.18 | 5.68 | 5.32 | 4.85 |
| `--st-in-review` #6E5AA0 | 5.60 | 5.83 | 5.67 | 5.21 | 4.88 | **4.45** |
| `--pr-medium` #3E5C8A | 6.11 | 6.36 | 6.18 | 5.68 | 5.32 | 4.85 |

Module accents, LIGHT (used as heading/label colour on `--bg` and `--surface`):

| token | `--bg` | `--surface` | `--s-high` |
|---|---|---|---|
| `--m-graha` #2F6690 | 5.62 | 5.85 | 4.90 |
| `--m-ganit` #2E7D52 | 4.63 | 4.82 | **4.04** |
| `--m-manav` #A65A2E | 4.79 | 4.99 | **4.18** |
| `--m-vikray` #A83E63 | 5.61 | 5.85 | 4.90 |
| `--m-vetana` #6B4FA8 | 6.36 | 6.62 | 5.54 |
| `--m-dristi` #24707F | 4.94 | 5.15 | **4.31** |
| `--m-prachar` #8A6A18 | 4.68 | 4.87 | **4.08** |
| `--m-esign` #2B7A6B | 4.65 | 4.85 | **4.06** |
| `--m-sanvaad` #8E4A86 | 6.28 | 6.54 | 5.48 |
| `--m-hub` #45569E | 6.57 | 6.85 | 5.73 |
| `--m-srijan` #7A4E9E | 6.44 | 6.71 | 5.62 |
| `--m-pahchan` #A24A38 | 5.75 | 5.99 | 5.02 |
| `--m-boards` #4F5BA6 | 6.05 | 6.30 | 5.28 |
| `--m-approvals` #5A7A33 | 4.60 | 4.79 | **4.01** |
| `--m-reports` #2F7268 | 4.90 | 5.10 | **4.27** |

#### DARK

| foreground | `--bg` | `--surface` | `--s-low` | `--s-container` | `--s-high` | `--s-highest` |
|---|---|---|---|---|---|---|
| `--on-surface` #E9E7E1 | 16.35 | 14.72 | 13.44 | 11.85 | 9.98 | 8.35 |
| `--on-surface-2` #BFBDB6 | 10.75 | 9.68 | 8.84 | 7.79 | 6.56 | 5.49 |
| `--on-surface-3` #8E8D87 | 5.13 | 4.62 | **4.22** | **3.72** | **3.13** | **2.62** |
| `--on-surface-faint` → `-3` | 5.13 | 4.62 | **4.22** | **3.72** | **3.13** | **2.62** |
| `--on-surface-disabled` #64645F | **3.25** | **2.93** | **2.67** | **2.36** | **1.98** | **1.66** |
| `--primary` #4FD8CB | 11.31 | 10.18 | 9.30 | 8.20 | 6.90 | 5.78 |
| `--primary-text` → `--primary` | 11.31 | 10.18 | 9.30 | 8.20 | 6.90 | 5.78 |
| `--secondary` #C3CBB0 | 11.75 | 10.58 | 9.66 | 8.52 | 7.17 | 6.00 |
| `--tertiary` #F0BB90 | 10.44 | 9.40 | 8.58 | 7.57 | 6.37 | 5.33 |
| `--ok` #5BD98A | 11.38 | 10.25 | 9.36 | 8.25 | 6.95 | 5.81 |
| `--warn` #E8B45C | 9.72 | 8.75 | 7.99 | 7.05 | 5.93 | 4.96 |
| `--danger` #F2867A | 7.30 | 6.57 | 6.00 | 5.29 | 4.46 | **3.73** |
| `--outline` #5B626C | **2.97** | **2.67** | **2.44** | **2.15** | **1.81** | **1.51** |
| `--st-todo` #9AA3B2 | 6.86 | 6.18 | 5.64 | 4.98 | **4.19** | **3.50** |
| `--st-in-progress` #8FAEDC | 7.87 | 7.08 | 6.47 | 5.70 | 4.80 | **4.01** |
| `--st-in-review` #B6A6E0 | 8.10 | 7.29 | 6.66 | 5.87 | 4.94 | **4.13** |
| `--pr-medium` #8FAEDC | 7.87 | 7.08 | 6.47 | 5.70 | 4.80 | **4.01** |

Module accents, DARK: all 15 clear 4.5:1 on `--bg` (range **6.44** `--m-vetana`
to **11.16** `--m-ganit`) and on `--surface` (**5.80** – **10.05**).

#### Container / `on-` pairs — all pass, both themes

| pair | light | dark |
|---|---|---|
| `--on-primary` on `--primary` | 4.63 | 7.93 |
| `--on-primary-container` on `--primary-container` | 13.63 | 7.01 |
| `--on-secondary-container` on `--secondary-container` | 13.16 | 7.23 |
| `--on-tertiary-container` on `--tertiary-container` | 12.75 | 6.96 |
| `--on-ok-container` on `--ok-container` | 11.02 | 8.94 |
| `--on-warn-container` on `--warn-container` | 10.10 | 9.49 |
| `--on-danger-container` on `--danger-container` | 10.45 | 10.00 |
| `--on-danger` on `--danger` | 6.57 | 7.40 |

### 2c · What the numbers say

1. **`--primary` as text is confirmed failing** — 4.04:1 on `--bg`, 3.53:1 on
   `--s-high` in light. The brief's rule is measured-correct. `--primary-text`
   is 5.71:1 on `--bg`. Note the brief quotes 5.2:1; the current declared
   `#046B64` measures **5.71:1** on `--bg` / 5.95:1 on `--surface`. Better than
   documented, same conclusion.
2. **`--on-surface-faint` is no longer a defect** (see §1). Its 2.3:1 reputation
   belongs to the retired literal `#9DA096`, which now lives on as
   `--on-surface-disabled` for WCAG-1.4.3-exempt inactive controls only.
3. **`--on-surface-3` degrades on the top two surface steps.** Light: 4.39:1 on
   `--s-high`, 4.00:1 on `--s-highest`. Dark is worse — 3.13:1 and 2.62:1. Any
   secondary text on a raised surface fails. See §2d for what actually renders
   there.
4. **`--outline` never reaches 3:1 against any surface, in either theme**
   (light 1.71–2.27, dark 1.51–2.97). See §2d.

### 2d · Spec defects — accessibility vs. the design files

Recorded as spec defects per the escalation rule, **not** silently shipped.

**SPEC-A11Y-1 — `--outline` fails WCAG 1.4.11 (non-text contrast) everywhere.**
Measured light `#ADA692`: 2.12:1 on `--bg`, 2.27:1 on `--surface`, 1.71:1 on
`--s-highest`. Dark `#5B626C`: 2.97:1 / 2.67:1 / 1.51:1. It is the border of
text inputs, checkboxes (`.cbx` `components.css:728`), radios (`.rdo`
`components.css:739`) and select triggers — exactly the "visual information
required to identify user interface components" that 1.4.11 requires at 3:1.
NOT fixed on this branch: `--outline` is referenced across the whole system and
a global luminance change is precisely the kind of edit that collides with a
dozen concurrent agents. It needs to be one deliberate token change, measured,
on a quiet tree. **Required light value ≥3:1 on `--s-highest` #DFD8C5: around
`#78725F`.** Dark, ≥3:1 on `--s-highest` #2E353E: around `#7E8590`.

**SPEC-A11Y-2 — `--on-surface-3` on raised surfaces.** Fails on `--s-high` and
`--s-highest` in light (4.39, 4.00) and from `--s-low` upward in dark (4.22,
3.72, 3.13, 2.62). The token comment at `kartavaya-design.css:143-155` already
documents why a compliant fourth step is impossible on `--bg`; the same argument
does not cover the raised steps, which are darker still in light and lighter in
dark. Not a token bug so much as a placement rule: secondary text should not sit
on `--s-high`/`--s-highest`. No live rule pairs them (§2e), so this is
preventive.

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

