/**
 * Turning a flat punch list into an attendance register.
 *
 * Pure — no React, no react-native, no network. Deliberately its own module so
 * the arithmetic that decides how many hours someone worked can be read, and
 * run, without a device. Every function here is exercised by
 * `register.check.mjs`.
 */

/** A punch from the server, or one still queued on this device. */
export interface RegisterPunch {
  id:             string;
  direction:      'in' | 'out';
  captured_at:    string;
  flags:          string[];
  accuracy_m:     number | null;
  distance_m:     number | null;
  review_verdict: 'ok' | 'flagged' | null;
  /** Captured here and not yet acknowledged by the server. */
  pending:        boolean;
}

export interface DayRecord {
  /** Local calendar day, `YYYY-MM-DD`. */
  date:     string;
  punches:  RegisterPunch[];
  firstIn?: RegisterPunch;
  lastOut?: RegisterPunch;
  /** Milliseconds between paired in/out punches. An unclosed `in` contributes
   *  nothing rather than counting up to now — a forgotten clock-out is not
   *  sixteen hours worked, and showing it as such would be a payroll claim. */
  workedMs: number;
  late:     boolean;
  /** Flagged by the server and not yet cleared by a reviewer. */
  review:   boolean;
  pending:  boolean;
}

/**
 * Local `YYYY-MM-DD` for an ISO instant.
 *
 * Local, not UTC. A 09:02 IST punch belongs to that day for the person who made
 * it, and `toISOString().slice(0,10)` would file everything before 05:30 IST
 * under the previous date — which is every early shift in the country.
 */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function keyFor(year: number, monthIndex: number, day: number): string {
  return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

/**
 * Group a flat punch list into per-day records.
 *
 * Pairing is a single ascending pass: an `in` opens a span, the next `out`
 * closes it. Unmatched punches are KEPT and shown — they are exactly the days
 * worth looking at — but they never invent worked time.
 *
 * A second `in` without an intervening `out` replaces the open one rather than
 * stacking, so a double-tap cannot silently double a day. The punches are all
 * still listed; only the arithmetic is conservative.
 */
export function buildDays(punches: RegisterPunch[]): Map<string, DayRecord> {
  const byDay = new Map<string, DayRecord>();

  const sorted = punches
    .filter(p => !Number.isNaN(new Date(p.captured_at).getTime()))
    .slice()
    .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());

  for (const p of sorted) {
    const key = localDayKey(p.captured_at);
    if (!key) continue;
    let rec = byDay.get(key);
    if (!rec) {
      rec = { date: key, punches: [], workedMs: 0, late: false, review: false, pending: false };
      byDay.set(key, rec);
    }
    rec.punches.push(p);
    if (p.flags.includes('late')) rec.late = true;
    if (p.flags.length > 0 && p.review_verdict !== 'ok') rec.review = true;
    if (p.pending) rec.pending = true;
  }

  for (const rec of byDay.values()) {
    let openedAt: number | null = null;
    for (const p of rec.punches) {
      const at = new Date(p.captured_at).getTime();
      if (p.direction === 'in') {
        if (!rec.firstIn) rec.firstIn = p;
        openedAt = at;
      } else {
        rec.lastOut = p;
        if (openedAt !== null) {
          rec.workedMs += Math.max(0, at - openedAt);
          openedAt = null;
        }
      }
    }
  }

  return byDay;
}

/** `HH:MM` in the device's own zone, or an em dash. */
export function hhmm(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

export function duration(ms: number): string {
  if (ms <= 0) return '—';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${`${m}`.padStart(2, '0')}m` : `${m}m`;
}

/** Monday-first leading blank count for a month grid, matching the reference's
 *  `M T W T F S S` header. `getDay()` is Sunday-first, hence the shift. */
export function leadingBlanks(year: number, monthIndex: number): number {
  return (new Date(year, monthIndex, 1).getDay() + 6) % 7;
}
