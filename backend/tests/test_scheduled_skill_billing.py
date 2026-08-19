"""
A skill that runs on a timer is charged exactly like one run by hand.

THE DEFECT. `dispatch_skill` is reached from precisely one place in the tree —
the cron at `POST /api/internal/cron/skills` — and nothing on that path ever
touched a wallet. `_run_llm_step` called `services.ai_router.generate` and
returned. Meanwhile the identical LLM work started from the Skills screen goes
through `hub.py`, which deducts before it generates. So the same template cost
credits when a person pressed Run and nothing at all when a timer did, forever,
while the provider invoiced Aekam per call either way. That is not a discount,
it is an unmetered channel — one of five this programme closes.

THE ATTRIBUTION. `hub_client_skills.assigned_by` has existed since migration 012
and was simply never selected by the cron query. It is now, and it is what the
spend is attributed to and capped against: a timer bills the person who
scheduled it. Where it is NULL the org balance still applies and the member
ceiling does not — an unattributable spend cannot be counted against anyone's
ceiling, and refusing it instead would stop every skill assigned before that
column was populated.

THE REFUSAL, which is the part that needed a decision rather than a translation.
A scheduled run has nobody in front of it to be told "top up". Three rules,
asserted below:

  · it STOPS at the first refusal — it does not skip the step, and it does not
    run the remaining steps unbilled;
  · it is RECORDED — the run row carries the refusal's own sentence, and the
    return carries `status: "insufficient_credits"` so a caller can tell a
    wallet from a bug;
  · it does not SPAM — `run_skills` reads each org's balance once per tick and
    does not dispatch at all for an org that cannot afford anything, and
    `last_run_at` is still bumped on a refusal so a partly-funded org cannot
    produce a failed run row every fifteen minutes forever.

Nothing is ever auto-disabled. A top-up resumes every skill on the next tick
with nobody re-enabling anything.
"""
import ast
import asyncio
import inspect
import textwrap
from unittest.mock import AsyncMock

import pytest

import services.credits as C
import services.skill_dispatcher as D
from routers import scheduler

ORG = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
RUN = "55555555-5555-5555-5555-555555555555"
TX = "66666666-6666-6666-6666-666666666666"
TEMPLATE = "77777777-7777-7777-7777-777777777777"


def _receipt(credits=2, replayed=False):
    return C.Receipt(
        tx_id=TX, org_id=ORG, user_id=USER, kind="skill_step", ref_id="blog",
        quantity=1, credits=credits, from_allowance=credits, from_purchased=0,
        balance_after=98, metered_only=False, replayed=replayed,
    )


class _Pool:
    """Records every statement. `hub_skill_runs` INSERT returns a fixed id."""

    def __init__(self):
        self.sql: list[tuple] = []

    async def fetchval(self, sql, *args):
        self.sql.append((sql, args))
        if "hub_skill_runs" in sql:
            return RUN
        return None

    async def fetchrow(self, sql, *args):
        self.sql.append((sql, args))
        return None

    async def fetch(self, sql, *args):
        self.sql.append((sql, args))
        return []

    async def execute(self, sql, *args):
        self.sql.append((sql, args))
        return "OK"

    def statements(self) -> str:
        return " || ".join(s for s, _ in self.sql)

    def args_for(self, needle):
        return [a for s, a in self.sql if needle in s]


@pytest.fixture
def spend_spy(monkeypatch):
    calls: list[dict] = []

    async def _spend(**kw):
        calls.append(kw)
        return _receipt()

    monkeypatch.setattr(C, "spend_standalone", _spend)
    return calls


@pytest.fixture
def refund_spy(monkeypatch):
    calls: list[dict] = []

    async def _refund(**kw):
        calls.append(kw)
        return None

    monkeypatch.setattr(C, "refund_standalone", _refund)
    return calls


@pytest.fixture
def fake_generate(monkeypatch):
    """`generate` is imported inside _run_llm_step, so patch it at the source."""
    import services.ai_router as R
    gen = AsyncMock(return_value={"text": "hello", "provider": "gemini",
                                  "model": "m", "cost_usd": 0.001})
    monkeypatch.setattr(R, "generate", gen)
    return gen


STEP = {"order": 1, "agent_type": "blog", "prompt_template": "Write about {topic}."}


def _template(steps=None):
    return {"id": TEMPLATE, "name": "Weekly blog", "skill_type": "content",
            "steps": steps if steps is not None else [STEP]}


# ── The step is charged, before it generates ────────────────────────────────

async def test_an_llm_step_is_charged(spend_spy, fake_generate):
    out = await D._run_llm_step(STEP, {"topic": "chai"}, ORG,
                                user_id=USER, run_id=RUN)
    assert spend_spy, "a scheduled LLM step must be charged"
    assert out["credits_charged"] == 2


async def test_the_charge_precedes_the_generation(spend_spy, fake_generate, monkeypatch):
    """Charging first is what stops concurrent runs raiding a wallet. The
    missing half everywhere else was the refund, not the ordering."""
    order: list[str] = []

    async def _spend(**kw):
        order.append("spend")
        return _receipt()

    async def _gen(**kw):
        order.append("generate")
        return {"text": "x"}

    monkeypatch.setattr(C, "spend_standalone", _spend)
    import services.ai_router as R
    monkeypatch.setattr(R, "generate", _gen)

    await D._run_llm_step(STEP, {}, ORG, user_id=USER, run_id=RUN)
    assert order == ["spend", "generate"]


async def test_the_price_is_the_steps_agent_type(spend_spy, fake_generate):
    """`skill_step` and `content` resolve against the SAME credit_prices row, so
    a blog written by a timer costs what a blog written by hand costs. A
    different kind only so reports can separate them."""
    await D._run_llm_step(STEP, {}, ORG, user_id=USER, run_id=RUN)
    assert spend_spy[0]["kind"] == "skill_step"
    assert spend_spy[0]["ref_id"] == "blog"


async def test_the_key_names_the_step_not_the_attempt(spend_spy, fake_generate):
    await D._run_llm_step(STEP, {}, ORG, user_id=USER, run_id=RUN)
    assert spend_spy[0]["idempotency_key"] == f"skillrun:{RUN}:step:1"


async def test_the_spend_is_attributed_to_the_scheduler(spend_spy, fake_generate):
    await D._run_llm_step(STEP, {}, ORG, user_id=USER, run_id=RUN)
    assert spend_spy[0]["user_id"] == USER


# ── …and refunded when the generation fails ────────────────────────────────

async def test_a_failed_generation_refunds(spend_spy, refund_spy, monkeypatch):
    import services.ai_router as R
    monkeypatch.setattr(R, "generate", AsyncMock(side_effect=RuntimeError("all providers failed")))

    with pytest.raises(RuntimeError):
        await D._run_llm_step(STEP, {}, ORG, user_id=USER, run_id=RUN)

    assert refund_spy, "a charge for work that did not happen must come back"
    assert refund_spy[0]["tx_id"] == TX


async def test_a_replayed_charge_is_not_refunded(refund_spy, monkeypatch):
    """A replay means an earlier attempt already paid — and may well have
    produced the output. Reversing it here would refund work the customer has."""
    async def _spend(**kw):
        return _receipt(replayed=True)

    monkeypatch.setattr(C, "spend_standalone", _spend)
    import services.ai_router as R
    monkeypatch.setattr(R, "generate", AsyncMock(side_effect=RuntimeError("boom")))

    with pytest.raises(RuntimeError):
        await D._run_llm_step(STEP, {}, ORG, user_id=USER, run_id=RUN)
    assert refund_spy == []


async def test_a_function_step_is_not_charged(spend_spy):
    """A function-backed step runs a scoped SQL read against tables the org
    already pays for. There is no provider invoice behind it and no price row
    for one."""
    src = _code_only(D.dispatch_skill)
    assert "_run_function_step" in src
    # the charge lives in _run_llm_step alone
    assert "spend" not in _code_only(D._run_function_step)


# ── The refusal: stop, record, do not spam ─────────────────────────────────

def _code_only(*fns) -> str:
    """Source with comments and docstrings stripped — see the twin helper in
    test_scraper_credits.py for why a tripwire must not match its own prose."""
    out = []
    for fn in fns:
        tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        for node in ast.walk(tree):
            body = getattr(node, "body", None)
            if not isinstance(body, list) or not body:
                continue
            first = body[0]
            if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                node.body = body[1:] or [ast.Pass()]
        out.append(ast.unparse(tree))
    return "\n".join(out)


@pytest.fixture
def refuse(monkeypatch):
    async def _spend(**kw):
        raise C.InsufficientOrgCredits(
            "This needs 5 credits. Your organisation has 1 (0 allowance + 1 "
            "purchased). Allowance resets on 1 September 2026. Contact Aekam "
            "to top up.",
            needed=5, org_total=1, org_allowance=0, org_purchased=1,
            next_period_start="2026-09-01",
        )

    monkeypatch.setattr(C, "spend_standalone", _spend)


async def test_a_refusal_stops_the_run_and_says_so(refuse, fake_generate):
    pool = _Pool()
    out = await D.dispatch_skill(pool, _template(), {}, ORG, user_id=USER)

    assert out["status"] == "insufficient_credits", (
        "a wallet is not a bug — the caller must be able to tell them apart "
        "without parsing a sentence"
    )
    assert out["credit_error"] == "org_credits_exhausted"
    assert out["steps_completed"] == 0
    assert "Contact Aekam" in out["error"]


async def test_a_refusal_never_generates(refuse, fake_generate):
    await D.dispatch_skill(_Pool(), _template(), {}, ORG, user_id=USER)
    fake_generate.assert_not_awaited()


async def test_a_refusal_stops_at_the_step_it_hit(monkeypatch, fake_generate):
    """Steps already completed keep their outputs — they were paid for and they
    produced something. The remaining steps are NOT run unbilled."""
    seen = []

    async def _spend(**kw):
        seen.append(kw["idempotency_key"])
        if len(seen) == 2:
            raise C.InsufficientOrgCredits("out", needed=5, org_total=0,
                                           org_allowance=0, org_purchased=0,
                                           next_period_start="2026-09-01")
        return _receipt()

    monkeypatch.setattr(C, "spend_standalone", _spend)

    steps = [dict(STEP, order=n) for n in (1, 2, 3)]
    out = await D.dispatch_skill(_Pool(), _template(steps), {}, ORG, user_id=USER)

    assert out["status"] == "insufficient_credits"
    assert out["steps_completed"] == 1
    assert len(out["outputs"]) == 1
    assert len(seen) == 2, "the third step must never have been attempted"


async def test_the_refusal_is_written_onto_the_run_row(refuse, fake_generate):
    pool = _Pool()
    await D.dispatch_skill(pool, _template(), {}, ORG, user_id=USER)

    updates = pool.args_for("SET status = 'failed'")
    assert updates, "the run must be marked failed, not left 'running'"
    assert "Contact Aekam" in updates[0][2], (
        "the run row must carry the sentence naming what was needed and what "
        "is held — it is the only surface a scheduled run has"
    )


# ── The cron: attribution, the damper, and the slot ────────────────────────

class _CronPool(_Pool):
    def __init__(self, rows, balance_total=100, platform=False):
        super().__init__()
        self._rows = rows
        self._balance = C.Balance(
            org_id=ORG, allowance=balance_total, purchased=0,
            total=balance_total, period_start=None,
            is_platform_org=platform, monthly_credits=0,
        )

    async def fetch(self, sql, *args):
        self.sql.append((sql, args))
        return self._rows if "hub_client_skills" in sql else []

    def acquire(self):
        class _A:
            async def __aenter__(self_):
                return None

            async def __aexit__(self_, *a):
                return False

        return _A()


async def _drain():
    """`run_skills` dispatches with asyncio.create_task, so it returns before
    the work starts. Nothing here is testable until those tasks have run."""
    pending = list(scheduler._background_tasks)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


def _cron_row(**over):
    row = {
        "client_skill_id": "88888888-8888-8888-8888-888888888888",
        "org_id": ORG, "client_id": None, "custom_config": {},
        "last_run_at": None, "assigned_by": USER,
        "template_id": TEMPLATE, "name": "Weekly blog", "description": "",
        "skill_type": "content", "scope": "org", "module": "sahayak",
        "steps": [STEP], "trigger_config": {"type": "cron", "interval_minutes": 15},
        "is_system": False,
    }
    row.update(over)
    return row


@pytest.fixture
def open_cron(monkeypatch):
    monkeypatch.setattr(scheduler, "_verify_cron", AsyncMock(return_value=None))


def test_the_cron_query_selects_assigned_by():
    """The column has existed since migration 012 and was never selected, so
    every scheduled spend would have landed unattributable."""
    assert "cs.assigned_by" in _code_only(scheduler.run_skills)


async def test_the_cron_bills_whoever_scheduled_the_skill(open_cron, monkeypatch):
    pool = _CronPool([_cron_row()])
    monkeypatch.setattr(scheduler, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(C, "balance_of", AsyncMock(return_value=pool._balance))

    seen = {}

    async def _run_and_update(p, csid, tmpl, variables, org_id, user_id=None):
        seen["user_id"] = user_id

    monkeypatch.setattr(scheduler, "_run_and_update_skill", _run_and_update)

    out = await scheduler.run_skills("secret")
    await _drain()
    assert out["dispatched"] == 1
    assert seen["user_id"] == USER


async def test_a_null_assigned_by_becomes_none_not_the_string(open_cron, monkeypatch):
    """`str(None)` is "None", which would attribute every legacy skill's spend
    to a member id that cannot exist and cap it against a ceiling nobody set."""
    pool = _CronPool([_cron_row(assigned_by=None)])
    monkeypatch.setattr(scheduler, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(C, "balance_of", AsyncMock(return_value=pool._balance))

    seen = {}

    async def _run_and_update(p, csid, tmpl, variables, org_id, user_id=None):
        seen["user_id"] = user_id

    monkeypatch.setattr(scheduler, "_run_and_update_skill", _run_and_update)
    await scheduler.run_skills("secret")
    await _drain()
    assert seen["user_id"] is None


async def test_a_broke_org_is_not_dispatched_at_all(open_cron, monkeypatch):
    """The anti-spam half. Without it a flat-broke org with six scheduled
    skills writes six failed run rows every fifteen minutes, forever."""
    pool = _CronPool([_cron_row(), _cron_row()], balance_total=0)
    monkeypatch.setattr(scheduler, "get_pool", AsyncMock(return_value=pool))
    bal = AsyncMock(return_value=pool._balance)
    monkeypatch.setattr(C, "balance_of", bal)
    monkeypatch.setattr(scheduler, "_run_and_update_skill", AsyncMock())

    out = await scheduler.run_skills("secret")
    await _drain()
    # `reaped` joined the response when the abandoned-run reaper was added: runs
    # that died mid-flight used to sit at 'running' for ever because nothing
    # transitioned them. It is reported on every tick, including a tick where
    # nothing was due, since clearing tombstones is not conditional on new work.
    assert out == {"dispatched": 0, "skipped_no_credits": 2, "reaped": 0,
                   "org_dispatched": 0}
    assert bal.await_count == 1, "one balance read per ORG per tick, not per skill"


async def test_a_platform_org_at_zero_still_runs(open_cron, monkeypatch):
    """A platform org skips the balance check and nothing else. Its spends are
    still metered into the ledger, which is the entire point of the flag."""
    pool = _CronPool([_cron_row()], balance_total=0, platform=True)
    monkeypatch.setattr(scheduler, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(C, "balance_of", AsyncMock(return_value=pool._balance))
    monkeypatch.setattr(scheduler, "_run_and_update_skill", AsyncMock())

    out = await scheduler.run_skills("secret")
    await _drain()
    assert out["dispatched"] == 1


async def test_an_unreadable_balance_fails_open(open_cron, monkeypatch):
    """The damper is not the enforcement. `credits.spend` refuses; this only
    stops the noise, and a damper that blocks work because it could not read a
    number is worse than the noise."""
    pool = _CronPool([_cron_row()])
    monkeypatch.setattr(scheduler, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(C, "balance_of", AsyncMock(side_effect=RuntimeError("down")))
    monkeypatch.setattr(scheduler, "_run_and_update_skill", AsyncMock())

    out = await scheduler.run_skills("secret")
    await _drain()
    assert out["dispatched"] == 1


async def test_a_refusal_still_consumes_its_interval(monkeypatch):
    """`last_run_at` is bumped on every outcome INCLUDING a refusal.

    Not bumping it would make the skill due again on the very next tick, so an
    org holding 1 credit against a 2-credit step would write a failed run row
    every fifteen minutes indefinitely. The interval is the customer's own
    setting and it is honoured whatever the outcome; what stops the slot being
    consumed SILENTLY is the run row, the WARNING, and the org-level damper.
    """
    pool = _Pool()
    monkeypatch.setattr(
        scheduler, "dispatch_skill",
        AsyncMock(return_value={"status": "insufficient_credits",
                                "steps_completed": 0, "error": "no credits"}),
    )
    await scheduler._run_and_update_skill(
        pool, "cs-1", _template(), {}, ORG, user_id=USER,
    )
    assert pool.args_for("SET last_run_at = now()"), (
        "the interval must be honoured or the refusal becomes a retry storm"
    )


async def test_nothing_is_auto_disabled(monkeypatch):
    """A top-up must resume everything without an admin re-enabling anything."""
    pool = _Pool()
    monkeypatch.setattr(
        scheduler, "dispatch_skill",
        AsyncMock(return_value={"status": "insufficient_credits",
                                "steps_completed": 0, "error": "no credits"}),
    )
    await scheduler._run_and_update_skill(pool, "cs-1", _template(), {}, ORG)
    assert "is_active = FALSE" not in pool.statements()
    assert "is_active=FALSE" not in pool.statements()
