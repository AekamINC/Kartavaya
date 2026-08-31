"""A published lead form can be filled in — and cannot be flooded.

── TWO DEFECTS, FOUND TOGETHER ────────────────────────────────────────────────

1. THE FORM COULD BE PUBLISHED AND NOBODY COULD FILL IT IN.

   `POST /api/v1/graha/f/{slug}` has always worked: it de-duplicates against
   existing contacts, raises a lead, counts the submission and fires the
   automation event. There was nowhere to submit FROM. `App.jsx` declared
   public routes for /login, /accept-invite, /approve, /sign/:token and
   /i/:token and none for a lead form; the Web Forms tab printed the API PATH
   — which is not a thing a person can be sent — and offered no link, no
   preview, no copyable embed and no hosted page.

   Suite 04.14: "a web form can be published and nobody can fill it in",
   0 of 12 public submissions made. That is the orphaned-capability shape, the
   same one that hid an expense receipt behind a route with no file input and a
   deal's lost reason behind a form with no field.

   `GET /f/{slug}` is what a hosted page needs to draw itself, and the page at
   `/f/:slug` is what a member of the public actually opens.

2. AND THE PUBLIC WRITE HAD NO RATE LIMIT OF ANY KIND.

   `submit_web_form` is unauthenticated and it WRITES — a contact, a lead and a
   submission row into a paying customer's CRM — and it carried no limiter.
   Anybody holding a slug could fill a customer's contact list at the speed of
   their connection, and a slug is by definition public. CLAUDE.md's rule names
   "anything auth-shaped"; an unauthenticated public write is the same hazard
   in different clothes.

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

The read's PAYLOAD, which is the half that can leak, and the limits, which are
the half that can silently go missing. The hosted page itself is Suite 04.14's,
driving the real screen — a unit test cannot tell whether a person can reach it.
"""
import pytest

from routers import graha


SLUG = "contact-us"

# What the row actually holds. The point of the assertions below is that most
# of this must NOT come back to an unauthenticated caller.
FORM_ROW = {
    "name": "Talk to us",
    "fields": [{"key": "name"}, {"key": "email"}],
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """The public routes carry no gate; the rest of the router does."""
    from routers.graha import _crm_entity_gate, _gate
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides[dep] = lambda: None
    yield
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides.pop(dep, None)


def source_without_comments() -> str:
    """⚠ COMMENTS STRIPPED BEFORE MATCHING.

    Twice in this codebase a source-reading assertion passed by matching its
    own explanatory prose, and the comments around both of these routes quote
    the decorator verbatim.
    """
    from pathlib import Path
    src = Path(graha.__file__)
    return "\n".join(
        line for line in src.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("#")
    )


class TestTheReadAnswersLittleEnough:
    @pytest.mark.anyio
    async def test_it_answers_the_name_and_the_fields(self, api_client, mock_pool):
        mock_pool.fetchrow.return_value = dict(FORM_ROW)
        r = await api_client.get(f"/api/v1/graha/f/{SLUG}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "Talk to us"
        assert body["fields"] == [{"key": "name"}, {"key": "email"}]

    @pytest.mark.anyio
    async def test_it_reads_only_two_columns_from_the_table(self, api_client, mock_pool):
        """⚠ THE ASSERTION THIS FILE MOST EXISTS FOR.

        `submit_web_form` below does `SELECT *`, which is right for a handler
        that needs `org_id` and never returns the row. This one RETURNS what it
        reads to a stranger, so what it selects is the whole of its exposure.
        A later `SELECT *` here would hand out `org_id`, `submission_count`,
        `auto_assign_to` and `created_by` — everything needed to profile the
        organisation behind a slug — and every existing assertion above would
        still pass, because the two keys it checks would still be there.
        """
        mock_pool.fetchrow.return_value = dict(FORM_ROW)
        await api_client.get(f"/api/v1/graha/f/{SLUG}")
        sql = " ".join(str(c.args[0]) for c in mock_pool.fetchrow.await_args_list)
        assert "SELECT name, fields" in sql, sql
        assert "SELECT *" not in sql, (
            "the public read went back to SELECT * — an unauthenticated caller "
            "now learns org_id, submission_count and auto_assign_to from a slug"
        )
        assert "is_active=TRUE" in sql, (
            "the public read serves retired forms — a slug a firm took down "
            "keeps collecting leads nobody is watching"
        )

    @pytest.mark.anyio
    async def test_a_retired_form_is_the_same_answer_as_a_wrong_slug(
        self, api_client, mock_pool,
    ):
        """404 either way, so guessing tells a stranger nothing."""
        mock_pool.fetchrow.return_value = None
        r = await api_client.get(f"/api/v1/graha/f/never-existed")
        assert r.status_code == 404

    @pytest.mark.anyio
    async def test_it_takes_no_session(self, api_client, mock_pool):
        """The visitor is a member of the public and has no account here.

        Sent with no Authorization header at all — which is what the hosted
        page does, deliberately, using plain `fetch` rather than the app's
        client so no token and no `X-Org-Id` reach a public endpoint.
        """
        mock_pool.fetchrow.return_value = dict(FORM_ROW)
        r = await api_client.get(f"/api/v1/graha/f/{SLUG}")
        assert r.status_code == 200


class TestBothPublicRoutesAreLimited:
    def test_the_write_is_limited(self):
        """⚠ IT WAS NOT, AND IT IS THE ONE THAT MATTERS.

        Unauthenticated and it writes into a customer's CRM. A limit that
        quietly goes missing here restores exactly the hazard this closed, and
        nothing else in the product would notice.
        """
        code = source_without_comments()
        i = code.index('@router.post("/f/{slug}")')
        window = code[i:i + 200]
        assert "@limiter.limit(" in window, (
            "POST /f/{slug} carries no rate limit. It is unauthenticated and it "
            "writes a contact, a lead and a submission row into a paying "
            "customer's CRM, and the slug is public by definition"
        )

    def test_the_read_is_limited(self):
        code = source_without_comments()
        i = code.index('@router.get("/f/{slug}")')
        window = code[i:i + 200]
        assert "@limiter.limit(" in window, (
            "GET /f/{slug} carries no rate limit, so slug guessing is free"
        )

    def test_the_limiter_is_the_shared_one(self):
        """Not a second `Limiter()`, which would key on the proxy again.

        `limiter.py` exists because `get_remote_address` returns Railway's
        edge, and behind Cloudflare the rightmost forwarded entry is no longer
        the caller either. A router that builds its own limiter re-introduces
        the inverted control that file was written to remove.
        """
        code = source_without_comments()
        assert "from limiter import limiter" in code
        assert "Limiter(" not in code, (
            "routers/graha.py constructs its own Limiter — see limiter.py on "
            "why the key must come from the shared one"
        )
