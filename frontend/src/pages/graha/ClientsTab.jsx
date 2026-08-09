// Graha · clients — companies, their contacts and their deals.
//
// 51 inline styles are now `gr__*` classes. The largest single removal was a
// hand-rolled `inputStyle` object applied to eleven bare `<input>`s: it
// duplicated `.k-input` approximately, so the client form's fields were a
// slightly different height, radius and background from every other form in
// the product. They are `.k-input` now, which is also why they pick up focus
// rings and the dark theme for free.
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';

export default function ClientsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} });
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState(null);
  // Without this a failed load left `clients` at [] and the list painted its
  // "No clients yet" empty state — a confident wrong answer behind a toast that
  // is gone in four seconds.
  const [err, setErr] = useState(null);
  /* Sort and pagination over the rows this page already has. The SEARCH stays
     server-side — `?search=` is already wired and reaches rows beyond the 200
     the list returns, which a client-side box cannot. Hence showSearch={false}:
     two search boxes on one table is worse than one in the wrong place. */
  const view = useTableView(clients, {
    columns: { contacts: 'contact_count', deals: 'deal_count' },
    filters: [{ key: 'is_sales_customer', label: 'Sales customer' }],
  });

  const load = useCallback(() => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    setErr(null);
    api.get(`/v1/graha/clients${params}`)
      .then(r => setClients(rows(r)))
      .catch(e => { setErr(e); pushToast({ title: 'Failed to load clients', type: 'error' }); })
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.name.trim()) { pushToast({ title: 'Company name is required', type: 'error' }); return; }
    try {
      if (editId) {
        await api.patch(`/v1/graha/clients/${editId}`, form);
        pushToast({ title: 'Client updated', type: 'success' });
      } else {
        await api.post('/v1/graha/clients', form);
        pushToast({ title: 'Client created', type: 'success' });
      }
      setShowForm(false); setEditId(null);
      setForm({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} });
      load();
    } catch { pushToast({ title: 'Could not save client', type: 'error' }); }
  }

  function openEdit(c) {
    setEditId(c.id);
    setForm({ name: c.name, ref_no: c.ref_no || '', gstin: c.gstin || '', website: c.website || '', notes: c.notes || '', address: c.address || {} });
    setDetail(null);
    setShowForm(true);
  }

  async function openDetail(id) {
    setDetailErr(null);
    try {
      const r = await api.get(`/v1/graha/clients/${id}`);
      setDetail(body(r));
    } catch (e) {
      // Was: toast and stay on the list. The click then looked like it had
      // simply not registered.
      setDetailErr(e);
      setDetail({ id });
      pushToast({ title: 'Failed to load client', type: 'error' });
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this client? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/clients/${id}`);
      pushToast({ title: 'Client deleted', type: 'success' });
      setDetail(null);
      load();
    } catch { pushToast({ title: 'Could not delete client', type: 'error' }); }
  }

  if (loading) return <SkeletonRegion label="Loading clients"><SkeletonList rows={6} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  if (detail) {
    return (
      <div>
        <button className="k-btn k-btn--ghost gr__back" onClick={() => { setDetail(null); setDetailErr(null); }}>← Back to clients</button>
        {detailErr ? (
          <ErrorState kind={errorKind(detailErr)} onRetry={() => openDetail(detail.id)} />
        ) : (
          <div className="gr__dsplit">
            <div className="gr__dmain">
              <div className="gr__dhead">
                <h3 className="gr__dname">{detail.name}</h3>
                <div className="gr__dacts">
                  {/* BOTH gated, on the same predicate as `Add Client` and
                      `Update`. Delete was the one write control on this tab
                      with no `canWrite` check at all, so a caller below editor
                      got a live Delete button beside a dead Edit button — which
                      is the asymmetry that was reported as "delete is working
                      but edit is not". The destructive action was the one left
                      open. */}
                  <button className="k-btn k-btn--ghost" onClick={() => openEdit(detail)}
                    disabled={!canWrite} title={denial || undefined}>Edit</button>
                  <button className="k-btn k-btn--reject" onClick={() => remove(detail.id)}
                    disabled={!canWrite} title={denial || undefined}>Delete</button>
                </div>
              </div>
              {detail.ref_no && <div className="gr__dline">Ref: {detail.ref_no}</div>}
              {detail.gstin && <div className="gr__dline">GSTIN: {detail.gstin}</div>}
              {detail.website && <div className="gr__dline">Web: {detail.website}</div>}
              {detail.address?.line1 && (
                <div className="gr__dline">
                  Address: {[detail.address.line1, detail.address.line2, detail.address.city, detail.address.state, detail.address.pincode].filter(Boolean).join(', ')}
                </div>
              )}
              {detail.notes && <div className="gr__dnotes">{detail.notes}</div>}
            </div>

            <div className="gr__daside">
              <h4 className="gr__dsec">Contacts ({detail.contacts?.length || 0})</h4>
              {(detail.contacts || []).map(c => (
                <div key={c.id} className="gr__lrow gr__lrow--tight">
                  <div className="gr__lmain">
                    <span className="gr__lt--sm">{c.name}</span>
                    {c.designation && <span className="gr__ls"> · {c.designation}</span>}
                    {c.email && <div className="gr__ls">{c.email}</div>}
                  </div>
                </div>
              ))}
              {!detail.contacts?.length && <p className="gr__mute">No contacts linked</p>}

              <h4 className="gr__dsec">Deals ({detail.deals?.length || 0})</h4>
              {(detail.deals || []).map(d => (
                <div key={d.id} className="gr__kv">
                  <span>{d.title}</span>
                  <span className="gr__val">{inr(Number(d.value || 0))}</span>
                </div>
              ))}
              {!detail.deals?.length && <p className="gr__mute">No deals linked</p>}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="gr__bar">
        <input className="k-input gr__search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…" />
        <button
          className="k-btn k-btn--primary"
          onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} }); }} disabled={!canWrite} title={denial || undefined}>
          + Add Client
        </button>
      </div>

      {showForm && (
        <div className="gr__panel">
          <h4 className="gr__ptitle gr__ptitle--sm">{editId ? 'Edit' : 'New'} Client</h4>
          <div className="gr__grid--auto gr__grid">
            <input className="k-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company Name *" aria-label="Company name" />
            <input className="k-input" value={form.ref_no} onChange={e => setForm(f => ({ ...f, ref_no: e.target.value }))} placeholder="Ref No" aria-label="Reference number" />
            <input className="k-input" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="GST No" aria-label="GSTIN" />
            <input className="k-input" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="Website" aria-label="Website" />
            <input className="k-input" value={form.address?.line1 || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, line1: e.target.value } }))} placeholder="Address Line 1" aria-label="Address line 1" />
            <input className="k-input" value={form.address?.line2 || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, line2: e.target.value } }))} placeholder="Address Line 2" aria-label="Address line 2" />
            <input className="k-input" value={form.address?.city || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, city: e.target.value } }))} placeholder="City" aria-label="City" />
            <input className="k-input" value={form.address?.state || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, state: e.target.value } }))} placeholder="State" aria-label="State" />
            <input className="k-input" value={form.address?.pincode || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, pincode: e.target.value } }))} placeholder="Pincode" aria-label="Pincode" />
          </div>
          <label className="gr__f gr__f--block"><span className="gr__fl">Notes</span>
            <textarea className="k-input gr__ta" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></label>
          {/* The denial said ON THE PAGE, not only in a `title`. A greyed
              Update with a tooltip is indistinguishable from a button that does
              not work: the reporter pressed it, nothing happened, no request
              left the browser and no toast appeared. A tooltip needs a hover
              the reporter had no reason to perform, and it is unreachable by
              touch entirely. */}
          {!canWrite && denial && <p className="gr__mute" role="status">{denial}</p>}
          <div className="gr__acts gr__acts--start">
            <button className="k-btn k-btn--primary" onClick={save} disabled={!canWrite} title={denial || undefined}>{editId ? 'Update' : 'Create'}</button>
            <button className="k-btn k-btn--ghost" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {clients.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No clients yet', hi: 'कोई ग्राहक नहीं' }}
          description="A client is the company a contact and a deal belong to. Add your first company to group them."
          action={canWrite ? 'Add Client' : undefined}
          onAction={canWrite ? () => { setShowForm(true); setEditId(null); } : undefined}
        />
      ) : (
        <div className="tv-card">
          <TableToolbar view={view} label="clients" showSearch={false} />
          <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                <HeadCell sortKey="name" sort={view.sort} onSort={view.onSort}>Company</HeadCell>
                <HeadCell sortKey="ref_no" sort={view.sort} onSort={view.onSort}>Ref No</HeadCell>
                <HeadCell sortKey="gstin" sort={view.sort} onSort={view.onSort}>GSTIN</HeadCell>
                <th>Website</th>
                <HeadCell sortKey="contacts" sort={view.sort} onSort={view.onSort} className="gr__td--mid">Contacts</HeadCell>
                <HeadCell sortKey="deals" sort={view.sort} onSort={view.onSort} className="gr__td--mid">Deals</HeadCell>
              </tr>
            </thead>
            <tbody>
              {view.rows.map(c => (
                <tr key={c.id} className="gr__tr--click" onClick={() => openDetail(c.id)}>
                  {/* A real button on the name, so the record is reachable by
                      keyboard — the row's onClick alone was mouse-only, and
                      nothing else in the row opened it. Same shape as
                      `ganit/InvoicesTab` and `graha/DealsTab`. */}
                  <td className="gr__td--name">
                    <button
                      type="button"
                      className="gr__link"
                      onClick={e => { e.stopPropagation(); openDetail(c.id); }}
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className="gr__td--mute">{c.ref_no || '—'}</td>
                  <td className="gr__td--mute">{c.gstin || '—'}</td>
                  <td className="gr__td--mute">{c.website || '—'}</td>
                  <td className="gr__td--mid">{c.contact_count}</td>
                  <td className="gr__td--mid">{c.deal_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
