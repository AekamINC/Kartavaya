import React from 'react';

/**
 * StatusBar — the Odoo-style status pipeline in the task drawer.
 *
 * Converted off Tailwind. It had zero `dark:` variants while tailwind.config.js
 * bakes static hexes (bgMuted #f1f3f7, textMuted #6b7280), so future stages
 * painted near-white on the near-black drawer panel in dark mode. On tokens it
 * flips with the theme.
 *
 * Semantics also corrected: these are buttons that change the task's stage, so
 * a plain role="group" understated them. The list is a tablist-like set of
 * steps — aria-current="step" marks the active one, and stages that cannot be
 * clicked are genuinely disabled rather than merely styled as unclickable.
 */
export function StatusBar({ stages, current, onStageClick, className = '' }) {
  const currentIdx = stages.findIndex(s => s.value === current);

  return (
    <div className={`pipe ${className}`.trim()} role="group" aria-label="Status pipeline">
      {stages.map((stage, i) => {
        const isActive = stage.value === current;
        const isPast = i < currentIdx;
        const state = isActive ? 'on' : isPast ? 'past' : 'future';

        return (
          <button
            key={stage.value}
            type="button"
            onClick={() => onStageClick?.(stage.value)}
            disabled={!onStageClick}
            className={`pipe__seg pipe__seg--${state}${onStageClick ? ' pipe__seg--click' : ''}`}
            aria-current={isActive ? 'step' : undefined}
          >
            {/* The canonical tick: same viewBox, same path and the same optical
                stroke weight as Stepper, Checkbox and Picker, which all draw
                `M20 6L9 17l-5-5` on a 24 grid. This one drew a different mark
                (`M3 8l4 4 6-7` on a 16 grid) at strokeWidth 2.5, which at 12px
                renders a 1.88px stroke against their 1.50px — so the "done" tick
                in the status pipeline was both a different shape and visibly
                heavier than the "done" tick two components away. 03 §120 is the
                principle: stroke weight is tuned so the mark reads the same at
                every size, which only works if it is the same mark. */}
            {isPast && (
              <svg className="pipe__tick" width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
            {stage.label}
          </button>
        );
      })}
    </div>
  );
}

export default StatusBar;
