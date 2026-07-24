import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';

export function Tabs({ tabs, defaultTab, onChange, className }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.value);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabRefs = useRef({});

  useEffect(() => {
    const el = tabRefs.current[active];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [active]);

  const handleChange = (value) => {
    setActive(value);
    onChange?.(value);
  };

  const activeTab = tabs.find(t => t.value === active);

  return (
    <div className={cn('w-full', className)}>
      <div className="relative border-b border-borderDefault/60">
        <div className="flex gap-0 overflow-x-auto" role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.value}
              ref={el => { tabRefs.current[tab.value] = el; }}
              role="tab"
              aria-selected={tab.value === active}
              onClick={() => handleChange(tab.value)}
              className={cn(
                'relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none',
                tab.value === active
                  ? 'text-accent'
                  : 'text-textMuted hover:text-textDefault',
              )}
            >
              <span className="flex items-center gap-1.5">
                {tab.icon}
                {tab.label}
                {tab.count !== undefined && (
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                    tab.value === active
                      ? 'bg-accent/15 text-accent'
                      : 'bg-bgMuted text-textMuted',
                  )}>
                    {tab.count}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <span
          className="absolute bottom-0 h-[2px] bg-accent rounded-full transition-all duration-200 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      </div>
      <div role="tabpanel" className="pt-4">
        {activeTab?.content}
      </div>
    </div>
  );
}
