/**
 * make-fixtures.mjs — build the binary fixtures of proposal 93 §5.
 *
 * ZERO DEPENDENCIES, FULLY DETERMINISTIC, NOTHING COMMITTED.
 *
 * Everything this writes lands in `fixtures/generated/`, which is git-ignored.
 * The repo went from 82 MB to 49 MB by getting file bytes out of the database;
 * putting 40 attachments and 30 photographs into git would be the same mistake
 * one layer up. The generator is the fixture; the bytes are a build product.
 *
 * DETERMINISM — how it is actually guaranteed, not merely intended:
 *   · No `Math.random`, no `Date.now`, no locale-dependent formatting.
 *   · PNG compression is a hand-written STORED deflate stream, so no zlib
 *     version can ever change a byte. `node:zlib` is not imported.
 *   · ZIP entries carry a fixed DOS timestamp, not the clock.
 *   · Every produced file's SHA-256 is written to `generated/MANIFEST.txt`.
 *     Run `--check` to re-derive them and diff. If a byte moves, it says so.
 *
 * Usage:
 *     node frontend/e2e-real/fixtures/make-fixtures.mjs           # build
 *     node frontend/e2e-real/fixtures/make-fixtures.mjs --check   # verify only
 *
 * The oversized files are large by construction and are the reason this is a
 * generator rather than a directory of committed blobs. See the README.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'generated');
const CHECK_ONLY = process.argv.includes('--check');

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic randomness. mulberry32, seeded once, never reseeded from time.
// ─────────────────────────────────────────────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG, written by hand.
//
// The deflate stream uses STORED blocks — type 00, no compression at all. That
// is a deliberate choice over `zlib.deflateSync`: a stored stream is a pure
// function of the pixels and cannot vary with the zlib build Node happens to
// link, which is what "deterministic" has to mean for a byte-comparison
// assertion to be worth writing. The cost is size, and these images are small.
// ─────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf, seed = 0) {
  let c = ~seed;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of STORED deflate blocks. */
function zlibStored(raw) {
  const parts = [Buffer.from([0x78, 0x01])];
  const MAX = 65535;
  if (raw.length === 0) {
    parts.push(Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]));
  }
  for (let off = 0; off < raw.length; off += MAX) {
    const len = Math.min(MAX, raw.length - off);
    const last = off + len >= raw.length ? 1 : 0;
    const hdr = Buffer.alloc(5);
    hdr[0] = last;
    hdr.writeUInt16LE(len, 1);
    hdr.writeUInt16LE(~len & 0xffff, 3);
    parts.push(hdr, raw.subarray(off, off + len));
  }
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(raw), 0);
  parts.push(tail);
  return Buffer.concat(parts);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** `paint(x, y) -> [r, g, b]`. 8-bit truecolour, no interlace. */
function makePng(width, height, paint) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;                       // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw[p++] = r & 0xff; raw[p++] = g & 0xff; raw[p++] = b & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF, written by hand — uncompressed page tree ON PURPOSE.
//
// `frontend/src/pages/esign/fieldPlacement.js:229 countPdfPages` counts pages by
// scanning the raw bytes for `/Type /Page` and `/Count n`, and its own docstring
// says BOTH SIGNALS ARE INVISIBLE inside a compressed object stream — which is
// how most PDF 1.5+ writers store the page tree. A PDF produced by a modern
// library therefore reports 0 pages, the placer falls back to "assume one page",
// and the page-2 field placement these fixtures exist to exercise never happens.
// So: PDF 1.4, classic xref, no object streams, no compression.
// `_helpers.ts:pdfPageCount` cross-checks `/Count` against the page objects, so
// a malformed count cannot satisfy an assertion either.
// ─────────────────────────────────────────────────────────────────────────────
const pdfEsc = (s) => String(s).replace(/([\\()])/g, '\\$1');

/** `pages` is an array of arrays of text lines. One array per page. */
function makePdf(pages) {
  const objs = [];
  const nPages = pages.length;
  const kids = Array.from({ length: nPages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>`);
  for (let i = 0; i < nPages; i++) {
    const lines = pages[i];
    let stream = 'BT /F1 10 Tf 56 786 Td 14 TL\n';
    lines.forEach((ln, j) => {
      const bold = ln.startsWith('#');
      const text = bold ? ln.slice(1).trim() : ln;
      stream += bold ? '/F2 11 Tf\n' : '/F1 10 Tf\n';
      stream += `(${pdfEsc(text)}) Tj\n`;
      if (j < lines.length - 1) stream += 'T*\n';
    });
    stream += 'ET';
    objs.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << '
      + '/F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> '
      + '/F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> '
      + `>> >> /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP (store-only) → a genuinely valid .docx.
//
// Fixed DOS timestamp (1 Jan 2020 00:00:00) rather than the clock, or every run
// would produce different bytes and the manifest would be worthless.
// ─────────────────────────────────────────────────────────────────────────────
const DOS_TIME = 0x0000;          // 00:00:00
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;   // 2020-01-01

function zipStore(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);           // version needed
    lfh.writeUInt16LE(0, 6);            // flags
    lfh.writeUInt16LE(0, 8);            // method 0 = stored
    lfh.writeUInt16LE(DOS_TIME, 10);
    lfh.writeUInt16LE(DOS_DATE, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    locals.push(lfh, nameBuf, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);           // version made by
    cdh.writeUInt16LE(20, 6);           // version needed
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const xmlEsc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function makeDocx(title, paragraphs) {
  const body = paragraphs.map(p =>
    `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join('');
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '</Types>', 'utf8'),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>', 'utf8'),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(title)}</w:t></w:r></w:p>${body}`
        + '<w:sectPr/></w:body></w:document>', 'utf8'),
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// The synthetic faces.
//
// FLAT GEOMETRY, NOT A FACE. `backend/routers/pahchan.py:6` — "Face matching is
// parked to v2" — so nothing in this product ever compares one of these images
// to anything. The upload → R2 → consent gate → access control → retention path
// is byte-identical whatever the picture is, and a real face would create a
// genuine biometric record, under DPDP, for a person who does not exist, in a
// database production shares. These are obviously synthetic on sight, which is
// the point: nobody can mistake one for evidence about a human being.
// ─────────────────────────────────────────────────────────────────────────────
const FACE_BG = [
  [0xf4, 0xef, 0xe6], [0xe8, 0xef, 0xea], [0xf0, 0xe9, 0xf2], [0xea, 0xee, 0xf4],
  [0xf4, 0xec, 0xe4], [0xe6, 0xf1, 0xf0],
];
const FACE_FG = [
  [0x1f, 0x4b, 0x3f], [0xc8, 0x62, 0x2a], [0x35, 0x4a, 0x7a], [0x7a, 0x35, 0x55],
  [0x4a, 0x4a, 0x2a], [0x2a, 0x60, 0x6a], [0x8a, 0x5a, 0x20], [0x5a, 0x30, 0x6a],
];

function facePng(i) {
  const r = rng(0x9e37 + i * 7919);
  const W = 96, H = 96;
  const bg = FACE_BG[i % FACE_BG.length];
  const fg = FACE_FG[(i * 3) % FACE_FG.length];
  const headR = 26 + Math.floor(r() * 5);
  const cx = 48, cy = 40;
  const shoulderTop = 74 - Math.floor(r() * 4);
  const markX = 30 + Math.floor(r() * 36);
  const markY = 78 + Math.floor(r() * 8);
  const tone = 0x60 + Math.floor(r() * 0x50);
  return makePng(W, H, (x, y) => {
    // Shoulders
    if (y >= shoulderTop && Math.abs(x - cx) < 34 - (y - shoulderTop)) return fg;
    // Head
    const dx = x - cx, dy = (y - cy) * 1.15;
    if (dx * dx + dy * dy <= headR * headR) {
      const ring = dx * dx + dy * dy > (headR - 4) * (headR - 4);
      return ring ? fg : [tone, tone - 10, tone - 24];
    }
    // Index mark — a bar whose length encodes `i`, so two fixtures are never
    // confusable by eye when they turn up in an approval queue screenshot.
    if (y >= markY && y < markY + 4 && x >= markX && x < markX + 2 + (i % 12) * 2) return fg;
    return bg;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The eSign documents. Plausible Indian professional-services paper, in ASCII
// only: the PDFs use the base-14 Helvetica, which is WinAnsi — there is no
// Devanagari and no rupee glyph, so amounts read "Rs." and "INR".
//
// Every company, person, address and identifier below is invented. Phone
// numbers use the Ofcom drama range +44 7700 900xxx, which is unassignable:
// India has no reserved test range, so every well-formed Indian mobile number
// one might invent is somebody's real telephone.
// ─────────────────────────────────────────────────────────────────────────────
const FIRM = 'Kartavya Advisory LLP';
const FIRM_ADDR = '4th Floor, Pushpanjali Chambers, 21 Bhagirathi Marg, Pune 411001';

const ESIGN_DOCS = [
  {
    name: 'esign-01-engagement-letter-2p.pdf',
    what: 'Engagement letter, 2 pages. Signature + date on page 2.',
    pages: [
      [
        `# ${FIRM}`,
        FIRM_ADDR,
        '',
        'ENGAGEMENT LETTER',
        'Reference: KAL/ENG/2026-0184                    Date: 3 August 2026',
        '',
        'To the Board of Directors',
        'Vedanta Textiles Private Limited',
        'Plot 14, MIDC Phase II, Chakan, Pune 410501',
        '',
        '# 1. Scope of the engagement',
        '',
        'We are pleased to confirm our appointment as accounting and tax advisers',
        'to Vedanta Textiles Private Limited for the financial year 1 April 2026 to',
        '31 March 2027. The engagement covers monthly bookkeeping, quarterly',
        'management accounts, GST return preparation and filing under GSTR-1 and',
        'GSTR-3B, TDS return preparation under Form 26Q, and the preparation of the',
        'annual financial statements for adoption by the Board.',
        '',
        'Statutory audit is expressly outside this engagement. Where an audit is',
        'required, it will be performed by an independent auditor appointed by the',
        'members, and we will assist that auditor with schedules and explanations.',
        '',
        '# 2. Fees',
        '',
        'The annual retainer is Rs. 4,80,000 exclusive of GST, invoiced monthly in',
        'arrears at Rs. 40,000 per month. Work outside the scope above is billed at',
        'the hourly rates in Schedule A, agreed in writing before it is started.',
        '',
        'Invoices are payable within 30 days. Reimbursable expenses are charged at',
        'cost and supported by receipts.',
        '',
        '# 3. Your responsibilities',
        '',
        'You remain responsible for the completeness and accuracy of the records',
        'provided to us, for the maintenance of proper books of account under',
        'section 128 of the Companies Act 2013, and for the timely payment of all',
        'taxes and statutory dues. We will advise on due dates; we cannot pay them',
        'on your behalf.',
      ],
      [
        '# 4. Confidentiality and data protection',
        '',
        'We will treat all information received in the course of this engagement as',
        'confidential. Personal data will be processed only for the purposes of the',
        'engagement and retained for eight years from the end of the financial year',
        'to which it relates, after which it is destroyed.',
        '',
        '# 5. Term and termination',
        '',
        'This engagement continues until terminated by either party on 60 days',
        'written notice. Fees for work performed to the date of termination remain',
        'payable. Working papers remain our property; you are entitled to copies of',
        'anything filed on your behalf.',
        '',
        '# 6. Acceptance',
        '',
        'Please confirm your agreement by signing below. A signed copy returned to',
        'us constitutes acceptance of these terms in full.',
        '',
        '',
        'For and on behalf of Kartavya Advisory LLP',
        '',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Rohit Ambekar',
        'Title: Designated Partner',
        '',
        '',
        'Accepted for and on behalf of Vedanta Textiles Private Limited',
        '',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Sunita Rane',
        'Title: Director',
        '',
        '',
        'Queries on this letter: engagements@kartavya-advisory.example',
        'Telephone: +44 7700 900184 (reserved drama range - not a real number)',
      ],
    ],
  },
  {
    name: 'esign-02-nda-mutual-2p.pdf',
    what: 'Mutual NDA, 2 pages. Two signers, both signing on page 2.',
    pages: [
      [
        '# MUTUAL NON-DISCLOSURE AGREEMENT',
        '',
        'This Agreement is made on 6 August 2026 between:',
        '',
        `(1) ${FIRM}, a limited liability partnership having its registered`,
        `    office at ${FIRM_ADDR} ("the Adviser"); and`,
        '',
        '(2) Haldia Marine Services Limited, a company incorporated under the',
        '    Companies Act 2013 having its registered office at Unit 9, Dock Road,',
        '    Haldia, Purba Medinipur 721607 ("the Company").',
        '',
        '# 1. Confidential Information',
        '',
        'Confidential Information means any information disclosed by one party to',
        'the other, in any form, which is identified as confidential at the time of',
        'disclosure or which a reasonable person would understand to be',
        'confidential from its nature or the circumstances of disclosure. It',
        'includes financial records, customer lists, pricing, unpublished results,',
        'and the existence and terms of this Agreement.',
        '',
        '# 2. Obligations',
        '',
        'Each party will keep the other party Confidential Information secret, use',
        'it only for the purpose of evaluating and performing the proposed advisory',
        'engagement, and disclose it only to those of its personnel and',
        'professional advisers who need it for that purpose and who are bound by',
        'obligations no less protective than these.',
        '',
        '# 3. Exclusions',
        '',
        'These obligations do not apply to information that is or becomes public',
        'through no breach of this Agreement, was lawfully known to the receiving',
        'party before disclosure, is independently developed without reference to',
        'the disclosing party information, or is required to be disclosed by law,',
        'by a court, or by a regulator - in which case the receiving party will,',
        'where lawful, give prompt notice before disclosing.',
      ],
      [
        '# 4. Term',
        '',
        'This Agreement takes effect on the date first written above and continues',
        'for three years. The obligations in clause 2 survive for a further five',
        'years from the date of disclosure of the information concerned.',
        '',
        '# 5. Return of materials',
        '',
        'On written request, each party will return or destroy the other party',
        'Confidential Information, except for one archival copy retained to meet a',
        'legal or professional record-keeping requirement, which remains subject to',
        'this Agreement for as long as it is held.',
        '',
        '# 6. No licence, no partnership',
        '',
        'Nothing in this Agreement transfers any intellectual property right or',
        'creates a partnership, joint venture or agency between the parties.',
        '',
        '# 7. Governing law',
        '',
        'This Agreement is governed by the laws of India. The courts at Pune have',
        'exclusive jurisdiction.',
        '',
        '',
        'Signed for and on behalf of Kartavya Advisory LLP',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Rohit Ambekar,  Designated Partner',
        '',
        '',
        'Signed for and on behalf of Haldia Marine Services Limited',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Imran Qureshi,  Chief Financial Officer',
      ],
    ],
  },
  {
    name: 'esign-03-sow-gst-advisory-3p.pdf',
    what: 'Statement of work, 3 pages. Initials on page 2, signature on page 3.',
    pages: [
      [
        '# STATEMENT OF WORK',
        'GST advisory and annual return support',
        '',
        `Adviser: ${FIRM}`,
        'Client:  Krishnagiri Agro Exports Private Limited',
        'SOW ref: KAL/SOW/2026-0191            Effective: 10 August 2026',
        '',
        '# 1. Background',
        '',
        'The Client operates from three registered places of business, in Tamil',
        'Nadu, Karnataka and Maharashtra, and holds a separate GST registration in',
        'each State. Returns have been filed in-house. The Client has asked the',
        'Adviser to review the last four quarters, reconcile input tax credit',
        'claimed against the auto-populated GSTR-2B, and prepare the annual return',
        'in Form GSTR-9 together with the reconciliation statement in Form GSTR-9C.',
        '',
        '# 2. Deliverables',
        '',
        'D1  Input tax credit reconciliation, per registration, for the period',
        '    1 April 2025 to 31 March 2026, identifying credit claimed but not',
        '    reflected in GSTR-2B and credit available but not claimed.',
        '',
        'D2  A written note on each reconciling item above Rs. 25,000, stating the',
        '    position taken and the basis for it.',
        '',
        'D3  Draft Form GSTR-9 for each registration, with supporting schedules.',
        '',
        'D4  Draft Form GSTR-9C reconciliation statement for each registration',
        '    where turnover exceeds the prescribed threshold.',
        '',
        'D5  A closing memorandum listing process changes that would prevent the',
        '    reconciling differences recurring.',
      ],
      [
        '# 3. Timetable',
        '',
        'Records made available by the Client       ....  17 August 2026',
        'D1 draft issued to the Client              ....  12 September 2026',
        'Client comments on D1                      ....  22 September 2026',
        'D2 and D3 drafts issued                    ....  10 October 2026',
        'D4 draft issued                            ....  24 October 2026',
        'Filing window, subject to Client approval  ....  by 31 December 2026',
        '',
        'The timetable assumes records are complete when delivered. Each week of',
        'delay in the first milestone moves every later date by the same period.',
        '',
        '# 4. Fees',
        '',
        'A fixed fee of Rs. 2,75,000 exclusive of GST, invoiced as follows:',
        '',
        '  40 per cent on signature of this Statement of Work',
        '  30 per cent on issue of D1',
        '  30 per cent on issue of D4',
        '',
        'Additional registrations, or a re-performance made necessary by revised',
        'records, are billed at Rs. 4,500 per hour.',
        '',
        '# 5. Assumptions',
        '',
        'A1  The Client will provide read access to its GST portal accounts for',
        '    each registration, and to its accounting system for the period.',
        'A2  No registration is currently under audit, investigation or notice',
        '    under section 61, 65 or 74. The Client confirms this at signature.',
        'A3  The Adviser does not file on the Client behalf. Filing is performed by',
        '    the Client authorised signatory after written approval of the draft.',
        '',
        '',
        'Client initials: ________          Adviser initials: ________',
      ],
      [
        '# 6. Out of scope',
        '',
        'Representation before any authority, drafting of replies to show-cause',
        'notices, appeals, refund applications, and any advice on customs or on',
        'the treatment of exports under a letter of undertaking are outside this',
        'Statement of Work and are the subject of a separate engagement.',
        '',
        '# 7. Limitation',
        '',
        'The Adviser aggregate liability under this Statement of Work is limited to',
        'the fees actually paid under it. Nothing limits liability for fraud or for',
        'anything that cannot lawfully be limited.',
        '',
        '# 8. Acceptance',
        '',
        'This Statement of Work is issued under, and incorporates the terms of, the',
        'engagement letter dated 3 August 2026. Where the two conflict, this',
        'document governs for the work described in it.',
        '',
        '',
        'For Kartavya Advisory LLP',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Meera Joshi',
        'Title: Partner, Indirect Tax',
        '',
        '',
        'For Krishnagiri Agro Exports Private Limited',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Devika Iyer',
        'Title: Managing Director',
        '',
        '',
        'Witness',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Anil Barve',
      ],
    ],
  },
  {
    name: 'esign-04-office-lease-3p.pdf',
    what: 'Leave and licence agreement, 3 pages. Signature on page 3, initials on 1 and 2.',
    pages: [
      [
        '# LEAVE AND LICENCE AGREEMENT',
        '',
        'This Agreement is made at Pune on 14 August 2026 between:',
        '',
        'Kaveri Facilities LLP, having its office at 2 Sahyadri Court, Bund Garden',
        'Road, Pune 411001 (the "Licensor"), of the one part;',
        '',
        `and ${FIRM}, having its office at`,
        `${FIRM_ADDR} (the "Licensee"), of the other part.`,
        '',
        '# 1. The Licensed Premises',
        '',
        'Office unit 402 on the fourth floor of Pushpanjali Chambers, admeasuring',
        '2,840 square feet of carpet area, together with six reserved car parking',
        'spaces in the basement, as shown edged in red on the plan annexed.',
        '',
        '# 2. Term',
        '',
        'Thirty-three months commencing 1 September 2026 and expiring 31 May 2029,',
        'with a lock-in of eighteen months from the commencement date.',
        '',
        '# 3. Licence fee',
        '',
        'Rs. 1,85,000 per month, payable in advance on or before the fifth day of',
        'each month, escalating by five per cent on each anniversary of the',
        'commencement date. Applicable GST is payable in addition. Tax deducted at',
        'source under section 194-I is to be deducted by the Licensee and a',
        'certificate in Form 16A furnished each quarter.',
        '',
        '',
        'Licensor initials: ________     Licensee initials: ________',
      ],
      [
        '# 4. Deposit',
        '',
        'An interest-free refundable security deposit of Rs. 11,10,000, equal to',
        'six months licence fee, is paid on or before the commencement date. It is',
        'refundable within thirty days of the Licensee vacating, less any amount',
        'properly due.',
        '',
        '# 5. Use',
        '',
        'The premises may be used only as professional offices. No part may be',
        'sub-licensed or parted with. No structural alteration may be made without',
        'the Licensor prior written consent, which will not be unreasonably',
        'withheld for internal partitioning.',
        '',
        '# 6. Outgoings',
        '',
        'The Licensor pays municipal taxes and any assessment on the property. The',
        'Licensee pays electricity, water, internet and a common area maintenance',
        'charge of Rs. 9.50 per square foot per month, billed monthly.',
        '',
        '# 7. Maintenance',
        '',
        'The Licensor maintains the structure, the lifts, the common areas and the',
        'air-conditioning plant. The Licensee maintains the interior in good',
        'condition, fair wear and tear excepted.',
        '',
        '# 8. Termination',
        '',
        'After the lock-in, either party may terminate on three months written',
        'notice. The Licensee may terminate at any time during the lock-in on',
        'payment of the licence fee for the unexpired part of it.',
        '',
        '',
        'Licensor initials: ________     Licensee initials: ________',
      ],
      [
        '# 9. Registration',
        '',
        'This Agreement will be registered under the Registration Act 1908 and the',
        'Maharashtra Rent Control Act 1999 within the prescribed period. Stamp duty',
        'and registration charges are borne equally by the parties.',
        '',
        '# 10. Notices',
        '',
        'Notices are given in writing to the addresses first written above, or to',
        'such other address as a party notifies. Notice by email is effective only',
        'if acknowledged.',
        '',
        '# 11. Dispute resolution',
        '',
        'Disputes are referred to a sole arbitrator appointed by agreement, under',
        'the Arbitration and Conciliation Act 1996. The seat is Pune and the',
        'language is English.',
        '',
        '',
        'IN WITNESS WHEREOF the parties have set their hands on the date first',
        'written above.',
        '',
        '',
        'For Kaveri Facilities LLP  (Licensor)',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Pradeep Naik,  Partner',
        '',
        '',
        'For Kartavya Advisory LLP  (Licensee)',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Rohit Ambekar,  Designated Partner',
        '',
        '',
        'Witnesses',
        '',
        '1. ______________________   Name: Farida Contractor',
        '',
        '2. ______________________   Name: Joseph Mathew',
      ],
    ],
  },
  {
    name: 'esign-05-board-resolution-4p.pdf',
    what: 'Board resolution pack, 4 pages. Signature on page 4 - the deepest single-signer placement.',
    pages: [
      [
        '# CERTIFIED TRUE COPY OF THE RESOLUTIONS',
        'passed at the meeting of the Board of Directors of',
        'Zanskar Medtech Limited',
        '',
        'Held at the registered office, Survey 118/2, Hebbal Industrial Area,',
        'Mysuru 570016, on Tuesday 18 August 2026 at 11:00 hours.',
        '',
        '# Present',
        '',
        '  Anjali Deshmukh        Chairperson',
        '  Suresh Pillai          Managing Director',
        '  Nandita Bose           Independent Director',
        '  Vikram Chandel         Independent Director',
        '',
        '# In attendance',
        '',
        '  Farhan Sheikh          Company Secretary',
        '',
        '# Leave of absence',
        '',
        '  Rakesh Menon           Director',
        '',
        '',
        'The Chairperson took the chair and confirmed a quorum. The minutes of the',
        'meeting held on 21 May 2026 were taken as read and signed.',
        '',
        'The Company Secretary confirmed that notice of the meeting and the agenda',
        'papers had been circulated on 11 August 2026, being seven clear days',
        'before the meeting, in accordance with section 173(3) of the Companies',
        'Act 2013.',
      ],
      [
        '# Resolution 1 - Appointment of advisers',
        '',
        'RESOLVED THAT Kartavya Advisory LLP be and is hereby appointed to provide',
        'accounting, indirect tax and payroll advisory services to the Company for',
        'the financial year ending 31 March 2027, on the terms of the engagement',
        'letter tabled at the meeting and initialled by the Chairperson for the',
        'purpose of identification.',
        '',
        'RESOLVED FURTHER THAT the Managing Director be and is hereby authorised to',
        'sign the engagement letter and any statement of work issued under it, and',
        'to do all such acts as may be necessary to give effect to this resolution.',
        '',
        '',
        '# Resolution 2 - Banking authority',
        '',
        'RESOLVED THAT the Company open a current account with State Bank of India,',
        'Hebbal Industrial Area branch, and that the account be operated by any two',
        'of the following jointly:',
        '',
        '  Suresh Pillai          Managing Director',
        '  Anjali Deshmukh        Chairperson',
        '  Latha Krishnan         Chief Financial Officer',
        '',
        'RESOLVED FURTHER THAT payments exceeding Rs. 25,00,000 require the prior',
        'written approval of the Audit Committee, recorded in its minutes.',
      ],
      [
        '# Resolution 3 - Adoption of a records retention policy',
        '',
        'RESOLVED THAT the records retention policy tabled at the meeting be and is',
        'hereby adopted with effect from 1 September 2026, and that the Company',
        'Secretary be authorised to publish it to all employees and to review it',
        'annually.',
        '',
        'The Board noted that the policy provides for the retention of statutory',
        'books for eight years, of payroll records for eight years from the end of',
        'the financial year to which they relate, and of attendance photographs for',
        'ninety days, after which they are destroyed automatically.',
        '',
        '',
        '# Resolution 4 - Attendance and biometric consent',
        '',
        'RESOLVED THAT the Company adopt photograph-supported attendance for field',
        'personnel with effect from 1 October 2026, on the express conditions that',
        '',
        '  (a) participation is by written consent, freely given and withdrawable;',
        '  (b) an employee who declines is offered manual attendance without',
        '      disadvantage of any kind;',
        '  (c) photographs are visible only to the human resources team and are',
        '      never disclosed to any group company or platform provider; and',
        '  (d) photographs are deleted after ninety days.',
        '',
        'RESOLVED FURTHER THAT the Chief Human Resources Officer be responsible for',
        'the operation of these conditions and report to the Board annually.',
      ],
      [
        '# Resolution 5 - Certification',
        '',
        'RESOLVED THAT the Company Secretary be and is hereby authorised to issue',
        'certified true copies of any of the foregoing resolutions to such persons',
        'as may require them.',
        '',
        '',
        'There being no other business the Chairperson declared the meeting closed',
        'at 12:40 hours.',
        '',
        '',
        '',
        'Certified to be a true copy of the resolutions passed at the meeting of',
        'the Board of Directors held on 18 August 2026.',
        '',
        '',
        'For Zanskar Medtech Limited',
        '',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Farhan Sheikh',
        'Title: Company Secretary',
        'Membership no. A-00000 (illustrative, not a real membership number)',
        '',
        '',
        'Contact for verification: secretariat@zanskar-medtech.example',
        'Telephone: +44 7700 900219 (reserved drama range - not a real number)',
      ],
    ],
  },
  {
    name: 'esign-06-audit-representation-6p.pdf',
    what: 'Management representation letter, 6 pages. The deep-page case - signature on page 6.',
    pages: [
      [
        '# MANAGEMENT REPRESENTATION LETTER',
        '',
        'Sutlej Packaging Private Limited',
        'Khasra 44, Village Baddi, Solan 173205',
        '',
        'Date: 24 August 2026',
        '',
        'To the Statutory Auditors',
        'Ambika and Raghavan, Chartered Accountants',
        '17 Mall Road, Shimla 171001',
        '',
        '',
        'Dear Sirs,',
        '',
        'This representation letter is provided in connection with your audit of',
        'the financial statements of Sutlej Packaging Private Limited for the year',
        'ended 31 March 2026, for the purpose of expressing an opinion as to',
        'whether the financial statements give a true and fair view of the state of',
        'affairs of the Company as at that date and of its profit for the year then',
        'ended.',
        '',
        'We confirm, to the best of our knowledge and belief, having made such',
        'enquiries as we considered necessary for the purpose of appropriately',
        'informing ourselves, the representations set out on the following pages.',
        '',
        '',
        '# Financial statements',
        '',
        '1. We have fulfilled our responsibility for the preparation of the',
        '   financial statements in accordance with the Accounting Standards',
        '   prescribed under section 133 of the Companies Act 2013.',
      ],
      [
        '2. Significant assumptions used in making accounting estimates, including',
        '   those measured at fair value, are reasonable.',
        '',
        '3. Related party relationships and transactions have been appropriately',
        '   accounted for and disclosed in accordance with Accounting Standard 18.',
        '',
        '4. All events subsequent to the balance sheet date that require adjustment',
        '   or disclosure have been adjusted or disclosed.',
        '',
        '5. The effects of uncorrected misstatements are immaterial, individually',
        '   and in aggregate, to the financial statements as a whole. A list of',
        '   uncorrected misstatements is attached to this letter.',
        '',
        '',
        '# Information provided',
        '',
        '6. We have provided you with access to all information of which we are',
        '   aware that is relevant to the preparation of the financial statements,',
        '   additional information you have requested, and unrestricted access to',
        '   persons within the Company from whom you determined it necessary to',
        '   obtain audit evidence.',
        '',
        '7. All transactions have been recorded in the accounting records and are',
        '   reflected in the financial statements.',
        '',
        '8. We have disclosed to you the results of our assessment of the risk that',
        '   the financial statements may be materially misstated as a result of',
        '   fraud.',
      ],
      [
        '# Fraud and non-compliance',
        '',
        '9. We have disclosed to you all information in relation to fraud or',
        '   suspected fraud that we are aware of and that affects the Company and',
        '   involves management, employees who have significant roles in internal',
        '   control, or others where the fraud could have a material effect.',
        '',
        '10. We have disclosed to you all information in relation to allegations of',
        '    fraud, or suspected fraud, affecting the financial statements,',
        '    communicated by employees, former employees, analysts, regulators or',
        '    others.',
        '',
        '11. We have disclosed to you all known instances of non-compliance or',
        '    suspected non-compliance with laws and regulations whose effects',
        '    should be considered when preparing the financial statements.',
        '',
        '',
        '# Litigation and claims',
        '',
        '12. We have disclosed to you all known actual or possible litigation and',
        '    claims whose effects should be considered when preparing the financial',
        '    statements, and these have been accounted for and disclosed in',
        '    accordance with Accounting Standard 29.',
        '',
        '13. The Company has a single claim outstanding, being a dispute with a',
        '    supplier for Rs. 18,40,000, disclosed as a contingent liability in',
        '    note 34. Legal advice is that an outflow is possible but not probable.',
      ],
      [
        '# Statutory dues and taxation',
        '',
        '14. Undisputed statutory dues including provident fund, employees state',
        '    insurance, income tax, goods and services tax, duty of customs, cess',
        '    and other material statutory dues have been regularly deposited with',
        '    the appropriate authorities, and no undisputed amounts were in arrears',
        '    as at 31 March 2026 for a period of more than six months from the date',
        '    they became payable.',
        '',
        '15. Provision for taxation has been made in accordance with the Income Tax',
        '    Act 1961 and deferred tax has been recognised under Accounting',
        '    Standard 22.',
        '',
        '16. Input tax credit claimed under the Central Goods and Services Tax Act',
        '    2017 is supported by valid tax invoices and is reflected in the',
        '    auto-populated statements available on the common portal, other than',
        '    the reconciling items listed in the schedule attached.',
        '',
        '',
        '# Going concern',
        '',
        '17. We have assessed the Company ability to continue as a going concern',
        '    for a period of not less than twelve months from the balance sheet',
        '    date, and consider the going concern basis to be appropriate. Working',
        '    capital facilities of Rs. 6,00,00,000 are sanctioned and available',
        '    until 30 September 2027.',
      ],
      [
        '# Assets and liabilities',
        '',
        '18. The Company has satisfactory title to all owned assets, and no assets',
        '    are pledged or charged except as disclosed in note 12.',
        '',
        '19. Physical verification of inventory was carried out at reasonable',
        '    intervals during the year and discrepancies noticed were not material',
        '    and have been properly dealt with in the books of account.',
        '',
        '20. Trade receivables are stated at amounts considered realisable. The',
        '    allowance for expected credit losses of Rs. 42,60,000 is adequate.',
        '',
        '21. All liabilities, both actual and contingent, have been recorded or',
        '    disclosed as appropriate.',
        '',
        '',
        '# Internal financial controls',
        '',
        '22. We are responsible for establishing and maintaining internal financial',
        '    controls with reference to the financial statements, and we have',
        '    assessed their design and operating effectiveness as at 31 March 2026.',
        '',
        '23. We have disclosed to you all deficiencies in internal control of which',
        '    we are aware. The two deficiencies identified during the year, in the',
        '    approval of vendor master changes and in the review of bank',
        '    reconciliations, have been remediated with effect from 1 January 2026.',
      ],
      [
        '# Confirmation',
        '',
        'We confirm that the representations set out in this letter are made on the',
        'basis of enquiries of management and staff with relevant knowledge and',
        'experience, and, where appropriate, of inspection of supporting',
        'documentation sufficient to satisfy ourselves that we can properly make',
        'each of the above representations to you.',
        '',
        '',
        'Yours faithfully,',
        '',
        'For and on behalf of Sutlej Packaging Private Limited',
        '',
        '',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Latha Krishnan',
        'Title: Chief Financial Officer',
        '',
        '',
        '',
        'Signature: ______________________     Date: ________________',
        'Name:  Suresh Pillai',
        'Title: Managing Director',
        '',
        '',
        'Enclosures:',
        '  Schedule of uncorrected misstatements',
        '  Schedule of input tax credit reconciling items',
        '  Legal counsel confirmation dated 19 August 2026',
      ],
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Attachments — mixed types for tasks, expenses and CRM documents.
// ─────────────────────────────────────────────────────────────────────────────
const GIF_1X1 = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const VENDORS = [
  'Megha Stationers', 'Saraswati Printworks', 'Chenab Logistics',
  'Girnar Office Interiors', 'Simha Insurance Broking', 'Nilgiri Estates',
  'Ananta Ceramics LLP', 'Tungabhadra Foods', 'Sutlej Packaging',
  'Zanskar Medtech', 'Haldia Marine Services', 'Kaveri Facilities LLP',
];

function attachmentFiles() {
  const r = rng(0x4b41_5254);          // "KART"
  const out = [];
  const add = (name, data, what) => out.push({ name: `attachments/${name}`, data, what });

  // 8 PNG — receipt scans, whiteboard photographs, screenshots.
  for (let i = 0; i < 8; i++) {
    const w = 64 + i * 16, h = 48 + i * 12;
    const base = [0xf6 - i * 3, 0xf1 - i * 2, 0xe8];
    const ink = FACE_FG[i % FACE_FG.length];
    add(`receipt-scan-${String(i + 1).padStart(2, '0')}.png`,
      makePng(w, h, (x, y) => {
        if (y < 4 || y >= h - 4 || x < 4 || x >= w - 4) return ink;
        if ((y - 8) % 9 === 0 && x > 10 && x < w - 10 - (i * 3) % 20) return ink;
        return base;
      }),
      `PNG ${w}x${h}, stands in for a scanned receipt`);
  }

  // 6 PDF — one to three pages each.
  for (let i = 0; i < 6; i++) {
    const pages = 1 + (i % 3);
    const vendor = VENDORS[i];
    add(`expense-invoice-${String(i + 1).padStart(2, '0')}.pdf`,
      makePdf(Array.from({ length: pages }, (_, p) => [
        `# TAX INVOICE  -  ${vendor}`,
        `Invoice no. ${vendor.slice(0, 3).toUpperCase()}/2026/${1000 + i * 37}`,
        `Date: ${String(2 + i * 4).padStart(2, '0')} August 2026`,
        '',
        `Billed to: ${FIRM}`,
        FIRM_ADDR,
        '',
        `Page ${p + 1} of ${pages}`,
        '',
        'Description                                     Amount (Rs.)',
        '--------------------------------------------------------------',
        `Professional supplies, August 2026              ${(4000 + i * 1310).toLocaleString('en-IN')}`,
        `CGST 9 per cent                                  ${Math.round((4000 + i * 1310) * 0.09)}`,
        `SGST 9 per cent                                  ${Math.round((4000 + i * 1310) * 0.09)}`,
        '--------------------------------------------------------------',
        `Total                                           ${Math.round((4000 + i * 1310) * 1.18)}`,
        '',
        'This is a fixture. No such invoice exists and no such vendor exists.',
      ])),
      `PDF, ${pages} page(s), stands in for an expense invoice`);
  }

  // 7 TXT — file notes.
  for (let i = 0; i < 7; i++) {
    const vendor = VENDORS[(i + 3) % VENDORS.length];
    add(`file-note-${String(i + 1).padStart(2, '0')}.txt`,
      Buffer.from(
        `FILE NOTE\n`
        + `=========\n\n`
        + `Matter:  ${vendor}\n`
        + `Author:  Meera Joshi\n`
        + `Date:    ${String(1 + i * 4).padStart(2, '0')} August 2026\n\n`
        + `Call with the client finance team. They confirmed the August ledger is\n`
        + `closed and that the two reconciling items raised last month have been\n`
        + `cleared. Next review is scheduled for the second week of September.\n\n`
        + `Action: send the revised working paper by ${String(5 + i * 3).padStart(2, '0')} September 2026.\n\n`
        + `This is a test fixture. Every name in it is invented.\n`, 'utf8'),
      'Plain text file note');
  }

  // 6 CSV — working schedules. NOT bank statements; those live in bank/.
  for (let i = 0; i < 6; i++) {
    let csv = 'Line,Particulars,Quantity,Rate,Amount\n';
    let total = 0;
    for (let n = 1; n <= 5 + i; n++) {
      const qty = 1 + Math.floor(r() * 9);
      const rate = 250 + Math.floor(r() * 40) * 25;
      total += qty * rate;
      csv += `${n},"Item ${n}, schedule ${i + 1}",${qty},${rate},${qty * rate}\n`;
    }
    csv += `,,,Total,${total}\n`;
    add(`working-schedule-${String(i + 1).padStart(2, '0')}.csv`, Buffer.from(csv, 'utf8'),
      'CSV working schedule');
  }

  // 5 DOCX — genuinely valid store-only OOXML packages.
  for (let i = 0; i < 5; i++) {
    add(`memo-${String(i + 1).padStart(2, '0')}.docx`,
      makeDocx(`Internal memorandum ${i + 1}`, [
        `From: Rohit Ambekar, Designated Partner`,
        `Date: ${String(3 + i * 5).padStart(2, '0')} August 2026`,
        `Subject: ${VENDORS[(i + 6) % VENDORS.length]} - engagement status`,
        '',
        'The engagement is on schedule. The client has provided the trial balance'
        + ' and the bank statements for the period, and the reconciliation is'
        + ' complete to 31 July 2026.',
        'No matters requiring partner attention have arisen.',
        'This document is a test fixture.',
      ]),
      'DOCX (store-only ZIP, valid minimal OOXML)');
  }

  // 5 SVG — diagrams and marks. Every one passes uploads.py:_svg_is_safe: no
  // script, no handler, no external reference, no entity.
  for (let i = 0; i < 5; i++) {
    const fg = FACE_FG[i % FACE_FG.length];
    const hex = `#${fg.map(c => c.toString(16).padStart(2, '0')).join('')}`;
    add(`diagram-${String(i + 1).padStart(2, '0')}.svg`, Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" `
      + `viewBox="0 0 240 160" role="img" aria-label="E2E fixture diagram ${i + 1}">\n`
      + `  <title>KARTAVYA-E2E-ATTACHMENT-DIAGRAM-${i + 1}</title>\n`
      + `  <rect width="240" height="160" fill="#f4efe6"/>\n`
      + `  <rect x="16" y="${20 + i * 6}" width="${80 + i * 20}" height="28" rx="6" fill="${hex}"/>\n`
      + `  <circle cx="${180 - i * 10}" cy="100" r="${18 + i * 4}" fill="none" stroke="${hex}" stroke-width="6"/>\n`
      + `</svg>\n`, 'utf8'),
      'SVG diagram, checked against the _svg_is_safe constants');
  }

  // 3 GIF — the classic 43-byte 1x1. Included for the GIF89a magic-byte branch
  // in uploads.py:_MAGIC, not because the picture matters.
  for (let i = 0; i < 3; i++) {
    add(`marker-${String(i + 1).padStart(2, '0')}.gif`, GIF_1X1,
      'GIF89a 1x1, exercises the GIF magic-byte branch');
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The limit-crossing files. NEVER COMMITTED — that is the whole reason this is
// a generator. Sizes come from the constants, not from a number typed twice.
// ─────────────────────────────────────────────────────────────────────────────
//
//  backend/routers/uploads.py:25   MAX_BYTES       = 10 * 1024 * 1024
//  backend/routers/pahchan.py:120  MAX_PHOTO_BYTES = 768 * 1024
//
const LIMITS = {
  upload: 10 * 1024 * 1024,
  photo: 768 * 1024,
};

/** A file of exactly `bytes` length, one byte over a limit, deterministic. */
function ballast(bytes, header) {
  const buf = Buffer.alloc(bytes, 0);
  buf.write(header, 0, 'latin1');
  // A repeating printable pattern rather than zeros, so a truncated upload is
  // visible in a hex dump and a zero-filled file cannot be confused with it.
  const pat = Buffer.from('KARTAVYA-E2E-OVERSIZE-FIXTURE-DO-NOT-COMMIT-', 'latin1');
  for (let p = header.length; p < bytes; p += pat.length) {
    pat.copy(buf, p, 0, Math.min(pat.length, bytes - p));
  }
  return buf;
}

function oversizeFiles() {
  return [
    {
      name: 'oversize/oversize-10mb-plus-1.pdf',
      data: ballast(LIMITS.upload + 1, '%PDF-1.4\n% oversize fixture\n'),
      what: `${LIMITS.upload + 1} bytes = MAX_BYTES + 1. Crosses backend/routers/uploads.py:25. `
        + 'A .pdf extension on purpose: uploads.py:163 picks MAX_BYTES_VIDEO for a video '
        + 'extension, so a .mp4 of this size would be accepted.',
    },
    {
      name: 'oversize/oversize-photo-768kb-plus-1.png',
      data: ballast(LIMITS.photo + 1, '\x89PNG\r\n\x1a\n'),
      what: `${LIMITS.photo + 1} bytes = MAX_PHOTO_BYTES + 1. Crosses backend/routers/pahchan.py:120 `
        + 'on POST /v1/pahchan/punch/photo.',
    },
    {
      name: 'oversize/refused-type.md',
      data: Buffer.from('# Not an allowed type\n\n`.md` is in neither ALLOWED_TYPES nor '
        + 'ALLOWED_EXTENSIONS (backend/routers/uploads.py:28,76). Expect 415, not 413.\n', 'utf8'),
      what: 'Type-gate fixture. Small on purpose: it must be refused for its TYPE, '
        + 'so it must not also cross a size limit.',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Build.
// ─────────────────────────────────────────────────────────────────────────────
const files = [];

for (let i = 0; i < 30; i++) {
  files.push({
    name: `faces/face-${String(i + 1).padStart(2, '0')}.png`,
    data: facePng(i),
    what: 'Synthetic flat-geometry avatar, 96x96 PNG. Not a face. See the header of '
      + 'this script and backend/routers/pahchan.py:6.',
  });
}

for (const d of ESIGN_DOCS) {
  files.push({ name: `esign/${d.name}`, data: makePdf(d.pages), what: d.what });
}

files.push(...attachmentFiles());
files.push(...oversizeFiles());

// ── Self-checks that must hold before anything is written ────────────────────
const problems = [];
for (const f of files) {
  if (!f.data || f.data.length === 0) problems.push(`${f.name} is empty`);
}
// The 42-byte 1x1 transparent GIF. Decoded by hand when this check first fired
// (it was written asserting 43 and was wrong): GIF89a header, 1x1 logical
// screen, 2-entry global colour table, a graphic control extension with the
// transparency flag, an image descriptor, LZW minimum code size 2, a one-byte
// sub-block, and the 0x3b trailer.
if (GIF_1X1.length !== 42 || GIF_1X1.subarray(0, 6).toString('latin1') !== 'GIF89a'
    || GIF_1X1[GIF_1X1.length - 1] !== 0x3b || GIF_1X1[10] !== 0x80) {
  problems.push('the embedded 1x1 GIF is not the expected 42-byte GIF89a');
}
// Every generated PDF must be readable by BOTH page counters the product uses.
for (const f of files.filter(x => x.name.endsWith('.pdf') && !x.name.startsWith('oversize/'))) {
  const t = f.data.toString('latin1');
  const declared = Math.max(0, ...[...t.matchAll(/\/Count\s+(\d+)/g)].map(m => +m[1]));
  const objs = (t.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  if (declared === 0) problems.push(`${f.name}: no readable /Count — countPdfPages would return 0`);
  if (declared !== objs) problems.push(`${f.name}: /Count ${declared} but ${objs} page objects`);
}
if (problems.length) {
  console.error('Refusing to write. Self-check failed:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(2);
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const manifest = files
  .map(f => `${sha(f.data)}  ${String(f.data.length).padStart(9)}  ${f.name}`)
  .join('\n') + '\n';

if (CHECK_ONLY) {
  const p = path.join(OUT, 'MANIFEST.txt');
  if (!fs.existsSync(p)) {
    console.error(`No manifest at ${p}. Run without --check first.`);
    process.exit(1);
  }
  const onDisk = fs.readFileSync(p, 'utf8');
  if (onDisk !== manifest) {
    console.error('MANIFEST MISMATCH — this build is not byte-identical to the recorded one.');
    const a = onDisk.split('\n'), b = manifest.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.error(`  recorded: ${a[i] ?? '(none)'}\n  rebuilt : ${b[i] ?? '(none)'}`);
    }
    process.exit(1);
  }
  // Also confirm the bytes on disk still match.
  let bad = 0;
  for (const f of files) {
    const fp = path.join(OUT, f.name);
    if (!fs.existsSync(fp)) { console.error(`missing: ${f.name}`); bad++; continue; }
    if (sha(fs.readFileSync(fp)) !== sha(f.data)) { console.error(`changed: ${f.name}`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`✓ ${files.length} generated fixtures are byte-identical to the manifest.`);
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  const fp = path.join(OUT, f.name);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, f.data);
}
fs.writeFileSync(path.join(OUT, 'MANIFEST.txt'), manifest);
fs.writeFileSync(path.join(OUT, 'INDEX.txt'),
  files.map(f => `${f.name}\n    ${f.what}`).join('\n') + '\n');

const total = files.reduce((n, f) => n + f.data.length, 0);
const group = (p) => files.filter(f => f.name.startsWith(p));
console.log(`Wrote ${files.length} files to ${OUT} (${(total / 1024 / 1024).toFixed(2)} MB total)`);
for (const p of ['faces/', 'esign/', 'attachments/', 'oversize/']) {
  const g = group(p);
  console.log(`  ${p.padEnd(14)} ${String(g.length).padStart(3)} files  `
    + `${(g.reduce((n, f) => n + f.data.length, 0) / 1024).toFixed(0)} KB`);
}
console.log('\nMANIFEST.txt records a SHA-256 per file. Re-run with --check to prove determinism.');
