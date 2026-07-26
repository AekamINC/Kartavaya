import React from 'react';

/**
 * EsignStatusPill — the six document states and the five signer states.
 *
 * Renders `.k-statuschip`, the shipped chip from `styles/editorial.css`, rather
 * than a private pill class. `ui/StatusChip.jsx` cannot be used directly: its
 * map covers task and approval states only, and e-sign has neither. Extending
 * that map would mean editing `components/ui/**`, which belongs to another
 * owner — so this composes the same CSS and keeps the shape identical.
 *
 * Colours are token references. The page previously carried its own map:
 *
 *   draft #6b7280 · sent #0082c6 · partially_signed #f59e0b
 *   completed #10b981 · cancelled #ef4444 · expired #9ca3af
 *
 * — six literals, one of them the retired brand blue (00 §9), none of which
 * flip with the theme. That map was also the eighth copy of the same idea in
 * the codebase.
 *
 * `expired` is deliberately NEUTRAL, not red. A lapsed document is not a
 * failure and not an error; styling it as one sends people looking for a
 * problem that does not exist. `cancelled` and `declined` are the states where
 * someone actually acted against the document, and those take `--danger`.
 */
const DOC_STATES = {
  draft:            { label: 'Draft',            color: 'var(--st-todo)' },
  sent:             { label: 'Sent',             color: 'var(--st-in-progress)' },
  partially_signed: { label: 'Partially signed', color: 'var(--warn)' },
  completed:        { label: 'Completed',        color: 'var(--ok)' },
  cancelled:        { label: 'Cancelled',        color: 'var(--danger)' },
  expired:          { label: 'Expired',          color: 'var(--on-surface-3)' },
};

const SIGNER_STATES = {
  pending:  { label: 'Not yet sent', color: 'var(--st-todo)' },
  sent:     { label: 'Awaiting',     color: 'var(--st-in-progress)' },
  opened:   { label: 'Opened',       color: 'var(--st-in-review)' },
  signed:   { label: 'Signed',       color: 'var(--ok)' },
  declined: { label: 'Declined',     color: 'var(--danger)' },
};

const FALLBACK = { label: '—', color: 'var(--on-surface-3)' };

const titleise = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export default function EsignStatusPill({ status, kind = 'document' }) {
  const map = kind === 'signer' ? SIGNER_STATES : DOC_STATES;
  const s = map[status] || (status ? { label: titleise(status), color: FALLBACK.color } : FALLBACK);

  return (
    <span className="k-statuschip" style={{ '--c': s.color }}>
      <span className="k-statuschip__dot" />
      {s.label}
    </span>
  );
}

export { DOC_STATES, SIGNER_STATES };
