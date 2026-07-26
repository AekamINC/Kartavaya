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
export const SIGN_STATUS_COLORS = {
  pending: 'var(--warn)', otp_sent: 'var(--st-in-review)', signed: 'var(--ok)',
  expired: 'var(--on-surface-3)', cancelled: 'var(--danger)',
};

export function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
  return [];
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
    <div style={{ marginTop: 16, background: 'color-mix(in srgb, var(--surface) 82%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>💳</span>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>UPI Payment Link</h4>
        <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, color: 'var(--ink-3)' }}>यूपीआई भुगतान</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Pay {inr(amount)} to</div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{upiId}</div>
          {/* --ink-faint aliases --on-surface-faint, which is 2.3:1 and NON-TEXT
              ONLY (00 §12). An invoice reference number is content. */}
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>Ref: {invoice.invoice_number}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={upiLink} className="k-btn k-btn--primary" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Open in UPI App
          </a>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }}
            onClick={() => { navigator.clipboard.writeText(upiLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>
            {copied ? '✓ Copied' : 'Copy Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
