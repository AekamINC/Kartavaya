"""
The 2026-08-27 open findings, pinned.

Two of the four findings in that batch were repairs to `server.py`; the other
two were already fixed at HEAD and are recorded in the report rather than here.
What this file covers:

  FINDING A — `TeamMemberAdd` dropped `receives_approval_emails` and
              `company_name`, which TeamsPage posts on every client add.
  FINDING D — the four `/api/tasks/{id}/subtasks` routes crashed on
              `json.loads(<list>)`, 22 live Sentry events across three issues.

Both are the same class of bug and it is worth naming it, because the suite was
GREEN through both of them. A test can only catch a dropped field or a wrong
type if the fixture models what the driver and the browser actually send:

  · Finding A was invisible because no test ever posted the two fields. Every
    assertion written about `add_team_member` was written about the three fields
    the model already had, so the model and the tests agreed with each other and
    both disagreed with the form.
  · Finding D was invisible because `tests/helpers.py::make_task_row` defaults
    every jsonb column to a STRING (`"subtasks": "[]"`) — the shape asyncpg
    returned before `db.py::_init_conn` registered a jsonb codec. Production has
    returned a `list` for months. The fixture was testing the world of a year
    ago, so the suite passed while the endpoint 500'd.

The tests below therefore post what the form posts and hand back what the driver
hands back. Each was run against the code WITHOUT its fix and observed to fail —
see the module docstring notes on each section for the failure it produced.
"""

from datetime import datetime, timezone

import pytest

import server

NOW = datetime.now(timezone.utc)


# ══════════════════════════════════════════════════════════════════════════════
# FINDING A — the two fields the form posts and the model threw away
#
# Live catalogue, 2026-08-27, read-only:
#   public.team_members.receives_approval_emails  boolean NOT NULL DEFAULT true
#   public.team_members.company_name              text NULL
#   public.users        — the same pair, same types
#   public.project_assignments — a third copy, which nothing reads
#
# And the measure of how long it has been dropped: of 212 live `team_members`
# rows, ZERO carry a `company_name` and ZERO have `receives_approval_emails`
# FALSE. Of 50 `users` rows, 2 carry a company and none has the flag off. The
# toggle has never been written by anyone, in any organisation.
#
# Without the fix these fail as follows: the `_seen` INSERT has 7 parameters
# instead of 9 (the values never reach the statement), no `UPDATE users` is
# issued at all, and the response body has no `company_name` key.
# ══════════════════════════════════════════════════════════════════════════════

def _wire_add_member(mock_pool, *, existing_user, insert_row):
    """Route the four statements `add_team_member` issues, and record the writes.

    Dispatched on the text of the query rather than on call ordering, for the
    reason `test_tasks.py` sets out at length: a dependency added in front of the
    handler shifts every ordinal and turns the fixture into an accusation.
    """
    seen = {"insert": None, "profile_update": None}

    async def fetchrow_side(query, *args):
        if "SELECT role FROM project_assignments" in query:
            return {"role": "admin"}
        if "FROM users WHERE user_id" in query or "FROM users WHERE email" in query:
            return existing_user
        if "INSERT INTO team_members" in query:
            seen["insert"] = (query, args)
            return insert_row
        return None

    async def execute_side(query, *args):
        if "UPDATE users SET" in query:
            seen["profile_update"] = (query, args)
        return "OK"

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.side_effect = execute_side
    return seen


_MEMBER_ROW = {
    "member_id": "mem_ccc", "team_id": "team_001",
    "email": "asha@unicodegroup.com", "user_id": "user_a1",
    "role": "client", "status": "active",
    "created_at": NOW, "updated_at": NOW,
    "receives_approval_emails": False, "company_name": "Unicode Group",
}

_EXISTING = {
    "user_id": "user_a1", "email": "asha@unicodegroup.com",
    "display_name": "Asha Nair",
    "company_name": None, "receives_approval_emails": True,
}


async def test_the_two_posted_fields_reach_the_insert(api_client, mock_pool, as_member):
    """What TeamsPage actually sends, sent.

    `addMember` posts `receives_approval_emails` and `company_name` whenever the
    role is `client`. Both were silently discarded by Pydantic — a 200, a card on
    screen, and nothing written anywhere.
    """
    seen = _wire_add_member(mock_pool, existing_user=_EXISTING, insert_row=_MEMBER_ROW)

    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "asha@unicodegroup.com", "role": "client",
              "receives_approval_emails": False, "company_name": "Unicode Group"},
    )
    assert resp.status_code == 200

    query, args = seen["insert"]
    assert "receives_approval_emails" in query and "company_name" in query, (
        "the INSERT does not name the two columns the form posts — they are "
        "being dropped between the body and the row"
    )
    assert False in args, "receives_approval_emails=False never reached the INSERT"
    assert "Unicode Group" in args, "company_name never reached the INSERT"


async def test_the_profile_row_is_written_because_that_is_where_they_are_read(
        api_client, mock_pool, as_member):
    """Writing only `team_members` would have left the defect exactly in place.

    `get_team`'s roster resolves both fields through `LEFT JOIN users u`, and
    `request_task_approval` reads `COALESCE(u.receives_approval_emails, TRUE)`.
    Nothing reads the `team_members` copy and nothing at all reads the
    `project_assignments` copy. `users` is the only one of the three that changes
    what a person sees or receives.
    """
    seen = _wire_add_member(mock_pool, existing_user=_EXISTING, insert_row=_MEMBER_ROW)

    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "asha@unicodegroup.com", "role": "client",
              "receives_approval_emails": False, "company_name": "Unicode Group"},
    )
    assert resp.status_code == 200
    assert seen["profile_update"] is not None, (
        "no UPDATE on users — the field saves into a column nothing reads, "
        "which is the same defect wearing a different table name"
    )
    query, args = seen["profile_update"]
    assert "COALESCE" in query, (
        "the profile write must COALESCE onto the existing column, or an "
        "unsupplied field clears one that another project set"
    )
    assert args == ("user_a1", False, "Unicode Group")


async def test_a_blank_company_never_clears_one_already_set(api_client, mock_pool, as_member):
    """The form sends `''`, not `undefined`, when the box is empty.

    `clientCompany.trim() || selectedUser?.company_name || ''` evaluates to an
    empty string whenever the box is blank AND the picked user has no company on
    file. Storing that as a value would let opening and saving the add form erase
    a company somebody typed on a previous add — a silent destructive write out
    of a form the user did not touch.
    """
    seen = _wire_add_member(
        mock_pool,
        existing_user={**_EXISTING, "company_name": "Unicode Group"},
        insert_row={**_MEMBER_ROW, "company_name": "Unicode Group"},
    )

    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "asha@unicodegroup.com", "role": "client",
              "receives_approval_emails": True, "company_name": "   "},
    )
    assert resp.status_code == 200
    _query, args = seen["profile_update"]
    assert args[2] is None, "a blank company name was bound as a value and would overwrite"
    # And the roster row keeps the company it already had.
    _iq, iargs = seen["insert"]
    assert "Unicode Group" in iargs


async def test_an_add_that_says_nothing_writes_no_profile(api_client, mock_pool, as_member):
    """The non-client path — the form omits both fields entirely.

    `None` has to mean UNSAID rather than "the default", or every ordinary add
    would assert `receives_approval_emails=True` over whatever the person had
    chosen elsewhere.
    """
    seen = _wire_add_member(
        mock_pool,
        existing_user={**_EXISTING, "receives_approval_emails": False,
                       "company_name": "Unicode Group"},
        insert_row=_MEMBER_ROW,
    )

    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "asha@unicodegroup.com", "role": "member"},
    )
    assert resp.status_code == 200
    assert seen["profile_update"] is None, (
        "an add that mentioned neither field still rewrote the person's profile"
    )
    # The roster row still has to carry SOMETHING — the column is NOT NULL — and
    # it must be what the person already has, not the column default.
    #
    # Read by POSITION, not by `False in args`: the mocked `teams.org_id` is `0`,
    # and `0 == False` in Python, so a membership test would pass against the
    # pre-fix INSERT that binds no preference at all.
    query, args = seen["insert"]
    cols = query.split("(", 1)[1].split(")", 1)[0].split(",")
    assert "receives_approval_emails" in cols
    assert args[cols.index("receives_approval_emails")] is False, (
        "the person's existing preference was replaced by the column default"
    )


async def test_the_response_carries_them_so_the_spliced_card_is_right(
        api_client, mock_pool, as_member):
    """TeamsPage splices this response into the roster it has already drawn.

    `NewTaskModal`'s assignee list reads `m.company_name` and
    `m.receives_approval_emails` off those rows — the second draws the "Client
    Approver" badge. Without them here, the card the user just created is the
    only one on the page missing its company and its badge.
    """
    _wire_add_member(mock_pool, existing_user=_EXISTING, insert_row=_MEMBER_ROW)

    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"email": "asha@unicodegroup.com", "role": "client",
              "receives_approval_emails": False, "company_name": "Unicode Group"},
    )
    body = resp.json()
    assert body["company_name"] == "Unicode Group"
    assert body["receives_approval_emails"] is False


async def test_the_new_fields_disclose_no_contact_detail(api_client, mock_pool, as_admin):
    """THE SECURITY QUESTION ASKED OF ANYTHING ADDED TO `TeamMemberOut`.

    `as_admin` is a platform account — `is_platform_staff` admits it through the
    bypass — so this is the Aekam-side call, the one the 2026-08-27 privacy fix
    was raised about. Adding two fields to a response model is exactly how that
    leak was reintroduced last time, so the rule is re-asserted here rather than
    assumed: the response may carry a company and a preference, and it must
    still carry NO ADDRESS the caller did not supply.

    Neither new field is a contact detail. `company_name` is already in the
    platform branch of `GET /api/users` and already in `get_team`'s roster;
    `receives_approval_emails` is a boolean that names nobody.
    """
    async def fetchrow_side(query, *args):
        if "FROM users WHERE user_id" in query:
            return _EXISTING
        if "INSERT INTO team_members" in query:
            return _MEMBER_ROW
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.return_value = "OK"

    resp = await api_client.post(
        "/api/teams/team_001/members",
        json={"user_id": "user_a1", "role": "client", "company_name": "Unicode Group"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] is None, (
        "the user_id-to-email oracle is back — a request that carried no address "
        "got one out"
    )
    assert body["display_name"] == "Asha Nair"
    assert body["company_name"] == "Unicode Group"
    # The de-dup key the picker needs (see FINDING B below) travels on this
    # response and is not a contact detail.
    assert body["user_id"] == "user_a1"


# ══════════════════════════════════════════════════════════════════════════════
# FINDING B — the picker's de-duplication, and the half of it that is server-side
#
# TeamsPage filters the directory against the roster on EMAIL:
#
#     const currentEmails = new Set(members.map(m => m.email));
#     if (currentEmails.has(u.email)) return false;
#
# The platform branch of `GET /api/users` no longer selects an email, so for an
# Aekam caller `u.email` is `undefined` on all 45 directory rows,
# `currentEmails.has(undefined)` is always false, and NOBODY is ever filtered
# out: the picker offers people who are already on the project, and adding one
# deletes and re-inserts their row.
#
# THE REPAIR BELONGS IN `frontend/src/pages/TeamsPage.jsx` AND IS REPORTED, NOT
# MADE HERE — de-duplicate on `user_id`, which is not a contact detail and so
# cannot re-open the leak the email fix closed. What this file can pin is the
# server-side precondition that makes that one-line change possible: the key has
# to be present, and total, on BOTH payloads.
#
# Live 2026-08-27: 212 of 212 `team_members` rows carry a `user_id` and join to a
# `users` row, 0 are NULL; all 45 rows the platform directory returns carry one.
# ══════════════════════════════════════════════════════════════════════════════

def test_both_payloads_can_carry_a_non_contact_dedup_key():
    """`user_id` is on the directory row, the roster row and the add response.

    The directory's platform branch selects `u.user_id`; `get_team`'s roster is
    `SELECT tm.*` over a table whose `user_id` column exists; and `TeamMemberOut`
    declares it. So the frontend fix needs no server change — which is the whole
    reason this is a report rather than an edit.

    Asserted against the response model and the SQL rather than mocked, because
    the claim is about what the shapes contain, not about a request.
    """
    import inspect

    assert "user_id" in server.TeamMemberOut.model_fields, (
        "the add response lost user_id — the picker has nothing left to "
        "de-duplicate on that is not a contact detail"
    )
    roster = inspect.getsource(server.get_team)
    assert "SELECT tm.*" in roster, (
        "the roster stopped selecting the whole team_members row; confirm it "
        "still carries user_id before relying on it as the de-dup key"
    )


def test_the_platform_directory_selects_the_key_and_not_the_address():
    """Read the statement itself: `u.user_id` in, `email` out.

    This is the pairing the frontend fix depends on. If somebody ever restores
    `u.email` here to "fix the picker", that is the leak returning, and this test
    is where it should be argued rather than typed.
    """
    import inspect
    src = inspect.getsource(server.list_users)
    platform_branch = src.split("# Scoped to the ACTIVE org")[0]
    assert "u.user_id" in platform_branch
    assert "u.email" not in platform_branch, (
        "the platform directory selects an email again — de-duplicate the picker "
        "on user_id instead, which is what FINDING B asked for"
    )


# ══════════════════════════════════════════════════════════════════════════════
# FINDING D — `json.loads()` on a value the driver had already parsed
#
# `db.py::_init_conn` registers a jsonb codec on every connection, so
# `task["subtasks"]` arrives as a Python list. The four subtask routes called
# `json.loads(task["subtasks"] or "[]")` on it:
#
#     TypeError: the JSON object must be str, bytes or bytearray, not list
#
# 22 events across three Sentry issues (PYTHON-FASTAPI-A/B/C, 2026-08-24), one
# per route, on release d321bf9a — every add, toggle, rename and delete of a
# subtask, for every user.
#
# The cause is NOT a missing type check. It is four hand-written parses of a
# column the driver has already parsed, in a file that already had a named
# helper for exactly that (`_pj`, whose own docstring records two endpoints that
# crashed for not using it). `_subtasks_of` is where that knowledge now lives
# once. Without it these tests raise the TypeError above and return 500.
#
# Both branches of the helper are exercised, because both occur live: 431 of 485
# `tasks` rows hold an array, and 54 hold a jsonb STRING — double-encoded rows
# from before `db.py::_json_encoder` was fixed, which the codec decodes to `str`.
# ══════════════════════════════════════════════════════════════════════════════

from helpers import make_task_row  # noqa: E402  (kept beside the section it serves)


def _wire_subtasks(mock_pool, stored):
    """`stored` is what the DRIVER hands back — a list post-codec, a str before."""
    written = {}

    async def fetchrow_side(query, *args):
        if "SET subtasks" in query:
            written["payload"] = args[0]
            return make_task_row(subtasks=args[0])
        if "subtasks" in query and "team_id" in query:
            return {"subtasks": stored, "team_id": "team_001"}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.return_value = [{"team_id": "team_001"}]
    return written


_ONE = [{"subtask_id": "sub_001", "title": "Collect the TDS certificates",
         "is_done": False, "order": 0}]


@pytest.mark.parametrize("stored", [
    pytest.param([], id="decoded-empty-list"),
    pytest.param(_ONE, id="decoded-list-with-a-row"),
    pytest.param("[]", id="double-encoded-string-54-live-rows"),
])
async def test_add_subtask_survives_every_shape_the_driver_returns(
        api_client, mock_pool, as_admin, stored):
    _wire_subtasks(mock_pool, stored)
    resp = await api_client.post(
        "/api/tasks/task_test001/subtasks", json={"title": "Step 1", "is_done": False})
    assert resp.status_code == 200, (
        "a decoded jsonb column was passed to json.loads — the crash behind "
        "PYTHON-FASTAPI-A"
    )
    titles = [s["title"] for s in resp.json()["subtasks"]]
    assert "Step 1" in titles
    # The existing rows survive the round trip; an append must not truncate.
    assert len(titles) == (len(stored) if isinstance(stored, list) else 0) + 1


async def test_toggle_subtask_survives_a_decoded_list(api_client, mock_pool, as_admin):
    _wire_subtasks(mock_pool, _ONE)
    resp = await api_client.patch("/api/tasks/task_test001/subtasks/sub_001")
    assert resp.status_code == 200
    assert resp.json()["subtasks"][0]["is_done"] is True


async def test_delete_subtask_survives_a_decoded_list(api_client, mock_pool, as_admin):
    _wire_subtasks(mock_pool, _ONE)
    resp = await api_client.delete("/api/tasks/task_test001/subtasks/sub_001")
    assert resp.status_code == 200
    assert resp.json()["subtasks"] == []


async def test_update_subtask_survives_a_decoded_list(api_client, mock_pool, as_admin):
    _wire_subtasks(mock_pool, _ONE)
    resp = await api_client.put(
        "/api/tasks/task_test001/subtasks/sub_001", json={"title": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["subtasks"][0]["title"] == "Renamed"


def test_the_helper_never_hands_back_the_row_s_own_list():
    """A read-modify-write must not mutate the object the driver gave it.

    All four routes `append` to or filter this list and then re-serialise it. If
    the helper returned the Record's own list, an append would mutate the row a
    caller may still be holding — the kind of aliasing bug that survives every
    test until two handlers share a cached row.
    """
    original = [{"subtask_id": "sub_001", "title": "A", "is_done": False, "order": 0}]
    got = server._subtasks_of({"subtasks": original})
    got.append({"subtask_id": "sub_002", "title": "B", "is_done": False, "order": 1})
    assert len(original) == 1


def test_the_helper_reads_the_double_encoded_rows():
    """The 54 live rows whose `subtasks` is a jsonb STRING, not an array.

    They cannot be repaired from here: only a data migration fixes them, and
    that is a WRITE against a database production shares. Until then this branch
    is what keeps those 54 tasks' subtask controls working.
    """
    assert server._subtasks_of({"subtasks": "[]"}) == []
    assert server._subtasks_of({"subtasks": '[{"subtask_id":"s","title":"T",'
                                            '"is_done":false,"order":0}]'})[0]["title"] == "T"
    assert server._subtasks_of({"subtasks": None}) == []
