/**
 * Topbar.jsx — editorial header: breadcrumb, pill search, actions.
 *
 * The search button opens AppShell's palette via onOpenCmdk. It used to render
 * a SECOND CommandPalette of its own, with its own command list — and since
 * both that component and AppShell bind Cmd/Ctrl+K on window, pressing the
 * shortcut opened two stacked palettes with two different command sets. The
 * onOpenCmdk prop was already being passed in and simply ignored.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveRouteMeta } from './navConfig';

// PAGE_META removed — the breadcrumb now derives from navConfig.js.
// It had 21 entries against far more live routes, so /sanvaad, /graha,
// /ganit, /manav, /vikray, /vetana, /dristi, /prachar, /settings/customize,
// /admin/orgs and /admin/costs all fell through and rendered the app name.
// It also disagreed with the sidebar on two labels (see navConfig.js).

export default function Topbar({ unread = 0, onOpenNotifications, onNewTask, onOpenCmdk }) {
  const location = useLocation();
  const navigate = useNavigate();

  const meta = resolveRouteMeta(location.pathname);

  return (
    <header className="k-topbar">
      {/* Left: breadcrumb */}
      <div className="k-topbar__left">
        <div className="k-crumb">
          <span className="k-crumb__hi">कर्तव्य</span>
          <span className="k-crumb__sep">/</span>
          <span className="k-crumb__cur">{meta.en}</span>
        </div>
      </div>

      {/* Center: pill search — a BUTTON that opens the palette, not an input.
          It was a readOnly <input value="">, which puts a focusable, uneditable
          text field in the tab order for no reason: a keyboard user tabs into
          something that looks like a search box and cannot type in it. */}
      <button
        type="button"
        className="k-topbar__search"
        onClick={onOpenCmdk}
        aria-keyshortcuts="Meta+K Control+K"
        style={{ cursor: 'pointer' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <span className="k-topbar__search-ph">Search tasks, projects, people…</span>
        <kbd className="k-kbd">⌘K</kbd>
      </button>

      {/* Right: icon buttons + new task */}
      <div className="k-topbar__right">
        <button className="k-iconbtn" title="Notifications" aria-label="Notifications" onClick={onOpenNotifications}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/>
            <path d="M6.5 13.5a1.5 1.5 0 003 0"/>
          </svg>
          {unread > 0 && <span className="k-iconbtn__dot" />}
        </button>
        <button className="k-btn k-btn--primary k-btn--sm" onClick={onNewTask}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10"/>
          </svg>
          New task
        </button>
      </div>
    </header>
  );
}
