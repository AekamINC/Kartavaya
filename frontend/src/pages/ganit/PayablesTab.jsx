// Ganit · payables — vendor bills, and what is owed on them.
//
// The `aging` buckets `GET /payables-summary` already returns were being
// discarded: the panel read `outstanding`, `overdue` and `open_bills` off the
// same response and dropped the array telling you HOW LATE the money is. On a
// payables screen the ageing profile is the point — "₹4L outstanding" and "₹4L
// outstanding, all of it 90+ days" are different businesses.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Badge, BILL_STATUS_COLORS } from './_shared';
import { inr } from '../../lib/inr';
import VendorBillDetail from './VendorBillDetail';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

const EMPTY_LINE = { description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 };
const BLANK_BILL = {
  vendor_id: '', bill_number: '', bill_date: '', due_date: '',
  is_igst: false, notes: '', line_items: [{ ...EMPTY_LINE }],
};
const STATUSES = ['unpaid', 'partially_paid', 'paid', 'cancelled'];
/** Ageing buckets in the order the server emits them, oldest money last. */
const AGE_ORDER = ['current', '1-30', '31-60', '61-90', '90+'];
const AGE_LABEL = {
  current: 'Not yet due', '1-30': '1–30 days', '31-60': '31–60 days',
  '61-90': '61–90 days', '90+': 'Over 90 days',
};

export default function PayablesTab() {
  const { pushToast } = useToast();
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record payables' });
  const [bills, setBills] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ ...BLANK_BILL });
  const [vendorForm, setVendorForm] = useState({ name: '', gstin: '', email: '', phone: '' });

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = statusFilter ? { status: statusFilter } : undefined;
      const r = await api.get('/v1/ganit/vendor-bills', { params });
      setBills(rows(r));
    } catch (e) {
      // "No vendor bills yet" after a failed fetch tells a firm it owes
      // nobody anything.
      setErr(e);
      setBills([]);
    } finally { setLoading(false); }
  }, [statusFilter]);

  const loadSummary = useCallback(async () => {
    setSummaryFailed(false);
    try {
      const r = await api.get('/v1/ganit/payables-summary');
      setSummary(body(r));
    } catch { setSummary(null); setSummaryFailed(true); }
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      const r = await api.get('/v1/ganit/vendors');
      setVendors(rows(r));
    } catch { /* the vendor picker stays empty; "+ Vendor" still works */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); loadVendors(); }, [loadSummary, loadVendors]);

  function updateLine(idx, key, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, line_items: items };
    });
  }

  async function saveVendor(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post('/v1/ganit/vendors', vendorForm);
      pushToast({ title: 'Vendor added', type: 'success' });
      setShowVendorForm(false);
      setVendorForm({ name: '', gstin: '', email: '', phone: '' });
      await loadVendors();
      setForm(f => ({ ...f, vendor_id: body(r).id }));
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not add the vendor', type: 'error' });
    } finally { setSaving(false); }
  }

  async function saveBill(e) {
    e.preventDefault();
    if (!form.vendor_id) { pushToast({ title: 'Select a vendor', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/ganit/vendor-bills', form);
      pushToast({ title: 'Vendor bill recorded', type: 'success' });
      setShowForm(false);
      setForm({ ...BLANK_BILL });
      load();
      loadSummary();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not record the bill', type: 'error' });
    } finally { setSaving(false); }
  }

  const aging = Array.isArray(summary?.aging) ? summary.aging : [];
  const agingSorted = [...aging].sort((a, b) => AGE_ORDER.indexOf(a.bucket) - AGE_ORDER.indexOf(b.bucket));

  return (
    <div>
      {summary && (
        <div className="gn-stats" style={{ '--gn-min': '160px' }}>
          <StatTile label="Outstanding" sanskrit="देय" value={inr(Number(summary.outstanding || 0))} />
          <StatTile
            label="Overdue" value={inr(Number(summary.overdue || 0))}
            variant={Number(summary.overdue) > 0 ? 'danger' : 'neutral'}
          />
          <StatTile label="Open bills" value={summary.open_bills ?? 0} />
        </div>
      )}
      {summaryFailed && (
        <p className="note note--warn" role="status">
          The payables totals could not be loaded. The bills below are unaffected.
        </p>
      )}

      {agingSorted.length > 0 && (
        <div className="gn-panel">
          <h3 className="gn-panel__h">Ageing<Secondary className="dr__lbl-hi" value="आयु" /></h3>
          <div className="gn-facts">
            {agingSorted.map(a => (
              <div key={a.bucket}>
                {AGE_LABEL[a.bucket] || a.bucket}{' '}
                <span className="gn-facts__v">{inr(Number(a.amount || 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Status</span>
          <select className="inp gn-bar__sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </label>
        <span className="gn-bar__sp" />
        <button
          type="button" className="btn btn--ghost btn--sm" onClick={() => setShowVendorForm(v => !v)}
          disabled={!canWrite} title={denial || undefined}
        >
          {showVendorForm ? 'Close' : '+ Vendor'}
        </button>
        <button
          type="button" className="btn btn--fill btn--sm" onClick={() => setShowForm(v => !v)}
          disabled={!canWrite} title={denial || undefined}
        >
          {showForm ? 'Close form' : '+ Vendor bill'}
        </button>
      </div>

      {showVendorForm && canWrite && (
        <form className="gn-form" onSubmit={saveVendor}>
          <h4 className="gn-form__h">New vendor</h4>
          <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
            <label className="fld">
              <span className="fld__l">Name<span className="fld__req">*</span></span>
              <input className="inp" required value={vendorForm.name}
                onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">GSTIN</span>
              <input className="inp" value={vendorForm.gstin}
                onChange={e => setVendorForm({ ...vendorForm, gstin: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Email</span>
              <input className="inp" type="email" value={vendorForm.email}
                onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Phone</span>
              <input className="inp" value={vendorForm.phone}
                onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} />
            </label>
          </div>
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowVendorForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save vendor'}
            </button>
          </div>
        </form>
      )}

      {showForm && canWrite && (
        <form className="gn-form" onSubmit={saveBill}>
          <h4 className="gn-form__h">New vendor bill</h4>
          <div className="gn-form__grid">
            <label className="fld">
              <span className="fld__l">Vendor<span className="fld__req">*</span></span>
              <select className="inp" required value={form.vendor_id}
                onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">Select…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l">Vendor's bill no.</span>
              <input className="inp" value={form.bill_number}
                onChange={e => setForm({ ...form, bill_number: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Bill date</span>
              <input className="inp" type="date" value={form.bill_date}
                onChange={e => setForm({ ...form, bill_date: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Due date</span>
              <input className="inp" type="date" value={form.due_date}
                onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </label>
            <label className="gn-chk">
              <input type="checkbox" checked={form.is_igst}
                onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
              <span>Inter-state (IGST)</span>
            </label>
          </div>

          <h4 className="gn-form__h">Line items</h4>
          {form.line_items.map((li, i) => (
            <div key={i} className="gn-li" style={{ '--gn-li': '2fr 80px 110px 80px 1fr 30px' }}>
              <div>
                {i === 0 && <span className="gn-li__l">Description</span>}
                <input className="inp" placeholder="Description" required value={li.description}
                  onChange={e => updateLine(i, 'description', e.target.value)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Qty</span>}
                <input className="inp" type="number" value={li.quantity}
                  onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Rate</span>}
                <input className="inp" type="number" value={li.rate}
                  onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">GST%</span>}
                <input className="inp" type="number" value={li.gst_rate}
                  onChange={e => updateLine(i, 'gst_rate', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">HSN/SAC</span>}
                <input className="inp" value={li.hsn_code}
                  onChange={e => updateLine(i, 'hsn_code', e.target.value)} />
              </div>
              <button type="button" className="gn-li__x" aria-label={`Remove line ${i + 1}`}
                disabled={form.line_items.length === 1}
                onClick={() => setForm(f => ({ ...f, line_items: f.line_items.filter((_, j) => j !== i) }))}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm"
            onClick={() => setForm(f => ({ ...f, line_items: [...f.line_items, { ...EMPTY_LINE }] }))}>
            + Add line
          </button>

          <label className="fld gn-form__wide">
            <span className="fld__l">Notes</span>
            <textarea className="inp gn-ta" rows={2} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </label>

          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save bill'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading vendor bills"><SkeletonList rows={5} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : bills.length === 0 ? (
        statusFilter ? (
          <EmptyState
            illustration="search"
            title={{ en: `No ${statusFilter.replace('_', ' ')} bills`, hi: 'कोई बिल नहीं' }}
            description="Nothing sits at this status right now. Clear the filter to see every bill."
            action="Show all bills"
            onAction={() => setStatusFilter('')}
          />
        ) : (
          <EmptyState
            illustration="generic"
            title={{ en: 'No vendor bills yet', hi: 'कोई बिल नहीं' }}
            description={canWrite
              ? 'Record what your suppliers have invoiced you. Payables, ageing and the input tax credit all follow from these.'
              : `Vendor bills record what your suppliers have invoiced you — payables, ageing and the input tax credit all follow from them. ${denial}`}
            action={canWrite ? '+ Vendor bill' : undefined}
            onAction={canWrite ? () => setShowForm(true) : undefined}
          />
        )
      ) : (
        <div className="gn-list">
          {bills.map(b => (
            <button type="button" key={b.id} className="gn-row" onClick={() => setOpenId(b.id)}>
              <span className="gn-row__head">
                <span>
                  <span className="gn-row__t">{b.vendor_name}</span>
                  <span className="gn-row__ref">{b.internal_ref}</span>
                </span>
                <span className="gn-row__r">
                  <span className="gn-row__v">{inr(Number(b.total || 0))}</span>
                  <Badge text={b.status} color={BILL_STATUS_COLORS[b.status] || 'var(--on-surface-3)'} />
                </span>
              </span>
              <span className="gn-row__meta">
                <span>{b.bill_date}{b.due_date && ` · due ${b.due_date}`}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <VendorBillDetail
          billId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { load(); loadSummary(); }}
        />
      )}
    </div>
  );
}
