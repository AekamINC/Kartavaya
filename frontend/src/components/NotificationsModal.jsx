/**
 * NotificationsModal.jsx — the bell panel. `21-notifications-inbox.md` · Bell panel.
 *
 * ── A popover, not a modal
 *
 * This file used to render a 480px card centred behind a scrimmed, blurred
 * backdrop over the whole viewport. 21 is explicit that it should not: "A
 * popover, not a modal. `NotificationsModal.jsx` is centred and scrimmed, which
 * stops the work behind it for a glance at a list. Anchor it under the bell."
 * A scrim is a claim that nothing else matters until you deal with this; a
 * notification list is the opposite of that. It is now 382px, anchored under
 * whichever bell opened it, and the page behind stays legible and scrollable.
 *
 * The FILE NAME is unchanged and the export is still `NotificationsModal`,
 * because `AppShell` and the Topbar import it under that name and renaming a
 * file mid-flight across three call sites buys nothing. The name is now wrong
 * about the shape; the component is right about it.
 *
 * ── One list, not a third copy of it
 *
 * 21's defect 1 is that three components owned this data independently. This
 * file was one of the three: it fetched `/notifications` into local `items` on
 * every open, and posted its own mark-read. So marking something read here and
 * then opening the Inbox showed it unread again, because Inbox held a different
 * array. Everything now goes through `useNotifications()` — the same store
 * `InboxPage` reads — so the bell badge, the popover and the Inbox cannot
 * disagree, and opening the bell inside the 30s window costs no request at all.
 *
 * It also sent `{ mark_all: true, notification_ids: [] }` — both keys on one
 * call, which works only because the endpoint tolerates it. `markAll()` sends
 * one shape and `markRead()` sends the other.
 *
 * ── Rows
 *
 * `NotifRow` from `pages/inbox/`, unchanged: 21 specifies "same NotifRow, same
 * hook, no second fetch" for the Inbox and the bell, and the `.k-notif__*` row
 * CSS was written for both. Only the panel shell was missing, and inbox.css
 * says so in its own header — "The `.k-notif` panel shell itself is not here —
 * it belongs with the component that renders it."
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import NotifRow from '../pages/inbox/NotifRow';
import { EmptyState } from './ui';
import '../styles/inbox.css';

export function NotificationsModal({ open, onOpenChange }) {
  const { items, unread, isLoading, markRead, markAll } = useNotifications({ autoLoad: open });
  const navigate = useNavigate();
  const ref = useRef(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  /**
   * Outside click and Escape.
   *
   * NOT `hooks/useDismiss`, for one reason: its outside test is "not inside the
   * panel", and the bell that opens the panel is outside the panel. Pressing an
   * open bell would fire mousedown (dismiss → closed), then click (toggle →
   * open), and the panel would appear frozen open. The trigger is marked with
   * `data-notif-trigger` and treated as inside.
   *
   * `mousedown`, not `click`, so a control that re-renders on press cannot
   * swallow the dismissal. Escape is captured and stops propagating, so
   * dismissing the panel does not also close a surface behind it.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[data-notif-trigger]')) return;
      close();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const openNotif = useCallback((n) => {
    // Optimistic in the store, so the row, the badge and the Inbox all move on
    // the click rather than on the response.
    markRead(n.notification_id);
    close();
    if (n.url) navigate(n.url);
  }, [markRead, close, navigate]);

  if (!open) return null;

  return (
    <div className="k-notif" ref={ref} role="dialog" aria-label="Notifications">
      <div className="k-notif__hd">
        <span className="k-notif__hd-t">
          Notifications
          <span className="k-notif__hd-hi" lang="hi" aria-hidden="true">सूचनाएं</span>
        </span>
        <button
          type="button"
          className="k-notif__hd-act"
          onClick={markAll}
          disabled={unread === 0}
        >
          Mark all read
        </button>
      </div>

      <div className="k-notif__list">
        {isLoading && <p className="k-notif__load">Loading…</p>}

        {!isLoading && items.length === 0 && (
          <EmptyState
            illustration="success"
            tone="ok"
            title={{ en: "You're all caught up", hi: 'सब पढ़ा' }}
            description="Mentions, assignments, approvals and reminders land here."
          />
        )}

        {!isLoading && items.map(n => (
          <NotifRow key={n.notification_id} notif={n} onOpen={openNotif} />
        ))}
      </div>

      <div className="k-notif__ft">
        <button
          type="button"
          className="k-notif__ft-link"
          onClick={() => { close(); navigate('/inbox'); }}
        >
          Open Inbox →
        </button>
      </div>
    </div>
  );
}

export default NotificationsModal;
