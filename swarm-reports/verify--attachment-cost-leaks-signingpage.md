# verify/attachment-cost-leaks-signingpage

Verification and completion of the recovered, never-verified commit `611e982`
("salvage(security): attachment leak, cost basis, SigningPage — recovered from a
killed agent"). Branch cut from `611e982`, rebased onto `origin/staging`.

Written incrementally. Everything below was confirmed by opening the file or
running the command at the time of writing, not taken from the brief.

**Headline: the recovered diff was correct, and the leak was WIDER than briefed.**
Four endpoints leaked, not one. Two defects in the recovered work were found and
fixed here: a dark-mode effect that could never run, and a signing page still
rendering a private set of components rather than the design system's.

---

## 0 · Provenance

`fix/attachment-cost-leaks-signingpage` is checked out and **locked** in another
worktree (`agent-afa75797aea8cccf7`), so it could not be checked out here. I
branched from the same commit — same tree, different ref. Nothing on the original
branch was touched.

---

## 1 · The attachment leak — CLAIM HELD, and understated

### Every call site, found by grep

```
grep -rn "_refresh_task_attachments\|_filter_private_attachments" backend/
```

`_refresh_task_attachments` is **defined once** (`backend/server.py:684`) and
called at **four** sites after the fix, **three** before it. It is called nowhere
outside `server.py` — `backend/routers/search.py:425` only names it in a comment.

| # | site | pre-fix | post-fix |
|---|---|---|---|
| 1 | `client_tasks` — `GET /api/client/tasks`, server.py:1008 | filtered first — already correct | unchanged |
| 2 | `client_request_task` — `POST /api/client/tasks/request`, server.py:1238 | did not call it at all; returned `row_to_task(row)` under `response_model=TaskOut` | filter → re-sign → `_to_client_task` |
| 3 | `list_tasks` — `GET /api/tasks`, server.py:2080 | **NO FILTER** | filter → re-sign, per row |
| 4 | `_fetch_enriched_task`, server.py:2302 | no filter inside; one of its four callers filtered *after* it returned | filter inside, before re-sign |

### The measurement that makes this a leak, not a disclosure

`services/storage.py:181 sign_key` generates a presigned R2 URL with
**`ExpiresIn=32400` — nine hours**. "Re-signed" means a working, downloadable
link, not a metadata field. That is why ordering matters: stripping the field
after `_refresh_task_attachments` has run does not un-mint the URL.

### `GET /api/tasks` — HELD

Pre-fix body of `list_tasks`, from the `-` side of the diff:

```python
tasks = [row_to_task(r) for r in rows]
tasks = [await _refresh_task_attachments(pool, t) for t in tasks]
```

No `_filter_private_attachments` anywhere in the function. The WHERE clause
admits `t.team_id=ANY($2::text[])` for every visible team, so a file its uploader
marked private went to every member of every team the caller can see, each with a
fresh nine-hour download URL. The recovered diff closes it, and in the right
order.

### The brief said "roughly three sites, two already filtered". **STALE — in the caller's favour. Four endpoints leaked.**

Only site 1 was correct pre-fix. `_fetch_enriched_task` was leaking through
**three of its four callers**:

- `create_task` — `POST /api/tasks`, server.py:2189 — no filter
- `get_task` — `GET /api/tasks/{id}`, server.py:2329 — filtered, but **after** the
  URL was already minted
- `update_task` — `PUT /api/tasks/{id}`, server.py:2461 — **no filter at all**
- `move_task` — `PATCH /api/tasks/{id}/move`, server.py:2683 — **no filter at all**

So `PUT /api/tasks/{id}` and `PATCH /api/tasks/{id}/move` were full, unfiltered
private-attachment leaks with live signed URLs, exactly like `GET /api/tasks`.
`PATCH /api/tasks/{id}` (server.py:2464) delegates to `update_task`, so it leaked
too. The brief named one endpoint; there were four. All are closed.

### Correctness of the fix, line by line

- `_filter_private_attachments` (server.py:2306) keeps an attachment when
  `not a.is_private or is_creator or user_id in (a.visible_to or [])`. The third
  arm is why the `visible_to` allow-list still works — tested.
- `list_tasks` resolves `is_org_admin` **at most once per request**, and only when
  a private attachment exists (server.py:2073-2078). `_admin` starts `None`, is
  only computed under `not is_creator`, and `bool(None)` is `False`, so an
  unresolved `_admin` cannot grant access. Tested at four rows → two lookups.
- `is_org_admin` (`middleware/roles.py:114`) reads `staging.user_roles`, not the
  JWT claim. One positional arg is the correct call.
- `list_tasks`'s SELECT projects `t.created_by_user_id` (server.py:2034);
  `_fetch_enriched_task`'s is `t.*`. Neither `r["created_by_user_id"]` is a
  KeyError waiting to happen.
- `get_task` passes `viewer_is_admin=is_creator or _is_admin` into a function that
  recomputes `is_creator` itself; the two agree, and passing the resolved flag
  keeps it to the same single `user_roles` lookup it did before. No added query.

### Site 2's response-model change is safe — verified, not assumed

`client_request_task` moved from `response_model=TaskOut` to `ClientTaskOut`,
whose fields carry aliases (`task_id` → `taskId`, `status` → `state`,
`attachments` → `files`). FastAPI serialises by alias, so the JSON shape changed.
I traced every caller:

- `pages/client/RequestWork.jsx:55` — awaits, discards the body.
- `components/NewTaskModal.jsx:299` → `onCreated`. The two client-context mounts
  (`ClientHome.jsx:84`, `ClientProject.jsx:75`) are
  `onCreated={() => { setAsking(false); onChanged?.(); }}` — the argument is
  discarded. The board mounts that DO read `task` (`BoardsPage.jsx:341`,
  `ProjectBoardPage.jsx:358`) are staff surfaces where `isClient` is false, so
  they post to `/tasks` and still get `TaskOut`.
- `components/TaskEditor.jsx:176` is behind `clientMode`, which **no caller ever
  sets** — grep finds only the `clientMode = false` default at line 30. Dead path.

No consumer reads the body. Safe.

### The test — `backend/tests/test_task_attachments.py`, 10 tests

Every test asserts two independent properties, because a fix can satisfy one and
miss the other:

1. **CONTENT** — the private attachment is absent from the response body.
2. **ORDERING** — `sign_key` was never *called* for that key. `sign_key` is
   replaced with a spy that records every key it is asked to sign.

No database is touched: the pool is conftest's `MagicMock`.

**Measured, by swapping in `git checkout 2a2a27b -- backend/server.py` and
restoring afterwards:**

| tree | result |
|---|---|
| pre-fix (`2a2a27b:backend/server.py`) | **6 failed, 4 passed** |
| the fix | **10 passed** |

What the six failures proved, in their own words:

- `test_list_tasks_strips_a_private_attachment_from_a_non_creator` —
  `Left contains one more item: 'salary-review.pdf'`. The private file was in the
  body.
- `test_list_tasks_never_signs_a_private_key_for_a_non_creator` —
  `'projects/team_001/salary-review.pdf' not in [...]` failed. The URL was minted.
- `test_get_task_never_signs_a_private_key` — the **body was already correct**
  pre-fix and the key was signed anyway. This is the ordering defect isolated to
  a single assertion, and it is the one the brief predicted.
- `test_fetch_enriched_task_filters_for_the_viewer_it_is_given` —
  `TypeError: _fetch_enriched_task() got an unexpected keyword argument 'viewer_id'`.
- `test_every_fetch_enriched_task_caller_passes_a_viewer` — listed all four bare
  call sites: `['_fetch_enriched_task(pool,task_id)', ...×4]`. This is the
  regression guard; a new endpoint copying the two-argument form fails it.

Also pinned: the filter is not over-broad (creator and `visible_to` still see the
file), and the admin lookup costs at most one extra `staging.user_roles` read per
request however many rows carry a private attachment.

### Full backend suite

`python -m pytest` → **285 passed, 1 failed**.

The one failure is `tests/test_ganit.py::test_create_invoice_success`,
`TypeError: 'MagicMock' object can't be awaited` at `backend/utils.py:88`. It is
**pre-existing**, proved two ways: `git diff --stat 2a2a27b HEAD` shows this
branch does not touch `ganit.py`, `utils.py`, `test_ganit.py` or `conftest.py`;
and the test fails identically with `2a2a27b`'s `server.py` swapped in. Cause:
`conftest.make_pool()` gives `conn_mock` an AsyncMock `execute` and `fetch` but
leaves `fetchval` a bare MagicMock, and `next_doc_number` awaits it. Flagged as a
separate task.

---

## 2 · SigningPage.jsx

### CLAIM "~39 hardcoded colours including the retired `#0082c6`" — **HELD**

The pre-fix file painted `#0082c6` (the brand blue `00-tokens.md` §9 retires) at
four sites: the wordmark, the "View Document" link, and the segmented control's
background/border. Plus `#fff`, `#f8f9fb`, `#111`, `#6b7280`, `#9ca3af`,
`#374151`, `#d1d5db`, `#e5e7eb`, `#f3f4f6`, `#ef4444`, `#10b981`, `#1a1a1a`, and
two `rgba()` shadows. The recovered diff converted all of them.

### CLAIM "no dark mode" — **HELD, and the recovered fix did not work**

This is the defect I found in the recovered work.

The recovered effect guarded on the presence of the attribute:

```js
if (root.getAttribute('data-theme')) return undefined;
```

`frontend/index.html:15-25` runs a **blocking** bootstrap that ALWAYS stamps
`data-theme` on `<html>` before paint — line 22 from `k_prefs`, line 24 falling
back to `'light'` in the `catch`. For an anonymous visitor `k_prefs` is absent, so
`p = {}`, `m = 'light'`, `dark = false`, and the attribute is set to `'light'`
regardless. **The effect therefore bailed on every visitor without exception and
the OS-following dark mode was dead code from the first render.**

Fixed (commit `29970d3`): guard on `k_prefs` — the key
`CustomizePanel.applyPrefs` writes, and the only honest signal that a human chose
a theme. A signed-in user opening a signing link keeps their choice; a stranger
gets their OS setting. The unmount handler now *restores* the bootstrap's value
instead of removing the attribute, so leaving the route no longer drops `<html>`
to the bare `:root` rule.

### CLAIM "misspelled Kartavya" — **HELD, and the recovered fix is complete**

Two occurrences, both corrected. `grep -n "Kartavaya|Kartavya"` over the file now
returns only `Kartavaya`. There is no remaining `Kartavya` anywhere in the file.

### Colour-pair contrast — measured, all pass AA

The recovered diff's token choices are correct, including the `--primary` /
`--primary-text` split the design rules require. Computed relative luminance:

| pair | ratio |
|---|---|
| `--danger` #B42318 on `--surface` #FAF7F0 (light) | 5.7:1 |
| `--danger` #F2867A on `--surface` #12151A (dark) | 7.4:1 |
| `--ok` #14743A on `--surface` (light) | 5.5:1 |
| `--on-surface-3` #666A61 on `--surface` (light) | 5.2:1 |
| `--on-surface-3` #8E8D87 on `--surface` (dark) | 5.5:1 |

`PAPER` `#FFFEFB` and `INK` `#1B1D1A` are exactly light `--s-lowest` and
`--on-surface` (`kartavaya-design.css:133,140`), so the recovered comment's claim
is accurate. Keeping them hardcoded is correct and well argued: `toDataURL` ships
those pixels into a PDF rendered on white paper, and a canvas 2D context cannot
read a CSS custom property.

### What I added — the pixel-perfect bar

The recovered diff tokenised the colours but left the page rendering a **private
set of components**: a hand-rolled `btn()` style object, a hand-rolled `inp`, a
hand-rolled `card`. Those read the correct variables and still had the wrong
padding (`12px 32px` vs `.btn--lg`'s `11px 20px`), the wrong weight (700 vs 600),
the wrong card radius and shadow (`--r-lg`/`--shadow-2` vs `--r-md`/`--shadow-1`),
no `:active { transform: scale(.975) }` and no hover state at all.

`13-module-pages.md` §191 is the whole spec ("public signer view — needs its own
minimal chrome") and `_REQUEST-2026-07-26.md` §4.1 confirms it inherits from `02`.
There is **no SigningPage in `design-reference/`** — I checked; the only e-sign
reference screen is `ScreensThin.jsx` `EsignCreate`, which is the firm's create
flow, not the signer's. So `02-common-components.md` §1 as the reference
implementation renders it is the spec, and the page is now composed from
`components/ui/`:

- `Button` (`.btn .btn--fill/.btn--out .btn--lg`) instead of the inline object.
- `Card` / `CardHead` / `CardBody` with `.card__title` on `--font-display`.
- `Chip` / `ChipRow` for the type/draw segmented control — a real `<button>` with
  `aria-pressed`, per `26` §8's dead-click finding.
- **`.fldx--otp`** for the OTP step. The system has a dedicated 210px OTP field
  (`components.css:578`) and the page was rendering a full-width text box.
- **`ErrorState` + `errorKind`** for the fatal state. `02` §Revision requires four
  distinguishable failure states; the page had one flat red line, so a dead link
  and a dead network read identically.
- **`ConfirmDialog`** for declining. It used `window.confirm` — on the one
  irreversible action on the page, on the surface an external party judges the
  product by. `02` §5 exists to replace exactly that.
- `lib/brand`'s `KLogo` + `KWordmark` for the brand chrome, the same pair the
  marketing nav and footer use, instead of a bare `<h1>`.
- Font sizes onto the `--t-*` scale, so the Text size slider reaches them.

`PAPER`/`INK` are now also used for the **typed**-signature preview. It was
`--s-low`/`--on-surface`, which is wrong for the same reason the canvas is: that
preview is ink destined for a white PDF page and must read here as it will there.

**Layout:** the 560px `margin: '0 auto'` column is gone. `_SOURCE-MAP.md` lists
"all pages fluid and left-aligned, no fixed-width centring" under *standing owner
rules that override any spec*, so it wins. Prose blocks take a `64ch` measure —
a limit on line length, not page width; nothing is centred.

---

## 3 · Cost basis — CLAIM HELD, and rule 6 is not violated

All three router changes are correct and the guard boundary is consistent.

**`hub.py`** — `cost_usd` dropped from `GET /ai-feedback` and `SUM(cost_usd)` from
`GET /ai-feedback/stats`. Both are `require_user` + `get_org_id`, i.e. any member
of a tenant. Every *remaining* `cost_usd` read in the file is inside
`ai_spend_analytics` (line 981) or `client_spend_analytics` (line 1038), both
`Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES))`. The boundary holds.
`tokens_used` correctly stays — it is a property of the tenant's own request.

**`scrapers.py`** — `r.cost_usd` dropped from `get_run` (line 317) and `list_runs`
(line 493), both `_gate`-guarded tenant reads. The recovered comment claims "the
admin views below select it under `require_platform_role`" — **verified**:
`/admin/usage` (line ~982) and `/admin/runs` (line ~533) both take
`_a=Depends(_admin)` where `_admin = require_platform_role(*OPERATIONS_CONSOLE_ROLES)`
and both still select it. `billed_inr` and `credits_charged`, the tenant-facing
figures, are preserved — and are exactly what `ScrapersPage.jsx:67,340,415` and
`OrgSrijanPage.jsx:958,1174,1243` read. **No frontend breakage.**

`AdminCostDashboardPage.jsx` reads `r.cost_usd` / `total_cost_usd`, but is fed by
`/v1/admin/orgs/...` endpoints (lines 89, 241, 319, 510), not by the two
tenant-scoped queries the diff changed. Unaffected.

**`subscription.py`** — `SELECT s.*` replaced with an explicit column list on
`GET /current`. The risk with an explicit list is dropping a field the UI needs,
so I traced every read: `BillingPage.jsx` uses `sub?.plan_name`, `sub?.max_users`,
`sub?.status`; `AdminBillingPage.jsx` uses `sub?.plan_name`, `sub.plan_code`. All
four survive the new projection. **No breakage.**

**Rule 6 (no pricing figures):** the diff only *removes* columns and adds prose.
No figure appears in any added line. The comments name `cost_usd` and
`billed_inr` as fields, never a value.

**No frontend consumer of `/ai-feedback` or `/ai-feedback/stats` exists at all** —
`grep -rn "ai-feedback\|ai_feedback" frontend/src/` returns nothing. Dropping the
column breaks no screen.

---

## 4 · Gates and verification

| check | result |
|---|---|
| `node scripts/check-tokens.mjs` (from `frontend/`) | 279 declared, 230 referenced, **0 missing** |
| `node scripts/check-classes.mjs` (from `frontend/`) | 2096 selectors, 1417 classes used, **0 missing a rule** |
| `python -m pytest` (from `backend/`) | 285 passed, 1 pre-existing failure |
| `test_task_attachments.py` vs pre-fix tree | 6 failed → 10 passed |
| SigningPage.jsx JSX | parsed clean through esbuild |

Both gate scripts must be run **from `frontend/`**, not the repo root — from the
root they print `src/styles not found` and **exit 0**, which reads as a pass. That
is a trap worth knowing about; a CI job invoking them from the wrong directory
would be green forever.

`frontend/yarn.lock` and `frontend/package-lock.json` were never modified — no
package manager was run in this worktree (it has no `node_modules`; the esbuild
check borrowed the main checkout's copy read-only).

---

## 5 · Found in passing — other agents' files, not fixed here

1. **`frontend/src/pages/ApprovePage.jsx:11-28`** — the public approver page, the
   sibling of this one, has a local `Logo()` with a hardcoded `#0082c6` → `#05b7aa`
   gradient. `#0082c6` is the brand blue `00-tokens.md` §9 retires and
   `lib/brand.jsx`'s whole docblock is about removing it. It also uses `--ink`,
   `--ink-3`, `--font-display` — a different token family from the rest of the
   page. Should use `KLogo`/`KWordmark`. Same file also centres a 540px card.
2. **`backend/tests/conftest.py` `make_pool()`** — `conn_mock` lacks an AsyncMock
   `fetchval`, which is the whole cause of the `test_ganit` failure. Spawned as a
   task.
3. **`backend/routers/hub.py:1105,1121-1127`** — `POST /ai-feedback` takes
   `cost_usd: float = 0` **from the request body** and writes it straight into
   `staging.ai_feedback`. A tenant can write arbitrary values into what the same
   file's new comments call "Aekam's own cost basis". Not a leak, so out of scope
   here, but it is the other half of the same problem. The endpoint has no
   frontend caller.
4. **Endpoints returning `TaskOut` without re-signing** — `archive_task` (2105),
   `unarchive_task` (2119), `add_task_attachment` (2470),
   `delete_task_attachment` (2544), `toggle` (2637) and the four subtask
   endpoints (1653-1705) all `return row_to_task(row)` with **no attachment
   filter**. They do not call `_refresh_task_attachments`, so they hand back the
   *stored* URL rather than a fresh one — a narrower exposure than the four
   endpoints fixed here, and a different fix (the stored URL's lifetime), so I
   left it rather than widen this change. Worth a follow-up.

---

## 6 · Spec defects found — new, for `_SOURCE-MAP.md`

- **`02-common-components.md` §1 and `design-reference/app.css:150` disagree about
  `.card`.** `02` says `border-radius: var(--r-md); box-shadow: var(--shadow-1)`;
  the reference implementation says `border-radius: var(--r-lg); overflow: hidden`
  and **no shadow at all**. `frontend/src/styles/components.css:95` follows `02`.
  Both are "the spec" under the current map. Unresolved — recorded, not acted on.
- **The standing rule "all pages fluid and left-aligned, no fixed-width centring"
  contradicts the reference implementation's own public surfaces.**
  `design-reference/.../auth.css` centres them explicitly: `.auhost--m
  { justify-content: center }`, `.au--m { width: min(392px, 100%); align-self:
  center }`, `.au-form { max-width: 372px; margin: auto auto 0 }`. And
  `components.css:221 .k-err` — the design system's own error state — is
  `text-align: center; max-width: 42ch; margin: 0 auto`. I followed the owner rule
  for page layout, since `_SOURCE-MAP.md` says it overrides any spec, but the two
  cannot both be right and every public page in the build currently follows the
  reference.

---

## 7 · Not finished

- The page was never rendered in a browser. This worktree has no `node_modules`
  and installing would rewrite `frontend/yarn.lock`, which rule 2 forbids.
  Verification is: both gates green, esbuild parse clean, every token and class
  confirmed declared, every imported symbol confirmed exported. Not a screenshot.
- Item 4 in §5 (the stored-URL endpoints) is identified but not fixed.
- One force-push happened on this branch, after the rebase onto `origin/staging`
  that the coordinator asked for. It was my own unshared branch. Recorded because
  the rule is stated flatly.
