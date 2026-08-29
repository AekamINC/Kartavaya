"""Consent, pre-flight and WhatsApp cost — and the eight ways they could lie.

Catalogue #33, #34+#40 and #35. None of these three handlers does arithmetic
worth testing. What they do is make CLAIMS about consent and cost in front of a
chartered accountant, and every test here is about a claim that could be
confidently wrong:

  · `test_an_opt_in_flag_is_never_sold_as_consent` — the whole reason #33 is a
    report and not a guarantee. `staging.varta_contacts.opted_in` is written by
    NO code path in this backend; on the live E2E org all 45 rows reading true
    share ONE opted_in_at timestamp, which is a seed, not forty-five consents.
    A handler that counted them as opt-ins would be certifying a compliance
    position out of a column nobody fills in.
  · `test_a_zero_stop_scan_over_no_messages_says_skipped` and its twin over a
    real corpus — "0 of 0" and "0 of 250" must never look alike. This is the
    §8 rule with the sharpest edge on it: a firm with no WABA connected would
    otherwise read "nobody asked you to stop" off an empty table.
  · `test_bounces_are_never_reported_as_zero` — the blocked check. Nothing
    ingests a delivery event, so an empty bounce list reads as a clean list.
    NOT MEASURED, and `counts.bounced_previously` is null and never 0.
  · `test_the_org_totals_admit_they_are_sums_over_campaigns` — found by running
    it live. Sixty E2E drafts sharing one audience produced
    `already_unsubscribed: 12430` against an unsubscribe table holding 268
    rows. A total that cannot be true is worse than no total.
  · `test_no_gst_or_tax_position_appears_anywhere_in_the_output` — the folio
    deleted a sentence asserting 18% GST on Meta's invoice as imported OIDAR
    services. This test is the thing that stops it coming back.
  · `test_no_rupee_figure_without_a_rate_card` — Meta's India card is recorded
    nowhere in this product, so nothing prints one from memory.
  · `test_a_marketing_word_inside_a_longer_word_is_not_a_finding` — "free"
    inside "freelance". A check that cries wolf on a correct template is a
    check people switch off.
  · `test_nothing_in_this_module_writes` — mechanical. Recording a consent
    nobody gave is worse than recording none.

Live figures at the time of writing, read-only 2026-08-20, all three orgs:

  E2E Test & Associates — 60 WhatsApp contacts, 45 flagged opted_in over ONE
  distinct timestamp, 250 inbound messages examined from 25 people, 0 stop
  words, 15 reachable with no recorded opt-in, 0 WhatsApp business accounts.
  84 unsent campaigns over 3 audience filters, 24 of them on a channel Prachar
  cannot deliver; "Q1 Newsletter — Jun 2026" claims 100 recipients, resolves a
  234-contact segment and is deliverable to SEVEN. 10 templates, 0 at
  reclassification risk, 183 outbound messages in 2026-07 of which 183 are
  unattributable. Aekam Inc and Unicode Group hold no Varta data at all.
"""
import asyncio
import inspect
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from services.skills.data.varta_consent import (
    AUDIENCE_KEYS,
    EXACT_STOP_WORDS,
    MARKETING_LEXICON,
    PHRASE_STOP_WORDS,
    _audience_predicates,
    _norm_email,
    _norm_phone,
    _norm_text,
    brief_whatsapp_cost,
    check_broadcast_preflight,
    check_consent_ledger,
)
from services.skills.timeutil import return_period

SRC = Path(inspect.getsourcefile(check_consent_ledger)).read_text(encoding="utf-8")

ORG = "00000000-0000-4000-8000-000000000033"
OTHER_ORG = "00000000-0000-4000-8000-000000000099"
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)


class _Pool:
    """Replays canned result sets, matched on a FRAGMENT of the SQL.

    Matched by fragment rather than by call order, so inserting a query into a
    handler does not silently shift every fixture by one — which is how a suite
    starts asserting on the wrong rows while staying green.

    `execute` raises. These handlers must never write, and a fake that quietly
    accepted a write would be the one place the rule was not enforced.
    """

    def __init__(self, fetch_by=None, fetchrow_by=None):
        self.fetch_by = fetch_by or {}
        self.fetchrow_by = fetchrow_by or {}
        self.calls: list[tuple[str, tuple]] = []

    def _match(self, table, sql):
        for fragment, payload in table.items():
            if fragment in sql:
                return payload
        return None

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return self._match(self.fetch_by, sql) or []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return self._match(self.fetchrow_by, sql)

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        return None

    async def execute(self, sql, *args):  # pragma: no cover - must never run
        raise AssertionError(f"a consent handler tried to WRITE: {sql[:120]}")

    def sql_for(self, fragment):
        return [(s, a) for s, a in self.calls if fragment in s]


def _text(out, include_limitations=True) -> str:
    """The output as one lowercase string.

    `include_limitations=False` for any ABSENCE assertion. The caveat explaining
    why a figure is not shown necessarily contains the word for the figure — the
    limitation saying bounces are not measured contains 'bounce' — so an absence
    test that reads the limitations proves nothing.
    """
    payload = dict(out)
    if not include_limitations:
        payload.pop("limitations", None)
    return json.dumps(payload, default=str).lower()


def _names_in(out) -> list[str]:
    """Every value this output presents as a person or a company."""
    found: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("who", "company") and isinstance(value, str):
                    found.append(value)
                elif key == "who" and isinstance(value, list):
                    found.extend(v for v in value if isinstance(v, str))
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(out)
    return found


# ══════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════

WABA_NONE = {"total": 0, "connected": 0}

TOTALS_SEEDED = {
    "contacts": 60, "flagged_opted_in": 45, "not_flagged": 15,
    "with_timestamp": 45, "distinct_timestamps": 1, "linked_to_crm": 60,
}
TOTALS_EMPTY = {
    "contacts": 0, "flagged_opted_in": 0, "not_flagged": 0,
    "with_timestamp": 0, "distinct_timestamps": 0, "linked_to_crm": 0,
}


def _contact(**kw):
    row = {
        "id": "aaaaaaaa-1111-4111-8111-111111111111",
        "phone_number": "+91 98765 43210",
        "wa_name": "Sanjay Patel",
        "opted_in": True,
        "opted_in_at": datetime(2026, 6, 4, 3, 51, 13, tzinfo=timezone.utc),
        "last_message_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
        "created_at": datetime(2026, 6, 1, tzinfo=timezone.utc),
        "crm_name": "Sanjay Patel",
        "crm_company": "Patel Textiles Pvt Ltd",
    }
    row.update(kw)
    return row


def _stop_hit(**kw):
    row = {
        "message_id": "bbbbbbbb-2222-4222-8222-222222222222",
        "created_at": datetime(2026, 8, 10, tzinfo=timezone.utc),
        "content": "STOP",
        "exact_hit": True,
        "contact_id": "aaaaaaaa-1111-4111-8111-111111111111",
        "phone_number": "+91 98765 43210",
        "wa_name": "Sanjay Patel",
        "opted_in": True,
        "opted_in_at": datetime(2026, 6, 4, tzinfo=timezone.utc),
        "crm_name": "Sanjay Patel",
        "crm_company": "Patel Textiles Pvt Ltd",
    }
    row.update(kw)
    return row


def _consent_pool(contacts=None, stops=None, inbound=250, totals=None, waba=None):
    return _Pool(
        fetch_by={
            "ORDER BY vc.opted_in ASC": contacts if contacts is not None else [_contact()],
            "WITH inbound AS": stops or [],
        },
        fetchrow_by={
            "varta_business_accounts": waba or WABA_NONE,
            "count(DISTINCT opted_in_at)": totals or TOTALS_SEEDED,
            "contacts_who_wrote": {"inbound_messages": inbound, "contacts_who_wrote": 25},
        },
    )


def _campaign(**kw):
    row = {
        "id": "cccccccc-3333-4333-8333-333333333333",
        "name": "Q1 Newsletter",
        "channel": "email",
        "status": "draft",
        "total_recipients": 100,
        "audience_filter": {},
        "scheduled_at": None,
        "created_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
    }
    row.update(kw)
    return row


def _crm(**kw):
    row = {
        "id": "dddddddd-4444-4444-8444-444444444444",
        "name": "Meera Chopra",
        "email": "meera@example.in",
        "phone": "+91 90000 00001",
        "company": "Chopra & Co",
    }
    row.update(kw)
    return row


def _preflight_pool(campaigns=None, crm=None, unsubs=(), wa=()):
    return _Pool(fetch_by={
        "FROM public.prachar_campaigns": campaigns if campaigns is not None else [_campaign()],
        "FROM public.prachar_unsubscribes": [{"email": e} for e in unsubs],
        "SELECT phone_number, opted_in FROM public.varta_contacts":
            [{"phone_number": p, "opted_in": o} for p, o in wa],
        "FROM public.graha_contacts gc": crm if crm is not None else [_crm()],
    })


def _template(**kw):
    row = {
        "id": "eeeeeeee-5555-4555-8555-555555555555",
        "name": "payment_reminder",
        "language": "en",
        "category": "UTILITY",
        "status": "approved",
        "body": "Namaste {{1}}, your invoice {{2}} is due on {{3}}.",
        "header_type": None,
        "header_content": None,
        "footer": None,
        "buttons": [],
    }
    row.update(kw)
    return row


def _volume(**kw):
    row = {"template_name": "payment_reminder", "messages": 100, "failed": 0, "suppressed": 0}
    row.update(kw)
    return row


def _cost_pool(templates=None, volume=()):
    return _Pool(fetch_by={
        "FROM public.varta_templates": templates if templates is not None else [_template()],
        "GROUP BY m.template_name": list(volume),
    })


def _run(coro):
    return asyncio.run(coro)


# ══════════════════════════════════════════════════════════════════════════
# The contract every handler owes
# ══════════════════════════════════════════════════════════════════════════

HANDLERS = (check_consent_ledger, check_broadcast_preflight, brief_whatsapp_cost)


@pytest.mark.parametrize("handler", HANDLERS, ids=lambda h: h.__name__)
def test_a_handler_needs_nothing_but_the_org(handler):
    """A parameter with no default cannot be supplied by a 6am schedule, and the
    dispatcher refuses the run outright. Two of the most valuable skills in the
    marketplace shipped on the wrong side of this."""
    required = [
        name for name, p in inspect.signature(handler).parameters.items()
        if name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
    ]
    assert not required, f"{handler.__name__} cannot be scheduled: needs {required}"


@pytest.mark.parametrize("handler", HANDLERS, ids=lambda h: h.__name__)
def test_every_output_survives_json_dumps_and_carries_its_caveats(handler):
    pools = {
        "check_consent_ledger": _consent_pool(),
        "check_broadcast_preflight": _preflight_pool(),
        "brief_whatsapp_cost": _cost_pool(volume=[_volume()]),
    }
    out = _run(handler(pools[handler.__name__], ORG))
    json.dumps(out, default=str)
    assert isinstance(out["counts"], dict) and out["counts"]
    assert isinstance(out["limitations"], list) and out["limitations"]
    assert all(isinstance(x, str) and x.strip() for x in out["limitations"])


def test_nothing_in_this_module_writes():
    """Mechanical. Recording a consent nobody gave — or a suppression nobody
    asked for — is worse than recording none, and both are one careless UPDATE
    away."""
    for pattern in (r"\bINSERT\s+INTO\b", r"\bUPDATE\s+public\.", r"\bDELETE\s+FROM\b"):
        assert not re.search(pattern, SRC, re.I), f"{pattern} found in the module"
    # `_Pool.execute` raises, so the three runs above also prove it at runtime.


def test_every_query_carries_the_tenant_boundary():
    """Every SELECT filters org_id, and every graha join carries org_id on BOTH
    sides. The FK on graha_contacts is on the id ALONE, so an id-only join can
    print another practice's contact name — proved live, and a consent ledger is
    the worst possible place for it."""
    for pool, handler in (
        (_consent_pool(), check_consent_ledger),
        (_preflight_pool(), check_broadcast_preflight),
        (_cost_pool(volume=[_volume()]), brief_whatsapp_cost),
    ):
        _run(handler(pool, ORG))
        for sql, args in pool.calls:
            assert "org_id = $1::uuid" in sql or "org_id=$1::uuid" in sql, sql[:200]
            assert args and str(args[0]) == ORG

    joins = re.findall(r"JOIN public\.graha_contacts \w+\s+ON [^\n]+", SRC)
    assert joins, "expected at least one graha_contacts join to check"
    for join in joins:
        assert "org_id" in join, f"id-only graha join: {join}"


# ══════════════════════════════════════════════════════════════════════════
# 33 · the consent ledger
# ══════════════════════════════════════════════════════════════════════════

def test_an_opt_in_flag_is_never_sold_as_consent():
    """45 people, one timestamp. That is a seed script, not forty-five
    consents, and the handler has to say so rather than certify it."""
    out = _run(check_consent_ledger(_consent_pool(totals=TOTALS_SEEDED), ORG))
    assert out["opt_in_is_not_evidence"] is True
    blob = " ".join(out["limitations"]).lower()
    assert "never written" in blob
    assert "seed" in blob or "bulk import" in blob
    # And the flag count is never renamed into something that reads as consent.
    assert "flagged_opted_in" in out["counts"]
    assert "consented" not in json.dumps(out["counts"]).lower()


def test_the_never_written_column_is_reported_even_on_an_empty_org():
    """Two of the three live orgs hold no Varta data at all. The schema defect
    is a fact about the product, not about the rows, so an org with nothing in
    it must still be told."""
    out = _run(check_consent_ledger(
        _consent_pool(contacts=[], totals=TOTALS_EMPTY, inbound=0), ORG))
    assert out["counts"]["whatsapp_contacts"] == 0
    assert "never written" in " ".join(out["limitations"]).lower()
    assert out["missing_write_path"]["columns_that_would_close_it"]
    assert out["send_refusal_in_force"] is False


def test_the_missing_write_path_names_columns_a_migration_could_add():
    out = _run(check_consent_ledger(_consent_pool(), ORG))
    named = " ".join(out["missing_write_path"]["columns_that_would_close_it"])
    for column in ("opt_in_source", "opt_in_notice", "opted_out_at", "opted_out_reason"):
        assert f"public.varta_contacts.{column}" in named
    assert "prachar_unsubscribes" in out["missing_write_path"]["refusal_that_would_enforce_it"]


def test_a_zero_stop_scan_over_no_messages_says_skipped():
    """0 of 0 and 0 of 250 must never look alike. A firm with no WABA connected
    would otherwise read 'nobody asked you to stop' off an empty table."""
    out = _run(check_consent_ledger(_consent_pool(inbound=0, stops=[]), ORG))
    assert out["counts"]["inbound_messages_examined"] == 0
    assert out["counts"]["asked_to_stop"] == 0
    assert any("skipped check" in x.lower() for x in out["limitations"])


def test_a_zero_stop_scan_over_a_real_corpus_does_not_claim_it_was_skipped():
    """The other half of the same rule: a genuine zero over 250 messages is a
    finding and must not be caveated into looking like a failure."""
    out = _run(check_consent_ledger(_consent_pool(inbound=250, stops=[]), ORG))
    assert out["counts"]["inbound_messages_examined"] == 250
    assert not any("scan checked nothing" in x.lower() for x in out["limitations"])
    # The denominator is on the output, not only in prose.
    assert out["counts"]["contacts_who_wrote_in"] == 25


def test_a_stop_still_flagged_opted_in_is_reported_as_the_contradiction():
    """The number that justifies building the write path: people who asked you
    to stop and whose ledger row still says they are opted in."""
    out = _run(check_consent_ledger(_consent_pool(stops=[_stop_hit(opted_in=True)]), ORG))
    assert out["counts"]["asked_to_stop"] == 1
    assert out["counts"]["asked_to_stop_but_ledger_says_opted_in"] == 1
    assert out["asked_to_stop"][0]["ledger_still_says_opted_in"] is True
    assert out["asked_to_stop"][0]["matched"] == "exact"


def test_a_phrase_match_is_reported_at_lower_confidence_than_an_exact_one():
    """'band karo' as the whole message is unambiguous. 'yeh reminder band karo
    aur invoice bhejo' is a person asking you to stop doing something else, and
    a reader deciding whether to suppress a number needs to know which test
    fired."""
    out = _run(check_consent_ledger(_consent_pool(stops=[
        _stop_hit(exact_hit=False, content="yeh reminder band karo aur invoice bhejo"),
    ]), ORG))
    hit = out["asked_to_stop"][0]
    assert hit["matched"] == "phrase"
    assert "inside a longer message" in hit["confidence"]


def test_a_person_who_stopped_is_still_listed_as_reachable():
    """The point of section C. The send route reads no consent state, so asking
    to stop changes nothing about who a template send reaches."""
    out = _run(check_consent_ledger(_consent_pool(
        contacts=[_contact(opted_in=True)],
        stops=[_stop_hit(opted_in=True)],
    ), ORG))
    reachable = out["reachable_without_a_recorded_opt_in"]
    assert len(reachable) == 1
    assert reachable[0]["asked_to_stop"] is True
    assert "no refusal" in reachable[0]["why"]


def test_the_stop_vocabulary_is_bound_and_covers_indian_scripts():
    """Bound as a text[] parameter, never interpolated — and wide enough to be
    worth having. A stop word f-strung into SQL is an injection; a stop list
    that only reads English silently passes every vernacular opt-out."""
    pool = _consent_pool()
    _run(check_consent_ledger(pool, ORG))
    sql, args = pool.sql_for("WITH inbound AS")[0]
    assert list(EXACT_STOP_WORDS) in args and list(PHRASE_STOP_WORDS) in args
    for word in EXACT_STOP_WORDS:
        assert word not in sql, f"stop word {word!r} interpolated into SQL"
    assert "बंद करो" in EXACT_STOP_WORDS and "બંધ" in EXACT_STOP_WORDS
    # 'no' and 'nahi' alone are answers far more often than opt-outs.
    assert "no" not in EXACT_STOP_WORDS and "nahi" not in EXACT_STOP_WORDS
    assert "band" not in PHRASE_STOP_WORDS, "'band' is an English word"


def test_the_stop_scan_is_never_capped_away():
    """The cap applies to what is DISPLAYED. The matching happens in the WHERE
    clause, so a stop word cannot be hidden by a LIMIT on the corpus."""
    sql = SRC[SRC.index("WITH inbound AS"):]
    where = sql[sql.index("WHERE i.norm"):sql.index("ORDER BY i.created_at")]
    assert "ANY($2::text[])" in where and "unnest($3::text[])" in where


def test_no_uuid_is_ever_rendered_as_a_person():
    out = _run(check_consent_ledger(_consent_pool(
        contacts=[_contact(crm_name=None, crm_company=None, wa_name="")],
        stops=[_stop_hit(crm_name=None, crm_company=None, wa_name="")],
    ), ORG))
    names = _names_in(out)
    assert names, "expected some names to check"
    for name in names:
        assert not UUID_RE.search(name), f"a UUID was rendered as a name: {name}"
    assert "(no name recorded)" in names


def test_the_absent_notice_text_is_a_stated_absence_not_a_missing_key():
    """An absent key reads as 'not applicable'. This is the single most
    important absence in the report — the folio asks for the notice text by
    name — so it is present, null, and explained."""
    out = _run(check_consent_ledger(_consent_pool(), ORG))
    row = out["opt_in_recorded"][0]
    assert "notice_text_shown_at_opt_in" in row and row["notice_text_shown_at_opt_in"] is None
    assert "no column exists" in row["notice_text_status"]
    assert out["counts"]["opt_ins_with_notice_text"] == 0


# ══════════════════════════════════════════════════════════════════════════
# 34 + 40 · the broadcast pre-flight
# ══════════════════════════════════════════════════════════════════════════

def test_bounces_are_never_reported_as_zero():
    """The blocked check. Nothing ingests a delivery event, so an empty bounce
    list reads as a clean list — which is the lie this handler exists not to
    tell."""
    out = _run(check_broadcast_preflight(_preflight_pool(), ORG))
    assert out["bounce_check"] == "NOT MEASURED"
    assert out["counts"]["bounced_previously"] is None
    bucket = out["campaigns"][0]["bounced_previously"]
    assert bucket["measured"] is False and bucket["state"] == "NOT MEASURED"
    assert "count" not in bucket, "a bounce bucket must not carry a number at all"
    # And nowhere does a number sit beside the word.
    assert not re.search(r'"bounce[a-z_]*"\s*:\s*\d', _text(out, include_limitations=False))


def test_no_deliverability_or_quality_figure_is_printed():
    """The folio: 'do not print a quality figure the product cannot see.'"""
    blob = _text(_run(check_broadcast_preflight(_preflight_pool(), ORG)),
                 include_limitations=False)
    for forbidden in ("open_rate", "click_rate", "quality_rating", "deliverability",
                      "engagement_score", "sender_score"):
        assert forbidden not in blob


def test_an_email_campaign_reports_no_opt_in_as_a_fact_about_the_schema():
    """Email has no opt-in record anywhere in this product — only the opt-OUT
    list. So the count is the size of the list by construction, and printing it
    without saying that would read as a measurement about the recipients."""
    out = _run(check_broadcast_preflight(_preflight_pool(
        crm=[_crm(id="1"), _crm(id="2", email="b@example.in")],
    ), ORG))
    bucket = out["campaigns"][0]["no_recorded_opt_in"]
    assert bucket["count"] == 2
    assert "by construction" in bucket["basis"]
    assert "no opt-in record for email" in bucket["basis"]


def test_duplicates_collapse_to_one_deliverable_and_the_extras_are_named():
    """#40's second bucket. Two contact rows, one address: one send, one extra
    copy avoided, and both people named so the CRM can be fixed."""
    out = _run(check_broadcast_preflight(_preflight_pool(crm=[
        _crm(id="1", name="Meera Chopra", email="Meera@Example.in"),
        _crm(id="2", name="M Chopra", email="meera@example.in "),
        _crm(id="3", name="Arjun Kulkarni", email="arjun@example.in"),
    ]), ORG))
    campaign = out["campaigns"][0]
    duplicates = campaign["duplicates_resolving_to_one_address"]
    assert duplicates["addresses"] == 1
    assert duplicates["extra_copies_avoided"] == 1
    assert sorted(duplicates["rows"][0]["who"]) == ["M Chopra", "Meera Chopra"]
    assert campaign["unique_addresses"] == 2
    assert campaign["deliverable_now"] == 2


def test_an_unsubscribed_address_is_removed_from_the_deliverable_count():
    out = _run(check_broadcast_preflight(_preflight_pool(
        crm=[_crm(id="1", email="a@example.in"), _crm(id="2", email="b@example.in")],
        unsubs=["A@Example.in"],
    ), ORG))
    campaign = out["campaigns"][0]
    assert campaign["already_unsubscribed"]["count"] == 1
    assert campaign["already_unsubscribed"]["measured"] is True
    assert campaign["deliverable_now"] == 1
    assert campaign["claimed_recipients"] == 100
    assert campaign["claimed_minus_deliverable"] == 99


def test_a_contact_with_no_address_is_a_finding_not_a_silent_drop():
    """The sender filters these out before it counts. This is choosing what to
    report, not who to mail, so an unreachable contact is the finding."""
    out = _run(check_broadcast_preflight(_preflight_pool(crm=[
        _crm(id="1", email="a@example.in"),
        _crm(id="2", name="Karan Joshi", email=None),
        _crm(id="3", name="Ritu Reddy", email="   "),
    ]), ORG))
    bucket = out["campaigns"][0]["no_address_at_all"]
    assert bucket["count"] == 2
    assert {r["who"] for r in bucket["rows"]} == {"Karan Joshi", "Ritu Reddy"}
    assert out["campaigns"][0]["deliverable_now"] == 1


def test_a_whatsapp_campaign_is_flagged_as_having_no_send_path():
    """24 live E2E campaigns claim 1,704 recipients on channels Prachar refuses
    to deliver. A pre-flight that priced them as sendable would be preparing a
    send that cannot happen."""
    out = _run(check_broadcast_preflight(_preflight_pool(
        campaigns=[_campaign(channel="whatsapp", total_recipients=72)],
        crm=[_crm(id="1", phone="+91 98765 43210")],
        wa=[("+919876543210", True)],
    ), ORG))
    campaign = out["campaigns"][0]
    assert campaign["channel_can_be_delivered"] is False
    assert "no send path" in campaign["channel_note"]
    assert out["counts"]["campaigns_on_an_undeliverable_channel"] == 1
    # And the email-only suppression list is NOT silently applied to it.
    assert campaign["already_unsubscribed"]["measured"] is False
    assert "NOT MEASURED" in campaign["already_unsubscribed"]["note"]


def test_a_whatsapp_campaign_matches_opt_in_on_the_last_ten_digits():
    """`+91 98765 43210`, `09876543210` and `9876543210` are one number, and the
    live CRM holds all three shapes."""
    out = _run(check_broadcast_preflight(_preflight_pool(
        campaigns=[_campaign(channel="whatsapp")],
        crm=[_crm(id="1", phone="09876543210"), _crm(id="2", phone="+91 90000 00002")],
        wa=[("+91 98765 43210", True)],
    ), ORG))
    bucket = out["campaigns"][0]["no_recorded_opt_in"]
    assert bucket["count"] == 1
    assert "never written by any code path" in bucket["basis"]


def test_the_org_totals_admit_they_are_sums_over_campaigns():
    """Found by running it live: sixty E2E drafts sharing one audience produced
    `already_unsubscribed: 12430` against an unsubscribe table holding 268 rows.
    A total that cannot be true is worse than no total."""
    out = _run(check_broadcast_preflight(_preflight_pool(
        campaigns=[_campaign(id="1"), _campaign(id="2")],
        crm=[_crm(id="1", email="a@example.in")],
        unsubs=["a@example.in"],
    ), ORG))
    counts = out["counts"]
    assert counts["already_unsubscribed_summed_over_campaigns"] == 2
    assert counts["unsubscribe_list_size"] == 1
    for bare in ("already_unsubscribed", "deliverable_total", "claimed_recipients_total"):
        assert bare not in counts, f"{bare} reads as a headcount and is not one"
    assert any("send slots" in x.lower() for x in out["limitations"])


def test_an_unknown_filter_key_is_ignored_and_says_so():
    """`audience_filter` is a jsonb blob written before anything validated it. A
    key that is stored, shown and never applied is how an operator comes to
    believe an audience was narrowed when it was not."""
    out = _run(check_broadcast_preflight(_preflight_pool(
        campaigns=[_campaign(audience_filter={"seed": "demo", "segment": "clients"})],
    ), ORG))
    assert sorted(out["campaigns"][0]["ignored_filter_keys"]) == ["seed", "segment"]


def test_a_stored_min_score_of_zero_is_still_a_filter():
    """PRESENCE, not truthiness. `if filters.get("min_score")` dropped a stored
    0 — which the builder rendered as an active filter while the query added no
    clause at all."""
    params = [ORG]
    sql, ignored = _audience_predicates({"min_score": 0}, params)
    assert "gc.lead_score >= $2::int" in sql, "a stored 0 must still be applied"
    assert params[1] == 0 and not ignored
    # And the cast is there: an untyped $n comparison is an instant PgBouncer 500.
    assert "::int" in sql


def test_a_percent_in_the_company_filter_matches_one_company():
    """A marketer typing "100%" was asking for one company and getting every
    company in the org, and the preview then reported the larger number as
    though it were the segment."""
    params = [ORG]
    sql, _ = _audience_predicates({"company": "100%"}, params)
    assert params[1] == "%100\\%%"
    assert "ESCAPE" in sql


def test_no_audience_value_is_ever_interpolated_into_the_sql():
    """Every value is bound. The only text this function puts into the string is
    a parameter number it generated itself."""
    params = [ORG]
    sql, _ = _audience_predicates(
        {"type": "customer'; DROP TABLE public.graha_contacts; --",
         "source": "referral", "tag": "audit", "min_score": 50, "company": "Acme"},
        params,
    )
    assert "DROP TABLE" not in sql
    for value in ("customer", "referral", "audit", "Acme"):
        assert value not in sql
    assert len(params) == 6
    assert set(AUDIENCE_KEYS) == {"type", "source", "company", "tag", "min_score"}


def test_no_unsent_campaign_is_a_skipped_check_not_a_clean_bill():
    out = _run(check_broadcast_preflight(_preflight_pool(campaigns=[]), ORG))
    assert out["counts"]["campaigns_examined"] == 0
    assert any("skipped check" in x.lower() for x in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 35 · what WhatsApp is costing you
# ══════════════════════════════════════════════════════════════════════════

def test_no_gst_or_tax_position_appears_anywhere_in_the_output():
    """The folio deleted a sentence asserting 18% GST on the Meta bill as
    imported OIDAR services — a tax position about a third party's invoice,
    stated with no source, in a product used by tax professionals. This test is
    what stops it coming back.

    The limitations are INCLUDED in this scan deliberately: the caveat says the
    handler takes no position on the tax treatment, and it says it without
    naming a tax."""
    out = _run(brief_whatsapp_cost(
        _cost_pool(volume=[_volume()]), ORG,
        rate_card_inr={"UTILITY": 0.12, "MARKETING": 0.80},
    ))
    blob = json.dumps(out, default=str).lower()
    for forbidden in ("gst", "oidar", "igst", "reverse charge", "18%", "input tax"):
        assert forbidden not in blob, f"a tax claim leaked into the output: {forbidden}"


def test_no_rupee_figure_without_a_rate_card():
    """Meta's India card is recorded nowhere in this product. Printing a
    per-message price from memory in front of a CA is the failure this whole
    contract exists to prevent."""
    out = _run(brief_whatsapp_cost(_cost_pool(volume=[_volume()]), ORG))
    assert out["cost_estimate_inr"] is None
    assert out["counts"]["rupee_estimate_computed"] is False
    assert "not recorded anywhere in this product" in out["cost_estimate_note"]
    assert not re.search(r"₹\s*\d", json.dumps(out, default=str))
    # The volume itself is still reported — the check is not skipped.
    assert out["counts"]["outbound_messages_in_month"] == 100


def test_a_supplied_rate_card_is_labelled_an_estimate_everywhere():
    out = _run(brief_whatsapp_cost(
        _cost_pool(volume=[_volume(messages=50)]), ORG,
        rate_card_inr={"utility": 0.10},
    ))
    estimate = out["cost_estimate_inr"]
    assert estimate["is_an_estimate"] is True
    assert "ESTIMATE" in estimate["label"] and "bills the org directly" in estimate["label"]
    assert estimate["priced"]["UTILITY"] == {"messages": 50, "rate_inr": 0.10,
                                             "estimate_inr": 5.0}
    assert estimate["total_estimate_inr"] == 5.0
    assert estimate["total_is_a_floor"] is False
    assert "ESTIMATE" in out["cost_estimate_note"]


def test_an_unpriced_category_makes_the_total_a_floor():
    """A card missing a category is not a reason to omit that category's volume,
    and it is not a reason to let the total read as complete."""
    out = _run(brief_whatsapp_cost(
        _cost_pool(
            templates=[_template(), _template(id="2", name="festival_greeting",
                                              category="MARKETING")],
            volume=[_volume(), _volume(template_name="festival_greeting", messages=30)],
        ), ORG,
        rate_card_inr={"UTILITY": 0.10},
    ))
    estimate = out["cost_estimate_inr"]
    assert estimate["total_is_a_floor"] is True
    assert estimate["categories_with_no_rate_supplied"] == [
        {"category": "MARKETING", "messages": 30}]
    assert any("floor" in x.lower() for x in out["limitations"])


def test_a_message_naming_no_known_template_is_unattributable_not_free():
    """The live case: all 250 outbound rows in the E2E org carry a NULL
    template_name, so 183 messages in the default month are unattributable. A
    handler that dropped them would report a zero bill on real traffic."""
    out = _run(brief_whatsapp_cost(_cost_pool(
        volume=[_volume(template_name=None, messages=183)],
    ), ORG))
    assert out["counts"]["outbound_messages_in_month"] == 183
    assert out["counts"]["messages_with_no_category"] == 183
    assert out["counts"]["messages_attributed_to_a_category"] == 0
    assert out["volume_by_category"] == {}
    assert out["volume_by_template"][0]["category"] == "unattributable"
    assert any("none of the 183" in x.lower() for x in out["limitations"])


def test_a_template_name_from_another_org_is_never_priced_as_ours():
    """Two practices may both hold a template called `payment_reminder`. The
    name map is built from THIS org's templates only, so an unknown name falls
    to unattributable rather than borrowing somebody else's category."""
    out = _run(brief_whatsapp_cost(_cost_pool(
        templates=[_template(name="payment_reminder", category="UTILITY")],
        volume=[_volume(template_name="their_marketing_blast", messages=40)],
    ), ORG))
    assert out["volume_by_category"] == {}
    assert out["counts"]["messages_with_no_category"] == 40


def test_suppressed_and_failed_messages_are_not_billable():
    """A suppressed message never left this server and a failed one never
    reached a handset. Counting them inflates an estimate in the direction that
    makes the product look expensive — still a wrong number."""
    out = _run(brief_whatsapp_cost(_cost_pool(
        volume=[_volume(messages=100, failed=10, suppressed=30)],
    ), ORG))
    assert out["counts"]["outbound_messages_in_month"] == 100
    assert out["counts"]["billable_basis_messages"] == 60
    assert out["volume_by_template"][0]["not_delivered"] == 40


def test_a_marketing_word_in_a_utility_template_is_a_finding():
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[
        _template(body="Namaste {{1}}, exclusive discount for you — buy now!"),
    ]), ORG))
    assert out["counts"]["templates_at_reclassification_risk"] == 1
    risk = out["reclassification_risks"][0]
    assert set(risk["terms"]) >= {"discount", "exclusive", "buy now"}
    assert risk["matched"][0]["field"] == "body"
    assert "billed at the marketing rate" in risk["risk"]


def test_a_marketing_word_in_a_marketing_template_is_not_a_finding():
    """A MARKETING template full of marketing words is correct. Reporting it is
    how a check teaches people to ignore it."""
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[
        _template(category="MARKETING", body="Exclusive discount — buy now!"),
    ]), ORG))
    assert out["counts"]["templates_at_reclassification_risk"] == 0
    assert out["counts"]["templates_examined"] == 1


def test_a_marketing_word_inside_a_longer_word_is_not_a_finding():
    """'free' inside 'freelance', 'deal' inside 'dealing'. A check that cries
    wolf on a correct template is a check people switch off."""
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[
        _template(body="Your freelance dealings statement for {{1}} is ready."),
    ]), ORG))
    assert out["reclassification_risks"] == []


def test_a_hindi_marketing_word_is_found_in_a_hindi_template():
    """A lexicon that only read English would quietly pass every vernacular
    template, and vernacular templates are the whole point of #36."""
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[
        _template(language="hi", body="नमस्ते {{1}}, विशेष छूट आपके लिए"),
    ]), ORG))
    assert out["counts"]["templates_at_reclassification_risk"] == 1
    assert "छूट" in out["reclassification_risks"][0]["terms"]


def test_promotional_wording_in_a_button_or_footer_is_found():
    """Meta reads the whole template. A scan that only read the body would miss
    the place a call to action actually lives."""
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[
        _template(footer="Limited time only", buttons=[{"text": "Shop now"}]),
    ]), ORG))
    fields = {h["field"] for h in out["reclassification_risks"][0]["matched"]}
    assert fields == {"footer", "buttons"}


def test_an_authentication_template_gets_its_own_bucket():
    """Meta REJECTS a promotional authentication template rather than
    reclassifying it, so it is a different outcome and a different sentence."""
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[
        _template(category="AUTHENTICATION", body="Your code is {{1}}. Upgrade today!"),
    ]), ORG))
    assert out["counts"]["templates_at_reclassification_risk"] == 0
    assert out["counts"]["authentication_templates_at_rejection_risk"] == 1
    assert "refused outright" in out["authentication_rejection_risks"][0]["risk"]


def test_no_templates_is_a_skipped_scan_not_a_clean_one():
    out = _run(brief_whatsapp_cost(_cost_pool(templates=[]), ORG))
    assert out["counts"]["templates_examined"] == 0
    assert any("skipped check" in x.lower() for x in out["limitations"])


def test_no_outbound_traffic_is_a_skipped_check_not_a_zero_bill():
    out = _run(brief_whatsapp_cost(_cost_pool(volume=[]), ORG))
    assert out["counts"]["outbound_messages_in_month"] == 0
    assert any("not a zero bill" in x.lower() for x in out["limitations"])


def test_the_month_defaults_to_the_previous_complete_month():
    """A cost report run on the 3rd is asking about the month that finished, not
    the two days of the one that started."""
    out = _run(brief_whatsapp_cost(_cost_pool(volume=[_volume()]), ORG))
    assert out["month"] == return_period()
    assert out["window_from"].day == 1
    assert out["window_to_exclusive"] > out["window_from"]


def test_the_window_end_is_exclusive():
    """`<= last_day` on a timestamptz drops everything after midnight on the
    last day of the month, which is nearly all of that day."""
    out = _run(brief_whatsapp_cost(_cost_pool(volume=[_volume()]), ORG, month="2026-12"))
    assert out["window_from"] == date(2026, 12, 1)
    assert out["window_to_exclusive"] == date(2027, 1, 1)
    pool_sql = SRC[SRC.index("GROUP BY m.template_name") - 700:]
    assert "m.created_at <  $3::date" in SRC


def test_a_malformed_month_falls_back_and_reports_the_month_it_used():
    """A caller error is not a reason to fail a scheduled run — but nobody may
    read last month's figures believing they asked for another month."""
    out = _run(brief_whatsapp_cost(_cost_pool(volume=[_volume()]), ORG, month="not-a-month"))
    assert out["month"] == return_period()


# ══════════════════════════════════════════════════════════════════════════
# The small helpers, where a quiet mistake is invisible
# ══════════════════════════════════════════════════════════════════════════

def test_normalisation_keeps_indic_text_and_drops_punctuation():
    """THE BUG THIS TEST CAUGHT, kept as a regression.

    The first version of `_norm_text` was `re.sub(r"[^\\w]+", " ", text)`, which
    is the obvious spelling and is broken for every Indian language: Python's
    `\\w` covers letters and digits but NOT combining marks, and Indic vowel
    signs are combining marks. It turned "बंद करो" into "ब द कर". The SQL twin
    had the identical defect with `[^[:alnum:]]`, measured live:

        'बंद करो।'  -> 'ब द कर'      'બંધ કરો' -> 'બ ધ કર'
        'நிறுத்து'   -> 'ந ற த த'

    So mangled haystacks would have been compared against intact needles, the
    entire vernacular half of the stop scan would have matched nothing, and the
    handler would have reported a confident zero over a corpus it had itself
    destroyed. That is the exact failure "vernacular equivalents" exists to
    prevent, and it would have looked like a clean result for ever.
    """
    assert _norm_text("  STOP!!  ") == "stop"
    assert _norm_text("Band-Karo") == "band karo"
    assert _norm_text(None) == ""
    # The danda goes the way a full stop goes; the vowel signs stay.
    assert _norm_text("बंद करो।") == "बंद करो"
    assert _norm_text("બંધ કરો") == "બંધ કરો"
    assert _norm_text("நிறுத்து") == "நிறுத்து"
    assert _norm_text("ನಿಲ್ಲಿಸಿ") == "ನಿಲ್ಲಿಸಿ"
    # Every stop word must survive its own normaliser, or it can never match.
    for word in EXACT_STOP_WORDS + PHRASE_STOP_WORDS:
        assert _norm_text(word) == word, f"{word!r} does not survive normalisation"


def test_the_sql_normaliser_does_not_use_the_class_that_destroys_indic_text():
    """The SQL twin, guarded mechanically. `[:alnum:]` is not alnum enough: a
    combining mark is no more alphanumeric to iswalnum() than to Python's `\\w`,
    and the two normalisers must agree or a needle never equals a haystack."""
    assert "[^[:alnum:]]" not in SRC
    assert "'[[:space:][:punct:]]+'" in SRC


def test_an_address_is_folded_only_by_case_and_whitespace():
    """Gmail's dot-and-plus equivalence is true of Gmail and false of most
    Indian business domains. Folding a.b@firm.in into ab@firm.in would merge two
    real colleagues and drop one of them from the send."""
    assert _norm_email(" Meera@Example.IN ") == "meera@example.in"
    assert _norm_email("a.b@firm.in") != _norm_email("ab@firm.in")


def test_a_phone_is_folded_to_its_last_ten_digits():
    assert _norm_phone("+91 98765 43210") == "9876543210"
    assert _norm_phone("09876543210") == "9876543210"
    assert _norm_phone("9876543210") == "9876543210"
    assert _norm_phone("123") == "123"
    assert _norm_phone(None) == ""


def test_the_lexicon_has_no_entry_that_would_match_everything():
    """A one or two character term inside a word-boundary search still matches
    far too much, and a lexicon nobody trusts is a lexicon nobody runs."""
    for term in MARKETING_LEXICON:
        assert len(term.strip()) >= 3, f"lexicon term too short to be safe: {term!r}"
