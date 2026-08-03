"""Bank statement import — an endpoint that had never once succeeded.

`ganit_bank_statement_lines.batch_id` is a **uuid** column. The importer wrote
`f"BSI-{timestamp}"` into it — `BSI-20260803153000`, not a UUID — so asyncpg
refused the very first INSERT and the route 500'd on every call, for every org,
since it was written.

What made it survive so long is how it FAILED IN THE BROWSER. FastAPI's CORS
middleware does not attach `Access-Control-Allow-Origin` to an unhandled 500, so
Chrome reported:

    Access to XMLHttpRequest ... has been blocked by CORS policy:
    No 'Access-Control-Allow-Origin' header is present

The console blamed CORS, the network tab showed a failed request with no body,
and the screen showed nothing at all. Anybody debugging it starts on the CORS
configuration, which is correct — the preflight returns 200 with every header.

Found by clicking Import in a Playwright run and reading what the page actually
did, which is the only vantage point from which "no request, no error, no toast"
resolves into "the server threw".
"""
import re
import uuid
from datetime import date

import pytest

import routers.ganit as ganit


def test_the_batch_id_is_a_uuid_not_a_label():
    """The exact regression. A prefixed timestamp cannot go in a uuid column."""
    src = ganit.import_bank_statement.__wrapped__.__code__ if hasattr(
        ganit.import_bank_statement, "__wrapped__") else None
    import inspect
    text = inspect.getsource(ganit.import_bank_statement)
    assert 'f"BSI-' not in text, "the batch id is a formatted string again"
    assert "uuid4()" in text
    assert "$7::uuid" in text, "the insert must cast the batch id"


def test_every_batch_id_use_casts_to_uuid():
    """A missing cast on the follow-up SELECT fails the same way, later."""
    import inspect
    text = inspect.getsource(ganit.import_bank_statement)
    for frag in re.findall(r"batch_id=\$\d+", text):
        idx = text.index(frag)
        assert text[idx + len(frag):idx + len(frag) + 6] == "::uuid", \
            f"{frag} is compared without a uuid cast"


def test_a_bad_date_is_named_rather_than_thrown():
    """A pasted statement is hand-assembled; a bad date is ordinary input.

    `date.fromisoformat` raised ValueError straight out of the handler, which is
    another 500 that reaches the browser as a CORS error. It now says which row.
    """
    import inspect
    text = inspect.getsource(ganit.import_bank_statement)
    assert "except ValueError" in text
    assert "YYYY-MM-DD" in text


def test_the_batch_label_is_returned_rather_than_dropped():
    """The form collects a label and the table has no column for it. Echoing it
    back is honest; swallowing it silently is what makes a field feel broken."""
    import inspect
    text = inspect.getsource(ganit.import_bank_statement)
    assert '"batch_label": body.batch_label' in text


@pytest.mark.asyncio
async def test_the_import_inserts_every_line_and_reports_the_count(monkeypatch):
    """End to end over a fake pool: the values that reach SQL are the values
    that came in, and `batch_id` is a real UUID object."""
    inserted = []
    captured = {}

    class _Pool:
        async def execute(self, q, *a):
            if "INSERT INTO staging.ganit_bank_statement_lines" in q:
                inserted.append(a)
                captured["batch"] = a[6]

        async def fetch(self, *a, **k):
            return []

        async def fetchrow(self, *a, **k):
            return None

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(ganit, "get_pool", _get_pool)

    body = ganit.BankStatementImport(
        batch_label="HDFC Aug-2026",
        lines=[
            ganit.BankStatementLine(statement_date="2026-08-01", description="Client receipt",
                                    reference="UTR1", amount=59000, running_balance=659000),
            ganit.BankStatementLine(statement_date="2026-08-02", description="Bank charges",
                                    reference="CHG1", amount=-236, running_balance=658764),
        ],
    )
    out = await ganit.import_bank_statement(body, user={"user_id": "u1"}, org_id="org1")

    assert out["imported"] == 2
    assert out["batch_label"] == "HDFC Aug-2026"
    uuid.UUID(out["batch_id"])                     # parses, or this raises
    assert isinstance(captured["batch"], uuid.UUID)
    # Signs survive: a credit and a debit are not the same row.
    assert inserted[0][4] == 59000
    assert inserted[1][4] == -236
    assert inserted[0][1] == date(2026, 8, 1)


@pytest.mark.asyncio
async def test_a_malformed_date_is_a_400_not_a_500(monkeypatch):
    class _Pool:
        async def execute(self, *a, **k): ...
        async def fetch(self, *a, **k): return []
        async def fetchrow(self, *a, **k): return None

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(ganit, "get_pool", _get_pool)

    body = ganit.BankStatementImport(lines=[
        ganit.BankStatementLine(statement_date="01/08/2026", description="Client receipt",
                                amount=100),
    ])
    with pytest.raises(ganit.HTTPException) as e:
        await ganit.import_bank_statement(body, user={"user_id": "u1"}, org_id="org1")
    assert e.value.status_code == 400
    assert "01/08/2026" in e.value.detail
    assert "Client receipt" in e.value.detail, "name the row that is wrong"


@pytest.mark.asyncio
async def test_an_empty_import_is_refused(monkeypatch):
    async def _get_pool():
        raise AssertionError("an empty import must be refused before touching the database")

    monkeypatch.setattr(ganit, "get_pool", _get_pool)
    with pytest.raises(ganit.HTTPException) as e:
        await ganit.import_bank_statement(
            ganit.BankStatementImport(lines=[]), user={"user_id": "u1"}, org_id="org1")
    assert e.value.status_code == 400
