"""Who is on the rolls — one definition, in one place.

WHY THIS MODULE EXISTS
----------------------
`manav_employees.is_active` does not answer "is this person still employed".
It is a FLAG somebody has to remember to clear. `manav_offboarding.last_working_day`
is a FACT somebody already recorded. The two disagree by exactly the people who
have left, and a sweep on 2026-08-26 found **twenty-five** reads across routers,
services and analytics trusting the flag alone.

**AND THE FLAG IS NOT STALE DATA TO BE CLEANED.** `routers/manav.py:1958`
records that offboarding used to set `is_active=FALSE`, and because
`process_payroll` joined on that flag, *"an offboarded employee dropped out of
payroll the same day, so an outstanding salary advance was never recovered."*
So a leaver KEEPS the flag until settlement, deliberately. Live at the time of
writing: of E2E's ten departed-but-flagged employees, two carry outstanding
advances totalling ₹1,15,000, and their exits sit at `initiated`,
`in_clearance`, `completed` and `settled` — a live workflow, not corruption.

The data is right. The READS have to ask the right question, and they have to
ask it the same way, or the answers drift apart the way a headcount tile and a
payroll run already had.

STOCK vs FLOW — the distinction that decides whether to use this
---------------------------------------------------------------
**STOCK** — "who is on the rolls NOW": headcount, directories, department
counts, pickers, seat billing, enrolment queues, coverage denominators,
announcement recipients. These MUST carry the guard.

**FLOW** — "what happened in a PERIOD": payroll cost paid in the months somebody
was employed, historical attendance, past payslips, tenure of people who have
since left. These MUST NOT carry it. Adding the guard to a flow rewrites
history — an ex-employee's July salary was still paid in July.

If you cannot tell which you are looking at, ask whether the number should
change when somebody leaves *today*. A stock changes; a flow does not.

WHY A STRING AND NOT AN ORM PREDICATE
-------------------------------------
Every caller builds SQL by hand with asyncpg bind parameters — that is the
house style, and the alternative here would be to invent a query layer for one
predicate. So this is the fragment, parameterised only by the table alias and
the date expression, and the tests pin its shape rather than its callers'
copies of it.
"""

#: The employee-table alias the fragment is written against, when a caller does
#: not pass one. Most queries in this repo alias `manav_employees` as `e`.
DEFAULT_ALIAS = "e"


def still_on_the_rolls(alias: str = DEFAULT_ALIAS, as_at: str = "CURRENT_DATE") -> str:
    """SQL predicate: this employee has not left as at `as_at`.

    Returns a fragment beginning with `AND`, so it appends to an existing
    WHERE clause without the caller reasoning about spacing.

    `as_at` is interpolated, so it must be a SQL expression the CALLER
    controls — `CURRENT_DATE`, or a bind parameter like `$2::date`. It is
    never user input, and there is no code path here that would let it be:
    the callers are fixed strings in this repository. `alias` is likewise a
    server-side literal, which is the same allowlist rule the sort-key and
    column-name handling in the routers follows.

    THREE THINGS THE PREDICATE HAS TO GET RIGHT, each of which was got wrong
    somewhere before this existed:

    · **`status <> 'cancelled'`** — a resignation that was withdrawn leaves a
      cancelled row behind, and that person never left. Without this they
      vanish from headcount for ever.
    · **`x.org_id = {alias}.org_id`** — `manav_offboarding` has no composite
      (id, org_id) constraint, so an employee-id-only join can read another
      tenant's exit row. `graha_clients` already taught this repository what a
      join on the child id alone reaches.
    · **`<` and not `<=`** — somebody whose last working day IS today was on
      the rolls today. `analytics/metrics/manav.py::_headcount_asat` uses
      `> d` on the mirror-image predicate, which is the same boundary seen
      from the other side; the two agree everywhere except that one day, and
      they agree there too once you read both.

    A NULL `last_working_day` KEEPS SOMEBODY ON THE ROLLS. The column is
    nullable, `NULL < date` is NULL, and `NOT EXISTS` therefore admits them —
    an exit that has been started but not dated is not evidence that a person
    has gone, which is the same rule payroll and auto-mark already follow.
    """
    return (
        f" AND NOT EXISTS ("
        f"SELECT 1 FROM public.manav_offboarding x "
        f"WHERE x.org_id = {alias}.org_id AND x.employee_id = {alias}.id "
        f"AND x.status <> 'cancelled' "
        f"AND x.last_working_day < {as_at})"
    )


def on_the_rolls_where(alias: str = DEFAULT_ALIAS, as_at: str = "CURRENT_DATE") -> str:
    """The whole condition, for a caller starting a fresh WHERE.

    `is_active` is still required — it is what a hand-deactivation means, and
    an employee deactivated with no offboarding row is not on the rolls either.
    The guard narrows that set; it does not replace it.
    """
    return f"{alias}.is_active = TRUE" + still_on_the_rolls(alias, as_at)
