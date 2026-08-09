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
    """The screen rendered `u.slice(0, 12)` — twelve characters of a uuid."""
    code = _code(graha.list_territories)
    assert "COALESCE(u.full_name, u.name, u.email)" in code
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
    sql = (BACKEND / "migrations" / "PROPOSED_territory_users_are_text.sql").read_text(
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
