"""A GET must not write, and the two that do are named here with their reasons.

── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────

`GET /v1/ganit/expense-categories` INSERTed ten rows whenever the org had none,
so **merely opening the Expenses tab created data**. Three things were wrong
with that, and only the first is about HTTP:

  1. A GET must be safe. `frontend/src/lib/api.js` RETRIES a GET up to three
     times on 502/503/504 — precisely because repeating a read is supposed to
     cost nothing.
  2. **A member with no write permission created rows.** The module gate asks
     whether the org holds Ganit, not whether this person may write, so
     read-only access was enough to insert.
  3. Nothing could tell "the firm chose these ten categories" from "somebody
     opened the tab once".

⚠ **Proposal 93 Suite 05 found it on 2026-08-29 the way you would expect: a
read-only probe created them** — on a database production shares. That is the
sharpest form of the harm. A test that reads a screen is supposed to be able to
read a screen.

── WHY A LIST OF EXEMPTIONS AND NOT A BAN ──────────────────────────────────

Two GETs write on purpose, and both wrote their reasoning down before this test
existed. A rule that called them defects would be wrong, and a rule with no
exemptions would simply be deleted the first time it was inconvenient. So they
are named, with what they write and why — and anything NOT on the list fails.

The check reads string literals out of the AST rather than scanning source text.
The first version of this stripped every triple-quoted string as a "docstring",
and SQL here is written in triple quotes, so it silently skipped exactly the
statements it was looking for. Through the AST, a comment mentioning an INSERT
is invisible and an INSERT is not.

⚠ It is STATIC, like every other gate in this repo. It cannot see a write inside
a helper the handler calls — `test_every_writer_has_a_live_sql_test.py` and the
`prepare()` files are the other half. A green run means "no GET issues a write
statement in its own body", never "no GET writes".
"""
import ast
import pathlib
import re

import pytest

ROUTERS = pathlib.Path(__file__).resolve().parent.parent / "routers"

WRITE = re.compile(r"\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b", re.I)

#: The GETs that write on purpose. `handler name -> why`.
#:
#: Adding to this is a decision, not a formality: it says a read on this route
#: changes the database and that somebody chose that.
ALLOWED = {
    # `messaging.live` argues its own case at length in its docblock: the global
    # write rate limit allows 120 writes per client IP per minute, and a typing
    # indicator at a 3-second cadence is 20 a minute PER USER. Four colleagues
    # behind one office NAT would spend two-thirds of that office's whole write
    # budget on animated dots. What it writes is the caller's OWN presence and
    # typing row, keyed on their own user id — ephemeral session state, not
    # anybody's records — and it is deleted again when the composer goes quiet.
    "live": "presence and typing state, keyed on the caller's own user id",
    # `hub.get_or_create_org_client` creates ONE internal client row per org so
    # admins reach Sahayak without first inventing a customer for themselves.
    # It is a singleton and idempotent, so it cannot accumulate. Named rather
    # than fixed because moving it to org provisioning would strand every org
    # created before that hook existed — a real migration, not a rename.
    "get_or_create_org_client": "the org's single internal Sahayak client, idempotent",
}


def _get_handlers():
    """Every `@router.get` handler, with the write verbs in its own body."""
    for f in sorted(ROUTERS.glob("*.py")):
        try:
            tree = ast.parse(f.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a broken router fails elsewhere
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not any(
                isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                and d.func.attr == "get"
                and isinstance(d.func.value, ast.Name) and d.func.value.id == "router"
                for d in node.decorator_list
            ):
                continue
            doc = ast.get_docstring(node)
            verbs = set()
            for sub in ast.walk(node):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                    if doc is not None and sub.value == doc:
                        continue
                    for m in WRITE.finditer(sub.value):
                        verbs.add(m.group(1).split()[0].upper())
            yield f.name, node.name, node.lineno, verbs


def test_no_unnamed_get_handler_writes():
    offenders = [
        f"  {f}:{line}  {fn}  issues {','.join(sorted(v))}"
        for f, fn, line, v in _get_handlers()
        if v and fn not in ALLOWED
    ]
    assert not offenders, (
        "these GET handlers write, and none of them says why:\n"
        + "\n".join(offenders)
        + "\n\nA GET must be safe: `lib/api.js` retries one up to three times on "
          "502/503/504, a module gate is not a write permission, and a read-only "
          "probe must be able to read. `GET /v1/ganit/expense-categories` "
          "inserted ten rows on an empty org until 2026-08-29 — opening the "
          "Expenses tab created data.\n"
          "If the write is genuinely intended, add the handler to ALLOWED in "
          "this file WITH ITS REASON."
    )


def test_the_expense_category_list_is_the_one_that_was_fixed():
    """Named explicitly, because this is the one that had been writing."""
    import routers.ganit as ganit

    src = "".join(
        n.value for node in ast.walk(ast.parse(pathlib.Path(ganit.__file__).read_text(encoding="utf-8")))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == "list_expense_categories"
        for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)
    )
    assert "INSERT INTO" not in src.upper(), (
        "GET /v1/ganit/expense-categories is inserting again. The category list "
        "is a picker of NAMES — `ganit_expenses.category` is a text column, not "
        "a foreign key — so an unstored default serves the picker perfectly and "
        "the POST materialises the set on the day somebody edits it."
    )


def test_the_defaults_are_a_union_not_a_fallback():
    """Returning defaults only when the table is empty is a different bug.

    A firm that adds its first custom category would watch all ten defaults
    vanish. Writing them was how the old code avoided that; a union is how this
    one does.
    """
    import inspect

    import routers.ganit as ganit

    src = inspect.getsource(ganit.list_expense_categories)
    assert "if name not in have" in src, (
        "the defaults are no longer unioned with the stored rows, so a firm's "
        "first custom category makes the other ten disappear"
    )


@pytest.mark.parametrize("handler", sorted(ALLOWED))
def test_every_exemption_still_exists_and_still_writes(handler):
    """An exemption for a handler that no longer writes is a stale permission."""
    found = [(fn, v) for _f, fn, _l, v in _get_handlers() if fn == handler]
    assert found, f"ALLOWED names {handler}, which is no longer a GET handler"
    assert found[0][1], (
        f"{handler} no longer writes, so its exemption is stale — remove it from "
        f"ALLOWED rather than leaving a permission nobody needs"
    )
