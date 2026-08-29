"""scraper_pricing.py — hold every scraper's margin inside the owner's band, daily.

THE PROBLEM THIS SOLVES, STATED PLAINLY. `hub_scraper_catalog` prices a run in
CREDITS, one credit is ₹4, and the actors are third-party software whose authors
reprice without telling anyone. On 2026-08-10 every active row in that catalog
sold below cost: Google Maps Leads charged 5 credits (₹20) for a run costing
$0.50 (₹42.50); the Business Email Finder charged the same ₹20 for a run costing
$1.05 (₹89.25). Nothing in the system could see it, because the number it would
have had to compare against was typed by a human months earlier.

WHAT THE VENDOR ACTUALLY CHARGES, read from the Apify API rather than assumed:

  · PAY_PER_EVENT. Google Maps bills $0.004 per PLACE, the email finder $0.10
    per EMAIL RECORD, plus a start fee of $0.00005 per GB of actor memory. A run
    returning three rows costs three units — there is no flat run price.
  · The unit price is TIERED BY OUR ACCOUNT and our tier reads FREE, which is
    the most expensive rung. Lead enrichment on the Maps actor is $0.10 per lead
    at FREE and $0.005 at BRONZE — twentyfold, for the identical call. Moving up
    a tier is therefore a cost decision worth its own analysis; this module only
    reads what we are charged TODAY.

SO WHAT DO WE PRICE AGAINST? The WORST CASE — unit price × `max_results` + start
fee. Not the average. A customer must never be able to run a full-size job at a
loss, and `max_results` is exactly how large a job they are allowed to run. The
consequence is that small runs carry more margin than the target, which is the
right direction to be wrong in.

THE BAND IS THE OWNER'S, 2026-08-10: every scraper between 30% and 50%. The
target is 40% and the arithmetic is `price = cost / (1 - margin)`. Credits are
whole numbers of ₹4, so rounding moves the achieved margin a few points either
way; the job checks the achieved figure against the band afterwards and says so
rather than assuming the arithmetic landed.
"""

from __future__ import annotations

import logging
import math
import os
from typing import Optional

import httpx

from services.apify import APIFY_BASE, BLOCKED_ACTORS, _auth
from db import get_pool

log = logging.getLogger(__name__)

#: One credit, in rupees. Mirrors `ai_router.CREDIT_PRICE_INR` and is imported
#: from there rather than restated — two copies of a price is how they diverge.
from services.ai_router import CREDIT_PRICE_INR  # noqa: E402

#: Rupees per dollar. An environment variable rather than a literal, because it
#: moves and because a 6% FX swing is larger than the rounding error this whole
#: module worries about. The default is deliberately conservative (a HIGH rupee
#: rate makes costs look bigger and prices come out higher).
def _fx() -> float:
    try:
        return float(os.getenv("USD_INR", "88"))
    except ValueError:
        return 88.0


#: The owner's band. A price outside it is reported, never silently accepted.
MARGIN_MIN = 30
MARGIN_MAX = 50
MARGIN_TARGET_DEFAULT = 40

#: A jump this large stops the row rather than repricing it. The gstin-scraper
#: went up 21.5x; at 3x we would have caught it the next morning. Repricing a
#: 20x jump automatically would hand the customer a 20x price rise with no
#: human in the loop, which is its own kind of wrong.
ALARM_RATIO = 3.0


async def fetch_actor_pricing(actor_id: str) -> Optional[dict]:
    """What Apify charges us for one unit of this actor, today.

    Returns `{unit_price_usd, unit_label, start_fee_usd, pricing_model,
    account_tier}` or None when the actor is gone or the shape is unfamiliar.
    None is not an error to swallow — the caller records it and leaves the
    existing price alone, because "we could not read the price" must never
    silently become "the price is zero".
    """
    url = f"{APIFY_BASE}/acts/{actor_id.replace('/', '~')}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=_auth())
        if resp.status_code == 404:
            log.warning("scraper_pricing: actor %s no longer exists", actor_id)
            return None
        resp.raise_for_status()
        data = resp.json().get("data") or {}

    pricing = _effective_pricing(data)
    if not pricing:
        log.warning("scraper_pricing: no pricing record for %s", actor_id)
        return None

    model = pricing.get("pricingModel") or pricing.get("model") or ""
    tier = pricing.get("userTier") or ""

    events = (
        pricing.get("pricingPerEvent", {}).get("actorChargeEvents")
        or pricing.get("events")
        or []
    )
    #: The REST endpoint keys events by id (`apify-default-dataset-item`) while
    #: the MCP tool returns a list. Both shapes are real and both arrive here.
    if isinstance(events, dict):
        events = list(events.values())

    start_fee = 0.0
    billable: list[tuple[float, str, bool]] = []
    for ev in events:
        price = _tier_price(ev, tier)
        if price is None:
            continue
        title = (ev.get("title") or ev.get("eventTitle") or "").strip()
        low = title.lower()
        if "actor start" in low or ev.get("isOneTimeEvent"):
            start_fee = max(start_fee, price)
            continue
        # Add-ons are optional extras the caller does not switch on, and folding
        # them into the unit price would price every run as if it used every
        # feature. The BASE event is what a plain run bills.
        if "add-on" in low:
            continue
        billable.append((price, title, bool(ev.get("isPrimaryEvent"))))

    if not billable:
        log.warning("scraper_pricing: no billable event found for %s", actor_id)
        return None

    # The PRIMARY event when the vendor names one — that is the per-result
    # charge a plain run incurs. Failing that, the dearest: an actor with
    # several result kinds can bill any of them, and pricing against the
    # cheapest is how a full run of the expensive kind sells at a loss.
    primary = [b for b in billable if b[2]]
    unit_price, unit_label, _ = (primary or billable)[0] if primary else max(
        billable, key=lambda p: p[0])

    return {
        "unit_price_usd": unit_price,
        "unit_label": unit_label,
        "start_fee_usd": start_fee,
        #: A FLOOR PER RUN, and neither our catalog nor the first version of this
        #: parser knew it existed. The email finder added one in May 2026 with
        #: the note "a minimum charge floor per run to better reflect platform
        #: infrastructure and lookup costs". A one-row run of that actor costs
        #: $0.50, not $0.01 — so a scraper priced on the per-unit rate alone
        #: sells every small run at a loss, which is precisely the failure this
        #: module exists to end.
        "min_charge_usd": float(pricing.get("minimalMaxTotalChargeUsd") or 0),
        "pricing_model": model or "PAY_PER_EVENT",
        "account_tier": tier or "UNKNOWN",
    }


def _effective_pricing(data: dict) -> Optional[dict]:
    """The pricing record in force — and any imminent rise, whichever is dearer.

    `pricingInfos` is a HISTORY, and it contains FUTURE records: the email
    finder's list carries one that started in April and another that starts in
    May with a new minimum charge. Taking the last element is wrong when the
    newest is not yet live; taking the newest live one is wrong the day before a
    scheduled rise lands.

    So: the record in force today, unless a record starting within the next
    thirty days is more expensive, in which case that one. Pricing slightly
    ahead of a published increase costs the customer a few paise and cannot be
    caught out by it; pricing behind one means selling below cost on the morning
    it takes effect, with nobody watching.
    """
    from datetime import datetime, timedelta, timezone

    infos = data.get("pricingInfos")
    if isinstance(infos, dict):
        return infos
    if not isinstance(infos, list) or not infos:
        single = data.get("pricing") or data.get("currentPricingInfo")
        return single if isinstance(single, dict) else None

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=30)

    def started(rec) -> datetime:
        raw = rec.get("startedAt") or rec.get("createdAt") or ""
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return datetime.min.replace(tzinfo=timezone.utc)

    live = [r for r in infos if started(r) <= now]
    soon = [r for r in infos if now < started(r) <= horizon]
    current = max(live, key=started) if live else min(infos, key=started)

    if soon:
        # "Dearer" measured on the floor, which is the only figure comparable
        # across records without re-parsing every event twice.
        dearest_soon = max(soon, key=lambda r: float(r.get("minimalMaxTotalChargeUsd") or 0))
        if (float(dearest_soon.get("minimalMaxTotalChargeUsd") or 0)
                > float(current.get("minimalMaxTotalChargeUsd") or 0)):
            return dearest_soon
    return current


def _tier_price(event: dict, tier: str) -> Optional[float]:
    """One event's price at OUR tier.

    `tieredPricing` is a list of `{tier, priceUsd}`. Our tier is named on the
    pricing record; when it is missing or unlisted we take the HIGHEST price in
    the list, because guessing low here means selling below cost.
    """
    #: THE THIRD SHAPE. The REST payload can also carry
    #: `eventTieredPricingUsd`, a dict keyed by tier name whose values are
    #: `{tieredEventPriceUsd}`. Three spellings of one idea, all live, all seen
    #: on real actors in this catalogue on 2026-08-10.
    keyed = event.get("eventTieredPricingUsd")
    if isinstance(keyed, dict) and keyed:
        want = (tier or "").upper()
        if want in keyed:
            return float(keyed[want].get("tieredEventPriceUsd") or 0)
        return max(float(v.get("tieredEventPriceUsd") or 0) for v in keyed.values())

    tiers = event.get("tieredPricing") or []
    if tiers:
        for t in tiers:
            if (t.get("tier") or "").upper() == (tier or "").upper():
                return float(t.get("priceUsd") or 0)
        return max(float(t.get("priceUsd") or 0) for t in tiers)
    #: `eventPriceUsd` is the REST spelling and `priceUsd` the MCP one. Reading
    #: only the second is why the first version of this returned "no billable
    #: event" for all nineteen actors — a parser that finds nothing looks
    #: exactly like a vendor that charges nothing.
    for key in ("eventPriceUsd", "priceUsd"):
        if event.get(key) is not None:
            return float(event[key])
    return None


def worst_case_cost_usd(unit_price: float, start_fee: float, max_results: int,
                        min_charge: float = 0.0) -> float:
    """What a FULL-SIZE run of this scraper costs us.

    `max_results` is the ceiling the product itself imposes, so this is the most
    a customer can spend on one run. Pricing against the average would be
    cheaper on paper and wrong the first time somebody asks for a hundred rows.

    `min_charge` is the vendor's floor per run and is a MAXIMUM against the
    computed figure, not an addition — an actor that floors at $0.50 charges
    $0.50 for a small run and the metered amount for a large one.
    """
    metered = (unit_price * max(int(max_results or 1), 1)) + (start_fee or 0)
    return max(metered, float(min_charge or 0))


def credits_for(cost_usd: float, target_margin_pct: int) -> int:
    """Whole credits that hold the target margin on a worst-case run.

    Rounded UP. A half-credit rounded down is a permanent, invisible discount on
    every run of that scraper for as long as the row exists.

    THEN ROUNDED BACK DOWN IF THAT OVERSHOOTS THE BAND. On a cheap actor the
    ceiling is brutal: a run costing ₹3.30 needs 1.4 credits at 40% and rounds
    to 2, which is a 59% margin — outside the owner's 30–50% and a price the
    customer pays for our arithmetic. So if dropping one credit still clears
    `MARGIN_MIN`, drop it. The band is the instruction; the target is only where
    to aim inside it.
    """
    margin = min(max(int(target_margin_pct or MARGIN_TARGET_DEFAULT), 1), 95)
    price_inr = (cost_usd * _fx()) / (1 - margin / 100)
    credits = max(1, math.ceil(price_inr / CREDIT_PRICE_INR))

    while (credits > 1
           and achieved_margin_pct(cost_usd, credits) > MARGIN_MAX
           and achieved_margin_pct(cost_usd, credits - 1) >= MARGIN_MIN):
        credits -= 1
    return credits


def achieved_margin_pct(cost_usd: float, credits: int) -> float:
    """The margin the rounded credit price actually delivers."""
    charged_inr = credits * CREDIT_PRICE_INR
    cost_inr = cost_usd * _fx()
    if charged_inr <= 0:
        return 0.0
    return round((1 - cost_inr / charged_inr) * 100, 1)


async def run_price_watch(*, dry_run: bool = False) -> dict:
    """Read every active scraper's real price and hold the band. Daily.

    Four outcomes per row, all of them recorded:

      · `first_seen`  — no previous unit price. Priced and written.
      · `repriced`    — the vendor moved and we followed, inside the band.
      · `deactivated` — the vendor moved more than `ALARM_RATIO`. The row is
                        switched off and a human decides, because following a
                        20x jump automatically is not "holding the margin", it
                        is passing on a shock.
      · `unreadable`  — the API did not answer or the shape was strange. The
                        existing price is LEFT ALONE. A price we could not read
                        is not a price of zero.

    `dry_run` computes and reports everything and writes nothing, which is how
    this gets reviewed before it is armed.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, apify_actor_id, max_results, credit_cost, price_inr, "
        "       cost_per_run, unit_price_usd, target_margin_pct, price_frozen, is_active "
        "FROM public.hub_scraper_catalog "
        "WHERE is_active = TRUE AND price_frozen = FALSE "
        "ORDER BY name"
    )

    out = {"checked": 0, "repriced": 0, "deactivated": 0, "unreadable": 0,
           "first_seen": 0, "unchanged": 0, "dry_run": dry_run, "rows": []}

    for row in rows:
        actor = row["apify_actor_id"]
        out["checked"] += 1

        if actor in BLOCKED_ACTORS:
            # Withdrawn actors are not priced. Reading their price would be
            # harmless; acting on it would quietly re-offer something we
            # deliberately stopped selling.
            continue

        try:
            pricing = await fetch_actor_pricing(actor)
        except Exception as exc:                              # noqa: BLE001
            log.warning("scraper_pricing: %s unreadable — %s", actor, exc)
            pricing = None

        if not pricing:
            out["unreadable"] += 1
            out["rows"].append({"name": row["name"], "actor": actor,
                                "action": "unreadable"})
            continue

        unit = pricing["unit_price_usd"]
        prev_unit = float(row["unit_price_usd"]) if row["unit_price_usd"] else None
        cost = worst_case_cost_usd(unit, pricing["start_fee_usd"], row["max_results"],
                                   pricing.get("min_charge_usd", 0))
        target = row["target_margin_pct"] or MARGIN_TARGET_DEFAULT
        credits = credits_for(cost, target)
        achieved = achieved_margin_pct(cost, credits)
        ratio = (unit / prev_unit) if (prev_unit and prev_unit > 0) else None

        entry = {
            "name": row["name"], "actor": actor,
            "unit_price_usd": unit, "unit_label": pricing["unit_label"],
            "prev_unit_price_usd": prev_unit, "change_ratio": ratio,
            "cost_per_run_usd": round(cost, 4),
            "credits_now": row["credit_cost"], "credits_next": credits,
            "achieved_margin_pct": achieved,
            "in_band": MARGIN_MIN <= achieved <= MARGIN_MAX,
        }

        if ratio and ratio >= ALARM_RATIO:
            entry["action"] = "deactivated"
            out["deactivated"] += 1
            if not dry_run:
                await pool.execute(
                    "UPDATE public.hub_scraper_catalog SET is_active = FALSE, "
                    "price_checked_at = now() WHERE id = $1", row["id"])
                await _history(pool, row, entry, "deactivated",
                               f"vendor price rose {ratio:.1f}x — needs a human")
            log.error("scraper_pricing: %s rose %.1fx (%.6f -> %.6f) — DEACTIVATED",
                      actor, ratio, prev_unit, unit)
            out["rows"].append(entry)
            continue

        action = ("first_seen" if prev_unit is None
                  else "repriced" if credits != row["credit_cost"] or unit != prev_unit
                  else "unchanged")
        entry["action"] = action
        out[action if action in out else "unchanged"] = out.get(action, 0) + 1

        if not dry_run:
            await pool.execute(
                "UPDATE public.hub_scraper_catalog SET "
                "  unit_price_usd = $2, unit_label = $3, start_fee_usd = $4, "
                "  pricing_model = $5, account_tier = $6, "
                "  cost_per_run = $7, credit_cost = $8, "
                "  price_inr = $9, margin_pct = $10, "
                "  price_checked_at = now(), "
                "  price_changed_at = CASE WHEN $11 THEN now() ELSE price_changed_at END "
                "WHERE id = $1",
                row["id"], unit, pricing["unit_label"], pricing["start_fee_usd"],
                pricing["pricing_model"], pricing["account_tier"],
                round(cost, 4), credits,
                round(credits * CREDIT_PRICE_INR, 2), int(achieved),
                action != "unchanged",
            )
            if action != "unchanged":
                await _history(pool, row, entry, action, None)

        out["rows"].append(entry)

    log.info("scraper_pricing: checked=%(checked)s repriced=%(repriced)s "
             "deactivated=%(deactivated)s unreadable=%(unreadable)s", out)
    return out


async def _history(pool, row, entry: dict, action: str, note: Optional[str]) -> None:
    await pool.execute(
        "INSERT INTO public.hub_scraper_price_history "
        "(scraper_id, apify_actor_id, unit_price_usd, prev_unit_price_usd, "
        " cost_per_run, credit_cost, prev_credit_cost, change_ratio, action, note) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        row["id"], row["apify_actor_id"], entry.get("unit_price_usd"),
        entry.get("prev_unit_price_usd"), entry.get("cost_per_run_usd"),
        entry.get("credits_next"), row["credit_cost"],
        entry.get("change_ratio"), action, note,
    )
