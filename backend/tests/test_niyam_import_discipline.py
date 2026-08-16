"""Two ratchets that make Niyam's standing rules structural.

The owner's ruling of 2026-08-16 is that automation makes **zero AI model
calls**, and the design's second rule is that no automation may walk around
quiet hours. Both are easy to state and impossible to keep by memory: the
violation is one plausible import written by someone in a hurry, and it looks
correct in review.

So neither is a convention here. Both are import-graph facts checked against
the actual source of every module under `services/niyam/**`, in the manner of
`check-rendered-ids.mjs` and `test_automation_config_parity.py` — the pattern
that is the only reason the old config contract could not silently drift.

EACH RATCHET PROVES ITSELF FIRST. A checker that silently matches nothing
passes forever and protects nothing — this codebase has already shipped one
(`check-orphan-selectors.mjs` stopped parsing at an inline `data:` URI and went
on reporting success, having lost 677 selectors). So every detector below is
first run against a synthetic violation and asserted to CATCH it, and only then
run against the real tree. A regex that stops matching fails the self-test long
before it can quietly bless a violation.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

NIYAM = Path(__file__).resolve().parent.parent / "services" / "niyam"

#: Anything that can reach a language model. Substring match on the dotted
#: module path, so `services.ai_router`, `ai_router` and a future
#: `services.ai.whatever` are all caught by the same entry.
MODEL_MARKERS = (
    "ai_router", "gemini", "openai", "anthropic", "openrouter",
    "llm", "serper", "hub_chat", "sahayak", "model_pricing",
)

#: Senders that bypass the preference and quiet-hours layer. These are exactly
#: the primitives the audit found the reminder cron, the approvals fan-out and
#: the action layer calling directly — which is why 331 reminders ignored quiet
#: hours. Niyam reaches a human through `services/niyam/send.py` or not at all.
RAW_SENDER_MARKERS = (
    "send_web_push", "send_expo_push", "send_email", "send_expo",
    "email_service", "smtplib",
    # `boto3`, not `boto3.client`. The marker used to be the longer string, and
    # `"boto3.client" in "boto3"` is False — so a bare `import boto3` sailed
    # through every niyam module while `email_service.py` reaches SES with
    # exactly that (`import boto3`, then `boto3.client(...)`). The one escape
    # hatch this list exists to close was the one it did not close, and the
    # self-tests below never exercised it, so the hole was invisible.
    "boto3",
    # `push_service.send_push_raw` was listed here and NAMES A FUNCTION THAT
    # DOES NOT EXIST anywhere in the repository — grep finds it only in this
    # file. It protected nothing while implying that `send_push` was forbidden,
    # which it is not and should not be: `send_push` is the GATED path that
    # consults preferences and quiet hours, and niyam/send.py is meant to reach
    # it. Removed rather than corrected, because a marker that matches nothing
    # is worse than no marker: it makes the list look more complete than it is.
    "_send_via_meta", "social_publisher",
)


def _imports(source: str, filename: str = "<test>") -> list[str]:
    """Every dotted name this module imports, plus every `from X import y` as
    `X.y`. Parsed with `ast`, not grep: a commented-out import is not an
    import, and this must not be fooled by either direction of that."""
    out: list[str] = []
    tree = ast.parse(source, filename=filename)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.extend(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            out.append(mod)
            out.extend(f"{mod}.{a.name}" for a in node.names)
    return out


def _hits(source: str, markers: tuple[str, ...], filename: str = "<test>") -> list[str]:
    names = _imports(source, filename)
    return sorted({n for n in names for m in markers if m in n.lower()})


def _niyam_files() -> list[Path]:
    return sorted(NIYAM.rglob("*.py"))


# ── the detectors prove themselves ───────────────────────────────────────────

def test_detector_catches_a_model_import():
    """If this fails, the model ratchet below is asleep and means nothing."""
    assert _hits("from services.ai_router import complete", MODEL_MARKERS)
    assert _hits("import services.gemini_client", MODEL_MARKERS)
    assert _hits("from services.hub_chat import answer", MODEL_MARKERS)


def test_detector_catches_a_bare_boto3_import():
    """The regression that mattered: this is how `email_service.py` reaches SES.

    `import boto3` followed by `boto3.client("ses", ...)` is the shape in the
    real codebase, and the old marker (`boto3.client`) could not match it —
    a substring test asks whether the MARKER is inside the IMPORT NAME, and
    "boto3.client" is longer than "boto3". Every niyam module could have opened
    an SES client and the ratchet would have stayed green.
    """
    assert _hits("import boto3", RAW_SENDER_MARKERS)
    assert _hits("import boto3 as aws", RAW_SENDER_MARKERS)
    assert _hits("from boto3 import client", RAW_SENDER_MARKERS)


def test_every_marker_is_a_marker_that_could_match_something():
    """A marker naming a symbol that does not exist protects nothing, and makes
    the list read as more complete than it is. `push_service.send_push_raw` sat
    here for exactly that reason."""
    for m in RAW_SENDER_MARKERS + MODEL_MARKERS:
        assert "." not in m or m.split(".")[0] in {"services", "routers"}, (
            f"marker {m!r} is a dotted SYMBOL path, not a module path — "
            "`_imports` yields `module` and `module.name`, so a marker with a "
            "function name in it only matches if that exact import is written. "
            "Prefer the module."
        )


def test_detector_catches_a_raw_sender_import():
    assert _hits("from push_service import send_expo_push", RAW_SENDER_MARKERS)
    assert _hits("from email_service import send_email", RAW_SENDER_MARKERS)
    assert _hits("import smtplib", RAW_SENDER_MARKERS)


def test_detector_is_not_fooled_by_a_comment_or_a_string():
    """A mention is not an import. If this fails the ratchet is a grep, and a
    grep flags the docstring that explains the rule — which is how a checker
    gets disabled by whoever it annoys first."""
    assert not _hits("# from services.ai_router import complete", MODEL_MARKERS)
    assert not _hits("DOC = 'never import ai_router here'", MODEL_MARKERS)
    assert not _hits("x = 'send_email'", RAW_SENDER_MARKERS)


def test_detector_sees_through_an_alias():
    """`import x as y` still imports x — the obvious way around a naive check."""
    assert _hits("import services.ai_router as engine", MODEL_MARKERS)


# ── and then the real tree ───────────────────────────────────────────────────

def test_niyam_package_exists():
    assert NIYAM.is_dir(), "services/niyam/ must exist — Niyam's ground floor"
    assert _niyam_files(), "no modules found under services/niyam/"


@pytest.mark.parametrize("path", _niyam_files(), ids=lambda p: p.name)
def test_no_module_client_anywhere_in_niyam(path: Path):
    """ZERO AI. Owner's ruling, 2026-08-16.

    An automation runs unattended and at scale: a model call inside a rule is
    unbounded cost, unbounded latency and non-reproducible behaviour on a
    surface that has to be auditable. Deterministic conditions and templates
    are not a limitation of this design, they are the product decision.

    If a rule genuinely needs judgement, the answer is Sahayak invoked by a
    human who reads the result — never a rule action.
    """
    found = _hits(path.read_text(encoding="utf-8"), MODEL_MARKERS, str(path))
    assert not found, (
        f"{path.relative_to(NIYAM.parent.parent)} imports {found}. "
        "Niyam makes no model calls — see docs/proposals/55-niyam-automation.html §6."
    )


@pytest.mark.parametrize("path", _niyam_files(), ids=lambda p: p.name)
def test_no_raw_sender_anywhere_in_niyam(path: Path):
    """Quiet hours cannot be walked around.

    Every channel leaves through `services/niyam/send.py`, which consults
    preferences, applies the per-channel failure polarity, and writes the
    `outbound_log` row that a run step points at. A raw sender imported here
    would produce a message with no preference check and no delivery record —
    which is precisely how 331 reminders came to ignore quiet hours.
    """
    src = path.read_text(encoding="utf-8")
    found = _hits(src, RAW_SENDER_MARKERS, str(path))
    # send.py is the one module allowed to reach a transport, and even it does
    # so through the shared outbound layer rather than a provider SDK.
    if path.name == "send.py":
        found = [f for f in found if "smtplib" in f or "boto3" in f]
    assert not found, (
        f"{path.relative_to(NIYAM.parent.parent)} imports {found}. "
        "Niyam reaches a human through services/niyam/send.py or not at all."
    )
