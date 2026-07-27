import React from 'react';
import { DueChip, AvatarStack } from '../ui';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/statusColors';

/**
 * TaskCard — the board card (04-boards-table-views.md §5, `KanbanCard.jsx`
 * renamed).
 *
 * What changed, and why each one was a defect rather than a preference:
 *
 *  · **Due presentation is `ui/DueChip.jsx`.** This file carried a second copy
 *    of the rule that disagreed with the list and the table on four of the
 *    seven cases — "Due today, 4:30 pm" here against "Today, 4:30 pm" there —
 *    and hardcoded `#16a34a` twice for done-on-time. The chip's `soon` tier is
 *    the board's own contribution and it survived; it just lives in one place.
 *  · **The approval pill is `.bc__appr`.** It was `#d97706` on `#fef3c7` with
 *    an `#fbbf24` border: three light-mode literals, so on a dark board it
 *    rendered as a pale yellow chip. `--warn` / `--warn-container` flip.
 *  · **Avatars are `AvatarStack`.** The overlap was `marginLeft: i > 0 ? -8 : 0`
 *    — an index conditional that has to be recomputed whenever the list
 *    reorders. `.avstack > * + *` is the same overlap as a sibling selector,
 *    and it carries the ring in the parent's background colour, which a bare
 *    negative margin does not.
 *  · **`--k-danger` is `--danger`.** The card used the first, the table the
 *    second, for the same overdue red. One of the two was undefined, and an
 *    undefined colour in a `color:` declaration falls back to inherited text,
 *    so overdue was silently not red in one of the two views.
 *
 * Drag is not this component's business. `KanbanView` wraps it in a
 * `<Draggable>` and puts the handle props on the wrapper, so the card takes
 * only `dragging` for the lift transform.
 *
 *  · **The quick-complete tick** is IxViews 9.4: one quick action, not five,
 *    because marking something done is the most common single change and it
 *    took three clicks through the drawer. It is a real `<button>` nested in
 *    the card's own click target, so it `stopPropagation`s — without that,
 *    ticking a card also opens it, which the catalogue calls out by name.
 *  · **`pending`** carries MOTION-SPEC §7.1: an optimistic write renders at
 *    `opacity .6` until the server acknowledges. **`just`** is 9.1's settle
 *    flash, so a card you dropped is findable in its new column. **`tickpop`**
 *    is 9.4's "ticking runs the 2.2 checkbox animation" — the stroke draw and
 *    the box overshoot. It is a separate flag from `just` because `just` also
 *    fires on a drop, and because keying the animation off the done state alone
 *    springs every completed card on the board at mount.
 */
export default function TaskCard({
  task, onClick, dragging = false, pending = false, just = false, fresh = false,
  tickpop = false, onComplete,
}) {
  const priority = task.priority || 'medium';
  const color = PRIORITY_COLORS[priority] || 'var(--on-surface-3)';
  const names = task.assignee_names || [];
  const ids = task.assignee_user_ids || [];
  const people = ids.map((id, i) => ({ id, name: names[i] || id }));
  const approvalPending =
    task.approval_status === 'pending' || task.approval_status === 'pending_client';
  const isDone = task.status === 'done';

  return (
    <button
      type="button"
      className={['bc', dragging && 'drag', pending && 'pending', just && 'just',
        fresh && 'fresh', tickpop && 'tickpop'].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <span className="bc__top">
        <span className="bc__pdot" style={{ '--c': color }} />
        <span className="bc__id">#{task.task_id?.slice(-6) || '—'}</span>
        {approvalPending && (
          <span className="bc__appr">
            {task.approval_status === 'pending_client' ? 'Client review' : 'Needs approval'}
          </span>
        )}
        <span className="bc__prio" style={{ '--c': color }}>{PRIORITY_LABELS[priority]}</span>
        {onComplete && (
          // `as="span"` is not an option — this must be focusable and it must
          // announce its state, so it is a nested button with an explicit
          // `aria-pressed`. Nested interactive content inside a <button> is
          // invalid HTML, so the card itself is the one that gives way: see
          // KanbanView, where the card's own role is what wraps this.
          <span
            role="button"
            tabIndex={0}
            aria-pressed={isDone}
            aria-label={isDone ? `Mark ${task.title} as not done` : `Mark ${task.title} done`}
            className={['bc__tick', isDone && 'on'].filter(Boolean).join(' ')}
            onClick={e => { e.stopPropagation(); onComplete(task); }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); e.stopPropagation(); onComplete(task);
              }
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 8.4l3 3 6-6.6" />
            </svg>
          </span>
        )}
      </span>

      <span className="bc__t">{task.title}</span>

      <span className="bc__foot">
        {task.due_at && (
          <DueChip date={task.due_at} status={task.status} completedAt={task.completed_at} flush />
        )}

        {(task.comment_count > 0 || task.attachments?.length > 0) && (
          <span className="bc__meta">
            {task.comment_count > 0 && (
              <span title={`${task.comment_count} comment${task.comment_count > 1 ? 's' : ''}`}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path d="M2 4h12v7H6l-3 3v-3H2V4z" />
                </svg>
                {task.comment_count}
              </span>
            )}
            {task.attachments?.length > 0 && (
              <span title={`${task.attachments.length} attachment${task.attachments.length > 1 ? 's' : ''}`}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5" />
                </svg>
                {task.attachments.length}
              </span>
            )}
          </span>
        )}

        {people.length > 0 && (
          // MEASURED: the reference card's avatar is 22px, not 26. At 26 the
          // stack was the tallest thing in the foot and set the row's height,
          // which is why the foot measured 26px against the reference's 22.
          <AvatarStack users={people} size={22} max={3} className="bc__people" />
        )}
      </span>
    </button>
  );
}
