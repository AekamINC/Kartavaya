"""esign_signed_doc.py — the counter-signed PDF an e-signature product exists to produce.

What was wrong
--------------
`esign._generate_signed_certificate` serialised the audit data to JSON, uploaded
it as `certificate-<id>.json` with content type `application/json`, and wrote
that object's key into the columns named `signed_file_key` / `signed_file_url`.
The original PDF and the collected signatures were never combined anywhere, so
the product's entire deliverable — the executed document — did not exist. The
signing party's only download was a machine-readable audit blob labelled
"Signing certificate", and only 11 of 27 completed documents had even that.

What this does
--------------
Builds the executed document: the ORIGINAL pages, unaltered, followed by a
signature page that records who signed, when, from where, by what method, and
whether their identity was verified by OTP — with each signature reproduced as
it was drawn or typed. That page is the evidence a reader needs while holding
the contract; the JSON certificate remains, separately, for a machine.

The original is never re-rendered, only appended to. Re-rendering would change
the bytes the signers actually saw and agreed to, which is the one thing
`file_hash` exists to make detectable (IT Act §10A, alterations detectable).
The hash of the original is printed on the signature page for the same reason.

Non-PDF originals
-----------------
`sign_documents.file_key` is whatever was uploaded. Everything in the live data
is a PDF, but an image or a .docx cannot be appended to. In that case the signed
artefact is the signature page ALONE, and it says so in as many words while
naming the original file and its hash — rather than silently producing a
document that looks executed but contains no agreement.

Signature data is untrusted
---------------------------
`signature_data` arrives from the public signing endpoint, so it is treated as
hostile: only a `data:image/{png,jpeg,gif,webp};base64,…` value of bounded size
is ever emitted into an `<img src>`, and anything else is escaped and printed as
text. A URL is never passed through — WeasyPrint would fetch it at render time,
turning a stored string into an outbound request from the server.
"""
from __future__ import annotations

import base64
import io
import logging
import re
from datetime import datetime, timedelta, timezone

from services import doc_render as R

log = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

# A drawn signature is a small canvas PNG; a megabyte of it is not a signature.
# Bounded so one signer cannot make the executed document unopenable for anyone.
MAX_SIGNATURE_BYTES = 512 * 1024
# The whole signature page's image allowance, not one signature's. Ten signers
# under the per-signature cap used to mean 5MB of embedded PNG in a page this
# product generates itself; everything we generate is meant to stay in
# kilobytes. The page is text and vector apart from these images, so this
# number is very nearly the page's whole size.
MAX_SIGNATURE_TOTAL_BYTES = 512 * 1024

_DATA_IMAGE = re.compile(r"^data:image/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$")

_METHOD = {
    "draw": "Drawn",
    "type": "Typed",
    "upload": "Uploaded image",
}


def _ist(value) -> str:
    """A timestamp as the reader's clock shows it. Blank when there is none."""
    if not value:
        return ""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST).strftime("%d %b %Y, %H:%M IST")


class _Budget:
    """How many bytes of signature image this ONE page may still embed.

    `MAX_SIGNATURE_BYTES` bounds a single signature and always did. Nothing
    bounded the page: ten signers each just under the per-signature limit is
    5MB of embedded PNG in a document we generate ourselves, and the owner's
    requirement is that everything we generate stays in kilobytes. The budget
    is spent in signing order, so the earliest signatories are the ones
    reproduced — an arbitrary rule, but a stable and explainable one, and the
    page says plainly what it did not draw.
    """

    __slots__ = ("left",)

    def __init__(self, total: int = MAX_SIGNATURE_TOTAL_BYTES):
        self.left = total

    def take(self, n: int) -> bool:
        if n > self.left:
            return False
        self.left -= n
        return True


def signature_mark(signature_data, signature_type: str, budget: "_Budget | None" = None) -> str:
    """The signature itself, reproduced — or its text, escaped.

    Returns markup for exactly one of three cases, and never anything else:
    a bounded inline image, escaped text, or an empty ruled space. In
    particular a bare URL is NOT rendered as an image; see the module docstring.

    `budget` is the page-wide image allowance. Omitted, each signature is
    bounded only by `MAX_SIGNATURE_BYTES` — which is what every existing caller
    and test expects, so the default preserves that behaviour exactly.
    """
    raw = str(signature_data or "").strip()
    if not raw:
        return '<div class="esd-sig__blank"></div>'

    m = _DATA_IMAGE.match(raw)
    if m:
        payload = re.sub(r"\s+", "", m.group(2))
        try:
            decoded = base64.b64decode(payload, validate=True)
        except Exception:
            return f'<div class="esd-sig__typed">{R.esc(raw[:120])}</div>'
        if len(decoded) > MAX_SIGNATURE_BYTES:
            return ('<div class="esd-sig__note">Signature image on file '
                    f'({len(decoded) // 1024} KB) — too large to reproduce here.</div>')
        if budget is not None and not budget.take(len(decoded)):
            return ('<div class="esd-sig__note">Signature image on file '
                    f'({len(decoded) // 1024} KB) — not reproduced here to keep '
                    'this page small.</div>')
        return f'<img class="esd-sig__img" src="data:image/{m.group(1)};base64,{payload}" alt="">'

    if signature_type == "type" or not raw.lower().startswith(("http://", "https://", "data:")):
        return f'<div class="esd-sig__typed">{R.esc(raw[:200])}</div>'

    # A URL or a data: URI of some other type. Named, never fetched.
    return '<div class="esd-sig__note">Signature on file in a format that cannot be reproduced here.</div>'


def _signer_block(signer: dict, budget: "_Budget | None" = None) -> str:
    name = R.esc(signer.get("name") or "") or R.unset("Signer")
    email = R.esc(signer.get("email") or "")
    method = _METHOD.get(signer.get("signature_type") or "", "Signature")
    when = _ist(signer.get("signed_at"))
    ip = R.esc(signer.get("signed_ip") or "")
    otp = "Identity verified by one-time password" if signer.get("otp_verified") \
        else "Not verified by one-time password"

    facts = []
    if when:
        facts.append(("Signed", R.esc(when)))
    facts.append(("Method", R.esc(method)))
    if ip:
        facts.append(("IP address", ip))

    fact_html = "".join(
        f'<div class="esd-fact"><span class="esd-fact__l">{label}</span>'
        f'<span class="esd-fact__v">{value}</span></div>'
        for label, value in facts
    )

    return f"""<div class="esd-signer">
  <div class="esd-sig">{signature_mark(signer.get("signature_data"), signer.get("signature_type") or "", budget)}</div>
  <div class="esd-signer__rule"></div>
  <div class="esd-signer__name">{name}</div>
  {f'<div class="esd-signer__mail">{email}</div>' if email else ''}
  <div class="esd-signer__facts">{fact_html}</div>
  <div class="esd-signer__otp">{otp}</div>
</div>"""


def signer_grid(signers: list[dict], per_row: int = 2) -> str:
    """Two signatories to a row, as a TABLE.

    Not CSS grid: `doc_render`'s own module docstring rules it out for every
    document in this set — "WeasyPrint's grid support is partial; a grid that
    fails to apply collapses a four-column meta strip into one column and the
    document silently loses its shape". On a signature page that failure mode
    is worse than a lost shape, because the page still renders and still looks
    executed. A table is the house pattern and degrades to nothing.

    The last row is padded with empty cells so the columns keep their width when
    the signatory count is odd.
    """
    # One budget for the page, spent in signing order — see `_Budget`.
    budget = _Budget()
    cells = [f'<td class="esd-cell">{_signer_block(s, budget)}</td>' for s in signers]
    rows = []
    for i in range(0, len(cells), per_row):
        chunk = cells[i:i + per_row]
        chunk += ['<td class="esd-cell"></td>'] * (per_row - len(chunk))
        rows.append(f"<tr>{''.join(chunk)}</tr>")
    return f'<table class="esd-signers"><tbody>{"".join(rows)}</tbody></table>'


PAGE_CSS = """
.esd-lede{ font-size:9.5pt; line-height:1.5; margin:10pt 0 4pt; }
.esd-signers{ width:100%; border-collapse:separate; border-spacing:0 14pt; margin-top:6pt;
              table-layout:fixed; }
.esd-signers td{ vertical-align:bottom; padding-right:18pt; }
.esd-signer{ break-inside:avoid; }
.esd-sig{ height:52pt; }
.esd-sig__img{ max-height:52pt; max-width:100%; }
.esd-sig__typed{ font-family:Georgia,"Times New Roman",serif; font-size:19pt; font-style:italic; }
.esd-sig__blank, .esd-sig__note{ font-size:8pt; color:#9AA0A8; }
.esd-signer__rule{ border-bottom:1px solid #14171A; margin:3pt 0 4pt; }
.esd-signer__name{ font-weight:700; font-size:10pt; }
.esd-signer__mail{ font-size:8.5pt; color:#5B6169; }
.esd-signer__facts{ margin-top:4pt; }
.esd-fact{ display:flex; gap:6pt; font-size:8.5pt; }
.esd-fact__l{ color:#9AA0A8; min-width:58pt; }
.esd-fact__v{ font-family:"JetBrains Mono","DejaVu Sans Mono",monospace; }
.esd-signer__otp{ margin-top:4pt; font-size:8pt; color:#5B6169; }
.esd-basis{ margin-top:16pt; padding-top:8pt; border-top:1px solid #EAE7DE;
            font-size:8.5pt; line-height:1.55; color:#5B6169; }
.esd-hash{ font-family:"JetBrains Mono","DejaVu Sans Mono",monospace; font-size:7.5pt;
           word-break:break-all; }
.esd-alone{ margin:10pt 0; padding:8pt 10pt; border:1px solid #D9D5CA; background:#F7F5EF;
            font-size:9pt; line-height:1.5; }
"""


def build_signature_page_html(
    org: dict,
    doc: dict,
    signers: list[dict],
    original_appended: bool,
    original_name: str = "",
) -> str:
    """The whole signature page, as a complete HTML document ready for WeasyPrint."""
    org = org or {}
    doc_id = str(doc.get("id") or "")
    completed = _ist(doc.get("completed_at")) or _ist(datetime.now(timezone.utc))

    head = R.letterhead(
        org,
        "Signature Page",
        "हस्ताक्षर पृष्ठ",
        doc_no=doc_id[:8].upper() if doc_id else "",
    )

    meta = R.meta_strip(
        [
            ("Document", R.esc(doc.get("title") or "") or R.unset("Title")),
            ("Completed", R.esc(completed)),
            ("Signatories", R.esc(str(len(signers)))),
            ("Reference", R.esc(doc_id[:8].upper()) if doc_id else R.unset("Reference")),
        ],
        mono_labels=("Reference",),
    )

    if original_appended:
        lede = ('<p class="esd-lede">The pages preceding this one are the document as it was '
                'presented for signature, reproduced without alteration. The signatures below were '
                'collected electronically and are recorded with the time, network address and '
                'verification method for each signatory.</p>')
        alone = ""
    else:
        lede = ('<p class="esd-lede">The signatures below were collected electronically and are '
                'recorded with the time, network address and verification method for each '
                'signatory.</p>')
        alone = (f'<div class="esd-alone"><b>The signed document is not reproduced here.</b> '
                 f'The file presented for signature{f" — {R.esc(original_name)} — " if original_name else " "}'
                 f'is not a PDF and cannot be appended to this page. It remains available for '
                 f'download alongside this record, and its fingerprint below identifies exactly '
                 f'which file was agreed.</div>')

    file_hash = str(doc.get("file_hash") or "")
    basis = f"""<div class="esd-basis">
  <p>Executed electronically under section 10A of the Information Technology Act, 2000, which
  gives contracts formed by electronic means the same validity as those signed on paper and
  prescribes no particular form of signature.</p>
  <p>The document presented for signature has the SHA-256 fingerprint below. Any alteration to
  it after signature produces a different fingerprint and is therefore detectable.</p>
  <p class="esd-hash">{R.esc(file_hash) if file_hash else R.unset("Fingerprint")}</p>
  <p>A machine-readable certificate carrying the full audit trail — every view, verification,
  reminder and signature, with timestamps — is stored with this document.</p>
</div>"""

    page = (head + meta + lede + alone
            + signer_grid(signers)
            + basis
            + R.foot(f'Signature page &middot; {R.esc(doc.get("title") or "")}'))

    html = R.document(
        [page],
        org=org,
        title=f"Signature page — {doc.get('title') or ''}",
        running=R.running_id("Signature page", org, doc_id[:8].upper()),
    )
    return html.replace("</style>", PAGE_CSS + "</style>", 1)


def _is_pdf(data: bytes) -> bool:
    return bool(data) and data[:5] == b"%PDF-"


def append_pages(original_pdf: bytes, appendix_pdf: bytes) -> bytes:
    """Original pages first, unaltered, then the signature page.

    pypdf copies page objects; it does not re-render, so the signers' pages come
    through byte-identical in content. An encrypted original is passed through
    unmerged by the caller rather than guessed at.

    ── ON MAKING THIS SMALLER, AND WHY IT ONLY GOES SO FAR ──────────────────

    `compress_identical_objects` is LOSSLESS and structural: it collapses
    objects that are byte-identical duplicates — a font embedded once per page,
    a repeated logo XObject, the same colour profile in both halves of the merge
    — and drops orphans nothing references. Merging two documents is exactly the
    case that creates those duplicates, so this is the one place it reliably
    pays. It does not re-encode a single page, so the pages a signer saw render
    identically, which is the property that matters for a document that is
    evidence.

    WHAT IT WILL NOT DO is make a scanned contract small. A 6MB scan is 6MB of
    JPEG inside a PDF wrapper, and shrinking that means re-encoding the images —
    which needs Pillow or pikepdf (neither is installed) and is LOSSY. Lossily
    altering the thing that was signed is the wrong instinct even when the tools
    are present. The honest lever on stored size is the upload cap in
    `routers/esign._MAX_PDF_BYTES`, not this function.
    """
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for source in (original_pdf, appendix_pdf):
        reader = PdfReader(io.BytesIO(source))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise ValueError("The document is password-protected") from exc
        for page in reader.pages:
            writer.add_page(page)

    # Best-effort. A malformed original that pypdf could still merge must not be
    # turned into a failed signature by an optimisation — the executed document
    # is worth more than the bytes it saves.
    try:
        writer.compress_identical_objects()
    except Exception:
        log.warning("compress_identical_objects failed; writing the merge uncompressed",
                    exc_info=True)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def build_signed_pdf(
    org: dict,
    doc: dict,
    signers: list[dict],
    original_bytes: bytes | None,
    original_name: str = "",
) -> tuple[bytes, bool]:
    """Returns (pdf_bytes, original_was_appended).

    Raises RuntimeError only when no PDF can be produced at all — WeasyPrint
    missing. A non-PDF or unreadable original degrades to the signature page
    alone, which states that plainly, because a record of who signed is worth
    more than nothing and is honest about what it is.
    """
    appendable = _is_pdf(original_bytes or b"")

    html = build_signature_page_html(org, doc, signers, appendable, original_name)
    appendix = R.render_pdf(html)

    if not appendable:
        return appendix, False

    try:
        return append_pages(original_bytes, appendix), True
    except Exception:
        # Malformed or password-protected original. Re-render the page saying so
        # rather than shipping a document that claims pages it does not carry.
        html = build_signature_page_html(org, doc, signers, False, original_name)
        return R.render_pdf(html), False
