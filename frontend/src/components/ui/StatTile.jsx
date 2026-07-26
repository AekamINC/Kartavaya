import React from 'react';

/**
 * StatTile — ← editorial/StatTile.jsx (02-common-components.md §5).
 *
 * The variants are semantic now: `neutral` · `ok` · `warn` · `danger`. They
 * were named after colours — `blue`, `teal`, `amber`, `red` — which is how a
 * tile ends up amber because amber looked right rather than because the number
 * is a warning.
 *
 * The colour names still work and map onto the semantic set, because 61 call
 * sites use them. Four call sites had already reached for `ok`, `warn`, `green`
 * and `orange`, none of which had a CSS rule — those tiles rendered with the
 * default value colour and nobody noticed, which is the argument for having the
 * semantic names exist in the first place.
 *
 * The DEFAULT changed from `blue` to `neutral`. A stat value should read as ink
 * unless the number means something; `blue` painted every tile in the accent,
 * which spends the accent on the one thing that is not a call to action.
 */
const ALIAS = {
  blue: 'neutral', slate: 'neutral', neutral: 'neutral',
  teal: 'ok', green: 'ok', ok: 'ok',
  amber: 'warn', orange: 'warn', warn: 'warn',
  red: 'danger', danger: 'danger',
};

export default function StatTile({ label, sanskrit, value, sub, variant = 'neutral' }) {
  const v = ALIAS[variant] || 'neutral';
  return (
    <div className={`k-stat k-stat--${v}`}>
      <div className="k-stat__lbl">
        <span>{label}</span>
        {sanskrit && <span className="k-stat__hi">{sanskrit}</span>}
      </div>
      <div className="k-stat__val">{value}</div>
      {sub && <div className="k-stat__sub">{sub}</div>}
    </div>
  );
}

export { StatTile };
