"""report_delivery.py — a scheduled report leaves as an ENCRYPTED PDF, or it
leaves without the numbers in it. There is no third shape.

── WHAT THIS REPLACES ──────────────────────────────────────────────────────

`routers/dristi.py::_deliver_scheduled_report` rendered the letterhead document
and mailed it AS THE EMAIL BODY. `module_report.render_report_html`'s own
docstring said so: "report.send mails it as the body (the gated transport has
no attachment support yet, and the HTML **is** the report)". So a firm's
finance page — turnover, receivables, who sold what — sat unencrypted in
however many mailboxes the schedule named, for ever.

The owner's instruction, 2026-08-29: "report email needs to be in pdf as this
email is not secure". A plain PDF attachment is not more secure than a body —
both sit unencrypted in the recipient's mailbox — and the owner, given that,
chose PASSWORD-PROTECTED PDF. That is what this module does.

── THE PASSPHRASE RULES, AND THEY ARE STRUCTURAL, NOT POLICY ───────────────

1. **The passphrase is NEVER emailed.** Mailing it beside the PDF puts both in
   one mailbox and buys exactly nothing. This is enforced by SHAPE rather than
   by care: `covering_note()` — the only thing that builds the email body —
   TAKES NO PASSPHRASE ARGUMENT. It cannot leak what it was never handed.
   `tests/test_report_delivery.py::test_the_covering_note_cannot_be_handed_the_passphrase`
   pins the signature.

2. **The passphrase is NEVER logged.** Nothing in this module passes it to a
   logger, an exception message, or `outbound_log`. `Delivery.reason` is a
   sentence about the DECISION, never about the value. A test greps for it.

3. **It is a DOCUMENT passphrase, not an auth credential, and the honest
   consequence is that it CANNOT BE HASHED** — we have to hold the plaintext to
   encrypt with it. So it is stored reversibly, encrypted at rest through
   `services/encryption.py` (Fernet, key from `FIELD_ENCRYPTION_KEY`), whose own
   docstring states the limit: the key sits in an environment variable beside
   the data, so this is protection against a database dump and a leaked
   read-only connection string, and it is NOT a KMS. Treat the value as a
   SHARED SECRET the firm's admins hand out, not as a password.

── WHAT HAPPENS WHEN THERE IS NO PASSPHRASE — DECIDED, NOT DEFAULTED ───────

The brief named the two candidates: refuse to dispatch, or fall back to a link
behind login. **DECIDED: the link fallback, and the email SAYS why.**

Refusing looked safer and is not. A refused schedule produces a 'failed' row in
`staging.dristi_report_logs` and nothing a person ever sees — and this exact
product has already run seven schedules that "had never dispatched once" while
nobody noticed. A silent stop is indistinguishable from a working schedule with
nothing to report.

The link fallback is strictly safer than what shipped before it: today's mail
carries the WHOLE REPORT in the body; the fallback carries no figures at all,
only a sentence and a link that requires a login. So every branch of this
module discloses less than the code it replaces. It also tells the one person
who can fix it exactly how, in the place they will actually read.

⚠ It is NOT a silent downgrade — the three things that make a downgrade silent
are all closed: the email states in words that no PDF is attached and why, the
`outbound_log` row carries `delivery=` naming the branch taken, and the
`dristi_report_logs` row carries the same sentence.

── THE SIZE GUARD ──────────────────────────────────────────────────────────

Added on the owner's question, 2026-08-29: "SES raw MIME with attachment —
sometimes some email servers reject saying 552 too long. Will ours do the
same?"

There was NO size check anywhere in this product. `send_report_email` computes
`attachment_bytes` for the outbound record and nothing ever compares it to a
limit.

THE NUMBER, READ FROM AWS RATHER THAN ASSUMED (docs.aws.amazon.com/ses/latest/
dg/quotas.html, read 2026-08-29): **SES v1 API — maximum message size including
attachments, 10 MB per message, AFTER BASE64 ENCODING. Not adjustable.** (SES
v2 and SMTP are 40 MB, but this product calls `ses_client.send_raw_email`,
which is v1. Migrating to v2 is a separate piece of work and is not folded in
here.) "After base64 encoding" is the load-bearing half: the limit applies to
the message SES receives, and base64 inflates a payload by ~33% plus a newline
every 76 characters.

⚠ **AND SES'S LIMIT IS NOT THE RISK.** SES refusing is SYNCHRONOUS — it raises,
`Attempt.failed()` records it, and we find out. The 552 the owner asked about
comes from the RECIPIENT'S server, arrives asynchronously, and this product has
**no bounce feedback path at all**: `staging.outbound_log`'s status vocabulary
is `queued · sent · suppressed · failed` — measured live 2026-08-29, 425 sent /
174 failed / 116 suppressed, and no `bounced` in the table or in the code — and
no SNS endpoint exists to receive one. So a recipient-side refusal would land
nowhere while the row already read `sent`. That is exactly how 960 payslips
were "sent" and hard-bounced (proposal 93 §3).

Since we cannot HEAR a 552, the only defence is not to provoke one. So the
ceiling here is deliberately below SES's:

  · SES v1 hard refusal ............... 10 MB encoded
  · Gmail receiving .................... ~25 MB
  · Many corporate MTAs ................ 10 MB, and some 5 MB
  · A receiving MTA adds its own Received/DKIM/ARC headers on top of what we
    send, so our number must sit under theirs with room.

`MAX_ENCODED_BYTES` therefore defaults to **7 MiB**, ~30% under the 10 MB line
SES and the strictest common corporate limit share. It is env-overridable
(`REPORT_MAX_ENCODED_BYTES`) because it is a judgement about other people's
mail servers, not a fact about ours.

MEASURED, so the guard is understood as the runaway guard it is rather than a
working limit. Live Unicode Group reports pulled from staging 2026-08-29:

                                    PDF    encrypted    ON THE WIRE   of 7 MiB
    Finance, one week ........... 18,970       25,823         52,179      0.71%
    CRM, one week ............... 20,171       27,055         53,844      0.73%
    Finance, one YEAR ........... 19,211       26,083         52,531      0.72%
    Sales register, one year .... 32,320       40,041         71,384      0.97%
    Finance XLSX, one year ....... 7,710            —              —          —

"ON THE WIRE" is the figure this module compares against the ceiling: the
encrypted PDF base64'd, plus the covering note (11,464 B), plus the modelled
MIME framing. The worst real shape measured is **under one per cent** of our
own budget and under 0.7% of what SES would refuse.

So the normal case is three orders of magnitude under the ceiling, and this
guard exists for the two shapes that can actually reach it: a register at
`_shared.ROW_CAP` (5,000 rows), and — the real one — the letterhead's embedded
logo, which `doc_render._LOGO_MAX_BYTES` admits at up to **4 MiB**. A 4 MiB
logo is ~5.4 MiB once base64'd into the MIME part, and a PDF plus an XLSX are
CUMULATIVE against the same limit. That is a reachable 10 MB, from a
configuration a customer can set from the product.

⚠ NOTE THE MEASUREMENT ORDER. Encryption INFLATES the document — 18,970 B →
25,823 B, +36% on a small report, because pypdf does not recompress the cloned
object streams. So the size is measured on the ENCRYPTED bytes, which is the
only figure that describes what actually travels. Measuring the plain PDF and
attaching the encrypted one is how a guard passes and the message still fails.

── WHAT THIS MODULE DOES NOT DO ────────────────────────────────────────────

It does not build the MIME document, resolve the from-address, or write the
outbound row — `services/pdf_email.send_pdf_email` already does all three and
already honours the `OUTBOUND_MODE` gate that two hand-rolled attachment
senders each missed. This module decides WHAT to send; that one sends it.
"""
from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass

log = logging.getLogger(__name__)

# ── The limits ──────────────────────────────────────────────────────────────

#: SES v1 `SendRawEmail`, maximum message size including attachments, AFTER
#: base64 encoding. Read from AWS's published quotas 2026-08-29, not assumed,
#: and marked "Adjustable: No". Kept as a named constant because it is a fact
#: about the provider and must not be confused with our own budget below.
SES_V1_MAX_ENCODED_BYTES = 10 * 1024 * 1024

#: OUR budget — what we are willing to hand a recipient's mail server. Under
#: SES's ceiling on purpose: see THE SIZE GUARD above. This is a judgement
#: about other people's MTAs, so it is overridable without a code change.
_DEFAULT_MAX_ENCODED_BYTES = 7 * 1024 * 1024


def max_encoded_bytes() -> int:
    """The ceiling for one report message, in bytes on the wire.

    Read at CALL time, not at import, so the value can be changed on Railway
    and verified without a redeploy of this module's import semantics being
    part of the question — the same reason `dristi._sweep_armed()` reads its
    variable late.

    A value above `SES_V1_MAX_ENCODED_BYTES` is clamped rather than honoured: an
    operator raising this past the provider's own hard refusal has configured a
    guard that cannot fire before SES does, which is a guard that does nothing.
    A non-numeric or non-positive value falls back to the default rather than
    disabling the check, because an unparseable limit must not read as "no
    limit".
    """
    raw = os.getenv("REPORT_MAX_ENCODED_BYTES", "").strip()
    if not raw:
        return _DEFAULT_MAX_ENCODED_BYTES
    try:
        value = int(raw)
    except ValueError:
        log.warning("REPORT_MAX_ENCODED_BYTES=%r is not an integer — using the "
                    "default of %d bytes", raw, _DEFAULT_MAX_ENCODED_BYTES)
        return _DEFAULT_MAX_ENCODED_BYTES
    if value <= 0:
        log.warning("REPORT_MAX_ENCODED_BYTES=%d is not positive — using the "
                    "default of %d bytes", value, _DEFAULT_MAX_ENCODED_BYTES)
        return _DEFAULT_MAX_ENCODED_BYTES
    return min(value, SES_V1_MAX_ENCODED_BYTES)


# ── The passphrase ──────────────────────────────────────────────────────────

#: Where it lives: `staging.organisations.settings->'reports'->>'passphrase'`,
#: holding a Fernet ciphertext.
#:
#: A jsonb KEY rather than a column or a table, which is the decision
#: `services/purchase_orders.py` and `doc_prefixes` already took, for the reason
#: that file states in words: "code ships on merge and migrations are applied by
#: hand afterwards, and a settings table that does not exist yet 500s the whole
#: module for the gap between". It also means this lands with NO MIGRATION —
#: and migrations are the lead's alone on this programme (proposal 93 §14), not
#: sub-delegable.
#:
#: ⚠ It is safe HERE and would not be safe in `organisations`' own columns.
#: `routers/org_profile._PROFILE_COLUMNS` is simultaneously the GET projection,
#: the PATCH allowlist and the RETURNING list; a column added to it is returned
#: to every caller of `GET /api/v1/org/profile`, which `middleware/
#: org_resolver.py` records is reachable by a support operator. `settings` is
#: NOT in that tuple and no route returns the blob whole — checked, not assumed:
#: every reader in the backend reads one key (`settings->>'lead_capture_email'`,
#: `settings->'doc_prefixes'`, `settings->'purchase_orders'`,
#: `settings->>'publish_batch_limit'`), and there is no `SELECT *` over
#: `staging.organisations` in any router or service.
SETTINGS_KEY = "reports"
PASSPHRASE_FIELD = "passphrase"

#: Short enough to type off a screen, long enough not to be guessed from a
#: stolen mailbox. This is a shared document secret, not a login: rate limiting
#: cannot protect it, because an attacker holding the PDF attacks it offline.
PASSPHRASE_MIN_LENGTH = 12
PASSPHRASE_MAX_LENGTH = 128


def passphrase_problem(value: str) -> str:
    """Why this passphrase may not be saved, or '' if it may.

    Returns a SENTENCE for the person typing it, not a code. Deliberately
    permissive about character classes: a composition rule ("one capital, one
    digit") makes a passphrase harder to read off a screen and type into a PDF
    reader, which is the whole workflow here, and buys almost nothing against an
    offline attack that length does buy a great deal against.

    ⚠ Whitespace is REJECTED at the ends rather than trimmed. A trimmed value
    saved is a different string from the one the person typed, and they will
    type what they typed when they open the PDF.
    """
    if value is None:
        return "Enter a passphrase."
    if value != value.strip():
        return ("The passphrase cannot start or end with a space — it will not "
                "be typed back that way when the PDF is opened.")
    if len(value) < PASSPHRASE_MIN_LENGTH:
        return (f"Use at least {PASSPHRASE_MIN_LENGTH} characters. This protects "
                f"a document somebody can attack offline, so length is the only "
                f"thing that helps.")
    if len(value) > PASSPHRASE_MAX_LENGTH:
        return f"Use at most {PASSPHRASE_MAX_LENGTH} characters."
    if "\n" in value or "\r" in value or "\t" in value:
        return "The passphrase cannot contain a line break or a tab."
    return ""


async def load_passphrase(pool, org_id: str) -> str:
    """This org's report passphrase in plaintext, or '' if none is set.

    Returns '' — never raises — on every failure mode, because the CALLER's
    answer to "no passphrase" and to "the passphrase is unreadable" is the same
    safe one: send the link, not the numbers. Raising here would turn an
    unreadable secret into a dispatch failure, and a failed dispatch is the
    outcome this module's fallback exists to avoid.

    An unreadable value is LOGGED WITHOUT THE VALUE. That case is real:
    `services/encryption` falls back to `JWT_SECRET` when `FIELD_ENCRYPTION_KEY`
    is unset, and rotating `JWT_SECRET` makes every field encrypted under it
    permanently unreadable, with nothing failing at rotation time.
    """
    from services import encryption

    try:
        raw = await pool.fetchval(
            "SELECT settings->$2::text->>$3::text "
            "  FROM public.organisations WHERE id = $1::uuid",
            str(org_id), SETTINGS_KEY, PASSPHRASE_FIELD)
    except Exception:
        log.warning("report_delivery: settings read failed for org %s", org_id)
        return ""
    if not raw:
        return ""
    try:
        return encryption.decrypt(raw)
    except Exception:
        # Never the ciphertext and never the plaintext — only the fact.
        log.warning("report_delivery: org %s has a report passphrase that "
                    "cannot be decrypted; falling back to the link shape",
                    org_id)
        return ""


# ── Encryption ──────────────────────────────────────────────────────────────

#: pypdf's own name for the algorithm. `pypdf==6.14.2` is already pinned in
#: requirements.txt for the eSign signature-page bind, so NO NEW DEPENDENCY was
#: added for this — confirmed against the pinned version's actual signature
#: rather than assumed: `PdfWriter.encrypt(user_password, owner_password=None,
#: use_128bit=True, permissions_flag=..., *, algorithm=None)`, and `algorithm`
#: accepts "AES-256". Passing `algorithm` makes `use_128bit` ignored.
PDF_ALGORITHM = "AES-256"


def encrypt_pdf(pdf_bytes: bytes, passphrase: str) -> bytes:
    """The same document, AES-256 encrypted, openable only with `passphrase`.

    Proved on a REAL report, not a fixture (live Unicode finance report pulled
    from staging 2026-08-29): 18,970 B in, 25,823 B out; `PdfReader` raises
    `FileNotDecryptedError` on any page access without a password;
    `decrypt('wrong')` returns 0; `decrypt(<the passphrase>)` returns a truthy
    `PasswordType` and the pages read.

    ⚠ THE OWNER PASSWORD IS THE SAME STRING, DELIBERATELY. pypdf defaults
    `owner_password` to the user password, so one passphrase both opens the
    document and carries full permissions. A distinct random owner password
    would let us set restrictive permission FLAGS — and PDF permission flags are
    advisory, honoured by nothing that matters, and unset by any of a dozen free
    tools. Claiming them as protection would be the security theatre this design
    was chosen over. The encryption is the boundary; the flags are not.

    Refuses an empty passphrase rather than producing an un-passworded document.
    `PdfWriter.encrypt("")` succeeds and yields a PDF that opens with no
    password at all — which would be the silent unencrypted send this whole
    module exists to make impossible, wearing the word "encrypted".
    """
    if not passphrase:
        raise ValueError(
            "refusing to encrypt with an empty passphrase — pypdf accepts it "
            "and produces a document that opens with no password, which is an "
            "unencrypted report labelled as an encrypted one")
    if not pdf_bytes:
        raise ValueError("refusing to encrypt an empty document")

    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)
    writer.encrypt(passphrase, algorithm=PDF_ALGORITHM)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# ── The size arithmetic ─────────────────────────────────────────────────────

def encoded_message_bytes(pdf_bytes: bytes, html_content: str) -> int:
    """What SES will actually receive, in bytes, before the message is built.

    Deliberately NOT `len(pdf_bytes)`. `services/employee_email._metered_bytes`
    already models this exactly — base64 at 57 bytes in per 77 out, plus the
    modelled fixed MIME framing and text alternative — and its docstring records
    that it was checked against the real `msg.as_bytes()` at nine PDF sizes from
    20 KB to 900 KB and matched to the byte. Importing it rather than writing a
    second model is the whole point: `len(pdf_bytes)` stood in the payslip
    sender once and was ~30% short on every message.
    """
    from services.employee_email import _metered_bytes

    return _metered_bytes(pdf_bytes, html_content)


# ── The decision ────────────────────────────────────────────────────────────

#: The report travelled as an encrypted attachment. The only branch that puts
#: figures in a mailbox, and they are behind AES-256.
MODE_ENCRYPTED_PDF = "encrypted_pdf"
#: No passphrase is configured for this org. No figures were sent.
MODE_LINK_NO_PASSPHRASE = "link_no_passphrase"
#: The encrypted document was too large to hand a recipient's mail server
#: safely. No figures were sent.
MODE_LINK_TOO_LARGE = "link_too_large"
#: WeasyPrint could not render — the native stack is missing on this host. No
#: figures were sent.
MODE_LINK_NO_PDF = "link_no_pdf_engine"

#: Every branch that sends a link instead of the numbers. Named as a set so a
#: caller can ask the question once, and so a branch added later cannot be
#: forgotten by a caller testing `== MODE_ENCRYPTED_PDF` three places over.
LINK_MODES = frozenset({MODE_LINK_NO_PASSPHRASE, MODE_LINK_TOO_LARGE,
                        MODE_LINK_NO_PDF})


@dataclass(frozen=True)
class Delivery:
    """What to send, and the sentence that says why it is that shape.

    `reason` is printed IN THE EMAIL and recorded on both the `outbound_log`
    row and the `dristi_report_logs` row. That is the whole anti-silence
    contract: a recipient who gets a link instead of a report is told why in the
    mail, and an operator reading either table finds the same sentence.

    ⚠ `reason` NEVER contains the passphrase and never contains a figure from
    the report. It describes the decision.
    """

    mode: str
    #: The bytes to attach — the ENCRYPTED document — or None on a link branch.
    pdf: bytes | None
    reason: str
    #: What the message would weigh on the wire. Recorded even on a link branch,
    #: because "how big was the thing we refused to send" is the number an
    #: operator needs to decide whether the ceiling is set wrongly.
    encoded_bytes: int

    @property
    def attaches(self) -> bool:
        return self.mode == MODE_ENCRYPTED_PDF


def decide(pdf_bytes: bytes | None, covering_html: str, passphrase: str,
           *, limit: int | None = None) -> Delivery:
    """Pure. Which shape this report leaves in, and why.

    Pure on purpose, and it is the same reason `sales_register.build_rows` is
    pure: the branch that matters most — "too large, do not send" — is the one
    that is hardest to reach with a real database behind it, and a decision
    function with no I/O can be driven to every branch in a unit test.

    ORDER MATTERS AND IS NOT ARBITRARY:

      1. no PDF at all  — WeasyPrint is missing or produced nothing.
      2. no passphrase  — asked BEFORE encrypting, because encrypting with ''
                          is the silent-unencrypted-send failure.
      3. encrypt.
      4. measure THE ENCRYPTED BYTES against the ceiling. Not the plain ones:
         AES-256 inflated a real 18,970 B report to 25,823 B, +36%, and a guard
         that measures the input while the output travels is a guard that
         passes on a message that fails.

    A failure inside pypdf lands on the link branch rather than raising. The
    caller's alternative is a dead schedule, and this module's whole argument is
    that a link is safer than both the body-mailed report it replaces and a
    silence nobody notices.
    """
    ceiling = max_encoded_bytes() if limit is None else limit

    if not pdf_bytes:
        return Delivery(
            MODE_LINK_NO_PDF, None,
            "The PDF could not be produced on the server, so this email "
            "carries no attachment. Open the report in Kartavaya instead.",
            encoded_message_bytes(b"", covering_html))

    if not passphrase:
        return Delivery(
            MODE_LINK_NO_PASSPHRASE, None,
            "No report passphrase is set for this organisation, so the report "
            "has NOT been attached — an unprotected PDF in a mailbox is exactly "
            "what the passphrase exists to prevent. An administrator can set "
            "one in Settings → Organisation → Reports, and the next "
            "report will arrive as an encrypted PDF.",
            encoded_message_bytes(b"", covering_html))

    try:
        encrypted = encrypt_pdf(pdf_bytes, passphrase)
    except Exception as exc:                    # noqa: BLE001
        # The type, never the passphrase, and never the document.
        log.warning("report_delivery: encryption failed (%s) — falling back to "
                    "the link shape", type(exc).__name__)
        return Delivery(
            MODE_LINK_NO_PDF, None,
            "The report could not be encrypted on the server, so it has NOT "
            "been attached. Open it in Kartavaya instead.",
            encoded_message_bytes(b"", covering_html))

    encoded = encoded_message_bytes(encrypted, covering_html)
    if encoded > ceiling:
        return Delivery(
            MODE_LINK_TOO_LARGE, None,
            f"This period's report is {_mb(encoded)} once encrypted and "
            f"prepared for sending, which is over the {_mb(ceiling)} limit this "
            f"product will hand a mail server, so it has NOT been attached. "
            f"Open it in Kartavaya, or schedule a shorter period.",
            encoded)

    return Delivery(MODE_ENCRYPTED_PDF, encrypted,
                    "Attached as a password-protected PDF.", encoded)


def _mb(n: int) -> str:
    """A size a person reads. KB under a megabyte, MB above it."""
    if n < 1024 * 1024:
        return f"{n / 1024:.0f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


# ── The covering note ───────────────────────────────────────────────────────

#: The filename a recipient sees. No org name and no member name in it: a
#: filename survives being forwarded, saved to a shared drive and indexed by a
#: search tool, and it is the one part of an encrypted document that is never
#: encrypted.
def filename(label: str, period_start, period_end) -> str:
    """`Kartavaya-Finance-report-2026-08-23-2026-08-29.pdf`.

    `label` comes from `module_report.MODULE_TITLES`, a server-side map — never
    from the schedule's user-typed name — so nothing a customer can type reaches
    a `Content-Disposition` header.
    """
    safe = "".join(c if c.isalnum() else "-" for c in str(label)).strip("-")
    return f"Kartavaya-{safe or 'module'}-report-{period_start}-{period_end}.pdf"


def covering_note(*, org, report_name: str, label: str, period_line: str,
                  delivery: Delivery, frontend_url: str,
                  skipped_recipients: int = 0) -> str:
    """The email body — a covering note, NEVER the report.

    ⚠ THIS FUNCTION TAKES NO PASSPHRASE AND MUST NEVER TAKE ONE. That is the
    structural half of rule 1 at the top of this file: the only builder of the
    email body has no access to the secret, so no future edit here can leak it
    by accident. `tests/test_report_delivery.py` pins the signature, and it
    fails if `passphrase` is ever added as a parameter.

    EVERY USER-CONTROLLED FIELD IS ESCAPED, at the choke points `CLAUDE.md`
    names. `report_name` is typed by a customer into the schedule form and
    `org['name']` is typed into the org profile; both go through `html.escape`
    here, and both also travel through `_info_card`, which escapes label and
    value again. `label` and `period_line` are server-derived and are escaped
    anyway rather than being trusted on the strength of where they came from.
    """
    from html import escape as _h

    from email_service import (_base, _body_text, _cta_row, _info_card,
                               _notice)

    org_name = str((org or {}).get("name") or "your organisation")
    rows = [("REPORT", str(report_name)),
            ("MODULE", str(label)),
            ("PERIOD", str(period_line))]
    if delivery.attaches:
        rows.append(("ATTACHMENT", "Password-protected PDF"))

    if delivery.attaches:
        lede = (f"The {_h(label)} report for <strong>{_h(org_name)}</strong> is "
                f"attached as a password-protected PDF.")
        # THE SENTENCE THAT REPLACES MAILING THE PASSPHRASE. It says where the
        # passphrase lives, never what it is.
        note = _notice(
            "Opening it needs your organisation's <strong>report "
            "passphrase</strong>. It is not in this email and never will be — "
            "a passphrase sent beside the document it protects protects "
            "nothing. An administrator can read it in "
            "<strong>Settings → Organisation → Reports</strong>.",
            tone="warn")
        cta = _cta_row(f"{frontend_url}/analytics", "Open Kartavaya", "primary")
    else:
        lede = (f"The {_h(label)} report for <strong>{_h(org_name)}</strong> "
                f"was produced, and it is not attached to this email.")
        note = _notice(_h(delivery.reason), tone="warn")
        cta = _cta_row(f"{frontend_url}/analytics", "Open the report", "primary")

    body = (
        _body_text(f"The scheduled report <strong>{_h(str(report_name))}</strong> "
                   f"has run for <strong>{_h(str(period_line))}</strong>.")
        + _info_card(rows)
        + note
        + cta
    )
    if skipped_recipients:
        # Said in the mail as well as in the log row. A recipient silently
        # dropped reads as a send that failed — `member_recipients` returns the
        # count precisely so a caller can SAY it, and until now nobody did.
        body += _body_text(
            f"{skipped_recipients} address(es) on this schedule were not sent "
            f"to, because reports go only to members of {_h(org_name)}.")

    return _base(
        preheader=f"{report_name} — {label} report, {period_line}",
        kicker="SCHEDULED REPORT",
        headline=f"{label} report",
        sanskrit="प्रतिवेदन",
        lede=lede,
        body_rows=body,
    )
