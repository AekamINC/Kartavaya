"""prachar_merge — ONE merge-field vocabulary for every path that sends.

── The defect this closes ───────────────────────────────────────────────────

Prachar had THREE renderers and they disagreed:

  routers/prachar.py:679                 name, email, company
  skills/action/campaign_sender.py:164   {{name}} only
  skills/action/sequence_step_executor   {{name}} only

A comment in the interactive path claimed they matched. It did not. So a
template written and previewed in the composer — where `{{company}}` fills
correctly — shipped `{{company}}` verbatim the moment the same template went
out through a campaign or a drip.

Worse, four tokens are live in a real customer's templates today and are
supported by NONE of the three: `{{month}}`, `{{invoice_no}}`, `{{amount}}`,
`{{due_date}}`. Those reach recipients with the braces intact.

── Why unknown tokens are REMOVED, not left in place ────────────────────────

Leaving `{{invoice_no}}` in a customer's inbox is the worst of the options: it
tells the recipient the sender's tooling is broken, in a message whose whole
job is to look deliberate. Removing it is not obviously right either — a
sentence reading "Your invoice  is due on " is also visibly wrong.

So this module does BOTH halves of the job: it strips the token from the
message, AND it returns the set of unknown fields so the caller can log the
send, surface it in the composer, and stop the next one. Silently stripping
would trade a visible defect for an invisible one, which is how this class of
bug survives.

── Why `{{amount}}` and friends are not merely "not implemented yet" ────────

They are not supportable in a BROADCAST at all. A campaign goes to a list; an
invoice number belongs to one document. Filling them would mean the send path
resolving a per-recipient invoice, which is a different product — the
per-client, statute-driven sends the ICAI work proposes. Naming them here as
`UNSUPPORTABLE_IN_BROADCAST` rather than as a TODO stops somebody adding a
half-working version that picks "the most recent invoice" and gets it wrong on
the one account that matters.

── The escaping split, which is deliberate and load-bearing ─────────────────

BODY values are HTML-escaped. A contact named `<img src=x onerror=...>` had
their own markup rendered live inside the mail before this was fixed.

SUBJECT values are NOT escaped. A subject line is plain text; an entity there
renders literally as "&amp;" in the inbox rather than as "&".

Both existing renderers already made this split, correctly, and it is
preserved verbatim.
"""
from __future__ import annotations

import html
import re

#: Every field a broadcast can fill, and where it comes from. This tuple IS
#: the vocabulary — the composer validates against it, the senders render it,
#: and nothing else may be substituted anywhere.
SUPPORTED_FIELDS = ("name", "email", "company")

#: Named, not silently absent. These appear in live templates and cannot be
#: filled by a broadcast, because a list has no invoice and no due date. If
#: per-recipient document context is ever added to the send path, THIS is the
#: constant to revisit — not a scattering of TODOs.
UNSUPPORTABLE_IN_BROADCAST = ("month", "invoice_no", "amount", "due_date")

_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def fields_in(text: str) -> set[str]:
    """Every merge field a template names. Used by the composer's readout.

    The composer's "Merge fields detected" line validated SPELLING — it
    confirmed a token looked like a token — which meant it cheerfully
    confirmed `{{invoice_no}}`, a field that will ship raw. Validating against
    `SUPPORTED_FIELDS` is what makes that readout mean something.
    """
    return set(_TOKEN_RE.findall(text or ""))


def unsupported_in(text: str) -> set[str]:
    """The fields in `text` that no send path can fill."""
    return fields_in(text) - set(SUPPORTED_FIELDS)


def render(subject: str, body_html: str, values: dict) -> tuple[str, str, set[str]]:
    """Fill a template. Returns (subject, body, unsupported_fields_found).

    `values` supplies the SUPPORTED_FIELDS; anything missing renders empty,
    which is the existing behaviour for a contact with no company on file.

    The third return value is the point of this function as much as the first
    two. A caller that ignores it turns a visible defect into a silent one.
    """
    unknown = unsupported_in(subject) | unsupported_in(body_html)

    out_subject = subject or ""
    out_body = body_html or ""

    for field in SUPPORTED_FIELDS:
        token = "{{" + field + "}}"
        raw = str(values.get(field) or "")
        out_subject = out_subject.replace(token, raw)
        out_body = out_body.replace(token, html.escape(raw))

    # Whatever is left is a field nothing can fill. Remove it rather than post
    # it to a customer, and let `unknown` be how anybody finds out.
    if unknown:
        out_subject = _TOKEN_RE.sub("", out_subject)
        out_body = _TOKEN_RE.sub("", out_body)

    return out_subject, out_body, unknown
