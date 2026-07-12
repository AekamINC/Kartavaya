"""
db.py — Supabase PostgreSQL connection pool for Kartavaya
Lazy connection — does NOT connect at startup, connects on first request.
This prevents Railway crashes if DATABASE_URL is misconfigured.

Schema routing: set DB_SCHEMA=staging to route queries to the staging
schema (new modules) while keeping public schema accessible for auth tables.
"""
import asyncio
import json
import os
import asyncpg

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()

DB_SCHEMA = os.getenv("DB_SCHEMA", "public")


def _json_encoder(value):
    return json.dumps(value)


def _json_decoder(value):
    return json.loads(value)


async def _init_conn(conn):
    await conn.set_type_codec(
        "jsonb", encoder=_json_encoder, decoder=_json_decoder, schema="pg_catalog", format="text"
    )
    await conn.set_type_codec(
        "json", encoder=_json_encoder, decoder=_json_decoder, schema="pg_catalog", format="text"
    )
    if DB_SCHEMA == "staging":
        await conn.execute("SET search_path TO staging, public")


async def get_pool() -> asyncpg.Pool:
    """Return the shared asyncpg pool, creating it lazily on first call."""
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is None:
            dsn = os.environ.get("DATABASE_URL", "")
            if not dsn:
                raise RuntimeError("DATABASE_URL environment variable is not set")
            _pool = await asyncpg.create_pool(
                dsn=dsn,
                min_size=1,
                max_size=8,
                max_inactive_connection_lifetime=300,
                command_timeout=60,
                statement_cache_size=0,  # Required for PgBouncer transaction mode
                init=_init_conn,
            )
    return _pool


async def close_pool():
    """Close and discard the asyncpg connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
