"""THE FOUR MIGRATIONS IN THE 111-115 RANGE, PINNED TO A HAND-WRITTEN SHAPE.

These four files create tables that nothing in the backend reads yet. That is
the condition under which a schema drifts silently: there is no import to break,
no endpoint to 500, no test that exercises a column. The first thing that will
notice a wrong default is a customer.

So this file is the reader. It parses the `.sql` and compares what it finds to
literals written out BY HAND below — never to a value imported from the same
file, and never to a value derived from the SQL it is checking. A test that
computes both sides of its own assertion agrees with itself.

── WHAT EACH SECTION IS ACTUALLY GUARDING ───────────────────────────────────

1. THE FILE SET. Four files, four distinct numbers, none of them reusing a
   number that already exists. Two agents worked this tree at once and 106-109
   were claimed while `test_email_senders.py` was being written — that file
   carries the same check for the same reason. A reused number means one of the
   two files is skipped by whoever tracks what has run, and its table is never
   created, which presents as "the feature does nothing".

2. THE COLUMN SETS. Written out in full. A column added to a table nothing reads
   is invisible until it is wrong; a column REMOVED is worse, because the
   endpoint that was written against the migration will 42703 at runtime.

3. THE VOCABULARIES. Every CHECK...IN list, in order. `access_level` admitting
   'admin' is a support agent with god mode. `source` admitting a third value is
   a compliance record whose provenance nobody can explain. These are the lists
   that must not widen by accident.

4. THE DEFAULTS. This is the section that matters most and it is the reason the
   file exists. `pahchan_policy` shipped three report toggles defaulting TRUE
   with nothing behind them, and every org that never opened the screen was
   recorded as wanting three summaries that do not exist (migration 106). Every
   boolean default across all four files is enumerated by hand below with the
   argument for its value. A future author who flips one has to edit this list,
   and editing this list is where they meet the argument.

5. THE ABSENCES. Three things are deliberately NOT in these files and each would
   look like an improvement to somebody:
     · a `status` column on `platform_support_sessions` — a stored status is a
       cache of a clock and goes stale in the permissive direction;
     · `delivery_channel` / `reminder_every_days` on `sign_documents` — no
       WhatsApp sender and no reminder job exist, so both would be 106 again;
     · a consent-shaped column on the DPDP acknowledgement — the notice is not
       a consent form and a schema that says consent invites a screen that asks
       for it.
   An absence cannot break a build. It has to be asserted or it is not enforced.

── WHY THE PARSER IS QUOTE-AWARE AND NOT A grep ─────────────────────────────

Every one of these files explains itself at length in `--` prose, and that prose
quotes the very identifiers, defaults and CHECK lists being asserted — 111's
header contains the string "status TEXT CHECK (status IN ('pending','active',
'expired','revoked'))" inside the paragraph arguing AGAINST having one. A grep
for a status column finds that sentence and fails a correct file; a grep for
`DEFAULT TRUE` finds it in four headers.

So `_executable_sql` below cuts the file at the last `COMMIT;` (everything after
is verification queries and rollback notes), then strips `--` comments with a
scanner that knows what a string literal is. `test_the_comment_strip_actually_
strips` is the guard on the guard: it names a phrase that appears ONLY in prose
and proves it is gone, and names one inside a `COMMENT ON ... IS` string literal
and proves that one SURVIVES, because that is real SQL and stripping it would
make every other assertion here vacuous.
"""

import pathlib
import re

import pytest

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_MIGRATIONS = _BACKEND / "migrations"

# ── THE FOUR, WRITTEN OUT BY HAND ────────────────────────────────────────────
# Not globbed, not sorted, not derived. 115 is deliberately absent — the range
# 111-115 was assigned and only four files were needed, and a fifth appearing
# here without a line in this tuple is a file nobody in this run wrote.
EXPECTED_FILES = {
    111: "111_platform_support_sessions.sql",
    112: "112_hub_skill_requests.sql",
    113: "113_pahchan_notice_acknowledgements.sql",
    114: "114_esign_field_placement.sql",
}


# ═════════════════════════════════════════════════════════════════════════════
# The parser
# ═════════════════════════════════════════════════════════════════════════════

def _strip_line_comments(text: str) -> str:
    """Remove `--` comments without touching string literals.

    Line-based would be wrong here: `COMMENT ON COLUMN ... IS '... e-mail --
    something ...'` is legal and these files do contain hyphens inside quoted
    prose. The scanner tracks whether it is inside a single-quoted literal and
    only treats `--` as a comment when it is not.
    """
    out = []
    for line in text.splitlines():
        buf = []
        in_str = False
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "'":
                # '' inside a literal is an escaped quote, not a close-then-open;
                # either reading leaves `in_str` correct here, but be explicit.
                if in_str and i + 1 < len(line) and line[i + 1] == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_str = not in_str
                buf.append(ch)
            elif ch == "-" and not in_str and line.startswith("--", i):
                break
            else:
                buf.append(ch)
            i += 1
        out.append("".join(buf))
    return "\n".join(out)


def _executable_sql(name: str) -> str:
    """Everything the database would actually run, and nothing else.

    Two cuts. First at the last `COMMIT;` — every one of these files ends with a
    RUN AFTER COMMIT block of verification queries and a commented rollback, all
    of it prose from the database's point of view. Then the `--` strip.
    """
    raw = (_MIGRATIONS / name).read_text(encoding="utf-8")
    idx = raw.rfind("\nCOMMIT;")
    assert idx > 0, f"{name} has no COMMIT — it is not a transactional migration"
    return _strip_line_comments(raw[: idx + len("\nCOMMIT;")])


def _raw(name: str) -> str:
    return (_MIGRATIONS / name).read_text(encoding="utf-8")


def _create_table_body(sql: str, table: str) -> str:
    """The parenthesised body of `CREATE TABLE ... staging.<table> (...)`."""
    m = re.search(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?staging\.%s\s*\(" % re.escape(table),
        sql, re.I,
    )
    assert m, f"no CREATE TABLE for staging.{table}"
    i = m.end() - 1
    depth = 0
    in_str = False
    for j in range(i, len(sql)):
        ch = sql[j]
        if ch == "'":
            in_str = not in_str
        elif not in_str:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return sql[i + 1: j]
    raise AssertionError(f"unbalanced parentheses in CREATE TABLE staging.{table}")


def _split_top_level(body: str) -> list[str]:
    parts, cur, depth, in_str = [], [], 0, False
    for ch in body:
        if ch == "'":
            in_str = not in_str
        if not in_str:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == "," and depth == 0:
                parts.append("".join(cur).strip())
                cur = []
                continue
        cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur).strip())
    return [p for p in parts if p]


_NOT_A_COLUMN = ("CONSTRAINT", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "EXCLUDE")


def _columns_of(name: str, table: str) -> tuple[str, ...]:
    body = _create_table_body(_executable_sql(name), table)
    cols = []
    for part in _split_top_level(body):
        head = part.split()[0].upper()
        if head in _NOT_A_COLUMN:
            continue
        cols.append(part.split()[0].strip('"'))
    return tuple(cols)


def _check_list(name: str, column: str) -> tuple[str, ...]:
    """The values of a `CHECK (<column> IN (...))` anywhere in executable SQL."""
    sql = _executable_sql(name)
    m = re.search(
        r"CHECK\s*\(\s*%s\s+IN\s*\((.*?)\)\s*\)" % re.escape(column), sql, re.S | re.I
    )
    assert m, f"{name}: no CHECK ({column} IN (...))"
    return tuple(v.strip() for v in re.findall(r"'([^']*)'|(-?\d+)", m.group(1))
                 for v in [v[0] or v[1]])


# ═════════════════════════════════════════════════════════════════════════════
# 0. THE GUARD ON THE GUARD
# ═════════════════════════════════════════════════════════════════════════════

def test_the_comment_strip_actually_strips():
    """Prose goes, `COMMENT ON ... IS` string literals stay.

    Both halves. A strip that removed the COMMENT bodies too would make the
    column-set assertions below pass against a file whose comments had been
    deleted; a strip that removed nothing would make the ABSENCE assertions pass
    against a file that had grown the very column they forbid.
    """
    raw = _raw("111_platform_support_sessions.sql")
    only_in_prose = "THE MEASUREMENT THAT MAKES THIS SAFE TO SHIP"
    assert only_in_prose in raw
    stripped = _executable_sql("111_platform_support_sessions.sql")
    assert only_in_prose not in stripped

    # This one is inside a COMMENT ON TABLE literal — real SQL, must survive.
    assert "THERE IS DELIBERATELY NO status COLUMN" in stripped
    assert "CREATE TABLE IF NOT EXISTS staging.platform_support_sessions" in stripped


def test_the_column_parser_finds_what_is_there_and_not_what_is_quoted():
    # 111's header quotes a `status TEXT CHECK (...)` definition in the paragraph
    # arguing against having one. If the parser were a regex over raw text it
    # would report a `status` column on a correct file.
    assert "status TEXT CHECK" in _raw("111_platform_support_sessions.sql")
    assert "status" not in _columns_of(
        "111_platform_support_sessions.sql", "platform_support_sessions"
    )


# ═════════════════════════════════════════════════════════════════════════════
# 1. THE FILE SET
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("number,filename", sorted(EXPECTED_FILES.items()))
def test_each_migration_exists_exactly_once(number, filename):
    assert (_MIGRATIONS / filename).exists(), f"{filename} is missing"
    same_number = list(_MIGRATIONS.glob(f"{number}_*.sql"))
    assert len(same_number) == 1, (
        f"{number} is claimed by {len(same_number)} files: "
        f"{[p.name for p in same_number]}. Reusing a number means one of them is "
        f"skipped by whoever tracks what has run."
    )


def test_no_migration_in_this_range_shadows_an_earlier_number():
    numbered = {}
    for p in _MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"):
        numbered.setdefault(p.name.split("_", 1)[0], []).append(p.name)
    dupes = {k: v for k, v in numbered.items() if len(v) > 1}
    assert not dupes, f"duplicate migration numbers: {dupes}"


@pytest.mark.parametrize("filename", sorted(EXPECTED_FILES.values()))
def test_every_file_says_it_is_a_production_change_and_is_not_auto_applied(filename):
    """The sentence is the safety rail, and it is load-bearing.

    There is ONE `staging` schema and production writes to it too, so a reader
    who assumes "staging" means "the safe one" applies a production change. Every
    file in this repo since 093 carries the sentence; a new one that does not is
    the one that gets applied casually.
    """
    raw = _raw(filename)
    assert "ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO" in raw
    assert "NOT APPLIED" in raw
    assert "no application code applies it" in raw


@pytest.mark.parametrize("filename", sorted(EXPECTED_FILES.values()))
def test_every_file_bounds_the_locks_it_takes(filename):
    """`SET LOCAL lock_timeout` on anything that takes a lock — and all four do.

    Every one of these files touches a live relation, at minimum through a
    foreign key's ShareRowExclusiveLock on `staging.organisations`, which is read
    on nearly every request. Without a timeout the ALTER queues behind any open
    long transaction and takes the table's readers with it; with one, the bad
    case is a clean rollback.
    """
    sql = _executable_sql(filename)
    assert re.search(r"SET\s+LOCAL\s+lock_timeout", sql, re.I), filename
    assert re.search(r"SET\s+LOCAL\s+statement_timeout", sql, re.I), filename
    assert sql.lstrip().upper().startswith("BEGIN"), filename


@pytest.mark.parametrize("filename", sorted(EXPECTED_FILES.values()))
def test_no_file_in_this_range_rewrites_data(filename):
    """All four are schema-only, which is why none of them carries a
    wrong-database guard. If one ever gains an UPDATE or a DELETE it needs the
    guard block that 105 carries, and this test is where that gets noticed."""
    sql = _executable_sql(filename)
    for verb in (r"\bUPDATE\s+staging\.", r"\bDELETE\s+FROM\b", r"\bDROP\s+TABLE\b",
                 r"\bTRUNCATE\b", r"\bINSERT\s+INTO\s+staging\."):
        assert not re.search(verb, sql, re.I), (
            f"{filename} contains {verb} in executable SQL. A data-rewriting "
            f"migration needs a guard that refuses the wrong database — see "
            f"105_unicode_demo_safe_emails.sql."
        )


# ═════════════════════════════════════════════════════════════════════════════
# 2. THE COLUMN SETS, IN ORDER
# ═════════════════════════════════════════════════════════════════════════════

PSS_COLUMNS = (
    "id", "ref", "org_id", "requested_by", "reason", "modules", "access_level",
    "requested_ttl_hours", "requested_at",
    "approved_by", "approved_at", "granted_ttl_hours", "expires_at",
    "owner_emailed_at",
    "denied_by", "denied_at", "denial_reason",
    "revoked_by", "revoked_at", "revoked_by_party",
)

HSR_COLUMNS = (
    "id", "org_id", "template_id", "requested_by", "note", "status",
    "requested_at", "decided_at", "decided_by", "notified_to", "updated_at",
)

PNA_COLUMNS = (
    "id", "org_id", "user_id", "employee_id", "notice_version",
    "acknowledged_at", "recorded_at", "source", "was_offline",
)

SF_COLUMNS = (
    "id", "document_id", "org_id", "signer_id", "page", "kind",
    "top_pct", "left_pct", "width_pct", "height_pct",
    "required", "value", "filled_at", "created_at", "updated_at",
)


def test_platform_support_sessions_columns():
    assert _columns_of(
        "111_platform_support_sessions.sql", "platform_support_sessions"
    ) == PSS_COLUMNS


def test_hub_skill_requests_columns():
    assert _columns_of("112_hub_skill_requests.sql", "hub_skill_requests") == HSR_COLUMNS


def test_pahchan_notice_acknowledgement_columns():
    assert _columns_of(
        "113_pahchan_notice_acknowledgements.sql", "pahchan_notice_acknowledgements"
    ) == PNA_COLUMNS


def test_sign_fields_columns():
    assert _columns_of("114_esign_field_placement.sql", "sign_fields") == SF_COLUMNS


def test_no_position_column_needs_quoting():
    """`left` is a reserved word. A column called `left` needs double quotes in
    every query, migration and ORDER BY for the life of the table, and the first
    one that forgets is a syntax error at runtime — in a router, not here."""
    for col in SF_COLUMNS:
        assert col.lower() not in {"left", "right", "order", "user", "table",
                                   "column", "default", "check", "all", "end"}, col


# ═════════════════════════════════════════════════════════════════════════════
# 3. THE VOCABULARIES
# ═════════════════════════════════════════════════════════════════════════════
#
# Order matters, not just membership. These lists are read side by side with the
# Python that validates against them, and a set comparison lets the two drift
# into different orders that are harder to diff by eye.

def test_a_support_agent_can_never_be_granted_admin():
    """RBAC-SPEC:19 caps a support session below admin, and the CHECK is the
    enforcement point. `subscription.PLATFORM_MODULE_LEVEL` is ADMIN; the whole
    purpose of a session is to NARROW that. A third value here is the feature
    inverted."""
    assert _check_list("111_platform_support_sessions.sql", "access_level") == (
        "viewer", "editor",
    )


def test_the_four_durations_are_rbac_specs_four():
    """2 hours / 24 hours / 7 days / until revoked. 0 is 'until revoked' and is
    the ONLY value that yields a NULL expires_at on an approved row."""
    expected = ("0", "2", "24", "168")
    assert _check_list("111_platform_support_sessions.sql", "requested_ttl_hours") == expected
    assert _check_list("111_platform_support_sessions.sql", "granted_ttl_hours") == expected


def test_who_can_end_a_support_session():
    assert _check_list("111_platform_support_sessions.sql", "revoked_by_party") == (
        "customer", "aekam", "self",
    )


def test_skill_request_states():
    assert _check_list("112_hub_skill_requests.sql", "status") == (
        "open", "granted", "declined", "withdrawn",
    )


def test_notice_acknowledgement_sources():
    """Two surfaces serve the notice and there are exactly two. A third value
    means a compliance record whose provenance nobody can explain."""
    assert _check_list("113_pahchan_notice_acknowledgements.sql", "source") == (
        "web", "mobile",
    )


def test_the_five_field_kinds_the_prototype_draws():
    """`ScreensThin.jsx:421-423` — Signature, Initials, Date, Text, Checkbox.
    Stored lowercase, like every other CHECKed vocabulary in this schema, so the
    table cannot end up holding both 'Signature' and 'signature'."""
    assert _check_list("114_esign_field_placement.sql", "kind") == (
        "signature", "initials", "date", "text", "checkbox",
    )


# ═════════════════════════════════════════════════════════════════════════════
# 4. THE DEFAULTS
# ═════════════════════════════════════════════════════════════════════════════

#: EVERY boolean default across all four files, with the argument for its value.
#: Written out by hand. `pahchan_policy` shipped `report_daily DEFAULT true` with
#: no sender behind it and every org that never opened the screen was recorded as
#: wanting a summary that does not exist (migration 106). Flipping one of these
#: means editing this list, and editing this list is where the argument is.
EXPECTED_BOOLEAN_DEFAULTS = {
    # 113 — did this row arrive late off a phone that was offline? FALSE is the
    # ordinary case; a row that lies about being an offline sync would make the
    # two-clock discrepancy unreadable.
    ("113_pahchan_notice_acknowledgements.sql", "was_offline"): "FALSE",
    # 114 — a field somebody deliberately placed is required unless they say
    # otherwise. Only reachable on a placed field, so it grants nothing by
    # omission.
    ("114_esign_field_placement.sql", "required"): "TRUE",
    # 114 — OTP is UNCONDITIONAL today (esign.py:499 computes it as
    # `not otp_verified`, no per-document opt-out). TRUE reproduces exactly
    # today's behaviour on all 75 existing documents; FALSE would silently drop
    # identity verification on every signature in flight.
    ("114_esign_field_placement.sql", "otp_required"): "TRUE",
}

_BOOL_DEFAULT = re.compile(
    r"(?:ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)?"
    r"\b(\w+)\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+(TRUE|FALSE)\b",
    re.I,
)


def test_every_boolean_default_is_one_somebody_argued_for():
    found = {}
    for filename in EXPECTED_FILES.values():
        for col, val in _BOOL_DEFAULT.findall(_executable_sql(filename)):
            found[(filename, col)] = val.upper()
    assert found == EXPECTED_BOOLEAN_DEFAULTS, (
        "A boolean default changed, appeared or disappeared. Read migration 106 "
        "before editing the expected map: a default that changes what the "
        "product tells a customer it will do is nobody's default."
    )


def test_nothing_grants_access_by_omission():
    """111's defaults, the ones that decide what an unattended row can reach.

    The most permissive row this table can produce by accident must reach zero
    modules, as a viewer, for the shortest window, unapproved.
    """
    sql = _executable_sql("111_platform_support_sessions.sql")
    assert re.search(r"modules\s+TEXT\[\]\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'", sql, re.I)
    assert re.search(r"access_level\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'viewer'", sql, re.I)
    assert re.search(r"requested_ttl_hours\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+2", sql, re.I)
    # And the grant half has NO default at all — it is set only by an approval.
    assert not re.search(r"granted_ttl_hours\s+INTEGER\s+DEFAULT", sql, re.I)
    assert not re.search(r"expires_at\s+TIMESTAMPTZ\s+DEFAULT", sql, re.I)


def test_no_skill_gains_a_price_and_none_claims_to_need_nothing():
    """The two columns 112 adds to a table with 19 live rows.

    `setup_fee_paise DEFAULT 0` — any other number invents a charge for nineteen
    skills nobody has priced. `permissions` NULLABLE WITH NO DEFAULT — NULL means
    "not stated"; `'{}'` would mean "stated: this skill needs nothing", which is
    a claim about nineteen skills nobody has audited.
    """
    sql = _executable_sql("112_hub_skill_requests.sql")
    assert re.search(
        r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+setup_fee_paise\s+INTEGER\s+"
        r"NOT\s+NULL\s+DEFAULT\s+0\b", sql, re.I,
    )
    m = re.search(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+permissions\s+JSONB([^;]*)", sql, re.I)
    assert m, "112 does not add hub_skill_templates.permissions"
    assert "DEFAULT" not in m.group(1).upper()
    assert "NOT NULL" not in m.group(1).upper()


def test_the_acknowledgement_has_two_clocks_and_only_one_of_them_defaults():
    """The device clock is stated by the client; the server clock is the
    server's. A default on `acknowledged_at` would let the server invent the
    instant a person was served a notice, which is the only fact this table
    exists to record."""
    sql = _executable_sql("113_pahchan_notice_acknowledgements.sql")
    assert re.search(r"acknowledged_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s*,", sql, re.I), (
        "acknowledged_at must be NOT NULL with NO default"
    )
    assert re.search(r"recorded_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)", sql, re.I)


# ═════════════════════════════════════════════════════════════════════════════
# 5. THE ABSENCES
# ═════════════════════════════════════════════════════════════════════════════

def test_a_support_session_has_no_stored_status():
    """INVARIANT (b). Authorisation reads a live SQL predicate, never a stored
    state column and never a sweeper's output.

    A `status` column says 'active' until something writes 'expired'. A sweeper
    that is late, failed, was never deployed or gets dropped in a refactor leaves
    a session reading 'active' three days after it ended — and nothing looks
    wrong, because the table looks fine.
    """
    cols = _columns_of("111_platform_support_sessions.sql", "platform_support_sessions")
    for forbidden in ("status", "state", "is_active", "active"):
        assert forbidden not in cols, (
            f"platform_support_sessions grew a `{forbidden}` column. State is "
            f"derived from the timestamps by staging.v_active_support_sessions."
        )


def test_the_active_predicate_exists_and_carries_all_four_clauses():
    """The one place the authorisation predicate is written. A caller that
    re-derives it will drift, and the drift is permissive — a forgotten
    `AND revoked_at IS NULL` is an access grant nobody can take back."""
    sql = _executable_sql("111_platform_support_sessions.sql")
    m = re.search(
        r"CREATE\s+OR\s+REPLACE\s+VIEW\s+staging\.v_active_support_sessions(.*?);",
        sql, re.S | re.I,
    )
    assert m, "111 does not create staging.v_active_support_sessions"
    view = m.group(1)
    assert "security_invoker" in view, (
        "the view must not become a way around RLS if PROPOSED_081 is ever applied"
    )
    for clause in ("approved_at IS NOT NULL", "denied_at   IS NULL",
                   "revoked_at  IS NULL", "expires_at > NOW()"):
        assert clause in view, f"the active predicate is missing `{clause}`"


def test_no_send_option_is_offered_that_nothing_can_honour():
    """114 deliberately does NOT create `delivery_channel` or a reminder cadence.

    There is no path that sends a document to a named signer's phone —
    `routers/whatsapp.py:169-193` INSERTs a row as 'pending' behind a `TODO: Call
    Meta Cloud API` and nothing sends it — and there is no eSign reminder job.
    A column with 'whatsapp' in its CHECK, a picker that offers it, and nothing
    that delivers, is `pahchan_policy.report_daily DEFAULT true` rebuilt.

    The DDL for both IS in the file, below the final COMMIT, commented, for the
    day a sender exists. That is why this asserts on executable SQL only.
    """
    sql = _executable_sql("114_esign_field_placement.sql")
    for forbidden in ("delivery_channel", "reminder_every_days",
                      "reminder_last_sent_at"):
        assert forbidden not in sql, (
            f"114 now creates `{forbidden}`. Nothing honours it — read the "
            f"DELIBERATELY ABSENT section at the foot of that file."
        )
    # But the argument, and the exact DDL, must still be there for whoever adds
    # the sender. An absence with no note is indistinguishable from an omission.
    raw = _raw("114_esign_field_placement.sql")
    assert "DELIBERATELY ABSENT" in raw
    assert "delivery_channel" in raw


def test_the_dpdp_record_has_no_consent_shaped_column():
    """The notice is a notice, not a consent form — attendance is processed as a
    legitimate use for employment. A schema that says `consent` invites a screen
    that asks for it, and a person who can say no to a notice they are legally
    owed is being offered a choice that does not exist.

    And there is no boolean `acknowledged` column: THE ABSENCE OF A ROW MEANS
    NOT ACKNOWLEDGED. A boolean with a default is a way for a row to exist
    saying yes on somebody's behalf.
    """
    cols = _columns_of(
        "113_pahchan_notice_acknowledgements.sql", "pahchan_notice_acknowledgements"
    )
    for forbidden in ("consent", "consented", "agreed", "opted_in", "opt_in",
                      "accepted", "acknowledged"):
        assert forbidden not in cols, (
            f"the DPDP acknowledgement grew a `{forbidden}` column"
        )


def test_the_notice_version_is_not_pinned_to_a_list():
    """A CHECK constraining `notice_version` would make a copy edit a database
    migration, which guarantees that one day the copy ships and the CHECK does
    not — and then nobody can acknowledge the notice they were shown."""
    sql = _executable_sql("113_pahchan_notice_acknowledgements.sql")
    assert not re.search(r"CHECK\s*\(\s*notice_version\s+IN\s*\(", sql, re.I)
    # It is still required to say something.
    assert re.search(r"notice_version\s+TEXT\s+NOT\s+NULL", sql, re.I)


# ═════════════════════════════════════════════════════════════════════════════
# 6. THE INVARIANTS THAT ARE CONSTRAINTS RATHER THAN COMMENTS
# ═════════════════════════════════════════════════════════════════════════════

#: Named constraints each file must carry. A constraint that is described in a
#: header and not written is the most expensive kind of comment: the header is
#: read as a guarantee by whoever writes the endpoint.
EXPECTED_CONSTRAINTS = {
    "111_platform_support_sessions.sql": (
        "pss_reason_is_substantive",
        "pss_not_both_approved_and_denied",
        "pss_approver_pairs",
        "pss_denier_pairs",
        "pss_revoker_pairs",
        "pss_approval_and_owner_email_are_one_act",
        "pss_approval_states_its_duration",
        "pss_expiry_matches_granted_ttl",
        "pss_revocation_needs_an_approval",
        "pss_decision_after_request",
        "pss_revocation_after_approval",
    ),
    "112_hub_skill_requests.sql": (
        "hsr_open_is_exactly_undecided",
        "hsr_decider_pairs",
        "hsr_decision_after_request",
        "hub_skill_templates_setup_fee_non_negative",
    ),
    "114_esign_field_placement.sql": (
        "sign_documents_id_org_uq",
        "sign_fields_document_fk",
        "sign_fields_within_page",
        "sign_fields_fill_pairs",
        "sign_fields_signature_value_lives_on_the_signer",
    ),
}


@pytest.mark.parametrize("filename", sorted(EXPECTED_CONSTRAINTS))
def test_the_named_constraints_are_all_declared(filename):
    sql = _executable_sql(filename)
    declared = set(re.findall(r"CONSTRAINT\s+(\w+)", sql, re.I))
    missing = [c for c in EXPECTED_CONSTRAINTS[filename] if c not in declared]
    assert not missing, f"{filename} is missing constraints: {missing}"


def test_an_approval_cannot_be_committed_without_the_owner_being_told():
    """INVARIANT (c), as DDL rather than as a try/except somebody can reorder.

    `approved_at` and `owner_emailed_at` are NULL together or NOT NULL together.
    Send first, then write both in one statement. Note that
    `email_service.send_email` returns True on THREAD HANDOFF and is worthless as
    delivery evidence — `staging.outbound_log` is the record.
    """
    sql = _executable_sql("111_platform_support_sessions.sql")
    m = re.search(
        r"CONSTRAINT\s+pss_approval_and_owner_email_are_one_act\s+CHECK\s*\((.*?)\)\s*,",
        sql, re.S | re.I,
    )
    assert m, "the owner-email invariant is not a constraint"
    body = " ".join(m.group(1).split())
    assert body == "(approved_at IS NULL) = (owner_emailed_at IS NULL)", body


def test_a_skill_request_cannot_be_pressed_twice_into_two_leads():
    """Idempotency as a partial unique index, not as application logic.

    In Python, two clicks race and the account contact gets two emails about one
    skill. The `WHERE status = 'open'` is what lets a declined request be asked
    again later.
    """
    sql = _executable_sql("112_hub_skill_requests.sql")
    m = re.search(
        r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_hub_skill_requests_one_open"
        r"\s+ON\s+staging\.hub_skill_requests\s*\((.*?)\)\s*WHERE\s+([^;]+);",
        sql, re.S | re.I,
    )
    assert m, "112 has no one-open-request index"
    assert " ".join(m.group(1).split()) == "org_id, template_id"
    assert " ".join(m.group(2).split()) == "status = 'open'"


def test_one_acknowledgement_per_person_per_version():
    """Also the offline sync's idempotency guarantee: a phone that retries a
    queued acknowledgement three times writes it once, and the FIRST
    acknowledged_at is kept — the one that actually preceded the photograph."""
    sql = _executable_sql("113_pahchan_notice_acknowledgements.sql")
    m = re.search(
        r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"
        r"idx_pahchan_notice_ack_person_version\s+ON\s+"
        r"staging\.pahchan_notice_acknowledgements\s*\((.*?)\)", sql, re.S | re.I,
    )
    assert m, "113 has no one-ack-per-person-per-version index"
    assert " ".join(m.group(1).split()) == "org_id, user_id, notice_version"


def test_a_field_cannot_belong_to_a_different_org_than_its_document():
    """The `org_id` column is worthless without this. A denormalised tenant key
    maintained only by application code drifts the first time a write path
    forgets, and the drift is invisible until somebody reads another tenant's
    data. The composite FK needs `sign_documents_id_org_uq` as its target, which
    is why that otherwise-redundant UNIQUE exists."""
    sql = _executable_sql("114_esign_field_placement.sql")
    m = re.search(
        r"CONSTRAINT\s+sign_fields_document_fk\s+FOREIGN\s+KEY\s*\((.*?)\)\s*"
        r"REFERENCES\s+staging\.sign_documents\s*\((.*?)\)", sql, re.S | re.I,
    )
    assert m, "sign_fields has no composite foreign key to (id, org_id)"
    assert " ".join(m.group(1).split()) == "document_id, org_id"
    assert " ".join(m.group(2).split()) == "id, org_id"
    assert re.search(
        r"ADD\s+CONSTRAINT\s+sign_documents_id_org_uq\s+UNIQUE\s*\(\s*id\s*,\s*org_id\s*\)",
        sql, re.I,
    ), "the composite FK's target UNIQUE is not created"


def test_a_signature_image_has_exactly_one_home():
    """Signature and initials fields render from `sign_signers.signature_data`,
    which the audit trail and the completion certificate already reference. Two
    copies of a signature image is two answers to "what did they sign"."""
    sql = _executable_sql("114_esign_field_placement.sql")
    m = re.search(
        r"CONSTRAINT\s+sign_fields_signature_value_lives_on_the_signer\s+"
        r"CHECK\s*\((.*?)\)\s*\)", sql, re.S | re.I,
    )
    assert m, "nothing stops a signature image being typed into sign_fields.value"
    body = " ".join(m.group(1).split())
    assert "signature" in body and "initials" in body and "value IS NULL" in body


# ═════════════════════════════════════════════════════════════════════════════
# 7. EVERY FILE SAYS HOW TO PROVE IT WORKED
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("filename", sorted(EXPECTED_FILES.values()))
def test_every_file_carries_verification_and_rollback(filename):
    """House style since 105: a header that says WHY and WHAT IT COSTS, a
    RUN AFTER COMMIT block that proves it worked, and a rollback.

    The verification block is the part that gets skipped, and it is the part
    that matters: three of these four files claim the apply is INERT — no
    account gains anything, no skill gains a price, no document loses its OTP —
    and a claim like that has to come with the query that demonstrates it.
    """
    raw = _raw(filename)
    assert "RUN AFTER COMMIT" in raw, filename
    assert "ROLLBACK" in raw, filename
    assert "LOCKS" in raw, filename
    assert "DELIBERATELY DOES NOT DO" in raw or "DELIBERATELY ABSENT" in raw, filename
