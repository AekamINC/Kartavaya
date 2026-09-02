// Graha · clients — companies, their contacts and their deals.
//
// 51 inline styles are now `gr__*` classes. The largest single removal was a
// hand-rolled `inputStyle` object applied to eleven bare `<input>`s: it
// duplicated `.k-input` approximately, so the client form's fields were a
// slightly different height, radius and background from every other form in
// the product. They are `.k-input` now, which is also why they pick up focus
// rings and the dark theme for free.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import AddressBlock from '../../components/ui/AddressBlock';
import ClientLocations, { placeOf } from '../../components/ClientLocations';
import ObligationsSection from './ObligationsSection';
import PinAreaPopover from '../../components/PinAreaPopover';
import CoordinateCapture from '../../components/CoordinateCapture';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
// `CreatedHead` is gone: the header is rendered from the column declaration
// below, which is what lets it be moved, hidden and resized. The CELL is
// unchanged — CreatedCell is the product's one created-date renderer, and
// ByCell the one that renders a NAME and never the user id behind it.
import {
  CreatedCell, UpdatedCell, ByCell, CREATED_KEY, UPDATED_KEY,
} from '../../components/ui/CreatedColumn';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * What this table HAS, declared once — the floor `useColumnPrefs` resolves a
 * saved arrangement against. Frontend CODE and never a row, so a column added
 * here appears for everybody, including people who arranged this table before
 * it existed (it lands at the end, visible).
 *
 * `fixed` on Company because a CRM client IS the company: hide that and the
 * row identifies nothing. Website carries no `sortKey` — it never did, and
 * being arrangeable does not make a column sortable.
 */
const CLIENT_COLUMNS = [
  { id: 'name', label: 'Company', sortKey: 'name', fixed: true },
  { id: 'ref_no', label: 'Ref No', sortKey: 'ref_no' },
  { id: 'gstin', label: 'GSTIN', sortKey: 'gstin' },
  { id: 'website', label: 'Website' },
  { id: 'contacts', label: 'Contacts', sortKey: 'contacts', className: 'gr__td--mid' },
  { id: 'deals', label: 'Deals', sortKey: 'deals', className: 'gr__td--mid' },
  // `useTableView` sorts this for free: it compares dates as dates and puts
  // blanks last in BOTH directions, which is the same contract CreatedColumn
  // states for tables not on the hook.
  { id: CREATED_KEY, label: 'Created', sortKey: CREATED_KEY, className: 'tbl__created' },
  /* WHO added the company, and who last edited it. "Added by" rather than
     "Created by": a CRM client is the CUSTOMER — a company that already
     existed long before anybody typed it in here — so "created" would claim
     something this record did not do. Somebody ADDED it to the register.

     The updater half earns its column separately. A client row carries the
     GSTIN and the address every invoice to that company is raised against, so
     a quiet edit to either propagates into documents that have already gone
     out. `updated_at` + `updated_by_name` is the only place on this screen
     that says an edit happened at all.

     Names, never ids: `created_by`/`updated_by` hold `users.user_id`, the API
     resolves each to a display name (never an email — that ladder stops at
     names on purpose), and `has_creator`/`has_updater` are what keep a
     deleted account (`unknown`) distinct from no actor at all (an em dash). */
  { id: 'created_by_name', label: 'Added by', sortKey: 'created_by_name', className: 'tbl__by' },
  { id: UPDATED_KEY, label: 'Updated', sortKey: UPDATED_KEY, className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Updated by', sortKey: 'updated_by_name', className: 'tbl__by' },
];

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
  /* 8.3 — the locations panel, closed by default.
     Closed because it is a second reading of a table the user came here to
     read, not because it is unimportant; the toggle carries the headline count
     so the tab says something true about coverage without being opened. */
  const [showWhere, setShowWhere] = useState(false);
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

  /* Which columns, in what order, at what width — the sibling hook. Called
     here beside useTableView and above every early return, for the reason
     ContactsTab records: a branch that renders fewer hooks than the list did
     is "Rendered fewer hooks than expected" and the screen does not open. */
  const cols = useColumnPrefs('graha.clients', CLIENT_COLUMNS);

  /* How many distinct pincode areas these companies fall in — the one number
     the closed toggle can honestly show. Zero is a real answer and is said as
     one: all 61 companies in E2E Test & Associates carry an address and not one
     of them carries a pincode, so "0 areas" is the state of the data rather
     than a panel that failed to load. Above the early returns, with the other
     hooks, for the reason the block above records. */
  const pinAreas = useMemo(
    () => new Set(clients.map(c => placeOf(c?.address).pin).filter(Boolean)).size,
    [clients],
  );

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
              {/* 8.0 — the address, and the way out to a map. No guard here on
                  purpose: `AddressBlock` owns the decision about whether there
                  is an address at all, and it is not a decision a call site can
                  make correctly.

                  The line this replaced gated on `detail.address?.line1` and
                  joined `line1, line2, city, state, pincode`. Both halves were
                  wrong against the live rows, in opposite directions:

                    · Unicode's `Navrang Polymers` has no `line1`. It has 43
                      keys, 42 of them a character each, and one genuine `city`
                      of "Navi Mumbai" — so the gate hid an address we hold.
                    · E2E Test & Associates' 61 clients carry `state_code` and
                      never `state`, so every one of them rendered its state as
                      nothing while the code sat in the row.

                  Both are right now, and neither needed a special case: the
                  component reads the seven keys by name and resolves the GST
                  code to a state NAME. */}
              {/* 8.2 — and the pincode opens its postal area. Passed as a
                  render prop rather than imported by `AddressBlock`, so the
                  five other pages that show an address do not acquire a
                  component that makes a network call. `PinAreaPopover` returns
                  plain inert text for a value that is not a PIN, so `INC UK`'s
                  `NW1 245` renders exactly as stored and opens nothing. */}
              <AddressBlock
                address={detail.address}
                renderPincode={pin => <PinAreaPopover pincode={pin} />}
              />
              {/* 8.4 — the exact location, written only when someone presses
                  the button. Nothing here geocodes the address on open: a
                  view-time lookup is metered and sends a client's premises to
                  a vendor every time the record is read. The DIGIPIN comes
                  back on the response and is never computed in the browser. */}
              <CoordinateCapture
                kind="clients"
                recordId={detail.id}
                name={detail.name}
                lat={detail.lat}
                lng={detail.lng}
                geoSource={detail.geo_source}
                digipin={detail.digipin}
                onChange={geo => setDetail(d => ({ ...d, ...geo }))}
              />
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

              {/* The statutory register. Last in the aside because it is the
                  only section here that is WRITTEN from this screen — contacts
                  and deals are summaries of their own tabs, and putting an
                  editable block above two read-only ones reads as if they were
                  editable too.

                  It is also the block that unblocks two skills: the filing
                  calendar returns an empty month for every client until
                  something here has a row. */}
              <ObligationsSection clientId={detail.id} />
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
        {/* 8.3. Not gated on `canWrite`: it reads the rows already on screen
            and writes nothing. Hidden entirely when there are no companies —
            the empty state below already says the whole story. */}
        {clients.length > 0 && (
          <button
            type="button"
            className="k-btn k-btn--ghost"
            aria-expanded={showWhere}
            onClick={() => setShowWhere(v => !v)}
          >
            {showWhere ? 'Hide locations' : `Locations · ${pinAreas} pincode ${pinAreas === 1 ? 'area' : 'areas'}`}
          </button>
        )}
      </div>

      {showWhere && clients.length > 0 && <ClientLocations clients={clients} />}

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
          <TableToolbar view={view} label="clients" showSearch={false}>
            <ColumnsButton cols={cols} />
          </TableToolbar>
          <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              {/* Heads come out of the arrangement, not out of seven literals:
                  the order, the widths and which of them render at all are the
                  same list the cells below are keyed on, so the two cannot
                  drift by a column. */}
              <tr>
                {cols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    sortKey={c.sortKey}
                    sort={view.sort}
                    onSort={c.sortKey ? view.onSort : undefined}
                    className={c.className}
                    width={c.width}
                    onResize={w => cols.setWidth(c.id, w)}
                  >
                    {c.label}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map(c => (
                <tr key={c.id} className="gr__tr--click" onClick={() => openDetail(c.id)}>
                  {/* A real button on the name, so the record is reachable by
                      keyboard — the row's onClick alone was mouse-only, and
                      nothing else in the row opened it. Same shape as
                      `ganit/InvoicesTab` and `graha/DealsTab`. */}
                  {cols.cells({
                    name: (
                      <td className="gr__td--name">
                        <button
                          type="button"
                          className="gr__link"
                          onClick={e => { e.stopPropagation(); openDetail(c.id); }}
                        >
                          {c.name}
                        </button>
                      </td>
                    ),
                    ref_no: <td className="gr__td--mute">{c.ref_no || '—'}</td>,
                    gstin: <td className="gr__td--mute">{c.gstin || '—'}</td>,
                    website: <td className="gr__td--mute">{c.website || '—'}</td>,
                    contacts: <td className="gr__td--mid">{c.contact_count}</td>,
                    deals: <td className="gr__td--mid">{c.deal_count}</td>,
                    [CREATED_KEY]: <CreatedCell value={c.created_at} />,
                    created_by_name: <ByCell name={c.created_by_name} hasActor={c.has_creator} />,
                    [UPDATED_KEY]: <UpdatedCell value={c.updated_at} />,
                    updated_by_name: <ByCell name={c.updated_by_name} hasActor={c.has_updater} />,
                  })}
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
