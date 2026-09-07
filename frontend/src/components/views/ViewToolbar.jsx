import React from 'react';
import { useLanguage } from '../CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../Bilingual';

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
/*
 * `viewLink` — the view switch is a real link when the caller has an address
 * for it.
 *
 * Board, Table, Calendar, Timeline, Workload and Priority are six ways to look
 * at the same project, and which one you are in is exactly the thing somebody
 * wants in a second tab — the board in one, the timeline in the other. Every
 * one of them was a `<button onClick={onView}>`, so there was no href for
 * ctrl-click, middle-click or "Open link in new tab" to act on.
 *
 * Optional, and `onView` still works alone: a caller that keeps the view in
 * component state gets exactly what it had. `ProjectBoardPage` and `BoardsPage`
 * pass `useUrlView(...).linkProps`, which carries the href, the plain-click
 * interception and the Space key together.
 */
export default function ViewToolbar({
  views = [],
  view,
  onView,
  viewLink,
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
  /*
      The seven view labels were English-only — the one control on a board a
      user touches every session, reading `Board List Calendar` in a product
      whose type system exists to set two scripts together.

      Read once and applied per view rather than a hook per button: `views` is
      seven today and a caller could pass a different number, and a hook inside
      `.map` changes in count when it does.

      `.bi__in` rather than a new class: it already exists, it already takes
      `--font-indic` (which repoints to Noto Sans Gujarati under EN+GU, and two
      of these seven have a Gujarati form), and a class with no CSS rule fails
      `check-classes`. The primary stays a bare text node so it keeps
      `.k-segctrl__btn`'s own 12.5px/600 rather than being restyled by
      `.bi__en`.
  */
  const lang = useLanguage();

  return (
    <div className="vtb">
      <div className="vtb__bar">
        {views.length > 0 && (
          <div className="vtb__scroll">
            <div className="k-segctrl" role="tablist" aria-label="View">
              {views.map(v => {
                const { secondary, script } = secondaryOf(v.k, lang);
                const cls = ['k-segctrl__btn', 'vtb__ico', view === v.id && 'is-active']
                  .filter(Boolean).join(' ');
                const inner = (
                  <>
                    {v.icon}
                    {v.label}
                    {/* aria-hidden: the same word in a second script is not more
                        information, and this control already announces its
                        English label and its selected state. */}
                    {secondary && <Secondary className="bi__in" value={secondary} script={script} />}
                  </>
                );
                /* An anchor only when the caller supplied an address. A
                   `<Link to="">` renders an `<a>` that goes nowhere, and a
                   view held in component state has nowhere to go — so the
                   button is the honest element there, not a fallback. */
                return viewLink ? (
                  <a key={v.id} {...viewLink(v.id)} role="tab"
                    aria-selected={view === v.id} className={cls}>
                    {inner}
                  </a>
                ) : (
                  <button key={v.id} type="button" role="tab"
                    aria-selected={view === v.id} className={cls}
                    onClick={() => onView?.(v.id)}>
                    {inner}
                  </button>
                );
              })}
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
