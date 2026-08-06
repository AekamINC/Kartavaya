"""Aekam's own burn rate must be net, complete, and the same number the client sees.

Two reports answered "what did this org spend in credits?" and neither of them
answered it.

**Aekam's** — `GET /admin/orgs/{id}/cost-breakdown` — summed
`hub_content_items.credits_used`. That column is written by Sahayak content
generation and by nothing else, so every scraper credit, every scraper true-up
and every one of the five channels that used to charge nothing was **invisible
in Aekam's own number**. The identical query was duplicated verbatim into
`GET /admin/orgs/{id}/cost-report-pdf` — a document the customer keeps,
understating their own spend.

**The client's** — `subscription.py:509` — read the credit ledger, so it produced
a different figure for the same org over the same window. Neither report was
wrong about its own source; they were answering different questions under the
same label, and nobody could tell which.

Both were also GROSS. They summed `tx_type == 'debit'` and counted no reversal at
all — not `'refund'` (ai_router) and not `'credit'` (scrapers), which are two
names for one event that no report in the product has ever subtracted. Every
refunded image and every failed scraper run inflated what the customer was told
they spent.

Beside them sat `credit_balance`, which was the **single highest client wallet**
in the org — a row from the deprecated per-client wallet table, which no debit
path in the product reads. A number nobody can spend, rendered next to real
spend.

These are source assertions rather than request assertions, deliberately. The
defect is not a wrong output for one input — it is a query pointed at the wrong
table, which returns a perfectly plausible number for every input. The only
thing that distinguishes right from wrong here is WHERE the figure comes from,
so that is what is pinned: one aggregate, in `services/credits.py`, called by
every report.
"""

import inspect
import pathlib

import routers.admin_orgs as ao


def _code(fn) -> str:
    """Source with comment lines removed.

    The defects are described at length in the comments that replaced them, so
    a test that greps raw source fails the moment somebody documents the fix.
    """
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.strip().startswith("#")
    )


REPORTS = (ao.org_cost_breakdown, ao.admin_org_cost_report_pdf, ao.admin_credit_usage)


# ── The Sahayak-only sum is gone from both copies ─────────────────────────────

def test_no_report_derives_credit_spend_from_sahayak_content():
    """`hub_content_items.credits_used` is content generation only. An org that
    spends entirely on scrapers reported zero credits used."""
    for fn in REPORTS:
        assert "hub_content_items" not in _code(fn), (
            f"{fn.__name__} still derives credit spend from Sahayak content, so "
            "scraper spend and the metered channels are invisible in it"
        )


def test_every_report_reads_the_one_aggregate():
    for fn in REPORTS:
        assert "usage_summary" in _code(fn), (
            f"{fn.__name__} computes its own credit total — that is how Aekam's "
            "number and the client's number came to disagree"
        )


def test_the_breakdown_reports_a_balance_the_org_can_actually_spend():
    """`credit_balance` was the highest per-client wallet in the org. Nothing
    debits that table, so it was a balance with no spending power."""
    src = _code(ao.org_cost_breakdown)
    assert "balance_of" in src, "the org balance is no longer read from the wallet"
    assert "ORDER BY w.balance DESC" not in src, \
        "the highest client wallet is still being reported as the org's balance"


# ── The reports are net, and say so ──────────────────────────────────────────

def test_the_headline_debit_figure_is_net_of_refunds():
    """`net_debits`, not `gross_debits`. A refunded image must not inflate what
    the customer is told they spent."""
    for fn in (ao.org_cost_breakdown, ao.admin_credit_usage):
        assert '"net_debits"' in _code(fn), (
            f"{fn.__name__} reports a gross figure as the headline total"
        )


def test_usage_by_type_no_longer_parses_a_sentence():
    """`description.replace(" generation", "")` made a free-text column decide
    what a customer was told they spent, and put any channel phrased differently
    into a bucket of its own."""
    src = _code(ao.admin_credit_usage)
    assert '" generation"' not in src, \
        "the usage breakdown is still built by string surgery on the description"
    assert "by_kind" in src


# ── One writer for the credit tables, and it is not this file ────────────────

def test_this_router_names_no_credit_table():
    """After this programme no file outside `services/credits.py` may name a
    credit table. This is the scoped half of that guard: whatever else changes
    here, a sixth debit implementation must not be written into the console.
    """
    src = pathlib.Path(inspect.getfile(ao)).read_text(encoding="utf-8")
    for table in (
        "hub_org_credits", "hub_org_credit_transactions",
        "hub_credit_wallets", "org_member_credits", "credit_prices",
    ):
        assert table not in src, (
            f"admin_orgs.py names {table} directly — every credit read and write "
            "goes through services/credits.py"
        )


def test_the_admin_topup_writes_the_purchased_bucket():
    """Credits Aekam sold and invoiced carry over. The month roll resets only
    the allowance, and the old `SET balance = $1` destroyed a top-up the client
    had already been billed for while the ledger called it a 'reset'."""
    src = _code(ao.admin_topup_credits)
    assert 'bucket="purchased"' in src, \
        "an invoiced top-up is not being written to the bucket that survives the month"


# ── An org negotiated to zero credits still gets a wallet ────────────────────

def test_org_creation_makes_a_wallet_row_unconditionally():
    """The insert used to be conditioned on `monthly_credits > 0`, so an org
    Aekam deliberately negotiated down to zero got NO ROW — and from there every
    debit answered 402 forever, the monthly reset returned at `if not wallet`,
    and the only self-heal in the product sat behind a Sahayak module grant.

    A zero balance is a balance.
    """
    src = _code(ao.create_org)
    assert "balance_of(conn" in src, "org creation no longer ensures a wallet row"
    guard = src.find("if monthly_credits > 0")
    assert guard == -1 or src.find("balance_of(conn") < guard, (
        "the wallet row is still created only when the org was granted credits"
    )
