"""Sanvaad (internal messaging) metrics — proposal 62 §4: message volume and
active participants per channel, and response time.

THE GOVERNING CONSTRAINT, stated here and pinned by test_metrics_sanvaad.py:

    AGGREGATE ONLY — no analytic may expose message content or read state to
    anyone but its owner. No message body, no per-person read state, no DM
    contents in any SELECT; channel-level counts only.

What that means in SQL, concretely:

· `samvada_messages.content` and `metadata` never appear in any query here —
  not selected, not filtered on, not even touched in a predicate.
· `samvada_read_receipts` and `samvada_channel_members.last_read_at` are
  never read. The one metric that would need them (read rate) is declared
  ABSENT below with the constraint as its reason, so the catalogue states the
  rule instead of hiding a gap.
· A DM channel never appears as its own row. `samvada_channels.name` is ''
  for a DM (routers/messaging.py: find_or_create_dm inserts it empty and the
  UI titles it from the members), so a per-DM row would be identified only by
  who is in it — exactly the pairwise fact the rule forbids. Every channel
  split therefore folds ALL DMs into one 'Direct messages' row by grouping on
  the label, not the channel id. The trade: two non-DM channels sharing a
  name also collapse into one row, which is accepted — the fold IS the
  privacy mechanism.
· `sender_id` is used inside COUNT(DISTINCT …) and in a same-author
  comparison, never as an output column — a count of people is channel-level;
  a list of people is not (and names-not-ids would forbid the raw id anyway).

Schema facts (migration 058, cross-checked against routers/messaging.py which
carries a measured column inventory in its docstring):

· staging.samvada_messages: org_id, channel_id, sender_id TEXT, type CHECK
  ('text','image','file','system'), is_deleted soft delete, created_at
  TIMESTAMPTZ. Deleted messages are excluded everywhere — a deleted message
  is withdrawn, and counting it would disagree with every unread count in the
  product (messaging.py filters is_deleted = FALSE the same way).
· type = 'system' rows (joins, renames) are excluded everywhere: they are
  furniture, not communication, and a channel migration would otherwise
  register as a burst of activity.
· staging.samvada_channels: org_id, name ('' on DMs), type CHECK
  ('public','private','dm'), is_archived. Messages in an archived channel
  still count — the conversation happened (the same flow rule as archived
  tasks in core.py).

RESPONSE TIME — the definition implemented, chosen over grander ones:
the median (percentile_cont(0.5), never AVG) gap in hours between a message
and the NEXT message by a DIFFERENT author in the SAME channel, ordered by
created_at. Honest limits, stated rather than hidden:

· It is conversational cadence, not SLA: nothing marks a message as a
  question, so a "response" is simply the next voice change.
· Threads are not separated — parent_message_id is ignored and a channel is
  one timeline. A busy channel with interleaved threads reads FASTER than it
  answers; the median damps but does not remove this.
· DMs are excluded (`c.type <> 'dm'`). An org-wide median would normally
  drown any pair, but in a two-person org the DM median IS the pair's
  private cadence — the aggregate-only rule loses to that edge, so the
  metric claims channels only and says so in its label.
· The gap is bucketed and window-filtered by the RESPONDING message's date,
  computed in the outer query so LAG still sees a prompt that fell before
  the window's first day — a reply on the 1st to a message from the 31st is
  a real gap, not a discarded row.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: The one channel label allowed out of this module. DMs fold into a single
#: literal; an unnamed non-DM channel is labelled honestly rather than as ''.
#: Grouping is on this LABEL (GROUP BY 1), never on the channel id — the fold
#: is what keeps a DM from being identified by its membership.
_CHANNEL_LABEL = (
    "CASE WHEN c.type = 'dm' THEN 'Direct messages' "
    "ELSE COALESCE(NULLIF(c.name, ''), 'Unnamed channel') END"
)

#: Every message these metrics count: live (not withdrawn) and human (not
#: system furniture). Applied identically in all three queries.
_LIVE_HUMAN = "m.is_deleted = FALSE AND m.type <> 'system' "


@metric(
    key="sanvaad.message_volume",
    module="sanvaad",
    label="Messages sent",
    unit="count",
    grain="flow",
    dimensions=("channel",),
    drill="sanvaad.channels",
    description="Messages sent during the period — deleted and system "
                "messages excluded; group_by=channel splits the window by "
                "channel, with every DM folded into one 'Direct messages' "
                "row. Counts only: message content is never read.",
)
def message_volume(req: MetricRequest):
    if req.group_by == "channel":
        return (
            f"SELECT {_CHANNEL_LABEL} AS channel, COUNT(*) AS value "
            "FROM staging.samvada_messages m "
            "JOIN staging.samvada_channels c ON c.id = m.channel_id "
            "WHERE m.org_id = $1::uuid AND " + _LIVE_HUMAN +
            "AND m.created_at::date BETWEEN $2::date AND $3::date "
            "GROUP BY 1 ORDER BY value DESC, channel",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "m.created_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value "
        "FROM staging.samvada_messages m "
        "WHERE m.org_id = $1::uuid AND " + _LIVE_HUMAN +
        "AND m.created_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="sanvaad.active_participants",
    module="sanvaad",
    label="Active participants",
    unit="count",
    grain="flow",
    dimensions=("channel",),
    drill="sanvaad.channels",
    description="People who sent at least one message during the period — a "
                "COUNT(DISTINCT sender), never a list of people. "
                "group_by=channel gives the participant count per channel "
                "for the whole window, DMs folded into one row; the column "
                "does not sum to the org total, because one person is active "
                "in many channels.",
)
def active_participants(req: MetricRequest):
    if req.group_by == "channel":
        return (
            f"SELECT {_CHANNEL_LABEL} AS channel, "
            "COUNT(DISTINCT m.sender_id) AS value "
            "FROM staging.samvada_messages m "
            "JOIN staging.samvada_channels c ON c.id = m.channel_id "
            "WHERE m.org_id = $1::uuid AND " + _LIVE_HUMAN +
            "AND m.created_at::date BETWEEN $2::date AND $3::date "
            "GROUP BY 1 ORDER BY value DESC, channel",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "m.created_at")
    return (
        f"SELECT {period} AS period, COUNT(DISTINCT m.sender_id) AS value "
        "FROM staging.samvada_messages m "
        "WHERE m.org_id = $1::uuid AND " + _LIVE_HUMAN +
        "AND m.created_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="sanvaad.response_time",
    module="sanvaad",
    label="Response time",
    unit="hours",
    grain="flow",
    drill="sanvaad.channels",
    description="Median hours between a message and the next message by a "
                "different author in the same channel — conversational "
                "cadence, not an SLA. Median (percentile_cont), never mean: "
                "one overnight gap must not move the headline. DMs are "
                "excluded so a two-person org's private cadence never "
                "surfaces; threads are not separated (see module docstring).",
)
def response_time(req: MetricRequest):
    # The window filter sits OUTSIDE the LAG subquery on purpose: the
    # responding message decides the bucket, and its prompt may legitimately
    # precede the window. Filtering inside would silently drop every
    # first-of-window response. `m.id` breaks created_at ties so the gap
    # sequence is deterministic under concurrent sends.
    period = bucket_expr(req.bucket, "g.created_at")
    return (
        f"SELECT {period} AS period, "
        "percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap_hours)::float AS value, "
        "COUNT(*) AS responses "
        "FROM ("
        "  SELECT m.created_at, m.sender_id, "
        "    LAG(m.sender_id) OVER w AS prev_sender, "
        "    EXTRACT(EPOCH FROM (m.created_at - LAG(m.created_at) OVER w)) / 3600.0 AS gap_hours "
        "  FROM staging.samvada_messages m "
        "  JOIN staging.samvada_channels c ON c.id = m.channel_id "
        "  WHERE m.org_id = $1::uuid AND " + _LIVE_HUMAN +
        "  AND c.type <> 'dm' "
        "  WINDOW w AS (PARTITION BY m.channel_id ORDER BY m.created_at, m.id)"
        ") g "
        "WHERE g.prev_sender IS NOT NULL AND g.prev_sender <> g.sender_id "
        "AND g.created_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — computable, but forbidden ──────────────────────────────

absent_metric(
    key="sanvaad.read_rate",
    module="sanvaad",
    label="Read rate",
    unit="pct",
    grain="flow",
    absent="Computable but FORBIDDEN, which proposal 62 §10 says to state "
           "rather than hide: staging.samvada_read_receipts and "
           "samvada_channel_members.last_read_at hold per-person read state, "
           "and this module's governing rule is aggregate-only — read state "
           "is visible to no one but its owner, so no analytic SELECT may "
           "touch those columns. Closing this is an owner decision to relax "
           "the privacy rule, not a migration.",
)
