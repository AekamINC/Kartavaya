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
    " FROM staging.dsc_register d "
    " LEFT JOIN staging.graha_clients c "
    "        ON c.id = d.client_id AND c.org_id = d.org_id "
)

_SELECT = (
    "SELECT "
    + ", ".join(f"d.{c}" for c in _INTERNAL)
    + ", "
    + ", ".join(
        "c.name AS client_name" if c == "client_name" else f"d.{c}"
        for c in _PUBLIC
    )
    + _FROM
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
