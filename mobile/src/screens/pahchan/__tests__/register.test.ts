/**
 * `register.ts` — the arithmetic that decides how many hours someone worked.
 *
 * These checks are NOT new. They were written as `register.check.mjs`, a
 * standalone script, because at the time `mobile/` had no runner: "There is no
 * test runner in `mobile/` — `tsc --noEmit` is the only gate — so this is a
 * plain script that exits non-zero on a wrong answer."
 *
 * That is no longer true, and the script had become the worse problem: it was
 * not matched by the `src/**\/*.test.ts` glob, so twelve real checks over
 * payroll arithmetic ran only when somebody remembered to type the command by
 * hand. They passed, and they gated nothing.
 *
 * Ported verbatim in substance to `node:test` so they run with everything else.
 * `register.ts` is pure — no React, no react-native, no network — so this needs
 * none of the harness stubs and executes the real module.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDays, localDayKey, keyFor, duration, hhmm, leadingBlanks,
  type RegisterPunch,
} from '../register.ts';

const punch = (over: Partial<RegisterPunch> = {}): RegisterPunch => ({
  id: Math.random().toString(36).slice(2),
  direction: 'in',
  captured_at: '2026-07-06T09:02:00+05:30',
  flags: [],
  accuracy_m: 12,
  distance_m: 40,
  review_verdict: null,
  pending: false,
  ...over,
});

test('a normal day pairs in→out and totals the span', () => {
  const days = buildDays([
    punch({ direction: 'in',  captured_at: '2026-07-06T09:02:00+05:30' }),
    punch({ direction: 'out', captured_at: '2026-07-06T17:30:00+05:30' }),
  ]);
  const rec = days.get('2026-07-06');
  assert.ok(rec, 'day exists');
  assert.equal(duration(rec!.workedMs), '8h 28m');
  assert.equal(rec!.punches.length, 2);
});

test('punches arrive newest-first from /me and are still paired correctly', () => {
  // The endpoint orders by captured_at DESC. buildDays must not depend on that.
  const days = buildDays([
    punch({ direction: 'out', captured_at: '2026-07-06T17:30:00+05:30' }),
    punch({ direction: 'in',  captured_at: '2026-07-06T09:02:00+05:30' }),
  ]);
  assert.equal(duration(days.get('2026-07-06')!.workedMs), '8h 28m');
});

test('a forgotten clock-out contributes ZERO, not hours-until-now', () => {
  // Counting up to now would turn a forgotten punch into a sixteen-hour payroll
  // claim.
  const days = buildDays([punch({ direction: 'in', captured_at: '2026-07-06T09:02:00+05:30' })]);
  const rec = days.get('2026-07-06')!;
  assert.equal(rec.workedMs, 0);
  assert.equal(duration(rec.workedMs), '—');
  assert.ok(rec.firstIn, 'the in punch is still recorded');
  assert.equal(rec.lastOut, undefined);
});

test('two spans on one day sum (a lunch break out and back)', () => {
  const days = buildDays([
    punch({ direction: 'in',  captured_at: '2026-07-06T09:00:00+05:30' }),
    punch({ direction: 'out', captured_at: '2026-07-06T13:00:00+05:30' }),
    punch({ direction: 'in',  captured_at: '2026-07-06T14:00:00+05:30' }),
    punch({ direction: 'out', captured_at: '2026-07-06T18:00:00+05:30' }),
  ]);
  assert.equal(duration(days.get('2026-07-06')!.workedMs), '8h 00m');
});

test('a double clock-in does not double the day', () => {
  const days = buildDays([
    punch({ direction: 'in',  captured_at: '2026-07-06T09:00:00+05:30' }),
    punch({ direction: 'in',  captured_at: '2026-07-06T09:01:00+05:30' }),
    punch({ direction: 'out', captured_at: '2026-07-06T17:00:00+05:30' }),
  ]);
  // Second `in` replaces the open one: 09:01→17:00, not 09:00→17:00 twice.
  assert.equal(duration(days.get('2026-07-06')!.workedMs), '7h 59m');
  assert.equal(days.get('2026-07-06')!.punches.length, 3, 'all three are still listed');
});

test('an early-morning IST punch files under its LOCAL day, not the UTC one', () => {
  // 2026-07-06T05:00+05:30 is 2026-07-05T23:30Z. A UTC key would say the 5th,
  // which is every early shift in the country filed under the wrong date.
  const key = localDayKey('2026-07-06T05:00:00+05:30');
  const utc = new Date('2026-07-06T05:00:00+05:30').toISOString().slice(0, 10);
  assert.equal(utc, '2026-07-05', 'precondition: UTC really does disagree here');
  // Only meaningful when this machine runs IST; assert the invariant that holds
  // everywhere instead — the key matches the LOCAL date of that instant.
  const d = new Date('2026-07-06T05:00:00+05:30');
  assert.equal(key, keyFor(d.getFullYear(), d.getMonth(), d.getDate()));
});

test('flags drive late / needs-review, and an ok verdict clears review', () => {
  const late = buildDays([punch({ flags: ['late'] })]).get('2026-07-06')!;
  assert.equal(late.late, true);
  assert.equal(late.review, true, 'an uncleared flag needs review');

  const cleared = buildDays([punch({ flags: ['late'], review_verdict: 'ok' })]).get('2026-07-06')!;
  assert.equal(cleared.late, true, 'it was still a late punch');
  assert.equal(cleared.review, false, 'but a human has looked at it');

  const clean = buildDays([punch({})]).get('2026-07-06')!;
  assert.equal(clean.review, false);
});

test('a queued punch marks the day pending', () => {
  const rec = buildDays([punch({ pending: true, flags: ['offline'] })]).get('2026-07-06')!;
  assert.equal(rec.pending, true);
});

test('an unparseable timestamp is dropped, not crashed on', () => {
  const days = buildDays([punch({ captured_at: 'not-a-date' }), punch({})]);
  assert.equal(days.size, 1);
});

test('duration formats', () => {
  assert.equal(duration(0), '—');
  assert.equal(duration(-5), '—');
  assert.equal(duration(45 * 60000), '45m');
  assert.equal(duration(60 * 60000), '1h 00m');
  assert.equal(duration(8 * 60 * 60000 + 5 * 60000), '8h 05m');
});

test('hhmm zero-pads and handles missing', () => {
  assert.equal(hhmm(undefined), '—');
  assert.equal(hhmm('nonsense'), '—');
  const d = new Date('2026-07-06T09:02:00+05:30');
  const expect = `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
  assert.equal(hhmm('2026-07-06T09:02:00+05:30'), expect);
});

test('the month grid is Monday-first', () => {
  // 1 July 2026 is a Wednesday → two blanks before it (Mon, Tue).
  assert.equal(new Date(2026, 6, 1).getDay(), 3, 'precondition: it is a Wednesday');
  assert.equal(leadingBlanks(2026, 6), 2);
  // 1 Feb 2026 is a Sunday → six blanks, not zero.
  assert.equal(new Date(2026, 1, 1).getDay(), 0, 'precondition: it is a Sunday');
  assert.equal(leadingBlanks(2026, 1), 6);
});
