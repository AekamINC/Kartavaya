import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function AutomationsTab() {
  const { pushToast } = useToast();
  const [automations, setAutomations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'lead_created', action_type: 'create_followup', conditions: {}, action_data: {} });

  useEffect(() => {
    Promise.all([
      api.get('/v1/graha/automations').catch(() => ({ data: { data: [] } })),
      api.get('/v1/graha/automation-logs').catch(() => ({ data: { data: [] } })),
    ]).then(([a, l]) => {
      setAutomations(a.data.data || []);
      setLogs(l.data.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/automations', form);
      pushToast({ title: 'Automation created', type: 'success' });
      setShowForm(false);
      const r = await api.get('/v1/graha/automations');
      setAutomations(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function toggle(id) {
    try {
      await api.patch(`/v1/graha/automations/${id}/toggle`);
      setAutomations(prev => prev.map(a => a.id === id ? { ...a, is_active: !a.is_active } : a));
    } catch { pushToast({ title: 'Could not toggle automation', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this automation? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/automations/${id}`);
      setAutomations(prev => prev.filter(a => a.id !== id));
    } catch { pushToast({ title: 'Could not delete automation', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  const TRIGGERS = ['lead_created', 'deal_stage_changed', 'deal_created', 'activity_created', 'contact_updated', 'deal_stale', 'followup_overdue'];
  const ACTIONS = ['assign_to', 'create_followup', 'create_activity', 'update_score', 'change_stage', 'send_notification', 'add_label'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Sales Automations ({automations.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowForm(!showForm)}>+ New Rule</button>
      </div>

      {showForm && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</span>
              <input className="k-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Trigger</span>
              <select className="k-input" value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })}>
                {TRIGGERS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Action</span>
              <select className="k-input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {automations.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 'var(--r-pill)', background: a.is_active ? 'var(--ok)' : 'var(--on-surface-3)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              When: <Badge text={a.trigger_type.replace(/_/g, ' ')} color="var(--st-in-review)" /> → <Badge text={a.action_type.replace(/_/g, ' ')} color="var(--st-in-progress)" />
              {a.run_count > 0 && <span style={{ marginLeft: 8 }}>· Ran {a.run_count}×</span>}
            </div>
          </div>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => toggle(a.id)}>{a.is_active ? 'Disable' : 'Enable'}</button>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: 'var(--danger)' }} onClick={() => remove(a.id)}>Delete</button>
        </div>
      ))}

      {logs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Recent Logs</h4>
          {logs.slice(0, 20).map(l => (
            <div key={l.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', gap: 8 }}>
              <Badge text={l.result} color={l.result === 'success' ? 'var(--ok)' : l.result === 'error' ? 'var(--danger)' : 'var(--on-surface-3)'} />
              <span style={{ color: 'var(--ink-2)' }}>{l.automation_name}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{new Date(l.created_at).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
