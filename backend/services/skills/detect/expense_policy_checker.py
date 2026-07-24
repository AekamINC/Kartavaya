import logging

log = logging.getLogger(__name__)

# Default policy limits (can be overridden per org later)
DEFAULT_LIMITS = {
    "travel": 50000,
    "meals": 5000,
    "office_supplies": 10000,
    "software": 25000,
    "other": 15000,
}

AUTO_APPROVE_MAX = 2000  # auto-approve below this amount


async def check_policy(pool, org_id: str, expense: dict) -> dict:
    """Check an expense claim against org policy.

    *expense*: {category, amount, receipt_attached, description}

    Returns {compliant, violations: [...], auto_approve}.
    """
    amount = expense.get("amount", 0)
    category = expense.get("category", "other")
    receipt = expense.get("receipt_attached", False)

    violations = []

    # Category limit
    limit = DEFAULT_LIMITS.get(category, DEFAULT_LIMITS["other"])
    if amount > limit:
        violations.append(f"exceeds_{category}_limit_{limit}")

    # Receipt required for amounts > 500
    if amount > 500 and not receipt:
        violations.append("receipt_required_above_500")

    # Description required
    if not expense.get("description"):
        violations.append("description_missing")

    compliant = len(violations) == 0
    auto_approve = compliant and amount <= AUTO_APPROVE_MAX

    return {
        "compliant": compliant,
        "violations": violations,
        "auto_approve": auto_approve,
    }
