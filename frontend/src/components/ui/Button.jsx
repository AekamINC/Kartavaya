import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Button — seven variants, three sizes (02-common-components.md §1).
 *
 * Replaces ui/button.js, which had only `primary` and `ghost`. With no outline,
 * tonal, text or danger variant, every destructive action in the app was styled
 * ad hoc at the call site — which is why "red button" meant four different reds.
 *
 * `danger` is deliberately an OUTLINE variant. A filled red button reads as the
 * primary action on the screen, which a destructive action never is; the one
 * exception is a confirmed delete inside a dialog the user opened on purpose,
 * and that lives in ConfirmDialog rather than being a variant here.
 */
/**
 * `dangerfill` is the seventh: `.btn--dangerfill` has always existed in
 * components.css but was NOT in this list, so `variant="dangerfill"` fell
 * through to `ghost` — a delete button rendered as a quiet grey one, with no
 * error. ConfirmDialog reached the rule by writing the raw className instead,
 * which is why nobody noticed. Naming it here closes the gap without changing
 * what ConfirmDialog renders.
 */
/**
 * `loading` is the fifth state. The rendered component inventory shows FIVE
 * states for every appearance variant and for `icobtn` — default, :hover,
 * :focus-visible, [disabled], `.is-loading` — and `.is-loading` was the one this
 * component could not produce. The CSS was already there and complete
 * (`.is-loading { pointer-events: none }`, `.is-loading > .spin`, `.spin`,
 * `@keyframes dmSpin`) with zero JSX writing the class, so a shipped state word
 * was unreachable from any component API and every in-flight button in the
 * product had to invent its own treatment.
 *
 * Rendered exactly as the inventory renders it — `<span class="spin">` FIRST,
 * label kept:
 *
 *     <button class="btn btn--fill is-loading"><span class="spin" />Save changes</button>
 *
 * The label stays because the alternative — swapping it for a spinner —
 * collapses the button's width mid-click and moves everything beside it.
 *
 * Deliberately NOT `disabled` and NOT `aria-disabled`: `components.css:458-460`
 * dims both to .42 opacity, and the inventory's loading specimens are at full
 * opacity. `.is-loading` already kills pointer events; the onClick guard below
 * covers the keyboard, which pointer-events cannot.
 */
const VARIANTS = ['fill', 'tonal', 'out', 'text', 'ghost', 'danger', 'dangerfill'];
const SIZES = { sm: 'btn--sm', md: '', lg: 'btn--lg' };

/**
 * `to` is the eighth thing this component does, and the reason is a complaint
 * rather than an inventory.
 *
 * The owner, twice: "user cannot open anything in new tab ... they cannot work
 * two different module at same time". A `<button onClick={() => navigate(to)}>`
 * and a `<Link to>` look identical, behave identically on a plain click, and
 * differ completely on the click that matters — ctrl, cmd, shift, middle, and
 * the browser's own "Open link in new tab". A button has no href, so none of
 * those have anything to act on, and the failure is invisible in every
 * screenshot and in every click-through test.
 *
 * Putting it HERE rather than at each call site is the point: the seven
 * variants, the three sizes and the loading state stay in one place, and a call
 * site opts into being a real link by naming its destination instead of
 * describing a navigation in JS.
 *
 * A `disabled` or `loading` button stays a `<button>`. Neither attribute exists
 * on an anchor — `<a disabled>` is inert markup that navigates anyway — so a
 * link that must not be followed has to be the element that can refuse.
 */
export default function Button({
  variant = 'ghost',
  size = 'md',
  type = 'button',
  loading = false,
  className = '',
  children,
  onClick,
  to,
  ...rest
}) {
  const v = VARIANTS.includes(variant) ? variant : 'ghost';
  const cls = ['btn', `btn--${v}`, SIZES[size] ?? '', loading ? 'is-loading' : '', className]
    .filter(Boolean).join(' ');
  if (to && !loading && !rest.disabled) {
    /* `type` is not forwarded — on an anchor it means something else entirely
       (the MIME type of the destination), so every link would ship
       `type="button"` as a content-type hint. `disabled` is dropped for the
       same reason it gates this branch: it is not an anchor attribute. */
    const linkRest = { ...rest };
    delete linkRest.disabled;
    return (
      <Link to={to} className={cls} onClick={onClick} {...linkRest}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={cls}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {loading && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export { Button };
