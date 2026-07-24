/**
 * InboxPage.jsx — editorial Inbox: mentions, assignments, approvals.
 */
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/editorial';
import { relTime } from '../lib/utils';
import TaskDrawer from '../components/TaskDrawer';
import { EmptyState } from '../components/ui/EmptyState';

const KIND_MAP = {
  mention:  { color: 'var(--k-deep)',   bg: 'color-mix(in srgb, var(--k-mid) 14%, transparent)',   label: 'MENTION',  sans: 'उल्लेख',  initial: 'M' },
  assign:   { color: 'var(--ok)',       bg: 'color-mix(in srgb, var(--ok) 14%, transparent)',        label: 'ASSIGN',   sans: 'नियुक्त', initial: 'A' },
  approval: { color: 'var(--warn)',     bg: 'color-mix(in srgb, var(--warn) 14%, transparent)',      label: 'APPROVAL', sans: 'अनुमोदन', initial: 'AP' },
  comment:  { color: '#8b5cf6',         bg: 'color-mix(in srgb, #8b5cf6 14%, transparent)',          label: 'COMMENT',  sans: 'टिप्पणी', initial: 'C' },
  default:  { color: 'var(--ink-3)',    bg: 'var(--bg-soft)',                                         label: 'NOTIF',    sans: 'सूचना',   initial: 'N' },
};

function getKind(notif) {
  const t = (notif.type || '').toLowerCase();
  if (t.includes('mention'))  return KIND_MAP.mention;
  if (t.includes('assign'))   return KIND_MAP.assign;
  if (t.includes('approval') || t.includes('approved') || t.includes('rejected')) return KIND_MAP.approval;
  if (t.includes('comment'))  return KIND_MAP.comment;
  return KIND_MAP.default;
}

export default function InboxPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [drawerTaskId,  setDrawerTaskId]  = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/notifications')
      .then(r => setNotifications(Array.isArray(r.data) ? r.data : []))
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id) => {
    if (notifications.find(n => n.notification_id === id && n.read_at)) return;
    try {
      await api.post('/notifications/mark-read', { notification_ids: [id] });
      setNotifications(prev =>
        prev.map(n => n.notification_id === id ? { ...n, read_at: new Date().toISOString() } : n)
      );
    } catch (_) { /* optimistic update already applied — ignore network errors */ }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark-read', { mark_all: true });
      setNotifications(prev => prev.map(n => ({ ...n, read_at: new Date().toISOString() })));
    } catch (_) { /* optimistic update already applied — ignore network errors */ }
  };

  const openNotif = async (n) => {
    await markRead(n.notification_id);
    if (n.task_id) setDrawerTaskId(n.task_id);
  };

  const unread = notifications.filter(n => !n.read_at).length;

  return (
    <div className="k-screen">
      <PageHeader
        kicker="TEAM"
        title="Inbox"
        sanskrit="सन्देश"
        lede="Mentions, assignments, and approvals routed to you."
        right={
          unread > 0 && (
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={markAllRead}>
              Mark all read
            </button>
          )
        }
      />

      {loading && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
          Loading inbox…
        </div>
      )}

      {!loading && notifications.length === 0 && (
        <EmptyState
          illustration="success"
          title={{ en: 'All caught up', hi: 'सब पढ़ा' }}
          description="Nothing in your inbox right now — mentions, assignments, and approvals will show up here."
        />
      )}

      {!loading && notifications.length > 0 && (
        <div className="k-inbox">
          {notifications.map((n, idx) => {
            const kind    = getKind(n);
            const isUnread = !n.read_at;
            const when    = relTime(n.created_at);
            return (
              <button
                key={n.notification_id || idx}
                className={'k-inboxrow' + (isUnread ? ' is-unread' : '')}
                onClick={() => openNotif(n)}
                style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'none', textAlign: 'left', fontFamily: 'inherit' }}
              >
                {/* Avatar — colored by kind, initials from kind */}
                <span
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: kind.bg, color: kind.color,
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                    flexShrink: 0, border: `1.5px solid ${kind.color}`,
                  }}
                >
                  {kind.initial}
                </span>

                {/* Body */}
                <div className="k-inboxrow__body" style={{ minWidth: 0 }}>
                  <div className="k-inboxrow__head">
                    <span className={'k-inboxkind k-inboxkind--' + Object.keys(KIND_MAP).find(k => KIND_MAP[k] === kind)}>
                      {kind.label}
                      <span style={{ fontFamily: 'var(--font-hindi)', fontWeight: 400, marginLeft: 4, fontSize: '0.9em' }}>{kind.sans}</span>
                    </span>
                    <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{n.title}</span>
                    {isUnread && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--k-primary)', display: 'inline-block', flexShrink: 0 }} />
                    )}
                    <time style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{when}</time>
                  </div>
                  {n.message && (
                    <div className="k-inboxrow__snip">{n.message}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TaskDrawer
        taskId={drawerTaskId}
        open={!!drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onSaved={() => setDrawerTaskId(null)}
      />
    </div>
  );
}
