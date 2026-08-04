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
    for fn in (prachar.preview_audience, prachar.send_campaign):
        assert "_resolve_audience(" in inspect.getsource(fn), (
            f"{fn.__name__} no longer resolves its audience through the shared "
            f"helper, so the two can disagree about who receives a campaign"
        )
