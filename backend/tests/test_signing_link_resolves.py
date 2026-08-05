"""The link in a signature request must resolve to the row that was written.

── The defect this file exists for ──────────────────────────────────────────

A Ganit contract sent for signature emailed the signer
`{FRONTEND_URL}/sign/{token}`. That is a frontend route, served by
`SigningPage`, which asks `GET /api/v1/esign/verify/{token}` — an endpoint that
reads `staging.sign_signers`. The token had been written to
`staging.ganit_contract_signers`. The signer was told "Invalid signing link" and
could never sign, for as long as the feature had existed: measured on the shared
staging/production database on 2026-08-05, `ganit_contract_signers` had never
held a single row, while `sign_signers` held 101 with 44 signed.

Nothing failed. Both halves were individually correct code against individually
real tables, the send returned 200, the signer rows existed, and the audit trail
recorded a signature request. Only the JOIN between the two halves — a URL — was
wrong, and no test in the suite crossed it. `test_esign_signing_links.py` proved
each signer got their OWN token; it could not prove the token led anywhere.

── Why this is a source-level check and not an integration test ─────────────

The pool is mocked throughout this suite and resolves any table name it is
handed (`routers/messaging.py:30-41` records a module that answered 500 against
a real database with the suite green). So "the write and the read agree about
the table" cannot be established by running the code: a fake pool would answer
both. It CAN be established by reading what the two halves say, which is what
this does.

── Why every source read here is stripped first ─────────────────────────────

`_stripped_fn` unparses the AST, which cannot emit a comment, and drops the
docstring. `_strip_js` runs a scanner that knows the difference between a
comment and a string.

This is not fastidiousness. This repo has shipped four checks that were
satisfied by their own commentary — `inspect.getsource` returns the comments
with the code, and a grep matches the sentence explaining what it greps for. The
files under test here are among the most heavily commented in the codebase and
BOTH table names appear in prose in both of them, several times, including in
the very paragraphs describing this bug. An unstripped assertion would pass
against the broken code it was written to catch.
"""
import ast
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent

ESIGN_SERVICE = BACKEND / "services" / "esign_service.py"
ESIGN_ROUTER = BACKEND / "routers" / "esign.py"
APP_JSX = REPO / "frontend" / "src" / "App.jsx"


# ── Source readers ───────────────────────────────────────────────────────────

def _module(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _stripped_fn(path: Path, name: str) -> str:
    """One function's source with every comment and its docstring removed.

    `ast.unparse` regenerates code from the tree, and the tree has no comments
    in it at all — they are discarded by the tokenizer before parsing. The
    docstring survives as the first statement, so it is popped explicitly.
    """
    for node in ast.walk(_module(path)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            body = list(node.body)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body = body[1:]
            if not body:                     # a function that was only a docstring
                return ""
            return "\n".join(ast.unparse(stmt) for stmt in body)
    raise AssertionError(f"{name} not found in {path.name} — has it been renamed?")


def _strip_js(src: str) -> str:
    """JavaScript/JSX with comments removed and string contents preserved.

    A naive `//` strip would cut every `https://` in the file in half, and a
    naive block strip would eat any `/*` inside a string. So this walks the text
    tracking which of five states it is in. Template-literal `${...}` holes are
    treated as part of the literal, which is enough here: nothing this file
    asserts on lives inside an interpolation.
    """
    out = []
    i, n = [], len(src)
    i = 0
    quote = None            # ', " or ` when inside a string
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if quote:
            if c == "\\":
                out.append(src[i:i + 2])
                i += 2
                continue
            if c == quote:
                quote = None
            out.append(c)
            i += 1
            continue
        if c in "'\"`":
            quote = c
            out.append(c)
            i += 1
            continue
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and nxt == "*":
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _router_prefix(path: Path) -> str:
    for node in ast.walk(_module(path)):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            func = node.value.func
            if getattr(func, "id", None) == "APIRouter":
                for kw in node.value.keywords:
                    if kw.arg == "prefix":
                        return kw.value.value
    raise AssertionError(f"no APIRouter prefix in {path.name}")


def _route_path(path: Path, fn_name: str) -> str:
    """The path a handler is mounted at, read off its decorator."""
    for node in ast.walk(_module(path)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == fn_name:
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and dec.args:
                    return dec.args[0].value
    raise AssertionError(f"no route decorator on {fn_name} in {path.name}")


# ── The two halves ───────────────────────────────────────────────────────────

def _table_the_token_is_written_to() -> str:
    """Which table `send_for_signature` puts a signer token in."""
    src = _stripped_fn(ESIGN_SERVICE, "send_for_signature")
    hits = [
        table for table, cols in
        re.findall(r"INSERT INTO staging\.(\w+)\s*\(([^)]*)\)", src, re.S)
        if re.search(r"\btoken\b", cols)
    ]
    assert hits, "send_for_signature writes no token to any table"
    assert len(set(hits)) == 1, f"the token is written to more than one table: {set(hits)}"
    return hits[0]


def _table_the_public_endpoint_reads() -> str:
    """Which table the endpoint behind the emailed link looks the token up in."""
    src = _stripped_fn(ESIGN_ROUTER, "get_signing_page")
    m = re.search(r"FROM staging\.(\w+)\s+(\w+)\s", src)
    assert m, "get_signing_page reads no staging table"
    table, alias = m.group(1), m.group(2)
    assert re.search(rf"WHERE {alias}\.token=", src), (
        "get_signing_page does not look the row up BY TOKEN — the emailed link "
        "carries nothing else, so whatever it matches on cannot be reached "
        "from the email."
    )
    return table


# ── The tests ────────────────────────────────────────────────────────────────

def test_the_token_is_written_to_the_table_the_link_resolves_against():
    """The whole defect, in one assertion.

    Before the repair this was `ganit_contract_signers` against `sign_signers`.
    """
    written = _table_the_token_is_written_to()
    read = _table_the_public_endpoint_reads()
    assert written == read, (
        f"a signature request writes its token to staging.{written}, but the "
        f"endpoint behind the emailed link reads staging.{read}. Every signer "
        f"who clicks gets a dead link."
    )


def test_the_emailed_path_is_the_frontend_route_that_exists():
    """`signing_url` and `App.jsx` have to agree on the path, character for character."""
    import services.esign_service as esign

    url = esign.signing_url("https://kartavaya.com", "TOK123")
    assert url == "https://kartavaya.com/sign/TOK123"

    routes = _strip_js(APP_JSX.read_text(encoding="utf-8"))
    assert 'path="/sign/:token"' in routes, (
        "the signing email points at /sign/<token>, and no such route is "
        "declared in App.jsx once its comments are removed."
    )


def test_a_trailing_slash_on_frontend_url_does_not_double_up():
    """FRONTEND_URL is an env var and a human sets it. `//sign/x` is a 404."""
    import services.esign_service as esign

    assert esign.signing_url("https://kartavaya.com/", "TOK") == "https://kartavaya.com/sign/TOK"
    assert esign.signing_url("", "TOK") == "/sign/TOK"


def test_the_public_endpoint_is_the_one_the_signer_page_calls():
    """The read half is reachable at exactly the URL SigningPage requests.

    `signingPageBehaviour.test.jsx` pins the other end: the page calls
    `/v1/esign/verify/${token}`. This pins that such an endpoint exists, and
    that it is the same handler asserted about above — so the two tests meet in
    the middle instead of each describing half a chain.
    """
    full = _router_prefix(ESIGN_ROUTER) + _route_path(ESIGN_ROUTER, "get_signing_page")
    assert full == "/api/v1/esign/verify/{token}", (
        f"the signer page requests /api/v1/esign/verify/<token>; the handler "
        f"that reads the token table is mounted at {full}"
    )


def test_ganit_no_longer_serves_a_second_public_signing_api():
    """Two unauthenticated signing surfaces is the condition that caused this.

    The Ganit module used to expose `/sign/{token}` and three siblings over its
    own token namespace, with no cancelled-or-expired guard on the write path
    and no decline endpoint. Nothing ever called them. If one comes back, the
    product has two answers to "can this person sign" again.
    """
    ganit = BACKEND / "routers" / "ganit.py"
    for node in ast.walk(_module(ganit)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and dec.args and isinstance(dec.args[0], ast.Constant):
                path = dec.args[0].value
                assert not str(path).startswith("/sign/"), (
                    f"routers/ganit.py serves {path} again — a second public "
                    f"signing API over a second token namespace"
                )


@pytest.mark.parametrize("fn", ["get_signer_by_token", "issue_otp", "verify_otp", "submit_signature"])
def test_the_parallel_signing_implementation_is_gone(fn):
    """The Ganit-private OTP and signature functions must not come back.

    They read and wrote `ganit_contract_signers`, produced no executed PDF and
    no audit certificate, and their `submit` had no guard against a document
    that had been cancelled. Every one of those is already implemented once, in
    the module the link resolves to.
    """
    names = {n.name for n in ast.walk(_module(ESIGN_SERVICE))
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    assert fn not in names, (
        f"services/esign_service.py defines {fn} again — that is the parallel "
        f"signing path over ganit_contract_signers"
    )
