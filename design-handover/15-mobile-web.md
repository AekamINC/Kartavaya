# 15 · Mobile web adaptations

Prereq: `00-tokens.md`, `01-navigation.md`. This is the **responsive web app** in a phone browser — the React Native app is `17-mobile-app.md`. They are different targets and must not share a spec.

Design source: the mobile surface toggle in every design file; `app.css` breakpoints.

---

## Breakpoints

```css
/* ≥1280  full: sidebar + content + optional drawer side-by-side */
/* 1024–1279  drawer overlays instead of splitting */
/* 768–1023   sidebar → overlay drawer; content full width */
/* ≤767       phone: bottom nav, sheets, single column */
```

Three, not five. Every additional breakpoint is another combination nobody tests.

The 1023px line is where the sidebar leaves the flow. **It must gain a burger in the same commit** — this project shipped three separate regressions where a nav was hidden by width with no replacement (`.side`, `.adm__side`, `.ob--m`), each leaving a surface with no way out. The rule, from `MOTION-SPEC.md`: *never hide a nav by width without shipping its replacement.*

```css
@media(max-width:1023px){
  .kv>.side{position:fixed;inset:0 auto 0 0;z-index:70;width:288px;transform:translateX(-100%);transition:transform var(--dur-base) var(--ease-emph)}
  .kv>.side.open{transform:none;box-shadow:var(--shadow-4)}
  .topbar__burger{display:grid}
}
```

Note `.kv > .side` — the direct-child selector. A bare `.side { display: none }` also hides the copy rendered *inside* the mobile overlay, which is how the hamburger came to open a grey scrim over nothing.

---

## Phone rules

### Hit targets

44px minimum, no exceptions. Icon buttons in the top bar and row menus are the usual offenders — a 28px `⋯` that works with a mouse is a miss with a thumb.

```css
@media(max-width:767px){
  .icon-btn{min-width:44px;min-height:44px}
  .row__menu{min-width:44px;min-height:44px}
}
```

### Drawer becomes a sheet

```css
@media(max-width:767px){
  .drawer{inset:auto 0 0 0;width:auto;max-height:92vh;border-radius:var(--r-lg) var(--r-lg) 0 0;transform:translateY(100%)}
  .drawer.open{transform:none}
  .drawer__grab{display:block;width:36px;height:4px;border-radius:2px;background:var(--outline);margin:9px auto 0}
}
```

Bottom sheet with a grab handle, dismissible by swipe-down as well as the close button. A 480px side drawer on a 393px screen is a full-screen modal with a 1px sliver of context — worse than a sheet, because it looks like it should be dismissible by tapping beside it and there is nowhere to tap.

### Tables scroll; they do not reflow

```css
@media(max-width:767px){
  .tb__wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .tb{min-width:640px}
  .tb th:first-child,.tb td:first-child{position:sticky;left:0;background:var(--surface);z-index:1}
}
```

Card-per-row conversions lose column alignment, which is the only reason a table exists. Keep the table, freeze the first column, let it scroll — and give the scroll region a visible edge fade so it is discoverable.

### Kanban pages columns

One column at a time, scroll-snapped, with tab pills above:

```css
@media(max-width:767px){
  .kb{overflow-x:auto;scroll-snap-type:x mandatory;gap:11px}
  .kb__col{min-width:calc(100vw - 44px);scroll-snap-align:center}
}
```

### Bottom nav

```css
@media(max-width:767px){
  .btmnav{position:fixed;inset:auto 0 0;z-index:60;display:grid;grid-auto-flow:column;height:calc(56px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:rgba(var(--glass-tint),.92);backdrop-filter:blur(18px);border-top:1px solid var(--outline-variant)}
  .kv__main{padding-bottom:calc(56px + env(safe-area-inset-bottom) + 12px)}
}
```

`env(safe-area-inset-bottom)` on both the nav and the content padding. Miss the second and the last row of every list sits under the nav bar permanently.

Five items maximum, matching the app: Today · Tasks · ＋ · Messages · More.

### Type and forms

Body text never below 15px on a phone — and **inputs never below 16px**, because iOS Safari zooms the viewport on focus for anything smaller, and the page never fully zooms back.

```css
@media(max-width:767px){input,textarea,select{font-size:16px}}
```

`100vh` is unreliable on mobile Safari (it excludes the collapsing toolbar). Use `100dvh` with a `100vh` fallback:

```css
.full{height:100vh;height:100dvh}
```

### Hover has no mobile equivalent

Every hover-revealed action needs a persistent alternative. The message hover tray (`06-sanvaad-varta.md`) becomes long-press; the table row menu becomes an always-visible `⋯`; the card hover pill becomes part of the row. A feature reachable only by hover does not exist on a phone.

```css
@media(hover:hover){.row__act{opacity:0}.row:hover .row__act{opacity:1}}
@media(hover:none){.row__act{opacity:1}}
```

Gate on `hover: hover`, not on width — a touchscreen laptop is wide and has no hover.

---

## What changes

| File | Change |
|---|---|
| `components/layout/Sidebar.jsx` | Overlay drawer ≤1023px with the burger, using `.kv > .side` scoping |
| `components/layout/TopBar.jsx` | Burger; nowrap on status groups so `+91 22 4890 1122` keeps its dot |
| `components/layout/BottomNav.jsx` | **New** — 5 items, safe-area aware |
| `components/TaskDrawer.jsx` | Sheet ≤767px, grab handle, swipe-down |
| `components/ui/Table.jsx` | Scroll wrapper, sticky first column, edge fade |
| `pages/ProjectBoardPage.jsx` | Column paging with snap |
| `pages/SanvaadPage.jsx` | List and chat become separate views, not a split |
| `styles/editorial.css` | The three breakpoints; 16px input floor; `100dvh` |
| `index.html` | `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` — `viewport-fit=cover` is required for `env(safe-area-inset-*)` to resolve |

---

## Mobile web vs. the app

Same product, different constraints. Where they diverge, say so rather than pretending parity:

| | Mobile web | App (`17-mobile-app.md`) |
|---|---|---|
| Pahchan face capture | Selfie upload + GPS; no reliable camera API parity | Full `expo-camera` capture |
| Push | Web Push where supported; not on iOS Safari without an installed PWA | Native, reliable |
| Offline | Read-only cache at best | Real mutation queue, 72h punch retention |
| Gestures | Swipe on messages and rows; nothing depth-based | Full swipe actions, long-press, haptics |
| Install | Browser tab | App Store / Play |

Pahchan is the honest gap: **the web version cannot do face matching properly**, and the screen should say so and offer the app rather than degrade quietly into a worse punch.
