import React from 'react';
import { cn } from '../../lib/utils';

const ILLUSTRATIONS = {
  tasks: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" className="text-textSubtle">
      <rect x="20" y="15" width="80" height="12" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="20" y="35" width="80" height="12" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="20" y="55" width="80" height="12" rx="6" fill="currentColor" opacity="0.04" />
      <circle cx="60" cy="50" r="28" stroke="currentColor" strokeWidth="1.5" opacity="0.12" strokeDasharray="4 3" />
      <path d="M50 50l6 6 14-14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
    </svg>
  ),
  projects: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" className="text-textSubtle">
      <rect x="10" y="20" width="30" height="60" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="45" y="20" width="30" height="60" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="80" y="20" width="30" height="60" rx="6" fill="currentColor" opacity="0.06" />
      <rect x="15" y="28" width="20" height="4" rx="2" fill="currentColor" opacity="0.12" />
      <rect x="50" y="28" width="20" height="4" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="85" y="28" width="20" height="4" rx="2" fill="currentColor" opacity="0.12" />
    </svg>
  ),
  search: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" className="text-textSubtle">
      <circle cx="52" cy="44" r="22" stroke="currentColor" strokeWidth="2" opacity="0.12" />
      <path d="M68 60l16 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.15" />
      <path d="M44 38h16M44 50h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.1" />
    </svg>
  ),
  generic: (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" className="text-textSubtle">
      <circle cx="60" cy="45" r="25" stroke="currentColor" strokeWidth="1.5" opacity="0.1" strokeDasharray="4 3" />
      <path d="M52 45l5 5 11-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
      <rect x="35" y="78" width="50" height="4" rx="2" fill="currentColor" opacity="0.06" />
    </svg>
  ),
};

export function EmptyState({ illustration = 'generic', title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-6 text-center', className)}>
      <div className="mb-4">
        {typeof illustration === 'string' ? ILLUSTRATIONS[illustration] || ILLUSTRATIONS.generic : illustration}
      </div>
      {title && <h3 className="text-base font-semibold text-textDefault mb-1">{title}</h3>}
      {description && <p className="text-sm text-textMuted max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
