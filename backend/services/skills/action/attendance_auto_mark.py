import logging
import uuid
from datetime import date

#: THE codelist, not a second copy of it. `_norm_state` collapses '27', 27,
#: 'MH', 'mh' and 'Maharashtra' onto one value, which is what makes a holiday
#: written in one convention comparable to an employee written in the other.
from services.skills.data.client_register import _norm_state

log = logging.getLogger(__name__)

#: Set once `staging.manav_employees.state` has been seen to exist. Only ever
#: flipped to True, never back — a column is not dropped under a running
#: process, so a cached True cannot go stale, while a cached False could (the
#: migration lands while this worker is up) and would silently keep the old
#: behaviour for the life of the process. So the miss costs one catalogue read
#: per call until the migration runs, and nothing at all afterwards.
_HAS_EMPLOYEE_STATE = False


async def _employee_state_column_exists(pool) -> bool:
    """Does `staging.manav_employees.state` exist yet?

    THIS GUARD IS THE POINT, not defensive noise. The column arrives in
    migration 220, and migrations in this product are applied by hand against a
    database production also writes to — so there is a real window in which this
    code is deployed and the column is not there. Selecting it in that window
    raises UndefinedColumnError and answers 500 for every organisation, which is
    precisely how `/cron/hr` spent months broken over `manav_holidays.is_active`
    (see `tests/test_cron_column_names.py`). Until the column exists this module
    behaves EXACTLY as it did before: every active employee is marked.
    """
    global _HAS_EMPLOYEE_STATE
    if _HAS_EMPLOYEE_STATE:
        return True
    found = await pool.fetchval(
        """
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'staging'
              AND table_name = 'manav_employees'
              AND column_name = 'state'
        )
        """,
    )
    _HAS_EMPLOYEE_STATE = bool(found)
    return _HAS_EMPLOYEE_STATE


def _norm(value) -> str | None:
    """A state code reduced to the one form this module compares on.

    `manav_holidays_state_ck` accepts BOTH conventions — 'MH' as
    `statute_calendar` writes it and '27' as `organisations` and
    `pay_professional_tax` write it (migration 180 widened it rather than
    choosing). A holiday row may therefore carry either. Comparing the raw
    strings would silently never match, and a state filter that never matches is
    a state filter that does nothing — so both sides go through one normaliser.

    A blank and an UNRECOGNISED value both collapse to None, which this module
    reads as "no state was stated" — never as "a state that matches nobody".
    Erring that way keeps the failure in the direction of marking somebody who
    worked rather than of silently un-marking a whole workforce.
    """
    return _norm_state(value)


def _holiday_applies_to(holiday_state, employee_state) -> bool:
    """Does this holiday close the day for this employee?

    Two NULLs, two different meanings, and both of them mean YES:

      · A holiday with NO state applies EVERYWHERE. That is what migration 175's
        own column comment says NULL means, and it is the correct reading of the
        38 rows that predate the column.
      · An employee with NO state is still marked. Nobody has said where they
        work — 98 of 98 employee rows are in that position today — and reading
        silence as "not in Maharashtra" would quietly stop marking Maharashtra's
        holidays for the entire workforce the moment one regional holiday was
        entered. A state column that arrives empty must change NOTHING until
        somebody fills it in, which is also why this needs no separate
        "…and has data" guard: with every employee state NULL, this returns True
        for every employee and the behaviour is byte-for-byte the old one.

    So the only case that returns False is the one the feature exists for: a
    holiday that names a state, against an employee who names a DIFFERENT one.
    """
    h = _norm(holiday_state)
    if h is None:
        return True
    e = _norm(employee_state)
    if e is None:
        return True
    return h == e


async def mark_holidays_weekends(pool, org_id: str, target_date: date = None) -> dict:
    """Auto-mark attendance as 'holiday' or 'weekend' for active employees.

    A HOLIDAY IS NOT NECESSARILY THE WHOLE ORGANISATION'S. `manav_holidays`
    carries `state_code`, and a Maharashtra holiday must not assert that a
    Karnataka employee did not work — that is the same unknowable claim this
    module refuses to make about an ordinary absence. So the status is decided
    per employee rather than once for the org.

    Returns {marked: int}.
    """
    target_date = target_date or date.today()
    weekday = target_date.weekday()  # 0=Mon, 6=Sun

    # Check which holidays are declared on this date.
    #
    # `is_active` DOES NOT EXIST on manav_holidays and never did — the columns are
    # id, org_id, name, date, is_optional, state_code, created_at. This query
    # therefore raised UndefinedColumnError on every call, for every organisation,
    # which is why POST /api/internal/cron/hr answered 500 the first time anything
    # ever called it (2026-08-06). manav_EMPLOYEES does have is_active, which is
    # where the column name came from.
    #
    # It is replaced by is_optional rather than simply dropped. An OPTIONAL
    # holiday is one people may choose to work, so writing 'holiday' for every
    # employee would assert they did not work — the same unknowable claim this
    # module's own docstring refuses to make about absences. Only a compulsory
    # holiday can be auto-marked. COALESCE because the column is nullable and a
    # NULL there means nobody said, which is not the same as "optional".
    #
    # `fetch`, not `fetchrow`: a national holiday and a state holiday can fall on
    # the same date, and taking only the first row would let an arbitrary one of
    # them decide the day for everybody.
    holidays = await pool.fetch(
        """
        SELECT id, name, state_code FROM staging.manav_holidays
        WHERE org_id = $1::uuid AND date = $2
          AND COALESCE(is_optional, FALSE) = FALSE
        """,
        org_id, target_date,
    )
    holidays = list(holidays or [])

    is_weekend = weekday in (5, 6)  # Saturday, Sunday

    if not holidays and not is_weekend:
        return {"marked": 0}

    # Only ask about the state when there is a state to ask about. A date with
    # no regional holiday on it costs exactly what it always did.
    scoped = any(h["state_code"] for h in holidays)
    state_aware = scoped and await _employee_state_column_exists(pool)

    if state_aware:
        employees = await pool.fetch(
            """
            SELECT id, state FROM staging.manav_employees
            WHERE org_id = $1::uuid AND status = 'active' AND is_active = true
            """,
            org_id,
        )
    else:
        employees = await pool.fetch(
            """
            SELECT id FROM staging.manav_employees
            WHERE org_id = $1::uuid AND status = 'active' AND is_active = true
            """,
            org_id,
        )

    marked = 0
    for emp in employees:
        # Keyed on `state_aware` rather than probed on the row, because the
        # un-scoped query above does not select the column at all — asking a
        # Record for a column it was not given raises rather than answering
        # None, and that raise would be the 500 this whole branch exists to
        # avoid.
        emp_state = emp["state"] if state_aware else None

        # A holiday beats a weekend, exactly as before — but only a holiday that
        # applies to THIS person. Somebody the regional holiday does not cover
        # falls through to the weekend rule, and on a working day gets no row at
        # all, which is the correct answer: an ordinary day nobody has reported.
        if state_aware:
            applies = any(_holiday_applies_to(h["state_code"], emp_state) for h in holidays)
        else:
            applies = bool(holidays)

        if applies:
            status = "holiday"
        elif is_weekend:
            status = "weekend"
        else:
            continue

        # Skip if attendance already exists
        existing = await pool.fetchrow(
            "SELECT 1 FROM staging.manav_attendance WHERE employee_id = $1::uuid AND date = $2",
            emp["id"], target_date,
        )
        if existing:
            continue

        await pool.execute(
            """
            INSERT INTO staging.manav_attendance
                (id, org_id, employee_id, date, status, work_hours, overtime_hours, marked_by)
            VALUES ($1, $2::uuid, $3::uuid, $4, $5, 0, 0, 'system')
            """,
            uuid.uuid4(), org_id, emp["id"], target_date, status,
        )
        marked += 1

    return {"marked": marked}
