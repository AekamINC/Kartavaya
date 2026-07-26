import React, { useState, useRef, useCallback } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { Check, X } from 'lucide-react';
import { AVATAR_COLORS, userInitials } from '../../lib/utils';
import { lbl } from './constants';

/** Inline mini assignee picker for a single subtask row. */
function SubtaskAssigneePicker({ subtaskId, assigneeUserId, aName, members, onAssign, colorIndex }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Outside-click AND Escape — this used to be outside-click only.
  useDismiss(open, ref, useCallback(() => setOpen(false), []));

  const assignableMembers = members.filter(m => m.display_name || m.full_name || m.name);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Assign subtask"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: aName ? 'var(--side-active)' : 'var(--bg-soft)',
          border: '1px solid var(--rule)', borderRadius: 20,
          padding: aName ? '2px 8px 2px 3px' : '2px 8px',
          cursor: 'pointer', fontSize: 11, fontWeight: 500,
          color: aName ? 'var(--ink)' : 'var(--ink-faint)',
          whiteSpace: 'nowrap',
        }}
      >
        {aName ? (
          <>
            <span style={{
              width: 16, height: 16, borderRadius: '50%', fontSize: 8, fontWeight: 700,
              background: AVATAR_COLORS[colorIndex % AVATAR_COLORS.length], color: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {userInitials(aName)}
            </span>
            {aName.split(' ')[0]}
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            </svg>
            Assign&hellip;
          </>
        )}
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, zIndex: 300,
          background: 'var(--surface)', border: '1px solid var(--rule)',
          borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          minWidth: 180, maxHeight: 220, overflowY: 'auto',
        }}>
          <button
            type="button"
            onClick={() => { onAssign(subtaskId, null); setOpen(false); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px',
              background: !assigneeUserId ? 'var(--side-active)' : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              borderBottom: '1px solid var(--rule-soft)',
            }}
          >
            <span style={{
              width: 26, height: 26, borderRadius: '50%', background: 'var(--rule-soft)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--ink-3)" strokeWidth="1.5">
                <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
              </svg>
            </span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>Unassigned</span>
            {!assigneeUserId && (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="var(--k-primary)" strokeWidth="2" style={{ marginLeft: 'auto' }}>
                <path d="M2 7l4 4 6-6" />
              </svg>
            )}
          </button>

          {assignableMembers.map((m, i) => {
            const uid      = m.user_id || m.member_id;
            const name     = m.display_name || m.full_name || m.name || '';
            const jobTitle = m.member_role || m.position || m.job_title || '';
            const checked  = assigneeUserId === uid;
            return (
              <button
                key={uid}
                type="button"
                onClick={() => { onAssign(subtaskId, uid); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
                  background: checked ? 'var(--side-active)' : 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderBottom: i < assignableMembers.length - 1 ? '1px solid var(--rule-soft)' : 'none',
                }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                  background: AVATAR_COLORS[i % AVATAR_COLORS.length], color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {userInitials(name)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
                  {jobTitle && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{jobTitle}</div>}
                </div>
                {checked && (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="var(--k-primary)" strokeWidth="2">
                    <path d="M2 7l4 4 6-6" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * DrawerSubtasks — subtask list with toggle/delete/assignee, plus add-subtask input.
 */
export default function DrawerSubtasks({
  task, members,
  newSubtask, setNewSubtask, addingSubtask,
  addSubtask, toggleSubtask, deleteSubtask, updateSubtaskAssignee,
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <span style={{ ...lbl, marginBottom: 10 }}>
        Subtasks
        {task.subtasks?.length > 0 && ` (${task.subtasks.filter(s => s.is_done).length}/${task.subtasks.length})`}
        {' '}
        <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', fontWeight: 400 }}>
          &#x0909;&#x092A;-&#x0915;&#x093E;&#x0930;&#x094D;&#x092F;
        </span>
      </span>

      {task.subtasks?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {task.subtasks.map((s, si) => {
            const assignedMember = members.find(m => (m.user_id || m.member_id) === s.assignee_user_id);
            const aName = assignedMember
              ? (assignedMember.display_name || assignedMember.full_name || assignedMember.name || '')
              : '';
            return (
              <div
                key={s.subtask_id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', background: 'var(--bg-soft)',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--rule)',
                }}
              >
                <button
                  onClick={() => toggleSubtask(s.subtask_id)}
                  style={{
                    width: 16, height: 16, borderRadius: 4,
                    border: `2px solid ${s.is_done ? 'var(--k-primary)' : 'var(--ink-3)'}`,
                    background: s.is_done ? 'var(--k-primary)' : 'transparent',
                    cursor: 'pointer', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  }}
                >
                  {s.is_done && <Check size={10} color="#fff" strokeWidth={3} />}
                </button>
                <span style={{
                  flex: 1, fontSize: 13,
                  color: s.is_done ? 'var(--ink-3)' : 'var(--ink)',
                  textDecoration: s.is_done ? 'line-through' : 'none',
                }}>
                  {s.title}
                </span>
                <SubtaskAssigneePicker
                  subtaskId={s.subtask_id}
                  assigneeUserId={s.assignee_user_id || null}
                  assignedMember={assignedMember}
                  aName={aName}
                  members={members}
                  onAssign={updateSubtaskAssignee}
                  colorIndex={si}
                />
                <button
                  onClick={() => deleteSubtask(s.subtask_id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0, display: 'flex', opacity: 0.6 }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newSubtask}
          onChange={e => setNewSubtask(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addSubtask()}
          placeholder="Add a subtask&hellip;"
          className="k-input"
          style={{ flex: 1, fontSize: 12 }}
        />
        <button
          onClick={addSubtask}
          disabled={addingSubtask || !newSubtask.trim()}
          className="k-btn k-btn--ghost k-btn--sm"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
