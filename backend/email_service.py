"""email_service.py — Kartavaya by Aekam Inc
Sends via AWS SES when configured; logs to console otherwise (dev/test mode).
Table-based layout — Outlook 2019+ / Gmail / Apple Mail / Gmail Android compatible.
"""
import logging
import os
import re
import threading
from html import escape as _h

logger = logging.getLogger(__name__)

FROM_EMAIL   = os.environ.get("FROM_EMAIL",   "Kartavaya <no-reply@aekaminc.com>")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://kartavaya.com")

# ── Email provider: Resend (primary) or AWS SES (fallback) ────────────────────
RESEND_API_KEY        = os.environ.get("RESEND_API_KEY")
AWS_ACCESS_KEY_ID     = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_REGION            = os.environ.get("AWS_REGION", "us-east-1")

_resend_client = None
ses_client = None

if RESEND_API_KEY:
    try:
        import resend as _resend_lib
        _resend_lib.api_key = RESEND_API_KEY
        _resend_client = _resend_lib
        logger.info("✅ Resend email configured")
    except ImportError:
        logger.error("❌ resend not installed — pip install resend")
elif AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
    try:
        import boto3
        ses_client = boto3.client(
            "ses",
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION,
        )
        logger.info("✅ AWS SES configured (Region: %s)", AWS_REGION)
    except ImportError:
        logger.error("❌ boto3 not installed — pip install boto3")
    except Exception as e:
        logger.error("❌ AWS SES init failed: %s", e)
else:
    logger.warning("⚠️  No email provider configured (set RESEND_API_KEY or AWS_ACCESS_KEY_ID) — emails logged to console only")


# ── Design tokens ─────────────────────────────────────────────────────────────
# Literal hex, resolved from the design files by
# `python backend/scripts/build_email_tokens.py`. Never hand-edit email_tokens.py
# and never write a raw hex below — email clients drop var(), so a colour typed
# here by hand is a colour nobody can trace back to a token.
from email_tokens import (                                          # noqa: E402
    PAGE_BG, SURFACE, SURFACE_2, CARD_BG, RULE, RULE_SOFT, OUTLINE,
    INK, INK_2, INK_3, PRIMARY, PRIMARY_TEXT, ON_PRIMARY,
    OK, WARN, DANGER, OK_BG, WARN_BG, DANGER_BG,
    ON_OK_BG, ON_WARN_BG, ON_DANGER_BG, PLATFORM_VIOLET,
    FONT_DISPLAY, FONT_UI, FONT_HINDI, FONT_MONO,
    D_PAGE_BG as PAGE_BG_D, D_SURFACE as SURFACE_D, D_CARD_BG as CARD_BG_D,
    D_RULE as RULE_D, D_INK as INK_D, D_INK_2 as INK_2_D, D_INK_3 as INK_3_D,
    D_LINK as LINK_D, D_WARN_BG as WARN_BG_D, D_ON_WARN_BG as ON_WARN_BG_D,
)

# Legacy private aliases. `services/employee_email.py` imports `_INK3`, and the
# report builder below is ~300 lines of f-strings using the underscore names.
# Kept as aliases rather than renamed so this conversion is a design change and
# not also a 300-line rename nobody can review.
_BG         = PAGE_BG
_BG_SOFT    = CARD_BG
_SURFACE    = SURFACE
_RULE       = RULE
_RULE_SOFT  = RULE_SOFT
_INK        = INK
_INK2       = INK_2
_INK3       = INK_3
_TEAL       = PRIMARY_TEXT     # was #05b7aa — 2.41:1 as text, see report E-02
_MID        = PRIMARY_TEXT     # was #03a1b6 — 2.97:1 as text
_DEEP       = PRIMARY_TEXT     # was #0082c6 — 4.02:1 as text
_OK_BG      = OK_BG
_OK_BORDER  = OK
_WARN_BG    = WARN_BG
_WARN_BORD  = WARN
_DANGER_BG  = DANGER_BG
_DANGER_BOR = DANGER

_FONT_DISP  = FONT_DISPLAY
_FONT_UI    = FONT_UI
_FONT_HINDI = FONT_HINDI

# Devanagari script range. Used to split a mixed "LATIN · देवनागरी" label so the
# tracking and uppercasing only ever touch the Latin run — see `_kicker_html`.
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")

MARK_URL = f"{FRONTEND_URL}/kartavaya-mark.png"


def _safe_subject(s: str) -> str:
    """Strip CR/LF from email subject values to prevent SMTP header injection."""
    return str(s).replace("\r", "").replace("\n", "")


def _preheader(text: str) -> str:
    """Return an invisible preheader div shown in email client preview text."""
    # The trailing entities push the recipient's own quoted body out of the
    # preview strip, which otherwise appends the first line of the email to it.
    return (f'<div style="display:none;font-size:1px;color:{PAGE_BG};line-height:1px;'
            f'max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{_h(text)}'
            f'{"&#847;&zwnj;&nbsp;" * 30}</div>')


def _kicker_html(kicker: str) -> str:
    """Render the eyebrow label, keeping tracking and uppercase off Devanagari.

    `24-bilingual-devanagari.md` §"Never set letter-spacing on Devanagari" —
    tracking splits conjunct ligatures, so क्ष and ज्ञ draw as two glyphs with a
    gap — and §"never text-transform: uppercase", because Devanagari is unicase
    so the transform silently changes only the Latin half of the pair.

    16 templates pass a kicker shaped `LATIN · देवनागरी` ("LEAVE · अवकाश",
    "PASSWORD RESET · पासवर्ड रीसेट"). Splitting on the separator here fixes all
    16 without touching a single call site.
    """
    if not kicker:
        return ""
    latin, sep, deva = kicker.partition("·")
    latin, deva = latin.strip(), deva.strip()
    if not (sep and _DEVANAGARI.search(deva)):
        # No Devanagari to protect — but a Devanagari-only kicker must still not
        # be tracked or uppercased.
        if _DEVANAGARI.search(kicker):
            return (f'<span lang="hi" style="font-family:{FONT_HINDI};font-size:12px;'
                    f'color:{INK_3};font-weight:400;">{_h(kicker)}</span>')
        return (f'<span style="font-family:{FONT_UI};font-size:9px;font-weight:600;'
                f'letter-spacing:1.8px;text-transform:uppercase;color:{INK_3};">'
                f'{_h(kicker)}</span>')
    return (
        f'<span style="font-family:{FONT_UI};font-size:9px;font-weight:600;'
        f'letter-spacing:1.8px;text-transform:uppercase;color:{INK_3};">{_h(latin)}</span>'
        f'<span style="color:{INK_3};">&nbsp;·&nbsp;</span>'
        f'<span lang="hi" style="font-family:{FONT_HINDI};font-size:12px;'
        f'color:{INK_3};font-weight:400;letter-spacing:normal;text-transform:none;">'
        f'{_h(deva)}</span>'
    )


def _head_css() -> str:
    """<style> block: dark-mode overrides and the small-screen stack.

    Two things worth knowing about this block.

    Dark mode is *additive only*. Every colour-bearing cell in the document also
    carries an inline background, so a client that ignores `<style>` (Gmail on
    Android strips it in some configurations) renders the light design intact
    rather than half-converted. The previous version restyled four classes and
    left the page, footer, info card, tiles and button light — light text on
    light chrome, which is worse than no dark mode at all.

    The button deliberately does not flip. Dark `--primary` is #4FD8CB and needs
    a dark label; a button whose label colour has to change with the media query
    breaks in any client that applies one declaration but not the other. #04837A
    with a white label is 4.63:1 and reads correctly against both schemes.
    """
    return f"""
<style type="text/css">
@media (prefers-color-scheme:dark) {{
  .em__page      {{ background:{PAGE_BG_D} !important; }}
  .em__envelope  {{ background:{SURFACE_D} !important; border-color:{RULE_D} !important; }}
  .em__card      {{ background:{CARD_BG_D} !important; border-color:{RULE_D} !important; }}
  .em__hairline  {{ border-color:{RULE_D} !important; }}
  .em__ink, .em__ink *  {{ color:{INK_D} !important; }}
  .em__ink2, .em__ink2 * {{ color:{INK_2_D} !important; }}
  .em__ink3, .em__ink3 * {{ color:{INK_3_D} !important; }}
  .em__link      {{ color:{LINK_D} !important; }}
  .em__warn      {{ background:{WARN_BG_D} !important; }}
  .em__warn, .em__warn * {{ color:{ON_WARN_BG_D} !important; }}
  .em__tile      {{ background:{CARD_BG_D} !important; border-color:{RULE_D} !important; }}
}}
@media screen and (max-width:600px) {{
  .em__envelope {{ width:100% !important; max-width:100% !important; border-radius:0 !important; }}
  .em__pad      {{ padding-left:20px !important; padding-right:20px !important; }}
  .em__h1       {{ font-size:23px !important; }}
  .em__cta-cell {{ display:block !important; width:100% !important; padding:0 0 10px !important; }}
  .em__cta-btn  {{ display:block !important; width:100% !important; box-sizing:border-box !important; }}
  .em__tile-row, .em__tile-cell {{ display:block !important; width:100% !important; }}
}}
</style>"""


def _base(preheader: str, kicker: str, headline: str, sanskrit: str,
          lede: str, body_rows: str, show_gita: bool = False,
          accent: str = None, footer_note: str = None) -> str:
    """Assemble the full HTML email document from layout components and body rows.

    Geometry, type and colour follow
    `design-reference/Kartavaya Redesign/Auth Emails.html`: 600px envelope,
    14px radius, table layout, `role="presentation"`, inline styles, no external
    stylesheet and no webfont link.

    `kicker`, `headline` and `sanskrit` are escaped **here**. They were previously
    interpolated raw, and 9 callers in `services/employee_email.py` passed
    employee names and announcement titles straight through. Escaping at the
    choke point covers every present and future caller, which is the same
    argument `outbound.py` makes for guarding sends in one place.

    `lede` and `body_rows` stay HTML-bearing — callers legitimately pass
    `<strong>` — so those two remain the caller's responsibility.

    `accent` paints a 4px keyline across the top of the envelope. Used by the
    platform-support template to mark the mail as Aekam rather than the tenant.
    """
    keyline = ""
    if accent:
        keyline = (f'<tr><td style="height:4px;background:{accent};'
                   f'font-size:0;line-height:0;">&nbsp;</td></tr>')

    gita = ""
    if show_gita:
        gita = (f'<tr><td class="em__ink3" lang="sa" style="padding:0 0 18px;'
                f'font-family:{FONT_HINDI};font-size:14px;color:{INK_3};'
                f'text-align:center;letter-spacing:normal;">'
                f'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन'
                f'<span style="font-family:{FONT_DISPLAY};font-style:italic;font-size:12px;">'
                f' — Bhagavad Gita 2.47</span></td></tr>')

    kicker_html = _kicker_html(kicker)
    kicker_row = (f'<tr><td style="padding-bottom:10px;">{kicker_html}</td></tr>'
                  if kicker_html else '')

    sanskrit_row = ''
    if sanskrit:
        sanskrit_row = (
            f'<p lang="hi" class="em__ink3" style="margin:12px 0 0;font-family:{FONT_HINDI};'
            f'font-size:15px;font-weight:400;color:{INK_3};letter-spacing:normal;">'
            f'{_h(sanskrit)}</p>')

    lede_row = ''
    if lede:
        lede_row = (
            f'<p class="em__ink2" style="margin:18px 0 0;font-family:{FONT_UI};font-size:14px;'
            f'font-weight:400;color:{INK_2};line-height:1.68;">{lede}</p>')

    note = footer_note or (
        "You are receiving this because you are a member or invitee of a "
        "Kartavaya workspace. If you did not expect it, you can safely ignore it.")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="format-detection" content="telephone=no">
<!-- Declares the document handles both schemes, which is what stops Apple Mail
     and Outlook.com applying their own blanket inversion on top of ours. -->
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Kartavaya</title>
{_head_css()}
</head>
<body class="em__page" style="margin:0;padding:0;background:{PAGE_BG};
  -webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
{_preheader(preheader)}
<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><![endif]-->
<table role="presentation" class="em__page" width="100%" cellpadding="0" cellspacing="0"
  border="0" style="background:{PAGE_BG};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" class="em__envelope" width="600" cellpadding="0" cellspacing="0"
      border="0" style="width:600px;max-width:600px;background:{SURFACE};
      border:1px solid {RULE};border-radius:14px;overflow:hidden;">
      {keyline}
      <!-- brand lockup: mark + wordmark, so a blocked-image inbox still reads
           "Kartavaya · by Aekam Inc" rather than an empty box -->
      <tr><td class="em__pad" style="padding:26px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding-right:11px;">
            <img src="{MARK_URL}" width="34" height="34" alt="Kartavaya"
              style="display:block;border-radius:8px;border:0;outline:none;text-decoration:none;"></td>
          <td>
            <div class="em__ink" style="font-family:{FONT_DISPLAY};font-size:18px;
              font-weight:500;color:{INK};line-height:1.1;">Kartavaya</div>
            <div class="em__ink3" style="font-family:{FONT_UI};font-size:8.5px;font-weight:600;
              letter-spacing:2px;text-transform:uppercase;color:{INK_3};padding-top:3px;">by Aekam Inc</div>
          </td>
        </tr></table>
      </td></tr>
      <!-- kicker / headline / Devanagari subhead / lede -->
      <tr><td class="em__pad" style="padding:26px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          {kicker_row}
          <tr><td>
            <h1 class="em__h1 em__ink" style="margin:0;font-family:{FONT_DISPLAY};font-size:27px;
              font-weight:400;color:{INK};letter-spacing:-.5px;line-height:1.2;">{_h(headline)}</h1>
            {sanskrit_row}
            {lede_row}
          </td></tr>
        </table>
      </td></tr>
      {body_rows}
      <!-- footer -->
      <tr><td class="em__pad" style="padding:24px 32px 26px;">
        <table role="presentation" class="em__hairline" width="100%" cellpadding="0"
          cellspacing="0" border="0" style="border-top:1px solid {RULE};">
          {gita}
          <tr><td class="em__ink3" style="padding-top:16px;font-family:{FONT_UI};font-size:11px;
            color:{INK_3};line-height:1.6;">
            {_h(note)}<br>
            Aekam Inc &middot; Ahmedabad, IN &nbsp;&middot;&nbsp;
            <a class="em__link" href="{FRONTEND_URL}/dashboard"
              style="color:{PRIMARY_TEXT};text-decoration:none;">Open Kartavaya</a>
            &nbsp;&middot;&nbsp;
            <a class="em__link" href="{FRONTEND_URL}/settings/notifications"
              style="color:{PRIMARY_TEXT};text-decoration:none;">Notification settings</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</body></html>"""


def _task_card(task_title: str, project: str = None, priority: str = None,
               due_date: str = None, note: str = None) -> str:
    """Render a styled task-detail card row for embedding in an email body."""
    rows = (f'<tr><td class="em__ink" style="padding:16px 18px 6px;font-family:{FONT_DISPLAY};'
            f'font-size:17px;font-weight:500;color:{INK};line-height:1.3;">'
            f'{_h(task_title)}</td></tr>')
    if project or priority or due_date:
        meta_items = []
        if project:  meta_items.append(f'<strong style="color:{INK_2};">Project:</strong> {_h(project)}')
        if priority: meta_items.append(f'<strong style="color:{INK_2};">Priority:</strong> {_h(priority)}')
        if due_date: meta_items.append(f'<strong style="color:{INK_2};">Due:</strong> {_h(due_date)}')
        rows += (f'<tr><td class="em__ink3" style="padding:0 18px 16px;font-family:{FONT_UI};'
                 f'font-size:13px;color:{INK_3};line-height:1.6;">'
                 + ' &nbsp;·&nbsp; '.join(meta_items) + '</td></tr>')
    if note:
        rows += (f'<tr><td class="em__ink2 em__hairline" style="padding:12px 18px 16px;'
                 f'font-family:{FONT_UI};font-size:13.5px;color:{INK_2};font-style:italic;'
                 f'line-height:1.6;border-top:1px solid {RULE};">'
                 f'&ldquo;{_h(note)}&rdquo;</td></tr>')
    return (f'<tr><td class="em__pad" style="padding:20px 32px 0;">'
            f'<table role="presentation" class="em__card" width="100%" cellpadding="0" '
            f'cellspacing="0" border="0" style="background:{CARD_BG};border-radius:10px;">'
            f'{rows}</table></td></tr>')


def _cta_row(primary_url: str, primary_label: str, primary_style: str = "primary",
             ghost_url: str = None, ghost_label: str = None) -> str:
    """Render a CTA button row with an optional quieter secondary action.

    Flat fill, no gradient. The previous version emitted
    `background-color:#05b7aa;background:linear-gradient(...)`. Outlook's Word
    rendering engine drops the gradient and keeps the flat colour, so every
    Outlook recipient saw a white label on #05b7aa — **2.51:1**, on the product's
    primary call to action. `Auth Emails.html` uses a flat #04837A (4.63:1 with a
    white label) and has no fallback to get wrong.

    `primary_style="approve"` no longer paints a second brand colour. An approve
    and a proceed button are the same affordance; the previous #0A7A6E green was
    in neither token file.
    """
    ghost_cell = ""
    if ghost_url:
        # Quieter, not a competing filled button — Auth Emails.html renders
        # "Decline" as a bare link beside "Accept invitation".
        ghost_cell = (f'<td class="em__cta-cell" align="center" style="padding-left:10px;">'
                      f'<a class="em__cta-btn em__ink3" href="{_h(ghost_url)}" '
                      f'style="display:inline-block;padding:13px 20px;font-family:{FONT_UI};'
                      f'font-size:14px;font-weight:600;color:{INK_3};text-decoration:none;'
                      f'text-align:center;">{_h(ghost_label)}</a></td>')
    return (f'<tr><td class="em__pad" style="padding:22px 32px 0;">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td class="em__cta-cell" style="background:{PRIMARY};border-radius:9px;">'
            f'<a class="em__cta-btn" href="{_h(primary_url)}" '
            f'style="display:inline-block;padding:13px 26px;font-family:{FONT_UI};'
            f'font-size:14px;font-weight:600;color:{ON_PRIMARY};text-decoration:none;'
            f'text-align:center;">{_h(primary_label)}</a></td>'
            f'{ghost_cell}'
            f'</tr></table></td></tr>')


def _body_text(text: str) -> str:
    """Wrap a paragraph of HTML text in a standard body-text table row.

    `text` is HTML — callers pass `<strong>`. It is the caller's job to escape
    every interpolated value before it gets here.
    """
    return (f'<tr><td class="em__pad em__ink2" style="padding:18px 32px 0;'
            f'font-family:{FONT_UI};font-size:14px;font-weight:400;line-height:1.68;'
            f'color:{INK_2};">{text}</td></tr>')


def _quote_block(html: str, accent: str = None) -> str:
    """Render a quoted excerpt — a comment body, a mention, a support agent's reason.

    `html` must already be escaped by the caller; it is an excerpt of user text.
    """
    edge = f'border-left:3px solid {accent};' if accent else ''
    return (f'<tr><td class="em__pad" style="padding:20px 32px 0;">'
            f'<table role="presentation" class="em__card" width="100%" cellpadding="0"'
            f' cellspacing="0" border="0" style="background:{CARD_BG};{edge}'
            f'border-radius:0 10px 10px 0;">'
            f'<tr><td class="em__ink2" style="padding:14px 18px;font-family:{FONT_UI};'
            f'font-size:13.5px;color:{INK_2};font-style:italic;line-height:1.66;">'
            f'{html}</td></tr></table></td></tr>')


def _fallback_url(url: str, label: str = "Button not working? Paste this into your browser:") -> str:
    """Render the plain-text copy of a magic link.

    `Auth Emails.html` #reset carries this under every tokenised button. A signer
    or invitee whose client strips the anchor otherwise has no way through.
    """
    return (f'<tr><td class="em__pad em__ink3" style="padding:14px 32px 0;'
            f'font-family:{FONT_MONO};font-size:11px;color:{INK_3};line-height:1.6;'
            f'word-break:break-all;">{_h(label)}<br>{_h(url)}</td></tr>')


def to_plaintext(html_doc: str) -> str:
    """Derive the `text/plain` alternative from a rendered email document.

    Every email this product sends was HTML-only. That is wrong on three counts
    and only one of them is cosmetic:

      * Spam scoring. A `multipart/alternative` with no text part is one of the
        oldest heuristics there is. The mail that suffers most is the one sent
        to a stranger — a signature request or an invoice going to a client's
        customer, from a domain that recipient has never corresponded with.
      * Clients that prefer text. Screen readers, watch notifications, plain
        digest views and locked-down corporate gateways all take the text part
        when one exists and render a tag-stripped soup of the HTML when it does
        not.
      * The links. A tag-stripped HTML document loses every `href`, so the
        recipient of a magic link is left with the words "Accept invitation"
        and nowhere to go.

    So the anchors are rewritten as `label <url>` rather than dropped, which is
    what makes this a usable alternative rather than a formality.

    The preheader div is removed first. It is `display:none` decoration whose
    trailing entity padding exists purely to push quoted text out of a preview
    strip; in a text part it would surface as the first thing the reader sees,
    followed by 30 invisible spaces.
    """
    s = html_doc
    # Order matters: kill invisible/structural content before flattening.
    s = re.sub(r"<div[^>]*mso-hide:all[^>]*>.*?</div>", "", s, flags=re.S | re.I)
    s = re.sub(r"<(script|style|title|head)\b.*?</\1>", "", s, flags=re.S | re.I)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)

    # Anchors carry the only information a stripped document cannot recover.
    # A label identical to its own href (the fallback-URL row) is not doubled.
    #
    # The URL is parked between NULs rather than written as `<url>` directly:
    # the tag strip below cannot tell `<https://…>` from a tag and ate every
    # link in the first cut of this. NUL cannot occur in the source document,
    # so the sentinel can never collide with content.
    def _anchor(m):
        href, label = m.group(1).strip(), re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if not href or href.startswith("#"):
            return label
        return f"\x00{href}\x00" if (not label or label == href) else f"{label} \x00{href}\x00"

    s = re.sub(r'<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>', _anchor, s, flags=re.S | re.I)

    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|h1|h2|h3|div|tr|table|li)>", "\n", s, flags=re.I)
    s = re.sub(r"</td>", "  ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)

    from html import unescape as _u
    s = _u(s)
    # &#847;&zwnj;&nbsp; padding and NBSP survive unescaping as real characters.
    s = s.replace("‌", "").replace("͏", "").replace("\xa0", " ")
    s = "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines())
    # A line holding nothing but a separator is an artefact of the footer's
    # `&nbsp;·&nbsp;` between anchors; fold it back onto the line above.
    s = re.sub(r"\n[·|-]\n", " · ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    # Unpark the URLs only now that no further tag-shaped strip will run.
    s = re.sub(r"\x00([^\x00]*)\x00", r"<\1>", s)
    return s.strip()


def _notice(text: str, tone: str = "warn") -> str:
    """Render a filled notice strip — the amber block under the reset button."""
    bg, fg = (WARN_BG, ON_WARN_BG) if tone == "warn" else (CARD_BG, INK_2)
    cls = "em__warn" if tone == "warn" else "em__card"
    return (f'<tr><td class="em__pad" style="padding:20px 32px 0;">'
            f'<table role="presentation" class="{cls}" width="100%" cellpadding="0" '
            f'cellspacing="0" border="0" style="background:{bg};border-radius:10px;">'
            f'<tr><td style="padding:14px 16px;font-family:{FONT_UI};font-size:13px;'
            f'color:{fg};line-height:1.6;">{text}</td></tr></table></td></tr>')


# ── Core send (threaded) ───────────────────────────────────────────────────────
def send_email(to_email: str, subject: str, html_content: str,
               reply_to: str = None, *,
               purpose: str | None = None, ref: str | None = None) -> bool:
    """Send an HTML email via Resend or AWS SES in a background thread, logging in dev mode.

    Returns True the instant the thread is handed off, which is why this
    function's return value is worth nothing as evidence of a send — see the
    comment on `_send` below. `staging.outbound_log` is where the answer is.

    `purpose` is what the mail was FOR — 'payslip', 'invite', 'password_reset'.
    It is keyword-only and optional, so a sender that does not pass one still
    produces a correct row; the row is simply filed under 'unclassified'. 098
    says of that bucket: "watch that count fall. If it is still most of the
    table in a month, question 1 cannot be broken down and this column is
    decoration." Question 1 is "what did we send this org", and it is the one
    the owner asked. Every sender in this file and in
    `services/employee_email.py` now names itself; the ~20 callers in routers
    and skills still do not.

    `ref` is what caused it — 'payslip:PS-2026-08-42'. Its head becomes the
    purpose when none is given, and the whole string is kept in `detail.ref`,
    which is what tells two otherwise identical monthly sends apart.
    """
    # Single choke point for every email in the product — services/employee_email.py
    # and all routers go through here, so guarding this covers them all. `begin`
    # rather than `suppressed` because this sender CAN say what the provider
    # answered, and the handle is what carries that answer back to the row the
    # gate already wrote.
    from outbound import begin

    # Sized before the gate deliberately: `bytes` is the figure the SES invoice
    # is reconciled against, and a suppressed staging send is the one case where
    # knowing what it WOULD have cost is the whole point. The HTML document is
    # the payload; the text alternative derived below is smaller and is added to
    # the total once the gate has opened, because deriving it costs a dozen
    # regex passes and a suppressed send should not pay for them.
    html_bytes = len(html_content.encode("utf-8"))
    att = begin("email", to_email, subject, bytes=html_bytes,
                purpose=purpose, ref=ref)
    if att.blocked:
        return True

    # WHICH ADDRESS THIS LEAVES FROM, decided from the SAME `purpose` the log
    # row is filed under. `purpose` was already here and already meant "what was
    # this mail for"; a second parameter beside it would be a second thing every
    # future sender has to remember, and the two would drift.
    #
    # `plan()` HERE AND NOT IN THE THREAD, for the reason `begin()` is here and
    # not in the thread: the org lives in a ContextVar the request set, a plain
    # `threading.Thread` starts with an EMPTY context, and a read from in there
    # returns None without raising or warning. This line is still on the
    # caller's thread. It does no I/O — it captures the org and the event loop
    # and returns.
    #
    # `ref` feeds it too, because `outbound._row` derives the purpose from a
    # ref's head when no purpose is given ('payslip:PS-2026-08-42' -> 'payslip')
    # and this must agree with the row the log wrote, or the address and the
    # audit trail describe two different messages.
    from services import email_senders
    from_plan = email_senders.plan(
        purpose or (str(ref).partition(":")[0] if ref else None), FROM_EMAIL,
    )

    # Derived once, outside the thread: a regex pass per send is wasted work and
    # a failure in here must surface as a normal exception, not inside a thread
    # whose traceback nobody reads.
    text_content = to_plaintext(html_content)

    # What we hand the provider, in bytes. Not the exact figure SES meters —
    # headers and MIME framing are added downstream — but it is the part that
    # varies by orders of magnitude between a one-line notification and a report,
    # and it is the only part this function is in a position to know.
    payload_bytes = html_bytes + len(text_content.encode("utf-8"))

    def _send():
        # `send_email` returned True to its caller before this thread ran a
        # single line, so the caller's "sent" is a guess it makes on our behalf —
        # `prachar` writes a campaign contact 'sent' on the strength of it. The
        # truth is only knowable in here, which is why every branch below reports
        # its own outcome instead of letting that return value stand.
        #
        # `att` is safe to complete from this thread: outbound_log captured the
        # event loop when `begin()` ran above, on the caller's side of the
        # handoff, and hands the completion back to it.
        # RESOLVED HERE, in the sending thread, and once for both branches. This
        # is where blocking is free: the request returned the moment the thread
        # started, and a cold cache costs this one message a database round-trip
        # that nobody is waiting on. It cannot raise and it cannot return "" —
        # the worst case is FROM_EMAIL, which is what every message used before
        # this existed and what every org still gets until migration 106 is
        # applied and an address is verified.
        from_email = from_plan.resolve()

        if _resend_client:
            try:
                params = {
                    "from": from_email,
                    "to": [to_email],
                    "subject": subject,
                    "html": html_content,
                    "text": text_content,
                }
                if reply_to:
                    params["reply_to"] = [reply_to]
                r = _resend_client.Emails.send(params)
                logger.info("✅ Email sent via Resend → %s [%s]", to_email, r.get("id"))
                att.sent(r.get("id"), provider="resend", bytes=payload_bytes)
            except Exception as exc:
                logger.error("❌ Resend email failed → %s: %s", to_email, exc)
                att.failed(exc, provider="resend")
        elif ses_client:
            try:
                msg = {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body":    {"Text": {"Data": text_content, "Charset": "UTF-8"},
                                "Html":  {"Data": html_content, "Charset": "UTF-8"}},
                }
                kwargs = dict(
                    Source=from_email,
                    Destination={"ToAddresses": [to_email]},
                    Message=msg,
                )
                if reply_to:
                    kwargs["ReplyToAddresses"] = [reply_to]
                r = ses_client.send_email(**kwargs)
                logger.info("✅ Email sent via SES → %s [%s]", to_email, r['MessageId'])
                # The SES MessageId is the join key to a bounce or complaint
                # notification. 960 payslips were accepted by SES and bounced
                # seconds later; without this id stored at send time there is
                # nothing for a delivery event to be about.
                att.sent(r.get("MessageId"), provider="ses", bytes=payload_bytes)
            except Exception as exc:
                logger.error("❌ SES email failed → %s: %s", to_email, exc)
                att.failed(exc, provider="ses")
        else:
            logger.info("[EMAIL-DEV] To:%s | Subject:%s", to_email, subject)
            # No provider is configured, so nothing left the building — and that
            # is a failure, not a send. Leaving the row `queued` would say "we
            # are waiting to hear back" about a message nobody ever posted, and
            # would let a deploy that lost its SES credentials read as healthy in
            # the one table meant to notice.
            att.failed(
                "no email provider configured "
                "(RESEND_API_KEY / AWS_ACCESS_KEY_ID unset)",
                provider="none",
            )

    threading.Thread(target=_send).start()
    return True


# ── 1. Invite email ────────────────────────────────────────────────────────────
def _info_card(rows: list[tuple[str, str]], hindi_sub: dict[str, str] = None) -> str:
    """Render the key/value card — `Auth Emails.html`'s #F0ECDF block.

    rows: list of (label, value) tuples. Both are escaped; `label` previously was
    not, and although every current caller passes a literal, nothing enforced it.
    hindi_sub: optional label -> Devanagari subtitle shown under the value. It
    gets `lang="hi"` and no tracking, per `24-bilingual-devanagari.md`.
    """
    hindi_sub = hindi_sub or {}
    n = len(rows)

    def _row(i, label, value):
        is_last = (i == n - 1)
        pt = "0" if i == 0 else "9px"
        pb = "0" if is_last else "9px"
        border = "" if is_last else f"border-bottom:1px dashed {RULE};"
        sub = ""
        if label in hindi_sub:
            sub = (f'<br><span lang="hi" style="font-family:{FONT_HINDI};font-size:13px;'
                   f'font-weight:400;color:{INK_3};letter-spacing:normal;">'
                   f'{_h(hindi_sub[label])}</span>')
        return (
            f'<tr>'
            f'<td class="em__ink3" style="padding:{pt} 12px {pb} 0;font-family:{FONT_UI};'
            f'font-size:9px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;'
            f'color:{INK_3};vertical-align:top;{border}white-space:nowrap;">{_h(label)}</td>'
            f'<td class="em__ink" style="padding:{pt} 0 {pb};font-family:{FONT_UI};'
            f'font-size:13.5px;font-weight:500;color:{INK};text-align:right;'
            f'vertical-align:top;{border}">{_h(value)}{sub}</td>'
            f'</tr>'
        )

    inner = "".join(_row(i, lbl, val) for i, (lbl, val) in enumerate(rows))
    return (
        f'<tr><td class="em__pad" style="padding:20px 32px 0;">'
        f'<table role="presentation" class="em__card" width="100%" cellpadding="0"'
        f' cellspacing="0" border="0" style="background:{CARD_BG};border-radius:10px;">'
        f'<tr><td style="padding:16px 18px;">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'{inner}'
        f'</table></td></tr></table></td></tr>'
    )


def send_invite_email(to_email: str, inviter_name: str, role: str,
                      invite_token: str, workspace_name: str = "Kartavaya",
                      expires_label: str = "7 days", recipient_name: str = "",
                      workspace_hindi: str = "मुख्य कार्यस्थल",
                      inviter_role: str = "Admin"):
    """Send a workspace invite email with an accept-invite magic link."""
    invite_url    = f"{FRONTEND_URL}/accept-invite?token={invite_token}"
    workspace_url = f"{FRONTEND_URL}/dashboard"
    role_label    = role.capitalize()
    inviter_first    = inviter_name.split()[0] if inviter_name else "Someone"
    workspace_short  = workspace_name.split()[0] if workspace_name else workspace_name
    recip_first      = recipient_name.split()[0] if recipient_name else ""
    greeting         = f'Hi <strong>{_h(recip_first)}</strong>, ' if recip_first else ''
    preheader        = f"{inviter_name} invited you to {workspace_name} on Kartavaya — accept within {expires_label}."

    card = _info_card(
        [
            ("WORKSPACE",  workspace_name),
            ("INVITED BY", f"{inviter_name} · {inviter_role}"),
            ("YOUR ROLE",  role_label),
            ("EXPIRES",    expires_label),
        ],
        hindi_sub={"WORKSPACE": workspace_hindi},
    )

    body = (
        _body_text(f'{greeting}<strong>{_h(inviter_name)}</strong> has invited you to collaborate '
                   f'on <strong>Kartavaya</strong> — the task workspace where '
                   f'{_h(workspace_name)}\'s team plans projects, collaborates, and ships client work. '
                   f'<span lang="hi" style="font-family:{FONT_HINDI};color:{PRIMARY_TEXT};'
                   f'letter-spacing:normal;">साथ मिलकर काम करें।</span>')
        + card
        + _cta_row(invite_url, "Accept invitation", "primary", workspace_url, "Decline")
        + _body_text(f'Expires in <strong>{_h(expires_label)}</strong>. Only '
                     f'<strong>{_h(to_email)}</strong> can accept it.')
        + _fallback_url(invite_url)
    )
    return send_email(
        to_email,
        _safe_subject(f"{inviter_name} invited you to {workspace_name} on Kartavaya"),
        # headline / kicker / sanskrit are escaped inside _base — passing _h()
        # values here would double-escape and print &amp;amp; in a company name
        _base(preheader, "YOU'RE INVITED",
              f"{inviter_first} invited you to {workspace_short} Workspace.",
              "आपका स्वागत है", "", body),
        reply_to=None,
        # Named, like every sender below it. An invite that never arrived is
        # the most-asked support question this product has, and 'unclassified'
        # is not an answer to "did we send it".
        purpose="invite",
    )


# ── 2. Welcome email ───────────────────────────────────────────────────────────
def send_welcome_email(user_email: str, user_name: str):
    """Send a welcome email with onboarding steps to a newly registered user."""
    # Two forms on purpose: the raw one goes to _base, which escapes; the escaped
    # one goes into _body_text, which does not.
    first_raw  = user_name.split()[0] if user_name else "there"
    first_name = _h(first_raw)
    preheader  = "Your Kartavaya account is live. Here's the shortest path to doing what must be done."

    def _step(num_hi, title, body_text):
        return (
            f'<tr><td style="padding:14px 0;border-bottom:1px dashed {_RULE};">'
            f'<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
            f'<td style="width:36px;vertical-align:top;padding-right:14px;">'
            f'<div style="width:28px;height:28px;border-radius:50%;background:{_BG_SOFT};'
            f'border:1px solid {_RULE};text-align:center;line-height:28px;'
            f'font-family:{_FONT_DISP};font-size:16px;color:{_INK};">{num_hi}</div></td>'
            f'<td style="vertical-align:top;">'
            f'<div style="font-family:{_FONT_UI};font-size:14.5px;font-weight:600;color:{_INK};margin-bottom:2px;">{title}</div>'
            f'<div style="font-family:{_FONT_UI};font-size:13.5px;color:{_INK3};line-height:1.55;">{body_text}</div>'
            f'</td></tr></table></td></tr>'
        )

    steps = (
        f'<tr><td style="padding:0 36px 28px;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0">'
        + _step("१", "Open today's dashboard",
                "See what's due, what's overdue, and what your team is working on right now.")
        + _step("२", "Browse projects",
                "See every active engagement — internal work, client deliverables, deadlines, and progress at a glance.")
        + _step("३", "Create your first task",
                'Hit the "+ New task" button in the top bar. Assign it, set a priority, add a due date.')
        + _step("४", "Enable notifications",
                "Get pinged for mentions, assignments, and approvals. Configure in Settings → Notifications.")
        + f'</table></td></tr>'
    )

    gita_block = (
        f'<tr><td style="padding:0 36px 24px;">'
        f'<div style="border-left:2px solid {_TEAL};padding:6px 0 6px 16px;">'
        f'<span style="font-family:{_FONT_HINDI};font-size:16px;color:{_INK2};">'
        f'कर्तव्ये अधिकारस्ते मा फलेषु कदाचन।</span>'
        f'<span style="display:block;font-family:{_FONT_DISP};font-style:italic;'
        f'font-size:12px;color:{_INK3};margin-top:6px;">'
        f'Bhagavad Gita 2.47 — do your duty; don\'t fixate on the fruit.</span>'
        f'</div></td></tr>'
    )

    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, your account is live. '
                   f'Here\'s the shortest path to doing <em style="font-family:{_FONT_DISP};'
                   f'font-style:italic;color:{_DEEP};">what must be done</em> on day one.')
        + steps
        + _cta_row(f"{FRONTEND_URL}/dashboard", "Open Kartavaya", "primary",
                   f"{FRONTEND_URL}/dashboard", "Read the quickstart")
        + gita_block
    )
    return send_email(
        user_email,
        _safe_subject("Welcome to Kartavaya"),
        _base(preheader, "WELCOME ABOARD", f"Glad to have you, {first_raw}.",
              "कर्तव्य में आपका स्वागत है", "", body),
        purpose="welcome",
    )


# ── 3. Approval request email (to admin/owners) ────────────────────────────────
def send_approval_request_email(user_email: str, user_name: str,
                                requester_name: str, task_title: str,
                                notes: str = None,
                                project: str = None, priority: str = None,
                                due_date: str = None, approve_token: str = None):
    """Send an approval-request email to a reviewer with approve/decline action buttons."""
    approve_url = (f"{FRONTEND_URL}/approve?token={approve_token}"
                   if approve_token else f"{FRONTEND_URL}/approvals")
    reject_url  = (f"{FRONTEND_URL}/approve?token={approve_token}&action=reject"
                   if approve_token else approve_url)
    first_name  = _h(user_name.split()[0] if user_name else "there")
    preheader   = f"{requester_name} needs your sign-off on: {task_title}"
    card_rows = [("TITLE", task_title)]
    if project:  card_rows.append(("PROJECT", project))
    if priority: card_rows.append(("PRIORITY", priority))
    if due_date: card_rows.append(("NEEDED BY", due_date))
    card = _info_card(card_rows)
    note_html = ""
    if notes:
        note_html = _body_text(
            f'<span style="font-size:14.5px;line-height:1.6;color:{_INK2};">'
            f'<strong>Note from {_h(requester_name.split()[0])}:</strong> '
            f'&ldquo;{_h(notes)}&rdquo;</span>'
        )
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, '
                   f'<strong>{_h(requester_name)}</strong> has submitted a new request that needs your approval.')
        + card
        + note_html
        + _cta_row(approve_url, "Approve & queue", "approve",
                   reject_url, "Decline with reason")
        + _body_text(f'<span style="font-size:12.5px;color:{_INK3};">Approving moves this task to '
                     f'<strong>To do</strong> and notifies the assignees. {_h(requester_name.split()[0])} gets an email either way.</span>')
    )
    return send_email(
        user_email,
        _safe_subject(f"Approval needed: {task_title}"),
        _base(preheader, "APPROVAL NEEDED", f"{requester_name} requested a new task.",
              "अनुमोदन हेतु अनुरोध", "", body),
        purpose="approval_request",
    )


# ── 4. Request approved (to client/requester) ─────────────────────────────────
def send_request_approved_email(user_email: str, user_name: str,
                                reviewer_name: str, task_title: str,
                                assignees: str = None,
                                due_date: str = None):
    """Notify the requester that their task request was approved and queued."""
    task_url   = f"{FRONTEND_URL}/client/projects"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"Your request was approved by {reviewer_name}. The team is on it."
    card_rows = [("TASK", task_title)]
    if assignees: card_rows.append(("ASSIGNED TO", assignees))
    if due_date:  card_rows.append(("TARGET DATE", due_date))
    card_rows.append(("STATUS", "To do"))
    card = _info_card(card_rows)
    body = (
        _body_text(f'Hi <strong>{first_name}</strong> — '
                   f'<strong>{_h(reviewer_name)}</strong> approved your request. The team has '
                   f'picked it up and you\'ll see status updates in the Kartavaya portal.')
        + card
        + _body_text(f'<span style="font-size:14.5px;color:{_INK2};">'
                     f'<strong>What happens next:</strong> work starts within one business day. '
                     f'You\'ll get another email when it\'s marked complete and ready for your review.</span>')
        + _cta_row(task_url, "View task", "primary", f"{FRONTEND_URL}/client/projects", "Open portal")
    )
    return send_email(
        user_email,
        _safe_subject(f"Your request was approved: {task_title}"),
        _base(preheader, "REQUEST APPROVED", "Your request is in the queue.",
              "अनुमोदन प्राप्त हुआ", "", body),
        purpose="request_approved",
    )


# ── 5. Task done (to client/requester) ────────────────────────────────────────
def send_task_done_email(user_email: str, user_name: str,
                         completer_name: str, task_title: str,
                         time_spent: str = None,
                         completer_note: str = None,
                         attachments: list = None,
                         approve_token: str = None):
    """Notify a client that a task is complete and ready for their review/approval."""
    approve_url  = (f"{FRONTEND_URL}/approve?token={approve_token}"
                    if approve_token else f"{FRONTEND_URL}/client/projects")
    reject_url   = (f"{FRONTEND_URL}/approve?token={approve_token}&action=reject"
                    if approve_token else approve_url)
    first_name   = user_name.split()[0] if user_name else "there"
    preheader    = f"{completer_name} has completed: {task_title}. Ready for your review."
    card_rows = [
        ("TASK", task_title),
        ("COMPLETED BY", completer_name),
        ("STATUS", "Done"),
    ]
    if time_spent: card_rows.append(("TIME SPENT", time_spent))
    card = _info_card(card_rows)
    note_html = ""
    if completer_note:
        note_html = _body_text(
            f'<span style="font-size:14.5px;line-height:1.6;color:{_INK2};">'
            f'<strong>{_h(completer_name.split()[0])}\'s note:</strong> '
            f'&ldquo;{_h(completer_note)}&rdquo;</span>'
        )
    attach_html = ""
    if attachments:
        file_list = ", ".join(
            f'<code style="font-family:{_FONT_UI};font-size:12px;background:{_BG_SOFT};'
            f'padding:1px 5px;border-radius:4px;border:1px solid {_RULE};">{_h(str(a))}</code>'
            for a in attachments
        )
        attach_html = _body_text(
            f'<span style="font-size:12.5px;color:{_INK3};">Two files attached to the task: {file_list}. Open the task to download.</span>')
    body = (
        _body_text(f'Hi <strong>{_h(first_name)}</strong>, '
                   f'<strong>{_h(completer_name)}</strong> just marked your task complete. '
                   f'Please take a look when you have a moment and approve, or send it back with notes.')
        + card
        + note_html
        + attach_html
        + _cta_row(approve_url, "Approve & close", "approve",
                   reject_url, "Send back with notes")
    )
    return send_email(
        user_email,
        _safe_subject(f"Done: {task_title}"),
        _base(preheader, "WORK COMPLETED", "Done — ready for your review.",
              "कार्य सम्पन्न", "", body),
        purpose="task_done",
    )


# ── Legacy / additional send functions ────────────────────────────────────────
def send_task_assignment_email(user_email: str, user_name: str,
                               task_title: str, task_id: str, team_name: str = None):
    """Notify a user by email that a task has been assigned to them."""
    task_url   = f"{FRONTEND_URL}/tasks/{task_id}"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"New task assigned to you: {task_title}"
    team_info  = f" in <strong>{_h(team_name)}</strong>" if team_name else ""
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, you have been assigned a new task{team_info}.')
        + _task_card(task_title)
        + _cta_row(task_url, "View Task", "primary")
    )
    return send_email(
        user_email,
        _safe_subject(f"New task assigned: {task_title}"),
        _base(preheader, "NEW TASK · कार्य", "New task assigned", "नया कार्य",
              "A task has been assigned to you.", body),
        purpose="task_assigned",
    )


def send_comment_email(user_email: str, user_name: str, actor_name: str,
                       task_title: str, task_id: str, comment_preview: str):
    """Notify a user by email that a new comment was posted on a task they follow."""
    task_url   = f"{FRONTEND_URL}/tasks/{task_id}"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"{actor_name} commented on {task_title}"
    preview    = _h(comment_preview[:400]) if comment_preview else ""
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, '
                   f'<strong>{_h(actor_name)}</strong> commented on <strong>{_h(task_title)}</strong>:')
        + _quote_block(preview, _RULE)
        + _cta_row(task_url, "View Comment", "primary")
    )
    return send_email(
        user_email,
        _safe_subject(f"New comment on: {task_title}"),
        _base(preheader, "COMMENT · टिप्पणी", "New comment", "टिप्पणी",
              f"{_h(actor_name)} left a comment.", body),
        purpose="comment",
    )


def send_mention_email(user_email: str, user_name: str, actor_name: str,
                       task_title: str, task_id: str, comment_body: str):
    """Notify a user by email that they were @mentioned in a task comment."""
    task_url   = f"{FRONTEND_URL}/tasks/{task_id}"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"{actor_name} mentioned you in {task_title}"
    preview    = _h(comment_body[:300]) if comment_body else ""
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, '
                   f'<strong>{_h(actor_name)}</strong> mentioned you in <strong>{_h(task_title)}</strong>:')
        + _quote_block(preview, _TEAL)
        + _cta_row(task_url, "View Task", "primary")
    )
    return send_email(
        user_email,
        _safe_subject(f"{actor_name} mentioned you"),
        _base(preheader, "MENTION · उल्लेख", "You were mentioned", "उल्लेख",
              f"{_h(actor_name)} referenced you in a comment.", body),
        purpose="mention",
    )


def send_task_reminder_email(user_email: str, user_name: str,
                             task_title: str, task_id: str, due_date: str):
    """Send a reminder email to a user whose task is approaching its due date."""
    task_url   = f"{FRONTEND_URL}/tasks/{task_id}"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"Reminder: {task_title} is due {due_date}"
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, your task is due soon:')
        + _task_card(task_title, due_date=due_date)
        + _cta_row(task_url, "View Task", "primary")
    )
    return send_email(
        user_email,
        _safe_subject(f"Reminder: {task_title}"),
        _base(preheader, "REMINDER · स्मरण", "Task due soon", "समयसीमा",
              "Don't let this slip.", body),
        purpose="task_reminder",
    )


def send_team_sync_email(user_email: str, user_name: str, client_name: str,
                         task_title: str, task_id: str):
    """Notify a team member that a client has approved and closed a task."""
    task_url   = f"{FRONTEND_URL}/tasks/{task_id}"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"{client_name} approved the task: {task_title}"
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, '
                   f'<strong>{_h(client_name)}</strong> has approved the task. '
                   f'It has been moved to Done.')
        + _task_card(task_title)
        + _cta_row(task_url, "View Task", "approve")
    )
    return send_email(
        user_email,
        _safe_subject(f"Client approved: {task_title}"),
        _base(preheader, "APPROVED · स्वीकृत", "Client approved", "अनुमोदित",
              f"{_h(client_name)} has signed off.", body),
        purpose="client_approved",
    )


# ── Approval decision (approve/reject by reviewer) ────────────────────────────
def send_approval_decision_email(user_email: str, user_name: str, reviewer_name: str,
                                 task_title: str, task_id: str,
                                 decision: str, notes: str = None):
    """Notify the task creator of an approved or rejected approval decision."""
    task_url   = f"{FRONTEND_URL}/tasks/{task_id}"
    approved   = decision == "approved"
    verb       = "approved" if approved else "rejected"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f"Task {verb}: {task_title} — {reviewer_name}"
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, '
                   f'<strong>{_h(reviewer_name)}</strong> has <strong>{verb}</strong> your task:')
        + _task_card(task_title, note=notes)
        + _cta_row(task_url, "View Task", "approve" if approved else "primary")
    )
    return send_email(
        user_email,
        _safe_subject(f"Task {verb}: {task_title}"),
        _base(preheader, f"TASK {verb.upper()} · {'स्वीकृत' if approved else 'अस्वीकृत'}",
              f"Task {verb}", "समीक्षा परिणाम",
              f"Your task has been reviewed.", body),
        purpose="approval_decision",
    )


# Avatar backgrounds for the report leaderboard. In neither token file — the
# previous inline list mixed two brand blues with Tailwind indigo/pink, none of
# which the design system uses anywhere. Reduced to token-derived fills.
_AVATAR_BG = [PRIMARY, OK, WARN, DANGER, INK_2]


# ── Report delivery email (MIME raw with attachments) ─────────────────────────
def send_report_email(
    to_email: str,
    team_name: str,
    frequency: str,
    period_from: str,
    period_to: str,
    data_summary: dict = None,
    total_minutes: int = 0,
    pdf_bytes: bytes = None,
    excel_bytes: bytes = None,
    by_member_tasks: list = None,
    daily_throughput: list = None,
    *,
    org_id: str | None = None,
):
    """Send a periodic report email with optional PDF and Excel attachments via SES raw MIME.

    `org_id` IS FOR THE OUTBOUND RECORD AND CHANGES NOTHING ABOUT WHAT IS SENT.

    This is the scheduled-report path: `routers/reports.py:dispatch_reports`
    loops over `report_schedules` from an hourly Railway cron. There is no
    request underneath it, so the ContextVar `outbound.begin()` normally reads
    the org from is unset, and every report row lands with `org_id = NULL` —
    invisible to `WHERE org_id = $1::uuid`, which is how every org-scoped read
    of `staging.outbound_log` is written (routers/billing.py).

    NOTHING IS DERIVED HERE. `team_name` is a display string and two tenants may
    share one; resolving an org from it would be a guess, and a guessed org on
    the table the AWS bill is reconciled against is worse than an honest NULL —
    the gap is visible, the wrong answer is not. So the org is PASSED IN OR LEFT
    NULL, exactly as `services/expo_push_service.send_expo_push` and
    `services/web_push_service.send_web_push` handle theirs.

    THE CALLER STILL HAS TO SAY. `dispatch_reports` already holds the schedule's
    `team_id` and `teams.org_id` has existed since migration 028, so it is one
    join and one argument away — either `org_id=` here, or the whole loop body
    inside `with outbound.org_scope(org_id):`, which also covers anything else
    that iteration sends. Until that lands, this path is honestly NULL rather
    than quietly wrong. That file belongs to another change; this parameter is
    the half that lives here.

    There is deliberately no `user_id`. 098: "NULL for a system send: the cron
    that mails a report". Nobody clicked this.
    """
    from email.mime.multipart import MIMEMultipart
    from email.mime.text      import MIMEText
    from email.mime.base      import MIMEBase
    from email              import encoders

    # This sender builds its own MIME and talks to SES directly, so it never
    # reaches the guard inside send_email(). Without this line, OUTBOUND_MODE=dry
    # on staging — which shares production's SES identity and database — still
    # delivers the scheduled report cron to real customers.
    from outbound import begin

    # A floor for `bytes`, refined to the true encoded size once the MIME
    # document exists. Recorded even on the attempt because the attachments are
    # the whole reason this sender is different: a report carries a PDF and an
    # XLSX, SES bills in 256 KB units, and a count of rows therefore bears no
    # relation to the invoice unless the size travels with them.
    attachment_bytes = len(pdf_bytes or b"") + len(excel_bytes or b"")

    att = begin(
        "email", to_email, f"{frequency} report: {team_name}",
        # Explicit beats the context and falls back to it when None — so a
        # caller that names the org wins, and a caller that wraps itself in
        # `outbound.org_scope()` instead still works. Passed here rather than
        # anywhere later because `begin()` is the capture point: the thread
        # below starts with an empty context and a read from in there would
        # replace what was captured with None.
        org_id=org_id,
        # `ref`'s head becomes the row's `purpose`, so this reads as
        # purpose=report with the team and period behind it — which is also the
        # only thing distinguishing two otherwise identical monthly sends.
        ref=f"report:{frequency}:{period_from}:{period_to}",
        bytes=attachment_bytes or None,
    )
    if att.blocked:
        return True

    # Same split as `send_email`: captured on the caller's thread, resolved in
    # the sending thread below. THIS SENDER TAKES AN EXPLICIT `org_id` and the
    # context may be empty — it is called from the report cron, where there is
    # no request underneath — so the org is handed over rather than read.
    #
    # 'report' rather than the whole ref: `outbound._row` files the log row
    # under the ref's head, so this is the same word the log used, which is what
    # makes the address and the audit trail agree.
    from services import email_senders
    from_plan = email_senders.plan("report", FROM_EMAIL, org_id=org_id)

    data_summary     = data_summary or {}
    by_member_tasks  = by_member_tasks or []
    daily_throughput = daily_throughput or []
    freq_cap = frequency.capitalize()

    safe_name   = team_name.lower().replace(" ", "-")
    excel_fname = f"Kartavaya-{safe_name}-{period_from}-{period_to}.xlsx"
    pdf_fname   = f"Kartavaya-{safe_name}-{period_from}-{period_to}.pdf"

    # ── Kicker / headline copy ────────────────────────────────────────
    done_count = data_summary.get("done", 0)
    overdue    = data_summary.get("overdue", 0)
    in_prog    = data_summary.get("in_progress", 0)
    todo_count = data_summary.get("todo", 0)
    if frequency == "daily":
        kicker   = f"DAILY REPORT · {period_from}"
        headline = f"{team_name} — yesterday's pulse."
        sanskrit = "दैनिक प्रतिवेदन"
        lede     = (f'Here\'s the rollup for <strong>{_h(team_name)}</strong> over the last 24 hours. '
                    f'The Excel below has per-task detail.')
    elif frequency == "weekly":
        kicker   = f"WEEKLY REPORT · {period_from} to {period_to}"
        headline = f"{team_name} closed {int(done_count)} tasks this week."
        sanskrit = "साप्ताहिक प्रतिवेदन"
        lede     = (f'Here\'s the weekly rollup for <strong>{_h(team_name)}</strong>. '
                    f'Full per-task detail is in the attached Excel.')
    else:
        kicker   = f"MONTHLY REPORT · {period_from} to {period_to}"
        headline = f"{int(done_count)} tasks shipped in {period_from[:7]}."
        sanskrit = "मासिक प्रतिवेदन"
        lede     = (f'Monthly summary for <strong>{_h(team_name)}</strong>. '
                    f'Full per-task detail is in the attached Excel.')

    preheader = f"{freq_cap} report for {team_name} ({period_from} to {period_to}) — {done_count} done, {overdue} overdue."

    # Helper: stat tile (table cell, 25% width)
    def _stat_tile(k, v, hint, tone="neutral"):
        if tone == "ok":
            bg, border, vc = OK_BG, OK, ON_OK_BG
        elif tone == "warn":
            bg, border, vc = WARN_BG, WARN, ON_WARN_BG
        elif tone == "bad":
            bg, border, vc = DANGER_BG, DANGER, ON_DANGER_BG
        else:
            bg, border, vc = SURFACE_2, RULE, INK
        return (
            f'<td width="25%" style="padding:4px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="background:{bg};border:1px solid {border};border-radius:12px;">'
            f'<tr><td style="padding:14px 14px 12px;">'
            f'<div style="font-family:{_FONT_UI};font-size:9.5px;letter-spacing:0.18em;'
            f'text-transform:uppercase;color:{_INK3};font-weight:700;">{k}</div>'
            f'<div style="font-family:{_FONT_DISP};font-size:34px;font-weight:400;'
            f'line-height:1;letter-spacing:-0.02em;color:{vc};margin-top:2px;">{v}</div>'
            f'<div style="font-family:{_FONT_UI};font-size:11px;color:{_INK3};margin-top:4px;">{hint}</div>'
            f'</td></tr></table></td>'
        )

    stats_row = (
        f'<tr><td style="padding:0 36px 8px;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'<tr>'
        + _stat_tile("Completed", done_count, f"period total", "ok")
        + _stat_tile("In progress", in_prog, "active tasks")
        + _stat_tile("To do", todo_count, "queued")
        + _stat_tile("Overdue", overdue, "needs attention", "bad" if overdue > 0 else "neutral")
        + f'</tr></table></td></tr>'
    )

    # ── Section header helper ────────────────────────────────────────
    def _sec_h(title, hindi):
        return (
            f'<tr><td style="padding:20px 36px 10px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="border-bottom:1px solid {_RULE_SOFT};">'
            f'<tr>'
            f'<td style="padding-bottom:8px;font-family:{_FONT_DISP};font-size:18px;'
            f'font-weight:500;color:{_INK};">{title}</td>'
            f'<td align="right" style="padding-bottom:8px;font-family:{_FONT_HINDI};'
            f'font-size:14px;color:{_INK3};">{hindi}</td>'
            f'</tr></table></td></tr>'
        )

    # ── Task summary table (single project row) ─────────────────────
    proj_table = (
        _sec_h("Task summary", "कार्य सारांश")
        + f'<tr><td style="padding:0 36px 8px;">'
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
        f' style="font-size:13.5px;">'
        f'<thead><tr>'
        f'<th style="text-align:left;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;'
        f'color:{_INK3};font-weight:700;padding:8px;border-bottom:1px solid {_RULE};">Project</th>'
        f'<th style="text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;'
        f'color:{_INK3};font-weight:700;padding:8px;border-bottom:1px solid {_RULE};">Done</th>'
        f'<th style="text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;'
        f'color:{_INK3};font-weight:700;padding:8px;border-bottom:1px solid {_RULE};">In Progress</th>'
        f'<th style="text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;'
        f'color:{_INK3};font-weight:700;padding:8px;border-bottom:1px solid {_RULE};">To Do</th>'
        f'<th style="text-align:right;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;'
        f'color:{_DANGER_BOR};font-weight:700;padding:8px;border-bottom:1px solid {_RULE};">Overdue</th>'
        f'</tr></thead>'
        f'<tbody><tr>'
        f'<td style="padding:14px 8px;border-bottom:1px dashed {_RULE};">'
        f'<div style="display:inline-block;width:8px;height:8px;border-radius:2px;'
        f'background:{_TEAL};vertical-align:middle;margin-right:8px;"></div>'
        f'<strong style="color:{_INK};font-size:14px;">{_h(team_name)}</strong>'
        f'</td>'
        f'<td style="text-align:right;padding:14px 8px;border-bottom:1px dashed {_RULE};'
        f'font-family:{_FONT_DISP};font-size:18px;color:{_INK};">{done_count}</td>'
        f'<td style="text-align:right;padding:14px 8px;border-bottom:1px dashed {_RULE};'
        f'font-family:{_FONT_DISP};font-size:18px;color:{_INK};">{in_prog}</td>'
        f'<td style="text-align:right;padding:14px 8px;border-bottom:1px dashed {_RULE};'
        f'font-family:{_FONT_DISP};font-size:18px;color:{_INK};">{todo_count}</td>'
        f'<td style="text-align:right;padding:14px 8px;border-bottom:1px dashed {_RULE};'
        f'font-family:{_FONT_DISP};font-size:18px;'
        f'color:{DANGER if overdue > 0 else INK};">{int(overdue)}</td>'
        f'</tr></tbody></table></td></tr>'
    )

    # ── Champion callout ─────────────────────────────────────────────
    champ_block = ""
    if by_member_tasks:
        top = by_member_tasks[0]
        nm   = top.get("user_name", "Team")
        cnt  = top.get("tasks_done", 0)
        init = _h("".join(p[0].upper() for p in str(nm).split()[:2]))
        av_colors = _AVATAR_BG
        av_bg = av_colors[hash(nm) % len(av_colors)]
        if frequency == "daily":
            champ_label = "CHAMPION OF THE DAY"
            champ_hi    = "दिन का नायक"
        elif frequency == "weekly":
            champ_label = "CHAMPION OF THE WEEK"
            champ_hi    = "सप्ताह का नायक"
        else:
            champ_label = "CHAMPION OF THE MONTH"
            champ_hi    = "माह का नायक"
        total_h_entry = f"{total_minutes // 60}h {total_minutes % 60}m" if total_minutes else ""
        champ_block = (
            f'<tr><td style="padding:4px 36px 16px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="background:{CARD_BG};border-radius:10px;">'
            f'<tr><td style="padding:18px 20px;">'
            f'<div style="font-family:{_FONT_UI};font-size:10px;letter-spacing:0.24em;'
            f'text-transform:uppercase;color:{_MID};font-weight:700;margin-bottom:12px;">'
            f'{champ_label}'
            f'<span style="font-family:{_FONT_HINDI};font-size:12px;color:{_INK3};'
            f'font-weight:400;letter-spacing:0;text-transform:none;margin-left:10px;">{champ_hi}</span>'
            f'</div>'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td width="52" style="vertical-align:middle;">'
            f'<div style="width:48px;height:48px;border-radius:50%;background:{av_bg};'
            f'color:#fff;font-weight:700;font-size:16px;text-align:center;line-height:48px;">{init}</div>'
            f'</td>'
            f'<td style="vertical-align:middle;padding-left:14px;">'
            f'<div style="font-family:{_FONT_DISP};font-size:22px;font-weight:500;color:{_INK};">{_h(nm)}</div>'
            f'<div style="font-family:{_FONT_UI};font-size:12.5px;color:{_INK3};margin-top:2px;">'
            f'Top contributor · {_h(team_name)}</div>'
            f'</td>'
            f'<td align="right" style="vertical-align:middle;font-family:{_FONT_DISP};'
            f'font-size:15px;color:{_INK};">'
            f'<strong style="font-size:22px;">{int(cnt or 0)}</strong> tasks closed'
            f'{"<br><span style=\"font-family:" + _FONT_UI + ";font-size:11.5px;color:" + _INK3 + ";\">" + total_h_entry + " total time</span>" if total_h_entry else ""}'
            f'</td>'
            f'</tr></table>'
            f'</td></tr></table></td></tr>'
        )

    # ── Sparkline (throughput bars) ──────────────────────────────────
    spark_block = ""
    if daily_throughput and frequency in ("weekly", "monthly"):
        max_val = max((r.get("done_count", 0) for r in daily_throughput), default=1) or 1
        bar_cells = ""
        for r in daily_throughput[-7:]:  # cap at 7 bars
            day_label = str(r.get("day", ""))[-5:]  # MM-DD
            val       = int(r.get("done_count", 0))
            bar_h     = max(4, int(val / max_val * 80))
            bar_cells += (
                f'<td align="center" style="vertical-align:bottom;padding:0 5px;">'
                f'<div style="width:28px;height:{bar_h}px;background:{PRIMARY};'
                f'border-radius:3px 3px 0 0;margin:0 auto;"></div>'
                f'<div style="font-family:{_FONT_UI};font-size:9.5px;letter-spacing:0.12em;'
                f'text-transform:uppercase;color:{INK_3};font-weight:700;margin-top:5px;">{_h(day_label)}</div>'
                f'<div style="font-family:{_FONT_DISP};font-size:13px;color:{_INK};">{val}</div>'
                f'</td>'
            )
        spark_block = (
            _sec_h("Throughput trend", "गति")
            + f'<tr><td style="padding:4px 36px 8px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="background:{_BG_SOFT};border:1px solid {_RULE};border-radius:12px;">'
            f'<tr><td style="padding:18px 18px 14px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0">'
            f'<tr style="vertical-align:bottom;">{bar_cells}</tr>'
            f'</table></td></tr></table></td></tr>'
        )

    # ── Leaderboard (monthly only) ───────────────────────────────────
    board_block = ""
    if frequency == "monthly" and by_member_tasks:
        max_t = max((r.get("tasks_done", 0) for r in by_member_tasks), default=1) or 1
        board_rows = ""
        av_colors = _AVATAR_BG
        for i, r in enumerate(by_member_tasks[:5]):
            nm_b  = r.get("user_name", "")
            cnt_b = r.get("tasks_done", 0)
            pct   = int(cnt_b / max_t * 100)
            color = av_colors[i % len(av_colors)]
            board_rows += (
                f'<tr style="border-bottom:1px dashed {_RULE};">'
                f'<td style="padding:8px 0;font-family:{_FONT_DISP};font-size:16px;'
                f'color:{_INK3};width:28px;">{i+1}</td>'
                f'<td style="padding:8px 0;font-family:{_FONT_UI};font-size:13.5px;'
                f'color:{_INK};font-weight:600;width:140px;">{_h(nm_b)}</td>'
                f'<td style="padding:8px 12px;">'
                f'<table width="100%" cellpadding="0" cellspacing="0" border="0">'
                f'<tr><td style="background:{_RULE_SOFT};border-radius:99px;height:8px;overflow:hidden;">'
                f'<div style="width:{pct}%;height:8px;background:{color};border-radius:99px;min-width:6px;"></div>'
                f'</td></tr></table></td>'
                f'<td align="right" style="padding:8px 0;font-family:{_FONT_DISP};'
                f'font-size:16px;color:{INK};width:36px;">{int(cnt_b or 0)}</td>'
                f'</tr>'
            )
        board_block = (
            _sec_h("Leaderboard", "वरीयता क्रम")
            + f'<tr><td style="padding:4px 36px 16px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="background:{_BG_SOFT};border:1px solid {_RULE};border-radius:12px;">'
            f'<tr><td style="padding:18px 20px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0">'
            f'{board_rows}'
            f'</table></td></tr></table></td></tr>'
        )

    # ── Excel attachment row ─────────────────────────────────────────
    attach_block = ""
    if excel_bytes or pdf_bytes:
        import os as _os
        xl_size = f"{len(excel_bytes) // 1024} KB" if excel_bytes else ""
        attach_block = (
            f'<tr><td style="padding:8px 36px 12px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" border="0"'
            f' style="background:{SURFACE_2};border:1px solid {RULE};border-radius:10px;">'
            f'<tr><td style="padding:14px 16px;">'
            f'<table cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td style="vertical-align:middle;width:52px;">'
            f'<div style="width:44px;height:54px;border-radius:4px;'
            f'background:{OK};'
            f'text-align:center;color:#fff;font-family:monospace;font-size:10px;'
            f'font-weight:700;letter-spacing:0.06em;line-height:54px;">XLS</div>'
            f'</td>'
            f'<td style="vertical-align:middle;padding-left:14px;">'
            f'<div style="font-family:monospace;font-size:13px;color:{_INK};'
            f'font-weight:500;">{_h(excel_fname)}</div>'
            f'<div style="font-family:{_FONT_UI};font-size:11.5px;color:{_INK3};margin-top:3px;">'
            f'Attached to this email · also downloadable for 30 days'
            f'{"  ·  " + xl_size if xl_size else ""}'
            f'</div>'
            f'</td>'
            f'</tr></table>'
            f'</td></tr></table></td></tr>'
        )

    # ── Meta footer line ─────────────────────────────────────────────
    meta_line = (
        f'<tr><td style="padding:12px 36px 0;border-top:1px dashed {_RULE};">'
        f'<p style="margin:0;font-family:{_FONT_UI};font-size:12.5px;color:{_INK3};">'
        f"You're getting this because you're an <strong>admin</strong> or "
        f"<strong>team owner</strong> on <strong>{_h(team_name)}</strong>."
        f'</p></td></tr>'
    )

    body = (
        _body_text(
            f'Hi — here\'s the <strong>{freq_cap} report</strong> for '
            f'<strong>{_h(team_name)}</strong>, covering '
            f'<strong>{_h(period_from)}</strong> to <strong>{_h(period_to)}</strong>.'
        )
        + stats_row
        + proj_table
        + champ_block
        + spark_block
        + board_block
        + attach_block
        + _cta_row(f"{FRONTEND_URL}/dashboard", "Open dashboard", "primary",
                   f"{FRONTEND_URL}/dashboard", "Download Excel" if excel_bytes else None)
        + meta_line
    )

    html_body = _base(
        preheader, kicker, headline, sanskrit, lede, body, show_gita=(frequency == "monthly"),
    )

    def _send():
        if not ses_client:
            logger.info("[EMAIL-DEV] Report → %s | %s | %s–%s", to_email, team_name, period_from, period_to)
            # This branch is NOT only local development. Module init prefers
            # Resend when RESEND_API_KEY is set and leaves `ses_client` None —
            # and this sender only ever speaks SES, so on a Resend deployment
            # every scheduled report lands here and silently goes nowhere.
            # Recording it as failed is what would make that visible; it is not
            # this change's job to fix it.
            att.failed("no SES client — send_report_email has no Resend path",
                       provider="none")
            return
        # In the sending thread, once, and used for BOTH the header and the SES
        # envelope below. They must be the same string: SES rejects a raw
        # message whose `Source` does not match the `From:` header it carries.
        from_email = from_plan.resolve()

        try:
            msg = MIMEMultipart("mixed")
            msg["Subject"] = _safe_subject(f"{freq_cap} Report: {team_name} ({period_from} to {period_to})")
            msg["From"]    = from_email
            msg["To"]      = to_email

            alt = MIMEMultipart("alternative")
            # Text first: `multipart/alternative` is ordered least-to-most rich
            # and a client picks the LAST part it understands. Attaching HTML
            # first would hand a text-capable-only client the HTML.
            alt.attach(MIMEText(to_plaintext(html_body), "plain", "utf-8"))
            alt.attach(MIMEText(html_body, "html", "utf-8"))
            msg.attach(alt)

            if pdf_bytes:
                part = MIMEBase("application", "pdf")
                part.set_payload(pdf_bytes)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=pdf_fname)
                msg.attach(part)

            if excel_bytes:
                part = MIMEBase(
                    "application",
                    "vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                part.set_payload(excel_bytes)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=excel_fname)
                msg.attach(part)

            # Serialised once and reused. `msg.as_bytes()` re-encodes the whole
            # document including the base64 attachments, so calling it a second
            # time to measure it would double the work on the largest messages
            # this product sends. Its length is the exact number of bytes SES
            # receives, which is what SES meters in 256 KB units.
            raw = msg.as_bytes()
            r = ses_client.send_raw_email(
                Source=from_email,
                Destinations=[to_email],
                RawMessage={"Data": raw},
            )
            logger.info("✅ Report email sent → %s", to_email)
            att.sent(
                r.get("MessageId") if isinstance(r, dict) else None,
                provider="ses", bytes=len(raw),
            )
        except Exception as exc:
            logger.error("❌ Report email failed → %s: %s", to_email, exc)
            att.failed(exc, provider="ses")

    threading.Thread(target=_send).start()
    return True


# ── Password reset email ──────────────────────────────────────────────────────
def send_password_reset_email(user_email: str, user_name: str, reset_token: str):
    """Send a password-reset link to the user."""
    reset_url  = f"{FRONTEND_URL}/reset-password?token={reset_token}"
    preheader  = "This link expires in one hour."
    # `Auth Emails.html` #reset: state the expiry, the sign-out side effect and
    # the plain-text URL. It also never confirms whether the address has an
    # account, which is why nothing here addresses the recipient by name.
    body = (
        _body_text('Somebody asked for a password reset on this address. '
                   'If that was you, use the button below.')
        + _cta_row(reset_url, "Set a new password", "primary")
        + _notice(f'This link <strong style="color:{ON_WARN_BG};">expires in one hour</strong> '
                  f'and works only once. Setting a new password signs out every other device.')
        + _body_text('<strong>Did not ask for this?</strong> Nothing has changed yet — you can '
                     'ignore this email and your password stays as it is. If you get several '
                     'of these, someone may be trying your address.')
        + _fallback_url(reset_url)
    )
    return send_email(
        user_email,
        _safe_subject("Reset your Kartavaya password"),
        _base(preheader, "PASSWORD RESET · पासवर्ड रीसेट",
              "Reset your password", "सुरक्षा", "", body),
        # The one purpose worth being able to count on its own: several of these
        # to one address in an hour is somebody trying that address, and the
        # body says exactly that to the recipient.
        purpose="password_reset",
    )


# ── Status changed email ──────────────────────────────────────────────────────
def send_status_changed_email(user_email: str, user_name: str,
                               actor_name: str, task_title: str,
                               task_id: str, new_status: str,
                               project: str = None):
    """Notify an assignee that the status of one of their tasks has changed."""
    task_url   = f"{FRONTEND_URL}/tasks"
    first_name = _h(user_name.split()[0] if user_name else "there")
    preheader  = f'{actor_name} updated “{task_title}” to {new_status}'
    card_rows  = [("TASK", task_title), ("NEW STATUS", new_status)]
    if project:
        card_rows.append(("PROJECT", project))
    card = _info_card(card_rows)
    body = (
        _body_text(f'Hi <strong>{first_name}</strong>, '
                   f'<strong>{_h(actor_name)}</strong> moved your task to '
                   f'<strong>{_h(new_status)}</strong>.')
        + card
        + _cta_row(task_url, "View Task", "primary")
    )
    return send_email(
        user_email,
        _safe_subject(f"Task updated: {task_title}"),
        _base(preheader, "STATUS UPDATE · स्थिति", "Task status changed", "स्थिति परिवर्तन",
              "", body),
        purpose="status_changed",
    )


# ── Legacy aliases ─────────────────────────────────────────────────────────────
def send_approval_notification_email(user_email: str, user_name: str, task_title: str,
                                     notification_type: str, notes: str = None,
                                     task_id: str = None, requester_name: str = None,
                                     reviewer_name: str = None):
    """Dispatch to send_approval_request_email or send_approval_decision_email.

    `reviewer_name` was previously hardcoded to "The reviewer" here, so every
    approve/reject email in the product read "The reviewer has approved your
    task" — the approver's identity existed at the call site and was thrown away
    one frame later. `approvals_router.send_approval_notification` now resolves
    it from `tasks.approved_by`, which every handler writes before notifying.

    The literal is kept as the fallback: a decision email with a slightly generic
    subject is better than one that fails because a join came back empty.
    """
    if notification_type == "request":
        return send_approval_request_email(
            user_email, user_name, requester_name or "A team member", task_title, notes=notes)
    return send_approval_decision_email(
        user_email, user_name, reviewer_name or "The reviewer",
        task_title, task_id or "", notification_type, notes)


def send_team_invite_email(to_email: str, team_name: str, inviter_name: str, invite_token: str):
    """Legacy alias — send a member invite email for a specific team."""
    return send_invite_email(to_email, inviter_name, "member", invite_token,
                             workspace_name=team_name)
