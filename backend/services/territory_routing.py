"""
territory_routing.py — PIN -> territory -> rep, for Graha contacts.

"PIN" here is the **Postal Index Number**, the six-digit Indian postcode.
`400001` is Fort, Mumbai. It is not a password. The whole of Phase 7 hangs on
that number because it is the only part of an Indian address that is
machine-readable without a geocoder.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

`graha_territories.rules->'pincodes'` had **zero consumers in the entire
backend** until this file. Proven, not asserted: before it,
`grep -rn "pincodes" --include=*.py backend/` returned exactly one line, and it
was a `print` inside a script. Territories could be drawn, named, given a PIN
list and assigned members — and nothing anywhere read any of it. **Territories
routed nothing.** That, and not the map, was the gap.

`POST /territories/{id}/assign-next` had zero callers for the same reason: the
round-robin worked and nobody ever reached it. This module is what calls it, so
`assign_next_user` below is the round-robin ITSELF, moved here rather than
copied — `routers/graha.py:territory_round_robin` now delegates to it. Two
implementations of "whose turn is it" would drift the first time one of them
learned something, and the thing they would disagree about is who gets paid for
a lead.

── PURE, AND WHAT THAT MEANS HERE ───────────────────────────────────────────

No router, no `get_pool()`, no HTTP. Every function is handed what it needs.
`normalise_pin` and `territories_for_pin` touch nothing at all and are the two
worth testing hardest, because they hold the only two rules in the feature.

**`route_contact` must be handed an asyncpg CONNECTION, not a Pool.** It opens
`conn.transaction()`, which a Pool does not have, and the connection is also how
the caller's own transaction is joined — see the savepoint note on
`route_contact`. Everything else here only ever calls `fetch`/`fetchrow`/
`execute` and takes either.

── THE RULE THAT KEEPS REGRESSING ───────────────────────────────────────────

**A PIN in no territory assigns nothing and REFUSES nothing.** Same standing
rule as GSTIN/PAN/TAN: it blocks nothing, ever. A contact whose address is a
village with no territory, or whose PIN is `NW1 245` because the customer is in
London, is a perfectly good contact — it simply routes nowhere. Nothing in this
module raises on unroutable input, and `route_contact` swallows even its own
bugs (see its docstring) so that a routing failure can never cost a customer
the contact they were creating.

── MEASURED LIVE, 2026-08-27, read-only ─────────────────────────────────────

    Territories, active                E2E 17 · Unicode 0 · Aekam Inc 1
    ...whose rules carry a pincodes ARRAY          3 (all of them empty)
    ...carrying at least one PIN                   0
    ...carrying at least one member                0
    Contacts with a territory                      0 of 288
    Contacts routable through the ladder below     Unicode 41 · E2E 0

So on the day this shipped it changed nothing by itself, and could not: the
round-robin below returns `NO_MEMBERS` for every territory that exists, and no
territory claims a single PIN. 7.0 gave the product the forms to fix both.

**The plan's figure of 42 is stale.** `docs/plans/PHASE-7` says the client
fallback takes Unicode "from 38 routable contacts to 42". Live it is **41** —
38 from the contact's own billing address, 3 more inherited from the client,
not 4. The ladder is still worth its extra join; the number is not 42.
"""
import json
import logging
import re
from typing import NamedTuple

log = logging.getLogger(__name__)


#: An Indian PIN: six digits, and **never a leading zero**. No PIN begins with
#: 0 — the first digit is the postal region, numbered 1 to 8 (9 is Army Post
#: Office). So `012345` is not a PIN that exists, it is a truncated something
#: else, and treating it as one would route a contact into a real territory on
#: the strength of a typo.
_PIN_RE = re.compile(r"^[1-9][0-9]{5}$")

#: The ladder, in order. These are the column ALIASES of `PIN_LADDER_SELECT`
#: below, so the order of this tuple *is* the precedence, in one place.
PIN_SOURCES = ("billing", "shipping", "client")


def normalise_pin(raw) -> str:
    """The PIN, or `''`. The only definition of "is this a PIN" in the product.

    Deliberately total: it accepts `None`, an `int` (a PIN typed into a numeric
    field arrives as one), and any string, and answers `''` for everything that
    is not six digits starting 1-9. Nothing here raises, because everything
    upstream of it is user-typed address text.

    `fullmatch` rather than `match`, and the reason is not pedantry: `$` in
    Python also matches immediately BEFORE a trailing newline, so `match()`
    would accept `"400001\\n"` — and a pasted address line ends in exactly that.
    The `.strip()` above already removes it; `fullmatch` means the guard does
    not depend on the strip staying there.
    """
    if raw is None:
        return ""
    text = str(raw).strip()
    return text if _PIN_RE.fullmatch(text) else ""


# ── Territories, and their PIN lists ─────────────────────────────────────────

class Territory(NamedTuple):
    """One sales patch, reduced to the three things routing needs.

    `id` rides along because the write needs it; `name` is beside it in the
    same object precisely so no caller ever has to render the id to say which
    territory something matched. Every dict this module returns names the
    territory and omits the id where the value is destined for a screen.
    """
    id: str
    name: str
    priority: int | None
    pincodes: frozenset[str]


#: Org-scoped and `is_active`-scoped, for the same reason
#: `resolve_contact_territory` is: `graha_territories.id` is unique table-wide
#: and DELETE is a soft delete. A territory another org owns, or one this org
#: deleted last month, must not claim a PIN.
TERRITORIES_SQL = (
    "SELECT t.id::text AS id, t.name, t.rules "
    "FROM public.graha_territories t "
    "WHERE t.org_id = $1::uuid AND t.is_active = TRUE "
    "ORDER BY t.name"
)


def _rules_dict(rules) -> dict:
    """`rules` as a dict, whatever the connection handed back.

    `db.py` registers a jsonb codec, so a pooled connection decodes this column
    to a `dict`. A bare `asyncpg.connect()` — which is what the live-schema test
    uses, and what `railway run` scripts use — has no codec and returns the raw
    `str`. Handling both here means a caller never has to know which kind of
    connection it holds.
    """
    if isinstance(rules, str):
        try:
            rules = json.loads(rules)
        except ValueError:
            return {}
    return rules if isinstance(rules, dict) else {}


def _pincodes_of(rules) -> frozenset[str]:
    """The PIN list on a territory — tolerant of every shape `rules` can hold.

    ── THE `isinstance(raw, list)` GUARD IS LOAD-BEARING ────────────────────

    `TerritoryCreate.rules` is a bare `dict`, so the product accepts ANY JSON
    under `pincodes` — including a string, which is exactly what somebody types
    when a territory has one PIN. Doing this match in SQL with
    `jsonb_array_elements_text(rules->'pincodes')` is the obvious shape and it
    is a trap; verified against the live database on 2026-08-27:

        {"pincodes": "400001"}  -> InvalidParameterValueError:
                                   cannot extract elements from a scalar
        {"pincodes": [400001]}  -> ['400001']
        {}                      -> []

    One territory saved with a bare string would therefore 500 the routing of
    every contact in the org, including the 41 that have nothing to do with it.
    Reading the column and filtering in Python cannot fail that way, and it is
    also how the `[400001]` case — PINs saved as JSON NUMBERS, which the second
    line above shows the product will happily store — comes out right: every
    element goes through `normalise_pin`, which stringifies before it matches.

    15 of the 18 live territories have no `pincodes` key at all; three have an
    empty array. Both answer the empty set.
    """
    raw = _rules_dict(rules).get("pincodes")
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(p for p in (normalise_pin(x) for x in raw) if p)


def _priority_of(rules) -> int | None:
    """`rules.priority`, when it is an integer. `None` otherwise.

    ── AN OPEN OWNER QUESTION, ANSWERED DETERMINISTICALLY, NOT SILENTLY ─────

    "When one PIN falls in two territories, which wins?" is open question 1 in
    `docs/plans/PHASE-7` and the owner has not ruled. Nothing in the schema
    prevents an overlap — `UNIQUE(org_id, name)` is the only constraint — and
    ZERO overlaps exist today, so this code cannot yet be wrong in production.

    What it must not do is be ARBITRARY. Two runs over the same data must route
    a contact the same way, or the first support ticket is unanswerable. So:
    an optional integer `priority`, lowest wins, absent sorts last, ties broken
    by name. That is proposal 92 §8's recommendation and the Salesforce
    mechanism; if the owner rules differently it is this function and the sort
    in `territories_for_pin` that change, and nothing else.

    A non-integer `priority` is ignored rather than refused — this is a rules
    blob a person edits by hand, and per the standing rule it blocks nothing.
    """
    raw = _rules_dict(rules).get("priority")
    if isinstance(raw, bool):          # bool is an int subclass; not a priority
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().lstrip("-").isdigit():
        return int(raw.strip())
    return None


async def load_territories(conn, org_id: str) -> list[Territory]:
    """Every live territory in this org, with its PIN list already parsed.

    Loaded ONCE per backfill and handed to `route_contact`, rather than re-read
    per contact: the whole point of `route-all` is that it is one admin action
    over hundreds of rows, and 288 identical territory reads is how a route that
    "just loops" becomes a route that times out.
    """
    rows = await conn.fetch(TERRITORIES_SQL, org_id)
    return [
        Territory(
            id=r["id"],
            name=r["name"],
            priority=_priority_of(r["rules"]),
            pincodes=_pincodes_of(r["rules"]),
        )
        for r in rows
    ]


def territories_for_pin(territories: list[Territory], pin: str) -> list[Territory]:
    """Every territory claiming *pin*, best first. Pure; no I/O.

    Returns a LIST rather than the winner, so the caller can see and report an
    overlap instead of having it silently resolved. `route_contact` takes the
    first and names the rest in `overlapping`, which is how an overlap becomes
    visible to a person before it becomes an incident.
    """
    pin = normalise_pin(pin)
    if not pin:
        return []
    hits = [t for t in territories if pin in t.pincodes]
    # `priority is None` sorts True (=1) last, so an unprioritised territory
    # always loses to one that asked for a position. Name is the final tiebreak
    # and is stable because `UNIQUE(org_id, name)` guarantees it is unique.
    return sorted(hits, key=lambda t: (t.priority is None, t.priority or 0, t.name))


# ── The PIN source ladder ────────────────────────────────────────────────────

#: The contact's own billing address, else its own shipping address, else its
#: CLIENT's address. Measured live on 2026-08-27: the client rung takes Unicode
#: Group from 38 routable contacts to **41** — the plan says 42 and that figure
#: is stale. Three contacts is a small return for an extra join, and it is
#: still the right trade: those three are people at a company whose address the
#: firm already holds, and asking for it twice is how an address goes stale.
#:
#: The join is org-scoped on BOTH columns. `graha_clients` has no composite
#: `(id, org_id)` constraint — `memory/graha_clients_join_leak` — so `cl.id =
#: c.client_id` alone would read another organisation's address and route this
#: org's contact on it.
#:
#: THE THREE RUNGS COME BACK RAW and are normalised in Python by `pin_for_row`.
#: Putting `~ '^[1-9][0-9]{5}$'` in the SQL as well would give the product two
#: definitions of a PIN, in two languages, and the day they disagree is the day
#: a contact routes on the website and not in the backfill. `normalise_pin` is
#: the only definition; this statement just fetches text.
#:
#: Verified live: `jsonb ->> 'pincode'` on a NON-object value returns NULL, it
#: does not raise — checked against a string, an array, a number and null. So
#: the "whole address stored as stringified JSON" shape that Unicode's
#: `Navrang Polymers` carries costs a NULL here and nothing worse.
PIN_LADDER_SELECT = (
    "SELECT c.id::text AS contact_id, "
    "       c.territory_id::text AS territory_id, "
    "       c.assigned_to, "
    "       c.billing_address->>'pincode'  AS billing, "
    "       c.shipping_address->>'pincode' AS shipping, "
    "       cl.address->>'pincode'         AS client "
    "FROM public.graha_contacts c "
    "LEFT JOIN public.graha_clients cl "
    "       ON cl.id = c.client_id AND cl.org_id = c.org_id "
    "WHERE c.org_id = $1::uuid AND c.is_active = TRUE "
)

#: One contact — what `create_contact` uses on the row it has just written.
PIN_LADDER_ONE = PIN_LADDER_SELECT + "AND c.id = $2::uuid"

#: Every live contact in the org — what the backfill route uses. Deliberately
#: NOT filtered on `territory_id IS NULL`: the route reports how many it
#: skipped because a person had already filed them, and it can only do that if
#: it sees them.
PIN_LADDER_ALL = PIN_LADDER_SELECT + "ORDER BY c.created_at"


def pin_for_row(row) -> tuple[str, str]:
    """`(pin, which_rung)` for one row of `PIN_LADDER_*`. Pure.

    Falls through on a rung that does not NORMALISE, not merely on one that is
    absent. Unicode's client `INC UK` carries `address->>'pincode' = 'NW1 245'`
    — a real UK postcode in an Indian PIN field, and a perfectly legitimate
    thing for a customer to have. Treating that rung as "answered" would stop
    the ladder dead on a value that can never match a territory; treating it as
    unanswered lets the next rung speak. Live the two readings give the same
    41, because no CONTACT currently holds a malformed PIN — but the value that
    proves the case is already in the database, one join away.
    """
    for source in PIN_SOURCES:
        pin = normalise_pin(row[source])
        if pin:
            return pin, source
    return "", ""


# ── The round-robin — ONE implementation, this one ───────────────────────────

#: `assign_next_user` could not find a live territory of that id in this org.
NO_TERRITORY = "no_territory"
#: It found one, and nobody is assigned to it. True of all 18 live territories
#: on 2026-08-27, which is why routing cannot yet hand anybody a lead.
NO_MEMBERS = "no_members"

_ROUND_ROBIN_READ = (
    "SELECT assigned_users, round_robin_index FROM public.graha_territories "
    "WHERE id = $1::uuid AND org_id = $2::uuid AND is_active = TRUE"
)

#: `AND org_id` is new here — `territory_round_robin` advanced the counter on
#: `WHERE id=$2::uuid` alone. It was never exploitable, because the SELECT above
#: had already proved the org owns the row, but a write whose WHERE clause is
#: weaker than the read that authorised it is one refactor away from being the
#: bug. Identical outcome, one fewer thing to reason about.
_ROUND_ROBIN_ADVANCE = (
    "UPDATE public.graha_territories SET round_robin_index = $1 "
    "WHERE id = $2::uuid AND org_id = $3::uuid"
)


async def assign_next_user(conn, org_id: str, territory_id: str) -> dict:
    """Whose turn is it in this territory — and advance the counter.

    THE ROUND-ROBIN ITSELF, lifted out of `routers/graha.py` rather than
    reimplemented beside it. `POST /territories/{id}/assign-next` now calls this
    function; before 2026-08-27 that route had zero callers in the whole repo,
    so "hand off to the existing round-robin" meant calling something nothing
    had ever called. One copy means the web button and automatic routing cannot
    disagree about whose turn it is.

    Returns a dict rather than raising, because its two callers want opposite
    things from a failure: the ROUTE turns "no such territory" into a 404 and
    "nobody assigned" into a 400, while ROUTING must do neither — it assigns
    nothing and refuses nothing. `reason` is `NO_TERRITORY`, `NO_MEMBERS`, or
    `''` when a person was picked.

    `index` is the position handed out, matching the route's long-standing
    response shape. It is `-1` when nobody was.
    """
    row = await conn.fetchrow(_ROUND_ROBIN_READ, territory_id, org_id)
    if row is None:
        return {"user": "", "index": -1, "reason": NO_TERRITORY}
    users = list(row["assigned_users"] or [])
    if not users:
        return {"user": "", "index": -1, "reason": NO_MEMBERS}
    idx = (row["round_robin_index"] or 0) % len(users)
    await conn.execute(_ROUND_ROBIN_ADVANCE, idx + 1, territory_id, org_id)
    # str() because migration 134 converted this column from uuid[] to text[]
    # and a database that has not had it yet hands back UUID objects.
    return {"user": str(users[idx]), "index": idx, "reason": ""}


# ── Routing one contact ──────────────────────────────────────────────────────

#: `assigned_to` is only ever written when it is EMPTY, and the guard is in the
#: statement as well as in Python. Open question 2 in `docs/plans/PHASE-7` —
#: "should routing set the rep, or only the territory?" — is the owner's and is
#: not yet answered; proposal 92 §8 recommends "territory always, rep only when
#: unassigned", which is what this is. It is also the only version that cannot
#: destroy anything: 41 of Unicode's 54 contacts already have an owner, and
#: silently reassigning live work is not a change anybody could undo.
#:
#: In SQL as well as in Python because the two are guarding different things.
#: Python decides whether to CONSUME a round-robin turn; the `COALESCE` decides
#: whether to overwrite an owner. Without the SQL half, an edit landing between
#: the read and this write would lose the owner it just set.
#:
#: `updated_at = NOW()` deliberately, following `compute_lead_score` — the other
#: derived-column backfill in this product, which stamps it the same way. The
#: cost is real and worth naming: nine mobile lists page on `?since=`, so a
#: backfill of 41 contacts re-sends 41 rows to every device. The alternative is
#: a row that changed and does not say so, and a device that shows the wrong
#: territory until something else happens to touch the contact.
#:
#: `updated_by` is deliberately NOT set. The admin who pressed the backfill
#: button did not edit these people, and writing their name onto 41 contacts
#: they never opened would put a false answer in the only column that records
#: who changed a row.
_ROUTE_WRITE = (
    "UPDATE public.graha_contacts "
    "SET territory_id = NULLIF($3,'')::uuid, "
    "    assigned_to  = COALESCE(NULLIF(assigned_to, ''), NULLIF($4,'')), "
    "    updated_at   = NOW() "
    "WHERE id = $1::uuid AND org_id = $2::uuid "
    "RETURNING *"
)

#: What `route_contact` answers when it routed nothing — which is the ordinary
#: outcome, not an error. Copied per call; never mutated.
_UNROUTED: dict = {
    "routed": False,
    "pin": "",
    "pin_source": "",
    "territory_id": "",
    "territory_name": "",
    "assigned_to": "",
    "overlapping": [],
    "kept": False,
    "error": "",
    "row": None,
}


async def _route(conn, org_id: str, contact_id: str,
                 territories: list[Territory] | None) -> dict:
    out = dict(_UNROUTED)
    row = await conn.fetchrow(PIN_LADDER_ONE, org_id, contact_id)
    if row is None:
        return out

    # A PERSON'S EXPLICIT CHOICE BEATS THE RULE, and this is the guard that
    # says so. 7.0 put a territory picker on the contact create form, so a
    # contact can arrive already filed; and the backfill runs over rows a
    # person may have filed by hand months ago. Routing fills a blank, it never
    # argues with an answer.
    if row["territory_id"]:
        out["kept"] = True
        return out

    out["pin"], out["pin_source"] = pin_for_row(row)
    if not out["pin"]:
        return out

    if territories is None:
        territories = await load_territories(conn, org_id)
    hits = territories_for_pin(territories, out["pin"])
    if not hits:
        # THE RULE. No territory claims this PIN, so nothing is assigned and
        # nothing is refused. Not a warning either — a contact outside every
        # territory is ordinary, and 41 of them on the first backfill would be
        # 41 log lines saying the product worked.
        return out

    winner = hits[0]
    out["territory_id"] = winner.id
    out["territory_name"] = winner.name
    if len(hits) > 1:
        out["overlapping"] = [t.name for t in hits]
        log.warning("PIN %s is claimed by %d territories in org %s (%s); "
                    "routing to %r on priority. Open question 1 in PHASE-7.",
                    out["pin"], len(hits), org_id,
                    ", ".join(t.name for t in hits), winner.name)

    # THE TURN IS ONLY TAKEN IF IT CAN BE USED. Asking the round-robin whose
    # turn it is ADVANCES the counter, so calling it for a contact that already
    # has an owner would burn a rep's turn and hand the next lead to the person
    # after them — the fairness the round-robin exists to provide, quietly
    # skewed by contacts it never touched.
    if not (row["assigned_to"] or "").strip():
        turn = await assign_next_user(conn, org_id, winner.id)
        out["assigned_to"] = turn["user"]

    written = await conn.fetchrow(_ROUTE_WRITE, contact_id, org_id,
                                  out["territory_id"], out["assigned_to"])
    out["routed"] = written is not None
    out["row"] = written
    return out


async def route_contact(conn, org_id: str, contact_id: str, *,
                        territories: list[Territory] | None = None) -> dict:
    """Route one contact. Never raises, never refuses, never overwrites.

    ── THE SAVEPOINT, AND WHY IT IS NOT OPTIONAL ────────────────────────────

    The call site inside `create_contact` sits INSIDE that handler's
    transaction, between the INSERT and `contact_created`. Two things follow,
    and they pull against each other:

      · routing must not be able to fail the create. A contact the customer
        typed is worth more than the territory we guessed for it, and the
        standing rule is that this blocks nothing.
      · a plain `try/except` around a DATABASE error inside an open
        transaction does not help. Postgres aborts the whole transaction on the
        first error; every later statement — `contact_created`, here — then
        fails with InFailedSQLTransaction. Swallowing the error would convert a
        routing bug into a lost contact AND a lost event, which is worse than
        letting it raise.

    `conn.transaction()` nested inside an open one issues a SAVEPOINT, so a
    failure rolls back to here and leaves the caller's transaction usable. That
    is the only mechanism that makes "swallow it" honest. Outside a transaction
    the same call is an ordinary one, which is what the backfill wants: each
    contact commits on its own, so a failure at contact 200 keeps the first 199.

    ── NOT `_bg()`, AND THE PLAN IS EMPHATIC ────────────────────────────────

    `compute_lead_score` is fired from `create_deal` with a bare
    `asyncio.ensure_future`, and `server.py:187-191` records what that costs: a
    Railway restart drops every pending background task, silently. A lead score
    that is recomputed late is a stale number; a territory that is never
    assigned is a lead nobody is working, and nothing anywhere would say so.
    Routing is part of the write, in the write's transaction.

    `territories` may be pre-loaded by a caller looping over many contacts.
    """
    try:
        async with conn.transaction():
            return await _route(conn, org_id, contact_id, territories)
    except Exception as exc:  # noqa: BLE001 — see the docstring; this may not raise
        log.warning("territory routing failed for contact %s in org %s: %s",
                    contact_id, org_id, exc, exc_info=True)
        out = dict(_UNROUTED)
        out["error"] = type(exc).__name__
        return out
