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
      {/* The hint does NOT leave when the error arrives. `hint && !error` was
          the common pattern — error replaces hint — and the rendered component
          inventory (§5, rule 2) argues against it by name: swapping them
          "deletes the format instruction at the exact moment the user has
          proven they need it". A field that says "Not a valid IFSC" and has
          just removed "Four letters, a zero, then six characters" has taken
          away the only thing that would fix it. Both stay; the error stacks
          below, which `.fld`'s column flex already does.

          It also repairs a dangling IDREF: `describedBy` above lists
          `${id}-hint` whenever a hint is passed, error or not — so a field with
          both pointed `aria-describedby` at a node that had just been rendered
          away, and a screen reader announced the error with nothing to read
          after it. */}
      {hint && <span className="fld__hint" id={`${id}-hint`}>{hint}</span>}
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
