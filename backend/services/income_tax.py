"""income_tax.py — the income-tax slab ladder, resolved at a date.

Phase 5.2b. `routers/vetana.py` carried two literal ladders, and
`tests/test_payroll_reads_the_dated_law.py` recorded why they had to: of the
thirteen `tds.*` keys in `staging.statute_calendar`, every one is a statement,
a certificate or a deposit DATE. **The slab ladder was not in that table at
all**, so there was nowhere to read it from. This module and
`migrations/230_income_tax_slabs.sql` are that somewhere. (Cited as 228 until
2026-08-27 — 228 is `228_epf_rates_are_dated_law.sql`; this file was renumbered
on the way in and the docstring did not follow.)

── ONE ROW PER BAND, WHICH IS THE OWNER'S DECISION AND NOT A SHORTCUT ───────

Owner, 2026-08-26: *"do one row per band, and if it needs more it can be done
via settings."* So a band is a row, exactly as professional tax already models
one, and NOT a JSON ladder in a single row.

The reason that is right rather than merely simple: the PT ladder shipped in
Phase 2 already proves the shape end to end. It has a resolution order that
falls back and never refuses, a settings screen, and shared rows everybody
reads and nobody edits. A second, differently-shaped ladder would be a SECOND
RESOLUTION RULE — and a second resolution rule is precisely how two surfaces
come to disagree about what the law was.

── THE ONE PLACE THIS DEPARTS FROM PT, AND IT IS A REAL DIFFERENCE ──────────

Professional tax picks ONE band and charges its rupee figure. Income tax
SLICES: every band below the taxpayer's income contributes. So:

  · PT resolves per band — `_pt_from_slabs` ranks rows and returns the winner.
    Income tax resolves per GENERATION — you need every band of one ladder, and
    mixing FY 2024-25's ₹7,00,000 step with FY 2025-26's ₹8,00,000 one would
    produce a number no Finance Act has ever authorised. `_generation` below is
    PT's rank order lifted from "pick one row" to "pick one ladder".

  · PT's `slab_from` is INCLUSIVE and its bands leave paise gaps
    (15000.00 / 15000.01), because containment is the question. HERE THE
    BOUNDS ARE CONTIGUOUS THRESHOLDS: `slab_from` is the figure the rate
    applies ABOVE and `slab_to` the figure it applies UP TO, so each band's
    `slab_from` equals its predecessor's `slab_to`. That is how the statute
    itself words it — the Department's own table reads "5% above ₹4,00,000" —
    and it is what makes the arithmetic exact instead of a rupee short. A band
    typed as 4,00,001 from a newspaper table would under-tax by ₹1 of base;
    the settings screen therefore labels the fields "above" and "up to".

── IT MUST NEVER REFUSE, AND IT MUST NEVER FALL BACK TO A LITERAL ───────────

Two rules, and the second is the one this phase exists to hold.

1. AN ABSENT LADDER DEDUCTS ₹0. No rows, an unparseable rate, a regime nobody
   seeded, an unreachable database — every one of them is 0.00 and the payroll
   run continues. That is the same answer an absent PT slab gets and the same
   owner decision behind it: refusing to pay somebody because a rate is missing
   is a worse fault than the one being fixed.

2. THERE IS NO LITERAL TO FALL BACK TO, ON PURPOSE. `_esi_ceiling` in
   `routers/vetana.py` returns None when the store cannot answer and the caller
   keeps the statutory 21,000 — correct there, because "no ceiling" would WIDEN
   a deduction. The asymmetry does not carry over. A missing income-tax ladder
   that silently reverted to a compiled-in one would apply the WRONG YEAR'S LAW
   and look perfectly correct on the payslip, which is exactly the failure this
   table removes. So `annual_tax([], x)` and `annual_tax(None, x)` are both
   0.0, there is no third argument that changes that, and no ladder is written
   down anywhere in this file.

── WHAT THIS MODULE DOES NOT DO ────────────────────────────────────────────

It computes the SLAB TAX on an annual taxable figure and nothing else. The
section 87A rebate, the 4% health-and-education cess, surcharge, the standard
deduction, and the senior/super-senior exemption limits are NOT bands, are not
in the table, and are not applied here. None of them was in the literal ladder
either, so nothing regresses — but a band ladder alone is not the tax, and
`migrations/230_income_tax_slabs.sql` records each of them as owed with its
figure and source. Do not quietly add one of them to this file: a rebate
expressed as a band is a rebate no auditor can find.

── HOW `routers/vetana.py` CALLS THIS ──────────────────────────────────────

Once per run, then once per employee, mirroring `_pt_slabs`/`_pt_from_slabs`:

    from services import income_tax

    # once per run, at the period end that dates the law
    it_ladders = await income_tax.ladders(pool, org_id, month_end)

    # once per employee, inside _compute_statutory
    bands = income_tax.ladder_for(it_ladders, structure.get("tds_regime"))
    tax, workings = income_tax.annual_tax(bands, annual_taxable)
    tds = income_tax.monthly_tds(bands, annual_taxable)

`workings` is band-by-band and belongs in the payslip's `statutory_treatment`,
for the same reason `pt_slab` is already there: a deduction an employee
disputes must be answerable from the payslip, not from a re-run.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Iterable, Mapping, Sequence

log = logging.getLogger(__name__)

#: The two regimes the product knows, lower-cased and canonical. Matches
#: `vetana_salary_structures.tds_regime`, whose live values are exactly these
#: two (measured 2026-08-27: E2E 30 'new' / 30 'old', Unicode 25 'new' / 7
#: 'old'), and `pay_income_tax_slabs_regime_ck` in migration 228.
REGIMES: tuple[str, ...] = ("new", "old")

#: What an unset `tds_regime` means. `routers/vetana.py` already reads
#: `str(structure.get("tds_regime") or "new")` when it stamps the payslip's
#: treatment blob, and the Finance Act 2023 made the new regime the DEFAULT
#: from AY 2024-25. Same answer in both places, written once.
DEFAULT_REGIME = "new"

#: Every column a caller may read. Listed rather than `SELECT *` so that a
#: column added by 228's successor cannot silently change what callers receive
#: — the rule `services/statute.py` states for the same reason.
_COLS: tuple[str, ...] = (
    "regime", "slab_from", "slab_to", "rate_percent", "effective_from",
    "assessment_year", "source_ref",
)

#: Schema-qualified, always. `search_path` on this database is
#: `"$user", public, extensions`, so an unqualified name resolves to nothing —
#: and a shadow table in `public` has bitten this repo before (migration 142).
_SELECT = (
    f"SELECT {', '.join(_COLS)}, (org_id IS NOT NULL) AS is_own "
    "  FROM staging.pay_income_tax_slabs "
    #  A NULL `org_id` IS A SHARED LADDER, NOT A ROW TO IGNORE — the same
    #  reading `_pt_slabs` gives the same nullable column, and for the same
    #  reason: a Finance Act ladder is national reference data, seeded once,
    #  read by everybody. An org that enters its own bands outranks it
    #  wholesale (see `_generation`).
    " WHERE (org_id = $1::uuid OR org_id IS NULL) "
    #  Rows dated in the future are excluded so that RE-RUNNING AN OLD MONTH
    #  USES THE LADDER THAT APPLIED TO IT. This is the whole acceptance test
    #  of 5.2b, and it is one line of SQL. A NULL `effective_from` is admitted
    #  because the column is nullable and a band nobody dated is still a band
    #  somebody entered.
    "   AND (effective_from IS NULL OR effective_from <= $2::date) "
    " ORDER BY regime, effective_from, slab_from"
)


# ── reading ─────────────────────────────────────────────────────────────────

async def ladders(pool, org_id: str, as_at: date) -> dict[str, list[dict]]:
    """Every regime's ladder as it stood at `as_at`, already narrowed.

    Returns `{regime: [band, ...]}` — one generation per regime, bands ordered
    by `slab_from`. A regime with no rows is simply ABSENT from the dict, and
    `ladder_for` turns that into `[]`, which `annual_tax` turns into ₹0.

    `as_at` IS MANDATORY AND HAS NO DEFAULT, for the reason `services/statute.py`
    gives at length: a default of "today" would hand a May re-run of a March
    payslip the wrong financial year's law and look right doing it. Pass the
    period end of the run.

    NEVER RAISES. A payroll run must not stop because a reference table is
    unreadable; an unreachable ladder is an empty one, and an empty one is ₹0.
    """
    try:
        rows = await pool.fetch(_SELECT, org_id, as_at)
    except Exception:                                          # noqa: BLE001
        log.warning(
            "the income-tax ladder could not be read for org %s at %s; every "
            "band resolves empty and the run deducts no TDS", org_id, as_at,
            exc_info=True)
        return {}
    # Grouped on the STORED value, lower-cased and nothing else. `_norm_regime`
    # is deliberately not used here: it answers "what did the caller mean",
    # which folds an unset value onto the default — right for a salary
    # structure, wrong for a stored band, where an unrecognised regime must
    # stay its own group and simply never be asked for.
    out: dict[str, list[dict]] = {}
    stored = {str(r["regime"] or "").strip().lower() for r in rows}
    for regime in stored:
        if regime not in REGIMES:
            continue
        generation = _generation(
            [r for r in rows
             if str(r["regime"] or "").strip().lower() == regime])
        if generation:
            out[regime] = generation
    return out


def ladder_for(by_regime: Mapping[str, Sequence[dict]] | None,
               regime: Any) -> list[dict]:
    """The bands for one regime — `[]` when there are none.

    THREE CASES, AND THE MIDDLE ONE IS THE TRAP:

      · `'old'` / `'new'`  — that regime's ladder.
      · NULL, `''`, absent — `DEFAULT_REGIME`. An unanswered column is not a
        misconfiguration: `routers/vetana.py` already reads
        `str(structure.get("tds_regime") or "new")` when it stamps the
        payslip, and the Finance Act 2023 made the new regime the default
        from AY 2024-25. Same answer in both places.
      · Anything else — `[]`. A MISSPELLED regime must NOT become 'new'. It
        would tax somebody under a regime they did not choose, and it would
        look correct, which is worse than deducting nothing and being asked
        why.
    """
    if not by_regime:
        return []
    name = _norm_regime(regime)
    if name is None:
        log.warning("no income-tax ladder for regime %r; deducting nothing",
                    regime)
        return []
    bands = by_regime.get(name)
    return list(bands) if bands else []


# ── arithmetic ──────────────────────────────────────────────────────────────

def annual_tax(bands: Iterable[Mapping] | None,
               annual_taxable: float) -> tuple[float, list[dict]]:
    """(annual slab tax, the band-by-band workings) — or (0.0, []).

    Progressive and MARGINAL: every band below the figure contributes its own
    slice. `slab_from` is the threshold the rate applies above, `slab_to` the
    threshold it applies up to, so a band's taxed slice is
    `min(income, slab_to) - slab_from` and no rupee is counted twice.

    TWO DEFECTS IN THE DATA ARE ABSORBED RATHER THAN RAISED, because a ladder
    an administrator is halfway through editing must not stop a payroll run:

      · OVERLAPPING BANDS CANNOT DOUBLE-TAX. Each band's lower edge is clamped
        to the highest edge already consumed (`cursor`), so two bands that both
        claim ₹8–12 lakh charge that slice once, at the first band's rate,
        rather than twice. Double-charging is the worse failure of the two and
        it is the one the clamp removes.
      · A GAP IS SIMPLY UNTAXED. The slice nobody claimed attracts nothing.

    Neither is silent: `gaps_and_overlaps` reports both, and the settings screen
    shows them, so the ladder can be repaired without a run ever refusing.

    An unreadable band — a rate that will not parse, a missing column — is
    SKIPPED, not fatal, exactly as `_pt_from_slabs` skips one.
    """
    workings: list[dict] = []
    if not bands:
        return 0.0, workings
    try:
        income = float(annual_taxable or 0)
    except (TypeError, ValueError):
        return 0.0, workings
    if income <= 0:
        return 0.0, workings

    total = 0.0
    cursor = 0.0
    for row in sorted(_readable(bands), key=lambda b: b["from"]):
        low = max(row["from"], cursor)
        high = income if row["to"] is None else min(income, row["to"])
        if high <= low:
            # Wholly above the taxpayer's income, or wholly consumed by an
            # overlapping band already counted. Either way it contributes
            # nothing, and `cursor` is by construction already past it —
            # recording it would put empty rows on a payslip.
            continue
        slice_amount = high - low
        slice_tax = slice_amount * row["rate"] / 100.0
        total += slice_tax
        cursor = high
        workings.append({
            "slab_from": low,
            "slab_to": row["to"],
            "rate_percent": row["rate"],
            "taxable_in_band": round(slice_amount, 2),
            "tax_in_band": round(slice_tax, 2),
            "effective_from": (None if row["effective_from"] is None
                               else str(row["effective_from"])),
            "assessment_year": row["assessment_year"],
        })
        if row["to"] is None or income <= row["to"]:
            break
    return round(total, 2), workings


def monthly_tds(bands: Iterable[Mapping] | None,
                annual_taxable: float) -> float:
    """The annual slab tax spread over twelve months, rounded to paise.

    The same `/12` `routers/vetana.py` already applies, written here so the
    call site does not have to re-derive it — and so that "no ladder" is 0.00
    on this path too rather than a division somebody has to remember to guard.
    """
    return round(annual_tax(bands, annual_taxable)[0] / 12.0, 2)


def gaps_and_overlaps(bands: Iterable[Mapping] | None) -> list[dict]:
    """Every place a ladder does not join up. ADVISORY — never a refusal.

    A gap silently untaxes a slice and an overlap would double-tax one were the
    clamp in `annual_tax` not there. Both are worth telling an administrator
    about at the moment they are looking at the ladder; neither may ever stop a
    payroll run, which is why this returns a list instead of raising.
    """
    out: list[dict] = []
    rows = sorted(_readable(bands or []), key=lambda b: b["from"])
    if not rows:
        return out
    if rows[0]["from"] > 0:
        out.append({"kind": "gap", "from": 0.0, "to": rows[0]["from"]})
    for prev, nxt in zip(rows, rows[1:]):
        if prev["to"] is None:
            out.append({"kind": "unreachable", "from": nxt["from"],
                        "to": nxt["to"]})
            continue
        if nxt["from"] > prev["to"]:
            out.append({"kind": "gap", "from": prev["to"], "to": nxt["from"]})
        elif nxt["from"] < prev["to"]:
            out.append({"kind": "overlap", "from": nxt["from"],
                        "to": prev["to"]})
    if rows[-1]["to"] is not None:
        out.append({"kind": "capped", "from": rows[-1]["to"], "to": None})
    return out


# ── internals ───────────────────────────────────────────────────────────────

def _norm_regime(value: Any) -> str | None:
    """`'NEW '` → `'new'`; `None`/`''` → `DEFAULT_REGIME`; anything else → None.

    The three-way answer is the point — see `ladder_for`. An UNANSWERED regime
    and a MISSPELLED one are different facts and must not collapse onto the
    same default.
    """
    text = str(value if value is not None else "").strip().lower()
    if not text:
        return DEFAULT_REGIME
    return text if text in REGIMES else None


def _generation(rows: Sequence[Mapping]) -> list[dict]:
    """The ONE ladder in force, out of every band the query returned.

    PT's rank order, lifted from a row to a generation:

        org's own ladder  ->  the shared ladder  ->  nothing (₹0)

    and within the winning scope, the LATEST `effective_from` present. An
    organisation that has entered its own bands has said something more
    specific than the national default, so a later-dated shared row must not
    overrule it — the same rule `_pt_from_slabs` states for `is_own`.

    Selecting a whole generation rather than ranking band by band is the point:
    mixing FY 2024-25's ₹7,00,000 step with FY 2025-26's ₹8,00,000 one would
    produce a ladder no Finance Act has ever enacted, and every band of it
    would look individually defensible.
    """
    own = [r for r in rows if r.get("is_own")]
    scope = own if own else [r for r in rows if not r.get("is_own")]
    if not scope:
        return []
    latest = max((r["effective_from"] or date.min) for r in scope)
    return [dict(r) for r in sorted(
        (r for r in scope if (r["effective_from"] or date.min) == latest),
        key=lambda r: float(r["slab_from"] or 0))]


def _readable(bands: Iterable[Mapping]) -> list[dict]:
    """Bands whose bounds and rate all parse, normalised to floats.

    EVERY FIELD IS READ HERE, INSIDE THE GUARD — the fix `_pt_from_slabs`
    carries in its own comment. Reading a rate after the loop meant an
    unparseable row could win the ranking and then contribute 0.00, shadowing
    a perfectly good band. A row that leaves this function is known to carry
    everything the arithmetic needs.
    """
    out: list[dict] = []
    for row in bands:
        try:
            low = float(row["slab_from"] if row["slab_from"] is not None else 0)
            high = (None if row["slab_to"] is None else float(row["slab_to"]))
            rate = float(row["rate_percent"] or 0)
            if low < 0 or (high is not None and high <= low) or rate < 0:
                continue
            out.append({
                "from": low,
                "to": high,
                "rate": rate,
                "effective_from": row.get("effective_from"),
                "assessment_year": row.get("assessment_year"),
            })
        except (KeyError, TypeError, ValueError):
            # Skipped, never fatal. See `_pt_from_slabs` for the same choice.
            continue
    return out
