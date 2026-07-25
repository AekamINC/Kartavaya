# 09 · Customization hub

Prereq: `00-tokens.md`, `02-common-components.md`. Every preference key, its values, and how it is applied are in `SETTINGS-ADMIN-SPEC.md` §A — not repeated here.

Design source: `SetCustomize.jsx`, `settings.css`.

Staging source: `pages/CustomizeSettingsPage.jsx` (9,350 bytes), `pages/NotificationsSettingsPage.jsx` (8,932 bytes), `components/CustomizePanel.jsx`.

---

## What's wrong today

### The `--font-ui` bug (restated because it is the reason this page exists)

`applyPrefs` in `CustomizePanel.jsx` branches on `SANS_IDS.has(prefs.font)` and sets `--font-ui` to the **display** font in both arms. Choose Newsreader and every label, table cell, chip and button in the product becomes serif. Full fix in `SETTINGS-ADMIN-SPEC.md`.

### `PageHeader` is called with three different prop names

```jsx
<PageHeader title="Customize" sanskrit="सजावट" lede="…" />          CustomizeSettingsPage
<PageHeader title="Messages" sans="संवाद" subtitle="…" />           SanvaadPage
<PageHeader title="Billing & Subscription" subtitle="…" />          BillingPage
```

`sanskrit` vs `sans`, `lede` vs `subtitle`. At most one pair is the real signature, so **at least one of these pages is silently dropping its subtitle and its Devanagari**. Settle the contract in `components/editorial.jsx` and fix all call sites; a prop that renders nothing is worse than a missing prop because nothing complains.

### Accent labels are 8px white text on the swatch

```jsx
<span style={{ fontSize: 8, fontWeight: 800, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.4)' }}>{a.label}</span>
```

8px is below any legibility floor, and white-on-saffron (`#f59e0b`) fails contrast badly even with the shadow. The label moves **below** the swatch at 11px in `--on-surface-2`.

### The font picker is a `<select>`

So all nine display fonts render in the system UI font. Picking a typeface from a list that doesn't show typefaces is guesswork — this is the whole reason the design specifies per-row specimens.

### The typography preview is one hardcoded line

`fontWeight: 500` on a `--font-display` span plus a pangram. It can't show the UI font, line height, or how a heading sits above body text — the four things the tab actually controls.

### Everything else missing

No System theme mode (Light/Dark only) · 4 accents, not 12 · no sidebar-background choice · no UI font · no line height · no radius · no animation preference · notifications live on a separate page · no data/privacy tab · `#ef4444` hardcoded twice for the reset button instead of `--danger`.

---

## 1 · Exact CSS

### Hub shell and tabs

```css
.st{max-width:920px}
.st__tabs{display:flex;gap:2px;overflow-x:auto;border-bottom:1px solid var(--outline-variant);margin-bottom:22px;scrollbar-width:none}
.st__tabs::-webkit-scrollbar{display:none}
.st__tb{position:relative;padding:10px 15px;font-size:13px;font-weight:500;color:var(--on-surface-3);white-space:nowrap;flex-shrink:0}
.st__tb.on{color:var(--on-surface);font-weight:600}
.st__tb.on::after{content:'';position:absolute;left:12px;right:12px;bottom:-1px;height:2px;border-radius:1px 1px 0 0;background:var(--primary)}
```

920px max width. Settings forms read badly at full desktop width — a 1,600px row with a label at the left edge and a control at the right edge makes the pair hard to associate.

### Setting row

```css
.sr{display:flex;align-items:center;gap:18px;padding:15px 0;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 60%,transparent)}
.sr:last-child{border-bottom:0}
.sr__l{flex:1;min-width:0}
.sr__t{font-size:13.5px;font-weight:500}
.sr__d{font-size:12px;color:var(--on-surface-3);line-height:1.5;margin-top:2px;text-wrap:pretty}
.sr__c{flex-shrink:0}
.sr--col{flex-direction:column;align-items:stretch;gap:11px}
```

### Segmented control

```css
.seg{display:inline-flex;padding:3px;border-radius:var(--r-pill);background:var(--s-container)}
.seg__b{padding:6px 14px;border-radius:var(--r-pill);font-size:12.5px;font-weight:500;color:var(--on-surface-3);white-space:nowrap;transition:background var(--dur-fast),color var(--dur-fast)}
.seg__b.on{background:var(--surface);color:var(--on-surface);font-weight:600;box-shadow:var(--shadow-1)}
```

### Accent grid — 12 presets + custom

```css
.acc{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:9px}
.acc__c{position:relative;display:flex;flex-direction:column;gap:6px;padding:5px;border-radius:var(--r-sm);border:1px solid transparent;transition:border-color var(--dur-fast),background var(--dur-fast)}
.acc__c:hover{background:var(--s-container)}
.acc__c.on{border-color:var(--on-surface);background:var(--s-container)}
.acc__sw{height:30px;border-radius:var(--r-sm);background:linear-gradient(135deg,var(--d),var(--m) 55%,var(--c))}
.acc__n{font-size:11px;color:var(--on-surface-2);text-align:center}
.acc__new{position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--ok)}
.acc__cust .acc__sw{background:conic-gradient(from 210deg,#E4572E,#F2A65A,#04837A,#3E5C8A,#7C5CBF,#E4572E)}
```

`--c`, `--m`, `--d` are set inline per cell from `deriveAccentColors(hex)`. Only the base hex is stored; mid and deep are derived, so a custom colour behaves exactly like a preset.

### Live accent preview

```css
.accpv{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:15px;padding:14px;border-radius:var(--r-md);background:var(--s-low);border:1px solid var(--outline-variant)}
.accpv__side{width:74px;height:52px;border-radius:var(--r-sm);background:rgb(var(--side-ink));padding:6px;display:flex;flex-direction:column;gap:3px;flex-shrink:0}
.accpv__side i{height:5px;border-radius:2px;background:rgba(255,255,255,.16)}
.accpv__side i.on{background:var(--primary)}
.accpv__meter{flex:1;min-width:80px;height:6px;border-radius:3px;background:var(--s-high);overflow:hidden}
.accpv__meter b{display:block;height:100%;width:62%;background:var(--primary)}
```

Shows a filled button, a tonal button, an outline button, a link, a status tag, a selected chip, a progress meter and a sidebar thumbnail — **every place the accent actually lands**. A row of bare swatches tells you nothing about whether a colour works as a button label background.

### Sidebar background variants

```css
.sbg{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.sbg__c{padding:9px;border-radius:var(--r-md);border:1px solid var(--outline-variant);background:var(--surface);transition:border-color var(--dur-fast)}
.sbg__c.on{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary)}
.sbg__pv{height:62px;border-radius:var(--r-sm);padding:7px;display:flex;flex-direction:column;gap:4px;overflow:hidden}
.sbg__pv--dark{background:rgb(var(--side-ink))}
.sbg__pv--light{background:var(--s-container);border:1px solid var(--outline-variant)}
.sbg__pv--accent{background:linear-gradient(160deg,var(--primary-vivid),var(--primary))}
.sbg__n{font-size:11.5px;text-align:center;margin-top:7px;color:var(--on-surface-2)}
```

Applied via `data-sidebar-bg` on `<html>` — the three rule sets are in `SETTINGS-ADMIN-SPEC.md`. The light variant must also flip `.side__item.on` to `--primary-container` and the wordmark to `--on-surface`, or the active item disappears.

### Font rows with specimens

```css
.fnt{display:flex;flex-direction:column;gap:3px}
.fnt__r{display:flex;align-items:center;gap:13px;padding:9px 11px;border-radius:var(--r-sm);border:1px solid transparent;text-align:left;transition:background var(--dur-fast),border-color var(--dur-fast)}
.fnt__r:hover{background:var(--s-container)}
.fnt__r.on{border-color:var(--primary);background:var(--primary-container)}
.fnt__aa{width:34px;flex-shrink:0;font-size:21px;line-height:1;text-align:center;font-family:var(--f)}
.fnt__n{font-size:14px;font-family:var(--f)}
.fnt__d{font-size:11px;color:var(--on-surface-3);margin-top:1px}
```

`--f` is set inline per row to that font's stack, so **the row is rendered in the font it offers** — both the `Aa` specimen and the name.

This only works if the families are already loaded. Import all nine display and six UI families in `index.html`; lazy-loading them means every row falls back to the system font on first paint, which is exactly the failure this replaces.

### Type preview card

```css
.tpv{padding:19px;border-radius:var(--r-md);border:1px solid var(--outline-variant);background:var(--surface)}
.tpv h4{font-family:var(--pv-d);font-size:calc(var(--pv-fs) * 1.62);font-weight:400;letter-spacing:-.024em;margin:0 0 8px;line-height:1.2}
.tpv p{font-family:var(--pv-u);font-size:var(--pv-fs);line-height:var(--pv-lh);color:var(--on-surface-2);margin:0 0 13px;text-wrap:pretty}
.tpv__b{font-family:var(--pv-u);font-size:calc(var(--pv-fs) * .93);font-weight:600;padding:8px 15px;border-radius:var(--r-sm);background:var(--primary);color:var(--on-primary)}
```

Four variables on the card — `--pv-d`, `--pv-u`, `--pv-fs`, `--pv-lh` — so the preview updates from state without re-rendering anything, and shows a heading, body copy and a button together. That relationship is what a type choice is actually about.

### Sound cards

```css
.snd{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:9px}
.snd__c{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:var(--r-md);border:1px solid var(--outline-variant);background:var(--surface);text-align:left;transition:border-color var(--dur-fast),background var(--dur-fast)}
.snd__c.on{border-color:var(--primary);background:var(--primary-container)}
.snd__w{display:flex;align-items:flex-end;gap:2px;height:17px;flex-shrink:0}
.snd__w i{width:2.5px;border-radius:1px;background:var(--primary);opacity:.5}
.snd__c.on .snd__w i{opacity:1;animation:sndW .8s var(--ease-standard) infinite alternate}
@keyframes sndW{from{transform:scaleY(.45)}to{transform:scaleY(1)}}
```

**Tapping the card selects it and plays it.** A separate play button doubles the number of targets for no benefit — nobody wants to preview a sound they aren't considering.

Bars stagger via `animation-delay` per index. Under `prefers-reduced-motion` they hold static.

### Session rows and danger zone

```css
.sess{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--outline-variant)}
.sess__ic{width:32px;height:32px;border-radius:var(--r-sm);background:var(--s-container);display:grid;place-items:center;color:var(--on-surface-3);flex-shrink:0}
.sess__cur{font-size:10px;font-weight:700;padding:2px 7px;border-radius:var(--r-pill);background:var(--ok-container);color:var(--ok);letter-spacing:.06em}
.dz{padding:17px 19px;border-radius:var(--r-md);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);background:color-mix(in srgb,var(--danger) 5%,transparent)}
.dz__t{font-size:13.5px;font-weight:600;color:var(--danger)}
```

---

## 2 · Component tree

```
CustomizeHub                             pages/CustomizeSettingsPage.jsx
├── PageHeader  (fix the prop contract)
├── Tabs  appearance · typography · layout · language · notifications · data
├── TabAppearance
│   ├── ModeSeg          Light · Dark · System
│   ├── AccentGrid       12 presets + custom → AccentPreview
│   └── SidebarBgCards   dark · light · accent
├── TabTypography
│   ├── FontList         display, 9, own-typeface rows
│   ├── FontList         UI, 6
│   ├── SizeSlider · LineHeightSeg
│   └── TypePreview
├── TabLayout            sidebar · density · radius · animations
├── TabLanguage          6 options
├── TabNotifications
│   ├── PushToggle       permission-aware
│   ├── SoundGrid        tap = select + play
│   ├── ToastPosition · EmailToggles · DndSchedule · TimeFormatSeg
└── TabData
    ├── ExportRequest · SessionList · DangerZone
```

---

## 3 · New files

```
frontend/src/pages/customize/TabAppearance.jsx
frontend/src/pages/customize/TabTypography.jsx
frontend/src/pages/customize/TabLayout.jsx
frontend/src/pages/customize/TabLanguage.jsx
frontend/src/pages/customize/TabNotifications.jsx
frontend/src/pages/customize/TabData.jsx
frontend/src/components/customize/AccentGrid.jsx
frontend/src/components/customize/AccentPreview.jsx
frontend/src/components/customize/SidebarBgCards.jsx
frontend/src/components/customize/FontList.jsx
frontend/src/components/customize/TypePreview.jsx
frontend/src/components/customize/SoundGrid.jsx
frontend/src/lib/notifSounds.js          OscillatorNode tones, no audio files
frontend/src/lib/timeFormat.js           single source for 12h/24h
frontend/src/styles/settings.css
```

`lib/notifSounds.js` synthesises each tone with `OscillatorNode` — gain ramp to `.16` over 12ms, exponential decay to `.0001` over 420ms. Ten sounds with no binary assets and no network request per preview.

---

## 4 · Endpoints

| Endpoint | Notes |
|---|---|
| `GET/PATCH /v1/me/preferences` | the whole `k_prefs` object. Keep writing localStorage first so the UI never waits on the network, then sync |
| `GET /v1/me/sessions` | device, ip, location, last_seen, `current: bool` |
| `DELETE /v1/me/sessions/:id` · `DELETE /v1/me/sessions` | sign out one / all others |
| `POST /v1/me/export` | async; emails a link valid 7 days |
| `POST /v1/me/delete` | queued, not immediate |

New table `user_preferences`. Preferences must be **local-first**: applying a theme should never show a spinner.

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `pages/CustomizeSettingsPage.jsx` | 9,350 | Becomes the tab shell. All controls move to `customize/*`. Replace the `<select>` font picker, the 8px swatch labels, and the two `#ef4444` literals |
| `pages/NotificationsSettingsPage.jsx` | 8,932 | **Deleted.** Route redirects to `/settings/customize?tab=notifications` |
| `components/CustomizePanel.jsx` | — | `ACCENTS` 4 → 12. `DEFAULTS` gains `uiFont`, `lineHeight`, `radius`, `anim`, `sideBg`, `toastPos`, `dnd`, `dndFrom`, `dndTo`. **Fix `--font-ui`.** Delete `SANS_IDS`. Split `FONTS` into `DISPLAY_FONTS` and `UI_FONTS`. `mode: 'system'` needs a `matchMedia` subscription, not a one-time read |
| `components/editorial.jsx` | — | Settle `PageHeader`'s prop names and fix every call site |
| `components/ui/toast.jsx` | 3,553 | Position from `toastPos` instead of fixed `right: 20, top: 20`; tokens instead of the four legacy hexes |
| `index.html` | — | Import all 9 display + 6 UI families up front |
| `styles/editorial.css` | — | `--radius-base` drives every `--r-*`; `--motion-scale` multiplies every duration; `--line-height-base` |

### One thing to decide

`mode: 'system'` is a live subscription, not a value. If the OS flips to dark at sunset while the app is open, the app must follow without a reload — so the `matchMedia` listener has to stay attached for the session and `data-theme` must be recomputed on change. Getting this half-right (read once at boot) is worse than not offering the option, because the user will conclude the setting is broken.
