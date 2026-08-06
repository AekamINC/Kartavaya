"""The five demo agreements — half a page each, text only, no dependencies.

WHY THIS EXISTS. On 2026-08-06 the Unicode Group demo organisation had 20 e-sign
documents and **six of them pointed at the same PDF**:

    esign/originals/3ff1ede5f1274441b4e88eb8b4cb66d1.pdf

The Engagement Letter, the NDA, the Virtual CFO agreement, the ERP statement of
work and the payroll agreement were one file wearing five titles. A buyer opening
two of them in a row sees the same page twice, which is the moment the demo stops
being a product and starts being a mock-up. Two more rows held the literal string
`pending` in `file_key` and `file_url`, so they 404 on open.

WHY NOT WeasyPrint. WeasyPrint is already a dependency and renders HTML properly,
but it needs a native stack that does not load on the Windows machine these were
authored on — `requirements.txt` says as much next to pypdf. A half-page,
text-only agreement does not need a layout engine, so this writes PDF 1.4 by hand:
no dependency, runs anywhere, and — because nothing here is time-dependent — the
same input always produces the same bytes. That matters, because
`sign_documents.file_hash` is NOT NULL and the seed pins the hash; a generator
that embedded a creation timestamp would invalidate its own seed on every run.

Page is 595 x 421 pt — A4 width, half A4 height. That is the owner's brief
verbatim: "you make it any later on smaller some half page. no image only txt".

    python backend/scripts/make_demo_esign_pdfs.py

Writes to backend/scripts/demo_assets/esign/ and prints the sha256 of each file,
which is what the seed SQL records.
"""
import hashlib
import textwrap
from pathlib import Path

OUT = Path(__file__).resolve().parent / "demo_assets" / "esign"

PAGE_W, PAGE_H = 595, 421
MARGIN = 48
BODY_WIDTH = 78          # characters per line at 8.5pt Helvetica in this measure

TITLE_SIZE = 12
BODY_SIZE = 8.5
LEADING = 12.5


# The fonts declare /WinAnsiEncoding, which is Latin-1 plus a handful of
# typographic characters in the 0x80-0x9F range that Latin-1 leaves as controls.
# The em dash is one of them and it is in four of the five titles, so encoding the
# stream as plain latin-1 raises. Anything outside the table degrades to ASCII
# rather than vanishing.
_WINANSI = {"—": "\x97", "–": "\x96", "‘": "\x91",
            "’": "\x92", "“": "\x93", "”": "\x94", "…": "\x85"}


def _esc(s: str) -> str:
    """PDF string literals escape backslash and both parentheses. Nothing else."""
    for uni, win in _WINANSI.items():
        s = s.replace(uni, win)
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _content_stream(title: str, subtitle: str, clauses: list, signature: list) -> bytes:
    """One page of positioned text. No images, no XObjects, no graphics state."""
    ops = []
    y = PAGE_H - MARGIN

    ops.append(f"BT /F2 {TITLE_SIZE} Tf {MARGIN} {y:.1f} Td ({_esc(title)}) Tj ET")
    y -= 14
    ops.append(f"BT /F1 {BODY_SIZE} Tf {MARGIN} {y:.1f} Td ({_esc(subtitle)}) Tj ET")
    y -= 18

    for n, clause in enumerate(clauses, 1):
        for i, line in enumerate(textwrap.wrap(f"{n}. {clause}", BODY_WIDTH)):
            indent = MARGIN if i == 0 else MARGIN + 11
            ops.append(f"BT /F1 {BODY_SIZE} Tf {indent} {y:.1f} Td ({_esc(line)}) Tj ET")
            y -= LEADING
        y -= 3

    y = min(y, MARGIN + 52)
    for line in signature:
        ops.append(f"BT /F1 {BODY_SIZE} Tf {MARGIN} {y:.1f} Td ({_esc(line)}) Tj ET")
        y -= LEADING

    return "\n".join(ops).encode("latin-1")


def build_pdf(title: str, subtitle: str, clauses: list, signature: list) -> bytes:
    stream = _content_stream(title, subtitle, clauses, signature)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"
        ).encode("latin-1"),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()

    # No /Info dictionary, deliberately. A CreationDate would change the bytes on
    # every run and break the hash the seed pins.
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n"
    ).encode()
    return bytes(out)


# ── The five agreements ──────────────────────────────────────────────────────
#
# Unicode Group is an accounting and advisory firm, so these are the five
# documents such a firm actually puts in front of a client. Wording is
# deliberately plain and generic: this is demo furniture, not legal advice, and
# nobody should be able to mistake it for a drafted contract.

DOCS = [
    {
        "slug": "engagement-letter-statutory-audit",
        "title": "Engagement Letter — Statutory Audit, FY 2026-27",
        "subtitle": "Unicode Group, Chartered Accountants",
        "clauses": [
            "The firm is engaged to audit the financial statements for the "
            "financial year ending 31 March 2027 and to report under the "
            "applicable provisions of the Companies Act, 2013.",
            "Management remains responsible for the preparation of the financial "
            "statements, for the design and operation of internal controls, and "
            "for making all records and explanations available to the firm.",
            "Fees are billed in three instalments against progress of the audit "
            "and are exclusive of goods and services tax and of out-of-pocket "
            "expenses, which are charged at actuals.",
            "Either party may terminate this engagement by thirty days written "
            "notice. Work completed to the date of termination remains payable.",
        ],
    },
    {
        "slug": "non-disclosure-agreement",
        "title": "Non-Disclosure Agreement",
        "subtitle": "Mutual — due diligence and advisory discussions",
        "clauses": [
            "Each party may disclose confidential information to the other for "
            "the sole purpose of evaluating a proposed transaction.",
            "The receiving party shall use the information only for that purpose, "
            "shall disclose it only to those of its personnel who need it, and "
            "shall protect it with no less care than it applies to its own.",
            "The obligations do not apply to information that is public through "
            "no fault of the receiving party, was already lawfully held, or is "
            "required to be disclosed by law or by a regulator.",
            "The obligations survive for three years from the date of this "
            "agreement, whether or not the proposed transaction proceeds.",
        ],
    },
    {
        "slug": "virtual-cfo-services-agreement",
        "title": "Virtual CFO Services Agreement",
        "subtitle": "Monthly retainer — finance function support",
        "clauses": [
            "The firm shall provide monthly management reporting, cash flow "
            "forecasting, statutory compliance oversight and board reporting "
            "support for the client's finance function.",
            "Services are delivered remotely, with attendance at the client's "
            "premises for one working day each month and for board meetings on "
            "reasonable notice.",
            "The retainer is invoiced monthly in advance and is payable within "
            "fifteen days. Work beyond the agreed scope is quoted separately "
            "before it begins.",
            "The agreement runs for twelve months and renews for successive "
            "twelve month terms unless either party gives sixty days notice.",
        ],
    },
    {
        "slug": "erp-support-statement-of-work",
        "title": "Statement of Work — ERP Support",
        "subtitle": "Annual support and enhancement services",
        "clauses": [
            "The firm shall provide application support for the client's "
            "enterprise resource planning system, covering incident resolution, "
            "period-end close support and user assistance.",
            "Priority one incidents are acknowledged within one hour and worked "
            "continuously until service is restored. All other incidents are "
            "acknowledged within one working day.",
            "A pool of sixty enhancement hours is included each quarter. Unused "
            "hours do not carry forward and additional hours are billed at the "
            "agreed hourly rate.",
            "Support is provided between 09:30 and 18:30 India Standard Time on "
            "working days, with on-call cover during the statutory close.",
        ],
    },
    {
        "slug": "payroll-outsourcing-agreement",
        "title": "Payroll Outsourcing Agreement",
        "subtitle": "Monthly payroll processing and statutory filings",
        "clauses": [
            "The firm shall process the client's monthly payroll, compute "
            "statutory deductions, and prepare provident fund, employees state "
            "insurance and professional tax returns for filing.",
            "The client shall provide attendance, joiner, leaver and revision "
            "inputs by the twentieth day of each month. Late inputs may move the "
            "payroll date by the number of days of delay.",
            "Employee data is processed only for payroll purposes, is retained "
            "for the period required by law, and is not transferred outside "
            "India without the client's written instruction.",
            "Either party may terminate on ninety days notice, and the firm shall "
            "hand over payroll records in a usable format at no further charge.",
        ],
    },
]

SIGNATURE = [
    "",
    "For Unicode Group                          For and on behalf of the Client",
    "",
    "____________________                       ____________________",
    "Authorised signatory                       Authorised signatory",
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{'file':52} {'bytes':>7}  sha256")
    for d in DOCS:
        pdf = build_pdf(d["title"], d["subtitle"], d["clauses"], SIGNATURE)
        path = OUT / f"{d['slug']}.pdf"
        path.write_bytes(pdf)
        digest = hashlib.sha256(pdf).hexdigest()
        print(f"{path.name:52} {len(pdf):>7}  {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
