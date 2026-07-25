# 01 · Navigation

Prereq: `00-tokens.md`. Behaviour rules live in `MOTION-SPEC.md` (§durations, §nav) and `RBAC-SPEC.md` (§who sees what). This file carries CSS, trees, paths, endpoints and diffs only.

Design source: `Chrome.jsx` (`Sidebar`, `Topbar`), `SetAdmin.jsx` (`AdminSide`), `app.css` §Shell + §Sidebar, `mobile.css` §nav.

---

## 1 · Exact CSS

### Shell

```css
.kv{display:grid;grid-template-columns:auto 1fr;height:100%;width:100%;overflow:hidden;background:var(--bg);position:relative}
.kv__main{display:flex;flex-direction:column;min-width:0;min-height:0}
.kv__content{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--pad-page);scroll-behavior:smooth}
.kv__content::-webkit-scrollbar{width:11px}
.kv__content::-webkit-scrollbar-track{background:transparent}
.kv__content::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--on-surface-3) 34%,transparent);border:3px solid transparent;background-clip:padding-box;border-radius:var(--r-pill)}
```

`grid-template-columns: auto 1fr` — the sidebar sizes itself, the main column takes the rest. Do **not** set an explicit first column; rail collapse then needs no shell change.

### Sidebar

| Property | Wide | Rail |
|---|---|---|
| width | `252px` | `72px` |
| brand padding | `16px 14px` | `16px 0`, centered |
| item padding | `9px 11px` | `11px 0`, centered |
| item margin | `1px 8px` | same |
| item width | `calc(100% - 16px)` | same |
| section padding | `14px 18px 5px` | `12px 0 6px` |
| labels, badges | shown | `display:none` |
| active marker | shown | `display:none` |

```css
.side{width:252px;flex-shrink:0;display:flex;flex-direction:column;height:100%;position:relative;overflow:hidden;color:var(--side-fg);background:rgba(var(--side-ink),var(--glass-alpha));backdrop-filter:blur(30px) saturate(1.8)}
[data-platform="win"] .side{background:rgb(var(--side-ink))}  /* intentional — see note */
.side--rail{width:72px}
```

**The Windows override is intentional.** `backdrop-filter` on a large, always-visible surface is unreliable on Windows — it renders inconsistently across GPU/driver combinations, and where it does work it composites nothing like the OS's own acrylic, so the sidebar ends up looking like a wrong guess at a native effect rather than a deliberate one. Windows gets the flat ink; macOS gets vibrancy. Set `data-platform` from `navigator.userAgentData?.platform` (falling back to `navigator.platform`) once, at boot.

```css
.side__sec{display:flex;align-items:baseline;gap:8px;padding:14px 18px 5px;font-size:8.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--side-fg-faint);font-weight:700}
.side__sec-hi{font-family:var(--font-indic);font-size:11px;letter-spacing:0;text-transform:none;margin-left:auto}
.side__item{display:flex;align-items:center;gap:11px;width:calc(100% - 16px);margin:1px 8px;padding:9px 11px;border-radius:var(--r-sm);color:var(--side-fg);font-size:13.5px;position:relative}
.side__item:hover{background:var(--side-hover);color:#fff}
.side__item.on{background:color-mix(in srgb,var(--primary-vivid) 20%,transparent);color:#fff}
.side__item.on::before{content:'';position:absolute;left:-8px;top:22%;bottom:22%;width:3px;border-radius:0 3px 3px 0;background:var(--primary-vivid)}
.side__ic{display:inline-flex;flex-shrink:0;opacity:.8}
.side__item.on .side__ic{opacity:1;color:var(--primary)}
.side__en{font-size:13.5px;font-weight:500;letter-spacing:-.005em}
.side__hi{font-family:var(--font-indic);font-size:10px;line-height:1.5;color:var(--side-fg-mute)}
.side__item.on .side__hi{color:rgba(255,255,255,.62)}
.side__badge{margin-left:auto;background:color-mix(in srgb,var(--primary-vivid) 26%,transparent);color:var(--primary);font-size:10px;font-weight:700;padding:1px 7px;border-radius:var(--r-pill)}
.side__foot{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid var(--side-rule)}
```

Two decorative blooms, both `pointer-events:none` by virtue of being pseudo-elements, both under `.side > * { position:relative; z-index:1 }`:

```css
.side::before{inset:-60px -80px auto auto;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--primary-vivid) 18%,transparent),transparent 70%)}
.side::after{inset:auto auto -70px -50px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--tertiary) 16%,transparent),transparent 70%)}
```

**English is the primary label, Hindi is the sub-label** — `.side__en` at 13.5px, `.side__hi` at 10px in `--side-fg-mute`. This matches staging's existing hierarchy; the redesign restyles the pair but does not invert it. DOM order is English then Hindi, so the reading order matches the visual weight.

One typographic caveat: Devanagari at a given px renders optically smaller than Latin, because its conjuncts and matras subdivide the same em. If 10px proves too tight in testing, raise `.side__hi` to 11px and leave `.side__en` alone — the contrast in weight and case is doing the hierarchy work, not the 3.5px gap.

### Sidebar background variants

Driven by `data-sidebar-bg` on `<html>` (see `09-customization.md` for the control):

```css
[data-sidebar-bg="light"] .side{background:var(--s-container);--side-fg:var(--on-surface-2);--side-fg-mute:var(--on-surface-3);--side-rule:var(--outline-variant);--side-hover:var(--s-high)}
[data-sidebar-bg="light"] .side__item.on{background:var(--primary-container);color:var(--on-primary-container)}
[data-sidebar-bg="light"] .side__item:hover{color:var(--on-surface)}
[data-sidebar-bg="accent"] .side{background:linear-gradient(160deg,var(--k-mid),var(--k-primary));--side-fg:rgba(255,255,255,.86);--side-rule:rgba(255,255,255,.16)}
```

The light variant must re-point `--side-fg`, `--side-fg-mute`, `--side-rule`, `--side-hover` **and** override `.side__item.on` and `:hover`, which both hardcode `#fff`. Miss the last two and active items go white-on-cream.

### Topbar

```css
.top{display:flex;align-items:center;gap:14px;padding:0 var(--pad-page);height:54px;flex-shrink:0;border-bottom:1px solid var(--outline-variant);background:rgba(var(--glass-tint),.72);backdrop-filter:blur(18px) saturate(1.6)}
.crumb{display:flex;align-items:baseline;gap:8px;white-space:nowrap}
.crumb__hi{font-family:var(--font-indic);font-size:14px;color:var(--primary)}
.crumb__sep{color:var(--on-surface-faint)}
.crumb__cur{font-size:13.5px;font-weight:600}
.top__search{flex:1;max-width:420px;display:flex;align-items:center;gap:8px;padding:6px 11px;border-radius:var(--r-pill);background:var(--s-container);border:1px solid transparent;cursor:pointer}
.top__search:hover{border-color:var(--outline-variant)}
.kbd{font-family:var(--font-mono);font-size:10.5px;padding:2px 5px;border-radius:4px;background:var(--surface);border:1px solid var(--outline-variant);color:var(--on-surface-3);margin-left:auto}
```

Search is a **button that opens the palette**, not an input. Staging already does this but renders a `readOnly` `<input value="">`, which puts a focusable, uneditable text field in the tab order for no reason. Use a `<button>`.

### Admin surface

Full values in `11-admin-platform.md`. The nav-relevant part:

```css
.adm{--primary:#6B4FBF;--primary-vivid:#7c5cbf}
[data-theme="dark"] .adm{--primary:#C0A9F5}
.adm__side{width:236px;background:rgb(var(--side-ink));box-shadow:inset 3px 0 0 #7c5cbf}
.adm__back{font-size:11.5px;color:var(--side-fg-mute);padding:13px 15px 9px}
.adm__item.on{background:color-mix(in srgb,#7c5cbf 28%,transparent);box-shadow:inset 3px 0 0 #C0A9F5}
.adm__count{background:color-mix(in srgb,#7c5cbf 34%,transparent)}
```

Admin is a **different surface, not a page** — it replaces the sidebar and owns the window. The violet is not the user's accent and must not be derived from it: an operator looking at another company's data should never see their own theme.

### Mobile bottom nav

```css
.mnav{display:flex;padding:6px 4px calc(6px + var(--m-safe-b,0px));border-top:1px solid var(--outline-variant);background:rgba(var(--glass-tint),.94);backdrop-filter:blur(20px)}
.mnav__i{flex:1;min-height:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:9.5px;color:var(--on-surface-3)}
.mnav__i.on{color:var(--primary)}
.mnav__fab{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-vivid));color:var(--on-primary)}
```

Five slots: **Today · Tasks · ＋ · Messages · More**. `min-height:48px` on every slot; the FAB is 44px inside a 48px row. Never below 44.

---

## 2 · Component trees

```
AppShell                                    layout/AppShell.jsx
├── Sidebar          rail | wide | overlay  layout/Sidebar.jsx
│   ├── SideBrand                           layout/SideBrand.jsx
│   ├── nav → NAV group[] → NavItem         layout/navConfig.js
│   └── SideFoot     avatar · name · role · sign-out
├── main
│   ├── Topbar                              layout/Topbar.jsx
│   │   ├── Crumb
│   │   ├── SearchTrigger → CommandPalette  ui/CommandPalette.jsx
│   │   └── actions  bell · new task
│   └── <Outlet/>
├── MobileNav        ≤767px                 layout/MobileNav.jsx
└── MobileDrawer     ≤1023px overlay        layout/MobileDrawer.jsx

AdminShell                                  admin/AdminShell.jsx
├── AdminSidebar                            admin/AdminSidebar.jsx
│   ├── BackToApp
│   ├── PlatformBadge   pulse · org count
│   └── nav → ADMIN_NAV                     admin/adminNav.js
├── AdminTopbar         crumb · audit chip
└── <Outlet/>
```

`navConfig.js` is data, not JSX — one array, no components. Staging inlines 6 groups × up to 9 items plus 29 icons in the same 21.6 KB file as the render logic; splitting it is what makes the admin surface, the mobile drawer and the customization preview able to share one source of nav truth.

---

## 3 · New files

```
frontend/src/components/layout/navConfig.js       nav groups, one array, role predicates
frontend/src/components/layout/navIcons.jsx       the 29 inline SVGs, extracted
frontend/src/components/layout/SideBrand.jsx
frontend/src/components/layout/MobileNav.jsx      5-slot bottom bar
frontend/src/components/layout/MobileDrawer.jsx   ≤1023px overlay sidebar
frontend/src/components/admin/AdminShell.jsx
frontend/src/components/admin/AdminSidebar.jsx
frontend/src/components/admin/adminNav.js
```

---

## 4 · Endpoints

| Endpoint | Feeds |
|---|---|
| `GET /v1/me` | `role`, `org_roles[]`, `platform_roles[]`, `module_grants[]` — drives every nav predicate |
| `GET /v1/inbox/unread-count` | Inbox badge. Poll 60s or push over the existing socket |
| `GET /v1/approvals/pending-count` | Approvals badge — **currently declared in the nav config but never fetched** (see diffs) |
| `GET /v1/admin/orgs?count_only=1` | Org count in the platform badge |

Both counts should arrive in one call: `GET /v1/me/badges` → `{ inbox, approvals }`. Two polls for two integers on every page is waste.

---

## 5 · What changes in existing files

### `components/layout/Sidebar.jsx` — 21,600 bytes, rewritten

| Now | Target |
|---|---|
| `k-sidebar*` class names | `.side*` |
| English primary, Hindi as `k-sidebar__hi-mute` | **English primary (13.5px/500), Hindi sub (10px, `--side-fg-mute`)** — same hierarchy, restyled |
| 29 icons inline in the same file | `navIcons.jsx` |
| `NAV_FULL` + `NAV_CLIENT` inline | `navConfig.js` |
| 4 admin items appended into the `settings` group | separate `AdminShell` surface |
| `KMark` with `linear-gradient(135deg,#0082c6,#03a1b6 55%,#05b7aa)` | the real mark asset; that gradient is the **legacy blue→teal** and is retired |
| `maxHeight: items.length * 44 + 'px'` | `grid-template-rows: 0fr / 1fr`, or measure `scrollHeight` — the hardcoded 44 breaks the moment density or font size changes, and `09-customization.md` makes both user-settable |
| `transition: 'max-height .2s ease'` inline | `var(--dur-base) var(--ease-standard)` |
| `localStorage` keys `kartavya_sidebar_sections`, `kartavya_sidebar_collapsed` | **keep both keys verbatim** — renaming them silently resets every existing user's sidebar |

Two live bugs found while reading it:

- **The Approvals badge never renders.** `NAV_FULL` declares `badge: 'approvals'` on `/approvals`, but the render only handles `badge === 'unread'`: `const badgeCount = badge === 'unread' ? inboxCount : 0`. The count is always 0, so the element is never mounted. Wire it to the badges endpoint.
- **`ownerOnly` is inverted-ish.** `isMember = !isAdmin && !isClient && user?.role !== 'owner'`, and Reports is filtered by `!item.ownerOnly || !isMember` — so a plain `role: 'owner'` user passes, but so does anyone with a platform role. Fine today, wrong once org roles are the source of truth. Move the predicate into `navConfig.js` and express it against `org_roles`, per `RBAC-SPEC.md`.

### `components/layout/Topbar.jsx` — 6,559 bytes, mostly kept

- `PAGE_META` has 22 entries and is **missing 11 live routes**: `/sanvaad`, `/graha`, `/ganit`, `/manav`, `/vikray`, `/vetana`, `/dristi`, `/prachar`, `/admin/orgs`, `/admin/costs`, `/settings/customize`. All of them fall through to `{ en: 'Kartavaya', hi: 'कर्तव्य' }`, so the breadcrumb reads "कर्तव्य / Kartavaya" on eleven pages. Derive the title from `navConfig.js` instead of maintaining a second lookup — one list, no drift.
- **The two files disagree on Hindi.** Automations is `स्वचालन` in the sidebar and `स्वतंत्र` in the topbar (which means *independent*, not *automated*). Templates is `साँचा` vs `रचना`. Single source fixes both.
- Replace the `readOnly` `<input>` with a `<button>`.
- `COMMANDS` (15 items) moves to `ui/commands.js` so the palette and the topbar don't each own a copy.

### `components/layout/AppShell.jsx` — 12,079 bytes

Add the two mobile surfaces and the `data-platform` / `data-sidebar-bg` attribute writes. **The rule that has broken three times in this project: if you hide `.side` at a breakpoint, ship `MobileDrawer` in the same commit.**

### `components/CustomizePanel.jsx`

`prefs.sidebar === 'rail'` already drives the rail. Add `prefs.sideBg` → `data-sidebar-bg`. Full spec in `09-customization.md`.
