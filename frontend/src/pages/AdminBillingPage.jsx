import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const STATUS_COLORS = {
  active: '#10b981', pending: '#f59e0b', paid: '#10b981',
  overdue: '#ef4444', cancelled: '#ef4444',
};

function Badge({ status }) {
  const c = STATUS_COLORS[status] || '#6E7B91';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${c}18`, color: c }}>
      {status}
    </span>
  );
}

function Card({ title, children, style }) {
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)',
      borderRadius: 12, padding: 24, ...style }}>
      {title && <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>{title}</h3>}
      {children}
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', ...rest }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--rule-soft)',
          borderRadius: 8, background: 'var(--surface-1)', color: 'var(--ink-1)', boxSizing: 'border-box' }}
        {...rest} />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--rule-soft)',
          borderRadius: 8, background: 'var(--surface-1)', color: 'var(--ink-1)' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Btn({ children, onClick, variant = 'primary', disabled, style: s }) {
  const base = { padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition: 'all .15s' };
  const styles = variant === 'primary'
    ? { ...base, background: 'var(--k-primary)', color: '#fff' }
    : { ...base, background: 'var(--surface-2)', color: 'var(--ink-1)', border: '1px solid var(--rule-soft)' };
  return <button onClick={onClick} disabled={disabled} style={{ ...styles, ...s }}>{children}</button>;
}

export default function AdminBillingPage() {
  const { pushToast } = useToast();
  const [tab, setTab] = useState('overview');
  const [plans, setPlans] = useState([]);
  const [availableModules, setAvailableModules] = useState([]);
  const [sub, setSub] = useState(null);
  const [activeModules, setActiveModules] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  // Invoice form
  const [invForm, setInvForm] = useState({ period_start: '', period_end: '', due_date: '', description: '', amount: '' });
  // Payment form
  const [payForm, setPayForm] = useState({ invoiceId: null, method: '', reference: '' });
  // Plan change
  const [planForm, setPlanForm] = useState({ plan_code: '', billing_cycle: 'monthly' });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [cur, inv, usg, catalog, od] = await Promise.all([
        api.get('/v1/subscription/current'),
        api.get('/v1/subscription/invoices'),
        api.get('/v1/subscription/usage'),
        api.get('/v1/subscription/plans'),
        api.get('/v1/subscription/admin/invoices/overdue').catch(() => ({ data: { data: [] } })),
      ]);
      setSub(cur.data.subscription);
      setActiveModules(cur.data.active_modules || []);
      setInvoices(inv.data.data || []);
      setUsage(usg.data);
      setPlans(catalog.data.plans || []);
      setAvailableModules(catalog.data.modules || []);
      setOverdue(od.data.data || []);
      if (cur.data.subscription?.plan_code) setPlanForm(f => ({ ...f, plan_code: cur.data.subscription.plan_code }));
    } catch (e) {
      pushToast({ title: 'Failed to load billing data', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPlan() {
    if (!sub) return pushToast({ title: 'No subscription found', type: 'error' });
    try {
      await api.post('/v1/subscription/admin/set-plan', {
        plan_code: planForm.plan_code, billing_cycle: planForm.billing_cycle,
      });
      pushToast({ title: `Plan changed to ${planForm.plan_code}` });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to change plan', type: 'error' });
    }
  }

  async function handleActivateModule(code) {
    try {
      await api.post('/v1/subscription/modules/activate', { module_code: code });
      pushToast({ title: `Module "${code}" activated` });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to activate module', type: 'error' });
    }
  }

  async function handleDeactivateModule(code) {
    try {
      await api.post('/v1/subscription/modules/deactivate', { module_code: code });
      pushToast({ title: `Module "${code}" deactivated` });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to deactivate module', type: 'error' });
    }
  }

  async function handleCreateInvoice() {
    if (!sub) return;
    try {
      await api.post('/v1/subscription/admin/invoices', {
        period_start: invForm.period_start,
        period_end: invForm.period_end,
        due_date: invForm.due_date,
        line_items: [{ description: invForm.description, amount: parseFloat(invForm.amount) || 0 }],
      });
      pushToast({ title: 'Invoice created' });
      setInvForm({ period_start: '', period_end: '', due_date: '', description: '', amount: '' });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to create invoice', type: 'error' });
    }
  }

  async function handleRecordPayment() {
    if (!payForm.invoiceId) return;
    try {
      await api.patch(`/v1/subscription/admin/invoices/${payForm.invoiceId}/record-payment`, {
        payment_method: payForm.method, payment_reference: payForm.reference,
      });
      pushToast({ title: 'Payment recorded' });
      setPayForm({ invoiceId: null, method: '', reference: '' });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to record payment', type: 'error' });
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'modules', label: 'Modules' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'plan', label: 'Change Plan' },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Billing Administration" subtitle="Manage subscriptions, modules, invoices, and payments" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--rule-soft)', paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', background: 'none',
              color: tab === t.id ? 'var(--k-primary)' : 'var(--ink-3)', cursor: 'pointer',
              borderBottom: tab === t.id ? '2px solid var(--k-primary)' : '2px solid transparent',
              marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
            <StatTile label="Plan" value={sub?.plan_name || 'Free'} />
            <StatTile label="Users" value={`${usage?.user_count || 0} / ${sub?.max_users || 5}`} />
            <StatTile label="Active Modules" value={activeModules.length} />
            <StatTile label="Overdue Invoices" value={overdue.length} />
          </div>

          {overdue.length > 0 && (
            <Card title="⚠ Overdue Invoices" style={{ marginBottom: 24, borderColor: '#ef4444' }}>
              {overdue.map(inv => (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoice_number}</span>
                    <span style={{ marginLeft: 12, color: 'var(--ink-3)', fontSize: 12 }}>{inv.org_name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>₹{inv.total?.toLocaleString('en-IN')}</span>
                    <span style={{ fontSize: 11, color: '#ef4444' }}>Due: {inv.due_date}</span>
                    <Btn variant="ghost" onClick={() => { setPayForm({ invoiceId: inv.id, method: '', reference: '' }); setTab('invoices'); }}>
                      Record Payment
                    </Btn>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {/* Modules */}
      {tab === 'modules' && (
        <Card title="Module Marketplace">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {availableModules.map(m => {
              const isActive = activeModules.includes(m.code);
              return (
                <div key={m.code} style={{ border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16,
                  background: isActive ? 'var(--k-primary-ghost)' : 'transparent' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                    {m.name || m.code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>{m.description || ''}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--k-primary)', marginBottom: 12 }}>
                    ₹{m.price_per_user_monthly}/user/mo
                  </div>
                  {m.requires_module?.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>
                      Requires: {m.requires_module.join(', ')}
                    </div>
                  )}
                  {isActive ? (
                    <Btn variant="ghost" onClick={() => handleDeactivateModule(m.code)}
                      style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                      Deactivate
                    </Btn>
                  ) : (
                    <Btn onClick={() => handleActivateModule(m.code)}>Activate</Btn>
                  )}
                </div>
              );
            })}
          </div>
          {(sub?.plan_code === 'free' || !sub) && (
            <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 16, fontWeight: 600 }}>
              Upgrade to Professional or higher to enable add-on modules.
            </p>
          )}
        </Card>
      )}

      {/* Invoices */}
      {tab === 'invoices' && (
        <>
          {/* Create invoice form */}
          <Card title="Create Invoice" style={{ marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Input label="Period Start" type="date" value={invForm.period_start}
                onChange={v => setInvForm(f => ({ ...f, period_start: v }))} />
              <Input label="Period End" type="date" value={invForm.period_end}
                onChange={v => setInvForm(f => ({ ...f, period_end: v }))} />
              <Input label="Due Date" type="date" value={invForm.due_date}
                onChange={v => setInvForm(f => ({ ...f, due_date: v }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <Input label="Description" value={invForm.description}
                onChange={v => setInvForm(f => ({ ...f, description: v }))} />
              <Input label="Amount (₹)" type="number" value={invForm.amount}
                onChange={v => setInvForm(f => ({ ...f, amount: v }))} />
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '0 0 12px' }}>GST (18%) will be calculated automatically.</p>
            <Btn onClick={handleCreateInvoice}
              disabled={!invForm.period_start || !invForm.amount}>
              Create Invoice
            </Btn>
          </Card>

          {/* Record payment */}
          {payForm.invoiceId && (
            <Card title="Record Payment" style={{ marginBottom: 24, borderColor: 'var(--k-primary)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Select label="Payment Method" value={payForm.method}
                  onChange={v => setPayForm(f => ({ ...f, method: v }))}
                  options={[
                    { value: '', label: 'Select method…' },
                    { value: 'bank_transfer', label: 'Bank Transfer (NEFT/RTGS/UPI)' },
                    { value: 'cheque', label: 'Cheque' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'other', label: 'Other' },
                  ]} />
                <Input label="Payment Reference / UTR" value={payForm.reference}
                  onChange={v => setPayForm(f => ({ ...f, reference: v }))} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Btn onClick={handleRecordPayment} disabled={!payForm.method || !payForm.reference}>
                  Confirm Payment
                </Btn>
                <Btn variant="ghost" onClick={() => setPayForm({ invoiceId: null, method: '', reference: '' })}>
                  Cancel
                </Btn>
              </div>
            </Card>
          )}

          {/* Invoice list */}
          <Card title="All Invoices">
            {invoices.length === 0 ? (
              <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No invoices yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    {['Invoice #', 'Period', 'Subtotal', 'GST', 'Total', 'Status', 'Due', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600,
                        color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoice_number}</td>
                      <td style={{ padding: '10px', fontSize: 12 }}>{inv.period_start} → {inv.period_end}</td>
                      <td style={{ padding: '10px' }}>₹{inv.subtotal?.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '10px' }}>₹{inv.gst?.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '10px', fontWeight: 600 }}>₹{inv.total?.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '10px' }}><Badge status={inv.payment_status} /></td>
                      <td style={{ padding: '10px', fontSize: 12 }}>{inv.due_date}</td>
                      <td style={{ padding: '10px' }}>
                        {inv.payment_status === 'pending' && (
                          <Btn variant="ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={() => setPayForm({ invoiceId: inv.id, method: '', reference: '' })}>
                            Record Payment
                          </Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* Change Plan */}
      {tab === 'plan' && (
        <Card title="Change Organisation Plan">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 500 }}>
            <Select label="Plan" value={planForm.plan_code}
              onChange={v => setPlanForm(f => ({ ...f, plan_code: v }))}
              options={plans.map(p => ({ value: p.code, label: `${p.name} — ₹${p.price_monthly}/mo` }))} />
            <Select label="Billing Cycle" value={planForm.billing_cycle}
              onChange={v => setPlanForm(f => ({ ...f, billing_cycle: v }))}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: 'Annual' },
              ]} />
          </div>
          {planForm.plan_code === 'free' && (
            <p style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, margin: '12px 0 0' }}>
              Downgrading to Free will deactivate all add-on modules.
            </p>
          )}
          <Btn onClick={handleSetPlan} style={{ marginTop: 16 }}
            disabled={planForm.plan_code === sub?.plan_code}>
            Apply Plan Change
          </Btn>
        </Card>
      )}
    </div>
  );
}
