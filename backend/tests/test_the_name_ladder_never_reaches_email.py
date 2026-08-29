"""A name ladder must never end at an email address, and `users` must be qualified.

── THE RULING ──────────────────────────────────────────────────────────────

Owner, 2026-08-23: **the ladder must never end at an email address.** Two
standing rules meet here and point the same way — Aekam must not see client
emails, and a person is named by their name. An email used as a display
fallback is a CONTACT DETAIL rendered as a LABEL, on a screen that only ever
wanted to say who somebody is.

`services/audit_actors` was written to be the one place that ladder lives. It
did not reach the other sites: **seventeen `COALESCE(full_name, name, email)`
expressions were still in production code** on 2026-08-29, across
`server.py`, `approvals_router.py`, `auth_router.py`, `routers/graha.py`,
`routers/audit.py`, `routers/activity.py`, `routers/billing.py`,
`services/credits.py`, `services/mentions.py` and
`analytics/metrics/sahayak.py`.

**Measured live before changing them: 30 accounts, 0 of which lack both
`full_name` and `name`.** So the email rung had never fired on real data, and
removing it changed nothing anybody could see. It was not a working fallback;
it was a loaded gun. That measurement is also why this is a ratchet rather than
an incident — latent and active need different urgency, and this was latent.

── WHY BLANK IS NOT THE ANSWER EITHER ──────────────────────────────────────

`COALESCE(full_name, name)` alone renders an empty cell for a nameless account,
and an empty cell reads as "nobody did this" — a different and false claim. The
ladder ends at `'Unnamed member'`, which is a stated, non-identifying label, and
at `btrim`/`NULLIF` rather than plain COALESCE because `users.name` is NOT NULL
in places and an empty string is not a name.

⚠ **The two `COALESCE(u.full_name, u.name, u.email)` in `audit_actors.py` are
DELIBERATE and exempt.** They are prose — the module's docstring QUOTES the bad
pattern to explain what it exists to prevent. A sweep rewrote both on 2026-08-29
and turned two paragraphs into self-contradiction ("does: [the correct pattern]
— so a user row with no name silently prints that person's EMAIL"). Rewriting
the documentation of a rule is not enforcing it.

── THE SECOND CHECK: `users` IS AMBIGUOUS ──────────────────────────────────

Measured live 2026-08-29: **`users` exists in TWO schemas** — `public` (the
product's) and `auth` (Supabase's own, which also carries an `email` column).
`db.py` sets `search_path TO staging, public`, and `auth` is not on it, so an
unqualified `users` resolves correctly TODAY.

That is latent, not safe. Migration 142 exists because a query relying on
`search_path` found a shadow table in the other schema, and a silent switch here
would return WRONG ROWS rather than an error. There are **143** unqualified
references in production code, far too many to sweep alongside a release — so
the number is PINNED and may only fall.

⚠ The first version of this file said 193, from a grep that had counted the
test directory too. `test_the_baseline_is_honest` below caught it, which is
the entire reason that test exists: **a baseline set above the real number is
a ratchet that never bites**, and it would have sat here looking like
enforcement while fifty new violations were added under it.
"""
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent

#: The bad ladder, in every spacing and aliasing it was found in.
EMAIL_RUNG = re.compile(
    r"COALESCE\(\s*(\w*\.?)(?:full_name|name),\s*(\w*\.?)(?:name|full_name),"
    r"\s*(\w*\.?)email\s*\)"
)

#: `services/audit_actors.py` QUOTES the bad pattern in its own prose to explain
#: what it prevents. Rewriting documentation is not enforcement.
PROSE_EXEMPT = {"services/audit_actors.py"}


def _production_files():
    for f in sorted(BACKEND.rglob("*.py")):
        rel = f.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "venv/", ".venv/")) or "node_modules" in rel:
            continue
        yield rel, f


def test_no_production_query_falls_back_to_an_email_address():
    offenders = []
    for rel, f in _production_files():
        if rel in PROSE_EXEMPT:
            continue
        src = f.read_text(encoding="utf-8")
        for m in EMAIL_RUNG.finditer(src):
            line = src[: m.start()].count("\n") + 1
            offenders.append(f"  {rel}:{line}  {m.group(0)}")
    assert not offenders, (
        "these name ladders end at an email address:\n" + "\n".join(offenders)
        + "\n\nOwner's ruling, 2026-08-23: a name ladder must never end at an "
          "email. An email as a display fallback is a CONTACT DETAIL rendered "
          "as a LABEL. Use `services.audit_actors.display_name(alias)`, which "
          "ends at 'Unnamed member' — a stated, non-identifying label — and "
          "uses btrim/NULLIF because an empty string is not a name."
    )


def test_the_documented_examples_are_still_there_to_explain_the_rule():
    """The exemption must stay an exemption, not become a hole.

    A sweep rewrote both of these on 2026-08-29 and turned the paragraphs
    explaining the rule into paragraphs contradicting it. If they ever vanish,
    the module lost the reason it exists.
    """
    src = (BACKEND / "services" / "audit_actors.py").read_text(encoding="utf-8")
    assert src.count("COALESCE(u.full_name, u.name, u.email)") == 2, (
        "audit_actors.py no longer quotes the bad pattern it exists to prevent. "
        "Those two lines are prose, not SQL — the docstring uses them to show "
        "what a leaking ladder looks like."
    )
    assert "'Unnamed member'" in src


#: Unqualified `users` references, 2026-08-29. **Lower this, never raise it.**
#: `users` exists in `public` AND in Supabase's `auth`; only `public` is on the
#: search path, so today every one of these resolves correctly.
UNQUALIFIED_USERS_BASELINE = 143


def test_unqualified_references_to_users_can_only_shrink():
    n = 0
    for _rel, f in _production_files():
        n += len(re.findall(r"(?:JOIN|FROM)\s+users\b", f.read_text(encoding="utf-8")))
    assert n <= UNQUALIFIED_USERS_BASELINE, (
        f"{n} unqualified `users` references, up from {UNQUALIFIED_USERS_BASELINE}. "
        f"`users` exists in TWO schemas — `public` and Supabase's `auth`, which "
        f"also has an `email` column. Only `public` is on the search path, so "
        f"this resolves correctly today; migration 142 exists because a query "
        f"relying on `search_path` once found a shadow table in the other "
        f"schema, and a silent switch returns WRONG ROWS rather than an error. "
        f"Write `public.users`."
    )


def test_the_baseline_is_honest():
    """A baseline set above the real number is a ratchet that never bites."""
    n = 0
    for _rel, f in _production_files():
        n += len(re.findall(r"(?:JOIN|FROM)\s+users\b", f.read_text(encoding="utf-8")))
    assert n == UNQUALIFIED_USERS_BASELINE, (
        f"the real count is {n} and the baseline says {UNQUALIFIED_USERS_BASELINE}. "
        f"If you qualified some, LOWER the baseline in this file — that is the "
        f"whole point of it."
    )


@pytest.mark.parametrize("path,alias", [
    ("routers/ganit.py", "sp"),
])
def test_the_sites_fixed_on_2026_08_29_stay_fixed(path, alias):
    """The invoice detail's salesperson join — qualified and on the shared ladder."""
    src = (BACKEND / path).read_text(encoding="utf-8")
    assert f"LEFT JOIN public.users {alias} " in src, (
        f"{path} joins `users` unqualified again for alias `{alias}`"
    )
    assert f'display_name("{alias}")' in src, (
        f"{path} has gone back to a hand-written ladder for `{alias}` instead of "
        f"the one in services/audit_actors"
    )
