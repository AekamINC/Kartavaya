"""The campaign audience query names columns that exist.

`_resolve_audience` is the first statement executed by BOTH
`GET  /prachar/campaigns/{id}/audience`  and
`POST /prachar/campaigns/{id}/send`.

It selected `type` and filtered on `ANY(labels)`. `staging.graha_contacts` has
neither — the columns are `contact_type` and `tags`. asyncpg raised
UndefinedColumnError before a single row was read, so the audience preview
500'd and every send 500'd with it.

Nothing was ever delivered. Sixty-five campaigns sat in 'draft' and
`prachar_campaign_contacts` was empty, which read like "nobody has run a
campaign yet" rather than "campaigns cannot run". That is the expensive kind of
defect: the failure state and the not-yet-used state look identical.

This is the fourth bug in this programme with the same shape — Python names a
column or a type Postgres does not have, and it surfaces as an opaque 500:

    bank_statement_lines.batch_id   uuid column fed "BSI-<timestamp>"
    vikray_targets.salesperson_id   uuid column fed "user_xxx"
    pahchan publish                 $2::date fed a str
    graha_contacts.type             column does not exist

So this test checks the whole module, not just the one line that broke.
"""
import inspect
import re

import routers.prachar as prachar

# Every column on staging.graha_contacts, from information_schema on the live
# database. Update this list when a migration adds one.
GRAHA_CONTACT_COLUMNS = {
    "id", "org_id", "name", "email", "phone", "company", "designation",
    "gstin", "pan", "billing_address", "shipping_address", "tags", "notes",
    "contact_type", "source", "created_by", "is_active", "created_at",
    "updated_at", "lead_score", "lead_score_reasons", "assigned_to",
    "last_contacted_at", "converted_at", "client_id", "custom_data",
    "territory_id", "merged_into_id", "email_norm", "phone_norm",
}

# Names that read like columns but are not, and were the actual bug.
INVENTED = {"labels": "tags", "type": "contact_type"}


def _body(fn) -> str:
    """Source with the docstring removed.

    The docstring explains the bug and therefore contains the word SELECT and
    the word `type`. Parsing it would make this test assert against its own
    prose — it failed exactly that way on the first run.
    """
    src = inspect.getsource(fn)
    doc = inspect.getdoc(fn)
    if doc:
        for quote in ('"""', "'''"):
            start = src.find(quote)
            if start != -1:
                end = src.find(quote, start + 3)
                if end != -1:
                    return src[:start] + src[end + 3:]
    return src


def test_the_audience_query_selects_only_real_columns():
    # The query is built from adjacent string literals, so the raw source reads
    # `… company "\n  "FROM staging…` and a naive /SELECT (.*?) FROM/ never
    # matches. Drop the quotes and collapse the whitespace first — what is left
    # is the SQL the database actually receives.
    sql = re.sub(r"\s+", " ", _body(prachar._resolve_audience).replace('"', " "))

    select = re.search(r"SELECT\s+(.*?)\s+FROM", sql, re.I)
    assert select, "the audience query no longer looks like a SELECT"

    # `contact_type AS type` is fine — `type` is the API's field name. What
    # matters is the column on the LEFT of the AS.
    sources = {
        c.strip().split(" AS ")[0].strip().split()[-1]
        for c in select.group(1).split(",")
        if c.strip()
    }
    unknown = sources - GRAHA_CONTACT_COLUMNS
    assert not unknown, (
        f"the audience query selects {sorted(unknown)}, which graha_contacts "
        f"does not have — /audience and /send both 500 before reading a row"
    )


def test_the_audience_filters_reference_real_columns():
    src = _body(prachar._resolve_audience)
    for invented, real in INVENTED.items():
        # Allow it as a FILTER KEY (the JSON the caller sends) but not as a
        # column: `filters.get("type")` is the request field, `AND type=$2` is
        # the bug.
        assert not re.search(rf"AND\s+{invented}\s*=", src), (
            f'the filter still compares against a column named "{invented}"; '
            f'it is "{real}"'
        )
        assert not re.search(rf"ANY\(\s*{invented}\s*\)", src), (
            f'the filter still reads ANY({invented}); the column is "{real}"'
        )


def test_send_and_preview_share_the_one_resolver():
    """If they ever diverge, one of them will be fixed and the other will not —
    and the broken one is whichever nobody clicks in staging."""
    for fn in (prachar.preview_audience, prachar.send_campaign,
               prachar.preview_audience_filter):
        assert "_resolve_audience(" in inspect.getsource(fn), (
            f"{fn.__name__} no longer resolves its audience through the shared "
            f"helper, so the two can disagree about who receives a campaign"
        )


# ── The filter validator ─────────────────────────────────────
#
# Until this existed, `audience_filter` was a bare dict that nothing read on the
# way in. Two of the four things it now refuses were live 500s and the other two
# were live over-sends, so each assertion below is a defect that shipped.

from fastapi import HTTPException  # noqa: E402  — grouped with what it tests
import pytest  # noqa: E402

norm = prachar.normalise_audience_filter


def test_an_unknown_key_is_refused_and_named():
    # Ignoring it is the dangerous option: an ignored key does not narrow the
    # audience, it mails the whole org, and the preview agrees because it
    # ignores the same key.
    with pytest.raises(HTTPException) as exc:
        norm({"typo": 1})
    assert exc.value.status_code == 400
    assert "typo" in exc.value.detail
    assert "type, source, company, tag, min_score" in exc.value.detail


def test_min_score_arrives_from_a_form_as_text_and_is_coerced():
    # `lead_score >= '50'` binds TEXT against an INTEGER column; asyncpg raises
    # DataError and /audience answers 500. A form field is always a string.
    assert norm({"min_score": "50"}) == {"min_score": 50}
    assert isinstance(norm({"min_score": "50"})["min_score"], int)


@pytest.mark.parametrize("bad", ["abc", "", None, 101, -1, 1000])
def test_min_score_outside_the_column_is_refused_not_passed_through(bad):
    # lead_score is CHECK (0..100) (migration 019). A value outside it either
    # matches nobody or everybody, and neither is what was asked for.
    if bad in ("", None):
        assert norm({"min_score": bad}) == {}   # blank means "do not filter"
        return
    with pytest.raises(HTTPException) as exc:
        norm({"min_score": bad})
    assert exc.value.status_code == 400
    assert "0 and 100" in exc.value.detail


def test_a_contact_type_outside_the_check_is_refused_naming_the_four():
    with pytest.raises(HTTPException) as exc:
        norm({"type": "prospect"})
    assert exc.value.status_code == 400
    for t in ("lead", "customer", "vendor", "partner"):
        assert t in exc.value.detail


def test_blank_values_are_dropped_rather_than_sent_to_the_database():
    # "Any type" in a <Select> is value "". Refusing that would make the
    # harmless case the loud one; sending it would filter on contact_type=''.
    assert norm({"type": "", "company": "   ", "source": None}) == {}


def test_label_is_still_accepted_and_stored_as_tag():
    # Campaigns saved before this function existed hold `label`. Rejecting it
    # would 400 a preview of a campaign the product itself wrote.
    assert norm({"label": "vip"}) == {"tag": "vip"}


def test_a_filter_that_arrived_as_json_text_is_still_read():
    # db.py's jsonb codec is allowed to give up behind PgBouncer, in which case
    # a stored filter comes back as text.
    assert norm('{"type": "customer"}') == {"type": "customer"}


def test_the_empty_filter_survives_normalisation_unchanged():
    # `{}` means every active contact in the org, and it is what every campaign
    # in the database currently holds. Normalisation must not change that.
    assert norm({}) == {}
    assert norm(None) is None


# ── The ILIKE escape ─────────────────────────────────────────

def test_a_wildcard_typed_by_a_marketer_does_not_widen_the_segment():
    # "100%" is a company name, not a request for every company. Before the
    # escape, `company ILIKE '%100%%'` matched the whole org and the preview
    # reported the larger number as though it were the segment.
    assert prachar._like_escape("100%") == "100\\%"
    assert prachar._like_escape("a_b") == "a\\_b"
    # Backslash first, or escaping the wildcards doubles what this step added.
    assert prachar._like_escape("a\\%") == "a\\\\\\%"


def test_the_company_clause_carries_an_escape_and_the_query_drops_tombstones():
    src = _body(prachar._resolve_audience)
    assert "ESCAPE" in src, (
        "company ILIKE no longer declares an ESCAPE character, so a typed % is "
        "a wildcard again"
    )
    assert "merged_into_id IS NULL" in src, (
        "a merged duplicate is a tombstone that still holds the losing email — "
        "without this the same person receives the campaign twice"
    )


# ── The preview body ─────────────────────────────────────────

class _FakePool:
    """Just enough pool to drive the two helpers that take one."""

    def __init__(self, rows):
        self._rows = list(rows)
        self.queries = []

    async def fetch(self, q, *args):
        self.queries.append((q, args))
        return self._rows.pop(0)


CONTACTS = [
    {"id": "1", "name": "Aa", "email": "aa@example.com", "type": "customer", "company": "Acme"},
    {"id": "2", "name": "Bb", "email": "BB@example.com", "type": "customer", "company": "Acme"},
    {"id": "3", "name": "Cc", "email": "cc@example.com", "type": "customer", "company": "Acme"},
]


async def test_the_preview_separates_matched_from_who_will_receive():
    # A bare count is not something you can send on: "3 contacts" reads as three
    # emails, but /send silently drops the suppressed one and delivers two.
    pool = _FakePool([[{"email": "bb@example.com"}]])
    body = await prachar._audience_preview_body(pool, "org", {"type": "customer"}, CONTACTS)

    assert body["matched"] == 3
    assert body["count"] == body["matched"]      # campaign-send.spec.ts reads count
    assert body["unsubscribed"] == 1
    assert body["will_receive"] == 2
    assert body["truncated"] is False


async def test_the_preview_sample_never_lists_an_unsubscribed_address():
    # reach.spec.ts calls this "a legal problem, not a UX one". Case is
    # normalised on both sides, because the fixture's is not.
    pool = _FakePool([[{"email": "bb@example.com"}]])
    body = await prachar._audience_preview_body(pool, "org", {}, CONTACTS)

    listed = {c["email"].lower() for c in body["contacts"]}
    assert "bb@example.com" not in listed
    assert listed == {"aa@example.com", "cc@example.com"}


async def test_the_preview_reads_suppressions_the_way_send_does():
    # If the two ever read a different table or scope, the preview becomes a
    # promise the send does not keep.
    pool = _FakePool([[]])
    await prachar._audience_preview_body(pool, "org-1", {}, CONTACTS)
    q, args = pool.queries[0]
    assert "public.prachar_unsubscribes" in q
    assert "org_id=$1" in q
    assert args == ("org-1",)


# ── The summary sentence ─────────────────────────────────────
#
# THE THREE ASSERTIONS BELOW WERE REWORDED WHEN THE ICAI CLIENT GATE LANDED, and
# the reason matters more than the strings. `{}` used to mean every active
# contact in the org, and "everyone in this organisation" described that
# exactly. `audience_filter.client_only` now defaults ON, so `{}` resolves to
# contacts linked to a client — and the old sentence would have OVERSTATED the
# audience by precisely the people `/send` is about to refuse.
#
# This sentence is the last thing an operator reads before pressing send. An
# overstatement here is the most expensive kind of wrong copy in the module, so
# the tests were changed to follow the query rather than the query being bent to
# keep the tests green. See `services/prachar_compliance.py`.

def test_the_empty_filter_says_so_in_words():
    # The panel, the list column and the send confirmation all render this one
    # string, so the gate is stated rather than implied by a smaller number.
    assert prachar._audience_summary({}) == (
        "every contact linked to a client of this practice")


def test_turning_the_gate_off_is_shouted_rather_than_mentioned():
    # The one state `/send` will refuse. It reads as a warning because it is one.
    s = prachar._audience_summary({"client_only": False})
    assert "INCLUDING" in s and "not clients" in s


def test_the_summary_names_the_type_and_the_company():
    s = prachar._audience_summary({"type": "customer", "company": "acme"})
    assert s == ("customers who are linked to an existing client "
                 "and whose company matches “acme”")


def test_the_summary_of_a_type_alone_still_names_the_gate():
    # Not "leads" any more. A sentence that names the type but not the gate
    # describes an audience twice the size of the one the query returns.
    assert prachar._audience_summary({"type": "lead"}) == (
        "leads who are linked to an existing client")
