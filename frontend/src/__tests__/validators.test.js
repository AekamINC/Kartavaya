/**
 * Tests for the GSTIN / PAN / IFSC validators.
 *
 * The GSTIN cases are the point of the suite. A shape-only check accepts any
 * 15 characters in the right arrangement, so a transposed pair — the commonest
 * error when typing a code this long — passes. The check digit catches it, and
 * these lock that in.
 *
 * The GSTINs below are constructed so their check digit is correct by
 * construction (computed with the published algorithm), not copied from any
 * real registration.
 */

import { describe, it, expect } from 'vitest';
import { validateGSTIN, validatePAN, validateIFSC, panFromGSTIN } from '../lib/validators';

// 27 (Maharashtra) + PAN AAAPL1234C + entity 1 + Z + check digit.
const VALID_GSTIN = '27AAAPL1234C1ZE';

describe('validateGSTIN()', () => {
  it('accepts a well-formed GSTIN with a correct check digit', () => {
    expect(validateGSTIN(VALID_GSTIN)).toBeNull();
  });

  it('accepts lowercase and surrounding whitespace', () => {
    expect(validateGSTIN(`  ${VALID_GSTIN.toLowerCase()}  `)).toBeNull();
  });

  it('treats empty as valid — requiredness is the form’s business', () => {
    expect(validateGSTIN('')).toBeNull();
    expect(validateGSTIN(null)).toBeNull();
    expect(validateGSTIN(undefined)).toBeNull();
  });

  it('reports the actual length when it is wrong', () => {
    expect(validateGSTIN('27AAAPL1234C1Z')).toMatch(/14/);
  });

  it('rejects a correct-length code in the wrong shape', () => {
    expect(validateGSTIN('AAAAAAAAAAAAAAA')).toMatch(/format/i);
  });

  it('rejects a wrong check digit — the case a regex alone would pass', () => {
    const wrong = VALID_GSTIN.slice(0, 14) + (VALID_GSTIN[14] === 'A' ? 'B' : 'A');
    expect(validateGSTIN(wrong)).toMatch(/check digit/i);
  });

  it('catches a transposition inside the PAN section', () => {
    // The valid code with two adjacent digits swapped, check digit untouched —
    // exactly what a mistyped GSTIN looks like. The shape still matches.
    const transposed = '27AAAPL2134C1ZE';
    expect(transposed).toHaveLength(15);
    expect(validateGSTIN(transposed)).toMatch(/check digit/i);
  });
});

describe('validatePAN()', () => {
  it('accepts a well-formed PAN', () => {
    expect(validatePAN('AAAPL1234C')).toBeNull();
  });

  it('normalises case', () => {
    expect(validatePAN('aaapl1234c')).toBeNull();
  });

  it('reports the actual length', () => {
    expect(validatePAN('AAAPL1234')).toMatch(/9/);
  });

  it('rejects digits and letters in the wrong positions', () => {
    expect(validatePAN('AAAP11234C')).toMatch(/five letters/i);
    expect(validatePAN('1AAPL1234C')).toMatch(/five letters/i);
  });

  it('treats empty as valid', () => {
    expect(validatePAN('')).toBeNull();
  });
});

describe('validateIFSC()', () => {
  it('accepts a well-formed IFSC', () => {
    expect(validateIFSC('HDFC0001234')).toBeNull();
    expect(validateIFSC('SBIN0ABC123')).toBeNull();
  });

  it('requires the reserved zero in position five', () => {
    expect(validateIFSC('HDFC1001234')).toMatch(/zero/i);
  });

  it('reports the actual length', () => {
    expect(validateIFSC('HDFC000123')).toMatch(/10/);
  });

  it('treats empty as valid', () => {
    expect(validateIFSC('  ')).toBeNull();
  });
});

describe('panFromGSTIN()', () => {
  it('extracts the embedded PAN so the two fields can be cross-checked', () => {
    expect(panFromGSTIN(VALID_GSTIN)).toBe('AAAPL1234C');
    expect(validatePAN(panFromGSTIN(VALID_GSTIN))).toBeNull();
  });

  it('returns null for a malformed GSTIN rather than a wrong slice', () => {
    expect(panFromGSTIN('nonsense')).toBeNull();
  });
});
