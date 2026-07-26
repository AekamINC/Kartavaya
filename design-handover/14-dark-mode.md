# 14 · Dark mode

Prereq: `00-tokens.md`. Every token pair is defined there; this file is the rules that make the pairs work and the places they break.

Design source: `tokens.css`, and the dark toggle in every design file.

---

## The mechanism

`data-theme="dark"` on `<html>`, one block of overrides, no per-component dark variants. Any component that needs a `[data-theme="dark"]` rule of its own is a component that hardcoded a colour — the rule is the bug report.

```js
const apply = m => {
  const dark = m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
};
```

`system` is a **live subscription**, not a boot-time read — see `09-customization.md`.

Set the attribute in a blocking inline script in `<head>`, before the stylesheet loads. Applied from React after mount, every dark-mode user gets a white flash on every page load.

```html
<script>try{var p=JSON.parse(localStorage.getItem('k_prefs')||'{}'),m=p.mode||'light';
document.documentElement.setAttribute('data-theme',m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')}catch(e){}</script>
```

Also set `<meta name="color-scheme" content="light dark">` so form controls, scrollbars and the browser chrome follow.

---

## Rules

### 1 · Dark is not inverted light

`--bg` light is `#F3EFE6` (warm paper). Dark is `#0C0E11` — a cool near-black, not `#000`. True black plus bright text causes halation on OLED, and pure black under warm-tinted surfaces reads as a rendering fault.

All values in this file are `00-tokens.md`'s. Where an earlier draft of this file quoted different hexes, `00` is correct and this file was wrong.

Elevation **rises** in dark and **recedes** in light: light surfaces get darker as they lift (shadow does the work), dark surfaces get lighter (`--s-low` → `--s-container` → `--s-high` climb in luminance). A dark card that is darker than its background disappears.

### 2 · Shadows barely work in dark; borders do

The four shadow steps are defined for both palettes in `00-tokens.md` §7–8 — same geometry, black alphas raised from .07/.16/.3/.38 to .5/.6/.8/.9. Do not redeclare them here.

A shadow on a dark surface is nearly invisible even at those alphas. **Elevation in dark comes from the surface step and `--outline-variant`.** Any component that relies only on a shadow to separate from its background needs a border in dark.

### 3 · Semantic colours lighten, containers darken

`--ok`, `--warn`, `--danger` and their containers all flip. **The values are in `00-tokens.md` §7 and §8 — this file does not restate them.**

An earlier draft did, and shipped stale twice: it still carried `--ok: #16803F` and `--warn: #A66207` after §7 darkened them to `#14743A` and `#955806` for contrast. A file that duplicates hexes has to be re-edited every time the palette moves, and it silently will not be.

Every `on-` half exists in both themes, including `--on-ok-container`, `--on-warn-container` and `--on-danger-container`, which were missing entirely until §7 was corrected.

The foreground lightens for contrast against dark; the container darkens. Inverting both keeps neither.

Contrast is measured in `00-tokens.md` §12 and `23-accessibility.md`, **against `--bg`, not `--surface`** — the canvas, not the card that sits on it. Measuring against `--surface` is what let three tokens pass while failing on the page. Do not re-measure here; the numbers move. Light little margin — it is fine for a chip label at 12px+ but should not carry 11px metadata.

### 4 · The accent needs four values

The four accent values per theme are in `00-tokens.md` §6, along with `--primary-text` — the token any primary-coloured *text* uses, because `--primary` itself is 4.04:1 on `--bg` and is a fill, not a text colour.

**Hover reverses direction with the theme.** On light surfaces hover is darker than rest; on dark surfaces it is lighter. A component that hardcodes "hover = darker" is wrong in one of the two modes. This is also why `applyPrefs` must re-run on theme change — see `00-tokens.md` §11.

All twelve presets derive their four values from one stored hex via `deriveAccentColors` (`00-tokens.md` §10, extended with `light` for dark-mode hover). A mid-tone accent that passes on cream fails on `#0C0E11`; a custom accent picked in light mode must be re-derived, not reused.

### 5 · `color-mix` percentages are not theme-portable

```css
background: color-mix(in srgb, var(--primary) 8%, transparent);   /* light: visible tint */
```

8% of a colour over cream reads clearly; 8% over near-black is almost nothing. Tints that carry meaning need a dark override, typically 1.5–2×:

```css
[data-theme="dark"] .tint{background:color-mix(in srgb,var(--primary) 15%,transparent)}
```

This is the most common dark-mode defect in the codebase: a selected row that is obvious in light and invisible in dark.

### 6 · Images and the sidebar

```css
[data-theme="dark"] img:not([data-no-dim]){filter:brightness(.92)}
```

A photo at full brightness on a dark page is a light source. 8% dimming is enough; more and it looks broken. Logos and status icons opt out with `data-no-dim`.

The sidebar uses `rgb(var(--side-ink))` in **both** themes — a dark sidebar beside a cream canvas is the product's signature, not a light-mode artefact. The value still moves: `22, 26, 24` light → `8, 10, 13` dark, so the sidebar stays darker than the canvas in both. In dark mode it needs a hairline `--side-rule` on its right edge or it merges into the page.

### 7 · Two colours are the same in both themes

The WhatsApp read tick `#4FC3F7` (`06-sanvaad-varta.md`) and the platform keyline `#7c5cbf` (`11-platform-admin.md`). Both are recognition cues rather than palette members, and both clear 3:1 on light and dark surfaces alike.

Everything else that used to sit in the "never flips" list — the six status colours, four approval colours and four priority colours — **does** flip. `00-tokens.md` §9 has the pairs, and three of the six statuses now just reuse `--ok`, `--warn` and `--danger`.

---

## What breaks today

Every hardcoded hex found while writing this handover is a dark-mode bug, because none of them have a dark counterpart:

| Where | Values |
|---|---|
| `ui/toast.jsx` | `#05b7aa` `#e53e3e` `#f59e0b` `#0082c6` |
| `BillingPage.jsx` | `#10b981` `#f59e0b` `#6E7B91` `#ef4444` |
| `AdminBillingPage.jsx` | `#10b981` `#f59e0b` `#ef4444` |
| `ApprovalsPage.jsx` | `#f59e0b` `#05b7aa` `#C0392B` |
| `SanvaadPage.jsx` | `StatusBadge` map |
| `CustomizeSettingsPage.jsx` | `#ef4444` ×2, `#fff` on accent swatches |
| task drawer / list | three disagreeing status maps (`03-task-drawer.md`) |

Eight status-colour maps, all light-only. `lib/statusColors.js` reading the §9 tokens replaces all of them — and because three statuses reuse `--ok`/`--warn`/`--danger`, the map is half the size it was.

The retired legacy blue `#0082c6` must not reappear. It was still present in `--st-in-progress`, `--pr-medium` and `--tick-read` until `00-tokens.md` §9 was corrected.

Two structural offenders: `${c}18` hex-alpha concatenation (`10-org-settings.md`) cannot work with a token, and `ts.borderLeft.split(' ')[2]` in `toast.jsx` parses a colour back out of a CSS shorthand string.

`AuthShell.jsx` has its own light/dark pair — `#f4fafd` / `#0a1628` — from the old cold-blue system, so the auth screen is a different dark mode from the app's (`12-auth-onboarding.md`).

`--ease-emph` and `--ease-standard` were the same curve until `00-tokens.md` §5 was corrected; `--ix` was written inline by `applyPrefs`, which defeated the OS reduced-motion query. Both are fixed there, not here.

`mobile/src/theme/tokens.ts` is a third dark mode again (`17-mobile-app.md`).

---

## Verification

Not a design step — a checklist, because dark mode fails silently:

1. Every `[data-theme="dark"]` rule in a component file is a hardcoded colour to remove.
2. Grep for `#[0-9a-f]{3,6}` outside `tokens.css` and `statusColors.js`. Every hit is a candidate bug.
3. Every meaningful `color-mix` tint: check the dark rendering, not just the light.
4. Focus rings: `box-shadow: 0 0 0 3px color-mix(…)` at 16% needs ~24% in dark.
5. Disabled states: `--on-surface-faint` on `--s-high` is the tightest pair in the system in both modes.
6. Screenshot the eight surfaces (shell, drawer, board, table, Sanvaad, Pahchan, settings, admin) in both themes side by side. Differences that aren't luminance are bugs.
