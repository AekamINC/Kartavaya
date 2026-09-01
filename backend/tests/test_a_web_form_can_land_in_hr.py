"""A public form can create a job applicant, and cannot be made to create one
anywhere else.

── WHAT THIS PATH IS ─────────────────────────────────────────────────────────

`POST /api/v1/graha/f/{slug}` is the ONLY unauthenticated write in the product.
Until migration 251 it could create exactly one thing, a CRM contact, because
the destination was hardcoded. It can now create a `manav_candidates` row when
the form says so.

Widening an anonymous write is the sharpest change this codebase can make, so
most of this file is about what the route REFUSES rather than what it does.

── THE PROPERTY THAT MATTERS MOST ────────────────────────────────────────────

**The job opening is read from the FORM, never from the payload.** A uuid in a
public body is a parameter, not a secret; if the opening came from the
submission then anybody holding any slug could file an application into any
opening in any organisation. `test_the_payload_cannot_choose_the_job_opening`
is the assertion that says so, and it is written to fail loudly if that ever
changes.
"""
import json
import pytest


FORM_HR = {
    "id": "aaaaaaaa-0000-0000-0000-000000000001",
    "org_id": "bbbbbbbb-0000-0000-0000-000000000002",
    "slug": "careers",
    "name": "Careers",
    "destination": "hr_application",
    "settings": {"job_opening_id": "cccccccc-0000-0000-0000-000000000003"},
    "fields": [],
    "is_active": True,
}

#: The opening the FORM points at. Any test that gets a candidate row must have
#: gone through this one.
FORM_OPENING = {"id": "cccccccc-0000-0000-0000-000000000003"}

APPLICANT = {
    "name": "Ananya Iyer",
    "email": "ananya@example.invalid",
    "phone": "9876500011",
    "message": "Two years with a mid-size firm in Chennai.",
}


class Recorder:
    """A connection that answers from a script and remembers every statement."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.sql = []

    def transaction(self):
        rec = self

        class _T:
            async def __aenter__(self_inner):
                return None

            async def __aexit__(self_inner, *a):
                return False
        return _T()

    async def fetchrow(self, sql, *args, **kw):
        self.sql.append((sql, args))
        return self.answers.pop(0) if self.answers else None

    async def execute(self, sql, *args, **kw):
        self.sql.append((sql, args))
        return None

    async def fetchval(self, sql, *args, **kw):
        self.sql.append((sql, args))
        return None

    def wrote(self, needle):
        return [s for s, _ in self.sql if needle in s]


def _acquire(rec):
    class _A:
        async def __aenter__(self):
            return rec

        async def __aexit__(self, *a):
            return False

    def acquire(*a, **kw):
        return _A()
    return acquire


@pytest.fixture
def hr_form(mock_pool, monkeypatch):
    """The public route loads the form through `pool.fetchrow` before anything
    else. Everything after that happens on the acquired connection."""
    mock_pool.fetchrow.return_value = FORM_HR
    return mock_pool


class TestItCreatesACandidate:
    @pytest.mark.anyio
    async def test_a_submission_becomes_a_job_applicant(self, api_client, hr_form, monkeypatch):
        rec = Recorder([
            FORM_OPENING,                                   # the opening lookup
            {"id": "dddddddd-0000-0000-0000-000000000004"},  # module_subscriptions
            {"id": "eeeeeeee-0000-0000-0000-000000000005"},  # the candidate INSERT
            {"id": "ffffffff-0000-0000-0000-000000000006"},  # the submission INSERT
        ])
        monkeypatch.setattr(hr_form, "acquire", _acquire(rec))

        r = await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)
        assert r.status_code == 200, r.text

        assert rec.wrote("INSERT INTO public.manav_candidates"), (
            "an HR form did not create a candidate — the destination was ignored"
        )
        assert not rec.wrote("INSERT INTO public.graha_contacts"), (
            "an HR form ALSO created a CRM contact. The destinations must be "
            "exclusive; a form that writes to both fills a customer's CRM with "
            "job applicants"
        )

    @pytest.mark.anyio
    async def test_the_submission_is_linked_through_candidate_id(
        self, api_client, hr_form, monkeypatch,
    ):
        rec = Recorder([
            FORM_OPENING, {"id": "x"},
            {"id": "eeeeeeee-0000-0000-0000-000000000005"},
            {"id": "ffffffff-0000-0000-0000-000000000006"},
        ])
        monkeypatch.setattr(hr_form, "acquire", _acquire(rec))
        await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)

        subs = rec.wrote("INSERT INTO public.graha_web_form_submissions")
        assert subs, "no submission row was written"
        assert "candidate_id" in subs[0], (
            "the submission does not record WHICH candidate it produced, so the "
            "application and the row it created cannot be tied together later"
        )
        assert "contact_id" not in subs[0]


class TestWhatItRefuses:
    @pytest.mark.anyio
    async def test_the_payload_cannot_choose_the_job_opening(
        self, api_client, hr_form, monkeypatch,
    ):
        """⚠ THE ONE THAT MATTERS. A uuid in a public body is a parameter, not a
        secret. If the opening came from the submission, any slug would reach any
        opening in any org."""
        rec = Recorder([
            FORM_OPENING, {"id": "x"},
            {"id": "eeeeeeee-0000-0000-0000-000000000005"},
            {"id": "ffffffff-0000-0000-0000-000000000006"},
        ])
        monkeypatch.setattr(hr_form, "acquire", _acquire(rec))

        attacker = dict(APPLICANT)
        attacker["job_opening_id"] = "99999999-9999-9999-9999-999999999999"
        await api_client.post("/api/v1/graha/f/careers", json=attacker)

        looked_up = [args for sql, args in rec.sql if "manav_job_openings" in sql]
        assert looked_up, "the opening was never verified at all"
        assert "99999999-9999-9999-9999-999999999999" not in [str(a) for a in looked_up[0]], (
            "THE OPENING CAME FROM THE PAYLOAD. Anybody holding any public slug "
            "can now file an application into any opening in any organisation"
        )
        assert "cccccccc-0000-0000-0000-000000000003" in [str(a) for a in looked_up[0]]

    @pytest.mark.anyio
    async def test_an_opening_that_is_not_this_orgs_is_refused(
        self, api_client, hr_form, monkeypatch,
    ):
        # The lookup is scoped by org and status; a miss means "no such open
        # role here", which is the only answer a stranger should get.
        rec = Recorder([None])
        monkeypatch.setattr(hr_form, "acquire", _acquire(rec))
        r = await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)
        assert r.status_code == 400
        assert not rec.wrote("INSERT INTO public.manav_candidates")

    @pytest.mark.anyio
    async def test_an_org_without_the_hr_module_is_refused(
        self, api_client, hr_form, monkeypatch,
    ):
        """`require_module()` needs a user and there is none, so the
        subscription is asked for directly. Without this a firm that never
        bought HR could have candidates written into it by a stranger."""
        rec = Recorder([FORM_OPENING, None])
        monkeypatch.setattr(hr_form, "acquire", _acquire(rec))
        r = await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)
        assert r.status_code == 400
        assert not rec.wrote("INSERT INTO public.manav_candidates")

    @pytest.mark.anyio
    async def test_a_form_with_no_opening_configured_says_so(
        self, api_client, mock_pool, monkeypatch,
    ):
        mock_pool.fetchrow.return_value = {**FORM_HR, "settings": {}}
        rec = Recorder([])
        monkeypatch.setattr(mock_pool, "acquire", _acquire(rec))
        r = await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)
        assert r.status_code == 400
        assert not rec.wrote("INSERT INTO public.manav_candidates")

    @pytest.mark.anyio
    async def test_a_nameless_application_is_a_400_and_not_a_500(
        self, api_client, hr_form, monkeypatch,
    ):
        """`manav_candidates.full_name` is NOT NULL. Letting an empty name reach
        the INSERT is a 500 with no message — and a 500 from this route carries
        no CORS headers, so the browser shows 'check your connection'."""
        rec = Recorder([FORM_OPENING, {"id": "x"}])
        monkeypatch.setattr(hr_form, "acquire", _acquire(rec))
        r = await api_client.post("/api/v1/graha/f/careers", json={**APPLICANT, "name": "  "})
        assert r.status_code == 400
        assert not rec.wrote("INSERT INTO public.manav_candidates")


class TestTheRouteItself:
    @pytest.mark.anyio
    async def test_a_non_object_body_is_a_400_and_not_a_500(
        self, api_client, mock_pool,
    ):
        """`await request.json()` happily returns a list. Every `payload.get`
        after it then raises AttributeError — an unauthenticated 500."""
        mock_pool.fetchrow.return_value = FORM_HR
        r = await api_client.post("/api/v1/graha/f/careers", json=["not", "an", "object"])
        assert r.status_code == 400, (
            f"a list body answered {r.status_code}; this route is reachable by "
            f"anyone and must not 500 on a malformed payload"
        )

    @pytest.mark.anyio
    async def test_an_unknown_destination_refuses_rather_than_falling_back_to_crm(
        self, api_client, mock_pool, monkeypatch,
    ):
        """⚠ THE FAIL-OPEN THIS CODEBASE KEEPS FINDING.

        If the CHECK constraint and the handler dict ever drift, the wrong
        answer is to quietly do the CRM thing — a firm's job applicants would
        land silently in their sales pipeline. It must refuse.
        """
        mock_pool.fetchrow.return_value = {**FORM_HR, "destination": "vendor_enquiry"}
        rec = Recorder([])
        monkeypatch.setattr(mock_pool, "acquire", _acquire(rec))
        r = await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)
        assert r.status_code >= 400
        assert not rec.wrote("INSERT INTO public.graha_contacts"), (
            "an unrecognised destination fell through to the CRM handler"
        )

    @pytest.mark.anyio
    async def test_a_crm_form_still_takes_the_untouched_inline_path(
        self, api_client, mock_pool, monkeypatch,
    ):
        """The default destination must not be routed through the new module —
        that path carries 24 real submissions and has not moved a line."""
        mock_pool.fetchrow.return_value = {**FORM_HR, "destination": "crm_contact",
                                           "settings": {}}
        called = []
        import services.webforms.destinations as dest
        monkeypatch.setattr(
            dest, "land_hr_application",
            lambda *a, **k: called.append(1),
        )
        await api_client.post("/api/v1/graha/f/careers", json=APPLICANT)
        assert not called, "a CRM form was dispatched through the HR handler"
