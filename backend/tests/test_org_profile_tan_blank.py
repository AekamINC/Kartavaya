"""
A firm that no longer deducts tax at source can REMOVE its TAN.

Found on 2026-08-28 by driving the real form: clearing GSTIN, PAN and TAN and
pressing Save produced `net::ERR_FAILED` in the browser and "Failed to save
profile" on screen. The Railway log gave the real answer:

    asyncpg.exceptions.CheckViolationError: new row for relation
    "organisations" violates check constraint "organisations_tan_format"

and `pg_constraint` gave the rule it broke:

    CHECK ((tan IS NULL) OR (tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'))

The database says "no TAN" is NULL. The router wrote "". Neither arm accepts an
empty string, so the write was refused by Postgres, the 500 escaped before the
CORS headers were attached — which is why the browser saw a network failure
rather than a status — and the customer was told nothing.

⚠ The blast radius is the whole form, not one field: the PATCH carries every
column, so the firm also lost the name, address and bank details it had just
typed. This is the repo's signature failure — a value of the wrong shape handed
to a constrained Postgres column, surfacing as an opaque 500 with nothing on
screen — and it is the fourth of its kind.

Owner's standing rule, which the fix restores rather than changes:
"GSTIN / PAN / TAN are non-mandatory and must block nothing."
"""
import pytest


async def test_a_blank_tan_is_stored_as_NULL_not_as_empty_string(
        api_client, mock_pool, as_admin, with_org_id):
    """The regression test proper: what value reaches the column."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": None}

    resp = await api_client.patch("/api/v1/org/profile", json={"tan": ""})
    assert resp.status_code == 200

    # The UPDATE's bound parameters are where the bug lived. "" passes every
    # assertion about status codes and still violates the constraint, so the
    # check has to look at the value itself.
    args = mock_pool.fetchrow.await_args.args
    assert "" not in args, (
        "a cleared TAN was sent as an empty string; the column accepts only "
        "NULL or a well-formed TAN, so this is the CheckViolationError again"
    )
    assert None in args, "a cleared TAN must be written as NULL"


@pytest.mark.parametrize("blank", ["", "   ", None])
async def test_every_way_of_saying_no_tan_becomes_NULL(
        api_client, mock_pool, as_admin, with_org_id, blank):
    """Whitespace is a person clearing a field, not a TAN made of spaces."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": None}

    resp = await api_client.patch("/api/v1/org/profile", json={"tan": blank})
    assert resp.status_code == 200
    args = mock_pool.fetchrow.await_args.args
    assert "" not in args and "   " not in args, (
        f"{blank!r} reached the column unnormalised"
    )


async def test_a_real_tan_still_stores_uppercased(
        api_client, mock_pool, as_admin, with_org_id):
    """The fix must not stop a TAN being SET — nobody types it in caps."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": "AHMA12345B"}

    resp = await api_client.patch("/api/v1/org/profile", json={"tan": "ahma12345b"})
    assert resp.status_code == 200
    assert "AHMA12345B" in mock_pool.fetchrow.await_args.args
