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


# ── 7.1: territories finally route something ─────────────────────────────────
#
# `rules->'pincodes'` had ZERO consumers in the entire backend until
# `services/territory_routing.py`. Proven at the time, not asserted:
# `grep -rn "pincodes" --include=*.py backend/` returned exactly one line and it
# was a `print` inside a script. Territories could be drawn, named, given a PIN
# list and assigned members, and nothing read any of it.
#
# The rules and the SQL are tested in `tests/test_territory_routing.py`, which
# also PREPAREs every statement against the live schema. What is tested HERE is
# the router's half: where the hook sits, who may press the backfill, and the
# three cross-tenant joins that 7.1 arms by putting values in the column.

import pathlib as _pathlib
import re as _re


def test_routing_runs_inside_the_write_and_not_in_a_background_task():
    """POSITION IS THE DESIGN, and both halves of it matter.

    After the INSERT, because routing reads the address that was just written
    and the client it was just attached to. Before `contact_created`, so the
    event the automation engine sees already carries the territory — a rule on
    "a contact is created in Gujarat" has to be able to read Gujarat off the
    event rather than off a row that acquires it a moment later.

    And NOT `_bg()`, which `docs/plans/PHASE-7` is emphatic about and
    `create_deal` does anyway for `compute_lead_score`: `server.py:187-191`
    records that a Railway restart drops every pending background task,
    silently. A stale lead score is a wrong number; an unrouted contact is a
    lead nobody is working and nothing anywhere says so.
    """
    code = _code(graha.create_contact)
    assert "territory_routing.route_contact" in code
    insert = code.index("INSERT INTO staging.graha_contacts")
    route = code.index("territory_routing.route_contact")
    event = code.index("contact_created(_conn")
    assert insert < route < event, (
        "the routing hook has moved out from between the INSERT and the event"
    )
    for backgrounded in ("_bg(", "ensure_future"):
        assert backgrounded not in code, (
            f"routing is fired through {backgrounded} — a Railway restart drops "
            f"it and nothing anywhere says the contact went unrouted"
        )


def test_the_create_response_names_the_territory_rather_than_its_id():
    """The screen has to say "filed under Gujarat". A uuid identifies nobody —
    `memory/decision_names_not_ids`."""
    tail = _code(graha.create_contact).split("return {")[-1]
    assert '"territory_name": routed["territory_name"]' in tail
    assert "territory_id" not in tail


def test_the_backfill_is_a_route_an_admin_presses_and_not_a_migration():
    """Migrations are pre-approved in this repo; REWRITING LIVE ROWS IS NOT.

    This writes `territory_id`, and possibly `assigned_to`, on hundreds of real
    contacts belonging to a real firm — and staging shares one Supabase
    database with production. So it has to be something a named person presses,
    in their own org, having decided the territories are right. A migration
    would have done it to every org on the next deploy, before anybody had
    drawn a single PIN list.
    """
    code = _code(graha.route_all_contacts)
    assert "is_org_admin" in code and "403" in code
    assert "territory_routing.route_contact" in code
    # It mirrors `rescore_all_contacts`, which is the shape the plan names.
    assert "is_org_admin" in _code(graha.rescore_all_contacts)


def test_the_backfill_reports_counts_and_names_never_contact_ids():
    """A backfill report is read by a person. `by_territory` is keyed by NAME,
    and the only contact id in the route is the one it hands to the service."""
    code = _code(graha.route_all_contacts)
    assert "by_territory" in code
    assert 'out["territory_name"]' in code
    body = code.split("report = {")[1].split("async with")[0]
    assert "contact_id" not in body and "_id" not in body, (
        "an id is being collected into the response a person reads"
    )


def test_the_backfill_reads_the_territories_once_for_the_whole_run():
    """288 identical territory reads is how a loop that "just works" becomes a
    request that times out."""
    code = _code(graha.route_all_contacts)
    assert code.count("load_territories") == 1
    assert "territories=territories" in code


def test_a_pin_no_territory_claims_is_counted_and_never_refused():
    """The standing rule, same as GSTIN/PAN/TAN: it blocks nothing. On the day
    7.1 shipped this was the outcome for ALL 41 routable contacts in Unicode
    Group, because no live territory carried a single PIN."""
    code = _code(graha.route_all_contacts)
    assert "no_territory_claims_it" in code
    # The only refusal in the whole route is the admin gate.
    assert code.count("HTTPException") == 1


def test_the_round_robin_has_exactly_one_implementation():
    """`POST /territories/{id}/assign-next` had ZERO callers in the repo before
    2026-08-27. 7.1 made it the mechanism that hands an incoming lead to a rep,
    so the manual button and the automatic path now share one body — two copies
    would drift on the first change, and what they would disagree about is who
    gets paid for a lead."""
    code = _code(graha.territory_round_robin)
    assert "territory_routing.assign_next_user" in code
    assert "round_robin_index" not in code, (
        "the router is doing the round-robin arithmetic again — there is now a "
        "second implementation of whose turn it is"
    )
    # The two failures keep their long-standing status codes.
    assert "404" in code and "400" in code


# ── 7.1a: the three cross-tenant joins ───────────────────────────────────────

_BACKEND = _pathlib.Path(__file__).resolve().parent.parent


def _sql_text(path: _pathlib.Path) -> str:
    """A file's SQL as one line, with comments and string quotes removed.

    Whole-file rather than per-function because these statements are built from
    adjacent string literals and a join's ON clause routinely sits on the line
    after the JOIN itself.
    """
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines()
             if not ln.strip().startswith("#")]
    return " ".join(" ".join(lines).replace('"', " ").split())


def _territory_join_sites():
    seen = set()
    for pattern in ("routers/*.py", "services/*.py", "services/**/*.py"):
        for path in sorted(_BACKEND.glob(pattern)):
            if path in seen:
                continue
            seen.add(path)
            text = _sql_text(path)
            for m in _re.finditer(r"JOIN staging\.graha_territories\s+(\w+)", text):
                tail = text[m.end():m.end() + 200]
                on = tail.split(" JOIN ")[0].split(" WHERE ")[0]
                yield path.name, m.group(1), on


def test_every_join_onto_a_territory_is_scoped_to_the_organisation():
    """PHASE-7.1a, AND THE REASON IT IS WELDED TO 7.1.

    Three joins — two in this router, one in `services/crm_report.py` — read
    `ON tr.id = d.territory_id` alone, each one sitting directly below a
    correctly-scoped client join. Migration 023 wrote a bare
    `REFERENCES staging.graha_territories(id)` with no `org_id` in it and
    `graha_territories.id` is unique table-wide, so the id alone reaches
    whichever organisation owns that uuid.

    All three were HARMLESS ONLY BECAUSE THE COLUMN WAS EMPTY: measured live on
    2026-08-27, 0 of 162 deals and 0 of 288 contacts carried a territory, and
    zero cross-org pairs existed. 7.1 is what fills the column. The leak closes
    in the commit that arms it, not after.

    This is a ratchet: a FOURTH join added anywhere in `routers/` or
    `services/` fails here until it carries the predicate.
    """
    sites = list(_territory_join_sites())
    assert sites, "the join scanner has stopped finding anything — check _sql_text"
    for filename, alias, on in sites:
        assert f"{alias}.org_id" in on, (
            f"{filename}: JOIN graha_territories {alias} ON {on.strip()[:90]} — "
            f"joins on the id alone. `graha_territories.id` is unique "
            f"table-wide, so this renders another organisation's territory."
        )


def test_a_deal_cannot_be_filed_under_another_orgs_territory():
    """`create_deal` wrote `body.territory_id` straight into the INSERT with no
    check at all, and the foreign key is not composite. It is not a labelling
    mistake: the kanban and the deal list both render that territory's NAME and
    the CRM report exports it to a mailed CSV."""
    for fn in (graha.create_deal, graha.update_deal):
        code = _code(fn)
        assert "resolve_contact_territory" in code, (
            f"{fn.__name__} writes territory_id with no org check"
        )
    # The value the INSERT binds must be the CHECKED local, not the raw body
    # field. `body.territory_id` still appears above, as the argument handed to
    # `resolve_contact_territory` — so the assertion is on the argument list,
    # which is everything after the statement itself.
    bound = _code(graha.create_deal).split('RETURNING *",')[1]
    assert "body.territory_id" not in bound, (
        "the unchecked value is still reaching the INSERT"
    )
    assert "territory_id," in bound


def test_the_dead_allowlist_entry_now_has_a_field_behind_it():
    """`_DEAL_COLS` has listed `territory_id` since the beginning and
    `DealUpdate` had no such field, so the entry could never match anything
    `body.dict(exclude_unset=True)` produced — a permission to write a column
    no request could ask for.

    RESOLVED BY ADDING THE FIELD, not by deleting the entry. Deleting it would
    have made a deal's territory settable exactly once, at create, and then
    unchangeable from every client for ever — the same "writable and
    unreachable" shape `contact_id` had, which this very model grew a field to
    fix. Territories get redrawn; a deal filed under the old one has to move.
    """
    assert "territory_id" in graha.DealUpdate.model_fields
    assert '"territory_id"' in _code(graha.update_deal)


def test_a_deals_territory_is_bound_with_its_type_not_as_a_bare_parameter():
    """A bare `$n` into a `uuid` column is the untyped-parse 500 PgBouncer
    turns every ambiguous expression into — `memory/incident_credits_untyped_sql`
    is the same failure on `$1 + $2`. The generic else-branch of the SET-build
    binds exactly that, so the name has to be inside the typed tuple."""
    patch = _code(graha.update_deal)
    assert '("client_id", "contact_id", "territory_id")' in patch, (
        "territory_id has fallen out of the typed branch of the deal SET-build"
    )
