"""`employee.joining_soon` — the event that fires BEFORE somebody starts.

── WHY IT EXISTS ──────────────────────────────────────────────────────────────

`employee.joined` fires when the personnel ROW is created. That is the wrong
instant for onboarding: everything worth doing before a joiner arrives — order
the laptop, raise the login, get the desk — has to hang off a date that is
still in the future, and until `hire_candidate` stopped hardcoding
`date_of_joining = CURRENT_DATE` there was no future date to hang anything off.

So this predicate is the second half of that change, and it is the half that
turns "the product can store a joining date" into "the product does something
about one".

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

The direction and the boundaries. Every one of the five is a silent failure if
it flips: the sweep would still run, still find rows or not, and report nothing
wrong — the failure mode `test_niyam_predicates_can_match.py` was written for,
where "the predicate ran, the rule ran, the condition recorded an honest
verdict, and the answer was always False".

⚠ THE `>=` ON TODAY IS THE ONE TO WATCH. Tightened to `>`, the event fires for
everybody EXCEPT the person starting this morning — who is exactly who a
"prepare for the joiner" rule is about.

── VERIFIED LIVE, 2026-09-05 ──────────────────────────────────────────────────

The WHERE clause was run against synthetic rows on the production schema
(read-only; nothing written). Every boundary came out right:

    started last month       fires=false   days_until=-30
    started yesterday        fires=false   days_until=-1
    starts TODAY             fires=TRUE    days_until=0
    starts in 3 days         fires=TRUE    days_until=3
    starts in 7 days (edge)  fires=TRUE    days_until=7
    starts in 8 days         fires=false   days_until=8
    inactive, starts in 3    fires=false   days_until=3
    no joining date          fires=false   days_until=null
"""
import re

import pytest

from services.niyam.predicates import PREDICATES
from services.niyam.subjects import EMPLOYEE_JOINING_SOON

PRED = next((p for p in PREDICATES if p.event_type == EMPLOYEE_JOINING_SOON), None)


def sql():
    assert PRED is not None, (
        "no predicate emits employee.joining_soon — the event would be offerable "
        "in the rule builder and could never fire"
    )
    return " ".join(PRED.sql.split())


class TestItLooksForwardNotBack:
    def test_the_horizon_is_added_not_subtracted(self):
        """A lookback here would fire for people who ALREADY started.

        Six of the seven other predicates run backwards — overdue tasks, stale
        contacts, yesterday's attendance — so `NOW() - ($1 …)` is the shape a
        reader copies by habit. This one is one of the two that run forwards.
        """
        s = sql()
        assert "NOW() + ($1::int * INTERVAL '1 day')" in s, (
            "the horizon is not a forward one — this predicate would fire for "
            "employees whose joining date has already passed"
        )
        assert "NOW() - ($1" not in s, "the horizon runs backwards"

    def test_today_is_included(self):
        """⚠ `>=`, not `>`. See the header."""
        assert re.search(r"date_of_joining\s*>=\s*NOW\(\)::date", sql()), (
            "somebody starting today no longer fires the event — they are the "
            "person a 'prepare for the joiner' rule is most about"
        )

    def test_the_far_edge_is_inclusive(self):
        assert re.search(r"date_of_joining\s*<=\s*\(NOW\(\)", sql())


class TestItDoesNotSweepRowsItShouldNotSee:
    def test_inactive_employees_are_excluded(self):
        assert "emp.is_active = TRUE" in sql(), (
            "the sweep would announce the joining of somebody already off the rolls"
        )

    def test_a_missing_joining_date_is_excluded(self):
        """NULL is not a date near today; it is the absence of one.

        Without this the comparison is simply NULL and the row drops anyway —
        but stating it keeps the intent readable and survives a rewrite of the
        comparison into something NULL-tolerant.
        """
        assert "emp.date_of_joining IS NOT NULL" in sql()

    def test_it_is_org_scoped_and_dedupes(self):
        s = sql()
        assert "emp.org_id" in s, "the event carries no org — it could not be routed"
        assert "{anti_join:" in s, (
            "no anti-join: every tick would re-fetch the same rows for ever and "
            "starve anything past the LIMIT"
        )


class TestItFiresOncePerPerson:
    def test_the_window_is_once(self):
        """A person approaches their first day one time.

        `daily` would send the same "joining soon" alert every day for a week,
        which is seven notifications about one fact.
        """
        assert PRED.window == "once", f"window is {PRED.window!r}"

    def test_the_horizon_leaves_time_to_act(self):
        """The number is a product decision, so it is pinned rather than ranged.

        Seven days: ordering a laptop and raising a login both have lead time,
        and a horizon shorter than the lead time makes the event useless.
        """
        assert PRED.max_age_days == 7, (
            f"the joining horizon moved to {PRED.max_age_days} days — if that is "
            f"deliberate, say why here"
        )


class TestTheEventIsUsable:
    def test_days_until_is_emitted_and_declared(self):
        """The severity number, and both halves have to agree.

        The SQL selects it; the registry declares it as a field a rule may
        condition on. Either one alone is a condition that can never match.
        """
        from services.niyam.registry import fields_for
        assert "AS days_until" in sql()
        keys = {f.key for f in fields_for(EMPLOYEE_JOINING_SOON)}
        assert "days_until" in keys, (
            f"days_until is emitted but not offerable as a condition: {keys}"
        )

    @pytest.mark.parametrize("key", ["department", "designation", "employment_type"])
    def test_every_declared_field_is_actually_selected(self, key):
        """A field the builder offers but the event never carries is a condition
        that silently evaluates against nothing."""
        assert f"AS {key}" in sql(), f"{key} is offerable but never emitted"


class TestNoPredicateShadowsTheAntiJoinAlias:
    """SHIPPED TO PRODUCTION AND CAUGHT BY SENTRY, 2026-09-05.

    `_anti_join` opens `NOT EXISTS (SELECT 1 FROM public.niyam_events e ...)`
    and the entity expression is interpolated INSIDE that subquery. So a
    predicate whose own FROM binds `e` is shadowed by it, and its entity
    expression silently resolves against `niyam_events` instead:

        FROM public.manav_employees e
        WHERE NOT EXISTS (SELECT 1 FROM public.niyam_events e
                          WHERE e.dedupe_key = $3::text || ':' || e.id::text)

    `niyam_events` has `event_id` and no `id`, so every tick died with
    `UndefinedColumnError: column e.id does not exist` — 22 events on
    `/api/internal/niyam/sweep` before it was found.

    ⚠ WHY THE PRE-DEPLOY CHECK MISSED IT. The SQL was validated with PREPARE
    against the real schema, but with `{anti_join:…}` replaced by `TRUE` — so
    the composed statement, which is the only one that ever runs, was never
    the thing checked. Validating a fragment is not validating the query.

    This runs over EVERY predicate, not just the one that broke.
    """

    @pytest.mark.parametrize("pred", PREDICATES, ids=lambda p: p.name)
    def test_the_outer_query_does_not_bind_e(self, pred):
        from services.niyam.predicates import resolved_sql
        body = re.sub(r"--.*", "", pred.sql)
        aliases = re.findall(r"FROM\s+public\.[a-z_]+\s+([a-z_]+)", body, re.I)
        assert "e" not in aliases, (
            f"{pred.name} binds `e` as a table alias. The anti-join subquery "
            f"already uses `e` for niyam_events and is interpolated inside this "
            f"query, so `e.<col>` resolves there instead — the sweep will die "
            f"with `column e.<col> does not exist` every 15 minutes. "
            f"Aliases found: {aliases}"
        )

    @pytest.mark.parametrize("pred", PREDICATES, ids=lambda p: p.name)
    def test_the_entity_expression_uses_a_live_alias(self, pred):
        """The expression handed to `{anti_join:…}` must name an alias the
        OUTER query actually binds — otherwise it resolves to the subquery's
        `e` or to nothing at all."""
        from services.niyam.predicates import resolved_sql
        m = re.search(r"\{anti_join:([^}]*)\}", pred.sql)
        assert m, f"{pred.name} has no anti-join placeholder"
        expr = m.group(1)
        used = set(re.findall(r"\b([a-z_]+)\.", expr))
        body = re.sub(r"--.*", "", pred.sql)
        bound = set(re.findall(r"FROM\s+public\.[a-z_]+\s+([a-z_]+)", body, re.I))
        bound |= set(re.findall(r"JOIN\s+public\.[a-z_]+\s+([a-z_]+)", body, re.I))
        stray = used - bound
        assert not stray, (
            f"{pred.name}'s anti-join expression {expr!r} names {stray}, which "
            f"the outer query never binds ({bound})"
        )
