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
import { AGENT_LABELS, StatusPill, stamp, shortStamp, words, creditLabel } from './_shared';

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

/** Sortable columns. `key` is what the API accepts — see hub.CONTENT_SORTS. */
export const SORT_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'agent_type', label: 'Agent' },
  { key: 'platform', label: 'Platform' },
  { key: 'status', label: 'Status' },
  { key: 'credits_used', label: 'Credits', align: 'right' },
  { key: 'created_at', label: 'Created', align: 'right' },
];

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

  const colCount = SORT_COLUMNS.length;

  return (
    <div className="tbl__wrap sr-ct__scroll">
      <table className="tbl sr-ct">
        <thead>
          <tr>
            {SORT_COLUMNS.map(col => {
              const on = sort === col.key;
              return (
                <th key={col.key} className={col.align === 'right' ? 'tbl__num' : undefined}
                  aria-sort={on ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={`sr-ct__sort${on ? ' is-on' : ''}`}
                    onClick={() => onSort(col.key)}
                    // Says what the click will DO, not what the state is — a
                    // screen reader already gets the state from aria-sort.
                    aria-label={`Sort by ${col.label}${on && order === 'asc' ? ', descending' : ', ascending'}`}>
                    {col.label}
                    <span aria-hidden="true" className="sr-ct__caret">
                      {on ? (order === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
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
                <td>
                  <button type="button" className="sr-ct__open" onClick={() => onOpen(item)}>
                    {item.title || 'Untitled'}
                  </button>
                  {/* One line of the body, so the table still reads as content
                      and not as a list of filenames. */}
                  <span className="sr-ct__peek">{(item.body || '').slice(0, 90)}</span>
                </td>
                <td>{AGENT_LABELS[item.agent_type] || words(item.agent_type) || '—'}</td>
                <td>{item.platform ? words(item.platform) : '—'}</td>
                <td><StatusPill status={item.status} /></td>
                <td className="tbl__num">
                  {item.credits_used != null ? creditLabel(item.credits_used) : '—'}
                </td>
                <td className="tbl__num">{shortStamp(item.created_at)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
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
