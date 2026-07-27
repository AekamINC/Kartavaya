# Verification — Srijan/Hub cluster and the core workflow pages

Branch `verify-srijan-hub-workflow`, cut fresh from `origin/staging` @ `0a69bef1`.

This is a **verification** pass. Its output is the per-file verdict table below. Six
defects were found and fixed; everything else was checked and left alone.

---

## How this was verified

Screenshots were unavailable for the whole session — every `computer{action:"screenshot"}`
returned *"the Browser pane is not displayed, so the page is not compositing frames."*
Nothing below rests on a picture. Evidence is **rendered DOM** (`read_page` / `innerText`)
and **measured layout** (`getComputedStyle`, `getBoundingClientRect`, `scrollWidth`
vs `clientWidth`), which is stronger evidence for structure, copy and overflow than a
screenshot would have been. It is *weaker* for pixel aesthetics — see NOT VERIFIED.

**The pages were actually run.** A private Vite dev server on **:5461** served this
worktree (never `:5173`, which serves the main checkout), with a fixture middleware
answering `/api/*` from memory. `location.href` was asserted on every read.

**No database was touched, and no session was taken against real data.** `Protected`
was satisfied by a fixture `/auth/me` plus a `localStorage` token — both local to my
own process. Nothing was written anywhere, no email/WhatsApp/push was sent.

**Fixture shapes were read off the backend, not guessed.** This mattered more than
expected: five "defects" I initially observed were my own fixture serving the wrong
shape, and each was disproved before it reached this table —

| What it looked like | What it actually was |
|---|---|
| `Dashboard` crashed: `(teams \|\| []) is not iterable` | `GET /teams` is `List[TeamOut]`, a bare array; my fixture wrapped it in `{data:[]}`. `AppShell` is right. |
| Automations all showed **Paused** with raw `move_column` labels | Real model is `enabled` / `trigger{event,filters}` / `actions[{type,config}]`; I had sent legacy `is_active`/`action_type`. Page is right. |
| Reports member chips rendered `?` | `server.py:2058` aliases the column to `display_name`; I had sent `name`. |
| Tasks showed a raw lowercase `review` status and `—` for every due date | Real fields are `in_review` and `due_at`, per `TaskOut` (`server.py:626`). |
| **7 task-template cards with no name at all** | My fixture's unanchored `/\/tasks$/` was swallowing `/templates/tasks` and serving the task list. Anchored it; names render. |

Recording these because half the claims in this repo's report history are stale, and a
fixture mismatch is the easiest way to manufacture a defect that is not in the product.

---

## The specific claims I was asked to confirm

**1 · `HubClientDetailPage` was a stale copy, and both routes now render the same
complete Publish tab — CONFIRMED, with byte-level evidence.**

Both shells import `./hub/PublishTab` (`HubDashboardPage.jsx:139`,
`HubClientDetailPage.jsx:135`). Rendered against identical fixtures, the `.hb-pub`
subtree from each route is **identical**: `innerHTML.length` **7583** and rolling hash
**933325243** from both `/hub` and `/hub/clients/c-1?tab=publish`. Everything the copy
had lost is present on both: the content calendar toggle, the **Manage platforms**
allow-list panel, all 13 platforms in `PLATFORMS`, the manual-token fields
(`MANUAL_PAGE_FIELD` covers Telegram / Reddit / Pinterest as well as Facebook and
Instagram), and the expired-token warning — *"Token expired — reconnect to keep
publishing"* rendered live from a `token_expires_at` in the past.

**2 · A failed allow-list must not enable all 13 platforms — CONFIRMED FIXED, verified
by measurement in all three states.**

| allow-list response | platform cards rendered | connect buttons | notes shown |
|---|---|---|---|
| `500` | **0** | **0** | 3 separate error notes (allow-list · accounts · queue) |
| `{enabled: []}` | 0 | 0 | *"No platforms are enabled for this client…"* |
| `{enabled: [4 keys]}` | 4 | as expected | — |

`loadEnabled`'s catch sets `keys: null`, `visible` derives only from a list actually
received (`PublishTab.jsx:219`, with no `: PLATFORMS` fallback), and the card block's
third branch (`enabled.error ? null`) draws nothing. Not knowing which platforms are
permitted no longer renders as all of them being permitted.

**3 · "Only the tab is done, not the whole page" — does not apply here.**
Every tab on every page in this cluster is wired to a real endpoint and has all three
states. Swept tab by tab, in both `ok` and `500` modes. Table below.

**4 · The More popover matches the reference — CONFIRMED at two widths.**
`ModuleTabs` reproduces `Data.jsx:153 TabBar` exactly: `max = 6` inline, tail in a
popover, `More +N`, header `All tabs · N`, and the active tab swapped into the last
inline slot rather than hidden. Measured:

- **1280px**, `/hub` (7 tabs): 6 inline + `More +1`; popover header *"ALL TABS · 7"*;
  picking Credits swapped it inline and pushed Brand to the tail.
- **393px**, `/hub/clients/c-1` (9 tabs): 6 inline + `More +3`; header *"ALL TABS · 9"*;
  popover box `left 141 → right 364` inside a 394px viewport — on-screen, `max-width
  280px`, and opening it does not create page overflow. The strip itself scrolls
  (`scrollWidth 700` vs `clientWidth 257`, `overflow-x: auto`) rather than pushing the page.

**5 · Empty-state-over-a-rejected-promise survivors — the eleven named Srijan sites are
gone; two survivors found elsewhere and fixed.**

All six Srijan tabs and all eight Hub tabs report failure explicitly under a forced 500.
The two specifically named hazards are dead:

- Credits → *"The credit ledger did not load."* — **not** "No transactions yet."
- Data runs → *"Your data runs did not load."* — **not** "No data runs yet. Go to Data
  Catalog to start one." Nobody is told to spend credits re-running work that may have
  succeeded.

Two survivors were found in the never-verified workflow half, and fixed (rows below):
`DashboardPage` → TeamPulse, and `ReportsPage` → the member picker.

**6 · Scrolling holds.** `.kv` resolves `grid-template-rows: minmax(0,1fr)`, and
`.kv__content` and `.side__nav` each scroll independently (`overflow-y: auto` on both;
`.kv__content` measured 804 tall vs 1539 scrollable on `/dashboard`). No page on the
list scrolls the document body.

**7 · 393px and dark mode.** No horizontal document overflow on any page checked at
393px — `documentElement.scrollWidth === clientWidth` on Hub Publish, Boards, Tasks,
Reports, Time, Srijan. Wide content scrolls inside its own container (the board is
`overflow-x: auto` with `scroll-snap-type: x`, one column at a time). Dark mode: tokens
flip (`--surface #12151A`, `--on-surface #E9E7E1`, `--primary #05b7aa`, `--warn #E8B45C`,
`--danger #F2867A`), 332 custom properties resolve with **zero** Kartavaya tokens empty
(the only empty ones are Tailwind's own `--tw-*` reset placeholders), and no element
renders text the same colour as its own background.

**8 · No pricing figures.** Grepped the whole cluster for `₹`, `INR`, `price_inr`,
`billed_inr`, `rupee`: **zero hits** outside two comments that exist to explain why
there are none. `routers/hub.py` carries a matching note that `price_per_credit_inr` was
removed from the tenant payload. Nothing I added introduces one.

---

## Verdict table — all files, none skipped

`fixed` means the defect was found by this pass and repaired on this branch.

### Srijan / Hub — route shells

| File | Verdict | What differs | Evidence gathered |
|---|---|---|---|
| `pages/HubDashboardPage.jsx` | **matches** | — | Rendered `/hub`. 4 KPI tiles, 7 tabs (6 inline + `More +1`). Publish subtree hash identical to client-detail. Provisioning gap renders as a `note--info`, distinct from a 500. |
| `pages/HubClientDetailPage.jsx` | **matches** | — | Rendered `/hub/clients/c-1`. 9 tabs, `?tab=` deep link honoured and written back with `replace`. Under 500: *"This client did not load"* + server `detail` surfaced — not "No such client". |
| `pages/HubClientsPage.jsx` | **matches** | Uses `PageHeader kicker="HUB"` (monolingual) where module pages use `ModuleHeader`'s bilingual kick. **Not a defect** — every `PageHeader` in the app is monolingual uppercase (OPERATIONS, SETTINGS, WORKSPACE, TEAM, PEOPLE, REVIEW). Left alone. | Rendered. Loading skeleton / `ErrorState` / `EmptyState` / grid are four separate branches; header stays mounted through all of them. |
| `pages/HubSkillsPage.jsx` | **matches** | — | 4 tabs swept. Under 500 the KPI reads `—` *"this list did not load"* and the header note scopes the failure. |
| `pages/OrgSrijanPage.jsx` | **matches** | — | 6 tabs swept in both modes. `?tab=scrapers` alias resolves to Data catalog. KPI strip has its own failure state. |

### `pages/hub/`

| File | Verdict | What differs | Evidence gathered |
|---|---|---|---|
| `hub/_shared.jsx` | **differs → fixed** | No plural helper; `${n} credits` printed **"1 credits"**. Added `creditLabel()`. Deliberately not named `credits` — several tabs take a prop by that name and a destructured param shadows a module import silently. | Verified live: WhatsApp preset now reads *"1 credit"*, the rest *"2 credits"*, *"3 credits"*… |
| `hub/GenerateTab.jsx` | **matches** | — | Rendered. Under 500 shows *"Credit balance unavailable"*, not `0`. |
| `hub/ContentTab.jsx` | **differs → fixed** | `"1 credits"`. | Status filter counts + 4 review states render; error note under 500. |
| `hub/ChatTab.jsx` | **matches** | — | Session list, message pane, KB-scope caption. Under 500: *"Your conversations did not load."* |
| `hub/KnowledgeTab.jsx` | **matches** | — | Doc list with chunk counts; search/add-doc/add-FAQ. Under 500: *"The knowledge base did not load."* |
| `hub/PublishTab.jsx` | **matches** | — | The claim-bearing file; see §1 and §2. Three states measured separately for the allow-list, accounts and queue. |
| `hub/BrandTab.jsx` | **differs → fixed** | Footer said **"Saved."** for a client that has never had a brand profile — a claim about a record that does not exist, on the field set that decides what every generated draft sounds like. Now three states: *Unsaved changes / Saved / Not saved yet.* | Verified both branches: with a brand → *"Saved."*; with `brand: null` → *"Not saved yet."*, agreeing with the KPI's *"Not set"*. |
| `hub/CreditsTab.jsx` | **differs → fixed** | `"1 credits"` in the top-up toast. | Ledger renders `tx_type`/`balance_after` correctly; under 500 *"The credit ledger did not load."* — the worst-case empty state is gone. |
| `hub/OverviewTab.jsx` | **matches** | — | Renders through `Resource`; error path surfaces the server's `detail`. |

### `pages/hub/skills/`

| File | Verdict | What differs | Evidence gathered |
|---|---|---|---|
| `hub/skills/_shared.jsx` | **matches** | — | `parseSteps` is the house array-or-JSON-string pattern; I reused its contract for the Srijan fix below. |
| `hub/skills/AssignedTab.jsx` | **differs → fixed** | `"~1 credits"`, `"Run · 1 credits"`. | Assigned packs render name, description, category pill, estimate and step flow. Under 500: error note. |
| `hub/skills/CatalogTab.jsx` | **differs → fixed** | `"~1 credits per run"`. | Catalog renders; "every template already assigned" is a distinct message from an error. |
| `hub/skills/CreateTab.jsx` | **differs → fixed** | `"about 1 credits per run"`. Already pluralised *step* by hand — the intent was there, the credits half was missed. | Form renders with step editor and `{placeholder}` hint. |
| `hub/skills/GuideTab.jsx` | **matches** | — | Static explainer; bilingual headings present. |

### `pages/srijan/`

| File | Verdict | What differs | Evidence gathered |
|---|---|---|---|
| `srijan/_shared.jsx` | **differs → fixed** | Added `creditLabel()` and `parseSchema()`. | See the two rows below. |
| `srijan/SkillsTab.jsx` | **differs → fixed** | `"About 1 credits"`, `"~1 credits per run"`, `"1 credits."` in the finished note. | Active/Catalog segments, step flow, run form. |
| `srijan/ContentTab.jsx` | **differs → fixed** | `"1 credits"`. | Agent-type filters render. Under 500: *"Your content library did not load."* |
| `srijan/GenerateTab.jsx` | **differs → fixed** | `"1 credits"` on the WhatsApp preset — visible on **every** load, since the served cost table has a single-credit entry. | Verified: 7 presets now read `2 credits / 2 credits / 3 credits / 5 credits / **1 credit** / 8 credits / 10 credits`. |
| `srijan/DataCatalogTab.jsx` | **BROKEN → fixed** | **Two defects, one serious.** ① Clicking a tool whose `input_schema` arrives as a JSON string threw `TypeError: (s.input_schema \|\| []).filter is not a function` **during render**, which unmounted the entire Srijan page — not just the dialog. `routers/scrapers.py:159` guards for exactly this shape (`if isinstance(schema, str): schema = json.loads(schema)`), which is the evidence it occurs. ② `Up to {s.max_results} results` rendered as **"Up to  results"** — a sentence with a hole — whenever the nullable column came back null (`scrapers.py:96` selects it raw and only coalesces at run time). | Both **reproduced and then re-verified**. Before: `errs: ["Uncaught TypeError: … .filter is not a function"]`, `pageAlive: false`. After: dialog renders (*"MCA company lookup · This run spends · 6 credits · CIN*"), `errs: []`, `pageAlive: true`. The null-`max_results` card now omits the phrase instead of printing a hole. |
| `srijan/DataRunsTab.jsx` | **matches** | — | Succeeded / running / failed runs render with `credits_charged`. Under 500: *"Your data runs did not load."* — the named hazard is dead. |
| `srijan/CreditsTab.jsx` | **matches** | — | Org balance, allocation, per-action cost table, ledger. Credits only, no rupee figure. Under 500: *"Your credit balance did not load."* |

### Workflow

| File | Verdict | What differs | Evidence gathered |
|---|---|---|---|
| `pages/TemplatesPage.jsx` | **matches** | — | Two bilingual segments with counts. Both states verified. |
| `pages/templates/TemplateCard.jsx` | **matches** | `kickerFor` is the first word of the description, so *"The monthly cycle"* yields the kicker **"THE"**. Weak, but a deliberate 10-char derivation with no reference screen to check against — flagged, **not** changed. | Card renders kicker, name, description, Devanagari accent and footer. |
| `pages/templates/TaskTemplateForm.jsx` | **matches** | — | Opened live: icon picker, name, project scope, pre-filled title with `{placeholder}` hint. |
| `pages/templates/ApplyTemplateModal.jsx` | **matches** | — | Opened live: `role="dialog"`, `aria-modal="true"`, bilingual title, explicit *"Existing tasks are not changed."* |
| `pages/ApprovalsPage.jsx` | **matches** | — | Under 500 the stat tiles read `—` with *"Today's decision counts did not load. The queue below is unaffected."* — scoped, honest, and the model the two fixes below were written to match. |
| `pages/approvals/QueuePanel.jsx` | **matches** | — | Pending rows with requester, note, age, Approve/Reject. `ErrorState` under 500. |
| `pages/approvals/HistoryPanel.jsx` | **matches** | — | Approved/rejected decisions with reviewer and age. `ErrorState` under 500. |
| `pages/approvals/ApprovalRow.jsx` | **matches** | — | Rendered inside the queue. |
| `pages/approvals/ApprovalModals.jsx` | **matches** | — | Opened live: reject requires a reason (`REASON*`, *"The requester sees this."*), `role="dialog"`. Approve is immediate, matching `ScreensWork.jsx:93`. |
| `pages/ProjectsPage.jsx` | **matches** | — | Cards with task/done/open counts and a completion meter. `ErrorState` under 500. |
| `pages/ReportsPage.jsx` | **differs → fixed** | The member picker's fetch swallowed failures into `members: []`, and the only non-empty branch was `uniqueMembers.length === 0 ? 'Loading members…'`. A 500 therefore left **"Loading members…" on screen permanently**, and a project with genuinely no members said the same thing. A spinner that never resolves is the one failure people wait through instead of retrying. Now four outcomes: nothing chosen · still arriving · failed (with retry) · genuinely nobody. | Before: *"Loading members…"* forever under 500. After: *"The member list did not load, so this report cannot be scoped by person yet. Try again"*; success path still lists all three members. |
| `pages/AutomationsPage.jsx` | **matches** | — | WHEN/IF/THEN with bilingual labels, Active/Paused, condition text, humanised action labels. |
| `pages/TimeReportPage.jsx` | **differs → fixed** | The headline figure read a confident **"0h"** beside the word TOTAL while the error card sat underneath it — the catch sets `total_minutes: 0`, and `0 ? … : '0'` cannot tell zero from unknown. On a timesheet the wrong one is the one that gets billed. Same during loading. Now `—` unless the fetch actually succeeded. | Before: `"0h | TOTAL कुल"` under 500. After: `"— | TOTAL कुल"` under 500, `"128.5h | TOTAL कुल"` on success. |
| `pages/CategoriesPage.jsx` | **matches** | — | Create form + colour swatches. `ErrorState` under 500. |
| `pages/BoardsPage.jsx` | **matches** | Devanagari renders only on the two synthetic columns (Requested, Awaiting Client Approval), not on DB columns. **Defensible, not a defect**: board columns are user-defined rows and an arbitrary name has no translation. Reference `ScreenBoards` hardcodes four status columns, which the product does not. Flagged, not changed. | All 7 reference views present inline (`kanban→Board, table→List, calendar, timeline, workload, priority, mytasks→My Tasks`), no `More` — matching `max=7` in `ScreensWork.jsx:15`. Project chips present. `.bd__cn-hi` has `margin-left: 5px`, so the concatenation in `innerText` is not a rendering fault. |
| `pages/TasksListPage.jsx` | **matches** | — | Matches `ScreenTasks` and exceeds it: Mine/All open/Overdue/Done with counts, priority groups with Devanagari and counts, relative due dates (*Today, 1:00 PM* · *17d overdue* · *In 3d*), avatar stacks, proper status labels (*In Review*, *Awaiting Approval*). `ErrorState` under 500. |
| `pages/DashboardPage.jsx` | **differs → fixed** | `/activity/feed` was fetched with a bare `.catch(() => {})`, leaving `activity` at `[]`; **Team pulse then stated "No activity in the last few days."** — a claim about the team derived from a rejected promise, sitting beside three panels on the same page that each say plainly that they could not load. | Otherwise an excellent match for `ScreenDash`: greeting with विक्रम संवत् date, week chips, stat row, "On your plate", Cash position with 30d/Quarter, Approvals, and the Gītā 2.47 tonal card. Its error copy is the best in the codebase (*"the numbers below are missing rather than zero"*, *"This is not a claim that none are waiting"*). After the fix: *"Activity did not load. This is not a claim that nothing happened. Try again"*; success path still lists the feed. |
| `pages/today/TeamPulse.jsx` | **differs → fixed** | Supporting file for the row above. Gained `error` / `onRetry`, using `ApprovalsCard`'s wording and markup so the two failures in that column read as one voice. | Both states verified live. |

---

## NOT VERIFIED

Stated plainly rather than implied:

- **Behaviour against the real backend.** Everything ran against fixtures whose shapes
  were read off the route handlers. Shapes were checked; live responses were not.
- **Pixel-level appearance** — exact spacing, type scale, shadow, focus-ring rendering.
  The pane never composited a frame, so no screenshot exists. Computed values
  (`--pad-card: 18px`, token resolution, contrast) were measured; how it *looks* was not.
- **Drag-and-drop on Boards**, and the column reorder/rename paths.
- **The OAuth return leg** in `PublishTab` beyond the code path — no provider was contacted.
- **Any write.** Approve, reject, schedule, publish-now, top-up, delete and template-apply
  were opened and inspected but never submitted against anything real.
- **PDF/Excel export** from `ReportsPage`.
- **`setup_local_db.py:294`** declares `task_templates(data JSONB)` while
  `routers/templates.py` reads and writes `config`. The router is authoritative and the
  page follows it; the dev bootstrap script looks stale. Out of scope here — noting it.

## Observations left deliberately unchanged

- `HubClientsPage` monolingual kicker — matches the app-wide `PageHeader` convention.
- `BoardsPage` Devanagari on synthetic columns only — see the row above.
- `TemplateCard`'s first-word kicker ("THE").
- `ReportsPage.jsx:511` uses `kicker="Operations · Reports"` in mixed case where every
  other `PageHeader` kicker is a single uppercase word.

## Gates

Run from `frontend/`, exit codes captured:

```
node scripts/check-tokens.mjs    → 356 declared, 244 referenced, 0 missing   EXIT 0
node scripts/check-classes.mjs   → 3499 selectors, 2690 classes, 0 missing   EXIT 0
npx vite build                   → built in 21.47s                           EXIT 0
npx vitest run                   → 41 files / 665 tests passed               EXIT 0
grep -ci unhandled /tmp/vt.log   → 0
```

Baseline is 41 files / 665 tests, exit 0 — **met exactly**.

Not committed, per the constraints: `yarn.lock`, `package-lock.json` (npm-install
byproduct), and the line-ending-only churn in
`src/__tests__/e2e/__snapshots__/visual-regression.test.jsx.snap` (no content diff under
`--ignore-all-space`). The fixture harness lived in `frontend/.harness/` and was deleted
before committing.
