import React from 'react';

export function Button({ children, variant = 'primary', size = 'default', onClick, disabled, style, className = '' }) {
  const cls = [
    'k-btn',
    variant === 'primary' ? 'k-btn--primary' : '',
    variant === 'ghost' ? 'k-btn--ghost' : '',
    variant === 'reject' ? 'k-btn--reject' : '',
    size === 'sm' ? 'k-btn--sm' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}
