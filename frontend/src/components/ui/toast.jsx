import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const ToastCtx = createContext(null);

// Token references, not hexes — these were #05b7aa/#e53e3e/#f59e0b/#0082c6,
// the last being the retired brand blue that 00 §9 removes. A baked hex also
// cannot flip with the theme, so the accent bar was a light-mode colour sitting
// on a dark card.
const TYPE_STYLES = {
  success: { tone: 'tst--ok',   icon: '✓' },
  error:   { tone: 'tst--err',  icon: '✕' },
  warning: { tone: 'tst--warn', icon: '!' },
  info:    { tone: 'tst--info', icon: 'i' },
};

/**
 * 26-component-inventory.md §9: success and info dismiss at 4s, warning at 7s,
 * ERROR NEVER AUTO-DISMISSES.
 *
 * A four-second success message is a courtesy; a four-second failure message is
 * a bug report the user did not get to read. Every toast in this build used the
 * same 3.2s timer, so the only messages a user could not act on were the ones
 * that mattered.
 *
 * A toast that never leaves on its own must be dismissable by hand, which is
 * why every card carries a real Dismiss button rather than relying on the timer.
 */
const DURATION = { success: 4000, info: 4000, warning: 7000, error: null };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  /**
   * Toasts that have been dismissed and are playing their exit.
   *
   * Every overlay in the reconciled table (animations.css) is a PAIR, and the
   * toast shipped with only half of one: `tstIn` slides it 16px in over
   * --dur-base, and dismissing it removed the node in the same frame. So the
   * only toast a user could not read — the one they reached for and clicked —
   * was also the only one that vanished without warning, and an auto-dismiss at
   * four seconds ended as a disappearance rather than a departure.
   *
   * MOTION-SPEC §3 gives the pair: in 16px over --dur-base, out 12px on
   * --dur-fast --ease-exit. §7.3 is the rule behind it — exits are faster than
   * entrances, decisive out and gentle in.
   *
   * Unmounting on `animationend` rather than a JS timer is what keeps the two
   * in step: the duration is `var(--dur-fast)`, so it already rides `--ix` and
   * the user's Animations preference, and a hardcoded `setTimeout(180)` would
   * silently stop matching the moment either changed. `--ix` bottoms out at
   * `.001` rather than 0 precisely so the event still fires under reduced
   * motion — a zero-duration animation never fires it, and the node would leak.
   */
  const [exiting, setExiting] = useState(() => new Set());
  // Announcement text is held separately from the toast list. A live region has
  // to exist in the DOM BEFORE its content arrives or the insertion is not
  // announced — which is why aria-live must never go on the toast card itself.
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timers = useRef(new Map());

  /** Remove the node. Called by `onAnimationEnd`, and by the safety net below. */
  const remove = useCallback((id) => {
    clearTimeout(timers.current.get(id)?.handle);
    timers.current.delete(id);
    setExiting((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const dismiss = useCallback((id) => {
    // The auto-dismiss timer is cleared HERE, not on unmount: the toast lives
    // for one more --dur-fast and must not be re-dismissed in that window.
    clearTimeout(timers.current.get(id)?.handle);
    setExiting((prev) => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      return n;
    });
    // Safety net. If the exit animation never runs — a `display: none` from
    // somewhere, a print stylesheet, an ancestor that suppresses animation —
    // `animationend` never fires and the toast would sit there for good. One
    // second is far outside any duration the ladder can produce, so this only
    // ever fires when the animation genuinely did not happen.
    timers.current.set(id, { handle: setTimeout(() => remove(id), 1000) });
  }, [remove]);

  const arm = useCallback((id, ms) => {
    if (ms == null) return;
    const handle = setTimeout(() => dismiss(id), ms);
    timers.current.set(id, { handle, endsAt: Date.now() + ms, total: ms });
  }, [dismiss]);

  // Hover pauses the timer on all of them — a toast that expires while the
  // pointer is resting on it is one the user was in the middle of reading.
  const pause = useCallback((id) => {
    const t = timers.current.get(id);
    // `total == null` is the exit's safety-net entry, not a dismiss timer.
    // Without this guard, hovering a toast during its 140ms exit cleared the
    // net and stored `remaining: NaN`, and the resume on mouse-out fired
    // immediately — a hover that made it leave FASTER, which is the opposite of
    // what hover-to-pause is for.
    if (!t || t.total == null) return;
    clearTimeout(t.handle);
    timers.current.set(id, { ...t, remaining: Math.max(0, t.endsAt - Date.now()) });
  }, []);

  const resume = useCallback((id) => {
    const t = timers.current.get(id);
    if (!t || t.total == null || t.remaining == null) return;
    const handle = setTimeout(() => dismiss(id), t.remaining);
    timers.current.set(id, { handle, endsAt: Date.now() + t.remaining, total: t.total });
  }, [dismiss]);

  const pushToast = useCallback((t) => {
    const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const toast = {
      id,
      type: t.type || "info",
      title: t.title || "",
      message: t.message || "",
    };
    setToasts((prev) => [toast, ...prev].slice(0, 3));

    // Errors interrupt; everything else waits for a pause. Without this the
    // whole toast system was silent to screen readers — a blind user got no
    // confirmation that anything happened and no error reporting at all.
    const spoken = [toast.title, toast.message].filter(Boolean).join('. ');
    if (spoken) (toast.type === 'error' ? setAssertive : setPolite)(spoken);

    arm(id, DURATION[toast.type] ?? DURATION.info);
    return id;
  }, [arm]);

  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t.handle);
    timers.current.clear();
  }, []);

  const error = useCallback((title) => pushToast({ title, type: 'error' }), [pushToast]);
  const success = useCallback((title) => pushToast({ title, type: 'success' }), [pushToast]);
  const warning = useCallback((title) => pushToast({ title, type: 'warning' }), [pushToast]);
  const info = useCallback((title) => pushToast({ title, type: 'info' }), [pushToast]);

  const value = useMemo(
    () => ({ pushToast, error, success, warning, info, dismiss }),
    [pushToast, error, success, warning, info, dismiss],
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* One live-region pair for the whole app, mounted unconditionally.
          `k-sr-only`, not Tailwind's `sr-only`: this was the last Tailwind
          utility left in ui/, and 02 §5 retires Tailwind once the migration
          finishes. If it went first these two divs would print their
          announcement text visibly at the foot of every page. */}
      <div className="k-sr-only" aria-live="polite"    aria-atomic="false">{polite}</div>
      <div className="k-sr-only" aria-live="assertive" aria-atomic="false">{assertive}</div>
      {/* Position comes from the toastPos preference via [data-toast-pos] on
          <html>, not from a fixed right/top here. Bottom positions also reverse
          the stack direction, so the newest toast is always the one nearest the
          screen edge rather than the one that jumps furthest as the stack
          grows. */}
      <div className="k-toasts" role="region" aria-label="Notifications">
        {toasts.map((t) => {
          const ts = TYPE_STYLES[t.type] || TYPE_STYLES.info;
          return (
            <div
              key={t.id}
              className={`tst ${ts.tone}${exiting.has(t.id) ? ' is-out' : ''}`}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              onFocus={() => pause(t.id)}
              onBlur={() => resume(t.id)}
              // Gated on the keyframe NAME, not merely on "we are exiting": the
              // four `tstOut*` variants are chosen by position and viewport, and
              // an unguarded handler would also catch a stray animationend from
              // anything nested in the card.
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget && String(e.animationName).startsWith('tstOut')) remove(t.id);
              }}
            >
              <span className="tst__i" aria-hidden="true">{ts.icon}</span>
              <div className="tst__b">
                {t.title && <div className="tst__t">{t.title}</div>}
                {t.message && <div className="tst__s">{t.message}</div>}
              </div>
              <button type="button" className="tst__a" onClick={() => dismiss(t.id)}>Dismiss</button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
