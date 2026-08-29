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
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { Badge } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
// The audit cells. This register had its OWN date rendering —
// `new Date(d.created_at).toLocaleDateString('en-IN')`, which prints
// "16/6/2026" — while every other table in the product prints "16 Jun 2026"
// through `CreatedCell`. Two formats a tab apart is a reader silently doing
// day/month arithmetic to check they agree, so the local one is gone and this
// column is the shared one. It keeps its "Uploaded" heading: the format is the
// product's business, the WORD is this module's.
import {
  CreatedCell, UpdatedCell, ByCell, CREATED_KEY, UPDATED_KEY,
} from '../../components/ui/CreatedColumn';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * The register's columns, declared once, in the order they shipped.
 *
 * `fixed` on Name — it carries the description and the tag chips as well as the
 * title, so it is not merely the identity column, it is most of the row.
 * `fixed` on Actions: Open and Delete are the only two things you can do to a
 * document from here, and a register you cannot open a document from is a list
 * of filenames.
 */
const DOCUMENT_COLUMNS = [
  { id: 'name', label: 'Name', sortKey: 'name', fixed: true },
  { id: 'folder', label: 'Folder', sortKey: 'folder' },
  { id: 'file_size', label: 'Size', sortKey: 'file_size', num: true },
  { id: 'file_type', label: 'Type', sortKey: 'file_type' },
  { id: CREATED_KEY, label: 'Uploaded', sortKey: CREATED_KEY, className: 'tbl__created' },
  /* WHO put the file here, and who last changed the record.

     "Uploaded by" is the only honest verb: on this table the author column is
     literally called `uploaded_by` (it predates the audit migrations and was
     deliberately NOT renamed — see the note in routers/graha.py), and the
     server hand-resolves it to the SAME `created_by_name` / `has_creator`
     pair every other list emits. So the wire contract is identical and only
     the heading is local.

     A document register without an uploader is the case this whole exercise
     is for: a file appears in a client's folder and the only question anyone
     ever asks is who put it there. `updated_*` is the second half — a name or
     a description edited after upload, which changes what the register SAYS a
     file is without changing the file.

     `has_creator` / `has_updater` are passed, not skipped: a document
     uploaded by someone who has since left resolves to a null name, and
     without the boolean ByCell renders an em dash meaning "nobody uploaded
     this" — about a row that plainly exists. */
  { id: 'created_by_name', label: 'Uploaded by', sortKey: 'created_by_name', className: 'tbl__by' },
  { id: UPDATED_KEY, label: 'Updated', sortKey: UPDATED_KEY, className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Updated by', sortKey: 'updated_by_name', className: 'tbl__by' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

/** 10 MB, matching `uploads.MAX_BYTES` on the server. Stated once here and
 *  once there; the server is the authority and refuses as it reads. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Must stay equal to `STAGE2_AFTER_DAYS` in `backend/services/recycle_bin.py`,
 *  which is what actually enforces the first-stage window. This only draws the
 *  sentence in the delete confirmation. */
const RECYCLE_BIN_DAYS = 14;

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
  // The one dialog state for this tab. Object, not boolean — ConfirmDialog
  // holds the last non-null value through its exit animation, so a dialog that
  // is closing still has a title and buttons to draw.
  const [confirm, setConfirm] = useState(null);

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

  /**
   * DELETE A DOCUMENT — two things were wrong here and they are different
   * problems.
   *
   * 1 · `window.confirm`. `ConfirmDialog`'s own header says it "replaces
   *     window.confirm throughout the app", and this was one of the last call
   *     sites that had not moved. The native dialog has no focus trap, no
   *     `role="alertdialog"`, no scroll lock, cannot carry a typed
   *     confirmation, and is styled by the browser rather than by this product.
   *
   * 2 · **"This cannot be undone" is now false.** `DELETE /v1/graha/documents/
   *     {id}` writes a `staging.deleted_files` row BEFORE it sets
   *     `is_active=FALSE`, and refuses the whole delete if the bin write fails
   *     (`routers/graha.py`) — so the document is recoverable from the org's
   *     recycle bin for 14 days, and from the second-stage bin to 90. A dialog
   *     that tells a customer their file is gone forever, about a file that is
   *     not gone, teaches them to keep a copy of everything outside the
   *     product.
   *
   * The wording matches `TaskDrawer.jsx removeAttachment` deliberately: those
   * are the only two surfaces in this product that bin a file, and two
   * sentences for one act is how they drift into contradicting each other.
   * Including the split on the key — `bin_file` returns None when there is no
   * `r2_key`, so a document whose object this product can no longer address is
   * deactivated with nothing in the bin behind it, and promising a restore over
   * one of those is a promise the server cannot keep.
   */
  function deleteDoc(doc) {
    const label = doc.name || 'this document';
    setConfirm({
      title: 'Move to recycle bin?',
      message: doc.file_key
        ? `"${label}" moves to your organisation's recycle bin. An owner or admin can restore it for ${RECYCLE_BIN_DAYS} days.`
        : `"${label}" will be removed. This record has no stored file reference, so it cannot be recovered.`,
      confirmLabel: 'Move to bin',
      intent: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/v1/graha/documents/${doc.id}`);
          pushToast({
            title: doc.file_key ? `"${label}" moved to the recycle bin` : `"${label}" removed`,
            type: 'success',
          });
          setDocuments(prev => prev.filter(d => d.id !== doc.id));
          loadFolders();
        } catch (e) {
          pushToast({
            // The server's own sentence. A bin write that failed answers 500
            // with "it has not been removed", which is the opposite of what a
            // generic failure implies about the state of the row.
            title: e?.response?.data?.detail || 'Could not delete document',
            type: 'error',
          });
        }
      },
    });
  }

  const field = (label, node, mod = '') => (
    <label className={`gr__f${mod}`}><span className="gr__fl">{label}</span>{node}</label>
  );

  const view = useTableView(documents, {
    searchKeys: ['name', 'description'],
    filters: [{ key: 'folder', label: 'Folder' }, { key: 'file_type', label: 'Type' }],
  });
  const cols = useColumnPrefs('graha.documents', DOCUMENT_COLUMNS);
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
        <div className="tv-card">
        <TableToolbar view={view} label="documents">
          <ColumnsButton cols={cols} />
        </TableToolbar>
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                {cols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    sortKey={c.sortKey}
                    sort={view.sort}
                    onSort={c.sortKey ? view.onSort : undefined}
                    num={c.num}
                    className={c.className}
                    width={c.width}
                    onResize={w => cols.setWidth(c.id, w)}
                  >
                    {c.sr ? <span className="sr-only">{c.label}</span> : c.label}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map(d => (
                <tr key={d.id}>
                  {cols.cells({
                    name: (
                      <td>
                        <div className="gr__td--name">{d.name}</div>
                        {d.description && <div className="gr__ls">{d.description}</div>}
                        {/* `Array.isArray`, NOT `d.tags?.length > 0`. That guard
                            admits a STRING — `"[]".length` is 2 — and the server
                            was returning exactly that, so `.map` threw
                            `TypeError: r.tags.map is not a function` and the
                            error boundary took the whole Graha page down for any
                            org with a document. The server side is fixed; this
                            stays because a malformed field should cost one cell,
                            not the page. */}
                        {asTags(d.tags).length > 0 && (
                          <div className="gr__chips gr__chips--tight">
                            {asTags(d.tags).map(t => <Badge key={t} text={t} color="var(--st-in-review)" />)}
                          </div>
                        )}
                      </td>
                    ),
                    folder: <td className="gr__td--mute">{d.folder || '—'}</td>,
                    file_size: <td className="gr__td--mute">{fmtSize(d.file_size)}</td>,
                    file_type: <td className="gr__td--mute gr__td--id">{d.mime_type || '—'}</td>,
                    [CREATED_KEY]: <CreatedCell value={d.created_at} />,
                    created_by_name: <ByCell name={d.created_by_name} hasActor={d.has_creator} />,
                    [UPDATED_KEY]: <UpdatedCell value={d.updated_at} />,
                    updated_by_name: <ByCell name={d.updated_by_name} hasActor={d.has_updater} />,
                    actions: (
                      <td>
                        <div className="gr__sacts">
                          {d.file_url && (
                            <a className="k-btn k-btn--ghost" href={d.file_url} target="_blank" rel="noopener noreferrer">Open</a>
                          )}
                          <button className="k-btn k-btn--reject" onClick={() => deleteDoc(d)}>Delete</button>
                        </div>
                      </td>
                    ),
                  })}
                </tr>
              ))}
              {documents.length === 0 && (
                <tr><td className="gr__none" colSpan={cols.columns.length}>No documents found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
