# Mobile visual system — theming, palette, fonts, dark mode, motion, a11y

Branch `agent/mobile-theming-r2`. Scope: the `mobile/` theming layer. Screens and
Pahchan belong to other agents; structural changes in a screen are REPORTED, not made.

Every claim below is **HELD** (re-verified true), **STALE** (handed down but not
true), **NEW**, or **CORRECTED** (something I claimed earlier in this run that turned
out to be wrong).

Nothing here was measured on a device. Everything is from source, from the shipped
font and PNG binaries, or from arithmetic on the generated palette. Where that limit
matters I say so.

---

## 0 · Two process notes

**My worktree was 80 commits stale and had no specification in it.** It was checked out
at `1aa4985`, and `design-handover/` and `design-reference/` did not exist in the tree
at all. Rebased onto `origin/staging` before starting. Per `_COORDINATION.md` §1 this
hit many agents — **if a spec file in your brief "does not exist", check your base
commit before concluding the claim is stale.**

**The remote branch could not be fast-forwarded after the rescue.** The rescue commit
was pushed to `agent/mobile-theming`; I then rebased onto current staging, rewriting
those hashes. Rather than force-push I pushed the rebased history to
**`agent/mobile-theming-r2`**. `agent/mobile-theming` is the stale pre-rebase ref and
should be deleted, not merged.

---

## 1 · The generator

**Location: `mobile/scripts/gen-tokens.mjs`** (`cd mobile && npm run tokens`). Output
`mobile/src/theme/palette.generated.ts`, consumed through the hand-written mapping in
`mobile/src/theme/tokens.ts`.

### HELD — the palette is generated, not transcribed, and is currently in sync

Ran the generator against the committed output: **zero diff**, both before and after
rebasing across 59 commits of staging. In that window `check-tokens` went from 279
declared tokens to 339 and the mobile palette did not move — the mapped tokens
genuinely did not change. That is the strongest evidence available that the pipe works.

It reads nine stylesheets in `App.jsx` cascade order, brace-matches every `:root` /
`[data-theme="dark"]` block rather than regex-matching the first, resolves whole-value
`var()` aliases, and exits non-zero on an undefined alias.

### HELD — the warm palette reached the app tokens

From the generated file, not the CSS:

| | light | dark |
|---|---|---|
| `bg` | `#F3EFE6` | `#0C0E11` |
| `surface` | `#FAF7F0` | `#12151A` |
| `sLow` / `sHigh` | `#F5F1E7` / `#E7E1D1` | `#171B21` / `#252B33` |
| `primary` | `#04837A` | `#4FD8CB` |

Warm cream, not grey. **The handed-down claim that the warm palette never reached the
app tokens is STALE.**

### NEW — generator defect: an unresolvable `var()` shipped as a colour

`resolve()` only follows a value that is **entirely** `var(--x)`. A var() nested in a
function was left alone, so the channel-triple pattern `--side-bg: rgb(var(--side-ink))`
reached the `isColour` filter with its var() intact, matched `/^rgba?\(/`, and was
emitted in both palettes as:

```ts
sideBg: 'rgb(var(--side-ink))',
```

React Native cannot parse that — the style is dropped and the element renders
transparent, silently. Fixed **in the generator**: `isColour` now rejects any value
still containing `var(`. 135 → 134 colours. Nothing consumed it yet, so this is a trap
defused rather than a visible bug fixed.

### NEW — the generator now catches `app.json` drifting from the palette

This is the splash seam, fixed at the source.

**Where the native side reads its colours from: `mobile/app.json`.** Three brand
colours are consumed by the native build before any JavaScript runs, so they cannot
come from `palette.generated.ts`:

| Field | Consumer | Must equal |
|---|---|---|
| `expo.splash.backgroundColor` | OS launch screen, compiled into the bundle | `darkPalette.bg` |
| `expo.android.adaptiveIcon.backgroundColor` | launcher icon plate | `lightPalette.primary` |
| `expo.plugins['expo-notifications'].color` | Android notification small-icon tint | `lightPalette.primaryVivid` |

`app.json` is configuration, not a stylesheet: plain JSON, no imports, no aliases,
consumed by `expo prebuild`. It is a genuine second source of truth for colours that
also exist in the first one — exactly what a generated palette is supposed to remove.

**It had already drifted.** `App.tsx`'s JS splash carried `backgroundColor: '#020d1a'`,
a navy from the retired-blue era, while `app.json`'s native splash said `#0C0E11`.
Every cold launch showed the native splash in one dark blue, swapped to the JS splash
in a different one, then swapped again to the real canvas — two visible flashes before
the first screen, and nothing in the repo could notice.

Fixed both ends. `App.tsx`'s splash now pins to `tokens.dark.bg` (which *is* `#0C0E11`),
and the generator asserts all three fields and **exits 1** naming the token. It does
not rewrite `app.json` — rewriting native build config as a side effect of a palette
refresh is more dangerous than the drift it prevents. **Verified the assertion fires**:
reintroducing `#020d1a` exits 1 with the correct message. All three currently agree.

---

## 2 · The retired blue `#0082c6`

### STALE — "the retired blue was removed"

Partly. Gone from `tokens.ts`, `BottomBar.tsx`, `AVATAR_COLORS`, `PROJECT_PALETTE` and
`app.json`. Three live occurrences remained:

| Where | What | Status |
|---|---|---|
| `mobile/src/hooks/usePushNotifications.ts:70` | `lightColor: '#0082C6'` on the Android notification channel | **FIXED** → `BRAND.teal` |
| `mobile/src/theme.js` | whole file: `blue`, `grad`, `gradD` | **DELETED** |
| `mobile/assets/gen_icons.py` | app-icon generator constants | **FIXED** (constants; PNGs not regenerated — below) |

Every `#0082c6` now left in `mobile/src/` is inside a comment explaining its removal.

The push-notification one mattered: it is the LED colour and the accent Android tints
the small icon with, and it already disagreed with `app.json`'s `expo-notifications`
`color: '#05b7aa'` — the same notification arrived blue-lit and teal-iconed.

`mobile/src/theme.js` had **zero importers**, verified against every import form
*including the babel `@` alias*, which resolves `@/theme` to the FILE before the
directory (`extensions: ['.ts','.tsx','.js',…]`, `root: ['./src']`). A pre-generator
palette carrying the retired blue, sitting exactly where a wrong-path import would
silently pick it up. Deleted.

### NEW — the shipped iOS app icon is still the retired blue. Measured from the PNG.

Decoded `mobile/assets/icon.png` (1024×1024 RGB) and sampled it:

```
top-left     (2,2)       #2d98cf     ← the retired blue, lightened by the shine overlay
top-right    (1021,2)    #2fb1c3
bottom-left  (2,1021)    #17a8bc
bottom-right (1021,1021) #04b6aa     ← ≈ #05b7aa, the surviving teal
centre       (512,512)   #ffffff     ← the क mark
```

That is the old `#0082c6 → #03a1b6 → #05b7aa` ramp, intact, on the home screen. The
token layer, `app.json` and every in-app gradient moved to teal; the icon did not.

`adaptive-icon.png` is transparent at the corners with a white centre — foreground
only, with `app.json` supplying the teal plate. **Android is fine; iOS is not.**

`gen_icons.py`'s constants are now the live ramp (`#026B64 → #04837A → #05b7aa`), so
the next regeneration cannot reintroduce the blue. **The PNGs themselves are NOT
regenerated** — that needs PIL and a human looking at the output, and binary assets do
not belong in a theming diff. **This is the single most visible thing left open.**

### NEW — spec defect: `MOTION-SPEC.md` still prescribes the retired blue

§6 gives priority as `#B42318 / #A66207 / #0082c6 / #74786F` and calls `#0082c6` the
"canonical" read-receipt tick. All four are retired or darkened by `00` §9; the live
values are `prUrgent #B42318 / prHigh #955806 / prMedium #3E5C8A / prLow #666A61`.
**Spec is wrong, code is right — do not "fix" the code to match.**

---

## 3 · Fonts and bilingual

### HELD — fonts are genuinely bundled, and loading is correctly gated

All three faces come from `@expo-google-fonts/*`, present in `package.json` **and**
installed (`newsreader`, `space-mono`, `tiro-devanagari-hindi`). Metro packs the `.ttf`
via `require()`; nothing touches `fonts.googleapis.com` at runtime. `src/App.tsx:248`
gates render on `useFonts()` with the three hooks ANDed, so there is no partial-load
first frame.

### HELD — Tiro is a single weight of 400. Verified from the binary, not the docs.

Read `TiroDevanagariHindi_400Regular.ttf` directly: `OS/2.usWeightClass = 400`, and the
package ships one weight directory. `hindi()` returns `{ fontFamily }` and never a
`fontWeight`. Correct.

### HELD — Devanagari conjuncts will shape correctly. Measured from the font tables.

`कर्तव्य` needs a pre-base repha (`र्त`) and a below-base conjunct (`व्य`). Shaping is
done by CoreText on iOS and HarfBuzz on Android, both driven by the font's OpenType
tables. From the shipped Tiro binary:

```
GSUB scripts  = [dev2 latn]
GSUB features = [abvs akhn blwf blws c2sc calt case ccmp cjct dnom frac half liga
                 lnum locl nukt numr pres psts rkrf rphf smcp ss02 ss03 ss04 ss05 sups]
GPOS scripts  = [dev2 latn]
GPOS features = [abvm blwm dist kern]
```

`dev2` present, and the full Indic set — `rphf` (repha), `blwf` (below-base), `half`,
`cjct`, `rkrf`, `akhn`, `pres`, `psts`, `nukt`. cmap covers every required codepoint
including U+094D VIRAMA, ZWJ and ZWNJ. **Gujarati U+0A95 is ABSENT**, confirming the
file is Devanagari-only and independently confirming the `--font-indic` rule.

What actually breaks conjuncts is not the engine but **`letterSpacing`**, applied
post-shaping — see below.

### HELD — `--font-indic` is never used for Devanagari

No Noto Sans Gujarati anywhere in `mobile/`. Nothing to break.

### HELD — Newsreader has zero Devanagari coverage

Verified from the binary: `GSUB scripts = [DFLT latn]`, every Devanagari probe
codepoint ABSENT. The rule in `fonts.ts` is correct and load-bearing.

### NEW — the span split existed in ONE place; nine surfaces still had the defect

`SettingsScreen`'s `SectionHeader` split on `·` correctly, with a good comment, and was
never generalised. These put Devanagari inside a single `<Text>` carrying
`fontWeight: '800'` **and** `letterSpacing: 1.2`:

- `NewTaskSheet.tsx` `FieldLabel` — 7 labels (`PROJECT · परियोजना`, `STATUS · स्थिति`,
  `PRIORITY · प्राथमिकता`, `DUE DATE · नियत तिथि`, `ASSIGNEES · नियुक्त`,
  `ATTACHMENTS · संलग्नक`, `DESCRIPTION · विवरण`)
- `NewTaskSheet.tsx` `headerKicker` — `NEW TASK · नया कार्य` / `REQUEST TASK · अनुरोध`

`letterSpacing` is the damaging half and the easy one to miss: RN applies tracking
**after** shaping, inserting space between glyphs required to join. The shirorekha
breaks into disconnected segments and conjunct clusters come apart — visible twice in
`कर्तव्य`. `fontWeight: '800'` is the other half: no bold Tiro exists, so Android
synthesises a smeared fake and iOS falls back to the system face.

**Fixed by promoting the split into the theme layer** as `mobile/src/theme/BiLabel.tsx`
and using it at both sites. It neutralises `letterSpacing` and `fontWeight` on the
Devanagari run *after* any caller style, so spreading a kicker style into it out of
habit still produces a correct label.

### NEW — two system typefaces where the brand face was already bundled

`NewTaskSheet.tsx` styled its sheet header and title input with
`fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif'`. Android's generic `serif` is
Noto Serif, a different design from Georgia — so the same sheet looked like two
different products on the two platforms, and neither was Newsreader, which is bundled
and loaded at the root. Both now use `display(400)`.

### NEW — `fontFamily: 'TiroDevanagariHindi'` spelled as a raw string in 9 places

`FAMILY.devanagari` exists so nothing has to; a typo is silent and renders the system
face. Fixed the one in my layer — `components/icons/KIcon.tsx:100`, which is the
**brand mark**, where the failure mode is the logo quietly becoming whatever Devanagari
face the OS ships. The other 8 are in screen files, listed in §8.

### CORRECTED — `NotoSansDevanagari-Bold.ttf` is NOT unused

I claimed earlier in this run that `mobile/assets/fonts/NotoSansDevanagari-Bold.ttf`
was "wired to nothing". **Wrong.** `gen_icons.py:19` uses it as `FONT_PATH` to draw the
क in the app icon. `fonts.ts`'s comment concerns the *runtime* app, where it is indeed
not registered, and that part is accurate — but the file is not dead and must not
simply be deleted. It is still bundled into every build by
`assetBundlePatterns: ["**/*"]` despite never being loaded at runtime, which is worth
a look on its own.

---

## 4 · Dark mode

### HELD — the provider is correct

`ThemeProvider.tsx` reads `useColorScheme()`, persists a `system | light | dark`
preference to MMKV, exposes `{ scheme, t, preference }`. `app.json` sets
`userInterfaceStyle: "automatic"`. Both palettes come from the generator.

### Measured contrast on the ACTUAL generated colours

Translucent layers composited over the real canvas before measuring, so these are
rendered values, not token-vs-token guesses.

**Every semantic text pair passes WCAG AA (4.5:1) in both themes.** Worst light: `ink3`
on canvas 4.82:1, `primaryText` on canvas 5.56:1. Worst dark: `ink3` on surface 5.50:1.
The full priority / status / approval ramp passes in both. **The token-layer contrast
work HELD.**

Two exceptions, both correct as-is:
- `onSurfaceDisabled` 2.48:1 light / 3.08:1 dark — disabled text is exempt from 1.4.3.
- `outline` 2.27:1 / 2.97:1 and `outlineVariant` 1.42:1 / 1.59:1 against `surface` —
  hairlines and dividers, decorative under 1.4.11. Raising them is a **web-side token
  decision**; I must not hand-edit generated output. **Reported, not changed.**

One caveat on `primary`: at 4.33:1 on the light surface it is below body AA. That is
correct and intended — `tokens.ts` documents it as a **fill**, with `primaryText`
(5.96:1) as the text colour. Worth knowing before anyone "simplifies" the two into one.

### NEW — the real dark-mode defect: colour tables that do not flip

Two hardcoded tables sat outside the token system. Measured over the real dark surface:

**`NotificationBanner`'s tone map** — eight hexes with washes tuned for cream. These
are ICON colours, so the bar is 1.4.11's **3:1**, not 4.5:1:

| tone | light | dark |
|---|---|---|
| `assigned` | 5.17:1 | **2.14:1 FAIL** |
| `comment` | 4.22:1 | **2.73:1 FAIL** |
| `status` | 5.18:1 | **2.45:1 FAIL** |
| `success` | 4.15:1 | **2.63:1 FAIL** |
| `danger` / `approval` / `mention` | 3.5–4.1:1 | 3.05 / 3.07 / 3.38:1 marginal |

Four below the floor in dark, all seven fine in light — the signature of a table that
does not flip.

**`App.tsx`'s `OfflineBanner`** — warn text `#92400e` on a 14%-orange pill measured
**2.03:1 in dark**. Dark brown on near-black. It is the banner that tells you your
writes are queued offline.

Both fixed:
- `mobile/src/theme/tones.ts` — one tone map, adopting the values `InboxScreen` and
  `MeScreen` already used correctly. That map was written **three times**; it is now
  written once. Every pair clears 3:1 in both themes, worst case 4.07:1.
- `OfflineBanner` now uses the container pairs, which exist for exactly this:
  error 6.57 / 7.40, warn 10.10 / 9.49, info 13.63 / 7.01. Borders derive from the same
  token via `withAlpha` instead of restating light-mode channel values.

Also replaced the hardcoded iOS system red `#FF453A` urgent rail with `t.error`
(MOTION-SPEC §6 gives urgent to `--danger`).

### NEW — hue mismatch worth a decision, not a unilateral fix

`tokens.ts` maps `purpleContainer: p.tertiaryContainer`. Tertiary is the **peach** ramp,
so the `assigned` badge is a violet icon on a peach plate — 4.48:1 light, 4.07:1 dark,
legible and over the icon floor, but nobody chose it. There is no purple container
token on the web side to point at. **Reported rather than invented**: making one up in
the mobile layer is the drift `tones.ts` exists to end.

---

## 5 · Motion

### HELD — `AccessibilityInfo.isReduceMotionEnabled` is used, and used correctly

`SwipeRow.tsx:90-106` reads the flag, subscribes to `reduceMotionChanged`, and when
reduced **snaps `translateX` to 0 rather than shortening**. That is the right shape.

### HELD — no strobing infinite animation exists on mobile

Grepped `.loop(`, `iterations`, `skeleton`, `shimmer`, `pulse`: **zero hits**. No
`Animated.loop` anywhere in `mobile/src`. The web-side defect measured at 2.000ms,
1.5ms and 0.8ms (~1250Hz) **cannot occur here, because no infinite animation was ever
built.** The corollary: MOTION-SPEC §4's timer-dot pulse and skeleton shimmer are
unimplemented, and 17 screens use a bare `ActivityIndicator` against §7.4's "a skeleton
beats a spinner". Structural and screen-owned — **reported, not built.**

### NEW — the motion layer, mirroring the BUILD's split rather than the spec's

`mobile/src/theme/motion.ts` carries MOTION-SPEC §1's five durations, §2's easings as
`Easing.bezier` transcriptions, and the reduced-motion signal as a hook.

It deliberately mirrors `frontend/src/styles/animations.css`'s **two scalars**, not the
reference's one:
- `duration()` is the `--ix` half, bottoming at **0**
- `amplitude()` is the `--motion-scale` half, bottoming at **0**

Collapsing only duration gives a 0ms teleport across the full distance; collapsing only
distance gives a slow fade in place. Both together give the thing that appears where it
belongs, immediately.

`shouldLoop()` is a separate call **so that a caller cannot express "loop, but
shortened" without writing the phrase out.** Per `_COORDINATION.md` §7 the spec
*mandates* that bug — `16-animations.md:44` gives
`animation: dmSpin calc(.7s * var(--ix)) linear infinite` as its worked example and
`motion.css:117` implements it, i.e. a 0.7ms spinner. **Not ported.**

Two divergences from the web, because RN is not CSS, both documented in the file:
`duration()` returns exact `0` rather than `ms * .001` (RN's `Animated.timing` with
`duration: 0` is unambiguous where CSS `0s` is not — and `tokens.css:241` and two other
spec files already disagree about it); and a repeating animation is **not started**
rather than run inert, because RN would burn a native-driver animation forever to
render an unchanging frame.

### NEW — two animations ran with no reduced-motion guard, one of them off-spec

1. **`LoginScreen.tsx:43`, the auth form shake.** A ±8px horizontal oscillation is the
   most vestibular-hostile motion in the app, it fires on every failed login — i.e.
   repeatedly, at someone already struggling — and it was unguarded. It was also
   **off-spec in both dimensions**: 5 × 60ms = 300ms at ±8px, against MOTION-SPEC §4's
   `420ms cubic-bezier(.36,.07,.19,.97)` at ±4px. 40% too fast at twice the throw,
   which is why it read as a judder rather than a nudge.
   Now spec-accurate, and skipped entirely under reduced motion — the error text and
   red border still report the failure, so nothing goes unreported.
2. **`NotificationBanner.tsx:72`** — a spring slide-in from −120px on every toast,
   unguarded. Now appears in place under reduced motion. The 5-second progress rail is
   deliberately **kept**: it is information (how long until auto-dismiss), not
   decoration, and it has no translation, scale or repetition.

---

## 6 · Dead weight, and a claim that did not survive checking

- **`mobile/src/theme.js`** — an entire hand-written palette module, zero importers,
  carrying the retired blue. Deleted. This is the RN analogue of the dead responsive
  stylesheet, and it was live.
- **CORRECTED**: I earlier called `NotoSansDevanagari-Bold.ttf` unused. It is not —
  see §3.
- **`cols` / `columns` prop typo** (flagged by a sibling as a live crash at
  `DristiPage.jsx:577`): **does not exist in mobile, and structurally cannot.** Both
  call sites (`BoardScreen.tsx:601`, `TaskDetailScreen.tsx:830`) pass `columns={columns}`
  and both consumers declare `columns`. The mobile app is TypeScript; a misspelled prop
  is a compile error, not a runtime crash. That is the whole difference from the JSX
  frontend.

---

## 7 · Accessibility

### Touch targets — measured, and the smallest one contradicts the spec in the same sentence

MOTION-SPEC §5 asks for `Row height 44px minimum` and, for the smallest control,
`Checkbox / tick | 20–22px, 44px hit area`.

Static audit of every `Touchable*` / `Pressable` with a resolvable size found **29 under
44px**. Hand-verified the extremes rather than trusting the heuristic:

| Site | Declared | hitSlop | Effective |
|---|---|---|---|
| `screens/taskdetail/styles.ts:37` `checkbox` (subtask tick) | `20 × 20` | none | **20px** |
| `styles.ts:41` `addSubtaskBtn` | `34 × 34` | none | **34px** |
| `styles.ts:7` `backBtn` (SafeHeader) | `width: 28`, icon 24 | 8 | 44 wide / **40 tall** |
| `NotificationBanner` `closeBtn` | 14px icon + 4 padding = 22 | 10 | 42 → **FIXED to 44** |

The subtask checkbox is the clearest: it is **exactly** the visual size the spec asks
for and has **none** of the hit area the same line asks for.

Added `hitSlopTo(size)` to `mobile/src/components/a11y.ts` — returns the `hitSlop` that
grows a control to 44px, or `undefined` if it is already large enough. `hitSlop` and
not padding, because the spec asks for two different numbers at once (a 20px checkbox
that is 44px to the finger) and padding grows the drawn box too. Applied to the one
site in my layer. **The screen-level sites are a one-prop fix each**, listed in §8.

### Screen-reader labels

`a11y.ts`'s factories exist and are used. One gap found and fixed in my layer:
`NotificationBanner`'s dismiss button had no label — an unlabelled button on a toast
that auto-dismisses in five seconds. Now `a11yButton('Dismiss notification')`, with the
icon marked `accessibilityElementsHidden`.

### Dynamic type — verified, and the real limit is not what I first assumed

There is **no `allowFontScaling={false}` and no `maxFontSizeMultiplier` anywhere in
`mobile/src`** (grepped; zero hits). So RN's default applies and text *does* scale with
the OS setting. Good.

The limit is elsewhere: every entry in `tokens.ts`'s `type` scale pairs a fixed
`fontSize` with a fixed `lineHeight` (`base: { fontSize: 15, lineHeight: 22 }`, and so
on). **A fixed `lineHeight` clips scaled text** — the glyphs grow, the line box does
not. Not fixed: making `lineHeight` a ratio of `fontSize` changes the vertical rhythm of
every screen and needs a device to judge. **This is the largest open accessibility
item.**

---

## 8 · What I could not finish

- **Regenerating `icon.png`.** Constants fixed, PNG not. Needs PIL and a human eye. §2.
- **`lineHeight` as a ratio** for dynamic type. §7.
- **Screen-level `fontFamily: 'TiroDevanagariHindi'` literals** — 7 sites:
  `BoardScreen.tsx:652`, `InboxScreen.tsx:357,413`, `MeScreen.tsx:74,350,406`,
  `TodayScreen.tsx:249,301`. One-token substitutions to `FAMILY.devanagari`.
- **Bilingual single-string labels in screens**: `BoardScreen.tsx:64,471`,
  `AttachmentSourceSheet.tsx:114`, `MeScreen.tsx:298`. `BiLabel` is ready for them.
- **Screen-level touch targets** — the 29-site list above; `hitSlopTo` is ready.
- **`outline` / `outlineVariant` under 3:1** — a web token change, then regenerate.
- **`purpleContainer` hue mismatch** — needs a web-side token, or an owner decision.
- **No device or simulator run.** Conjunct shaping is verified from the font's feature
  tables and cmap, not from a screenshot on a handset. Contrast is arithmetic on the
  generated palette. Touch targets are static analysis with the extremes hand-checked.
  All three would benefit from one pass on real hardware.

---

## New theme-layer modules, for the next agent

| File | What it is for |
|---|---|
| `mobile/src/theme/motion.ts` | durations, easings, `useReducedMotion()`, `duration()`, `amplitude()`, `shouldLoop()` |
| `mobile/src/theme/BiLabel.tsx` | the `LATIN · देवनागरी` split; also exports `splitBilingual()` |
| `mobile/src/theme/tones.ts` | the notification tone map, once; `toneFor(t, kind)` |
| `mobile/src/components/a11y.ts` | now also `MIN_TOUCH` and `hitSlopTo(size)` |

---

## Gates

| Gate | Result |
|---|---|
| `cd frontend && node scripts/check-tokens.mjs` | 339 declared, 233 referenced, 0 missing — **PASS** |
| `cd frontend && node scripts/check-classes.mjs` | 2114 selectors, 1437 classes, 0 missing — **PASS** |
| `cd mobile && npx tsc --noEmit` | **PASS** |
| `cd mobile && node scripts/gen-tokens.mjs` | 134/134, app.json assertion passes — **PASS** |

Both frontend gates must be run **from `frontend/`**. Per `_COORDINATION.md` §2 a root
invocation is a loud `process.exit(1)`, not a silent pass — I hit that exit myself and
it behaved exactly as documented.

No lockfile touched.
