"""
The bill: what it says the money went on, who is allowed to read it, and the one
line a top-up is allowed to create.

Three things ship together in this batch and each has a way of being wrong that
looks exactly like being right:

  · A PER-SOURCE REPORT that puts a one-off `content/blog` and a skill's
    `skill_step/blog` in the same row called "blog". The number is not obviously
    wrong — it is just two products' economics added together, and the shipped
    `by_kind` report has been doing it since it was written.
  · A LEDGER WITH 171 ROWS THAT PREDATE `kind`. Dropped, the tabs still add up
    to a plausible total and it is short by every transaction written before
    migration 095. Guessed at by parsing `description`, the money moves into
    buckets an operator is about to reconcile.
  · A TOP-UP THAT BILLS. A retried request that grants once and bills twice is
    the exact failure the "add to invoice" tick is supposed to make impossible,
    and a double-click is how it happens.

WHAT IS PINNED HERE

1. `content` AND `skill_step` ARE DIFFERENT SOURCES.
   Proved against the real `usage_by_source` with a ledger fake that classifies
   rows the way `_SOURCE_SQL` does — and `_classify` below is pinned to that SQL
   arm by arm, so the model cannot drift away from the query it stands in for.

2. PRE-095 ROWS ARE THEIR OWN BUCKET, VERBATIM.
   In `sources`, counted in `total_credits`, echoed at the top level, and never
   parsed into one of the itemised tabs.

3. TENANCY. `/me/*` reads the resolved org and nothing a caller sends can point
   it elsewhere. `/orgs/{id}/*` is Aekam-only, including over Aekam itself.

4. THE TOP-UP TICK CREATES EXACTLY ONE LINE, IN THE GRANT'S TRANSACTION, AND
   A RETRY CREATES NONE.

5. EVERY COLUMN AND EVERY NAME THIS FEATURE DEPENDS ON EXISTS.
   In the style of tests/test_prachar_audience.py and tests/test_credit_model.py,
   and for the reason both of them give: the recurring failure in this repo is
   Python naming a column or a module Postgres or the filesystem does not have,
   surfacing as an opaque 500 long after the deploy.

6. THE FOUR SEAMS THIS FILE DID NOT CATCH (section 6, added after three reviews
   found them and this file went on passing):
     · a monthly line ENDED and REOPENED in the same month is billed ONCE —
       the ended row still satisfies `period_end >= period_start = this month`,
       so the due query returns both and `uq_obl_open_platform` cannot refuse
       the second because the first is no longer open;
     · `record_billed` REFUSES a line that is not due in the period it is booked
       against, rather than writing a join row for a month the line never
       covered;
     · `/me/lines` names NO AEKAM STAFF USER ID — `created_by` and `ended_by`
       are the console's provenance and the tenant is not the console;
     · `POST /admin/orgs` with a negative `monthly_price` COMMITS NOTHING —
       today the org row, the R2 bucket and the subscription are all committed
       before the amount is ever looked at, and the retry answers 409.

STYLE. Hand-written fakes over SQL substrings, per the house convention. The
fakes enforce what the database enforces — `uq_obl_source_ref` in `_Lines` and
in `_Table096`, `uq_ibl_line_period` in `_Table096`, the attribution join in
`_Ledger` — because a fake that lets a duplicate through would pass a test
Postgres would fail. `_Table096` goes one step further and reads its `$N`
placements OUT OF the statement it is given rather than assuming positions,
because the fixes these tests are waiting for will renumber them, and a fake
that pinned a position would accuse a repaired handler of the bug it had just
had removed.
"""
import inspect
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

import routers.admin_orgs as admin_orgs
import routers.billing as billing
import services.credits as C

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"
AEKAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

SINCE = datetime(2026, 8, 1, tzinfo=timezone.utc)
UNTIL = datetime(2026, 9, 1, tzinfo=timezone.utc)

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "096_billing_lines.sql"


# ════════════════════════════════════════════════════════════════════════════
# 1 & 2. THE PER-SOURCE REPORT
# ════════════════════════════════════════════════════════════════════════════

def _classify(kind, ref_id) -> str:
    """`credits._SOURCE_SQL`, in Python.

    A port, not an opinion: `test_the_python_port_matches_the_sql_arm_for_arm`
    below reads the arms straight out of the SQL and refuses to pass if this
    function and that CASE have drifted, including if an arm is ADDED. Without
    that guard the fake would happily keep classifying the way the report used
    to and the test would go on passing after the query stopped agreeing.
    """
    if kind is None:
        return "unitemised"
    if kind == "content":
        return "srijan"
    if kind == "skill_step":
        return "skills"
    if kind in ("scraper", "scraper_trueup"):
        return "scrapers"
    if kind in ("topup", "period"):
        return "wallet"
    if kind == "channel":
        if ref_id == "whatsapp_send":
            return "whatsapp"
        if (ref_id or "")[:11] == "social_send":
            return "social"
        if ref_id in ("chatbot_message", "chatbot_rerank", "kb_ingest"):
            return "chat"
    return "other"


def _item(kind, ref_id, description) -> str:
    """`credits._ITEM_SQL`. The `kind IS NULL` arm surfaces the free text
    VERBATIM — no `LIKE 'scraper%'`, no `replace(' generation','')` — because a
    guess there moves money between buckets somebody is about to reconcile."""
    if kind is None:
        return (description or "").strip() or "(no description)"
    return ref_id or kind


def _tx(n, *, kind=None, ref_id=None, amount=-10, tx_type=C.TX_DEBIT,
        user_id="user_priya", description="", metered_only=False,
        reverses=None, org_id=ORG, at=None) -> dict:
    return {
        "id": f"tx{n:08d}-0000-0000-0000-000000000000",
        "org_id": org_id,
        "tx_type": tx_type,
        "amount": amount,
        "metered_only": metered_only,
        "kind": kind,
        "ref_id": ref_id,
        "user_id": user_id,
        "description": description,
        "reverses_tx_id": reverses,
        "created_at": at or datetime(2026, 8, 12, tzinfo=timezone.utc),
    }


class _Ledger:
    """A connection that answers `usage_by_source`'s two queries by running them.

    It implements the parts of `_ATTRIBUTED_SQL` that decide where money lands:
    the window, the tx_type filter, and the LEFT JOIN that attributes a REVERSAL
    to the row it reverses. That join is not decoration — a refund carries its
    own kind today only because `refund()` copies it, and the report deliberately
    asks the original instead. A fake that skipped it would let a report that
    trusted the copy pass.
    """

    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.by_id = {r["id"]: r for r in rows}
        self.queries: list[str] = []

    async def fetch(self, q, *args):
        flat = re.sub(r"\s+", " ", q)
        self.queries.append(flat)
        org_id, since, until, tx_types = args

        attributed = []
        for r in self.rows:
            if r["org_id"] != org_id:
                continue
            if since is not None and r["created_at"] < since:
                continue
            if until is not None and r["created_at"] >= until:
                continue
            if r["tx_type"] not in tx_types:
                continue
            # `o.org_id = t.org_id` on the join: a reverses_tx_id pointing at
            # another tenant's row must NOT pull that tenant's kind into this
            # org's bill.
            src = self.by_id.get(r["reverses_tx_id"]) if r["reverses_tx_id"] else None
            if src is not None and src["org_id"] != r["org_id"]:
                src = None
            attributed.append({
                "tx_type": r["tx_type"],
                "amount": r["amount"],
                "metered_only": r["metered_only"],
                "a_kind": (src or r)["kind"],
                "a_ref_id": (src or r)["ref_id"],
                "a_user_id": (src or r)["user_id"],
                "a_description": (src or r)["description"],
            })

        if "WHERE x.a_kind IN ('topup', 'period')" in flat:
            groups: dict[str, dict] = {}
            for x in attributed:
                if x["a_kind"] not in ("topup", "period"):
                    continue
                key = x["a_ref_id"] or x["a_kind"]
                g = groups.setdefault(key, {"item": key, "credits": 0, "tx_count": 0})
                g["credits"] += x["amount"]
                g["tx_count"] += 1
            return list(groups.values())

        groups = {}
        for x in attributed:
            key = (_classify(x["a_kind"], x["a_ref_id"]),
                   _item(x["a_kind"], x["a_ref_id"], x["a_description"]))
            g = groups.setdefault(key, {
                "source": key[0], "item": key[1], "credits": 0, "tx_count": 0,
                "metered_only_credits": 0, "refunded_credits": 0,
            })
            g["credits"] += -x["amount"]
            g["tx_count"] += 1
            if x["metered_only"]:
                g["metered_only_credits"] += -x["amount"]
            if x["tx_type"] != C.TX_DEBIT:
                g["refunded_credits"] += x["amount"]
        return list(groups.values())


def _sources(body: dict) -> dict[str, dict]:
    return {s["source"]: s for s in body["sources"]}


# ── the port is pinned to the query ─────────────────────────────────────────

#: Each arm of `_SOURCE_SQL`, as (predicate text, bucket). The predicates are
#: written exactly as the SQL writes them; `test_..._arm_for_arm` normalises
#: whitespace and requires every one of them AND requires there to be no others.
_SQL_ARMS = (
    ("x.a_kind IS NULL", "unitemised"),
    ("x.a_kind = 'content'", "srijan"),
    ("x.a_kind = 'skill_step'", "skills"),
    ("x.a_kind IN ('scraper', 'scraper_trueup')", "scrapers"),
    ("x.a_kind IN ('topup', 'period')", "wallet"),
    ("x.a_kind = 'channel' AND x.a_ref_id = 'whatsapp_send'", "whatsapp"),
    ("x.a_kind = 'channel' AND left(x.a_ref_id, 11) = 'social_send'", "social"),
    ("x.a_kind = 'channel' AND x.a_ref_id IN "
     "('chatbot_message', 'chatbot_rerank', 'kb_ingest')", "chat"),
)


def test_the_python_port_matches_the_sql_arm_for_arm():
    sql = re.sub(r"\s+", " ", C._SOURCE_SQL).strip()
    found = re.findall(r"WHEN\s+(.*?)\s+THEN\s+'([a-z_]+)'", sql)
    assert [(p.strip(), b) for p, b in found] == list(_SQL_ARMS), (
        "_SOURCE_SQL and this file's _classify have diverged. The fakes below "
        "would go on testing the old taxonomy and pass against a report that no "
        "longer produces it — update _classify and _SQL_ARMS together."
    )
    assert re.search(r"ELSE\s+'other'", sql), (
        "the CASE no longer has an ELSE, so an unknown kind resolves to NULL and "
        "disappears from the report instead of landing in 'other'"
    )
    # Every bucket the SQL can produce must be a tab the router can label and
    # the 404 can name. A bucket outside SOURCE_KEYS is spend nobody can drill
    # into, because `_known_source` refuses the id it would need.
    assert {b for _, b in _SQL_ARMS} | {"other"} == set(C.SOURCE_KEYS)


def test_every_source_key_has_a_label():
    # A missing label degrades to the raw key rather than disappearing — but the
    # raw key on a screen about money is "skill_step", which is not English.
    for key in C.SOURCE_KEYS:
        assert key in billing.SOURCE_LABELS, f"'{key}' has no label"


# ── 1. content and skill_step are different products ────────────────────────

# The collision, exactly: a one-off blog generation and a blog step of a running
# skill both carry ref_id 'blog'. Only `kind` separates them.
BLOG_COLLISION = [
    _tx(1, kind="content", ref_id="blog", amount=-30, user_id="user_priya"),
    _tx(2, kind="skill_step", ref_id="blog", amount=-12, user_id="user_arjun"),
]


async def test_usage_by_source_separates_content_from_skill_step():
    body = await C.usage_by_source(_Ledger(BLOG_COLLISION), ORG, since=SINCE, until=UNTIL)
    srcs = _sources(body)

    assert set(srcs) == {"srijan", "skills"}, (
        "a one-off generation and a skill step landed in the same bucket — the "
        "bill cannot tell two products with different economics apart"
    )
    assert srcs["srijan"]["credits"] == 30
    assert srcs["skills"]["credits"] == 12
    assert body["total_credits"] == 42

    # And the sub-row inside each is still 'blog'. Separating the SOURCES must
    # not rename the item, or the drill-down stops matching the ledger.
    assert [i["ref_id"] for i in srcs["srijan"]["items"]] == ["blog"]
    assert [i["ref_id"] for i in srcs["skills"]["items"]] == ["blog"]


def test_the_shipped_by_kind_report_still_collapses_them_and_that_is_why_this_view_exists():
    """`usage_summary` is DELIBERATELY unchanged — three endpoints and two screens
    render `by_kind` and renaming a bucket under them is a silent break. This
    test states the limitation rather than leaving the next reader to assume the
    old report was fixed too."""
    old = re.sub(r"\s+", " ", C._USAGE_KIND_SQL)
    assert "t.kind IN ('content', 'skill_step', 'channel') THEN COALESCE(t.ref_id, t.kind)" in old, (
        "if the by-kind report has been taught to separate them, this test and "
        "the comment above SOURCE_KEYS are both stale"
    )


async def test_a_refund_lands_on_the_source_of_the_spend_it_reverses():
    # A refund of a skill step must not appear as its own source, and must not
    # be netted against Srijan. The join asks the ORIGINAL, so this holds even
    # for a reversal written by a path that forgot to copy kind/ref_id.
    rows = BLOG_COLLISION + [
        _tx(3, kind=None, ref_id=None, amount=+12, tx_type=C.TX_REFUND, reverses=BLOG_COLLISION[1]["id"]),
    ]
    srcs = _sources(await C.usage_by_source(_Ledger(rows), ORG, since=SINCE, until=UNTIL))
    assert srcs["skills"]["credits"] == 0
    assert srcs["srijan"]["credits"] == 30
    assert "unitemised" not in srcs, (
        "a reversal with no kind of its own was bucketed as a pre-095 row "
        "instead of being attributed to the debit it reverses"
    )


async def test_another_orgs_spend_is_not_in_this_orgs_bill():
    rows = BLOG_COLLISION + [_tx(9, kind="content", ref_id="blog", amount=-999, org_id=OTHER_ORG)]
    body = await C.usage_by_source(_Ledger(rows), ORG, since=SINCE, until=UNTIL)
    assert body["total_credits"] == 42


async def test_a_topup_is_not_reported_as_spend():
    # An org that BOUGHT 500 credits must never be shown as having used them.
    rows = BLOG_COLLISION + [
        _tx(4, kind="topup", ref_id="purchased", amount=+500, tx_type=C.TX_TOPUP),
    ]
    body = await C.usage_by_source(_Ledger(rows), ORG, since=SINCE, until=UNTIL)
    srcs = _sources(body)
    assert body["total_credits"] == 42
    assert srcs["wallet"]["is_usage"] is False
    assert srcs["wallet"]["credits"] == 500   # signed movement, not a magnitude


# ── 2. the rows that predate `kind` ─────────────────────────────────────────

# 171 rows in the live ledger have kind IS NULL. Their only content is free text
# and it is text the reports being replaced used to parse.
PRE_095 = [
    _tx(1, kind=None, amount=-8, description="image generation"),
    _tx(2, kind=None, amount=-3, description="scraper: gstin_lookup"),
    _tx(3, kind="content", ref_id="image", amount=-5),
]


async def test_pre_095_rows_are_their_own_bucket_and_are_not_dropped():
    body = await C.usage_by_source(_Ledger(PRE_095), ORG, since=SINCE, until=UNTIL)
    srcs = _sources(body)

    assert "unitemised" in srcs, "the 171 rows written before migration 095 vanished"
    assert srcs["unitemised"]["credits"] == 11
    assert srcs["unitemised"]["tx_count"] == 2
    # In the total as well as in its own tab: the tabs are the bill, and a bill
    # that quietly omits a bucket is short by exactly that bucket.
    assert body["total_credits"] == 16


async def test_the_pre_095_total_is_also_reported_on_its_own():
    # Carried at the top level so a reader can see how much of the bill is NOT
    # itemised, without having to know that one of the tabs means "unknown".
    body = await C.usage_by_source(_Ledger(PRE_095), ORG, since=SINCE, until=UNTIL)
    assert body["unitemised_credits"] == 11
    assert body["unitemised_tx"] == 2


async def test_a_pre_095_description_is_never_parsed_into_an_itemised_tab():
    # "scraper: gstin_lookup" LOOKS like a scraper row and the old report parsed
    # exactly that prefix. Moving it into the scrapers tab would make the
    # scrapers number disagree with the scraper module's own count, and nobody
    # would be able to say which was right.
    srcs = _sources(await C.usage_by_source(_Ledger(PRE_095), ORG, since=SINCE, until=UNTIL))
    assert "scrapers" not in srcs
    items = {i["ref_id"] for i in srcs["unitemised"]["items"]}
    assert items == {"image generation", "scraper: gstin_lookup"}, (
        "the free text is being rewritten on its way to the screen; it is the "
        "only evidence these rows carry and it is shown verbatim"
    )


async def test_a_pre_095_row_with_no_description_still_appears():
    # An empty description is not a reason to drop a transaction that moved
    # money. It gets a placeholder and stays in the count.
    rows = [_tx(1, kind=None, amount=-4, description="   ")]
    srcs = _sources(await C.usage_by_source(_Ledger(rows), ORG, since=SINCE, until=UNTIL))
    assert srcs["unitemised"]["items"][0]["ref_id"] == "(no description)"
    assert srcs["unitemised"]["credits"] == 4


async def test_an_unknown_kind_lands_in_other_rather_than_disappearing():
    # A kind priced but not yet taught to the taxonomy. Silently dropping it
    # under-bills; 'other' is visible and someone adds the arm.
    rows = [_tx(1, kind="something_new", ref_id="x", amount=-7)]
    srcs = _sources(await C.usage_by_source(_Ledger(rows), ORG, since=SINCE, until=UNTIL))
    assert srcs["other"]["credits"] == 7


async def test_the_tabs_come_back_in_taxonomy_order_not_size_order():
    # Tabs that reorder themselves month to month are tabs an operator has to
    # re-find every time they open the screen.
    rows = [
        _tx(1, kind="skill_step", ref_id="blog", amount=-100),
        _tx(2, kind="content", ref_id="image", amount=-1),
        _tx(3, kind=None, amount=-50, description="legacy"),
    ]
    body = await C.usage_by_source(_Ledger(rows), ORG, since=SINCE, until=UNTIL)
    order = [s["source"] for s in body["sources"]]
    assert order == [k for k in C.SOURCE_KEYS if k in order]
    assert order.index("srijan") < order.index("skills")


# ════════════════════════════════════════════════════════════════════════════
# 3. WHO MAY READ WHOSE BILL
# ════════════════════════════════════════════════════════════════════════════

ORG_ROW = {"id": ORG, "name": "Client Co", "is_platform_org": False}
AEKAM_ROW = {"id": AEKAM, "name": "Aekam Inc", "is_platform_org": True}


@pytest.fixture
def as_org_admin(app, member_user, mock_pool):
    """A member holding `org_admin` in ORG and no platform role at all.

    `as_admin` in conftest answers 'platform_admin' to the platform-role query,
    which is the one thing this test must NOT have — it is the whole difference
    between the two families of routes.
    """
    from auth_router import require_user
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[require_user] = lambda: member_user
    app.dependency_overrides[get_org_id] = lambda: ORG

    async def _fetchval(query, *args):
        if "org_id IS NULL" in query:
            return None                      # no platform role, ever
        if "staging.user_roles" in query and args[1:2] == (ORG,):
            return "org_admin"
        return None

    mock_pool.fetchval.side_effect = _fetchval
    yield member_user
    mock_pool.fetchval.side_effect = None
    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_org_id, None)


async def test_an_org_admin_reads_its_own_bill(api_client, mock_pool, as_org_admin):
    resp = await api_client.get("/api/v1/billing/me/usage/sources")
    assert resp.status_code == 200, resp.text
    assert resp.json()["org_id"] == ORG


@pytest.mark.parametrize("path", [
    "/api/v1/billing/orgs/{other}/usage/sources",
    "/api/v1/billing/orgs/{other}/usage/people",
    "/api/v1/billing/orgs/{other}/usage/sources/srijan/people",
    "/api/v1/billing/orgs/{other}/usage/transactions",
    "/api/v1/billing/orgs/{other}/balance",
])
async def test_an_org_admin_cannot_read_another_orgs_bill(
    api_client, mock_pool, as_org_admin, path,
):
    # Every console route, not a representative one: the guard is per-route and
    # the one that gets forgotten is whichever was added last.
    mock_pool.fetchrow.return_value = dict(ORG_ROW, id=OTHER_ORG, name="Rival Ltd")
    resp = await api_client.get(path.format(other=OTHER_ORG))
    assert resp.status_code == 403, resp.text


async def test_an_org_admin_cannot_read_its_own_bill_through_the_console_route(
    api_client, mock_pool, as_org_admin,
):
    # Not an oversight — the console family is Aekam's, and an org admin
    # reaching it for their OWN org would be one `org_id` edit away from
    # reaching it for somebody else's.
    mock_pool.fetchrow.return_value = dict(ORG_ROW)
    resp = await api_client.get(f"/api/v1/billing/orgs/{ORG}/usage/sources")
    assert resp.status_code == 403, resp.text


async def test_nothing_a_caller_sends_can_point_the_me_routes_at_another_org(
    api_client, mock_pool, as_org_admin,
):
    """The `/me` family takes the org from `get_org_id` and from nowhere else.

    A query parameter or a body field that redirected it would be a tenancy hole
    that no 403 could catch, because the caller is legitimately an admin — of a
    different org.
    """
    resp = await api_client.get(
        f"/api/v1/billing/me/usage/sources?org_id={OTHER_ORG}&period=2026-08"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["org_id"] == ORG


async def test_aekam_reads_any_orgs_bill(api_client, mock_pool, as_admin):
    # `as_admin` answers 'platform_admin' to the platform-role query, which is in
    # FINANCE_CONSOLE_ROLES.
    mock_pool.fetchrow.return_value = dict(ORG_ROW)
    resp = await api_client.get(f"/api/v1/billing/orgs/{ORG}/usage/sources")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["org_id"] == ORG
    assert body["org_name"] == "Client Co"


async def test_aekam_reads_its_own_bill_through_the_same_route(
    api_client, mock_pool, as_admin,
):
    # "Aekam gets the identical view of itself." No third code path: it is
    # /orgs/{aekam_id}/*, and the platform flag is reported rather than hidden —
    # it means the balance check is skipped, not that spend is not metered.
    mock_pool.fetchrow.return_value = dict(AEKAM_ROW)
    resp = await api_client.get(f"/api/v1/billing/orgs/{AEKAM}/usage/sources")
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_platform_org"] is True


async def test_an_org_that_does_not_exist_is_a_404_not_an_empty_bill(
    api_client, mock_pool, as_admin,
):
    # An empty body would read as "this org spent nothing", which is a claim.
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(f"/api/v1/billing/orgs/{OTHER_ORG}/usage/sources")
    assert resp.status_code == 404, resp.text


async def test_a_malformed_org_id_is_a_404_not_a_500(api_client, mock_pool, as_admin):
    # `$1::uuid` on a mistyped id raises a DataError, which reaches the client as
    # a 500 and tells an operator the server is broken when they have fat-fingered
    # an id.
    resp = await api_client.get("/api/v1/billing/orgs/not-a-uuid/usage/sources")
    assert resp.status_code == 404, resp.text


async def test_an_unknown_source_is_a_404_that_names_the_ones_that_exist(
    api_client, mock_pool, as_org_admin,
):
    # A silent empty result would read as "this org spent nothing on that",
    # which is a different and much more expensive claim than "no such tab".
    resp = await api_client.get("/api/v1/billing/me/usage/sources/srijaan/people")
    assert resp.status_code == 404, resp.text
    assert "srijaan" in str(resp.json()["detail"])


async def test_a_period_that_is_not_a_calendar_month_is_refused(
    api_client, mock_pool, as_org_admin,
):
    # A billing period is a calendar month because the allowance resets on the
    # 1st. A rolling window would report spend from two allowances as one.
    resp = await api_client.get("/api/v1/billing/me/usage/sources?period=last-30-days")
    assert resp.status_code == 400, resp.text


# ════════════════════════════════════════════════════════════════════════════
# 4. THE TOP-UP TICK
# ════════════════════════════════════════════════════════════════════════════

TOPUP_URL = f"/api/v1/admin/orgs/{ORG}/credits/topup"
IDEM = "7f0d4a26-0b1e-4f3a-9c55-2b6d9e0a1c34"


class _Lines:
    """`services/billing_lines.py`, reduced to the one promise this handler needs.

    It enforces `uq_obl_source_ref` — the UNIQUE index on `source_ref` that
    migration 096 creates — because that index, and not any code path, is what
    makes "add to invoice" safe to retry. A fake without it would let a second
    line through and the test would pass against a database that would not.
    """

    def __init__(self):
        self.rows: list[dict] = []
        self.conns: list = []

    async def create_line(self, conn, **kw):
        self.conns.append(conn)
        ref = kw.get("source_ref")
        if ref is not None:
            for existing in self.rows:
                if existing["source_ref"] == ref:
                    # What the real one does: yield the row that already exists
                    # rather than raising, so a retry is a no-op and not a 500.
                    return existing
        row = {"id": f"line{len(self.rows) + 1}", **kw}
        self.rows.append(row)
        return row

    async def sync_platform_line(self, conn, **kw):
        return None


@pytest.fixture
def topup(monkeypatch, mock_pool, app, admin_user):
    """The top-up handler with its two collaborators replaced.

    `grant` is stubbed rather than run: `services/credits.py` is proved by
    tests/test_credit_model.py and what is under test here is the HANDLER's
    promise — one line, in the grant's transaction, none on a retry.
    """
    lines = _Lines()
    monkeypatch.setattr(admin_orgs, "_billing_lines", lambda: lines)

    granted: list[dict] = []

    async def _grant(conn, **kw):
        granted.append({"conn": conn, **kw})
        return C.Balance(
            org_id=ORG, allowance=0, purchased=100 * len(granted), total=100 * len(granted),
            period_start=date(2026, 8, 1), is_platform_org=False, monthly_credits=0,
        )

    monkeypatch.setattr(admin_orgs, "grant", _grant)
    return lines, granted


async def test_ticking_add_to_invoice_creates_exactly_one_line(
    api_client, mock_pool, as_admin, topup,
):
    lines, granted = topup
    resp = await api_client.post(TOPUP_URL, json={
        "amount": 100, "add_to_invoice": True, "idempotency_key": IDEM,
        "invoice_description": "Credit top-up — 100 credits",
    })
    assert resp.status_code == 200, resp.text

    assert len(lines.rows) == 1, f"expected one billing line, got {len(lines.rows)}"
    line = lines.rows[0]
    assert line["kind"] == "topup"
    assert line["cadence"] == "one_off"
    assert line["org_id"] == ORG
    # Rupees, not credits, and priced from services/credits.py — the console does
    # not get to hold its own opinion of what a credit sells for.
    assert line["amount"] == 100 * C.CREDIT_PRICE_INR
    assert resp.json()["invoice_amount_inr"] == 100 * C.CREDIT_PRICE_INR
    assert resp.json()["invoiced"] is True


async def test_the_line_is_written_in_the_grants_transaction(
    api_client, mock_pool, as_admin, topup,
):
    """Not "both happened" — the SAME connection, inside one transaction.

    Two transactions can leave "credits added but never billed" or "billed for
    credits nobody received", and each is a state somebody has to find by hand.
    """
    lines, granted = topup
    await api_client.post(TOPUP_URL, json={
        "amount": 100, "add_to_invoice": True, "idempotency_key": IDEM,
    })
    assert len(granted) == 1 and len(lines.conns) == 1
    assert lines.conns[0] is granted[0]["conn"], (
        "the billing line is written on a different connection from the grant, "
        "so the two can commit independently"
    )


async def test_not_ticking_it_creates_no_line(api_client, mock_pool, as_admin, topup):
    # Off by default is the requirement. A line created by omission is a charge
    # the operator never agreed to.
    lines, granted = topup
    resp = await api_client.post(TOPUP_URL, json={"amount": 100})
    assert resp.status_code == 200, resp.text
    assert lines.rows == []
    assert resp.json()["invoiced"] is False
    assert resp.json()["invoice_amount_inr"] is None
    assert len(granted) == 1, "the credits must still be granted"


async def test_a_second_identical_topup_does_not_create_a_second_line(
    api_client, mock_pool, as_admin, topup,
):
    """The double-click. The ledger refuses the second grant on the idempotency
    key; the line is refused by `uq_obl_source_ref` on the same key. Without the
    second half, one click grants once and bills twice."""
    lines, granted = topup
    payload = {
        "amount": 100, "add_to_invoice": True, "idempotency_key": IDEM,
        "invoice_description": "Credit top-up — 100 credits",
    }
    first = await api_client.post(TOPUP_URL, json=payload)
    second = await api_client.post(TOPUP_URL, json=payload)

    assert first.status_code == 200 and second.status_code == 200, second.text
    assert len(lines.rows) == 1, (
        f"a retried top-up created {len(lines.rows)} billing lines; the client "
        f"is charged twice for credits granted once"
    )
    # And the retry returns the SAME line rather than a silent null, so the
    # dialog can say what happened.
    assert second.json()["invoice_line"]["id"] == first.json()["invoice_line"]["id"]


async def test_the_line_is_identified_by_the_key_that_survives_a_retry(
    api_client, mock_pool, as_admin, topup,
):
    # `grant()` returns a Balance, not a receipt, and a REPLAYED grant writes no
    # new row to have an id at all. The idempotency key is the only identifier
    # that is the same on both attempts, which is exactly the property
    # uq_obl_source_ref is being asked to enforce.
    lines, _ = topup
    await api_client.post(TOPUP_URL, json={
        "amount": 100, "add_to_invoice": True, "idempotency_key": IDEM,
    })
    assert lines.rows[0]["source_ref"] == f"credit_tx:{IDEM}"


async def test_ticking_it_without_an_idempotency_key_is_refused_not_invented(
    api_client, mock_pool, as_admin, topup,
):
    # Inventing a key from a timestamp would be decoration: two clicks a second
    # apart would carry different keys and bill twice. The refusal names what is
    # needed, per the money-code rule.
    lines, granted = topup
    resp = await api_client.post(TOPUP_URL, json={"amount": 100, "add_to_invoice": True})
    assert resp.status_code == 400, resp.text
    assert "idempotency_key" in resp.json()["detail"]
    assert lines.rows == []
    assert granted == [], "the grant ran before the refusal, so a refused top-up still moved credits"


@pytest.mark.parametrize("amount", [0, -5, "abc", None])
async def test_a_top_up_that_is_not_a_positive_integer_moves_nothing(
    api_client, mock_pool, as_admin, topup, amount,
):
    lines, granted = topup
    resp = await api_client.post(TOPUP_URL, json={
        "amount": amount, "add_to_invoice": True, "idempotency_key": IDEM,
    })
    assert resp.status_code == 400, resp.text
    assert lines.rows == [] and granted == []


async def test_a_topup_line_carries_the_operator_and_a_readable_description(
    api_client, mock_pool, as_admin, topup, admin_user,
):
    # The description is what the client reads on the invoice beside the amount,
    # and `created_by` is who to ask about it.
    lines, _ = topup
    await api_client.post(TOPUP_URL, json={
        "amount": 250, "add_to_invoice": True, "idempotency_key": IDEM,
    })
    line = lines.rows[0]
    assert line["created_by"] == admin_user["user_id"]
    assert "250" in line["description"]


def _body(fn) -> str:
    """Source with the docstring removed, per tests/test_prachar_audience.py.

    The handler's docstring EXPLAINS why `grant_standalone` is not used, so a
    naive substring search over the raw source asserts against the prose that
    documents the decision — it failed exactly that way on the first run.
    """
    src = inspect.getsource(fn)
    if inspect.getdoc(fn):
        for quote in ('"""', "'''"):
            start = src.find(quote)
            if start != -1:
                end = src.find(quote, start + 3)
                if end != -1:
                    return src[:start] + src[end + 3:]
    return src


def test_the_handler_owns_the_transaction_rather_than_calling_grant_standalone():
    """`credits.grant_standalone` opens and closes its own transaction. Using it
    here would put the grant and the line in two, which is the one thing the tick
    exists to prevent — so the choice is pinned rather than left to a later
    tidy-up that looks like a simplification."""
    src = _body(admin_orgs.admin_topup_credits)
    assert "grant_standalone" not in src
    assert "async with conn.transaction():" in src


# ════════════════════════════════════════════════════════════════════════════
# 5. THE SCHEMA CHECK
#
# In the style of tests/test_prachar_audience.py. The recurring shape of failure
# in this repo is Python naming a column, a table or a module that does not
# exist, surfacing as an opaque 500 long after the deploy — and on this path the
# 500 lands on a router that has just granted credits.
# ════════════════════════════════════════════════════════════════════════════

def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


#: Every column `staging.org_billing_lines` must carry for the requirement to be
#: expressible: the five line kinds, the repeating {enabled, description, amount}
#: shape (a line that exists IS enabled; ending it is `period_end`), the period a
#: line is due in, and the provenance a top-up line is retried against.
ORG_BILLING_LINE_COLUMNS = (
    "id", "org_id", "kind", "description", "amount", "currency", "cadence",
    "period_start", "period_end", "source_ref", "created_by", "ended_by",
    "created_at", "updated_at",
)

INVOICE_BILLING_LINE_COLUMNS = (
    "invoice_id", "line_id", "period_start", "amount", "created_at",
)


def test_the_migration_exists_and_is_readable():
    assert MIGRATION.exists(), f"{MIGRATION.name} is missing"
    assert "CREATE TABLE IF NOT EXISTS staging.org_billing_lines" in _sql()
    assert "CREATE TABLE IF NOT EXISTS staging.invoice_billing_lines" in _sql()


@pytest.mark.parametrize("column", ORG_BILLING_LINE_COLUMNS)
def test_org_billing_lines_declares_every_column_the_feature_names(column):
    body = _sql().split("CREATE TABLE IF NOT EXISTS staging.org_billing_lines")[1]
    body = body.split("CREATE INDEX")[0]
    assert re.search(rf"^\s*{column}\s", body, re.M), (
        f"staging.org_billing_lines has no `{column}` column"
    )


@pytest.mark.parametrize("column", INVOICE_BILLING_LINE_COLUMNS)
def test_invoice_billing_lines_declares_every_column_the_feature_names(column):
    body = _sql().split("CREATE TABLE IF NOT EXISTS staging.invoice_billing_lines")[1]
    body = body.split("CREATE UNIQUE INDEX")[0]
    assert re.search(rf"^\s*{column}\s", body, re.M), (
        f"staging.invoice_billing_lines has no `{column}` column"
    )


def test_the_five_billing_lines_the_owner_named_are_all_legal_kinds():
    # 1 platform, 2 support, 3 setup, 5 ongoing, 4 top-up. Anything outside the
    # CHECK cannot be written, so a kind the product means to offer and the
    # constraint does not accept is a feature that 500s on save.
    m = re.search(r"kind\s+TEXT NOT NULL\s+CHECK \(kind IN \(([^)]*)\)\)", _sql())
    assert m, "org_billing_lines.kind has no CHECK constraint"
    assert set(re.findall(r"'([a-z_]+)'", m.group(1))) == {
        "platform", "support", "setup", "ongoing", "topup",
    }


@pytest.mark.parametrize("name,why", [
    ("uq_obl_open_platform",
     "two open platform lines would put the platform fee on the invoice twice"),
    ("uq_obl_source_ref",
     "a retried top-up would create a second billing line"),
    ("uq_ibl_line_period",
     "the same line could be billed twice for the same month"),
])
def test_the_three_indexes_that_stop_a_double_charge_exist(name, why):
    assert f"CREATE UNIQUE INDEX IF NOT EXISTS {name}" in _sql(), why


def test_the_topup_constraint_requires_the_provenance_the_retry_depends_on():
    # `source_ref` is what `uq_obl_source_ref` is unique on. A topup line without
    # one is a line no retry can be matched against.
    assert "kind <> 'topup' OR (cadence = 'one_off' AND source_ref IS NOT NULL)" in _sql()


def test_a_one_off_is_due_in_exactly_one_period():
    # Leaving period_end NULL on a one-off would bill a setup fee every month
    # forever, which is the failure that costs a client relationship.
    assert "(cadence = 'one_off' AND period_end = period_start)" in _sql()


def test_the_invoice_can_be_raised_standalone_and_carries_upi():
    # Kartavaya's clients agree terms verbally. An invoice must be creatable
    # without an order, and 'manual' has to stay legal — every invoice raised
    # before this migration was one. There is no payment gateway: the UPI
    # columns are the entire collection mechanism.
    sql = _sql()
    assert "generated_from TEXT NOT NULL DEFAULT 'manual'" in sql
    assert "CHECK (generated_from IN ('manual','lines'))" in sql
    for col in ("upi_vpa", "upi_payee_name"):
        assert f"ADD COLUMN IF NOT EXISTS {col}" in sql


def test_the_migration_is_additive_only():
    # ONE `staging` schema, and production writes to it. A DROP or a type change
    # in this file is a production outage, not a migration.
    sql = re.sub(r"--[^\n]*", "", _sql())          # comments discuss DROP at length
    for forbidden in (r"\bDROP\s+TABLE\b", r"\bDROP\s+COLUMN\b",
                      r"\bALTER\s+COLUMN\b", r"\bTRUNCATE\b", r"\bDELETE\s+FROM\b"):
        assert not re.search(forbidden, sql, re.I), (
            f"096 contains {forbidden}; this file must be additive and replayable"
        )


def test_the_platform_line_backfill_cannot_double_up_on_a_replay():
    # The bare ON CONFLICT DO NOTHING only sees OPEN lines. An org with an ENDED
    # platform line and no open one would acquire a second fee for this month
    # from a file that is supposed to be replayable.
    sql = re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", _sql()))
    assert re.search(
        r"NOT EXISTS \( SELECT 1 FROM staging\.org_billing_lines l "
        r"WHERE l\.org_id = o\.id AND l\.kind = 'platform' \)", sql,
    ), (
        "the backfill guard no longer covers ENDED platform lines — a replay "
        "against an org that has one but no open one inserts a second fee"
    )
    # The last line of defence, kept as well as the guard, never instead of it.
    assert "ON CONFLICT DO NOTHING;" in sql


def test_the_drift_view_exists_because_monthly_price_still_has_a_second_writer():
    # Any row it returns is a bug: monthly_price was written without the line, or
    # the line without the mirror. It is the query to run after this deploy.
    assert "CREATE OR REPLACE VIEW staging.v_org_platform_line_drift" in _sql()


def test_the_social_platforms_are_priced_so_per_source_can_mean_per_platform():
    # FB, IG, Threads, YouTube, TikTok, LinkedIn and X all write
    # ref_id='social_send' today, so the `social` tab is one row. `price_of`
    # resolves by EXACT ref_id and raises rather than guessing, so the ids
    # cannot be split until these rows exist.
    sql = _sql()
    for platform in ("facebook", "instagram", "threads", "youtube",
                     "tiktok", "linkedin", "x"):
        assert f"'social_send:{platform}'" in sql, f"{platform} has no price row"
    # Every one at zero. A price change and a plumbing change must never ship
    # together, or nobody can say which moved the bill.
    seeded = re.search(r"INSERT INTO staging\.credit_prices.*?;", sql, re.S).group(0)
    assert not re.search(r"'social_send:[a-z]+',\s*(?!0\b)\d+", seeded), (
        "096 is moving a price as well as splitting a ref_id"
    )


def test_the_source_case_already_understands_the_split_ref_ids():
    # The migration seeds `social_send:<platform>`; the report has to bucket them
    # as `social` rather than dropping them into `other` on the day the publisher
    # starts writing them.
    assert _classify("channel", "social_send:linkedin") == "social"
    assert _classify("channel", "social_send") == "social"
    # `left(ref, 11)` rather than LIKE, because `_` is a LIKE wildcard and
    # 'socialXsend' would match the pattern.
    assert "left(x.a_ref_id, 11)" in C._SOURCE_SQL
    assert "LIKE 'social_send" not in C._SOURCE_SQL


# ── the names, not just the columns ─────────────────────────────────────────

def test_the_billing_router_exists_and_is_mounted():
    """The router is new in this batch. A router that exists and is never
    included serves 404s that look exactly like a wrong URL in the frontend.

    Read off the OpenAPI schema rather than `app.routes`: this FastAPI keeps an
    `_IncludedRouter` wrapper per `include_router` call instead of flattening the
    routes onto the app, so a membership test against `app.routes` is vacuously
    false for every router in the product.
    """
    import server
    assert billing.router.prefix == "/api/v1/billing"
    paths = set(server.app.openapi()["paths"])
    for path in ("/api/v1/billing/me/usage/sources",
                 "/api/v1/billing/me/usage/people",
                 "/api/v1/billing/me/usage/sources/{source}/people",
                 "/api/v1/billing/me/usage/transactions",
                 "/api/v1/billing/me/balance",
                 "/api/v1/billing/me/members/{target_user_id}/cap",
                 "/api/v1/billing/orgs/{org_id}/usage/sources",
                 "/api/v1/billing/orgs/{org_id}/usage/people",
                 "/api/v1/billing/orgs/{org_id}/usage/transactions",
                 "/api/v1/billing/orgs/{org_id}/balance",
                 # The billing-LINES half of the same router. It shipped in the
                 # same file as the ten above and this list did not name any of
                 # it, so every route that says what an org is CHARGED — as
                 # opposed to what it has SPENT — was mounted on nobody's word.
                 # `BillingLinesBlock.jsx` and `InvoiceBuilder.jsx` call four of
                 # them and `BillingUsageSection.jsx` calls the first.
                 "/api/v1/billing/me/lines",
                 "/api/v1/billing/orgs/{org_id}/lines",
                 "/api/v1/billing/orgs/{org_id}/lines/{line_id}",
                 "/api/v1/billing/orgs/{org_id}/lines/{line_id}/end",
                 "/api/v1/billing/orgs/{org_id}/invoice-preview"):
        assert path in paths, f"{path} is not mounted on the app"


def test_the_module_the_topup_handler_imports_at_call_time_exists():
    """`admin_orgs._billing_lines()` imports `services.billing_lines` INSIDE the
    call, so a missing module passes every import check in this repo — including
    the one this batch's brief specifies — and fails for the first time in
    production, on the one request that was also supposed to bill for the
    credits it just granted.

    A lazy import is exactly the kind of dependency a test has to name out loud.

    THE `xfail` MARKER THAT STOOD HERE IS GONE, on its own instruction: it said
    to delete it the moment the module existed, and it xpassed. It was
    `strict=False`, so leaving it meant this test could go back to FAILING
    without anything turning red — a guard that reports neither state is not a
    guard.

    What it asserts is widened at the same time, because the marker's departure
    is the point at which "does it import" stops being the whole question.
    `_billing_lines()`'s own docstring names the two functions the console calls,
    and both call sites reach them inside a transaction that has already written
    something — the org row and the R2 bucket in `create_org`, the credits
    themselves in the top-up. A module that imports and lacks either name fails
    in exactly the place, and with exactly the consequences, the missing module
    did; an AttributeError there is not a smaller fault than an ImportError.
    """
    from services import billing_lines

    for name in ("sync_platform_line", "create_line"):
        assert callable(getattr(billing_lines, name, None)), (
            f"services.billing_lines has no `{name}`. "
            f"`admin_orgs._billing_lines()` documents it as the surface this "
            f"console calls and calls it inside a transaction that has already "
            f"committed — so a missing name is a 500 after the money moved, "
            f"which is the failure the lazy import made invisible."
        )


def test_the_topup_handler_asks_that_module_for_the_line_rather_than_writing_it():
    # One writer for the table that says what an org is charged, the same rule
    # services/credits.py holds for the four credit tables. Five debit
    # implementations disagreeing is how that rule was learned.
    src = inspect.getsource(admin_orgs.admin_topup_credits)
    assert "_billing_lines().create_line(" in src
    assert "org_billing_lines" not in src, (
        "the console is writing the billing-lines table directly"
    )


def test_no_router_names_a_credit_table():
    # `services/credits.py` is the only module permitted to name them; the check
    # that enforces it is a grep, so a docstring quoting one breaks the rule too.
    for module in (billing, admin_orgs):
        src = inspect.getsource(module)
        for table in ("hub_org_credits", "org_member_credits",
                      "hub_org_credit_transactions", "credit_prices"):
            assert f"staging.{table}" not in src, (
                f"{module.__name__} names staging.{table}; every credit number "
                f"must come through services.credits"
            )


def test_no_router_WRITES_the_billing_lines_tables():
    """The same rule for the two tables 096 creates, checked as a WRITE.

    Not as a mention: `routers/billing.py` legitimately quotes
    `staging.org_billing_lines` in a docstring — it is explaining the 503 it
    turns "relation does not exist" into — and its own read route is NAMED
    `org_billing_lines`. A grep for the bare name would fail on a file that
    obeys the rule perfectly, and a check that fails on correct code gets
    deleted rather than fixed.

    What the rule actually forbids is a SECOND WRITER. `services/billing_lines.py`
    is the only module allowed to INSERT, UPDATE or DELETE either table, for the
    reason credits learned expensively: five debit implementations that disagreed
    about the wallet. The no-double-charge invariant lives in `record_billed` and
    in `uq_ibl_line_period`, and a router that wrote the join table itself would
    be outside both.
    """
    routers_dir = Path(__file__).resolve().parents[1] / "routers"
    tables = ("org_billing_lines", "invoice_billing_lines")
    for path in sorted(routers_dir.glob("*.py")):
        # utf-8-sig: routers/reports.py carries a BOM, and reading it as plain
        # utf-8 hands a U+FEFF to whatever parses it next.
        src = path.read_text(encoding="utf-8-sig")
        # Comments and docstrings discuss both tables at length and are not
        # writes. Only a statement is.
        for table in tables:
            for verb in ("INSERT INTO", "UPDATE", "DELETE FROM"):
                assert not re.search(
                    rf"{verb}\s+staging\.{table}\b", src,
                ), (
                    f"routers/{path.name} runs {verb} against staging.{table}. "
                    f"services/billing_lines.py is the only writer of both — a "
                    f"second one is how the no-double-charge rule stops holding."
                )


# ════════════════════════════════════════════════════════════════════════════
# 6. THE SEAMS THREE REVIEWS FOUND AND THIS FILE DID NOT
#
# Everything above this banner passed while all four of the defects below were
# live. Each one is written here as the sentence a client would say — billed
# twice, billed for a month that was not theirs, shown Aekam's staff list, or
# handed an organisation that half exists — and each is proved through the REAL
# service or the REAL handler rather than through a stub that agrees with it.
# ════════════════════════════════════════════════════════════════════════════

def _BL():
    """`services/billing_lines.py`, imported when a test needs it.

    NOT at module scope, and the reason is a test in section 5 of this very
    file: `test_the_module_the_topup_handler_imports_at_call_time_exists` is the
    one that DIAGNOSES the module being absent. An `import services.billing_lines`
    at the top of this file would turn that diagnosis into a collection error —
    the whole file would fail to load and the output would be a traceback
    instead of the sentence that says an org creation is about to 500.

    A test that reports a missing module must not need that module in order to
    speak.
    """
    import services.billing_lines as BL
    return BL


#: Absolute months, never `current_period()`. A test whose subject is WHICH
#: PERIOD a line is billed in must not take its periods from the same clock the
#: code under test uses, or it agrees with the bug on the 1st of the month.
JULY = date(2026, 7, 1)
AUGUST = date(2026, 8, 1)

#: Aekam's own people. `created_by` and `ended_by` hold ids of this shape —
#: `public.users.user_id` is TEXT, which is the whole argument in 096's section 1.
AEKAM_OPS = "user_aekam_ops"
AEKAM_FINANCE = "user_aekam_finance"


def _covering(lines, row, period):
    """`billing_lines._covering_line`, in Python: the EARLIER line of the same
    kind that already carries this month, or None.

    A monthly line whose span reaches the period is not billed if an older one
    of its kind is standing in the same month. That is the rule that makes a fee
    stopped and restarted in one month ONE charge instead of two, and the
    ordering is a full tuple — `(period_start, created_at, id)` — because two
    lines that tie on both dates would each fail to be earlier than the other
    and BOTH would be due.
    """
    def _covers(e):
        return (e["cadence"] == "monthly"
                and e["period_start"] <= period
                and (e["period_end"] is None or e["period_end"] >= period))

    def _key(e):
        return (e["period_start"], e["created_at"], str(e["id"]))

    earlier = [e for e in lines
               if str(e["org_id"]) == str(row["org_id"])
               and e["kind"] == row["kind"]
               and _covers(e) and _key(e) < _key(row)]
    return min(earlier, key=_key) if earlier else None


def _due(lines, row, period) -> bool:
    """`billing_lines._DUE_IN_PERIOD`, in Python.

    A port, not an opinion: `test_the_due_port_is_the_predicate_the_invoice_bills_from`
    pins the four things it ports against the SQL and fails if they drift, in
    the same way `_classify` is pinned to `_SOURCE_SQL` at the top of this file.
    Without the pin, `_Table096` would go on answering "due" the way the
    predicate used to and every test below it would pass against a query that no
    longer agrees.

    TAKES THE WHOLE TABLE because the predicate is not a property of one row:
    the suppression looks sideways at every other line of the same kind. A port
    with a row-only signature could not express it, and a fake that could not
    express it would report a system that cannot double-charge while the
    database happily did.
    """
    if row["cadence"] == "monthly":
        return (row["period_start"] <= period
                and (row["period_end"] is None or row["period_end"] >= period)
                and _covering(lines, row, period) is None)
    return row["cadence"] == "one_off" and row["period_start"] == period


def test_the_due_port_is_the_predicate_the_invoice_bills_from():
    """Four claims `_due` and `_covering` make about the SQL, each checked.

    NOT an exact-text pin. The predicate is now built by two functions that take
    a placeholder — `record_billed` numbers its parameters differently and that
    is the whole reason it went without one — so pinning the rendered string
    would fail on a rename and say nothing about meaning. These four are the
    things the port would be WRONG about, and each is a way an invoice could
    quietly change.
    """
    BL = _BL()
    due = re.sub(r"\s+", " ", BL._due_in_period())
    cover = re.sub(r"\s+", " ", BL._covering_line())

    # 1. A monthly line is due from its start until its end INCLUSIVE. The
    #    inclusive upper bound is the confirm dialog's promise — "billed through
    #    August and not after" — and it is why an ended line and its replacement
    #    can collide in one month at all.
    assert "l.period_start <= $2::date" in due
    assert "(l.period_end IS NULL OR l.period_end >= $2::date)" in due

    # 2. A one-off is due in its own period and no other, and is never
    #    suppressed: two setup fees in one month are two integrations.
    assert "(l.cadence = 'one_off' AND l.period_start = $2::date)" in due

    # 3. The monthly arm — and only it — is suppressed by an earlier line of the
    #    SAME KIND that already covers the month.
    assert "NOT EXISTS" in due, (
        "the due predicate no longer suppresses a monthly line that an earlier "
        "line of its kind already covers. A fee stopped and restarted in one "
        "month is back to being two charges on one invoice — read "
        "`test_a_line_ended_and_reopened_in_one_month_is_billed_once`."
    )
    assert "e.kind = l.kind" in cover and "e.cadence = 'monthly'" in cover

    # 4. Earlier is a TOTAL order over (period_start, created_at, id). A partial
    #    one lets two rows that tie on both dates each fail to be earlier than
    #    the other, and both are then due — the double charge, restored by a
    #    tie-break that looked like tidiness.
    assert ("(e.period_start, e.created_at, e.id) < "
            "(l.period_start, l.created_at, l.id)") in cover, (
        "`_covering_line` no longer orders on the full tuple; `_covering` in "
        "this file does, and the two must agree about which of two lines opened "
        "in the same month is the earlier one"
    )


# ── the two tables, in memory, as 096 declares them ─────────────────────────

class _Unique(Exception):
    """A 23505. `billing_lines._is_unique_violation` matches on `sqlstate` and
    not on the class, precisely so a double like this behaves the way asyncpg
    does."""

    def __init__(self, constraint: str):
        super().__init__(f'duplicate key value violates unique constraint "{constraint}"')
        self.sqlstate = "23505"
        self.constraint_name = constraint


class _Txn:
    """`conn.transaction()` — the SAVEPOINT `_insert_line` opens so that a unique
    violation is recoverable rather than fatal to the caller's transaction."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def _param(sql: str, pattern: str, args: tuple):
    """The argument a `$N` in the statement refers to, read OUT OF the statement.

    Positions are not assumed anywhere in this fake, and that is deliberate. The
    repair these tests are waiting for adds a predicate to `record_billed`'s
    INSERT, and `_DUE_IN_PERIOD` is written against `$2` while that statement
    already uses `$2` for the id array — so the fix must renumber. A fake that
    had pinned "the period is args[2]" would then hand the period an array of
    uuids and report a failure against a handler that had just been fixed.
    """
    m = re.search(pattern, sql)
    if not m:
        return None
    idx = int(m.group(1)) - 1
    return args[idx] if 0 <= idx < len(args) else None


_P_ORG = r"\borg_id\s*=\s*\$(\d+)"
_P_IDS = r"\bl\.id\s*=\s*ANY\(\$(\d+)"
_P_BILLED_IDS = r"\bb\.line_id\s*=\s*ANY\(\$(\d+)"
_P_DATE = r"\$(\d+)::date"
_P_LIMIT = r"\bLIMIT\s+\$(\d+)"
#: `unnest($2::uuid[], $5::numeric[]) AS v(line_id, amount)` — the ids and the
#: per-line amounts the invoice actually charged, as positional halves of one
#: list. The ids arrive this way on the INSERT and as `ANY($N)` everywhere else.
_P_UNNEST = r"unnest\(\$(\d+)::uuid\[\],\s*\$(\d+)::numeric\[\]\)"


class _Table096:
    """`staging.org_billing_lines` and `staging.invoice_billing_lines`.

    The constraints modelled here are the ones 096 actually creates, and NOTHING
    ELSE — that restraint is the point of the first test below. There is no
    index that refuses a line reopened in the month its predecessor ended, so
    this fake must not refuse one either; if it did, it would report a system
    that cannot double-charge while the database happily does.

      uq_obl_open_platform  at most ONE open `platform` line per org
      uq_obl_source_ref     at most one line per `source_ref`, GLOBALLY
      uq_ibl_line_period    at most one (line, period) in invoice_billing_lines

    Every statement it does not model raises rather than returning None, because
    a fake that quietly answers "no rows" to a query it did not understand is a
    fake that passes tests by not running the code.
    """

    def __init__(self, org_ids=(ORG,)):
        self.orgs = {str(o) for o in org_ids}
        self.lines: list[dict] = []
        self.billed: list[dict] = []
        self.invoices: dict[str, str] = {}

    # ── the connection interface the service uses ───────────────────────────

    def transaction(self):
        return _Txn()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def fetchval(self, sql, *args):
        if "FROM staging.organisations" in sql:
            return args[0] if str(args[0]) in self.orgs else None
        raise AssertionError(f"_Table096 does not model: {sql}")

    async def fetchrow(self, sql, *args):
        flat = re.sub(r"\s+", " ", sql)
        if "INSERT INTO staging.org_billing_lines" in flat:
            return self._insert(*args)
        if "UPDATE staging.org_billing_lines" in flat and "SET period_end=" in flat:
            return self._end(args[2], args[0], args[1])
        if "UPDATE staging.org_billing_lines" in flat and "SET amount=" in flat:
            return self._amend(args[1], args[0])
        if "AS monthly_total" in flat:
            return self._totals(flat, args)
        if "WHERE source_ref=$1" in flat:
            return next((r for r in self.lines if r["source_ref"] == args[0]), None)
        if "WHERE id=$1::uuid AND org_id=$2::uuid" in flat:
            return next((r for r in self.lines
                         if str(r["id"]) == str(args[0])
                         and str(r["org_id"]) == str(args[1])), None)
        if "AND kind=$2" in flat:
            return self._open_line(args[0], args[1])
        raise AssertionError(f"_Table096 does not model: {flat}")

    async def fetch(self, sql, *args):
        flat = re.sub(r"\s+", " ", sql)
        if "INSERT INTO staging.invoice_billing_lines" in flat:
            return self._record(flat, args)
        # Dispatched on the FIRST table in the statement, not on any mention of
        # one: `_NOT_YET_BILLED` puts `FROM staging.invoice_billing_lines b`
        # inside a NOT EXISTS on the due query, and `_covering_line` puts
        # `FROM staging.org_billing_lines e` inside another — so a substring
        # test routes the invoice query to the clash handler and every test
        # below it goes green for the wrong reason.
        first = re.search(r"\bFROM\s+staging\.(\w+)", flat)
        first = first.group(1) if first else ""
        if first == "invoice_billing_lines":
            return self._clash(flat, args)
        if "JOIN LATERAL" in flat:
            return self._with_covering(flat, args)
        if "JOIN staging.invoice_billing_lines" in flat:
            return self._already_billed(flat, args)
        if first == "org_billing_lines":
            return self._select_lines(flat, args)
        raise AssertionError(f"_Table096 does not model: {flat}")

    async def execute(self, sql, *args):
        raise AssertionError(f"_Table096 does not model: {sql}")

    # ── org_billing_lines ───────────────────────────────────────────────────

    def add(self, **cols) -> dict:
        """Seed a row without going through the service — for the reads."""
        return self._insert(
            cols.get("org_id", ORG), cols["kind"], cols["description"],
            cols["amount"], cols.get("currency", "INR"), cols["cadence"],
            cols["period_start"], cols.get("period_end"),
            cols.get("source_ref"), cols.get("created_by"),
            ended_by=cols.get("ended_by"),
        )

    def _insert(self, org_id, kind, description, amount, currency, cadence,
                period_start, period_end, source_ref, created_by, ended_by=None):
        if source_ref is not None and any(r["source_ref"] == source_ref
                                          for r in self.lines):
            raise _Unique("uq_obl_source_ref")
        if kind == "platform" and period_end is None and any(
            r["org_id"] == org_id and r["kind"] == "platform"
            and r["period_end"] is None for r in self.lines
        ):
            raise _Unique("uq_obl_open_platform")
        now = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
        row = {
            "id": str(uuid.uuid4()), "org_id": str(org_id), "kind": kind,
            "description": description, "amount": amount, "currency": currency,
            "cadence": cadence, "period_start": period_start,
            "period_end": period_end, "source_ref": source_ref,
            "created_by": created_by, "ended_by": ended_by,
            # Distinct per row so ORDER BY created_at is a real order rather
            # than a tie the fake breaks by insertion luck.
            "created_at": now.replace(second=len(self.lines)),
            "updated_at": now.replace(second=len(self.lines)),
        }
        self.lines.append(row)
        return row

    def _open_line(self, org_id, kind):
        rows = [r for r in self.lines
                if str(r["org_id"]) == str(org_id) and r["kind"] == kind
                and r["cadence"] == "monthly" and r["period_end"] is None]
        rows.sort(key=lambda r: (r["period_start"], r["created_at"]))
        return rows[0] if rows else None

    def _amend(self, line_id, amount):
        for r in self.lines:
            if str(r["id"]) == str(line_id):
                r["amount"] = amount
                return r
        return None

    def _end(self, line_id, ends_on, actor):
        for r in self.lines:
            # `AND period_end IS NULL` in the real UPDATE: ending an already
            # ended line matches nothing rather than moving the date.
            if str(r["id"]) == str(line_id) and r["period_end"] is None:
                r["period_end"] = ends_on
                r["ended_by"] = actor
                return r
        return None

    def _select_lines(self, flat, args):
        """Any SELECT over org_billing_lines, filtered by whatever the statement
        carries: the org, an id array, the due predicate (negated or not), and
        the not-yet-billed subquery.

        Written to the SHAPE of the statement rather than to a list of the three
        the service asks today, because the fix for `record_billed` may add a
        fourth — a pre-check naming the lines that are not due, in the style of
        the clash check twelve lines above it — and this fake has to answer that
        honestly rather than refuse to recognise it.
        """
        org = _param(flat, _P_ORG, args)
        period = _param(flat, _P_DATE, args)
        ids = _param(flat, _P_IDS, args)

        rows = list(self.lines)
        if org is not None:
            rows = [r for r in rows if str(r["org_id"]) == str(org)]
        if ids is not None:
            wanted = {str(i) for i in ids}
            rows = [r for r in rows if str(r["id"]) in wanted]
        if "l.cadence" in flat:
            assert period is not None, f"due predicate with no period: {flat}"
            negated = bool(re.search(r"NOT\s+\(\(l\.cadence", flat))
            rows = [r for r in rows
                    if _due(self.lines, r, period) is not negated]
        if "NOT EXISTS (SELECT 1 FROM staging.invoice_billing_lines" in flat:
            rows = [r for r in rows if not self._is_billed(r["id"], period)]

        if "array_position" in flat:
            order = ["platform", "support", "ongoing", "setup", "topup"]
            rows.sort(key=lambda r: (order.index(r["kind"]) if r["kind"] in order
                                     else len(order), r["created_at"]))
        elif "ORDER BY period_start DESC" in flat:
            rows.sort(key=lambda r: (r["period_start"], r["created_at"]),
                      reverse=True)

        limit = _param(flat, _P_LIMIT, args)
        return rows[:int(limit)] if limit else rows

    def _with_covering(self, flat, args):
        """A SELECT over the lines with `_covering_line` joined LATERALLY.

        Two statements have this shape and the difference between them is one
        word: `lines_due_in_period`'s `superseded` uses a plain JOIN, so a line
        with nothing covering it produces no row, and `record_billed`'s
        `not_due` uses a LEFT JOIN, so a line that is not due for the ordinary
        reason — wrong month — comes back with the covering columns NULL and the
        refusal can tell the two apart.

        The row it returns is a SUPERSET of both column lists. The alternative
        is guessing which statement is being served from its SELECT list, and
        the consumers only read the columns they asked for.
        """
        org = _param(flat, _P_ORG, args)
        ids = _param(flat, _P_IDS, args)
        period = _param(flat, _P_DATE, args)
        left = "LEFT JOIN LATERAL" in flat

        rows = [r for r in self.lines if str(r["org_id"]) == str(org)]
        if ids is not None:
            wanted = {str(i) for i in ids}
            rows = [r for r in rows if str(r["id"]) in wanted]
        if re.search(r"NOT\s+\(\(l\.cadence", flat):
            rows = [r for r in rows if not _due(self.lines, r, period)]
        elif "l.cadence='monthly'" in flat:
            # The `superseded` query's own WHERE: every monthly line STANDING in
            # this period, due or not. The join is what drops the ones nothing
            # covers.
            rows = [r for r in rows
                    if r["cadence"] == "monthly"
                    and r["period_start"] <= period
                    and (r["period_end"] is None or r["period_end"] >= period)]

        out = []
        for r in sorted(rows, key=lambda r: r["created_at"]):
            c = _covering(self.lines, r, period)
            if c is None and not left:
                continue
            out.append({
                "id": r["id"], "line_id": r["id"], "kind": r["kind"],
                "description": r["description"], "amount": r["amount"],
                "cadence": r["cadence"], "period_start": r["period_start"],
                "period_end": r["period_end"],
                "covered_by_id": c["id"] if c else None,
                "covered_by_description": c["description"] if c else None,
                "covered_by_amount": c["amount"] if c else None,
                "covered_by_period_end": c["period_end"] if c else None,
            })
        return out

    def _totals(self, flat, args):
        org, period = args[0], args[1]
        due = [r for r in self.lines
               if str(r["org_id"]) == str(org) and _due(self.lines, r, period)]
        return {
            "monthly_total": sum((r["amount"] for r in due
                                  if r["cadence"] == "monthly"), 0),
            "one_off_total": sum((r["amount"] for r in due
                                  if r["cadence"] == "one_off"), 0),
        }

    # ── invoice_billing_lines ───────────────────────────────────────────────

    def _is_billed(self, line_id, period) -> bool:
        return any(b["line_id"] == str(line_id) and b["period_start"] == period
                   for b in self.billed)

    def _clash(self, flat, args):
        ids = _param(flat, _P_BILLED_IDS, args) or []
        period = _param(flat, _P_DATE, args)
        wanted = {str(i) for i in ids}
        out = []
        for b in self.billed:
            if b["line_id"] in wanted and b["period_start"] == period:
                line = next(r for r in self.lines if r["id"] == b["line_id"])
                out.append({"line_id": b["line_id"],
                            "description": line["description"],
                            "invoice_number": self.invoices.get(b["invoice_id"],
                                                                "INV-?")})
        return out

    def _already_billed(self, flat, args):
        org = _param(flat, _P_ORG, args)
        period = _param(flat, _P_DATE, args)
        out = []
        for b in self.billed:
            line = next((r for r in self.lines if r["id"] == b["line_id"]), None)
            if line is None or str(line["org_id"]) != str(org):
                continue
            if b["period_start"] != period:
                continue
            out.append({"line_id": line["id"], "kind": line["kind"],
                        "description": line["description"],
                        "amount": b["amount"], "period_start": b["period_start"],
                        "invoice_id": b["invoice_id"],
                        "invoice_number": self.invoices.get(b["invoice_id"], "INV-?"),
                        "payment_status": "unpaid"})
        return out

    def _record(self, flat, args):
        invoice = _param(flat, r"SELECT\s+\$(\d+)::uuid", args)
        period = _param(flat, _P_DATE, args)
        org = _param(flat, _P_ORG, args)

        # The ids arrive either as `l.id = ANY($N)` or joined through
        # `unnest($N::uuid[], $M::numeric[])`, which carries the amount the
        # INVOICE charged beside each one — `line_items` is what the client
        # pays and the line is only the standing term it quotes.
        unnest = re.search(_P_UNNEST, flat)
        if unnest:
            ids = list(args[int(unnest.group(1)) - 1] or [])
            charged = list(args[int(unnest.group(2)) - 1] or [])
        else:
            ids, charged = list(_param(flat, _P_IDS, args) or []), []
        charged += [None] * (len(ids) - len(charged))
        overrides = "COALESCE(v.amount" in flat

        # The real statement is an INSERT … SELECT, so every WHERE clause on it
        # SILENTLY drops rows — which is exactly how a line that is not due
        # would come to be skipped rather than refused. Whatever the statement
        # filters on, this fake filters on.
        due_filtered = "l.cadence" in flat

        out = []
        for i, amount in zip(ids, charged):
            line = next((r for r in self.lines
                         if str(r["id"]) == str(i)
                         and str(r["org_id"]) == str(org)), None)
            if line is None:
                continue
            if due_filtered and not _due(self.lines, line, period):
                continue
            if self._is_billed(line["id"], period):
                raise _Unique("uq_ibl_line_period")
            rec = {"invoice_id": str(invoice), "line_id": line["id"],
                   "period_start": period,
                   "amount": amount if (overrides and amount is not None)
                             else line["amount"]}
            self.billed.append(rec)
            out.append(rec)
        return out


@pytest.fixture
def lines_table():
    return _Table096()


# ── 6a. ENDED AND REOPENED IN THE SAME MONTH ────────────────────────────────

async def test_a_line_ended_and_reopened_in_one_month_is_billed_once(lines_table):
    """The double charge the whole design exists to prevent, arriving through
    the ONE path the design offers for stopping and restarting a fee.

    `period_end` is the LAST period a line is billed for, INCLUSIVE — that is
    the promise the confirm dialog makes ("billed through August and not
    after"). So a line ended in August is still due in August. Open its
    replacement in August and BOTH satisfy `period_end >= period_start = August`:
    the due query returns two support lines, the invoice carries two, and
    `uq_obl_open_platform` cannot refuse the second because the first is no
    longer open. Every index and the drift view look the other way.

    TWO OUTCOMES ARE CORRECT and this test accepts either, because the repair
    can honestly live at either end:

      · `create_line` REFUSES the reopen — the second charge never exists, and
        the operator is told to amend the line they have (which is what
        `sync_platform_line` already does for the platform fee, and its
        docstring already says why);
      · the reopen is allowed and only ONE of the two is due in August.

    What is not correct is both on one invoice. Asserting the refusal alone
    would pin a fix that has not been chosen yet; asserting the count says what
    the client experiences either way.
    """
    BL = _BL()
    first = await BL.create_line(
        lines_table, org_id=ORG, kind="support", description="Support plan",
        amount=8000, cadence="monthly", period_start=AUGUST,
        created_by=AEKAM_OPS,
    )
    await BL.end_line(lines_table, first["id"], org_id=ORG,
                      actor_id=AEKAM_OPS, period=AUGUST)
    assert lines_table.lines[0]["period_end"] == AUGUST, (
        "the line was not ended in August, so this test is not testing the "
        "overlap it is named after"
    )

    try:
        await BL.create_line(
            lines_table, org_id=ORG, kind="support",
            description="Support plan — revised", amount=12000,
            cadence="monthly", period_start=AUGUST, created_by=AEKAM_OPS,
        )
    except BL.BillingLineError:
        pass                      # refused: the second charge never came to be

    due = await BL.lines_due_in_period(lines_table, ORG, AUGUST)
    support = [l for l in due["lines"] if l["kind"] == "support"]
    assert len(support) == 1, (
        f"August's invoice carries {len(support)} support lines "
        f"(₹{due['total']:.0f} in total) for one support plan that was stopped "
        f"and restarted in the same month. The client is charged twice, "
        f"`uq_obl_open_platform` cannot see it because the first line is "
        f"closed, and `v_org_platform_line_drift` cannot see it because it is "
        f"not a platform line."
    )
    assert due["total"] == support[0]["amount"], (
        "the invoice total does not match the one line it is supposed to be "
        "the sum of"
    )

    if len(lines_table.lines) == 2:
        # The reopen was ALLOWED and suppressed. Then the screen has to say so.
        # A row that is in the billing block and silently absent from the
        # invoice is one an operator types back in by hand — the same double
        # charge, arriving through the keyboard instead of through the query —
        # and "no silent forgiveness" cuts both ways on a page about money.
        explained = {s["line_id"] for s in due.get("superseded", [])}
        assert explained, (
            "the second support line is not on the invoice and nothing in the "
            "preview says why. The operator sees two support rows in the "
            "billing block, one charge on the invoice, and no reason — so they "
            "add the missing one back by hand."
        )
        assert explained == {l["id"] for l in lines_table.lines} - {
            support[0]["id"]}
        covered_by = due["superseded"][0]["covered_by_id"]
        assert covered_by == support[0]["id"], (
            "the reason names a line other than the one actually carrying the "
            "month"
        )


async def test_the_month_after_a_line_ends_is_not_billed(lines_table):
    """The other side of the same boundary, so a fix for the test above cannot
    be "stop billing the month a line ends in".

    Ending a line today does not refund this month; it stops the next one. A
    repair that made an ended line stop being due in its own final period would
    hand every client a free last month and no test would have said so.
    """
    BL = _BL()
    line = await BL.create_line(
        lines_table, org_id=ORG, kind="ongoing", description="Ongoing support",
        amount=5000, cadence="monthly", period_start=JULY, created_by=AEKAM_OPS,
    )
    await BL.end_line(lines_table, line["id"], org_id=ORG,
                      actor_id=AEKAM_OPS, period=JULY)

    july = await BL.lines_due_in_period(lines_table, ORG, JULY)
    assert [l["id"] for l in july["lines"]] == [line["id"]], (
        "a line ended in July was not billed for July — `period_end` is the "
        "last period billed, inclusive, and the confirm dialog promises exactly "
        "that before the operator presses the button"
    )
    august = await BL.lines_due_in_period(lines_table, ORG, AUGUST)
    assert august["lines"] == [], "a line ended in July is still billing in August"


# ── 6b. record_billed AND THE PERIOD A LINE WAS NEVER DUE IN ────────────────

async def test_record_billed_refuses_a_line_not_due_in_that_period(lines_table):
    """A one-off setup fee for JULY, booked against AUGUST.

    `record_billed` writes `staging.invoice_billing_lines`, and that row is the
    system's whole memory of what a client has been charged for which month. It
    does not apply `_DUE_IN_PERIOD` — the predicate sitting twelve lines above
    it in its own file — so it will happily record a July one-off as August's,
    and from then on:

      · August's invoice carries a line August never owed;
      · `already_billed` reports it against August, so the operator previewing
        August is told the fee is handled;
      · `uq_ibl_line_period` is satisfied, because (line, August) is genuinely
        unique — the index cannot tell a wrong period from a right one;
      · and JULY, the month the fee was actually due in, still shows it as
        unbilled and it goes on the July invoice too.

    The refusal, not a skip: skipping would leave the line on the invoice's
    `line_items` — the client is charged — while the join table says it was
    never billed, which is the double charge with the evidence removed. That is
    the argument `record_billed`'s own docstring makes about the clash check;
    this is the same argument about the period.
    """
    BL = _BL()
    setup = await BL.create_line(
        lines_table, org_id=ORG, kind="setup", description="Tally integration",
        amount=40000, cadence="one_off", period_start=JULY,
        created_by=AEKAM_OPS,
    )
    august_invoice = str(uuid.uuid4())
    lines_table.invoices[august_invoice] = "INV-0002"

    with pytest.raises(BL.BillingLineError):
        await BL.record_billed(
            lines_table, invoice_id=august_invoice, org_id=ORG,
            line_ids=[setup["id"]], period=AUGUST,
        )
    assert lines_table.billed == [], (
        "a one-off due only in July was recorded as billed for August. The "
        "August invoice carries a charge August never owed, and July still "
        "reports the same line as unbilled — so it is raised again there."
    )

    # The other half, so the fix cannot be "refuse everything": the SAME line,
    # billed against the month it IS due in, is recorded.
    july_invoice = str(uuid.uuid4())
    lines_table.invoices[july_invoice] = "INV-0001"
    recorded = await BL.record_billed(
        lines_table, invoice_id=july_invoice, org_id=ORG,
        line_ids=[setup["id"]], period=JULY,
    )
    assert [r["line_id"] for r in recorded] == [setup["id"]]
    assert len(lines_table.billed) == 1


async def test_record_billed_refuses_a_monthly_line_for_a_month_before_it_started(
    lines_table,
):
    """The same hole from the other direction, and the one an operator reaches
    by hand: "Load lines" for a month that predates the line.

    096's backfill starts every platform line at THIS month and says why —
    backdating would make every past month suddenly billable and an operator
    loading June would raise an invoice for a fee collected some other way.
    `record_billed` is the last thing standing between that and a document.
    """
    BL = _BL()
    line = await BL.create_line(
        lines_table, org_id=ORG, kind="support", description="Support plan",
        amount=8000, cadence="monthly", period_start=AUGUST,
        created_by=AEKAM_OPS,
    )
    invoice = str(uuid.uuid4())
    lines_table.invoices[invoice] = "INV-0003"

    with pytest.raises(BL.BillingLineError):
        await BL.record_billed(lines_table, invoice_id=invoice, org_id=ORG,
                               line_ids=[line["id"]], period=JULY)
    assert lines_table.billed == [], (
        "a support plan that starts in August was booked against July — a month "
        "the client had not agreed to it in"
    )


# ── 6c. WHAT THE TENANT SEES OF AEKAM ───────────────────────────────────────

async def test_the_orgs_own_view_of_its_lines_names_no_aekam_staff(
    api_client, mock_pool, as_org_admin, lines_table,
):
    """`GET /me/lines` is a CLIENT reading their own terms.

    `created_by` and `ended_by` are `public.users.user_id` — Aekam's own staff,
    by internal id. They are on the row because the console needs to know who
    agreed a fee and who stopped it; the client does not, and the ids are not
    theirs to have. Handing them over leaks the shape of Aekam's internal
    accounts (who is in billing, how many there are, when each of them last
    touched this account) to every org admin with a login, on the one screen a
    client is most likely to read closely because it is about money.

    `_row_to_line` serves both audiences from one shape, which is correct — this
    is not an argument for two shapes, it is an argument for the `/me` route
    dropping two fields on the way out.
    """
    lines_table.add(kind="platform", description="Platform fee", amount=25000,
                    cadence="monthly", period_start=AUGUST, created_by=AEKAM_OPS)
    lines_table.add(kind="support", description="Support plan", amount=8000,
                    cadence="monthly", period_start=date(2026, 3, 1),
                    period_end=JULY, created_by=AEKAM_OPS,
                    ended_by=AEKAM_FINANCE)
    mock_pool.acquire.return_value = lines_table

    resp = await api_client.get("/api/v1/billing/me/lines?period=2026-08")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # The lines themselves must still arrive — a fix that answered this by
    # returning nothing would be a client who cannot read their own terms.
    assert len(body["data"]) == 2, body
    assert {l["description"] for l in body["data"]} == {"Platform fee",
                                                        "Support plan"}
    assert body["monthly_total"] == 25000, (
        "the ended support plan is still being totalled into August"
    )

    for staff in (AEKAM_OPS, AEKAM_FINANCE):
        assert staff not in resp.text, (
            f"GET /me/lines hands the tenant '{staff}', an Aekam staff user id. "
            f"The console needs `created_by`/`ended_by`; the client is not the "
            f"console."
        )


# ── 6d. AN ORG CREATION THAT REFUSES MUST LEAVE NOTHING BEHIND ──────────────

ORGS_URL = "/api/v1/admin/orgs"
OWNER = "user_owner001"
TEAM = "team-0001"
PLAN = "plan-0001"


class _CreateOrgProbe:
    """What `create_org` ATTEMPTED, and what SURVIVED.

    Two lists and not one, because the repair to this handler is two independent
    changes and each needs its own witness:

      `attempted` — every statement handed to the database, committed or not.
                    A refusal that reaches this list has already decided to
                    write; the bounds check exists so that a refused price never
                    gets that far.
      `committed` — what is still there afterwards. Six sequential autocommitted
                    writes put everything here; one transaction puts nothing
                    here when the body raises.

    A test that watched only the second would pass the day somebody moved the
    bounds check back out and left the transaction in place, and a test that
    watched only the first would pass the day somebody took the transaction
    away. Both defects put a client in the same position, so both are named.
    """

    def __init__(self):
        self.attempted: list[str] = []
        self.committed: list[str] = []
        self.buckets: list[str] = []
        self.orgs: list[str] = []

    def commit(self, flat: str, args: tuple):
        self.committed.append(flat)
        if "INSERT INTO staging.organisations" in flat:
            self.orgs.append(str(args[0]))

    def tried(self, needle: str) -> bool:
        return any(needle in s for s in self.attempted)

    def kept(self, needle: str) -> bool:
        return any(needle in s for s in self.committed)


class _Savepoint:
    """`conn.transaction()` — including the NESTED one.

    asyncpg opens a SAVEPOINT rather than a second transaction when one is
    already running, which is what lets `_platform_line_for_new_org` swallow a
    42P01 without taking the org down with it. Modelled the same way: an inner
    block that raises discards only what it wrote, and only the OUTERMOST clean
    exit commits.
    """

    def __init__(self, conn):
        self.conn = conn
        self.mark = 0

    async def __aenter__(self):
        self.mark = len(self.conn.pending)
        self.conn.depth += 1
        return self

    async def __aexit__(self, exc_type, *_):
        self.conn.depth -= 1
        if exc_type is not None:
            del self.conn.pending[self.mark:]
        elif self.conn.depth == 0:
            for flat, args in self.conn.pending:
                self.conn.probe.commit(flat, args)
            self.conn.pending.clear()
        return False


class _Conn:
    """A pooled connection whose transaction ACTUALLY ROLLS BACK.

    The conftest connection double commits everything by doing nothing, which
    cannot tell a handler that writes inside a transaction apart from one that
    autocommits six times — and that difference is this test's whole subject.
    """

    def __init__(self, probe: _CreateOrgProbe):
        self.probe = probe
        self.depth = 0
        self.pending: list[tuple[str, tuple]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def transaction(self):
        return _Savepoint(self)

    async def execute(self, sql, *args):
        flat = re.sub(r"\s+", " ", sql)
        self.probe.attempted.append(flat)
        if self.depth:
            self.pending.append((flat, args))
        else:
            self.probe.commit(flat, args)
        return "INSERT 1"

    async def fetchval(self, sql, *args):
        return None

    async def fetchrow(self, sql, *args):
        return None

    async def fetch(self, sql, *args):
        return []


@pytest.fixture
def create_org(monkeypatch, mock_pool):
    """`POST /v1/admin/orgs` with every side effect observable and none of them
    real.

    `create_org` writes six things and creates one bucket: the organisations
    row, the subscription, the wallet, the allowance, the platform line and the
    owner's `user_roles` row. Written as six sequential AUTOCOMMITTED writes
    with the bucket in the middle — which is what it was — anything that raises
    part way leaves the earlier ones standing, and the operator's retry is then
    answered 409 by the row the failed attempt committed.

    So the connection here is `_Conn`, whose transaction rolls back, and the
    probe records ATTEMPTED separately from COMMITTED. Both are needed: see
    `_CreateOrgProbe`.

    `grant` and `balance_of` are stubbed — `services/credits.py` has its own
    file and is not what is under test. `sync_platform_line` is NOT stubbed into
    a shrug: it runs the real `_money`, which is the function that actually
    refuses a negative price, so the refusal in these tests is the product's own
    and not this file's imitation of it.
    """
    probe = _CreateOrgProbe()
    BL = _BL()

    async def _create_org_bucket(org_id):
        probe.buckets.append(str(org_id))
        return f"org-{org_id}"

    monkeypatch.setattr(admin_orgs, "create_org_bucket", _create_org_bucket)

    async def _balance_of(conn, org_id, **kw):
        return None

    async def _grant(conn, **kw):
        return None

    monkeypatch.setattr(admin_orgs, "balance_of", _balance_of)
    monkeypatch.setattr(admin_orgs, "grant", _grant)

    class _Lines096:
        async def sync_platform_line(self, conn, *, org_id, amount, actor_id):
            # The REAL refusal. `sync_platform_line` runs `_assert_org`, `_money`
            # and `_open_line_of_kind` BEFORE its `if fee == 0: return None`, and
            # `_money` is where a negative price dies — with an `InvalidLine`,
            # which is a 400, raised after five writes have committed.
            BL._money(amount, field="monthly_price")
            return None

    monkeypatch.setattr(admin_orgs, "_billing_lines", lambda: _Lines096())

    async def _fetchrow(sql, *args):
        if "FROM users WHERE LOWER(email)" in sql:
            return {"user_id": OWNER, "email": "owner@example.com"}
        if "FROM team_members" in sql:
            return {"team_id": TEAM}
        if "FROM staging.organisations WHERE team_id" in sql:
            # THE RETRY'S ANSWER, and it depends on whether the first attempt
            # left a row behind: `create_org` answers 409 "An organisation
            # already exists for this team" from exactly this read.
            return {"id": probe.orgs[0]} if probe.orgs else None
        if "FROM staging.plans" in sql:
            return {"id": PLAN, "code": "growth", "default_credits": 0}
        return None

    async def _fetchval(sql, *args):
        # `as_admin` answers the platform-role query and this fixture is ordered
        # after it, so the role has to be answered here too or every commercial
        # field on the body 403s before reaching the code under test.
        if "staging.user_roles" in sql:
            return 1
        return 0

    async def _execute(sql, *args):
        # The POOL, not the connection: a write made here is autocommitted and
        # no rollback can reach it. Recorded as attempted AND committed in one
        # step, which is exactly what that used to mean.
        flat = re.sub(r"\s+", " ", sql)
        probe.attempted.append(flat)
        probe.commit(flat, args)
        return "INSERT 1"

    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.execute.side_effect = _execute
    mock_pool.acquire.return_value = _Conn(probe)
    return probe


def _org_body(**over):
    body = {
        "name": "Sharma & Associates",
        "owner_email": "owner@example.com",
        "plan_code": "growth",
        "monthly_price": 25000,
        "r2": {"account_id": "acc", "access_key_id": "key",
               "secret_access_key": "secret", "bucket_name": "kartavya-storage"},
    }
    body.update(over)
    return body


async def test_a_negative_monthly_price_commits_nothing(
    api_client, mock_pool, as_admin, create_org,
):
    """`{"monthly_price": -1}` is refused, and nothing is written or attempted.

    `PATCH /admin/orgs/{id}/settings` refuses a price below zero. `POST /orgs`
    took the same four commercial fields and bounded NONE of them, so the amount
    was not looked at until `sync_platform_line` ran `_money` on it — the LAST
    thing the handler does with the database, and by then the organisation row,
    the R2 bucket and the subscription had each committed on their own. The 400
    that came back read like nothing had happened.

    TWO THINGS HAVE TO BE TRUE and this test asserts both, because the repair is
    two independent changes and either one can be undone on its own:

      · NOTHING WAS ATTEMPTED — the bounds are checked before the handler starts
        writing at all. Without this, a negative price still gets as far as
        INSERTing the organisation and is only undone by the rollback, which
        works until the day some later write moves outside the transaction.
      · NOTHING SURVIVED — whatever was attempted is gone. Without this, the
        writes are back to being autocommitted and the refusal leaves an orphan.

    The refusal itself may be a 400 from `_assert_commercial_bounds` or a 422 if
    a bound is ever declared on `OrgCreate`; both are refusals and neither is
    what this test is about.
    """
    resp = await api_client.post(ORGS_URL, json=_org_body(monthly_price=-1))
    assert resp.status_code in (400, 422), resp.text

    assert create_org.attempted == [], (
        f"a refused price still got as far as writing: "
        f"{create_org.attempted}. The four commercial bounds PATCH /settings "
        f"applies are not applied here, so the amount is not looked at until "
        f"`_money` sees it — after the handler has already started building the "
        f"organisation."
    )
    assert create_org.orgs == [], (
        "an organisation row survived a refused request. It has no owner role, "
        "no wallet and no platform line, and nothing rolls it back — that is "
        "the orphan, and the next test is what it costs."
    )
    assert not create_org.kept("INSERT INTO staging.subscriptions"), (
        "a subscription survived for an organisation that does not exist"
    )
    assert not create_org.kept("INSERT INTO staging.user_roles"), (
        "an owner role survived on a refused organisation"
    )
    assert create_org.buckets == [], (
        "an R2 bucket was created for an organisation the request then refused "
        "to finish. It is an external side effect with no compensating delete "
        "— the only repair is a human in the Cloudflare console."
    )


async def test_the_team_can_still_be_given_an_org_after_a_refused_price(
    api_client, mock_pool, as_admin, create_org,
):
    """The retry, which is what an operator actually does with a 400.

    This is the half of the defect that outlives the request. A refusal that
    leaves an organisations row behind is answered 409 "An organisation already
    exists for this team" on the second attempt — by the duplicate check, from
    the row the FAILED attempt committed. The team is then uncreatable through
    the console by anybody, and clearing it means psql against the one `staging`
    schema production also writes to.

    It is stated separately from the assertions above because it is what a
    person experiences rather than what a table holds, and because it fails for
    a reason the ones above cannot: they check that a REFUSED request left
    nothing, and this checks that the next request therefore works.
    """
    refused = await api_client.post(ORGS_URL, json=_org_body(monthly_price=-1))
    assert refused.status_code in (400, 422), refused.text

    again = await api_client.post(ORGS_URL, json=_org_body(monthly_price=25000))
    assert again.status_code in (200, 201), (
        f"the retry after a refused price was answered {again.status_code}: "
        f"{again.text}. The refused attempt left an organisation row on this "
        f"team, so the duplicate check now refuses every further attempt — the "
        f"team cannot be given an organisation through this console at all."
    )
    assert len(create_org.orgs) == 1, (
        f"{len(create_org.orgs)} organisation rows exist for one team after a "
        f"refusal and a successful retry"
    )
