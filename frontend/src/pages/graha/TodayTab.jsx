// Graha · today — the five things worth looking at this morning.
//
// 9 inline styles are now `gr__*` classes, and the per-section count badge
// takes its colour through `--c`.
//
// The failure path said "Could not load today view." with no way to try again
// and no distinction between a 403 and a dropped connection. It uses the shared
// ErrorState now, which names the cause and carries a retry.
import React, { useState, useEffect } from 'react';
import { api, body } from '../../lib/api';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { ICONS } from '../../components/layout/navIcons';
import TodayItem from './TodayItem';

// Stroke glyphs, not emoji. These five headers were ⏰ 🧊 🌱 📋 🏁 — and
// 05-today-dashboard.md §"And: emoji in the quick actions" names exactly this
// on exactly this screen: "rendering differently on every platform, in a
// product whose iconography is otherwise a consistent 16px stroke set. Use
// `navIcons.jsx`." 07 §175 says the same rule generally. Each glyph inherits
// `currentColor`, so the per-section colour below now tints the icon too,
// which the emoji could never do.
const SECTIONS = [
  { key: 'overdue_followups', title: 'Overdue Follow-ups', color: 'var(--danger)', icon: ICONS.time, emptyMsg: 'No overdue follow-ups' },
  { key: 'stale_deals', title: 'Deals Going Cold', color: 'var(--warn)', icon: ICONS.activity, emptyMsg: 'All deals are active' },
  { key: 'new_leads', title: 'New Leads (24h)', color: 'var(--ok)', icon: ICONS.users, emptyMsg: 'No new leads today' },
  { key: 'todays_activities', title: "Today's Activities", color: 'var(--st-in-review)', icon: ICONS.tasks, emptyMsg: 'No activities today' },
  { key: 'recent_closures', title: 'Recent Won/Lost (7d)', color: 'var(--st-in-progress)', icon: ICONS.approvals, emptyMsg: 'No recent closures' },
];

export default function TodayTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    setErr(null);
    api.get('/v1/graha/today')
      .then(r => setData(body(r)))
      .catch(e => { setErr(e); setData(null); })
      .finally(() => setLoading(false));
  }

  if (loading) return <SkeletonRegion label="Loading today"><SkeletonList rows={6} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;
  if (!data) return <ErrorState kind="server" onRetry={load} />;

  return (
    <div className="gr__today">
      {SECTIONS.map(s => {
        const items = data[s.key] || [];
        return (
          <section key={s.key} className="gr__tcard" aria-label={s.title}>
            <div className="gr__thead">
              <span className="gr__tic" aria-hidden="true" style={{ color: s.color }}>{s.icon}</span>
              <span className="gr__tname">{s.title}</span>
              {items.length > 0 && (
                <span className="gr__count" style={{ '--c': s.color }}>{items.length}</span>
              )}
            </div>
            <div className="gr__tbody">
              {items.length === 0 ? (
                <p className="gr__mute">{s.emptyMsg}</p>
              ) : items.map((item, i) => (
                <TodayItem key={item.id || i} item={item} section={s.key} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
