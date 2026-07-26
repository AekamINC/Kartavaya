/**
 * Tests for the invoice-row formatters and the billing status map.
 *
 * What they guard:
 *  · Invoice rows printed raw ISO pairs ("2026-07-01 → 2026-07-31") — three
 *    times the width of the useful information, and read as a database value.
 *  · The status column printed the raw lowercase enum ("active").
 *  · Badge backgrounds were built as `${c}18`, appending hex alpha by string
 *    concatenation. That works only while the colour is a 6-digit literal;
 *    the moment it became a token, "var(--ok)18" was not a colour and the
 *    background silently disappeared. mixAlpha() is the replacement, so these
 *    assert it emits something a browser will actually parse.
 */

import { describe, it, expect } from 'vitest';
import { formatPeriod, formatDate } from '../lib/timeFormat';
import { billingColor, billingLabel, mixAlpha } from '../lib/statusColors';

describe('formatPeriod()', () => {
  it('collapses a single calendar month to "Jul 2026"', () => {
    expect(formatPeriod('2026-07-01', '2026-07-31')).toBe('Jul 2026');
  });

  // Asserted structurally, not against a literal month name: en-IN abbreviates
  // September as "Sept", and pinning the exact string here would make the suite
  // hostage to the runtime's ICU data rather than testing this function.
  it('shows a range within one year without repeating the year', () => {
    const out = formatPeriod('2026-07-01', '2026-09-30');
    expect(out).toMatch(/^Jul – Sept? 2026$/);
    expect(out.match(/2026/g)).toHaveLength(1);
  });

  it('carries both years when the period straddles a year boundary', () => {
    expect(formatPeriod('2026-12-01', '2027-02-28')).toBe('Dec 2026 – Feb 2027');
  });

  it('tolerates a missing end date', () => {
    expect(formatPeriod('2026-07-01', null)).toBe('Jul 2026');
  });

  it('returns an em dash rather than "Invalid Date" when both are missing', () => {
    expect(formatPeriod(null, null)).toBe('—');
  });

  it('falls back to the raw values rather than throwing on unparseable input', () => {
    expect(formatPeriod('not-a-date', 'also-bad')).toBe('not-a-date → also-bad');
  });
});

describe('formatDate()', () => {
  it('renders a readable date', () => {
    expect(formatDate('2026-07-26')).toMatch(/Jul/);
    expect(formatDate('2026-07-26')).toMatch(/2026/);
  });

  it('returns an em dash for a missing date instead of an empty cell', () => {
    expect(formatDate(null)).toBe('—');
  });
});

describe('billing status', () => {
  it('never returns a raw lowercase enum', () => {
    expect(billingLabel('active')).toBe('Active');
    expect(billingLabel('cancelled')).toBe('Cancelled');
  });

  it('title-cases an unknown status rather than leaking it verbatim', () => {
    expect(billingLabel('past_due')).toBe('Past Due');
  });

  it('returns an em dash for no status', () => {
    expect(billingLabel(undefined)).toBe('—');
  });

  it('maps every status to a token, never a hex', () => {
    for (const s of ['active', 'paid', 'trialing', 'pending', 'paused', 'cancelled', 'overdue']) {
      expect(billingColor(s)).toMatch(/^var\(--/);
    }
  });

  it('falls back to a token for an unknown status', () => {
    expect(billingColor('nonsense')).toMatch(/^var\(--/);
  });
});

describe('mixAlpha()', () => {
  it('produces a real colour function, not a concatenated hex suffix', () => {
    const bg = mixAlpha(billingColor('active'), 14);
    expect(bg).toBe('color-mix(in srgb, var(--ok) 14%, transparent)');
    // The regression in one line: the old form appended "18" to the colour.
    expect(bg).not.toMatch(/^var\(--[\w-]+\)\d+$/);
  });
});
