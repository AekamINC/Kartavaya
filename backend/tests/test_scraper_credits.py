"""
Scraper credits: charged once, named by the run, and never quietly forgiven.

Four defects this file pins, all of them measured rather than imagined.

1. THE CHARGE HAD NOTHING TO NAME ITSELF AFTER. `run_scraper` debited, called
   Apify, and only then wrote the `hub_scraper_runs` row. A crash in between
   left a committed charge with no run to refund it against and no record a run
   had been attempted. Measured on staging 2026-07-31: `mca_company_lookup`
   points at an Apify actor that 404s, one click took FOUR credits across three
   client retries, and zero run rows existed afterwards. The row is now written
   first, in the same transaction as the debit, and its id IS the idempotency
   key — so a retry cannot charge twice and a lost poller can find the charge
   again.

2. THE MEMBER CEILING DID NOT APPLY. The hand-rolled debit read the org wallet
   alone. A member capped at 200 credits could run scrapers all month.

3. `or 2` PRICED THE CATALOG. `scraper.get("credit_cost") or 2` meant a catalog
   row with no price silently became a 2-credit run that looked deliberate.

4. THE TRUE-UP WAS SILENTLY FORGIVEN AND THE LEDGER LIED ABOUT IT.
   `new_bal = max(0, balance - extra)` clamped the wallet while the ledger row
   was written with the full `-extra` and the clamped balance as `balance_after`.
   From that row onward SUM(amount) and the wallet disagreed permanently, for
   the life of the org. An unaffordable true-up now raises and is logged as a
   debt.

Style 2 throughout — hand-written fakes over SQL substrings, per the house
convention in test_credit_refund.py. Not MagicMock call-arg assertions.
"""
import ast
import inspect
import textwrap
from unittest.mock import AsyncMock, MagicMock

import pytest

import services.credits as C
from routers import scrapers
from routers.scrapers import RunScraper, _deduct_extra_credits, run_scraper, sweep_stranded_runs

ORG = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
RUN = "33333333-3333-3333-3333-333333333333"
TX = "44444444-4444-4444-4444-444444444444"

def _code_only(*fns) -> str:
    """Source with comments and docstrings stripped.

    Every source-level assertion below matches a defect by the code that caused
    it — `or 2`, `max(0`, `uuid`. Those same strings appear in the comments
    explaining what went wrong, and a tripwire that fires on its own explanation
    can only be satisfied by deleting the explanation. `ast.unparse` drops
    comments; the walk drops docstrings.
    """
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


CATALOG = {
    "id": "google_maps",
    "name": "Google Maps Scraper",
    "credit_cost": 5,
    "price_inr": 50.0,
    "max_results": 100,
    "apify_actor_id": "compass/crawler-google-places",
    "input_schema": [{"name": "query", "type": "text", "default": ""}],
    "result_path": None,
}


def _receipt(credits=5, tx_id=TX, replayed=False):
    return C.Receipt(
        tx_id=tx_id, org_id=ORG, user_id=USER, kind="scraper",
        ref_id=CATALOG["id"], quantity=1, credits=credits,
        from_allowance=credits, from_purchased=0, balance_after=95,
        metered_only=False, replayed=replayed,
    )


class _Conn:
    """One connection. Records every statement, in order."""

    def __init__(self, run_id=RUN):
        self.run_id = run_id
        self.sql: list[tuple] = []
        self.txn_depth = 0
        self.max_txn_depth = 0

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self_):
                conn.txn_depth += 1
                conn.max_txn_depth = max(conn.max_txn_depth, conn.txn_depth)
                return conn

            async def __aexit__(self_, *a):
                conn.txn_depth -= 1
                return False

        return _T()

    async def fetchval(self, sql, *args):
        self.sql.append((sql, args))
        if "INSERT INTO staging.hub_scraper_runs" in sql:
            return self.run_id
        return None

    async def fetchrow(self, sql, *args):
        self.sql.append((sql, args))
        return None

    async def execute(self, sql, *args):
        self.sql.append((sql, args))
        return "OK"

    def statements(self) -> str:
        return " || ".join(s for s, _ in self.sql)


class _Pool:
    def __init__(self, conn, catalog=CATALOG, runs=()):
        self._conn = conn
        self._catalog = catalog
        self._runs = list(runs)
        self.sql: list[tuple] = []

    def acquire(self):
        conn = self._conn

        class _A:
            async def __aenter__(self_):
                return conn

            async def __aexit__(self_, *a):
                return False

        return _A()

    async def fetchrow(self, sql, *args):
        self.sql.append((sql, args))
        if "hub_scraper_catalog" in sql:
            return self._catalog
        return None

    async def fetch(self, sql, *args):
        self.sql.append((sql, args))
        return self._runs

    async def execute(self, sql, *args):
        self.sql.append((sql, args))
        return "OK"

    def statements(self) -> str:
        return " || ".join(s for s, _ in self.sql)


@pytest.fixture
def wired(monkeypatch):
    """A pool, a spend spy, a refund spy, and no background poller."""
    conn = _Conn()
    pool = _Pool(conn)
    monkeypatch.setattr(scrapers, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(scrapers, "_spawn", lambda coro: coro.close())

    spends: list[dict] = []
    refunds: list[dict] = []

    async def _spend(c, **kw):
        spends.append({"conn": c, **kw})
        return _receipt()

    async def _refund(c, **kw):
        refunds.append(kw)
        return None

    monkeypatch.setattr(C, "spend", _spend)
    monkeypatch.setattr(C, "refund", _refund)

    import services.apify as apify
    monkeypatch.setattr(
        apify, "start_actor",
        AsyncMock(return_value={"run_id": "apify-run-1"}), raising=False,
    )

    return {"conn": conn, "pool": pool, "spends": spends,
            "refunds": refunds, "apify": apify}


async def _run(body=None):
    return await run_scraper(
        body or RunScraper(scraper_id=CATALOG["id"], inputs={"query": "cafes"}),
        user={"user_id": USER}, org_id=ORG, _g=None,
    )


# ── 1. The row is written before the debit, in one transaction ──────────────

async def test_the_run_row_is_written_before_the_debit(wired):
    out = await _run()
    assert out["status"] == "started"

    stmts = [s for s, _ in wired["conn"].sql]
    insert_at = next(i for i, s in enumerate(stmts)
                     if "INSERT INTO staging.hub_scraper_runs" in s)
    # `credits.spend` is not SQL on this fake, so its position is recorded by
    # the statement that follows it: the credits_charged write-back.
    charged_at = next(i for i, s in enumerate(stmts) if "credits_charged=$2" in s)
    assert insert_at < charged_at
    assert wired["spends"], "the run must be charged"


async def test_the_row_and_the_debit_share_one_transaction(wired):
    """A refused spend must leave no run row behind, which is only true if the
    two are in the same transaction. The fake records nesting depth; the debit
    is handed the same connection the INSERT used."""
    await _run()
    assert wired["conn"].max_txn_depth >= 1
    assert wired["spends"][0]["conn"] is wired["conn"], (
        "spend() must run inside the caller's transaction — it opens none of "
        "its own, which is the whole reason it takes a conn"
    )


# ── 2. The key names the run, not the attempt ───────────────────────────────

async def test_the_idempotency_key_is_the_run_id(wired):
    await _run()
    key = wired["spends"][0]["idempotency_key"]
    assert key == f"scraper:{RUN}:min"


def test_the_key_carries_no_clock_and_no_fresh_uuid():
    """A key built from a timestamp or a uuid4 is decoration, not idempotency.

    Asserted on the source because the property is about how the key is BUILT,
    and a key that happened to be stable in one test run would pass any
    behavioural check.
    """
    src = _code_only(scrapers._upfront_key, scrapers._trueup_key)
    for banned in ("time(", "now(", "uuid", "utcnow", "monotonic"):
        assert banned not in src, f"{banned} has no place in an idempotency key"


# ── 3. The member ceiling, and the price ────────────────────────────────────

async def test_the_run_is_attributed_to_a_user_so_the_ceiling_applies(wired):
    """The hand-rolled debit read the org wallet alone, so a member capped at
    200 credits could run scrapers all month."""
    await _run()
    assert wired["spends"][0]["user_id"] == USER


async def test_the_catalog_prices_the_run_and_nothing_defaults_to_two(wired):
    await _run()
    s = wired["spends"][0]
    assert s["kind"] == "scraper"
    assert s["ref_id"] == CATALOG["id"]
    assert "credits_override" not in s or s.get("credits_override") is None

    src = _code_only(run_scraper)
    assert "or 2" not in src, (
        "`credit_cost or 2` is how an unpriced catalog row became a 2-credit run"
    )


async def test_a_refusal_never_reaches_apify(wired, monkeypatch):
    """Nothing is started, and no HTTP 402 is invented on top of the real one."""
    async def _refuse(c, **kw):
        raise C.InsufficientOrgCredits(
            "This needs 5 credits.", needed=5, org_total=0,
            org_allowance=0, org_purchased=0, next_period_start="2026-09-01",
        )

    monkeypatch.setattr(C, "spend", _refuse)
    with pytest.raises(C.InsufficientOrgCredits) as e:
        await _run()
    assert e.value.status_code == 402
    wired["apify"].start_actor.assert_not_awaited()


# ── 4. A failed start refunds the transaction and shows the failed run ──────

async def test_a_failed_start_refunds_and_leaves_a_visible_failed_run(wired, monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(
        wired["apify"], "start_actor",
        AsyncMock(side_effect=RuntimeError("actor 404")), raising=False,
    )
    with pytest.raises(HTTPException) as e:
        await _run()
    assert e.value.status_code == 502

    assert wired["refunds"], "the upfront charge must come back"
    assert wired["refunds"][0]["tx_id"] == TX

    # …and the run is visible as failed rather than absent. A charge with no run
    # row is the state that cost four credits and left nothing to look at.
    assert "status='failed'" in wired["pool"].statements()


async def test_a_withdrawn_scraper_is_410_and_still_refunds(wired, monkeypatch):
    from fastapi import HTTPException
    from services.apify import BlockedActorError

    monkeypatch.setattr(
        wired["apify"], "start_actor",
        AsyncMock(side_effect=BlockedActorError("withdrawn")), raising=False,
    )
    with pytest.raises(HTTPException) as e:
        await _run()
    assert e.value.status_code == 410
    assert wired["refunds"][0]["tx_id"] == TX


async def test_a_bad_input_costs_nothing(wired):
    """`int(val)` on a number field the user filled in wrong used to raise AFTER
    the wallet had already moved."""
    schema = dict(CATALOG)
    schema["input_schema"] = [{"name": "limit", "type": "number"}]
    wired["pool"]._catalog = schema

    with pytest.raises(ValueError):
        await _run(RunScraper(scraper_id=CATALOG["id"], inputs={"limit": "twelve"}))
    assert wired["spends"] == [], "a malformed input must never cost a credit"


# ── 5. The true-up is not forgiven ──────────────────────────────────────────

async def test_the_true_up_charges_the_difference_and_names_its_own_key(wired):
    await _deduct_extra_credits(wired["pool"], ORG, USER, 9, RUN, CATALOG["id"])
    s = wired["spends"][0]
    assert s["credits_override"] == 9
    assert s["kind"] == "scraper_trueup"
    assert s["idempotency_key"] == f"scraper:{RUN}:trueup"


async def test_an_unaffordable_true_up_raises_rather_than_clamping(wired, monkeypatch):
    """The clamp wrote the full `-extra` to the ledger while moving the wallet
    by less, so `balance_after` and the wallet diverged permanently."""
    async def _refuse(c, **kw):
        raise C.InsufficientOrgCredits(
            "This needs 9 credits.", needed=9, org_total=2,
            org_allowance=0, org_purchased=2, next_period_start="2026-09-01",
        )

    monkeypatch.setattr(C, "spend", _refuse)
    with pytest.raises(C.InsufficientOrgCredits):
        await _deduct_extra_credits(wired["pool"], ORG, USER, 9, RUN, CATALOG["id"])


def test_no_clamp_survives_anywhere_in_the_true_up_path():
    src = _code_only(_deduct_extra_credits)
    assert "max(0" not in src, (
        "`max(0, balance - extra)` forgave an unaffordable true-up and left the "
        "ledger disagreeing with the wallet forever"
    )


async def test_a_zero_or_negative_true_up_writes_nothing(wired):
    assert await _deduct_extra_credits(wired["pool"], ORG, USER, 0, RUN, CATALOG["id"]) is None
    assert await _deduct_extra_credits(wired["pool"], ORG, USER, -3, RUN, CATALOG["id"]) is None
    assert wired["spends"] == []


# ── 6. The sweep ────────────────────────────────────────────────────────────

async def test_the_sweep_refunds_a_run_whose_poller_never_came_back(monkeypatch):
    """`_poll_run` is an in-process task. A deploy mid-poll left the row
    'running' forever with the debit taken and every refund path inside the
    task that died with it."""
    conn = _Conn()
    pool = _Pool(conn, runs=[{
        "id": RUN, "org_id": ORG, "scraper_id": CATALOG["id"],
        "user_id": USER, "credits_charged": 5,
    }])
    monkeypatch.setattr(scrapers, "get_pool", AsyncMock(return_value=pool))

    refunds: list[dict] = []

    async def _spend(c, **kw):
        # The run WAS charged, so the key replays and nothing is written.
        return _receipt(replayed=True)

    async def _refund(c, **kw):
        refunds.append(kw)
        return None

    monkeypatch.setattr(C, "spend", _spend)
    monkeypatch.setattr(C, "refund", _refund)

    out = await sweep_stranded_runs()
    assert out == {"swept": 1, "failed": 0}
    assert refunds[0]["tx_id"] == TX
    stmts = conn.statements()
    assert "status='failed'" in stmts
    assert "billed_inr=0" in stmts


async def test_the_sweep_only_looks_at_runs_past_the_poll_budget(monkeypatch):
    conn = _Conn()
    pool = _Pool(conn, runs=[])
    monkeypatch.setattr(scrapers, "get_pool", AsyncMock(return_value=pool))

    await sweep_stranded_runs()
    sql = pool.statements()
    assert "status IN ('pending','running')" in sql
    assert "make_interval" in sql
    assert scrapers.POLL_BUDGET_MINUTES >= 10, (
        "_poll_run gives up at 10 minutes and refunds itself; a budget below "
        "that would sweep runs that are still working"
    )


async def test_one_bad_run_does_not_stop_the_sweep(monkeypatch):
    conn = _Conn()
    rows = [
        {"id": RUN, "org_id": ORG, "scraper_id": "a", "user_id": USER, "credits_charged": 5},
        {"id": RUN, "org_id": ORG, "scraper_id": "b", "user_id": USER, "credits_charged": 5},
    ]
    pool = _Pool(conn, runs=rows)
    monkeypatch.setattr(scrapers, "get_pool", AsyncMock(return_value=pool))

    seen = []

    async def _spend(c, **kw):
        seen.append(kw["ref_id"])
        if kw["ref_id"] == "a":
            raise RuntimeError("wallet unreadable")
        return _receipt(replayed=True)

    monkeypatch.setattr(C, "spend", _spend)
    monkeypatch.setattr(C, "refund", AsyncMock(return_value=None))

    out = await sweep_stranded_runs()
    assert out == {"swept": 1, "failed": 1}
    assert seen == ["a", "b"]


# ── 7. The isolation this file's whole point depends on ─────────────────────

def test_scrapers_names_no_credit_table():
    """Every wallet write now lives in services/credits.py. A second one here is
    how five debit implementations happened the first time."""
    src = inspect.getsource(scrapers)
    for table in ("hub_org_credits", "hub_org_credit_transactions",
                  "org_member_credits", "credit_prices"):
        assert table not in src, f"{table} must only be named in services/credits.py"


def test_the_poller_is_held_so_it_cannot_be_collected():
    """`asyncio.ensure_future` returns a task the loop only weakly references. A
    collected poller is indistinguishable from a restart: the run sits 'running'
    forever with the debit never reversed."""
    assert isinstance(scrapers._pollers, set)
    assert "add_done_callback" in _code_only(scrapers._spawn)
