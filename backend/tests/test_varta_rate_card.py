"""The WhatsApp rate card, and the one property it must never lose.

── WHAT THIS FILE IS DEFENDING ──────────────────────────────────────────────

Phase 0.27 seeds `staging.varta_rate_card` (migration 227) with ESTIMATE
figures, because Meta's own INR card sits behind a Business Manager login. The
owner's decision is explicit about the condition attached: *the estimate must be
visibly an estimate wherever it surfaces.* An unmarked guess about what a
customer will be charged is worse than no number at all.

So the failure this file exists to catch is not a wrong rate. It is a RIGHT-
LOOKING rate that has lost its caveat somewhere between the row and the screen.
Four mechanisms carry the stamp and each is asserted here:

  1. the column          `rate_basis`, NOT NULL, DEFAULT 'estimate'
  2. the constraint      `varta_rate_card_estimate_note_ck` — an estimate row
                         cannot exist with an empty note
  3. the API             `is_estimate` on every row, and the word "estimate"
                         INSIDE the pre-formatted `rate_display` string
  4. the refusal         a stamp-less estimate has its NUMBER WITHHELD

── TWO HALVES, AND NOTHING IS WRITTEN ───────────────────────────────────────

Staging and production share one Supabase database, so nothing here writes a
row. The same separation `test_storage_browser_sql.py` argues for:

  1. OFFLINE. `_rate_row` and the endpoint's envelope are pure functions of a
     row, driven with recorded row shapes. Runs with no database.
  2. LIVE. The router's SQL is Parsed and Described against the real catalogue
     — `prepare()` plans the statement and STOPS, executing nothing — and the
     catalogue and the seeded rows are read directly for the parts `prepare()`
     cannot see: that the four honesty constraints are really in
     `pg_constraint` (an inline CHECK on `CREATE TABLE IF NOT EXISTS` is
     skipped whole when the table already exists, so the migration file is not
     evidence), and that no live row is an unstamped guess.

Run the live half with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_varta_rate_card.py -q
"""
from __future__ import annotations

import asyncio
import os

import pytest

import routers.whatsapp as wa


ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"      # E2E Test & Associates, in scope


def _row(**over) -> dict:
    """A rate card row in the shape the live SELECT returns it."""
    base = {
        "category": "marketing",
        "rate_per_message": 0.8631,
        "currency": "INR",
        "country_code": "IN",
        "pricing_model": "per_message",
        "free_in_service_window": False,
        "free_in_entry_point_window": True,
        "rate_basis": "estimate",
        "estimate_note": "ESTIMATE — not Meta's own rate card.",
        "source_url": "https://whautomate.com/whatsapp-business-api-pricing-india",
        "source_read_on": "2026-08-27",
        "billed_by": "meta",
        "billed_to": "organisation",
        "effective_from": "2026-01-01",
        "effective_to": None,
        "notes": "",
        "org_specific": False,
    }
    base.update(over)
    return base


class _Pool:
    """Answers the one SELECT with a scripted list. Holds no connection."""

    def __init__(self, rows):
        self._rows = rows
        self.calls: list[tuple] = []

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return self._rows


def _call(rows, **kw) -> dict:
    """Drive the endpoint directly.

    `Depends(...)` resolves for ROUTES ONLY — a direct call receives the
    sentinel object, so `user` and `_g` are passed explicitly as None and
    `org_id` as a real value. That is the documented shape of this mistake in
    this repo; it is not a shortcut.
    """
    pool = _Pool(rows)

    async def fake_get_pool():
        return pool

    original = wa.get_pool
    wa.get_pool = fake_get_pool
    try:
        out = asyncio.run(wa.rate_card(
            country=kw.get("country", "IN"), on=kw.get("on"),
            user=None, org_id=kw.get("org_id", ORG), _g=None,
        ))
    finally:
        wa.get_pool = original
    out["_pool"] = pool
    return out


# ══════════════════════════════════════════════════════════════════════════
#  1 · The stamp — offline, and this is the whole point of the feature
# ══════════════════════════════════════════════════════════════════════════

def test_every_rate_carries_is_estimate():
    """Not "usually", not "when the caller asks for it". Every row, always."""
    out = _call([_row(), _row(category="utility", rate_per_message=0.115)])
    assert out["rates"], "the endpoint returned no rates at all"
    for r in out["rates"]:
        assert "is_estimate" in r, f"{r['category']} has no is_estimate key"
        assert isinstance(r["is_estimate"], bool)


def test_the_word_estimate_is_inside_the_number_itself():
    """`rate_display` is the string a surface prints. The caveat lives INSIDE
    it, so a template that renders the price cannot drop the caveat by
    forgetting a second field — the commonest way this regresses."""
    out = _call([_row()])
    display = out["rates"][0]["rate_display"]
    assert "0.8631" in display
    assert "estimate" in display.lower(), (
        f"rate_display is {display!r} — a price with no caveat in it")


def test_a_free_rate_still_says_estimate():
    """₹0 is the easiest number to render without its caveat, because "Free"
    reads like a fact rather than a figure. It is still a guess."""
    out = _call([_row(category="service", rate_per_message=0.0)])
    display = out["rates"][0]["rate_display"]
    assert "free" in display.lower()
    assert "estimate" in display.lower(), (
        f"a free rate rendered as {display!r} with no caveat")


def test_an_estimate_with_no_note_has_its_number_withheld():
    """THE REFUSAL. `varta_rate_card_estimate_note_ck` makes this row
    impossible in the database, so this fires only if that constraint is ever
    dropped — which is exactly when it matters. The failure mode is "no
    number", never "unlabelled number"."""
    out = _call([_row(estimate_note="   ")])
    r = out["rates"][0]
    assert r["rate_per_message"] is None, "an unstamped guess was served as a figure"
    assert r["rate_display"] == "Withheld"
    assert r["withheld_reason"]


def test_a_real_meta_rate_is_not_labelled_an_estimate():
    """The stamp has to be able to come OFF, or it means nothing. When 0.26
    lands and the owner connects the account, a `meta_rate_card` row must read
    as a fact."""
    out = _call([_row(rate_basis="meta_rate_card", estimate_note="")])
    r = out["rates"][0]
    assert r["is_estimate"] is False
    assert "estimate" not in r["rate_display"].lower()
    assert r["rate_per_message"] == pytest.approx(0.8631)
    assert out["all_estimates"] is False
    assert out["estimate_note"] is None


# ══════════════════════════════════════════════════════════════════════════
#  2 · Whose money this is — offline
# ══════════════════════════════════════════════════════════════════════════

def test_the_response_says_meta_bills_the_organisation():
    """Decision 0.18 and P7 both: Meta bills the org's own WABA, Aekam resells
    nothing. A pricing screen that does not say whose bill this is invites the
    reading that Kartavaya is charging it."""
    out = _call([_row()])
    assert out["billed_by"] == "meta"
    assert out["billed_to"] == "organisation"
    note = out["billing_note"].lower()
    assert "meta bills" in note
    assert "does not resell" in note
    for r in out["rates"]:
        assert r["billed_by"] == "meta"
        assert r["billed_to"] == "organisation"


def test_there_is_no_margin_field_anywhere_in_the_response():
    """A margin column would be a schema quietly contradicting 0.18. If one
    ever appears this test is where the decision gets re-opened deliberately
    rather than by accident.

    KEYS, not prose: `billing_note` contains the sentence "adds no margin to
    them", which is the opposite of the thing being banned. Scanning the whole
    repr would fail on the disclaimer that exists to make the point.
    """
    out = _call([_row()])
    keys = set(out) | {k for r in out["rates"] for k in r}
    for banned in ("margin", "markup", "sell_price", "our_price", "aekam_price"):
        hits = [k for k in keys if banned in k.lower()]
        assert not hits, f"{hits} reached the rate-card response"


def test_the_set_level_estimate_facts_are_returned():
    """A surface must be able to draw one banner without looping the rows."""
    out = _call([_row(), _row(category="utility", rate_per_message=0.115)])
    assert out["estimate_count"] == 2
    assert out["all_estimates"] is True
    assert out["any_estimates"] is True
    assert "estimate" in out["estimate_note"].lower()
    assert out["source_read_on"] == "2026-08-27"


def test_the_card_is_only_as_fresh_as_its_stalest_row():
    """`source_read_on` at the envelope is the MINIMUM, not the maximum. A card
    where four rows were re-read today and one is two years old is two years
    old."""
    out = _call([
        _row(source_read_on="2026-08-27"),
        _row(category="utility", rate_per_message=0.115, source_read_on="2024-01-05"),
    ])
    assert out["source_read_on"] == "2024-01-05"


# ══════════════════════════════════════════════════════════════════════════
#  3 · Ratchets this router must not break — offline
# ══════════════════════════════════════════════════════════════════════════

def test_no_org_uuid_reaches_the_client():
    """Names, not IDs. The row carries `org_id`; the response carries only the
    boolean `org_specific`, so a screen can say "your negotiated rate" without
    printing a tenant identifier at anybody."""
    out = _call([_row()])
    assert "org_id" not in out["rates"][0]
    assert ORG not in repr(out["rates"])
    assert out["rates"][0]["org_specific"] is False


def test_rates_are_ordered_worst_news_first():
    """Marketing is what costs money; service is free. Alphabetical order puts
    `authentication_international` — the rarest row — at the top."""
    out = _call([
        _row(category="service", rate_per_message=0.0),
        _row(category="utility", rate_per_message=0.115),
        _row(category="marketing"),
    ])
    assert [r["category"] for r in out["rates"]] == [
        "marketing", "utility", "service"]


def test_the_unreadable_enum_value_gets_a_human_label():
    out = _call([_row(category="authentication_international", rate_per_message=2.3)])
    assert out["rates"][0]["label"] == "Authentication · international"


def test_the_country_is_upper_cased_before_it_reaches_the_bind():
    """`country_code` is stored 'IN'. A lower-case query parameter must not
    silently return an empty card."""
    out = _call([_row()], country="in")
    sql, args = out["_pool"].calls[0]
    assert args[0] == "IN"
    assert out["country_code"] == "IN"


def test_the_query_is_org_scoped_and_date_bounded():
    """Three binds, in this order: country, org, as-at. The org bind is what
    lets an org's own contracted rate beat the shared national row."""
    out = _call([_row()], on="2026-03-01")
    sql, args = out["_pool"].calls[0]
    assert args == ("IN", ORG, "2026-03-01")
    assert "org_id IS NULL OR org_id = $2::uuid" in sql
    assert "$3::date" in sql


# ══════════════════════════════════════════════════════════════════════════
#  4 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and reads the seeded rows; it cannot be done offline — a "
    "MagicMock pool answers happily to a SELECT naming a table that does not "
    "exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_varta_rate_card.py -q"
)

#: The four CHECKs migration 227 adds BY NAME. They are asserted from
#: `pg_constraint` and never from the file: an inline CHECK on a
#: `CREATE TABLE IF NOT EXISTS` whose table already exists is skipped WHOLE and
#: leaves no trace, which is the trap migration 201 documents.
REQUIRED_CONSTRAINTS = (
    "varta_rate_card_estimate_note_ck",
    "varta_rate_card_meta_source_ck",
    "varta_rate_card_source_url_ck",
    "varta_rate_card_effective_ck",
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _probe():
    """Parse and Describe the router's SELECT; then read the catalogue.

    NOTHING IS EXECUTED from the router's own SQL — `prepare()` sends Parse and
    Describe and stops. The statements that do execute are reads of
    `pg_constraint` and of `varta_rate_card`, which holds no customer data:
    five shared rows of published pricing.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)

            plan_error = None
            declared = None
            try:
                stmt = await conn.prepare(wa._RATE_CARD_SQL)
                declared = len(stmt.get_parameters())
            except Exception as exc:                              # noqa: BLE001
                plan_error = f"{type(exc).__name__}: {exc}"

            constraints = [r["conname"] for r in await conn.fetch(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = 'staging.varta_rate_card'::regclass")]

            rows = [dict(r) for r in await conn.fetch(
                "SELECT category, rate_per_message, rate_basis, estimate_note, "
                "       source_url, source_read_on, billed_by, billed_to, "
                "       org_id IS NULL AS shared "
                "  FROM staging.varta_rate_card")]

            default = await conn.fetchval(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_schema='staging' AND table_name='varta_rate_card' "
                "  AND column_name='rate_basis'")

            return plan_error, declared, constraints, rows, default
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    try:
        return _probe()
    except Exception as exc:                                      # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_the_routers_sql_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means an uncast `$1 + $2`, which PgBouncer turns into
    an instant 500."""
    plan_error, _, _, _, _ = live
    assert plan_error is None, f"{plan_error}\n\n{wa._RATE_CARD_SQL}"


def test_the_sql_declares_as_many_parameters_as_the_router_binds(live):
    _, declared, _, _, _ = live
    assert declared == 3, (
        f"the statement declares {declared} placeholders; rate_card() binds 3")


def test_the_four_honesty_constraints_are_really_on_the_table(live):
    """Read from `pg_constraint`, not from migration 227. This is the assertion
    that would have caught the CHECK-skipped-silently failure."""
    _, _, constraints, _, _ = live
    missing = [c for c in REQUIRED_CONSTRAINTS if c not in constraints]
    assert not missing, f"missing from pg_constraint: {missing}"


def test_the_safe_value_is_the_default(live):
    """A row inserted by somebody who did not think about it must be stamped a
    guess. The unsafe value has to be typed out."""
    _, _, _, _, default = live
    assert default is not None and "estimate" in default, (
        f"rate_basis default is {default!r} — it must default to 'estimate'")


def test_no_live_row_is_an_unstamped_guess(live):
    """The invariant, against real rows. Must hold forever."""
    _, _, _, rows, _ = live
    assert rows, "varta_rate_card is empty — migration 227 seeded nothing"
    bad = [r["category"] for r in rows
           if r["rate_basis"] == "estimate" and not (r["estimate_note"] or "").strip()]
    assert not bad, f"unstamped estimate rows: {bad}"


def test_every_live_row_is_cited_and_dated(live):
    """A figure with no source and no read-date is a number nobody can check."""
    _, _, _, rows, _ = live
    for r in rows:
        assert (r["source_url"] or "").strip(), f"{r['category']} has no source"
        assert r["source_read_on"], f"{r['category']} has no read date"


def test_every_live_row_says_meta_bills_the_organisation(live):
    _, _, _, rows, _ = live
    for r in rows:
        assert r["billed_by"] == "meta"
        assert r["billed_to"] == "organisation"


def test_the_seeded_card_is_shared_not_owned_by_one_org(live):
    """Meta's published India price is one national fact. A seeded row scoped
    to a single org would leave every other org with an empty card — which is
    the shape the professional-tax ladder was in until 2026-08-26."""
    _, _, _, rows, _ = live
    seeded = [r for r in rows if r["rate_basis"] == "estimate"]
    assert seeded, "no estimate rows live"
    assert all(r["shared"] for r in seeded), (
        "a seeded estimate is scoped to one org")


def test_the_router_and_the_live_rows_agree_on_the_stamp(live):
    """END TO END, on real data: take what the database actually holds, put it
    through the endpoint's own formatter, and assert the caveat survives. This
    is the assertion the owner's condition reduces to."""
    _, _, _, rows, _ = live
    for r in rows:
        formatted = wa._rate_row({
            **r,
            "currency": "INR", "country_code": "IN",
            "pricing_model": "per_message",
            "free_in_service_window": False,
            "free_in_entry_point_window": False,
            "effective_from": None, "effective_to": None, "notes": "",
            "org_specific": not r["shared"],
        })
        if r["rate_basis"] != "estimate":
            continue
        assert formatted["is_estimate"] is True
        assert "estimate" in formatted["rate_display"].lower(), (
            f"{r['category']} renders as {formatted['rate_display']!r} "
            "with no caveat")
