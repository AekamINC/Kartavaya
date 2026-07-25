import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, CONTRACT_COLORS, SIGN_STATUS_COLORS } from './_shared';

export default function ESignTab() {
  const { pushToast } = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [sigStatus, setSigStatus] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [signers, setSigners] = useState([{ name: '', email: '', role: 'signer' }]);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/ganit/contracts');
      setContracts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load contracts', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function selectContract(c) {
    setSelected(c);
    setSigStatus(null);
    setAuditTrail([]);
    setSigners([{ name: '', email: '', role: 'signer' }]);
    try {
      const [statusRes, auditRes] = await Promise.all([
        api.get(`/v1/ganit/contracts/${c.id}/signature-status`).catch(() => null),
        api.get(`/v1/ganit/contracts/${c.id}/audit-trail`).catch(() => null),
      ]);
      if (statusRes) setSigStatus(statusRes.data);
      if (auditRes) setAuditTrail(auditRes.data.data || auditRes.data.events || []);
    } catch {}
  }

  async function sendForSignature(e) {
    e.preventDefault();
    const valid = signers.every(s => s.name.trim() && s.email.trim());
    if (!valid) { pushToast({ title: 'Fill all signer names and emails', type: 'error' }); return; }
    setSending(true);
    try {
      await api.post(`/v1/ganit/contracts/${selected.id}/send-for-signature`, { signers });
      pushToast({ title: 'Sent for signature', type: 'success' });
      selectContract(selected);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed to send', type: 'error' }); }
    finally { setSending(false); }
  }

  async function cancelSignature() {
    setCancelling(true);
    try {
      await api.post(`/v1/ganit/contracts/${selected.id}/cancel-signature`);
      pushToast({ title: 'Signature cancelled', type: 'success' });
      selectContract(selected);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Cancel failed', type: 'error' }); }
    finally { setCancelling(false); }
  }

  function addSigner() {
    setSigners(s => [...s, { name: '', email: '', role: 'signer' }]);
  }

  function updateSigner(idx, field, val) {
    setSigners(s => { const n = [...s]; n[idx] = { ...n[idx], [field]: val }; return n; });
  }

  function removeSigner(idx) {
    setSigners(s => s.filter((_, i) => i !== idx));
  }

  if (selected) {
    const hasSent = sigStatus && sigStatus.signers && sigStatus.signers.length > 0;
    const canCancel = hasSent && sigStatus.signers.some(s => s.status === 'pending' || s.status === 'otp_sent');
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setSelected(null)}>← Back to list</button>

        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selected.title}</h3>
              {selected.contact_name && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{selected.contact_name}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>₹{Number(selected.contract_value || 0).toLocaleString('en-IN')}</span>
              <Badge text={selected.status} color={CONTRACT_COLORS[selected.status] || '#6E7B91'} />
            </div>
          </div>
        </div>

        {hasSent && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Signature Status</h4>
              {canCancel && (
                <button className="k-btn k-btn--ghost" style={{ fontSize: 12, color: '#ef4444' }} disabled={cancelling} onClick={cancelSignature}>
                  {cancelling ? 'Cancelling…' : 'Cancel Signature'}
                </button>
              )}
            </div>
            {sigStatus.signers.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{s.email}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {s.signed_at && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(s.signed_at).toLocaleString('en-IN')}</span>}
                  <Badge text={s.status} color={SIGN_STATUS_COLORS[s.status] || '#6E7B91'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasSent && (
          <form onSubmit={sendForSignature} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Send for Signature</h4>
            {signers.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 30px', gap: 8, marginBottom: 8 }}>
                <input className="k-input" placeholder="Signer name" value={s.name} onChange={e => updateSigner(i, 'name', e.target.value)} />
                <input className="k-input" type="email" placeholder="Signer email" value={s.email} onChange={e => updateSigner(i, 'email', e.target.value)} />
                {signers.length > 1 && (
                  <button type="button" onClick={() => removeSigner(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>
                )}
              </div>
            ))}
            <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={addSigner}>+ Add Signer</button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="submit" className="k-btn k-btn--primary" disabled={sending}>{sending ? 'Sending…' : 'Send for Signature'}</button>
            </div>
          </form>
        )}

        {auditTrail.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Audit Trail</h4>
            {auditTrail.map((ev, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{ev.event}</span>
                  {ev.actor_email && <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{ev.actor_email}</span>}
                  {ev.ip_address && <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{ev.ip_address}</span>}
                </div>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{new Date(ev.timestamp).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        contracts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No contracts yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Create contracts for recurring services or long-term agreements with clients.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contracts.map(c => (
            <div key={c.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}
              onClick={() => selectContract(c)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>₹{Number(c.contract_value || 0).toLocaleString('en-IN')}</span>
                  <Badge text={c.status} color={CONTRACT_COLORS[c.status] || '#6E7B91'} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {c.contact_name && <span>{c.contact_name} · </span>}
                {c.start_date && <span>{c.start_date} → {c.end_date || '…'}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
