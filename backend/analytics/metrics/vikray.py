"""Vikray (sales) metrics — proposal 62 §4, derived 2026-08-18 from the
migration set and routers/vikray.py (no live probe from this session; every
measured figure cited below is the router's own, with the migration that
established each fact named inline).

Naming first, because the catalogue's word is not the table's: the "stored
targets" live in **staging.vikray_targets** (migration 020) — there is no
`sales_targets` table, which was FALSE when written and is TRUE now: one existed
and held 0 rows table-wide until migration **235** dropped it with
`sales_territories` and `sales_routing_rules` on 2026-08-27 — and
`salesperson_id` is TEXT since migration 092,
matching `public.users.user_id`. That join takes NO cast: the broken version
needed `owner_id::text` precisely because it was reaching for the wrong uuid
column, and a cast on this join is the fingerprint of that mistake.

The guards every order query here carries, and why:

· A sales "customer" is DERIVED — `vikray_orders.client_id` joining
  `staging.graha_clients` (migration 136). There is no customer table.
  Orders with a NULL client_id (pre-136 rows, or a contact with no company)
  are real revenue with no company attached: concentration folds them into
  one 'Unattributed orders' row rather than dropping them from the
  denominator; repeat rate EXCLUDES them from both sides, because an order
  that names no customer can prove neither a first purchase nor a repeat.
· `is_active = TRUE` everywhere. Cancelling an order sets BOTH
  status='cancelled' AND is_active=FALSE (routers/vikray.cancel_order), so
  'cancelled' never appears as a status bucket — it is soft-deleted money,
  the same shape as ganit's is_active filter.
· `status <> 'draft'` on every money metric: a draft is a number somebody is
  still typing (only drafts are editable). The one exception is
  vikray.orders itself, whose status dimension IS the lifecycle — cutting
  draft from its headline would leave a split that no longer sums to it.
· Line-level revenue exists ONLY inside `line_items` jsonb — there is no
  order-lines table. A line is priced exactly as the router's
  `_compute_order_totals` prices it (qty × rate × (1 − discount_pct/100),
  pre-tax), and the ORDER-level `discount` column cannot be attributed to a
  line, so product-mix shares are pre-discount and say so. The product join
  compares `p.id::text = li->>'product_id'` — text against text — because
  casting the jsonb value to uuid would let one malformed line 500 the
  whole metric.
· Target attainment is the ROUTER's definition, verbatim (routers/vikray.py,
  measured live there): won deals by `graha_deals.assigned_to`, dated
  `COALESCE(won_at, updated_at)`, inside the TARGET's own stored period.
  Never `owner_id` (nothing writes it — 649 deals, 0 non-null), never
  `created_by` (data-entry credit: one user keyed all 658 invoices in one
  live org), never orders or invoices (neither carries an owner). The
  analytics window selects WHICH targets (period overlap with $2..$3); each
  target is then measured over its own period, because that period is the
  contract the target row states.
· Every parameter is cast ($1::uuid, $2::date) — PgBouncer turns an untyped
  parse error into an instant 500 (the credits incident).
· Ratios come from SUMS (or grouped counts), never averages of rates;
  medians via percentile_cont(0.5), never AVG.

And the one absence: `staging.ganit_products.cost_price` EXISTS since
migration 137 (2026-08-09) — any note saying the product has no cost column
predates that migration — but it holds TODAY's cost, defaults to NULL until
someone records one, and an order's line_items snapshot no cost at order
time. Margin is declared absent for that reason, not for a missing column.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: qty × rate × (1 − discount_pct/100) for one jsonb line — the exact
#: arithmetic of routers/vikray._compute_order_totals, pre-tax and before the
#: order-level `discount` column (which has no line to belong to). Every
#: operand is COALESCEd: a hand-built line missing a key must price as 0,
#: not null the whole product's sum (the ganit cess lesson).
_LINE_VALUE = (
    "COALESCE((li->>'quantity')::numeric, 0) "
    "* COALESCE((li->>'rate')::numeric, 0) "
    "* (1 - COALESCE((li->>'discount_pct')::numeric, 0) / 100)"
)


@metric(
    key="vikray.orders",
    module="vikray",
    label="Order value and count",
    unit="inr",
    grain="flow",
    dimensions=("status",),
    sensitivity="financial",
    drill="vikray.orders",
    description="Value and count of orders placed in the period, by order "
                "date; group_by=status splits the lifecycle. Drafts ride in "
                "the headline so the split always sums to it; cancelled "
                "orders are soft-deleted and appear nowhere.",
)
def orders(req: MetricRequest):
    period = bucket_expr(req.bucket, "order_date")
    group = ", status" if req.group_by == "status" else ""
    return (
        f"SELECT {period} AS period{group}, "
        "SUM(COALESCE(total, 0))::float AS value, "
        "COUNT(*) AS orders "
        "FROM public.vikray_orders "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "AND order_date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{group and ', 2'} ORDER BY 1{group and ', 2'}",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vikray.aov",
    module="vikray",
    label="Average order value",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    drill="vikray.orders",
    description="Per-bucket SUM(total)/COUNT(*) — the bucketed series IS the "
                "trend. A ratio of the bucket's sums, with both operands "
                "riding along; drafts excluded, they are numbers somebody is "
                "still typing.",
)
def aov(req: MetricRequest):
    period = bucket_expr(req.bucket, "order_date")
    return (
        f"SELECT {period} AS period, "
        "SUM(COALESCE(total, 0))::float / NULLIF(COUNT(*), 0)::float AS value, "
        "SUM(COALESCE(total, 0))::float AS order_value, "
        "COUNT(*) AS orders "
        "FROM public.vikray_orders "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND status <> 'draft' "
        "AND order_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vikray.product_mix",
    module="vikray",
    label="Product mix",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    drill="vikray.orders",
    description="Revenue per product over the whole window, with each "
                "product's share of the window total. Line revenue is "
                "qty x rate x (1 - discount%), pre-tax and before the "
                "order-level discount. Lines naming no catalogued product "
                "fold into 'Uncatalogued lines'.",
)
def product_mix(req: MetricRequest):
    # The inner query is bucketed to honour the registry's one-walk contract
    # (every flow interpolates the validated bucket); the outer sums the
    # per-bucket sums, so the shares stay whole-window whichever bucket the
    # caller sends — a sum of sums is invariant to the cut, the same shape
    # ganit.dso pins. Grouping is by p.id, so two products sharing a name
    # stay two rows and every uncatalogued line folds into the one NULL
    # group, which COALESCE then names honestly (names-not-ids: no id
    # reaches the outer select list).
    period = bucket_expr(req.bucket, "o.order_date")
    return (
        "SELECT label, SUM(v)::float AS value, "
        "(SUM(v) / NULLIF(SUM(SUM(v)) OVER (), 0) * 100)::float AS share_pct, "
        "SUM(n) AS orders "
        "FROM ("
        f"SELECT {period} AS period, p.id AS product_key, "
        "COALESCE(p.name, 'Uncatalogued lines') AS label, "
        f"SUM({_LINE_VALUE}) AS v, "
        "COUNT(DISTINCT o.id) AS n "
        "FROM public.vikray_orders o "
        "CROSS JOIN LATERAL jsonb_array_elements(o.line_items) AS li "
        "LEFT JOIN public.ganit_products p "
        "ON p.id::text = li->>'product_id' AND p.org_id = o.org_id "
        "WHERE o.org_id = $1::uuid AND o.is_active = TRUE AND o.status <> 'draft' "
        "AND o.order_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1, p.id, p.name"
        ") lines "
        "GROUP BY product_key, label "
        "HAVING SUM(v) <> 0 "
        "ORDER BY value DESC",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vikray.repeat_rate",
    module="vikray",
    label="Repeat rate",
    unit="pct",
    grain="flow",
    drill="vikray.customers",
    description="Customers with more than one order in the period over "
                "customers with at least one, from grouped per-customer "
                "counts. A customer is a COMPANY (client_id); orders naming "
                "no company are excluded from both sides — they can prove "
                "neither a first purchase nor a repeat one.",
)
def repeat_rate(req: MetricRequest):
    # Grouped counts, then a ratio of those counts — never an average of
    # per-bucket rates. The innermost query is bucketed for the registry
    # walk; per-customer totals are the sum of their per-bucket counts, so
    # the answer is the same whichever bucket arrives.
    period = bucket_expr(req.bucket, "order_date")
    return (
        "SELECT (COUNT(*) FILTER (WHERE n > 1))::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE n > 1) AS repeat_customers, "
        "COUNT(*) AS customers "
        "FROM ("
        "SELECT client_id, SUM(c) AS n FROM ("
        f"SELECT {period} AS period, client_id, COUNT(*) AS c "
        "FROM public.vikray_orders "
        "WHERE org_id = $1::uuid AND is_active = TRUE AND status <> 'draft' "
        "AND client_id IS NOT NULL "
        "AND order_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1, client_id"
        ") pb GROUP BY client_id"
        ") per_customer "
        # An unfiltered aggregate returns one row even for an org that is
        # not yours — a {value: null} row-shape leak. No customers → no rows.
        "HAVING COUNT(*) > 0",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vikray.target_attainment",
    module="vikray",
    label="Target attainment",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    drill="vikray.targets",
    description="Each stored target whose period overlaps the window, with "
                "what its salesperson actually closed: won deals by "
                "assignee, dated by close date, inside the TARGET's own "
                "period — the router's measured definition, not a new one. "
                "value is NULL for an amount-less (deals-only) target; the "
                "amounts and deal counts ride along either way.",
)
def target_attainment(req: MetricRequest):
    # The window chooses WHICH targets; each target is measured over its own
    # stored period, because that period is the contract the row states —
    # clipping a quarter target to a month window would report a number the
    # target never promised. The deal aggregate is bucketed inside the
    # LATERAL for the registry walk and summed back; buckets partition the
    # timeline, so the total is unchanged.
    period = bucket_expr(req.bucket, "COALESCE(d.won_at, d.updated_at)")
    return (
        "SELECT COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unknown salesperson') AS label, "
        "t.period_start, t.period_end, "
        "(COALESCE(won.amount, 0) / NULLIF(t.target_amount, 0) * 100)::float AS value, "
        "COALESCE(won.amount, 0)::float AS actual_amount, "
        "COALESCE(t.target_amount, 0)::float AS target_amount, "
        "COALESCE(won.deals, 0) AS actual_deals, "
        "t.target_deals "
        "FROM public.vikray_targets t "
        # Text = text, no cast (migration 092): a cast here is the
        # fingerprint of the dead owner_id column coming back.
        "LEFT JOIN public.users u ON u.user_id = t.salesperson_id "
        "LEFT JOIN LATERAL ("
        "SELECT SUM(v) AS amount, SUM(c) AS deals FROM ("
        f"SELECT {period} AS period, "
        "SUM(COALESCE(d.value, 0)) AS v, COUNT(*) AS c "
        "FROM public.graha_deals d "
        "WHERE d.org_id = $1::uuid AND d.is_active = TRUE AND d.stage = 'Won' "
        "AND d.assigned_to = t.salesperson_id "
        "AND COALESCE(d.won_at, d.updated_at) >= t.period_start "
        "AND COALESCE(d.won_at, d.updated_at) < t.period_end + 1 "
        "GROUP BY 1"
        ") pb"
        ") won ON TRUE "
        "WHERE t.org_id = $1::uuid "
        "AND t.period_end >= $2::date AND t.period_start <= $3::date "
        "ORDER BY t.period_start DESC, label",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vikray.order_to_invoice_lag",
    module="vikray",
    label="Order to invoice lag",
    unit="days",
    grain="flow",
    sensitivity="financial",
    drill="vikray.orders",
    description="Median days from order date to invoice date for orders "
                "placed in each bucket — with the leak beside it: how many "
                "of the bucket's orders have NO live invoice, and the value "
                "sitting uninvoiced. Windowed on ORDER date, deliberately, "
                "so the uninvoiced are countable in the same buckets as the "
                "median.",
)
def order_to_invoice_lag(req: MetricRequest):
    # The join demands i.is_active: an order whose invoice was later deleted
    # has leaked AGAIN, and counting it as invoiced would hide exactly the
    # revenue this metric exists to surface. invoice_date is NOT NULL on
    # ganit_invoices, so `i.invoice_date IS NULL` means precisely "no live
    # invoice matched" — no id ever reaches the select list.
    period = bucket_expr(req.bucket, "o.order_date")
    return (
        f"SELECT {period} AS period, "
        "(percentile_cont(0.5) WITHIN GROUP (ORDER BY i.invoice_date - o.order_date) "
        "FILTER (WHERE i.invoice_date IS NOT NULL))::float AS value, "
        "COUNT(*) FILTER (WHERE i.invoice_date IS NOT NULL) AS invoiced_orders, "
        "COUNT(*) FILTER (WHERE i.invoice_date IS NULL) AS uninvoiced_orders, "
        "(SUM(COALESCE(o.total, 0)) FILTER (WHERE i.invoice_date IS NULL))::float AS uninvoiced_value "
        "FROM public.vikray_orders o "
        "LEFT JOIN public.ganit_invoices i "
        "ON i.id = o.invoice_id AND i.org_id = o.org_id AND i.is_active = TRUE "
        "WHERE o.org_id = $1::uuid AND o.is_active = TRUE AND o.status <> 'draft' "
        "AND o.order_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="vikray.customer_concentration",
    module="vikray",
    label="Customer concentration",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    drill="vikray.customers",
    description="The 15 companies with the most order value in the window, "
                "each with its share of the window's WHOLE revenue — the "
                "denominator is every order, not the fifteen. Orders naming "
                "no company fold into one 'Unattributed orders' row rather "
                "than vanishing from the denominator.",
)
def customer_concentration(req: MetricRequest):
    # The share's window function runs over ALL grouped rows before ORDER BY
    # and LIMIT apply, so a top-15 row's share is measured against the whole
    # window's revenue — a share computed after the LIMIT would sum to 100%
    # across whatever happened to survive the cut and look plausible.
    # Grouping is by cl.id (NULLs fold), the top_debtors shape.
    period = bucket_expr(req.bucket, "o.order_date")
    return (
        "SELECT label, SUM(v)::float AS value, "
        "(SUM(v) / NULLIF(SUM(SUM(v)) OVER (), 0) * 100)::float AS share_pct, "
        "SUM(c) AS orders "
        "FROM ("
        f"SELECT {period} AS period, cl.id AS customer_key, "
        "COALESCE(cl.name, 'Unattributed orders') AS label, "
        "SUM(COALESCE(o.total, 0)) AS v, COUNT(*) AS c "
        "FROM public.vikray_orders o "
        "LEFT JOIN public.graha_clients cl "
        "ON cl.id = o.client_id AND cl.org_id = o.org_id "
        "WHERE o.org_id = $1::uuid AND o.is_active = TRUE AND o.status <> 'draft' "
        "AND o.order_date BETWEEN $2::date AND $3::date "
        "GROUP BY 1, cl.id, cl.name"
        ") by_customer "
        "GROUP BY customer_key, label "
        "ORDER BY value DESC LIMIT 15",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer this honestly ────────────────
# Proposal 62 §10: a stated absence, never a convincing zero.

absent_metric(
    key="vikray.order_margin",
    module="vikray",
    label="Order margin",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    absent="The write path now exists and the DATA does not. Order and invoice "
           "lines written from 2026-08-25 snapshot migration 184's "
           "cost_price — per unit, cost at order time, copied off "
           "public.ganit_products and never re-joined, so pricing a January "
           "order at August's cost is no longer the risk. The remaining one "
           "is coverage: cost_price on ganit_products (migration 137, "
           "2026-08-09) is recorded on 2 of 106 live products, and 389 of 389 "
           "order lines predate the snapshot, so a margin computed today would "
           "cover a handful of lines and read as the whole. Summing only the "
           "costed lines is the fiction this absence refuses. Re-check the "
           "costed-line fraction before turning this into a query; the note "
           "row in commission_reports already reports it.",
)
