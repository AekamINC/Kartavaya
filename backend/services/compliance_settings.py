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
state is actually read — or says, in the same field, that nothing reads it.

── `enforced_at=None` — WHY THE RULE CHANGED SHAPE, NOT ITS MIND ────────────

This file used to say: do not add a rule_key until the code that reads it
exists, because "an unenforced setting is a promise, not a control"
(proposal 80's own words). That was the right instinct expressed as a ban,
and the ban had a cost — proposal 80's whole premise is that the FIRM ticks
what applies to it, and a firm that wants to record "ESI has never applied
to us, we have never had ten people at one location" had nowhere to write it
down. Rule 1 of the proposal is that "not applicable is a DECISION, not an
absence"; the decision is the deliverable, and it is worth recording before
any code reads it.

So the ban is now a distinction the type system carries and the API states
out loud:

  enforced_at="path.py:func"  WIRED. Named code reads the resolved state.
                              All three states are offered.
  enforced_at=None            RECORDED ONLY. Nothing reads it. The firm's
                              position is stored, attributed and dated, and
                              the screen says in as many words that the
                              product does not change behaviour from it.
                              `enforced` is REFUSED — see `set_rule`.

That last refusal is what keeps the original rule intact. "Enforced" means
the firm asked to be STOPPED, and offering it where nothing can stop anything
is precisely the promise the ban existed to prevent. A recorded-only rule can
only ever be `applicable` or `not_applicable`: two ways of stating a fact
about the business, neither of which claims the product acts on it.

When somebody wires a rule, they fill in `enforced_at` and the third state
appears with no other change. `tests/test_compliance_settings.py` asserts
that every non-None `enforced_at` names a file that exists and a symbol that
is in it, so the field cannot rot into decoration.

── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────

Migration 210 draws the boundary and it is narrower than proposal 80's own
per-module wish-list: "only applies/does-not-apply questions move here", and
operational configuration stays where it lives. That rules out most of what
proposal 80 lists for three modules, and they are absent for that reason
rather than for want of typing:

  manav (HR)         probation length, notice period, whether asset return
                     gates F&F, whether an exit interview is required. All
                     four are POLICY NUMBERS AND SWITCHES, not "does this
                     apply to us" — the same class as Pahchan's radius and
                     grace, which migration 210 explicitly keeps out.
  kray (Procurement) approval on/off and its rules, prefixes, budgets,
                     over-receipt tolerance, three-way-match strictness,
                     close-short reasons. Proposal 77 specifies these as
                     procurement configuration and they belong with it.
  pahchan            consent model, enrolment-requires-acknowledgement,
                     alternative attendance, on-spoofed-location. These ARE
                     applicability questions and they DO belong here — they
                     are being built alongside the consent capture path
                     (PHASE-4 §4.2), which is the code that will read them.
                     Registering them here first would put four controls on
                     the screen ahead of the module they configure.
"""
from dataclasses import dataclass
from typing import Literal

State = Literal["not_applicable", "applicable", "enforced"]
STATES: tuple[str, ...] = ("not_applicable", "applicable", "enforced")
DEFAULT_STATE: State = "applicable"

#: The two a firm may choose for a rule nothing reads. Both are statements of
#: fact about the business; neither claims the product acts on them.
DECLARED_STATES: tuple[str, ...] = ("not_applicable", "applicable")


@dataclass(frozen=True)
class Rule:
    label: str
    #: What happens at 'applicable' if the field is left empty — shown to the
    #: firm on the settings screen, not just in the document.
    #:
    #: THIS IS A CONSEQUENCE, NEVER A CLAIM. "No HSN — the buyer's input tax
    #: credit may be questioned" is a fact about what follows from a gap.
    #: "You are GST compliant" is a sentence the customer would repeat to
    #: their own regulator on our word, and this product does not have that
    #: word to give. Nothing in this file may assert a compliance status.
    consequence: str
    #: `file.py:symbol` of the code that actually reads this rule's resolved
    #: state, or None when nothing does. See the module docstring — None is a
    #: supported, declared value, not a gap to be filled with a guess.
    enforced_at: str | None = None

    @property
    def wired(self) -> bool:
        """Does any code read this rule's state? Drives which states the API
        will accept and what the screen says beside the control."""
        return bool(self.enforced_at)

    @property
    def states(self) -> tuple[str, ...]:
        return STATES if self.wired else DECLARED_STATES


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
        # ── Recorded only, below this line ───────────────────────────────
        # Each names a real applicability question from proposal 80's Ganit
        # row. None is read by anything today, and each says so on screen.
        "composition_scheme": Rule(
            label="Composition scheme",
            consequence=(
                "A composition dealer may not charge GST on an invoice and may "
                "not pass on input tax credit; the document says 'composition "
                "taxable person' instead of showing a tax split."
            ),
        ),
        "reverse_charge": Rule(
            label="Reverse charge supplies",
            consequence=(
                "Under reverse charge the RECIPIENT pays the tax, so the "
                "invoice carries no tax amount and must say the charge is "
                "payable on reverse-charge basis."
            ),
        ),
        "e_invoicing": Rule(
            label="e-Invoicing (IRN)",
            consequence=(
                "Where e-invoicing applies, an invoice without an IRN is not a "
                "valid tax invoice, and the IRP rejects a document reported "
                "more than 30 days after its date with no late path."
            ),
        ),
        "e_way_bill": Rule(
            label="e-Way bill",
            consequence=(
                "Goods moved without an e-way bill where one is required can "
                "be detained in transit, and the bill is generated before the "
                "movement starts rather than after."
            ),
        ),
    },
    # ── Vetana (payroll) — the five statutory heads ──────────────────────
    #
    # Recorded only, every one. Payroll decides each of these today from the
    # salary structure and the employee's work state, NOT from this table,
    # and the screen says so rather than implying a switch. What the firm
    # gains now is rule 1 of proposal 80: a dated, attributed record of the
    # position it holds, which is the thing an auditor asks for and the thing
    # the product has never had anywhere to put.
    #
    # Chosen because each is unambiguously an applies/does-not-apply question
    # that genuinely differs between two firms of the same size — which is
    # the test migration 210 sets for belonging in this table at all.
    "vetana": {
        "pf_applicable": Rule(
            label="Provident fund (EPF)",
            consequence=(
                "Where the establishment is covered, both halves of the "
                "contribution are owed whether or not they were deducted, and "
                "arrears carry interest and damages on top."
            ),
        ),
        "esi_applicable": Rule(
            label="Employees' State Insurance (ESI)",
            consequence=(
                "An employee under the wage ceiling at a covered establishment "
                "loses ESI medical and cash benefits entirely if no "
                "contribution was made for them."
            ),
        ),
        "professional_tax_applicable": Rule(
            label="Professional tax",
            consequence=(
                "Professional tax is a state levy the employer deducts and "
                "deposits; where it applies, an undeducted month is recovered "
                "from the employer, not the employee."
            ),
        ),
        "lwf_applicable": Rule(
            label="Labour Welfare Fund",
            consequence=(
                "LWF applies in some states and not others, and the "
                "contribution is periodic rather than monthly — a missed "
                "period is recovered with interest."
            ),
        ),
        "gratuity_applicable": Rule(
            label="Gratuity",
            consequence=(
                "Gratuity becomes payable on exit after five years of "
                "continuous service; an unprovisioned liability appears in "
                "full at full-and-final settlement."
            ),
        ),
    },
}

#: Display order for the screen. A module absent from RULES is absent here —
#: this is an ordering, never a second source of truth for what exists.
MODULE_ORDER: tuple[str, ...] = ("ganit", "vetana")


def rules_for(module: str) -> dict[str, Rule]:
    return RULES.get(module, {})


def modules() -> list[str]:
    """Every module that has compliance settings, in display order.

    `MODULE_ORDER` first, then anything in RULES it does not name — so adding
    a module to RULES alone still reaches the screen (at the end) rather than
    being silently invisible until somebody remembers the second list.
    """
    ordered = [m for m in MODULE_ORDER if m in RULES]
    return ordered + [m for m in RULES if m not in ordered]


def _shape(rule: Rule, row: dict | None) -> dict:
    """One rule's payload. `set_by` is the raw `public.users.user_id` and is
    NOT for rendering — `routers/compliance_settings.py` swaps it for a name
    before it leaves the process, because a member id is never drawn
    (`frontend/scripts/check-rendered-ids.mjs`). It stays here because the
    router needs something to look the name up BY."""
    return {
        "label": rule.label,
        "consequence": rule.consequence,
        "state": row["state"] if row else DEFAULT_STATE,
        "default_state": DEFAULT_STATE,
        # The two honesty fields. `wired` false means: this is a record of the
        # firm's position and the product does not act on it.
        "wired": rule.wired,
        "enforced_at": rule.enforced_at,
        "states": list(rule.states),
        "set_by": row["set_by"] if row else None,
        "set_at": row["set_at"].isoformat() if row and row["set_at"] else None,
        "reason": row["reason"] if row else None,
    }


async def resolve(pool, org_id: str, module: str) -> dict[str, dict]:
    """Every known rule for `module`, with its resolved state and the row
    that set it (if any). Unknown-to-the-registry rows are not returned —
    the registry, not the table, defines what a module's settings ARE."""
    known = rules_for(module)
    rows = await pool.fetch(
        "SELECT rule_key, state, set_by, set_at, reason "
        "FROM public.module_compliance_settings "
        "WHERE org_id=$1::uuid AND module=$2",
        org_id, module,
    )
    by_key = {r["rule_key"]: dict(r) for r in rows}
    return {key: _shape(rule, by_key.get(key)) for key, rule in known.items()}


async def resolve_all(pool, org_id: str) -> list[dict]:
    """Every module's settings in ONE round trip, for the settings screen.

    Not a loop over `resolve`: that is one query per module, and the screen
    wants all of them at once. The `module` column is filtered in Python
    against the registry rather than in SQL, because a stale row for a module
    that no longer has settings must be ignored the same way an unknown
    `rule_key` already is — the registry defines what exists, and a WHERE
    clause built from it would be a second place that decision lives.
    """
    rows = await pool.fetch(
        "SELECT module, rule_key, state, set_by, set_at, reason "
        "FROM public.module_compliance_settings WHERE org_id=$1::uuid",
        org_id,
    )
    by_module: dict[str, dict[str, dict]] = {}
    for r in rows:
        by_module.setdefault(r["module"], {})[r["rule_key"]] = dict(r)

    return [
        {
            "module": module,
            "rules": {
                key: _shape(rule, by_module.get(module, {}).get(key))
                for key, rule in RULES[module].items()
            },
        }
        for module in modules()
    ]


async def resolve_states(pool, org_id: str, module: str) -> dict[str, str]:
    """Just the state per rule_key — what enforcement call sites want,
    without the label/consequence text the settings screen needs."""
    full = await resolve(pool, org_id, module)
    return {k: v["state"] for k, v in full.items()}


async def set_rule(
    pool, org_id: str, module: str, rule_key: str, state: str,
    set_by: str, reason: str | None = None,
) -> dict:
    rule = rules_for(module).get(rule_key)
    if rule is None:
        raise ValueError(f"'{rule_key}' is not a compliance setting for {module}")
    if state not in STATES:
        raise ValueError(f"'{state}' is not a valid state. Valid: {', '.join(STATES)}")
    # THE REFUSAL THAT KEEPS THE REGISTRY HONEST. `enforced` means the firm
    # asked to be STOPPED from issuing a document that is short of something.
    # Accepting it for a rule no code reads would store exactly the promise
    # this module's docstring exists to prevent — a guardrail that is not
    # there, agreed to in writing by the customer. The screen does not offer
    # the state; this refuses it anyway, because the screen is not the only
    # thing that can call this.
    if state == "enforced" and not rule.wired:
        raise ValueError(
            f"'{rule_key}' cannot be enforced: nothing in {module} reads it "
            f"yet, so enforcing it would block nothing. Record it as "
            f"applicable or not applicable instead."
        )
    row = await pool.fetchrow(
        "INSERT INTO public.module_compliance_settings "
        "  (org_id, module, rule_key, state, set_by, set_at, reason) "
        "VALUES ($1::uuid, $2, $3, $4, $5, NOW(), $6) "
        "ON CONFLICT (org_id, module, rule_key) DO UPDATE SET "
        "  state=EXCLUDED.state, set_by=EXCLUDED.set_by, "
        "  set_at=NOW(), reason=EXCLUDED.reason "
        "RETURNING rule_key, state, set_by, set_at, reason",
        org_id, module, rule_key, state, set_by, reason,
    )
    return dict(row)
