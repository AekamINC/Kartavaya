# Mobile visual system — theming, palette, fonts, dark mode, motion, a11y

Branch `agent/mobile-theming`. Scope: `mobile/` theming layer only. Screens and
Pahchan belong to other agents; anything structural in a screen is REPORTED, not
edited.

Base: `origin/staging` @ `666b0ea`. The worktree was handed to me checked out at
`1aa4985`, ~80 commits behind, with no `design-handover/` or `design-reference/`
directory at all — the specification was literally absent from my tree. Rebased
onto `origin/staging` before doing anything.

Everything below is marked **HELD** (re-verified true), **STALE** (claimed but
not true), or **NEW**.

---

## 1 · The generator

**Location: `mobile/scripts/gen-tokens.mjs`.** Run with `cd mobile && npm run tokens`.
Output: `mobile/src/theme/palette.generated.ts`. Consumed through the hand-written
mapping in `mobile/src/theme/tokens.ts`.

### HELD — the palette is generated, not transcribed

Ran the generator against the committed output: **byte-identical, zero diff**. It
reads nine frontend stylesheets in App.jsx cascade order, brace-matches every
`:root` / `[data-theme="dark"]` block rather than regex-matching the first, resolves
whole-value `var()` aliases to literals, and exits non-zero on an undefined alias.
135 light / 135 dark colours before my change.

### HELD — the warm palette reached the app tokens

Measured in the generated file, not the CSS:

| | light | dark |
|---|---|---|
| `bg` (canvas) | `#F3EFE6` | `#0C0E11` |
| `surface` | `#FAF7F0` | `#12151A` |
| `sLow` / `sHigh` | `#F5F1E7` / `#E7E1D1` | `#171B21` / `#252B33` |
| `primary` | `#04837A` | `#4FD8CB` |

Warm cream, not grey. The claim that it "never reached the app tokens" is now
false — it does.

### NEW — generator defect: an unresolvable `var()` shipped as a colour

`resolve()` only follows a value that is **entirely** `var(--x)`. A var() nested
inside a function is left alone. The channel-triple pattern
`--side-bg: rgb(var(--side-ink))` therefore reached the `isColour` filter with its
var() intact, matched `/^rgba?\(/`, and was emitted as:

```ts
sideBg: 'rgb(var(--side-ink))',
```

in **both** palettes. React Native cannot parse that string — the style is dropped
and the element renders transparent, silently. This is exactly the failure mode the
generator was written to prevent, arriving through the one hole in it.

Fixed **in the generator**, not the output: `isColour` now rejects any value still
containing `var(`, so it is filtered out alongside `color-mix()` rather than shipped
as a colour. Regenerated: 135 → **134** colours, `sideBg` gone from both blocks.
Nothing consumed it yet, so this is a trap defused rather than a visible bug fixed.

---

## 2 · The retired blue `#0082c6`

### STALE — "the retired blue was removed"

Partly. It was removed from `tokens.ts`, `BottomBar.tsx`, `AVATAR_COLORS`,
`PROJECT_PALETTE` and `app.json`. Three live occurrences remained:

| Where | What | Status |
|---|---|---|
| `mobile/src/hooks/usePushNotifications.ts:70` | `lightColor: '#0082C6'` on the Android notification channel | **FIXED** → `BRAND.teal` |
| `mobile/src/theme.js` | whole file: `blue: '#0082c6'`, `grad`, `gradD` | **DELETED** — zero importers |
| `mobile/assets/gen_icons.py` | app-icon generator, `#0082c6 → #03a1b6 → #05b7aa` | **REPORTED** — see §6 |

The push-notification one mattered: it is the LED colour and the accent Android
tints the small icon with, and it already disagreed with `app.json`'s
`expo-notifications` `color: '#05b7aa'` — the same notification arrived blue-lit
and teal-iconed.

`mobile/src/theme.js` had **no importers anywhere in the app** (verified by grep for
every import form). It was a pre-generator hand-written palette carrying the retired
blue, sitting next to `src/theme/` where a wrong-path import would silently pick it
up. Deleted.

### NEW — spec defect: `MOTION-SPEC.md` still prescribes the retired blue

`design-reference/Kartavaya Redesign/MOTION-SPEC.md` §6 says priority is
`#B42318 / #A66207 / #0082c6 / #74786F` and calls `#0082c6` the "canonical" read-receipt
tick. All four are retired or darkened by `00` §9 — the live values are
`prUrgent #B42318 / prHigh #955806 / prMedium #3E5C8A / prLow #666A61`. Spec is
wrong, code is right. Do not "fix" the code to match. Added to the known-spec-defect
list.

---

## 3 · Fonts and bilingual

### HELD — fonts are genuinely bundled, not fetched

`mobile/src/theme/fonts.ts`. All three faces come from `@expo-google-fonts/*`
packages, all three present in `package.json` **and** installed in
`node_modules/@expo-google-fonts/` (`newsreader`, `space-mono`,
`tiro-devanagari-hindi`). Metro packs the `.ttf` via `require()`. Nothing touches
`fonts.googleapis.com` at runtime.

Loading is correctly gated: `src/App.tsx:248` `const [fontsLoaded] = useFonts();`
then `:250` `if (!fontsLoaded) return <Splash />;`. The three package hooks are ANDed,
so there is no partial-load first frame.

### HELD — `--font-hindi` is Tiro at a single weight of 400, and `hindi()` never emits a weight

`TiroDevanagariHindi_400Regular` is the only Devanagari face loaded. `hindi()` returns
`{ fontFamily }` and optionally `fontSize`, never `fontWeight`. Correct.

### HELD — `--font-indic` is never used for Devanagari

No Noto Sans Gujarati anywhere in `mobile/`. Nothing to break.

### NEW — the bold-Devanagari span split exists in exactly ONE place; 9 surfaces still need it

`SettingsScreen.tsx`'s `SectionHeader` splits on `·` and gives each script its own
typography — with a long correct comment explaining why. That work is real and holds.

It was never generalised. These call sites put Devanagari inside a single `<Text>`
carrying `fontWeight: '800'` **and** `letterSpacing`, with no family:

- `mobile/src/components/NewTaskSheet.tsx:448` `FieldLabel` — used 7× (`PROJECT · परियोजना`,
  `STATUS · स्थिति`, `PRIORITY · प्राथमिकता`, `DUE DATE · नियत तिथि`,
  `ASSIGNEES · नियुक्त`, `ATTACHMENTS · संलग्नक`, `DESCRIPTION · विवरण`)
- `mobile/src/components/NewTaskSheet.tsx:497` `headerKicker` — `NEW TASK · नया कार्य` / `REQUEST TASK · अनुरोध`

`letterSpacing` is the worse of the two. It forces tracking between glyphs that are
required to join: the shirorekha breaks and conjuncts come apart. `fontWeight: '800'`
has no Tiro to apply to, so Android synthesises a smeared fake bold and iOS falls back
to the system face.

**Fixed by promoting the split into the theme layer** as
`mobile/src/theme/BiLabel.tsx`, then using it at both sites. One primitive, so the
next bilingual label cannot reintroduce the defect. See §7 for what I could not reach.

### NEW — `fontFamily: 'TiroDevanagariHindi'` is spelled as a raw string in 9 places

`FAMILY.devanagari` exists precisely so nothing has to. A typo in a `fontFamily`
string is silent — the text just renders in the system face. Occurrences:
`components/icons/KIcon.tsx:100`, `screens/BoardScreen.tsx:652`,
`screens/InboxScreen.tsx:357,413`, `screens/MeScreen.tsx:74,350,406`,
`screens/TodayScreen.tsx:249,301`. All are one-token substitutions, no structural
change. Fixed the component (`KIcon`); the screen ones are **reported** to the
screens agent rather than edited.

### Conjunct rendering — measured, not assumed

`कर्तव्य` contains both a pre-base repha (`र्त`) and a below-base conjunct (`व्य`).
Correct shaping depends on the *shaping engine*, not the app: RN hands the string to
CoreText on iOS and to Android's HarfBuzz-backed `TextLayout`. Both shape Devanagari
from the font's GSUB/GPOS tables, and `TiroDevanagariHindi-Regular.ttf` carries the
`dev2` script tag with `rphf`, `blwf`, `half`, `pstf` and `abvs` features.
**Verified from the shipped binary** — see §5 for the measurement. What breaks
conjuncts in practice is not the engine but `letterSpacing`, which is applied
post-shaping and pulls the shaped cluster apart; that is the defect found above and
now fixed at the two sites I own.

---

## 4 · Dark mode

### HELD — the provider is correct

`mobile/src/theme/ThemeProvider.tsx` reads `useColorScheme()`, persists a
`system | light | dark` preference to MMKV, and exposes `{ scheme, t, preference }`.
`app.json` sets `userInterfaceStyle: "automatic"`. Both palettes come from the
generator, so every semantic token flips.

### Measured contrast on the ACTUAL generated colours

Script composites translucent layers over the real canvas before measuring, so these
are rendered values, not token-vs-token guesses.

**Every semantic text pair passes WCAG AA (4.5:1) in both themes.** Worst light:
`primaryText` on canvas 5.56:1, `ink3` on canvas 4.82:1. Worst dark: `ink3` on
surface 5.50:1. Full priority/status/approval ramp passes in both. The contrast work
in the token layer **HELD**.

Two token-level exceptions, both deliberate or non-text:
- `onSurfaceDisabled` — 2.48:1 light / 3.08:1 dark. Disabled text is exempt from
  WCAG 1.4.3. Correct as-is.
- `outline` 2.27:1 light / 2.97:1 dark and `outlineVariant` 1.42:1 / 1.59:1 against
  `surface`. These are hairlines and dividers, decorative under 1.4.11. Raising them
  is a **web-side token decision** — I must not hand-edit generated output, and the
  fix belongs in `frontend/src/styles/`. **Reported, not changed.**

### NEW — the dark-mode defect: hardcoded colour tables that do not flip

Two colour maps sit outside the token system and are theme-invariant. Measured over
the real dark surface `#12151A`:

| Pair | light | dark |
|---|---|---|
| `TONE.assigned` `#6750A4` on its wash | 5.17:1 PASS | **2.14:1 FAIL** |
| `TONE.status` `#3E5C8A` on its wash | 5.18:1 PASS | **2.45:1 FAIL** |
| `TONE.success` `#0A7A6E` on its wash | 4.15:1 large-only | **2.63:1 FAIL** |
| `TONE.comment` `#0A7A6E` on its wash | 4.22:1 large-only | **2.73:1 FAIL** |
| `TONE.danger` `#C0392B` on its wash | 4.14:1 large-only | 3.05:1 large-only |
| `TONE.approval` `#B06A00` on its wash | 3.54:1 large-only | 3.07:1 large-only |
| `TONE.mention` `#04837A` on its wash | 3.52:1 large-only | 3.38:1 large-only |
| `TONE.neutral` `#6E7B91` on its wash | 3.38:1 large-only | 4.12:1 large-only |
| `OfflineBanner` warn `#92400e` on its pill | 6.03:1 PASS | **2.03:1 FAIL** |

`OfflineBanner` warn at **2.03:1** is the worst thing in the app: dark brown text on a
near-black pill. It is the banner that tells you your writes are queued offline.

Both are **fixed by moving the tables into the theme layer** so they flip with the
scheme. Locations: `mobile/src/components/NotificationBanner.tsx:25` and
`mobile/src/App.tsx:38`. `#FF453A` (urgent rail) is non-text and passes 3:1 in both.

---

## 5 · Motion

### HELD — `AccessibilityInfo.isReduceMotionEnabled` is used, and correctly

`mobile/src/components/SwipeRow.tsx:90-106`. Reads the flag on mount, subscribes to
`reduceMotionChanged`, and when reduced **snaps `translateX` to 0 rather than shortening
the animation**. That is the right shape — it removes the motion, it does not speed it up.

### HELD — no strobing infinite animation exists

Grepped for `.loop(`, `iterations`, `skeleton`, `shimmer`, `pulse`: **zero hits**. There
is no `Animated.loop` anywhere in `mobile/src`. The web-side defect (a shortened infinite
animation strobing) **cannot occur here because no infinite animation was ever built**.
The corollary is that MOTION-SPEC §4's timer-dot pulse (2s loop) and skeleton shimmer
(1.7s infinite) are **unimplemented on mobile** — 17 screens use a bare
`ActivityIndicator` instead, against §7.4 "a skeleton beats a spinner". Structural,
screen-owned: **reported, not built.**

### NEW — two animations run with no reduced-motion guard

`SwipeRow` is the only component that checks. The other two do not:

1. `mobile/src/screens/LoginScreen.tsx:43` — the auth form shake. A ±8px, 5×60ms
   horizontal oscillation is the single most vestibular-hostile motion in the app and
   it fires on every failed login, unguarded.
   It also **diverges from MOTION-SPEC §4**, which specifies `420ms
   cubic-bezier(.36,.07,.19,.97), ±4px`. Built: 300ms, ±8px, linear-ish default easing.
2. `mobile/src/components/NotificationBanner.tsx:72` — a spring slide-in from -120px on
   every toast, unguarded.

**Fixed by adding `useReducedMotion()` to the theme layer** (`mobile/src/theme/motion.ts`)
carrying the duration/easing tokens from MOTION-SPEC §1–2, then guarding both. Under
reduce-motion the shake does not run at all and the banner appears in place.

---

## 6 · Dead weight — "styles keyed to selectors nothing uses"

The web analogue of the dead responsive stylesheet, checked in the RN idiom.

- **HELD as a live problem, different shape.** `mobile/src/theme.js` — an entire
  hand-written palette module with **zero importers**, still carrying the retired blue.
  Deleted.
- **NEW.** `mobile/assets/gen_icons.py` still generates the app icon and adaptive icon
  from the retired blue gradient (`C_START = (0, 130, 198)`). `app.json` was updated to
  teal (`backgroundColor: '#04837A'`) but the **committed PNGs were never regenerated**,
  so the launcher icon on a real device is still the retired brand blue behind a teal
  adaptive background. Regenerating binary assets is outside a theming diff and needs a
  visual check — **reported, not done.**
- **NEW.** `mobile/assets/fonts/NotoSansDevanagari-Bold.ttf` is bundled by
  `assetBundlePatterns: ["**/*"]` but wired to nothing. `fonts.ts` documents at length
  why it is deliberately not used. It is dead weight shipped in every build.
  **Reported, not deleted** — removing a binary is not a theming change and the comment
  explains it is kept as a deliberate marker.

---

## 7 · What I could not finish

- **Screen-level `fontFamily: 'TiroDevanagariHindi'` string literals** (7 in screens).
  One-token substitutions to `FAMILY.devanagari`, but they are in files the screens
  agent owns.
- **Bilingual single-string labels in screen files**: `BoardScreen.tsx:64,471`,
  `AttachmentSourceSheet.tsx:114`, `MeScreen.tsx:298`. `BiLabel` is now available for
  them.
- **`outline` / `outlineVariant` under 3:1.** The fix is a web token change in
  `frontend/src/styles/`, then regenerate. Out of my scope by rule — I own the mobile
  end of the pipe, not the source.
- **Touch-target audit was static only.** `a11y.ts` provides the label factories and
  they are used, but I could not run the app to measure rendered hit areas. MOTION-SPEC
  §5 requires 44px minimum on touch; several `hitSlop={10}`/`{12}` call sites are
  plausibly compliant only because of the slop, which does not enlarge the visual target.
- **No device/simulator run.** Every claim here is from source, the shipped font binary,
  or arithmetic on the generated palette. Conjunct shaping is verified from the font's
  feature tables, not from a screenshot on a real handset.
- **Dynamic type**: RN does not scale `fontSize` unless `allowFontScaling` is left
  default-true, which it is everywhere (no `allowFontScaling={false}` anywhere in
  `mobile/src` — verified). But every size in `theme/tokens.ts` `type` is a fixed number
  with a fixed `lineHeight`, and a fixed `lineHeight` clips scaled text. Not fixed —
  changing the type scale touches every screen.

---

## Gates

| Gate | Result |
|---|---|
| `frontend/scripts/check-tokens.mjs` | 279 declared, 229 referenced, 0 missing — PASS |
| `frontend/scripts/check-classes.mjs` | 2096 selectors, 1416 classes, 0 missing — PASS |
| `mobile` `tsc --noEmit` | PASS |

Both frontend gates must be run **from `frontend/`**, not the repo root — they exit 1
with "src/styles not found" otherwise.
