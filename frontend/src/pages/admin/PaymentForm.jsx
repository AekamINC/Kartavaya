import React from 'react';
import { Button, Field, Input, Select } from '../../components/ui';
import { inr } from '../../lib/inr';

/**
 * PaymentForm — 11-platform-admin.md §Other defects.
 *
 * ── The claim, split into the part that held and the part that is stale ──────
 *
 * 11: "Recording a payment has no date and no amount. So a payment received
 * last Tuesday is recorded as today, and a partial payment is impossible."
 *
 *  · **DATE — stale.** `AdminBillingPage.jsx` already sends `paid_at`, and
 *    `RecordPayment.paid_at` (subscription.py:43) is `Optional[datetime]` with
 *    `body.paid_at or datetime.now(...)` at line 344. It was a frontend-only
 *    gap and it had already been closed.
 *
 *  · **AMOUNT — holds, and it is a backend gap, not a frontend one.**
 *    `RecordPayment` has exactly three fields: payment_method,
 *    payment_reference, paid_at. `record_payment` then writes
 *    `payment_status='paid'` unconditionally and logs `float(inv["total"])` as
 *    the amount. There is no column and no field to put a part-payment in, so
 *    the invoice flips fully paid or stays pending.
 *
 * The amount is therefore shown and NOT editable, with the reason stated on the
 * form. An editable box whose value is discarded by the server is worse than no
 * box: it lets an operator believe they recorded ₹40,000 against a ₹90,000
 * invoice and walk away.
 */
const METHODS = [
  { value: '', label: 'Select method…' },
  { value: 'bank_transfer', label: 'Bank transfer (NEFT / RTGS / UPI)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export default function PaymentForm({ invoice, busy, onConfirm, onCancel }) {
  const [form, setForm] = React.useState({ method: '', reference: '', paidOn: '' });

  React.useEffect(() => { setForm({ method: '', reference: '', paidOn: '' }); }, [invoice?.id]);

  if (!invoice) return null;
  const ready = Boolean(form.method && form.reference.trim());

  return (
    <div className="apg__sec">
      <div className="adm-form adm-form--tight">
        <Field label="Payment method" htmlFor="pay-method">
          {p => (
            <Select {...p} value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          )}
        </Field>
        <Field
          label="Date received"
          htmlFor="pay-date"
          hint="Left blank, the server stamps today."
        >
          {p => <Input {...p} type="date" value={form.paidOn} onChange={e => setForm(f => ({ ...f, paidOn: e.target.value }))} />}
        </Field>
        <Field label="Reference / UTR" htmlFor="pay-ref">
          {p => <Input {...p} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="UTR or cheque number" />}
        </Field>
        <Field
          label="Amount"
          htmlFor="pay-amt"
          hint="Full invoice value. The API records payment status, not a payment amount, so a partial payment cannot be entered here."
        >
          {p => <Input {...p} readOnly value={inr(invoice.total || 0, { decimals: 2 })} />}
        </Field>
      </div>

      <div className="adm-actions">
        <Button
          variant="fill"
          disabled={!ready || busy}
          onClick={() => onConfirm?.({
            payment_method: form.method,
            payment_reference: form.reference.trim(),
            paid_at: form.paidOn ? new Date(form.paidOn).toISOString() : null,
          })}
        >
          {busy ? 'Recording…' : `Mark ${invoice.invoice_number} paid`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
