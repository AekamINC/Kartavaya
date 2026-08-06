# 31 · Tablets — iPadOS and Android

**Prerequisites:** `00-tokens.md`, `15-mobile-web.md`, `17-mobile-app.md`.
**Prototype:** `Kartavaya Redesign/Tablet.html` · `tablet.css` · `Tablet.jsx`,
`TabletScreens.jsx`.

Two targets share this file because they share one rule and disagree on
everything else: the **app** on iPadOS and Android tablets, and the **web app**
in a tablet browser. Where they diverge it is said, not implied.

---

## The rule everything else follows

**Read the window. Never the device.**

Not the model, not the screen size, not the orientation, not the user agent. On
a 13-inch iPad this app is 1376&thinsp;pt in full screen, 685&thinsp;pt in a half Split
View, and **320&thinsp;pt in Slide Over** — the same hardware, three layouts, and the
narrowest of the three is narrower than a Pixel 8. A layout keyed to the device
is wrong two-thirds of the time on the most expensive tablet Apple sells.

In React Native that means `useWindowDimensions()`, which re-renders on resize —
never `Dimensions.get('window')` read once at module scope, which freezes at
launch and is the single most common tablet bug in the ecosystem.

```ts
// mobile/src/hooks/useWindowClass.ts
import { useWindowDimensions } from 'react-native';

export type WindowClass = 'compact' | 'medium' | 'expanded' | 'large';

export const useWindowClass = (): WindowClass => {
  const { width } = useWindowDimensions();
  return width < 600 ? 'compact'
    : width < 840 ? 'medium'
    : width < 1200 ? 'expanded'
    : 'large';
};
```

Four classes, matching Material's window size classes and the points at which
iPadOS itself changes behaviour. Do not add a fifth. Every extra breakpoint is
another combination nobody tests, and `15-mobile-web.md` already made this
argument for the web.

---

## 1 · The ladder, and where the real devices land

Widths are points (iPadOS) and density-independent pixels (Android) — the units
layout reasons in. Physical pixels never appear in a breakpoint.

| Class | Width | Navigation | Panes |
|---|---|---|---|
| **compact** | < 600 | bottom bar, 5 items | one |
| **medium** | 600–839 | navigation rail, 80 | one |
| **expanded** | 840–1199 | navigation rail, 80 | two |
| **large** | ≥ 1200 | expanded drawer, 280 | two |

The pane count in that last column is the *typical* case. The actual rule is
content width — §3. A medium window in portrait has 660&thinsp;dp+ of content and does
split; a compact one never does.

| Device | Portrait | → | Landscape | → |
|---|---|---|---|---|
| 7-inch Android | 600 × 960 | medium · **one pane** | 960 × 600 | expanded |
| iPad mini 8.3" | 744 × 1133 | medium | 1133 × 744 | expanded |
| 11-inch Android | 800 × 1280 | medium | 1280 × 800 | **large** |
| iPad Air 11" | 820 × 1180 | medium | 1180 × 820 | expanded |
| 13-inch Android | 960 × 1540 | **expanded** | 1540 × 960 | **large** |
| iPad Pro 13" | 1032 × 1376 | **expanded** | 1376 × 1032 | **large** |

**Read the pattern rather than the rows:** every tablet in this table has enough
content width to run list-and-detail side by side in **both** orientations —
except the 7-inch Android in portrait, which has 520&thinsp;dp. Orientation changes
how much room the detail gets; it does not change the arrangement (§3).

**Two panes below 660&thinsp;dp of content is worse than one.** Split, a 600&thinsp;dp window
less an 80&thinsp;dp rail gives a 200&thinsp;dp list beside a 320&thinsp;dp detail. It looks like a
tablet layout and reads like a mistake.

---

## 2 · Navigation

Three forms of one thing, chosen by class:

**compact — the phone's bottom bar.** Unchanged from `17-mobile-app.md`:
Today · Tasks · ＋ · Messages · More.

**medium and expanded — the navigation rail, 80.** Six destinations: Today,
Tasks, Messages, Approvals, Clock, More. The bottom bar does not survive the
transition, and not because there is room for a rail. A bar pinned to the bottom
of a 1280&thinsp;dp screen puts primary navigation a full hand-span from the text
being read, and in landscape it spends scarce vertical space on chrome.

**large — the expanded drawer, 280.** And this is where **More is deleted, not
widened.** More exists on a phone because five slots cannot hold twelve modules.
At 1200 the drawer holds all of them with the content panes still intact, so the
compromise has nothing left to solve. Shipping a *More* row inside a drawer that
already lists everything is a phone habit surviving into a place it makes no
sense.

Rail and drawer are the same destination list, the same order, the same badges.

---

## 3 · Which screens split, and which do not

Two panes are for screens that are **a list of things you open**. That is a
smaller set than it looks.

| Screen | expanded / large | Why |
|---|---|---|
| **Tasks** | list (38%, 280–400) + detail | The detail is a 43&thinsp;KB drawer (`03-task-drawer.md`). Beside the list it stops being a modal, and you keep your place |
| **Messages** | list + chat | The obvious one. Unread counts keep moving in the list while you read another thread |
| **Notifications** | list + the record it points at | An inbox is for triage. Opening a mention should not cost the list |
| **Today** | **two columns, no detail** | A summary, not a list of things you open. Work and clock-in on the left, approvals, activity and unread on the right |
| **Approvals** | **queue + supporting pane** | §3.1 |
| **Boards** | one pane, full width | §3.2 — columns in landscape, stacked collapsible groups in portrait |
| **Pahchan** | **full bleed, no rail** | §5 |
| **Modules, Inbox, Settings** | one pane, measure-capped | §4 |

**The empty detail pane is designed, not defaulted.** A grey *no item selected*
wastes the larger half of the screen. It carries the jaali ground at 68&thinsp;px, the
screen's own icon, and a line saying what the pane is for.

**And on Tasks it never appears, because the pane opens the first task.** A
second pane that arrives empty is 750&thinsp;pt of nothing on an 11-inch iPad in
landscape. Selecting a task has no side effect, so there is no reason to make
the user do it. **Messages does not auto-open**, and the difference is the whole
rule: opening a conversation marks it read, and a side effect the user did not
ask for is worse than a placeholder.

### Portrait is not a phone held sideways

**List and detail sit side by side whenever the content region can hold both.**
The floor is **660&thinsp;dp of content**, not a width class — below it the detail
would be narrower than a phone, and above it there is no reason to do anything
else. That includes portrait: an iPad Pro held upright has 950&thinsp;dp of content,
which is more than most laptops give a mail client.

```
content ≥ 660   list (38%, clamped 280–400) + detail   — both orientations
content < 660   one pane; the detail pushes over it with a back button
```

Only the 7-inch Android in portrait (520&thinsp;dp of content) falls below the line.

**Do not stack a detail under its own list.** It was tried and it is wrong: a
task list above a task detail reads as two half-height windows rather than one
surface, and the divider moves every time the list length changes. Stacking is
for a **supporting** pane only — content that is not the detail of the row above
it — and Approvals is the one screen that has one (§3.1).

And a single column of cards across 700&thinsp;dp is a phone layout that happens to be
wide — the most common way a tablet build looks unfinished. Where a pane is not
split, cards flow **two abreast** above 640&thinsp;dp of content and **three** above
1040, while headers, filters, segmented controls and section rules keep spanning
the full width:

```css
.pane--grid > .body { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 9px 14px; max-width: 1120px }
.pane--g3  > .body { grid-template-columns: repeat(3, minmax(0,1fr)); max-width: 1560px }
.pane--grid > .body > .head, > .seg, > .chips, > .sec, > .stats { grid-column: 1 / -1 }
```

Two smaller things in the same family: the module grid moves from a fixed 3
columns to `repeat(auto-fill, minmax(112px, 1fr))`, and **filter chips stop
scrolling sideways and wrap.** Chips scroll on a phone because there is nowhere
else to put them; here there is.

### 3.1 · Approvals gets a supporting pane, not a detail pane

A queue of four ends a third of the way down a 1376&thinsp;pt screen. What belongs
underneath is not a detail view of the selected row — the card already holds
everything — but **what has already been decided**: who approved or declined
what, and when. It is the one thing an approver looks for that is not in the
queue, and it is the audit trail the product already writes.

### 3.2 · The board stacks in portrait

**From 600&thinsp;dp up — every tablet, not only the ones that split into two panes.**
Five columns 190&thinsp;dp wide and three cards deep is neither a board nor a list. In
portrait each status becomes a **full-width collapsible group** — header with
name, count and a disclosure chevron; cards flowing
`repeat(auto-fill, minmax(206px, 1fr))` inside. Collapse the ones you are not
working in and the ones you are get the whole screen. The status pills stay in
the header as a legend and as a way back to a collapsed group.

**Landscape keeps the columns and makes them full-height lanes** — all five
visible, each scrolling independently, the lane fill running to the bottom of
the pane rather than stopping under the last card. The phone's column tabs and
snap paging are dropped at both orientations; they exist because 393&thinsp;px holds
one column.

### The drawer runs out of rows before it runs out of height

Fifteen destinations do not fill 1032&thinsp;pt. The space left over goes to the two
things worth reaching from anywhere: **whether you are on the clock** — the live
timer, or the clock-in button, pinned to the bottom — and **whether your work
has reached the server**, one line, stating the queue depth rather than a cloud
icon (`17-mobile-app.md`). Both already exist elsewhere in the product; neither
is new UI invented to fill a gap.

---

## 4 · Measure, targets, density

**A pane is not a text column.** A 13-inch Android in landscape gives the detail
pane 860&thinsp;dp; set at 15&thinsp;px that is roughly 150 characters a line. Cap it and
give the rest back as margin:

```css
.tpane--detail > .mbody, .tpane--wide > .mbody { max-width: 760px; margin: 0 auto }
```

**Touch targets do not shrink because the screen grew.** 44&thinsp;pt on iPadOS,
48&thinsp;dp on Android, everywhere, including with a pointer attached — the same hand
uses both. There is no tablet density tier; the product ships cozy and compact
(`00-tokens.md`) and a tablet is cozy.

**Sheets become form sheets.** A bottom sheet is a phone pattern: it is near the
thumb because on a phone the thumb is at the bottom. Pinned to the bottom edge
of a 1376&thinsp;pt screen it is a long reach from wherever you were reading. On
tablets the new-task sheet is centred, ~520&thinsp;pt wide, with the same field set.

---

## 5 · Pahchan is immersive at every size

The capture screen owns the window. No rail, no drawer, no panes, in any class,
in either orientation — edge-to-edge under a transparent status bar with light
glyphs, exactly as `17-mobile-app.md` requires on phones. The rules there about a
cream status bar over a black camera view apply here and are more visible.

**Open question — the wall-mounted kiosk.** A 7-inch Android by a door is how
attendance actually works in a lot of Indian SMBs, and the hardware in this
file's first row is the hardware that gets mounted. A shared device is a
different product: no signed-in user, a queue, a much larger face ring, and a
consent notice that has to be readable from arm's length. Not designed here, and
it should not be improvised into the personal capture screen. Decide whether it
is in scope before Pahchan ships (`07-pahchan.md`).

---

## 6 · Multi-window is the requirement, not the edge case

Both platforms let the user make this app narrow at any moment. On iPadOS that
is Split View, Slide Over and Stage Manager; on Android, split-screen and
freeform. **Slide Over is exactly 320&thinsp;pt on every iPad**, so the compact layout
is reachable on the largest device in the range.

Three things make a resize survivable:

- **Layout follows the class, so it happens for free** — the rail disappears,
  the bottom bar returns, and the app is the phone layout it already has.
- **Nothing is lost.** Whatever was open in the detail pane becomes the
  full-window view with a back button, on the same record. Widen again and it
  returns to two panes with that record still selected. Selection lives above
  the layout, never inside a pane.
- **It is a resize, not a remount.** No refetch, no scroll reset, no keyboard
  dismissal. This is what breaks when window state is read once at launch.

Three config lines gate all of it, and without them the rest of this file is
unreachable:

```jsonc
// mobile/app.json
"orientation": "default",              // portrait-lock makes a tablet useless
"ios":     { "supportsTablet": true, "requireFullScreen": false },  // false ⇒ Split View
"android": { /* AndroidManifest: android:resizeableActivity="true" */ }
```

`requireFullScreen: true` — the Expo default in many templates — silently
disables Split View and Slide Over entirely.

---

## 7 · What differs by platform

| | iPadOS | Android |
|---|---|---|
| Rail | 72, tinted glyph + label, no indicator | 80, Material pill indicator behind the glyph |
| Drawer | 280, 44 rows, `--r-sm`, selected row solid `--primary` | 280, 52 rows, pill, selected row `--secondary-container` |
| ＋ | Toolbar button in the pane's navigation bar | FAB at the head of the rail; extended FAB in the drawer |
| Sheet | Form sheet, centred, grab handle | Dialog, centred, no handle |
| Back | Edge swipe; no system back button | Predictive back — must be handled on every pane and sheet |
| Keyboard | Magic Keyboard is common; ⌘F, ⌘N, ⌘1–5 for rail destinations | Less common, same shortcuts where present |
| Pointer | Hover states apply; the cursor snaps to controls | Hover states apply |
| Split | Split View · Slide Over · Stage Manager | Split-screen · freeform · desktop mode |

Both platforms get hover states — gate them on `@media (hover: hover)` and never
on width, per `15-mobile-web.md`. A tablet with a keyboard case is a wide screen
with a pointer; a tablet without one is a wide screen without.

---

## 8 · The web app in a tablet browser

Different target, different failures. `15-mobile-web.md`'s three breakpoints are
correct and unchanged. What is missing from them is that **they are all width**,
and on a tablet width no longer implies input.

**Finding 1 — a tablet gets desktop density.** An iPad in landscape reports
1180 CSS px, lands in the ≥1024 branch, and is served the full desktop layout
including its 28&thinsp;px icon buttons — which a mouse hits and a thumb does not.
The fix is to stop inferring input from width:

```css
/* Not a breakpoint. Any coarse pointer at any width. */
@media (pointer: coarse) {
  .icon-btn, .row__menu, .tb__sort, .chip { min-width: 44px; min-height: 44px }
  .row__act { opacity: 1 }
}
```

This is the same class of bug as the hover rules in `15` and it wants the same
answer: gate on the capability, not on a proxy for it.

**Finding 2 — iPad Safari asks for the desktop site by default.** *Request
Desktop Website* is **on** for iPad out of the box. Safari lays the page out at
about 1024 CSS px and scales it to fit the glass, so on an iPad mini in portrait
the page believes it is 1024 wide and is drawn at **0.73×** — a 44&thinsp;pt target
lands at 32, and every breakpoint below 1024 is unreachable no matter how the
device is held. The prototype has a *Desktop site* toggle that shows this
directly.

Do not fight it with a UA string. Two things that do work:

- **`viewport-fit=cover` and a real viewport meta** — already required in `15`
  for `env(safe-area-inset-*)`, and it is what stops Safari inventing a width.
- **The `pointer: coarse` gate above**, which survives the scaling because it
  never asked about width in the first place.

**Finding 3 — the web app does not get a rail.** It gets the sidebar it already
has: in flow at ≥1024 CSS px, an overlay with a burger below that, the bottom
nav at ≤767. Do not port the native rail to the web. Two navigations for one
product on one device is how the burger came to open a scrim over nothing
(`15-mobile-web.md`).

**Finding 4 — Pahchan is still the honest gap.** Everything in `15`'s closing
table holds on tablets, and the tablet makes it worse: a wall-mounted browser is
exactly where someone will try to run attendance, and the web cannot do the
capture properly. Say so on the screen and offer the app.

---

## 9 · What changes

### App — `mobile/`

| File | Change |
|---|---|
| `app.json` | `orientation: "default"`, `supportsTablet`, `requireFullScreen: false`; manifest `resizeableActivity` |
| `hooks/useWindowClass.ts` | **New.** §0. Every layout decision reads this |
| `nav/RootStack.tsx` | Shell chosen by class: bottom bar / rail / drawer. Same routes, same order |
| `nav/NavRail.tsx` · `NavDrawer.tsx` | **New.** §2 |
| `components/PaneHost.tsx` | **New.** List + detail, selection held above both, §3 and §6 |
| `screens/TasksScreen.tsx` · `MessagesScreen.tsx` | Render into a pane; detail is pushed at compact and medium, adjacent above |
| `screens/TodayScreen.tsx` | Two columns at expanded and above, §3 |
| `components/CardList.tsx` | **New.** The 2-up / 3-up flow in §3, applied by content width. Every list screen renders through it |
| `components/PaneHost.tsx` | Row arrangement in portrait, column in landscape — §3 |
| `screens/BoardScreen.tsx` | Collapsible stacked groups in portrait, full-height lanes in landscape, §3.2 |
| `screens/ApprovalsScreen.tsx` | Supporting pane below the queue in portrait, §3.1 |
| `nav/NavDrawer.tsx` | Carries the clock and sync footer, §3 |
| `screens/PahchanScreen.tsx` | Assert full-bleed at every class, §5 |
| `components/Sheet.tsx` | Form sheet above compact, §4 |

No new screen components. **Every screen in the prototype is the phone screen
from `17-mobile-app.md`, placed in a pane** — which is the point, and also the
scope estimate.

### Web — `frontend/`

| File | Change |
|---|---|
| `styles/editorial.css` | The `pointer: coarse` block, §8. Breakpoints unchanged |
| `index.html` | Confirm the viewport meta from `15` actually shipped |
| `components/ui/Table.jsx` | Sticky first column and edge fade apply on coarse pointers, not only ≤767 |

---

## 10 · Acceptance

Add to `25-qa-acceptance.md`:

1. Rotate every device in §1 in both directions. The class matches the table and
   nothing remounts.
2. Open a task, drag into Slide Over. The task is still open, full window, with
   a back button. Drag back out. Two panes, same task selected.
3. Search `Dimensions.get(` in `mobile/src`. Every hit outside a one-shot
   measurement is a bug.
4. On an iPad in Safari with the default settings, every interactive target
   measures ≥ 44&thinsp;pt **on the glass** — not in CSS px.
5. Pahchan capture shows no rail, no drawer and no bottom bar at any width.
6. No list screen renders a single column of cards wider than 640. Hold every
   device in the §1 table upright and check — portrait is where this fails.

---

## Estimated scope

A navigation shell, a pane host, a hook, and three config lines. The screens do
not change. The risk is not in the layouts — it is in every place the current
code reads a dimension once and assumes it will not move.
