"""
Prachar must not present an unmeasured number as a measurement.

WHAT WAS WRONG. `staging.prachar_campaigns` carries `total_opened`,
`total_clicked`, `total_bounced` and `total_unsubscribed`, and nothing in this
product has ever written any of them — no Resend webhook, no tracking pixel, no
click redirect. On most orgs they read 0, which looks like "nobody opened it".
On Unicode Group, a paying customer, they held demo seed: 8 sent campaigns
carrying 51 opens, 29 clicks, 1 bounce and 2 unsubscribes, every row stamped
`updated_at = 2026-08-05 12:41:32.496118+00` — identical to the microsecond — on
campaigns dated four months before those rows existed. The dashboard drew that
as a delivery funnel with an open rate, a click rate measured against opens, and
a bounce cell that turns red over 5%.

WHAT THESE TESTS PIN. Three separate things, because the fix has three parts and
any one of them can be undone on its own:

  1. THE SET, written out literally. Not derived, not computed as "the integer
     columns minus the ones we allow" — a subtractive rule cannot notice the
     allowed set widening, and a fifth engagement column added tomorrow would
     classify itself as measured.
  2. THE ARITHMETIC, on the pure function, because `conftest` swaps the pool for
     a mock that resolves any table name and returns whatever the test told it
     to. A test that asked the database what the dashboard shows would be
     asserting on its own fixture.
  3. THE WIRING, through the actual routes, because a pure function nobody calls
     fixes nothing — which is the failure mode of nearly every finding in the
     report this work came from.

AND ONE TRIPWIRE THAT FAILS ON GOOD NEWS. `test_nothing_in_this_product_writes_
an_engagement_column` walks every Python file under `backend/` and refuses to
find the four names inside an INSERT or an UPDATE. The day somebody lands the
Resend receiver, that test goes red — deliberately. Red there means "the columns
are measured now, so set `ENGAGEMENT_RECEIVER` and let the screens show them
again". It is the only mechanism that keeps the code and the claim in step.

THE SOURCE SCANS STRIP COMMENTS AND DOCSTRINGS FIRST. This repository has
shipped four checks that were satisfied by their own commentary: `inspect
.getsource` returns comments and docstrings, and a grep over a file matches the
sentence explaining what it forbids. This very file names all four columns in
prose, and so does `services/engagement_metrics.py`.
"""

import ast
import os

import pytest

from services import engagement_metrics as em


BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


# ── 1. The set, written out literally ────────────────────────────────────────

def test_the_unmeasured_set_is_exactly_these_four():
    """Spelled out, not derived. See the module docstring.

    If a fifth engagement column appears on `staging.prachar_campaigns`, this
    test is the thing that has to be edited to admit it — which is the point.
    Admitting it silently is how a column starts being displayed as a fact.
    """
    assert em.UNMEASURED_COLUMNS == (
        "total_opened",
        "total_clicked",
        "total_bounced",
        "total_unsubscribed",
    )


def test_the_two_measured_columns_are_named_and_are_not_in_the_unmeasured_set():
    """`total_recipients` and `total_sent` ARE written by real code.

    `routers/prachar.py` sets `total_recipients` on every send and
    `services/skills/action/campaign_sender.py` sets `total_sent`. Redacting
    those would be the opposite error — hiding a figure that was measured — so
    the two lists must stay disjoint.
    """
    assert em.MEASURED_COLUMNS == ("total_recipients", "total_sent")
    assert not set(em.MEASURED_COLUMNS) & set(em.UNMEASURED_COLUMNS)


def test_no_receiver_exists_today():
    """The current, measured state of the product — not a placeholder.

    If this fails, somebody has wired a delivery-event receiver. Good. Check
    that it actually writes all four columns before leaving this green.
    """
    assert em.ENGAGEMENT_RECEIVER is None
    assert em.engagement_is_measured() is False


# ── 2. The arithmetic ────────────────────────────────────────────────────────

SEEDED_ROW = {
    # Verbatim from `staging.prachar_campaigns` on 6 August 2026: the worst of
    # the eight Unicode Group rows, the one a real customer's dashboard renders
    # as a 100% open rate.
    "id": "16f36fbb-3b84-4f7e-b292-8091c12b745b",
    "name": "GSTR-1 reminder — July",
    "status": "sent",
    "total_recipients": 7,
    "total_sent": 7,
    "total_opened": 7,
    "total_clicked": 5,
    "total_bounced": 0,
    "total_unsubscribed": 0,
}


def test_redaction_replaces_with_none_and_never_with_zero():
    """None means "not measured". Zero means "measured, and it was nought".

    This is the whole distinction the fix rests on. A screen handed 0 draws a 0%
    open rate with a straight face; a screen handed None can say so. Every
    caller in the frontend tests `== null` for exactly this reason.
    """
    out = em.redact_engagement(SEEDED_ROW)
    for column in em.UNMEASURED_COLUMNS:
        assert out[column] is None, f"{column} was not redacted"
        assert out[column] != 0 or out[column] is None


def test_redaction_leaves_the_measured_columns_alone():
    out = em.redact_engagement(SEEDED_ROW)
    assert out["total_recipients"] == 7
    assert out["total_sent"] == 7
    assert out["name"] == "GSTR-1 reminder — July"
    assert out["status"] == "sent"


def test_redaction_says_so_rather_than_leaving_it_to_be_inferred():
    """A null could mean "unknown" or "the column was not selected".

    The flag removes the guess, and the note gives every screen the same
    sentence so three of them cannot drift into three different explanations.
    """
    out = em.redact_engagement(SEEDED_ROW)
    assert out["engagement_measured"] is False
    assert out["engagement_note"] == em.UNMEASURED_REASON
    assert "not measured" in em.UNMEASURED_REASON.lower()


def test_redaction_does_not_mutate_the_row_it_was_given():
    """The routes hand it a row they may still read afterwards."""
    original = dict(SEEDED_ROW)
    em.redact_engagement(SEEDED_ROW)
    assert SEEDED_ROW == original


def test_a_dict_with_none_of_those_columns_is_returned_untouched():
    """No flag on a payload where it would mean nothing.

    `redact_engagement` is safe to call on anything a route is about to return;
    decorating unrelated responses with `engagement_measured` would make the
    flag noise rather than information.
    """
    unrelated = {"id": "x", "name": "A template", "subject": "Hi"}
    out = em.redact_engagement(unrelated)
    assert out == unrelated
    assert "engagement_measured" not in out


def test_the_switch_is_real_and_the_numbers_come_back_when_it_flips(monkeypatch):
    """Flipping `ENGAGEMENT_RECEIVER` must restore the figures, not just the flag.

    A "fix" that hard-codes the numbers away is not a fix, it is a second thing
    to undo. This proves the redaction is conditional on the one named fact —
    whether anything measures them — and nothing else.
    """
    monkeypatch.setattr(em, "ENGAGEMENT_RECEIVER", "services.prachar_delivery_events")
    assert em.engagement_is_measured() is True

    out = em.redact_engagement(SEEDED_ROW)
    assert out["total_opened"] == 7
    assert out["total_clicked"] == 5
    assert out["engagement_measured"] is True
    assert "engagement_note" not in out


def test_the_list_helper_redacts_every_row():
    rows = [SEEDED_ROW, {**SEEDED_ROW, "id": "other", "total_opened": 9}]
    out = em.redact_engagement_rows(rows)
    assert len(out) == 2
    assert all(r["total_opened"] is None for r in out)


# ── 3. The wiring, through the routes ────────────────────────────────────────

@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.prachar import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.mark.anyio
async def test_the_dashboard_never_serves_a_seeded_open_count(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The route, with the live seeded numbers coming back off the database.

    The pool is a mock, so this proves nothing about SQL — it proves that
    whatever the database hands back, these four figures do not leave the
    server. That is the only claim worth making here, and it is the one that
    was false.
    """
    delivery = {
        "total_sent": 66, "total_opened": 51,
        "total_clicked": 29, "total_bounced": 1,
    }
    campaigns = {"total": 12, "sent": 8, "sending": 0, "drafts": 4, "scheduled": 0}

    async def fetchrow(query, *args):
        if "SUM(total_recipients)" in query:
            return delivery
        return campaigns

    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetch.side_effect = lambda *a, **k: [dict(SEEDED_ROW)]
    mock_pool.fetchval.side_effect = None
    mock_pool.fetchval.return_value = 0

    r = await api_client.get("/api/v1/prachar/dashboard")
    assert r.status_code == 200
    payload = r.json()

    assert payload["delivery"]["total_opened"] is None
    assert payload["delivery"]["total_clicked"] is None
    assert payload["delivery"]["total_bounced"] is None
    # The one figure on that row anything writes survives.
    assert payload["delivery"]["total_sent"] == 66
    assert payload["engagement_measured"] is False
    assert payload["engagement_note"]

    assert payload["recent_campaigns"][0]["total_opened"] is None
    assert payload["recent_campaigns"][0]["total_recipients"] == 7


@pytest.mark.anyio
async def test_the_campaign_list_never_serves_one_either(
    api_client, mock_pool, as_admin, with_org_id,
):
    """`GET /campaigns` is `SELECT *`, so it carried all four for free."""
    mock_pool.fetch.side_effect = lambda *a, **k: [dict(SEEDED_ROW)]

    r = await api_client.get("/api/v1/prachar/campaigns")
    assert r.status_code == 200
    row = r.json()["data"][0]
    assert row["total_opened"] is None
    assert row["total_clicked"] is None
    assert row["engagement_measured"] is False


@pytest.mark.anyio
async def test_the_per_campaign_breakdown_is_redacted_too(
    api_client, mock_pool, as_admin, with_org_id,
):
    """`/campaigns/{id}/stats` counts statuses nothing writes.

    `prachar_campaign_contacts.status` only ever holds 'pending', 'sent' or
    'failed', so the opened/clicked/bounced buckets are 0 on every campaign that
    has ever existed. Nothing seeded them, so this one never showed an invented
    number — it showed a confident zero next to a real Sent count, which is the
    same claim in a smaller font. Fixing the dashboard alone would have moved
    the reader one click deeper to find it.
    """
    stats = {"total": 7, "sent": 7, "opened": 0, "clicked": 0,
             "bounced": 0, "failed": 0}
    mock_pool.fetchval.side_effect = None
    mock_pool.fetchval.return_value = 1
    mock_pool.fetchrow.side_effect = lambda *a, **k: stats

    r = await api_client.get(
        "/api/v1/prachar/campaigns/16f36fbb-3b84-4f7e-b292-8091c12b745b/stats"
    )
    assert r.status_code == 200
    payload = r.json()
    assert payload["opened"] is None
    assert payload["clicked"] is None
    assert payload["bounced"] is None
    # The two that ARE derived from a status the send loop writes.
    assert payload["sent"] == 7
    assert payload["failed"] == 0
    assert payload["total"] == 7
    assert payload["engagement_measured"] is False


def test_the_contact_stat_redaction_is_its_own_rule():
    """Separate keys, separate tuple, and never applied to an unrelated dict.

    "opened" and "clicked" are ordinary English words. A single helper that
    nulled anything with those keys would eventually eat a figure that was
    genuinely measured, in a module nobody was thinking about.
    """
    assert em.UNMEASURED_CONTACT_STATS == ("opened", "clicked", "bounced")
    assert not set(em.UNMEASURED_CONTACT_STATS) & set(em.UNMEASURED_COLUMNS)

    unrelated = {"id": "x", "name": "A ticket", "resolved": 3}
    assert em.redact_contact_stats(unrelated) == unrelated

    out = em.redact_contact_stats({"total": 7, "sent": 7, "opened": 0, "failed": 1})
    assert out["opened"] is None
    assert out["sent"] == 7
    assert out["failed"] == 1


@pytest.mark.anyio
async def test_one_campaign_read_on_its_own_is_redacted_too(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The detail route is the one a person lands on from the list."""
    mock_pool.fetchrow.side_effect = lambda *a, **k: dict(SEEDED_ROW)

    r = await api_client.get(
        "/api/v1/prachar/campaigns/16f36fbb-3b84-4f7e-b292-8091c12b745b"
    )
    assert r.status_code == 200
    assert r.json()["total_opened"] is None


# ── 4. The tripwire that fails on good news ──────────────────────────────────

def _stripped_tree(path: str) -> ast.Module:
    """The file's AST with every comment and docstring removed.

    Comments are gone by construction — `ast.parse` never sees them. Docstrings
    are Constant expressions and survive, so they are cut explicitly: this file
    and `services/engagement_metrics.py` both discuss `UPDATE staging
    .prachar_campaigns SET total_opened` in prose, and a scan that matched its
    own explanation would be the fifth such check in this repository.
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
    return tree


def _string_literals(tree: ast.Module):
    return [
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    ]


def test_the_docstring_stripper_actually_strips():
    """The scan below is worthless if this returns the file verbatim."""
    path = em.__file__
    raw = open(path, "r", encoding="utf-8").read()
    literals = " ".join(_string_literals(_stripped_tree(path)))

    # A phrase that exists ONLY in that module's prose. Asserted present first,
    # because "not in the stripped output" is also true of a phrase that was
    # never there — which is how a stripper test passes while stripping nothing.
    assert "seeded four months" in raw
    assert "seeded four months" not in literals


def _python_files():
    skip_dirs = {"__pycache__", "tests", "migrations", "node_modules",
                 ".venv", "venv", "scripts"}
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(root, name)


def test_nothing_in_this_product_writes_an_engagement_column():
    """No INSERT or UPDATE anywhere in `backend/` touches the four columns.

    THIS TEST GOING RED IS NOT NECESSARILY A REGRESSION. If somebody has just
    built the Resend receiver, red here is correct and the fix is two lines:
    set `ENGAGEMENT_RECEIVER` in `services/engagement_metrics.py` to the module
    that writes them, and add that module to `WRITERS_ALLOWED` below. The
    screens then show the figures again on their own, because everything reads
    the one flag.

    What it must never do is stay green while a writer exists — that is the
    state where the product measures opens and refuses to say so — or go green
    because somebody deleted the check.

    Checked against SQL STRING LITERALS rather than raw text, so the sentence
    you are reading cannot satisfy it.
    """
    #: Modules permitted to name these columns in a write statement. Empty, and
    #: written out as an explicit empty set rather than implied, so that adding
    #: to it is a deliberate edit somebody makes on the same commit as the flag.
    WRITERS_ALLOWED: set[str] = set()

    offenders = []
    for path in _python_files():
        rel = os.path.relpath(path, BACKEND).replace(os.sep, "/")
        if rel in WRITERS_ALLOWED:
            continue
        try:
            tree = _stripped_tree(path)
        except SyntaxError:
            continue
        for text in _string_literals(tree):
            upper = " ".join(text.split()).upper()
            if "INSERT INTO" not in upper and "UPDATE " not in upper:
                continue
            for column in em.UNMEASURED_COLUMNS:
                if column in text:
                    offenders.append(f"{rel}: {column} in {text[:90]!r}")

    assert not offenders, (
        "A write to an unmeasured engagement column now exists:\n  "
        + "\n  ".join(offenders)
        + "\nIf this is the delivery-event receiver landing, set "
          "ENGAGEMENT_RECEIVER in services/engagement_metrics.py and add the "
          "module to WRITERS_ALLOWED in this test — on the same commit."
    )


def test_the_writer_scan_would_actually_catch_one():
    """The scan above passing proves nothing unless it can fail.

    A check that walks a tree and finds nothing looks identical whether the
    product is clean or the walk is broken. So: hand the same predicate a
    statement of exactly the shape a receiver would write, and require it to be
    caught.
    """
    receiver_sql = (
        "UPDATE public.prachar_campaigns SET total_opened = total_opened + 1 "
        "WHERE id = $1::uuid"
    )
    upper = " ".join(receiver_sql.split()).upper()
    assert "UPDATE " in upper
    assert any(c in receiver_sql for c in em.UNMEASURED_COLUMNS)

    # And the inverse: a legitimate read must not trip it.
    read_sql = "SELECT COALESCE(SUM(total_opened),0) FROM public.prachar_campaigns"
    read_upper = " ".join(read_sql.split()).upper()
    assert "INSERT INTO" not in read_upper and "UPDATE " not in read_upper
