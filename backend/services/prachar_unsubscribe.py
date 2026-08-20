"""prachar_unsubscribe — the link that was not in any marketing mail.

Prachar sent campaign email and sequence email with NO way for a recipient to
stop it. `staging.prachar_unsubscribes` existed, `/send` honoured it, and a
whole tab rendered it — but the only way into that table was an org member
typing an address into `POST /prachar/unsubscribes`, which sits behind
`require_user`, `get_org_id` and `require_module("prachar")`. The person
receiving the mail could not reach any of it.

STATE THAT AS WHAT IT IS. This is not a missing feature; it is unlawful
commercial mail in every market this product sells into. CAN-SPAM §7704(a)(3)
requires a functioning opt-out mechanism in the message itself, and the
Indian DPDP Act 2023 §6(4)-(6) requires that withdrawing consent be as easy as
giving it. A recipient who could only opt out by asking an employee of the
sending firm to do it for them has neither. Gmail's and Yahoo's 2024 bulk-sender
rules also require one-click `List-Unsubscribe` above ~5,000 messages a day, so
the same gap is a deliverability cliff before it is ever a legal one.

── WHY THE TOKEN IS ENCRYPTED RATHER THAN SIGNED ────────────────────────────

The endpoint has to learn two things from a link a stranger clicks: which org,
and which address. A signed-but-readable token (`base64(org|email).sig`, the
obvious shape) publishes the recipient's email address into a URL — and URLs
travel: into the referrer header of every link on the confirmation page, into
proxy logs, into the browser history of whoever the mail was forwarded to, and
into `SLOW %s %s took %.0fms` in `server.py`'s own request log.

Fernet gives confidentiality and authenticity in one primitive that this repo
already depends on and already has a key for (`services/encryption.py`, keyed
from FIELD_ENCRYPTION_KEY falling back to JWT_SECRET). The token is opaque, it
cannot be forged into another org, and a tampered byte fails the HMAC rather
than unsubscribing somebody else.

── AND WHY IT DOES NOT EXPIRE ───────────────────────────────────────────────

`encryption.decrypt` performs no TTL check and none is wanted here. A drip email
sits in an inbox for years and the unsubscribe link in it has to keep working —
an expired opt-out link is a non-functioning opt-out mechanism, which is the
exact thing the statutes name. The token grants nothing except "add this address
to this org's suppression list", so an old one leaking costs the holder the
ability to stop mail they were already receiving.

The consequence to hold in mind: possession of the token is the whole
authorisation, so this must stay the ONLY thing it can do. Do not extend the
payload to carry a contact id, a campaign id, or anything that could be used to
read or change a record.
"""

from __future__ import annotations

import json
import logging

log = logging.getLogger(__name__)

#: Marks a payload as an unsubscribe token and nothing else.
#:
#: Fernet proves the ciphertext was made with our key; it does not prove what it
#: was made FOR. Every other user of `services/encryption.py` encrypts a bare
#: field value with that same key, so without a discriminator a decrypt here
#: would happily accept a ciphertext minted somewhere else in the product and
#: read whatever it found as an org and an address. `approvals_router` guards its
#: magic links the same way — `payload.get("type") != "client_approval"`.
_KIND = "prachar_unsubscribe"


def mint(org_id: str, email: str) -> str:
    """An opaque token that means "suppress this address for this org".

    Raises nothing the caller must catch beyond what `encryption` raises when no
    key is configured at all — which is a deployment fault, not a send-time one,
    and is better loud than silently producing a link that cannot be read back.
    """
    from services.encryption import encrypt

    return encrypt(json.dumps({
        "k": _KIND,
        "o": str(org_id),
        # Normalised at mint time, not at read time. `add_unsubscribe` lowercases
        # and strips before it INSERTs, and both `/send` and the sequence
        # executor compare `email.lower()` against the stored value — so a token
        # carrying "Bob@Example.com " would write a row that the suppression
        # check never matches, and the recipient would keep receiving mail after
        # clicking a link that said it had worked.
        "e": (email or "").strip().lower(),
    }))


def read(token: str) -> tuple[str, str] | None:
    """`(org_id, email)` from a token, or None if it is not one of ours.

    None for every failure — wrong key, tampered byte, a ciphertext from another
    part of the product, valid JSON with the wrong shape. The endpoint turns that
    into one refusal, so nothing about which of those went wrong reaches whoever
    is holding the token.
    """
    from services.encryption import decrypt

    if not token:
        return None
    try:
        payload = json.loads(decrypt(token))
    except Exception:                                   # noqa: BLE001
        # DEBUG, not WARNING. A malformed token is what a crawler chopping a URL
        # at 78 characters produces, and every mail client in the world does
        # that; logging it at warning would bury the real ones.
        log.debug("prachar unsubscribe: unreadable token", exc_info=True)
        return None
    if not isinstance(payload, dict) or payload.get("k") != _KIND:
        return None
    org_id, email = payload.get("o"), payload.get("e")
    if not org_id or not email:
        return None
    return str(org_id), str(email)


def link(base_url: str, token: str) -> str:
    """The URL that goes in the mail.

    `base_url` is BACKEND_URL — the API's own origin, not FRONTEND_URL. There is
    no page for this; the endpoint answers with HTML itself, because a recipient
    who has just asked to stop hearing from a company should not be handed a
    single-page app to boot before they are told it worked.
    """
    return f"{(base_url or '').rstrip('/')}/api/v1/prachar/unsubscribe?token={token}"


def headers(base_url: str, token: str) -> dict[str, str]:
    """The RFC 8058 header pair that belongs on every marketing message.

    ── Why headers and not just the footer link ────────────────────────────────

    The body link satisfies a human. It does not satisfy a mail provider.
    Gmail's and Yahoo's 2024 bulk-sender rules require `List-Unsubscribe` and
    `List-Unsubscribe-Post` on the MESSAGE, above roughly 5,000 messages a day,
    and they use them to render the "Unsubscribe" control in their own UI —
    the one recipients actually press, because it sits next to the sender name
    rather than at the bottom of an email they have already stopped reading.

    A sender without these headers gets a worse alternative: the recipient
    presses "Report spam" instead, which is the single strongest negative
    reputation signal there is. So this is a deliverability control before it
    is a compliance one, and the compliance argument is in this module's own
    header.

    ── The POST route has to exist for this to be honest ───────────────────────

    `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is a PROMISE that a
    POST to the same URL opts the recipient out with no further interaction.
    `POST /api/v1/prachar/unsubscribe` exists for exactly this and landed in
    the same change. Sending the header without the route turns every press of
    Gmail's button into a 405 and tells Google our unsubscribe is broken, which
    is worse than sending no header at all.

    ── The angle brackets are not decoration ───────────────────────────────────

    RFC 2369 requires the URL be enclosed in `<>`. A bare URL is silently
    ignored by some providers, which is the quiet way this feature fails.
    """
    return {
        "List-Unsubscribe": f"<{link(base_url, token)}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


#: The footer, as a template. `{url}` and `{sender}` are the only substitutions.
#:
#: Inline styles rather than a class, because this HTML is appended to whatever
#: the org authored and there is no stylesheet it can rely on. Muted but not
#: invisible: 12px on #6b7280 against white is ~4.8:1, which clears WCAG AA for
#: small text. A footer styled to be unreadable is a dark pattern, and in an
#: opt-out notice specifically it is the thing regulators look for.
_FOOTER = (
    '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;'
    'font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;'
    'color:#6b7280;">'
    'You are receiving this because you are a contact of {sender}.'
    ' <a href="{url}" style="color:#6b7280;text-decoration:underline;">'
    'Unsubscribe from these emails</a>.'
    '</div>'
)


def append_footer(body_html: str, url: str, sender: str) -> str:
    """Put the opt-out at the end of the message body.

    Inserted before `</body>` when the org authored a whole document, appended
    otherwise — campaign bodies in this product are usually a fragment typed into
    a textarea, but `body_html` is free text and a pasted export is a full
    document. Appending after `</body>` puts the one legally required element of
    the mail into the part a strict client is entitled to discard.

    The sender name is escaped; the org's own body is not. That is the same line
    `campaign_sender` draws for `{{name}}` — markup we were given is content,
    markup the org authored is markup.
    """
    import html as _html

    footer = _FOOTER.format(url=_html.escape(url or "", quote=True),
                            sender=_html.escape(sender or "us"))
    body = body_html or ""
    lowered = body.lower()
    close = lowered.rfind("</body>")
    if close != -1:
        return body[:close] + footer + body[close:]
    return body + footer
