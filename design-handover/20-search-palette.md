# Search & Command Palette

## Prerequisites
- `00-tokens.md`, `02-common-components.md`
- `23-accessibility.md` — the palette is a combobox and currently announces nothing
- `08-rbac-screens.md` — search results must respect module grants

## Files to modify
- `frontend/src/components/CommandPalette.jsx` — 26 hardcoded nav items, no data search
- `frontend/src/components/layout/Topbar.jsx` — its own separate 4-item list, unused
- `frontend/src/styles/kartavaya-design.css` — `.k-cmdk*` block

## Files to create
- `frontend/src/hooks/useSearch.js`
- `frontend/src/lib/commands.js` — one registry, replacing three lists
- `frontend/src/components/SearchResults.jsx`

## Estimated scope
- 3 new files, 3 modified.

---

## The palette promises search and delivers a nav menu

`CommandPalette.jsx` renders a magnifying-glass icon and the placeholder **"Type a command or search…"**. What it searches is `ALL_ITEMS` — 4 hardcoded actions and 26 hardcoded routes. There is no query to the server anywhere in the file.

So a user types a client's name, an invoice number, a task title, or a colleague's name, and gets **"No results found"** — for data that exists and that they have open in another tab. The placeholder is a promise the component cannot keep, and "no results" is a stronger claim than "I didn't look".

That is the whole redesign: keep the command list, add the thing the placeholder already advertises.

## Five smaller defects in the same file

**1 · Fuzzy matching returns nearly everything.**

```js
const haystack = \`\${item.label} \${item.hi} \${item.keywords}\`.toLowerCase();
if (haystack.includes(q)) return 2;
let qi = 0;
for (let i = 0; i < haystack.length && qi < q.length; i++) if (haystack[i] === q[qi]) qi++;
return qi === q.length ? 1 : 0;
```

A subsequence test over a 40-character concatenation matches almost any 3-letter query. Type `ate` and most of the 30 items score 1, in source order, because `.sort((a,b) => b.score - a.score)` has nothing to break ties with. The user sees a list that barely changed and concludes search is broken.

Score by **where** the match lands and **how early**: exact label prefix > label substring > keyword substring > subsequence. Never return a subsequence hit above a substring hit.

**2 · `scrollIntoView` on every arrow key.**

```js
useEffect(() => { listRef.current?.children[activeIdx]?.scrollIntoView({ block: 'nearest' }); }, [activeIdx]);
```

Same call that makes Sanvaad's scrollback unreadable (`06-sanvaad-varta.md`). Even with `block: 'nearest'` it can scroll ancestor containers, and it is unnecessary here — the list is a known height with known row heights:

```js
const el = listRef.current, row = el?.children[activeIdx];
if (!el || !row) return;
const top = row.offsetTop, bot = top + row.offsetHeight;
if (top < el.scrollTop) el.scrollTop = top;
else if (bot > el.scrollTop + el.clientHeight) el.scrollTop = bot - el.clientHeight;
```

**3 · Two entries navigate to the same route.** `srijan` and `scrapers` both point at `/hub/org`. One of them is wrong, and a user who picks "Data Tools" and lands on Srijan will not trust the palette again.

**4 · The "Actions" are navigations.** `new-invoice` → `/ganit`, `new-contact` → `/graha`, `new-project` → `/projects`. Only `new-task` has a real `action`. So "New Invoice" drops you on the invoice list to hunt for the create button. Either wire the create intent through (`?new=1` or a shared sheet) or relabel them as navigation — a section header that says Actions and delivers a page move is a small lie the user notices the first time.

**5 · `Topbar.jsx` has its own list.** Four items with `{ id, label, section, shortcut, keywords }` — a fifth shape, including a `shortcut` field `CommandPalette` does not have. It appears unused. One registry in `lib/commands.js`; delete the other two.

## Structure

```
CommandPalette                      ⌘K
├── input          role="combobox" aria-expanded aria-controls aria-activedescendant
├── ScopeChips     All · Tasks · Clients · Invoices · Messages · Files   (Tab cycles)
└── list           role="listbox"
    ├── Commands   from lib/commands.js — instant, local
    ├── Results    from useSearch()     — debounced 180ms, server
    │   └── grouped by entity, max 5 per group, "See all 23 →"
    ├── Recent     last 5 opened, when query is empty
    └── Empty      distinguishes "no query" · "searching" · "no matches" · "failed"
```

**Commands render immediately; results stream in below.** Never make the command list wait on the network — `⌘K → "new task" → Enter` is a muscle-memory path and must stay instant. The results group appears when it arrives, below the commands, without reordering what is already on screen. A list that reflows under a moving selection causes wrong activations.

The four empty states are distinct on purpose (`02-common-components.md` carries the same rule). "No results found" for a request that failed is a lie about the data.

## Search hook

```js
export function useSearch(query, scope = 'all') {
  const q = useDebounced(query.trim(), 180);
  return useQuery({
    queryKey: ['search', q, scope],
    queryFn: ({ signal }) => api.get('/v1/search', { params: { q, scope, limit: 5 }, signal }).then(r => r.data),
    enabled: q.length >= 2,
    staleTime: 60_000,
    placeholderData: prev => prev,   // keep the previous list while the next one loads
  });
}
```

`enabled: q.length >= 2` — a single character matches everything and costs a round trip for nothing. `placeholderData` keeps the previous results visible rather than flashing empty between keystrokes, which is the difference between search that feels instant and search that feels broken. Pass the `signal` so superseded requests abort; without it, a slow response for `"ra"` can land after `"rakesh"` and overwrite it.

## Endpoint

```
GET /v1/search?q=&scope=&limit=
→ { tasks:[{id,title,project,status,due}], clients:[{id,name,gstin}],
    invoices:[{id,number,client,amount,status}], messages:[{id,channel,snippet,author,at}],
    files:[{id,name,task,size}], counts:{tasks:23,clients:2,…} }
```

Three requirements on the backend, none of them optional:

- **Scoped to the user's grants.** A member with no Ganit grant must not see invoice hits. Filter in the query, not in the response mapper — an unfiltered query with a filtered render leaks through counts, and `counts.invoices: 40` tells them exactly what they cannot see.
- **Devanagari-aware.** Client names, task titles and messages are routinely typed in Hindi and Gujarati. Postgres `to_tsvector('simple', …)` plus `unaccent` handles both scripts; the default English configuration stems Latin text and silently ignores the rest.
- **Never cross the org boundary**, including in `counts`.

## Styling

```css
.k-cmdk-overlay{position:fixed;inset:0;z-index:120;background:var(--scrim);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;animation:fade var(--dur-fast) var(--ease-enter)}
.k-cmdk{width:min(620px,calc(100vw - 32px));max-height:64vh;display:flex;flex-direction:column;border-radius:var(--r-lg);background:rgba(var(--glass-tint),var(--glass-alpha));backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));border:1px solid var(--outline-variant);box-shadow:var(--shadow-4);overflow:hidden;animation:cmdkIn var(--dur-base) var(--ease-emph)}
@keyframes cmdkIn{from{opacity:0;transform:translateY(-10px) scale(.985)}}
.k-cmdk__input-wrap{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-4);border-bottom:1px solid var(--outline-variant);color:var(--on-surface-3)}
.k-cmdk__input{flex:1;border:0;background:none;outline:none;font-family:var(--font-ui);font-size:16px;color:var(--on-surface)}
.k-cmdk__list{overflow-y:auto;padding:var(--sp-2) 0;overflow-x:hidden}
.k-cmdk__section{padding:var(--sp-2) var(--sp-4);font-size:var(--t-label-sm);letter-spacing:.14em;text-transform:uppercase;color:var(--on-surface-faint);font-weight:700}
.k-cmdk__item{display:flex;align-items:center;gap:var(--sp-3);width:100%;padding:9px var(--sp-4);text-align:left;background:none;border:0;cursor:pointer;color:var(--on-surface)}
.k-cmdk__item[data-active="true"]{background:var(--primary-container);color:var(--on-primary-container)}
.k-cmdk__hi{margin-left:auto;font-family:var(--font-indic);font-size:var(--t-label);color:var(--on-surface-3)}
.k-cmdk__meta{font-size:var(--t-label);color:var(--on-surface-3);white-space:nowrap}
```

`font-size: 16px` on the input is deliberate and must not be tokenised down — iOS Safari zooms the viewport on focus below 16px and never fully restores it (`15-mobile-web.md`).

Selection is a **filled row**, not a border — a 1px border on the active row shifts text by a subpixel as selection moves, which reads as jitter during fast arrowing.

```css
.k-cmdk__item[data-active="true"] .k-cmdk__hi{color:var(--on-primary-container);opacity:.72}
```

Without this the Hindi label keeps `--on-surface-3` against the selected fill and drops below 3:1.

## Accessibility

Currently the palette has no ARIA at all — no `role`, no `aria-expanded`, no `aria-activedescendant`. A screen reader user gets a bare text field, hears nothing as they arrow, and cannot tell what Enter will do.

```jsx
<input role="combobox" aria-expanded="true" aria-controls="cmdk-list"
       aria-activedescendant={\`cmdk-\${results[activeIdx]?.id}\`} aria-autocomplete="list" />
<div id="cmdk-list" role="listbox" aria-label="Commands and results">
  <div id={\`cmdk-\${item.id}\`} role="option" aria-selected={idx === activeIdx}>
```

`role="option"` on a `<div>`, not the current `<button>` — a button inside a listbox is announced twice. Keep the click handler; `onMouseEnter` should set the active index but must not fire while the user is arrowing, or a stationary cursor steals the selection back on every re-render.

Also needs the focus trap from `23-accessibility.md`: the palette is an overlay and Tab currently walks out of it into the page behind.

## Mobile

⌘K has no mobile equivalent. Search is a full-screen sheet reached from the top bar, opening with the keyboard up and the scope chips visible. No command section — commands are keyboard affordances, and on a phone the bottom nav already does what they do.

---

## Unreported page: Vikray

`App.jsx` lazy-loads `VikrayPage` and the palette lists **Sales · विक्रय** at `/vikray`. It is not in the 15 modules covered by `13-module-pages.md`, and no prototype screen exists for it.

Also absent from every handover file: `SigningPage`, `HubSkillsPage`, `HubClientDetailPage`, `OrgSrijanPage`, `CategoriesPage`, `AutomationsPage`, `ActivityFeedPage`, `TimeReportPage`, `ReportsPage`.

Some are minor and inherit their styling from `02`. **Vikray is not minor** — it is a named module with a sidebar entry, so it needs the same treatment as the other fourteen. Scope it before implementation planning, not after.
