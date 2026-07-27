"""cost_report_pdf.py — Client-facing cost/usage report PDF (WeasyPrint).

Shows charged amounts (INR with markup), NOT raw USD costs.
Same design tokens as invoice_pdf.py and payslip_pdf.py.

Font contract
-------------
Both documents here are bilingual — an English heading beside its Devanagari
twin — and both are sent to a client. They therefore obey the same font
contract as the other eight generators, which `services/doc_fonts.py` owns:
the Devanagari face is VENDORED and declared with an explicit `@font-face`,
never left to whatever the base image's fontconfig happens to resolve.

Before this was wired up, `@font-face` was absent and no stack here named a
Devanagari family, so every Devanagari run fell through to DejaVu — which has
no Devanagari coverage — and `उपयोग एवं लागत प्रतिवेदन` printed as a row of
tofu boxes on a document a paying client opens. Measured, not assumed: the
heading extracted as `AI Services · AI टटटटटट`, every codepoint collapsed onto
one substitute glyph.

The fixed Devanagari — the two subtitles and the three bilingual headings — goes
through `deva_span()`, which carries the conjunct-safety contract (family,
weight 400, no tracking, no synthesis) and degrades to the Latin half rather
than to tofu when no face is vendored. The class is applied to the span itself,
which is what keeps the Devanagari family from leaking onto neighbouring Latin;
see the note on the font stacks below, where doing it the other way is measured.

Devanagari in tenant DATA — an org, plan or service named in Devanagari, which
an Indian firm may perfectly well be — is covered by the same declaration, and
this was measured rather than assumed. `font_face_css()` registers the vendored
face with fontconfig, and Pango then reaches it through per-glyph fallback even
though no stack here names it: an org called `श्री गणेश एंड कंपनी` with plan
`मानक` renders every run on Tiro. So the `@font-face` declaration alone carries
both the fixed strings and the data, which is exactly why the face is declared
rather than merely installed.

Colour
------
`_DEEP` (#0082c6) is `--org-accent-2` in `brand.css` — the live SECONDARY, the
far end of the logo gradient, not a retired token. It is deliberately LEFT
ALONE. This document is not one of the nine in `design-reference/Kartavaya
Redesign/docs/`, so there is no specification to conform it to, and its whole
palette (`_TEAL` #05b7aa, `_INK` #1A2230) is a parallel set that matches none
of brand.css's tokens. Repainting one heading to the primary would leave it the
single conforming value in a non-conforming palette — a change with no design
behind it. Recolouring this document is a design decision, not a font fix.
"""
import logging
from datetime import date

from services.doc_fonts import deva_span, font_face_css
from services.doc_render import esc

_INK      = "#1A2230"
_INK2     = "#4A5468"
_INK3     = "#6E7B91"
_RULE     = "#E2DCC9"
_RULE_SOFT= "#EFE9D8"
_BG_SOFT  = "#F0ECDF"
_SURFACE  = "#FCFAF5"
_TEAL     = "#05b7aa"
_DEEP     = "#0082c6"

# These three stacks are UNCHANGED, and deliberately so. The obvious-looking fix
# — name the Devanagari family in each stack so Devanagari in tenant data has
# somewhere to land — was tried, measured, and reverted. Tiro carries a full
# Latin repertoire (`latn` sits in its GSUB beside `dev2`), and none of Georgia,
# Times New Roman, Helvetica Neue, Arial or Courier New exists in the container
# image. So Tiro became the first PRESENT family in every stack and captured the
# whole document: all 55 Latin spans moved onto it, the bold ones onto a
# SYNTHESISED Tiro bold — the exact weight the contract forbids. Moving it behind
# the generic did not help; the generic is not a barrier here.
#
# Fixed Devanagari therefore goes through `.deva` (see `_bi` and `deva_span`),
# which names the family on the span itself and cannot leak outward. That is what
# the other eight generators do, and it is the whole mechanism.
_FONT_DISP = 'Georgia, "Times New Roman", serif'
_FONT_UI   = '"Helvetica Neue", Arial, sans-serif'
_FONT_MONO = '"Courier New", monospace'

log = logging.getLogger(__name__)


def _fmt_inr(v):
    return f"₹{v:,.2f}" if isinstance(v, (int, float)) else f"₹{v}"


def _bi(en: str, hi: str) -> str:
    """A section heading beside its Devanagari twin.

    `deva_span` returns "" when no face is vendored, and the separator has to go
    with it: a heading reading `AI Services ·` with nothing after the middot is
    the same broken-looking document as one showing tofu.
    """
    hi_html = deva_span(hi)
    return f"{esc(en)} &middot; {hi_html}" if hi_html else esc(en)


def _build_cost_html(data: dict) -> str:
    org_name = data.get("org_name", "Organisation")
    plan = data.get("plan_name", "Free")
    p_start = data.get("period_start", "")
    p_end = data.get("period_end", "")
    ai_services = data.get("ai_services", [])
    scraper_services = data.get("scraper_services", [])
    credits_used = data.get("credits_used", 0)
    total_ai = data.get("total_ai_inr", 0)
    total_scraper = data.get("total_scraper_inr", 0)
    total_charge = data.get("total_charge_inr", 0)
    sig_name = data.get("signatory_name", "")
    sig_desg = data.get("signatory_designation", "")

    ai_rows = ""
    for s in ai_services:
        ai_rows += (
            f'<tr><td>{esc(s["service"])}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{esc(s["calls"])}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(s["charge_inr"])}</td></tr>'
        )
    if not ai_rows:
        ai_rows = f'<tr><td colspan="3" style="color:{_INK3};font-style:italic">No AI usage in this period.</td></tr>'

    scraper_rows = ""
    for s in scraper_services:
        scraper_rows += (
            f'<tr><td>{esc(s["service"])}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{esc(s["runs"])}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(s["charge_inr"])}</td></tr>'
        )
    if not scraper_rows:
        scraper_rows = f'<tr><td colspan="3" style="color:{_INK3};font-style:italic">No scraper usage in this period.</td></tr>'

    sig_block = ""
    if sig_name:
        sig_block = f"""
        <div style="margin-top:40px;text-align:right;">
            <div style="font-size:11px;color:{_INK3};margin-bottom:24px;">Authorized by</div>
            <div style="font-weight:600;color:{_INK}">{esc(sig_name)}</div>
            <div style="font-size:10px;color:{_INK2}">{esc(sig_desg)}</div>
        </div>"""

    html_str = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
{font_face_css()}
@page {{ size: A4; margin: 20mm 18mm; }}
body {{ font-family: {_FONT_UI}; font-size: 11px; color: {_INK}; }}
.header {{ display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid {_TEAL}; padding-bottom: 12px; margin-bottom: 20px; }}
.header h1 {{ font-family: {_FONT_DISP}; font-size: 20px; margin: 0; color: {_INK}; }}
.header .sub {{ font-size: 10px; color: {_INK3}; }}
/* The Devanagari subtitle sits a shade larger than the Latin `.sub` above it:
   Tiro's x-height runs small next to Helvetica at the same size, and matching
   the number makes the Hindi look shrunken beside the English. */
.header .sub .deva {{ font-size: 11.5px; }}
.meta {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 20px;
         background: {_BG_SOFT}; padding: 12px 16px; border-radius: 6px; font-size: 10px; }}
.meta dt {{ font-weight: 600; color: {_INK2}; }}
.meta dd {{ margin: 0; font-family: {_FONT_MONO}; }}
.section {{ margin-bottom: 18px; }}
.section h2 {{ font-family: {_FONT_DISP}; font-size: 13px; margin: 0 0 8px;
               color: {_DEEP}; border-bottom: 1px solid {_RULE}; padding-bottom: 4px; }}
table {{ width: 100%; border-collapse: collapse; }}
th {{ text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em;
      color: {_INK3}; padding: 5px 8px; border-bottom: 1px solid {_RULE}; }}
td {{ padding: 5px 8px; border-bottom: 1px solid {_RULE_SOFT}; font-size: 10.5px; }}
.total-row td {{ font-weight: 700; border-top: 2px solid {_TEAL}; border-bottom: none;
                 font-size: 12px; padding-top: 8px; }}
.summary {{ background: {_SURFACE}; border: 1px solid {_RULE}; border-radius: 6px;
            padding: 16px; margin-top: 20px; }}
.summary table td {{ border: none; padding: 4px 8px; }}
.summary .grand {{ font-family: {_FONT_DISP}; font-size: 16px; font-weight: 700;
                    color: {_TEAL}; }}
.footer {{ margin-top: 24px; font-size: 9px; color: {_INK3};
           border-top: 1px solid {_RULE}; padding-top: 8px; text-align: center; }}
</style></head><body>

<div class="header">
    <div>
        <h1>Usage &amp; Cost Report</h1>
        <div class="sub">{deva_span("उपयोग एवं लागत प्रतिवेदन")}</div>
    </div>
    <div style="text-align:right">
        <div style="font-weight:600">{esc(org_name)}</div>
        <div class="sub">Generated {date.today().strftime('%d %b %Y')}</div>
    </div>
</div>

<dl class="meta">
    <dt>Organisation</dt><dd>{esc(org_name)}</dd>
    <dt>Plan</dt><dd>{esc(plan)}</dd>
    <dt>Report Period</dt><dd>{esc(p_start)} to {esc(p_end)}</dd>
    <dt>Credits Used</dt><dd>{esc(credits_used)}</dd>
</dl>

<div class="section">
    <h2>{_bi("AI Services", "AI सेवाएं")}</h2>
    <table>
        <thead><tr><th>Service</th><th style="text-align:right">Calls</th><th style="text-align:right">Charge (₹)</th></tr></thead>
        <tbody>{ai_rows}
            <tr class="total-row"><td>Total AI</td><td></td><td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_ai)}</td></tr>
        </tbody>
    </table>
</div>

<div class="section">
    <h2>{_bi("Data & Scraper Services", "डेटा सेवाएं")}</h2>
    <table>
        <thead><tr><th>Service</th><th style="text-align:right">Runs</th><th style="text-align:right">Charge (₹)</th></tr></thead>
        <tbody>{scraper_rows}
            <tr class="total-row"><td>Total Scraper</td><td></td><td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_scraper)}</td></tr>
        </tbody>
    </table>
</div>

<div class="summary">
    <table>
        <tr><td>AI Services</td><td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_ai)}</td></tr>
        <tr><td>Data &amp; Scraper Services</td><td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_scraper)}</td></tr>
        <tr><td colspan="2" style="border-top:1px solid {_RULE}"></td></tr>
        <tr><td style="font-weight:700">Total Charges</td>
            <td class="grand" style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_charge)}</td></tr>
    </table>
</div>

{sig_block}

<div class="footer">
    Kartavaya by Aekam Inc &middot; This is a system-generated report &middot; GST charges billed separately on invoice
</div>

</body></html>"""

    return html_str


def generate_cost_report_pdf(data: dict) -> bytes:
    """Render the cost report. The HTML is built by `_build_cost_html` so the
    page budget and the font contract can be measured without a renderer, which
    is the seam the other eight generators already expose."""
    try:
        from weasyprint import HTML
        return HTML(string=_build_cost_html(data), base_url=None).write_pdf()
    except Exception as e:
        log.error("cost_report_pdf generation failed: %s", e)
        raise


def _build_credit_html(data: dict) -> str:
    """Client-facing credit usage report. No money disclosed — credits only."""
    org_name = data.get("org_name", "Organisation")
    plan = data.get("plan_name", "Free")
    p_start = data.get("period_start", "")
    p_end = data.get("period_end", "")
    plan_credits = data.get("plan_credits", 0)
    balance = data.get("current_balance", 0)
    ai_used = data.get("ai_credits_used", 0)
    scraper_used = data.get("scraper_credits_used", 0)
    total_used = data.get("total_credits_used", 0)
    overage = data.get("overage_credits", 0)
    sig_name = data.get("signatory_name", "")
    sig_desg = data.get("signatory_designation", "")

    scraper_breakdown = data.get("scraper_breakdown", [])

    overage_row = ""
    if overage > 0:
        overage_row = f"""
        <tr style="color:#ef4444">
            <td style="font-weight:700">Overage Credits (Chargeable)</td>
            <td style="text-align:right;font-family:{_FONT_MONO};font-weight:700">{esc(overage)}</td>
        </tr>"""

    sig_block = ""
    if sig_name:
        sig_block = f"""
        <div style="margin-top:40px;text-align:right;">
            <div style="font-size:11px;color:{_INK3};margin-bottom:24px;">Authorized by</div>
            <div style="font-weight:600;color:{_INK}">{esc(sig_name)}</div>
            <div style="font-size:10px;color:{_INK2}">{esc(sig_desg)}</div>
        </div>"""

    catalog_section = ""
    if scraper_breakdown:
        catalog_rows = "".join(
            f'<tr><td>{esc(s["name"])}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{esc(s["runs"])}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{esc(s["credits"])}</td></tr>'
            for s in scraper_breakdown
        )
        catalog_section = f"""
<div class="section">
    <h2>{_bi("Data Catalog Usage", "डेटा कैटलॉग")}</h2>
    <table class="detail">
        <thead><tr><th>Catalog</th><th style="text-align:right">Runs</th><th style="text-align:right">Credits</th></tr></thead>
        <tbody>{catalog_rows}</tbody>
    </table>
</div>"""

    html_str = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
{font_face_css()}
@page {{ size: A4; margin: 20mm 18mm; }}
body {{ font-family: {_FONT_UI}; font-size: 11px; color: {_INK}; }}
.header {{ display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid {_TEAL}; padding-bottom: 12px; margin-bottom: 20px; }}
.header h1 {{ font-family: {_FONT_DISP}; font-size: 20px; margin: 0; color: {_INK}; }}
.header .sub {{ font-size: 10px; color: {_INK3}; }}
/* The Devanagari subtitle sits a shade larger than the Latin `.sub` above it:
   Tiro's x-height runs small next to Helvetica at the same size, and matching
   the number makes the Hindi look shrunken beside the English. */
.header .sub .deva {{ font-size: 11.5px; }}
.meta {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 20px;
         background: {_BG_SOFT}; padding: 12px 16px; border-radius: 6px; font-size: 10px; }}
.meta dt {{ font-weight: 600; color: {_INK2}; }}
.meta dd {{ margin: 0; font-family: {_FONT_MONO}; }}
.section {{ margin-bottom: 18px; }}
.section h2 {{ font-family: {_FONT_DISP}; font-size: 13px; margin: 0 0 8px;
               color: {_DEEP}; border-bottom: 1px solid {_RULE}; padding-bottom: 4px; }}
table.detail {{ width: 100%; border-collapse: collapse; }}
table.detail th {{ text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em;
      color: {_INK3}; padding: 5px 8px; border-bottom: 1px solid {_RULE}; }}
table.detail td {{ padding: 5px 8px; border-bottom: 1px solid {_RULE_SOFT}; font-size: 10.5px; }}
.summary {{ background: {_SURFACE}; border: 1px solid {_RULE}; border-radius: 6px;
            padding: 16px; margin-top: 20px; }}
.summary table {{ width: 100%; border-collapse: collapse; }}
.summary table td {{ border: none; padding: 6px 8px; font-size: 11px; }}
.grand {{ font-family: {_FONT_DISP}; font-size: 18px; font-weight: 700; color: {_TEAL}; }}
.footer {{ margin-top: 24px; font-size: 9px; color: {_INK3};
           border-top: 1px solid {_RULE}; padding-top: 8px; text-align: center; }}
</style></head><body>

<div class="header">
    <div>
        <h1>Credit Usage Report</h1>
        <div class="sub">{deva_span("क्रेडिट उपयोग प्रतिवेदन")}</div>
    </div>
    <div style="text-align:right">
        <div style="font-weight:600">{esc(org_name)}</div>
        <div class="sub">Generated {date.today().strftime('%d %b %Y')}</div>
    </div>
</div>

<dl class="meta">
    <dt>Organisation</dt><dd>{esc(org_name)}</dd>
    <dt>Plan</dt><dd>{esc(plan)}</dd>
    <dt>Report Period</dt><dd>{esc(p_start)} to {esc(p_end)}</dd>
    <dt>Plan Credits (Monthly)</dt><dd>{esc(plan_credits)}</dd>
</dl>

{catalog_section}

<div class="summary">
    <table>
        <tr>
            <td>Plan Credits (Monthly Allowance)</td>
            <td style="text-align:right;font-family:{_FONT_MONO};font-weight:600">{esc(plan_credits)}</td>
        </tr>
        <tr>
            <td>AI Credits Used</td>
            <td style="text-align:right;font-family:{_FONT_MONO}">{esc(ai_used)}</td>
        </tr>
        <tr>
            <td>Data &amp; Scraper Credits Used</td>
            <td style="text-align:right;font-family:{_FONT_MONO}">{esc(scraper_used)}</td>
        </tr>
        <tr><td colspan="2" style="border-top:1px solid {_RULE}"></td></tr>
        <tr>
            <td style="font-weight:700">Total Credits Used</td>
            <td class="grand" style="text-align:right;font-family:{_FONT_MONO}">{esc(total_used)}</td>
        </tr>
        {overage_row}
        <tr><td colspan="2" style="border-top:1px solid {_RULE}"></td></tr>
        <tr>
            <td>Current Balance</td>
            <td style="text-align:right;font-family:{_FONT_MONO};font-weight:600;color:{'#ef4444' if balance <= 0 else _TEAL}">{esc(balance)}</td>
        </tr>
    </table>
</div>

{sig_block}

<div class="footer">
    Kartavaya by Aekam Inc &middot; System-generated credit usage report &middot;
    Credits reset monthly per plan &middot; Overage credits are billed separately
</div>

</body></html>"""

    return html_str


def generate_credit_report_pdf(data: dict) -> bytes:
    """Render the credit report. See `generate_cost_report_pdf` on the seam."""
    try:
        from weasyprint import HTML
        return HTML(string=_build_credit_html(data), base_url=None).write_pdf()
    except Exception as e:
        log.error("credit_report_pdf generation failed: %s", e)
        raise
