"""
db.py — Supabase PostgreSQL connection pool for Kartavaya
Lazy connection — does NOT connect at startup, connects on first request.
This prevents Railway crashes if DATABASE_URL is misconfigured.
"""
import asyncio
import json
import os
import asyncpg

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


def _json_encoder(value):
    """Serialize a Python value to a JSON string for asyncpg."""
    return json.dumps(value)


def _json_decoder(value):
    """Deserialize a JSON string from asyncpg to a Python value."""
    return json.loads(value)


async def _init_conn(conn):
    """Register JSON/JSONB codecs on each new asyncpg connection."""
    for attempt in range(3):
        try:
            await conn.set_type_codec(
                "jsonb", encoder=_json_encoder, decoder=_json_decoder, schema="pg_catalog", format="text"
            )
            await conn.set_type_codec(
                "json", encoder=_json_encoder, decoder=_json_decoder, schema="pg_catalog", format="text"
            )
            return
        except (asyncpg.ConnectionDoesNotExistError, asyncpg.InterfaceError):
            if attempt == 2:
                raise
            await asyncio.sleep(0.5 * (attempt + 1))


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
                min_size=3,
                max_size=15,
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
