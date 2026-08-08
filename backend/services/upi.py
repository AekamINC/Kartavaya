"""
upi.py — the org's receiving UPI addresses: which platforms exist, what a VPA
may look like, and the ONE function that builds a `upi://pay` string.

── One ID per platform, which is not what I first argued ────────────────────

UPI is interoperable, so a single VPA is payable from every app. That fact is
true and it answers a different question: it means anyone can PAY you, not that
you hold one ACCOUNT. A firm with separate Paytm, PhonePe and Google Pay
accounts (`…@paytm`, `…@ybl`, `…@okhdfcbank`) has three that settle and report
separately, and choosing which one receives is an ordinary business decision.
So the model is a row per platform, not a column on `organisations`.

The second benefit is reconciliation. There is no payment gateway anywhere in
this product, so a payment is matched against a bank statement by hand. The
plan for that was to INFER which service was used from the PAYER's handle
(`@ybl` -> PhonePe), which is a guess and is wrong whenever someone pays a
PhonePe address from Google Pay. With a receiving ID per platform there is
nothing to infer: the address the money arrived at names the account it landed
in.

── Every QR is a standard `upi://` code, whichever platform it belongs to ────

`phonepe://` and `paytmmp://` codes are app deep links, NOT UPI QR codes: other
apps and every bank scanner reject them. The platform therefore selects WHICH
ADDRESS is encoded and nothing else — the encoding itself is identical. A
"PhonePe QR" here means "the QR for the account you hold at PhonePe", payable
from any app, which is what the customer standing in front of it expects.
"""
import re

#: The platforms an org can hold an account with, in display order.
#:
#: `other` is deliberately last and deliberately vague: UPI handles are issued
#: by banks and by dozens of PSPs, and an allow-list that tried to name them all
#: would be wrong within a month and would block a legitimate address for the
#: sake of tidiness. An org with an `@okaxis` address it thinks of as "the bank
#: one" puts it here and names it.
PLATFORMS: tuple[str, ...] = (
    "phonepe",
    "gpay",
    "paytm",
    "bhim",
    "amazonpay",
    "other",
)

PLATFORM_LABELS: dict[str, str] = {
    "phonepe": "PhonePe",
    "gpay": "Google Pay",
    "paytm": "Paytm",
    "bhim": "BHIM",
    "amazonpay": "Amazon Pay",
    "other": "Other UPI app",
}

#: What each platform's handles usually look like, shown as a placeholder ONLY.
#:
#: NOT validated against. A PhonePe user can and does hold `@ybl`, `@ibl`,
#: `@axl`, or a bank handle they registered years ago; refusing an address
#: because it does not end in the suffix we expected would reject a working
#: account and there is no way for the user to argue with it. The hint helps
#: someone who is guessing; it never blocks someone who knows.
PLATFORM_HINTS: dict[str, str] = {
    "phonepe": "yourname@ybl",
    "gpay": "yourname@okhdfcbank",
    "paytm": "9876543210@paytm",
    "bhim": "yourname@upi",
    "amazonpay": "yourname@apl",
    "other": "yourname@bank",
}

#: NPCI's shape: `identifier@handle`. No spaces, no angle brackets, one `@`.
#:
#: Kept loose on purpose — see PLATFORM_HINTS. The check that actually matters
#: is not this expression, it is the org scanning its own QR before an invoice
#: goes out, because a well-formed address pointing at the wrong account looks
#: exactly like a correct one and there is no gateway to bounce the money back.
_VPA = re.compile(r"^[a-zA-Z0-9._\-]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$")

MAX_PAYEE_NAME = 60


def is_vpa(v: str) -> bool:
    return bool(_VPA.match((v or "").strip()))


def normalise(v: str) -> str:
    """Lower-cased and trimmed.

    UPI handles are case-insensitive and users paste them with a capital from
    an app's share sheet. Storing `Name@YBL` and `name@ybl` as two different
    values would let one org hold what is really the same address twice and
    make the unique constraint useless.
    """
    return (v or "").strip().lower()


def label(platform: str) -> str:
    return PLATFORM_LABELS.get(platform, platform)


def pay_uri(vpa: str, payee_name: str, amount: float | None, note: str) -> str:
    """The one place a `upi://pay` string is built.

    Every consumer — the public QR, the settings preview, the page's buttons —
    comes through here, so a change to the parameter set cannot land in one and
    miss another. The failure that would cause is a QR that pays the right
    account and a button that pays nothing, on the same screen.

    `am` is two decimals when present: UPI apps read `100` and `100.00` the same
    way, but some PSP scanners are fussy and the cost of being exact is nothing.

    `amount=None` OMITS `am` entirely and the payer types the figure. That is
    the settings-screen preview: a verification code carrying a real amount is
    one accidental confirm away from the org paying itself, and a code carrying
    a token amount trains people to ignore the number on a payment screen.
    """
    from urllib.parse import urlencode

    params = {
        "pa": normalise(vpa),
        "pn": (payee_name or "").strip(),
    }
    if amount is not None:
        params["am"] = f"{float(amount):.2f}"
    return "upi://pay?" + urlencode(
        {
            **params,
            "cu": "INR",
            # Free-text reference the payer sees and, more usefully, the one
            # that shows up on the org's own statement beside the credit.
            "tn": (note or "").strip()[:60],
        }
    )
