"""cost_report_pdf.py — Client-facing cost/usage report PDF (WeasyPrint).

Shows charged amounts (INR with markup), NOT raw USD costs.
Same design tokens as invoice_pdf.py and payslip_pdf.py.
"""
import logging
from datetime import date

_INK      = "#1A2230"
_INK2     = "#4A5468"
_INK3     = "#6E7B91"
_RULE     = "#E2DCC9"
_RULE_SOFT= "#EFE9D8"
_BG_SOFT  = "#F0ECDF"
_SURFACE  = "#FCFAF5"
_TEAL     = "#05b7aa"
_DEEP     = "#0082c6"

_FONT_DISP = 'Georgia, "Times New Roman", serif'
_FONT_UI   = '"Helvetica Neue", Arial, sans-serif'
_FONT_MONO = '"Courier New", monospace'

log = logging.getLogger(__name__)


def _fmt_inr(v):
    return f"₹{v:,.2f}" if isinstance(v, (int, float)) else f"₹{v}"


def generate_cost_report_pdf(data: dict) -> bytes:
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
            f'<tr><td>{s["service"]}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{s["calls"]}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(s["charge_inr"])}</td></tr>'
        )
    if not ai_rows:
        ai_rows = f'<tr><td colspan="3" style="color:{_INK3};font-style:italic">No AI usage in this period.</td></tr>'

    scraper_rows = ""
    for s in scraper_services:
        scraper_rows += (
            f'<tr><td>{s["service"]}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{s["runs"]}</td>'
            f'<td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(s["charge_inr"])}</td></tr>'
        )
    if not scraper_rows:
        scraper_rows = f'<tr><td colspan="3" style="color:{_INK3};font-style:italic">No scraper usage in this period.</td></tr>'

    sig_block = ""
    if sig_name:
        sig_block = f"""
        <div style="margin-top:40px;text-align:right;">
            <div style="font-size:11px;color:{_INK3};margin-bottom:24px;">Authorized by</div>
            <div style="font-weight:600;color:{_INK}">{sig_name}</div>
            <div style="font-size:10px;color:{_INK2}">{sig_desg}</div>
        </div>"""

    html_str = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page {{ size: A4; margin: 20mm 18mm; }}
body {{ font-family: {_FONT_UI}; font-size: 11px; color: {_INK}; }}
.header {{ display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid {_TEAL}; padding-bottom: 12px; margin-bottom: 20px; }}
.header h1 {{ font-family: {_FONT_DISP}; font-size: 20px; margin: 0; color: {_INK}; }}
.header .sub {{ font-size: 10px; color: {_INK3}; }}
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
        <h1>Usage & Cost Report</h1>
        <div class="sub">उपयोग एवं लागत प्रतिवेदन</div>
    </div>
    <div style="text-align:right">
        <div style="font-weight:600">{org_name}</div>
        <div class="sub">Generated {date.today().strftime('%d %b %Y')}</div>
    </div>
</div>

<dl class="meta">
    <dt>Organisation</dt><dd>{org_name}</dd>
    <dt>Plan</dt><dd>{plan}</dd>
    <dt>Report Period</dt><dd>{p_start} to {p_end}</dd>
    <dt>Credits Used</dt><dd>{credits_used}</dd>
</dl>

<div class="section">
    <h2>AI Services · AI सेवाएं</h2>
    <table>
        <thead><tr><th>Service</th><th style="text-align:right">Calls</th><th style="text-align:right">Charge (₹)</th></tr></thead>
        <tbody>{ai_rows}
            <tr class="total-row"><td>Total AI</td><td></td><td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_ai)}</td></tr>
        </tbody>
    </table>
</div>

<div class="section">
    <h2>Data & Scraper Services · डेटा सेवाएं</h2>
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
        <tr><td>Data & Scraper Services</td><td style="text-align:right;font-family:{_FONT_MONO}">{_fmt_inr(total_scraper)}</td></tr>
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

    try:
        from weasyprint import HTML
        return HTML(string=html_str).write_pdf()
    except Exception as e:
        log.error("cost_report_pdf generation failed: %s", e)
        raise
