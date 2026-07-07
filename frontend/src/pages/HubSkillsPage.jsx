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

const ICON_OPTIONS = Object.entries(ICON_MAP).map(([k, v]) => ({ value: k, label: `${v} ${k}` }));

const AGENT_TYPES = [
  { value: 'social_media', label: 'Social Media', credits: 2 },
  { value: 'blog', label: 'Blog', credits: 5 },
  { value: 'ad_copy', label: 'Ad Copy', credits: 3 },
  { value: 'email', label: 'Email', credits: 2 },
  { value: 'whatsapp', label: 'WhatsApp', credits: 1 },
  { value: 'lead_magnet', label: 'Lead Magnet', credits: 8 },
  { value: 'campaign', label: 'Campaign Strategy', credits: 10 },
  { value: 'seo', label: 'SEO Content', credits: 8 },
];

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>
      {text}
    </span>
  );
}

function GuideSection({ title, children }) {
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>{title}</h3>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

function StepEditor({ steps, onChange }) {
  function updateStep(idx, field, value) {
    const updated = steps.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    onChange(updated);
  }
  function addStep() {
    onChange([...steps, { agent_type: 'social_media', prompt_template: '', platform: '' }]);
  }
  function removeStep(idx) {
    onChange(steps.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {steps.map((step, idx) => (
        <div key={idx} style={{ background: 'var(--surface-2, #f8f9fa)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)' }}>Step {idx + 1}</span>
            {steps.length > 1 && (
              <button onClick={() => removeStep(idx)} style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                Remove
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Agent Type</span>
              <select className="k-input" value={step.agent_type} onChange={e => updateStep(idx, 'agent_type', e.target.value)}>
                {AGENT_TYPES.map(a => <option key={a.value} value={a.value}>{a.label} ({a.credits} cr)</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Platform (optional)</span>
              <input className="k-input" value={step.platform || ''} onChange={e => updateStep(idx, 'platform', e.target.value)}
                placeholder="e.g. instagram, linkedin" />
            </label>
          </div>

          <label style={{ fontSize: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Prompt Template
              <span style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 8 }}>Use {'{variable_name}'} for dynamic inputs</span>
            </span>
            <textarea className="k-input" rows={3} value={step.prompt_template} onChange={e => updateStep(idx, 'prompt_template', e.target.value)}
              placeholder="Write a social media post about {topic}. Include hashtags and a call to action."
              style={{ resize: 'vertical', minHeight: 64 }} />
          </label>
        </div>
      ))}
      <button onClick={addStep} className="k-btn k-btn--ghost" style={{ fontSize: 12, alignSelf: 'flex-start' }}>+ Add Step</button>
    </div>
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
  const [creating, setCreating] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '', description: '', category: 'general', icon: 'star',
    steps: [{ agent_type: 'social_media', prompt_template: '', platform: '' }],
  });

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

  async function createTemplate() {
    if (!newTemplate.name.trim()) return pushToast({ title: 'Name is required', type: 'error' });
    const validSteps = newTemplate.steps.filter(s => s.prompt_template.trim());
    if (validSteps.length === 0) return pushToast({ title: 'At least one step with a prompt is required', type: 'error' });

    setCreating(true);
    try {
      await api.post('/v1/hub/skills/templates', {
        ...newTemplate,
        steps: validSteps,
      });
      pushToast({ title: 'Template created', type: 'success' });
      setNewTemplate({
        name: '', description: '', category: 'general', icon: 'star',
        steps: [{ agent_type: 'social_media', prompt_template: '', platform: '' }],
      });
      setTab('catalog');
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to create template', type: 'error' });
    } finally {
      setCreating(false);
    }
  }

  async function deleteTemplate(templateId) {
    try {
      await api.delete(`/v1/hub/skills/templates/${templateId}`);
      pushToast({ title: 'Template deactivated', type: 'success' });
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to delete', type: 'error' });
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;

  const assignedTemplateIds = new Set(clientSkills.map(cs => cs.template_id));
  const availableTemplates = templates.filter(t => !assignedTemplateIds.has(t.id));

  const TABS = [
    { key: 'assigned', label: `Assigned (${clientSkills.length})` },
    { key: 'catalog', label: `Catalog (${availableTemplates.length})` },
    { key: 'create', label: 'Create Template' },
    { key: 'guide', label: 'Guide' },
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => navigate(`/hub/clients/${clientId}`)} className="k-btn k-btn--ghost" style={{ fontSize: 12 }}>← Back to Client</button>
      </div>
      <PageHeader title="Skill Packs" subtitle="Pre-built AI workflows — assigned per client, brand-isolated" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t.key ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ Assigned Skills ═══ */}
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

      {/* ═══ Catalog ═══ */}
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
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '6px 16px', flex: 1 }}
                        onClick={() => assignSkill(tmpl.id)}>
                        Assign to Client
                      </button>
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '6px 16px', color: '#ef4444' }}
                        onClick={() => deleteTemplate(tmpl.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Create Template ═══ */}
      {tab === 'create' && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 28 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Create a Skill Pack Template</h3>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 24px' }}>
            Build a reusable AI workflow. Each step runs an AI agent in sequence, injecting the client's brand profile automatically.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Template Name</span>
              <input className="k-input" value={newTemplate.name}
                onChange={e => setNewTemplate({ ...newTemplate, name: e.target.value })}
                placeholder="e.g. Monthly Newsletter Pack" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
                <select className="k-input" value={newTemplate.category}
                  onChange={e => setNewTemplate({ ...newTemplate, category: e.target.value })}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Icon</span>
                <select className="k-input" value={newTemplate.icon}
                  onChange={e => setNewTemplate({ ...newTemplate, icon: e.target.value })}>
                  {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          <label style={{ fontSize: 13, display: 'block', marginBottom: 20 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
            <textarea className="k-input" rows={2} value={newTemplate.description}
              onChange={e => setNewTemplate({ ...newTemplate, description: e.target.value })}
              placeholder="What does this skill pack do? When should it be used?"
              style={{ resize: 'vertical' }} />
          </label>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Steps</div>
            <StepEditor steps={newTemplate.steps} onChange={steps => setNewTemplate({ ...newTemplate, steps })} />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--rule-soft)', paddingTop: 16 }}>
            <button className="k-btn k-btn--ghost" onClick={() => setTab('catalog')}>Cancel</button>
            <button className="k-btn k-btn--primary" onClick={createTemplate} disabled={creating}>
              {creating ? 'Creating…' : 'Create Template'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ Guide ═══ */}
      {tab === 'guide' && (
        <div>
          <GuideSection title="What are Skill Packs?">
            <p style={{ margin: '0 0 8px' }}>
              Skill Packs are <strong>pre-built AI workflows</strong> that automate multi-step content creation.
              Instead of generating one piece of content at a time, a Skill Pack runs a sequence of AI agents
              in order — producing a complete content bundle in one click.
            </p>
            <p style={{ margin: 0 }}>
              For example, the <strong>Product Launch Pack</strong> generates a blog post, Instagram teaser,
              LinkedIn announcement, email, and ad copy — all from a single brief. Each piece is tailored
              to the client's brand profile.
            </p>
          </GuideSection>

          <GuideSection title="How Templates Work">
            <p style={{ margin: '0 0 8px' }}>
              A <strong>Template</strong> is a global blueprint that defines the workflow. It contains:
            </p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
              <li><strong>Steps</strong> — ordered list of AI agents to run (social media, blog, email, etc.)</li>
              <li><strong>Prompt Templates</strong> — instructions for each step, with <code style={{ background: 'var(--surface-2, #f0f0f0)', padding: '1px 4px', borderRadius: 3 }}>{'{ variables }'}</code> for dynamic inputs</li>
              <li><strong>Category</strong> — organises templates (Festival, Launch, Engagement, etc.)</li>
              <li><strong>Estimated Credits</strong> — total credit cost based on the agents used</li>
            </ul>
            <p style={{ margin: 0 }}>
              Templates are shared across your organisation — create once, assign to any client.
            </p>
          </GuideSection>

          <GuideSection title="Per-Client Isolation">
            <p style={{ margin: '0 0 8px' }}>
              Each client gets their own <strong>isolated assignment</strong> of a template. When you assign a Skill Pack
              to a client:
            </p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
              <li>The client's <strong>brand profile</strong> (voice, tone, audience, do's/don'ts) is injected into every AI prompt</li>
              <li>Generated content is stored under <strong>that client only</strong> — never shared across clients</li>
              <li>Credits are deducted from <strong>that client's wallet</strong></li>
              <li>Run history is tracked <strong>per client per skill</strong></li>
            </ul>
            <p style={{ margin: 0 }}>
              This means the same "Festival Calendar" template produces completely different content for each client,
              matching their unique brand identity.
            </p>
          </GuideSection>

          <GuideSection title="Creating a Template">
            <p style={{ margin: '0 0 8px' }}>
              Go to the <strong>Create Template</strong> tab to build a new Skill Pack. Here's how:
            </p>
            <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
              <li>Give it a <strong>name</strong> and <strong>description</strong> so your team knows when to use it</li>
              <li>Pick a <strong>category</strong> and <strong>icon</strong> for visual organisation</li>
              <li>Add <strong>steps</strong> — each step is one AI agent call. Choose the agent type and write the prompt template</li>
              <li>Use <code style={{ background: 'var(--surface-2, #f0f0f0)', padding: '1px 4px', borderRadius: 3 }}>{'{ variable_name }'}</code> in prompts for inputs that change each run (e.g. festival name, product name, topic)</li>
            </ol>
            <div style={{ background: 'var(--k-primary-ghost)', borderRadius: 8, padding: 16, marginTop: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: 'var(--k-primary)' }}>Example Prompt Template</div>
              <code style={{ fontSize: 12, lineHeight: 1.6, display: 'block' }}>
                Create a festive social media post for {'{festival_name}'}. Include warm wishes,<br/>
                brand connection, and relevant hashtags. Festival date: {'{date}'}.
              </code>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
                When running, the user fills in <em>festival_name</em> and <em>date</em>. The AI uses the client's brand profile for tone and style.
              </div>
            </div>
          </GuideSection>

          <GuideSection title="Running a Skill Pack">
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>Go to the <strong>Assigned</strong> tab for a client</li>
              <li>Click <strong>Run Skill</strong> on any assigned pack</li>
              <li>Fill in the <strong>variables</strong> (the dynamic inputs the template needs)</li>
              <li>Click <strong>Run</strong> — each step executes in order, deducting credits per step</li>
              <li>All generated content appears in the client's <strong>Content</strong> tab as drafts, ready for review</li>
            </ol>
          </GuideSection>

          <GuideSection title="Credit Costs per Agent">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {AGENT_TYPES.map(a => (
                <div key={a.value} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                  <span>{a.label}</span>
                  <span style={{ fontWeight: 700 }}>{a.credits} credits</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '12px 0 0' }}>
              A Skill Pack's total cost = sum of all step credits. For example, a 5-step pack with 2 social media + 1 blog + 1 email + 1 ad copy = 2+2+5+2+3 = 14 credits.
            </p>
          </GuideSection>
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
