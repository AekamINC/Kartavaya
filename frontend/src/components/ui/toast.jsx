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

/**
 * Exported because a deferred action has to expire at the same moment its toast
 * does. 3.5 defers the DELETE until the toast expires, so undo costs no request
 * — which only holds if the caller's commit timer and the toast's life are the
 * same number. Two copies of `4000` in two files is that invariant written down
 * twice and enforced nowhere.
 */
export const TOAST_LIFE_MS = DURATION;

/** Live toasts on screen at once (26 §9). One playing its exit does not count. */
const MAX_VISIBLE = 3;

/**
 * The keyboard route to a toast action.
 *
 * A toast must not steal focus — it fires in response to something the user did
 * somewhere else on the page, and moving the caret would be a worse bug than the
 * one the action slot fixes. But the stack is rendered after `{children}`, i.e.
 * after every landmark on the page, so Tab reaches it only after traversing the
 * whole document. On a 4s timer that is not a route at all.
 *
 * F6 is the resolution. It is the platform convention for "move to the next
 * pane", it is bound to nothing else in this build, and the listener is only
 * attached while an actionable toast is on screen — so it stays free for
 * anything that wants it later.
 */
const ACTION_KEY = 'F6';

/**
 * `action` is trusted from 117 call sites, so it is validated once here rather
 * than guarded at every use. A malformed action becomes no action — a toast
 * that renders a button which throws on click is worse than one with no button.
 */
function normaliseAction(a) {
  if (!a || typeof a !== 'object') return null;
  if (typeof a.onAction !== 'function') return null;
  const label = String(a.label ?? '').trim();
  if (!label) return null;
  return { label, onAction: a.onAction, dismissOnAction: a.dismissOnAction !== false };
}

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
    /**
     * `in`, NOT `DURATION[type] ?? DURATION.info`.
     *
     * That was the shipped expression and it defeated the whole table. `??`
     * falls through on null as well as undefined, and `DURATION.error` IS null
     * — deliberately, because null is how "never auto-dismiss" is written here.
     * So `null ?? 4000` produced 4000 and every error toast expired after four
     * seconds. `arm()` guards `if (ms == null) return`, and that guard had never
     * once fired.
     *
     * The file header, `26-component-inventory.md §9` and 4.3 all say ERROR
     * NEVER AUTO-DISMISSES, and the exit animation, the hover pause and the
     * Dismiss button were all built on the assumption that it was true. The one
     * message a user needed to read — and now the one that can carry a Retry —
     * was the one that vanished while they read it.
     */
    const kind = t.type || 'info';
    const ms = kind in DURATION ? DURATION[kind] : DURATION.info;
    const toast = {
      id,
      type: t.type || "info",
      title: t.title || "",
      // `body` is accepted as an alias because two call sites were already
      // passing it (BoardsPage, ProjectBoardPage, both for the server's error
      // detail) and this object literal silently dropped it — so the one thing
      // the user needed, the reason the request failed, never reached the card.
      // Both call sites are fixed; the alias stays so the next one does not
      // fail silently the same way.
      message: t.message || t.body || "",
      // The action slot. `undefined` for every call site that does not ask for
      // one, which is all 572 of them today — this is purely additive.
      action: normaliseAction(t.action),
      // Held on the toast rather than read from DURATION at render, so the
      // progress bar and the timer can never disagree about the same toast.
      lifeMs: ms,
    };
    // No `.slice(0, 3)` here — see the overflow effect below. Slicing deleted
    // the oldest card outright, which made the cap the one path where a toast
    // still left without an exit even after the exit existed.
    setToasts((prev) => [toast, ...prev]);

    // Errors interrupt; everything else waits for a pause. Without this the
    // whole toast system was silent to screen readers — a blind user got no
    // confirmation that anything happened and no error reporting at all.
    //
    // An actionable toast also announces HOW to reach the action. Focus is
    // never moved to the card (that would rip the caret out of whatever the
    // user was typing), and the stack renders after every page landmark, so
    // Tab would not arrive before a 4s timer expired. F6 — unbound anywhere
    // else in this build, and the platform convention for "jump to the next
    // pane" — is the whole keyboard path to Undo, so it has to be spoken.
    const spoken = [
      toast.title,
      toast.message,
      toast.action ? `Press F6 for ${toast.action.label}.` : '',
    ].filter(Boolean).join('. ');
    if (spoken) (toast.type === 'error' ? setAssertive : setPolite)(spoken);

    arm(id, ms);
    return id;
  }, [arm]);

  /**
   * The cap from 26 §9 — three toasts, and a fourth commits the oldest away.
   *
   * It used to be `.slice(0, 3)` inside `pushToast`, which spliced the oldest
   * out of the array in the same frame. So the exit covered the two ways a user
   * ends a toast (the Dismiss button, the timer) and missed the third — the one
   * they did not ask for, where a card they may still have been reading is
   * taken off the screen to make room. That is the dismissal that most needs to
   * be visible.
   *
   * Expressed as an effect rather than inside the updater because eviction has
   * to go through `dismiss`, which is a side effect: it marks the card exiting
   * and arms the safety net. A card already playing its exit no longer occupies
   * a slot, so the count is of LIVE toasts, and the loop settles on the next
   * render rather than re-firing.
   */
  useEffect(() => {
    const live = toasts.filter((t) => !exiting.has(t.id));
    if (live.length <= MAX_VISIBLE) return;
    for (const t of live.slice(MAX_VISIBLE)) dismiss(t.id);
  }, [toasts, exiting, dismiss]);

  /**
   * F6 moves focus to the newest actionable toast — see ACTION_KEY above for
   * why a keyboard route has to exist at all.
   *
   * Bound only while one is on screen, so F6 is not swallowed the other 99% of
   * the time. The button is found by DOM query rather than by ref because the
   * stack is ordered newest-first in the array and therefore newest-first in
   * the DOM, whichever corner `[data-toast-pos]` puts it in — the reversal for
   * bottom positions is `flex-direction`, which does not move nodes. So the
   * first match is always the most recent one, which is the one the user just
   * caused and the only one whose 4s window is still meaningfully open.
   *
   * Focusing it fires the card's onFocus, which pauses the timer. That is the
   * point: a toast must not expire out from under a user who has just reached
   * it. The pause holds until focus leaves the card entirely (React's onBlur is
   * focusout, so moving between Undo and Dismiss inside the card resumes and
   * re-pauses in the same tick and the remaining time is preserved).
   */
  const hasAction = toasts.some((t) => t.action && !exiting.has(t.id));
  useEffect(() => {
    if (!hasAction) return undefined;
    const onKey = (e) => {
      if (e.key !== ACTION_KEY || e.altKey || e.ctrlKey || e.metaKey) return;
      const btn = document.querySelector('.k-toasts .tst:not(.is-closing) [data-toast-action]');
      if (!btn) return;
      e.preventDefault();
      btn.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasAction]);

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
      {/* "Alerts", not "Notifications" — NotifToast mounts a second region and
          NotificationsModal a dialog, and all three were called Notifications.
          Three identically-named landmarks give a screen-reader user no way to
          tell the transient toast stack from the notification panel. */}
      <div className="k-toasts" role="region" aria-label="Alerts">
        {toasts.map((t) => {
          const ts = TYPE_STYLES[t.type] || TYPE_STYLES.info;
          return (
            <div
              key={t.id}
              className={`tst ${ts.tone}${exiting.has(t.id) ? ' is-closing' : ''}`}
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
              {/* Before Dismiss, deliberately. One Tab from the card must land
                  on Undo, not on the button that throws the undo away. */}
              {t.action && (
                <button
                  type="button"
                  className="tst__act"
                  data-toast-action=""
                  aria-keyshortcuts={ACTION_KEY}
                  onClick={() => {
                    t.action.onAction();
                    if (t.action.dismissOnAction) dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              {/* Demoted to a muted colour when it sits next to an action, so
                  the destructive-by-omission button is not the same weight as
                  the one that recovers. 3.5 gives the action `--primary`. */}
              <button
                type="button"
                className={`tst__a${t.action ? ' tst__a--quiet' : ''}`}
                onClick={() => dismiss(t.id)}
              >
                Dismiss
              </button>
              {/* 4.3: "a hairline progress bar drains over the life of the
                  toast, so the dismissal is never a surprise". It carries real
                  weight now that a toast can hold the only Undo — the user has
                  to be able to see how long the offer stands. Errors never
                  expire, so they get no bar rather than a full one that never
                  moves. The duration is the toast's OWN lifeMs, passed as a
                  custom property, so the bar cannot drift from the timer and no
                  duration literal enters the stylesheet. */}
              {t.lifeMs != null && (
                <span
                  className="tst__bar"
                  aria-hidden="true"
                  style={{ '--tst-life': `${t.lifeMs}ms` }}
                />
              )}
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
