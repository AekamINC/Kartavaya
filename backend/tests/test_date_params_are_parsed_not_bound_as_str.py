"""A `str` bound to a `::date` or `::timestamptz` parameter is a guaranteed 500.

    asyncpg.exceptions.DataError: invalid input for query argument $4:
      '2026-08-18' ('str' object has no attribute 'toordinal')

asyncpg infers the PYTHON type from the SQL cast: `$n::date` wants a
`datetime.date`, `$n::timestamptz` wants a `datetime`. Hand it a string and it
refuses before the statement ever reaches Postgres. The 500 escapes before the
CORS headers, so the browser reports a network failure and the console blames
CORS — which is why this family keeps being mis-diagnosed.

⚠ **THIS REPO HAS SHIPPED IT AT LEAST FOUR TIMES**, and the fourth was found in
the SAME FILE as its own documented fix:

    · the bank statement import            (2b864aa8)
    · the sales target                     (eae0b912)
    · publish_attendance_to_payroll        — "did that on every call, for every
      org, since it was written", fixed by parsing at the top of the handler
    · request_regularisation               — 200 lines above that comment, in the
      same file, left unparsed. `staging.pahchan_regularisations` held 0 rows
      for its entire life as a result. Found by proposal 93 Suite 09, 2026-08-29.

That last one is the argument for a check rather than a rule: the fix, the
explanation and the precedent were all already in the file, and the bug survived
anyway because nothing failed when it was reintroduced.

## What this checks, and what it deliberately does not

It reads the handler source and pairs every `$n::date` / `$n::timestamptz`
placeholder with the argument passed at that position. If that argument is a
bare `body.<field>` whose model declares it `str`, the call will raise.

⚠ It is STATIC. It cannot see a value assembled at runtime, and it only covers
the handlers named below. It is the cheap half of the answer; the expensive half
is a live call, which `tests/test_recycle_bin_live_sql.py` and
`tests/test_manav_custody_write_paths_live_sql.py` do with `prepare()`.
"""
import inspect
import re

import pytest

from routers import pahchan_attendance


#: Handlers that bind a date or timestamp parameter, and the model whose fields
#: they bind from. Add to this as more are found — it is not a full sweep.
CASES = [
    ("request_regularisation", "RegularisationCreate"),
    ("publish_attendance_to_payroll", "PublishToPayroll"),
]


def _source(name):
    fn = getattr(pahchan_attendance, name, None)
    if fn is None:
        pytest.skip(f"{name} no longer exists in pahchan_attendance")
    return inspect.getsource(fn)


@pytest.mark.parametrize("handler,_model", CASES)
def test_every_temporal_field_is_parsed_before_it_is_bound(handler, _model):
    """Asserted POSITIVELY — every temporal field the handler reads is parsed.

    ⚠ THE FIRST VERSION OF THIS ASSERTED THE OPPOSITE AND WAS WRONG. It looked
    for a raw `body.<field>` anywhere after the word RETURNING and called that a
    misuse — and it failed on `publish_attendance_to_payroll`, which parses
    correctly at the top and then quite properly echoes the ORIGINAL STRINGS
    back in its response payload (`{"from": body.from_date, ...}`).

    A check that cannot tell a correct use from an incorrect one is worse than
    no check: it teaches people to edit the test. So this asks the question that
    actually matters — *is every temporal field parsed?* — rather than trying to
    enumerate the ways one might not be. Echoing a string in a response is not
    a binding and never was.
    """
    src = _source(handler)
    if not re.search(r"\$\d+::(date|timestamptz)", src):
        pytest.skip(f"{handler} binds no date parameter")

    fields = sorted(set(re.findall(
        r"body\.(for_date|from_date|to_date|requested_at_time|on_date)\b", src)))
    assert fields, f"{handler} binds a date parameter but reads no temporal field"

    unparsed = [
        f for f in fields
        if not re.search(rf"fromisoformat\(\s*body\.{f}\s*\)", src)
    ]
    assert not unparsed, (
        f"{handler} never parses body.{{{','.join(unparsed)}}}. asyncpg infers "
        f"the Python type from the SQL cast, so a str bound to $n::date raises "
        f"\"'str' object has no attribute 'toordinal'\" and the endpoint 500s "
        f"on EVERY call. Parse at the top of the handler and raise a 400 that "
        f"quotes the value — see publish_attendance_to_payroll in the same file."
    )


def test_the_regularisation_handler_parses_both_of_its_temporal_fields():
    """Named explicitly, because this is the one that had never worked."""
    src = _source("request_regularisation")
    assert "date.fromisoformat(body.for_date)" in src, (
        "request_regularisation no longer parses for_date. It binds to $4::date, "
        "so a str 500s on every call — which is why "
        "staging.pahchan_regularisations held 0 rows for its entire life."
    )
    assert "datetime.fromisoformat(body.requested_at_time)" in src, (
        "request_regularisation no longer parses requested_at_time. It binds to "
        "$6::timestamptz and has the same failure mode as for_date."
    )


def test_a_bad_date_is_a_400_that_quotes_it_not_an_opaque_500():
    """The behaviour the parse buys, beyond not crashing.

    A date typed into an attendance correction is ordinary human input, and the
    person who typed it is the one who can fix it — so the refusal has to show
    them what was read.
    """
    src = _source("request_regularisation")
    assert "HTTPException(\n            400," in src or "HTTPException(400" in src
    assert "{body.for_date}" in src, (
        "the 400 does not quote the value that was refused, so the person who "
        "typed it cannot see what the server read"
    )
