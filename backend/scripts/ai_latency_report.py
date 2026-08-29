"""What each AI provider really costs in seconds, and whether the chains still agree.

    railway run -e staging -s Kartavya python scripts/ai_latency_report.py
    railway run -e staging -s Kartavya python scripts/ai_latency_report.py --days 30

Run from `backend/`, not the repo root.

READ-ONLY. Five SELECTs against `staging.hub_ai_logs` and nothing else. No
INSERT, no UPDATE, no DDL — staging and production share one Supabase database,
so a script that writes here writes to production.

WHY THIS EXISTS
---------------
`services/ai_router.PROVIDER_LATENCY_MS` is the table the routing order is built
on, and it is a snapshot: 303 rows, read on 2026-08-19. A hardcoded measurement
with no way to retake it quietly becomes a guess — and the first time these
numbers were compiled by hand, two providers were credited with the fastest
answers in the product when what had actually been measured was how quickly
OpenRouter refuses an invalid model id.

So this prints what the logs say NOW, keeps answers and rejections apart, and
names every chain whose real answerer has drifted past its own budget. Run it in
a month. If the deltas are small the ordering stands on its own evidence; if
they are not, `PROVIDER_LATENCY_MS` is stale and `tests/test_latency_budget.py`
is the thing that has to be updated first.

THE THREE DISTINCTIONS THIS REPORT INSISTS ON
---------------------------------------------
1. ANSWERS ARE NOT FAILURES. p50 and p95 are over `status='success'` only.
   Errors are counted and timed in their own column: a provider that 400s in
   64 ms and a provider that times out at 30 s are both failures and are not the
   same problem, and a median over both flatters the second and invents a
   reputation for the first.
2. A PROVIDER WITH ZERO SUCCESSES HAS NO LATENCY. It is printed as `never` and
   is what the `errors` column is for. Two of the eight were in that state on
   2026-08-19 and both were leading chains.
3. LENGTH IS NOT SPEED. `hub_ai_logs` records no task or agent type, so a
   provider that only ever writes blog posts looks slower than one that only
   ever writes captions even if the models are identically fast. The short/long
   split at 400 completion tokens is the correction, and it is what to read when
   two providers serve different kinds of work.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_pool                                              # noqa: E402
from services.ai_router import (                                     # noqa: E402
    INDIC_LANGS, LATENCY_BUDGET_MS, PREMIUM_AGENTS, PROVIDER_LATENCY_MS,
    PROVIDER_REJECTS_MS, QUALITY_AGENTS, _PROVIDER_KEYS, _declared_chain,
    _latency_class, _select_providers,
)

# `percentile_disc`, not `percentile_cont`: it returns a latency that actually
# happened rather than the average of two that did. For 5 rows — which is all
# `gemini_pro_or` has ever had — an interpolated p95 is arithmetic on a sample
# too small to interpolate.
_ANSWERS = """
SELECT provider,
       count(*)                                                       AS calls,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY latency_ms)       AS p50,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)       AS p95,
       max(latency_ms)                                                AS worst,
       sum(coalesce(cost_usd, 0))                                     AS spend
  FROM public.hub_ai_logs
 WHERE status = 'success'
   AND latency_ms IS NOT NULL
   AND created_at >= now() - make_interval(days => $1::int)
 GROUP BY provider
"""

# Distinction 3. A row with no completion tokens is not a short answer, it is an
# answer whose usage frame went missing, so it is in neither bucket.
_BY_LENGTH = """
SELECT provider,
       count(*) FILTER (WHERE completion_tokens <= 400)                AS n_short,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY latency_ms)
           FILTER (WHERE completion_tokens <= 400)                     AS p50_short,
       count(*) FILTER (WHERE completion_tokens > 400)                 AS n_long,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY latency_ms)
           FILTER (WHERE completion_tokens > 400)                      AS p50_long,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY completion_tokens) AS med_out
  FROM public.hub_ai_logs
 WHERE status = 'success'
   AND latency_ms IS NOT NULL
   AND coalesce(completion_tokens, 0) > 0
   AND created_at >= now() - make_interval(days => $1::int)
 GROUP BY provider
"""

_FAILURES = """
SELECT provider,
       count(*)                                                       AS errors,
       percentile_disc(0.50) WITHIN GROUP (ORDER BY latency_ms)       AS p50,
       max(created_at)::date                                          AS last_seen,
       (array_agg(left(coalesce(error_message, ''), 110)
                  ORDER BY created_at DESC))[1]                       AS latest
  FROM public.hub_ai_logs
 WHERE status <> 'success'
   AND created_at >= now() - make_interval(days => $1::int)
 GROUP BY provider
"""

_MODELS = """
SELECT provider, model, status, count(*) AS n, max(created_at)::date AS last_seen
  FROM public.hub_ai_logs
 WHERE created_at >= now() - make_interval(days => $1::int)
 GROUP BY 1, 2, 3
"""

_WINDOW = """
SELECT count(*)        AS rows,
       min(created_at) AS first_seen,
       max(created_at) AS last_seen
  FROM public.hub_ai_logs
 WHERE created_at >= now() - make_interval(days => $1::int)
"""


def _ms(value) -> str:
    return "—" if value is None else f"{int(value):,}"


def _drift(measured: int | None, declared: int | None) -> str:
    """How far the router's belief has moved from the log."""
    if measured is None or declared is None:
        return ""
    change = (measured - declared) / declared
    return "in step" if abs(change) < 0.25 else f"{change:+.0%} vs router"


async def run(days: int) -> int:
    pool = await get_pool()

    window = await pool.fetchrow(_WINDOW, days)
    if not window or not window["rows"]:
        print(f"No hub_ai_logs rows in the last {days} days. Nothing to measure.")
        return 1

    answers = {r["provider"]: r for r in await pool.fetch(_ANSWERS, days)}
    lengths = {r["provider"]: r for r in await pool.fetch(_BY_LENGTH, days)}
    failures = {r["provider"]: r for r in await pool.fetch(_FAILURES, days)}
    models = await pool.fetch(_MODELS, days)

    print(f"public.hub_ai_logs — last {days} days")
    print(f"  {window['rows']:,} rows, {window['first_seen']:%Y-%m-%d} to "
          f"{window['last_seen']:%Y-%m-%d}\n")

    # ── 1 · answers, and only answers ────────────────────────────────────────
    routable = set(_PROVIDER_KEYS)
    seen = sorted(
        (set(answers) | set(failures) | set(PROVIDER_LATENCY_MS)) & routable,
        key=lambda p: int(answers[p]["p50"]) if p in answers else 10 ** 9,
    )

    print(f"{'provider':<18}{'answers':>9}{'p50 ms':>10}{'p95 ms':>10}{'worst':>10}"
          f"{'errors':>8}{'spend $':>10}  router")
    print("-" * 96)
    for code in seen:
        row = answers.get(code)
        err = failures.get(code)
        p50 = int(row["p50"]) if row and row["p50"] is not None else None
        print(
            f"{code:<18}"
            f"{(row['calls'] if row else 0):>9,}"
            f"{(_ms(p50) if p50 is not None else 'never'):>10}"
            f"{_ms(row['p95'] if row else None):>10}"
            f"{_ms(row['worst'] if row else None):>10}"
            f"{(err['errors'] if err else 0):>8,}"
            f"{float(row['spend']) if row else 0.0:>10.4f}"
            f"  {_drift(p50, PROVIDER_LATENCY_MS.get(code))}"
        )

    # ── 2 · the providers that have never answered anything ──────────────────
    dead = [c for c in seen if c not in answers and c in failures]
    if dead:
        print("\nHAS NEVER ANSWERED A QUESTION IN THIS WINDOW")
        for code in dead:
            err = failures[code]
            declared = PROVIDER_REJECTS_MS.get(code)
            drift = _drift(int(err["p50"]) if err["p50"] is not None else None, declared)
            print(f"  {code:<18}{err['errors']:>5} rejections, p50 "
                  f"{_ms(err['p50'])} ms, last {err['last_seen']}  {drift}")
            print(f"      {(err['latest'] or '').strip()}")
            live = sorted({r["model"] for r in models
                           if r["provider"] == code and r["status"] != "success"})
            if live:
                print(f"      model id(s) being refused: {', '.join(live)}")
        print("  A chain may stand one of these in front of a working provider "
              "only while the\n  refusal stays this cheap — "
              "ai_router.PROVIDER_REJECTS_MS is what bounds that, and\n  "
              "tests/test_latency_budget.py fails if the sum outgrows a tenth "
              "of the budget.")

    # ── 3 · length, so a long-form provider is not mistaken for a slow one ───
    print("\nsame calls, split at 400 completion tokens")
    print(f"{'provider':<18}{'short n':>9}{'p50':>9}{'long n':>9}{'p50':>9}"
          f"{'median out':>13}")
    print("-" * 96)
    for code in seen:
        row = lengths.get(code)
        if not row:
            continue
        print(f"{code:<18}{row['n_short']:>9,}{_ms(row['p50_short']):>9}"
              f"{row['n_long']:>9,}{_ms(row['p50_long']):>9}"
              f"{_ms(row['med_out']):>13}")

    unrouted = sorted(set(answers) - routable)
    if unrouted:
        print(f"\n  Also in the log and not routable from any text chain: "
              f"{', '.join(unrouted)}.")
        print("  These are the image codes `generate_image` reaches. Expected "
              "here; ignore.")

    # ── 4 · the part that is not a report: does the ordering still hold ──────
    print("\nchains — whichever provider actually answers, against its budget")
    print("-" * 96)

    def first_answerer(chain: list[str]) -> str | None:
        for code in chain:
            if code in answers and answers[code]["p50"] is not None:
                return code
        return None

    cases = [
        ("en", "social_media", "content"), ("en", "blog", "content"),
        ("en", "chatbot", "chatbot"), ("gu", "social_media", "content"),
        ("gu", "blog", "content"), ("gu", "chatbot", "chatbot"),
        ("en", "campaign", "content"),
    ]
    for lang, agent, task in cases:
        chain = _select_providers(language=lang, agent_type=agent, task=task)
        cls = _latency_class(agent, task)
        budget = LATENCY_BUDGET_MS[cls]
        code = first_answerer(chain)
        if code is None:
            verdict = "NOTHING IN THIS CHAIN HAS ANSWERED IN THIS WINDOW"
        else:
            p50 = int(answers[code]["p50"])
            verdict = (f"ok — {p50:,} ms of {budget:,}" if p50 <= budget
                       else f"OVER — {p50:,} ms against a {budget:,} ms budget")
        moved = "" if _declared_chain(lang, agent, task) == chain else \
            "  (budget reordered this chain)"
        print(f"  {lang:<3}{agent:<14}{task:<9}{cls:<12}"
              f"{str(code):<17}{verdict}{moved}")

    # Every combination, not only the readable seven: a breach in a language
    # nobody spot-checks is still a breach.
    breaches = []
    for lang in ["en", *sorted(INDIC_LANGS)]:
        for task in ["content", "chatbot"]:
            for agent in ["social_media", "chatbot",
                          *sorted(QUALITY_AGENTS), *sorted(PREMIUM_AGENTS)]:
                chain = _select_providers(language=lang, agent_type=agent, task=task)
                budget = LATENCY_BUDGET_MS[_latency_class(agent, task)]
                code = first_answerer(chain)
                if code and int(answers[code]["p50"]) > budget:
                    breaches.append((lang, agent, task, code,
                                     int(answers[code]["p50"]), budget))

    print()
    if breaches:
        print(f"{len(breaches)} routing combinations are now answered by a "
              f"provider over budget:")
        for lang, agent, task, code, p50, budget in breaches[:12]:
            print(f"  ({lang}, {agent}, {task}) -> {code} at {p50:,} ms, "
                  f"budget {budget:,} ms")
        print("\nThe order in ai_router._declared_chain no longer matches the "
              "logs. Re-order it,\nupdate PROVIDER_LATENCY_MS, and let "
              "tests/test_latency_budget.py fail until they agree.")
        return 1

    print("Every chain is answered by a provider inside its budget.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=90,
                        help="how far back to read (default 90; the whole log "
                             "was 38 days old when this was written)")
    args = parser.parse_args()
    return asyncio.run(run(args.days))


if __name__ == "__main__":
    raise SystemExit(main())
