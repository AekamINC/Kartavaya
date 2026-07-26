#!/usr/bin/env python3
"""build_email_tokens.py — resolve design tokens into literal hex for email.

Email clients do not support CSS custom properties. `var(--primary)` in an email
resolves to nothing and the element paints transparent, so every colour has to be
a literal in the sent HTML.

The obvious way to get those literals is to read them off the design files and
type them into Python. That is how `#1A2230` ended up standing in for the spec's
`#1B1D1A` for the whole ink ramp — a hand-transcription drift nobody could see,
because both are near-black.

So this reads the design files instead, resolves `var()` chains, and writes
`backend/email_tokens.py`. Re-runnable and idempotent: CI can run it and diff.

    python backend/scripts/build_email_tokens.py            # write
    python backend/scripts/build_email_tokens.py --check    # verify, exit 1 on drift

The two sources
───────────────
`design-reference/Kartavaya Redesign/tokens.css`
    The root token layer for the whole product. Ink, brand and semantic colour
    come from here.

`design-reference/email-styles.css`
    The email layer. Its four paper surfaces (page / envelope / card / rule) are
    email-specific and `Auth Emails.html` reuses them unchanged, so they come
    from here.

Where the two disagree, `OVERRIDES` below names the winner and the reason.
That decision lives in one place on purpose.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TOKENS_CSS = REPO / "design-reference" / "Kartavaya Redesign" / "tokens.css"
EMAIL_CSS = REPO / "design-reference" / "email-styles.css"
OUT = REPO / "backend" / "email_tokens.py"

# Values these cannot survive an email client, so a token whose value contains any
# of them is dropped rather than emitted. calc() needs a layout engine; color-mix()
# is 2023+ CSS; gradients are dropped outright by Outlook's Word renderer.
UNUSABLE = ("calc(", "color-mix(", "linear-gradient(", "rgba(", "var(")


# ── CSS parsing ───────────────────────────────────────────────────────────────

def _blocks(css: str) -> list[tuple[str, str]]:
    """Yield (selector, body) for every top-level rule in the stylesheet."""
    out, depth, sel_start, i = [], 0, 0, 0
    while i < len(css):
        c = css[i]
        if c == "{":
            if depth == 0:
                sel = css[sel_start:i].strip()
                body_start = i + 1
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                out.append((sel, css[body_start:i]))
                sel_start = i + 1
        i += 1
    return out


def _strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _decls(body: str) -> dict[str, str]:
    """Parse `--name: value;` declarations out of a rule body."""
    found = {}
    for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body):
        found[name.strip()] = value.strip()
    return found


def read_vars(path: Path, selectors: tuple[str, ...]) -> dict[str, str]:
    """Collect custom properties from the named selectors, later rules winning."""
    css = _strip_comments(path.read_text(encoding="utf-8"))
    collected: dict[str, str] = {}
    for sel, body in _blocks(css):
        parts = [p.strip() for p in sel.split(",")]
        if any(p in selectors for p in parts):
            collected.update(_decls(body))
    return collected


def resolve(name: str, table: dict[str, str], _seen: frozenset = frozenset()) -> str | None:
    """Resolve a custom property through any chain of `var()` indirection."""
    if name in _seen:                       # a cycle; the file is malformed
        return None
    raw = table.get(name)
    if raw is None:
        return None
    m = re.fullmatch(r"var\((--[\w-]+)\)", raw.strip())
    if m:
        return resolve(m.group(1), table, _seen | {name})
    return raw.strip()


def hex_of(name: str, table: dict[str, str]) -> str:
    """Resolve to a literal hex colour, or raise — a silent miss is the bug this file exists to prevent."""
    v = resolve(name, table)
    if v is None:
        raise SystemExit(f"build_email_tokens: {name} is not defined in the source CSS")
    if any(bad in v for bad in UNUSABLE):
        raise SystemExit(f"build_email_tokens: {name} = {v!r} cannot be used in email")
    if not re.fullmatch(r"#[0-9A-Fa-f]{3,8}", v):
        raise SystemExit(f"build_email_tokens: {name} = {v!r} is not a literal hex colour")
    if len(v) == 4:                          # #abc -> #aabbcc
        v = "#" + "".join(c * 2 for c in v[1:])
    return v.upper()


# ── WCAG ──────────────────────────────────────────────────────────────────────

def _luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def contrast(fg: str, bg: str) -> float:
    a, b = _luminance(fg), _luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# ── Deliberate deviations from the literal spec ───────────────────────────────
#
# Each entry is a value `Auth Emails.html` uses that this build does NOT emit,
# with the measured reason. The standing rule in design-handover/_SOURCE-MAP.md is
# "a spec'd colour pair below 4.5:1 for body text is a spec defect to report, not
# a thing to ship" — these are those reports, in code, next to the fix.

OVERRIDES = [
    (
        "INK_3", "#666A61", "tokens.css --on-surface-3",
        "Auth Emails.html uses #9DA096 for every micro-label and the whole footer "
        "(2.55:1 on the envelope, 2.25:1 on the card) and #74786F for secondary "
        "body text (4.32:1 / 3.81:1). Both carry content text and both fail AA. "
        "#9DA096 is tokens.css --on-surface-disabled, whose own comment reads "
        "'for INACTIVE CONTROLS ONLY ... Never for content'. --on-surface-3 is "
        "5.30:1 / 4.68:1 and is the token intended for this role.",
    ),
    (
        "PRIMARY_TEXT", "#046B64", "tokens.css --primary-text",
        "Auth Emails.html paints the Devanagari module glyphs and the inline help "
        "link in #04837A — 4.44:1 on the envelope, 3.92:1 on the card they sit on. "
        "tokens.css:92 states the rule itself: '--primary is 4.04:1 — a fill, never "
        "text'. PRIMARY stays #04837A for button fills (white on it is 4.63:1); "
        "brand-coloured TEXT resolves here instead, at 6.11:1 / 5.40:1.",
    ),
    (
        "BUTTON_BG_DARK", "#04837A", "tokens.css --primary (light), held in dark",
        "tokens.css dark --primary is #4FD8CB, which needs a DARK label to be "
        "readable. A button whose label colour has to flip with the media query "
        "breaks in every client that applies one but not the other. #04837A with a "
        "white label is 4.63:1 and reads correctly against both schemes, so the "
        "button does not participate in the dark flip at all.",
    ),
]

# Surfaces are email-specific: Auth Emails.html reuses email-styles.css's paper
# values verbatim rather than tokens.css's (--bg #F3EFE6 / --surface #FAF7F0).
# Named here so the choice is visible rather than implied by which file is read.
SURFACE_SOURCE = "email-styles.css"


def build() -> str:
    tok_light = read_vars(TOKENS_CSS, (":root", '[data-theme="light"]'))
    tok_dark = dict(tok_light)
    tok_dark.update(read_vars(TOKENS_CSS, ('[data-theme="dark"]',)))
    em = read_vars(EMAIL_CSS, (":root",))

    T = lambda n: hex_of(n, tok_light)      # noqa: E731 — tokens.css, light
    D = lambda n: hex_of(n, tok_dark)       # noqa: E731 — tokens.css, dark
    E = lambda n: hex_of(n, em)             # noqa: E731 — email-styles.css

    light = [
        # (constant, value, provenance)
        ("PAGE_BG",   E("--bg"),        f"{SURFACE_SOURCE} --bg"),
        ("SURFACE",   E("--surface"),   f"{SURFACE_SOURCE} --surface"),
        ("SURFACE_2", E("--surface-2"), f"{SURFACE_SOURCE} --surface-2"),
        ("CARD_BG",   E("--bg-soft"),   f"{SURFACE_SOURCE} --bg-soft"),
        ("RULE",      E("--rule"),      f"{SURFACE_SOURCE} --rule"),
        ("RULE_SOFT", E("--rule-soft"), f"{SURFACE_SOURCE} --rule-soft"),

        ("OUTLINE", T("--outline-variant"), "tokens.css --outline-variant"),
        ("INK",     T("--on-surface"),      "tokens.css --on-surface"),
        ("INK_2",   T("--on-surface-2"),    "tokens.css --on-surface-2"),

        ("PRIMARY",    T("--primary"),    "tokens.css --primary — FILL ONLY, never text"),
        ("ON_PRIMARY", T("--on-primary"), "tokens.css --on-primary"),

        ("OK",        T("--ok"),        "tokens.css --ok"),
        ("WARN",      T("--warn"),      "tokens.css --warn"),
        ("DANGER",    T("--danger"),    "tokens.css --danger"),
        ("OK_BG",     T("--ok-container"),        "tokens.css --ok-container"),
        ("WARN_BG",   T("--warn-container"),      "tokens.css --warn-container"),
        ("DANGER_BG", T("--danger-container"),    "tokens.css --danger-container"),
        ("ON_OK_BG",     T("--on-ok-container"),     "tokens.css --on-ok-container"),
        ("ON_WARN_BG",   T("--on-warn-container"),   "tokens.css --on-warn-container"),
        ("ON_DANGER_BG", T("--on-danger-container"), "tokens.css --on-danger-container"),
    ]
    light += [(name, val, src) for name, val, src, _ in OVERRIDES if name != "BUTTON_BG_DARK"]

    dark = [
        ("D_PAGE_BG", D("--bg"),               "tokens.css dark --bg"),
        ("D_SURFACE", D("--surface"),          "tokens.css dark --surface"),
        ("D_CARD_BG", D("--s-container"),      "tokens.css dark --s-container"),
        ("D_RULE",    D("--outline-variant"),  "tokens.css dark --outline-variant"),
        ("D_INK",     D("--on-surface"),       "tokens.css dark --on-surface"),
        ("D_INK_2",   D("--on-surface-2"),     "tokens.css dark --on-surface-2"),
        ("D_INK_3",   D("--on-surface-3"),     "tokens.css dark --on-surface-3"),
        ("D_LINK",    D("--primary-text"),     "tokens.css dark --primary-text"),
        ("D_DANGER",  D("--danger"),           "tokens.css dark --danger"),
        ("D_WARN_BG", D("--warn-container"),   "tokens.css dark --warn-container"),
        ("D_ON_WARN_BG", D("--on-warn-container"), "tokens.css dark --on-warn-container"),
    ]

    values = {n: v for n, v, _ in light} | {n: v for n, v, _ in dark}

    # ── The gate. Every text pair the templates actually use. ─────────────────
    # A pair listed here at below 4.5:1 fails the build. That is the whole point:
    # a future token edit that quietly breaks email contrast cannot land silently.
    S, C, P = values["SURFACE"], values["CARD_BG"], values["PAGE_BG"]
    checks = [
        (values["INK"],   S, "headline + strong on envelope"),
        (values["INK_2"], S, "body text on envelope"),
        (values["INK_2"], C, "body text on card"),
        (values["INK_3"], S, "labels + footer on envelope"),
        (values["INK_3"], C, "labels on card"),
        (values["INK_3"], P, "footer on page"),
        (values["PRIMARY_TEXT"], S, "brand text on envelope"),
        (values["PRIMARY_TEXT"], C, "brand text on card"),
        (values["ON_PRIMARY"], values["PRIMARY"], "button label on primary fill"),
        (values["DANGER"], S, "danger text on envelope"),
        (values["ON_WARN_BG"], values["WARN_BG"], "text on warn container"),
        (values["D_INK"],   values["D_SURFACE"], "dark: headline on envelope"),
        (values["D_INK_2"], values["D_SURFACE"], "dark: body on envelope"),
        (values["D_INK_2"], values["D_CARD_BG"], "dark: body on card"),
        (values["D_INK_3"], values["D_SURFACE"], "dark: labels on envelope"),
        (values["D_LINK"],  values["D_SURFACE"], "dark: link on envelope"),
        (values["ON_PRIMARY"], values["PRIMARY"], "dark: button label on held primary fill"),
    ]
    failures = []
    report = []
    for fg, bg, label in checks:
        r = contrast(fg, bg)
        report.append(f"    {r:5.2f}:1  {fg} on {bg}  {label}")
        if r < 4.5:
            failures.append(f"  {r:.2f}:1  {fg} on {bg}  — {label}")
    if failures:
        raise SystemExit(
            "build_email_tokens: WCAG AA gate failed for text pairs:\n"
            + "\n".join(failures)
            + "\n\nEmail body text needs 4.5:1. Fix the token or add a documented "
              "override in OVERRIDES with the measured reason."
        )

    # ── Emit ──────────────────────────────────────────────────────────────────
    def const_block(rows):
        w = max(len(n) for n, _, _ in rows)
        return "\n".join(f'{n.ljust(w)} = "{v}"   # {src}' for n, v, src in rows)

    override_notes = "\n".join(
        f"\n  {name} = {val}  ({src})\n"
        + "\n".join(f"    {ln}" for ln in _wrap(reason, 72))
        for name, val, src, reason in OVERRIDES
    )

    return f'''"""email_tokens.py — GENERATED. Do not edit by hand.

Literal design-token values for email. Email clients do not support CSS custom
properties, so every colour has to be a literal in the sent HTML.

    Regenerate:  python backend/scripts/build_email_tokens.py
    Verify:      python backend/scripts/build_email_tokens.py --check

Sources
    design-reference/Kartavaya Redesign/tokens.css   ink, brand, semantic
    design-reference/email-styles.css                the four paper surfaces
    design-reference/Kartavaya Redesign/Auth Emails.html   the rendered spec

Deviations from the literal spec value, with measured reasons:
{override_notes}

Contrast at build time (AA needs 4.5:1 for body text; the generator fails on any
text pair below it):
{chr(10).join(report)}
"""

# ── Light ─────────────────────────────────────────────────────────────────────
{const_block(light)}

# Auth Emails.html marks a platform-support request with a violet keyline so it
# reads as Aekam, not as the tenant. The colour is in neither token file — it is
# declared only in the rendered spec, so it is transcribed here on purpose.
PLATFORM_VIOLET = "#7C5CBF"   # Auth Emails.html support-access keyline

# ── Dark (prefers-color-scheme) ───────────────────────────────────────────────
{const_block(dark)}

# ── Type ──────────────────────────────────────────────────────────────────────
# No webfonts. Gmail, Outlook.com and Yahoo all strip <link> from email, so a
# webfont declared that way never loads and every family silently falls through.
# Auth Emails.html accepts this and specifies Georgia for display — present on
# every Windows, macOS, iOS and Android device.
FONT_DISPLAY = "Georgia, 'Times New Roman', Times, serif"

# Inter leads because a handful of clients (Apple Mail, some Outlook desktop) do
# honour an embedded @font-face and the app UI is Inter. The named system faces
# after it are what almost everyone actually gets.
FONT_UI = ("Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
           "'Helvetica Neue', Arial, sans-serif")

# Auth Emails.html:282 sets the rule for Devanagari in email outright: "the Hindi
# webfont must be declared with a serif fallback — most clients will render the
# fallback and that is fine." So Tiro leads, but the fallback has to be a font
# that can actually draw Devanagari: Georgia and Newsreader have ZERO coverage,
# and a stack that ends at the bare generic hands the choice to the client.
#   Nirmala UI            Windows 8+
#   Kohinoor Devanagari   macOS / iOS
#   Devanagari Sangam MN  older macOS / iOS
#   Android reaches Noto Sans Devanagari through system fallback unnamed
# Georgia sits before the generic so the LATIN run of a mixed string stays on the
# display face instead of being drawn with a Devanagari font's Latin glyphs.
# Matches the --font-hindi stack in frontend styles, measured at Tiro's own width.
FONT_HINDI = ("'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Nirmala UI', "
              "'Kohinoor Devanagari', 'Devanagari Sangam MN', Georgia, serif")

FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
'''


def _wrap(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="verify the committed file matches the design sources; exit 1 on drift")
    args = ap.parse_args()

    generated = build()

    if args.check:
        if not OUT.exists():
            print(f"MISSING {OUT}", file=sys.stderr)
            return 1
        if OUT.read_text(encoding="utf-8") != generated:
            print(f"DRIFT {OUT} does not match the design sources — re-run without --check",
                  file=sys.stderr)
            return 1
        print(f"OK {OUT.relative_to(REPO)} matches the design sources")
        return 0

    OUT.write_text(generated, encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
