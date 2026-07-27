/**
 * MobileDrawer.jsx — the overlay sidebar at ≤1023px. 01-navigation.md §3.
 *
 * This is the replacement the `.kv__side { display: none }` media query is
 * required to ship with. The rule has broken three times in this project
 * (`.side`, `.adm__side`, the onboarding mobile surface); each time it left a
 * screen with no way out.
 *
 * It renders a SECOND Sidebar rather than moving the first, which is why the
 * media query hides the slot (`.kv__side`) and never `.side` itself — hiding
 * `.side` is exactly what makes a burger open an empty scrim.
 */
import React from 'react';
import Sidebar from './Sidebar';
import FocusTrap from '../ui/FocusTrap';

export default function MobileDrawer({ open, onClose, inboxCount = 0, approvalsCount = 0 }) {
  /**
   * The exit now actually plays.
   *
   * This was `if (!open) return null`, which drops the node on the same tick as
   * the state change. Measured: `document.getAnimations()` sampled during a
   * close returned `[]`, and `document.querySelector('.kv__scrim')` was already
   * null on the next tick — so the `dmFadeOut` / `kv-drawer-out` pair could
   * never have run however it was declared. The drawer appeared with a slide
   * and disappeared with a cut.
   *
   * `mounted` outlives `open` by exactly one animation. `.is-closing` is what
   * the two exit rules in editorial.css select on — the same class every other
   * leaving surface in the build uses (`.pop`, `.pk__pop`, `.sheet`, `.dr`,
   * `.modal__*`, `.menu--float`, `.tst`, `.aso`, `.dr__lb`, `.sv__thread`,
   * `.k-onboard`). It was `data-closing="1"` here, which behaves identically
   * and reads as a different mechanism; overlay-motion.test.jsx keys on the
   * class, so a twelfth spelling of one state is also a surface the exit tests
   * cannot see. And `animationend` on the
   * DRAWER is what unmounts — the drawer's exit is `--dur-base` and the scrim's
   * is `--dur-fast`, so the drawer is the last to finish and waiting on the
   * scrim would cut the panel off mid-slide.
   *
   * `e.target === e.currentTarget` guards the listener: `animationend` bubbles,
   * and the panel contains a whole sidebar whose section accordions animate
   * `grid-template-rows`. Without the guard, one section settling anywhere
   * inside would unmount the drawer mid-exit.
   *
   * A timeout backstop is deliberately NOT used. `--ix` bottoms out at `.001`
   * rather than `0` precisely so a zero-duration animation still fires
   * `animationend` (kartavaya-design.css §5 says so in as many words), so the
   * event is guaranteed under reduced motion too — at 0.36ms rather than 360ms.
   */
  const [mounted, setMounted] = React.useState(open);
  const closing = mounted && !open;

  React.useEffect(() => { if (open) setMounted(true); }, [open]);

  // Escape closes, matching every other overlay in the product.
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`kv__scrim ${closing ? 'is-closing' : ''}`.trim()}
      onClick={closing ? undefined : onClose}
    >
      {/* Wrap the panel, not the scrim — FocusTrap's own contract.

          `active={!closing}` is what keeps deferred unmount from costing the
          keyboard user anything. FocusTrap restores focus in its effect
          CLEANUP, so leaving it active would hold focus inside a panel that is
          visibly leaving for the whole 220ms of the exit. Flipping `active`
          the moment the close starts runs that cleanup immediately: focus is
          back on the burger on the same tick the user pressed Escape, while
          the animation plays out behind it.

          `aria-hidden` on the closing panel is only safe BECAUSE of that —
          hiding a subtree that still contains focus is the classic version of
          this bug. Focus has already left by the time this attribute appears,
          so what remains is a decorative node finishing its exit, which is
          exactly what a screen reader should not be walking. */}
      <FocusTrap active={!closing}>
        <div
          className={`kv__drawer ${closing ? 'is-closing' : ''}`.trim()}
          role="dialog"
          aria-modal={closing ? undefined : 'true'}
          aria-hidden={closing ? 'true' : undefined}
          aria-label="Navigation"
          onClick={e => e.stopPropagation()}
          onAnimationEnd={(e) => {
            if (closing && e.target === e.currentTarget) setMounted(false);
          }}
        >
          {/* forceWide: a rail inside a narrow overlay is a column of
              unlabelled icons with no reason to be narrow. */}
          <Sidebar
            inboxCount={inboxCount}
            approvalsCount={approvalsCount}
            forceWide
            onNavigate={onClose}
          />
        </div>
      </FocusTrap>
    </div>
  );
}
