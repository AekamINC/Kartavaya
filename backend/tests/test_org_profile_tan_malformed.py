"""
A TAN typed wrongly is KEPT, with a warning — it does not destroy the form.

The blank-TAN defect (see `test_org_profile_tan_blank.py`) had a second half
that no code change could reach. The router has always promised, in its own
words on screen:

    "A TAN is four letters, five digits and one letter — for example
     AHMA12345B. 'AHMA123' does not look like one. It has been saved as typed."

and `organisations_tan_format` then refused the write, so it was NOT saved as
typed — it was a CheckViolationError, a 500 that escaped before the CORS headers
were attached, and a screen that said only "Failed to save profile" while naming
no field. ⚠ The PATCH carries every column, so a firm mistyping one character of
a TAN from a certificate lost the name, address, state and bank details entered
in the same sitting.

Migration 238 dropped the constraint. Rows affected: zero — no organisation on
the database held a TAN at all (5 orgs, counted live 2026-08-28 before it ran).
Validation was not lost, it moved to where it bites: `doc_validation.py:762-778`
refuses to build a TDS challan against an absent or malformed TAN, which is the
only document where a wrong TAN is a real-world problem.

Owner's standing rule, which this restores rather than changes:
"GSTIN / PAN / TAN are non-mandatory and must block nothing."

⚠ THESE TESTS MOCK THE POOL, so they prove what the ROUTER does. That the
COLUMN now accepts it is a separate fact, proved two other ways: `pg_constraint`
returns no `organisations_tan_format` row, and Suite 02.2 types a malformed TAN
into the real form against staging and asserts the fields beside it survive.
"""
import pytest

# Deliberately varied: too short, too long, digits and letters transposed, an
# adjacent-format identifier (a PAN), and one with punctuation someone would
# genuinely paste out of a PDF.
MALFORMED = ["AHMA123", "AHMA12345BX", "AH1A12345B", "AAACU5678U", "AHMA-12345-B"]


@pytest.mark.parametrize("bad", MALFORMED)
async def test_a_malformed_tan_is_accepted_and_stored(
        api_client, mock_pool, as_admin, with_org_id, bad):
    """The whole defect in one assertion: the save must succeed."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": bad}

    resp = await api_client.patch("/api/v1/org/profile", json={"tan": bad})

    assert resp.status_code == 200, (
        f"{bad!r} was refused. Before migration 238 this was a 500 from the "
        f"database, and it took the entire rest of the form with it."
    )
    # Stored as typed — uppercased and de-spaced, which is the router's
    # documented normalisation, but not otherwise altered or dropped.
    args = mock_pool.fetchrow.await_args.args
    assert bad.upper().replace(" ", "") in args, (
        f"{bad!r} did not reach the column; 'saved as typed' was not true"
    )


@pytest.mark.parametrize("bad", MALFORMED)
async def test_the_customer_is_told_it_looks_wrong(
        api_client, mock_pool, as_admin, with_org_id, bad):
    """Accepted is not the same as unremarked. Silence here would be worse."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": bad}

    resp = await api_client.patch("/api/v1/org/profile", json={"tan": bad})
    assert resp.status_code == 200

    body = resp.json()
    warnings = body.get("warnings") or body.get("code_warnings") or {}
    assert "tan" in warnings, (
        f"{bad!r} was stored with no warning at all. The customer needs to know "
        f"the number will not pass at the TDS portal — TAN is the one of the "
        f"three that a document actually depends on."
    )


async def test_the_rest_of_the_form_survives_a_bad_tan(
        api_client, mock_pool, as_admin, with_org_id):
    """The blast radius, asserted directly rather than inferred from a status.

    This is the assertion that would have caught the original defect: it is not
    about the TAN, it is about the six fields that were lost alongside it.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "Unicode Group", "tan": "AHMA123"}

    resp = await api_client.patch("/api/v1/org/profile", json={
        "name": "Unicode Group",
        "tan": "AHMA123",
        "email": "accounts@unicode.example",
        "phone": "+91 98250 00000",
    })

    assert resp.status_code == 200
    args = mock_pool.fetchrow.await_args.args
    for survivor in ("Unicode Group", "accounts@unicode.example", "+91 98250 00000"):
        assert survivor in args, (
            f"{survivor!r} never reached the UPDATE. A mistyped TAN must not "
            f"take the rest of the company profile down with it."
        )


async def test_a_well_formed_tan_still_carries_no_warning(
        api_client, mock_pool, as_admin, with_org_id):
    """The negative half — otherwise 'warns on everything' would pass above."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": "AHMA12345B"}

    resp = await api_client.patch("/api/v1/org/profile", json={"tan": "AHMA12345B"})
    assert resp.status_code == 200

    body = resp.json()
    warnings = body.get("warnings") or body.get("code_warnings") or {}
    assert "tan" not in warnings, "a valid TAN was warned about"
