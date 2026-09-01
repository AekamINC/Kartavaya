"""IFSC lookup — which bank and branch a code actually names.

── WHY THIS IS ITS OWN ROUTER, AND NOT MODULE-GATED ────────────────────────

An IFSC is typed in at least three places that belong to different modules: an
employee's salary account (`manav`), a client's or vendor's bank details
(`graha`, `ganit`), and the firm's own. Hanging the lookup off any one of them
would gate a public reference dataset behind a module subscription the caller
may not hold — a firm with payroll but not the CRM would be able to check an
employee's IFSC and not a vendor's, for no reason a customer could ever guess.

So it is `require_user` and nothing else. **That is deliberate and it is the
whole access decision**: the RBI branch directory is public information, it
carries no tenant data, and a signed-in user learning that HDFC0000123 is the
Fort branch in Mumbai has learned nothing about anybody. It is not left
unauthenticated either — an open endpoint that reads 618 R2 objects is a free
amplifier for anyone who finds it, and `require_user` costs a legitimate caller
nothing.

── THE THREE OUTCOMES ARE THREE OUTCOMES ───────────────────────────────────

⚠ `unavailable` MUST NOT BE DRAWN AS A VALIDATION FAILURE. A form that turns
"R2 could not be read" into "that IFSC is wrong" tells a payroll clerk their
correct bank details are invalid, during an outage, at the moment they are
trying to pay people. `describe()` keeps the cases apart precisely so no caller
has to guess, and this route passes them through unflattened.
"""
from fastapi import APIRouter, Depends

from auth_router import require_user
from services import ifsc_directory

router = APIRouter(prefix="/api/v1/reference", tags=["reference"])


@router.get("/ifsc/{ifsc}")
async def lookup_ifsc(ifsc: str, user=Depends(require_user)):
    """The branch an IFSC names.

    Always 200. A code that is malformed, unknown or momentarily unreadable is
    a `status`, not an HTTP error: this is a lookup a form runs while somebody
    is still typing, and a 404 per keystroke would fill the console with red
    for the ordinary case of a half-typed code.
    """
    return await ifsc_directory.describe(ifsc)
