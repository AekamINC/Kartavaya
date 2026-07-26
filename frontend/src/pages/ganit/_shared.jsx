// Constants and helpers shared across the ganit tabs.
// Extracted verbatim from the original single-file page component.
import React from 'react';
import { api } from '../../lib/api';

export const INV_TYPE_LABELS = { tax_invoice: 'Tax Invoice', proforma: 'Proforma', credit_note: 'Credit Note', debit_note: 'Debit Note', quotation: 'Quotation' };
export const STATUS_COLORS = { unpaid: '#f59e0b', partial: '#6366f1', paid: '#10b981', overdue: '#ef4444', cancelled: '#9ca3af' };
export const DOC_STATUS_COLORS = { draft: '#6E7B91', final: '#0082c6', sent: '#8b5cf6', viewed: '#10b981' };
export const CONTRACT_COLORS = { draft: '#6E7B91', active: '#10b981', expired: '#f59e0b', cancelled: '#ef4444', renewed: '#0082c6' };
export const PAY_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other'];
export const BILL_STATUS_COLORS = { unpaid: '#f59e0b', partially_paid: '#6366f1', paid: '#10b981', cancelled: '#9ca3af' };
export const SIGN_STATUS_COLORS = { pending: '#f59e0b', otp_sent: '#6366f1', signed: '#10b981', expired: '#9ca3af', cancelled: '#ef4444' };

export function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
  return [];
}
export function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
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
    <div style={{ marginTop: 16, background: 'color-mix(in srgb, var(--surface) 82%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>💳</span>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>UPI Payment Link</h4>
        <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, color: 'var(--ink-3)' }}>यूपीआई भुगतान</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Pay ₹{amount.toLocaleString('en-IN')} to</div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{upiId}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>Ref: {invoice.invoice_number}</div>
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
