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
    <div style={{ padding: '0 0 48px' }}>
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

const PUBLISH_PLATFORMS = [
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: 'f',
    desc: 'Publish to Facebook Pages',
    prereqs: ['Facebook Business Page', 'Meta Business Suite access', 'Page admin role'],
    supports: ['Text posts', 'Photo posts', 'Link sharing'] },
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: 'IG',
    desc: 'Publish to Instagram Business',
    prereqs: ['Instagram Business or Creator account', 'Linked Facebook Page', 'Meta Business Suite access'],
    supports: ['Photo posts (image required)', 'Captions with hashtags'] },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', icon: 'in',
    desc: 'Publish to LinkedIn profiles',
    prereqs: ['LinkedIn account with posting access'],
    supports: ['Text posts', 'Articles', 'Link sharing'] },
  { key: 'google_business', label: 'Google Business', color: '#4285F4', icon: 'G',
    desc: 'Publish to Google Business Profile',
    prereqs: ['Verified Google Business Profile', 'Owner or manager access'],
    supports: ['Local posts', 'Updates', 'Offers'] },
  { key: 'twitter', label: 'Twitter / X', color: '#1DA1F2', icon: 'X',
    desc: 'Publish to X (Twitter)',
    prereqs: ['X Developer account', 'API v2 access (manual token)'],
    supports: ['Tweets (280 chars)', 'Threads'], manualOnly: true },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', icon: 'YT',
    desc: 'Upload videos to YouTube',
    prereqs: ['YouTube channel', 'Google account with channel access'],
    supports: ['Video uploads', 'Shorts', 'Community posts'] },
  { key: 'whatsapp_business', label: 'WhatsApp Business', color: '#25D366', icon: 'WA',
    desc: 'Broadcast via WhatsApp Business API',
    prereqs: ['WhatsApp Business account', 'Meta Business Suite', 'Verified phone number', 'Approved message templates'],
    supports: ['Template messages', 'Broadcast lists', 'Media messages'] },
  { key: 'pinterest', label: 'Pinterest', color: '#E60023', icon: 'P',
    desc: 'Create Pins on Pinterest',
    prereqs: ['Pinterest Business account', 'At least one board created'],
    supports: ['Image pins', 'Rich pins', 'Idea pins'] },
  { key: 'tiktok', label: 'TikTok', color: '#000000', icon: 'TT',
    desc: 'Publish videos to TikTok',
    prereqs: ['TikTok Business or Creator account', 'TikTok Developer app access'],
    supports: ['Video posts', 'Descriptions with hashtags'] },
  { key: 'threads', label: 'Threads', color: '#000000', icon: 'Th',
    desc: 'Post to Threads (Meta)',
    prereqs: ['Instagram account (Threads linked)', 'Meta app with Threads API access'],
    supports: ['Text posts', 'Image posts', 'Link sharing'] },
  { key: 'telegram', label: 'Telegram', color: '#0088cc', icon: 'TG',
    desc: 'Post to Telegram channels',
    prereqs: ['Telegram Bot token (from @BotFather)', 'Bot added as admin to target channel'],
    supports: ['Text messages', 'Photo messages', 'HTML formatting'], manualOnly: true },
  { key: 'snapchat', label: 'Snapchat', color: '#FFFC00', icon: 'SC',
    desc: 'Publish to Snapchat',
    prereqs: ['Snapchat Business account', 'Snap Kit API access'],
    supports: ['Stories', 'Spotlight posts'], manualOnly: true },
  { key: 'reddit', label: 'Reddit', color: '#FF4500', icon: 'R',
    desc: 'Submit posts to subreddits',
    prereqs: ['Reddit account with posting karma', 'Reddit API app registered'],
    supports: ['Text posts', 'Link posts', 'Image posts'] },
];

const PUBLISH_PLATFORM_COLORS = Object.fromEntries(PUBLISH_PLATFORMS.map(p => [p.key, p.color]));
const QUEUE_STATUS_COLORS = { scheduled: '#f59e0b', publishing: '#0082c6', published: '#10b981', failed: '#ef4444', cancelled: '#9ca3af' };

function PublishTab({ clientId }) {
  const { pushToast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [queue, setQueue] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showManual, setShowManual] = useState(null);
  const [manualForm, setManualForm] = useState({ account_name: '', account_id: '', page_id: '', access_token: '' });
  const [scheduleForm, setScheduleForm] = useState({ content_id: '', social_account_id: '', scheduled_for: '' });
  const [bulkAccounts, setBulkAccounts] = useState([]);
  const [content, setContent] = useState([]);
  const [saving, setSaving] = useState(false);
  const [queueFilter, setQueueFilter] = useState('');
  const [view, setView] = useState('queue');
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; });
  const [connectingPlatform, setConnectingPlatform] = useState(null);
  const [enabledPlatforms, setEnabledPlatforms] = useState(null);
  const [showPlatformMgmt, setShowPlatformMgmt] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState([]);

  useEffect(() => { loadData(); loadEnabledPlatforms(); }, []);
  useEffect(() => { if (view === 'calendar') loadCalendar(); }, [view, calMonth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') {
      pushToast({ title: `${params.get('platform') || 'Account'} connected via OAuth`, type: 'success' });
      const url = new URL(window.location.href);
      url.searchParams.delete('oauth');
      url.searchParams.delete('platform');
      window.history.replaceState({}, '', url.toString());
      loadData();
    }
  }, []);

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

  async function loadCalendar() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/calendar?month=${calMonth}`);
      setCalendar(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load calendar', type: 'error' });
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

  async function loadEnabledPlatforms() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/platforms`);
      setEnabledPlatforms(r.data.enabled || []);
    } catch {
      setEnabledPlatforms(PUBLISH_PLATFORMS.map(p => p.key));
    }
  }

  async function saveEnabledPlatforms() {
    setSaving(true);
    try {
      await api.put(`/v1/hub/clients/${clientId}/platforms`, { platforms: pendingEnabled });
      setEnabledPlatforms(pendingEnabled);
      setShowPlatformMgmt(false);
      pushToast({ title: 'Platforms updated', type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to update', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function connectViaOAuth(platformKey) {
    setConnectingPlatform(platformKey);
    try {
      const r = await api.get(`/v1/hub/oauth/${platformKey}/authorize`, { params: { client_id: clientId } });
      window.location.href = r.data.auth_url;
    } catch (err) {
      const detail = err.response?.data?.detail || 'OAuth not configured for this platform';
      pushToast({ title: detail, type: 'error' });
      setConnectingPlatform(null);
    }
  }

  async function connectManual(e, platformKey) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/social-accounts`, { platform: platformKey, ...manualForm });
      pushToast({ title: 'Account connected', type: 'success' });
      setShowManual(null);
      setManualForm({ account_name: '', account_id: '', page_id: '', access_token: '' });
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
      if (bulkAccounts.length > 1) {
        await api.post(`/v1/hub/clients/${clientId}/publish/bulk-schedule`, {
          content_id: scheduleForm.content_id, account_ids: bulkAccounts, scheduled_for: scheduleForm.scheduled_for,
        });
        pushToast({ title: `Scheduled to ${bulkAccounts.length} accounts`, type: 'success' });
      } else {
        await api.post(`/v1/hub/clients/${clientId}/publish/schedule`, {
          ...scheduleForm, social_account_id: bulkAccounts[0] || scheduleForm.social_account_id,
        });
        pushToast({ title: 'Post scheduled', type: 'success' });
      }
      setShowSchedule(false);
      setScheduleForm({ content_id: '', social_account_id: '', scheduled_for: '' });
      setBulkAccounts([]);
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

  function toggleBulkAccount(id) {
    setBulkAccounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading…</p>;

  return (
    <div>
      {/* ── Platform Management (Aekam controls) ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Platform Integrations</h3>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }}
            onClick={() => { setShowPlatformMgmt(!showPlatformMgmt); setPendingEnabled([...(enabledPlatforms || [])]); }}>
            Manage Platforms
          </button>
        </div>

        {showPlatformMgmt && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
              Select which platforms this client can use for publishing.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {PUBLISH_PLATFORMS.map(p => {
                const on = pendingEnabled.includes(p.key);
                return (
                  <button key={p.key} type="button"
                    onClick={() => setPendingEnabled(prev => on ? prev.filter(x => x !== p.key) : [...prev, p.key])}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8,
                      border: `2px solid ${on ? p.color : 'var(--rule-soft)'}`,
                      background: on ? `${p.color}12` : 'var(--surface-0)',
                      cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 400, color: 'var(--ink-1)' }}>
                    <span style={{ width: 20, height: 20, borderRadius: 4, background: p.color, color: p.color === '#FFFC00' ? '#000' : '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800 }}>
                      {p.icon}
                    </span>
                    {p.label}
                    {on && <span style={{ color: p.color, fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }}
                onClick={() => setShowPlatformMgmt(false)}>Cancel</button>
              <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} disabled={saving}
                onClick={saveEnabledPlatforms}>
                {saving ? 'Saving…' : `Enable ${pendingEnabled.length} Platform${pendingEnabled.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Platform Cards (only enabled ones) ── */}
      <div style={{ marginBottom: 32 }}>
        {enabledPlatforms && enabledPlatforms.length === 0 && (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center', background: 'var(--surface-1)',
            borderRadius: 12, border: '1px solid var(--rule-soft)' }}>
            No platforms enabled for this client. Click "Manage Platforms" above to enable integrations.
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {PUBLISH_PLATFORMS.filter(p => !enabledPlatforms || enabledPlatforms.includes(p.key)).map(p => {
            const connected = accounts.filter(a => a.platform === p.key);
            const isConnected = connected.length > 0;
            return (
              <div key={p.key} style={{ background: 'var(--surface-1)', border: `1px solid ${isConnected ? p.color + '40' : 'var(--rule-soft)'}`,
                borderRadius: 12, padding: 20, position: 'relative', overflow: 'hidden' }}>
                {isConnected && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: p.color }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ width: 36, height: 36, borderRadius: 8, background: p.color, color: p.color === '#FFFC00' ? '#000' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800 }}>
                    {p.icon}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.desc}</div>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-4)', marginBottom: 6 }}>Prerequisites</div>
                  {p.prereqs.map((req, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--ink-3)', padding: '2px 0', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ color: isConnected ? '#10b981' : 'var(--ink-4)' }}>{isConnected ? '✓' : '•'}</span>
                      {req}
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-4)', marginBottom: 4 }}>Supports</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {p.supports.map((s, i) => (
                      <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'var(--surface-0)', color: 'var(--ink-3)' }}>{s}</span>
                    ))}
                  </div>
                </div>

                {connected.map(a => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: `${p.color}08`, border: `1px solid ${p.color}20`, borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{a.account_name || 'Connected'}</span>
                      {a.token_expires_at && new Date(a.token_expires_at) < new Date() && (
                        <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600, marginLeft: 8 }}>EXPIRED</span>
                      )}
                      {a.token_expires_at && new Date(a.token_expires_at) >= new Date() && (
                        <span style={{ fontSize: 10, color: 'var(--ink-4)', marginLeft: 8 }}>
                          Expires {new Date(a.token_expires_at).toLocaleDateString('en-IN')}
                        </span>
                      )}
                    </div>
                    <button onClick={() => disconnectAccount(a.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11, fontWeight: 600 }}>
                      Disconnect
                    </button>
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 6 }}>
                  {!p.manualOnly && (
                    <button className="k-btn k-btn--primary" disabled={connectingPlatform === p.key}
                      style={{ fontSize: 12, flex: 1, background: p.color, borderColor: p.color }}
                      onClick={() => connectViaOAuth(p.key)}>
                      {connectingPlatform === p.key ? 'Redirecting…' : isConnected ? 'Reconnect' : `Connect ${p.label}`}
                    </button>
                  )}
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }}
                    onClick={() => setShowManual(showManual === p.key ? null : p.key)}>
                    {p.manualOnly ? 'Connect with Token' : 'Manual'}
                  </button>
                </div>

                {showManual === p.key && (
                  <form onSubmit={e => connectManual(e, p.key)}
                    style={{ marginTop: 12, padding: 12, background: 'var(--surface-0)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <input className="k-input" placeholder="Account display name" value={manualForm.account_name}
                        onChange={e => setManualForm({ ...manualForm, account_name: e.target.value })} style={{ fontSize: 12 }} />
                      <input className="k-input" placeholder="Account / User ID" required value={manualForm.account_id}
                        onChange={e => setManualForm({ ...manualForm, account_id: e.target.value })} style={{ fontSize: 12 }} />
                      {(p.key === 'facebook' || p.key === 'instagram') && (
                        <input className="k-input" placeholder="Page ID (required for publishing)" value={manualForm.page_id}
                          onChange={e => setManualForm({ ...manualForm, page_id: e.target.value })} style={{ fontSize: 12 }} />
                      )}
                      {p.key === 'telegram' && (
                        <input className="k-input" placeholder="Channel ID (e.g. @channelname)" value={manualForm.page_id}
                          onChange={e => setManualForm({ ...manualForm, page_id: e.target.value })} style={{ fontSize: 12 }} />
                      )}
                      {p.key === 'reddit' && (
                        <input className="k-input" placeholder="Subreddit (e.g. r/marketing)" value={manualForm.page_id}
                          onChange={e => setManualForm({ ...manualForm, page_id: e.target.value })} style={{ fontSize: 12 }} />
                      )}
                      {p.key === 'pinterest' && (
                        <input className="k-input" placeholder="Board ID" value={manualForm.page_id}
                          onChange={e => setManualForm({ ...manualForm, page_id: e.target.value })} style={{ fontSize: 12 }} />
                      )}
                      <input className="k-input" type="password" placeholder="Access Token / Bot Token" required value={manualForm.access_token}
                        onChange={e => setManualForm({ ...manualForm, access_token: e.target.value })} style={{ fontSize: 12 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                      <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 11 }}
                        onClick={() => { setShowManual(null); setManualForm({ account_name: '', account_id: '', page_id: '', access_token: '' }); }}>Cancel</button>
                      <button type="submit" className="k-btn k-btn--primary" style={{ fontSize: 11 }} disabled={saving}>
                        {saving ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* View switcher: Queue / Calendar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {['queue', 'calendar'].map(v => (
          <button key={v} className={`k-btn ${view === v ? 'k-btn--primary' : 'k-btn--ghost'}`}
            style={{ fontSize: 12, padding: '6px 16px' }} onClick={() => setView(v)}>
            {v === 'queue' ? 'Publish Queue' : 'Content Calendar'}
          </button>
        ))}
      </div>

      {/* Queue View */}
      {view === 'queue' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="k-input" style={{ width: 130, fontSize: 12 }} value={queueFilter} onChange={e => setQueueFilter(e.target.value)}>
                <option value="">All Status</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} disabled={accounts.length === 0}
              onClick={() => { setShowSchedule(true); loadContent(); }}>
              + Schedule Post
            </button>
          </div>

          {accounts.length === 0 && (
            <p style={{ color: 'var(--ink-3)', fontSize: 12, padding: '8px 0', marginBottom: 8 }}>
              Connect at least one platform above to schedule posts.
            </p>
          )}

          {showSchedule && (
            <form onSubmit={schedulePost} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 12 }}>
              <h4 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700 }}>Schedule a Post</h4>
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
                  <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Schedule For *</span>
                  <input className="k-input" type="datetime-local" required value={scheduleForm.scheduled_for}
                    onChange={e => setScheduleForm({ ...scheduleForm, scheduled_for: e.target.value })} />
                </label>
              </div>

              <div style={{ marginTop: 16 }}>
                <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 8 }}>Publish to *</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {accounts.map(a => {
                    const pl = PUBLISH_PLATFORMS.find(p => p.key === a.platform);
                    const selected = bulkAccounts.includes(a.id);
                    return (
                      <button type="button" key={a.id} onClick={() => toggleBulkAccount(a.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
                          border: `2px solid ${selected ? (pl?.color || 'var(--k-primary)') : 'var(--rule-soft)'}`,
                          background: selected ? `${pl?.color || 'var(--k-primary)'}10` : 'var(--surface-0)',
                          cursor: 'pointer', fontSize: 12, fontWeight: selected ? 700 : 400 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: pl?.color || '#6E7B91' }} />
                        {a.account_name || a.platform}
                        <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{a.platform.replace('_', ' ')}</span>
                        {selected && <span style={{ fontWeight: 800, color: pl?.color }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="k-btn k-btn--ghost" onClick={() => { setShowSchedule(false); setBulkAccounts([]); }}>Cancel</button>
                <button type="submit" className="k-btn k-btn--primary" disabled={saving || bulkAccounts.length === 0}>
                  {saving ? 'Scheduling…' : bulkAccounts.length > 1 ? `Schedule to ${bulkAccounts.length} Accounts` : 'Schedule Post'}
                </button>
              </div>
            </form>
          )}

          {queue.filter(q => !queueFilter || q.status === queueFilter).length === 0 ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No posts in queue{queueFilter ? ` with status "${queueFilter}"` : ''}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {queue.filter(q => !queueFilter || q.status === queueFilter).map(q => {
                const pl = PUBLISH_PLATFORMS.find(p => p.key === q.platform);
                return (
                  <div key={q.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: pl?.color || '#6E7B91' }} />
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
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Calendar View */}
      {view === 'calendar' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button className="k-btn k-btn--ghost" style={{ padding: '4px 10px' }}
              onClick={() => { const [y, m] = calMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); }}>←</button>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              {new Date(calMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </span>
            <button className="k-btn k-btn--ghost" style={{ padding: '4px 10px' }}
              onClick={() => { const [y, m] = calMonth.split('-').map(Number); const d = new Date(y, m, 1); setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); }}>→</button>
          </div>

          {(() => {
            const [year, month] = calMonth.split('-').map(Number);
            const firstDay = new Date(year, month - 1, 1).getDay();
            const daysInMonth = new Date(year, month, 0).getDate();
            const cells = [];
            for (let i = 0; i < firstDay; i++) cells.push(null);
            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

            const dayItems = {};
            calendar.forEach(item => {
              const d = new Date(item.scheduled_for).getDate();
              if (!dayItems[d]) dayItems[d] = [];
              dayItems[d].push(item);
            });

            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 2 }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', padding: 6 }}>{d}</div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
                  {cells.map((day, i) => (
                    <div key={i} style={{
                      minHeight: 80, padding: 4, background: day ? 'var(--surface-1)' : 'transparent',
                      border: day ? '1px solid var(--rule-soft)' : 'none', borderRadius: 4,
                    }}>
                      {day && (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--ink-2)' }}>{day}</div>
                          {(dayItems[day] || []).map((item, j) => (
                            <div key={j} style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4, marginBottom: 2,
                              background: `${PUBLISH_PLATFORM_COLORS[item.platform] || '#6E7B91'}20`,
                              color: PUBLISH_PLATFORM_COLORS[item.platform] || '#6E7B91',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {item.title || 'Post'}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

