# Handover — mobile & tablet, 2026-08-07 (second session of the day)

Companion to `HANDOVER-2026-08-07.md`, which covers the tenancy/cron/demo work
from earlier the same day. This one covers **the tablet bundle** — `mobile/` and, since `ced748e3`, §8's web
half in `frontend/`. Everything below was measured in this session; where a thing
is unverified it says so, and that distinction is the most important thing in this
document.

---

## 1 · Where it stands

| | |
|---|---|
| Branch | `staging`, 20 commits ahead of `25a33b28` |
| Head | `d9a9a5e3` |
| Scope | 46 files |
| Stack | **expo ^54.0.36 · react-native 0.81.5 · react 19.1.0** |
| mobile `tsc --noEmit` | **exit 0** |
| mobile `npm test` | **406 passed, 0 failed** (was 326 with **5 failing** at session start) |
| frontend `npm run check` | **exit 0**, all seven checkers |
| frontend vitest | **1787 passed / 111 files, 0 failed** |
| `expo-doctor` | 18/18 |
| Bundles | Android and iOS both build, HTTP 200, ~10.5 MB |
| **Runtime** | **NOTHING ON MOBILE HAS BEEN RUN ON A DEVICE. See §5.** |

**§3 of the spec is complete on both platforms.** All six screens are converted
and the web half has landed. What is left is listed in §3 below and is smaller
than what has shipped.

The work was run as three gated stages at the owner's instruction — verify,
size, implement — and no stage began before the previous one was seen.

---

## 2 · What shipped, in order

**`3213cdbe` — Sanvaad and Sahayak follow the web to cream.** `ffe94285` deleted
`frontend/src/styles/surface-theme.css` on "scrap my slate approved"; mobile
never followed, so the phone rendered Slate while the web rendered cream and the
guard test had been failing against a missing file. Evidence it is right, not
taste: **zero occurrences of "slate" in the entire reference bundle**;
`sahayak.css` declares 0 colour literals; `messaging.css`'s shadow is
`rgba(28, 24, 16, .1)` — warm brown, mixed for a cream ground.
`sanvaadSurface.test.ts` §1 was **inverted, not deleted** — it used to *enforce*
Slate — and proven failing before the fix.

**`440a3c08` — the window ladder.** `lib/windowClass.ts` (pure, no React Native
import, so `node --test` can import it for real unit tests) + `hooks/useWindowClass.ts`.
Checked against §1's six-device table rather than its own operators.

**`caa15631` + `6da622cf` — one destination list.** `nav/destinations.ts` feeds
the bottom bar, the rail and the drawer. `MoreScreen` reads it.

**`6980c189` — `NavRail` and `NavDrawer`.**

**`4ca3b3e6` — the shell switches by window class.** `ShellFrame` wraps the
navigator; the bottom bar is suppressed with `tabBar={() => null}` above compact.

**`22afe54d` + `7815ea28` — SDK 51 → 54.** See §4.

**`bd99f808` — `PaneHost`** and the route/prop contract.

**`ebf46a26` — Tasks and Messages split.**

**`5fe4f897` — Inbox splits; Approvals gets its supporting pane.**

**`4c1cc339` — Today gets its second column.** The one screen §9's "no new
screen components" could not cover: mobile's Today is a SectionList of TASKS
only, so all three things §3 puts in the right column were absent. Built from
sources that already existed — the approvals query under ApprovalsScreen's own
key, `GET /api/activity/feed` (the web dashboard's source), and the single
`/live` poll joined onto the channel list.

**`739b9874` — the board stacks in portrait, runs full-height lanes in
landscape.** Keyed on leaving `compact` (600dp) rather than the 660dp split
floor, because §3.2 says "every tablet, not only the ones that split". The
phone's column tabs are dropped; the phone renderer is kept whole and renamed.

**`375566f4` — form sheet, card flow, auto-fill module grid, §5 assert.**
`Sheet` becomes centred and 520-capped above compact, reusing the `Dialog`
motion that already existed. `CardList` deliberately avoids `numColumns` —
SectionList does not support it, changing it on a mounted FlatList throws unless
`key` changes too (which would remount and lose scroll position, against §6),
and it would flow the headers §3 says must span full width.

**`ced748e3` — THE WEB HALF (§8).** See §4a.

---

**`f2d5b7d8` — the card flow reaches six screens.** `CardList` had been built,
unit tested and wired to nothing for a whole session; a component with no
consumers passes every test it has and changes nothing on screen. `ModuleCards`
now sits in `ModuleShell`, where `BODY_PAD` drives both the stylesheet and the
inset, so the six light-module surfaces flow their rows while `StatRow`,
`SectionHead`, the empty-state Card and the boundary note keep spanning the full
width. 8 of 10 new tests red first; the two green-before guards are
mutation-proven. At one column `CardList` returns its children untouched, so
every phone render is unchanged.


## 3 · What is NOT done

### Boards, Mentions and the client portal still stack one card per row
`CardList` is now wired — `f2d5b7d8` put it behind `ModuleCards` in `ModuleShell`
and the six light-module surfaces flow their rows two and three abreast. Tasks,
Messages and Inbox are split panes whose leaders are 280–400dp, so they are one
column by the rule, correctly.

What is left are the three `FlatList` screens. `CardList.tsx`'s own header sets
out why `numColumns` is the wrong answer there: changing it on a mounted list
throws unless the `key` changes too, which is the remount §6 exists to prevent.
Converting them to a ScrollView buys columns and sells virtualisation — a
decision about list length, not a wiring pass. Dristi is excluded on purpose and
a test says so; its only `.map` draws the bars of a trend chart.

### The mobile brand mark
Never existed on this platform, and it is not a regression. `react-native-svg` is
NOT installed; `assets/` holds only `icon.png`, `adaptive-icon.png` and
`splash.png`, all carrying the **old diamond**; `components/Lotus.tsx` is an
animated *loader* for Sahayak drawn from border-radius Views, not the mark; the
login screen renders a bare **क** in a gradient crown.

The web has it in three small files — `lib/brand.jsx` (175 lines, holds the
switch at 32), `brand/Lotus.jsx` (198), `brand/LotusK.jsx` (90) — using only
`<svg> <path> <g> <circle>`, with **क layered as a positioned `<span>` rather
than drawn in SVG**. So a port is: add `react-native-svg`, translate two
components, layer क as a `<Text>`. Roughly a session.

**Do it AFTER the app is confirmed to run.** It adds a native dependency, which
means another prebuild and another APK — compounding the one unknown that already
matters most.

### Runtime verification
Still the largest outstanding item. See §5.

## 4 · The SDK upgrade

`expo ~51.0.28 → ^54.0.36`, RN `0.74.5 → 0.81.5`, react `18.2.0 → 19.1.0`,
typescript `5.3.3 → ~5.9.2`, **react-native-mmkv `2.12 → 3.3.3`**.

**It was small because the cleanup came first.** Six dependencies had zero
references anywhere — `@shopify/flash-list`, `date-fns-tz`, `react-hook-form`,
`zustand`, `expo-av`, `expo-status-bar` — and two were the only hard blockers:
**expo-av is DELETED in SDK 54** and flash-list v1→v2 is breaking. Removing beat
migrating.

**mmkv v3 was not optional** — SDK 54 enables the New Architecture by default and
v2 does not support it. It is not Expo-managed, so `expo install --fix` does not
touch it; it would have failed at runtime, on a device, after everything else
looked fine.

**Four real breaks**, all caught by tsc or a test: `shouldShowAlert` splitting
into `shouldShowBanner`/`shouldShowList`; React 19 requiring an initial `useRef`
value; React 19's `useRef<T>(null)` returning `RefObject<T | null>` (widen the
consuming *prop*, do not narrow the ref); and `expo-constants` declaring
`NativeConstants`/`Constants` as **type aliases** rather than interfaces.

**A latent bug surfaced:** `expo.scheme` was `"Kartavaya"` while `nav/linking.ts`
builds `kartavaya://`. Case-insensitive per RFC 3986 so deep links worked, but
SDK 54's schema rejects a capital. Now lowercase and consistent.

---

## 4a · The web half (§8)

Landed in `ced748e3`. Owner's decision, 2026-08-07: **adopt the prototype's
burger overlay**.

**Finding 3 — no rail on the web.** `editorial.css`'s 768–1023 block and
`Sidebar`'s `useMediaQuery(TABLET_BAND)` are gone; the band falls through to the
`max-width: 1023px` rule that already hides the sidebar and shows burger + scrim.

**This overruled a deliberate, measured decision, and the replacement comment
says so.** The rail was added BECAUSE the previous behaviour — every destination
behind a hamburger on a 960px screen with nothing in the margin — had been
measured on a 10-inch landscape and judged wrong. Anyone reading only the old
comment will reasonably put it back. The counter-argument is §8's, and it is
about the whole product: the native app gets a rail, the site does not, because
"two navigations for one product on one device is how the burger came to open a
scrim over nothing".

The rail survives as a **preference** (`prefs.sidebar === 'rail'`). What went is
inferring it from the viewport. `TABLET_BAND` is now unconsumed and documented as
such rather than deleted — the band is real and is where the next tablet-specific
web rule will go.

**Finding 1 — `@media (pointer: coarse)`**, raising `.k-iconbtn`, `.tbl__sort`
and `.chip` to 44px. Deliberately NOT `(hover: none) and (pointer: coarse)`,
which this codebase uses in four other places and is correct there: that pair
asks about the PRIMARY pointer and keeps a Windows touch laptop at desktop
density. Wrong question here — an iPad with a Magic Keyboard reports a fine
pointer while the same hand still reaches past it to the glass.

**§9 web table** — the sticky first column moved from `(max-width: 767px)` to
`(max-width: 767px), (pointer: coarse)`. An iPad in landscape reports 1180 CSS px
and lands in the desktop branch, so a table dragged sideways under a thumb lost
its row labels.

### The check chain caught §8 being taken at its word

The first version used §8's own class list verbatim — `.icon-btn`, `.row__menu`,
`.tb__sort`, `.row__act`, `.chip`. **Those are the PROTOTYPE's names**, and three
of the five do not exist in this build. `check-orphan-selectors` failed with four
new orphans: "a selector nothing consumes is CSS that shipped without its page."
The real names are `.k-iconbtn` (the port of the reference's `.icobtn`) and
`.tbl__sort`.

Same habit this project keeps paying for. **Open the file.**

Note: `check-orphan-selectors` had also been reporting **7 stale baseline
entries** (`.k-mark`, `.sh__acts`, `.sh__fb`, `.sv`, `.sv--thread`,
`.sv__logwrap`, `.sv__pins`) that are no longer orphaned. These **pre-dated this
work** — verified present in the baseline run before any change — and were
cleared in `d9a9a5e3`. All seven had acquired real consumers, so the baseline was
holding exemptions for things that are not orphans; held 506 -> 499. The
remaining 499 are untouched and each is a real decision (wire it up or delete the
rule — and deleting needs the JSX converted first, or `check-classes` fails on
the way back).

---

## 5 · THE BIGGEST RISK — none of this has run

A green typecheck and 406 green tests prove it **compiles**. They do not prove:

1. **Whether MMKV v3 reads the v2 store.** If not, every user is silently signed
   out and queued offline writes are lost. This is the single highest-value
   thing to check first.
2. **Whether `@react-navigation` v6 behaves under React 19.** It is still v6 and
   npm now warns it is **deprecated** on every install. v7 is the supported line
   for RN 0.81. Deliberately not upgraded, to keep one variable at a time. **If
   navigation misbehaves, this is the first suspect.**
3. **Whether any of the tablet layout looks right.** The rail, the drawer, ALL
   SIX converted screens, Today's three brand-new data surfaces, the form sheet
   and the changed More grid have never been rendered.

The web changes are the exception: ordinary CSS, covered by a green seven-checker
chain and 1787 passing tests, and they need no device.

### Expo Go is NOT the way to check, and never was

`react-native-mmkv` is a third-party native module; Expo Go ships only Expo's
own. Its error says it directly
(`node_modules/react-native-mmkv/lib/commonjs/ModuleNotFoundError.js:45`):

> `react-native-mmkv is not supported in Expo Go! Use EAS (expo prebuild) or
> eject to a bare workflow instead.`

`src/lib/storage.ts:3` constructs `new MMKV()` at **module scope**, so it throws
during import, before React renders. **The symptom is "stuck at the logo"** —
the native splash stays up, no red screen, and Metro still logs a successful
bundle because bundling is not the thing that failed.

This was equally true at SDK 51. The upgrade did not unlock Expo Go and could
never have; `expo-dev-client` has been a dependency all along, which is what an
app that builds its own client looks like.

### A dev APK built successfully on this machine

`BUILD SUCCESSFUL in 16m 58s` — so the New Architecture compiles. Everything
needed is local: Android Studio's JBR at
`/c/Program Files/Android/Android Studio/jbr`, SDK at `$LOCALAPPDATA/Android/Sdk`
(`android-36`, build-tools 36.1). `ANDROID_HOME` and `JAVA_HOME` are **not** set
in the shell — export them, write `android/local.properties` with `sdk.dir`, then:

```
npx expo prebuild --clean --platform android
cd android && ./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` (~175 MB, all ABIs).

**The owner tried to install it and it did not work.** Left alone at their
instruction; not diagnosed. "Not working" could be a blocked install, an ABI
mismatch, or a real boot crash, and those are three different problems — worth
one round of diagnosis before assuming the worst.

---

## 6 · Traps and corrections — do not re-derive these

**The bundle is SIX files, not four.** `31-tablet.md` names four; the two it
omits — `TabletScreens.jsx` (18.5 KB) and `TabletBoard.jsx` — contain the actual
logic. Anyone sizing from the named four will underestimate.

**The .md and the prototype disagree three times, and the prototype wins.**
§2's prose gives the rail six fixed destinations; `Tablet.jsx:25` gives it
fifteen and fills to fit. §9's file table implies stacking is general;
`TabletScreens.jsx:274` gates it on Approvals alone. §9 promises "no new screen
components"; Today needed three.

**§2 deletes `More` at `large`, which makes the drawer's list load-bearing.**
On a phone More is the safety net for any destination without a tab. At 1200
that net is gone, so a destination missing from the drawer is a screen that has
**left the app** — silently. Hence one list and a test.

**Content width, never the width class.** `TabletScreens.jsx:132` records that
tying them together *was* the bug. An iPad Pro upright is `expanded` with 960dp
of content and must not stack.

**`Dimensions.get(` was already zero** across 136 files — the spec's own stated
primary risk did not exist here. Now a permanent test. Its first run failed on
`useWindowClass.ts`, whose header *warns against* the API, so it reads
comment-stripped source.

**Three auto-open rules, three reasons.** Tasks opens its first row (selecting
costs nothing); Messages opens none (opening marks read); Inbox opens none (its
first row is just the newest thing). The asymmetry is the design and is the
thing most likely to be "tidied" into consistency.

**`nav/platform.ts` exists because `RootStack` imports every screen** — a screen
importing `devicePlatform` back from it is a cycle, and Metro resolves cycles by
handing one side a partially initialised module, surfacing as
`undefined is not a function` somewhere unrelated at startup.

**`queryFn: messagesApi.channels` silently fetches the ARCHIVED set.**
react-query calls a bare queryFn with its own context object, which is truthy,
and the parameter is `archived`. Always wrap: `() => messagesApi.channels(false)`.

**`LivePayload.channels` is not the rail's list.** It includes public channels
the caller never joined and archived ones. Join onto the channel list; never
iterate its keys.

**The web tablet band FIGHTS the spec, and the build's comment argues back.**
`editorial.css:255` gives the web a 72px rail at 768–1023, added *because* the
burger-at-960 behaviour was measured and judged wrong. §8 Finding 3 says the web
gets no rail. The owner chose the prototype — which means reverting a
deliberate, measured decision, and that is why the web half is 2–3 sessions
rather than half of one.

---

## 7 · Settled this session — do not re-litigate

- **eSign is web-only.** Not a mobile destination, ever. "Less chance for bug and
  easy to fix bug, no need of new app for bug fix." `Tablet.jsx:64` lists it, so
  a test blocks it from coming back with a wholesale port.
- **Five destinations the prototype omits are KEPT** — Boards, Mentions,
  Reminders, Content, Marketing. Real routed screens; the prototype was drawn
  against a smaller app.
- **Module order follows the shipped phone grid**, not `Tablet.jsx`. §9 says
  phone screens do not change.
- **The web adopts the prototype's burger overlay** at 768–1023.
- **Today's missing surfaces get built** rather than faked or skipped.
- **Sanvaad and Sahayak are cream on mobile too.**

---

## 8 · Open, needing the owner

1. **The drawer's clock is not wired.** It passes `clockedFor={null}` and always
   offers "Clock in". §3 wants the live timer, but that state is a react-query
   fetch inside `ClockScreen`, and lifting it into a shell mounted all session
   means **a poll running for every tablet user all day**. That is a decision
   about network cost, not a wiring detail. The footer is never wrong, only
   incomplete.
2. **Whether `react-navigation` goes to v7.** Currently v6 and deprecated.
3. **What to do about the mobile brand mark** — add `react-native-svg` and port
   the lotus, or ship raster assets. Three attempts at the PNG export have
   already failed on this machine.

---

## 9 · Suggested order for the next session

1. **Diagnose the APK install** — one round. Every mobile unknown is downstream
   of somebody opening the app, and the longer that runs the more expensive a
   wrong assumption gets. "Not working" could be a blocked install, an ABI
   mismatch, or a real boot crash — three different problems.
2. **Whatever that turns up.** Assume MMKV v3 and react-navigation v6 are the
   first two suspects, in that order.
3. **The brand mark** — but only once (1) is green, because it adds a native
   dependency.
4. Decide the three `FlatList` screens (§3) — virtualisation vs columns.
