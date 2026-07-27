import React from 'react';

import { Popover } from '../ui';
import ViewToolbar from './ViewToolbar';
import FilterBuilder from './FilterBuilder';
import { VIEWS } from './viewDefs';
import { GROUPS } from './useBoardView';

/**
 * BoardToolbar — one bar, seven views (04 §2).
 *
 * `ViewToolbar` is the shell; this is the shell filled in the one way both
 * board routes should fill it. It exists because `BoardsPage` and
 * `ProjectBoardPage` render the same seven views over the same task set, and
 * every time the two assembled the toolbar themselves they drifted — the last
 * round left `/boards` with no Archived toggle and no search at all.
 *
 * **What is on the bar in every view, and what is not.** Search and filter
 * narrow *which tasks* you are looking at, so they apply to Board, Calendar,
 * Timeline, Workload, Priority and My Tasks exactly as much as they apply to
 * the table, and they are always present. Group-by and field visibility are
 * about *how the table draws rows and columns* — a Calendar has no rows to
 * group and no columns to hide — so they appear only in Table view. A control
 * that cannot do anything is not rendered rather than rendered disabled: a dead
 * control is a question the user answers again every time they look at it.
 *
 * State lives in `useBoardView`, so the page can pass the same filtered task
 * set to whichever view is showing.
 */
export default function BoardToolbar({ view, onView, board, end }) {
  const isTable = view === 'table';

  return (
    <ViewToolbar
      views={VIEWS}
      view={view}
      onView={onView}
      search={board.search}
      onSearch={board.setSearch}
      searchPlaceholder="Search tasks…"
      groups={isTable ? GROUPS : undefined}
      group={board.groupBy}
      onGroup={board.setGroupBy}
      count={board.filtered.length}
      end={
        <>
          {isTable && board.defs.length > 0 && (
            <Popover
              label="Column visibility"
              align="right"
              trigger={
                <span className="btn btn--out btn--sm">
                  Fields{board.hidden.size > 0 ? ` · ${board.defs.length - board.hidden.size}/${board.defs.length}` : ''}
                </span>
              }
            >
              {/* The whole row is the control, not a 17px box beside a label.
                  `role="checkbox"` with `aria-checked` on the row is the shape
                  `Picker`'s multi mode uses, so the two read identically to a
                  screen reader. */}
              <div className="tb__fields">
                {board.defs.map(f => {
                  const on = !board.hidden.has(f.field_id);
                  return (
                    <button
                      key={f.field_id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className="tb__field"
                      onClick={() => board.toggleField(f.field_id)}
                    >
                      <span className={on ? 'cbx on' : 'cbx'} aria-hidden="true">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                      {f.name}
                    </button>
                  );
                })}
              </div>
            </Popover>
          )}
          {end}
        </>
      }
    >
      <FilterBuilder fields={board.fields} clauses={board.clauses} onChange={board.setClauses} />
    </ViewToolbar>
  );
}
