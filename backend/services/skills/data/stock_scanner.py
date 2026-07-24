import logging

log = logging.getLogger(__name__)


async def find_low_stock(pool, org_id: str) -> list:
    """Return products whose on-hand quantity is at or below the low-stock threshold.

    Each item: {item, quantity, threshold, deficit}.
    """
    rows = await pool.fetch(
        """
        SELECT s.product_id, p.name AS product_name,
               s.quantity_on_hand, s.low_stock_threshold
        FROM staging.vikray_stock s
        JOIN staging.ganit_products p ON p.id = s.product_id
        WHERE s.org_id = $1::uuid
          AND s.low_stock_threshold IS NOT NULL
          AND s.quantity_on_hand <= s.low_stock_threshold
        ORDER BY (s.low_stock_threshold - s.quantity_on_hand) DESC
        """,
        org_id,
    )

    return [
        {
            "item": {"id": str(r["product_id"]), "name": r["product_name"]},
            "quantity": r["quantity_on_hand"],
            "threshold": r["low_stock_threshold"],
            "deficit": r["low_stock_threshold"] - r["quantity_on_hand"],
        }
        for r in rows
    ]
