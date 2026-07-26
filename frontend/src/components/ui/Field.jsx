import React, { useId } from 'react';

/**
 * Field — label + control + hint/error (02-common-components.md §1).
 *
 * Replaces input.js, select.js and FormGroup.jsx. FormGroup's API was good and
 * is kept: `sanskrit`, `required`, `hint`, `error`, `span`. Two fixes carried in:
 *
 *  · --font-devanagari existed only in FormGroup.jsx; the rest of the system
 *    uses --font-indic for anything that follows the user's language setting.
 *  · The control is wired to its label and to its hint/error through real ids,
 *    so a screen reader reads the error with the field instead of stranding it.
 */
export function Field({ label, sanskrit, required, hint, error, span, htmlFor, children }) {
  const uid = useId();
  const id = htmlFor || uid;
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;

  return (
    <div className="fld" style={span ? { gridColumn: `span ${span}` } : undefined}>
      {label && (
        <label className="fld__l" htmlFor={id}>
          {label}
          {sanskrit && <span className="fld__hi" lang="hi" aria-hidden="true">{sanskrit}</span>}
          {required && <span className="fld__req" aria-hidden="true">*</span>}
        </label>
      )}
      {typeof children === 'function'
        ? children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined, required })
        : children}
      {hint && !error && <span className="fld__hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="fld__err" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

export const Input = ({ className = '', ...p }) =>
  <input className={`inp ${className}`.trim()} {...p} />;

export const Textarea = ({ className = '', ...p }) =>
  <textarea className={`inp ${className}`.trim()} {...p} />;

export const Select = ({ className = '', children, ...p }) =>
  <select className={`inp ${className}`.trim()} {...p}>{children}</select>;

export const Row2 = ({ children }) => <div className="row2">{children}</div>;

export default Field;
