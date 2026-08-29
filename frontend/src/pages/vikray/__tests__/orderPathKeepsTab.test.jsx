/**
 * Vikray · the record's URL must carry the tab the reader came from.
 *
 * ── The defect this file exists to prevent ──────────────────────────────────
 *
 * `orderPath(id)` returned `/vikray/orders/<id>` with no query. `VikrayPage`
 * reads its open tab from `?tab=` and falls back to the STARRED DEFAULT when
 * the query is absent — so opening an order from the orders list navigated to a
 * URL with no tab in it, and the list behind the drawer silently became
 * whichever tab the reader had starred. On the reference org that is Pipeline.
 *
 * `OrderRoute.jsx`'s own header says keeping the list underneath is the entire
 * reason the record is a nested route: "Back returns the reader to the tab, the
 * stage filter and the chip they left." It could not, because the tab was
 * dropped on the way in — and a shared link or a refresh landed the reader on a
 * tab they had never opened.
 *
 * Found by proposal 93 Suite 10 (10.05) on 2026-08-29, driving the real screen
 * against staging: after opening an order the orders panel was gone from behind
 * the drawer and the pipeline panel had taken its place.
 *
 * A unit test rather than only the e2e one because this is a pure string
 * contract, and because the e2e check costs six minutes of seeding to reach.
 */
import { describe, it, expect } from 'vitest';
import { orderPath } from '../_shared';

describe('Vikray · orderPath keeps the reader on their tab', () => {
  it('carries the search string it is given', () => {
    expect(orderPath('abc', '?tab=orders')).toBe('/vikray/orders/abc?tab=orders');
  });

  it('accepts a search string with no leading question mark', () => {
    expect(orderPath('abc', 'tab=customers')).toBe('/vikray/orders/abc?tab=customers');
  });

  it('keeps every other parameter, not just the tab', () => {
    // `VikrayPage.setTab` mutates the existing params rather than replacing
    // them precisely because this page carries others. Dropping them here
    // would undo that from the other end.
    expect(orderPath('abc', '?tab=orders&status=draft'))
      .toBe('/vikray/orders/abc?tab=orders&status=draft');
  });

  it('is still a bare path when the caller genuinely has no context', () => {
    // A notification deep-link has no tab to preserve, and inventing one would
    // send the reader somewhere they did not ask for.
    expect(orderPath('abc')).toBe('/vikray/orders/abc');
    expect(orderPath('abc', '')).toBe('/vikray/orders/abc');
    expect(orderPath('abc', '?')).toBe('/vikray/orders/abc');
  });

  it('still encodes the id', () => {
    expect(orderPath('a/b', '?tab=orders')).toBe('/vikray/orders/a%2Fb?tab=orders');
  });
});
