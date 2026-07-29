/**
 * validators.js — Indian tax and banking identifiers.
 *
 * These are fixed-format codes, so a typo is detectable at entry rather than
 * three weeks later when an invoice is rejected. Validate on BLUR, not per
 * keystroke: a GSTIN is invalid for the first 14 characters someone types, and
 * flagging it the whole way is noise that trains people to ignore the warning.
 *
 * Every validator accepts lowercase and surrounding whitespace and normalises
 * before checking — the field is uppercase-monospace by presentation, and
 * rejecting a pasted lowercase GSTIN would be pedantry, not validation.
 */

const norm = v => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** PAN: AAAAA9999A — five letters, four digits, one letter. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
//: TAN — four letters, five digits, one letter. Mirrors `_TAN_RE` in
//: `routers/org_profile.py`; the two must agree or the client passes something
//: the server then refuses.
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

/** GSTIN: 2-digit state code, the holder's PAN, entity digit, 'Z', checksum. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** IFSC: four-letter bank code, a reserved '0', six-character branch code. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The GSTIN check digit, per the GSTN specification.
 *
 * Worth doing rather than stopping at the shape: the regex alone accepts any
 * 15 characters in the right arrangement, so a transposed pair — the single
 * most common typing error in a code this long — sails through. The checksum
 * catches it.
 */
function gstinChecksum(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

/**
 * Each validator returns null when valid (including when empty — these fields
 * are optional; requiredness is the form's business, not the format's) or a
 * short message suitable for rendering under the input.
 */

export function validateGSTIN(value) {
  const v = norm(value);
  if (!v) return null;
  if (v.length !== 15) return `GSTIN is 15 characters (this is ${v.length}).`;
  if (!GSTIN_RE.test(v)) return 'Not a valid GSTIN format.';
  const expected = gstinChecksum(v.slice(0, 14));
  if (expected && v[14] !== expected) return 'GSTIN check digit does not match — look for a typo.';
  return null;
}

export function validatePAN(value) {
  const v = norm(value);
  if (!v) return null;
  if (v.length !== 10) return `PAN is 10 characters (this is ${v.length}).`;
  if (!PAN_RE.test(v)) return 'PAN must be five letters, four digits, then a letter.';
  return null;
}

/**
 * TAN — four letters, five digits, one letter (e.g. `AHMA12345B`).
 *
 * Unlike a GSTIN it carries no check digit, so shape is all that can be
 * verified at entry. That still catches the length and transposition mistakes
 * people actually make, which is the point of checking at all.
 *
 * Blank is legal: a firm that deducts no tax at source has no TAN, and the TDS
 * challan already refuses without one and says so.
 */
export function validateTAN(value) {
  const v = norm(value);
  if (!v) return null;
  if (v.length !== 10) return `TAN is 10 characters (this is ${v.length}).`;
  if (!TAN_RE.test(v)) return 'TAN must be four letters, five digits, then a letter.';
  return null;
}

export function validateIFSC(value) {
  const v = norm(value);
  if (!v) return null;
  if (v.length !== 11) return `IFSC is 11 characters (this is ${v.length}).`;
  if (!IFSC_RE.test(v)) return 'IFSC must be four letters, a zero, then six characters.';
  return null;
}

/** The PAN embedded in a GSTIN, so the two fields can be cross-checked. */
export function panFromGSTIN(value) {
  const v = norm(value);
  return GSTIN_RE.test(v) ? v.slice(2, 12) : null;
}

export { norm as normaliseCode };
