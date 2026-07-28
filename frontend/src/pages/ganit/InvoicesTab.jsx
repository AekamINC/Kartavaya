// Ganit · invoices — the ledger.
//
// Was 542 lines holding a list, a record takeover and a line-item editor. The
// record is `InvoiceDetail` (a drawer, per the owner's request), the create
// form is `InvoiceForm`, and what remains here is the list.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
// `EmptyState` directly, not the `Empty` wrapper in editorial/ModuleUI: that
// wrapper forwards its `icon` prop into a three-entry GLYPHS map (check, clock,
// generic) while every caller passes an ILLUSTRATION name, so `icon="invoice"`
// resolves to the generic document glyph and the invoice artwork never renders.
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import { Badge, INV_TYPE_LABELS, STATUS_COLORS } from './_shared';
import InvoiceForm from './InvoiceForm';
import InvoiceDetail from './InvoiceDetail';
import { currentUser } from '../../lib/auth';
import { canWriteModule, writeDenialReason } from '../../lib/moduleAccess';

/**
 * `newNonce` lets the page header's "+ Invoice" button open this tab's create
 * form. A counter, not a boolean, so pressing it again re-opens the form after
 * the first attempt was cancelled — a boolean would already be `true` and the
 * effect would not re-run.
 */
export default function InvoicesTab({ newNonce = 0 }) {
  // F32, measured live: a `ganit: viewer` opened this form, composed a complete
  // invoice — customer, place of supply, 3 x Rs 25,000, live total Rs 88,500 —
  // and only then learned on submit that the level does not permit it. The
  // refusal is correct and its wording is good; offering the form was not.
  //
  // `canWrite` is TRUE for anyone the server expressed no opinion about
  // (org_admin, org_owner, platform staff), so this changes nothing for them.
  const me = currentUser();
  const canWrite = canWriteModule(me, 'ganit');
  const denial = canWrite ? null : writeDenialReason(me, 'ganit', 'create invoices');
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openId, setOpenId] = useState(null);
  // A failed load left `invoices` at [] and painted "No invoices yet — create
  // your first invoice". On a finance ledger that is the worst version of this
  // bug: an empty receivables list is a number the user may act on, and it is
  // indistinguishable from a real empty ledger. Loading, empty and ERROR are
  // three states, and this is the third.
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = {};
      if (typeFilter) params.invoice_type = typeFilter;
      if (statusFilter) params.payment_status = statusFilter;
      // `GET /invoices` answers `{"data": […]}`; `rows()` keeps the call site
      // indifferent to that, and to the 28 routes that answer a bare array.
      const r = await api.get('/v1/ganit/invoices', { params });
      setInvoices(rows(r));
    } catch (e) {
      setErr(e);
      setInvoices([]);
    } finally { setLoading(false); }
  }, [typeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (newNonce) setShowForm(true); }, [newNonce]);

  const filtered = !!(typeFilter || statusFilter);

  return (
    <div>
      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Type</span>
          <select className="inp gn-bar__sel" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(INV_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Status</span>
          <select className="inp gn-bar__sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="gn-bar__sp" />
        <button
          type="button"
          className="btn btn--fill btn--sm"
          onClick={() => setShowForm(v => !v)}
          disabled={!canWrite}
          title={denial || undefined}
        >
          {showForm ? 'Close form' : '+ New invoice'}
        </button>
      </div>

      {/* `canWrite &&` as well as `showForm`: the header's "+ Invoice" reaches
          this tab through `newNonce`, so gating only the button above would
          still let that path open the form for a viewer. */}
      {showForm && canWrite && (
        <InvoiceForm
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}

      {loading ? (
        <SkeletonRegion label="Loading invoices"><SkeletonTable rows={8} columns={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : invoices.length === 0 ? (
        filtered ? (
          <EmptyState
            illustration="search"
            title={{ en: 'No invoices match this filter', hi: 'कोई बीजक नहीं मिला' }}
            description="Nothing sits under these filters right now. Clear them to see the whole ledger."
            action="Clear filters"
            onAction={() => { setTypeFilter(''); setStatusFilter(''); }}
          />
        ) : (
          <EmptyState
            illustration="invoice"
            title={{ en: 'No invoices yet', hi: 'कोई बीजक नहीं' }}
            /* A viewer is told what the ledger IS and why it is empty, but is
               not handed a create button the API will refuse. The empty state
               is the one screen where that invitation is most persuasive. */
            description={canWrite
              ? 'An invoice records what a customer owes you, with the HSN codes and tax split a GST return needs. Add your products first and the lines fill themselves.'
              : `An invoice records what a customer owes you, with the HSN codes and tax split a GST return needs. ${denial}`}
            action={canWrite ? '+ New invoice' : undefined}
            onAction={canWrite ? () => setShowForm(true) : undefined}
          />
        )
      ) : (
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Date</th>
                <th className="tbl__num">Total</th>
                <th className="tbl__num">Paid</th>
                <th className="tbl__num">Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="gn-tbl__row" onClick={() => setOpenId(inv.id)}>
                  <td>
                    {/* A real button inside the row, so the record is reachable
                        by keyboard. The row's onClick alone was mouse-only. */}
                    <button type="button" className="gn-link gn-tbl__id"
                      onClick={e => { e.stopPropagation(); setOpenId(inv.id); }}>
                      {inv.invoice_number}
                    </button>
                  </td>
                  <td>{inv.contact_name || '—'}</td>
                  <td><Badge text={INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} color="var(--st-in-progress)" /></td>
                  <td className="gn-tbl__mono">{inv.invoice_date}</td>
                  <td className="tbl__num">{inr(Number(inv.total))}</td>
                  <td className="tbl__num gn-tbl__ok">{inr(Number(inv.amount_paid))}</td>
                  <td className={`tbl__num ${Number(inv.balance_due) > 0 ? 'gn-tbl__due' : 'gn-tbl__mute'}`}>
                    {inr(Number(inv.balance_due))}
                  </td>
                  <td><Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || 'var(--on-surface-3)'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && (
        <InvoiceDetail
          invoiceId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
