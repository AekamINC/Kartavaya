/**
 * Topbar.jsx — breadcrumb, palette trigger, actions. 01-navigation.md §1.
 *
 * The search control opens AppShell's palette via onOpenCmdk. It used to
 * render a SECOND CommandPalette of its own, with its own command list — and
 * since both that component and AppShell bind Cmd/Ctrl+K on window, pressing
 * the shortcut opened two stacked palettes with two different command sets.
 * The onOpenCmdk prop was already being passed in and simply ignored.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { resolveRouteMeta } from './navConfig';
import { ICONS } from './navIcons';
import { NotificationsModal } from '../NotificationsModal';

// PAGE_META removed — the breadcrumb now derives from navConfig.js.
// It had 21 entries against far more live routes, so /sanvaad, /graha,
// /ganit, /manav, /vikray, /vetana, /dristi, /prachar, /settings/customize,
// /admin/orgs and /admin/costs all fell through and rendered the app name.
// It also disagreed with the sidebar on two labels (see navConfig.js).

export default function Topbar({ unread = 0, notifOpen = false, onNotifOpenChange, onNewTask, onOpenCmdk }) {
  const location = useLocation();
  const meta = resolveRouteMeta(location.pathname);

  return (
    <header className="top">
      <div className="crumb">
        <span className="crumb__hi" lang="hi">कर्तव्य</span>
        <span className="crumb__sep" aria-hidden="true">/</span>
        <span className="crumb__cur">{meta.en}</span>
      </div>

      {/* A BUTTON that opens the palette, not an input. It was a readOnly
          <input value="">, which puts a focusable, uneditable text field in the
          tab order for no reason: a keyboard user tabs into something that
          looks like a search box and cannot type in it. */}
      <button
        type="button"
        className="top__search"
        onClick={onOpenCmdk}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>{ICONS.search}</span>
        <span className="top__search-ph">Search tasks, projects, people…</span>
        <kbd className="k-kbd">⌘K</kbd>
      </button>

      <div className="top__right">
        {/* The panel is anchored HERE, not rendered as a centred overlay from
            the shell — 21 asks for a popover under the bell. The wrapper is the
            positioning context; without it the panel would hang off the page. */}
        <div className="k-notif-anchor">
          <button
            type="button"
            className="k-iconbtn"
            data-notif-trigger=""
            title="Notifications"
            // The count, not just the word. A dot is invisible to anyone not
            // looking at it, so the badge has to be in the accessible name —
            // 21 · Accessibility.
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={notifOpen}
            aria-haspopup="dialog"
            onClick={() => onNotifOpenChange?.(!notifOpen)}
          >
            {ICONS.bell}
            {unread > 0 && <span className="k-iconbtn__dot" />}
          </button>
          <NotificationsModal open={notifOpen} onOpenChange={onNotifOpenChange} />
        </div>
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={onNewTask}>
          {ICONS.plus}
          New task
        </button>
      </div>
    </header>
  );
}
