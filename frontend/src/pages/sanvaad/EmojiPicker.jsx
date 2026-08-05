/**
 * EmojiPicker.jsx — the full emoji picker, behind a search box.
 *
 * WHAT THIS REPLACES. `Composer` offered five hard-coded glyphs in a row and
 * called it a picker; `Message`'s hover tray offered the same five. Those five
 * stay — `06-sanvaad-varta.md` §Plus calls them "content, not chrome" and
 * proposal 09 §4 keeps them as the quick row — but they are now the top of a
 * picker rather than the whole of one.
 *
 * NO NEW DEPENDENCY, AND THAT WAS CHECKED RATHER THAN ASSUMED.
 * `frontend/package.json` carries no emoji package: the runtime deps are
 * capacitor, dnd, supabase, vercel analytics, axios, clsx, lucide-react, react,
 * react-dom, react-router-dom and tailwind-merge. `emoji-mart` is the obvious
 * reach and it is ~1.2 MB with its own data package, a second theming system
 * and its own React version constraints — for a grid of buttons over a list of
 * strings. So the list is `emojiData.js` and the grid is below.
 *
 * THE DATA IS LAZY AND MUST STAY LAZY. `import('./emojiData')` is a dynamic
 * import, which Vite emits as its own chunk; proposal 09 §4 is explicit that the
 * dataset "must not sit in the main bundle". A static `import { CATEGORIES }`
 * anywhere in the module graph — here, in `Message`, in a test — puts it back
 * into the entry chunk and the only symptom is a slower first paint on every
 * page of the product, including the ones with no chat on them.
 *
 * POSITIONED `fixed`, FOR THE REASON `.cmp__mn` IS. The two call sites are both
 * inside `.sv`, which is `overflow: hidden`, and the message tray is also inside
 * `.sv__log`, which is `overflow-y: auto`. An absolutely-positioned panel is
 * clipped by either, which is to say it does not appear. `MentionInput` solved
 * this once already and this follows it: viewport coordinates, measured from the
 * trigger, on the picker rung of the z-ladder.
 *
 * MARKUP THIS EXPECTS (styled in sanvaad.css):
 *   .emo                      the panel
 *     .emo__q                 the search field
 *     .emo__quick             the five quick reactions
 *     .emo__scroll            the scrolling body
 *       .emo__cat             a category heading
 *       .emo__g               the 8-column grid
 *         .emo__b             one emoji (a button)
 *     .emo__none              "nothing matches"
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The five quick reactions.
 *
 * DECLARED HERE AND NOT IN `Message.jsx`, which is where they used to live and
 * where `Composer` imported them from. `Message` now renders this component, so
 * a `QUICK` still exported from `Message` and imported by this file would be a
 * cycle — and an ES module cycle does not fail loudly, it hands one of the two
 * files a partially-initialised namespace and produces `undefined.map` at a
 * point that has nothing to do with the cause. `Message` re-exports the name so
 * that a caller reaching for it in the obvious place still finds it.
 */
export const QUICK = ['👍', '✅', '👀', '❤️', '😂'];

/**
 * The picker/menu rung of `26-motion-z.md` §4's ladder — 200 drawer · 340 picker
 * and menu · 420 modal · 520 toast · 620 sheet. The same constant `MentionInput`
 * sets, for the same reason and with the same history behind it: this kind of
 * popup shipped at 999 once and covered every toast raised while it was open.
 */
const POP_Z = 340;
/** Keep the panel off the very edge of the window. */
const GUTTER = 8;
/** Matches `.emo`'s own width in sanvaad.css; used before it has rendered. */
const PANEL_W = 288;
/** Matches `.emo`'s `max-height`. */
const PANEL_H = 340;

/**
 * How many recently-used glyphs are kept, and where.
 *
 * Proposal 09 §4: "Frequently-used is per person, stored locally. No schema, no
 * request. The row that matters most is the one you build yourself." Sixteen is
 * two rows of the 8-column grid — enough to be the row somebody actually uses,
 * short enough that it stays sorted by genuine recency rather than becoming a
 * second copy of the whole list.
 */
const RECENT_KEY = 'sanvaad.emoji.recent';
const RECENT_MAX = 16;

/**
 * Both of these swallow. `localStorage` throws on ACCESS, not only on write, in
 * Safari's private mode and wherever a site is blocked from storing data — so
 * the read is guarded as carefully as the write. A reader with storage disabled
 * gets a picker with no recents row, which is the feature degrading; an
 * unguarded read gets them a picker that throws while rendering, which takes the
 * message log down with it.
 */
export function readRecent() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter(e => typeof e === 'string' && e).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Most recent first, de-duplicated, capped. Call it wherever an emoji is USED —
 *  the quick row and the hover tray both count, or the recents row would only
 *  ever learn about glyphs chosen the slow way. */
export function rememberEmoji(char) {
  if (typeof char !== 'string' || !char) return;
  try {
    const next = [char, ...readRecent().filter(e => e !== char)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the picker still works, it just does not remember */
  }
}

/**
 * Where the panel goes, in viewport coordinates.
 *
 * Below the trigger when there is room, above it when there is not — which is
 * the whole reason this is computed rather than authored. The composer's smiley
 * sits ~50px off the bottom of the window and its panel has to grow upwards; the
 * hover tray's `+` can be anywhere in the log and usually has room below it. One
 * rule, two answers.
 *
 * `left` is the trigger's left edge, clamped so the panel cannot leave the
 * window on a narrow screen — the tray sits at `right: 14px` of the message row,
 * so on a phone its natural left edge is off the right of the viewport.
 */
function place(rect) {
  const belowRoom = window.innerHeight - rect.bottom - GUTTER;
  const above = belowRoom < PANEL_H && rect.top > belowRoom;
  const left = Math.max(
    GUTTER,
    Math.min(rect.left, window.innerWidth - GUTTER - PANEL_W)
  );
  return above
    ? { left, bottom: Math.max(GUTTER, window.innerHeight - rect.top + 6) }
    : { left, top: Math.max(GUTTER, rect.bottom + 6) };
}

export default function EmojiPicker({
  /** The DOM node the panel is anchored to — the button that opened it. */
  anchor,
  /** Called with the chosen character. The caller decides what "chosen" means:
   *  the composer inserts it, the message row posts a reaction. */
  onPick,
  onClose,
  /** The accessible name. Two call sites, two different jobs, and a panel
   *  announced as "Insert emoji" while it is adding a reaction is a panel that
   *  lies to exactly the readers who cannot see which button opened it. */
  label = 'Choose an emoji',
}) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(null);
  // Read ONCE, on mount. Re-reading after every pick would reorder the row under
  // the pointer mid-click, which is how a reader ends up posting 🎉 because the
  // grid moved between mousedown and mouseup.
  const [recent] = useState(readRecent);

  const panel = useRef(null);

  /* ── The dataset ──────────────────────────────────────────────────────────
   * `dead` rather than an AbortController: a dynamic import cannot be
   * cancelled, so the only thing to guard is the setState after an unmount —
   * which is exactly what a picker closed inside the first 100ms produces. */
  useEffect(() => {
    let dead = false;
    import('./emojiData')
      .then((m) => { if (!dead) setData(m); })
      .catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, []);

  /* ── Placement ───────────────────────────────────────────────────────────
   * `useLayoutEffect`, so the corrected coordinates are the first ones painted
   * rather than a frame of the panel sitting at the top-left of the window.
   * Re-run when the data lands because the panel's height changes from one line
   * ("Loading…") to its full box, and a panel anchored by its BOTTOM has to be
   * re-placed when it grows or it covers the button that opened it. */
  useLayoutEffect(() => {
    if (!anchor?.getBoundingClientRect) return;
    setPos(place(anchor.getBoundingClientRect()));
  }, [anchor, data]);

  /* ── Dismissal ───────────────────────────────────────────────────────────
   * Bound only while the panel is up, as `MentionInput` binds its own: a
   * document-level listener that outlives the popup is a cost every message in
   * every channel pays.
   *
   * The ANCHOR counts as inside. Both call sites toggle on click, so a mousedown
   * on the trigger that also reached this handler would close the panel and then
   * the click would reopen it — a button that appears not to work. */
  useEffect(() => {
    const down = (e) => {
      if (panel.current?.contains(e.target)) return;
      if (anchor?.contains?.(e.target)) return;
      onClose?.();
    };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      // stopPropagation for the reason `MentionInput` gives: Escape is also the
      // close key of the thread panel and of the channel settings sheet this
      // picker can be opened inside, and dismissing the picker must not take the
      // panel behind it as well.
      e.stopPropagation();
      onClose?.();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  const choose = useCallback((char) => {
    rememberEmoji(char);
    onPick?.(char);
  }, [onPick]);

  const hits = query.trim() && data ? data.searchEmoji(query) : null;

  const cell = (char, key) => (
    <button
      key={key}
      type="button"
      className="emo__b"
      // preventDefault on mousedown, exactly as the mention popup and the
      // formatting strip do: a click fires after the mousedown that would have
      // blurred the composer, and a blurred textarea has lost the caret the
      // glyph is about to be inserted at.
      onMouseDown={e => e.preventDefault()}
      onClick={() => choose(char)}
      aria-label={char}
      title={char}
    >
      <span aria-hidden="true">{char}</span>
    </button>
  );

  return (
    <div
      ref={panel}
      className="emo"
      role="dialog"
      aria-label={label}
      /* Position is inline because it is MEASURED; everything with an authored
         value — width, surface, border, radius, shadow, grid, cell size — is
         `.emo` in sanvaad.css. `visibility` rather than a null render before the
         first measurement, so the panel is in the DOM for `useLayoutEffect` to
         measure and the reader never sees it at the origin. */
      style={{ position: 'fixed', zIndex: POP_Z, visibility: pos ? undefined : 'hidden', ...(pos || { left: 0, top: 0 }) }}
    >
      <input
        className="emo__q"
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search emoji…"
        aria-label="Search emoji"
        autoFocus
      />

      {/* The five, above the fold and above the search results, because they are
          the answer ninety per cent of the time and scrolling to them would be
          the picker making the common case worse than the row it replaced. */}
      <div className="emo__quick" role="group" aria-label="Quick reactions">
        {QUICK.map(e => cell(e, `q:${e}`))}
      </div>

      <div className="emo__scroll">
        {failed && (
          <p className="emo__none">
            The emoji list did not load. The five above still work, and any emoji
            your keyboard can type still sends.
          </p>
        )}
        {!failed && !data && <p className="emo__none">Loading emoji…</p>}

        {data && hits && (
          hits.length === 0
            ? <p className="emo__none">Nothing matches “{query.trim()}”.</p>
            : <div className="emo__g">{hits.map(e => cell(e.char, `s:${e.cat}:${e.char}`))}</div>
        )}

        {data && !hits && (
          <>
            {recent.length > 0 && (
              <>
                <h4 className="emo__cat">Frequently used</h4>
                <div className="emo__g">{recent.map(e => cell(e, `r:${e}`))}</div>
              </>
            )}
            {data.CATEGORIES.map(c => (
              <React.Fragment key={c.id}>
                <h4 className="emo__cat">{c.label}</h4>
                <div className="emo__g">
                  {c.emoji.map(([char]) => cell(char, `${c.id}:${char}`))}
                </div>
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
