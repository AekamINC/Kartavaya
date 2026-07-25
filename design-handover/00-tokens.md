# Design Tokens

## Prerequisites
- None — do this first. Every other file depends on it.

## Files to modify
- `frontend/src/styles/kartavaya-design.css` — replace the token block wholesale
- `frontend/src/styles/dark-theme.css` — **delete**; dark now lives in the `[data-theme="dark"]` block below
- `frontend/src/styles/editorial.css` — remove any hard-coded hex; all colour references become `var(--*)`
- `frontend/src/components/CustomizePanel.jsx` — `applyPrefs` writes the runtime overrides listed at the end

## Files to create
- None

## Estimated scope
- 3 stylesheets rewritten, 1 deleted, 1 component updated. No new components.

---

## 1 · Runtime-tunable roots

These five are set by the user in Customization and written to `documentElement` by `applyPrefs`. Everything else derives from them.

```css
:root {
  --radius-base: 10px;   /* user: 4 | 10 | 20 — default IS one of the options */
  --glass-mix: .6;       /* user: 0 → 1 */
  --font-size-base: 14px;/* user: 12 → 20 */
  --line-height-base: 1.5; /* user: 1.3 | 1.5 | 1.7 */
  --ix-user: 1;          /* motion scale: 1 | .5 (reduced) | .001 (none) */
  --ix: var(--ix-user);  /* never written directly — see §5 */
}
```

`--radius-base` defaults to **10px**, not 12px. 12 is not one of the three options, so a fresh install showed no segment selected in the Border radius control — a default must always be a selectable value.

## 2 · Type

```css
:root {
  --font-display: "Newsreader", Georgia, serif;        /* user-swappable, 9 options */
  --font-ui: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; /* user-swappable, 6 options */
  --font-hindi: "Tiro Devanagari Hindi", "Noto Serif Devanagari", "Nirmala UI", "Kohinoor Devanagari", serif;
  --font-indic: var(--font-hindi);   /* → "Noto Sans Gujarati", "Shruti", sans-serif when language is gu | en+gu */
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

  /* Derived from --font-size-base, so the Text size slider moves the whole
     scale. Absolute px made the slider a no-op on everything but raw body copy. */
  --t-display:   calc(var(--font-size-base) * 2.86);  /* 40px at base 14 */
  --t-headline:  calc(var(--font-size-base) * 2);     /* 28px */
  --t-title-lg:  calc(var(--font-size-base) * 1.43);  /* 20px */
  --t-title:     calc(var(--font-size-base) * 1.14);  /* 16px */
  --t-body:      var(--font-size-base);               /* 14px */
  --t-body-sm:   calc(var(--font-size-base) * .93);   /* 13px */
  --t-label:     max(11.5px, calc(var(--font-size-base) * .86)); /* 12px */
  --t-label-sm:  max(11px,   calc(var(--font-size-base) * .79)); /* 11px */

  --t-display-w: 400;  --t-headline-w: 400;  --t-title-lg-w: 500;
  --t-title-w: 500;    --t-body-w: 400;      --t-label-w: 500;
}
```

The `max()` floors on the two label sizes enforce §12 mechanically: at base 12 an unclamped `--t-label-sm` would compute to 9.5px, below the readable minimum. The floors mean the slider can shrink body copy without taking metadata below 11px.

`--line-height-base` applies to body and label text. Display sizes set their own tighter leading (1.06–1.22) because a 1.7 line-height on a 40px heading is a layout, not a preference.

**`--font-display` and `--font-ui` are independent.** Current `applyPrefs` sets `--font-ui` to the display font in *both* arms of its own `SANS_IDS` check, so picking Newsreader turns every label, table cell and button serif. Fix:

```js
const dsp = DISPLAY_FONTS.find(f => f.id === prefs.font)  || DISPLAY_FONTS[0];
const ui  = UI_FONTS.find(f => f.id === prefs.uiFont)     || UI_FONTS[0];
root.style.setProperty('--font-display', dsp.value);
root.style.setProperty('--font-ui', ui.value);
document.body.style.fontFamily = 'var(--font-ui)';
// delete SANS_IDS entirely
```

Headings use `--font-display` at weight 400–500 with negative tracking (`-.02em` to `-.034em`). Body, labels, buttons and table cells use `--font-ui`. Numbers in tables and money use `--font-mono` with `font-variant-numeric: tabular-nums`.

## 3 · Radius — all derived

```css
:root {
  --r-xs:   calc(var(--radius-base) * 0.34);  /* 3.4px at base 10 */
  --r-sm:   calc(var(--radius-base) * 0.58);  /* 5.8px */
  --r-md:   var(--radius-base);               /*  10px */
  --r-lg:   calc(var(--radius-base) * 1.45);  /* 14.5px */
  --r-xl:   calc(var(--radius-base) * 2.1);   /*  21px */
  --r-pill: 999px;
}
```

Never hard-code a radius. A literal `border-radius: 8px` breaks the Sharp and Pill settings in exactly that one place.

## 4 · Density and spacing

```css
:root {
  --row-h: 44px;  --pad-page: 28px;  --pad-card: 18px;
  --gap-section: 22px;  --gap-tight: 10px;
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-7: 32px;  --sp-8: 44px;
}
[data-density="compact"] { --row-h: 38px; --pad-page: 16px; --pad-card: 14px; --gap-section: 16px; --gap-tight: 8px; }
[data-density="comfy"]   { --row-h: 48px; --pad-page: 32px; --pad-card: 20px; --gap-section: 26px; --gap-tight: 12px; }
```

## 5 · Motion

```css
:root {
  --dur-instant: calc( 90ms * var(--ix));
  --dur-fast:    calc(140ms * var(--ix));
  --dur-base:    calc(220ms * var(--ix));
  --dur-slow:    calc(360ms * var(--ix));
  --dur-xslow:   calc(520ms * var(--ix));

  --ease-standard:  cubic-bezier(.2, 0, 0, 1);      /* M3 standard */
  --ease-emph:      cubic-bezier(.16, 1, .3, 1);    /* dramatic settle — drawers, sheets */
  --ease-enter:     cubic-bezier(0, 0, .2, 1);
  --ease-exit:      cubic-bezier(.4, 0, 1, 1);
  --ease-emph-in:   cubic-bezier(.05, .7, .1, 1);
  --ease-emph-out:  cubic-bezier(.3, 0, .8, .15);
  --ease-spring:    cubic-bezier(.34, 1.36, .64, 1);
  --ease-spring-soft: cubic-bezier(.32, 1.14, .68, 1);
}
@media (prefers-reduced-motion: reduce) { :root { --ix: .001 } }
```

`--ease-standard` and `--ease-emph` were previously the identical curve — two names for `cubic-bezier(.2, 0, 0, 1)`. M3's emphasized easing has no single-cubic form, so `--ease-emph` is now an expo-out, which is genuinely more dramatic. Standard for state changes, emphasized for anything that enters or leaves the screen.

### The OS setting must win

`applyPrefs` writes **`--ix-user`**, never `--ix`. An inline style on `documentElement` beats a media query in the cascade, so writing `--ix` directly meant a user with reduce-motion enabled at OS level still got full animation — the preference silently overrode an accessibility setting.

```css
:root { --ix-user: 1; --ix: var(--ix-user) }
@media (prefers-reduced-motion: reduce) { :root { --ix: .001 } }
```

The media query overrides `--ix` regardless of the stored preference, and because it is a media query it re-evaluates live when the OS setting changes mid-session. A user cannot opt *into* more motion than their OS allows, which is correct — an accessibility setting is not an app preference.

The one deliberate exception is the catalogue's slow-motion review mode, which writes `--ix` inline precisely because it needs to override everything. That is a review tool, not a shipped surface.

Declaring durations as multiples of `--ix` is what lets Animations = Reduced/None work with no per-component code. See `16-animations.md`.

## 6 · Translucency

```css
:root {
  --glass-blur:  calc(22px * var(--glass-mix));
  --glass-sat:   calc(1 + .5 * var(--glass-mix));
  --glass-alpha: calc(1 - (.28 * var(--glass-mix)));
}
```

Applied as `background: rgba(var(--glass-tint), var(--glass-alpha))` plus `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat))`. Always ship the `-webkit-` prefix too.

**Windows gets no glass.** `[data-platform="win"]` replaces every glass background with `var(--s-low)` — see `01-navigation.md`.

## 7 · Light palette

```css
:root, [data-theme="light"] {
  --bg:         #F3EFE6;
  --s-lowest:   #FFFEFB;
  --surface:    #FAF7F0;
  --s-low:      #F5F1E7;
  --s-container:#EEE9DC;
  --s-high:     #E7E1D1;
  --s-highest:  #DFD8C5;

  --on-surface:        #1B1D1A;
  --on-surface-2:      #4A4E48;
  --on-surface-3:      #666A61;   /* was #74786F — 3.9:1 on --bg, failed AA */
  --on-surface-faint:  #9DA096;

  --outline-variant: #D8D1BE;
  --outline:         #ADA692;

  --primary:              #04837A;
  --primary-hover:        #026B64;
  --on-primary:           #FFFFFF;
  --primary-container:    #B4F1E8;
  --on-primary-container: #00201D;
  --primary-vivid:        #05b7aa;

  --secondary:              #5C6450;
  --secondary-container:    #E1E7D4;
  --on-secondary-container: #1A2013;
  --tertiary:               #8A5730;
  --tertiary-container:     #FFDCC3;
  --on-tertiary-container:  #301A07;

  --ok:     #14743A;  --ok-container:     #C6EFD2;   /* was #16803F — 4.4:1 on --bg */
  --warn:   #955806;  --warn-container:   #FBE3BE;   /* was #A66207 — 4.2:1 on --bg */
  --danger: #B42318;  --danger-container: #FBDAD5;

  --scrim:      rgba(28, 26, 20, .34);
  --glass-tint: 250, 247, 240;
  --shadow-1:   0 1px 2px rgba(30, 28, 22, .07);
  --shadow-2:   0 4px 16px -6px rgba(30, 28, 22, .16);
  --shadow-3:   0 18px 44px -18px rgba(30, 28, 22, .3);
  --shadow-4:   0 32px 72px -28px rgba(30, 28, 22, .38);

  --side-ink:      22, 26, 24;
  --side-fg:       rgba(255, 255, 255, .8);
  --side-fg-mute:  rgba(255, 255, 255, .5);
  --side-fg-faint: rgba(255, 255, 255, .28);
  --side-rule:     rgba(255, 255, 255, .1);
  --side-hover:    rgba(255, 255, 255, .08);
}
```

## 8 · Dark palette

```css
[data-theme="dark"] {
  --bg:         #0C0E11;
  --s-lowest:   #080A0C;
  --surface:    #12151A;
  --s-low:      #171B21;
  --s-container:#1D2229;
  --s-high:     #252B33;
  --s-highest:  #2E353E;

  --on-surface:       #E9E7E1;
  --on-surface-2:     #BFBDB6;
  --on-surface-3:     #8E8D87;
  --on-surface-faint: #64645F;

  --outline-variant: #333A43;
  --outline:         #5B626C;

  --primary:              #4FD8CB;
  --primary-hover:        #6FE6DA;
  --on-primary:           #00332F;
  --primary-container:    #00514B;
  --on-primary-container: #74F5E8;
  --primary-vivid:        #05b7aa;

  --secondary:              #C3CBB0;
  --secondary-container:    #434A36;
  --on-secondary-container: #DFE7CB;
  --tertiary:               #F0BB90;
  --tertiary-container:     #6A3F1A;
  --on-tertiary-container:  #FFDCC3;

  --ok:     #5BD98A;  --ok-container:     #14432A;
  --warn:   #E8B45C;  --warn-container:   #4A3312;
  --danger: #F2867A;  --danger-container: #55201B;

  --scrim:      rgba(0, 0, 0, .58);
  --glass-tint: 18, 21, 26;
  --shadow-1:   0 1px 2px rgba(0, 0, 0, .5);
  --shadow-2:   0 4px 16px -6px rgba(0, 0, 0, .6);
  --shadow-3:   0 18px 44px -18px rgba(0, 0, 0, .8);
  --shadow-4:   0 32px 72px -28px rgba(0, 0, 0, .9);

  --side-ink:      8, 10, 13;
  --side-fg:       rgba(255, 255, 255, .78);
  --side-fg-mute:  rgba(255, 255, 255, .46);
  --side-fg-faint: rgba(255, 255, 255, .24);
  --side-rule:     rgba(255, 255, 255, .08);
  --side-hover:    rgba(255, 255, 255, .07);
}
```

Note that dark **inverts the primary relationship**: `--primary` becomes the light mint `#4FD8CB` on dark surfaces, and `--primary-container` becomes the *dark* `#00514B`. Any component that assumes container is lighter than primary will break. See `14-dark-mode.md`.

## 9 · Status, approval and priority colour

**These flip with the theme.** The earlier version of this section said they must not — that was wrong, and it contradicted `02-common-components.md`, which had already specced light and dark values for `in_progress`.

The *meaning* is constant; the *rendering* cannot be. A single hex has to be legible on `#FAF7F0` and on `#12151A`, and no mid-tone does both — the old `#16a34a` is 4.0:1 on dark, and the old `#0082c6` is 3.5:1, which fails. `--ok` and `--danger` in §7/§8 already flip for exactly this reason; status colour is the same kind of token and gets the same treatment.

Three of the six statuses are not new colours at all — they reuse the semantic tokens, which removes three of the eight competing colour maps outright:

```css
:root, [data-theme="light"] {
  --st-todo:        #5A6270;
  --st-in-progress: #3E5C8A;
  --st-in-review:   #6E5AA0;
  --st-requested:   var(--warn);     /* #A66207 */
  --st-done:        var(--ok);       /* #16803F */
  --st-rejected:    var(--danger);   /* #B42318 */

  --ap-pending:        var(--warn);
  --ap-pending-client: #6E5AA0;      /* waiting on someone outside the org */
  --ap-approved:       var(--ok);
  --ap-rejected:       var(--danger);

  --pr-urgent: var(--danger);
  --pr-high:   var(--warn);
  --pr-medium: #3E5C8A;
  --pr-low:    var(--on-surface-3);   /* inherits the darkening above */
}
[data-theme="dark"] {
  --st-todo:        #9AA3B2;
  --st-in-progress: #8FAEDC;
  --st-in-review:   #B6A6E0;
  --ap-pending-client: #B6A6E0;
  --pr-medium:      #8FAEDC;
  /* requested / done / rejected / urgent / high / low follow --warn, --ok,
     --danger and --on-surface-3, which already flip in §8 */
}
```

**The retired legacy blue `#0082c6` is gone from all three places it had reappeared** — `--st-in-progress`, `--pr-medium` and `--tick-read`. `01-navigation.md` retired it; reinstating it here was a straight regression.

### Separation is by chroma, not hue

Every status sits at 38–42% saturation. Every accent preset except Slate is above 60%. That is what keeps a status chip from reading as an accent when a user picks Blue or Emerald — the hues do collide, the intensities don't.

The one residual collision is Slate accent `#64748b` against `--st-in-progress`. If it ever bites, move `in_progress` to 205° rather than saturating it.

`--pr-medium` shares its blue with `--st-in-progress` deliberately — priority renders as a 6px dot, status as a chip with a label, and inventing a seventh hue costs more than it buys.

### The genuinely fixed literals

These do not flip, because they encode something external to our palette:

```css
--pf-primary:      #6B4FBF;   /* platform admin, light */
--pf-primary-dark: #C0A9F5;   /* platform admin, dark  */
--pf-keyline:      #7c5cbf;   /* the admin stripe — same in both */
--ink-fixed:       #23262B;   /* tooltip and lightbox chrome */
--ink-fixed-dark:  #E9E7E1;
--tick-read:       #4FC3F7;   /* WhatsApp read tick */
--wa-green:        #1FA855;   /* WhatsApp brand */
```

**The read tick is `#4FC3F7`, not `#0082c6`.** It is WhatsApp's own blue and users read it from muscle memory — that recognition is the entire value of the colour, so matching it exactly matters more than palette harmony. `#0082c6` was the retired brand blue and appeared here only because I conflated two unrelated blues. `#4FC3F7` also clears 3:1 on both the light and dark outgoing bubble, which `#0082c6` does not.

## 10 · Accent — 12 presets + custom

Only `color` is stored per preset. `mid` and `deep` derive, so a custom hex behaves identically to a preset.

```js
export const ACCENTS = [
  { id:'teal',    label:'Teal',    color:'#05b7aa' },  // shipped
  { id:'blue',    label:'Blue',    color:'#3b82f6' },  // shipped
  { id:'saffro',  label:'Saffron', color:'#f59e0b' },  // shipped
  { id:'indigo',  label:'Indigo',  color:'#6366f1' },  // shipped
  { id:'rose',    label:'Rose',    color:'#e11d63' },
  { id:'emerald', label:'Emerald', color:'#059669' },
  { id:'amber',   label:'Amber',   color:'#d97706' },
  { id:'violet',  label:'Violet',  color:'#7c3aed' },
  { id:'coral',   label:'Coral',   color:'#f2643c' },
  { id:'slate',   label:'Slate',   color:'#64748b' },
  { id:'crimson', label:'Crimson', color:'#be123c' },
  { id:'forest',  label:'Forest',  color:'#3f6212' },
];
// deriveAccentColors(hex) — extended with `light`, needed for dark-mode hover
// mid   = hsl(h, min(s+5,100),  max(l-10,10))
// deep  = hsl(h, min(s+10,100), max(l-20,10))
// light = hsl(h, s,             min(l+12,92))   // NEW
```

A custom hex behaves identically to a preset because all four values derive from the one stored colour. A custom accent picked in light mode is re-derived on theme change, not reused — see §11.

## 11 · What `applyPrefs` writes at runtime

```js
root.style.setProperty('--k-primary', acc.color);
root.style.setProperty('--k-mid',     acc.mid);
root.style.setProperty('--k-deep',    acc.deep);
root.style.setProperty('--k-grad',    \`linear-gradient(135deg, \${acc.deep}, \${acc.mid} 55%, \${acc.color})\`);
root.style.setProperty('--side-active', \`\${acc.color}29\`);
// Hover must be a STEP AWAY FROM THE PAGE, which reverses by theme:
// light surfaces → hover darker; dark surfaces → hover lighter.
// The previous version wrote mid as --primary and color as --primary-hover in
// both themes, so in light mode hover was lighter than rest — the inverse of
// the static block, and of every other interactive state in the system.
const dark = root.dataset.theme === 'dark';
root.style.setProperty('--primary',       dark ? acc.color : acc.mid);
root.style.setProperty('--primary-hover', dark ? acc.light : acc.deep);
root.style.setProperty('--primary-vivid', acc.color);
root.style.setProperty('--font-display', dsp.value);
root.style.setProperty('--font-ui',      ui.value);
root.style.setProperty('--radius-base',  prefs.radius + 'px');
root.style.setProperty('--font-size-base', fs + 'px');
root.style.setProperty('--line-height-base', prefs.lineHeight);
root.style.setProperty('--ix-user', prefs.anim === 'none' ? '.001' : prefs.anim === 'reduced' ? '.5' : '1');
// --ix-user, NOT --ix. Writing --ix inline defeats the OS reduced-motion
// media query, because an inline style outranks it. See §5.
root.style.setProperty('--font-indic',
  (prefs.language === 'gu' || prefs.language === 'en+gu')
    ? "'Noto Sans Gujarati', sans-serif" : 'var(--font-hindi)');

root.dataset.theme       = prefs.mode === 'system' ? systemPrefersDark() ? 'dark' : 'light' : prefs.mode;
root.dataset.density     = prefs.density;
root.dataset.sidebar     = prefs.sidebar;
root.dataset.sidebarBg   = prefs.sideBg;
root.dataset.language    = prefs.language;
root.dataset.toastPos    = prefs.toastPos;
```

**Delete** the block in current `applyPrefs` that sets `--bg`, `--surface`, `--ink` etc. per theme in JS. Those belong in CSS under `[data-theme]`, or the two definitions drift.

`mode: 'system'` needs a live subscription:

```js
const mq = window.matchMedia('(prefers-color-scheme: dark)');
mq.addEventListener('change', () => { if (prefs.mode === 'system') applyPrefs(prefs); });
```

Because the `--primary` / `--primary-hover` pair above is theme-dependent, `applyPrefs` **must re-run on every theme change**, not only on preference change. The `system`-mode listener already does this; a manual light/dark toggle must call it too, or the accent keeps its previous theme's hover direction.

## 12 · Contrast floors

**Measured against `--bg`, not `--surface`.** `--bg` is where the page paints; `--surface` is a card on top of it and is always the more forgiving of the two. An earlier version of this table used `--surface` and passed three tokens that fail on the canvas.

Light — `--bg` `#F3EFE6`, `--surface` `#FAF7F0`:

| Token | on `--bg` | on `--surface` | Verdict |
|---|---|---|---|
| `--on-surface` | 14.7:1 | 13.9:1 | pass |
| `--on-surface-2` | 7.4:1 | 7.2:1 | pass |
| `--on-surface-3` `#666A61` | **4.8:1** | 5.2:1 | pass — was 3.9:1 at `#74786F` |
| `--on-surface-faint` | 2.3:1 | 2.4:1 | **non-text only** |
| `--ok` `#14743A` | **5.1:1** | 5.5:1 | pass — was 4.4:1 at `#16803F` |
| `--warn` `#955806` | **4.9:1** | 5.3:1 | pass — was 4.2:1 at `#A66207` |
| `--danger` `#B42318` | 5.8:1 | 6.2:1 | pass |
| `--on-primary` on `--primary` | — | 5.1:1 | pass |

Dark — `--bg` `#0C0E11`:

| Token | on `--bg` |
|---|---|
| `--on-surface` | 15.7:1 |
| `--ok` `#5BD98A` | 10.8:1 |
| `--warn` `#E8B45C` | 10.3:1 |
| `--danger` `#F2867A` | 7.8:1 |

Dark mode has generous margins throughout; every failure in this system was in light mode, on the canvas rather than on cards.

Three tokens were darkened as a result: `--on-surface-3`, `--ok` and `--warn`. `--on-surface-3` mattered most — it carries metadata on every screen, and at `#74786F` it was the lowest-contrast text in the product that users were expected to read.

Because `--st-done`, `--st-rejected`, `--st-requested`, `--ap-*` and `--pr-*` alias these tokens (§9), they all inherit the fix. That is the argument for aliasing rather than restating hexes.

Minimum type sizes: 11px for metadata, 12.5px for anything a decision depends on. Table cells never below 11.5px. `23-accessibility.md` states what each ratio *permits*, which is the part a table of numbers does not convey.
