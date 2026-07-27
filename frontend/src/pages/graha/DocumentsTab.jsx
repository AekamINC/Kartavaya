// Graha · documents — the CRM document register.
//
// 38 inline styles are now `gr__*` classes. The load carried the usual
// `catch { toast }` and fell through to "No documents found", so a failed fetch
// claimed the register was empty; it now has an error state with a retry.
//
// Note this is the CRM's own document list, not the file-attachment surface —
// `18-documents.md` describes the PRINT documents, and attachments are specced
// in `03` §5. The `_SOURCE-MAP.md` warns that this confusion has been made
// before, so: no drop zone and no lightbox here on purpose.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { Badge } from './_shared';

export default function DocumentsTab() {
  const { pushToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [folderFilter, setFolderFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', file_url: '', folder: '', description: '', tags: '' });
  const [saving, setSaving] = useState(false);

  const fmtSize = bytes => {
    if (!bytes) return '—';
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  useEffect(() => { load(); loadFolders(); }, []);

  async function load() {
    setErr(null);
    try {
      let url = '/v1/graha/documents?';
      if (folderFilter) url += `folder=${encodeURIComponent(folderFilter)}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      const r = await api.get(url);
      setDocuments(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load documents', type: 'error' });
    }
    finally { setLoading(false); }
  }

  // The folder filter is an enrichment: it failing leaves "All Folders" as the
  // only option rather than blocking the register.
  async function loadFolders() {
    try {
      const r = await api.get('/v1/graha/documents/folders');
      setFolders(rows(r));
    } catch { /* filter offers "All Folders" only */ }
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
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
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

  const field = (label, node, mod = '') => (
    <label className={`gr__f${mod}`}><span className="gr__fl">{label}</span>{node}</label>
  );

  return (
    <div>
      <div className="gr__bar">
        <select className="k-input gr__sel gr__sel--wide" aria-label="Filter by folder" value={folderFilter} onChange={e => setFolderFilter(e.target.value)}>
          <option value="">All Folders</option>
          {folders.map(f => <option key={f.folder} value={f.folder}>{f.folder} ({f.count})</option>)}
        </select>
        <input className="k-input gr__search" placeholder="Search documents…" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <button className="k-btn k-btn--ghost" onClick={load}>Search</button>
        <div className="gr__spacer" />
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(true)}>+ Add Document</button>
      </div>

      {showForm && (
        <form onSubmit={createDocument} className="gr__panel">
          <h3 className="gr__ptitle">Add Document</h3>
          <div className="gr__grid">
            {field('Name *', <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />)}
            {field('File URL *', <input className="k-input" required value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://…" />)}
            {field('Folder', <input className="k-input" value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })} placeholder="e.g. contracts, invoices" />)}
            {field('Tags (comma-separated)', <input className="k-input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="e.g. legal, signed" />)}
            {field('Description', <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />, ' gr__f--wide')}
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Add Document'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading documents"><SkeletonList rows={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : (
        <div className="gr__tblwrap gr__tblwrap--bare">
          <table className="gr__tbl">
            <thead>
              <tr>{['Name', 'Folder', 'Size', 'Type', 'Uploaded', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id}>
                  <td>
                    <div className="gr__td--name">{d.name}</div>
                    {d.description && <div className="gr__ls">{d.description}</div>}
                    {d.tags?.length > 0 && (
                      <div className="gr__chips gr__chips--tight">
                        {d.tags.map(t => <Badge key={t} text={t} color="var(--st-in-review)" />)}
                      </div>
                    )}
                  </td>
                  <td className="gr__td--mute">{d.folder || '—'}</td>
                  <td className="gr__td--mute">{fmtSize(d.file_size)}</td>
                  <td className="gr__td--mute gr__td--id">{d.mime_type || '—'}</td>
                  <td className="gr__td--when">{d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN') : '—'}</td>
                  <td>
                    <div className="gr__sacts">
                      {d.file_url && (
                        <a className="k-btn k-btn--ghost" href={d.file_url} target="_blank" rel="noopener noreferrer">Open</a>
                      )}
                      <button className="k-btn k-btn--reject" onClick={() => deleteDoc(d.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr><td className="gr__none" colSpan={6}>No documents found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
