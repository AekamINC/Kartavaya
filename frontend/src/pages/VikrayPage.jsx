import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, TabBar, Section, Badge, Shimmer, Empty, BackButton, ModCard, DataTable, Td } from '../components/editorial';

const STATUS_COLORS = { draft: '#6E7B91', confirmed: '#0082c6', dispatched: '#8b5cf6', delivered: '#10b981', closed: '#05b7aa', cancelled: '#9ca3af' };
const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const TABS = ['dashboard', 'orders', 'stock', 'pipeline', 'targets', 'customers'];

export default function VikrayPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Vikray" sanskrit="विक्रय" lede="Sales — Orders, Targets & Pipeline" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'customers' && <CustomersTab />}
    </div>
  );
}


function DashboardTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/v1/vikray/dashboard').then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <Shimmer count={8} />;
  return (
    <>
      <Section title="Revenue" hi="राजस्व">
        <div className="k-stats">
          <StatTile label="Pipeline Value" value={FMT(data.pipeline_value)} variant="blue" />
          <StatTile label="Revenue" value={FMT(data.total_revenue)} variant="teal" />
          <StatTile label="Order Value" value={FMT(data.order_value)} />
          <StatTile label="Collected" value={FMT(data.collected)} variant="teal" />
        </div>
      </Section>
      <Section title="Orders" hi="आदेश">
        <div className="k-stats">
          <StatTile label="Total Orders" value={data.total_orders} />
          <StatTile label="Open Deals" value={data.open_deals} />
          <StatTile label="Draft" value={data.draft_orders} />
          <StatTile label="Dispatched" value={data.dispatched_orders} />
        </div>
      </Section>
    </>
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
        <BackButton onClick={() => setDetail(null)} label="Back to list" />
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">{o.order_number}</h3>
              <p className="k-detail__sub">
                {o.order_date} {o.expected_delivery && `· Delivery: ${o.expected_delivery}`}
              </p>
            </div>
            <Badge text={o.status} color={STATUS_COLORS[o.status]} />
          </div>

          <div className="k-detail__actions">
            {NEXT_STATUS[o.status] && <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => updateStatus(NEXT_STATUS[o.status])}>{NEXT_LABEL[o.status]}</button>}
            {o.status !== 'draft' && !o.invoice_id && <button className="k-btn k-btn--primary" style={{ fontSize: 12, background: '#10b981' }} onClick={generateInvoice}>Generate Invoice</button>}
            {(o.status === 'draft' || o.status === 'confirmed') && <button className="k-btn k-btn--ghost" style={{ fontSize: 12, color: '#ef4444' }} onClick={cancelOrder}>Cancel</button>}
            {o.invoice_id && <Badge text="Invoiced" color="#10b981" />}
          </div>

          {o.contact_name && (
            <div className="k-metabar">
              <span><strong>Customer:</strong> {o.contact_name} {o.contact_company && `(${o.contact_company})`}</span>
            </div>
          )}

          <DataTable columns={['Description', 'HSN', { label: 'Qty', align: 'right' }, { label: 'Rate', align: 'right' }, { label: 'GST%', align: 'right' }, { label: 'Amount', align: 'right' }]}>
            {items.map((li, i) => {
              const amt = li.quantity * li.rate * (1 - (li.discount_pct || 0) / 100);
              return (
                <tr key={i}>
                  <td>{li.description}</td>
                  <Td align="right" mono>{li.hsn_code || '—'}</Td>
                  <Td align="right">{li.quantity} {li.unit}</Td>
                  <Td align="right" mono>{FMT(li.rate)}</Td>
                  <Td align="right">{li.gst_rate}%</Td>
                  <Td align="right" bold>{FMT(amt)}</Td>
                </tr>
              );
            })}
          </DataTable>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <div className="k-totals">
              <div className="k-totals__row"><span>Subtotal</span><span>{FMT(o.subtotal)}</span></div>
              {!o.is_igst ? (<>
                <div className="k-totals__row" style={{ color: 'var(--ink-3)' }}><span>CGST</span><span>{FMT(o.cgst)}</span></div>
                <div className="k-totals__row" style={{ color: 'var(--ink-3)' }}><span>SGST</span><span>{FMT(o.sgst)}</span></div>
              </>) : (
                <div className="k-totals__row" style={{ color: 'var(--ink-3)' }}><span>IGST</span><span>{FMT(o.igst)}</span></div>
              )}
              {Number(o.discount) > 0 && <div className="k-totals__row" style={{ color: '#ef4444' }}><span>Discount</span><span>-{FMT(o.discount)}</span></div>}
              <div className="k-totals__row k-totals__row--total"><span>Total</span><span>{FMT(o.total)}</span></div>
            </div>
          </div>

          {o.notes && <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 16 }}>Notes: {o.notes}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="k-formpanel__input" style={{ width: 'auto', minWidth: 140 }}>
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
        <form onSubmit={save} className="k-formpanel">
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Customer
              <select value={form.contact_id} onChange={e => setForm(f => ({ ...f, contact_id: e.target.value }))} className="k-formpanel__input">
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">Order Date
              <input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Expected Delivery
              <input type="date" value={form.expected_delivery} onChange={e => setForm(f => ({ ...f, expected_delivery: e.target.value }))} className="k-formpanel__input" />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
              <input type="checkbox" checked={form.is_igst} onChange={e => setForm(f => ({ ...f, is_igst: e.target.checked }))} /> Inter-state (IGST)
            </label>
          </div>

          <Section title="Line Items" hi="वस्तुएँ">
            {form.line_items.map((li, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr .8fr .8fr 1fr .8fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                <div>
                  <select onChange={e => fillFromProduct(idx, e.target.value)} className="k-formpanel__input" style={{ marginBottom: 4, padding: '6px 10px' }}>
                    <option value="">From product…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input placeholder="Description" value={li.description} onChange={e => updateLine(idx, 'description', e.target.value)} className="k-formpanel__input" style={{ padding: '6px 10px' }} />
                </div>
                <input placeholder="HSN" value={li.hsn_code} onChange={e => updateLine(idx, 'hsn_code', e.target.value)} className="k-formpanel__input" style={{ padding: '6px 10px' }} />
                <input type="number" min="1" value={li.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} className="k-formpanel__input" style={{ padding: '6px 10px' }} />
                <input type="number" value={li.rate} onChange={e => updateLine(idx, 'rate', Number(e.target.value))} className="k-formpanel__input" style={{ padding: '6px 10px' }} />
                <input type="number" value={li.gst_rate} onChange={e => updateLine(idx, 'gst_rate', Number(e.target.value))} className="k-formpanel__input" style={{ padding: '6px 10px' }} />
                <span style={{ fontSize: 12, fontWeight: 600, padding: '8px 0', fontFamily: 'var(--font-mono)' }}>{FMT(li.quantity * li.rate * (1 - (li.discount_pct || 0) / 100))}</span>
                {form.line_items.length > 1 && <button type="button" onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>}
              </div>
            ))}
            <button type="button" onClick={addLine} style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, marginBottom: 12 }}>+ Add line item</button>
          </Section>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--rule-soft)' }}>
            <div style={{ fontSize: 13, display: 'flex', gap: 16 }}>
              <span>Subtotal: <strong>{FMT(computedSubtotal)}</strong></span>
              <span>GST: <strong>{FMT(computedGst)}</strong></span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Total: {FMT(computedTotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="k-formpanel__label" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Discount ₹
                <input type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) }))} className="k-formpanel__input" style={{ width: 80, padding: '6px 10px' }} />
              </label>
            </div>
          </div>

          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="k-formpanel__input" style={{ minHeight: 48, marginTop: 8 }} />

          <div className="k-formpanel__actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>
              {saving ? 'Saving…' : 'Create Order'}
            </button>
          </div>
        </form>
      )}

      {loading ? <Shimmer count={4} /> : orders.length === 0 ? (
        <Empty icon="📦" title="No orders yet" sub="Create your first sales order to start tracking revenue and deliveries." cta="+ New Order" onCta={() => { setShowForm(true); loadOptions(); }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {orders.map(o => (
            <ModCard key={o.id} onClick={() => loadDetail(o.id)}>
              <div>
                <strong style={{ fontSize: 14 }}>{o.order_number}</strong>
                {(o.contact_name || o.contact_company) && <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{o.contact_name || o.contact_company}</span>}
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{o.order_date}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{FMT(o.total)}</span>
                <Badge text={o.status} color={STATUS_COLORS[o.status]} />
              </div>
            </ModCard>
          ))}
        </div>
      )}
    </div>
  );
}


function StockTab() {
  const { pushToast } = useToast();
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [edits, setEdits] = useState({});

  useEffect(() => { load(); }, [lowStockOnly]);

  async function load() {
    try {
      const r = await api.get(`/v1/vikray/stock${lowStockOnly ? '?low_stock=true' : ''}`);
      setStock(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load stock', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function adjust(productId, quantity_delta, reason) {
    try {
      await api.patch(`/v1/vikray/stock/${productId}`, { quantity_delta, reason });
      pushToast({ title: 'Stock updated', type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function setThreshold(productId) {
    const val = edits[productId];
    if (val === undefined || val === '') return;
    try {
      await api.patch(`/v1/vikray/stock/${productId}`, { low_stock_threshold: Number(val) });
      pushToast({ title: 'Threshold updated', type: 'success' });
      setEdits(e => ({ ...e, [productId]: undefined }));
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  if (loading) return <Shimmer count={6} />;

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Stock Ledger<span className="k-section__title-hi">स्टॉक</span></h3>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={lowStockOnly} onChange={e => setLowStockOnly(e.target.checked)} /> Low stock only
        </label>
      </div>

      {stock.length === 0 ? (
        <Empty icon="📦" title="No stock records" sub="Stock levels appear here once products are confirmed on orders or a threshold is set." />
      ) : (
        <DataTable columns={['Product', { label: 'On Hand', align: 'right' }, { label: 'Threshold', align: 'right' }, { label: 'Actions', align: 'right' }]}>
          {stock.map(s => {
            const low = Number(s.quantity_on_hand) <= Number(s.low_stock_threshold) && Number(s.low_stock_threshold) > 0;
            return (
              <tr key={s.product_id}>
                <td>{s.name} {low && <Badge text="Low Stock" color="#ef4444" />}</td>
                <Td align="right" mono bold>{s.quantity_on_hand} {s.unit}</Td>
                <Td align="right">
                  <input type="number" placeholder={s.low_stock_threshold} value={edits[s.product_id] ?? ''}
                    onChange={e => setEdits(ed => ({ ...ed, [s.product_id]: e.target.value }))}
                    onBlur={() => setThreshold(s.product_id)}
                    className="k-formpanel__input" style={{ width: 80, display: 'inline-block' }} />
                </Td>
                <Td align="right">
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, marginRight: 6 }} onClick={() => adjust(s.product_id, 1, 'restock')}>+1</button>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => adjust(s.product_id, -1, 'manual_adjustment')}>-1</button>
                </Td>
              </tr>
            );
          })}
        </DataTable>
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

  if (loading) return <Shimmer count={6} />;
  if (deals.length === 0) return <Empty icon="📊" title="No pipeline data" sub="Add deals in the Graha (CRM) module to see your sales pipeline here." />;

  return (
    <Section title="Pipeline Stages" hi="चरण">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {deals.map(s => (
          <div key={s.stage} className="k-stat">
            <div style={{ marginBottom: 8 }}><Badge text={s.stage} color={STAGE_COLORS[s.stage]} /></div>
            <div className="k-stat__val" style={{ fontSize: 28 }}>{s.count}</div>
            <div className="k-stat__sub">{FMT(s.total_value)}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Full pipeline management is in Graha (CRM) module.</p>
    </Section>
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
    try { const r = await api.get('/teams'); setMembers(r.data || []); } catch {}
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
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Sales Targets<span className="k-section__title-hi">लक्ष्य</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => { setShowForm(!showForm); if (!showForm) loadMembers(); }}>
          {showForm ? 'Cancel' : '+ Set Target'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Salesperson
              <input value={form.salesperson_id} onChange={e => setForm(f => ({ ...f, salesperson_id: e.target.value }))}
                placeholder="User ID" className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Period Start
              <input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Period End
              <input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} className="k-formpanel__input" />
            </label>
          </div>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Target Amount (₹)
              <input type="number" value={form.target_amount} onChange={e => setForm(f => ({ ...f, target_amount: Number(e.target.value) }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Target Deals
              <input type="number" value={form.target_deals} onChange={e => setForm(f => ({ ...f, target_deals: Number(e.target.value) }))} className="k-formpanel__input" />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Save Target'}</button>
          </div>
        </form>
      )}

      {loading ? <Shimmer count={4} /> : targets.length === 0 ? (
        <Empty icon="🎯" title="No targets set" sub="Set sales targets for your team to track performance and achievement." cta="+ Set Target" onCta={() => { setShowForm(true); loadMembers(); }} />
      ) : (
        <DataTable columns={['Salesperson', 'Period', { label: 'Target', align: 'right' }, { label: 'Actual', align: 'right' }, 'Achievement']}>
          {targets.map(t => {
            const pct = t.target_amount > 0 ? Math.round((t.actual_amount || 0) / t.target_amount * 100) : 0;
            return (
              <tr key={t.id}>
                <td>{t.salesperson_name || t.salesperson_id}</td>
                <td style={{ fontSize: 12 }}>{t.period_start} — {t.period_end}</td>
                <Td align="right" mono>{FMT(t.target_amount)}</Td>
                <Td align="right" mono>{FMT(t.actual_amount)}</Td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 80, height: 6, background: 'var(--rule-soft)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 100 ? '#10b981' : 'var(--k-primary)', borderRadius: 3, transition: 'width .4s' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: pct >= 100 ? '#10b981' : 'var(--ink-2)' }}>{pct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}


function CustomersTab() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/v1/graha/contacts?type=customer').then(r => { setContacts(r.data.data || []); setLoading(false); })
      .catch(() => { pushToast({ title: 'Failed to load customers', type: 'error' }); setLoading(false); });
  }, []);

  if (loading) return <Shimmer count={4} />;
  if (contacts.length === 0) return <Empty icon="👥" title="No customers yet" sub="Convert leads in the CRM module to see your customers here." />;

  return (
    <Section title="Customer List" hi="ग्राहक">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {contacts.map(c => (
          <ModCard key={c.id} onClick={() => navigate('/graha')} style={{ cursor: 'pointer' }}>
            <div>
              <strong style={{ fontSize: 14 }}>{c.name}</strong>
              {c.company && <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{c.company}</span>}
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{c.email} {c.phone && `· ${c.phone}`}</p>
            </div>
            <Badge text={c.type || 'customer'} color="#10b981" />
          </ModCard>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }}>Click any customer to view their full profile in Graha (CRM).</p>
    </Section>
  );
}


