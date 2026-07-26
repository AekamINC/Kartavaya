"""email_tokens.py — GENERATED. Do not edit by hand.

Literal design-token values for email. Email clients do not support CSS custom
properties, so every colour has to be a literal in the sent HTML.

    Regenerate:  python backend/scripts/build_email_tokens.py
    Verify:      python backend/scripts/build_email_tokens.py --check

Sources
    design-reference/Kartavaya Redesign/tokens.css   ink, brand, semantic
    design-reference/email-styles.css                the four paper surfaces
    design-reference/Kartavaya Redesign/Auth Emails.html   the rendered spec

Deviations from the literal spec value, with measured reasons:

  INK_3 = #666A61  (tokens.css --on-surface-3)
    Auth Emails.html uses #9DA096 for every micro-label and the whole footer
    (2.55:1 on the envelope, 2.25:1 on the card) and #74786F for secondary
    body text (4.32:1 / 3.81:1). Both carry content text and both fail AA.
    #9DA096 is tokens.css --on-surface-disabled, whose own comment reads
    'for INACTIVE CONTROLS ONLY ... Never for content'. --on-surface-3 is
    5.30:1 / 4.68:1 and is the token intended for this role.

  PRIMARY_TEXT = #046B64  (tokens.css --primary-text)
    Auth Emails.html paints the Devanagari module glyphs and the inline help
    link in #04837A — 4.44:1 on the envelope, 3.92:1 on the card they sit
    on. tokens.css:92 states the rule itself: '--primary is 4.04:1 — a fill,
    never text'. PRIMARY stays #04837A for button fills (white on it is
    4.63:1); brand-coloured TEXT resolves here instead, at 6.11:1 / 5.40:1.

  BUTTON_BG_DARK = #04837A  (tokens.css --primary (light), held in dark)
    tokens.css dark --primary is #4FD8CB, which needs a DARK label to be
    readable. A button whose label colour has to flip with the media query
    breaks in every client that applies one but not the other. #04837A with
    a white label is 4.63:1 and reads correctly against both schemes, so the
    button does not participate in the dark flip at all.

Contrast at build time (AA needs 4.5:1 for body text; the generator fails on any
text pair below it):
    16.27:1  #1B1D1A on #FCFAF5  headline + strong on envelope
     8.14:1  #4A4E48 on #FCFAF5  body text on envelope
     7.18:1  #4A4E48 on #F0ECDF  body text on card
     5.30:1  #666A61 on #FCFAF5  labels + footer on envelope
     4.68:1  #666A61 on #F0ECDF  labels on card
     4.99:1  #666A61 on #F6F3EC  footer on page
     6.11:1  #046B64 on #FCFAF5  brand text on envelope
     5.40:1  #046B64 on #F0ECDF  brand text on card
     4.63:1  #FFFFFF on #04837A  button label on primary fill
     6.30:1  #B42318 on #FCFAF5  danger text on envelope
    10.10:1  #4A2D00 on #FBE3BE  text on warn container
    14.79:1  #E9E7E1 on #12151A  dark: headline on envelope
     9.73:1  #BFBDB6 on #12151A  dark: body on envelope
     8.51:1  #BFBDB6 on #1D2229  dark: body on card
     5.50:1  #8E8D87 on #12151A  dark: labels on envelope
    10.47:1  #4FD8CB on #12151A  dark: link on envelope
     4.63:1  #FFFFFF on #04837A  dark: button label on held primary fill
"""

# ── Light ─────────────────────────────────────────────────────────────────────
PAGE_BG      = "#F6F3EC"   # email-styles.css --bg
SURFACE      = "#FCFAF5"   # email-styles.css --surface
SURFACE_2    = "#FFFFFF"   # email-styles.css --surface-2
CARD_BG      = "#F0ECDF"   # email-styles.css --bg-soft
RULE         = "#E2DCC9"   # email-styles.css --rule
RULE_SOFT    = "#EFE9D8"   # email-styles.css --rule-soft
OUTLINE      = "#D8D1BE"   # tokens.css --outline-variant
INK          = "#1B1D1A"   # tokens.css --on-surface
INK_2        = "#4A4E48"   # tokens.css --on-surface-2
PRIMARY      = "#04837A"   # tokens.css --primary — FILL ONLY, never text
ON_PRIMARY   = "#FFFFFF"   # tokens.css --on-primary
OK           = "#14743A"   # tokens.css --ok
WARN         = "#955806"   # tokens.css --warn
DANGER       = "#B42318"   # tokens.css --danger
OK_BG        = "#C6EFD2"   # tokens.css --ok-container
WARN_BG      = "#FBE3BE"   # tokens.css --warn-container
DANGER_BG    = "#FBDAD5"   # tokens.css --danger-container
ON_OK_BG     = "#06341A"   # tokens.css --on-ok-container
ON_WARN_BG   = "#4A2D00"   # tokens.css --on-warn-container
ON_DANGER_BG = "#5C1109"   # tokens.css --on-danger-container
INK_3        = "#666A61"   # tokens.css --on-surface-3
PRIMARY_TEXT = "#046B64"   # tokens.css --primary-text

# Auth Emails.html marks a platform-support request with a violet keyline so it
# reads as Aekam, not as the tenant. The colour is in neither token file — it is
# declared only in the rendered spec, so it is transcribed here on purpose.
PLATFORM_VIOLET = "#7C5CBF"   # Auth Emails.html support-access keyline

# ── Dark (prefers-color-scheme) ───────────────────────────────────────────────
D_PAGE_BG    = "#0C0E11"   # tokens.css dark --bg
D_SURFACE    = "#12151A"   # tokens.css dark --surface
D_CARD_BG    = "#1D2229"   # tokens.css dark --s-container
D_RULE       = "#333A43"   # tokens.css dark --outline-variant
D_INK        = "#E9E7E1"   # tokens.css dark --on-surface
D_INK_2      = "#BFBDB6"   # tokens.css dark --on-surface-2
D_INK_3      = "#8E8D87"   # tokens.css dark --on-surface-3
D_LINK       = "#4FD8CB"   # tokens.css dark --primary-text
D_DANGER     = "#F2867A"   # tokens.css dark --danger
D_WARN_BG    = "#4A3312"   # tokens.css dark --warn-container
D_ON_WARN_BG = "#FBE3BE"   # tokens.css dark --on-warn-container

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
