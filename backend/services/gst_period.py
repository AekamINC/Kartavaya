"""
gst_period.py — the GSTR-3B working paper, and what would stop it being filed.

Lifted verbatim out of `routers/documents.py`, which is where it was written and
where it must no longer live alone. Two reasons, and the second is the one that
forced the move:

  · A skill handler cannot import from a router. `routers/documents.py` pulls in
    `Depends`, `get_org_id`, the module gate and every other route in the file,
    all of which execute at import time for a caller that has no request.
  · Copy-pasting the bodies would give two implementations of Table 3.1. The
    docstring on `assemble_gstr3b` already records why that is unacceptable: a
    filing screen that disagrees with the document it generates is worse than a
    screen with no figures, because the preparer cannot tell which one lied. The
    same argument applies with equal force to a third reader — the skill.

So the router imports these back under their original private names, every one
of its call sites is unchanged, and there remains exactly ONE implementation of
the return. Nothing about the figures changed in this move; the bodies are
byte-identical to what was there.

`load_org` came with them because `assemble_gstr3b` calls it, and it has nine
other callers in the router that now import it back too.

One honest wart: `period_bounds` raises `HTTPException(400)` and has been left
doing so, because two router call sites depend on that 400 and this move was
meant to relocate code, not change a live filing path's behaviour. It is the one
router-shaped function here. `assemble_gstr3b` and `prefiling_checks` — the two
a skill actually calls — raise nothing, which is what matters for this move; a
skill that called `period_bounds` would get a 500 for a bad period, so it does
its own parsing instead (`services/skills/data/gst_readiness.py`).
"""
import json
from datetime import date, datetime

from fastapi import HTTPException
from pydantic import BaseModel, Field


#: The org columns every letterhead needs.
#:
#: `tan` IS here now. The note that used to sit on this line said no such column
#: existed and read it from `settings` instead — that was stale:
#: `staging.organisations.tan` is a `character varying` column and has been for
#: some time, with nothing wired to it. The consequence was that the TDS challan
#: refused for want of a TAN and pointed the user at a Company Profile screen
#: that had no TAN field, so the challan could never be issued at all.
#:
#: `settings` is still selected and still consulted as a fallback below, so an
#: org that stored a TAN there before the column was wired keeps working.
_ORG_COLS = (
    "name, gstin, pan, tan, billing_address, logo_url, logo_key, email, phone, website, "
    "bank_details, invoice_note, settings, "
    "COALESCE(authorized_signatory_name, '') AS authorized_signatory_name, "
    "COALESCE(authorized_signatory_designation, '') AS authorized_signatory_designation"
)


async def load_org(pool, org_id: str) -> dict:
    """The org, with its JSONB columns parsed and its logo signed.

    Identical handling to `ganit.download_invoice_pdf`: asyncpg hands JSONB back
    as a string on some paths, and `logo_key` needs signing because a bare R2
    URL is not fetchable.
    """
    row = await pool.fetchrow(
        f"SELECT {_ORG_COLS} FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    org = dict(row) if row else {}
    for field in ("billing_address", "bank_details", "settings"):
        if isinstance(org.get(field), str):
            try:
                org[field] = json.loads(org[field] or "{}")
            except json.JSONDecodeError:
                org[field] = {}

    # The column wins; `settings.tan` is the fallback for orgs that stored one
    # there while the column was unwired. Either way the validator still blocks
    # when it is absent rather than letting the document invent a TAN.
    settings = org.get("settings") or {}
    if org.get("tan"):
        org["tan"] = str(org["tan"]).strip().upper()
    elif isinstance(settings, dict) and settings.get("tan"):
        org["tan"] = str(settings["tan"]).strip().upper()

    if org.get("logo_key"):
        from services.storage import sign_key
        org["logo_url"] = await sign_key(org_id, org["logo_key"]) or org.get("logo_url", "")
    return org


class Gstr3bOverrides(BaseModel):
    """The rows Kartavaya has no columns for.

    Each defaults to nil and each is stated on the face of the document, so a
    firm that leaves them empty gets a paper that visibly reports nil rather
    than one that quietly omits the row. See `PROPOSED_documents.sql`.

    Every Table 4 row of the notified form is reachable from here. None of them
    needs a new DB column: like the three that came before, they are figures a
    preparer ascertains (imports, ISD credit, reversals, reclaims) and which no
    table in Kartavaya records. `PROPOSED_documents.sql` section 3 is the place
    that would change if that stopped being true.
    """

    outward_nil_exempt: dict = Field(default_factory=dict)
    outward_non_gst: dict = Field(default_factory=dict)
    inward_reverse_charge: dict = Field(default_factory=dict)
    # Table 4(A) — availment. `itc_all_other` (4(A)(5)) is derived from
    # `ganit_vendor_bills` below and is deliberately not an override.
    itc_import_goods: dict = Field(default_factory=dict)          # 4(A)(1)
    itc_import_services: dict = Field(default_factory=dict)       # 4(A)(2)
    itc_reverse_charge: dict = Field(default_factory=dict)        # 4(A)(3)
    itc_isd: dict = Field(default_factory=dict)                   # 4(A)(4)
    # Table 4(B) — reversal. `itc_reversed` and `itc_blocked_17_5` are two
    # inputs to the ONE row the form prints at 4(B)(1).
    itc_reversed: dict = Field(default_factory=dict)              # 4(B)(1), rules 38/42/43
    itc_blocked_17_5: dict = Field(default_factory=dict)          # 4(B)(1), section 17(5)
    itc_reversed_other: dict = Field(default_factory=dict)        # 4(B)(2)
    # Table 4(D) — disclosure only. Neither figure changes Net ITC at 4(C).
    itc_reclaimed: dict = Field(default_factory=dict)             # 4(D)(1)
    itc_ineligible_16_4_pos: dict = Field(default_factory=dict)   # 4(D)(2)
    # DEPRECATED spelling of `itc_blocked_17_5`, kept because a caller that
    # still sends it means section 17(5) blocked credit and Pydantic would
    # otherwise DROP the field silently — losing a reversal is the one failure
    # mode worse than reporting it in the old place. It is resolved below, not
    # re-read as the new 4(D)(2).
    itc_ineligible: dict = Field(default_factory=dict)
    interest: float = 0
    late_fee: float = 0
    gstr2b_date: str = ""
    prepared_by: str = ""
    notes: list[str] = Field(default_factory=list)


def period_bounds(period: str) -> tuple[str, str]:
    """`2026-07` → the half-open range `['2026-07-01', '2026-08-01')`.

    Half-open so an invoice dated the last of the month is inside and one dated
    the first of the next is not, with no leap-year or 31-day special cases.

    Returns STRINGS, and callers must bind them as `$n::text::date` rather than
    `$n::date`. A bare `::date` makes Postgres describe the parameter as `date`,
    so asyncpg calls `.toordinal()` on the value and a str raises DataError —
    the cast that looks like it converts the string is what stops it arriving.
    `_build_tally` also passes these straight into the Tally XML, so they stay
    strings rather than becoming `date` objects for the query's benefit.
    """
    try:
        datetime.strptime(period, "%Y-%m")
    except (ValueError, TypeError):
        raise HTTPException(400, "period must be YYYY-MM")
    year, month = int(period[:4]), int(period[5:7])
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return f"{period}-01", end.isoformat()


async def assemble_gstr3b(
    pool, org_id: str, period: str, overrides: "Gstr3bOverrides"
) -> tuple[dict, dict]:
    """Build the GSTR-3B working-paper dict, and load the org alongside it.

    Extracted from `download_gstr3b_pdf` so the JSON sibling below reports the
    SAME figures the PDF prints. Two implementations of Table 3.1 would drift,
    and a filing screen that disagrees with the document it generates is worse
    than a screen with no figures — the preparer cannot tell which one lied.
    """
    start = f"{period}-01"
    py, pm = int(period[:4]), int(period[5:7])
    end_exclusive = date(py + 1, 1, 1) if pm == 12 else date(py, pm + 1, 1)

    # ── WHY `doc_status <> 'draft'` IS HERE, AND WHAT IT COST TO LEAVE OUT ──
    # A draft invoice is a document that has NOT been issued to anybody. It was
    # counted in outward supply here — and this function is behind the GSTR-3B
    # filing SCREEN and the GSTR-3B PDF, not a preview — so the tax on unissued
    # documents was tax a preparer pays in CASH. Measured live 2026-08-22:
    # 102 drafts, Rs1.00cr taxable, Rs17.96L of tax.
    #
    # `gst_readiness` (the GSTR-1 side, services/skills/data/gst_readiness.py)
    # has always excluded drafts. The two builders therefore reported different
    # populations of the same table to the same preparer on the same screen,
    # 27 vs 30 invoices in the seeded org every month, and
    # `tests/test_gst_builders_agree.py` pinned that divergence as a strict
    # xfail rather than choosing a side. This is the reconciliation, made
    # towards the readiness builder because that is the direction that stops
    # money going out: a document nobody has been issued is not a supply.
    #
    # `COALESCE(doc_status, '')` and not `doc_status <> 'draft'`: the column is
    # nullable and NULL <> 'draft' is NULL, which would drop every invoice that
    # predates the column — the same shape of bug in the opposite direction.
    #
    # `payment_status <> 'cancelled'` came with it, and it was NOT in the
    # original report. Reconciling the two builders surfaced it: cancellation
    # has TWO channels in this table — `cancelled_at`, which this query has
    # always honoured, and `payment_status='cancelled'`, which it had never
    # heard of. `gst_readiness` honours both. A row cancelled through the second
    # channel alone was outward supply on the filing screen and struck off on
    # the readiness screen, in the same session, for the same month.
    #
    # The identical pair of predicates is repeated on the two pre-filing check
    # queries below, deliberately: a check that flags a GSTIN or a missing place
    # of supply on an invoice the return does not contain sends a preparer to
    # fix a row that was never at issue.
    invoices = await pool.fetch(
        "SELECT invoice_number, invoice_type, is_igst, is_export, line_items, "
        "subtotal, cgst, sgst, igst, cess, total "
        "FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND is_active AND cancelled_at IS NULL "
        "AND COALESCE(doc_status, '') <> 'draft' "
        "AND COALESCE(payment_status, '') <> 'cancelled' "
        "AND invoice_type IN ('tax_invoice','credit_note','debit_note') "
        "AND invoice_date >= $2::text::date AND invoice_date < $3::text::date",
        org_id, start, end_exclusive.isoformat(),
    )

    def _f(value) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    taxable = {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0, "cess": 0.0}
    zero_rated = {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0, "cess": 0.0}
    held_back: list[dict] = []
    counted = 0

    for inv in invoices:
        lines = inv["line_items"]
        if isinstance(lines, str):
            try:
                lines = json.loads(lines or "[]")
            except json.JSONDecodeError:
                lines = []
        # Rule 46(g): every line needs an HSN or SAC. An invoice missing one is
        # held back rather than silently included — the same rule
        # `validate_tax_invoice` applies when it refuses to render one.
        if not lines or any(
            not str((li or {}).get("hsn_code") or "").strip()
            and not str((li or {}).get("sac_code") or "").strip()
            for li in lines
        ):
            held_back.append({
                "party": inv["invoice_number"] or "an unnumbered invoice",
                "reason": "HSN/SAC code missing on a line",
                "itc": 0,
            })
            continue

        counted += 1
        # A credit note reduces the outward supply and its tax; it is netted off
        # rather than reported as a separate row, which is what 3.1 expects.
        sign = -1 if (inv["invoice_type"] or "") == "credit_note" else 1
        bucket = zero_rated if inv["is_export"] else taxable
        bucket["taxable"] += sign * _f(inv["subtotal"])
        bucket["igst"] += sign * _f(inv["igst"])
        bucket["cgst"] += sign * _f(inv["cgst"])
        bucket["sgst"] += sign * _f(inv["sgst"])
        bucket["cess"] += sign * _f(inv["cess"])

    bills = await pool.fetch(
        "SELECT COALESCE(SUM(igst),0) AS igst, COALESCE(SUM(cgst),0) AS cgst, "
        "COALESCE(SUM(sgst),0) AS sgst, COUNT(*) AS n "
        "FROM staging.ganit_vendor_bills "
        "WHERE org_id=$1::uuid AND is_active "
        "AND bill_date >= $2::text::date AND bill_date < $3::text::date",
        org_id, start, end_exclusive.isoformat(),
    )
    bill_row = dict(bills[0]) if bills else {"igst": 0, "cgst": 0, "sgst": 0, "n": 0}

    org = await load_org(pool, org_id)
    state = ""
    addr = org.get("billing_address") or {}
    if isinstance(addr, dict) and addr.get("state"):
        state = str(addr["state"])

    gstr = {
        "period": period,
        "outward_taxable": taxable,
        "outward_zero_rated": zero_rated,
        "outward_nil_exempt": overrides.outward_nil_exempt,
        "inward_reverse_charge": overrides.inward_reverse_charge,
        "outward_non_gst": overrides.outward_non_gst,
        "itc_import_goods": overrides.itc_import_goods,
        "itc_import_services": overrides.itc_import_services,
        "itc_reverse_charge": overrides.itc_reverse_charge,
        "itc_isd": overrides.itc_isd,
        # `ganit_vendor_bills` has no `cess` column, so inward cess credit is
        # not derivable and is left nil rather than guessed.
        "itc_all_other": {
            "igst": _f(bill_row["igst"]), "cgst": _f(bill_row["cgst"]),
            "sgst": _f(bill_row["sgst"]), "cess": 0,
        },
        "itc_reversed": overrides.itc_reversed,
        # The current key wins; the deprecated one is honoured with its original
        # meaning so an existing caller's section 17(5) figure still reverses.
        "itc_blocked_17_5": overrides.itc_blocked_17_5 or overrides.itc_ineligible,
        "itc_reversed_other": overrides.itc_reversed_other,
        "itc_reclaimed": overrides.itc_reclaimed,
        "itc_ineligible_16_4_pos": overrides.itc_ineligible_16_4_pos,
        "interest": overrides.interest,
        "late_fee": overrides.late_fee,
        "outward_count": counted,
        "inward_count": int(bill_row["n"] or 0),
        "gstr2b_date": overrides.gstr2b_date,
        "prepared_by": overrides.prepared_by,
        "prepared_on": date.today().isoformat(),
        "state_label": state,
        "held_back": held_back,
        "notes": overrides.notes,
    }
    return gstr, org


async def prefiling_checks(
    pool, org_id: str, period: str, gstr: dict, org: dict
) -> list[dict]:
    """What would stop this period being filed, computed — never illustrated.

    The design's pre-filing panel lists three findings. Two of them are real
    checks this codebase can actually make, so they are made here rather than
    hard-coded: a line with no HSN/SAC (rule 46(g), which is also why the
    working paper holds the invoice back) and a counterparty GSTIN that fails
    its own check digit. The third — place of supply — is reported as what the
    data says, not as the design's illustrative sentence.

    `severity` is 'blocking' where the working paper will visibly exclude or
    refuse, and 'info' where the figure still files but rests on a weaker
    assertion than the reader may assume.
    """
    from services.gstin import is_valid

    start = f"{period}-01"
    py, pm = int(period[:4]), int(period[5:7])
    end_exclusive = (date(py + 1, 1, 1) if pm == 12 else date(py, pm + 1, 1)).isoformat()

    checks: list[dict] = []

    if not str(org.get("gstin") or "").strip():
        checks.append({
            "code": "supplier_gstin_missing",
            "severity": "blocking",
            "title": "Your GSTIN is not on the organisation profile",
            "detail": "A GSTR-3B is filed against a registration. The working paper "
                      "will refuse until the GSTIN is set.",
            "fix": "Settings → Organisation profile",
            "items": [],
        })

    held = gstr.get("held_back") or []
    if held:
        checks.append({
            "code": "hsn_missing",
            "severity": "blocking",
            "title": f"HSN/SAC missing on {len(held)} "
                     f"{'invoice' if len(held) == 1 else 'invoices'}",
            "detail": "Rule 46(g) requires an HSN or SAC on every line. These "
                      "invoices are HELD BACK from the figures below and named on "
                      "the working paper — they are not silently included.",
            "fix": "Ganit → Invoices",
            "items": [str(h.get("party") or "") for h in held],
        })

    # Counterparty GSTINs. A number that fails its own check digit will be
    # rejected downstream and the recipient's credit refused, months later.
    #
    # ── THE JOIN IS ORG-SCOPED, AND IT WAS NOT ──────────────────────────────
    #
    # `JOIN staging.graha_contacts c ON c.id = i.contact_id` — on the id ALONE.
    # The foreign key is on the id alone too, so nothing but the query can scope
    # it, and an id-only join can surface ANOTHER PRACTICE'S CONTACT against
    # this practice's invoice. Migration 163 records the same fault being proved
    # live elsewhere in this schema, and `graha_clients` carries an identical
    # note; this is the ninth such join.
    #
    # It matters more here than in most places because of what the row feeds: a
    # GSTIN validity check on a GST RETURN. A leaked counterparty would put
    # another firm's customer into a filing worksheet, and a rejected GSTIN
    # surfaces months later as the recipient's input credit being refused.
    #
    # MEASURED BEFORE CHANGING IT, live 2026-08-23. The narrowing is a no-op on
    # today's data and a guard for ever after:
    #
    #   invoices whose contact belongs to another org      0
    #   contact ids shared by two orgs                     0
    #   distinct parties, join as written                 28
    #   distinct parties, join org-scoped                 28
    #
    # A narrowing can only ever REMOVE a cross-tenant row, never add one, so
    # the two counts agreeing is the whole verification: nothing legitimate is
    # lost, and the illegitimate case can no longer arrive.
    parties = await pool.fetch(
        "SELECT DISTINCT c.name, c.company, c.gstin "
        "FROM staging.ganit_invoices i "
        "JOIN staging.graha_contacts c "
        "  ON c.id = i.contact_id AND c.org_id = i.org_id "
        "WHERE i.org_id=$1::uuid AND i.is_active AND i.cancelled_at IS NULL "
        "AND COALESCE(i.doc_status, '') <> 'draft' "
        "AND COALESCE(i.payment_status, '') <> 'cancelled' "
        "AND i.invoice_type IN ('tax_invoice','credit_note','debit_note') "
        "AND i.invoice_date >= $2::text::date AND i.invoice_date < $3::text::date "
        "AND COALESCE(c.gstin, '') <> ''",
        org_id, start, end_exclusive,
    )
    bad = [
        f"{p['company'] or p['name'] or 'Unnamed party'} — {p['gstin']}"
        for p in parties if not is_valid(str(p["gstin"]))
    ]
    if bad:
        checks.append({
            "code": "counterparty_gstin_invalid",
            "severity": "blocking",
            "title": f"{len(bad)} counterparty {'GSTIN fails' if len(bad) == 1 else 'GSTINs fail'} the check digit",
            "detail": "A GSTIN carries its own checksum so a typo is catchable at "
                      "entry. Left as-is, the recipient's input tax credit is "
                      "refused — and that surfaces months after filing.",
            "fix": "Graha → Contacts",
            "items": bad,
        })

    # Place of supply. The column exists; where it is blank the CGST/SGST vs
    # IGST split rests on the `is_igst` flag alone, which nothing cross-checks.
    no_pos = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.ganit_invoices "
        "WHERE org_id=$1::uuid AND is_active AND cancelled_at IS NULL "
        "AND COALESCE(doc_status, '') <> 'draft' "
        "AND COALESCE(payment_status, '') <> 'cancelled' "
        "AND invoice_type IN ('tax_invoice','credit_note','debit_note') "
        "AND invoice_date >= $2::text::date AND invoice_date < $3::text::date "
        "AND COALESCE(place_of_supply, '') = ''",
        org_id, start, end_exclusive,
    ) or 0
    if no_pos:
        checks.append({
            "code": "place_of_supply_missing",
            "severity": "info",
            "title": f"Place of supply not recorded on {no_pos} "
                     f"{'invoice' if no_pos == 1 else 'invoices'}",
            "detail": "The inter-state/intra-state split for these rests on the "
                      "IGST flag alone. The figures still file; nothing "
                      "independently confirms the classification.",
            "fix": "Ganit → Invoices",
            "items": [],
        })

    return checks
