/**
 * MobileNav.jsx — the five-slot bottom bar at ≤767px. 01-navigation.md §1.
 *
 * Today · Tasks · ＋ · Messages · More.
 *
 * `More` is not decoration: the sidebar carries roughly thirty destinations
 * and this bar carries four, so without a way back into the full list the
 * bottom bar would be a navigation that hides most of the product.
 *
 * One label per slot, English, per 01's `.mnav__i` spec. The sidebar carries
 * the bilingual pair; a 48px slot cannot hold two scripts and stay legible,
 * and the Devanagari would land under the 11px floor 00 §12 sets.
 *
 * min-height 48px on every slot; the FAB is 44px inside a 48px row. Never
 * below 44 — see 15-mobile-web.md.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { mobileNavFor } from './navConfig';
import { useCustomize } from '../CustomizePanel';
import { ICONS } from './navIcons';

export default function MobileNav({ unread = 0, onNewTask, onOpenMore }) {
  const location = useLocation();
  // The three link slots are the reader's own arrangement. The right three
  // differ per person rather than per product — sales reach for CRM and Sales
  // hourly, a site supervisor wants Attendance, an accountant wants Finance —
  // so any fixed set is wrong for most of the firm. `mobileNavFor` falls back
  // to the shipped default when nothing has been chosen, and drops any path it
  // no longer recognises rather than rendering a slot that goes nowhere.
  const { prefs } = useCustomize();
  const items = mobileNavFor(prefs?.mobileNav);

  const isActive = (to) =>
    location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <nav className="mnav" aria-label="Primary">
      {items.map((it) => {
        if (it.kind === 'fab') {
          return (
            <button
              key="fab"
              type="button"
              className="mnav__i"
              onClick={onNewTask}
              aria-label="New task"
            >
              <span className="mnav__fab" aria-hidden="true">{ICONS[it.icon]}</span>
            </button>
          );
        }

        const active = it.kind === 'link' && isActive(it.to);

        /* The inner content is identical either way — only the ELEMENT differs,
           because only one of these two is a destination. */
        const inner = (
          <>
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>{ICONS[it.icon]}</span>
            <span className="mnav__lbl">{it.en}</span>
            {it.badge === 'unread' && unread > 0 && (
              <span className="mnav__dot" aria-label={`${unread} unread`} role="status" />
            )}
          </>
        );

        /* ⚠ "More" IS NOT A DESTINATION. It opens a drawer in this tab and has
           no URL, so it stays a button — wrapping it in an anchor would put an
           href on something that goes nowhere, which is worse for a screen
           reader than the button it already is. Everything with a `to` becomes
           a real link so it can be opened in a new tab; see Sidebar.jsx. */
        if (it.kind === 'more') {
          return (
            <button
              key={it.en}
              type="button"
              className={'mnav__i' + (active ? ' on' : '')}
              onClick={onOpenMore}
              aria-expanded={false}
            >
              {inner}
            </button>
          );
        }

        return (
          <Link
            key={it.en}
            to={it.to}
            className={'mnav__i' + (active ? ' on' : '')}
            aria-current={active ? 'page' : undefined}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
