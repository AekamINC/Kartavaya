/**
 * ActivityFeedPage.jsx — editorial Activity feed screen.
 * All data fetching + filters unchanged.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/editorial';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { AVATAR_COLORS, relTime, userInitials, logger } from '../lib/utils';

const EVENT_TYPES = [
  { value: '',               label: 'All events' },
  { value: 'status_changed', label: 'Status changes' },
  { value: 'commented',      label: 'Comments' },
  { value: 'assigned',       label: 'Assignments' },
  { value: 'approved',       label: 'Approvals' },
  { value: 'field_changed',  label: 'Field changes' },
  { value: 'created',        label: 'Created' },
  { value: 'time_logged',    label: 'Time logged' },
];

const LIMIT = 50;

const VERB_MAP = {
  status_changed: 'moved',
  commented:      'commented on',
  assigned:       'assigned',
  approved:       'approved',
  field_changed:  'updated',
  created:        'created',
  time_logged:    'logged time on',
};
function verbLabel(event_type) {
  return VERB_MAP[event_type] || event_type || 'updated';
}

export default function ActivityFeedPage({ teamId }) {
  // `null` until a load succeeds, never `[]`. "No activity recorded yet" is a
  // claim about the team's week — that nobody moved a task, commented or
  // approved anything. A rejected request used to land on exactly that
  // sentence, because the catch below only wrote to the console and left the
  // list at its initial `[]`. Keeping the failed state unrepresentable as an
  // empty one is cheaper than remembering to check a flag at the call site.
  const [events,      setEvents]      = useState(null);
  const [err,         setErr]         = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [offset,      setOffset]      = useState(0);
  const [filterType,  setFilterType]  = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [members,     setMembers]     = useState([]);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!teamId) return;
    api.get(`/teams/${teamId}`)
       .then(r => setMembers(r.data.members || []))
       .catch(() => {});
  }, [teamId]);

  const load = useCallback(async (reset = true) => {
    if (!teamId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const off = reset ? 0 : offset;
    reset ? setLoading(true) : setLoadingMore(true);
    if (reset) setErr(null);
    try {
      const params = { limit: LIMIT, offset: off };
      if (filterType)  params.event_type = filterType;
      if (filterActor) params.actor_id   = filterActor;
      const r = await api.get('/activity/feed', { params, signal: ctrl.signal });
      const data = Array.isArray(r.data) ? r.data : [];
      setEvents(prev => reset ? data : [...(prev || []), ...data]);
      setHasMore(data.length === LIMIT);
      setOffset(off + data.length);
    } catch (e) {
      // An abort is this component superseding its own request — the filter
      // changed and a newer load is already in flight. It is not a failure and
      // must not paint one over the results that are about to arrive.
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      logger.error(e);
      // A failed "load more" keeps the page it already has; only a failed
      // first page replaces the feed with the reason it is not there.
      if (reset) setErr(e);
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  }, [teamId, filterType, filterActor]);

  useEffect(() => { load(true); }, [load]);

  if (!teamId) return (
    <div className="k-screen">
      <PageHeader kicker="OPERATIONS" title="Activity" sanskrit="गतिविधि" lede="Team events and changes." />
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
        Waiting for team context…
      </div>
    </div>
  );

  return (
    <div className="k-screen">
      <PageHeader
        kicker="OPERATIONS"
        title="Activity"
        sanskrit="गतिविधि"
        lede="Every status change, comment, assignment, and approval."
      />

      {/* Filter bar */}
      <div className="k-filterbar">
        <div className="k-segctrl">
          {EVENT_TYPES.slice(0, 4).map(f => (
            <button
              key={f.value}
              className={'k-segctrl__btn' + (filterType === f.value ? ' is-active' : '')}
              onClick={() => setFilterType(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="k-filterbar__right">
          <label className="k-fld">
            <span className="k-fld__lbl">Event</span>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="k-fld__sel">
              {EVENT_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          {members.length > 0 && (
            <label className="k-fld">
              <span className="k-fld__lbl">Member</span>
              <select value={filterActor} onChange={e => setFilterActor(e.target.value)} className="k-fld__sel">
                <option value="">All members</option>
                {members.map(m => (
                  <option key={m.user_id || m.member_id} value={m.user_id || m.member_id}>
                    {m.display_name || m.full_name || m.email}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Activity feed */}
      {/* Loading, then failure, then empty — in that order. The empty branch is
          only reachable when the request actually returned nothing. */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
          Loading activity…
        </div>
      ) : err ? (
        <ErrorState kind={errorKind(err)} grant="access to this team’s activity" onRetry={() => load(true)} />
      ) : (
        <div className="k-activity k-activity--full">
          {events?.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontStyle: 'italic' }}>
              No activity recorded yet.
            </div>
          )}
          {(events || []).map((a, i) => {
            const actorName = a.actor_name || a.actor || 'Someone';
            const initials  = userInitials(actorName);
            const color     = AVATAR_COLORS[i % AVATAR_COLORS.length];
            return (
              <div key={a.event_id || i} className="k-activity__row">
                <span
                  className="k-avatar"
                  style={{ width: 28, height: 28, fontSize: 11, background: color, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600 }}
                >
                  {initials}
                </span>
                <div className="k-activity__body">
                  <div className="k-activity__line">
                    <b>{actorName.split(' ')[0]}</b>{' '}
                    <span className="k-mute">{verbLabel(a.type || a.verb)}</span>{' '}
                    {(a.subject_title || a.task_title) && (
                      <span className="k-activity__what">{a.subject_title || a.task_title}</span>
                    )}
                    {a.detail && <span className="k-mute"> {a.detail}</span>}
                  </div>
                  <div className="k-activity__when">{relTime(a.created_at || a.at)}</div>
                </div>
              </div>
            );
          })}

          {hasMore && (
            <div style={{ textAlign: 'center', paddingTop: 20 }}>
              <button
                className="k-btn k-btn--ghost"
                onClick={() => load(false)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
