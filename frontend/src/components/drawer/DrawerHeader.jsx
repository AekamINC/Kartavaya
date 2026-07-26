import React from 'react';
import { Trash2, Archive, ArchiveRestore, X } from 'lucide-react';

/**
 * DrawerHeader — breadcrumb, the collapsed title, and the action bar
 * (save indicator · archive · delete · close).
 *
 * The static status badge that used to sit in the breadcrumb is gone: it is the
 * `StatusPipeline` below the header now (03 §5). It was the drawer's copy of a
 * status colour map that disagreed with the list's — a `done` task rendered
 * green here and teal in the task list, and `requested` was purple here and
 * amber there. One map, in `lib/statusColors.js`, drawn once.
 *
 * The scrolled-title collapse is kept, `max-width: 200px` and all: it is what
 * stops a long title pushing the header actions off the panel. It lives in
 * `.dr__crumb-t` rather than in an inline object.
 */
export default function DrawerHeader({
  task, draft, saving,
  canDeleteTask, deletingTask,
  onClose, onDeleteTask,
  onArchiveTask, onUnarchiveTask,
  scrolled,
}) {
  return (
    <div className="dr__head">
      <div className="dr__crumb">
        {task?.team_id && (
          <>
            <span className="dr__crumb-p">{task.team_name || 'Project'}</span>
            <span className="dr__crumb-sep" aria-hidden="true">/</span>
          </>
        )}
        {scrolled && task && <span className="dr__crumb-t">{draft.title}</span>}
      </div>

      <div className="dr__acts">
        {saving && <span className="dr__save" role="status">Saving&hellip;</span>}

        {task?.archived_at
          ? onUnarchiveTask && (
            <button type="button" className="dr__ico" onClick={onUnarchiveTask}
              aria-label="Restore task" title="Restore from archive">
              <ArchiveRestore size={14} />
            </button>
          )
          : onArchiveTask && task && (
            <button type="button" className="dr__ico" onClick={onArchiveTask}
              aria-label="Archive task" title="Archive task">
              <Archive size={14} />
            </button>
          )}

        {canDeleteTask && task && (
          <button type="button" className="dr__ico dr__ico--danger" onClick={onDeleteTask}
            disabled={deletingTask} aria-label="Delete task" title="Delete task">
            <Trash2 size={14} />
          </button>
        )}

        <button type="button" className="dr__ico" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
