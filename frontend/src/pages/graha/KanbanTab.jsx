import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { dealStaleness, RotBadge, Badge, STAGE_COLORS } from './_shared';

export default function KanbanTab() {
  const { pushToast } = useToast();
  const [kanban, setKanban] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/deals/kanban');
      setKanban(r.data.columns || {});
      if (r.data.stages?.length) setStageList(r.data.stages);
    } catch { pushToast({ title: 'Failed to load kanban', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function moveStage(dealId, newStage) {
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { stage: newStage });
      pushToast({ title: `Moved to ${newStage}`, type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not move deal', type: 'error' }); }
  }

  const [stageList, setStageList] = useState(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
  const stages = stageList;

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
      {stages.map(stage => {
        const deals = kanban[stage] || [];
        const total = deals.reduce((s, d) => s + Number(d.value || 0), 0);
        return (
          <div key={stage} style={{ minWidth: 220, flex: '1 0 220px', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Badge text={stage} color={STAGE_COLORS[stage] || '#6E7B91'} />
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{deals.length}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>₹{total.toLocaleString('en-IN')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deals.map(d => {
                const rot = (stage !== 'Won' && stage !== 'Lost') ? dealStaleness(d.updated_at) : null;
                return (
                <div key={d.id} style={{
                  background: rot?.level === 'critical' ? 'color-mix(in srgb, #dc2626 4%, var(--bg))' : 'var(--bg)',
                  border: `1px solid ${rot?.level === 'critical' ? '#dc262630' : rot?.level === 'warning' ? '#d9770625' : 'var(--rule-soft)'}`,
                  borderRadius: 10, padding: 10,
                  boxShadow: '0 1px 3px rgba(0,0,0,.04), 0 0 0 0.5px rgba(0,0,0,.03)',
                  transition: 'box-shadow 150ms, border-color 150ms',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{d.title}</div>
                  {d.client_name && <div style={{ fontSize: 11, color: 'var(--k-primary)', fontWeight: 600, marginBottom: 2 }}>{d.client_name}</div>}
                  {d.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>{d.contact_name}</div>}
                  {d.owner_id && <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 4 }}>Owner: {d.owner_id.substring(0, 8)}…</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>₹{Number(d.value || 0).toLocaleString('en-IN')}</span>
                    {stage !== 'Won' && stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {stages.filter(s => s !== stage).map(s => (
                      <button key={s} onClick={() => moveStage(d.id, s)}
                        style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${STAGE_COLORS[s]}18`,
                          color: STAGE_COLORS[s], border: 'none', cursor: 'pointer', fontWeight: 600 }}>{s}</button>
                    ))}
                  </div>
                </div>
                );
              })}
              {deals.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 12 }}>No deals</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
