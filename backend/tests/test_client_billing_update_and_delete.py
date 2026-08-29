"""The three client-billing money-path repairs of 2026-08-29, and their fences.

── WHAT WAS BROKEN, MEASURED BEFORE IT WAS TOUCHED ──────────────────────────

Proposal 93 Suite 17 drove the six Ganit client-billing screens against the
deployed staging service and stopped on three walls. All three are one shape —
**the API can do it and the screen offers no way to ask, or the screen asks and
there is no route behind it** — which `routers/graha.py` already records twice
in its own comments (`territory_id`: "a territory could be defined and never
used"; `contact_id`: "The column was writable and unreachable").

  1 · **A PAUSED SUBSCRIPTION COULD NEVER BE RESUMED** (17.04). Two walls, and
      the second one is why fixing only the first would have been worse than
      leaving it alone:

        · `ServiceLinesTab`'s Ended table had no action cell, so an ended line
          could not be OPENED from the screen that draws it; and
        · `update_service_line` applied a field only `if val is not None`,
          while `ServiceLinesTab.save()` sends `period_end: form.period_end ||
          null` — the only spelling the form has for "there is no end date". So
          the Clear button would have produced a **200 that changed nothing**:
          a success toast over an unchanged row.

  2 · **THE DELETE BUTTON ON A RATE CARD HAD NO ROUTE** (17.05). Measured live
      2026-08-29: `DELETE /api/v1/ganit/billing/rate-cards/1527e774-…` →
      `405 {"detail":"Method Not Allowed"}`, and the deployed OpenAPI published
      `PATCH` alone for that path. The screen showed the customer the words
      "Method Not Allowed".

  3 · **A METERED-USAGE INVOICE COULD NEVER BE ISSUED** (17.07). It was written
      with `client_id` and no `contact_id`, and the Rule 46(e) recipient gate
      resolved the recipient through `contact_id` only — so a document that
      named a company was refused for naming nobody. Separately, both invoice
      writers here hardcoded the serial prefix `"INV"` while
      `ganit._doc_prefix` resolves it per org: Unicode Group's is `UNX`
      (`{"tax_invoice": "UNX", "purchase_order": "KRY"}`, read live the same
      day) and all 53 of its invoices are `UNX-2026-nnnn`. `next_doc_number`
      takes the last serial for the org WHATEVER its prefix and adds one, so
      the two writers shared one counter while disagreeing about its name.

── WHY THIS FILE, AND NOT A MOCK ────────────────────────────────────────────

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock
answers happily to a statement naming a column that is not there. That is
exactly how `gst_rate` — a column `staging.ganit_invoices` has never had —
survived in two INSERTs until `test_client_billing_invoices.py` planned them
against the real catalogue. This file follows that file's two-half shape and
reuses its `CapturePool`:

  1. CAPTURE, offline — the handlers run with a pool that records every
     statement and its bound arguments and answers from a script. Nothing is
     executed and nothing is written. Runs everywhere, including with no
     database.

  2. CHECK, live — `prepare()` sends Parse and Describe and STOPS: the server
     plans the statement and resolves every relation, column and parameter
     type without reading or writing a row. Plus the catalogue read directly,
     which is the one that keeps `_CLEARABLE_*` honest.

⚠ Staging and production share ONE Supabase database. **Nothing here writes.**
"""
import asyncio
import os

import pytest
from fastapi import HTTPException

import routers.client_billing as client_billing
from tests.test_client_billing_invoices import (
    CapturePool,
    SKIP_REASON,
    _SEARCH_PATH,
    live_dsn,
    pooled,  # noqa: F401  — the fixture, re-exported by importing it
)


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
CARD = "77777777-7777-7777-7777-777777777777"
LINE = "55555555-5555-5555-5555-555555555555"
USAGE = "66666666-6666-6666-6666-666666666666"
PROFILE = "44444444-4444-4444-4444-444444444444"

USER = {"user_id": "user_admin001"}


def _run(coro):
    return asyncio.run(coro)


# ══════════════════════════════════════════════════════════════════════════════
#  1 · A null now CLEARS — which is what resumes a paused subscription
# ══════════════════════════════════════════════════════════════════════════════
#
# Built from a DICT rather than by keyword, deliberately. `model_fields_set` is
# the whole mechanism: it holds the keys the request body actually carried, and
# `ServiceLineUpdate(period_end=None)` and `ServiceLineUpdate()` are
# indistinguishable by `getattr` but not by that set. Validating the dict is how
# a wire body arrives, so it is how the test presents one.


def _set_clause(sql: str, field: str) -> str | None:
    """The `field=$n[::cast]` fragment from an UPDATE's SET list, or None."""
    body = sql.split(" SET ", 1)[1].split(" WHERE ", 1)[0]
    for frag in body.split(", "):
        if frag.strip().startswith(f"{field}="):
            return frag.strip()
    return None


def test_an_explicit_null_end_date_is_written_and_that_is_the_resume(pooled):
    """THE FIX. `period_end: null` reaches the column as NULL."""
    pool = pooled([("UPDATE public.client_service_lines", {"id": LINE})])
    body = client_billing.ServiceLineUpdate.model_validate(
        {"description": "Retainer", "amount": 48000,
         "period_end": None, "auto_invoice": False})
    _run(client_billing.update_service_line(
        line_id=LINE, body=body, user=USER, org_id=ORG))

    sql, args = pool.one("UPDATE public.client_service_lines")
    clause = _set_clause(sql, "period_end")
    assert clause is not None, (
        "`period_end` is missing from the SET list, so clearing the end date is "
        "still a 200 that changes nothing and a paused subscription still "
        f"cannot be resumed.\n  SQL: {sql}")
    # The cast is not decoration: PgBouncer turns an untyped parse error into an
    # instant 500, and a NULL is exactly the argument Postgres cannot infer a
    # type for.
    assert clause.endswith("::date"), (
        f"`period_end` is bound without a ::date cast ({clause}). An untyped "
        "NULL through PgBouncer is an instant 500.")
    idx = int(clause.split("=$", 1)[1].split("::", 1)[0]) - 1
    assert args[idx] is None, (
        f"`period_end` was bound as {args[idx]!r} rather than NULL — the row "
        "keeps an end date and the line stays ended.")


def test_an_omitted_end_date_is_still_left_alone(pooled):
    """THE OTHER HALF. Saying nothing about a field must not clear it.

    A fix that wrote NULL for every absent key would erase an end date on any
    PATCH that did not mention one — turning a repair into a data-loss bug.
    """
    pool = pooled([("UPDATE public.client_service_lines", {"id": LINE})])
    body = client_billing.ServiceLineUpdate.model_validate({"amount": 50000})
    _run(client_billing.update_service_line(
        line_id=LINE, body=body, user=USER, org_id=ORG))

    sql, _ = pool.one("UPDATE public.client_service_lines")
    assert _set_clause(sql, "period_end") is None, (
        "a PATCH that never mentioned `period_end` is writing to it anyway, so "
        f"editing the amount would silently reopen an ended line.\n  SQL: {sql}")
    assert _set_clause(sql, "amount") is not None, "the amount was not written"


def test_a_null_against_a_not_null_column_is_still_dropped(pooled):
    """THE FENCE. `recorded_date` is NOT NULL and must never be set to one.

    `MeteredUsageTab.save()` really does send `recorded_date: form.recorded_date
    || null` on every PATCH, so this path is walked rather than hypothetical.
    Honouring that null would send `SET recorded_date=NULL` at a NOT NULL column
    and turn an empty box into a 500.
    """
    pool = pooled([
        ("SELECT invoiced FROM public.client_metered_usage", False),
        ("UPDATE public.client_metered_usage", {"id": USAGE}),
    ])
    body = client_billing.MeteredUsageUpdate.model_validate(
        {"metric": "Hours", "quantity": 4, "unit": "hours", "rate": 1200,
         "recorded_date": None, "source_ref": None})
    _run(client_billing.update_metered_usage(
        usage_id=USAGE, body=body, user=USER, org_id=ORG))

    sql, args = pool.one("UPDATE public.client_metered_usage")
    assert _set_clause(sql, "recorded_date") is None, (
        "an explicit null is being written to `recorded_date`, which is NOT "
        f"NULL on the live table — that is a 500, not a cleared field.\n  {sql}")
    # …while `source_ref` IS nullable, so the same null clears it. Both halves
    # in one call, so the rule is proved to DISCRIMINATE rather than merely to
    # allow or merely to forbid.
    clause = _set_clause(sql, "source_ref")
    assert clause is not None, (
        f"`source_ref` is nullable and its null was dropped.\n  {sql}")
    assert args[int(clause.split("=$", 1)[1]) - 1] is None


def test_a_rate_cards_effective_from_cannot_be_cleared_but_its_to_can(pooled):
    """The same discrimination on the other pair, and `RateCardsTab` sends both.

    `effective_from` is NOT NULL; `effective_to` is nullable. The form sends
    `x || null` for each, so one PATCH carries both spellings of an empty box.
    """
    pool = pooled([("UPDATE public.vendor_rate_cards", {"id": CARD})])
    body = client_billing.RateCardUpdate.model_validate(
        {"item_category": "Cabling", "rate": 1250, "unit": "hours",
         "effective_from": None, "effective_to": None,
         "proration_clause": False, "notes": None})
    _run(client_billing.update_rate_card(
        card_id=CARD, body=body, user=USER, org_id=ORG))

    sql, args = pool.one("UPDATE public.vendor_rate_cards")
    assert _set_clause(sql, "effective_from") is None, (
        f"a null is being written to the NOT NULL `effective_from`.\n  {sql}")
    for field in ("effective_to", "notes"):
        clause = _set_clause(sql, field)
        assert clause is not None, f"`{field}` is nullable and was not cleared"
        idx = int(clause.split("=$", 1)[1].split("::", 1)[0]) - 1
        assert args[idx] is None, f"`{field}` was bound as {args[idx]!r}"


def test_a_patch_that_says_nothing_at_all_is_still_a_400(pooled):
    """`{}` must not become `SET updated_at=NOW()` and a 200."""
    pooled([])
    body = client_billing.ServiceLineUpdate.model_validate({})
    with pytest.raises(HTTPException) as exc:
        _run(client_billing.update_service_line(
            line_id=LINE, body=body, user=USER, org_id=ORG))
    assert exc.value.status_code == 400


# ══════════════════════════════════════════════════════════════════════════════
#  2 · Deleting a rate card — and refusing when something is priced off it
# ══════════════════════════════════════════════════════════════════════════════


def test_a_rate_card_nothing_references_is_deleted(pooled):
    pool = pooled([
        ("SELECT id, item_category FROM public.vendor_rate_cards",
         {"id": CARD, "item_category": "S17 Rate 03"}),
        ("SELECT sla_metric, period FROM public.vendor_sla_credits", []),
    ])
    out = _run(client_billing.delete_rate_card(
        card_id=CARD, user=USER, org_id=ORG))
    assert out == {"ok": True}
    assert pool.any("DELETE FROM public.vendor_rate_cards"), (
        "the route answered ok and issued no DELETE")


def test_a_rate_card_an_sla_credit_prices_off_is_refused_by_name(pooled):
    """409, not a 500 — and the sentence names what is in the way.

    `pg_constraint`, live 2026-08-29:
        vendor_sla_credits_rate_card_id_fkey
            FOREIGN KEY (rate_card_id) REFERENCES staging.vendor_rate_cards(id)
    with no ON DELETE clause, so the database would raise a
    ForeignKeyViolationError and FastAPI would turn it into an opaque 500 with
    nothing on screen. Of Unicode Group's three rate cards TWO are referenced,
    so this is the ordinary case rather than the corner.
    """
    pooled([
        ("SELECT id, item_category FROM public.vendor_rate_cards",
         {"id": CARD, "item_category": "S17 Rate 01"}),
        ("SELECT sla_metric, period FROM public.vendor_sla_credits",
         [{"sla_metric": "S17 SLA 01", "period": "2026-08"}]),
    ])
    with pytest.raises(HTTPException) as exc:
        _run(client_billing.delete_rate_card(
            card_id=CARD, user=USER, org_id=ORG))
    assert exc.value.status_code == 409, (
        f"a referenced rate card answered {exc.value.status_code}; anything but "
        "409 means the FK violation reaches the database as a 500")
    said = str(exc.value.detail)
    assert "S17 SLA 01" in said, (
        f'the refusal does not name the credit in the way: "{said}"')
    assert "Effective To" in said, (
        f'the refusal offers no way forward: "{said}"')


def test_the_delete_never_leaves_its_org(pooled):
    """Both reads and the DELETE are scoped by org_id, not by id alone.

    The FK proves a credit points at this card; it says nothing about whose
    card it is. Ten FKs in this repo reach four tables from request bodies and
    none is composite with `org_id`, which is why this is asserted rather than
    assumed.
    """
    pool = pooled([
        ("SELECT id, item_category FROM public.vendor_rate_cards",
         {"id": CARD, "item_category": "S17 Rate 03"}),
        ("SELECT sla_metric, period FROM public.vendor_sla_credits", []),
    ])
    _run(client_billing.delete_rate_card(card_id=CARD, user=USER, org_id=ORG))

    for sql, args in pool.calls:
        assert "org_id" in sql, f"a statement with no org fence: {sql}"
        assert ORG in [str(a) for a in args], (
            f"the org was not bound into: {sql}")


def test_a_card_in_another_org_is_a_404_before_anything_else(pooled):
    pool = pooled([("SELECT id, item_category FROM public.vendor_rate_cards", None)])
    with pytest.raises(HTTPException) as exc:
        _run(client_billing.delete_rate_card(
            card_id=CARD, user=USER, org_id=ORG))
    assert exc.value.status_code == 404
    assert not pool.any("DELETE FROM"), (
        "a card that does not belong to this org still reached a DELETE")


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The serial carries the firm's OWN prefix
# ══════════════════════════════════════════════════════════════════════════════


#: The scripted answers `generate_usage_invoice` needs to reach its serial —
#: the profile, the usage rows and the supplier's state. Reused rather than
#: rewritten: it is already the shape that file's own tests drive, so a change
#: to the handler's reads breaks one script instead of two.
from tests.test_client_billing_invoices import USAGE_SCRIPT  # noqa: E402

#: `_doc_prefix`'s own read. Its needle is distinct from `_supplier_state`'s
#: (`SELECT state_code FROM staging.organisations`), which matters because
#: `CapturePool` takes the FIRST needle that matches and both statements are
#: against `staging.organisations`.
_PREFIX_READ = "SELECT settings->'doc_prefixes'->>$2"


def test_the_usage_invoice_is_numbered_in_the_firms_own_series(pooled):
    """`UNX-`, not `INV-`, when the org has said so.

    The prefix is resolved through `ganit._doc_prefix` — the same reader every
    hand-raised invoice goes through — rather than re-read here, for the reason
    `_norm_state` is imported rather than copied: a second implementation of one
    rule is a second thing to drift.
    """
    pooled([(_PREFIX_READ, "UNX")] + USAGE_SCRIPT)
    out = _run(client_billing.generate_usage_invoice(
        body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
        user=USER, org_id=ORG))

    assert out["invoice_number"].startswith("UNX-"), (
        f"the billing cycle numbered itself {out['invoice_number']}, outside "
        "the firm's own series. `next_doc_number` increments the last serial "
        "for the org whatever its prefix, so an INV- writer and a UNX- writer "
        "share one counter and disagree about its name — Rule 46(b) asks for "
        "one consecutive serial per financial year.")


def test_an_org_that_has_set_no_prefix_still_gets_the_default(pooled):
    """The fallback is not lost. A firm that never configured one still bills."""
    pooled(USAGE_SCRIPT)  # no doc_prefixes answer at all → fetchval returns None
    out = _run(client_billing.generate_usage_invoice(
        body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
        user=USER, org_id=ORG))
    assert out["invoice_number"].startswith("INV-")


def test_the_auto_invoice_sweep_uses_the_same_series(pooled):
    """The OTHER writer. Fixing one and leaving the other is how a series splits.

    `sweep_client_auto_invoices` has no user-reachable trigger — its only caller
    is `POST /cron/billing`, which passes no org — so nothing in Suite 17 can
    reach it and this is the only place it is held to the same rule.
    """
    from tests.test_client_billing_invoices import SWEEP_SCRIPT
    pooled([(_PREFIX_READ, "UNX")] + SWEEP_SCRIPT)
    out = _run(client_billing.sweep_client_auto_invoices(
        today=__import__("datetime").date(2026, 8, 25)))
    assert out["created"] == 1, f"the sweep raised nothing: {out}"
    # The serial is not returned, so it is read off the INSERT that carried it.
    import db
    sql, args = db._pool.one("INSERT INTO public.ganit_invoices")
    serials = [a for a in args if isinstance(a, str) and "-2026-" in a]
    assert serials and serials[0].startswith("UNX-"), (
        f"the sweep numbered itself {serials}, outside the firm's own series")


# ══════════════════════════════════════════════════════════════════════════════
#  4 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════


def _new_statements() -> list[str]:
    """Every statement the changed handlers issue, captured offline."""
    out: list[str] = []

    async def run():
        import db
        cases = [
            ([("UPDATE public.client_service_lines", {"id": LINE})],
             lambda: client_billing.update_service_line(
                 line_id=LINE,
                 body=client_billing.ServiceLineUpdate.model_validate(
                     {"description": "d", "amount": 1, "period_end": None,
                      "auto_invoice": False}),
                 user=USER, org_id=ORG)),
            ([("UPDATE public.client_billing_profiles", {"id": PROFILE})],
             lambda: client_billing.update_profile(
                 profile_id=PROFILE,
                 body=client_billing.ProfileUpdate.model_validate(
                     {"billing_cycle": "monthly", "anchor_day": 5,
                      "payment_terms_days": 30, "currency": "INR",
                      "gst_treatment": "registered", "credit_limit": None,
                      "notes": None}),
                 user=USER, org_id=ORG)),
            ([("SELECT invoiced FROM public.client_metered_usage", False),
              ("UPDATE public.client_metered_usage", {"id": USAGE})],
             lambda: client_billing.update_metered_usage(
                 usage_id=USAGE,
                 body=client_billing.MeteredUsageUpdate.model_validate(
                     {"metric": "m", "quantity": 1, "unit": "u", "rate": 1,
                      "recorded_date": "2026-08-01", "source_ref": None}),
                 user=USER, org_id=ORG)),
            ([("UPDATE public.vendor_rate_cards", {"id": CARD})],
             lambda: client_billing.update_rate_card(
                 card_id=CARD,
                 body=client_billing.RateCardUpdate.model_validate(
                     {"item_category": "c", "rate": 1, "unit": "u",
                      "effective_from": "2026-08-01", "effective_to": None,
                      "proration_clause": False, "notes": None}),
                 user=USER, org_id=ORG)),
            ([("SELECT id, item_category FROM public.vendor_rate_cards",
               {"id": CARD, "item_category": "c"}),
              ("SELECT sla_metric, period FROM public.vendor_sla_credits", [])],
             lambda: client_billing.delete_rate_card(
                 card_id=CARD, user=USER, org_id=ORG)),
        ]
        for script, drive in cases:
            pool = CapturePool(script)
            original, db._pool = db._pool, pool
            try:
                await drive()
            finally:
                db._pool = original
            out.extend(pool.statements())

    asyncio.run(run())
    return out


@pytest.fixture(scope="module")
def live():
    """Plan every captured statement against the real catalogue. ONE connection.

    `prepare()` sends Parse and Describe and returns the shapes. No `fetch`, no
    `execute`, no `fetchval` is ever called on the handle, so no row is read and
    none is written.
    """
    dsn = live_dsn()
    if not dsn:
        pytest.skip(SKIP_REASON)
    import asyncpg

    # Captured BEFORE the loop below opens: `_new_statements` drives the
    # handlers with `asyncio.run`, and `asyncio.run` inside a running loop is a
    # RuntimeError rather than a nested run.
    statements = _new_statements()

    async def run():
        conn = await asyncpg.connect(dsn, statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for sql in statements:
                try:
                    # `statement_cache_size=0` because the connection goes
                    # through PgBouncer in transaction mode.
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
            nullable = await conn.fetch(
                "SELECT table_name, column_name, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_schema = ANY(current_schemas(false)) "
                "  AND table_name IN ('client_service_lines','vendor_rate_cards',"
                "                     'client_metered_usage','client_billing_profiles')"
            )
            return failures, [dict(r) for r in nullable]
        finally:
            await conn.close()

    return asyncio.run(run())


def test_every_changed_statement_parses_against_the_real_schema(live):
    failures, _ = live
    assert not failures, "statements the live catalogue refused:\n" + "\n".join(
        f"  {err}\n    {sql}" for sql, err in failures)


def test_the_clearable_sets_are_exactly_the_nullable_columns(live):
    """THE RATCHET. Code and catalogue cannot drift apart silently.

    `_CLEARABLE_*` decides which nulls reach the database. Get it wrong in one
    direction and a resume goes back to being a silent no-op; wrong in the
    other and an empty box becomes a NOT NULL violation, which is a 500 with
    nothing on screen. Either way the mistake is invisible in review, so the
    live catalogue is the witness rather than a reading of a migration file.

    Only the columns the PATCH handlers actually offer are compared —
    `created_by` is nullable and no form writes it, so requiring it here would
    be asserting something nobody asked for.
    """
    _, nullable = live
    assert nullable, "the catalogue read returned nothing at all"

    offered = {
        "client_billing_profiles": ({"billing_cycle", "anchor_day",
                                     "payment_terms_days", "currency",
                                     "gst_treatment", "credit_limit", "notes"},
                                    client_billing._CLEARABLE_PROFILE),
        "client_service_lines": ({"description", "amount", "period_end",
                                  "auto_invoice"},
                                 client_billing._CLEARABLE_SERVICE_LINE),
        "client_metered_usage": ({"metric", "quantity", "unit", "rate",
                                  "recorded_date", "source_ref"},
                                 client_billing._CLEARABLE_METERED_USAGE),
        "vendor_rate_cards": ({"item_category", "rate", "unit",
                               "effective_from", "effective_to",
                               "proration_clause", "notes"},
                              client_billing._CLEARABLE_RATE_CARD),
    }
    for table, (fields, declared) in offered.items():
        truly = {
            r["column_name"] for r in nullable
            if r["table_name"] == table
            and r["column_name"] in fields
            and r["is_nullable"] == "YES"
        }
        assert set(declared) == truly, (
            f"{table}: the router says {sorted(declared)} may be cleared and "
            f"the live catalogue says {sorted(truly)} can hold a NULL. A column "
            "in the first list and not the second is a 500 waiting for an empty "
            "box; one in the second and not the first is a field the customer "
            "can never clear.")
