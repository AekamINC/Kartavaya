"""Catalogue #57, delivered as the folio instructed — a test, not a skill card.

── WHY THIS IS A TEST FILE AND NOT A MARKETPLACE ENTRY ──────────────────────

The night ledger rejected #57 "Pre-File Mismatch Guard" with this reasoning:

    "Both figures come from the same builder over the same rows, so the
     mismatch it claims to find cannot exist. If the two builders can
     disagree, that is a unit test — write it in the test suite, not the
     marketplace."

The rejection is right about where the check belongs and WRONG ABOUT THE
PREMISE. The two builders are not the same builder:

  · `brief_gstr3b_liability` delegates to `services.gst_period.assemble_gstr3b`
    — the same path the filing screen and the PDF use. Its own registry comment
    says "Computes nothing of its own".
  · `check_gstr1_readiness` rolls its OWN query in
    `services/skills/data/gst_readiness.py`, with its own predicate.

So they CAN disagree, which by the folio's own rule makes this a test. And
measured against the live database on 2026-08-20 they DO, in six of nine
org-period pairs:

    org                                period    GSTR-1   GSTR-3B
    Aekam Inc                          2026-07        6         3
    E2E Test & Associates              2026-07       27        30
    E2E Test & Associates              2026-06       27        30
    E2E Test & Associates              2026-05       27        30
    Unicode Group                      2026-07       18        12

── THE CAUSE, ISOLATED ──────────────────────────────────────────────────────

E2E July 2026 holds 30 invoices in the period, of which THREE ARE DRAFTS.

  `gst_readiness.py` excludes them:  AND COALESCE(i.doc_status,'') <> 'draft'
  `gst_period.py` does not mention `draft` ANYWHERE. Its predicate is
      WHERE org_id=$1 AND is_active AND cancelled_at IS NULL
        AND invoice_type IN ('tax_invoice','credit_note','debit_note')
        AND invoice_date >= $2 AND invoice_date < $3

27 + 3 = 30. That is the whole of the difference.

── WHY THAT MATTERS MORE THAN A SKILL DISAGREEING ──────────────────────────

`assemble_gstr3b` is not only behind the skill. It is behind the GSTR-3B
FILING SCREEN and the GSTR-3B PDF. So a draft invoice — a document that has not
been issued to anybody — is counted in the outward tax a preparer is shown and
pays in cash.

── RESOLVED 2026-08-23, TOWARDS THE READINESS BUILDER ──────────────────────

The owner's call landed: `gst_period.assemble_gstr3b` now carries
`AND COALESCE(doc_status, '') <> 'draft'`, and so do the two pre-filing check
queries beside it, so a check can no longer flag a defect on an invoice the
return does not contain. Re-measured live on 2026-08-22 before the change:
102 draft invoices, Rs1.00cr of taxable value and Rs17.96L of tax that the
filing screen and the PDF were putting in front of a preparer as cash payable.

The reconciliation went towards EXCLUDING drafts because that is the direction
that stops money leaving: a document that has not been issued to anybody is
not an outward supply. The alternative reading — a firm wanting
accrued-but-unissued documents visible — is a separate report, not a return.

AND IT FOUND A SECOND DIVERGENCE THAT NOBODY HAD REPORTED. With `doc_status`
reconciled this test still failed, on `payment_status`. Cancellation has TWO
channels in `ganit_invoices`: `cancelled_at`, which both builders honoured, and
`payment_status='cancelled'`, which only `gst_readiness` did. A row cancelled
through the second channel alone was outward supply on the filing screen and
struck off on the readiness screen, in the same session, for the same month.
`gst_period` now honours both. That defect was invisible while the `doc_status`
gap masked it — which is the argument for a test that compares PREDICATES
rather than one that compares the one number somebody happened to notice.

The xfail is gone. `test_the_two_gst_builders_count_the_same_invoices` is now
an ordinary passing test and it fails loudly if the two populations diverge
again, in either direction. The two half-tests above it were assertions ABOUT
the divergence; they are rewritten as assertions that both builders now name
`draft`, which is the same ratchet pointed the other way.
"""
import ast
import inspect
import re
from pathlib import Path

import pytest

from services.skills.data import gst_readiness
from services import gst_period

READINESS_SRC = inspect.getsource(gst_readiness)
PERIOD_SRC = inspect.getsource(gst_period)


def _sql_literals(src: str) -> list[str]:
    """Every string constant that reads like SQL against ganit_invoices."""
    tree = ast.parse(src)
    return [
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and "ganit_invoices" in n.value
    ]


def _joined_sql(src: str) -> str:
    """gst_period.py builds its SQL by adjacent-string concatenation, so a
    single constant holds only a fragment. Join them to test the predicate."""
    return " ".join(
        n.value for n in ast.walk(ast.parse(src))
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    )


# ══════════════════════════════════════════════════════════════════════════
# the disagreement itself
# ══════════════════════════════════════════════════════════════════════════

def test_the_readiness_builder_excludes_drafts():
    """Half one of the ratchet. Unchanged: this was always true."""
    assert any("draft" in s for s in _sql_literals(READINESS_SRC)), (
        "gst_readiness no longer excludes drafts. The two builders have "
        "diverged again — see the module docstring."
    )


def test_the_filing_builder_excludes_drafts_too():
    """Half two, INVERTED on 2026-08-23 when the divergence was resolved.

    `assemble_gstr3b` is behind the filing SCREEN and the PDF, not only the
    skill, so this is a statement about what a firm files. It used to assert
    that `gst_period` did not mention `draft` anywhere — a pin on the defect.
    It now asserts the opposite, because the defect is fixed and the thing
    worth guarding is the fix.
    """
    sql = _joined_sql(PERIOD_SRC)
    assert "ganit_invoices" in sql, "extraction is wrong, not the module"
    assert "doc_status" in sql.lower() and "draft" in sql.lower(), (
        "gst_period no longer excludes draft invoices from the GSTR-3B "
        "population. A draft is a document that has not been issued to "
        "anybody; counting it as outward supply is tax paid in cash on a "
        "supply that did not happen (Rs17.96L measured live, 2026-08-22)."
    )


def test_the_two_gst_builders_count_the_same_invoices():
    """One period, one org, one set of rows — two different populations.

    Compared structurally rather than by running both against a database,
    because the suite is offline by design (`pytest.ini` pins
    `testpaths = tests` and the pool is a MagicMock). The predicates ARE the
    populations, so comparing them is the honest offline form of the check.
    """
    readiness = " ".join(_sql_literals(READINESS_SRC)).lower()
    filing = _joined_sql(PERIOD_SRC).lower()

    def guards(sql: str) -> set[str]:
        found = set()
        for token in ("is_active", "cancelled_at is null", "doc_status",
                      "payment_status", "invoice_type"):
            if token in sql:
                found.add(token)
        return found

    assert guards(readiness) == guards(filing), (
        f"the two builders filter the same table differently:\n"
        f"  gst_readiness : {sorted(guards(readiness))}\n"
        f"  gst_period    : {sorted(guards(filing))}\n"
        f"A preparer reads both figures side by side."
    )


# ══════════════════════════════════════════════════════════════════════════
# a second defect found in the same file — measured, then fixed
# ══════════════════════════════════════════════════════════════════════════
#
# `prefiling_checks` joined `staging.graha_contacts` ON THE ID ALONE. The
# foreign key is on the id alone too, so nothing but the query can scope it,
# and an id-only join can surface another practice's contact against this
# practice's invoice. Migration 163 records the same fault proved live
# elsewhere in this schema; `graha_clients` carries an identical note.
#
# It was reported rather than fixed, on the grounds that it sits in the filing
# path. That reasoning does not survive the measurement: a narrowing can only
# ever REMOVE a cross-tenant row and never add one, so the question is simply
# whether any legitimate row is lost. Live, 2026-08-23:
#
#   invoices whose contact belongs to another org      0
#   contact ids shared by two orgs                     0
#   distinct parties, join as written                 28
#   distinct parties, join org-scoped                 28
#
# Identical. So it is a no-op today and a guard for ever, and leaving a
# cross-tenant join in a path that feeds a GST return pending a decision was
# the more expensive of the two options.

def test_every_graha_join_in_the_filing_path_is_org_scoped():
    """The FK is on the id alone; only the query can scope it."""
    sql = _joined_sql(PERIOD_SRC)
    unscoped = []
    for m in re.finditer(r"JOIN\s+staging\.graha_\w+\s+(\w+)\s+ON\s+([^\"]+?)(?=WHERE|JOIN|$)",
                         sql, re.IGNORECASE):
        if "org_id" not in m.group(2):
            unscoped.append(m.group(0).strip()[:90])

    assert not unscoped, (
        "graha join(s) in the GST filing path carry no org_id:\n  "
        + "\n  ".join(unscoped)
    )


def test_this_file_is_the_delivery_of_catalogue_57():
    """A guard against somebody later 'adding #57 to the marketplace'.

    The folio rejected it as a skill and said where it belongs. If a template
    ever names a pre-file mismatch guard, that decision has been reversed
    without the reasoning being revisited.
    """
    migrations = Path(__file__).resolve().parent.parent / "migrations"
    offenders = [
        p.name for p in migrations.glob("*.sql")
        if re.search(r"mismatch\s*guard|pre[- ]file\s*mismatch",
                     p.read_text(encoding="utf-8"), re.IGNORECASE)
        and "reject" not in p.read_text(encoding="utf-8").lower()
    ]
    assert not offenders, (
        f"{offenders} appear to add a pre-file mismatch guard as a skill. The "
        f"folio rejected it: both figures would come from builders over the "
        f"same rows, and where they disagree the answer is this test file."
    )
