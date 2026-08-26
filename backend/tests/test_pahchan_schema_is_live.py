"""The router said its own schema was not applied. It is, and it holds rows.

`routers/pahchan.py:25` read

    Schema: migrations/PROPOSED_064_pahchan.sql (not yet applied).

which is the exact false fact Phase 2.6 existed to kill, alive in the header of
the router that reads those tables. Measured read-only against the live database
2026-08-26, every table that file creates holds rows:

    pahchan_sites 9 · pahchan_punches 699 · pahchan_enrollment_photos 24
    pahchan_regularisations 40 · pahchan_policy 2

and `staging.pahchan_org_usage`, the view §7 aggregates through so a roster never
leaves the database, exists as a VIEW. All 699 punches belong to Unicode Group
(fae87907), the org that actually runs attendance, over 2026-06-08 to 2026-08-04.

A module docstring is not decoration in this repo — it is the first thing anybody
reads before touching the file, and "not yet applied" invites precisely the
change that a table with 699 rows in it will refuse. The same sentence being
wrong in three places at once is what the phase was for.
"""
import inspect

from routers import pahchan


def test_the_router_does_not_call_its_own_schema_unapplied():
    """The exact claim, not the words in it.

    Matching the bare phrase would forbid the header from RECORDING that it
    once said this, which is the sentence worth keeping — the pairing of the
    file with the status is the lie, and it is what this asserts against.
    """
    src = inspect.getsource(pahchan)
    assert "PROPOSED_064_pahchan.sql (not yet applied)" not in src
    assert "APPLIED" in (pahchan.__doc__ or "")


def test_the_header_still_points_at_the_file_that_defines_the_schema():
    """Correcting the status must not cost the reader the pointer. The file is
    still named PROPOSED_064 — renaming an applied migration is a separate,
    riskier job than telling the truth about it in a docstring."""
    doc = pahchan.__doc__ or ""
    assert "PROPOSED_064_pahchan.sql" in doc


def test_the_header_names_the_tables_that_are_live():
    """A bare "applied" ages the same way "not yet applied" did. The five tables
    are named so the next reader can check the claim in one query."""
    doc = pahchan.__doc__ or ""
    for table in ("pahchan_sites", "pahchan_punches",
                  "pahchan_enrollment_photos", "pahchan_regularisations",
                  "pahchan_policy"):
        assert table in doc, table
