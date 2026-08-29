"""The analytics spine — one adapter contract, one upsert path (A1).

Proposal 60's single rule: THE ADAPTER NEVER TOUCHES SQL. It yields facts —
(entity_external_id, date, metric, value, currency) — and this module owns
resolution and upsert. That is what keeps a new source at ~200 lines and
stops each adapter inventing its own idea of a day boundary.

The sync loop here is A3's core, shipped with A1 because the cursor and
lookback ARE the contract's semantics, not scheduling detail:

  · re-pull from cursor_date − lookback_days to YESTERDAY — conversions get
    attributed late, and a 7-day re-pull is the difference between a report
    that settles and one that is quietly wrong for a week; today is never
    pulled, because a half-day of spend upserted as a day is a lie that
    corrects itself only if you know to wait;
  · upsert on the natural key, then advance the cursor;
  · on failure: last_error + consecutive_failures, and an account that has
    failed BACKOFF_AFTER times in a row is skipped until a human looks —
    a nightly cron must not grind a dead token for ever.

The /cron/analytics route that drives this ships UNARMED — no Railway cron
calls it until a week of hand-run results has been read, the way Niyam was
armed. Registration of a real adapter (Meta — A2) is a separate, reviewed
step; this module currently registers none.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import AsyncIterator, Protocol

log = logging.getLogger(__name__)

#: Consecutive failures after which an account is left alone until a human
#: clears the counter. Cheap tokens die (Meta's at 60 days); the sync must
#: surface that once, loudly, and then stop paying for it nightly.
BACKOFF_AFTER = 5

#: Facts one sync call will upsert per account before stopping. A ceiling,
#: not a target — the cursor means the remainder arrives next run.
MAX_FACTS_PER_SYNC = 50_000


@dataclass(frozen=True)
class AccountRef:
    external_id: str
    name: str = ""
    currency: str = "INR"


@dataclass(frozen=True)
class EntityRef:
    entity_type: str          # 'campaign' | 'property' | 'channel' | ...
    external_id: str
    name: str = ""
    parent_external_id: str | None = None
    attrs: dict | None = None


@dataclass(frozen=True)
class Fact:
    entity_external_id: str | None     # None = an account-level fact
    date: date
    metric: str
    value: float
    currency: str | None = None


class SourceAdapter(Protocol):
    source: str                        # 'meta_ads'
    label: str                         # 'Meta Ads'
    metrics: tuple[str, ...]           # what it can emit, for the catalogue
    metric_labels: dict[str, str]      # metric -> human label
    money_metrics: frozenset[str]      # which carry a currency
    lookback_days: int                 # late-attribution re-pull window
    entity_type: str                   # what list_entities returns

    async def list_entities(self, creds, account_row) -> list[EntityRef]: ...

    def fetch_daily(self, creds, account_row, since: date,
                    until: date) -> AsyncIterator[Fact]: ...


#: source name -> adapter instance. EMPTY at A1 — Meta registers in A2, GA4
#: in A4. An empty registry is the honest state: nothing claims to sync.
ADAPTERS: dict[str, SourceAdapter] = {}


def register(adapter: SourceAdapter) -> None:
    if adapter.source in ADAPTERS:
        raise ValueError(f"adapter {adapter.source!r} registered twice")
    ADAPTERS[adapter.source] = adapter


async def register_catalogue(conn, adapter: SourceAdapter) -> None:
    """The metric catalogue rows for one adapter — labels the UI reads.

    Upserted from code at sync time rather than seeded by migration, so the
    table can never drift from what the adapter actually emits.
    """
    for metric in adapter.metrics:
        await conn.execute(
            "INSERT INTO public.analytics_source_metrics "
            "    (source, metric, label, is_money) "
            "VALUES ($1::text, $2::text, $3::text, $4::boolean) "
            "ON CONFLICT (source, metric) "
            "DO UPDATE SET label = EXCLUDED.label, is_money = EXCLUDED.is_money",
            adapter.source, metric,
            adapter.metric_labels.get(metric, metric),
            metric in adapter.money_metrics)


async def _refresh_entities(conn, adapter, creds, account_row) -> dict[str, str]:
    """Upsert the account's entities; return external_id -> row uuid.

    Cheap by design, and it catches renamed and NEW campaigns — a fact for an
    entity the spine has never seen must create the entity, not drop the fact.
    Parents resolve in a second pass so ordering never matters.
    """
    refs = await adapter.list_entities(creds, account_row)
    ids: dict[str, str] = {}
    for ref in refs:
        row = await conn.fetchrow(
            "INSERT INTO public.analytics_entities "
            "    (account_id, entity_type, external_id, name, attrs) "
            "VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::jsonb) "
            "ON CONFLICT (account_id, entity_type, external_id) "
            "DO UPDATE SET name = EXCLUDED.name, attrs = EXCLUDED.attrs "
            "RETURNING id",
            str(account_row["id"]), ref.entity_type, ref.external_id,
            ref.name, __import__("json").dumps(ref.attrs or {}))
        ids[ref.external_id] = str(row["id"])
    for ref in refs:
        if ref.parent_external_id and ref.parent_external_id in ids:
            await conn.execute(
                "UPDATE public.analytics_entities SET parent_id = $1::uuid "
                " WHERE id = $2::uuid",
                ids[ref.parent_external_id], ids[ref.external_id])
    return ids


async def upsert_facts(conn, account_row, facts, entity_ids) -> int:
    """The ONE write path for daily facts. Adapters never reach this table."""
    written = 0
    for f in facts:
        entity_id = entity_ids.get(f.entity_external_id) \
            if f.entity_external_id else None
        if f.entity_external_id and entity_id is None:
            # An unknown entity is a fact about something the refresh did not
            # list — recorded at account level would misattribute it; dropped
            # silently would under-report. Loudly skipped is the honest state.
            log.warning("spine: %s fact for unknown entity %r dropped",
                        account_row["source"], f.entity_external_id)
            continue
        await conn.execute(
            "INSERT INTO public.analytics_metrics_daily "
            "    (org_id, account_id, entity_id, date, metric, value, currency, synced_at) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::text, "
            "        $6::numeric, $7::text, NOW()) "
            "ON CONFLICT (account_id, entity_id, date, metric) "
            "DO UPDATE SET value = EXCLUDED.value, "
            "              currency = EXCLUDED.currency, "
            "              synced_at = NOW()",
            str(account_row["org_id"]), str(account_row["id"]), entity_id,
            f.date, f.metric, f.value, f.currency)
        written += 1
    return written


async def sync_account(pool, account_row, *, creds, today: date) -> dict:
    """One account, one run: entities, facts, cursor — or an honest failure."""
    adapter = ADAPTERS.get(account_row["source"])
    if adapter is None:
        return {"skipped": f"no adapter for {account_row['source']!r}"}
    if (account_row["consecutive_failures"] or 0) >= BACKOFF_AFTER:
        return {"skipped": f"backed off after "
                           f"{account_row['consecutive_failures']} failures"}

    until = today - timedelta(days=1)          # yesterday: settled days only
    cursor = account_row["cursor_date"]
    since = (cursor - timedelta(days=adapter.lookback_days)) if cursor \
        else until - timedelta(days=adapter.lookback_days)
    if since > until:
        since = until

    try:
        async with pool.acquire() as conn:
            await register_catalogue(conn, adapter)
            entity_ids = await _refresh_entities(conn, adapter, creds, account_row)
            written = 0
            async for fact in adapter.fetch_daily(creds, account_row, since, until):
                written += await upsert_facts(conn, account_row, [fact], entity_ids)
                if written >= MAX_FACTS_PER_SYNC:
                    log.warning("spine: %s hit the per-sync ceiling — the "
                                "cursor holds; the rest arrives next run",
                                account_row["id"])
                    break
            await conn.execute(
                "UPDATE public.analytics_accounts "
                "   SET cursor_date = $1::date, last_ok_at = NOW(), "
                "       last_error = NULL, consecutive_failures = 0 "
                " WHERE id = $2::uuid",
                until, str(account_row["id"]))
        return {"entities": len(entity_ids), "facts": written,
                "window": {"since": since.isoformat(), "until": until.isoformat()}}
    except Exception as exc:
        # The failure is the record: last_error for the human, the counter
        # for the backoff. The cursor does NOT advance — a failed pull must
        # be re-pulled, not skipped past.
        log.exception("spine: sync failed for account %s", account_row["id"])
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE public.analytics_accounts "
                    "   SET last_error = $1::text, "
                    "       consecutive_failures = consecutive_failures + 1 "
                    " WHERE id = $2::uuid",
                    f"{type(exc).__name__}: {exc}"[:500], str(account_row["id"]))
        except Exception:
            log.exception("spine: could not even record the failure")
        return {"error": f"{type(exc).__name__}: {exc}"}


async def sync_all(pool, *, today: date) -> dict:
    """Every active account, independently — one dead token must not stop
    the other nine clients' numbers arriving."""
    async with pool.acquire() as conn:
        accounts = await conn.fetch(
            "SELECT * FROM public.analytics_accounts "
            " WHERE is_active ORDER BY last_ok_at NULLS FIRST")
    out = {}
    for a in accounts:
        # Credentials resolve per account via connector_ref; the resolver is
        # A2's work (it is the Meta adapter that knows what a credential IS).
        out[str(a["id"])] = await sync_account(pool, a, creds=None, today=today)
    return {"accounts": out, "count": len(accounts)}
