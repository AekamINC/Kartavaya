"""An expense receipt: the door that did not exist, and the link that died.

── Two defects, and the second is why the first could not be fixed alone ─────

1. THE ATTACHMENT HAD NO DOOR.

   `ganit_expenses.receipt_urls` has existed since migration 019.
   `ExpenseCreate` accepts it, `create_expense` validates every entry through
   `assert_file_urls`, and `update_expense` carries the same refusal. All of it
   worked. `ExpensesTab.jsx` drew no file input, mentioned `receipt_urls`
   nowhere, and so an expense could be recorded in the product and its receipt
   could not.

   Proposal 93 Suite 05.05 named it: "THE ATTACHMENT HAS NO DOOR. §4 asks for an
   expense 'with attachment'. `ExpensesTab.jsx` renders no `input[type=file]`."
   That is the orphaned-capability shape — engine-supported, UI-unreachable —
   and it is invisible to every check that reads the API instead of the screen.

2. AND THE URL IT WOULD HAVE STORED DIES IN NINE HOURS.

   `POST /api/upload` answers with a PRESIGNED url, `ExpiresIn=32400`. Storing
   that alone is how five executed e-sign PDFs became permanently unservable,
   and `FilesField`'s docstring is the long-form account of the same bug being
   fixed on another surface: "the url is a PRESIGNED url with a nine-hour life;
   the key is the object it was signed from. With the key discarded there is
   nothing left to re-sign."

   `routers/ganit.py:229` had recorded this gap in terms — "There is no
   `receipt_keys` beside this and none is invented here" — so shipping the
   control without the column would have shipped a receipt list that goes blank
   overnight, on the evidence for money already paid out.

   Migration 247 adds the column. `list_expenses` re-signs from it.

── What this file pins ───────────────────────────────────────────────────────

The pairing rule, which is the one piece of logic here that can be wrong in a
way nothing else notices. The two lists are read BY INDEX, so a keys list
longer than the urls list either points at nothing or — once a url is appended
later — at somebody else's object. That is a wrong-file read, not an error, and
it would answer 200.

⚠ THE THREE OTHER READERS ARE NOT TESTED HERE AND SHOULD NOT PRETEND TO BE.
The re-sign loop needs R2 and a live row; the UI half is Suite 05.05's, driving
the real screen. This file covers the refusal, because a refusal is the part
that has to hold without anything else being present.
"""
import pytest
from fastapi import HTTPException

from routers.ganit import _assert_receipt_pairing


def test_one_key_for_one_url_is_the_ordinary_case():
    _assert_receipt_pairing(["https://r2/a.pdf"], ["org/1/a.pdf"], where="t")


def test_fewer_keys_than_urls_is_allowed_and_is_the_hand_typed_link():
    """⚠ THIS MUST NOT BECOME AN ERROR.

    The receipt box also takes a link somebody typed — a supplier's own portal,
    a bank statement on a shared drive. Those have no key, must never be given
    one, and `ganit.py`'s own note forbids scraping a key out of a url to make
    the lists line up. So "shorter" is a legitimate state and not a gap.
    """
    _assert_receipt_pairing(
        ["https://r2/a.pdf", "https://supplier.example/invoice/9912"],
        ["org/1/a.pdf"],
        where="t",
    )


def test_no_keys_at_all_is_every_row_written_before_migration_247():
    _assert_receipt_pairing(["https://supplier.example/x"], [], where="t")
    _assert_receipt_pairing(["https://supplier.example/x"], None, where="t")


def test_no_urls_and_no_keys_is_the_common_case():
    _assert_receipt_pairing([], [], where="t")
    _assert_receipt_pairing(None, None, where="t")


def test_more_keys_than_urls_is_refused():
    """⚠ THE ASSERTION THE WHOLE FILE EXISTS FOR.

    An extra key is not a harmless spare. `list_expenses` walks the keys and
    writes each freshly-signed url back at the SAME INDEX, so a key at position
    1 with no url at position 1 is inert today and aimed at whatever url arrives
    there tomorrow — a reviewer opening receipt 2 and being shown receipt 1's
    object, with a 200 and no sign anything went wrong.
    """
    with pytest.raises(HTTPException) as e:
        _assert_receipt_pairing(["https://r2/a.pdf"], ["org/1/a.pdf", "org/1/b.pdf"],
                                where="create_expense")
    assert e.value.status_code == 422
    detail = str(e.value.detail)
    # The message has to carry BOTH counts, or the caller cannot tell which end
    # is wrong — the same reason `assert_file_urls` names the index.
    assert "2 receipt key" in detail and "1 receipt url" in detail
    assert "create_expense" in detail


def test_the_refusal_says_what_to_do_about_it():
    """A refusal a caller cannot act on is the failure mode this suite tracks.

    It has to name the rule (paired by position) and the remedy (one key per
    uploaded file, none for a typed link) rather than only stating that the
    counts differ.
    """
    with pytest.raises(HTTPException) as e:
        _assert_receipt_pairing([], ["org/1/a.pdf"], where="update_expense")
    detail = str(e.value.detail).lower()
    assert "position" in detail
    assert "typed by hand" in detail or "hand" in detail


def test_both_write_paths_call_it():
    """A rule enforced on create and not on update is not enforced.

    `update_expense` reaches the same column as `create_expense`; the router
    already carries that sentence about `assert_file_urls` and it applies to
    this check for the same reason.

    ⚠ COMMENTS ARE STRIPPED BEFORE MATCHING. Twice in this codebase a
    source-reading assertion passed by matching its own explanatory prose, and
    the comments around these calls quote the function name.
    """
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "routers" / "ganit.py"
    code = "\n".join(
        line for line in src.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("#")
    )
    assert code.count("_assert_receipt_pairing(") >= 3, (
        "the pairing guard is called fewer than twice plus its definition, so "
        "one of create_expense / update_expense is writing receipt_keys without "
        "checking that they line up with receipt_urls"
    )
    assert 'where="create_expense"' in code, "create_expense no longer checks the pairing"
    assert 'where="update_expense"' in code, "update_expense no longer checks the pairing"


def test_the_column_is_written_and_read():
    """The guard is worthless if the column never reaches the database.

    This is the assertion that stops the others being satisfiable by a route
    that validates a field it then drops — which is exactly the defect this
    whole change repairs, one layer up: `BLANK` had no `contact_id` key, so a
    validated, accepted, INSERT-ready column was never sent.
    """
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "routers" / "ganit.py"
    code = "\n".join(
        line for line in src.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("#")
    )
    assert "receipt_urls, receipt_keys, is_billable" in code, (
        "the expense INSERT no longer names receipt_keys, so an uploaded "
        "receipt's key is validated and then thrown away — and the url beside "
        "it dies in nine hours with nothing left to re-sign from"
    )
    assert "e.receipt_keys, " in code, (
        "list_expenses no longer selects receipt_keys, so it cannot re-sign and "
        "every receipt link goes dead within the day"
    )
    assert "fresh = await sign_key(org_id, k)" in code, (
        "list_expenses no longer re-signs from the key"
    )
