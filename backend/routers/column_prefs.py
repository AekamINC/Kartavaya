"""
column_prefs.py — the column arrangement a person chose for one table: the
ORDER, which columns are HIDDEN, and how WIDE each one is. Inbox item 3, the
server half. Migration 198 owns the table.

This is routers/tab_prefs.py's problem one level down, and it deliberately
follows that file's design rather than inventing a second one. What is genuinely
shared with it — the resolution fold and the DELETE command-tag parse — lives in
routers/_pref_ladder.py and is imported by both; what is not shared is the SQL,
which stays next to the ON CONFLICT target that names its own partial index.

WHAT IS STORED
──────────────
An arrangement is an ORDERED list of `{id, hidden, width}` per table key. The
array order IS the column order — there is no position field that could
disagree with the index. `hidden` is the user's choice to stop rendering a
column; `width` is a pixel width they dragged, or null for "whatever the table
decides".

THE ONE DELIBERATE DEVIATION FROM tab_prefs.py
──────────────────────────────────────────────
tab_prefs pins a nine-entry MODULE_TABS allowlist, because there are nine tab
strips and they are enumerable, and an unknown module there is a malformed
request. THERE IS NO SUCH LIST HERE, on purpose. The product ships ~100 tables
and the number moves every week; an allowlist would be a second inventory to
maintain and the first thing to go stale — a table added on Tuesday would 422
on Wednesday when somebody tried to arrange it, and the failure would look like
a bug in the table rather than an omission in this file.

So this API pins the GRAMMAR and never a catalogue: the shape of a table key,
the shape of a column id, the count, uniqueness, the width bounds, and the one
semantic invariant (an arrangement cannot hide every column). That is the same
compatibility promise tab_prefs makes, and it is worth more here: a column
shipped later lands at the END of a saved arrangement and never invalidates it,
and a column id that stops existing renders as nothing client-side rather than
as an error.

SELF-SCOPING — THE me.py RULE
─────────────────────────────
Every personal statement keys on `user["user_id"]` from the verified token. No
handler takes a user id from a path, query or body, so there is no row here
that one person's request could read or drop on another person's behalf. The
org PUT writes what every member falls back to, which is org administration —
`admin_org_id`, 403 otherwise, the same bar tab_prefs and analytics hold.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from routers._pref_ladder import fold_ladder, removed

# One router for both surfaces: /me/column-prefs is the caller's own row,
# /org/column-prefs the default underneath it. One prefix, one registration.
router = APIRouter(prefix="/api/v1", tags=["column-prefs"])

#: A table's name, owned by the frontend. Dots because the keys read
#: 'graha.contacts' / 'ganit.invoices' — module, then table. Refusing anything
#: else keeps a caller from using this as a general key-value store, which is
#: the only thing an unbounded key would turn it into.
TABLE_KEY = re.compile(r"^[a-z][a-z0-9]*(\.[a-z0-9_-]+){1,2}$")

#: A column id, owned by the frontend. Same alphabet as tab_prefs' TAB_ID plus
#: nothing: the ids already in the build are `name`, `contact_type`,
#: `created_at`, `lead_score`.
COLUMN_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,59}$")

#: The widest table in the build is Ganit's invoice register at 14 columns; 64
#: leaves generous room without letting a client persist an unbounded array.
MAX_COLUMNS = 64

#: Width bounds, in CSS pixels. Below ~48 a column is a sliver no header fits
#: in and the user cannot find the handle again to widen it; above 2000 one
#: column pushes every other off a 4K screen. Both ends are recoverable via
#: Reset, but only if the user can still see the control, which is the point.
MIN_WIDTH = 48
MAX_WIDTH = 2000


class ColumnPref(BaseModel):
    #: The frontend's id for this column.
    id: str
    #: Hidden means "do not render", not "render blank" — see _checked for why
    #: an arrangement may not hide everything.
    hidden: bool = False
    #: Pixels, or null for "whatever the table decides". Deliberately `int |
    #: None` rather than a float: a fractional column width is a rounding
    #: argument between two browsers, not a preference anybody expressed.
    width: int | None = None


class ColumnPrefPut(BaseModel):
    #: The FULL arrangement, first-to-last. Not a patch: a partial update would
    #: need this API to know the page's column list to fill the gaps, which is
    #: exactly the catalogue the module header refuses to keep.
    columns: list[ColumnPref]


def _known_table_or_422(table_key: str) -> None:
    """The key's SHAPE, never its membership of a list. tab_prefs 422s an
    unknown module; here an unknown key is simply a table this server has never
    heard of and has no business having an opinion about."""
    if not TABLE_KEY.match(table_key):
        raise HTTPException(
            422,
            f"table key {table_key!r}: 'module.table' in lowercase letters, "
            "digits, '-' and '_' — e.g. 'graha.contacts'",
        )


def _checked(table_key: str, body: ColumnPrefPut) -> None:
    """Refuse before touching the pool — 422s name the offence, the
    `_clean_layout` discipline tab_prefs follows. Grammar only, never a
    catalogue: see the module header."""
    _known_table_or_422(table_key)
    if not body.columns:
        raise HTTPException(422, "columns must name at least one column")
    if len(body.columns) > MAX_COLUMNS:
        raise HTTPException(422, f"columns holds at most {MAX_COLUMNS} entries")

    seen: set[str] = set()
    for col in body.columns:
        if not COLUMN_ID.match(col.id):
            raise HTTPException(
                422,
                f"column id {col.id!r}: lowercase letters, digits, '-' and "
                "'_' only, 1–60 characters, starting with a letter or digit",
            )
        if col.id in seen:
            raise HTTPException(422, f"column id {col.id!r} appears twice")
        seen.add(col.id)
        if col.width is not None and not (MIN_WIDTH <= col.width <= MAX_WIDTH):
            raise HTTPException(
                422,
                f"width {col.width} for column {col.id!r} is outside "
                f"{MIN_WIDTH}–{MAX_WIDTH}px",
            )

    # THE ONE SEMANTIC RULE. An arrangement that hides every column renders an
    # empty table with a header row of nothing, and the control that would let
    # the user undo it is reached from that table. It is a preference that
    # locks its owner out of the screen it applies to, so it is refused here
    # rather than repaired client-side — a repair would silently un-hide a
    # column the user did choose to hide, which is a different lie.
    if all(c.hidden for c in body.columns):
        raise HTTPException(
            422,
            "an arrangement must leave at least one column visible — a table "
            "with every column hidden cannot be un-hidden from itself",
        )


def _wire(columns: list[ColumnPref]) -> list[dict]:
    """The JSON shape stored and returned. One spelling, produced in one place,
    so the PUT echo and the next GET cannot disagree about it."""
    return [{"id": c.id, "hidden": c.hidden, "width": c.width} for c in columns]


def _saved(table_key: str, body: ColumnPrefPut, source: str, row) -> dict:
    return {
        "table_key": table_key,
        "columns": _wire(body.columns),
        "source": source,
        "updated_at": (
            row["updated_at"].isoformat() if row and row["updated_at"] else None
        ),
    }


def _entry(row, personal: bool) -> dict:
    """One resolved arrangement, read back out of jsonb.

    asyncpg hands jsonb back as a str unless a codec is registered, and this
    pool's registration is not this router's to assume — so a str is decoded
    here and a list is taken as-is. A row whose payload is neither (corrupt, or
    an object written by hand) resolves to an empty list, which the frontend
    reads as "no arrangement" and answers with the page's own columns. A 500 on
    read would take the whole table down over a preference.
    """
    raw = row["columns"]
    if isinstance(raw, str):
        import json
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    if not isinstance(raw, list):
        raw = []
    cols = []
    for c in raw:
        if not isinstance(c, dict) or not isinstance(c.get("id"), str):
            continue
        width = c.get("width")
        cols.append({
            "id": c["id"],
            "hidden": bool(c.get("hidden")),
            "width": width if isinstance(width, int) and not isinstance(width, bool) else None,
        })
    return {"columns": cols, "source": "personal" if personal else "org"}


@router.get("/me/column-prefs")
async def get_column_prefs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Every table's resolved arrangement for this caller in this org —
    `{table_key: {columns, source}}`, an empty object when nothing is saved
    anywhere (the page's declared columns are the floor, and they are code, not
    a row).

    ONE fetch for both row shapes and one GET for the whole app: the frontend
    hook caches this per app life the way useTabPrefs does, because a table
    that waits for its own round trip renders the shipped order for a frame and
    then jumps.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT table_key, columns, user_id "
        "  FROM staging.user_column_prefs "
        " WHERE user_id = $1::text "
        "    OR (user_id IS NULL AND org_id = $2::uuid)",
        user["user_id"], org_id,
    )
    return fold_ladder(rows, "table_key", _entry)


@router.put("/me/column-prefs/{table_key}")
async def put_my_column_prefs(
    table_key: str,
    body: ColumnPrefPut,
    user=Depends(require_user),
):
    """Upsert the caller's own row.

    The conflict target names the partial index's predicate — without the WHERE
    clause Postgres cannot match `user_column_prefs_personal_key` and the
    statement is an InvalidColumnReferenceError at run time, not at review
    time. That is tab_prefs' scar and it is repeated here on purpose.

    Every parameter is cast. `$3::jsonb` in particular: PgBouncer turns an
    untyped parse error into an instant 500 with no log line worth reading, and
    a jsonb parameter fed from a Python list is exactly the ambiguous
    expression that produces one.
    """
    _checked(table_key, body)
    import json
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.user_column_prefs (user_id, table_key, columns) "
        "VALUES ($1::text, $2::text, $3::jsonb) "
        "ON CONFLICT (user_id, table_key) WHERE user_id IS NOT NULL "
        "DO UPDATE SET columns = EXCLUDED.columns, "
        "              updated_at = NOW() "
        "RETURNING updated_at",
        user["user_id"], table_key, json.dumps(_wire(body.columns)),
    )
    return _saved(table_key, body, "personal", row)


@router.delete("/me/column-prefs/{table_key}")
async def delete_my_column_prefs(
    table_key: str,
    user=Depends(require_user),
):
    """Back to the resolution below: the org default if one exists, else the
    page's declared columns. Scoped by the caller's own id in the DELETE
    itself, so there is no row anyone else's request could drop here."""
    _known_table_or_422(table_key)
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM staging.user_column_prefs "
        " WHERE user_id = $1::text AND table_key = $2::text",
        user["user_id"], table_key,
    )
    return {"removed": removed(result), "table_key": table_key}


@router.put("/org/column-prefs/{table_key}")
async def put_org_column_prefs(
    table_key: str,
    body: ColumnPrefPut,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """The org-default arrangement every member without a personal row falls
    back to — "this is how our firm reads the invoice register"."""
    _checked(table_key, body)
    # Writing what the whole org sees is org administration, the bar an
    # org-wide analytics view holds. Imported at call time the way analytics.py
    # and tab_prefs.py do, so a test that patches middleware.roles sees it.
    from middleware.roles import admin_org_id
    if not await admin_org_id(user["user_id"], org_id):
        raise HTTPException(
            403, "Only an org admin can set the organisation's column layout")
    import json
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.user_column_prefs (org_id, table_key, columns) "
        "VALUES ($1::uuid, $2::text, $3::jsonb) "
        "ON CONFLICT (org_id, table_key) WHERE user_id IS NULL "
        "DO UPDATE SET columns = EXCLUDED.columns, "
        "              updated_at = NOW() "
        "RETURNING updated_at",
        org_id, table_key, json.dumps(_wire(body.columns)),
    )
    return _saved(table_key, body, "org", row)
