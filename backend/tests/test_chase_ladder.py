"""The chase ladder, and the four ways a chaser becomes a filter rule.

Catalogue #28 — the folio's highest-value entry in the Next tier. The value is
not the list; `find_overdue_tasks` and `find_stalled_agreements` already return
that. The value is knowing WHICH OF THESE HAVE ALREADY BEEN CHASED TWICE, and
every test here is about the ways that knowledge goes wrong quietly.

  · `test_the_chase_count_is_keyed_on_the_uuid_not_the_task_ref` — the bug this
    file exists to pin. `public.tasks` carries BOTH `id` and `task_id`, and
    `staging.reminders.entity_id` holds the uuid: measured live, 102 of 102 task
    reminders match `id` and NOT ONE matches `task_id`. Keying on the wrong one
    is completely silent — every item returns zero chases, sits on rung 1 for
    ever, and the skill chases the same list every day. It looked correct on
    screen: 163 items, all "first nudge".
  · `test_a_suppressed_reminder_is_not_a_chase` — 304 follow-up and 26 invoice
    reminders live carry status 'suppressed', meaning nobody received them.
    Counting one promotes an item up the ladder on a message that never went,
    and then escalates to a partner about a client who was never written to.
  · `test_the_ladder_never_skips_a_rung` — an item that appears at twelve days
    overdue with no chases owes the FIRST nudge, not the escalation.
  · `test_an_expired_signature_is_not_chased` — asking somebody to sign a link
    that no longer works is worse than silence.

Live figures, read-only 2026-08-20, after the key fix:

  seeded org  163 waiting (134 tasks + 29 signatures), 147 nudges due,
              4 escalations, 12 correctly holding because they are already
              chased — "Collect KYC documents from Patel" has 2 delivered
              chases and is on rung 2
  eSign       NOT ONE reminder row has ever carried entity_type
              'sign_documents', so every stalled signature is on rung zero
"""
import inspect
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skills.data import chase_ladder as cl
from services.skills.data.chase_ladder import (
    DELIVERED_STATUSES, ENTITY_SIGN, ENTITY_TASK, LADDER, check_chase_ladder,
    _rung_for,
)

ORG = "00000000-0000-4000-8000-000000000028"
TODAY = date(2026, 8, 20)


class _Pool:
    """Canned result sets. The reminder arm filters on the entity_type bind
    parameter, because the handler asks for tasks and signatures separately and
    a mock that ignores it would give each the other's chase counts."""

    def __init__(self, tasks=None, signs=None, chases=None):
        self.tasks, self.signs = tasks or [], signs or []
        self.chases = chases or {}          # entity_type -> [{entity_id, n}]

    async def fetch(self, sql, *a):
        if "staging.reminders" in sql:
            return self.chases.get(a[1], [])
        if "public.tasks" in sql:
            return self.tasks
        if "sign_documents" in sql:
            return self.signs
        return []

    async def fetchrow(self, sql, *a):
        return None

    async def fetchval(self, sql, *a):
        return None


def _task(**kw):
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "task_id": "task_40e4473e9959",
        "title": "Collect KYC documents from Patel Traders",
        "due_at": datetime(2026, 8, 5, tzinfo=timezone.utc),
        "status": "in_progress",
        "created_by_name": "Priya Desai",
        "assignee_emails": [],
    }
    row.update(kw)
    return row


def _sign(**kw):
    row = {
        "id": "22222222-2222-4222-8222-222222222222",
        "title": "Engagement letter — Bansal Foods",
        "status": "sent",
        "created_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
        "expires_at": None, "signers_total": 2, "signers_completed": 0,
        "raised_by": "Anil Kumar",
    }
    row.update(kw)
    return row


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(cl, "utc_now",
                        lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


# ══════════════════════════════════════════════════════════════════════════
# the rung arithmetic
# ══════════════════════════════════════════════════════════════════════════

def test_nothing_is_due_before_the_first_rung():
    r = _rung_for(days_overdue=1, already_sent=0)
    assert r["action"] == "nothing yet" and r["rung"] == 0


@pytest.mark.parametrize("days,expected", [
    (2, "first nudge"), (4, "first nudge"),
    (5, "first nudge"),          # entitled to rung 2, but rung 1 was never sent
    (9, "first nudge"),
])
def test_the_ladder_never_skips_a_rung(days, expected):
    """An item that appears at twelve days overdue with no chases owes the
    FIRST nudge. Skipping to the top sends a partner an escalation about a
    client nobody has written to."""
    assert _rung_for(days, already_sent=0)["action"] == expected


def test_each_delivered_chase_advances_exactly_one_rung():
    assert _rung_for(9, already_sent=1)["action"] == "second nudge"
    assert _rung_for(9, already_sent=2)["action"] == "escalate inside the firm"
    assert _rung_for(9, already_sent=3)["action"] == "already done"


def test_the_third_rung_is_an_escalation_and_not_a_third_nudge():
    """'escalates internally at +9 INSTEAD OF nudging again'. A chaser that
    keeps chasing has become a filter rule in the recipient's inbox."""
    assert LADDER[-1][1] == "escalate inside the firm"
    assert LADDER[-1][2] == "internal"
    assert sum(1 for _, _, kind in LADDER if kind == "external") == 2


def test_an_item_already_at_its_rung_is_not_chased_again():
    r = _rung_for(days_overdue=6, already_sent=2)
    assert r["action"] == "already done"


# ══════════════════════════════════════════════════════════════════════════
# the key, and the status — the two silent ones
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_chase_count_is_keyed_on_the_uuid_not_the_task_ref(frozen):
    """THE bug. reminders.entity_id holds tasks.id, not tasks.task_id.

    Measured live: 102 of 102 task reminders match `id`, ZERO match `task_id`.
    Keying on the wrong column returns zero chases for everything, so every item
    stays on rung 1 and is chased daily for ever — and every screen looks right.
    """
    task = _task()
    pool = _Pool(tasks=[task],
                 chases={ENTITY_TASK: [{"entity_id": task["id"], "n": 2}]})

    out = await check_chase_ladder(pool, ORG)

    item = (out["nudges_due"] + out["escalations_due"]
            + out["waiting_but_nothing_due"])[0]
    assert item["chases_delivered"] == 2, "the uuid key did not match"
    assert item["entity_id"] == task["id"]
    # …and the human handle is still carried, for a link, but is NOT the key.
    assert item["task_ref"] == "task_40e4473e9959"


@pytest.mark.asyncio
async def test_keying_on_the_wrong_column_would_have_been_silent(frozen):
    """The proof that the previous test is worth having: with the counts filed
    under `task_id`, the item comes back at rung 1 and nothing looks wrong."""
    task = _task()
    pool = _Pool(tasks=[task],
                 chases={ENTITY_TASK: [{"entity_id": task["task_id"], "n": 2}]})

    out = await check_chase_ladder(pool, ORG)

    item = out["nudges_due"][0]
    assert item["chases_delivered"] == 0
    assert item["action"] == "first nudge"        # …and it would chase for ever


def test_a_suppressed_reminder_is_not_a_chase():
    """304 follow-up and 26 invoice reminders live are 'suppressed' — nobody
    received them. Counting one escalates to a partner about a client who was
    never written to."""
    assert DELIVERED_STATUSES == ("sent",)
    src = inspect.getsource(cl._chase_counts)
    assert "status = ANY" in src
    assert "suppressed" not in src


# ══════════════════════════════════════════════════════════════════════════
# what it returns
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_tasks_and_signatures_are_both_counted(frozen):
    pool = _Pool(tasks=[_task()], signs=[_sign()])

    out = await check_chase_ladder(pool, ORG)

    assert out["counts"]["tasks"] == 1
    assert out["counts"]["signatures"] == 1
    assert out["counts"]["waiting_on"] == 2


@pytest.mark.asyncio
async def test_an_escalation_names_a_person_never_an_id(frozen):
    """Names, not ids — the product-wide rule."""
    old = _task(due_at=datetime(2026, 8, 1, tzinfo=timezone.utc))
    pool = _Pool(tasks=[old],
                 chases={ENTITY_TASK: [{"entity_id": old["id"], "n": 2}]})

    out = await check_chase_ladder(pool, ORG)

    esc = out["escalations_due"][0]
    assert esc["action"] == "escalate inside the firm"
    assert esc["escalate_to"] == "Priya Desai"


@pytest.mark.asyncio
async def test_an_escalation_with_nobody_to_escalate_to_is_named(frozen):
    """'The third rung has nowhere to go — route it to the org admin, or fix
    reporting_to first.' It names them rather than picking somebody."""
    old = _task(due_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
                created_by_name=None)
    pool = _Pool(tasks=[old],
                 chases={ENTITY_TASK: [{"entity_id": old["id"], "n": 2}]})

    out = await check_chase_ladder(pool, ORG)

    assert out["counts"]["escalations_with_no_owner"] == 1
    assert any("NO internal owner" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_an_expired_signature_is_not_chased(frozen):
    """Asking somebody to sign a link that no longer works is worse than
    silence — it must be reissued, not chased."""
    dead = _sign(expires_at=datetime(2026, 8, 1, tzinfo=timezone.utc))
    pool = _Pool(signs=[dead])

    out = await check_chase_ladder(pool, ORG)

    assert out["counts"]["expired_signatures"] == 1
    assert out["counts"]["nudges_due"] == 0
    # …and it is RENDERED, not merely counted. Its action is in neither the due
    # set nor the holding set, so before it had its own list it was counted and
    # shown nowhere — a row a count insists exists and no reader can find.
    assert len(out["expired_and_must_be_reissued"]) == 1
    assert "reissued" in out["expired_and_must_be_reissued"][0]["why"]


@pytest.mark.asyncio
async def test_every_item_appears_in_exactly_one_output_list(frozen):
    """The drift guard on the four lists. Anything that is counted must be
    somewhere a reader can open it, and nothing may be in two places."""
    pool = _Pool(
        tasks=[_task(id="a" * 8 + "-aaaa-4aaa-8aaa-" + "a" * 12),
               _task(id="b" * 8 + "-bbbb-4bbb-8bbb-" + "b" * 12,
                     due_at=datetime(2026, 8, 19, tzinfo=timezone.utc))],
        signs=[_sign(), _sign(id="c" * 8 + "-cccc-4ccc-8ccc-" + "c" * 12,
                              expires_at=datetime(2026, 8, 1, tzinfo=timezone.utc))],
    )

    out = await check_chase_ladder(pool, ORG)

    rendered = (out["nudges_due"] + out["escalations_due"]
                + out["expired_and_must_be_reissued"]
                + out["waiting_but_nothing_due"])
    ids = [i["entity_id"] for i in rendered]

    assert len(ids) == len(set(ids)), "an item is in two lists"
    assert len(ids) == out["counts"]["waiting_on"], "an item is in no list"


@pytest.mark.asyncio
async def test_a_signature_that_has_never_been_chased_is_on_rung_zero(frozen):
    """Live, NOT ONE reminder row has ever carried entity_type
    'sign_documents'. Every stalled signature in the product is unchased."""
    pool = _Pool(signs=[_sign()])

    out = await check_chase_ladder(pool, ORG)

    item = out["nudges_due"][0]
    assert item["chases_delivered"] == 0
    assert item["entity_type"] == ENTITY_SIGN
    assert item["signers"] == "0 of 2"


@pytest.mark.asyncio
async def test_the_ladder_itself_is_on_the_output(frozen):
    """A reader has to be able to see the rule the answer came from."""
    out = await check_chase_ladder(_Pool(), ORG)

    assert [r["days_past_due"] for r in out["ladder"]] == [2, 5, 9]
    assert out["ladder"][-1]["direction"] == "internal"


# ══════════════════════════════════════════════════════════════════════════
# the promises
# ══════════════════════════════════════════════════════════════════════════

SRC = inspect.getsource(cl)


def test_it_never_sends_and_never_writes():
    """Not even a reminder row: writing one marks an item chased that nobody
    chased. Sending is Niyam's, and arming a Niyam rule is the owner's."""
    for verb in ("insert into", "update ", "delete from", "send_email",
                 "send(", "outbound"):
        assert verb not in SRC.lower(), verb


def test_the_task_query_is_scoped_through_the_org_not_a_passed_team(frozen):
    """`public.tasks` has no org_id, so the org path is
    organisations.team_id — resolved from the org here, so a caller cannot hand
    this another org's team."""
    assert "SELECT team_id FROM staging.organisations" in SRC
    assert "WHERE id = $1::uuid" in SRC


@pytest.mark.asyncio
async def test_it_runs_from_the_org_alone(frozen):
    required = [n for n, p in inspect.signature(check_chase_ladder).parameters.items()
                if n not in ("pool", "org_id") and p.default is inspect.Parameter.empty]
    assert not required, required


@pytest.mark.asyncio
async def test_it_always_returns_limitations(frozen):
    out = await check_chase_ladder(_Pool(), ORG)

    assert out["limitations"]
    assert any("NEVER SENDS AND NEVER WRITES" in l for l in out["limitations"])
    assert any("no per-client document checklist" in l for l in out["limitations"])
