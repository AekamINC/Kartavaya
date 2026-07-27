# design/dristi-split — Dristi (Analytics) split, styled and wired

Branch `design/dristi-split`, based on `staging`. Three commits, all pushed.
Gates run from `frontend/`, unpiped, after every unit:
`check-tokens` 0 missing · `check-classes` 0 missing · `vite build` clean.

## Worktree came up on the wrong base — read this first

The worktree was seeded at `1aa49855`, **710 commits behind `staging`** and 13
ahead on an unrelated line of work (R2 attachments, CORS, PgBouncer). None of
the files the brief names existed at that commit. Six other worktrees sit on
that same commit, so those 13 commits are still reachable from all of them —
nothing was lost and I destroyed nothing. I branched fresh from `staging`
rather than resetting.

**If other agents were seeded from `1aa49855`, they are building against a
codebase from before the design run started.** Worth checking across the swarm.

## What shipped

`DristiPage.jsx` 603 → **149 lines**, zero inline styles. Eight tabs now in
`frontend/src/pages/dristi/`. Inline styles across the whole module **75 → 3**,
and all three are `--h`/`--w` custom properties carrying a datum to a rule in
`module.css` — the same pattern `graha/PipelineTab` uses for `--c`.

Charts are CSS, not a library, so they inherit the theme, the density control
and the type scale: `Bars`, `Funnel`, `Meters` in `dristi/_shared.jsx`.

Reference parity (`ScreensMore.jsx` `ScreenDristi`, `ScreensThin.jsx`
`DristiPivot`): chart gallery beside a live Configure panel, and a real
two-dimensional pivot with row, column and grand totals. Verified by screenshot
against the rendered reference.

## The two defects named in the brief were already fixed on staging

- `DristiPage.jsx:588` already passed `columns`, not `cols`.
- The `{/* */}` comment in the ternary's expression position was already
  unbraced, and the header comment explaining why is still there. I did not
  reintroduce either.
- `/overview` and `/hr` already withhold per source instead of serving payroll
  and revenue behind the `dristi` grant.

## Six live defects I found and fixed

1. **Both list endpoints were unreadable.** `GET /scheduled-reports` and
   `GET /dashboards` answer `{"data": [...]}`, and both call sites tested
   `Array.isArray(r.data)` against the **envelope** — never an array — so both
   evaluated to `[]` unconditionally. Every saved dashboard and every scheduled
   report an org had was invisible, under a page offering to create another.
2. **All five export buttons were dead.** `window.open('/v1/dristi/exports/…')`
   is site-relative; the API is on another origin in every environment, so it
   opened a path the SPA router does not have, and could not have carried the
   bearer token anyway. Now fetched as a blob through `api`.
3. **Report logs threw.** The endpoint answers `{"logs": [...]}`; the call site
   assigned the object to a list, so `.length` was `undefined` and `.map` threw
   on any report that had ever been delivered.
4. **Failed fetches rendered as loading or empty.** `data` stayed `null` on
   error and the only notice was a toast that had already faded; two tabs did
   `.catch(() => setX([]))`, turning a 500 into an empty state. `useDristi` +
   `TabState` keep loading / restricted / failed / loaded apart.
5. **`/pipeline` and `/sales` had no source-module check** — the same class as
   the `/overview` bug already fixed. A `dristi` grant alone read the whole CRM
   pipeline, named top customers, the order book and every salesperson's target
   vs actual. `/pipeline` refuses outright; `/sales` requires `vikray` and drops
   the leaderboard alone without `graha`, naming it in `withheld`.
6. **`.mt__b` had no `display`/`gap`** — the two scripts in every module tab
   were glued: "Overviewसारांश", "Revenueराजस्व". **Nine pages render this strip
   and all nine had it.** Fixed in shared CSS; other module agents get it free.

## Backend changes (`backend/routers/dristi.py`)

- `POST /query` gains `group_by2`, validated against the same per-source column
  whitelist as `group_by`, never interpolated from caller text. A pivot is
  two-dimensional; with one dimension the tab was a two-column list identical
  to what the chart cards already showed.
- `GET /widget-types` now returns only sources the caller can actually read,
  plus their columns. It offered all eight regardless of entitlement, so the
  builder proposed queries that 403 on Run — and the frontend carried a
  duplicate source→columns map that had already drifted, hiding `subtotal`,
  `amount_paid` and every `created_at` grouping the server allows.

`backend/tests/test_finance_cross_org.py` — 11 passed. No test covered
`/pipeline` or `/sales` gating before or after; worth adding.

## Rendering fixes found only by looking at it

A bar at 100% took the whole column and pushed its own axis label out of the
card, so the tallest bar on every chart was the one you could not identify.
Bar captions used exact rupees and collided at 60px column width — charts now
use lakh/crore, tables keep the exact figure. Axis labels arrived raw as
`2026-02` and truncated to "2026…".

## Notes for whoever picks this up

- **The dev server on :5173 runs from `D:\Projects\Kartavya`, not from any
  worktree.** `preview_start` reuses it and silently serves another agent's
  code. The shared Playwright browser also got navigated out from under me
  mid-session by the Prachar agent. I drove my own headless Chrome against my
  own vite on :5473 instead; that is the only reading I trust.
- `useTabPanelMotion` returns `{key, style}` and every split module spreads it
  as `{...motion}`, which React 18 warns about (`key` in a spread). Pre-existing
  and identical in graha/ganit/manav/vikray — needs one shared fix, not five.
- The visual harness lived in `public/__ref/` + a temp file under `src/`; the
  temp file is deleted and `__ref/` is gitignored. Nothing shipped.
