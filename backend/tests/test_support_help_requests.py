"""The step in front: an organisation asking Aekam for help.

`tests/test_support_sessions.py` covers the GRANT — request, approve, deny,
revoke — and the six things that must be impossible about it. This file covers
the act that now comes before all of that, and the one property that matters
most about it:

    ASKING FOR HELP GRANTS NOTHING, AND CANNOT BE MADE TO.

The owner's flow is `org requests > aekam gets email and notification > aekam
sends request > org approves`. Four acts; ONE of them creates access. Every
test below is either about that separation or about the notice not being
silent.

── FIVE THINGS MUST BE IMPOSSIBLE ───────────────────────────────────────────

  1. an ask that grants something — there is no column on
     `staging.platform_support_requests` that could, and no view reads it
  2. an ask nobody at Aekam was told about
  3. an ask raised in somebody else's name, or for an org the caller does not
     manage
  4. two presses making two asks
  5. an ask that promises help with payroll, personnel files or attendance
     photographs — a support session can never reach those, so naming them
     would be a promise the product cannot keep

── THE ONE POLARITY THAT IS DELIBERATELY OPPOSITE TO `open_session` ─────────

In `open_session` a failed owner email ROLLS THE GRANT BACK: the mail is the
customer's only warning that a stranger has their records, so refusing is the
safe direction.

Here the customer is asking for help, and throwing their request away because a
mail provider is down leaves an organisation already in trouble with nothing.
So the notification rows and the audit row are inside the transaction and
unwrapped — they are the record — and the inbox mail is sent AFTER the commit,
best-effort. `test_a_dead_mail_provider_does_not_throw_the_ask_away` and
`test_a_failed_audit_row_aborts_the_ask` are the pair that pins both halves; if
somebody ever "makes them consistent" one of the two will fail.
"""
import json
import re
from pathlib import Path

import asyncpg
import pytest

from middleware import org_resolver as R
from services import support_session as S

#: `pytest.ini` sets `asyncio_mode = auto`, so async tests need no mark.

ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
ADMIN = "user_org_admin"
AEKAM = "user_aekam_admin"

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations" / "182_org_initiated_support_requests.sql"
)
SESSIONS_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations" / "111_platform_support_sessions.sql"
)


# ═════════════════════════════════════════════════════════════════════════════
# Fixtures — dispatching on the QUERY, never on call order.
# ═════════════════════════════════════════════════════════════════════════════

class _AskPool:
    """A pool with a real-shaped transaction, so a raise can be observed to roll
    back and so the nested SAVEPOINT the ref retry needs actually nests."""

    def __init__(self, recipients=None, org=None, insert_raises=None,
                 audit_raises=None, notify_raises=None):
        self.recipients = (
            [{"user_id": AEKAM, "display_name": "Sid (Aekam)"}]
            if recipients is None else list(recipients)
        )
        self.org = org if org is not None else {"id": ORG_A, "name": "Unicode Group"}
        self.insert_raises = insert_raises
        self.audit_raises = audit_raises
        self.notify_raises = notify_raises
        self.inserted = []
        self.audited = []
        self.notified = []
        self.rolled_back = False

    def acquire(self):
        pool = self

        class _C:
            async def __aenter__(self): return pool
            async def __aexit__(self, *e): return False
        return _C()

    def transaction(self):
        pool = self

        class _T:
            async def __aenter__(self): return None
            async def __aexit__(self, exc_type, *e):
                if exc_type is not None:
                    pool.rolled_back = True
                return False
        return _T()

    async def fetch(self, sql, *a):
        q = " ".join(sql.split())
        if "staging.user_roles" in q:
            return [dict(r) for r in self.recipients]
        return []

    async def fetchrow(self, sql, *a):
        q = " ".join(sql.split())
        if "FROM staging.organisations" in q:
            return self.org
        if "FROM users WHERE user_id" in q:
            return {"display_name": "Rohit (Unicode Group)"}
        if "INSERT INTO staging.platform_support_requests" in q:
            if self.insert_raises:
                raise self.insert_raises
            self.inserted.append(a)
            return {"id": "9f1c0d2e-0000-4000-8000-000000000001",
                    "ref": a[0], "raised_at": None}
        return None

    async def execute(self, sql, *a):
        if "audit_log" in sql:
            if self.audit_raises:
                raise self.audit_raises
            self.audited.append(a)
        elif "notifications" in sql:
            if self.notify_raises:
                raise self.notify_raises
            self.notified.append(a)
        return "OK"


@pytest.fixture
def sent(monkeypatch):
    """Captures the inbox mail without letting a provider anywhere near it."""
    import email_service
    box = []
    monkeypatch.setattr(
        email_service, "send_email",
        lambda to, subj, html, **kw: (box.append((to, subj, kw)), True)[1],
    )
    return box


async def _raise(pool, **kw):
    args = dict(
        org_id=ORG_A, raised_by=ADMIN,
        reason="the invoice run has been stuck since this morning",
        modules=["ganit"], requestable=R.SUPPORT_REQUESTABLE_MODULES,
        aekam_roles=("platform_owner", "platform_admin", "platform_support"),
    )
    args.update(kw)
    return await S.raise_help_request(pool, **args)


# ═════════════════════════════════════════════════════════════════════════════
# IMPOSSIBILITY 1 · asking grants nothing, and cannot be made to
# ═════════════════════════════════════════════════════════════════════════════

def test_the_ask_table_has_no_column_that_could_grant_anything():
    """THE PROPERTY THE WHOLE DESIGN RESTS ON, read out of the DDL.

    `platform_support_sessions` was the obvious home for this row and it is the
    wrong one: every row in that table is one UPDATE away from being a live
    grant, and `POST /{id}/approve` is reachable by any org_owner/org_admin of
    the org. A customer's ask living there could be approved by a SECOND admin
    of the same org — the self-approval guard only refuses the same person — and
    a session would exist that Aekam never asked for.

    So the ask lives in a table with nothing to set."""
    body = MIGRATION.read_text(encoding="utf-8")
    table = body[body.index("CREATE TABLE"):body.index("COMMENT ON TABLE")]
    declared = set(re.findall(r"^\s{4}([a-z_]+)\s+[A-Z]", table, re.M))
    for grantish in ("approved_at", "approved_by", "access_level",
                     "granted_ttl_hours", "expires_at", "revoked_at",
                     "revoked_by", "status", "state", "is_active", "active",
                     "owner_emailed_at"):
        assert grantish not in declared, f"somebody added {grantish!r}"
    # And the columns that MUST be there.
    for needed in ("ref", "org_id", "raised_by", "reason", "modules",
                   "raised_at", "raised_on", "notified_to"):
        assert needed in declared, needed


def test_nothing_that_decides_authority_has_heard_of_the_ask_table():
    """Support authority is resolved from `staging.v_active_support_sessions`
    and from nowhere else. If this table ever appears under `middleware/`, a
    second authorisation path has been created that nobody audited."""
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "middleware").glob("*.py")):
        body = path.read_text(encoding="utf-8")
        assert "platform_support_requests" not in body, path.name


def test_the_migration_creates_no_view_and_no_foreign_key_to_the_grant_table():
    body = MIGRATION.read_text(encoding="utf-8")
    ddl = body[body.index("BEGIN;"):body.index("COMMIT;")]
    assert "CREATE VIEW" not in ddl and "CREATE OR REPLACE VIEW" not in ddl
    assert "REFERENCES staging.platform_support_sessions" not in ddl
    # The one FK it does take, and the only one.
    assert ddl.count("REFERENCES ") == 1
    assert "REFERENCES staging.organisations(id)" in ddl


def test_the_two_refs_cannot_be_confused_with_each_other():
    """ASK- and SUP- travel together in one conversation. A shared prefix would
    make the audit log unable to say which of the two a row is about."""
    for _ in range(200):
        assert re.fullmatch(r"ASK-[0-9A-HJ-NP-Z]{6}", S.new_ask_ref())
    assert S.new_ask_ref()[:4] != S.new_ref()[:4]
    # And the CHECK in the migration agrees with the generator, or every insert
    # fails at the constraint.
    assert "'^ASK-[0-9A-HJ-NP-Z]{6}$'" in MIGRATION.read_text(encoding="utf-8")
    assert "'^SUP-[0-9A-HJ-NP-Z]{6}$'" in SESSIONS_MIGRATION.read_text(encoding="utf-8")


async def test_the_answer_says_out_loud_that_nothing_was_granted(sent):
    """The customer's next question is "does somebody from Aekam have my books
    now". It is answered in a field the UI can read, not in prose it might
    drop."""
    out = await _raise(_AskPool())
    assert out["grants"].startswith("nothing")
    assert out["ref"].startswith("ASK-")
    assert out["aekam_notified"] == 1


# ═════════════════════════════════════════════════════════════════════════════
# IMPOSSIBILITY 2 · an ask nobody at Aekam was told about
# ═════════════════════════════════════════════════════════════════════════════

async def test_the_notification_rows_and_the_audit_row_are_inside_the_ask(sent):
    pool = _AskPool(recipients=[
        {"user_id": "user_a", "display_name": "Sid (Aekam)"},
        {"user_id": "user_b", "display_name": "Bhoomi (Aekam)"},
    ])
    out = await _raise(pool)
    assert out["aekam_notified"] == 2
    assert len(pool.notified) == 2
    assert len(pool.audited) == 1
    assert len(sent) == 1 and sent[0][0] == S.PLATFORM_SUPPORT_INBOX
    # The recipients are recorded ON THE ROW, because the set is GUESSED.
    inserted = pool.inserted[0]
    assert inserted[5] == ["user_a", "user_b"]


async def test_nobody_at_aekam_refuses_rather_than_filing_it_where_nobody_looks(sent):
    """Mirrors `resolve_owner_recipient`'s refusal. A cry for help committed
    into a table nobody was pointed at is worse than a refusal that says so."""
    pool = _AskPool(recipients=[])
    with pytest.raises(S.SupportSessionError) as exc:
        await _raise(pool)
    assert exc.value.status == 409
    assert pool.inserted == [] and pool.audited == [] and sent == []


async def test_a_failed_audit_row_aborts_the_ask(sent):
    """The property `services/support_session.py` exists to keep, applied to the
    new path: `_audit` is a plain awaited INSERT on the SAME connection inside
    the SAME transaction, with no try/except, so a failure rolls the row back."""
    pool = _AskPool(audit_raises=asyncpg.PostgresError("audit_log is unavailable"))
    with pytest.raises(asyncpg.PostgresError):
        await _raise(pool)
    assert pool.rolled_back, "an unrecorded ask must not exist"


async def test_a_failed_notification_row_aborts_the_ask(sent):
    """`psr_somebody_at_aekam_was_told` is the same rule at the database. This
    is it on the side the database cannot see: if the rows that put the ask in
    front of a person cannot be written, the ask does not exist."""
    pool = _AskPool(notify_raises=asyncpg.PostgresError("notifications is unavailable"))
    with pytest.raises(asyncpg.PostgresError):
        await _raise(pool)
    assert pool.rolled_back
    assert pool.audited == []


async def test_a_dead_mail_provider_does_not_throw_the_ask_away(monkeypatch):
    """THE POLARITY THAT IS DELIBERATELY OPPOSITE TO `open_session`.

    There, a refused owner email un-does the GRANT, because the mail is the
    customer's only warning that a stranger has their records. Here the customer
    is ASKING for help, and refusing because a provider is down leaves an
    organisation already in trouble with nothing at all. The record — the row,
    the notification rows, the audit entry — is already durable when the mail is
    attempted."""
    import email_service
    monkeypatch.setattr(
        email_service, "send_email",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("Resend is down")),
    )
    pool = _AskPool()
    out = await _raise(pool)
    assert out["ref"].startswith("ASK-")
    assert pool.rolled_back is False
    assert len(pool.notified) == 1 and len(pool.audited) == 1


def test_the_ask_wraps_nothing_above_the_commit():
    """A tripwire, because the failure this guards against is a well-meant
    refactor. The only `except Exception` in `raise_help_request` must be the
    one after the transaction block — everything inside it stays bare, or an ask
    could be recorded that nobody was told about."""
    import inspect
    # EXECUTABLE LINES ONLY. The comment that explains this rule quotes
    # `except Exception` verbatim, and counting raw text would make the comment
    # itself trip the assertion — the same trap
    # `test_the_module_gate_reads_the_session_even_when_the_role_needs_no_lift`
    # documents in the sibling file.
    src = "\n".join(
        line for line in inspect.getsource(S.raise_help_request).splitlines()
        if not line.strip().startswith("#")
    )
    # `from email_service import send_email` appears once, in the post-commit
    # block, and is an executable anchor rather than a comment somebody may
    # reword.
    inside = src[src.index("async with pool.acquire()"):
                 src.index("from email_service import send_email")]
    assert "except Exception" not in inside, (
        "something inside the ask transaction has been wrapped in a blanket "
        "except; an ask nobody was told about could then be committed"
    )
    # The two `except`s that ARE in there are named and answer with a status:
    # 42P01 is "migration 182 is unapplied" and the unique violation is "you
    # already asked today". Neither can swallow a failed audit or notification.
    assert "except asyncpg.UndefinedTableError" in inside
    assert "except asyncpg.UniqueViolationError" in inside
    assert src.count("except Exception") == 1, (
        "there is a second blanket except; only the post-commit mail may have one"
    )
    assert "except Exception" not in inspect.getsource(S._audit)


def test_the_inbox_mail_is_not_blocking():
    """`blocking=True` stays at exactly ONE caller — `open_session`, where the
    whole correctness argument rests on the provider's real answer.
    `email_service.send_email`'s own docstring promises that. A second blocking
    sender puts an HTTP round trip on a second request path."""
    import inspect
    src = inspect.getsource(S.raise_help_request)
    call = src[src.index("send_email("):]
    call = call[:call.index(")\n")]
    assert "blocking" not in call


async def test_the_audit_row_lands_in_the_customers_own_log_and_says_it_granted_nothing(sent):
    pool = _AskPool()
    await _raise(pool)
    org_id, user_id, action, resource_type, ref, detail, severity = pool.audited[0]
    assert org_id == ORG_A, "the CUSTOMER'S audit log, not Aekam's"
    assert user_id == ADMIN
    assert action == "platform.support_help_requested"
    # A GRANT and an ASK must be filterable apart. A reader looking for the
    # three rows that record an authorisation CHANGING must not get this one.
    assert resource_type == "support_request"
    assert ref.startswith("ASK-")
    assert severity == "info"
    assert json.loads(detail)["grants"] == "nothing"


async def test_the_inbox_mail_names_no_address_and_no_user_id(sent):
    """Aekam is told WHICH ORGANISATION and WHO BY NAME. Reaching the person
    goes through an approved session, which leaves an audit row —
    `admin_orgs.py:829` and `server.py:3496` are the standing rule."""
    pool = _AskPool()
    await _raise(pool)
    subject, html = S._help_request_email(
        org_name="Unicode Group", ref="ASK-A1B2C3",
        raised_by_name="Rohit (Unicode Group)",
        reason="the invoice run has been stuck since this morning",
        modules=["ganit"],
    )
    assert "ASK-A1B2C3" in subject
    assert "user_" not in html
    assert "@unicodegroup" not in html
    # And it says what the reader must not assume.
    assert "GRANTS NOTHING" in html or "grants nothing" in html.lower()


async def test_the_reason_is_escaped_on_its_way_into_the_mail():
    """The reason is user-controlled free text and it lands in `body_rows`,
    which `_base` does NOT escape — that stays the caller's responsibility by
    design, the same choke-point rule the rest of `email_service` follows."""
    _, html = S._help_request_email(
        org_name="<b>Acme</b>", ref="ASK-A1B2C3",
        raised_by_name="<script>alert(1)</script>",
        reason="ledger broke <img src=x onerror=alert(1)>",
        modules=["ganit"],
    )
    # NOTHING the customer typed survives as MARKUP. `onerror=` is still in the
    # text and that is correct — it is inert once the angle brackets are gone,
    # and stripping words rather than escaping syntax is the sanitiser trap.
    assert "<script>" not in html
    # `<img` on its own is in the template — the Kartavaya mark in the header.
    # What must not be there is the one the customer typed.
    assert "<img src=x" not in html
    assert "<b>Acme</b>" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html


# ═════════════════════════════════════════════════════════════════════════════
# IMPOSSIBILITY 4 and 5 · two presses, and what may be asked about
# ═════════════════════════════════════════════════════════════════════════════

async def test_two_presses_in_a_day_make_one_ask(sent):
    """`idx_psr_one_ask_per_person_per_org_per_day` is a UNIQUE INDEX and not a
    Python check: two presses race, and Aekam getting two mails and two
    notification rows about one problem is the failure."""
    pool = _AskPool(insert_raises=asyncpg.UniqueViolationError(
        'duplicate key value violates unique constraint '
        '"idx_psr_one_ask_per_person_per_org_per_day"'
    ))
    with pytest.raises(S.SupportSessionError) as exc:
        await _raise(pool)
    assert exc.value.status == 409
    assert "already asked" in exc.value.detail
    assert sent == [] and pool.audited == []


def test_the_dedupe_index_is_per_person_and_not_per_org():
    """Two different administrators noticing two different problems on the same
    day is two asks. Collapsing them onto the org would lose one."""
    body = MIGRATION.read_text(encoding="utf-8")
    assert ("CREATE UNIQUE INDEX IF NOT EXISTS "
            "idx_psr_one_ask_per_person_per_org_per_day") in body
    idx = body[body.index("idx_psr_one_ask_per_person_per_org_per_day"):]
    signature = idx[idx.index("("):idx.index(")") + 1]
    assert "org_id" in signature and "raised_by" in signature and "raised_on" in signature


@pytest.mark.parametrize("kw,why", [
    ({"reason": "too short"}, "a reason nobody can scope"),
    ({"reason": "   "}, "whitespace is not an answer"),
    ({"modules": ["vetana"]}, "payroll"),
    ({"modules": ["manav"]}, "personnel files"),
    ({"modules": ["pahchan"]}, "attendance photographs"),
    ({"modules": ["ganit", "ganit"]}, "the same module twice"),
    ({"modules": ["nonsense"]}, "a module that does not exist"),
])
def test_an_ask_that_could_not_mean_anything_is_refused(kw, why):
    args = dict(
        reason="the invoice run has been stuck since this morning",
        modules=["ganit"], requestable=R.SUPPORT_REQUESTABLE_MODULES,
    )
    args.update(kw)
    with pytest.raises(S.SupportSessionError) as exc:
        S.validate_help_request(**args)
    assert exc.value.status == 400, why


def test_a_forbidden_module_is_refused_LOUDLY_and_not_dropped_quietly():
    """An org that ticks "payroll" and gets an ask with no modules on it has
    been told nothing, and would reasonably expect help with payroll to be
    coming. A support session can never reach it, so the refusal has to say so
    where they will read it."""
    with pytest.raises(S.SupportSessionError) as exc:
        S.validate_help_request(
            reason="the payslips came out with the wrong tax",
            modules=["vetana"], requestable=R.SUPPORT_REQUESTABLE_MODULES,
        )
    assert "vetana" in exc.value.detail
    assert "Payroll" in exc.value.detail


def test_naming_no_module_at_all_is_allowed_here_and_refused_on_a_session():
    """THE ASYMMETRY IS THE POINT. An organisation whose invoice run is stuck
    often cannot say which module is at fault, and refusing their ask over that
    would be the product asking the customer to diagnose it.

    A support SESSION with no modules is a different thing entirely: it reaches
    nothing, and is a row nobody finished filling in."""
    S.validate_help_request(
        reason="something in the billing screens is not adding up",
        modules=[], requestable=R.SUPPORT_REQUESTABLE_MODULES,
    )
    with pytest.raises(S.SupportSessionError):
        S.validate_request(
            reason="something in the billing screens is not adding up",
            modules=[], access_level="viewer", ttl_hours=2,
            requestable=R.SUPPORT_REQUESTABLE_MODULES,
        )


def test_an_ask_names_no_duration_and_no_access_level():
    """It is a signal, not a proposal. A duration or a level on the ask would be
    the customer pre-agreeing to a scope nobody has asked them for yet — which
    is the first half of the double approval collapsing into the second."""
    import inspect
    sig = inspect.signature(S.raise_help_request).parameters
    for absent in ("ttl_hours", "access_level", "granted_ttl_hours",
                   "requested_ttl_hours"):
        assert absent not in sig, absent


# ═════════════════════════════════════════════════════════════════════════════
# DORMANCY · migration 182 is unapplied, which is production's state TODAY
# ═════════════════════════════════════════════════════════════════════════════

async def test_a_write_against_an_absent_table_says_so_rather_than_doing_nothing(
    sent, caplog,
):
    S._REQUESTS_TABLE_ABSENT_LOGGED = False
    pool = _AskPool(insert_raises=asyncpg.UndefinedTableError(
        "relation \"staging.platform_support_requests\" does not exist"
    ))
    with caplog.at_level("WARNING"):
        with pytest.raises(S.SupportSessionError) as exc:
            await _raise(pool)
    assert exc.value.status == 503
    assert "182" in exc.value.detail
    assert sent == [] and pool.audited == []
    absent = [r for r in caplog.records if "migration 182 is unapplied" in r.message]
    assert len(absent) == 1, "one warning, then silence"


async def test_the_read_answers_no_requests_rather_than_500ing():
    class _P:
        async def fetch(self, sql, *a):
            raise asyncpg.UndefinedTableError("relation does not exist")

    assert await S.list_help_requests(_P()) == []
    assert await S.list_help_requests(_P(), org_ids=[ORG_A]) == []


async def test_an_empty_org_list_is_not_the_whole_platform():
    """`org_ids=None` is Aekam's queue; `org_ids=[]` is "the orgs you manage, of
    which there are none". They are one `if org_ids:` away from each other and
    the wrong reading hands a stranger every customer's queue."""
    class _P:
        async def fetch(self, sql, *a):   # pragma: no cover - must not be reached
            raise AssertionError("an empty org list queried the whole platform")

    assert await S.list_help_requests(_P(), org_ids=[]) == []


# ═════════════════════════════════════════════════════════════════════════════
# THE LIST · derived state, and no stored answer
# ═════════════════════════════════════════════════════════════════════════════

class _ListPool:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.sql = None
        self.args = None

    async def fetch(self, sql, *a):
        self.sql = " ".join(sql.split())
        self.args = a
        return self.rows


def _ask_row(**kw):
    from datetime import datetime, timezone
    row = {
        "id": "9f1c0d2e-0000-4000-8000-000000000001",
        "ref": "ASK-A1B2C3",
        "org_id": ORG_A,
        "raised_by": ADMIN,
        "reason": "the invoice run has been stuck since this morning",
        "modules": ["ganit"],
        "raised_at": datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc),
        "aekam_notified": 3,
        "org_name": "Unicode Group",
        "raised_by_name": "Rohit (Unicode Group)",
        "answered": False,
    }
    row.update(kw)
    return row


async def test_open_and_answered_are_derived_and_never_stored():
    """182 refuses a `closed_at` for the reason 111 refuses a `status`: a stored
    answer is a cache of an event, and its failure mode is staleness. An ask is
    OPEN until Aekam raises a session for that org after it — an EXISTS clause
    evaluated on every read."""
    rows = await S.list_help_requests(_ListPool([_ask_row()]))
    assert rows[0]["state"] == "open"
    rows = await S.list_help_requests(_ListPool([_ask_row(answered=True)]))
    assert rows[0]["state"] == "answered"

    body = MIGRATION.read_text(encoding="utf-8")
    table = body[body.index("CREATE TABLE"):body.index("COMMENT ON TABLE")]
    declared = set(re.findall(r"^\s{4}([a-z_]+)\s+[A-Z]", table, re.M))
    for cached in ("closed_at", "closed_by", "answered_at", "answered_by",
                   "session_id", "status"):
        assert cached not in declared, f"somebody added {cached!r}"


async def test_the_open_filter_is_the_same_clause_as_the_derived_state():
    """One predicate, written once. Two expressions would drift, and the drift
    here is an ask that reads as answered in the list and never leaves the
    queue, or the reverse."""
    pool = _ListPool()
    await S.list_help_requests(pool, open_only=True)
    assert pool.sql.count("s.requested_at >= r.raised_at") == 2, (
        "the open filter and the derived state are no longer the same clause"
    )
    pool = _ListPool()
    await S.list_help_requests(pool, open_only=False)
    assert pool.sql.count("s.requested_at >= r.raised_at") == 1


async def test_the_list_names_people_and_never_renders_an_id():
    rows = await S.list_help_requests(_ListPool([_ask_row()]))
    assert rows[0]["raised_by_name"] == "Rohit (Unicode Group)"
    assert rows[0]["org_name"] == "Unicode Group"
    assert "raised_by" not in rows[0], "a user id on a screen"
    assert "notified_to" not in rows[0], "Aekam user ids on a screen"
    # A COUNT is what the reader needs: somebody was told.
    assert rows[0]["aekam_notified"] == 3
    assert rows[0]["grants"] == "nothing"


async def test_the_list_asks_only_for_the_orgs_it_was_given():
    pool = _ListPool()
    await S.list_help_requests(pool, org_ids=[ORG_A])
    assert "r.org_id = ANY($1::uuid[])" in pool.sql
    assert pool.args == ([ORG_A],)


def test_the_session_list_no_longer_coalesces_a_name_onto_an_email_or_an_id():
    """The privacy ratchet. `COALESCE(ru.name, ru.email, s.requested_by)` handed
    the customer the operator's address and the operator the customer's, on a
    screen neither had to ask for — and fell back to `user_549c9cac35aa` when
    both were blank. `admin_orgs.py:829` dropped exactly this leg from the org
    list for exactly this reason."""
    assert "ru.email" not in S._LIST_NAMES
    assert "au.email" not in S._LIST_NAMES
    assert "s.requested_by)" not in S._LIST_NAMES
    assert "full_name" in S._LIST_NAMES
    assert S._LIST_NAMES.count("'Name not on file'") == 2


# ═════════════════════════════════════════════════════════════════════════════
# THE ROUTER · who may ask, and who may read
# ═════════════════════════════════════════════════════════════════════════════

class _RouterPool:
    def __init__(self, platform_role=None, manages=()):
        self.platform_role = platform_role
        self.manages = set(manages)

    async def fetchval(self, sql, *a):
        if "org_id IS NULL" in sql:
            wanted = a[1] if len(a) > 1 else ()
            return self.platform_role if self.platform_role in (wanted or ()) else None
        if "org_id=$2::uuid" in sql:
            return 1 if a[1] in self.manages else None
        return None

    async def fetch(self, sql, *a):
        if "DISTINCT org_id" in sql:
            return [{"org_id": o} for o in sorted(self.manages)]
        return []

    async def fetchrow(self, sql, *a):
        return None


def _router(monkeypatch, pool):
    import routers.support_sessions as RT

    async def _gp():
        return pool
    monkeypatch.setattr(RT, "get_pool", _gp)
    return RT


def _async(value):
    async def _c():
        return value
    return _c()


async def test_only_an_owner_or_admin_of_that_org_may_ask_on_its_behalf(monkeypatch):
    RT = _router(monkeypatch, _RouterPool(manages={ORG_A}))
    with pytest.raises(Exception) as exc:
        await RT.ask_for_support(
            RT.HelpRequest(org_id=ORG_B,
                           reason="the invoice run has been stuck all morning"),
            user={"user_id": ADMIN},
        )
    assert exc.value.status_code == 403


async def test_a_platform_role_is_not_authority_to_ask_for_a_customer(monkeypatch):
    """The whole point of the step is that the CUSTOMER asked. An Aekam account
    that could raise the ask and then answer it has re-created the thing this
    feature replaced — so authority here comes from managing the ORGANISATION
    and never from the platform tier, not even god mode."""
    RT = _router(monkeypatch, _RouterPool(platform_role="platform_admin"))
    with pytest.raises(Exception) as exc:
        await RT.ask_for_support(
            RT.HelpRequest(org_id=ORG_A,
                           reason="the invoice run has been stuck all morning"),
            user={"user_id": AEKAM},
        )
    assert exc.value.status_code == 403


async def test_the_asker_is_taken_from_the_token_and_never_from_the_body(monkeypatch):
    RT = _router(monkeypatch, _RouterPool(manages={ORG_A}))
    seen = {}

    async def _raise_help(pool, **kw):
        seen.update(kw)
        return {"ref": "ASK-A1B2C3"}
    monkeypatch.setattr(RT.svc, "raise_help_request", _raise_help)

    await RT.ask_for_support(
        RT.HelpRequest(org_id=ORG_A,
                       reason="the invoice run has been stuck all morning",
                       modules=["ganit"]),
        user={"user_id": ADMIN},
    )
    assert seen["raised_by"] == ADMIN
    assert seen["org_id"] == ORG_A
    # The module vocabulary comes from the GUARD'S constants, so an ask and a
    # session cannot disagree about which modules exist.
    assert seen["requestable"] is R.SUPPORT_REQUESTABLE_MODULES


async def test_the_organisation_is_inferred_only_when_it_is_unambiguous(monkeypatch):
    RT = _router(monkeypatch, _RouterPool(manages={ORG_A}))
    seen = {}

    async def _raise_help(pool, **kw):
        seen.update(kw)
        return {"ref": "ASK-A1B2C3"}
    monkeypatch.setattr(RT.svc, "raise_help_request", _raise_help)

    await RT.ask_for_support(
        RT.HelpRequest(reason="the invoice run has been stuck all morning"),
        user={"user_id": ADMIN},
    )
    assert seen["org_id"] == ORG_A

    # Two managed orgs: a guess would file the problem against the wrong
    # customer, so it is a 400 that says which choice is missing.
    RT = _router(monkeypatch, _RouterPool(manages={ORG_A, ORG_B}))
    with pytest.raises(Exception) as exc:
        await RT.ask_for_support(
            RT.HelpRequest(reason="the invoice run has been stuck all morning"),
            user={"user_id": ADMIN},
        )
    assert exc.value.status_code == 400


async def test_aekam_reads_every_queue_and_a_customer_reads_only_their_own(monkeypatch):
    RT = _router(monkeypatch, _RouterPool(platform_role="platform_admin"))
    seen = {}

    async def _list(pool, org_ids=None, open_only=True):
        seen["org_ids"] = org_ids
        seen["open_only"] = open_only
        return []
    monkeypatch.setattr(RT.svc, "list_help_requests", _list)

    await RT.list_support_requests(user={"user_id": AEKAM})
    assert seen["org_ids"] is None, "Aekam's queue is every organisation"
    assert seen["open_only"] is True

    RT = _router(monkeypatch, _RouterPool(manages={ORG_A}))
    monkeypatch.setattr(RT.svc, "list_help_requests", _list)
    await RT.list_support_requests(user={"user_id": ADMIN})
    assert seen["org_ids"] == [ORG_A]


@pytest.mark.parametrize("role", [
    "platform_manager", "platform_staff", "account_manager", "account_finance",
    "sahayak_admin",
])
async def test_a_platform_role_that_cannot_answer_does_not_get_the_queue(
    monkeypatch, role,
):
    """NOT `ALL_PLATFORM_ROLES`. An ask carries the customer's own words about
    what is going wrong in their business; the audience is the people who can
    answer it, which is the same set that gets the notification.

    These roles are not strangers — if one of them administers an organisation
    they see that organisation's asks, from the branch below."""
    RT = _router(monkeypatch, _RouterPool(platform_role=role))
    with pytest.raises(Exception) as exc:
        await RT.list_support_requests(user={"user_id": AEKAM})
    assert exc.value.status_code == 403, role


async def test_a_stranger_cannot_read_the_support_queue(monkeypatch):
    """403 and not an empty list: an empty list reads as "nobody has asked for
    help", which is a different and false fact."""
    RT = _router(monkeypatch, _RouterPool())
    with pytest.raises(Exception) as exc:
        await RT.list_support_requests(user={"user_id": "user_nobody"})
    assert exc.value.status_code == 403


def test_the_people_told_are_the_people_who_can_act(monkeypatch):
    """NOT `ALL_PLATFORM_ROLES`. Notifying somebody who cannot answer the ask
    teaches them to ignore the notification, which is how the one that matters
    gets missed. `platform_support` raises the reply; god mode is who can act
    when it has no holders — which is its live state today (measured
    2026-08-21: zero)."""
    import routers.support_sessions as RT
    from middleware.role_tiers import ALL_PLATFORM_ROLES, GOD_MODE_ROLES, SUPPORT_ROLES

    assert set(RT._AEKAM_NOTIFY_ROLES) == set(GOD_MODE_ROLES) | set(SUPPORT_ROLES)
    assert set(RT._AEKAM_NOTIFY_ROLES) < set(ALL_PLATFORM_ROLES)


def test_the_ask_routes_are_registered_and_the_module_is_reachable():
    """`routers/support_sessions.py` was written, reviewed and left unregistered
    for weeks while `SupportSessionsPage.jsx`, `org/TabSupportAccess.jsx` and
    two standing comments in the backend pointed at it BY NAME. Registering a
    router is the whole fix, and this is what fails if it is ever dropped."""
    import server

    paths = {
        (r.path, m)
        for r in server.app.routes
        for m in getattr(r, "methods", ()) or ()
        if hasattr(r, "path")
    }

    def walk(router, out):
        from fastapi.routing import APIRoute
        for r in getattr(router, "routes", []):
            if isinstance(r, APIRoute):
                for m in r.methods:
                    out.add((r.path, m))
            inner = getattr(r, "original_router", None)
            if inner is not None:
                walk(inner, out)
        return out

    paths = walk(server.app, paths)
    assert ("/api/v1/support-sessions/requests", "POST") in paths
    assert ("/api/v1/support-sessions/requests", "GET") in paths
    assert ("/api/v1/support-sessions", "POST") in paths
    assert ("/api/v1/support-sessions/{session_id}/approve", "POST") in paths


def test_a_session_still_cannot_reach_the_endpoints_that_manage_sessions():
    """Registering the router must not have put `/api/v1/support-sessions` into
    either allow-list in `org_resolver.py`. A support session that could raise
    or approve support sessions is the feature eating itself."""
    for path in ("/api/v1/support-sessions",
                 "/api/v1/support-sessions/requests"):
        assert R._support_path_allowed(
            path, tuple(R.SUPPORT_REQUESTABLE_MODULES), "POST"
        ) is False, path
        assert R._support_path_allowed(
            path, tuple(R.SUPPORT_REQUESTABLE_MODULES), "GET"
        ) is False, path
    for prefix in R.CROSS_ORG_HEADER_PREFIXES:
        assert not path.startswith(prefix)
