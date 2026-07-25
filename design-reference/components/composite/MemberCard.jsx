import React from 'react';

export function MemberCard({ name, role, tz, avatar, openTasks, doneThisWeek, avgCycle, recentTasks = [] }) {
  const COLORS = ['#0082c6','#03a1b6','#05b7aa','#d97706'];
  const PRI = { urgent: '#C0392B', high: '#B06A00', medium: '#0082c6', low: '#6E7B91' };
  const initials = (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const ROLE_CLS = { admin: 'k-rolebadge--admin', member: 'k-rolebadge--member', client: 'k-rolebadge--client' };
  return (
    <div className="k-mcard">
      <div className="k-mcard__head">
        <span className="k-avatar" style={{ width: 38, height: 38, fontSize: 14, background: avatar?.color || COLORS[0] }}>{initials}</span>
        <div>
          <div className="k-mcard__name">{name}</div>
          <div className="k-mcard__role">
            <span className={'k-rolebadge ' + (ROLE_CLS[role] || ROLE_CLS.member)}>{role}</span>
            {tz && <span className="k-mcard__tz">{tz}</span>}
          </div>
        </div>
      </div>
      <div className="k-mcard__stats">
        <div><b>{openTasks ?? 0}</b><span>OPEN</span></div>
        <div><b>{doneThisWeek ?? 0}</b><span>DONE</span></div>
        <div><b>{avgCycle ?? '—'}</b><span>EST</span></div>
      </div>
      <div className="k-mcard__work">
        {recentTasks.slice(0, 3).map((t, i) => (
          <div key={i} className="k-mcard__row">
            <span className="k-pdot" style={{ width: 8, height: 8, background: PRI[t.priority] || '#6E7B91' }} />
            <span className="k-mcard__tt">{t.title}</span>
            <span className="k-mcard__id">{t.id}</span>
          </div>
        ))}
        {recentTasks.length === 0 && <div className="k-mcard__empty">No active tasks</div>}
      </div>
    </div>
  );
}
