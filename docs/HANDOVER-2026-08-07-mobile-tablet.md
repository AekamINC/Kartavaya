# Handover — mobile & tablet, 2026-08-07 (second session of the day)

Companion to `HANDOVER-2026-08-07.md`, which covers the tenancy/cron/demo work
from earlier the same day. This one covers **`mobile/` only**. Everything below
was measured in this session; where a thing is unverified it says so, and that
distinction is the most important thing in this document.

---

## 1 · Where it stands

| | |
|---|---|
| Branch | `staging`, 12 commits ahead of `25a33b28` |
| Head | `4c1cc339` |
| Scope | 36 files, +7,770 / −11,046 |
| Stack | **expo ^54.0.36 · react-native 0.81.5 · react 19.1.0** |
| `tsc --noEmit` | **exit 0** |
| `npm test` | **384 passed, 0 failed** (was 326 with **5 failing** at session start) |
| `expo-doctor` | 18/18 |
| Bundles | Android and iOS both build, HTTP 200, ~10.5 MB |
| **Runtime** | **NOTHING HAS BEEN RUN ON A DEVICE. See §5.** |

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

**`4c1cc339` — Today gets its second column.**

---

## 3 · What is NOT done

### The last screen
**Board.** 840 lines. §3.2: collapsible stacked groups in portrait, full-height
lanes in landscape, from 600dp up — *every* tablet, not only the ones that split.
The phone's column tabs and snap paging are dropped at both orientations.
`TabletBoard.jsx` is the reference and it is short (127 lines).

### Three smaller pieces
- **`CardList`** — the 2-up above 640dp / 3-up above 1040dp card flow, with
  headers, filters and section rules still spanning full width. `gridColumns()`
  already exists and is tested; nothing consumes it yet.
- **Form sheet** — §4: a bottom sheet is a phone pattern. Above compact the
  new-task sheet is centred, ~520pt.
- **Pahchan full-bleed assert** — §5. `ShellFrame` already suppresses the chrome
  on `Clock` and `Enroll`; what is missing is the test that it stays that way.

### The whole web half — 2–3 sessions
Owner settled 2026-08-07: **adopt the prototype's burger overlay**, which means
*reverting* the shipped 72px rail at 768–1023 and re-testing every page in the
band. Plus §8's `pointer: coarse` block and `Table.jsx`'s sticky first column.
Not started. See §6 for why this is bigger than it looks.

### The mobile brand mark
Never existed. `react-native-svg` is not installed; `assets/` holds only
`icon.png`, `adaptive-icon.png`, `splash.png`, all carrying the **old diamond**;
`components/Lotus.tsx` is an animated *loader* for Sahayak, not the mark; the
login screen renders a bare **क** in a gradient crown. The brand decision reached
the web's seven sites and never crossed. Needs its own scoping.

---

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

## 5 · THE BIGGEST RISK — none of this has run

A green typecheck and 384 green tests prove it **compiles**. They do not prove:

1. **Whether MMKV v3 reads the v2 store.** If not, every user is silently signed
   out and queued offline writes are lost. This is the single highest-value
   thing to check first.
2. **Whether `@react-navigation` v6 behaves under React 19.** It is still v6 and
   npm now warns it is **deprecated** on every install. v7 is the supported line
   for RN 0.81. Deliberately not upgraded, to keep one variable at a time. **If
   navigation misbehaves, this is the first suspect.**
3. **Whether any of the tablet layout looks right.** The rail, the drawer, five
   converted screens, and Today's three brand-new data surfaces have never been
   rendered.

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

1. **Diagnose the APK install** — one round. Every other unknown is downstream
   of somebody opening the app, and the longer that runs the more expensive a
   wrong assumption gets.
2. **Board** — the last screen, and the only one left in §3.
3. `CardList`, form sheet, Pahchan assert — small, and they finish the app half.
4. **The web half** — burger overlay first, since it is the decision already made.
