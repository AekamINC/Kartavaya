// Graha · dedupe — duplicate contact groups and the merge ledger.
//
// 47 inline styles are now `gr__*` classes.
//
// ── The defect this tab had ────────────────────────────────────────────────
// Both loads were `catch { toast }` with no error state, so a failed fetch fell
// through to `groups.length === 0` and painted a green tick over "No duplicates
// found — all contacts have unique email and phone values". That is a specific,
// checkable claim about the customer's data, asserted on the strength of a
// request that failed. The merge history did the same with "No merges yet".
// Both panels now carry their own error state and retry, and they are
// independent: the history failing must not hide the duplicates.
//
// The group header was a `<div onClick>` that expands a panel; it is a
// `<button aria-expanded>` now, so it is reachable by keyboard and announces
// its state.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { Badge, TYPE_COLORS, SOURCE_COLORS } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'contact_type', label: 'Type' },
  { key: 'source', label: 'Source' },
  { key: 'lead_score', label: 'Score' },
];

export default function DedupeTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'merge contacts' });
  const { pushToast } = useToast();
  const [groups, setGroups] = useState([]);
  const [merges, setMerges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergesLoading, setMergesLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [mergesErr, setMergesErr] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [survivors, setSurvivors] = useState({});
  const [merging, setMerging] = useState(false);
  const [undoing, setUndoing] = useState(null);

  useEffect(() => { loadGroups(); loadMerges(); }, []);

  async function loadGroups() {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get('/v1/graha/contacts/duplicates');
      setGroups(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load duplicate groups', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function loadMerges() {
    setMergesLoading(true);
    setMergesErr(null);
    try {
      const r = await api.get('/v1/graha/contacts/merges');
      setMerges(rows(r));
    } catch (e) {
      setMergesErr(e);
      pushToast({ title: 'Failed to load merge history', type: 'error' });
    }
    finally { setMergesLoading(false); }
  }

  function selectSurvivor(groupIdx, contactId) {
    setSurvivors(prev => ({ ...prev, [groupIdx]: contactId }));
  }

  async function doMerge(groupIdx) {
    const group = groups[groupIdx];
    const survivorId = survivors[groupIdx];
    if (!survivorId) { pushToast({ title: 'Select a contact to keep first', type: 'error' }); return; }
    const mergeIds = group.contacts.filter(c => c.id !== survivorId).map(c => c.id);
    if (mergeIds.length === 0) return;
    setMerging(true);
    try {
      await api.post(`/v1/graha/contacts/${survivorId}/merge`, { merge_ids: mergeIds });
      pushToast({ title: 'Contacts merged successfully', type: 'success' });
      setExpandedIdx(null);
      setSurvivors(prev => { const n = { ...prev }; delete n[groupIdx]; return n; });
      loadGroups();
      loadMerges();
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Merge failed', type: 'error' }); }
    finally { setMerging(false); }
  }

  async function undoMerge(mergeId) {
    setUndoing(mergeId);
    try {
      await api.post(`/v1/graha/contacts/merges/${mergeId}/undo`);
      pushToast({ title: 'Merge undone', type: 'success' });
      setExpandedIdx(null);
      setSurvivors({});
      loadGroups();
      loadMerges();
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Undo failed', type: 'error' }); }
    finally { setUndoing(null); }
  }

  return (
    <div>
      <h3 className="gr__st--lg">Dedupe Review <Secondary  value="(द्वैतनिवारण)" /></h3>
      <p className="gr__lede">
        Contacts sharing the same email or phone are grouped below. Select the record to keep and merge the rest.
      </p>

      {loading ? (
        <SkeletonRegion label="Loading duplicates"><SkeletonList rows={4} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={loadGroups} />
      ) : groups.length === 0 ? (
        <EmptyState
          illustration="generic"
          tone="ok"
          title={{ en: 'No duplicates found', hi: 'कोई द्वैत नहीं' }}
          description="Every contact has a unique email and phone value."
        />
      ) : (
        <div className="gr__dd">
          {groups.map((g, gi) => {
            const expanded = expandedIdx === gi;
            const survivorId = survivors[gi];
            return (
              <div key={`${g.match_type}-${g.match_key}`} className="gr__ddg">
                <button
                  type="button"
                  className="gr__ddhead"
                  aria-expanded={expanded}
                  onClick={() => setExpandedIdx(expanded ? null : gi)}
                >
                  <span className="gr__ddcaret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <Badge text={g.match_type} color={g.match_type === 'email' ? 'var(--st-in-progress)' : 'var(--ok)'} />
                  <span className="gr__ddkey">{g.match_key}</span>
                  <span className="gr__count gr__count--warn">{g.count} contacts</span>
                </button>

                {expanded && (
                  <div className="gr__ddbody">
                    <p className="gr__lede">
                      Select the record to keep (survivor). All others will be merged into it.
                    </p>
                    <div className="tbl__wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Keep</th>
                            {FIELDS.map(f => <th key={f.key}>{f.label}</th>)}
                            <th>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.contacts.map(c => {
                            const selected = survivorId === c.id;
                            return (
                              <tr
                                key={c.id}
                                className={`gr__tr--click${selected ? ' on' : ''}`}
                                onClick={() => selectSurvivor(gi, c.id)}
                              >
                                <td className="gr__td--mid">
                                  <input
                                    type="radio"
                                    name={`survivor-${gi}`}
                                    checked={selected}
                                    aria-label={`Keep ${c.name || c.email || c.phone}`}
                                    onChange={() => selectSurvivor(gi, c.id)}
                                  />
                                </td>
                                {FIELDS.map(f => (
                                  <td key={f.key} className="gr__td--mute">
                                    {f.key === 'contact_type' && c[f.key]
                                      ? <Badge text={c[f.key]} color={TYPE_COLORS[c[f.key]] || 'var(--on-surface-3)'} />
                                      : f.key === 'source' && c[f.key]
                                        ? <Badge text={c[f.key]} color={SOURCE_COLORS[c[f.key]] || 'var(--on-surface-3)'} />
                                        : (c[f.key] ?? '—')}
                                  </td>
                                ))}
                                <td className="gr__td--when">
                                  {c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="gr__acts">
                      <button className="k-btn k-btn--ghost" onClick={() => setExpandedIdx(null)}>Cancel</button>
                      <button className="k-btn k-btn--primary" disabled={!survivorId || merging || !canWrite} onClick={() => doMerge(gi)} title={denial || undefined}>
                        {merging ? 'Merging…' : `Merge ${g.count - 1} into survivor`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="gr__stack">
        <h3 className="gr__st--lg">Recent Merges <Secondary  value="(विलय इतिहास)" /></h3>
        <p className="gr__lede">Previously merged contacts. Undo is available for recent merges.</p>

        {mergesLoading ? (
          <SkeletonRegion label="Loading merge history"><SkeletonList rows={3} /></SkeletonRegion>
        ) : mergesErr ? (
          <ErrorState kind={errorKind(mergesErr)} onRetry={loadMerges} />
        ) : merges.length === 0 ? (
          <p className="gr__quiet">No merges yet.</p>
        ) : (
          <div className="tbl__wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Survivor</th>
                  <th>Merged Contact</th>
                  <th>Rows Moved</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {merges.map(m => (
                  <tr key={m.id}>
                    <td className="gr__td--name">{m.survivor_name}</td>
                    <td className="gr__td--mute">{m.merged_name}</td>
                    <td className="gr__td--mute">{m.moved_rows ?? '—'}</td>
                    <td className="gr__td--when">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td>
                      {m.undone_at
                        ? <Badge text="Undone" color="var(--on-surface-3)" />
                        : <Badge text="Merged" color="var(--ok)" />}
                    </td>
                    <td>
                      {!m.undone_at && (
                        <button className="k-btn k-btn--ghost" disabled={undoing === m.id} onClick={() => undoMerge(m.id)}>
                          {undoing === m.id ? 'Undoing…' : 'Undo'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
