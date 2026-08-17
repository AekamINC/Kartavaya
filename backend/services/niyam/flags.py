"""The master switch, and the reason it exists before anything it switches.

── WHY THIS FILE IS FIRST ──────────────────────────────────────────────────

This ships as step N0, before `niyam_events` exists and long before a rule can
run. An off switch added after the thing it disables is an off switch nobody
has ever tested; this one is exercised by every later step, because every later
step is written to consult it.

The product has the scar that justifies it. Thirteen cron endpoints were armed
and 331 reminders were created; every one was suppressed and nobody could tell
whether that was the kill switch working or the pipeline being broken. The
answer here is that the switch reports its own state (`describe()`), so "why is
nothing happening" is a question with an answer.

── ARMED IS NOT THE SAME AS ENABLED ────────────────────────────────────────

Two independent gates, and both must be open before anything reaches a human:

    NIYAM_ARMED=0        the whole engine is in dry run, whatever any rule says
    rule.is_armed=false  this one rule is in dry run, whatever the engine says

That split is Prachar's draft-vs-scheduled distinction, the one genuinely
production-grade idea in the estate being replaced. It is what makes the first
weeks of Niyam safe: real events, real matches, real recorded outcomes, and no
traffic. A rule in dry run still runs — it just records what it WOULD have done
instead of doing it, which is the only way to see a rule before trusting it.

── OFF BY DEFAULT, AND UNSET MEANS OFF ─────────────────────────────────────

`os.environ.get(name, default)` returns "" for a variable that is SET BUT
EMPTY, which is how a deploy that clears a variable silently arms a system.
Both readers below treat empty exactly as absent, and absent as off.
"""
from __future__ import annotations

import os

#: Values that mean "yes" for a boolean environment variable. Deliberately
#: narrow — "true" and "1" are what people type; anything else is a typo and a
#: typo must not arm an engine.
_TRUE = frozenset({"1", "true", "yes", "on"})

ARMED_VAR = "NIYAM_ARMED"


def _flag(name: str) -> bool:
    """Read a boolean env var. Unset, empty and unrecognised all mean False."""
    return (os.environ.get(name) or "").strip().lower() in _TRUE


def engine_armed() -> bool:
    """Is the engine allowed to have any effect outside its own tables?

    False — the default, and the state Niyam ships in — means every rule runs
    in dry run: conditions evaluate, runs and steps are recorded, and every
    action resolves to a `dry` outcome instead of touching anything.

    Read at each use rather than cached at import: this must be flippable from
    a Railway shell without a redeploy, at 2am, by someone who is not the
    author.
    """
    return _flag(ARMED_VAR)


CUSTOMER_MAIL_VAR = "NIYAM_CUSTOMER_MAIL"


def customer_mail_armed() -> bool:
    """May a rule email somebody OUTSIDE the firm?

    A0 Q1 — the owner's open decision, and the reason it is a THIRD gate
    rather than a use of the other two: `NIYAM_ARMED` and `rule.is_armed`
    both answer "may this rule act", and everything they arm reaches members
    of the org — people who chose this product and hold preference rows.
    A customer chose nothing. The blast radius of a wrong send is a client
    relationship, not a noisy notification list — and there is no payment
    gateway here, so "paid" arrives only by bank reconciliation: an invoice
    can be settled days before this product knows. Mailing dunning language
    about a settled invoice is the exact failure this variable exists to
    make somebody choose deliberately.

    Off by default, and unset/empty/typo all mean off, same as the master
    switch. Flipping it is a Railway variable edit, no redeploy.
    """
    return _flag(CUSTOMER_MAIL_VAR)


def rule_effective_mode(rule_is_armed: bool) -> str:
    """`'live'` only when BOTH gates are open; otherwise `'dry'`.

    One place decides this so no caller can accidentally check a single gate.
    """
    return "live" if (engine_armed() and rule_is_armed) else "dry"


def describe() -> dict:
    """A one-glance answer to "why is nothing happening?".

    Returned by the engine's status endpoint and safe to log: it names the
    variable and the state, and carries no secret.
    """
    armed = engine_armed()
    return {
        "engine_armed": armed,
        "variable": ARMED_VAR,
        "meaning": (
            "Rules act on the world."
            if armed
            else "Every rule is in dry run — matches and outcomes are recorded, nothing is sent or written."
        ),
        # The third gate, reported beside the other two for the same reason
        # they are: "why did the customer rung refuse?" must be answerable
        # from the status endpoint alone.
        "customer_mail_armed": customer_mail_armed(),
        "customer_mail_variable": CUSTOMER_MAIL_VAR,
    }
