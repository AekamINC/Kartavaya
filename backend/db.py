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
    """Serialise a value for a json/jsonb parameter — WITHOUT encoding it twice.

    ── Why this is not simply `json.dumps` ───────────────────────────────────

    asyncpg applies this encoder to every parameter it infers as json/jsonb.
    Roughly 120 call sites in this codebase already call `json.dumps(...)`
    themselves before binding, which is the natural thing to write and is what
    you must do when no codec is registered. With a codec registered, that value
    was dumped a SECOND time here, and the column ended up holding a JSON
    *string* — `"{\"line1\": …}"` — instead of an object. The matching decoder
    then handed that string back on read.

    Audited against the live database on 2026-07-29: **38 jsonb columns across
    26 tables, ~1,550 rows**, including `ganit_invoices.line_items` (50 of 50 —
    the taxable value and HSN behind every GST figure), `audit_log.detail`
    (172 of 172) and `sign_audit_log.details` (95 of 95).

    It stayed invisible because most readers either skip the field or parse
    defensively. Where something trusted the declared type it was not a wrong
    number but a hard failure: `dict(bank_details)` returned 500 for every
    employee, `tags.map()` crashed the whole Graha page, and spreading the
    string on the client wrote 122 character-indexed keys back into the org
    profile.

    Fixing it here rather than at 120 call sites is deliberate. Correcting them
    individually leaves the trap armed for the next `json.dumps` anyone writes —
    and the failure is silent, so it would not be noticed again until something
    crashed.

    ── The rule ─────────────────────────────────────────────────────────────

    A `str` that is already a serialised JSON **object or array** is passed
    through untouched. Anything else — dict, list, number, bool, None, or a
    plain string that is not JSON — is encoded exactly as before.

    The check is deliberately narrow. It requires the text to start with `{` or
    `[` AND to parse, so a genuine JSON string scalar keeps its old behaviour:
    `"123"` still stores as the string "123" and not the number 123, and
    `"true"` does not become a boolean. Only the object/array shapes these
    columns actually hold take the new path.
    """
    if isinstance(value, str):
        head = value.lstrip()[:1]
        if head in ("{", "["):
            try:
                json.loads(value)
            except (ValueError, TypeError):
                pass          # not valid JSON after all — encode it as a string
            else:
                return value  # already serialised; encoding again would nest it
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
