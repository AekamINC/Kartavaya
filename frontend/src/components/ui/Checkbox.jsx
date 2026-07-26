import React from 'react';

/**
 * Checkbox, with a real indeterminate state — 26-component-inventory.md §5.
 *
 * `aria-checked="mixed"` is the whole reason this is a button rather than an
 * <input type="checkbox">: the DOM checkbox's `indeterminate` is a JS-only
 * property with no attribute, so a "some rows selected" header checkbox
 * announces as plain unchecked to a screen reader unless it is spelled out.
 */
export function Checkbox({ checked = false, mixed = false, onChange, label, disabled, className = '', ...rest }) {
  const state = mixed ? 'mixed' : checked;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      disabled={disabled}
      className={`cbx${mixed ? ' mixed' : checked ? ' on' : ''} ${className}`.trim()}
      onClick={() => onChange?.(mixed ? true : !checked)}
      {...rest}
    >
      {!mixed && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

export default Checkbox;
