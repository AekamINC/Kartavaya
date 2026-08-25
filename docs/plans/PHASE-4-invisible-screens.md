# Phase 4 — Give the eight invisible features a screen

**Effort:** ~1 week · **Blocks on:** nothing (0.15 sharpens compliance settings)

Eight features have a **table, a route and tests — and no caller.** Every one was
recorded as shipped. A screen is the cheapest remaining unit of value in the
codebase: the expensive half is already paid for. Each item below is a table +
API that exists and a UI that does not.

## Tasks

### 4.1 · Compliance settings (proposal 80) — ~80% of the value is this screen

- **Exists:** `module_compliance_settings` (0 rows), `routers/compliance_settings.py`
  (`GET/PATCH /{module}`), migration 210/211.
- **Missing:** **no screen anywhere calls `/api/v1/org/compliance`.** The whole
  premise ("the firm ticks what applies to it") has no UI.
- **Do:** a settings panel per module with the safe default, the consequence
  stated next to each control, and audit. **Never a control that makes a
  compliance CLAIM** — "this org chose X retention" is a fact; "we are compliant
  with X" is a lie the customer repeats to their regulator. Only 1 of 5 modules
  (ganit) has rules registered — register the rest as you build.
- **Sharpen with:** Phase 0.15 (org-wide vs per-user scope).

### 4.2 · Pahchan consent + opt-out (proposal 80)

- **Exists:** `pahchan_employee_consents` schema + API + enrolment refusal.
- **Missing:** no consent has ever been recorded against 12 enrolled faces; no
  alternative attendance path for an opted-out employee.
- **Do:** the consent capture screen and an opt-out attendance route.

### 4.3 · Skill acknowledgement (proposals 70, 71)

- **Exists:** 32 of 78 skills wired in `ACK_WIRING`, two endpoints
  (`routers/hub.py:3005,3036`), `apply_wiring` runs in the dispatcher.
- **Missing:** `skill_finding_ack` = 0 rows; `grep "findings/ack"` across
  `frontend/src` returns nothing. **Every run repeats the same list forever.**
- **Do:** a dismiss/acknowledge control on each skill finding that POSTs to the
  ack endpoint. Wire the remaining 46 skills into `ACK_WIRING` **one per commit**,
  never in bulk.

### 4.4 · The Storage browser (proposal 83)

- **Exists:** `routers/storage_browser.py` (390 lines, 19 tests).
- **Missing:** no file in `frontend/src` or `mobile/src` calls `/v1/org/storage`,
  `/browse` or `/resolve`. **Zero objects exist in the new key grammar.**
- **Do:** the Storage tab; a backfill pass for existing attachments is a separate
  step (record it).

### 4.5 · The dock Due tab (proposal 72)

- **Exists:** `statute.py` ships the data; `DuePane` exists.
- **Missing:** `DUE_SOURCE = null`, `due: []` on every page; `DuePane` tells the
  user the calendar "is not served to the browser yet." A **test pins the dead
  state shut** (`skillDock.test.jsx:118`).
- **Do:** wire `DUE_SOURCE` to `statute.py`; **delete the test that pins it shut**
  rather than working around it. While here: fix the `income_tax`/`incometax`
  authority typo that drops 22 obligations (one token).

### 4.6 · Billing anchor screen (proposal 86)

- **Exists:** `/admin/billing-anchor` route, no caller.
- **Do:** the admin control; default per Phase 0.13.

### 4.7 · Subscription pause (proposal 86)

- **Exists:** `status='paused'` in the CHECK constraint, pause-enforcement
  middleware, no endpoint that sets it and no admin control.
- **Do:** the pause/resume control in the admin billing console.

### 4.8 · Quota proration (proposal 87)

- **Exists:** `/quota-proration` route, no caller.
- **Do:** surface it where sales targets are set.

## Definition of done

- Each of the eight has a working screen that reads and writes its endpoint,
  proven by a row appearing in the previously-empty table (staging test data).
- No UUID rendered (`check-rendered-ids.mjs`).
- 4.5's dead-state test is **deleted**, not skipped.
- `npm run build` + `npm run check` green.

---

## Progress

_Update as items land — tick here, flip the row in `docs/STATUS.md`, and append to `PROGRESS.md` with evidence. Nothing in this phase has landed yet._
