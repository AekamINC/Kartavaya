"""The GST state codelist, and the one function that makes two spellings meet.

── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────

It used to live in `services/skills/data/client_register.py` as `_GST_STATES`
and `_norm_state` — underscore-private members of a module about the CLIENT
REGISTER. By 2026-08-26 four production modules outside that package were
importing them:

    routers/vetana.py                          professional tax by state
    routers/manav.py                           employee work state
    routers/client_billing.py                  place of supply
    services/skills/action/attendance_auto_mark.py   regional holidays

A leading underscore is the author's promise that a name may change shape
freely. Four callers had quietly turned that promise into a lie, and the
coupling was load-bearing in the worst way: rename `_norm_state`, or narrow
what it accepts, and the client-register tests stay green while PROFESSIONAL
TAX SILENTLY COMPUTES ZERO for every employee in the product — because the
employee's state stops matching a slab and the fallback for "no slab" is 0.
A failure that pays the wrong amount and reports nothing.

So the codelist moved here, where it is public, owned, and about one thing.
`client_register.py` imports it back under its old private names, so nothing
inside that module changed.

── WHY IT IS IN CODE AND NOT IN A TABLE ─────────────────────────────────────

There is no state table anywhere in this database — checked across `staging`
and `public`. It is a CODELIST, not a dated statutory fact like a rate or a due
day, so it does not belong in `statute_calendar` either.

IT IS NOT TIMELESS THOUGH, and that is stated on the output: 25 (Daman & Diu)
was merged into 26 on 26 January 2020, and 28 (undivided Andhra Pradesh) died
with the 2014 bifurcation. Both are kept so an OLD GSTIN still resolves to a
readable name instead of falling into "unknown"; both are flagged retired. 26
is carried as 'DN' because `manav_holidays_state_ck` allows at most three
characters and its real abbreviation is five.
"""

#: GST state codes to a short alphabetic code and a name.
GST_STATES: dict[str, tuple[str, str]] = {
    "01": ("JK", "Jammu and Kashmir"),   "02": ("HP", "Himachal Pradesh"),
    "03": ("PB", "Punjab"),              "04": ("CH", "Chandigarh"),
    "05": ("UK", "Uttarakhand"),         "06": ("HR", "Haryana"),
    "07": ("DL", "Delhi"),               "08": ("RJ", "Rajasthan"),
    "09": ("UP", "Uttar Pradesh"),       "10": ("BR", "Bihar"),
    "11": ("SK", "Sikkim"),              "12": ("AR", "Arunachal Pradesh"),
    "13": ("NL", "Nagaland"),            "14": ("MN", "Manipur"),
    "15": ("MZ", "Mizoram"),             "16": ("TR", "Tripura"),
    "17": ("ML", "Meghalaya"),           "18": ("AS", "Assam"),
    "19": ("WB", "West Bengal"),         "20": ("JH", "Jharkhand"),
    "21": ("OD", "Odisha"),              "22": ("CG", "Chhattisgarh"),
    "23": ("MP", "Madhya Pradesh"),      "24": ("GJ", "Gujarat"),
    "25": ("DD", "Daman and Diu"),
    "26": ("DN", "Dadra and Nagar Haveli and Daman and Diu"),
    "27": ("MH", "Maharashtra"),
    "28": ("AP", "Andhra Pradesh (undivided)"),
    "29": ("KA", "Karnataka"),           "30": ("GA", "Goa"),
    "31": ("LD", "Lakshadweep"),         "32": ("KL", "Kerala"),
    "33": ("TN", "Tamil Nadu"),          "34": ("PY", "Puducherry"),
    "35": ("AN", "Andaman and Nicobar Islands"),
    "36": ("TG", "Telangana"),           "37": ("AD", "Andhra Pradesh"),
    "38": ("LA", "Ladakh"),
    "97": ("OT", "Other Territory"),     "99": ("CE", "Centre Jurisdiction"),
}

#: Codes that no longer appear on a new registration. Resolved, then flagged.
RETIRED_STATE_CODES: frozenset[str] = frozenset({"25", "28"})

ALPHA_TO_NUM = {alpha: num for num, (alpha, _n) in GST_STATES.items()}
NAME_TO_NUM = {name.lower(): num for num, (_a, name) in GST_STATES.items()}


def norm_state(value) -> str | None:
    """'27', 27, 'MH', 'mh', 'Maharashtra' -> '27'. Anything else -> None.

    ONE canonical form, because this database holds two incompatible ones:
    `organisations.state_code` and `pay_professional_tax.state_code` are
    numeric, while migration 175's `manav_holidays.state_code` and
    `client_obligations.state_code` carry a CHECK that REFUSES a numeric code.
    Comparing them without normalising would silently never match, and a send
    guard that never matches is a send guard that never guards.

    Returning None for an unrecognised value is deliberate and every caller
    depends on it: None means "nobody has said", which is not the same as "a
    state that matches nobody". Callers err towards including the row.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        code = text.zfill(2)
        return code if code in GST_STATES else None
    upper = text.upper()
    if upper in ALPHA_TO_NUM:
        return ALPHA_TO_NUM[upper]
    return NAME_TO_NUM.get(text.lower())


def state_view(code: str | None) -> dict:
    """A state as it is shown to a reader: never a bare code on its own."""
    if not code:
        return {"state_code": None, "state_alpha": None, "state_name": None,
                "state_is_retired": False}
    alpha, name = GST_STATES[code]
    return {"state_code": code, "state_alpha": alpha, "state_name": name,
            "state_is_retired": code in RETIRED_STATE_CODES}
