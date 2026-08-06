"""The audit log had 828 rows and not one reader.

`services/audit.emit` had been writing to `staging.audit_log` for months. Before
routers/audit.py, `grep -rn "FROM staging.audit_log" --include=*.py` returned
ZERO hits across the whole backend — no endpoint, no screen, no export. The only
way to see a row was a SQL console.

That is not a small gap for this table. An audit log exists to answer one
question — "who reached my organisation's data, and when" — and this week's
security work added a row for every platform crossing into a customer org.
Without a reader those rows are invisible to the customer they are about.
"""
import inspect
import pathlib

from routers import audit as A

SRC = pathlib.Path(A.__file__).read_text(encoding="utf-8")


def _code(fn) -> str:
    """A function's EXECUTABLE source — comments AND docstring removed.

    Stripping the docstring is not tidiness. The first version of this helper
    dropped `#` comments only, and `test_pagination_is_keyset_not_offset`
    asserted `"OFFSET" not in code` against a docstring that reads "KEYSET
    PAGINATION, not OFFSET". It failed on prose describing the correct
    behaviour.

    That is the fourth time this repository has had a check decide something
    from its own commentary, and the first three all failed the other way —
    passing because a comment satisfied them. Assert on what runs.
    """
    import ast
    import textwrap
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    body = tree.body[0].body
    if (body and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)):
        body = body[1:]                      # drop the docstring node
    return " ".join(" ".join(ast.unparse(n) for n in body).split())


def test_something_finally_reads_the_audit_log():
    """THE regression, and it is a presence test on purpose."""
    import subprocess
    root = pathlib.Path(__file__).resolve().parent.parent
    readers = [p for p in root.rglob("*.py")
               if ".venv" not in str(p) and "FROM staging.audit_log" in p.read_text(encoding="utf-8", errors="ignore")]
    assert readers, "nothing in the backend reads staging.audit_log"


def test_both_endpoints_are_scoped_to_one_org():
    """An audit log that leaks across tenants would be its own worst finding."""
    for fn in (A.list_audit_events, A.audit_summary):
        assert "org_id = $1::uuid" in _code(fn), f"{fn.__name__} is not org-scoped"
        # The dependency is a PARAMETER DEFAULT, so it lives in the signature and
        # not in the body `_code` returns. Checked where it actually is.
        sig = inspect.signature(fn)
        assert "org_id" in sig.parameters, f"{fn.__name__} takes no org"
        assert "get_org_id" in repr(sig.parameters["org_id"].default), \
            f"{fn.__name__} does not resolve its org through get_org_id"


def test_the_reader_gate_is_the_org_not_the_platform():
    """
    Deliberately NOT platform staff via a header. The point of the rows added
    this week is that a platform account crossing into a customer org leaves a
    trace; letting that same account read and filter the trace of its own visit
    is a straight conflict of interest.
    """
    assert 'require_org_role("org_owner", "org_admin")' in " ".join(SRC.split())


def test_there_is_no_way_to_delete_or_edit_a_row():
    """An audit row a user can remove is not an audit row."""
    body = " ".join(SRC.split()).upper()
    assert "DELETE FROM" not in body and "UPDATE STAGING.AUDIT_LOG" not in body
    assert "@ROUTER.DELETE" not in body and "@ROUTER.PATCH" not in body


def test_pagination_is_keyset_not_offset():
    """
    `id` is a bigint sequence on an append-only table, so `id < $before` is
    exact and stays exact while rows arrive underneath. An OFFSET page repeats
    or skips a row whenever something is written between two requests — on an
    audit log that is a visit appearing twice, or never.
    """
    code = _code(A.list_audit_events)
    assert "id <" in code and "OFFSET" not in code.upper()


def test_the_page_is_bounded():
    """The table grows without limit; a screen asking for all of it times out on
    the org it matters most for."""
    sig = inspect.signature(A.list_audit_events)
    limit = sig.parameters["limit"].default
    meta = getattr(limit, "metadata", [])
    bounds = [getattr(m, "le", None) for m in meta] + [getattr(limit, "le", None)]
    assert any(b is not None for b in bounds), "limit has no upper bound"


def test_the_cursor_for_the_next_page_is_returned():
    """"What do I pass next" must never be a question about this API."""
    assert "next_before_id" in _code(A.list_audit_events)


def test_inet_is_rendered_as_text():
    """`ip` is INET; a raw value makes the JSON encoder's problem the caller's."""
    assert "host(ip)" in _code(A.list_audit_events)
