"""The blended client report (A5/A6): the CRM columns nobody else can show.

The two promises under test:

  · the money numbers MIRROR the registry's definitions character-for-
    character — a client page that disagrees with the dashboard about what
    was invoiced discredits both (metric drift, the programme's named
    failure mode);
  · the external columns state their absence — no connected ad account is
    "not connected", never ₹0, because a zero looks like an answer.
"""
from __future__ import annotations

import asyncio
import inspect
import re

import pytest
from fastapi import HTTPException

from routers import analytics as ax

USER = {"user_id": "user_aaa111"}
ORG = "22222222-2222-2222-2222-222222222222"
CLIENT = "33333333-3333-3333-3333-333333333333"
FROM, TO = "2026-05-01", "2026-08-17"


def run(coro):
    return asyncio.run(coro)


class FakeRequest:
    class _State:
        _auth_user = USER
    state = _State()
    method = "GET"


class RecordingPool:
    """Answers every query with a benign shape; records the SQL."""

    def __init__(self):
        self.calls = []
        self.client_row = {"name": "Khanna Electronics",
                           "created_at": __import__("datetime").datetime(2025, 4, 1)}
        # keyed by SOURCE — the route must ask for the column's own kind of
        # account, so the fake answers per source the way the table would
        self.account_rows = {}           # default: nothing connected

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return []

    async def fetchrow(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        if "FROM public.graha_clients" in sql:
            return self.client_row
        if "FROM public.analytics_accounts" in sql:
            return self.account_rows.get(args[2] if len(args) > 2 else None)
        if "FROM public.graha_deals" in sql:
            return {"won_count": 2, "won_value": 500000.0}
        if "FROM public.ganit_invoices" in sql:
            return {"invoiced": 118000.0, "invoice_count": 3}
        return None

    async def fetchval(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return 0.0


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(ax, "get_pool", _get_pool)
    return p


def _grant(monkeypatch, *modules):
    """Fake `require_module` — the route's REAL gate (subscription state,
    sensitive-module refusal, audit row), which is exactly why the test seam
    is this factory and not held_level: the route must stand behind the same
    door /run does."""
    def _rm(module):
        async def _gate(request, org_id):
            if module not in modules:
                raise HTTPException(403, f"{module} is not enabled")
        return _gate

    monkeypatch.setattr(ax, "require_module", _rm)


@pytest.fixture
def all_reachable(monkeypatch):
    _grant(monkeypatch, "graha", "ganit")


def report(pool, **over):
    kw = dict(client_id=CLIENT, date_from=FROM, date_to=TO,
              user=USER, org_id=ORG)
    kw.update(over)
    return run(ax.client_report(FakeRequest(), **kw))


# ── refusals ─────────────────────────────────────────────────────────────────

def test_a_period_is_required(pool, all_reachable):
    with pytest.raises(HTTPException) as e:
        report(pool, date_from="", date_to="")
    assert e.value.status_code == 400


def test_neither_crm_module_means_no_page(monkeypatch, pool):
    _grant(monkeypatch)                    # require_module refuses both
    with pytest.raises(HTTPException) as e:
        report(pool)
    assert e.value.status_code == 403


def test_garbage_client_id_is_400_never_a_500(pool, all_reachable):
    """`?client_id=abc` must be refused before the ::uuid cast — asyncpg's
    InvalidTextRepresentationError through the catch-all was a 500 plus a
    Sentry event per probe."""
    with pytest.raises(HTTPException) as e:
        report(pool, client_id="not-a-uuid")
    assert e.value.status_code == 400


def test_a_foreign_client_is_404(pool, all_reachable):
    pool.client_row = None
    with pytest.raises(HTTPException) as e:
        report(pool)
    assert e.value.status_code == 404
    # and the lookup itself must be org-scoped, or the 404 is theatre
    lookup = next(sql for sql, _ in pool.calls if "graha_clients" in sql)
    assert "org_id = $2::uuid" in lookup


def test_an_unknown_format_is_400_never_silent_json(pool, all_reachable):
    with pytest.raises(HTTPException) as e:
        report(pool, format="docx")
    assert e.value.status_code == 400


# ── the definitional mirrors ─────────────────────────────────────────────────

def _route_sql(pool, needle):
    return [sql for sql, _ in pool.calls if needle in sql]


def test_invoiced_mirrors_the_registry_definition_verbatim(pool, all_reachable):
    """ganit.invoiced's credit-note CASE and guards, narrowed to the client.
    Compared against the REGISTRY BUILDER's own output, so either side
    drifting fails here."""
    from analytics.registry import REGISTRY, MetricRequest
    from services.analytics_window import Window
    import datetime

    reg_sql, _ = REGISTRY["ganit.invoiced"].sql(MetricRequest(
        org_id=ORG, window=Window(datetime.date(2026, 5, 1),
                                  datetime.date(2026, 8, 17))))
    case = re.search(r"CASE WHEN invoice_type = 'credit_note' "
                     r"THEN -total ELSE total END", reg_sql).group(0)
    report(pool)
    inv = _route_sql(pool, "invoice_count")
    assert inv and case in inv[0], "the credit-note CASE must be verbatim"
    assert "doc_status <> 'draft'" in inv[0]
    assert "is_active = TRUE" in inv[0]


def test_collected_is_payment_dated_like_the_registry(pool, all_reachable):
    report(pool)
    col = _route_sql(pool, "ganit_payments")
    assert col, "no collected query ran"
    for sql in col:
        assert "payment_date BETWEEN" in sql, \
            "collected must be dated by payment_date — ganit.collected's basis"
        assert "JOIN public.ganit_invoices" in sql, \
            "payments carry no client; the join is the only honest path"


def test_outstanding_never_reads_balance_due(pool, all_reachable):
    """total - COALESCE(amount_paid,0), never the balance_due column — it
    lies on old rows, the lesson every ganit metric already carries."""
    report(pool)
    outs = [sql for sql, _ in pool.calls
            if "total - COALESCE(amount_paid, 0)" in sql]
    assert outs
    assert all("balance_due" not in sql for sql, _ in pool.calls)


def test_outstanding_mirrors_the_registry_not_a_private_cohort(pool, all_reachable):
    """ganit.outstanding's guards verbatim: credit notes out via <>, only rows
    still owing — NOT a tax_invoice/debit_note allowlist and NOT cancelled_at,
    which made this figure disagree with the ageing widget over the same rows."""
    report(pool)
    [outs] = [sql for sql, _ in pool.calls
              if "total - COALESCE(amount_paid, 0)) " in sql
              or ("total - COALESCE(amount_paid, 0)" in sql and "SUM" in sql)]
    assert "invoice_type <> 'credit_note'" in outs, outs
    assert "total - COALESCE(amount_paid, 0) > 0" in outs, outs
    assert "cancelled_at" not in outs, outs
    assert "invoice_type IN" not in outs, outs


def test_deals_and_leads_carry_the_registry_guards(pool, all_reachable):
    """The graha half of the drift promise: is_active on every CRM count, a
    ::date cast on every timestamptz window (a deal won at 14:00 on the last
    day is IN the window), undecided-only pipeline."""
    report(pool)
    [won] = [sql for sql, _ in pool.calls if "won_count" in sql]
    assert "is_active = TRUE" in won, won
    assert "won_at::date BETWEEN" in won, won
    assert "won_at IS NOT NULL" in won, won
    [pipe] = [sql for sql, _ in pool.calls
              if "won_at IS NULL AND lost_at IS NULL" in sql]
    assert "is_active = TRUE" in pipe, pipe
    assert "archived_at IS NULL" in pipe, pipe
    [leads] = [sql for sql, _ in pool.calls if "graha_contacts" in sql]
    assert "is_active = TRUE" in leads, leads
    assert "created_at::date BETWEEN" in leads, leads


def test_every_query_is_client_and_org_scoped(pool, all_reachable):
    # a connected account so the by-account daily queries actually run —
    # without it the scoping test certifies a path it never exercised
    pool.account_rows["meta_ads"] = {
        "id": "44444444-4444-4444-4444-444444444444",
        "source": "meta_ads", "name": "Khanna — Meta"}
    report(pool)
    daily_ran = False
    for sql, args in pool.calls:
        if "graha_clients" in sql or "analytics_accounts" in sql:
            continue
        if "analytics_metrics_daily" in sql:
            # account-scoped: the account id came from an org+client-scoped
            # lookup, never from the caller
            daily_ran = True
            assert "account_id = $1::uuid" in sql, sql
            assert "org_id = $2::uuid" in sql, f"org bind missing: {sql}"
            continue
        if any(t in sql for t in ("graha_contacts", "graha_deals",
                                  "ganit_invoices", "ganit_payments")):
            # one substring covers the bare and i.-prefixed forms
            assert "client_id = $1::uuid" in sql, sql
            assert "$2::uuid" in sql, f"org bind missing: {sql}"
    assert daily_ran, "no analytics_metrics_daily query ran — the check is hollow"


def test_the_join_binds_the_org_on_both_sides(pool, all_reachable):
    """Belt-and-braces: the payment→invoice hop carries its own org filter —
    fail-closed beats trusting a foreign key one table away."""
    report(pool)
    joins = [sql for sql, _ in pool.calls if "JOIN public.ganit_invoices" in sql]
    assert joins
    for sql in joins:
        assert "i.org_id = $2::uuid" in sql, sql


# ── the stated absences ──────────────────────────────────────────────────────

def test_no_ad_account_is_an_absence_not_a_zero(pool, all_reachable):
    out = report(pool)
    assert "absent" in out["ads"] and "connected" in out["ads"]["absent"]
    assert "total" not in out["ads"]
    assert "absent" in out["sessions"]


def test_each_column_asks_for_its_own_kind_of_account(pool, all_reachable):
    """The ads column asks for meta_ads, sessions for ga4 — without the source
    filter a GA4-only client answered the ads column with metric='spend' over
    a GA account: ₹0 presented as a real figure."""
    report(pool)
    sources = [args[2] for sql, args in pool.calls
               if "analytics_accounts" in sql]
    assert sources == ["meta_ads", "ga4"], sources


def test_a_connected_account_reports_a_real_number(pool, all_reachable):
    pool.account_rows["meta_ads"] = {
        "id": "44444444-4444-4444-4444-444444444444",
        "source": "meta_ads", "name": "Khanna — Meta"}
    out = report(pool)
    assert out["ads"] == {"total": 0.0, "source": "meta_ads",
                          "account_name": "Khanna — Meta"}
    # GA4 is a DIFFERENT connection: Meta being wired must not make the
    # sessions column pretend it is
    assert "absent" in out["sessions"]


def test_sections_follow_entitlement(monkeypatch, pool):
    """Ganit-only caller: no leads/deals section is even attempted — the
    catalogue-intersection rule, applied to a page."""
    _grant(monkeypatch, "ganit")
    out = report(pool)
    assert "leads" not in out and "deals" not in out
    assert "invoices" in out
    assert not any("graha_contacts" in sql for sql, _ in pool.calls)


# ── the spend column's own gate (owner ruling 2026-08-18) ────────────────────
#
# Ad spend homes under prachar in the registry (prachar.ad_spend — where the
# Meta data originates), so the spend column answers to prachar OR ganit and
# graha dropped out of that gate. The page gate is untouched: graha or ganit
# still buys the page; prachar alone buys nothing here.

_META = {"id": "44444444-4444-4444-4444-444444444444",
         "source": "meta_ads", "name": "Khanna — Meta"}


def test_prachar_grants_the_spend_column(monkeypatch, pool):
    """prachar (with graha carrying the page) sees spend — the registry-home
    entitlement, no ganit anywhere."""
    _grant(monkeypatch, "graha", "prachar")
    pool.account_rows["meta_ads"] = dict(_META)
    out = report(pool)
    assert out["ads"] == {"total": 0.0, "source": "meta_ads",
                          "account_name": "Khanna — Meta"}
    assert "invoices" not in out       # prachar buys spend, never the books


def test_ganit_alone_grants_the_spend_column(monkeypatch, pool):
    _grant(monkeypatch, "ganit")
    pool.account_rows["meta_ads"] = dict(_META)
    out = report(pool)
    assert out["ads"] == {"total": 0.0, "source": "meta_ads",
                          "account_name": "Khanna — Meta"}


def test_graha_alone_gets_the_stated_absence_for_spend(monkeypatch, pool):
    """THE old graha-passes case, inverted deliberately — owner ruling
    2026-08-18: before it, any caller who reached the page (graha∪ganit) got
    the ads column, so graha alone saw spend. Now graha alone gets the house
    withheld sentence — words, never a broken or empty column — and the
    route must not even look up whose ad account exists."""
    _grant(monkeypatch, "graha")
    pool.account_rows["meta_ads"] = dict(_META)   # connected, and still withheld
    out = report(pool)
    assert out["ads"] == {"absent": "Withheld — ad spend needs the "
                                    "prachar or ganit module."}
    assert "ads" in out["sections"], "the column states itself; it never vanishes"
    sources = [args[2] for sql, args in pool.calls
               if "analytics_accounts" in sql]
    assert sources == ["ga4"], sources
    # and the export says "withheld", not "not connected" — the file must
    # not claim an account is missing when the column was refused
    pool.calls.clear()
    body = report(pool, format="csv").body.decode()
    assert "withheld" in body
    assert "not connected" in body     # sessions: a connection absence, kept


def test_prachar_alone_has_no_page(monkeypatch, pool):
    """The ruling moved the COLUMN's gate, not the page's: the report is the
    CRM-beside-spend blend, and prachar holds no CRM side."""
    _grant(monkeypatch, "prachar")
    with pytest.raises(HTTPException) as e:
        report(pool)
    assert e.value.status_code == 403


# ── the exports carry the same numbers (A6) ──────────────────────────────────

def test_csv_reuses_the_same_queries_not_a_second_pipeline(pool, all_reachable):
    """format is a parameter: the CSV runs the same SQL as the JSON — one
    query set, two renderings, byte-for-byte the same period."""
    report(pool)
    json_calls = [sql for sql, _ in pool.calls]
    pool.calls.clear()
    resp = report(pool, format="csv")
    csv_calls = [sql for sql, _ in pool.calls]
    assert json_calls == csv_calls
    body = resp.body.decode()
    assert "Khanna Electronics" in body
    assert "not connected" in body, "the absence must survive into the file"
    assert 'filename="client-report_Khanna-Electronics_' in \
        resp.headers["content-disposition"]


def test_the_filename_carries_the_name_never_the_id(pool, all_reachable):
    resp = report(pool, format="csv")
    cd = resp.headers["content-disposition"]
    assert CLIENT not in cd, "a client uuid must never reach a filename"


def test_a_devanagari_client_name_still_exports(pool, all_reachable):
    """Starlette encodes headers latin-1; `isalnum()` is Unicode-alnum, so a
    Hindi-named client — a routine row in this product — 500'd every export.
    The filename falls back to ASCII; the name itself survives in the body."""
    pool.client_row = {"name": "ग्राहक प्राइवेट लिमिटेड",
                       "created_at": __import__("datetime").datetime(2025, 4, 1)}
    resp = report(pool, format="csv")
    cd = resp.headers["content-disposition"]
    cd.encode("latin-1")               # what Starlette will do for real
    assert 'filename="client-report_client_' in cd
    assert "ग्राहक प्राइवेट लिमिटेड" in resp.body.decode("utf-8")


def test_a_formula_shaped_name_is_neutralised_in_the_file(pool, all_reachable):
    """CSV and XLSX both: openpyxl writes an `=`-leading string as a live
    formula cell, so the guard covers the spreadsheet too."""
    pool.client_row = {"name": '=HYPERLINK("http://evil","x")',
                       "created_at": None}
    resp = report(pool, format="csv")
    body = resp.body.decode("utf-8")
    assert "'=HYPERLINK" in body
    assert '\n=HYPERLINK' not in body and not body.startswith('=')


def test_quiet_months_appear_instead_of_vanishing(pool, all_reachable):
    """A client quiet in June must not shorten the series to eleven rows —
    every month the window and the client's lifetime share is present, and
    the fill starts at the client, not at 2000-01."""
    out = report(pool)                 # window 2026-05-01 → 2026-08-17
    periods = [m["period"] for m in out["monthly"]]
    assert periods == ["2026-05", "2026-06", "2026-07", "2026-08"]
    out = report(pool, date_from="2024-01-01", date_to="2026-08-17")
    periods = [m["period"] for m in out["monthly"]]
    assert periods[0] == "2025-04", "fill starts at the client's first month"


# ── the pdf branch renders THIS route's page (the body-swap regression) ──────
#
# The services/module_report extraction once swapped the two pdf builders and
# both routes 500'd on every format=pdf request — see the twin pins in
# test_analytics_module_report.py. `render_pdf` is stubbed to echo the HTML,
# so the assertion reads the document, not WeasyPrint.

@pytest.fixture
def echo_pdf(monkeypatch):
    from services import doc_render as R
    monkeypatch.setattr(R, "render_pdf", lambda html: html.encode("utf-8"))


def test_the_client_report_pdf_carries_its_own_page(pool, all_reachable, echo_pdf):
    resp = report(pool, format="pdf")
    assert resp.media_type == "application/pdf"
    html = bytes(resp.body).decode("utf-8")
    assert "Client report" in html
    assert "Khanna Electronics" in html
    assert "Month by month" in html
    # …and none of the module report's furniture.
    assert "Finance report" not in html
