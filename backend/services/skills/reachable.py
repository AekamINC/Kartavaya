"""Attach a way to reach the person, and a way to open the record.

A finding that names somebody and stops there tells a reader there is work and
withholds the work — which is what the owner saw when a skill reported an
overdue chase and left him to go and look up who to ring.

Three rules live here rather than in twenty-four handlers, so they cannot drift
apart:

  · An empty string is not a contact. `manav_employees.phone` is non-NULL on
    every row and blank on eleven of them; `''` rendered as a phone number is
    worse than an absent one, because it looks answered.
  · A link needs an id, never a name. The seed org has two employees called
    Aadhya Nair — a name is not a key, and a link built from one opens the
    wrong record eventually.
  · The id goes into the href and NOWHERE else. `people_checks.py` already
    carried the rule in a comment — "a member UUID must not appear in any
    output" — and a bare `employee_id` beside the name is exactly the thing
    `check-rendered-ids` exists to stop. An unroutable kind therefore gets no
    link rather than a naked id.
  · The key names are fixed: `email`, `phone`, `link`. The dock renderer reads
    these three and nothing else, so a handler that invents `contact_no` gets
    silently dropped.

`link` is a frontend route, not an API path — it is written into the UI and
followed by a click.
"""

# Route per kind of record. Kept together so a changed route is changed once.
_ROUTES = {
    "employee": "/manav/employees/%s",
    "candidate": "/manav/candidates/%s",
    "client":    "/graha/clients/%s",
    "contact":   "/graha/contacts/%s",
    "lead":      "/graha/leads/%s",
    "vendor":    "/ganit/vendors/%s",
    "invoice":   "/vikray/invoices/%s",
    "bill":      "/ganit/bills/%s",
    "task":      "/projects/tasks/%s",
    "project":   "/projects/%s",
    "quotation": "/vikray/quotations/%s",
    "order":     "/vikray/orders/%s",
    "agreement": "/sign/documents/%s",
    "payslip":   "/vetana/payslips/%s",
}


def reachable(out: dict, *, kind: str = None, entity_id=None,
              email=None, phone=None) -> dict:
    """Add `email`, `phone` and `link` to *out* where each is really present.

    Mutates and returns *out* so it can wrap a dict literal at the call site.
    Every argument is optional: a row that has a phone and no email gets the
    phone, and a row with neither is returned unchanged rather than carrying
    three empty keys that read as "looked, found nothing".
    """
    for value, key in ((email, "email"), (phone, "phone")):
        text = str(value).strip() if value is not None else ""
        if text and text.lower() != "none":
            out[key] = text

    if entity_id is not None:
        route = _ROUTES.get(kind)
        text = str(entity_id).strip()
        if route and text:
            out["link"] = route % text
    return out
