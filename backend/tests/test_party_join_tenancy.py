"""No party table is joined on the id alone — across the WHOLE backend.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

`JOIN staging.graha_clients cl ON cl.id = i.client_id` is scoped by nothing.
The driving row is filtered `WHERE i.org_id = $1`, but the client row that join
reaches is whichever organisation's company happens to hold that uuid — and the
NAME it carries is what the page renders, what the PDF prints and what the email
says. It is the documented cross-tenant leak shape in this repo.

This check was written in `tests/test_client_billing_invoices.py` and it worked,
but it walked ONE module: `ast.parse(inspect.getsource(client_billing))`. The
ledger reported it without that qualifier, so it read as repo-wide. It was not.
Re-running its exact logic over all of `backend/` on 2026-08-26 found:

    party joins scanned            114
    scoped by the id alone          42
    of those, in client_billing      0

Every offender was outside the reach of the check that was supposed to be
catching them. Four were on `graha_clients` — the table the plan actually names
as the leak — and those four are fixed. The other 38 are on `graha_contacts`
and are recorded in `KNOWN_ID_ALONE` below.

── WHAT THE DATABASE DOES NOT DO FOR US ─────────────────────────────────────

Read from `pg_constraint` on 2026-08-26, not from a migration file: every
foreign key involved points at `id` ALONE.

    graha_deals_client_id_fkey       graha_deals.client_id    -> graha_clients(id)
    graha_deals_contact_id_fkey      graha_deals.contact_id   -> graha_contacts(id)
    ganit_invoices_client_id_fkey    ganit_invoices.client_id -> graha_clients(id)
    ganit_invoices_contact_id_fkey   ganit_invoices.contact_id-> graha_contacts(id)

There is no composite `(id, org_id)` constraint anywhere, so NOTHING in the
schema stops one organisation's row from pointing at another's company. The join
predicate is the only thing enforcing tenancy on these reads. That is why this
is a ratchet and not a one-off audit.

Whether a row has actually leaked yet is a separate question, and it was asked
of the live database the same day — ID SETS compared with `EXCEPT`, never byte
counts, because two orgs holding the same COUNT of clients tells you nothing:

    E2E Test & Associates   deal client_ids not owned by the org   0 of 18
                            invoice client_ids not owned            0 of 31
    Unicode Group           deal client_ids not owned by the org   0 of 20
                            invoice client_ids not owned            0 of 13

So no row has leaked. The fix is preventive and this file says so plainly rather
than claiming a save that did not happen.

── THE ALLOWLIST IS A LEDGER, NOT AN ESCAPE HATCH ───────────────────────────

`KNOWN_ID_ALONE` is checked to be EXACT. An entry whose count grows fails; an
entry whose count falls fails too, with an instruction to ratchet it down. A
new offender in a file nobody has touched fails hardest of all. The number can
only ever go down, and it cannot go down silently.
"""
import ast
import collections
import os
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent

#: Directory names that end a walk. `tests` because a test asserting on SQL
#: text is not a query anyone runs; `.venv` because third-party code is not
#: ours to scope.
_SKIP_DIRS = {"tests", ".venv", "__pycache__", "node_modules"}

# ── the promoted logic, unchanged ────────────────────────────
# These two constants, and the matching in `_joins_in` that uses them, are
# lifted verbatim from the module-scoped original in
# `tests/test_client_billing_invoices.py`. Only the reach changed: one module
# became every file under `backend/`. Keeping the matching identical is what
# makes the 114/42 figures above comparable with the ones that check produced.

_PARTY_TABLES = ("graha_clients", "graha_contacts")

_NEXT_CLAUSE = re.compile(
    r"\b(WHERE|JOIN|LEFT|RIGHT|INNER|CROSS|ORDER\s+BY|GROUP\s+BY|LIMIT|UNION)\b",
    re.I,
)

#: SQL line comments, removed before any of the above is applied.
#:
#: The ONE addition to the promoted logic, and it changes no count: 114 joins
#: and 38 offenders either way, measured both ways on 2026-08-26. It is here
#: because an ON clause is read by scanning forward to the next SQL keyword, so
#: a `-- ` comment written between two JOINs is part of the clause as far as
#: this file is concerned. English prose in one can both TRUNCATE a real
#: predicate (any sentence containing the word "where") and, far worse, supply
#: a fake one — `-- this join needs c.org_id` would satisfy the check with a
#: sentence. `test_a_comment_can_neither_fake_nor_hide_a_predicate` holds it.
_SQL_COMMENT = re.compile(r"--[^\n]*")


#: Every join scoped by the id alone that exists TODAY, keyed
#: `(file, function, table)` and carrying the number of them in that function.
#:
#: KEYED ON THE FUNCTION AND NOT THE LINE NUMBER, deliberately. A line number is
#: invalidated by an edit three hundred lines above it, and an allowlist that
#: goes stale on every unrelated commit gets deleted rather than maintained. The
#: function name is the smallest thing that survives ordinary editing and still
#: says exactly which query is meant.
#:
#: The COUNT is what makes this a ratchet. `crm_today` holds six of these in one
#: handler; recording the six means a seventh fails this file even though the
#: function is already listed.
#:
#: EVERY ENTRY IS `graha_contacts`. That is not a coincidence and not a policy —
#: the four `graha_clients` offenders were fixed rather than listed, and
#: `test_no_graha_clients_join_is_ever_recorded_here` holds that line.
KNOWN_ID_ALONE: dict[tuple[str, str, str], tuple[int, str]] = {

    # ── THE SEND PATHS ──────────────────────────────────────────────────────
    # These three are the ones that matter most and they are listed first for
    # that reason. Everywhere else a wrong name is rendered on a screen the
    # reader can question; here it is composed into a message and handed to
    # SES. `OUTBOUND_MODE=live` since 2026-08-18, so these send real mail.
    #
    # NOT FIXED HERE BECAUSE THIS SESSION DOES NOT OWN THOSE FILES — six agents
    # are partitioned by file and an edit outside the partition is clobbered.
    # They are a debt, recorded so the next session can find them in one place.
    ("services/skills/action/campaign_sender.py", "send_campaign",
     "graha_contacts"): (
        2,
        "Owed: the recipient projection (`c.name`, `c.company`) fills the "
        "`{{name}}` and `{{company}}` merge fields of an email that is then "
        "SENT, and the ICAI client gate below it re-reads `gc.client_id` off "
        "the same unscoped join — so a foreign contact would be checked "
        "against a foreign linkage as well. Both joins hang off "
        "`prachar_campaign_contacts.contact_id`; `cc` itself carries no "
        "org_id, so the fix needs the campaign's org threaded in, not a "
        "one-line predicate."),

    ("services/skills/action/sequence_step_executor.py", "execute_step",
     "graha_contacts"): (
        1,
        "Owed, and the worst of the three: this join supplies `c.email` — the "
        "ADDRESS the step sends to — as well as the name and company written "
        "into the body. Every other offender in this ledger can only mislabel "
        "a row; this one can deliver another organisation's mail. `se.org_id` "
        "does not exist on the enrolment; the org arrives via "
        "`prachar_sequences s`, so the predicate is `c.org_id = s.org_id`."),

    # ── READ PATHS: CRM ─────────────────────────────────────────────────────
    ("routers/graha.py", "crm_today", "graha_contacts"): (
        6,
        "Six joins in one handler — the today screen's follow-ups, tasks and "
        "recent activity. Every one of them renders `c.name`."),
    ("routers/graha.py", "list_deals", "graha_contacts"): (
        1, "Deal list: `c.name AS contact_name`, `c.company`."),
    ("routers/graha.py", "deals_kanban", "graha_contacts"): (
        1, "Kanban card: `c.name AS contact_name`, `c.company`."),
    ("routers/graha.py", "get_deal", "graha_contacts"): (
        1, "Deal detail: contact name, email and GSTIN on one sheet."),
    ("routers/graha.py", "list_follow_ups", "graha_contacts"): (
        1, "Follow-up list: whose follow-up it is."),
    ("routers/graha.py", "list_merges", "graha_contacts"): (
        2,
        "The dedupe ledger joins BOTH sides — survivor and merged — so it "
        "carries two of these. A merge record names two contacts by id and "
        "the screen renders both names."),
    ("routers/graha.py", "get_document", "graha_contacts"): (
        1, "Document detail: the contact the file is filed under."),

    # ── READ PATHS: BILLING AND DOCUMENTS ───────────────────────────────────
    ("routers/ganit.py", "list_invoices", "graha_contacts"): (
        1, "Invoice list: `c.name AS contact_name`."),
    ("routers/ganit.py", "get_invoice", "graha_contacts"): (
        1, "Invoice detail: the contact the invoice is addressed to."),
    ("routers/ganit.py", "download_invoice_pdf", "graha_contacts"): (
        1,
        "The name printed on the invoice PDF — a document the customer keeps "
        "and an auditor may read years later."),
    ("routers/ganit.py", "email_invoice", "graha_contacts"): (
        1,
        "Owed, and closer to a send path than the rest of this section: the "
        "name goes into an email. The ADDRESS does not come from here, which "
        "is the only reason it is not filed above with the other three."),
    ("routers/ganit.py", "list_recurring", "graha_contacts"): (
        1,
        "Recurring-invoice list — and the template a later sweep raises real "
        "invoices from."),
    ("routers/ganit.py", "list_contracts", "graha_contacts"): (
        1, "Contract list: the counterparty a contract names."),
    ("routers/ganit.py", "get_contract", "graha_contacts"): (
        1, "Contract detail: the same counterparty, on its own screen."),
    ("routers/ganit.py", "list_expenses", "graha_contacts"): (
        1, "Expense list: the contact an expense is attributed to."),
    ("routers/ganit.py", "collections", "graha_contacts"): (
        1,
        "The dunning list. It says who to chase about an unpaid invoice, so a "
        "wrong name here is a letter sent to the wrong person about somebody "
        "else's money. The `graha_clients` join in the SAME statement was "
        "fixed; this one is owed."),
    ("routers/ganit.py", "bank_line_candidates", "graha_contacts"): (
        1,
        "Reconciliation candidates. A wrong name here is offered as a MATCH "
        "for a bank line, so it is a step from being written down."),
    ("routers/documents.py", "download_quotation_pdf", "graha_contacts"): (
        1,
        "The name printed on a quotation PDF, which is sent to the party it "
        "names."),
    ("routers/documents.py", "download_agreement_pdf", "graha_contacts"): (
        1,
        "The name printed on an agreement PDF — the party a signature is "
        "collected from."),
    ("routers/documents.py", "_build_gstr1", "graha_contacts"): (
        1,
        "GSTR-1. A counterparty name on a filed return, which is the one "
        "place on this list where the wrong name is submitted to a "
        "government rather than shown to a reader."),
    ("routers/documents.py", "_tally_rows", "graha_contacts"): (
        1,
        "The Tally export. A wrong party name here is imported into the "
        "firm's accounting package, where nobody re-checks it."),

    # ── READ PATHS: SALES, MARKETING, ANALYTICS ─────────────────────────────
    ("routers/vikray.py", "list_orders", "graha_contacts"): (
        1,
        "Order list: the buyer's name. The `graha_clients` join beside it in "
        "the same router was already scoped (vikray.py:1439)."),
    ("routers/vikray.py", "get_order", "graha_contacts"): (
        1, "Order detail: the same buyer, on its own screen."),
    ("routers/prachar.py", "get_sequence", "graha_contacts"): (
        1,
        "The enrolment list on a sequence's own screen. The SENDER that acts "
        "on those enrolments is listed at the top of this ledger."),
    ("routers/prachar.py", "list_registrations", "graha_contacts"): (
        1,
        "Event registrations — who the firm believes is attending, which is "
        "also the list a reminder is sent from."),
    ("routers/dristi.py", "pipeline_analytics", "graha_contacts"): (
        1, "Pipeline analytics grouped by contact."),
    ("analytics/metrics/graha.py", "win_rate", "graha_contacts"): (
        1, "Win-rate metric, grouped by contact."),
    ("services/crm_report.py", "gather", "graha_contacts"): (
        1,
        "The CRM report's raw deal sheet — the CSV and the last tab of the "
        "workbook. The `graha_clients` join alongside it in the same "
        "statement WAS fixed; this one is owed."),
    ("services/skills/detect/reconciliation_matcher.py",
     "fuzzy_match_transactions", "graha_contacts"): (
        1,
        "Fuzzy bank matching reads `c.name` to score a candidate. A foreign "
        "name in the pool does not just display wrong, it can WIN the match."),
}


# ── the walk ─────────────────────────────────────────────────

class _Join:
    """One `JOIN staging.<party table>`, and whether it is scoped."""

    def __init__(self, file: str, func: str, table: str, alias: str,
                 clause: str):
        self.file = file
        self.func = func
        self.table = table
        self.alias = alias
        self.clause = " ".join(clause.split())

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.file, self.func, self.table)

    @property
    def scoped(self) -> bool:
        return f"{self.alias}.org_id" in self.clause

    def __str__(self) -> str:                 # pragma: no cover - messages only
        return (f"{self.file}::{self.func}  "
                f"JOIN public.{self.table} {self.alias} ON {self.clause}")


def _scanned_files() -> list[pathlib.Path]:
    return [p for p in sorted(BACKEND.rglob("*.py"))
            if not (_SKIP_DIRS & set(p.relative_to(BACKEND).parts))]


def _joins_in(sql: str, file: str = "<literal>",
              func: str = "<literal>") -> list[_Join]:
    """Every party-table join in ONE SQL string.

    Split out from the walk so the matching can be driven with a string written
    here in the test, which is the only way to prove it against a shape the
    tree does not currently contain.
    """
    sql = _SQL_COMMENT.sub("", sql)
    found: list[_Join] = []
    for table in _PARTY_TABLES:
        for m in re.finditer(
                rf"JOIN\s+public\.{table}\s+(\w+)\s+ON\b", sql, re.I):
            rest = sql[m.end():]
            stop = _NEXT_CLAUSE.search(rest)
            found.append(_Join(file, func, table, m.group(1),
                               rest[:stop.start()] if stop else rest))
    return found


def _party_joins() -> tuple[list[_Join], list[str]]:
    """Every party-table join in the tree, plus any file that would not parse.

    Read through the AST and not with grep, for the reason the original gave:
    adjacent string literals are folded into one Constant by the parser, so a
    query assembled across six source lines arrives here whole — and a query
    quoted inside a comment does not arrive at all.

    A file that fails to parse is RETURNED rather than skipped. The first draft
    of this walk swallowed `SyntaxError` and silently dropped nine files that
    begin with a UTF-8 BOM, `utils.py` and `routers/reports.py` among them. A
    ratchet that quietly stops looking at a file is worse than no ratchet, so
    the read uses `utf-8-sig` and anything still unreadable fails a test.
    """
    joins: list[_Join] = []
    unparseable: list[str] = []

    for path in _scanned_files():
        rel = path.relative_to(BACKEND).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        except (SyntaxError, UnicodeDecodeError) as exc:
            unparseable.append(f"{rel}: {type(exc).__name__}: {exc}")
            continue

        # Innermost enclosing function for every node, so a statement inside a
        # nested helper is attributed to the helper and not to its parent.
        owner: dict[int, str] = {}
        for parent in ast.walk(tree):
            name = getattr(parent, "name", None) if isinstance(
                parent, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
            for child in ast.iter_child_nodes(parent):
                owner[id(child)] = name or owner.get(id(parent), "<module>")

        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant)
                    and isinstance(node.value, str)):
                continue
            if "JOIN public." not in node.value:
                continue
            joins.extend(_joins_in(node.value, rel,
                                   owner.get(id(node), "<module>")))

    return joins, unparseable


ALL_JOINS, UNPARSEABLE = _party_joins()
ID_ALONE = [j for j in ALL_JOINS if not j.scoped]


# ══════════════════════════════════════════════════════════════════════════
#  1 · Guards on the walk itself
#
#  This repo has already shipped a check that passed while proving nothing —
#  `assert "state" in sql`, green against an endpoint that returned no state.
#  A source-walking ratchet fails the same way the moment the walk stops
#  reaching anything, and it fails GREEN. So the walk is measured first.
# ══════════════════════════════════════════════════════════════════════════

def test_the_walk_reaches_the_whole_backend():
    """321 files and 114 party joins on 2026-08-26. Floors, not equalities:
    the tree grows, and a ratchet that fails on every new file is a ratchet
    somebody deletes."""
    assert len(_scanned_files()) > 250, (
        f"only {len(_scanned_files())} files walked — the tree moved or "
        f"_SKIP_DIRS is eating something it should not")
    assert len(ALL_JOINS) >= 100, (
        f"only {len(ALL_JOINS)} party joins found, against 114 on the day this "
        f"was written. The matching has stopped working, not the codebase.")


def test_the_walk_reaches_the_files_the_offenders_live_in():
    """A named floor. If `routers/graha.py` ever stops being scanned, every
    check below goes green by looking at nothing."""
    scanned = {p.relative_to(BACKEND).as_posix() for p in _scanned_files()}
    for expected in ("routers/graha.py", "routers/ganit.py",
                     "services/crm_report.py", "routers/client_billing.py",
                     "services/skills/action/campaign_sender.py"):
        assert expected in scanned, f"{expected} was not walked"


def test_a_comment_can_neither_fake_nor_hide_a_predicate():
    """Driven with SQL written here, because the tree holds no example.

    An ON clause is read by scanning forward to the next SQL keyword, so before
    `_SQL_COMMENT` was applied a `-- ` comment between two JOINs was part of the
    clause. Both halves of that are dangerous and both are asserted:

      · a comment mentioning the alias's org_id SATISFIES the check without a
        predicate — a leak closed with a sentence;
      · a comment containing an ordinary English "where" TRUNCATES the clause
        before a predicate that is genuinely there, and reports a scoped join
        as an offender. A ratchet that cries wolf is a ratchet somebody
        allowlists.
    """
    faked, = _joins_in(
        "SELECT cl.name FROM public.graha_deals d "
        "LEFT JOIN public.graha_clients cl ON cl.id = d.client_id "
        "  -- still owed: cl.org_id = d.org_id\n"
        "WHERE d.org_id = $1::uuid")
    assert not faked.scoped, (
        "a comment satisfied the check — a leak could be closed by writing a "
        "sentence about it")

    hidden, = _joins_in(
        "SELECT cl.name FROM public.graha_deals d "
        "LEFT JOIN public.graha_clients cl ON cl.id = d.client_id "
        "  -- scoped below, which is where the tenancy comes from\n"
        "  AND cl.org_id = d.org_id "
        "WHERE d.org_id = $1::uuid")
    assert hidden.scoped, (
        "a real predicate was hidden behind a comment containing the word "
        "'where' — this join is scoped and would have been reported as a leak")


def test_no_scanned_file_was_silently_skipped():
    """Nine files in this tree start with a UTF-8 BOM and raise `SyntaxError`
    on a plain `utf-8` read. Reading them as `utf-8-sig` costs nothing; letting
    the ratchet drop them costs the whole guarantee."""
    assert not UNPARSEABLE, (
        "these files could not be parsed and were therefore never checked:\n  "
        + "\n  ".join(UNPARSEABLE))


# ══════════════════════════════════════════════════════════════════════════
#  2 · The rule
# ══════════════════════════════════════════════════════════════════════════

def test_no_graha_clients_join_is_scoped_by_the_id_alone():
    """NO ALLOWLIST. `graha_clients` is the company — the customer itself — and
    it is the table the plan names as the leak.

    Four joins had it: the unpaid-invoice and pay-link list in
    `ganit.collections`, both deal lists in `graha` (`list_deals` and
    `deals_kanban`), and the CRM report's deal sheet. Each rendered
    `cl.name AS client_name` off `cl.id = <row>.client_id` and nothing else.
    """
    offenders = [str(j) for j in ID_ALONE if j.table == "graha_clients"]
    assert not offenders, (
        "these joins reach a COMPANY by uuid with no organisation predicate, "
        "so the name they render is whichever org's client holds that id:\n  "
        + "\n  ".join(offenders)
        + "\n\nThe pattern to copy is in routers/graha.py::get_deal:  "
          "ON cl.id = d.client_id AND cl.org_id = d.org_id")


def test_no_graha_clients_join_is_ever_recorded_in_the_allowlist():
    """The ledger is for `graha_contacts` and stays that way.

    Allowing a company join to be listed would let the test above be satisfied
    by writing a paragraph instead of a predicate — which is precisely how an
    allowlist stops being a ratchet.
    """
    listed = [k for k in KNOWN_ID_ALONE if k[2] == "graha_clients"]
    assert not listed, (
        f"graha_clients cannot be allowlisted — fix the join: {listed}")


def test_no_new_join_on_the_id_alone_appeared():
    """The ratchet. A party join that is not already in the ledger fails here,
    whichever file it was written in."""
    unknown = [str(j) for j in ID_ALONE if j.key not in KNOWN_ID_ALONE]
    assert not unknown, (
        "new joins scoped by the id alone — add the organisation predicate, "
        "the way routers/graha.py::get_deal does:\n  "
        + "\n  ".join(unknown))


def test_no_allowlisted_function_grew_another_one():
    """`crm_today` holds six. A seventh is a new leak in an old handler, and
    a per-function count is the only thing that sees it."""
    counted = collections.Counter(j.key for j in ID_ALONE)
    grown = [(k, KNOWN_ID_ALONE[k][0], n) for k, n in counted.items()
             if k in KNOWN_ID_ALONE and n > KNOWN_ID_ALONE[k][0]]
    assert not grown, "\n".join(
        f"{k[0]}::{k[1]} joins {k[2]} {n} times, allowed {allowed}"
        for k, allowed, n in grown)


def test_the_ledger_has_no_stale_entries():
    """It only goes DOWN, and never quietly.

    An entry that has been fixed must come off the list in the same commit that
    fixes it. Otherwise the count in this file drifts away from the count in
    the tree, and the next reader inherits a ledger that overstates the debt —
    the exact failure `docs/STATUS.md` exists to prevent.
    """
    counted = collections.Counter(j.key for j in ID_ALONE)
    stale = [(k, allowed, counted.get(k, 0))
             for k, (allowed, _) in KNOWN_ID_ALONE.items()
             if counted.get(k, 0) < allowed]
    assert not stale, "\n".join(
        f"{k[0]}::{k[1]} now joins {k[2]} {n} times, not {allowed} — "
        f"ratchet the ledger down (or delete the entry if n is 0)"
        for k, allowed, n in stale)


def test_every_ledger_entry_carries_a_reason():
    """A bare entry is a silence with a tuple around it."""
    thin = [k for k, (_, why) in KNOWN_ID_ALONE.items() if len(why) < 30]
    assert not thin, f"these entries say nothing about why they stand: {thin}"


def test_the_send_paths_are_named_as_debts():
    """The three paths where a wrong row is MAILED rather than displayed are
    the reason this ledger is allowed to exist at all. If one of them ever
    falls off the list without being fixed, that is the failure this asserts
    against."""
    for path, func in (
        ("services/skills/action/campaign_sender.py", "send_campaign"),
        ("services/skills/action/sequence_step_executor.py", "execute_step"),
    ):
        key = (path, func, "graha_contacts")
        assert key in KNOWN_ID_ALONE, f"{path}::{func} left the ledger"
        assert "Owed" in KNOWN_ID_ALONE[key][1], (
            f"{path}::{func} is recorded without being called a debt")


def test_the_total_debt_is_what_the_ledger_says():
    """One number a reader can quote. 38 on 2026-08-26, every one of them
    `graha_contacts`, after the four `graha_clients` joins were fixed."""
    assert sum(n for n, _ in KNOWN_ID_ALONE.values()) == len(ID_ALONE), (
        f"the ledger totals {sum(n for n, _ in KNOWN_ID_ALONE.values())} "
        f"but the tree holds {len(ID_ALONE)}")


# ══════════════════════════════════════════════════════════════════════════
#  3 · The module this check was promoted from
# ══════════════════════════════════════════════════════════════════════════

def test_client_billing_still_has_none_of_its_own():
    """`routers/client_billing.py` is where this check was born — seven joins
    in that one file carried the leak shape and all seven were fixed. It is
    asserted by name so the promotion cannot be read as having dropped it."""
    offenders = [str(j) for j in ID_ALONE
                 if j.file == "routers/client_billing.py"]
    assert not offenders, "\n  ".join(offenders)


# ══════════════════════════════════════════════════════════════════════════
#  4 · The live half — the premise, and whether anything has leaked yet
#
#  Everything above reads SOURCE. Two things it cannot settle: whether the
#  schema still makes the join predicate necessary, and whether a row has
#  already gone over the boundary. Both are SELECT-ONLY. Staging and production
#  share one Supabase database (CLAUDE.md), so nothing here writes.
# ══════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL`
#: is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

SKIP_REASON = (
    "no live database. This half reads the catalogue and compares ID SETS "
    "across organisations, neither of which can be done offline. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_party_join_tenancy.py -q"
)


def _live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _select(sql: str):
    """One read-only SELECT, on its own connection. `statement_cache_size=0`
    because the connection goes through PgBouncer in transaction mode, where a
    cached server-side statement belongs to a session that will not be there
    next time."""
    import asyncio

    import asyncpg

    async def run():
        conn = await asyncpg.connect(_live_dsn(), statement_cache_size=0)
        try:
            await conn.execute("SET search_path TO public")
            return [dict(r) for r in await conn.fetch(sql)]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    if _live_dsn() is None:
        pytest.skip(SKIP_REASON)
    return True


def test_the_party_tables_still_carry_an_org_id(live):
    """The premise. If `org_id` ever became nullable on either table, every
    predicate this file demands would silently stop scoping anything for the
    rows that hold a NULL."""
    rows = _select(
        "SELECT table_name, is_nullable FROM information_schema.columns "
        "WHERE table_schema = ANY(current_schemas(false)) AND column_name = 'org_id' "
        "  AND table_name IN ('graha_clients', 'graha_contacts')")
    found = {r["table_name"]: r["is_nullable"] for r in rows}
    assert found == {"graha_clients": "NO", "graha_contacts": "NO"}, found


def test_no_foreign_key_makes_the_join_predicate_redundant(live):
    """Read from `pg_constraint`, never from a migration file.

    A composite `(id, org_id)` foreign key would make a cross-org reference
    impossible at the schema level, and this whole ratchet would become belt
    over braces. There is no such constraint: every one of these keys points at
    `id` alone, so nothing but the join predicate is enforcing tenancy. If that
    ever changes, this test fails and the argument above should be re-read
    rather than the constraint being assumed away.
    """
    rows = _select("""
        SELECT rel.relname AS on_table, c.conname,
               cardinality(c.confkey) AS ref_column_count
          FROM pg_constraint c
          JOIN pg_class rel ON rel.oid = c.conrelid
          JOIN pg_class fr  ON fr.oid  = c.confrelid
          JOIN pg_namespace n ON n.oid = rel.relnamespace
         WHERE n.nspname = ANY(current_schemas(false)) AND c.contype = 'f'
           AND fr.relname IN ('graha_clients', 'graha_contacts')
    """)
    assert rows, "no foreign keys to the party tables found at all"
    composite = [r for r in rows if r["ref_column_count"] > 1]
    assert not composite, (
        "a composite foreign key now exists, so the schema itself may be "
        f"enforcing tenancy: {composite}")


def test_no_row_points_at_another_organisations_party_row(live):
    """Has anything actually leaked? ID SETS, compared with `EXCEPT`.

    Never counts: two organisations holding the same NUMBER of clients tells
    you nothing about whether one is reaching the other's rows. The question is
    whether the set of party ids a table REFERENCES is a subset of the set that
    organisation OWNS, and `EXCEPT` is what answers it.

    Zero on 2026-08-26, across the whole table and not only the two orgs in
    scope. The fix this file guards is therefore preventive: it removes no name
    anybody is entitled to see, and closes a door nobody has yet walked
    through. A non-zero here is a leak that has already happened.
    """
    rows = _select("""
        SELECT 'graha_deals.client_id' AS edge, count(*) AS foreign_refs FROM (
            SELECT d.org_id, d.client_id FROM public.graha_deals d
             WHERE d.client_id IS NOT NULL
            EXCEPT
            SELECT cl.org_id, cl.id FROM public.graha_clients cl) a
        UNION ALL
        SELECT 'graha_deals.contact_id', count(*) FROM (
            SELECT d.org_id, d.contact_id FROM public.graha_deals d
             WHERE d.contact_id IS NOT NULL
            EXCEPT
            SELECT c.org_id, c.id FROM public.graha_contacts c) b
        UNION ALL
        SELECT 'ganit_invoices.client_id', count(*) FROM (
            SELECT i.org_id, i.client_id FROM public.ganit_invoices i
             WHERE i.client_id IS NOT NULL
            EXCEPT
            SELECT cl.org_id, cl.id FROM public.graha_clients cl) c
        UNION ALL
        SELECT 'ganit_invoices.contact_id', count(*) FROM (
            SELECT i.org_id, i.contact_id FROM public.ganit_invoices i
             WHERE i.contact_id IS NOT NULL
            EXCEPT
            SELECT ct.org_id, ct.id FROM public.graha_contacts ct) d
    """)
    assert len(rows) == 4, f"the comparison did not run: {rows}"
    leaked = [r for r in rows if r["foreign_refs"]]
    assert not leaked, (
        "rows reference a party record their own organisation does not own — "
        f"this is a leak that has already happened: {leaked}")
