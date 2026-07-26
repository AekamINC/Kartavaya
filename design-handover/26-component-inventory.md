# Component inventory, states and the picker

## Prerequisites
- `00-tokens.md` — every value below is a token reference
- `02-common-components.md` — this file supersedes its state guidance and extends it; where they disagree, **this file wins**
- `16-animations.md` — §6 here gives the concrete keyframe values that file described in principle
- `23-accessibility.md` — focus, ARIA and contrast obligations for everything listed here

## Files to create
- `frontend/src/styles/components.css` — state vocabulary, form layout, picker
- `frontend/src/components/ui/Picker.jsx` — replaces four separate pickers
- `frontend/src/components/ui/Field.jsx` — the `.fldx` wrapper
- `frontend/src/components/ui/Toggle.jsx` · `Checkbox.jsx` · `Radio.jsx`

## Files to modify
- `frontend/src/styles/kartavaya-design.css` — add `--shadow-4`, `--dur-instant`, `--dur-xslow`
- `frontend/src/components/drawer/DrawerMeta.jsx` — three pickers → one
- `frontend/src/components/drawer/DrawerSubtasks.jsx` — fourth picker → same one

## Estimated scope
~6 components new, ~14 modified, 1 stylesheet added

**Live reference: `Kartavaya Redesign/Component Inventory.html`.** Everything in it is interactive — the pickers open, filter, take arrow keys and Escape; the theme, density and a 4× slow-motion toggle sit in the bar. Read that alongside this file; the numbers are here, the behaviour is there.

---

## 0 · Why this file exists

A mechanical audit of the redesign stylesheets found **106 class roots and exactly one state modifier** — `.on`. No disabled, no error, no loading, no empty, anywhere in the system.

That is the honest answer to "does the design have opinions on the states I invented?" It did not. Anyone implementing from the earlier files was not overriding a decision; they were filling a void, page by page, which is how six pages end up with six different disabled treatments.

---

## 1 · State vocabulary

Six selectors. Nothing else.

| Selector | Means | Rule |
|---|---|---|
| `.on` | selected · active · current | **Kept as-is.** 40+ existing uses; renaming to `.is-selected` changes nothing a user sees and touches every file |
| `:hover` | pointer over | Native |
| `:focus-visible` | keyboard focus | Native. **Never `:focus`** — that rings on mouse click too, which is why teams end up deleting focus styles |
| `[disabled]` | unavailable | The real attribute on real controls. `.is-disabled` only for `div`-based elements |
| `.is-error` | invalid | **On the wrapper, not the input** — so label, hint and border respond to one class |
| `.is-loading` | in flight | Sets `pointer-events: none`. Label stays; **width must not jump** |

Two prefixes, and the split is the point: **`.on` is what the user chose, `.is-*` is what the system is doing.** A row can be `.on.is-loading` — selected, and saving that selection — and they never contend for the same slot.

```css
.is-disabled, [disabled], [aria-disabled="true"] { opacity: .42; pointer-events: none; cursor: default; }
:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--r-xs); }
.btn:focus-visible, .icobtn:focus-visible, .chip:focus-visible { outline-offset: 3px; }
.is-loading { position: relative; pointer-events: none; }
.spin { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent;
        border-radius: 50%; animation: dmSpin 640ms linear infinite; opacity: .78; flex: none; }
```

**Never write `:hover, :focus { … }` as one rule.** The focus ring must persist while the pointer is elsewhere; a shared selector makes it vanish the moment the mouse moves, which reads as a bug and gets "fixed" by removing focus styling altogether.

---

## 2 · Spacing — two scales, and the test that picks between them

There are two, deliberately. Nothing said so, which is why a literal `gap: 14px` was a reasonable guess. **14 is on neither.**

**The fixed ramp.** Structural. Does not move with density. Use inside a component, where the relationship between two elements is a fact about the component rather than a preference.

| Token | px | Applies to |
|---|---|---|
| `--sp-1` | 4 | Icon to its label inside a chip · badge padding |
| `--sp-2` | 8 | Sibling controls in a row · chip to chip · avatar to name |
| `--sp-3` | 12 | Label to field · internal padding of a list row |
| `--sp-4` | 16 | Field to field · groups inside one card |
| `--sp-5` | 20 | Card to card in a grid |
| `--sp-6` | 24 | Form section to form section |
| `--sp-7` | 32 | Page section to page section |
| `--sp-8` | 44 | Hero to content · major page break |

**The density-responsive set.** Two values each — cozy / compact.

| Token | cozy / compact | Applies to |
|---|---|---|
| `--row-h` | 44 / 34 | Table and list row height |
| `--pad-page` | 28 / 18 | Page gutter |
| `--pad-card` | 18 / 12 | Card interior |
| `--gap-section` | 22 / 14 | Between stacked page blocks |
| `--gap-tight` | 10 / 7 | Inside a dense cluster |

Read these off `tokens.css`, not off a transcription. An earlier draft of this table had all five compact values wrong by 2–4px — which is harmless in CSS, where the token is the source, and **not harmless in `17-mobile-app.md`**, where React Native has no custom properties and the numbers must be hardcoded. A transcribed table is a fork waiting to happen.

**The test: would a user who chose Compact want this gap smaller?** Yes → density token. No → `--sp-*`.

A stack of page sections wants to tighten, so `.stack { gap: var(--gap-section) }` — not `14px`, and not `--sp-4` either, because `--sp-4` ignores the density control the user just moved. The 6px between a priority dot and its label does not want to tighten; that is `--sp-1`.

Note the density set runs on its own rhythm — 10 and 22 are on neither ramp. That is fine, but it means **a literal `14px` is always wrong**: round to `--sp-3` if it belongs to the component, or `--gap-tight` if it should compress.

---

## 3 · Form layout

Three rules. Each falls out of something specific about this product rather than taste.

### The label sits above. Always.

Never beside. A beside-label column must be sized for the longest string in it, and every label here is an English/Devanagari pair of unpredictable width — "Registered address / पंजीकृत पता" against "PAN". Sizing for the worst case wastes the gutter on every other row, and **switching the language to Gujarati resizes the entire form.**

The one inversion: **switches and checkboxes**, where the label reads as a sentence to the control's right, not a caption above it. That is `.fldc`, not `.fldx`.

### Hint above error, and the hint never leaves.

The common pattern swaps them — the error replaces the hint. That deletes the format instruction at the exact moment the user has proven they need it. Both stay; the error stacks below.

```
[ label ][ optional ]
[ input                    ]
  hint    — persistent, --on-surface-3, 11.5px
  error   — appears below, --danger, 11.5px, with icon
```

### Optional is marked. Required is not.

The asterisk convention marks the majority, which is noise on every row. Here most fields are required, so the exception carries the mark — right-aligned in the label row, where it reads as an aside rather than part of the field name.

### Width

**Fills its grid column.** Four exceptions, all with known value length:

| Modifier | Width | For |
|---|---|---|
| `.fldx--date` | 140px | dates |
| `.fldx--time` | 100px | times |
| `.fldx--amt` | 120px | money — mono, right-aligned |
| `.fldx--otp` | 210px | OTP |

Nothing else gets a fixed width. A 300px input inside a 520px card is a decision that breaks the first time the card is used somewhere narrower.

Row grids: `.form__row` (1fr 1fr), `--3` (three equal), `--21` (2fr 1fr). All collapse to one column below 768px.

```css
.form { display: flex; flex-direction: column; gap: var(--sp-4); }
.form__sec + .form__sec { margin-top: var(--sp-6); padding-top: var(--sp-6); border-top: 1px solid var(--outline-variant); }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); align-items: start; }
.fldx { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.fldx__lbl { display: flex; align-items: baseline; gap: 6px; overflow: hidden; font-size: 12.5px; font-weight: 500; color: var(--on-surface-2); }
.fldx__lbl > * { flex: none; }               /* label text must never shrink */
.fldx__lbl .hi { font-family: var(--font-indic); font-size: 11px; color: var(--on-surface-3); font-weight: 400; }
.fldx__opt { margin-left: auto; font-size: 10.5px; font-family: var(--font-mono); color: var(--on-surface-3); }
.fldx__in { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--outline); border-radius: var(--r-sm);
            background: var(--s-lowest); color: var(--on-surface); font: inherit; font-size: 13.5px;
            transition: border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.fldx__in:hover:not(:disabled) { border-color: var(--on-surface-3); }
.fldx__in:focus { outline: none; border-color: var(--primary);
                  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 17%, transparent); }
.fldx__hint { font-size: 11.5px; color: var(--on-surface-3); line-height: 1.45; }
.fldx__err  { display: flex; align-items: flex-start; gap: 5px; font-size: 11.5px; color: var(--danger); line-height: 1.45; }
.fldx.is-error .fldx__in { border-color: var(--danger); }
.fldx.is-error .fldx__in:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 17%, transparent); }
```

Wrap the label text in its own `<span>`. A bare text node is an anonymous flex item and **will** shrink — "Registered address" renders as "Registered".

---

## 4 · The picker

The single largest unspecified piece, in the most-used surface.

The drawer ships **four independently-written pickers** — assignee, date, priority, category. Between them: four different dismiss behaviours (two do not close on Escape), one hardcoded `z-index: 300`, one hardcoded upward placement, no arrow-key support anywhere, and four separate mobile treatments.

### One component, four modes

```jsx
<Picker mode="person" items={members} value={id}  onChange={set} placeholder="Unassigned" />
<Picker mode="multi"  items={members} value={ids} onChange={set} placeholder="Add assignees" />
<Picker mode="option" items={PRIORITIES} value={p} onChange={set} placeholder="No priority" />
<Picker mode="option" items={cats} value={c} onChange={set} onCreate={mk} createLabel="New category" />
<Picker mode="date"   value={due} onChange={setDue} />
```

| Prop | Effect |
|---|---|
| `mode` | `person` · `option` · `multi` · `date` |
| `field` | Full-width form dress (36px, bordered) instead of the inline 30px trigger |
| `up` / `right` | Flip placement. **Replaces every hardcoded `bottom: calc(100% + 4px)`** |
| `search` | Defaults on above 6 items, off below. Never a search box over a 4-item list |
| `onCreate` | Adds a create row that carries whatever is in the search box |
| `disabled` | Standard attribute |

### What they now share — `usePicker()`

Escape (with `stopPropagation`, so it does not also close the drawer behind it) · click-outside · Arrow Up/Down/Home/End roving focus · Enter to commit · a 130ms exit animation before unmount.

That last one matters: the current pickers unmount instantly, so `dmPopOut` never plays. The close path is `setClosing(true)` → `setTimeout(unmount, 130)`, not a bare `setOpen(false)`.

### Anatomy

| Part | Value |
|---|---|
| Trigger | 30px inline / 36px `field`, `--r-sm`, transparent border until hover |
| Popover | `min-width 236px`, `max 320px`, `--r-md`, `--shadow-3`, `z-index: 340` |
| Row | 6px 8px, `--r-sm`, 13px; selected `.on` = `--primary-container` |
| List | `max-height 258px`, scrolls |
| Calendar | 244px, 28px day cells; today dotted, selected filled |
| Quick row | Today · Tomorrow · Next week · Clear — above the calendar, not below |

`multi` swaps the trailing checkmark for a leading `.pk__box` checkbox and **stays open** after each pick; single-select closes.

### Mobile

**One media query, not four hand-written variants.** Below 768px every mode becomes a bottom sheet: `position: fixed`, grab handle, `dmSheetIn`, 44px rows, 40px day cells, `z-index: 620`.

### Z-order ladder

`200` drawer · `340` picker and menu · `420` modal · `520` toast · `620` mobile sheet.

Every hardcoded z-index in the current build is replaced by this. The subtask picker at `300` over a drawer at `200` works today only because nobody has opened a menu on top of a modal.

---

## 5 · Selection controls

`.tgl` 38×22 switch · `.cbx` 17px checkbox with `.mixed` for partial · `.rdo` 17px radio · `.seg` segmented.

**Every one carries the matching ARIA** — `aria-pressed` on the switch, `aria-checked` on checkbox and radio (`"mixed"` for indeterminate), `aria-selected` in the segmented group. A `div` with a class is invisible to a screen reader.

The segmented group is the roving-tabindex case: **one tab stop for the group**, arrows move within it. Four separate tab stops for four view modes is four keystrokes a keyboard user pays on every screen.

---

**Base `.btn` is layout only** — height, padding, radius, font, focus ring. No background and no border, so a `.btn` with no variant renders as plain text. Six variants carry the appearance, in this order: `--fill` (primary action), `--out` (secondary), `--tonal`, `--ghost`, `--text`, `--danger`. `--sm` and `--lg` are size modifiers that compose with any of them, so they are counted and shown separately.

The order is semantic and the board sorts by it. Alphabetical put `--danger` first — a red "Delete task" leading the button inventory, with the primary action second.

This inventory demonstrated `btn--pri` — a name defined in no stylesheet — while omitting six that exist. Under the §6 rule the demonstrated name is canonical, so the error would have shipped a nonexistent class to implementers. The button grid now **enumerates `.btn--*` from `document.styleSheets` at render** and counts itself in its own heading. A variant that does not exist cannot be demonstrated, one that does exist cannot be omitted, and the prose cannot miscount the grid — all three were live failures on this board, and all three are structurally impossible now. `--sm` and `--lg` appear as a second row because they are size modifiers that compose with any appearance, not appearances themselves.

The other sections are still hand-written specimens. Enumerating them is the right direction, but the button set was the one where the drift had already happened four times.

## 6 · Keyframes — the concrete values

The principle was written; the numbers were not. **The exit is never the reverse of the entrance** — every out is one duration step faster and travels less than its in. Entering is the system responding to you and can afford to be gracious; leaving is a thing getting out of your way, and reluctance there reads as lag.

| Keyframe | In | Out | Timing |
|---|---|---|---|
| `dmFade` / `dmFadeOut` | `opacity 0 → 1` | `1 → 0` | `--dur-base --ease-enter` / `--dur-fast --ease-exit` |
| `dmDrawerIn` / `dmDrawerOut` | `opacity .3, translateX(28px) → none` | `none → opacity 0, translateX(16px)` | `--dur-slow` / `--dur-base` |
| `dmSheetIn` / `dmSheetOut` | `translateY(100%) → none` | `none → translateY(100%)` | `--dur-slow` / `--dur-base` |
| `dmPop` / `dmPopOut` | `opacity 0, scale(.97) translateY(-4px) → none` | `none → opacity 0, scale(.98)` | `--dur-base` / `--dur-fast` |
| `dmTip` | `opacity 0, scale(.94) → none` | **none** | `--dur-fast --ease-enter` |
| `dmSpin` | `rotate(0 → 360deg)` | — | `640ms linear infinite` |
| `ixflash` | `--primary 34% → transparent` | — | `calc(var(--dur-slow) * 1.4) --ease-exit` |

Notes that are not obvious from the table:

- **`dmFade` has no transform at all.** A scrim that also moves reads as a second object arriving.
- **The drawer enters at `.3` opacity, not `0`.** It is a solid panel sliding in, not one materialising.
- **`dmSheet` is the only symmetric pair.** A sheet that exits partway looks stuck; it must clear the viewport.
- **`dmPop` needs `transform-origin` set per placement** — top-left for a below-right menu, bottom-left for above-right — or it grows from the wrong corner.
- **`dmTip` has no exit.** A tooltip that fades out follows the cursor to the next control and reads as lag. 300ms delay in, instant unmount.
- **`dmSpin` is linear, never eased.** An eased spin looks like it is struggling.
- **`ixflash` fires on the element, never a container.** A whole flashing card is an alarm; a flashing cell is information.

### Duration ladder

| Token | ms | For |
|---|---|---|
| `--dur-instant` | 90 | Colour-only change · chip fill |
| `--dur-fast` | 140 | Exits · hover |
| `--dur-base` | 220 | Standard enter · popover · fade |
| `--dur-slow` | 360 | Drawer · sheet · anything crossing the screen |
| `--dur-xslow` | 520 | Page transition · first-paint stagger |

**Two token bugs found writing this, both now fixed in `00`:**

1. `--dur-instant` and `--dur-xslow` were declared in `motion.css` only. Any page loading `tokens.css` alone resolved them to nothing — the animation silently never ran. All five now live in `tokens.css`, and the `prefers-reduced-motion` block zeroes all five, not three.
2. **`--shadow-4` was used in `03`, `04`, `11` and `15` and defined nowhere.** `14-dark-mode.md` defined it for dark only, so light mode fell through to no shadow at all on the drawer, the drag card, the admin sidebar and the mobile nav. Now in both palettes:
   `0 24px 56px -12px rgba(30,28,22,.30), 0 8px 20px -8px rgba(30,28,22,.16)`

---

## 7 · Legacy classes — the rule

**If a class has a counterpart in this inventory, it is absorbed. If it is page-specific layout with no counterpart, it keeps its name and its `k-` prefix.**

The prefix stops meaning "legacy" and starts meaning "local to one page", which is worth keeping.

| Class | Verdict | Becomes | Why |
|---|---|---|---|
| `.k-mcard` | **Absorb** | `.card` | It is a card. Padding, radius, border and shadow already match within 1px — it predates `.card` |
| `.k-rolebadge` | **Absorb** | `.chip` | A chip with a fixed colour map. The map moves to `--st-*` and the class goes |
| `.k-pbar` | **Absorb** | `.prg` | Duplicate progress bar, 1px taller |
| `.k-teamgrid` | **Keep** | — | Page-specific layout, no counterpart. Renaming to `.grid` buys nothing and loses a name that says what it holds |
| `.k-bar__lbl` | **Keep** | — | Local to one chart |

**Absorb only while you are already editing that page.** Never as a standalone sweep. A commit that renames 200 classes and changes no behaviour is unreviewable, and it is exactly the change most likely to quietly break a selector something else depends on.

---

## 8 · Chips, badges, avatars

| Class | Rule |
|---|---|
| `.chip` | Read-only by default — status, label |
| `.chip[role="button"]` | Interactive. **Must look different** — cursor plus a hover state. A chip that is clickable and identical to one that is not is the most common source of dead clicks in the current build; filter chips and status chips are visually the same object today |
| `.chip` + dismiss | Applied filters only. The × is a real `<button>` with an `aria-label` |
| `.badge` | Count. Mono, so digits do not shift width as the number changes |
| `.pdot` | Colour dot — **never the only carrier of meaning.** Always a text label beside it or an `aria-label` on the parent. Roughly 1 in 12 men reads red and green as the same value, and priority is precisely the field where that matters |
| `Av` | Deterministic colour from a hash of the name, so the same person is the same colour everywhere without a stored preference |
| `AvStack` | 3 max, then `+n`. `-6px` overlap, 1.5px ring in the parent's background colour |

---

`.badge--n` (the neutral count) reads on `--s-highest`, not `--outline`. A stroke token is not a text ground — see `00` §7.

## 9 · Empty, loading, error

The three states a component spends most of its life in, and the three the current build renders as a blank `div`.

**Empty is not an error and must not look like one.** Four distinct treatments:

| State | Copy pattern | Offers |
|---|---|---|
| **No data yet** | "No tasks in Review" + what causes one to appear | The action that creates one |
| **Filtered to nothing** | "No tasks match these filters" + the count applied | Clear all |
| **Denied** | "Payroll is restricted" + who can lift it | Nothing — no false affordance |
| **Failed** | "Couldn't load this board" + **what survived** | Retry |

The one that matters most is **denied**. Rendering "No data" to a user who lacks the grant teaches them the record does not exist — so they escalate to an owner who can see it plainly, and the support ticket is about a bug that is not one. Say it is restricted, and name who can grant it.

Skeletons are **shaped like the content**, not grey rectangles — avatar circle, title bar, meta bar. A skeleton whose shape does not match what loads produces a visible jump, which is worse than a spinner.

### Toasts

Success and info dismiss at **4s**, warning at **7s**, **error never auto-dismisses.** A four-second success message is a courtesy; a four-second failure message is a bug report the user did not get to read. Hover pauses the timer on all of them.

Reversible actions get an **Undo** toast instead of a confirm dialog — the undo window *is* the confirmation, and it costs the user nothing when they meant it.
