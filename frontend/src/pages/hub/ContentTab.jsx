// Hub → Content. Everything the AI has produced for this client, and the
// approve / reject decision on the ones still waiting.
//
// The original branched on `content.length === 0` after a `catch {}`, so a
// failed fetch printed "No content yet. Switch to the Generate tab to create
// content." — an instruction to create work that may already exist. The three
// states are separate now, and the filter row can say the list is filtered to
// nothing rather than empty.
//
// It also rendered a card per item with the whole post body inside, which at any
// real volume is an unreadable scroll. It renders the shared `ContentTable` now,
// exactly as the org-level tab does — see `./ContentTable.jsx` for why there is
// one component and not two. The review buttons are the only difference between
// the two callers, and they arrive as the `actions` prop.
import React, { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Resource, useList, useResource, errText, AGENT_LABELS } from './_shared';
import { ContentTable, ContentDetail, Pager, GROUP_BYS, groupSort } from './ContentTable';

const PAGE = 25;

const FILTERS = [
  ['', 'All'],
  ['draft', 'Draft'],
  ['pending_review', 'Awaiting review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['published', 'Published'],
];

export default function ContentTab({ clientId, onReviewed }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Sahayak content' });
  const { pushToast } = useToast();
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort, order });
  if (agent) qs.set('agent_type', agent);
  if (status) qs.set('status', status);

  const list = useList(
    clientId ? `/v1/hub/clients/${clientId}/content?${qs}` : null,
    [clientId, agent, status, sort, order, offset],
  );
  // Counted over this client's whole library, not over the page — a chip that
  // counted the page would read the same number on every page.
  const facets = useResource(
    clientId ? `/v1/hub/clients/${clientId}/content/facets` : null, [clientId],
  );

  const total = list.data?.total ?? 0;
  const counts = facets.data?.facets ?? {};

  /* Any change to what is listed returns to page one — otherwise narrowing a
     long list while on page 3 shows an empty table over a pager that still
     claims there are results. */
  const pickStatus = useCallback(v => { setOffset(0); setStatus(v); }, []);
  const pickAgent = useCallback(v => { setOffset(0); setAgent(v); }, []);
  const clearFilters = useCallback(() => { setOffset(0); setStatus(''); setAgent(''); }, []);

  const onSort = useCallback(key => {
    setOffset(0);
    if (key === sort) setOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setOrder(key === 'created_at' || key === 'credits_used' ? 'desc' : 'asc');
    }
  }, [sort]);

  const onGroup = useCallback(key => {
    setOffset(0);
    setGroupBy(key);
    const s = groupSort(key);
    if (s) { setSort(s); setOrder(s === 'created_at' ? 'desc' : 'asc'); }
  }, []);

  async function review(id, next) {
    setBusyId(id);
    try {
      await api.patch(`/v1/hub/clients/${clientId}/content/${id}/review`, { status: next });
      pushToast({ title: `Content ${next}`, type: 'success' });
      setOpen(null);
      list.reload();
      facets.reload();
      onReviewed?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Review failed.'), type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  /* Review lives in the detail view now. It used to sit on every card, which
     meant approving something you had not read was one click away and reading
     it first cost a scroll. Opening it is now the cheaper action. */
  const actions = useCallback(item => {
    if (item.status !== 'draft' && item.status !== 'pending_review') return null;
    return (
      <>
        <button type="button" className="k-btn k-btn--primary hb-btn--sm"
          disabled={busyId === item.id || !canWrite}
          onClick={() => review(item.id, 'approved')} title={denial || undefined}>
          {busyId === item.id ? 'Saving…' : 'Approve'}
        </button>
        <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
          disabled={busyId === item.id || !canWrite}
          onClick={() => review(item.id, 'rejected')} title={denial || undefined}>
          Reject
        </button>
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyId, canWrite, denial, clientId]);

  return (
    <div>
      {/* The filter row is rendered even while loading, so the control does not
          jump into place once the request lands. */}
      <div className="hb-filters" role="group" aria-label="Filter content by status">
        {FILTERS.map(([v, l]) => (
          <button key={v || 'all'} type="button"
            className={`hb-chip${status === v ? ' on' : ''}`}
            aria-pressed={status === v}
            onClick={() => pickStatus(v)}>
            {l}
            {v
              ? counts.status?.[v] != null && <span className="hb-chip__n">{counts.status[v]}</span>
              : facets.data?.total != null && <span className="hb-chip__n">{facets.data.total}</span>}
          </button>
        ))}
      </div>

      <div className="sr-ct__bar">
        <label className="sr-ct__ctl">
          <span className="hb-cap">Agent</span>
          <select className="k-select" value={agent} onChange={e => pickAgent(e.target.value)}>
            <option value="">All</option>
            {Object.entries(AGENT_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}{counts.agent_type?.[k] != null ? ` (${counts.agent_type[k]})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="sr-ct__ctl">
          <span className="hb-cap">Group by</span>
          <select className="k-select" value={groupBy} onChange={e => onGroup(e.target.value)}>
            {GROUP_BYS.map(g => <option key={g.key || 'none'} value={g.key}>{g.label}</option>)}
          </select>
        </label>

        {(agent || status) && (
          <button type="button" className="hb-linkbtn" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      <Resource
        state={list}
        what="This client’s content"
        empty={agent || status ? (
          /* Filtered to nothing is NOT the empty state. The library has items;
             this view of it does not. Saying "nothing generated yet" here would
             be false, and the way out is the filter, not the Generate tab. */
          <p className="hb-none">
            No content matches that filter.{' '}
            <button type="button" className="hb-linkbtn" onClick={clearFilters}>Show all</button>
          </p>
        ) : (
          <Empty
            icon="generic"
            title="Nothing generated yet"
            sub="Content made on the Generate tab, or by a skill pack, lands here as a draft for review."
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

      {open && <ContentDetail item={open} onClose={() => setOpen(null)} actions={actions} />}
    </div>
  );
}
