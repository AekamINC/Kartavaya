"""Payment-link metrics — proposal 62 §4: links sent vs paid, median time to
payment, reconciliation lag.

Declared under `module="ganit"`: payment links are a Ganit (accounting)
capability — there is no "pay" module code, the registry gates catalogues on
module codes, and `Metric.__post_init__` requires the key prefix to equal the
module, so the keys are `ganit.pay_*`.

THE SCHEMA, read from migrations 128/130/039/018 and routers/pay.py:

· `ganit_invoices.pay_token` is minted by column DEFAULT **at INSERT**
  (migration 128, NOT NULL) — every invoice has a token from birth, so a
  token's existence is not a send, and there is no `sent_at` column on
  `ganit_invoices` or anywhere near it. "Links sent" is therefore a declared
  absence below; the earliest OBSERVABLE fact about a link is its first open,
  recorded by `staging.ganit_pay_scans` (migration 130: `created_at`
  TIMESTAMPTZ, outcome view/qr/app/invoice).
· A scan row is only ever written for a publicly payable invoice —
  routers/pay.py `_payable_row` refuses drafts, cancelled and settled tokens
  before the insert — so the scan table needs no doc_status guard of its own;
  `is_active` on the invoice join is kept because an invoice can be
  soft-deleted after its link was opened.
· **There is no payment gateway and never will be: "paid" only ever comes
  from bank reconciliation.** What reconciliation writes is
  `staging.ganit_payments` rows (`payment_date` DATE, `created_at`
  TIMESTAMPTZ) and `ganit_invoices.payment_status` / `amount_paid`. Every
  description below says "reconciled", never "paid online".
· `ganit_bank_statement_lines` (039) has NO `reconciled_at` —
  `is_reconciled` is a bare boolean — so "how long did a bank line wait to be
  matched" is not recorded anywhere. What IS recorded: the bank's
  `statement_date` and the matched payment row's `created_at` (the moment the
  books learned of the money, `matched_payment_id -> ganit_payments.id`).
  The lag metric measures exactly that gap and its description says so.
· `ganit_payments.attribution` (migration 130) is nullable for ever and NULL
  on every pre-130 row, so nothing here keys on it — a metric gated on it
  would read zero against real history.

House rules held: medians via percentile_cont(0.5) never AVG, rates from
counts within each bucket, every parameter cast (PgBouncer), `balance_due`
never read (it has drifted from the arithmetic on live rows), and no id
reaches a response column.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: One invoice's first open: MIN over every scan row for it. Any outcome
#: counts — 'qr', 'app' and 'invoice' presuppose the page was open, and 130's
#: own comment calls the page-open row 'view'; taking MIN over all four is
#: robust to a lost 'view' insert (the endpoint is fire-and-forget).
_FIRST_OPEN = (
    "SELECT s.invoice_id, MIN(s.created_at) AS first_open "
    "FROM staging.ganit_pay_scans s "
    "WHERE s.org_id = $1::uuid "
    "GROUP BY s.invoice_id"
)


@metric(
    key="ganit.pay_links_opened",
    module="ganit",  # payment links are a Ganit capability; there is no "pay"
                     # module code — the registry gates on module codes, and
                     # any other value would gate these out of every catalogue.
    label="Pay links opened",
    unit="count",
    grain="flow",
    drill="ganit.invoices",
    description="Invoices whose payment link was first opened during the "
                "period — with how many of those are now reconciled as paid. "
                "Nothing records a send (the token is minted at invoice "
                "creation), so the first open is the earliest observable "
                "fact about a link; ganit.pay_links_sent states the absence.",
)
def links_opened(req: MetricRequest):
    period = bucket_expr(req.bucket, "fo.first_open")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value, "
        # payment_status is what bank reconciliation maintains; the arithmetic
        # (total - amount_paid) is the OUTSTANDING story and belongs to the
        # ageing metrics — "reconciled as paid" is the recorded settlement
        # state, as at today, for links opened in the bucket.
        "COUNT(*) FILTER (WHERE i.payment_status = 'paid') AS reconciled_paid "
        f"FROM ({_FIRST_OPEN}) fo "
        "JOIN staging.ganit_invoices i ON i.id = fo.invoice_id "
        "WHERE i.org_id = $1::uuid AND i.is_active = TRUE "
        "AND fo.first_open::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.pay_link_conversion",
    module="ganit",  # a Ganit capability — no "pay" module code exists.
                     # See the note on ganit.pay_links_opened.
    label="Pay link conversion",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    drill="ganit.invoices",
    description="Of the invoices whose link was first opened in each bucket, "
                "the share now reconciled as paid — counts over counts, never "
                "an average of rates, with opened and reconciled_paid riding "
                "along so the % is auditable. Reconciled means the bank "
                "statement said so; there is no gateway.",
)
def link_conversion(req: MetricRequest):
    period = bucket_expr(req.bucket, "fo.first_open")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE i.payment_status = 'paid')::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE i.payment_status = 'paid') AS reconciled_paid, "
        "COUNT(*) AS opened "
        f"FROM ({_FIRST_OPEN}) fo "
        "JOIN staging.ganit_invoices i ON i.id = fo.invoice_id "
        "WHERE i.org_id = $1::uuid AND i.is_active = TRUE "
        "AND fo.first_open::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.pay_time_to_payment",
    module="ganit",  # a Ganit capability — no "pay" module code exists.
                     # See the note on ganit.pay_links_opened.
    label="Time to payment",
    unit="days",
    grain="flow",
    sensitivity="financial",
    drill="ganit.payments",
    description="Median days from a pay link's first open to a reconciled "
                "payment, for payments recorded in each bucket. Median "
                "(percentile_cont), not mean. Anchored on the first OPEN "
                "because nothing records a send; payments dated before the "
                "first open are excluded — a link cannot claim money that "
                "arrived before it was seen. Reconciled means the bank "
                "statement said so; there is no gateway.",
)
def time_to_payment(req: MetricRequest):
    period = bucket_expr(req.bucket, "p.payment_date")
    return (
        f"SELECT {period} AS period, "
        "percentile_cont(0.5) WITHIN GROUP "
        "(ORDER BY p.payment_date - fo.first_open::date)::float AS value, "
        "COUNT(*) AS payments "
        "FROM staging.ganit_payments p "
        f"JOIN ({_FIRST_OPEN}) fo ON fo.invoice_id = p.invoice_id "
        "WHERE p.org_id = $1::uuid "
        "AND p.payment_date >= fo.first_open::date "
        "AND p.payment_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="ganit.pay_reconciliation_lag",
    module="ganit",  # a Ganit capability — no "pay" module code exists.
                     # See the note on ganit.pay_links_opened.
    label="Reconciliation lag",
    unit="days",
    grain="flow",
    drill="ganit.bank",
    description="Median days from the bank's statement date to the matched "
                "payment row being recorded in the books, for statement "
                "lines reconciled to invoice payments, per bucket by "
                "statement date. ganit_bank_statement_lines has no "
                "reconciled_at — when the MATCH happened is unrecorded — so "
                "this measures the two dates the schema actually holds, and "
                "claims nothing more.",
)
def reconciliation_lag(req: MetricRequest):
    period = bucket_expr(req.bucket, "l.statement_date")
    return (
        f"SELECT {period} AS period, "
        "percentile_cont(0.5) WITHIN GROUP "
        # created_at is when the payment row was written — the moment the
        # books learned of the money. payment_date is useless here: the clerk
        # backdates it to the bank's own date at reconciliation, so that gap
        # reads ~0 by construction.
        "(ORDER BY p.created_at::date - l.statement_date)::float AS value, "
        "COUNT(*) AS lines "
        "FROM staging.ganit_bank_statement_lines l "
        "JOIN staging.ganit_payments p "
        "ON p.id = l.matched_payment_id AND p.org_id = $1::uuid "
        "WHERE l.org_id = $1::uuid AND l.is_reconciled "
        # matched_type is a two-value CHECK (invoice_payment/vendor_payment);
        # only invoice payments live in ganit_payments, and the join must not
        # accidentally collide a vendor payment's uuid.
        "AND l.matched_type = 'invoice_payment' "
        "AND l.statement_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer this honestly ─────────────────
# Proposal 62 §10: a stated absence, never a convincing zero.

absent_metric(
    key="ganit.pay_links_sent",
    module="ganit",  # a Ganit capability — no "pay" module code exists.
                     # See the note on ganit.pay_links_opened.
    label="Pay links sent",
    unit="count",
    grain="flow",
    absent="Nothing records a send: ganit_invoices.pay_token is minted by "
           "column DEFAULT at INSERT (migration 128), so every invoice holds "
           "a token from birth and a token's existence is not a send — and "
           "there is no sent_at column on ganit_invoices or any table near "
           "it. staging.ganit_pay_scans records OPENS, which is what "
           "ganit.pay_links_opened counts instead. Recording sends needs a "
           "column written by whichever channel actually shares the link.",
)
