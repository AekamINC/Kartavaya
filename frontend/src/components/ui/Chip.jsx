import React from 'react';

/**
 * Chip · ChipRow (02-common-components.md §1, 26-component-inventory.md §8).
 *
 * A chip is READ-ONLY by default. `onClick` (or `onDismiss`) is what makes it
 * interactive, and an interactive chip renders as a real <button> so it gets a
 * cursor, a hover state, a tab stop and Enter/Space for free.
 *
 * Filter chips and status chips are visually the same object in the current
 * build, which is the most common source of dead clicks in it — half of them
 * do nothing when pressed and there is no way to tell which half.
 */
export function Chip({ dot, on, onClick, onDismiss, dismissLabel, className = '', children, ...rest }) {
  const cls = ['chip', on ? 'on' : '', className].filter(Boolean).join(' ');
  const body = (
    <>
      {dot && <span className="chip__dot" style={{ background: dot }} />}
      {children}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={cls} aria-pressed={on ? true : undefined} onClick={onClick} {...rest}>
        {body}
      </button>
    );
  }

  return (
    <span className={cls} {...rest}>
      {body}
      {/* The × is a real button with its own label — an applied filter must be
          removable by keyboard, and "dismiss" alone does not say what of. */}
      {onDismiss && (
        <button type="button" className="chip__x" aria-label={dismissLabel || 'Remove'} onClick={onDismiss}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
          </svg>
        </button>
      )}
    </span>
  );
}

/* `...rest` so a caller can give the row the grouping semantics its contents
   need. A row of chips that are a mutually exclusive CHOICE (signature method,
   a filter set) is a labelled group; a row of read-only status chips is not,
   and neither can be decided here. Additive: passing nothing renders exactly
   the <div class="chips"> this always rendered. */
export const ChipRow = ({ className = '', children, ...rest }) =>
  <div className={`chips ${className}`.trim()} {...rest}>{children}</div>;

export default Chip;
