"""
recon_rules — the reconciliation edges of the catalogue: #17, #39, #42, #43.

Four handlers that all sit around one fact: in this product "paid" arrives from
bank reconciliation and from nothing else. There is no gateway, no callback and
no webhook that can ever say a customer paid. Everything below therefore either
AUDITS the path a payment reference travels, or produces a CLAIM a person
confirms against a bank line — and one of the four exists mainly to refuse.

    check_upi_reference_threading   #17 · does the invoice number reach the bank
    check_payment_proof_claims      #39 · a screenshot is a claim, never a receipt
    check_narration_rule_candidates #42 · blocked: nothing records a category
    brief_working_paper_figures     #43 · the frozen figure table a note is
                                          written AROUND, plus the constraints

── #17 is infrastructure; only the READ half is a skill ──────────────────────

The folio's #17 is a change to the WRITER: put the invoice number into the UPI
`tn` and `tr` fields on every link and QR, and key the matcher on that reference
before it scores on amount. `bank_matching.check_unmatched_receipts` already
does the reference-first half. The half nobody has done is `tr`, and this
handler MEASURES that rather than asserting it: it calls `services.upi.pay_uri`
— the one function every link and QR in the product goes through — with a probe
invoice number, and parses the query string it gets back. If the CTO adds `tr`
tomorrow this handler stops reporting the gap without anybody editing it. A code
fact read from the code beats a code fact remembered.

Measured that way on 2026-08-20, `pay_uri` emits `am, cu, pa, pn, tn`. The
reference rides in `tn` alone, and `tn` is the free-text note a payer's app is
free to show, truncate, replace or drop.

── #39 refuses before it reports ─────────────────────────────────────────────

A payment screenshot is a picture of a claim. Marking an invoice paid from one
is refused outright, and the refusal is ON THE OUTPUT rather than only in this
docstring, because the whole reason the skill is safe is that it does the weaker
thing — and a reader who does not know that will ask for the stronger one.

It also has no channel. Receiving an image needs a WhatsApp Business account and
`staging.varta_business_accounts` holds ZERO rows across all three
organisations. The handler reports the blocker and returns the honest shape over
whatever attachment data does exist — today none, out of a stated denominator,
rather than a bare zero that reads like a clean result.

── #42 is blocked by an absence nobody would guess ───────────────────────────

The folio wanted string rules learned from narrations already categorised the
same way three or more times, with only the residual tail going to one batched
model call. There is nothing to learn from, and the shape of the nothing moved
while this was being written.

At the first probe on 2026-08-20 `staging.ganit_bank_statement_lines` carried
`matched_type`, `matched_payment_id`, `is_reconciled` and `batch_id` — a match
to a payment, which is not a category — and no column recorded that a narration
had been ASSIGNED one. Later the same day the table gained `category`,
`categorised_by` and `categorised_at`. **All three are empty: 0 of 259 rows in
the only organisation holding a statement carry a category.** So the blocker is
no longer a missing column, it is a write path nothing has ever used, and this
handler MEASURES which of those two it is rather than asserting either — the
absence is read from `information_schema` and from the rows, so the day someone
starts categorising, the output changes without anybody editing it.

One thing the new columns do not yet give: `categorised_by` records WHO, which
is not the same as WHAT KIND. A learner needs to tell a human's assignment from
a rule's own output, or it trains on its own guesses and the second month's
rules are evidence of nothing but the first month's. A `category_source`
('human' | 'rule'), or a reserved actor value that means "a rule did this", is
what closes that.

Until then the only class available is `matched_type`, and its live shape is
worse than the folio guessed: exactly ONE non-null value — `invoice_payment`, on
all 128 reconciled lines; the other 131 are NULL. Every candidate derivable from
that is 100% pure by ARITHMETIC, because there is only one class to be impure
of. This handler returns the deterministic candidates anyway, labelled
unvalidated, and ships NO MODEL TIER: without categorised rows the skill
degrades into "a language model reads your bank statement every month", the
exact recurring cost the shelf exists to avoid.

── #43 hands the model prose and never a number ──────────────────────────────

When a deterministic guard finds a difference, the covering note is sentences
AROUND a table of figures the model never touches. So this handler returns the
table, frozen, each row addressed by a short ref (`F1`, `F2`…), together with
the drafting constraints. The drafter substitutes `{{F1}}`; it never retypes a
figure, which is why `screen_drafted_note` treats ANY numeral in drafted prose
as a violation.

THE CONSTRAINT THAT MAKES IT SAFE MUST NEVER BE RELAXED: no statutory citations
and no authority references in the drafted prose. A covering note that cites a
section is a legal opinion with a source nobody read, signed by a chartered
accountant who will be held to it. `screen_drafted_note` is the deterministic
gate for that rule, so it is a check rather than a wish.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

Three organisations: Aekam Inc, Unicode Group, and the seeded E2E test org.

  · #17 builder · `pay_uri` emits `am, cu, pa, pn, tn` in every organisation.
    The reference reaches `tn`; `tr` is emitted by nothing.
  · #17 outward · Aekam: 5 invoices hold a live link, 5 threaded. Unicode: 38
    live, 38 threaded. E2E: 289 live, **0 threaded** — that organisation has
    recorded no UPI receiving address at all (`org_upi_accounts` 0 active rows,
    `organisations.upi_vpa` NULL), so its 289 live pay links render no UPI code
    for a reference to ride on. Not one of the 289 is a lost reference; there is
    no code, which is a different repair.
  · #17 return path · every statement line in the database sits in the E2E org.
    In the default 180-day window: 76 credits, 66 naming a real invoice, 10
    naming nothing, all 10 still unreconciled. Over the whole file: 170 credits,
    160 named, 10 not. That org renders no UPI code, so those references did not
    come from a `tn` this product wrote. The two halves of #17 live in different
    organisations, so the end-to-end claim is UNMEASURABLE on this data — which
    the output says, rather than quietly multiplying the two rates together.
  · #39 · WhatsApp Business accounts: 0 in all three orgs. Inbound messages
    carrying an attachment: 0 of 250 in E2E, 0 of 0 elsewhere. No claim rows.
  · #42 · E2E: 259 lines, **0 carrying a category**, 128 carrying a
    `matched_type`, 1 distinct class, 3 candidate tokens at support >= 3 — `INV`,
    `PMT` and `UPI`, each on all 128 classified lines and each also firing on 32
    lines nobody has classified. Residual: 0. Aekam and Unicode hold no
    statement lines: nothing derived, nothing checked, and the output says
    "not measured" rather than "no rules found".
  · #43 · 2026-07 · E2E: books receipts 46,87,631.90, of which 26,32,787.62
    arrived by UPI or bank transfer, against 2,15,492.00 of credits reconciled
    on the statement — a difference of 24,17,295.62 that the note must state and
    must not attribute (16 statement lines cover the period, 7 of them still
    unreconciled, which is the ordinary explanation and is the preparer's to
    make). Aekam and Unicode hold NO statement lines, so that guard returns
    `not_measured` for them rather than a difference of the whole figure —
    88,500.00 and 3,24,212.00 respectively, both of which would have been
    confident nonsense. Unicode also fails the ledger-identity guard: invoice
    INV-2026-0007 carries a total of 0.00 against 60,000.00 paid.
"""
import logging
import re
from datetime import timedelta

# The matcher's own ruler, imported rather than re-implemented. #17 audits
# whether a reference WOULD be found, and `bank_matching.check_unmatched_receipts`
# is what does the finding — measuring with a different ruler than the matcher
# uses would produce an audit that is precisely, quantitatively wrong. These are
# private names in that module, and importing them is the point: they are not an
# interface, they are the definition this audit has to agree with.
from services.skills.data.bank_matching import (
    MIN_REF_TOKEN,
    _names_the_invoice,
    _norm,
)
from services.skills.reachable import reachable
from services.skills.timeutil import (as_date, days_between, month_window, return_period, today_ist, utc_now)

log = logging.getLogger(__name__)

#: How far back to look for statement lines when auditing the return path.
DEFAULT_DAYS_BACK = 180

#: How far back to look for an inbound payment proof. Shorter than the statement
#: window on purpose: a screenshot is a live claim about a payment somebody
#: believes they have just made, and a three-month-old one is a filing question.
DEFAULT_PROOF_DAYS_BACK = 90

#: Days either side of a proof message to offer statement lines beside it. A UPI
#: credit lands the same day; NEFT and IMPS can straddle a weekend.
PROOF_WINDOW_DAYS = 5

#: How many times a token must appear before it is even a rule CANDIDATE.
MIN_RULE_SUPPORT = 3

#: A rule token must be letters only and at least this long. Tokens carrying
#: digits — `UTR000000212074`, `INV-2603-018`, a bare `2603` — identify ONE
#: transaction or one month's batch, not a class of them, so a "rule" keyed on
#: one is a lookup with a support of 1 wearing a rule's clothes.
MIN_RULE_TOKEN_LETTERS = 3

#: Which invoices actually hold a LIVE public payment link. Mirrored from
#: `routers/pay.py::_PUBLIC_DOC_STATUS` / `_PUBLIC_PAYMENT_STATUS`, and the
#: mirror is CHECKED at run time by `_payable_states_verified` rather than
#: trusted — two copies of a rule is how an audit and the page it audits come to
#: disagree about which invoices are payable, and the audit would be the one
#: that was wrong quietly.
PAYABLE_DOC_STATUS = ("final", "sent", "viewed")
PAYABLE_PAYMENT_STATUS = ("unpaid", "partial")

#: The note the QR route builds is truncated here, and `upi.pay_uri` truncates
#: `tn` at the same length. Both are 60. The constant is stated here rather than
#: imported because it is a property of the UPI note field, not of either
#: caller, and `_threading_verdict` MEASURES the truncation instead of assuming
#: it. ORDER MATTERS: `routers/pay.py` builds "{org name} {invoice number}",
#: putting the organisation's name FIRST, so a long enough name pushes the
#: invoice number off the end of the field. `ganit_ops` builds it the other way.
UPI_NOTE_LIMIT = 60

#: A drafted covering note may contain no numerals at all. Every figure arrives
#: by placeholder from the frozen table, so a digit in the prose is a figure the
#: model typed — the one thing #43 exists to prevent.
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
_NUMERAL = re.compile(r"\d")

#: Authority and citation patterns banned from drafted prose. NOT a tidiness
#: rule: a covering note that cites a section is a legal opinion with a source
#: nobody read, signed by a chartered accountant who will be held to it. This
#: list may be ADDED TO and MUST NEVER BE RELAXED.
_BANNED_PROSE = (
    (r"\bu/s\b", "a section reference"),
    (r"\bsec(?:tion|\.)?\s*\d", "a section reference"),
    (r"\brule\s*\d", "a rule reference"),
    (r"\bclause\s*\(?\s*[a-z0-9]", "a clause reference"),
    (r"\bschedule\s+[ivxlc\d]", "a schedule reference"),
    (r"\bform\s+\w", "a form number"),
    (r"\bgstr\b|\bitr\b|\bcmp-\d|\brfd-\d", "a return or form name"),
    (r"\bact,?\s*(?:19|20)\d\d|\brules,?\s*(?:19|20)\d\d", "an Act or Rules citation"),
    (r"\bnotification\b|\bcircular\b|\binstruction no\b", "a notification or circular"),
    (r"\bicai\b|\bcbdt\b|\bcbic\b|\bgst council\b|\bassessing officer\b"
     r"|\bthe department\b|\bthe authorit", "an authority reference"),
    (r"\bind as\b|\bas[- ]\d|\bsa[- ]\d{3}", "an accounting or auditing standard"),
    (r"\bas per the\b.{0,24}\b(act|rules|law|standard)\b", "a statutory appeal"),
)
_BANNED_PROSE_COMPILED = tuple((re.compile(p, re.I), why) for p, why in _BANNED_PROSE)

#: What a drafter may and may not do. Kept as data rather than as prose because
#: it goes into the prompt AND onto the output, and two copies drift.
DRAFTING_CONSTRAINTS = (
    "No statutory citations. No section, rule, clause, schedule, form, Act, "
    "notification or circular may appear in the drafted prose, ever, and this "
    "constraint is never relaxed for any caller.",
    "No authority references. Not a department, not a board, not an institute, "
    "not a standard, not an officer.",
    "No numerals. Every figure arrives as a placeholder from the frozen table; a "
    "digit typed into the prose is a figure the model invented.",
    "No cause. The note says what was compared and what differs. It does not say "
    "why the difference arose — that is the preparer's finding, and a guessed "
    "cause reads exactly like a checked one.",
    "No conclusion about compliance, correctness or whether anything is payable. "
    "The note covers a difference; it does not clear it.",
    "The figure table is frozen. The drafter may write sentences around it and "
    "may not add a row, drop a row, round a value or restate one in words.",
)


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and every output here goes through `json.dumps`."""
    return default if value is None else float(value)


def _customer_sql(alias_client: str, alias_contact: str) -> str:
    """The customer's NAME, never an id, preferring the company.

    Same rule and same fallback sentence as `bank_matching._customer_sql`: a CRM
    client is the COMPANY, contacts are people who come and go, and a blank cell
    in a "who" column reads as a rendering fault rather than as missing data.
    """
    return (
        f"COALESCE(NULLIF(btrim({alias_client}.name), ''), "
        f"         NULLIF(btrim({alias_contact}.company), ''), "
        f"         NULLIF(btrim({alias_contact}.name), ''), "
        f"         '(customer not recorded on the invoice)')"
    )


def _payable_states_verified() -> dict:
    """Is this module's copy of "publicly payable" still the page's copy?

    `routers.pay` is imported by the running application long before any skill
    runs, so this reads `sys.modules` and imports NOTHING — importing a router
    from inside a skill would execute slowapi's decorators for the sake of a
    tuple comparison. When the module is absent (a test process, a worker that
    never mounted the API) the answer is "not verified", which is reported as
    itself and never as agreement.
    """
    import sys

    mod = sys.modules.get("routers.pay")
    if mod is None:
        return {
            "verified": False,
            "note": "routers.pay was not loaded in this process, so the payable "
                    "statuses used here were not checked against the public "
                    "payment page's own list.",
        }
    same = (
        tuple(getattr(mod, "_PUBLIC_DOC_STATUS", ())) == PAYABLE_DOC_STATUS
        and tuple(getattr(mod, "_PUBLIC_PAYMENT_STATUS", ())) == PAYABLE_PAYMENT_STATUS
    )
    return {
        "verified": True,
        "agrees_with_pay_page": same,
        "note": "" if same else
                "This audit and the public payment page disagree about which "
                "invoices are payable. The counts here are this module's view and "
                "the page is the authority — treat them as indicative until the "
                "two lists are reconciled.",
    }


def _upi_fields() -> dict:
    """What `services.upi.pay_uri` actually emits, read from the function.

    #17 asks for the reference in `tn` AND `tr`. Rather than assert which of
    those the builder emits — an assertion that rots the moment somebody fixes
    it — this calls the single function every link and QR goes through, with a
    probe invoice number, and parses the query string back.

    Imported inside the call: `services.upi` is light, but a skill module is
    imported by the registry at start-up and nothing here needs paying for then.
    """
    from urllib.parse import parse_qs, urlparse

    from services import upi

    probe_number = "INV-PROBE-0001"
    uri = upi.pay_uri("probe@ybl", "Probe Payee", 1234.00, f"{probe_number} Probe Firm")
    q = parse_qs(urlparse(uri).query)
    return {
        "fields_emitted": sorted(q.keys()),
        "reference_in_tn": _names_the_invoice(_norm((q.get("tn") or [""])[0]),
                                              probe_number),
        "tr_emitted": "tr" in q,
        "reference_in_tr": "tr" in q and _names_the_invoice(
            _norm((q.get("tr") or [""])[0]), probe_number),
        "note_field_limit": UPI_NOTE_LIMIT,
        "why_tr_matters": "`tn` is a free-text note. `tr` is a transaction "
                          "reference, which is the field more likely to be "
                          "carried through settlement — but neither is "
                          "guaranteed to reach the narration.",
    }


def _threading_verdict(invoice_number: str | None, org_name: str) -> tuple[bool, str]:
    """Would the reference on THIS invoice's QR still identify the invoice?

    Two ways it fails that a count of pay tokens would miss:

      · the number normalises to fewer than `MIN_REF_TOKEN` characters, so the
        matcher will not search a narration for it at all — that floor exists
        because a two-digit invoice number matches half the lines in a statement
        file, and a false NAMED match is worse than no match;
      · the organisation's name is long enough that the invoice number falls off
        the end of the 60-character note. `routers/pay.py` puts the name FIRST.

    Returns (threaded, why-not).
    """
    number = (invoice_number or "").strip()
    if len(_norm(number)) < MIN_REF_TOKEN:
        return False, (
            f"the invoice number reduces to fewer than {MIN_REF_TOKEN} "
            f"alphanumeric characters, which the matcher will not search a "
            f"narration for"
        )
    note = f"{org_name} {number}"[:UPI_NOTE_LIMIT]
    if not _names_the_invoice(_norm(note), number):
        return False, (
            f"the payment note is built as '<organisation> <invoice number>' and "
            f"truncated at {UPI_NOTE_LIMIT} characters, and this organisation's "
            f"name is long enough to push the invoice number off the end"
        )
    return True, ""


#: THE MONTH IS `services.skills.timeutil.month_window` AND IS IMPORTED, NOT
#: RESTATED. HALF-OPEN — pair the second bound with `<`, never `<=`. Ten modules
#: declared their own until 2026-09-04 under one name and two contracts; the
#: name now carries which one this is.
_month_bounds = month_window


def _rule_tokens(*texts) -> set:
    """Narration text -> the LETTER tokens a deterministic rule could key on.

    Split on anything that is not alphanumeric, then keep only all-letter tokens
    of at least `MIN_RULE_TOKEN_LETTERS`. Dropping tokens that carry digits IS
    the filter: `UTR000000212074` and `INV-2603-018` name one transaction and a
    bare `2603` names one month's batch, and a rule with a support of one is a
    lookup, not a rule.
    """
    out = set()
    for text in texts:
        for tok in re.split(r"[^A-Za-z0-9]+", (text or "").upper()):
            if tok.isalpha() and len(tok) >= MIN_RULE_TOKEN_LETTERS:
                out.add(tok)
    return out


def screen_drafted_note(text: str, known_refs: list | None = None) -> list:
    """The deterministic gate a drafted covering note must pass. Pure function.

    #43's safety rests on a constraint, and a constraint nobody checks is a
    preference. This is the check: it takes drafted prose and returns the
    violations, so "no citations, no authorities, no numerals" is enforceable by
    a caller and testable here.

    It refuses in one direction only. It cannot tell a good note from a bad one
    — a note that says nothing passes cleanly — so it is a floor and never a
    sign-off.
    """
    violations = []
    body = text or ""
    for pattern, why in _BANNED_PROSE_COMPILED:
        match = pattern.search(body)
        if match:
            violations.append({
                "kind": "citation",
                "found": match.group(0),
                "why": f"the drafted note contains {why}, which this skill never "
                       f"permits in prose",
            })
    stripped = _PLACEHOLDER.sub(" ", body)
    match = _NUMERAL.search(stripped)
    if match:
        violations.append({
            "kind": "numeral",
            "found": match.group(0),
            "why": "a figure was typed into the prose. Every figure must arrive "
                   "as a placeholder from the frozen table.",
        })
    if known_refs is not None:
        allowed = set(known_refs)
        for ref in _PLACEHOLDER.findall(body):
            if ref not in allowed:
                violations.append({
                    "kind": "unknown_placeholder",
                    "found": ref,
                    "why": "the note refers to a figure that is not in the table "
                           "this draft was given",
                })
    return violations


# ═══════════════════════════════════════════════════════════════════════════
# #17 · UPI Reference Threading — the READ half
# ═══════════════════════════════════════════════════════════════════════════

async def check_upi_reference_threading(
    pool,
    org_id: str,
    days_back: int = DEFAULT_DAYS_BACK,
    limit: int = 500,
) -> dict:
    """Does the invoice number reach the bank line — and where does it stop?

    Three sections, and they are three different questions a single "threading
    is on" boolean would blur into one:

      A  the builder      — which UPI fields the one link/QR function emits,
                            read from the function itself
      B  the outward path — of the invoices holding a LIVE payment link, how
                            many carry a reference that identifies them, and for
                            the rest, exactly which way it fails
      C  the return path  — of the credits on the imported statement, how many
                            arrived with a narration naming a real invoice

    A and C DO NOT COMPOSE. Whether a reference written into `tn` survives into
    a bank narration is decided by the PAYER's app and by their bank's statement
    format, and nothing in this product can compel either. Section C measures
    the file that was imported, whoever wrote its narrations.

    Never writes.
    """
    today = today_ist(utc_now())
    window_start = today - timedelta(days=max(1, int(days_back)))
    cap = max(1, int(limit))

    # ── A · the builder, measured ──────────────────────────────────────────
    builder = _upi_fields()

    # ── the organisation's receiving addresses ─────────────────────────────
    #
    # `org_upi_accounts` arrived in migration 129 and `routers/pay.py` probes
    # for it rather than assuming it. The same caution is right here: a skill
    # that 500s on an older schema takes a whole scheduled run down with it.
    probe = await pool.fetchrow(
        "SELECT to_regclass('org_upi_accounts') IS NOT NULL AS ok"
    )
    has_upi_table = bool(probe and probe["ok"])

    org = await pool.fetchrow(
        """
        SELECT o.name AS org_name,
               COALESCE(NULLIF(btrim(o.upi_vpa), ''), '') AS fallback_vpa
        FROM public.organisations o
        WHERE o.id = $1::uuid
        """,
        org_id,
    )
    org_name = (org["org_name"] if org else "") or ""
    fallback_vpa = (org["fallback_vpa"] if org else "") or ""

    upi_accounts = 0
    if has_upi_table:
        row = await pool.fetchrow(
            """
            SELECT count(*)::int AS n
            FROM public.org_upi_accounts a
            WHERE a.org_id = $1::uuid AND a.is_active
            """,
            org_id,
        )
        upi_accounts = int(row["n"]) if row else 0
    can_render_upi = upi_accounts > 0 or bool(fallback_vpa)

    # ── B · invoices holding a LIVE public payment link ────────────────────
    #
    # Payable, not merely unpaid: a draft has no live link and a settled invoice
    # stops presenting one, so auditing every invoice would report a threading
    # rate over links that do not exist. The denominator is counted separately
    # from the capped detail list, so a capped run still reports the true one.
    total_row = await pool.fetchrow(
        """
        SELECT count(*)::int AS n
        FROM public.ganit_invoices i
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.cancelled_at IS NULL
          AND i.doc_status = ANY($2::text[])
          AND i.payment_status = ANY($3::text[])
        """,
        org_id, list(PAYABLE_DOC_STATUS), list(PAYABLE_PAYMENT_STATUS),
    )
    payable_total = int(total_row["n"]) if total_row else 0

    invoices = await pool.fetch(
        f"""
        SELECT i.id, i.invoice_number, i.invoice_date, i.currency,
               i.balance_due, i.doc_status, i.payment_status,
               COALESCE(btrim(i.pay_token), '') AS pay_token,
               {_customer_sql('cl', 'ct')} AS customer,
               NULLIF(btrim(ct.email), '') AS customer_email,
               NULLIF(btrim(ct.phone), '') AS customer_phone
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_clients cl
               ON cl.id = i.client_id AND cl.org_id = i.org_id
        LEFT JOIN public.graha_contacts ct
               ON ct.id = i.contact_id AND ct.org_id = i.org_id
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.cancelled_at IS NULL
          AND i.doc_status = ANY($2::text[])
          AND i.payment_status = ANY($3::text[])
        ORDER BY i.invoice_date DESC
        LIMIT $4::int
        """,
        org_id, list(PAYABLE_DOC_STATUS), list(PAYABLE_PAYMENT_STATUS), cap,
    )

    threaded = 0
    not_threaded = []
    for r in invoices:
        entry = reachable({
            "invoice_id": str(r["id"]),
            "invoice_number": r["invoice_number"],
            "customer": r["customer"],
            "invoice_date": as_date(r["invoice_date"]),
            "balance_due": _f(r["balance_due"]),
        }, kind="invoice", entity_id=r["id"],
            email=r["customer_email"], phone=r["customer_phone"])
        if not r["pay_token"]:
            not_threaded.append({
                **entry,
                "why": "this invoice carries no payment token, so it has no link "
                       "and no QR at all",
            })
            continue
        if not can_render_upi:
            not_threaded.append({
                **entry,
                "why": "this organisation has recorded no UPI receiving address, "
                       "so no QR and no UPI link is rendered for this invoice and "
                       "there is no reference field to thread anything into",
            })
            continue
        if (r["currency"] or "INR") != "INR":
            not_threaded.append({
                **entry,
                "why": f"the invoice is in {r['currency']}; UPI settles in rupees "
                       f"only, so no UPI code is offered for it",
            })
            continue
        ok, why = _threading_verdict(r["invoice_number"], org_name)
        if ok:
            threaded += 1
        else:
            not_threaded.append({**entry, "why": why})

    # ── C · the return path ────────────────────────────────────────────────
    #
    # Every active invoice number, not only the payable ones: a credit on the
    # statement may well settle an invoice already marked paid, and a narration
    # naming it still counts as a reference that arrived.
    numbers = await pool.fetch(
        """
        SELECT i.invoice_number
        FROM public.ganit_invoices i
        WHERE i.org_id = $1::uuid AND i.is_active
          AND COALESCE(btrim(i.invoice_number), '') <> ''
        """,
        org_id,
    )
    known_numbers = [r["invoice_number"] for r in numbers]

    credits = await pool.fetch(
        """
        SELECT l.id, l.statement_date, l.amount, l.description, l.reference,
               COALESCE(l.is_reconciled, FALSE) AS is_reconciled
        FROM public.ganit_bank_statement_lines l
        WHERE l.org_id = $1::uuid
          AND l.amount > 0
          AND l.statement_date >= $2::date
        ORDER BY l.statement_date DESC
        LIMIT $3::int
        """,
        org_id, window_start, cap,
    )

    named = 0
    unnamed_total = 0
    unnamed_open = []
    for line in credits:
        haystack = _norm(f"{line['reference'] or ''} {line['description'] or ''}")
        if any(_names_the_invoice(haystack, n) for n in known_numbers):
            named += 1
            continue
        unnamed_total += 1
        if not line["is_reconciled"]:
            unnamed_open.append({
                "line_id": str(line["id"]),
                "statement_date": line["statement_date"],
                "amount": _f(line["amount"]),
                "reference": line["reference"] or "",
                "description": line["description"] or "",
                "why": "nothing in this narration names an invoice, so this credit "
                       "can only ever be matched on its amount",
            })

    limitations = [
        "Whether a reference survives into the bank narration is decided by the "
        "PAYER's app and by their bank's statement format. A UPI app may show, "
        "truncate, replace or silently drop the note, and nothing in this "
        "product can compel any of them. Threading improves the odds; it "
        "guarantees nothing.",
        "The reference rides in the UPI note field only. Section A reports the "
        "fields the builder actually emits, read from the builder rather than "
        "from memory — if `tr` is absent there, no link and no QR in this "
        "product carries one.",
        "Section B is the outward path and section C is the return path, and "
        "they DO NOT compose into an end-to-end rate. Section C measures the "
        "statement file that was imported, whoever wrote its narrations.",
        "Section B counts invoices whose link is live now — issued, not "
        "cancelled, and still owing. An invoice already settled is excluded "
        "because its link no longer renders, not because it was never threaded.",
    ]
    if not can_render_upi:
        limitations.append(
            "This organisation has recorded no UPI receiving address, so nothing "
            "in section B is a lost reference — there is no UPI code at all. The "
            "control is Settings -> Organisation."
        )
    if not credits:
        limitations.append(
            "No bank credits were found in the window, so the return path was NOT "
            "MEASURED for this organisation. That is different from measuring it "
            "and finding no references: an organisation that has never imported a "
            "statement and one whose narrations carry nothing both show zero "
            "here, and only the first is described by this line."
        )
    elif not can_render_upi:
        limitations.append(
            "The credits in section C carry references this product did not "
            "write, because this organisation renders no UPI code. The end-to-end "
            "claim — that a reference written into `tn` comes back on the "
            "narration — is unmeasurable on this data, and the two rates below "
            "must not be multiplied together."
        )

    return {
        "as_at": today,
        "window_from": window_start,
        "window_days": int(days_back),
        "builder": builder,
        "payable_states": {
            "doc_status": list(PAYABLE_DOC_STATUS),
            "payment_status": list(PAYABLE_PAYMENT_STATUS),
            **_payable_states_verified(),
        },
        "upi_addresses": {
            "accounts_table_present": has_upi_table,
            "active_accounts": upi_accounts,
            "falls_back_to_org_vpa": bool(fallback_vpa) and upi_accounts == 0,
            "can_render_a_upi_code": can_render_upi,
        },
        "counts": {
            "invoices_with_a_live_link": payable_total,
            "invoices_examined": len(invoices),
            "reference_threaded": threaded,
            "reference_not_threaded": len(not_threaded),
            "credits_examined": len(credits),
            "credits_naming_an_invoice": named,
            "credits_naming_nothing": unnamed_total,
            "credits_naming_nothing_and_still_open": len(unnamed_open),
            "capped_at": cap,
            "invoices_not_shown": max(0, payable_total - len(invoices)),
            "was_capped": len(invoices) >= cap or len(credits) >= cap,
        },
        "not_threaded": not_threaded[:cap],
        "credits_that_name_nothing": unnamed_open[:cap],
        "limitations": limitations,
    }


# ═══════════════════════════════════════════════════════════════════════════
# #39 · Payment Proof Capture — a claim, never a receipt
# ═══════════════════════════════════════════════════════════════════════════

async def check_payment_proof_claims(
    pool,
    org_id: str,
    days_back: int = DEFAULT_PROOF_DAYS_BACK,
    limit: int = 200,
) -> dict:
    """Inbound payment screenshots, filed as CLAIMS beside the bank line.

    A screenshot is a picture of a claim. This files it against the client and
    the likely invoice, puts the candidate statement rows next to it, and stops.
    Marking an invoice paid from an image is REFUSED, and the refusal is on the
    output: the reason this skill is safe is that it does the weaker thing, and
    a reader who does not know that will ask for the stronger one.

    Two blockers, both reported rather than worked around:

      · receiving an image needs a WhatsApp Business account, and this COUNTS
        the organisation's rows rather than asserting the absence;
      · there is nowhere to FILE a claim. No table holds one. Handlers never
        write in any case, so this returns the claim shape for a screen to
        render, and the store is the CTO's to add.

    Never writes.
    """
    today = today_ist(utc_now())
    window_start = today - timedelta(days=max(1, int(days_back)))
    cap = max(1, int(limit))

    refusals = [
        {
            "refused": "marking an invoice paid from a screenshot",
            "why": "'Paid' arrives from bank reconciliation and from nothing "
                   "else. There is no payment gateway in this product and there "
                   "will not be one, so an image is evidence of an intention, not "
                   "of a settlement. A forged, edited or stale screenshot is "
                   "indistinguishable from a genuine one to anything here.",
        },
        {
            "refused": "recording a payment row from a screenshot",
            "why": "A row in the payments ledger IS the record of receipt. "
                   "Writing one from an image moves the invoice's balance and "
                   "silences the collection chase on money nobody has seen land.",
        },
        {
            "refused": "telling the customer their payment is confirmed",
            "why": "Nothing here can confirm it. The public payment page already "
                   "says so: settlement is checked against the bank statement, "
                   "not automatically.",
        },
    ]

    # ── blocker 1 · the channel ────────────────────────────────────────────
    waba = await pool.fetchrow(
        """
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE b.status = 'active')::int AS active
        FROM public.varta_business_accounts b
        WHERE b.org_id = $1::uuid
        """,
        org_id,
    )
    waba_total = int(waba["total"]) if waba else 0
    waba_active = int(waba["active"]) if waba else 0

    # ── the denominator, then the numerator ────────────────────────────────
    #
    # Counting the inbound messages that DO exist is what turns "0 proofs" from
    # a clean-looking result into a measured absence. An organisation with 250
    # inbound messages and no attachments is a different fact from one with no
    # messages at all, and a bare zero hides which of the two you are looking at.
    inbound = await pool.fetchrow(
        """
        SELECT count(*)::int AS inbound_total,
               count(*) FILTER (
                   WHERE COALESCE(btrim(m.media_url), '') <> ''
                      OR m.type IN ('image', 'document')
               )::int AS with_media
        FROM public.varta_messages m
        WHERE m.org_id = $1::uuid
          AND m.direction = 'inbound'
          AND m.created_at >= $2::timestamptz
        """,
        org_id, window_start,
    )
    inbound_total = int(inbound["inbound_total"]) if inbound else 0
    inbound_media = int(inbound["with_media"]) if inbound else 0

    # ── the proofs themselves, if any ever arrive ──────────────────────────
    #
    # Every graha join carries org_id as well as the id. The FK on
    # `graha_clients` is on the id ALONE, so an id-only join can print another
    # practice's client name — proved live — and a "who sent this proof" column
    # is exactly where a wrong name would be believed.
    proofs = await pool.fetch(
        f"""
        SELECT m.id, m.created_at, m.content, m.type, m.media_url,
               COALESCE(NULLIF(btrim(vc.name), ''), NULLIF(btrim(vc.phone_number), ''),
                        '(sender not recorded)') AS sender,
               {_customer_sql('cl', 'gc')} AS customer,
               cl.id AS client_id
        FROM public.varta_messages m
        JOIN public.varta_conversations cv
             ON cv.id = m.conversation_id AND cv.org_id = m.org_id
        LEFT JOIN public.varta_contacts vc
             ON vc.id = cv.varta_contact_id AND vc.org_id = m.org_id
        LEFT JOIN public.graha_contacts gc
             ON gc.id = vc.graha_contact_id AND gc.org_id = m.org_id
        LEFT JOIN public.graha_clients cl
             ON cl.id = gc.client_id AND cl.org_id = m.org_id
        WHERE m.org_id = $1::uuid
          AND m.direction = 'inbound'
          AND m.created_at >= $2::timestamptz
          AND (COALESCE(btrim(m.media_url), '') <> '' OR m.type IN ('image', 'document'))
        ORDER BY m.created_at DESC
        LIMIT $3::int
        """,
        org_id, window_start, cap,
    )

    claims = []
    if proofs:
        open_invoices = await pool.fetch(
            f"""
            SELECT i.id, i.invoice_number, i.invoice_date, i.balance_due,
                   i.payment_status, i.client_id,
                   {_customer_sql('cl', 'ct')} AS customer
            FROM public.ganit_invoices i
            LEFT JOIN public.graha_clients cl
                   ON cl.id = i.client_id AND cl.org_id = i.org_id
            LEFT JOIN public.graha_contacts ct
                   ON ct.id = i.contact_id AND ct.org_id = i.org_id
            WHERE i.org_id = $1::uuid
              AND i.is_active
              AND i.payment_status IN ('unpaid', 'partial')
              AND COALESCE(i.balance_due, 0) > 0
            """,
            org_id,
        )
        open_lines = await pool.fetch(
            """
            SELECT l.id, l.statement_date, l.amount, l.description, l.reference
            FROM public.ganit_bank_statement_lines l
            WHERE l.org_id = $1::uuid
              AND l.amount > 0
              AND NOT COALESCE(l.is_reconciled, FALSE)
              AND l.statement_date >= $2::date
            """,
            org_id, window_start - timedelta(days=PROOF_WINDOW_DAYS),
        )

        for p in proofs:
            said = _norm(p["content"] or "")
            client_id = str(p["client_id"]) if p["client_id"] else None

            # The invoice a claim is ABOUT, in the order a person would look: one
            # the message names, else the sender's own open invoices. Never an
            # amount guess — no amount is read off the image, and inventing one
            # would be the entire failure this skill exists to avoid.
            by_name = [i for i in open_invoices
                       if _names_the_invoice(said, i["invoice_number"])]
            by_client = [i for i in open_invoices
                         if client_id and str(i["client_id"]) == client_id]
            if by_name:
                candidates, basis = by_name, "the message names this invoice"
            else:
                candidates, basis = by_client, "the sender's client has this open"

            sent_on = as_date(p["created_at"])
            nearby = [
                {
                    "line_id": str(l["id"]),
                    "statement_date": l["statement_date"],
                    "amount": _f(l["amount"]),
                    "reference": l["reference"] or "",
                    "description": l["description"] or "",
                }
                for l in open_lines
                if sent_on is not None
                and abs(days_between(l["statement_date"], sent_on)) <= PROOF_WINDOW_DAYS
            ]

            claims.append({
                "claim_id": str(p["id"]),
                "status": "claimed",
                "confirmed": False,
                "received_at": p["created_at"],
                "sender": p["sender"],
                "customer": p["customer"],
                "message_text": (p["content"] or "")[:400],
                "attachment_kind": p["type"],
                "likely_invoices": [
                    {
                        "invoice_id": str(i["id"]),
                        "invoice_number": i["invoice_number"],
                        "customer": i["customer"],
                        "balance_due": _f(i["balance_due"]),
                        "payment_status": i["payment_status"],
                    }
                    for i in candidates[:5]
                ],
                "likely_invoices_basis": basis if candidates else
                                         "nothing links this proof to an open invoice",
                "likely_invoices_not_shown": max(0, len(candidates) - 5),
                "statement_rows_to_confirm_against": nearby[:5],
                "statement_rows_not_shown": max(0, len(nearby) - 5),
                "what_a_person_does": "confirm this claim against one of the "
                                      "statement rows, on the reconciliation "
                                      "screen. Until then it settles nothing.",
            })

    limitations = [
        "Every row here is a CLAIM. Nothing on this output records a payment, "
        "changes an invoice's balance or stops a collection chase. 'Paid' arrives "
        "from bank reconciliation and from nothing else.",
        "A screenshot cannot be verified by anything in this product. It is not "
        "read, no amount is extracted from it, and a forged, edited or reused "
        "image is indistinguishable from a genuine one here.",
        "There is nowhere to FILE a claim. No table records one — "
        "`public.ganit_payments` has `attribution` and `received_on` columns and "
        "nothing has ever written either — and the payments ledger is the wrong "
        "home in any case, because a row there IS a receipt. A claims store is "
        "owed before this can be more than a screen.",
        "The invoice a claim is attached to is a SUGGESTION on two weak grounds: "
        "an invoice number appearing in the message text, or the sender's client "
        "having something open. Neither reads the image.",
    ]
    if waba_active == 0:
        limitations.append(
            f"Receiving an image needs a WhatsApp Business account. This "
            f"organisation has {waba_total} configured and {waba_active} active, "
            f"so a proof can only arrive through a channel that is not connected."
        )
    else:
        limitations.append(
            f"{waba_active} WhatsApp Business account(s) are configured, so proofs "
            f"can arrive; nothing here checks that the webhook is delivering."
        )
    if inbound_media == 0:
        limitations.append(
            f"No inbound message in the window carried an attachment — 0 of "
            f"{inbound_total} inbound messages examined. That is a measured "
            f"absence over a stated denominator and not a clean result."
        )

    return {
        "as_at": today,
        "window_from": window_start,
        "window_days": int(days_back),
        "blocked": waba_active == 0,
        "blocker": (
            "No WhatsApp Business account is connected for this organisation, so "
            "no inbound image can reach this product. The skill is written, reads "
            "correctly, and has no channel to read from."
        ) if waba_active == 0 else "",
        "refusals": refusals,
        "counts": {
            "whatsapp_business_accounts": waba_total,
            "whatsapp_business_accounts_active": waba_active,
            "inbound_messages_examined": inbound_total,
            "inbound_messages_with_an_attachment": inbound_media,
            "claims": len(claims),
            "claims_confirmed": 0,
            "capped_at": cap,
            "was_capped": len(proofs) >= cap,
        },
        "claims": claims[:cap],
        "limitations": limitations,
    }


# ═══════════════════════════════════════════════════════════════════════════
# #42 · Bank Narration Rules — blocked, and the blocker is a missing column
# ═══════════════════════════════════════════════════════════════════════════

async def check_narration_rule_candidates(
    pool,
    org_id: str,
    min_support: int = MIN_RULE_SUPPORT,
    days_back: int = 730,
    limit: int = 200,
) -> dict:
    """Deterministic string-rule candidates, and why none can be validated.

    The folio wanted rules learned from narrations already categorised the same
    way three or more times, with only the residual tail going to one batched
    model call. There is nothing to learn from, and this handler MEASURES which
    kind of nothing rather than asserting either — the day somebody starts
    categorising, the output changes without anybody editing it.

    Two states it distinguishes, because they need different repairs:

      no column   nothing in the schema can record a category at all
      no rows     the columns exist and not one line has ever been categorised

    On 2026-08-20 this table moved from the first state to the second: it gained
    `category`, `categorised_by` and `categorised_at`, all empty.

    While no line carries a category the only class available is `matched_type`,
    which records what a line was matched TO — a payment — and not what it IS.
    Candidates are derived from it anyway, because a candidate with a stated
    support is worth more than an empty result, alongside the figure that
    decides whether any of them mean anything: how many distinct classes the
    data holds. Below two, every rule is unanimous by arithmetic, and unanimity
    is not evidence.

    NO MODEL TIER IS OFFERED. Without categorised rows the residual tail has no
    ground truth to be residual TO, and the skill degrades into a language model
    reading a bank statement every month — a standing cost for an answer nothing
    checks.

    Never writes.
    """
    today = today_ist(utc_now())
    window_start = today - timedelta(days=max(1, int(days_back)))
    support_floor = max(1, int(min_support))
    cap = max(1, int(limit))

    # The absence itself, MEASURED rather than asserted, in two steps: does a
    # column exist, and has anything ever been written to it. The identifiers
    # below are chosen from a fixed tuple in this file and never from a value —
    # the house rule for a dynamic identifier is a server-side allowlist.
    cols = await pool.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ANY(current_schemas(false))
          AND table_name = 'ganit_bank_statement_lines'
        """
    )
    present = {r["column_name"] for r in cols}
    category_column = next(
        (c for c in ("category", "category_id", "narration_category") if c in present),
        None,
    )
    provenance_columns = sorted(
        c for c in ("category_source", "categorised_by", "categorised_at")
        if c in present
    )
    category_select = ("l.category" if category_column == "category"
                       else f"l.{category_column}" if category_column
                       else "NULL::text")

    lines = await pool.fetch(
        f"""
        SELECT l.id, l.statement_date, l.amount, l.description, l.reference,
               l.matched_type, {category_select} AS category,
               COALESCE(l.is_reconciled, FALSE) AS is_reconciled
        FROM public.ganit_bank_statement_lines l
        WHERE l.org_id = $1::uuid
          AND l.statement_date >= $2::date
        ORDER BY l.statement_date DESC
        """,
        org_id, window_start,
    )

    # A real category beats the stand-in wherever one exists. `class_source` is
    # on the output, because a rule derived from `matched_type` and one derived
    # from a human's category are not the same kind of claim and must not be
    # read as one.
    categorised = [r for r in lines if (r["category"] or "").strip()]
    if categorised:
        class_source = category_column
        classed = categorised

        def _class_of(row):
            return (row["category"] or "").strip()
    else:
        class_source = "matched_type"
        classed = [r for r in lines if (r["matched_type"] or "").strip()]

        def _class_of(row):
            return (row["matched_type"] or "").strip()

    labelled = classed
    labelled_ids = {str(r["id"]) for r in labelled}
    unlabelled = [r for r in lines if str(r["id"]) not in labelled_ids]
    classes = sorted({_class_of(r) for r in labelled})

    # token -> {class: count} over LABELLED lines, plus a collision count over
    # the unlabelled ones. The collision count is the honest half: a rule that
    # fires on 128 classified lines and also on 60 lines nobody has ever
    # classified is a rule that will be wrong 60 times before anyone notices.
    by_token = {}
    collisions = {}
    for r in labelled:
        cls = _class_of(r)
        for tok in _rule_tokens(r["reference"], r["description"]):
            by_token.setdefault(tok, {})
            by_token[tok][cls] = by_token[tok].get(cls, 0) + 1
    for r in unlabelled:
        for tok in _rule_tokens(r["reference"], r["description"]):
            if tok in by_token:
                collisions[tok] = collisions.get(tok, 0) + 1

    candidates = []
    for tok, dist in by_token.items():
        support = sum(dist.values())
        if support < support_floor:
            continue
        winner = max(dist, key=lambda c: dist[c])
        purity = dist[winner] / support
        candidates.append({
            "token": tok,
            "rule": f"a narration containing '{tok}' has always been matched as "
                    f"'{winner}'",
            "assigns": winner,
            "support": support,
            "purity": round(purity, 4),
            "also_fires_on_unclassified_lines": collisions.get(tok, 0),
            "unanimous": purity >= 1.0,
        })
    candidates.sort(key=lambda c: (-c["support"], c["token"]))

    covered = set()
    for r in labelled:
        toks = _rule_tokens(r["reference"], r["description"])
        if any(c["token"] in toks for c in candidates):
            covered.add(str(r["id"]))
    residual = [r for r in labelled if str(r["id"]) not in covered]

    single_class = len(classes) < 2

    if category_column is None:
        blocked = True
        blocker = (
            "NO COLUMN records that a narration was ASSIGNED a category. "
            "`public.ganit_bank_statement_lines` carries `matched_type`, "
            "`matched_payment_id`, `is_reconciled` and `batch_id` — a match to a "
            "payment, not a classification. The fix is a categorisation write "
            "path: a `category` column alongside a `category_source` ('human' or "
            "'rule') and a `categorised_at`. `category_source` matters as much as "
            "`category`: without provenance a learner trains on its own guesses, "
            "and next month's rules are evidence of nothing but last month's."
        )
    elif not categorised:
        blocked = True
        blocker = (
            f"The column exists and NOTHING HAS EVER BEEN WRITTEN TO IT: 0 of "
            f"{len(lines)} statement lines in this window carry a "
            f"`{category_column}`. So this is a write path nobody has used rather "
            f"than a schema that cannot hold the answer, and the repair is a "
            f"screen that lets a person categorise a line — not another column. "
            f"Until then everything below is derived from `matched_type`, which "
            f"is not a category."
            + ("" if "category_source" in present else
               " Provenance is also still open: "
               + (f"`{'`, `'.join(provenance_columns)}` record WHO and WHEN, which "
                  f"is not the same as WHAT KIND. " if provenance_columns else "")
               + "A learner must be able to tell a human's assignment from a "
                 "rule's own output — a `category_source` ('human' | 'rule'), or "
                 "a reserved actor value meaning 'a rule did this', is what "
                 "closes that.")
        )
    else:
        blocked = False
        blocker = ""

    limitations = [
        "No model tier is offered, deliberately. Without categorised rows there "
        "is no ground truth for a residual tail to be residual to, and the skill "
        "would become a language model reading a bank statement every month — a "
        "standing cost for an answer nothing checks.",
        "Every candidate is UNVALIDATED. Nothing has been tested against a "
        "held-out set, because there is no set — a candidate's purity is measured "
        "against the same lines it was derived from.",
        f"Tokens carrying digits are excluded. `UTR000000212074` and "
        f"`INV-2603-018` identify one transaction, and a bare `2603` identifies "
        f"one month's batch; a rule keyed on any of them is a lookup with a "
        f"support of one. A candidate is letters only, at least "
        f"{MIN_RULE_TOKEN_LETTERS} of them, appearing at least {support_floor} "
        f"times.",
        "`also_fires_on_unclassified_lines` is the figure to read before "
        "adopting any candidate. It counts the lines the rule would touch that "
        "nobody has ever classified — the ones it would be wrong about silently.",
    ]
    if class_source == "matched_type":
        limitations.insert(1, (
            "The class used here is `matched_type`, a stand-in and a poor one. It "
            "records what a line was matched TO, not what it IS: a bank charge, a "
            "transfer between the firm's own accounts and a supplier payment are "
            "all simply unmatched."
        ))
    if single_class:
        limitations.insert(0, (
            f"THE CANDIDATES BELOW CANNOT BE VALIDATED. This data holds "
            f"{len(classes)} distinct class(es), so every rule is 100% pure by "
            f"arithmetic — there is nothing for it to be impure of. Purity here "
            f"is not evidence and must not be read as accuracy."
        ))
    if not lines:
        limitations.append(
            "No statement lines were found in the window, so nothing was derived "
            "and nothing was checked. That is 'not measured', not 'no rules "
            "found': an organisation that has never imported a bank statement "
            "looks identical here to one whose narrations repeat nothing."
        )

    return {
        "as_at": today,
        "window_from": window_start,
        "window_days": int(days_back),
        "blocked": blocked,
        "blocker": blocker,
        "category_column_present": category_column,
        "provenance_columns_present": provenance_columns,
        "class_source": class_source,
        "classes_seen": classes,
        "counts": {
            "lines_examined": len(lines),
            "lines_carrying_a_category": len(categorised),
            "lines_with_a_class": len(labelled),
            "lines_with_no_class": len(unlabelled),
            "distinct_classes": len(classes),
            "candidate_rules": len(candidates),
            "lines_covered_by_a_candidate": len(covered),
            "residual_lines": len(residual),
            "min_support": support_floor,
            "capped_at": cap,
            "candidates_not_shown": max(0, len(candidates) - cap),
        },
        "candidates_unvalidated": candidates[:cap],
        "residual_examples": [
            {
                "line_id": str(r["id"]),
                "statement_date": r["statement_date"],
                "amount": _f(r["amount"]),
                "reference": r["reference"] or "",
                "description": r["description"] or "",
                "matched_type": r["matched_type"],
                "category": r["category"],
            }
            for r in residual[:20]
        ],
        "residual_examples_not_shown": max(0, len(residual) - 20),
        "model_tier": {
            "offered": False,
            "why_not": "The residual tail has nothing to be residual to until "
                       "lines are actually categorised. Sending it to a model "
                       "every month buys a guess nobody can check, for ever.",
            "what_would_unblock_it": "categorised rows with a source that "
                                     "distinguishes a person's assignment from a "
                                     "rule's own output, and at least two "
                                     "distinct classes to tell apart.",
        },
        "limitations": limitations,
    }


# ═══════════════════════════════════════════════════════════════════════════
# #43 · Working Paper Draft — the frozen figures and the constraints
# ═══════════════════════════════════════════════════════════════════════════

async def brief_working_paper_figures(
    pool,
    org_id: str,
    period: str | None = None,
    limit: int = 200,
) -> dict:
    """The figure table a covering note is written AROUND, and what it may say.

    *period* is 'YYYY-MM' and defaults to the previous month — the one a firm is
    working on — through `timeutil.return_period`.

    Three deterministic guards run, and each returns one of three verdicts that
    must never be allowed to look alike:

      difference     the two figures were compared and disagree
      agrees         the two figures were compared and agree
      not_measured   the comparison could not be made; NO figure is asserted

    Every figure is addressed by a short ref. The drafter writes sentences
    containing `{{F1}}` and never a numeral, so the note cannot restate a figure
    incorrectly — it can only omit one, which is visible.

    Sequencing: this covers the RECONCILIATION-side differences. It does not
    restate the GST guards' figures (`check_gstr1_readiness`,
    `brief_gstr3b_liability`, `brief_itc_reversal_risk`) — a covering note must
    never carry a figure its writer did not compute, so a GST working paper is
    drafted from those handlers' own output, after they have run, rather than
    approximated here.

    Never writes, and drafts no prose. It returns the table and the rules.
    """
    today = today_ist(utc_now())
    period = period or return_period()
    # RAISES, WHERE THIS FILE'S OWN COPY RETURNED None. That copy was the only
    # one of ten with that contract, and a shared helper that sometimes returns
    # None and sometimes raises is a third contract nobody can hold in their
    # head. The refusal below is unchanged; only where it is decided moved.
    try:
        start, end = _month_bounds(period)
    except (ValueError, TypeError):
        return {
            "error": f"'{period}' is not a period. Expected YYYY-MM, e.g. 2026-07.",
            "period": period,
            "counts": {"guards_run": 0, "differences_found": 0,
                       "guards_not_measured": 0, "figures": 0},
            "limitations": [
                "No period could be parsed, so NOTHING was measured. This is not "
                "a finding of no differences.",
            ],
        }
    cap = max(1, int(limit))

    figures = []

    def fig(label: str, value, kind: str, guard: str, basis: str) -> str:
        ref = f"F{len(figures) + 1}"
        figures.append({
            "ref": ref, "label": label, "value": value,
            "kind": kind, "guard": guard, "basis": basis,
        })
        return ref

    differences = []
    exhibits = {}

    # ── guard 1 · the invoice ledger adds up ───────────────────────────────
    #
    # total = amount paid + balance outstanding is an identity, not an opinion,
    # so a row that breaks it is a difference with no innocent reading available
    # in the data itself. It is the cheapest guard here and the one whose
    # covering note is most tempted to guess a cause — which is exactly what the
    # drafting constraints forbid.
    drift = await pool.fetch(
        f"""
        SELECT i.id, i.invoice_number, i.invoice_date, i.total, i.amount_paid,
               i.balance_due, i.payment_status, i.doc_status,
               ROUND(i.total - i.amount_paid - i.balance_due, 2) AS gap,
               {_customer_sql('cl', 'ct')} AS customer
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_clients cl
               ON cl.id = i.client_id AND cl.org_id = i.org_id
        LEFT JOIN public.graha_contacts ct
               ON ct.id = i.contact_id AND ct.org_id = i.org_id
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.invoice_date >= $2::date AND i.invoice_date < $3::date
          AND ROUND(i.total - i.amount_paid - i.balance_due, 2) <> 0
        ORDER BY ABS(ROUND(i.total - i.amount_paid - i.balance_due, 2)) DESC
        LIMIT $4::int
        """,
        org_id, start, end, cap,
    )
    drift_total = await pool.fetchrow(
        """
        SELECT count(*)::int AS n,
               COALESCE(SUM(ABS(ROUND(i.total - i.amount_paid - i.balance_due, 2))), 0)
                   AS gross
        FROM public.ganit_invoices i
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.invoice_date >= $2::date AND i.invoice_date < $3::date
          AND ROUND(i.total - i.amount_paid - i.balance_due, 2) <> 0
        """,
        org_id, start, end,
    )
    n_drift = int(drift_total["n"]) if drift_total else 0
    r1 = fig("invoices whose total, amount paid and balance do not add up",
             n_drift, "count", "ledger_identity",
             "public.ganit_invoices, invoices dated in the period")
    r2 = fig("gross value of those differences",
             _f(drift_total["gross"]) if drift_total else 0.0,
             "money", "ledger_identity", "sum of the absolute gaps")
    differences.append({
        "guard": "ledger_identity",
        "question": "does every invoice dated in the period satisfy "
                    "total = amount paid + balance outstanding?",
        "status": "difference" if n_drift else "agrees",
        "figure_refs": [r1, r2],
        "magnitude_ref": r2,
        "rows_shown": len(drift),
        "rows_not_shown": max(0, n_drift - len(drift)),
    })
    exhibits["ledger_identity"] = [
        {
            "invoice_id": str(r["id"]),
            "invoice_number": r["invoice_number"],
            "customer": r["customer"],
            "invoice_date": as_date(r["invoice_date"]),
            "total": _f(r["total"]),
            "amount_paid": _f(r["amount_paid"]),
            "balance_due": _f(r["balance_due"]),
            "gap": _f(r["gap"]),
            "payment_status": r["payment_status"],
        }
        for r in drift
    ]

    # ── guard 2 · does the statement even cover the period? ────────────────
    #
    # This runs BEFORE the receipts comparison and qualifies it. Without it,
    # guard 3 reports the whole of a period's receipts as a difference for any
    # firm that has not imported a statement — a confident figure that is
    # entirely an artefact of the data not being there.
    cover = await pool.fetchrow(
        """
        SELECT count(*)::int AS in_period,
               count(*) FILTER (WHERE NOT COALESCE(l.is_reconciled, FALSE))::int
                   AS open_in_period
        FROM public.ganit_bank_statement_lines l
        WHERE l.org_id = $1::uuid
          AND l.statement_date >= $2::date AND l.statement_date < $3::date
        """,
        org_id, start, end,
    )
    span = await pool.fetchrow(
        """
        SELECT MIN(l.statement_date) AS lo, MAX(l.statement_date) AS hi,
               count(*)::int AS n
        FROM public.ganit_bank_statement_lines l
        WHERE l.org_id = $1::uuid
        """,
        org_id,
    )
    lines_in_period = int(cover["in_period"]) if cover else 0
    open_in_period = int(cover["open_in_period"]) if cover else 0
    r3 = fig("statement lines imported for the period", lines_in_period, "count",
             "statement_coverage", "public.ganit_bank_statement_lines")
    r4 = fig("of those, still unreconciled", open_in_period, "count",
             "statement_coverage", "is_reconciled false or null")
    differences.append({
        "guard": "statement_coverage",
        "question": "is there an imported bank statement covering this period at all?",
        "status": "agrees" if lines_in_period else "not_measured",
        "figure_refs": [r3, r4],
        "magnitude_ref": r3,
        "not_measured_because": "" if lines_in_period else
            "no statement line falls inside this period, so every comparison "
            "against the bank below is unmeasured rather than clear",
        "statement_earliest": as_date(span["lo"]) if span else None,
        "statement_latest": as_date(span["hi"]) if span else None,
        "statement_lines_all_time": int(span["n"]) if span else 0,
        "rows_shown": 0,
        "rows_not_shown": 0,
    })

    # ── guard 3 · receipts in the books against credits on the statement ───
    #
    # Only the ELECTRONIC receipts are comparable. Cash and cheque receipts do
    # not land as a same-day bank credit, and including them would manufacture a
    # difference every month for any firm that takes cash. The split is on the
    # output so a reader can see which figure was actually compared.
    receipts = await pool.fetch(
        """
        SELECT COALESCE(NULLIF(btrim(p.payment_method), ''), '(not recorded)')
                   AS method,
               count(*)::int AS n, COALESCE(SUM(p.amount), 0) AS total
        FROM public.ganit_payments p
        WHERE p.org_id = $1::uuid
          AND p.payment_date >= $2::date AND p.payment_date < $3::date
        GROUP BY 1
        ORDER BY 3 DESC
        """,
        org_id, start, end,
    )
    electronic_methods = ("upi", "bank_transfer", "neft", "rtgs", "imps")
    books_total = sum(_f(r["total"]) for r in receipts)
    books_electronic = sum(_f(r["total"]) for r in receipts
                           if (r["method"] or "").lower() in electronic_methods)
    credit_row = await pool.fetchrow(
        """
        SELECT count(*)::int AS n, COALESCE(SUM(l.amount), 0) AS total
        FROM public.ganit_bank_statement_lines l
        WHERE l.org_id = $1::uuid
          AND l.amount > 0
          AND COALESCE(l.is_reconciled, FALSE)
          AND l.statement_date >= $2::date AND l.statement_date < $3::date
        """,
        org_id, start, end,
    )
    credits_total = _f(credit_row["total"]) if credit_row else 0.0

    r5 = fig("receipts recorded in the books for the period", round(books_total, 2),
             "money", "receipts_vs_bank", "public.ganit_payments by payment_date")
    r6 = fig("of those, received by UPI or bank transfer", round(books_electronic, 2),
             "money", "receipts_vs_bank", "payment_method in the electronic set")
    r7 = fig("credits on the statement reconciled to a receipt",
             round(credits_total, 2), "money", "receipts_vs_bank",
             "public.ganit_bank_statement_lines, credits, reconciled")
    r8 = fig("difference between the two compared figures",
             round(books_electronic - credits_total, 2), "money",
             "receipts_vs_bank",
             "the electronic books figure less the reconciled credits figure")
    differences.append({
        "guard": "receipts_vs_bank",
        "question": "do the electronic receipts recorded in the books for the "
                    "period agree with the credits reconciled on the statement?",
        "status": "not_measured" if lines_in_period == 0 else (
            "agrees" if abs(books_electronic - credits_total) < 1.0 else "difference"),
        "figure_refs": [r5, r6, r7, r8],
        "magnitude_ref": r8,
        "not_measured_because": (
            "no bank statement covering this period has been imported, so there "
            "is nothing to compare the books figure against. The difference "
            "figure is NOT a finding here."
        ) if lines_in_period == 0 else "",
        "rows_shown": len(receipts),
        "rows_not_shown": 0,
    })
    exhibits["receipts_vs_bank"] = [
        {"method": r["method"], "count": int(r["n"]), "total": _f(r["total"])}
        for r in receipts
    ]

    found = [d for d in differences if d["status"] == "difference"]
    unmeasured = [d for d in differences if d["status"] == "not_measured"]

    limitations = [
        "The figure table is the output. This handler drafts no prose and calls "
        "no model — the note is written AROUND these figures by a drafter that "
        "receives placeholders and never a number.",
        "The drafting constraints are not style. A covering note that cites a "
        "section or names an authority is a legal opinion with a source nobody "
        "read, in front of somebody who will be held to it. `screen_drafted_note` "
        "in this module is the deterministic gate; it is a floor and never a "
        "sign-off, because it cannot tell a good note from a note that says "
        "nothing.",
        "A difference is not an error. Each guard states what was compared and "
        "what differs. Why it differs is the preparer's finding, and a guessed "
        "cause reads exactly like a checked one.",
        "Only UPI and bank-transfer receipts are compared against the statement. "
        "Cash and cheque receipts do not land as a same-day bank credit, and "
        "including them would manufacture a difference every month for any firm "
        "that takes cash. The full split by method is in the exhibit.",
        "The bank side counts only credits already RECONCILED. Unreconciled "
        "credits sitting on the statement are counted by the coverage guard and "
        "are the ordinary explanation for a difference here — which is a matter "
        "for the preparer to state, not for this table to assume.",
        "GST-side differences are NOT in this table. `check_gstr1_readiness`, "
        "`brief_gstr3b_liability` and `brief_itc_reversal_risk` compute their own "
        "figures, and a covering note must never carry a figure its writer did "
        "not compute; a GST working paper is drafted from those handlers' output "
        "after they have run.",
    ]
    if unmeasured:
        limitations.append(
            "One or more guards returned NOT MEASURED. That is not agreement. A "
            "comparison that could not be made and one that came out level must "
            "never read alike, and the covering note must not treat an unmeasured "
            "guard as cleared."
        )

    return {
        "as_at": today,
        "period": period,
        "period_from": start,
        "period_to": end,
        "counts": {
            "guards_run": len(differences),
            "differences_found": len(found),
            "guards_not_measured": len(unmeasured),
            "figures": len(figures),
            "exhibit_rows_shown": sum(len(v) for v in exhibits.values()),
            "capped_at": cap,
        },
        "figures": figures,
        "figures_are_frozen": True,
        "differences": differences,
        "exhibits": exhibits,
        "drafting_constraints": list(DRAFTING_CONSTRAINTS),
        "drafting_brief": {
            "placeholder_form": "{{F1}}",
            "known_refs": [f["ref"] for f in figures],
            "may_say": [
                "which two figures were compared, and over what period",
                "that they differ, and by which placeholder",
                "which records the comparison was drawn from",
                "that a guard could not be measured, where that is the verdict",
            ],
            "must_not_say": [
                "why the difference arose",
                "whether anything is correct, compliant or payable",
                "any figure not supplied as a placeholder",
                "any section, rule, form, Act, notification, standard or authority",
            ],
            "screen": "services.skills.data.recon_rules.screen_drafted_note",
        },
        "sequenced_after": [
            "check_gstr1_readiness",
            "brief_gstr3b_liability",
            "brief_itc_reversal_risk",
        ],
        "limitations": limitations,
    }
