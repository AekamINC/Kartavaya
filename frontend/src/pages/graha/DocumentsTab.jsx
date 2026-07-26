import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function DocumentsTab() {
  const { pushToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderFilter, setFolderFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', file_url: '', folder: '', description: '', tags: '' });
  const [saving, setSaving] = useState(false);

  const fmtSize = bytes => {
    if (!bytes) return '—';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  };

  useEffect(() => { load(); loadFolders(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/documents?';
      if (folderFilter) url += `folder=${encodeURIComponent(folderFilter)}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      const r = await api.get(url);
      setDocuments(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load documents', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadFolders() {
    try {
      const r = await api.get('/v1/graha/documents/folders');
      setFolders(r.data.data || []);
    } catch {}
  }

  async function createDocument(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [] };
      await api.post('/v1/graha/documents', payload);
      pushToast({ title: 'Document added', type: 'success' });
      setShowForm(false);
      setForm({ name: '', file_url: '', folder: '', description: '', tags: '' });
      load();
      loadFolders();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteDoc(id) {
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/documents/${id}`);
      pushToast({ title: 'Document deleted', type: 'success' });
      setDocuments(prev => prev.filter(d => d.id !== id));
      loadFolders();
    } catch { pushToast({ title: 'Could not delete document', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 160 }} value={folderFilter} onChange={e => setFolderFilter(e.target.value)}>
          <option value="">All Folders</option>
          {folders.map(f => <option key={f.folder} value={f.folder}>{f.folder} ({f.count})</option>)}
        </select>
        <input className="k-input" style={{ flex: 1, maxWidth: 260 }} placeholder="Search documents..." value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Search</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Document</button>
      </div>

      {showForm && (
        <form onSubmit={createDocument} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add Document</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>File URL *</span>
              <input className="k-input" required value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Folder</span>
              <input className="k-input" value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })} placeholder="e.g. contracts, invoices" /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tags (comma-separated)</span>
              <input className="k-input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="e.g. legal, signed, 2026" /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Add Document'}</button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            {['Name', 'Folder', 'Size', 'Type', 'Uploaded', 'Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {documents.map(d => (
            <tr key={d.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '10px' }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                {d.description && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{d.description}</div>}
                {d.tags?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {(d.tags || []).map(t => <Badge key={t} text={t} color="var(--st-in-review)" />)}
                  </div>
                )}
              </td>
              <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{d.folder || '—'}</td>
              <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{fmtSize(d.file_size)}</td>
              <td style={{ padding: '10px', color: 'var(--ink-2)', fontSize: 11 }}>{d.mime_type || '—'}</td>
              <td style={{ padding: '10px', fontSize: 11, color: 'var(--ink-3)' }}>{d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN') : '—'}</td>
              <td style={{ padding: '10px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {d.file_url && (
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: 'var(--k-primary)', textDecoration: 'none' }}>Open</a>
                  )}
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: 'var(--danger)' }} onClick={() => deleteDoc(d.id)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
          {documents.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No documents found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
