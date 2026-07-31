/**
 * useMediaQuery — a media query as React state, kept in sync with the viewport.
 *
 * Added for the tablet band. CSS alone could not do this job: the rail is
 * applied by a CLASS that `Sidebar` computes from a preference, so a media
 * query would have had to restate every `.side--rail` rule inside a breakpoint
 * — around a dozen selectors — and the two copies would drift the first time
 * one was edited. One boolean, one source of truth.
 *
 * Re-evaluates on `change`, so ROTATING a device is handled: a 10-inch tablet
 * turning from 1024x768 to 768x1024 crosses the band boundary, and the layout
 * has to follow it without a reload.
 *
 * SSR/no-matchMedia returns `false` rather than throwing — no window means no
 * viewport to match, and a nav that crashes is worse than a nav that renders
 * its wide form.
 */
import { useEffect, useState } from 'react';

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = e => setMatches(e.matches);
    // Read once on mount as well: the query string can change between renders,
    // and the listener only fires on the NEXT crossing.
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * The tablet band: wide enough for a persistent icon rail, too narrow for the
 * full 252px sidebar.
 *
 * 768 to 1023 inclusive. Below it the bottom bar takes over (a rail plus a
 * bottom bar on a phone is two navigations competing for the same thumb);
 * above it the full sidebar fits with room to spare.
 *
 * Covers 7-to-12-inch tablets in both orientations — a 10-inch landscape lands
 * near 960 and its portrait near 768, and both want the rail rather than a
 * hamburger hiding thirty destinations behind a tap.
 */
export const TABLET_BAND = '(min-width: 768px) and (max-width: 1023px)';
