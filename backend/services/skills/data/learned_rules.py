"""
learned_rules — catalogue #55, "Learned Categorisation".

One handler:

    brief_learned_categorisation   what this firm's own past decisions would
                                   teach a rule engine about its bank narrations
                                   — and, today, why they teach it nothing

The folio names #55 separately from #42 ("Bank Narration Rules") and says why:
"the blocker deserves it: the product cannot learn from a decision it never
stores. One column, written when a human classifies a line, makes this the
cheapest skill in the catalogue."

Migration 175 added the three columns —
`staging.ganit_bank_statement_lines.category`, `.categorised_by`,
`.categorised_at`. It added nothing else. **It did not create the write path**,
and its own header says so in as many words. So on the day this module ships,
the answer for every organisation in the product is the same, and the entire
value of the handler is in saying that answer HONESTLY rather than returning a
clean-looking empty list.

── THE FAILURE THIS MODULE EXISTS TO AVOID ──────────────────────────────────

A handler that queries an empty column, finds no conflicts and returns
`{"rules": [], "problems": 0}` has told a chartered accountant that their bank
categorisation is in good order. It is not in good order; it has never been
attempted. Those two facts must not produce the same output, and here they do
not: the handler reports one of THREE states, and `could_not_check` is a
first-class field, not a footnote.

    no_bank_data                  no statement line has ever been imported for
                                  this org. Nothing to learn from because there
                                  is nothing at all. TWO of the three live orgs
                                  are in this state.
    no_categorisation_recorded    lines exist; not one carries a human category,
                                  because no screen writes the column. This is
                                  the state migration 175 left the product in
                                  and it is `could_not_check`, NOT "no findings".
    learnable                     at least one human decision is on record and
                                  the rule derivation below actually ran.

── THE ONE CHANGE THAT TURNS THIS ON, NAMED ─────────────────────────────────

`POST /api/v1/ganit/bank-statements/{line_id}/match` (`routers/ganit.py:2886)`
is the door a human goes through when they say what a bank line is. Its UPDATE
reads, in full:

    UPDATE staging.ganit_bank_statement_lines
       SET matched_payment_id=$1::uuid, matched_type=$2, is_reconciled=TRUE
     WHERE id=$3::uuid AND org_id=$4::uuid AND is_reconciled=FALSE

Three more assignments on that statement — `category`, `categorised_by`,
`categorised_at` — plus a category field on the reconciliation screen that
feeds them, and this skill starts returning rules within one month of a firm's
normal work. Nothing else in the product needs to change. The unmatch endpoint
at :2986 should clear them again, or an unmatched line keeps a categorisation
nobody stands behind any more. That is the whole unblock, and it is not made
here: this module reads and never writes.

── IT NEVER CALLS A MODEL, AND THAT IS THE POINT, NOT AN OMISSION ───────────

#42's design sends "only the residual tail to one batched call". The folio's
warning about doing that BEFORE the write path exists is the reason #55 is a
separate entry: with `category` empty, the residual tail is every line, and
#42 "degrades into 'a model reads your bank statement every month' — the exact
recurring cost to avoid". So this module makes no model call, contains no
prompt, imports nothing that can reach a provider, and there is a test that
walks its AST to keep it that way. The residual count is REPORTED so a reader
can see what a model would have been asked to do; the call is not made.

── HOW A RULE IS DERIVED, AND WHAT MAKES ONE UNTRUSTWORTHY ──────────────────

A rule is `stem -> category`, where the stem is up to three alphabetic tokens
of at least three characters taken from the START of `description`, lowercased,
with the bank's own rail words dropped (`neft`, `imps`, `utr`, `upi`, …).

`reference` is deliberately NOT part of the stem. On the live data it holds
`UTR000000236849` and `CHGhq0o7` — a value unique to the line by construction.
Folding it in makes every stem unique and the rule count is structurally zero,
which would have looked exactly like "this firm is inconsistent" instead of
"the developer chose the wrong field".

A stem must occur `min_occurrences` times (default 3, the folio's number) and
must be PURE — every categorised occurrence agreeing. A stem categorised two
different ways is NOT emitted as a rule at whichever category is more common;
it goes in `conflicting_stems`, because "usually rent" is the exact shape of a
confident wrong answer this shelf cannot afford. Each rule then carries the
evidence that migration 175's own comment says makes it evidence rather than a
guess — "a rule learned from one person's Tuesday is not a rule":

    corroborated    more than one person, or more than one day
    single sitting  one person, one calendar day — emitted, and LABELLED
    too broad       the stem is a single token, so it would match far more
                    than it was learned from — emitted, and LABELLED

Nothing is silently dropped. A caller that wants only the strong ones filters
on `confidence`; a caller that shows the weak ones shows them with the label.

── THE WEAKER SIGNAL THAT EXISTS TODAY ──────────────────────────────────────

`matched_type` is populated (128 live rows, every one `invoice_payment`) and it
is a different and WEAKER fact than a human categorisation, for two reasons
that are both on `limitations`:

  1. It is the MATCHER's conclusion, not a person's. It records that a line was
     tied to a payment, which is a narrower claim than what the money was for.
  2. It has exactly ONE distinct value across the entire product. A label set
     with one class cannot discriminate. Every rule derived from it predicts
     `invoice_payment`, so it can say "this narration shape has been a customer
     receipt before" and it can say nothing else at all.

It is derived anyway, because it is the only signal that exists before the
write path lands, and it is returned in its own block marked
`source: "matcher"` so it can never be mistaken for the human tier.

── REPEAT NARRATIONS AWAITING A FIRST DECISION ──────────────────────────────

The third block is the one with immediate value on today's data: stems that
recur `min_occurrences` times and carry NO category at all. It makes no claim
about what they are. It says where a single human decision would buy the most
future automation — on the live seeded org, four merchant stems account for 32
lines between them. That block needs no write path to be useful; it needs the
write path to be ACTED on.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

Handler run against all three live organisations; `json.dumps(out, default=str)`
succeeds on all three.

  · `staging.ganit_bank_statement_lines` holds 259 rows, ALL of them in one org
    (E2E Test & Associates, 2025-08-01 to 2026-08-02). **Aekam Inc and Unicode
    Group hold ZERO** — those two return `state = "no_bank_data"`, which is a
    different sentence from "no rules", and `could_not_check` is True for both.
  · `category`, `categorised_by`, `categorised_at`: **0 of 259**, everywhere.
    Every org in the product is `could_not_check`. `human_rules` is empty for
    all three and the headline says why. There is no code path that writes
    those columns: `grep -rn categorised routers/` returns one unrelated
    comment in `billing.py` and nothing else.
  · `matched_type`: 128 of 259 populated, **every one of them
    `invoice_payment`**; 131 NULL. The matcher tier therefore yields exactly
    ONE rule — `pmt inv -> invoice_payment`, learned from 128 lines, seen
    2025-08-02 to 2026-07-16 — and it would reach 32 undecided lines. One rule,
    one class, and both facts are on `limitations`.
  · 13 repeat narrations await a first decision at the default threshold of 3.
    `pmt inv` (160 lines, of which 128 already carry a matcher label), then
    `city office mart`, `national paper house`, `royal furniture works` and
    `shree ganesh suppliers` at 8 lines each — 32 lines that four decisions
    would settle — then `bank charges` and `credit` at 7, and `balaji
    traders`, `ganga printers`, `laxmi enterprises`, `metro solutions`,
    `sai computers` and `stationers` at 4.
  · TWO trailing words were dropped as per-line bank references
    (`reference_words_dropped_from_shapes = 2`). Both are all-letter suffixes
    on `E2E NEFT credit …` lines; the other seven suffixes on the same lines
    contain a digit and were already gone. Without that pass those nine
    identical payments forked into nine shapes that each occurred once, and
    `credit` reported 4 lines instead of 7.
  · `residual_lines_a_model_would_have_read` = **227** on the seeded org. That
    is the monthly bill catalogue #42 would incur today, printed rather than
    paid.
  · `description` is NOT NULL; `reference` is nullable and holds a per-line
    UTR. `amount` is SIGNED — there is no credit/debit pair — and the date
    column is `statement_date`, not `txn_date`.
"""
import logging
import re
from datetime import date

from services.skills.timeutil import as_date, utc_now

log = logging.getLogger(__name__)

#: How many times a narration shape must have been decided the same way before
#: it is a rule rather than a coincidence. Three, from the folio: "narrations
#: already categorised the same way three or more times". It is a DEFAULT, not
#: a constant — a firm reviewing its own rules may want to see the twos.
DEFAULT_MIN_OCCURRENCES = 3

#: How far back to read. Two years covers a full comparative and then some; the
#: live data spans 2025-08-01 to 2026-08-02, so the default reads all of it.
DEFAULT_MONTHS_BACK = 24

#: Hard ceiling on the rows STEMMED. The denominators in `counts` are computed
#: by a separate aggregate with no cap, so a truncated scan understates the
#: rules and never the totals — and `scan_truncated` says which happened.
SCAN_CAP = 5000

#: Tokens the bank's own file puts in front of the thing you actually want.
#: Dropping them is what turns 'NEFT-Shree Ganesh Suppliers & Co' and
#: 'IMPS Shree Ganesh Suppliers' into the same stem. Deliberately conservative:
#: only payment rails and reference words, never anything that could be a
#: payee. 'chg' is here because a bank writes it for its own charges, and a
#: charge line's meaning is carried by the words after it.
RAIL_TOKENS = frozenset({
    "neft", "imps", "rtgs", "upi", "ach", "ecs", "nach", "eft",
    "utr", "ref", "refno", "txn", "trn", "trf", "tfr", "clg", "chq",
    "cheque", "chqno", "chg", "chgs", "inb", "por", "mmt", "byclg", "brn",
})

#: A token shorter than this is a fragment of an account number or a stray
#: initial, not a word. Three, because 'gst', 'epf' and 'tds' are all real.
MIN_TOKEN_LEN = 3

#: How many tokens make a stem. Three is enough to separate
#: 'shree ganesh suppliers' from 'shree ram traders' and short enough that a
#: bank appending a branch code or a running number does not fork the stem.
STEM_TOKENS = 3

_SPLIT = re.compile(r"[^0-9a-z]+")
_HAS_DIGIT = re.compile(r"[0-9]")


def _tokens(text: str | None) -> list[str]:
    """The meaningful words of a narration, in order.

    Anything containing a digit is dropped whole rather than having its digits
    stripped, and that is the load-bearing choice: 'UPI/PMT-INV-2607-007' and
    'UPI/PMT-INV-2504-008' become the same three tokens, while 'hq0o7' — a
    per-line reference the bank appended — disappears instead of surviving as
    the fragment 'hq'.
    """
    out = []
    for raw in _SPLIT.split((text or "").lower()):
        if not raw or _HAS_DIGIT.search(raw):
            continue
        if len(raw) < MIN_TOKEN_LEN or raw in RAIL_TOKENS:
            continue
        out.append(raw)
    return out


def _stem(text: str | None, singletons: frozenset = frozenset(),
          keep: int = STEM_TOKENS) -> str:
    """The narration shape: up to *keep* meaningful leading words, lowercased.

    ── WHY `singletons` EXISTS, AND WHY IT ONLY STRIPS FROM THE END ─────────

    A bank appends a per-line reference to the narration and it is not always
    numeric. Live: 'E2E NEFT credit tbqbi' and 'E2E NEFT credit hq0o7' are the
    same payment nine times over, and a purely positional stemmer forks them
    into nine stems that each occur once — so nine identical lines produce no
    rule at all, and the reader is told the firm is inconsistent when the bank
    is merely verbose.

    `singletons` is the set of tokens that occur EXACTLY ONCE across this
    org's own narrations, computed by the caller in a first pass. A token
    nobody else in the whole statement shares is a reference, not a payee.

    They are stripped ONLY from the END of the token list, never from the
    front, and that restriction is the whole safety of the idea. 'NEFT-Acme
    Ltd' and 'NEFT-Zenith Ltd' seen once each would both reduce to 'ltd' if
    leading singletons went too, merging two unrelated payees into one
    confident rule. Keeping the first token makes that impossible.

    Returns '' when nothing survives. An empty stem is never a rule: it would
    match every line whose narration is entirely digits and rails, which is a
    catch-all dressed up as a pattern.
    """
    tokens = _tokens(text)
    while len(tokens) > 1 and tokens[-1] in singletons:
        tokens.pop()
    return " ".join(tokens[:keep])


def _singleton_tokens(rows: list[dict]) -> frozenset:
    """Tokens appearing exactly once across every narration scanned.

    First pass of two. Cheap — one dict over the same rows the second pass
    reads — and it is what lets `_stem` tell a payee from a reference without
    a word list somebody has to maintain.
    """
    seen: dict[str, int] = {}
    for row in rows:
        for token in _tokens(row.get("description")):
            seen[token] = seen.get(token, 0) + 1
    return frozenset(t for t, n in seen.items() if n == 1)


def _window_start(today: date, months_back: int) -> date:
    """First day of the month *months_back* months before *today*.

    Month arithmetic by hand rather than a timedelta, so "24 months" means 24
    months and not 730 days — the two disagree across a leap year and the
    disagreement lands on exactly the boundary rows.
    """
    months = max(1, int(months_back))
    year, month = today.year, today.month - months
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def _confidence(deciders: int, days: int, stem: str) -> str:
    """Why a HUMAN rule should or should not be trusted, in one word.

    Migration 175's own comment on the three columns: WHO and WHEN "are what
    make it evidence rather than a guess — a rule learned from one person's
    Tuesday is not a rule". So a rule agreed by one person in one sitting is
    emitted and LABELLED, never emitted bare and never silently dropped.

    Matcher-derived rules never come through here: they have no decider and no
    decision date, so scoring them on the same scale would dress a machine's
    conclusion up as a corroborated human one. They carry their own fixed,
    weaker label instead.
    """
    if stem and " " not in stem:
        return "too broad"
    if deciders <= 1 and days <= 1:
        return "single sitting"
    return "corroborated"


#: The confidence a matcher-derived rule carries, always. Fixed text rather
#: than a score, because there is nothing here to score: one class, no person,
#: no decision date.
MATCHER_CONFIDENCE = "weaker — a matcher conclusion, not a human decision"


def _group(rows: list[dict], label_key: str, name_key: str | None,
           day_key: str, singletons: frozenset) -> dict:
    """Bucket rows by stem and by the label they carry.

    Returns {stem: {"labels": {label: count}, "deciders": set, "days": set,
    "first": date, "last": date, "lines": int}}. Rows with an empty stem or no
    label are not bucketed here — the caller counts them separately, because
    "we could not form a stem" and "nobody has decided" are different misses.

    `day_key` is named by the caller rather than guessed, and the reason is a
    lie this nearly told: the human tier's day is `categorised_at`, the day a
    person decided. The matcher tier has no such column, and falling back to
    `statement_date` there would report "decided across 40 days" about a set of
    rows nobody decided on any day at all.
    """
    buckets: dict[str, dict] = {}
    for row in rows:
        label = row.get(label_key)
        if not label:
            continue
        stem = _stem(row.get("description"), singletons)
        if not stem:
            continue
        bucket = buckets.setdefault(stem, {
            "labels": {}, "deciders": set(), "days": set(),
            "first": None, "last": None, "lines": 0,
        })
        bucket["labels"][label] = bucket["labels"].get(label, 0) + 1
        bucket["lines"] += 1
        if name_key and row.get(name_key):
            bucket["deciders"].add(row[name_key])
        day = as_date(row.get(day_key))
        if day is not None:
            bucket["days"].add(day)
            if bucket["first"] is None or day < bucket["first"]:
                bucket["first"] = day
            if bucket["last"] is None or day > bucket["last"]:
                bucket["last"] = day
    return buckets


def _rules_from(buckets: dict, min_occurrences: int, open_stems: dict,
                source: str, limit: int) -> tuple[list, list, int]:
    """Turn stem buckets into rules, conflicts, and the count not shown.

    A stem carrying two different labels NEVER becomes a rule at the more
    common one. It becomes a conflict, because "usually rent" printed as "rent"
    is the confident wrong answer that costs a firm's trust in the whole shelf.
    """
    rules, conflicts = [], []
    for stem, bucket in buckets.items():
        labels = bucket["labels"]
        occurrences = bucket["lines"]
        if len(labels) > 1:
            conflicts.append({
                "narration_starts_with": stem,
                "decided_as": sorted(
                    ({"label": k, "times": v} for k, v in labels.items()),
                    key=lambda d: (-d["times"], d["label"])),
                "times_total": occurrences,
                "why_not_a_rule": "the same narration shape was decided two "
                                  "different ways, so there is no rule here "
                                  "yet — a person has to say which is right",
            })
            continue
        if occurrences < min_occurrences:
            continue
        label = next(iter(labels))
        human = source == "human"
        rules.append({
            "narration_starts_with": stem,
            "would_categorise_as": label,
            "learned_from_lines": occurrences,
            "distinct_deciders": len(bucket["deciders"]) if human else None,
            "distinct_days": len(bucket["days"]) if human else None,
            "first_seen": bucket["first"],
            "last_seen": bucket["last"],
            "confidence": (_confidence(len(bucket["deciders"]),
                                       len(bucket["days"]), stem)
                           if human else MATCHER_CONFIDENCE),
            "would_reach_undecided_lines": open_stems.get(stem, 0),
            "source": source,
        })
    rules.sort(key=lambda r: (-r["would_reach_undecided_lines"],
                              -r["learned_from_lines"],
                              r["narration_starts_with"]))
    conflicts.sort(key=lambda c: (-c["times_total"], c["narration_starts_with"]))
    shown = rules[:limit]
    return shown, conflicts[:limit], max(0, len(rules) - len(shown))


# ══════════════════════════════════════════════════════════════════════════
# 55 · brief_learned_categorisation
# ══════════════════════════════════════════════════════════════════════════

async def brief_learned_categorisation(
    pool, org_id: str,
    months_back: int = DEFAULT_MONTHS_BACK,
    min_occurrences: int = DEFAULT_MIN_OCCURRENCES,
    limit: int = 200,
) -> dict:
    """What this firm's own past bank-line decisions would teach a rule engine.

    Every parameter after `org_id` has a default, because a handler with a
    required parameter cannot be put on a schedule and the dispatcher refuses
    it outright. `months_back` defaults to two years, `min_occurrences` to the
    folio's three.

    ── WHAT IT RETURNS, AND WHY THE SHAPE IS LIKE THIS ──────────────────────

    `state` is one of `no_bank_data`, `no_categorisation_recorded`,
    `learnable`, and `could_not_check` is True for the first two. The reason
    those are separate keys rather than an empty list is the entire point of
    catalogue #55: a skill that returns "0 problems" because the column is
    empty has issued a false all-clear on a firm's books.

    ── WHAT IT CANNOT SEE ───────────────────────────────────────────────────

    · No human has ever categorised a bank line in this product, because no
      screen writes the column. `human_rules` is therefore empty for every org
      today and `write_path` names the endpoint that would change that.
    · `ganit_bank_statement_lines` has NO counterparty column. The payer is not
      recorded anywhere — `description` and `reference` are free text out of
      the bank's own file — so a narration is all there is to learn from. A
      firm whose bank writes a different narration for the same payee each
      month is unlearnable here and the stem count will show it.
    · Two people whose account has since been removed collapse to one name in
      `distinct_deciders`. That UNDERSTATES corroboration, which is the safe
      direction: a rule is never promoted by a decider this handler invented.

    It writes nothing, sends nothing, and calls no model. See the module
    docstring for why the last of those is a decision and not an oversight.
    """
    today = as_date(utc_now()) or date.today()
    window_start = _window_start(today, months_back)
    # `limit` caps the LISTS this returns, never the scan. Letting a display
    # cap shrink the evidence is how a rule silently loses the occurrences
    # that made it a rule — 200 shown would have stemmed only 200 of 259 live
    # rows and dropped a real pattern off the bottom.
    cap = SCAN_CAP
    limit = max(1, int(limit))
    # A min_occurrences of 0 or 1 would make every single narration a "rule".
    # Clamped rather than rejected: a scheduled run must not die on a bad
    # stored parameter, and 1 is at least a sentence a reader can evaluate.
    min_occurrences = max(1, int(min_occurrences))

    # ── denominators, exact, uncapped ────────────────────────────────────
    # Computed in SQL over every row rather than over the capped scan below,
    # so a truncated scan can understate the RULES and can never misstate the
    # TOTALS. "0 of 259" is the sentence this skill lives or dies on.
    totals = await pool.fetchrow(
        """
        SELECT count(*)                                            AS lines_total,
               count(*) FILTER (WHERE statement_date >= $2::date)  AS lines_in_window,
               count(category)                                     AS with_category,
               count(categorised_by)                               AS with_categorised_by,
               count(categorised_at)                               AS with_categorised_at,
               count(DISTINCT category)                            AS distinct_categories,
               count(matched_type)                                 AS with_matched_type,
               count(DISTINCT matched_type)                        AS distinct_matched_types,
               min(statement_date)                                 AS first_line,
               max(statement_date)                                 AS last_line
          FROM staging.ganit_bank_statement_lines
         WHERE org_id = $1::uuid
        """,
        org_id, window_start,
    )
    totals = dict(totals) if totals else {}
    lines_total = int(totals.get("lines_total") or 0)
    with_category = int(totals.get("with_category") or 0)
    with_matched_type = int(totals.get("with_matched_type") or 0)

    # ── the scan ─────────────────────────────────────────────────────────
    # `categorised_by` is a user id (`user_xxxxxxxx`) and is NEVER selected
    # raw: this product does not render user ids, so the join resolves a name
    # and the id itself does not leave the database.
    rows = []
    if lines_total:
        rows = [dict(r) for r in await pool.fetch(
            """
            SELECT l.statement_date,
                   l.description,
                   l.category,
                   l.categorised_at,
                   l.matched_type,
                   CASE WHEN l.categorised_by IS NULL THEN NULL ELSE
                        COALESCE(NULLIF(btrim(u.name), ''),
                                 NULLIF(btrim(u.full_name), ''),
                                 '(someone no longer on the team)')
                   END AS decided_by
              FROM staging.ganit_bank_statement_lines l
              LEFT JOIN public.users u ON u.user_id = l.categorised_by
             WHERE l.org_id = $1::uuid
               AND l.statement_date >= $2::date
             ORDER BY l.statement_date DESC
             LIMIT $3::int
            """,
            org_id, window_start, cap,
        )]

    scanned = len(rows)
    scan_truncated = scanned >= cap and int(totals.get("lines_in_window") or 0) > scanned

    # Lines nobody has decided anything about, by stem — the denominator for
    # "how much would this rule actually reach".
    # First pass: the org's own noise vocabulary. See `_stem`.
    singletons = _singleton_tokens(rows)

    open_stems: dict[str, int] = {}
    unstemmable = 0
    for row in rows:
        if row.get("category"):
            continue
        stem = _stem(row.get("description"), singletons)
        if not stem:
            unstemmable += 1
            continue
        open_stems[stem] = open_stems.get(stem, 0) + 1

    # Same, but for the matcher tier: a line with no matched_type is one a
    # matcher-derived rule would newly reach.
    open_stems_matcher: dict[str, int] = {}
    matcher_labelled_stems: dict[str, int] = {}
    for row in rows:
        stem = _stem(row.get("description"), singletons)
        if not stem:
            continue
        if row.get("matched_type"):
            matcher_labelled_stems[stem] = matcher_labelled_stems.get(stem, 0) + 1
        else:
            open_stems_matcher[stem] = open_stems_matcher.get(stem, 0) + 1

    # ── tier 1: what a human said ────────────────────────────────────────
    human_rules, human_conflicts, human_not_shown = _rules_from(
        _group(rows, "category", "decided_by", "categorised_at", singletons),
        min_occurrences, open_stems, "human", limit)

    # ── tier 2: what the matcher concluded — WEAKER, and labelled so ─────
    matcher_rules, matcher_conflicts, matcher_not_shown = _rules_from(
        _group(rows, "matched_type", None, "statement_date", singletons),
        min_occurrences, open_stems_matcher, "matcher", limit)

    # ── tier 3: repeats nobody has decided yet ───────────────────────────
    # `already_labelled_by_the_matcher` is on every row of this block on
    # purpose. Without it the largest waiting narration on the live data reads
    # as 160 completely unknown lines, when 128 of them already carry a
    # matcher conclusion — a reader would think the biggest win is where the
    # product already has the strongest hint.
    awaiting = [
        {"narration_starts_with": stem,
         "lines_waiting": count,
         "already_labelled_by_the_matcher": matcher_labelled_stems.get(stem, 0),
         "why_it_matters": f"one decision here would settle {count} lines and "
                           f"every future line with the same narration"}
        for stem, count in sorted(open_stems.items(),
                                  key=lambda kv: (-kv[1], kv[0]))
        if count >= min_occurrences
    ]
    awaiting_not_shown = max(0, len(awaiting) - limit)
    awaiting = awaiting[:limit]

    reached_by_human = sum(r["would_reach_undecided_lines"] for r in human_rules)
    reached_by_matcher = sum(r["would_reach_undecided_lines"] for r in matcher_rules)
    undecided = max(0, scanned - sum(1 for r in rows if r.get("category")))

    # ── the three states ─────────────────────────────────────────────────
    if lines_total == 0:
        state = "no_bank_data"
        could_not_check = True
        headline = ("No bank statement line has ever been imported for this "
                    "organisation, so there is nothing to learn from. This is "
                    "NOT a finding that the books are consistent — the "
                    "question was never asked.")
    elif with_category == 0:
        state = "no_categorisation_recorded"
        could_not_check = True
        headline = (
            f"0 of {lines_total} bank lines carry a human categorisation, so "
            f"no rule can be learned. The columns exist (migration 175) and "
            f"nothing writes them. This is a MISSING WRITE PATH, not a clean "
            f"bill of health.")
    else:
        state = "learnable"
        could_not_check = False
        headline = (
            f"{with_category} of {lines_total} bank lines carry a human "
            f"categorisation; {len(human_rules)} narration rule(s) hold at "
            f"{min_occurrences}+ agreeing decisions and would reach "
            f"{reached_by_human} undecided line(s).")

    # ── limitations: the caveats a reader must see, not only this file ───
    limitations = [
        "This handler reads only. It writes no category, no rule and no "
        "reminder, and it makes NO model call of any kind — with `category` "
        "empty the 'residual tail' is every line, and sending that to a model "
        "is the recurring cost catalogue #42 was held back to avoid.",
        f"A rule is a narration SHAPE, not a payee. It is the first "
        f"{STEM_TOKENS} words of `description` that contain no digit, are at "
        f"least {MIN_TOKEN_LEN} letters and are not one of the bank's rail "
        f"words (NEFT, IMPS, UTR, UPI and the rest). The `reference` column is "
        f"excluded because it holds a per-line UTR and folding it in makes "
        f"every shape unique — which would report a consistent firm as an "
        f"inconsistent one.",
        "`ganit_bank_statement_lines` records no counterparty. The payer is "
        "not stored anywhere, so the narration is the only evidence there is.",
        f"A trailing word that appears exactly once in this org's whole "
        f"statement history is treated as a per-line bank reference and "
        f"dropped from the shape ({len(singletons)} such word(s) here). That "
        f"makes the shape depend on the corpus: a stem CAN change as more "
        f"statements are imported, and a payee seen only once keeps its name "
        f"in the stem — leading words are never dropped, or two payees seen "
        f"once each would merge into one rule.",
        "A stem decided two different ways is reported as a CONFLICT and is "
        "never emitted as a rule at the more common label.",
    ]

    if lines_total == 0:
        limitations.insert(0, (
            "COULD NOT CHECK: this organisation has no bank statement lines "
            "at all. An empty result here means the data is absent, not that "
            "the categorisation is clean."))
    if with_category == 0 and lines_total:
        limitations.insert(0, (
            f"COULD NOT CHECK the human tier: 0 of {lines_total} lines carry "
            f"`category`, 0 carry `categorised_by`, 0 carry `categorised_at`. "
            f"No screen in this product writes those columns yet, so "
            f"`human_rules` is empty for a reason that has nothing to do with "
            f"this firm's bookkeeping."))
    if with_matched_type:
        limitations.append(
            f"The matcher tier is WEAKER than a human categorisation and must "
            f"not be presented as one: `matched_type` is what the "
            f"reconciliation matcher concluded, and it carries "
            f"{int(totals.get('distinct_matched_types') or 0)} distinct "
            f"value(s) across {with_matched_type} labelled line(s). A label "
            f"set with one class cannot tell two categories apart — it can "
            f"only say a narration shape has been a receipt before.")
    else:
        limitations.append(
            "No line carries `matched_type` either, so even the weaker "
            "matcher-derived signal is unavailable for this organisation.")
    if unstemmable:
        limitations.append(
            f"{unstemmable} undecided line(s) produced no usable narration "
            f"shape — the description was entirely digits and rail words — so "
            f"no rule could ever reach them.")
    if scan_truncated:
        limitations.append(
            f"Only the most recent {scanned} line(s) of "
            f"{int(totals.get('lines_in_window') or 0)} in the window were "
            f"stemmed. The counts above are computed over every row and are "
            f"exact; the RULE list is a floor.")
    for label, not_shown in (("human rule", human_not_shown),
                             ("matcher rule", matcher_not_shown),
                             ("waiting narration", awaiting_not_shown)):
        if not_shown:
            limitations.append(
                f"{not_shown} further {label}(s) were found and not shown "
                f"(list capped at {limit}).")

    return {
        "as_of": today,
        "org_window_from": window_start,
        "state": state,
        "could_not_check": could_not_check,
        "headline": headline,
        "min_occurrences": int(min_occurrences),

        "human_rules": human_rules,
        "human_conflicts": human_conflicts,
        "matcher_rules": matcher_rules,
        "matcher_conflicts": matcher_conflicts,
        "narrations_awaiting_a_first_decision": awaiting,

        "write_path": {
            "columns_added_by": "migration 175_later_tier_unblock.sql",
            "columns": [
                "staging.ganit_bank_statement_lines.category",
                "staging.ganit_bank_statement_lines.categorised_by",
                "staging.ganit_bank_statement_lines.categorised_at",
            ],
            "written_by_anything_today": False,
            "the_one_change": (
                "POST /api/v1/ganit/bank-statements/{line_id}/match "
                "(routers/ganit.py:2886) sets matched_payment_id, matched_type "
                "and is_reconciled and nothing else. Add category, "
                "categorised_by and categorised_at to that UPDATE, put a "
                "category field on the reconciliation screen that feeds it, "
                "and clear the three again in the /unmatch endpoint at :2986. "
                "That is the entire unblock for catalogue #55 and #42."),
            "screen": "Ganit -> Bank reconciliation",
            "until_then": (
                "human_rules is empty because the decision is never stored, "
                "not because this firm categorises inconsistently."),
        },

        "model_use": {
            "calls_made": 0,
            "why_none": (
                "Catalogue #42 would send the residual tail to one batched "
                "model call. With `category` empty the residual IS every line, "
                "which is the recurring monthly cost the folio held #42 back "
                "to avoid. The residual is counted below so the size of that "
                "bill is visible; the call is not made."),
            "residual_lines_a_model_would_have_read": max(
                0, undecided - reached_by_human - reached_by_matcher),
        },

        "counts": {
            "lines_total": lines_total,
            "lines_in_window": int(totals.get("lines_in_window") or 0),
            "lines_stemmed": scanned,
            "scan_truncated": scan_truncated,
            "lines_with_human_category": with_category,
            "lines_with_categorised_by": int(totals.get("with_categorised_by") or 0),
            "lines_with_categorised_at": int(totals.get("with_categorised_at") or 0),
            "distinct_human_categories": int(totals.get("distinct_categories") or 0),
            "lines_with_matched_type": with_matched_type,
            "distinct_matched_types": int(totals.get("distinct_matched_types") or 0),
            "lines_undecided": undecided,
            "unstemmable_undecided_lines": unstemmable,
            "reference_words_dropped_from_shapes": len(singletons),
            "human_rules": len(human_rules),
            "human_conflicts": len(human_conflicts),
            "matcher_rules": len(matcher_rules),
            "matcher_conflicts": len(matcher_conflicts),
            "undecided_lines_reachable_by_human_rules": reached_by_human,
            "undecided_lines_reachable_by_matcher_rules": reached_by_matcher,
            "repeat_narrations_awaiting_a_decision": len(awaiting),
            "first_line": totals.get("first_line"),
            "last_line": totals.get("last_line"),
        },
        "limitations": limitations,
    }
