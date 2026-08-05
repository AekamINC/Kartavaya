// Srijan → Content. Everything the org has generated.
//
// Was a card grid: one card per item, the whole post body inside each one, no
// sort, no paging, a hard server-side ceiling of 100 rows. At 99 items that is
// about forty screens of scroll, and item 101 was simply unreachable.
//
// Now it is a table of records with the prose behind a click — see
// `../hub/ContentTable.jsx` for why the table and the pager have to agree about
// grouping, and why both content tabs render the same component.
import React, { useCallback, useState } from 'react';
import { Empty } from '../../components/editorial';
import { Resource, useList, useResource, AGENT_LABELS } from '../hub/_shared';
import {
  ContentTable, ContentDetail, Pager, GROUP_BYS, groupSort,
} from '../hub/ContentTable';

const PAGE = 25;

const STATUSES = [
  ['', 'All'],
  ['draft', 'Draft'],
  ['pending_review', 'Awaiting review'],
  ['approved', 'Approved'],
  ['published', 'Published'],
  ['rejected', 'Rejected'],
];

export default function ContentTab() {
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);

  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort, order });
  if (agent) qs.set('agent_type', agent);
  if (status) qs.set('status', status);

  const list = useList(`/v1/hub/org/content?${qs}`, [agent, status, sort, order, offset]);
  // Counted across the library, not across the page. The chips used to read
  // `items.filter(...).length`, which once the list pages is the size of the
  // current page — every chip showing the same number on every page.
  const facets = useResource('/v1/hub/org/content/facets', []);

  const total = list.data?.total ?? 0;
  const counts = facets.data?.facets ?? {};

  /* Any change to what is being listed returns to page one. Without this,
     narrowing a 99-item list to a 4-item one while on page 3 shows an empty
     table over a pager claiming there are 4 results — which reads as the filter
     being broken. */
  const pickAgent = useCallback(v => { setOffset(0); setAgent(v); }, []);
  const pickStatus = useCallback(v => { setOffset(0); setStatus(v); }, []);
  const clearFilters = useCallback(() => { setOffset(0); setAgent(''); setStatus(''); }, []);

  const onSort = useCallback(key => {
    setOffset(0);
    if (key === sort) {
      setOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      // Dates and money read newest/largest first; names read A–Z. Opening
      // every column ascending puts the oldest item at the top of a library
      // whose whole point is what was made recently.
      setOrder(key === 'created_at' || key === 'credits_used' ? 'desc' : 'asc');
    }
  }, [sort]);

  /* Grouping drives the sort. A group is only a real group if every member of
     it is on the same page as the others — see ContentTable's header. */
  const onGroup = useCallback(key => {
    setOffset(0);
    setGroupBy(key);
    const s = groupSort(key);
    if (s) { setSort(s); setOrder(s === 'created_at' ? 'desc' : 'asc'); }
  }, []);

  return (
    <div>
      <div className="hb-filters" role="group" aria-label="Filter by agent type">
        <button type="button" className={`hb-chip${agent === '' ? ' on' : ''}`}
          aria-pressed={agent === ''} onClick={() => pickAgent('')}>
          All
          {facets.data?.total != null && <span className="hb-chip__n">{facets.data.total}</span>}
        </button>
        {Object.entries(AGENT_LABELS).map(([k, l]) => (
          <button type="button" key={k} className={`hb-chip${agent === k ? ' on' : ''}`}
            aria-pressed={agent === k} onClick={() => pickAgent(k)}>
            {l}
            {counts.agent_type?.[k] != null && <span className="hb-chip__n">{counts.agent_type[k]}</span>}
          </button>
        ))}
      </div>

      <div className="sr-ct__bar">
        <label className="sr-ct__ctl">
          <span className="hb-cap">Status</span>
          <select className="k-select" value={status}
            onChange={e => pickStatus(e.target.value)}>
            {STATUSES.map(([v, l]) => (
              <option key={v || 'all'} value={v}>
                {l}{v && counts.status?.[v] != null ? ` (${counts.status[v]})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="sr-ct__ctl">
          <span className="hb-cap">Group by</span>
          <select className="k-select" value={groupBy}
            onChange={e => onGroup(e.target.value)}>
            {GROUP_BYS.map(g => <option key={g.key || 'none'} value={g.key}>{g.label}</option>)}
          </select>
        </label>

        {(agent || status) && (
          <button type="button" className="hb-linkbtn"
            onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <Resource
        state={list}
        what="Your content library"
        empty={agent || status ? (
          /* Filtered to nothing is not an empty library. The way out is the
             filter, not the Generate tab. */
          <p className="hb-none">
            Nothing matches that filter.{' '}
            <button type="button" className="hb-linkbtn"
              onClick={clearFilters}>
              Show everything
            </button>
          </p>
        ) : (
          <Empty
            icon="generic"
            title="Nothing generated yet"
            sub="Anything made on the Generate tab, or by a skill pack, is kept here."
          />
        )}
      >
        <>
          <ContentTable
            items={list.items || []}
            sort={sort} order={order} onSort={onSort}
            groupBy={groupBy}
            onOpen={setOpen}
          />
          <Pager total={total} limit={PAGE} offset={offset} onOffset={setOffset} />
        </>
      </Resource>

      {open && <ContentDetail item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
