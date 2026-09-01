"""Every custom-field entity must be definable, storable, AND offered.

── TWO DEFECTS, ONE SHAPE ──────────────────────────────────────────────────

Custom fields are declared in FOUR places that must agree:

  1. the CHECK on `graha_custom_fields.entity_type`   — what can be DEFINED
  2. `create_custom_field`'s `valid_entities`          — what the API accepts
  3. `CUSTOM_FIELD_ENTITIES` in the frontend           — what a user can PICK
  4. a `custom_data` column plus a write path          — where values LAND

On 2026-09-01 they disagreed in both directions at once:

  · `invoice` was in 1, 2 and 4 but NOT in 3. Migration 257 added the column,
    the router accepted the entity, the invoice form rendered the inputs and the
    PDF printed them — and no screen let anybody DEFINE one, because that array
    fills the dropdown. The whole path worked and no customer could start it.

  · `client`, `activity` and `follow_up` were in 1, 2 and 3 but NOT in 4. Each
    had a `custom_data` column from migration 131 and NO write path: the form
    offered the entity, an org could define a field against it, and the value
    was dropped on every save. Silently — the screen said it saved.

The second is the worse of the two. A missing entry is invisible; a field that
accepts input and discards it looks like it works.

── WHY THIS COMPARES SETS RATHER THAN LISTING NAMES ────────────────────────

Asserting the expected six names would be a FIFTH copy of the same list, and
the next person to add an entity would have five places to miss. This reads
each of the four and requires them to agree, so none can move alone.
"""
import os
import re

import pytest

_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = ("No live DATABASE_URL. Run: cd backend && railway run "
           "--service Kartavaya -- python -m pytest "
           "tests/test_custom_field_entities_are_reachable_and_stored.py -q")

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..")
REPO = os.path.join(BACKEND, "..")
GRAHA = os.path.join(BACKEND, "routers", "graha.py")
INPUTS = os.path.join(REPO, "frontend", "src", "pages", "graha",
                      "CustomFieldInputs.jsx")

#: entity -> (table, model class) it must be storable on.
STORAGE = {
    "contact":   ("graha_contacts",   "ContactCreate"),
    "deal":      ("graha_deals",      "DealCreate"),
    "client":    ("graha_clients",    "ClientCreate"),
    "activity":  ("graha_activities", "ActivityCreate"),
    "follow_up": ("graha_follow_ups", "FollowUpCreate"),
    "invoice":   ("ganit_invoices",   "InvoiceCreate"),
}


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


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def api_entities() -> set[str]:
    """`create_custom_field`'s allowlist, anchored on its own error message."""
    m = re.search(
        r"valid_entities\s*=\s*\(([^)]*)\)[\s\S]{0,400}?"
        r"body\.entity_type not in valid_entities",
        read(GRAHA))
    assert m, "could not find valid_entities in create_custom_field"
    return set(re.findall(r"[\"']([a-z_]+)[\"']", m.group(1)))


def ui_entities() -> set[str]:
    """`CUSTOM_FIELD_ENTITIES` — what a user can pick in the dropdown."""
    m = re.search(r"CUSTOM_FIELD_ENTITIES\s*=\s*\[(.*?)\]", read(INPUTS), re.S)
    assert m, "could not find CUSTOM_FIELD_ENTITIES"
    return set(re.findall(r"id:\s*'([a-z_]+)'", m.group(1)))


def test_the_two_lists_were_actually_parsed():
    """THE ANTI-VACUITY FLOOR.

    Every comparison below is set equality, and an empty set equals an empty
    set. If either parser silently failed, the whole file would pass over
    nothing at all.
    """
    assert len(api_entities()) >= 5, f"parsed {api_entities()} from the router"
    assert len(ui_entities()) >= 5, f"parsed {ui_entities()} from the frontend"
    assert "contact" in api_entities() and "contact" in ui_entities()


def test_the_api_and_the_ui_offer_the_same_entities():
    api, ui = api_entities(), ui_entities()
    assert api == ui, (
        "an entity the API accepts but no screen offers is a feature nobody "
        "can reach; one the UI offers but the API refuses is a 400 on save.\n"
        f"  api only: {sorted(api - ui)}\n  ui only:  {sorted(ui - api)}")


def test_every_offered_entity_has_somewhere_to_put_the_value():
    """The defect that silently dropped data.

    An entity in the dropdown with no `custom_data` column, or with a column
    nothing writes, accepts input on screen and discards it.
    """
    src = read(GRAHA)
    missing = []
    for entity in sorted(ui_entities()):
        table, model = STORAGE.get(entity, (None, None))
        if table is None:
            missing.append(f"{entity}: not in this test's STORAGE map — add it")
            continue
        # The create model must carry the field...
        m = re.search(rf"class {model}\(BaseModel\):(.*?)(?=\nclass |\n@router)",
                      src, re.S)
        body = m.group(1) if m else ""
        if model == "InvoiceCreate":
            body = read(os.path.join(BACKEND, "routers", "ganit.py"))
        if "custom_data" not in body:
            missing.append(f"{entity}: {model} has no custom_data field")
    assert missing == [], "entities that accept a field and drop its value:\n" + \
                          "\n".join(f"  {m}" for m in missing)


def test_live_the_database_check_holds_the_same_set():
    async def q(conn):
        return await conn.fetchval(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            " WHERE conname = 'graha_custom_fields_entity_type_check'")

    definition = run_live(q)
    assert definition, "the entity_type CHECK does not exist"
    in_db = set(re.findall(r"'([a-z_]+)'::text", definition))
    assert in_db, f"parsed nothing out of {definition!r}"
    assert in_db == api_entities(), (
        f"database: {sorted(in_db)}\nrouter:   {sorted(api_entities())}")


def test_live_every_entity_really_has_a_custom_data_column():
    """The claim above is about the MODEL. This is about the column."""
    async def q(conn):
        return await conn.fetch(
            "SELECT table_name FROM information_schema.columns "
            " WHERE table_schema='public' AND column_name='custom_data'")

    have = {r["table_name"] for r in run_live(q)}
    need = {STORAGE[e][0] for e in ui_entities() if e in STORAGE}
    assert need <= have, (
        f"offered in the UI but the table has no custom_data column: "
        f"{sorted(need - have)}")
