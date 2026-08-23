// Graha · contacts — the list, the create form, and the contact record.
//
// This file carried 104 inline styles, the largest single cluster in the
// codebase. They are now `gr__*` classes in `styles/graha.css`; the only
// surviving inline is `--c` on a label chip, whose colour is user data and
// therefore cannot live in a stylesheet (check-tokens deviation 2).
//
// Reads go through `rows()` / `body()` from `lib/api.js`. This route answers
// `{"data": […]}` today, but 28 of 127 backend GETs answer a bare array with no
// rule distinguishing them, and `r.data.data || []` silently becomes `[]` under
// the other shape — an empty list is indistinguishable from a broken one.
import React, { useState, useEffect } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Badge, CONTACT_TYPES, TYPE_COLORS, stageColor, SOURCE_COLORS } from './_shared';
import ContactTimeline from './ContactTimeline';
import { inr } from '../../lib/inr';
import { useDocumentDownload } from '../../lib/documents';
import DocumentError from '../../components/ui/DocumentError';
import useModuleWrite from '../../hooks/useModuleWrite';
import CustomFieldInputs from './CustomFieldInputs';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
// `CreatedHead` is gone from this file: the header is rendered from the column
// declaration below, which is what lets it be moved, hidden and resized. The
// CELL is unchanged — CreatedCell is the product's one created-date renderer.
import {
  CreatedCell, UpdatedCell, ByCell, CREATED_KEY, UPDATED_KEY,
} from '../../components/ui/CreatedColumn';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * What this table HAS, declared once — the floor `useColumnPrefs` resolves a
 * saved arrangement against. It is frontend CODE and never a row, so a column
 * added here appears for everybody, including people who arranged this table
 * before it existed (it lands at the end, visible).
 *
 * `fixed` on Name and Actions: Name is how you identify which contact a row
 * is, and Actions is how you delete one. Hiding either leaves a table you
 * cannot act on, so the sheet renders both ticks disabled rather than letting
 * the arrangement produce that state.
 */
const CONTACT_COLUMNS = [
  { id: 'name', label: 'Name', sortKey: 'name', fixed: true },
  { id: 'company', label: 'Company', sortKey: 'company' },
  { id: 'email', label: 'Email', sortKey: 'email' },
  { id: 'phone', label: 'Phone', sortKey: 'phone' },
  { id: 'contact_type', label: 'Type', sortKey: 'contact_type' },
  { id: 'source', label: 'Source', sortKey: 'source' },
  { id: 'lead_score', label: 'Score', sortKey: 'lead_score', num: true },
  { id: CREATED_KEY, label: 'Created', sortKey: CREATED_KEY, className: 'tbl__created' },
  /* WHO added this person, and who last changed their details.

     Contacts are the row type that turns over: people come and go while the
     customer stays, so a contact list is constantly re-keyed by whoever spoke
     to them last. "Added by" says who put them in — the person to ask where a
     phone number came from — and the updater pair says whether the number in
     front of you is still the one that was added or somebody's later
     correction. Without them a stale mobile number is indistinguishable from
     a freshly confirmed one.

     `created_by_name` / `updated_by_name` are resolved NAMES; the underlying
     `*_by` columns are `users.user_id` and never reach the screen.
     `has_creator` / `has_updater` keep "the account that did this is gone"
     (`unknown`) apart from "nobody is recorded" (an em dash) — the same
     distinction the API bothers to send two booleans for.

     Before Actions, matching Created: Delete stays at the row's right edge,
     where every other table in the product puts its verbs. */
  { id: 'created_by_name', label: 'Added by', sortKey: 'created_by_name', className: 'tbl__by' },
  { id: UPDATED_KEY, label: 'Updated', sortKey: UPDATED_KEY, className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Updated by', sortKey: 'updated_by_name', className: 'tbl__by' },
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

/**
 * The Indian financial year to date: 1 April → today.
 *
 * Not the calendar year, and not a rolling 12 months. A statement of account is
 * reconciled against books kept on the FY, and an April-to-today window is the
 * one a firm actually asks for. The statement's opening balance carries
 * everything before the window, so a shorter window never understates the debt.
 */
function financialYearToDate(today = new Date()) {
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const iso = d => d.toISOString().slice(0, 10);
  return { start: `${year}-04-01`, end: iso(today) };
}

/**
 * @param {object} props
 * @param {boolean} [props.crm=true] — is the CRM itself on the other side of
 *   this render?
 *
 *   ONE component serves Graha, Ganit and Vikray: a contact is the same person
 *   whichever module you reached them from, and a copy per module is how the
 *   three drift apart. The contact ROUTES are gated `graha OR ganit OR vikray`
 *   (`routers/graha.py::_crm_entity_gate`), but the CRM's own working objects —
 *   the timeline, lead conversion, labels — stay `graha`-only on purpose.
 *
 *   So this prop hides the controls that would call a route the caller may not
 *   hold, rather than branching on a global or asking the server twice. It is
 *   `false` from Ganit and Vikray, where a firm may never have bought the CRM;
 *   everything that is genuinely about the PERSON — the record, the edit form,
 *   the company link, the statement of account — renders identically in all
 *   three.
 */
export default function ContactsTab({ crm = true }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'add contacts' });
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', designation: '', contact_type: 'lead', gstin: '', source: '', client_id: '', custom_data: {} });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState(null);
  const [clientOptions, setClientOptions] = useState([]);
  const [editContact, setEditContact] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  // A failed load left `contacts` at [] and rendered the "No contacts yet"
  // EmptyState — which invites the user to add one, on a list that may be full.
  const [err, setErr] = useState(null);

  const statement = useDocumentDownload();
  const [soaPeriod, setSoaPeriod] = useState(financialYearToDate);

  useEffect(() => {
    // The client dropdown is an enrichment: it failing must not take the list
    // with it, so the form simply offers "— None —" and nothing else.
    api.get('/v1/graha/clients').then(r => setClientOptions(rows(r))).catch(() => {});
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      let url = '/v1/graha/contacts?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (typeFilter) url += `contact_type=${typeFilter}&`;
      const r = await api.get(url);
      setContacts(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load contacts', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/contacts', form);
      pushToast({ title: 'Contact created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', email: '', phone: '', designation: '', contact_type: 'lead', gstin: '', source: '', client_id: '', custom_data: {} });
      load();
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function startEditContact(c) {
    setEditContact({
      id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', mobile: c.mobile || '',
      client_id: c.client_id || '', designation: c.designation || '', contact_type: c.contact_type || 'lead',
      notes: c.notes || '', source: c.source || '', lead_score: c.lead_score ?? '', website: c.website || '',
      gstin: c.gstin || '', pan: c.pan || '', custom_data: c.custom_data || {},
    });
  }

  async function saveEditContact() {
    if (!editContact) return;
    setEditSaving(true);
    try {
      const { id, ...fields } = editContact;
      await api.patch(`/v1/graha/contacts/${id}`, fields);
      pushToast({ title: 'Contact updated', type: 'success' });
      setEditContact(null);
      loadDetail(id);
      load();
    } catch { pushToast({ title: 'Could not update contact', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function loadDetail(id) {
    setDetailErr(null);
    try {
      const r = await api.get(`/v1/graha/contacts/${id}`);
      setDetail(body(r));
    } catch (e) {
      // Opening a record that fails must say so. Leaving `detail` null bounced
      // the user back to the list with a four-second toast as the only trace.
      setDetailErr(e);
      setDetail({ contact: { id } });
      pushToast({ title: 'Failed to load contact', type: 'error' });
    }
  }

  async function deleteContact(id) {
    if (!window.confirm('Delete this contact? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/contacts/${id}`);
      setContacts(prev => prev.filter(c => c.id !== id));
      if (detail?.contact?.id === id) setDetail(null);
      pushToast({ title: 'Contact deleted', type: 'success' });
    } catch { pushToast({ title: 'Could not delete contact', type: 'error' }); }
  }

  async function convertLead(id) {
    try {
      await api.post(`/v1/graha/contacts/${id}/convert`);
      pushToast({ title: 'Lead converted to customer', type: 'success' });
      loadDetail(id);
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Conversion failed', type: 'error' }); }
  }

  async function removeLabel(contactId, labelId) {
    try {
      await api.delete(`/v1/graha/contacts/${contactId}/labels/${labelId}`);
      pushToast({ title: 'Label removed', type: 'success' });
      loadDetail(contactId);
    } catch { pushToast({ title: 'Failed to remove label', type: 'error' }); }
  }

  const field = (label, node, mod = '') => (
    <label className={`gr__f${mod}`}><span className="gr__fl">{label}</span>{node}</label>
  );

  /* Sort and pagination only: this list's SEARCH is server-side already and
     reaches rows past the 200 the endpoint returns, which a client-side box
     cannot. Two search boxes on one table is worse than one in the wrong place.

     ── IT HAS TO BE CALLED HERE, ABOVE THE EARLY RETURN ────────────────────
     `useTableView` is five `useState`s and four `useMemo`s. It sat below the
     `if (detail)` return, so opening a contact rendered NINE FEWER HOOKS than
     the list did and React threw "Rendered fewer hooks than expected" — the
     record screen could not open at all. Moved, not rewritten: it takes
     `contacts`, which the detail branch does not touch, so the list's sort and
     page survive going into a record and coming back out. */
  const view = useTableView(contacts, {
    filters: [{ key: 'contact_type', label: 'Type' }, { key: 'source', label: 'Source' }],
  });

  /* The column arrangement — same placement rule as `useTableView` above: it
     is hooks, so it has to be called ABOVE the `if (detail)` early return or
     opening a contact renders fewer hooks than the list did. */
  const cols = useColumnPrefs('graha.contacts', CONTACT_COLUMNS);

  if (detail) {
    const c = detail.contact;
    const back = () => { setDetail(null); setEditContact(null); setDetailErr(null); };
    return (
      <div>
        <button className="k-btn k-btn--ghost gr__back" onClick={back}>← Back to list</button>

        {detailErr ? (
          <ErrorState kind={errorKind(detailErr)} onRetry={() => loadDetail(c.id)} />
        ) : (<>
          {editContact ? (
            <div className="gr__panel">
              <h3 className="gr__ptitle">Edit Contact</h3>
              <div className="gr__grid">
                {field('Name *', <input className="k-input" value={editContact.name} onChange={e => setEditContact({ ...editContact, name: e.target.value })} />)}
                {field('Type', (
                  <select className="k-input" value={editContact.contact_type} onChange={e => setEditContact({ ...editContact, contact_type: e.target.value })}>
                    {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ))}
                {field('Email', <input className="k-input" type="email" value={editContact.email} onChange={e => setEditContact({ ...editContact, email: e.target.value })} />)}
                {field('Phone', <input className="k-input" type="tel" value={editContact.phone} onChange={e => setEditContact({ ...editContact, phone: e.target.value })} />)}
                {field('Mobile', <input className="k-input" type="tel" value={editContact.mobile} onChange={e => setEditContact({ ...editContact, mobile: e.target.value })} />)}
                {/* The edit panel had the free-text Company and NO client
                    dropdown, so the one field that actually links a contact to
                    a company could not be changed after creation. Swapped, not
                    just removed. */}
                {field('Client / Company', (
                  <select className="k-input" value={editContact.client_id || ''} onChange={e => setEditContact({ ...editContact, client_id: e.target.value })}>
                    <option value="">— None —</option>
                    {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ))}
                {field('Designation', <input className="k-input" value={editContact.designation} onChange={e => setEditContact({ ...editContact, designation: e.target.value })} />)}
                {field('Source', <input className="k-input" value={editContact.source} onChange={e => setEditContact({ ...editContact, source: e.target.value })} />)}
                {field('Lead Score', <input className="k-input" type="number" min="0" max="100" value={editContact.lead_score} onChange={e => setEditContact({ ...editContact, lead_score: parseInt(e.target.value, 10) || 0 })} />)}
                {field('Website', <input className="k-input" value={editContact.website} onChange={e => setEditContact({ ...editContact, website: e.target.value })} />)}
                {field('GSTIN', <input className="k-input" value={editContact.gstin} onChange={e => setEditContact({ ...editContact, gstin: e.target.value })} />)}
                {field('PAN', <input className="k-input" value={editContact.pan} onChange={e => setEditContact({ ...editContact, pan: e.target.value })} />)}
                <CustomFieldInputs
                  entity="contact"
                  value={editContact.custom_data}
                  onChange={cd => setEditContact({ ...editContact, custom_data: cd })}
                  field={field}
                />
              </div>
              <label className="gr__f gr__f--block"><span className="gr__fl">Notes</span>
                <textarea className="k-input gr__ta" rows={3} value={editContact.notes} onChange={e => setEditContact({ ...editContact, notes: e.target.value })} /></label>
              <div className="gr__acts">
                <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditContact(null)}>Cancel</button>
                <button type="button" className="k-btn k-btn--primary" disabled={editSaving} onClick={saveEditContact}>{editSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <div className="gr__panel">
              <div className="gr__dhead">
                <div>
                  <h3 className="gr__dname">{c.name}</h3>
                  <p className="gr__sub">{c.client_name || c.company} {c.designation && `· ${c.designation}`}</p>
                </div>
                <div className="gr__dacts">
                  <button className="k-btn k-btn--ghost" onClick={() => startEditContact(c)}>Edit</button>
                  {/* Conversion writes a CRM deal, so it is offered only where
                      the CRM is. */}
                  {crm && c.contact_type === 'lead' && (
                    <button className="k-btn k-btn--primary" onClick={() => convertLead(c.id)}>Convert to Customer</button>
                  )}
                  <Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || 'var(--on-surface-3)'} />
                </div>
              </div>
              <div className="gr__dgrid">
                <div className="gr__dpair"><strong>Email:</strong> {c.email || '—'}</div>
                <div className="gr__dpair"><strong>Phone:</strong> {c.phone || '—'}</div>
                <div className="gr__dpair"><strong>GSTIN:</strong> {c.gstin || '—'}</div>
                <div className="gr__dpair"><strong>PAN:</strong> {c.pan || '—'}</div>
                <div className="gr__dpair"><strong>Source:</strong> {c.source || '—'}</div>
                <div className="gr__dpair"><strong>Lead Score:</strong> {c.lead_score ?? '—'}/100</div>
                <div className="gr__dpair"><strong>Assigned To:</strong> {c.assigned_to ? `${c.assigned_to.substring(0, 8)}…` : '—'}</div>
                <div className="gr__dpair"><strong>Last Contacted:</strong> {c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('en-IN') : '—'}</div>
                <div className="gr__dpair"><strong>Converted:</strong> {c.converted_at ? new Date(c.converted_at).toLocaleDateString('en-IN') : '—'}</div>
              </div>
              {c.lead_score_reasons?.length > 0 && (
                <div className="gr__dscore">
                  <strong>Score reasons:</strong> {(typeof c.lead_score_reasons === 'string' ? JSON.parse(c.lead_score_reasons) : c.lead_score_reasons).join(', ')}
                </div>
              )}
              {c.notes && <p className="gr__dnotes">{c.notes}</p>}
            </div>
          )}

          {detail.labels?.length > 0 && (
            <div className="gr__panel">
              <h4 className="gr__ptitle gr__ptitle--sm">Labels</h4>
              <div className="gr__chips">
                {detail.labels.map(l => (
                  <span key={l.id} className="gr__chip" style={{ '--c': l.color || 'var(--on-surface-3)' }}>
                    {l.name}
                    {/* The chip still SHOWS outside the CRM — it is a fact
                        about this person. Unlabelling is a CRM edit. */}
                    {crm && (
                      <button className="gr__chipx" aria-label={`Remove label ${l.name}`} onClick={() => removeLabel(c.id, l.id)}>×</button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {detail.deals?.length > 0 && (
            <div className="gr__panel">
              <h4 className="gr__ptitle gr__ptitle--sm">Deals ({detail.deals.length})</h4>
              {detail.deals.map(d => (
                <div key={d.id} className="gr__kv">
                  <span>{d.title}</span>
                  <span className="gr__cside">
                    <span className="gr__val">{inr(Number(d.value))}</span>
                    <Badge text={d.stage} color={stageColor(d.stage)} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {detail.follow_ups?.length > 0 && (
            <div className="gr__panel">
              <h4 className="gr__ptitle gr__ptitle--sm">Follow-ups ({detail.follow_ups.length})</h4>
              {detail.follow_ups.map(f => (
                <div key={f.id} className="gr__kv">
                  <span>
                    <span className={f.is_completed ? 'gr__ctitle gr__ctitle--done' : 'gr__ctitle'}>{f.title}</span>
                    {f.description && <span className="gr__lsub"> {f.description}</span>}
                  </span>
                  <span className="gr__cside">
                    <span className="gr__twhen">{new Date(f.due_at).toLocaleDateString('en-IN')}</span>
                    <Badge text={f.is_completed ? 'Done' : 'Pending'} color={f.is_completed ? 'var(--ok)' : 'var(--warn)'} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {detail.activities?.length > 0 && (
            <div className="gr__panel">
              <h4 className="gr__ptitle gr__ptitle--sm">Activities</h4>
              {detail.activities.map(a => (
                <div key={a.id} className="gr__kv">
                  <span className="gr__cside">
                    <Badge text={a.activity_type} color="var(--on-surface-3)" />
                    <span>{a.title}</span>
                  </span>
                  <span className="gr__twhen">{new Date(a.created_at).toLocaleDateString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}

          <div className="gr__panel">
            <h4 className="gr__ptitle gr__ptitle--sm">Statement of account</h4>
            <p className="gr__sub">
              The ledger for this account over one period, with ageing. The opening
              balance carries everything before the start date, so the statement ties
              to the whole history rather than only to the window it prints.
            </p>
            <div className="gr__grid">
              {field('From', (
                <DateInput
                  className="k-input" type="date" value={soaPeriod.start}
                  onChange={e => setSoaPeriod({ ...soaPeriod, start: e.target.value })}
                />
              ))}
              {field('To', (
                <DateInput
                  className="k-input" type="date" value={soaPeriod.end}
                  onChange={e => setSoaPeriod({ ...soaPeriod, end: e.target.value })}
                />
              ))}
            </div>
            <div className="gr__acts">
              <button
                type="button"
                className="k-btn k-btn--primary"
                disabled={statement.busy === 'statement' || soaPeriod.start > soaPeriod.end}
                onClick={() => statement.run('statement', {
                  url: `/v1/documents/contacts/${c.id}/statement/pdf`,
                  params: { period_start: soaPeriod.start, period_end: soaPeriod.end },
                  filename: `statement-${c.name || 'account'}.pdf`,
                  fallback: 'Could not generate the statement',
                })}
              >
                {statement.busy === 'statement' ? 'Generating…' : 'Download statement'}
              </button>
            </div>
            {soaPeriod.start > soaPeriod.end && (
              <p className="gr__mute">The start date is after the end date.</p>
            )}
            <DocumentError error={statement.error} onDismiss={statement.clear} />
          </div>

          {/* `/v1/graha/contacts/{id}/timeline` is graha-gated and its panel
              renders a full ErrorState on a 403 — a loud, wrong "this failed"
              on a screen that worked. Not rendered where it cannot load. */}
          {crm && (
            <div className="gr__panel">
              <ContactTimeline contactId={c.id} />
            </div>
          )}
        </>)}
      </div>
    );
  }

  return (
    <div>
      <div className="gr__bar">
        <input className="k-input gr__search" placeholder="Search contacts…" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <select className="k-input gr__sel" aria-label="Filter by type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" onClick={load}>Filter</button>
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(true)} disabled={!canWrite} title={denial || undefined}>+ Add Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="gr__panel">
          <h3 className="gr__ptitle">New Contact</h3>
          <div className="gr__grid">
            {field('Name *', <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />)}
            {field('Type', (
              <select className="k-input" value={form.contact_type} onChange={e => setForm({ ...form, contact_type: e.target.value })}>
                {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {field('Email', <input className="k-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />)}
            {field('Phone / Mobile', <input className="k-input" type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />)}
            {/* No free-text Company. The client dropdown below is the company,
                and two fields for one fact is how a contact ends up filed
                under "Acme" and "Acme Pvt Ltd" at the same time. */}
            {field('Designation', <input className="k-input" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} />)}
            {field('GSTIN', <input className="k-input" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} />)}
            {field('Source', <input className="k-input" placeholder="e.g. Website, Referral" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />)}
            {field('Client / Company', (
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ))}
            {/* The org's own fields. Defined in the Custom Fields tab, stored
                in `custom_data`, and until now rendered nowhere at all. */}
            <CustomFieldInputs
              entity="contact"
              value={form.custom_data}
              onChange={cd => setForm({ ...form, custom_data: cd })}
              field={field}
            />
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Create Contact'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading contacts"><SkeletonList rows={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : contacts.length === 0 ? (
        <EmptyState
          illustration="contacts"
          title={{ en: 'No contacts yet', hi: 'कोई संपर्क नहीं' }}
          description="Add leads, customers, vendors, or partners to start building relationships here."
          action={canWrite ? 'Add Contact' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : (
        <div className="tv-card">
        <TableToolbar view={view} label="contacts" showSearch={false}>
          <ColumnsButton cols={cols} />
        </TableToolbar>
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              {/* Heads come out of the arrangement, not out of nine literals:
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
              {view.rows.map(c => (
                <tr key={c.id} className="gr__tr--click" onClick={() => loadDetail(c.id)}>
                  {cols.cells({
                    /* The only focusable thing in this row was Delete, so a
                       keyboard could reach the destructive action and not the
                       record itself. */
                    name: (
                      <td className="gr__td--name">
                        <button
                          type="button"
                          className="gr__link"
                          onClick={e => { e.stopPropagation(); loadDetail(c.id); }}
                        >
                          {c.name}
                        </button>
                      </td>
                    ),
                    /* The client's name, with the old free-text `company` as
                       the fallback — rows created before the field was dropped
                       still carry it and must not read as blank. */
                    company: <td className="gr__td--mute">{c.client_name || c.company || '—'}</td>,
                    email: <td className="gr__td--mute">{c.email || '—'}</td>,
                    phone: <td className="gr__td--mute">{c.phone || '—'}</td>,
                    contact_type: <td><Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || 'var(--on-surface-3)'} /></td>,
                    source: <td>{c.source ? <Badge text={c.source} color={SOURCE_COLORS[c.source] || 'var(--on-surface-3)'} /> : '—'}</td>,
                    lead_score: <td className="gr__td--mute">{c.lead_score ?? '—'}</td>,
                    [CREATED_KEY]: <CreatedCell value={c.created_at} />,
                    created_by_name: <ByCell name={c.created_by_name} hasActor={c.has_creator} />,
                    [UPDATED_KEY]: <UpdatedCell value={c.updated_at} />,
                    updated_by_name: <ByCell name={c.updated_by_name} hasActor={c.has_updater} />,
                    actions: (
                      <td>
                        <button className="k-btn k-btn--reject" onClick={e => { e.stopPropagation(); deleteContact(c.id); }}>Delete</button>
                      </td>
                    ),
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
