# Dark-mode correctness and colour contrast — full-surface sweep

Branch `audit/contrast-dark-mode`, rebased onto `origin/staging` @ `309dcced`.
Gates green (see §8). Seven files changed, all listed in §7.

Every number below was **measured in a browser**, never derived from a token
name. The colour engine was calibrated first against the 14 ratios
`kartavaya-design.css` documents for `--outline` (7 light surfaces + 7 dark):
**all 14 reproduced to the exact hundredth, delta 0.00**. Anything I could not
measure is named in §6 rather than passed silently.

---

## 1 · The two reported failures are already fixed on `origin/staging` — verified, not assumed

Both were re-tested rather than taken from the docblocks that describe them.

| Reported defect | State on `origin/staging` | How verified |
|---|---|---|
| `अनुमोदन` 2.13:1 on `ApprovePage` / `SigningPage` (stranger, dark OS) | **FIXED** | Rendered both pages with `k_prefs` and `auth_token` absent under genuine OS-dark emulation. `data-theme=dark`, `body` = `rgb(12,14,17)`, and **`documentElement.style['--primary']` is empty** — the `THEMED_ACCENT` removal works. **0 failures** on both. |
| `.k-btn--primary` 2.51:1 in light (gradient to `--primary-vivid`) | **FIXED** | `editorial.css:925` is now flat `var(--primary)`. Measured 4.30:1 light / 8.36:1 dark. |

The 4.30:1 is the *known accent residual*, not the gradient bug — see §4.

---

## 2 · Failing pairs found and fixed

Format: `file/selector · light · dark · threshold · verdict`.
Threshold is **4.5:1** unless stated. Nothing here was passed at 3:1.

| # | File / selector | Light | Dark | Thr | Verdict |
|---|---|---|---|---|---|
| 1 | `kartavaya-design.css` `--side-fg-faint` as text — `.side__sec`, `.side__sec-hi`, `.side__wm-sub`, `.side__me-r`, `auth.css` `.au__by`, `.au__rot-en`, `.au__rot-f` | **2.52** | **2.06** | 4.5 | FAIL both themes. **Fixed** — aliased to `--side-fg-mute`. |
| 2 | `editorial.css:712` `.mnav__fab` — gradient `→ --primary-vivid` | **2.51** (vivid stop) | 5.5+ | 4.5 | FAIL light only. **Fixed** — flat `var(--primary)`. |
| 3 | `editorial.css:1000` `.k-avatar--me` — `--k-gradD`, white initials | **3.58** | **3.72** | 4.5 | FAIL both. **Fixed** — flat `--primary` + `--on-primary`. |
| 4 | `generate-report.css` `--k-mid` as text — `.gr__preview-brand-hi` (`कर्तव्य`), `.gr__preview-kicker`, `.gr__preview-sec i`, `.gr__seg-hint` | **4.02** | **4.26** | 4.5 | FAIL both. **Fixed** — `var(--primary-text)`. |
| 5 | `ganit.css` ×4 `.gn-li__x/.gn-link/.gn-act/button.gn-row:focus-visible` | n/a | n/a | 3.0 | **No focus ring at all.** **Fixed** — see §3. |
| 6 | `workflow.css:188` `.hcl-card:focus-visible` halo | n/a | n/a | 3.0 | **Halo never rendered.** **Fixed** — see §3. |
| 7 | `ActivityList.jsx` `DiffBadge` — `var(--danger)` on hardcoded `#fee2e2` | 4.6 | **2.03** | 4.5 | FAIL **dark only**. **Fixed** — `--danger-container` / `--on-danger-container`. |
| 8 | `ActivityList.jsx` `DiffBadge` — `#16a34a` on `#dcfce7` | **3.00** | **3.00** | 4.5 | FAIL both (fixed literals, neither flips). **Fixed** — `--ok-container` / `--on-ok-container`. |
| 9 | `NotifToast.jsx:154` — `#fff` on `var(--k-primary)` | **2.51** | **2.51** | 4.5 | FAIL both (`--k-primary` is `--primary-vivid`, identical in both themes). **Fixed** — `--on-primary` on `--primary`. |

**Row 1 is the big one.** `--side-fg-faint` carried *twenty* text elements on
**every page in the product**, plus three more on all four unauthenticated auth
pages. It included the entire bilingual sidebar section set — `workspace/कार्यक्षेत्र`,
`operations/प्रचालन`, `team/दल`, `revenue/राजस्व`, `people/जन`, `growth/वृद्धि` —
the same Devanagari-goes-invisible shape as the ApprovePage defect, on the most
frequently used surface in the app.

Why aliasing is the right repair and not a new colour: the smallest alpha that
clears 4.5:1 on `--side-ink` is **.46 light / .45 dark**, and `--side-fg-mute` is
already **.5 / .46** (5.23:1 / 4.66:1). A compliant fourth step would have to fit
in a 0.04 gap and be indistinguishable from the third. That is the identical
finding, and the identical resolution, that `--on-surface-faint` already carries
in the same file. All six consumers are `color:` on text — **zero non-text
consumers**, verified — so nothing is weakened by the alias.

One consequence handled: `.side__sec:hover` pointed at `--side-fg-mute` and would
have become a no-op. It now points at `--side-fg`, the brighter step the hover was
reaching for.

### Measured effect, same instrument, before → after

| Route (dark) | Before | After |
|---|---|---|
| `/dashboard` | 20 | **1** |
| `/reports` | 28 | **1** |
| `/ganit`, `/vetana`, `/prachar`, `/hub` | 20 each | **1** each |
| `/login` | 4 | **0** |
| `/dashboard` (light) | 21 | **3** |

The single dark remainder on every route is `.crumb__sep` — spec-sanctioned, §5.

---

## 3 · Two tokens that resolve but are the wrong TYPE

The brief asked me to check that tokens actually resolve rather than falling back.
These two do resolve — into something that silently destroys the declaration.

`--focus-ring` is **not a colour**. It is a complete ready-made shadow:
`0 0 0 3px color-mix(in srgb, var(--primary) var(--focus-mix), transparent)`.

**A · `ganit.css` ×4 — `outline: 2px solid var(--focus-ring)`.**
Substituting a shadow into the `outline` shorthand makes the declaration invalid
*at computed-value time*. That does **not** fall back to the previous rule — it
computes to `unset`, and `outline-style`'s initial value is `none`. Because
`.gn-act:focus-visible` outranks the app-wide `:focus-visible` rule in
`components.css:530`, the invalid declaration **defeated the global ring instead
of deferring to it**.

Proven with a genuine `:focus-visible` match, both patterns side by side:

```
ganit pattern    focusVisible: true   outline-style: "none"    ← no indicator
correct pattern  focusVisible: true   outline-style: "solid 2px rgb(5,183,170)"
```

Four interactive controls in Ganit had **no visible focus indicator at all**
(WCAG 2.4.7). `check-tokens.mjs` cannot see this — the token *is* declared.

**B · `workflow.css:188` — `box-shadow: 0 0 0 3px var(--focus-ring)`.**
Expands to `0 0 0 3px 0 0 0 3px color-mix(…)`. Measured computed value: **`none`**.
The halo never rendered, leaving a border-colour change as the only focus
feedback — and `:hover` on the line above sets *the same* border colour, so
keyboard focus was indistinguishable from hover.

Both fixed by using the token as the design declares it.

---

## 4 · Confirmed-but-not-fixed, with reasons

**a · The primary fill at 4.30:1 in light — a known, already-tracked residual.**
White on `#00897f` (= `acc.mid`, what `applyPrefs` actually writes) measures
**4.30:1** against a 4.5 threshold. It is on the most-used button in the product:
measured on 44 live instances across `.k-btn--primary`, `.btn--fill`, `.k-badge`,
and the **"Approve" / "Sign document" CTAs on the two public pages**.

This is **not new and not mine to close**: `scripts/check-accent-contrast.mjs`
prints it every run as one of four residuals, and its own note says closing it
means changing the accent **ramp**, which is a design decision, not a helper bug.
Confirmed still shipping. Flagged for the owner — it is the single highest-traffic
sub-threshold pair left in the app, and it is 0.2 away.

**b · `lib/utils.js` — two hardcoded palettes, never contrast-checked.**
`AVATAR_COLORS` and `PROJECT_COLORS` drive avatars, report person-swatches and
template kickers via a per-instance `--c`. Measured every entry:

| Palette | White text on the swatch | As `--c` text on `--surface` |
|---|---|---|
| `AVATAR_COLORS` (7) | **7 of 7 fail** — worst `#f59e0b` **2.15** | — |
| `PROJECT_COLORS` (10) | **9 of 10 fail** — worst `#f59e0b` **2.15** | **9 of 10 fail light** (worst `#f59e0b` 2.01) · 4 of 10 fail dark |

Live confirmations: `.gr__person-av` white on `#ec4899` **3.53** (`/reports`);
`.k-tmpl-card__kicker` / `__sans` — including the Devanagari `राजस्व` and `स्वागत` —
at **2.35** and **3.92** light, **4.36** dark (`/templates`).

Both palettes still carry retired literals the token layer explicitly lists as
gone: `#0082c6`, `#f59e0b`, `#d97706`, `#16a34a`-family. **Not fixed here**: a
replacement palette is a design decision, and `deriveOnAccent` already exists as
the mechanism if the owner wants swatch inks derived rather than assumed. This is
the largest remaining contrast defect by element count.

**c · `App.css` is a dead second design system — no fix, but it should go.**
Still imported by `App.jsx:18`. It declares its own `--bg/--fg/--card/--muted/
--border/--accent` as **RGB triplets** and paints via `rgb(var(--x))`. Those names
now lose the cascade to `kartavaya-design.css` and `dark-theme.css`, where they
are **hex** — so `rgb(#F3EFE6)` is invalid and every such rule silently drops.
Its `body` rule is neutralised only because `kartavaya-design.css:605` uses
`!important`. Class usage: `view-pill` 0, `text-muted-foreground` 0, `bg-card` 0,
`board-col-active` 0, `border-border` 0 live (2 mentions, both in comments).
`.view-pill.active` measures 3.16 light / 4.15 dark on the retired `#0082c6` — in
dead code. It also pulls a Google Fonts **Nunito** import that nothing uses.
Left alone deliberately: deleting a file `App.jsx` imports is a structural change
outside a contrast audit, and `styles/` is shared with six peers this run.

**d · `styles/brand.css` is not imported by anything** (verified across all JS and
CSS; only README mentions). Its two failures — `.k-pill-high` 2.24 dark,
`.k-badge` 3.16 light — are in dead CSS. Reported so nobody "fixes" a file that
never loads.

---

## 5 · Checked and clean

- **Status, approval and priority tokens.** All 17 (`--st-*`, `--ap-*`, `--pr-*`,
  `--ok/--warn/--danger`) measured against `--bg`, `--surface`, `--s-low`,
  `--s-container` in both themes: **68 pairs per theme, every one ≥ 4.5:1**.
  Worst is `--pr-low` on `--s-container` light at **4.56**. Live chips on `/tasks`
  with all six statuses × four priorities rendered: clean in both themes.
- **`.crumb__sep`** — 2.36 light / 2.90 dark, `--on-surface-disabled`. **Not a
  defect**: `kartavaya-design.css` §11 names the breadcrumb separator as a
  legitimate consumer of that token, and it is decorative `/` punctuation between
  crumbs, not content. Reported because it is the one remaining hit on every page.
- **Disabled states.** The landing `.lcta--fill` ("Request a demo") measures 2.19
  but carries a real `disabled` attribute — WCAG 1.4.3 exempt, and the state is
  exposed to assistive tech by the attribute, so it does not rely on colour alone.
  Same for the three `:disabled` rules `check-contrast` already buckets as exempt.
- **Focus ring colour.** `--primary` at 3px, plus a `forced-colors` block in
  `a11y.css` promoting the ring to system `Highlight`. Sound in both themes apart
  from the two type errors in §3.
- **`check-contrast.mjs` regression check.** Its pass-3 output is **byte-identical
  before and after** my changes — 13 pre-existing findings, no new ones, none
  removed. (Those 13 are mostly in dead `brand.css` or are the marginal 4.13–4.33
  translucent-tint chips; they predate this branch.)

---

## 6 · Coverage — what I measured, and what I could not reach

**Measured live**, full page load per route, populated with a synthetic fixture,
in **both themes**:

- **37 routes** — 30 authenticated + 7 public/auth.
- **≈3,800 text elements per theme (≈7,600 element-measurements)**, each with its
  effective background resolved by walking ancestors and compositing every
  translucent layer, and with **every stop of any gradient measured separately**.
- Plus static passes: 4,955 CSS rules across 40 stylesheets; 465 JS/JSX files for
  inline `style={{ color, background }}` pairs; 136 status-token pairs; 17
  palette colours.

**Could not reach — 9 routes and four state families:**

| Not reached | Why |
|---|---|
| `/admin`, `/admin/billing`, `/admin/orgs`, `/admin/costs` | `AdminShell`'s role gate redirected my synthetic user to `/dashboard`. The scans recorded are `/dashboard`'s and are **not** admin coverage. |
| `/client`, `/client/projects`, `/client/project/:id`, `/client/approvals`, `/client/files` | Client portal rendered 0 elements under the fixture. |
| Modals, drawers, overlays | `TaskDrawer`, `NewTaskModal`, `CommandPalette`, `NotificationsModal` were never opened. |
| Hover / active states | Not driven. Reachable only through the CSS passes, which do cover co-located pairs. |
| Real keyboard focus | The Browser pane is hidden, so `Tab` never reached the page. Focus was measured from tokens and from a constructed genuine `:focus-visible` match instead (§3) — that is how the two type errors were proven. |
| `/approve`, `/sign/:token` success states beyond the card chrome | The signing canvas and OTP steps need a fuller fixture. The card, its bilingual heading and both CTAs **were** measured. |

**Two methodology notes, both load-bearing:**

1. **My own instrument manufactured 52 phantom failures before I caught it.**
   The first backdrop walker stopped at *any* gradient and composited it over
   white. `.mt` (the module tab strip) paints a scroll-fade
   `linear-gradient(to right, rgb(12,14,17) 40%, rgba(0,0,0,0))` whose second stop
   is fully transparent — so four module pages reported 1.24:1 in dark when the
   real backdrop was `.kv` at `rgb(12,14,17)` two levels up. A gradient now only
   terminates the walk if **every** stop is opaque. **None of those 52 are in this
   report.** This is exactly the failure mode the brief warned about, and it came
   from the measuring tool, not the app.

2. **The peer's `prefers-color-scheme` warning — mechanism corrected.** No CSS
   rule in `src/` keys off `prefers-color-scheme`; the only consumers are JS
   (`CustomizePanel.systemPrefersDark`, and the two public pages). So a forced
   `data-theme` cannot trip a media query — but it *can* desync from what those
   JS paths compute. I therefore never forced `data-theme`. Light was measured
   twice, by two independent paths — genuine OS-level `colorScheme` emulation with
   `mode:'system'`, and the stored-preference path `mode:'light'` — and the two
   agreed **byte-for-byte** on `/dashboard`. Dark was measured with the machine's
   real OS setting, which is genuinely dark.

**No database, staging or production system was touched.** The frontend was
pointed at a synthetic loopback stub; `.env.local` is gitignored and uncommitted.
No sign-in occurred — `Protected` was satisfied with a local placeholder object.

---

## 7 · Files changed (7)

| File | Change |
|---|---|
| `frontend/src/styles/kartavaya-design.css` | `--side-fg-faint` aliased to `--side-fg-mute`, both theme blocks. |
| `frontend/src/styles/editorial.css` | `.mnav__fab` flat fill; `.k-avatar--me` flat fill + `--on-primary`; `.side__sec:hover` → `--side-fg`. |
| `frontend/src/styles/generate-report.css` | 4 text rules `--k-mid` → `--primary-text`. Border/shadow uses untouched. |
| `frontend/src/styles/ganit.css` | 4 `:focus-visible` rules: `--focus-ring` → `--primary`. |
| `frontend/src/styles/workflow.css` | `.hcl-card:focus-visible` halo uses `var(--focus-ring)` whole. |
| `frontend/src/components/ActivityList.jsx` | `DiffBadge` ×4 badges → container tokens. |
| `frontend/src/components/layout/NotifToast.jsx` | "View →" button → `--on-primary` on `--primary`. |

No new tokens, no new colour literals. Every fix adopts a value the design
system already defines. No `yarn.lock`, no snapshot churn, no peer overlap:
`ganit.css` and `generate-report.css` were also touched on `origin/staging` this
run, but in different regions (a GST screen block, and a `font-weight` on
`.gr__history-hi`) — both verified present and untouched after rebase.

---

## 8 · Gates

Run from `frontend/`, exit codes captured directly (not through a pipe, which
would report `tail`'s status):

```
node scripts/check-tokens.mjs     → 356 declared, 244 referenced, 0 missing   EXIT 0
node scripts/check-classes.mjs    → 3543 selectors, 2726 classes, 0 missing   EXIT 0
npx vite build                    → built in 13.16s                            EXIT 0
npx vitest run                    → 46 files / 716 tests passed                EXIT 0
grep -ci unhandled /tmp/vt.log    → 0
```

The brief's baseline of 43 files / 682 tests was `190fa73a`. After rebasing onto
`309dcced` the tree carries three more test files from peers. **Verified by
stashing: clean `309dcced` is also 46 / 716, exit 0** — identical with and
without my changes, so the delta is the peers', not mine.

`node scripts/check-accent-contrast.mjs` → **ok**, same four documented residuals.
`node scripts/check-contrast.mjs` exits 1 both before and after with the identical
13 findings — a pre-existing state on `origin/staging`, not a regression, and not
one of the required gates.
