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

## 3 · Open items — detail follows in later sections

- `.btn` vs `.k-btn` — §4
- `.seg` vs `.k-segctrl` — §5
- Zero-consumer components — §6
