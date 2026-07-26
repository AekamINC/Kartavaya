import React from 'react';
import { priorityColor, avatarColor, userInitials } from '../../lib/utils';
import DueChip from '../editorial/DueChip';
import { PRIORITY_LABELS } from '../drawer/constants';

// relDue and DUE_COLORS lived here as a second, disagreeing copy of the rule
// in editorial/DueChip.jsx. Both are gone; the board renders the same chip as
// the list and the table.


export default function KanbanCard({ task, onClick, dragging = false, draggable = false, onDragStart, onDragEnd }) {
  const priority = task.priority || 'medium';
  const color    = priorityColor(priority);
  const assignees = task.assignee_user_ids || [];
  const names     = task.assignee_names || [];
  const approvalPending = task.approval_status === 'pending' || task.approval_status === 'pending_client';

  return (
    <button
      className={`k-bcard${dragging ? ' is-dragging' : ''}`}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={dragging ? { transform: 'rotate(2deg)', boxShadow: 'var(--shadow-lg)' } : undefined}
    >
      {/* Top row: priority dot + task ID + priority label */}
      <div className="k-bcard__top">
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
        <span className="k-bcard__id">#{task.task_id?.slice(-6) || '—'}</span>
        {/* The approval badge was #d97706 on #fef3c7 with a #fbbf24 border —
            three baked ambers that stay light-mode weight on a dark board.
            --warn and its container flip with the theme. */}
        {approvalPending && (
          <span style={{ fontSize: 'var(--t-label-sm)', color: 'var(--warn)', background: 'var(--warn-container)', border: '1px solid color-mix(in srgb, var(--warn) 35%, transparent)', borderRadius: 'var(--r-pill)', padding: '1px 7px', fontWeight: 600 }}>
            {task.approval_status === 'pending_client' ? 'Client review' : 'Needs approval'}
          </span>
        )}
        <span className="k-bcard__priolbl">{PRIORITY_LABELS[priority]}</span>
      </div>

      {/* Title */}
      <div className="k-bcard__title">{task.title}</div>

      {/* Footer: due chip + meta icons + avatars */}
      <div className="k-bcard__foot">
        {/* The done-on-time / done-late comparison was written out here too,
            with #16a34a hardcoded twice. DueChip already does all of it —
            on-time, same-day-but-late, and the N-days-late count — so the whole
            branch collapses to the shared chip. */}
        {task.due_at && (
          <DueChip date={task.due_at} status={task.status} completedAt={task.completed_at} flush />
        )}

        <span className="k-bcard__meta">
          {(task.comment_count > 0) && (
            <span title="Comments">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2 4h12v7H6l-3 3v-3H2V4z"/>
              </svg>
              {task.comment_count}
            </span>
          )}
          {(task.attachments?.length > 0) && (
            <span title="Attachments">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5"/>
              </svg>
              {task.attachments.length}
            </span>
          )}
        </span>

        {assignees.length > 0 && (
          <div style={{ display: 'flex', marginLeft: 'auto', alignItems: 'center' }}>
            {assignees.slice(0, 3).map((uid, i) => (
              <span key={uid} title={names[i] || uid} style={{
                marginLeft: i > 0 ? -8 : 0,
                width: 26, height: 26, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: avatarColor(names[i]),
                color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '-0.3px',
                border: '2px solid var(--surface)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                flexShrink: 0,
              }}>
                {userInitials(names[i])}
              </span>
            ))}
            {assignees.length > 3 && (
              <span style={{
                marginLeft: -8, width: 26, height: 26, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-soft)', border: '2px solid var(--surface)',
                fontSize: 10, fontWeight: 700, color: 'var(--ink-2)',
              }}>
                +{assignees.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
