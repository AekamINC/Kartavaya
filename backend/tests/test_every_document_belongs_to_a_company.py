"""No invoice, order or deal may belong to nobody.

── THE INVARIANT ───────────────────────────────────────────────────────────

The owner, 2026-09-01: "so only customer doesnt have client it got converted to
customer and sales order got generated without an customer or client how invoice
can be assign correctly. thats big flaw."

A document with no `client_id` appears on no customer ledger, in no
receivables-by-client figure, and on no statement of account. It is not merely
mis-filed — `GET /vikray/customers` ends its WHERE with
`AND (o.client_id IS NOT NULL OR o.contact_id IS NOT NULL)`, so such a row can
drop off the customers list entirely. Nothing errors. It is invisible money.

── WHAT WAS FOUND, AND WHAT IT COST ────────────────────────────────────────

Measured 2026-09-01, before migration 259:

    21 ganit_invoices    Rs  2,54,172   client_id IS NULL
     1 vikray_order      Rs 49,08,800   client_id AND contact_id both NULL
     9 graha_deals                      client_id IS NULL, one at stage 'Won'

All 21 invoices came from RECURRING billing (`recurring_id IS NOT NULL` on every
one, `deal_id` on none) — three armed profiles pointing at contacts with no
employer, adding another on every run. The faucet was closed in f29c0663; 259
removed what it had already produced.

The Won deal was the loaded gun: `create_order_from_deal` and
`create_invoice_from_deal` would each have minted another fully-orphaned
document the moment somebody converted it.

── WHY A TEST AND NOT JUST THE CLEANUP ─────────────────────────────────────

A cleanup is a one-off. `tests/test_client_id_write_paths.py` is an AST scan and
was GREEN over all 21 of these — every write path NAMES `client_id`; the VALUE
was NULL. A static ratchet cannot see a null. This one queries the rows.
"""
import os

import pytest

_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = ("No live DATABASE_URL. Run: cd backend && railway run "
           "--service Kartavaya -- python -m pytest "
           "tests/test_every_document_belongs_to_a_company.py -q")


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def run_live(factory):
    import asyncio
    import asyncpg

    if live_dsn() is None:
        pytest.skip(DB_SKIP)

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except (asyncpg.exceptions.InvalidPasswordError,
                asyncpg.exceptions.InvalidCatalogNameError, OSError) as exc:
            return ("__unreachable__", str(exc))
        try:
            return ("__ok__", await factory(conn))
        finally:
            await conn.close()

    kind, value = asyncio.run(run())
    if kind == "__unreachable__":
        pytest.skip(f"{DB_SKIP} ({value[:60]})")
    return value


def test_live_no_active_invoice_belongs_to_nobody():
    async def q(conn):
        return await conn.fetch(
            "SELECT i.invoice_number, o.name AS org, i.total "
            "  FROM public.ganit_invoices i "
            "  JOIN public.organisations o ON o.id = i.org_id "
            " WHERE i.is_active AND i.client_id IS NULL "
            " ORDER BY i.invoice_number")

    rows = run_live(q)
    assert [dict(r) for r in rows] == [], (
        "these invoices appear on no customer ledger and on no statement"
    )


def test_live_no_active_order_belongs_to_nobody():
    """Both keys null. An order with a contact but no client is a different,
    lesser problem — the company is at least derivable — and is not asserted
    here so that this test names one thing."""
    async def q(conn):
        return await conn.fetch(
            "SELECT v.order_number, o.name AS org, v.total "
            "  FROM public.vikray_orders v "
            "  JOIN public.organisations o ON o.id = v.org_id "
            " WHERE v.is_active AND v.client_id IS NULL AND v.contact_id IS NULL")

    rows = run_live(q)
    assert [dict(r) for r in rows] == [], (
        "GET /vikray/customers filters these off the customers list entirely"
    )


def test_live_no_active_deal_belongs_to_nobody():
    """A deal is the input to `create_order_from_deal` and
    `create_invoice_from_deal`, so an orphaned one is not just a bad row — it is
    a document waiting to be minted with no company."""
    async def q(conn):
        return await conn.fetch(
            "SELECT d.title, d.stage, o.name AS org "
            "  FROM public.graha_deals d "
            "  JOIN public.organisations o ON o.id = d.org_id "
            " WHERE d.is_active AND d.client_id IS NULL")

    rows = run_live(q)
    assert [dict(r) for r in rows] == []


def test_live_there_are_documents_to_check_in_the_first_place():
    """THE ANTI-VACUITY FLOOR.

    Every assertion above passes over an empty database, and the migration that
    made them pass was a DELETE. A wipe would look exactly like a fix, so
    something has to insist there is data to be right about.

    ⚠ RE-BASED 2026-09-01, AND THE REASON MATTERS. This asserted `inv > 50`,
    which was the size of the seed corpus when it was written. Migration 260
    then cleared every module table outside Aekam on the owner's instruction,
    and this test went red — CORRECTLY: it could not tell an authorised wipe
    from an accident, which is exactly its job.

    The floor is now the SEEDED PROOF SET rather than a corpus size. That set is
    small on purpose: one client, one contact, one invoice carrying both a
    customer reference and a custom field, one compliance override, one upstream
    invoice — each created THROUGH the product's own endpoints so that its
    existence proves the flow, not merely the schema. A number tuned to a big
    seed would have to be re-tuned after every reseed; "at least one document
    exists and it has a company" does not.
    """
    async def q(conn):
        return await conn.fetchrow(
            "SELECT (SELECT count(*) FROM public.ganit_invoices WHERE is_active) AS inv, "
            "       (SELECT count(*) FROM public.graha_clients  WHERE is_active) AS cli, "
            "       (SELECT count(*) FROM public.subscription_invoices) AS upstream, "
            "       (SELECT coalesce(sum(total),0) FROM public.ganit_invoices "
            "          WHERE is_active) AS billed")

    row = run_live(q)
    assert row["inv"] >= 1, "no invoice at all — nothing above is being tested"
    assert row["cli"] >= 1, "no client at all — an invoice needs somebody to bill"
    assert row["billed"] > 0, "the billed total is zero"
    assert row["upstream"] >= 1, (
        "no upstream invoice — sweep_platform_invoices has never produced one, "
        "so the platform billing path is unproven")


def test_live_the_platform_org_still_exists_and_is_still_unbilled():
    """Aekam is never charged and is never deleted. Migration 259 deleted rows
    in one organisation; this is the assertion that it was not the wrong one."""
    async def q(conn):
        return await conn.fetchrow(
            "SELECT (SELECT count(*) FROM public.organisations "
            "          WHERE is_platform_org) AS platform_orgs, "
            "       (SELECT count(*) FROM public.org_billing_lines l "
            "          JOIN public.organisations o ON o.id = l.org_id "
            "         WHERE o.is_platform_org) AS lines_against_the_owner")

    row = run_live(q)
    assert row["platform_orgs"] == 1
    assert row["lines_against_the_owner"] == 0
