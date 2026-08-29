"""The Finance and CRM by-member sections — the SQL parses, and the page
cannot lie about attribution or gross-profit coverage.

── WHAT THIS FILE IS DEFENDING ─────────────────────────────────────────────

The owner asked for member attribution on the Finance and CRM reports. Three
things would make that document worse than not having it, and each is pinned
below:

  1. The unattributed majority collapsing into a person. Live on Unicode Group
     2026-08-29: 39 of 51 issued documents and 28 of 33 deals have no owner, so
     the "Unassigned" line carries 94% of turnover and 96% of pipeline value.
     The first draft of the query printed it under `'Unnamed member'` — the
     label `audit_actors` uses for a real person whose account has no name —
     which attributed ₹3.42 crore of pipeline to a person who does not exist.

  2. A gross-profit figure over a book whose cost is mostly unknown. Cost is
     recorded on 2.49% of Unicode's taxable turnover, and the costed lines are
     the SMALL ones — a ₹2,500 product line beside a ₹236,000 service line.

  3. An email address printed where a person's name belongs.

── THE LIVE HALF ───────────────────────────────────────────────────────────

⚠ NOTHING IS EXECUTED. `prepare()` sends Parse and Describe and stops: the
server plans the statement, resolves every relation, column and cast, and no
`fetch` is ever called on the handle. Staging shares its database with
production, so that distinction is the whole safety story — the same one
`test_org_profile_state_code.py` and `test_manav_custody_write_paths_live_sql.py`
rest on.

The statements are taken from the MODULE'S OWN CONSTANTS, never retyped. A copy
would go stale the moment somebody edits the query, and a stale copy that still
parses is a green test over a broken report.

Run against the real schema:

    cd backend && DATABASE_URL=... python -m pytest tests/test_member_activity.py -q
"""
import asyncio
import os

import pytest

from services.report_defs import REPORT_DEFS, load_all
from services.report_defs.member_activity import (
    CRM_COLUMNS, CRM_KEY, CRM_SQL, FINANCE_COLUMNS, FINANCE_KEY, FINANCE_SQL,
    LABEL_COLUMN, UNASSIGNED, build_crm_rows, build_finance_rows, member_label)

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These statements reach `staging.ganit_invoices` "
    "(including `line_items` as jsonb), `staging.graha_deals` and "
    "`public.users`, and cast a jsonb text field to numeric. A MagicMock pool "
    "answers happily to a statement naming a column that is not there — which "
    "is exactly how a router ships a 500. Only the real catalogue can check it."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if (not dsn or dsn == _PLACEHOLDER_DSN) else dsn


def _describe(statements):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            out = []
            for label, sql in statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    out.append((label, f"{type(exc).__name__}: {exc}"))
            return out
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def failures():
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    return _describe([("finance_by_member", FINANCE_SQL),
                      ("crm_by_member", CRM_SQL)])


def test_both_statements_parse_against_the_live_schema(failures):
    """Every relation, column, cast and parameter, resolved by the server.

    ⚠ The parameter numbering is part of what this checks, and it is the half
    that bit during development. The finance query originally bound the numeric
    regex as `$5` while nothing referenced `$5` — Postgres infers a type for
    every `$1..$N` up to the highest one REFERENCED, so the gap raises "could
    not determine data type of parameter $5" at query time, inside a report a
    cron mails. `prepare()` is what surfaces that without sending it.
    """
    assert not failures, "\n".join(f"  {label}: {err}" for label, err in failures)


def test_the_cost_price_cast_is_guarded_against_the_empty_string():
    """The live data holds `""` for an uncosted line, and `''::numeric` raises.

    Measured 2026-08-29 on Unicode Group: a typical invoice is two lines, one
    with `cost_price: 1300.0` and one with `cost_price: ""`. `(e->>'cost_price')
    ::numeric` over that book is `invalid input syntax for type numeric: ""` —
    a 500 inside a scheduled report, where nobody is watching.

    So the regex guard is not decoration and it is asserted here rather than
    trusted to survive an edit: every cast of a jsonb text field to numeric in
    this query must sit behind a `~ $5::text` test in the same WHERE.
    """
    for field in ("cost_price", "line_total", "quantity"):
        cast = f"(e->>'{field}')::numeric"
        if cast not in FINANCE_SQL:
            continue
        assert f"(e->>'{field}') ~ $5::text" in FINANCE_SQL, (
            f"{field} is cast to numeric but is not matched against the "
            f"numeric-text pattern first. The live book holds '' on uncosted "
            f"lines and that cast raises.")


@pytest.mark.asyncio
async def test_the_two_owner_columns_are_text_and_join_public_users():
    """`salesperson_id` and `assigned_to` hold `public.users.user_id`, TEXT.

    Read off the live catalogue rather than the migration file. If either ever
    becomes a uuid, `LEFT JOIN public.users u ON u.user_id = d.actor` stops
    matching — silently, because a LEFT JOIN that matches nothing returns NULLs
    rather than an error, and every row would move to the Unassigned line while
    looking like a firm that stopped recording who sold anything.
    """
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    import asyncpg

    conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
    try:
        rows = await conn.fetch(
            "SELECT table_name, column_name, data_type "
            "  FROM information_schema.columns "
            " WHERE (table_schema='staging' AND table_name='ganit_invoices' "
            "        AND column_name='salesperson_id') "
            "    OR (table_schema='staging' AND table_name='graha_deals' "
            "        AND column_name='assigned_to') "
            "    OR (table_schema='public' AND table_name='users' "
            "        AND column_name='user_id')")
    finally:
        await conn.close()

    found = {r["column_name"]: r["data_type"] for r in rows}
    for col in ("salesperson_id", "assigned_to", "user_id"):
        assert col in found, f"{col} is missing — the member join cannot resolve."
        assert found[col] == "text", (
            f"{col} is now {found[col]}, not text. The join to public.users "
            f"would stop matching and every row would silently move to the "
            f"Unassigned line.")


# ═════════════════════════════════════════════════════════════════════════════
# THE OFFLINE HALF — what the page says, which is where a report lies
# ═════════════════════════════════════════════════════════════════════════════

def test_unassigned_and_unnamed_are_never_the_same_word():
    """The bug this file exists for, in one assertion.

    `audit_actors.UNNAMED` means "a person is recorded and their account has no
    name". A NULL owner falls down the same COALESCE ladder and lands on the
    same string. Collapsing them attributed ₹3.42 crore of unassigned pipeline
    to a phantom member on the first run of this query.
    """
    from services.audit_actors import UNNAMED

    assert UNASSIGNED != UNNAMED
    assert member_label(None, unassigned=True) == UNASSIGNED
    # The row the SQL produced for the unassigned bucket carries the ladder's
    # own fallback in `member`. `unassigned` — not the name — must decide.
    assert member_label(UNNAMED, unassigned=True) == UNASSIGNED
    assert member_label(UNNAMED, unassigned=False) == UNNAMED


def test_a_name_that_is_an_email_address_is_not_printed():
    """One live Unicode account's `full_name` IS an address.

    `aekaminc1+org@gmail.com`, measured 2026-08-29. The ladder returns it
    correctly — the fault is one layer down, in the column — and no ladder test
    can see it. This document is handed to people, so it refuses the value.
    """
    assert member_label("aekaminc1+org@gmail.com", unassigned=False) \
        == "Unnamed member"
    assert member_label("Anaya Iyer", unassigned=False) == "Anaya Iyer"


def test_an_empty_period_prints_no_footer_at_all():
    """`render_report_html` prints "No rows for this period", which is honest.

    A lone row of zeros reads as "we looked and nothing happened" when it may
    equally mean nothing was looked at — `receivables_ageing`'s rule.
    """
    assert build_finance_rows([]) == []
    assert build_crm_rows([]) == []


def _finance_fixture():
    """The live Unicode shape, 2026-08-29, as the SQL actually returned it."""
    return [
        {"unassigned": False, "member": "Keval UK", "documents": 12,
         "taxable_value": 211980.0, "total": 250136.4, "paid": 158828.0,
         "costed_revenue": 0.0, "gross_profit": 0.0},
        {"unassigned": True, "member": "Unnamed member", "documents": 39,
         "taxable_value": 3165338.0, "total": 3733908.84, "paid": 3173565.24,
         "costed_revenue": 84000.0, "gross_profit": 36000.0},
    ]


def test_the_footer_totals_the_counts_as_well_as_the_money():
    """`_shared.total_row` blanks every non-money column, which here would blank
    the document count — the one number a reader checks first."""
    rows = build_finance_rows(_finance_fixture())
    footer = rows[-2]                       # the coverage line is last
    assert footer[LABEL_COLUMN] == "All members"
    assert footer["Documents"] == 51
    assert footer["Total"] == 3984045.24
    assert footer["Taxable value"] == 3377318.0


def test_gross_profit_never_appears_without_the_revenue_it_covers():
    """The seventh wrong figure this page would have printed.

    ₹36,000 of gross profit beside ₹33,77,318 of turnover is a margin on 2.49%
    of the book. Both the covering column and the stated coverage line have to
    be there, and the percentage has to be the real one.
    """
    rows = build_finance_rows(_finance_fixture())
    assert "Revenue with cost" in FINANCE_COLUMNS
    assert FINANCE_COLUMNS.index("Revenue with cost") \
        < FINANCE_COLUMNS.index("Gross profit"), (
        "the covering revenue must be READ FIRST — a reader who meets the "
        "profit column first has already formed the wrong impression")

    coverage = rows[-1][LABEL_COLUMN]
    assert "84,000" in coverage and "3,377,318" in coverage, coverage
    assert "2.5%" in coverage, coverage


def test_a_book_with_no_cost_prices_says_so_rather_than_printing_zero():
    """29 of Unicode's 51 documents carry no cost anywhere.

    An org where that is ALL of them must not receive a page reading "Gross
    profit 0.00" with no explanation — that is a claim about the business
    rather than about the data.
    """
    rows = build_finance_rows([
        {"unassigned": False, "member": "Anaya Iyer", "documents": 3,
         "taxable_value": 90000.0, "total": 106200.0, "paid": 0.0,
         "costed_revenue": 0.0, "gross_profit": 0.0}])
    coverage = rows[-1][LABEL_COLUMN]
    assert "no line in this period carries a cost price" in coverage, coverage


def test_a_credit_note_reduces_a_members_figures():
    """`sign` is applied in SQL; this pins that the builder does not undo it.

    A register that adds reversals to turnover overstates it, and this one
    reports per PERSON — so a credit note raised against somebody's sale has to
    come off that person's line, not off the firm's total only.
    """
    rows = build_finance_rows([
        {"unassigned": False, "member": "Anaya Iyer", "documents": 2,
         "taxable_value": -5000.0, "total": -5900.0, "paid": 0.0,
         "costed_revenue": 0.0, "gross_profit": 0.0}])
    assert rows[0]["Taxable value"] == -5000.0
    assert rows[-2]["Total"] == -5900.0


def test_the_crm_columns_are_all_events_in_the_period():
    """`grain='flow'` promises a period. A count of currently-open deals is a
    stock, and mixing the two is how "won this week" comes to include a deal
    won last year."""
    assert CRM_COLUMNS == [LABEL_COLUMN, "Deals created", "Deals won",
                           "Deals lost", "Value created", "Value won"]
    for phrase in ("d.won_at::date BETWEEN $2::date AND $3::date",
                   "d.lost_at::date BETWEEN $2::date AND $3::date",
                   "d.created_at::date BETWEEN $2::date AND $3::date"):
        assert phrase in CRM_SQL, phrase


def test_the_crm_footer_sums_deals_and_value():
    rows = build_crm_rows([
        {"unassigned": False, "member": "Anaya Iyer", "deals_created": 1,
         "deals_won": 1, "deals_lost": 0, "value_created": 400000.0,
         "value_won": 400000.0},
        {"unassigned": True, "member": "Unnamed member", "deals_created": 28,
         "deals_won": 4, "deals_lost": 3, "value_created": 34230000.0,
         "value_won": 3600000.0},
    ])
    assert rows[0][LABEL_COLUMN] == "Anaya Iyer"
    assert rows[1][LABEL_COLUMN] == UNASSIGNED
    footer = rows[-1]
    assert footer["Deals created"] == 29
    assert footer["Value created"] == 34630000.0
    assert footer["Value won"] == 4000000.0


def test_neither_section_reads_a_module_it_does_not_declare():
    """`reads` is the entitlement, and a join is how a report becomes the way
    past a grant. Both sections read exactly their own module."""
    load_all()
    assert REPORT_DEFS[FINANCE_KEY].reads == frozenset({"ganit"})
    assert REPORT_DEFS[CRM_KEY].reads == frozenset({"graha"})
    # If either statement grows a `staging.graha_` / `staging.vikray_` table,
    # `reads` has to grow with it IN THE SAME COMMIT.
    assert "staging.graha_" not in FINANCE_SQL
    assert "staging.vikray_" not in FINANCE_SQL
    assert "staging.ganit_" not in CRM_SQL


# ═════════════════════════════════════════════════════════════════════════════
# THE SECTIONS ARE ACTUALLY REACHABLE — the failure this repo shipped five
# times in one day: the route exists and no screen can ask for it
# ═════════════════════════════════════════════════════════════════════════════

def _registry_loaded():
    """`analytics.REGISTRY` fills as metric modules import, and the app imports
    them through the router. A test that checks a preset cut without them sees
    every metric widget dropped and would read the result as a regression."""
    import importlib
    import pkgutil

    import analytics.metrics as M

    for m in pkgutil.iter_modules(M.__path__):
        importlib.import_module("analytics.metrics." + m.name)


def test_a_preset_can_hold_a_section_at_all():
    """⚠ IT COULD NOT UNTIL THIS COMMIT, AND THE FAILURE WAS A KeyError.

    `module_arrangement`'s preset branch filtered on `w["metric"] in REGISTRY`
    for every entry. A section entry is `{"report": ...}` and has no `metric`
    key, so the first preset carrying one would raise KeyError — inside a report
    a cron mails. This is the SAME bug `report_entry`'s docstring records being
    fixed at `routers/analytics.py`; it was left here, latent, because no preset
    held a section. Two now do.
    """
    from services.module_report import _preset_entry_belongs

    _registry_loaded()
    section = {"report": FINANCE_KEY}
    with pytest.raises(KeyError):
        _ = section["metric"]           # what the old expression did
    assert _preset_entry_belongs(section, "ganit") is True
    assert _preset_entry_belongs(section, "graha") is False
    # A widget still resolves exactly as before.
    assert _preset_entry_belongs({"metric": "ganit.outstanding"}, "ganit") is True
    # A retired section key is dropped from OUR OWN preset rather than printed
    # on a customer's page as a stated absence.
    assert _preset_entry_belongs({"report": "ganit.retired_ages_ago"},
                                 "ganit") is False


def test_the_emailed_finance_and_crm_reports_carry_the_member_table():
    """The owner asked for the REPORT to name members. A `ReportDef` nobody's
    arrangement holds is a capability with no door.

    ⚠ THE PRESET THIS RESOLVES TO IS NOT THE OBVIOUS ONE. `module_arrangement`
    walks `PRESETS` in insertion order and takes the FIRST naming the module —
    and `founder` names `ganit` and comes before `finance`. Adding the section
    to `finance` alone would have shipped it invisible on every org that has not
    saved a default of its own, which is every new org. Asserted by walking the
    same order the resolver walks, so it stays true if a preset is reordered.
    """
    from analytics.presets import PRESETS
    from services.module_report import (REPORT_TYPE_MODULES,
                                        _preset_entry_belongs)

    _registry_loaded()

    def first_preset_layout(module):
        for key, p in PRESETS.items():
            if module not in p.get("modules", ()):
                continue
            layout = [w for w in p["layout"]
                      if _preset_entry_belongs(w, module)]
            if layout:
                return key, layout
        return None, []

    # The two scheduled report types the owner named, through the same map the
    # dispatcher uses — so this cannot pass by naming a module the report type
    # does not actually render.
    for report_type, expected_section in (("revenue", FINANCE_KEY),
                                          ("pipeline", CRM_KEY)):
        module = REPORT_TYPE_MODULES[report_type]
        key, layout = first_preset_layout(module)
        sections = [w.get("report") for w in layout if "report" in w]
        assert expected_section in sections, (
            f"the '{report_type}' report resolves preset:{key} for module "
            f"{module}, and that arrangement does not carry {expected_section} "
            f"— so the member table the owner asked for never reaches the "
            f"emailed report")
        assert len(layout) > len(sections), (
            "the metric widgets were dropped from the cut — the section filter "
            "is rejecting widgets it should keep")


def test_the_scheduled_send_can_render_these_sections_without_a_gate():
    """The engine's scheduled send passes `gate=None`, and `report_section`
    then WITHHOLDS every FOREIGN module a section reads — fail-closed, by
    design. A section declaring two modules would therefore render as
    "Withheld" on the very path the owner asked for.

    Both of these declare exactly their own module, so `report_section`'s "the
    page's own module" shortcut skips the only code in `reads` and no gate is
    needed. That is why `reads` is one module and not two, and it is asserted
    rather than left as a comment.
    """
    load_all()
    for key in (FINANCE_KEY, CRM_KEY):
        d = REPORT_DEFS[key]
        assert d.reads == frozenset({d.module}), (
            f"{key} reads {sorted(d.reads)}. Anything beyond its own module is "
            f"withheld on the scheduled path, where there is no gate to ask.")


def test_no_column_renders_a_user_or_org_id():
    """Names, never ids — on a page the firm hands to somebody.

    The frontend ratchet (`check-rendered-ids.mjs`) cannot see a PDF, so the
    check has to be here: the only identity either query SELECTs is the name
    expression, and `salesperson_id` / `assigned_to` appear solely inside
    predicates.
    """
    for sql in (FINANCE_SQL, CRM_SQL):
        assert "AS member" in sql
        for ident in ("AS salesperson_id", "AS assigned_to", "AS user_id",
                      "AS org_id", "AS actor,"):
            assert ident not in sql.replace("i.salesperson_id AS actor,", ""), \
                f"{ident} is projected — that is an id on a printed page"
