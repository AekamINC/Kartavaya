import { useRef } from 'react';

/**
 * useTabPanelMotion — the direction half of the tab-panel entrance.
 *
 * Reference `motion.css` `.dm-tabs__p` animates `translateX(var(--dx))`, and the
 * SIGN is the whole point: a tab to the right of the one you left brings its
 * panel in from the right. A panel that always slides the same way reads as a
 * page transition and stops telling you where you are in the strip.
 *
 * Returns the two things the caller needs and nothing else:
 *
 *   · `key`   — put it on the panel element. Changing it remounts the node, so
 *               the CSS animation restarts. Toggling a class would NOT restart
 *               it: a finished animation only replays when `animation-name`
 *               changes or the element is new, which is why every "add the
 *               class then remove it" version of this is a one-shot that fires
 *               once and never again.
 *   · `style` — `{ '--ix-dx': 1 | -1 }`, consumed by `.ix-panel` in
 *               animations.css §9c.
 *
 * The travel itself is NOT here. It is `8px * var(--motion-scale)` in CSS, so
 * Animations = None and `prefers-reduced-motion` both flatten it to a pure
 * cross-fade without this hook knowing anything about either.
 *
 * `ids` may be any array of tab ids; an id that is not in the list is treated as
 * index 0 rather than throwing, because a tab set can shrink under a permission
 * change while a removed tab is still selected.
 */
export default function useTabPanelMotion(ids, value) {
  const prev = useRef(value);
  const at = (v) => {
    const i = ids.indexOf(v);
    return i === -1 ? 0 : i;
  };
  // Compare against the previous RENDER's value, then record this one. The ref
  // write is intentionally in render rather than an effect: the direction has to
  // be known for the same paint that mounts the new panel, and an effect runs
  // one frame too late — the panel would enter from the wrong side exactly once
  // per switch, which is the version of this bug that looks random.
  const dx = at(value) >= at(prev.current) ? 1 : -1;
  prev.current = value;

  return { key: value, style: { '--ix-dx': dx } };
}
