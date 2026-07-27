# App shell & navigation — PIXEL AND TYPE

Agent branch `worktree-agent-a7598cd25b39ffba4`. Surface: `frontend/src/components/layout/**`
and the `.kv` / `.side` / `.top` / `.crumb` rules in `frontend/src/styles/editorial.css`.

**Everything below is a measured `getComputedStyle` value, not a reading of CSS.**
Both surfaces were rendered side by side in one document at an identical 1280×800
viewport and diffed property by property.

---

## 0. How this was measured — and the two traps that make it wrong if you skip them

`frontend/__probe.html` (untracked, deleted before merge) hosts two same-origin
iframes at exactly 1280×800:

| frame | src | what it is |
|---|---|---|
| `#buildbox` | `/__shell.html` → `src/__probe.jsx` | the REAL `Sidebar` + `Topbar` inside `CustomizeProvider`, with `App.jsx`'s CSS barrel in `App.jsx`'s import order |
| `#refbox` | `/__ref/Kartavaya%20Redesign.html` | the runnable reference harness |

One script walks a selector-pair list and diffs 37 computed properties plus the
client rect. Two traps that silently corrupt the numbers:

1. **The build shell is `width:100vw; height:100vh`.** Rendering it in a sized
   `<div>` does nothing — it takes the tab's viewport, so the topbar's flex
   children and `.kv__content` measure against the wrong width. It needs its own
   document in an iframe.
2. **`applyPrefs` runs in a `useEffect`.** A token snapshot taken as soon as
   `.side__item` exists reads the CSS `:root` defaults, not the applied ones.
   Snapshot after the attributes land. My first pass reported
   `data-density=null` for this reason; the real value is `comfy`.

Also note: **the dev server on :5173 runs from the shared checkout, not from a
worktree.** Measuring the build through it measures whatever another agent has
uncommitted. I ran my own Vite on :5488 from this worktree.

---

## 1. BASELINE — established first, and the build is wrong on both axes

The brief asked for this first because every spacing number depends on it.

### 1a. Density — the build's default is one whole tier looser than the design

| | reference | build (as shipped) |
|---|---|---|
| `<html data-density>` | **`cozy`** | **`comfy`** |
| tiers that exist in CSS | `compact`, `cozy`, `comfy` | `compact`, `comfy` — **no `cozy` anywhere in `frontend/src`** |
| appearance control | `Chrome.jsx:196` — three buttons: compact · cozy · comfy | `TabLayout.jsx:35` — two: Compact · Comfy |
| default in app state | `App.jsx:3` → `density: 'cozy'` | `CustomizePanel.jsx:76` → `density: 'comfy'` |

Measured token values under each default:

| token | ref `cozy` | build `comfy` | delta |
|---|---|---|---|
| `--row-h` | 44px | 48px | **+4** |
| `--pad-page` | 28px | 32px | **+4** |
| `--pad-card` | 18px | 20px | +2 |
| `--gap-section` | 22px | 26px | +4 |
| `--gap-tight` | 10px | 12px | +2 |

`--pad-page` is the topbar's horizontal padding **and** `.kv__content`'s padding on
every page, so this is not a sidebar detail — it moves the whole product.

The build's `:root` block (`kartavaya-design.css:91-92`) already declares
**44 / 28 / 18 / 22 / 10** — the reference's `cozy` numbers exactly. The correct
baseline was already in the file; `applyPrefs` writes a `data-density` attribute
unconditionally, so `[data-density="comfy"]` always won and `:root` was never
reached. **The right numbers were shipped and unreachable.**

The other two tiers were also off:

| tier | reference (`tokens.css:228-230`) | build (`kartavaya-design.css:97-98`) |
|---|---|---|
| compact | 34 / 18 / 12 / 14 / 7 | 38 / 16 / 14 / 16 / 8 |
| comfy | 54 / 38 / 24 / 30 / 14 | 48 / 32 / 20 / 26 / 12 |

**FIXED** — three tiers with the reference's numbers, `cozy` added and made the
default, and a Cozy option added to the picker so the default is reachable.

> One inconsistency inside the reference, recorded rather than followed:
> `SetCustomize.jsx:268` (the Settings *screen* mockup) offers only two density
> options and maps its "Comfy" label to `data-density="cozy"` at `:491`. So
> `[data-density="comfy"]` is unreachable from that screen. `Chrome.jsx` — the
> harness that actually renders the product — offers all three. I followed
> `Chrome.jsx`.

### 1b. Display preset

Reference `<html data-display="serif">`; `tokens.css:233-235` defines
`[data-display="sans"]` and `[data-display="hybrid"]`.

**The build has zero occurrences of `data-display`.** It reaches the same place by
a different route — `applyPrefs` writes `--font-display` / `--font-ui` inline from
`prefs.font` / `prefs.uiFont`, and the default `newsreader` produces the same
`--font-display: 'Newsreader', Georgia, serif` the reference computes. Measured
identical. **Not a defect for this surface**, but `[data-display="sans"]` also
sets `--t-display-w: 300; --t-headline-w: 400`, and the build never varies those
weights — so a future "sans display" preset would come out at serif weights. Left
alone; it is the display-type owner's call, not a shell measurement.

### 1c. Corner radius — global, and worth a second opinion

| | reference | build |
|---|---|---|
| `--radius-base` | **12px** (`App.jsx:3` `radius: 12`) | **10px** (`CustomizePanel.jsx:82`) |
| control | `Chrome.jsx:190` — slider, min 8 max 28 step 2 | `TabLayout.jsx` — presets 4 / 10 / 20 |

Measured consequence on this surface: every nav item, the collapse toggle and the
avatar radius compute `--r-sm` = **6.96px** in the reference and **5.8px** in the
build.

**FIXED** — default raised to 12 and the presets moved to 8 / 12 / 20 so the
default is selectable and every option sits inside the reference's slider range.
**This is a global change** — `--radius-base` drives `--r-xs/sm/md/lg` on every
card, input and chip in the app. It is the one fix here with blast radius beyond
the shell. Revert `DEFAULTS.radius` alone if the owner disagrees; nothing else
depends on it.

> `SetCustomize.jsx:272` offers 4 / 10 / 20 with default 10, contradicting
> `Chrome.jsx`. Same split as the density control, resolved the same way — the
> harness that renders the product wins over the settings-screen mockup.

---

## 2. What is already pixel-exact — measured, not assumed

Do not "fix" these. They were verified identical to two decimal places:

| property | value in both |
|---|---|
| `.side` width | **252px** |
| `.side` `backdrop-filter` | **`blur(13.2px) saturate(1.3)`** |
| `.side` background | `rgba(22, 26, 24, 0.83)` |
| `.side` border-right | `0.8px solid rgba(255,255,255,.1)` |
| `.side--rail` width | 72px |
| `.side__item` padding | `9px 11px` |
| `.side__item` icon↔label gap | `11px` |
| item icon left offset from sidebar edge | **19px** |
| `.side__item.on` background | `color-mix(primary-vivid 20%, transparent)` |
| `.side__item.on::before` rail | `left:-8px width:3px radius 0 3px 3px 0`, `--primary-vivid` |
| `.side__sec` padding-top / bottom | `14px` / `5px`, `align-items: baseline`, gap 8px |
| `.side__sec` Latin | 8.5px / 700 / **1.7px tracking** / uppercase / `--side-fg-faint` |
| `.side__badge` padding / radius / height | `1px 7px` / `--r-pill` / 14.8px |
| `--side-*` ink ramp, `--primary-vivid`, `--on-surface*`, `--danger` | identical |

The `blur(30px) saturate(1.8)` and `blur(18px) saturate(1.6)` literals in
`01-navigation.md:38` and `:88` are **stale prose**. The rendered reference derives
both from `--glass-blur` / `--glass-sat` and computes 13.2/1.3 for the sidebar and
the topbar alike. The build already matches the rendered values. `01`'s literals
should not be followed.

---

## 3. Bilingual — the tracking rule the brief flagged is SAFE, and one leak that is real

`24-bilingual-devanagari.md` forbids tracking and uppercasing on Devanagari.
Measured `letter-spacing` on every Devanagari line:

| line | reference | build |
|---|---|---|
| `.side__wm-hi` / `.wm__hi` | `normal` | `normal` |
| `.side__sec-hi` | `normal` | `normal` |
| `.side__hi` | `normal` | `normal` |
| `.crumb__hi` | `normal` | `normal` |

**No tracking leaks onto Devanagari anywhere in the shell.** The build is
structurally protected by `editorial.css:2562`
— `[lang="hi"], [lang="sa"], [lang="gu"] { letter-spacing: 0 !important }` —
and every Devanagari span in `Sidebar.jsx` / `Topbar.jsx` / `SideBrand.jsx` carries
`lang`, verified by the rule-match dump. `text-transform` computes `none` on all
four in both. This is stronger than the reference, which relies on each rule
remembering to reset.

### The real bilingual defect: faux-bold Tiro

`.side__sec-hi` computes **`font-weight: 700` in BOTH**, inherited from the
uppercase section heading. Tiro Devanagari Hindi ships weight 400 only, so 700 is
synthesised — the rasteriser smears the शिरोरेखा and closes the counters on ठ and ढ.
The build's own stylesheet argues exactly this at `editorial.css:2573-2577` for
`.k-lbl__in` and then does not apply it to its own section heading.

The reference has the same bug. **FIXED in the build** — `font-weight: 400` on
`.side__sec-hi`, which is what `24` requires and what the neighbouring comment
already says.

### Devanagari leading: a build invention, kept, but it is why every row is taller

`editorial.css:2556` — `[lang="hi"], [lang="sa"] { line-height: calc(var(--line-height-base,1.5) * 1.18) }`.
Measured ratio **1.77** on every Devanagari line in the build vs **1.5** in the
reference. The rationale in the comment is sound (the शिरोरेखा collides with the
next line's conjuncts at Latin leading) and it derives from `--line-height-base`
so the Line-height control still reaches it. **Kept — this is a `--motion-scale`
class of improvement, not a defect.** Two consequences to know:

- It costs **+4.58px on every nav row**, +9.1px on the wordmark block, +4.8px on
  every section heading and +3.5px on the breadcrumb. That is the single largest
  contributor to the shell being taller than the reference.
- It **silently kills `.side__hi { line-height: 1.5 }`** at `editorial.css:271`.
  Same specificity (0,1,0), later in the cascade. That declaration has never once
  applied. Left in place but it is dead and reads as authoritative — worth a
  comment or a delete by whoever next touches it.

---

## 4. Measured diffs — sidebar

Reference selector → build selector. Every row is a computed value.

### Brand block

| element | property | REF | BUILD | status |
|---|---|---|---|---|
| `.mark` → `.side__mark` | width/height | 34×34 | 32×32 | **FIXED** |
| | border-radius | 9.6px (`calc(--radius-base * .8)`) | 5.8px (`--r-sm`) | **FIXED** |
| | box-shadow | `inset 0 1px 0 rgba(255,255,255,.24)`, `0 5px 16px -6px rgba(5,183,170,.7)` | **`none`** | **FIXED** |
| `.wm__main` → `.side__wm-en` | font-size | 19px | 20.02px | left — token, +1.02px |
| | **letter-spacing** | **+0.076px** (`.004em`) | **−0.2002px** (`−.01em`) | **FIXED — sign was flipped** |
| `.wm__hi` → `.side__wm-hi` | font-size | 14px | 14px | = |
| | line-height | 15.68px | 24.78px | see §3 |
| `.wm__sub` → `.side__wm-sub` | font-size | **8.5px** | **11.06px** | **FIXED** (+30%) |
| | letter-spacing | 1.7px (`.2em`) | 1.9908px (`.18em`) | **FIXED** |
| `.side__brand` | height | 83.26px | 96.39px | −13.1 after the above + §3 |

### Section headings

| property | REF | BUILD | status |
|---|---|---|---|
| Latin: size / weight / tracking / transform / colour | 8.5px / 700 / 1.7px / uppercase / `rgba(255,255,255,.28)` | identical | = |
| Latin `line-height` | 12.75px | **`normal`** | **FIXED** — the build's heading is a `<button>` and took the UA default |
| Devanagari `.side__sec-hi` font-size | 11px | 12.04px (`--t-label`) | **FIXED** → `--t-label-sm` (11.06px) |
| Devanagari `font-weight` | 700 | 700 | **FIXED** → 400, see §3 |
| box height | 35.5px | 40.3px | −4.8 after the above |
| padding | `14px 18px 5px` | `14px 10px 5px` + `margin: 0 8px` | equal net inset (18px) |
| **Latin word left offset from sidebar edge** | **18px** | **36px** | **NOT FIXED — structural, see below** |

The 18px→36px shift is the collapse chevron the build inserts before the section
name. The heading no longer aligns with anything: nav-item icons sit at 19px in
both, so in the reference the section word and the icons share an edge and in the
build they do not. The chevron is a collapsible-sections feature the reference does
not have, and removing or repositioning it is a DOM change — **that belongs to the
structure sibling, not to me.** The number is the finding: 18px is the target.

### Nav items

| property | REF | BUILD | status |
|---|---|---|---|
| row height | **49.2px** | **53.2px** | −4.58 traced to §3, remainder from font-size |
| `.side__item` font-weight | **500** | **400** | **FIXED** — the reference sets 500 on the item; the build set it only on `.side__en`, so the badge and every non-`.side__en` child rendered a step light |
| `.side__en` size / tracking | 13.5px / −0.0675px | 13.02px / −0.0651px | left — token, −0.48px |
| `.side__hi` font-size | 10px | 11.06px (`--t-label-sm`) | left — deliberate, documented at `editorial.css:266-268` |
| `.side__hi` font-weight | 500 | 400 | **build is correct** — Tiro is single-weight; do not "fix" toward the reference |
| `.side__ic` / svg | **17×17** | **16×16** | **FIXED** |
| radius | 6.96px | 5.8px | **FIXED** via §1c |
| resting colour | `rgba(255,255,255,.8)` | same | = |

### Badges

Reference renders **six** badges — Tasks 12, Finance 4, Attendance 3, Messaging 7,
Roles 1, Approvals 3 — **all identical and all teal**:

```
bg = color-mix(in srgb, var(--primary-vivid) 26%, transparent)   fg = #05b7aa
font-size 10px / 700 / padding 1px 7px / --r-pill / height 14.8px
```

The build splits them into `.side__badge--count` and `.side__badge--admin`, and
`--count` renders **`--danger` #B42318 with white text** at 11.06px. So the two
counts the build actually shows (Approvals, Inbox) are red where the design has
them teal.

`01-navigation.md:57` independently agrees with the render — teal, 10px. **FIXED**:
`--count` now takes the base badge treatment and keeps its `min-width: 18px;
text-align: center`, which is a genuine improvement for a single digit and costs
nothing. Font-size left on the token (11.06 vs 10). Flagging it loudly because a
red unread badge is a defensible product choice — it is just not this design's.

### Footer

| property | REF | BUILD | status |
|---|---|---|---|
| `.side__me-r` colour | `--side-fg-faint` (.28) | `--side-fg-mute` (.5) | **FIXED** |
| `.side__me-r` text-transform | none | capitalize | left — the build renders a raw role code, so capitalize is load-bearing |
| `.side__me-n` font-size | 12.5px | 13.02px | left — token |
| avatar gradient | `linear-gradient(140deg, #05b7aa, #0082c6)` | `linear-gradient(135deg, #026b64, #04837a 55%, #05b7aa)` | reported — accent-ramp owner |
| `.side__toggle` font-size | 11px | 12.04px | left — token |

### Sidebar blooms

`.side::before` — reference `color-mix(--primary-vivid 26%)` fading at 66%; build
18% / 70%. `.side::after` matches at 16% but fades at 70% vs 66%. **FIXED** both.

---

## 5. Measured diffs — topbar

| property | REF `.bar` | BUILD `.top` | status |
|---|---|---|---|
| **height** | **56px** | **54px** | **FIXED** |
| background | `rgba(250,247,240, 0.83)` — `var(--glass-alpha)` | `rgba(250,247,240, 0.72)` — hardcoded | **FIXED** |
| position | `relative` (+ `z-index: 20`) | `static` | **FIXED** |
| `backdrop-filter` | `blur(13.2px) saturate(1.3)` | identical | = |
| `.crumb` gap | 9px | 8px | **FIXED** |
| `.crumb__hi` font-size | **16px** | **14px** (`--t-body`) | **FIXED** → `--t-title` (15.96px) |
| `.crumb__sep` colour | `--on-surface-disabled` #9DA096 | `--on-surface-faint` #666A61 | **FIXED** — the build's separator was three steps too dark |
| `.crumb__cur` font-size | 13.5px | 13.02px | left — token |

The hardcoded `.72` is worth naming separately: the sidebar honours
`var(--glass-alpha)` so the Translucency control reaches it, and the topbar beside
it did not. One surface responded to the slider and the other did not.

---

## 6. Divergences reported, not fixed — they are not this surface

- **`--primary` and `--primary-text`.** Reference `#04837A` / `#046B64`; build
  `#00897f` / `#005650`. The build's `ACCENTS` teal and `deriveAccentColors` produce
  a different ramp from the reference's. It shows on `.crumb__hi`, every primary
  button and every link. Accent-ramp owner.
- **`--font-ui`.** Reference declares `"Public Sans"` and **never loads it** — its
  `@import` at `tokens.css:6` fetches Newsreader, Inter, Tiro and JetBrains Mono
  only, so the whole reference renders in `system-ui`. The build uses Inter, which
  the reference does load but does not point `--font-ui` at. Every Latin width
  measurement above therefore compares Inter against Segoe UI; sizes, weights and
  tracking are unaffected. **Do not "fix" the build toward a font the reference
  never loads.**
- **The type scale.** The reference uses literals (13.5px, 10px, 8.5px…); the build
  derives every step from `--font-size-base` so the Text-size control reaches them.
  At the 14px default every derived step lands within 1.06px of its literal, except
  the two I corrected (`.side__wm-sub` +2.56px, `.crumb__hi` −2px). Converting the
  rest back to literals would regress a shipped, documented feature to buy under a
  pixel. Left as tokens deliberately.
- **Collapse chevron indent** (§4) — structure sibling.
- **`.side__sec-items` collapse animation** — motion sibling.

---

## 7. Post-fix verification — re-measured, same probe, same viewport

Run after the two fix commits. `REF | BUILD`:

| | REF | BUILD | |
|---|---|---|---|
| `<html data-density>` | cozy | **cozy** | ✅ |
| `--pad-page` | 28px | **28px** | ✅ |
| `--radius-base` | 12px | **12px** | ✅ |
| mark box | 34×34 | **34×34** | ✅ |
| mark radius | 9.6px | **9.6px** | ✅ |
| mark shadow | inset + teal cast | **identical string** | ✅ |
| wordmark tracking | +0.076px | **+0.08008px** | ✅ sign corrected |
| byline size / tracking | 8.5px / 1.7px | **8.5px / 1.7px** | ✅ exact |
| section heading line-height | 12.75px | **12.75px** | ✅ |
| section Devanagari size | 11px | **11.06px** | ✅ |
| section Devanagari weight | 700 (faux-bold) | **400** | ✅ deliberate improvement |
| nav item weight | 500 | **500** | ✅ |
| nav item radius | 6.96px | **6.96px** | ✅ exact |
| nav icon | 17×17 | **17×17** | ✅ exact |
| role-line colour | `rgba(255,255,255,.28)` | **identical** | ✅ |
| topbar height | 56px | **56px** | ✅ |
| topbar background | `rgba(250,247,240,0.83)` | **identical** | ✅ |
| topbar position | relative | **relative** | ✅ |
| crumb gap | 9px | **9px** | ✅ |
| crumb Devanagari size | 16px | **15.96px** | ✅ |
| crumb separator | `rgb(157,160,150)` | **identical** | ✅ |
| badge bg / fg | teal 26% / `#05b7aa` | **identical on both counts** | ✅ |

### What remains different, and why each one stays

| | REF | BUILD | reason |
|---|---|---|---|
| nav row height | 49.2px | 53.2px | +4.58 is the `[lang="hi"]` 1.18× leading — a correct build invention (§3) |
| section heading box | 35.5px | 38.58px | same |
| brand block | 83.26px | 93.51px | same, plus 1.02px on the wordmark's token step |
| section word left offset | 18px | 36px | the collapse chevron — structural, not mine |
| wordmark / label / crumb-current sizes | literals | tokens, ≤1.06px off | the Text-size control reaches tokens and not literals |
| `--primary`, `--primary-text` | `#04837A` / `#046B64` | `#00897f` / `#005650` | accent-ramp owner |

### Re-verified after rebasing onto staging

Staging moved 20 commits under me, including a sibling's `feat(nav)` on this exact
file. `editorial.css` conflicted twice — both additive, both kept in full: their
`.side__me-r` ellipsis merged with my colour change, their new `.crumb__org`
segment merged with my `gap: 9px`. I then **re-rendered and re-measured the
rebased tree** rather than trusting the resolution:

```
build density=cozy  --pad-page=28px  --radius-base=12px  --row-h=44px
OK mark · OK nav icon · OK sidebar (width/glass/ink/border) · OK topbar
   (height/background/position/gap/padding) · badges teal 700 on both sides
nav item radius 6.96px == 6.96px   active item radius 6.96px == 6.96px
```

Everything held. The remaining `DIFF` lines are rect widths (different UI face,
see §6) and the deltas explained in the table above.

One caution for whoever re-runs this probe: on a cold load the poll fires before
`applyPrefs`, and the first table reads `density=null`, `--radius-base=10px` —
the CSS `:root` values, not the applied ones. That is trap 2 from §0 biting the
probe I wrote to avoid it. Call `run()` a second time.

## 8. One thing I could not reproduce

`_DESIGN-GAP.md` lists scrolling as "not working at all, not yet diagnosed". In
the probe, `.kv__content` scrolls correctly: `.kv` is `height:100vh; overflow:hidden`,
`.kv__main` is `min-height:0; overflow:hidden`, `.kv__content` is `flex:1;
overflow-y:auto`, and a 2000px child produced a scrolling content pane with the
sidebar and topbar fixed. Matches the reference's own chain. No new information —
but it is one more configuration where it does work, so the repro is elsewhere.
