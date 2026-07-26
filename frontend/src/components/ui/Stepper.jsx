import React from 'react';

/**
 * Stepper (02-common-components.md §2) — the invite wizard, onboarding and any
 * multi-step form.
 *
 * A completed step carries a tick as well as a fill, so progress reads without
 * depending on colour alone (26 §8, the same rule that governs `.pdot`).
 * `aria-current="step"` marks the active one; the list is ordered because the
 * order is the meaning.
 */
export function Stepper({ steps = [], current = 0, className = '' }) {
  return (
    <ol className={`step ${className}`.trim()}>
      {steps.map((s, i) => {
        const label = typeof s === 'string' ? s : s.label;
        const done = i < current;
        const on = i === current;
        const cls = ['step__i', on ? 'on' : '', done ? 'is-done' : ''].filter(Boolean).join(' ');
        return (
          <li key={typeof s === 'string' ? s : (s.id ?? label)} className={cls} aria-current={on ? 'step' : undefined}>
            <span className="step__n">
              {done
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                : i + 1}
            </span>
            <span className="step__l">{label}</span>
            {i < steps.length - 1 && <span className="step__bar" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export default Stepper;
