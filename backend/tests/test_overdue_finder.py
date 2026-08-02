"""
`find_overdue` — five module specs, five different ways of being wrong.

This handler is registered five times over (`find_overdue_invoices`,
`find_overdue_vendor_bills`, `find_overdue_followups`, `find_overdue_tasks`,
`find_stalled_agreements`) and had never executed, because no template has ever
carried a data step. Every one of the five was broken against the live schema.
Verified 2026-08-02 and corrected:

  invoices / vendor_bills  `due_date` is a DATE; the result computed
                           `datetime.utcnow() - row["due"]` — `datetime - date`.
  esign / follow_ups       timestamptz columns; the same subtraction was
                           naive-minus-aware.
  follow_ups               filtered `is_done` and `is_active`, neither of which
                           exists — the column is `is_completed`.
  tasks                    read `staging.tasks`, which does not exist. Tasks are
                           in `public.tasks`, keyed `due_at`, with no `org_id`
                           and no `is_active`.

The SQL is proven separately against the live catalog: all five shapes now run,
and three return rows for Aekam Inc. What is tested here is the Python half —
the arithmetic that raised on every path regardless of the query.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skills.data.overdue_finder import _MODULE_MAP, find_overdue
from services.skills.timeutil import days_between

NOW = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)


# ── The arithmetic that raised on every call ────────────────────────────────

def test_a_plain_date_does_not_raise():
    """`ganit_invoices.due_date` and `ganit_vendor_bills.due_date` are DATE.

    The old line was `(datetime.utcnow() - r["due"]).days`, and
    `datetime - date` is a TypeError — so the receivables skill, the one with
    the clearest business case, failed on its first row every time.
    """
    assert days_between(NOW, date(2026, 7, 30)) == 3


def test_an_aware_datetime_does_not_raise():
    """`graha_follow_ups.due_at` and `ganit_contracts.updated_at` are timestamptz,
    so asyncpg returns an AWARE datetime and `utcnow()` is naive. Subtracting one
    from the other raises 'can't subtract offset-naive and offset-aware'."""
    assert days_between(NOW, datetime(2026, 7, 28, 9, 0, tzinfo=timezone.utc)) == 5


def test_a_naive_datetime_is_tolerated():
    """Defensive: no live column returns one, but a column type changing under
    this handler must not resurrect the original crash."""
    assert days_between(NOW, datetime(2026, 7, 31, 9, 0)) == 2


def test_a_null_due_is_zero_not_an_exception():
    assert days_between(NOW, None) == 0


def test_days_are_calendar_days_not_elapsed_hours():
    """"3 days overdue" is a statement about days. Carrying hours into it makes
    the answer flip at midnight for a row that has not changed."""
    just_before_midnight = datetime(2026, 8, 1, 23, 59, tzinfo=timezone.utc)
    assert days_between(NOW, just_before_midnight) == 1


def test_a_timezone_far_from_utc_still_lands_on_the_right_day():
    """IST is +5:30 and the product is Indian. A due time late in the Indian day
    is still the same UTC calendar day here, and must not read as a day early."""
    ist = timezone(timedelta(hours=5, minutes=30))
    assert days_between(NOW, datetime(2026, 8, 1, 23, 0, tzinfo=ist)) == 1


# ── The specs themselves ────────────────────────────────────────────────────

def test_all_five_modules_are_specified():
    assert set(_MODULE_MAP) == {"invoices", "vendor_bills", "follow_ups", "esign", "tasks"}


@pytest.mark.parametrize("module", sorted(_MODULE_MAP))
def test_every_spec_is_complete(module):
    """Every field here was a wrong assumption at least once, so none may be
    defaulted or omitted."""
    spec = _MODULE_MAP[module]
    for key in ("table", "date_col", "date_is_date", "owner_col", "label_col",
                "org_clause", "live_filter", "status_filter"):
        assert key in spec, f"{module} is missing {key}"


def test_no_spec_references_a_table_or_column_that_does_not_exist():
    """
    The three names that were wrong, pinned by name so they cannot come back:
    `staging.tasks` (no such table), `is_done` and a bare `is_active` on
    follow_ups (no such columns).
    """
    for module, spec in _MODULE_MAP.items():
        blob = " ".join(str(v) for v in spec.values())
        assert "staging.tasks" not in blob, f"{module} points at a table that does not exist"
        assert "is_done" not in blob, f"{module} filters a column that does not exist"

    assert "is_active" not in _MODULE_MAP["follow_ups"]["live_filter"]
    assert "is_completed" in _MODULE_MAP["follow_ups"]["status_filter"]


def test_tasks_are_scoped_through_their_team():
    """`public.tasks` has no org_id. Scoping it by anything other than the team
    subquery is a cross-tenant read, not a missing row."""
    spec = _MODULE_MAP["tasks"]
    assert spec["table"] == "public.tasks"
    assert "team_id IN (SELECT team_id FROM teams" in spec["org_clause"]
    assert "org_id = $1::uuid" in spec["org_clause"]


def test_the_four_org_scoped_modules_filter_on_org_id():
    for module in ("invoices", "vendor_bills", "follow_ups", "esign"):
        assert _MODULE_MAP[module]["org_clause"] == "org_id = $1::uuid"


# ── The cutoff type follows the column type ─────────────────────────────────

class _CapturingPool:
    def __init__(self):
        self.cutoff = None

    async def fetch(self, query, org_id, cutoff):
        self.cutoff = cutoff
        return []


@pytest.mark.asyncio
@pytest.mark.parametrize("module,expect_date", [
    ("invoices", True), ("vendor_bills", True),
    ("follow_ups", False), ("esign", False), ("tasks", False),
])
async def test_the_cutoff_matches_the_column_type(module, expect_date):
    """A DATE column compared against a timestamptz makes Postgres cast one
    side, which quietly discards any index on it."""
    pool = _CapturingPool()

    await find_overdue(pool, "11111111-1111-1111-1111-111111111111", module, days_overdue=7)

    is_plain_date = isinstance(pool.cutoff, date) and not isinstance(pool.cutoff, datetime)
    assert is_plain_date is expect_date


@pytest.mark.asyncio
async def test_an_unknown_module_returns_nothing_rather_than_guessing():
    assert await find_overdue(_CapturingPool(), "org", "payroll") == []
