import React from 'react';

/**
 * CardGhost — the insertion placeholder (04-boards-table-views.md §2).
 *
 * `@hello-pangea/dnd` opens a gap between cards on its own, so the ghost is not
 * needed to show *where* a card will land in a populated column. The case it
 * exists for is the empty one: a column with no cards has nothing to open a gap
 * in, so a drag over it gives no feedback at all beyond the column tint, and a
 * user releasing there is guessing. This draws the outline of the card that is
 * about to appear.
 */
export default function CardGhost() {
  return <div className="bc__ghost" aria-hidden="true" />;
}
