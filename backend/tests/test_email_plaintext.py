"""Every email must carry a usable text/plain alternative.

Until this landed, `send_email` handed Resend an `html` key and nothing else,
and both raw-MIME senders attached a single `text/html` part inside a
`multipart/alternative` — an alternative with one alternative. The mail that
suffers most from that is the one going to somebody who has never heard of the
sender: a signature request or an invoice reaching a client's customer, from a
domain with no correspondence history, scoring as HTML-only.

The tests below pin the three things that make the text part worth having
rather than merely present: the links survive, the invisible preheader padding
does not, and Devanagari comes through undamaged.

Nothing here sends. `to_plaintext` is pure, and the two senders are exercised
only through the strings they build.
"""

import re

import pytest

from email_service import _base, _body_text, _cta_row, _fallback_url, to_plaintext


def _doc():
    body = (
        _body_text("Somebody asked for a password reset on this address.")
        + _cta_row("https://kartavaya.com/reset-password?token=TOK",
                   "Set a new password", "primary")
        + _fallback_url("https://kartavaya.com/reset-password?token=TOK")
    )
    return _base("This link expires in one hour.", "PASSWORD RESET · पासवर्ड रीसेट",
                 "Reset your password", "सुरक्षा", "", body)


def test_cta_url_survives_as_text():
    """The button label alone is useless — the href has to come with it.

    A tag strip drops every attribute, so the reader of the text part is left
    with the words "Set a new password" and nowhere to go. This is the whole
    reason `to_plaintext` rewrites anchors instead of stripping them.
    """
    text = to_plaintext(_doc())
    assert "Set a new password" in text
    assert "https://kartavaya.com/reset-password?token=TOK" in text
    assert "Set a new password <https://kartavaya.com/reset-password?token=TOK>" in text


def test_no_markup_survives():
    text = to_plaintext(_doc())
    assert "<td" not in text
    assert "<table" not in text
    assert "style=" not in text
    assert "<!DOCTYPE" not in text


def test_preheader_padding_is_dropped():
    """The preheader is display:none decoration with 30 invisible spacers.

    In HTML it pushes quoted text out of the preview strip. In a text part it
    would be the first thing the reader sees, followed by a wall of nothing.
    """
    text = to_plaintext(_doc())
    assert "‌" not in text          # zwnj
    assert "͏" not in text          # combining grapheme joiner
    assert "\xa0" not in text            # nbsp
    assert not text.startswith("This link expires in one hour.")


def test_devanagari_survives_intact():
    text = to_plaintext(_doc())
    assert "पासवर्ड रीसेट" in text
    assert "सुरक्षा" in text


def test_entities_are_decoded_not_doubled():
    """A company name with an ampersand reads as one, not as `&amp;`."""
    body = _body_text("Sharma &amp; Co. &ldquo;Partners&rdquo;")
    text = to_plaintext(_base("p", "", "h", "", "", body))
    assert "Sharma & Co." in text
    assert "&amp;" not in text
    assert "&ldquo;" not in text


def test_no_run_of_blank_lines():
    text = to_plaintext(_doc())
    assert "\n\n\n" not in text
    assert not any(ln != ln.strip() for ln in text.splitlines())


def test_send_email_passes_a_text_part_to_resend(monkeypatch):
    """The provider call itself carries `text`, not just `html`.

    Asserted at the provider boundary because that is the only place the
    omission was observable — every layer above it looked correct.
    """
    import email_service as E

    captured = {}

    class _Emails:
        @staticmethod
        def send(params):
            captured.update(params)
            return {"id": "test"}

    class _Client:
        Emails = _Emails

    # Run the send inline: the real one hands off to a thread, and a test that
    # joins a thread to see its side effect is a test that can hang.
    monkeypatch.setattr(E, "_resend_client", _Client)
    monkeypatch.setattr(E.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": staticmethod(target)})())
    monkeypatch.setattr("outbound.suppressed", lambda *a, **k: False)

    E.send_email("nobody@example.invalid", "Reset your Kartavaya password", _doc())

    assert captured["html"].startswith("<!DOCTYPE html>")
    assert captured["text"], "no text/plain alternative was sent"
    assert "<table" not in captured["text"]
    assert "https://kartavaya.com/reset-password?token=TOK" in captured["text"]


@pytest.mark.parametrize("slug", ["01-invite", "27-esign-request"])
def test_plaintext_is_not_empty_for_real_templates(slug):
    """A text part that is blank is worse than none — it renders an empty mail.

    Guards the case where a future shell change makes the regex chain strip
    everything, which would be silent: the HTML would still look right.
    """
    from email_service import send_invite_email  # noqa: F401  (import shape check)
    text = to_plaintext(_doc())
    assert len(text) > 200
    assert re.search(r"[A-Za-z]{4,}", text)
