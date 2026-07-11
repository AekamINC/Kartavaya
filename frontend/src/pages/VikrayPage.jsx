import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const STATUS_COLORS = { draft: '#6E7B91', confirmed: '#0082c6', dispatched: '#8b5cf6', delivered: '#10b981', closed: '#05b7aa', cancelled: '#9ca3af' };
const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

const TABS = ['dashboard', 'orders', 'pipeline', 'targets', 'customers'];

export default function VikrayPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Vikray · विक्रय" subtitle="Sales — Orders, Targets & Pipeline" />
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'customers' && <CustomersTab />}
    </div>
  );
}


function DashboardTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/v1/vikray/dashboard').then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading dashboard…</p>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      <StatTile label="Pipeline Value" value={FMT(data.pipeline_value)} />
      <StatTile label="Open Deals" value={data.open_deals} />
      <StatTile label="Order Value" value={FMT(data.order_value)} />
      <StatTile label="Total Orders" value={data.total_orders} />
      <StatTile label="Revenue" value={FMT(data.total_revenue)} />
      <StatTile label="Collected" value={FMT(data.collected)} />
      <StatTile label="Draft" value={data.draft_orders} />
      <StatTile label="Dispatched" value={data.dispatched_orders} />
    </div>
  );
}


function OrdersTab() {
  const { pushToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState({
    contact_id: '', deal_id: '', order_date: '', expected_delivery: '', is_igst: false,
    discount: 0, shipping_address: {}, notes: '',
    line_items: [{ description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }],
  });

  useEffect(() => { load(); }, [statusFilter]);

  async function load() {
    try {
      let url = '/v1/vikray/orders?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setOrders(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load orders', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadOptions() {
    try {
      const [c, p] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/ganit/products')]);
      setContacts(c.data.data || []);
      setProducts(p.data.data || []);
    } catch {}
  }

  function addLine() {
    setForm(f => ({ ...f, line_items: [...f.line_items, { description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }] }));
  }
  function updateLine(idx, field, val) {
    setForm(f => { const items = [...f.line_items]; items[idx] = { ...items[idx], [field]: val }; return { ...f, line_items: items }; });
  }
  function removeLine(idx) { setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) })); }

  function fillFromProduct(idx, productId) {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    updateLine(idx, 'description', p.name);
    updateLine(idx, 'hsn_code', p.hsn_code || p.sac_code || '');
    updateLine(idx, 'rate', Number(p.price));
    updateLine(idx, 'gst_rate', Number(p.gst_rate));
    updateLine(idx, 'unit', p.unit || 'NOS');
  }

  const computedSubtotal = form.line_items.reduce((s, li) => {
    let lt = li.quantity * li.rate;
    if (li.discount_pct > 0) lt *= (1 - li.discount_pct / 100);
    return s + lt;
  }, 0);
  const computedGst = form.line_items.reduce((s, li) => {
    let lt = li.quantity * li.rate;
    if (li.discount_pct > 0) lt *= (1 - li.discount_pct / 100);
    return s + lt * li.gst_rate / 100;
  }, 0);
  const computedTotal = computedSubtotal + computedGst - (form.discount || 0);

  async function save(e) {
    e.preventDefault();
    if (form.line_items.length === 0) { pushToast({ title: 'Add at least one line item', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/vikray/orders', form);
      pushToast({ title: 'Sales order created', type: 'success' });
      setShowForm(false);
      setForm({
        contact_id: '', deal_id: '', order_date: '', expected_delivery: '', is_igst: false,
        discount: 0, shipping_address: {}, notes: '',
        line_items: [{ description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }],
      });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function loadDetail(id) {
    try { const r = await api.get(`/v1/vikray/orders/${id}`); setDetail(r.data); } catch { pushToast({ title: 'Failed to load order', type: 'error' }); }
  }

  async function updateStatus(newStatus) {
    if (!detail) return;
    try {
      await api.patch(`/v1/vikray/orders/${detail.id}/status`, { status: newStatus });
      pushToast({ title: `Status → ${newStatus}`, type: 'success' });
      loadDetail(detail.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function generateInvoice() {
    if (!detail) return;
    try {
      const r = await api.post(`/v1/vikray/orders/${detail.id}/invoice`);
      pushToast({ title: `Invoice ${r.data.invoice_number} generated`, type: 'success' });
      loadDetail(detail.id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function cancelOrder() {
    if (!detail) return;
    try {
      await api.delete(`/v1/vikray/orders/${detail.id}`);
      pushToast({ title: 'Order cancelled', type: 'success' });
      setDetail(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  const NEXT_STATUS = { draft: 'confirmed', confirmed: 'dispatched', dispatched: 'delivered', delivered: 'closed' };
  const NEXT_LABEL = { draft: 'Confirm Order', confirmed: 'Mark Dispatched', dispatched: 'Mark Delivered', delivered: 'Close Order' };

  if (detail) {
    const o = detail;
    const items = Array.isArray(o.line_items) ? o.line_items : JSON.parse(o.line_items || '[]');
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{o.order_number}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>
                {o.order_date} {o.expected_delivery && `· Delivery: ${o.expected_delivery}`}
              </p>
            </div>
            <Badge text={o.status} color={STATUS_COLORS[o.status] || '#6E7B91'} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {NEXT_STATUS[o.status] && <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => updateStatus(NEXT_STATUS[o.status])}>{NEXT_LABEL[o.status]}</button>}
            {o.status !== 'draft' && !o.invoice_id && <button className="k-btn k-btn--primary" style={{ fontSize: 12, background: '#10b981' }} onClick={generateInvoice}>Generate Invoice</button>}
            {(o.status === 'draft' || o.status === 'confirmed') && <button className="k-btn k-btn--ghost" style={{ fontSize: 12, color: '#ef4444' }} onClick={cancelOrder}>Cancel</button>}
            {o.invoice_id && <Badge text="Invoiced" color="#10b981" />}
          </div>

          {o.contact_name && (
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 16 }}>
              <strong>Customer:</strong> {o.contact_name} {o.contact_company && `(${o.contact_company})`}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--rule-soft)' }}>
                {['Description', 'HSN', 'Qty', 'Rate', 'GST%', 'Amount'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Description' ? 'left' : 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((li, i) => {
                const amt = li.quantity * li.rate * (1 - (li.discount_pct || 0) / 100);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '8px 10px' }}>{li.description}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{li.hsn_code || '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{li.quantity} {li.unit}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(li.rate)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{li.gst_rate}%</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{FMT(amt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 280, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Subtotal</span><span>{FMT(o.subtotal)}</span></div>
              {!o.is_igst ? (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>CGST</span><span>{FMT(o.cgst)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>SGST</span><span>{FMT(o.sgst)}</span></div>
              </>) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>IGST</span><span>{FMT(o.igst)}</span></div>
              )}
              {Number(o.discount) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#ef4444' }}><span>Discount</span><span>-{FMT(o.discount)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, borderTop: '2px solid var(--rule-soft)', marginTop: 4 }}><span>Total</span><span>{FMT(o.total)}</span></div>
            </div>
          </div>

          {o.notes && <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }}>Notes: {o.notes}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--rule-soft)', background: 'var(--surface-1)' }}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => { setShowForm(!showForm); if (!showForm) loadOptions(); }}>
          {showForm ? 'Cancel' : '+ New Order'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: 12 }}>Customer
              <select value={form.contact_id} onChange={e => setForm(f => ({ ...f, contact_id: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }}>
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>Order Date
              <input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Expected Delivery
              <input type="date" value={form.expected_delivery} onChange={e => setForm(f => ({ ...f, expected_delivery: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.is_igst} onChange={e => setForm(f => ({ ...f, is_igst: e.target.checked }))} /> Inter-state (IGST)
            </label>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Line Items</h4>
          {form.line_items.map((li, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr .8fr .8fr 1fr .8fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
              <div>
                <select onChange={e => fillFromProduct(idx, e.target.value)} style={{ width: '100%', padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)', marginBottom: 4 }}>
                  <option value="">From product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input placeholder="Description" value={li.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                  style={{ width: '100%', padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)' }} />
              </div>
              <input placeholder="HSN" value={li.hsn_code} onChange={e => updateLine(idx, 'hsn_code', e.target.value)}
                style={{ padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)' }} />
              <input type="number" min="1" value={li.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                style={{ padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)' }} />
              <input type="number" value={li.rate} onChange={e => updateLine(idx, 'rate', Number(e.target.value))}
                style={{ padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)' }} />
              <input type="number" value={li.gst_rate} onChange={e => updateLine(idx, 'gst_rate', Number(e.target.value))}
                style={{ padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)' }} />
              <span style={{ fontSize: 12, fontWeight: 600, padding: '8px 0' }}>{FMT(li.quantity * li.rate * (1 - (li.discount_pct || 0) / 100))}</span>
              {form.line_items.length > 1 && <button type="button" onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>}
            </div>
          ))}
          <button type="button" onClick={addLine} style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>+ Add line</button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div style={{ fontSize: 13 }}>
              <span>Subtotal: {FMT(computedSubtotal)}</span>
              <span style={{ margin: '0 12px' }}>GST: {FMT(computedGst)}</span>
              <strong>Total: {FMT(computedTotal)}</strong>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12 }}>Discount ₹
                <input type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))}
                  style={{ width: 80, padding: '6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)', marginLeft: 4 }} />
              </label>
            </div>
          </div>

          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 12, minHeight: 48 }} />

          <div style={{ marginTop: 12 }}>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>
              {saving ? 'Saving…' : 'Create Order'}
            </button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p> : orders.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No orders yet. Create your first sales order.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orders.map(o => (
            <div key={o.id} onClick={() => loadDetail(o.id)}
              style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{o.order_number}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{o.contact_name || o.contact_company || ''}</span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{o.order_date}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{FMT(o.total)}</span>
                <Badge text={o.status} color={STATUS_COLORS[o.status] || '#6E7B91'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function PipelineTab() {
  const { pushToast } = useToast();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const STAGE_COLORS = { Lead: '#6E7B91', Qualified: '#0082c6', Proposal: '#8b5cf6', Negotiation: '#f59e0b', Won: '#10b981', Lost: '#ef4444' };

  useEffect(() => {
    api.get('/v1/graha/pipeline-summary').then(r => { setDeals(r.data.stages || []); setLoading(false); })
      .catch(() => { pushToast({ title: 'Failed to load pipeline', type: 'error' }); setLoading(false); });
  }, []);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading pipeline…</p>;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {deals.map(s => (
          <div key={s.stage} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
            <Badge text={s.stage} color={STAGE_COLORS[s.stage] || '#6E7B91'} />
            <p style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 2px' }}>{s.count}</p>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>{FMT(s.total_value)}</p>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Full pipeline management is in Graha (CRM) module.</p>
    </div>
  );
}


function TargetsTab() {
  const { pushToast } = useToast();
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ salesperson_id: '', period_start: '', period_end: '', target_amount: 0, target_deals: 0, notes: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    try { const r = await api.get('/v1/vikray/targets'); setTargets(r.data.data || []); } catch {}
    finally { setLoading(false); }
  }

  async function loadMembers() {
    try { const r = await api.get('/teams'); const all = r.data || []; setMembers(all); } catch {}
  }

  async function save(e) {
    e.preventDefault();
    if (!form.salesperson_id || !form.period_start || !form.period_end) { pushToast({ title: 'Fill required fields', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/vikray/targets', form);
      pushToast({ title: 'Target saved', type: 'success' });
      setShowForm(false);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => { setShowForm(!showForm); if (!showForm) loadMembers(); }}>
          {showForm ? 'Cancel' : '+ Set Target'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Salesperson
              <input value={form.salesperson_id} onChange={e => setForm(f => ({ ...f, salesperson_id: e.target.value }))}
                placeholder="User ID" style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Period Start
              <input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Period End
              <input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Target Amount (₹)
              <input type="number" value={form.target_amount} onChange={e => setForm(f => ({ ...f, target_amount: Number(e.target.value) }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Target Deals
              <input type="number" value={form.target_deals} onChange={e => setForm(f => ({ ...f, target_deals: Number(e.target.value) }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
          </div>
          <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Save Target'}</button>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p> : targets.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No targets set yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--rule-soft)' }}>
              {['Salesperson', 'Period', 'Target', 'Actual', 'Achievement'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targets.map(t => {
              const pct = t.target_amount > 0 ? Math.round((t.actual_amount || 0) / t.target_amount * 100) : 0;
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px' }}>{t.salesperson_name || t.salesperson_id}</td>
                  <td style={{ padding: '10px', fontSize: 12 }}>{t.period_start} — {t.period_end}</td>
                  <td style={{ padding: '10px' }}>{FMT(t.target_amount)}</td>
                  <td style={{ padding: '10px' }}>{FMT(t.actual_amount)}</td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 6, background: 'var(--rule-soft)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 100 ? '#10b981' : '#0082c6', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: pct >= 100 ? '#10b981' : 'var(--ink-2)' }}>{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}


function CustomersTab() {
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/v1/graha/contacts?type=customer').then(r => { setContacts(r.data.data || []); setLoading(false); })
      .catch(() => { pushToast({ title: 'Failed to load customers', type: 'error' }); setLoading(false); });
  }, []);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p>;
  if (contacts.length === 0) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No customers yet. Convert leads in the CRM module.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {contacts.map(c => (
        <div key={c.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ fontSize: 14 }}>{c.name}</strong>
            {c.company && <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{c.company}</span>}
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{c.email} {c.phone && `· ${c.phone}`}</p>
          </div>
          <Badge text={c.type || 'customer'} color="#10b981" />
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Full contact management is in Graha (CRM) module.</p>
    </div>
  );
}
