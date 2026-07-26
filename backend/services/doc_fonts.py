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

# ── The vendored faces ───────────────────────────────────────────────────────
# Refreshed by `backend/scripts/vendor_document_fonts.py`, which documents how
# each file was produced. Newsreader ships upstream only as a variable font; the
# three faces here are pinned static instances, because selecting a weight off a
# variable axis is renderer-dependent and a face that silently renders at the
# wrong weight is the same defect as the DejaVu fallback it replaces.
DEVANAGARI_FAMILY = "Tiro Devanagari Hindi"
DEVANAGARI_WEIGHT = 400  # the only weight Tiro has; see module docstring
DISPLAY_FAMILY = "Newsreader"

_ASSETS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
DEVANAGARI_FILE = _ASSETS / "TiroDevanagariHindi-Regular.ttf"

# (file, family, weight, style)
_FACES = (
    (DEVANAGARI_FILE, DEVANAGARI_FAMILY, DEVANAGARI_WEIGHT, "normal"),
    (_ASSETS / "Newsreader-Regular.ttf", DISPLAY_FAMILY, 400, "normal"),
    (_ASSETS / "Newsreader-SemiBold.ttf", DISPLAY_FAMILY, 600, "normal"),
    (_ASSETS / "Newsreader-Italic.ttf", DISPLAY_FAMILY, 400, "italic"),
)

# Fallbacks, in order. Noto is what `fonts-noto` provides in the Docker image;
# the generic is a last resort that at least lets fontconfig try rather than
# emitting notdef immediately. The vendored family is named first so it wins.
DEVANAGARI_STACK = f'"{DEVANAGARI_FAMILY}", "Noto Sans Devanagari", serif'
DISPLAY_STACK = f'{DISPLAY_FAMILY}, "Noto Serif", Georgia, "DejaVu Serif", serif'


def _face_present(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


@functools.lru_cache(maxsize=1)
def has_devanagari_font() -> bool:
    """True when the vendored Devanagari face is present and non-empty."""
    return _face_present(DEVANAGARI_FILE)


@functools.lru_cache(maxsize=1)
def font_face_css() -> str:
    """`@font-face` declarations for every vendored face that is present.

    A `file://` src rather than a family name, so resolution does not depend on
    fontconfig finding anything — and no network request at render time, which
    `base_url=None` forbids anyway. A face whose file is missing is simply not
    declared; its stack then degrades onto Noto rather than failing.
    """
    blocks = []
    for path, family, weight, style in _FACES:
        if not _face_present(path):
            continue
        blocks.append(
            "@font-face{"
            f'font-family:"{family}";'
            f'src:url("{path.as_uri()}") format("truetype");'
            f"font-weight:{weight};"
            f"font-style:{style};"
            "font-display:block;"
            "}"
        )

    if has_devanagari_font():
        # Every Devanagari run in a generated document goes through this class.
        # The declarations are the conjunct-safety contract, not styling: the
        # family, weight 400 (no synthetic bold), and no tracking.
        blocks.append(
            ".deva{"
            f"font-family:{DEVANAGARI_STACK};"
            f"font-weight:{DEVANAGARI_WEIGHT};"
            "letter-spacing:normal;"
            "font-synthesis:none;"
            "}"
        )
    return "".join(blocks)


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
