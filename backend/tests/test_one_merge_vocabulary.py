"""THREE RENDERERS, THREE VOCABULARIES, ONE OF THEM CLAIMING THEY MATCHED.

Prachar had three places that filled merge fields into an outgoing message:

    routers/prachar.py                      name, email, company
    skills/action/campaign_sender.py        {{name}} only
    skills/action/sequence_step_executor    {{name}} only

and a comment in the first asserting the split was "the same as
campaign_sender". It was not. The consequence was specific and invisible in
testing: a template written and previewed in the composer, where `{{company}}`
fills correctly, shipped `{{company}}` verbatim the moment the same template
went out as a campaign or a drip.

Four further tokens were live in a real customer's templates and supported by
none of the three — `{{month}}`, `{{invoice_no}}`, `{{amount}}`,
`{{due_date}}` — reaching recipients with the braces intact.

This file exists so a fourth renderer, or a fourth vocabulary, fails here
rather than in somebody's inbox.
"""
import ast
import re
from pathlib import Path

import pytest

from services import prachar_merge as pm

BACKEND = Path(__file__).resolve().parents[1]

#: Every module that turns a template into a message a person receives.
SENDING_PATHS = (
    "routers/prachar.py",
    "services/skills/action/campaign_sender.py",
    "services/skills/action/sequence_step_executor.py",
)


# ── the vocabulary itself ────────────────────────────────────────────────────

def test_the_supported_set_is_what_the_senders_can_actually_fill():
    assert pm.SUPPORTED_FIELDS == ("name", "email", "company")


def test_the_four_live_tokens_are_named_as_unsupportable_not_forgotten():
    """These appear in a live customer's templates. Naming them in a constant
    is what stops somebody adding a half-working version that guesses at "the
    most recent invoice" and gets it wrong on the one account that matters."""
    for field in ("month", "invoice_no", "amount", "due_date"):
        assert field in pm.UNSUPPORTABLE_IN_BROADCAST
        assert field not in pm.SUPPORTED_FIELDS


# ── rendering ────────────────────────────────────────────────────────────────

def test_every_supported_field_is_filled_in_both_subject_and_body():
    subject, body, unknown = pm.render(
        "Hello {{name}} at {{company}}",
        "<p>Hi {{name}}, we have {{email}} on file for {{company}}.</p>",
        {"name": "Asha", "email": "a@example.com", "company": "Bhatt Ceramics"},
    )
    assert subject == "Hello Asha at Bhatt Ceramics"
    assert "Asha" in body and "a@example.com" in body and "Bhatt Ceramics" in body
    assert not unknown
    assert "{{" not in subject and "{{" not in body


def test_the_body_is_escaped_and_the_subject_is_not():
    """Both halves are load-bearing and were already correct in two of the
    three renderers. A contact named `<img src=x onerror=…>` had their own
    markup rendered live inside the mail; an entity in a SUBJECT renders
    literally as "&amp;" in the inbox rather than as "&"."""
    subject, body, _ = pm.render(
        "Re: {{name}}", "<p>Hi {{name}}</p>",
        {"name": "Tata & Sons <script>alert(1)</script>"},
    )
    assert subject == "Re: Tata & Sons <script>alert(1)</script>"
    assert "&amp;" in body
    assert "<script>" not in body


def test_an_unfillable_token_is_removed_and_reported():
    """BOTH halves. Leaving `{{invoice_no}}` in a customer's inbox tells the
    recipient the sender's tooling is broken. Removing it silently trades a
    visible defect for an invisible one — so the caller is handed the set."""
    subject, body, unknown = pm.render(
        "Invoice {{invoice_no}} for {{name}}",
        "<p>{{amount}} due {{due_date}}</p>",
        {"name": "Asha"},
    )
    assert unknown == {"invoice_no", "amount", "due_date"}
    assert "{{" not in subject and "{{" not in body
    assert "Asha" in subject


def test_a_missing_value_renders_empty_rather_than_raising():
    """A contact with no company on file is ordinary, not an error."""
    subject, body, unknown = pm.render(
        "{{name}} of {{company}}", "<p>{{company}}</p>", {"name": "Asha"},
    )
    assert subject == "Asha of "
    assert not unknown


def test_whitespace_inside_the_braces_still_matches():
    """`{{ name }}` is what a person types. Failing to match it would ship the
    token raw, which is the exact defect this module closes."""
    assert pm.fields_in("{{ name }} and {{name}}") == {"name"}


def test_fields_in_reports_what_a_template_names():
    assert pm.fields_in("{{name}} {{invoice_no}}") == {"name", "invoice_no"}
    assert pm.unsupported_in("{{name}} {{invoice_no}}") == {"invoice_no"}


# ── the ratchet: no fourth vocabulary ────────────────────────────────────────

@pytest.mark.parametrize("rel", SENDING_PATHS)
def test_every_sending_path_uses_the_shared_renderer(rel):
    src = (BACKEND / rel).read_text(encoding="utf-8")
    assert "prachar_merge" in src, (
        f"{rel} sends mail without the shared renderer. Three renderers with "
        f"three vocabularies is the defect this module was written to close."
    )


@pytest.mark.parametrize("rel", SENDING_PATHS)
def test_no_sending_path_substitutes_a_token_by_hand(rel):
    """The failure mode is not a missing import — it is somebody adding one
    more `.replace("{{something}}", ...)` beside the shared call, which is
    exactly how the three drifted apart in the first place.

    Scanned as SOURCE TEXT rather than by running the senders: reaching these
    lines needs a live campaign, a live enrolment and a mail provider, and a
    test that needs all three to notice a one-line regression will not be the
    test that catches it.
    """
    src = (BACKEND / rel).read_text(encoding="utf-8")
    tree = ast.parse(src)

    offenders = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "replace"
                and node.args):
            continue
        first = node.args[0]
        # A literal `"{{x}}"`, or the `"{{" + key + "}}"` shape the old loop in
        # routers/prachar.py used to build.
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            if re.search(r"\{\{\s*\w+\s*\}\}", first.value):
                offenders.append(first.value)
        elif isinstance(first, ast.BinOp) and isinstance(first.left, ast.Constant):
            if first.left.value == "{{":
                offenders.append("{{ + var + }}")

    assert not offenders, (
        f"{rel} substitutes a merge token by hand: {offenders}. Add the field "
        f"to prachar_merge.SUPPORTED_FIELDS instead — one vocabulary, or the "
        f"composer and the sender disagree again."
    )
