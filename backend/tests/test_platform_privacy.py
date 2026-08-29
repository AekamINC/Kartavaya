"""Aekam must not be able to see client personal data.

The owner's instruction, 2026-08-07, in full: "Aekam must not be able to see
client personal data, and orgs must not see each other's."

── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────

`GET /api/users` returned, for a caller holding ANY of the eight platform roles,
every registered user on the platform with their email address — across every
tenant, in one unpaginated response, and with no audit row. A support account
could read the entire customer base's address book and nothing recorded that it
had happened. `GET /api/v1/admin/orgs` did the same thing one row per customer:
`u.email as owner_email`, drawn on Aekam's org table and billing page.

Neither was a bug in the sense of a mistake in logic. Both were deliberate and
both were wrong, so what pins them is a test rather than a comment.

── WHY THESE ASSERTIONS ARE ON THE SQL ──────────────────────────────────────

The pool is a MagicMock and answers any query, so driving the endpoint proves
the shape of a fixture and not the shape of a SELECT. The leak here IS the
SELECT — a column that should not be in it — so the source of the query is what
is asserted. The same technique `test_audit_reader.py` uses, for the same
reason.

── WHAT IS DELIBERATELY STILL ALLOWED ───────────────────────────────────────

An org's own owner or admin listing their OWN org's members still gets email.
That is the member picker: they invite by address, they already hold every one
of them, and no tenant boundary is crossed. The rule is about Aekam reading
customers and about one customer reading another — not about an organisation
reading itself.
"""
import ast
import inspect
import textwrap

import server
from routers import admin_orgs


def _code(fn) -> str:
    """The raw source, whitespace-collapsed. For assertions about STRUCTURE —
    which branch, which severity, which field."""
    return " ".join(inspect.getsource(fn).split())


def _literals(node) -> str:
    """Every string literal under an AST node, joined — which is its SQL.

    Not the raw source. Every one of these endpoints carries a long comment
    explaining what it must NOT return, and those comments contain the words
    "email" and "owner_email" for the obvious reason. A naive substring test
    passes forever on a leak that was reintroduced, and fails on a file that
    merely documents the rule. A `#` comment is not a literal.
    """
    parts = [n.value for n in ast.walk(node)
             if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    return " ".join(" ".join(parts).split())


def _branches(fn, marker: str) -> tuple[str, str]:
    """(SQL inside the `if <marker>` branch, SQL outside it).

    `list_users` is one function with two tenancy branches and only one of them
    crosses an org boundary. Asserting on the whole function cannot tell them
    apart — and the branch that MAY return an email is the one that must, so a
    test that could not separate them would have to be weakened to pass.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    body = tree.body[0]
    doc = ast.get_docstring(body)
    inside, outside = [], []
    for node in ast.walk(body):
        if isinstance(node, ast.If) and marker in ast.dump(node.test):
            inside.append(_literals(node))
    hit = {id(n) for node in ast.walk(body)
           if isinstance(node, ast.If) and marker in ast.dump(node.test)
           for n in ast.walk(node)}
    for node in ast.walk(body):
        if id(node) in hit:
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if doc is not None and node.value == doc:
                continue
            outside.append(node.value)
    return " ".join(" ".join(inside).split()), " ".join(" ".join(outside).split())


# ── 1 · the platform-wide user directory ────────────────────────────────────

def test_the_platform_directory_does_not_select_an_email():
    platform, _ = _branches(server.list_users, "is_platform_staff")
    assert platform, "the platform branch was not found"
    assert "email" not in platform, (
        "the platform branch of GET /api/users returned every tenant's email"
    )


def test_the_display_name_does_not_fall_back_to_an_email():
    """`COALESCE(full_name, name, email)` is the same leak wearing a different
    column name — every user with an incomplete profile is listed by address."""
    platform, _ = _branches(server.list_users, "is_platform_staff")
    assert "'Name not on file'" in platform
    assert "COALESCE(full_name,name,email)" not in platform.replace(" ", "")


def test_support_can_still_tell_two_people_apart():
    """Dropping the email must not make the directory useless. The org each
    name belongs to is what replaces it — resolved through `user_roles`, the
    sole tenant path — so two people called Sharma are distinguishable."""
    platform, _ = _branches(server.list_users, "is_platform_staff")
    assert "public.user_roles" in platform and "public.organisations" in platform
    assert "AS orgs" in platform


def test_reading_the_whole_customer_base_leaves_a_row():
    """Reading a customer's data is the event this product's audit log exists
    to record, and this read had none. `warn`, not `info`: it is a platform
    account crossing into every tenant at once."""
    src = _code(server.list_users)
    assert "platform.user_directory_read" in src
    assert 'severity="warn"' in src


def test_an_org_admin_still_gets_their_own_members_in_full():
    """The rule is about crossing a tenant boundary. Inside one, the member
    picker needs the address it invites by."""
    _, own_org = _branches(server.list_users, "is_platform_staff")
    assert "u.email" in own_org


# ── 2 · the org list Aekam reads ────────────────────────────────────────────

def test_the_customer_org_list_does_not_carry_an_owners_email():
    src = ""
    for name in dir(admin_orgs):
        fn = getattr(admin_orgs, name)
        if not callable(fn) or getattr(fn, "__module__", "") != admin_orgs.__name__:
            continue
        try:
            candidate = _literals(ast.parse(textwrap.dedent(inspect.getsource(fn))))
        except (TypeError, OSError, SyntaxError):
            continue
        if "FROM public.organisations o " in candidate and "plan_code" in candidate:
            src = candidate
            break
    assert src, "could not find the org list endpoint"
    assert "owner_email" not in src, (
        "Aekam's org table returned every customer owner's address"
    )
    assert "owner_name" in src, "support still has to be able to name the owner"


def test_creating_an_org_still_takes_an_owner_email():
    """Not a contradiction. That address is one Aekam was GIVEN in order to
    create the account — it is an input, not a directory read."""
    assert "owner_email" in _code(admin_orgs.OrgCreate)


# ── 3 · THE RATCHET ─────────────────────────────────────────────────────────
#
# Everything above pins ONE endpoint each, by importing it and reading its SQL.
# That is the right shape for a leak somebody has already found. It is the wrong
# shape for the leak nobody has found yet, and this section is the difference.
#
# ── WHAT THE OLD RATCHET WAS, AND THE TWO REASONS IT CAUGHT NOTHING ─────────
#
# `test_no_billing_endpoint_returns_a_contact_detail` scanned `routers/
# subscription.py`. One module, named in an import, chosen because it was the
# billing module on the day it was written. A security review on 2026-08-20
# found FIFTEEN endpoints violating this file's own rule and not one of them was
# in that module: four in `routers/billing.py`, which did not exist when the
# test was written; two in `services/credits.py`, which is not a router at all;
# three in `routers/admin_orgs.py`; and two in `routers/hub.py`, which is a
# content-generation router nobody would think to look in for a billing leak.
#
# It also had a defect that would have defeated it even with the right import.
# It kept only string constants that individually contained the word `SELECT`,
# and only then joined them:
#
#     sql = " ".join(n.value for n in ast.walk(tree)
#                    if ... and "SELECT" in n.value.upper())
#
# `services/credits.py:usage_by_person` builds its query as eleven adjacent
# f-string fragments. The word `SELECT` is in the first one; `u.email AS email`
# is in the third. The filter DISCARDED the fragment carrying the leak before
# the assertion ever ran. Adding the import would not have caught it.
#
# ── THE FOUR PROPERTIES THIS ONE HAS INSTEAD ───────────────────────────────
#
#   1. DISCOVERY BY FILESYSTEM GLOB, never an import list. `routers/*.py`,
#      `services/**/*.py`, `server.py`. A router added next month is scanned
#      because it exists on disk, not because somebody remembered this file.
#
#   2. `ast.parse` OF THE SOURCE — the module is never imported. Free, no side
#      effects, no dependency on env vars or a live pool, and it reaches files
#      that are never registered on the app. `routers/support_sessions.py` is
#      exactly that today: written, unregistered, and covered here anyway.
#
#   3. PER-FUNCTION LITERAL ASSEMBLY. Every string constant inside one function
#      is joined FIRST and the blob is tested SECOND, so a query split across
#      eleven fragments is one string by the time any pattern sees it. This is
#      the fragment defect, killed.
#
#   4. DEFAULT-DENY WITH A NAMED ALLOW-LIST. Any Aekam-side function whose SQL
#      matches a leak pattern must appear in `ALLOWED` with a one-line reason.
#      A new leak fails on the day it is written, in a message naming the file,
#      the function and the pattern. And `test_the_allow_list_has_no_stale_
#      entries` fails the other way round, so a reason left behind after the
#      code stopped needing it does not sit here looking like a rule.
#
# ── WHY DOCSTRINGS ARE EXCLUDED FROM THE BLOB ──────────────────────────────
#
# `_literals` above notes that a `#` comment is not a literal, which is what
# stops a file that DOCUMENTS this rule from failing it. A docstring is not so
# lucky — it is an `ast.Constant`, and every endpoint this file has ever fixed
# carries a long docstring explaining what it must not return, containing the
# words "email" and "address" for the obvious reason. So docstrings are dropped
# from the blob explicitly. Comments and docstrings may both say anything; only
# executable string literals are evidence about a query.

import functools
import re
from pathlib import Path

# THE PREFIX TUPLE IS IMPORTED FROM THE MODULE THAT ENFORCES IT, never copied.
# `CROSS_ORG_HEADER_PREFIXES` is what actually decides, at request time, whether
# a platform role may name somebody else's org in `X-Org-Id`. A transcription of
# it here would be a second copy of a tenancy fact, and the first time somebody
# added a fifth console prefix this test would go on scanning four.
from middleware.org_resolver import CROSS_ORG_HEADER_PREFIXES

BACKEND = Path(__file__).resolve().parents[1]

#: Where a SQL-carrying leak can live. Globs, not names.
#:
#: `services/**/*.py` is recursive on purpose — `services/skills/` and
#: `services/niyam/` are packages, and `services/credits.py` is where two of the
#: fifteen findings actually were. A service cannot see who is calling it, which
#: makes it the WORST place for this rule to be unenforced, not the best.
SCANNED: tuple[str, ...] = ("routers/*.py", "services/**/*.py", "server.py")

#: A blob is only treated as SQL if it contains one of these. Without it, every
#: HTTPException message mentioning an address would be a finding.
_SQL_VERB = re.compile(
    r"(?<![a-z0-9_])(select|insert into|update|delete from|returning)(?![a-z0-9_])")

#: A caller-facing gate that proves the function is on Aekam's side of the rule.
#:
#: Matched on the AST rather than on the source text — `ast.get_source_segment`
#: re-splits the whole file per function and turned this scan into a 90-second
#: test. Both names are called: `Depends(require_platform_role(*ROLES))` lives in
#: an argument default, which is part of the FunctionDef node, so one walk of the
#: function reaches every form of it.
_PLATFORM_GATE_NAMES = frozenset({"require_platform_role", "is_platform_staff"})


def _has_platform_gate(fn: ast.AST) -> bool:
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = getattr(func, "id", None) or getattr(func, "attr", None)
        if name in _PLATFORM_GATE_NAMES:
            return True
    return False

#: THE LEAK PATTERNS. Each is a shape a query takes when it discloses a person.
#:
#: `email-column`      — `u.email`, `AS email`, a bare `email` in a projection or
#:                       a predicate. The lookahead/lookbehind stop it matching
#:                       inside `contact_email` or `email_service`, which have
#:                       their own entries or none.
#: `coalesce-to-email` — `COALESCE(full_name, name, email)`. THE SAME LEAK
#:                       WEARING A DIFFERENT COLUMN NAME, and the one that keeps
#:                       coming back: it puts an address in a field called
#:                       `name`, where no reviewer looks for one.
#: `contact-column`    — the columns that name a third party who is not even a
#:                       user of this product: a client's contact person, an
#:                       employee's mobile, an outbound log's recipient.
LEAK_PATTERNS: dict[str, re.Pattern] = {
    # QUOTE-AWARE since 2026-08-27. `AND channel = 'email'` is a VALUE, not a
    # column, and `services/email_caps.py::email_usage` — a query that selects
    # two COUNT(*)s and no person at all — was reported as a leak because of it.
    # A finding that is a string literal teaches the reader to distrust the
    # findings, which is how a privacy ratchet dies.
    #
    # The quote guard is on BOTH sides so `'email'` and `"email"` are excluded
    # while `u.email`, `AS email` and a bare `email` in a projection still match.
    "email-column": re.compile(
        r"(?<![a-z0-9_'\"])(?:[a-z_][a-z0-9_]*\.)?email(?![a-z0-9_'\"])"),
    "coalesce-to-email": re.compile(r"coalesce\([^)]*email\s*\)"),
    "contact-column": re.compile(
        r"(?<![a-z0-9_])(?:contact_email|contact_phone|contact_name"
        r"|mobile_number|phone|recipient)(?![a-z0-9_])"),
}

#: `SELECT *` OVER A TABLE THAT HOLDS PEOPLE.
#:
#: A wildcard is invisible to every pattern above — `SELECT c.*` contains no
#: column name at all — and it is how `routers/hub.py:list_clients` returned
#: `contact_email` to ten accounts across a tenant boundary while reading, in
#: the diff, like a perfectly ordinary list endpoint. It is worse than an
#: explicit leak, because adding `contact_whatsapp` to the table would join
#: every such response with no diff on any router showing it happen.
#:
#: Fired only when the same blob also NAMES one of the three tables below, so
#: `SELECT *` from a brand profile or a skill template — which is most of the
#: wildcards in this codebase, and none of them a disclosure — is not a finding.
_STAR = re.compile(r"(?<![a-z0-9_])select\s+(?:distinct\s+)?(?:[a-z_][a-z0-9_]*\.)?\*")
#: Verified against the LIVE catalogue on 2026-08-20, not against the migration
#: ledger: `staging.hub_clients.is_internal` exists in the database and in no
#: migration in this tree, so the ledger is not the authority on what a table
#: holds. `users` covers `public.users`; `hub_clients` holds a client company's
#: contact person; `outbound_log` holds every address this product has mailed.
_PERSONAL_TABLES = re.compile(
    r"(?<![a-z0-9_])(hub_clients|outbound_log|users)(?![a-z0-9_])")
_WILDCARD = "wildcard-over-personal-table"


def _module_docstring_ids(tree: ast.AST) -> set[int]:
    """The id() of every docstring node under `tree` — module, class, function.

    Dropped from the blob. See the banner: a docstring is an `ast.Constant`, and
    every endpoint fixed by this file explains in prose what it must not return.
    """
    out: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef,
                             ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc is not None and node.body and isinstance(node.body[0], ast.Expr):
                out.add(id(node.body[0].value))
    return out


#: A single unqualified word — `email`, `sent`, a dict key. NOT `u.email`, which
#: carries a dot and is a column name.
_BARE_WORD = re.compile(r"[A-Za-z0-9_-]+")


def _function_sql(fn: ast.AST) -> str:
    """Every executable string literal in one function, joined, lowercased.

    JOINED FIRST, TESTED SECOND. This is property 3, and it is the whole reason
    the old ratchet could not have caught `credits.usage_by_person`: that query
    is eleven adjacent f-string fragments, only the first of which contains the
    word SELECT and only the third of which contains the leak.

    ── TWO KINDS OF LITERAL THAT ARE NOT SQL, DROPPED 2026-08-27 ─────────────

    The scanner reported three findings against the email-caps feature and NONE
    of them was a column:

        admin_orgs.get_email_usage   the route path "/{org_id}/email-usage",
                                     and the docstring "Current email usage…"
        email_caps.email_usage       `AND channel = 'email'` — a VALUE
        server.add_team_member       "…a member to a project by email." — prose

    Only `add_team_member` reads an email column at all, and it was buried under
    two artifacts and a docstring. THAT IS THE FAILURE MODE THAT MATTERS HERE: a
    privacy ratchet whose findings are mostly noise gets its `ALLOWED` list
    padded to make the red go away, and the one real entry goes in with the
    three false ones. So:

      · the function's OWN DOCSTRING is skipped, as the module's already was.
        Every endpoint here documents what it must not return, in prose that
        necessarily contains the word — the same reason `_literals` gives for
        ignoring `#` comments.
      · a literal with NO WHITESPACE that is a bare word or a URL path is
        dropped. `'email'`, `"/{org_id}/email-usage"`, a dict key. Real SQL
        always carries a space: a projection has a comma and a FROM, a predicate
        has an operator. `"u.email"` is deliberately KEPT — it has a dot, so it
        is a qualified column name and not a word.

    Neither filter can hide a leak that is spelled as SQL, which is the only way
    a leak reaches a database.
    """
    skip = set(_module_docstring_ids(fn))
    own_doc = ast.get_docstring(fn, clean=False) if isinstance(
        fn, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)) else None
    if own_doc is not None:
        body = getattr(fn, "body", None)
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            skip.add(id(body[0].value))

    def _is_sql(v: str) -> bool:
        if any(c.isspace() for c in v):
            return True
        if v.startswith("/"):            # a route path
            return False
        return not _BARE_WORD.fullmatch(v)

    parts = [n.value for n in ast.walk(fn)
             if isinstance(n, ast.Constant) and isinstance(n.value, str)
             and id(n) not in skip and _is_sql(n.value)]
    return " ".join(" ".join(parts).split()).lower()


def _resolve_module(dotted: str) -> str | None:
    """`services.credits` → `services/credits.py`, if that file is in the tree."""
    path = BACKEND / (dotted.replace(".", "/") + ".py")
    try:
        return path.relative_to(BACKEND).as_posix() if path.is_file() else None
    except ValueError:
        return None


class _Tree:
    """One parsed module: its functions, its imports, and whether it is a
    cross-org console surface."""

    def __init__(self, path: Path):
        self.rel = path.relative_to(BACKEND).as_posix()
        self.source = path.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)
        self.functions: dict[str, ast.AST] = {}
        self.import_module: dict[str, str] = {}   # alias  -> module file
        self.import_name: dict[str, tuple[str, str]] = {}  # alias -> (file, name)
        self.is_console = False

        for node in ast.walk(self.tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Last definition wins, which is what Python does too.
                self.functions[node.name] = node
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    resolved = _resolve_module(alias.name)
                    if resolved:
                        key = (alias.asname or alias.name).split(".")[0]
                        self.import_module[key] = resolved
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                base = _resolve_module(node.module)
                for alias in node.names:
                    sub = _resolve_module(f"{node.module}.{alias.name}")
                    if sub:
                        self.import_module[alias.asname or alias.name] = sub
                    elif base:
                        self.import_name[alias.asname or alias.name] = (base, alias.name)
            elif isinstance(node, ast.Call) and getattr(node.func, "id", None) == "APIRouter":
                for kw in node.keywords:
                    if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                        # `APIRouter(prefix="/api/v1/billing")` against a tuple
                        # whose entries carry a trailing slash. Normalised here
                        # rather than by editing the tuple, which belongs to the
                        # resolver.
                        candidate = str(kw.value.value).rstrip("/") + "/"
                        if candidate.startswith(CROSS_ORG_HEADER_PREFIXES):
                            self.is_console = True

    def calls(self, fn: ast.AST) -> set[tuple[str, str]]:
        """(module file, function name) for every call this function makes that
        RESOLVES to a function in the scanned set.

        Resolved through the module's own import table rather than by matching
        bare names across the tree. Name-matching marks `run`, `list_members`
        and `get` in every module that happens to share a name, and an
        over-broad answer here turns into allow-list entries for functions that
        are not on Aekam's side at all — which is how an allow-list stops being
        read.
        """
        out: set[tuple[str, str]] = set()
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
                mod = self.import_module.get(func.value.id)
                if mod:
                    out.add((mod, func.attr))
            elif isinstance(func, ast.Name):
                if func.id in self.functions:
                    out.add((self.rel, func.id))
                elif func.id in self.import_name:
                    out.add(self.import_name[func.id])
        return out


# Parsed ONCE per session. Four tests below ask the same question of the same
# 225 files, and re-parsing them four times is 90 seconds of a suite that has to
# stay runnable.
@functools.lru_cache(maxsize=1)
def _scan() -> tuple[dict, frozenset]:
    """Every function in the scanned set, and which of them are Aekam-side.

    ── HOW A FUNCTION COMES TO BE ON AEKAM'S SIDE OF THE RULE ─────────────────
    Two seeds and one closure.

      SEED 1 — it carries a platform gate. `Depends(require_platform_role(...))`
      or `is_platform_staff(`. The function itself says it serves Aekam.

      SEED 2 — its module mounts on a CROSS-ORG CONSOLE PREFIX. Those four
      prefixes are the ones `org_resolver` lets a platform role name another
      org on, so EVERY handler in such a module is reachable across a tenant
      boundary whether or not it has a gate of its own. This is what makes
      `routers/hub.py` Aekam-side: `/api/v1/hub/` is in that tuple, `sahayak`
      is not in `SENSITIVE_MODULES`, and the org arrives in a header.

      CLOSURE — anything an Aekam-side function CALLS. A service cannot see who
      is asking, so it cannot be classified by its own text; it inherits from
      its callers. This is the step that reaches `services/credits.py:
      usage_by_person`, which has no gate, is in no router, and was two of the
      fifteen findings. A body shared by an org-internal route and a console
      route is Aekam-side, correctly: sharing it is exactly what put an address
      on Aekam's finance screen.
    """
    paths: list[Path] = []
    for pattern in SCANNED:
        paths.extend(BACKEND.glob(pattern))
    trees: dict[str, _Tree] = {}
    for path in sorted(set(paths)):
        try:
            trees[path.relative_to(BACKEND).as_posix()] = _Tree(path)
        except SyntaxError:  # pragma: no cover — a broken file fails elsewhere
            continue

    aekam: set[tuple[str, str]] = set()
    for rel, tree in trees.items():
        for name, node in tree.functions.items():
            if tree.is_console or _has_platform_gate(node):
                aekam.add((rel, name))

    changed = True
    while changed:
        changed = False
        for rel, name in list(aekam):
            tree = trees[rel]
            for target in tree.calls(tree.functions[name]):
                if target in aekam:
                    continue
                owner = trees.get(target[0])
                if owner and target[1] in owner.functions:
                    aekam.add(target)
                    changed = True

    return trees, frozenset(aekam)


@functools.lru_cache(maxsize=1)
def _findings() -> dict[tuple[str, str], tuple[str, ...]]:
    """Every Aekam-side function whose assembled SQL matches a leak pattern."""
    trees, aekam = _scan()
    out: dict[tuple[str, str], tuple[str, ...]] = {}
    for rel, name in sorted(aekam):
        blob = _function_sql(trees[rel].functions[name])
        if not _SQL_VERB.search(blob):
            continue
        hit = sorted(k for k, p in LEAK_PATTERNS.items() if p.search(blob))
        if _STAR.search(blob) and _PERSONAL_TABLES.search(blob):
            hit = sorted(hit + [_WILDCARD])
        if hit:
            out[(rel, name)] = tuple(hit)
    return out


# ── THE ALLOW-LIST ──────────────────────────────────────────────────────────
#
# Every entry is a function whose SQL trips a pattern and is nevertheless
# correct. There is no wildcard, no per-file exemption and no "skip services":
# the key is (module, function) and the value is why, in one line, so that a
# reviewer reading this list is reading a statement about the product rather
# than a list of things somebody could not be bothered to fix.
#
# ADDING AN ENTRY IS THE POINT OF FRICTION. It is meant to be the moment
# somebody has to write down, in a diff, why Aekam may see this.

ALLOWED: dict[tuple[str, str], str] = {
    # ── The org's OWN data, reached through a shared body ───────────────────
    ("server.py", "list_users"):
        "Two branches. The platform one selects a name and no email — pinned by "
        "the four tests in section 1 above. The org branch keeps `u.email` "
        "because an org admin reading their own member picker invites by it.",
    ("routers/billing.py", "_balance_body"):
        "`include_contact` splits it: the /me twin selects `email` for the org's "
        "own ceiling table, the /orgs/{org_id} console does not. Pinned in "
        "test_billing_privacy.py.",
    ("services/credits.py", "usage_by_person"):
        "Same split, and it defaults to CLOSED — a caller that forgets the "
        "argument gets no addresses. Pinned in test_billing_privacy.py.",
    ("routers/billing.py", "_outbound_messages_body"):
        "`include_contact` selects `recipient` for the org's own admin and "
        "`split_part(recipient,'@',2)` for Aekam; the address lookup is refused "
        "outright on the console side. Pinned in test_billing_privacy.py.",

    # ── An address Aekam WAS GIVEN, not one it read ─────────────────────────
    ("routers/admin_orgs.py", "create_org"):
        "`owner_email` is the address handed to Aekam in order to create the "
        "account. An input, not a directory read — the same argument "
        "test_creating_an_org_still_takes_an_owner_email makes above.",
    ("routers/admin_orgs.py", "add_member"):
        "Aekam invites ONE org admin by an address it was given; the owner's "
        "rule names this capability explicitly. It looks the address up to "
        "check the account exists and to count the seat, and returns no roster.",
    ("routers/admin_orgs.py", "assign_role"):
        "Reads the target's email ONLY to reconcile a pending invite against "
        "the seat count — it would otherwise refuse somebody their own "
        "reservation. Nothing is returned to the caller.",
    ("routers/admin_orgs.py", "search_user_by_email"):
        "`WHERE LOWER(email)=LOWER($1)` on an address the caller typed. The "
        "projection is `user_id` and nothing else, and every lookup writes "
        "`platform.user_lookup` — hit or miss, so enumeration leaves a pattern.",
    ("routers/admin_orgs.py", "nominate_org_owner"):
        "`WHERE LOWER(u.email)=LOWER($1)` on an address the caller typed — the "
        "same shape as `search_user_by_email` above, and the projection is "
        "`user_id` plus the system flag, with no address in it. The refusal "
        "for an org that already has an owner is a `SELECT 1`, deliberately: "
        "WHICH person owns a customer's organisation is the customer's fact, "
        "and the console does not need it in order to refuse. Every message "
        "and the response echo `body.email`, the caller's own input. Audited "
        "at warn as `platform.org_owner_nominated`, by user_id.",
    ("routers/admin_orgs.py", "set_org_contact_email"):
        "Writes `public.organisations.email` — an ORGANISATION's point of "
        "contact, not a person's mailbox. The owner's rule names this "
        "capability: 'CHANGE THE ORG EMAIL ADDRESS … if someone leaves that "
        "org there is a new point of contact'.",
    ("routers/admin_orgs.py", "get_org"):
        "The word `email` here is `o.email`, the organisation's own point of "
        "contact. `tests/test_cross_org_console_surface.py` pins the whole "
        "member/module/seat surface this endpoint stopped returning.",

    # ── Aekam telling ITS OWN people something ──────────────────────────────
    ("routers/hub.py", "_account_contacts"):
        "Resolves the AEKAM staff addresses a skill request is announced to. "
        "Aekam's own inbox, never a customer's.",
    # `routers/hub.py::_announce_skill_request` HAD an entry here and no longer
    # needs one. Its only SQL is `SELECT name FROM staging.organisations`; the
    # address it mails comes from `user.get("email")` — the caller's own session
    # dict, not a query — and a dict key is not a column. It tripped on the
    # string literal `"email"` inside that `.get()`, and the exemption was
    # written to make the red go away.
    ("routers/org_invites.py", "issue_invite"):
        "Reached from Aekam's side only since `create_org` stopped refusing an "
        "owner who has no account — it now creates the organisation and INVITES "
        "them to own it, because the product has no public registration and "
        "'they must register first' was advice nobody could take. The address "
        "it reads is `body.owner_email`, typed by the console operator in the "
        "same request: superseding a pending invite for it, writing the invite "
        "row, and mailing the link. Nothing about any OTHER person is read, and "
        "no address is returned to the caller that the caller did not supply.",
    ("routers/org_invites.py", "count_seats"):
        "Counts pending invites by address so a seat is not double-counted. A "
        "COUNT, which is the one thing the owner's rule says billing gets.",

    # ── Not a person: a channel name, a company, a domain ───────────────────
    # `routers/billing.py::_outbound_body` HAD an entry here that read, in full:
    # "The only `email` in it is the literal `channel = 'email'` — a channel
    # name in a GROUP BY. This query returns counts and message units and has no
    # recipient column at all." That is not a reason Aekam may see something; it
    # is a description of a SCANNER BUG, written down and then lived with. The
    # pattern is quote-aware now and the exemption is gone with it.
    #
    # Two exemptions had already been spent papering over the same false
    # positive when it produced its third. That is the cost of a noisy ratchet
    # and the reason the fix belonged in the pattern.
    ("routers/hub.py", "create_client"):
        "INSERTs the contact person an org's own admin typed into its own CRM-"
        "adjacent record. A write of supplied data, not a cross-tenant read.",

    # ── Wildcards over a table that holds people ────────────────────────────
    ("routers/hub.py", "_verify_client_access"):
        "`SELECT *` is the tenancy guard for ~20 handlers and several write "
        "paths read the contact columns off it to preserve them. The redaction "
        "is at the two surfaces that hand the row to a caller — get_client and "
        "list_clients — not in the guard, which must keep one job.",
    ("routers/hub.py", "get_or_create_org_client"):
        "`SELECT *` over the org's OWN internal client row (`is_internal`), "
        "auto-created from the org name. Nothing writes its contact columns.",
    ("routers/hub.py", "get_org_brand"):
        "`SELECT *` from `hub_brand_profiles`; `hub_clients` appears only in the "
        "sub-select that resolves the org's internal client id.",
    ("routers/hub.py", "generate_org_content"):
        "Same shape — the wildcard is over brand/content rows and `hub_clients` "
        "is named only to resolve the org's own internal client.",
    ("routers/hub.py", "execute_org_skill"):
        "Same shape again. Owned elsewhere; recorded here so it is not silently "
        "exempt.",
    ("routers/dashboards.py", "get_dashboard_data"):
        "`SELECT *` over dashboard rows; `users` is named for a display-name "
        "join that carries no address.",
    ("services/social_publisher.py", "publish_content"):
        "`SELECT *` over a publish job; `hub_clients` is joined for the client "
        "NAME that captions a post.",

    # ── Org-internal product surfaces the closure reached ───────────────────
    ("routers/vetana.py", "download_payslip_pdf"):
        "Payroll is `SENSITIVE_MODULES`, refused to every platform role by "
        "`subscription.platform_refusal`. An employee's own payslip carries "
        "their own contact block, which is what a payslip is.",
}


def test_every_aekam_side_leak_is_either_fixed_or_named():
    """DEFAULT-DENY. A new query that names a person on Aekam's side of the
    tenant boundary fails here, on the day it is written.

    The message names the file, the function and the pattern, because a ratchet
    that fails without saying where is a ratchet somebody disables.
    """
    findings = _findings()
    unexplained = {k: v for k, v in findings.items() if k not in ALLOWED}
    assert not unexplained, (
        "Aekam-side SQL naming a person, with no entry in ALLOWED:\n"
        + "\n".join(
            f"  {mod}::{fn}  →  {', '.join(pats)}"
            for (mod, fn), pats in sorted(unexplained.items())
        )
        + "\n\nEither drop the column, split it behind an `include_contact` "
          "argument that defaults to False, or add an entry to ALLOWED in "
          "tests/test_platform_privacy.py saying why Aekam may see it."
    )


def test_the_allow_list_has_no_stale_entries():
    """The ratchet turns both ways.

    An entry left behind after the code stopped needing it is a sentence in this
    file asserting something about the product that is no longer true — and the
    next person to add a leak to that function finds it pre-approved.
    """
    findings = _findings()
    stale = sorted(k for k in ALLOWED if k not in findings)
    assert not stale, (
        "ALLOWED entries whose function no longer trips any pattern — delete "
        "them:\n" + "\n".join(f"  {mod}::{fn}" for mod, fn in stale)
    )


def test_the_ratchet_actually_covers_the_files_the_review_found_leaks_in():
    """A scanner that silently found nothing would pass every test above.

    So the coverage is asserted as a number and as five names. The names are the
    files the 2026-08-20 review found the fifteen endpoints in; four of the five
    could not have been reached by the import list this section replaced, and
    `support_sessions.py` is the file that proves discovery does not depend on a
    router being registered on the app.
    """
    trees, aekam = _scan()

    assert len(trees) >= 200, (
        f"only {len(trees)} files scanned; the globs {SCANNED} used to reach "
        f"~225. A glob that stopped matching is a ratchet that stopped."
    )
    for required in ("routers/billing.py", "services/credits.py",
                     "routers/admin_orgs.py", "routers/hub.py",
                     "routers/support_sessions.py"):
        assert required in trees, f"{required} was not scanned"

    # And it must actually classify: a scan that marked nothing Aekam-side
    # would assert nothing, whatever it parsed.
    assert len(aekam) >= 300, f"only {len(aekam)} functions classified Aekam-side"
    for required in (("services/credits.py", "usage_by_person"),
                     ("routers/billing.py", "_outbound_messages_body"),
                     ("routers/admin_orgs.py", "list_org_roles"),
                     ("routers/hub.py", "list_clients")):
        assert required in aekam, f"{required} was not classified Aekam-side"


def test_the_fragment_defect_that_defeated_the_old_ratchet_is_gone():
    """The regression test for the ratchet ITSELF.

    `usage_by_person` builds its query as adjacent f-string fragments. The old
    filter kept only constants individually containing `SELECT`, which discarded
    the fragment carrying `u.email`. This asserts the assembly, not the outcome:
    the blob for that function must contain both the verb and a column that
    appears in a LATER fragment than the verb does.
    """
    trees, _ = _scan()
    fn = trees["services/credits.py"].functions["usage_by_person"]
    blob = _function_sql(fn)
    assert "select" in blob and "a_user_id" in blob, (
        "the per-function assembly stopped seeing the fragments of "
        "usage_by_person — the defect this section exists to fix"
    )
    # The old filter, restated here, must be shown to lose them.
    old_style = " ".join(
        n.value for n in ast.walk(fn)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and "SELECT" in n.value.upper()
    ).lower()
    assert "a_user_id" not in old_style or "left join" not in old_style, (
        "the old SELECT-only filter would have seen the whole query, which "
        "means this test no longer demonstrates anything — check the query "
        "was not rewritten into one literal"
    )


# ── 4 · the billing surfaces, endpoint by endpoint ──────────────────────────
#
# The owner's rule for these specifically: "Billing surfaces get seat counts
# only." Checked 2026-08-07 rather than assumed, and the finding then was that
# `routers/subscription.py` already complied. It still does, and these hold it.
#
# What was NOT checked in 2026-08-07 was `routers/billing.py`, which did not
# exist yet, and `services/credits.py` behind it. Both are pinned in
# `tests/test_billing_privacy.py`.

def test_no_subscription_endpoint_returns_a_contact_detail():
    """A count says how many people; a roster says who they are and how to
    reach them. Aekam needs the first to bill and has no business with the
    second — which is the whole shape of the rule.

    RENAMED from `test_no_billing_endpoint_returns_a_contact_detail`, which is
    what it claimed to be and never was: it read one module, `subscription`, and
    the router actually called `billing` was invisible to it. The general claim
    is now section 3's; this is the specific one, and it says which module it
    checks in its own name.
    """
    import inspect
    from routers import subscription

    src = inspect.getsource(subscription)
    # Not a substring test on the module: `email` appears in prose. Only the
    # SQL is examined, the same way the section above does it.
    tree = ast.parse(textwrap.dedent(src))
    sql = " ".join(
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and ("SELECT" in n.value.upper() or "INSERT" in n.value.upper())
    ).lower()
    for leak in ("u.email", "users.email", "owner_email", "as email",
                 " email,", " email ", "full_name", "phone"):
        assert leak not in sql, f"a billing query selects {leak.strip()!r}"


def test_the_overdue_list_names_the_ORG_and_not_a_person():
    """`i.*, o.name as org_name`. Chasing an unpaid invoice is a conversation
    with an organisation; the person to have it with comes from the approved
    support-session flow, which leaves a row."""
    import inspect
    from routers import subscription

    src = " ".join(inspect.getsource(subscription.list_overdue).split())
    assert "o.name as org_name" in src
    assert "email" not in src


def test_the_two_seat_figures_are_never_summed():
    """The owner's decision of 2026-08-04, and the one arithmetic error on this
    surface that would misstate a bill: a firm with 8 office staff and 200 site
    workers pays 8 org seats and 200 attendance seats, not 208 of either."""
    from pathlib import Path

    figures = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "org" / "seatFigures.js"
    assert figures.exists(), figures
    body = figures.read_text(encoding="utf-8")
    assert "pahchanSeats" in body and "orgSeats" in body
    # No function in that file adds one population to the other.
    assert "orgSeats(" not in body.split("export function pahchanSeats")[-1]
