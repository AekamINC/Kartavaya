import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';
import { currentUser } from '../lib/auth';

const AGENT_LABELS = {
  social_media: 'Social Media', blog: 'Blog', ad_copy: 'Ad Copy',
  email: 'Email', whatsapp: 'WhatsApp', lead_magnet: 'Lead Magnet',
  campaign: 'Campaign Strategy', seo: 'SEO Content',
};

const STATUS_COLORS = {
  draft: '#6E7B91', pending_review: '#f59e0b', approved: '#10b981',
  rejected: '#ef4444', published: '#0082c6', archived: '#9ca3af',
};

function Badge({ status }) {
  const c = STATUS_COLORS[status] || '#6E7B91';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${c}18`, color: c }}>
      {status?.replace(/_/g, ' ')}
    </span>
  );
}

const TABS = ['skills', 'content', 'generate', 'credits'];

export default function OrgSrijanPage() {
  const { pushToast } = useToast();
  const me = currentUser();
  const [tab, setTab] = useState('skills');
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState(null);

  useEffect(() => { loadCredits(); }, []);

  async function loadCredits() {
    try {
      const r = await api.get('/v1/hub/org/credits');
      setCredits(r.data);
    } catch {
      pushToast({ title: 'Failed to load credits', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Srijan · सृजन" subtitle="AI content generation, skills & credits" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Org Balance" value={credits?.org_balance?.balance ?? '–'} variant="blue" />
        <StatTile label="Your Allocated" value={credits?.user_allocation?.allocated ?? '–'} variant="green" />
        <StatTile label="Your Used" value={credits?.user_allocation?.used ?? 0} variant="orange" />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'skills' && <SkillsTab onCreditsChange={loadCredits} />}
      {tab === 'content' && <ContentTab />}
      {tab === 'generate' && <GenerateTab credits={credits} onCreditsChange={loadCredits} />}
      {tab === 'credits' && <CreditsTab credits={credits} />}
    </div>
  );
}


// ── Skills Tab — view assigned skills & run them ──────────────────────────────

function SkillsTab({ onCreditsChange }) {
  const { pushToast } = useToast();
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [runVars, setRunVars] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [withImages, setWithImages] = useState(false);

  useEffect(() => { loadSkills(); }, []);

  async function loadSkills() {
    try {
      const r = await api.get('/v1/hub/org/skills');
      setSkills(r.data.data || r.data || []);
    } catch {
      pushToast({ title: 'Failed to load skills', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function runSkill(skillId) {
    setRunningId(skillId);
    setRunResult(null);
    try {
      const r = await api.post(`/v1/hub/org/skills/${skillId}/run`, {
        variables: runVars,
        generate_images: withImages,
      });
      setRunResult(r.data);
      onCreditsChange();
      pushToast({ title: `Skill completed — ${r.data.credits_used} credits used`, type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Skill run failed', type: 'error' });
    } finally {
      setRunningId(null);
    }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading skills…</p>;
  if (skills.length === 0) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No skills assigned to your organisation yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {skills.map(skill => {
        const isExpanded = expandedId === skill.id;
        const steps = typeof skill.steps === 'string' ? JSON.parse(skill.steps) : (skill.steps || []);
        return (
          <div key={skill.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{skill.template_name || skill.name}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>
                  {steps.length} step{steps.length !== 1 ? 's' : ''}
                </span>
              </div>
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '4px 12px' }}
                onClick={() => { setExpandedId(isExpanded ? null : skill.id); setRunResult(null); }}>
                {isExpanded ? 'Close' : 'Run Skill'}
              </button>
            </div>

            {skill.description && (
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '6px 0 0' }}>{skill.description}</p>
            )}

            {isExpanded && (
              <div style={{ marginTop: 16, padding: 16, background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--rule-soft)' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700 }}>Steps</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                  {steps.sort((a, b) => (a.order || 0) - (b.order || 0)).map((step, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--ink-2)', display: 'flex', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: 'var(--k-primary)', minWidth: 20 }}>{step.order || i + 1}.</span>
                      <span>{AGENT_LABELS[step.agent_type] || step.agent_type} — {step.platform || 'general'}</span>
                    </div>
                  ))}
                </div>

                <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Variables</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <label style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brand Name</span>
                    <input className="k-input" placeholder="Your brand name"
                      value={runVars.brand_name || ''}
                      onChange={e => setRunVars({ ...runVars, brand_name: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Language</span>
                    <select className="k-input" value={runVars.language || 'en'}
                      onChange={e => setRunVars({ ...runVars, language: e.target.value })}>
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                      <option value="gu">Gujarati</option>
                      <option value="mr">Marathi</option>
                      <option value="ta">Tamil</option>
                    </select>
                  </label>
                </div>

                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <input type="checkbox" checked={withImages} onChange={e => setWithImages(e.target.checked)} />
                  <span style={{ fontWeight: 600 }}>Generate images for each step (+3 credits each)</span>
                </label>

                <button className="k-btn k-btn--primary" disabled={runningId === skill.id}
                  onClick={() => runSkill(skill.id)}>
                  {runningId === skill.id ? 'Running…' : 'Run Now'}
                </button>

                {runResult && (
                  <div style={{ marginTop: 16, padding: 12, background: '#10b98118', borderRadius: 8, border: '1px solid #10b981' }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#10b981' }}>
                      Completed — {runResult.steps_completed} steps, {runResult.credits_used} credits used
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
                      {runResult.content_ids?.length || 0} content items generated. Check the Content tab to view them.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── Content Tab — view generated content with images ──────────────────────────

function ContentTab() {
  const { pushToast } = useToast();
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => { loadContent(); }, []);

  async function loadContent() {
    try {
      const params = filter !== 'all' ? `?agent_type=${filter}` : '';
      const r = await api.get(`/v1/hub/org/content${params}`);
      setContent(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load content', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadContent(); }, [filter]);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading content…</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', ...Object.keys(AGENT_LABELS)].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={filter === f ? 'k-btn k-btn--primary' : 'k-btn k-btn--ghost'}
            style={{ fontSize: 11, padding: '4px 12px' }}>
            {f === 'all' ? 'All' : AGENT_LABELS[f]}
          </button>
        ))}
      </div>

      {content.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>
          No content yet. Use Skills or Generate tab to create content.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {content.map(item => (
            <ContentCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { pushToast } = useToast();

  const handleDownload = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch(item.image_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(item.title || 'image').replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      pushToast({ title: 'Download failed — image may have expired', type: 'error' });
    }
  };

  const handleCopyUrl = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(item.image_url);
    pushToast({ title: 'Image URL copied', type: 'success' });
  };

  return (
    <>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, overflow: 'hidden' }}>
        {item.image_url && !imgError && (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: 'var(--surface-0)', cursor: 'pointer' }}
            onClick={() => setLightbox(true)}>
            <img src={item.image_url} alt={item.title || 'Generated content'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={() => setImgError(true)} />
            <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 4 }}>
              <button onClick={handleDownload} title="Download image"
                style={{ background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600, backdropFilter: 'blur(4px)' }}>
                ↓ Download
              </button>
              <button onClick={handleCopyUrl} title="Copy image URL"
                style={{ background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600, backdropFilter: 'blur(4px)' }}>
                Copy URL
              </button>
            </div>
          </div>
        )}
        {item.image_url && imgError && (
          <div style={{ padding: 16, background: 'var(--surface-0)', textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
            Image expired or unavailable — <button onClick={() => { setImgError(false); }}
              style={{ color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              retry
            </button>
          </div>
        )}
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{item.title}</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--ink-3)', background: 'var(--surface-0)',
                  padding: '1px 8px', borderRadius: 99 }}>
                  {AGENT_LABELS[item.agent_type] || item.agent_type}
                </span>
                {item.platform && (
                  <span style={{ fontSize: 10, color: 'var(--ink-3)', background: 'var(--surface-0)',
                    padding: '1px 8px', borderRadius: 99 }}>
                    {item.platform}
                  </span>
                )}
              </div>
            </div>
            <Badge status={item.status} />
          </div>

          <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '8px 0', whiteSpace: 'pre-wrap',
            maxHeight: expanded ? 'none' : 80, overflow: 'hidden', lineHeight: 1.6 }}>
            {item.body}
          </p>

          {item.body && item.body.length > 200 && (
            <button onClick={() => setExpanded(!expanded)}
              style={{ fontSize: 11, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8 }}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}

          {item.hashtags && item.hashtags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {item.hashtags.slice(0, 8).map((tag, i) => (
                <span key={i} style={{ fontSize: 10, color: 'var(--k-primary)', background: 'var(--k-primary)10',
                  padding: '1px 6px', borderRadius: 4 }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--ink-4)', marginTop: 8 }}>
            <span>{new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
            <span>{item.credits_used} credits</span>
          </div>
        </div>
      </div>

      {lightbox && item.image_url && (
        <div onClick={() => setLightbox(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
            backdropFilter: 'blur(8px)' }}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <img src={item.image_url} alt={item.title || 'Full size'}
              style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button onClick={handleDownload}
                style={{ background: '#fff', color: '#111', border: 'none', borderRadius: 8,
                  padding: '8px 24px', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
                Download
              </button>
              <button onClick={handleCopyUrl}
                style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)',
                  borderRadius: 8, padding: '8px 24px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                Copy URL
              </button>
              <button onClick={() => setLightbox(false)}
                style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)',
                  borderRadius: 8, padding: '8px 24px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


// ── Generate Tab — standalone content generation ──────────────────────────────

function GenerateTab({ credits, onCreditsChange }) {
  const { pushToast } = useToast();
  const [form, setForm] = useState({
    agent_type: 'social_media', brief: '', platform: '', language: 'en',
    extra_instructions: '', generate_image: false, image_prompt: '', aspect_ratio: '1:1',
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  async function handleGenerate(e) {
    e.preventDefault();
    setGenerating(true);
    setResult(null);
    try {
      const r = await api.post('/v1/hub/org/generate', form);
      setResult(r.data);
      onCreditsChange();
      pushToast({ title: 'Content generated!', type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' });
    } finally {
      setGenerating(false);
    }
  }

  const balance = credits?.user_allocation
    ? (credits.user_allocation.allocated - credits.user_allocation.used)
    : credits?.org_balance?.balance ?? 0;

  return (
    <div>
      <form onSubmit={handleGenerate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Generate Content</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Agent Type</span>
            <select className="k-input" value={form.agent_type}
              onChange={e => setForm({ ...form, agent_type: e.target.value })}>
              {Object.entries(AGENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Platform</span>
            <input className="k-input" placeholder="e.g. Instagram, LinkedIn" value={form.platform}
              onChange={e => setForm({ ...form, platform: e.target.value })} />
          </label>
          <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brief *</span>
            <textarea className="k-input" rows={3} required placeholder="Describe what content you need…" value={form.brief}
              onChange={e => setForm({ ...form, brief: e.target.value })} style={{ resize: 'vertical' }} />
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Language</span>
            <select className="k-input" value={form.language}
              onChange={e => setForm({ ...form, language: e.target.value })}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="gu">Gujarati</option>
              <option value="mr">Marathi</option>
              <option value="ta">Tamil</option>
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Extra Instructions</span>
            <input className="k-input" placeholder="Any additional context…" value={form.extra_instructions}
              onChange={e => setForm({ ...form, extra_instructions: e.target.value })} />
          </label>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--rule-soft)' }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="checkbox" checked={form.generate_image} onChange={e => setForm({ ...form, generate_image: e.target.checked })} />
            <span style={{ fontWeight: 600 }}>Generate image (+3 credits)</span>
          </label>
          {form.generate_image && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Image Prompt</span>
                <input className="k-input" placeholder="Describe the image you want (optional — auto-generated from brief)" value={form.image_prompt}
                  onChange={e => setForm({ ...form, image_prompt: e.target.value })} />
              </label>
              <label style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Aspect Ratio</span>
                <select className="k-input" value={form.aspect_ratio}
                  onChange={e => setForm({ ...form, aspect_ratio: e.target.value })}>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="9:16">9:16 (Portrait)</option>
                  <option value="4:3">4:3</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Credits available: <strong>{balance}</strong></span>
          <button type="submit" className="k-btn k-btn--primary" disabled={generating}>
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </form>

      {result && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Generated Content</h3>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {result.ai?.provider} / {result.ai?.model}
            </span>
          </div>
          {result.content?.image_url && (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <img src={result.content.image_url} alt="Generated" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-0)' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={async () => {
                  try {
                    const res = await fetch(result.content.image_url);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = 'generated-image.png'; a.click(); URL.revokeObjectURL(url);
                  } catch { pushToast({ title: 'Download failed', type: 'error' }); }
                }} className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '4px 12px' }}>
                  Download Image
                </button>
                <button onClick={() => { navigator.clipboard.writeText(result.content.image_url); pushToast({ title: 'URL copied', type: 'success' }); }}
                  className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '4px 12px' }}>
                  Copy URL
                </button>
                <a href={result.content.image_url} target="_blank" rel="noopener noreferrer"
                  className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '4px 12px', textDecoration: 'none' }}>
                  Open Full Size
                </a>
              </div>
            </div>
          )}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--ink-1)', padding: 16,
            background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--rule-soft)' }}>
            {result.content?.body}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Credits Tab — view balance & transactions ──────────────────────────────────

function CreditsTab({ credits }) {
  const txns = credits?.recent_transactions || [];
  const pricePerCredit = credits?.price_per_credit_inr || 4;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>Org Balance</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--k-primary)' }}>{credits?.org_balance?.balance ?? 0}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
            ≈ ₹{((credits?.org_balance?.balance ?? 0) * pricePerCredit).toLocaleString('en-IN')}
          </div>
        </div>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>Your Allocation</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981' }}>{credits?.user_allocation?.allocated ?? 0}</div>
        </div>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>Your Used</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>{credits?.user_allocation?.used ?? 0}</div>
        </div>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, fontWeight: 600 }}>Remaining</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-1)' }}>
            {(credits?.user_allocation?.allocated ?? 0) - (credits?.user_allocation?.used ?? 0)}
          </div>
        </div>
      </div>

      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Pricing — ₹{pricePerCredit} per credit</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {Object.entries(credits?.credit_costs || {}).map(([k, v]) => (
          <span key={k} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 99,
            background: 'var(--surface-1)', border: '1px solid var(--rule-soft)' }}>
            <strong>{AGENT_LABELS[k] || k}</strong>: {v} cr · ₹{v * pricePerCredit}
          </span>
        ))}
      </div>

      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Recent Transactions</h3>
      {txns.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center' }}>No transactions yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Amount</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)' }}>Balance After</th>
              </tr>
            </thead>
            <tbody>
              {txns.map(tx => (
                <tr key={tx.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>
                    {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--ink-2)' }}>{tx.description}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700,
                    color: tx.amount > 0 ? '#10b981' : '#ef4444' }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--ink-3)' }}>{tx.balance_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
