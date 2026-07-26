import React from 'react';
import { columnStageColor } from './constants';

/**
 * StatusPipeline — 03-task-drawer.md §1, replacing the static status badge.
 *
 * The chevron between segments is a CSS TRIANGLE BUILT FROM BORDER WIDTHS, not
 * an SVG and not a clip-path. That is not a stylistic choice: the arrow takes
 * the stage's colour through `border-left-color` in three separate states
 * (`.on`, `.past`, resting), so it always matches the segment behind it. An SVG
 * would need the colour passed in twice and would drift the first time a stage
 * colour changed.
 *
 * Each stage sets its own `--c`, so the fill, the tint and the arrow all derive
 * from one value. `columnStageColor` maps the board column's NAME onto a
 * `--st-*` token, because a column carries no status of its own; anything
 * unrecognised falls through to the accent rather than inventing a hue.
 *
 * Semantics: these buttons move the task between stages, so `aria-current="step"`
 * marks the active one and the label is read in full. A `div` with a class here
 * is invisible to a screen reader.
 */
export default function StatusPipeline({ stages = [], current, onStageClick, label = 'Status pipeline' }) {
  if (!stages.length) return null;
  const currentIdx = stages.findIndex(s => s.value === current);

  return (
    <div className="dr__pipe" role="group" aria-label={label}>
      {stages.map((stage, i) => {
        const on = stage.value === current;
        const past = currentIdx > -1 && i < currentIdx;
        const cls = `dr__stage${on ? ' on' : past ? ' past' : ''}`;
        return (
          <button
            key={stage.value}
            type="button"
            className={cls}
            style={{ '--c': stage.color || columnStageColor(stage.label) }}
            aria-current={on ? 'step' : undefined}
            disabled={!onStageClick}
            onClick={() => onStageClick?.(stage.value)}
          >
            {past && (
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8l4 4 6-7" />
              </svg>
            )}
            <span className="dr__stage-t">{stage.label}</span>
          </button>
        );
      })}
    </div>
  );
}
