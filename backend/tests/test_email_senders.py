"""WHICH ADDRESS DOES THIS MESSAGE LEAVE FROM.

`services/email_senders.py` turns a notification purpose into a From header.
This file proves the four things that can go wrong with that, and they are four
different failures with four different costs:

  1. THE FALLBACK. An org with no configured senders — which is every org today,
     against a database where migration 110 is not applied — must send exactly
     as it does now. There are five separate ways to reach the fallback and each
     is pinned separately, because they fail independently and a test that only
     asserts "an unconfigured org gets FROM_EMAIL" passes while four of the five
     are broken.

  2. THE VOCABULARY. Migration 110's CHECK and `SENDER_PURPOSES` are one
     contract spelled in two files. A disagreement is SILENT: a row filed under
     a purpose the resolver does not know is not a wrong From, it is no From at
     all — the org configured an address, the settings screen shows it, and
     every message still leaves as FROM_EMAIL.

  3. THE MAP. A notification whose purpose is not in `_BUCKET` sends from
     FROM_EMAIL, which is safe and is also invisible. The AST scan below is what
     makes it visible.

  4. THE THREAD BOUNDARY. `outbound.py`'s "WHOSE SEND WAS IT" essay applies
     unchanged: the org lives in a ContextVar, `send_email` hands the message to
     a plain `threading.Thread`, and a read from inside that thread returns None
     without raising or warning. The wrong version of this feature passes every
     pure test in this file and sends every message from FROM_EMAIL in
     production.

── WHY THE SCANS USE AST AND NOT grep ───────────────────────────────────────

Four times this week a check in this repo decided something from its own
commentary. `services/email_senders.py` explains itself in a docstring that
contains the string `purpose="…"`, and `_BUCKET`'s keys are quoted lowercase
strings in exactly the shape a grep for a purpose literal collects. A regex over
that file would find its own explanation and pass.

`ast.parse` cannot see a comment at all, and a docstring is a `Constant`
expression statement rather than a keyword argument — so `_purposes_in_source`
below is immune to the failure by construction rather than by remembering to
strip anything. The one scan that MUST read raw text is the migration's CHECK
list, and that file's header names all nine purposes in prose; it strips comment
lines first and there is a test that proves the strip works.

── AND WHY THE ALLOWED SETS ARE WRITTEN OUT LITERALLY ───────────────────────

`EXPECTED_PURPOSES` below repeats the nine values rather than importing them.
A test that asserts `SENDER_PURPOSES == SENDER_PURPOSES` is a test that agrees
with itself; a tenth value added to the module without a migration has to fail
here, and it can only fail against a list written by hand.
"""

import ast
import asyncio
import pathlib
import re
import threading
from email.utils import parseaddr

import pytest

import outbound
from services import email_senders as es


# ── THE NINE, WRITTEN OUT BY HAND ────────────────────────────────────────────
# Not imported, not derived, not sorted. The owner provisioned nine addresses on
# unicodegroup.com and these are their local parts. A tenth entry in
# SENDER_PURPOSES means a tenth mailbox exists and has been verified with the
# provider, which is out-of-band work — so it must not be possible to add one to
# the module and to migration 110's CHECK without this line failing first.
EXPECTED_PURPOSES = (
    "invoice", "sales", "payroll", "crm", "notifications",
    "attendance", "hr", "marketing", "no-reply",
)

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_MIGRATION = _BACKEND / "migrations" / "110_org_email_senders.sql"

FALLBACK = "Kartavaya <no-reply@aekaminc.com>"


@pytest.fixture(autouse=True)
def _clean_module_state():
    """Every test starts with no cache, no dormancy and no captured loop.

    All three outlive a test. A `_dormant` set by the dormancy test would make
    every later test pass for the wrong reason — silently, since dormancy's
    whole behaviour is "return the fallback and say nothing" — which is exactly
    the failure mode this module is otherwise built to avoid.
    """
    es._reset_for_tests()
    yield
    es._reset_for_tests()


# ═════════════════════════════════════════════════════════════════════════════
# 1. THE VOCABULARY IS ONE CONTRACT IN TWO FILES
# ═════════════════════════════════════════════════════════════════════════════

def test_the_nine_purposes_are_exactly_these_nine():
    assert es.SENDER_PURPOSES == EXPECTED_PURPOSES


def test_every_purpose_has_a_label_for_the_settings_screen():
    # A bucket with no label renders as a blank row on the settings form, or
    # raises KeyError in `_empty_senders` and 500s the whole screen.
    assert tuple(es.PURPOSE_LABELS) == EXPECTED_PURPOSES
    assert all(es.PURPOSE_LABELS[p].strip() for p in EXPECTED_PURPOSES)


def _sql_without_comments(text: str) -> str:
    """Drop `--` comment lines. See the header: the migration explains itself.

    Line-based rather than a lexer, and that is sound for this file: no string
    literal in 110 contains `--`. `test_the_comment_strip_actually_strips`
    proves the strip removes the prose, so a broken strip cannot let the next
    assertion pass on the header instead of the CHECK.
    """
    out = []
    for line in text.splitlines():
        stripped = line.split("--", 1)[0]
        out.append(stripped)
    return "\n".join(out)


def test_the_comment_strip_actually_strips():
    # The guard on the guard. 110's header names all nine purposes in prose, in
    # quotes, in the sentence that explains the CHECK — so if this strip stopped
    # working the next test would find them in the commentary and pass while the
    # constraint said something else entirely.
    raw = _MIGRATION.read_text(encoding="utf-8")
    # A phrase that appears ONLY in `--` prose. Not "REPUTATION": that word is
    # also inside a COMMENT ON COLUMN string literal, which is real SQL and is
    # meant to survive — asserting on it would fail a working strip.
    only_in_prose = "THE FALLBACK IS THE FEATURE"
    assert only_in_prose in raw, "expected the header prose to be present"
    stripped = _sql_without_comments(raw)
    assert only_in_prose not in stripped
    assert "CREATE TABLE IF NOT EXISTS staging.org_email_senders" in stripped


def test_migration_110_checks_exactly_the_nine_the_module_knows():
    sql = _sql_without_comments(_MIGRATION.read_text(encoding="utf-8"))
    match = re.search(
        r"org_email_senders_purpose_ck\s+CHECK\s*\(\s*purpose\s+IN\s*\((.*?)\)\s*\)",
        sql, re.S | re.I,
    )
    assert match, "migration 110 has no org_email_senders_purpose_ck"
    in_sql = tuple(re.findall(r"'([^']*)'", match.group(1)))
    # Order too, not just membership: the two lists are read side by side by
    # whoever adds the tenth address, and a set comparison would let them drift
    # into two different orders that are harder to diff by eye.
    assert in_sql == EXPECTED_PURPOSES


def test_migration_110_is_not_numbered_over_an_applied_migration():
    # 100, 102, 104 and 105 are applied; 106-109 were claimed by other agents
    # working this same tree WHILE THIS FILE WAS BEING WRITTEN, which is why
    # this ended up at 110 and why the check is worth having. Reusing a number
    # means one of the two files is skipped by whoever tracks what has run, and
    # the table is never created — which presents as "the feature does
    # nothing", the exact symptom the fallback produces on purpose.
    assert _MIGRATION.exists()
    numbers = {
        p.name.split("_", 1)[0]
        for p in (_BACKEND / "migrations").glob("[0-9][0-9][0-9]_*.sql")
    }
    assert "110" in numbers
    assert len([p for p in (_BACKEND / "migrations").glob("110_*.sql")]) == 1


# ═════════════════════════════════════════════════════════════════════════════
# 2. EVERY PURPOSE IN THE PRODUCT RESOLVES TO A BUCKET
# ═════════════════════════════════════════════════════════════════════════════

#: Purposes that legitimately have no From address, with the reason. WRITTEN OUT
#: LITERALLY rather than computed as "everything that is not email": a forbidden
#: set derived as ALL-minus-ALLOWED cannot detect the allowed set widening, and
#: the point of this list is that adding to it is a deliberate act somebody has
#: to justify in a diff.
NOT_EMAIL_PURPOSES = {
    # `services/push_service.py` and `services/expo_push_service.py` — a push
    # notification has a title, not a From header.
    "push",
    "expo",
    "web",
    # `routers/whatsapp.py` — Meta Cloud API. The sender is a phone NUMBER the
    # customer's org owns and pays Meta for, so there is no From header to
    # choose and no bucket that could choose one. Added when the send was put
    # behind the outbound gate (2026-08-17); before that WhatsApp produced no
    # purpose at all, because it produced no outbound row at all.
    "whatsapp",
}


def _purposes_in_source() -> dict[str, list[str]]:
    """Every literal notification purpose the backend can produce, by file.

    AST, not grep — see this file's header. Two shapes are collected, and they
    are the two `outbound._row` actually files a row under:

      · `purpose="payslip"`     — the explicit keyword.
      · `ref=f"payslip:{n}"`    — whose HEAD becomes the purpose when no
                                  `purpose=` is given on the same call
                                  (`purpose = purpose or head`). Collected only
                                  when `purpose` is absent, mirroring that
                                  precedence exactly, because a call carrying
                                  both is filed under the purpose and the ref's
                                  head is never used as one.

    A non-literal argument (`purpose=kind`, `ref=ref`) is skipped: its value is
    not knowable here, and guessing would produce a check that fails on
    something nobody can fix.
    """
    found: dict[str, list[str]] = {}
    skip = {"tests", "__pycache__", "scripts", "migrations", "venv", ".venv"}

    for path in _BACKEND.rglob("*.py"):
        if any(part in skip for part in path.relative_to(_BACKEND).parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        except (SyntaxError, UnicodeDecodeError):       # not ours to police
            continue

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            kwargs = {kw.arg: kw.value for kw in node.keywords if kw.arg}

            value = None
            purpose_node = kwargs.get("purpose")
            if isinstance(purpose_node, ast.Constant) and isinstance(purpose_node.value, str):
                value = purpose_node.value
            elif "purpose" not in kwargs:
                value = _ref_head(kwargs.get("ref"))

            if value:
                found.setdefault(value, []).append(
                    str(path.relative_to(_BACKEND)).replace("\\", "/")
                )
    return found


def _ref_head(node) -> str | None:
    """`f"payslip:{n}"` -> 'payslip'. None for anything not shaped like that."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        head, sep, _ = node.value.partition(":")
        return head if sep else None
    if isinstance(node, ast.JoinedStr) and node.values:
        first = node.values[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            head, sep, _ = first.value.partition(":")
            return head if sep else None
    return None


def test_the_ast_scan_finds_the_purposes_we_know_are_there():
    # The guard on the guard, again. A scan that silently found nothing — a
    # wrong root path, a walk that never matches — would make the next test pass
    # over an empty set, which is the shape of "it decided from its own
    # commentary" this repo keeps paying for.
    found = _purposes_in_source()
    for known in ("payslip", "prachar_campaign", "password_reset", "mention"):
        assert known in found, f"the scan lost {known!r}; it is in the source"
    assert len(found) >= 20, f"only {len(found)} purposes found — scan is broken"


def test_the_ast_scan_does_not_read_its_own_documentation():
    # `services/email_senders.py` contains the literal `purpose="…"` inside its
    # module docstring, and `_BUCKET`'s keys are quoted lowercase strings. A
    # grep-based scan collects both. This asserts the AST one collects NEITHER —
    # every purpose it attributes to that file must come from a real call.
    found = _purposes_in_source()
    from_the_resolver = [
        p for p, files in found.items()
        if files == ["services/email_senders.py"]
    ]
    assert from_the_resolver == [], (
        f"the scan read {from_the_resolver} out of the module that defines the "
        "map — it is matching text, not calls"
    )


def test_every_purpose_in_the_codebase_maps_to_a_sender_bucket():
    unmapped = {
        purpose: sorted(set(files))
        for purpose, files in _purposes_in_source().items()
        if es.bucket_for(purpose) is None and purpose not in NOT_EMAIL_PURPOSES
    }
    assert not unmapped, (
        "These notification purposes have no entry in "
        "`services/email_senders._BUCKET`, so every message they name will be "
        "sent from FROM_EMAIL regardless of what the org has configured. That "
        "is safe and it is silent, which is why this test exists. Add each to "
        "_BUCKET, or to NOT_EMAIL_PURPOSES with the channel it belongs to:\n"
        f"{unmapped}"
    )


def test_every_bucket_in_the_map_is_one_of_the_nine():
    # The other direction. A typo'd value on the RIGHT of `_BUCKET` resolves to
    # a bucket no row can ever be filed under, so the address is configured, the
    # screen shows it, and nothing uses it.
    strays = {k: v for k, v in es._BUCKET.items() if v not in EXPECTED_PURPOSES}
    assert not strays, strays


def test_the_buckets_with_no_sender_are_still_the_ones_we_think():
    # Not a rule, a MEASUREMENT, pinned so it is noticed when it changes. The
    # owner provisioned nine addresses; the product emails nothing that belongs
    # in two of them, because Vikray and Graha render documents and neither
    # sends. If a bucket drops off this list somebody wired up a new kind of
    # mail, which is good news that should be visible in a diff.
    #
    # 'invoice' LEFT THIS LIST on 2026-08-08 — P5 added
    # `services/invoice_email.py`, which mails the invoice with its PDF
    # attached and the pay link in the body. This test is how that showed up.
    used = set(es._BUCKET.values())
    assert set(EXPECTED_PURPOSES) - used == {"sales", "crm"}


# ═════════════════════════════════════════════════════════════════════════════
# 3. THE FIVE ROADS TO THE FALLBACK
# ═════════════════════════════════════════════════════════════════════════════
#
# `pick_from` is the pure core, and it is tested directly rather than through a
# send. THE POOL IS MOCKED IN THIS SUITE AND RESOLVES ANY TABLE NAME IT IS
# HANDED, so a test that reached the database would prove nothing about the
# decision — it would prove that a MagicMock returns a MagicMock.

VERIFIED = {"payroll": es.Sender("payroll@unicodegroup.com", "Payroll", True)}


def test_case_1_no_purpose_at_all_falls_back():
    assert es.pick_from(VERIFIED, None, FALLBACK) == FALLBACK
    assert es.pick_from(VERIFIED, "", FALLBACK) == FALLBACK


def test_case_2_a_purpose_with_no_bucket_falls_back():
    assert es.bucket_for("a_notification_shipped_next_year") is None
    assert es.pick_from(VERIFIED, "a_notification_shipped_next_year", FALLBACK) == FALLBACK


def test_case_3_the_org_has_no_row_for_that_bucket_falls_back():
    # 'prachar_campaign' resolves to 'marketing', which this org has not set.
    assert es.bucket_for("prachar_campaign") == "marketing"
    assert es.pick_from(VERIFIED, "prachar_campaign", FALLBACK) == FALLBACK
    # And the empty org — the state every org is in today.
    assert es.pick_from({}, "payslip", FALLBACK) == FALLBACK
    assert es.pick_from(None, "payslip", FALLBACK) == FALLBACK


def test_case_4_an_unverified_row_falls_back():
    # THE ONE PEOPLE WILL WANT TO REMOVE. Resend answers 403 "domain is not
    # verified" and SES answers MessageRejected, so honouring an unverified row
    # does not degrade the payslip, it deletes it.
    unverified = {"payroll": es.Sender("payroll@acme.example", "Payroll", False)}
    assert es.pick_from(unverified, "payslip", FALLBACK) == FALLBACK


def test_case_5_a_stored_value_we_cannot_put_in_a_header_falls_back():
    for bad in ("", "   ", "not-an-address", "payroll@localhost",
                "Payroll <payroll@unicodegroup.com>",
                "payroll@unicodegroup.com\nBcc: attacker@evil.example"):
        rows = {"payroll": es.Sender(bad, "Payroll", True)}
        assert es.pick_from(rows, "payslip", FALLBACK) == FALLBACK, bad


def test_a_verified_row_is_actually_used():
    # The positive. Without it every assertion above is satisfied by a function
    # that returns the fallback unconditionally.
    assert es.pick_from(VERIFIED, "payslip", FALLBACK) == \
        '"Payroll" <payroll@unicodegroup.com>'


def test_the_separation_that_matters_is_real():
    # The whole point, in one assertion: a payslip and a campaign, same org,
    # same instant, two addresses.
    rows = {
        "payroll": es.Sender("payroll@unicodegroup.com", "Payroll", True),
        "marketing": es.Sender("marketing@unicodegroup.com", None, True),
    }
    payslip = es.pick_from(rows, "payslip", FALLBACK)
    campaign = es.pick_from(rows, "prachar_campaign", FALLBACK)
    assert payslip == '"Payroll" <payroll@unicodegroup.com>'
    assert campaign == "marketing@unicodegroup.com"
    assert payslip != campaign


# ═════════════════════════════════════════════════════════════════════════════
# 4. THE HEADER IS ASSEMBLED, WHICH MEANS IT CAN BE SPLIT
# ═════════════════════════════════════════════════════════════════════════════

def test_a_display_name_cannot_smuggle_a_header():
    # `_safe_subject` exists in email_service because this hole was closed on
    # the Subject. `from_name` is now a user-editable field on a settings form
    # and lands in the same document.
    rows = {"payroll": es.Sender(
        "payroll@unicodegroup.com", "Payroll\r\nBcc: attacker@evil.example", True,
    )}
    header = es.pick_from(rows, "payslip", FALLBACK)
    assert "\r" not in header and "\n" not in header
    assert "Bcc" in header, "the text is kept — only the line break is removed"
    # And the address a receiving agent reads is still ours.
    assert parseaddr(header)[1] == "payroll@unicodegroup.com"


def test_a_display_name_cannot_escape_its_own_quotes():
    # The interesting attempt: close the quoted display name early, insert a
    # different address, and hope the parser takes it. ASSERTED WITH A REAL
    # PARSER — `email.utils.parseaddr` is what says which address a receiving
    # agent would actually read. Counting angle brackets would FAIL this working
    # code, because the injected pair survives inside the quoted string, where
    # it is inert.
    header = es.format_from("a@b.example", 'Acme" <evil@evil.example> "')
    assert parseaddr(header)[1] == "a@b.example"


def test_a_display_name_is_always_quoted_so_specials_are_legal():
    # `Unicode Group, Inc.` is an illegal RFC 5322 phrase bare and legal quoted.
    # Deciding per name whether quoting is needed is a rule with edges; always
    # quoting has none.
    assert es.format_from("a@b.example", "Unicode Group, Inc.") == \
        '"Unicode Group, Inc." <a@b.example>'


def test_no_display_name_means_the_bare_address():
    assert es.format_from("a@b.example") == "a@b.example"
    assert es.format_from("a@b.example", "   ") == "a@b.example"


def test_is_address_agrees_with_the_migration_check():
    # The router validates the form with `is_address`, migration 110 CHECKs the
    # same shape, and `pick_from` re-checks on read. Three layers only help if
    # they agree about what an address is.
    assert es.is_address("payroll@unicodegroup.com")
    assert not es.is_address("Payroll <payroll@unicodegroup.com>")
    assert not es.is_address("payroll@localhost")
    assert not es.is_address("payroll at unicodegroup.com")
    assert not es.is_address(None)


# ═════════════════════════════════════════════════════════════════════════════
# 5. THE THREAD BOUNDARY — THE FAILURE THAT LOOKS LIKE SUCCESS
# ═════════════════════════════════════════════════════════════════════════════

def _resolve_in_a_thread(plan) -> str:
    """Resolve on a REAL `threading.Thread`, which is what `send_email` uses.

    Not an executor and not inline: a plain Thread starts with an EMPTY context,
    and that emptiness is the entire thing under test.
    """
    box = {}
    thread = threading.Thread(target=lambda: box.update(value=plan.resolve()))
    thread.start()
    thread.join(timeout=5)
    assert not thread.is_alive(), "resolve() blocked — it must never hang a send"
    return box["value"]


def test_the_org_captured_on_the_calling_thread_survives_the_handoff():
    es._remember("11111111-1111-1111-1111-111111111111", dict(VERIFIED))
    with outbound.org_scope("11111111-1111-1111-1111-111111111111"):
        plan = es.plan("payslip", FALLBACK)
    # The scope is gone before the thread even starts, exactly as it is for a
    # send whose request has already returned.
    assert _resolve_in_a_thread(plan) == '"Payroll" <payroll@unicodegroup.com>'


def test_a_plan_made_inside_the_sending_thread_finds_no_org():
    # THE WRONG VERSION OF THIS FEATURE. It passes every pure test above and
    # sends every message from FROM_EMAIL in production, silently, because a
    # ContextVar read from a plain Thread returns its default rather than
    # raising. Pinned as a fact so that "just build the plan where you need it"
    # fails here instead of in a payroll run.
    es._remember("22222222-2222-2222-2222-222222222222", dict(VERIFIED))
    box = {}

    def _late():
        box["value"] = es.plan("payslip", FALLBACK).resolve()

    with outbound.org_scope("22222222-2222-2222-2222-222222222222"):
        thread = threading.Thread(target=_late)
        thread.start()
        thread.join(timeout=5)

    assert box["value"] == FALLBACK


def test_no_org_context_falls_back_rather_than_guessing():
    es._remember("33333333-3333-3333-3333-333333333333", dict(VERIFIED))
    plan = es.plan("payslip", FALLBACK)          # no org_scope anywhere
    assert _resolve_in_a_thread(plan) == FALLBACK


def test_an_explicit_org_beats_the_context():
    # `send_report_email` runs from the report cron, where there is no request
    # underneath and the org is a local variable. Same rule, same spelling, as
    # `outbound.begin(org_id=…)`.
    es._remember("44444444-4444-4444-4444-444444444444", dict(VERIFIED))
    with outbound.org_scope("55555555-5555-5555-5555-555555555555"):
        plan = es.plan("payslip", FALLBACK,
                       org_id="44444444-4444-4444-4444-444444444444")
    assert _resolve_in_a_thread(plan) == '"Payroll" <payroll@unicodegroup.com>'


def test_resolve_on_the_event_loop_returns_rather_than_deadlocks():
    """Blocking on a future submitted to the loop you are running on hangs.

    This cannot happen through `send_email`, whose resolve is inside a thread.
    It can happen through any future caller that resolves inline from async
    code, and the cost would not be a wrong From — it would be a wedged worker.
    """
    async def _go():
        # A cold cache, so `resolve()` must decide whether to do I/O.
        plan = es.plan("payslip", FALLBACK,
                       org_id="66666666-6666-6666-6666-666666666666")
        return plan.resolve()

    assert asyncio.run(asyncio.wait_for(_go(), timeout=5)) == FALLBACK


# ═════════════════════════════════════════════════════════════════════════════
# 6. THE TABLE IS NOT APPLIED, AND THAT MUST COST ONE WARNING AND NOTHING ELSE
# ═════════════════════════════════════════════════════════════════════════════

class _Undefined(Exception):
    sqlstate = "42P01"


class _Down(Exception):
    sqlstate = "08006"          # connection_failure — transient


def _pool_that_raises(exc):
    class _Pool:
        async def fetch(self, *a, **k):
            raise exc
    async def _get_pool():
        return _Pool()
    return _get_pool


def test_a_missing_table_goes_dormant_and_stops_asking(monkeypatch):
    import db
    calls = {"n": 0}

    class _Pool:
        async def fetch(self, *a, **k):
            calls["n"] += 1
            raise _Undefined()

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(db, "get_pool", _get_pool)

    assert asyncio.run(es.load("77777777-7777-7777-7777-777777777777")) == {}
    assert es._dormant is True
    # A SECOND org must not produce a second query. Migration 110 is a file that
    # is not applied; a retry per send is a failing query per email for ever.
    assert asyncio.run(es.load("88888888-8888-8888-8888-888888888888")) == {}
    assert calls["n"] == 1


def test_a_database_merely_being_down_does_not_disable_the_feature(monkeypatch):
    import db
    monkeypatch.setattr(db, "get_pool", _pool_that_raises(_Down()))
    assert asyncio.run(es.load("99999999-9999-9999-9999-999999999999")) == {}
    # NOT dormant: a blip must not switch per-purpose senders off until the next
    # redeploy. And not cached either, so the next send retries.
    assert es._dormant is False
    assert es._cached("99999999-9999-9999-9999-999999999999") is None


def test_a_row_under_an_unknown_purpose_is_dropped_not_used(monkeypatch):
    import db

    class _Pool:
        async def fetch(self, *a, **k):
            return [
                {"purpose": "payroll", "from_email": "p@u.example",
                 "from_name": None, "is_verified": True},
                # Only reachable if 110's CHECK is missing or has been widened
                # without SENDER_PURPOSES. It must not become a bucket.
                {"purpose": "billing", "from_email": "b@u.example",
                 "from_name": None, "is_verified": True},
            ]

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(db, "get_pool", _get_pool)
    loaded = asyncio.run(es.load("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"))
    assert set(loaded) == {"payroll"}


def test_invalidate_drops_only_the_org_that_saved(monkeypatch):
    es._remember("org-a", dict(VERIFIED))
    es._remember("org-b", dict(VERIFIED))
    es.invalidate("org-a")
    assert es._cached("org-a") is None
    assert es._cached("org-b") is not None


# ═════════════════════════════════════════════════════════════════════════════
# 7. send_email ACTUALLY USES IT
# ═════════════════════════════════════════════════════════════════════════════
#
# Everything above proves the decision. This proves the decision reaches the
# provider call — which is a separate failure, and the one that makes all of the
# above decorative.

class _FakeResend:
    def __init__(self):
        self.params = None
        self.sent = threading.Event()

    class _Emails:
        def __init__(self, outer):
            self.outer = outer

        def send(self, params):
            self.outer.params = params
            self.outer.sent.set()
            return {"id": "re_test"}

    @property
    def Emails(self):
        return self._Emails(self)


@pytest.fixture
def _live_resend(monkeypatch):
    """A send that is not suppressed and does not touch a real provider.

    `conftest` sets `OUTBOUND_MODE=dry` and it must stay set — nothing in this
    suite may be able to deliver. `outbound.DRY_RUN` is read at call time
    precisely "so a test may patch it" (outbound.py:340), which is the one
    supported way to exercise the code past the gate.
    """
    import email_service
    fake = _FakeResend()
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    monkeypatch.setattr(email_service, "_resend_client", fake)
    monkeypatch.setattr(email_service, "ses_client", None)
    return fake


def test_send_email_puts_the_resolved_address_in_the_from(_live_resend):
    import email_service
    es._remember("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", {
        "payroll": es.Sender("payroll@unicodegroup.com", "Unicode Payroll", True),
    })
    with outbound.org_scope("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"):
        email_service.send_email("e@example.com", "Payslip", "<p>hi</p>",
                                 purpose="payslip")
    assert _live_resend.sent.wait(timeout=5), "the sending thread never ran"
    assert _live_resend.params["from"] == '"Unicode Payroll" <payroll@unicodegroup.com>'


def test_send_email_falls_back_for_an_org_that_configured_nothing(_live_resend):
    import email_service
    es._remember("cccccccc-cccc-cccc-cccc-cccccccccccc", {})
    with outbound.org_scope("cccccccc-cccc-cccc-cccc-cccccccccccc"):
        email_service.send_email("e@example.com", "Payslip", "<p>hi</p>",
                                 purpose="payslip")
    assert _live_resend.sent.wait(timeout=5)
    # THE STATE EVERY ORG IS IN TODAY. This is the assertion that says the
    # change is safe to deploy against an unmigrated database.
    assert _live_resend.params["from"] == email_service.FROM_EMAIL


def test_send_email_derives_the_purpose_from_a_ref_when_none_is_given(_live_resend):
    # `outbound._row` files the log row under the ref's head when no purpose is
    # passed. The From must agree with the log row, or the address and the audit
    # trail describe two different messages.
    import email_service
    es._remember("dddddddd-dddd-dddd-dddd-dddddddddddd", {
        "payroll": es.Sender("payroll@unicodegroup.com", None, True),
    })
    with outbound.org_scope("dddddddd-dddd-dddd-dddd-dddddddddddd"):
        email_service.send_email("e@example.com", "Payslip", "<p>hi</p>",
                                 ref="payslip:PS-2026-08-42")
    assert _live_resend.sent.wait(timeout=5)
    assert _live_resend.params["from"] == "payroll@unicodegroup.com"


def test_a_suppressed_send_resolves_nothing(_live_resend, monkeypatch):
    # OUTBOUND_MODE=dry returns before the provider is touched, and it must also
    # return before any lookup: a message that is not being sent has no From,
    # and a database round-trip for one would be work on the request path for a
    # send that is not happening.
    import email_service
    monkeypatch.setattr(outbound, "DRY_RUN", True)
    email_service.send_email("e@example.com", "Payslip", "<p>hi</p>",
                             purpose="payslip")
    assert not _live_resend.sent.wait(timeout=0.5)
