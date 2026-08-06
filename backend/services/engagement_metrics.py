"""
engagement_metrics.py — the line between what Prachar measured and what it made up.

WHY THIS FILE EXISTS
--------------------
`staging.prachar_campaigns` carries four columns that describe what a RECIPIENT
did with a message:

    total_opened  total_clicked  total_bounced  total_unsubscribed

Nothing in this product has ever written any of them. There is no Resend
webhook, no tracking pixel, no click redirect, and no other ingestion path — a
grep of the backend returns readers only, and the two SQL statements that touch
the row after a send (`routers/prachar.py:623` and `:683`) set `status`,
`total_recipients` and `updated_at` and nothing else.

A column nobody writes reading 0 is survivable: a zero looks like "no
engagement yet", which is very nearly the truth. What is NOT survivable is the
state the live database is actually in. Measured on 6 August 2026, schema
`staging`:

    org fae87907 "Unicode Group" — a paying customer — 8 sent campaigns
    carrying 51 opens, 29 clicks, 1 bounce and 2 unsubscribes, every row
    stamped `updated_at = 2026-08-05 12:41:32.496118+00`. Identical to the
    microsecond across all eight, on campaigns dated 5 March to 11 July, in an
    org whose Prachar rows were seeded four months after those dates.

Those are demo-seed numbers, and the dashboard renders them as measurement: a
delivery funnel with an open rate, a click rate measured against opens, and a
bounce cell that turns red above 5%. A fabricated number presented as a
measurement is worse than the zero, because a zero invites the question and a
34% open rate answers it.

THE DECISION, AND WHY IT IS THIS ONE
------------------------------------
Two honest options existed. Build the receiver, or stop claiming the number.

Building the receiver was not chosen, and the reason is worth writing down so
nobody re-litigates it from scratch:

  * The receiver is not the hard part — the WhatsApp webhook at
    `routers/whatsapp.py:322` is a working template for a signature-verified
    public POST, and Resend does post `email.delivered/opened/clicked/bounced/
    complained`.
  * The hard part is the join. A Resend event carries the provider's message
    id, and `staging.prachar_campaign_contacts` HAS NO COLUMN FOR IT — the
    table is `id, campaign_id, contact_id, email, status, sent_at, opened_at,
    clicked_at, error_message, created_at, org_id`. So an event cannot be
    attributed to the row it belongs to without a migration, and a migration
    that has not been applied is a receiver that crashes on its first event.
    (`staging.outbound_log` does carry `provider_message_id` alongside
    `detail->>'ref' = 'campaign:<uuid>'`, so the join has a future — but
    through a table whose one-writer rule lives in `services/outbound_log.py`,
    and that is a design conversation, not a patch.)
  * A receiver that is written but has no `RESEND_WEBHOOK_SECRET` set refuses
    every request, which leaves the customer looking at exactly the same
    fabricated numbers plus two hundred lines of unexercised code. That is the
    shape of defect this whole audit is about.

So: the product stops presenting these four columns as facts until something
measures them. `redact_engagement` is applied at the ROUTER, not in the
frontend, because the values must not reach a client at all — three screens
read them today and a fourth would inherit the lie for free.

This is deliberately NOT a data fix. `migrations/106_*.sql` zeroes the eight
seeded rows and is written but NOT applied; even after it is, this module keeps
the four columns unclaimable, because the next demo seed would otherwise
reintroduce the same numbers and nothing would notice.

THE DAY A RECEIVER LANDS
------------------------
Set `ENGAGEMENT_RECEIVER` to the dotted name of the module that writes the
columns. That is the whole switch — every reader flips at once, and
`tests/test_engagement_is_not_invented.py` fails until it is set, because the
tripwire there looks for a writer in the source and refuses to let one exist
while this module still says the numbers are unmeasured.

WHY A PURE MODULE
-----------------
The pool is mocked in tests and resolves any table name handed to it, so a test
that goes through the database proves nothing about which figures a response
carries. The decision is arithmetic over a dict, so it lives in a function that
takes a dict and returns one.
"""

from __future__ import annotations

# ── The tripwire, written out literally ──────────────────────────────────────
# NOT computed as "every integer column minus the ones we allow". A forbidden
# set derived by subtraction cannot detect the allowed set widening: add a fifth
# engagement column tomorrow and a subtractive rule would classify it as
# measured by default, silently. These four are named, and a fifth has to be
# named here too before anything will report it.
UNMEASURED_COLUMNS: tuple[str, ...] = (
    "total_opened",
    "total_clicked",
    "total_bounced",
    "total_unsubscribed",
)

# The two that ARE measured, listed so the distinction is legible next to its
# opposite rather than inferred from an absence.
#   total_recipients — written by `routers/prachar.py` on every send.
#   total_sent       — written by `services/skills/action/campaign_sender.py`.
MEASURED_COLUMNS: tuple[str, ...] = ("total_recipients", "total_sent")

# The dotted module name of whatever ingests delivery events, or None.
# None is not a placeholder — it is the current, measured state of the product.
ENGAGEMENT_RECEIVER: str | None = None

# One sentence, in one place, for every screen that has to say why a figure is
# missing. Screens phrase it their own way; this is what they must not
# contradict.
UNMEASURED_REASON = (
    "Opens, clicks and bounces are not measured — nothing in the product "
    "receives delivery events yet."
)


def engagement_is_measured() -> bool:
    """Whether anything in this product writes the four columns above."""
    return ENGAGEMENT_RECEIVER is not None


def redact_engagement(row) -> dict:
    """A copy of `row` with unmeasured engagement replaced by None.

    None rather than 0, and that is the entire point of the function. Zero is a
    measurement — it says nobody opened it. None says nobody looked. A screen
    that receives 0 has no way to tell those apart and will draw a 0% open rate
    with a straight face, which is the smaller version of the same lie the
    seeded 34% tells.

    `engagement_measured` is attached ONLY to rows that actually carry one of
    the four columns, so this stays safe to call on any dict a route is about to
    return without decorating unrelated payloads with a flag that means nothing
    there.
    """
    out = dict(row)
    touched = [c for c in UNMEASURED_COLUMNS if c in out]
    if not touched:
        return out

    if engagement_is_measured():
        out["engagement_measured"] = True
        return out

    for column in touched:
        out[column] = None
    out["engagement_measured"] = False
    out["engagement_note"] = UNMEASURED_REASON
    return out


def redact_engagement_rows(rows) -> list[dict]:
    """`redact_engagement` over a list. The list case is the common one."""
    return [redact_engagement(r) for r in rows]


# ── The same lie in a smaller font ───────────────────────────────────────────
#
# `GET /prachar/campaigns/{id}/stats` counts `staging.prachar_campaign_contacts`
# by status, and three of its six buckets are
#
#     COUNT(*) FILTER (WHERE status='opened' OR status='clicked')
#     COUNT(*) FILTER (WHERE status='clicked')
#     COUNT(*) FILTER (WHERE status='bounced')
#
# Those three statuses are never written. The only values that column ever holds
# are 'pending' (insert default), 'sent' and 'failed' — set by the send loop in
# `routers/prachar.py` and by `campaign_sender.py`. So the three buckets are 0
# for every campaign that has ever existed, and the screen renders "Opened 0 —
# 0%" beside a real "Sent 7", which reads as a measured result.
#
# Not seeded, so this one never showed a fabricated figure. It is still a claim
# the product cannot support, from the same missing receiver, and it belongs on
# the same switch — otherwise fixing the dashboard just moves the reader one
# click deeper to find the confident zero.
UNMEASURED_CONTACT_STATS: tuple[str, ...] = ("opened", "clicked", "bounced")


def redact_contact_stats(row) -> dict:
    """`redact_engagement` for the per-campaign contact breakdown.

    A separate function and a separate tuple because these keys are ordinary
    English words. Reusing `redact_engagement` here would mean a helper that
    nulls anything called "opened" in any payload it is ever pointed at, which
    is how a general rule starts eating measurements that ARE real.
    """
    out = dict(row)
    touched = [k for k in UNMEASURED_CONTACT_STATS if k in out]
    if not touched:
        return out

    if engagement_is_measured():
        out["engagement_measured"] = True
        return out

    for key in touched:
        out[key] = None
    out["engagement_measured"] = False
    out["engagement_note"] = UNMEASURED_REASON
    return out
