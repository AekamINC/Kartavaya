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


// ── Generate Tab — quick content generation with rich output ────────────────

const QUICK_SKILLS = [
  { id: 'social_post', icon: '📱', label: 'Social Post', hi: 'सोशल पोस्ट', credits: 3, hasImage: true,
    desc: 'Instagram, LinkedIn, or WhatsApp post with image' },
  { id: 'email_campaign', icon: '📧', label: 'Email Campaign', hi: 'ईमेल', credits: 3, hasImage: true,
    desc: 'Marketing email with subject, preview text & body + banner' },
  { id: 'ad_copy', icon: '📢', label: 'Ad Copy', hi: 'विज्ञापन', credits: 3, hasImage: true,
    desc: 'Ad headlines, copy & creative for any platform' },
  { id: 'blog_post', icon: '✍️', label: 'Blog Post', hi: 'ब्लॉग', credits: 5, hasImage: true,
    desc: 'SEO-friendly blog article with featured image' },
  { id: 'whatsapp_broadcast', icon: '💬', label: 'WhatsApp', hi: 'व्हाट्सएप', credits: 1, hasImage: false,
    desc: 'Short broadcast message for WhatsApp Business' },
  { id: 'proposal', icon: '📋', label: 'Proposal', hi: 'प्रस्ताव', credits: 5, hasImage: false,
    desc: 'Professional business proposal with sections' },
  { id: 'festival_campaign', icon: '🎉', label: 'Festival Campaign', hi: 'त्योहार', credits: 5, hasImage: true,
    desc: 'Complete festival marketing campaign for Indian market' },
];

function renderMarkdown(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('# ')) return <h1 key={i} style={{ fontSize: 22, fontWeight: 800, margin: '16px 0 8px', color: 'var(--ink)' }}>{line.slice(2)}</h1>;
    if (line.startsWith('## ')) return <h2 key={i} style={{ fontSize: 17, fontWeight: 700, margin: '14px 0 6px', color: 'var(--ink)' }}>{line.slice(3)}</h2>;
    if (line.startsWith('### ')) return <h3 key={i} style={{ fontSize: 14, fontWeight: 700, margin: '12px 0 4px', color: 'var(--ink-2)' }}>{line.slice(4)}</h3>;
    if (line.startsWith('- ') || line.startsWith('* '))
      return <div key={i} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.7, color: 'var(--ink-1)', paddingLeft: 8 }}>
        <span style={{ color: 'var(--k-primary)', fontWeight: 700 }}>•</span>
        <span dangerouslySetInnerHTML={{ __html: boldify(line.slice(2)) }} />
      </div>;
    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)[1];
      return <div key={i} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.7, color: 'var(--ink-1)', paddingLeft: 8 }}>
        <span style={{ color: 'var(--k-primary)', fontWeight: 700, minWidth: 18 }}>{num}.</span>
        <span dangerouslySetInnerHTML={{ __html: boldify(line.replace(/^\d+\.\s/, '')) }} />
      </div>;
    }
    if (line.startsWith('---')) return <hr key={i} style={{ border: 'none', borderTop: '1px solid var(--rule-soft)', margin: '12px 0' }} />;
    if (line.trim() === '') return <div key={i} style={{ height: 8 }} />;
    return <p key={i} style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-1)', margin: '2px 0' }}
      dangerouslySetInnerHTML={{ __html: boldify(line) }} />;
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function boldify(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:var(--surface-0);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
}

const PLATFORM_HINTS = {
  'Instagram': { icon: '📸', hint: 'Image required. No clickable links in captions — use "link in bio." Hashtags boost reach (5–15 recommended).', charLimit: 2200 },
  'LinkedIn': { icon: '💼', hint: 'Professional tone works best. Tag companies with @. Articles get 3× more reach than plain text.', charLimit: 3000 },
  'WhatsApp': { icon: '💬', hint: 'Keep it short and conversational. Emojis work well. Broadcast lists max 256 contacts.', charLimit: 1000 },
  'Facebook': { icon: '👥', hint: 'Images/video boost engagement 2×. Links get auto-preview. Keep text under 80 chars for best reach.', charLimit: 63206 },
  'Twitter / X': { icon: '𝕏', hint: '280 character limit per tweet. Threads for longer content. 1–2 hashtags max.', charLimit: 280 },
  'Email': { icon: '📧', hint: 'Subject line is critical — keep under 50 chars. Preview text (first line) shows in inbox.', charLimit: null },
  'Google Ads': { icon: '📢', hint: 'Headlines: 30 chars max. Descriptions: 90 chars max. Include keywords and a clear CTA.', charLimit: null },
  'Website': { icon: '🌐', hint: 'SEO-friendly. Include meta description (155 chars). Use headers (H1, H2) for structure.', charLimit: null },
};

function PlatformHint({ platform }) {
  const info = PLATFORM_HINTS[platform];
  if (!info) return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--surface-0)',
      border: '1px solid var(--rule-soft)', borderRadius: 8, padding: '8px 12px', marginBottom: 12,
      display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 16 }}>{info.icon}</span>
      <div>
        <span>{info.hint}</span>
        {info.charLimit && <span style={{ fontWeight: 600 }}> Max {info.charLimit.toLocaleString()} chars.</span>}
      </div>
    </div>
  );
}

function GenerateTab({ credits, onCreditsChange }) {
  const { pushToast } = useToast();
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [form, setForm] = useState({ topic: '', platform: 'Instagram', tone: 'Professional', language: 'en', extra: '', with_image: true });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const balance = credits?.user_allocation
    ? (credits.user_allocation.allocated - credits.user_allocation.used)
    : credits?.org_balance?.balance ?? 0;

  async function handleGenerate(e) {
    e.preventDefault();
    if (!selectedSkill) return;
    setGenerating(true);
    setResult(null);
    try {
      const r = await api.post('/v1/hub/org/quick-generate', {
        skill: selectedSkill.id,
        ...form,
        with_image: selectedSkill.hasImage && form.with_image,
      });
      setResult(r.data);
      onCreditsChange();
      pushToast({ title: `Generated! ${r.data.credits_used} credits used`, type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      {/* Skill picker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
        {QUICK_SKILLS.map(s => (
          <button key={s.id} onClick={() => { setSelectedSkill(s); setResult(null); }}
            style={{ textAlign: 'left', padding: 14, borderRadius: 10, cursor: 'pointer',
              background: selectedSkill?.id === s.id ? 'var(--k-primary)' : 'var(--surface-1)',
              color: selectedSkill?.id === s.id ? '#fff' : 'var(--ink)',
              border: selectedSkill?.id === s.id ? '2px solid var(--k-primary)' : '1px solid var(--rule-soft)',
              transition: 'all .15s' }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{s.label}</div>
            <div style={{ fontSize: 10, opacity: .7, marginTop: 2 }}>{s.desc}</div>
            <div style={{ fontSize: 10, fontWeight: 700, marginTop: 6, opacity: .6 }}>
              {s.credits} credits{s.hasImage ? ' · + image' : ''}
            </div>
          </button>
        ))}
      </div>

      {/* Input form */}
      {selectedSkill && (
        <form onSubmit={handleGenerate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)',
          borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>
            {selectedSkill.icon} {selectedSkill.label}
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{selectedSkill.hi}</span>
          </h3>

          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>What is this about? *</span>
            <textarea className="k-input" rows={3} required
              placeholder="e.g. Diwali sale — 30% off on all products, highlight festive collection"
              value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}
              style={{ resize: 'vertical' }} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Platform</span>
              <select className="k-input" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                <option>Instagram</option><option>LinkedIn</option><option>WhatsApp</option>
                <option>Facebook</option><option>Twitter / X</option><option>Email</option>
                <option>Google Ads</option><option>Website</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tone</span>
              <select className="k-input" value={form.tone} onChange={e => setForm({ ...form, tone: e.target.value })}>
                <option>Professional</option><option>Casual</option><option>Festive</option>
                <option>Formal</option><option>Friendly</option><option>Urgent</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Language</span>
              <select className="k-input" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
                <option value="en">English</option><option value="hi">Hindi</option>
                <option value="gu">Gujarati</option><option value="mr">Marathi</option>
                <option value="ta">Tamil</option><option value="hinglish">Hinglish</option>
              </select>
            </label>
          </div>

          {/* Platform-specific guidance */}
          <PlatformHint platform={form.platform} />

          {form.platform === 'Twitter / X' && (
            <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Thread count (optional)</span>
              <select className="k-input" value={form.thread_count || '1'} onChange={e => setForm({ ...form, thread_count: e.target.value })}>
                <option value="1">Single tweet</option>
                <option value="3">3-tweet thread</option>
                <option value="5">5-tweet thread</option>
              </select>
            </label>
          )}

          {form.platform === 'Email' && (
            <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email subject line</span>
              <input className="k-input" placeholder="e.g. Exclusive Diwali offer inside!"
                value={form.email_subject || ''} onChange={e => setForm({ ...form, email_subject: e.target.value })} />
            </label>
          )}

          {form.platform === 'Google Ads' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Ad type</span>
                <select className="k-input" value={form.ad_type || 'search'} onChange={e => setForm({ ...form, ad_type: e.target.value })}>
                  <option value="search">Search ad</option>
                  <option value="display">Display ad</option>
                  <option value="pmax">Performance Max</option>
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Target URL</span>
                <input className="k-input" placeholder="https://yoursite.com/landing"
                  value={form.target_url || ''} onChange={e => setForm({ ...form, target_url: e.target.value })} />
              </label>
            </div>
          )}

          {form.platform === 'LinkedIn' && (
            <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Post type</span>
              <select className="k-input" value={form.post_type || 'text'} onChange={e => setForm({ ...form, post_type: e.target.value })}>
                <option value="text">Text post</option>
                <option value="article">Article / long-form</option>
                <option value="carousel">Carousel document</option>
                <option value="poll">Poll</option>
              </select>
            </label>
          )}

          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Extra instructions (optional)</span>
            <input className="k-input" placeholder="e.g. mention our website, use brand colors, target young professionals"
              value={form.extra} onChange={e => setForm({ ...form, extra: e.target.value })} />
          </label>

          {selectedSkill.hasImage && (
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={form.with_image} onChange={e => setForm({ ...form, with_image: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Generate matching image</span>
            </label>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Credits: <strong>{balance}</strong> available · <strong>{selectedSkill.credits}</strong> will be used
            </span>
            <button type="submit" className="k-btn k-btn--primary" disabled={generating || !form.topic.trim()}>
              {generating ? 'Generating…' : `Generate ${selectedSkill.label}`}
            </button>
          </div>
        </form>
      )}

      {/* Rich result */}
      {result && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              {selectedSkill?.icon} Generated Content
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{result.model}</span>
              <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '4px 12px' }}
                onClick={() => { navigator.clipboard.writeText(result.text); pushToast({ title: 'Copied!', type: 'success' }); }}>
                Copy Text
              </button>
            </div>
          </div>

          {result.images?.length > 0 && (
            <div style={{ padding: 24, borderBottom: '1px solid var(--rule-soft)', background: 'var(--surface-0)' }}>
              {result.images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img.url} alt="Generated visual"
                    style={{ width: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 8 }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={async () => {
                      try {
                        const res = await fetch(img.url); const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = `srijan-${Date.now()}.png`; a.click(); URL.revokeObjectURL(url);
                      } catch { pushToast({ title: 'Download failed', type: 'error' }); }
                    }} className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '4px 12px' }}>
                      Download Image
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(img.url); pushToast({ title: 'URL copied', type: 'success' }); }}
                      className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '4px 12px' }}>
                      Copy URL
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ padding: 24 }}>
            {renderMarkdown(result.text)}
          </div>

          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--rule-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, color: 'var(--ink-3)' }}>
            <span>{result.credits_used} credits used</span>
            <span>Content saved to library</span>
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
