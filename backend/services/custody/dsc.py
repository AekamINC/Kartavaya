"""dsc.py — the read API over `staging.dsc_register` (migration 160).

A practice holds dozens of client DSC tokens. They expire on rolling dates, and
the failure is always the same: it is filing day, the token goes into the USB
port, and the certificate died three weeks ago. Nobody found out earlier because
the only record of the expiry date was on the token itself.

── "EXPIRED" IS ONLY HALF OF IT ─────────────────────────────────────────────
A token handed back to the client in March stops a filing exactly as dead as one
that expired in March, and the firm is exactly as surprised. So every function
here answers through `status_of`, which folds expiry, revocation, a not-yet-live
certificate and CUSTODY into one verdict. A caller cannot check the date and
forget to ask whether the firm actually has the thing. That is the whole design.

── valid_to IS INCLUSIVE. THE WINDOW IS INCLUSIVE AT BOTH ENDS ──────────────
DO NOT COPY THE CONVENTION FROM services/statute.py. `statute_calendar` uses a
HALF-OPEN window where effective_to is the first day a fact is NOT true. This
module is the opposite, because valid_from/valid_to mirror X.509
notBefore/notAfter — inclusive bounds — and because the CA printed "valid till
14/03/2027" on the certificate the operator typed in. Storing or reading that as
exclusive would put every real-world expiry one day out.

    live on `as_of`         <=>  valid_from <= as_of <= valid_to
    expired on `as_of`      <=>  valid_to < as_of
    expiring_within(N)      <=>  as_of <= valid_to <= as_of + N days

`expiring_within(0, as_of=D)` therefore returns the certificates that die TODAY
and nothing else. If either end were exclusive, a certificate expiring on the
boundary day would fall into both buckets or into neither, and "neither" is the
one that silently loses a filing.

The precise guarantee is about the DATE PREDICATES and nothing else: `valid_to
>= as_of` and `valid_to < as_of` are exact complements, so no live row can be
counted twice and none can vanish between the two lists. It is NOT true that the
two functions between them return every row in the table, and the difference
matters to anyone building a dashboard off them: `expiring_within` additionally
drops revoked certificates (they are gone, not expiring), and both drop
soft-deleted ones. A certificate revoked early but still inside its valid_to is
therefore in NEITHER list — by design, and `unusable()` is where it surfaces.
Sum the two for a "renewals due / already dead" split; do not sum them expecting
the size of the register. `register()` is the only complete view.

── `as_of` IS REQUIRED AND HAS NO DEFAULT ──────────────────────────────────
Same rule as services/statute.py and for a sharper reason. A cron that runs at
23:55 IST and defaults to `date.today()` in a UTC container computes yesterday,
and the alert for the certificate that dies at midnight goes out a day late —
which is to say, after it was any use. The caller knows which clock it means.
This module does not, so it refuses to guess.

── ROWS CARRY NAMES, NEVER IDS ─────────────────────────────────────────────
Every row returned carries `client_name` and `holder_name`. `org_id` and
`client_id` are SELECTed (see the tenancy guard below) and then dropped before
the row is handed back, so a router cannot pass one through to a template by
accident. `id` — the certificate's own primary key — IS returned, because a row
you cannot act on is a row you cannot renew; it is not a user, member, org or
client identifier and `frontend/scripts/check-rendered-ids.mjs` is what stops it
reaching a screen.

── WHY THE TENANCY CHECK IS ALSO IN PYTHON ─────────────────────────────────
Every statement here narrows by `org_id` in SQL. `_shape` then asserts that the
row it was handed actually belongs to the org that was asked for, and raises if
it does not. That is not paranoia about PostgreSQL; it is the only way the
cross-org test can prove anything. This suite runs against a MagicMock pool
(tests/conftest.py) — a mock pool hides bad SQL, so a test that stubs the pool
and asserts "the foreign row was not returned" would pass green against a
service whose WHERE clause had been deleted. With the check in Python, deleting
the WHERE clause turns a silent tenancy leak into a loud `CrossOrgLeak`, and the
test asserts the behaviour rather than the fixture.

It raises rather than filtering. A leak is a defect in the query, not a row to
be tidied away; filtering would let a broken statement run in production for
months while quietly doing twice the work.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable, Sequence

from services.audit_actors import actor_joins, actor_select

# ── the columns, listed ──────────────────────────────────────────────────────
#: Listed rather than SELECT *, so that adding a column in 160's successor
#: cannot silently change what callers receive — and so that a column added for
#: internal bookkeeping is not published to every caller by default.
#:
#: `org_id` and `client_id` are in here and are NOT in the returned row. They are
#: read for the tenancy guard in `_shape` and dropped there. See the docstring.
_INTERNAL: tuple[str, ...] = ("org_id", "client_id")

_PUBLIC: tuple[str, ...] = (
    "id",
    "client_name",
    "holder_name", "holder_kind", "holder_designation", "holder_pan",
    "holder_din",
    "certificate_class", "certificate_type", "issuing_authority",
    "serial_number",
    "valid_from", "valid_to", "revoked_on",
    "custody_status", "custody_location", "custody_holder_name",
    "custody_changed_on",
    "token_kind", "token_serial", "registered_portals",
    "notes", "is_active", "created_at", "updated_at",
)

#: Schema-qualified, always. `search_path` on this database is
#: `"$user", public, extensions`, so an unqualified `dsc_register` resolves to
#: nothing at all — and a shadow table in `public` has bitten this repo before
#: (migration 142).
#:
#: THE JOIN IS ORG-SCOPED TOO, and that is not redundant with the WHERE clause.
#: `c.id = d.client_id` alone would happily read a company row belonging to
#: another org if a client_id ever crossed tenants, and the name of another
#: firm's client would be printed on this firm's screen — a leak that no WHERE
#: clause on `d` can catch, because the leaking value is on `c`.
_FROM = (
    " FROM public.dsc_register d "
    " LEFT JOIN public.graha_clients c "
    "        ON c.id = d.client_id AND c.org_id = d.org_id "
)

#: WHO recorded the certificate and WHO last amended it, as NAMES.
#:
#: `created_by` and `updated_by` hold `users.user_id` — the `user_`-prefixed TEXT
#: this codebase writes into every actor column — and that value must never reach
#: a screen. So neither raw column is in `_PUBLIC`: the register publishes the
#: resolved NAMES and the two booleans that separate "nobody is recorded against
#: this row" from "there is an id here and no user row behind it any more".
#: `services/audit_actors` owns that ladder for the whole backend; writing it out
#: here would be the twentieth hand-made copy, and `routers/graha.py:1466` is
#: what the nineteenth looks like when it drifts — it falls back to the EMAIL.
#:
#: IT SITS FIRST IN THE SELECT LIST, not last, because `actor_select` is
#: comma-TERMINATED so that it can be dropped into the middle of a column list.
#: Appending it would leave a dangling comma in front of `FROM` and every read in
#: this module would be a syntax error.
_ACTORS = actor_select("d", updated=True)

#: The joins that resolve them, LEFT so that a certificate recorded by somebody
#: who has since left the firm still appears in the register. An inner join here
#: would make rows VANISH on an employee's last day — data loss that looks like a
#: filter working.
_ACTOR_JOINS = actor_joins("d", updated=True)

_SELECT = (
    "SELECT "
    + _ACTORS
    + ", ".join(f"d.{c}" for c in _INTERNAL)
    + ", "
    + ", ".join(
        "c.name AS client_name" if c == "client_name" else f"d.{c}"
        for c in _PUBLIC
    )
    + _FROM
    + _ACTOR_JOINS
)

#: A deterministic tail on every listing. `valid_to` first because that is what
#: the caller is looking at; `d.id` last because two certificates for the same
#: holder expiring on the same day are real (a signature and an encryption
#: certificate issued together) and an unstable order across pages would show
#: one of them twice and the other never.
_ORDER_SOONEST = " ORDER BY d.valid_to ASC, d.holder_name ASC, d.id ASC"
_ORDER_LATEST = " ORDER BY d.valid_to DESC, d.holder_name ASC, d.id ASC"

# ── statuses ─────────────────────────────────────────────────────────────────
#: A certificate the firm can put in a USB port today and sign with.
USABLE = "usable"
#: Killed by the CA (or by us) before its own expiry date.
REVOKED = "revoked"
#: Past valid_to.
EXPIRED = "expired"
#: Issued, but its validity has not begun. Real: a renewal bought early.
NOT_YET_VALID = "not_yet_valid"
#: Alive, in date, and not in this office. Blocks the filing all the same.
NOT_IN_POSSESSION = "not_in_possession"

#: The one custody state in which the firm can actually use the token today.
#: Everything else in 160's CHECK list — with_client, never_held, in_transit,
#: lost, destroyed, surrendered — means somebody has to go and get it, or it is
#: gone. Written as a whitelist and not as a blacklist on purpose: a custody
#: state added to the migration later defaults to "we cannot use it", which is
#: the safe direction to be wrong in.
_CUSTODY_USABLE = frozenset({"with_firm"})

# ── the CCA's licensed Certifying Authorities ────────────────────────────────
#: Read from https://cca.gov.in/licensed_ca.html on 2026-08-19: 23 licensed CAs.
#: ADVISORY ONLY. This canonicalises the spelling a firm typed; it never rejects
#: one. A CA whose licence lapses does not un-issue the certificates in the
#: drawer, and every one of those keeps working to its own valid_to — so an
#: authority not in this map is stored and returned exactly as typed. Migration
#: 160 deliberately carries no CHECK on the column for the same reason.
_AUTHORITY_CANON: dict[str, str] = {
    "safescrypt": "Safescrypt",
    "sify": "Safescrypt",          # Safescrypt is Sify's CA; firms write either
    "idrbt": "IDRBT",
    "ncode": "(n)Code Solutions",
    "ncodesolutions": "(n)Code Solutions",
    "emudhra": "e-Mudhra",
    "cdac": "CDAC",
    "capricorn": "Capricorn",
    "protean": "Protean",
    "nsdl": "Protean",             # NSDL e-Gov was renamed Protean in 2021
    "vsign": "Vsign",
    "verasys": "Vsign",
    "indianairforce": "Indian Air Force",
    "csc": "CSC",
    "risl": "RISL",
    "rajcomp": "RISL",
    "indianarmy": "Indian Army",
    "idsign": "IDSign",
    "cdslventures": "CDSL Ventures",
    "cdsl": "CDSL Ventures",
    "pantasign": "PantaSign",
    "xtratrust": "XtraTrust",
    "indiannavy": "Indian Navy",
    "prodigisign": "ProDigiSign",
    "signx": "SignX",
    "care4sign": "Care 4 Sign",
    "igcar": "IGCAR",
    "speedsign": "Speed Sign",
    "assamrifles": "Assam Rifles",
}

#: THIS THRESHOLD IS COMMERCIAL PRACTICE, NOT A VERIFIED STATUTORY LIMIT, and
#: it is written down as such because a compliance product that states a rule
#: it cannot source is worse than one that admits the gap. Indian CAs sell
#: one-, two- and three-year certificates and none sells longer, so a span past
#: three years is almost always a mistyped year (2027 entered as 2037). But the
#: three-year ceiling could NOT be confirmed against a primary CCA instrument
#: on 2026-08-19: cca.gov.in/faq.html and cca.gov.in/classes_of_certificates.html
#: are both silent on validity periods, and the X.509 Certificate Policy for
#: India PKI (cca.gov.in/sites/files/pdf/guidelines/CCA-CP.pdf) could not be
#: read to confirm it. Every source that does state "1, 2 or 3 years" is a CA's
#: own marketing page. DO NOT harden this into a rule or cite the CCA for it
#: until someone reads the CP and can quote a clause.
#:
#: That uncertainty costs nothing here precisely BECAUSE it only warns. It is
#: not a constraint and 160 has no CHECK for it — this house does not block data
#: entry on a statutory nicety (see GSTIN/PAN/TAN), and a rejection just gets
#: worked around by typing a date that is wrong in a way nothing notices.
#: 1096 = three years spanning a leap day (1095) plus one day of slack, so a
#: genuine three-year certificate never trips it.
_MAX_PLAUSIBLE_VALIDITY_DAYS = 1096


class CustodyError(ValueError):
    """A malformed request to this module — never an empty register.

    An empty result is a real and expectable answer ("nothing expires this
    month") and is returned as an empty list. A missing `as_of`, a negative
    window or a missing org is a caller bug and must be loud.
    """


class CrossOrgLeak(CustodyError):
    """A row came back that belongs to another org. The SQL is wrong.

    This has never been seen in production and the point is that it would be
    seen, immediately and loudly, rather than being served to a user. See the
    module docstring for why the check lives in Python as well as in the WHERE
    clause.
    """


# ── argument coercion ────────────────────────────────────────────────────────

def _coerce_as_of(as_of: Any) -> date:
    """The one place `as_of` is validated. Raises rather than defaulting.

    `datetime` is checked FIRST because it is a subclass of `date`: the obvious
    `isinstance(as_of, date)` accepts a datetime and then subtracts a plain date
    from it, which raises TypeError a long way from the caller that passed it.
    """
    if isinstance(as_of, datetime):
        return as_of.date()
    if isinstance(as_of, date):
        return as_of
    raise CustodyError(
        "as_of must be a date. There is no default: a cron running at 23:55 IST "
        "in a UTC container would default to yesterday and send every expiry "
        "alert a day late "
        f"(got {type(as_of).__name__!r})."
    )


def _coerce_org(org_id: Any) -> str:
    """Org ids arrive as `uuid.UUID` from asyncpg and as `str` from a JWT."""
    if org_id is None:
        raise CustodyError(
            "org_id is required. Every query in this module is org-scoped and "
            "there is no 'all orgs' mode — a DSC register that spanned tenants "
            "would hand one firm the client names of another."
        )
    # Lower-cased, because the two sources disagree on case and the comparison
    # in `_shape` must not turn that into a phantom tenancy breach: asyncpg
    # returns `uuid.UUID`, whose str() is lower-case, while an org id lifted
    # from a JWT claim or a URL is whatever the caller typed. PostgreSQL parses
    # a uuid literal case-insensitively, so folding here costs nothing in SQL.
    text = str(org_id).strip().lower()
    if not text:
        raise CustodyError("org_id is required and must not be blank.")
    return text


def _coerce_days(days: Any) -> int:
    """A window is a non-negative whole number of days.

    A negative window is rejected rather than clamped. `expiring_within(-30)`
    is somebody reaching for "expired in the last 30 days", and clamping it to 0
    would answer that question with the certificates dying TODAY — a plausible,
    wrong, silent answer. `expired()` is the function they wanted.
    """
    if isinstance(days, bool) or not isinstance(days, int):
        raise CustodyError(f"days must be an int (got {type(days).__name__!r}).")
    if days < 0:
        raise CustodyError(
            "days must be >= 0. A negative window is not 'already expired' — "
            "call expired() for that."
        )
    return days


# ── pure predicates: the whole date/custody policy, in one place ─────────────

def status_of(row: dict, as_of: Any) -> str:
    """The single verdict on one certificate, on one date.

    ORDER MATTERS and it is the order of how dead a thing is:

      1. REVOKED   — a revoked certificate is finished whatever valid_to says.
                     revoked_on is the day the revocation TAKES EFFECT (X.509
                     revocationDate), so the certificate is already dead ON that
                     day, not from the day after.
      2. EXPIRED   — past valid_to, which is the last day it works.
      3. NOT_YET_VALID — a renewal bought in advance. Not an error; it just
                     cannot sign today, and reporting it as "usable" would let a
                     firm plan a filing around a certificate that will refuse.
      4. NOT_IN_POSSESSION — alive and in date, but not in this office. The
                     reason this function exists rather than a date comparison.
      5. USABLE.

    Custody is checked LAST because the other three are facts about the
    certificate and custody is a fact about the token: telling a firm to go and
    fetch a token whose certificate expired in March wastes the trip.
    """
    stamp = _coerce_as_of(as_of)
    revoked = row.get("revoked_on")
    if revoked is not None and revoked <= stamp:
        return REVOKED
    if row["valid_to"] < stamp:
        return EXPIRED
    if row["valid_from"] > stamp:
        return NOT_YET_VALID
    if row.get("custody_status") not in _CUSTODY_USABLE:
        return NOT_IN_POSSESSION
    return USABLE


def days_to_expiry(row: dict, as_of: Any) -> int:
    """Whole days from `as_of` to `valid_to`, inclusive-end.

    0 means "dies today, still works today". Negative means it is already gone
    and by how much. Deliberately NOT clamped at zero: "expired 4 days ago" is
    the sentence someone needs to read.

    This ignores revocation on purpose — it answers a question about the expiry
    date. `status_of` is what tells you the certificate is dead early.
    """
    return (row["valid_to"] - _coerce_as_of(as_of)).days


def canonical_authority(name: Any) -> str | None:
    """Canonical spelling of a Certifying Authority, or the input unchanged.

    'emudhra', 'e-Mudhra', 'E MUDHRA' and 'eMudhra Limited' are one CA and a
    register that sorts them into four groups is a register nobody trusts. An
    unrecognised name is returned stripped but otherwise untouched — see
    `_AUTHORITY_CANON` for why this must never reject.
    """
    if name is None:
        return None
    text = str(name).strip()
    if not text:
        return None
    # Fold to letters and digits only: this is what makes "(n)Code Solutions",
    # "n-Code", "nCode" and "NCODE SOLUTIONS" the same key.
    key = "".join(ch for ch in text.lower() if ch.isalnum())
    if key in _AUTHORITY_CANON:
        return _AUTHORITY_CANON[key]
    # A trailing suffix is the common near-miss: "eMudhra Limited",
    # "Capricorn Identity Services Pvt Ltd". Try the longest known key that the
    # typed name starts with, so that 'cdsl' does not win over 'cdslventures'.
    for known in sorted(_AUTHORITY_CANON, key=len, reverse=True):
        if key.startswith(known):
            return _AUTHORITY_CANON[known]
    return text


def warnings_for(row: dict, as_of: Any) -> list[str]:
    """Advisory flags on one row. Never blocking, ever.

    These are the things a human should look at, not things the database should
    have refused. GSTIN/PAN/TAN are non-mandatory in this product and block
    nothing; a validity span is held to the same standard.
    """
    stamp = _coerce_as_of(as_of)
    out: list[str] = []

    span = (row["valid_to"] - row["valid_from"]).days
    if span > _MAX_PLAUSIBLE_VALIDITY_DAYS:
        # Almost always a mistyped year: 2027 entered as 2037.
        #
        # Worded as an observation about what CAs SELL, not as a statutory
        # rule. See _MAX_PLAUSIBLE_VALIDITY_DAYS: the three-year ceiling is
        # not sourced to a primary CCA instrument, and this string is read by
        # a user who will take anything phrased as "the CCA requires" as law.
        out.append(
            f"validity spans {span} days; no Indian CA sells a certificate "
            "longer than three years, so check the year in valid_to"
        )

    if row.get("revoked_on") is not None and row["revoked_on"] > stamp:
        # A future revocation date is legitimate (a scheduled surrender) but it
        # is rare enough that seeing it stated is worth more than the noise.
        out.append("revocation is dated in the future")

    if row.get("custody_status") == "lost":
        # Not a filing problem — a security one. A lost token whose certificate
        # is still live can sign, and not by us.
        out.append(
            "token recorded as lost while the certificate is still on file; "
            "consider having the CA revoke it"
        )

    if not row.get("serial_number"):
        out.append("no certificate serial recorded")

    return out


# ── row shaping ──────────────────────────────────────────────────────────────

def _shape(record: Any, org_id: str, stamp: date) -> dict:
    """One database record -> one row a caller may hold, with the tenancy guard.

    Two things happen here and both matter:

      * The org on the row is compared with the org that was asked for, and a
        mismatch RAISES. See the module docstring — this is what makes the
        cross-org test meaningful against a mock pool.
      * `org_id` and `client_id` are removed. Not merely "not rendered":
        removed, so that a router which serialises the dict wholesale cannot
        put a uuid on a screen. `client_name` carries the company; the id does
        not leave this module.
    """
    row = dict(record)

    row_org = row.pop("org_id", None)
    if row_org is None or str(row_org).lower() != org_id:
        raise CrossOrgLeak(
            "a dsc_register row came back for a different org than the one "
            "asked for. The WHERE clause is wrong; this row was NOT returned. "
            f"(asked {org_id!r})"
        )
    client_id = row.pop("client_id", None)

    # A certificate with no client is the practice's OWN — a partner's DSC used
    # for the firm's own signing. Stating that explicitly beats leaving a caller
    # to infer it from a null name and print an empty cell.
    #
    # Keyed off client_id and NOT off `client_name is None`, which is the
    # tempting one-liner and is wrong: client_name comes from a LEFT JOIN, so it
    # is also NULL when the join found nothing — and the join is org-scoped, so
    # "nothing" is exactly what a client_id pointing at another tenant produces.
    # Reading the name would relabel that row as one of the firm's own instead
    # of leaving it visibly nameless.
    row["belongs_to_firm"] = client_id is None

    row["status"] = status_of(row, stamp)
    row["days_to_expiry"] = days_to_expiry(row, stamp)
    row["issuing_authority_canonical"] = canonical_authority(
        row.get("issuing_authority")
    )
    row["warnings"] = warnings_for(row, stamp)
    return row


def _shape_all(records: Sequence[Any], org_id: str, stamp: date) -> list[dict]:
    return [_shape(r, org_id, stamp) for r in records]


# ── the read API ─────────────────────────────────────────────────────────────
#
# `pool` may be an asyncpg pool or a connection taken out of one — only `.fetch`
# is used and both answer it.
#
# EVERY parameter expression below is CAST. `$2::date + $3::int` is not
# decoration: PgBouncer turns an untyped parameter expression into a parse error
# that surfaces as an instant 500 with no useful message, and this repo has
# already lost a day to exactly that in the credits spend path.

_Q_EXPIRING = (
    _SELECT
    + " WHERE d.org_id = $1::uuid "
    "   AND d.is_active "
    #  Inclusive at BOTH ends. `>= as_of` keeps a certificate dying today in the
    #  window (it still works today); `<= as_of + days` includes the last day of
    #  the window. See the module docstring for why neither may become strict.
    "   AND d.valid_to >= $2::date "
    "   AND d.valid_to <= ($2::date + $3::int) "
    #  A revoked certificate is not "expiring" — it is already gone, and putting
    #  it in a renewal list tells a firm to renew something the CA has killed.
    #  It still shows up in unusable() and in the per-client view.
    "   AND (d.revoked_on IS NULL OR d.revoked_on > $2::date) "
    + _ORDER_SOONEST
)

_Q_EXPIRED = (
    _SELECT
    + " WHERE d.org_id = $1::uuid "
    "   AND d.is_active "
    #  Strict: valid_to < as_of. A certificate whose valid_to IS as_of is alive
    #  today and belongs to expiring_within(0), not here. The two predicates are
    #  complements across the same column, which is what keeps a boundary-day
    #  certificate in exactly one list.
    "   AND d.valid_to < $2::date "
    + _ORDER_LATEST
)

_Q_UNUSABLE = (
    _SELECT
    + " WHERE d.org_id = $1::uuid "
    "   AND d.is_active "
    "   AND ( d.valid_to < $2::date "
    "      OR d.valid_from > $2::date "
    "      OR (d.revoked_on IS NOT NULL AND d.revoked_on <= $2::date) "
    #  = ANY on a bound array rather than an interpolated IN list. The custody
    #  states are a server-side constant here, but building an IN list by string
    #  concatenation is the habit that eventually meets a value from a request.
    "      OR NOT (d.custody_status = ANY($3::text[])) ) "
    + _ORDER_SOONEST
)

_Q_NOT_IN_POSSESSION = (
    _SELECT
    + " WHERE d.org_id = $1::uuid "
    "   AND d.is_active "
    "   AND NOT (d.custody_status = ANY($3::text[])) "
    #  $2 is bound and unused in the predicate on purpose: `as_of` still shapes
    #  every row (status, days_to_expiry), and $1=org / $2=as_of holds in ALL
    #  SIX statements in this module, which is what stops a future edit from
    #  passing days where a date was expected. $3 is deliberately NOT uniform —
    #  it is text[] here and in _Q_UNUSABLE, uuid in _Q_FOR_CLIENT and bool in
    #  _Q_REGISTER — so read the statement before reordering a fetch() call.
    "   AND $2::date IS NOT NULL "
    + _ORDER_SOONEST
)

_Q_FOR_CLIENT = (
    _SELECT
    + " WHERE d.org_id = $1::uuid "
    #  $3 NULL means the practice's OWN certificates, not "any client". Written
    #  as `IS NOT DISTINCT FROM` and not `= $3` because `client_id = NULL` is
    #  never true, so the obvious form would silently return nothing at all for
    #  the firm's own tokens — a whole category of certificate vanishing with no
    #  error anywhere.
    "   AND d.client_id IS NOT DISTINCT FROM $3::uuid "
    "   AND ($4::bool OR d.is_active) "
    "   AND $2::date IS NOT NULL "
    + _ORDER_SOONEST
)

_Q_REGISTER = (
    _SELECT
    + " WHERE d.org_id = $1::uuid "
    "   AND ($3::bool OR d.is_active) "
    "   AND $2::date IS NOT NULL "
    + _ORDER_SOONEST
)


async def expiring_within(pool, org_id, *, days: int, as_of) -> list[dict]:
    """Certificates whose expiry falls in [as_of, as_of + days], soonest first.

    THE WINDOW IS INCLUSIVE AT BOTH ENDS. `days=0` returns the certificates that
    die today; `days=30, as_of=2026-08-19` includes one expiring on 2026-09-18
    and excludes one expiring on 2026-09-19.

    Already-expired certificates are NOT here — they are `expired()`. Revoked
    ones are not here either: they are not going to expire, they are gone.

    `as_of` is the date the QUESTION is about. For a filing-day check that is
    the filing date, not the date the report is generated.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    window = _coerce_days(days)
    records = await pool.fetch(_Q_EXPIRING, org, stamp, window)
    return _shape_all(records, org, stamp)


async def expired(pool, org_id, *, as_of) -> list[dict]:
    """Certificates already past valid_to on `as_of`, most recent death first.

    Strictly about the expiry date: a certificate revoked early but still inside
    its valid_to is NOT here (its status says `revoked` wherever it appears).
    `unusable()` is the union a filing-day check wants.

    Most recent first because the useful ones are at the top: something that
    died last week is a renewal, something that died in 2021 is a cleanup.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    records = await pool.fetch(_Q_EXPIRED, org, stamp)
    return _shape_all(records, org, stamp)


async def unusable(pool, org_id, *, as_of) -> list[dict]:
    """Everything the firm CANNOT sign with on `as_of`, whatever the reason.

    Expired, revoked, not yet valid, or not in this office. This is the function
    a filing-day check calls, and the reason it exists is that a firm asking
    "can we file for these forty clients on the 30th?" must not have to remember
    that "we gave the token back in March" is also an answer.

    Read `status` on each row for which of the four it is.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    records = await pool.fetch(_Q_UNUSABLE, org, stamp, sorted(_CUSTODY_USABLE))
    return _shape_all(records, org, stamp)


async def not_in_possession(pool, org_id, *, as_of) -> list[dict]:
    """Certificates whose token is not in the firm's hands, whatever its dates.

    "We do not have it" is as blocking as "it expired" and, unlike an expiry, it
    is not written down anywhere today. Includes with_client, never_held,
    in_transit, lost, destroyed and surrendered — read `custody_status` for
    which, because the remedy differs: one is a phone call, one is a police
    report and one means the certificate no longer exists.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    records = await pool.fetch(
        _Q_NOT_IN_POSSESSION, org, stamp, sorted(_CUSTODY_USABLE)
    )
    return _shape_all(records, org, stamp)


async def for_client(
    pool, org_id, client_id, *, as_of, include_inactive: bool = False
) -> list[dict]:
    """Every certificate held for one company, soonest expiry first.

    `client_id=None` MEANS THE PRACTICE'S OWN CERTIFICATES — the partners' DSCs
    a CA firm holds for its own signing — and not "all clients". `register()` is
    the everything view. This is stated three times in this file because the
    other reading is the natural one and it is wrong.

    `include_inactive=True` brings back retired rows, which is what a client
    detail page wants: "we used to hold three of theirs" is a question clients
    ask, and a soft-deleted row is history, not an error.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    target = None if client_id is None else str(client_id)
    records = await pool.fetch(
        _Q_FOR_CLIENT, org, stamp, target, bool(include_inactive)
    )
    return _shape_all(records, org, stamp)


async def register(
    pool, org_id, *, as_of, include_inactive: bool = False
) -> list[dict]:
    """The whole register for one org, soonest expiry first.

    The list view. Every row carries `status`, `days_to_expiry` and `warnings`,
    so a caller renders the register and the alerts from one query rather than
    running four and reconciling them.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    records = await pool.fetch(_Q_REGISTER, org, stamp, bool(include_inactive))
    return _shape_all(records, org, stamp)


def summarise(rows: Iterable[dict]) -> dict[str, int]:
    """Count shaped rows by `status`. Every status key is present, even at zero.

    Zero-filled on purpose: a dashboard that renders only the keys it was given
    shows nothing at all where "0 expired" is the reassuring thing the reader
    came for, and an absent key is indistinguishable from a query that failed.
    """
    counts = {
        USABLE: 0,
        NOT_IN_POSSESSION: 0,
        NOT_YET_VALID: 0,
        EXPIRED: 0,
        REVOKED: 0,
    }
    for row in rows:
        key = row.get("status")
        if key in counts:
            counts[key] += 1
    counts["total"] = sum(counts[k] for k in list(counts) if k != "total")
    return counts


# ══════════════════════════════════════════════════════════════════════════════
#  THE WRITE PATH
#
#  Added 2026-08-21. Until then this module was read-only and
#  `staging.dsc_register` held 0 rows, because nothing in the product could put
#  one there — a register with no writer is a compliance claim a firm cannot
#  actually make.
#
#  ── WHICH OF THE FIVE STATUSES A PERSON MAY SET: NONE OF THEM ───────────────
#
#  `status_of` returns one of five verdicts and every one of them is COMPUTED,
#  on a date, from stored facts. None is a column and none may be sent in:
#
#    usable             the residual. It is what is left when the other four do
#                       not apply, so there is nothing to set — you record the
#                       dates and the custody, and `usable` is what those mean.
#    expired            valid_to < as_of. Pure arithmetic on a date the CA
#                       printed on the certificate. Reachable only by being
#                       wrong about valid_to.
#    not_yet_valid      valid_from > as_of. The same arithmetic from the other
#                       side — a renewal bought early. It becomes usable on its
#                       own, at midnight, with nobody pressing anything.
#    revoked            revoked_on <= as_of. DERIVED, but from a fact a person
#                       genuinely records — so the FACT is recordable and the
#                       STATUS is not. `record_revocation` writes the date.
#    not_in_possession  custody_status is not `with_firm`. Same shape: the fact
#                       is recordable, through `record_custody_move`, and the
#                       status is not.
#
#  So the refusal is not a formality. Two of the five have a lever and three do
#  not, and a caller that sends `status` has almost certainly reached for one of
#  those two — `refuse_derived_status` says which lever to pull instead, in a
#  sentence, rather than answering 422 with a field name.
#
#  ── WHAT A WRITE MAY NOT DO ─────────────────────────────────────────────────
#
#   * It never deletes. `is_active` is not a parameter of anything here; a row
#     recorded is a row kept, and the reads already carry `include_inactive`.
#   * It never overwrites `notes`. A reason given with a revocation or a custody
#     move is APPENDED, in SQL, so two people recording two facts about one
#     certificate cannot lose each other's sentence.
#   * It never revokes at creation time. A certificate is recorded as held and
#     revoked by `record_revocation`, which is one audited call with one date
#     and one reason. `revoked_on` passed to `record_certificate` is refused.
#
#  ── AND WHAT IT DELIBERATELY DOES NOT REFUSE ────────────────────────────────
#
#  An implausible validity span, an unrecognised Certifying Authority, a
#  missing PAN, DIN or serial. Every one of those is a warning on the returned
#  row and none of them blocks. That is this house's standing rule — GSTIN, PAN
#  and TAN are non-mandatory and block nothing, and it has been "fixed" back
#  more than once. A rejection here gets worked around by typing a date that is
#  wrong in a way nothing notices.
# ══════════════════════════════════════════════════════════════════════════════

#: The vocabularies, mirroring the CHECK constraints as they stand on the LIVE
#: server (read from `pg_constraint` on 2026-08-21, not from the migration file
#: — an inline CHECK on ADD COLUMN IF NOT EXISTS is skipped entirely when the
#: column already exists, so a migration is not evidence of what is enforced).
#:
#: Checked here rather than left to the database because a CheckViolation
#: arrives as an asyncpg error that a router turns into a 500 with no useful
#: message, and every one of these is a thing a person chose and can change.
HOLDER_KINDS: tuple[str, ...] = ("individual", "organisation", "unknown")

CERTIFICATE_CLASSES: tuple[str, ...] = (
    "class_1", "class_2", "class_3",
    "aadhaar_ekyc_otp", "aadhaar_ekyc_biometric", "unknown",
)

CERTIFICATE_TYPES: tuple[str, ...] = (
    "signature", "encryption", "combined", "document_signer", "dgft", "unknown",
)

CUSTODY_STATES: tuple[str, ...] = (
    "with_firm", "with_client", "never_held",
    "in_transit", "lost", "destroyed", "surrendered",
)

TOKEN_KINDS: tuple[str, ...] = ("usb_token", "hsm", "software", "unknown")

#: Every verdict `status_of` can return. Named so a caller can see the whole set
#: it is being refused, and so `refuse_derived_status` cannot fall out of step
#: with `status_of` without a test noticing.
DERIVED_STATUSES: tuple[str, ...] = (
    USABLE, NOT_IN_POSSESSION, NOT_YET_VALID, EXPIRED, REVOKED,
)

#: What to do INSTEAD, per status. A bare "status is not settable" leaves the
#: person who wanted to record a revocation with nowhere to go, and the two
#: statuses that DO have a lever are exactly the two somebody reaches for.
_STATUS_LEVER: dict[str, str] = {
    USABLE: (
        "'usable' is the residual verdict — it is what a certificate is when it "
        "is in date, not revoked and in this office. Record those three facts "
        "and it follows."
    ),
    EXPIRED: (
        "'expired' is valid_to being in the past. It is arithmetic on the date "
        "the CA printed on the certificate, and it arrives on its own."
    ),
    NOT_YET_VALID: (
        "'not_yet_valid' is valid_from being in the future — a renewal bought "
        "early. It becomes usable at midnight on valid_from with nobody "
        "pressing anything."
    ),
    REVOKED: (
        "To record a revocation, call record_revocation with the date the "
        "revocation takes effect. The status then follows from that date."
    ),
    NOT_IN_POSSESSION: (
        "To record that the firm no longer holds the token, call "
        "record_custody_move with where it went. The status then follows from "
        "the custody state."
    ),
}


def refuse_derived_status(value: Any) -> None:
    """Raise if a caller tried to SET a status. Silent when `value` is absent.

    Every one of the five is computed by `status_of` from a date or from the
    custody state, on the date the question is asked. A stored copy would be
    wrong from midnight until whatever job got round to flipping it — which is
    precisely the morning somebody is looking at it.
    """
    if value is None:
        return
    text = str(value).strip().lower()
    if not text:
        return
    lever = _STATUS_LEVER.get(text)
    if lever is None:
        raise CustodyError(
            f"{value!r} is not a certificate status at all. The five are "
            f"{list(DERIVED_STATUSES)}, and none of them is settable: each is "
            "computed from the dates and the custody state on the day it is "
            "asked about."
        )
    raise CustodyError(f"status is not a column and cannot be set. {lever}")


# ── coercion for the write path ──────────────────────────────────────────────

def _required_text(value: Any, *, field: str, limit: int = 512) -> str:
    """A non-blank string, trimmed. `''` and `'   '` are refused alike.

    NOT NULL does not catch a blank, and the register's whole value is that a
    human can read a name off it — `dsc_register_holder_name_present` says the
    same thing in the database and this says it in a sentence first.
    """
    text = "" if value is None else str(value).strip()
    if not text:
        raise CustodyError(f"{field} is required and must not be blank.")
    if len(text) > limit:
        raise CustodyError(f"{field} is longer than {limit} characters.")
    return text


def _optional_text(value: Any, *, field: str, limit: int = 512) -> str | None:
    """A trimmed string, or None.

    `''` becomes None so that an empty form field never reaches a `::date` or
    `::uuid` cast as an empty string — which is an instant PgBouncer 500 rather
    than a null.
    """
    text = "" if value is None else str(value).strip()
    if not text:
        return None
    if len(text) > limit:
        raise CustodyError(f"{field} is longer than {limit} characters.")
    return text


def _choice(value: Any, allowed: tuple[str, ...], *, field: str,
            default: str) -> str:
    text = "" if value is None else str(value).strip().lower()
    if not text:
        return default
    if text not in allowed:
        raise CustodyError(
            f"{field} must be one of {list(allowed)} (got {value!r})."
        )
    return text


def _required_date(value: Any, *, field: str) -> date:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise CustodyError(f"{field} is required.")
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError as exc:
        raise CustodyError(f"{field} is not an ISO date: {value!r}") from exc


def _optional_date(value: Any, *, field: str) -> date | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return _required_date(value, field=field)


def _portals(value: Any) -> list[str]:
    """The portals a certificate is registered on. Free-form, deduplicated.

    Free-form on purpose — portals appear and merge faster than a CHECK can be
    maintained, and migration 160 carries none. Deduplicated and lower-cased so
    that 'MCA' and 'mca' do not become two facts about one token.
    """
    if value is None:
        return []
    if isinstance(value, str):
        parts = [p for p in value.replace(",", " ").split() if p]
    else:
        try:
            parts = [str(p) for p in value]
        except TypeError as exc:
            raise CustodyError(
                "registered_portals must be a list of names or a "
                "comma-separated string."
            ) from exc
    out: list[str] = []
    for part in parts:
        text = part.strip().lower()
        if text and text not in out:
            out.append(text)
    if len(out) > 32:
        raise CustodyError("registered_portals holds more than 32 entries.")
    return out


def _note_line(text: Any, *, on: date, what: str) -> str:
    """One dated sentence to APPEND to `notes`. Empty when there is nothing to say.

    Dated, because `notes` is a running log the moment two people write in it,
    and an undated line in a running log is a line nobody can place.
    """
    body = "" if text is None else str(text).strip()
    if not body:
        return ""
    return f"[{on.isoformat()}] {what}: {body}"


# ── the statements ───────────────────────────────────────────────────────────
#
# NOT NAMED `_Q_*`. That prefix belongs to the read API, and
# `tests/test_dsc_register.py` asserts that every `_Q_*` statement carries
# `d.org_id = $1::uuid` — true of every read, and not the shape an INSERT's
# tenancy proof takes. These carry their own assertions in
# `tests/test_custody_writes.py`.
#
# EVERY PARAMETER IS CAST, as everywhere else in this module. `$2::uuid` and
# not `$2`: PgBouncer turns an untyped parameter expression into a parse error
# that surfaces as an instant 500 with no useful message, and an empty string
# arriving at a `::date` or `::uuid` cast does the same — which is why
# `_optional_text` and `_optional_date` return None and never `''`.

#: The real columns of the table, in the order the write path returns them.
#: Built from the same two tuples the read API publishes, so a column added to
#: `_PUBLIC` is returned by a write on the day it is returned by a read.
#:
#: The two actor columns are in the RETURNING list and NOT in `_PUBLIC`, which
#: is the whole trick: the CTE has to carry the raw ids forward so the joins
#: below can resolve them, and `_SELECT_WRITTEN` names its columns explicitly, so
#: the ids stop at the CTE boundary and never reach the caller. Without them the
#: joins would be over columns that do not exist on `written` and every write in
#: this module would fail at parse time.
_ACTOR_COLUMNS: tuple[str, ...] = ("created_by", "updated_by")

_WRITE_RETURNING = ", ".join(
    _INTERNAL + tuple(c for c in _PUBLIC if c != "client_name") + _ACTOR_COLUMNS
)

#: The read shape, over a CTE instead of over the table.
#:
#: A plain `RETURNING` cannot produce `client_name` — the name is on
#: `graha_clients` and RETURNING sees only the row it wrote. A second statement
#: that re-read the row would be a second round trip AND a second place for the
#: tenancy predicate to be forgotten. So the INSERT/UPDATE feeds a CTE and the
#: join happens over that.
#:
#: THE JOIN IS ORG-SCOPED HERE TOO, for the reason `_FROM` gives: `c.id =
#: d.client_id` alone would read another firm's company row if a client_id ever
#: crossed tenants, and print that firm's client name on this one's screen.
_SELECT_WRITTEN = (
    "SELECT "
    + _ACTORS
    + ", ".join(f"d.{c}" for c in _INTERNAL)
    + ", "
    + ", ".join(
        "c.name AS client_name" if c == "client_name" else f"d.{c}"
        for c in _PUBLIC
    )
    + " FROM written d "
    " LEFT JOIN public.graha_clients c "
    "        ON c.id = d.client_id AND c.org_id = d.org_id "
    + _ACTOR_JOINS
)

#: THE TENANCY PROOF IS THE `WHERE`, and it is why this is an INSERT … SELECT
#: rather than an INSERT … VALUES. `offboarding.record_custody` in this package
#: uses the same shape for the same reason: the statement itself proves that the
#: client being attached belongs to the org doing the attaching, so there is no
#: window between a check and a write in which the answer could change.
#:
#: `$2::uuid IS NULL` is the practice's OWN certificate — a partner's DSC held
#: for the firm's own signing — and NOT "any client". That reading is wrong and
#: `for_client` warns about it three times; here it is a branch of the WHERE, so
#: an omitted client cannot silently become an unscoped one.
#:
#: No row comes back when the client belongs to another org. The caller gets
#: None and a refusal, and learns nothing about whether that client exists
#: somewhere else.
_INSERT_CERTIFICATE = (
    "WITH written AS ( "
    "  INSERT INTO public.dsc_register "
    "    (org_id, client_id, holder_name, holder_kind, holder_designation, "
    "     holder_pan, holder_din, certificate_class, certificate_type, "
    "     issuing_authority, serial_number, valid_from, valid_to, "
    "     custody_status, custody_location, custody_holder_name, "
    "     custody_changed_on, token_kind, token_serial, registered_portals, "
    "     notes, created_by) "
    "  SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text, "
    "         $6::text, $7::text, $8::text, $9::text, "
    "         $10::text, $11::text, $12::date, $13::date, "
    "         $14::text, $15::text, $16::text, "
    "         $17::date, $18::text, $19::text, $20::text[], "
    "         $21::text, $22::text "
    "   WHERE $2::uuid IS NULL "
    "      OR EXISTS (SELECT 1 FROM public.graha_clients c "
    "                  WHERE c.id = $2::uuid AND c.org_id = $1::uuid) "
    "  RETURNING " + _WRITE_RETURNING + " ) "
    + _SELECT_WRITTEN
)

#: One row, by id, inside one org. Read before an UPDATE so that a refusal can
#: say WHICH thing is wrong — "already revoked on 12 March" rather than a bare
#: "nothing was changed", which is all a missed `UPDATE … WHERE` can offer.
_FETCH_ONE = (
    "SELECT " + ", ".join(f"d.{c}" for c in _INTERNAL)
    + ", " + ", ".join(f"d.{c}" for c in _PUBLIC if c != "client_name")
    + " FROM public.dsc_register d "
    " WHERE d.org_id = $1::uuid AND d.id = $2::uuid"
)

#: `d.revoked_on IS NULL` is in the WHERE and not only in Python. The Python
#: check is what produces the sentence; this is what makes two people pressing
#: the button at once write one revocation date rather than the later one
#: silently replacing the earlier.
#:
#: `notes` is CONCATENATED, never replaced. `concat_ws` drops the NULL side, so
#: a first note lands alone and a second lands under it; `chr(10)` rather than
#: an escape-string literal because it is immutable, obvious, and cannot be
#: mangled by a driver that treats backslashes differently.
#:
#: `updated_by` IS SET IN THE SAME STATEMENT that sets everything else.
#: `trg_touch_dsc_register` already stamps `updated_at`, and it cannot stamp this
#: one: a trigger does not know who is holding the connection. Leaving it to the
#: trigger would give the register a column that says a certificate changed and
#: no column that says who changed it — which on a revocation is the entire
#: question. Bound as `$5::text`, never interpolated, and cast because PgBouncer
#: turns an untyped parameter into a parse error and an instant 500.
_UPDATE_REVOCATION = (
    "WITH written AS ( "
    "  UPDATE public.dsc_register d "
    "     SET revoked_on = $3::date, "
    "         updated_by = $5::text, "
    "         notes = CASE WHEN $4::text = '' THEN d.notes "
    "                      ELSE concat_ws(chr(10), "
    "                                     NULLIF(btrim(coalesce(d.notes, '')), ''), "
    "                                     $4::text) END "
    "   WHERE d.org_id = $1::uuid "
    "     AND d.id = $2::uuid "
    "     AND d.revoked_on IS NULL "
    "  RETURNING " + _WRITE_RETURNING + " ) "
    + _SELECT_WRITTEN
)

#: A custody move REPLACES the location and the holder, and that is correct:
#: they say where the token is NOW, and a token that has gone back to the client
#: is not in Cabinet 2 any more. The narrative of the move goes into `notes`,
#: which is appended and never replaced, so nothing is lost.
#:
#: `updated_by` here for the reason `_UPDATE_REVOCATION` gives at length: a
#: token reported lost is the row an audit is read for, and "who wrote that down"
#: is not a question the `updated_at` timestamp can answer.
_UPDATE_CUSTODY = (
    "WITH written AS ( "
    "  UPDATE public.dsc_register d "
    "     SET custody_status = $3::text, "
    "         updated_by = $8::text, "
    "         custody_location = $4::text, "
    "         custody_holder_name = $5::text, "
    "         custody_changed_on = $6::date, "
    "         notes = CASE WHEN $7::text = '' THEN d.notes "
    "                      ELSE concat_ws(chr(10), "
    "                                     NULLIF(btrim(coalesce(d.notes, '')), ''), "
    "                                     $7::text) END "
    "   WHERE d.org_id = $1::uuid "
    "     AND d.id = $2::uuid "
    "  RETURNING " + _WRITE_RETURNING + " ) "
    + _SELECT_WRITTEN
)

#: The company list behind every create form in this package.
#:
#: WHY IT LIVES IN THIS MODULE. `notice_register.client_id` is NOT NULL, so a
#: notice cannot be filed without one, and a register of client tokens with no
#: client is not much of a register either. The obvious home is
#: `routers/graha.py`'s `/clients`, and that route is gated on holding CRM,
#: Finance or Sales — so a practice that bought HR and nothing else could read
#: its own DSC register and not the names in it. This returns NAMES AND NOTHING
#: ELSE, org-scoped, active only, and the router puts it behind the same Manav
#: editor bar as the writes it feeds.
_SELECT_CLIENT_OPTIONS = (
    "SELECT c.id, c.name "
    "  FROM public.graha_clients c "
    " WHERE c.org_id = $1::uuid "
    "   AND c.is_active "
    " ORDER BY c.name ASC "
    " LIMIT $2::int"
)


# ── the write API ────────────────────────────────────────────────────────────

async def record_certificate(
    pool,
    org_id,
    *,
    as_of,
    holder_name,
    valid_from,
    valid_to,
    client_id=None,
    holder_kind: str = "individual",
    holder_designation=None,
    holder_pan=None,
    holder_din=None,
    certificate_class: str = "class_3",
    certificate_type: str = "signature",
    issuing_authority=None,
    serial_number=None,
    custody_status: str = "with_firm",
    custody_location=None,
    custody_holder_name=None,
    custody_changed_on=None,
    token_kind: str = "usb_token",
    token_serial=None,
    registered_portals=None,
    notes=None,
    created_by=None,
    status=None,
    revoked_on=None,
) -> dict | None:
    """Record one certificate the practice holds. Returns the shaped row.

    `client_id=None` MEANS THE PRACTICE'S OWN CERTIFICATE — a partner's DSC held
    for the firm's own signing — exactly as it does in `for_client`. It does not
    mean "we have not decided yet"; there is no such state, and leaving the
    column null to express one would put the row in the partners' list.

    `as_of` is the date the write is being made on and it comes from the SERVER,
    never from a request. It is used for two things and nothing else: to shape
    the returned row, so the caller sees the status its own write produced, and
    as the default `custody_changed_on`. It cannot move the certificate's dates.

    RETURNS None when `client_id` names a company that is not this org's. That
    is a refusal and not "already exists"; a caller must not read it as one.

    Raises `CustodyError` for anything a person can fix: a blank holder, a
    transposed pair of dates, a vocabulary value that is not in the CHECK, or an
    attempt to set `status` or `revoked_on`. It does NOT raise for an
    implausible validity span, an unknown Certifying Authority, or a missing
    PAN, DIN or serial — all four come back as `warnings` on the row, because
    this house does not block data entry on a statutory nicety and a rejection
    just gets worked around by typing something wrong in a way nothing notices.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)

    # Refused BEFORE anything else is validated, so a caller who sent a status
    # gets the sentence about the status rather than a complaint about some
    # other field they got right.
    refuse_derived_status(status)
    if revoked_on is not None:
        raise CustodyError(
            "A certificate is not recorded as already revoked. Record it as "
            "held, then call record_revocation with the date the revocation "
            "takes effect — that is one audited event with one date and one "
            "reason, and it is what the register is read for."
        )

    holder = _required_text(holder_name, field="holder_name", limit=256)
    starts = _required_date(valid_from, field="valid_from")
    ends = _required_date(valid_to, field="valid_to")
    if ends < starts:
        # `dsc_register_validity_order` says the same in the database. A one-day
        # certificate IS legitimate — a re-issue on the day of expiry — so the
        # comparison is `<` and not `<=`.
        raise CustodyError(
            f"valid_to ({ends.isoformat()}) is before valid_from "
            f"({starts.isoformat()}). That is almost always a transposed pair "
            "of dates, and every query downstream would be quietly wrong."
        )

    kind = _choice(holder_kind, HOLDER_KINDS, field="holder_kind",
                   default="individual")
    klass = _choice(certificate_class, CERTIFICATE_CLASSES,
                    field="certificate_class", default="class_3")
    ctype = _choice(certificate_type, CERTIFICATE_TYPES,
                    field="certificate_type", default="signature")
    custody = _choice(custody_status, CUSTODY_STATES, field="custody_status",
                      default="with_firm")
    token = _choice(token_kind, TOKEN_KINDS, field="token_kind",
                    default="usb_token")

    moved = _optional_date(custody_changed_on, field="custody_changed_on")
    if moved is None:
        # The current custody state began today unless the caller knows better.
        # Without it, `with_client` is undated and nobody can tell a token
        # returned last week from one returned in 2023 — which is the complaint
        # migration 160 records against the column being absent at all.
        moved = stamp

    record = await pool.fetchrow(
        _INSERT_CERTIFICATE,
        org,
        _optional_text(client_id, field="client_id", limit=64),
        holder,
        kind,
        _optional_text(holder_designation, field="holder_designation",
                       limit=128),
        # NON-MANDATORY AND UNVALIDATED, both of them. The income-tax portal
        # binds a DSC to a PAN and MCA binds it to a DIN, so the columns exist;
        # a format check on either would be the GSTIN/PAN/TAN rule regressing
        # for the third time.
        _optional_text(holder_pan, field="holder_pan", limit=32),
        _optional_text(holder_din, field="holder_din", limit=32),
        klass,
        ctype,
        _optional_text(issuing_authority, field="issuing_authority", limit=128),
        _optional_text(serial_number, field="serial_number", limit=128),
        starts,
        ends,
        custody,
        _optional_text(custody_location, field="custody_location", limit=256),
        _optional_text(custody_holder_name, field="custody_holder_name",
                       limit=256),
        moved,
        token,
        _optional_text(token_serial, field="token_serial", limit=128),
        _portals(registered_portals),
        _optional_text(notes, field="notes", limit=4000),
        _optional_text(created_by, field="created_by", limit=128),
    )
    if record is None:
        return None
    return _shape(record, org, stamp)


async def record_revocation(
    pool,
    org_id,
    certificate_id,
    *,
    as_of,
    revoked_on,
    reason=None,
    actor_id=None,
) -> dict | None:
    """Record that a certificate was killed before its own expiry date.

    `actor_id` is the `users.user_id` of whoever is recording this, and it is
    written into `updated_by` by the same UPDATE that writes the date. It is
    accepted rather than derived because this module never sees a request: the
    router holds the login and passes it down. Migration 097's rule is that a
    function which ACCEPTS an actor and drops it is worse than one that does not
    accept one — the caller believes the answer is being recorded.

    `revoked_on` is the day the revocation TAKES EFFECT — X.509 revocationDate
    — so the certificate is dead ON that day and not from the day after.
    `status_of` reads it that way and this writes it that way.

    A DATE IN THE FUTURE IS ALLOWED. A scheduled surrender is a real thing a
    practice arranges, and `warnings_for` already flags a future revocation on
    the row so it is seen rather than refused. A date before `valid_from` is not
    allowed — `dsc_register_revoked_after_issue` refuses it in the database and
    this refuses it in a sentence first.

    ALREADY REVOKED IS A REFUSAL, NOT AN UPDATE. A revocation is an event with a
    date; a second one arriving with a different date would silently replace the
    first, and the register would then hold an answer with no way to tell which
    of the two it is. `reason` is appended to `notes`, never written over them.

    Returns None when the certificate is not this org's. Raises `CustodyError`
    when it is and the request cannot be honoured.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    target = _required_text(certificate_id, field="certificate_id", limit=64)
    effective = _required_date(revoked_on, field="revoked_on")

    existing = await pool.fetchrow(_FETCH_ONE, org, target)
    if existing is None:
        return None
    row = dict(existing)
    row_org = row.get("org_id")
    if row_org is None or str(row_org).lower() != org:
        raise CrossOrgLeak(
            "a dsc_register row came back for a different org than the one "
            f"asked for. The WHERE clause is wrong. (asked {org!r})"
        )

    if row.get("revoked_on") is not None:
        raise CustodyError(
            "This certificate is already recorded as revoked on "
            f"{row['revoked_on'].isoformat()}. A revocation is an event with a "
            "date, and a second one would replace the first — nothing was "
            "changed. Add a note if the recorded date is wrong."
        )
    if effective < row["valid_from"]:
        raise CustodyError(
            f"A revocation dated {effective.isoformat()} precedes the "
            f"certificate's own start date ({row['valid_from'].isoformat()}). "
            "That is usually a transposed pair of dates."
        )

    written = await pool.fetchrow(
        _UPDATE_REVOCATION,
        org,
        target,
        effective,
        _note_line(reason, on=stamp, what="Revoked"),
        # $5. Same trimming and same ceiling as `created_by` on the insert, so a
        # row's creator and its last editor cannot be stored in two shapes and
        # fail to join against the same `users` row.
        _optional_text(actor_id, field="actor_id", limit=128),
    )
    if written is None:
        # The pre-check said it was revocable and the UPDATE found nothing, so
        # somebody revoked it in between. Loud rather than silent: the caller
        # believes it wrote a date and it did not.
        raise CustodyError(
            "The certificate was revoked by somebody else while this "
            "revocation was being recorded. Nothing was changed; re-read the "
            "row before recording anything against it."
        )
    return _shape(written, org, stamp)


async def record_custody_move(
    pool,
    org_id,
    certificate_id,
    *,
    as_of,
    custody_status,
    custody_location=None,
    custody_holder_name=None,
    changed_on=None,
    note=None,
    actor_id=None,
) -> dict | None:
    """Record where the physical token is now. The other half of "expired".

    `actor_id` lands in `updated_by` in the same UPDATE — see
    `record_revocation` for why it is a parameter and not something this module
    could work out for itself.

    "We handed that token back in March" stops a filing exactly as dead as an
    expiry, and until this function there was nowhere to write it down. The
    seven states are migration 160's, and they are seven rather than a boolean
    because the remedy differs: `with_client` is a phone call, `lost` is a
    security incident, `destroyed` means the token no longer exists.

    `changed_on` is when the CURRENT state began and defaults to `as_of`. It may
    not be in the future — a token cannot move tomorrow, and a future date makes
    the register unable to say how long the firm has been without it.

    `custody_location` and `custody_holder_name` are REPLACED, not appended, and
    that is right: they say where the token is NOW. Passing neither clears both.
    The narrative goes in `note`, which is appended to `notes`.
    """
    org = _coerce_org(org_id)
    stamp = _coerce_as_of(as_of)
    target = _required_text(certificate_id, field="certificate_id", limit=64)
    state = _choice(custody_status, CUSTODY_STATES, field="custody_status",
                    default="")
    if not state:
        raise CustodyError(
            "custody_status is required — this call exists to record where the "
            f"token went. One of {list(CUSTODY_STATES)}."
        )

    moved = _optional_date(changed_on, field="changed_on") or stamp
    if moved > stamp:
        raise CustodyError(
            f"custody_changed_on ({moved.isoformat()}) is in the future. A "
            "token cannot have moved tomorrow, and a future date makes the "
            "register unable to say how long the firm has been without it."
        )

    written = await pool.fetchrow(
        _UPDATE_CUSTODY,
        org,
        target,
        state,
        _optional_text(custody_location, field="custody_location", limit=256),
        _optional_text(custody_holder_name, field="custody_holder_name",
                       limit=256),
        moved,
        _note_line(note, on=stamp, what=f"Custody → {state}"),
        # $8.
        _optional_text(actor_id, field="actor_id", limit=128),
    )
    if written is None:
        return None
    return _shape(written, org, stamp)


async def client_options(pool, org_id, *, limit: int = 500) -> list[dict]:
    """The companies this org may attach a register row to. Names and ids only.

    Feeds the client picker on every create form in this package. It is here
    rather than behind `routers/graha.py`'s `/clients` because that route is
    gated on holding CRM, Finance or Sales, and a practice that bought HR alone
    would otherwise be able to read its own DSC register but not the names in it.

    `id` is returned because a picker has to send something back, and a company
    id is not a user, member or org identifier. `frontend/scripts/
    check-rendered-ids.mjs` is the ratchet that keeps it out of a rendered
    position; nothing else about the company crosses the wire.
    """
    org = _coerce_org(org_id)
    if limit < 1:
        raise CustodyError(f"limit must be at least 1, got {limit}")
    records = await pool.fetch(_SELECT_CLIENT_OPTIONS, org, int(limit))
    return [
        {"id": str(dict(r)["id"]), "name": dict(r).get("name") or ""}
        for r in (records or [])
    ]
