// Manav → Documents. The personnel file's paperwork.
//
// ── WHY THIS TAB EXISTS ─────────────────────────────────────────────────────
//
// Manav had twenty tables and not one of them held a document. The only
// document tables in the database were `graha_documents` (CRM),
// `hub_kb_documents` and `sign_documents` (e-sign), there was no upload route
// in `routers/manav.py`, and there was no tab. So the employee record could
// hold an encrypted Aadhaar NUMBER and nothing that proves it — a number
// cannot be handed to an auditor and does not expire.
//
// `docs/modules/manav.md` said "it holds identity documents" while the
// generated table list directly beneath it showed no such table. Migration 269
// makes the prose true.
//
// ── THE TAB IS EMPLOYEE-FIRST, NOT DOCUMENT-FIRST ───────────────────────────
//
// The route is `/employees/{id}/documents` and the server scopes every read to
// one employee: admin sees anybody's, everybody else sees only their own. A
// flat "all documents" list would have to fan out over every employee and
// would be refused for most callers on most rows, so the picker comes first
// and the list follows from it.
import React, { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Badge, useList, ErrorNote, Shim, errText } from './_shared';
import DateInput from '../../components/ui/DateInput';

// Mirrors EMPLOYEE_DOC_TYPES in `routers/manav.py`. The server refuses anything
// else with a 400 naming the field, so this list being stale is a visible
// failure rather than a silent one.
const DOC_TYPES = [
  ['aadhaar', 'Aadhaar'],
  ['pan', 'PAN'],
  ['offer_letter', 'Offer letter'],
  ['contract', 'Contract'],
  ['education', 'Education'],
  ['experience', 'Experience'],
  ['bank', 'Bank'],
  ['photo', 'Photograph'],
  ['police_verification', 'Police verification'],
  ['medical', 'Medical'],
  ['other', 'Other'],
];
const TYPE_LABEL = Object.fromEntries(DOC_TYPES);

function fmtSize(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// `expires_on` is a plain date and the row should say when it has passed —
// an expired police verification that looks like any other row is the reason
// the column exists.
function expiryState(iso) {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (iso < today) return 'expired';
  return null;
}

export default function DocumentsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const employees = useList('/v1/manav/employees');
  const [employeeId, setEmployeeId] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    doc_type: 'other', name: '', issued_on: '', expires_on: '', notes: '',
  });

  const docsUrl = employeeId ? `/v1/manav/employees/${employeeId}/documents` : null;
  // `useList` needs a stable url; the second argument re-fetches when it moves.
  const docs = useList(docsUrl || '/v1/manav/employees/none/documents', [docsUrl]);

  async function upload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      pushToast({ title: 'Choose a file first.', type: 'error' });
      return;
    }
    setUploading(true);
    // multipart, because the route takes an UploadFile and reads it with the
    // size cap applied AS IT READS rather than buffering the whole body.
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
    try {
      await api.post(`/v1/manav/employees/${employeeId}/documents`, fd);
      pushToast({ title: 'Document filed', type: 'success' });
      setForm({ doc_type: 'other', name: '', issued_on: '', expires_on: '', notes: '' });
      if (fileRef.current) fileRef.current.value = '';
      docs.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The document could not be filed.'), type: 'error' });
    } finally { setUploading(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/employees/${employeeId}/documents/${id}`);
      pushToast({ title: 'Document removed', type: 'success' });
      docs.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The document could not be removed.'), type: 'error' });
    }
  }

  if (employees.loading) return <Shim count={4} />;
  if (employees.error) {
    return <ErrorNote what="Employees" error={employees.error} onRetry={employees.reload} />;
  }

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Employee</span>
          {/* NAMES, never ids — the value is the id, the label never is. */}
          <select className="k-input mn-f--lg" value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}>
            <option value="">Select employee…</option>
            {employees.items.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name}{emp.employee_code ? ` · ${emp.employee_code}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!employeeId ? (
        <Empty
          icon="📄"
          title="Choose an employee"
          sub="Documents are filed against one person. Pick an employee to see and add theirs."
        />
      ) : (
        <>
          {canWrite && (
            <form onSubmit={upload} className="k-formpanel">
              <h4 className="k-section__title">File a document</h4>
              <p className="k-formpanel__note">
                Kept against this employee only. Reading another person’s
                documents needs admin on Manav.
              </p>
              <div className="k-formpanel__grid k-formpanel__grid--3">
                <label className="k-formpanel__label">
                  <span>File *</span>
                  <input ref={fileRef} className="k-formpanel__input" type="file" required />
                </label>
                <label className="k-formpanel__label">
                  <span>Kind</span>
                  <select className="k-formpanel__input" value={form.doc_type}
                    onChange={e => setForm({ ...form, doc_type: e.target.value })}>
                    {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="k-formpanel__label">
                  <span>Name</span>
                  <input className="k-formpanel__input" value={form.name}
                    placeholder="Defaults to the filename"
                    onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="k-formpanel__label">
                  <span>Issued on</span>
                  {/* DateInput, never a native date input — house rule. */}
                  <DateInput className="k-formpanel__input" type="date" value={form.issued_on}
                    onChange={e => setForm({ ...form, issued_on: e.target.value })} />
                </label>
                <label className="k-formpanel__label">
                  <span>Expires on</span>
                  <DateInput className="k-formpanel__input" type="date" value={form.expires_on}
                    onChange={e => setForm({ ...form, expires_on: e.target.value })} />
                </label>
                <label className="k-formpanel__label">
                  <span>Notes</span>
                  <input className="k-formpanel__input" value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })} />
                </label>
              </div>
              <div className="k-formpanel__actions">
                <button type="submit" className="k-btn k-btn--primary"
                  disabled={uploading || !canWrite} title={denial || undefined}>
                  {uploading ? 'Filing…' : 'File document'}
                </button>
              </div>
            </form>
          )}

          {docs.loading ? <Shim count={3} />
            : docs.error ? (
              <ErrorNote what="Documents for this employee" error={docs.error} onRetry={docs.reload} />
            ) : docs.items.length === 0 ? (
              <Empty
                icon="📄"
                title="No documents yet"
                sub="Nothing has been filed against this employee."
              />
            ) : (
              <DataTable arrange="manav.documents"
                columns={['Name', 'Kind', 'Issued', 'Expires', 'Size', 'Actions']}>
                {docs.items.map(d => {
                  const expired = expiryState(d.expires_on);
                  return (
                    <tr key={d.id}>
                      <Td bold>{d.name}</Td>
                      <Td>
                        <Badge text={TYPE_LABEL[d.doc_type] || d.doc_type}
                          color="var(--on-surface-3)" />
                      </Td>
                      <Td className={d.issued_on ? undefined : 'mn-t__mute'}>
                        {d.issued_on || '—'}
                      </Td>
                      <Td className={expired ? undefined : (d.expires_on ? undefined : 'mn-t__mute')}>
                        {d.expires_on
                          ? (expired
                            ? <Badge text={`Expired ${d.expires_on}`} color="var(--danger)" />
                            : d.expires_on)
                          : '—'}
                      </Td>
                      <Td className="mn-t__mono">{fmtSize(d.file_size)}</Td>
                      <Td>
                        <div className="mn-rowact">
                          {/* The url is presigned and re-signed on every read,
                              so it is only good for a few hours — which is why
                              it is followed here rather than copied anywhere. */}
                          {d.file_url && (
                            <a className="k-btn k-btn--ghost k-btn--sm" href={d.file_url}
                              target="_blank" rel="noreferrer">Open ↗</a>
                          )}
                          {canWrite && (
                            <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                              onClick={() => setConfirm({
                                title: `Remove ${d.name}?`,
                                message: 'The document is removed from this employee’s file. The stored file itself is not destroyed.',
                                confirmLabel: 'Remove',
                                intent: 'danger',
                                onConfirm: () => remove(d.id),
                              })}>
                              Remove
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
        </>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
