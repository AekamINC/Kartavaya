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
  // Announcement text is held separately from the toast list. A live region has
  // to exist in the DOM BEFORE its content arrives or the insertion is not
  // announced — which is why aria-live must never go on the toast card itself.
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id)?.handle);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const arm = useCallback((id, ms) => {
    if (ms == null) return;
    const handle = setTimeout(() => dismiss(id), ms);
    timers.current.set(id, { handle, endsAt: Date.now() + ms, total: ms });
  }, [dismiss]);

  // Hover pauses the timer on all of them — a toast that expires while the
  // pointer is resting on it is one the user was in the middle of reading.
  const pause = useCallback((id) => {
    const t = timers.current.get(id);
    if (!t) return;
    clearTimeout(t.handle);
    timers.current.set(id, { ...t, remaining: Math.max(0, t.endsAt - Date.now()) });
  }, []);

  const resume = useCallback((id) => {
    const t = timers.current.get(id);
    if (!t || t.remaining == null) return;
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
      {/* One live-region pair for the whole app, mounted unconditionally. */}
      <div className="sr-only" aria-live="polite"    aria-atomic="false">{polite}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="false">{assertive}</div>
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
              className={`tst ${ts.tone}`}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              onFocus={() => pause(t.id)}
              onBlur={() => resume(t.id)}
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
