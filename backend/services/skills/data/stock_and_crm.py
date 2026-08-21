"""
stock_and_crm — three CHECKS across Vikray and Graha: stock that cannot be
true, orders that cannot be filled, and engagements nobody has repriced.

All three are `check` on the marketplace shelf: each finds a problem in the
org's OWN records that a person then has to fix. None of them is a brief and
none produces a document. None generates an image, and none may ever be given
one — a picture on a stock exception report costs four cents a call and tells
the reader nothing the numbers do not.

Every one of them is read-only. They compute, they never correct: a negative
quantity is reported, never zeroed, because the write that made it negative is
the thing somebody needs to look at and setting it to zero destroys the
evidence.

── The one fact that shapes all three ────────────────────────────────────────

`staging.vikray_stock.quantity_on_hand` is a BALANCE, and
`staging.vikray_stock_moves` is a LEDGER, and on live data THEY DO NOT AGREE.
Probed read-only on 2026-08-20: on the seeded e2e org, 29 of 31 stock rows
carry a balance that differs from the sum of their own movements — one product
shows 269 on hand against a ledger summing to −16.

That is not a bug in one row, it is the shape of the data. `vikray_stock` is
upserted directly by `routers/vikray.py:_apply_stock_moves` AND by the seeding
that loaded these orgs, while the ledger only ever receives what went through
the endpoint. There is no opening-balance row anywhere, so a ledger that starts
at zero for a product whose stock was loaded straight onto the balance will
appear to go deeply negative on its very first issue.

So every finding below that is derived from the ledger carries the balance
beside it and an `implied_opening` — the balance minus the ledger's net — and
is graded:

    confirmed    the ledger is complete for this product (implied opening is
                 zero), so a negative running total has no innocent reading.
    unverified   the ledger is incomplete. The dip may be an artefact of stock
                 that was loaded without a movement. Worth a look, not a fact.

Grading rather than filtering, because both mistakes are bad: printing eleven
`unverified` products as if they were confirmed shortages turns the report into
noise, and hiding them means the day the ledger IS complete the check has
already trained its reader to ignore it.

── What is deliberately NOT here ────────────────────────────────────────────

A fourth stock check suggests itself and must not be built: "items with
movement but no valuation". This product cannot make a valuation claim.
`ganit_products.cost_price` is TODAY's cost — nullable, and live it is NULL for
all 106 active products across all three orgs — and `vikray_orders.line_items`
snapshots no cost at the moment of the order. There is therefore nothing from
which the value of a movement could be computed, then or now. What IS reported
is a plain data-completeness count of products with no cost recorded, said in
those words, so nobody mistakes it for a stock valuation.
"""
import logging

from services.skills.reachable import reachable

log = logging.getLogger(__name__)

#: Matches a canonical UUID. `line_items` is free-form JSON written by three
#: different code paths, so `(l->>'product_id')::uuid` on a malformed value
#: aborts the whole statement rather than skipping the row. Live, every open
#: order line on the seeded e2e org carries `"product_id": ""` — an empty
#: string, not a missing key — which is exactly the value that would take the
#: run down.
_UUID_RX = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

#: Matches a plain decimal. Same reason: a quantity of "two" or "" must skip
#: the line, not raise.
_NUM_RX = r"^-?[0-9]+(\.[0-9]+)?$"

#: The quantity key, twice. `routers/vikray.py:OrderLineItem` writes
#: `quantity`; the older seeded orders — 200 of the 226 open lines on the e2e
#: org — write `qty` and no `quantity` at all. Reading only one of them silently
#: halves the order book, which on this data means reading none of it.
_QTY_SQL = f"""
    CASE WHEN COALESCE(l->>'quantity', l->>'qty', '') ~ '{_NUM_RX}'
         THEN COALESCE(l->>'quantity', l->>'qty')::numeric END
"""

#: `jsonb_array_elements` raises on anything that is not an array. The column
#: defaults to '[]' and is NOT NULL, but it is jsonb and nothing stops an object
#: being written into it, so the type is checked rather than trusted.
_LINES_SQL = """
    jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.line_items) = 'array'
             THEN o.line_items ELSE '[]'::jsonb END) l
"""

#: An order in one of these statuses has not yet been fulfilled, so its lines
#: are a claim on stock. `dispatched` and `delivered` are excluded: the goods
#: have left. `draft` and `confirmed` differ in a way that matters and is
#: handled per line — see `check_unfillable_orders`.
OPEN_ORDER_STATUSES = ("draft", "confirmed")


def _f(value, default=0.0) -> float:
    """Decimal | None -> float, because asyncpg returns Decimal for numeric.

    A Decimal is not JSON-serialisable and this output is handed to a language
    model through `json.dumps`. Returning the default for None rather than
    raising keeps one NULL column from taking down a whole scheduled run.
    """
    return default if value is None else float(value)


def _customer_sql(alias_client: str, alias_contact: str) -> str:
    """The customer's NAME, never an id, preferring the company.

    A CRM client is the COMPANY — `staging.graha_clients` — and contacts come
    and go while the customer stays, so the company name wins and the contact is
    only the fallback for a row that predates `client_id`. Live, 300 of the e2e
    org's 319 orders carry a client and 309 carry a contact, so both legs earn
    their place.

    The last resort is a sentence, not an empty string: a blank cell in a
    "which customer is affected" column reads as a rendering fault, and somebody
    will go looking for the bug instead of for the missing client record.
    """
    return (
        f"COALESCE(NULLIF(btrim({alias_client}.name), ''), "
        f"         NULLIF(btrim({alias_contact}.company), ''), "
        f"         NULLIF(btrim({alias_contact}.name), ''), "
        f"         '(customer not recorded on the order)')"
    )


# ══════════════════════════════════════════════════════════════════════════
# 1 · check_impossible_stock
# ══════════════════════════════════════════════════════════════════════════

async def check_impossible_stock(pool, org_id: str, limit: int = 200) -> dict:
    """Stock figures that cannot be true, and the movements behind them.

    Three findings, in descending order of how sure of them we can be:

      negative_on_hand      the balance itself is below zero. Nothing explains
                            this: you cannot hold minus three of a thing.
      went_negative         the movement ledger's running total dipped below
                            zero on a date. Graded — see the module docstring.
      never_received        a product has been issued out and never once
                            received in. Graded the same way.

    Takes nothing beyond the org and a limit, so it can be scheduled. Returns
    {as_at_note, counts, findings, coverage, not_checked, caveats}.
    """
    rows = await pool.fetch(
        f"""
        WITH led AS (
            -- The ledger, per product. Restricted to this org in the CTE
            -- rather than only in the outer join: a product id is unique
            -- globally, but a movement belongs to an org, and aggregating
            -- first and filtering later would sum another practice's issues
            -- into this org's running total.
            SELECT m.product_id,
                   sum(m.quantity_delta)                                     AS ledger_net,
                   sum(m.quantity_delta) FILTER (WHERE m.quantity_delta > 0) AS inbound,
                   sum(m.quantity_delta) FILTER (WHERE m.quantity_delta < 0) AS outbound,
                   count(*)                                                  AS moves,
                   min(m.created_at)::date                                   AS first_move,
                   max(m.created_at)::date                                   AS last_move
            FROM staging.vikray_stock_moves m
            WHERE m.org_id = $1::uuid
            GROUP BY m.product_id
        ),
        run AS (
            -- The running total, in the order the movements were recorded.
            -- `created_at, m.id` and not `created_at` alone: several seeded
            -- movements share a timestamp to the microsecond, and an unstable
            -- ORDER BY inside a window makes the reported dip date change
            -- between two runs over identical data. A check whose answer moves
            -- when the data does not is a check nobody trusts twice.
            SELECT m.product_id, m.created_at::date AS on_date,
                   sum(m.quantity_delta) OVER (
                       PARTITION BY m.product_id
                       ORDER BY m.created_at, m.id
                       ROWS UNBOUNDED PRECEDING) AS running
            FROM staging.vikray_stock_moves m
            WHERE m.org_id = $1::uuid
        ),
        dip AS (
            SELECT product_id,
                   min(running)                                   AS lowest_running,
                   min(on_date) FILTER (WHERE running < 0)        AS first_negative_date
            FROM run GROUP BY product_id
        )
        SELECT p.name                                     AS product_name,
               p.unit,
               p.is_service,
               p.is_active                                AS product_is_active,
               p.cost_price IS NOT NULL                   AS has_cost_price,
               s.id IS NOT NULL                           AS has_stock_row,
               COALESCE(s.quantity_on_hand, 0)            AS on_hand,
               s.low_stock_threshold,
               COALESCE(led.ledger_net, 0)                AS ledger_net,
               led.inbound,
               led.outbound,
               COALESCE(led.moves, 0)                     AS moves,
               led.first_move,
               led.last_move,
               dip.lowest_running,
               dip.first_negative_date,
               count(*) OVER ()                           AS _total
        FROM staging.ganit_products p
        -- Every join to a per-org table carries org_id as well as the id. The
        -- foreign key is on the id alone, so an id join by itself can surface
        -- another practice's row.
        LEFT JOIN staging.vikray_stock s
               ON s.product_id = p.id AND s.org_id = p.org_id
        LEFT JOIN led ON led.product_id = p.id
        LEFT JOIN dip ON dip.product_id = p.id
        WHERE p.org_id = $1::uuid
          AND (s.id IS NOT NULL OR led.product_id IS NOT NULL)
          -- Only rows that trip something. The LIMIT is a scarce resource and
          -- spending it on healthy products would let a real negative fall off
          -- the bottom of a truncated report.
          AND (s.quantity_on_hand < 0
               OR dip.lowest_running < 0
               OR (led.inbound IS NULL AND led.outbound IS NOT NULL))
        -- Worst first, so a truncated run keeps the findings that matter.
        ORDER BY LEAST(COALESCE(s.quantity_on_hand, 0),
                       COALESCE(dip.lowest_running, 0)) ASC,
                 p.name
        LIMIT $2
        """,
        org_id, limit,
    )

    coverage = await pool.fetchrow(
        """
        SELECT (SELECT count(*) FROM staging.vikray_stock
                 WHERE org_id = $1::uuid)                        AS stock_rows,
               (SELECT count(*) FROM staging.vikray_stock_moves
                 WHERE org_id = $1::uuid)                        AS movement_rows,
               (SELECT count(*) FROM staging.ganit_products
                 WHERE org_id = $1::uuid AND is_active)          AS active_products,
               (SELECT count(*) FROM staging.ganit_products
                 WHERE org_id = $1::uuid AND is_active
                   AND cost_price IS NULL)                       AS products_without_cost_price
        """,
        org_id,
    )

    findings: list[dict] = []
    counts = {"negative_on_hand": 0, "went_negative": 0, "never_received": 0}
    ledger_disagrees = 0
    services_carrying_stock: list[str] = []

    for r in rows:
        on_hand = _f(r["on_hand"])
        ledger_net = _f(r["ledger_net"])
        # The balance minus everything the ledger can explain. Non-zero means
        # stock arrived or left without a movement being written, which is the
        # normal state of this data rather than the exception.
        implied_opening = round(on_hand - ledger_net, 4)
        ledger_complete = abs(implied_opening) < 0.0001
        if not ledger_complete:
            ledger_disagrees += 1
        if r["is_service"] and (r["has_stock_row"] or r["moves"]):
            services_carrying_stock.append(r["product_name"])

        base = {
            "product": r["product_name"],
            "unit": r["unit"],
            "is_service": r["is_service"],
            "product_is_active": r["product_is_active"],
            "on_hand": on_hand,
            "movement_ledger_net": ledger_net,
            "movements_recorded": r["moves"],
            "first_movement": r["first_move"].isoformat() if r["first_move"] else None,
            "last_movement": r["last_move"].isoformat() if r["last_move"] else None,
            # Both numbers travel with every row. A reader told "this went to
            # −20 on 24 June" and not told the balance says 269 will go and
            # correct a balance that was never wrong.
            "implied_opening_balance": implied_opening,
            "movement_ledger_explains_the_balance": ledger_complete,
        }

        if on_hand < 0:
            findings.append({**base,
                "check": "negative_on_hand",
                "confidence": "confirmed",
                "detail": (
                    f"{on_hand:g} on hand. A balance below zero is not a low "
                    f"stock level, it is a figure that cannot be true — "
                    f"something was issued that was never received in, or a "
                    f"correction was posted twice."
                ),
            })
            counts["negative_on_hand"] += 1

        lowest = r["lowest_running"]
        if lowest is not None and _f(lowest) < 0:
            confidence = "confirmed" if ledger_complete else "unverified"
            when = (r["first_negative_date"].isoformat()
                    if r["first_negative_date"] else None)
            detail = (
                f"The movement ledger's running total first went below zero on "
                f"{when} and reached {_f(lowest):g}."
            )
            if not ledger_complete:
                detail += (
                    f" UNVERIFIED: the balance ({on_hand:g}) and the ledger "
                    f"({ledger_net:g}) disagree by {implied_opening:g}, so this "
                    f"product holds stock that arrived without a movement being "
                    f"written. The dip may be an artefact of the ledger starting "
                    f"at zero, and no opening balance is recorded anywhere to "
                    f"settle it."
                )
            else:
                detail += (
                    " CONFIRMED: the ledger accounts for the balance exactly, "
                    "so nothing explains the dip."
                )
            findings.append({**base,
                "check": "went_negative",
                "confidence": confidence,
                "first_negative_on": when,
                "lowest_running_total": _f(lowest),
                "detail": detail,
            })
            counts["went_negative"] += 1

        if r["inbound"] is None and r["outbound"] is not None:
            confidence = "confirmed" if ledger_complete else "unverified"
            detail = (
                f"{abs(_f(r['outbound'])):g} {r['unit'] or 'units'} issued out "
                f"across {r['moves']} movement(s) and not one receipt ever "
                f"recorded."
            )
            if not ledger_complete:
                detail += (
                    f" UNVERIFIED: the balance says {on_hand:g} on hand, which "
                    f"the ledger cannot account for — the stock was almost "
                    f"certainly loaded straight onto the balance without a "
                    f"receipt movement. That is a bookkeeping gap, not a "
                    f"shortage."
                )
            else:
                detail += (
                    " CONFIRMED: the ledger accounts for the balance exactly, "
                    "so this product genuinely has no recorded source."
                )
            findings.append({**base,
                "check": "never_received",
                "confidence": confidence,
                "issued_out": abs(_f(r["outbound"])),
                "detail": detail,
            })
            counts["never_received"] += 1

    confirmed = sum(1 for f in findings if f["confidence"] == "confirmed")
    total_candidates = rows[0]["_total"] if rows else 0

    out = {
        "what_this_is": (
            "Stock figures that cannot be true. Every finding is graded: "
            "CONFIRMED means the movement ledger accounts for the balance "
            "exactly and nothing innocent explains the finding. UNVERIFIED "
            "means the ledger and the balance disagree for that product, so "
            "the finding may be an artefact of stock loaded without a "
            "movement. Nothing here has been corrected — a negative quantity "
            "is evidence, and zeroing it destroys the evidence."
        ),
        "counts": {
            **counts,
            "products_flagged": len(rows),
            "findings": len(findings),
            "confirmed": confirmed,
            "unverified": len(findings) - confirmed,
        },
        "findings": findings,
        "coverage": {
            "stock_rows": coverage["stock_rows"],
            "movement_rows": coverage["movement_rows"],
            "products_whose_ledger_disagrees_with_their_balance": ledger_disagrees,
        },
        "not_checked": [
            # The fourth check somebody will ask for, and why it is absent.
            "Nothing here is valued. `ganit_products.cost_price` holds TODAY's "
            "cost, and an order's line items snapshot no cost at the time of "
            "the order, so the value of a past movement is not recoverable from "
            "anything this system stores. The count below is a "
            "DATA-COMPLETENESS flag and is not a valuation of any kind: "
            f"{coverage['products_without_cost_price']} of "
            f"{coverage['active_products']} active products have no cost price "
            "recorded.",
        ],
        "caveats": [],
    }

    if ledger_disagrees:
        out["caveats"].append(
            f"{ledger_disagrees} of the {len(rows)} flagged product(s) carry a "
            f"balance the movement ledger cannot account for. `vikray_stock` is "
            f"written directly as well as through the movement path, and there "
            f"is no opening-balance record anywhere, so for those products the "
            f"ledger cannot settle the question on its own."
        )
    if services_carrying_stock:
        out["caveats"].append(
            f"{len(services_carrying_stock)} of the flagged product(s) are "
            f"SERVICES carrying a stock balance ("
            + ", ".join(sorted(services_carrying_stock)[:10])
            + "). A service has no quantity to hold; the balance is an artefact "
            "of the product being sold through the order path, and the fix is "
            "on the product record, not in the warehouse."
        )
    if total_candidates > len(rows):
        out["caveats"].append(
            f"TRUNCATED: {total_candidates} products trip one of these checks "
            f"and only the worst {len(rows)} are listed. The counts above cover "
            f"the listed products only and are a floor, not the whole picture. "
            f"Raise `limit` to see the rest."
        )
    if not findings:
        out["caveats"].append(
            f"No impossible stock figure found across {coverage['stock_rows']} "
            f"stock row(s) and {coverage['movement_rows']} movement(s). That is "
            f"a finding, not a skipped check."
        )
    return out


# ══════════════════════════════════════════════════════════════════════════
# 2 · check_unfillable_orders
# ══════════════════════════════════════════════════════════════════════════

async def check_unfillable_orders(pool, org_id: str, limit: int = 400) -> dict:
    """Open order lines against the stock actually on hand, in pick order.

    Two different problems, and separating them is the whole point of this
    check:

      short_now             this line alone exceeds the stock on hand. It
                            cannot be picked today whatever else happens.
      short_after_others    there is enough for this line in isolation, but not
                            once the orders ahead of it in the queue have been
                            picked. Nothing else in the product can see this:
                            `find_low_stock` compares one product against one
                            threshold and has no idea an order book exists.

    Pick order is order date, then expected delivery, then order number —
    first promised, first served — and each line is measured against what is
    left after the lines ahead of it, not against the opening balance. Measuring
    every line against the opening balance is the mistake that makes an
    order book of fifty small orders look entirely fillable when it is not.

    ── Which lines are a claim on stock, and which have already been taken ──

    `routers/vikray.py` deducts stock when an order moves to `confirmed`, not
    when it is dispatched. So a confirmed order has, in principle, already been
    taken out of `quantity_on_hand`, and counting it again would double-count
    it into a shortage that does not exist.

    In principle. Live, the whole database holds TWO `order_confirmed`
    movements against 114 confirmed orders — the rest were seeded straight into
    the table and never went through the endpoint, so their stock was never
    deducted. Assuming either way would be wrong, so neither is assumed: a
    confirmed line is counted as an outstanding claim only when NO negative
    movement exists against that order and product. Lines whose deduction is on
    record are excluded and counted under `excluded`.

    Takes nothing beyond the org and a limit. Returns
    {what_this_is, counts, products, coverage, excluded, caveats}.
    """
    rows = await pool.fetch(
        f"""
        WITH line AS (
            SELECT o.id                          AS order_id,
                   o.order_number,
                   o.status,
                   o.order_date,
                   o.expected_delivery,
                   {_customer_sql('cl', 'ct')}   AS customer,
                   CASE WHEN l->>'product_id' ~ '{_UUID_RX}'
                        THEN (l->>'product_id')::uuid END       AS product_id,
                   {_QTY_SQL}                                   AS qty,
                   COALESCE(NULLIF(btrim(l->>'description'), ''),
                            '(line carries no description)')    AS line_description
            FROM staging.vikray_orders o
            CROSS JOIN LATERAL {_LINES_SQL}
            -- The company first, the contact only as the fallback. Both ON
            -- clauses carry org_id: the FK is on the id alone, so an id-only
            -- join can print another practice's client name against this
            -- practice's order.
            LEFT JOIN staging.graha_clients cl
                   ON cl.id = o.client_id AND cl.org_id = o.org_id
            LEFT JOIN staging.graha_contacts ct
                   ON ct.id = o.contact_id AND ct.org_id = o.org_id
            WHERE o.org_id = $1::uuid
              AND o.is_active
              AND o.status = ANY($2::text[])
        ),
        deducted AS (
            -- One row per (order, product) whose stock has demonstrably
            -- already been taken off the balance.
            SELECT DISTINCT m.order_id, m.product_id
            FROM staging.vikray_stock_moves m
            WHERE m.org_id = $1::uuid
              AND m.order_id IS NOT NULL
              AND m.quantity_delta < 0
        )
        SELECT li.order_number,
               li.status,
               li.order_date,
               li.expected_delivery,
               li.customer,
               li.line_description,
               li.qty,
               p.name                                  AS product_name,
               p.unit,
               p.is_service,
               COALESCE(s.quantity_on_hand, 0)         AS on_hand,
               s.id IS NOT NULL                        AS has_stock_row,
               (d.order_id IS NOT NULL)                AS deduction_recorded,
               count(*) OVER ()                        AS _total
        FROM line li
        JOIN staging.ganit_products p
          ON p.id = li.product_id AND p.org_id = $1::uuid
        LEFT JOIN staging.vikray_stock s
               ON s.product_id = li.product_id AND s.org_id = $1::uuid
        LEFT JOIN deducted d
               ON d.order_id = li.order_id AND d.product_id = li.product_id
        WHERE li.product_id IS NOT NULL
          AND li.qty > 0
        -- First promised, first served. `expected_delivery` breaks a tie on
        -- order date; the order number breaks the remaining tie so the pick
        -- order — and therefore which order is reported short — is stable
        -- across runs over unchanged data.
        ORDER BY li.order_date,
                 li.expected_delivery NULLS LAST,
                 li.order_number
        LIMIT $3
        """,
        org_id, list(OPEN_ORDER_STATUSES), limit,
    )

    # How much of the order book this check could even see. On the seeded e2e
    # org the answer is none of it, and a report that did not say so out loud
    # would read as "your order book is fine".
    coverage = await pool.fetchrow(
        f"""
        SELECT count(*)                                            AS open_lines,
               count(*) FILTER (WHERE l->>'product_id' ~ '{_UUID_RX}')
                                                                   AS lines_naming_a_product,
               count(*) FILTER (WHERE {_QTY_SQL} IS NULL)          AS lines_with_no_readable_quantity,
               count(DISTINCT o.id)                                AS open_orders
        FROM staging.vikray_orders o
        CROSS JOIN LATERAL {_LINES_SQL}
        WHERE o.org_id = $1::uuid
          AND o.is_active
          AND o.status = ANY($2::text[])
        """,
        org_id, list(OPEN_ORDER_STATUSES),
    )

    # Group by product NAME rather than by id: the id is the grouping key in
    # the query (the join is on it), but nothing downstream may see a UUID, and
    # two products sharing a name would merge here. Guarded by keying on the
    # name plus the on-hand figure, which cannot collide for one real product.
    products: dict[tuple, dict] = {}
    already_deducted = 0

    for r in rows:
        if r["deduction_recorded"]:
            # Stock for this line is already out of `quantity_on_hand`. Counting
            # it as an outstanding claim would deduct it twice.
            already_deducted += 1
            continue

        key = (r["product_name"], r["unit"])
        group = products.setdefault(key, {
            "product": r["product_name"],
            "unit": r["unit"],
            "is_service": r["is_service"],
            "on_hand": _f(r["on_hand"]),
            "stock_record_exists": r["has_stock_row"],
            "committed_on_open_orders": 0.0,
            "shortfall_after_all_open_orders": 0.0,
            "lines": [],
        })
        group["committed_on_open_orders"] = round(
            group["committed_on_open_orders"] + _f(r["qty"]), 4)
        group["lines"].append(r)

    findings = []
    counts = {"short_now": 0, "short_after_others": 0, "fillable": 0}

    for group in products.values():
        available = group["on_hand"]
        lines_out = []
        for r in group["lines"]:
            qty = _f(r["qty"])
            # Measured against what is LEFT, not against the opening balance.
            # The two shortage verdicts are not degrees of the same thing: one
            # is a fact about this line alone, the other is a fact about the
            # queue, and only the second is invisible to a low-stock alert.
            if available >= qty:
                verdict = "fillable"
            elif qty > group["on_hand"]:
                # This line on its own exceeds everything on hand. It would be
                # short even if it were the only order in the book.
                verdict = "short_now"
            else:
                # There is enough for this line in isolation. There will not be
                # once the orders ahead of it have taken theirs.
                verdict = "short_after_others"
            # Capped at this line's own quantity. Once `available` has gone
            # negative — an earlier order in the queue over-committed — the raw
            # `qty - available` charges this line with the earlier line's
            # deficit too: live, a line ordering 2 against an available of −3
            # reported itself short by 5. Each line is short by at most what it
            # asked for, and the earlier deficit belongs to the earlier line.
            short_by = round(max(0.0, qty - max(available, 0.0)), 4)
            counts[verdict] += 1

            lines_out.append({
                "order": r["order_number"],
                "status": r["status"],
                "customer": r["customer"],
                "order_date": r["order_date"].isoformat() if r["order_date"] else None,
                "expected_delivery": (r["expected_delivery"].isoformat()
                                      if r["expected_delivery"] else None),
                "line": r["line_description"],
                "quantity_ordered": qty,
                "available_when_this_order_is_picked": round(available, 4),
                "verdict": verdict,
                "short_by": short_by,
                "detail": (
                    f"{qty:g} {r['unit'] or 'units'} for {r['customer']}, and "
                    f"{available:g} left by the time this order is picked."
                    if verdict != "fillable" else
                    f"{qty:g} {r['unit'] or 'units'}; {available:g} available "
                    f"at this point in the queue."
                ),
            })
            available = round(available - qty, 4)

        group["shortfall_after_all_open_orders"] = round(min(0.0, available), 4)
        group["remaining_after_all_open_orders"] = round(available, 4)
        group["lines"] = lines_out
        if any(l["verdict"] != "fillable" for l in lines_out):
            findings.append(group)

    # Worst shortfall first, so a reader who stops after three rows has read
    # the three that matter.
    findings.sort(key=lambda g: (g["shortfall_after_all_open_orders"], g["product"]))

    total_candidates = rows[0]["_total"] if rows else 0
    unreadable = (coverage["open_lines"] or 0) - (coverage["lines_naming_a_product"] or 0)

    out = {
        "what_this_is": (
            "Open order lines measured against stock on hand, in the order the "
            "orders will be picked. `short_now` cannot be filled today at all. "
            "`short_after_others` could be filled in isolation but will not be "
            "once the orders ahead of it have taken their stock — which is the "
            "part a per-product low-stock alert cannot see, because it does not "
            "know the order book exists."
        ),
        "counts": {
            **counts,
            "products_short": len(findings),
            "open_orders": coverage["open_orders"],
            "order_lines_examined": len(rows) - already_deducted,
        },
        "products": findings,
        "coverage": {
            "open_order_lines": coverage["open_lines"],
            "lines_naming_a_catalogued_product": coverage["lines_naming_a_product"],
            "lines_this_check_cannot_see": unreadable,
            "lines_with_no_readable_quantity": coverage["lines_with_no_readable_quantity"],
            "statuses_treated_as_open": list(OPEN_ORDER_STATUSES),
        },
        "excluded": {
            "lines_whose_stock_is_already_deducted": already_deducted,
            "why": (
                "An order moving to `confirmed` deducts its stock. A confirmed "
                "line with a matching negative movement on record has therefore "
                "already been taken off the balance, and counting it again "
                "would invent a shortage. A confirmed line with NO such "
                "movement was never deducted and IS counted."
            ),
        },
        "caveats": [],
    }

    if unreadable:
        pct = round(100.0 * unreadable / (coverage["open_lines"] or 1))
        out["caveats"].append(
            f"INCOMPLETE: {unreadable} of {coverage['open_lines']} open order "
            f"line(s) — {pct}% — name no catalogued product, so this check "
            f"cannot see them at all. Their `product_id` is absent or empty, "
            f"and stock is held per product, so there is nothing to measure "
            f"them against. Everything above covers only the "
            f"{coverage['lines_naming_a_product']} line(s) that do name one. "
            f"Read the counts as a floor."
        )
    if coverage["lines_with_no_readable_quantity"]:
        out["caveats"].append(
            f"{coverage['lines_with_no_readable_quantity']} open line(s) carry "
            f"no quantity this check could read (neither `quantity` nor `qty` "
            f"holds a number) and are excluded from every figure above."
        )
    service_short = [g["product"] for g in findings if g["is_service"]]
    if service_short:
        out["caveats"].append(
            f"{len(service_short)} of the products short are SERVICES ("
            + ", ".join(sorted(service_short)[:10])
            + "). A service has no stock to run out of; the shortfall means the "
            "service is being sold through the goods path and carries a stock "
            "balance it should not have. The fix is on the product record."
        )
    missing_stock_row = [g["product"] for g in findings if not g["stock_record_exists"]]
    if missing_stock_row:
        out["caveats"].append(
            f"{len(missing_stock_row)} of the products short have NO stock "
            f"record at all and were treated as zero on hand ("
            + ", ".join(sorted(missing_stock_row)[:10])
            + "). Zero is what the product itself shows on the stock screen, so "
            "this matches what a user would see — but it may mean the stock was "
            "simply never set up rather than that there is none."
        )
    if total_candidates > len(rows):
        out["caveats"].append(
            f"TRUNCATED: {total_candidates} order line(s) name a product and "
            f"only the first {len(rows)} in pick order were examined. Later "
            f"orders are missing from every figure above, so the shortfalls are "
            f"a floor. Raise `limit` to see the whole book."
        )
    if not findings:
        if not coverage["lines_naming_a_product"]:
            out["caveats"].append(
                f"NOT A CLEAN BILL OF HEALTH. None of the "
                f"{coverage['open_lines']} open order line(s) names a "
                f"catalogued product, so nothing could be checked against "
                f"stock. This check found no shortage because it could not "
                f"look, not because there is none."
            )
        else:
            out["caveats"].append(
                f"Every one of the {coverage['lines_naming_a_product']} open "
                f"line(s) that names a product can be filled from stock on "
                f"hand. That is a finding, not a skipped check."
            )
    return out


# ══════════════════════════════════════════════════════════════════════════
# 3 · check_stale_retainer_rates
# ══════════════════════════════════════════════════════════════════════════

async def check_stale_retainer_rates(
    pool, org_id: str, horizon_days: int = 60, stale_months: int = 12,
    limit: int = 200,
) -> dict:
    """Engagements about to expire, and fees nobody has revisited.

    ── The argument for this skill, corrected ──────────────────────────────

    The case originally made for it was that `renewal_reminder_days` already
    exists per contract and nothing reads it — so the firm had already told the
    product when to remind them and the product was ignoring it.

    That is FALSE, and it was checked before being leant on. The column
    defaults to 30, it is editable in two screens and both are pre-filled at
    30, and read-only against the live database on 2026-08-20 every one of the
    63 contract rows in existence still holds exactly 30. Nobody has ever set
    it. So the column records the PRODUCT's default, not the firm's intention,
    and a skill claiming to honour a preference the firm expressed would be
    inventing the preference.

    The column is still read and still respected — a firm that does set it to
    90 gets a 90-day window — but the distribution is reported on the output so
    the reader can see whether the window came from them or from the default.
    The real argument for the skill is simpler and survives: an engagement's
    end date is in the table, nothing watches it, and a retainer that rolls on
    at last year's fee is the most expensive thing a practice does by accident.

    ── What cannot be measured, and is not claimed ─────────────────────────

    There is no rate history. `ganit_contracts` has `updated_at` and nothing
    else, so "the fee has not been revised" can only ever mean "the row has not
    been touched" — and a row touched for any reason at all resets it.
    `ganit_recurring`, which is the path a firm's retainer billing actually
    runs through, has no `updated_at` COLUMN AT ALL, so for a recurring profile
    even that much is unavailable and only the creation date can be reported.
    Both statements are on the output, not just here.

    Preparing a renewal for signature is a WEB flow. eSign is web-only and is
    not a mobile destination, so nothing here should be read as a step a phone
    can complete.

    Takes nothing beyond the org and two windows that both have defaults.
    Returns {what_this_is, counts, contracts, recurring_profiles,
             reminder_window_is_configured, limitations, caveats}.
    """
    contracts = await pool.fetch(
        f"""
        SELECT k.id,
               k.title,
               k.status,
               k.start_date,
               k.end_date,
               k.contract_value,
               k.renewal_reminder_days,
               k.updated_at::date                       AS last_changed,
               k.created_at::date                       AS created_on,
               (k.end_date - CURRENT_DATE)              AS days_to_end,
               -- Decided HERE, against the timestamp, and never re-derived in
               -- Python from `last_changed`. `updated_at::date` has already
               -- thrown away the time, so a Python test against a month
               -- boundary would disagree with the WHERE clause that admitted
               -- the row — and a row on the list with no reason attached is
               -- the worst kind of finding.
               (k.updated_at < NOW() - ($3::int * INTERVAL '1 month'))
                                                        AS unchanged_too_long,
               {_customer_sql('cl', 'ct')}              AS client,
               NULLIF(btrim(ct.email), '')              AS client_email,
               NULLIF(btrim(ct.phone), '')              AS client_phone,
               count(*) OVER ()                         AS _total
        FROM staging.ganit_contracts k
        -- Contracts hang off a CONTACT, not off a client: there is no
        -- `client_id` on this table. The company is one hop further, through
        -- the contact, and BOTH hops carry org_id — the FK is on the id alone,
        -- so an id-only join can print another practice's client name.
        LEFT JOIN staging.graha_contacts ct
               ON ct.id = k.contact_id AND ct.org_id = k.org_id
        LEFT JOIN staging.graha_clients cl
               ON cl.id = ct.client_id AND cl.org_id = k.org_id
        WHERE k.org_id = $1::uuid
          AND k.is_active
          AND (
                -- Expiring inside the horizon.
                (k.end_date IS NOT NULL
                 AND k.end_date >= CURRENT_DATE
                 AND k.end_date <= CURRENT_DATE + $2::int)
                -- Or inside the firm's own reminder window, which may be wider
                -- than the horizon if they ever set it.
             OR (k.end_date IS NOT NULL
                 AND k.end_date >= CURRENT_DATE
                 AND k.end_date - COALESCE(k.renewal_reminder_days, 30) <= CURRENT_DATE)
                -- Or untouched for a long time while still in force.
             OR (k.status IN ('active', 'renewed')
                 AND k.updated_at < NOW() - ($3::int * INTERVAL '1 month'))
                -- Or the status and the dates contradict each other, which
                -- makes every other signal on the row unreadable.
             OR (k.status = 'expired' AND k.end_date > CURRENT_DATE)
             OR (k.status IN ('active', 'renewed') AND k.end_date < CURRENT_DATE)
             OR (k.status IN ('active', 'renewed') AND k.end_date IS NULL)
          )
        ORDER BY k.end_date NULLS LAST, k.updated_at
        LIMIT $4
        """,
        org_id, horizon_days, stale_months, limit,
    )

    reminder_rows = await pool.fetch(
        """
        SELECT COALESCE(k.renewal_reminder_days, 30) AS days, count(*) AS n
        FROM staging.ganit_contracts k
        WHERE k.org_id = $1::uuid AND k.is_active
        GROUP BY 1 ORDER BY n DESC, 1
        """,
        org_id,
    )

    profiles = await pool.fetch(
        f"""
        SELECT r.frequency,
               r.subtotal,
               r.gst_rate,
               r.next_date,
               r.end_date,
               r.created_at::date                       AS created_on,
               {_customer_sql('cl', 'ct')}              AS client,
               NULLIF(btrim(ct.email), '')              AS client_email,
               NULLIF(btrim(ct.phone), '')              AS client_phone,
               (SELECT count(*) FROM staging.ganit_invoices i
                 WHERE i.org_id = r.org_id AND i.recurring_id = r.id)
                                                        AS invoices_raised,
               (SELECT count(DISTINCT i.subtotal) FROM staging.ganit_invoices i
                 WHERE i.org_id = r.org_id AND i.recurring_id = r.id)
                                                        AS distinct_amounts_billed,
               (SELECT min(i.invoice_date) FROM staging.ganit_invoices i
                 WHERE i.org_id = r.org_id AND i.recurring_id = r.id)
                                                        AS first_billed,
               count(*) OVER ()                         AS _total
        FROM staging.ganit_recurring r
        LEFT JOIN staging.graha_contacts ct
               ON ct.id = r.contact_id AND ct.org_id = r.org_id
        LEFT JOIN staging.graha_clients cl
               ON cl.id = ct.client_id AND cl.org_id = r.org_id
        WHERE r.org_id = $1::uuid
          AND r.is_active
          -- `created_at` and not `updated_at`: this table has no `updated_at`
          -- column. An edited profile is indistinguishable from an untouched
          -- one, which is stated on the output rather than glossed over.
          AND r.created_at < NOW() - ($2::int * INTERVAL '1 month')
        ORDER BY r.created_at
        LIMIT $3
        """,
        org_id, stale_months, limit,
    )

    findings = []
    counts = {
        "expiring_soon": 0,
        "in_the_firms_reminder_window": 0,
        "unchanged_too_long": 0,
        "status_contradicts_dates": 0,
    }

    for r in contracts:
        reminder_days = r["renewal_reminder_days"] if r["renewal_reminder_days"] is not None else 30
        days_to_end = r["days_to_end"]
        reasons = []

        if days_to_end is not None and 0 <= days_to_end <= horizon_days:
            reasons.append("expiring_soon")
            counts["expiring_soon"] += 1
        if days_to_end is not None and 0 <= days_to_end <= reminder_days:
            reasons.append("in_the_firms_reminder_window")
            counts["in_the_firms_reminder_window"] += 1
        if r["unchanged_too_long"] and r["status"] in ("active", "renewed"):
            reasons.append("unchanged_too_long")
            counts["unchanged_too_long"] += 1

        contradiction = None
        if r["status"] == "expired" and days_to_end is not None and days_to_end > 0:
            contradiction = (
                f"status is 'expired' but the end date is {r['end_date']}, "
                f"{days_to_end} day(s) away. Either the status was set by hand "
                f"or the dates are wrong; until they agree, no renewal signal "
                f"from this row can be trusted."
            )
        elif r["status"] in ("active", "renewed") and days_to_end is not None and days_to_end < 0:
            contradiction = (
                f"status is '{r['status']}' but the end date "
                f"({r['end_date']}) passed {abs(days_to_end)} day(s) ago. The "
                f"engagement is either being worked without a live contract or "
                f"the status was never moved on."
            )
        elif r["status"] in ("active", "renewed") and r["end_date"] is None:
            contradiction = (
                "status is in force but the row carries no end date at all, so "
                "nothing will ever prompt a review of this fee."
            )
        if contradiction:
            reasons.append("status_contradicts_dates")
            counts["status_contradicts_dates"] += 1

        findings.append(reachable({
            "engagement": r["title"],
            "client": r["client"],
            "status": r["status"],
            "start_date": r["start_date"].isoformat() if r["start_date"] else None,
            "end_date": r["end_date"].isoformat() if r["end_date"] else None,
            "days_to_end": days_to_end,
            "contract_value": _f(r["contract_value"]),
            "reminder_days_on_the_record": reminder_days,
            "last_changed": r["last_changed"].isoformat() if r["last_changed"] else None,
            "created_on": r["created_on"].isoformat() if r["created_on"] else None,
            # Never empty. A row can only be here because the WHERE clause
            # admitted it, and one of those clauses is the reminder window
            # computed off the row's own `renewal_reminder_days` — which the
            # Python tests above re-check with the same arithmetic. If the two
            # ever drift, this says so on the row rather than presenting a
            # finding with no stated reason.
            "reasons": reasons or ["matched_the_reminder_window"],
            "contradiction": contradiction,
        }, kind="agreement", entity_id=r["id"],
            email=r["client_email"], phone=r["client_phone"]))

    reminder_distribution = {int(r["days"]): r["n"] for r in reminder_rows}
    configured = (len(reminder_distribution) > 1
                  or (len(reminder_distribution) == 1
                      and 30 not in reminder_distribution))

    # Three states, not two. An org with NO contracts at all produced an empty
    # distribution and was then told "where every row reads 30, that is the
    # product's default" — a sentence about rows that do not exist, which reads
    # as a claim that the firm has contracts and has not configured them. Seen
    # live on the second seeded org, which holds zero contract rows.
    if not reminder_distribution:
        reminder_note = (
            "No engagement records exist for this org, so there is no reminder "
            "window to report either way."
        )
    elif configured:
        reminder_note = (
            "The firm has set this away from the default on at least some "
            "engagements, so the reminder window above reflects their own "
            "choice."
        )
    else:
        reminder_note = (
            "`renewal_reminder_days` defaults to 30 and is pre-filled at 30 in "
            "both screens that edit it. Every row here reads 30, so that is the "
            "PRODUCT's default and not a window the firm chose — the reminder "
            "timing above is ours, not theirs."
        )

    profile_rows = [{
        "client": p["client"],
        "frequency": p["frequency"],
        "amount_before_gst": _f(p["subtotal"]),
        "gst_rate": _f(p["gst_rate"]),
        "next_invoice_on": p["next_date"].isoformat() if p["next_date"] else None,
        "profile_ends": p["end_date"].isoformat() if p["end_date"] else None,
        "created_on": p["created_on"].isoformat() if p["created_on"] else None,
        "invoices_raised": p["invoices_raised"],
        # The only evidence of a fee revision this system holds: whether the
        # invoices this profile has actually raised were all for the same
        # amount. One distinct amount across a long run means the fee has never
        # moved. It is evidence, not proof — a profile edited before it ever
        # billed shows one amount too.
        "distinct_amounts_billed": p["distinct_amounts_billed"],
        "first_billed": p["first_billed"].isoformat() if p["first_billed"] else None,
        "detail": (
            f"Recurring {p['frequency']} billing at "
            f"{_f(p['subtotal']):,.2f} before GST, set up on "
            f"{p['created_on']} and not reviewed since — this table records no "
            f"edit date, so 'since' means since it was created."
        ),
    } for p in profiles]

    out = {
        "what_this_is": (
            "Engagements expiring inside the horizon, engagements whose record "
            "has not been touched in a long time, and rows whose status and "
            "dates contradict each other. Preparing a renewal for signature is "
            "a web flow — eSign is web-only — so nothing here is a step a "
            "phone can finish."
        ),
        "windows": {
            "horizon_days": horizon_days,
            "stale_months": stale_months,
        },
        "counts": {
            **counts,
            "engagements_flagged": len(findings),
            "recurring_profiles_flagged": len(profile_rows),
        },
        "contracts": findings,
        "recurring_profiles": profile_rows,
        "reminder_window_is_configured": {
            "distribution": reminder_distribution,
            "the_firm_has_set_this": configured,
            "note": reminder_note,
        },
        "limitations": [
            "There is no rate history anywhere in this system. 'The fee has "
            "not been revised' can only mean 'the contract row has not been "
            "edited', and an edit for any reason at all — a note, a file, a "
            "status — resets that clock.",
            "`ganit_recurring`, which is the path retainer billing actually "
            "runs through, has no `updated_at` column at all. For a recurring "
            "profile even the edit date is unavailable, so only the creation "
            "date and the amounts actually billed are reported.",
            "`contract_value` is the value of the whole engagement, not a "
            "rate. Nothing here computes a monthly fee, an escalation or a "
            "market comparison.",
        ],
        "caveats": [],
    }

    if contracts and contracts[0]["_total"] > len(contracts):
        out["caveats"].append(
            f"TRUNCATED: {contracts[0]['_total']} engagement(s) match and only "
            f"{len(contracts)} are listed, nearest expiry first. The counts "
            f"above cover the listed rows only."
        )
    if profiles and profiles[0]["_total"] > len(profiles):
        out["caveats"].append(
            f"TRUNCATED: {profiles[0]['_total']} recurring profile(s) match and "
            f"only {len(profiles)} are listed."
        )
    if counts["status_contradicts_dates"]:
        out["caveats"].append(
            f"{counts['status_contradicts_dates']} engagement(s) carry a status "
            f"that contradicts their own dates. Those rows are listed first for "
            f"a reason: until the status and the dates agree, no renewal "
            f"reminder built on either can be relied on."
        )
    if not findings and not profile_rows:
        out["caveats"].append(
            f"No engagement expires within {horizon_days} days, none in force "
            f"has gone {stale_months} months untouched, and no status "
            f"contradicts its dates. That is a finding, not a skipped check."
        )
    return out
