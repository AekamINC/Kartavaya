import React from 'react';
import Picker from '../ui/Picker';
import Lbl from './DrawerLabel';
import { PRIORITY_LABELS, PRIORITY_COLORS } from './constants';
import ReminderPicker, { DEFAULT_REMINDERS } from '../ReminderPicker';
import { formatDueDateTime } from '../../lib/timeFormat';
import { playPraiseSound } from '../../lib/notifSound';

/**
 * DrawerMeta — priority · status · due · reminders · category · assignees.
 *
 * Every dropdown here is now `ui/Picker.jsx` (26 §4). The drawer shipped FOUR
 * independently-written pickers; between them, four dismiss behaviours (two did
 * not close on Escape), a hardcoded `z-index: 300`, a hardcoded upward
 * placement, no arrow-key support anywhere and four separate mobile treatments.
 * One component, four modes, one set of keyboard rules.
 *
 * The assignee list in particular was a `<select>`-shaped `<button>` with its
 * own absolutely-positioned panel whose dismissal handler lived two levels up
 * in `TaskDrawer` — which is exactly why it drifted from the other three.
 *
 * DUE DATE IS THE ONE DELIBERATE EXCEPTION and it is not an oversight.
 * `Picker mode="date"` returns a calendar date; `due_at` carries a time of day
 * that `DueChip` renders ("Today, 4:30 pm"), that `hasTimeComponent` reads to
 * decide whether to print a time at all, and that the reminder offsets are
 * measured back from. Swapping in a date-only control would silently move every
 * existing due time to midnight. It stays `datetime-local`, on `.inp`.
 */
export default function DrawerMeta({
  task, draft, setDraft, saveTask, saveReminders, onColumnChange,
  columns, members, categories,
  assignees, setAssignees,
}) {
  if (!task) return null;

  // API shape (channels: string[]) <-> picker shape (channels: {in_app,push,email})
  const pickerReminders = (draft.reminders || []).map(r => ({
    offset_minutes: r.offset_minutes,
    channels: { in_app: r.channels.includes('in_app'), push: r.channels.includes('push'), email: r.channels.includes('email') },
  }));

  const priorities = Object.entries(PRIORITY_LABELS)
    .map(([id, name]) => ({ id, name, color: PRIORITY_COLORS[id] }));

  const stages = columns
    .filter(c => !(c.name || '').toLowerCase().includes('approval'))
    .map(c => ({ id: c.column_id, name: c.name }));

  const memberItems = members
    .map(m => ({
      id: m.user_id || m.member_id,
      name: m.display_name || m.full_name || m.name || '',
      meta: m.member_role || m.position || m.job_title || '',
    }))
    .filter(m => m.id && m.name);

  const categoryItems = [
    { id: '', name: '— None —' },
    ...categories.map(c => ({ id: c.category_id, name: c.name })),
  ];

  return (
    <div className="dr__props">

      <div className="dr__prop">
        <Lbl hi="प्राथमिकता">Priority</Lbl>
        <Picker
          mode="option" field ariaLabel="Priority"
          items={priorities}
          value={draft.priority || 'medium'}
          placeholder="No priority"
          onChange={v => { setDraft(d => ({ ...d, priority: v })); saveTask({ priority: v }); }}
        />
      </div>

      <div className="dr__prop">
        <Lbl hi="स्थिति">Status</Lbl>
        {columns.length > 0 ? (
          <Picker
            mode="option" field ariaLabel="Status"
            items={stages}
            value={task.column_id || ''}
            placeholder="No column"
            onChange={v => v && onColumnChange(v)}
          />
        ) : (
          <Picker
            mode="option" field ariaLabel="Status"
            items={[
              { id: 'todo', name: 'To do' },
              { id: 'in_progress', name: 'In progress' },
              { id: 'done', name: 'Done' },
            ]}
            value={draft.status || 'todo'}
            onChange={v => {
              setDraft(d => ({ ...d, status: v }));
              saveTask({ status: v });
              if (v === 'done') playPraiseSound();
            }}
          />
        )}
      </div>

      <div className="dr__prop">
        <Lbl hi="समय-सीमा">Due date</Lbl>
        <input
          type="datetime-local"
          className="inp"
          aria-label="Due date and time"
          value={toLocalDatetimeValue(draft.due_at)}
          onChange={async e => {
            const v = e.target.value ? new Date(e.target.value).toISOString() : null;
            setDraft(d => ({ ...d, due_at: v }));
            await saveTask({ due_at: v });
            // Teams-like default: 1hr + 15min reminders the first time a due date is set.
            if (v && (draft.reminders || []).length === 0) saveReminders(DEFAULT_REMINDERS);
          }}
        />
        {draft.due_at && <span className="dr__prop-hint">{formatDueDateTime(draft.due_at)}</span>}
      </div>

      <div className="dr__prop">
        <Lbl hi="रिमाइंडर">Reminders</Lbl>
        <ReminderPicker
          value={pickerReminders}
          onChange={next => {
            setDraft(d => ({
              ...d,
              reminders: next.map(r => ({
                offset_minutes: r.offset_minutes,
                channels: Object.entries(r.channels).filter(([, v]) => v).map(([k]) => k),
              })),
            }));
            saveReminders(next);
          }}
          disabled={!draft.due_at}
        />
        {!draft.due_at && <span className="dr__prop-hint">Set a due date to enable reminders</span>}
      </div>

      <div className="dr__prop">
        <Lbl hi="श्रेणी">Category</Lbl>
        <Picker
          mode="option" field ariaLabel="Category"
          items={categoryItems}
          value={draft.category_id || ''}
          placeholder="— None —"
          onChange={v => {
            const next = v || null;
            setDraft(d => ({ ...d, category_id: next }));
            saveTask({ category_id: next });
          }}
        />
      </div>

      {task.team_id && (
        <div className="dr__prop">
          <Lbl hi="नियुक्त">Assignees</Lbl>
          <Picker
            mode="multi" field ariaLabel="Assignees"
            items={memberItems}
            value={assignees}
            placeholder="Pick members…"
            onChange={setAssignees}
          />
        </div>
      )}
    </div>
  );
}

/** UTC ISO → the "YYYY-MM-DDTHH:mm" shape <input type="datetime-local"> wants, in local time. */
function toLocalDatetimeValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
