import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastCtx = createContext(null);

// Token references, not hexes — these were #05b7aa/#e53e3e/#f59e0b/#0082c6,
// the last being the retired brand blue that 00 §9 removes. A baked hex also
// cannot flip with the theme, so the accent bar was a light-mode colour sitting
// on a dark card.
const TYPE_STYLES = {
  success: { color: 'var(--ok)',      icon: '✓' },
  error:   { color: 'var(--danger)',  icon: '✕' },
  warning: { color: 'var(--warn)',    icon: '!' },
  info:    { color: 'var(--primary)', icon: 'i' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Announcement text is held separately from the toast list. A live region has
  // to exist in the DOM BEFORE its content arrives or the insertion is not
  // announced — which is why aria-live must never go on the toast card itself.
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

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

    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3200);
  }, []);

  const error = useCallback((title) => pushToast({ title, type: 'error' }), [pushToast]);
  const success = useCallback((title) => pushToast({ title, type: 'success' }), [pushToast]);
  const warning = useCallback((title) => pushToast({ title, type: 'warning' }), [pushToast]);
  const info = useCallback((title) => pushToast({ title, type: 'info' }), [pushToast]);

  const value = useMemo(() => ({ pushToast, error, success, warning, info }), [pushToast, error, success, warning, info]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* One live-region pair for the whole app, mounted unconditionally. */}
      <div className="sr-only" aria-live="polite"    aria-atomic="false">{polite}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="false">{assertive}</div>
      <div
        role="region"
        aria-label="Notifications"
        style={{
          position: 'fixed', right: 20, top: 20, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          width: 320, maxWidth: 'calc(100vw - 40px)',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const ts = TYPE_STYLES[t.type] || TYPE_STYLES.info;
          return (
            <div key={t.id} style={{
              background: 'var(--surface)',
              border: '1px solid var(--outline-variant)',
              borderLeft: `3px solid ${ts.color}`,
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              boxShadow: 'var(--shadow-2)',
              pointerEvents: 'all',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <span aria-hidden="true" style={{
                fontSize: 12,
                fontWeight: 700,
                color: ts.color,
                marginTop: 1,
                flexShrink: 0,
              }}>
                {ts.icon}
              </span>
              <div style={{ minWidth: 0 }}>
                {t.title && (
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--on-surface)',
                    fontFamily: 'var(--font-ui)',
                    lineHeight: 1.3,
                  }}>
                    {t.title}
                  </div>
                )}
                {t.message && (
                  <div style={{
                    fontSize: 12,
                    color: 'var(--on-surface-3)',
                    marginTop: 2,
                    fontFamily: 'var(--font-ui)',
                  }}>
                    {t.message}
                  </div>
                )}
              </div>
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
