"""
lead_triage — which new leads are worth calling first.

── Do not rank on lead_score ──────────────────────────────────────────────────

`graha_contacts.lead_score` exists and is **0 for every contact in the
database** — there is exactly one distinct value across all rows.
`compute_lead_score` (`backend/routers/graha.py:1683-1690`) short-circuits to
`0, []` when `staging.graha_scoring_rules` is empty, and that table has zero
rows in every org. So a triage skill sorted on `lead_score` would return leads
in arbitrary order while looking authoritative.

It is still read and still the SECOND sort key, so the moment somebody seeds
scoring rules this skill starts using them without a code change. First key is
derived open pipeline value, which discriminates today: of Aekam's two leads,
one carries ₹7,50,000 of open deals and the other zero.

`assigned_to` and `last_contacted_at` are NULL on 100% of live contacts. They
are REPORTED — "nobody owns this lead" is exactly what a triage list should say
— but never ranked on, because a column that is always null sorts everything
equally and hides that fact.
"""
import logging

log = logging.getLogger(__name__)


async def triage_new_leads(pool, org_id: str, days: int = 30, limit: int = 200) -> dict:
    """Recent leads with the signal that exists, best first.

    Age is a DATE subtraction in SQL rather than Python datetime maths — it stays
    correct past 30 days and cannot reintroduce the naive/aware TypeError that
    has now bitten this codebase twice.

    Returns {period_days, leads: [...], caveat?}.
    """
    rows = await pool.fetch(
        """
        SELECT c.id, c.name, c.company, c.email, c.phone, c.source, c.designation,
               c.lead_score, c.assigned_to, c.last_contacted_at, c.created_at,
               (NOW()::date - c.created_at::date)  AS age_days,
               COALESCE(dl.n_deals, 0)             AS deal_count,
               COALESCE(dl.pipeline_value, 0)      AS pipeline_value,
               COALESCE(ac.n_act, 0)               AS activity_count,
               COALESCE(fu.n_open_fu, 0)           AS open_follow_ups
        FROM public.graha_contacts c
        LEFT JOIN LATERAL (
            SELECT count(*) AS n_deals, COALESCE(sum(d.value),0) AS pipeline_value
            FROM public.graha_deals d
            WHERE d.contact_id = c.id AND d.org_id = c.org_id
              AND d.is_active = TRUE AND d.won_at IS NULL AND d.lost_at IS NULL
        ) dl ON TRUE
        LEFT JOIN LATERAL (
            SELECT count(*) AS n_act FROM public.graha_activities a
            WHERE a.contact_id = c.id AND a.org_id = c.org_id
        ) ac ON TRUE
        LEFT JOIN LATERAL (
            SELECT count(*) AS n_open_fu FROM public.graha_follow_ups f
            WHERE f.contact_id = c.id AND f.org_id = c.org_id
              AND f.is_completed IS NOT TRUE
        ) fu ON TRUE
        WHERE c.org_id = $1::uuid
          AND c.is_active = TRUE
          AND c.merged_into_id IS NULL
          AND c.contact_type = 'lead'
          AND c.created_at > NOW() - ($2::int || ' days')::interval
        ORDER BY pipeline_value DESC, c.lead_score DESC, c.created_at DESC
        LIMIT $3
        """,
        org_id, days, limit,
    )

    leads = [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "company": r["company"],
            "email": r["email"],
            "phone": r["phone"],
            "source": r["source"],
            "age_days": r["age_days"],
            "deal_count": r["deal_count"],
            # Decimal off the wire; JSON does not carry it.
            "pipeline_value": float(r["pipeline_value"] or 0),
            "activity_count": r["activity_count"],
            "open_follow_ups": r["open_follow_ups"],
            "owner": r["assigned_to"],
            "last_contacted": r["last_contacted_at"].isoformat() if r["last_contacted_at"] else None,
        }
        for r in rows
    ]

    out = {"period_days": days, "leads": leads}
    if leads and all(l["owner"] is None for l in leads):
        out["caveat"] = (
            "No lead in this list has an owner assigned. Ranking is by open "
            "pipeline value; the stored lead score is 0 for every contact because "
            "no scoring rules have been configured, so it has not been used."
        )
    return out
