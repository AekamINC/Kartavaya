import React from 'react';

/**
 * SubtaskProgress — the 3px meter above the subtask list. New; staging had only
 * the "(2/5)" in the section label, which tells you the numbers but not, at a
 * glance, how close the task is.
 *
 * The bar is decorative: the same information is already in the `n/total` text
 * beside it and in the section label, so it carries `aria-hidden` rather than a
 * progressbar role that would be announced twice. `--pdot`-style colour-only
 * meaning is never the sole carrier here (26 §8).
 */
export default function SubtaskProgress({ done = 0, total = 0 }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <>
      <span className="dr__st-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="dr__st-n">{done}/{total}</span>
    </>
  );
}
