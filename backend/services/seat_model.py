"""
seat_model.py — the ATTENDANCE half of the seat model.

The owner settled the shape on 2026-08-04: an organisation buys TWO kinds of
seat and they are counted SEPARATELY.

    ORG SEATS      a person who signs in and uses the product.
                   Counted by `routers/org_invites.count_seats`, which already
                   existed and which every writer that can put a person into an
                   org calls. NOTHING IN THIS FILE TOUCHES IT.

    PAHCHAN SEATS  a person who is on the attendance roster and nothing more.
                   Counted here. This half did not exist at all.

The rule that makes the split worth having, in the owner's own example: a firm
with 8 office staff and 200 site workers pays for 8 org seats and 200 attendance
seats, NOT 208 of one kind. A site worker who only ever clocks in must not cost
what a full user costs, or the product prices itself out of every firm that has
more hands than desks — which in this market is most of them.

── WHAT HOLDS AN ATTENDANCE SEAT ────────────────────────────────────────────

An ACTIVE row in `staging.manav_employees`, in an organisation that has the
`pahchan` module active. That is the attendance roster; there is no second,
narrower list of "people admitted to attendance" to count instead, and inventing
one would mean the number billed and the number of people who can actually clock
in are maintained by different code.

Two candidates were considered and rejected, both for the same reason — they
count USE rather than ENTITLEMENT, so the bill would move on its own:

  · `staging.pahchan_org_usage` (a live VIEW: distinct employees who punched in
    the last 30 days). A worker on leave for five weeks would fall out of the
    count and back in, and an org would pay less in a slow month than it does in
    a busy one for the same roster. That is a usage metric and it is a perfectly
    good one — it is just not a seat.
  · `staging.pahchan_enrollment_photos`. Measured: ZERO rows across all three
    live orgs, while 67 employees have punched. Face matching is parked to v2
    (see `routers/pahchan.py`), so an enrolment photo is evidence of a workflow
    nobody is required to complete. Counting it would bill every org zero.

INACTIVE EMPLOYEES ARE NOT COUNTED. `is_active`, specifically, and not
`status`: `routers/pahchan._employee_for` filters punching on `is_active=TRUE`,
so `is_active` is already the column that decides who can clock in. A seat count
that used `status` would bill for people the product refuses to let punch.

NEITHER ARE PEOPLE WHO HAVE LEFT — and that is a SECOND condition, not the same
one. `is_active` is a flag somebody must remember to clear, and a leaver KEEPS it
deliberately until settlement so an outstanding salary advance can still be
recovered from their final payroll run (`routers/manav.py:1958`). The FACT is
`manav_offboarding.last_working_day`, and `services/on_the_rolls.py` is the one
place that reads it. Measured read-only on 2026-08-26: E2E Test & Associates
returned a roster of 83 against 73 people still on the rolls — ten people whose
last working day was up to seven weeks past. Unicode Group was 26 either way.

NOBODY IS INVOICED OFF THIS, and saying otherwise would be a worse error than
the one being fixed. `count_pahchan_seats` has exactly one consumer,
`routers/subscription.py:1485`, a read-only usage endpoint; there is no payment
gateway in this product at all; and `routers/manav.py:1310` records that the
seat gate "refuses NOBODY today" because no organisation has
`max_pahchan_seats` set and a NULL allowance is unlimited. So the ten were an
overstated USAGE figure on a screen, not ten seats anybody paid for. The fix is
worth making because the number is wrong and is the number a limit would one day
be enforced against — not because money moved.

The two conditions bill differently and both are needed: an employee
hand-deactivated with no offboarding row holds no seat (the flag catches them),
and an employee whose exit is recorded but whose flag is still set for settlement
holds no seat either (the guard catches them).

── WHO IS EXEMPT ────────────────────────────────────────────────────────────

An employee whose record is LINKED (`manav_employees.user_id`) to an account
that holds an org role in THIS organisation. The owner: "Somebody who is both an
employee and a user is one org seat, not one of each."

The exemption is deliberately keyed on the link and not on a matching email
address. An address that happens to appear in both tables is a coincidence the
billing count must not act on; `POST /manav/employees/{id}/link` is a deliberate,
audited act with a refusal of its own, and migration 101 makes the database
enforce one login per record per org. That is a fact worth billing on. A string
comparison is not.

── MEASURED, READ-ONLY, ON THE LIVE DATABASE 2026-08-06 ─────────────────────

    org                          org users   roster   exempt   max_users
    Aekam Inc                            9        2        0        NULL
    E2E Test & Associates [TEST]         6       71        0        NULL
    Unicode Group                        5        7        0          15

THE EXEMPT COLUMN IS ZERO EVERYWHERE, and not because the rule is wrong — because
`manav_employees.user_id` was NULL on all 81 employee rows when this was
written; live 2026-08-27 it is 109 rows with 14 linked (E2E 12 of 83, Unicode
2 of 26), so the join now resolves for fourteen people and not for 95. The
linking endpoints shipped, nobody has used them yet, and migration 101 records
the same measurement from the other side. So the exemption is correct, wired, and
currently vacuous. It stops being vacuous the first time HR links anyone, which
is why it is built now rather than when the first double-counted invoice appears.

── THE GAP THIS FILE CANNOT CLOSE, STATED PLAINLY ───────────────────────────

Counting is not the whole model. TODAY A SITE WORKER WHO CLOCKS IN NECESSARILY
HOLDS AN ORG SEAT, and no arithmetic here changes that:

    `middleware/org_resolver.get_org_id` resolves a request's organisation ONLY
    through `staging.user_roles` with `role_code IN ('org_owner','org_admin',
    'org_member')` — which is exactly `org_invites.SEAT_ROLES`. `pahchan.punch`
    depends on `get_org_id`. So to clock in, a worker must hold one of the three
    roles that `count_seats` counts.

The 8+200 firm is therefore charged 208 org seats by the code as it stands, which
is the precise outcome the owner's decision forbids. Closing it needs an
attendance-only role that the resolver accepts and `SEAT_ROLES` excludes, and
both of those live in `middleware/`, which this change was scoped out of. The
count in this file is the half that can be built without touching the resolver,
and it is the half that has to exist first — a seat you cannot count is a seat
you cannot stop charging for. THE REMAINING WORK IS A ROLE, NOT A NUMBER.

── COMPUTED, NEVER STORED ───────────────────────────────────────────────────

There is no seat-count column and no counter to increment. A stored count drifts
the first time somebody is removed by a path that does not maintain it — and this
product has already had five seat counters that disagreed (see the long note in
`org_invites`). The count is derived from the rows that define it, every time it
is asked for. It costs one query.
"""
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

# The same three role codes `org_invites.SEAT_ROLES` is built from, taken from
# the shared source rather than from the router. Importing `SEAT_ROLES` itself
# would make `services` depend on `routers`, and `org_invites` imports
# `auth_router`, which imports half the app — a cycle waiting for the first
# module that wants both.
from middleware.role_tiers import SEAT_CONSUMING_ORG_ROLES
from services.on_the_rolls import still_on_the_rolls

#: Roles whose holder is a USER of the product, and therefore already paid for
#: under the org-seat count. An employee linked to one of these is exempt here.
#:
#: `SEAT_CONSUMING_ORG_ROLES` and not `ORG_ROLES`: the exemption's whole premise
#: is "this person is ALREADY billed as an org seat", so it has to be the same
#: set `org_invites.SEAT_ROLES` bills. `hr_admin` joins it — an HR administrator
#: who is also on the roster is one org seat, not one of each, which is exactly
#: the owner's sentence this file was written from. The two project-only roles
#: stay out: they cost no org seat, so a site worker holding one would be exempt
#: from the attendance seat while being billed for nothing at all — the roster
#: would go free.
ORG_SEAT_ROLES: tuple[str, ...] = SEAT_CONSUMING_ORG_ROLES

#: 409, matching `org_invites.SEAT_LIMIT_STATUS` exactly. The caller is permitted
#: to add an employee; the organisation has simply run out of attendance seats.
#: Two seat limits that answer with different status codes is how a frontend ends
#: up with two error paths for one condition.
PAHCHAN_SEAT_LIMIT_STATUS = 409


@dataclass(frozen=True)
class PahchanSeatCount:
    """What an org's attendance allowance is, and what is standing in it."""

    #: None means UNLIMITED, matching `max_users` and for the same reason: no
    #: org has ever had an attendance cap set, so collapsing NULL to zero would
    #: lock every existing customer out of hiring their next worker the moment
    #: this shipped. A cap applies when Aekam types one in, and not before.
    limit: Optional[int]

    #: Active employees. Everyone on the attendance roster, exempt or not.
    roster: int

    #: Of those, the ones linked to an account holding an org role here.
    exempt: int

    #: Whether the org has the `pahchan` module active. A firm running Manav for
    #: payroll and not running attendance at all has a roster but no attendance
    #: seats, and must never be refused a hire over a cap on a module it does not
    #: use.
    module_active: bool = True

    @property
    def used(self) -> int:
        """Roster minus the people already paid for as org users.

        Clamped at zero. `exempt` is counted over the same population as
        `roster` — `is_active=TRUE` AND still on the rolls, both conditions on
        both subqueries — so it cannot exceed it. But a negative seat count is
        the kind of number that reaches an invoice as a credit, and the clamp
        costs nothing to state.
        """
        if not self.module_active:
            return 0
        return max(self.roster - self.exempt, 0)

    @property
    def is_full(self) -> bool:
        """At or past the allowance.

        `>=`, not `>`: `used` is what is already standing in the allowance, so an
        org with 15 used and 15 bought has no room for a sixteenth. An org with
        no cap set is never full, and an org that does not run attendance is
        never full.
        """
        if self.limit is None or not self.module_active:
            return False
        return self.used >= self.limit


def pahchan_seat_detail(seats: PahchanSeatCount) -> str:
    """The ONE refusal sentence for the attendance cap.

    Written out here rather than at the call site, for the reason
    `org_invites.seat_limit_detail` exists: five writers each wrote their own
    version of the org-seat refusal and gave customers three different
    instructions for one condition.

    It names both halves of the count on purpose. "You are using all 200 of your
    attendance seats" invites the reply "but we only have 190 people" from an org
    whose other ten are linked users — so the exempt figure is stated, because
    the number that surprises somebody is the number they will ring up about.
    """
    exempt_clause = (
        f", and {seats.exempt} more on the roster are org users and cost no "
        "attendance seat"
        if seats.exempt
        else ""
    )
    return (
        f"This organisation is using all {seats.limit} of its attendance seats — "
        f"{seats.used} of {seats.roster} employees on the roster hold one"
        f"{exempt_clause}. Free a seat by offboarding an employee, or ask Aekam "
        "to raise max_pahchan_seats on the organisation."
    )


# ── The query ────────────────────────────────────────────────────────────────
#
# One statement, so the four figures cannot be read at four different instants
# and disagree with each other.
#
# `to_jsonb(o) ->> 'max_pahchan_seats'` RATHER THAN `o.max_pahchan_seats`, and
# this is scaffolding with a removal date rather than a style choice. Migration
# 109 adds that column and IS NOT APPLIED — staging and production share one
# database, so applying it is a production change made by hand. A plain column
# reference would therefore 500 every employee-create in the product between this
# code deploying and 109 being run, which is a self-inflicted outage for a
# feature nobody has switched on yet.
#
# `to_jsonb` on a row yields NULL for a key that is not there instead of raising
# `UndefinedColumn`, and NULL is already this file's word for "no cap set" — so
# the pre-migration behaviour is exactly the post-migration behaviour of an org
# Aekam has not given a cap to. Verified read-only against the live database on
# 2026-08-06, before 109: all three orgs returned NULL rather than an error.
#
# ONCE 109 IS APPLIED EVERYWHERE, replace it with `o.max_pahchan_seats`. It is
# one row and one column, so the cost is irrelevant; what is not irrelevant is
# that a JSON round-trip hides a typo in the column name — spell it wrong and
# this reads NULL forever and silently charges nobody, which is the failure mode
# a seat limit is least able to notice about itself.
#
# BOTH employee subqueries carry `still_on_the_rolls`, and they have to. `used`
# is `roster - exempt` and its docstring rests on exempt being counted over the
# same population as roster; guarding one side only breaks that invariant, and
# the direction it breaks in is overcharging.
_SEAT_QUERY = f"""
SELECT
    (to_jsonb(o) ->> 'max_pahchan_seats')::int AS seat_limit,
    (SELECT COUNT(*) FROM public.manav_employees e
      WHERE e.org_id = o.id AND e.is_active = TRUE
        {still_on_the_rolls("e")}) AS roster,
    (SELECT COUNT(*) FROM public.manav_employees e
      WHERE e.org_id = o.id AND e.is_active = TRUE AND e.user_id IS NOT NULL
        {still_on_the_rolls("e")}
        AND EXISTS (SELECT 1 FROM public.user_roles ur
                     WHERE ur.org_id = o.id AND ur.user_id = e.user_id
                       AND ur.role_code = ANY($2::text[]))) AS exempt,
    EXISTS (SELECT 1 FROM public.module_subscriptions ms
             WHERE ms.org_id = o.id AND ms.module_code = 'pahchan'
               AND ms.is_active = TRUE) AS module_active
FROM public.organisations o
WHERE o.id = $1::uuid
"""


async def count_pahchan_seats(pool, org_id: str) -> PahchanSeatCount:
    """Attendance seats bought, attendance seats standing."""
    row = await pool.fetchrow(_SEAT_QUERY, org_id, list(ORG_SEAT_ROLES))
    if not row:
        # No such organisation. Answer with an empty, uncapped count rather than
        # raising: every caller here is on a path that has already resolved the
        # org through `get_org_id`, so a miss means the org was deleted between
        # two queries of the same request, and a seat counter is the wrong place
        # to be the one reporting that.
        return PahchanSeatCount(limit=None, roster=0, exempt=0, module_active=False)
    return PahchanSeatCount(
        limit=row["seat_limit"],
        roster=row["roster"] or 0,
        exempt=row["exempt"] or 0,
        module_active=bool(row["module_active"]),
    )


async def assert_pahchan_seat_available(pool, org_id: str) -> None:
    """Refuse to put one more person on the attendance roster once it is full.

    ── WHERE THIS IS CALLED, AND WHY IT IS ONLY ONE PLACE ───────────────────

    `POST /api/v1/manav/employees` and nowhere else, because creating an active
    employee row is the ONLY way a person joins the attendance roster. Checked
    rather than assumed: no endpoint in `routers/manav.py` sets `is_active` back
    to TRUE on an existing employee — `deactivate_employee` sets it FALSE, and
    the PATCH body (`EmployeeUpdate`) has no `is_active` field, so a terminated
    employee cannot be revived into a seat. One admission, one gate.

    ── FOUR PLACES THIS DELIBERATELY DOES *NOT* GUARD ──────────────────────

      · CANCELLING AN OFFBOARDING. Since the count reads
        `manav_offboarding.last_working_day`, a resignation withdrawn — status
        moved to 'cancelled' — puts somebody back on the rolls without any
        employee row being created, so it can push an org past its cap without
        passing this gate. It is not refused, for the same reason unlinking is
        not: a withdrawn resignation is a person who never left, and refusing to
        record that fact would leave the roster asserting an exit that did not
        happen. The count is honest about the overage instead.

      · `DELETE /employees/{id}/link`. Unlinking removes an exemption, so it can
        genuinely push an org past its cap — and it is still not refused here.
        Unlinking is the correction for a link made against the WRONG RECORD and
        the only way to move an account between records, so an admin who links
        the wrong person while at the cap would be trapped with no way back. The
        count is honest about the overage instead: `used` may exceed `limit`,
        and the next hire is refused until it is resolved. A cap that traps
        somebody in a mistake gets switched off, and then it protects nothing.

      · `POST /pahchan/enrollment`. Enrolling a face belongs to an employee who
        already exists, and who therefore already holds the seat this counts. A
        refusal there could never fire, and a guard that cannot fire is a guard
        somebody later reads as proof the path is covered.

      · The org-seat writers. They call `org_invites.assert_seat_available` and
        must keep calling only that. The two counts are separate by the owner's
        decision, and a person who is both is exempt HERE — the exemption is
        applied in one direction only, which is what stops it becoming a way to
        be counted twice or not at all.
    """
    seats = await count_pahchan_seats(pool, org_id)
    if seats.is_full:
        raise HTTPException(PAHCHAN_SEAT_LIMIT_STATUS, pahchan_seat_detail(seats))
