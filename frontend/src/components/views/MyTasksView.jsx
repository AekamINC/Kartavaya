/**
 * MyTasksView.jsx — tasks assigned to the current user, grouped by due urgency.
 */
import React, { useMemo, useState } from 'react';
import { currentUser } from '../../lib/auth';
import TaskDrawer from '../TaskDrawer';
import { priorityColor } from '../../lib/utils';
import { STATUS_COLORS, STATUS_LABELS } from '../drawer/constants';
import { EmptyState } from '../ui/EmptyState';

const GROUPS = [
  { id: 'overdue',  label: 'Overdue',   sans: 'विलंबित',  color: '#dc2626', border: '#dc2626' },
  { id: 'today',    label: 'Due today', sans: 'आज',       color: '#d97706', border: '#f59e0b' },
  { id: 'week',     label: 'This week', sans: 'इस सप्ताह', color: '#0082c6', border: '#0082c6' },
  { id: 'upcoming', label: 'Upcoming',  sans: 'आगामी',    color: 'var(--ink-2)', border: 'var(--rule)' },
  { id: 'nodate',   label: 'No due date', sans: 'अनिर्धारित', color: 'var(--ink-3)', border: 'var(--rule)' },
  { id: 'done',     label: 'Done',      sans: 'सम्पन्न',  color: '#16a34a', border: '#16a34a' },
];

function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

export default function MyTasksView({ tasks = [], teamMembers = [], onTasksChange }) {
  const me = currentUser();
  const [drawer, setDrawer] = useState(null);
  const [collapsed, setCollapsed] = useState({ done: true });

  const myTasks = useMemo(() => {
    if (!me?.user_id) return [];
    return tasks.filter(t => (t.assignee_user_ids || []).includes(me.user_id));
  }, [tasks, me]);

  const now = new Date(); now.setHours(0,0,0,0);
  const endOfWeek = new Date(now); endOfWeek.setDate(now.getDate() + 7);

  const grouped = useMemo(() => {
    const m = { overdue: [], today: [], week: [], upcoming: [], nodate: [], done: [] };
    myTasks.forEach(t => {
      if (t.status === 'done') { m.done.push(t); return; }
      if (!t.due_at) { m.nodate.push(t); return; }
      const due = new Date(t.due_at); due.setHours(0,0,0,0);
      const diff = daysBetween(now, due);
      if (diff < 0)        m.overdue.push(t);
      else if (diff === 0) m.today.push(t);
      else if (diff <= 7)  m.week.push(t);
      else                 m.upcoming.push(t);
    });
    return m;
  }, [myTasks, now]);

  const totalOpen = myTasks.filter(t => t.status !== 'done').length;

  if (!me) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
      Not signed in
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

      {/* Summary strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 20px', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--k-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
            {(me.full_name || me.email || 'Me').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{me.full_name || me.email}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>My tasks</div>
          </div>
        </div>
        <div style={{ height: 32, width: 1, background: 'var(--rule)' }} />
        <SumStat n={totalOpen}              label="open"    color="var(--ink)" />
        <SumStat n={grouped.overdue.length} label="overdue" color={grouped.overdue.length ? '#dc2626' : 'var(--ink-3)'} />
        <SumStat n={grouped.today.length}   label="today"   color={grouped.today.length ? '#d97706' : 'var(--ink-3)'} />
        <SumStat n={grouped.done.length}    label="done"    color="#16a34a" />
      </div>

      {myTasks.length === 0 && (
        <EmptyState
          illustration="tasks"
          title="No tasks assigned to you"
          description="Tasks assigned to you in this project will appear here."
        />
      )}

      {/* Groups */}
      {GROUPS.map(g => {
        const rows = grouped[g.id] || [];
        if (rows.length === 0) return null;
        const isCol = collapsed[g.id];
        return (
          <div key={g.id} style={{ background: 'var(--surface)', border: `1px solid var(--rule)`, borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', cursor: 'pointer', borderLeft: `4px solid ${g.border}` }}
              onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 500, color: g.color }}>{g.label}</span>
              <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, color: 'var(--ink-3)' }}>{g.sans}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', background: 'var(--bg-soft)', padding: '1px 7px', borderRadius: 99 }}>{rows.length}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 13 }}>{isCol ? '▸' : '▾'}</span>
            </div>

            {!isCol && rows.map(t => {
              const pColor = priorityColor(t.priority);
              const sColor = STATUS_COLORS[t.status] || '#64748b';
              const isOverdue = t.due_at && new Date(t.due_at) < now && t.status !== 'done';
              return (
                <div
                  key={t.task_id}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 20px', borderTop: '1px solid var(--rule-soft)', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                  onClick={() => setDrawer(t.task_id)}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: pColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  {t.attachments?.length > 0 && (
                    <span title={`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5"/></svg>
                      {t.attachments.length}
                    </span>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 600, color: sColor, background: sColor + '18', borderRadius: 99, padding: '2px 9px', flexShrink: 0 }}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                  {t.due_at && (
                    <span style={{ fontSize: 11, color: isOverdue ? '#dc2626' : 'var(--ink-3)', fontWeight: isOverdue ? 700 : 400, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {isOverdue && '⚠ '}{new Date(t.due_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <TaskDrawer taskId={drawer} open={!!drawer} onClose={() => setDrawer(null)} teamMembers={teamMembers}
        onSaved={u => { setDrawer(null); onTasksChange?.(p => p.map(t => t.task_id === u.task_id ? u : t)); }} />
    </div>
  );
}

function SumStat({ n, label, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}
