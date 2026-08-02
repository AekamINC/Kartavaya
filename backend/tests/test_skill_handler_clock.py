"""
One clock for every skill handler, enforced.

This bug has now been found twice, weeks apart, in two files, because each
handler reached for `datetime.utcnow()` on its own:

  find_overdue    all five module specs — `datetime.utcnow() - row["due"]`,
                  raising on both the DATE columns and the timestamptz ones.
                  Found by reading the schema.
  score_deals     `(now - r["updated_at"]).days`. Found the hard way, on the
                  FIRST REAL SKILL RUN, 2026-08-02, recorded in the run row:
                    {"step": 1, "status": "failed",
                     "skill_function": "score_deals",
                     "error": "TypeError: can't subtract offset-naive and
                               offset-aware datetimes"}

Two occurrences of one mistake is a pattern, and a grep only finds what someone
thought to look for. This is the check instead: no skill handler may build its
own clock. `services/skills/timeutil.py` is the only place `utcnow()` is
allowed, and it does not use it either.

`datetime.utcnow()` is also deprecated in Python 3.12+ and scheduled for
removal, so this is not only a correctness gate.
"""
import ast
from pathlib import Path

import pytest

HANDLER_ROOT = Path(__file__).resolve().parent.parent / "services" / "skills"

#: The one module allowed to define the clock. It uses `datetime.now(timezone.utc)`
#: rather than `utcnow()`, so in practice nothing in the tree needs the banned call.
CLOCK_MODULE = "timeutil.py"


def _handler_files() -> list[Path]:
    return sorted(
        p for p in HANDLER_ROOT.rglob("*.py")
        if p.name != CLOCK_MODULE and "__pycache__" not in p.parts
    )


def test_there_are_handlers_to_check():
    """A path typo here would make every test below pass over an empty list —
    the classic way a guard reports green while guarding nothing."""
    files = _handler_files()
    assert len(files) >= 20, f"expected the handler tree, found {len(files)} files"


@pytest.mark.parametrize("path", _handler_files(), ids=lambda p: p.name)
def test_no_handler_builds_its_own_naive_clock(path: Path):
    """
    Parsed, not grepped. A string or a comment mentioning `datetime.utcnow()` is
    fine — the docstrings in overdue_finder.py and timeutil.py describe the bug
    at length and must not trip this — while a real CALL is not.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    offenders = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "utcnow"
    ]

    assert not offenders, (
        f"{path.name} calls datetime.utcnow() at line(s) {offenders}. "
        f"asyncpg returns AWARE datetimes for timestamptz, and naive minus aware "
        f"raises — this exact bug reached production twice. "
        f"Use services/skills/timeutil.utc_now() instead."
    )


@pytest.mark.parametrize("path", _handler_files(), ids=lambda p: p.name)
def test_no_handler_subtracts_datetimes_by_hand(path: Path):
    """
    The second half, and the one that actually bites.

    Avoiding `utcnow()` is not enough: `(a - b).days` on two values whose types
    came from different columns is the failure, whatever built them. Handlers
    must go through `days_between` / `hours_between`, which normalise both sides.

    Matches `(x - y).days` and `(x - y).total_seconds()` — the two shapes both
    real occurrences took.
    """
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))

    offenders = []
    for node in ast.walk(tree):
        # (a - b).days   /   (a - b).total_seconds()
        if isinstance(node, ast.Attribute) and node.attr in ("days", "total_seconds"):
            inner = node.value
            if isinstance(inner, ast.BinOp) and isinstance(inner.op, ast.Sub):
                offenders.append(node.lineno)

    assert not offenders, (
        f"{path.name} subtracts two datetimes by hand at line(s) {offenders}. "
        f"Use days_between()/hours_between() from services/skills/timeutil.py — "
        f"they normalise a DATE, an aware datetime and a naive datetime to the "
        f"same thing, which is what stops the TypeError."
    )


def test_the_clock_module_itself_does_not_use_the_banned_call():
    """timeutil is exempt from the parametrised checks, so it gets its own —
    otherwise the one file everything trusts is the one nothing verifies."""
    clock = HANDLER_ROOT / CLOCK_MODULE
    tree = ast.parse(clock.read_text(encoding="utf-8"), filename=str(clock))

    calls = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and n.func.attr == "utcnow"
    ]

    assert not calls, "timeutil.py must use datetime.now(timezone.utc)"
