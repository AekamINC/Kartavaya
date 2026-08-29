import logging
from difflib import SequenceMatcher

log = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.6


async def fuzzy_match_transactions(pool, org_id: str, bank_txns: list) -> list:
    """Match bank transactions to unpaid/partial invoices using amount + fuzzy narration.

    *bank_txns*: list of {amount, date, narration, reference}.

    Returns list of {txn, matched_invoice, confidence}.
    """
    if not bank_txns:
        return []

    # Fetch unreconciled invoices
    invoices = await pool.fetch(
        """
        SELECT id, invoice_number, total, balance_due, contact_id,
               c.name AS contact_name
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_contacts c ON c.id = i.contact_id
        WHERE i.org_id = $1::uuid
          AND i.payment_status IN ('unpaid', 'partial')
          AND i.invoice_type = 'tax_invoice'
          AND i.is_active = true
        """,
        org_id,
    )

    results = []
    for txn in bank_txns:
        txn_amount = float(txn.get("amount", 0))
        narration = (txn.get("narration") or "").lower()
        ref = (txn.get("reference") or "").lower()

        best_match = None
        best_conf = 0.0

        for inv in invoices:
            conf = 0.0
            balance = float(inv["balance_due"])

            # Amount match (exact or close)
            if balance > 0 and abs(txn_amount - balance) / balance < 0.02:
                conf += 0.5
            elif balance > 0 and abs(txn_amount - balance) / balance < 0.10:
                conf += 0.3

            # Narration / reference match against invoice number or contact name
            inv_num = (inv["invoice_number"] or "").lower()
            contact = (inv["contact_name"] or "").lower()

            if inv_num and inv_num in narration:
                conf += 0.4
            elif inv_num and inv_num in ref:
                conf += 0.4
            elif contact:
                ratio = SequenceMatcher(None, contact, narration).ratio()
                conf += ratio * 0.3

            if conf > best_conf:
                best_conf = conf
                best_match = inv

        match_result = {"txn": txn, "matched_invoice": None, "confidence": 0}
        if best_match and best_conf >= CONFIDENCE_THRESHOLD:
            match_result["matched_invoice"] = {
                "id": str(best_match["id"]),
                "invoice_number": best_match["invoice_number"],
                "balance_due": float(best_match["balance_due"]),
                "contact": best_match["contact_name"],
            }
            match_result["confidence"] = round(best_conf, 2)

        results.append(match_result)

    return results
