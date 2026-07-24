import React from 'react';
import { cn } from '../../lib/utils';

export function FormGroup({ title, sanskrit, columns = 2, children, className }) {
  return (
    <fieldset className={cn('border-none p-0 m-0', className)}>
      {(title || sanskrit) && (
        <legend className="flex items-center gap-2 mb-3 pb-2 border-b border-borderDefault/60 w-full">
          {title && <span className="text-xs font-bold uppercase tracking-widest text-textMuted">{title}</span>}
          {sanskrit && <span className="text-xs text-textSubtle" style={{ fontFamily: 'var(--font-devanagari)' }}>{sanskrit}</span>}
        </legend>
      )}
      <div
        className="grid gap-x-6 gap-y-4"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {children}
      </div>
    </fieldset>
  );
}

export function FormField({ label, sanskrit, required, hint, error, children, span, className }) {
  return (
    <div className={cn('flex flex-col gap-1', className)} style={span ? { gridColumn: `span ${span}` } : undefined}>
      {label && (
        <label className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-textDefault">
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </span>
          {sanskrit && <span className="text-[10px] text-textSubtle" style={{ fontFamily: 'var(--font-devanagari)' }}>{sanskrit}</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="text-[11px] text-textSubtle">{hint}</span>}
      {error && <span className="text-[11px] text-danger font-medium">{error}</span>}
    </div>
  );
}
