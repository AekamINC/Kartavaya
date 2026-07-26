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
 *
 * `info` is the one tone that is DELIBERATELY the accent, and it was missing.
 * `.k-stat--info` has existed in editorial.css since the variants went semantic,
 * but no name in this table reached it — and unknown names fall through to
 * `neutral`, so a caller asking for `info` got grey and no error. That is why
 * `pages/today/StatRow.jsx` rendered `.k-stat` markup by hand: 05 §1 gives
 * "Due today" the `info` tone and this component could not produce it.
 *
 * Note `blue` is NOT remapped onto `info`. It stays `neutral`. The 61 existing
 * colour-named call sites chose `blue` when it was the default and meant nothing
 * by it; pointing them at the accent would repaint most of the product's stat
 * tiles. `info` is opt-in.
 */
const ALIAS = {
  blue: 'neutral', slate: 'neutral', neutral: 'neutral',
  info: 'info',
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
        {/* lang="hi" is what lets the [lang="hi"] rule give this the 1.18x
            leading Devanagari needs. Measured: at 11px the ink is 14.05px tall
            against a 14.3px box at line-height 1.3, so it was clearing by a
            quarter of a pixel. The values here (संस्थाएँ, खाते, लंबित) are
            Hindi, not Sanskrit — the -एँ plural does not exist in Sanskrit. */}
        {sanskrit && <span className="k-stat__hi" lang="hi">{sanskrit}</span>}
      </div>
      <div className="k-stat__val">{value}</div>
      {sub && <div className="k-stat__sub">{sub}</div>}
    </div>
  );
}

export { StatTile };
