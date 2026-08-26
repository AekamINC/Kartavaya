// Kray · vendors — the master list of suppliers this org buys from.
//
// Vendor records live in ganit_vendors (the table name is not a module code)
// and are shared between Ganit and Kray via the payables gate.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

const COLUMNS = ['Name', 'GSTIN', 'MSME', 'Terms', 'Email', 'Phone', ''];

/* The second-script run on a field label. Deliberately NOT `<Secondary>` from
   components/Bilingual: that one returns null under EN — the node is absent,
   by design — whereas this form has always shown both scripts unconditionally.
   Pulled out of the four labels that repeated it inline so the ten below read
   as fields rather than as style attributes. */
const HI = { fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' };
const Hi = ({ t }) => <span aria-hidden="true" lang="hi" style={HI}>{' · '}{t}</span>;

/* Mirrors the LIVE CHECK constraints ganit_vendors_enterprise_class_ck and
   ganit_vendors_kind_ck (read from pg_constraint 2026-08-25, not from the
   migration). '' is the unrecorded state and is always offered: NULL means
   "nobody has said", which the 43B(h) skill counts apart from a real answer. */
const CLASSES = [['', 'Not recorded'], ['micro', 'Micro'], ['small', 'Small'], ['medium', 'Medium']];
const KINDS = [['', 'Not recorded'], ['manufacturer', 'Manufacturer'], ['service', 'Service'], ['trader', 'Trader']];
const MSME = [['', 'Not recorded'], ['yes', 'Yes'], ['no', 'No']];

const BLANK = {
  name: '', gstin: '', email: '', phone: '',
  is_msme: '', enterprise_class: '', vendor_kind: '',
  udyam_number: '', tds_section: '', payment_terms_days: '',
};

/* Every compliance key is sent on every save, including blank ones — the
   backend reads `model_fields_set`, so a key that is present-and-blank clears
   the column to NULL and a key that is absent leaves it alone. Sending them
   all is what makes a value removable after it was entered by mistake. */
function payload(f) {
  return {
    name: f.name, gstin: f.gstin, email: f.email, phone: f.phone,
    is_msme: f.is_msme === '' ? null : f.is_msme === 'yes',
    enterprise_class: f.enterprise_class,
    vendor_kind: f.vendor_kind,
    udyam_number: f.udyam_number,
    tds_section: f.tds_section,
    payment_terms_days: f.payment_terms_days === '' ? null : Number(f.payment_terms_days),
  };
}

export default function VendorsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage vendors' });
  const { pushToast } = useToast();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(BLANK);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = search ? { search } : undefined;
      const r = await api.get('/v1/ganit/vendors', { params });
      setVendors(rows(r));
    } catch (e) { setErr(e); setVendors([]); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  function startEdit(v) {
    setEditId(v.id);
    setForm({
      name: v.name,
      gstin: v.gstin || '',
      email: v.email || '',
      phone: v.phone || '',
      /* Tri-state on the way in as well: `is_msme` is boolean-or-NULL, so a
         null must hydrate as '' (not recorded) and false as 'no'. `?? ''`
         rather than `|| ''` for the same reason on the number — 0 days is a
         real answer (paid on delivery), not an empty box. */
      is_msme: v.is_msme === null || v.is_msme === undefined ? '' : v.is_msme ? 'yes' : 'no',
      enterprise_class: v.enterprise_class || '',
      vendor_kind: v.vendor_kind || '',
      udyam_number: v.udyam_number || '',
      tds_section: v.tds_section || '',
      payment_terms_days: v.payment_terms_days ?? '',
    });
    setShowForm(true);
  }

  function startNew() {
    setEditId(null);
    setForm(BLANK);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { pushToast({ title: 'Name is required', type: 'error' }); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/v1/ganit/vendors/${editId}`, payload(form));
        pushToast({ title: 'Vendor updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/vendors', payload(form));
        pushToast({ title: 'Vendor added', type: 'success' });
      }
      setShowForm(false);
      setForm(BLANK);
      setEditId(null);
      load();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not save vendor', type: 'error' });
    } finally { setSaving(false); }
  }

  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gn-bar" style={{ marginBottom: '1rem' }}>
        <input
          className="gn-search"
          type="text"
          placeholder="Search vendors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={startNew}>
            + Vendor
          </button>
        )}
        {!canWrite && denial && (
          <span className="gn-denial">{denial}</span>
        )}
      </div>

      {showForm && (
        <form className="gn-form gn-form--inline" onSubmit={save} style={{ marginBottom: '1.5rem' }}>
          <div className="gn-form__row">
            <label className="gn-form__field">
              Name <Hi t="नाम" />
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </label>
            <label className="gn-form__field">
              GSTIN <Hi t="जीएसटीआईएन" />
              <input value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="Optional" />
            </label>
          </div>
          <div className="gn-form__row">
            <label className="gn-form__field">
              Email <Hi t="ईमेल" />
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="gn-form__field">
              Phone <Hi t="फ़ोन" />
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </label>
          </div>
          <div className="gn-form__row">
            <label className="gn-form__field">
              MSME registered <Hi t="एमएसएमई" />
              <select value={form.is_msme} onChange={e => setForm(f => ({ ...f, is_msme: e.target.value }))}>
                {MSME.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="gn-form__field">
              Enterprise class <Hi t="श्रेणी" />
              <select value={form.enterprise_class} onChange={e => setForm(f => ({ ...f, enterprise_class: e.target.value }))}>
                {CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <small className="fld__hint">
                Micro and small suppliers are covered by the 45-day payment rule. Medium is not.
              </small>
            </label>
          </div>
          <div className="gn-form__row">
            <label className="gn-form__field">
              Vendor kind <Hi t="प्रकार" />
              <select value={form.vendor_kind} onChange={e => setForm(f => ({ ...f, vendor_kind: e.target.value }))}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <small className="fld__hint">Traders are outside the rule.</small>
            </label>
            <label className="gn-form__field">
              Udyam number <Hi t="उद्यम संख्या" />
              <input
                value={form.udyam_number}
                onChange={e => setForm(f => ({ ...f, udyam_number: e.target.value }))}
                placeholder="Optional · UDYAM-XX-00-0000000"
              />
            </label>
          </div>
          <div className="gn-form__row">
            <label className="gn-form__field">
              TDS section <Hi t="टीडीएस धारा" />
              <input
                value={form.tds_section}
                onChange={e => setForm(f => ({ ...f, tds_section: e.target.value }))}
                placeholder="Optional · e.g. 194C"
              />
            </label>
            <label className="gn-form__field">
              Payment terms <Hi t="भुगतान अवधि" />
              <input
                type="number"
                min="0"
                max="365"
                value={form.payment_terms_days}
                onChange={e => setForm(f => ({ ...f, payment_terms_days: e.target.value }))}
                placeholder="Days · blank means no written agreement"
              />
            </label>
          </div>
          <div className="gn-form__actions">
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Update' : 'Add vendor'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <SkeletonList rows={6} /> : vendors.length === 0 ? (
        <EmptyState
          icon="kray"
          title="No vendors yet"
          description="Add your first supplier to start raising purchase orders."
          action={canWrite ? '+ Vendor' : undefined}
          onAction={canWrite ? startNew : undefined}
        />
      ) : (
        <DataTable columns={COLUMNS} label="Vendors">
          {vendors.map(v => (
            <tr key={v.id}>
              <Td bold>{v.name}</Td>
              <Td mono>{v.gstin || '—'}</Td>
              {/* The CLASS, not the is_msme flag: a medium enterprise is
                  Udyam-registered and still outside the 45-day rule, so the
                  class is the fact that decides whether the clock runs. */}
              <Td>{v.enterprise_class ? v.enterprise_class[0].toUpperCase() + v.enterprise_class.slice(1) : '—'}</Td>
              <Td>{v.payment_terms_days === null || v.payment_terms_days === undefined ? '—' : `${v.payment_terms_days}d`}</Td>
              <Td>{v.email || '—'}</Td>
              <Td>{v.phone || '—'}</Td>
              <Td>
                {canWrite && (
                  <button type="button" className="btn btn--ghost btn--xs" onClick={() => startEdit(v)}>
                    Edit
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
