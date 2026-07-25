import React from 'react';
import { moduleColor } from '../../lib/moduleColors';

/**
 * ModuleHeader — the shared module page header (13-module-pages.md §1).
 *
 * English carries the hierarchy at 25px display, Hindi accompanies at 15px —
 * the same weighting rule as the sidebar, and DOM order matches visual weight
 * so the reading order does too.
 *
 * `module` is a moduleColors id; it sets --c, which the icon tint derives from.
 */
export default function ModuleHeader({ module, en, hi, sub, icon, actions }) {
  return (
    <header className="mh" style={{ '--c': moduleColor(module) }}>
      {icon && <div className="mh__ic" aria-hidden="true">{icon}</div>}
      <div>
        <div className="mh__t">
          <h1 className="mh__en">{en}</h1>
          {/* Same label, second script — tagged for the right voice, hidden from
              the accessibility tree so the heading is not announced twice. */}
          {hi && <span className="mh__hi" lang="hi" aria-hidden="true">{hi}</span>}
        </div>
        {sub && <div className="mh__sub">{sub}</div>}
      </div>
      {actions && <div className="mh__act">{actions}</div>}
    </header>
  );
}
