"""The only writer of `staging.niyam_events`.

── THE ONE RULE ────────────────────────────────────────────────────────────

`emit_event` takes a CONNECTION, not a pool. The caller passes the connection
it is already using for the business write, so the event lands inside that
transaction: it exists if and only if the change committed, and it is gone with
the change if the transaction rolls back.

That is the whole reason this is an application-level outbox rather than a
database trigger. It gives the same atomicity a trigger would — the property
that made triggers tempting — without the two things that made them impossible
here: production shares this database and would fire a trigger blind, and
PgBouncer's transaction pooling means a trigger could never be handed the actor
anyway. See migration 141's header.

A caller that has only a pool is doing something wrong: it is emitting outside
the transaction that made the change, and the two can then disagree. There is
no pool-accepting convenience wrapper on purpose.

── EMIT FROM THE MUTATOR, NEVER FROM THE ROUTE ─────────────────────────────

The old estate emitted from routes, and the audit of 2026-08-16 measured what
that costs: two of five lead-creation writers and two of four task-status
writers emitted nothing at all. The Kanban drag — the most common status change
in the product — was one of them, so a rule on "status becomes Done" fired when
someone used the edit form and not when they dragged the card. Automation that
works sometimes is worse than automation that does not work, because nobody
knows to report it.

So emission belongs to the function that owns the write, and
`tests/test_niyam_emission_parity.py` fails the build if a writer of a watched
column does not route through one. Grep finds only what you thought of; a
ratchet finds what you forgot.

── WHAT NEVER APPEARS IN A PAYLOAD ─────────────────────────────────────────

No message bodies, no attachment contents, no credentials, and no
personally-identifying free text beyond the names a rule must compare. The
payload exists so a CONDITION can be evaluated; anything a condition cannot
compare is weight this table carries forever for nothing. `_clean` drops the
keys that carry bodies rather than trusting every future caller to remember —
the same tripwire-plus-stripping arrangement `outbound_log` uses.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Mapping, Optional

log = logging.getLogger(__name__)

#: The closed list from migration 141's CHECK. Duplicated here so a bad source
#: fails in Python with a readable message instead of as a constraint violation
#: that rolls back the caller's business transaction — the event must never be
#: the reason a legitimate write fails.
SOURCES = frozenset({"app", "import", "sweep", "cron"})

#: Keys a payload may never carry. A condition cannot usefully compare a message
#: body, and storing one turns an event log into a second copy of the product's
#: content — with a different retention window and no one watching it.
_BANNED_KEYS = frozenset({"body", "html", "text", "content", "message", "password", "token", "secret"})

_INSERT = """
INSERT INTO staging.niyam_events
    (org_id, event_type, entity_type, entity_id, actor_id, source, payload, dedupe_key)
VALUES
    ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::text)
ON CONFLICT DO NOTHING
RETURNING event_id
"""


def _clean(d: Optional[Mapping[str, Any]]) -> dict:
    """Drop banned keys and anything unserialisable, one level deep.

    Deliberately shallow. A deep sanitiser invites deep payloads, and a payload
    deep enough to need one is carrying something a condition will never read.
    """
    if not d:
        return {}
    out: dict[str, Any] = {}
    for k, v in d.items():
        if k.lower() in _BANNED_KEYS:
            continue
        if isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, (list, tuple)):
            out[k] = [x for x in v if isinstance(x, (str, int, float, bool)) or x is None]
        elif isinstance(v, Mapping):
            out[k] = {kk: vv for kk, vv in v.items()
                      if kk.lower() not in _BANNED_KEYS
                      and (isinstance(vv, (str, int, float, bool)) or vv is None)}
        # anything else (datetime, Decimal, a model) is the caller's job to
        # render — silently stringifying it here would produce conditions that
        # compare against a repr.
    return out


async def emit_event(
    conn,
    *,
    org_id: str,
    event_type: str,
    source: str = "app",
    actor_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    before: Optional[Mapping[str, Any]] = None,
    after: Optional[Mapping[str, Any]] = None,
    dedupe_key: Optional[str] = None,
) -> Optional[int]:
    """Write one event inside the caller's transaction. Returns its id, or None.

    None means the row was de-duplicated away by `niyam_events_dedupe_idx` — a
    normal outcome for a sweep re-emitting inside the same window, and not an
    error.

    NEVER RAISES ON A BAD EVENT. An automation event is a side effect of a
    business write; a malformed one must not be the reason an invoice fails to
    save. A refusal is logged at WARNING with the reason and the event is
    dropped. The two failure modes are deliberately different:

      * a bad ARGUMENT (unknown source, `app` with no actor) is our bug, caught
        here, logged loudly, dropped.
      * a DATABASE error propagates, because it means the caller's transaction
        is already in trouble and swallowing it would hide that.
    """
    if source not in SOURCES:
        log.warning("niyam: refusing event %r — unknown source %r (allowed: %s)",
                    event_type, source, sorted(SOURCES))
        return None

    # The same rule as the CHECK, applied a layer earlier so a mistake in our
    # own code reads as a warning naming the event rather than as a constraint
    # violation that takes the caller's transaction down with it.
    if source == "app" and not actor_id:
        log.warning("niyam: refusing app event %r with no actor — an unattributable "
                    "app event is exactly what the shared-database defence exists to stop",
                    event_type)
        return None

    payload = {"before": _clean(before), "after": _clean(after)}

    return await conn.fetchval(
        _INSERT,
        org_id,
        event_type,
        entity_type,
        entity_id,
        actor_id,
        source,
        json.dumps(payload),
        dedupe_key,
    )
