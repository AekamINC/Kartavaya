/**
 * TimelineView — a Gantt-style bar chart grouped by board column.
 *
 * 04 §5 marks this view **restyle only**: its drag-to-reschedule and multi-day
 * behaviour is unspecified and needs a design pass before the interaction is
 * touched. What follows is that restyle, and it closed three defects:
 *
 *  · **`:hover` was an inline style mutation.** `onMouseEnter` wrote
 *    `e.currentTarget.style.background` and `onMouseLeave` cleared it — the
 *    exact defect 04 §1 names on the table, where it went on to outrank the
 *    selection styling added later. It is `.tl__row:hover` now. The mutation
 *    was also load-bearing here in a way it was not on the table: the sticky
 *    label column is `background: inherit`, so an inline write on the parent
 *    was the only thing keeping the label opaque over the scrolling bars.
 *  · **`--ink-faint` carried text** on the weekend day numbers and the
 *    "No due date" note. It is 2.3:1 on `--bg` and declared non-text in 00 §12;
 *    both are `--on-surface-3` (4.8:1).
 *  · **Two hardcoded radii** (`4` on the bar, `2` on the column swatch) which
 *    ignore the Sharp and Pill settings in exactly those two places.
 *
 * Geometry stays inline. Bar offsets and widths are `DAY_W` multiples computed
 * per task, which is a value CSS cannot know; colour, type and state are
 * classes.
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
    <div className="tl">
      {/* Header: month labels */}
      <div className="tl__months">
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
            <div key={g.key} className="tl__month" style={{ width: g.count * DAY_W }}>
              {MONTHS[g.month]} {g.year}
            </div>
          ));
        })()}
      </div>

      {/* Day columns header */}
      <div className="tl__days">
        {dayLabels.map((d, i) => {
          const weekend = d.date.getDay() === 0 || d.date.getDay() === 6;
          return (
            <div
              key={i}
              className={['tl__day', d.isToday && 'is-today', weekend && 'is-weekend'].filter(Boolean).join(' ')}
              style={{ width: DAY_W }}
            >
              {d.label}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      <div className="tl__body">
        {/* Today line */}
        {todayOffset >= 0 && todayOffset < totalDays && (
          <div className="tl__now" style={{ left: 220 + todayOffset * DAY_W + DAY_W / 2 }} />
        )}

        {sortedCols.map(colId => {
          const col = colMap[colId];
          const colTasks = grouped[colId] || [];
          return (
            <div key={colId}>
              {/* Column group header */}
              <div className="tl__grp">
                {col && <span className="tl__grpdot" style={{ '--c': col.color || 'var(--on-surface-3)' }} />}
                <span className="tl__grpn">{col?.name || 'No status'}</span>
                <span className="tl__grpc">{colTasks.length}</span>
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
                  <div key={task.task_id} className="tl__row">
                    {/* Task label — fixed left */}
                    <button
                      type="button"
                      className="tl__label"
                      onClick={() => setDrawer(task.task_id)}
                    >
                      <span className="tl__pdot" style={{ '--c': pColor }} />
                      <span className="tl__title">{task.title}</span>
                    </button>

                    {/* Gantt bar area */}
                    <div className="tl__lane">
                      {/* Weekend shading */}
                      {dayLabels.map((d, i) => (
                        (d.date.getDay() === 0 || d.date.getDay() === 6) ? (
                          <div key={i} className="tl__wknd" style={{ left: i * DAY_W, width: DAY_W }} />
                        ) : null
                      ))}

                      {hasDue && barStart !== null && barW > 0 && (
                        <button
                          type="button"
                          className={['tl__bar', task.status === 'done' && 'is-done'].filter(Boolean).join(' ')}
                          onClick={() => setDrawer(task.task_id)}
                          style={{
                            left: barStart * DAY_W,
                            width: barW,
                            '--c': isOverdue ? 'var(--danger)' : pColor,
                          }}
                          title={task.title}
                        >
                          {barW > 60 && task.title}
                        </button>
                      )}

                      {!hasDue && <span className="tl__nodue">No due date</span>}
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
