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
// `CreatedHead` and `ByHead` are gone from this file: both headers are now
// rendered from the column declaration below, which is what lets them be
// moved, hidden and resized. The CELLS are unchanged — CreatedCell is the
// product's one created-date renderer, and ByCell is the one that renders a
// NAME and never the user id behind it.
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
 * Fourteen columns is the widest register in the product, and the reason this
 * table was the one to opt in second: a firm that never raises an inter-state
 * invoice does not want Place of supply, and one that does not chase payment
 * does not want Paid and Due. `fixed` on Invoice alone — the invoice number is
 * how a row is identified, and hiding it leaves a register of anonymous money.
 *
 * `created_at` and `invoice_date` both stay: an invoice already shows its
 * INVOICE DATE, the date on the document, while `created_at` is when the
 * record was raised in this system, and the two genuinely differ on a
 * back-dated invoice. Being arrangeable is what finally lets a firm that does
 * not care about that distinction put one of them away.
 */
const INVOICE_COLUMNS = [
  { id: 'invoice_number', label: 'Invoice', sortKey: 'invoice_number', fixed: true },
  { id: 'contact_name', label: 'Customer', sortKey: 'contact_name' },
  { id: 'place_of_supply', label: 'Place of supply', sortKey: 'place_of_supply' },
  { id: 'invoice_type', label: 'Type', sortKey: 'invoice_type' },
  { id: 'invoice_date', label: 'Date', sortKey: 'invoice_date' },
  { id: 'subtotal', label: 'Taxable', sortKey: 'subtotal', num: true },
  { id: 'gst', label: 'GST', sortKey: 'gst', num: true },
  { id: 'total', label: 'Total', sortKey: 'total', num: true },
  { id: 'amount_paid', label: 'Paid', sortKey: 'amount_paid', num: true },
  { id: 'balance_due', label: 'Due', sortKey: 'balance_due', num: true },
  { id: 'status', label: 'Status', sortKey: 'status' },
  { id: CREATED_KEY, label: 'Created', sortKey: CREATED_KEY, className: 'tbl__created' },
  // WHO raised it. The API resolves `created_by` to a name — the raw column is
  // a user id and can never be rendered.
  { id: 'created_by_name', label: 'Raised by', sortKey: 'created_by_name', className: 'tbl__by' },
  // THEIR reference, not ours. What their accounts-payable team quotes.
  { id: 'customer_ref', label: 'Their ref', sortKey: 'customer_ref' },
  { id: 'salesperson_name', label: 'Salesperson', sortKey: 'salesperson_name' },
  /* WHEN it was last touched, and by WHOM. The pair lands at the end because
     that is where `reconcileColumnPrefs` appends anything shipped after a
     saved arrangement anyway, so base order and every arranged order agree.
     Sixteen columns is a lot — and the point of this table being the second
     to opt into arrangement is that a firm which never audits an invoice can
     put both away in one sheet.

     It matters most HERE. An unpaid invoice is editable (`doc_status`
     defaults to `'final'`, so it is not the editability signal), which means
     the amount a customer is being asked for can change after it was raised
     with nothing on the register saying so. `updated_at` beside `created_at`
     is that sentence: same day means untouched, a later date means somebody
     changed it, and `updated_by_name` says who to ask. */
  { id: UPDATED_KEY, label: 'Updated', sortKey: UPDATED_KEY, className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Updated by', sortKey: 'updated_by_name', className: 'tbl__by' },
];

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
  //: Which document the form opens on. Reset by whichever button opened
  //: it, so a credit note started and cancelled does not leave the next
  //: "+ New invoice" opening on a credit note.
  const [newType, setNewType] = useState('tax_invoice');
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

  /* Which columns, in what order, at what width — the sibling hook. */
  const cols = useColumnPrefs('ganit.invoices', INVOICE_COLUMNS);

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
        {/* A CREDIT NOTE HAS ALWAYS WORKED and nobody could find it: it was
            the third entry in the form's Type dropdown, behind a button that
            says "New invoice". Raising one is the second most common thing a
            firm does in this tab, so it gets its own way in. Both buttons open
            the same form — this one just starts it on the right document. */}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => { setNewType('credit_note'); setShowForm(true); }}
          disabled={!canWrite}
          title={denial || undefined}
        >
          + Credit note
        </button>
        <button
          type="button"
          className="btn btn--fill btn--sm"
          onClick={() => { setNewType('tax_invoice'); setShowForm(v => !v); }}
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
          initialType={newType}
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
        <TableToolbar view={view} label="invoices">
          <ColumnsButton cols={cols} />
        </TableToolbar>
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              {/* Heads come out of the arrangement, not out of fourteen
                  literals: the order, the widths and which of them render at
                  all are the same list the cells below are keyed on, so the
                  two cannot drift by a column. This is the widest table in the
                  product, which is precisely why it is the one worth
                  arranging. */}
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
                    {c.label}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map(inv => (
                <tr key={inv.id} className="gn-tbl__row" onClick={() => setOpenId(inv.id)}>
                  {cols.cells({
                  invoice_number: (
                  <td>
                    {/* A real button inside the row, so the record is reachable
                        by keyboard. The row's onClick alone was mouse-only. */}
                    <button type="button" className="gn-link gn-tbl__id"
                      onClick={e => { e.stopPropagation(); setOpenId(inv.id); }}>
                      {inv.invoice_number}
                    </button>
                  </td>
                  ),
                  contact_name: <td>{inv.contact_name || '—'}</td>,
                  /* Place of supply is the field that decides IGST vs
                      CGST+SGST, so the tag beside it is not decoration: it is
                      the consequence of the value, and a reader checking a
                      return wants both in one glance.

                      `place_of_supply` is `TEXT DEFAULT ''`, and every invoice
                      this build GENERATES leaves it empty — so the blank case
                      is the common case, not an edge. An em dash here would
                      read as "not applicable", which is the one thing it is
                      not: a missing place of supply is a GSTR-1 blocker
                      (`services/gst_period.py:364`). It says so. */
                  place_of_supply: (
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
                  ),
                  invoice_type: <td><Badge text={INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} color="var(--st-in-progress)" /></td>,
                  invoice_date: <td className="gn-tbl__mono">{inv.invoice_date}</td>,
                  /* Taxable and GST, the reference's two money columns
                      (`ScreensBiz.jsx:35`). GST is the sum of the three heads
                      rather than a fourth column each, because on any one
                      invoice either igst is non-zero or cgst+sgst are, never
                      both — and which of the two it is, is already carried by
                      the IGST / C+S tag in the cell above. */
                  subtotal: <td className="tbl__num">{inr(Number(inv.subtotal) || 0)}</td>,
                  gst: (
                  <td className="tbl__num gn-tbl__mute">
                    {inr((Number(inv.cgst) || 0) + (Number(inv.sgst) || 0) + (Number(inv.igst) || 0))}
                  </td>
                  ),
                  total: <td className="tbl__num">{inr(Number(inv.total))}</td>,
                  amount_paid: <td className="tbl__num gn-tbl__ok">{inr(Number(inv.amount_paid))}</td>,
                  balance_due: (
                  <td className={`tbl__num ${Number(inv.balance_due) > 0 ? 'gn-tbl__due' : 'gn-tbl__mute'}`}>
                    {inr(Number(inv.balance_due))}
                  </td>
                  ),
                  /* ⚠ A DRAFT AND AN ISSUED-UNPAID INVOICE READ IDENTICALLY
                     until 2026-08-29: the register did not select `doc_status`
                     at all, so both showed `unpaid` and a firm could not see
                     which of its receivables had even been sent. Found by
                     proposal 93 Suite 05 on a register of 45 invoices, 13 of
                     them drafts.

                     A draft's payment status is not a fact about the world —
                     nobody has been asked to pay, so "unpaid" is not a state
                     the customer is in. Draft REPLACES it rather than sitting
                     beside it. Once issued, the payment status is the answer
                     again and this cell is exactly what it always was.

                     `doc_status` is NOT the editability signal: it defaults to
                     `'final'` and an unpaid invoice is editable by product
                     rule. It answers one question — has this been issued. */
                  status: (
                  <td>
                    {inv.doc_status === 'draft'
                      ? <Badge text="Draft" color="var(--on-surface-3)" />
                      : <Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || 'var(--on-surface-3)'} />}
                  </td>
                  ),
                  /* WHOSE SALE IT IS. `salesperson_id` is a `users.user_id`, so
                     the NAME is resolved server-side and the id never reaches
                     here. Null means no salesperson was ever recorded, which is
                     a different absence from `Unnamed member` (an id whose user
                     row is gone) — the server keeps them apart deliberately. */
                  salesperson_name: <td className="gn-tbl__mute">{inv.salesperson_name || '—'}</td>,
                  [CREATED_KEY]: <CreatedCell value={inv.created_at} />,
                  created_by_name: <ByCell name={inv.created_by_name} hasActor={inv.has_creator} />,
                  customer_ref: <td className="gn-tbl__mute">{inv.customer_ref || '—'}</td>,
                  [UPDATED_KEY]: <UpdatedCell value={inv.updated_at} />,
                  // `has_updater` is not optional: an invoice edited by an
                  // employee who has since left resolves to a null name, and
                  // without the boolean that renders as an em dash — "nobody
                  // changed this" — which is the opposite of what happened.
                  updated_by_name: <ByCell name={inv.updated_by_name} hasActor={inv.has_updater} />,
                  })}
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
