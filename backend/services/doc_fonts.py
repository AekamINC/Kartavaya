"""doc_fonts.py — the typefaces a generated document is allowed to rely on.

Why this module exists
----------------------
WeasyPrint resolves a CSS family through fontconfig against whatever the
container image happens to install. That is tolerable for Latin text and
unacceptable for Devanagari: every document this product generates carries
`कर्तव्य` in its colophon, and an image without a Devanagari face renders that
as four tofu boxes — on a tax invoice, on a payslip.

`backend/Dockerfile` currently installs `fonts-noto`, which does pull a
Devanagari face, so today the glyphs happen to appear. "Happen to" is the
problem. The declaration is implicit, nothing tests it, and `backend/nixpacks.toml`
— the alternate build path — installs no font packages at all. A base-image
change would silently corrupt a statutory document.

So the face is vendored (`assets/fonts/TiroDevanagariHindi-Regular.ttf`, SIL OFL,
licence alongside it) and declared with an explicit `@font-face`. WeasyPrint
subsets and embeds any face it actually uses, so the glyphs travel inside the
PDF rather than depending on the reader's machine.

Tiro Devanagari Hindi
---------------------
Single weight, 400. Two consequences, both load-bearing:

1. **Never ask for bold.** With one face available a `font-weight: 700` run gets
   a synthesised (smeared) bold from the renderer, and synthetic emboldening
   applied after shaping distorts the ligature joins in a conjunct.
2. **Never track it.** `letter-spacing` — positive or negative — is applied
   between glyphs after shaping, which visibly breaks a conjunct apart.
   `कर्तव्य` is `क + र + ्(virama) + त + व + ्(virama) + य`: HarfBuzz composes
   `र्` as a repha above the following consonant and `व्य` as a single
   below-joined ligature. Insert tracking and the repha detaches from its base.

   The design spec makes the same reservation: `brand.css` `.lh__kind` sets
   `letter-spacing: 0.16em` for the Latin document kind, and `.lh__kind-hi`
   — the Devanagari sibling — resets it to `letter-spacing: 0`. `deva_span()`
   below carries that reset so a caller cannot inherit tracking by accident.

Shaping itself is HarfBuzz's job (WeasyPrint → Pango → HarfBuzz). The font ships
GSUB with the Devanagari conjunct features; `tests/test_document_statutory.py`
asserts the repertoire and the feature set directly from the font binary so a
font swap that drops them fails the suite rather than the invoice.
"""

from __future__ import annotations

import functools
import html
from pathlib import Path

# ── The vendored face ────────────────────────────────────────────────────────
DEVANAGARI_FAMILY = "Tiro Devanagari Hindi"
DEVANAGARI_WEIGHT = 400  # the only weight Tiro has; see module docstring

_ASSETS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
DEVANAGARI_FILE = _ASSETS / "TiroDevanagariHindi-Regular.ttf"

# Fallbacks, in order. Noto Sans Devanagari is what `fonts-noto` provides in the
# Docker image; the generic `serif` is a last resort that at least lets
# fontconfig try rather than emitting notdef immediately.
DEVANAGARI_STACK = f'"{DEVANAGARI_FAMILY}", "Noto Sans Devanagari", serif'


@functools.lru_cache(maxsize=1)
def has_devanagari_font() -> bool:
    """True when the vendored face is present and non-empty."""
    try:
        return DEVANAGARI_FILE.is_file() and DEVANAGARI_FILE.stat().st_size > 0
    except OSError:
        return False


@functools.lru_cache(maxsize=1)
def font_face_css() -> str:
    """The `@font-face` block for the vendored Devanagari face.

    Returns an empty string when the file is absent — the stack then falls
    through to whatever the image provides, and `deva_span()` degrades.
    """
    if not has_devanagari_font():
        return ""
    return (
        "@font-face{"
        f'font-family:"{DEVANAGARI_FAMILY}";'
        f'src:url("{DEVANAGARI_FILE.as_uri()}") format("truetype");'
        f"font-weight:{DEVANAGARI_WEIGHT};"
        "font-style:normal;"
        "font-display:block;"
        "}"
        # Every Devanagari run in a generated document goes through this class.
        # The three declarations are the conjunct-safety contract, not styling:
        # the family, weight 400 (no synthetic bold), and no tracking.
        ".deva{"
        f"font-family:{DEVANAGARI_STACK};"
        f"font-weight:{DEVANAGARI_WEIGHT};"
        "letter-spacing:normal;"
        "font-synthesis:none;"
        "}"
    )


def deva_span(text: str, fallback: str = "") -> str:
    """Wrap a fixed Devanagari string for print.

    `text` is Devanagari; `fallback` is the Latin string to emit instead when no
    Devanagari face is available. A statutory document showing `▯▯▯▯` where a
    word belongs is a defect, so the degradation is deliberate and silent-safe:
    the reader gets fewer words, never broken ones.
    """
    if not has_devanagari_font():
        return html.escape(fallback)
    return f'<span class="deva">{html.escape(text)}</span>'


# ── Indian digit grouping ────────────────────────────────────────────────────
# `f"{n:,.2f}"` produces Western three-digit grouping (548,652.00). An Indian
# statutory document groups 2,2,3 (5,48,652.00) — `toLocaleString('en-IN')` in
# the design spec, `18-documents.md` §Numbers. This is the server-side twin.

def group_indian(value, decimals: int = 2) -> str:
    """Format a number with Indian 2,2,3 digit grouping.

    >>> group_indian(548652.2)
    '5,48,652.20'
    >>> group_indian(1234567890)
    '1,23,45,67,890.00'
    >>> group_indian(-4500)
    '-4,500.00'
    """
    try:
        num = float(value or 0)
    except (TypeError, ValueError):
        num = 0.0
    sign = "-" if num < 0 else ""
    whole, _, frac = f"{abs(num):.{decimals}f}".partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        # Everything above the last three digits groups in pairs, right to left.
        pairs = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        whole = ",".join(pairs + [tail])
    return f"{sign}{whole}.{frac}" if decimals else f"{sign}{whole}"
