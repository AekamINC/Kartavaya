import logging

log = logging.getLogger(__name__)


async def score_candidate(pool, candidate: dict) -> dict:
    """Score a candidate's fit for a job opening.

    *candidate*: {name, experience_years, skills: [], education, job_opening_id, org_id}

    Returns {fit_score (0-100), factors: [str]}.
    """
    org_id = candidate.get("org_id")
    opening_id = candidate.get("job_opening_id")
    factors = []
    score = 50  # base

    # Fetch job opening requirements
    opening = None
    if opening_id and org_id:
        opening = await pool.fetchrow(
            """
            SELECT title, department, description, requirements
            FROM staging.manav_job_openings
            WHERE id = $1::uuid AND org_id = $2::uuid AND is_active = true
            """,
            opening_id, org_id,
        )

    exp = candidate.get("experience_years", 0)
    skills = [s.lower() for s in (candidate.get("skills") or [])]

    # Experience scoring
    if exp >= 5:
        score += 20
        factors.append("strong_experience")
    elif exp >= 2:
        score += 10
        factors.append("adequate_experience")
    else:
        score -= 5
        factors.append("limited_experience")

    # Skill match against opening requirements
    if opening and opening["requirements"]:
        req_text = opening["requirements"].lower()
        matched = [s for s in skills if s in req_text]
        if matched:
            bonus = min(len(matched) * 8, 30)
            score += bonus
            factors.append(f"skill_match_{len(matched)}")
        else:
            factors.append("no_skill_overlap")

    # Education
    edu = (candidate.get("education") or "").lower()
    if any(k in edu for k in ("mba", "masters", "m.tech", "phd")):
        score += 5
        factors.append("advanced_degree")

    score = max(0, min(100, score))

    return {"fit_score": score, "factors": factors}
