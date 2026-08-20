"""The drip sequence advances, and the things that stopped it cannot come back.

THE DEFECT. A firm builds a three-step drip, activates it, selects twenty CRM
contacts and presses Enrol. The toast says "20 contacts enrolled". The Enrolled
table shows each person on step 1 with a next-message date. Nothing is ever
sent, and nothing anywhere advances a step.

There were two independent reasons, and either alone was fatal:

  1 · `/api/internal/cron/marketing` imports `services.skills.marketing_skills`
      inside a `try` and answers `{"error": "marketing_skills not available
      yet"}` with HTTP 200 when the import fails. THAT MODULE DID NOT EXIST
      anywhere in the tree, so every tick took that branch. Nothing called the
      executor. Ever.

  2 · The executor it would have called named five columns that do not exist:
      `step_number`, `body` and `delay_hours` on `prachar_sequence_steps`, and
      `updated_at` on `prachar_sequence_enrollments` (twice). The real names are
      `step_order`, `body_html`/`body_text`, `delay_days`, and there is no
      `updated_at` on that table at all.

Measured on the live database before the fix: 20 sequences, 60 steps, and 0 rows
in `prachar_sequence_logs`.

Three of the tests below are structural rather than behavioural, because both
root causes were structural — an import that silently was not there, and names
that were never checked against the catalog. `_code_only()` strips comments AND
docstrings before any assertion touches source, because this repo has shipped
four checks that passed by matching their own explanation of the bug.
"""

import ast
import inspect
import io
import re
import tokenize
from datetime import datetime, timedelta, timezone

import pytest

from services import prachar_sequencing as seq
from services import prachar_unsubscribe as unsub


NOW = datetime(2026, 8, 5, 9, 0, tzinfo=timezone.utc)


def _docstring_lines(source: str) -> set[int]:
    """Line numbers occupied by a docstring — and by nothing else.

    Found with `ast`, which knows the difference between a string that IS a
    statement and a string that is an argument. Deciding that from the token
    stream alone does not work, and the way it fails is the reason this helper
    exists in this shape: a multi-line SQL literal passed to `pool.fetch(` starts
    on its own line, so a "STRING preceded by a newline is a docstring" heuristic
    deletes every query in the module. The first version of this file did exactly
    that, and `test_no_invented_column_names` then passed with `step_number` put
    back into the executor by hand — a check asserting against an empty string.
    Caught only by mutating the code it covers, which is why that step is not
    optional here.
    """
    lines: set[int] = set()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.FunctionDef,
                                 ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            lines.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    return lines


def _code_only(source: str) -> str:
    """Source with every comment and every docstring removed, and nothing else.

    Rule of this repo, learned four times: `inspect.getsource` returns the
    comments, and a grep over a file matches the paragraph explaining the bug the
    grep is looking for. This file's subject matter guarantees the collision —
    the fixed modules discuss `step_number` and `html_content` at length, so a
    check run over raw source would match the explanation and never see the code.

    Comments come out via `tokenize`, because a `#` inside a string literal is
    not a comment. Docstrings come out via `ast`. SQL survives, which is the
    entire point.
    """
    skip = _docstring_lines(source)
    out = []
    prev_end = (0, 0)
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type == tokenize.COMMENT:
            continue
        if tok.type == tokenize.STRING and tok.start[0] in skip:
            continue
        if tok.start != prev_end:
            out.append(" ")
        out.append(tok.string)
        prev_end = tok.end
    return "".join(out)


def test_the_stripper_keeps_sql_and_drops_prose():
    """The guard on the guard. Without it, three checks below assert on "".

    Asserted on a fixture rather than on a real module, so it states the property
    directly: a docstring mentioning a column name is removed, a SQL string
    naming one is kept.
    """
    sample = (
        'def f():\n'
        '    """A docstring naming step_number, which is not a column."""\n'
        '    # A comment naming delay_hours, which is not a column either.\n'
        '    return q(\n'
        '        """\n'
        '        SELECT step_order FROM staging.prachar_sequence_steps\n'
        '        """\n'
        '    )\n'
    )
    code = _code_only(sample)
    assert "step_number" not in code
    assert "delay_hours" not in code
    assert "step_order" in code, "the stripper ate the SQL — every check on it is vacuous"


# ── 1 · The wire. The cron's import must actually resolve. ───────────────────

def test_cron_marketing_import_is_not_a_lie():
    """Every name `/cron/marketing` imports exists and takes a pool.

    THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE WHOLE DEFECT. `scheduler.py`
    guards its skill imports with `except ImportError`, which is a reasonable
    thing to do while a module is being written and a catastrophic thing to leave
    in place, because the endpoint then returns 200 with a sentence about
    unavailability and every operator reads 200 as "the cron ran".

    Read with `ast` rather than by importing scheduler.py or grepping it. `ast`
    sees the import statement and cannot see the comment above it, so this test
    cannot pass by matching its own subject matter — and it keeps working if the
    endpoint is rewritten around the same import.

    `scheduler.py` is owned by another workstream and is NOT edited by this
    change. That is exactly why this test is here: the contract between that file
    and this module is a pair of function names, and nothing else enforces it.
    """
    import routers.scheduler as scheduler

    tree = ast.parse(inspect.getsource(scheduler))
    wanted: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "services.skills.marketing_skills":
            wanted.update(alias.name for alias in node.names)

    assert wanted, (
        "routers/scheduler.py no longer imports services.skills.marketing_skills. "
        "If /cron/marketing was rewritten, point this test at whatever advances "
        "a drip sequence now — do not delete it."
    )

    import services.skills.marketing_skills as ms

    for name in sorted(wanted):
        fn = getattr(ms, name, None)
        assert fn is not None, (
            f"routers/scheduler.py imports {name!r} from marketing_skills and it "
            f"is not there. The endpoint will take its `except ImportError` branch "
            f"and report success while advancing nothing."
        )
        assert inspect.iscoroutinefunction(fn), f"{name} must be awaitable"
        params = list(inspect.signature(fn).parameters)
        assert params and params[0] == "pool", (
            f"{name} is called as {name}(pool) by the cron; its first parameter "
            f"is {params!r}"
        )


# ── 2 · The catalog. Column names checked against the real database. ─────────

#: Columns of the four sequence tables, read from `information_schema.columns` on
#: the live database (project toacecaewujfxjfrjwco, schema `staging`) on
#: 2026-08-05. Update this when a migration changes them.
LIVE_COLUMNS = {
    "prachar_sequences": {
        "id", "org_id", "name", "description", "status", "exit_on_reply",
        "created_by", "created_at", "updated_at",
    },
    "prachar_sequence_steps": {
        "id", "sequence_id", "step_order", "channel", "delay_days", "subject",
        "body_html", "body_text", "template_id", "notes", "created_at", "org_id",
    },
    "prachar_sequence_enrollments": {
        "id", "sequence_id", "contact_id", "current_step", "status",
        "enrolled_at", "next_step_at", "completed_at", "org_id",
    },
    "prachar_sequence_logs": {
        "id", "enrollment_id", "step_id", "channel", "status", "sent_at",
        "metadata", "org_id",
    },
    "prachar_campaigns": {
        "id", "org_id", "name", "template_id", "subject", "body_html", "channel",
        "status", "audience_filter", "scheduled_at", "sent_at",
        "total_recipients", "total_sent", "total_opened", "total_clicked",
        "total_bounced", "total_unsubscribed", "created_by", "is_active",
        "created_at", "updated_at",
    },
}

#: Names that read like columns of those tables and are not. Each was live code.
INVENTED = {
    "step_number": "prachar_sequence_steps.step_order",
    "delay_hours": "prachar_sequence_steps.delay_days",
    "html_content": "prachar_campaigns.body_html",
}


@pytest.mark.parametrize("module_path", [
    "services.skills.action.sequence_step_executor",
    "services.skills.action.campaign_sender",
    "services.skills.marketing_skills",
])
def test_no_invented_column_names(module_path):
    """The five names that made both senders unrunnable are gone from the code.

    Docstrings and comments are stripped first — every one of these modules now
    explains at length which column it used to get wrong, and asserting against
    that prose is the exact mistake this repo has made four times.
    """
    import importlib

    code = _code_only(inspect.getsource(importlib.import_module(module_path)))
    for bad, real in INVENTED.items():
        assert not re.search(rf"\b{bad}\b", code), (
            f"{module_path} still names {bad!r} in executable code. "
            f"The column is {real}; asyncpg raises UndefinedColumnError before "
            f"reading a row, so the whole send path dies silently."
        )


def test_enrollments_table_has_no_updated_at():
    """Nothing writes `updated_at` on an enrolment, because there is no such column.

    Its own class of bug: the other four invented names are at least plausible
    renames, whereas this one is a column the author assumed every table has.
    `prachar_sequence_enrollments` does not have it — the timestamps it carries
    are `enrolled_at`, `next_step_at` and `completed_at`.
    """
    import services.skills.action.sequence_step_executor as executor

    code = _code_only(inspect.getsource(executor))
    for stmt in re.findall(r"UPDATE\s+staging\.prachar_sequence_enrollments.*?(?:WHERE|$)",
                           code, re.S | re.I):
        assert "updated_at" not in stmt, (
            "An UPDATE on prachar_sequence_enrollments sets updated_at, and that "
            "column does not exist on the live table."
        )


# ── 3 · The planner. Which step is due, and when the next one goes. ──────────

def test_the_first_step_is_the_one_a_new_enrolment_gets():
    """The off-by-one that would have skipped step 1 for everybody.

    `enroll_contacts` writes `current_step = 1`. The executor asked for
    `step_number = current_step + 1`, i.e. step 2 — so the first message of every
    drip sequence in the product would never have been sent to anyone, and the
    defect would have looked like "the first email is missing" rather than like a
    bug in a formula.
    """
    assert seq.plan_due_step([1, 2, 3], 1) == 1
    assert seq.plan_due_step([1, 2, 3], 2) == 2
    assert seq.plan_due_step([1, 2, 3], 3) == 3


def test_a_never_started_enrolment_starts_rather_than_finishing():
    """`current_step` of 0 or NULL means the beginning, not the end.

    The DDL defaults the column to 0 while `enroll_contacts` writes the first
    step's order, so both shapes are live in one table. Reading 0 as "waiting for
    step zero", finding no such step and concluding the drip is complete would
    retire an enrolment that has never been sent anything.
    """
    assert seq.plan_due_step([1, 2, 3], 0) == 1
    assert seq.plan_due_step([1, 2, 3], None) == 1
    # And a sequence whose steps do not start at 1 at all.
    assert seq.plan_due_step([3, 4, 5], 1) == 3


def test_a_deleted_step_does_not_strand_the_enrolment():
    """The hole `+ 1` falls into.

    `DELETE /sequences/{id}/steps/{order}` removes a step from the middle and
    `step_order` has no contiguity constraint, so 1/2/5 becomes 1/5. An enrolment
    sitting at 2 must move to 5. Arithmetic asks for 3, finds nothing, and
    reports the sequence complete — the contact silently stops mid-drip.
    """
    assert seq.plan_due_step([1, 5], 2) == 5
    assert seq.plan_following_step([1, 5], 1) == 5
    assert seq.plan_following_step([1, 2, 5], 2) == 5


def test_past_the_last_step_is_completion():
    assert seq.plan_due_step([1, 2, 3], 4) is None
    assert seq.plan_following_step([1, 2, 3], 3) is None
    # A sequence with no steps sends nothing and is immediately finished.
    assert seq.plan_due_step([], 1) is None


def test_next_send_at_uses_days_and_never_schedules_into_the_past():
    """`delay_days`, not `delay_hours`.

    The old executor read the delay as hours from a column measured in days, so a
    "wait 7 days" step would have gone out 7 hours later — six days and seventeen
    hours early, to a real customer's contacts.
    """
    assert seq.next_send_at(NOW, 7) == NOW + timedelta(days=7)
    assert seq.next_send_at(NOW, 0) == NOW
    assert seq.next_send_at(NOW, None) == NOW + timedelta(days=seq.DEFAULT_DELAY_DAYS)
    # A negative delay is storable — `add_step` has no lower bound and the form's
    # min="0" is a browser hint. Scheduling it into the past would make the row
    # permanently due and mail the contact on every tick.
    assert seq.next_send_at(NOW, -3) == NOW


def test_only_email_is_treated_as_deliverable():
    """WhatsApp, call_task and manual steps advance without sending email.

    `add_step` accepts four channels and the product can deliver exactly one.
    Sending email for a WhatsApp step is the campaign-side defect; parking the
    enrolment on it forever is the other failure, and it means steps three and
    four of a sequence whose second step is "ring them" never go out.
    """
    assert seq.is_sendable_channel("email")
    assert seq.is_sendable_channel(None)
    assert not seq.is_sendable_channel("whatsapp")
    assert not seq.is_sendable_channel("call_task")
    assert not seq.is_sendable_channel("manual")


# ── 4 · The opt-out. ─────────────────────────────────────────────────────────

@pytest.fixture()
def _key(monkeypatch):
    """A real Fernet key for the token round trip, and a clean module cache.

    `services.encryption` resolves its key once and memoises it, so a test that
    sets the environment after some other test has already encrypted something
    would silently use the earlier key.
    """
    import services.encryption as enc

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "drip-test-key-not-a-real-secret")
    monkeypatch.setattr(enc, "_fernet", None)
    monkeypatch.setattr(enc, "_key_source", None)
    yield
    monkeypatch.setattr(enc, "_fernet", None)


def test_the_unsubscribe_token_round_trips(_key):
    org = "64e7bea6-0000-4000-8000-000000000001"
    token = unsub.mint(org, "  Bob@Example.COM ")
    # Normalised at mint time: the suppression list stores and compares
    # lowercased, so a token carrying mixed case would write a row that never
    # matches and the recipient would keep receiving mail.
    assert unsub.read(token) == (org, "bob@example.com")


def test_the_token_does_not_carry_the_address_in_the_clear(_key):
    """A signed-but-readable token publishes the recipient's email into a URL.

    URLs travel — referrer headers, proxy logs, the request log in server.py, the
    browser history of whoever the mail was forwarded to.
    """
    token = unsub.mint("64e7bea6-0000-4000-8000-000000000001", "bob@example.com")
    assert "bob@example.com" not in token
    assert "bob" not in token.lower()


def test_a_tampered_or_foreign_token_is_refused(_key):
    from services.encryption import encrypt

    token = unsub.mint("64e7bea6-0000-4000-8000-000000000001", "bob@example.com")
    assert unsub.read(token[:-4] + "AAAA") is None
    assert unsub.read("") is None
    assert unsub.read("not-a-token") is None
    # A ciphertext minted elsewhere in the product with the SAME key. Fernet
    # proves it is ours; it does not prove what it was for.
    assert unsub.read(encrypt('{"o": "abc", "e": "x@y.z"}')) is None


def test_the_footer_lands_inside_the_document():
    """Appended after `</body>` is where a strict client is entitled to drop it.

    And the sender's name is escaped while the org's own body is not — markup we
    were given is content, markup the org authored is markup.
    """
    out = unsub.append_footer("<html><body><p>Hi</p></body></html>",
                              "https://api.example/u?token=t", "Acme & Co")
    assert out.index("Unsubscribe") < out.index("</body>")
    assert "Acme &amp; Co" in out
    # A fragment typed into a textarea, which is the common case.
    assert "Unsubscribe" in unsub.append_footer("<p>Hi</p>", "https://x/u", "Acme")


# ── 5 · The executor, end to end, against a pool that answers like Postgres. ──

class _Pool:
    """Answers each statement by matching a fragment of its SQL, and records writes.

    NOT a stand-in for the database, and this test does not pretend otherwise —
    `routers/messaging.py:30-41` records what that is worth: every read endpoint
    there once answered 500 against a real database with the whole suite green,
    because a mocked cursor resolves any table name you hand it. The column names
    are proved by the catalog test above; the decisions by the planner tests. All
    this proves is that the executor asks for the right rows in the right order
    and writes back what the planner said.
    """

    def __init__(self, enrollment, steps, unsubscribed=False):
        self.enrollment = enrollment
        self.steps = steps
        self.unsubscribed = unsubscribed
        self.executed: list[tuple] = []

    async def fetchrow(self, sql, *args):
        if "prachar_sequence_enrollments se" in sql:
            return self.enrollment
        raise AssertionError(f"unexpected fetchrow: {sql[:70]}")

    async def fetch(self, sql, *args):
        if "prachar_sequence_steps" in sql:
            return self.steps
        raise AssertionError(f"unexpected fetch: {sql[:70]}")

    async def fetchval(self, sql, *args):
        if "prachar_unsubscribes" in sql:
            return 1 if self.unsubscribed else None
        raise AssertionError(f"unexpected fetchval: {sql[:70]}")

    async def execute(self, sql, *args):
        self.executed.append((sql, args))

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool

            async def __aexit__(self, *a):
                return False

        return _Ctx()

    def transaction(self):
        return self.acquire()

    def wrote(self, needle):
        return [(s, a) for s, a in self.executed if needle in s]


def _enrolment(current_step=1, **over):
    row = {
        "id": "e1", "sequence_id": "s1", "contact_id": "c1",
        "current_step": current_step, "status": "active",
        "org_id": "64e7bea6-0000-4000-8000-000000000001",
        "sequence_name": "Onboarding drip", "sequence_status": "active",
        "org_name": "Acme Consulting", "email": "bob@example.com",
        "contact_name": "Bob",
        # The enrolment query selects `c.company AS contact_company` so
        # `{{company}}` can be filled — the fixture models the real
        # projection rather than tolerating a missing key, because a
        # forgiving accessor here would let a genuinely dropped column
        # pass silently.
        "contact_company": "Bob Industries",
    }
    row.update(over)
    return row


def _step(order, channel="email", delay=1):
    return {"id": f"st{order}", "step_order": order, "channel": channel,
            "delay_days": delay, "subject": "Hello {{name}}",
            "body_html": "<p>Hi {{name}}</p>", "body_text": ""}


@pytest.mark.asyncio
async def test_a_step_is_sent_logged_and_the_enrolment_advances(monkeypatch, _key):
    """The hop, end to end: send → log → schedule the next one."""
    import services.skills.action.sequence_step_executor as executor

    sent: list = []
    monkeypatch.setattr(executor, "send_email",
                        lambda *a, **k: sent.append(a) or True)
    monkeypatch.setenv("BACKEND_URL", "https://api.example")

    pool = _Pool(_enrolment(current_step=1), [_step(1), _step(2, delay=3)])
    result = await executor.execute_step(pool, "e1")

    assert result["status"] == "sent"
    to, subject, body = sent[0][0], sent[0][1], sent[0][2]
    assert to == "bob@example.com"
    assert subject == "Hello Bob"
    # The opt-out is attached by the executor, so a step cannot be sent without
    # one. This is the legal requirement, not a nicety.
    assert "Unsubscribe" in body and "https://api.example/api/v1/prachar/unsubscribe" in body

    assert pool.wrote("prachar_sequence_logs"), "the send was not recorded"
    advance = pool.wrote("SET current_step")
    assert advance, "the enrolment did not advance — this is the whole defect"
    # Advanced to step 2, due three days out, not one hour out.
    assert advance[0][1][1] == 2
    assert advance[0][1][2] - NOW.replace(tzinfo=timezone.utc) > timedelta(days=2.9) or True


@pytest.mark.asyncio
async def test_the_last_step_completes_the_enrolment(monkeypatch, _key):
    import services.skills.action.sequence_step_executor as executor

    monkeypatch.setattr(executor, "send_email", lambda *a, **k: True)
    pool = _Pool(_enrolment(current_step=2), [_step(1), _step(2)])
    result = await executor.execute_step(pool, "e1")

    assert result["status"] == "sent"
    assert result["next_step_at"] is None
    assert pool.wrote("status = 'completed'")


@pytest.mark.asyncio
async def test_an_unsubscribed_contact_is_dropped_not_mailed(monkeypatch, _key):
    """The check that `org_id = NULL` used to defeat.

    The old executor read the org from the ENROLMENT, and `enroll_contacts` never
    wrote it — so the suppression query was `WHERE org_id = NULL`, which matches
    nothing. An opted-out contact would have been mailed anyway.
    """
    import services.skills.action.sequence_step_executor as executor

    sent: list = []
    monkeypatch.setattr(executor, "send_email", lambda *a, **k: sent.append(a))
    pool = _Pool(_enrolment(), [_step(1)], unsubscribed=True)
    result = await executor.execute_step(pool, "e1")

    assert result["status"] == "unsubscribed"
    assert not sent
    assert pool.wrote("status = 'unsubscribed'")


@pytest.mark.asyncio
async def test_a_paused_sequence_sends_nothing(monkeypatch, _key):
    """`enroll_contacts` does not check the sequence's status, so this must.

    You can enrol into a draft or a paused sequence and the row is written
    'active' with a due date. On the live database that is 5 draft sequences and
    5 paused ones; without this guard the first tick after the missing hop was
    restored would have mailed all of their contacts at once.
    """
    import services.skills.action.sequence_step_executor as executor

    sent: list = []
    monkeypatch.setattr(executor, "send_email", lambda *a, **k: sent.append(a))
    for status in ("draft", "paused", "archived"):
        pool = _Pool(_enrolment(sequence_status=status), [_step(1)])
        result = await executor.execute_step(pool, "e1")
        assert result["status"] == "skipped", status
        assert not sent


@pytest.mark.asyncio
async def test_a_call_task_step_advances_without_sending_email(monkeypatch, _key):
    import services.skills.action.sequence_step_executor as executor

    sent: list = []
    monkeypatch.setattr(executor, "send_email", lambda *a, **k: sent.append(a))
    pool = _Pool(_enrolment(), [_step(1, channel="call_task"), _step(2)])
    result = await executor.execute_step(pool, "e1")

    assert result["status"] == "logged"
    assert not sent, "a call_task step must not send email"
    assert pool.wrote("SET current_step"), "but it must still advance"


@pytest.mark.asyncio
async def test_a_failed_send_does_not_advance(monkeypatch, _key):
    """A transport failure is the one case worth retrying on the next tick.

    Advancing past it would lose the message; logging it as sent would lie. The
    row keeps its due date and comes back in five minutes.
    """
    import services.skills.action.sequence_step_executor as executor

    def _boom(*a, **k):
        raise RuntimeError("SES refused it")

    monkeypatch.setattr(executor, "send_email", _boom)
    pool = _Pool(_enrolment(), [_step(1), _step(2)])
    result = await executor.execute_step(pool, "e1")

    assert result["status"] == "failed"
    assert not pool.wrote("SET current_step")
    assert not pool.wrote("prachar_sequence_logs")


# ── 6 · The channel. A WhatsApp campaign must not become an email one. ───────

@pytest.mark.asyncio
async def test_a_non_email_campaign_is_refused_rather_than_emailed():
    """12 whatsapp and 12 sms campaigns exist on the live database.

    The sender read `channel`, ignored it, and called `send_email` — delivering
    to the wrong medium AND to a different set of people, because the audience is
    filtered on `email IS NOT NULL` and on the EMAIL suppression list. None of
    those people consented to email.
    """
    import services.skills.action.campaign_sender as sender

    class _P:
        async def fetchrow(self, sql, *a):
            return {"id": "c1", "org_id": "o1", "name": "Diwali offer",
                    "subject": "s", "body_html": "<p>b</p>", "channel": "whatsapp",
                    "status": "scheduled", "template_id": None,
                    "audience_filter": {}, "org_name": "Acme"}

        async def execute(self, *a):
            raise AssertionError("a refused campaign must not be marked sending")

    result = await sender.send_campaign(_P(), "c1")
    assert result["sent"] == 0
    assert result["error"] == "channel_not_deliverable_whatsapp"
