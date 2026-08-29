"""Prachar's four `::timestamptz` binds, against the real catalogue.

Found by proposal 93 Suite 11 on 2026-08-29, from the Railway deploy log:

    2026-08-29 08:23:51 - ERROR - Unhandled error on POST /api/v1/prachar/campaigns
      File "/app/routers/prachar.py", line 607, in create_campaign
    asyncpg.exceptions.DataError: invalid input for query argument $8:
      '2026-08-30T08:00:00.000Z' (expected a datetime.date or
      datetime.datetime instance, got 'str')

── THE FIFTH SHIPPED INSTANCE OF THIS REPO'S SIGNATURE FAILURE ──────────────

`tests/test_date_params_are_parsed_not_bound_as_str.py` documents the first
four: the bank statement import (`2b864aa8`), the sales target (`eae0b912`),
`publish_attendance_to_payroll`, and `request_regularisation` — that last one
reintroduced 200 lines above the comment explaining it. **That file names two
handlers in `routers/pahchan_attendance` and cannot see any other router**, and
its own docstring says so: *"it only covers the handlers named below. It is the
cheap half of the answer."*

So four call sites in ONE router survived, all of them in `routers/prachar.py`:

    create_campaign   $8::timestamptz          <- body.scheduled_at (str)
    update_campaign   scheduled_at=$n::timestamptz
    create_event      $7::timestamptz          <- body.starts_at   (str)
    update_event      starts_at / ends_at =$n::timestamptz

── WHAT IT COST, MEASURED ───────────────────────────────────────────────────

`CampaignsTab.jsx` ALWAYS sends `scheduled_at`, and `EventCreate.starts_at` is
required by the model and by the form. So a campaign carrying a date and an
event of any kind could never be created by anybody, in any organisation, since
the module was written. Live on 2026-08-29 before the fix:

    staging.prachar_campaigns   1 row   in the whole database
    staging.prachar_events      0 rows  in the whole database

That is the consequence rather than a coincidence beside it. It is also why the
CAMPAIGN CALENDAR — the surface this module is built around, and the one
irreducible question it answers, *what goes out and when* — has never had a
single pill on it.

⚠ And it makes a comment at the head of `frontend/src/pages/prachar/CampaignsTab.jsx`
false: *"`PATCH /campaigns/{id}` has always accepted a new `scheduled_at`, so
every part of the reference screen was already backed by the API — nothing here
is a mock, and the drag writes through."* The drag raised the same DataError on
every drop.

── WHAT THIS FILE CHECKS, IN THREE LAYERS ───────────────────────────────────

1. **Static, over the WHOLE router** rather than a hand-listed pair of handlers:
   every temporal bind in `routers/prachar.py` must go through `_ts`. That is
   the half that catches the SIXTH instance when somebody adds a fifth bind.
2. **Unit**, on `_ts` itself: the shapes the browser actually sends, and the
   400 that quotes a value it cannot read.
3. **Live SQL** — `prepare()` against the real catalogue, which is what proves
   the CAUSE rather than restating it. asyncpg reports the parameter types the
   SERVER inferred, so the assertion is that those positions really are
   `timestamptz` and a `str` really would be refused there.

── NOTHING IS EXECUTED ──────────────────────────────────────────────────────

`prepare()` sends Parse and Describe and STOPS. No `fetch`, `execute` or
`fetchval` is called on any handle, so no row is read and none is written —
which matters more here than almost anywhere, because staging and production
share one Supabase database.

Run the live half with:
    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_prachar_temporal_binds_live_sql.py -q
"""
import asyncio
import datetime as dt
import inspect
import os
import re

import pytest
from fastapi import HTTPException

import routers.prachar as prachar  # noqa: F401  (names the router for the ratchet)


#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL` is
#: never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection. Matched so a statement is planned the
#: way it will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. This file parses Prachar's temporal binds against the "
    "real catalogue and cannot be done offline — a MagicMock pool accepts a "
    "`str` where asyncpg refuses one, which is exactly how this shipped."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


# ── 1 · STATIC, OVER THE WHOLE ROUTER ────────────────────────────────────────

#: Every handler in `routers/prachar.py` that binds a temporal parameter.
#: Derived rather than listed, so a fifth one cannot be added without being
#: checked — which is the single thing the pahchan-only ratchet could not do.
def _handlers_binding_a_timestamp() -> list[tuple[str, str]]:
    out = []
    for name, fn in vars(prachar).items():
        # `_ts` is the parser itself and its docstring quotes the very cast this
        # looks for. Excluded BY NAME rather than by tightening the pattern to
        # "code only", because a pattern that tries to ignore comments is a
        # pattern that will one day ignore a real line.
        if name == "_ts":
            continue
        if not callable(fn) or not hasattr(fn, "__code__"):
            continue
        if getattr(fn, "__module__", "") != prachar.__name__:
            continue
        try:
            src = inspect.getsource(fn)
        except (OSError, TypeError):
            continue
        if re.search(r"::(date|timestamptz|timestamp)\b", src):
            out.append((name, src))
    return out


def test_the_router_still_binds_a_timestamp_somewhere():
    """A guard on the guard.

    If this router ever stops binding a temporal parameter the test below
    passes VACUOUSLY, and a vacuous green is how a gate nobody has seen fail
    becomes decoration. Fail loudly instead, so the file is deleted on purpose
    rather than kept as scenery.
    """
    found = _handlers_binding_a_timestamp()
    assert found, (
        "no handler in routers/prachar.py binds a ::date or ::timestamptz "
        "parameter any more. Either the module changed shape or this file is "
        "checking nothing — decide which, do not leave it green."
    )


@pytest.mark.parametrize(
    "handler", [n for n, _ in _handlers_binding_a_timestamp()])
def test_every_temporal_field_goes_through_the_parser(handler):
    """Asserted POSITIVELY — every temporal field the handler reads is parsed.

    ⚠ THE SISTER FILE'S FIRST VERSION ASSERTED THE OPPOSITE AND WAS WRONG. It
    looked for a raw `body.<field>` anywhere after RETURNING and called that a
    misuse, and failed on a handler that parses correctly and then quite
    properly echoes the ORIGINAL STRING back in its response payload. A check
    that cannot tell a correct use from an incorrect one teaches people to edit
    the test, which is how a real bug gets buried.

    So this asks the question that matters — *is every temporal field parsed
    before it is bound?* — rather than enumerating the ways one might not be.
    """
    src = dict(_handlers_binding_a_timestamp())[handler]

    fields = sorted(set(re.findall(
        r"body\.(scheduled_at|starts_at|ends_at|sent_at|expires_at)\b", src)))
    if not fields:
        pytest.skip(f"{handler} binds a timestamp from something other than the body")

    unparsed = [f for f in fields if not re.search(rf"_ts\(\s*body\.{f}\b", src)]
    assert not unparsed, (
        f"routers.prachar.{handler} binds body.{{{','.join(unparsed)}}} without "
        "`_ts(...)`. asyncpg infers the PYTHON type from the SQL cast, so a "
        "`str` against a `::timestamptz` parameter raises DataError before the "
        "statement reaches Postgres — an instant 500 that escapes before the "
        "CORS headers, which the browser reports as a network failure. This is "
        "the fifth shipped instance of that family in this repo."
    )


def test_nullif_is_not_used_to_launder_a_string_into_a_timestamp():
    """The trap that made two adjacent parameters behave differently.

    `create_event` used to bind `NULLIF($8,'')::timestamptz`. That spelling
    makes asyncpg infer `$8` as TEXT — it is compared to a text literal before
    the cast — so `ends_at` was the ONE temporal bind in this router a string
    did not break, while `$7::timestamptz` immediately beside it broke on every
    single call. Two neighbouring parameters behaving differently for a reason
    invisible at the call site is exactly how the next author copies the wrong
    one, so the spelling is banned rather than left as a curiosity.
    """
    src = inspect.getsource(prachar)
    offenders = re.findall(r"NULLIF\(\$\d+,\s*''\)::(?:timestamptz|date|timestamp)", src)
    assert not offenders, (
        "routers/prachar.py binds a timestamp through NULLIF($n,'')::timestamptz: "
        f"{offenders}. That makes asyncpg infer TEXT for that parameter, so it "
        "silently accepts a string while the parameter beside it refuses one. "
        "Pass None through `_ts()` instead — it binds as SQL NULL, which is what "
        "the NULLIF was there to produce."
    )


# ── 2 · UNIT, ON THE PARSER ──────────────────────────────────────────────────

def test_ts_accepts_the_shape_the_browser_actually_sends():
    """`new Date(x).toISOString()` — the exact string that produced the 500."""
    got = prachar._ts("2026-08-30T08:00:00.000Z", "the send date")
    assert isinstance(got, dt.datetime)
    assert got.tzinfo is not None, "a trailing Z must survive as UTC, not be dropped"
    assert got.utcoffset() == dt.timedelta(0)


def test_ts_accepts_an_offset_and_a_naive_timestamp():
    assert prachar._ts("2026-08-30T13:30:00+05:30", "x").utcoffset() == dt.timedelta(hours=5, minutes=30)
    assert prachar._ts("2026-08-30T09:00:00", "x").tzinfo is None


def test_absent_and_blank_both_mean_no_date():
    """Both reach this function from the product, and neither is an error.

    `CampaignsTab.save()` sends `scheduled_at: null` for an unset date and
    `EventsTab.save()` sends `ends_at: ''`. Returning None for both is what
    replaced the `NULLIF($n,'')` that used to launder the second one.
    """
    assert prachar._ts(None, "x") is None
    assert prachar._ts("", "x") is None
    assert prachar._ts("   ", "x") is None


def test_an_unreadable_value_is_a_400_that_quotes_it():
    """Not a 500, and not a silent NULL.

    A date chosen in a form is ordinary human input and the person who typed it
    is the one who can fix it — so the refusal names the value. A silent NULL
    would be worse than either: the campaign would save with no send date and
    the operator would never learn that the date they chose was discarded.
    """
    with pytest.raises(HTTPException) as e:
        prachar._ts("next tuesday", "the send date")
    assert e.value.status_code == 400
    assert "next tuesday" in str(e.value.detail)
    assert "the send date" in str(e.value.detail)


# ── 3 · LIVE SQL — the cause, against the real catalogue ─────────────────────

#: Composed exactly as `routers/prachar.py` composes them. The two UPDATEs are
#: built at call time from a list of fragments, so what is prepared here is the
#: shape the product actually sends when the date is the field being changed.
STATEMENTS: list[tuple[str, str, dict[int, str]]] = [
    (
        "create_campaign",
        "INSERT INTO public.prachar_campaigns "
        "(org_id, name, template_id, subject, body_html, channel, audience_filter, scheduled_at, created_by) "
        "VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb,$8::timestamptz,$9) RETURNING *",
        {8: "timestamptz"},
    ),
    (
        "update_campaign:scheduled_at",
        "UPDATE public.prachar_campaigns SET scheduled_at=$1::timestamptz, updated_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid RETURNING *",
        {1: "timestamptz"},
    ),
    (
        "create_event",
        "INSERT INTO public.prachar_events "
        "(org_id, title, description, event_type, location, location_url, "
        "starts_at, ends_at, max_attendees, registration_open, tags, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, "
        "$8::timestamptz, $9, $10, $11::jsonb, $12) RETURNING *",
        {7: "timestamptz", 8: "timestamptz"},
    ),
    (
        "update_event:starts_and_ends",
        "UPDATE public.prachar_events SET starts_at=$1::timestamptz, ends_at=$2::timestamptz, "
        "updated_at=NOW() WHERE id=$3::uuid AND org_id=$4::uuid AND is_active=TRUE RETURNING *",
        {1: "timestamptz", 2: "timestamptz"},
    ),
]


def _describe():
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, inferred = [], {}
            for label, sql, _want in STATEMENTS:
                try:
                    stmt = await conn.prepare(sql)
                    inferred[label] = [p.name for p in stmt.get_parameters()]
                except Exception as exc:                      # noqa: BLE001
                    failures.append((label, f"{type(exc).__name__}: {exc}"))
            cols = await conn.fetch(
                "SELECT table_name, column_name, data_type, is_nullable, column_default "
                "  FROM information_schema.columns "
                " WHERE table_schema = ANY(current_schemas(false)) "
                "   AND table_name IN ('prachar_campaigns','prachar_events')"
            )
            return failures, inferred, [dict(r) for r in cols]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    return _describe()


def test_every_statement_parses_against_the_real_schema(live):
    failures, _, _ = live
    assert not failures, "statements the live catalogue refuses:\n" + "\n".join(
        f"  {label}: {err}" for label, err in failures
    )


def test_the_server_really_infers_a_timestamp_for_those_parameters(live):
    """The CAUSE, read from the database rather than from the migration file.

    This is the assertion the whole finding rests on: asyncpg takes the Python
    type it will accept from the type the SERVER reports for each parameter. If
    these positions are `timestamptz`, then a `str` there is a guaranteed
    DataError — no MagicMock, no fixture and no unit test can contradict that,
    and none of them could catch it either.
    """
    _, inferred, _ = live
    problems = []
    for label, _sql, want in STATEMENTS:
        params = inferred.get(label)
        if params is None:
            continue
        for pos, expected in want.items():
            actual = params[pos - 1] if len(params) >= pos else "(absent)"
            if actual != expected:
                problems.append(f"  {label}: ${pos} is {actual}, expected {expected}")
    assert not problems, (
        "the parameter types the live server infers are not what this router "
        "assumes:\n" + "\n".join(problems)
    )


def test_the_columns_are_timestamps_and_a_campaign_may_have_no_date(live):
    """`prepare()` plans a statement that omits a NOT NULL column happily.

    So the catalogue is read as well — and the fact that matters is that
    `scheduled_at` and `ends_at` are NULLABLE. `_ts` returns None for a blank
    date and that None binds as SQL NULL; if either column were NOT NULL the
    parser's tolerance would turn a 500 into a different 500.
    """
    _, _, cols = live
    by = {(c["table_name"], c["column_name"]): c for c in cols}
    for key in [("prachar_campaigns", "scheduled_at"),
                ("prachar_events", "starts_at"),
                ("prachar_events", "ends_at")]:
        assert key in by, f"{key[0]}.{key[1]} is not in the live catalogue"
        assert "timestamp" in by[key]["data_type"], (
            f"{key[0]}.{key[1]} is {by[key]['data_type']}, not a timestamp")

    for key in [("prachar_campaigns", "scheduled_at"), ("prachar_events", "ends_at")]:
        assert by[key]["is_nullable"] == "YES", (
            f"{key[0]}.{key[1]} is NOT NULL, so `_ts` returning None for a blank "
            "date would fail the insert rather than mean 'no date'")
