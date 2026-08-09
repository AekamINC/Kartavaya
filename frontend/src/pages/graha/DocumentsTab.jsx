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
import useModuleWrite from '../../hooks/useModuleWrite';

/** 10 MB, matching `uploads.MAX_BYTES` on the server. Stated once here and
 *  once there; the server is the authority and refuses as it reads. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * A document's tags as an ARRAY, whatever shape actually arrived.
 *
 * `graha_documents.tags` is jsonb, and the write path double-encoded it, so the
 * API returned the string `"[]"` rather than `[]`. Anything that reaches for
 * `.map` on that throws, and this tab's row renderer did — one malformed field
 * crashed the entire Graha page through the error boundary.
 */
function asTags(v) {
  if (Array.isArray(v)) return v.filter(t => typeof t === 'string');
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter(t => typeof t === 'string') : [];
    } catch { return []; }
  }
  return [];
}

export default function DocumentsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'add documents' });
  const { pushToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [folderFilter, setFolderFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  // No `file_url` and no `folder`. The user gives a FILE, a name and a client;
  // the server builds `crm/<client_id>/documents/` and mints the URL. Asking a
  // person for a URL to a file that has not been uploaded anywhere was the
  // whole complaint — and there was nothing in the product that would have
  // uploaded it.
  const [form, setForm] = useState({ name: '', client_id: '', description: '' });
  const [file, setFile] = useState(null);
  const [clients, setClients] = useState([]);
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

  // The clients for the dropdown. An enrichment: it failing leaves "Unfiled"
  // as the only option rather than taking the tab down.
  useEffect(() => {
    let alive = true;
    api.get('/v1/graha/clients')
      .then(r => { if (alive) setClients(rows(r)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function createDocument(e) {
    e.preventDefault();
    if (!file) { pushToast({ title: 'Choose a file first', type: 'error' }); return; }
    // Checked here as well as on the server. The server is the authority — it
    // reads with the cap applied rather than buffering and declining — but
    // sending 40 MB up a slow line to be refused at the far end is a bad way to
    // learn the limit exists.
    if (file.size > MAX_DOCUMENT_BYTES) {
      pushToast({ title: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`, type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', form.name || file.name);
      fd.append('client_id', form.client_id);
      fd.append('description', form.description);
      await api.post('/v1/graha/documents/upload', fd);
      pushToast({ title: 'Document uploaded', type: 'success' });
      setShowForm(false);
      setForm({ name: '', client_id: '', description: '' });
      setFile(null);
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
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(true)} disabled={!canWrite} title={denial || undefined}>+ Add Document</button>
      </div>

      {showForm && (
        <form onSubmit={createDocument} className="gr__panel">
          <h3 className="gr__ptitle">Add Document</h3>
          <div className="gr__grid">
            {field('File *', (
              <>
                <input
                  className="k-input"
                  type="file"
                  required
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setFile(f);
                    // The file's own name is the default, so the common case is
                    // choose-and-save. Only overwritten while Name is untouched.
                    if (f && !form.name) setForm(v => ({ ...v, name: f.name }));
                  }}
                />
                <span className="gr__fh">Up to 10 MB.</span>
              </>
            ), ' gr__f--wide')}
            {field('Name *', <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />)}
            {field('Client', (
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                {/* Unfiled is a real place, not a refusal. Documents arrive
                    before anyone has decided whose they are, and forcing the
                    decision now is how they get filed against the wrong one. */}
                <option value="">— Unfiled —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ))}
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
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>{['Name', 'Folder', 'Size', 'Type', 'Uploaded', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id}>
                  <td>
                    <div className="gr__td--name">{d.name}</div>
                    {d.description && <div className="gr__ls">{d.description}</div>}
                    {/* `Array.isArray`, NOT `d.tags?.length > 0`. That guard
                        admits a STRING — `"[]".length` is 2 — and the server
                        was returning exactly that, so `.map` threw
                        `TypeError: r.tags.map is not a function` and the error
                        boundary took the whole Graha page down for any org with
                        a document. The server side is fixed; this stays because
                        a malformed field should cost one cell, not the page. */}
                    {asTags(d.tags).length > 0 && (
                      <div className="gr__chips gr__chips--tight">
                        {asTags(d.tags).map(t => <Badge key={t} text={t} color="var(--st-in-review)" />)}
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
