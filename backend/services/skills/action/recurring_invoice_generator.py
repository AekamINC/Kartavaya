import logging
import uuid
from datetime import datetime, date

log = logging.getLogger(__name__)


async def generate_due_invoices(pool, org_id: str) -> dict:
    """Generate invoices from recurring definitions that are due today.

    Returns {generated: int, skipped: int}.
    """
    today = date.today()

    recurrings = await pool.fetch(
        """
        SELECT id, contact_id, line_items, subtotal, cgst, sgst, igst, cess,
               discount, total, is_igst, place_of_supply, notes, terms,
               frequency, next_date, created_by
        FROM staging.ganit_recurring
        WHERE org_id = $1::uuid
          AND is_active = true
          AND next_date <= $2
        """,
        org_id, today,
    )

    generated = 0
    skipped = 0

    for rec in recurrings:
        try:
            inv_id = uuid.uuid4()
            # Generate invoice number
            count_row = await pool.fetchrow(
                "SELECT COUNT(*) AS cnt FROM staging.ganit_invoices WHERE org_id = $1::uuid AND invoice_type = 'tax_invoice'",
                org_id,
            )
            inv_number = f"INV-{(count_row['cnt'] or 0) + 1:05d}"

            # Calculate due date (30 days from invoice date)
            due_date = today.replace(day=min(today.day, 28))
            from datetime import timedelta
            due_date = today + timedelta(days=30)

            await pool.execute(
                """
                INSERT INTO staging.ganit_invoices
                    (id, org_id, contact_id, invoice_number, invoice_type, invoice_date,
                     due_date, place_of_supply, is_igst, line_items, subtotal,
                     cgst, sgst, igst, cess, discount, total, amount_paid, balance_due,
                     payment_status, notes, terms, created_by, recurring_id, is_active)
                VALUES ($1, $2::uuid, $3::uuid, $4, 'tax_invoice', $5,
                        $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16, 0, $16,
                        'unpaid', $17, $18, $19::uuid, $20::uuid, true)
                """,
                inv_id, org_id, rec["contact_id"], inv_number, today,
                due_date, rec["place_of_supply"], rec["is_igst"], rec["line_items"],
                rec["subtotal"], rec["cgst"], rec["sgst"], rec["igst"], rec["cess"],
                rec["discount"], rec["total"], rec["notes"], rec["terms"],
                rec["created_by"], rec["id"],
            )

            # Advance next_date
            freq = rec["frequency"] or "monthly"
            if freq == "weekly":
                delta = timedelta(days=7)
            elif freq == "quarterly":
                delta = timedelta(days=90)
            elif freq == "yearly":
                delta = timedelta(days=365)
            else:
                delta = timedelta(days=30)

            next_date = rec["next_date"] + delta
            await pool.execute(
                "UPDATE staging.ganit_recurring SET next_date = $2, updated_at = NOW() WHERE id = $1::uuid",
                rec["id"], next_date,
            )
            generated += 1

        except Exception:
            log.exception("Failed to generate invoice for recurring %s", rec["id"])
            skipped += 1

    return {"generated": generated, "skipped": skipped}
