/**
 * NotifToast.jsx — the shell's toast layer.
 *
 * ── This file used to be completely deaf to `prefers-reduced-motion`.
 *
 * Measured, both media states, same browser: card transition `0.3s, 0.3s` with
 * a `0.05s` delay, permission prompt `0.35s`, progress bar `6s`, unmount at
 * 360ms — IDENTICAL numbers under an emulated OS reduce. Not "close to": the
 * same values to the digit.
 *
 * The cause is structural rather than an oversight. Every duration here was an
 * inline literal in a `style` object, and **no media query can reach an inline
 * style**. `kartavaya-design.css §5`'s `@media (prefers-reduced-motion: reduce)
 * { --ix: .001 }` collapses every `var(--dur-*)` in the application, and this
 * file referenced none of them, so a user who had asked their operating system
 * for less motion still got a 300ms slide in, a 300ms slide out and a
 * six-second animated bar.
 *
 * The fix is to reference the tokens rather than restate their values. An
 * inline style CAN resolve a custom property — `transition: 'opacity
 * var(--dur-base) var(--ease-enter)'` works exactly like the stylesheet
 * version, and inherits the media query with it. Travel rides `--motion-scale`
 * for the same reason: at Animations = None the slide is 0 and the toast
 * arrives as a pure fade.
 *
 * ── The dwell is NOT motion, and deliberately does not scale
 *
 * `DWELL_MS` is how long the user has to read the toast. Scaling it by `--ix`
 * would empty the progress bar in six milliseconds while the card sat there for
 * six seconds, which is the "never lie about state" rule broken by arithmetic.
 * The bar's animation therefore takes a FIXED duration, and both the CSS
 * animation and the JS timer read the same constant so they cannot drift.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';

/** How long a toast stays before dismissing itself. Not a motion duration —
 *  see the header. One constant, read by both the timer and the progress bar. */
const DWELL_MS = 6000;

/* Single toast card */
function NotifToast({ notif, onDismiss }) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // `dismiss` is called from a timer set on mount, so the timer would otherwise
  // close over the first render's `leaving`. A ref keeps one live definition.
  const dismissRef = useRef(null);

  const dismiss = () => setLeaving(true);
  dismissRef.current = dismiss;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => dismissRef.current?.(), DWELL_MS);
    return () => clearTimeout(t);
  }, []);

  function handleView() {
    dismiss();
    if (notif.url) navigate(notif.url);
  }

  /**
   * Unmount on `transitionend`, not on a 350ms stopwatch.
   *
   * It was `setTimeout(() => onDismiss(id), 350)` beside a 300ms CSS
   * transition — two numbers that had to be kept in step by hand, and which
   * only agreed at `--ix: 1`. Once the durations became tokens the stopwatch
   * could not have tracked them at all: at `--ix: .001` the card finishes
   * leaving in 0.14ms and the timer would still hold the node for 350ms.
   *
   * Guarded twice. `propertyName` because opacity and transform both fire and
   * the node must be dropped once, and `target === currentTarget` because
   * `transitionend` bubbles and this card contains buttons of its own.
   */
  const onTransitionEnd = (e) => {
    if (!leaving) return;
    if (e.target !== e.currentTarget || e.propertyName !== 'opacity') return;
    onDismiss(notif.notification_id);
  };

  return (
    <div
      onTransitionEnd={onTransitionEnd}
      style={{
      display: 'flex', flexDirection: 'column',
      width: 320, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderLeft: '3px solid var(--k-primary)',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      overflow: 'hidden',
      opacity: visible && !leaving ? 1 : 0,
      // 16px in, 12px out — the exit travels less as well as being faster.
      transform: visible && !leaving
        ? 'translateX(0)'
        : `translateX(calc(${leaving ? 12 : 16}px * var(--motion-scale, 1)))`,
      // The reconciled table in animations.css §8: toast is dmPop --dur-base
      // --ease-enter in, dmPopOut --dur-fast --ease-exit out. Expressed as a
      // transition rather than those keyframes because this card animates
      // between two live states rather than mounting and unmounting.
      // The entrance delay scales too. Left as a bare `50ms` it survived the
      // token conversion as the last literal in the file, and under reduce it
      // read as a 50ms wait in front of a 0.22ms transition — longer than the
      // motion it was delaying.
      transition: leaving
        ? 'opacity var(--dur-fast) var(--ease-exit), transform var(--dur-fast) var(--ease-exit)'
        : 'opacity var(--dur-base) var(--ease-enter) calc(50ms * var(--ix)),'
          + ' transform var(--dur-base) var(--ease-enter) calc(50ms * var(--ix))',
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
            /* --on-primary on --primary, not #fff on --k-primary. --k-primary
               is an alias of --primary-vivid, which is a FILL and is the same
               #05b7aa in BOTH themes; white on it measures 2.51:1 either way.
               --primary is the accent fill and --on-primary is the ink derived
               for it per theme (deriveOnAccent), so the pair moves together. */
            style={{ fontSize: 11, color: 'var(--on-primary)', background: 'var(--primary)', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 600 }}
          >
            View →
          </button>
        </div>
      )}

      {/* Progress bar — how much of the dwell is left.

          It animated `width` from 100% to 0% for six continuous seconds.
          `width` is a layout property: every frame of that ran layout on the
          bar and repainted it, for six seconds, per toast. animations.css's
          performance note is explicit that every keyframe in the motion layer
          animates transform and opacity only. `scaleX` with a left origin is
          the composited equivalent and looks identical.

          The duration is `DWELL_MS` and is deliberately NOT scaled by --ix —
          the bar's whole meaning is "this much time remains", so a bar that
          empties faster than the timer would be lying. See the file header. */}
      <div style={{ height: 2, background: 'var(--rule-soft)', flexShrink: 0 }}>
        <div style={{
          height: '100%',
          background: 'var(--k-primary)',
          width: '100%',
          transformOrigin: 'left center',
          animation: `k-toast-progress ${DWELL_MS}ms linear forwards`,
        }} /></div>
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
      // Same treatment as the toast above: tokens rather than a `.35s` literal,
      // so the OS reduced-motion setting reaches it, and travel on
      // --motion-scale so Animations = None degrades it to a fade.
      transform: visible ? 'translateX(0)' : 'translateX(calc(16px * var(--motion-scale, 1)))',
      transition: 'opacity var(--dur-base) var(--ease-enter), transform var(--dur-base) var(--ease-enter)',
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
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>

      <div role="region" aria-label="New notifications">
        <div className="sr-only" aria-live="polite" aria-atomic="false">{politeText}</div>
        <div className="sr-only" aria-live="assertive" aria-atomic="false">{assertiveText}</div>

        {/* `--z-toast` (520), not 9999. The ladder in animations.css §1 exists
            because a corner card on an invented z-index renders on top of the
            command palette and every modal — AppShell's own header records that
            exact failure at 9998 for the permission prompt. 9999 was one rung
            higher than that and above `--z-sheet` (620) as well, so a toast
            could paint over a mobile sheet the user was mid-way through. */}
        <div style={{
          position: 'fixed', bottom: 'max(20px, env(safe-area-inset-bottom))', right: 20,
          zIndex: 'var(--z-toast)',
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
