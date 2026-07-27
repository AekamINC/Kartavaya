"""
db.py — Supabase PostgreSQL connection pool for Kartavaya
Lazy connection — does NOT connect at startup, connects on first request.
This prevents Railway crashes if DATABASE_URL is misconfigured.

Schema routing: set DB_SCHEMA=staging to route queries to the staging
schema (new modules) while keeping public schema accessible for auth tables.
"""
import asyncio
import json
import logging
import os
import re
import asyncpg

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()

DB_SCHEMA = os.getenv("DB_SCHEMA", "public")


def _json_encoder(value):
    return json.dumps(value)


def _json_decoder(value):
    return json.loads(value)


async def _init_conn(conn):
    """Register JSON/JSONB codecs on each new asyncpg connection.

    Retries, because PgBouncer drops a connection mid-handshake often enough to
    matter — that fix came from production (`main`, 18 Jul) and was missing here.
    Skipping the codec is NOT harmless: without it asyncpg hands JSONB back as a
    string, and a caller doing `row["settings"]["tan"]` gets a TypeError on a
    string index rather than a dict. Several routers already carry defensive
    `json.loads` for exactly that, which is the symptom.
    """
    for attempt in range(3):
        try:
            await conn.set_type_codec(
                "jsonb", encoder=_json_encoder, decoder=_json_decoder, schema="pg_catalog", format="text"
            )
            await conn.set_type_codec(
                "json", encoder=_json_encoder, decoder=_json_decoder, schema="pg_catalog", format="text"
            )
            break
        except (asyncpg.ConnectionDoesNotExistError, asyncpg.InterfaceError) as exc:
            if attempt == 2:
                # Warn rather than raise, which is where this differs from
                # main: a pool that refuses to hand out connections takes the
                # whole app down, and the codecs are recoverable per-call.
                logger.warning("set_type_codec failed after 3 attempts (PgBouncer): %s", exc)
                break
            logger.warning("_init_conn attempt %d failed: %s", attempt + 1, exc)
            await asyncio.sleep(0.5 * (attempt + 1))

    if DB_SCHEMA == "staging":
        try:
            await conn.execute("SET search_path TO staging, public")
        except Exception as exc:
            logger.warning("SET search_path failed: %s", exc)


def _direct_dsn(dsn: str) -> str:
    """Convert Supabase pooler URL (port 6543) to direct connection (port 5432).
    Falls back to original DSN if pattern doesn't match."""
    return re.sub(r':6543/', ':5432/', dsn)


async def get_pool() -> asyncpg.Pool:
    """Return the shared asyncpg pool, creating it lazily on first call.
    If the pooler DSN (port 6543) fails, retries with direct connection (5432)."""
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is None:
            dsn = os.environ.get("DATABASE_URL", "")
            if not dsn:
                raise RuntimeError("DATABASE_URL environment variable is not set")

            for attempt_dsn in [dsn, _direct_dsn(dsn)]:
                try:
                    _pool = await asyncpg.create_pool(
                        dsn=attempt_dsn,
                        min_size=2,
                        max_size=10,
                        max_inactive_connection_lifetime=300,
                        command_timeout=60,
                        statement_cache_size=0,
                        init=_init_conn,
                    )
                    logger.info("DB pool created successfully")
                    return _pool
                except (asyncpg.ConnectionDoesNotExistError,
                        asyncpg.InterfaceError,
                        OSError,
                        asyncio.TimeoutError) as exc:
                    logger.warning("Pool creation failed with %s: %s", attempt_dsn.split('@')[-1], exc)
                    if attempt_dsn == _direct_dsn(dsn):
                        raise
                    logger.info("Retrying with direct connection (port 5432)...")
    return _pool


async def close_pool():
    """Close and discard the asyncpg connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
