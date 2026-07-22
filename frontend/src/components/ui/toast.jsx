import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastCtx = createContext(null);

const TYPE_STYLES = {
  success: { borderLeft: '3px solid #05b7aa', icon: '✓' },
  error:   { borderLeft: '3px solid #e53e3e', icon: '✕' },
  warning: { borderLeft: '3px solid #f59e0b', icon: '!' },
  info:    { borderLeft: '3px solid #0082c6', icon: 'i' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((t) => {
    const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const toast = {
      id,
      type: t.type || "info",
      title: t.title || "",
      message: t.message || "",
    };
    setToasts((prev) => [toast, ...prev].slice(0, 3));
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
      <div style={{
        position: 'fixed', right: 20, top: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8,
        width: 320, maxWidth: 'calc(100vw - 40px)',
        pointerEvents: 'none',
      }}>
        {toasts.map((t) => {
          const ts = TYPE_STYLES[t.type] || TYPE_STYLES.info;
          return (
            <div key={t.id} style={{
              background: 'var(--surface, #FCFAF5)',
              border: '1px solid var(--rule, #E5E0D5)',
              borderLeft: ts.borderLeft,
              borderRadius: 10,
              padding: '10px 14px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
              pointerEvents: 'all',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: ts.borderLeft.split(' ')[2],
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
                    color: 'var(--ink, #1A2230)',
                    fontFamily: 'var(--font-ui, system-ui)',
                    lineHeight: 1.3,
                  }}>
                    {t.title}
                  </div>
                )}
                {t.message && (
                  <div style={{
                    fontSize: 12,
                    color: 'var(--ink-3, #6B7280)',
                    marginTop: 2,
                    fontFamily: 'var(--font-ui, system-ui)',
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
