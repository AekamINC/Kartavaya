/**
 * The billing period is IST on this side too, because the server's is.
 *
 * ── WHAT THIS IS PROTECTING ──────────────────────────────────────────────
 * Three admin and billing screens each derived the period from
 * `getUTCFullYear`/`getUTCMonth`, matching `credits.current_period()` while that
 * was UTC. Both sides moved to IST on 2026-09-04: every customer of this product
 * is an Indian firm, and a UTC month boundary rolled the billing period over at
 * 05:30 IST — booking a charge made at 02:00 on the 1st to the month that had
 * already ended, and on 1 April to the previous FINANCIAL YEAR.
 *
 * ⚠ THE TWO SIDES MUST MOVE TOGETHER OR NOT AT ALL. A form on a different clock
 * from the server offers lines the server will not bill. That is why these
 * assertions are written as a DIFFERENCE from what UTC gives at instants where
 * the two disagree — an assertion that only said "September" would be green for
 * every hour except the 5.5 a month it exists to guard, which is to say green in
 * CI and wrong in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { currentPeriod, todayIst, recentPeriods, thisMonth } from '../dates';

/* `src/`, found by walking up from the working directory — the same resolver
   `__tests__/moduleTables.test.jsx` uses. `import.meta.url` is NOT a file: URL
   under vitest's transform, which is how the first version of this failed. */
const SRC = (() => {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'src', 'lib', 'dates.js'))) return join(dir, 'src');
    dir = dirname(dir);
  }
  throw new Error('src not found from ' + process.cwd());
})();

/** What the OLD implementation returned for an instant. */
const utcPeriod = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Instants where India and the server disagree about the month. */
const DISAGREE = [
  ['2026-08-31T18:30:00Z', '2026-09', '00:00 IST on 1 September'],
  ['2026-08-31T20:00:00Z', '2026-09', '01:30 IST on 1 September'],
  ['2026-08-31T23:59:00Z', '2026-09', '05:29 IST on 1 September'],
  ['2026-03-31T18:30:00Z', '2026-04', '00:00 IST on 1 April — a NEW FY'],
  ['2026-03-31T20:00:00Z', '2026-04', '01:30 IST on 1 April — a NEW FY'],
  ['2025-12-31T19:00:00Z', '2026-01', '00:30 IST on 1 January'],
];

describe('the billing period follows India, not the server', () => {
  it.each(DISAGREE)('%s → %s (%s)', (iso, expected) => {
    const d = new Date(iso);
    expect(currentPeriod(d)).toBe(expected);
    // The half that a revert to UTC cannot survive.
    expect(currentPeriod(d)).not.toBe(utcPeriod(d));
  });

  it.each([
    ['2026-08-31T18:29:00Z', '23:59 IST on 31 August'],
    ['2026-09-01T00:00:00Z', '05:30 IST on 1 September'],
    ['2026-09-15T12:00:00Z', 'mid-month'],
  ])('agrees with UTC outside the window: %s (%s)', (iso) => {
    // Anti-vacuity. If the two disagreed everywhere, the cases above would say
    // nothing about WHEN this bites, and the change would be a data migration
    // rather than a forward-only fix.
    const d = new Date(iso);
    expect(currentPeriod(d)).toBe(utcPeriod(d));
  });

  it('the window is exactly 330 minutes wide', () => {
    // Measured by walking the boundary, not asserted. 18:30 UTC on the last day
    // of a month is 00:00 IST on the 1st; 00:00 UTC is 05:30 IST.
    const start = Date.parse('2026-08-31T18:30:00Z');
    let differing = 0;
    for (let i = 0; i < 24 * 60; i += 1) {
      const d = new Date(start + i * 60_000);
      if (currentPeriod(d) !== utcPeriod(d)) differing += 1;
    }
    expect(differing).toBe(330);
  });
});

describe('todayIst', () => {
  it('moves the DAY, not only the month on the 1st', () => {
    const d = new Date('2026-09-03T20:00:00Z'); // 01:30 IST on 4 September
    expect(todayIst(d)).toBe('2026-09-04');
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-03');
  });
});

describe('recentPeriods', () => {
  it('walks back by integer arithmetic, across a year boundary', () => {
    expect(recentPeriods(4, '2026-02')).toEqual(
      ['2026-02', '2026-01', '2025-12', '2025-11'],
    );
    expect(recentPeriods(3, '2027-01')).toEqual(['2027-01', '2026-12', '2026-11']);
  });

  it('defaults its anchor to the billing period, not the reader’s month', () => {
    // ⚠ ASSERTED ON THE SOURCE, BECAUSE NEITHER OTHER FORM WORKS.
    //
    // Every case here passes `from` explicitly, so the DEFAULT — the part that
    // carries the clock decision — was exercised by nothing, and mutation
    // proved it: swapping the default to `thisMonth()` left all 14 green.
    //
    // Comparing the two values instead would be worse than useless: it is green
    // on any machine whose local clock agrees with IST, which includes every
    // developer machine in this company and most CI runners set to UTC outside
    // the 5.5-hour window. A test that can only fail somewhere nobody runs it
    // is a test that has already failed.
    const src = readFileSync(join(SRC, 'lib', 'dates.js'), 'utf8');
    expect(src).toMatch(
      /export function recentPeriods\(count = 12, from = currentPeriod\(\)\)/,
    );
  });

  it('anchors on the IST period, which is the whole point', () => {
    // The previous version built each option with `Date.UTC(y, m - i, 1)` —
    // correct arithmetic on the wrong clock, so at 02:00 IST on the 1st the
    // dropdown started a month behind what the server considered open.
    const d = new Date('2026-08-31T20:00:00Z'); // 01:30 IST on 1 September
    expect(recentPeriods(2, currentPeriod(d))).toEqual(['2026-09', '2026-08']);
    expect(recentPeriods(2, utcPeriod(d))).toEqual(['2026-08', '2026-07']);
  });
});

describe('thisMonth is a different question and stays that way', () => {
  it('reads the reader’s clock, not India’s', () => {
    // `thisMonth` is for showing a person their own month. It takes no instant
    // and reads local time deliberately; conflating the two is what put three
    // billing screens on the wrong clock in the first place.
    expect(typeof thisMonth()).toBe('string');
    expect(thisMonth()).toMatch(/^\d{4}-\d{2}$/);
  });
});
