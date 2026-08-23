"""_pref_ladder — the two mechanics every "personal over org default"
preference table in this product needs, in one place so the second one cannot
drift from the first.

There are now two of these tables and they are the same shape:

    staging.user_tab_prefs      (154)  the tab order within a module
    staging.user_column_prefs   (198)  the column order/visibility/width of a table

Both carry a personal row (user_id set, org-LESS) and an org-default row
(user_id NULL, org_id set), both resolve

    personal (user_id = caller)  >  org default (user_id IS NULL, current org)
    >  the page's built-in list, which is frontend CODE and never a row

and both applied that resolution SERVER-SIDE in GET so every surface agrees on
it. What differs between them is only the column names and the payload shape,
which is why what lives here is the FOLD and not the query: the SQL belongs to
each router, next to the ON CONFLICT target that names its own partial index.

Nothing here touches a pool. It is deliberately pure so both routers' tests can
state the resolution without a database.
"""


def fold_ladder(rows, key: str, build):
    """Collapse the two row shapes into `{key: build(row, personal)}`, with the
    personal row winning.

    `rows` is one fetch holding BOTH shapes — the personal rows (user_id set)
    and the org defaults (user_id NULL) — because two round trips to resolve
    one preference is two chances for them to disagree about `now`.

    The org pass runs FIRST and the personal pass second, so the later write IS
    the resolution and a personal row wins whatever order asyncpg handed the
    rows back in. Sorting in SQL would work too and would put the ladder in a
    string; here it is a loop anyone can read.

    `build(row, personal)` returns the resolved entry for one row; `personal`
    is the boolean the caller stamps into `source`.
    """
    out: dict = {}
    for want_personal in (False, True):
        for r in rows:
            if (r["user_id"] is not None) is not want_personal:
                continue
            out[r[key]] = build(r, want_personal)
    return out


def removed(command_tag: str) -> bool:
    """Did a DELETE actually remove anything?

    asyncpg hands back the command tag ("DELETE 1", "DELETE 0"), and the
    difference matters: "reset my columns" when there was nothing personal
    saved must not claim it undid something. Same parse me.py's deregister
    uses, and the empty-string guard is for the mock pools in the suites — a
    fixture that returns "" must read as "nothing", never as "yes".
    """
    return (command_tag or "").rsplit(" ", 1)[-1] not in ("0", "")
