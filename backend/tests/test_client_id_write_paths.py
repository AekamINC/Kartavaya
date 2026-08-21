"""`client_id` is not optional on a write path any more.

── WHAT THIS GUARDS ────────────────────────────────────────────────────────

A CRM client is the COMPANY. Contacts are the people who come and go; the
customer stays, and `graha_contacts.client_id` is the only column that says
which company a person belongs to.

That column stopped being a reporting nicety the day the ICAI gate shipped.
`routers/prachar._resolve_audience` adds `AND client_id IS NOT NULL` to every
audience it builds — preview, unsaved-filter preview, `/send`, and the
scheduled sender — because a chartered accountant soliciting a NON-client is
professional misconduct. A contact written with a NULL `client_id` is
therefore permanently unemailable through this product.

Measured on the live database on 2026-08-21, before the fix: 126 of 291 live
contacts carried a NULL `client_id`, and all 291 of them have an email
address. Forty-three per cent of the CRM could not be contacted, and nothing
anywhere said so.

The same column on the document tables — `ganit_invoices.client_id`,
`vikray_orders.client_id` — is what files money owed under the company that
owes it. 241 of 788 live invoices had none; 40 of those hung off a contact
who DID have an employer, which is the signature of a create path that simply
forgot to carry it across.

── WHY IT READS SOURCE AND NOT A DATABASE ──────────────────────────────────

The test pool in this suite is a MagicMock that echoes its fixtures back. It
answers happily for a column that does not exist and for an INSERT that never
names one, so a round-trip test proves nothing about which columns a
statement actually writes. The SQL text is the only honest witness, and the
AST is the only honest way to find the SQL text: `grep` cannot tell a
statement inside a function from one inside a docstring, a comment, or a
test.

── HOW TO ADD A WRITE PATH ─────────────────────────────────────────────────

Name `client_id` in the column list. If it can be absent, bind it as
`NULLIF($n,'')::uuid` — an empty string reaching a `::uuid` cast is an
instant PgBouncer 500 — and resolve it through the org-scoped helper for the
module (`graha.resolve_contact_company`, `vikray.resolve_order_company`) so
one organisation cannot file its row under another's company.

If a path genuinely must write no company, add it to `KNOWN_GAPS` below with
the reason. The allowlist is a ledger, not an escape hatch: it is checked to
be exact, so an entry that stops being true fails this file too.
"""
import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parent.parent

#: Directories walked for write paths. `.venv`, `tests` and `migrations` are
#: excluded: third-party code is not ours, a test asserting on SQL text is not
#: a write path, and a migration writes DDL rather than rows.
SCANNED = ("routers", "services", "analytics")

CONTACTS = "staging.graha_contacts"
INVOICES = "staging.ganit_invoices"
ORDERS = "staging.vikray_orders"

#: Write paths that exist today and do NOT set `client_id`, each with the
#: reason. Every one of them lives outside the three routers this change owns.
#: They are recorded rather than silenced — an entry here is a contact or a
#: document that cannot be linked to a company, and each is a defect owed.
KNOWN_GAPS: dict[tuple[str, str], str] = {
    ("routers/scrapers.py", "import_run_to_graha"):
        "Scraped leads. A scraper find is a stranger, and the org that "
        "imported it has named no company for it — see the same reasoning in "
        "graha.inbound_leads. Owed: the import form should offer one.",
    ("services/lead_ingest.py", "_upsert"):
        "JustDial / IndiaMART marketplace push. Nothing in the payload names "
        "a company, and accepting one from a marketplace would let an "
        "outside system declare a firm's client for it.",
    ("services/skills/action/recurring_invoice_generator.py", "generate_due_invoices"):
        "The scheduled twin of ganit.generate_recurring_invoice, which now "
        "inherits the company from the contact. This copy was not touched by "
        "that change and still writes none. Owed: same two lines.",
    ("services/contact_dedupe.py", "merge_contacts"):
        "`_MERGEABLE_FIELDS` does not list `client_id`, so merging a person "
        "who HAS an employer into a survivor who has none leaves the "
        "survivor unemailable. Owed: add the column to the backfill list.",
    ("services/contact_dedupe.py", "undo_merge"):
        "Reverts exactly the fields `merge_contacts` backfilled, read off "
        "the stored `field_updates`. It is correct as long as the line above "
        "is, and wrong in the same way if it is not.",
}


# ── Reading the source ──────────────────────────────────────────────────────

def _python_files() -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for top in SCANNED:
        root = BACKEND / top
        if not root.is_dir():
            continue
        for p in sorted(root.rglob("*.py")):
            if "__pycache__" in p.parts or ".venv" in p.parts:
                continue
            out.append(p)
    return out


def _literal(node: ast.AST) -> str | None:
    """The literal text of a string node, or None if it is not one.

    An f-string comes back with its interpolations replaced by `{}`. That is
    deliberate: `f"UPDATE {table} SET ..."` must not read as an UPDATE of a
    table it only happens to sit beside, but `f"UPDATE staging.graha_contacts
    SET {', '.join(sets)}"` must still be found.

    Adjacent string literals are folded by the parser before we ever see them,
    so a statement written across six source lines arrives here as one string.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = []
        for v in node.values:
            if isinstance(v, ast.Constant) and isinstance(v.value, str):
                parts.append(v.value)
            else:
                parts.append("{}")
        return "".join(parts)
    return None


def _norm(sql: str) -> str:
    """Whitespace-normalised, lower-cased. A triple-quoted statement and a
    six-line implicit concatenation have to compare the same."""
    return " ".join(sql.split()).lower()


class _Path:
    """One SQL string, and the function it was found in."""

    def __init__(self, file: str, func: str, sql: str, is_fstring: bool):
        self.file = file
        self.func = func
        self.sql = sql
        self.is_fstring = is_fstring

    @property
    def key(self) -> tuple[str, str]:
        return (self.file, self.func)

    def __repr__(self) -> str:  # pragma: no cover - failure messages only
        return f"{self.file}::{self.func}"


def _write_paths(table: str, verb: str) -> list[_Path]:
    """Every `<verb> ... <table>` string literal in the scanned tree, attributed
    to the innermost function that contains it."""
    needle = f"{verb.lower()} {'into ' if verb.lower() == 'insert' else ''}{table}"
    found: list[_Path] = []

    for path in _python_files():
        rel = path.relative_to(BACKEND).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a broken file fails elsewhere
            continue

        # Innermost enclosing function for every node, so a statement inside a
        # nested helper is attributed to the helper and not to its parent.
        owner: dict[int, str] = {}
        for parent in ast.walk(tree):
            name = getattr(parent, "name", None) if isinstance(
                parent, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
            for child in ast.iter_child_nodes(parent):
                inherited = owner.get(id(parent), "<module>")
                owner[id(child)] = name or inherited

        for node in ast.walk(tree):
            text = _literal(node)
            if text is None:
                continue
            sql = _norm(text)
            if needle not in sql:
                continue
            found.append(_Path(rel, owner.get(id(node), "<module>"), sql,
                               isinstance(node, ast.JoinedStr)))
    return found


def _column_list(sql: str, table: str) -> str:
    """The parenthesised column list of an INSERT, whitespace-normalised.

    Returns "" when the statement does not have one (an `INSERT ... SELECT`),
    which the callers treat as "names no columns" — correctly.
    """
    head = sql.split(f"insert into {table}", 1)[1]
    if "(" not in head:
        return ""
    inner = head.split("(", 1)[1]
    if ")" not in inner:
        return ""
    return inner.split(")", 1)[0]


# ── The ratchet ─────────────────────────────────────────────────────────────

def test_the_scan_finds_the_write_paths_it_is_supposed_to_guard():
    """A ratchet that silently matches nothing passes for ever.

    This is the test that fails if `_literal`, the walk or the needle ever
    stops finding statements — without it, deleting the whole scan would look
    like a clean suite.
    """
    inserts = _write_paths(CONTACTS, "INSERT")
    updates = _write_paths(CONTACTS, "UPDATE")
    assert len(inserts) >= 4, f"expected the known contact INSERTs, found {inserts}"
    assert len(updates) >= 4, f"expected the known contact UPDATEs, found {updates}"

    owners = {p.file for p in inserts}
    assert "routers/graha.py" in owners
    assert any(p.func == "create_contact" for p in inserts)


def test_every_contact_insert_names_client_id():
    """A contact created without a company can never be emailed.

    `client_id IS NOT NULL` is the ICAI gate in `_resolve_audience`. An INSERT
    that omits the column writes a person the firm may never lawfully contact
    through this product — and nothing at the point of creation says so.
    """
    offenders = []
    for p in _write_paths(CONTACTS, "INSERT"):
        if "client_id" in _column_list(p.sql, CONTACTS):
            continue
        if p.key in KNOWN_GAPS:
            continue
        offenders.append(p)

    assert not offenders, (
        "these INSERTs into staging.graha_contacts do not name client_id, so "
        "every contact they create is permanently unemailable under the ICAI "
        f"gate: {offenders}. Name the column, or record the path in "
        "KNOWN_GAPS with the reason."
    )


def test_the_known_gaps_ledger_is_exact():
    """An allowlist nobody prunes is how a ratchet rusts.

    Every entry must still name a real INSERT that still omits the column. Fix
    one of them and this fails until the entry goes — which is the point.
    """
    live = {
        p.key for p in _write_paths(CONTACTS, "INSERT")
        if "client_id" not in _column_list(p.sql, CONTACTS)
    }
    live |= {
        p.key for p in _write_paths(INVOICES, "INSERT")
        if "client_id" not in _column_list(p.sql, INVOICES)
    }
    live |= {p.key for p in _write_paths(CONTACTS, "UPDATE") if p.is_fstring}

    stale = sorted(k for k in KNOWN_GAPS if k not in live)
    assert not stale, (
        f"KNOWN_GAPS names paths that no longer have a gap: {stale}. "
        "Delete the entries — the ratchet only holds if it is tightened."
    )


def test_no_contact_update_can_null_the_company_it_was_not_asked_about():
    """A PATCH that omits a field must never null it.

    Two shapes are safe and nothing else is. A statement built from an
    `exclude_unset` dict cannot mention a column the request did not, so an
    edit to a phone number leaves the employer alone. A fixed statement is
    read here in full: it may set `client_id` deliberately, but never to a
    bare NULL, which would unlink a company as a side effect of some unrelated
    write.
    """
    for p in _write_paths(CONTACTS, "UPDATE"):
        if p.is_fstring:
            src = (BACKEND / p.file).read_text(encoding="utf-8")
            assert "exclude_unset" in src or p.key in KNOWN_GAPS, (
                f"{p} builds its SET list dynamically without the "
                "exclude_unset idiom, so a field the caller omitted can still "
                "reach the statement and null client_id."
            )
            continue
        assert "client_id=null" not in p.sql.replace(" ", ""), (
            f"{p} sets client_id to a literal NULL, silently unlinking the "
            "company a contact belongs to."
        )


def test_an_upsert_never_re_points_an_existing_contacts_company():
    """`ON CONFLICT ... DO UPDATE` runs on rows somebody else already owns.

    `POST /graha/f/{slug}` is public: anyone can submit the same form twice.
    The second submission takes the DO UPDATE branch against a contact that
    already exists — possibly one a partner linked to a client by hand. If
    `client_id` were in that SET list, a stranger resubmitting a form could
    move, or clear, a real client link from outside the org.
    """
    for p in _write_paths(CONTACTS, "INSERT"):
        if "do update set" not in p.sql:
            continue
        after = p.sql.split("do update set", 1)[1].split("returning", 1)[0]
        assert "client_id" not in after, (
            f"{p} lets a conflicting INSERT rewrite client_id on a contact "
            "that already exists."
        )


def test_every_invoice_insert_carries_the_company():
    """Money owed has to be owed by somebody.

    `ganit_invoices.client_id` is what files a receivable under the company
    that owes it — Client 360, receivables ageing, and every Niyam rule keyed
    on the customer read it. Six create paths omitted it: the create form was
    the only one that ever wrote it, and estimate conversion, recurring
    generation, from-deal, from-time-entries and Vikray's order-to-invoice all
    dropped a company they were holding at the time.
    """
    offenders = [
        p for p in _write_paths(INVOICES, "INSERT")
        if "client_id" not in _column_list(p.sql, INVOICES)
        and p.key not in KNOWN_GAPS
    ]
    assert not offenders, (
        "these INSERTs into staging.ganit_invoices do not name client_id, so "
        f"the invoice they raise belongs to no company: {offenders}"
    )


def test_every_order_insert_carries_the_company():
    """The Vikray half of the same rule. A customer is the firm that buys."""
    offenders = [
        p for p in _write_paths(ORDERS, "INSERT")
        if "client_id" not in _column_list(p.sql, ORDERS)
        and p.key not in KNOWN_GAPS
    ]
    assert not offenders, (
        f"these INSERTs into staging.vikray_orders do not name client_id: "
        f"{offenders}"
    )


def test_a_company_from_a_request_body_is_checked_against_the_caller_s_org():
    """The foreign key is not composite with `org_id`.

    Nothing in the database stops one organisation attaching its contact to
    another's company row; the check has to be in the write path. Both
    resolvers make it, and every path that accepts a `client_id` from a
    request goes through one of them.
    """
    import inspect

    from routers import graha, vikray

    for fn in (graha.resolve_contact_company, vikray.resolve_order_company):
        src = inspect.getsource(fn)
        assert "staging.graha_clients" in src
        assert "org_id=$2::uuid" in src
        assert "400" in src, "an unknown company must be refused, not written"

    # And the contact write paths actually call it, rather than binding the
    # request body straight into the statement.
    for fn in (graha.create_contact, graha.update_contact,
               graha.inbound_leads, graha.submit_web_form):
        assert "resolve_contact_company" in inspect.getsource(fn), (
            f"{fn.__name__} writes graha_contacts.client_id without the org "
            "check"
        )


def test_the_public_form_never_takes_a_company_from_its_payload():
    """`POST /graha/f/{slug}` is unauthenticated.

    A `client_id` read from the submitted JSON would let anyone on the
    internet declare themselves a client of the firm — and walk straight
    through the ICAI gate that exists to stop the firm marketing to
    strangers. The company may only come from the form's own configuration.
    """
    import inspect

    from routers import graha

    src = inspect.getsource(graha.submit_web_form)
    assert 'payload.get("client_id")' not in src, (
        "the public form must not read a company from the submitted payload"
    )
    assert 'form["settings"]' in src, (
        "the company must come from the form's own configuration"
    )
    assert "strict=False" in src, (
        "a company archived since the form went live must cost the firm a "
        "link, never the lead"
    )
