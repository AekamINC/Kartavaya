/**
 * The merge ledger cell that crashed the whole Dedupe tab.
 *
 * ⚠ IT HAD NEVER ONCE BEEN RENDERED. `graha_contact_merges` held zero rows for
 * its entire life, because the write path 500d on a column declared UUID
 * against ids that were never UUIDs (fixed by migration 240 and an explicit
 * `::uuid` cast removed from three call sites, 2026-08-29). An empty ledger
 * renders an empty table, and an empty table cannot reach this cell.
 *
 * The moment the first merge succeeded, the ledger rendered and threw React
 * error #31 — "objects are not valid as a React child" — from a `<td>`. The
 * ErrorBoundary caught it and the tab rendered NOTHING: not a broken cell, a
 * blank page with the whole screen gone.
 *
 * **That is the shape worth pinning: a broken write hides every bug downstream
 * of it.** Nothing about the read path was ever exercised, and its emptiness
 * read as "nobody has used this yet" rather than "this has never worked".
 *
 * These tests are unit-level on purpose. The crash is a pure function of the
 * cell's input, and a rendering test would need the whole module mounted to
 * prove something a shape assertion proves directly.
 */
import { describe, it, expect } from 'vitest';
import { movedRowsTotal, movedRowsDetail } from '../DedupeTab';

describe('movedRowsTotal — the cell that must never be handed an object', () => {
  it('sums a per-table jsonb object into ONE number', () => {
    // The exact shape `services/contact_dedupe.py` writes:
    //   json.dumps({t: len(v) for t, v in moved_rows.items()})
    expect(movedRowsTotal({ graha_activities: 3, graha_deals: 1, graha_documents: 5 })).toBe(9);
  });

  it('returns a primitive for EVERY input — never the object itself', () => {
    // The assertion that actually prevents the crash: React throws on an
    // object child, so what matters is not the arithmetic but that nothing
    // object-shaped ever comes back out.
    const inputs = [
      { a: 1 }, {}, null, undefined, 0, 7, 'four', [], [1, 2],
      { a: 'not a number' }, { a: 1, b: null },
    ];
    for (const input of inputs) {
      const out = movedRowsTotal(input);
      expect(
        typeof out === 'number' || typeof out === 'string',
        `movedRowsTotal(${JSON.stringify(input)}) returned a ${typeof out} — ` +
        'React refuses to render anything but a primitive, and this cell took ' +
        'the whole Dedupe tab down with it once already',
      ).toBe(true);
    }
  });

  it('shows an em dash for a merge that moved nothing, not a bare 0 or a blank', () => {
    expect(movedRowsTotal(null)).toBe('—');
    expect(movedRowsTotal(undefined)).toBe('—');
    // An empty object IS a real answer — the merge ran and moved no rows — so
    // it is 0 rather than a dash. "Nothing was moved" and "we have no record"
    // are different facts.
    expect(movedRowsTotal({})).toBe(0);
  });

  it('still reads a plain number, in case an older row carries one', () => {
    expect(movedRowsTotal(4)).toBe(4);
  });
});

describe('movedRowsDetail — the breakdown behind the number', () => {
  it('names each table and its count', () => {
    const d = movedRowsDetail({ graha_activities: 3, graha_deals: 1 });
    expect(d).toContain('graha_activities: 3');
    expect(d).toContain('graha_deals: 1');
  });

  it('omits tables that moved nothing, so the tooltip is not mostly zeroes', () => {
    expect(movedRowsDetail({ graha_activities: 2, graha_deals: 0 })).toBe('graha_activities: 2');
  });

  it('is undefined rather than empty when there is nothing to say', () => {
    // `title=""` renders an empty tooltip box on hover, which is worse than none.
    expect(movedRowsDetail({})).toBeUndefined();
    expect(movedRowsDetail(null)).toBeUndefined();
    expect(movedRowsDetail(7)).toBeUndefined();
  });
});
