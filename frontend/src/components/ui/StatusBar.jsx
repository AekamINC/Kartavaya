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
            {isPast && (
              <svg className="pipe__tick" width="12" height="12" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M3 8l4 4 6-7" />
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
