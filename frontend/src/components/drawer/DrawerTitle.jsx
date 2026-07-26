import React, { useRef } from 'react';

/**
 * DrawerTitle — inline edit, save on blur ONLY IF CHANGED, save indicator.
 *
 * Extracted from DrawerHeader so the header is a bar of controls and the title
 * is one behaviour in one place (03 §5: "Orchestration only").
 *
 * Three things kept from staging because they were right:
 *  · saves on blur, and only when the value actually changed — a blur that
 *    PATCHes an unchanged title writes an activity entry for nothing;
 *  · Enter commits (blur), Escape reverts to the stored title. Blur alone means
 *    a keyboard user has to Tab away to save, which MOTION-SPEC does not ask
 *    for;
 *  · the accessible name. The drawer's primary control had no label, no
 *    aria-label and no placeholder, so a screen reader announced it as "edit
 *    text" and nothing else.
 *
 * The `#last-6-of-task_id` monospace id sits beside it, unchanged.
 */
export default function DrawerTitle({ task, draft, setDraft, saveTask }) {
  const ref = useRef(null);

  if (!task) {
    return (
      <div className="dr__titlerow">
        <div className="dr__skel" style={{ width: '100%' }}>
          <i className="dr__skel-t" />
        </div>
      </div>
    );
  }

  const commit = () => {
    if (draft.title !== task.title) saveTask({ title: draft.title });
  };

  return (
    <div className="dr__titlerow">
      <input
        ref={ref}
        className="dr__title"
        aria-label="Task title"
        placeholder="Untitled task"
        value={draft.title || ''}
        onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') {
            e.stopPropagation();          // reverting a title must not also close the drawer
            setDraft(d => ({ ...d, title: task.title }));
            e.currentTarget.blur();
          }
        }}
        onBlur={commit}
      />
      <span className="dr__id">#{task.task_id?.slice(-6)}</span>
    </div>
  );
}
