"""doc_render.py — the shared print furniture every Kartavaya document is built from.

Why this module exists
----------------------
`design-reference/Kartavaya Redesign/docs/` is the approved specification for the
documents this product emits. Nine of them share ONE layout contract, and that
contract is two vendored files:

  * `doc-page.js` — the `<doc-page>` web component. It owns the page box, the
    page breaks and the `@page` rule. An explicitly-paginated document is a
    sequence of `<section class="page">` children, each printing as exactly one
    full-bleed sheet with `overflow: hidden` — "content that misses the box is
    CLIPPED".
  * `brand.css` — the token set and the class vocabulary: `.lh`, `.meta`,
    `.parties`, `.lines`, `.totals`, `.words`, `.block`, `.sign`, `.foot`,
    `.dchip`, `.gap-note`, `.unset`.

WeasyPrint has no DOM and runs no JavaScript, so `<doc-page>` cannot be used
directly. This module is the server-side translation of the same contract: the
class names, the type scale and the spacing are brand.css's, and the page
geometry reproduces what `doc-page.js` emits for an explicitly-paginated
document (`@page { size: …; margin: 0 }`, each `.page` full-bleed, content
carrying its own inset via `--doc-pad`).

Three deliberate departures from brand.css, each for a print reason
------------------------------------------------------------------
1. **Tokens are resolved in Python, not `var()`.** brand.css drives everything
   through custom properties because it retints per tenant at runtime with
   JavaScript. There is no runtime here, and a `var()` that fails to resolve in
   WeasyPrint degrades to *nothing* — an invisible rule, an unpainted accent —
   which is the silent-corruption failure mode `doc_fonts.py` exists to prevent.
   The values below are brand.css's, verbatim.

2. **Flex and tables instead of CSS grid.** brand.css lays `.lh`, `.meta` and
   `.parties` out with `grid-template-columns`. WeasyPrint's grid support is
   partial; a grid that fails to apply collapses a four-column meta strip into
   one column and the document silently loses its shape. Every such strip here
   is a flex row of equal-basis children, which resolves to the identical
   geometry for the fixed-column cases the specification uses.

3. **A4, not Letter.** `doc-page.js` defaults to Letter and directs `size="a4"`
   for "a clearly metric user". Every document here is an Indian statutory or
   commercial document; `invoice_pdf.py` and `payslip_pdf.py` already pin A4.

Tenant accent
-------------
brand.css is explicit about the state of this field, and it has not changed:
"the staging /v1/org/profile schema has no colour field yet … Until it does,
accent falls back to Kartavaya teal." `staging.organisations` has no colour
column (verified against the live catalog, not the migration ledger), so
`accent()` returns the documented fallback unless a caller passes one. Nothing
is invented and nothing is guessed from the logo.
"""

from __future__ import annotations

import base64
import html
import logging
from pathlib import Path

from services.doc_fonts import (
    DEVANAGARI_STACK,
    DEVANAGARI_WEIGHT,
    DISPLAY_STACK,
    deva_span,
    font_face_css,
    group_indian,
)
from services.doc_validation import DocumentCheck

log = logging.getLogger(__name__)

# ── brand.css :root, verbatim ────────────────────────────────────────────────
INK = "#14171A"
INK2 = "#464B52"
INK3 = "#6E747C"
INK_FAINT = "#9AA0A8"
RULE = "#D9D5CA"
RULE_SOFT = "#EAE7DE"
TINT = "#F7F5EF"
PAD = "0.62in"

# brand.css [data-org="aekam"] — the documented fallback accent. See docstring.
ACCENT_DEFAULT = "#04837A"
ACCENT2_DEFAULT = "#0082c6"
ORG_TINT_DEFAULT = "#E8F5F2"

# brand.css .unset / .gap-note
UNSET_INK = "#A02318"
GAP_BG = "#FADAD6"
GAP_INK = "#7A1B12"

# brand.css .dchip--ok / --due / --over
CHIP = {
    "ok": ("#DCF0E4", "#17603A"),
    "due": ("#FBE6C8", "#8A5300"),
    "over": ("#FADAD6", "#A02318"),
    "": (TINT, INK3),
}

FONT_UI = 'Inter, "Noto Sans", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif'
FONT_MONO = '"JetBrains Mono", "Noto Sans Mono", "DejaVu Sans Mono", "Courier New", monospace'
FONT_DISPLAY = DISPLAY_STACK

_LOGO_MAX_BYTES = 4 * 1024 * 1024


def esc(value) -> str:
    """HTML-escape anything on its way into a template. Firm names contain `&`."""
    return html.escape(str(value if value is not None else ""))


def accent(org: dict | None = None) -> tuple[str, str, str]:
    """(accent, accent-2, org-tint) for this org.

    A caller may pass `accent` / `accent_2` on the org dict once a colour column
    exists. Until then every document renders in the Kartavaya teal that
    brand.css names as the fallback.
    """
    org = org or {}
    a = str(org.get("accent") or "").strip() or ACCENT_DEFAULT
    a2 = str(org.get("accent_2") or "").strip() or ACCENT2_DEFAULT
    tint = str(org.get("accent_tint") or "").strip() or ORG_TINT_DEFAULT
    return a, a2, tint


def unset(label: str) -> str:
    """brand.css `.unset` — "visible, never silent".

    The `⚠ ` prefix is brand.css's `.unset::before`; WeasyPrint supports
    generated content, but the marker is inlined here so the warning cannot be
    lost to a `content` property that does not apply.
    """
    return f'<span class="unset">&#9888; {esc(label)} not set</span>'


def money(value, symbol: str = "₹") -> str:
    """Indian 2,2,3 grouping. `f"{n:,.2f}"` is the Western short scale and reads
    wrong on an Indian document — 548,652.00 where 5,48,652.00 belongs."""
    return f"{symbol}{group_indian(value)}"


def money0(value, symbol: str = "₹") -> str:
    """Whole rupees. Every figure the specification prints on GSTR-3B and the
    TDS challan is a whole rupee — both returns are filed rounded."""
    return f"{symbol}{group_indian(value, decimals=0)}"


def num0(value) -> str:
    """A whole-rupee figure with no symbol, for inside a `.lines` table where
    the column header already carries the currency. `—` for a true zero, which
    is what the specification prints."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        v = 0.0
    if v == 0:
        return "&mdash;"
    return group_indian(v, decimals=0)


def embed_logo(logo_url: str) -> str:
    """Inline the org logo as a data URI.

    Identical policy to `invoice_pdf._embed_logo`: WeasyPrint runs without a
    browser sandbox and `base_url=None` forbids network resolution anyway, so a
    bare remote `<img src>` silently blanks the letterhead. A fetch failure
    degrades to the initial mark rather than raising — a missing logo is a
    cosmetic loss, not a statutory one.
    """
    if not logo_url:
        return ""
    try:
        import httpx

        resp = httpx.get(logo_url, timeout=8)
        resp.raise_for_status()
        if len(resp.content) > _LOGO_MAX_BYTES:
            log.warning("doc_render: logo too large (%d bytes), skipped", len(resp.content))
            return ""
        mime = resp.headers.get("content-type", "image/png").split(";")[0]
        b64 = base64.b64encode(resp.content).decode("ascii")
        return f'<img src="data:{mime};base64,{b64}" alt="" />'
    except Exception as e:  # noqa: BLE001 — a logo must never fail a document
        log.warning("doc_render: logo fetch failed for %s: %s", logo_url, e)
        return ""


def embed_logo_file(path: str | Path) -> str:
    """Inline a logo already on disk. Used by the fixtures, never by a router."""
    p = Path(path)
    try:
        data = p.read_bytes()
    except OSError as e:
        log.warning("doc_render: logo file unreadable %s: %s", p, e)
        return ""
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml"}.get(
        p.suffix.lstrip(".").lower(), "image/png"
    )
    b64 = base64.b64encode(data).decode("ascii")
    return f'<img src="data:{mime};base64,{b64}" alt="" />'


def fmt_addr(addr) -> str:
    """The org/contact address as brand.css prints it: two lines, `<br>` split
    after line2, matching `.lh__legal` in every specification document."""
    if not isinstance(addr, dict):
        return ""
    top = ", ".join(str(addr.get(k) or "").strip() for k in ("line1", "line2") if str(addr.get(k) or "").strip())
    bottom_parts = [str(addr.get(k) or "").strip() for k in ("city", "pincode", "state", "country")]
    bottom = ", ".join(p for p in bottom_parts if p)
    if top and bottom:
        return f"{esc(top)}<br>{esc(bottom)}"
    return esc(top or bottom)


def chip(label: str, kind: str = "") -> str:
    """brand.css `.dchip`. `kind` is one of ok / due / over, or empty."""
    if not label:
        return ""
    cls = f" dchip--{kind}" if kind in ("ok", "due", "over") else ""
    return f'<span class="dchip{cls}">{esc(label)}</span>'


def letterhead(
    org: dict,
    kind_en: str,
    kind_hi: str,
    doc_no: str = "",
    chip_html: str = "",
    show_tan: bool = False,
    ids_html: str | None = None,
) -> str:
    """brand.css `.lh` — the block every specification document opens with.

    The identifier line is `GSTIN <b>…</b> · PAN <b>…</b>`. A missing value is
    marked with `.unset`, never omitted: `invoice_pdf._org_gstin_line` records
    why ("an invented number is worse than a missing one, and the mark has to be
    unpleasant enough that nobody sends the document without noticing"), and the
    specification's own tenant switcher does exactly this for the third tenant,
    which has no GSTIN.

    `show_tan` adds the TAN, which only the TDS challan's letterhead needs.

    `ids_html` replaces that identifier line outright. Only `invoice_pdf` passes
    it, and only because ONE document in the set has a statutory reason to leave
    a missing GSTIN unmarked: a quotation or proforma is an offer, not a tax
    document, and is perfectly valid without one. Marking it would put a red
    warning on correct paperwork and teach people to ignore the mark — see
    `invoice_pdf._org_gstin_line`, which owns that decision. The default marks,
    so every other document keeps the honesty rule unchanged.
    """
    org = org or {}
    logo = embed_logo(org.get("logo_url") or "") or (
        f'<span class="lh__mark">{esc((org.get("name") or "?").strip()[:1])}</span>'
    )
    addr = fmt_addr(org.get("billing_address") or {}) or unset("Billing address")

    ids = [f'GSTIN <b>{esc(org["gstin"]) if org.get("gstin") else unset("GSTIN")}</b>',
           f'PAN <b>{esc(org["pan"]) if org.get("pan") else unset("PAN")}</b>']
    if show_tan:
        ids.append(f'TAN <b>{esc(org["tan"]) if org.get("tan") else unset("TAN")}</b>')
    id_line = ids_html if ids_html is not None else " &middot; ".join(ids)

    contacts = "".join(
        f"<span>{esc(v)}</span>"
        for v in (org.get("email"), org.get("phone"), org.get("website"))
        if str(v or "").strip()
    )

    hi = deva_span(kind_hi) if kind_hi else ""
    return f"""
<header class="lh">
  <div class="lh__logo">{logo}</div>
  <div class="lh__who">
    <div class="lh__name">{esc(org.get("name")) if org.get("name") else unset("Organisation name")}</div>
    <div class="lh__legal">{addr}</div>
    {f'<div class="lh__ids">{id_line}</div>' if id_line else ''}
    {f'<div class="lh__contact">{contacts}</div>' if contacts else ''}
  </div>
  <div class="lh__doc">
    <div class="lh__kind">{esc(kind_en)}{f'<span class="lh__kind-hi">{hi}</span>' if hi else ''}</div>
    {f'<div class="lh__no">{esc(doc_no)}</div>' if doc_no else ''}
    {f'<div class="lh__chip">{chip_html}</div>' if chip_html else ''}
  </div>
</header>"""


def meta_strip(items: list[tuple[str, str]], mono_labels: tuple[str, ...] = (), columns: int = 4) -> str:
    """brand.css `.meta` — the label/value strip under the letterhead.

    `items` are already-escaped value strings, because several callers pass
    marked-up values (an `.unset` span, a `<b>`).
    """
    cells = "".join(
        f'<div class="meta__cell"><div class="meta__l">{esc(label)}</div>'
        f'<div class="meta__v{" meta__v--mono" if label in mono_labels else ""}">{value}</div></div>'
        for label, value in items
    )
    return f'<div class="meta meta--{columns}">{cells}</div>'


def party(label: str, name: str = "", addr_html: str = "", id_html: str = "", body_html: str = "") -> str:
    """One half of brand.css `.parties`."""
    return f"""<div class="party">
  <div class="party__l">{esc(label)}</div>
  {f'<div class="party__n">{name}</div>' if name else ''}
  {f'<div class="party__a">{addr_html}</div>' if addr_html else ''}
  {f'<div class="party__id">{id_html}</div>' if id_html else ''}
  {f'<div class="party__a party__a--lead">{body_html}</div>' if body_html else ''}
</div>"""


def parties(left: str, right: str, flush: bool = False) -> str:
    """brand.css `.parties` — the two-up block. `flush` drops the bottom rule,
    which the specification does for the final block on a page."""
    cls = "parties parties--flush" if flush else "parties"
    return f'<div class="{cls}">{left}{right}</div>'


def gap_note(check: DocumentCheck | None) -> str:
    """brand.css `.gap-note`.

    The specification's wording is fixed and the last sentence is the point:
    "Nothing here is invented to fill the gap." Each advisory gap is named,
    which is the same honesty rule `invoice_pdf._advisory_note` applies and the
    same one the GSTR-3B working paper applies when it names the invoices it
    held back instead of quietly excluding them.
    """
    if not check or not check.advisory:
        return ""
    items = "".join(
        f"<li><b>{esc(g.label)}</b> &mdash; {esc(g.reason)}"
        f"<br><i>Set it in: {esc(g.fix)}</i></li>"
        for g in check.advisory
    )
    n = len(check.advisory)
    return f"""
<div class="gap-note">
  <span class="gap-note__icon">&#9888;</span>
  <span><b>This document is missing details.</b>{n} field{'' if n == 1 else 's'} unset.
  Nothing here is invented to fill the gap.<ul>{items}</ul></span>
</div>"""


def foot(left_html: str) -> str:
    """brand.css `.foot` — the colophon. `.foot__brand` is Devanagari and is the
    one place every document carries `कर्तव्य`; it degrades to nothing rather
    than to tofu when no Devanagari face is vendored (see `deva_span`)."""
    return f'<div class="foot"><span>{left_html}</span>' \
           f'<span class="foot__brand">{deva_span("कर्तव्य", "Kartavya")}</span></div>'


def sign_block(label: str, name: str = "", role: str = "", align: str = "right") -> str:
    """brand.css `.sign` / `.sign__line`."""
    who = " &middot; ".join(p for p in (esc(name), esc(role)) if p)
    cls = "sign" if align == "right" else "sign sign--left"
    return f"""<div class="{cls}">
  <div class="sign__line">{esc(label)}<br><span class="sign__who">{who or unset("Authorised signatory")}</span></div>
</div>"""


def table(headers: list[tuple[str, str, str]], rows: list[str], klass: str = "lines") -> str:
    """brand.css `.lines`.

    `headers` is (label, alignment, width) where alignment is "" or "num".
    A `<thead>` is always emitted — `doc-page.js` notes that browsers repeat it
    on every printed page, and WeasyPrint does the same for a table that breaks.
    """
    ths = "".join(
        f'<th class="{align}"{f" style=\"width:{width}\"" if width else ""}>{esc(label)}</th>'
        for label, align, width in headers
    )
    return f'<table class="{klass}"><thead><tr>{ths}</tr></thead><tbody>{"".join(rows)}</tbody></table>'


def cell_desc(desc: str, sub: str = "") -> str:
    """brand.css `.lines__desc` + `.lines__sub`."""
    return f'<div class="lines__desc">{esc(desc)}</div>' + (
        f'<div class="lines__sub">{esc(sub)}</div>' if sub else ""
    )


def totals(rows: list[tuple[str, str]], grand: tuple[str, str] | None = None) -> str:
    """brand.css `.totals` — right-aligned, the last row `--grand`."""
    body = "".join(
        f'<div class="totals__row"><span>{esc(label)}</span><span class="num">{value}</span></div>'
        for label, value in rows
    )
    if grand:
        body += (
            f'<div class="totals__row totals__row--grand"><span>{esc(grand[0])}</span>'
            f'<span class="num">{grand[1]}</span></div>'
        )
    return f'<div class="totals">{body}</div>'


def words_line(text_html: str) -> str:
    """brand.css `.words` — the amount in words. `.words b` is
    `text-transform: capitalize` in brand.css; the helper the existing
    generators use (`amount_in_words_inr`) already returns Title Case, so the
    transform is a no-op rather than a second, disagreeing rendering."""
    return f'<div class="words">{text_html}</div>'


def block(label: str, body_html: str, top: str = "14px") -> str:
    """brand.css `.block` + `.block__l`."""
    return (
        f'<div class="block" style="margin-top:{top}">'
        f'<div class="block__l">{esc(label)}</div>{body_html}</div>'
    )


def terms_list(items: list[str], ordered: bool = False) -> str:
    """brand.css `.terms`. Items are pre-escaped by the caller when they carry
    emphasis, so nothing is escaped twice here."""
    tag = "ol" if ordered else "ul"
    lis = "".join(f"<li>{i}</li>" for i in items)
    return f'<{tag} class="terms">{lis}</{tag}>'


# ── the stylesheet ───────────────────────────────────────────────────────────

def stylesheet(org: dict | None = None) -> str:
    """brand.css, resolved for print.

    The page geometry is what `doc-page.js` emits for an explicitly-paginated
    document: `@page { size: A4; margin: 0 }` and each `.page` a full-bleed
    sheet carrying its own `--doc-pad` inset. `break-after: page` on every
    `.page` but the last reproduces the component's
    `::slotted(.page:not(:first-child)) { break-before: page }`.
    """
    a, a2, org_tint = accent(org)
    return f"""
{font_face_css()}
*{{ box-sizing:border-box; margin:0; padding:0; }}
@page{{ size:A4; margin:0; }}
html,body{{ background:#fff; }}
body{{ font-family:{FONT_UI}; color:{INK}; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}

/* doc-page.js: each .page is one full-bleed sheet, content owns its inset.
 *
 * TWO deliberate departures from the component, both measured rather than
 * assumed, and both recorded in `swarm-reports/documents-build.md`.
 *
 * 1. `min-height`, not `height` + `overflow: hidden`. The component CLIPS a
 *    page that overruns its box. Measured under this engine against the
 *    specification's OWN markup, every design document except the statement
 *    overruns A4 — GSTR-3B 362mm, TDS challan 380mm, quotation 344mm, project
 *    report 347mm, agreement page 1 324mm, against a 297mm sheet. Honouring
 *    `overflow: hidden` would silently drop a GSTR-3B payment table or a
 *    challan's CIN, so these documents PAGINATE instead. `break-inside: avoid`
 *    on `.lines tbody tr` and on `.block` keeps the split off the middle of a
 *    figure, and `<thead>` repeats on the continuation sheet.
 *
 * 2. No flex column. brand.css pins `.foot` to the bottom of the sheet with
 *    `display: flex` + `margin-top: auto`. That is a screen technique and
 *    WeasyPrint 68 does not implement it: the auto margin distributes no free
 *    space, and worse, the flex container fragments wrongly — a TDS challan
 *    measuring 288.8mm of content, comfortably inside a 297mm sheet, was
 *    pushed onto a second page carrying nothing but the colophon.
 *
 *    Both alternatives were tried and neither pins the colophon either: a
 *    fixed `height: 296mm` on the flex box, and the classic print pattern of a
 *    `display: table` page with the colophon in a `table-footer-group` (which
 *    does reach the foot of a FULL sheet, and sits at 40mm on a short one).
 *
 *    So the colophon follows the content. On a full sheet that is where the
 *    design puts it; on a short one it sits higher than the design shows. That
 *    is a cosmetic loss taken deliberately in exchange for pagination that
 *    never drops a figure.
 */
.page{{ padding:{PAD}; font-family:{FONT_UI}; font-size:9.5pt; line-height:1.5; color:{INK};
       background:#fff; display:block; min-height:296mm; }}
.page + .page{{ break-before:page; }}

/* ── Letterhead ─────────────────────────────────────────────────────────── */
.lh{{ display:flex; gap:16px; align-items:flex-start; padding-bottom:13px; border-bottom:2px solid {a}; }}
.lh__logo{{ height:46px; max-width:170px; flex:0 0 auto; }}
.lh__logo img{{ max-height:46px; max-width:170px; object-fit:contain; display:block; }}
.lh__mark{{ display:inline-block; width:46px; height:46px; border-radius:10px; background:{a};
            color:#fff; text-align:center; line-height:46px; font-family:{FONT_DISPLAY};
            font-size:22px; font-weight:600; }}
.lh__who{{ flex:1 1 auto; min-width:0; }}
.lh__name{{ font-family:{FONT_DISPLAY}; font-size:17pt; font-weight:600; line-height:1.1; letter-spacing:-0.01em; }}
.lh__legal{{ font-size:7.5pt; color:{INK3}; margin-top:3px; line-height:1.45; }}
.lh__ids{{ font-family:{FONT_MONO}; font-size:7pt; color:{INK2}; margin-top:4px; }}
.lh__contact{{ font-size:7.5pt; color:{INK3}; margin-top:3px; }}
.lh__contact span + span::before{{ content:' \\00b7 '; color:{RULE}; }}
.lh__doc{{ text-align:right; flex:0 0 auto; }}
/* .lh__kind is tracked and uppercased. Its Devanagari sibling must be NEITHER —
   letter-spacing applied after shaping detaches the repha in कर्तव्य and
   synthetic bold smears the conjunct joins. See services/doc_fonts.py. */
.lh__kind{{ font-size:8pt; letter-spacing:0.16em; text-transform:uppercase; font-weight:700; color:{a}; }}
.lh__kind-hi{{ font-family:{DEVANAGARI_STACK}; font-size:11pt; color:{INK3}; letter-spacing:0;
               text-transform:none; font-weight:{DEVANAGARI_WEIGHT}; display:block; margin-top:1px;
               font-synthesis:none; }}
.lh__no{{ font-family:{FONT_MONO}; font-size:12pt; font-weight:500; margin-top:5px; }}
.lh__chip{{ margin-top:6px; }}

/* ── Meta strip ─────────────────────────────────────────────────────────── */
.meta{{ display:flex; gap:12px; padding:11px 0; border-bottom:1px solid {RULE_SOFT}; }}
.meta__cell{{ flex:1 1 0; min-width:0; }}
.meta__l{{ font-size:6.8pt; letter-spacing:0.13em; text-transform:uppercase; color:{INK3}; font-weight:700; }}
.meta__v{{ font-size:9.5pt; font-weight:500; margin-top:2px; }}
.meta__v--mono{{ font-family:{FONT_MONO}; font-size:8.5pt; }}
.meta--flush{{ border-bottom:0; }}

/* ── Parties ────────────────────────────────────────────────────────────── */
.parties{{ display:flex; gap:22px; padding:13px 0; border-bottom:1px solid {RULE_SOFT}; }}
.parties--flush{{ border-bottom:0; }}
.party{{ flex:1 1 0; min-width:0; }}
.party__l{{ font-size:6.8pt; letter-spacing:0.13em; text-transform:uppercase; color:{INK3};
            font-weight:700; margin-bottom:4px; }}
.party__n{{ font-size:10.5pt; font-weight:600; }}
.party__a{{ font-size:8.5pt; color:{INK2}; line-height:1.5; margin-top:2px; }}
.party__a--lead{{ margin-top:0; }}
.party__id{{ font-family:{FONT_MONO}; font-size:7.5pt; color:{INK2}; margin-top:3px; }}

/* ── Line tables ────────────────────────────────────────────────────────── */
.lines{{ width:100%; border-collapse:collapse; margin-top:13px; font-size:9pt; }}
.lines thead th{{ background:{TINT}; font-size:6.8pt; letter-spacing:0.11em; text-transform:uppercase;
                  color:{INK3}; font-weight:700; text-align:left; padding:7px 8px;
                  border-bottom:1px solid {RULE}; }}
.lines thead th.num{{ text-align:right; }}
.lines td{{ padding:8px; border-bottom:1px solid {RULE_SOFT}; vertical-align:top; }}
.lines tbody tr{{ break-inside:avoid; }}
.lines tr.lines__foot td{{ border-bottom:0; padding-top:9px; font-weight:700; }}
.num{{ text-align:right; font-family:{FONT_MONO}; font-variant-numeric:tabular-nums; white-space:nowrap; }}
td.num--left{{ text-align:left; }}
.lines__desc{{ font-weight:500; }}
.lines__sub{{ font-size:7.5pt; color:{INK3}; margin-top:1px; }}
.lines__mute{{ color:{INK_FAINT}; }}

/* ── Totals ─────────────────────────────────────────────────────────────── */
.totals{{ margin-top:14px; margin-left:auto; width:62%; max-width:3.5in; }}
.totals__row{{ display:flex; justify-content:space-between; gap:16px; padding:5px 0; font-size:9pt; }}
.totals__row span:first-child{{ color:{INK2}; }}
.totals__row--grand{{ border-top:1.5px solid {INK}; margin-top:5px; padding-top:8px;
                      font-size:12pt; font-weight:700; }}
.totals__row--grand span:first-child{{ color:{INK}; }}
.totals__row--grand span:last-child{{ color:{a}; }}
.words{{ margin-top:9px; padding:8px 10px; background:{TINT}; border-radius:5px; font-size:8pt; }}

/* ── Blocks, terms, signature ───────────────────────────────────────────── */
.block{{ break-inside:avoid; }}
.block__l{{ font-size:6.8pt; letter-spacing:0.13em; text-transform:uppercase; color:{INK3};
            font-weight:700; margin-bottom:5px; }}
.block__l--accent{{ color:{a}; }}
.terms{{ font-size:7.5pt; color:{INK2}; line-height:1.55; margin:0; padding-left:15px; }}
.terms li{{ margin-bottom:2px; }}
p.terms{{ padding-left:0; }}
.sign{{ text-align:right; }}
.sign--left{{ text-align:left; }}
.sign__line{{ border-top:1px solid {INK}; width:1.9in; margin:34px 0 0 auto; padding-top:4px; font-size:8pt; }}
.sign--left .sign__line{{ margin-left:0; }}
.sign__who{{ color:{INK3}; }}
.panel{{ margin-top:16px; padding:11px 13px; background:{org_tint}; border-radius:6px; }}
.tile{{ padding:9px 10px; background:{TINT}; border-radius:5px; }}
.tile__l{{ font-size:6.8pt; letter-spacing:.1em; text-transform:uppercase; color:{INK3}; font-weight:700; }}
.tile__v{{ font-family:{FONT_MONO}; font-size:11pt; margin-top:2px; }}
.row{{ display:flex; gap:8px; }}
.row > *{{ flex:1 1 0; min-width:0; }}

/* ── Unset marker and gap note ──────────────────────────────────────────── */
/* Deliberately ugly: a gap must never survive to a customer unnoticed. */
.unset{{ color:{UNSET_INK}; font-weight:600; font-style:normal; }}
.gap-note{{ display:flex; gap:9px; padding:9px 11px; background:{GAP_BG}; border-radius:6px;
            font-size:7.5pt; color:{GAP_INK}; line-height:1.5; margin-top:11px; break-inside:avoid; }}
.gap-note b{{ display:block; font-size:8pt; }}
.gap-note ul{{ margin:4px 0 0 14px; }}
.gap-note__icon{{ flex:0 0 auto; }}

/* ── Chips ──────────────────────────────────────────────────────────────── */
.dchip{{ display:inline-block; padding:2px 7px; border-radius:99px; font-size:7pt; font-weight:700;
         letter-spacing:0.06em; text-transform:uppercase; white-space:nowrap;
         background:{CHIP[""][0]}; color:{CHIP[""][1]}; }}
.dchip--ok{{ background:{CHIP["ok"][0]}; color:{CHIP["ok"][1]}; }}
.dchip--due{{ background:{CHIP["due"][0]}; color:{CHIP["due"][1]}; }}
.dchip--over{{ background:{CHIP["over"][0]}; color:{CHIP["over"][1]}; }}

/* ── Foot ───────────────────────────────────────────────────────────────── */
.foot{{ margin-top:22px; padding-top:11px; border-top:1px solid {RULE_SOFT}; display:flex;
        justify-content:space-between; align-items:flex-end; gap:16px; font-size:7pt; color:{INK3};
        break-inside:avoid; }}
.foot__brand{{ font-family:{DEVANAGARI_STACK}; font-weight:{DEVANAGARI_WEIGHT}; letter-spacing:0;
               color:{a}; font-size:9pt; font-synthesis:none; }}
.hint{{ display:none; }}
"""


def document(pages: list[str], org: dict | None = None, title: str = "") -> str:
    """Assemble one printable document from its `.page` sections."""
    body = "".join(f'<section class="page">{p}</section>' for p in pages)
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{esc(title)}</title><style>{stylesheet(org)}</style></head>
<body>{body}</body>
</html>"""


def render_pdf(html_str: str) -> bytes:
    """The single PDF path. Same toolchain as `invoice_pdf` / `payslip_pdf`.

    OSError as well as ImportError: WeasyPrint imports fine and then fails to
    dlopen libgobject/libpango, which is what a machine or image without the
    native stack actually does.
    """
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as e:
        raise RuntimeError("WeasyPrint is not available on this server") from e
    return HTML(string=html_str, base_url=None).write_pdf()
