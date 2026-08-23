"""
compliance_settings.py — the resolver behind `staging.module_compliance_settings`
(migration 210). Workstream H, proposal 80: "compliance is a setting."

Three states per (org, module, rule_key):
  not_applicable — the firm says this does not apply. Hidden, no warning.
  applicable     — DEFAULT. Shown, optional, the consequence is stated.
                   Never blocks.
  enforced       — the firm chose the guardrail. Blocks.

A rule with no row resolves to `applicable` — nothing needs seeding and
nothing arrives enforced, ever.

RULES is a registry, not just documentation: it is what stops a setting from
becoming a control nothing enforces. Every entry names exactly where its
state is actually read. Do not add a rule_key here until the code that reads
it exists — an unenforced setting is a promise, not a control (proposal 80's
own words), and this file is the one place that promise would be made.
"""
from dataclasses import dataclass
from typing import Literal

State = Literal["not_applicable", "applicable", "enforced"]
STATES: tuple[str, ...] = ("not_applicable", "applicable", "enforced")
DEFAULT_STATE: State = "applicable"


@dataclass(frozen=True)
class Rule:
    label: str
    #: What happens at 'applicable' if the field is left empty — shown to the
    #: firm on the settings screen, not just in the document.
    consequence: str
    #: File:function that actually reads this rule's resolved state. Kept
    #: here so "is this wired" is answerable by reading this file alone.
    enforced_at: str


RULES: dict[str, dict[str, Rule]] = {
    "ganit": {
        "gstin_required": Rule(
            label="GST registration",
            consequence=(
                "No GSTIN — the document fails e-invoice validation and blocks "
                "the recipient's input tax credit without it."
            ),
            enforced_at="services/doc_validation.py:validate_tax_invoice",
        ),
        "hsn_required": Rule(
            label="HSN/SAC code on every line",
            consequence=(
                "No HSN — the buyer's input tax credit may be questioned, and "
                "the invoice is held back from GSTR-1 until it is filled."
            ),
            enforced_at="services/doc_validation.py:validate_tax_invoice",
        ),
    },
}


def rules_for(module: str) -> dict[str, Rule]:
    return RULES.get(module, {})


async def resolve(pool, org_id: str, module: str) -> dict[str, dict]:
    """Every known rule for `module`, with its resolved state and the row
    that set it (if any). Unknown-to-the-registry rows are not returned —
    the registry, not the table, defines what a module's settings ARE."""
    known = rules_for(module)
    rows = await pool.fetch(
        "SELECT rule_key, state, set_by, set_at, reason "
        "FROM staging.module_compliance_settings "
        "WHERE org_id=$1::uuid AND module=$2",
        org_id, module,
    )
    by_key = {r["rule_key"]: dict(r) for r in rows}

    out: dict[str, dict] = {}
    for key, rule in known.items():
        row = by_key.get(key)
        out[key] = {
            "label": rule.label,
            "consequence": rule.consequence,
            "state": row["state"] if row else DEFAULT_STATE,
            "set_by": row["set_by"] if row else None,
            "set_at": row["set_at"].isoformat() if row and row["set_at"] else None,
            "reason": row["reason"] if row else None,
        }
    return out


async def resolve_states(pool, org_id: str, module: str) -> dict[str, str]:
    """Just the state per rule_key — what enforcement call sites want,
    without the label/consequence text the settings screen needs."""
    full = await resolve(pool, org_id, module)
    return {k: v["state"] for k, v in full.items()}


async def set_rule(
    pool, org_id: str, module: str, rule_key: str, state: str,
    set_by: str, reason: str | None = None,
) -> dict:
    if rule_key not in rules_for(module):
        raise ValueError(f"'{rule_key}' is not a compliance setting for {module}")
    if state not in STATES:
        raise ValueError(f"'{state}' is not a valid state. Valid: {', '.join(STATES)}")
    row = await pool.fetchrow(
        "INSERT INTO staging.module_compliance_settings "
        "  (org_id, module, rule_key, state, set_by, set_at, reason) "
        "VALUES ($1::uuid, $2, $3, $4, $5, NOW(), $6) "
        "ON CONFLICT (org_id, module, rule_key) DO UPDATE SET "
        "  state=EXCLUDED.state, set_by=EXCLUDED.set_by, "
        "  set_at=NOW(), reason=EXCLUDED.reason "
        "RETURNING rule_key, state, set_by, set_at, reason",
        org_id, module, rule_key, state, set_by, reason,
    )
    return dict(row)
