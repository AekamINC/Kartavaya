import React from 'react';

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

export default function Button({
  variant = 'ghost',
  size = 'md',
  type = 'button',
  loading = false,
  className = '',
  children,
  onClick,
  ...rest
}) {
  const v = VARIANTS.includes(variant) ? variant : 'ghost';
  const cls = ['btn', `btn--${v}`, SIZES[size] ?? '', loading ? 'is-loading' : '', className]
    .filter(Boolean).join(' ');
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
