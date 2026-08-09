import React from 'react';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../lib/statusColors';
import DateInput from '../ui/DateInput';

/**
 * FilterBuilder — field → operator → value (04-boards-table-views.md §2).
 *
 * New. The table had a single free-text box that matched `title` only, so
 * "everything urgent that is not done" was not expressible and users filtered
 * by eye.
 *
 * Clauses are ANDed. OR is deliberately absent: a builder that offers both
 * needs grouping to be unambiguous, and a flat list with a mixed connective is
 * the version of this control that silently returns the wrong rows. AND-only is
 * honest about what it does.
 */

/** Operators by value kind. `is`/`is not` for enums, contains for text. */
const TEXT_OPS = [
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: 'does not contain' },
  { id: 'is', label: 'is' },
];
const ENUM_OPS = [
  { id: 'is', label: 'is' },
  { id: 'is_not', label: 'is not' },
];
const DATE_OPS = [
  { id: 'before', label: 'before' },
  { id: 'after', label: 'after' },
  { id: 'is_empty', label: 'is empty' },
  { id: 'not_empty', label: 'is not empty' },
];

export function filterFields(columns = []) {
  return [
    { id: 'title', label: 'Title', kind: 'text' },
    {
      id: 'status',
      label: 'Status',
      kind: 'enum',
      options: Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label })),
    },
    {
      id: 'priority',
      label: 'Priority',
      kind: 'enum',
      options: Object.entries(PRIORITY_LABELS).map(([id, label]) => ({ id, label })),
    },
    {
      id: 'column_id',
      label: 'Column',
      kind: 'enum',
      options: (columns || []).map(c => ({ id: c.column_id, label: c.name })),
    },
    { id: 'due_at', label: 'Due date', kind: 'date' },
  ];
}

const opsFor = (kind) => (kind === 'enum' ? ENUM_OPS : kind === 'date' ? DATE_OPS : TEXT_OPS);

/** True when `task` satisfies every clause. An incomplete clause is ignored. */
export function applyFilters(tasks, clauses, fields) {
  const active = (clauses || []).filter(c => c.field && c.op);
  if (!active.length) return tasks;

  return tasks.filter(task => active.every(c => {
    const def = fields.find(f => f.id === c.field);
    const raw = task[c.field];

    if (c.op === 'is_empty') return raw == null || raw === '';
    if (c.op === 'not_empty') return raw != null && raw !== '';

    if (def?.kind === 'date') {
      if (!raw || !c.value) return true;
      const a = new Date(raw).getTime();
      const b = new Date(c.value).getTime();
      if (Number.isNaN(a) || Number.isNaN(b)) return true;
      return c.op === 'before' ? a < b : a > b;
    }

    if (!c.value) return true;
    const needle = String(c.value).toLowerCase();
    const hay = String(raw ?? '').toLowerCase();
    if (c.op === 'is') return hay === needle;
    if (c.op === 'is_not') return hay !== needle;
    if (c.op === 'not_contains') return !hay.includes(needle);
    return hay.includes(needle);
  }));
}

export default function FilterBuilder({ fields, clauses, onChange }) {
  const set = (i, patch) => onChange(clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i) => onChange(clauses.filter((_, j) => j !== i));
  const add = () => onChange([...clauses, { id: `f${Date.now()}`, field: 'title', op: 'contains', value: '' }]);

  return (
    <div className="fb">
      {clauses.map((c, i) => {
        const def = fields.find(f => f.id === c.field) || fields[0];
        const ops = opsFor(def.kind);
        const needsValue = c.op !== 'is_empty' && c.op !== 'not_empty';

        return (
          <span key={c.id} className="fb__row">
            <select
              className="fb__sel"
              value={c.field}
              aria-label="Filter field"
              onChange={e => {
                const next = fields.find(f => f.id === e.target.value);
                set(i, { field: e.target.value, op: opsFor(next.kind)[0].id, value: '' });
              }}
            >
              {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>

            <select
              className="fb__sel"
              value={c.op}
              aria-label="Filter operator"
              onChange={e => set(i, { op: e.target.value })}
            >
              {ops.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>

            {needsValue && def.kind === 'enum' && (
              <select className="fb__sel" value={c.value} aria-label="Filter value" onChange={e => set(i, { value: e.target.value })}>
                <option value="">any</option>
                {def.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
            {needsValue && def.kind === 'date' && (
              <DateInput className="fb__in" type="date" value={c.value} aria-label="Filter value" onChange={e => set(i, { value: e.target.value })} />
            )}
            {needsValue && def.kind === 'text' && (
              <input className="fb__in" value={c.value} placeholder="value…" aria-label="Filter value" onChange={e => set(i, { value: e.target.value })} />
            )}

            <button type="button" className="fb__x" onClick={() => remove(i)} aria-label={`Remove ${def.label} filter`}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </span>
        );
      })}

      <button type="button" className="btn btn--text btn--sm" onClick={add}>+ Filter</button>
    </div>
  );
}
