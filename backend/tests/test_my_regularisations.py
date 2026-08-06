"""An employee may see their own correction requests — and only their own.

`GET /regularisations` is the REVIEWER's queue: it lists every employee's
requests and is gated on require_org_role('org_owner','org_admin'). Correctly
so. But that left an employee no way to learn the outcome of their own request,
and the mobile register said as much: "This app cannot show you their answer."

That sentence was true and it is the wrong thing for a product to say. An
employee whose clock-out is missing loses that day's pay; offering a remedy and
then hiding whether it worked sends them to a manager, which is the phone call
the feature exists to remove.

`/regularisations/mine` is the answer, and the property worth pinning is that it
cannot be aimed at anybody else.
"""
import inspect

from routers import pahchan_attendance as PA


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        l for l in src.splitlines() if not l.strip().startswith("#")).split())


def test_it_selects_by_the_callers_own_user_id():
    """THE property. No employee_id crosses the wire, so none can be forged."""
    code = _code(PA.list_my_regularisations)
    assert "e.user_id=$2" in code, "the query is not scoped to the caller"
    assert 'user["user_id"]' in code, "the caller's identity is not what scopes it"


def test_it_takes_no_employee_id_parameter():
    """
    Asking for somebody else's corrections must not be a request this endpoint
    can express. A parameter that is validated is a parameter that can stop
    being validated; an absent one cannot.
    """
    params = inspect.signature(PA.list_my_regularisations).parameters
    assert "employee_id" not in params
    assert "reg_id" not in params


def test_it_is_still_scoped_to_the_org():
    code = _code(PA.list_my_regularisations)
    assert "r.org_id=$1::uuid" in code


def test_it_does_not_carry_the_reviewer_gate():
    """
    The whole point is that an ordinary employee reaches it. If this grows the
    review gate the endpoint becomes a second copy of the queue and the register
    goes back to saying it cannot show an answer.
    """
    code = _code(PA.list_my_regularisations)
    assert "_review_gate" not in code, "the self-service endpoint acquired the reviewer gate"
    assert "_g=Depends(_gate)" in code, "the module gate is missing"


def test_the_reviewer_queue_still_has_its_gate():
    """The narrowing must not have loosened the queue on the way past."""
    code = _code(PA.list_regularisations)
    assert "_review_gate" in code


def test_the_decision_note_is_returned():
    """
    A refusal with no reason generates exactly the phone call this endpoint
    exists to prevent.
    """
    assert "decision_note" in _code(PA.list_my_regularisations)
