// The generated-content library, as a table.
//
// ── What this replaces ───────────────────────────────────────────────────────
//
// Both content tabs rendered a card per item with the full post body inside it.
// At 99 items that is one column roughly forty screens long, with no way to sort
// it, no way to page it and no way to see two items side by side — the owner's
// report was "very messy right now... it becoming every scrooling".
//
// A generated post is a RECORD (when, which agent, which platform, what state,
// what it cost) that happens to contain prose. The record belongs in a table;
// the prose belongs behind a click. That is the whole change.
//
// ── Why one component and not two ────────────────────────────────────────────
//
// `_shared.jsx`'s own header documents what happened last time the two Sahayak
// content views were separate files: they drifted, and the client-portal view
// silently lost features the org view had. Both tabs render THIS, so the drift
// cannot recur. The per-client tab passes `actions` to add approve/reject; that
// is the only difference between them.
//
// ── Grouping and paging have to agree ────────────────────────────────────────
//
// Grouping is computed on the rows currently loaded. If the server ordered by
// date while the table grouped by status, a "group" would be no more than the
// part of that status that happened to land on this page, and the same group
// would reappear with different members on the next one. So choosing a group-by
// also sets the sort column — `groupSort()` below is that rule, and it is why
// the group header can honestly print a count.
import React, { useMemo, useState } from 'react';
import Modal from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import RichText from '../sahayak/RichText';
import PlatformPreview from '../sahayak/PlatformPreview';
import ImagePanel from '../sahayak/ImagePanel';
import { imageBriefOf } from '../sahayak/_shared';
import { AGENT_LABELS, StatusPill, stamp, words, creditLabel } from './_shared';
// The audit columns are the SHARED ones, not a local copy: `CreatedCell`,
// `UpdatedCell` and `ByCell` each render `ui/Table`'s `<Cell>`, and `<Cell>` IS
// a `<td>` — so they drop into this hand-written `<tr>` exactly as they drop
// into the `<Table>`-based tables. Only the HEADER could not be reused: every
// other table's header is `ui/Table`'s `<HeadCell>`, which sorts through
// `{key, dir}` state, while this table sorts SERVER-side through `sort`/`order`
// strings and renders its own button. So the headers stay local and the cells
// are shared, which is the half that carries the two absence rules.
import {
  CreatedCell, UpdatedCell, ByCell,
} from '../../components/ui/CreatedColumn';
// `ColumnResizer`, not `HeadCell` — see CONTENT_COLUMNS below for why this one
// table keeps its own headers and borrows only the divider.
import { ColumnResizer } from '../../components/ui/Table';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

/**
 * The columns. `key` is what the API accepts — see hub.CONTENT_SORTS.
 *
 * `sortable: false` is not a style choice. This table asks the SERVER to sort
 * (`?sort=&order=`), and `hub.CONTENT_SORTS` is a six-key allowlist that
 * answers anything else with a 400 — so a sort button on `updated_at` or
 * `created_by_name` would be a control whose only outcome is an error toast.
 * The columns are still worth showing; the header simply does not promise an
 * order it cannot deliver. Adding the three keys to `CONTENT_SORTS` (and to
 * `_content_order`, which must qualify them with the `ci.` alias, and where
 * `created_by_name` is a JOINed expression rather than a column on `ci`) is the
 * backend change that would let these headers become buttons.
 *
 * `created_at` loses its `align: 'right'` here: it is now rendered by
 * `CreatedCell`, whose `.tbl__created` already carries the tabular figures and
 * the nowrap that the right-alignment was standing in for, and a right-aligned
 * header over a left-aligned cell is the mismatch that alignment causes.
 */
export const SORT_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'agent_type', label: 'Agent' },
  { key: 'platform', label: 'Platform' },
  { key: 'status', label: 'Status' },
  { key: 'credits_used', label: 'Credits', align: 'right' },
  { key: 'created_at', label: 'Created' },
  { key: 'created_by_name', label: 'Created by', sortable: false },
  { key: 'updated_at', label: 'Updated', sortable: false },
  { key: 'updated_by_name', label: 'Updated by', sortable: false },
];

/**
 * The same nine columns, in the shape `useColumnPrefs` reconciles against —
 * DERIVED from SORT_COLUMNS rather than restated, so the sort allowlist and the
 * arrangement cannot disagree about what this table has.
 *
 * This is the one table in the batch that keeps its OWN header markup. Every
 * other one renders `<HeadCell>`, which sorts through `{key, dir}` client state;
 * this table asks the SERVER to sort through `?sort=&order=` and renders a
 * button that reflects that contract, including the deliberate plain `<th>` for
 * the three keys `hub.CONTENT_SORTS` will not accept. Swapping in `HeadCell`
 * would either lose that distinction or reorder the header's focus ring, so the
 * headers stay local and only the DIVIDER is borrowed — `ColumnResizer` is the
 * audited keyboard-resizable control, and a second implementation of it here
 * would be a second answer to "how do I widen a column with the keyboard".
 *
 * `fixed` on Title: it is the row's identity AND the button that opens the
 * post, so hiding it would leave a library whose contents cannot be read.
 * Nothing else is load-bearing — the four audit columns in particular are
 * exactly what a firm that does not care who generated a post wants gone.
 */
const CONTENT_COLUMNS = SORT_COLUMNS.map(c => ({
  id: c.key,
  label: c.label,
  fixed: c.key === 'title',
  // Carried through so the header renderer below still knows both facts.
  align: c.align,
  sortable: c.sortable,
}));

export const GROUP_BYS = [
  { key: '', label: 'No grouping' },
  { key: 'agent_type', label: 'Agent' },
  { key: 'status', label: 'Status' },
  { key: 'platform', label: 'Platform' },
  { key: 'month', label: 'Month' },
];

/**
 * The sort a given grouping implies.
 *
 * Grouping by month groups on `created_at` — the month is derived from it, so
 * ordering by the date puts every month contiguous without the API needing to
 * know what a month is.
 */
export function groupSort(groupBy) {
  if (!groupBy) return null;
  return groupBy === 'month' ? 'created_at' : groupBy;
}

function groupValue(item, groupBy) {
  if (groupBy === 'month') {
    if (!item.created_at) return 'No date';
    const d = new Date(item.created_at);
    if (Number.isNaN(d.getTime())) return 'No date';
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  const raw = item[groupBy];
  if (!raw) return 'Unassigned';
  return groupBy === 'agent_type' ? (AGENT_LABELS[raw] || words(raw)) : words(raw);
}

/* ── Table ───────────────────────────────────────────────────────────────── */

export function ContentTable({ items, sort, order, onSort, groupBy, onOpen }) {
  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '', items }];
    const out = [];
    let current = null;
    for (const item of items) {
      const key = groupValue(item, groupBy);
      if (!current || current.key !== key) {
        current = { key, items: [] };
        out.push(current);
      }
      current.items.push(item);
    }
    return out;
  }, [items, groupBy]);

  const cols = useColumnPrefs('hub.content', CONTENT_COLUMNS);

  // The group header's colSpan follows what is on screen. A literal nine would
  // leave the group title short of the table the moment a user hid a column,
  // and this header is the thing that makes the count above it believable.
  const colCount = cols.columns.length;

  return (
    <>
    {/* This component is dropped bare into two different tabs and has no
        TableToolbar of its own, so the control gets the house trailing-aligned
        unframed row. */}
    <div className="tbl__abar"><ColumnsButton cols={cols} /></div>
    <div className="tbl__wrap sr-ct__scroll">
      <table className="tbl sr-ct">
        <thead>
          <tr>
            {cols.columns.map(col => {
              const on = sort === col.id;
              const cls = col.align === 'right' ? 'tbl__num tbl__th--rz' : 'tbl__th--rz';
              const style = col.width ? { width: `${col.width}px` } : undefined;
              const grip = (
                <ColumnResizer label={col.label} width={col.width}
                  onCommit={w => cols.setWidth(col.id, w)} />
              );
              // A column the server will not order by is a plain <th>. Not a
              // disabled button: a disabled control still says "this sorts, but
              // not now", and these never sort.
              //
              // `aria-sort="none"` is stated rather than left off, and the
              // first draft here left it off. A table's sort state is read by
              // ABSENCE elsewhere — `contentTable.test.jsx` asserts that
              // exactly one `<th>` is not "none", which is how it catches two
              // columns claiming to be the sorted one — and a header with no
              // attribute at all is indistinguishable from a marked one to that
              // reading. Saying "none" makes the unsorted case explicit for the
              // same reason the sortable headers say it.
              if (col.sortable === false) {
                return (
                  <th key={col.id} className={cls} style={style} aria-sort="none">
                    {col.label}
                    {grip}
                  </th>
                );
              }
              return (
                <th key={col.id} className={cls} style={style}
                  aria-sort={on ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={`sr-ct__sort${on ? ' is-on' : ''}`}
                    onClick={() => onSort(col.id)}
                    // Says what the click will DO, not what the state is — a
                    // screen reader already gets the state from aria-sort.
                    aria-label={`Sort by ${col.label}${on && order === 'asc' ? ', descending' : ', ascending'}`}>
                    {col.label}
                    <span aria-hidden="true" className="sr-ct__caret">
                      {on ? (order === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                  {/* After the sort button, exactly as `HeadCell` places it, so
                      the header's focus order is unchanged. */}
                  {grip}
                </th>
              );
            })}
          </tr>
        </thead>

        {groups.map(group => (
          <tbody key={group.key || 'all'}>
            {groupBy && (
              <tr className="sr-ct__grp">
                <th scope="colgroup" colSpan={colCount}>
                  {group.key}
                  <span className="sr-ct__grpn">{group.items.length}</span>
                </th>
              </tr>
            )}
            {group.items.map(item => (
              <tr key={item.id}>
                {cols.cells({
                  title: (
                    <td>
                      <button type="button" className="sr-ct__open" onClick={() => onOpen(item)}>
                        {item.title || 'Untitled'}
                      </button>
                      {/* One line of the body, so the table still reads as
                          content and not as a list of filenames. */}
                      <span className="sr-ct__peek">{(item.body || '').slice(0, 90)}</span>
                    </td>
                  ),
                  agent_type: <td>{AGENT_LABELS[item.agent_type] || words(item.agent_type) || '—'}</td>,
                  platform: <td>{item.platform ? words(item.platform) : '—'}</td>,
                  status: <td><StatusPill status={item.status} /></td>,
                  credits_used: (
                    <td className="tbl__num">
                      {item.credits_used != null ? creditLabel(item.credits_used) : '—'}
                    </td>
                  ),
                  /* `hasActor` is passed on both name cells and is not
                     decoration: without it a post whose author's account has
                     since been deleted renders the same em dash as a post with
                     no author recorded at all, and "we can no longer say who"
                     is not "nobody did this". */
                  created_at: <CreatedCell value={item.created_at} />,
                  created_by_name: <ByCell name={item.created_by_name} hasActor={item.has_creator} />,
                  updated_at: <UpdatedCell value={item.updated_at} />,
                  updated_by_name: <ByCell name={item.updated_by_name} hasActor={item.has_updater} />,
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
    </>
  );
}

/* ── Pager ───────────────────────────────────────────────────────────────── */

export function Pager({ total, limit, offset, onOffset }) {
  if (!total) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="sr-ct__pager">
      <span className="hb-cap">
        {from}–{to} of {total}
      </span>
      <span className="sr-ct__pagerb">
        <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
          disabled={offset <= 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          Previous
        </button>
        <span className="hb-cap hb-mono">{page} / {pages}</span>
        <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
          disabled={to >= total} onClick={() => onOffset(offset + limit)}>
          Next
        </button>
      </span>
    </div>
  );
}

/* ── Detail ──────────────────────────────────────────────────────────────── */

/**
 * One item, opened.
 *
 * This is where the full body, the image and the hashtags live now. The card
 * grid put all three inline for every row at once, which is what made the tab
 * scroll forever; here they cost nothing until asked for.
 */
export function ContentDetail({ item, onClose, actions }) {
  const { pushToast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  function copySource() {
    navigator.clipboard?.writeText(item.body || '');
    setCopied(true);
    pushToast({ title: 'Copied as Markdown', message: 'The source, for a CMS or a ticket.', type: 'success' });
  }

  return (
    <Modal open onOpenChange={v => { if (!v) onClose(); }} size="lg"
      title={item.title || 'Untitled'} dataTestId="sahayak-content-detail">
      <div className="sr-cd">
        <div className="sr-cd__meta">
          <span className="hb-tag">{AGENT_LABELS[item.agent_type] || words(item.agent_type)}</span>
          {item.platform && <span className="hb-tag">{words(item.platform)}</span>}
          <StatusPill status={item.status} />
          <span className="hb-cap hb-mono">{stamp(item.created_at)}</span>
          {item.credits_used != null && (
            <span className="hb-cap hb-mono">{creditLabel(item.credits_used)}</span>
          )}
        </div>

        {/* Both halves come from `../sahayak`, which is the direction this file
            already runs in — the org and the client tabs live there and render
            THIS component so the two cannot drift apart again. A post read here
            and the same post read on the Generate tab have to look identical;
            two renderers is how the client view lost features last time. */}
        {/* `imageBriefOf`, not `item.image_prompt` — there is no such column.
            `hub_content_items` carries the built brief inside its existing
            `metadata` jsonb (the schema is owner-gated: staging and production
            share one database), and `list_org_content` selects `*`, so the
            brief was arriving on every row and being read from a key that does
            not exist. Every generated image in the library therefore reported
            "This run did not report the brief it built", including ones
            generated after the brief started being stored. */}
        {item.image_url && (
          <ImagePanel image={{ url: item.image_url }}
            prompt={imageBriefOf(item)}
            alt={item.title || 'The generated visual for this post'} />
        )}

        {/* Was `<p style=pre-wrap>{item.body}</p>` — a generated blog post shown
            with its `##`, `**` and `- ` as literal characters, which is the one
            form in which the structure about to be published cannot be judged. */}
        <RichText text={item.body} />

        {item.hashtags?.length > 0 && (
          <div className="hb-tags">
            {item.hashtags.map((t, i) => <span className="hb-tag" key={i}>{t}</span>)}
          </div>
        )}

        {/* The tags go to the preview as well as to the chips above, because the
            publish path appends them to the body and this is the screen the
            Approve button sits under. Chips are the record; the preview is the
            post. */}
        <PlatformPreview markdown={item.body} platform={item.platform}
          served={item.formatted} tags={item.hashtags} />

        <div className="sr-cd__act">
          {/* The per-platform copies live in the preview above. This one is the
              markdown source, which no platform wants and a CMS does. */}
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm" onClick={copySource}>
            {copied ? 'Copied' : 'Markdown source'}
          </button>
          {actions?.(item)}
        </div>
      </div>
    </Modal>
  );
}
