import React, { useState, useRef, useEffect, useId } from 'react';

/**
 * Tabs — the drawer's notebook-style tab set, with a sliding indicator.
 *
 * Converted off Tailwind: it had zero `dark:` variants, so `border-borderDefault`
 * (#e2e6ed) drew a near-white rule across the near-black drawer panel in dark
 * mode, and inactive labels sat at the static #6b7280.
 *
 * Two accessibility gaps closed while converting:
 *  · The panel had role="tabpanel" but no aria-labelledby, and the tabs had no
 *    ids or aria-controls — so the tablist and the panel were not actually
 *    associated, which is most of what the roles are for.
 *  · Roving tabindex: only the active tab is in the tab order, and ←/→ move
 *    between tabs. A tablist that puts every tab in the tab order makes a
 *    keyboard user walk all of them to reach the panel.
 */
export function Tabs({ tabs, defaultTab, onChange, className = '' }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.value);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabRefs = useRef({});
  const uid = useId();

  useEffect(() => {
    const el = tabRefs.current[active];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, tabs]);

  const handleChange = (value) => {
    setActive(value);
    onChange?.(value);
  };

  const onKeyDown = (e) => {
    const i = tabs.findIndex(t => t.value === active);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    if (e.key === 'ArrowLeft')  next = tabs[(i - 1 + tabs.length) % tabs.length];
    if (e.key === 'Home')       next = tabs[0];
    if (e.key === 'End')        next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    handleChange(next.value);
    tabRefs.current[next.value]?.focus();
  };

  const activeTab = tabs.find(t => t.value === active);
  const tabId   = v => `${uid}-tab-${v}`;
  const panelId = v => `${uid}-panel-${v}`;

  return (
    <div className={className}>
      <div className="tabs__bar">
        <div className="tabs__list" role="tablist" onKeyDown={onKeyDown}>
          {tabs.map(tab => {
            const on = tab.value === active;
            return (
              <button
                key={tab.value}
                ref={el => { tabRefs.current[tab.value] = el; }}
                id={tabId(tab.value)}
                role="tab"
                aria-selected={on}
                aria-controls={panelId(tab.value)}
                tabIndex={on ? 0 : -1}
                onClick={() => handleChange(tab.value)}
                className={`tabs__b${on ? ' on' : ''}`}
              >
                <span className="tabs__label">
                  {tab.icon}
                  {tab.label}
                  {tab.count !== undefined && <span className="tabs__n">{tab.count}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <span className="tabs__ind" style={{ left: indicator.left, width: indicator.width }} />
      </div>
      <div
        role="tabpanel"
        id={panelId(active)}
        aria-labelledby={tabId(active)}
        tabIndex={0}
        className="tabs__panel"
      >
        {activeTab?.content}
      </div>
    </div>
  );
}

export default Tabs;
