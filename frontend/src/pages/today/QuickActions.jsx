import React from 'react';
import { ICONS } from '../../components/layout/navIcons';
import { Secondary } from '../../components/Bilingual';

/**
 * Four shortcuts under the stat row — 05-today-dashboard.md §"And: emoji in the
 * quick actions".
 *
 * The icons were `✏️ 🧾 👤 ⏱️`: four emoji rendering differently on every
 * platform, in a product whose iconography is otherwise a consistent 16px
 * stroke set. `navIcons.jsx` is that set (01-navigation.md §3), which is why it
 * was extracted as a module rather than left inline in the sidebar.
 *
 * A previous pass replaced the emoji with `ICONS.*` and never added the import,
 * so every render of this page threw `ReferenceError: ICONS is not defined`
 * before it painted anything. That is the import.
 */
const ACTIONS = [
  { key: 'task',    label: 'New task',       hi: 'नया कार्य',  icon: 'tasks', to: '/tasks' },
  { key: 'invoice', label: 'Create invoice', hi: 'चालान',      icon: 'ganit', to: '/ganit' },
  { key: 'contact', label: 'Add contact',    hi: 'संपर्क',     icon: 'graha', to: '/graha' },
  { key: 'time',    label: 'Log time',       hi: 'समय',        icon: 'time',  to: '/time' },
];

export default function QuickActions({ onNavigate }) {
  return (
    <div className="k-quickacts">
      {ACTIONS.map(a => (
        <button
          key={a.key}
          type="button"
          className="btn btn--out btn--sm k-quickacts__btn"
          onClick={() => onNavigate(a.to)}
        >
          <span className="k-quickacts__ic" aria-hidden="true">{ICONS[a.icon]}</span>
          {a.label}
          <Secondary className="k-quickacts__hi" value={a.hi} />
        </button>
      ))}
    </div>
  );
}
