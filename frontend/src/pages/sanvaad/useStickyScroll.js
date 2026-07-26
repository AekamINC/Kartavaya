/**
 * useStickyScroll.js — near-bottom autoscroll, and the jump-to-latest pill.
 *
 * `06-sanvaad-varta.md` §1: the old page ran
 *
 *     useEffect(() => { bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [messages]);
 *
 * unconditionally, next to a 5s poll that replaced `messages` wholesale. That
 * combination yanked a reader back to the bottom within five seconds of
 * scrolling up, every time.
 *
 * That effect had already been made conditional on the branch before this
 * change — the handover's line-quote is stale — but it measured inside the
 * effect that fires *after* React has committed the new message, so
 * `scrollHeight` already included it. A reader sitting just over 120px from the
 * bottom stayed put; one sitting inside that band was still dragged.
 *
 * The fix is to stop measuring at update time at all. `wasNear` is written by
 * the scroll listener — the only event that can change whether the reader is
 * following the conversation — and read when new content lands. It is therefore
 * always the state as of the last thing the *user* did.
 *
 * Returns `{ logRef, endRef, pinned, jump }`. Render the pill when `!pinned`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Within this many px of the bottom counts as "following the conversation". */
const NEAR = 120;

export function useStickyScroll(dep) {
  const logRef = useRef(null);
  const endRef = useRef(null);
  const wasNear = useRef(true);
  const [pinned, setPinned] = useState(true);

  const measure = useCallback(() => {
    const el = logRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
  }, []);

  // Track the reader's own scrolling. This is the only place `pinned` is set
  // from a user gesture; the layout effect below only reads it.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const near = measure();
      wasNear.current = near;
      setPinned(near);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [measure]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (wasNear.current) {
      el.scrollTop = el.scrollHeight;
      setPinned(true);
    } else {
      // Not near the bottom: show the pill instead of moving them.
      setPinned(false);
    }
    // `dep` is the message identity — see the call sites, which pass a cheap
    // signature rather than the array, so a re-render with the same messages
    // does not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  const jump = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    wasNear.current = true;
    setPinned(true);
  }, []);

  return { logRef, endRef, pinned, jump };
}

export default useStickyScroll;
