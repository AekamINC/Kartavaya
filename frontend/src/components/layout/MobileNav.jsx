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
import { useLocation, useNavigate } from 'react-router-dom';
import { MOBILE_NAV } from './navConfig';
import { ICONS } from './navIcons';

export default function MobileNav({ unread = 0, onNewTask, onOpenMore }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (to) =>
    location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <nav className="mnav" aria-label="Primary">
      {MOBILE_NAV.map((it) => {
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
        const onClick = it.kind === 'more' ? onOpenMore : () => navigate(it.to);

        return (
          <button
            key={it.en}
            type="button"
            className={'mnav__i' + (active ? ' on' : '')}
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            aria-expanded={it.kind === 'more' ? false : undefined}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>{ICONS[it.icon]}</span>
            <span className="mnav__lbl">{it.en}</span>
            {it.badge === 'unread' && unread > 0 && (
              <span className="mnav__dot" aria-label={`${unread} unread`} role="status" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
