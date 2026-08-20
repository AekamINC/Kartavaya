"""
The three cards that exist to say "no".

These handlers have no arithmetic worth checking. Their whole product is a
CLAIM ABOUT WHAT THE PRODUCT CANNOT DO, and a claim like that fails in exactly
three ways:

  1. It repeats a blocker that has since been fixed, so a reader is told a
     feature is impossible while somebody else uses it.
  2. It reports "could not check" as "checked and found nothing", so an outage
     in the check reads as a clean bill.
  3. It drifts from the skill it points at — the WhatsApp card and the email
     ladder start disagreeing about what a chase is owed.

Every test below is one of those three, or the two house rules that a card in
front of a CA must never break: no UUID rendered as a name, and — for #56 —
never a word about a FREE window, which is the whole reason the folio rejected
it and the whole reason the downgrade is shippable.

The fake pool matches on a FRAGMENT OF THE SQL, never on call order, and raises
on a query nobody anticipated rather than quietly returning an empty list. A
handler that grows a fourth query must be looked at, not silently zeroed.
"""
import asyncio
import inspect
import json
import re
from datetime import datetime, timedelta, timezone

import pytest

from services.skills.data import blocked_and_downgraded as mod
from services.skills.data.blocked_and_downgraded import (
    brief_ticket_sla_feasibility,
    check_template_required_soon,
    check_whatsapp_chase_leg,
)
from services.skills.data.chase_ladder import LADDER

ORG = "11111111-2222-3333-4444-555555555555"

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

#: Keys whose value is a ROW HANDLE the UI acts on, which the contract permits.
#: Everything else carrying a uuid is a uuid shown to a human.
ID_KEYS = {"entity_id", "conversation_id"}


class FakePool:
    """Canned rows keyed on a fragment of the SQL.

    `rules` is an ordered list of (fragment, rows-or-callable). The callable form
    takes the bind arguments, which is how the six `to_regclass` probes are told
    apart — they are the same SQL six times and differ only in `$1`.
    """

    def __init__(self, rules):
        self.rules = list(rules)
        self.seen: list[tuple[str, tuple]] = []

    def _match(self, sql, args):
        self.seen.append((sql, args))
        for fragment, rows in self.rules:
            if fragment in sql:
                return rows(args) if callable(rows) else rows
        raise AssertionError(
            f"no canned rows for a query the handler ran:\n{sql}\n"
            f"Add a rule — an unanticipated query must not read as zero rows.")

    async def fetch(self, sql, *args):
        return self._match(sql, args)

    async def fetchrow(self, sql, *args):
        rows = self._match(sql, args)
        return rows[0] if rows else None


def _uuid_leaks(node, key=None, path="") -> list[str]:
    """Every place a uuid is rendered somewhere a name belongs."""
    out = []
    if isinstance(node, dict):
        for k, v in node.items():
            out += _uuid_leaks(v, k, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += _uuid_leaks(v, key, f"{path}[{i}]")
    elif isinstance(node, str) and UUID_RE.match(node) and key not in ID_KEYS:
        out.append(path)
    return out


def _strings(node) -> list[str]:
    """Every string in the tree, keys included — a caveat hidden in a key name
    is still shown to a reader."""
    if isinstance(node, dict):
        out = []
        for k, v in node.items():
            out.append(str(k))
            out += _strings(v)
        return out
    if isinstance(node, list):
        return [s for v in node for s in _strings(v)]
    return [node] if isinstance(node, str) else []


# ── the population and blockers for #47 ──────────────────────────────────────

def _now():
    return datetime.now(timezone.utc)


def _chase_pool(*, tasks=None, waba=0, wa_log=0, checklists=(), links=0,
                reminders=None):
    due = _now() - timedelta(days=12)
    tasks = tasks if tasks is not None else [{
        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "task_id": "task_orgA0000001",
        "title": "Send us the July bank statements",
        "due_at": due,
        # Deliberately a name and not an id — the contract's rule, and the
        # column is denormalised onto the row for exactly this.
        "created_by_name": "Priya Sharma",
    }]
    return FakePool([
        ("FROM staging.outbound_log",
         [{"total": 100, "whatsapp": wa_log, "email": 90, "push": 10}]),
        ("FROM staging.varta_business_accounts",
         [{"total": waba, "active": waba}]),
        ("to_regclass",
         lambda args: [{"t": args[0] if args[0] in checklists else None}]),
        ("FROM public.task_clients", [{"rows_for_this_org": links}]),
        ("FROM public.tasks", tasks),
        ("FROM staging.reminders", reminders or []),
    ])


def test_47_reports_every_blocker_and_routes_nothing():
    out = asyncio.run(check_whatsapp_chase_leg(_chase_pool(), ORG))

    assert out["counts"]["blockers_still_true"] == 3
    assert out["counts"]["routable_on_whatsapp"] == 0
    # The denominator has to add up, or "0 routable" is a number over nothing.
    assert (out["counts"]["routable_on_whatsapp"]
            + out["counts"]["not_routable_on_whatsapp"]
            == out["counts"]["waiting_on"] == 1)
    # Every item must SAY why, not merely be false.
    assert all(i["why_not_routable"] for i in
               out["would_be_chased_if_the_leg_existed"])
    json.dumps(out, default=str)


def test_47_points_at_the_ladder_that_actually_works():
    """A reader must not be able to mistake this for the working chaser."""
    out = asyncio.run(check_whatsapp_chase_leg(_chase_pool(), ORG))
    assert out["use_instead"] == "check_chase_ladder"
    assert "check_chase_ladder" in out["limitations"][0]
    assert "EMAIL ladder" in out["limitations"][0]


def test_47_cannot_drift_from_the_email_ladder():
    """The rungs are IMPORTED. If somebody re-types them here, this fails.

    Two chasers with two ladders is how a firm ends up chasing on whichever
    number it happened to open, and neither screen looks wrong.
    """
    out = asyncio.run(check_whatsapp_chase_leg(_chase_pool(), ORG))
    assert out["ladder"] == [
        {"days_past_due": d, "action": a, "direction": k} for d, a, k in LADDER
    ]


def test_47_a_blocker_that_gets_fixed_stops_being_reported(monkeypatch):
    """The failure this card is most likely to commit: repeating the folio.

    Give the org a Business Account AND a Niyam whatsapp channel, and the first
    blocker must flip. A card that says "impossible" after somebody built it is
    worse than no card.
    """
    monkeypatch.setattr(mod, "_niyam_delivery_surface", lambda: {
        "checked": True,
        "channels_niyam_can_deliver_on": ["email", "inapp", "push", "whatsapp"],
        "channels_known_but_not_built": [],
        "verbs": ["whatsapp.send"],
        "has_whatsapp_channel": True,
        "has_whatsapp_verb": True,
    })
    out = asyncio.run(check_whatsapp_chase_leg(
        _chase_pool(waba=1, wa_log=12), ORG))

    sender = out["blockers"][0]
    assert sender["still_true"] is False
    assert out["counts"]["blockers_still_true"] == 2
    assert out["counts"]["connected_business_accounts"] == 1
    assert out["counts"]["whatsapp_rows_in_outbound_log"] == 12
    # And the per-item reason must lose the sender line, not keep it.
    reasons = out["would_be_chased_if_the_leg_existed"][0]["why_not_routable"]
    assert not any("no WhatsApp sender" in r for r in reasons)


def test_47_a_checklist_table_appearing_flips_the_second_blocker():
    out = asyncio.run(check_whatsapp_chase_leg(
        _chase_pool(checklists=("staging.document_requests",)), ORG))
    checklist = out["blockers"][1]
    assert checklist["still_true"] is False
    assert checklist["evidence"]["tables_found"] == ["staging.document_requests"]
    assert out["counts"]["checklist_tables_found"] == 1


def test_47_could_not_check_never_reads_as_checked(monkeypatch):
    """§8. An unreadable Niyam is not a Niyam without WhatsApp."""
    monkeypatch.setattr(mod, "_niyam_delivery_surface", lambda: {
        "checked": False,
        "why_not": "the Niyam constants could not be imported (boom)",
    })
    out = asyncio.run(check_whatsapp_chase_leg(_chase_pool(), ORG))

    assert out["blockers"][0]["evidence"]["niyam"]["checked"] is False
    assert any("COULD NOT BE READ" in l for l in out["limitations"]), (
        "an unreadable check must be declared, or an outage in the check reads "
        "as a confirmed blocker")


def test_47_the_real_niyam_constants_are_what_gets_reported():
    """Not a mock. This is the live claim, and if Niyam grows a WhatsApp
    channel tomorrow this test is the thing that notices."""
    surface = mod._niyam_delivery_surface()
    assert surface["checked"] is True, "the Niyam constants must be importable"
    assert isinstance(surface["channels_niyam_can_deliver_on"], list)
    assert surface["verbs"], "the verb list must not be empty"


def test_47_counts_a_suppressed_chase_as_no_chase():
    """A reminder that was suppressed was NOT received.

    Counting one promotes an item up the ladder on a message nobody read, and
    then escalates to a partner about a client who was never written to. The
    query must therefore ask for delivered rows only.
    """
    pool = _chase_pool()
    asyncio.run(check_whatsapp_chase_leg(pool, ORG))
    reminders_sql = [s for s, _ in pool.seen if "staging.reminders" in s]
    assert reminders_sql, "the handler must read what was already chased"
    assert "status = 'sent'" in reminders_sql[0]
    assert "suppressed" not in reminders_sql[0]


def test_47_every_org_scoped_query_carries_the_tenant_filter():
    """The one bug that silently prints another practice's data.

    `to_regclass` is exempt and only that: it is a catalog lookup with no tenant
    column to filter on, and the handler says so in a comment.
    """
    pool = _chase_pool()
    asyncio.run(check_whatsapp_chase_leg(pool, ORG))
    for sql, args in pool.seen:
        if "to_regclass" in sql:
            continue
        assert "org_id = $1::uuid" in sql or "id = $1::uuid" in sql, sql
        assert args and args[0] == ORG, sql


def test_47_the_client_link_count_is_not_a_product_wide_number():
    """`public.task_clients` has no org_id. A bare count(*) over it would be a
    whole-product figure printed as this org's — true today only because the
    table is empty everywhere, which is not a reason."""
    pool = _chase_pool()
    asyncio.run(check_whatsapp_chase_leg(pool, ORG))
    sql = next(s for s, _ in pool.seen if "public.task_clients" in s)
    assert "JOIN public.tasks" in sql
    assert "team_id" in sql


def test_47_says_it_capped_the_list():
    tasks = [{
        "id": f"aaaaaaaa-bbbb-cccc-dddd-{i:012d}",
        "task_id": f"task_orgA{i:07d}",
        "title": f"Records for client {i}",
        "due_at": _now() - timedelta(days=30),
        "created_by_name": "Priya Sharma",
    } for i in range(3)]
    out = asyncio.run(check_whatsapp_chase_leg(
        _chase_pool(tasks=tasks), ORG, limit=3))
    assert out["counts"]["was_capped"] is True
    assert any("capped at 3" in l for l in out["limitations"])
    assert any("NOT capped" in l for l in out["limitations"]), (
        "the blocker counts are whole-org and must not inherit the cap's caveat")


def test_47_renders_no_uuid_where_a_name_belongs():
    out = asyncio.run(check_whatsapp_chase_leg(_chase_pool(), ORG))
    assert _uuid_leaks(out) == []
    assert out["would_be_chased_if_the_leg_existed"][0]["escalate_to"] \
        == "Priya Sharma"


# ── #56, the downgrade ───────────────────────────────────────────────────────

def _conv_pool(convs, *, approved=6, pending=2, total=10, waba=0):
    return FakePool([
        ("FROM staging.varta_conversations", convs),
        ("FROM staging.varta_templates",
         [{"total": total, "approved": approved,
           "utility": max(0, approved - 1), "pending": pending}]),
        ("FROM staging.varta_business_accounts", [{"n": waba}]),
    ])


def _conv(name="Divya Nair", *, hours_ago=None, status="open",
          assigned="Anita Rao", replies=2):
    return {
        "conversation_id": "0356b277-fafb-41b7-bbe2-f8f2b4d59e73",
        "status": status,
        "contact_name": name,
        "assigned_to_name": assigned,
        "last_inbound": (None if hours_ago is None
                         else _now() - timedelta(hours=hours_ago)),
        "replies_sent": replies,
    }


def test_56_never_says_the_window_was_free():
    """The reason #56 was rejected. From 1 October 2026 Meta bills in-window
    free-form replies, so warning that a FREE window is closing warns about
    something that stops existing — and this is the downgrade, not that card.

    `limitations` is excluded first: the caveat explaining why the card does not
    talk about free messaging necessarily contains the phrase.
    """
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=2), _conv(hours_ago=40)]), ORG))
    body = dict(out)
    body.pop("limitations")
    haystack = " ".join(_strings(body)).lower()
    for banned in ("free", "no charge", "chargeable", "₹", "inr", "per message"):
        assert banned not in haystack, (
            f"{banned!r} appears outside limitations; this card takes no view "
            f"on what Meta charges")


def test_56_frames_the_consequence_as_needing_a_template():
    # 22 hours since they wrote, so 2 hours left on a 24-hour window — inside
    # the 4-hour warning band. `hours_ago` is time since the window OPENED.
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=22)]), ORG))
    item = out["template_required_soon"][0]
    assert item["state"] == "a template will be required"
    assert "approved template" in item["reason"]
    assert "6 approved template" in item["what_you_can_send_after_this"]


def test_56_the_window_is_a_parameter_and_moves_the_answer():
    """Meta policy, not statute. Hardcoding 24 would make this card wrong on the
    day Meta changes it, silently and in the safe-looking direction."""
    convs = [_conv(hours_ago=14)]
    wide = asyncio.run(check_template_required_soon(
        _conv_pool(convs), ORG, window_hours=24))
    narrow = asyncio.run(check_template_required_soon(
        _conv_pool(convs), ORG, window_hours=12))

    assert wide["counts"]["still_answerable_in_your_own_words"] == 1
    assert wide["counts"]["template_already_required"] == 0
    assert narrow["counts"]["template_already_required"] == 1
    assert narrow["counts"]["still_answerable_in_your_own_words"] == 0
    # And the figure carries its own age, so a reader can weigh it.
    assert wide["window_hours"] == 24.0
    assert wide["window_hours_true_as_of"] == mod.WINDOW_HOURS_TRUE_AS_OF


def test_56_a_reply_from_the_firm_does_not_extend_the_window():
    """The commonest misreading of this rule. The clock is the newest INBOUND
    message; 40 outbound replies since do not reopen anything."""
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=40, replies=40)]), ORG))
    assert out["counts"]["template_already_required"] == 1
    assert out["template_already_required"][0]["replies_sent"] == 40


def test_56_never_written_to_us_is_its_own_state():
    """A business cannot open a conversation in its own words. That is not the
    same as a window that opened and shut, and it must be counted apart."""
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=None)]), ORG))
    item = out["template_already_required"][0]
    assert item["hours_left"] is None
    assert "never written" in item["reason"]
    assert out["counts"]["never_heard_from_this_contact"] == 1


def test_56_no_approved_template_is_a_different_sentence():
    """"You will need an approved template" is useless advice to a firm that
    has none. Then the true statement is that it cannot reply at all."""
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=22)], approved=0), ORG))
    assert "NOTHING" in out["template_required_soon"][0][
        "what_you_can_send_after_this"]
    assert any("NO approved template" in l for l in out["limitations"])


def test_56_an_empty_list_is_not_a_clean_bill():
    """No conversations at all must not look like a firm on top of its inbox."""
    out = asyncio.run(check_template_required_soon(_conv_pool([]), ORG))
    assert out["counts"]["conversations_examined"] == 0
    assert any("FOUND NOTHING TO CHECK" in l for l in out["limitations"])


def test_56_a_silent_inbox_is_declared_rather_than_shown_as_calm():
    """The live shape on 2026-08-20: 38 conversations, newest inbound 18 days
    old, so nothing is closing. That empty urgent list means silence."""
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=24 * 18)]), ORG))
    assert out["counts"]["template_required_within_warning_window"] == 0
    assert out["days_since_anything_arrived"] == 18
    assert any("inbox is silent" in l for l in out["limitations"])


def test_56_says_when_there_is_no_business_account_behind_the_rows():
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=2)], waba=0), ORG))
    assert any("NO CONNECTED WHATSAPP BUSINESS ACCOUNT" in l
               for l in out["limitations"])
    connected = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=2)], waba=1), ORG))
    assert not any("NO CONNECTED WHATSAPP BUSINESS ACCOUNT" in l
                   for l in connected["limitations"])


def test_56_renders_a_name_or_a_phrase_but_never_a_user_handle():
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=22, assigned=None)]), ORG))
    assert out["template_required_soon"][0]["assigned_to"] == "(nobody assigned)"
    assert _uuid_leaks(out) == []
    assert not any(s.startswith("user_") for s in _strings(out))


def test_56_hours_left_is_never_negative():
    """A negative countdown reads as time remaining to anyone skimming."""
    out = asyncio.run(check_template_required_soon(
        _conv_pool([_conv(hours_ago=200)]), ORG))
    assert out["template_already_required"][0]["hours_left"] == 0.0


def test_56_resolved_threads_are_excluded_at_the_query():
    pool = _conv_pool([_conv(hours_ago=2)])
    asyncio.run(check_template_required_soon(pool, ORG))
    sql = next(s for s, _ in pool.seen if "varta_conversations" in s)
    assert "c.status <> 'resolved'" in sql
    assert "direction = 'inbound'" in sql, (
        "the window clock must filter to inbound inside the aggregate")


# ── #60, the product decision ────────────────────────────────────────────────

TICKET_COLS = ["id", "org_id", "contact_id", "subject", "priority", "status",
               "category", "resolved_at", "is_active", "created_at"]


def _ticket_pool(*, table=True, messages=False, columns=None, rows=0):
    cols = TICKET_COLS if columns is None else columns
    return FakePool([
        ("to_regclass", lambda args: [{
            "t": args[0] if (
                (args[0] == "staging.graha_tickets" and table)
                or (args[0] == "staging.graha_ticket_messages" and messages)
            ) else None}]),
        ("information_schema.columns", [{"column_name": c} for c in cols]),
        ("FROM staging.graha_tickets", [{"n": rows}]),
    ])


def test_60_says_loudly_that_a_ticket_table_does_exist():
    """The folio said "missing is not a column but the entire feature". The
    stub catchup 081 recreated is real, and `routers/dristi.py` still lists it
    as a report source — so a reader who greps finds a table. That is exactly
    how a convincing zero is built, and it has to be said out loud."""
    out = asyncio.run(brief_ticket_sla_feasibility(_ticket_pool(), ORG))
    assert out["what_exists"]["staging.graha_tickets"] is True
    assert "stale" in out["folio_finding_correction"]
    assert "EXISTS" in out["folio_finding_correction"]
    assert out["what_exists"]["its_columns"] == TICKET_COLS


def test_60_if_the_table_were_gone_the_folio_would_be_upheld():
    """The correction must be computed, not asserted. A hardcoded 'the folio is
    stale' would itself go stale the day somebody drops the stub."""
    out = asyncio.run(brief_ticket_sla_feasibility(
        _ticket_pool(table=False), ORG))
    assert out["what_exists"]["staging.graha_tickets"] is False
    assert "exactly right" in out["folio_finding_correction"]
    assert out["counts"]["ticket_tables_present"] == 0


def test_60_finds_no_sla_column_and_would_find_one():
    absent = asyncio.run(brief_ticket_sla_feasibility(_ticket_pool(), ORG))
    assert absent["counts"]["sla_columns_found"] == 0
    assert absent["what_exists"]["any_sla_column"] is False

    present = asyncio.run(brief_ticket_sla_feasibility(
        _ticket_pool(columns=TICKET_COLS + ["sla_due_at"]), ORG))
    assert present["counts"]["sla_columns_found"] == 1
    assert present["what_exists"]["any_sla_column"] is True


def test_60_a_zero_is_never_offered_as_no_breaches():
    out = asyncio.run(brief_ticket_sla_feasibility(_ticket_pool(), ORG))
    assert any("NOT 'no breaches'" in l for l in out["limitations"])
    assert "product decision" in out["verdict"]


def test_60_invents_no_ticket_model():
    """The failure the folio was guarding against. This card must not sprout a
    breach list, a priority split or an hours-to-respond number — the point is
    that none of those can exist."""
    keys = set(_strings(out := asyncio.run(
        brief_ticket_sla_feasibility(_ticket_pool(), ORG))))
    for invented in ("breaches", "breached", "sla_status", "hours_to_respond",
                     "at_risk", "response_time"):
        assert invented not in out, invented
        assert invented not in out["counts"], invented
    assert not any(isinstance(v, list) and v and isinstance(v[0], dict)
                   for v in out.values()), (
        "no per-ticket list may appear — there are no tickets")
    assert keys  # the scan actually looked at something


def test_60_names_a_buildable_alternative_rather_than_only_refusing():
    """Client questions really do arrive, through WhatsApp and inbound email.
    Refusing without saying that leaves the owner with no next move."""
    out = asyncio.run(brief_ticket_sla_feasibility(_ticket_pool(), ORG))
    joined = " ".join(out["limitations"])
    assert "varta_conversations" in joined
    assert "graha_inbound_emails" in joined
    assert len(out["what_would_have_to_exist"]) == 4


def test_60_stays_short():
    """#60's whole verdict is that it is a question, not a card. A long answer
    would be the card pretending to be one."""
    out = asyncio.run(brief_ticket_sla_feasibility(_ticket_pool(), ORG))
    assert len(json.dumps(out, default=str)) < 4000


# ── the house rules, for all three ───────────────────────────────────────────

ALL_THREE = (
    (check_whatsapp_chase_leg, _chase_pool),
    (check_template_required_soon,
     lambda: _conv_pool([_conv(hours_ago=2), _conv(hours_ago=None)])),
    (brief_ticket_sla_feasibility, _ticket_pool),
)


@pytest.mark.parametrize("handler,pool_factory", ALL_THREE,
                         ids=lambda x: getattr(x, "__name__", ""))
def test_the_shape_the_dispatcher_requires(handler, pool_factory):
    out = asyncio.run(handler(pool_factory(), ORG))
    assert isinstance(out, dict)
    assert isinstance(out.get("counts"), dict) and out["counts"]
    assert isinstance(out.get("limitations"), list) and out["limitations"]
    assert all(isinstance(l, str) and l.strip() for l in out["limitations"])
    # The output is handed to a reader as JSON. Decimal and datetime both break
    # this, and a mock pool would never have shown it.
    json.dumps(out, default=str)


@pytest.mark.parametrize("handler,_", ALL_THREE,
                         ids=lambda x: getattr(x, "__name__", ""))
def test_every_handler_can_run_unattended(handler, _):
    """A parameter with no default cannot be supplied by a 6am schedule, and the
    dispatcher refuses the run outright. Mirrors
    tests/test_a_skill_can_run_unattended.py so this batch fails here first."""
    required = [
        name for name, p in inspect.signature(handler).parameters.items()
        if name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
        and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
    ]
    assert not required, f"{handler.__name__} needs {required} named"
