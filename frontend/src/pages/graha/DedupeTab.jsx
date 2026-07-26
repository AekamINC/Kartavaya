import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, TYPE_COLORS, SOURCE_COLORS } from './_shared';

export default function DedupeTab() {
  const { pushToast } = useToast();
  const [groups, setGroups] = useState([]);
  const [merges, setMerges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergesLoading, setMergesLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [survivors, setSurvivors] = useState({});
  const [merging, setMerging] = useState(false);
  const [undoing, setUndoing] = useState(null);

  useEffect(() => { loadGroups(); loadMerges(); }, []);

  async function loadGroups() {
    setLoading(true);
    try {
      const r = await api.get('/v1/graha/contacts/duplicates');
      setGroups(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load duplicate groups', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadMerges() {
    setMergesLoading(true);
    try {
      const r = await api.get('/v1/graha/contacts/merges');
      setMerges(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load merge history', type: 'error' }); }
    finally { setMergesLoading(false); }
  }

  function selectSurvivor(groupIdx, contactId) {
    setSurvivors(prev => ({ ...prev, [groupIdx]: contactId }));
  }

  async function doMerge(groupIdx) {
    const group = groups[groupIdx];
    const survivorId = survivors[groupIdx];
    if (!survivorId) return pushToast({ title: 'Select a contact to keep first', type: 'error' });
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
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Merge failed', type: 'error' }); }
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
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Undo failed', type: 'error' }); }
    finally { setUndoing(null); }
  }

  const FIELDS = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'company', label: 'Company' },
    { key: 'contact_type', label: 'Type' },
    { key: 'source', label: 'Source' },
    { key: 'lead_score', label: 'Score' },
  ];

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Dedupe Review (द्वैतनिवारण)</h3>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16 }}>
        Contacts sharing the same email or phone are grouped below. Select the record to keep and merge the rest.
      </p>

      {/* Duplicate Groups */}
      {loading ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading duplicates...</p>
      ) : groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No duplicates found</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>All contacts have unique email and phone values.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {groups.map((g, gi) => {
            const expanded = expandedIdx === gi;
            const survivorId = survivors[gi];
            return (
              <div key={`${g.match_type}-${g.match_key}`}
                style={{ border: '1px solid var(--rule-soft)', borderRadius: 10, overflow: 'hidden' }}>
                {/* Group header */}
                <div onClick={() => setExpandedIdx(expanded ? null : gi)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                    background: 'var(--bg-raised)', cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ fontSize: 14 }}>{expanded ? '▾' : '▸'}</span>
                  <Badge text={g.match_type} color={g.match_type === 'email' ? '#2563eb' : '#10b981'} />
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{g.match_key}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                    background: '#f59e0b18', color: '#f59e0b' }}>{g.count} contacts</span>
                </div>

                {/* Side-by-side comparison */}
                {expanded && (
                  <div style={{ padding: 16 }}>
                    <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
                      Select the record to keep (survivor). All others will be merged into it.
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-3)' }}>Keep</th>
                            {FIELDS.map(f => (
                              <th key={f.key} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-3)' }}>{f.label}</th>
                            ))}
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-3)' }}>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.contacts.map(c => {
                            const selected = survivorId === c.id;
                            return (
                              <tr key={c.id} onClick={() => selectSurvivor(gi, c.id)}
                                style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer',
                                  background: selected ? 'var(--k-primary-bg, #0082c60a)' : 'transparent' }}>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <input type="radio" name={`survivor-${gi}`} checked={selected}
                                    onChange={() => selectSurvivor(gi, c.id)} />
                                </td>
                                {FIELDS.map(f => (
                                  <td key={f.key} style={{ padding: '8px 10px', color: 'var(--ink-2)' }}>
                                    {f.key === 'contact_type' && c[f.key] ? <Badge text={c[f.key]} color={TYPE_COLORS[c[f.key]] || '#6E7B91'} /> :
                                     f.key === 'source' && c[f.key] ? <Badge text={c[f.key]} color={SOURCE_COLORS[c[f.key]] || '#6b7280'} /> :
                                     (c[f.key] ?? '—')}
                                  </td>
                                ))}
                                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--ink-3)' }}>
                                  {c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button className="k-btn k-btn--ghost" onClick={() => setExpandedIdx(null)}>Cancel</button>
                      <button className="k-btn k-btn--primary" disabled={!survivorId || merging}
                        onClick={() => doMerge(gi)}>
                        {merging ? 'Merging...' : `Merge ${g.count - 1} into survivor`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Merges */}
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, marginTop: 16 }}>Recent Merges (विलय इतिहास)</h3>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Previously merged contacts. Undo is available for recent merges.
      </p>
      {mergesLoading ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading merge history...</p>
      ) : merges.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>No merges yet.</p>
      ) : (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-raised)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Survivor</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Merged Contact</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Rows Moved</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {merges.map(m => (
                <tr key={m.id} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{m.survivor_name}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--ink-2)' }}>{m.merged_name}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--ink-2)' }}>{m.moved_rows ?? '—'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--ink-3)' }}>
                    {m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {m.undone_at ? <Badge text="Undone" color="#6E7B91" /> : <Badge text="Merged" color="#10b981" />}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {!m.undone_at && (
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#f59e0b' }}
                        disabled={undoing === m.id} onClick={() => undoMerge(m.id)}>
                        {undoing === m.id ? 'Undoing...' : 'Undo'}
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
  );
}
