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

This file does NOT fix that. Changing the population of a live GST return is
the owner's decision, not a test's, and there is a defensible reading in which
a firm wants accrued-but-unissued documents visible. What is NOT defensible is
the two screens disagreeing silently, which is what happens today.

`test_the_two_gst_builders_count_the_same_invoices` is therefore marked xfail
with this reason. It turns green the day the two populations are reconciled,
whichever way that reconciliation goes, and it fails loudly if somebody makes
the gap WIDER.
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
    """Pinned so the two halves of the divergence are separately visible."""
    assert any("draft" in s for s in _sql_literals(READINESS_SRC)), (
        "gst_readiness no longer excludes drafts — if that was deliberate, the "
        "xfail below should now pass and should be un-marked."
    )


def test_the_filing_builder_does_not_mention_drafts_at_all():
    """The other half. `assemble_gstr3b` is behind the filing SCREEN and the
    PDF, not only the skill, so this is a statement about what a firm files."""
    sql = _joined_sql(PERIOD_SRC)
    assert "ganit_invoices" in sql, "extraction is wrong, not the module"
    assert "draft" not in sql.lower(), (
        "gst_period now mentions drafts. If it now excludes them, the two "
        "builders may agree — re-run the xfail below and un-mark it."
    )


@pytest.mark.xfail(
    reason=(
        "MEASURED LIVE 2026-08-20: the GSTR-1 readiness population and the "
        "GSTR-3B filing population disagree by exactly the number of DRAFT "
        "invoices in the period — 27 vs 30 in the seeded org, every month. "
        "gst_readiness excludes doc_status='draft'; gst_period does not mention "
        "draft at all, so an unissued document is counted in the outward tax a "
        "preparer pays in cash on the filing screen and in the PDF. "
        "Reconciling the two changes a live GST return and is the OWNER'S "
        "decision, not a test's. This turns green when they agree, whichever "
        "way it is resolved."
    ),
    strict=True,
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
# a second defect found in the same file, reported not fixed
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.xfail(
    reason=(
        "services/gst_period.py joins staging.graha_contacts on the id ALONE "
        "in prefiling_checks — `JOIN staging.graha_contacts c ON "
        "c.id = i.contact_id` with no org_id. The FK is on the id alone, so an "
        "id-only join can surface ANOTHER PRACTICE'S CONTACT against this "
        "practice's invoice, and this one feeds a GSTIN validity check on a GST "
        "return. Migration 163 records the same fault being proved live "
        "elsewhere. Fixing it is a one-line narrowing but it sits in the filing "
        "path, so it is the owner's call to land."
    ),
    strict=True,
)
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
