import React from 'react';
import { Button, Field, Input } from '../../components/ui';
import { inr } from '../../lib/inr';
import { gstBreakdown, defaultTreatment, supplierStateKnown, TREATMENTS } from './gst';

/**
 * InvoiceBuilder — 11-platform-admin.md §1 "Invoice builder".
 *
 * Two defects from 11, both confirmed against the branch:
 *
 *  · "`line_items` is already an array; the form builds one."
 *    `subscription.py:37  line_items: list[dict]` — the API has supported
 *    multi-line invoices since it was written, and the form exposed a single
 *    description and a single amount. Fixed here: rows are added and removed,
 *    and the payload is the array the endpoint already expects.
 *
 *  · "GST is hardcoded to 18% flat… A single `gst` column cannot represent a
 *    compliant intra-state invoice."
 *    The rate is genuinely 18%; the BREAKDOWN is what is missing. The split is
 *    computed and printed here as CGST+SGST or IGST — never a generic "GST" —
 *    and `gst.js` documents exactly which part of that survives the round trip
 *    and which needs a migration on `staging.subscription_invoices`.
 *
 * Nothing here computes the total that is charged. The server does that, from
 * `line_items`, at `subscription.py:292`. This shows the operator what the
 * server is about to produce, which is why the subtotal is derived from the
 * same rows rather than typed.
 */
const blank = () => ({ description: '', qty: '1', amount: '' });

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function lineTotal(row) {
  const q = row.qty === '' ? 1 : num(row.qty);
  return Math.round(num(row.amount) * q * 100) / 100;
}

export default function InvoiceBuilder({ org, busy, onCreate }) {
  const [period, setPeriod] = React.useState({ start: '', end: '', due: '' });
  const [rows, setRows] = React.useState([blank()]);
  const [treatment, setTreatment] = React.useState(() => defaultTreatment(org?.gstin));

  // A new org means a new tax treatment. Without this the operator's last
  // choice silently carries onto the next company they bill.
  React.useEffect(() => { setTreatment(defaultTreatment(org?.gstin)); }, [org?.id, org?.gstin]);

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => [...rs, blank()]);
  const dropRow = i => setRows(rs => (rs.length === 1 ? rs : rs.filter((_, j) => j !== i)));

  const subtotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const bd = gstBreakdown(subtotal, treatment);

  const hint = !supplierStateKnown()
    ? 'Supplier state is not configured (VITE_AEKAM_STATE_CODE), so this cannot be derived — choose it.'
    : !org?.gstin
      ? 'This organisation has no GSTIN in the console payload, so the place of supply cannot be derived — choose it.'
      : 'Derived from the customer GSTIN against the supplier state. Override if the place of supply differs.';

  const ready = Boolean(
    org?.id && period.start && period.end && period.due
    && rows.some(r => r.description.trim() && num(r.amount) > 0),
  );

  const submit = () => {
    if (!ready) return;
    onCreate?.({
      period_start: period.start,
      period_end: period.end,
      due_date: period.due,
      // qty is folded into `amount` because the column the server sums is
      // `item.amount`. Sending a qty it does not read would show a line total
      // on screen that the invoice does not agree with.
      line_items: rows
        .filter(r => r.description.trim() && num(r.amount) > 0)
        .map(r => ({
          description: r.description.trim(),
          amount: lineTotal(r),
          qty: r.qty === '' ? 1 : num(r.qty),
          unit_amount: num(r.amount),
        })),
      // Display-only, for the caller's log. `gst.js` explains why it does not
      // reach the database.
      gst_treatment: treatment,
    });
    setRows([blank()]);
    setPeriod({ start: '', end: '', due: '' });
  };

  return (
    <div className="inb">
      <div className="adm-form">
        <Field label="Period start" htmlFor="inb-start">
          {p => <Input {...p} type="date" value={period.start} onChange={e => setPeriod(v => ({ ...v, start: e.target.value }))} />}
        </Field>
        <Field label="Period end" htmlFor="inb-end">
          {p => <Input {...p} type="date" value={period.end} onChange={e => setPeriod(v => ({ ...v, end: e.target.value }))} />}
        </Field>
        <Field label="Due date" htmlFor="inb-due">
          {p => <Input {...p} type="date" value={period.due} onChange={e => setPeriod(v => ({ ...v, due: e.target.value }))} />}
        </Field>
      </div>

      <div className="inb__hd" aria-hidden="true">
        <span>Description</span>
        <span>Qty</span>
        <span>Amount ₹</span>
        <span />
      </div>

      {rows.map((r, i) => (
        <div className="inb__r" key={i}>
          <Input
            aria-label={`Line ${i + 1} description`}
            value={r.description}
            placeholder="Subscription — Growth, Aug 2026"
            onChange={e => setRow(i, { description: e.target.value })}
          />
          <Input
            aria-label={`Line ${i + 1} quantity`}
            type="number" min="1" step="1" value={r.qty}
            onChange={e => setRow(i, { qty: e.target.value })}
          />
          <Input
            aria-label={`Line ${i + 1} amount`}
            type="number" min="0" step="100" value={r.amount}
            onChange={e => setRow(i, { amount: e.target.value })}
          />
          <button
            type="button" className="inb__x"
            aria-label={`Remove line ${i + 1}`}
            disabled={rows.length === 1}
            onClick={() => dropRow(i)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      ))}

      <div className="adm-actions">
        <Button variant="text" size="sm" onClick={addRow}>+ Add line</Button>
      </div>

      {/* The treatment is a decision, not an inference. It is pre-selected when
          both state codes are known and left unmade when they are not.
          A <label for> would point at a group rather than a control, so the
          group carries its own name and the caption is plain text. */}
      <div className="fld">
        <span className="fld__l">Place of supply</span>
        <div className="adm-seg" role="group" aria-label="GST treatment">
          {TREATMENTS.map(t => (
            <button
              key={t.id}
              type="button"
              aria-pressed={treatment === t.id}
              className={treatment === t.id ? 'on' : undefined}
              onClick={() => setTreatment(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Honest about which end is missing. `GET /v1/admin/orgs` does not
            select `gstin` even though the column exists on
            staging.organisations, so today the customer end is the usual gap
            and the choice is manual whatever the supplier state is set to. */}
        <span className="fld__hint">{hint}</span>
      </div>

      <div className="inb__sum">
        <div className="inb__row"><span>Subtotal</span><b>{inr(bd.subtotal, { decimals: 2 })}</b></div>
        {bd.lines.map(l => (
          <div className="inb__row inb__gst" key={l.label}>
            <span>{l.label} @ {(l.rate * 100).toFixed(l.rate * 100 % 1 ? 1 : 0)}%</span>
            <b>{inr(l.amount, { decimals: 2 })}</b>
          </div>
        ))}
        <div className="inb__row inb__tot"><span>Total</span><b>{inr(bd.total, { decimals: 2 })}</b></div>
      </div>

      <p className="inb__note">
        The server recomputes GST as a single 18% figure into one <code>gst</code> column
        on <code>subscription_invoices</code>. The split above is what the document must
        show; storing it as separate CGST/SGST/IGST columns is a migration this screen
        cannot make. Tenant tax invoices (Ganit) already store the split in full.
      </p>

      <div className="adm-actions">
        <Button variant="fill" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Creating…' : 'Create invoice'}
        </Button>
        {!org?.id && <span className="osc__none">Choose an organisation first.</span>}
      </div>
    </div>
  );
}
