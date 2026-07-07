import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';

const CATEGORY_LABELS = {
  general: 'General', festival: 'Festival', launch: 'Launch',
  engagement: 'Engagement', branding: 'Branding', seasonal: 'Seasonal', industry: 'Industry',
};

const CATEGORY_COLORS = {
  general: '#6E7B91', festival: '#f59e0b', launch: '#ef4444',
  engagement: '#10b981', branding: '#0082c6', seasonal: '#8b5cf6', industry: '#ec4899',
};

const ICON_MAP = {
  calendar: '📅', rocket: '🚀', video: '🎬', search: '🔍', megaphone: '📢', star: '⭐',
};

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>
      {text}
    </span>
  );
}

export default function HubSkillsPage() {
  const { clientId } = useParams();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [clientSkills, setClientSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('assigned');
  const [runningSkill, setRunningSkill] = useState(null);
  const [varForm, setVarForm] = useState({});
  const [showVarModal, setShowVarModal] = useState(null);

  useEffect(() => { load(); }, [clientId]);

  async function load() {
    try {
      const [t, cs] = await Promise.all([
        api.get('/v1/hub/skills/templates'),
        api.get(`/v1/hub/clients/${clientId}/skills`),
      ]);
      setTemplates(t.data.data || []);
      setClientSkills(cs.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load skills', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function assignSkill(templateId) {
    try {
      await api.post(`/v1/hub/clients/${clientId}/skills/${templateId}`, {});
      pushToast({ title: 'Skill assigned', type: 'success' });
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to assign', type: 'error' });
    }
  }

  async function removeSkill(skillId) {
    try {
      await api.delete(`/v1/hub/clients/${clientId}/skills/${skillId}`);
      pushToast({ title: 'Skill removed', type: 'success' });
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to remove', type: 'error' });
    }
  }

  function extractVariables(steps) {
    const vars = new Set();
    for (const step of steps || []) {
      const matches = (step.prompt_template || '').match(/\{(\w+)\}/g) || [];
      for (const m of matches) {
        const name = m.slice(1, -1);
        if (!['platform', 'brief', 'extra'].includes(name)) vars.add(name);
      }
    }
    return [...vars];
  }

  function openRunModal(skill) {
    const steps = typeof skill.steps === 'string' ? JSON.parse(skill.steps) : skill.steps;
    const vars = extractVariables(steps);
    const initial = {};
    vars.forEach(v => { initial[v] = ''; });
    setVarForm(initial);
    setShowVarModal(skill);
  }

  async function executeSkill() {
    const skill = showVarModal;
    setShowVarModal(null);
    setRunningSkill(skill.id);
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/skills/${skill.id}/run`, { variables: varForm });
      pushToast({ title: `Skill completed — ${r.data.steps_completed} items generated (${r.data.credits_used} credits)`, type: 'success' });
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Skill run failed', type: 'error' });
    } finally {
      setRunningSkill(null);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;

  const assignedTemplateIds = new Set(clientSkills.map(cs => cs.template_id));
  const availableTemplates = templates.filter(t => !assignedTemplateIds.has(t.id));

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => navigate(`/hub/clients/${clientId}`)} className="k-btn k-btn--ghost" style={{ fontSize: 12 }}>← Back to Client</button>
      </div>
      <PageHeader title="Skill Packs" subtitle="Pre-built AI workflows — assigned per client, brand-isolated" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)' }}>
        {['assigned', 'catalog'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>
            {t === 'assigned' ? `Assigned (${clientSkills.length})` : `Catalog (${availableTemplates.length})`}
          </button>
        ))}
      </div>

      {/* Assigned Skills */}
      {tab === 'assigned' && (
        <div>
          {clientSkills.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12 }}>
              <p style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 12 }}>No skills assigned to this client yet.</p>
              <button className="k-btn k-btn--primary" onClick={() => setTab('catalog')}>Browse Catalog</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {clientSkills.map(skill => {
                const steps = typeof skill.steps === 'string' ? JSON.parse(skill.steps) : skill.steps;
                return (
                  <div key={skill.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 24 }}>{ICON_MAP[skill.icon] || '⭐'}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{skill.template_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{skill.template_description}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Badge text={skill.category} color={CATEGORY_COLORS[skill.category] || '#6E7B91'} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>~{skill.estimated_credits} credits</span>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 12 }}>
                      {(steps || []).length} steps: {(steps || []).map((s, i) =>
                        <span key={i} style={{ display: 'inline-block', padding: '1px 6px', margin: '2px 4px 2px 0', borderRadius: 4,
                          background: 'var(--k-primary-ghost)', fontSize: 11 }}>
                          {s.agent_type?.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '6px 16px' }}
                        disabled={runningSkill === skill.id} onClick={() => openRunModal(skill)}>
                        {runningSkill === skill.id ? 'Running…' : 'Run Skill'}
                      </button>
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '6px 16px', color: '#ef4444' }}
                        onClick={() => removeSkill(skill.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Catalog */}
      {tab === 'catalog' && (
        <div>
          {availableTemplates.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12 }}>
              <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>All available skills are already assigned to this client.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {availableTemplates.map(tmpl => {
                const steps = typeof tmpl.steps === 'string' ? JSON.parse(tmpl.steps) : tmpl.steps;
                return (
                  <div key={tmpl.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 24 }}>{ICON_MAP[tmpl.icon] || '⭐'}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{tmpl.name}</div>
                        <Badge text={tmpl.category} color={CATEGORY_COLORS[tmpl.category] || '#6E7B91'} />
                      </div>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '8px 0 12px', lineHeight: 1.5 }}>{tmpl.description}</p>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 12 }}>
                      {(steps || []).length} steps · ~{tmpl.estimated_credits} credits
                    </div>
                    <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '6px 16px', width: '100%' }}
                      onClick={() => assignSkill(tmpl.id)}>
                      Assign to Client
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Variable Input Modal */}
      {showVarModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowVarModal(null)}>
          <div style={{ background: 'var(--surface-1)', borderRadius: 16, padding: 32, width: 480, maxHeight: '80vh', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>Run: {showVarModal.template_name}</h3>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 20px' }}>Fill in the variables for this skill pack run.</p>

            {Object.keys(varForm).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 16 }}>No variables needed — this skill will run with your brand profile.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                {Object.keys(varForm).map(key => (
                  <label key={key} style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 600, display: 'block', marginBottom: 4, textTransform: 'capitalize' }}>
                      {key.replace(/_/g, ' ')}
                    </span>
                    <input className="k-input" value={varForm[key]}
                      onChange={e => setVarForm({ ...varForm, [key]: e.target.value })}
                      placeholder={`Enter ${key.replace(/_/g, ' ')}…`} />
                  </label>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="k-btn k-btn--ghost" onClick={() => setShowVarModal(null)}>Cancel</button>
              <button className="k-btn k-btn--primary" onClick={executeSkill}>
                Run ({showVarModal.estimated_credits} credits)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
