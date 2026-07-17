import React, { useState, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';

export function Tooltip({ content, position = 'top', delay = 300, children, className }) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);
  const triggerRef = useRef(null);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  if (!content) return children;

  return (
    <span
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-50 whitespace-nowrap px-2.5 py-1.5 rounded-lg',
            'text-[11px] font-medium text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900',
            'shadow-lg pointer-events-none',
            'animate-in fade-in-0 zoom-in-95 duration-150',
            positions[position],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
