import React from 'react';
import { cn } from '../../lib/utils';

export function StatusBar({ stages, current, onStageClick, className }) {
  const currentIdx = stages.findIndex(s => s.value === current);

  return (
    <div className={cn('flex items-center gap-0 w-full', className)} role="group" aria-label="Status pipeline">
      {stages.map((stage, i) => {
        const isActive = stage.value === current;
        const isPast = i < currentIdx;
        const isFuture = i > currentIdx;

        return (
          <button
            key={stage.value}
            type="button"
            onClick={() => onStageClick?.(stage.value)}
            className={cn(
              'relative flex items-center justify-center px-4 py-2 text-xs font-semibold transition-all duration-200 outline-none',
              'first:rounded-l-full last:rounded-r-full',
              'min-w-[80px] select-none',
              isActive && 'bg-accent text-white shadow-sm z-10',
              isPast && 'bg-accent/15 text-accent hover:bg-accent/25',
              isFuture && 'bg-bgMuted/60 text-textMuted hover:bg-bgMuted',
              onStageClick && 'cursor-pointer',
              !onStageClick && 'cursor-default',
            )}
            aria-current={isActive ? 'step' : undefined}
          >
            {isPast && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5 flex-shrink-0">
                <path d="M3 8l4 4 6-7" />
              </svg>
            )}
            {stage.label}
            {i < stages.length - 1 && (
              <span className={cn(
                'absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 w-0 h-0',
                'border-t-[14px] border-t-transparent border-b-[14px] border-b-transparent border-l-[8px]',
                isActive && 'border-l-accent',
                isPast && 'border-l-accent/15',
                isFuture && 'border-l-bgMuted/60',
              )} />
            )}
          </button>
        );
      })}
    </div>
  );
}
