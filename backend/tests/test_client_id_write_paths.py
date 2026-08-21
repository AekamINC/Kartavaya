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
#: reason. They are recorded rather than silenced.
#:
#: An entry started life meaning "a defect owed", and three of the five were
#: exactly that and have been paid: `recurring_invoice_generator` now inherits
#: the company from the contact, and `contact_dedupe`'s merge carries it across
#: instead of destroying it. What is left is the other kind of entry — a path
#: where writing NO company is the true statement and the correct outcome, with
#: the argument written out so a later reader can disagree with the reasoning
#: rather than with a silence. Both remaining entries are of that kind, and both
#: say so in the first line. An entry that says "Owed:" is a debt; one that says
#: "SETTLED" is a decision.
KNOWN_GAPS: dict[tuple[str, str], str] = {
    ("routers/scrapers.py", "import_run_to_graha"):
        "Scraped leads — and SETTLED as correct, not owed. A scraper find is a "
        "stranger the firm does not act for, so a NULL company is the TRUE "
        "statement about that row and the ICAI gate refusing to email it is "
        "the gate working, not a defect. The note that used to stand here — "
        "'the import form should offer one' — is WITHDRAWN: a company box on a "
        "bulk import is one click that declares three hundred strangers "
        "clients of a real company and walks every one of them through the "
        "gate, leaving no evidence that anybody decided anything. The "
        "sanctioned route to a non-client already exists and is "
        "`prachar_compliance.assess_send`, which refuses and then takes a "
        "written basis recorded against the member's own name. Measured on the "
        "live database on 2026-08-21, SELECT-only: not one of the 291 live "
        "contacts carries a `scraper:` source, so none of the 126 unlinked "
        "came through this door — the question is entirely prospective, which "
        "is the cheapest moment there is to settle it. See "
        "test_a_scraped_lead_is_a_prospect_and_the_refusal_is_the_point.",
    ("services/lead_ingest.py", "_upsert"):
        "JustDial / IndiaMART marketplace push. Same verdict, and one reason "
        "more: nothing in the payload names a company, and accepting one from "
        "a marketplace would let an outside system declare a firm's client "
        "for it — on a route that is UNAUTHENTICATED by necessity, since "
        "JustDial pushes to a URL rather than calling with a key. The contact "
        "is written as a visible `lead` carrying its source, which is the "
        "state a human can see and act on. Measured on the live database on "
        "2026-08-21, SELECT-only: no live contact carries a `justdial` or "
        "`indiamart` source either, so this door has written nothing yet "
        "and the rule is settled before the first row rather than after it.",
}

#: The OTHER safe shape for a dynamic contact UPDATE, and the only module that
#: has it.
#:
#: `exclude_unset` is the guarantee a REQUEST-shaped statement gives: the SET
#: list cannot mention a column the caller did not. `contact_dedupe` is not
#: request-shaped at all — no caller ever names a column there. The names come
#: from `_MERGEABLE_FIELDS` and `_JSON_FIELDS` on the way in and are filtered
#: back through `_UNDOABLE_FIELDS` on the way out, which is the server-side
#: allowlist idiom CLAUDE.md names for dynamic identifiers.
#:
#: That is a different guarantee, so it gets a stricter test rather than a hole
#: in the general one. `test_the_merge_can_only_name_columns_off_its_own_
#: allowlist` reads both functions' SET fragments out of the AST, and
#: `test_an_undo_cannot_be_steered_by_a_poisoned_merge_record` drives the
#: filter with a merge record naming a column that is not on the list.
_ALLOWLIST_BUILT_SET_LISTS: dict[tuple[str, str], str] = {
    ("services/contact_dedupe.py", "merge_contacts"):
        "SET names come from `_MERGEABLE_FIELDS` / `_JSON_FIELDS`, and each is "
        "written only where the survivor's value is blank — so no field the "
        "merge was not asked about can reach the statement, and `client_id` "
        "can only ever be filled in, never cleared.",
    ("services/contact_dedupe.py", "undo_merge"):
        "SET names come from the stored `field_updates`, filtered against "
        "`_UNDOABLE_FIELDS` before any of them is interpolated. `client_id` "
        "reverts through `NULLIF($n,'')::uuid`, which is a real NULL and not "
        "an empty string at a uuid cast.",
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

    # The second ledger, held to the same standard. An entry here claims a
    # dynamic contact UPDATE exists and is safe by the allowlist idiom; if the
    # statement is gone, or has become a fixed one, the claim is about nothing.
    updates = {p.key for p in _write_paths(CONTACTS, "UPDATE") if p.is_fstring}
    orphaned = sorted(k for k in _ALLOWLIST_BUILT_SET_LISTS if k not in updates)
    assert not orphaned, (
        f"_ALLOWLIST_BUILT_SET_LISTS names paths with no dynamic contact "
        f"UPDATE left in them: {orphaned}. Delete the entries."
    )

    # And nothing may sit in both. One says "this path writes no company", the
    # other says "this path writes it and here is why that is safe"; a key in
    # both would mean neither statement is being checked.
    both = sorted(set(KNOWN_GAPS) & set(_ALLOWLIST_BUILT_SET_LISTS))
    assert not both, f"these paths are recorded as both a gap and safe: {both}"


def test_no_contact_update_can_null_the_company_it_was_not_asked_about():
    """A PATCH that omits a field must never null it.

    Three shapes are safe and nothing else is. A statement built from an
    `exclude_unset` dict cannot mention a column the request did not, so an
    edit to a phone number leaves the employer alone. A statement whose column
    names come from a module-level allowlist instead of from a caller is safe
    for a stronger reason — no request can name a column there at all — and is
    listed in `_ALLOWLIST_BUILT_SET_LISTS`, where the entry carries the two
    tests that actually prove it. A fixed statement is read here in full: it
    may set `client_id` deliberately, but never to a bare NULL, which would
    unlink a company as a side effect of some unrelated write.
    """
    for p in _write_paths(CONTACTS, "UPDATE"):
        if p.is_fstring:
            src = (BACKEND / p.file).read_text(encoding="utf-8")
            safe = ("exclude_unset" in src
                    or p.key in _ALLOWLIST_BUILT_SET_LISTS
                    or p.key in KNOWN_GAPS)
            assert safe, (
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


# ── The merge, which used to destroy the link rather than move it ───────────
#
# `services/contact_dedupe.merge_contacts` is the one write path that can take a
# company AWAY from a live contact. It backfills a survivor from the loser and
# then tombstones the loser (`is_active=FALSE`), which every audience already
# excludes — so a field it does not carry across is not left behind, it is gone.
# `client_id` was not on `_MERGEABLE_FIELDS`, so tidying two duplicates of one
# person quietly turned a contactable person into an uncontactable one.
#
# These tests drive the real functions against a connection that records SQL,
# because the property is about which columns and which BINDS a statement
# carries — and the suite's shared pool is a MagicMock that would answer
# happily for either.

class _RecordingConn:
    """Enough asyncpg to run a merge or an undo, and a log of what was written.

    `_referencing_tables` answers empty on purpose: re-pointing foreign keys is
    a different concern with its own coverage, and an empty catalog keeps these
    tests on the one statement they are about — the SET list.
    """

    def __init__(self, contacts=None, merges=None):
        self.contacts = contacts or {}
        self.merges = merges or {}
        self.executed: list[tuple[str, tuple]] = []

    def transaction(self):
        class _Txn:
            async def __aenter__(_s):
                return None

            async def __aexit__(_s, *exc):
                return False

        return _Txn()

    async def fetch(self, sql, *args):
        return []                       # no FK tables, no unique indexes

    async def fetchval(self, sql, *args):
        return False

    async def fetchrow(self, sql, *args):
        q = " ".join(sql.split())
        if "INSERT INTO staging.graha_contact_merges" in q:
            self.executed.append((q, args))
            return {"id": "00000000-0000-0000-0000-0000000000ff"}
        if "staging.graha_contact_merges" in q:
            return self.merges.get(str(args[0]))
        if "staging.graha_contacts" in q:
            return self.contacts.get(str(args[0]))
        return None

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))

    # The statements a test wants to read back.
    def contact_updates(self) -> list[tuple[str, tuple]]:
        return [(s, a) for s, a in self.executed
                if s.startswith("UPDATE staging.graha_contacts SET")]

    def backfill(self) -> tuple[str, tuple]:
        """The SET list built from the allowlist — never the fixed tombstone or
        reactivation statements, which name their own columns."""
        for s, a in self.contact_updates():
            if "is_active=" not in s:
                return s, a
        raise AssertionError("no dynamic contact UPDATE was issued: "
                             f"{[s for s, _ in self.executed]}")


class _RecordingPool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        conn = self.conn

        class _Acq:
            async def __aenter__(_s):
                return conn

            async def __aexit__(_s, *exc):
                return False

        return _Acq()


#: Every column `merge_contacts` reads off a row, so a fixture is a whole
#: contact rather than the two fields a test happens to care about — a KeyError
#: from a missing one would look like a failure of the thing under test.
def _contact(**kw) -> dict:
    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "", "email": "", "phone": "", "company": "", "designation": "",
        "gstin": "", "pan": "", "notes": "", "source": "", "client_id": None,
        "billing_address": None, "shipping_address": None,
        "tags": [], "lead_score": 0,
    }
    row.update(kw)
    return row


SURVIVOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
LOSER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
ORG = "cccccccc-cccc-cccc-cccc-cccccccccccc"
COMPANY = "dddddddd-dddd-dddd-dddd-dddddddddddd"
OTHER_COMPANY = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
MERGE = "ffffffff-ffff-ffff-ffff-ffffffffffff"


async def test_a_merge_carries_the_company_and_does_not_destroy_it():
    """THE regression. Two rows for one person, one of whom has an employer.

    Before this, the survivor kept its NULL and the loser became a tombstone —
    so the CRM went from holding one emailable record of this person to holding
    none, and the only thing that changed was somebody tidying up.
    """
    from services import contact_dedupe

    conn = _RecordingConn(contacts={
        SURVIVOR: _contact(id=SURVIVOR, name="R. Kumar", client_id=None),
        LOSER: _contact(id=LOSER, name="Rajesh Kumar", client_id=COMPANY),
    })
    await contact_dedupe.merge_contacts(_RecordingPool(conn), ORG, SURVIVOR, [LOSER])

    sql, params = conn.backfill()
    assert "client_id=" in sql, (
        f"the merge did not carry the company across: {sql}"
    )
    assert COMPANY in [str(p) for p in params], (
        "the company was named in the SET list but its id was never bound"
    )


async def test_the_company_is_bound_through_nullif_and_not_at_a_bare_cast():
    """`NULLIF($n,'')::uuid`, the same shape every other clearable uuid uses.

    It matters here for the UNDO more than for the merge: the undo reverts this
    column to the value the survivor had before, which is always nothing, and an
    empty string arriving at a bare `::uuid` is a parse error PgBouncer returns
    as an instant 500. One bind shape for both directions is what makes the
    round trip work.
    """
    from services import contact_dedupe

    conn = _RecordingConn(contacts={
        SURVIVOR: _contact(id=SURVIVOR, client_id=None),
        LOSER: _contact(id=LOSER, client_id=COMPANY),
    })
    await contact_dedupe.merge_contacts(_RecordingPool(conn), ORG, SURVIVOR, [LOSER])

    import re

    sql, _ = conn.backfill()
    assert re.search(r"client_id=NULLIF\(\$\d+,''\)::uuid",
                     sql.replace(" ", "")), (
        f"client_id is not bound through NULLIF($n,'')::uuid: {sql}"
    )


async def test_a_merge_never_moves_a_company_the_survivor_already_has():
    """Backfill, not overwrite. Contacts come and go; the customer stays.

    A survivor already linked to a company must keep it. Re-pointing it at the
    loser's would file that person — and everything since filed under them —
    against a different firm, on the strength of a duplicate cleanup.
    """
    from services import contact_dedupe

    conn = _RecordingConn(contacts={
        SURVIVOR: _contact(id=SURVIVOR, client_id=COMPANY),
        LOSER: _contact(id=LOSER, client_id=OTHER_COMPANY),
    })
    await contact_dedupe.merge_contacts(_RecordingPool(conn), ORG, SURVIVOR, [LOSER])

    for sql, params in conn.contact_updates():
        assert "client_id=" not in sql, (
            f"the merge re-pointed a survivor that already had a company: {sql}"
        )
        assert OTHER_COMPANY not in [str(p) for p in params]


async def test_an_undone_merge_puts_the_company_back_where_it_came_from():
    """An undo has to restore the state before the merge EXACTLY.

    That means the survivor's `client_id` goes back to NULL — it is unemailable
    again, and it should be, because the row that holds the company is the loser
    being reactivated on the next statement. Restoring a merge must not leave
    one company attached to two contacts.

    The bind is the trap: the generic text branch binds the empty string for a
    missing value, which at a uuid column is a 500 and not a NULL.
    """
    import json

    from services import contact_dedupe

    conn = _RecordingConn(
        contacts={LOSER: _contact(id=LOSER, client_id=COMPANY)},
        merges={MERGE: {
            "id": MERGE, "undone_at": None, "created_at": "2026-08-21",
            "survivor_id": SURVIVOR, "merged_id": LOSER,
            "dropped_rows": {},
            "field_updates": json.dumps({"client_id": {"from": None, "to": COMPANY}}),
        }},
    )
    await contact_dedupe.undo_merge(_RecordingPool(conn), ORG, MERGE)

    sql, params = conn.backfill()
    assert "client_id=NULLIF(" in sql.replace(" ", ""), (
        f"the undo binds client_id at a bare cast: {sql}"
    )
    assert "" in [p for p in params if isinstance(p, str)], (
        "the undo must bind the empty string that NULLIF turns into a real NULL"
    )
    assert COMPANY not in [str(p) for p in params], (
        "the undo left the company on the survivor, so both rows now claim it"
    )

    # And the loser is reactivated without its own company being touched.
    reactivate = next(s for s, _ in conn.contact_updates() if "is_active=TRUE" in s)
    assert "client_id" not in reactivate


async def test_an_undo_cannot_be_steered_by_a_poisoned_merge_record():
    """`field_updates` is jsonb, and its KEYS become SQL identifiers.

    `merge_contacts` is the only writer today and only ever names its own
    allowlist, so nothing is wrong — but an identifier read out of stored data
    and spliced into a SET list is safe by luck, and the two functions are a
    long way apart. `_UNDOABLE_FIELDS` filters the keys before any of them is
    interpolated; this is the test that proves the filter is load-bearing.
    """
    import json

    from services import contact_dedupe

    conn = _RecordingConn(
        contacts={LOSER: _contact(id=LOSER)},
        merges={MERGE: {
            "id": MERGE, "undone_at": None, "created_at": "2026-08-21",
            "survivor_id": SURVIVOR, "merged_id": LOSER,
            "dropped_rows": {},
            "field_updates": json.dumps({
                "org_id": {"from": "99999999-9999-9999-9999-999999999999"},
                "is_active": {"from": False},
                "client_id": {"from": None, "to": COMPANY},
            }),
        }},
    )
    await contact_dedupe.undo_merge(_RecordingPool(conn), ORG, MERGE)

    sql, _ = conn.backfill()
    assert "org_id=" not in sql, f"a stored key reached the SET list: {sql}"
    assert "is_active=" not in sql, f"a stored key reached the SET list: {sql}"
    assert "client_id=" in sql, "the real field was dropped along with the poison"


def test_the_merge_can_only_name_columns_off_its_own_allowlist():
    """The structural half, and what earns `_ALLOWLIST_BUILT_SET_LISTS`.

    Both functions build their SET list with an f-string. Neither uses
    `exclude_unset`, because neither is request-shaped — no caller names a
    column in this module at all. What has to be true instead is that every
    interpolated column name comes from a module-level allowlist: either the
    loop iterates one, or the loop refuses anything that is not on one.

    Read out of the AST rather than by eye, so the claim in the ledger above
    cannot quietly stop being true.
    """
    import re

    module = ast.parse((BACKEND / "services/contact_dedupe.py")
                       .read_text(encoding="utf-8"))

    # Module-level names bound to nothing but string literals (and to other
    # such names) — `_MERGEABLE_FIELDS`, `_JSON_FIELDS`, `_UUID_FIELDS`,
    # `_UNDOABLE_FIELDS`.
    allowlists: set[str] = set()
    for node in module.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        constants = [n for n in ast.walk(node.value) if isinstance(n, ast.Constant)]
        names = [n for n in ast.walk(node.value)
                 if isinstance(n, ast.Name) and n.id != target.id]
        if not constants:
            continue
        if (all(isinstance(c.value, str) for c in constants)
                and all(n.id in allowlists or n.id in ("frozenset", "set")
                        for n in names)):
            allowlists.add(target.id)

    assert {"_MERGEABLE_FIELDS", "_JSON_FIELDS", "_UNDOABLE_FIELDS"} <= allowlists, (
        f"the allowlists this test exists to find are not there: {allowlists}"
    )

    functions = {n.name: n for n in ast.walk(module)
                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    literal_column = re.compile(r"^[a-z_]+=")
    checked = 0

    for name in ("merge_contacts", "undo_merge"):
        fn = functions[name]

        # Names that can only hold a column off an allowlist: a `for` target
        # over one, or a name a `not in <allowlist> … continue` guard protects.
        safe_names: set[str] = set()
        for node in ast.walk(fn):
            if (isinstance(node, ast.For) and isinstance(node.iter, ast.Name)
                    and node.iter.id in allowlists):
                safe_names |= {t.id for t in ast.walk(node.target)
                               if isinstance(t, ast.Name)}
            if (isinstance(node, ast.If) and isinstance(node.test, ast.Compare)
                    and len(node.test.ops) == 1
                    and isinstance(node.test.ops[0], ast.NotIn)
                    and isinstance(node.test.left, ast.Name)
                    and isinstance(node.test.comparators[0], ast.Name)
                    and node.test.comparators[0].id in allowlists
                    and any(isinstance(b, ast.Continue) for b in ast.walk(node))):
                safe_names.add(node.test.left.id)

        for call in ast.walk(fn):
            if not (isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Attribute)
                    and call.func.attr == "append"
                    and isinstance(call.func.value, ast.Name)
                    and call.func.value.id == "sets"
                    and call.args):
                continue
            checked += 1
            arg = call.args[0]
            head = arg.values[0] if isinstance(arg, ast.JoinedStr) else arg

            if isinstance(head, ast.Constant):
                assert literal_column.match(head.value), (
                    "a SET fragment does not begin with a column name in "
                    f"{name}: {head.value!r}"
                )
                continue

            assert (isinstance(head, ast.FormattedValue)
                    and isinstance(head.value, ast.Name)), (
                f"{name} interpolates something other than a plain name as a "
                f"column: {ast.dump(head)}"
            )
            assert head.value.id in safe_names, (
                f"{name} interpolates `{head.value.id}` as a column name, and "
                "nothing in the function constrains it to an allowlist. A "
                "value from anywhere else becomes a SQL identifier here — "
                "including one that could null client_id."
            )

    assert checked >= 8, (
        f"only {checked} SET fragments were examined; the walk has stopped "
        "finding them and this test is passing on nothing"
    )


# ── The recurring cron, which is the twin of a button ───────────────────────

def test_the_recurring_cron_inherits_the_company_the_button_does():
    """Two copies of one billing path must not disagree about whose invoice it is.

    `ganit.generate_recurring_invoice` (the Generate-now button) and
    `services/skills/action/recurring_invoice_generator.generate_due_invoices`
    (the cron) write the same document from the same template. The button was
    fixed to inherit the company from the contact the profile bills; this is the
    assertion that the cron does it the same way, through the same org-scoped
    helper, rather than growing a second answer.

    A retainer is the longest-lived billing relationship a firm has, so the
    recurring revenue was the revenue least visible per customer while this was
    missing — every month's invoice filed under "Unlinked client".
    """
    import inspect

    from services.skills.action import recurring_invoice_generator as gen

    src = inspect.getsource(gen.generate_due_invoices)
    assert "resolve_order_company" in src, (
        "the cron resolves no company, or resolves one its own way"
    )
    assert "NULLIF(" in src and "::uuid" in src, (
        "the company must be bound as NULLIF($n,'')::uuid — a profile whose "
        "contact has no employer still generates its invoice, and an untyped "
        "NULL through PgBouncer is the parse error that reads as a 500"
    )


# ── The two lead doors, and why they are RIGHT to write no company ──────────

def test_a_scraped_lead_is_a_prospect_and_the_refusal_is_the_point():
    """The argument for leaving both entries in `KNOWN_GAPS`.

    A scraped row and a marketplace enquiry are, by definition, people the firm
    does not yet act for. `client_id IS NULL` is the TRUE statement about them,
    and the ICAI gate declining to email them is Clause (6) being obeyed rather
    than a defect to engineer around: soliciting a non-client by email is
    professional misconduct, and the exposure is the member's.

    So the thing to prove is not that these paths can be made to write a
    company. It is that the product already treats what they write honestly:
    counted as a prospect, refused by default, and reachable only by a decision
    somebody puts their name to.
    """
    from services import prachar_compliance as pc

    scraped = {"id": "1", "email": "someone@example.com", "client_id": None}
    a_client = {"id": "2", "email": "real@example.com", "client_id": COMPANY}

    clients, prospects = pc.split_by_client_linkage([scraped, a_client])
    assert prospects == [scraped] and clients == [a_client], (
        "a contact with no company must count as a prospect — an absent fact "
        "is not evidence of a relationship"
    )

    # Unclassified: refused, and NOT overridable. You may not override your way
    # past a template nobody has characterised.
    verdict = pc.assess_send(contacts=[scraped], template_class=None,
                             override_basis="x" * 200)
    assert not verdict.allowed and verdict.code == "blocked_unclassified"

    # Classified: still refused, and the override is a written basis recorded
    # against the member. This is the sanctioned route to a non-client, and it
    # is why a company box on a bulk import would be the wrong one — it would
    # reach the same people with no decision and no evidence.
    klass = pc.TEMPLATE_CLASSES["knowledge_update"]
    assert not pc.assess_send(contacts=[scraped], template_class=klass).allowed
    with_basis = pc.assess_send(
        contacts=[scraped], template_class=klass,
        override_basis="Former client of the firm, asked to be kept on the list.")
    assert with_basis.allowed and with_basis.code == "allowed_by_override"
    assert with_basis.override_basis, "an override must record what was said"


def test_neither_lead_door_reads_a_company_out_of_what_it_was_sent():
    """The half of the verdict that is a rule rather than an argument.

    JustDial pushes to a URL and cannot be asked to authenticate; a scraper run
    is a machine's find. Letting either name a company would let an outside
    system declare a firm's client for it — and walk straight through the gate
    that exists to stop the firm writing to strangers.
    """
    import inspect

    from routers import scrapers
    from services import lead_ingest

    for fn in (scrapers.import_run_to_graha, lead_ingest._upsert):
        src = inspect.getsource(fn)
        assert "client_id" not in src, (
            f"{fn.__name__} names a company. Neither of these paths has one to "
            "name: the row is a stranger, and KNOWN_GAPS records why that is "
            "the correct outcome rather than a defect."
        )


def test_a_lead_nobody_can_email_is_still_a_lead_somebody_can_see():
    """A missing company must be a visible state, not a silent one.

    Both paths write `contact_type='lead'` and a `source` that says where the
    row came from, and `GET /graha/contacts` returns `client_id` beside
    `client_name` off an org-scoped join — so the person looking at the CRM can
    see which rows carry no company and link the ones that should be linked. An
    unemailable contact the product never mentions is the defect this whole file
    exists about; an unemailable contact shown as a lead from JustDial is a work
    item.
    """
    import inspect

    from routers import graha, scrapers
    from services import lead_ingest

    for fn in (scrapers.import_run_to_graha, lead_ingest._upsert):
        src = inspect.getsource(fn)
        assert "'lead'" in src, f"{fn.__name__} does not mark the row a lead"
        assert "source" in src, f"{fn.__name__} does not record where it came from"

    listing = inspect.getsource(graha.list_contacts)
    assert "c.client_id" in listing and "client_name" in listing, (
        "the contacts list must carry the company, or no reader can tell a "
        "linked contact from an unlinked one"
    )
    assert "cl2.org_id = c.org_id" in listing, (
        "the company name is joined on the id alone, which can print another "
        "organisation's client against this org's contact"
    )
