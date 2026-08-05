import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Checkbox, Field, Input, Modal, Textarea } from '../../components/ui';
import { inr, grouped } from '../../lib/inr';
import { refusalMessage } from './BillingLineRow';

/**
 * TopUpDialog — the first caller of an endpoint that has been correct and
 * unreachable (BUILD SPEC §4.4).
 *
 * `POST /v1/admin/orgs/{org_id}/credits/topup` already exists, already writes
 * the purchased bucket, already writes the ledger, and is called from NOWHERE in
 * the product. Aekam has been topping orgs up in psql. This dialog opens it; it
 * does not add a fourth top-up path, and it must not.
 *
 * ── The three things this dialog is careful about ────────────────────────────
 *
 *  · **Two buckets, always.** Credits land in `purchased`, which carries over;
 *    `allowance` resets at the month roll with no carry-over. One combined
 *    number hides the only distinction that matters to somebody who has PAID.
 *  · **One idempotency key per opening.** Generated when the dialog opens and
 *    reused on every retry, so a double-click, a flaky connection and an
 *    impatient second press are one top-up. `credits.grant()` replays the key
 *    and returns the balance without granting again.
 *  · **The invoice line is not a second request.** Ticking "add this to the next
 *    invoice" makes the same handler write one `org_billing_lines` row inside
 *    the same transaction as the grant, keyed on `source_ref='credit_tx:{id}'`.
 *    Two requests would allow "credits added, never billed" — which is the
 *    failure that is invisible until the month closes.
 */

/**
 * `services/credits.py:74  CREDIT_PRICE_INR = 4`. Transcribed, not derived: no
 * endpoint publishes it. It is shown as INDICATIVE beside the credit figure and
 * is never the number stored, because the ledger holds credits and nothing
 * else — inventing a rupee total the ledger does not carry is how a receipt
 * stops matching an invoice.
 */
export const CREDIT_PRICE_INR = 4;

/** A v4 key. `crypto.randomUUID` is absent in jsdom and in older WebViews. */
function newKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const defaultDescription = amount =>
  `Credit top-up — ${grouped(Math.max(Number(amount) || 0, 0))} credits`;

export default function TopUpDialog(props) {
  // One line, for scripts/check-write-gates.mjs — see BillingLineRow.
  const { canWrite, reason } = props;
  const { open, orgId, orgName, isPlatformOrg = false, onClose, onDone } = props;

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [addToInvoice, setAddToInvoice] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [receipt, setReceipt] = useState(null);
  const idemKey = useRef('');

  /* Minted on the OPEN edge, not on every render and not per submit. This is
     the whole idempotency story: the same dialog, however many presses, is one
     top-up. "Top up again" below mints a new one deliberately. */
  useEffect(() => {
    if (!open) return;
    idemKey.current = newKey();
    setAmount(''); setNotes(''); setAddToInvoice(false); setDescription('');
    setRefusal(''); setReceipt(null); setBusy(false);
  }, [open]);

  const credits = Math.floor(Number(amount));
  const valid = Number.isFinite(credits) && credits > 0;
  const lineText = description.trim() || defaultDescription(credits);

  const submit = async () => {
    if (!valid || !canWrite) return;
    setBusy(true);
    setRefusal('');
    try {
      const res = await api.post(`/v1/admin/orgs/${orgId}/credits/topup`, {
        amount: credits,
        notes: notes.trim(),
        idempotency_key: idemKey.current,
        add_to_invoice: addToInvoice,
        invoice_description: addToInvoice ? lineText : undefined,
      });
      setReceipt(res.data || {});
      onDone?.();
    } catch (e) {
      // The refusal sentence, rendered and nothing else. It already names what
      // is needed and what is held.
      setRefusal(refusalMessage(e, 'The top-up did not go through.'));
    } finally { setBusy(false); }
  };

  const again = () => {
    idemKey.current = newKey();
    setAmount(''); setNotes(''); setAddToInvoice(false); setDescription('');
    setReceipt(null); setRefusal('');
  };

  const footer = receipt ? (
    <>
      <Button variant="fill" onClick={onClose}>Done</Button>
      <Button variant="ghost" onClick={again}>Top up again</Button>
    </>
  ) : (
    <>
      <Button
        variant="fill"
        disabled={!valid || busy || !canWrite}
        title={canWrite ? undefined : reason || undefined}
        onClick={submit}
      >
        {busy ? 'Adding…' : (valid ? `Add ${grouped(credits)} credits` : 'Add credits')}
      </Button>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={v => { if (!v) onClose?.(); }}
      title={`Top up credits · ${orgName || 'organisation'}`}
      dataTestId="topup"
      footer={footer}
    >
      {receipt ? (
        <div className="tup">
          {/* The BALANCE is reported, not "added N". `grant()` replays a repeated
              key and returns the wallet untouched, while the endpoint still
              echoes the amount that was asked for — so the echo can be a number
              that was never granted on this call. The buckets cannot lie. */}
          <p className="tup__ok">Top-up accepted. This is the wallet as it now stands.</p>
          <div className="crb">
            <div className="crb__b">
              <span className="crb__k">Allowance</span>
              <b className="crb__v">{grouped(receipt.allowance ?? 0)}</b>
              <span className="crb__n">resets each month, no carry-over</span>
            </div>
            <div className="crb__b">
              <span className="crb__k">Purchased</span>
              <b className="crb__v">{grouped(receipt.purchased ?? 0)}</b>
              <span className="crb__n">carries over — this is where a top-up lands</span>
            </div>
            <div className="crb__b">
              <span className="crb__k">Total</span>
              <b className="crb__v">{grouped(receipt.balance ?? 0)}</b>
              <span className="crb__n">what a spend is checked against</span>
            </div>
          </div>
          {addToInvoice && (
            <p className="tup__note">
              Billed as a one-off line this month: <b>{lineText}</b>. The line is written in the
              same transaction as the credits, so it exists because this succeeded.
            </p>
          )}
          {!addToInvoice && (
            <p className="tup__note">
              No invoice line was created — “add this to the next invoice” was not ticked.
            </p>
          )}
        </div>
      ) : (
        <div className="tup">
          <div className="adm-form adm-form--tight">
            <Field
              label="Credits"
              sanskrit="श्रेय"
              htmlFor="tup-amount"
              hint="Whole credits. This is the unit the ledger holds."
            >
              {p => (
                <Input
                  {...p}
                  type="number" inputMode="numeric" min="1" step="1"
                  value={amount}
                  disabled={busy || !canWrite}
                  title={canWrite ? undefined : reason || undefined}
                  onChange={e => setAmount(e.target.value)}
                />
              )}
            </Field>
            <div className="crb__b tup__amt">
              <span className="crb__k">Indicative value</span>
              <b className="crb__v">{valid ? inr(credits * CREDIT_PRICE_INR) : '—'}</b>
              <span className="crb__n">at ₹{CREDIT_PRICE_INR} a credit · not stored</span>
            </div>
          </div>

          <Field
            label="Reason"
            htmlFor="tup-notes"
            hint="Goes onto the ledger row as its description. A top-up with no reason is one nobody can reconcile later."
          >
            {p => (
              <Textarea
                {...p}
                rows={2}
                value={notes}
                disabled={busy || !canWrite}
                placeholder="Paid by NEFT 12 Aug, ref …"
                onChange={e => setNotes(e.target.value)}
              />
            )}
          </Field>

          <div className="tup__inv">
            <Checkbox
              checked={addToInvoice}
              disabled={busy || !canWrite}
              label="Add this to the next invoice"
              onChange={setAddToInvoice}
            />
            <span className="tup__lbl">Add this to the next invoice</span>
          </div>
          {addToInvoice && (
            <Field label="Invoice line description" htmlFor="tup-desc">
              {p => (
                <Input
                  {...p}
                  value={description}
                  disabled={busy || !canWrite}
                  placeholder={defaultDescription(credits)}
                  onChange={e => setDescription(e.target.value)}
                />
              )}
            </Field>
          )}

          <p className="tup__note">
            Credits land in the <b>purchased</b> bucket. They carry over indefinitely; the
            monthly allowance does not.
            {isPlatformOrg && ' This organisation’s balance is unlimited — spend is recorded, '
              + 'never deducted — so a top-up here changes a figure nothing is checked against.'}
          </p>

          {refusal && <p className="inb__note" role="alert">{refusal}</p>}
        </div>
      )}
    </Modal>
  );
}
