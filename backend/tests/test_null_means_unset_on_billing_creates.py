"""An empty box on a create form is `null`, and `null` must mean "not provided".

── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────

Every create form on the client-billing screens sends `field: form.field || null`
— the ordinary JavaScript spelling of "the box is empty". The create models gave
those fields a plain default (`notes: str = ""`, `rate: float = 0`), and Pydantic
refuses `None` against `str`. So an empty box was a **422**.

⚠ **`POST /v1/ganit/billing/rate-cards` refused EVERY rate card that had no
note.** Found by proposal 93 Suite 05 on 2026-08-29: rate cards stood at **0 of
3** while every other Ganit volume filled, and because the screen only ever said
"Failed to save", the person typing had no way to learn that the empty Notes box
was the cause. Both halves were fixed — the refusal here, and the unreadable
message in `frontend/src/lib/apiError.js`.

It was never one field. Across the four create/update pairs in `client_billing`,
**eighteen** fields are nullable on update and were not on create. Blank accepted
when you EDIT a row and refused when you CREATE one is not a rule anybody could
guess, and widening eighteen annotations by hand leaves the nineteenth — which
is why the fix is a shared base class and this file tests the CONTRACT rather
than the eighteen.

── WHAT MUST STAY TRUE ─────────────────────────────────────────────────────

A required field is still required. "Not provided" is a genuine error for
`vendor_id` or `period`, and silently inventing a value would be far worse than
the 422 this replaces.

A field annotated `X | None` still accepts `None` AS A VALUE. `effective_from`
is nullable on purpose — "this rate card has no start date" is a real answer,
and coercing it to a default would erase a deliberate clear.
"""
import pytest
from pydantic import ValidationError

from routers.client_billing import (
    MeteredUsageCreate,
    ProfileCreate,
    RateCardCreate,
    ServiceLineCreate,
    SLACreditCreate,
)

#: `ServiceLineCreate` needs both of its required fields spelled out.
_SL = {"profile_id": "p1", "period_start": "2026-08-01"}

#: Every create model on these screens, with the arguments that make it valid,
#: and one optional field whose default must survive an explicit `null`.
CASES = [
    (RateCardCreate, {"vendor_id": "v1"}, "notes", ""),
    (RateCardCreate, {"vendor_id": "v1"}, "item_category", ""),
    (RateCardCreate, {"vendor_id": "v1"}, "rate", 0),
    (RateCardCreate, {"vendor_id": "v1"}, "proration_clause", False),
    (ServiceLineCreate, _SL, "description", ""),
    (ServiceLineCreate, _SL, "amount", 0),
    (MeteredUsageCreate, {"profile_id": "p1"}, "metric", ""),
    (MeteredUsageCreate, {"profile_id": "p1"}, "quantity", 0),
    (ProfileCreate, {"client_id": "c1"}, "currency", "INR"),
    (ProfileCreate, {"client_id": "c1"}, "payment_terms_days", 30),
    (SLACreditCreate, {"vendor_id": "v1", "period": "2026-08"}, "sla_metric", ""),
]


@pytest.mark.parametrize("model,required,field,default", CASES)
def test_an_explicit_null_falls_back_to_the_default(model, required, field, default):
    got = getattr(model(**required, **{field: None}), field)
    assert got == default, (
        f"{model.__name__}.{field}=None gave {got!r}, not the default {default!r}. "
        f"An empty box on the form sends null, and this is what refused every "
        f"rate card that had no note with an opaque 422."
    )


@pytest.mark.parametrize("model,required,field,default", CASES)
def test_omitting_the_field_entirely_still_gives_the_same_default(model, required, field, default):
    """`null` and absent must agree, or the two spellings mean different things."""
    assert getattr(model(**required), field) == default


def test_a_value_that_was_actually_typed_is_never_replaced():
    assert RateCardCreate(vendor_id="v1", notes="see annexure 4").notes == "see annexure 4"
    assert RateCardCreate(vendor_id="v1", rate=1500.0).rate == 1500.0
    # Falsy is not absent. A rate of zero is a rate somebody chose.
    assert RateCardCreate(vendor_id="v1", notes="").notes == ""
    assert RateCardCreate(vendor_id="v1", proration_clause=False).proration_clause is False


@pytest.mark.parametrize("field", ["effective_from", "effective_to"])
def test_a_nullable_field_still_accepts_null_as_a_value(field):
    """`X | None` means None is an answer, not an absence."""
    assert getattr(RateCardCreate(vendor_id="v1", **{field: None}), field) is None


@pytest.mark.parametrize("model,kwargs,missing", [
    (RateCardCreate, {"vendor_id": None}, "vendor_id"),
    (SLACreditCreate, {"vendor_id": "v1", "period": None}, "period"),
    (ServiceLineCreate, {"profile_id": None, "period_start": "2026-08-01"}, "profile_id"),
])
def test_a_required_field_is_still_refused(model, kwargs, missing):
    """Silently inventing a vendor would be far worse than the 422 it replaces."""
    with pytest.raises(ValidationError) as exc:
        model(**kwargs)
    assert missing in str(exc.value)


def test_the_rule_reaches_every_create_model_in_the_file():
    """A new create model must inherit it too — this is the nineteenth field.

    Widening annotations by hand is what let eighteen of them drift apart in the
    first place, so the ratchet is on the BASE CLASS rather than on any list of
    field names.
    """
    import inspect

    import routers.client_billing as cb
    from routers.client_billing import _NullMeansUnset

    missed = [
        name for name, obj in vars(cb).items()
        if inspect.isclass(obj) and name.endswith("Create")
        and not issubclass(obj, _NullMeansUnset)
    ]
    assert not missed, (
        f"{missed} do not inherit _NullMeansUnset, so an empty box on their form "
        f"is a 422 the person cannot read. Every *Create model in this router "
        f"takes it."
    )
