"""
Prachar's automations tab offered unattended execution that nothing performs.

WHAT WAS WRONG. `staging.prachar_automations` stores a `trigger_type` and an
`action_type`, and the form that writes it renders its own rule back as a
sentence: "<name> will run when <trigger>, and will <action>." Not one of the
seven trigger names it can write appears anywhere in `backend/` outside the five
CRUD statements that store them. There is no dispatcher, no call site, no
constant. A row created there sits with `run_count` at 0 for ever.

WHY THIS IS NOT A RENAME. Graha's automations genuinely do fire, from
`routers/graha.py:fire_automations`, over `staging.graha_automations`, with a
completely different trigger vocabulary. The two sets are disjoint — pinned
below — so "point one at the other" is not available. Six of Prachar's seven
triggers are CRM events, so building this means new call sites inside Graha:
cross-module work and a product decision, not a patch.

WHAT WAS DONE. The tab is unmounted from `PracharPage.jsx` and `POST
/v1/prachar/automations` answers 501. `staging.prachar_automations` held 0 rows
in the product's entire life when that was decided (measured 6 August 2026), so
nothing was taken from anybody. List, patch and delete stay open, so a row that
does exist can still be read, paused and removed.

THE TRIPWIRE HERE ALSO FAILS ON GOOD NEWS. `test_no_trigger_in_this_module_is_
known_to_the_backend` goes red the day an engine appears. Red means "remount the
tab and lift the 501", not "revert".
"""

import ast
import os

import pytest

import routers.prachar as prachar


BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

#: The seven the form offers, from `frontend/src/pages/prachar/AutomationsTab
#: .jsx:22-30`. Written out rather than imported from anywhere, because there is
#: nowhere to import them from — which is itself the finding: the backend never
#: enumerates them, so `create_automation` would have accepted any string at all.
PRACHAR_TRIGGERS = (
    "contact_created",
    "contact_converted",
    "deal_won",
    "deal_lost",
    "label_added",
    "score_above",
    "manual",
)

#: `routers/graha.py:create_automation`'s `valid_triggers`. The engine that works.
GRAHA_TRIGGERS = (
    "lead_created",
    "deal_stage_changed",
    "deal_created",
    "activity_created",
    "contact_updated",
    "deal_stale",
    "followup_overdue",
)


def test_the_two_vocabularies_do_not_overlap_at_all():
    """The reason this is not a naming mismatch, stated as an assertion.

    If these ever intersect, somebody has started unifying them and the 501
    below needs revisiting — the interesting case is the first overlap, not the
    complete one.
    """
    assert not set(PRACHAR_TRIGGERS) & set(GRAHA_TRIGGERS)


def _stripped_source(path: str) -> str:
    """Source with every comment and docstring removed.

    Four checks in this repository have been satisfied by their own commentary.
    Every trigger name above is written in prose in `routers/prachar.py`, in
    `AutomationsTab.jsx`'s header and in this file, so a raw scan would find
    them in the explanation of why they are absent.
    """
    with open(path, "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def test_the_stripper_actually_strips():
    """Without this, the scan below could be reading a file it never opened."""
    raw = open(prachar.__file__, "r", encoding="utf-8").read()
    stripped = _stripped_source(prachar.__file__)
    # In the block comment above the automations section, and nowhere else.
    # One line of it, deliberately — a phrase that the comment wraps across two
    # lines is absent from the raw text too, and would pass for the wrong reason.
    assert "Not in a dispatcher" in raw
    assert "Not in a dispatcher" not in stripped


def _python_files():
    skip = {"__pycache__", "tests", "migrations", "node_modules", ".venv",
            "venv", "scripts"}
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(root, name)


def test_no_trigger_in_this_module_is_known_to_the_backend():
    """Not one of the seven appears in executable code, anywhere.

    THIS GOING RED IS NOT NECESSARILY A REGRESSION. An engine landing is exactly
    what makes it fail, and the correct response is to remount the tab in
    `frontend/src/pages/PracharPage.jsx`, lift the 501 in `create_automation`,
    and name the engine's module in `ENGINE_ALLOWED` below.

    `manual` is excluded from the scan and NOT from the finding: it is an
    ordinary English word that appears in unrelated code and would make this
    check noise. It is also the one trigger that means "never fires on its own",
    so a hand-run path existing would not make the other six work.
    """
    # Niyam's event vocabulary shares NAMES with Prachar's trigger list —
    # `contact_created` is a CRM contact event in services/niyam/subjects.py
    # and also one of the seven strings this tab advertises. The collision is
    # real and the tripwire is right to see it, but it is not yet the thing the
    # tripwire is watching for: Niyam at N3 emits events and has no engine to
    # consume them (that is N4), so nothing here can run a Prachar rule.
    #
    # THE OBLIGATION THIS RECORDS: when Niyam's engine lands and can serve
    # these triggers, remount the tab in PracharPage.jsx and lift the 501 in
    # create_automation. Until then Prachar stays honestly closed, which is the
    # pattern the whole Niyam demolition held up as the one to copy.
    ENGINE_ALLOWED: set[str] = {"services/niyam/subjects.py"}

    scanned = [t for t in PRACHAR_TRIGGERS if t != "manual"]
    found = []
    for path in _python_files():
        rel = os.path.relpath(path, BACKEND).replace(os.sep, "/")
        if rel in ENGINE_ALLOWED:
            continue
        try:
            code = _stripped_source(path)
        except SyntaxError:
            continue
        for trigger in scanned:
            if trigger in code:
                found.append(f"{rel}: {trigger}")

    assert not found, (
        "A Prachar automation trigger is now named in backend code:\n  "
        + "\n  ".join(found)
        + "\nIf an engine has landed: remount the tab in PracharPage.jsx, lift "
          "the 501 in routers/prachar.py:create_automation, and add the engine's "
          "module to ENGINE_ALLOWED here."
    )


def test_the_trigger_scan_would_catch_an_engine():
    """The scan passing means nothing unless it can fail.

    A dispatcher's own `WHERE trigger_type = 'deal_won'` is the shape it has to
    catch, and it must not be tripped by an unrelated word.
    """
    engine_like = (
        "async def fire_prachar_automations(pool, org_id, trigger_type):\n"
        "    if trigger_type == 'deal_won':\n"
        "        pass\n"
    )
    assert any(t in engine_like for t in PRACHAR_TRIGGERS if t != "manual")

    unrelated = "async def list_deals(pool):\n    return await pool.fetch('SELECT 1')\n"
    assert not any(t in unrelated for t in PRACHAR_TRIGGERS if t != "manual")


# ── The door ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.prachar import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.mark.anyio
async def test_creating_an_automation_is_refused_and_says_why(
    api_client, mock_pool, as_admin, with_org_id,
):
    """501, and a message a person can act on.

    Unmounting the tab closes the door a PERSON walks through. It does not close
    the one a script, a mobile build or a cached tab walks through, and the count
    that matters — 0 rows, ever — only stays true if the endpoint agrees.

    501 rather than 400: the request is well formed and the server is what is
    missing, which is what 501 means and is distinguishable by a client from
    "you sent me nonsense".
    """
    r = await api_client.post("/api/v1/prachar/automations", json={
        "name": "Welcome new leads",
        "trigger_type": "contact_created",
        "action_type": "send_email",
    })
    assert r.status_code == 501
    detail = r.json()["detail"]
    assert "nothing in the product fires them" in detail.lower()

    # AND IT POINTS AT SOMETHING THAT STILL EXISTS.
    #
    # This assertion used to demand the word "graha", because the refusal sent
    # people to `routers/graha.py:fire_automations`. N1 (`257d8bd6`) DELETED
    # that engine — both copies — and this test went on passing, so a message
    # whose entire purpose was honesty spent nine days naming a destination that
    # was gone, with a green suite over it.
    #
    # So the assertion is now on the property rather than the word: name the
    # engine that fires TODAY, and never name the one that was removed.
    assert "settings" in detail.lower() and "automations" in detail.lower(),         "the refusal must name the engine that actually fires"
    assert "graha" not in detail.lower(),         "the refusal names Graha's automations, deleted by N1 in 257d8bd6"


@pytest.mark.anyio
async def test_the_refusal_happens_before_the_database_is_touched(
    api_client, mock_pool, as_admin, with_org_id,
):
    """No row, no partial write, no `run_count` to explain later."""
    mock_pool.fetchrow.side_effect = AssertionError(
        "create_automation reached the database"
    )
    r = await api_client.post("/api/v1/prachar/automations", json={
        "name": "x", "trigger_type": "manual", "action_type": "send_email",
    })
    assert r.status_code == 501


@pytest.mark.anyio
async def test_listing_and_removing_an_existing_automation_still_works(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Sealing the exit as well as the entrance is how dead rows become permanent.

    There are none today. If one exists — written before this, or by a path
    nobody has found — it must stay readable and removable.
    """
    mock_pool.fetch.side_effect = lambda *a, **k: [{
        "id": "auto-1", "name": "Old rule", "trigger_type": "deal_won",
        "action_type": "send_email", "run_count": 0, "is_active": True,
    }]
    r = await api_client.get("/api/v1/prachar/automations")
    assert r.status_code == 200
    assert r.json()["data"][0]["name"] == "Old rule"
    # And the response says what `run_count: 0` cannot.
    assert r.json()["engine"] is None
    assert "cannot be created" in r.json()["note"].lower()

    mock_pool.execute.side_effect = lambda *a, **k: "UPDATE 1"
    d = await api_client.delete("/api/v1/prachar/automations/auto-1")
    assert d.status_code == 200
