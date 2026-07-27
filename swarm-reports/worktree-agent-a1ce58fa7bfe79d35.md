# Component set — structure and coverage

Lens: for every component `Component Inventory.html` renders, does the build have
it, does it carry every variant and state shown, and what does the reference show
that the build never built.

**The reference was rendered, not read.** `frontend/public/__ref/` served on
`127.0.0.1:5411`; `Component Inventory.html` executes, and the class roots below
were read out of the live DOM (`document.querySelectorAll('*')` → class set),
not transcribed from prose. That distinction matters: §3 of the inventory says
its own button grid is "counted from the stylesheet at render, not typed into
this sentence, because a hand-written grid demonstrated a variant that did not
exist while omitting six that did."

Reference class roots as rendered (86, complete):

```
badge badge--n btn btn--danger btn--fill btn--ghost btn--lg btn--out btn--sm
btn--text btn--tonal cbx chip empty empty__ic empty__s empty__t fldc fldc__b
fldc__s fldc__t fldx fldx--amt fldx__err fldx__hint fldx__in fldx__lbl fldx__opt
form form__row form__row--21 hi icobtn is-empty is-error is-loading mixed offb on
pdot pk pk--field pk__lbl pk__tr prg prg--ind prg__f rdo seg sk spin tbl tgl tip
tst tst--err tst--info tst--ok tst__a tst__b tst__i tst__s tst__t
```
(`cb*` / `cbbar*` / `rmp*` are the inventory page's own chrome, excluded.)

---

## 1 · Inventory vs build — the table

`have` = a shared component **and** the reference's class root.
`class only` = the CSS root exists, no component wraps it.
`renamed` = the build implements the same thing under a different root.

| # | Reference | Build component | Build class | Verdict |
|---|---|---|---|---|
| 03 | `.btn` ×6 variants ×2 sizes ×5 states | `ui/Button.jsx` | `.btn` | **have** — variant-for-variant, property-for-property |
| 03 | `.icobtn` (5 states) | — | `.k-iconbtn` | **renamed**, no component |
| 04 | `.fldx` + `--amt/--date/--time/--otp`, textarea | `ui/Field.jsx` | `.fldx` | **have** |
| 05 | `.form` `.form__row` `--3` `--21` `.form__sec` | `ui/Field.jsx` (`Row2`) | `.form*` | **have**, `Row2` has 0 consumers |
| 05 | `.fldc` (control-beside-label) | via `RadioGroup` | `.fldc` | **have** |
| 06 | `.tgl` + `.on` + `[disabled]` | `ui/Toggle.jsx` | `.tgl` | **have** — but `.sw` is a second switch still live |
| 06 | `.cbx` + `.on` + `.mixed` | `ui/Checkbox.jsx` | `.cbx` | **have**, incl. `mixed` |
| 06 | `.rdo` | `ui/Radio.jsx` | `.rdo` | **have**, **0 consumers** |
| 06 | `.seg` (roving tabindex) | `customize/Seg.jsx` | `.seg` in `settings.css` | **split** — see §3 |
| 07 | `.pk` ×6 modes | `ui/Picker.jsx` | `.pk` | **have** |
| 08 | `.chip` / `[role=button]` / dismissible | `ui/Chip.jsx` | `.chip` | **have** |
| 08 | `.badge` `--n` dot | — | `.badge` | **class only** |
| 08 | `.pdot` | — | `.pdot` | **class only** |
| 08 | `Av` / `AvStack` | `ui/Avatar.jsx` | `.av` / `.avstack` | **have** (ref calls the stack `.avs`) |
| 08 | `.prg` `.prg--ind` | — | `.prg` | **class only** |
| 09 | `.tip` (300ms in, no out) | `ui/Tooltip.jsx` | `.tip` | **have**, **0 consumers** |
| 09 | `.tst` `--ok/--err/--warn/--info` + action | `ui/toast.jsx` | `.tst` | **have** |
| 09 | `.offb` offline banner | `ui/ErrorState.jsx` `OfflineBanner` | `.k-offline` | **renamed** |
| 10 | `.sk` skeleton | `ui/Skeleton.jsx` ×10 | `.k-skeleton*` | **renamed** |
| 10 | `.empty` ×4 flavours | `ui/EmptyState.jsx` | `.empty` | **have** |
| — | `.tbl` | `ui/Table.jsx` | `.tbl` | **have** |
| — | `.card` (app.css) | `ui/Card.jsx` | `.card` | **have** |
| — | `.stat` / `.stats` (app.css) | `ui/StatTile.jsx` | `.k-stat` | **renamed** |
| — | `.tabs` (app.css) | `ui/Tabs.jsx` | `.tabs` | **have** |
| — | `.spin` | inline | `.spin` | **have** |

**Nothing in the rendered inventory is absent from the build.** Every root either
exists under its reference name or exists under a `k-` name. That is the headline
and it is better news than the prose-only runs implied.

## 2 · What the build has that the inventory does not

Not defects — the inventory covers 12 sections, not the whole product. Listed so
the "is this ours or theirs" question is settled once:

`ui/StatusChip.jsx`, `ui/DueChip.jsx`, `ui/Tag.jsx`, `ui/StatusBar.jsx`,
`ui/Stepper.jsx`, `ui/ConfirmDialog.jsx`, `ui/ErrorState.jsx`, `ui/FocusTrap.jsx`,
`ui/SkipLink.jsx`, `ui/Menu.jsx`, `ui/Popover.jsx`, `ui/Sheet.jsx`, `ui/modal.jsx`.
`Menu`/`Popover`/`Sheet`/`modal` are named by the inventory's §9 z-order ladder
(200/340/420/520/620) but never rendered as specimens.

## 3 · The gap the table misses — a component can exist and still not be it

Three roots pass §1 (`.fldx`, `.empty`, `.seg`) but the **component** the build
actually ships renders something else. Presence was the wrong question for these.

### 3a · `Field.jsx` renders `.fld`, not `.fldx` — and inverts two of §5's rules

`.fldx` in `components.css:551-594` is a faithful port of the reference:
`--date/--time/--amt/--otp`, `.is-error`, `.is-loading`, `.fldx__opt`, the
textarea min-height, all of it. But `ui/Field.jsx` — the shared component, 10
consumer files — renders a **different** vocabulary: `.fld` / `.fld__l` /
`.fld__req` / `.fld__hint` / `.fld__err`, with `Input` on `.inp`.

The two do not look alike. `.fldx__lbl` is 12.5px / 500 / sentence case;
`.fld__l` is `11px, 600, letter-spacing: .06em, text-transform: uppercase`. The
reference's field labels are sentence case. The build's shared field renders
them in tracked caps.

`.fldx` is meanwhile hand-rolled in 5 files with no component
(`fields/TextField.jsx`, `fields/NumberField.jsx`, `customize/NotifyPrefs.jsx`,
`ui/ConfirmDialog.jsx`, `pages/SigningPage.jsx`), and two of its parts have
**zero JSX users anywhere**: `.fldx__opt` and `.fldx__hint`.

Those two absences are the §5 rules going missing, not stray CSS:

- **Rule 3 — "Optional is marked. Required is not."** `.fldx__opt` is the
  right-aligned marker that carries it, and nothing renders it. `Field.jsx` does
  the exact inverse: `{required && <span className="fld__req">*</span>}`. The
  inventory argues the case in full — "the asterisk convention marks the
  majority, which is noise on every row. Here most fields are required, so the
  exception carries the mark." **Not changed** — `required` is public API across
  10 files and flipping it is a design call, not a coverage fix.
- **Rule 2 — "Hint above error, and the hint never leaves."** `Field.jsx:31` was
  `{hint && !error && …}` — precisely the swap the inventory names. **Fixed**
  (commit 2 on this branch). It was also a dangling IDREF: `describedBy` already
  listed `${id}-hint` whenever a hint was passed, so a field carrying both
  pointed `aria-describedby` at a node the same render had removed.

### 3b · `EmptyState.jsx` renders `.empty__art/__title/__body/__act`

Reference: `.empty__ic` / `.empty__t` / `.empty__s`. Same component, renamed
parts. Worth recording because §1 shows `.empty` as **have** and it is, at the
root — the children are the divergence.

The four §10 flavours are, on inspection, **covered**, and the coverage is
better than the reference's own: no-data is `EmptyState` (+ a `tone` prop the
reference has no equivalent for), filtered is `EmptyState` with different copy
and a Clear-all action at 3 sites (`views/TableView.jsx:422`,
`AdminOrgsPage.jsx:630`, `esign/DocumentsTab.jsx:74`) — which is exactly what
the reference does, since its `.empty (filtered)` is also just `.empty` with
other words — and denied/error are `ErrorState.jsx`, which carries four kinds
(`offline`/`server`/`denied`/`missing`) plus the grant-not-record rule the
reference asks for in prose. No gap here. Recorded so it is not re-opened.

### 3c · `.is-loading` is rendered by nothing

The inventory renders `.is-loading` as **one of five states for every button
variant and for `icobtn`**, plus `.fldx.is-loading`. The build has the CSS
(`components.css:483-484` `.is-loading > .spin`, `:585` `.fldx.is-loading`) and
**zero JSX occurrences of the string**. `Button.jsx` has no `loading` prop, so
the label-stays-width-must-not-jump behaviour the inventory specifies for all
seven variants cannot happen. `.spin` exists and is used 3× directly.

This is the largest pure state gap in the set: 1 of the 6 state words is
unreachable from any component API.

---

## 4 · `.btn` vs `.k-btn` — what the reference renders, and the recommendation

**What the reference renders.** There is no `.k-btn` in the reference. Not in
`app.css`, not in the DOM, not in any of the twelve inventory sections. One
vocabulary: `.btn` with `--fill --tonal --out --ghost --text --danger` and
`--sm --lg`. Measured off the live harness:

| variant | height | padding | gap | radius | fill |
|---|---|---|---|---|---|
| `--fill` | 31px | 8/15 | 7px | 6.96px | flat `--primary`, no shadow |
| `--tonal` | 31px | 8/15 | 7px | 6.96px | `--primary-container` |
| `--out` | 33px | 8/15 | 7px | 6.96px | transparent + 1px `--outline` |
| `--ghost` | 31px | 8/15 | 7px | 6.96px | transparent, **no border** |
| `--text` | 31px | 8/**10** | 7px | 6.96px | transparent |
| `--danger` | 33px | 8/15 | 7px | 6.96px | transparent + 1px danger-tinted |
| `--sm` / `--lg` | 27 / 38px | 6/11 · 11/20 | — | — | composes with any appearance |

6.96px is `--r-sm` at the reference's `--radius-base: 12px`. Fill is **flat** —
no gradient, no inset highlight, no drop shadow, no hover lift.

**The build's `.btn` already matches this exactly**, property for property, plus
a seventh `--dangerfill`. Nothing to do there.

**`.k-btn` is a different object**, and `editorial.css:646-650` already says so
in a comment. Measured against `.btn`:

| | `.btn` | `.k-btn` |
|---|---|---|
| padding | 8px 15px | 8px **14px** |
| gap | 7px | **6px** |
| radius | `--r-sm` (5.8px here) | `--r-md` (**10px** here) |
| `:active` | `scale(.975)` | `translateY(1px)` |
| primary fill | flat `--primary` | `--k-grad` gradient + inset highlight + `0 4px 14px` shadow |
| primary hover | colour only | colour + `translateY(-1px)` + shadow |
| variants | 7 | **3** (`--primary`, `--ghost`, `--reject`) + `--sm` |

Call sites — `k-btn` 451 base, 213 `--primary`, 228 `--ghost`, 46 `--sm`, 1
`--reject`, ~15 bare; 68 files. Against `<Button>` at 23 consumer files and 72
raw `.btn` occurrences. `.k-btn` is the majority vocabulary by a wide margin.

**The trap in a sweep, stated once so nobody hits it.** `k-btn--ghost` is
`background: transparent; color: --ink-2; border: 1px solid --rule`. `.btn--ghost`
has **no border**; `.btn--out` is the bordered one. So the 228 largest group maps
to `--out`, not to the identically-named `--ghost`. A find-and-replace on the
name silently deletes a border from 228 buttons. The correct table:

| from | to | delta |
|---|---|---|
| `k-btn` bare (~15) | `btn btn--ghost` | radius 10→5.8, padding −1px/side |
| `k-btn--ghost` (228) | `btn btn--out` | border `--rule`→`--outline`, i.e. one step darker at rest. `k-btn--ghost:hover` already sets `--rule-strong` = `--outline`, so this makes the resting state what its own hover state already was |
| `k-btn--primary` (213) | `btn btn--fill` | **loses the gradient, the inset highlight, the drop shadow and the hover lift** |
| `k-btn--reject` (1) | `btn btn--danger` | near-identical |
| `k-btn--sm` (46) | `btn--sm` | padding 7/12 → 6/11 |

**Recommendation.** Converge on `.btn`, because that is what the reference
renders and the build's `.btn` is already an exact port of it — but the decision
that actually needs a human is `k-btn--primary`. 213 buttons lose a gradient, a
shadow and a hover lift, and the reference is unambiguous that they should: its
`--fill` is flat. That is a visible product change, not a refactor, and it is the
only part of this that a reviewer should be asked to sign off.

Sequencing should follow the inventory's own §11 doctrine, which decides this
without further argument: *"Absorbing is not free — it is a real diff on every
page that uses the class. Do it when you are already editing that page, never as
a standalone sweep. A commit that renames 200 classes and changes no behaviour is
unreviewable."* So: **no sweep.** Take `k-btn` → `btn` per page, using the table
above, whenever that page is open for other reasons. `.k-btn` stays defined
until its last call site goes.

One thing worth doing ahead of any of that, cheaply: `.btn` is `--r-sm` and
`.k-btn` is `--r-md`, so today the same screen shows two corner radii on two
buttons side by side. That is visible now, at zero call-site cost, by changing
one declaration — but it moves pixels on 451 buttons, so it belongs to whoever
owns pixels, not to me.

## 5 · `.k-segctrl` — and the second segmented control nobody mentioned

The brief says `.k-segctrl` is hand-rolled at ~6 sites with no component. True,
and there is more: the build has **two** segmented controls, and the one with a
component is not the one with the call sites.

| | reference `.seg` | build `.seg` (`settings.css:36`) | build `.k-segctrl` (`editorial.css:1203`) |
|---|---|---|---|
| component | — | `customize/Seg.jsx` | **none** |
| call sites | — | 6 files (customize ×5, pahchan ×1) | 5 files |
| group bg | `--s-container` @80% | `--s-container` | `--surface` |
| group border | none | none | **1px `--rule`** |
| group radius | `--r-sm` | **`--r-pill`** | **literal `10px`** |
| gap | 2px | none | none |
| button radius | `calc(--r-sm - 2px)` | **`--r-pill`** | **literal `7px`** |
| button weight | 600 | **500** | 600 |
| selected bg | `--s-lowest` | `--surface` | `--bg-soft` |
| selected shadow | `--shadow-1` | `--shadow-1` | **none** |
| count chip | pill, `--on-surface-3` @14% bg | **no background at all** | pill, `--s-container`, literal `99px` |
| state class | `.on` | `.on` | **`.is-active`** |
| roving tabindex | **yes** | **yes** | **no** |

Neither build control is the reference. `.seg` is right on tokens and wrong on
weight, radius family and the count chip's background; `.k-segctrl` is right on
weight and structure and wrong on the border, the missing selected shadow, and
three hardcoded literal radii (`10px`, `7px`, `99px`) — exactly what
`00-tokens.md §96` forbids and what the `.k-btn` comment at `editorial.css:652`
already flags as a bug in its own right, since a literal radius ignores the
Sharp/Default/Pill setting.

**What the reference actually renders**, read off the live DOM (this is the part
the ARIA argument has been had about, so here it is verbatim):

```html
<div class="seg" role="tablist">
  <button role="tab" aria-selected="true"  tabindex="0"  class="on">Board</button>
  <button role="tab" aria-selected="false" tabindex="-1" class="">Table</button>
  ...
```

`role="tablist"` + `role="tab"` + `aria-selected` + roving tabindex. Recorded,
**not re-litigated**: `Seg.jsx` chose `radiogroup`/`radio`/`aria-checked` and
that is also valid and stays. The only thing worth adding to the settled note is
that `26 §5`'s `aria-selected` was not invalid *in the reference* — the reference
puts it on a real `tab`, where it is legal. It was underspecified, not wrong.

**Keyboard is the real gap.** `Seg.jsx` implements roving tabindex; the five
`.k-segctrl` sites do not. `views/ViewToolbar.jsx:43` is the worst: correct
`tablist`/`tab`/`aria-selected`, but every tab is a tab stop, so a keyboard user
pays 6-7 keystrokes to cross one control on every board view. The other four
(`ActivityFeedPage.jsx:99`, `ApprovalsPage.jsx:194`, `TasksListPage.jsx:234` and
its `--archive` sibling) have **no role and no ARIA at all** — a filter group
announced as N unrelated buttons.

`.is-active` is also a seventh state word against the inventory's six (18 JSX
occurrences / 8 files, 22 CSS rules / 3 stylesheets). The reference's word for
"selected · active · current" is `.on`, and §1 is explicit that six is the whole
system.

**Recommendation.** One component. Promote `Seg.jsx` out of
`components/customize/` into `ui/` and the barrel, add the count chip's
background, correct weight/radius to `--r-sm`, then retire `.k-segctrl` per page
under the same §11 doctrine as `.k-btn` — never as a sweep. Doing it in that
order means the five ARIA-less sites get roving tabindex and a role for free the
moment each is converted. **Not done here**: `.seg` and `.k-segctrl` differ
visibly (border, radius, selected shadow), so picking the winner moves pixels on
11 surfaces and belongs with the sibling who owns them.

## 6 · Components with zero consumers

Shipped, exported from the barrel, rendered by nothing:

| Component | Note |
|---|---|
| `ui/Tooltip.jsx` | Confirms the brief: the missing edge auto-flip (`MOTION-SPEC.md:147`) cannot manifest today. See §7. |
| `ui/Stepper.jsx` | — |
| `ui/StatusBar.jsx` | — |
| `ui/Radio.jsx` + `RadioGroup` | The only renderer of `.fldc` besides `NotifyPrefs`. |
| `Field.jsx` `Row2` | `.row2` has a rule and no user. |
| `Skeleton.jsx` `SkeletonAvatar` | Nine of the ten Skeleton exports are used. |
| `ui/DatePicker.jsx` | Not a defect — it is a 1-line re-export of `PickerDate`, deliberately "the named entry point, not a second implementation". `PickerDate` itself has 1 consumer. |

Sparse but real: `Checkbox` 2, `Popover` 2, `Sheet` 1, `Menu` 3, `Modal` 3,
`Chip` 4, `Toggle` 4. Against `EmptyState` 30, `Button` 23, `ErrorState` 19,
`StatTile` 18.

The check-classes gate reports 610 selectors with no static user, which is the
same phenomenon one layer down and is reported-not-failed by design.

## 7 · Tooltip edge auto-flip

Confirmed open and confirmed unmanifestable. `ui/Tooltip.jsx` takes a static
`position` prop (`top`/`bottom`/`left`/`right`) and `.tip--*` are four fixed
transforms in `components.css:892-895`; there is no measurement against the
viewport, so a tooltip on a control near an edge would render off-screen.

`MOTION-SPEC.md:147` names the flip. **Not implemented here** — with zero call
sites there is no surface on which to verify a flip actually flips, and adding
untested positioning logic to a component nothing renders is the kind of change
that reads as done and is not. It should land with its first real consumer.

Recorded from the same line, per the brief: tooltip dwell is **300ms**
(`MOTION-SPEC.md:53` and `:147`); `02` and `16` carry the defect. `Tooltip.jsx`
already defaults `delay = 300` and has no exit animation, both correct.

## 8 · Also observed, outside my lane

- `--radius-base` is **12px** in the reference `tokens.css:27` and **10px** in
  `styles/kartavaya-design.css:24`. Every `--r-sm`/`--r-md`/`--r-lg` in the build
  is therefore ~17% tighter than the reference. Pixels lane.
- `.sw` is a second 38×22 switch still live alongside `.tgl` (noted in
  `Toggle.jsx:18`), same geometry, two names.
- `.fld__err` has no icon; the reference's `.fldx__err` reserves one
  (`.fldx__err svg { flex: none; margin-top: 1px }`). Pixels lane.
- `styles/brand.css` still exists in `origin/staging` and is imported by no CSS
  or JS — only referenced from two READMEs. Matches the "dead three ways over"
  verdict; the deletion has not reached `staging` yet. Not touched.

## Changes made on this branch

1. `docs` — this report.
2. `fix(field)` — `frontend/src/components/ui/Field.jsx`: the hint no longer
   disappears when an error appears (§3a, rule 2), which also repairs a dangling
   `aria-describedby` IDREF.

Gates after both: `check-classes` 2120 selectors / 1443 classes / **0 missing**,
exit 0. `check-tokens` 340 declared / 234 referenced / **0 missing**, exit 0.
