import React from 'react';

/**
 * Switch — 26-component-inventory.md §5.
 *
 * `aria-pressed`, not `aria-checked`: this is a button that applies immediately,
 * as distinct from a checkbox committed on submit. A <div> with a class is
 * invisible to a screen reader, which is what every hand-rolled toggle in the
 * build currently is.
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
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      className={`tgl${checked ? ' on' : ''} ${className}`.trim()}
      onClick={() => onChange?.(!checked)}
      {...rest}
    />
  );
}

export default Toggle;
