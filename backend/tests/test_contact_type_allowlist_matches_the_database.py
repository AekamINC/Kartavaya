"""The app's `contact_type` allowlist and the database's CHECK must agree.

── THE DEFECT THIS EXISTS FOR, WHICH I SHIPPED ─────────────────────────────

Migration 255 removed `'customer'` from `graha_contacts_contact_type_check`.
`routers/graha.py` carried its own hard-coded copy of that list and it was not
moved with the constraint. For one afternoon, creating a contact in production
was broken in BOTH directions at once:

    contact_type='contact'   -> 400 from the router  ("must be one of: lead,
                                customer, vendor, partner") — refusing the ONLY
                                correct value
    contact_type='customer'  -> passed the router, then died on the constraint
                                as an unexplained 500

So the endpoint accepted exactly nothing that worked. Every one of 1,295 backend
tests was green over it, `npm run check`'s 20 gates were green over it, and the
migration's own verification was green over it — because none of them creates a
contact through the router.

It was found by driving the real endpoint against production, which is the whole
argument for driving it. A grep for the migration would not have found the line;
only a request that actually tried to create a contact did.

── WHY THIS COMPARES THE TWO, RATHER THAN ASSERTING A LIST ─────────────────

A test that hard-codes the expected four values is a THIRD copy of the same
list, and the next person to change the vocabulary has three places to miss
instead of two. This reads the constraint out of the live database and the
allowlist out of the source, and requires them to be the same set. Neither can
move without the other.
"""
import os
import re

import pytest

_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = ("No live DATABASE_URL. Run: cd backend && railway run "
           "--service Kartavaya -- python -m pytest "
           "tests/test_contact_type_allowlist_matches_the_database.py -q")

HERE = os.path.dirname(os.path.abspath(__file__))
GRAHA = os.path.join(HERE, "..", "routers", "graha.py")


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


def allowlist_in_the_router() -> set[str]:
    """The tuple `create_contact` validates against, read out of the source.

    Anchored on `valid_types` immediately before the `contact_type must be one
    of` message, so it cannot accidentally pick up one of the file's several
    other `valid_types` tuples (activity_type, field_type, document kinds).
    """
    with open(GRAHA, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(
        r"valid_types\s*=\s*\(([^)]*)\)\s*\n\s*if body\.contact_type not in valid_types",
        src)
    assert m, "could not find create_contact's contact_type allowlist in graha.py"
    return set(re.findall(r"[\"']([a-z_]+)[\"']", m.group(1)))


def test_the_allowlist_is_findable_and_not_empty():
    """THE ANTI-VACUITY FLOOR.

    Every comparison below passes trivially if the parser returns an empty set
    against an empty constraint. The one thing that must be asserted outright is
    that both sides actually found something.
    """
    got = allowlist_in_the_router()
    assert len(got) >= 2, f"parsed a suspiciously small allowlist: {got}"
    assert "lead" in got, f"'lead' is not optional; got {got}"


def test_live_the_router_and_the_constraint_hold_the_same_set():
    async def q(conn):
        return await conn.fetchval(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            " WHERE conname = 'graha_contacts_contact_type_check' "
            "   AND conrelid = 'public.graha_contacts'::regclass")

    definition = run_live(q)
    assert definition, "graha_contacts_contact_type_check does not exist"

    in_db = set(re.findall(r"'([a-z_]+)'::text", definition))
    assert in_db, f"parsed no values out of the constraint: {definition!r}"

    in_app = allowlist_in_the_router()

    assert in_app == in_db, (
        "the router would refuse a value the database accepts, or accept one it "
        f"refuses.\n  router:   {sorted(in_app)}\n  database: {sorted(in_db)}\n"
        "A value only the router allows becomes an unexplained 500; a value only "
        "the database allows can never be written at all."
    )


def test_live_customer_is_gone_from_both():
    """The specific rule the owner asked for, asserted in both places.

    "Customer should get bye bye and client only remains." A customer is a
    COMPANY — `graha_clients.is_sales_customer` — not a kind of person.
    """
    async def q(conn):
        return await conn.fetchval(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            " WHERE conname = 'graha_contacts_contact_type_check' "
            "   AND conrelid = 'public.graha_contacts'::regclass")

    definition = run_live(q)
    assert "'customer'" not in definition, (
        f"'customer' is writable again: {definition}")
    assert "customer" not in allowlist_in_the_router(), (
        "the router still offers 'customer'")

    # Paired with the presence assertion, so this cannot pass over a constraint
    # that has lost every value.
    assert "'contact'" in definition, f"'contact' is not accepted: {definition}"


def test_live_no_contact_row_still_says_customer():
    async def q(conn):
        return await conn.fetchval(
            "SELECT count(*) FROM public.graha_contacts "
            " WHERE contact_type = 'customer'")

    assert run_live(q) == 0
