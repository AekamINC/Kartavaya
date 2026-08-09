/**
 * deltaCursor — where a delta sync's cursor moves after each page.
 *
 * Its own module, with NO imports, for one reason: this is the part of the sync
 * where a mistake is completely silent, so it has to be testable, and
 * `sessionSync` cannot be loaded in a test — it pulls in the network client and
 * native storage.
 *
 * Both failure modes look like a working sync from the outside:
 *
 *   · A cursor that advances TOO FAR marks rows as covered that were never
 *     sent. Nothing will ever ask for them again, so the phone quietly shows a
 *     figure that stopped being true.
 *   · A cursor that never advances leaves the device permanently one page
 *     behind, opening the app again and again and catching up on nothing.
 */

/** The newest `updated_at` in a delta page, for resuming a truncated window. */
export function lastStamp(rows: Array<Record<string, unknown>>): string | null {
  const last = rows[rows.length - 1];
  const at = last?.updated_at;
  return typeof at === 'string' ? at : null;
}

export interface DeltaBody {
  data?: Array<Record<string, unknown>>;
  synced_at?: string;
  truncated?: boolean;
}

/**
 * Where one delta page leaves the cursor, and whether the source is finished.
 */
export function pagePlan(body: DeltaBody, cursor: string):
    { cursor: string; finished: boolean } {
  if (!body?.truncated) {
    // A complete window: covered up to the server's own clock. A response with
    // no `truncated` field is complete too — every endpoint that can truncate
    // says so, and paging an older one for ever would be the worse guess.
    const at = body?.synced_at;
    return { cursor: typeof at === 'string' && at > cursor ? at : cursor, finished: true };
  }
  const stamp = lastStamp(body.data ?? []);
  if (!stamp || stamp <= cursor) {
    // No usable stamp, or it did not move — a full page of rows sharing one
    // timestamp (200 rows written in one transaction) would otherwise loop for
    // ever on the same page. Stay put and let the next sync try: guessing
    // forward would skip rows silently, which is the worse of the two.
    return { cursor, finished: false };
  }
  return { cursor: stamp, finished: false };
}

/**
 * The one cursor to store, given how far each source got.
 *
 * The SMALLEST, not the largest. One source left mid-window holds all of them
 * back; taking the max would move the cursor past rows nobody fetched.
 */
export function coveredFloor(points: string[]): string | null {
  if (!points.length) return null;
  return points.reduce((a, b) => (b < a ? b : a));
}
