import React from 'react';
import { Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { STATUS_LABELS } from './constants';
import { statusColor, mixAlpha } from '../../lib/statusColors';

/**
 * DrawerHeader — breadcrumb / status badge, title input, and action buttons
 * (save indicator, delete task, close).
 */
export default function DrawerHeader({
  task, draft, setDraft, saving,
  canDeleteTask, deletingTask,
  onClose, onDeleteTask, saveTask,
  onArchiveTask, onUnarchiveTask,
  scrolled,
}) {
  return (
    <>
      {/* Breadcrumb / header — always visible */}
      <div className="k-dr__head">
        <div className="k-dr__crumb">
          {task?.team_id && (
            <>
              <span style={{ color: 'var(--ink-3)' }}>{task.team_name || 'Project'}</span>
              <span style={{ color: 'var(--rule-strong)' }}>/</span>
            </>
          )}
          <span style={{ padding: '2px 7px', borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600, background: mixAlpha(statusColor(draft.status), 9), color: statusColor(draft.status) }}>
            {STATUS_LABELS[draft.status] || draft.status}
          </span>
          {/* Collapsed title shown in breadcrumb bar when scrolled */}
          {scrolled && task && (
            <span style={{
              marginLeft: 4,
              fontSize: 13, fontWeight: 600, color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 200,
            }}>
              {draft.title}
            </span>
          )}
        </div>
        <div className="k-dr__head-actions">
          {saving && (
            <span style={{ fontSize: 11, color: 'var(--ink-3)', marginRight: 6, alignSelf: 'center' }}>
              Saving&hellip;
            </span>
          )}
          {task?.archived_at ? (
            onUnarchiveTask && (
              <button
                onClick={onUnarchiveTask}
                className="k-iconbtn"
                aria-label="Restore task"
                title="Restore from archive"
                style={{ color: 'var(--ink-3)' }}
              >
                <ArchiveRestore size={14} />
              </button>
            )
          ) : (
            onArchiveTask && task && (
              <button
                onClick={onArchiveTask}
                className="k-iconbtn"
                aria-label="Archive task"
                title="Archive task"
                style={{ color: 'var(--ink-3)' }}
              >
                <Archive size={14} />
              </button>
            )
          )}
          {canDeleteTask && task && (
            <button
              onClick={onDeleteTask}
              disabled={deletingTask}
              className="k-iconbtn"
              aria-label="Delete task"
              title="Delete task"
              style={{ color: 'var(--k-danger)' }}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="k-iconbtn" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Title — collapses when scrolled.
          The input below is the drawer's primary control and had no accessible
          name — no label, no aria-label, no placeholder — so a screen reader
          announced it only as "edit text". Enter also did not commit, though
          MOTION-SPEC specifies onBlur|Enter; blur alone means a keyboard user
          has to Tab away to save. */}
      <div className="k-dr__title">
        {task ? (
          <input
            aria-label="Task title"
            value={draft.title || ''}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Escape') { setDraft(d => ({ ...d, title: task.title })); e.currentTarget.blur(); }
            }}
            onBlur={() => draft.title !== task.title && saveTask({ title: draft.title })}
            style={{
              width: '100%', border: 'none', outline: 'none',
              fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500,
              background: 'transparent', color: 'var(--ink)', padding: 0,
            }}
          />
        ) : (
          <div style={{ height: 28, background: 'var(--rule-soft)', borderRadius: 4, width: '65%' }} />
        )}
        {task && <div className="k-dr__id">#{task.task_id?.slice(-6)}</div>}
      </div>
    </>
  );
}
