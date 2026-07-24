/**
 * TimelineView.jsx — Gantt-style horizontal bar chart grouped by status column.
 * Tasks without due dates are listed at the bottom as "No date".
 */
import React, { useState, useMemo } from 'react';
import TaskDrawer from '../TaskDrawer';
import { priorityColor } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

export default function TimelineView({ tasks = [], columns = [], teamMembers = [], onTasksChange }) {
  const [drawer, setDrawer] = useState(null);

  // Compute visible date range: earliest due_at - 2d … latest due_at + 7d, min 30 days
  const { rangeStart, totalDays, dayLabels } = useMemo(() => {
    const dated = tasks.filter(t => t.due_at);
    const now = new Date(); now.setHours(0,0,0,0);
    let start = new Date(now); start.setDate(start.getDate() - 3);
    let end   = addDays(start, 29);
    if (dated.length) {
      const dates = dated.map(t => new Date(t.due_at));
      const minD  = new Date(Math.min(...dates));
      const maxD  = new Date(Math.max(...dates));
      minD.setDate(minD.getDate() - 3);
      maxD.setDate(maxD.getDate() + 7);
      start = minD;
      end   = maxD;
    }
    const total = Math.max(daysBetween(start, end), 30);
    const labels = [];
    for (let i = 0; i < total; i++) {
      const d = addDays(start, i);
      labels.push({ date: d, label: d.getDate(), month: d.getMonth(), isToday: d.toDateString() === new Date().toDateString() });
    }
    return { rangeStart: start, totalDays: total, dayLabels: labels };
  }, [tasks]);

  const DAY_W = 32; // px per day

  // Group tasks by column
  const colMap = useMemo(() => {
    const map = {};
    (columns || []).forEach(c => { map[c.column_id] = c; });
    return map;
  }, [columns]);

  const grouped = useMemo(() => {
    const byCol = {};
    tasks.forEach(t => {
      const cid = t.column_id || '__none__';
      if (!byCol[cid]) byCol[cid] = [];
      byCol[cid].push(t);
    });
    return byCol;
  }, [tasks]);

  const sortedCols = useMemo(() => {
    const colIds = [...new Set(tasks.map(t => t.column_id || '__none__'))];
    return colIds.sort((a, b) => {
      const ia = columns.findIndex(c => c.column_id === a);
      const ib = columns.findIndex(c => c.column_id === b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [tasks, columns]);

  const today = new Date(); today.setHours(0,0,0,0);
  const todayOffset = daysBetween(rangeStart, today);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', position: 'relative' }}>
      {/* Header: month labels */}
      <div style={{ display: 'flex', paddingLeft: 220, position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--rule)' }}>
        {/* Month groupings */}
        {(() => {
          const groups = [];
          let cur = null; let count = 0;
          dayLabels.forEach((d, i) => {
            const key = `${d.date.getFullYear()}-${d.month}`;
            if (key !== cur) {
              if (cur !== null) groups.push({ key: cur, count, month: dayLabels[i - count].month, year: dayLabels[i - count].date.getFullYear() });
              cur = key; count = 1;
            } else { count += 1; }
          });
          if (cur) groups.push({ key: cur, count, month: dayLabels[dayLabels.length - count].month, year: dayLabels[dayLabels.length - count].date.getFullYear() });
          return groups.map(g => (
            <div key={g.key} style={{ width: g.count * DAY_W, flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '6px 8px', borderRight: '1px solid var(--rule-soft)' }}>
              {MONTHS[g.month]} {g.year}
            </div>
          ));
        })()}
      </div>

      {/* Day columns header */}
      <div style={{ display: 'flex', paddingLeft: 220, position: 'sticky', top: 29, zIndex: 10, background: 'var(--bg-soft)', borderBottom: '1px solid var(--rule)' }}>
        {dayLabels.map((d, i) => (
          <div key={i} style={{
            width: DAY_W, flexShrink: 0, textAlign: 'center',
            fontSize: 10, color: d.isToday ? 'var(--k-primary)' : (d.date.getDay() === 0 || d.date.getDay() === 6) ? 'var(--ink-faint)' : 'var(--ink-3)',
            fontWeight: d.isToday ? 700 : 400, padding: '4px 0',
            background: d.isToday ? 'color-mix(in srgb, var(--k-primary) 8%, var(--bg-soft))' : undefined,
          }}>{d.label}</div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ position: 'relative' }}>
        {/* Today line */}
        {todayOffset >= 0 && todayOffset < totalDays && (
          <div style={{ position: 'absolute', left: 220 + todayOffset * DAY_W + DAY_W / 2, top: 0, bottom: 0, width: 1.5, background: 'var(--k-primary)', zIndex: 5, opacity: 0.6 }} />
        )}

        {sortedCols.map(colId => {
          const col = colMap[colId];
          const colTasks = grouped[colId] || [];
          return (
            <div key={colId}>
              {/* Column group header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--rule-soft)', position: 'sticky', left: 0 }}>
                {col && <span style={{ width: 10, height: 10, borderRadius: 2, background: col.color || 'var(--ink-3)', flexShrink: 0, display: 'inline-block' }} />}
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {col?.name || 'No status'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{colTasks.length}</span>
              </div>

              {colTasks.map(task => {
                const hasDue = !!task.due_at;
                const dueDate = hasDue ? new Date(task.due_at) : null;
                const startDate = task.created_at ? new Date(task.created_at) : (dueDate ? addDays(dueDate, -3) : null);
                const barStart = startDate ? Math.max(0, daysBetween(rangeStart, startDate)) : null;
                const barEnd   = dueDate   ? Math.min(totalDays, daysBetween(rangeStart, dueDate) + 1) : null;
                const barW     = (barStart !== null && barEnd !== null) ? Math.max((barEnd - barStart) * DAY_W, DAY_W) : 0;
                const isOverdue = dueDate && dueDate < today && task.status !== 'done';
                const pColor = priorityColor(task.priority);

                return (
                  <div key={task.task_id} style={{ display: 'flex', alignItems: 'center', height: 40, borderBottom: '1px solid var(--rule-soft)', position: 'relative' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    {/* Task label — fixed left */}
                    <div style={{ width: 220, flexShrink: 0, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', position: 'sticky', left: 0, background: 'inherit', zIndex: 2 }}
                      onClick={() => setDrawer(task.task_id)}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: pColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.title}</span>
                    </div>

                    {/* Gantt bar area */}
                    <div style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                      {/* Weekend shading */}
                      {dayLabels.map((d, i) => (
                        (d.date.getDay() === 0 || d.date.getDay() === 6) ? (
                          <div key={i} style={{ position: 'absolute', left: i * DAY_W, width: DAY_W, top: 0, bottom: 0, background: 'color-mix(in srgb, var(--ink) 3%, transparent)', pointerEvents: 'none' }} />
                        ) : null
                      ))}

                      {hasDue && barStart !== null && barW > 0 && (
                        <div
                          onClick={() => setDrawer(task.task_id)}
                          style={{
                            position: 'absolute', left: barStart * DAY_W, width: barW,
                            height: 20, borderRadius: 4, cursor: 'pointer',
                            background: isOverdue ? '#dc2626' : pColor,
                            opacity: task.status === 'done' ? 0.4 : 0.85,
                            display: 'flex', alignItems: 'center', paddingLeft: 6,
                            fontSize: 10.5, color: '#fff', fontWeight: 600,
                            overflow: 'hidden', whiteSpace: 'nowrap',
                            boxShadow: '0 1px 3px rgba(0,0,0,.15)',
                            transition: 'opacity .15s',
                          }}
                          title={task.title}
                        >
                          {barW > 60 && task.title}
                        </div>
                      )}

                      {!hasDue && (
                        <span style={{ position: 'absolute', left: 8, fontSize: 11, color: 'var(--ink-faint)', fontStyle: 'italic' }}>No due date</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {tasks.length === 0 && (
          <EmptyState
            illustration="tasks"
            title="No tasks to display"
            description="Create tasks with due dates to see them on the timeline."
          />
        )}
      </div>

      <TaskDrawer taskId={drawer} open={!!drawer} onClose={() => setDrawer(null)} teamMembers={teamMembers}
        onSaved={u => { setDrawer(null); onTasksChange?.(p => p.map(t => t.task_id === u.task_id ? u : t)); }} />
    </div>
  );
}
