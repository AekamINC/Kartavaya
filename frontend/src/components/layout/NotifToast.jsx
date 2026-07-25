import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';

/* Single toast card */
function NotifToast({ notif, onDismiss }) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => dismiss(), 6000);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setLeaving(true);
    setTimeout(() => onDismiss(notif.notification_id), 350);
  }

  function handleView() {
    dismiss();
    if (notif.url) navigate(notif.url);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: 320, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderLeft: '3px solid var(--k-primary)',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      overflow: 'hidden',
      opacity: visible && !leaving ? 1 : 0,
      transform: visible && !leaving ? 'translateX(0)' : 'translateX(24px)',
      transition: leaving
        ? 'opacity .3s ease, transform .3s ease'
        : 'opacity .3s ease .05s, transform .3s ease .05s',
      pointerEvents: 'all',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 12px 8px' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'color-mix(in srgb, var(--k-primary) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
          <Bell size={14} style={{ color: 'var(--k-primary)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--k-primary)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span>Kartavaya</span>
            <span style={{ fontFamily: 'var(--font-hindi)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>· सूचना</span>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 3 }}>
            {notif.title}
          </div>
          {notif.message && (
            <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
              {notif.message}
            </div>
          )}
        </div>
        <button
          onClick={dismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: -2 }}
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>

      {/* Actions */}
      {notif.url && (
        <div style={{ padding: '0 12px 10px', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button
            onClick={dismiss}
            style={{ fontSize: 11, color: 'var(--ink-3)', background: 'none', border: '1px solid var(--rule)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
          >
            Dismiss
          </button>
          <button
            onClick={handleView}
            style={{ fontSize: 11, color: '#fff', background: 'var(--k-primary)', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 600 }}
          >
            View →
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div style={{ height: 2, background: 'var(--rule-soft)', flexShrink: 0 }}>
        <div style={{
          height: '100%',
          background: 'var(--k-primary)',
          width: '100%',
          animation: 'k-toast-progress 6s linear forwards',
        }} />
      </div>
    </div>
  );
}

/* Permission prompt card */
export function NotifPermissionPrompt({ onAllow, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  return (
    <div style={{
      width: 320, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--surface)',
      border: '1px solid color-mix(in srgb, var(--k-primary) 30%, var(--rule))',
      borderLeft: '3px solid var(--k-primary)',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      padding: '14px 14px 12px',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(24px)',
      transition: 'opacity .35s ease, transform .35s ease',
      pointerEvents: 'all',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'color-mix(in srgb, var(--k-primary) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bell size={14} style={{ color: 'var(--k-primary)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>Stay in the loop</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1, fontFamily: 'var(--font-hindi)' }}>अपडेट पाते रहें</div>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2, borderRadius: 4, display: 'flex' }} aria-label="Dismiss">
          <X size={13} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 12 }}>
        Get notified about approvals, task updates, and team activity — even when Kartavaya is in the background.
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={onDismiss} className="k-btn k-btn--ghost k-btn--sm" style={{ flex: 1 }}>Not now</button>
        <button onClick={onAllow} className="k-btn k-btn--primary k-btn--sm" style={{ flex: 2 }}>Enable notifications</button>
      </div>
    </div>
  );
}

/* Container rendered in AppShell — manages a list of toasts */
export function NotifToastContainer({ toasts, onDismiss }) {
  // The two live regions are mounted unconditionally, even with no toasts.
  // A live region has to exist in the DOM *before* its content arrives or the
  // insertion is not announced — putting aria-live on the toast card itself is
  // the single most common way this gets implemented wrong, and it silently
  // announces nothing.
  //
  // Assertive is reserved for errors: it interrupts whatever the screen reader
  // is currently saying. Notifications are polite. Nothing in the current
  // notification payload carries a severity, so everything routes to polite
  // until one exists — inventing a mapping here would be guesswork.
  const politeText = toasts
    .filter(n => n.severity !== 'error')
    .map(n => [n.title, n.message].filter(Boolean).join('. '))
    .join(' ');

  const assertiveText = toasts
    .filter(n => n.severity === 'error')
    .map(n => [n.title, n.message].filter(Boolean).join('. '))
    .join(' ');

  return (
    <>
      <style>{`
        @keyframes k-toast-progress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>

      <div role="region" aria-label="Notifications">
        <div className="sr-only" aria-live="polite" aria-atomic="false">{politeText}</div>
        <div className="sr-only" aria-live="assertive" aria-atomic="false">{assertiveText}</div>

        <div style={{
          position: 'fixed', bottom: 'max(20px, env(safe-area-inset-bottom))', right: 20, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 10,
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}>
          {/* Deliberately NOT aria-hidden. The live region announces arrival;
              the card stays in the accessibility tree so its Dismiss and View
              buttons remain reachable. Hiding it would leave focusable controls
              inside an aria-hidden subtree, which is a worse defect than
              hearing the text twice. */}
          {toasts.map(n => (
            <NotifToast key={n.notification_id} notif={n} onDismiss={onDismiss} />
          ))}
        </div>
      </div>
    </>
  );
}
