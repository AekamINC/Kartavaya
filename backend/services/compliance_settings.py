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

#: Who a setting is about. `org` is the firm's default and every row written
#: before migration 253 is one. The other two are OVERRIDES — the owner's ask:
#: "if org, client asked to or remove gst, or employee negotiation on leave and
#: commission then it override default setting."
#:
#: A tuple, and checked in `set_rule`, so this list and the CHECK constraint
#: cannot drift into disagreeing about what a scope is.
SCOPES: tuple[str, ...] = ("org", "client", "employee")

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
        # ⚠ `scope_type='org'` IS LOAD-BEARING AS OF MIGRATION 253. Overrides
        # for a client or an employee live in this same table, so without this
        # predicate a single client's exception would be read as the firm-wide
        # default — and, with several overrides, WHICHEVER one the planner
        # returned first. The firm's default is the scope_type='org' row and
        # nothing else.
        "SELECT rule_key, state, set_by, set_at, reason "
        "FROM public.module_compliance_settings "
        "WHERE org_id=$1::uuid AND module=$2 AND scope_type='org'",
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
        # Same rule as `resolve` — the settings screen shows the firm's
        # defaults, and an override must not masquerade as one.
        "SELECT module, rule_key, state, set_by, set_at, reason "
        "FROM public.module_compliance_settings "
        "WHERE org_id=$1::uuid AND scope_type='org'",
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
    scope_type: str = "org", scope_id: str | None = None,
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
    if scope_type not in SCOPES:
        raise ValueError(f"'{scope_type}' is not a scope. Valid: {', '.join(SCOPES)}")
    if scope_type == "org" and scope_id:
        raise ValueError("The firm-wide default is not about one client or employee")
    if scope_type != "org" and not scope_id:
        raise ValueError(f"A {scope_type} override needs to say which {scope_type}")

    # ⚠ TWO STATEMENTS, BECAUSE THERE ARE TWO INDEXES.
    #
    # Migration 253 replaced the old `UNIQUE (org_id, module, rule_key)` with a
    # pair of PARTIAL unique indexes — one for the firm's default, one for the
    # overrides — because Postgres treats NULLs as distinct, so a single
    # four-column index would have silently allowed two org-level rows for the
    # same rule.
    #
    # An `ON CONFLICT` inference clause has to match a partial index INCLUDING
    # its predicate, and the two predicates differ. This is not cosmetic: the
    # old spelling, left alone after 253, matches no constraint at all and
    # every save 500s with "there is no unique or exclusion constraint matching
    # the ON CONFLICT specification". That is the shape CLAUDE.md warns about —
    # a router shipped without a test that executes its SQL — and it was live
    # for the few minutes between the migration and this edit.
    if scope_type == "org":
        row = await pool.fetchrow(
            "INSERT INTO public.module_compliance_settings "
            "  (org_id, module, rule_key, state, set_by, set_at, reason, "
            "   scope_type, scope_id) "
            "VALUES ($1::uuid, $2, $3, $4, $5, NOW(), $6, 'org', NULL) "
            "ON CONFLICT (org_id, module, rule_key) WHERE scope_type='org' "
            "DO UPDATE SET "
            "  state=EXCLUDED.state, set_by=EXCLUDED.set_by, "
            "  set_at=NOW(), reason=EXCLUDED.reason "
            "RETURNING rule_key, state, set_by, set_at, reason, "
            "          scope_type, scope_id",
            org_id, module, rule_key, state, set_by, reason,
        )
    else:
        row = await pool.fetchrow(
            "INSERT INTO public.module_compliance_settings "
            "  (org_id, module, rule_key, state, set_by, set_at, reason, "
            "   scope_type, scope_id) "
            "VALUES ($1::uuid, $2, $3, $4, $5, NOW(), $6, $7, $8::uuid) "
            "ON CONFLICT (org_id, module, rule_key, scope_type, scope_id) "
            "  WHERE scope_type <> 'org' "
            "DO UPDATE SET "
            "  state=EXCLUDED.state, set_by=EXCLUDED.set_by, "
            "  set_at=NOW(), reason=EXCLUDED.reason "
            "RETURNING rule_key, state, set_by, set_at, reason, "
            "          scope_type, scope_id",
            org_id, module, rule_key, state, set_by, reason,
            scope_type, scope_id,
        )
    out = dict(row)
    if out.get("scope_id") is not None:
        out["scope_id"] = str(out["scope_id"])
    return out


async def resolve_effective(
    pool, org_id: str, module: str,
    scope_type: str = "org", scope_id: str | None = None,
) -> dict[str, dict]:
    """The firm's default, this client's or employee's override, and the answer.

    ── WHY ALL THREE AND NOT JUST THE ANSWER ──────────────────────────────
    The screen this feeds shows a person WHY a setting is what it is. "GST is
    not applicable for this client" is a different sentence from "GST is not
    applicable at this firm", and an administrator looking at one client's page
    needs to know which of the two they are looking at before they change it —
    otherwise editing what looks like a client exception silently rewrites the
    firm's default for everybody.

    So each rule comes back as:

        default   the scope_type='org' row (or the registry's default)
        override  the client/employee row, or None
        state     what actually applies — the override if there is one
        source    'override' or 'default', so no caller has to infer it

    `source` is returned rather than left to be derived by comparing `state` to
    `default["state"]`: an override that happens to SET THE SAME VALUE as the
    default is still an override — somebody decided it deliberately, and the
    next person to change the firm default must not silently change this client
    too. Comparing values cannot see that difference; this can.

    Asking for scope 'org' returns defaults with no override, which is the same
    answer `resolve` gives. That is deliberate: one code path, so the screen
    does not need a special case for the firm's own page.
    """
    known = rules_for(module)
    defaults = await resolve(pool, org_id, module)

    if scope_type == "org" or not scope_id:
        return {
            key: {**shaped, "default": dict(shaped), "override": None,
                  "source": "default", "scope_type": "org", "scope_id": None}
            for key, shaped in defaults.items()
        }

    if scope_type not in SCOPES:
        raise ValueError(f"'{scope_type}' is not a scope")

    rows = await pool.fetch(
        # ⚠ `org_id` IS IN THE PREDICATE EVEN THOUGH `scope_id` IS A UUID.
        # A client id is unique table-wide, so filtering on it alone would read
        # another organisation's override for anybody who could guess one — the
        # leak PHASE-7 §7.1a closed in three other places, and the reason
        # `graha_territories` reads are org-scoped too.
        "SELECT rule_key, state, set_by, set_at, reason "
        "FROM public.module_compliance_settings "
        "WHERE org_id=$1::uuid AND module=$2 "
        "  AND scope_type=$3 AND scope_id=$4::uuid",
        org_id, module, scope_type, str(scope_id),
    )
    by_key = {r["rule_key"]: dict(r) for r in rows}

    out: dict[str, dict] = {}
    for key, rule in known.items():
        default = defaults[key]
        row = by_key.get(key)
        override = _shape(rule, row) if row else None
        effective = override or default
        out[key] = {
            **effective,
            "default": dict(default),
            "override": override,
            # Not derived by comparing states — see the docstring.
            "source": "override" if override else "default",
            "scope_type": scope_type,
            "scope_id": str(scope_id),
        }
    return out


async def clear_rule(
    pool, org_id: str, module: str, rule_key: str,
    scope_type: str, scope_id: str,
) -> bool:
    """Remove an override so the firm's default applies again.

    ⚠ ONLY EVER AN OVERRIDE. There is no way to delete the firm's default from
    here: `scope_type='org'` is refused rather than allowed to fall through to a
    DELETE that would silently reset a setting for every client at once. A
    default is CHANGED, by writing a new state; it is not removed.

    Returns whether a row was actually there, so a caller can tell "reverted to
    the default" from "there was nothing to revert" — the same distinction
    `_shape`'s `has_setter` makes, and for the same reason.
    """
    if scope_type == "org":
        raise ValueError(
            "The firm-wide default cannot be cleared, only changed. Set it to "
            "another state instead."
        )
    if scope_type not in SCOPES:
        raise ValueError(f"'{scope_type}' is not a scope")

    result = await pool.execute(
        "DELETE FROM public.module_compliance_settings "
        " WHERE org_id=$1::uuid AND module=$2 AND rule_key=$3 "
        "   AND scope_type=$4 AND scope_id=$5::uuid",
        org_id, module, rule_key, scope_type, str(scope_id),
    )
    return result.rsplit(" ", 1)[-1] != "0"
