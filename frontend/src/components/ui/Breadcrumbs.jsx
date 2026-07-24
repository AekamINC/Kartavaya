import React from 'react';
import { cn } from '../../lib/utils';

export function Breadcrumbs({ items, className }) {
  return (
    <nav className={cn('flex items-center gap-1 text-sm', className)} aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 list-none m-0 p-0">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-textSubtle flex-shrink-0">
                  <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {isLast || !item.onClick ? (
                <span className={cn(
                  'font-medium',
                  isLast ? 'text-textDefault' : 'text-textMuted',
                )}>
                  {item.icon && <span className="mr-1 inline-flex align-middle">{item.icon}</span>}
                  {item.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="text-textMuted hover:text-accent transition-colors font-medium bg-transparent border-none cursor-pointer p-0"
                >
                  {item.icon && <span className="mr-1 inline-flex align-middle">{item.icon}</span>}
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
