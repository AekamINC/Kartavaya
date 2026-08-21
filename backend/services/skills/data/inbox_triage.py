"""
inbox_triage — the inbound half: catalogue #37, #38 and #44.

Three handlers that sit either side of a model call and do the deterministic
work, so that the model tier — if it ships at all — ships knowing what it costs
and what it is allowed to say.

    check_inbound_triage      #37  keyword rules, and the RESIDUAL, counted
    brief_reply_grounding     #38  the facts one reply needs, pulled once
    brief_mismatch_schedule   #44  the invoice-level schedule, no buckets

None of them calls a model. None of them writes. Nothing here sends anything.

── #37 IS THE MARGIN HOLE, AND THE RESIDUAL IS THE DELIVERABLE ──────────────

The folio chipped "Inbound Triage" near-free. It is not. A model residual on
every inbound message scales with a volume Aekam neither controls nor bills:
the folio's own arithmetic is 5,000 inbounds at a 30% residual = 1,500 calls
per org per month, for ever, and that is a floor because inbound volume grows
with the client's business rather than with the subscription.

So `check_inbound_triage` does the keyword half and returns three things:

  A  every message a rule labelled, with the label and the phrases that fired
  B  the RESIDUAL — the messages no rule labelled, or that several rules
     labelled inconsistently — as a list AND as a count
  C  a projection of what that residual costs in calls per org per month

C is the point. Instrumenting the residual before anybody buys the model tier
is the whole reason this handler exists; a residual nobody has measured is a
recurring bill nobody has agreed to.

**The rules deliberately have NO precedence order.** A message that matches both
`payment_claim` and `complaint` is reported as ambiguous, not resolved to one of
them. A precedence table would shrink the residual on paper without making one
classification more true — and the residual is the number that must not be
gamed, because it is the number the pricing decision rests on.

── #38 IS PULL. IT MUST NEVER BE MADE PUSH ──────────────────────────────────

`brief_reply_grounding` assembles the grounding for ONE conversation a human
asked about. A draft a human asks for costs one call per request. An auto-
drafter on every inbound costs 250 calls per 250 messages — measured, that is
the exact inbound count in the seeded org — and that single wiring choice is the
difference between a feature and a leak.

It is subject-bound by nature: it needs a conversation. But every parameter here
still defaults, per the handler contract, so it picks the org's most recent
inbound conversation and SAYS which one it picked and why. A default that does
not announce itself is how a reader ends up reading the wrong client's dues.

── #44 IS RESCOPED, AND THE RESCOPE IS THE SAFETY ───────────────────────────

The catalogue wanted an intimation answered bucket by bucket. The buckets cannot
be derived: **this product holds no GSTR-2B data at all** — there is no 2B
table, no 2B column, no importer — so which bucket a difference falls in is
exactly the thing a model would have to guess, in a letter to a tax officer,
over a firm's signature.

`brief_mismatch_schedule` therefore builds only what the product can prove: the
invoice-level schedule of purchase bills recorded for the period. Every row's
`bucket` is `None` and stays `None`. Bucket assignment is the human's, it is
stated on every row and in `limitations`, and this handler will not offer a
bucket vocabulary either — the vocabulary belongs to the intimation the firm
actually received, not to this product's memory.

It is also not called a reconciliation, for the reason catalogue #59 was
rejected: the other side does not exist here. It is one side of a comparison,
labelled as one side.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

  · `staging.varta_messages` holds 500 rows in ONE org (E2E Test & Associates);
    Aekam Inc and Unicode Group hold zero. 250 inbound, 250 outbound, every one
    `type = 'text'`. Inbound spans 2026-07-27 to 2026-08-02 — a 7-day window.
  · Those 250 inbound are five distinct strings, 50 each. The rules label two of
    them ("Payment done, receipt?" -> payment_claim, "Invoice bhej dijiye" ->
    bill_query) and label none of the other three ("Namaste, GSTR filing ho gayi
    kya?", "Documents ready hain", "Kal office aana hai?"). Measured residual:
    **150 of 250 = 60.0%**, which over a 7-day window projects to ~1,071
    inbound and **~643 model calls per month for that one org**. Higher than
    the folio's 30% assumption, on the only real data that exists.
  · `varta_messages` has NO language column and NO subject column. The only
    signal for "the language the client wrote in" is the message text itself,
    and every seeded message is romanised Hindi in Latin script — the case
    Unicode-block detection cannot decide. #38 reports script and marker words
    as EVIDENCE and refuses to call it a language identification.
  · 60 `varta_contacts`, all 60 linked to a `graha_contacts` row, but only 37
    reach a `graha_clients` company. So ~38% of WhatsApp conversations cannot
    be grounded in a client's ledger at all, and #38 says so instead of
    returning an empty invoice list that reads as "nothing outstanding".
  · `varta_business_accounts` holds ZERO rows in every org — no WABA is
    connected anywhere — so these 500 messages are seed data, not traffic.
  · `staging.ganit_vendor_bills` holds 189 rows: 166 in the E2E org, 20 in
    Unicode Group, 3 in Aekam Inc. Columns are `subtotal`, `cgst`, `sgst`,
    `igst`, `cess`, `total`, `is_reverse_charge` — there is no ITC-eligibility
    column, no 2B-matched column and no place-of-supply column. 16 of the E2E
    org's bills have a vendor with NO GSTIN; they are included and flagged,
    because GSTIN blocks nothing and excluding them would change the total the
    firm is explaining. Not one bill in any org is marked reverse charge.
  · A search of every column in `staging` for `2b`, `gstr2` or `itc` returns
    ONE hit, `sales_playbooks.pitch_scripts`, which is a false positive on the
    letters in "scripts". There is no 2B data on this database in any form —
    that absence is what #44's rescope rests on.
  · `staging.statute_calendar` carries `gst.return.gstr3b` (GSTR-3B, s.39) and
    `gst.itc.time_limit` (s.16(4)), both resolving cleanly as of 2026-07-31.
    It carries NO key for GSTR-2B and none for the rule 88D / DRC-01C
    intimation, so #44 reports the intimation's own identity as not recorded
    rather than printing one from memory.

── The three handlers, run live against all three orgs, 2026-08-20 ──────────

  check_inbound_triage (defaults; the 30-day window reaches the seeded data,
                        and a 400-day window returns the identical figures)
    E2E Test & Associates  250 inbound, 250 classified, 100 labelled
                           (50 bill_query, 50 payment_claim), 0 ambiguous,
                           150 unlabelled -> residual 150, share 0.60,
                           7 observed days, 35.71/day,
                           1,071 projected monthly inbound,
                           **643 projected model calls per month**
    Aekam Inc              0 inbound; says it cannot tell quiet from never-
                           connected, and that no WABA exists anywhere
    Unicode Group          0 inbound; same
  brief_reply_grounding (no conversation named, so defaulted)
    E2E Test & Associates  chose the most recent inbound conversation and said
                           so; Divya Nair of Joshi Logistics & Sons, status
                           open, last inbound 2026-08-02 18:11 UTC, thread tail
                           10 messages, 0 open invoices, last payment
                           ₹3,86,281.26 on 2026-08-02 against INV-2608-007,
                           5 recent orders. Language: Latin script, markers
                           kya/gayi/ho/namaste, explicitly NOT an
                           identification.
    Aekam Inc, Unicode     0 conversations; returns an explicit "no ledger was
                           read" rather than an empty invoice list
  brief_mismatch_schedule (period defaulted to 2026-07)
    E2E Test & Associates  9 bills, taxable ₹1,10,464.00, tax ₹19,883.52
    Unicode Group          3 bills, taxable ₹2,37,000.00, tax ₹42,660.00
    Aekam Inc              3 bills, taxable ₹50,800.00, tax ₹8,844.00
    Every row's `bucket` came back None in all three; `buckets_assigned` is 0.

All nine outputs survive `json.dumps(out, default=str)`. Nothing was written.
"""
import logging
import math
import re
from datetime import date, timedelta

from services.statute import obligation
from services.skills.reachable import reachable
from services.skills.timeutil import as_date, days_between, return_period, utc_now

log = logging.getLogger(__name__)

#: How far back an inbound message is worth triaging. 30 days because the
#: residual projection is a per-MONTH figure and a window that is not a month is
#: a window somebody has to mentally rescale. It is a default, not a rule.
DEFAULT_DAYS_BACK = 30

#: Days in the projection month. Stated once and reported on the output, because
#: "calls per month" over an unstated month length is not a number a person can
#: check.
PROJECTION_MONTH_DAYS = 30

#: The keyword rules. English and romanised Hindi (Hinglish) only — that is what
#: the live data is, and claiming coverage of any other language would be the
#: kind of confident wrongness this shelf cannot afford.
#:
#: Matching is on WHOLE WORDS of a punctuation-stripped, lower-cased form, so
#: `bill` does not fire on `billion` and `paid` does not fire on `unpaid`. Stems
#: are listed separately where a stem is genuinely wanted.
#:
#: There is deliberately NO precedence between categories. See the module
#: docstring: a precedence table shrinks the measured residual without making
#: any single classification more true.
RULES: dict[str, tuple[str, ...]] = {
    "bill_query": (
        "invoice", "invoices", "bill", "bills", "billing", "statement",
        "outstanding", "balance", "due", "kitna", "kitne", "amount pending",
        "ledger", "account statement", "bakaya", "baki",
    ),
    "order": (
        "order", "orders", "po number", "purchase order", "delivery",
        "deliver", "dispatch", "dispatched", "shipment", "courier",
        "tracking", "consignment", "stock", "quantity", "quantities",
    ),
    "payment_claim": (
        "paid", "payment done", "payment kar diya", "paise bhej diye",
        "transferred", "transfer kiya", "utr", "neft", "rtgs", "imps",
        "upi", "receipt", "screenshot", "cheque", "cheque number",
        "payment ho gaya",
    ),
    "complaint": (
        "complaint", "shikayat", "not working", "kaam nahi", "kharab",
        "galat", "wrong", "mistake", "error in", "refund", "return karna",
        "poor service", "worst", "disappointed", "escalate",
    ),
    "job_enquiry": (
        "job", "jobs", "vacancy", "vacancies", "resume", "cv", "hiring",
        "internship", "intern", "naukri", "opening", "openings",
        "apply for", "fresher", "experienced candidate",
    ),
    "spam": (
        "loan", "lottery", "winner", "prize", "click here", "free recharge",
        "crypto", "bitcoin", "investment plan", "guaranteed returns",
        "casino", "betting", "unsubscribe now",
    ),
}

#: Where a labelled message goes. A DESK, not a person: `varta_conversations`
#: carries `assigned_to` as free text and there is no routing table, so naming a
#: human here would be inventing an org chart. Nothing is assigned — this is a
#: suggestion on the output and the handler writes no row.
ROUTES: dict[str, str] = {
    "bill_query": "accounts desk",
    "order": "sales desk",
    "payment_claim": "accounts desk — check against the bank statement, never mark paid",
    "complaint": "the person who owns the client relationship",
    "job_enquiry": "whoever handles hiring; not a client conversation",
    "spam": "no desk — nothing to answer",
}

#: Unicode ranges that identify a script without a dictionary. Latin is absent
#: on purpose: Latin script tells you nothing, because romanised Hindi, Gujarati
#: and Marathi all arrive in it, and every message in the live data is exactly
#: that case.
SCRIPTS: tuple[tuple[str, int, int], ...] = (
    ("Devanagari", 0x0900, 0x097F),
    ("Bengali", 0x0980, 0x09FF),
    ("Gurmukhi", 0x0A00, 0x0A7F),
    ("Gujarati", 0x0A80, 0x0AFF),
    ("Odia", 0x0B00, 0x0B7F),
    ("Tamil", 0x0B80, 0x0BFF),
    ("Telugu", 0x0C00, 0x0C7F),
    ("Kannada", 0x0C80, 0x0CFF),
    ("Malayalam", 0x0D00, 0x0D7F),
    ("Arabic", 0x0600, 0x06FF),
)

#: Words that, in Latin script, suggest the writer is typing an Indian language
#: phonetically. EVIDENCE, never an identification — see `_language_evidence`.
ROMANISED_MARKERS: tuple[str, ...] = (
    "hai", "hain", "nahi", "nahin", "kya", "kar", "karo", "kijiye", "dijiye",
    "bhej", "gaya", "gayi", "diya", "kal", "aaj", "ho", "kripya", "namaste",
    "dhanyavaad", "bhai", "theek", "achha", "paise", "kitna",
)

_URL_RE = re.compile(r"https?://|\bwww\.|\bbit\.ly\b|\btinyurl\b", re.IGNORECASE)


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and every one of these outputs is handed to a reader
    through `json.dumps`."""
    return default if value is None else float(value)


def _haystack(text: str | None) -> str:
    r"""Free text reduced to a space-delimited, whole-word-searchable form.

    Punctuation and underscores collapse to single spaces and the whole thing is
    wrapped in spaces, so `f" {phrase} " in haystack` is a whole-word test with
    no regex per phrase. `\W` under Unicode keeps Devanagari and every other
    Indic letter, so this does not quietly delete a message written in script.
    """
    cleaned = re.sub(r"[\W_]+", " ", (text or "").lower(), flags=re.UNICODE).strip()
    return f" {cleaned} "


def _hits(hay: str, phrases: tuple[str, ...]) -> list[str]:
    """Which phrases of a rule fired. The list, not a boolean — a reader
    disagreeing with a label needs to see the word that caused it."""
    return [p for p in phrases if f" {p} " in hay]


def classify(content: str | None) -> dict:
    """One message against the rules. Deterministic; no model, no network.

    Returns the categories that fired and the phrases that fired them, plus the
    verdict:

      `labelled`    exactly one category fired
      `ambiguous`   several fired — the rules disagree, and that disagreement is
                    NOT resolved here (see the module docstring)
      `unlabelled`  none fired

    `ambiguous` and `unlabelled` together are the RESIDUAL: the messages a model
    tier would be paid to read. They are counted separately on the output
    because they are different problems — an ambiguous message means the rules
    need a distinction, an unlabelled one means they need a rule.
    """
    hay = _haystack(content)
    matched = {
        category: hits
        for category, phrases in RULES.items()
        if (hits := _hits(hay, phrases))
    }

    # A bare link is the one signal strong enough to stand alone. It is added as
    # its own phrase rather than folded into the spam word list so the output
    # says WHY — "contains a link" is a fact about the message; "spam" is a
    # judgement, and the reader gets to see the gap between them.
    if _URL_RE.search(content or ""):
        matched.setdefault("spam", []).append("contains a link")

    if len(matched) == 1:
        verdict = "labelled"
    elif len(matched) > 1:
        verdict = "ambiguous"
    else:
        verdict = "unlabelled"

    return {
        "verdict": verdict,
        "label": next(iter(matched)) if verdict == "labelled" else None,
        "matched": {k: sorted(v) for k, v in sorted(matched.items())},
    }


def _language_evidence(content: str | None) -> dict:
    """What can honestly be said about the language this was written in.

    NOT a language identification, and the shape of the return says so. There is
    no language column anywhere in `varta_messages`, so the only evidence is the
    text: the Unicode block gives a SCRIPT with certainty, and a script is not a
    language — Devanagari carries Hindi and Marathi alike. Latin script gives
    nothing at all, which is the live case for every seeded message, so marker
    words are offered as a hint and labelled a hint.

    A reply drafter that guesses a language and gets it wrong writes to a client
    in a language they did not use. Handing the drafter EVIDENCE rather than an
    answer is the difference between a bounded model call and a confident one.
    """
    text = content or ""
    counts: dict[str, int] = {}
    for name, low, high in SCRIPTS:
        n = sum(1 for ch in text if low <= ord(ch) <= high)
        if n:
            counts[name] = n

    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    hay = _haystack(text)
    markers = [w for w in ROMANISED_MARKERS if f" {w} " in hay]

    if counts:
        dominant = max(counts, key=counts.get)
        note = (
            f"Written in {dominant} script. A script is not a language — "
            f"{dominant} carries more than one — so the script is the fact and "
            f"the language is not recorded anywhere in this product."
        )
    elif markers:
        note = (
            "Latin script with romanised Indian-language markers "
            f"({', '.join(markers[:6])}). That is a HINT, not an "
            "identification: the product records no language for a message."
        )
    elif latin:
        note = (
            "Latin script and no romanised markers. This is as likely to be "
            "English as a romanised Indian language typed without them; the "
            "product records no language for a message."
        )
    else:
        note = "No letters in the message — nothing to say about language."

    return {
        "scripts_present": counts,
        "latin_letters": latin,
        "romanised_markers": markers,
        "is_an_identification": False,
        "note": note,
    }


# ══════════════════════════════════════════════════════════════════════════
# #37 · Inbound Triage — and the residual, counted
# ══════════════════════════════════════════════════════════════════════════

async def check_inbound_triage(
    pool,
    org_id: str,
    days_back: int = DEFAULT_DAYS_BACK,
    limit: int = 500,
) -> dict:
    """Label every inbound message a rule can label, and COUNT the rest.

    The residual is the deliverable. Sections:

      A  `labelled`     exactly one rule fired; the label and the phrases
      B  `ambiguous`    several rules fired — the rules need a distinction
      C  `unlabelled`   no rule fired — the rules need a rule
      D  `residual`     B + C, as a count and as a projected monthly call volume

    B and C are what a model tier would be paid to read, every month, for ever.
    Nobody should buy that tier before reading D.

    Reads `staging.varta_messages` only. Writes nothing, routes nothing, assigns
    nothing — `route_to` is a suggestion on the output and there is no UPDATE in
    this file.
    """
    today = utc_now().date()
    window_start = today - timedelta(days=max(1, int(days_back)))
    cap = max(1, int(limit))

    # The TRUE volume in the window, unbounded. Separate from the classified
    # sample on purpose: capping the sample is fine for measuring a rate, and
    # fatal for projecting a volume. A projection built on a capped count would
    # understate the bill by exactly the amount that was capped away.
    totals = await pool.fetchrow(
        """
        SELECT count(*)::int AS inbound_total,
               min(m.created_at) AS first_at,
               max(m.created_at) AS last_at
        FROM staging.varta_messages m
        WHERE m.org_id = $1::uuid
          AND m.direction = 'inbound'
          AND m.created_at >= $2::timestamptz
        """,
        org_id, window_start,
    )
    inbound_total = int(totals["inbound_total"] or 0) if totals else 0
    first_at = as_date(totals["first_at"]) if totals else None
    last_at = as_date(totals["last_at"]) if totals else None

    # The sample. `varta_contacts` carries the WhatsApp profile name, which is
    # what the sender called themselves — no join to `graha_contacts`, so this
    # handler needs no Graha grant to run. It is the sender's own name and it is
    # labelled as such rather than being passed off as the CRM's.
    rows = await pool.fetch(
        """
        SELECT m.id, m.conversation_id, m.content, m.created_at, m.type,
               COALESCE(NULLIF(btrim(vc.name), ''), '(name not on the WhatsApp profile)')
                   AS sender_profile_name,
               -- The number to reply on. Taken from `varta_contacts`, which is
               -- ALREADY joined for the profile name, so this costs no new
               -- module grant -- the note above about needing no Graha grant
               -- still holds.
               NULLIF(btrim(vc.phone_number), '') AS sender_phone
        FROM staging.varta_messages m
        LEFT JOIN staging.varta_conversations c
               ON c.id = m.conversation_id AND c.org_id = m.org_id
        LEFT JOIN staging.varta_contacts vc
               ON vc.id = c.varta_contact_id AND vc.org_id = c.org_id
        WHERE m.org_id = $1::uuid
          AND m.direction = 'inbound'
          AND m.created_at >= $2::timestamptz
        ORDER BY m.created_at DESC
        LIMIT $3::int
        """,
        org_id, window_start, cap,
    )

    labelled: list[dict] = []
    ambiguous: list[dict] = []
    unlabelled: list[dict] = []
    by_label: dict[str, int] = {k: 0 for k in RULES}

    for r in rows:
        verdict = classify(r["content"])
        entry = {
            # An id, as a row handle for the UI. The reader sees the name.
            "message_id": str(r["id"]),
            "conversation_id": str(r["conversation_id"]) if r["conversation_id"] else None,
            "sender_profile_name": r["sender_profile_name"],
            "received_at": r["created_at"],
            "message_type": r["type"],
            "text": (r["content"] or "")[:400],
            "matched": verdict["matched"],
        }
        # An inbound message is answered on the number it came from.
        entry = reachable(entry, kind="conversation",
                          entity_id=r["conversation_id"],
                          phone=r["sender_phone"])
        if verdict["verdict"] == "labelled":
            label = verdict["label"]
            by_label[label] = by_label.get(label, 0) + 1
            labelled.append({**entry, "label": label, "route_to": ROUTES.get(label)})
        elif verdict["verdict"] == "ambiguous":
            ambiguous.append({
                **entry,
                "label": None,
                "why": f"{len(verdict['matched'])} rules fired "
                       f"({', '.join(verdict['matched'])}). The rules are not "
                       f"ranked, deliberately — ranking them would shrink this "
                       f"count without making any label more true.",
            })
        else:
            unlabelled.append({
                **entry,
                "label": None,
                "why": "no keyword rule fired",
            })

    sample = len(rows)
    residual_n = len(ambiguous) + len(unlabelled)
    residual_share = (residual_n / sample) if sample else None

    # ── D · what the residual costs, per org, per month ────────────────────
    #
    # Two figures with different confidence, and they are not merged. The
    # OBSERVED share is measured on the sample. The PROJECTED volume multiplies
    # it by a rate extrapolated from a window that may be a few days long — the
    # live window is seven — so it is labelled an estimate and the window it was
    # built from is on the output for anyone who wants to redo the arithmetic.
    observed_days = (days_between(last_at, first_at) + 1) if (first_at and last_at) else 0
    per_day = (inbound_total / observed_days) if observed_days else None
    projected_monthly_inbound = (
        round(per_day * PROJECTION_MONTH_DAYS) if per_day is not None else None
    )
    projected_monthly_calls = (
        math.ceil(projected_monthly_inbound * residual_share)
        if projected_monthly_inbound is not None and residual_share is not None
        else None
    )

    projection = {
        "measured_on_sample": sample,
        "residual_in_sample": residual_n,
        "residual_share": round(residual_share, 4) if residual_share is not None else None,
        "inbound_in_window": inbound_total,
        "window_first_message": first_at,
        "window_last_message": last_at,
        "observed_days": observed_days,
        "inbound_per_day": round(per_day, 2) if per_day is not None else None,
        "projection_month_days": PROJECTION_MONTH_DAYS,
        "projected_monthly_inbound": projected_monthly_inbound,
        "projected_monthly_model_calls": projected_monthly_calls,
        "is_an_estimate": True,
        "basis": (
            "Residual share is measured on the sample below. Monthly volume is "
            f"the observed rate over {observed_days} day(s) scaled to "
            f"{PROJECTION_MONTH_DAYS} days — an extrapolation, not a count."
        ),
        "cap_is_an_owner_decision": True,
        "what_a_cap_must_cover": projected_monthly_calls,
        "cost_not_computed_here": (
            "No per-call price is recorded against a skill run, so this counts "
            "CALLS and not rupees. Multiplying by a price is the owner's step."
        ),
    }

    limitations = [
        "This labels and suggests a desk. It routes nothing and assigns nothing "
        "— there is no UPDATE in this handler, and `varta_conversations."
        "assigned_to` is free text with no routing table behind it.",
        "The rules are English and romanised Hindi only. A message in "
        "Devanagari, Gujarati, Tamil or any other script will almost always "
        "land in the residual, which means the residual is a FLOOR for any org "
        "whose clients do not write in Latin script.",
        "The rules are not ranked. A message matching two categories is "
        "reported as ambiguous rather than resolved, because a precedence order "
        "would shrink the residual figure without making one label more true — "
        "and the residual figure is what the model-tier decision rests on.",
        "Only WhatsApp is read. `staging.graha_inbound_emails` and "
        "`staging.graha_tickets` both hold zero rows across every org, so email "
        "and ticket inbound is NOT MEASURED here — not measured, not zero.",
        "The projected monthly figure is an extrapolation from the observed "
        "window and inherits every distortion in it: a week containing a "
        "festival, a filing deadline or a campaign is not a typical week.",
    ]
    if sample >= cap and inbound_total > sample:
        limitations.append(
            f"The classified sample was capped at {cap}: {inbound_total} inbound "
            f"messages fell in the window and {inbound_total - sample} were not "
            f"read. The residual SHARE is from the sample; the volume figures "
            f"use the full count, so the projection is not capped even though "
            f"the lists are."
        )
    if inbound_total == 0:
        limitations.append(
            "No inbound messages at all in the window. This cannot tell an org "
            "with a quiet inbox from one that has never connected WhatsApp — "
            "`staging.varta_business_accounts` holds zero rows in EVERY org on "
            "this database, so today the honest reading is that no WABA is "
            "connected and these figures describe seed data, not traffic."
        )

    return {
        "as_at": today,
        "window_from": window_start,
        "window_days": int(days_back),
        "counts": {
            "inbound_in_window": inbound_total,
            "classified_sample": sample,
            "labelled": len(labelled),
            "ambiguous": len(ambiguous),
            "unlabelled": len(unlabelled),
            "residual": residual_n,
            "by_label": by_label,
            "capped_at": cap,
            "was_capped": sample >= cap and inbound_total > sample,
        },
        "residual_projection": projection,
        "labelled": labelled,
        "ambiguous": ambiguous,
        "unlabelled": unlabelled,
        "categories": sorted(RULES),
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# #38 · Reply Drafter — the grounding only, pulled once, for one conversation
# ══════════════════════════════════════════════════════════════════════════

async def brief_reply_grounding(
    pool,
    org_id: str,
    conversation_id: str | None = None,
    limit: int = 200,
) -> dict:
    """Everything one reply needs to be true, for ONE conversation.

    PULL, NEVER PUSH. This is called because a human opened a conversation and
    asked for help with it. It must never be wired to an inbound-message event:
    that turns one call per request into one call per message, which on the live
    org is 250 calls for 250 messages and is the difference between a feature
    and a leak. Nothing in this handler subscribes to anything.

    *conversation_id* defaults — every parameter must, or no schedule can run
    the skill — to the org's MOST RECENT INBOUND conversation, and the output
    says which one was chosen and that it was chosen rather than named.

    Returns the client's identity, the language EVIDENCE (never a language
    identification), open invoices, recent payments and recent orders. It does
    not draft anything and it does not send anything.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    # Which conversation. `$2::uuid IS NULL` is the default branch, so the
    # named and defaulted cases go through one query and cannot drift apart.
    conv = await pool.fetchrow(
        """
        SELECT c.id, c.status, c.started_at, c.resolved_at,
               vc.id AS varta_contact_id,
               COALESCE(NULLIF(btrim(vc.name), ''), '(name not on the WhatsApp profile)')
                   AS profile_name,
               vc.phone_number, vc.graha_contact_id, vc.opted_in,
               max(m.created_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at,
               count(*) FILTER (WHERE m.direction = 'inbound')::int AS inbound_count
        FROM staging.varta_conversations c
        JOIN staging.varta_contacts vc
          ON vc.id = c.varta_contact_id AND vc.org_id = c.org_id
        LEFT JOIN staging.varta_messages m
          ON m.conversation_id = c.id AND m.org_id = c.org_id
        WHERE c.org_id = $1::uuid
          AND ($2::uuid IS NULL OR c.id = $2::uuid)
        GROUP BY c.id, c.status, c.started_at, c.resolved_at,
                 vc.id, vc.name, vc.phone_number, vc.graha_contact_id, vc.opted_in
        ORDER BY max(m.created_at) FILTER (WHERE m.direction = 'inbound') DESC NULLS LAST
        LIMIT 1
        """,
        org_id, conversation_id,
    )

    if conv is None:
        return {
            "as_at": today,
            "counts": {"conversations_found": 0, "open_invoices": 0,
                       "recent_payments": 0, "recent_orders": 0},
            "conversation": None,
            "chose_the_conversation_because": (
                "the conversation named does not exist in this org"
                if conversation_id else
                "no conversation was named and the org has none to fall back on"
            ),
            "grounding": None,
            "delivery": {"sent": False, "will_send": False,
                         "note": "Nothing was sent. Delivery is a separate armed decision."},
            "limitations": [
                "Nothing was found to ground a reply on. That is an ABSENCE of a "
                "conversation, not an absence of dues — no ledger was read.",
                "`staging.varta_business_accounts` holds zero rows in every org "
                "on this database, so no WhatsApp account is connected anywhere "
                "and any conversation present is seed data.",
                "This handler is PULL only. It must never be attached to an "
                "inbound-message event; an auto-drafter costs one model call "
                "per message rather than one per request.",
            ],
        }

    chosen_because = (
        "named by the caller"
        if conversation_id else
        "no conversation was named, so this is the org's most recent INBOUND "
        "conversation — read the client's name below before using anything here"
    )

    # The last few messages, so a drafter can see what was actually asked and in
    # what register. Capped small: a drafter needs the thread's tail, not its
    # history, and every extra message is prompt a human pays for.
    messages = await pool.fetch(
        """
        SELECT m.direction, m.content, m.created_at, m.type, m.template_name
        FROM staging.varta_messages m
        WHERE m.org_id = $1::uuid
          AND m.conversation_id = $2::uuid
        ORDER BY m.created_at DESC
        LIMIT $3::int
        """,
        org_id, conv["id"], min(cap, 20),
    )
    thread = [
        {
            "direction": m["direction"],
            "at": m["created_at"],
            "type": m["type"],
            "template_name": m["template_name"],
            "text": (m["content"] or "")[:600],
        }
        for m in messages
    ]
    last_inbound_text = next(
        (m["text"] for m in thread if m["direction"] == "inbound"), None
    )

    # Who this is, in the CRM. A client is the COMPANY; the contact is a person
    # who comes and goes. BOTH graha joins carry org_id — the FK on
    # `graha_clients` is on the id ALONE, so an id-only join prints another
    # practice's client name, which has been proved live.
    person = None
    if conv["graha_contact_id"]:
        person = await pool.fetchrow(
            """
            SELECT gc.id, gc.name, gc.company, gc.email, gc.phone, gc.client_id,
                   cl.name AS client_name
            FROM staging.graha_contacts gc
            LEFT JOIN staging.graha_clients cl
                   ON cl.id = gc.client_id AND cl.org_id = gc.org_id
            WHERE gc.org_id = $1::uuid AND gc.id = $2::uuid
            """,
            org_id, conv["graha_contact_id"],
        )

    contact_uuid = str(person["id"]) if person else None
    client_uuid = str(person["client_id"]) if person and person["client_id"] else None
    company = None
    if person:
        company = (
            (person["client_name"] or "").strip()
            or (person["company"] or "").strip()
            or None
        )

    open_invoices: list[dict] = []
    payments: list[dict] = []
    orders: list[dict] = []

    if contact_uuid or client_uuid:
        open_invoices = [
            {
                "invoice_id": str(r["id"]),
                "invoice_number": r["invoice_number"],
                "invoice_date": as_date(r["invoice_date"]),
                "due_date": as_date(r["due_date"]),
                "total": _f(r["total"]),
                "balance_due": _f(r["balance_due"]),
                "payment_status": r["payment_status"],
                "days_overdue": (
                    days_between(today, r["due_date"])
                    if as_date(r["due_date"]) and as_date(r["due_date"]) < today
                    else 0
                ),
            }
            for r in await pool.fetch(
                """
                SELECT i.id, i.invoice_number, i.invoice_date, i.due_date,
                       i.total, i.balance_due, i.payment_status
                FROM staging.ganit_invoices i
                WHERE i.org_id = $1::uuid
                  AND COALESCE(i.is_active, TRUE)
                  AND COALESCE(i.invoice_type, 'tax_invoice') <> 'credit_note'
                  AND i.payment_status IN ('unpaid', 'partial')
                  AND COALESCE(i.balance_due, 0) > 0
                  AND (i.contact_id = $2::uuid OR i.client_id = $3::uuid)
                ORDER BY i.due_date ASC NULLS LAST
                LIMIT $4::int
                """,
                org_id, contact_uuid, client_uuid, cap,
            )
        ]

        payments = [
            {
                "amount": _f(r["amount"]),
                "payment_date": as_date(r["payment_date"]),
                "payment_method": r["payment_method"],
                "reference": r["reference"],
                "against_invoice": r["invoice_number"],
            }
            for r in await pool.fetch(
                """
                SELECT p.amount, p.payment_date, p.payment_method, p.reference,
                       i.invoice_number
                FROM staging.ganit_payments p
                JOIN staging.ganit_invoices i
                  ON i.id = p.invoice_id AND i.org_id = p.org_id
                WHERE p.org_id = $1::uuid
                  AND (i.contact_id = $2::uuid OR i.client_id = $3::uuid)
                ORDER BY p.payment_date DESC, p.created_at DESC
                LIMIT 5
                """,
                org_id, contact_uuid, client_uuid,
            )
        ]

        orders = [
            {
                "order_number": r["order_number"],
                "order_date": as_date(r["order_date"]),
                "expected_delivery": as_date(r["expected_delivery"]),
                "status": r["status"],
                "total": _f(r["total"]),
                "invoiced": r["invoice_id"] is not None,
            }
            for r in await pool.fetch(
                """
                SELECT v.order_number, v.order_date, v.expected_delivery,
                       v.status, v.total, v.invoice_id
                FROM staging.vikray_orders v
                WHERE v.org_id = $1::uuid
                  AND COALESCE(v.is_active, TRUE)
                  AND (v.contact_id = $2::uuid OR v.client_id = $3::uuid)
                ORDER BY v.order_date DESC
                LIMIT 5
                """,
                org_id, contact_uuid, client_uuid,
            )
        ]

    outstanding = round(sum(i["balance_due"] for i in open_invoices), 2)

    limitations = [
        "PULL ONLY. This assembles grounding for one conversation a person "
        "asked about. Wiring it to an inbound-message event turns one model "
        "call per request into one per message — 250 calls for the 250 inbound "
        "messages on the live org — and that is the leak, not the model.",
        "It drafts nothing and sends nothing. A reply is written and pressed by "
        "a human; this handler returns facts for that human to check.",
        "The language is NOT identified. `staging.varta_messages` has no "
        "language column, so the output carries the SCRIPT (a certainty) and "
        "romanised marker words (a hint) and refuses to name a language.",
        "'Paid' arrives from bank reconciliation and from nothing else, so the "
        "payments below are recorded receipts. A client saying they have paid "
        "is a claim, and a claim is not a receipt.",
    ]
    if not conversation_id:
        limitations.append(
            "No conversation was named, so the most recent INBOUND conversation "
            "was chosen. Check the name and phone number on the output before "
            "using any figure here — a defaulted subject that is not read is "
            "how one client's dues end up quoted to another."
        )
    if not person:
        limitations.append(
            "This WhatsApp number is not linked to a CRM contact, so NO LEDGER "
            "WAS READ. The empty invoice, payment and order lists mean 'not "
            "looked up', not 'nothing outstanding' — do not let a draft say the "
            "account is clear."
        )
    elif not client_uuid:
        limitations.append(
            "The contact is not attached to a client COMPANY, so only invoices, "
            "payments and orders carrying this person's contact id were found. "
            "Anything billed to the company against a different contact is "
            "invisible here — 37 of the 60 WhatsApp contacts on this database "
            "reach a company and 23 do not."
        )
    if not conv["opted_in"]:
        limitations.append(
            "This contact has no recorded WhatsApp opt-in. That governs what may "
            "be SENT, which is a separate armed decision — it does not stop a "
            "person replying inside a conversation the client started."
        )

    return {
        "as_at": today,
        "counts": {
            "conversations_found": 1,
            "messages_read": len(thread),
            "open_invoices": len(open_invoices),
            "recent_payments": len(payments),
            "recent_orders": len(orders),
            "outstanding_total": outstanding,
        },
        "chose_the_conversation_because": chosen_because,
        "conversation": {
            "conversation_id": str(conv["id"]),
            "status": conv["status"],
            "started_at": conv["started_at"],
            "last_inbound_at": conv["last_inbound_at"],
            "inbound_count": int(conv["inbound_count"] or 0),
            "whatsapp_profile_name": conv["profile_name"],
            "phone_number": conv["phone_number"],
            "opted_in": bool(conv["opted_in"]),
        },
        "grounding": {
            "contact_name": (person["name"] if person else None),
            "company": company,
            "is_linked_to_crm": person is not None,
            "is_linked_to_a_company": client_uuid is not None,
            "language_evidence": _language_evidence(last_inbound_text),
            "last_inbound_text": last_inbound_text,
            "thread_tail": thread,
            "open_invoices": open_invoices,
            "outstanding_total": outstanding,
            "recent_payments": payments,
            "last_payment": payments[0] if payments else None,
            "recent_orders": orders,
        },
        "delivery": {
            "sent": False,
            "will_send": False,
            "note": "Nothing was sent. Delivery is a separate armed decision.",
        },
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# #44 · Mismatch Reply Draft — RESCOPED: the schedule, and no buckets
# ══════════════════════════════════════════════════════════════════════════

async def brief_mismatch_schedule(
    pool,
    org_id: str,
    period: str | None = None,
    limit: int = 500,
) -> dict:
    """The invoice-level schedule of purchase bills for a period. No buckets.

    *period* is 'YYYY-MM' and defaults to the month being filed — the PREVIOUS
    month, per `timeutil.return_period`, because a GST intimation is answered
    about a period that has closed.

    **Every row's `bucket` is None and this handler will never fill it.** The
    catalogue asked for a bucketed explanation of an ITC difference; the buckets
    cannot be derived, because this product holds no GSTR-2B data of any kind —
    no table, no column, no importer — so which bucket a difference falls in is
    precisely what a model would have to guess, in a letter to a tax officer,
    over the firm's signature. A human assigns the bucket. This supplies the
    figures they assign it to.

    This is ONE SIDE of a comparison and is labelled as one side. It is not a
    reconciliation: the other side does not exist in this product, and a skill
    calling itself a reconciliation while comparing a number to itself is caught
    by the first CA who runs it.
    """
    today = utc_now().date()
    cap = max(1, int(limit))
    period = (period or return_period()).strip()
    try:
        year, month = (int(x) for x in period.split("-"))
        start = date(year, month, 1)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"period must be 'YYYY-MM' (got {period!r})") from exc
    end = (date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)) - timedelta(days=1)

    # Statutory identity of the return this schedule is being written against —
    # read AS OF THE PERIOD END, never as of today. Form numbers move: that is
    # the whole reason `services/statute.py` exists.
    gstr3b = await obligation(pool, "gst.return.gstr3b", as_of=end)
    itc_limit = await obligation(pool, "gst.itc.time_limit", as_of=end)

    rows = await pool.fetch(
        """
        SELECT b.id, b.bill_number, b.internal_ref, b.bill_date, b.due_date,
               b.subtotal, b.cgst, b.sgst, b.igst, b.cess, b.total,
               b.amount_paid, b.status, b.is_reverse_charge, b.currency,
               COALESCE(NULLIF(btrim(v.name), ''), '(vendor not recorded)') AS vendor_name,
               NULLIF(btrim(v.gstin), '') AS vendor_gstin
        FROM staging.ganit_vendor_bills b
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND COALESCE(b.is_active, TRUE)
          AND b.bill_date >= $2::date
          AND b.bill_date <= $3::date
        ORDER BY b.bill_date ASC, b.bill_number ASC
        LIMIT $4::int
        """,
        org_id, start, end, cap,
    )

    schedule: list[dict] = []
    for r in rows:
        cgst, sgst, igst, cess = _f(r["cgst"]), _f(r["sgst"]), _f(r["igst"]), _f(r["cess"])
        schedule.append({
            "bill_id": str(r["id"]),
            "vendor_name": r["vendor_name"],
            # GSTIN IS NON-MANDATORY AND BLOCKS NOTHING. A bill with no GSTIN
            # appears in the schedule with the field stated as absent, because
            # dropping it would silently change the total the firm is
            # explaining.
            "vendor_gstin": r["vendor_gstin"],
            "vendor_gstin_recorded": r["vendor_gstin"] is not None,
            "bill_number": r["bill_number"] or r["internal_ref"],
            "bill_date": as_date(r["bill_date"]),
            "taxable_value": _f(r["subtotal"]),
            "cgst": cgst,
            "sgst": sgst,
            "igst": igst,
            "cess": cess,
            "tax_total": round(cgst + sgst + igst + cess, 2),
            "invoice_value": _f(r["total"]),
            "currency": r["currency"] or "INR",
            "is_reverse_charge": bool(r["is_reverse_charge"]),
            "payment_status": r["status"],
            # Never inferred. Never defaulted to a guess. The vocabulary belongs
            # to the intimation the firm received, not to this product.
            "bucket": None,
            "bucket_assigned_by": "human",
        })

    totals = {
        "taxable_value": round(sum(r["taxable_value"] for r in schedule), 2),
        "cgst": round(sum(r["cgst"] for r in schedule), 2),
        "sgst": round(sum(r["sgst"] for r in schedule), 2),
        "igst": round(sum(r["igst"] for r in schedule), 2),
        "cess": round(sum(r["cess"] for r in schedule), 2),
        "invoice_value": round(sum(r["invoice_value"] for r in schedule), 2),
    }
    totals["tax_total"] = round(
        totals["cgst"] + totals["sgst"] + totals["igst"] + totals["cess"], 2
    )

    reverse_charge = [r for r in schedule if r["is_reverse_charge"]]
    no_gstin = [r for r in schedule if not r["vendor_gstin_recorded"]]
    foreign = [r for r in schedule if r["currency"] != "INR"]

    statute_gaps: list[str] = []
    if gstr3b is None:
        statute_gaps.append(
            "The statute calendar records no `gst.return.gstr3b` version in "
            f"force on {end} — the return this schedule is written against is "
            "therefore NOT NAMED here, rather than named from memory."
        )
    if itc_limit is None:
        statute_gaps.append(
            "The statute calendar records no `gst.itc.time_limit` version in "
            f"force on {end}, so the last date to claim this period's credit is "
            "not stated."
        )
    statute_gaps.append(
        "The statute calendar carries NO key for GSTR-2B and none for the "
        "rule 88D / DRC-01C intimation, so the intimation this schedule answers "
        "is not identified by form or section anywhere in this output. Its "
        "identity comes from the paper the firm received."
    )

    limitations = [
        "THE BUCKET IS THE HUMAN'S. Every row's `bucket` is None and this "
        "handler never fills it. The product holds no GSTR-2B data — no table, "
        "no column, no importer — so which bucket a difference falls in cannot "
        "be derived from anything here, and guessing it in a reply to a tax "
        "officer is the failure this rescope exists to prevent.",
        "This is ONE SIDE of a comparison, not a reconciliation. It is the "
        "purchase register the books hold for the period. The portal's side is "
        "absent from this product entirely, so no difference is computed and "
        "none is claimed.",
        "Bills are selected on `bill_date`, the document date. That is not the "
        "date a credit appeared in GSTR-2B, which depends on when the supplier "
        "filed — so a bill dated in this period may sit in another period's 2B, "
        "and this cannot see which.",
        "There is no ITC-eligibility column on `ganit_vendor_bills`. Blocked "
        "credits, personal-use apportionment and rule-42/43 reversals are NOT "
        "MARKED anywhere, so every row here is a recorded purchase and not a "
        "claimed credit.",
        "GSTIN is non-mandatory and blocks nothing. Bills with no vendor GSTIN "
        "are INCLUDED and flagged, because excluding them would quietly change "
        "the total the firm is explaining.",
        "CGST/SGST versus IGST is taken exactly as recorded on the bill. There "
        "is no place-of-supply column on a vendor bill, so nothing here checks "
        "whether the split is right.",
    ]
    if not schedule:
        limitations.append(
            f"No purchase bills are recorded for {period}. That is an ABSENCE "
            f"of recorded bills, which is not the same as an absence of "
            f"purchases — an org that books its purchases elsewhere and one "
            f"that made none both produce this empty schedule."
        )
    if len(rows) >= cap:
        limitations.append(
            f"The schedule was capped at {cap} rows and more may exist. Every "
            f"total above is therefore a FLOOR, not the period's total — raise "
            f"`limit` before sending any figure from here to a tax officer."
        )

    return {
        "as_at": today,
        "period": period,
        "period_start": start,
        "period_end": end,
        "counts": {
            "bills": len(schedule),
            "reverse_charge_bills": len(reverse_charge),
            "bills_without_vendor_gstin": len(no_gstin),
            "foreign_currency_bills": len(foreign),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
            "buckets_assigned": 0,
        },
        "return_in_force": (
            {
                "obligation_key": gstr3b["obligation_key"],
                "form_number": gstr3b["form_number"],
                "section_ref": gstr3b["section_ref"],
                "resolved_as_of": end,
            }
            if gstr3b else None
        ),
        "itc_time_limit_in_force": (
            {
                "obligation_key": itc_limit["obligation_key"],
                "section_ref": itc_limit["section_ref"],
                "title": itc_limit.get("title"),
                "resolved_as_of": end,
            }
            if itc_limit else None
        ),
        "statute_gaps": statute_gaps,
        "schedule": schedule,
        "totals": totals,
        "bucket_assignment": {
            "assigned_by": "human",
            "assigned_here": False,
            "why": (
                "The product holds no GSTR-2B data, so a bucket cannot be "
                "derived from anything in this database. A bucket printed here "
                "would be a guess in a document a firm signs."
            ),
        },
        "limitations": limitations,
    }
