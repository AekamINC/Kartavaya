"""
The segment actually narrows — proved against the SQL the resolver builds.

`audience_filter` was hard-coded `{}` in CampaignsTab.jsx, so every campaign
ever sent went to every contact in the org. The backend has supported four
predicates the whole time; nothing could set them. The filter is now settable,
which means the interesting question stops being "does the key parse" —
tests/test_prachar_audience.py already pins that — and becomes the one nobody
can answer by reading a mock's call args:

    DOES THE FILTER REMOVE ANYBODY, AND DOES IT REMOVE THE RIGHT PEOPLE?

A test that asserts `"contact_type=$2" in sql` proves a string was concatenated.
It passes just as happily if the predicate matches every row, which is the
failure mode this whole feature exists to fix. So `_Contacts` below EXECUTES the
query the resolver builds: it reads the predicates out of the SQL, applies them
to in-memory rows, and implements ILIKE ... ESCAPE the way Postgres does. A
widened segment then shows up as a count, which is the same way an operator
would notice it.

WHAT IS PINNED HERE

1. A FILTER RESOLVES TO FEWER CONTACTS THAN NO FILTER.
   The one assertion the shipped module could never make.

2. A `%` TYPED INTO THE COMPANY BOX IS A CHARACTER, NOT A WILDCARD.
   "100%" is a company name. Unescaped it becomes `company ILIKE '%100%%'`,
   which is every company in the org — and the preview reports the larger number
   as though it were the segment, so the widening confirms itself.

3. A MALFORMED FILTER IS A NAMED 4xx, NEVER A 500.
   See the note above test_a_malformed_filter_key_is_a_named_400_not_a_500 for
   why the key case is 400 and the shape case is 422. Both are client errors and
   the distinction is deliberate.

4. UNSUBSCRIBES ARE REMOVED AFTER THE FILTER, NEVER BEFORE.
   Order matters twice. `matched` must count the SEGMENT, so suppression cannot
   run first; and `unsubscribed` must count suppressions INSIDE the segment, not
   across the org, or a marketer reads "12 unsubscribed" on a segment of three.
"""
import asyncio
import inspect
import re

import pytest
from fastapi import HTTPException

import routers.prachar as prachar

ORG = "00000000-0000-0000-0000-0000000000a1"


# ── the fake ────────────────────────────────────────────────────────────────
#
# In the house style set by test_credit_model.py's `_DB`: a hand-written stand-in
# that enforces the same rules the database does, so a test cannot pass against
# behaviour Postgres would refuse. Here the rule being enforced is ILIKE's, and
# it is the whole point of assertion 2.


def _ilike(value: str, pattern: str, escape: str = "\\") -> bool:
    """Postgres `ILIKE pattern ESCAPE escape`, in Python.

    Written out rather than approximated with `in` because the bug being pinned
    is precisely the difference between the two: `"100%" in company` is true for
    nobody, `company ILIKE '%100%%'` is true for everybody, and only a real
    pattern match tells those apart.
    """
    out: list[str] = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == escape and i + 1 < len(pattern):
            out.append(re.escape(pattern[i + 1]))
            i += 2
            continue
        if ch == "%":
            out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(re.escape(ch))
        i += 1
    return re.fullmatch("".join(out), value or "", re.I | re.S) is not None


def _param(sql: str, pattern: str) -> int | None:
    """The 1-based parameter number a predicate binds, or None if absent.

    Reading the NUMBER rather than just the presence of the clause is what makes
    the fake fail loudly if the resolver ever appends a predicate and binds the
    wrong `$n` — an off-by-one there silently filters on the wrong value.
    """
    m = re.search(pattern, sql)
    return int(m.group(1)) if m else None


class _Contacts:
    """A pool that answers `_resolve_audience`'s query by running it.

    Records every query in order, because assertion 4 is about the ORDER of two
    reads and nothing else can observe it.
    """

    def __init__(self, contacts: list[dict], unsubscribed: tuple[str, ...] = ()):
        self.contacts = contacts
        self.unsubscribed = list(unsubscribed)
        self.reads: list[str] = []
        self.executed: list[tuple] = []

    async def fetch(self, q: str, *args):
        flat = re.sub(r"\s+", " ", q)
        if "public.prachar_unsubscribes" in flat:
            self.reads.append("unsubscribes")
            assert args[0] == ORG, "the suppression list is read for the wrong org"
            return [{"email": e} for e in self.unsubscribed]
        if "public.graha_contacts" in flat:
            self.reads.append("audience")
            return self._audience(flat, args)
        raise AssertionError(f"unexpected query: {flat[:120]}")

    async def execute(self, q: str, *args):
        self.executed.append((re.sub(r"\s+", " ", q), args))
        return "UPDATE 1"

    async def fetchval(self, q: str, *args):
        # `/send` now looks up the org's display name, because every marketing
        # message carries an unsubscribe footer that has to say who is sending
        # it. Answered rather than asserted on: this fake exists to execute the
        # AUDIENCE query, and the footer is somebody else's test.
        flat = re.sub(r"\s+", " ", q)
        if "public.organisations" in flat:
            return "Acme Consulting"
        raise AssertionError(f"unexpected fetchval: {flat[:120]}")

    # `/send` writes its recipient rows inside a transaction. The fake hands back
    # itself so those writes land in `executed` and can be counted.
    def acquire(self):
        return self

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def _audience(self, sql: str, args) -> list[dict]:
        assert "org_id=$1::uuid" in sql, "the audience query is no longer org-scoped"
        org = args[0]

        n_type = _param(sql, r"AND contact_type=\$(\d+)")
        n_source = _param(sql, r"AND source=\$(\d+)")
        n_tag = _param(sql, r"AND \$(\d+) = ANY\(tags\)")
        n_score = _param(sql, r"AND lead_score >= \$(\d+)")
        n_company = _param(sql, r"AND company ILIKE \$(\d+) ESCAPE")
        # No bind parameter — it is a fixed predicate, so it is detected by
        # presence. Executed rather than ignored: a fake that silently drops the
        # gate would let this file pass while the real query mailed prospects.
        client_gate = "AND client_id IS NOT NULL" in sql

        rows = []
        for c in self.contacts:
            # The four predicates that are always present. A resolver that drops
            # one of these is not a segmentation bug, it is a tenancy bug, so
            # they are checked here rather than assumed.
            if c["org_id"] != org:
                continue
            if not c.get("is_active", True):
                continue
            if c.get("merged_into_id"):
                continue
            if not (c.get("email") or "").strip():
                continue
            if client_gate and not c.get("client_id"):
                continue

            if n_type and c.get("contact_type") != args[n_type - 1]:
                continue
            if n_source and c.get("source") != args[n_source - 1]:
                continue
            if n_tag and args[n_tag - 1] not in (c.get("tags") or []):
                continue
            if n_score and (c.get("lead_score") or 0) < args[n_score - 1]:
                continue
            if n_company and not _ilike(c.get("company") or "", args[n_company - 1]):
                continue

            rows.append({
                "id": c["id"], "name": c["name"], "email": c["email"],
                # The resolver aliases `contact_type AS type`; the fake has to
                # produce the alias or the preview reads a column that is not
                # in the response it actually gets.
                "type": c.get("contact_type"), "company": c.get("company"),
                # Projected because `/send` stamps the linkage onto every
                # evidence row from this list rather than re-reading it.
                "client_id": c.get("client_id"),
            })
        rows.sort(key=lambda r: r["name"] or "")
        return rows


def _contact(n: int, **kw) -> dict:
    base = {
        "id": f"c{n:08d}-0000-0000-0000-000000000000",
        "org_id": ORG,
        "name": f"Contact {n:02d}",
        "email": f"c{n:02d}@example.com",
        "contact_type": "lead",
        "source": "website",
        "company": "Acme",
        "tags": [],
        "lead_score": 10,
        "is_active": True,
        "merged_into_id": None,
        # Every contact in this book is linked to a client of the practice.
        #
        # The resolver now carries `AND client_id IS NOT NULL` by default — the
        # ICAI gate, see `services/prachar_compliance.py`. This file's subject is
        # SEGMENTATION, so its fixtures satisfy the gate and the filters can be
        # tested one at a time; `test_prachar_icai.py` is where the gate itself
        # is exercised. Pass `client_id=None` to build a prospect.
        "client_id": f"cl{n:06d}-0000-0000-0000-000000000000",
    }
    base.update(kw)
    return base


# A deliberately mixed book. Every filter the product offers has both matches and
# non-matches in here, so "fewer than everyone" is a real reduction rather than
# an empty table.
BOOK = [
    _contact(1, contact_type="contact", company="Acme Ltd", tags=["vip"], lead_score=90),
    _contact(2, contact_type="contact", company="Beta Foods", tags=[], lead_score=40),
    _contact(3, contact_type="lead", company="Acme Ltd", tags=["vip"], lead_score=80),
    _contact(4, contact_type="lead", company="Gamma Traders", tags=[], lead_score=5),
    _contact(5, contact_type="vendor", company="Delta Supply", tags=["vip"], lead_score=60),
    _contact(6, contact_type="partner", company="Epsilon", tags=[], lead_score=25),
]


# ── 1. A filter removes people ──────────────────────────────────────────────

async def test_no_filter_is_the_whole_org_and_that_is_the_bug_being_fixed():
    # The state every campaign in the database is in today: `audience_filter` is
    # `{}`, which is not "no audience" — it is every active contact in the org.
    pool = _Contacts(BOOK)
    everyone = await prachar._resolve_audience(pool, ORG, {})
    assert len(everyone) == len(BOOK)


@pytest.mark.parametrize("filters,expected_emails", [
    ({"type": "contact"},        {"c01@example.com", "c02@example.com"}),
    ({"tag": "vip"},              {"c01@example.com", "c03@example.com", "c05@example.com"}),
    ({"min_score": 60},           {"c01@example.com", "c03@example.com", "c05@example.com"}),
    ({"source": "website"},       {c["email"] for c in BOOK}),
    ({"company": "acme"},         {"c01@example.com", "c03@example.com"}),
    # Two predicates AND together. A filter that ORed them would be wider than
    # either half, which is the one direction a segment must never fail in.
    ({"type": "contact", "company": "acme"}, {"c01@example.com"}),
])
async def test_a_filtered_campaign_reaches_fewer_contacts_than_an_unfiltered_one(
    filters, expected_emails,
):
    pool = _Contacts(BOOK)
    everyone = await prachar._resolve_audience(pool, ORG, {})
    segment = await prachar._resolve_audience(pool, ORG, filters)

    assert {c["email"] for c in segment} == expected_emails
    # `source` matches everybody in this book on purpose: it is the one filter
    # that legitimately may not narrow, and stating that keeps the parametrised
    # case honest rather than quietly asserting <= everywhere.
    if filters == {"source": "website"}:
        assert len(segment) == len(everyone)
    else:
        assert len(segment) < len(everyone), (
            f"{filters} matched everybody — the filter is being built but not "
            f"applied, which is how the unfiltered send looked from the outside"
        )


async def test_a_filter_that_matches_nobody_returns_nobody_rather_than_everybody():
    # The dangerous failure is a predicate that gets dropped when it matches
    # nothing. Zero is a legitimate answer and the send path already refuses to
    # send on it; six is a mailing.
    pool = _Contacts(BOOK)
    assert await prachar._resolve_audience(pool, ORG, {"company": "nobody"}) == []


async def test_another_orgs_contacts_are_not_in_any_segment():
    # The filter is new surface on a query that is also the tenancy boundary.
    pool = _Contacts(BOOK + [_contact(9, org_id="00000000-0000-0000-0000-0000000000b2")])
    assert len(await prachar._resolve_audience(pool, ORG, {})) == len(BOOK)


# ── 2. A typed % is a character ─────────────────────────────────────────────

# "100% Cotton Ltd" is a real Indian company-name shape. Unescaped, the pattern
# `%100%%` also matches "Shree 100 Percent Mills" and everything else with a
# `100` in it — and a segment that silently widens is indistinguishable from a
# segment that worked, until the mail has gone out.
WILDCARD_BOOK = [
    _contact(1, company="100% Cotton Ltd"),
    _contact(2, company="Shree 100 Percent Mills"),
    _contact(3, company="Acme Ltd"),
    _contact(4, company="A_B Industries"),
    _contact(5, company="AXB Industries"),
]


async def test_a_percent_typed_into_the_company_box_does_not_widen_the_audience():
    pool = _Contacts(WILDCARD_BOOK)
    segment = await prachar._resolve_audience(pool, ORG, {"company": "100%"})
    assert {c["email"] for c in segment} == {"c01@example.com"}, (
        "the typed % is being treated as a wildcard, so a segment of one "
        "company is mailing every company whose name contains 100"
    )


async def test_an_underscore_typed_into_the_company_box_matches_itself():
    # `_` is the second ILIKE wildcard and the one nobody remembers. "A_B"
    # unescaped matches "AXB", which is a different company.
    pool = _Contacts(WILDCARD_BOOK)
    segment = await prachar._resolve_audience(pool, ORG, {"company": "A_B"})
    assert {c["email"] for c in segment} == {"c04@example.com"}


async def test_a_backslash_typed_into_the_company_box_is_not_an_escape():
    # The escape character itself. If it were not doubled first, `a\%` would
    # arrive as an escape for the `%` this step just added, and the pattern
    # would end mid-escape.
    pool = _Contacts([_contact(1, company="R\\D Systems"), _contact(2, company="RXD Systems")])
    segment = await prachar._resolve_audience(pool, ORG, {"company": "R\\D"})
    assert {c["email"] for c in segment} == {"c01@example.com"}


async def test_the_company_match_is_still_a_substring_match():
    # The escape must not turn the whole thing into an equality match — a
    # marketer types "acme", not "Acme Ltd", and a filter that only matched the
    # full legal name would be a segment of nobody.
    pool = _Contacts(WILDCARD_BOOK)
    segment = await prachar._resolve_audience(pool, ORG, {"company": "cotton"})
    assert {c["email"] for c in segment} == {"c01@example.com"}


# ── 3. A malformed filter is a client error, never a 500 ────────────────────

@pytest.fixture
def open_gate(app):
    """Prachar's module gate, off. The subject here is the filter, not the grant."""
    app.dependency_overrides[prachar._gate] = lambda: None
    yield
    app.dependency_overrides.pop(prachar._gate, None)


@pytest.fixture
def in_org(app):
    """Resolve the caller's org to the one `BOOK` belongs to.

    Its own fixture rather than conftest's `with_org_id`, because `_Contacts`
    refuses to answer for any other org — which is the point of it: a resolver
    that stopped scoping by org would fail here rather than quietly return the
    fixture's rows.
    """
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG
    yield ORG
    app.dependency_overrides.pop(get_org_id, None)


async def test_a_malformed_filter_key_is_a_named_400_not_a_500(
    api_client, mock_pool, as_admin, in_org, open_gate,
):
    """NOTE ON THE STATUS CODE, because 422 is the obvious expectation.

    `normalise_audience_filter` raises HTTPException(400) rather than ValueError
    ON PURPOSE, and its docstring says so: a ValueError inside a pydantic
    validator becomes a 422 whose body is a LIST of validation-error objects,
    and the segment builder has one place to put one sentence. The refusal names
    the offending key and lists the five that exist, which is the entire value
    of validating here rather than letting the query run.

    What matters for money and for mail is that the answer is a 4xx that names
    the problem instead of a 500 that names nothing — an ignored key does not
    narrow the audience, it mails the whole org. Both codes below are pinned so
    a later change to either is a decision rather than a drift.
    """
    resp = await api_client.post(
        "/api/v1/prachar/audience/preview",
        json={"audience_filter": {"typo": "x"}},
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert "typo" in detail
    assert "type, source, company, tag, min_score" in detail


async def test_a_filter_that_is_not_an_object_is_a_422(
    api_client, mock_pool, as_admin, in_org, open_gate,
):
    # The SHAPE is pydantic's job and it answers 422 with a field path, which is
    # right: there is no key to name, so there is no sentence to write.
    resp = await api_client.post(
        "/api/v1/prachar/audience/preview", json={"audience_filter": 5},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"][0]["loc"][-1] == "audience_filter"


@pytest.mark.parametrize("bad", [
    {"typo": "x"},                 # not a filter at all
    {"type": "prospect"},          # not one of the four CHECK values
    {"min_score": "abc"},          # would bind TEXT against an INTEGER column
    {"min_score": 900},            # outside the column's CHECK
    {"company": ["acme"]},         # a list where the query binds text
])
async def test_no_malformed_filter_reaches_the_database(
    api_client, mock_pool, as_admin, in_org, open_gate, bad,
):
    # Each of these is a 500 if it gets as far as asyncpg, and each 500 reads to
    # the operator as "the preview is broken" rather than "your filter is".
    mock_pool.fetch.side_effect = AssertionError(
        "a malformed filter reached the database"
    )
    resp = await api_client.post(
        "/api/v1/prachar/audience/preview", json={"audience_filter": bad},
    )
    assert 400 <= resp.status_code < 500, resp.text


async def test_saving_a_campaign_refuses_the_same_filters_the_preview_does(
    api_client, mock_pool, as_admin, in_org, open_gate,
):
    # Refusing on preview but accepting on save is worse than accepting both: it
    # stores a filter that 400s every time anyone previews it afterwards.
    resp = await api_client.post("/api/v1/prachar/campaigns", json={
        "name": "Launch", "subject": "Hi", "body_html": "<p>Hi</p>",
        "audience_filter": {"typo": "x"},
    })
    assert resp.status_code == 400, resp.text
    assert "typo" in resp.json()["detail"]


def test_the_three_models_share_one_validator():
    """Create, update and the standalone preview must not disagree about what a
    filter is allowed to say — a filter that saves but cannot preview is the
    same defect as one that previews but cannot save."""
    for model in (prachar.CampaignCreate, prachar.CampaignUpdate,
                  prachar.AudiencePreview):
        assert "audience_filter" in model.model_fields
        assert "_check_audience" in vars(model) or any(
            "audience_filter" in str(v) for v in model.__pydantic_decorators__.field_validators.values()
        ), f"{model.__name__} no longer validates audience_filter"


def test_a_stored_filter_is_normalised_on_the_way_out_as_well():
    # 65 campaigns hold a filter written before anything checked it. Reading one
    # back has to go through the same function, or the first thing the new
    # segment UI does is 500 on the data the old UI wrote.
    src = inspect.getsource(prachar.preview_audience)
    assert "normalise_audience_filter(" in src


# ── 4. Suppression runs after the filter ────────────────────────────────────

# Contact 2 has unsubscribed and IS in the customer segment.
# Contact 4 has unsubscribed and is NOT — it is a lead in another company.
# If suppression ran first, or ran across the org, contact 4 would be counted
# against a segment it was never in.
SUPPRESSED = ("c02@example.com", "c04@example.com")


async def test_the_audience_is_resolved_before_the_suppression_list_is_read(
    api_client, mock_pool, as_admin, in_org, open_gate, monkeypatch,
):
    pool = _Contacts(BOOK, unsubscribed=SUPPRESSED)
    resp = await _preview(api_client, pool, monkeypatch, {"type": "contact"})

    assert resp.status_code == 200, resp.text
    assert pool.reads == ["audience", "unsubscribes"], (
        "the suppression list is read before the segment is resolved, so the "
        "counts describe the org rather than the segment"
    )


async def test_an_unsubscribe_outside_the_segment_is_not_counted_against_it(
    api_client, mock_pool, as_admin, in_org, open_gate, monkeypatch,
):
    pool = _Contacts(BOOK, unsubscribed=SUPPRESSED)
    body = (await _preview(api_client, pool, monkeypatch, {"type": "contact"})).json()

    # The customer segment is contacts 1 and 2. Only contact 2 has unsubscribed.
    assert body["matched"] == 2, "matched is not the size of the segment"
    assert body["count"] == body["matched"]
    assert body["unsubscribed"] == 1, (
        "an unsubscribe from outside the segment is being counted against it — "
        "the suppression list is being applied to the org, not to the audience"
    )
    assert body["will_receive"] == 1


async def test_the_suppressed_address_is_absent_from_the_sample(
    api_client, mock_pool, as_admin, in_org, open_gate, monkeypatch,
):
    # reach.spec.ts calls this a legal problem rather than a UX one: an
    # unsubscribed address listed in an audience panel is the same defect as an
    # unsubscribed address receiving the mail.
    pool = _Contacts(BOOK, unsubscribed=SUPPRESSED)
    body = (await _preview(api_client, pool, monkeypatch, {"type": "contact"})).json()
    assert {c["email"] for c in body["contacts"]} == {"c01@example.com"}


async def test_suppression_never_adds_anybody_to_a_segment(
    api_client, mock_pool, as_admin, in_org, open_gate, monkeypatch,
):
    # The arithmetic identity the panel is read on. If suppression ran first,
    # `matched` would be the post-suppression number and this would still hold —
    # so it is asserted together with the segment size above, not instead of it.
    pool = _Contacts(BOOK, unsubscribed=SUPPRESSED)
    body = (await _preview(api_client, pool, monkeypatch, {})).json()
    assert body["matched"] == len(BOOK)
    assert body["unsubscribed"] + body["will_receive"] == body["matched"]


def test_the_send_path_resolves_before_it_suppresses():
    """The preview above proves the order for the panel. `/send` reads the same
    two tables in its own body, and it is the one that actually mails — so the
    order is pinned there too, at the source, rather than assumed to match."""
    src = inspect.getsource(prachar.send_campaign)
    resolve_at = src.index("_resolve_audience(")
    unsub_at = src.index("public.prachar_unsubscribes")
    assert resolve_at < unsub_at, (
        "send_campaign reads the suppression list before it resolves the "
        "audience; the two counts it returns then describe different sets"
    )
    # And the suppression is applied to the RESOLVED list, not to a second query.
    assert "for c in contacts if c[\"email\"]" in src


async def test_send_reports_only_the_suppressions_inside_the_segment(
    api_client, mock_pool, as_admin, in_org, open_gate, monkeypatch,
):
    """`skipped_unsubscribed` is what the operator is told did not go out.

    Counted across the org it over-reports, which sounds harmless until someone
    reconciles it against the campaign's recipient rows and finds them short.
    """
    sent: list[str] = []
    # `**kw` because the send now names its `purpose` and `ref`, which is what
    # `outbound.py` asks every caller for and what turns `staging.outbound_log`
    # into a per-client answer. A stub with a fixed arity raises TypeError, the
    # dispatch loop catches it as a failed send, and the campaign silently mails
    # nobody — which is the defect this whole file exists to catch, arriving
    # through the test's own fixture.
    monkeypatch.setattr(prachar, "send_email",
                        lambda to, subj, body, *a, **kw: sent.append(to))

    pool = _Contacts(BOOK, unsubscribed=SUPPRESSED)
    campaign = {
        "id": "cccccccc-0000-0000-0000-000000000001",
        "name": "Launch", "template_id": None, "subject": "Hi",
        "body_html": "<p>Hi</p>", "channel": "email", "status": "draft",
        "audience_filter": {"type": "contact"},
    }

    async def _fetchrow(q, *a):
        return campaign

    pool.fetchrow = _fetchrow
    _use_pool(monkeypatch, pool)

    resp = await api_client.post(f"/api/v1/prachar/campaigns/{campaign['id']}/send")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["recipients"] == 1
    assert body["skipped_unsubscribed"] == 1, (
        "the org-wide suppression count is being reported as the campaign's"
    )

    # The dispatch is a background task. Drained here rather than left to run
    # after teardown, when `send_email` is the REAL one again — OUTBOUND_MODE is
    # 'dry' so nothing would leave the building either way, but a test that
    # finishes while a send loop is still going is a test whose result depends on
    # timing. Draining it also lets the assertion be about what was mailed rather
    # than about what the response claimed would be.
    await asyncio.gather(*list(prachar._background_tasks), return_exceptions=True)
    assert sent == ["c01@example.com"], (
        f"the campaign mailed {sent}; c02 has unsubscribed and c04 is not in the "
        f"customer segment at all"
    )


# ── plumbing ────────────────────────────────────────────────────────────────

def _use_pool(monkeypatch, pool):
    """Point `db.get_pool` at a fake that executes queries instead of recording
    them. The conftest mock returns canned values, which is right for the tests
    that assert on call args and useless for the ones that assert on counts."""
    import db

    async def _get_pool():
        return pool

    monkeypatch.setattr(db, "get_pool", _get_pool)
    monkeypatch.setattr(prachar, "get_pool", _get_pool)


async def _preview(api_client, pool, monkeypatch, filters):
    _use_pool(monkeypatch, pool)
    return await api_client.post(
        "/api/v1/prachar/audience/preview", json={"audience_filter": filters},
    )


# ── the normaliser's own refusals, at the boundary ──────────────────────────
#
# tests/test_prachar_audience.py pins the happy shapes. These two are the ones
# that would reach asyncpg as a bind error rather than as a refusal.

def test_a_list_where_the_query_binds_text_is_refused_not_bound():
    with pytest.raises(HTTPException) as exc:
        prachar.normalise_audience_filter({"company": ["acme"]})
    assert exc.value.status_code == 400
    assert "text" in exc.value.detail


def test_a_min_score_of_zero_is_kept_and_means_no_floor():
    # 0 is falsy. The resolver's `if filters.get("min_score")` therefore drops
    # it, which is correct — `lead_score >= 0` is every row — but it must be
    # dropped by the QUERY, not silently rewritten by the normaliser, or the
    # summary sentence and the stored filter stop agreeing with each other.
    assert prachar.normalise_audience_filter({"min_score": 0}) == {"min_score": 0}
