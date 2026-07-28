# DESIGN-COMPARE — cross-cutting systems

Branch `staging`. Spec priority: `design-reference/Kartavaya Redesign/*.css|*.jsx`
first, `design-handover/*.md` second.

Excluded by instruction (already known, not re-reported): the Windows glass
opt-out now living at token level plus `prefers-reduced-transparency` in
`kartavaya-design.css`; `.k-glass` / `.card--glass` being dead; the CSP
inline-script fix; and the two landmarks both labelled "Notifications"
(`components/ui/toast.jsx:192` and `components/layout/NotifToast.jsx:267`).

---

## 1 · DARK MODE

### 1.1 Token parity — NO GAP

Programmatic diff of the two `[data-theme="dark"]` blocks:

| | count |
|---|---|
| `design-reference/Kartavaya Redesign/tokens.css:158-225` | 55 tokens |
| `frontend/src/styles/kartavaya-design.css:372-445` (+ `:470-478`, `:504`, `:525-531`) | 61 tokens |
| reference tokens **missing** from implementation | **0** |

The implementation dark block is a strict superset. The six extra tokens are
`--on-ok`, `--tint-weak`, `--tint-soft`, `--tint-mid`, `--tint-strong`,
`--focus-mix` — all from `14-dark-mode.md §4–5`, which the reference `tokens.css`
predates.

Nine tokens are declared in the light block and never re-declared in dark —
`--ap-approved`, `--ap-pending`, `--ap-rejected`, `--pr-high`, `--pr-low`,
`--pr-urgent`, `--st-done`, `--st-rejected`, `--st-requested`. **NOT A GAP**:
every one is an alias onto `--ok` / `--warn` / `--danger` / `--on-surface-3`,
which already flip. `kartavaya-design.css:476-477` states this.

Three shared names carry different values. All three are deliberate, documented
corrections *of* the reference, not drift from it:

| token | reference | implementation | why |
|---|---|---|---|
| `--outline` | `#5B626C` (`tokens.css:174`) | `#7E8590` (`kartavaya-design.css:397`) | SPEC-A11Y-1; the reference value is 2.01:1 on `--s-highest`, below WCAG 1.4.11's 3:1 |
| `--side-fg-faint` | `rgba(255,255,255,.24)` (`tokens.css:222`) | `var(--side-fg-mute)` (`:442`) | reference literal measures 2.06:1 on `--side-ink`; every call site is content text |
| `--shadow-4` | `0 24px 56px -12px rgba(30,28,22,.30), …` (`tokens.css:216`) | `0 32px 72px -28px rgba(0,0,0,.9)` (`:435`) | **reference defect**: `tokens.css:216` pastes the *light* warm-brown shadow into the dark block. The implementation is right. |

### 1.2 HIGH — the tint scale exists but 94% of call sites bypass it

`14-dark-mode.md §5`, restated verbatim in `kartavaya-design.css:506-517`:
*"color-mix percentages are not theme-portable … the most common dark-mode
defect in the codebase: a selected row that is obvious in light and invisible in
dark"*, and prescribes 1.5–2× in dark via `--tint-*`.

Measured across `frontend/src/styles/*.css`:

```
color-mix(in srgb, var(--x) <literal>%, transparent)   160 occurrences
color-mix(in srgb, var(--x) var(--tint-*), transparent)  9 occurrences
```

The tokens landed; the migration did not. The sub-10% sites are the ones the
spec names, because 4–8% over `#F3EFE6` reads and the same value over `#0C0E11`
does not. Worst offenders:

- `frontend/src/styles/editorial.css` — 53 literal-percentage mixes, 11 of them
  ≤10%. e.g. `editorial.css:2127` `background: color-mix(in srgb, var(--k-primary) 5%, transparent)`
- `frontend/src/styles/srijan.css:376` — `.hb-chat__row.on { background: color-mix(in srgb, var(--primary) 10%, transparent); }`
  This is the **selected** chat row, i.e. exactly the "selected row invisible in
  dark" case quoted above.
- `frontend/src/styles/module.css:343` — `.rv__r.is-cursor { background: color-mix(in srgb, var(--primary) 5%, transparent); }` (keyboard cursor row)
- `frontend/src/styles/boards.css:349`, `org.css:65`, `org.css:232`, `graha.css:306`,
  `documents.css:58`, `kartavaya-design.css:638-640`

**Severity: HIGH.** User-visible loss of selection/hover/cursor affordance in
dark on list, board and chat surfaces. `--tint-soft` / `--tint-strong` are a
drop-in replacement — no second rule needed.

### 1.3 Hardcoded light values — mostly NOT A GAP

`background: #fff` on the two toggle knobs is the one that looks wrong and
isn't:

```css
/* frontend/src/styles/components.css:369 */
.sw::after  { … background: #fff; box-shadow: var(--shadow-1); … }
/* frontend/src/styles/components.css:841 */
.tgl::after { … background: #fff; box-shadow: var(--shadow-1); … }
```

The reference does the identical thing — `design-reference/Kartavaya Redesign/app.css:270`
and `components.css:186` both hardcode `#fff` on the knob. **NOT A GAP.**
Same for the ~40 `color: #fff` sites on `.side*` / `.adm*`: those paint on
`--side-ink`, which is a near-black inverted surface in *both* themes.

Two that are real, both LOW:

- **`frontend/src/styles/auth.css:317`** — `.stg__b.on3 { background: #A6A44A; }`.
  The password-strength meter's other three rungs are `var(--danger)`,
  `var(--warn)`, `var(--ok)`, all of which flip; rung 3 is a fixed olive that
  does not. One bar out of four is theme-blind. LOW.
- **`frontend/src/styles/generate-report.css:617-619`** — `.gr__hrow-fmt--pdf/xlsx/csv`
  carry fixed `#8a1c30` / `#146a35` / `#383d47` with `color:#fff`. Legible in
  both themes, but off-system: no equivalent exists in the reference. LOW.

`frontend/src/styles/brand.css` carries a full set of light-only literals
(`#fff0f0`, `#e6f4ff`, `#e8f4fb`, `rgba(0,130,198,0.15)`, `.k-sidebar-*`) —
**dead file**, imported by nothing (`frontend/src/styles/index.css` does not list
it; no JSX imports it). It is still scanned by `scripts/check-contrast.mjs`,
which is why `.k-pill-high` at 2.24:1 shows in that report. LOW — delete, don't
fix.

`frontend/src/styles/landing.css` and `client.css` contain **zero** raw hex.
Fully tokenised.

---

## 2 · MOBILE WEB

### 2.1 The shell — NOT A GAP

The reference's `.mbar` (`mobile.css:301`, a sticky glass top bar) and `.mnav`
(`app.css:305`, the bottom nav) both have implementations under different names
for `.mbar`:

| reference | implementation | verdict |
|---|---|---|
| `.mbar` — `mobile.css:301` | `.kv__mobbar` — `editorial.css:152-191` | **NOT A GAP**, renamed. Same glass recipe (`rgba(var(--glass-tint), …)` + `blur(var(--glass-blur))`), same Windows opt-out at `editorial.css:168`. |
| `.mnav` — `app.css:305-311` | `.mnav` — `editorial.css:682-742` | same name, matches |
| `.mnav__ic` pill, `transition: background var(--dur-base)` — `app.css:308` | absent; `editorial.css:712` transitions the slot's own colour over `--dur-fast` | LOW — the pill is structure the build does not have; documented at `editorial.css:708-713` |
| `.mnav2*`, `.msheet*` — `mobile.css:278-298` | native-app shell only, out of web scope | n/a |

Safe-area insets are handled: `--m-safe-b: env(safe-area-inset-bottom, 0px)`
(`kartavaya-design.css:211`) consumed at `editorial.css:685`
(`padding: 6px 4px calc(6px + var(--m-safe-b))`), `components.css:811`,
`components.css:1160`, `mobile-responsive.css:495/498/507`. The reference does
the same inline at `app.css:305`. **NOT A GAP.**

Nav swap is paired correctly: `editorial.css:199-205` hides `.kv__side` and shows
`.kv__mobbar` at ≤1023px; `editorial.css:740-742` shows `.mnav` at ≤767px.

### 2.2 MED — 18 distinct breakpoints against a stated invariant of three

`frontend/src/styles/mobile-responsive.css:36` — *"Breakpoints, three only — each
extra one is another combination nobody"*; `frontend/src/styles/README.md:35-36`
— *"When adding a new media breakpoint, add it to `mobile-responsive.css` only —
don't scatter breakpoints across multiple files."*

Measured: **18 distinct `@media (max-width: …)` values across 20 files.**

```
767px ×16   640px ×11   1023px ×10   900px ×7   720px ×5   560px ×5
768px ×4    1100px ×4    760px ×2     600px ×2  1280px ×2
860 · 719 · 520 · 1400 · 1080 · 1024 · 1000  ×1 each
```

Four are off-by-one against the shell's own two breakpoints, which produces a
one-pixel band where the layout is in one mode and the chrome is in the other:

| stray | canonical | files |
|---|---|---|
| `768px` | `767px` (the `.mnav` breakpoint, `editorial.css:740`) | `layout.css:303`, `layout.css:341`, `boards.css:725`, `brand.css:171` (dead) |
| `1024px` | `1023px` (the sidebar→drawer swap, `editorial.css:199`) | `layout.css:363` |
| `719px` | `720px` | `documents.css:271` |
| `760px` | `767px` | `manav.css:404`, `srijan.css:364` |

At exactly 768px wide, `boards.css:725`'s mobile board layout fires while
`.mnav` is still hidden — mobile layout, no mobile nav. MED.

Mitigating: `layout.css` is **entirely dead** — `.content-wrapper`, `.grid-2/3/4`,
`.split-layout`, `.kanban-container`, `.table-container`, `.page-title` have
**zero** JSX call sites, so three of the six stray breakpoints are unreachable.
`boards.css:725` is the live one.

### 2.3 MED — two interactive controls under the 44px minimum

`design-handover/23-accessibility.md` and `15-mobile-web.md` set a 44px floor.
`frontend/scripts/check-touch-targets.mjs` reports 3; one is a false positive.

- **`frontend/src/styles/workflow.css:149-158`** — `.cat-swatch { width: 36px; height: 36px; }`,
  and `frontend/src/pages/CategoriesPage.jsx:116-120` renders it as
  `<input type="color" className="cat-swatch">`. A real control at 36×36 with no
  mobile rule raising either axis. The rule's own comment says *"Sized to match a
  36px control"* — the 36px sibling is a text input, which gets its hit area from
  padding; a colour well does not. **MED.**
- **`frontend/src/styles/workflow.css:281-290`** — `.tpl-ico__btn { width: 42px; height: 42px; }`,
  rendered as a `<button>` at `frontend/src/pages/templates/TaskTemplateForm.jsx:140-145`.
  2px short. **LOW.**
- `.gr__swatch` (`graha.css:242`, 16×16) — **NOT A GAP**, it is a
  `<span className="gr__swatch">` decoration at
  `frontend/src/pages/graha/LabelsTab.jsx:147`, not a control. Checker false
  positive.

---

## 3 · ANIMATIONS

### 3.0 Correction to the brief

The reference does **not** drive everything off `--ix` and `--motion-scale`.
`--ix` exists only in `design-reference/Kartavaya Redesign/motion.css:6-11`;
`--motion-scale` **does not exist anywhere in the reference** (0 occurrences
across all 11 reference stylesheets). `tokens.css:241` instead collapses the
five `--dur-*` tokens to `0s` under reduce, which contradicts `motion.css:24`'s
`--ix: .001` for the same media query — the reference disagrees with itself.

The implementation resolves this correctly: `kartavaya-design.css:150-154`
derives durations from `--ix`, `:198-200` sets `--ix: .001` (not 0, so
`animationend` still fires) and `--motion-scale: 0`, and `:37-55` adds the
`-user` twins so an in-app preference cannot outrank the OS setting via an
inline style. `--motion-scale` (travel distance, separate from duration) is an
implementation invention that is **ahead of** the spec. Not a gap.

### 3.1 Reduced-motion coverage is good — 12 scoped stop blocks

`animations.css:379`, `:592` · `auth.css:56`, `:417` · `editorial.css:805`,
`:2344`, `:3384`, `:3708`, `:3783` · `module.css:536` · `reports.css:304` ·
`sanvaad.css:1235` · `settings.css:246` · `kartavaya-design.css:198`.

Every decorative infinite loop is stopped: `.au__wm` (40s drift),
`.adm__badge-d`, `.k-skeleton::after`, `.k-shimmer__tile`, `.ix-skeleton::after`,
`.ix-pulse`, `.skeleton::after`, `.animate-pulse`, `.sv__dots i`,
`.snd__c.on .snd__w i`, `.k-onboard*`, `.mt__pop`.

The uncovered infinite animations are all **spinners** — `auth.css:361`,
`components.css:542`, `editorial.css:4230`, `generate-report.css:547`,
`palette.css:338` — plus `.prg--ind .prg__f` (`components.css:954`). This is
deliberate and argued at `animations.css:366-371`: loading indicators are
functional motion and WCAG 2.3.3 governs non-essential animation. The reference
leaves the same set running. **NOT A GAP.**

### 3.2 MED — `generate-report.css` escapes the motion system entirely

Six rules use literal durations that neither scale with `--ix` nor stop under
`prefers-reduced-motion: reduce`, because the reduce query only rewrites the
`--dur-*` / `--ix` / `--motion-scale` tokens and a literal is invisible to it:

```css
/* frontend/src/styles/generate-report.css */
:107  transition: background .12s, color .12s;
:169  transition: all .12s;
:200  transition: all .12s;
:238  transition: all .12s;
:253  transition: all .12s;
:278  transition: all .12s;
:484  transition: all .15s;
```

The one that actually moves:

```css
/* generate-report.css:481-490 */
.gr__pcard { … transition: all .15s; }
.gr__pcard:hover { … transform: translateY(-1px); }
```

A user with OS reduce-motion set still gets a 150ms translate on every preset
card on the Generate Report page. The system answer is `var(--dur-fast)` +
`calc(-1px * var(--motion-scale, 1))`, which `kartavaya-design.css:1117` and
`editorial.css`'s `.ix-lift` (`animations.css:273-279`) already use. **MED.**

Also off-system in the same file: `transition: all` (26 §6 forbids it — it
catches `width` and animates row reflow) and `border-radius:10px` literals at
`:197`, `:236`, `:276`, `:322`, `:482` against 00 §96. LOW.

### 3.3 LOW — `brand.css:101/134/160` — `transition: all 0.18s`, no `--ix`

Dead file (§1.3). Listed only so it is not rediscovered. LOW.

---

## 4 · ACCESSIBILITY

### 4.1 Skip link and landmarks — present in the app shell, MISSING on the two public shells

`components/ui/SkipLink.jsx:16-18` renders `<a className="k-skip" href="#main">`,
styled at `editorial.css:4205-4221` with a real `:focus-visible` reveal. It is
mounted first in DOM order in both authenticated shells —
`components/layout/AppShell.jsx:354` and `components/admin/AdminShell.jsx:102` —
and both provide the target (`AppShell.jsx:425` and `AdminShell.jsx:131`, both
`<main id="main" tabIndex={-1}>`). Landmarks are correct across the shell:
`<aside className="side">` (`Sidebar.jsx:159`), `<nav className="side__nav">`
(`:162`), `<header className="top">` (`Topbar.jsx:72`),
`<nav className="mnav" aria-label="Primary">` (`MobileNav.jsx:30`),
`<nav className="adm__nav" aria-label="Platform admin">` (`AdminSidebar.jsx:49`).

**MED — neither public shell has one:**

- `frontend/src/pages/marketing/LandingPage.jsx:61` — `<main>` with **no `id`**,
  no `SkipLink` anywhere in `LandingPage.jsx` or `sections/*.jsx`. The nav
  (`sections/Nav.jsx:25`) precedes it.
- `frontend/src/pages/client/ClientShell.jsx:100` — `<main className="cl-main">`,
  **no `id="main"`**, no `SkipLink`. `ClientShell.jsx:76` does carry
  `<nav className="cl-nav" aria-label="Portal">`, so landmark naming is fine —
  only the bypass mechanism is missing.

`23-accessibility.md` requires the skip link app-wide, and the client portal is
the surface an external user with no keyboard alternative actually lands on.
**MED.**

### 4.2 Focus visibility — NOT A GAP

`:focus-visible` rules appear in 19 of 37 stylesheets. `outline: none` appears 28
times but every instance is on an input/textarea that pairs it with a
border-colour or ring change (`components.css:60/667`, `editorial.css:3408`,
`org.css:34`, `auth.css:232`) or on a bare inline editor inside an already-focus-ringed
row. `styles/a11y.css:52-57` adds the forced-colours fallback
(`outline: 2px solid Highlight`), which the reference has no equivalent for.

### 4.3 Keyboard reachability — NOT A GAP for tables, MED for one modal

Every `<tr onClick>` found (`pages/ganit/InvoicesTab.jsx:131`,
`pages/graha/ClientsTab.jsx:206`, `pages/graha/ContactsTab.jsx:413`,
`pages/prachar/CampaignsTab.jsx:381`) wraps a real `<button>` on the identifying
cell, with `e.stopPropagation()`, and says so in a comment. **NOT A GAP.**

**MED —** three thumbnail surfaces in the attachment grid are mouse-only:

```jsx
/* frontend/src/components/NewTaskModal.jsx:919, :925, :936 */
<div onClick={() => setPreviewFile(f)} style={{ cursor: 'pointer', … }}>
```

No `role`, no `tabIndex`, no key handler; the third one's only affordance is the
text "Click to preview". The lightbox they open is fine — `NewTaskModal.jsx:336`
handles Escape and `:1048` has a labelled close button. MED.

### 4.4 Contrast — two real failures held at baseline

`node frontend/scripts/check-contrast.mjs` → *"no new failures and no
regressions"*, 7 held in `scripts/contrast-baseline.json`. Of those, one is a
genuine live defect rather than a measurement artefact:

- `frontend/src/styles/components.css:899` — `.av { color: #fff; background: var(--av-bg, var(--s-high)); }`
  measures **1.31:1** in light. Avatar initials are text. The rule at
  `editorial.css:1012` records the same finding for `.k-avatar` and fixes it
  there; `.av` did not get the same treatment. MED.
- `.cbx` (`components.css:847`) at 1.01:1 is a **false positive** — it is the
  *unchecked* state, where the tick is meant to be invisible.
- `.k-pill-high` / `.k-badge` (`brand.css:121`, `:173`) are in the dead file.

---

## 5 · BILINGUAL / DEVANAGARI

The invariant: `--font-hindi` is Tiro Devanagari Hindi, **weight 400 only**,
never letter-spaced, never uppercased. Confirmed at the font source —
`frontend/src/lib/tokens.css:32` loads `Tiro+Devanagari+Hindi:ital@0;1`, i.e.
roman + italic at a single weight. Any inherited 500/600/700/800 is synthesised
by the rasteriser: it smears the शिरोरेखा and closes the counters on ठ and ढ.

### 5.1 The system-level defences exist and work

- `editorial.css:3146` — `[lang="hi"], [lang="sa"], [lang="gu"] { letter-spacing: 0 !important; }`.
  An author `!important` beats any non-important rule regardless of file order,
  so **every tracking violation on an element carrying `lang` is already
  neutralised**, including `.au__wm`'s declared `letter-spacing: -.03em`
  (`auth.css:31`, which is dead in practice).
- `editorial.css:3179-3186` — `.k-lbl__in` resets family, weight 400 and
  `text-transform: none` for Devanagari inside a tracked/uppercase label.
- `editorial.css:3140-3141` — per-script line-height.

Cross-referencing all 731 JSX lines containing Devanagari against the 221 CSS
classes that are uppercase or tracked: **30 co-occurrences, all 30 carrying
`lang="hi"` on the inner span.** The tracking half of the problem is closed.

### 5.2 HIGH — `text-transform` and `font-weight` are NOT covered by the `[lang]` rule, and three surfaces rely on it

The `[lang]` rule resets tracking only. Weight and case must be reset per class,
and three do not:

**a. `frontend/src/styles/components.css:50` — `.fld__hi`, the shared Field
component. HIGH.**

```css
/* components.css:46 */
.fld__l  { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; … }
/* components.css:50 — no font-weight */
.fld__hi { font-family: var(--font-indic); text-transform: none; letter-spacing: 0; color: var(--primary-text); margin-left: 6px; }
```

`frontend/src/components/ui/Field.jsx:24` renders
`<span className="fld__hi" lang="hi">{sanskrit}</span>` **inside** `.fld__l`, so
the Devanagari inherits **600** on a single-weight face. Compare
`drawer.css:180-184` `.dr__lbl-hi`, which is the same pattern and *does* carry
`font-weight: 400`. Live at `pages/TeamsPage.jsx:151/249/324`
(योजना · व्यक्ति · भूमिका), `pages/vikray/OrderForm.jsx:77` (ग्राहक),
`pages/vikray/TargetsTab.jsx:107` (विक्रेता), and every other consumer of the
shared `Field` component — 35 call sites of the class.
**Fix: add `font-weight: 400` to `components.css:50`.**

**b. `frontend/src/components/BrandKit.jsx:44-51` — `SectionLabel`. HIGH.**

```jsx
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--ink-3)', marginBottom: 8, fontFamily: 'var(--font-ui), var(--font-hindi)' }}>
      {children}
    </div>
  );
}
```

Called with Devanagari **in the label string, with no inner span and no `lang`
attribute** — `BrandKit.jsx:210` `Colors · रंग`, `:218` `Fonts · फ़ॉन्ट`,
`:232`, `:241`. Because there is no `lang`, `editorial.css:3146` never fires:
this is the one place in the build where all three violations land at once —
**`letter-spacing: 0.12em` on रंग, `fontWeight: 800`, and `textTransform:
uppercase`.** 0.12em tracking is what splits क्ष and ज्ञ into separate glyphs.
This is exactly the accidental-shared-utility failure the brief predicted.

**c. `frontend/src/components/NewTaskModal.jsx:396-398`. HIGH.**

```jsx
<div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', … }}>
  {isClient ? 'REQUEST TASK' : 'NEW TASK'} · <span style={{ fontFamily: 'var(--font-indic)', textTransform: 'none', letterSpacing: 0 }}>{isClient ? 'अनुरोध' : 'नया कार्य'}</span>
</div>
```

The span resets family, case and tracking but **not weight** — अनुरोध / नया कार्य
inherit **800**. Every other Devanagari span in this same file gets it right
(`:436`, `:595`, `:1117` all carry `fontWeight: 400`), which is what makes this a
slip rather than a policy.

**d. `frontend/src/styles/editorial.css:4053` — `.k-shortcuts__hi`. MED.**

```css
.k-shortcuts__hi { font-family: var(--font-hindi); font-size: 12px; color: var(--ink-faint); }
```

No weight reset. At `components/KeyboardShortcuts.jsx:80` it sits inside
`<h2 className="k-shortcuts__title">`, which is `font-weight: var(--t-title-lg-w)`
= **500** (`palette.css:424`). कीबोर्ड शॉर्टकट renders faux-semibold.

### 5.3 MED — `.k-hero__greet` declares a weight the face does not have

```css
/* frontend/src/styles/editorial.css:1162 */
.k-hero__greet { font-family: var(--font-hindi); color: var(--on-surface-3); font-style: italic; font-weight: 300; }
```

Rendered at `components/editorial/Hero.jsx:41` as
`<span className="k-hero__greet" lang="hi">नमस्ते,</span>` — the dashboard
greeting, on every session. `300` is not a value Tiro ships; browsers do not
synthesise *lighter*, so it resolves to 400 and the declaration is inert — but it
is a direct violation of the stated invariant and will start producing a wrong
weight the moment `--font-hindi` gains a variable-weight fallback (the stack
already lists `Noto Serif Devanagari`, `Nirmala UI`, `Kohinoor Devanagari`, all
of which have multiple weights). MED.

`font-style: italic` here is **NOT A GAP** — the `@import` loads `ital@0;1`, and
`landing.css:93` (`.lhero__h em`) and `editorial.css:2248` (`.k-mcard__empty`) use
it the same way.

### 5.4 NOT A GAP — the four tracked labels flagged by a naive grep

`.k-rule__step-lbl` (`editorial.css:2635`), `.k-label` (`:3623`),
`.k-time-total__lbl` (`:3829`) and `.k-fld-label` all declare
`font-family: var(--font-ui), var(--font-hindi)` with 700/uppercase/tracking.
Reading the rule alone this looks like the bug. It is not: the Devanagari is
never written directly into these elements — `pages/AutomationsPage.jsx:411/419/426`
and `pages/TimeReportPage.jsx:203` all wrap it in
`<span className="k-lbl__in" lang="hi">`, which resets all three
(`editorial.css:3179-3186`). Appending `--font-hindi` after the full `--font-ui`
stack is deliberate per-script fallback, documented at `editorial.css:2631-2634`.

---

## 6 · DOCUMENTS — the 290mm budget

### 6.1 IT LANDED. Verified in source, not in the ledger.

```python
# backend/services/doc_render.py:129-144
PAGE_HEIGHT_MM = 297          # A4
…
CONTENT_BUDGET_MM = 290
PAGE_TAIL_MM = PAGE_HEIGHT_MM - CONTENT_BUDGET_MM   # 7mm of headroom
```

It is *consumed*, not just declared:

- `doc_render.py:541` — `size:A4; margin:0 0 {PAGE_TAIL_MM}mm 0;` — the budget is
  spent as `@page` bottom margin, so the letterhead does not move.
- `doc_render.py:597` — `min-height:{CONTENT_BUDGET_MM}mm` on `.page`.

It is *enforced*: `backend/tests/test_document_pagination.py:47` imports
`CONTENT_BUDGET_MM` and `PAGE_HEIGHT_MM` and measures **ink extent**, not the
`.page` box (the file explains at `:10-16` why the obvious measurement is a lie —
`min-height` makes short documents falsely report 297.1mm).

Eight documents route through `doc_render.render_pdf`: `invoice_pdf.py:402`,
`quotation_pdf.py:278`, `agreement_pdf.py:325`, `payslip_pdf.py:230`,
`statement_pdf.py:291`, `project_report_pdf.py:273`, `tds_challan_pdf.py:377`,
`gstr3b_pdf.py:578`.

Note: `doc_render.py:109`'s header comment still says *"content breaks at
285mm"*, contradicting the constant 21 lines below it (which was raised to 290
and documents why at `:130-142`). Stale comment only — the code is right. LOW.

### 6.2 MED — two PDF paths never adopted the budget

**`backend/services/report_generator.py`** — the Generate Report feature — does
not import `doc_render` and lays out its own sheet:

```python
# report_generator.py:607-616
@page{{ size:A4; margin:0; }}
.pdf{{
  width:210mm; height:297mm;
  …
  page-break-after:always;
}}
# report_generator.py:637
.pdf__body{{ flex:1; min-height:0; …; overflow:hidden; }}
```

Zero bottom margin, a hard `height:297mm`, and `overflow:hidden` on the body.
That is the opposite trade from the budget: instead of reserving 7mm so nothing
orphans, it fills the sheet edge-to-edge and **silently clips** anything that
overflows. `doc_render.py:111-118` argues at length that a document laid out to
the last millimetre "has no answer" to driver margins, font substitution and
rasteriser rounding. This path has exactly that problem plus data loss.

**`backend/services/cost_report_pdf.py:146` and `:304`** — `@page { size: A4;
margin: 20mm 18mm; }`, imports only `esc` from `doc_render`. The 40mm of vertical
margin is more generous than the budget, so no clipping — but it is a third,
independent page geometry. LOW.

Neither is covered by `test_document_pagination.py`.

---

## 7 · LANDING PAGE + CLIENT PORTAL

### 7.1 Both exist

- Landing: `frontend/src/pages/marketing/LandingPage.jsx` +
  `sections/{Nav,Hero,Modules,Features,Pricing,Trust,Footer}.jsx`, styled by
  `frontend/src/styles/landing.css` (372 lines).
  `.lnav.solid` is at `landing.css:50`, applied from `sections/Nav.jsx:25`
  (`` className={`lnav${solid ? ' solid' : ''}`} ``). Confirmed as the landing
  nav.
- Client portal: `frontend/src/pages/client/{ClientShell,ClientHome,ClientProject,ClientApprovals,ClientFiles,RequestWork,WorkList}.jsx`,
  styled by `frontend/src/styles/client.css` (406 lines), imported at
  `ClientShell.jsx:28`.

Both are fully tokenised — no raw hex in either stylesheet — and both are
theme-aware by inheritance.

### 7.2 MED — the landing page is a re-implementation, not a port

Reference `design-reference/Kartavaya Redesign/landing.css` is 22,308 bytes
against the build's 372 lines, and the class vocabularies only partly overlap.
Shared roots: `.lnav`, `.lhero`, `.lsec`, `.lmod(s)`, `.lplan(s)`, `.lfeat`,
`.lcta`, `.lfoot`. Divergent:

| reference | build | note |
|---|---|---|
| `.lart*` (18 classes — the animated in-app hero art: `.lart__chat`, `.lart__bub`, `.lart__f--inv`, `.lart__crumb` …) | `.lframe*` + `.lfrag*` (a static app frame with tax/ACL fragments) | different concept, same slot. MED — the hero's centrepiece is not the designed one. |
| `.lbtn` / `.lbtn--fill` / `--ghost` / `--out` / `--lg` / `.lbtn__sub` | `.lcta` / `--fill` / `--out` / `--nav` | renamed; `--lg` and `__sub` have no equivalent. LOW |
| `.lprice__tog`, `.lprice__save` (monthly↔annual toggle with a savings badge) | `.lplans__a` / `.lplans__a--off` | **partially missing** — no savings badge. MED |
| `.lhero__wm`, `.lhero__mesh` (Devanagari watermark + mesh gradient) | absent | LOW, decorative |
| `.lmenu*` (mobile menu panel) | `.lnav__links.open` + `.lnav__burger` (`landing.css:356-358`) | **NOT A GAP**, same behaviour under a different name |
| `.lfoot__lang` (footer language selector), `.lfoot__soc`, `.lfoot__made` | `.lfoot__sans`, `.lfoot__base` | language selector **missing**. MED — this is the bilingual product's public entry point. |
| `.lpill`, `.lnote`, `.lnote--c`, `.lplan__flag`, `.lplan__cr` | absent | LOW |

Reduced-motion parity is fine: reference `landing.css:8`
`@media (prefers-reduced-motion: reduce) { [data-rev] { opacity: 1; transform: none; } }`;
the build has the `.js-rev` equivalent in `landing.css`.

### 7.3 Client portal — structurally sound

`ClientShell.jsx:64/76/100` give `<header className="cl-head">`,
`<nav className="cl-nav" aria-label="Portal">` and `<main className="cl-main">`.
`19-client-portal.md`'s surfaces all have files. The only cross-cutting defect is
§4.1's missing skip link / `id="main"`.

---

## Summary table

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | Devanagari inherits `fontWeight: 800` + `letterSpacing: .12em` + `uppercase`, no `lang` | **HIGH** | `components/BrandKit.jsx:44-51`, called `:210/:218/:232/:241` |
| 2 | `.fld__hi` has no `font-weight: 400`; inherits 600 from `.fld__l` | **HIGH** | `styles/components.css:50` (35 sites) |
| 3 | Devanagari span inherits `fontWeight: 800` | **HIGH** | `components/NewTaskModal.jsx:396-398` |
| 4 | Tint scale bypassed — 160 literal-% color-mix vs 9 tokenised | **HIGH** | `editorial.css` ×53, `srijan.css:376`, `module.css:343`, … |
| 5 | `.k-shortcuts__hi` inherits weight 500 | MED | `styles/editorial.css:4053` |
| 6 | `.k-hero__greet` declares `font-weight: 300` | MED | `styles/editorial.css:1162` |
| 7 | `report_generator.py` ignores the 290mm budget; `overflow:hidden` clips | MED | `backend/services/report_generator.py:607-637` |
| 8 | No skip link / `id="main"` on landing or client portal | MED | `marketing/LandingPage.jsx:61`, `client/ClientShell.jsx:100` |
| 9 | 18 breakpoints across 20 files vs "three only"; 768/767 and 1024/1023 collisions | MED | `boards.css:725` (live), `layout.css:303/341/363` (dead) |
| 10 | `generate-report.css` — 7 literal transitions, one with a live transform under reduce | MED | `styles/generate-report.css:107/169/200/238/253/278/484` |
| 11 | `.cat-swatch` colour input at 36×36 | MED | `styles/workflow.css:149` |
| 12 | 3 mouse-only attachment thumbnails | MED | `components/NewTaskModal.jsx:919/925/936` |
| 13 | `.av` avatar initials 1.31:1 (baselined) | MED | `styles/components.css:899` |
| 14 | Landing hero art, pricing savings badge, footer language selector absent | MED | `styles/landing.css` vs reference |
| 15 | `.stg__b.on3` fixed `#A6A44A` in a token-driven meter | LOW | `styles/auth.css:317` |
| 16 | `.tpl-ico__btn` 42px | LOW | `styles/workflow.css:281` |
| 17 | `doc_render.py:109` comment says 285mm, constant is 290 | LOW | `backend/services/doc_render.py:109` |
| 18 | `brand.css` and `layout.css` are dead but still shipped/scanned | LOW | `styles/brand.css`, `styles/layout.css` |
