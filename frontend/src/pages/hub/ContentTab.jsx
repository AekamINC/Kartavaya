// Hub → Content. Everything the AI has produced for this client, and the
// approve / reject decision on the ones still waiting.
//
// The original branched on `content.length === 0` after a `catch {}`, so a
// failed fetch printed "No content yet. Switch to the Generate tab to create
// content." — an instruction to create work that may already exist. Now the
// three states are separate, and the filter row can say the list is filtered to
// nothing rather than empty.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import {
  AGENT_LABELS, Resource, StatusPill, useList, errText, shortStamp, words,
} from './_shared';

const FILTERS = [
  ['', 'All'],
  ['draft', 'Draft'],
  ['pending_review', 'Awaiting review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['published', 'Published'],
];

export default function ContentTab({ clientId, onReviewed }) {
  const { pushToast } = useToast();
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);
  const list = useList(clientId ? `/v1/hub/clients/${clientId}/content` : null, [clientId]);

  const all = list.items;
  const shown = all ? (status ? all.filter(c => c.status === status) : all) : null;

  async function review(id, next) {
    setBusyId(id);
    try {
      await api.patch(`/v1/hub/clients/${clientId}/content/${id}/review`, { status: next });
      pushToast({ title: `Content ${next}`, type: 'success' });
      list.reload();
      onReviewed?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Review failed.'), type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* The filter row is rendered even while loading, so the control does not
          jump into place once the request lands. */}
      <div className="hb-filters" role="group" aria-label="Filter content by status">
        {FILTERS.map(([v, l]) => (
          <button key={v || 'all'} type="button"
            className={`hb-chip${status === v ? ' on' : ''}`}
            aria-pressed={status === v}
            onClick={() => setStatus(v)}>
            {l}
            {all && v && <span className="hb-chip__n">{all.filter(c => c.status === v).length}</span>}
          </button>
        ))}
      </div>

      <Resource
        state={list}
        what="This client’s content"
        empty={<Empty
          icon="generic"
          title="Nothing generated yet"
          sub="Content made on the Generate tab, or by a skill pack, lands here as a draft for review."
        />}
      >
        {shown?.length === 0 ? (
          /* Filtered to nothing is NOT the empty state. The library has items;
             this view of it does not. Saying "nothing generated yet" here would
             be false, and the way out is the filter, not the Generate tab. */
          <p className="hb-none">
            No content with that status. <button type="button" className="hb-linkbtn" onClick={() => setStatus('')}>Show all {all?.length}</button>
          </p>
        ) : (
          <div className="hb-list">
            {shown?.map(item => (
              <article className="hb-card hb-item" key={item.id}>
                <div className="hb-item__head">
                  <div className="hb-item__id">
                    <b className="hb-item__t">{item.title || 'Untitled'}</b>
                    <span className="hb-cap">
                      {AGENT_LABELS[item.agent_type] || words(item.agent_type)}
                      {item.platform && <> · {item.platform}</>}
                      {item.created_at && <> · {shortStamp(item.created_at)}</>}
                    </span>
                  </div>
                  <StatusPill status={item.status} />
                </div>

                <p className="hb-item__body">{item.body}</p>

                {item.hashtags?.length > 0 && (
                  <div className="hb-tags">
                    {item.hashtags.slice(0, 10).map((t, i) => <span className="hb-tag" key={i}>{t}</span>)}
                  </div>
                )}

                <div className="hb-item__foot">
                  <span className="hb-cap hb-mono">
                    {item.credits_used != null ? `${item.credits_used} credits` : ''}
                  </span>
                  {(item.status === 'draft' || item.status === 'pending_review') && (
                    <span className="hb-item__act">
                      <button type="button" className="k-btn k-btn--primary hb-btn--sm"
                        disabled={busyId === item.id} onClick={() => review(item.id, 'approved')}>
                        {busyId === item.id ? 'Saving…' : 'Approve'}
                      </button>
                      <button type="button" className="k-btn k-btn--ghost hb-btn--sm hb-btn--danger"
                        disabled={busyId === item.id} onClick={() => review(item.id, 'rejected')}>
                        Reject
                      </button>
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Resource>
    </div>
  );
}
