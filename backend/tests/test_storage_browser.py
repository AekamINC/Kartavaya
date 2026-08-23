"""The Storage tab — proposal 83 §5, and the tenancy it must not leak.

The owner's ask was "make a file findable without a developer". That was not
possible before, and the reason was not the missing screen: there were four key
grammars, so a key could not be read without knowing which caller wrote it, and
"everything for this client" was not a question the bucket could answer. §4
settled the grammar; §5 is what falls out of it — "once keys are predictable,
the browser is just the key, rendered".

── WHAT THIS FILE IS ACTUALLY GUARDING ─────────────────────────────────────

A file browser over a MULTI-TENANT bucket is one wrong prefix away from being a
way to read another firm's documents. Two orgs of the three are on the vendor's
shared bucket, separated by nothing but an `org/{org_id}/` prefix. So the tests
that matter here are not the listing ones — they are:

  · a listing is ROOTED at the caller's own tenant prefix, which is prepended
    server-side and never taken from the request;
  · a key naming another org's prefix is REFUSED before any client is built,
    not filtered out of the results afterwards;
  · every record lookup carries `org_id` IN THE PREDICATE, so a resolve cannot
    confirm that another org's key exists even by answering differently.

And two design decisions worth pinning because both look like omissions:

  · THERE IS NO DELETE. A file here is a pointer held in a column, and deleting
    the object without the row produces exactly the failure this tab exists to
    diagnose. Deletion belongs to the module that owns the row.
  · NO CREDENTIAL IS RETURNED. "Does this org have its own Cloudflare account"
    is a boolean, and the boolean is all a screen needs.
"""
import inspect
import re

import pytest

from routers import storage_browser as sb


def _code(fn) -> str:
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.lstrip().startswith("#")
    )


# ── The tenant root ─────────────────────────────────────────────────────────

def test_the_root_is_the_bucket_or_the_prefix_depending_on_the_org():
    """The same split `_resolve_r2` applies on the way in, read back on the way
    out: an org with its own Cloudflare account IS its bucket; one on the
    vendor's is a prefix inside it."""
    code = _code(sb._tenant_root)
    assert '_get_org_r2' in code
    assert 'f"org/{org_id}/"' in code
    assert 'return "" if client is not None' in code


def test_browse_prepends_the_root_and_never_takes_it_from_the_caller():
    """A caller cannot walk upwards by sending `org/<somebody-else>/`."""
    code = _code(sb.browse)
    assert "root = await _tenant_root(org_id)" in code
    assert 'full_prefix = f"{root}{prefix}"' in code
    # And the one traversal trick an S3 key can carry.
    assert '".." in prefix' in code


def test_browse_uses_a_delimiter_so_one_level_is_one_round_trip():
    """1,659 punch photographs today, hundreds of thousands with a real
    customer. A prefix listing without a delimiter would read all of them."""
    assert 'Delimiter="/"' in _code(sb.browse)


def test_browse_returns_relative_paths():
    """The tenant root is an implementation detail of where the org's files
    live, not something a screen should render or a client should echo back."""
    code = _code(sb.browse)
    assert 'cp["Prefix"][len(root):]' in code
    assert "key[len(root):]" in code


def test_an_org_with_no_storage_gets_an_empty_tab_and_not_an_error():
    """503 here would read as an outage. It is a configuration state."""
    code = _code(sb.browse)
    assert '"configured": False' in code
    assert "503" not in code


# ── The tenancy guard on resolve ────────────────────────────────────────────

def test_a_key_naming_another_orgs_prefix_is_refused():
    code = _code(sb.resolve_key)
    assert code.count("belongs to another organisation's storage") == 2, (
        "both branches must refuse — the org on its own bucket and the org on "
        "the shared one"
    )
    assert "403" in code


def test_every_record_lookup_carries_the_org_in_the_predicate():
    """Not filtered afterwards. A resolve must not be able to confirm that
    another org's key exists, even by answering differently."""
    code = _code(sb.resolve_key)
    query = re.search(r'f"SELECT \* FROM \{table\}.*?"', code, re.S)
    assert query, "the record lookup is no longer recognisable"
    assert "org_id = $2::uuid" in query.group(0)


def test_the_key_columns_are_a_fixed_list_and_not_a_caller_string():
    """`table` and `column` are interpolated into the SQL. They come from a
    server-side tuple, which is the rule in CLAUDE.md for a dynamic
    identifier."""
    for table, column, label in sb._KEY_COLUMNS:
        assert table.startswith(("staging.", "public.")), table
        assert re.fullmatch(r"[a-z_]+", column), column
        assert label


# ── The three questions resolve answers, kept apart ─────────────────────────

def test_a_record_without_an_object_is_reported_as_exactly_that():
    """The bug report already written: "this record points at a file the
    storage does not have". Five executed e-sign PDFs were in that state once,
    and finding them took a developer and a database session."""
    out = sb._summarise({"kind": "eSign document", "label": "Supply Agreement"}, False)
    assert "NOT in the bucket" in out
    assert "Supply Agreement" in out


def test_an_object_without_a_record_is_also_reported():
    out = sb._summarise(None, True)
    assert "no record" in out


def test_nothing_at_all_is_distinguishable_from_storage_being_unconfigured():
    assert "Nothing at this key" in sb._summarise(None, False)
    assert "not configured" in sb._summarise(None, None)


# ── The grammar, read back ──────────────────────────────────────────────────

def test_a_key_in_the_grammar_parses_into_its_parts():
    key = ("esign/doc_9f2a/signature/user_abc/2026/08/"
           "01M0PD8DD09QVSEPMHQ7M6RN91--supply-agreement.pdf")
    out = sb._parse_key(key, "")
    assert out["matches_grammar"] is True
    assert out["module"] == "esign"
    assert out["scope"] == ["doc_9f2a", "signature", "user_abc"]
    assert (out["year"], out["month"]) == ("2026", "08")
    assert out["original_name"] == "supply-agreement.pdf"


def test_an_old_key_does_not_parse_and_says_so_rather_than_raising():
    """Keys written before the grammar are stored verbatim and read verbatim.
    `matches_grammar: False` is what tells the screen to show the raw key
    instead of a breakdown — it is not an error."""
    out = sb._parse_key("esign/signatures/1f2e3d4c.png", "")
    assert out["matches_grammar"] is False
    assert out["module"] == "esign"


def test_the_tenant_root_is_stripped_before_parsing():
    key = "org/045b76ad/personal/user_abc/2026/08/01M0--shot.png"
    out = sb._parse_key(key, "org/045b76ad/")
    assert out["matches_grammar"] is True
    assert out["module"] == "personal"


# ── The two deliberate absences ─────────────────────────────────────────────

def test_there_is_no_delete_anywhere_in_this_module():
    """A file here is a POINTER held in a column. Deleting the object without
    the row produces exactly the failure this tab exists to diagnose."""
    src = inspect.getsource(sb)
    assert "delete_object" not in src
    assert "@router.delete" not in src
    assert "delete_file" not in src


def test_no_credential_is_returned_by_the_overview():
    """Not the access key id, not the account id, not a masked version. "Does
    the org have its own account" is a boolean."""
    code = _code(sb.storage_overview)
    for secret in ("r2_access_key_id", "r2_secret_access_key", "r2_account_id"):
        assert f'"{secret}"' not in code
    # The account id appears once, inside `IS NOT NULL` — as a boolean.
    assert "(r2_account_id IS NOT NULL) AS own_account" in code


def test_the_vendors_bucket_name_is_not_shown_to_a_customer():
    code = _code(sb.storage_overview)
    assert 'row["r2_bucket_name"] if row["own_account"] else None' in code


# ── The gate ────────────────────────────────────────────────────────────────

def test_storage_is_org_administration():
    src = inspect.getsource(sb)
    assert 'require_org_role("org_admin", "org_owner")' in src
    for fn in (sb.storage_overview, sb.browse, sb.resolve_key):
        assert "_g=Depends(_gate)" in inspect.getsource(fn), fn.__name__


def test_a_no_limit_org_reports_no_percentage_rather_than_zero():
    """A progress bar at 0% and a progress bar that does not apply are
    different screens."""
    assert 'if limit else None' in _code(sb.storage_overview)
