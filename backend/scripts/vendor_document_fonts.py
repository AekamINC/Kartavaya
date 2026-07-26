#!/usr/bin/env python
"""vendor_document_fonts.py — reproduce `backend/assets/fonts/` from upstream.

Run this only to refresh or audit the vendored faces. The output is committed, so
a normal checkout needs neither this script nor a network connection — WeasyPrint
renders with `base_url=None` and must never fetch a font at request time.

    python backend/scripts/vendor_document_fonts.py

Why the faces are vendored at all
---------------------------------
`design-reference/Kartavaya Redesign/docs/brand.css` specifies Newsreader (display),
Inter (UI), Tiro Devanagari Hindi (Devanagari) and JetBrains Mono. None of the
first, third or fourth is a Debian package. Before this, `backend/Dockerfile`
installed `fonts-dejavu-core` and `fonts-noto` only, every named family missed,
and each stack fell through to its generic — so every generated PDF was silently
DejaVu. A statutory document rendering in the wrong face is a fidelity failure.

Two ways to fix that: `apt-get install` more font packages, or vendor the files
and declare them with `@font-face`. Vendoring is chosen because a wrong apt
package name fails the production image build, and because `@font-face` with a
`file://` URL is version-independent — it does not depend on fontconfig finding
anything. See `services/doc_fonts.py` for the declaration side.

Why Newsreader is instanced to statics
--------------------------------------
Google Fonts publishes Newsreader ONLY as two variable fonts with `opsz` and
`wght` axes — there are no static instances upstream. WeasyPrint 68 can consume a
variable font, but selecting a weight off an axis is renderer- and
version-dependent, and a face that silently renders at the wrong weight is the
same class of defect as the DejaVu fallback it replaces, one level subtler.

So the axes are pinned here, once, deterministically, with fontTools, and the
resulting single-weight faces are what ship. The three instances are exactly the
ones `brand.css` uses `--doc-font-display` for:

  - wght 400 roman   — body serif, `.orgnote` (italic sibling below)
  - wght 600 roman   — `.lh__name` (17pt) and `.lh__mark`
  - wght 400 italic  — `.orgnote`, `.pdf__cover-h1 em`

`opsz` is pinned to 16. The display serif is only used between roughly 14 and
52px in these documents, and Newsreader's optical size axis runs 6–72; 16 sits at
the low-display end where the letterforms still carry the intended contrast.
A single value is a deliberate simplification — recorded, not hidden.

Tiro Devanagari Hindi ships upstream as one static regular and is copied as-is.
It has a single weight by design; see `services/doc_fonts.py` for why that
matters to conjunct shaping.

Licences
--------
Both families are SIL Open Font License 1.1, which permits redistribution and
modification (instancing is a modification). `OFL-<family>.txt` is fetched
alongside each and committed. The OFL requires the licence travel with the font;
that is what those files are for.
"""

from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/google/fonts/main"
DEST = Path(__file__).resolve().parent.parent / "assets" / "fonts"

# family dir → (licence filename we write, [(upstream file, output file, axes)])
# axes=None means "copy verbatim, it is already static".
JOBS = [
    (
        "ofl/tirodevanagarihindi",
        "OFL.txt",
        [("TiroDevanagariHindi-Regular.ttf", "TiroDevanagariHindi-Regular.ttf", None)],
    ),
    (
        "ofl/newsreader",
        "OFL-Newsreader.txt",
        [
            ("Newsreader[opsz,wght].ttf", "Newsreader-Regular.ttf", {"opsz": 16, "wght": 400}),
            ("Newsreader[opsz,wght].ttf", "Newsreader-SemiBold.ttf", {"opsz": 16, "wght": 600}),
            ("Newsreader-Italic[opsz,wght].ttf", "Newsreader-Italic.ttf", {"opsz": 16, "wght": 400}),
        ],
    ),
]


def fetch(path: str) -> bytes:
    url = f"{RAW}/{path}"
    print(f"  fetch {url}")
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 - fixed https host
        return resp.read()


def main() -> int:
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError:
        print("fontTools is required: pip install fonttools", file=sys.stderr)
        return 1

    DEST.mkdir(parents=True, exist_ok=True)
    cache: dict[str, bytes] = {}

    for family_dir, licence_name, faces in JOBS:
        print(f"{family_dir}:")
        (DEST / licence_name).write_bytes(fetch(f"{family_dir}/{licence_name.replace('OFL-Newsreader', 'OFL')}"))

        for upstream, out_name, axes in faces:
            if upstream not in cache:
                cache[upstream] = fetch(f"{family_dir}/{upstream}")
            raw = cache[upstream]

            if axes is None:
                (DEST / out_name).write_bytes(raw)
                print(f"  wrote {out_name} ({len(raw):,} bytes, verbatim)")
                continue

            font = TTFont(io.BytesIO(raw))
            # inplace=False would double peak memory for no benefit here.
            instantiateVariableFont(font, axes, inplace=True, updateFontNames=True)
            buf = io.BytesIO()
            font.save(buf)
            (DEST / out_name).write_bytes(buf.getvalue())
            print(f"  wrote {out_name} ({len(buf.getvalue()):,} bytes, pinned {axes})")

    print("\nDone. Commit backend/assets/fonts/ — the files, not this script's output path.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
