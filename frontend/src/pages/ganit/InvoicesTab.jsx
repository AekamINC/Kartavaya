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
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';

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

  const view = useTableView(invoices, {
    searchKeys: ['invoice_number', 'contact_name', 'status'],
    filters: [{ key: 'status', label: 'Status' }, { key: 'invoice_type', label: 'Type' },
              { key: 'place_of_supply', label: 'Place of supply' }],
  });
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
        <div className="tv-card">
        <TableToolbar view={view} label="invoices" />
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                <HeadCell sortKey="invoice_number" sort={view.sort} onSort={view.onSort}>Invoice</HeadCell>
                <HeadCell sortKey="contact_name" sort={view.sort} onSort={view.onSort}>Customer</HeadCell>
                <HeadCell sortKey="place_of_supply" sort={view.sort} onSort={view.onSort}>Place of supply</HeadCell>
                <HeadCell sortKey="invoice_type" sort={view.sort} onSort={view.onSort}>Type</HeadCell>
                <HeadCell sortKey="invoice_date" sort={view.sort} onSort={view.onSort}>Date</HeadCell>
                <HeadCell sortKey="subtotal" sort={view.sort} onSort={view.onSort} num>Taxable</HeadCell>
                <HeadCell sortKey="gst" sort={view.sort} onSort={view.onSort} num>GST</HeadCell>
                <HeadCell sortKey="total" sort={view.sort} onSort={view.onSort} num>Total</HeadCell>
                <HeadCell sortKey="amount_paid" sort={view.sort} onSort={view.onSort} num>Paid</HeadCell>
                <HeadCell sortKey="balance_due" sort={view.sort} onSort={view.onSort} num>Due</HeadCell>
                <HeadCell sortKey="status" sort={view.sort} onSort={view.onSort}>Status</HeadCell>
              </tr>
            </thead>
            <tbody>
              {view.rows.map(inv => (
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
                  {/* Place of supply is the field that decides IGST vs
                      CGST+SGST, so the tag beside it is not decoration: it is
                      the consequence of the value, and a reader checking a
                      return wants both in one glance.

                      `place_of_supply` is `TEXT DEFAULT ''`, and every invoice
                      this build GENERATES leaves it empty — so the blank case
                      is the common case, not an edge. An em dash here would
                      read as "not applicable", which is the one thing it is
                      not: a missing place of supply is a GSTR-1 blocker
                      (`services/gst_period.py:364`). It says so. */}
                  <td>
                    {inv.place_of_supply ? (
                      <span className="gn-tbl__pos">{inv.place_of_supply}</span>
                    ) : (
                      <span className="gn-tbl__missing">Not set</span>
                    )}
                    {/* --st-in-review and --primary are the reference's #7c5cbf
                        and #04837A (`ScreensBiz.jsx:36`); --primary IS #04837A. */}
                    <Badge
                      text={inv.is_igst ? 'IGST' : 'C+S'}
                      color={inv.is_igst ? 'var(--st-in-review)' : 'var(--primary)'}
                    />
                  </td>
                  <td><Badge text={INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} color="var(--st-in-progress)" /></td>
                  <td className="gn-tbl__mono">{inv.invoice_date}</td>
                  {/* Taxable and GST, the reference's two money columns
                      (`ScreensBiz.jsx:35`). GST is the sum of the three heads
                      rather than a fourth column each, because on any one
                      invoice either igst is non-zero or cgst+sgst are, never
                      both — and which of the two it is, is already carried by
                      the IGST / C+S tag in the cell above. */}
                  <td className="tbl__num">{inr(Number(inv.subtotal) || 0)}</td>
                  <td className="tbl__num gn-tbl__mute">
                    {inr((Number(inv.cgst) || 0) + (Number(inv.sgst) || 0) + (Number(inv.igst) || 0))}
                  </td>
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
