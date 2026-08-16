"""Niyam — नियम, rule. The deterministic automation engine.

Design: `docs/proposals/55-niyam-automation.html`. Four demos beside it (56-59).

The one rule that governs this whole package, enforced by
`tests/test_niyam_import_discipline.py` rather than by anyone remembering it:

    NOTHING under services/niyam/** may import a model client, and nothing
    may import a raw sender.

The first keeps automation deterministic and free — the owner's ruling of
2026-08-16, and the reason a rule's cost per run is zero and cannot quietly
become non-zero. The second keeps every message inside the one gated send, so
quiet hours and notification preferences cannot be walked around by a new
action written in a hurry.
"""
