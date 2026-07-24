import React from 'react';
import { cn } from '../../lib/utils';

export function StatButton({ icon, value, label, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 min-w-[80px] px-3 py-3',
        'rounded-xl border border-borderDefault/60 bg-bgDefault/40',
        'hover:bg-bgMuted/50 hover:border-accent/30 transition-all duration-150',
        'outline-none cursor-pointer group',
        className,
      )}
    >
      <span className="text-textMuted group-hover:text-accent transition-colors">
        {icon}
      </span>
      <span className="text-lg font-bold text-textDefault leading-none">{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-textMuted">{label}</span>
    </button>
  );
}

export function ButtonBox({ children, className }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {children}
    </div>
  );
}
