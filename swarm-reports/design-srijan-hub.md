# Srijan / Hub cluster — split and styled

Branch: `worktree-agent-aa8dcfcbeb2a880de`, branched fresh from `origin/staging`
at `cfdf4a40`.

Every number below was regenerated at the end of the run, not transcribed from
an earlier step.

---

## 1 · The worktree was stale, as warned

Seeded at `1aa49855` — **737 commits** behind `origin/staging` (`cfdf4a40`).
Before re-branching I confirmed all 13 commits unique to the stale head were
reachable from `main` (`git branch -a --contains 1aa49855` lists `main`), so
`git reset --hard origin/staging` lost nothing. `main` was never touched.

---

## 2 · What was done

`SPLIT → STYLE`. Four single-file pages became four thin route shells plus three
tab directories.

### New files

```
frontend/src/pages/hub/          _shared.jsx  OverviewTab  GenerateTab  ContentTab
                                 ChatTab  KnowledgeTab  PublishTab  BrandTab  CreditsTab
frontend/src/pages/hub/skills/   _shared.jsx  AssignedTab  CatalogTab  CreateTab  GuideTab
frontend/src/pages/srijan/       _shared.jsx  SkillsTab  ContentTab  GenerateTab
                                 DataCatalogTab  DataRunsTab  CreditsTab
frontend/src/styles/srijan.css   the .hb-* / .sk-* / .sr-* block
frontend/src/pages/hub/__tests__/srijanHub.test.jsx   13 regression tests
```

### Inline styles — measured on the DIRECTORIES, not the route files

| | before | after |
|---|---|---|
| `HubDashboardPage.jsx` | 1,355 lines / 248 inline | 147 / **0** |
| `HubClientDetailPage.jsx` | 1,342 / 241 | 159 / **0** |
| `OrgSrijanPage.jsx` | 1,291 / 241 | 184 / **0** |
| `HubSkillsPage.jsx` | 550 / 100 | 167 / **0** |
| `pages/hub/` (9 files) | — | 1,905 / **7** |
| `pages/hub/skills/` (5 files) | — | 635 / **0** |
| `pages/srijan/` (7 files) | — | 1,315 / **1** |
| **total** | **4,538 / 830** | **4,512 / 8** |

**830 → 8, and all 8 are custom properties only** — `--pc` (third-party brand
colour), `--pct` (meter width), `--c` (status tint). That is check-tokens
deviation 2. **Raw CSS property values in markup: zero.**

```
hub/CreditsTab.jsx:77      '--pct'
hub/PublishTab.jsx:251,282,416,462,570   '--pc'
hub/_shared.jsx:306        '--c'
srijan/CreditsTab.jsx:47   '--pct'
```

---

## 3 · The finding that mattered most: two Publish tabs, drifted

`HubClientDetailPage.jsx` was not merely a large file — roughly **700 of its
1,342 lines were a copy of `HubDashboardPage.jsx` that had fallen behind it.**
Same endpoints, older UI. The client-detail copy was missing:

- the content calendar (month view) entirely;
- the platform enable/disable panel;
- 4 of 13 platforms (tiktok, threads, pinterest… absent from its `PLATFORMS`);
- manual-token fields for Telegram / Reddit / Pinterest;
- the **EXPIRED** marker on a stale OAuth token.

So an admin opening a *specific* client saw strictly less than one opening the
org's own client. Both routes now render `pages/hub/*`; the client-detail page
**gains** all of the above and the drift cannot recur.

---

## 4 · Loading / empty / ERROR as three states

Eleven places wrote `catch { toast }` then branched on `length === 0`. Four
sentences were being printed over rejected promises:

- "No content yet. Switch to the Generate tab to create content."
- "No posts in queue."
- "No transactions yet." ← over a wallet that had been spending all month
- "No data runs yet. Go to Data Catalog to start one." ← an instruction to
  **spend credits** re-running work that may have succeeded

All now go through `useResource` / `useList` / `Resource` (`hub/_shared.jsx`),
where `data` stays `null` while `error` is set and `empty` is reachable only
from a *successful* response. `items` is `null` on failure, never `[]`.

### Additional defects found and fixed while splitting

1. **`PublishTab` silently enabled every platform on a failed allow-list.** The
   original was `catch { setEnabledPlatforms(ALL_KEYS) }` — a 403 on
   `/clients/{id}/platforms` rendered 13 connectable platforms for a client
   entitled to none, with no error shown. Now: the error is reported and **no
   platform cards are drawn**. *(I introduced a weaker version of this myself
   mid-run — `visible = … : PLATFORMS` — and caught it while writing the test.
   Fixed at `PublishTab.jsx:216`.)*
2. **`accounts` + `queue` were one `Promise.all` in one `try/catch`**, so a queue
   failure blanked the platform cards too. Separate resources now; a test asserts
   the cards survive a queue failure.
3. **`renderMarkdown` used `dangerouslySetInnerHTML` over model output** with a
   hand-rolled escaper, and inlined a `<code style="…">` attribute inside the
   generated HTML. Replaced with `Markdown` returning React elements
   (`srijan/_shared.jsx`) — React escapes by construction.
4. **Two hard-coded credit-cost tables** (`HubSkillsPage`, `srijan` QUICK_SKILLS)
   duplicated the server's `CREDIT_COSTS`. Now fetched; where unavailable the UI
   says so rather than printing a stale figure.
5. **Calendar header read `new Date('2026-07' + '-01')`** — invalid in Safari,
   rendering "Invalid Date". Now built from numeric parts.
6. **Scraper run poller had a bare `catch {}`** — a flaky network stranded the
   dialog on "Running…" forever with no way to know if credits were charged. Now
   counts misses and reports.
7. **`required` on a scraper input schema was decorative** — rendered as an
   asterisk, never enforced, so a run could start empty and fail *after* charging.
8. **Emoji removed** (📅🚀🎬🔍📢⭐ at 24px) per 07 §175; replaced with a named
   inline-SVG glyph set. Stored values (`calendar`, `rocket`…) unchanged.
9. **"Delete" on a catalog template deactivated it org-wide**, sat beside "Assign
   to Client", with no confirmation. Now confirms and states the blast radius.
10. **`BrandTab` re-seeded its form on every parent refresh**, discarding
    unsaved edits.
11. Destructive actions (delete conversation, remove KB doc, remove skill) had
    no confirmation and no undo. All confirm now.

---

## 5 · Constraints observed

- **Response unwrapping** — `rows()` imported from `lib/api`. `grep '\.data\.data'`
  across all new files: **none**.
- **`useTabPanelMotion`** destructured as `const { key: panelKey, ...motion } =`
  with `key={panelKey}` passed explicitly, in all 4 route files. The guard test
  found them (test count rose by exactly 4).
- **Database** — read-only. No writes, no migrations, no `PROPOSED_*.sql` needed
  (no schema change required).
- **No outbound** — nothing sent. The only server started was my own vite on
  **:5261** from **my** worktree, with `VITE_BACKEND_URL` pointed at a dead port
  and the axios adapter stubbed. Stopped afterwards.
- **No pricing figures** anywhere, including comments. Credits only; two files
  carry an explicit `NOTE ON FIGURES` saying why.
- **Shared CSS** — not touched. All new rules live in the new `srijan.css`; the
  only edit outside my own files is the one-line `@import` in `index.css`. No
  peer's selectors were added to or overridden.
- **Brand** — Kartavaya throughout.

---

## 6 · Gates — all four, unpiped, from `frontend/`

```
check-tokens:  348 declared, 240 referenced, 0 missing
check-classes: 2873 selectors defined, 2118 classes used, 0 missing a rule
vite build:    ✓ built in 15.58s
vitest:        36 files passed (36), 611 tests passed (611)
Unhandled Rejection blocks: 0    (case-sensitive grep over full output)
```

Baseline was 35 files / 594 tests. **36 / 611** now, and the delta reconciles
exactly: **+13** from my new `srijanHub.test.jsx`, **+4** from the
`tabPanelMotion` call-site guard picking up the 4 new route files.
594 + 13 + 4 = 611. ✔

`check-classes` caught 4 missing rules on first run (`.hb-colour`,
`.hb-colour__in`, `.hb-colour__v`, `.sk-guide`) — added, then clean.

---

## 7 · What I did NOT verify — read this part

**I could not take a screenshot.** The browser tool's tab cap was reached and
**all 9 open tabs belonged to peer agents**. `tabs_create` failed for the same
reason. The brief names a peer navigating another agent's tab as a prior-run
failure, so I did not close or navigate any of them.

I built a local render harness (`frontend/harness.{html,jsx}`) that mounted every
real tab component against the real stylesheet with a stubbed axios adapter, and
served it from my own vite on :5261 — but with no tab available I could not open
it. **The harness files have been deleted**; `git status` is clean of them.

So, honestly:

**Verified**
- Every component compiles and is reachable — `vite build` emitted
  `OrgSrijanPage`, `HubSkillsPage` and `CreditsTab` as real chunks.
- Every `var()` in the new CSS resolves (check-tokens, 0 missing).
- Every `className` in the new JSX has a rule (check-classes, 0 missing).
- The three states are genuinely distinct at the DOM level — 13 jsdom tests
  assert each specific sentence is **present** on success and **absent** on
  failure, so the pairs are self-guarding and cannot pass vacuously.
- `srijan.css` reaches the built bundle (`grep 'hb-plat__go' dist/assets/*.css`).

**NOT verified**
- Visual layout, spacing and rhythm against the reference. I read
  `ScreensMore.jsx:218` (`ScreenSrijan`), `:256` (`ScreenHub`),
  `ScreensThin.jsx:262` (`SrijanCredits`), `:335` (`HubPublish`), `Data.jsx:120`
  (`MODULE_TABS`) and `tokens.css` / `components.css` / `app.css`, and matched
  structure and token usage by reading. **I did not open the rendered HTML
  harnesses**, for the same tab reason.
- Dark mode, rendered. It is token-only by construction (no literal colour
  except the third-party brand hexes, which are deliberately theme-invariant),
  but I did not see it.
- Responsive behaviour, rendered. Every grid is
  `repeat(auto-fit|auto-fill, minmax(min(100%, Npx), 1fr))`, which cannot
  overflow, and there are 3 explicit breakpoints (chat rail at 760px, calendar
  cells at 640px). Not visually confirmed.

**Anyone re-running this should open the four routes and compare against
`ScreenSrijan` / `ScreenHub` directly. That is the one gap.**

---

## 8 · Incidental — two files reverted, do not re-introduce

`npm ci` (needed: the fresh worktree had no `node_modules`) rewrote
`frontend/yarn.lock`, swapping the platform-specific optional deps from
`linux-x64` to `win32-x64` for both esbuild and rollup — 10 insertions,
73 deletions. **Committing that would break Linux CI and the Vercel build.**
Reverted with `git checkout --`.

`visual-regression.test.jsx.snap` showed as modified but `git diff --numstat`
reports no content change — LF→CRLF only. Also reverted.

Final `git status`: 5 modified (4 route files + `index.css`), 3 untracked
(`pages/hub/`, `pages/srijan/`, `styles/srijan.css`). Nothing else.
