"""Send one email campaign to its pending recipients.

── THE COLUMN THAT DOES NOT EXIST ───────────────────────────────────────────

This file selected `html_content` from `staging.prachar_campaigns`. Checked
against the live catalog (project toacecaewujfxjfrjwco, schema `staging`), that
table has `subject`, `body_html`, `channel`, `status` — and no `html_content` at
all. asyncpg raised UndefinedColumnError on the first statement, so
`send_campaign` could not send a campaign under any circumstances. It is the
same defect as the four in `tests/test_prachar_audience.py` and the four in
`sequence_step_executor.py`: a name invented rather than looked up.

It was invisible because nothing called it. The dispatcher registers it as
`send_campaign`, and no skill template in the live database references that
handler; `/cron/marketing` reached it only through
`services.skills.marketing_skills`, which did not exist. The interactive
`POST /prachar/campaigns/{id}/send` has its own inline dispatcher in
`routers/prachar.py` and never came through here — which is why 11 campaigns
show 'sent' while this function has never completed once.

── A CAMPAIGN WITH NO CONTACT ROWS IS NOT A CAMPAIGN WITH NO AUDIENCE ───────

`prachar_campaign_contacts` is populated by the interactive send route at the
moment the operator presses the button. A SCHEDULED campaign has never been
through that route, so when the cron picks it up the table holds nothing for it.
The version of this function that only read that table would have found zero
recipients, marked the campaign 'sent', and reported success — the same lie in a
new place. So the audience is resolved and materialised here when it is missing.
"""

import html
import logging

import outbound
import os

log = logging.getLogger(__name__)

#: Why a contact was not written as sent. Read by a human in the campaign
#: report, so it says what to do about it rather than naming a variable.
#: Names BOTH gates: the mode and the per-org list stop a send the same way,
#: and this row must not claim "the mode" about an org-suppressed message.
_SUPPRESSED = ("suppressed: the outbound gate refused this send "
               "(OUTBOUND_MODE=dry, or this organisation is on "
               "OUTBOUND_SUPPRESSED_ORGS), so nothing left the building. "
               "Nobody received this.")

BATCH_SIZE = 50

#: The upper bound on one campaign's fan-out in a single call.
#:
#: Unchanged from the original. Worth stating rather than leaving as a bare
#: literal in the SQL: a campaign larger than this is not refused, it is sent in
#: this many messages and the remainder stays 'pending' for the next pass.
MAX_RECIPIENTS_PER_RUN = 5000


async def send_campaign(pool, campaign_id: str) -> dict:
    """Send `campaign_id` to everyone still pending on it.

    Returns {total, sent, failed} — or {..., "error": <reason>} when it refused,
    which is what `marketing_skills.process_scheduled_campaigns` counts as a
    failure rather than as a send of zero.
    """
    campaign = await pool.fetchrow(
        """
        SELECT c.id, c.org_id, c.name, c.subject, c.body_html, c.channel,
               c.status, c.template_id, c.audience_filter, o.name AS org_name
        FROM staging.prachar_campaigns c
        JOIN staging.organisations o ON o.id = c.org_id
        WHERE c.id = $1::uuid
        """,
        campaign_id,
    )
    if not campaign:
        return {"total": 0, "sent": 0, "failed": 0, "error": "campaign_not_found"}

    if campaign["status"] not in ("scheduled", "sending"):
        return {"total": 0, "sent": 0, "failed": 0,
                "error": f"invalid_status_{campaign['status']}"}

    # ── THE CHANNEL REFUSAL ─────────────────────────────────────────────────
    #
    # `prachar_campaigns.channel` CHECKs against ('email','sms','whatsapp') and
    # the live table holds 12 whatsapp campaigns and 12 sms ones. Neither can be
    # delivered: `routers/whatsapp.py::send_wa_message` stores a row 'pending'
    # behind a `TODO: Call Meta Cloud API`, and there is no SMS provider in this
    # repo at all.
    #
    # This function used to read the column and then send EMAIL regardless. That
    # is worse than not sending, in two compounding ways. The message goes to the
    # wrong medium — an SMS body rendered as an email — and it goes to a
    # DIFFERENT SET OF PEOPLE, because `_resolve_audience` filters
    # `email IS NOT NULL AND email != ''` and `/send` then drops everyone on the
    # EMAIL suppression list. So a WhatsApp campaign's audience is "contacts with
    # an email address who have not opted out of email", which has no necessary
    # overlap with the people the marketer selected a WhatsApp channel to reach,
    # and every one of them is receiving email they never consented to.
    #
    # Refusing is the only honest answer available. Silently downgrading a
    # channel is what produced the defect; asking the operator to pick a channel
    # the product can actually deliver is not a regression from a send that
    # should never have happened.
    if (campaign["channel"] or "email") != "email":
        log.warning(
            "Campaign %s ('%s') has channel '%s'. Prachar can only deliver email; "
            "refusing rather than sending email to the email audience.",
            campaign_id, campaign["name"], campaign["channel"],
        )
        return {"total": 0, "sent": 0, "failed": 0,
                "error": f"channel_not_deliverable_{campaign['channel']}"}

    subject, body_html = await _resolve_content(pool, campaign)
    if not subject or not body_html:
        return {"total": 0, "sent": 0, "failed": 0, "error": "no_subject_or_body"}

    org_id = str(campaign["org_id"])

    await pool.execute(
        "UPDATE staging.prachar_campaigns SET status = 'sending', updated_at = NOW() "
        "WHERE id = $1::uuid",
        campaign_id,
    )

    await _materialise_audience(pool, campaign)

    # `lower(u.email)` on the join rather than a plain `=`. `add_unsubscribe`
    # lowercases before it INSERTs, but rows written before it did — and any row
    # from an import — can hold mixed case, and a case-sensitive comparison there
    # is a suppression list that quietly fails to suppress.
    recipients = await pool.fetch(
        """
        SELECT cc.id, cc.contact_id, cc.email, c.name
        FROM staging.prachar_campaign_contacts cc
        JOIN staging.graha_contacts c ON c.id = cc.contact_id
        LEFT JOIN staging.prachar_unsubscribes u
            ON u.org_id = $2::uuid AND lower(u.email) = lower(cc.email)
        WHERE cc.campaign_id = $1::uuid
          AND cc.status = 'pending'
          AND cc.email IS NOT NULL
          AND cc.email <> ''
          AND u.id IS NULL
        LIMIT $3
        """,
        campaign_id, org_id, MAX_RECIPIENTS_PER_RUN,
    )

    total = len(recipients)
    sent = 0
    failed = 0
    suppressed = 0

    for r in recipients:
        # The campaign BODY is the org's own authored HTML and stays raw — that
        # is the feature. The substituted CONTACT NAME is not: it is third-party
        # data landing inside that HTML, so a contact named `<img src=x
        # onerror=…>` had their own markup rendered live in the mail. Escaped
        # here rather than at the campaign, so the distinction between "markup
        # we authored" and "text someone gave us" stays visible at the join.
        #
        # The SUBJECT is plain text and must NOT be escaped: an entity there
        # renders literally as "&amp;" in the inbox.
        safe_name = html.escape(r["name"] or "")
        rendered_subject = (subject or "").replace("{{name}}", r["name"] or "")
        body = (body_html or "").replace("{{name}}", safe_name)
        body = _with_unsubscribe(body, org_id, r["email"], campaign["org_name"])
        try:
            # NOT awaited. `send_email` is sync — it threads internally and
            # returns bool. Awaiting it raised TypeError AFTER the send thread
            # had already started, so the mail went out and this contact was
            # then written back as 'failed'. A retry of the campaign resent to
            # everyone who had in fact received it.
            from email_service import send_email

            send_email(r["email"], rendered_subject, body,
                       purpose="prachar_campaign", ref=f"campaign:{campaign_id}")

            # ── 'sent' ONLY IF SOMETHING COULD HAVE LEFT ────────────────────
            #
            # `send_email` returns True when the outbound gate SUPPRESSED the
            # message — deliberately, because the operator asked for nothing to
            # leave the building — so its return value cannot tell the two
            # apart. Reading the gate directly can.
            #
            # This is the same disease `adc980b8` cured for reminders, left
            # standing in the module whose only job is sending: 1,562 reminders
            # said 'sent' against 1,562 outbound_log rows that said
            # 'suppressed', a perfect 1:1.
            #
            # 'suppressed' IS NOW ITS OWN STATUS (migration 147). This first
            # shipped as 'failed' with the reason in `error_message`, because
            # the CHECK had no better word — but that put a message nobody tried
            # to send in the same bucket as a genuine delivery failure, which is
            # the bucket a person goes to looking for something to fix, and left
            # the reason in a column no screen reads. `error_message` is still
            # written: the status says what happened, the message says why.
            #
            # `is_suppressed(org_id)`, not `DRY_RUN`: the per-org list
            # (OUTBOUND_SUPPRESSED_ORGS) stops a listed org's sends while the
            # process is LIVE, where DRY_RUN reads False — the mode alone
            # would stamp 'sent' over mail the gate refused. `org_id` is the
            # campaign's own org, the one every send in this loop is filed
            # under.
            if outbound.is_suppressed(org_id):
                await pool.execute(
                    "UPDATE staging.prachar_campaign_contacts "
                    "SET status = 'suppressed', error_message = $2 WHERE id = $1::uuid",
                    r["id"], _SUPPRESSED,
                )
                suppressed += 1
            else:
                await pool.execute(
                    "UPDATE staging.prachar_campaign_contacts "
                    "SET status = 'sent', sent_at = NOW() WHERE id = $1::uuid",
                    r["id"],
                )
                sent += 1
        except Exception as exc:                            # noqa: BLE001
            await pool.execute(
                "UPDATE staging.prachar_campaign_contacts "
                "SET status = 'failed', error_message = $2 WHERE id = $1::uuid",
                r["id"], f"{type(exc).__name__}: {exc}"[:500],
            )
            failed += 1
            log.warning("Campaign send failed for contact %s", r["contact_id"])

    # `total_recipients` is what the dashboard sums, and it was being left at
    # whatever the interactive route wrote. `total_sent` existed on the table and
    # nothing had ever written it at all.
    # A campaign that reached nobody is not 'sent'. It is 'suppressed'
    # (migration 147) — not 'paused', which this first shipped as and which
    # means a PERSON stopped it. `sent_at` is CLEARED rather than left alone:
    # the interactive route stamps it before dispatch, so
    # `total_sent = 0 AND sent_at IS NULL` is only true if this makes it true.
    # `not sent`, not `suppressed and not sent`: a run where every send RAISED
    # delivered nothing either, and the narrower guard wrote 'sent' over it.
    if not sent:
        await pool.execute(
            "UPDATE staging.prachar_campaigns "
            "SET status = 'suppressed', total_recipients = $2, total_sent = 0, "
            "    sent_at = NULL, updated_at = NOW() "
            "WHERE id = $1::uuid",
            campaign_id, total,
        )
    else:
        await pool.execute(
            "UPDATE staging.prachar_campaigns "
            "SET status = 'sent', total_recipients = $2, total_sent = $2, updated_at = NOW() "
            "WHERE id = $1::uuid",
            campaign_id, sent,
        )

    return {"total": total, "sent": sent, "failed": failed,
            "suppressed": suppressed}


async def _resolve_content(pool, campaign) -> tuple[str, str]:
    """Subject and body, falling back to the linked template for whichever is blank.

    The same rule the interactive send route applies, so a campaign built from a
    template sends the same mail whichever path delivers it.
    """
    subject = campaign["subject"] or ""
    body_html = campaign["body_html"] or ""
    if campaign["template_id"] and (not subject or not body_html):
        tmpl = await pool.fetchrow(
            "SELECT subject, body_html FROM staging.prachar_templates "
            "WHERE id = $1::uuid AND org_id = $2::uuid AND is_active = TRUE",
            str(campaign["template_id"]), str(campaign["org_id"]),
        )
        if tmpl:
            subject = subject or tmpl["subject"]
            body_html = body_html or tmpl["body_html"]
    return subject, body_html


async def _materialise_audience(pool, campaign) -> int:
    """Write the campaign's contact rows if the send route never did.

    Returns how many were added.

    The resolver is imported from `routers.prachar` rather than reimplemented,
    and the import is deferred to call time. Both halves of that are deliberate.
    A second copy of `_resolve_audience` would drift from the one the preview
    uses, and the preview drifting from the send is the promise that module's own
    docstring says the product must keep. Deferring the import keeps a service
    module from pulling a whole router — and its `require_module` gate and its
    Pydantic models — into every process that merely imports the skill registry.
    """
    existing = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.prachar_campaign_contacts WHERE campaign_id = $1::uuid",
        str(campaign["id"]),
    )
    if existing:
        return 0

    from routers.prachar import _resolve_audience

    org_id = str(campaign["org_id"])
    contacts = await _resolve_audience(pool, org_id, campaign["audience_filter"] or {})
    added = 0
    for c in contacts:
        if not c.get("email"):
            continue
        await pool.execute(
            "INSERT INTO staging.prachar_campaign_contacts "
            "(campaign_id, contact_id, email, org_id) "
            "VALUES ($1::uuid, $2::uuid, $3, $4::uuid) ON CONFLICT DO NOTHING",
            str(campaign["id"]), str(c["id"]), c["email"], org_id,
        )
        added += 1
    log.info("Campaign %s: materialised %d recipient(s) from its audience filter",
             campaign["id"], added)
    return added


def _with_unsubscribe(body: str, org_id: str, email: str, org_name: str) -> str:
    """Attach the opt-out. Never optional — see `services/prachar_unsubscribe.py`.

    Failure here does NOT stop the send, and that balance is worth stating.
    Marketing mail with no unsubscribe link is a legal exposure; marketing mail
    that fails to leave the building because the encryption key is unset is an
    outage. The gap is narrow — `mint` can only fail when neither
    FIELD_ENCRYPTION_KEY nor JWT_SECRET is set, and `server.py` refuses to boot
    without JWT_SECRET — so this branch is close to unreachable in a running
    deployment, and it is logged at ERROR rather than swallowed so that a
    deployment which somehow reaches it is visible.
    """
    from services import prachar_unsubscribe as unsub

    try:
        token = unsub.mint(org_id, email)
        return unsub.append_footer(
            body, unsub.link(os.getenv("BACKEND_URL", ""), token), org_name or "")
    except Exception:                                       # noqa: BLE001
        log.error("Could not build an unsubscribe link for a campaign send — "
                  "the message is going out WITHOUT one.", exc_info=True)
        return body
