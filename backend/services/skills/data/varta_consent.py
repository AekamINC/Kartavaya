"""
varta_consent — the three consent-and-send skills: catalogue #33, #34+#40, #35.

    check_consent_ledger        #33  who opted in, who said STOP, who a send
                                     would reach anyway
    check_broadcast_preflight   #34 + #40  before you send to a list, name who
                                     should not get it
    brief_whatsapp_cost         #35  wording that reclassifies a utility
                                     template, and the month's send volume

#34 and #40 are ONE handler. The folio says so plainly — "this is the same skill
as #40 with a different channel column" — and the merge is not a tidy-up. Two
handlers reading two channel columns would have produced two different
definitions of "should not get it", and the operator would have believed
whichever one they happened to run.

── #33 IS A REPORT, AND IT CANNOT BE ANYTHING ELSE TODAY ────────────────────

The folio's judgement on #33: "it closes a promise the schema already makes and
cannot keep. An opted_in boolean that nothing ever writes is worse than no
column." That was verified, not accepted:

    grep -rn "opted_in" backend/**/*.py

returns four hits and not one of them is a write. Two are in tests asserting
that OTHER tables must not grow a consent column, one is a fixture literal, one
is this module's probe. `staging.varta_contacts.opted_in` is `NOT NULL DEFAULT
false` and no INSERT or UPDATE in the repository ever sets it. So:

  · A contact born from a real inbound WhatsApp message is created by
    `routers/whatsapp.py` with the DEFAULT — false, for ever, whatever the
    person actually agreed to.
  · The 45 rows that read `opted_in = true` on the live database all carry the
    IDENTICAL `opted_in_at` of 2026-06-04 03:51:13.141832+00. One timestamp for
    forty-five people is a seed script, not forty-five consents. A `true` here
    is therefore NOT evidence of an opt-in, and this handler says so on the
    output rather than counting those rows as consented.
  · The send route (`POST /v1/varta/conversations/{id}/messages`) never reads
    `opted_in`. There is no refusal anywhere. Every contact is reachable.

This handler cannot fix that — a skill handler reads and never writes — so it
reports the state and NAMES THE COLUMNS that would close it. That naming is the
deliverable: three small columns and a send refusal, which is what the folio
costed.

── #34/#40: THE BOUNCE CHECK IS BLOCKED, AND SILENCE WOULD BE A LIE ─────────

Nothing in this product ingests a delivery event. `staging.outbound_log` holds
2,390 rows across email and push and has never held a WhatsApp row; there is no
webhook consumer for provider bounces; `prachar_campaign_contacts.status`
carries 'bounced' on two rows only because a seed wrote it. So a bounce list is
empty for the same reason an unwatched road has no accidents on it.

Reporting that as "0 bounces" would read as a clean list. It is reported as
NOT MEASURED, in its own key, and the word "bounce" never appears beside a
number. Same rule for deliverability and quality scores: the product cannot see
an open rate it did not record, so none is printed.

── #35: NO RUPEE FIGURE IS INVENTED, AND NO TAX POSITION IS TAKEN ───────────

The lexicon scan is a word list and a query, which is the right shape and free
for ever. The money half is not free, and the honest version of it is smaller
than the catalogue entry implies:

  · Meta's India rate card is not recorded anywhere in this product. There is no
    settings table, no org column, and nothing in `statute_calendar` — which is
    for statute, and a commercial rate card is not statute. So `rate_card_inr`
    defaults to None and the handler reports the volume WITHOUT a rupee figure,
    naming the shape it would need. A per-message price printed from memory in
    front of a CA is exactly the failure this contract exists to prevent.
  · When a rate card IS supplied the total is labelled an ESTIMATE on every key
    that carries it, because Meta bills the org directly and this product never
    sees the invoice.
  · NOTHING HERE STATES A GST POSITION on Meta's invoice. The folio deleted that
    sentence and it is not coming back: it is a tax claim about a third party's
    invoice, with no source, in a product used by tax professionals — and Meta
    bills many Indian WABAs through an Indian entity with creditable domestic
    GST, so the deleted sentence was not merely unsourced, it was probably
    wrong. There is a limitation saying the handler takes no view.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

Three orgs: Aekam Inc, E2E Test & Associates [TEST ORG], Unicode Group.

  · `varta_business_accounts` holds ZERO rows in all three orgs. No org has a
    connected WABA, so every one of the 500 `varta_messages` rows is seed data
    and nothing has ever been received from or sent to Meta. Every count in #33
    and #35 is therefore a count of seeded rows, and both handlers say so.
  · `varta_contacts`: 60 rows, ALL in the E2E org — 45 `opted_in = true` (all
    sharing one timestamp), 15 false, 0 with any opt-out record because there is
    nowhere to put one. The other two orgs hold none, so #33 returns an
    all-zero, all-caveat report for them, which is the correct answer.
  · `varta_messages`: 500 rows, all E2E, 250 inbound / 250 outbound. FIVE
    distinct inbound bodies repeated fifty times each; none is a stop word in
    any language, so the STOP scan returns 0 over 250 examined — a real zero
    with a stated denominator, not a skipped check.
  · `template_name` is NULL on all 500 rows. The send route DOES write that
    column, so this is an absence of template sends and not a broken writer —
    but it means #35 can attribute 0 of 250 outbound messages to a pricing
    category, and it reports that instead of a rupee figure.
  · `varta_templates`: 10 rows, all E2E — 7 UTILITY, 3 MARKETING; 8 approved,
    2 pending, 1 rejected, 1 draft across those. Every body is the seeded string
    "Namaste {{1}}, seeded E2E template body — N", so the lexicon scan finds 0
    reclassification risks over 10 templates examined.
  · `prachar_campaigns`: 104 rows. E2E holds 60 email drafts (2,526 claimed
    recipients), 12 sms drafts (846) and 12 whatsapp drafts (858); Unicode Group
    holds 12 sent email campaigns (179 claimed, 125 actually sent, 2 marked
    bounced by the seed) and 4 drafts; Aekam holds 1 draft. The 24 sms/whatsapp
    campaigns claim 1,704 recipients that NO send path can reach —
    `routers/prachar.py` refuses any channel but email, correctly, and nothing
    else delivers them.
  · `prachar_unsubscribes`: 268 rows, all E2E, of which 228 match a live
    `graha_contacts` email in that org. That is the one consent fact this
    product genuinely records — and it is an opt-OUT, on email only.
  · `graha_contacts`: 292 rows (E2E 235, Unicode 53, Aekam 4). Zero duplicate
    email addresses anywhere. THIRTY duplicate PHONE numbers in E2E on two
    numbers (16 contacts share 9876543210, 14 share 9876500000) and one pair in
    Unicode Group — which is why the duplicate check runs on the channel's own
    address column and never on email alone.

── The three handlers, run against all three live orgs, read-only ───────────

Every output below survived `json.dumps(out, default=str)`.

`check_consent_ledger`
  Aekam Inc / Unicode Group   0 WhatsApp contacts, 0 inbound messages examined,
                              0 WABAs — 8 limitations, of which two say the
                              stop scan was SKIPPED rather than clean.
  E2E Test & Associates       60 contacts · 45 flagged opted_in over ONE
                              distinct timestamp (so `opt_in_is_not_evidence`
                              is true) · 15 not flagged · 60 linked to a CRM
                              contact · 0 opt-ins with notice text, because no
                              column holds it · 250 inbound messages examined
                              from 25 people · 0 stop words found · 15 contacts
                              reachable with no recorded opt-in · 0 WABAs.

`check_broadcast_preflight`
  Aekam Inc                   1 unsent campaign, 1 audience filter. Claimed 0,
                              deliverable 4 — a NEGATIVE gap, i.e. a stale
                              stored count, which is why that is a stated case.
  E2E Test & Associates       84 unsent campaigns over 3 distinct filters. 24 on
                              a channel Prachar cannot deliver, claiming 1,704
                              recipients with no send path. The worst campaign:
                              "Q1 Newsletter — Jun 2026" claims 100, resolves a
                              234-contact segment, and is DELIVERABLE TO 7 —
                              227 of the segment are on the unsubscribe list.
  Unicode Group               4 unsent campaigns, 4 distinct filters, 0
                              suppressed, deliverable 0 / 3 / 34 / 53.
  Every run: `bounce_check` = "NOT MEASURED" and `counts.bounced_previously` is
  null, never 0.

`brief_whatsapp_cost`
  Aekam Inc / Unicode Group   0 templates, 0 outbound messages — reported as a
                              skipped check, not a zero bill.
  E2E Test & Associates       10 templates examined, 0 at reclassification risk
                              (every body is the seeded string). 183 outbound
                              messages in the default period 2026-07, of which
                              183 are UNATTRIBUTABLE — not one carries a
                              template_name matching a template in the org — so
                              `volume_by_category` is empty and no rupee figure
                              is printed. With a rate card passed in, the
                              estimate object appears, is flagged
                              `total_is_a_floor`, and still prices nothing,
                              which is the correct answer.

── The bug the vernacular requirement nearly hid ────────────────────────────

Both normalisers in this module were first written the obvious way — strip
everything that is not `\\w` in Python, everything that is not `[:alnum:]` in
SQL — and both were WRONG for every Indian language. Indic vowel signs are
COMBINING MARKS, and a combining mark is not alphanumeric to `iswalnum()` any
more than it is to Python's `\\w`. Measured against the live database:

    'बंद करो।'  ->  'ब द कर'        'બંધ કરો'  ->  'બ ધ કર'
    'நிறுத்து'   ->  'ந ற த த'        'ನಿಲ್ಲಿಸಿ'   ->  'ನ ಲ ಲ ಸ'

Mangled haystacks would have been compared against intact needles, the entire
vernacular half of the STOP scan would have matched nothing, and #33 would have
reported a confident zero for ever — a clean-looking result on the one check the
folio asked for by name. Both sides now key on the character CATEGORY instead:
letters, numbers and marks survive; punctuation, separators, controls and
symbols become spaces. Verified live afterwards, `'बंद करो।' = ANY($2::text[])`
is true against `'बंद करो'`. Both halves are guarded by tests.

── A tenant-boundary trap found while probing, and worked around here ───────

`prachar_campaign_contacts.org_id` is NULLABLE and is NULL on 62 of its 122
rows. Any query that scopes that table by its own `org_id` silently drops half
of it. Nothing here reads that table for that reason; where it is unavoidable
the scope has to come through `prachar_campaigns.org_id`, which is NOT NULL. It
is reported to the CTO as a schema defect and is not fixed here.
"""
import json
import logging
import re
import unicodedata
from datetime import date

from services.skills.timeutil import as_date, days_between, return_period, utc_now

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════
# The STOP vocabulary
# ══════════════════════════════════════════════════════════════════════════
#
# Two lists, two confidence levels, and the split is the point. Meta's own
# behaviour keys on an EXACT keyword as the whole message, and that is the only
# test that can be trusted to mean "this person is opting out": a message
# reading "band karo" is unambiguous, a message reading "yeh reminder band karo
# aur invoice dobara bhejo" is a person asking you to stop doing something else.
#
# So EXACT matches the WHOLE normalised message, and PHRASE — a much shorter,
# deliberately unambiguous list — matches anywhere inside it and is reported at
# lower confidence. A bare "no" / "nahi" is in NEITHER list: as a whole message
# it is far more often an answer to a question than an opt-out, and a false
# opt-out silences a client who never asked to be silenced.
#
# Nothing in this product has ever ACTED on any of these. The lists exist so the
# report can say "this many people asked you to stop and were not stopped",
# which is the number that justifies building the write path.

EXACT_STOP_WORDS: tuple[str, ...] = (
    # English — Meta's published keywords and the ordinary paraphrases
    "stop", "stop all", "stopall", "unsubscribe", "unsub", "opt out", "optout",
    "remove me", "cancel subscription", "no more messages",
    # Hindi / Hinglish, as people actually type it into WhatsApp
    "band karo", "band kro", "bandh karo", "band kijiye", "ruk jao",
    "mat bhejo", "message mat bhejo", "msg mat bhejo", "nahi chahiye",
    "hatao mujhe", "mujhe hatao",
    # Devanagari (Hindi / Marathi)
    "बंद", "बंद करो", "बंद करें", "बंद करा", "रोको", "रुको", "थांबवा",
    "मत भेजो", "नहीं चाहिए", "हटाओ",
    # Gujarati
    "બંધ", "બંધ કરો",
    # Bengali
    "বন্ধ", "বন্ধ করুন",
    # Tamil
    "நிறுத்து", "நிறுத்துங்கள்",
    # Telugu
    "ఆపు", "ఆపండి",
    # Kannada
    "ನಿಲ್ಲಿಸಿ",
    # Malayalam
    "നിർത്തുക",
    # Punjabi
    "ਬੰਦ ਕਰੋ",
)

#: Matched ANYWHERE in the message, so every entry has to be unambiguous on its
#: own. "band" is not here and never can be — it is an ordinary English word.
#: Anything found this way is reported as `matched: 'phrase'`, separately from
#: the exact matches, because a reader deciding whether to suppress a number
#: needs to know which test fired.
PHRASE_STOP_WORDS: tuple[str, ...] = (
    "unsubscribe me", "remove me from", "stop sending me", "stop these messages",
    "do not send me", "dont send me", "don t send me",
    "message mat bhejo", "msg mat bhejo", "mat bhejo", "band karo",
    "nahi chahiye", "मत भेजो", "बंद करो", "नहीं चाहिए", "बंद करें",
)


# ══════════════════════════════════════════════════════════════════════════
# The reclassification lexicon (#35)
# ══════════════════════════════════════════════════════════════════════════
#
# Wording that makes a UTILITY template read as MARKETING. Meta's category rule
# is about intent — a utility template must concern a transaction the user
# already has — so promotional wording inside one is what triggers a
# reclassification, and a reclassified template is billed at the marketing rate
# AND is refused for anyone who opted out of marketing. The same template
# silently reaches fewer people and costs more.
#
# This is a WORD LIST, and its honesty depends on saying so: it finds wording,
# it does not predict Meta's decision. Meta reviews a template as a whole and
# can reclassify one with none of these words in it. That is on `limitations`.

MARKETING_LEXICON: tuple[str, ...] = (
    "offer", "offers", "discount", "discounts", "sale", "flat off",
    "free", "limited time", "limited period", "hurry", "last chance",
    "dont miss", "do not miss", "buy now", "shop now", "order now", "book now",
    "subscribe", "upgrade", "deal", "deals", "exclusive", "special price",
    "best price", "lowest price", "cashback", "coupon", "promo", "promotion",
    "refer a friend", "refer and earn", "invite your friends", "new launch",
    "just launched", "you have won", "winner", "festive", "festival offer",
    "save upto", "save up to",
    # Hindi / Devanagari — a Hindi utility template reclassifies on the same
    # grounds as an English one, and a lexicon that only read English would
    # quietly pass every vernacular template.
    "छूट", "ऑफर", "मुफ्त", "सेल", "अभी खरीदें", "विशेष छूट",
)

#: An AUTHENTICATION template is meant to carry a one-time code and nothing
#: else. Marketing wording in one is a harder failure than in a utility
#: template — Meta rejects rather than reclassifies — so it gets its own bucket
#: and its own sentence.
CODE_ONLY_CATEGORIES = ("AUTHENTICATION",)

#: The categories a marketing word can move. A MARKETING template containing
#: marketing words is not a finding, and reporting it as one is how a check
#: teaches people to ignore it.
RECLASSIFIABLE_CATEGORIES = ("UTILITY", "AUTHENTICATION")

#: The audience-filter keys `routers/prachar.py::_resolve_audience` applies, in
#: the order it applies them. An allowlist and not a pass-through: these become
#: SQL predicates, so a key arriving from a stored jsonb blob must be one this
#: module recognises or it is ignored AND REPORTED as ignored — a filter that is
#: stored, shown and never applied is the defect that made an operator believe
#: an audience was narrowed when it was not.
AUDIENCE_KEYS = ("type", "source", "company", "tag", "min_score")


def _norm_text(value: str | None) -> str:
    r"""Free text reduced to lowercase words separated by single spaces.

    Punctuation, separators, control characters and symbols collapse to spaces,
    so "STOP!!", "stop." and "stop" are one thing and the danda in "बंद करो।"
    goes the same way a full stop does.

    KEEPING THE MARKS IS THE WHOLE POINT, and it was nearly got wrong. The
    obvious spelling of this is `re.sub(r"[^\w]+", " ", text)`, and it is
    BROKEN for every Indian language: Python's `\w` covers letters and digits
    but NOT combining marks, which are category Mn and Mc, and Indic vowel signs
    are combining marks. `\w` turns "बंद करो" into "ब द कर", "બંધ કરો" into
    "બ ધ કર" and "நிறுத்து" into "ந ற த த". Every one of those is a different
    string from the stop word it came from, so the vernacular half of the scan
    would have matched nothing at all and reported a confident zero.

    So the test is on the CATEGORY: letters, numbers and marks survive, and
    everything else becomes a space. That also matches what Postgres does to the
    same text with `[[:space:][:punct:]]`, which is the class the SQL twin of
    this function uses — the two have to agree or a needle normalised here never
    equals a haystack normalised there.
    """
    kept = [
        ch if unicodedata.category(ch)[0] in ("L", "N", "M") else " "
        for ch in (value or "").lower()
    ]
    return re.sub(r"\s+", " ", "".join(kept)).strip()


def _norm_email(value: str | None) -> str:
    """An address reduced to what two rows must share to be one person.

    Lowercase and trimmed, and NOTHING else. Gmail's dot-and-plus equivalence is
    deliberately not applied: it is true of Gmail and false of most Indian
    business domains, and folding `a.b@firm.in` into `ab@firm.in` would merge
    two real colleagues into one recipient and drop one of them from the send.
    """
    return (value or "").strip().lower()


def _norm_phone(value: str | None) -> str:
    """An Indian mobile reduced to its last ten digits.

    `+91 98765 43210`, `09876543210` and `9876543210` are one number, and the
    live data holds all three shapes. Ten digits rather than the whole string
    because the country code and the leading zero are formatting, not identity.
    Anything shorter than ten digits is returned as it is and simply will not
    collide with anything, which is the safe direction for a dedupe.
    """
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _display(*candidates) -> str:
    """The first non-blank name, or a sentence saying there is none.

    Never an id. A UUID in a "who" column is both a privacy leak and unusable —
    nobody can act on it — and the ratchet that enforces this on the frontend
    has no counterpart on a skill payload, so it is enforced here by never
    putting one in. The last resort is a sentence rather than a blank, because
    an empty cell reads as a rendering fault and sends somebody hunting the
    wrong bug.
    """
    for candidate in candidates:
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    return "(no name recorded)"


def _month_bounds(month: str) -> tuple[date, date]:
    """'2026-07' -> (2026-07-01, 2026-08-01). The second bound is EXCLUSIVE.

    Exclusive because the column compared against it is a `timestamptz`: a
    `<= last_day` comparison silently drops everything that happened after
    midnight on the last day of the month, which is nearly all of that day.
    """
    year, mon = (int(x) for x in month.split("-"))
    if not 1 <= mon <= 12:
        raise ValueError(f"month out of range: {month}")
    start = date(year, mon, 1)
    end = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    return start, end


# ══════════════════════════════════════════════════════════════════════════
# 33 · check_consent_ledger
# ══════════════════════════════════════════════════════════════════════════

async def check_consent_ledger(pool, org_id: str, limit: int = 200) -> dict:
    """The state of WhatsApp consent: recorded, revoked, and reachable anyway.

    Four sections, and the third is the one that matters:

      A  opt-in recorded    — contacts whose `opted_in` reads true, with the
                              caveat that NOTHING WRITES THAT COLUMN
      B  asked you to stop  — inbound messages matching a stop word in English,
                              Hinglish or nine Indian scripts
      C  reachable anyway   — who a template send would go to today, given that
                              the send route consults no consent state at all
      D  the write path     — the exact columns and the refusal that would turn
                              this report into a guarantee

    Takes nothing but the org. There is no period here on purpose: consent is a
    standing fact rather than a monthly one, and a handler that made somebody
    name a month could not run on the schedule the folio put this on.

    Never writes. It cannot record an opt-out even where one is unambiguous —
    recording consent is a write path the owner has to build, and a skill that
    silently suppressed a client's number would be making a legal decision on
    the firm's behalf out of a word list.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    # ── is there a WABA at all? ────────────────────────────────────────────
    #
    # Asked FIRST because it changes what every other number in this report
    # means. With no connected business account no inbound message can ever have
    # arrived from Meta, so a zero in the STOP scan is a zero over a corpus
    # nobody ever sent — a completely different statement from "your customers
    # have not asked you to stop".
    waba = await pool.fetchrow(
        """
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'connected')::int AS connected
        FROM staging.varta_business_accounts
        WHERE org_id = $1::uuid
        """,
        org_id,
    )
    waba = dict(waba) if waba else {}
    waba_total = int(waba.get("total") or 0)
    waba_connected = int(waba.get("connected") or 0)

    # ── A · what the ledger claims ─────────────────────────────────────────
    #
    # Counts come from their own aggregate rather than from len() over the
    # capped list below, so "45 of 60 flagged" stays true even when only 20 rows
    # are shown. A count derived from a truncated list is how a reader comes to
    # believe there were only twenty.
    totals = await pool.fetchrow(
        """
        SELECT count(*)::int AS contacts,
               count(*) FILTER (WHERE opted_in)::int AS flagged_opted_in,
               count(*) FILTER (WHERE NOT opted_in)::int AS not_flagged,
               count(opted_in_at)::int AS with_timestamp,
               count(DISTINCT opted_in_at)::int AS distinct_timestamps,
               count(graha_contact_id)::int AS linked_to_crm
        FROM staging.varta_contacts
        WHERE org_id = $1::uuid
        """,
        org_id,
    )
    totals = dict(totals) if totals else {}

    # BOTH sides of the graha join carry org_id. The FK is on the id ALONE, so
    # an id-only join can print another practice's contact name against this
    # practice's phone number — proved live — and a consent ledger is the worst
    # possible place for it, because the name is exactly what an operator acts
    # on.
    contacts = await pool.fetch(
        """
        SELECT vc.id, vc.phone_number, vc.name AS wa_name, vc.opted_in,
               vc.opted_in_at, vc.last_message_at, vc.created_at,
               gc.name AS crm_name, gc.company AS crm_company
        FROM staging.varta_contacts vc
        LEFT JOIN staging.graha_contacts gc
               ON gc.id = vc.graha_contact_id AND gc.org_id = vc.org_id
        WHERE vc.org_id = $1::uuid
        ORDER BY vc.opted_in ASC, vc.last_message_at DESC NULLS LAST
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # ── B · the STOP scan ──────────────────────────────────────────────────
    #
    # Filtered inside the database rather than by pulling the corpus back and
    # scanning it here, and the reason is correctness rather than speed: a
    # capped fetch of inbound messages would silently omit the one message that
    # mattered. A stop word is precisely the row a cap must never hide, so the
    # WHERE clause does the matching and the cap applies only to what is shown.
    #
    # `regexp_replace(..., '[[:space:][:punct:]]+', ' ', 'g')` is the SQL twin
    # of `_norm_text`, and the CLASS IS LOAD-BEARING. The obvious spelling —
    # strip everything that is not `[:alnum:]` — was written first and measured
    # against the live database, where it destroyed every Indian script:
    #
    #     'बंद करो।'      -> 'ब द कर'
    #     'બંધ કરો'      -> 'બ ધ કર'
    #     'நிறுத்து'      -> 'ந ற த த'
    #
    # Indic vowel signs are COMBINING MARKS, and a combining mark is not
    # alphanumeric to iswalnum() any more than it is to Python's `\w`. So the
    # whole vernacular half of this scan would have compared mangled haystacks
    # against intact needles, matched nothing, and reported a confident zero
    # over a corpus it had itself destroyed — the exact failure the folio's
    # 'vernacular equivalents' asks this handler to avoid.
    #
    # Removing only whitespace and punctuation keeps the marks, and it removes
    # the Devanagari danda alongside the full stop. Verified live: with this
    # class 'बंद करो।' = ANY($2::text[]) is TRUE against 'बंद करो'.
    stop_hits = await pool.fetch(
        """
        WITH inbound AS (
            SELECT m.id AS message_id, m.created_at, m.content,
                   c.varta_contact_id,
                   btrim(regexp_replace(lower(m.content), '[[:space:][:punct:]]+', ' ', 'g')) AS norm
            FROM staging.varta_messages m
            JOIN staging.varta_conversations c
                   ON c.id = m.conversation_id AND c.org_id = m.org_id
            WHERE m.org_id = $1::uuid
              AND m.direction = 'inbound'
        )
        SELECT i.message_id, i.created_at, i.content,
               (i.norm = ANY($2::text[])) AS exact_hit,
               vc.id AS contact_id, vc.phone_number, vc.name AS wa_name,
               vc.opted_in, vc.opted_in_at,
               gc.name AS crm_name, gc.company AS crm_company
        FROM inbound i
        JOIN staging.varta_contacts vc
               ON vc.id = i.varta_contact_id AND vc.org_id = $1::uuid
        LEFT JOIN staging.graha_contacts gc
               ON gc.id = vc.graha_contact_id AND gc.org_id = vc.org_id
        WHERE i.norm = ANY($2::text[])
           OR EXISTS (SELECT 1 FROM unnest($3::text[]) p WHERE i.norm LIKE '%' || p || '%')
        ORDER BY i.created_at DESC
        LIMIT $4::int
        """,
        org_id, list(EXACT_STOP_WORDS), list(PHRASE_STOP_WORDS), cap,
    )

    inbound_totals = await pool.fetchrow(
        """
        SELECT count(*)::int AS inbound_messages,
               count(DISTINCT c.varta_contact_id)::int AS contacts_who_wrote
        FROM staging.varta_messages m
        JOIN staging.varta_conversations c
               ON c.id = m.conversation_id AND c.org_id = m.org_id
        WHERE m.org_id = $1::uuid AND m.direction = 'inbound'
        """,
        org_id,
    )
    inbound_totals = dict(inbound_totals) if inbound_totals else {}
    inbound_examined = int(inbound_totals.get("inbound_messages") or 0)

    stopped: list[dict] = []
    stopped_phones: set[str] = set()
    for row in stop_hits:
        phone = row["phone_number"] or ""
        stopped_phones.add(_norm_phone(phone))
        stopped.append({
            # A row handle the UI can act on, never rendered as a person.
            "contact_id": str(row["contact_id"]),
            "who": _display(row["crm_name"], row["wa_name"]),
            "company": _display(row["crm_company"]) if row["crm_company"] else None,
            "phone_number": phone,
            "said": row["content"],
            "said_at": row["created_at"],
            "matched": "exact" if row["exact_hit"] else "phrase",
            "confidence": (
                "the whole message is a stop keyword"
                if row["exact_hit"] else
                "a stop phrase appears inside a longer message"
            ),
            # The contradiction that makes this section worth reading: the
            # ledger still says this person is opted in, because nothing on the
            # inbound path has ever looked at a message and changed a flag.
            "ledger_still_says_opted_in": bool(row["opted_in"]),
        })

    # ── C · who a send reaches anyway ──────────────────────────────────────
    #
    # ALL of them, and that is stated rather than implied. The send route reads
    # no consent state, so "reachable" is every contact in the table; the useful
    # split is how many of those have NO recorded opt-in or have actively asked
    # to stop.
    reachable_without_consent: list[dict] = []
    for row in contacts:
        has_stopped = _norm_phone(row["phone_number"]) in stopped_phones
        if row["opted_in"] and not has_stopped:
            continue
        reachable_without_consent.append({
            "contact_id": str(row["id"]),
            "who": _display(row["crm_name"], row["wa_name"]),
            "company": _display(row["crm_company"]) if row["crm_company"] else None,
            "phone_number": row["phone_number"],
            "opted_in_flag": bool(row["opted_in"]),
            "asked_to_stop": has_stopped,
            "last_message_at": row["last_message_at"],
            "why": (
                "asked to stop, and the send route has no refusal to apply"
                if has_stopped else
                "no opt-in is recorded, and the send route does not check"
            ),
        })

    opt_in_rows = [
        {
            "contact_id": str(row["id"]),
            "who": _display(row["crm_name"], row["wa_name"]),
            "company": _display(row["crm_company"]) if row["crm_company"] else None,
            "phone_number": row["phone_number"],
            "opted_in_at": row["opted_in_at"],
            "age_days": (
                days_between(today, as_date(row["opted_in_at"]))
                if row["opted_in_at"] else None
            ),
            # There is no column for it. The key is present and null rather than
            # omitted, because an absent key reads as "not applicable" and this
            # is the single most important absence in the report.
            "notice_text_shown_at_opt_in": None,
            "notice_text_status": "not recorded — no column exists to hold it",
        }
        for row in contacts if row["opted_in"]
    ]

    # A seed writes one timestamp for every row it touches. A real capture
    # writes one per person. That is a distinguishable signature, and it is the
    # only way this handler can tell an opt-in it should believe from one it
    # should not.
    flagged = int(totals.get("flagged_opted_in") or 0)
    distinct_ts = int(totals.get("distinct_timestamps") or 0)
    opt_in_looks_seeded = flagged >= 3 and distinct_ts <= 1

    # ── D · the write path that would close this ───────────────────────────
    missing_write_path = {
        "verified": (
            "No INSERT or UPDATE anywhere in this backend sets "
            "staging.varta_contacts.opted_in. The inbound webhook creates a "
            "contact and takes the column's DEFAULT of false; the send route "
            "never reads it. The column is a promise the schema makes and "
            "cannot keep."
        ),
        "columns_that_would_close_it": [
            "staging.varta_contacts.opt_in_source — where the consent came from "
            "(inbound message, web form, signed engagement letter, imported "
            "list). An opt-in with no source cannot be defended to anybody.",
            "staging.varta_contacts.opt_in_notice — the EXACT notice text the "
            "person was shown. The folio asks for this by name, and it is the "
            "one thing no report can ever reconstruct after the fact.",
            "staging.varta_contacts.opted_out_at — a nullable timestamp. Today "
            "opted_in = false means BOTH 'never asked' and 'asked and refused', "
            "and those are not the same person.",
            "staging.varta_contacts.opted_out_reason — 'stop keyword', "
            "'requested by phone', 'removed on request'. Without it every "
            "suppression looks the same and none can be reversed safely.",
        ],
        "refusal_that_would_enforce_it": (
            "routers/whatsapp.py, the outbound branch of "
            "POST /conversations/{id}/messages: refuse a TEMPLATE send to a "
            "contact with no opt_in_source or with opted_out_at set, the way "
            "routers/prachar.py already filters the email audience against "
            "staging.prachar_unsubscribes before a campaign goes out. The email "
            "side has the pattern and no column; the WhatsApp side has the "
            "column and no pattern."
        ),
    }

    limitations = [
        "THE OPT-IN COLUMN IS NEVER WRITTEN. No code path in this product sets "
        "staging.varta_contacts.opted_in, so a true in that column is not "
        "evidence that anyone consented and a false is not evidence that they "
        "refused. Every number in the opt-in section counts a flag, not a "
        "consent.",
        "No notice text is recorded anywhere. There is no column holding what a "
        "person was actually shown when they opted in, so this cannot say what "
        "any of them agreed to — only that a flag is set.",
        "This reports; it never suppresses. It cannot mark a number opted out, "
        "because a skill silently suppressing a client's number would be making "
        "a decision on the firm's behalf out of a word list.",
        "The stop scan reads inbound message TEXT only. Somebody who tapped an "
        "opt-out BUTTON on a template leaves a button payload this product does "
        "not store, and somebody who telephoned the office leaves nothing at "
        "all. This is a FLOOR on how many people asked you to stop, never a "
        "ceiling.",
        f"The stop vocabulary is {len(EXACT_STOP_WORDS)} whole-message keywords "
        f"and {len(PHRASE_STOP_WORDS)} phrases across English, Hinglish and nine "
        f"Indian scripts. It is a word list, not a language model: a stop "
        f"expressed in words that are not on it is not found. 'no' and 'nahi' "
        f"are deliberately excluded, because as a whole message they are far "
        f"more often an answer than an opt-out.",
        "This is a report on what this product recorded. It is not a legal "
        "opinion on what consent the DPDP Act or Meta's own policy requires, "
        "and no rule from either is cited here.",
    ]
    if waba_total == 0:
        limitations.append(
            "NO WHATSAPP BUSINESS ACCOUNT IS CONNECTED for this org — "
            "staging.varta_business_accounts holds no row. Nothing has ever been "
            "received from Meta, so every message counted here is seeded or "
            "imported data and a zero in the stop scan says nothing whatever "
            "about your customers."
        )
    elif waba_connected == 0:
        limitations.append(
            f"{waba_total} WhatsApp business account row(s) exist for this org "
            f"but none has status 'connected', so inbound may be incomplete and "
            f"the stop scan may be reading a partial corpus."
        )
    if inbound_examined == 0:
        limitations.append(
            "There are no inbound WhatsApp messages for this org, so the stop "
            "scan checked nothing. That is a SKIPPED CHECK and not a clean "
            "result — 0 of 0 is not the same statement as 0 of 250."
        )
    if opt_in_looks_seeded:
        limitations.append(
            f"All {flagged} contacts flagged opted_in share {distinct_ts} "
            f"distinct opted_in_at timestamp(s). One timestamp for many people "
            f"is the signature of a seed or a bulk import, not of consent "
            f"captured one person at a time."
        )
    if len(contacts) >= cap:
        limitations.append(
            f"The contact list was capped at {cap} rows out of "
            f"{totals.get('contacts')} in total. The counts are complete; the "
            f"listed rows are not."
        )

    return {
        "as_at": today,
        "counts": {
            "whatsapp_contacts": int(totals.get("contacts") or 0),
            "flagged_opted_in": flagged,
            "not_flagged": int(totals.get("not_flagged") or 0),
            "with_opt_in_timestamp": int(totals.get("with_timestamp") or 0),
            "distinct_opt_in_timestamps": distinct_ts,
            "linked_to_a_crm_contact": int(totals.get("linked_to_crm") or 0),
            "opt_ins_with_notice_text": 0,
            "inbound_messages_examined": inbound_examined,
            "contacts_who_wrote_in": int(inbound_totals.get("contacts_who_wrote") or 0),
            "asked_to_stop": len(stopped),
            "asked_to_stop_but_ledger_says_opted_in":
                sum(1 for s in stopped if s["ledger_still_says_opted_in"]),
            "reachable_without_a_recorded_opt_in": len(reachable_without_consent),
            "whatsapp_business_accounts": waba_total,
            "whatsapp_business_accounts_connected": waba_connected,
            "listed_rows_capped_at": cap,
            "was_capped": len(contacts) >= cap,
        },
        "opt_in_recorded": opt_in_rows,
        "asked_to_stop": stopped,
        "reachable_without_a_recorded_opt_in": reachable_without_consent,
        "opt_in_is_not_evidence": opt_in_looks_seeded,
        "send_refusal_in_force": False,
        "send_refusal_note": (
            "A template send refuses nobody today. The outbound route in "
            "routers/whatsapp.py does not read opted_in, so every contact above "
            "is reachable whatever the flag says."
        ),
        "missing_write_path": missing_write_path,
        "stop_vocabulary": {
            "whole_message_keywords": len(EXACT_STOP_WORDS),
            "phrases_matched_anywhere": len(PHRASE_STOP_WORDS),
            "scripts": [
                "English", "Hinglish (roman Hindi)", "Devanagari", "Gujarati",
                "Bengali", "Tamil", "Telugu", "Kannada", "Malayalam", "Punjabi",
            ],
        },
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 34 + 40 · check_broadcast_preflight
# ══════════════════════════════════════════════════════════════════════════

def _audience_predicates(filters: dict, params: list) -> tuple[str, list[str]]:
    r"""The stored audience filter, as SQL, mirroring `_resolve_audience`.

    Returns the SQL fragment and the list of keys that were IGNORED.

    A DELIBERATE DUPLICATE, and the duplication is stated rather than hidden.
    `routers/prachar.py::_resolve_audience` is the sender, and importing it here
    would drag a FastAPI router — with its `Depends` sentinels, which resolve for
    ROUTES ONLY and arrive as objects in a direct call — into a handler that
    runs on a scheduler at 6am. So the clauses are restated, key for key, in the
    same order, with the same presence test (`is not None`, never truthiness — a
    stored `min_score` of 0 is a real filter meaning "everyone", and truthiness
    silently dropped it once already).

    If these two ever drift, this preflight describes a different audience from
    the one the send resolves. That risk is on `limitations` rather than left
    for somebody to discover.

    Every value is BOUND. Nothing is interpolated: the only text that reaches
    the SQL string is a parameter number this function generated itself.
    """
    sql = ""
    ignored = [key for key in filters if key not in AUDIENCE_KEYS]

    if filters.get("type") is not None:
        params.append(str(filters["type"]))
        sql += f" AND gc.contact_type = ${len(params)}"
    if filters.get("source") is not None:
        params.append(str(filters["source"]))
        sql += f" AND gc.source = ${len(params)}"
    if filters.get("tag") is not None:
        params.append(str(filters["tag"]))
        sql += f" AND ${len(params)} = ANY(gc.tags)"
    if filters.get("min_score") is not None:
        try:
            score = int(filters["min_score"])
        except (TypeError, ValueError):
            ignored.append("min_score")
        else:
            params.append(score)
            # CAST. `lead_score >= $2` is an untyped parameter expression, and
            # PgBouncer turns an untyped parse error into an instant 500 with no
            # useful message — the credits incident, in a different query.
            sql += f" AND gc.lead_score >= ${len(params)}::int"
    if filters.get("company") is not None:
        raw = str(filters["company"])
        # The backslash first: escaping the wildcards first would then double
        # the backslashes this step just introduced. A marketer typing "100%"
        # into the company box was once asking for one company and getting every
        # company in the org, and the preview then reported the larger number as
        # though it were the segment.
        escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")
        sql += f" AND gc.company ILIKE ${len(params)} ESCAPE '\\'"
    return sql, ignored


def _as_filter_dict(value) -> dict:
    """jsonb -> dict, whatever asyncpg handed back.

    Depending on whether a jsonb codec is registered on the pool this arrives as
    a `dict` or as the raw `str`. Both shapes are live in this codebase, and a
    handler that assumed one of them would work in the tests and fail on the
    scheduler, or the other way round.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, (str, bytes, bytearray)):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


async def check_broadcast_preflight(pool, org_id: str, limit: int = 200) -> dict:
    """Before you send to a list, name who should not get it.

    Catalogue #34 and #40, merged — the folio says they are one skill on two
    channel columns, and splitting them would have produced two definitions of
    "should not get it".

    Per unsent campaign, five buckets and a count:

      · no recorded opt-in     — and on EMAIL that is everyone, because this
                                 product records only opt-OUTS on email
      · already unsubscribed   — the one consent fact genuinely recorded, and
                                 only on email
      · duplicates             — several contacts resolving to one address
      · no address at all      — in the segment, unreachable on this channel
      · deliverable            — the real count, against the claimed one

    Takes nothing but the org: it examines every campaign that has not gone out
    yet, so a schedule can run it the morning of a send.

    THE BOUNCE CHECK IS NOT PERFORMED AND IS NOT REPORTED AS ZERO. Nothing in
    this product ingests a delivery event, so an empty bounce list would read as
    a clean list. It is reported as NOT MEASURED, and no deliverability, quality
    or engagement figure is printed at all.

    Never writes. It does not remove a recipient, unsubscribe anybody, or touch
    a campaign's status.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    campaigns = await pool.fetch(
        """
        SELECT id, name, channel, status, total_recipients, audience_filter,
               scheduled_at, created_at
        FROM staging.prachar_campaigns
        WHERE org_id = $1::uuid
          AND COALESCE(is_active, TRUE)
          AND COALESCE(status, 'draft') IN ('draft', 'scheduled', 'paused', 'suppressed')
        ORDER BY COALESCE(scheduled_at, created_at) DESC NULLS LAST
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # The suppression list, fetched once. It is keyed by ADDRESS and not by
    # contact, which is also why an address that unsubscribed while attached to
    # a contact the CRM later deleted still suppresses correctly.
    unsub_rows = await pool.fetch(
        "SELECT email FROM staging.prachar_unsubscribes WHERE org_id = $1::uuid",
        org_id,
    )
    unsub_set = {_norm_email(r["email"]) for r in unsub_rows if r["email"]}

    # The WhatsApp opt-in ledger, once, keyed by the last ten digits. Read even
    # though nothing writes it, because "0 of 858 have an opt-in" and "the
    # column exists and is empty" are the same fact stated with and without its
    # denominator, and only one of them is actionable.
    wa_rows = await pool.fetch(
        "SELECT phone_number, opted_in FROM staging.varta_contacts WHERE org_id = $1::uuid",
        org_id,
    )
    wa_opted_in = {_norm_phone(r["phone_number"]) for r in wa_rows if r["opted_in"]}

    # Campaigns are grouped by their audience filter, so an org with sixty
    # drafts sharing nine filters runs nine queries and not sixty. The key is
    # the SORTED filter, so {"tag":"a","type":"b"} and {"type":"b","tag":"a"}
    # are one group rather than two.
    groups: dict[str, dict] = {}
    for campaign in campaigns:
        filters = _as_filter_dict(campaign["audience_filter"])
        key = json.dumps({k: filters[k] for k in sorted(filters)}, sort_keys=True, default=str)
        groups.setdefault(key, {"filters": filters, "campaigns": []})["campaigns"].append(campaign)

    resolved: dict[str, dict] = {}
    for key, group in groups.items():
        params: list = [org_id]
        predicates, ignored = _audience_predicates(group["filters"], params)
        # No `email IS NOT NULL` here, unlike the sender. The sender is choosing
        # who to mail; this is choosing what to report, and a contact with no
        # address is the finding rather than something to filter away before
        # counting.
        rows = await pool.fetch(
            f"""
            SELECT gc.id, gc.name, gc.email, gc.phone, gc.company
            FROM staging.graha_contacts gc
            WHERE gc.org_id = $1::uuid
              AND gc.is_active = TRUE
              AND gc.merged_into_id IS NULL
              {predicates}
            ORDER BY gc.name
            """,
            *params,
        )
        resolved[key] = {"rows": rows, "ignored_filter_keys": ignored}

    reports: list[dict] = []
    for key, group in groups.items():
        rows = resolved[key]["rows"]
        ignored = resolved[key]["ignored_filter_keys"]

        for campaign in group["campaigns"]:
            channel = (campaign["channel"] or "email").lower()
            uses_email = channel == "email"

            no_address: list[dict] = []
            addressed: list[tuple[str, dict]] = []
            for row in rows:
                address = _norm_email(row["email"]) if uses_email else _norm_phone(row["phone"])
                who = {
                    "contact_id": str(row["id"]),
                    "who": _display(row["name"], row["company"]),
                    "company": _display(row["company"]) if row["company"] else None,
                }
                if not address:
                    no_address.append({
                        **who,
                        "why": f"no {'email address' if uses_email else 'phone number'} is "
                               f"recorded, and this campaign's channel is {channel}",
                    })
                else:
                    addressed.append((address, who))

            seen: dict[str, list[dict]] = {}
            for address, who in addressed:
                seen.setdefault(address, []).append(who)

            duplicates = [
                {
                    "address": address,
                    "contacts_resolving_to_it": len(people),
                    "extra_copies": len(people) - 1,
                    "who": [p["who"] for p in people][:5],
                    "who_not_shown": max(0, len(people) - 5),
                }
                for address, people in seen.items() if len(people) > 1
            ]
            duplicates.sort(key=lambda d: d["extra_copies"], reverse=True)
            extra_copies = sum(d["extra_copies"] for d in duplicates)

            if uses_email:
                suppressed = [a for a in seen if a in unsub_set]
                # EMAIL HAS NO OPT-IN RECORD AT ALL. Not "none of these opted
                # in" — there is no column, no table and no capture point on the
                # email side, only the opt-OUT list. Every addressed recipient
                # is therefore "no recorded opt-in" by construction, and the
                # honest way to say that is to say it once, loudly, rather than
                # to print a number that looks like a measurement.
                no_opt_in_count = len(seen)
                no_opt_in_basis = (
                    "There is no opt-in record for email anywhere in this "
                    "product — no column and no capture point. Only unsubscribes "
                    "are recorded. So this counts the whole addressed list by "
                    "construction: it is the size of the list, not a finding "
                    "about it."
                )
            else:
                suppressed = []
                no_opt_in_count = sum(1 for a in seen if a not in wa_opted_in)
                no_opt_in_basis = (
                    "Matched against staging.varta_contacts.opted_in by the last "
                    "ten digits of the number. That column is never written by "
                    "any code path, so a miss here means 'no record' and never "
                    "'they refused'."
                )

            deliverable = len(seen) - len(suppressed)
            claimed = int(campaign["total_recipients"] or 0)

            reports.append({
                "campaign_id": str(campaign["id"]),
                "campaign": campaign["name"],
                "channel": channel,
                "status": campaign["status"],
                "scheduled_at": campaign["scheduled_at"],
                "claimed_recipients": claimed,
                "in_segment": len(rows),
                "unique_addresses": len(seen),
                "deliverable_now": deliverable,
                "claimed_minus_deliverable": claimed - deliverable,
                "no_address_at_all": {
                    "count": len(no_address),
                    "rows": no_address[:cap],
                    "rows_not_shown": max(0, len(no_address) - cap),
                },
                "duplicates_resolving_to_one_address": {
                    "addresses": len(duplicates),
                    "extra_copies_avoided": extra_copies,
                    "rows": duplicates[:cap],
                    "rows_not_shown": max(0, len(duplicates) - cap),
                },
                "already_unsubscribed": {
                    "count": len(suppressed),
                    "measured": uses_email,
                    "note": (
                        "Matched against staging.prachar_unsubscribes, which the "
                        "email send path already applies before it dispatches."
                        if uses_email else
                        "NOT MEASURED on this channel. There is no unsubscribe "
                        "list for WhatsApp or SMS — staging.prachar_unsubscribes "
                        "is keyed by email address and holds nothing else."
                    ),
                },
                "no_recorded_opt_in": {
                    "count": no_opt_in_count,
                    "basis": no_opt_in_basis,
                },
                "bounced_previously": {
                    "measured": False,
                    "state": "NOT MEASURED",
                    "why": (
                        "Nothing in this product ingests a delivery event. There "
                        "is no bounce webhook, no suppression feed from the mail "
                        "provider, and staging.outbound_log records only what "
                        "this server attempted. An empty bounce list here would "
                        "mean 'never looked', not 'clean'."
                    ),
                },
                "channel_can_be_delivered": uses_email,
                "channel_note": (
                    None if uses_email else
                    f"Prachar delivers email only. routers/prachar.py refuses to "
                    f"send a {channel} campaign — correctly, because resolving it "
                    f"as email would reach a different set of people from the "
                    f"ones this channel was chosen for. These {claimed} claimed "
                    f"recipients have no send path at all today."
                ),
                "ignored_filter_keys": ignored,
            })

    reports.sort(key=lambda r: r["claimed_minus_deliverable"], reverse=True)
    undeliverable_channel = [r for r in reports if not r["channel_can_be_delivered"]]

    limitations = [
        "BOUNCES ARE NOT MEASURED AND ARE NOT REPORTED AS ZERO. Nothing here "
        "ingests a delivery event, so a previously-bounced address is "
        "indistinguishable from a good one. Treat every list as unscreened for "
        "bounces however clean the rest of this report looks.",
        "No deliverability, quality or engagement figure is printed. Open and "
        "click columns exist on staging.prachar_campaign_contacts but only a "
        "send writes them, so a rate computed here would be a number about "
        "campaigns that never went out.",
        "EMAIL HAS NO OPT-IN RECORD IN THIS PRODUCT. The only email consent fact "
        "recorded is the unsubscribe list, which is an opt-OUT. So 'no recorded "
        "opt-in' on an email campaign counts the whole list by construction — a "
        "statement about the schema, not about the recipients.",
        "The WhatsApp opt-in column (staging.varta_contacts.opted_in) is never "
        "written by any code path, so on a WhatsApp or SMS campaign a contact "
        "with no opt-in may well have given one verbally. See "
        "check_consent_ledger for the columns that would fix it.",
        "The audience is resolved by a restatement of "
        "routers/prachar.py::_resolve_audience, not by calling it — importing a "
        "FastAPI router into a scheduled handler brings its Depends sentinels "
        "with it, and those resolve for routes only. The clauses match key for "
        "key today; if the sender changes and this does not, this preflight "
        "will describe a different audience from the one that goes out.",
        "Duplicates are addresses that two or more contact rows share. Two "
        "different addresses belonging to one human being are not detected, and "
        "that person receives the campaign twice.",
        "The claimed recipient count is whatever is stored on the campaign row. "
        "Nothing guarantees it was ever recomputed after the segment changed, so "
        "a gap between claimed and deliverable can be a stale number rather than "
        "a dirty list — and it can be NEGATIVE, meaning the stored count is "
        "smaller than the segment resolves to today.",
        "Every org-level total whose key ends `_summed_over_campaigns` adds up "
        "SEND SLOTS, not people. Campaigns sharing an audience count the same "
        "person once each, so those figures are larger than the number of human "
        "beings involved and must never be read as a headcount. The per-campaign "
        "numbers are the ones to act on.",
        "This reports; it never edits a list, unsubscribes anybody, or changes a "
        "campaign's status.",
    ]
    if not campaigns:
        limitations.append(
            "No unsent campaign was found for this org, so nothing was "
            "pre-flighted. That is a skipped check, not a clean bill."
        )
    if len(campaigns) >= cap:
        limitations.append(
            f"Examined the {cap} most recent unsent campaigns; older ones were "
            f"not looked at."
        )
    if undeliverable_channel:
        limitations.append(
            f"{len(undeliverable_channel)} campaign(s) here are on a channel "
            f"Prachar cannot deliver (sms or whatsapp), together claiming "
            f"{sum(r['claimed_recipients'] for r in undeliverable_channel)} "
            f"recipients. Their buckets are computed against the CRM's phone "
            f"column so the list can still be cleaned, but no send path exists."
        )

    return {
        "as_at": today,
        "counts": {
            "campaigns_examined": len(campaigns),
            "distinct_audience_filters": len(groups),
            "campaigns_on_an_undeliverable_channel": len(undeliverable_channel),
            # EVERY KEY BELOW ENDING `_summed_over_campaigns` IS A SUM OF SEND
            # SLOTS, NOT A COUNT OF PEOPLE, and the names say so because the
            # unqualified names lied. Sixty drafts sharing one audience produced
            # `already_unsubscribed: 12430` on the live E2E org — the same 227
            # suppressed addresses counted sixty times — which reads as twelve
            # thousand distinct people who opted out of a list that has 268 rows
            # in it. A total that cannot be true is worse than no total, and it
            # is exactly the kind of number a CA notices first.
            "claimed_recipients_summed_over_campaigns":
                sum(r["claimed_recipients"] for r in reports),
            "deliverable_summed_over_campaigns":
                sum(r["deliverable_now"] for r in reports),
            "no_address_summed_over_campaigns":
                sum(r["no_address_at_all"]["count"] for r in reports),
            "duplicate_extra_copies_summed_over_campaigns": sum(
                r["duplicates_resolving_to_one_address"]["extra_copies_avoided"]
                for r in reports
            ),
            "already_unsubscribed_summed_over_campaigns":
                sum(r["already_unsubscribed"]["count"] for r in reports),
            # These two ARE org-level counts of distinct things, which is why
            # they carry no suffix.
            "unsubscribe_list_size": len(unsub_set),
            "whatsapp_numbers_with_an_opt_in_flag": len(wa_opted_in),
            # Deliberately null and never 0. See `bounce_check`.
            "bounced_previously": None,
            "campaigns_capped_at": cap,
            "was_capped": len(campaigns) >= cap,
        },
        "bounce_check": "NOT MEASURED",
        "campaigns": reports[:cap],
        "campaigns_not_shown": max(0, len(reports) - cap),
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 35 · brief_whatsapp_cost
# ══════════════════════════════════════════════════════════════════════════

def _scan_template_text(fields: dict) -> list[dict]:
    """Marketing wording found in a template, with the field it was found in.

    Word-boundary matching on the normalised text, not a bare substring: "free"
    inside "freelance" and "deal" inside "dealing" are not promotional wording,
    and a check that cries wolf on a correct template is a check people turn
    off. Multi-word entries are matched as phrases against the same normalised
    form, so "limited time" matches "limited-time" and "Limited  Time" alike.
    """
    hits: list[dict] = []
    for field, raw in fields.items():
        text = _norm_text(raw)
        if not text:
            continue
        for term in MARKETING_LEXICON:
            needle = _norm_text(term)
            if not needle:
                continue
            if re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", text, flags=re.UNICODE):
                hits.append({"term": term, "field": field})
    return hits


async def brief_whatsapp_cost(
    pool,
    org_id: str,
    month: str | None = None,
    rate_card_inr: dict | None = None,
    limit: int = 200,
) -> dict:
    """Wording that reclassifies a template, and the month's send volume.

    *month* is 'YYYY-MM' and defaults to the PREVIOUS complete month, because a
    cost report run on the 3rd is asking about the month that finished, not the
    two days of the one that started. It defaults rather than being required so
    that the monthly schedule the folio put this on can actually call it.

    *rate_card_inr* is optional and defaults to None. Meta's India rate card is
    not recorded anywhere in this product — there is no settings table, no org
    column, and `statute_calendar` is for statute, which a commercial rate card
    is not. With no card supplied the volume is reported and NO RUPEE FIGURE IS
    PRINTED; with one supplied the total is labelled an ESTIMATE on every key
    that carries it, because Meta bills the org directly and this product never
    sees the invoice. Shape:

        {"MARKETING": 0.80, "UTILITY": 0.12, "AUTHENTICATION": 0.13}

    NO TAX POSITION IS STATED on Meta's invoice, here or anywhere in the output.

    Never writes.
    """
    today = utc_now().date()
    period = month or return_period()
    try:
        start, end_exclusive = _month_bounds(period)
    except (ValueError, AttributeError, TypeError):
        # A malformed month is a caller error, not a reason to fail a scheduled
        # run — but the month actually used is reported, so nobody reads last
        # month's figures believing they asked for another one.
        period = return_period()
        start, end_exclusive = _month_bounds(period)
    cap = max(1, int(limit))

    templates = await pool.fetch(
        """
        SELECT id, name, language, category, status, body, header_type,
               header_content, footer, buttons
        FROM staging.varta_templates
        WHERE org_id = $1::uuid
        ORDER BY category, name
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # `template_name` on a message is TEXT, and it is matched to the template
    # table by name INSIDE THIS ORG. Never by name alone: two practices may both
    # hold a template called `payment_reminder`, and joining on the name would
    # price one practice's sends against the other practice's category.
    by_name = {
        (r["name"] or "").strip().lower(): (r["category"] or "").strip().upper() or "UNCATEGORISED"
        for r in templates
    }

    reclassification_risks: list[dict] = []
    code_only_risks: list[dict] = []
    for row in templates:
        category = (row["category"] or "").strip().upper()
        if category not in RECLASSIFIABLE_CATEGORIES:
            continue
        buttons = row["buttons"]
        if isinstance(buttons, (str, bytes, bytearray)):
            try:
                buttons = json.loads(buttons)
            except (ValueError, TypeError):
                buttons = []
        button_text = " ".join(
            str(b.get("text") or "") for b in (buttons or []) if isinstance(b, dict)
        )
        hits = _scan_template_text({
            "body": row["body"],
            "header": row["header_content"],
            "footer": row["footer"],
            "buttons": button_text,
        })
        if not hits:
            continue
        entry = {
            "template_id": str(row["id"]),
            "template": row["name"],
            "language": row["language"],
            "category": category,
            "status": row["status"],
            "matched": hits,
            "terms": sorted({h["term"] for h in hits}),
        }
        if category in CODE_ONLY_CATEGORIES:
            entry["risk"] = (
                "An authentication template should carry a one-time code and "
                "nothing else. Meta rejects rather than reclassifies these, so "
                "this wording risks the template being refused outright."
            )
            code_only_risks.append(entry)
        else:
            entry["risk"] = (
                "Promotional wording in a UTILITY template. If Meta reads it as "
                "marketing the template is billed at the marketing rate AND is "
                "refused for anyone who has opted out of marketing — so the same "
                "template silently reaches fewer people and costs more."
            )
            reclassification_risks.append(entry)

    # ── the volume recut ───────────────────────────────────────────────────
    volume = await pool.fetch(
        """
        SELECT m.template_name,
               count(*)::int AS messages,
               count(*) FILTER (WHERE m.status = 'failed')::int AS failed,
               count(*) FILTER (WHERE m.status = 'suppressed')::int AS suppressed
        FROM staging.varta_messages m
        WHERE m.org_id = $1::uuid
          AND m.direction = 'outbound'
          AND m.created_at >= $2::date
          AND m.created_at <  $3::date
        GROUP BY m.template_name
        ORDER BY 2 DESC
        """,
        org_id, start, end_exclusive,
    )

    by_category: dict[str, int] = {}
    unattributed = 0
    per_template: list[dict] = []
    for row in volume:
        name = (row["template_name"] or "").strip().lower()
        # A suppressed message never left this server and a failed one never
        # reached a handset. Neither is billable, and counting them would inflate
        # an estimate in the direction that makes the product look expensive —
        # which is still a wrong number.
        billable = max(0, int(row["messages"]) - int(row["failed"]) - int(row["suppressed"]))
        category = by_name.get(name) if name else None
        if category:
            by_category[category] = by_category.get(category, 0) + billable
        else:
            unattributed += billable
        per_template.append({
            "template": row["template_name"] or "(no template name recorded)",
            "category": category or "unattributable",
            "messages": int(row["messages"]),
            "not_delivered": int(row["failed"]) + int(row["suppressed"]),
            "billable_basis": billable,
        })

    total_outbound = sum(int(r["messages"]) for r in volume)
    total_billable = sum(by_category.values()) + unattributed

    # ── the rupee half, only if somebody supplied a card ───────────────────
    estimate = None
    if rate_card_inr:
        card = {}
        for key, value in rate_card_inr.items():
            try:
                card[str(key).strip().upper()] = float(value)
            except (TypeError, ValueError):
                continue
        priced: dict[str, dict] = {}
        unpriced: list[dict] = []
        total = 0.0
        for category, count in by_category.items():
            rate = card.get(category)
            if rate is None:
                unpriced.append({"category": category, "messages": count})
                continue
            line = round(rate * count, 2)
            priced[category] = {"messages": count, "rate_inr": rate, "estimate_inr": line}
            total += line
        estimate = {
            "is_an_estimate": True,
            "label": (
                "ESTIMATE — Meta bills the org directly and this product never "
                "sees the invoice."
            ),
            "rate_card_source": "supplied by the caller; not recorded in this product",
            "priced": priced,
            "categories_with_no_rate_supplied": unpriced,
            "messages_with_no_category": unattributed,
            "total_estimate_inr": round(total, 2),
            "total_is_a_floor": bool(unpriced or unattributed),
        }

    limitations = [
        "The lexicon scan finds WORDING; it does not predict Meta's decision. "
        "Meta reviews a template as a whole and can reclassify one containing "
        "none of these words, or approve one containing several. A clean result "
        "here is not an assurance.",
        "No rupee figure is printed unless a rate card is supplied. Meta's India "
        "rate card is not recorded anywhere in this product, and printing a "
        "per-message price from memory in front of a chartered accountant is "
        "exactly the failure that would discredit the whole shelf.",
        "This handler takes NO POSITION on the tax treatment of Meta's invoice. "
        "That is a question about a third party's document and it belongs to the "
        "firm and its own advice, not to a skill card.",
        "Meta's billing unit and its rate card both change on published "
        "effective dates and this product records neither. Any estimate is "
        "against the card the caller passed in, on the day they passed it.",
        "Suppressed and failed messages are excluded from the billable basis. "
        "Whether Meta agrees about any particular message is not knowable from "
        "here — the only record of a send is this server's own row.",
        "Only messages sent through this product are counted. Anything sent from "
        "the Meta Business Manager, from a phone, or through another vendor on "
        "the same WABA is invisible here, so the volume is a FLOOR.",
    ]
    if not templates:
        limitations.append(
            "This org holds no WhatsApp templates, so the lexicon scan examined "
            "nothing. 0 of 0 is a skipped check, not a clean one."
        )
    if unattributed:
        limitations.append(
            f"{unattributed} outbound message(s) in {period} carry no template "
            f"name matching a template in this org, so they cannot be attributed "
            f"to a pricing category. Any total is a FLOOR."
        )
    if total_outbound and not by_category:
        limitations.append(
            f"NONE of the {total_outbound} outbound messages in {period} can be "
            f"priced: not one carries a template_name matching a template in "
            f"this org. The send route does write that column, so this is an "
            f"absence of template sends rather than a broken writer — but it "
            f"means the volume recut has no category split at all."
        )
    if not total_outbound:
        limitations.append(
            f"No outbound WhatsApp message was recorded for this org in "
            f"{period}, so there is no volume to recut. That is a skipped check, "
            f"not a zero bill."
        )
    if len(templates) >= cap:
        limitations.append(
            f"The template scan was capped at {cap} templates; any beyond that "
            f"were not read."
        )

    return {
        "as_at": today,
        "month": period,
        "window_from": start,
        "window_to_exclusive": end_exclusive,
        "counts": {
            "templates_examined": len(templates),
            "templates_at_reclassification_risk": len(reclassification_risks),
            "authentication_templates_at_rejection_risk": len(code_only_risks),
            "outbound_messages_in_month": total_outbound,
            "billable_basis_messages": total_billable,
            "messages_attributed_to_a_category": sum(by_category.values()),
            "messages_with_no_category": unattributed,
            "rupee_estimate_computed": estimate is not None,
            "templates_capped_at": cap,
            "was_capped": len(templates) >= cap,
        },
        "reclassification_risks": reclassification_risks,
        "authentication_rejection_risks": code_only_risks,
        "volume_by_category": by_category,
        "volume_by_template": per_template[:cap],
        "cost_estimate_inr": estimate,
        "cost_estimate_note": (
            "ESTIMATE. Meta bills the org directly; this product never sees the "
            "invoice."
            if estimate else
            "No rupee estimate was computed. Meta's India rate card is not "
            "recorded anywhere in this product, so none is printed. Pass "
            "rate_card_inr={'MARKETING': x, 'UTILITY': y, 'AUTHENTICATION': z} "
            "to price the volume above."
        ),
        "lexicon_terms": len(MARKETING_LEXICON),
        "limitations": limitations,
    }
