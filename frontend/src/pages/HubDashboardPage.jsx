import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

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

const TABS = ['generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits'];

export default function HubDashboardPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('generate');
  const [clientId, setClientId] = useState(null);
  const [client, setClient] = useState(null);
  const [brand, setBrand] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState([]);

  // Generate form
  const [genForm, setGenForm] = useState({ agent_type: 'social_media', brief: '', platform: '', language: 'en', extra_instructions: '' });
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);

  // Brand form
  const [brandForm, setBrandForm] = useState({});
  const [savingBrand, setSavingBrand] = useState(false);

  useEffect(() => { loadOrgClient(); }, []);
  useEffect(() => { if (tab === 'content' && clientId) loadContent(); }, [tab, clientId]);

  async function loadOrgClient() {
    try {
      const r = await api.get('/v1/hub/org-client');
      const c = r.data.client;
      setClient(c);
      setClientId(c.id);
      setBrand(r.data.brand);
      if (r.data.brand) setBrandForm(r.data.brand);

      const w = await api.get(`/v1/hub/clients/${c.id}`);
      setWallet(w.data.wallet);
    } catch {
      pushToast({ title: 'Failed to load Srijan', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function loadContent() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/content`);
      setContent(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load content', type: 'error' });
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setGenerating(true);
    setGenResult(null);
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/generate`, genForm);
      setGenResult(r.data);
      setWallet(w => w ? { ...w, balance: r.data.credits_remaining } : w);
      pushToast({ title: 'Content generated!', type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' });
    } finally {
      setGenerating(false);
    }
  }

  async function handleBrandSave() {
    setSavingBrand(true);
    try {
      const { id, client_id, created_at, updated_at, ...fields } = brandForm;
      await api.put(`/v1/hub/clients/${clientId}/brand`, fields);
      pushToast({ title: 'Brand profile updated', type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to save', type: 'error' });
    } finally {
      setSavingBrand(false);
    }
  }

  async function handleReview(contentId, status) {
    try {
      await api.patch(`/v1/hub/clients/${clientId}/content/${contentId}/review`, { status });
      pushToast({ title: `Content ${status}`, type: 'success' });
      loadContent();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Review failed', type: 'error' });
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;
  if (!clientId) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Srijan module not available.</div>;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Srijan · सृजन" subtitle="AI content, chatbot, knowledge base, social publishing" />

      {/* Tabs */}
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

      {/* Generate Tab */}
      {tab === 'generate' && (
        <div>
          <form onSubmit={handleGenerate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Generate Content</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Agent Type</span>
                <select className="k-input" value={genForm.agent_type}
                  onChange={e => setGenForm({ ...genForm, agent_type: e.target.value })}>
                  {Object.entries(AGENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Platform</span>
                <input className="k-input" placeholder="e.g. Instagram, LinkedIn" value={genForm.platform}
                  onChange={e => setGenForm({ ...genForm, platform: e.target.value })} />
              </label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brief *</span>
                <textarea className="k-input" rows={3} required placeholder="Describe what content you need…" value={genForm.brief}
                  onChange={e => setGenForm({ ...genForm, brief: e.target.value })} style={{ resize: 'vertical' }} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Language</span>
                <select className="k-input" value={genForm.language}
                  onChange={e => setGenForm({ ...genForm, language: e.target.value })}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="gu">Gujarati</option>
                  <option value="mr">Marathi</option>
                  <option value="ta">Tamil</option>
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Extra Instructions</span>
                <input className="k-input" placeholder="Any additional context…" value={genForm.extra_instructions}
                  onChange={e => setGenForm({ ...genForm, extra_instructions: e.target.value })} />
              </label>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Credits available: <strong>{wallet?.balance ?? 0}</strong></span>
              <button type="submit" className="k-btn k-btn--primary" disabled={generating}>
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </form>

          {genResult && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Generated Content</h3>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {genResult.ai?.provider} / {genResult.ai?.model}
                </span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--ink-1)', padding: 16,
                background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--rule-soft)' }}>
                {genResult.content?.body}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>
                Credits remaining: <strong>{genResult.credits_remaining}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content Tab */}
      {tab === 'content' && (
        <div>
          {content.length === 0 ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No content yet. Switch to the Generate tab to create content.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {content.map(item => (
                <div key={item.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>{AGENT_LABELS[item.agent_type]}</span>
                    </div>
                    <Badge status={item.status} />
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 12px', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden' }}>
                    {item.body}
                  </p>
                  {(item.status === 'draft' || item.status === 'pending_review') && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '4px 12px' }}
                        onClick={() => handleReview(item.id, 'approved')}>Approve</button>
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '4px 12px', color: '#ef4444' }}
                        onClick={() => handleReview(item.id, 'rejected')}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat Tab */}
      {tab === 'chat' && <ChatTab clientId={clientId} />}

      {/* Knowledge Tab */}
      {tab === 'knowledge' && <KnowledgeTab clientId={clientId} />}

      {/* Publish Tab */}
      {tab === 'publish' && <PublishTab clientId={clientId} />}

      {/* Brand Tab */}
      {tab === 'brand' && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Brand Profile</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brand Voice</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Professional yet approachable, data-driven…"
                value={brandForm.brand_voice || ''}
                onChange={e => setBrandForm({ ...brandForm, brand_voice: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tone</span>
              <select className="k-input" value={brandForm.tone || 'professional'}
                onChange={e => setBrandForm({ ...brandForm, tone: e.target.value })}>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="friendly">Friendly</option>
                <option value="bold">Bold</option>
                <option value="inspirational">Inspirational</option>
                <option value="witty">Witty</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tagline</span>
              <input className="k-input" value={brandForm.tagline || ''}
                onChange={e => setBrandForm({ ...brandForm, tagline: e.target.value })} />
            </label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Target Audience</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Small business owners in India aged 25-45…"
                value={brandForm.target_audience || ''}
                onChange={e => setBrandForm({ ...brandForm, target_audience: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Primary Color</span>
              <input className="k-input" type="color" value={brandForm.color_primary || '#0082c6'}
                onChange={e => setBrandForm({ ...brandForm, color_primary: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Secondary Color</span>
              <input className="k-input" type="color" value={brandForm.color_secondary || '#05b7aa'}
                onChange={e => setBrandForm({ ...brandForm, color_secondary: e.target.value })} />
            </label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Content Do's</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Use data and statistics, include CTAs…"
                value={brandForm.content_dos || ''}
                onChange={e => setBrandForm({ ...brandForm, content_dos: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Content Don'ts</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Avoid slang, don't use competitor names…"
                value={brandForm.content_donts || ''}
                onChange={e => setBrandForm({ ...brandForm, content_donts: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="k-btn k-btn--primary" onClick={handleBrandSave} disabled={savingBrand}>
              {savingBrand ? 'Saving…' : 'Save Brand Profile'}
            </button>
          </div>
        </div>
      )}

      {/* Credits Tab */}
      {tab === 'credits' && <CreditTab clientId={clientId} wallet={wallet} onRefresh={loadOrgClient} />}

    </div>
  );
}


// ── Credit Tab ─────────────────────────────────────────────────

function CreditTab({ clientId, wallet, onRefresh }) {
  const { pushToast } = useToast();
  const [transactions, setTransactions] = useState([]);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNotes, setTopupNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadTx(); }, []);

  async function loadTx() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/credits`);
      setTransactions(r.data.recent_transactions || []);
    } catch {
      pushToast({ title: 'Failed to load credit history', type: 'error' });
    }
  }

  async function handleTopup(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/credits/topup`, { amount: parseInt(topupAmount, 10), notes: topupNotes });
      pushToast({ title: 'Credits added', type: 'success' });
      setTopupAmount('');
      setTopupNotes('');
      onRefresh();
      loadTx();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Topup failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const TX_COLORS = { debit: '#ef4444', credit: '#10b981', refill: '#0082c6', topup: '#10b981', refund: '#f59e0b' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Balance</h3>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--k-primary)' }}>{wallet?.balance ?? 0}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>Monthly allocation: {wallet?.monthly_allocation ?? 0}</div>
        </div>
        <form onSubmit={handleTopup} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add Credits</h3>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount</span>
            <input className="k-input" type="number" min="1" required value={topupAmount} onChange={e => setTopupAmount(e.target.value)} />
          </label>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
            <input className="k-input" value={topupNotes} onChange={e => setTopupNotes(e.target.value)} />
          </label>
          <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Adding…' : 'Add Credits'}
          </button>
        </form>
      </div>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Transaction History</h3>
        {transactions.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No transactions yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Type', 'Amount', 'Balance After', 'Description', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99,
                      background: `${TX_COLORS[tx.tx_type] || '#6E7B91'}18`, color: TX_COLORS[tx.tx_type] || '#6E7B91' }}>{tx.tx_type}</span>
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: tx.amount < 0 ? '#ef4444' : '#10b981' }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{tx.balance_after}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>{tx.description}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-3)', fontSize: 12 }}>{new Date(tx.created_at).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


// ── Chat Tab ───────────────────────────────────────────────────

function ChatTab({ clientId }) {
  const { pushToast } = useToast();
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/chat/sessions`);
      setSessions(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load chat sessions', type: 'error' });
    } finally {
      setLoadingSessions(false);
    }
  }

  async function createSession() {
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/chat/sessions`, { title: 'New Chat' });
      const s = { id: r.data.id, title: r.data.title, message_count: 0 };
      setSessions(prev => [s, ...prev]);
      openSession(r.data.id);
    } catch {
      pushToast({ title: 'Failed to create session', type: 'error' });
    }
  }

  async function openSession(sessionId) {
    setActiveSession(sessionId);
    try {
      const r = await api.get(`/v1/hub/chat/sessions/${sessionId}/messages`);
      setMessages(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load messages', type: 'error' });
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() || !activeSession) return;
    const text = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text, id: 'tmp-' + Date.now() }]);
    setSending(true);
    try {
      const r = await api.post(`/v1/hub/chat/sessions/${activeSession}/send`, { message: text });
      setMessages(prev => [...prev, { role: 'assistant', content: r.data.message, sources: r.data.sources, model: r.data.model, id: 'ai-' + Date.now() }]);
      loadSessions();
    } catch {
      pushToast({ title: 'Failed to get response', type: 'error' });
    } finally {
      setSending(false);
    }
  }

  async function deleteSession(sessionId) {
    try {
      await api.delete(`/v1/hub/chat/sessions/${sessionId}`);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSession === sessionId) { setActiveSession(null); setMessages([]); }
    } catch {
      pushToast({ title: 'Failed to delete session', type: 'error' });
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, minHeight: 500 }}>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 12, overflow: 'auto' }}>
        <button className="k-btn k-btn--primary" style={{ width: '100%', marginBottom: 12, fontSize: 13 }} onClick={createSession}>
          + New Chat
        </button>
        {loadingSessions ? <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</p> : (
          sessions.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 12, textAlign: 'center' }}>No sessions yet</p> :
          sessions.map(s => (
            <div key={s.id} onClick={() => openSession(s.id)}
              style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, fontSize: 13,
                background: activeSession === s.id ? 'var(--k-primary-bg, rgba(0,130,198,0.08))' : 'transparent',
                fontWeight: activeSession === s.id ? 600 : 400, color: 'var(--ink-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.title}</span>
              <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14, padding: '0 4px' }}>×</button>
            </div>
          ))
        )}
      </div>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, display: 'flex', flexDirection: 'column' }}>
        {!activeSession ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 14 }}>
            Select a chat or start a new one
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '75%', padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    background: msg.role === 'user' ? 'var(--k-primary)' : 'var(--surface-0)',
                    color: msg.role === 'user' ? '#fff' : 'var(--ink-1)',
                    border: msg.role === 'user' ? 'none' : '1px solid var(--rule-soft)',
                  }}>
                    {msg.content}
                    {msg.sources?.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--rule-soft)', fontSize: 11, color: 'var(--ink-3)' }}>
                        Sources: {msg.sources.map((s, i) => <span key={i} style={{ marginRight: 8 }}>{s.title} ({Math.round(s.similarity * 100)}%)</span>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface-0)', border: '1px solid var(--rule-soft)', fontSize: 13, color: 'var(--ink-3)' }}>
                    Thinking…
                  </div>
                </div>
              )}
            </div>
            <form onSubmit={sendMessage} style={{ padding: 12, borderTop: '1px solid var(--rule-soft)', display: 'flex', gap: 8 }}>
              <input className="k-input" style={{ flex: 1 }} placeholder="Type a message…" value={input}
                onChange={e => setInput(e.target.value)} disabled={sending} />
              <button type="submit" className="k-btn k-btn--primary" disabled={sending || !input.trim()} style={{ fontSize: 13 }}>Send</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}


// ── Knowledge Tab ──────────────────────────────────────────────

function KnowledgeTab({ clientId }) {
  const { pushToast } = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [saving, setSaving] = useState(false);
  const [docForm, setDocForm] = useState({ title: '', content: '', source_type: 'text', source_url: '' });
  const [faqForm, setFaqForm] = useState({ question: '', answer: '' });

  useEffect(() => { loadDocs(); }, []);

  async function loadDocs() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/kb`);
      setDocs(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load knowledge base', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function addDoc(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/kb`, docForm);
      pushToast({ title: 'Document added and indexed', type: 'success' });
      setDocForm({ title: '', content: '', source_type: 'text', source_url: '' });
      setShowAdd(false);
      loadDocs();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to add document', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function addFaq(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/kb/faq`, faqForm);
      pushToast({ title: 'FAQ added', type: 'success' });
      setFaqForm({ question: '', answer: '' });
      setShowFaq(false);
      loadDocs();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to add FAQ', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDoc(docId) {
    try {
      await api.delete(`/v1/hub/clients/${clientId}/kb/${docId}`);
      setDocs(prev => prev.filter(d => d.id !== docId));
      pushToast({ title: 'Document removed', type: 'success' });
    } catch {
      pushToast({ title: 'Failed to delete', type: 'error' });
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchQ.trim()) return;
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/kb/search?q=${encodeURIComponent(searchQ)}`);
      setSearchResults(r.data.results || []);
    } catch {
      pushToast({ title: 'Search failed', type: 'error' });
    }
  }

  const SOURCE_LABELS = { text: 'Text', faq: 'FAQ', url: 'URL', file: 'File' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowAdd(true); setShowFaq(false); }}>+ Add Document</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => { setShowFaq(true); setShowAdd(false); }}>+ Add FAQ</button>
      </div>

      {showAdd && (
        <form onSubmit={addDoc} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add Knowledge Document</h3>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
            <input className="k-input" required value={docForm.title} onChange={e => setDocForm({ ...docForm, title: e.target.value })} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source Type</span>
              <select className="k-input" value={docForm.source_type} onChange={e => setDocForm({ ...docForm, source_type: e.target.value })}>
                <option value="text">Text</option>
                <option value="url">URL</option>
                <option value="file">File</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source URL</span>
              <input className="k-input" placeholder="Optional" value={docForm.source_url} onChange={e => setDocForm({ ...docForm, source_url: e.target.value })} />
            </label>
          </div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Content *</span>
            <textarea className="k-input" rows={6} required placeholder="Paste document content here…"
              value={docForm.content} onChange={e => setDocForm({ ...docForm, content: e.target.value })} style={{ resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add & Index'}</button>
          </div>
        </form>
      )}

      {showFaq && (
        <form onSubmit={addFaq} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add FAQ</h3>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Question *</span>
            <input className="k-input" required value={faqForm.question} onChange={e => setFaqForm({ ...faqForm, question: e.target.value })} />
          </label>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Answer *</span>
            <textarea className="k-input" rows={4} required value={faqForm.answer}
              onChange={e => setFaqForm({ ...faqForm, answer: e.target.value })} style={{ resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowFaq(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add FAQ'}</button>
          </div>
        </form>
      )}

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input className="k-input" style={{ flex: 1 }} placeholder="Search knowledge base…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <button type="submit" className="k-btn k-btn--ghost" style={{ fontSize: 13 }}>Search</button>
      </form>

      {searchResults && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Search Results ({searchResults.length})</h4>
          {searchResults.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No matches found.</p> :
            searchResults.map((r, i) => (
              <div key={i} style={{ padding: '10px 12px', marginBottom: 8, borderRadius: 8, background: 'var(--surface-0)', border: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.doc_title} <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 11 }}>({Math.round(r.similarity * 100)}% match)</span></div>
                <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.6 }}>{r.content?.substring(0, 300)}{r.content?.length > 300 ? '…' : ''}</p>
              </div>
            ))
          }
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => setSearchResults(null)}>Clear</button>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p> : docs.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No documents in knowledge base yet. Add documents or FAQs to power the chatbot.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(doc => (
            <div key={doc.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{doc.title}</span>
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99,
                  background: 'rgba(0,130,198,0.08)', color: 'var(--k-primary)' }}>{SOURCE_LABELS[doc.source_type] || doc.source_type}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>{doc.chunk_count} chunks</span>
              </div>
              <button onClick={() => deleteDoc(doc.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12, fontWeight: 600 }}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Publish Tab ────────────────────────────────────────────────

function PublishTab({ clientId }) {
  const { pushToast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [connectForm, setConnectForm] = useState({ platform: 'facebook', account_name: '', account_id: '', page_id: '', access_token: '' });
  const [scheduleForm, setScheduleForm] = useState({ content_id: '', social_account_id: '', scheduled_for: '' });
  const [content, setContent] = useState([]);
  const [saving, setSaving] = useState(false);
  const [queueFilter, setQueueFilter] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [acctRes, queueRes] = await Promise.all([
        api.get(`/v1/hub/clients/${clientId}/social-accounts`),
        api.get(`/v1/hub/clients/${clientId}/publish/queue`),
      ]);
      setAccounts(acctRes.data.data || []);
      setQueue(queueRes.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load publishing data', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function loadContent() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/content`);
      setContent(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load content', type: 'error' });
    }
  }

  async function connectAccount(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/social-accounts`, connectForm);
      pushToast({ title: 'Account connected', type: 'success' });
      setShowConnect(false);
      setConnectForm({ platform: 'facebook', account_name: '', account_id: '', page_id: '', access_token: '' });
      loadData();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to connect', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function disconnectAccount(accountId) {
    try {
      await api.delete(`/v1/hub/clients/${clientId}/social-accounts/${accountId}`);
      setAccounts(prev => prev.filter(a => a.id !== accountId));
      pushToast({ title: 'Account disconnected', type: 'success' });
    } catch {
      pushToast({ title: 'Failed to disconnect', type: 'error' });
    }
  }

  async function schedulePost(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/publish/schedule`, scheduleForm);
      pushToast({ title: 'Post scheduled', type: 'success' });
      setShowSchedule(false);
      setScheduleForm({ content_id: '', social_account_id: '', scheduled_for: '' });
      loadData();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to schedule', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function publishNow(queueId) {
    try {
      await api.post(`/v1/hub/publish/queue/${queueId}/publish-now`);
      pushToast({ title: 'Publishing…', type: 'success' });
      loadData();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Publish failed', type: 'error' });
    }
  }

  async function cancelPost(queueId) {
    try {
      await api.post(`/v1/hub/publish/queue/${queueId}/cancel`);
      pushToast({ title: 'Post cancelled', type: 'success' });
      loadData();
    } catch {
      pushToast({ title: 'Failed to cancel', type: 'error' });
    }
  }

  const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E4405F', linkedin: '#0A66C2', google_business: '#4285F4', twitter: '#1DA1F2' };
  const QUEUE_STATUS_COLORS = { scheduled: '#f59e0b', publishing: '#0082c6', published: '#10b981', failed: '#ef4444', cancelled: '#9ca3af' };

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading…</p>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Connected Accounts</h3>
          <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowConnect(true)}>+ Connect Account</button>
        </div>

        {showConnect && (
          <form onSubmit={connectAccount} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Platform *</span>
                <select className="k-input" value={connectForm.platform} onChange={e => setConnectForm({ ...connectForm, platform: e.target.value })}>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="google_business">Google Business</option>
                  <option value="twitter">Twitter / X</option>
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Account Name</span>
                <input className="k-input" placeholder="Display name" value={connectForm.account_name}
                  onChange={e => setConnectForm({ ...connectForm, account_name: e.target.value })} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Account / User ID *</span>
                <input className="k-input" required value={connectForm.account_id}
                  onChange={e => setConnectForm({ ...connectForm, account_id: e.target.value })} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Page ID</span>
                <input className="k-input" placeholder="For Facebook/Instagram" value={connectForm.page_id}
                  onChange={e => setConnectForm({ ...connectForm, page_id: e.target.value })} />
              </label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Access Token *</span>
                <input className="k-input" type="password" required value={connectForm.access_token}
                  onChange={e => setConnectForm({ ...connectForm, access_token: e.target.value })} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowConnect(false)}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
            </div>
          </form>
        )}

        {accounts.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No social accounts connected yet.</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {accounts.map(a => (
              <div key={a.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '10px 16px',
                display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLATFORM_COLORS[a.platform] || '#6E7B91' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.account_name || a.platform}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{a.platform.replace('_', ' ')}</span>
                <button onClick={() => disconnectAccount(a.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Disconnect</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Publish Queue</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="k-input" style={{ width: 130, fontSize: 12 }} value={queueFilter} onChange={e => setQueueFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
              <option value="failed">Failed</option>
            </select>
            <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowSchedule(true); loadContent(); }}>
              + Schedule Post
            </button>
          </div>
        </div>

        {showSchedule && (
          <form onSubmit={schedulePost} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 12 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Schedule a Post</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Content *</span>
                <select className="k-input" required value={scheduleForm.content_id}
                  onChange={e => setScheduleForm({ ...scheduleForm, content_id: e.target.value })}>
                  <option value="">Select content…</option>
                  {content.filter(c => ['draft', 'approved'].includes(c.status)).map(c => (
                    <option key={c.id} value={c.id}>{c.title} ({c.status})</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Account *</span>
                <select className="k-input" required value={scheduleForm.social_account_id}
                  onChange={e => setScheduleForm({ ...scheduleForm, social_account_id: e.target.value })}>
                  <option value="">Select account…</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.account_name || a.platform} ({a.platform})</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Schedule For *</span>
                <input className="k-input" type="datetime-local" required value={scheduleForm.scheduled_for}
                  onChange={e => setScheduleForm({ ...scheduleForm, scheduled_for: e.target.value })} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowSchedule(false)}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Scheduling…' : 'Schedule'}</button>
            </div>
          </form>
        )}

        {queue.filter(q => !queueFilter || q.status === queueFilter).length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No posts in queue{queueFilter ? ` with status "${queueFilter}"` : ''}.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {queue.filter(q => !queueFilter || q.status === queueFilter).map(q => (
              <div key={q.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLATFORM_COLORS[q.platform] || '#6E7B91' }} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{q.content_title}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>→ {q.account_name} ({q.platform})</span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 10px', borderRadius: 99,
                    background: `${QUEUE_STATUS_COLORS[q.status] || '#6E7B91'}18`, color: QUEUE_STATUS_COLORS[q.status] || '#6E7B91' }}>
                    {q.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
                  {q.scheduled_for && `Scheduled: ${new Date(q.scheduled_for).toLocaleString('en-IN')}`}
                  {q.published_at && ` · Published: ${new Date(q.published_at).toLocaleString('en-IN')}`}
                  {q.error_message && <span style={{ color: '#ef4444' }}> · Error: {q.error_message}</span>}
                </div>
                {q.status === 'scheduled' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => publishNow(q.id)}>Publish Now</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '4px 12px', color: '#ef4444' }} onClick={() => cancelPost(q.id)}>Cancel</button>
                  </div>
                )}
                {q.platform_url && (
                  <a href={q.platform_url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--k-primary)' }}>View Post ↗</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

