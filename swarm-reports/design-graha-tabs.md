# Graha (CRM) — tab bodies converted to the design system

Branch: `worktree-agent-a230b756b34f6b73c`, freshly re-branched from `origin/staging`.
All numbers below were regenerated at the end of the run, not transcribed from the brief.

---

## 1 · The headline number

```
cd frontend/src/pages && python -c "import pathlib;print(sum(p.read_text(encoding='utf-8',errors='ignore').count('style={{') for p in pathlib.Path('graha').rglob('*.jsx')))"
```

| | before | after |
|---|---:|---:|
| `frontend/src/pages/graha/**` inline styles | **648** | **9** |
| …of which are raw CSS property values | 638 | **0** |
| …of which are `--c` custom properties (allowed) | 10 | 9 |
| `frontend/src/pages/GrahaPage.jsx` (route file) | 2 | **0** |

All nine survivors are `style={{ '--c': … }}` feeding a CSS rule — `check-tokens.mjs`
deviation 2, the same pattern `PipelineTab` already used. **Raw CSS property values in
markup reach zero**, which is the target the brief actually sets.

The nine, in full:

```
_shared.jsx        '--c': rot.color                 (staleness badge)
AutomationsTab     '--c': a.is_active ? … : …       (status dot)
ContactsTab        '--c': l.color || …              (label chip — user data)
ContactTimeline    '--c': color   ×2                (event dot, event kind)
KanbanTab          '--c': stageColor(s)             (stage-move button)
LabelsTab          '--c': l.color || …              (swatch — user data)
PipelineTab        '--c': stageColor(stage)         (column cap — pre-existing)
TodayTab           '--c': s.color                   (section count)
```

A tenth existed briefly (`DedupeTab`, `'--c': 'var(--warn)'`) and was removed: `--c` is for a
value that varies per element, and a **constant** belongs in the stylesheet. It is now
`.gr__count--warn`.

## 2 · Gates — all four, from `frontend/`, unpiped

```
cd frontend && node scripts/check-tokens.mjs && node scripts/check-classes.mjs && npx vite build && npx vitest run
```

| gate | result |
|---|---|
| `check-tokens.mjs` | 347 declared, 238 referenced, **0 missing** |
| `check-classes.mjs` | 2769 selectors, 2026 classes used, **0 missing a rule** |
| `npx vite build` | **✓ built** |
| `npx vitest run` | **36 files / 613 tests passed** |
| `Unhandled Rejection` blocks | **0** (also 0 `Unhandled Error`, 0 `not wrapped in act`) |

Baseline was 35 files / 594 tests. The delta is **one new file, +19 tests**, all mine
(`grahaTabStates.test.jsx`). No pre-existing test was weakened. I verified the
unhandled-rejection count by writing the run to a file and grepping it, not by eyeballing
the summary — a green suite hides them.

## 3 · What was actually wrong, beyond the styling

### 3.1 The false-empty defect — 13 of 17 tabs

This is the defect the brief names, and it was the dominant one. `catch { toast }` followed
by a `length === 0` check: the request fails, the array stays `[]`, and the panel renders its
"nothing here" copy. On a CRM that is not a blank screen — it is a **false statement about
the customer's business**, and the toast that contradicts it is gone in four seconds.

Tabs that did this, and the sentence each printed over a failed fetch:

| tab | printed on failure |
|---|---|
| ContactsTab | *had* an error state already |
| ClientsTab | *had* an error state already |
| DealsTab | *had* an error state already |
| KanbanTab | *had* an error state already |
| **ReportsTab** | nothing at all — `.catch(() => {})`, five null panels, blank page |
| **DedupeTab** | "No duplicates found · All contacts have unique email and phone values" |
| **DedupeTab** (history) | "No merges yet." |
| **ApprovalsTab** | "No approval rules defined." / "No *pending* requests." |
| **DocumentsTab** | "No documents found." |
| **FollowUpsTab** | "No follow-ups found." |
| **LabelsTab** | "No labels yet." |
| **AutomationsTab** | "Sales Automations (0)" + empty page |
| **WebFormsTab** | "Web-to-Lead Forms (0)" + empty page |
| **TerritoriesTab** | "Territories (0)" + empty page |
| **CustomFieldsTab** | "Custom Fields (0)" + empty page |
| **ActivitiesTab** | n/a — it never listed anything (see 3.2) |
| **TodayTab** | "Could not load today view." — a dead end, no retry, no cause |
| **ContactTimeline** | "No activity yet." |

Two are worth calling out specifically:

- **ApprovalsTab.** "No pending requests" on an approval queue that did not load is the
  worst of these. An empty queue is a reason to *stop looking*.
- **DedupeTab.** "All contacts have unique email and phone values" is a specific, checkable
  claim about the customer's data, asserted on the strength of a request that failed.

Every one now renders `ErrorState` with `errorKind()` (so a 403 reads as denied, a dropped
connection as offline, and a 500 as a server fault) plus a working retry. Where a panel has
*two* independent reads, they now fail independently — Dedupe's merge history failing no
longer hides the duplicate groups, and Automations' run log failing no longer hides the
rules.

### 3.2 ActivitiesTab was not a page

This is the owner's "only tab is done not the whole page" complaint in its literal form.

The tab rendered a "+ Log Activity" button, a create form, and — when the form was closed —
one sentence: *"Activities are logged against contacts and deals. Open a contact or deal to
see its full activity history."* A tab telling you to go somewhere else to see its own
contents.

`GET /v1/graha/activities` has existed the whole time (`backend/routers/graha.py:951`). It is
gated, takes `contact_id` / `deal_id` / `activity_type` filters, orders by `created_at DESC`
and caps at 100. **Nothing on the front end ever called it.**

It now renders the list: type, title + description, what it is linked to, open/done status,
date, and a Complete action wired to `PATCH /activities/{id}/complete`. There is no delete
endpoint, so there is no delete button.

One deliberate design decision: `list_activities` selects from `graha_activities` with no
join, so it returns `contact_id` / `deal_id` and **no names**. A raw UUID in a log tells
nobody anything, so contacts and deals are fetched alongside as a lookup. That enrichment is
soft — if it fails the row shows nothing rather than an id, and the log still renders.

### 3.3 Accessibility and correctness fixes found during conversion

These came out of the conversion rather than being sought:

- **`DealsTab`** — the deal title was a `<span>` carrying an `onClick` that opens the editor.
  Unreachable by keyboard, invisible to a screen reader as a control. It is a `<button>`.
- **`DedupeTab`** — the expand/collapse group header was a `<div onClick>`. It is a
  `<button aria-expanded>`.
- **`ClientsTab`** — a hand-rolled `inputStyle` object was applied to **eleven** bare
  `<input>`s. It approximated `.k-input`, so the client form's fields were a slightly
  different height, radius and background from every other form in the product, and got no
  focus ring and no dark theme. They are `.k-input` now.
- **`CustomFieldsTab`** — the list body was `['contact','deal'].map(...)` returning `null` for
  any entity with no fields, so with zero fields defined the tab rendered a heading, a
  button and **nothing else**. No empty state existed in either the failure or the genuinely
  empty case.
- **Mobile.** Every form grid was a hard `1fr 1fr` / `1fr 1fr 1fr` with no query, and every
  filter bar was a nowrap flex row. Below ~560px the action buttons were pushed out of the
  viewport with no way to reach them. `.gr__grid` collapses to one column at 640px and
  `.gr__bar` wraps. This is marked `[fix]` in the stylesheet.
- **`RotBadge`** font size was a literal `10px` — below `00 §12`'s 11px metadata floor and
  immune to the Text size slider. It is `--t-label-sm`.
- **Wide tables** now scroll inside `.gr__tblwrap` rather than pushing the page sideways.
  The module shell is fluid and full-width, so an overflowing table took the tab strip with
  it.

### 3.4 Response unwrapping

All reads in `pages/graha/**` and `GrahaPage.jsx` now go through `rows()` / `body()` from
`lib/api.js`. Confirmed zero remaining `r.data.data` / `r.data.<field>` in graha code (the one
grep hit left, `WebFormsTab:122`, is `submission.data` — the submission's own JSON payload
field, not a response envelope).

I checked the actual shapes rather than assuming: **all 37 GET routes in `graha.py` return
`{"data": [...]}` for lists** and bare dicts for single objects. `rows()` was still the right
call — `/v1/org/members`, which `PipelineTab` consumes, answers a **bare array**, and that is
exactly the inconsistency `rows()` exists to absorb.

---

## 4 · Backend audit — the brief's warning does NOT hold for Graha

The brief said to expect *"several read paths with no source-module check"*. I checked all
83 routes in `backend/routers/graha.py` programmatically:

```
total routes 83
UNGATED: 2
  POST    /inbound-leads
  POST    /f/{slug}
```

**Every read path is gated.** All 37 GETs carry `_g=Depends(_gate)` where
`_gate = require_module("graha")`. The two ungated routes are both **writes** and both
correctly public by design:

- `POST /inbound-leads` (`graha.py:1460`) — verifies an HMAC signature against
  `_INBOUND_SECRET` with `hmac.compare_digest` before doing anything, and 503s if the secret
  is unconfigured.
- `POST /f/{slug}` (`graha.py:2416`) — the public web-form endpoint. It resolves `org_id`
  from the form row itself (`WHERE slug=$1 AND is_active=TRUE`), so an anonymous submitter
  cannot select an org.

I found **no missing module or permission check in this router**. If peer agents found them
elsewhere, it was not here. I made **no backend changes**.

---

## 5 · The tab strip / "More" popover

The owner flagged this specifically. It is **already correct and I did not need to change
it**: `components/module/ModuleTabs.jsx` implements the reference's `TabBar` behaviour —
first `max = 6` inline, the rest under a `More +N` popover with an `All tabs · N` header,
and the active tab swapped into the last inline slot so choosing `dedupe` from the menu does
not collapse it back behind "More".

That matches `design-reference/Kartavaya Redesign/Data.jsx:153` (`TabBar`, `max = 6`), and
`Data.jsx:121` declares the same seventeen Graha tabs the build renders. `GrahaPage.jsx`
passes all seventeen. Its 11 existing tests in `src/__tests__/moduleTabs.test.jsx` pass.

I did **not** regress the `useTabPanelMotion` destructure — verified after my edits:
`GrahaPage.jsx:67` is `const { key: panelKey, ...motion } = …` and line 164 passes
`key={panelKey}` explicitly. `src/__tests__/tabPanelMotion.test.jsx` (13 tests) passes.

---

## 6 · A landmine I hit, which will hit the next agent

`kanbanTab.test.jsx` mocked the api module with a bare factory:

```js
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
```

That leaves **every other export undefined**. The moment `KanbanTab` started unwrapping
through `body()`, all 8 tests failed with `Cannot read properties of undefined` — not as a
clear "missing mock" error, but as a component that silently renders nothing, so the
failures read as *"the board is empty"* and *"the skeleton is missing"*. It cost me a
detour.

Fixed with `importOriginal`, which is also strictly better — `rows()` / `body()` are now the
**real** implementations, so the test exercises the actual shape-tolerance instead of a stub:

```js
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()), api: { get: vi.fn(), patch: vi.fn() },
}));
```

This is safe because `vitest.config.js:24` defines `import.meta.env.VITE_BACKEND_URL`, so
evaluating `lib/api` does not hit its missing-config guard.

**The same bare-factory pattern is in at least four other test files** —
`src/pages/inbox/__tests__/notifications.test.jsx:27`, `src/__tests__/auth.test.jsx:16`,
`src/__tests__/orgSettingsTabs.test.jsx:30`, `src/__tests__/sanvaadChatPane.test.jsx:31`.
Each will break the same way the moment its component adopts `rows()`/`body()`. I did not
touch them — they are other agents' modules and they pass today. **Flagging, not fixing.**

---

## 7 · What I did NOT verify

Stated plainly, because these are real gaps:

- **No browser verification.** `GrahaPage` is behind `Protected`, so rendering it needs a
  session, and the only backend available is **production** — which shares one Supabase
  project with staging (`toacecaewujfxjfrjwco`). Signing in and clicking through a CRM would
  have meant auth writes against live customer data for a styling task. I judged that not
  worth it and did not do it. I also did **not** use the shared `:5173` server, per the
  brief — it serves the main checkout, not this worktree.
- **Consequently: no pixel comparison against the rendered HTML harnesses.** I read
  `ScreensCore.jsx`, `Data.jsx`, `tokens.css`, `components.css`, `app.css` and
  `_SOURCE-MAP.md`, and every measurement in `graha.css` is lifted from the JSX it replaces
  rather than re-derived from the reference. So this is a faithful **move** from markup to
  stylesheet, not a verified pixel match to the mockup. If the build diverged from the
  reference before, it still diverges by the same amount.
- **Loading and populated states are covered by tests, not by eye.** The new guard test
  asserts the error path for 15 tabs and the populated path for `ActivitiesTab` only.
- **No database access of any kind.** No reads, no writes, no migrations, no
  `PROPOSED_*.sql` (nothing required a schema change).
- **No email, WhatsApp or push was sent.** Nothing in this change touches an outbound path.
- **`ReportsTab`'s `rep-performance`** keeps its own soft catch on purpose (it 403s for a
  non-admin, and a member should still get the other four reports). I did not verify that
  403 against a live non-admin session.

## 8 · Two reference gaps I did not invent my way around

- `ScreensCore.jsx:123` gives `ScreenGraha` a **"Filters" button** (`btn btn--out btn--sm`)
  beside "New deal". The build has no such control and no filter model behind it. I left it
  out rather than shipping a button that does nothing.
- The reference's deal card shows an **owner avatar** (`<Av n={d.own} s={22} />`). The build
  has owner *names* only via `/v1/org/members`, which is org_admin+ and 403s for a plain
  member. `PipelineTab` already handles that correctly. Not changed.

---

## 9 · Files touched

New:
- `frontend/src/styles/graha.css` — the whole `gr__*` vocabulary, ~300 lines, module-scoped
  following the `prachar.css` / `vetana.css` precedent so the names cannot collide with the
  peers in ganit / manav / srijan.
- `frontend/src/pages/graha/__tests__/grahaTabStates.test.jsx` — 19 tests.

Modified — 18 files in `pages/graha/`, plus `pages/GrahaPage.jsx`, plus **one line** added to
`frontend/src/styles/index.css` (`@import './graha.css';`).

**I edited no peer module file.** I added no rule to shared CSS: `.mpage` and
`btn btn--fill btn--sm` were adopted as-is from what `VikrayPage` already uses, precisely to
avoid the "two agents fix the same shared selector and the fixes ADD rather than override"
regression from the last run.

Two environment artifacts were reverted rather than committed: `frontend/yarn.lock` (my
`npm ci` on Windows rewrote the esbuild binary from `linux-x64` to `win32-x64` — that would
have broken Linux CI) and a line-ending-only touch to
`__snapshots__/visual-regression.test.jsx.snap` (confirmed zero content diff).
