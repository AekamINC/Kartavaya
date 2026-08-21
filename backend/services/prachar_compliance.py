"""
prachar_compliance.py — the ICAI advertising gate for outbound marketing email.

WHOSE PROBLEM THIS IS
---------------------
Aekam Inc is not a member of the Institute of Chartered Accountants of India.
The Institute's jurisdiction runs to its members, and a member who presses Send
in this product is the person exposed — not the vendor who built the button. So
every refusal in this file is written for the partner, names the rule, and can
be overridden BY THAT PARTNER with a basis they put their name to. It is not a
vendor protecting itself; it is a product refusing to let a professional trip
over a clause they are almost certainly not thinking about while looking at a
campaign screen.

THE RULE, AND EXACTLY HOW MUCH OF IT IS SOURCED
-----------------------------------------------
Clause (6), Part I, First Schedule to the Chartered Accountants Act 1949: a
member in practice is guilty of professional misconduct if he "solicits clients
or professional work either directly or indirectly by circular, advertisement,
personal communication or interview or by any other means". The Code of Ethics
in force from 1 April 2026 names EMAIL among the prohibited means.

Two things follow, and the distinction between them is the whole point of this
module:

  · The prohibited act is SOLICITATION OF SOMEONE WHO IS NOT YET A CLIENT.
    Corresponding with an EXISTING CLIENT is not solicitation and is permitted.
    That is the client-vs-prospect axis, and it is the only axis this gate
    actually enforces.

  · The relaxation people reach for — "ICAI allows advertising from April 2026"
    — is PULL-SIDE. It widened what a member may put on a website, a social
    page, or a listing that a prospect chooses to visit. It did not touch the
    push-side prohibition, and email is push. Renaming this module from
    "marketing" to anything else changes nothing about that.

WHAT IS SOURCED AND WHAT IS REASONED
------------------------------------
Every class below carries `basis`, and it is not decoration. `SOURCED` means the
Code or the Schedule says this. `INFERRED` means we reasoned it from something
sourced and no clause names the case. A later reader — quite possibly one
answering to the Ethical Standards Board — must be able to tell the two apart
without re-deriving them, so the word is on the class, on the evidence row, and
in the refusal message.

WHAT THIS FILE DOES NOT DO
--------------------------
It takes no view on GSTIN, PAN, TAN, HSN or SAC. Those are non-mandatory in this
product and block nothing; a firm with no GSTIN on a contact is not an ethics
problem. It does not read `services/statute.py`, which is tax statute and has
nothing to say about the Institute's Code. And it never writes to the outbound
path: the linter advises, the gate refuses, and neither of them sends anything.
"""
from __future__ import annotations

import logging
import re
from datetime import date

logger = logging.getLogger(__name__)


# ── The dated facts, as named constants with their citations ────────────────
#
# NOTHING HERE IS HARDCODED INTO A DECISION. These constants exist so a message
# can quote a citation, and `migrations/183_prachar_icai_gate.sql` seeds the same
# keys into `staging.prachar_compliance_rules` WITH AN `effective_from`, which is
# where the dates live. A rule whose date matters is a row, not a literal.

#: Clause (6), Part I, First Schedule, Chartered Accountants Act 1949.
#: The Code of Ethics in force from this date names email among the prohibited
#: means of solicitation.
ICAI_CODE_IN_FORCE_FROM = date(2026, 4, 1)

#: DPDP Act 2023 consent-and-notice obligations for a Data Fiduciary. The Rules
#: phase these in; the operative date for the consent/notice duties this module
#: builds evidence for is 13 May 2027. Recorded as a rule row so the evidence
#: table has somewhere to hang a notice version when that work is done.
DPDP_CONSENT_OBLIGATION_FROM = date(2027, 5, 13)

CITATION_CLAUSE_6 = (
    "Clause (6), Part I, First Schedule, Chartered Accountants Act 1949 — "
    "Code of Ethics in force 1 April 2026"
)

#: Rule keys. These are the join keys into `staging.prachar_compliance_rules`
#: and they are written onto every evidence row, so they must not be renamed
#: once anything has been sent under them.
RULE_SOLICITATION = "icai.clause6.solicitation"
RULE_EXISTING_CLIENT = "icai.clause6.existing_client"
RULE_GREETINGS = "icai.clause6.greetings_and_invitations"
RULE_REMINDER_INFERRED = "icai.inferred.statutory_reminder"
RULE_KNOWLEDGE_INFERRED = "icai.inferred.knowledge_update"
RULE_DPDP_CONSENT = "dpdp.2023.consent_record"

SOURCED = "sourced"
INFERRED = "inferred"


# ── Template classes ────────────────────────────────────────────────────────
#
# A CLASS IS NOT A CATEGORY. `prachar_templates.category` is a filing label the
# firm chose for itself — the live table holds ten distinct values and nothing
# has ever read them for a decision. A class is what the send path enforces, and
# there are six of them because there are six different answers to "may this
# leave the building".
#
# `clients_only=True` on every permitted class is not an oversight. Email is
# push, and every permitted basis below is a basis for writing to someone the
# firm already acts for. If a class is ever added whose basis reaches a
# non-client, it needs its own sourced citation, not a copy of one of these.

class TemplateClass:
    """One enforceable class. Deliberately not a dataclass — this file is
    imported by the send path and must not grow a dependency it does not need."""

    __slots__ = ("key", "label", "clients_only", "permitted_by_email",
                 "basis", "rule_key", "why")

    def __init__(self, key, label, clients_only, permitted_by_email,
                 basis, rule_key, why):
        self.key = key
        self.label = label
        self.clients_only = clients_only
        self.permitted_by_email = permitted_by_email
        self.basis = basis
        self.rule_key = rule_key
        self.why = why

    def as_dict(self) -> dict:
        return {
            "key": self.key, "label": self.label,
            "clients_only": self.clients_only,
            "permitted_by_email": self.permitted_by_email,
            "basis": self.basis, "rule_key": self.rule_key, "why": self.why,
        }


TEMPLATE_CLASSES: dict[str, TemplateClass] = {
    # ── SOURCED ─────────────────────────────────────────────────────────────
    "client_service": TemplateClass(
        key="client_service",
        label="Client service correspondence",
        clients_only=True,
        permitted_by_email=True,
        basis=SOURCED,
        rule_key=RULE_EXISTING_CLIENT,
        why=(
            "Correspondence about an engagement that already exists solicits "
            "nothing. Clause (6) bars soliciting CLIENTS OR PROFESSIONAL WORK; "
            "writing to a client about work already accepted is neither."
        ),
    ),
    "greeting": TemplateClass(
        key="greeting",
        label="Greeting",
        clients_only=True,
        permitted_by_email=True,
        basis=SOURCED,
        rule_key=RULE_GREETINGS,
        why=(
            "The Council's guidance under Clause (6) expressly permits greeting "
            "cards to clients, relatives, friends and other members. It does "
            "not extend to people in none of those categories."
        ),
    ),
    "invitation": TemplateClass(
        key="invitation",
        label="Invitation",
        clients_only=True,
        permitted_by_email=True,
        basis=SOURCED,
        rule_key=RULE_GREETINGS,
        why=(
            "Invitations to the firm's own events are expressly permitted to "
            "the same closed group as greetings — clients, relatives, friends "
            "and other members. An invitation to a stranger is a circular."
        ),
    ),

    # ── INFERRED — reasoned from the two sourced rules above ────────────────
    #
    # READ THIS BEFORE RELYING ON EITHER OF THE NEXT TWO. No clause names them.
    # They are here because refusing them outright would stop a practice doing
    # the ordinary, useful thing it does for the clients it already has — but
    # the inference is ours, it is not the Institute's, and if the Ethical
    # Standards Board is ever asked, these are the two it will be asked about.
    "statutory_reminder": TemplateClass(
        key="statutory_reminder",
        label="Statutory deadline reminder",
        clients_only=True,
        permitted_by_email=True,
        basis=INFERRED,
        rule_key=RULE_REMINDER_INFERRED,
        why=(
            "INFERRED, not sourced. Reasoned from the existing-client rule: a "
            "GST or TDS due-date reminder to a client the firm already files "
            "for is correspondence about that engagement. No clause of the "
            "Code names deadline reminders either way."
        ),
    ),
    "knowledge_update": TemplateClass(
        key="knowledge_update",
        label="Newsletter or technical update",
        clients_only=True,
        permitted_by_email=True,
        basis=INFERRED,
        rule_key=RULE_KNOWLEDGE_INFERRED,
        why=(
            "INFERRED, and the weakest inference in this file. A technical "
            "update to an existing client is defensible as client service; the "
            "same words to a prospect are a circular, and a newsletter is the "
            "class that most easily drifts into promotion. The save-time "
            "linter is what keeps this one on the right side of the line."
        ),
    ),

    # ── SOURCED, AND THE ONE THAT IS PROHIBITED ─────────────────────────────
    "prospect_outreach": TemplateClass(
        key="prospect_outreach",
        label="Outreach to a non-client",
        clients_only=False,
        permitted_by_email=False,
        basis=SOURCED,
        rule_key=RULE_SOLICITATION,
        why=(
            "This is the act Clause (6) prohibits, and the Code in force from "
            "1 April 2026 names email among the means. The class exists so the "
            "refusal has a name and so an override records what was overridden."
        ),
    ),
}


#: `prachar_templates.category` -> class. Every value in this map was measured
#: on the live database (10 distinct categories across 60 active templates), so
#: this is not a guess about what firms might type.
#:
#: 'general' is DELIBERATELY ABSENT. Three live templates carry it and it says
#: nothing about what the mail is; mapping it to a permitted class would be
#: inventing a basis. An unmapped category is UNCLASSIFIED, and unclassified is
#: refused only where it could change the answer — see `assess_send`.
#:
#: 'promotional' and 'transactional' appear in the frontend's category list and
#: in NO ROW OF THE LIVE TABLE. They are mapped anyway, because a dropdown that
#: offers a value will eventually produce one.
CATEGORY_TO_CLASS: dict[str, str] = {
    "alert": "client_service",
    "collections": "client_service",
    "onboarding": "client_service",
    "operations": "client_service",
    "transactional": "client_service",
    "event": "invitation",
    "invite": "invitation",
    "greeting": "greeting",
    "reminder": "statutory_reminder",
    "newsletter": "knowledge_update",
    "promotional": "prospect_outreach",
}


def class_for(*, compliance_class: str | None = None,
              category: str | None = None) -> TemplateClass | None:
    """The class that governs one send, or None for unclassified.

    An explicit `compliance_class` always wins over the derived one: the column
    exists precisely so a firm can say "this reminder is really client service"
    and have the send path believe them. A value that is not a known class is
    treated as UNCLASSIFIED rather than accepted, because a class the enforcer
    does not recognise cannot be enforced.
    """
    if compliance_class:
        cls = TEMPLATE_CLASSES.get(str(compliance_class).strip().lower())
        if cls is not None:
            return cls
        logger.warning(
            "Prachar: compliance_class %r is not a known class; treating this "
            "template as unclassified.", compliance_class)
    if category:
        key = CATEGORY_TO_CLASS.get(str(category).strip().lower())
        if key:
            return TEMPLATE_CLASSES[key]
    return None


# ── The audience gate ───────────────────────────────────────────────────────

#: A basis shorter than this is not a decision, it is a keystroke. Chosen so
#: "approved", "ok", "client asked" and "-" all fail and a sentence passes. The
#: same floor is a CHECK constraint on `prachar_icai_overrides.basis`, so the
#: database refuses a thin basis even if some future caller forgets to.
MIN_OVERRIDE_BASIS_CHARS = 24


def split_by_client_linkage(contacts) -> tuple[list, list]:
    """(clients, non_clients) from resolved audience rows.

    `graha_contacts.client_id` is the linkage — migration 031 added it, indexed,
    and a CRM client is the COMPANY the firm acts for. A contact with no
    `client_id` is a person the firm holds a record of and does not act for:
    a prospect. That is the whole test, and it is deliberately the only one.
    A contact whose row does not carry the key at all counts as a NON-client,
    because an absent fact is not evidence of a relationship.
    """
    clients, prospects = [], []
    for c in contacts:
        if c.get("client_id"):
            clients.append(c)
        else:
            prospects.append(c)
    return clients, prospects


class SendVerdict:
    """What the gate decided, and everything a caller needs to say why."""

    __slots__ = ("allowed", "code", "message", "client_count",
                 "non_client_count", "template_class", "override_basis")

    def __init__(self, allowed, code, message, client_count, non_client_count,
                 template_class=None, override_basis=None):
        self.allowed = allowed
        self.code = code
        self.message = message
        self.client_count = client_count
        self.non_client_count = non_client_count
        self.template_class = template_class
        self.override_basis = override_basis

    @property
    def is_override(self) -> bool:
        return self.allowed and self.code == "allowed_by_override"

    def as_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "code": self.code,
            "message": self.message,
            "client_count": self.client_count,
            "non_client_count": self.non_client_count,
            "template_class": self.template_class.key if self.template_class else None,
            "class_basis": self.template_class.basis if self.template_class else "unclassified",
            "rule_key": self.template_class.rule_key if self.template_class else RULE_SOLICITATION,
            "citation": CITATION_CLAUSE_6,
        }


def assess_send(*, contacts, template_class: TemplateClass | None,
                override_basis: str | None = None) -> SendVerdict:
    """Decide whether this campaign may leave the building.

    THE ORDER OF THESE BRANCHES IS THE DESIGN.

    1. An audience of existing clients only is permitted whatever the class is.
       Every permitted class in this file is a basis for writing to a client, so
       classification cannot change the answer here — and refusing an unclassified
       template in the one case where the class is irrelevant would be ceremony,
       which is how a compliance control gets routed around.

    2. A non-client in the audience with NO class is refused AND NO OVERRIDE IS
       OFFERED. This is the sharpest edge in the module and it is deliberate:
       you may not override your way past a template nobody has characterised.
       Say what you think you are sending first, then own the decision.

    3. A non-client in the audience WITH a class is refused, and an override is
       offered. A warning here would be a click; a refusal that only a written
       basis clears is a decision with a name on it.

    Note what is NOT here. `prospect_outreach` is not treated as an automatic,
    unappealable refusal even though it is the prohibited act, because the
    override exists exactly for the case the member judges differently — a
    referral that asked to be contacted, a former client, a fellow member. The
    product's job is to make that judgement explicit and recorded, not to
    substitute its own for a professional's.
    """
    clients, prospects = split_by_client_linkage(contacts)
    n_client, n_prospect = len(clients), len(prospects)

    if n_prospect == 0:
        return SendVerdict(
            True, "allowed_clients_only",
            "Every recipient is linked to an existing client of this practice.",
            n_client, 0, template_class,
        )

    # One recipient reads very differently from forty, and a refusal that says
    # "1 people who are not clients" is a refusal nobody takes seriously.
    who = (f"{n_prospect} person who is not a client" if n_prospect == 1
           else f"{n_prospect} people who are not clients")

    if template_class is None:
        return SendVerdict(
            False, "blocked_unclassified",
            (
                f"This campaign reaches {who} of this practice, and the "
                f"template it uses has no compliance class. Under "
                f"{CITATION_CLAUSE_6}, soliciting a non-client by email is "
                f"professional misconduct — so this send cannot be overridden "
                f"until somebody says what it is. Set a compliance class on the "
                f"template, then send again."
            ),
            n_client, n_prospect, None,
        )

    basis = (override_basis or "").strip()
    if len(basis) < MIN_OVERRIDE_BASIS_CHARS:
        noun = "person" if n_prospect == 1 else "people"
        return SendVerdict(
            False, "blocked_non_client",
            (
                f"BLOCKED. {n_prospect} of {n_client + n_prospect} recipients "
                f"are not clients of this practice. This campaign is classed "
                f"'{template_class.label}', which under {CITATION_CLAUSE_6} may "
                f"go to existing clients only — emailing a {noun} the firm does "
                f"not act for is solicitation, and the exposure is the member's, "
                f"not the software's. Narrow the audience to clients, or send "
                f"again with a written basis of at least "
                f"{MIN_OVERRIDE_BASIS_CHARS} characters, which will be recorded "
                f"against your name."
            ),
            n_client, n_prospect, template_class,
        )

    return SendVerdict(
        True, "allowed_by_override",
        (
            f"Sent under a recorded override: {n_prospect} non-client "
            f"recipients, class '{template_class.label}'."
        ),
        n_client, n_prospect, template_class, basis,
    )


# ── The save-time linter ────────────────────────────────────────────────────
#
# ADVISORY, ALWAYS. This never blocks a save and never blocks a send. The people
# writing these templates are professionals reading their own Code; the product's
# contribution is to notice the phrase and quote it back, not to grade the prose.
# A blocking linter on subjective copy would be wrong on the merits and would be
# switched off within a week, which is worse than advising.
#
# Each rule quotes THE ACTUAL PHRASE it matched. "Contains promotional language"
# is not actionable; «our award-winning team» is.

_TAG = re.compile(r"<[^>]*>")
_WS = re.compile(r"\s+")

#: (rule id, human label, severity, why, compiled pattern)
_LINT_RULES: tuple[tuple[str, str, str, str, re.Pattern], ...] = (
    (
        "superlative", "Superlative", "high",
        "Clause (6) guidance treats self-laudatory description as advertisement. "
        "A superlative about the firm is the clearest example.",
        re.compile(
            r"\b(best|finest|leading|foremost|premier|top[- ]rated|number one|"
            r"no\.?\s?1|#1|largest|biggest|fastest[- ]growing|most trusted|"
            r"unmatched|unparalleled|world[- ]class|renowned|award[- ]winning|"
            r"reputed|pre[- ]?eminent)\b", re.I),
    ),
    (
        "self_promotion", "Self-description of the firm", "medium",
        "Describing the firm's size, standing or experience in a push message "
        "reads as a circular rather than as correspondence.",
        re.compile(
            r"(\bwe are (?:a|the|one of)\b|\bour firm is\b|"
            r"\b(?:with )?(?:over |more than )?\d+\+?\s*years? of experience\b|"
            r"\btrusted by \d+|\bserving (?:over |more than )?\d+|"
            r"\bour team of experts?\b|\bwe special(?:i[sz]e)\b|\bour expertise\b|"
            r"\bempanelled with\b)", re.I),
    ),
    (
        "comparison", "Comparison with other practitioners", "high",
        "Comparing the practice with other members is specifically deprecated; "
        "it disparages a fellow member as well as advertising.",
        re.compile(
            r"(\bbetter than\b|\bcheaper than\b|\bfaster than\b|"
            r"\bunlike (?:other|most|your current)\b|\bcompared to other\b|"
            r"\bswitch from your (?:current|existing)\b|\bother (?:CAs|firms|"
            r"consultants) (?:charge|take|miss)\b)", re.I),
    ),
    (
        "guarantee", "Guarantee or assurance of outcome", "high",
        "A professional cannot guarantee an outcome that rests with a "
        "department or a tribunal, and promising one is both advertising and "
        "a statement the firm cannot stand behind.",
        re.compile(
            r"(\bguarantee[ds]?\b|\bguaranteed\b|\bassured\b|\brisk[- ]free\b|"
            r"\b100%\s*(?:accurate|accuracy|compliance|refund|success)\b|"
            r"\bwe ensure\b|\bzero (?:penalty|notice|error)\b|"
            r"\bno questions asked\b|\bwill definitely\b)", re.I),
    ),
    (
        "testimonial", "Testimonial or client endorsement", "high",
        "Publishing what clients say about the firm is a classic advertisement "
        "and also engages client confidentiality.",
        re.compile(
            r"(\btestimonial\b|\bwhat our clients say\b|\bclient speak\b|"
            r"\bhear from our clients\b|\bsuccess stor(?:y|ies)\b|"
            r"\brated \d(?:\.\d)?\s*(?:out of|/)\s*\d|\b\d\s*star\b|"
            r"\breviews? from\b)", re.I),
    ),
    (
        "pricing", "Fees, discount or offer", "high",
        "Quoting fees, discounts or a limited-period offer in a push message is "
        "the form of advertising the Code is most explicit about.",
        re.compile(
            r"(₹\s?\d|\bRs\.?\s?\d|\bINR\s?\d|\bstarting (?:at|from)\b|"
            r"\bper return\b|\bflat fee\b|\bdiscount\b|\b\d+%\s*off\b|"
            r"\bfree consultation\b|\bspecial offer\b|\blimited period\b|"
            r"\bno (?:extra )?charge\b|\bfirst (?:month|filing) free\b)", re.I),
    ),
    (
        "solicitation_cta", "Call to action that solicits work", "high",
        "This is the push-side act Clause (6) names. The 2026 relaxation is "
        "pull-side — a prospect may visit the firm's site; the firm may not "
        "email asking them to.",
        re.compile(
            r"(\bvisit our (?:website|site|page)\b|\bbook a (?:call|slot|"
            r"consultation|demo)\b|\bschedule a (?:call|consultation|meeting)\b|"
            r"\brequest a quote\b|\bget in touch for a quote\b|\bhire us\b|"
            r"\bengage us\b|\bcontact us today\b|\bsign up (?:now|today)\b|"
            r"\bclick here to (?:get|start|book|hire)\b|"
            r"\btalk to (?:our )?(?:an )?expert\b|\bavail (?:our|this)\b)", re.I),
    ),
)

#: A ceiling on findings so a pasted 400KB newsletter cannot return a response
#: larger than the template itself. Reached only by pathological input.
MAX_FINDINGS = 40


def _plain(html_or_text: str) -> str:
    """Tags out, whitespace collapsed. Not a sanitiser — nothing here is
    rendered. Matching against raw HTML would quote `<b>best</b>` at the author
    and would also match inside attribute values, which is noise."""
    if not html_or_text:
        return ""
    return _WS.sub(" ", _TAG.sub(" ", str(html_or_text))).strip()


def lint(subject: str = "", body_html: str = "", body_text: str = "") -> dict:
    """Advisory findings on one template's wording.

    Returns `{"findings": [...], "counts": {...}, "advisory": True}`. `advisory`
    is in the payload rather than assumed by the client, so a screen cannot
    accidentally start treating this as a gate.

    Each finding names WHERE it was found — subject lines get read and forwarded
    far more than bodies, and a superlative in a subject is the one that lands in
    a notification preview.
    """
    findings: list[dict] = []
    parts = (("subject", subject), ("body", body_html or ""), ("body_text", body_text or ""))
    seen: set[tuple[str, str]] = set()

    for where, raw in parts:
        text = _plain(raw)
        if not text:
            continue
        for rule_id, label, severity, why, pattern in _LINT_RULES:
            for m in pattern.finditer(text):
                phrase = m.group(0).strip()
                # The same phrase found in body_html and again in body_text is
                # one problem, not two — the author wrote it once.
                dedupe = (rule_id, phrase.lower())
                if where != "subject" and dedupe in seen:
                    continue
                seen.add(dedupe)
                findings.append({
                    "rule": rule_id,
                    "label": label,
                    "severity": severity,
                    "where": where,
                    "phrase": phrase,
                    "why": why,
                    "citation": CITATION_CLAUSE_6,
                })
                if len(findings) >= MAX_FINDINGS:
                    break
            if len(findings) >= MAX_FINDINGS:
                break
        if len(findings) >= MAX_FINDINGS:
            break

    counts = {"high": 0, "medium": 0}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1

    return {
        "advisory": True,
        "findings": findings,
        "counts": counts,
        "truncated": len(findings) >= MAX_FINDINGS,
        "note": (
            "Guidance, not a gate. These phrases read as advertising under "
            f"{CITATION_CLAUSE_6}. Nothing here blocks a save or a send — the "
            "only hard block in this module is the client-versus-prospect "
            "audience gate."
        ) if findings else None,
    }


# ── The evidence trail ──────────────────────────────────────────────────────
#
# WHY THIS DEGRADES INSTEAD OF FAILING. `migrations/183_prachar_icai_gate.sql`
# is written but NOT APPLIED — the owner applies migrations by hand, and this
# code will be deployed before that happens. A send path that 500s because an
# evidence table does not exist yet would turn a compliance improvement into an
# outage, so every write below is best-effort and shouts in the log when it
# cannot land. THE GATE ITSELF NEVER DEGRADES: it reads
# `graha_contacts.client_id`, which has existed since migration 031.

_table_cache: dict[str, bool] = {}


async def table_exists(pool, name: str) -> bool:
    """Cached `to_regclass` probe.

    Cached ONLY when true. A false answer is re-asked, because the interesting
    transition is "the owner has just applied the migration" and a process that
    cached the miss would keep writing nothing until the next deploy.
    """
    if _table_cache.get(name):
        return True
    try:
        found = await pool.fetchval("SELECT to_regclass($1)", f"staging.{name}")
    except Exception:                                        # noqa: BLE001
        logger.exception("Prachar compliance: could not probe staging.%s", name)
        return False
    ok = found is not None
    if ok:
        _table_cache[name] = True
    return ok


async def column_exists(pool, table: str, column: str) -> bool:
    """Same discipline as `table_exists`, for the two columns 183 adds to
    tables that already exist. Named rather than inferred from the rules table:
    a future migration could split them, and a proxy check would then be wrong
    in the silent direction."""
    key = f"{table}.{column}"
    if _table_cache.get(key):
        return True
    try:
        found = await pool.fetchval(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='staging' AND table_name=$1 AND column_name=$2",
            table, column,
        )
    except Exception:                                        # noqa: BLE001
        logger.exception("Prachar compliance: could not probe %s", key)
        return False
    if found:
        _table_cache[key] = True
        return True
    return False


def reset_table_cache() -> None:
    """For tests. Never called by the product."""
    _table_cache.clear()


async def record_override(conn, *, org_id: str, campaign_id: str,
                          actor_id: str, verdict: SendVerdict) -> str | None:
    """Log the decision somebody owns. Returns the override id, or None.

    WHO, WHEN, BASIS — and the counts as they stood at the moment of the
    decision, because "12 non-clients" is the fact the partner was looking at
    and re-deriving it later from a CRM that has moved on would produce a
    different number.
    """
    if not await table_exists(conn, "prachar_icai_overrides"):
        logger.error(
            "ICAI OVERRIDE NOT RECORDED: staging.prachar_icai_overrides does "
            "not exist (migration 183 not applied). Campaign %s was sent to %d "
            "non-client recipients by %s under the basis: %s",
            campaign_id, verdict.non_client_count, actor_id,
            verdict.override_basis,
        )
        return None
    cls = verdict.template_class
    row = await conn.fetchrow(
        "INSERT INTO staging.prachar_icai_overrides "
        "(org_id, campaign_id, decided_by, basis, non_client_count, "
        " total_count, template_class, class_basis, rule_key) "
        "VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        org_id, campaign_id, str(actor_id), verdict.override_basis,
        verdict.non_client_count,
        verdict.client_count + verdict.non_client_count,
        cls.key if cls else None,
        cls.basis if cls else "unclassified",
        cls.rule_key if cls else RULE_SOLICITATION,
    )
    return str(row["id"]) if row else None


def consent_basis_for(contact: dict, override_id: str | None) -> str:
    """What this product can HONESTLY say about why it holds this address.

    Three values, and none of them is invented:

      client_engagement  the contact is linked to a client of the practice.
                         Provable from the row: `graha_contacts.client_id`.
      icai_override      not a client; mailed under a recorded override. The
                         override row IS the record; this value points at it.
      not_recorded       neither. Says so.

    There is no `consented` value and no boolean, on purpose. Nothing in this
    product has ever captured a DPDP consent — no notice, no version, no
    timestamp — and a column that reads `true` because a seed script set it is
    worse than no column. The DPDP consent obligation is dated 13 May 2027 and
    is seeded into `prachar_compliance_rules` so the work has a home; until
    something actually records a consent, this function will not claim one.
    """
    if contact.get("client_id"):
        return "client_engagement"
    if override_id:
        return "icai_override"
    return "not_recorded"


async def record_send_evidence(conn, *, org_id: str, campaign_id: str,
                               contacts, template_id: str | None,
                               template_class: TemplateClass | None,
                               override_id: str | None = None) -> int:
    """One evidence row per recipient. Returns how many landed.

    Written BEFORE dispatch, from the same `eligible` list the dispatch loop
    walks, so the evidence describes who the send was addressed to even if the
    process dies half way. A row here is not a claim that the message arrived —
    `prachar_campaign_contacts.status` is where delivery is recorded, and this
    table deliberately does not duplicate it.
    """
    if not contacts:
        return 0
    if not await table_exists(conn, "prachar_send_evidence"):
        logger.error(
            "SEND EVIDENCE NOT RECORDED for campaign %s (%d recipients): "
            "staging.prachar_send_evidence does not exist — migration 183 has "
            "not been applied. The send is proceeding; the firm has no stored "
            "proof of client linkage for it.",
            campaign_id, len(contacts))
        return 0

    cls_key = template_class.key if template_class else None
    cls_basis = template_class.basis if template_class else "unclassified"
    rule_key = template_class.rule_key if template_class else RULE_SOLICITATION

    rows = [
        (
            org_id, campaign_id,
            str(c["id"]) if c.get("id") else None,
            c.get("email") or "",
            str(c["client_id"]) if c.get("client_id") else None,
            bool(c.get("client_id")),
            template_id, cls_key, cls_basis, rule_key,
            consent_basis_for(c, override_id),
            override_id,
        )
        for c in contacts
    ]
    await conn.executemany(
        "INSERT INTO staging.prachar_send_evidence "
        "(org_id, campaign_id, contact_id, recipient_email, client_id, "
        " was_client, template_id, template_class, class_basis, rule_key, "
        " consent_basis, override_id) "
        "VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8,$9,$10,"
        " $11,$12::uuid) "
        "ON CONFLICT (campaign_id, recipient_email) DO NOTHING",
        rows,
    )
    return len(rows)
