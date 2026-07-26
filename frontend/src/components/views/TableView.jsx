/**
 * TableView.jsx — sortable, filterable, grouped table on k-* design system.
 */
import DueChip from '../editorial/DueChip';
import React, { useState, useMemo } from 'react';
import TaskDrawer from '../TaskDrawer';
import FieldRenderer from '../fields/FieldRenderer';
import { EmptyState } from '../ui/EmptyState';

import { priorityColor } from '../../lib/utils';

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

function Th({ label, sortKey, sort, onSort, width }) {
  const active = sort?.key === sortKey;
  return (
    <th onClick={() => sortKey && onSort(sortKey)} style={{
      padding: '9px 14px', textAlign: 'left',
      fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      whiteSpace: 'nowrap', width,
      cursor: sortKey ? 'pointer' : 'default', userSelect: 'none',
      borderBottom: '1px solid var(--rule)',
      background: 'var(--bg-soft)',
    }}>
      {label}{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

function PriorityBadge({ priority }) {
  const color = priorityColor(priority);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600, color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
      {priority || '—'}
    </span>
  );
}

function ColBadge({ col }) {
  if (!col) return <span style={{ color: 'var(--ink-faint)' }}>—</span>;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      background: col.color + '22', color: col.color,
      border: `1px solid ${col.color}44`,
      borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>{col.name}</span>
  );
}

export default function TableView({ tasks, columns, fieldDefs, fieldValueMap, teamMembers, onTasksChange }) {
  const [sort,    setSort]    = useState({ key: 'sort_order', dir: 'asc' });
  const [filter,  setFilter]  = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [drawer,  setDrawer]  = useState(null);
  const [visibleFields, setVisible] = useState(() => (fieldDefs || []).map(f => f.field_id));
  React.useEffect(() => { setVisible((fieldDefs || []).map(f => f.field_id)); }, [fieldDefs?.length]);

  const colMap = useMemo(() => Object.fromEntries((columns || []).map(c => [c.column_id, c])), [columns]);
  const handleSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return (tasks || []).filter(t => !q || t.title.toLowerCase().includes(q));
  }, [tasks, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key];
      if (sort.key === 'priority') { av = PRIORITY_ORDER[av] ?? 99; bv = PRIORITY_ORDER[bv] ?? 99; }
      if (sort.key === 'due_at') { av = av ? new Date(av).getTime() : Infinity; bv = bv ? new Date(bv).getTime() : Infinity; }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sort]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ label: null, rows: sorted }];
    const groups = {};
    sorted.forEach(t => {
      const key = groupBy === 'column' ? (colMap[t.column_id]?.name || 'Uncategorised')
        : groupBy === 'status' ? t.status : t.priority;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return Object.entries(groups).map(([label, rows]) => ({ label, rows }));
  }, [sorted, groupBy, colMap]);

  const shownFields = (fieldDefs || []).filter(f => visibleFields.includes(f.field_id));

  return (
    <>
      {/* Toolbar */}
      <div className="k-filterbar" style={{ marginBottom: 14 }}>
        <input
          className="k-input"
          style={{ width: 220 }}
          placeholder="Filter tasks…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <select
          className="k-input"
          style={{ width: 'auto' }}
          value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
        >
          <option value="none">No grouping</option>
          <option value="column">Group by column</option>
          <option value="status">Group by status</option>
          <option value="priority">Group by priority</option>
        </select>
        {(fieldDefs || []).length > 0 && (
          <details style={{ position: 'relative' }}>
            <summary className="k-btn k-btn--ghost k-btn--sm" style={{ listStyle: 'none', cursor: 'pointer' }}>
              Fields ▾
            </summary>
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4,
              background: 'var(--surface)', border: '1px solid var(--rule)',
              borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-md)',
              padding: 10, minWidth: 180,
            }}>
              {(fieldDefs || []).map(f => (
                <label key={f.field_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer', color: 'var(--ink-2)' }}>
                  <input type="checkbox" checked={visibleFields.includes(f.field_id)}
                    onChange={e => setVisible(v => e.target.checked ? [...v, f.field_id] : v.filter(id => id !== f.field_id))} />
                  {f.name}
                </label>
              ))}
            </div>
          </details>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          {filtered.length} tasks
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 'var(--r-md)', border: '1px solid var(--rule)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <Th label="Title"      sortKey="title"     sort={sort} onSort={handleSort} width="36%" />
              <Th label="Column"     sortKey="column_id" sort={sort} onSort={handleSort} width="13%" />
              <Th label="Priority"   sortKey="priority"  sort={sort} onSort={handleSort} width="10%" />
              <Th label="Created by" sortKey={null}      sort={sort} onSort={handleSort} width="14%" />
              <Th label="Due"        sortKey="due_at"    sort={sort} onSort={handleSort} width="11%" />
              {shownFields.map(f => <Th key={f.field_id} label={f.name} sortKey={null} sort={sort} onSort={handleSort} width="120px" />)}
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ label, rows }, gi) => (
              <React.Fragment key={gi}>
                {label && (
                  <tr>
                    <td colSpan={5 + shownFields.length} style={{
                      padding: '8px 14px', fontSize: 10.5, fontWeight: 700,
                      color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em',
                      background: 'var(--bg-soft)', borderBottom: '1px solid var(--rule)',
                    }}>
                      {label} <span style={{ fontWeight: 400, opacity: 0.6 }}>({rows.length})</span>
                    </td>
                  </tr>
                )}
                {rows.map(task => {
                  const col = colMap[task.column_id];
                  const fvals = fieldValueMap?.[task.task_id] || {};
                  return (
                    <tr key={task.task_id}
                      onClick={() => setDrawer(task.task_id)}
                      style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--ink)', verticalAlign: 'middle' }}>
                        {task.approval_status === 'pending' && <span style={{ marginRight: 6, fontSize: 12 }}>⏳</span>}
                        {task.title}
                        {task.attachments?.length > 0 && (
                          <span title={`${task.attachments.length} attachment${task.attachments.length > 1 ? 's' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--ink-3)', marginLeft: 6, flexShrink: 0 }}>
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5"/></svg>
                            {task.attachments.length}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                        <ColBadge col={col} />
                      </td>
                      <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                        <PriorityBadge priority={task.priority} />
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--ink-3)', verticalAlign: 'middle' }}>
                        {task.created_by_name || '—'}
                      </td>
                      {/* Was an inline third copy of the rule, formatted with
                          toLocaleDateString(undefined, …) — the BROWSER's locale,
                          where the list and board both pin en-IN, so the same
                          date rendered two ways in one app. */}
                      <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                        <DueChip date={task.due_at} status={task.status} completedAt={task.completed_at} flush />
                      </td>
                      {shownFields.map(f => (
                        <td key={f.field_id} style={{ padding: '10px 14px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                          <FieldRenderer field={f} value={fvals[f.field_id] ?? null} onChange={() => {}} readOnly />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5 + shownFields.length}>
                  <EmptyState
                    illustration="search"
                    title="No tasks found"
                    description="Try adjusting your filter or create a new task."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TaskDrawer taskId={drawer} open={!!drawer} onClose={() => setDrawer(null)}
        teamMembers={teamMembers} onSaved={u => onTasksChange?.(p => p.map(t => t.task_id === u.task_id ? u : t))} />
    </>
  );
}
