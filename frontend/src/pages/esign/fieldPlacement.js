/**
 * The placement format, and every operation on it that is not React.
 *
 * ── WHY THE FORMAT LOOKS LIKE THIS ─────────────────────────────────────────
 *
 * The brief's rule is that the placement format must be the one the signer and
 * the PDF merger already understand. Measured, neither understands anything:
 * `SigningPage.jsx` never renders the PDF (it links to it — three copies of the
 * same `View document (PDF)` anchor), `POST /verify/{token}/sign` accepts
 * exactly `{signature_data, signature_type}`, and
 * `services/esign_signed_doc.build_signed_pdf` APPENDS a signature page rather
 * than stamping a coordinate on an existing one. There is no `sign_fields`
 * table and no positional column anywhere in `staging`.
 *
 * So the format is the one `backend/migrations/114_esign_field_placement.sql`
 * declares — written by a concurrent run on the same day, and the authority
 * here because `backend/tests/test_migrations_111_115.py` pins its shape. This
 * file was written against a 111 of its own before that one was found; the
 * duplicate was deleted rather than reconciled, because two migrations creating
 * `staging.sign_fields` is how one of them silently never runs.
 *
 * THE COLUMN MAPPING, so the router that lands between these two layers has one
 * instruction and not a guess:
 *
 *     wire                         staging.sign_fields
 *     ────────────────────────     ──────────────────────────────
 *     kind                     →   kind          (same five codes, lowercase)
 *     signer_order             →   signer_id     (resolved at insert; see below)
 *     page                     →   page
 *     top                      →   top_pct       NUMERIC(6,3)
 *     left                     →   left_pct      NUMERIC(6,3)
 *     width                    →   width_pct     NUMERIC(6,3)
 *     height                   →   height_pct    NUMERIC(6,3)  DEFAULT 9.000
 *
 * `_pct` is not carried on the wire because 114's own note says to map it in
 * the serialiser — the suffix exists because `left` is a reserved word in
 * Postgres, which is a database problem and not a JSON one.
 *
 * Why these units, restated because the migration and this file must not drift:
 *
 *  · PERCENTAGES, not points. The create surface has no page box to measure
 *    against — there is no PDF reader in this repo — so it cannot emit points.
 *    Percentages are resolution-independent and the stamping side can convert
 *    exactly: `x_pt = left/100 * page_width`,
 *    `y_pt = page_height - (top + height)/100 * page_height`, because PDF's
 *    origin is bottom-left and this format's is top-left. That is a two-line
 *    conversion in `esign_signed_doc`, against pypdf 6.14.2's
 *    `merge_transformed_page`, which is already installed.
 *  · TOP-LEFT ORIGIN, matching CSS and matching the prototype
 *    (`ScreensThin.jsx:393-397` stores `top` and `left`).
 *  · `signer_order`, NOT the signer's name. The prototype anchors a field to a
 *    signer by NAME (`who: 'Meera Joshi'`), which is neither unique nor stable.
 *    Signer rows do not exist yet at create time — `POST /v1/esign/documents`
 *    inserts them — so their ids cannot be referenced either. `sign_order` is
 *    the only key both sides hold: the client generates it, keeps it dense
 *    (`removeSigner` renumbers), and the backend inserts in that order.
 *  · `height` IS STORED. The prototype hard-codes `height: '9%'` at the render
 *    site and keeps no height in the data. A stamp with no height cannot be
 *    placed on a page, so a per-kind default is stored and is editable.
 *
 * Nothing in this file talks to the network or to React, which is why the whole
 * geometry is testable without a DOM.
 */

/**
 * The five kinds the prototype's palette offers (ScreensThin.jsx:422), with the
 * default box each one gets. `w`/`h` are percentages of the page.
 *
 * Signature 40x9, Date 26x9 and Initials 16x9 are the prototype's own numbers,
 * read off `FIELDS` and the hard-coded `height: '9%'`. Text and Checkbox appear
 * in the palette and in no fixture, so they are sized from what they hold: a
 * line of text is shorter than a signature and needs no signing room, and a
 * checkbox is square-ish on a 1:1.294 page (6% of width ≈ 7.8% of height).
 */
export const FIELD_KINDS = [
  { id: 'signature', label: 'Signature', w: 40, h: 9 },
  { id: 'initials', label: 'Initials', w: 16, h: 9 },
  { id: 'date', label: 'Date', w: 26, h: 9 },
  { id: 'text', label: 'Text', w: 30, h: 6 },
  { id: 'checkbox', label: 'Checkbox', w: 6, h: 4.6 },
];

export const KIND = Object.fromEntries(FIELD_KINDS.map(k => [k.id, k]));

/** Percent bounds. A field narrower than this cannot be grabbed with a mouse. */
export const MIN_W = 4;
export const MIN_H = 2.5;
export const MAX_FIELDS = 60;

/* `clampField` enforces `left + width <= 100` and `top + height <= 100`, which
   is `sign_fields_within_page` (114:232-237) held on the client as well. Not
   duplication for its own sake: the CHECK is the guarantee, and this is what
   stops the surface from letting a person build a placement the database will
   then refuse with a constraint violation they cannot read. */

/** THREE decimal places, because the columns are `NUMERIC(6,3)`
 *  (114_esign_field_placement.sql:203-206). A percentage carrying 14 of them is
 *  noise in a payload and noise in a diff; rounding to fewer than the column
 *  holds would throw away resolution the database was sized for. On a 595pt A4
 *  page 0.001% is 0.006pt — far finer than anything a person can place, which
 *  is the point: the rounding is for the payload, not for the placement. */
const r2 = n => Math.round(n * 1000) / 1000;

const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

let seq = 0;
/** Local id only. It is never sent — the server owns row identity. */
const nextId = () => `f${++seq}`;

/**
 * A new field, centred horizontally and dropped a third of the way down, which
 * is where an empty page has room. Successive fields of the same kind on the
 * same page cascade so the second one is not hidden under the first.
 */
export function makeField(kindId, signerOrder, page, existing = []) {
  const k = KIND[kindId];
  if (!k) throw new Error(`unknown field kind: ${kindId}`);
  const onPage = existing.filter(f => f.page === page).length;
  const step = (onPage % 6) * 4;
  return clampField({
    id: nextId(),
    kind: k.id,
    signer_order: signerOrder,
    page,
    top: 34 + step,
    left: 50 - k.w / 2 + step,
    width: k.w,
    height: k.h,
  });
}

/** Inside the page, always. Size is clamped first so position can use it. */
export function clampField(f) {
  const width = r2(clampN(f.width, MIN_W, 100));
  const height = r2(clampN(f.height, MIN_H, 100));
  return {
    ...f,
    width,
    height,
    left: r2(clampN(f.left, 0, 100 - width)),
    top: r2(clampN(f.top, 0, 100 - height)),
  };
}

export const moveField = (f, dLeft, dTop) =>
  clampField({ ...f, left: f.left + dLeft, top: f.top + dTop });

export const resizeField = (f, dW, dH) =>
  clampField({ ...f, width: f.width + dW, height: f.height + dH });

/**
 * The wire shape. `id` is dropped — it is a local handle, not a record — and
 * the order is stable (page, then top, then left) so two identical placements
 * produce identical payloads.
 */
export function toApiFields(fields) {
  return [...fields]
    .sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left)
    .map(f => ({
      kind: f.kind,
      signer_order: f.signer_order,
      page: f.page,
      top: r2(f.top),
      left: r2(f.left),
      width: r2(f.width),
      height: r2(f.height),
    }));
}

/**
 * What is wrong with a placement, in the words a person can act on.
 *
 * The rule that matters: a field belonging to a signer who has been removed is
 * silently orphaned otherwise, and would be sent as a placement for a signer
 * the document does not have. `removeSigner` renumbers, so a field can also end
 * up pointing at a DIFFERENT person than it was placed for — hence the
 * reassignment in `dropSigner` below rather than a validation message after the
 * fact.
 */
export function placementErrors(fields, signerCount) {
  const out = [];
  if (fields.length > MAX_FIELDS) {
    out.push(`A document can carry ${MAX_FIELDS} fields; this one has ${fields.length}.`);
  }
  const orphans = fields.filter(f => f.signer_order < 1 || f.signer_order > signerCount);
  if (orphans.length) {
    out.push(`${orphans.length} field${orphans.length === 1 ? '' : 's'} belong to a signer who is no longer on the document.`);
  }
  return out;
}

/**
 * Signer `order` is being removed. Fields belonging to them go with them;
 * fields belonging to anyone after them shift down one, because
 * `CreateTab.removeSigner` renumbers the remaining signers densely.
 *
 * Without this, removing signer 1 of 2 leaves signer 2's signature field
 * pointing at `sign_order: 2` on a document that now has only a signer 1 — the
 * field is either dropped by the server or, worse, attached to the wrong
 * person.
 */
export function dropSigner(fields, order) {
  return fields
    .filter(f => f.signer_order !== order)
    .map(f => (f.signer_order > order ? { ...f, signer_order: f.signer_order - 1 } : f));
}

/**
 * How many pages the PDF has — a HEURISTIC, and it says so by returning 0 when
 * it cannot tell.
 *
 * There is no PDF library in this repo (`package.json` has none, `node_modules`
 * has none) and the brief forbids a CDN script, so this reads the file's own
 * bytes. Two independent signals:
 *
 *   1. `/Type /Page` object headers, excluding `/Pages` (the tree node).
 *   2. The largest `/Count n` in the page tree.
 *
 * The larger wins, because linearised files repeat page objects and truncated
 * scans undercount. BOTH SIGNALS ARE INVISIBLE inside a compressed object
 * stream, which is how most PDF 1.5+ writers store the page tree — so a modern
 * file frequently reports 0 here. That is the honest answer and the caller
 * treats it as "unknown, assume one page and say so"; it is not a licence to
 * guess. A real page count needs a real reader — see the run report.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {number} pages, or 0 when the bytes do not say
 */
export function countPdfPages(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf || new ArrayBuffer(0));
  if (bytes.length < 5) return 0;

  // Decoded in 64 KB chunks with a 32-byte overlap, so a token cannot be split
  // across a boundary and lost. Capped: past 16 MB this is scanning a scan, and
  // the answer would not improve.
  const CAP = 16 * 1024 * 1024;
  const end = Math.min(bytes.length, CAP);
  const CHUNK = 65536;
  const OVERLAP = 32;

  let typePage = 0;
  let maxCount = 0;
  const reType = /\/Type\s*\/Page(?![s\w])/g;
  const reCount = /\/Count\s+(\d+)/g;

  for (let i = 0; i < end; i += CHUNK - OVERLAP) {
    let s = '';
    const stop = Math.min(i + CHUNK, end);
    for (let j = i; j < stop; j += 4096) {
      s += String.fromCharCode.apply(null, bytes.subarray(j, Math.min(j + 4096, stop)));
    }
    reType.lastIndex = 0;
    while (reType.exec(s)) typePage += 1;
    reCount.lastIndex = 0;
    let m;
    while ((m = reCount.exec(s))) maxCount = Math.max(maxCount, +m[1]);
  }

  const n = Math.max(typePage, maxCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "Signature · Meera Joshi · page 2" — the accessible name of a placed box. */
export function describeField(f, signerName) {
  return `${KIND[f.kind]?.label || f.kind} for ${signerName || `signer ${f.signer_order}`}, page ${f.page}`;
}
