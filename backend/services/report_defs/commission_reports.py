"""The consultant page — turnover, contribution, margin and commission.

Two sections, both flow, both on the existing ReportDef spine so neither needs
a renderer, a PDF engine or an export path of its own:

    core.consultant_pnl    one row per person, ALPHABETICAL.
    core.period_figures    the org's own week / month / quarter / YTD / year.

WHAT IS COMPUTABLE TODAY, STATED FIRST BECAUSE IT IS THE FINDING
────────────────────────────────────────────────────────────────
Per person: NOTHING. Not turnover, not gross profit, not margin, not
commission. Measured read-only against the live database on 2026-08-21, all
organisations:

    staging.ganit_invoices     788 active. No column has ever recorded who
                               SOLD one. `created_by` holds 693 of them under
                               one account; `prepared_by` disagrees with
                               `created_by` on 751 of 788. ₹11.55 crore of
                               signed turnover sits behind that one account.
    staging.vikray_orders      377 active. No salesperson column existed at
                               all before migration 184; `created_by` is 319
                               of 377 under one account.
    staging.graha_deals        675 deals, `assigned_to` filled on 141 — the
                               only attribution the product has ever held, and
                               it does not reach the money: 1 of 377 orders
                               and 5 of 788 invoices carry a `deal_id`.
    cost                       0 of 389 order lines and 0 of 1,342 invoice
                               lines carry any cost key. `ganit_products.
                               cost_price` is filled on 2 of 106 products and
                               is the wrong source anyway — a product's cost
                               today is not what it cost when the invoice was
                               raised.
    the HR bridge              `staging.manav_employees.user_id` is filled on
                               0 of 98 rows, and 0 employee emails match any
                               row in public.users. 98 employees, 32 users, no
                               edge between the sets.

Migrations 184 and 185 add the columns. They backfill nothing, because there
is no historical record of who sold what to backfill FROM. So these two
sections ship computing almost nothing, and that is the point: the page says
so, by name, on every row, instead of printing zeros.

THE ONE RULE THIS FILE EXISTS TO ENFORCE
────────────────────────────────────────
A zero is a claim. "Not attributable" is the truth.

`SUM(...)` over zero attributed invoices returns 0, and ₹0.00 under a turnover
heading beside a person's name is a sentence about that person: they sold
nothing. Today that sentence is false for every person in every org, because
nobody ever wrote down who sold anything. Every money cell below therefore
goes through `commission.cell(value, reason)`, which returns a float when
there is one and THE WORD otherwise. `COALESCE(sum, 0)` appears nowhere in
either query, and `tests/test_commission.py` scans this module's SQL to keep
it that way.

The distinction is drawn per ORG PER PERIOD, not globally: if the period's
documents carry no salesperson at all, no person's figure can be computed and
every row says so. If SOME documents are attributed, then a person with none
of them genuinely sold nothing in the period and ₹0.00 is a true, checkable
answer — and the note row says what fraction of the book is on nobody's line,
so a reader who totals the column and finds it short knows why.

THERE IS NO RANKING, AND THERE WILL NOT BE ONE
──────────────────────────────────────────────
Rows are alphabetical by name. Not by turnover, not by commission, not by
margin. This product already crowned a "CHAMPION OF THE PERIOD" on a
lifetime total printed under a weekly heading and removed it; `work_reports`
carries the same rule for the same reason. A page that ranks colleagues by
revenue is a different artefact from a page that reports their figures, and
this is the second one.

"GROSS PROFIT" HERE IS A CONTRIBUTION FIGURE
────────────────────────────────────────────
Ganit keeps no double-entry ledger, no journal and no chart of accounts. There
is no overhead in these numbers, no salary cost, no premises, no
apportionment and no tax. `core.period_figures` is NOT a profit and loss
account and neither section may be described as one; the qualification is
printed IN the table by `commission.gross_profit_is_contribution()`, not left
in a docstring nobody renders.

WHAT COUNTS AS TURNOVER
───────────────────────
Exactly what `ganit.sales_register` counts, and deliberately the same four
guards in the same order, so this page and the sales register cannot disagree
about the firm's own turnover:

  1. `is_active = TRUE`
  2. `doc_status <> 'draft'` — never `= 'final'`; doc_status DEFAULTS to
     'final' and the live values include 'viewed' and 'sent'.
  3. `invoice_type NOT IN ('proforma', 'quotation')` — offers, not sales.
  4. not cancelled — `cancelled_at IS NULL` AND `payment_status <> 'cancelled'`.

Credit notes are NEGATED, not dropped and not added; debit notes are not
negated, because a debit note moves the same way an invoice does. That is
`ganit.invoiced`'s CASE and the sales register's sign, kept identical here.

INVOICES, NOT ORDERS, ARE THE TURNOVER
──────────────────────────────────────
Both tables get a `salesperson_id` in migration 184, and only the invoice is
read for turnover. An order is a commitment; an invoice is what was billed,
and commission on an order that is later cancelled pays for a sale that did
not happen (5 of 377 live orders are cancelled). The order column exists so
that attribution can be captured at the point of sale and CARRIED to the
invoice, which is where the write path must copy it.
"""
from __future__ import annotations

from datetime import date

from services import commission as C
from services.report_defs import report_def
from services.report_defs._shared import (
    BLANK, ROW_CAP, capped, money, overflow_row, window_or_raise)

PNL_KEY = "core.consultant_pnl"
FIGURES_KEY = "core.period_figures"

#: The name column on the consultant page. The footer's label sits here and
#: nowhere else — a word written into a money column is not a number any
#: spreadsheet will parse.
PERSON = "Person"

#: The label column on the org page. Same rule.
PERIOD = "Period"

#: The org-level footer of the consultant page.
ALL_PEOPLE = "All people"

#: A person key that no longer resolves through `public.users`. The label
#: exists so the first deleted account prints a word rather than vanishing
#: from a column its turnover is still counted in — and so it never prints
#: the raw handle (decision_names_not_ids).
UNRECORDED_PERSON = "Person no longer on record"

#: An employee with no `user_id`. 98 of 98 live rows. Their scheme is
#: recordable and their revenue is not reachable, and the page must say which.
NO_LOGIN = "no login linked"

#: The types that are OFFERS, not sales — a proforma and a quotation are
#: things the firm may never issue, and turnover that includes them is
#: turnover the firm did not have. Bound as an array parameter, never
#: interpolated, and shared by BOTH sections so the two cannot drift apart.
#: Live count today: 0. This line is what stops the first one landing.
OFFER_TYPES = ("proforma", "quotation")

#: How many units the line sold, read defensively.
#:
#: `qty` appears on 1,027 live invoice lines and `quantity` on 315 — two
#: spellings of one idea, both present, neither universal. A bare `::numeric`
#: cast would raise on the first line whose quantity was typed as "2 nos" and
#: take the whole report down with a 500, so the regex test makes an
#: unparseable quantity fall through to 1 instead. Falling through to 1 is a
#: deliberate UNDERSTATEMENT of cost: it can only make the margin shown look
#: worse, never better, and the note row already says what fraction of lines
#: carry a cost at all.
QTY_SQL = (
    "COALESCE("
    "  CASE WHEN li->>'qty' ~ '^-?[0-9]+(\\.[0-9]+)?$' "
    "       THEN (li->>'qty')::numeric END, "
    "  CASE WHEN li->>'quantity' ~ '^-?[0-9]+(\\.[0-9]+)?$' "
    "       THEN (li->>'quantity')::numeric END, "
    "  1)"
)

#: The money columns of the consultant page, in print order. Only these are
#: summed in the footer — and a footer cell is summed only over the rows that
#: hold a NUMBER there, because summing a column half full of words is how a
#: total comes to under-report and look precise doing it.
PNL_MONEY = ("Turnover", "Cost", "Gross profit", "Commission")


# ══════════════════════════════════════════════════════════════════════════
# A · core.consultant_pnl
# ══════════════════════════════════════════════════════════════════════════

#: One row per PERSON, driven off org membership.
#:
#: The spine is `staging.user_roles` — the sole tenant path — because
#: attribution keys on `public.users.user_id` and a person who cannot be named
#: cannot be attributed to. Employees are LEFT JOINed on, not driven from:
#: 98 employees against 32 users with no edge between them means an
#: employee-driven spine would list 98 names of whom none could carry a figure.
#: The note row states the employee count that is unreachable, so neither set
#: is silently dropped.
#:
#: `DISTINCT` on the membership: 41 role rows cover 28 users, and a person with
#: two roles in one org is one person on one line.
#:
#: EVERY join carries an org predicate. Joining a scheme on employee_id alone,
#: or an employee on user_id alone, can surface another org's row — the exact
#: shape of the graha_clients join leak — and no composite key exists for a
#: foreign key to refuse it, so the predicate is the only guard.
PNL_SQL = (
    "WITH members AS ("
    "  SELECT DISTINCT ur.user_id AS uid "
    "    FROM public.user_roles ur "
    "   WHERE ur.org_id = $1::uuid"
    "), "
    # Attributed turnover, per person, over the window. INNER on the
    # salesperson: a document with no salesperson belongs on nobody's line and
    # must not be spread, averaged or assigned to the person who keyed it.
    "attributed AS ("
    "  SELECT i.salesperson_id AS uid, "
    "         SUM(CASE WHEN i.invoice_type = 'credit_note' "
    "                  THEN -(COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "                  ELSE  (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "             END) AS turnover, "
    "         COUNT(*) AS docs "
    "    FROM public.ganit_invoices i "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.salesperson_id IS NOT NULL "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1"
    "), "
    # The cost of what those attributed documents sold. Per LINE, from the
    # line's own `cost_price` (migration 184's documented key) — never joined
    # to ganit_products at read time, which would re-price last year's gross
    # profit every time procurement changes a number.
    #
    # `li ? 'cost_price'` and not COALESCE(...,0): a line with no cost is NOT a
    # line that cost nothing. `lines_costed` counts how many had one so the
    # note row can say what fraction of the cost is real.
    "costs AS ("
    "  SELECT i.salesperson_id AS uid, "
    "         SUM((li->>'cost_price')::numeric "
    "             * " + QTY_SQL + ") AS cost, "
    "         COUNT(*) AS lines_costed "
    "    FROM public.ganit_invoices i, "
    "         jsonb_array_elements(i.line_items) li "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.salesperson_id IS NOT NULL "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date "
    "     AND li ? 'cost_price' "
    "     AND jsonb_typeof(li->'cost_price') = 'number' "
    "   GROUP BY 1"
    "), "
    # The employee behind the login, if anyone has linked them. Both
    # predicates org-scoped. `is_active` is NOT filtered: a person who left in
    # June still sold what they sold in May, and re-writing history because an
    # HR row was tidied is a register that changes when nothing changed.
    "emp AS ("
    "  SELECT e.user_id AS uid, e.id AS employee_id, "
    # The department is how a TEAM is defined here (owner, 2026-08-21) and is
    # the only grouping with data: filled on 87 of 98 employees, while
    # `reporting_to` is filled on 0 of 98 and is not read anywhere. Blank is
    # normalised to NULL so that "" and NULL cannot become two different
    # departments that each look empty.
    "         NULLIF(btrim(COALESCE(e.department, '')), '') AS department "
    "    FROM public.manav_employees e "
    "   WHERE e.org_id = $1::uuid "
    "     AND e.user_id IS NOT NULL AND btrim(e.user_id) <> ''"
    "), "
    # THE DEPARTMENT'S OWN REVENUE — everybody in it, added together, for a
    # scheme scoped to 'department'. A document reaches a department through
    # the EMPLOYEE ROW OF ITS SALESPERSON, so a department's figure is exactly
    # the sum of the attributed figures of its members and cannot double count.
    # Both joins are org-scoped; joining an employee on user_id alone can
    # surface another org's row.
    "dept AS ("
    "  SELECT de.department AS dname, "
    "         SUM(CASE WHEN i.invoice_type = 'credit_note' "
    "                  THEN -(COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "                  ELSE  (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "             END) AS turnover, "
    "         COUNT(*) AS docs "
    "    FROM public.ganit_invoices i "
    "    JOIN ("
    "       SELECT NULLIF(btrim(COALESCE(me.department, '')), '') AS department, "
    "              me.user_id AS user_id "
    "         FROM public.manav_employees me "
    "        WHERE me.org_id = $1::uuid "
    "          AND me.user_id IS NOT NULL AND btrim(me.user_id) <> ''"
    "    ) de ON de.user_id = i.salesperson_id "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.salesperson_id IS NOT NULL "
    "     AND de.department IS NOT NULL "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1"
    "), "
    "dept_costs AS ("
    "  SELECT de.department AS dname, "
    "         SUM((li->>'cost_price')::numeric "
    "             * " + QTY_SQL + ") AS cost, "
    "         COUNT(*) AS lines_costed "
    "    FROM public.ganit_invoices i "
    "    JOIN ("
    "       SELECT NULLIF(btrim(COALESCE(me.department, '')), '') AS department, "
    "              me.user_id AS user_id "
    "         FROM public.manav_employees me "
    "        WHERE me.org_id = $1::uuid "
    "          AND me.user_id IS NOT NULL AND btrim(me.user_id) <> ''"
    "    ) de ON de.user_id = i.salesperson_id, "
    "         jsonb_array_elements(i.line_items) li "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.salesperson_id IS NOT NULL "
    "     AND de.department IS NOT NULL "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date "
    "     AND li ? 'cost_price' "
    "     AND jsonb_typeof(li->'cost_price') = 'number' "
    "   GROUP BY 1"
    ") "
    # THE LADDER STOPS BEFORE THE EMAIL. This read `COALESCE(u.full_name,
    # u.name, u.email, $5::text)`, so a salesperson with no name recorded had
    # their EMAIL printed as the row label of a COMMISSION report — a document
    # about money, read by people outside their team and exported to file. A
    # contact detail rendered as a label, and the inverse of the rule that
    # Aekam must not see a customer's member emails. The owner's ruling
    # (2026-08-23): a display-name ladder must never end at an email address.
    #
    # MEASURED FIRST, because the objection is "then the row loses its label":
    # on the live database 0 of 35 accounts have neither `full_name` nor
    # `name`. The email rung has never fired. Nothing visible changes.
    #
    # `$5::text` STAYS — it is this report's own caller-supplied terminal (the
    # translated "unknown person" string), which says more in context than a
    # fixed label would. Only the email rung was removed, so `$5` keeps its
    # number and every other placeholder in this statement is undisturbed; the
    # cast stays explicit because PgBouncer turns an untyped parameter
    # expression into an instant 500 rather than a parse error you can read.
    "SELECT COALESCE(u.full_name, u.name, $5::text) AS person, "
    "       a.turnover::float AS turnover, "
    "       a.docs::int AS docs, "
    "       c.cost::float AS cost, "
    "       c.lines_costed::int AS lines_costed, "
    "       (e.employee_id IS NOT NULL) AS has_employee, "
    "       e.department AS department, "
    "       d.turnover::float AS dept_turnover, "
    "       d.docs::int AS dept_docs, "
    "       dc.cost::float AS dept_cost, "
    "       dc.lines_costed::int AS dept_lines_costed, "
    "       s.schemes AS schemes "
    "  FROM members m "
    # users is global — it carries no org_id column. Every key reaching it came
    # out of a row already scoped to $1, so this join cannot widen the scope.
    "  LEFT JOIN public.users u ON u.user_id = m.uid "
    "  LEFT JOIN attributed a ON a.uid = m.uid "
    "  LEFT JOIN costs c ON c.uid = m.uid "
    "  LEFT JOIN emp e ON e.uid = m.uid "
    # The department totals hang off the person's OWN department, so two people
    # in one department see the same figure — which is correct: a
    # department-scoped scheme measures the department, not a share of it.
    "  LEFT JOIN dept d ON d.dname = e.department "
    "  LEFT JOIN dept_costs dc ON dc.dname = e.department "
    # EVERY scheme in force AT THE END OF THE PERIOD, each with its ladder —
    # not one of them. Since migration 190 a person may hold a monthly AND an
    # annual arrangement at the same time and be paid by both (the owner's own
    # example: 3% for clearing ₹5L this month, 2% for clearing ₹20L over the
    # year), so a `LIMIT 1` here would silently drop somebody's second cheque.
    # The half-open window is resolved in SQL exactly as `scheme_in_force`
    # resolves it in Python.
    #
    # EVERY MONEY VALUE IS CAST TO ::text INSIDE THE JSONB, and that is not
    # cosmetic. `jsonb_build_object` on a numeric produces a JSON NUMBER, which
    # arrives in Python as a FLOAT — and a rate applied to a crore-scale
    # turnover in binary floating point drifts in the paisa a payslip is
    # checked against. As text it reaches `Decimal(str)` exactly, which is the
    # rule the whole of services/commission.py is built on. Dates go the same
    # way and `commission._as_date` parses them; ISO only, never a local
    # format.
    "  LEFT JOIN LATERAL ("
    "      SELECT jsonb_agg(q.scheme ORDER BY q.period, q.effective_from ) "
    "               AS schemes "
    "        FROM ("
    "          SELECT sc.period, sc.effective_from, "
    "                 jsonb_build_object("
    "                   'eligible', sc.eligible, "
    "                   'basis', sc.basis, "
    "                   'revenue_scope', sc.revenue_scope, "
    "                   'period', sc.period, "
    "                   'effective_from', sc.effective_from::text, "
    "                   'effective_to', sc.effective_to::text, "
    "                   'bands', COALESCE(("
    "                       SELECT jsonb_agg(jsonb_build_object("
    "                                'from_amount', b.from_amount::text, "
    "                                'rate_percent', b.rate_percent::text) "
    "                              ORDER BY b.from_amount ) "
    "                         FROM public.manav_commission_bands b "
    "                        WHERE b.org_id = $1::uuid "
    "                          AND b.scheme_id = sc.id), '[]'::jsonb)"
    "                 ) AS scheme "
    "            FROM public.manav_commission_schemes sc "
    "           WHERE sc.org_id = $1::uuid "
    "             AND sc.employee_id = e.employee_id "
    "             AND sc.effective_from <= $3::date "
    "             AND (sc.effective_to IS NULL OR sc.effective_to > $3::date) "
    "        ) q"
    "  ) s ON TRUE "
    # ALPHABETICAL. Grouping is not needed — one row per member — but the sort
    # is by the resolved NAME, and never by any figure on the page.
    " ORDER BY person "
    " LIMIT $6::int"
)

#: The denominators. What the whole book did in the period, how much of it
#: names a salesperson, and how many lines carry a cost — so the note row can
#: state the gap in the same table as the numbers it explains.
#:
#: Two branches over the same guarded set, deliberately in one round trip:
#: asking twice invites the two questions to be asked over different filters.
PNL_SPREAD_SQL = (
    "WITH doc AS ("
    "  SELECT i.id, i.salesperson_id, i.line_items, "
    "         CASE WHEN i.invoice_type = 'credit_note' "
    "              THEN -(COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "              ELSE  (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "         END AS taxable "
    "    FROM public.ganit_invoices i "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date"
    ") "
    "SELECT (SELECT COUNT(*) FROM doc)::int AS docs, "
    "       (SELECT COUNT(*) FROM doc WHERE salesperson_id IS NOT NULL)::int "
    "           AS docs_attributed, "
    "       (SELECT COALESCE(SUM(taxable), 0) FROM doc)::float AS value, "
    "       (SELECT COALESCE(SUM(taxable), 0) FROM doc "
    "         WHERE salesperson_id IS NOT NULL)::float AS value_attributed, "
    "       (SELECT COUNT(*) FROM doc, jsonb_array_elements(doc.line_items) li)::int "
    "           AS lines, "
    "       (SELECT COUNT(*) FROM doc, jsonb_array_elements(doc.line_items) li "
    "         WHERE li ? 'cost_price' "
    "           AND jsonb_typeof(li->'cost_price') = 'number')::int AS lines_costed, "
    "       (SELECT COUNT(*) FROM public.manav_employees e "
    "         WHERE e.org_id = $1::uuid "
    "           AND (e.user_id IS NULL OR btrim(e.user_id) = ''))::int "
    "           AS employees_unlinked"
)


def _schemes_of(row, on) -> tuple:
    """EVERY arrangement in force on `on`, at most one per settlement period.

    Built through `commission.from_row` so the column names live in one place
    and a rename in a migration breaks one function loudly rather than
    producing a scheme with an invented rate somewhere downstream.

    Plural since migration 190. `LIMIT 1` used to be correct because at most
    one open scheme per employee could exist; a person may now hold a monthly
    and an annual arrangement at once, both current, and returning one of them
    would drop a cheque. `schemes_in_force` reduces any residual overlap to one
    per period DETERMINISTICALLY (latest effective_from wins), so two runs of
    this report cannot disagree.

    A row from an older query shape — one scheme, spread across columns — is
    still read, because tests and callers build people dicts by hand and a
    silent None here would render "no scheme recorded" against a person who
    has one.
    """
    raw = row.get("schemes")
    if raw:
        built = [C.from_row(s) for s in raw]
    elif row.get("basis") is not None and row.get("effective_from") is not None:
        built = [C.from_row(row)]
    else:
        return ()
    return C.schemes_in_force(built, on)


def _describe(scheme) -> str:
    """One arrangement, in a sentence: what it pays on, and WHOSE.

    The scope is never omitted. The same 3% applied to a person's own invoices
    and to their whole department's are wildly different cheques, and a rate
    printed without saying which it measures is a number a reader cannot
    check.
    """
    basis = "Turnover" if scheme.basis == "turnover" else "Gross profit"
    return f"{basis} — {C.describe_scope(scheme)}"


def _scheme_cells(schemes, threshold_reason: str = "") -> dict:
    """The four HR columns, over however many arrangements a person holds.

    Words when there is no scheme — never a 0% rate against somebody's name,
    which reads as an arrangement paying nothing rather than as no arrangement
    at all.

    With more than one scheme every cell lists all of them, separated by ' · ',
    IN THE SAME ORDER in each column, so a reader can line the columns up and
    see which rate belongs to which period. Dropping the second one to keep the
    cell tidy would hide a payment.
    """
    schemes = tuple(schemes or ())
    if not schemes:
        return {"Commission basis": threshold_reason or C.NO_SCHEME,
                "Rate %": BLANK, "Threshold": BLANK, "Settles": BLANK}
    live = tuple(s for s in schemes if s.eligible)
    if not live:
        return {"Commission basis": C.NOT_ON_COMMISSION,
                "Rate %": BLANK, "Threshold": BLANK, "Settles": BLANK}

    # A single flat band keeps its numeric rate column — a float in a "Rate %"
    # column is what a spreadsheet can sort. A ladder cannot be one number
    # without choosing which of its rates to print, and the top rate is not
    # the rate most of the money earned under the marginal reading, so it
    # prints the whole ladder as prose instead.
    if len(live) == 1 and len(live[0].effective_bands()) == 1:
        only = live[0]
        band = only.effective_bands()[0]
        return {
            "Commission basis": _describe(only),
            "Rate %": float(band.rate_percent),
            "Threshold": money(band.from_amount),
            "Settles": only.period.capitalize(),
        }
    return {
        "Commission basis": " · ".join(_describe(s) for s in live),
        "Rate %": " · ".join(C.describe_bands(s) for s in live),
        "Threshold": " · ".join(
            f"₹{s.entry_threshold:,.2f}" for s in live),
        "Settles": " · ".join(s.period.capitalize() for s in live),
    }


def _money_footer(rows: list, columns: tuple, label: str) -> dict:
    """The footer — every money column summed OVER THE NUMERIC CELLS ONLY.

    `_shared.total_row` sums `r.get(key) or 0.0` and would raise on a string,
    which is what half these cells are today. Skipping the words is the only
    correct arithmetic (there is nothing to add), and the note row above
    already says how many rows were skipped and why — so the footer cannot be
    read as a complete total without also reading the reason it is not.
    """
    out = {}
    for key in rows[0].keys():
        if key in columns:
            nums = [r[key] for r in rows
                    if isinstance(r.get(key), (int, float))
                    and not isinstance(r.get(key), bool)]
            if nums:
                out[key] = money(sum(nums))
            else:
                # Not a number in the whole column. The footer repeats THE
                # COLUMN'S OWN WORD rather than a generic one — "not recorded"
                # under a cost column, "not attributable" under turnover —
                # because a footer that gives a different reason from every
                # row above it reads as a second, unexplained failure.
                words = {r[key] for r in rows if isinstance(r.get(key), str)}
                out[key] = words.pop() if len(words) == 1 else C.NOT_ATTRIBUTABLE
        else:
            out[key] = label if key == PERSON else BLANK
    return out


def _note_rows(rows: list, spread: dict, label_column: str) -> list:
    """The three sentences that go IN the table.

    Not a footnote and not a line in a description nobody prints. A reader who
    totals the turnover column and compares it to the firm's own turnover must
    be told, on the page, how much of the book had no salesperson on it —
    otherwise they conclude the report is broken, or that the difference is
    somebody's unrecorded sales.
    """
    keys = list(rows[0].keys()) if rows else []

    def as_row(text: str) -> dict:
        return {k: (text if k == label_column else BLANK) for k in keys}

    notes = [C.attribution_note(spread.get("docs"), spread.get("docs_attributed"),
                                spread.get("value"), spread.get("value_attributed"))]
    cost = C.cost_note(spread.get("lines"), spread.get("lines_costed"))
    if cost:
        notes.append(cost)
    unlinked = int(spread.get("employees_unlinked") or 0)
    if unlinked:
        notes.append(
            f"{unlinked:,} employee record(s) in HR are not linked to a login "
            f"account, so they cannot appear above and no revenue can reach "
            f"them however it is attributed. A commission scheme can still be "
            f"recorded against them; it will read '{NO_LOGIN}' until somebody "
            f"who knows which login belongs to which employee fills it in. "
            f"Matching on name or email is a guess and this product will not "
            f"make it.")
    notes.append(C.gross_profit_is_contribution())
    return [as_row(n) for n in notes]


def _figures_for(scheme, own_f, dept_f):
    """The figures a scheme is measured on — the person's, or the
    department's.

    Resolved HERE and nowhere else, so a scheme's scope is read exactly once
    per row. `commission_due` cannot tell which it was handed, and handing it
    the wrong figures is not an error anything can detect.
    """
    return dept_f if scheme.measures_department else own_f


def _commission_cells(schemes, own_f, dept_f, period_end: date,
                      period_start=None) -> tuple:
    """(Commission cell, Status cell) for one person's arrangements.

    ONE SCHEME behaves exactly as it did before this file learned about
    ladders: the window's figures go through the ladder and the row says
    whether the settlement period has finished.

    MORE THAN ONE is the case migration 190 introduced, and it needs a rule,
    because the figures on this row were measured over the REPORT'S window and
    every scheme settles over ITS OWN period. Applying a monthly scheme and an
    annual scheme to the same number would pay twice on one month's turnover.
    So only the schemes whose settlement period IS this window are added up,
    and the rest are named in the HR columns and left uncomputed — a person on
    a monthly and an annual scheme, on a report run for a month, sees their
    monthly commission and is told the annual one settles elsewhere.

    When NONE of them settles over this window, the cell prints a REASON. Not
    a zero: zero would say the ladders were reached and paid nothing, and the
    truth is that this window is not the period any of them is measured over.
    """
    live = tuple(s for s in schemes if s.eligible)
    if len(schemes) <= 1:
        one = schemes[0] if schemes else None
        due = C.commission_due(one, _figures_for(one, own_f, dept_f)
                               if one is not None else own_f)
        status = (BLANK if one is None or not one.eligible or not due.computable
                  else ("Due" if C.period_is_complete(one.period, period_end,
                                                      period_end)
                        else "Period not finished — forecast"))
        return C.cell(due.amount, due.reason), status

    if not live:
        due = C.commission_due(schemes[0], own_f)
        return C.cell(due.amount, due.reason), BLANK

    settling = [s for s in live
                if period_start is not None
                and C.period_bounds(s.period, period_end) == (period_start,
                                                              period_end)]
    if not settling:
        periods = ", ".join(sorted({s.period for s in live}))
        return (f"{len(live)} schemes, settling {periods} — none over this "
                f"window"), BLANK

    amounts = [C.commission_due(s, _figures_for(s, own_f, dept_f))
               for s in settling]
    payable = [a.amount for a in amounts if a.amount is not None]
    if not payable:
        # Every settling scheme was uncomputable. Repeat the FIRST one's
        # reason rather than inventing a generic one — "department not set"
        # and "not attributable" send a reader to different places.
        return C.cell(None, amounts[0].reason), BLANK
    total = C.money(sum(payable, C.to_decimal(0)))

    others = [s for s in live if s not in settling]
    status = "Due" if all(
        C.period_is_complete(s.period, period_end, period_end)
        for s in settling) else "Period not finished — forecast"
    if len(payable) < len(amounts):
        # One of two schemes paid and the other could not be computed. Saying
        # so is the difference between a partial figure and a wrong one.
        missing = next(a.reason for a in amounts if a.amount is None)
        status += f" · one scheme not computed ({missing})"
    if others:
        status += (" · " + ", ".join(sorted({s.period for s in others}))
                   + " settles separately")
    return float(total), status


def build_pnl_rows(people: list, spread: dict, period_end: date,
                   dropped: int = 0, period_start=None) -> list:
    """The table. Pure — the whole reconciliation is testable without a
    database, which is the entire value of this document."""
    if not people:
        # `render_report_html` prints "No rows for this period" for an empty
        # list, which is the honest page. A lone row of zeros reads as "these
        # people sold nothing", which is a different and much worse sentence.
        return []

    # THE DISTINCTION, drawn once for the whole page. If the period's book
    # names no salesperson anywhere, nobody's turnover is computable and every
    # row says so. If some documents ARE attributed, a person with none of
    # them genuinely sold nothing and 0.00 is a true, checkable answer.
    any_attribution = int(spread.get("docs_attributed") or 0) > 0
    any_cost = int(spread.get("lines_costed") or 0) > 0

    rows = []
    for p in people:
        schemes = _schemes_of(p, period_end)

        if not any_attribution:
            turnover, t_reason = None, C.NOT_ATTRIBUTABLE
        else:
            turnover, t_reason = (p.get("turnover") or 0.0), ""

        # Cost is judged PER PERSON, not per org. The org-wide `any_cost`
        # flag is not enough: once one line anywhere carries a cost, a person
        # NONE of whose lines carry one would otherwise get `None or 0.0` and
        # print ₹0.00 cost — a claim of 100% gross margin against their name,
        # produced by the exact reflex this whole file exists to refuse.
        # `lines_costed` comes back per person from the `costs` CTE, and a
        # person absent from that CTE has none.
        if not any_cost or turnover is None or int(p.get("lines_costed") or 0) == 0:
            cost, c_reason = None, C.NOT_RECORDED
        else:
            cost, c_reason = (p.get("cost") or 0.0), ""

        f = C.figures(turnover, cost, turnover_reason=t_reason,
                      cost_reason=c_reason)

        # ── the DEPARTMENT's figures, for a scheme scoped to one ────────────
        #
        # Teams ARE departments (owner, 2026-08-21). A person with no
        # department gets DEPARTMENT_NOT_SET and NEVER a zero: paying a team
        # leader nothing because nobody filled in a column is the failure this
        # page exists to refuse, and 11 of 98 live employees have no
        # department.
        department = (p.get("department") or "").strip()
        if not department:
            dept_f = C.figures(None, None,
                               turnover_reason=C.DEPARTMENT_NOT_SET,
                               cost_reason=C.DEPARTMENT_NOT_SET)
        elif not any_attribution:
            dept_f = C.figures(None, None,
                               turnover_reason=C.NOT_ATTRIBUTABLE,
                               cost_reason=C.NOT_RECORDED)
        else:
            dept_cost = (p.get("dept_cost")
                         if int(p.get("dept_lines_costed") or 0) else None)
            dept_f = C.figures(p.get("dept_turnover") or 0.0, dept_cost,
                               cost_reason=C.NOT_RECORDED)

        # An employee row that exists but carries no login is a different
        # absence from no scheme at all, and the HR columns say which.
        threshold_reason = "" if p.get("has_employee") else NO_LOGIN

        row = {PERSON: str(p.get("person") or UNRECORDED_PERSON)}
        row["Turnover"] = C.cell(f.turnover, f.turnover_reason,
                                 blank=C.NOT_ATTRIBUTABLE)
        row["Cost"] = C.cell(f.cost, f.cost_reason)
        row["Gross profit"] = C.cell(f.gross_profit, f.gross_profit_reason)
        row["Margin %"] = C.cell(f.margin_pct, f.margin_reason)
        row.update(_scheme_cells(schemes, threshold_reason))
        # Whether the settlement period each scheme runs on has actually
        # finished, and — where a person holds more than one — which of them
        # this window is even measuring. A commission over a period still
        # running is a forecast, and the page says which it is rather than
        # leaving the reader to assume the figure is due.
        row["Commission"], row["Status"] = _commission_cells(
            schemes, f, dept_f, period_end, period_start)
        rows.append(row)

    out = [*rows, _money_footer(rows, PNL_MONEY, ALL_PEOPLE)]
    if dropped:
        out.append(overflow_row(out, PERSON, dropped))
    out.extend(_note_rows(out, spread, PERSON))
    return out


@report_def(
    key=PNL_KEY,
    module="core",
    # ganit for the invoices, vikray because migration 184 puts the same
    # attribution on orders and this section's subject is that column's
    # meaning, manav for the employee and the commission scheme. ALL of them
    # are required: a caller without a finance grant must not be offered the
    # firm's turnover per head because they hold HR, and a caller without HR
    # must not be offered anybody's commission rate because they hold finance.
    # Declaring fewer would be an entitlement bypass wearing a report's
    # clothes.
    reads=frozenset({"core", "ganit", "vikray", "manav"}),
    label="Consultant figures and commission",
    grain="flow",
    sensitivity="financial",
    description=(
        "One line per person for the period, ALPHABETICAL BY NAME — there is "
        "no rank and nothing is sorted by a figure. Turnover, cost, gross "
        "profit, margin, and the commission the person's recorded schemes "
        "produce from them, with the rate or LADDER, the threshold and the "
        "settlement period each was computed on. A person may hold more than "
        "one arrangement at once — a monthly scheme and an annual scheme both "
        "pay — and every one of them is listed; only those whose settlement "
        "period IS this window are added into the Commission column, because "
        "a monthly and an annual scheme applied to the same figures would pay "
        "twice on one month's turnover. Where a scheme sets bands (3% from "
        "₹1L, 4% from ₹5L, 7.5% from ₹10L) the column says how the firm "
        "chose to combine them: each band on its own slice, or the top band "
        "reached on the whole amount — nearly double the money on the same "
        "figures, so it is never inferred. BONUSES DO NOT APPEAR HERE: a "
        "bonus is discretionary, derived from nothing on this page, and shows "
        "on the payslip. A cell that cannot be computed prints WHY — 'not "
        "attributable', 'not recorded', 'no scheme recorded', 'not on "
        "commission' — and never zero, because zero is a claim that somebody "
        "sold nothing. TODAY THAT IS EVERY CELL: no invoice in this database "
        "has ever recorded who sold it (693 of 788 were created by one "
        "account) and no line has ever recorded a cost, so turnover is not "
        "attributable to any person and gross profit is not computable at "
        "all. Gross profit is a CONTRIBUTION figure — billed less the direct "
        "cost of what was billed — and not a profit and loss account: this "
        "product keeps no ledger, so no overhead, salary or tax is deducted "
        "anywhere. Turnover is taxable value (subtotal less discount) on "
        "issued invoices, credit notes negated, drafts, cancellations, "
        "proformas and quotations excluded — the same four guards the sales "
        "register applies, so the two pages agree. Orders are NOT counted: an "
        "order is a commitment and an invoice is what was billed. Commission "
        "shown is a computed figure, never an instruction to pay."
    ),
)
async def consultant_pnl(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, PNL_KEY)
    args = (str(org_id), win.start, win.end, list(OFFER_TYPES))
    # ROW_CAP + 1, so the overflow is known without a second COUNT — the
    # register house pattern. The largest org has 28 members today, so this is
    # a runaway guard and not a working limit.
    people = await pool.fetch(PNL_SQL, *args, UNRECORDED_PERSON, ROW_CAP + 1)
    spread = await pool.fetch(PNL_SPREAD_SQL, *args)
    people, dropped = capped([dict(r) for r in people])
    # `win.start` is handed through so the page can tell WHICH of a person's
    # arrangements this window actually settles. Without it a monthly and an
    # annual scheme would be added together over one month's figures.
    return build_pnl_rows(people, dict(spread[0]) if spread else {}, win.end,
                          dropped, period_start=win.start)


# ══════════════════════════════════════════════════════════════════════════
# B · core.period_figures
# ══════════════════════════════════════════════════════════════════════════

#: The periods a consultancy reads its own figures over, anchored on the END
#: of the window the caller asked for.
#:
#: The window is honoured rather than ignored — `grain='flow'` is a contract
#: and a section that read the clock instead would answer a question nobody
#: asked. The anchor is `window.end` because "month to date" on a report run
#: for a past period must mean that period's month, not this one.
#:
#: The YEAR here is the INDIAN FINANCIAL YEAR, 1 April to 31 March. A calendar
#: year-to-date would restate every figure on 1 January, three months out of
#: step with the accounts, the TDS statements and every target the firm sets.
#: The quarter is an FY quarter for the same reason.
PERIOD_ROWS = (
    ("Selected period", None),
    ("Week to date (from Monday)", "week"),
    ("Month to date", "month"),
    ("Quarter to date (financial)", "quarter"),
    ("Year to date (financial)", "ytd"),
    ("Last full financial year", "last_fy"),
)

#: The org's own figures over ONE range. Called once per period row rather
#: than as one query with six CASE ladders: six small indexed range scans are
#: cheaper to read and impossible to get subtly wrong, and the ranges overlap
#: (month-to-date sits inside quarter-to-date sits inside the FY), which a
#: single-pass FILTER would have to encode six times anyway.
FIGURES_SQL = (
    "WITH doc AS ("
    "  SELECT i.id, i.line_items, "
    "         CASE WHEN i.invoice_type = 'credit_note' "
    "              THEN -(COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "              ELSE  (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0)) "
    "         END AS taxable "
    "    FROM public.ganit_invoices i "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date"
    ") "
    "SELECT (SELECT COUNT(*) FROM doc)::int AS docs, "
    "       (SELECT COALESCE(SUM(taxable), 0) FROM doc)::float AS turnover, "
    "       (SELECT COUNT(*) FROM doc, jsonb_array_elements(doc.line_items) li)::int "
    "           AS lines, "
    "       (SELECT COUNT(*) FROM doc, jsonb_array_elements(doc.line_items) li "
    "         WHERE li ? 'cost_price' "
    "           AND jsonb_typeof(li->'cost_price') = 'number')::int AS lines_costed, "
    "       (SELECT SUM((li->>'cost_price')::numeric * " + QTY_SQL + ") "
    "          FROM doc, jsonb_array_elements(doc.line_items) li "
    "         WHERE li ? 'cost_price' "
    "           AND jsonb_typeof(li->'cost_price') = 'number')::float AS cost"
)


def period_range(kind, anchor: date, selected: tuple) -> tuple:
    """(start, end) for one row of the page. Every branch takes the anchor
    explicitly; none of them reads the clock."""
    if kind is None:
        return selected
    if kind == "week":
        return C.week_to_date(anchor)
    if kind == "month":
        return C.month_to_date(anchor)
    if kind == "quarter":
        return C.quarter_to_date(anchor)
    if kind == "ytd":
        return C.year_to_date(anchor)
    if kind == "last_fy":
        return C.last_financial_year(anchor)
    raise ValueError(f"unknown period kind {kind!r}")


def build_figures_rows(measured: list, anchor: date) -> list:
    """The table: one row per period, each carrying the dates it covers.

    The dates are PRINTED. A row headed "Quarter to date" with no range beside
    it is unreadable three months later and unverifiable at any time — and the
    quarter here is a financial quarter, which is not what half the readers of
    the phrase will assume.
    """
    rows = []
    for label, start, end, m in measured:
        docs = int(m.get("docs") or 0)
        lines_costed = int(m.get("lines_costed") or 0)

        turnover = m.get("turnover") if docs else None
        t_reason = "" if docs else "no documents issued"
        cost = m.get("cost") if lines_costed else None
        f = C.figures(turnover, cost, turnover_reason=t_reason,
                      cost_reason=C.NOT_RECORDED)

        rows.append({
            PERIOD: label,
            "From": start,
            "To": end,
            "Documents": docs,
            "Turnover": C.cell(f.turnover, f.turnover_reason),
            "Cost": C.cell(f.cost, f.cost_reason),
            "Gross profit": C.cell(f.gross_profit, f.gross_profit_reason),
            "Margin %": C.cell(f.margin_pct, f.margin_reason),
        })
    if not rows:
        return []

    keys = list(rows[0].keys())

    def note(text: str) -> dict:
        return {k: (text if k == PERIOD else BLANK) for k in keys}

    # NO FOOTER. The rows OVERLAP — month-to-date sits inside quarter-to-date
    # sits inside the financial year — so a column of them does not add up to
    # anything, and a "Total" line under them would be a number with no
    # meaning that somebody would nonetheless quote.
    rows.append(note(
        f"These rows OVERLAP and must not be added together: month to date "
        f"sits inside quarter to date, which sits inside the financial year. "
        f"Every period is anchored on {anchor.isoformat()}, the last day of "
        f"the range this report was run for — not on today — so re-running "
        f"the same report gives the same figures. Weeks start on Monday. "
        f"Quarters and the year are FINANCIAL (1 April to 31 March, "
        f"FY {C.financial_year_label(anchor)}), never calendar."))
    rows.append(note(C.gross_profit_is_contribution()))
    return rows


@report_def(
    key=FIGURES_KEY,
    module="core",
    # No manav: this section names no person and reads no employee row, so
    # requiring an HR grant would withhold the firm's own turnover for a
    # reason that has nothing to do with the caller's entitlement.
    reads=frozenset({"core", "ganit", "vikray"}),
    label="Period figures",
    grain="flow",
    sensitivity="financial",
    description=(
        "The firm's OWN turnover, cost, gross profit and margin over six "
        "ranges at once — the selected period, week to date, month to date, "
        "quarter to date, financial year to date, and the last full financial "
        "year — each printing the dates it actually covers. Every range is "
        "anchored on the LAST DAY of the period the report was run for, never "
        "on today, so the same report re-run gives the same figures. Weeks "
        "start Monday; quarters and years are FINANCIAL (1 April to 31 "
        "March), never calendar, because a calendar year-to-date would "
        "restate the year on 1 January three months out of step with the "
        "accounts. THE ROWS OVERLAP and must never be added together. This is "
        "NOT a profit and loss account: this product keeps no double-entry "
        "ledger, no journal and no chart of accounts, so gross profit here is "
        "a CONTRIBUTION figure — billed less the direct cost of what was "
        "billed — with no overhead, salary, premises or tax deducted "
        "anywhere. Cost is read per line from the line's own recorded cost; "
        "no line in this database carries one today, so cost, gross profit "
        "and margin read 'not recorded' rather than zero, because a zero cost "
        "would claim a 100 percent gross margin."
    ),
)
async def period_figures(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, FIGURES_KEY)
    anchor = win.end
    measured = []
    for label, kind in PERIOD_ROWS:
        start, end = period_range(kind, anchor, (win.start, win.end))
        rows = await pool.fetch(FIGURES_SQL, str(org_id), start, end,
                                list(OFFER_TYPES))
        measured.append((label, start, end, dict(rows[0]) if rows else {}))
    return build_figures_rows(measured, anchor)
