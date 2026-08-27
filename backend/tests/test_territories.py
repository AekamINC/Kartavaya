"""Territories — the half of the feature that was missing was the column type.

The owner called Territories "half baked" on 2026-08-09. It is worse than that:
`graha_territories.assigned_users` is `UUID[]` and `users.user_id` is TEXT, so
assigning a real person raised invalid-input-syntax from asyncpg. Nobody could
ever have been assigned to a territory.
"""
import inspect
import pathlib

from routers import graha

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        line for line in src.splitlines()
        if not line.strip().startswith("#")).split())


def test_the_list_returns_names_not_ids():
    """The screen rendered `u.slice(0, 12)` — twelve characters of a user id.

    THE ASSERTION MOVED FROM THE TEXT TO THE PROPERTY, and under this test's
    own name that is the whole point. It used to pin the literal
    `COALESCE(u.full_name, u.name, u.email)` — so a test called
    "returns names not ids" REQUIRED a ladder that returns an email address
    when a name is missing, and would have failed on the fix and passed on the
    bug. The owner ruled on 2026-08-23 that a display ladder must never end at
    an email: it is a contact detail rendered as a label, and it inverts the
    rule that Aekam must not see a customer's member emails.

    Measured before the rung came off, because the objection is "then the row
    names nobody": 0 of 35 live accounts have neither `full_name` nor `name`.
    It had never fired on real data.

    `tests/test_audit_actors.py` now walks the whole backend refusing any
    ladder that reaches `.email`; this test keeps the narrower guarantee that
    THIS endpoint resolves a name at all.
    """
    code = _code(graha.list_territories)
    assert "u.full_name" in code and "u.name" in code
    assert "u.email" not in code, (
        "the territory list names people by email address when they have no "
        "name on file")
    # And the id it resolves FROM must not travel to the client beside the
    # name it resolved to — a name plus the id is still the id rendered.
    assert "'assigned'" not in code or "AS assigned" in code


def test_only_real_members_can_be_assigned():
    """Whatever was typed into the free-text box went into round-robin and out
    into `deals.assigned_to` — assigning leads to a person who does not exist."""
    code = _code(graha._validated_territory_users)
    assert "staging.user_roles" in code and "org_id" in code
    assert "400" in code
    for fn in (graha.create_territory, graha.update_territory):
        assert "_validated_territory_users" in _code(fn)


def test_both_writes_name_the_migration_rather_than_500():
    for fn in (graha.create_territory, graha.update_territory):
        assert "_territory_write_error" in _code(fn)
    assert "503" in _code(graha._territory_write_error)


def test_the_migration_converts_rather_than_drops():
    """A DROP/ADD would silently empty the column. It is a USING cast."""
    sql = (BACKEND / "migrations" / "134_territory_users_are_text.sql").read_text(
        encoding="utf-8")
    body = "\n".join(line for line in sql.splitlines()
                     if not line.strip().startswith("--"))
    assert "TYPE text[] USING" in body
    assert "DROP COLUMN" not in body.upper()


def test_a_deal_can_be_given_a_territory():
    """`deals.territory_id` has existed since migration 023 and no create path
    could set it, so a territory could be defined and never used."""
    assert "territory_id" in _code(graha.create_deal)
    assert "territory_id" in graha.DealCreate.model_fields


def test_the_deal_surfaces_carry_the_territory_name():
    for fn in (graha.list_deals, graha.deals_kanban):
        assert "territory_name" in _code(fn)


def test_the_kanban_card_can_name_its_owner():
    """It drew `owner_id.substring(0, 8)`."""
    assert "owner_name" in _code(graha.deals_kanban)


#: Columns that LOOK like a user reference and are `uuid`, while
#: `public.users.user_id` is TEXT. Joining one to the other has no operator at
#: all, so Postgres refuses the whole statement — see migration 092, which
#: recorded the mismatch and left the column alone because nothing writes it.
UUID_SHAPED_USER_COLUMNS = ("d.owner_id", "owner_id")


def test_no_query_joins_users_on_a_uuid_shaped_column():
    """THE regression that 500'd the entire kanban board on 2026-08-09.

    It got past 5,136 green tests, a clean build and a clean check, because
    every test in this repo runs against a MagicMock pool: a mocked connection
    resolves any string you hand it, so a query Postgres will not parse looks
    exactly like a correct one. Nothing in CI can catch this class of defect by
    executing it, so it is caught by reading.

    If deal ownership is ever built, `owner_id` gets the `text` treatment
    migration 092 describes — and this test comes out in the same commit.
    """
    import inspect
    import re

    source = inspect.getsource(graha)
    joins = re.findall(r"JOIN\s+users\s+\w+\s+ON\s+([^\"']+)", source)
    for clause in joins:
        for bad in UUID_SHAPED_USER_COLUMNS:
            assert not re.search(rf"user_id\s*=\s*{re.escape(bad)}\b", clause), (
                f"joining users.user_id (TEXT) to {bad} (uuid) — Postgres will "
                f"refuse the statement and the endpoint will answer 500")


# ── The contact half, added 2026-08-27 (Phase 7.0) ───────────────────────────
#
# `test_a_deal_can_be_given_a_territory` above has existed since the column type
# was fixed, and it says a DEAL can carry a territory. Nobody wrote the same
# test for a CONTACT, and the reason is that it would have failed: migration 023
# added `territory_id` to BOTH tables, `DealCreate` got the field and
# `ContactCreate` never did. So a territory could be defined, drawn on a map and
# attached to a deal, while the person the deal belongs to stayed unrouted —
# 0 of 289 live contacts carried a territory on the day this was written.


def test_a_contact_can_be_given_a_territory():
    """The mirror of `test_a_deal_can_be_given_a_territory`, which is the point.

    Both columns arrived in the same migration and only one was ever reachable.
    """
    assert "territory_id" in graha.ContactCreate.model_fields
    assert "territory_id" in graha.ContactUpdate.model_fields
    assert "territory_id" in _code(graha.create_contact)
    assert "territory_id" in _code(graha.update_contact)


def test_a_contact_cannot_be_filed_under_another_orgs_territory():
    """Phase 7.1a's rule: the leak closes in the commit that opens the column.

    Migration 023 wrote a plain `REFERENCES staging.graha_territories(id)` with
    no `org_id` in it — the same shape as `graha_contacts.client_id`, which
    needed `resolve_contact_company` for exactly this reason. The database alone
    would accept one organisation's contact pointing at another's territory, and
    `assign-next` reads that territory's `assigned_users` to hand out a lead. A
    mis-scoped territory therefore hands one firm's customer to a different
    firm's salesperson; it is not a labelling mistake.
    """
    code = _code(graha.resolve_contact_territory)
    assert "staging.graha_territories" in code
    assert "org_id" in code, "the org predicate is the whole point of this function"
    assert "is_active" in code, (
        "DELETE /territories/{id} is a SOFT delete — it flips is_active and "
        "leaves the row. Without this predicate a deleted territory stays "
        "assignable for ever."
    )
    assert "400" in code
    for fn in (graha.create_contact, graha.update_contact):
        assert "resolve_contact_territory" in _code(fn), (
            f"{fn.__name__} writes territory_id without the org check"
        )


def test_both_uuid_columns_on_a_contact_are_bound_with_their_type():
    """`$n` alone into a `uuid` column is the untyped-parse 500.

    PgBouncer turns an ambiguous parameter expression into an instant 500 with
    no useful log — `memory/incident_credits_untyped_sql` is the same failure on
    `$1 + $2`. `client_id` was already bound through `NULLIF($n,'')::uuid` and
    `territory_id` joins it, in both the INSERT and the PATCH SET-build.
    """
    for fn in (graha.create_contact, graha.update_contact):
        code = _code(fn)
        assert "NULLIF" in code and "::uuid" in code
    # The SET-build branches on a tuple, so both names must be inside it rather
    # than one of them falling through to the generic bare-`$n` branch.
    patch = _code(graha.update_contact)
    assert '("client_id", "territory_id")' in patch, (
        "territory_id has fallen out of the typed branch of the SET-build"
    )
