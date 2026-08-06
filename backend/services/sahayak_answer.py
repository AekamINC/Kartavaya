"""
sahayak_answer.py — the answer contract behind `POST /api/v1/hub/chat`.

── Why this file exists ────────────────────────────────────────────────────────

The Sahayak screen shipped as markup with nothing behind it. `AnswerBody.jsx`
says so in its own header: it renders `message.work`, `message.figs` and
`message.refusal` from fields "nothing sets today, which means they render
NOTHING today". The only chat route in the product,
`POST /chat/sessions/{id}/send`, returns five keys — message, sources, model,
cost_usd, credits_charged — so the work-steps panel, the figures, the evidence
table and the refusal block have never had data.

The prototype is the spec: `design-reference/Kartavaya Redesign/SahayakData.jsx`.
Its opening comment states the constraint the whole surface is built on — "the
assistant may only say things the reader could have gone and looked up, and it
must show where" — and its one seeded turn carries `work`, `figs`, `body` with
per-claim citations, `none` (the refusal), `srcs` and `ev` (the evidence table).
This module produces every one of those from real reads.

── The refusal is not optional, and it is not a model behaviour ───────────────

Proposal 29 §2 rule 2 calls the refusal block the most important element on the
screen. It is built HERE, deterministically, from what was actually reachable —
never parsed out of the model's prose, and never a prompt asking the model to be
honest. Three shapes, and only the third involves the model at all:

  access       the caller does not hold a module grant a source needs. Refused
               BEFORE any read and BEFORE any credit, the same order and for the
               same reason as `skills/context.py:assert_step_access`: a partial
               answer is worse than a refusal because it looks finished, and only
               a refusal names the module so the person can go and ask for it.
  unavailable  every source the question needed errored. Nothing was read, so
               there is nothing to ground an answer in. Also free.
  generation   the model chain failed after the charge. Refunded by the caller,
               and reported as a refusal rather than as the friendly 200 saying
               "Sorry, I encountered an error" that `hub_chat.py` still returns.

A FOURTH shape rides along with a real answer: `partial`, naming the sources that
could not be read while others could. That is the prototype's `none` block in its
ordinary form — "what it would not tell you" — and it is why `refusal` being
non-empty does not imply `answered` is false.

── Retrieval is scoped to the CALLER, not to the org ──────────────────────────

Every source this module can read is a key in `skills/context.py:SOURCES`, and
every one of those keys has its modules declared in `skills/modules.py`. The
grants are resolved through `withheld_modules`, which is the same resolution
`require_module` performs. Nothing here invents an auth path: an org member with
a Sahayak grant and no Finance grant cannot make the assistant read the
receivables ledger, and the sources list cannot contain a record they may not
see, because the read never happens.

── The planner does not call a model ──────────────────────────────────────────

Deciding WHICH sources a question needs is done with a keyword table, not an LLM.
Two reasons and both are the owner's: production runtime must use cheap models,
and a planning call would be a second paid call per question — doubling the cost
of the cheapest thing the product does. The table is deliberately dull and its
misses are safe: an unmatched question grounds on the knowledge base and the
model's own words, with `sources` empty, which the screen already explains.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Optional

# `MODULE_LABELS` lives in context.py, next to `SkillAccessDenied`, which is the
# only other place that turns a module code into something a human reads. It is
# imported by name rather than copied because a second table of human names is a
# table that drifts, and the drift shows up as a refusal naming "vetana" at a
# payroll clerk.
from services.skills.context import (
    MAX_ROWS_PER_SOURCE, MODULE_LABELS, build_context,
)

log = logging.getLogger(__name__)


#: The most sources one question may read. Context is tokens and tokens are the
#: running cost of the product — `skills/context.py` caps the whole rendered
#: block at ~8k characters, and four full sources is already most of that. A
#: question that matches more than four keeps the first four in declaration
#: order, which is deterministic and therefore testable.
MAX_SOURCES = 4

#: Knowledge-base chunks retrieved per question. `hub_chat.py` fetches 20 and
#: re-ranks to 5 with a second paid LLM call; this takes 5 straight from the
#: hybrid search. One fewer paid call per answer, and the re-ranker's own module
#: bills separately — see the note in the router.
KB_TOP_K = 5

#: A chunk below this scores worse than noise and is dropped rather than cited.
#: Same threshold `hub_chat.py` applies, kept identical so the two routes cite
#: the same documents for the same question.
KB_MIN_SCORE = 0.3


@dataclass(frozen=True)
class Intent:
    """One thing a question can be about, and the read that answers it.

    `key`   a key in `skills/context.py:SOURCES`. Not a new retrieval path —
            the whole point is that this reads what a skill step reads, through
            the same handlers, under the same module declarations.
    `fn`    the handler's name as the work step prints it. The prototype's work
            rows read `find_overdue_invoices · free`, not `receivables`.
    `route` the route the reader could call to see the same rows themselves.
            This is the provenance the design rule is about: a figure carries it
            in `src`, a source card carries it in `route`. Every one of these was
            checked against the routers — a route printed as provenance that does
            not exist is a lie told in the one place the product promises not to.
    """
    key: str
    label: str
    fn: str
    route: str
    patterns: tuple[str, ...]


#: Declaration order is match order and therefore tie-break order. Money first:
#: it is what the seeds ask about and the most expensive thing to be vague on.
INTENTS: tuple[Intent, ...] = (
    Intent(
        "receivables", "Overdue customer invoices", "find_overdue_invoices",
        "GET /api/v1/ganit/invoices",
        ("owe us", "owes us", "owed to us", "receivable", "outstanding",
         "unpaid", "overdue invoice", "overdue invoices", "not paid",
         "payment pending", "pending payment", "collections",
         "भुगतान", "बाकी", "बकाया"),
    ),
    Intent(
        "payables", "Overdue vendor bills", "find_overdue_vendor_bills",
        "GET /api/v1/ganit/vendor-bills",
        ("we owe", "payable", "payables", "vendor bill", "vendor bills",
         "supplier bill", "supplier payment", "bills due"),
    ),
    Intent(
        "followups", "Overdue CRM follow-ups", "find_overdue_followups",
        "GET /api/v1/graha/follow-ups",
        ("follow up", "follow-up", "followup", "chased", "chase",
         "last contacted", "reminder to call"),
    ),
    Intent(
        "tasks", "Overdue tasks", "find_overdue_tasks",
        "GET /api/tasks",
        ("overdue task", "overdue tasks", "late task", "task list",
         "who is behind", "slipping", "past due task"),
    ),
    Intent(
        "agreements", "Agreements still unsigned", "find_stalled_agreements",
        "GET /api/v1/esign/documents",
        ("unsigned", "not signed", "signature", "e-sign", "esign",
         "agreement", "contract pending"),
    ),
    Intent(
        "deal_health", "Pipeline health scores", "score_deals",
        "GET /api/v1/graha/deals",
        ("pipeline", "deal", "deals", "opportunity", "opportunities",
         "forecast", "win rate"),
    ),
    Intent(
        "stock", "Items below reorder level", "find_low_stock",
        "GET /api/v1/vikray/stock",
        ("stock", "inventory", "reorder", "out of stock", "running low"),
    ),
    Intent(
        "attendance", "Attendance patterns", "detect_attendance_patterns",
        "GET /api/v1/manav/attendance",
        ("attendance", "absent", "absence", "late mark", "leave balance",
         "on leave", "who is in"),
    ),
    Intent(
        "kpis", "Business KPIs", "aggregate_kpis",
        "GET /api/v1/hub/dashboard",
        ("kpi", "kpis", "how are we doing", "revenue", "turnover",
         "how is business", "performance this month", "headline numbers",
         "summary of the month"),
    ),
)

#: Keyed for lookup without re-scanning the tuple.
INTENTS_BY_KEY: dict[str, Intent] = {i.key: i for i in INTENTS}


def plan_for(question: str) -> list[Intent]:
    """Which sources this question needs, in declaration order.

    Substring matching on a lowercased question, deliberately. A tokeniser buys
    nothing here — the patterns are phrases, several are Devanagari, and the
    product's users write code-mixed questions that no English stemmer improves.

    Returns [] for a question that matches nothing, which is an ordinary
    outcome: "explain a rule in plain language" is one of the six approved
    openers and needs no ledger at all.
    """
    text = (question or "").lower()
    if not text.strip():
        return []
    hits = [i for i in INTENTS if any(p in text for p in i.patterns)]
    return hits[:MAX_SOURCES]


def modules_for_plan(plan: list[Intent]) -> frozenset[str]:
    """Every module grant the plan needs.

    Delegates to `skills/modules.modules_for_step`, so an intent naming a source
    that has no declaration in `SOURCE_MODULES` contributes every sensitive
    module rather than nothing — the fail-closed default that file exists for.
    """
    from services.skills.modules import modules_for_step
    if not plan:
        return frozenset()
    return modules_for_step({"context": [i.key for i in plan]})


async def withheld_for(
    plan: list[Intent], user_id: Optional[str], org_id: str, *, request=None,
) -> frozenset[str]:
    """Of the modules this plan needs, which the caller cannot reach — HERE.

    Two refusals, not one. `withheld_modules` asks what grants the caller holds
    AND whose records they would be holding them over: this route sits on
    `/api/v1/hub/`, one of the four prefixes where a platform role may name
    another organisation on the X-Org-Id header, and a plan naming `receivables`
    reads `ganit`, whose own prefix is deliberately not widened. See the second
    half of `services/skills/modules.py`.
    """
    from services.skills.modules import withheld_modules
    return await withheld_modules(
        user_id, org_id, modules_for_plan(plan), request=request,
    )


def modules_of(intent: Intent) -> tuple[str, ...]:
    """The modules one source reads, for the source card's label."""
    from services.skills.modules import SOURCE_MODULES
    from middleware.role_tiers import SENSITIVE_MODULES
    return tuple(sorted(SOURCE_MODULES.get(intent.key, SENSITIVE_MODULES)))


# ── Reading ─────────────────────────────────────────────────────────────────

@dataclass
class Reading:
    """One source, read or not read, and why."""
    intent: Intent
    ok: bool
    data: Any = None
    error: str = ""
    dropped: int = 0

    @property
    def rows(self) -> int:
        if isinstance(self.data, list):
            return len(self.data)
        if isinstance(self.data, dict):
            return 1
        return 0

    @property
    def empty(self) -> bool:
        return self.ok and self.data in (None, [], {})


async def read_plan(pool, org_id: str, plan: list[Intent], *, params: Optional[dict] = None) -> list[Reading]:
    """Run the plan through the existing context layer.

    `build_context` fetches concurrently, caps each source at
    `MAX_ROWS_PER_SOURCE`, and — the part that matters here — tags a source that
    RAISED as `ok: False` with the exception's type rather than dropping it. A
    source that failed must reach the refusal block; a source silently dropped
    reads to the model exactly like a source that returned nothing, and the model
    will answer over the hole with the same confidence.
    """
    if not plan:
        return []
    ctx = await build_context(pool, org_id, [i.key for i in plan], params=params or {})
    out: list[Reading] = []
    for intent in plan:
        got = ctx.get(intent.key)
        if not got:
            out.append(Reading(intent, ok=False, error="not read"))
            continue
        if got.get("ok"):
            out.append(Reading(intent, ok=True, data=got.get("data"),
                               dropped=int(got.get("dropped") or 0)))
        else:
            out.append(Reading(intent, ok=False, error=str(got.get("error") or "failed")))
    return out


# ── Figures ─────────────────────────────────────────────────────────────────

#: `aggregate_kpis` returns nine keys; these are the ones worth a tile, with the
#: label the tile prints and whether the value is money. Keys absent from this
#: map are still in the model's context — they are just not promoted to a figure.
_KPI_FIGS: tuple[tuple[str, str, str], ...] = (
    ("revenue", "Revenue", "INR"),
    ("expenses_total", "Expenses", "INR"),
    ("invoices_sent", "Invoices sent", "count"),
    ("deals_won", "Deals won", "count"),
    ("new_leads", "New leads", "count"),
    ("tasks_closed", "Tasks closed", "count"),
    ("employees_active", "Active employees", "count"),
)

#: How many tiles the strip may carry. The prototype draws three; more than six
#: stops being a summary and becomes a second table.
MAX_FIGS = 6


def format_inr(value: float) -> str:
    """`1840000` → `₹18,40,000`. Indian grouping, because every other document
    this product prints uses it and a figure that groups in thousands reads as a
    different number to the person checking it."""
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return str(value)
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        s = f"{head},{tail}"
    return f"{sign}₹{s}"


def _group(n: int) -> str:
    return f"{n:,}"


def figures_for(readings: list[Reading]) -> list[dict]:
    """The attributable figures — prototype `figs`, 29 §3.

    EVERY figure carries `src`, the route it came from, and `AnswerBody` drops a
    figure without one on the floor. That is the rule stated plainly: a number
    with no provenance is the one thing worse than not answering. Nothing here is
    estimated, derived across sources, or defaulted to zero — a source that
    returned nothing produces the figure `0` only when it genuinely read zero
    rows, and a source that FAILED produces no figure at all.
    """
    figs: list[dict] = []
    for r in readings:
        if not r.ok:
            continue
        if isinstance(r.data, dict) and r.intent.key == "kpis":
            period = str(r.data.get("period") or "")
            for key, label, unit in _KPI_FIGS:
                value = r.data.get(key)
                if value is None:                      # "not known", never zero
                    continue
                figs.append({
                    "label": label,
                    "value": format_inr(value) if unit == "INR" else _group(int(value)),
                    "sub": f"last {period}" if period else "",
                    "src": r.intent.route,
                    "unit": unit,
                    "source_key": r.intent.key,
                })
            continue
        if isinstance(r.data, list):
            total = len(r.data) + r.dropped
            sub = ""
            days = [
                int(row["days_past"]) for row in r.data
                if isinstance(row, dict) and isinstance(row.get("days_past"), (int, float))
            ]
            if days:
                sub = f"oldest {max(days)} days past due"
            elif r.dropped:
                sub = f"first {MAX_ROWS_PER_SOURCE} shown"
            figs.append({
                "label": r.intent.label,
                "value": _group(total),
                "sub": sub,
                "src": r.intent.route,
                "unit": "count",
                "source_key": r.intent.key,
            })
    return figs[:MAX_FIGS]


# ── Evidence table ──────────────────────────────────────────────────────────

#: Column headings for the row shapes the read handlers actually return, so the
#: evidence table says "Days past due" rather than "days_past". A shape not
#: named here is flattened generically — see `_generic_columns`.
_ROW_LABELS: dict[str, str] = {
    "entity.label": "Item",
    "entity.module": "Module",
    "days_past": "Days past due",
    "owner": "Owner",
    "item.name": "Item",
    "quantity": "On hand",
    "threshold": "Reorder level",
    "deficit": "Short by",
    "score": "Score",
    "reason": "Reason",
}

#: Widest table worth putting on screen. Beyond this it is a report, not
#: evidence for one answer.
MAX_EVIDENCE_COLS = 6
MAX_EVIDENCE_ROWS = MAX_ROWS_PER_SOURCE


def _flatten(row: dict) -> dict:
    """One level of nesting, `entity.label` style. The read handlers wrap the
    thing itself in `entity` or `item`, and a table column headed `entity` full
    of `{'id': …, 'label': …}` is not evidence."""
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, dict):
            for sub, sub_value in value.items():
                if isinstance(sub_value, (str, int, float)) or sub_value is None:
                    out[f"{key}.{sub}"] = sub_value
        elif isinstance(value, (str, int, float)) or value is None:
            out[key] = value
    return out


def _generic_columns(flat: dict) -> list[str]:
    """Columns, in the handler's own key order, minus the ids nobody reads.

    `endswith("id")` alone would also drop `paid`, `valid` and `void`. The
    suffixes matched are the two the handlers actually produce — a bare `id` and
    anything ending `_id` or `.id` after flattening.
    """
    return [
        k for k in flat
        if k != "id" and not k.endswith("_id") and not k.endswith(".id")
    ][:MAX_EVIDENCE_COLS]


def evidence_for(readings: list[Reading]) -> Optional[dict]:
    """The prototype's `ev` — `{cols, rows, src, source_key, truncated}`.

    Built from the first source that returned actual rows. One table, not one
    per source: the prototype draws one, and a stack of three under a
    three-sentence answer is a report the reader did not ask for.
    """
    for r in readings:
        if not r.ok or not isinstance(r.data, list) or not r.data:
            continue
        rows_in = [row for row in r.data if isinstance(row, dict)][:MAX_EVIDENCE_ROWS]
        if not rows_in:
            continue
        flat_rows = [_flatten(row) for row in rows_in]
        keys = _generic_columns(flat_rows[0])
        if not keys:
            continue
        return {
            "cols": [_ROW_LABELS.get(k, k.replace("_", " ").replace(".", " ").strip().capitalize())
                     for k in keys],
            "rows": [["" if fr.get(k) is None else str(fr.get(k)) for k in keys]
                     for fr in flat_rows],
            "src": r.intent.route,
            "source_key": r.intent.key,
            "truncated": bool(r.dropped),
            "total": len(r.data) + r.dropped,
        }
    return None


# ── Work steps ──────────────────────────────────────────────────────────────

def work_for(readings: list[Reading], *, wrote: bool, credits: int) -> list[dict]:
    """The named steps — 29 §2 rule 4.

    A spinner over a data question tells the reader nothing about what is being
    read on their behalf, and the read steps are FREE while the writing step is
    not, which is the split the prototype's comment makes and the split the
    skill dispatcher already enforces. Both are stated per row rather than left
    to a footnote.
    """
    rows: list[dict] = []
    for r in readings:
        rows.append({
            "state": "done" if r.ok else "wait",
            "ok": r.ok,
            "label": r.intent.label,
            "fn": r.intent.fn,
            "note": "free" if r.ok else f"unavailable — {r.error}",
            "rows": r.rows if r.ok else 0,
            "src": r.intent.route,
        })
    if wrote:
        rows.append({
            "state": "done",
            "ok": True,
            "label": "Wrote the answer",
            "fn": "agent_type: chatbot",
            "note": f"{credits} credit{'' if credits == 1 else 's'}",
            "rows": 0,
            "src": "",
        })
    return rows


# ── Sources ─────────────────────────────────────────────────────────────────

def data_sources(readings: list[Reading], start_ref: int = 1) -> tuple[list[dict], int]:
    """Numbered source cards for the org's own records, and the next free ref.

    Numbered because the model is GIVEN these numbers in the context block, so
    `[1]` in the answer points at a record set the reader can open. Web pages get
    no number for the opposite reason, stated in `hub_chat.py`: nothing numbered
    them into the prompt, so inventing one would produce a citation marker
    pointing at text the model never saw.

    A source that FAILED to read is not in this list. It is not a source — it is
    a hole, and it belongs to the refusal block.
    """
    out: list[dict] = []
    ref = start_ref
    for r in readings:
        if not r.ok:
            continue
        out.append({
            "ref": ref,
            "kind": "data",
            "title": r.intent.label,
            "source_type": "data",
            "route": r.intent.route,
            "module": ", ".join(MODULE_LABELS.get(m, m) for m in modules_of(r.intent)),
            "rows": r.rows,
            "truncated": bool(r.dropped),
            "chunk_id": "",
            "similarity": None,
        })
        ref += 1
    return out, ref


def kb_sources(hits: list[dict], start_ref: int) -> tuple[list[dict], list[str], int]:
    """Knowledge-base chunks, in the shape `assistant/sources.js` already parses.

    Returns the cards, the context blocks that carry the same numbers, and the
    next free ref.
    """
    cards: list[dict] = []
    blocks: list[str] = []
    ref = start_ref
    for hit in hits or []:
        score = hit.get("similarity", 0) or 0
        if score <= KB_MIN_SCORE and (hit.get("vec_score", 0) or 0) <= KB_MIN_SCORE:
            continue
        cards.append({
            "ref": ref,
            "kind": "kb",
            "chunk_id": hit.get("chunk_id", ""),
            "title": hit.get("doc_title", ""),
            "source_type": hit.get("source_type", ""),
            "similarity": round(float(score), 3),
        })
        blocks.append(
            f"[{ref}] {hit.get('doc_title') or 'Document'} (from your knowledge base)\n"
            f"{(hit.get('content') or '')[:1200]}"
        )
        ref += 1
    return cards, blocks, ref


def web_sources(grounding: list[dict]) -> list[dict]:
    """Pages the model's own grounding read. No `ref` — see `data_sources`."""
    return [
        {"kind": "web", "type": "web",
         "title": g.get("title") or "Web", "url": g.get("url") or ""}
        for g in (grounding or [])
    ]


# ── The context block ───────────────────────────────────────────────────────

def render_readings(readings: list[Reading], kb_blocks: list[str], start_ref: int = 1) -> str:
    """The org's own data, numbered so a claim can point back at it.

    Deliberately not `skills/context.py:render_context`: that renders for a skill
    STEP, which produces a deliverable and needs no citation markers. A chat
    answer's whole contract is that every claim points somewhere, so each source
    is introduced by the same `[n]` the source card carries.
    """
    import json

    if not readings and not kb_blocks:
        return ""

    out = [
        "CONTEXT — this organisation's own current records, read just now for "
        "this question. Ground every claim in it and do not invent figures.",
    ]
    ref = start_ref
    for r in readings:
        if not r.ok:
            continue
        body = json.dumps(r.data, default=str, ensure_ascii=False)
        note = ""
        if r.dropped:
            note = (f"\n({r.dropped} more not shown — this is the first "
                    f"{MAX_ROWS_PER_SOURCE}. Say so if you quote a total.)")
        out.append(f"\n[{ref}] {r.intent.label} — {r.intent.route}\n{body}{note}")
        ref += 1

    for block in kb_blocks:
        out.append("\n" + block)

    unavailable = [r for r in readings if not r.ok]
    if unavailable:
        out.append(
            "\n## Could not be read\n"
            + ", ".join(f"{r.intent.label} ({r.error})" for r in unavailable)
            + "\nTreat these as unknown, not as empty. Say plainly that you "
              "could not read them rather than reasoning around the gap."
        )
    return "\n".join(out)


def system_prompt(brand: Optional[dict], lang_name: str, cite_max: int) -> str:
    """What the model is told. Cheap models, short instructions, no persona.

    The citation rule is stated as a hard constraint rather than a preference
    because the marker is a CONTROL on the screen — `AnswerBody` turns `[1]` into
    a focusable element that opens the record — and a marker with no source
    behind it is dropped back to plain text, which reads as a rendering fault.
    """
    parts = [
        "You answer questions about this organisation's own records for its own "
        "staff. Be short, specific and literal.",
    ]
    if brand:
        if brand.get("brand_voice"):
            parts.append(f"Brand voice: {brand['brand_voice']}")
        if brand.get("tone"):
            parts.append(f"Tone: {brand['tone']}")
    if cite_max:
        parts.append(
            f"\nCITATIONS: the context above is numbered [1] to [{cite_max}]. "
            f"Put the number of the record set immediately after each claim it "
            f"supports, like [1]. Use only numbers that appear above — never "
            f"invent one, and never cite a number for a claim the records do not "
            f"support."
        )
    else:
        parts.append(
            "\nNo records from this organisation were read for this question. "
            "Do not state figures about their business as if you had seen them. "
            "Say what you would need to read in order to answer."
        )
    parts.append(
        "\nIf the records do not answer what was asked, say exactly what is "
        "missing. A short answer that stops is correct; a complete-looking one "
        "built on a guess is not."
    )
    parts.append(
        f"\nLANGUAGE: the question was written in {lang_name}. Reply in "
        f"{lang_name}, in that language's own script. Proper nouns, figures, "
        f"invoice numbers and GSTINs stay exactly as they appear in the records."
    )
    return "\n".join(parts)


# ── Refusals ────────────────────────────────────────────────────────────────

def _names(modules) -> str:
    return ", ".join(MODULE_LABELS.get(m, m) for m in sorted(modules))


def refusal_access(plan: list[Intent], withheld: frozenset[str]) -> tuple[str, dict]:
    """The caller may not see what the question needs.

    Refuse rather than omit, and the reasoning is `SkillAccessDenied`'s, which is
    worth repeating where it is enforced a second time: a model handed "unknown"
    hedges, estimates and reasons around the hole, and a model reasoning around
    the absence of payroll is exactly what this prevents. The refusal also names
    the module, so the person can go and ask for the grant — an omission teaches
    nobody anything.
    """
    names = _names(withheld)
    asked = ", ".join(i.label.lower() for i in plan)
    text = (
        f"Sahayak did not answer this. Answering it means reading {asked}, which "
        f"comes from {names} — and you do not have access to {names}. Ask an "
        f"administrator for it, or ask something that does not need it. Nothing "
        f"was read and nothing was charged."
    )
    return text, {
        "kind": "access",
        "withheld_modules": sorted(withheld),
        "withheld_labels": [MODULE_LABELS.get(m, m) for m in sorted(withheld)],
        "asked_for": [{"key": i.key, "label": i.label, "route": i.route} for i in plan],
        "unreachable": [],
        "charged": False,
    }


def refusal_unavailable(readings: list[Reading]) -> tuple[str, dict]:
    """Everything the question needed errored."""
    detail = ", ".join(f"{r.intent.label} ({r.error})" for r in readings if not r.ok)
    text = (
        f"Sahayak did not answer this. It needed to read {detail} and could not, "
        f"so anything it said would be a guess rather than a reading of your "
        f"records. Nothing was charged. Try again shortly."
    )
    return text, {
        "kind": "unavailable",
        "withheld_modules": [],
        "withheld_labels": [],
        "asked_for": [{"key": r.intent.key, "label": r.intent.label, "route": r.intent.route}
                      for r in readings],
        "unreachable": [{"key": r.intent.key, "label": r.intent.label,
                         "route": r.intent.route, "reason": r.error}
                        for r in readings if not r.ok],
        "charged": False,
    }


def refusal_generation(error: str, refunded: bool) -> tuple[str, dict]:
    """The model chain failed after the charge.

    Reported as a refusal, not as the friendly 200 reading "Sorry, I encountered
    an error" that the older chat route still returns — that sentence is
    indistinguishable from an answer to everything downstream of it, including
    the screen, the stored history and the feedback loop.
    """
    text = (
        f"Sahayak did not answer this. The answer could not be generated "
        f"({error}). "
        + ("The credit taken for it has been returned. " if refunded else "")
        + "Nothing here is a guess at what the answer would have been."
    )
    return text, {
        "kind": "generation_failed",
        "withheld_modules": [],
        "withheld_labels": [],
        "asked_for": [],
        "unreachable": [],
        "error": error,
        "charged": not refunded,
    }


def refusal_partial(readings: list[Reading]) -> tuple[str, dict]:
    """Some sources were read and some were not. Rides along with a real answer.

    Returns `("", {})` when everything was reachable, so the caller can assign
    the result unconditionally and an empty string means "nothing withheld".
    """
    failed = [r for r in readings if not r.ok]
    if not failed:
        return "", {}
    detail = ", ".join(f"{r.intent.label} ({r.error})" for r in failed)
    text = (
        f"Not everything this question needed could be read: {detail}. Nothing "
        f"above is based on it — treat it as unknown rather than as empty."
    )
    return text, {
        "kind": "partial",
        "withheld_modules": [],
        "withheld_labels": [],
        "asked_for": [{"key": r.intent.key, "label": r.intent.label, "route": r.intent.route}
                      for r in readings],
        "unreachable": [{"key": r.intent.key, "label": r.intent.label,
                         "route": r.intent.route, "reason": r.error}
                        for r in failed],
        "charged": True,
    }


def strip_invalid_refs(text: str, valid: set[int]) -> str:
    """Drop `[n]` markers pointing at nothing.

    The same guard `hub_chat.py` applies before storing, for the same reason:
    `AnswerBody` renders an uncitable marker as literal text, and a bracket in
    the middle of a sentence reads as a defect. Done on the way OUT so the stored
    message and the returned one agree.
    """
    def _keep(match: re.Match) -> str:
        try:
            return match.group(0) if int(match.group(1)) in valid else ""
        except ValueError:
            return ""
    return re.sub(r"\[(\d+)\]", _keep, text or "")
