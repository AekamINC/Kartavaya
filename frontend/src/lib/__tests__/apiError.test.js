/**
 * `apiErrorText` must always return a string, and must never lose the reason.
 *
 * The case that matters most is the 422 array: it is TRUTHY, so the old
 * `detail || 'Failed to save'` kept it and handed an array of objects to a
 * React child. Proposal 93 Suite 05 hit it on every rate card without a note,
 * and all the screen ever said was "Failed to save".
 */
import { describe, it, expect } from 'vitest';
import { apiErrorText } from '../apiError';

const err = (data, extra = {}) => ({ response: { data, ...extra } });

describe('apiErrorText', () => {
  it('passes a plain string detail straight through', () => {
    expect(apiErrorText(err({ detail: 'Pending claim not found' }), 'x'))
      .toBe('Pending claim not found');
  });

  it('names the field on a 422 instead of rendering an array', () => {
    const out = apiErrorText(err({
      detail: [{ loc: ['body', 'notes'], msg: 'Input should be a valid string', type: 'string_type' }],
    }), 'Failed to save');
    expect(typeof out).toBe('string');
    expect(out).toBe('Notes: Input should be a valid string');
  });

  it('turns an underscored field path into a readable label', () => {
    expect(apiErrorText(err({
      detail: [{ loc: ['body', 'item_category'], msg: 'Field required' }],
    }), 'x')).toBe('Item category: Field required');
  });

  it('summarises rather than dumping a long 422', () => {
    const out = apiErrorText(err({
      detail: ['a', 'b', 'c', 'd'].map((f) => ({ loc: ['body', f], msg: 'Field required' })),
    }), 'x');
    expect(out).toBe('A: Field required; B: Field required (+2 more)');
  });

  it('unpacks the document-validation shape and names what is blocking', () => {
    const out = apiErrorText(err({
      detail: {
        error: 'document_incomplete',
        message: 'This TDS challan cannot be filed yet.',
        blocking: [{ field: 'tan', label: 'TAN' }, { field: 'amount', label: 'Amount deposited' }],
      },
    }), 'x');
    expect(out).toBe('This TDS challan cannot be filed yet. (TAN, Amount deposited)');
  });

  it('still names the blocking fields when there is no message', () => {
    expect(apiErrorText(err({ detail: { blocking: [{ label: 'TAN' }] } }), 'x'))
      .toBe('Missing: TAN');
  });

  it('falls back when the server said nothing usable', () => {
    expect(apiErrorText(err({}), 'Failed to save')).toBe('Failed to save');
    expect(apiErrorText(err({ detail: '   ' }), 'Failed to save')).toBe('Failed to save');
    expect(apiErrorText(err({ detail: [] }), 'Failed to save')).toBe('Failed to save');
    expect(apiErrorText(undefined, 'Failed to save')).toBe('Failed to save');
  });

  it('does not put an HTML gateway page in a toast', () => {
    expect(apiErrorText(err('<html><body>502 Bad Gateway</body></html>'), 'Failed to save'))
      .toBe('Failed to save');
  });

  it('NEVER returns a non-string, whatever it is handed', () => {
    const shapes = [
      { detail: [{ loc: ['body', 'x'], msg: 'bad' }] },
      { detail: { error: 'x' } },
      { detail: { blocking: [{}] } },
      { detail: 42 },
      { detail: null },
      {},
    ];
    for (const data of shapes) {
      expect(typeof apiErrorText(err(data), 'fallback')).toBe('string');
    }
  });
});
