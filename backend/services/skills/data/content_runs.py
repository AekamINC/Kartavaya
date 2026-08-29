"""
content_runs — catalogue #31, #36 and #41.

Three skills whose TEMPLATE will also carry a model step. These handlers call no
model: they assemble the deterministic half, and the model — if a template
author adds one — writes prose around figures it never touches.

    pack_engagement_letter_inputs      #31  the facts, and why a letter cannot
                                            safely be drafted yet
    brief_vernacular_template_targets  #36  which templates, into which
                                            languages, with the placeholder
                                            inventory to validate against
    check_event_followup_split         #41  what actually happened to each
                                            registration

── #31 IS THE MOST DANGEROUS OUTPUT IN THE CATALOGUE ────────────────────────

The folio says so plainly, and it was chipped "near-free", which is how a
dangerous thing gets built cheaply. A model-drafted scope paragraph that
reaches eSign becomes a signed contract nobody wrote.

So this handler does NOT produce a letter and cannot be made to. It assembles
what a letter would be built FROM, and it returns `blockers` — the things that
must exist before any letter may issue:

  · a firm-authored clause library (there is none, so there is nothing to
    assemble FROM except a model's invention);
  · deterministic assembly, not generation;
  · a mandatory human diff against the previous letter;
  · a record of WHICH CLAUSE VERSION was signed.

While `blockers` is non-empty the honest output is the blocker list, and that
is what it returns. A skill that produced a letter anyway would be the single
worst thing in this product.

The MSMED interest clause is gated separately: it applies where the FIRM is the
MSME supplier, and nothing here records that the firm is one. It is offered as
a question, never as a clause.

── #36's PLACEHOLDER CHECK IS THE PRODUCT ───────────────────────────────────

Translating one utility template into the languages a firm's clients use is a
legitimate, bounded model call — once per template, never per send. What makes
it safe is that the placeholders are verified AFTERWARDS, deterministically,
against the inventory this handler emits. A model that silently renumbers
{{1}} and {{2}} produces a template Meta approves and that then sends the wrong
name to the wrong person.

The true billing unit is template x language x REVISION, and Meta rejections
force revisions — so the unit is not "ten templates".

── Measured live, read-only, 2026-08-20 ─────────────────────────────────────

  · `prachar_events`: 50 rows, ALL of them ended, all in the seeded org.
    `prachar_event_registrations`: 300 — 150 attended, 75 cancelled, 75
    no_show. The folio's correction holds exactly: the third bucket is
    CANCELLED and NO_SHOW rows that really exist, not an invented "never
    marked" state.
  · `varta_templates`: 10 rows, every one `language = 'en'`. So the target
    language set cannot be derived from what has already been translated —
    there is nothing but English — and NOTHING IN THIS PRODUCT RECORDS WHICH
    LANGUAGE A CLIENT PREFERS. #36 reports that rather than guessing from a
    name or a state, which would be worse than not answering.
  · `ganit_contracts`: 63 rows carrying `signature_status`, `signed_at` and a
    `contract_value` — enough to say what a previous engagement said, which is
    what a diff needs.
"""
import logging
import re
from datetime import date, timedelta

from services.skills.timeutil import as_date, days_between, utc_now

log = logging.getLogger(__name__)

#: What must exist before a drafted engagement letter may issue. Named here
#: rather than inline so the list is one thing a reader can find, and so
#: removing one is a visible edit rather than a quiet condition change.
ENGAGEMENT_BLOCKERS = (
    ("clause_library",
     "A firm-authored clause library. There is none, so a drafted scope "
     "paragraph would be a model's invention rather than the firm's words."),
    ("deterministic_assembly",
     "Assembly from that library by rule, not generation. A generated letter "
     "cannot be reviewed against anything."),
    ("human_diff",
     "A mandatory human diff against the previous letter for this client, "
     "shown before signature and not after."),
    ("clause_version_record",
     "A record of WHICH VERSION of each clause was signed. Without it a firm "
     "cannot say later what it agreed to."),
)

#: WhatsApp/Meta template placeholders are positional: {{1}}, {{2}}, ...
_PLACEHOLDER = re.compile(r"\{\{\s*(\d+)\s*\}\}")

#: Registration outcomes that really exist in the data, and what each one is
#: for. The folio's correction: the third bucket is cancelled/no_show rows, NOT
#: an invented "never marked" state.
FOLLOWUP_BUCKETS = (
    ("attended", "came", "thank them and move the relationship on"),
    ("no_show", "registered and did not come",
     "offer the material and a second date — they were interested enough to sign up"),
    ("cancelled", "cancelled",
     "acknowledge and ask what would have worked; do not pitch"),
)


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and this output is handed to a reader that way."""
    return default if value is None else float(value)


def _customer_sql(alias_client: str, alias_contact: str) -> str:
    """The customer's NAME, never an id, preferring the company.

    Same rule as every other module here: a CRM client is the COMPANY, and the
    last resort is a sentence rather than a blank, because an empty cell reads
    as a rendering fault.
    """
    return (
        f"COALESCE(NULLIF(btrim({alias_client}.name), ''), "
        f"         NULLIF(btrim({alias_contact}.company), ''), "
        f"         NULLIF(btrim({alias_contact}.name), ''), "
        f"         '(customer not recorded)')"
    )


# ══════════════════════════════════════════════════════════════════════════
# 31 · pack_engagement_letter_inputs
# ══════════════════════════════════════════════════════════════════════════

async def pack_engagement_letter_inputs(
    pool, org_id: str, months_back: int = 12, limit: int = 200,
) -> dict:
    """What an engagement letter would be built from — and why it cannot issue.

    Returns the facts and the blockers. It does NOT draft, and while `blockers`
    is non-empty a template built on this must not add a generation step that
    produces letter prose. See the module docstring: a model-drafted scope
    paragraph reaching eSign becomes a signed contract nobody wrote.
    """
    today = utc_now().date()
    since = today - timedelta(days=max(1, int(months_back)) * 31)
    cap = max(1, int(limit))

    # Existing engagements — what a diff would be against.
    rows = await pool.fetch(
        f"""
        SELECT k.id, k.title, k.contract_value, k.start_date, k.end_date,
               k.status, k.signature_status, k.signed_at,
               {_customer_sql('cl', 'ct')} AS customer
        FROM public.ganit_contracts k
        LEFT JOIN public.graha_contacts ct
               ON ct.id = k.contact_id AND ct.org_id = k.org_id
        LEFT JOIN public.graha_clients cl
               ON cl.id = ct.client_id AND cl.org_id = k.org_id
        WHERE k.org_id = $1::uuid
          AND k.is_active
        ORDER BY k.created_at DESC
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # Clients with an obligation on record but no engagement — the population a
    # letter run would be FOR. Empty until somebody fills the register (175).
    awaiting = await pool.fetch(
        """
        SELECT c.name AS customer, count(o.id) AS obligations
        FROM public.client_obligations o
        JOIN public.graha_clients c
          ON c.id = o.client_id AND c.org_id = o.org_id
        WHERE o.org_id = $1::uuid
          AND o.effective_to IS NULL
        GROUP BY c.name
        ORDER BY 2 DESC
        LIMIT $2::int
        """,
        org_id, cap,
    )

    signed = [r for r in rows if r["signed_at"] is not None]

    return {
        "as_at": today,
        "can_draft_a_letter": False,
        "why_not": (
            "This assembles what a letter would be built FROM. It does not "
            "draft one, and while any blocker below stands it must not: a "
            "model-written scope paragraph that reaches signature becomes a "
            "contract nobody in the firm wrote."
        ),
        "blockers": [
            {"blocker": key, "what_is_needed": text}
            for key, text in ENGAGEMENT_BLOCKERS
        ],
        "msmed_clause": {
            "include": None,
            "why": "The MSMED interest clause applies where THE FIRM is the "
                   "MSME supplier. Nothing in this product records that the "
                   "firm is one, so this is a question for the partner and "
                   "never a default.",
        },
        "counts": {
            "existing_engagements": len(rows),
            "of_those_signed": len(signed),
            "clients_with_obligations_on_record": len(awaiting),
            "blockers_outstanding": len(ENGAGEMENT_BLOCKERS),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "existing_engagements": [
            {
                "engagement_id": str(r["id"]),
                "title": r["title"],
                "customer": r["customer"],
                "value": _f(r["contract_value"]),
                "from": as_date(r["start_date"]),
                "to": as_date(r["end_date"]),
                "status": r["status"],
                "signature_status": r["signature_status"],
                "signed_on": as_date(r["signed_at"]),
            }
            for r in rows
        ],
        "clients_awaiting_an_engagement": [
            {"customer": r["customer"], "obligations_on_record": r["obligations"]}
            for r in awaiting
        ],
        "limitations": [
            "IT DRAFTS NOTHING. The output is inputs and blockers; any template "
            "built on this must not add a step that generates letter prose "
            "while a blocker stands.",
            "The list of clients awaiting an engagement comes from the client "
            "obligations register, which is empty until somebody records an "
            "obligation. An empty list here is 'nobody has recorded' and not "
            "'every client has an engagement'.",
            "Signature status is what this product recorded. A letter signed on "
            "paper, or through anything other than this product, is invisible "
            "here.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 36 · brief_vernacular_template_targets
# ══════════════════════════════════════════════════════════════════════════

async def brief_vernacular_template_targets(
    pool, org_id: str, limit: int = 200,
) -> dict:
    """Which templates could be translated, into what, and what to verify after.

    The placeholder inventory is the load-bearing part. A model that silently
    renumbers {{1}} and {{2}} produces a template Meta approves and which then
    sends the wrong name to the wrong person — so the check is DETERMINISTIC
    POST-VALIDATION against this inventory, never something the model is
    trusted to have done.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    templates = await pool.fetch(
        """
        SELECT id, name, language, category, body, header_content, footer, status
        FROM public.varta_templates
        WHERE org_id = $1::uuid
        ORDER BY name
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # What languages already exist for the SAME template name — i.e. what has
    # already been translated, which is the only language signal this product
    # actually holds.
    by_name: dict[str, set[str]] = {}
    for t in templates:
        by_name.setdefault(t["name"], set()).add(t["language"])

    items = []
    for t in templates:
        text = " ".join(
            part for part in (t["header_content"], t["body"], t["footer"]) if part
        )
        found = _PLACEHOLDER.findall(text)
        positions = sorted({int(x) for x in found})
        items.append({
            "template_id": str(t["id"]),
            "template": t["name"],
            "language": t["language"],
            "category": t["category"],
            "status": t["status"],
            # THE CONTRACT THE TRANSLATION MUST HONOUR, exactly.
            "placeholders": positions,
            "placeholder_count": len(positions),
            "already_in_languages": sorted(by_name.get(t["name"], set())),
            "verify_after_translation": (
                f"The translated body must contain exactly the placeholders "
                f"{positions} — the same numbers, each appearing the same "
                f"number of times. Check this in code against this list; do "
                f"not accept the model's own assurance."
            ),
        })

    languages_held = sorted({t["language"] for t in templates})

    return {
        "as_at": today,
        "billing_unit": "template x language x revision",
        "why_that_unit": (
            "A rejected template is revised and re-submitted, and each revision "
            "is another call. Costing this as 'one per template' understates it "
            "by however many times Meta says no."
        ),
        "target_languages": [],
        "why_no_targets": (
            "NOTHING IN THIS PRODUCT RECORDS WHICH LANGUAGE A CLIENT PREFERS. "
            "The only language signal held is on the templates themselves, and "
            f"every one is {languages_held or 'absent'}. Inferring a language "
            "from a person's name or their state would be worse than not "
            "answering, so the target set is a decision for the firm and this "
            "reports the inventory to make it with."
        ),
        "counts": {
            "templates_examined": len(templates),
            "distinct_template_names": len(by_name),
            "languages_held": len(languages_held),
            "templates_with_placeholders": sum(1 for i in items if i["placeholders"]),
            "capped_at": cap,
            "was_capped": len(templates) >= cap,
        },
        "templates": items,
        "limitations": [
            "The placeholder check is a CONTRACT for post-validation, not a "
            "guarantee. Nothing here has translated anything; verify the model's "
            "output against `placeholders` in code before submitting it.",
            "Which languages a firm's clients actually use is not recorded "
            "anywhere in this product, so no target set is proposed.",
            "A translated template still needs Meta's approval, and a rejection "
            "costs another revision — which is why the billing unit above "
            "includes the revision.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 41 · check_event_followup_split
# ══════════════════════════════════════════════════════════════════════════

async def check_event_followup_split(
    pool, org_id: str, days_back: int = 90, limit: int = 400,
) -> dict:
    """Registrations for events that have ended, split by what actually happened.

    The split is SQL. A model — if a template adds one — writes three short
    pieces of copy, one per bucket, and touches none of the figures.

    THE THIRD BUCKET IS REAL, and the folio corrects an earlier error here: it
    is `cancelled` and `no_show` rows that exist in the data, not an invented
    "never marked" state. Measured live: 150 attended, 75 cancelled, 75
    no_show across 300 registrations.
    """
    today = utc_now().date()
    since = today - timedelta(days=max(1, int(days_back)))
    cap = max(1, int(limit))

    rows = await pool.fetch(
        """
        SELECT e.id AS event_id, e.title, e.ends_at,
               r.status, count(r.id) AS n
        FROM public.prachar_events e
        LEFT JOIN public.prachar_event_registrations r
               ON r.event_id = e.id AND r.org_id = e.org_id
        WHERE e.org_id = $1::uuid
          AND e.is_active
          AND e.ends_at IS NOT NULL
          AND e.ends_at < NOW()
          AND e.ends_at >= $2::date
        GROUP BY e.id, e.title, e.ends_at, r.status
        ORDER BY e.ends_at DESC
        LIMIT $3::int
        """,
        org_id, since, cap,
    )

    events: dict[str, dict] = {}
    for r in rows:
        key = str(r["event_id"])
        ev = events.setdefault(key, {
            "event_id": key,
            "event": r["title"],
            "ended_on": as_date(r["ends_at"]),
            "days_since": days_between(today, as_date(r["ends_at"])),
            "by_outcome": {},
            "registrations": 0,
        })
        if r["status"] is not None:
            ev["by_outcome"][r["status"]] = int(r["n"] or 0)
            ev["registrations"] += int(r["n"] or 0)

    buckets = []
    for status, plain, action in FOLLOWUP_BUCKETS:
        total = sum(e["by_outcome"].get(status, 0) for e in events.values())
        buckets.append({
            "outcome": status,
            "in_plain_words": plain,
            "people": total,
            "next_step": action,
            # What a model step would be asked to write, if one is added.
            "copy_needed": total > 0,
        })

    # Any status the data holds that this module does not have a bucket for.
    # Reported rather than silently folded into a total: an unknown outcome is
    # a schema change nobody told this skill about.
    known = {s for s, _, _ in FOLLOWUP_BUCKETS}
    unknown: dict[str, int] = {}
    for e in events.values():
        for s, n in e["by_outcome"].items():
            if s not in known:
                unknown[s] = unknown.get(s, 0) + n

    return {
        "as_at": today,
        "window_from": since,
        "counts": {
            "events_ended_in_window": len(events),
            "registrations": sum(e["registrations"] for e in events.values()),
            "buckets_with_people": sum(1 for b in buckets if b["people"]),
            "unrecognised_outcomes": sum(unknown.values()),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "buckets": buckets,
        "events": sorted(events.values(), key=lambda e: e["days_since"]),
        "unrecognised_outcomes": [
            {"outcome": s, "people": n} for s, n in sorted(unknown.items())
        ],
        "limitations": [
            "The split is what the registration rows RECORD. A person who came "
            "and was never marked attended sits in whatever status they were "
            "left in, and this cannot tell that apart from the truth.",
            "Only events with an end time that has passed are counted. An event "
            "with no end time recorded is skipped rather than assumed over.",
            "Any outcome this skill does not have a bucket for is reported "
            "separately and NOT folded into a total — an unrecognised status is "
            "a change nobody told this skill about.",
        ],
    }
