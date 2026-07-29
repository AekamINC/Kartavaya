// Graha · automations — trigger/action rules and their run log.
//
// 27 inline styles are now `gr__*` classes.
//
// The load caught per-request AND again on the outer chain, substituting an
// empty list for a failure both times, so a member without automation access
// saw "Sales Automations (0)" and an empty page. The two reads are now
// independent with a real error state on the rules — the LOG failing is still
// soft, because a missing run history is not a reason to hide the rules
// themselves, but it says so rather than rendering nothing.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

const TRIGGERS = ['lead_created', 'deal_stage_changed', 'deal_created', 'activity_created', 'contact_updated', 'deal_stale', 'followup_overdue'];
const ACTIONS = ['assign_to', 'create_followup', 'create_activity', 'update_score', 'change_stage', 'send_notification', 'add_label'];

export default function AutomationsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [automations, setAutomations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logsFailed, setLogsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'lead_created', action_type: 'create_followup', conditions: {}, action_data: {} });

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/graha/automations');
      setAutomations(rows(r));
    } catch (e) {
      setErr(e);
      setLoading(false);
      return;
    }
    setLoading(false);

    try {
      const l = await api.get('/v1/graha/automation-logs');
      setLogs(rows(l));
      setLogsFailed(false);
    } catch { setLogsFailed(true); }
  }

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/automations', form);
      pushToast({ title: 'Automation created', type: 'success' });
      setShowForm(false);
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function toggle(id) {
    try {
      await api.patch(`/v1/graha/automations/${id}/toggle`);
      setAutomations(prev => prev.map(a => (a.id === id ? { ...a, is_active: !a.is_active } : a)));
    } catch { pushToast({ title: 'Could not toggle automation', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this automation? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/automations/${id}`);
      setAutomations(prev => prev.filter(a => a.id !== id));
    } catch { pushToast({ title: 'Could not delete automation', type: 'error' }); }
  }

  if (loading) return <SkeletonRegion label="Loading automations"><SkeletonList rows={5} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gr__shead">
        <h3 className="gr__st">Sales Automations ({automations.length})</h3>
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(!showForm)} disabled={!canWrite} title={denial || undefined}>+ New Rule</button>
      </div>

      {showForm && (
        <form onSubmit={create} className="gr__panel gr__panel--flat">
          <div className="gr__grid">
            <label className="gr__f"><span className="gr__fl">Name</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Trigger</span>
              <select className="k-input" value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })}>
                {TRIGGERS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select></label>
            <label className="gr__f"><span className="gr__fl">Action</span>
              <select className="k-input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
              </select></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>Create</button>
          </div>
        </form>
      )}

      {automations.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No automations yet', hi: 'कोई स्वचालन नहीं' }}
          description="An automation watches for a trigger — a new lead, a stale deal — and takes an action without anyone remembering to."
          action={canWrite ? 'New Rule' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : automations.map(a => (
        <div key={a.id} className="gr__lrow gr__lrow--tight">
          <span className="gr__dot" style={{ '--c': a.is_active ? 'var(--ok)' : 'var(--on-surface-3)' }} />
          <div className="gr__lmain">
            <div className="gr__lt--sm">{a.name}</div>
            <div className="gr__ls">
              When: <Badge text={a.trigger_type.replace(/_/g, ' ')} color="var(--st-in-review)" /> →{' '}
              <Badge text={a.action_type.replace(/_/g, ' ')} color="var(--st-in-progress)" />
              {a.run_count > 0 && <span> · Ran {a.run_count}×</span>}
            </div>
          </div>
          <button className="k-btn k-btn--ghost" onClick={() => toggle(a.id)}>{a.is_active ? 'Disable' : 'Enable'}</button>
          <button className="k-btn k-btn--reject" onClick={() => remove(a.id)}>Delete</button>
        </div>
      ))}

      {(logs.length > 0 || logsFailed) && (
        <div className="gr__stack">
          <h4 className="gr__eyebrow">Recent Logs</h4>
          {logsFailed ? (
            <p className="gr__mute">The run history did not load. The rules above are unaffected.</p>
          ) : logs.slice(0, 20).map(l => (
            <div key={l.id} className="gr__lrow gr__lrow--tight">
              <Badge
                text={l.result}
                color={l.result === 'success' ? 'var(--ok)' : l.result === 'error' ? 'var(--danger)' : 'var(--on-surface-3)'}
              />
              <span className="gr__lsub">{l.automation_name}</span>
              <span className="gr__spacer" />
              <span className="gr__twhen">{new Date(l.created_at).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
