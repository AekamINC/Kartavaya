"""The ICAI advertising gate: client-vs-prospect, the classes, and the linter.

WHAT THESE TESTS ARE PROTECTING.

Clause (6), Part I, First Schedule to the Chartered Accountants Act 1949 makes
soliciting a prospect professional misconduct, and the Code of Ethics in force
from 1 April 2026 names EMAIL among the prohibited means. The exposure is the
member's — Aekam Inc is not an ICAI member; the partner who presses Send is.

Measured on the live database, 21 August 2026, before any of this existed:

    291 active non-merged contacts, 165 of them linked to a client
    104 active campaigns; 95 resolve an audience containing at least one
        non-client; 8,796 non-client recipient-slots across them all
    122 recipient rows already written, 34 of them against contacts with no
        client_id, 31 of those claiming delivery

So this is not a theoretical control. The product has already mailed 31 people
the firm does not act for, and every campaign on the list was pointed at more.

The two things most likely to rot, and therefore the things most of these tests
are about:

  1. the default flipping — `client_only` absent must mean ON, for ever;
  2. the sourced/inferred distinction being flattened into "compliance says no".
     Which rules the Institute states and which we reasoned is the most
     important fact in this programme, and a later reader must not have to
     re-derive it.
"""
import inspect
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

import routers.prachar as prachar
from services import prachar_compliance as pc


# ── 1. The default. If one test in this file survives, make it this one. ─────

def test_the_client_gate_is_on_when_nothing_says_otherwise():
    # 80 of the 104 live campaigns hold `{}`. If absence ever stops meaning ON,
    # all 80 silently widen to include prospects and nothing on any screen says
    # so — the campaigns do not change, the meaning underneath them does.
    assert prachar.client_only({}) is True
    assert prachar.client_only(None) is True
    assert prachar.client_only({"type": "customer"}) is True
    assert prachar.CLIENT_ONLY_DEFAULT is True


def test_the_gate_can_be_turned_off_but_only_by_saying_so():
    assert prachar.client_only({"client_only": False}) is False
    assert prachar.client_only({"client_only": True}) is True


def test_the_default_is_not_written_into_the_stored_filter():
    # `norm({}) == {}` is asserted in test_prachar_audience.py too, and it must
    # keep holding: the gate is a READING of an absent key, not a key injected
    # on the way in. Injecting it would rewrite 80 stored filters the first time
    # anybody opened them, and a stored `client_only: true` is indistinguishable
    # from one an operator chose.
    assert prachar.normalise_audience_filter({}) == {}
    assert prachar.normalise_audience_filter(None) is None


@pytest.mark.parametrize("given,expected", [
    (True, True), (False, False),
    ("true", True), ("false", False),
    ("True", True), ("FALSE", False),
    ("yes", True), ("no", False),
    (1, True), (0, False),
])
def test_client_only_survives_the_shapes_a_form_actually_sends(given, expected):
    # A checkbox posts a string; JSON posts a bool; a stored filter that went
    # through PgBouncer without the jsonb codec comes back as text. `False` is
    # the value that must survive, because it is the only way to express "include
    # people who are not clients" — and the two "means do not filter" tests in
    # the normaliser run before this branch.
    assert prachar.normalise_audience_filter(
        {"client_only": given}) == {"client_only": expected}


def test_a_client_only_value_that_is_neither_is_refused_out_loud():
    with pytest.raises(HTTPException) as exc:
        prachar.normalise_audience_filter({"client_only": "maybe"})
    assert exc.value.status_code == 400
    assert "true or false" in exc.value.detail


def test_client_only_is_a_recognised_filter_key():
    assert "client_only" in prachar.AUDIENCE_FILTER_KEYS
    # And the refusal for an unknown key still names all of them, so a typo is
    # answered with the whole vocabulary rather than half of it.
    with pytest.raises(HTTPException) as exc:
        prachar.normalise_audience_filter({"typo": 1})
    assert "client_only" in exc.value.detail


# ── 2. The gate is in the SQL, and in the one place everything shares ────────

def _body(fn) -> str:
    """Source with the docstring removed — the docstrings here talk about the
    very clauses being asserted, so parsing them asserts against our own prose.
    Same technique, same reason, as test_prachar_audience.py."""
    src = inspect.getsource(fn)
    doc = inspect.getdoc(fn)
    if doc:
        start = src.find('"""')
        if start != -1:
            end = src.find('"""', start + 3)
            if end != -1:
                return src[:start] + src[end + 3:]
    return src


def test_the_resolver_carries_the_client_predicate():
    src = _body(prachar._resolve_audience)
    assert "client_id IS NOT NULL" in src, (
        "the audience resolver no longer filters on client linkage, so every "
        "campaign in the product reaches prospects again"
    )
    assert "client_only(" in src, (
        "the resolver no longer asks the shared `client_only` helper, so the "
        "query and the summary sentence can now describe different audiences"
    )


def test_the_resolver_projects_the_linkage_for_the_evidence_row():
    # `/send` stamps client_id per recipient. Re-reading it there would be a
    # second query answering a question this one already answered — and, worse,
    # a second query could disagree with the first.
    assert "client_id" in _body(prachar._resolve_audience)


class _FakePool:
    """Records the SQL it is asked for. Enough pool for the resolver."""

    def __init__(self, rows=None):
        self.rows = rows if rows is not None else []
        self.queries = []

    async def fetch(self, q, *args):
        self.queries.append((q, args))
        return self.rows


async def test_the_gate_clause_is_present_by_default_and_absent_when_waived():
    pool = _FakePool()
    await prachar._resolve_audience(pool, "org-1", {})
    assert "client_id IS NOT NULL" in pool.queries[0][0]

    pool = _FakePool()
    await prachar._resolve_audience(pool, "org-1", {"client_only": False})
    assert "client_id IS NOT NULL" not in pool.queries[0][0], (
        "an explicit client_only=false must actually widen the query — "
        "otherwise the override path can never be exercised and the block "
        "below is unreachable"
    )


async def test_send_and_the_preview_still_share_the_one_resolver():
    # Restated here rather than only in test_prachar_audience.py because the
    # gate now lives INSIDE that resolver: a second resolver would be a second
    # gate, and the one that gets forgotten is whichever nobody clicks.
    for fn in (prachar.preview_audience, prachar.send_campaign,
               prachar.preview_audience_filter):
        assert "_resolve_audience(" in inspect.getsource(fn)


# ── 3. The block itself ──────────────────────────────────────────────────────

C = {"id": "1", "email": "a@example.com", "client_id": "cli-1"}
P = {"id": "2", "email": "b@example.com", "client_id": None}
GREETING = pc.TEMPLATE_CLASSES["greeting"]

GOOD_BASIS = "Former client of eleven years who wrote asking to be re-added."


def test_an_all_client_audience_is_permitted_whatever_the_class():
    v = pc.assess_send(contacts=[C, C], template_class=None)
    assert v.allowed is True
    assert v.code == "allowed_clients_only"
    assert v.non_client_count == 0
    # Unclassified is fine HERE on purpose: every permitted class in this file
    # is a basis for writing to a client, so the class cannot change the answer.
    # Demanding one anyway would be ceremony, and ceremony is what people learn
    # to route around.


def test_one_prospect_in_the_audience_blocks_the_send():
    v = pc.assess_send(contacts=[C, C, P], template_class=GREETING)
    assert v.allowed is False
    assert v.non_client_count == 1
    assert v.client_count == 2
    # The refusal has to be actionable: the count, the class, and the citation.
    assert "1 of 3" in v.message
    assert "Clause (6)" in v.message


def test_the_block_is_a_block_and_not_a_warning():
    # The route raises rather than annotating a success. A campaign that goes
    # out with a warning attached has gone out.
    src = _body(prachar.send_campaign)
    assert "assess_send(" in src
    assert "if not verdict.allowed" in src
    assert "raise HTTPException(403" in src, (
        "the ICAI verdict no longer refuses the request — a compliance control "
        "that returns 200 is a banner, and a banner is a click"
    )


def test_an_unclassified_template_to_a_prospect_cannot_be_overridden_at_all():
    # THE SHARPEST EDGE IN THE MODULE, and it is deliberate. You may not
    # override your way past a template nobody has characterised: say what you
    # think you are sending first, then own the decision.
    v = pc.assess_send(contacts=[C, P], template_class=None,
                       override_basis=GOOD_BASIS * 3)
    assert v.allowed is False
    assert v.code == "blocked_unclassified"
    assert "compliance class" in v.message


@pytest.mark.parametrize("basis", [None, "", "   ", "ok", "approved", "-",
                                   "client asked"])
def test_a_thin_basis_is_not_a_decision(basis):
    v = pc.assess_send(contacts=[C, P], template_class=GREETING,
                       override_basis=basis)
    assert v.allowed is False
    assert v.code == "blocked_non_client"


def test_a_written_basis_clears_the_block_and_is_carried_forward():
    v = pc.assess_send(contacts=[C, P], template_class=GREETING,
                       override_basis=GOOD_BASIS)
    assert v.allowed is True
    assert v.is_override is True
    assert v.override_basis == GOOD_BASIS
    assert v.non_client_count == 1
    d = v.as_dict()
    assert d["template_class"] == "greeting"
    assert d["class_basis"] == "sourced"
    assert d["rule_key"] == pc.RULE_GREETINGS


def test_the_basis_floor_is_the_same_number_the_database_enforces():
    # Duplicated on purpose — API and CHECK constraint — so a future caller that
    # forgets the check cannot write "ok" into an audit trail. If the constant
    # moves and the migration does not, this fails.
    sql = (Path(__file__).resolve().parents[1]
           / "migrations" / "183_prachar_icai_gate.sql").read_text(encoding="utf-8")
    assert f">= {pc.MIN_OVERRIDE_BASIS_CHARS}" in sql


def test_a_contact_row_with_no_client_key_at_all_counts_as_a_prospect():
    # An absent fact is not evidence of a relationship. A row that never carried
    # the column — a fixture, a partial projection, a future caller — must fall
    # on the safe side.
    clients, prospects = pc.split_by_client_linkage([{"id": "x", "email": "e"}])
    assert clients == []
    assert len(prospects) == 1


def test_the_scheduled_door_refuses_too_and_offers_no_override():
    # `marketing_skills.process_scheduled_campaigns` selects status='scheduled'
    # and hands each campaign to `campaign_sender.send_campaign`, which never
    # passes through POST /send. This route is the only way into 'scheduled'.
    src = _body(prachar.schedule_campaign)
    assert "split_by_client_linkage(" in src
    assert "raise HTTPException(\n            403" in src or "HTTPException(\n            403" in src
    assert "icai_override_basis" not in src, (
        "scheduling must not accept an override: a scheduled send resolves its "
        "audience when the clock fires, so authorising it in advance is "
        "authorising a list nobody has seen"
    )


def test_the_drip_door_is_gated_at_enrolment():
    # A sequence is marketing email on a timer, and `/sequences/{id}/enroll`
    # takes contact ids straight from the request body — it never passes through
    # `_resolve_audience`. Without a gate here the whole control is one screen
    # away from irrelevant: enrol the prospects instead, and `/cron/marketing`
    # mails them on a five-minute tick.
    src = _body(prachar.enroll_contacts)
    assert "client_id" in src
    assert "raise HTTPException(" in src
    assert "403" in src
    # Enrolment and not send time: refusing later would leave a queue of people
    # the product intends to mail and will not, which reads as a bug on the
    # Enrolled table rather than as a refusal.
    assert "SELECT id, client_id FROM staging.graha_contacts" in src


def test_the_cron_sender_has_the_same_gate():
    # The third door. `send_campaign` is also reachable directly through
    # `services/skill_dispatcher.py`, which never passes the router at all.
    src = (Path(__file__).resolve().parents[1] / "services" / "skills"
           / "action" / "campaign_sender.py").read_text(encoding="utf-8")
    assert "gc.client_id IS NULL" in src, (
        "the scheduled sender no longer re-checks client linkage, so a campaign "
        "whose recipient rows were materialised before the gate existed can "
        "still be mailed to prospects"
    )
    assert "icai_non_client_audience" in src


# ── 4. The classes, and which of them we read versus reasoned ───────────────

def test_every_permitted_class_is_clients_only():
    # Email is push. Every permitted basis in this file is a basis for writing to
    # someone the firm already acts for. A class that reaches a non-client needs
    # its own sourced citation, not a copy of one of these.
    for cls in pc.TEMPLATE_CLASSES.values():
        if cls.permitted_by_email:
            assert cls.clients_only is True, (
                f"class '{cls.key}' claims email is permitted to a non-client")


def test_exactly_two_classes_are_inferred_and_they_are_named():
    # THE MOST IMPORTANT ASSERTION IN THIS FILE. If a later change quietly
    # relabels an inference as sourced, a member relies on a rule the Institute
    # never stated. If it relabels a sourced rule as inferred, the product
    # starts hedging about something the Code says plainly.
    inferred = {k for k, v in pc.TEMPLATE_CLASSES.items() if v.basis == pc.INFERRED}
    assert inferred == {"statutory_reminder", "knowledge_update"}

    sourced = {k for k, v in pc.TEMPLATE_CLASSES.items() if v.basis == pc.SOURCED}
    assert sourced == {"client_service", "greeting", "invitation",
                       "prospect_outreach"}


def test_an_inferred_class_says_so_in_its_own_words():
    # The word has to reach the person reading the screen, not just the enum.
    for key in ("statutory_reminder", "knowledge_update"):
        assert "INFERRED" in pc.TEMPLATE_CLASSES[key].why


def test_the_prohibited_class_exists_and_is_marked_prohibited():
    out = pc.TEMPLATE_CLASSES["prospect_outreach"]
    assert out.permitted_by_email is False
    assert out.basis == pc.SOURCED
    assert out.rule_key == pc.RULE_SOLICITATION


#: Measured on the live database, 21 August 2026, across 60 active templates.
LIVE_CATEGORIES = ("alert", "collections", "event", "general", "greeting",
                   "invite", "newsletter", "onboarding", "operations",
                   "reminder")


def test_every_live_category_maps_to_a_class_except_general():
    # `general` is deliberately unmapped: it says nothing about what the mail is,
    # and mapping it to a permitted class would invent a basis for three live
    # templates. Unclassified is the honest answer.
    for cat in LIVE_CATEGORIES:
        if cat == "general":
            assert cat not in pc.CATEGORY_TO_CLASS
        else:
            assert cat in pc.CATEGORY_TO_CLASS, (
                f"category '{cat}' exists on the live database and maps to no "
                f"class, so every template carrying it is unclassified")


def test_every_mapped_class_is_a_real_class():
    for cat, key in pc.CATEGORY_TO_CLASS.items():
        assert key in pc.TEMPLATE_CLASSES, f"{cat} maps to unknown class {key}"


def test_promotional_and_transactional_are_mapped_although_no_row_holds_them():
    # They are in `TEMPLATE_CATEGORIES` in the frontend and in NO ROW of the
    # live table. A dropdown that offers a value will eventually produce one.
    assert pc.CATEGORY_TO_CLASS["promotional"] == "prospect_outreach"
    assert pc.CATEGORY_TO_CLASS["transactional"] == "client_service"


def test_an_explicit_class_beats_the_category_it_was_filed_under():
    cls = pc.class_for(compliance_class="client_service", category="newsletter")
    assert cls.key == "client_service"


def test_an_unknown_explicit_class_falls_back_rather_than_being_trusted():
    # A class the enforcer does not recognise cannot be enforced, so it must not
    # be accepted as though it were.
    assert pc.class_for(compliance_class="marketing_blast",
                        category="greeting").key == "greeting"
    assert pc.class_for(compliance_class="marketing_blast") is None


def test_a_campaign_with_no_template_is_unclassified():
    # 80 of 104 live campaigns carry their body inline. They resolve to None,
    # which is sendable to clients and refused-without-override to anyone else.
    assert prachar._campaign_class({"compliance_class": None}, None) is None


def test_the_campaign_class_reads_the_campaign_before_the_template():
    cls = prachar._campaign_class(
        {"compliance_class": "greeting"},
        {"compliance_class": "knowledge_update", "category": "newsletter"})
    assert cls.key == "greeting"


def test_class_resolution_survives_a_row_without_the_column():
    # `migrations/183` is written and NOT APPLIED. Until the owner runs it,
    # neither table has `compliance_class`, and asyncpg's Record raises KeyError
    # for an absent key rather than returning None. A send path that 500s
    # because a migration has not landed would be a far worse bug than the
    # missing field.
    class _RowWithoutTheColumn(dict):
        def __getitem__(self, k):
            if k == "compliance_class":
                raise KeyError(k)
            return dict.__getitem__(self, k)

    row = _RowWithoutTheColumn(category="greeting")
    assert prachar._campaign_class(row, row).key == "greeting"


# ── 5. The migration and the code cannot drift apart ────────────────────────

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations"
             / "183_prachar_icai_gate.sql").read_text(encoding="utf-8")


def test_the_check_constraint_lists_exactly_the_classes_the_code_knows():
    # A class the code enforces but the constraint refuses is a 500 on save; a
    # class the constraint allows but the code does not know is an unenforceable
    # value sitting in a column somebody trusts.
    block = re.search(
        r"ADD CONSTRAINT ck_prachar_templates_compliance_class\s*CHECK\s*\((.*?)\);",
        MIGRATION, re.S)
    assert block, "the templates class constraint is no longer in the migration"
    listed = set(re.findall(r"'([a-z_]+)'", block.group(1)))
    assert listed == set(pc.TEMPLATE_CLASSES)


def test_every_rule_key_the_code_uses_is_seeded_with_a_date():
    for key in (pc.RULE_SOLICITATION, pc.RULE_EXISTING_CLIENT, pc.RULE_GREETINGS,
                pc.RULE_REMINDER_INFERRED, pc.RULE_KNOWLEDGE_INFERRED,
                pc.RULE_DPDP_CONSENT):
        assert f"'{key}'" in MIGRATION, (
            f"rule {key} is written onto every evidence row but has no row in "
            f"prachar_compliance_rules, so the citation behind it cannot be "
            f"looked up")


def test_the_dated_facts_are_data_and_not_literals_in_a_decision():
    # The brief's rule: hardcode nothing dated. The dates live in the migration
    # as `effective_from`; the constants exist only so a message can quote a
    # citation.
    assert pc.ICAI_CODE_IN_FORCE_FROM.isoformat() == "2026-04-01"
    assert "DATE '2026-04-01'" in MIGRATION
    assert pc.DPDP_CONSENT_OBLIGATION_FROM.isoformat() == "2027-05-13"
    assert "DATE '2027-05-13'" in MIGRATION


def test_the_migration_says_it_is_not_applied_and_how_to_undo_it():
    # House rule: a migration file is also the risk report.
    assert "NOT APPLIED" in MIGRATION
    assert "HOW TO UNDO IT" in MIGRATION
    assert "DROP TABLE IF EXISTS staging.prachar_send_evidence" in MIGRATION


def test_the_migration_does_not_use_an_inline_check_on_add_column():
    # `ADD COLUMN IF NOT EXISTS ... CHECK (...)` skips the WHOLE clause when the
    # column already exists, so a replay leaves the constraint off while
    # appearing to succeed. The constraints are added separately, guarded on
    # pg_constraint.
    for m in re.finditer(r"ADD COLUMN IF NOT EXISTS[^;]*;", MIGRATION):
        assert "CHECK" not in m.group(0).upper()
    assert "pg_constraint" in MIGRATION


# ── 6. The evidence trail ───────────────────────────────────────────────────

def test_the_consent_basis_never_claims_a_consent_nobody_captured():
    # Nothing in this product has ever recorded a DPDP consent — no notice, no
    # version, no timestamp. `varta_contacts.opted_in` is the cautionary tale:
    # 45 rows read true, all with one identical timestamp from a seed script.
    # There is no 'consented' value here and there must never be one until
    # something actually captures it.
    assert pc.consent_basis_for(C, None) == "client_engagement"
    assert pc.consent_basis_for(P, "ovr-1") == "icai_override"
    assert pc.consent_basis_for(P, None) == "not_recorded"
    # And the column's CHECK admits exactly those three and nothing else, so a
    # future writer cannot invent a fourth that reads as an opt-in.
    check = re.search(r"consent_basis\s+TEXT NOT NULL\s*CHECK\s*\((.*?)\)\)",
                      MIGRATION, re.S)
    assert check, "the consent_basis CHECK is no longer in the migration"
    assert set(re.findall(r"'([a-z_]+)'", check.group(1))) == {
        "client_engagement", "icai_override", "not_recorded"}


def test_the_evidence_snapshot_columns_carry_no_foreign_key():
    # A snapshot with an FK is not a snapshot: ON DELETE SET NULL would erase
    # the evidence exactly when the underlying record went away, which is
    # precisely the case the evidence exists for.
    block = MIGRATION.split("CREATE TABLE IF NOT EXISTS staging.prachar_send_evidence")[1]
    block = block.split(");")[0]
    for line in block.splitlines():
        if re.match(r"\s*(contact_id|client_id|template_id)\s", line):
            assert "REFERENCES" not in line, (
                f"{line.strip()} carries a foreign key, so deleting the "
                f"underlying record would destroy the proof")


def test_the_send_path_writes_evidence_inside_the_same_transaction():
    src = _body(prachar.send_campaign)
    assert "record_send_evidence(" in src
    assert "record_override(" in src
    # Before dispatch, not after: a trail written after sending is a trail
    # missing exactly the sends that crashed.
    assert src.index("record_send_evidence(") < src.index("asyncio.create_task")


def test_an_override_that_cannot_be_written_down_is_not_an_override():
    # Asymmetric on purpose. An all-client send proceeds when the evidence table
    # is missing — refusing it would take a working product down over a
    # migration nobody has applied yet. An OVERRIDE does not, because the record
    # IS the override: "a logged override is a decision somebody owns" stops
    # being true the moment the log is optional.
    src = _body(prachar.send_campaign)
    assert "if not override_id" in src
    assert "503" in src


def test_evidence_writing_degrades_instead_of_taking_the_send_down():
    # 183 is written and NOT APPLIED, and this code deploys first. A send path
    # that 500s because an evidence table does not exist yet would turn a
    # compliance improvement into an outage.
    src = inspect.getsource(pc.record_send_evidence)
    assert "table_exists(" in src
    assert "logger.error" in src


async def test_the_table_probe_does_not_cache_a_miss():
    # The interesting transition is "the owner has just applied the migration".
    # A process that cached the miss would keep writing nothing until the next
    # deploy — which is how an evidence table ends up empty for a fortnight.
    pc.reset_table_cache()
    calls = []

    class _P:
        def __init__(self, answer):
            self.answer = answer

        async def fetchval(self, q, *a):
            calls.append(a)
            return self.answer

    assert await pc.table_exists(_P(None), "prachar_send_evidence") is False
    assert await pc.table_exists(_P(None), "prachar_send_evidence") is False
    assert len(calls) == 2
    assert await pc.table_exists(_P("x"), "prachar_send_evidence") is True
    assert await pc.table_exists(_P(None), "prachar_send_evidence") is True
    assert len(calls) == 3
    pc.reset_table_cache()


# ── 7. The save-time linter ─────────────────────────────────────────────────

def test_the_linter_advises_and_never_blocks():
    out = pc.lint("We are the best CA firm in Mumbai", "", "")
    assert out["advisory"] is True
    assert out["findings"]
    # Nothing in the save path raises on a finding. The people writing these
    # templates are professionals reading their own Code; the product's
    # contribution is to notice the phrase, not to grade the prose.
    assert "raise" not in _body(prachar._with_lint)


def test_the_finding_quotes_the_actual_phrase():
    # "Contains promotional language" is not actionable. «best» is.
    out = pc.lint("Our award-winning team", "", "")
    phrases = [f["phrase"].lower() for f in out["findings"]]
    assert "award-winning" in phrases


@pytest.mark.parametrize("rule,text", [
    ("superlative", "We are the leading firm for GST"),
    ("self_promotion", "We are a full-service practice"),
    ("comparison", "Our filings are faster than other firms"),
    ("guarantee", "100% compliance guaranteed"),
    ("testimonial", "Hear from our clients about their success"),
    ("pricing", "GST returns starting at Rs. 999"),
    ("solicitation_cta", "Book a call with our team this week"),
])
def test_each_rule_fires_on_the_thing_it_is_named_for(rule, text):
    out = pc.lint("", text, "")
    assert rule in {f["rule"] for f in out["findings"]}, (
        f"the {rule} rule missed: {text!r}")


def test_the_seven_rules_are_the_seven_the_brief_asked_for():
    ids = {r[0] for r in pc._LINT_RULES}
    assert ids == {"superlative", "self_promotion", "comparison", "guarantee",
                   "testimonial", "pricing", "solicitation_cta"}


def test_an_ordinary_client_email_is_left_alone():
    # A linter that fires on everything is a linter that gets ignored, and then
    # the one finding that mattered is ignored with it.
    out = pc.lint(
        "Your GSTR-3B for August is ready for review",
        "<p>Dear {{name}}, the return is attached. Please confirm by the 18th "
        "so we can file it on time.</p>", "")
    assert out["findings"] == []
    assert out["note"] is None


def test_a_subject_line_finding_says_it_was_in_the_subject():
    # A subject gets read and forwarded far more than a body, and it is what
    # lands in a notification preview.
    out = pc.lint("Guaranteed refunds", "<p>Hello</p>", "")
    assert out["findings"][0]["where"] == "subject"


def test_the_same_phrase_in_html_and_text_is_one_finding():
    out = pc.lint("", "<p>Book a call</p>", "Book a call")
    assert len([f for f in out["findings"] if f["rule"] == "solicitation_cta"]) == 1


def test_the_linter_reads_through_markup_rather_than_at_it():
    # Matching raw HTML would quote `<b>best</b>` back at the author and would
    # also match inside attribute values, which is noise.
    out = pc.lint("", "<p>We are the <b>best</b> in town</p>", "")
    phrases = [f["phrase"].lower() for f in out["findings"]]
    assert "best" in phrases


def test_the_linter_cannot_return_more_than_it_promises():
    # Distinct phrases, because identical ones are deduplicated by design —
    # the author wrote them once. A pasted price list is the realistic shape.
    out = pc.lint("", " ".join(f"{n}% off" for n in range(10, 100)), "")
    assert len(out["findings"]) <= pc.MAX_FINDINGS
    assert out["truncated"] is True


def test_the_template_save_returns_the_linter_and_the_class():
    src = inspect.getsource(prachar.create_template)
    assert "_with_lint(" in src
    src = inspect.getsource(prachar.update_template)
    assert "_with_lint(" in src
    # Linted from the SAVED ROW, not the patch: a PATCH that changes only the
    # subject must still be told about the superlative in the body it did not
    # touch. The template is what goes out, not the diff.
    assert 'row["body_html"]' in src


# ── 8. The preview tells the operator before the send refuses ───────────────

class _PreviewPool:
    def __init__(self, unsubs):
        self._unsubs = unsubs

    async def fetch(self, q, *a):
        return self._unsubs


async def test_the_preview_counts_the_people_the_send_will_refuse_on():
    body = await prachar._audience_preview_body(
        _PreviewPool([]), "org", {"client_only": False}, [C, C, P])
    assert body["client_recipients"] == 2
    assert body["non_client_recipients"] == 1
    assert body["icai_block"] is True
    assert body["client_only"] is False


async def test_the_preview_reports_no_block_when_the_gate_is_on():
    body = await prachar._audience_preview_body(
        _PreviewPool([]), "org", {}, [C, C])
    assert body["non_client_recipients"] == 0
    assert body["icai_block"] is False
    assert body["client_only"] is True


async def test_the_preview_sample_never_puts_a_client_uuid_on_the_wire():
    # `frontend/scripts/check-rendered-ids.mjs` exists to stop an id reaching a
    # screen. The resolver selects `client_id` for the send path's evidence
    # stamp; the preview must project a boolean instead of passing it through.
    body = await prachar._audience_preview_body(
        _PreviewPool([]), "org", {}, [dict(C, name="A", company="X", type="customer")])
    sample = body["contacts"][0]
    assert "client_id" not in sample
    assert sample["is_client"] is True


async def test_the_summary_sentence_describes_the_query_that_ran():
    # It is the last thing anyone reads before pressing send. "everyone in this
    # organisation" was true when `{}` meant every contact; with the gate on it
    # would overstate the audience by exactly the people the send would refuse.
    assert "client" in prachar._audience_summary({})
    off = prachar._audience_summary({"client_only": False})
    assert "not clients" in off
    assert "INCLUDING" in off, (
        "turning the gate off must be shouted, not mentioned — it is the state "
        "the send is about to refuse")
