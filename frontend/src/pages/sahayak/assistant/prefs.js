/**
 * What the assistant shell remembers between visits.
 *
 * ── The complaint this file exists to answer ────────────────────────────────
 *
 * "why full page where is the option of switching view? and where the sidemenu
 * to see previous chat?"
 *
 * Both halves were BUILT and neither survived a reload. The conversation rail
 * opened from a pill in the composer footer and closed itself again on every
 * mount, so a person who opened it, read an old thread and refreshed was back to
 * a bare text box with no visible route to anything they had asked before. There
 * was no view switch at all.
 *
 * A preference that resets is not a preference, so all four live in one
 * localStorage record rather than in four keys — one read, one write, and a
 * shape that can be extended without inventing another key that some other
 * screen has to know about.
 *
 * ── Why every access is wrapped ─────────────────────────────────────────────
 *
 * `localStorage` throws on ACCESS and not only on write — Safari private mode
 * and a third-party-cookie block both make `window.localStorage` itself throw a
 * SecurityError. `sanvaad/EmojiPicker.jsx` records the same constraint and the
 * same fix. A preference is a nicety; it must never be the reason the assistant
 * fails to mount.
 *
 * Stored JSON is UNTRUSTED. It is a string a user can edit in devtools and a
 * string that an older build of this file may have written in another shape, so
 * every reader below narrows to the type it wants and falls back rather than
 * handing a caller `view: 42`.
 */

const KEY = 'kv_sahayak_shell';

/** The two reading views. `reading` is the default and paints no class at all,
 *  so the untouched surface stays exactly the transcribed prototype. */
export const READING = 'reading';
export const COMPACT = 'compact';

/**
 * The width at which the rail is a TRACK rather than an overlay.
 *
 * `sahayak.css` reverts the rail to an overlay below 1280px, because 296 + 320
 * leaves the thread narrower than the 760px `.sh__wrap` is measured at. Opening
 * an overlay unasked covers the thread; opening a track costs nothing that was
 * already on screen. So the FIRST-VISIT default is "open where it is free", and
 * a stored choice — either way — always wins over it.
 */
export const RAIL_TRACK_QUERY = '(min-width: 1280px)';

/** The whole record, or `{}`. Never throws, never returns a non-object. */
export function readShell() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Merge a patch in. Returns what was stored so a caller can avoid re-reading. */
export function writeShell(patch) {
  const next = { ...readShell(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode, or storage full — the screen still works without it */
  }
  return next;
}

/**
 * Rail open on first paint?
 *
 * A stored boolean is obeyed in both directions — someone who closed the rail
 * on a wide screen meant it. Only with nothing stored does the viewport decide.
 * `matchMedia` is absent in some test environments and can throw on a malformed
 * query in old engines, so it is both optional-chained and guarded.
 */
export function railDefault(stored) {
  if (typeof stored?.rail === 'boolean') return stored.rail;
  try {
    return !!window.matchMedia?.(RAIL_TRACK_QUERY)?.matches;
  } catch {
    return false;
  }
}

/** `reading` unless `compact` was explicitly chosen. */
export function viewOf(stored) {
  return stored?.view === COMPACT ? COMPACT : READING;
}

/**
 * The evidence pane, which is OPEN unless it was closed.
 *
 * The rows an answer was computed from are the strongest thing this product can
 * show for a figure, so the default is to show them; the switch exists because a
 * long table pushes the source cards off a short column.
 */
export function evidenceOf(stored) {
  return stored?.evidence !== false;
}

/** The conversation that was being read when the tab was last closed. */
export function sessionOf(stored) {
  const s = stored?.session;
  return typeof s === 'string' && s ? s : null;
}
