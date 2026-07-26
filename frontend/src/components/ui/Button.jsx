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
const VARIANTS = ['fill', 'tonal', 'out', 'text', 'ghost', 'danger', 'dangerfill'];
const SIZES = { sm: 'btn--sm', md: '', lg: 'btn--lg' };

export default function Button({
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const v = VARIANTS.includes(variant) ? variant : 'ghost';
  const cls = ['btn', `btn--${v}`, SIZES[size] ?? '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export { Button };
