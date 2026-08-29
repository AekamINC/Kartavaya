"""Who did what this period — the Finance and CRM registers, by MEMBER.

The owner, 2026-08-29: "finance, crm report needs members name who did what
this weeks and how much total gp, deal etc etc."

Two sections, one per module, because entitlement falls out of the declaration
(`ReportDef.reads`) and a single section spanning both would need the ganit
grant and the graha grant to answer the same question — which is how a report
becomes the way past a grant.

────────────────────────────────────────────────────────────────────────────
THE THREE THINGS THAT WOULD MAKE THIS DOCUMENT LIE, AND WHAT IS DONE ABOUT
EACH. Every number below was measured read-only against the live database on
2026-08-29, Unicode Group (`fae87907-…`).
────────────────────────────────────────────────────────────────────────────

1. UNATTRIBUTED WORK IS THE MAJORITY, AND IT GETS ITS OWN NAMED LINE
   ────────────────────────────────────────────────────────────────
   `graha_deals.assigned_to` only became settable from a screen on 2026-08-29 —
   the API always accepted it and no form ever sent it. Live today:

       deals with an owner ..............  5 of 33
       CRM value on owned deals ......... ₹15,00,000
       CRM value UNASSIGNED ............. ₹3,42,30,000   (28 deals)

       invoices with a salesperson ...... 12 of 65, and all 12 are ONE person
       turnover on those 12 ............. ₹2,50,136
       turnover UNASSIGNED .............. ₹37,33,908

   So 96% of the pipeline and 94% of the turnover belong to nobody. A report
   that dropped those rows would show a firm doing ₹15 lakh of business.

   ⚠ AND THE UNASSIGNED BUCKET MUST NOT BE CALLED "Unnamed member".
   `services/audit_actors.display_name` ends its ladder at `'Unnamed member'`,
   which means "a person is recorded and their account has no name". A LEFT
   JOIN on a NULL owner falls down the same ladder and lands on the same words
   — so the first version of this query reported 39 documents and ₹37 lakh
   against a phantom person called Unnamed member. Those are two different
   absences and `services/audit_actors` says so in its own docstring about
   `has_creator`: "nobody did this" and "we can no longer say who" are not the
   same claim. `UNASSIGNED` is therefore decided in SQL, before the ladder, and
   `tests/test_member_activity.py` pins that they never collapse.

2. GROSS PROFIT IS KNOWN ON 2.49% OF TURNOVER, AND THE DOCUMENT SAYS SO
   ───────────────────────────────────────────────────────────────────
   `cost_price` lives on each element of `ganit_invoices.line_items` (jsonb),
   beside `rate`, `quantity`, `line_total` and `discount_pct`. Measured over
   Unicode's 51 issued documents:

       documents where EVERY line carries a cost ......   8
       documents where SOME lines carry a cost ........  14
       documents with no cost anywhere ................  29
       taxable turnover, all documents ................ ₹33,77,318
       turnover on lines that carry a cost ............ ₹84,000
       gross profit on those lines .................... ₹36,000
       → COST IS KNOWN ON 2.49% OF TURNOVER

   ⚠ THE SHAPE IS WORSE THAN THE HEADLINE COUNT SUGGESTS, and this is the part
   that would have produced a wrong figure. The costed lines are the SMALL
   ones. A typical invoice here is two lines: a product line of ₹2,500 that
   carries a cost, and a service line of ₹236,000 that does not. So "22 of 65
   invoices carry a cost price" is true at the line level and reads, at the
   level anybody would read it, as a third of the book — when it is a fortieth.

   A single confident "Gross profit: ₹36,000" beside a turnover of ₹33.77 lakh
   is the seventh wrong figure this page would have printed. So GP is NEVER
   printed alone: `Revenue with cost` sits in the column beside it, both are
   money columns that the footer sums, and a stated line at the foot of the
   table gives the coverage as a percentage in words. A reader who wants the
   margin can compute it and will see immediately what it is a margin ON.

   Nothing is estimated and no line is imputed a cost. An uncosted line
   contributes 0 to `Gross profit` AND 0 to `Revenue with cost`, so the ratio
   the two columns form is a true ratio over the subset that is known.

3. A NAME LADDER MUST NEVER END AT AN EMAIL ADDRESS — INCLUDING WHEN THE
   NAME *IS* ONE
   ────────────────────────────────────────────────────────────────────
   The owner's ruling (2026-08-23), held by
   `tests/test_the_name_ladder_never_reaches_email.py`: the ladder must never
   end at an email address. That test bans the three-rung COALESCE whose last
   rung is the address column, and this file does not write one.

   ⚠ THE PATTERN IS DESCRIBED HERE AND NOT QUOTED, DELIBERATELY. Writing it out
   makes THIS FILE match the ratchet's regex, and the ratchet fails — which is
   exactly what happened on the first run of this docstring. Only
   `services/audit_actors.py` is exempt, because that module IS the rule and its
   prose has to name what it prevents. Widening `PROSE_EXEMPT` to admit a second
   file for the convenience of a comment is how an exemption list becomes the
   hole; the comment changes instead.

   ⚠ But there is a second door it cannot see. One Unicode member's
   `full_name` is literally `aekaminc1+org@gmail.com` — an address STORED as a
   person's name. No ladder catches that, because the ladder is working
   correctly: it is returning `full_name`. Measured 2026-08-29: that account
   owns none of the 12 attributed invoices and none of the 5 owned deals, so
   this is LATENT — but a report is precisely where an address leaks, it is
   printed on a page the firm hands to people, and "Aekam must not see client
   emails" is a standing decision.

   So `member_label()` refuses an @ in the resolved name and prints
   `'Unnamed member'` instead. That HIDES who did the work, which is a real
   cost and is the lesser one: the repair is to give that account a name, and
   the report surfacing a blank is what makes somebody do it.

────────────────────────────────────────────────────────────────────────────

WHAT THESE SECTIONS ARE NOT. They are not a commission statement — commission
is `services/report_defs/commission_reports.py`, which reads the band ladder —
and they are not the sales or receipts register. They answer one question: in
this period, per person, how much.

AGGREGATED IN SQL, NEVER BY SUMMING A LIST. `GROUP BY` in the statement, not
`sum()` over a fetched page: this product's list endpoints cap at 200 rows, and
summing one gave ₹1.06 Cr against a true ₹3.58 Cr. There is no `LIMIT` on these
queries because the row count is bounded by the org's member count, not by its
document count — an org with 5,000 invoices and 18 members returns 19 rows.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import BLANK, money, window_or_raise

#: The bucket for work no member owns. NOT `audit_actors.UNNAMED` — see note 1.
#: These are two different absences and collapsing them attributes ₹3.42 crore
#: of somebody's pipeline to a person who does not exist.
UNASSIGNED = "Unassigned"

#: What `audit_actors.display_name` ends its ladder at. Imported by VALUE from
#: that module rather than retyped, so a change there cannot leave this file
#: printing a word the rest of the product has stopped using.
from services.audit_actors import UNNAMED, display_name  # noqa: E402

#: Where the footer's label sits — the member column, which is the only
#: non-numeric column here.
LABEL_COLUMN = "Member"

FINANCE_KEY = "ganit.member_activity"
CRM_KEY = "graha.member_activity"


def member_label(name, *, unassigned: bool) -> str:
    """The name printed on the page — never an id, never an address.

    `unassigned` comes from SQL (`salesperson_id IS NULL`), not from inspecting
    the name, because the resolved name for an unassigned row is indistinguish-
    able from the resolved name for a member whose account has no name.

    ⚠ The `@` refusal is not paranoia about a ladder this file does not write.
    It is about a `full_name` column that HOLDS an address on a live account
    (`aekaminc1+org@gmail.com`, Unicode Group, measured 2026-08-29). The ladder
    returns it correctly and the page would print it, which is the same failure
    with the fault one layer down.
    """
    if unassigned:
        return UNASSIGNED
    text = str(name or "").strip()
    if not text or "@" in text:
        return UNNAMED
    return text


def _coverage_row(columns: list, covered: float, total: float) -> dict:
    """The line that ADMITS what the gross-profit column covers, in the table.

    Inside the table rather than in a footnote, for `_shared.overflow_row`'s
    reason: a reader who cross-checks a figure against the firm's real turnover
    and finds it short distrusts the document rather than the column. Say it
    where they are already looking.
    """
    pct = (100.0 * covered / total) if total else 0.0
    if total <= 0:
        text = ("No turnover in this period, so there is no gross profit to "
                "report.")
    elif covered <= 0:
        text = ("Gross profit is BLANK because no line in this period carries "
                "a cost price. Add cost prices on invoice lines and it fills "
                "in.")
    else:
        text = (f"Gross profit covers {money(covered):,.2f} of "
                f"{money(total):,.2f} — {pct:.1f}% of the period's taxable "
                f"value. Lines with no cost price contribute nothing to either "
                f"column, so the margin these two form is a true margin over "
                f"that {pct:.1f}%, not over the book.")
    return {c: (text if c == LABEL_COLUMN else BLANK) for c in columns}


def _total_row(rows: list, columns: list, money_columns: tuple,
               count_columns: tuple) -> dict:
    """The footer, summed from the ROUNDED cells above it.

    `_shared.total_row` is not reused here and the difference is deliberate: it
    blanks every non-money column, which in a register is right (a date column
    holding the word "Total" parses as nothing) and here would blank the COUNTS
    — leaving a footer that totals the money and not the documents, which is
    the one row a reader checks first.
    """
    out: dict = {}
    for c in columns:
        if c in money_columns:
            out[c] = money(sum(r.get(c) or 0 for r in rows))
        elif c in count_columns:
            out[c] = sum(int(r.get(c) or 0) for r in rows)
        else:
            out[c] = "All members" if c == LABEL_COLUMN else BLANK
    return out


# ── Finance ─────────────────────────────────────────────────────────────────

FINANCE_COLUMNS = [LABEL_COLUMN, "Documents", "Taxable value", "Total",
                   "Paid to date", "Revenue with cost", "Gross profit"]
FINANCE_MONEY = ("Taxable value", "Total", "Paid to date",
                 "Revenue with cost", "Gross profit")
FINANCE_COUNTS = ("Documents",)

#: One row per salesperson. The four register guards are `sales_register`'s,
#: verbatim and for its stated reasons — soft delete, `doc_status <> 'draft'`
#: (never `= 'final'`: the live values are final/viewed/sent/draft and 'final'
#: is the DEFAULT, so an equality test silently drops every issued document
#: sitting at 'viewed' or 'sent'), not cancelled on either of the two columns
#: that record it, and offers excluded. A credit note is NEGATED, not dropped
#: and not added, so this document's totals and `ganit.invoiced` move together.
#:
#: ⚠ `cost_price` and `line_total` are matched against a NUMERIC REGEX before
#: being cast. They are free-form jsonb text: the live data holds `""` on every
#: uncosted line, and `''::numeric` raises `invalid input syntax for type
#: numeric` — which, inside a report a cron mails, is a 500 nobody sees. The
#: regex is the guard, and it also means a line carrying "N/A" is treated as
#: uncosted rather than failing the whole report.
#:
#: Every `$n` is CAST. PgBouncer turns an untyped parse error into an instant
#: 500 and this repo has shipped six of them.
FINANCE_SQL = (
    "WITH doc AS ("
    "  SELECT i.salesperson_id AS actor, "
    "         CASE WHEN i.invoice_type = 'credit_note' THEN -1.0 ELSE 1.0 END AS sign, "
    "         (COALESCE(i.subtotal, 0) - COALESCE(i.discount, 0))::float AS taxable, "
    "         COALESCE(i.total, 0)::float AS total, "
    "         COALESCE(i.amount_paid, 0)::float AS paid, "
    "         (SELECT COALESCE(SUM((e->>'line_total')::numeric), 0) "
    "            FROM jsonb_array_elements(COALESCE(i.line_items, '[]'::jsonb)) e "
    "           WHERE (e->>'cost_price') ~ $5::text "
    "             AND (e->>'line_total') ~ $5::text)::float AS costed_revenue, "
    "         (SELECT COALESCE(SUM((e->>'line_total')::numeric "
    "                              - COALESCE((e->>'quantity')::numeric, 0) "
    "                                * (e->>'cost_price')::numeric), 0) "
    "            FROM jsonb_array_elements(COALESCE(i.line_items, '[]'::jsonb)) e "
    "           WHERE (e->>'cost_price') ~ $5::text "
    "             AND (e->>'line_total') ~ $5::text "
    "             AND (e->>'quantity') ~ $5::text)::float AS gp "
    "    FROM staging.ganit_invoices i "
    "   WHERE i.org_id = $1::uuid "
    "     AND i.is_active = TRUE "
    "     AND i.doc_status <> 'draft' "
    "     AND i.cancelled_at IS NULL "
    "     AND i.payment_status <> 'cancelled' "
    "     AND NOT (i.invoice_type = ANY($4::text[])) "
    "     AND i.invoice_date BETWEEN $2::date AND $3::date) "
    "SELECT (d.actor IS NULL) AS unassigned, "
    # `public.users` is SCHEMA-QUALIFIED. `users` exists in two schemas — the
    # product's `public` and Supabase's own `auth`, which also carries `email`
    # — and `db.py` sets `search_path TO staging, public`, so an unqualified
    # name resolves correctly today and would return WRONG ROWS, not an error,
    # if that ever changed. Migration 142 exists because that happened.
    "       " + display_name("u") + " AS member, "
    "       COUNT(*) AS documents, "
    "       SUM(d.sign * d.taxable) AS taxable_value, "
    "       SUM(d.sign * d.total) AS total, "
    "       SUM(d.sign * d.paid) AS paid, "
    "       SUM(d.sign * d.costed_revenue) AS costed_revenue, "
    "       SUM(d.sign * d.gp) AS gross_profit "
    "  FROM doc d "
    # LEFT, and it must stay LEFT: an INNER join drops every document whose
    # salesperson has since been deleted AND every document with no salesperson
    # — which here is 39 of 51, i.e. the report.
    "  LEFT JOIN public.users u ON u.user_id = d.actor "
    " GROUP BY 1, 2 "
    # Unassigned LAST, then biggest first. A reader reads people, then the
    # remainder; putting the remainder first buries the point of the document.
    " ORDER BY 1, 5 DESC NULLS LAST, 2 "
)

#: A JSON string that is a plain decimal number. Bound as `$5` rather than
#: inlined so nothing here can be read as string-built SQL — the value is a
#: constant, and binding it costs one parameter and removes the question.
#:
#: ⚠ It is `$5` with no gap before it. Postgres infers a type for every
#: $1..$N up to the highest one REFERENCED, so an unreferenced $5 sitting
#: between $4 and a $6 raises "could not determine data type of parameter $5"
#: at query time — inside a report a cron mails, which is where this repo
#: keeps finding its untyped-parameter 500s.
_NUMERIC_TEXT = r"^-?[0-9]+(\.[0-9]+)?$"

#: The offer types `sales_register` excludes, for its reason: a proforma and a
#: quotation are offers, nothing was sold, and counting them credits a person
#: with turnover the firm may never have.
_OFFER_TYPES = ("proforma", "quotation")


def build_finance_rows(records: list) -> list:
    """The table. Pure — the footer, the labelling and the coverage sentence
    are all testable without a database, which is the point: the coverage line
    is the half most likely to be wrong and the half a live query is worst at
    exercising, because it needs a book with no cost prices in it."""
    rows = []
    for r in records:
        rows.append({
            LABEL_COLUMN: member_label(r.get("member"),
                                       unassigned=bool(r.get("unassigned"))),
            "Documents": int(r.get("documents") or 0),
            "Taxable value": money(r.get("taxable_value")),
            "Total": money(r.get("total")),
            "Paid to date": money(r.get("paid")),
            "Revenue with cost": money(r.get("costed_revenue")),
            "Gross profit": money(r.get("gross_profit")),
        })
    if not rows:
        # `render_report_html` prints "No rows for this period", which is the
        # honest empty page. A lone row of zeros reads as "we looked and nothing
        # happened", when it may equally mean nothing was looked at —
        # `receivables_ageing`'s rule, kept.
        return []
    out = [*rows, _total_row(rows, FINANCE_COLUMNS, FINANCE_MONEY,
                             FINANCE_COUNTS)]
    out.append(_coverage_row(
        FINANCE_COLUMNS,
        sum(r["Revenue with cost"] for r in rows),
        sum(r["Taxable value"] for r in rows)))
    return out


@report_def(
    key=FINANCE_KEY,
    module="ganit",
    label="Finance by member",
    grain="flow",
    # ganit ALONE. The member's NAME comes from `public.users`, which is not a
    # module and is what every screen in the product already resolves an actor
    # through. Reading one more CRM or sales field — a client name, an order,
    # a territory — means adding that module here IN THE SAME COMMIT, or the
    # join is an entitlement bypass wearing a report's clothes.
    reads=frozenset({"ganit"}),
    sensitivity="financial",
    description=(
        "Every document issued in the period, grouped by the member recorded "
        "as its salesperson, with the taxable value, the document total, what "
        "has been paid against it to date, and gross profit. Credit notes "
        "carry a negative sign; drafts, cancellations, proformas and "
        "quotations are excluded. Documents with no salesperson are shown on "
        "an 'Unassigned' line rather than dropped or attributed to anybody. "
        "GROSS PROFIT IS PARTIAL BY CONSTRUCTION: it is computed only over "
        "invoice lines that carry a cost price, 'Revenue with cost' is the "
        "turnover it was computed over, and the last line of the table states "
        "the coverage as a percentage. 'Paid to date' is a balance as at "
        "today over the period's documents — it is not money received in the "
        "period, which is the receipts register."),
)
async def finance_by_member(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, FINANCE_KEY)
    rows = await pool.fetch(FINANCE_SQL, str(org_id), win.start, win.end,
                            list(_OFFER_TYPES), _NUMERIC_TEXT)
    return build_finance_rows([dict(r) for r in rows])


# ── CRM ─────────────────────────────────────────────────────────────────────

CRM_COLUMNS = [LABEL_COLUMN, "Deals created", "Deals won", "Deals lost",
               "Value created", "Value won"]
CRM_MONEY = ("Value created", "Value won")
CRM_COUNTS = ("Deals created", "Deals won", "Deals lost")

#: One row per deal owner. EVERY COLUMN IS AN EVENT IN THE PERIOD — created in
#: it, won in it, lost in it — because `grain='flow'` promises a period and a
#: count of currently-open deals is a stock. Mixing the two is how "deals won"
#: comes to include a deal won last year, which is the shape of the six wrong
#: figures this page has printed before.
#:
#: A deal is counted once per event it had in the window, so a deal created AND
#: won inside the same week appears in both count columns. That is correct: the
#: columns answer different questions and neither is a subtotal of the other.
#: They are therefore NOT summed against each other anywhere.
CRM_SQL = (
    "SELECT (d.assigned_to IS NULL) AS unassigned, "
    "       " + display_name("u") + " AS member, "
    "       COUNT(*) FILTER (WHERE d.created_at::date BETWEEN $2::date AND $3::date) "
    "         AS deals_created, "
    "       COUNT(*) FILTER (WHERE d.won_at IS NOT NULL "
    "                          AND d.won_at::date BETWEEN $2::date AND $3::date) "
    "         AS deals_won, "
    "       COUNT(*) FILTER (WHERE d.lost_at IS NOT NULL "
    "                          AND d.lost_at::date BETWEEN $2::date AND $3::date) "
    "         AS deals_lost, "
    "       COALESCE(SUM(d.value) FILTER "
    "                (WHERE d.created_at::date BETWEEN $2::date AND $3::date), 0) "
    "         AS value_created, "
    "       COALESCE(SUM(d.value) FILTER "
    "                (WHERE d.won_at IS NOT NULL "
    "                   AND d.won_at::date BETWEEN $2::date AND $3::date), 0) "
    "         AS value_won "
    "  FROM staging.graha_deals d "
    "  LEFT JOIN public.users u ON u.user_id = d.assigned_to "
    " WHERE d.org_id = $1::uuid "
    "   AND d.is_active = TRUE "
    # `archived_at` is a second retirement column beside `is_active`, and an
    # archived deal is not this week's work. Both are checked because neither is
    # authoritative alone — `services/deal_archive.py` writes one of them.
    "   AND d.archived_at IS NULL "
    # The deal had to DO something in the window. Without this every deal the
    # org has ever held appears with three zero counts, and a person's row
    # reads as "did nothing" when the report simply covers a week.
    "   AND (d.created_at::date BETWEEN $2::date AND $3::date "
    "     OR d.won_at::date BETWEEN $2::date AND $3::date "
    "     OR d.lost_at::date BETWEEN $2::date AND $3::date) "
    " GROUP BY 1, 2 "
    " ORDER BY 1, 7 DESC NULLS LAST, 2 "
)


def build_crm_rows(records: list) -> list:
    """The table. Pure, for `build_finance_rows`' reason."""
    rows = []
    for r in records:
        rows.append({
            LABEL_COLUMN: member_label(r.get("member"),
                                       unassigned=bool(r.get("unassigned"))),
            "Deals created": int(r.get("deals_created") or 0),
            "Deals won": int(r.get("deals_won") or 0),
            "Deals lost": int(r.get("deals_lost") or 0),
            "Value created": money(r.get("value_created")),
            "Value won": money(r.get("value_won")),
        })
    if not rows:
        return []
    return [*rows, _total_row(rows, CRM_COLUMNS, CRM_MONEY, CRM_COUNTS)]


@report_def(
    key=CRM_KEY,
    module="graha",
    label="CRM by member",
    grain="flow",
    reads=frozenset({"graha"}),
    sensitivity="operational",
    description=(
        "Deals created, won and lost in the period, grouped by the member the "
        "deal is assigned to, with the value of each. Every column is an event "
        "inside the period, so a deal won last year is not counted as won this "
        "week; a deal created and won in the same period appears in both "
        "columns, which are not subtotals of each other. ⚠ MOST HISTORIC WORK "
        "IS UNATTRIBUTED and appears on the 'Unassigned' line: the owner field "
        "was only made settable from a screen on 2026-08-29, so deals created "
        "before then carry no owner. That line is shown rather than dropped — "
        "an unattributed total hidden from the page reads as a firm that did "
        "far less business than it did."),
)
async def crm_by_member(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, CRM_KEY)
    rows = await pool.fetch(CRM_SQL, str(org_id), win.start, win.end)
    return build_crm_rows([dict(r) for r in rows])
