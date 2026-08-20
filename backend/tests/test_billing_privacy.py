"""Aekam bills ORGANISATIONS, not people — and the bill still works.

The owner's rule, 2026-08-07, in full: "Aekam must not be able to see client
personal data, and orgs must not see each other's." `tests/test_platform_
privacy.py` pins it as a general property over the whole tree. This file pins
the five billing endpoints a security review found violating it on 2026-08-20,
one behaviour at a time, and — just as importantly — pins the numbers that had
to survive.

── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────

Four surfaces, all reachable by FINANCE_CONSOLE_ROLES (god mode ∪
account_finance — four live accounts), none of which audited anything:

  1. `services/credits.py:usage_by_person` selected `u.email AS email` AND
     `COALESCE(u.full_name, u.name, u.email) AS name`. It is the body behind
     `/orgs/{org_id}/usage/people` and `/orgs/{org_id}/usage/sources/{source}/
     people`, so Aekam's spend-by-person tab was a roster of every customer's
     staff, by address — and a second copy of the same address arrived in a
     field called `name` for anybody with an incomplete profile.
  2. `routers/billing.py:_balance_body` did the same for the member-ceiling
     table.
  3. `/orgs/{org_id}/usage/transactions` accepted `?user_id=` — a per-person
     spend drill-down that could be pointed at any org.
  4. `/orgs/{org_id}/outbound/messages` returned RAW recipient addresses and was
     SEARCHABLE by address, unbounded by period. Live on 2026-08-20 that table
     held 92 distinct addresses, most of them third parties who have never had
     an account here. The largest personal-data exposure in the product.

── THE SHAPE OF THE FIX, AND WHY IT IS A DEFAULT AND NOT A FILTER ──────────

One keyword, `include_contact`, threaded from the route into the body and into
the service, DEFAULTING TO FALSE at every level. The `/me/*` family passes True
because an organisation reading its own members is explicitly permitted; the
`/orgs/{org_id}/*` family passes nothing.

The alternative — fetch everything and drop the addresses in the console
handler — was rejected, and section 2 below is why: a redaction is a line that
can be deleted with every test still green, and the row has by then been through
a query plan, a connection buffer and any statement log. The column has to be
absent from the SELECT for its absence to mean anything.

── AND THE HALF THAT IS NOT ABOUT PRIVACY ──────────────────────────────────

Section 5 exists because "nothing that removes a rupee amount will be accepted"
is the other half of this brief. Every credit figure, every share, every
ceiling, every message-unit count is asserted IDENTICAL across the two doors.
The only difference between what an org's admin sees and what Aekam sees is
whether a human being is named by address.
"""
import ast
import inspect
import textwrap
from datetime import datetime, timezone

import pytest

import routers.billing as billing
from services import credits

pytestmark = pytest.mark.asyncio

ORG = "11111111-1111-1111-1111-111111111111"
SINCE = datetime(2026, 8, 1, tzinfo=timezone.utc)
UNTIL = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _sql(fn) -> str:
    """Every executable string literal in one function, joined, lowercased.

    The same assembly `test_platform_privacy.py`'s ratchet uses, restated here
    rather than imported so this file stands on its own — and for the same two
    reasons. JOINED FIRST: these queries are built from adjacent f-string
    fragments, and a filter that tested them one at a time is exactly the defect
    that let the leak through the previous ratchet. DOCSTRINGS EXCLUDED: every
    function below explains in prose what it must not return, and those words
    are `ast.Constant` values too.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    body = tree.body[0]
    skip = set()
    for node in ast.walk(body):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc is not None and node.body and isinstance(node.body[0], ast.Expr):
                skip.add(id(node.body[0].value))
    parts = [n.value for n in ast.walk(body)
             if isinstance(n, ast.Constant) and isinstance(n.value, str)
             and id(n) not in skip]
    return " ".join(" ".join(parts).split()).lower()


class _RecordingConn:
    """A connection that answers one canned ledger and remembers the SQL.

    The pool in this suite is a MagicMock that answers any query, so driving an
    endpoint proves the shape of a fixture. The leak here IS the SELECT, so the
    QUERY TEXT is what is asserted — and the rows are canned so that section 5
    can compare two calls that saw identical data.
    """

    #: One spender, deliberately with NO name on file and an address that a
    #: `COALESCE(..., u.email)` would have promoted into the `name` column. That
    #: is the exact row the display-name leak was invisible on.
    ROW = {
        "user_id": "user_asha",
        "name": "Name not on file",
        "email": "a***@example.com",
        "credits": 420,
        "tx_count": 7,
        "metered_only_credits": 0,
        "unitemised_credits": 0,
        "unitemised_tx": 0,
    }

    def __init__(self):
        self.queries: list[tuple[str, tuple]] = []

    async def fetch(self, query, *args):
        self.queries.append((query, args))
        # The projection decides which keys exist on a real row, so the fake
        # obeys it: asking for a key the SELECT did not name must raise here,
        # the same way asyncpg's Record does.
        row = dict(self.ROW)
        if "u.email as email" not in " ".join(query.lower().split()):
            row.pop("email")
        return [row]

    @property
    def sql(self) -> str:
        return " ".join(" ".join(q for q, _ in self.queries).lower().split())


# ════════════════════════════════════════════════════════════════════════════
# 1 · THE SERVICE DEFAULTS TO CLOSED
#
# `services/credits.py` cannot see who is asking. That is precisely why the
# decision cannot live there as a guess and why the default has to be the safe
# one: a caller written next quarter that forgets the argument gets no
# addresses, and a caller that wants them has to say so in a diff.
# ════════════════════════════════════════════════════════════════════════════

def test_usage_by_person_defaults_to_no_contact_details():
    """The default is the whole guard. If it ever flips, everything below is
    still green and the leak is back."""
    param = inspect.signature(credits.usage_by_person).parameters["include_contact"]
    assert param.default is False
    assert param.kind is inspect.Parameter.KEYWORD_ONLY, (
        "positional would let a caller pass it by accident"
    )


async def test_aekam_side_spend_by_person_selects_no_address():
    conn = _RecordingConn()
    body = await credits.usage_by_person(conn, ORG, since=SINCE, until=UNTIL)

    assert "u.email" not in conn.sql, "the Aekam-side query still selects an address"
    assert "email" not in body["people"][0], (
        "the Aekam-side response still carries an address"
    )


async def test_the_display_name_does_not_fall_back_to_an_address():
    """`COALESCE(full_name, name, email)` is the same leak wearing a different
    column name: it puts an address in a field called `name`, where nobody
    reviewing a diff would look for one.

    `NULLIF(TRIM(...))` and not a bare COALESCE — a bare one treats `''` as a
    value present, so a profile whose name field was submitted blank comes back
    blank rather than reaching the literal.
    """
    conn = _RecordingConn()
    await credits.usage_by_person(conn, ORG, since=SINCE, until=UNTIL)

    assert "coalesce(u.full_name, u.name, u.email)" not in conn.sql
    assert "nullif(trim(u.full_name), '')" in conn.sql
    assert "'name not on file'" in conn.sql


async def test_the_org_reading_itself_still_gets_its_own_members_addresses():
    """The rule is about crossing a tenant boundary. Inside one, the ceiling and
    spend screens invite by the address, and the org already holds every one."""
    conn = _RecordingConn()
    body = await credits.usage_by_person(
        conn, ORG, since=SINCE, until=UNTIL, include_contact=True,
    )
    assert "u.email as email" in conn.sql
    assert body["people"][0]["email"]


async def test_the_group_by_moves_with_the_projection():
    """Not cosmetic. `GROUP BY 1, 2, 3` left hard-coded when the email column
    goes away is not a syntax error — position 3 becomes `credits`, and the
    result is a WRONG BILL rather than a failure anybody would notice."""
    closed = _RecordingConn()
    await credits.usage_by_person(closed, ORG, since=SINCE, until=UNTIL)
    assert "group by 1, 2 " in closed.sql + " "

    opened = _RecordingConn()
    await credits.usage_by_person(
        opened, ORG, since=SINCE, until=UNTIL, include_contact=True)
    assert "group by 1, 2, 3" in opened.sql


# ════════════════════════════════════════════════════════════════════════════
# 2 · THE ROUTES PICK A SIDE, AND THE CONSOLE SIDE PICKS NOTHING
#
# Asserted on the SOURCE and not by driving the endpoint, deliberately. The pool
# is a MagicMock and answers any query, so a driven `/orgs/{org_id}/usage/people`
# returns whatever the fixture holds whichever argument the handler passed. What
# is under test is which argument it passed.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("handler", [
    "my_usage_people", "my_usage_source_people", "my_balance",
    "my_outbound_messages",
])
def test_the_me_family_asks_for_contact_details_explicitly(handler):
    src = " ".join(inspect.getsource(getattr(billing, handler)).split())
    assert "include_contact=True" in src, (
        f"{handler} is an org reading itself and must still get addresses"
    )


@pytest.mark.parametrize("handler", [
    "org_usage_people", "org_usage_source_people", "org_balance",
    "org_outbound_messages", "org_usage_transactions", "org_usage_sources",
])
def test_the_console_family_never_asks_for_contact_details(handler):
    src = " ".join(inspect.getsource(getattr(billing, handler)).split())
    assert "include_contact=True" not in src, (
        f"{handler} is Aekam reading a customer and must not ask for addresses"
    )


def test_the_balance_bodys_two_projections():
    """One function, two column lists, chosen by a bool the server sets.

    Written out rather than assembled from a caller's string — the house rule
    for a dynamic identifier is that it comes from a server-side allowlist, and
    a two-branch literal is the smallest possible allowlist.
    """
    # The name expression is a module constant, so that one spelling of the
    # display rule exists rather than one per query. Asserted where it lives.
    name_sql = billing._MEMBER_NAME_SQL.lower()
    assert "coalesce(full_name, name, email)" not in name_sql, (
        "the ceiling table still promotes an address into the name column"
    )
    assert "nullif(trim(full_name), '')" in name_sql
    assert "'name not on file'" in name_sql

    sql = _sql(billing._balance_body)
    assert ", email" in sql, "the /me twin must still be able to select it"
    assert "include_contact" in " ".join(
        inspect.getsource(billing._balance_body).split()
    ), "the two projections are no longer chosen by the flag"


# ── The per-person drill-down Aekam could point at any org ─────────────────

def _query_params(path: str, method: str = "GET") -> set[str]:
    """The query parameter names one route actually BINDS.

    Read off FastAPI's own `dependant`, not off the Python signature, because
    the two can disagree: a parameter removed from the signature but reachable
    another way is still bound, and one left in the signature without a `Query`
    is not a query parameter at all.

    Off `billing.router` rather than `server.app.routes` — this app assembles
    its routers through a `_IncludedRouter` wrapper, so the app's route list is
    not flat and does not carry paths. The APIRouter applies its own prefix at
    construction, so `route.path` here is already the mounted path.
    """
    for route in billing.router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", ()):
            return {p.name for p in route.dependant.query_params}
    raise AssertionError(f"{method} {path} is not mounted on billing.router")


async def test_aekam_cannot_drill_one_persons_spend_inside_a_customer():
    """`?user_id=` was a surveillance surface, not a billing one: pick a name off
    `/usage/people`, pass its id here, and read one named individual's activity
    inside a tenant nobody at Aekam belongs to."""
    from fastapi import HTTPException

    params = _query_params("/api/v1/billing/orgs/{org_id}/usage/transactions")
    # BOUND, in order to be REFUSED. `BillingUsageSection.jsx:568` sends this on
    # both doors, and FastAPI drops an unknown query parameter in silence — so
    # deleting it would leave the console showing the WHOLE ORGANISATION'S
    # ledger under a modal titled with one person's name.
    assert "user_id" in params
    # And the figures are all still here.
    assert {"period", "source", "limit"} <= params

    # The refusal is raised BEFORE the pool is touched, so no fixture is needed
    # and `request=None` never reaches the audit helper.
    with pytest.raises(HTTPException) as exc:
        await billing.org_usage_transactions(
            org_id=ORG, request=None, period=None, source=None,
            user_id="user_asha", limit=10, user={"user_id": "aekam"},
        )
    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "per_person_drilldown_not_available"
    assert "/me/usage/transactions" in exc.value.detail["message"]


def test_the_org_keeps_its_own_per_person_drill_down():
    """They are inside the tenant, they are accountable for the shared balance,
    and "who ran up this month's bill" is what their ceiling screen is for."""
    assert "user_id" in _query_params("/api/v1/billing/me/usage/transactions")


# ════════════════════════════════════════════════════════════════════════════
# 3 · THE OUTBOUND LOG — DOMAIN, NEVER ADDRESS
# ════════════════════════════════════════════════════════════════════════════

def _outbound_pool(mock_pool):
    """Wire the suite's mock pool so `_outbound_messages_body` records its SQL."""
    seen: list[str] = []

    async def _fetch(query, *args):
        seen.append(query)
        return []

    mock_pool.acquire.return_value.fetch.side_effect = _fetch
    return seen


async def test_aekam_sees_the_domain_and_never_the_address(mock_pool):
    seen = _outbound_pool(mock_pool)
    body = await billing._outbound_messages_body(
        ORG, "2026-08", None, None, None, 50,
    )
    sql = " ".join(" ".join(seen).lower().split())

    assert "split_part(recipient, '@', 2) as target" in sql, (
        "the console still selects the raw address"
    )
    assert "recipient, subject_or_title" not in sql
    assert body["target_is"] == "domain", (
        "a console that captions a domain as an address claims to know "
        "something it was not told"
    )


async def test_the_org_still_sees_the_address_on_its_own_log(mock_pool):
    """"Did Asha get her payslip?" is unanswerable without it, and Asha works
    for the organisation asking."""
    seen = _outbound_pool(mock_pool)
    body = await billing._outbound_messages_body(
        ORG, "2026-08", None, None, None, 50, include_contact=True,
    )
    sql = " ".join(" ".join(seen).lower().split())
    assert "recipient as target" in sql
    assert "split_part" not in sql
    assert body["target_is"] == "address"


async def test_an_address_lookup_on_the_console_is_refused_by_name(mock_pool):
    """REFUSED, NOT IGNORED. FastAPI drops an unknown query parameter silently,
    so a console still sending `recipient=` would get an UNFILTERED period list
    under a heading naming one person — a wrong answer that looks like a right
    one. The refusal names the replacement."""
    from fastapi import HTTPException

    _outbound_pool(mock_pool)
    with pytest.raises(HTTPException) as exc:
        await billing._outbound_messages_body(
            ORG, "2026-08", None, None, "a***@example.com", 50,
        )
    assert exc.value.status_code == 400
    detail = exc.value.detail
    assert detail["error"] == "recipient_lookup_not_available"
    assert "recipient_domain" in detail["message"]


async def test_the_domain_filter_is_a_bound_parameter(mock_pool):
    """asyncpg bind parameters only. A domain interpolated into the WHERE clause
    would be the same class of defect as the leak it replaces."""
    seen = _outbound_pool(mock_pool)
    await billing._outbound_messages_body(
        ORG, "2026-08", None, None, None, 50, domain="@example.com",
    )
    sql = " ".join(" ".join(seen).lower().split())
    assert "lower(split_part(recipient, '@', 2)) = lower($" in sql
    assert "example.com" not in sql, "the domain was interpolated, not bound"


def test_the_console_route_offers_a_domain_and_not_an_address():
    params = _query_params("/api/v1/billing/orgs/{org_id}/outbound/messages")
    assert "recipient_domain" in params
    # `recipient` remains BOUND, in order to be refused with a sentence. See
    # the handler: an unknown parameter is dropped in silence, and silence here
    # is a wrong answer that looks like a right one.
    assert "recipient" in params


# ════════════════════════════════════════════════════════════════════════════
# 4 · A CROSS-TENANT READ LEAVES A ROW
#
# Independent of the columns. `server.py:list_users` learned this on 2026-08-07
# — the directory was fixed by dropping `email`, and the other half of the same
# fix was `platform.user_directory_read`. Every `/orgs/{org_id}/*` read here was
# the same act aimed at one customer's money, and wrote nothing.
# ════════════════════════════════════════════════════════════════════════════

def _console_get_handlers() -> dict[str, ast.AST]:
    """Every GET handler in `routers/billing.py` mounted under /orgs/{org_id}.

    Discovered from the decorator rather than listed, so a console read added
    later is covered by existing here rather than by somebody remembering.
    """
    source = inspect.getsource(billing)
    tree = ast.parse(source)
    out: dict[str, ast.AST] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            func = dec.func
            if getattr(func, "attr", None) != "get":
                continue
            if not dec.args or not isinstance(dec.args[0], ast.Constant):
                continue
            if str(dec.args[0].value).startswith("/orgs/{org_id}"):
                out[node.name] = node
    return out


def test_every_console_read_of_a_customers_bill_is_audited():
    handlers = _console_get_handlers()
    assert len(handlers) >= 8, (
        f"only {len(handlers)} console GETs discovered; the decorator scan has "
        f"stopped matching"
    )
    missing = sorted(
        name for name, node in handlers.items()
        if "_audit_console_read" not in (ast.get_source_segment(
            inspect.getsource(billing), node) or "")
    )
    assert not missing, (
        "Aekam-side reads of a customer's billing surface that leave no trace: "
        + ", ".join(missing)
    )


def test_the_audit_row_is_a_warning_and_names_the_org():
    """`warn`, not `info`, matching `platform.user_directory_read`: it is a
    platform account reaching into a tenant it is not part of. And `org_id` is
    on the row, because an audit trail that cannot say WHICH customer was read
    is a trail nobody can answer a question with."""
    src = _sql(billing._audit_console_read) + " " + " ".join(
        inspect.getsource(billing._audit_console_read).split())
    assert 'severity="warn"' in src
    assert "org_id=org_id" in src


def test_an_org_reading_itself_writes_nothing():
    """A row per page-load on `/me/*` would bury the rows that matter. An
    organisation reading its own bill is not a tenant boundary crossing."""
    for handler in ("my_usage_people", "my_balance", "my_outbound_messages",
                    "my_billing_lines", "my_usage_transactions"):
        src = inspect.getsource(getattr(billing, handler))
        assert "_audit_console_read" not in src, handler


# ════════════════════════════════════════════════════════════════════════════
# 5 · THE BILL STILL WORKS
#
# The other half of the brief: nothing that removes a rupee amount is
# acceptable. Both doors are called against the SAME canned ledger and every
# figure is compared.
# ════════════════════════════════════════════════════════════════════════════

async def test_every_spend_figure_is_identical_on_both_sides():
    aekam = await credits.usage_by_person(
        _RecordingConn(), ORG, since=SINCE, until=UNTIL)
    own = await credits.usage_by_person(
        _RecordingConn(), ORG, since=SINCE, until=UNTIL, include_contact=True)

    assert aekam["total_credits"] == own["total_credits"] == 420
    assert aekam["unitemised_credits"] == own["unitemised_credits"]
    assert aekam["unitemised_tx"] == own["unitemised_tx"]

    a, o = aekam["people"][0], own["people"][0]
    for field in ("user_id", "credits", "tx_count", "metered_only_credits"):
        assert a[field] == o[field], f"{field} differs between the two doors"

    # And the ONE difference is the one intended.
    assert set(o) - set(a) == {"email"}


async def test_aekam_can_still_tell_two_spenders_apart():
    """Dropping the address must not make the report useless. A name is what
    replaces it — and `'Name not on file'` is a sentence somebody can act on,
    where a blank cell or a raw user id is not.

    `check-rendered-ids` is the other half of this: the console must never fall
    back to rendering a UUID, so the name expression can never return NULL for a
    row that joined."""
    conn = _RecordingConn()
    body = await credits.usage_by_person(conn, ORG, since=SINCE, until=UNTIL)
    person = body["people"][0]
    assert person["name"]
    assert person["name"] != person["user_id"]
    assert person["credits"] == 420


def test_the_outbound_money_figures_are_untouched():
    """`_outbound_body` is a GROUPED read — channel, purpose, status, mode,
    counts and message units — with no recipient column and none added. The
    message-unit figure an operator reconciles against an AWS invoice is the
    same on both doors, and this is the assertion that says so."""
    sql = _sql(billing._outbound_body)
    assert "recipient" not in sql
    # `_SES_UNITS` is a module constant interpolated into the query, so it is
    # asserted where it lives — and that it is still what this body sums.
    assert "ceil(bytes / 262144.0)" in billing._SES_UNITS
    assert "_ses_units" in " ".join(
        inspect.getsource(billing._outbound_body).split()).lower()
    src = inspect.getsource(billing.org_outbound)
    assert "_outbound_body" in src, "the console still reads the same body"
