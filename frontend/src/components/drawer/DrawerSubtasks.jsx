import React from 'react';
import { Check, X } from 'lucide-react';
import Picker from '../ui/Picker';
import Lbl from './DrawerLabel';
import SubtaskProgress from './SubtaskProgress';

/**
 * DrawerSubtasks — the list, the progress meter, and the add row.
 *
 * The fourth hand-written picker lived here. Its panel opened UPWARD from a
 * hardcoded `bottom: calc(100% + 4px)` at a hardcoded `z-index: 300`, which
 * meant a subtask near the top of a scrolled drawer opened its assignee list
 * off the top of the screen — the placement was fixed for the row it was
 * written against, not for the row it is on. `ui/Picker.jsx` takes `up`/`right`
 * and shares one dismiss path, so Escape works, arrows work, and below 768px it
 * becomes a bottom sheet like every other picker.
 *
 * Everything else here was inline style objects. They are classes now (03 §5):
 * an inline object cannot be themed and does not respond to the density
 * setting.
 */
export default function DrawerSubtasks({
  task, members,
  newSubtask, setNewSubtask, addingSubtask,
  addSubtask, toggleSubtask, deleteSubtask, updateSubtaskAssignee,
}) {
  const subtasks = task.subtasks || [];
  const done = subtasks.filter(s => s.is_done).length;

  // The leading '' row is how a subtask gets UNASSIGNED again. Picker's
  // single-select path sets the value it was given rather than toggling, so
  // without an explicit row there is no way back to nobody — the old picker had
  // one and losing it would be a regression.
  const memberItems = [
    { id: '', name: 'Unassigned' },
    ...members
      .map(m => ({
        id: m.user_id || m.member_id,
        name: m.display_name || m.full_name || m.name || '',
        meta: m.member_role || m.position || m.job_title || '',
      }))
      .filter(m => m.id && m.name),
  ];

  return (
    <div className="dr__sec">
      <div className="dr__st-head">
        <Lbl hi="उप-कार्य">Subtasks</Lbl>
        <SubtaskProgress done={done} total={subtasks.length} />
      </div>

      {subtasks.length > 0 && (
        <div className="dr__st-list">
          {subtasks.map(s => (
            <div key={s.subtask_id} className={`dr__st${s.is_done ? ' done' : ''}`}>
              <button
                type="button"
                className={`dr__st-box${s.is_done ? ' on' : ''}`}
                aria-pressed={!!s.is_done}
                aria-label={s.is_done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
                onClick={() => toggleSubtask(s.subtask_id)}
              >
                {/* 10px at stroke-width 3 — at 10px a 2px stroke reads grey, not white. */}
                {s.is_done && <Check size={10} strokeWidth={3} />}
              </button>

              <span className="dr__st-t">{s.title}</span>

              {/* `option`, not `person`: the 22px pill has no room for the 19px
                  avatar Picker draws in person mode, and the leading
                  "Unassigned" row would render as a person called Unassigned.
                  The member rows still carry their job title as `meta`. */}
              <span className={`dr__st-as${s.assignee_user_id ? '' : ' dr__st-as--none'}`}>
                <Picker
                  mode="option" up right
                  ariaLabel={`Assignee for ${s.title}`}
                  placeholder="Assign…"
                  items={memberItems}
                  value={s.assignee_user_id || ''}
                  onChange={uid => updateSubtaskAssignee(s.subtask_id, uid || null)}
                />
              </span>

              <button
                type="button"
                className="dr__st-del"
                aria-label={`Delete subtask "${s.title}"`}
                onClick={() => deleteSubtask(s.subtask_id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="dr__st-add">
        <input
          className="inp"
          value={newSubtask}
          aria-label="New subtask"
          placeholder="Add a subtask…"
          onChange={e => setNewSubtask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
        />
        <button
          type="button"
          className="btn btn--out btn--sm"
          onClick={addSubtask}
          disabled={addingSubtask || !newSubtask.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}
