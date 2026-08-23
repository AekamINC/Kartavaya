"""
check_broadcast_preflight — nested blocks that must NOT be hashed, and totals
whose names carry a warning.

Nothing here edits a list or changes a campaign's status, so every draft is
re-examined and re-reported for as long as it sits unsent. A firm that has read
the preflight, accepted the gap and decided to send anyway has nowhere to say so.

Two judgements pinned:
  · the three nested blocks (`no_address_at_all`,
    `duplicates_resolving_to_one_address`, `already_unsubscribed`) are capped
    SAMPLES rebuilt every run, and each moves `deliverable_now` when it moves —
    hashing them would count one change several times and void an ack because a
    different fifty rows happened to fit;
  · `unsubscribe_list_size` and `whatsapp_numbers_with_an_opt_in_flag` are
    org-level counts of distinct things, which is why they carry no
    `_summed_over_campaigns` suffix, and they must survive the rebuild.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

SKILL = "check_broadcast_preflight"
W = ACK_WIRING[SKILL]


def _c(campaign_id="k-1", name="August newsletter", channel="email",
       status="draft", claimed=60, unique=52, deliverable=40,
       no_address=8, dupes=3, unsub=12, **kw) -> dict:
    row = {
        "campaign_id": campaign_id,
        "campaign": name,
        "channel": channel,
        "status": status,
        "scheduled_at": None,
        "claimed_recipients": claimed,
        "in_segment": 61,
        "unique_addresses": unique,
        "deliverable_now": deliverable,
        "claimed_minus_deliverable": claimed - deliverable,
        "no_address_at_all": {"count": no_address, "rows": [], "rows_not_shown": 0},
        "duplicates_resolving_to_one_address": {
            "addresses": dupes, "extra_copies_avoided": dupes,
            "rows": [], "rows_not_shown": 0},
        "already_unsubscribed": {"count": unsub, "measured": True, "note": "…"},
        "no_recorded_opt_in": {"count": unique, "basis": "the size of the list"},
        "bounced_previously": {"measured": False, "state": "NOT MEASURED", "why": "…"},
        "channel_can_be_delivered": True,
        "ignored_filter_keys": [],
    }
    row.update(kw)
    return row


def _out(campaigns) -> dict:
    campaigns = list(campaigns)
    return {
        "as_at": "2026-08-23",
        "counts": {
            "campaigns_examined": len(campaigns),
            # Counts the SEGMENTS the query resolved, not the campaigns shown.
            "distinct_audience_filters": 4,
            "campaigns_on_an_undeliverable_channel": sum(
                1 for c in campaigns if c["channel_can_be_delivered"] is False),
            "claimed_recipients_summed_over_campaigns": sum(
                c["claimed_recipients"] for c in campaigns),
            "deliverable_summed_over_campaigns": sum(
                c["deliverable_now"] for c in campaigns),
            "no_address_summed_over_campaigns": sum(
                c["no_address_at_all"]["count"] for c in campaigns),
            "duplicate_extra_copies_summed_over_campaigns": sum(
                c["duplicates_resolving_to_one_address"]["extra_copies_avoided"]
                for c in campaigns),
            "already_unsubscribed_summed_over_campaigns": sum(
                c["already_unsubscribed"]["count"] for c in campaigns),
            # Org-level counts of DISTINCT things — no suffix, on purpose.
            "unsubscribe_list_size": 940,
            "whatsapp_numbers_with_an_opt_in_flag": 61,
            # Deliberately null and never 0.
            "bounced_previously": None,
            "campaigns_capped_at": 200,
            "was_capped": False,
        },
        "bounce_check": "NOT MEASURED",
        "campaigns": campaigns,
        "campaigns_not_shown": 0,
        "limitations": ["BOUNCES ARE NOT MEASURED AND ARE NOT REPORTED AS ZERO."],
    }


def _ack(f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(W.identity_of(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_campaign_stops_being_reported():
    f = _c()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["campaigns"] == []
    assert out["acknowledged"]["items"][0]["label"] == "August newsletter — email"


def test_renaming_a_draft_does_not_orphan_the_acknowledgement():
    """The name is edited while drafting; the campaign row is the fact."""
    acks = _ack(_c(name="August newsletter"))
    out = apply_wiring(SKILL, _out([_c(name="August newsletter (v2)")]), acks)
    assert out["campaigns"] == []


def test_two_campaigns_are_two_findings():
    one, two = _c(campaign_id="k-1"), _c(campaign_id="k-2")
    out = apply_wiring(SKILL, _out([one, two]), _ack(one))
    assert [c["campaign_id"] for c in out["campaigns"]] == ["k-2"]


def test_a_segment_that_explodes_brings_it_back():
    """A campaign acknowledged when it would reach 40 of a claimed 60 is not
    the same campaign when the segment resolves to 4,000."""
    acks = _ack(_c(deliverable=40, unique=52))
    out = apply_wiring(SKILL, _out([_c(deliverable=4000, unique=4200)]), acks)
    assert len(out["campaigns"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_recomputing_the_claimed_count_brings_it_back():
    """The handler warns the stored count can be stale — "a gap between claimed
    and deliverable can be a stale number rather than a dirty list" — so a firm
    that recomputed it has changed what the report says."""
    acks = _ack(_c(claimed=60))
    out = apply_wiring(SKILL, _out([_c(claimed=52)]), acks)
    assert len(out["campaigns"]) == 1


def test_scheduling_a_draft_brings_it_back():
    """"I read the preflight" was said about a draft."""
    acks = _ack(_c(status="draft"))
    out = apply_wiring(SKILL, _out([_c(status="scheduled",
                                       scheduled_at="2026-09-01")]), acks)
    assert len(out["campaigns"]) == 1


def test_the_nested_sample_blocks_are_not_hashed():
    """Each is a capped SAMPLE rebuilt every run, and each moves
    `deliverable_now` when it moves. Hashing them would count one change
    several times and void an acknowledgement because a different fifty rows
    happened to fit."""
    assert set(W.material_of(_c())) == {"deliverable_now", "unique_addresses",
                                        "claimed_recipients", "status"}
    acks = _ack(_c())
    moved = _c()
    moved["no_address_at_all"] = {"count": 8, "rows": [{"contact_id": "x"}],
                                  "rows_not_shown": 40}
    moved["duplicates_resolving_to_one_address"]["rows"] = [{"address": "a@b.c"}]
    assert apply_wiring(SKILL, _out([moved]), acks)["campaigns"] == []


def test_the_email_opt_in_block_is_not_hashed():
    """On an email campaign the handler sets `no_recorded_opt_in` to the SIZE
    OF THE WHOLE LIST by construction — "a statement about the schema, not
    about the recipients" — so it moves with the segment and says nothing of
    its own."""
    acks = _ack(_c())
    moved = _c()
    moved["no_recorded_opt_in"] = {"count": 999, "basis": "the size of the list"}
    assert apply_wiring(SKILL, _out([moved]), acks)["campaigns"] == []


# ── the totals ──────────────────────────────────────────────────────────────

def test_every_send_slot_total_is_rebuilt():
    keep = _c(campaign_id="k-1", claimed=60, deliverable=40, no_address=8,
              dupes=3, unsub=12)
    hide = _c(campaign_id="k-2", claimed=900, deliverable=800, no_address=50,
              dupes=20, unsub=30)
    out = apply_wiring(SKILL, _out([keep, hide]), _ack(hide))
    c = out["counts"]
    assert c["campaigns_examined"] == 1
    assert c["claimed_recipients_summed_over_campaigns"] == 60
    assert c["deliverable_summed_over_campaigns"] == 40
    assert c["no_address_summed_over_campaigns"] == 8
    assert c["duplicate_extra_copies_summed_over_campaigns"] == 3
    assert c["already_unsubscribed_summed_over_campaigns"] == 12


def test_the_undeliverable_channel_count_is_rebuilt():
    ok = _c(campaign_id="k-1")
    bad = _c(campaign_id="k-2", channel="sms", channel_can_be_delivered=False)
    out = apply_wiring(SKILL, _out([ok, bad]), _ack(bad))
    assert out["counts"]["campaigns_on_an_undeliverable_channel"] == 0


def test_the_org_level_counts_are_left_alone():
    """`unsubscribe_list_size` and `whatsapp_numbers_with_an_opt_in_flag` are
    counts of DISTINCT things, which is why they carry no
    `_summed_over_campaigns` suffix."""
    f = _c()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["counts"]["unsubscribe_list_size"] == 940
    assert out["counts"]["whatsapp_numbers_with_an_opt_in_flag"] == 61
    assert out["counts"]["distinct_audience_filters"] == 4


def test_the_bounce_answer_stays_null_and_never_becomes_zero():
    """"Deliberately null and never 0." An empty bounce list would mean "never
    looked", not "clean"."""
    f = _c()
    out = apply_wiring(SKILL, _out([f]), _ack(f))
    assert out["counts"]["bounced_previously"] is None
    assert out["bounce_check"] == "NOT MEASURED"


def test_a_malformed_nested_block_does_not_break_the_rebuild():
    good = _c(campaign_id="k-1", no_address=8)
    bad = _c(campaign_id="k-2")
    bad["no_address_at_all"] = None
    data = _out([good])
    data["campaigns"] = [good, bad]
    out = apply_wiring(SKILL, data, _ack(_c(campaign_id="k-9")))
    assert out["counts"]["no_address_summed_over_campaigns"] == 8


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_campaign_with_no_id_does_not_raise():
    out = apply_wiring(SKILL, _out([_c(campaign_id=None)]), _ack(_c()))
    assert len(out["campaigns"]) == 1


def test_a_shape_change_fails_open():
    f = _c()
    data = {"reports": [f], "counts": {"campaigns_examined": 1}}
    out = apply_wiring(SKILL, data, _ack(f))
    assert len(out["reports"]) == 1
    assert "acknowledged" not in out


def test_the_broadcast_key_round_trips():
    first = apply_wiring(SKILL, _out([_c()]), {"x": skill_ack.Ack("x")})
    f = first["campaigns"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out([_c()]), acks)["campaigns"] == []
