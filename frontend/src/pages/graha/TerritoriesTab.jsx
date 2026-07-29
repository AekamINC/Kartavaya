// Graha · territories — named sales regions and who covers them.
//
// 26 inline styles are now `gr__*` classes, and the `.catch(() => {})` that
// rendered "Territories (0)" over a failed fetch is a real error state.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function TerritoriesTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [territories, setTerritories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', assigned_users: [] });
  const [userInput, setUserInput] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      const r = await api.get('/v1/graha/territories');
      setTerritories(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load territories', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/territories', form);
      pushToast({ title: 'Territory created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', description: '', assigned_users: [] });
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this territory? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/territories/${id}`);
      setTerritories(prev => prev.filter(t => t.id !== id));
    } catch { pushToast({ title: 'Could not delete territory', type: 'error' }); }
  }

  function addUser() {
    const u = userInput.trim();
    if (u && !form.assigned_users.includes(u)) {
      setForm({ ...form, assigned_users: [...form.assigned_users, u] });
      setUserInput('');
    }
  }

  if (loading) return <SkeletonRegion label="Loading territories"><SkeletonList rows={4} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gr__shead">
        <h3 className="gr__st">Territories ({territories.length})</h3>
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(!showForm)} disabled={!canWrite} title={denial || undefined}>+ New Territory</button>
      </div>

      {showForm && (
        <form onSubmit={create} className="gr__panel gr__panel--flat">
          <div className="gr__grid">
            <label className="gr__f"><span className="gr__fl">Name</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div className="gr__group">
            <span className="gr__fl">Assigned Users</span>
            <div className="gr__chips">
              {form.assigned_users.map(u => (
                <span key={u} className="gr__tok">
                  {u.slice(0, 12)}
                  <button type="button" className="gr__tokx" aria-label={`Remove ${u}`}
                    onClick={() => setForm({ ...form, assigned_users: form.assigned_users.filter(x => x !== u) })}>×</button>
                </span>
              ))}
            </div>
            <div className="gr__bar">
              <input className="k-input gr__grow" placeholder="User ID" aria-label="User ID" value={userInput} onChange={e => setUserInput(e.target.value)} />
              <button type="button" className="k-btn k-btn--ghost" onClick={addUser}>Add</button>
            </div>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>Create</button>
          </div>
        </form>
      )}

      {territories.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No territories yet', hi: 'कोई क्षेत्र नहीं' }}
          description="A territory names a region and the people who cover it, so leads route to whoever owns the patch."
          action={canWrite ? 'New Territory' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : territories.map(t => (
        <div key={t.id} className="gr__lrow">
          <div className="gr__lmain">
            <div className="gr__lt">{t.name}</div>
            {t.description && <div className="gr__lsub">{t.description}</div>}
            {t.assigned_users?.length > 0 && (
              <div className="gr__chips gr__chips--tight">
                {t.assigned_users.map(u => <Badge key={u} text={u.slice(0, 12)} color="var(--st-in-review)" />)}
              </div>
            )}
          </div>
          <span className="gr__ls">{t.assigned_users?.length || 0} users</span>
          <button className="k-btn k-btn--reject" onClick={() => remove(t.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
