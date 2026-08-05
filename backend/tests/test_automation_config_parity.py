"""
The builder and the engine must agree on the config key names.

This is the check that did not exist, which is why five of six automation
actions shipped broken and looked healthy. Both halves compiled, both halves
passed their own tests, and nothing anywhere compared

    frontend/src/pages/automations/actionConfig.js   (what the builder WRITES)
    backend/services/automation_engine.py            (what the engine READS)

A mismatch between them cannot raise: `cfg.get("body", "")` finds nothing,
returns the default, and the action reports success. The only way to catch it
is to read both sides and compare, so that is what this does.

Three sets are compared, not two:

    1. the keys the frontend table declares it may emit
    2. the keys ACTION_CONFIG in the engine DECLARES it reads
    3. the keys the engine's action branches ACTUALLY read, parsed out of the
       source as `cfg["x"]` / `cfg.get("x")`

(2) and (3) are both here on purpose. A declared spec that has drifted from the
code it describes is the same bug wearing a different hat — the contract would
look satisfied while the branch reached for something else.

COMMENTS AND DOCSTRINGS ARE STRIPPED BEFORE ANY OF THIS. Four checks in this
repo have shipped satisfied by their own commentary, and this file is a prime
candidate: automation_engine.py's comments quote the very `cfg.get(...)` calls
they were written to explain, and actionConfig.js's header quotes the old
builder's `cfg.message = text`. Parsing the raw text would let a fix that only
edits the prose keep this green.
"""
import ast
import io
import re
import tokenize
from pathlib import Path

import pytest

from services.automation_engine import ACTION_CONFIG

_REPO = Path(__file__).resolve().parents[2]
ENGINE_PY = _REPO / "backend" / "services" / "automation_engine.py"
BUILDER_JS = _REPO / "frontend" / "src" / "pages" / "automations" / "actionConfig.js"

# The six actions, written out literally. NOT derived from either side — a list
# computed from one of the things under comparison cannot notice that side
# gaining or losing an entry, and "forbidden = everything minus allowed" is
# exactly the shape of check that fails to see the allowed set widen.
ACTION_TYPES = [
    "send_email",
    "send_notification",
    "set_field",
    "change_status",
    "assign_to",
    "post_comment",
]


# ── source readers ────────────────────────────────────────────────────────────

def _python_without_comments(src: str) -> str:
    """
    Blank every `#` comment and every docstring, preserving line structure so
    offsets stay readable if this ever needs debugging.
    """
    lines = src.splitlines(keepends=True)

    def blank(srow, scol, erow, ecol):
        if srow == erow:
            line = lines[srow - 1]
            lines[srow - 1] = line[:scol] + " " * (ecol - scol) + line[ecol:]
        else:
            lines[srow - 1] = lines[srow - 1][:scol] + "\n"
            for r in range(srow, erow - 1):
                lines[r] = "\n"
            lines[erow - 1] = lines[erow - 1][ecol:]

    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.COMMENT:
            blank(tok.start[0], tok.start[1], tok.end[0], tok.end[1])

    # Docstrings are strings, not comments, so tokenize leaves them alone.
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                s = body[0].value
                blank(s.lineno, s.col_offset, s.end_lineno, s.end_col_offset)

    return "".join(lines)


def _js_without_comments(src: str) -> str:
    src = re.sub(r"/\*[\s\S]*?\*/", " ", src)
    return re.sub(r"(?m)//.*$", " ", src)


# ── (3) what the engine's branches actually read ──────────────────────────────

_CFG_READ = re.compile(r"""cfg(?:\.get\(\s*|\[\s*)['"]([A-Za-z_][A-Za-z0-9_]*)['"]""")
_BRANCH = re.compile(r"""(?:el)?if\s+action_type\s*==\s*['"]([a-z_]+)['"]\s*:""")


def engine_keys_actually_read() -> dict[str, set[str]]:
    """
    Slice run_automation's if/elif chain into per-action branches and collect the
    config keys each one reads. Comments are already gone by the time this runs.
    """
    src = _python_without_comments(ENGINE_PY.read_text(encoding="utf-8"))
    marks = [(m.start(), m.group(1)) for m in _BRANCH.finditer(src)]
    assert marks, "no `if action_type == ...` branches found — the parser is broken, not the engine"

    out: dict[str, set[str]] = {}
    for i, (pos, action) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(src)
        out[action] = set(_CFG_READ.findall(src[pos:end]))
    return out


# ── (1) what the builder declares it writes ───────────────────────────────────

def builder_keys_declared() -> dict[str, set[str]]:
    src = _js_without_comments(BUILDER_JS.read_text(encoding="utf-8"))
    block = re.search(r"export const ACTION_CONFIG_KEYS\s*=\s*\{(.*?)\n\};", src, re.S)
    assert block, "ACTION_CONFIG_KEYS not found in actionConfig.js"
    out: dict[str, set[str]] = {}
    for name, arr in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[([^\]]*)\]", block.group(1)):
        out[name] = set(re.findall(r"['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]", arr))
    return out


def builder_required_declared() -> dict[str, set[str]]:
    src = _js_without_comments(BUILDER_JS.read_text(encoding="utf-8"))
    block = re.search(r"export const ACTION_REQUIRED_KEYS\s*=\s*\{(.*?)\n\};", src, re.S)
    assert block, "ACTION_REQUIRED_KEYS not found in actionConfig.js"
    out: dict[str, set[str]] = {}
    for name, arr in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[([^\]]*)\]", block.group(1)):
        out[name] = set(re.findall(r"['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]", arr))
    return out


# ── the parser must not be able to pass by finding nothing ────────────────────

def test_both_files_exist_and_parse():
    """
    A parity check that silently parses zero keys agrees with everything. These
    four assertions are the floor under every test below.
    """
    assert ENGINE_PY.is_file(), ENGINE_PY
    assert BUILDER_JS.is_file(), BUILDER_JS

    read = engine_keys_actually_read()
    declared = builder_keys_declared()

    assert set(read) == set(ACTION_TYPES), f"engine branches found: {sorted(read)}"
    assert set(declared) == set(ACTION_TYPES), f"builder entries found: {sorted(declared)}"
    for action in ACTION_TYPES:
        assert read[action], f"{action}: parsed no cfg reads out of the engine"
        assert declared[action], f"{action}: parsed no keys out of the builder"


def test_comment_stripping_actually_strips():
    """
    The whole file rests on this. `automation_engine.py` quotes `cfg.get(...)`
    inside the comments explaining the bug, so a stripper that does nothing
    would still make the tests below pass today and would stop noticing a real
    rename tomorrow.
    """
    sample = 'x = 1  # cfg.get("ghost_key")\ndef f():\n    """cfg["other_ghost"]"""\n    return cfg.get("real")\n'
    stripped = _python_without_comments(sample)
    assert "ghost_key" not in stripped
    assert "other_ghost" not in stripped
    assert 'cfg.get("real")' in stripped

    js = '// ACTION_CONFIG_KEYS = { fake: ["ghost"] }\n/* also ["ghost2"] */\nconst real = 1;\n'
    assert "ghost" not in _js_without_comments(js)
    assert "real" in _js_without_comments(js)

    # And on the real file: the engine's prose mentions keys, and after
    # stripping, the parsed sets must not contain anything the prose invented.
    raw = ENGINE_PY.read_text(encoding="utf-8")
    assert "#" in raw and '"""' in raw, "engine has no comments — this guard has nothing to prove"


def test_a_key_that_exists_only_in_prose_is_not_counted():
    """
    Stripping is made LOAD-BEARING here rather than merely present.

    The previous test proves the stripper works on a toy string; this one proves
    the real parser depends on it. It takes the actual engine source, plants
    `cfg.get("ghost_key")` inside a comment in the post_comment branch and
    `cfg["ghost_three"]` inside a function docstring that lands in the same
    slice, re-parses, and requires the answer not to move. Neuter either
    stripper and this goes red — which is what stops this file from ever joining
    the four checks in this repo that were satisfied by their own commentary.

    NOT tested, because it is not true: a string LITERAL in running code is not
    stripped, and must not be — the keys themselves are string literals, so a
    stripper that removed them would parse nothing and agree with everything.
    """
    src = ENGINE_PY.read_text(encoding="utf-8")
    anchor = '            elif action_type == "post_comment":\n'
    assert anchor in src, "the post_comment branch moved; update this test's anchor"
    poisoned = src.replace(
        anchor,
        anchor + '                # a comment mentioning cfg.get("ghost_key") and cfg["ghost_two"]\n',
        1,
    )
    # Appended at the end of the file, which is inside post_comment's slice —
    # its branch is the last one, so it runs to EOF.
    poisoned += '\n\ndef _planted():\n    """cfg["ghost_three"] and cfg.get("ghost_four")"""\n    return None\n'

    stripped = _python_without_comments(poisoned)
    for ghost in ("ghost_key", "ghost_two", "ghost_three", "ghost_four"):
        assert ghost not in stripped, f"{ghost} survived comment stripping"

    marks = [(m.start(), m.group(1)) for m in _BRANCH.finditer(stripped)]
    keys = {}
    for i, (pos, action) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(stripped)
        keys[action] = set(_CFG_READ.findall(stripped[pos:end]))

    assert keys["post_comment"] == engine_keys_actually_read()["post_comment"], (
        "prose changed the parsed key set — the parity check is reading comments"
    )


# ── the comparison itself ─────────────────────────────────────────────────────

@pytest.mark.parametrize("action", ACTION_TYPES)
def test_builder_writes_exactly_what_the_engine_reads(action):
    """
    THE CHECK. Every key the builder may write is read by the engine, and every
    key the engine reads can be written by the builder.

    Equality rather than a subset in either direction:
      · a key the builder writes and the engine ignores is the original bug —
        it goes into the database, does nothing, and reports success;
      · a key the engine reads and the builder cannot write is a feature that
        exists in the backend and is unreachable from the product, which is how
        `to`, `user_ids`, `field_id` and `body` came to be unreachable in the
        first place.

    What the mismatch looked like on 2026-08-05, before this was fixed:

        action             builder wrote      engine read
        ---------------    ---------------    ---------------------------
        send_email         message            to (required), subject, html
        send_notification  message            user_ids, title, message
        set_field          value              field_id, value
        change_status      status             status                 ← agreed
        assign_to          value              user_ids
        post_comment       message            body
    """
    written = builder_keys_declared()[action]
    read = engine_keys_actually_read()[action]
    assert written == read, (
        f"{action}: builder writes {sorted(written)}, engine reads {sorted(read)}; "
        f"unread by the engine: {sorted(written - read)}; "
        f"unreachable from the builder: {sorted(read - written)}"
    )


@pytest.mark.parametrize("action", ACTION_TYPES)
def test_the_engines_declared_spec_matches_its_own_code(action):
    """
    ACTION_CONFIG is what the gate validates against; the branch below it is
    what actually runs. If they drift, the gate passes a config the branch
    cannot use — the same silence, self-inflicted.
    """
    declared = set(ACTION_CONFIG[action]["reads"])
    read = engine_keys_actually_read()[action]
    assert declared == read, (
        f"{action}: ACTION_CONFIG declares {sorted(declared)}, the branch reads {sorted(read)}"
    )


@pytest.mark.parametrize("action", ACTION_TYPES)
def test_both_sides_agree_on_what_is_required(action):
    """
    The builder blocks Create on its own required list; the engine refuses to run
    on its own. If the builder's list is the shorter one it saves rules that can
    never fire — which is precisely the state the product was in.
    """
    assert builder_required_declared()[action] == set(ACTION_CONFIG[action]["required"])


def test_the_action_list_itself_has_not_drifted():
    """
    Adding a seventh action to one side only would leave the parametrised tests
    above passing on six and blind to the new one.
    """
    assert set(ACTION_CONFIG) == set(ACTION_TYPES)
    assert set(builder_keys_declared()) == set(ACTION_TYPES)
    assert set(builder_required_declared()) == set(ACTION_TYPES)

    # And the router's allow-list, which is the third place the six are named.
    from routers.automations import VALID_ACTIONS
    assert VALID_ACTIONS == set(ACTION_TYPES)
