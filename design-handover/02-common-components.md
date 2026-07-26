# 02 · Common components

Prereq: `00-tokens.md`. Motion values in `MOTION-SPEC.md`. This file carries CSS, trees, paths, endpoints and diffs only.

Design source: `app.css` §Buttons–§Form fields, `IxKit.jsx`, `IxOverlays.jsx`.

---

## The finding that governs this whole file

**Staging has two component systems that do not share tokens.**

| System | Files | Styling | Token names |
|---|---|---|---|
| Tailwind | `ui/button.js`, `ui/badge.js`, `ui/input.js`, `ui/select.js`, `ui/FormGroup.jsx`, `ui/modal.jsx`, `ui/Tabs.jsx`, `ui/StatusBar.jsx`, `ui/Tooltip.jsx`, `ui/CommandPalette.jsx`, `views/*` | `cn()` + utility classes | `accent`, `bgDefault`, `bgMuted`, `borderDefault`, `textMuted`, `textSubtle`, `infoBg`, `danger` |
| Editorial | `editorial/*` (12 files) | CSS classes | `k-card`, `k-statuschip`, `k-due`, `k-stat` + CSS custom properties |

They disagree on concrete values:

- `Button` is `rounded-full`; `Input` and `Select` are `rounded-2xl` (16px). **A button and an input side by side have different corner radii** — one is a pill, one is a rounded rectangle.
- `Button` has only `primary` and `ghost`. There is no outline, tonal, text or danger variant, so every destructive action in the app is styled ad hoc at the call site.
- `Badge` exists **twice**: `ui/badge.js` and `editorial/ModuleUI.jsx`. Different tones, different markup, same name, both exported.
- The Devanagari font is `var(--font-devanagari)` in `FormGroup.jsx` and `--font-hindi` elsewhere in the redesign. Pick one — the redesign uses **`--font-indic`** on any label that follows the user's language, and `--font-hindi` only on fixed decorative Devanagari (watermarks). See `24-bilingual-devanagari.md`.

**Target: one system.** Everything becomes CSS classes on custom properties, `ui/*.js` Tailwind primitives are deleted, and `editorial/*` is renamed and absorbed. Do not migrate half — a page that mixes the two is how the radius mismatch got shipped.

---

## 1 · Exact CSS

### Button

```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 15px;border-radius:var(--r-sm);font-size:13px;font-weight:600;white-space:nowrap;transition:background var(--dur-fast),color var(--dur-fast),border-color var(--dur-fast),transform var(--dur-fast) var(--ease-spring)}
.btn:active{transform:scale(.975)}
.btn:disabled{opacity:.42;pointer-events:none}
.btn--fill{background:var(--primary);color:var(--on-primary)}
.btn--fill:hover{background:var(--primary-hover)}
.btn--tonal{background:var(--primary-container);color:var(--on-primary-container)}
.btn--tonal:hover{background:color-mix(in srgb,var(--primary-container) 78%,var(--primary))}
.btn--out{border:1px solid var(--outline);color:var(--on-surface-2)}
.btn--out:hover{background:var(--s-container);color:var(--on-surface)}
.btn--text{color:var(--primary);padding:8px 10px}
.btn--text:hover{background:var(--primary-container)}
.btn--ghost{background:transparent;color:var(--on-surface-2)}
.btn--ghost:hover{background:var(--s-container);color:var(--on-surface)}
.btn--ghost:active{background:var(--s-high)}
.btn--danger{border:1px solid color-mix(in srgb,var(--danger) 40%,var(--outline-variant));color:var(--danger)}
.btn--danger:hover{background:var(--danger-container)}
.btn--sm{padding:6px 11px;font-size:12.5px}
.btn--lg{padding:11px 20px;font-size:14px}
```

Seven variants, three sizes. `--danger` is **outline, not filled** — a filled red button reads as the primary action on the screen, which a destructive action never is. The one exception is a confirmed delete inside a dialog the user already opened deliberately.

`:active` is `scale(.975)`, not a color change. Under `anim: none` the transform is suppressed by `--motion-scale` (see `16-animations.md`) and the hover colour carries the feedback.

### Input, select, field

```css
.fld{display:flex;flex-direction:column;gap:6px;min-width:0}
.fld__l{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--on-surface-3)}
.inp{width:100%;padding:10px 12px;background:var(--s-low);border:1px solid var(--outline-variant);border-radius:var(--r-sm);font-size:var(--t-body-sm);outline:none;transition:border-color var(--dur-fast),box-shadow var(--dur-fast),background var(--dur-fast)}
.inp:focus{border-color:var(--primary);background:var(--s-lowest);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 16%,transparent)}
.inp::placeholder{color:var(--on-surface-faint)}
select.inp{appearance:none;padding-right:30px;background-repeat:no-repeat;background-position:right 11px center;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%2374786F' d='M0 0h10L5 6z'/></svg>")}
/* dark mode: the fill is baked into the URI, so restate it with the dark ink */
[data-theme="dark"] select.inp{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%23A9AEA3' d='M0 0h10L5 6z'/></svg>")}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
```

**The focus ring is a 3px `box-shadow`, not `outline`** — `outline` can't take a radius on all engines and clips against overflow parents. Same radius as the field (`--r-sm`) so the ring follows the corner. Filled-tonal field (`--s-low` → `--s-lowest` on focus) is the M3 half of the fusion; the macOS half is the 1px hairline border.

### Card

```css
.card{background:var(--surface);border:1px solid var(--outline-variant);border-radius:var(--r-md);box-shadow:var(--shadow-1)}
.card--flat{background:var(--s-low);border-color:transparent}
.card--glass{background:rgba(var(--glass-tint),var(--glass-alpha));backdrop-filter:blur(var(--glass-blur));border-color:color-mix(in srgb,var(--outline-variant) 60%,transparent)}
.card__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:var(--pad-card) var(--pad-card) calc(var(--pad-card) * .7)}
.card__title{display:inline;font-family:var(--font-display);font-size:var(--t-title-lg);font-weight:var(--t-title-lg-w);letter-spacing:-.01em;line-height:1.4}
.card__hi{display:inline;margin-left:9px;font-family:var(--font-indic);font-size:14px;color:var(--primary)}
.card__body{padding:0 var(--pad-card) var(--pad-card)}
.card__body--flush{padding:0}
```

`.card__title` and `.card__hi` are both `display:inline` inside a `block` `.card__titles` — so the Hindi sits on the **same baseline** as the English and wraps with it rather than forming a second line. Staging's `k-card__titles` is a flex column, which stacks them. The inline treatment is deliberate: the Hindi is an apposition, not a subtitle.

### Chip, tag, status

```css
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:var(--r-sm);border:1px solid var(--outline-variant);font-size:12.5px;font-weight:500;color:var(--on-surface-2)}
.chip:hover{background:var(--s-container)}
.chip.on{background:var(--secondary-container);color:var(--on-secondary-container);border-color:transparent}
.chip__dot{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.tag{--c:var(--on-surface-3);display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:var(--r-pill);font-size:10.5px;font-weight:700;letter-spacing:.04em;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
```

`.tag` takes its colour from an inline `--c`, so one class covers every semantic tone without a variant per colour. **`--c` must be a real colour, not a token that may not exist** — `color-mix()` with an undefined variable voids the whole declaration silently and the tag loses its pill. `--info` is not a token in this system; the semantic set is `--ok`, `--warn`, `--danger` only.

### Status colours — keep, but repaint two

`editorial/StatusChip.jsx` carries the real map, and its precedence is correct: **active or decided approval state wins over column, column wins over raw status.** Keep that order.

| Key | Staging hex | Action |
|---|---|---|
| `todo` | `#94a3b8` | keep |
| `in_progress` | `#0082c6` | **→ `#3E5C8A`** light / `#8FAEDC` dark |
| `in_review` | `#a78bfa` | keep |
| `done` | `#05b7aa` | **→ `#2E6B49`** light / `#6FBF8F` dark |
| `requested` | `#f59e0b` | keep |
| `pending` | `#f59e0b` | keep |
| `pending_client` | `#8b5cf6` | keep |
| `approved` | `#05b7aa` | **→ `#2E6B49`** light / `#6FBF8F` dark (same as `done`) |
| `rejected` | `#ef4444` | keep |

Status colour must stay independent of the user's accent (`MOTION-SPEC.md` §colour by meaning) — but `done` currently *is* the default accent, so on a teal-accented workspace a done chip and an accent chip are the same colour.

```js
// ui/statusColors.js
// Read the tokens; do not restate hexes. Three of the six ARE --ok / --warn /
// --danger, so they inherit any contrast fix made in 00 §7. An earlier draft of
// this file hardcoded the old values and drifted from 00 within one batch.
export const STATUS_COLORS = {
  todo:        'var(--st-todo)',
  in_progress: 'var(--st-in-progress)',
  in_review:   'var(--st-in-review)',
  requested:   'var(--st-requested)',   // = --warn
  done:        'var(--st-done)',        // = --ok
  rejected:    'var(--st-rejected)',    // = --danger
};
export const APPROVAL_COLORS = {
  pending:        'var(--ap-pending)',
  pending_client: 'var(--ap-pending-client)',
  approved:       'var(--ap-approved)',
  rejected:       'var(--ap-rejected)',
};
export const PRIORITY_COLORS = {
  urgent: 'var(--pr-urgent)', high: 'var(--pr-high)',
  medium: 'var(--pr-medium)', low: 'var(--pr-low)',
};

/* The old hardcoded map, for reference only — do not ship:
  todo:           { light: '#94a3b8', dark: '#9CA3AE' },
  in_progress:    { light: '#3E5C8A', dark: '#8FAEDC' },
  in_review:      { light: '#a78bfa', dark: '#C4B0FF' },
  done:           { light: '#2E6B49', dark: '#6FBF8F' },
  requested:      { light: '#f59e0b', dark: '#F5BF4F' },
  pending:        { light: '#f59e0b', dark: '#F5BF4F' },
  pending_client: { light: '#8b5cf6', dark: '#B39BFF' },
  approved:       { light: '#2E6B49', dark: '#6FBF8F' },
  rejected:       { light: '#ef4444', dark: '#FF8A80' },
};
```

**The rule that keeps status readable against any accent is chroma, not hue.** Every status colour is desaturated — `#3E5C8A` is HSL 216°/38%/39%, `#2E6B49` is 147°/40%/30% — while every accent preset except Slate is saturated above 60%. A status chip and an accent chip can share a hue family and still be told apart, because the accent is always the more vivid one.

Contrast, measured against the cream surface `#FAF7F0` (the chip paints `--c` text on a 14% tint of itself, so the effective background is near-surface): `#3E5C8A` → 6.4:1, `#2E6B49` → 6.0:1. Both clear AA for normal text at the chip's 10.5px. The dark variants measure 7.4:1 and 7.7:1 against `--bg` dark.

**One residual collision, stated plainly:** the Slate accent preset `#64748b` is 215°/16%/47° — the same hue family as `in_progress` at 216°, and also low-chroma. On a Slate-accented workspace those two are closer than any other pair. They remain distinguishable (16% vs 38% saturation, and Slate is lighter), but if a user complains it is this pair. The fix, if needed, is to move `in_progress` to 205° rather than to re-saturate it.

### DueChip — the logic is right, keep it verbatim

`editorial/DueChip.jsx` is the most carefully-reasoned component in staging. Its rules, for the record:

| Condition | Output | Tone |
|---|---|---|
| no date | `—` | muted |
| `diff < 0` | `{n}d overdue` | danger |
| `diff === 0` | `Today, {time}` | warn |
| `diff === 1` | `Tomorrow, {time}` | warn |
| `diff < 7` | `In {n}d, {time}` | normal |
| else | `02 Aug, {time}` | muted |
| done + on time | `✓ Done {rel}` | done |
| done + late, same calendar day | `✓ Done {rel}` | done |
| done + late by ≥1 day | `✓ Done · {n}d late` | danger |
| done + no due date | *renders nothing* | — |

Two details worth preserving because they are easy to "simplify" wrongly: the time suffix appears **only when the ISO string has a time component** (`hasTimeComponent`), so an all-day task doesn't claim a spurious 00:00; and completing after the due *time* but on the due *day* counts as on time, which is the humane reading.

Only change: `k-due--*` → `.due--*`.

---

## 2 · Component trees

```
ui/Button.jsx        fill tonal out text ghost danger · sm md lg
ui/Field.jsx         Field · Input · Select · Textarea · Checkbox · Radio · Switch
ui/Card.jsx          Card · CardHead · CardBody
ui/Chip.jsx          Chip · ChipRow
ui/Tag.jsx           takes --c
ui/StatusChip.jsx    ← editorial/StatusChip.jsx, map extracted to statusColors.js
ui/DueChip.jsx       ← editorial/DueChip.jsx, logic untouched
ui/Avatar.jsx        Avatar · AvatarStack
ui/Menu.jsx          trigger + portal + roving tabindex
ui/Tooltip.jsx       delay-in 400ms, delay-out 0
ui/Popover.jsx
ui/Modal.jsx         Modal · ModalHead · ModalBody · ModalFoot
ui/ConfirmDialog.jsx danger · warn · neutral intents
ui/Sheet.jsx         bottom sheet, mobile
ui/Toast.jsx         ToastHost + useToast()
ui/Table.jsx         Table · Head · Row · Cell · sort · resize · bulk
ui/EmptyState.jsx
ui/Skeleton.jsx      line · block · circle · per-page presets
ui/Tabs.jsx
ui/Stepper.jsx
ui/DatePicker.jsx
ui/CommandPalette.jsx
```

`statusColors.js` is shared by StatusChip, Kanban, Table and the mobile app. One map, one import — staging has the same nine states written out in `drawer/constants.js` *and* `editorial/StatusChip.jsx`.

---

## 3 · New files

```
frontend/src/components/ui/Button.jsx      replaces button.js
frontend/src/components/ui/Field.jsx       replaces input.js + select.js + FormGroup.jsx
frontend/src/components/ui/Tag.jsx         replaces badge.js
frontend/src/components/ui/Card.jsx        ← editorial/Card.jsx
frontend/src/components/ui/Avatar.jsx      ← editorial/AvatarStack.jsx
frontend/src/components/ui/Menu.jsx        new — no menu primitive exists
frontend/src/components/ui/Popover.jsx     new
frontend/src/components/ui/Sheet.jsx       new
frontend/src/components/ui/Stepper.jsx     new
frontend/src/components/ui/DatePicker.jsx  new — currently a bare <input type="date">
frontend/src/components/ui/statusColors.js new — single source
frontend/src/styles/components.css         the CSS above
```

---

## 4 · Endpoints

None. These are presentational. Two touch data indirectly:

| Component | Data |
|---|---|
| `Avatar` | `user.avatar_url`, falls back to initials from `full_name` — the existing `.split(' ').map(w=>w[0]).slice(0,2)` is fine, keep it |
| `CommandPalette` | `GET /v1/search?q=` for records; static commands from `ui/commands.js` |

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `ui/button.js` | 834 | **Delete.** Replaced by `Button.jsx`. Two variants → seven; `rounded-full` → `--r-sm` |
| `ui/badge.js` | 640 | **Delete.** → `Tag.jsx`. Resolves the duplicate-`Badge` collision with `ModuleUI.jsx` |
| `ui/input.js` | 424 | **Delete.** → `Field.jsx`. `rounded-2xl` → `--r-sm`; `focus:ring-2` → the 3px box-shadow |
| `ui/select.js` | 611 | **Delete.** → `Field.jsx`, with the SVG chevron and `appearance:none` |
| `ui/FormGroup.jsx` | 1,664 | Rewrite as `Field.jsx`. Keep the `sanskrit`, `required`, `hint`, `error`, `span` props — that API is good. Fix `--font-devanagari` → `--font-indic` |
| `ui/modal.jsx` | 2,151 | De-Tailwind. Keep `open`/`onClose`; add `ModalFoot` and focus trap |
| `ui/ConfirmDialog.jsx` | 4,021 | De-Tailwind. Add `intent` (danger/warn/neutral) and require a typed confirmation for irreversible actions |
| `ui/Tabs.jsx` | 2,380 | De-Tailwind. Add the sliding indicator |
| `ui/Tooltip.jsx` | 1,513 | De-Tailwind. Add 400ms in / 0ms out |
| `ui/StatusBar.jsx` | 2,082 | De-Tailwind |
| `ui/EmptyState.jsx` | 6,346 | Keep structure, restyle |
| `ui/Skeleton.jsx` | 5,370 | Keep, add per-page presets (list, board, table, chat) |
| `ui/CommandPalette.jsx` | 5,828 | Keep behaviour; move `COMMANDS` out of `Topbar.jsx` into `ui/commands.js` |
| `ui/Breadcrumbs.jsx` | 1,653 | Fold into `Topbar` — see `01-navigation.md` |
| `ui/ButtonBox.jsx` | 1,021 | **Delete** — superseded by `.btn` variants |
| `ui/ColorTag.jsx` | 2,512 | Fold into `Tag.jsx` via `--c` |
| `editorial/Card.jsx` | 771 | → `ui/Card.jsx`. `k-card*` → `.card*`; titles become inline, not a flex column |
| `editorial/StatusChip.jsx` | 1,848 | → `ui/StatusChip.jsx`. Map → `statusColors.js`; repaint `in_progress`, `done`, `approved` |
| `editorial/DueChip.jsx` | 2,714 | → `ui/DueChip.jsx`. **Logic unchanged.** Class rename only |
| `editorial/StatTile.jsx` | 445 | → `ui/StatTile.jsx`. `variant="blue"` default is legacy naming — variants become semantic (`neutral`/`ok`/`warn`/`danger`) |
| `editorial/index.js` | 692 | Barrel moves to `ui/index.js`; the `ModuleUI` re-exports (`TabBar`, `Section`, `Badge`, `Shimmer`, `Empty`, `BackButton`, `ModCard`, `DataTable`, `Td`) are absorbed into the named primitives |
| `lib/utils.js` `cn()` | — | Retire once the last Tailwind class is gone. Until then it stays — a half-migrated `cn()` removal breaks every unconverted file |
| `tailwind.config.js` | — | The custom token names (`accent`, `bgMuted`, `textSubtle`, `infoBg`…) can go with it |

### Order of migration

`Button` → `Field` → `Card` → `Tag`/`StatusChip`/`DueChip` → overlays → tables. Buttons and fields appear on every screen, so converting them first makes the mismatch visible early instead of at the end.


---

## Revision · Error states and the offline banner

Folded in from what was going to be a separate file. `Skeleton.jsx` above already covers loading, so the real gap is the four **failure** states and the offline case. They belong beside the primitives because every page consumes them.

### Four states, not one "Something went wrong"

A single generic error tells the user nothing and gives them nothing to do. These four are distinguishable at the point of failure and each has exactly one correct action:

| State | Cause | Copy | Action |
|---|---|---|---|
| `offline` | `navigator.onLine === false`, or fetch rejected with no response | "You're offline. Changes are saved and will sync." | none — it resolves itself |
| `server` | 5xx | "Something broke on our side, not yours." | Try again |
| `denied` | 403 | "You don't have access to this." + which grant is missing | Request access |
| `missing` | 404 | "This doesn't exist, or it was deleted." | Back to <parent> |

```jsx
export function ErrorState({ kind, detail, onRetry, backTo }) { … }

export function errorKind(err) {
  if (!navigator.onLine || !err?.response) return 'offline';
  const s = err.response.status;
  return s === 403 ? 'denied' : s === 404 ? 'missing' : s >= 500 ? 'server' : 'server';
}
```

`!err?.response` before checking status is the important line: an axios rejection with no `response` is a network failure, and reporting it as a server error blames us for the user's train tunnel.

**`denied` must name the missing grant** — "You need viewer access to Ganit" — and offer to request it. `08-rbac-screens.md` covers the degradation study; the rule from it applies here: a denial that does not say what is missing teaches the user that the product is arbitrary. It must **not** reveal whether the record exists. "You don't have access to invoice INV-1043" confirms INV-1043 exists to someone who should not know that; the detail names the *grant*, never the *record*.

```css
.k-err{display:flex;flex-direction:column;align-items:center;gap:var(--sp-3);padding:var(--sp-8) var(--sp-5);text-align:center;max-width:42ch;margin:0 auto}
.k-err__ic{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--s-container);color:var(--on-surface-3)}
.k-err[data-kind="denied"] .k-err__ic{background:var(--warn-container);color:var(--warn)}
.k-err[data-kind="server"] .k-err__ic{background:var(--danger-container);color:var(--danger)}
.k-err__t{font-family:var(--font-display);font-size:var(--t-title-lg);font-weight:400;letter-spacing:-.02em;color:var(--on-surface)}
.k-err__d{font-size:var(--t-body-sm);line-height:var(--line-height-base);color:var(--on-surface-3);text-wrap:pretty}
```

`offline` and `missing` get the neutral icon treatment. Only `server` is red — a 404 on a deleted task is not an alarm, and colouring it like one trains users to ignore red.

Error states need `role="alert"` so a screen reader announces them, per `23-accessibility.md`. A page that silently swaps content for an error is invisible to anyone not watching.

### Offline banner

```jsx
export function OfflineBanner() {
  const [off, setOff] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOff(false), down = () => setOff(true);
    window.addEventListener('online', on); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', down); };
  }, []);
  if (!off) return null;
  return <div className="k-offline" role="status">You're offline — changes are saved locally and will sync.</div>;
}
```

```css
.k-offline{position:sticky;top:0;z-index:60;padding:7px var(--pad-page);background:var(--warn-container);color:var(--warn);font-size:var(--t-label);font-weight:500;text-align:center}
```

**Sticky, not fixed.** A fixed banner overlays the top bar and hides the thing the user was about to click — the same defect class as the document tenant switcher in `18-documents.md`.

`role="status"`, not `role="alert"`: going offline is information, not an interruption, and `alert` cuts off whatever the screen reader was reading.

The copy claims changes are saved, so **that claim must be true before this ships**. `17-mobile-app.md` documents the existing offline mutation queue (`offline/mutationQueue.ts`); web has no equivalent. Either wire the same queue on web or change the copy to "You're offline — changes may not save." A false reassurance about unsaved work is the worst possible thing to be wrong about.

## `Badge` produces an invalid colour — fix before any new call site

`components/editorial/ModuleUI.jsx`:

```jsx
<span className="k-badge" style={{ background: `${c}18`, color: c }}>{text}</span>
```

The `${c}18` hex-alpha suffix worked when `statusColors.js` held hexes. It now holds custom-property references, so this evaluates to `"var(--st-done)18"` — not a colour, silently dropped. **Every `Badge` fed from a status map renders with no background today**, including all six order states in `VikrayPage.jsx`.

`statusColors.js` anticipated this and exports the fix:

```js
export const mixAlpha = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
```

Two changes, not one. `background: mixAlpha(c, 10)`, **and** the text must not be the same hue as its tint — see `00-tokens.md`, "a token may sit behind text only if it has a declared `on-` partner". `StatusChip` already models the correct pattern: `style={{'--c': s.color}}` with a separate `.k-statuschip__dot`, so the colour identifies without carrying the text.

**Prefer `StatusChip` over `Badge`.** `Badge` remains only for text that is not a status.

### Two empty states, neither ready

| | |
|---|---|
| `ModuleUI.Empty` | Emoji default (`📋`). Used across module pages. The design system has no emoji |
| `ui/EmptyState.jsx` | Eight real SVG illustrations, bilingual `{en, hi}` titles, proper CTA — but still on Tailwind classes (`text-textDefault`, `cn`, `text-textMuted`) from the retired system |

Port `EmptyState` onto tokens and delete `ModuleUI.Empty`. Until then, new screens use `EmptyState`.

**A filtered list reaching zero is not the same state as a list with nothing in it.** One is a finished queue and should read as an accomplishment; the other is an absence. Reusing one component with one string for both tells a user who just finished their work that something is missing. `07-pahchan.md` has the worked example.
