"""lead_ingest.py — turning an Indian lead marketplace's payload into a contact.

JustDial and IndiaMART are the two places an Indian SMB's enquiries actually
arrive, and until now they arrived in somebody's inbox. This module is the join
between their payload shapes and `staging.graha_contacts`.

── THEY ARE NOT PUBLISH TARGETS, AND THEY WORK DIFFERENTLY FROM EACH OTHER ────

IndiaMART is a PULL. Their CRM API hands back the enquiries in a time window
when you ask for them, keyed by `glusr_crm_key`. So it is a scheduled read, and
the interesting failure is asking too often — their documented limit is one call
per 15 minutes for a 7-day window, and a 429 is not an error to retry into.

JustDial is a PUSH. They POST each lead to a URL you register with your account
manager. So there is no key to call with, only a URL to be called ON — which
means the URL itself has to be unguessable and has to say which organisation it
belongs to. `webhook_key` is that: a random public field on the credentials row,
copied out of the Connectors page the way an OAuth redirect URL is.

── WHAT COUNTS AS THE SAME LEAD ───────────────────────────────────────────────

One test that is ours, then the product's own.

  1. the SOURCE's own id       `UNIQUE_QUERY_ID` from IndiaMART, `leadid` from
                               JustDial. Exact, and the only one that survives a
                               person changing their number. Stored in
                               `custom_data->>'external_id'`, and genuinely new
                               — no other inbound path has an external id.
  2. everything else           `services/contact_dedupe.find_duplicates`, which
                               is the product's one dedupe and already mirrors
                               migration 024's generated columns.

CORRECTED 2026-08-07, before this ever ran. The first version of this file
hand-rolled its own phone and email normalisation — a THIRD copy of a rule
migration 024 owns and `contact_dedupe` already mirrors. The semantics happened
to be identical, so there was no bug that day; the file's own docstring says
what the next day looks like ("Shared by the Graha router and by every inbound
source that can create a contact… Call find_duplicates() at write time"). Only
EXACT matches are attached to — `match_type` of email or phone. Fuzzy is
review-only there and stays review-only here: auto-merging a marketplace lead
into the wrong contact on a name similarity is unrecoverable in the salesperson's
hands.

A hit UPDATES rather than inserting, and records a `graha_activities` note —
which is what `POST /inbound-leads` already does for the same event, so an
enquiry that arrives by API and one that arrives by notification email land in
the CRM timeline identically. `last_contacted_at` is left alone: they contacted
us, and resetting it would hide the lead from the overdue-follow-up report that
exists to surface exactly these.

── THE OTHER LEAD DOOR ────────────────────────────────────────────────────────

`POST /api/v1/graha/inbound-leads` predates this and does a DIFFERENT thing: it
receives the notification EMAIL these marketplaces send to a lead-capture
address, and regex-scrapes the buyer out of the body
(`services/lead_parser.py`). It is the fallback for an account with no API
access; this module is the authoritative feed for one that has it.

They can both be on at once, and that is safe rather than accidental: both write
`staging.graha_contacts` and both dedupe on the same normalised keys through the
same function, so the second arrival of one enquiry attaches to the first
instead of duplicating it. What is NOT safe is assuming one supersedes the
other — an org with the email address configured keeps receiving through it
until somebody clears `organisations.settings->>'lead_capture_email'`.

── NOTHING HERE TRUSTS THE PAYLOAD ────────────────────────────────────────────

Both bodies arrive over the internet from a third party, and one of them
(JustDial) arrives on an UNAUTHENTICATED route. So every field is length-capped
and coerced to text here rather than at the database, the whole raw record is
kept in `custom_data.raw` for the operator who has to reconcile a missing lead,
and `org_id` NEVER comes from the payload — it comes from the credentials row
the URL resolved to.
"""
from __future__ import annotations

import json
import logging
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

log = logging.getLogger(__name__)

#: Their field, our column, and a ceiling. A marketplace that starts sending a
#: 40kB "message" must not be able to grow one row without bound.
MAX_TEXT = 2000
MAX_SHORT = 200

#: IndiaMART's documented floor between calls. Asking more often returns their
#: rate-limit body rather than leads, and a scheduler that retried into it would
#: turn one impatient poll into an outage of the whole integration.
INDIAMART_MIN_INTERVAL = timedelta(minutes=15)

#: The widest window their CRM API will answer for in one call.
INDIAMART_MAX_WINDOW = timedelta(days=7)


@dataclass
class Lead:
    """One enquiry, in our words rather than theirs."""
    source: str
    external_id: str = ""
    name: str = ""
    phone: str = ""
    email: str = ""
    company: str = ""
    message: str = ""
    occurred_at: Optional[str] = None
    raw: dict = field(default_factory=dict)

    @property
    def usable(self) -> bool:
        """A lead with no way to reach anybody is not a lead.

        Dropped rather than stored: a contact row with a name and no phone or
        email cannot be actioned, and it dilutes every count on the CRM screens
        with rows nobody can work.
        """
        return bool(self.phone.strip() or self.email.strip())


def _txt(value: Any, cap: int = MAX_SHORT) -> str:
    if value is None:
        return ""
    return str(value).strip()[:cap]


def new_webhook_key() -> str:
    """The unguessable half of a JustDial webhook URL.

    A public field, not a secret: it is pasted into JustDial's console the way a
    redirect URL is, and it identifies rather than authenticates. What it must
    be is UNGUESSABLE — the route it keys is unauthenticated by necessity, so a
    short or sequential value would let anyone write leads into any org.
    """
    return secrets.token_urlsafe(24)


# ── IndiaMART ───────────────────────────────────────────────────────────────

def normalise_indiamart(record: dict) -> Lead:
    """One row of their `RESPONSE` array.

    Their field names are SHOUTED and abbreviated, and several carry a value we
    already have a column for under a different name — `SENDER_MOBILE` is a
    phone, `SUBJECT` and `QUERY_MESSAGE` are both enquiry text and either may be
    the only one populated. Mapped here, once, so nothing downstream has to know
    that `GLUSR_USER_NAME` is a person.
    """
    r = record or {}
    message = " · ".join(x for x in (
        _txt(r.get("SUBJECT"), MAX_TEXT), _txt(r.get("QUERY_MESSAGE"), MAX_TEXT),
        _txt(r.get("QUERY_PRODUCT_NAME"), MAX_SHORT),
    ) if x)[:MAX_TEXT]
    return Lead(
        source="indiamart",
        external_id=_txt(r.get("UNIQUE_QUERY_ID") or r.get("QUERY_ID")),
        name=_txt(r.get("SENDER_NAME") or r.get("GLUSR_USER_NAME")),
        phone=_txt(r.get("SENDER_MOBILE") or r.get("SENDER_MOBILE_ALT")),
        email=_txt(r.get("SENDER_EMAIL") or r.get("SENDER_EMAIL_ALT")),
        company=_txt(r.get("SENDER_COMPANY")),
        message=message,
        occurred_at=_txt(r.get("QUERY_TIME")),
        raw=r,
    )


def indiamart_window(last_pulled_at: Optional[datetime], now: datetime) -> tuple[str, str]:
    """(start, end) in the format their API insists on: `DD-MON-YYYYHH:MM:SS`.

    Anchored on the LAST SUCCESSFUL PULL rather than on a fixed lookback, so a
    scheduler that missed six hours catches up instead of losing them — and
    clamped to their seven-day ceiling, because a first run against an account
    that has been collecting for a year would otherwise ask for a year and be
    refused.

    One minute of overlap is deliberate. Their `QUERY_TIME` has second
    resolution and their clock is not ours; a window that started exactly where
    the last one ended would drop any lead landing in that second. Re-reading a
    lead costs nothing — dedupe is on their own id.
    """
    end = now
    start = (last_pulled_at - timedelta(minutes=1)) if last_pulled_at else (now - timedelta(days=1))
    if end - start > INDIAMART_MAX_WINDOW:
        start = end - INDIAMART_MAX_WINDOW
    fmt = "%d-%b-%Y%H:%M:%S"
    return start.strftime(fmt), end.strftime(fmt)


def parse_indiamart_body(body: Any) -> tuple[list[Lead], str]:
    """(leads, error). Their API answers 200 for a refusal, so the body decides.

    `CODE` is 200 on success and their rate-limit and bad-key responses come
    back as 200 with a different `CODE` and a `MESSAGE`. Treating the HTTP
    status as the answer is how an integration reports "0 new leads" every
    fifteen minutes for a week with an expired key.
    """
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return [], "IndiaMART returned something that is not JSON."
    if not isinstance(body, dict):
        return [], "IndiaMART returned an unexpected shape."

    code = str(body.get("CODE", "")).strip()
    if code and code != "200":
        return [], _txt(body.get("MESSAGE") or f"IndiaMART refused this ({code}).", MAX_TEXT)

    rows = body.get("RESPONSE")
    if rows is None:
        return [], _txt(body.get("MESSAGE") or "IndiaMART returned no RESPONSE block.", MAX_TEXT)
    if isinstance(rows, dict):                 # a single lead comes back unwrapped
        rows = [rows]
    if not isinstance(rows, list):
        return [], "IndiaMART's RESPONSE was not a list."

    return [normalise_indiamart(r) for r in rows if isinstance(r, dict)], ""


# ── JustDial ────────────────────────────────────────────────────────────────

def normalise_justdial(record: dict) -> Lead:
    """One pushed lead.

    JustDial's field names vary by account vintage — `mobile` and `phone` are
    both live in the wild, as are `name` and `prefix`+`name`. Every alternative
    seen is accepted rather than one being picked: this route is fed by a party
    we cannot ask to change, and a lead dropped because a key was spelled
    differently is a lead nobody knows was lost.
    """
    r = record or {}
    return Lead(
        source="justdial",
        external_id=_txt(r.get("leadid") or r.get("lead_id") or r.get("docid")),
        name=_txt(r.get("name") or r.get("prefix_name") or r.get("customer_name")),
        phone=_txt(r.get("mobile") or r.get("phone") or r.get("mobile_number")),
        email=_txt(r.get("email") or r.get("email_id")),
        company=_txt(r.get("company") or r.get("company_name")),
        message=_txt(r.get("category") or r.get("area") or r.get("branch_area"), MAX_TEXT),
        occurred_at=_txt(r.get("date") or r.get("datetime") or r.get("time")),
        raw=r,
    )


# ── Writing ─────────────────────────────────────────────────────────────────

async def ingest(pool, org_id: str, leads: list[Lead]) -> dict:
    """Write them, skipping the ones already here. Returns a count summary.

    Every write is scoped by `org_id`, which comes from the credentials row that
    the key in the URL resolved to — never from the payload. A marketplace
    cannot name the organisation its leads land in.
    """
    created = updated = skipped = 0
    for lead in leads:
        if not lead.usable:
            skipped += 1
            continue
        try:
            if await _upsert(pool, org_id, lead):
                created += 1
            else:
                updated += 1
        except Exception as exc:                       # noqa: BLE001 — reported
            # One malformed lead must not abandon the rest of the batch. A pull
            # that raised halfway would also not advance its watermark, so the
            # next run would re-read the same window and fail in the same place.
            log.warning("lead %s/%s could not be stored: %s",
                        lead.source, lead.external_id, exc)
            skipped += 1
    return {"created": created, "updated": updated, "skipped": skipped,
            "received": len(leads)}


async def _upsert(pool, org_id: str, lead: Lead) -> bool:
    """True if a new contact was created, False if an existing one was matched.

    Two lookups rather than one query, deliberately. The external id is ours to
    match on and no other inbound path has one; everything else goes through
    `contact_dedupe.find_duplicates`, which is the product's single dedupe and
    already mirrors migration 024's generated columns. A private copy of that
    normalisation is the drift that file exists to prevent.
    """
    from services.contact_dedupe import find_duplicates

    existing = None
    if lead.external_id:
        # The same enquiry arriving twice — a re-read window, a retried push.
        # Scoped to the SOURCE as well as the id, because "JD-55512" and
        # IndiaMART query 55512 are not the same enquiry.
        existing = await pool.fetchrow(
            "SELECT id FROM staging.graha_contacts "
            " WHERE org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL "
            "   AND custom_data->>'external_id' = $2 "
            "   AND custom_data->>'source' = $3 "
            " ORDER BY created_at ASC LIMIT 1",
            org_id, lead.external_id, lead.source,
        )

    if not existing:
        # EXACT only. `find_duplicates` also returns fuzzy name+company matches
        # for human review, and attaching a marketplace lead to the wrong person
        # on a name similarity is not recoverable by the salesperson who then
        # calls them.
        hits = await find_duplicates(
            pool, org_id, email=lead.email or None, phone=lead.phone or None,
        )
        exact = [h for h in hits if h.get("match_type") in ("email", "phone")]
        existing = exact[0] if exact else None

    note = f"[{lead.source} {lead.occurred_at or ''}] {lead.message}".strip()

    if existing:
        contact_id = str(existing["id"])
        # A `graha_activities` note, which is what `POST /inbound-leads` already
        # writes for this same event — so an enquiry arriving by API and one
        # arriving by notification email land in the CRM timeline identically.
        # Appended as history, never replacing anything: the second enquiry is
        # the evidence that this lead is warm.
        await pool.execute(
            "INSERT INTO staging.graha_activities "
            "(org_id, contact_id, activity_type, title, description, created_by) "
            "VALUES ($1::uuid, $2::uuid, 'note', $3, $4, $5)",
            org_id, contact_id,
            f"New {lead.source} enquiry"[:200], note,
            f"integration:{lead.source}",
        )
        # `last_contacted_at` is NOT touched. THEY contacted US, and letting an
        # inbound enquiry reset it would hide the lead from the overdue-
        # follow-up report that exists to surface exactly these.
        await pool.execute(
            "UPDATE staging.graha_contacts "
            "   SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $2::jsonb, "
            "       updated_at = NOW() "
            " WHERE id = $1::uuid",
            contact_id,
            json.dumps({"last_seen_source": lead.source,
                        "last_seen_external_id": lead.external_id}),
        )
        return False

    # NO ACTOR: a marketplace pushed this at us. `staging.niyam_events` CHECKs
    # `source <> 'app' OR actor_id IS NOT NULL`, so calling this an app action
    # would require inventing a person — and a rule reading "who added this
    # lead" would then name somebody who was asleep.
    from services.niyam.subjects import contact_created
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "INSERT INTO staging.graha_contacts "
                "  (org_id, name, email, phone, company, notes, contact_type, source, "
                "   created_by, custom_data) "
                "VALUES ($1::uuid, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), $6, "
                "        'lead', $7, $8, $9::jsonb) RETURNING *",
                org_id,
                # A marketplace lead with no name is ordinary — JustDial often sends a
                # number and a category and nothing else. Named for what it is rather
                # than left blank, so the CRM list is readable.
                lead.name or f"{lead.source.title()} enquiry",
                lead.email, lead.phone, lead.company, note,
                lead.source, f"integration:{lead.source}",
                json.dumps({"source": lead.source, "external_id": lead.external_id,
                            "occurred_at": lead.occurred_at, "raw": lead.raw}),
            )
            await contact_created(conn, org_id=org_id, actor_id=None,
                                  contact_id=row["id"], row=dict(row),
                                  source="import")
    return True
