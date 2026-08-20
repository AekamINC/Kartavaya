import React from 'react';
import Picker from '../ui/Picker';
import DatePicker from '../ui/DatePicker';
import Lbl from './DrawerLabel';
import { PRIORITY_LABELS, PRIORITY_COLORS, STATUS_LABELS } from './constants';
import { SETTABLE_STATUSES } from '../../pages/approvals/transitions';
import ReminderPicker, { DEFAULT_REMINDERS } from '../ReminderPicker';
import { formatDueDateTime } from '../../lib/timeFormat';
import { playPraiseSound } from '../../lib/notifSound';
import DateInput from '../ui/DateInput';
import DrawerLabels from './DrawerLabels';

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
 * DUE DATE — the exception that WAS real and is now resolved, not waived.
 *
 * This docblock used to end "It stays `datetime-local`, on `.inp`", and the
 * argument behind that was correct as far as it went: `Picker mode="date"`
 * returns a calendar date, while `due_at` carries a time of day that `DueChip`
 * renders ("Today, 4:30 pm"), that `hasTimeComponent` reads to decide whether
 * to print a time at all, and that reminder offsets are measured back from.
 * Replacing the control with a date-only one WOULD have moved every existing
 * due time to midnight.
 *
 * What that argument settled was "not a bare calendar". What it was read as
 * settling — for long enough that the whole build's only unified calendar sat
 * unused on the one screen a task's date is actually edited on — was "not this
 * calendar". Those are different claims. `datetime-local` is two controls in
 * one input: a date half whose popup is the BROWSER's, and therefore a
 * different language, a different first-day-of-week and a different theme on
 * every machine (02-common-components.md §3 opens on exactly that complaint),
 * and a time half that is a plain text field with a mask.
 *
 * So the two halves are split rather than the control kept whole:
 *
 *   DATE  → `<DatePicker>`, the shared `PickerDate` calendar. Same component
 *           the custom `date` field type already renders through
 *           FieldRenderer, so there is still exactly ONE calendar in the app.
 *           It preserves the existing time-of-day: picking a new date on a
 *           task due at 4:30 pm keeps 4:30 pm.
 *   TIME  → `<input type="time">`, which is a text field with a mask and has
 *           no popup to be inconsistent about.
 *
 * MIDNIGHT IS THE DATE-ONLY SENTINEL and this is what makes the split safe:
 * `hasTimeComponent` already defines a due date at 00:00 as carrying no time,
 * and `formatDueDateTime` already omits the time for one. Clearing the time
 * field therefore produces the same value a legacy date-only task holds, and
 * every existing timed due date is round-tripped byte-for-byte because the
 * hours and minutes are read off the stored ISO string and written straight
 * back.
 *
 * The time field is `type="time"`, which mobile-responsive.css §Forms does NOT
 * currently list among the 16px selectors — reported rather than fixed here,
 * because that block is a shared rule and this file is not where it lives.
 */
export default function DrawerMeta({
  task, draft, setDraft, saveTask, saveReminders, onColumnChange,
  columns, members, categories,
  assignees, setAssignees,
  // Optional. Only used to suggest labels already in use nearby; a surface
  // that opens a task on its own passes nothing and the free-text input still
  // works. Defaulted so this is never a crash.
  allTasks = [],
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

  /* Labels already in use nearby, so the firm's vocabulary converges without
     being enforced. `allTasks` is whatever list the drawer was opened from —
     absent on surfaces that open a task alone, in which case there are simply
     no suggestions and the free-text input still works. */
  const labelSuggestions = React.useMemo(() => {
    const seen = new Map();
    for (const t of (allTasks || [])) {
      for (const tag of (t?.tags || [])) {
        const key = String(tag).toLowerCase();
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
    return [...seen.values()].sort((a, b) => String(a).localeCompare(String(b)));
  }, [allTasks]);

  const categoryItems = [
    { id: '', name: '— None —' },
    ...categories.map(c => ({ id: c.category_id, name: c.name })),
  ];

  /** One write path for both halves of the due date, so the optimistic update,
   *  the save and the first-reminder default cannot drift between them. */
  const commitDue = async (iso) => {
    if (iso === draft.due_at) return;
    const hadDate = !!draft.due_at;
    setDraft(d => ({ ...d, due_at: iso }));
    await saveTask({ due_at: iso });
    // Teams-like default: 1hr + 15min reminders the first time a due date is
    // set. Guarded on `!hadDate` as well as on the reminder count so that
    // editing only the TIME of an existing due date does not re-seed reminders
    // the user has deliberately cleared.
    if (iso && !hadDate && (draft.reminders || []).length === 0) saveReminders(DEFAULT_REMINDERS);
  };

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
            // The state machine's four, not a hand-written three. The literal
            // list here omitted `in_review` entirely, so a task could be put
            // into review from the board and the table but not from its own
            // drawer — and the drawer is where a task is edited. Same source as
            // BulkBar; `__tests__/statusMenus.test.jsx` checks both.
            items={SETTABLE_STATUSES.map(id => ({ id, name: STATUS_LABELS[id] || id }))}
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
        <div className="dr__due">
          <DatePicker
            field
            ariaLabel="Due date"
            placeholder="No due date"
            value={draft.due_at ? new Date(draft.due_at) : null}
            onChange={d => commitDue(withDatePart(draft.due_at, d))}
          />
          <DateInput
            type="time"
            className="inp dr__due-time"
            aria-label="Due time"
            /* Disabled without a date, for the same reason ReminderPicker is:
               a time with no date is not a due date, and an enabled control
               that cannot produce a valid value is an invitation to a dead
               end. */
            disabled={!draft.due_at}
            value={toLocalTimeValue(draft.due_at)}
            onChange={e => commitDue(withTimePart(draft.due_at, e.target.value))}
          />
        </div>
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

      <DrawerLabels
        tags={draft.tags || []}
        suggestions={labelSuggestions}
        onChange={next => {
          setDraft(d => ({ ...d, tags: next }));
          saveTask({ tags: next });
        }}
      />

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

const pad = n => String(n).padStart(2, '0');

/** UTC ISO → the "HH:mm" shape <input type="time"> wants, in local time.
 *  Midnight renders as EMPTY, not "00:00": midnight is the date-only sentinel
 *  `hasTimeComponent` already uses, and printing it as a time would tell the
 *  user a legacy date-only task is due at the stroke of midnight. */
function toLocalTimeValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getHours() === 0 && d.getMinutes() === 0) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Replace the DATE of `iso`, keeping its time of day. `null` clears the whole
 * value — a task with no date has no due time either.
 *
 * The time is carried across explicitly rather than by mutating in place,
 * because `new Date(y, m, d)` alone would silently reset it to midnight, which
 * is precisely the "every existing due time moves to midnight" failure the
 * docblock above says this control must not cause.
 */
function withDatePart(iso, date) {
  if (!date) return null;
  const prev = iso ? new Date(iso) : null;
  const h = prev && !Number.isNaN(prev.getTime()) ? prev.getHours() : 0;
  const min = prev && !Number.isNaN(prev.getTime()) ? prev.getMinutes() : 0;
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, min, 0, 0);
  return next.toISOString();
}

/**
 * Replace the TIME of `iso` from an "HH:mm" string, keeping its date. An empty
 * string means "no time of day", which is stored as local midnight — the value
 * `hasTimeComponent` reads as date-only and `formatDueDateTime` prints without
 * a time. Clearing the time is therefore lossless and reversible, and produces
 * exactly the shape legacy date-only tasks already hold.
 */
function withTimePart(iso, hhmm) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [h, m] = (hhmm || '').split(':');
  d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return d.toISOString();
}
