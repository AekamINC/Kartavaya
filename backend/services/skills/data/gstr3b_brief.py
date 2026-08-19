"""
gstr3b_brief — the period's net cash tax payable, and what the figure rests on.

── It computes nothing of its own ────────────────────────────────────────────

Every number comes from `services/gst_period.assemble_gstr3b` and
`services/gstr3b_pdf.compute`, which are what the filing screen and the
generated PDF already use. That is the whole point of having extracted them: a
brief that disagreed with the document it summarises would be worse than no
brief, because the preparer cannot tell which one lied.

Verified against the live books for Aekam's 2026-07.

`compute` returns the per-head split under `set_off` and the rolled-up cash
figure as `total_cash` — NOT as `computed[head]`, which is None for every head.
That was the first thing this handler got wrong, and it is exactly the kind of
shape assumption that has been wrong all week; it is written down here so the
next reader does not have to rediscover it.

── Two caveats, both mandatory ──────────────────────────────────────────────

`assemble_gstr3b` deliberately EXCLUDES invoices it cannot account for — a line
with no HSN, most commonly — and records them under `held_back`. A brief that
reported only the totals would present a figure computed over an incomplete set
as if it were complete.

And seven 3B boxes are filled by the PREPARER on the filing screen rather than
derived from the books. A skill passes no overrides, so every one comes back
nil. Nil there is the absence of a measurement, not a measurement of nil.

── Read-only, and it is not a return ────────────────────────────────────────

This produces a note for a person. It does not file, does not build the filing
payload, and does not call the PDF generator.
"""
import logging

from services.skills.timeutil import return_period

log = logging.getLogger(__name__)

#: Boxes `assemble_gstr3b` fills from the PREPARER'S OVERRIDES, not from the
#: books. A skill passes no overrides — the adjustments on the filing screen are
#: a preparer's deliberate entries and are not a skill's to invent — so every one
#: of these comes back nil.
#:
#: Nil here is the absence of a measurement, not a measurement of nil. A preparer
#: who read this brief and signed believing otherwise would have signed for
#: something nobody checked, so the caveat is mandatory and the prompt repeats it.
PREPARER_ENTERED_BOXES = (
    "inward supplies liable to reverse charge (3.1(d))",
    "nil-rated and exempt outward supplies (3.1(c))",
    "non-GST outward supplies (3.1(e))",
    "import ITC on goods and services (4A(1), 4A(2))",
    "ITC reversals under rules 38, 42 and 43 (4B(1))",
    "ITC blocked under section 17(5)",
    "interest and late fee (5.1)",
)


async def brief_gstr3b_liability(pool, org_id: str, period: str | None = None) -> dict:
    """The GSTR-3B position for *period* ('YYYY-MM'), with its own caveats.

    *period* defaults to the previous month — GSTR-3B for August is due on
    20 September, so somebody opening this in September wants August. Before the
    default existed the dispatcher refused the run outright, because the
    signature declared a parameter with no default and nothing supplied it.
    See `services.skills.timeutil.return_period` for why this clock differs from
    the payroll one.

    Returns {period, due_date, payable, itc_used, turnover, held_back,
             checks, caveats}.
    """
    period = period or return_period()
    try:
        int(period[:4]), int(period[5:7])
        if len(period) != 7 or period[4] != "-":
            raise ValueError
    except (ValueError, TypeError, IndexError):
        return {"error": f"'{period}' is not a period. Expected YYYY-MM, e.g. 2026-07."}

    # Imported here, not at module scope: `gst_period` pulls in pydantic and the
    # org loader, and a skill module is imported by the registry at startup.
    from services.gst_period import Gstr3bOverrides, assemble_gstr3b, prefiling_checks
    from services.gstr3b_pdf import compute, statutory_due_date

    # No overrides. A skill reports what the books say; the adjustments on the
    # filing screen are a preparer's deliberate entries and are not a skill's to
    # invent.
    gstr, org = await assemble_gstr3b(pool, org_id, period, Gstr3bOverrides())
    checks = await prefiling_checks(pool, org_id, period, gstr, org)

    computed = compute(gstr)

    # `compute` returns the per-head split under `set_off`, and the rolled-up
    # cash figure — which includes interest and late fee — as `total_cash`.
    # Reading `computed[head]` directly returns None for every head.
    set_off = computed.get("set_off") or {}
    heads = ("igst", "cgst", "sgst", "cess")

    def _head(head: str, key: str) -> float:
        return float((set_off.get(head) or {}).get(key, 0) or 0)

    payable = {h: _head(h, "in_cash") for h in heads}
    itc_used = {h: _head(h, "via_itc") for h in heads}

    held_back = gstr.get("held_back") or []
    blocking = [c for c in checks if c.get("severity") == "blocking"]

    out = {
        "period": period,
        "due_date": statutory_due_date(period),
        "due_date_basis": "monthly filer; nothing in this system records a QRMP election",
        "payable_in_cash": payable,
        # `total_cash` rather than the sum of the heads: it also carries interest
        # and late fee, which is what actually has to be paid.
        "payable_in_cash_total": round(float(computed.get("total_cash", 0) or 0), 2),
        "settled_from_itc": itc_used,
        "net_itc_available": computed.get("net_itc") or {},
        "outward_taxable": gstr.get("outward_taxable") or {},
        "outward_zero_rated": gstr.get("outward_zero_rated") or {},
        "invoices_counted": gstr.get("outward_count"),
        "vendor_bills_counted": gstr.get("inward_count"),
        "held_back": held_back,
        "checks": checks,
        "caveats": [
            "These figures come from the books alone. "
            f"{len(PREPARER_ENTERED_BOXES)} boxes are filled by the preparer on the "
            f"filing screen and are therefore nil here — nil meaning not entered, "
            f"not measured as zero: " + "; ".join(PREPARER_ENTERED_BOXES) + ".",
        ],
    }

    if held_back:
        out["caveats"].insert(0, (
            f"{len(held_back)} invoice(s) were EXCLUDED from these totals because "
            f"they could not be accounted for. The figures are computed over an "
            f"incomplete set until those are fixed."
        ))
    if blocking:
        out["caveats"].insert(0, (
            f"{len(blocking)} blocking pre-filing issue(s) found. The return "
            f"should not be filed until they are resolved."
        ))
    return out
