import React from 'react';

/**
 * Switch — 26-component-inventory.md §5.
 *
 * A real button that applies immediately, as distinct from a checkbox committed
 * on submit. A <div> with a class is invisible to a screen reader, which is what
 * every hand-rolled toggle in the build currently is.
 *
 * 26 §5 says "aria-pressed on the switch". That is only true of a toggle BUTTON;
 * with `role="switch"` the required state is `aria-checked`, and `aria-pressed`
 * is not a supported attribute of the role at all. This carried both, which is
 * an invalid combination — some screen readers announce the pressed state and
 * some the checked state, so the same control read two ways. `aria-checked`
 * alone, matching the `.sw` switch already shipping in TeamsPage.
 *
 * `.sw` in this stylesheet is the older 38×22 switch with the same geometry and
 * is still in use; `.tgl` is the inventory's name and the one new work uses.
 */
export function Toggle({ checked = false, onChange, label, disabled, className = '', ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`tgl${checked ? ' on' : ''} ${className}`.trim()}
      onClick={() => onChange?.(!checked)}
      {...rest}
    />
  );
}

export default Toggle;
