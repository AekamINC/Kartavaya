import React from 'react';

/**
 * ViewToolbar — the one toolbar the six views share
 * (04-boards-table-views.md §2).
 *
 * Board, Table, Calendar, Timeline, Workload and Priority all need a view
 * switch, a search, a group control and a field toggle, and each had grown its
 * own. That is why the same board reads "Group by column" in one view and
 * "Column" in another, and why the view switcher is in a different place on two
 * of them.
 *
 * The segmented control is `.k-segctrl`, which already exists and already
 * carries the `.is-active` treatment — 26 §7: absorb a legacy class only while
 * you are editing that surface, and this one has a counterpart nowhere.
 *
 * Everything below the view switch is optional. A view that has no grouping
 * passes no `groups` and the control is not rendered, rather than rendered
 * disabled — a dead control is a question the user has to answer every time
 * they look at it.
 */
export default function ViewToolbar({
  views = [],
  view,
  onView,
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  groups,
  group,
  onGroup,
  groupLabel = 'Group by',
  count,
  countLabel = 'tasks',
  end,
  children,
}) {
  return (
    <div className="vtb">
      <div className="vtb__bar">
        {views.length > 0 && (
          <div className="vtb__scroll">
            <div className="k-segctrl" role="tablist" aria-label="View">
              {views.map(v => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  className={['k-segctrl__btn', 'vtb__ico', view === v.id && 'is-active'].filter(Boolean).join(' ')}
                  onClick={() => onView?.(v.id)}
                >
                  {v.icon}
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="vtb__end">
          {onSearch && (
            <div className="k-searchpill">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
              <input
                value={search ?? ''}
                onChange={e => onSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          )}

          {groups?.length > 0 && (
            <label className="vtb__group">
              <span className="vtb__lbl">{groupLabel}</span>
              {/* `.inp`, not `.k-input`: the legacy class hard-codes
                  `border-radius: 8px`, which 00 §3 forbids because it ignores
                  the Sharp/Pill setting, and takes its focus border from
                  `--k-primary` (an alias of `--primary-vivid`, a FILL). `.inp`
                  is the same object on `--r-sm` with the `--primary` focus
                  ring, and `select.inp` already carries the chevron. */}
              <select className="inp" value={group} onChange={e => onGroup?.(e.target.value)}>
                {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
          )}

          {end}

          {typeof count === 'number' && (
            <span className="vtb__count">{count} {countLabel}</span>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
