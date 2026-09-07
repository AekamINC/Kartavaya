# Pahchan पहचान — Attendance

**Module code** `pahchan` · registered in `backend/middleware/role_tiers.py`

Biometric clock-in and clock-out with face matching and geofencing. Offline-first: a punch made without signal is queued on the device and reconciled later, inside a 72-hour buffer.

## Flow

An employee enrols a face template once, then punches against it. Each punch records a photo, a location and a device. `services/attendance_bridge.py` pairs the day's punches into a `manav_attendance` row, and Vetana reads that for the days-worked figure.

⚠ **"matched to a shift policy to decide lateness" was wrong until 2026-09-07**, and it had been copied into customer-facing collateral. **Nothing computes lateness.** Three independent confirmations:

- The bridge writes exactly two statuses — `STATUS_PRESENT = "present"` and `STATUS_INCOMPLETE = "incomplete"`. There is no `STATUS_LATE`.
- `shift_start_time` is declared on the bridge's policy dataclass (`attendance_bridge.py:114`), selected from the DB and passed in — **and never read again**. `grace_minutes` is not referenced in the bridge at all; it exists only as a settings field that round-trips to the client.
- `analytics/metrics/pahchan.py` registers `pahchan.late_arrivals` as an **`absent_metric`**, i.e. the codebase's own declaration that this is not built: *"The policy now exists … but an ARRIVAL does not."*

`manav_attendance.status` does admit `'late'`, but the only writer is a **human** choosing it through the manual-attendance endpoint.

## ✅ A latent 500 in `POST /attendance/publish` — found, then fixed

`STATUS_INCOMPLETE = "incomplete"` is **not** in `manav_attendance_status_check`, which admits only `present, absent, half_day, late, on_leave, holiday, weekend` (read from the live catalogue 2026-09-07; `'incomplete' = ANY(...)` evaluates **false**).

The bridge `continue`s only when a day has **neither** check-in nor check-out. A day with **one** punch — clocked in and never out, the most ordinary attendance exception there is — gets `status = STATUS_INCOMPLETE` and **is appended to `result.records`**. The publish route then loops `for rec in result.records` and inserts it with no filter (`grep -n incomplete routers/pahchan_attendance.py` returns nothing).

So the first publish of any month containing a single-punch day violated the CHECK and 500'd. **Never hit because `pahchan_punches` holds 0 rows** — nobody has ever published.

**Fixed 2026-09-07 by withholding, not by mapping.** `attendance_bridge.WRITABLE_STATUSES` names the statuses the column accepts, `partition_for_write()` splits the bridge's output on membership in it, and the publish route inserts only the writable side. The withheld days come back in the response as `incomplete_days` / `incomplete_rows`, so the screen can show them and a regularisation can fix them — they are not silently dropped.

Why withheld rather than mapped: `absent` and `half_day` both **assert** something, and this module already refuses that move for the no-punch case — *"Emitting an 'absent' row here would assert someone did not work on the strength of a punch nobody has reviewed yet."* A one-punch day is the same position, except the person demonstrably **did** work, so `absent` is not merely unproven but wrong.

Widening the CHECK to admit `'incomplete'` was the other candidate and was **not** taken: it is DDL against the table payroll reads, to store a value meaning *unknown* in a column of attendance facts. Payroll is unaffected either way — `vetana.py` counts `status IN ('present','late')`, so an incomplete row would never have counted as a day worked. Withholding costs nothing on the money side and asserts nothing false.

Pinned by `tests/test_attendance_bridge_writable_status.py` (9 tests), each proved against a mutation: re-adding `'incomplete'` to the set kills 4, making the partition write everything kills 1, making it drop the withheld side kills 2.

**The screen shows them (2026-09-07).** `PublishPayroll` renders `incomplete_days` in its own table with its own count, deliberately apart from `withheld_days`: the two have different remedies — a withheld day needs a **review** on the Register, an incomplete one needs a **regularisation** on Corrections — and one combined list would send half the operators to the wrong screen. Pinned by `frontend/src/pages/pahchan/__tests__/publishIncompleteDays.test.jsx` (6 tests; deleting the section kills 4, dropping the figure kills 2, feeding the table the withheld rows kills 2).

⚠ Those tests were **hollow in their first draft** and the mutations are what showed it: asserting against `container.textContent`, deleting the entire table still passed four of six, because the figure's label and hint satisfied the section's assertions — and deleting the figure passed all six, because the section heading contains the figure's label as a substring. Each half stood in for the other. Scoping every assertion to `section.k-section` / `.ph__fig` is what made them independently falsifiable.

## Backend

- `backend/routers/pahchan.py`
- `backend/routers/pahchan_attendance.py`

**Services**
- `backend/services/pahchan_retention.py`

**32 routes** — 11 POST, 15 GET, 4 PATCH, 1 PUT, 1 DELETE

<details><summary>All routes</summary>

- `POST /punch/photo`
- `POST /punch`
- `GET /me`
- `POST /notice/ack`
- `POST /consent`
- `GET /consent`
- `POST /consent/me`
- `GET /consent/roster`
- `POST /attendance/manual`
- `GET /attendance/manual`
- `GET /register`
- `PATCH /punches/{punch_id}/review`
- `GET /punches/{punch_id}/photo`
- `GET /sites`
- `POST /sites`
- `PATCH /sites/{site_id}`
- `GET /enrollment/{employee_id}`
- `GET /enrollment/photos/{photo_id}/url`
- `POST /enrollment`
- `POST /enrollment/{photo_id}/approve`
- `GET /enrollment/queue/pending`
- `GET /policy/scopes`
- `PUT /policy/scopes`
- `DELETE /policy/scopes/{scope_id}`
- `GET /policy/effective`
- `GET /policy`
- `PATCH /policy`
- `POST /regularisations`
- `GET /regularisations`
- `GET /regularisations/mine`
- `PATCH /regularisations/{reg_id}`
- `POST /attendance/publish`

</details>

## Database

12 tables:

- `manav_attendance`
- `manav_employees`
- `pahchan_employee_consents`
- `pahchan_enrollment_photos`
- `pahchan_notice_acknowledgements`
- `pahchan_policy`
- `pahchan_policy_overrides`
- `pahchan_punches`
- `pahchan_regularisations`
- `pahchan_sites`
- `user_roles`
- `users`

## Frontend

- `frontend\src\pages\pahchan\Clock.jsx`
- `frontend\src\pages\pahchan\Consent.jsx`
- `frontend\src\pages\pahchan\Corrections.jsx`
- `frontend\src\pages\pahchan\Enroll.jsx`
- `frontend\src\pages\pahchan\EnrollQueue.jsx`
- `frontend\src\pages\pahchan\History.jsx`
- `frontend\src\pages\pahchan\Notice.jsx`
- `frontend\src\pages\pahchan\PahchanPolicy.jsx`
- `frontend\src\pages\pahchan\PublishPayroll.jsx`
- `frontend\src\pages\pahchan\Register.jsx`
- `frontend\src\pages\pahchan\Rules.jsx`
- `frontend\src\pages\pahchan\Sites.jsx`
- `frontend\src\pages\pahchan\__tests__\historyCorrections.test.jsx`
- `frontend\src\pages\pahchan\__tests__\register-comparison.test.jsx`
- `frontend\src\pages\pahchan\__tests__\selfEnrollment.test.jsx`
- `frontend\src\pages\PahchanPage.jsx`


## Integrations

- AWS SES
- Cloudflare R2

---
_Routes, tables and paths are generated by `scripts/module-facts.mjs` and
`scripts/gen-module-docs.mjs`. Re-run both after changing the module; do not
edit those sections by hand. Purpose and Flow are hand-written._
