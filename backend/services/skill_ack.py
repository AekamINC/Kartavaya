"""
skill_ack — the finding that has already been dealt with.

Every skill handler in `services/skills/{data,detect,action}` reports the world
as it is and has no idea what anyone has done about it. `propose_payment_run`
returns the same overdue vendor bills every run until somebody actually pays a
vendor. `check_payroll_readiness` names the same employee with no salary
structure every month. Nothing anywhere records "yes, I know, it is handled",
so nothing can be hidden, so the list only ever grows. That is how an alert
catalogue dies: read carefully in week one, skimmed in month two, wallpaper by
month three -- and wallpaper that still looks like coverage, which is worse than
no list at all.

This module is the mechanism for closing a finding. It is deliberately NOT
wired into any skill: which of a skill's fields are identity and which are
material is a judgement per skill, and getting it wrong is silent, so each
wiring is its own commit and its own decision. See `THE THREE-WAY SPLIT` below
before doing one.

Table: `staging.skill_finding_ack` (migration 159, not applied at time of
writing).


== A FINDING HAS NO PRIMARY KEY ============================================

Findings are not rows. They are dicts assembled by a handler, and they differ
per skill:

    check_payroll_readiness -> {"check": "no_salary_structure",
                                "employee": "Priya Nair", "detail": "...",
                                "amount": 42000.0}
    propose_payment_run     -> {"bill": "INV-2291", "vendor": "Sharma Traders",
                                "balance_due": 42000.0, "days_past_due": 63,
                                "ageing": "61-90", ...}

There is no id to acknowledge. So the key is DERIVED from the finding's own
content -- and the entire difficulty of this module is choosing WHICH content.


== THE THREE-WAY SPLIT =====================================================

Every field of a finding is exactly one of three things, and the split is the
whole design. Hashing is the easy part.

  IDENTITY    WHICH FACT this is. The bill number. The employee name plus the
              check code. Goes into `finding_key`. Must be stable for the whole
              life of the underlying fact, because `finding_key` is what an
              acknowledgement is filed under -- if it changes, the ack is
              orphaned and the finding comes back as though nobody ever touched
              it.

  MATERIAL    The fields whose MOVEMENT should void the acknowledgement. The
              balance outstanding. The status. Goes into `state_hash`. Somebody
              acknowledged a bill of 42,000; when it becomes 84,000 that is a
              new situation wearing an old name and it MUST resurface. This is
              the case that makes the mechanism trustworthy rather than a way
              of permanently hiding bad news.

  INCIDENTAL  Everything else -- and in particular anything that changes by the
              mere passage of time: `days_past`, `days_past_due`, `ageing`,
              `as_of`. Goes into NEITHER hash.

That third bucket is the one this module is built to protect, because both ways
of getting it wrong are silent and both are fatal:

  * Put `days_past` in MATERIAL and every acknowledgement dies at the next
    midnight, because the day count ticks. The user acks 42 findings, comes
    back tomorrow, and all 42 are there again. They will not ack them twice.

  * Put `days_past` in IDENTITY and every finding gets a fresh `finding_key`
    every day, so no acknowledgement ever matches anything again -- and the
    table fills up with one dead row per finding per day, which looks like the
    feature is being used enthusiastically.

In both cases the list is wallpaper again and the ack table looks healthy. So
`_DRIFT_FIELDS` refuses those field names outright, in both buckets, rather
than trusting the next author to have read this docstring. If you genuinely
need a time-derived field in a key, you are almost certainly about to
reintroduce this bug; if you are certain you are not, edit the constant and say
why in the commit.


== WHY THE KEY IS A DIGEST AND NOT AN ID ===================================

`finding_key` is a lowercase hex digest. Two reasons, in order of importance:

 1. Names, not IDs. Some findings DO have a row id available -- `find_overdue`
    returns `entity.id`, a raw UUID. A UUID is an excellent stable INPUT to the
    key and an unacceptable output: the moment the key is rendered anywhere,
    or returned by an endpoint, a user/member/org UUID is on screen and the
    `check-rendered-ids` ratchet is defeated. Hashing keeps the stability and
    throws away the leak. Migration 159's CHECK constraint enforces this at the
    schema level -- `^[0-9a-f]{16,128}$` structurally refuses a dashed UUID
    (verified against the live engine: the pattern rejects both a dashed UUID
    and an uppercase digest, and accepts a 32-character blake2s one).

 2. Findings that have no id at all still need one. `check_payroll_readiness`
    returns an employee NAME and a check code and nothing else. A digest over
    those two is the only identity that exists.

The digest is blake2s truncated to 16 bytes (32 hex chars). This is not a
security boundary -- it is a lookup key for a per-org, per-skill set that will
hold tens of rows and not millions, so collision risk is negligible and the
short key keeps the index small. Do not swap it for a cryptographic
construction under the impression that it is protecting anything.


== CANONICALISATION, AND THE 4200.00 PROBLEM ===============================

The digest is only stable if the same fact encodes to the same bytes, and the
same fact does NOT arrive the same way twice. asyncpg returns `Decimal` for a
numeric column; the handlers then do `float(r["balance_due"])`; a test writes
`4200`. `Decimal("4200.00")`, `4200.0` and `4200` are the same amount and must
produce the same hash, or a state check reports movement that never happened
and the finding resurfaces for no reason -- wallpaper, arrived at from the
other direction.

So `_canon` normalises rather than calling `str()` or `json.dumps`:

  * numbers go through `Decimal` to a plain non-scientific string, so
    4200.00 == 4200.0 == 4200
  * `bool` is checked BEFORE `int`, because `bool` is a subclass of `int` and
    `True` must not collide with `1`
  * strings are NFC-normalised, stripped and casefolded, so " Priya" and
    "priya" are one person. This is the `outbound_log` lesson: that table
    indexes `lower(recipient)` because a mixed-case address produced a false
    "we never emailed them", which is exactly the false negative available here
    -- a false "this was never acknowledged".
  * every value is TYPE-TAGGED, so the string "1" and the number 1 and the
    boolean True are three different things and cannot collide across fields
  * `None` has its own tag, distinct from an empty string

Float arithmetic is still float arithmetic: 0.1 + 0.2 does not equal 0.3 here
any more than anywhere else. Pass amounts straight from the database, or as
`Decimal`, and do not compute them on the way in.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import blake2s
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

log = logging.getLogger(__name__)

#: Digest width in bytes. 16 -> 32 hex characters, which satisfies migration
#: 159's `^[0-9a-f]{16,128}$` CHECK. Widening is safe; narrowing below 8 bytes
#: would breach that CHECK and every insert would fail.
_DIGEST_BYTES = 16

#: Field names that change by the passage of time alone. Refused in BOTH the
#: identity and the material bucket -- see THE THREE-WAY SPLIT. In identity they
#: mint a new key every day so no ack ever matches; in material they void every
#: ack every day. Both failures are silent, which is why this is an exception
#: and not a log line.
_DRIFT_FIELDS = frozenset({
    "age", "age_days", "ageing", "ageing_bucket", "aging", "aging_bucket",
    "as_of", "asof", "days_left", "days_open", "days_overdue", "days_past",
    "days_past_due", "days_remaining", "days_to_due", "days_until",
    "generated_at", "now", "run_at", "ran_at", "seen_at", "last_seen",
    "today", "updated_at",
})

#: Shapes that must never reach `finding_label`. Aekam staff read this table
#: across orgs and the platform-privacy rule says a client's contact details are
#: not theirs to see -- so an address or a phone number in a label would leak
#: through a support screen that is otherwise perfectly well scoped. Stripped,
#: not rejected: refusing to record an acknowledgement because its label was
#: badly chosen would lose the acknowledgement, which matters more.
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

#: A phone number, and NOT the two things that look like one in this app's
#: labels. The first draft was `(?<!\d)\+?\d[\d\s-]{8,}\d(?!\d)`, a blob of
#: digits-spaces-hyphens at least ten long, and it ate the two strings a finding
#: label is most likely to contain: an ISO date (`2026-06-01`, eight digits and
#: two hyphens) and a hyphenated document number (`INV-2291-000123`, ten digits
#: once the prefix is stripped off). Redacting the bill number out of "Bill
#: INV-2291-000123 -- Sharma Traders" destroys the one field in this row that
#: exists to be recognised by a human, so the shape is now specific:
#:   · `(?<![\w-])` / `(?![\w-])`  -- not glued to a letter, digit or hyphen, so
#:     the digits inside `INV-2291-000123` are never a candidate start;
#:   · at least ten digits, singly separated -- an ISO date has eight, so a date
#:     can no longer match on its own or as part of a longer run.
_PHONE_RE = re.compile(
    r"(?<![\w-])(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){9,14}\d(?![\w-])"
)

#: `finding_label` is stored, indexed by nothing, and rendered. Cap it so a
#: pathological `detail` string cannot bloat the row.
_MAX_LABEL = 200

#: What a label becomes when redaction leaves nothing behind. Migration 159 has
#: `CHECK (length(btrim(finding_label)) > 0)`, so an empty label is not a poor
#: label -- it is a constraint violation, which throws away the acknowledgement
#: the user just made. That inverts this module's own rule that losing the
#: wording beats losing the ack, so the empty case gets a placeholder instead.
_UNLABELLED = "(no description)"


class DriftingKeyError(ValueError):
    """A time-derived field was used in a finding key or state hash.

    Raised at wiring time, loudly, because every runtime symptom of this
    mistake looks like the feature working correctly. See `_DRIFT_FIELDS`.
    """


class MissingMaterialError(ValueError):
    """An acknowledgement carries a `state_hash` but the filter cannot compute one.

    The fourth silent failure in this module's family, and it was reachable
    until it was named: `record_ack` recommends storing the current state, and
    `partition_by_ack` treats a caller that omits `material_of` as having no
    material fields at all. Put those together -- ack recorded with a state,
    filtered without one -- and `Ack.suppresses` compares a stored digest
    against `None`, which is never equal, so EVERY acknowledgement for that
    skill quietly suppresses nothing, for ever. Nothing errors, nothing logs,
    the table fills up with acks that do nothing and the list stays exactly as
    long as it was. That is the wallpaper failure again, so it raises.
    """


# == canonicalisation =======================================================

def _canon(value: Any) -> str:
    """Encode *value* to a stable, type-tagged string.

    Type tags are not decoration: without them the string "1", the integer 1
    and `True` all render as "1" and three different findings share a key.
    """
    # bool BEFORE int -- bool is a subclass of int, and `isinstance(True, int)`
    # is True, so the int branch would swallow it and True would encode as 1.
    if value is None:
        return "~"
    if isinstance(value, bool):
        return "b:1" if value else "b:0"
    if isinstance(value, (int, float, Decimal)):
        return "n:" + _num(value)
    if isinstance(value, str):
        return "s:" + _text(value)
    if isinstance(value, datetime):
        # Normalise to UTC first: the same instant expressed in two offsets is
        # one fact, and a handler that switches to aware datetimes must not
        # invalidate every existing acknowledgement.
        v = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return "t:" + v.isoformat()
    if isinstance(value, date):
        return "d:" + value.isoformat()
    if isinstance(value, Mapping):
        # Sorted by key: a dict's iteration order is an implementation detail
        # of how the handler happened to build it, not part of the fact.
        return "{" + ";".join(f"{_text(str(k))}={_canon(v)}" for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))) + "}"
    if isinstance(value, (list, tuple, set, frozenset)):
        parts = [_canon(v) for v in value]
        # A set has no order to preserve; a list's order is part of the fact.
        if isinstance(value, (set, frozenset)):
            parts.sort()
        return "[" + ";".join(parts) + "]"
    # Anything else: fall back to its repr rather than silently dropping it. A
    # new type appearing here should be given an explicit branch above.
    log.debug("skill_ack._canon: no explicit encoding for %s", type(value).__name__)
    return "o:" + _text(repr(value))


def _num(value: int | float | Decimal) -> str:
    """Canonical decimal string. 4200.00, 4200.0 and 4200 all become '4200'."""
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return _text(str(value))
    if not d.is_finite():          # NaN / Infinity have no canonical decimal
        return _text(str(value))
    d = d.normalize()
    # `normalize()` yields scientific notation for round numbers --
    # Decimal('4200.0').normalize() is Decimal('4.2E+3'). Format 'f' forces the
    # plain form back, so both spellings land on '4200'.
    return format(d, "f")


def _text(value: str) -> str:
    """NFC-normalise, strip and casefold.

    Casefolding is the `outbound_log` lesson: that table has to be queried as
    `lower(recipient)` because a mixed-case address once produced a false "we
    never emailed them". The same false negative is available here and it reads
    as "this was never acknowledged", so the normalisation happens at write
    time instead of being everybody's job at read time.
    """
    return unicodedata.normalize("NFC", value).strip().casefold()


def _drift_names(value: Any, _depth: int = 0) -> set[str]:
    """Every mapping key ANYWHERE inside *value* that names a time-derived field.

    The walk is recursive and that is the whole fix. The guard used to read only
    the top level of the bucket, so the two obvious ways to nest a finding --
    `material_of=lambda f: {"row": f}` ("all of it is material") and
    `identity_of=lambda f: {"bill": f["bill"], "meta": {...}}` -- carried
    `days_past_due` straight past it and produced a fresh `finding_key` every
    night with no error and no log: precisely the failure `_DRIFT_FIELDS` was
    written to make impossible. `_canon` recurses into mappings and sequences,
    so the guard has to recurse over the same structure or it is guarding a
    shape that is not the one being hashed.
    """
    if _depth > 12:                      # a finding is a DB row, not a graph
        return set()
    found: set[str] = set()
    if isinstance(value, Mapping):
        for k, v in value.items():
            if _text(str(k)) in _DRIFT_FIELDS:
                found.add(str(k))
            found |= _drift_names(v, _depth + 1)
    elif isinstance(value, (list, tuple, set, frozenset)):
        for v in value:
            found |= _drift_names(v, _depth + 1)
    return found


def _digest(parts: Mapping[str, Any], *, bucket: str) -> str:
    """Hash a named bucket of fields, refusing time-derived names at any depth."""
    drifting = sorted(_drift_names(dict(parts)))
    if drifting:
        raise DriftingKeyError(
            f"{bucket} contains time-derived field(s) {drifting!r}. These change "
            f"every day on their own: in the identity bucket they mint a new "
            f"finding_key daily so no acknowledgement ever matches again, and in "
            f"the material bucket they void every acknowledgement at midnight. "
            f"Both failures are silent. Move them out of the key -- they are "
            f"INCIDENTAL. See services/skill_ack.py, THE THREE-WAY SPLIT."
        )
    if not parts:
        raise ValueError(
            f"{bucket} is empty. A finding key over no fields is the same key "
            f"for every finding, which would suppress the entire skill on the "
            f"first acknowledgement."
        )
    blob = _canon(dict(parts)).encode("utf-8")
    return blake2s(blob, digest_size=_DIGEST_BYTES).hexdigest()


def finding_key(identity: Mapping[str, Any]) -> str:
    """Stable key for the FACT a finding is about.

    *identity* names only the fields that say which fact this is -- the bill
    number, the employee plus the check code. Not the amount (that is material,
    and belongs in `state_hash`), and never a day count.
    """
    return _digest(identity, bucket="identity")


def state_hash(material: Mapping[str, Any]) -> str:
    """Fingerprint of the fields whose movement should void an acknowledgement."""
    return _digest(material, bucket="material")


def opaque_ref(value: Any) -> str:
    """A stable, renderable-safe stand-in for a row id.

    Some handlers cannot put a raw id in their output at all. `stock_and_crm.py`
    carries a test — `test_no_id_reaches_the_engagement_output_either` — that
    bans a UUID from every field except `link`, and it is right to: an id beside
    a client name is exactly what `check-rendered-ids` exists to stop, and a
    href is followed rather than read.

    But a wiring still needs something stable to key on, and for an engagement
    or a recurring profile there is no business key at all — no number, no
    reference, and a title that repeats across clients. So the id is HASHED on
    the way out. The stability survives, nothing renderable is leaked, and the
    result is the same shape as `finding_key` so it satisfies migration 159's
    CHECK if it ever reaches the table directly.

    Not a security boundary, exactly as `finding_key` is not: it is a lookup
    handle for a per-org set of tens of rows.

    THE VALUE IS STRINGIFIED FIRST, and that is not tidiness. asyncpg returns a
    `uuid.UUID` for a uuid column and a `str` the moment somebody adds `::text`
    to the SELECT, and `_canon` gives those two different encodings — the UUID
    falls through to the repr branch. Hashing them apart would silently orphan
    every acknowledgement this skill holds on the day a query was tidied up.
    """
    return blake2s(_canon(str(value)).encode("utf-8"),
                   digest_size=_DIGEST_BYTES).hexdigest()


def sanitise_label(label: str) -> str:
    """Strip contact details out of a human-readable finding label.

    Aekam staff read `skill_finding_ack` across orgs, so a label carrying a
    customer's email address or phone number leaks it through a support screen
    that is otherwise correctly scoped. Stripping rather than rejecting is
    deliberate: losing the acknowledgement is worse than losing the wording.
    """
    out = _PHONE_RE.sub("[redacted]", _EMAIL_RE.sub("[redacted]", label or ""))
    out = " ".join(out.split()).strip()[:_MAX_LABEL].rstrip()
    # Never return something migration 159's `length(btrim(finding_label)) > 0`
    # will reject: a blank label must cost the wording, not the acknowledgement.
    return out or _UNLABELLED


# == the ack set ============================================================

@dataclass(frozen=True)
class Ack:
    """One acknowledgement, as the filter needs to see it.

    `state_hash is None` means unconditional -- suppress this finding however
    its numbers move. `snooze_until is None` means permanent.
    """

    finding_key: str
    state_hash: Optional[str] = None
    snooze_until: Optional[datetime] = None
    acknowledged_by: str = ""
    acknowledged_at: Optional[datetime] = None
    note: str = ""

    def suppresses(self, current_state: Optional[str], now: datetime) -> bool:
        """Does this acknowledgement hide a finding currently in *current_state*?"""
        # An expired snooze suppresses nothing. The row is kept anyway -- it is
        # the evidence that this finding has been pushed back before.
        if self.snooze_until is not None and _aware(self.snooze_until) <= now:
            return False
        # A NULL stored state is the deliberate "regardless of movement" ack.
        if self.state_hash is None:
            return True
        # The subtle one, and the reason this module exists rather than a
        # `WHERE finding_key NOT IN (...)`: the fact was acknowledged in a
        # particular state, and it is not in that state any more. Somebody
        # acknowledged a bill of 42,000, not one of 84,000.
        return self.state_hash == current_state


def _aware(value: datetime) -> datetime:
    """Treat a naive datetime as UTC rather than raising deep inside a filter.

    asyncpg hands back aware datetimes for `timestamptz`, so in production this
    is a no-op. It exists so that a hand-built `Ack` in a test or a caller that
    passed `datetime.utcnow()` compares instead of raising the
    can't-compare-naive-and-aware TypeError that `services/skills/timeutil.py`
    was written to end.
    """
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def fetch_ack_set(pool, org_id: str, skill: str) -> dict[str, Ack]:
    """Every acknowledgement an org holds for one skill, keyed by finding_key.

    Returns ALL rows including expired snoozes -- expiry is decided against the
    caller's clock in `Ack.suppresses`, not by the query, so that one run
    evaluates every finding against a single consistent `now`. A row filtered
    out by `snooze_until > now()` in SQL could not then be reported as "snoozed
    until Friday, expired" by the caller, and that is the message that stops a
    finding being silently re-raised with no explanation.
    """
    rows = await pool.fetch(
        """
        SELECT finding_key,
               state_hash,
               snooze_until,
               acknowledged_by,
               acknowledged_at,
               note
        FROM staging.skill_finding_ack
        WHERE org_id = $1::uuid
          AND skill  = $2::text
        """,
        org_id, skill,
    )
    return {
        r["finding_key"]: Ack(
            finding_key=r["finding_key"],
            state_hash=r["state_hash"],
            snooze_until=r["snooze_until"],
            acknowledged_by=r["acknowledged_by"] or "",
            acknowledged_at=r["acknowledged_at"],
            note=r["note"] or "",
        )
        for r in rows
    }


# == the pure filter ========================================================
#
# Everything below takes findings and an ack set and touches no database. That
# is deliberate and it is the testable surface: the judgement -- is this the
# same fact, has it moved, is the snooze still live -- is where the bugs are,
# and none of them need a connection to reproduce. `mock_pool_hides_bad_sql` is
# the standing warning against the alternative: a faked pool would let this
# module's SQL pass a test while being wrong against the real schema, so the
# SQL above is verified by probing the live catalogue, never by a mock.

def partition_by_ack(
    findings: Sequence[Mapping[str, Any]],
    ack_set: Mapping[str, Ack],
    *,
    identity_of: Callable[[Mapping[str, Any]], Mapping[str, Any]],
    material_of: Optional[Callable[[Mapping[str, Any]], Mapping[str, Any]]] = None,
    now: Optional[datetime] = None,
) -> tuple[list[dict], list[dict]]:
    """Split *findings* into (surviving, suppressed).

    *identity_of* and *material_of* are supplied by the caller because only the
    caller knows which of its fields are which -- see THE THREE-WAY SPLIT. They
    are functions rather than field-name lists so a skill can compose a key from
    nested values (`f["entity"]["id"]`) without this module knowing its shape.

    Passing no *material_of* means every acknowledgement for this skill is
    treated as unconditional. That is a real choice for a skill whose findings
    have no meaningful amount, and a bad default for one that does, so it is
    explicit at the call site rather than being inferred here.

    Each returned finding carries an `_ack` annotation on the SUPPRESSED side
    only -- who acknowledged it and until when -- so a caller can render
    "3 findings acknowledged" without a second query. The surviving findings are
    returned unmodified, because they go on to be rendered and prompted with,
    and adding keys to them would change what every downstream reader sees.
    """
    now = now or datetime.now(timezone.utc)
    surviving: list[dict] = []
    suppressed: list[dict] = []

    for finding in findings:
        key = finding_key(identity_of(finding))
        ack = ack_set.get(key)
        if ack is None:
            surviving.append(dict(finding))
            continue

        if material_of is None and ack.state_hash is not None:
            # Stored WITH a state, filtered WITHOUT one. `Ack.suppresses` would
            # compare the stored digest against None, never match, and hide
            # nothing -- for every ack this skill holds, for ever, silently. The
            # caller has to say which it means: pass the same `material_of` the
            # ack was recorded with, or record the ack with `state=None` if it
            # was genuinely meant to be unconditional.
            raise MissingMaterialError(
                "an acknowledgement for this skill carries a state_hash but "
                "partition_by_ack was called without material_of, so no stored "
                "state can ever match and every acknowledgement would suppress "
                "nothing. Pass the material_of used when the ack was recorded, "
                "or record unconditional acks with state=None. See "
                "services/skill_ack.py, THE THREE-WAY SPLIT."
            )

        current = state_hash(material_of(finding)) if material_of else None
        if ack.suppresses(current, now):
            hidden = dict(finding)
            hidden["_ack"] = {
                "by": ack.acknowledged_by,
                "at": ack.acknowledged_at,
                "snooze_until": ack.snooze_until,
                "note": ack.note,
            }
            suppressed.append(hidden)
        else:
            # It came back. The caller may want to say WHY -- "you acknowledged
            # this when the balance was different" reads very differently from
            # a finding that simply reappeared -- but that belongs to whoever
            # renders it, and the surviving list stays unmodified.
            surviving.append(dict(finding))

    return surviving, suppressed


def apply_acks(
    findings: Sequence[Mapping[str, Any]],
    ack_set: Mapping[str, Ack],
    *,
    identity_of: Callable[[Mapping[str, Any]], Mapping[str, Any]],
    material_of: Optional[Callable[[Mapping[str, Any]], Mapping[str, Any]]] = None,
    now: Optional[datetime] = None,
) -> list[dict]:
    """The findings that survive their acknowledgements. Thin wrapper."""
    surviving, _ = partition_by_ack(
        findings, ack_set,
        identity_of=identity_of, material_of=material_of, now=now,
    )
    return surviving


# == writing an acknowledgement =============================================

async def record_ack(
    pool,
    org_id: str,
    skill: str,
    *,
    key: str,
    label: str,
    acknowledged_by: str,
    state: Optional[str] = None,
    snooze_until: Optional[datetime] = None,
    note: str = "",
) -> None:
    """Acknowledge one finding, or move an existing acknowledgement.

    *key* comes from `finding_key`, *state* from `state_hash` -- computed by the
    caller from the SAME identity/material split it filters with, or the ack
    will be filed under a key the filter never looks up.

    `state=None` records an unconditional acknowledgement: suppress this finding
    however its numbers move. Pass it deliberately; the ordinary case is to pass
    the current state so the finding returns if the underlying fact changes.

    UPSERT, because `uq_skill_finding_ack` allows one live acknowledgement per
    finding. Re-acknowledging rewrites the actor and the timestamp: this row is
    the LAST WRITER, not a history -- migration 097's line, held here too.
    """
    await pool.execute(
        """
        INSERT INTO staging.skill_finding_ack
            (org_id, skill, finding_key, state_hash, finding_label,
             acknowledged_by, snooze_until, note)
        VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text,
                $6::text, $7::timestamptz, $8::text)
        ON CONFLICT (org_id, skill, finding_key) DO UPDATE
           SET state_hash      = EXCLUDED.state_hash,
               finding_label   = EXCLUDED.finding_label,
               acknowledged_by = EXCLUDED.acknowledged_by,
               acknowledged_at = now(),
               snooze_until    = EXCLUDED.snooze_until,
               note            = EXCLUDED.note,
               updated_at      = now()
        """,
        org_id, skill, key, state, sanitise_label(label),
        acknowledged_by, snooze_until, note or "",
    )


async def clear_ack(pool, org_id: str, skill: str, *, key: str) -> None:
    """Withdraw an acknowledgement so the finding returns at the next run.

    A real DELETE, and the only one in this module. Withdrawing is the user
    saying "that was wrong, show me this again"; leaving a tombstone would mean
    the finding stays hidden while the table claims otherwise.
    """
    await pool.execute(
        """
        DELETE FROM staging.skill_finding_ack
        WHERE org_id = $1::uuid AND skill = $2::text AND finding_key = $3::text
        """,
        org_id, skill, key,
    )
