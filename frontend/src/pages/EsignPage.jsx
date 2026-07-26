import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, Card } from '../components/editorial';
import { relTime } from '../lib/utils';

const STATUS_COLORS = {
  draft: '#6b7280', sent: '#0082c6', partially_signed: '#f59e0b',
  completed: '#10b981', cancelled: '#ef4444', expired: '#9ca3af',
};

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

export default function EsignPage() {
  const [tab, setTab] = useState('documents');
  const TABS = ['documents', 'create'];

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Pramaan" sanskrit="प्रमाण" lede="E-Signatures — Send, Sign & Track Documents" />
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t === 'create' ? '+ New Document' : t}
          </button>
        ))}
      </div>
      {tab === 'documents' && <DocumentsTab onSwitch={setTab} />}
      {tab === 'create' && <CreateTab onDone={() => setTab('documents')} />}
      {tab.startsWith('detail:') && <DetailTab docId={tab.split(':')[1]} onBack={() => setTab('documents')} />}
    </div>
  );
}


function DocumentsTab({ onSwitch }) {
  const [docs, setDocs] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const url = filter ? `/v1/esign/documents?status=${filter}` : '/v1/esign/documents';
      const r = await api.get(url);
      setDocs(r.data.data || []);
    } catch (e) {
      toast.error('Failed to load documents');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const FILTERS = ['', 'draft', 'sent', 'partially_signed', 'completed', 'cancelled'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '4px 12px', fontSize: 12, borderRadius: 99,
              background: filter === f ? 'var(--k-primary)' : 'var(--bg-2)',
              color: filter === f ? '#fff' : 'var(--ink-3)',
              border: 'none', cursor: 'pointer', fontWeight: filter === f ? 700 : 400 }}>
            {f || 'All'}
          </button>
        ))}
      </div>

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading...</p> :
       docs.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No documents yet</p>
            <p style={{ fontSize: 13 }}>Create your first document to get started with e-signatures.</p>
            <button onClick={() => onSwitch('create')}
              style={{ marginTop: 16, padding: '8px 24px', borderRadius: 8, border: 'none',
                background: 'var(--k-primary)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              + New Document
            </button>
          </div>
        </Card>
       ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {docs.map(d => (
            <Card key={d.id} style={{ cursor: 'pointer' }} onClick={() => onSwitch(`detail:${d.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-1)' }}>{d.title}</span>
                    <Badge text={d.status?.replace('_', ' ')} color={STATUS_COLORS[d.status] || '#6b7280'} />
                  </div>
                  {d.description && <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '4px 0 0' }}>{d.description}</p>}
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--ink-3)' }}>
                    <span>Signers: {d.signers_completed}/{d.signers_total}</span>
                    <span>Created {relTime(d.created_at)}</span>
                    {d.expires_at && <span>Expires {relTime(d.expires_at)}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 18, color: 'var(--ink-3)' }}>›</span>
              </div>
            </Card>
          ))}
        </div>
       )}
    </div>
  );
}


function CreateTab({ onDone }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [signers, setSigners] = useState([{ name: '', email: '', phone: '', sign_order: 1 }]);
  const [file, setFile] = useState(null);
  const [expiresDays, setExpiresDays] = useState(30);
  const [saving, setSaving] = useState(false);

  const addSigner = () => {
    if (signers.length >= 10) return;
    setSigners([...signers, { name: '', email: '', phone: '', sign_order: signers.length + 1 }]);
  };

  const updateSigner = (idx, field, value) => {
    const next = [...signers];
    next[idx] = { ...next[idx], [field]: value };
    setSigners(next);
  };

  const removeSigner = (idx) => {
    if (signers.length <= 1) return;
    setSigners(signers.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sign_order: i + 1 })));
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!file) { toast.error('Please upload a PDF file'); return; }
    if (signers.some(s => !s.name.trim() || !s.email.trim())) {
      toast.error('All signers need a name and email'); return;
    }

    setSaving(true);
    try {
      const r = await api.post('/v1/esign/documents', {
        title: title.trim(),
        description: description.trim(),
        signers: signers.map(s => ({ name: s.name.trim(), email: s.email.trim(), phone: s.phone.trim(), sign_order: s.sign_order })),
        expires_days: expiresDays,
      });
      const docId = r.data.id;

      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/v1/esign/documents/${docId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        noRetry: true,
      });

      toast.success('Document created! You can now send it for signing.');
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create document');
    } finally { setSaving(false); }
  };

  const inp = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--rule-soft)',
    background: 'var(--bg-1)', color: 'var(--ink-1)', fontSize: 13, outline: 'none' };

  return (
    <div style={{ maxWidth: 640 }}>
      <Card>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 16 }}>New Document</h3>

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} style={inp} placeholder="e.g. Service Agreement" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', margin: '16px 0 4px' }}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inp, minHeight: 60, resize: 'vertical' }}
          placeholder="Optional note for signers" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', margin: '16px 0 4px' }}>PDF File *</label>
        <input type="file" accept=".pdf,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)}
          style={{ fontSize: 13, color: 'var(--ink-2)' }} />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', margin: '16px 0 4px' }}>Expires in (days)</label>
        <input type="number" min={1} max={365} value={expiresDays} onChange={e => setExpiresDays(+e.target.value)}
          style={{ ...inp, width: 100 }} />

        <div style={{ margin: '24px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>Signers *</label>
          <button onClick={addSigner} disabled={signers.length >= 10}
            style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            + Add Signer
          </button>
        </div>

        {signers.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input value={s.name} onChange={e => updateSigner(i, 'name', e.target.value)} style={inp} placeholder="Name *" />
            <input value={s.email} onChange={e => updateSigner(i, 'email', e.target.value)} style={inp} placeholder="Email *" type="email" />
            <input value={s.phone} onChange={e => updateSigner(i, 'phone', e.target.value)} style={inp} placeholder="Phone (optional)" />
            {signers.length > 1 && (
              <button onClick={() => removeSigner(i)}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: 4 }}>×</button>
            )}
          </div>
        ))}

        <button onClick={handleSubmit} disabled={saving}
          style={{ marginTop: 24, padding: '10px 32px', borderRadius: 8, border: 'none',
            background: saving ? 'var(--ink-3)' : 'var(--k-primary)', color: '#fff', fontWeight: 700,
            cursor: saving ? 'default' : 'pointer', fontSize: 14 }}>
          {saving ? 'Creating...' : 'Create Document'}
        </button>
      </Card>
    </div>
  );
}


function DetailTab({ docId, onBack }) {
  const [doc, setDoc] = useState(null);
  const [signers, setSigners] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/v1/esign/documents/${docId}`);
      setDoc(r.data.document);
      setSigners(r.data.signers || []);
      setAudit(r.data.audit_trail || []);
    } catch { toast.error('Failed to load document'); }
    finally { setLoading(false); }
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    setSending(true);
    try {
      await api.post(`/v1/esign/documents/${docId}/send`);
      toast.success('Document sent to all signers!');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send');
    } finally { setSending(false); }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.post(`/v1/esign/documents/${docId}/cancel`);
      toast.success('Document cancelled');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel');
    } finally { setCancelling(false); }
  };

  const handleResend = async (signerId) => {
    try {
      await api.post(`/v1/esign/documents/${docId}/resend/${signerId}`);
      toast.success('Reminder sent!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to resend');
    }
  };

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading...</p>;
  if (!doc) return <p style={{ color: '#ef4444', fontSize: 13 }}>Document not found</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      <button onClick={onBack}
        style={{ fontSize: 13, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, fontWeight: 600 }}>
        ← Back to Documents
      </button>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>{doc.title}</h3>
            {doc.description && <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '4px 0 0' }}>{doc.description}</p>}
          </div>
          <Badge text={doc.status?.replace('_', ' ')} color={STATUS_COLORS[doc.status] || '#6b7280'} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, fontSize: 12, color: 'var(--ink-3)' }}>
          <div><strong style={{ color: 'var(--ink-2)' }}>Signers:</strong> {doc.signers_completed}/{doc.signers_total}</div>
          <div><strong style={{ color: 'var(--ink-2)' }}>Created:</strong> {relTime(doc.created_at)}</div>
          <div><strong style={{ color: 'var(--ink-2)' }}>Expires:</strong> {doc.expires_at ? relTime(doc.expires_at) : 'Never'}</div>
          {doc.file_url && doc.file_url !== 'pending' && (
            <div><a href={doc.file_url} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--k-primary)', textDecoration: 'none', fontWeight: 600 }}>View PDF</a></div>
          )}
        </div>

        {doc.status === 'completed' && doc.signed_file_url && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#10b98118', fontSize: 13 }}>
            <a href={doc.signed_file_url} target="_blank" rel="noopener noreferrer"
              style={{ color: '#10b981', fontWeight: 700, textDecoration: 'none' }}>
              Download Signing Certificate
            </a>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {doc.status === 'draft' && doc.file_url !== 'pending' && (
            <button onClick={handleSend} disabled={sending}
              style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--k-primary)',
                color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              {sending ? 'Sending...' : 'Send for Signing'}
            </button>
          )}
          {doc.status === 'draft' && doc.file_url === 'pending' && (
            <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>Upload a PDF first to send</span>
          )}
          {['draft', 'sent', 'partially_signed'].includes(doc.status) && (
            <button onClick={handleCancel} disabled={cancelling}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #ef4444', background: 'none',
                color: '#ef4444', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              {cancelling ? 'Cancelling...' : 'Cancel Document'}
            </button>
          )}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 12 }}>Signers</h4>
        {signers.map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 0', borderBottom: '1px solid var(--rule-soft)' }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{s.name}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{s.email}</span>
              {s.phone && <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{s.phone}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge text={s.status} color={STATUS_COLORS[s.status === 'signed' ? 'completed' : s.status === 'declined' ? 'cancelled' : 'sent'] || '#6b7280'} />
              {s.signed_at && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{relTime(s.signed_at)}</span>}
              {['sent', 'opened'].includes(s.status) && doc.status !== 'cancelled' && (
                <button onClick={() => handleResend(s.id)}
                  style={{ fontSize: 11, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  Resend
                </button>
              )}
            </div>
          </div>
        ))}
      </Card>

      {audit.length > 0 && (
        <Card>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 12 }}>Audit Trail</h4>
          {audit.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 12 }}>
              <span style={{ color: 'var(--ink-3)', minWidth: 120 }}>{new Date(a.created_at).toLocaleString()}</span>
              <span style={{ color: 'var(--ink-2)', fontWeight: 600, textTransform: 'capitalize' }}>{a.action?.replace(/_/g, ' ')}</span>
              <span style={{ color: 'var(--ink-3)' }}>{a.actor_email}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
