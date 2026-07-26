# Backend test suite — recovered, executed, and extended

Branch: `agent/backend-tests-verified` (from `salvage/backend-tests`, commit `5f7e3cf`)

This file is written incrementally. Findings are appended the moment they are
confirmed, not at the end.

---

## How to run the suite

```
cd backend
python -m pytest
```

`backend/pytest.ini` sets `testpaths = tests`, `asyncio_mode = auto` and
`addopts = -v --tb=short`, so no flags are needed. Test dependencies are in
`backend/requirements-dev.txt`.

Required env (already defaulted in `tests/conftest.py`, set explicitly in CI):

```
JWT_SECRET=<any 32+ chars>
REPORT_DISPATCH_SECRET=<any 32+ chars>
```

`DATABASE_URL` is intentionally NOT required — `tests/conftest.py` swaps
`db._pool` for a `MagicMock` in an autouse fixture, so nothing ever opens a
connection. **No test reads or writes the shared Supabase project.**

---

## Correction to the premise of the task

The task brief said the five files had "never been run" and that test
infrastructure might not exist. The first half is true; the second is not.
`backend/tests/` already contained a working harness on `staging`:

- `backend/pytest.ini` — asyncio auto mode, testpaths
- `backend/tests/conftest.py` — mocked pool, role fixtures (`as_admin`,
  `as_member`, `as_client_user`), ASGI client, org override
- `backend/tests/helpers.py` — JWT minting, a valid task row factory
- `backend/requirements-dev.txt`
- `.github/workflows/ci.yml` — already runs `pytest` for the backend

So no conftest had to be built. The five recovered files drop straight into the
existing harness and use its fixtures correctly.

---

## Baseline before any change

```
265 passed, 1 failed        (suite excluding the five recovered files)
314 passed, 4 xfailed       (the five recovered files alone, 318 collected)
```

The 1 pre-existing failure is `tests/test_ganit.py::test_create_invoice_success`
— present on `staging` before this branch, unrelated to the recovered files.
Investigated separately below.

---

## Bugs the recovered tests caught

### BUG 1 — private task attachments leaked through `GET /api/tasks` (REAL, FIXED)

`backend/server.py`, `list_tasks`.

Of the three routes that return task attachments, this was the only one that did
not filter:

| route | handler | filtered before this branch |
|---|---|---|
| `GET /api/tasks/{task_id}` | `get_task` | yes |
| `GET /api/client/tasks` | `client_tasks` | yes |
| `GET /api/tasks` | `list_tasks` | **no** |

`list_tasks` built rows with `row_to_task` and handed each straight to
`_refresh_task_attachments`, which **re-signs the R2 URLs**. So any teammate who
could see the task at all received a fresh, live, signed download URL for a file
the firm had marked private — on the highest-traffic route in the product.

Confirmed at request level, not by reading: with the xfail markers forced off,
the response body contained `salary-review-2026.pdf` and the string
`r2.example/salary` for a member who was neither the creator nor named in
`visible_to`.

Fix: `list_tasks` now calls `_filter_private_attachments` **before**
`_refresh_task_attachments`, matching `client_tasks`. The creator/admin
predicate mirrors `get_task` (`created_by_user_id == uid or is_org_admin`), and
`is_org_admin` is resolved **once** rather than per row — a 500-row page must not
become 500 role lookups.

The test was NOT weakened. The two xfail markers were removed, so a regression
now fails the build.

### BUG 2 — our upstream cost basis crossed to tenants (REAL, FIXED)

`backend/routers/scrapers.py`, `get_run` and `list_runs`.

`staging.hub_scraper_runs` carries two money columns with opposite audiences:

- `billed_inr` — what the customer was charged. Theirs.
- `cost_usd` — what the run cost us upstream at Apify, written from
  `info["usage_usd"]`. Our cost basis.

Both routes selected `r.cost_usd` and returned `dict(r)` behind nothing but
module membership. Beside `billed_inr` on the same row, that discloses
`SCRAPER_MARGIN` by subtraction on every run.

Fix, in two layers:

1. `cost_usd` dropped from both tenant SELECT lists — don't fetch what must not
   be returned.
2. **`_TENANT_RUN_FIELDS` allow-list projection applied in the handler.** This
   is the layer that actually holds. See the next section for why layer 1 alone
   was not enough — and why the test proved it.

`/admin/usage` and `/admin/runs` deliberately keep `cost_usd`; they sit behind
`require_platform_role(*OPERATIONS_CONSOLE_ROLES)` and showing cost is their
purpose. Frontend consumption of `cost_usd` is confined to
`frontend/src/pages/AdminCostDashboardPage.jsx` and
`frontend/src/pages/admin/MarginCell.jsx`, both admin-console pages fed by those
two routes — so no tenant-facing UI regressed.

### The SELECT-list fix was untestable, and that mattered

Dropping `r.cost_usd` from the two SQL strings **did not make the test pass.**

The test mocks the pool: `mock_pool.fetch.return_value = [_RUN_ROW]`, where
`_RUN_ROW` is a hand-written dict containing `cost_usd`. The mock ignores the
query text entirely, so a change to the SELECT list is invisible to it — the
handler still received a row with `cost_usd` on it and still did `dict(r)`.

That is a genuine limitation of mock-the-pool testing, and it pointed at the
better fix. A SELECT list is invisible from the return statement; the day someone
widens the query to `r.*` for an unrelated reason, the cost basis starts crossing
again with nothing in the handler to stop it. An explicit allow-list projection
in the handler is both what the test can verify and what actually fails closed.

So the production code changed to match the stronger guarantee rather than the
test being relaxed to match the weaker one.

---

## Are the recovered five vacuous?

Assessed one at a time: what would each catch if production regressed?

### `test_role_tiers.py` — NOT vacuous. The strongest of the five.

377 lines, pure unit tests on `middleware/role_tiers.py` with **no mocks at
all**, so the truthy-Mock failure mode cannot apply. Truth tables are written out
by hand rather than derived from `LEVELS.index()` — deriving them would
re-implement the function under test and pass no matter what it did. The author
called this out explicitly and was right to.

Would catch:
- `admin` being allowed to satisfy `approver` in `vetana` or `ganit` (separation
  of duty collapsing) — asserted three independent ways, including a contrast
  against `graha` where admin *does* satisfy approver, so the table cannot be
  trivially satisfied by returning False everywhere.
- `modules_for()` failing **open** for an unknown role — a role added to the DB
  CHECK constraint but not to this file must grant nothing, or the next role
  someone invents silently inherits god mode.
- `platform_owner` being dropped from any of the five console guard sets — a
  total lockout of all god-mode accounts on the day the legacy `platform_admin`
  rows are renamed.
- `platform_staff` appearing in any money-moving console set.
- A platform role missing from `PLATFORM_ROLE_PRECEDENCE`, which would make
  `strongest()` return None and silently demote a real holder.
- A console guard admitting an org-scoped role.

All 300+ parametrised cases passed against current production. No bug found here
— the model is already correct. The value is that it is now pinned.

### `test_task_attachment_privacy.py` — NOT vacuous. Caught BUG 1.

Includes a deliberate control (`test_single_task_read_strips_a_private_attachment`
on the route that already filtered) proving the mock setup genuinely reaches the
attachment path — so the failure was a real difference between two routes, not a
broken fixture. The fixture routes `fetch`/`fetchrow` by **query text** rather
than by call order, specifically because `get_task` and `list_tasks` hit the same
tables in a different sequence and a positional `side_effect` list would silently
hand the wrong row to one of them. That is careful work.

Would catch: any of the three task reads dropping its filter, the filter becoming
per-task instead of per-attachment, or `visible_to` / creator handling breaking.

### `test_scraper_cost_basis.py` — PARTIALLY vacuous. Caught BUG 2, but see above.

The two cost-basis tests are real and caught a real leak. But as written they
verify only the **handler's** projection, not the SQL — the mock supplies the row
shape. The file's own docstring claimed "the fix is to drop the column from those
two SELECTs", which would have left the test red. Docstring corrected; production
now carries the projection the test actually checks.

The four org-boundary tests in the same file are genuinely non-vacuous and were
already passing. `test_get_run_query_filters_on_org_id` is the notable one: it
asserts `"org_id=$2::uuid" in query` **because** the 404-on-foreign-id test above
it would also pass against a route that filtered on nothing, since the mock
returns None either way. The author saw that trap and closed it.

### `test_quiet_hours.py` — NOT vacuous, and unusually well constructed.

The midnight-wrap sweep (`test_the_wrap_covers_the_whole_night_and_nothing_else`)
walks all 1440 minutes of the day and compares the full quiet set against
`set(range(22*60, 24*60)) | set(range(0, 7*60))`. An **inverted** window — quiet
all day, awake all night — passes the ten spot-check cases above it and fails the
sweep. That is the difference between a test and a real test.

Would catch: the naive `start <= now < end` reappearing (false for every minute
of a wrapping window), boundary inclusivity flipping, minutes being truncated to
hours, a zero-length window being read as "always quiet" (which would suppress
every notification forever and look exactly like a dead push pipeline), and the
`send_push` early-return migrating to the wrong side of the token lookup.

Respects the outbound kill switch — `test_the_outbound_kill_switch_stops_a_push_
before_anything_else` asserts nothing is even read when `outbound.DRY_RUN` is on.
No push can leave during a test run.

### `test_client_portal_shape.py` — NOT vacuous. Written negatively on purpose.

The key test asserts the **whole key set** (`set(body[0]) == _ALLOWED_TASK_KEYS`)
rather than the absence of four named fields. A field-absence test passes again
the moment a fifth field is added upstream; a whole-set test fails when
`TaskOut` grows a field, which is exactly when a human should look.

Would catch: `ClientTaskOut` / `ClientApprovalOut` being replaced by the internal
model, any new `TaskOut` field reaching an external party, staff email addresses
appearing anywhere in the payload (checked as raw text, not just as keys, since
an email can ride inside a value like a review note), R2 storage keys or other
users' `visible_to` ids reaching a client, and the internal approval review trail
(`reviewed_by`, `review_notes`, `request_type`, raw `status`) crossing.

**Verdict: none of the five were vacuous.** One (`test_scraper_cost_basis.py`)
had a test/fix mismatch that pushed the production fix to a better layer. All
five assert something a regression would break.
