// Constants and helpers shared across the ganit tabs.
//
// Every colour is a token reference. This file held the retired brand blue
// #0082c6 twice (00 §9 retires it), plus #8b5cf6, #ef4444, #f59e0b and two
// greys that are one token here — none of which followed the theme, so every
// invoice badge in the module rendered its light-mode colour on dark surfaces.
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import Tag from '../../components/ui/Tag';
import { inr } from '../../lib/inr';

export const INV_TYPE_LABELS = { tax_invoice: 'Tax Invoice', proforma: 'Proforma', credit_note: 'Credit Note', debit_note: 'Debit Note', quotation: 'Quotation' };
export const STATUS_COLORS = {
  unpaid: 'var(--warn)', partial: 'var(--st-in-review)', paid: 'var(--ok)',
  overdue: 'var(--danger)', cancelled: 'var(--on-surface-3)',
};
export const DOC_STATUS_COLORS = {
  draft: 'var(--on-surface-3)', final: 'var(--st-in-progress)',
  sent: 'var(--st-in-review)', viewed: 'var(--ok)',
};
export const CONTRACT_COLORS = {
  draft: 'var(--on-surface-3)', active: 'var(--ok)', expired: 'var(--warn)',
  cancelled: 'var(--danger)', renewed: 'var(--st-in-progress)',
};
export const PAY_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other'];
export const BILL_STATUS_COLORS = {
  unpaid: 'var(--warn)', partially_paid: 'var(--st-in-review)',
  paid: 'var(--ok)', cancelled: 'var(--on-surface-3)',
};
/* Signer statuses, as `staging.sign_signers.status` actually writes them.
   A contract's signature request is an e-Sign document now, so these are the
   e-Sign module's five (routers/esign.py) and not the Ganit path's own. The two
   sets overlapped on `pending` and `signed` only, which is why this map needs
   changing rather than extending: `otp_sent` was never written by the module
   that answers today, and `sent`, `opened` and `declined` — the three a real
   outstanding request passes through — had no colour at all and fell through to
   the caller's grey fallback. A DECLINED signer rendered in the same grey as an
   expired one is the one confusion here that costs money. */
export const SIGN_STATUS_COLORS = {
  pending: 'var(--warn)', sent: 'var(--warn)', opened: 'var(--st-in-review)',
  signed: 'var(--ok)', declined: 'var(--danger)',
  expired: 'var(--on-surface-3)', cancelled: 'var(--danger)',
};

/* The signer states a signature request can still be withdrawn from.
   Named here rather than inlined in the drawer's `canCancel`, because getting
   it wrong hides the only control that stops outstanding links working — and it
   was wrong: it tested for `pending` and `otp_sent`, so the "Cancel request"
   button disappeared for every signer who had actually been emailed. */
export const SIGN_OUTSTANDING = ['pending', 'sent', 'opened'];

export function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
  return [];
}

/**
 * Build a `wa.me` deep link for an invoice, or null when there is no number.
 *
 * A DEEP LINK, deliberately — NOT `POST /varta/conversations/{id}/messages`.
 * That endpoint's own body carries `TODO: Call Meta Cloud API` and writes a row
 * with `status: 'pending'`; it cannot send anything until the org's WhatsApp
 * Business account is approved. Wiring "Send on WhatsApp" to it would give you a
 * button that reports success and delivers nothing, on an invoice — which is the
 * dead-button failure this codebase has shipped before.
 *
 * `wa.me` works today, for every org, with no WABA and no integration. It hands
 * the message to whichever WhatsApp the user already has and lets them pick the
 * chat, so NOTHING IS SENT WITHOUT A HUMAN PRESSING SEND. That is also why the
 * PDF is not attached: a deep link carries text, not files. The flow is download,
 * then share — which is why the drawer offers both buttons rather than one.
 *
 * Exported (rather than nested inside the component, where it used to live) so
 * the URL can be asserted in a test without a browser and without opening
 * anything. See `src/__tests__/ganitWaLink.test.js`.
 */
export function waLink(phone, text) {
  // wa.me wants digits only, no `+`. A bare 10-digit number is Indian and the
  // country code is implied; anything longer already carries its own.
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

/**
 * The message body that accompanies an invoice on WhatsApp.
 *
 * Kept beside `waLink` so the two are tested together. Deliberately plain: the
 * recipient sees this in a chat before they see the document, and a line of
 * marketing there reads as spam from an accounts department.
 */
export function waInvoiceText(inv) {
  const kind = INV_TYPE_LABELS[inv?.invoice_type] || 'Invoice';
  const amount = inv?.total != null ? inv.total : inv?.total_amount;
  return `${kind} ${inv?.invoice_number || ''}`.trimEnd()
    + (inv?.invoice_date ? ` dated ${inv.invoice_date}` : '')
    + (amount != null && amount !== '' ? ` for ${inr(Number(amount))}` : '')
    + '.';
}

/**
 * Badge — now `ui/Tag`, not a second private pill.
 *
 * See graha/_shared.jsx for the full note: three byte-identical local Badge
 * definitions, all duplicating `.tag`, all with a 10px font below the 11px
 * metadata floor, a literal 99px radius that ignores the Border radius setting,
 * and a `${color}18` hex-alpha suffix that produces nothing now the maps above
 * hold `var(--…)` references.
 */
export function Badge({ text, color, children }) {
  return <Tag color={color}>{text ?? children}</Tag>;
}

export function UpiPayBlock({ invoice }) {
  const [upiId, setUpiId] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.get('/v1/org/profile').then(r => {
      const id = r.data?.bank_details?.upi_id;
      if (id) setUpiId(id);
    }).catch(() => {});
  }, []);
  if (!upiId || invoice.payment_status === 'paid' || invoice.payment_status === 'cancelled') return null;
  const amount = Number(invoice.balance_due || invoice.total || 0);
  if (amount <= 0) return null;
  const orgName = invoice.org_name || 'Merchant';
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(orgName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Payment for ${invoice.invoice_number}`)}`;
  return (
    <div className="gn-upi">
      <div className="gn-upi__head">
        <h4 className="gn-upi__t">UPI payment link</h4>
        <span className="gn-upi__hi" lang="hi">यूपीआई भुगतान</span>
      </div>
      <div className="gn-upi__body">
        <div className="gn-upi__main">
          <div className="gn-upi__l">Pay {inr(amount)} to</div>
          <div className="gn-upi__id">{upiId}</div>
          {/* --ink-faint aliases --on-surface-faint, which is 2.3:1 and NON-TEXT
              ONLY (00 §12). An invoice reference number is content. */}
          <div className="gn-upi__ref">Ref: {invoice.invoice_number}</div>
        </div>
        <div className="gn-upi__acts">
          <a href={upiLink} className="btn btn--fill btn--sm">Open in UPI app</a>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              navigator.clipboard?.writeText(upiLink)
                .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
                .catch(() => {});
            }}
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}
