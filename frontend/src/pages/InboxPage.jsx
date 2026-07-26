/**
 * InboxPage — mentions, assignments, approvals, routed to you.
 *
 * `21-notifications-inbox.md`, defects 1 and 5.
 *
 * Defect 5 · Inbox was on the legacy palette. Its kind map painted `--ink-3` on
 * `--bg-soft` and hardcoded `#8b5cf6`; none of the three is in `00-tokens.md`.
 * Every colour on this page is now a `00` token, so it flips with the theme and
 * inherits the contrast fixes made there.
 *
 * Defect 1 · Inbox held its own copy of the notification list. It fetched
 * `/notifications` on mount into local state while `NotificationsModal` fetched
 * the same endpoint into a second array and `AppShell` polled for a third count.
 * Mark something read in the bell, open Inbox, and it was unread again. The
 * fetch and the mutations are gone from this file — `useNotifications()` is the
 * only thing that talks to the endpoint now, and the bell reads the same array
 * as soon as `layout/` is converted.
 *
 * Reading a notification does NOT delete it. `19-client-portal.md` makes the
 * same point about the approval record: "did I get told about that?" is a
 * question people ask weeks later.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import { EmptyState, ErrorState, errorKind, Tabs } from '../components/ui';
import TaskDrawer from '../components/TaskDrawer';
import NotificationBanner from '../components/NotificationBanner';
import NotifRow from './inbox/NotifRow';
import InboxSkeleton from './inbox/InboxSkeleton';
import { INBOX_TABS, countForTab, filterByTab, groupNotifications } from './inbox/notifKinds';
import { useNotifications } from '../context/NotificationContext';
import '../styles/inbox.css';

/** Copy for a tab that filtered to nothing — not the same state as an empty inbox. */
const FILTER_EMPTY = {
  unread:    { title: { en: 'Nothing unread', hi: 'सब पढ़ा' },      body: 'Every notification here has been read.' },
  approvals: { title: { en: 'No approvals', hi: 'कोई स्वीकृति नहीं' }, body: 'Nothing is waiting on your decision right now.' },
  mentions:  { title: { en: 'No mentions', hi: 'कोई उल्लेख नहीं' },  body: 'Nobody has tagged you in a comment yet.' },
  assigned:  { title: { en: 'Nothing assigned', hi: 'कुछ नहीं सौंपा' }, body: 'No task has been handed to you here.' },
};

export default function InboxPage() {
  const { items, unread, isLoading, error, refresh, markRead, markAll } = useNotifications();
  const [tab, setTab] = useState('all');
  const [drawerTaskId, setDrawerTaskId] = useState(null);
  const navigate = useNavigate();

  const filtered = useMemo(() => filterByTab(items, tab), [items, tab]);
  const groups = useMemo(() => groupNotifications(filtered), [filtered]);

  const openNotif = useCallback((n) => {
    // Optimistic in the store, so the badge and the row both move on the click.
    markRead(n.notification_id);
    if (n.task_id) setDrawerTaskId(n.task_id);
    else if (n.url) navigate(n.url);
  }, [markRead, navigate]);

  const list = (() => {
    if (isLoading) {
      return (
        <>
          <p className="k-sr-only" role="status">Loading your notifications…</p>
          <InboxSkeleton rows={6} />
        </>
      );
    }

    // An empty list because the fetch FAILED is not an empty inbox. The error
    // sits above the tabs; rendering "You're all caught up" underneath it would
    // have the page assert, in its most reassuring voice, something it has no
    // idea about — and a user with an approval waiting would walk away.
    if (error && !items.length) return null;

    // A list with nothing in it and a filter that reached zero are different
    // states. One is a finished queue and should read as an accomplishment; the
    // other is an absence. 26 §9.
    if (!items.length) {
      return (
        <EmptyState
          illustration="success"
          tone="ok"
          title={{ en: "You're all caught up", hi: 'सब पढ़ा' }}
          description="Mentions, assignments, approvals and reminders land here. Nothing is waiting on you."
        />
      );
    }
    if (!filtered.length) {
      const copy = FILTER_EMPTY[tab] || FILTER_EMPTY.unread;
      return (
        <EmptyState
          illustration="search"
          title={copy.title}
          description={copy.body}
          action="Show all"
          onAction={() => setTab('all')}
        />
      );
    }

    return (
      <div className="k-inboxpg__groups">
        {groups.map((g) => (
          <section className="k-inboxpg__group" key={g.key} aria-labelledby={`k-inboxpg-${g.key}`}>
            <h2 className="k-inboxpg__grouph" id={`k-inboxpg-${g.key}`}>
              {g.label}
              <span className="k-inboxpg__grouphi" lang="hi">{g.hi}</span>
              <span className="k-inboxpg__groupn">{g.items.length}</span>
            </h2>
            <div className="k-inboxpg__list">
              {g.items.map((n) => (
                <NotifRow key={n.notification_id} notif={n} onOpen={openNotif} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  })();

  const tabs = INBOX_TABS.map((t) => ({
    value: t.value,
    // `INBOX_TABS` has carried a Devanagari label for each tab since it was
    // written and nothing rendered it — five translated strings that shipped as
    // dead data while every other heading on the page is bilingual. `.tabs__label`
    // is already a flex row, so the sub-label sits between the word and the count
    // exactly as it does in the group headers.
    label: (
      <>
        {t.label}
        <span className="k-inboxpg__tabhi" lang="hi">{t.hi}</span>
      </>
    ),
    count: countForTab(items, t.value),
    // Only the active tab's content is built. `Tabs` reads `content` off the
    // active entry alone, so the other four stay null rather than rendering
    // four more copies of the list on every keystroke.
    content: t.value === tab ? list : null,
  }));

  return (
    <div className="k-screen">
      <PageHeader
        kicker="TEAM"
        title="Inbox"
        sanskrit="सन्देश"
        lede="Mentions, assignments, approvals and reminders routed to you. Reading one keeps it — nothing here is deleted."
        right={
          unread > 0 && (
            <button type="button" className="btn btn--out btn--sm" onClick={() => markAll()}>
              Mark all read
              <span className="k-inboxpg__unread">{unread}</span>
            </button>
          )
        }
      />

      <NotificationBanner />

      {/* A failed refresh does not blank the list — the store keeps what it had,
          so the error sits above whatever is still readable. */}
      {error && !items.length && (
        <ErrorState kind={errorKind(error)} onRetry={() => refresh({ force: true })} />
      )}

      <Tabs tabs={tabs} defaultTab="all" onChange={setTab} className="k-inboxpg" />

      <TaskDrawer
        taskId={drawerTaskId}
        open={!!drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onSaved={() => setDrawerTaskId(null)}
      />
    </div>
  );
}
