import React, { useId } from 'react';
import { useSecondary, Secondary } from '../Bilingual';
import DateInput from './DateInput';

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
  // ONE LABEL SHAPE. 123 call sites, 4 of them carrying Devanagari today —
  // `.fld__hi` is not in `[data-language="en"]`'s list either. Converted for the
  // same reason as the eight with more traffic: the point is that the NEXT
  // field label cannot get this wrong, not that four of them were wrong.
  const { secondary, script } = useSecondary(sanskrit);

  return (
    <div className="fld" style={span ? { gridColumn: `span ${span}` } : undefined}>
      {label && (
        <label className="fld__l" htmlFor={id}>
          {label}
          {secondary && <Secondary className="fld__hi" value={secondary} script={script} />}
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

/** A date/time `type` routes to DateInput — the same swap made at the 79
 *  literal call sites, done here so `<Input type="date">` is not the one hole
 *  left where the browser's white, off-to-the-side calendar still appears.
 *
 *  ⚠ `month` WAS MISSING FROM THIS SET and that omission WAS the hole. Suite
 *  20.04 named this exact line: three types forwarded, `month` not, so every
 *  month field emitted the native control the rule bans. It is here now that
 *  `DateInput` has a month mode (`MonthGrid.jsx`) — the set and the component
 *  have to move together, and adding the string alone would have rendered a
 *  day calendar for a value with no day in it. */
const DATEY = new Set(['date', 'datetime-local', 'time', 'month']);
/**
 * ⚠ `label` WAS A DEAD PROP ON THESE THREE, AND IT LOOKED ALIVE.
 *
 * `<Input label="What is this rule called?">` spread `label` straight onto the
 * `<input>`, where it is not a labelling mechanism for anything — not a screen
 * reader, not a visible caption. The attribute sat in the DOM looking like
 * intent that had been honoured.
 *
 * Suite 16.02c measured the result: **10 of 10 controls in the Niyam rule
 * editor had no accessible name at all**, and five of them carried a stranded
 * `label="…"` proving somebody had tried. A person meets four identical boxes
 * and has to guess which is which.
 *
 * So the prop now does what every caller already assumed: a `label` wraps the
 * control in `Field`, which renders a real `<label htmlFor>` and wires the hint
 * and error ids to it. WITHOUT a `label` the output is byte-for-byte what it
 * was — `label` is the only trigger, and no existing call site passes one
 * except the three this was found through.
 *
 * The alternative was to make each page reach for `Field` by hand. This is
 * better: the failure mode was a caller reasonably believing the simple thing
 * worked, and the fix makes the simple thing work rather than adding a rule
 * nobody reads.
 */
const withField = (render) => ({
  className = '', label, sanskrit, hint, error, span, htmlFor, ...p
}) => {
  if (label === undefined) return render(className, p, {});
  return (
    <Field label={label} sanskrit={sanskrit} hint={hint} error={error}
           span={span} htmlFor={htmlFor} required={p.required}>
      {(fieldProps) => render(className, p, fieldProps)}
    </Field>
  );
};

export const Input = withField((className, p, fp) =>
  (DATEY.has(p.type)
    ? <DateInput className={`inp ${className}`.trim()} {...p} {...fp} />
    : <input className={`inp ${className}`.trim()} {...p} {...fp} />));

export const Textarea = withField((className, p, fp) =>
  <textarea className={`inp ${className}`.trim()} {...p} {...fp} />);

export const Select = withField((className, { children, ...p }, fp) =>
  <select className={`inp ${className}`.trim()} {...p} {...fp}>{children}</select>);

export const Row2 = ({ children }) => <div className="row2">{children}</div>;

export default Field;
