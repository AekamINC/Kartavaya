import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, Card } from '../components/editorial';
import { relTime, formatINR } from '../lib/utils';

const CONTACT_TYPES = ['lead', 'customer', 'vendor', 'partner'];
const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'];
const TYPE_COLORS = { lead: '#f59e0b', customer: '#10b981', vendor: '#6366f1', partner: '#0082c6' };
const STAGE_COLORS = { New: '#6E7B91', Qualified: '#f59e0b', Proposal: '#0082c6', Negotiation: '#8b5cf6', Won: '#10b981', Lost: '#ef4444' };

function dealStaleness(updatedAt) {
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  if (days >= 14) return { days, level: 'critical', color: '#dc2626', bg: '#dc262612', label: `${days}d stale` };
  if (days >= 7) return { days, level: 'warning', color: '#d97706', bg: '#d9770612', label: `${days}d idle` };
  if (days >= 3) return { days, level: 'mild', color: '#6E7B91', bg: '#6E7B9112', label: `${days}d ago` };
  return null;
}

function RotBadge({ updatedAt }) {
  const rot = dealStaleness(updatedAt);
  if (!rot) return null;
  return (
    <span title={`No activity for ${rot.days} days`} style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: rot.bg, color: rot.color, whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: 3,
    }}>
      {rot.level === 'critical' ? '🔥' : rot.level === 'warning' ? '⏳' : '·'} {rot.label}
    </span>
  );
}

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

const TABS = ['today', 'clients', 'contacts', 'deals', 'kanban', 'pipeline', 'follow-ups', 'labels', 'activities', 'reports', 'automations', 'territories', 'fields', 'web-forms', 'approvals', 'documents'];
const SOURCE_COLORS = { indiamart: '#2563eb', justdial: '#ea580c', manual: '#6b7280', website: '#10b981' };
const ACT_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
const TL_ICONS = { activity: '●', followup: '⏰', invoice: '📄', deal: '💼' };
const TL_SUB_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
const TL_COLORS = { activity: '#0082c6', followup: '#d97706', invoice: '#10b981', deal: '#8b5cf6', _default: '#6E7B91' };

export default function GrahaPage() {
  const [tab, setTab] = useState('today');

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Graha · ग्राह" subtitle="CRM — Contacts, Deals & Pipeline" />

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

      {tab === 'today' && <TodayTab />}
      {tab === 'clients' && <ClientsTab />}
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'deals' && <DealsTab />}
      {tab === 'kanban' && <KanbanTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'follow-ups' && <FollowUpsTab />}
      {tab === 'labels' && <LabelsTab />}
      {tab === 'activities' && <ActivitiesTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'automations' && <AutomationsTab />}
      {tab === 'territories' && <TerritoriesTab />}
      {tab === 'fields' && <CustomFieldsTab />}
      {tab === 'web-forms' && <WebFormsTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'documents' && <DocumentsTab />}
    </div>
  );
}


// ── Today Tab ──────────────────────────────────────────────

function TodayTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/v1/graha/today')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;
  if (!data) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Could not load today view.</p>;

  const sections = [
    { key: 'overdue_followups', title: 'Overdue Follow-ups', color: '#ef4444', icon: '⏰', emptyMsg: 'No overdue follow-ups' },
    { key: 'stale_deals', title: 'Deals Going Cold', color: '#f59e0b', icon: '🧊', emptyMsg: 'All deals are active' },
    { key: 'new_leads', title: 'New Leads (24h)', color: '#10b981', icon: '🌱', emptyMsg: 'No new leads today' },
    { key: 'todays_activities', title: "Today's Activities", color: '#6366f1', icon: '📋', emptyMsg: 'No activities today' },
    { key: 'recent_closures', title: 'Recent Won/Lost (7d)', color: '#0082c6', icon: '🏁', emptyMsg: 'No recent closures' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
      {sections.map(s => {
        const items = data[s.key] || [];
        return (
          <div key={s.key} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              borderBottom: '1px solid var(--rule-soft)', background: 'var(--bg-raised)' }}>
              <span>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{s.title}</span>
              {items.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                  background: `${s.color}18`, color: s.color }}>{items.length}</span>
              )}
            </div>
            <div style={{ padding: '8px 14px', maxHeight: 280, overflowY: 'auto' }}>
              {items.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>{s.emptyMsg}</p>
              ) : items.map((item, i) => (
                <TodayItem key={item.id || i} item={item} section={s.key} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TodayItem({ item, section }) {
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  const daysAgo = d => { if (!d) return ''; const ms = Date.now() - new Date(d).getTime(); return Math.floor(ms / 86400000) + 'd ago'; };

  if (section === 'overdue_followups') {
    const overdueDays = Math.floor((Date.now() - new Date(item.due_at).getTime()) / 86400000);
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, minWidth: 36 }}>{overdueDays}d</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          {item.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name}</div>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{fmtDate(item.due_at)}</span>
      </div>
    );
  }

  if (section === 'stale_deals') {
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name} · {daysAgo(item.updated_at)} since activity</div>
        </div>
        {item.value && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>₹{Number(item.value).toLocaleString('en-IN')}</span>}
      </div>
    );
  }

  if (section === 'new_leads') {
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.company || item.email || item.phone}</div>
        </div>
        {item.source && <Badge text={item.source} color={SOURCE_COLORS[item.source] || '#6b7280'} />}
      </div>
    );
  }

  if (section === 'todays_activities') {
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{ACT_ICONS[item.activity_type] || '●'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, textDecoration: item.is_completed ? 'line-through' : 'none',
            color: item.is_completed ? 'var(--ink-3)' : 'var(--ink)' }}>{item.title}</div>
          {item.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name}</div>}
        </div>
      </div>
    );
  }

  if (section === 'recent_closures') {
    const won = item.stage === 'Won';
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge text={item.stage} color={won ? '#10b981' : '#ef4444'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</div>
          {item.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name}</div>}
        </div>
        {item.value && <span style={{ fontSize: 12, fontWeight: 600, color: won ? '#10b981' : '#ef4444', whiteSpace: 'nowrap' }}>₹{Number(item.value).toLocaleString('en-IN')}</span>}
      </div>
    );
  }

  return null;
}


// ── Contact Timeline ──────────────────────────────────────

function ContactTimeline({ contactId }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback((cur) => {
    const params = cur ? `?cursor=${encodeURIComponent(cur)}&limit=30` : '?limit=30';
    api.get(`/v1/graha/contacts/${contactId}/timeline${params}`)
      .then(r => {
        setItems(prev => cur ? [...prev, ...r.data.data] : r.data.data);
        setCursor(r.data.next_cursor);
        setHasMore(!!r.data.next_cursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contactId]);

  useEffect(() => { load(null); }, [load]);

  if (loading && items.length === 0) return <p style={{ fontSize: 12, color: 'var(--ink-3)', padding: 8 }}>Loading timeline...</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>Timeline</h4>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No activity yet.</p>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 24 }}>
          <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: 'var(--rule-soft)', borderRadius: 1 }} />
          {items.map((it, i) => {
            const icon = (it.type === 'activity' && it.subtype) ? (TL_SUB_ICONS[it.subtype] || TL_ICONS.activity) : TL_ICONS[it.type];
            const color = TL_COLORS[it.type] || TL_COLORS._default;
            return (
            <div key={`${it.type}-${it.id}-${i}`} style={{ position: 'relative', paddingBottom: 14, paddingLeft: 12 }}>
              <span style={{ position: 'absolute', left: -24, top: 1, width: 18, height: 18, borderRadius: 99,
                background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{icon}</span>
              <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>{it.title}</span>
                {it.amount != null && <span style={{ color: '#10b981', fontWeight: 600, fontSize: 12 }}>₹{Number(it.amount).toLocaleString('en-IN')}</span>}
                {it.stage && <Badge text={it.stage} color={STAGE_COLORS[it.stage] || '#6b7280'} />}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                <span style={{ color, fontWeight: 600, textTransform: 'capitalize' }}>{it.subtype || it.type}</span>
                {' · '}{it.ts ? new Date(it.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
            );
          })}
          {hasMore && (
            <button onClick={() => load(cursor)}
              style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
              Load more...
            </button>
          )}
        </div>
      )}
    </div>
  );
}


// ── Clients Tab ───────────────────────────────────────────

function ClientsTab() {
  const { pushToast } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} });
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get(`/v1/graha/clients${params}`)
      .then(r => setClients(r.data.data || []))
      .catch(() => pushToast({ title: 'Failed to load clients', type: 'error' }))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.name.trim()) return pushToast({ title: 'Company name is required', type: 'error' });
    try {
      if (editId) {
        await api.patch(`/v1/graha/clients/${editId}`, form);
        pushToast({ title: 'Client updated', type: 'success' });
      } else {
        await api.post('/v1/graha/clients', form);
        pushToast({ title: 'Client created', type: 'success' });
      }
      setShowForm(false); setEditId(null);
      setForm({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} });
      load();
    } catch { pushToast({ title: 'Could not save client', type: 'error' }); }
  }

  function openEdit(c) {
    setEditId(c.id);
    setForm({ name: c.name, ref_no: c.ref_no || '', gstin: c.gstin || '', website: c.website || '', notes: c.notes || '', address: c.address || {} });
    setDetail(null);
    setShowForm(true);
  }

  async function openDetail(id) {
    try {
      const r = await api.get(`/v1/graha/clients/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load client', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/clients/${id}`);
      pushToast({ title: 'Client deleted', type: 'success' });
      setDetail(null);
      load();
    } catch { pushToast({ title: 'Could not delete client', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  if (detail) {
    return (
      <div>
        <button onClick={() => setDetail(null)} style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back to clients</button>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{detail.name}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openEdit(detail)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>Edit</button>
                <button onClick={() => remove(detail.id)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, background: '#ef444418', color: '#ef4444', border: 'none', cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
            {detail.ref_no && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Ref: {detail.ref_no}</div>}
            {detail.gstin && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>GSTIN: {detail.gstin}</div>}
            {detail.website && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Web: {detail.website}</div>}
            {detail.address?.line1 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Address: {[detail.address.line1, detail.address.line2, detail.address.city, detail.address.state, detail.address.pincode].filter(Boolean).join(', ')}</div>}
            {detail.notes && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>{detail.notes}</div>}
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Contacts ({detail.contacts?.length || 0})</h4>
            {(detail.contacts || []).map(c => (
              <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                {c.designation && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}> · {c.designation}</span>}
                {c.email && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.email}</div>}
              </div>
            ))}
            {(!detail.contacts || detail.contacts.length === 0) && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No contacts linked</p>}

            <h4 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Deals ({detail.deals?.length || 0})</h4>
            {(detail.deals || []).map(d => (
              <div key={d.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>{d.title}</span>
                <span style={{ fontWeight: 600 }}>₹{Number(d.value || 0).toLocaleString('en-IN')}</span>
              </div>
            ))}
            {(!detail.deals || detail.deals.length === 0) && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No deals linked</p>}
          </div>
        </div>
      </div>
    );
  }

  const inputStyle = { width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--rule-soft)', borderRadius: 6, background: 'var(--bg)', color: 'var(--ink-1)' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..."
          style={{ ...inputStyle, maxWidth: 260 }} />
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} }); }}
          style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + Add Client
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16, padding: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>{editId ? 'Edit' : 'New'} Client</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company Name *" style={inputStyle} />
            <input value={form.ref_no} onChange={e => setForm(f => ({ ...f, ref_no: e.target.value }))} placeholder="Ref No" style={inputStyle} />
            <input value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="GST No" style={inputStyle} />
            <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="Website" style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
            <input value={form.address?.line1 || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, line1: e.target.value } }))} placeholder="Address Line 1" style={inputStyle} />
            <input value={form.address?.line2 || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, line2: e.target.value } }))} placeholder="Address Line 2" style={inputStyle} />
            <input value={form.address?.city || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, city: e.target.value } }))} placeholder="City" style={inputStyle} />
            <input value={form.address?.state || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, state: e.target.value } }))} placeholder="State" style={inputStyle} />
            <input value={form.address?.pincode || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, pincode: e.target.value } }))} placeholder="Pincode" style={inputStyle} />
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" rows={2}
            style={{ ...inputStyle, marginTop: 10, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} style={{ padding: '6px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              {editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} style={{ padding: '6px 16px', fontSize: 13, borderRadius: 6, background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>Cancel</button>
          </div>
        </Card>
      )}

      <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-raised)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Company</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Ref No</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>GSTIN</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Website</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Contacts</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Deals</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} onClick={() => openDetail(c.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>{c.ref_no || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>{c.gstin || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>{c.website || '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>{c.contact_count}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>{c.deal_count}</td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No clients yet. Add your first company.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Contacts Tab ──────────────────────────────────────────

function ContactsTab() {
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', contact_type: 'lead', gstin: '', source: '', client_id: '' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [clientOptions, setClientOptions] = useState([]);
  const [editContact, setEditContact] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    api.get('/v1/graha/clients').then(r => setClientOptions(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/contacts?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (typeFilter) url += `contact_type=${typeFilter}&`;
      const r = await api.get(url);
      setContacts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load contacts', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/contacts', form);
      pushToast({ title: 'Contact created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', email: '', phone: '', company: '', designation: '', contact_type: 'lead', gstin: '', source: '', client_id: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function startEditContact(c) {
    setEditContact({
      id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', mobile: c.mobile || '',
      company: c.company || '', designation: c.designation || '', contact_type: c.contact_type || 'lead',
      notes: c.notes || '', source: c.source || '', lead_score: c.lead_score ?? '', website: c.website || '',
      gstin: c.gstin || '', pan: c.pan || '',
    });
  }

  async function saveEditContact() {
    if (!editContact) return;
    setEditSaving(true);
    try {
      const { id, ...fields } = editContact;
      await api.patch(`/v1/graha/contacts/${id}`, fields);
      pushToast({ title: 'Contact updated', type: 'success' });
      setEditContact(null);
      loadDetail(id);
      load();
    } catch { pushToast({ title: 'Could not update contact', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/graha/contacts/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load contact', type: 'error' }); }
  }

  async function deleteContact(id) {
    try {
      await api.delete(`/v1/graha/contacts/${id}`);
      setContacts(prev => prev.filter(c => c.id !== id));
      if (detail?.contact?.id === id) setDetail(null);
      pushToast({ title: 'Contact deleted', type: 'success' });
    } catch { pushToast({ title: 'Could not delete contact', type: 'error' }); }
  }

  async function convertLead(id) {
    try {
      await api.post(`/v1/graha/contacts/${id}/convert`);
      pushToast({ title: 'Lead converted to customer', type: 'success' });
      loadDetail(id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Conversion failed', type: 'error' }); }
  }

  async function removeLabel(contactId, labelId) {
    try {
      await api.delete(`/v1/graha/contacts/${contactId}/labels/${labelId}`);
      pushToast({ title: 'Label removed', type: 'success' });
      loadDetail(contactId);
    } catch { pushToast({ title: 'Failed to remove label', type: 'error' }); }
  }

  if (detail) {
    const c = detail.contact;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => { setDetail(null); setEditContact(null); }}>← Back to list</button>

        {editContact ? (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Edit Contact</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
                <input className="k-input" value={editContact.name} onChange={e => setEditContact({ ...editContact, name: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
                <select className="k-input" value={editContact.contact_type} onChange={e => setEditContact({ ...editContact, contact_type: e.target.value })}>
                  {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
                <input className="k-input" type="email" value={editContact.email} onChange={e => setEditContact({ ...editContact, email: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
                <input className="k-input" type="tel" value={editContact.phone} onChange={e => setEditContact({ ...editContact, phone: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Mobile</span>
                <input className="k-input" type="tel" value={editContact.mobile} onChange={e => setEditContact({ ...editContact, mobile: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Company</span>
                <input className="k-input" value={editContact.company} onChange={e => setEditContact({ ...editContact, company: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
                <input className="k-input" value={editContact.designation} onChange={e => setEditContact({ ...editContact, designation: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source</span>
                <input className="k-input" value={editContact.source} onChange={e => setEditContact({ ...editContact, source: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Lead Score</span>
                <input className="k-input" type="number" min="0" max="100" value={editContact.lead_score} onChange={e => setEditContact({ ...editContact, lead_score: parseInt(e.target.value) || 0 })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Website</span>
                <input className="k-input" value={editContact.website} onChange={e => setEditContact({ ...editContact, website: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GSTIN</span>
                <input className="k-input" value={editContact.gstin} onChange={e => setEditContact({ ...editContact, gstin: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>PAN</span>
                <input className="k-input" value={editContact.pan} onChange={e => setEditContact({ ...editContact, pan: e.target.value })} /></label>
            </div>
            <label style={{ fontSize: 13, display: 'block', marginTop: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
              <textarea className="k-input" rows={3} style={{ resize: 'vertical' }} value={editContact.notes} onChange={e => setEditContact({ ...editContact, notes: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditContact(null)}>Cancel</button>
              <button type="button" className="k-btn k-btn--primary" disabled={editSaving} onClick={saveEditContact}>{editSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        ) : (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.name}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{c.company} {c.designation && `· ${c.designation}`}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => startEditContact(c)}>Edit</button>
              {c.contact_type === 'lead' && (
                <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => convertLead(c.id)}>Convert to Customer</button>
              )}
              <Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || '#6E7B91'} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Email:</strong> {c.email || '—'}</div>
            <div><strong>Phone:</strong> {c.phone || '—'}</div>
            <div><strong>GSTIN:</strong> {c.gstin || '—'}</div>
            <div><strong>PAN:</strong> {c.pan || '—'}</div>
            <div><strong>Source:</strong> {c.source || '—'}</div>
            <div><strong>Lead Score:</strong> {c.lead_score ?? '—'}/100</div>
            <div><strong>Assigned To:</strong> {c.assigned_to ? c.assigned_to.substring(0, 8) + '...' : '—'}</div>
            <div><strong>Last Contacted:</strong> {c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('en-IN') : '—'}</div>
            <div><strong>Converted:</strong> {c.converted_at ? new Date(c.converted_at).toLocaleDateString('en-IN') : '—'}</div>
          </div>
          {c.lead_score_reasons?.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
              <strong>Score reasons:</strong> {(typeof c.lead_score_reasons === 'string' ? JSON.parse(c.lead_score_reasons) : c.lead_score_reasons).join(', ')}
            </div>
          )}
          {c.notes && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{c.notes}</p>}
        </div>
        )}

        {detail.labels?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Labels</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {detail.labels.map(l => (
                <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 12px',
                  borderRadius: 99, background: `${l.color || '#6366f1'}18`, color: l.color || '#6366f1', fontWeight: 600 }}>
                  {l.name}
                  <button onClick={() => removeLabel(c.id, l.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {detail.deals?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Deals ({detail.deals.length})</h4>
            {detail.deals.map(d => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span>{d.title}</span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>₹{Number(d.value).toLocaleString('en-IN')}</span>
                  <Badge text={d.stage} color={STAGE_COLORS[d.stage] || '#6E7B91'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.follow_ups?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Follow-ups ({detail.follow_ups.length})</h4>
            {detail.follow_ups.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, textDecoration: f.is_completed ? 'line-through' : 'none' }}>{f.title}</span>
                  {f.description && <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{f.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(f.due_at).toLocaleDateString('en-IN')}</span>
                  <Badge text={f.is_completed ? 'Done' : 'Pending'} color={f.is_completed ? '#10b981' : '#f59e0b'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.activities?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Activities</h4>
            {detail.activities.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, alignItems: 'center' }}>
                <Badge text={a.activity_type} color="#6E7B91" />
                <span>{a.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{new Date(a.created_at).toLocaleDateString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <ContactTimeline contactId={c.id} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" style={{ flex: 1 }} placeholder="Search contacts…" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <select className="k-input" style={{ width: 130 }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); }}>
          <option value="">All Types</option>
          {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Contact</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.contact_type} onChange={e => setForm({ ...form, contact_type: e.target.value })}>
                {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
              <input className="k-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone / Mobile</span>
              <input className="k-input" type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Company</span>
              <input className="k-input" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
              <input className="k-input" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GSTIN</span>
              <input className="k-input" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source</span>
              <input className="k-input" placeholder="e.g. Website, Referral" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Client / Company</span>
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Create Contact'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        contacts.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No contacts found.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Name', 'Company', 'Email', 'Phone', 'Type', 'Source', 'Score', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer' }} onClick={() => loadDetail(c.id)}>
                <td style={{ padding: '10px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.company || '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.email || '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.phone || '—'}</td>
                <td style={{ padding: '10px' }}><Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || '#6E7B91'} /></td>
                <td style={{ padding: '10px' }}>{c.source ? <Badge text={c.source} color={SOURCE_COLORS[c.source] || '#6b7280'} /> : '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.lead_score ?? '—'}</td>
                <td style={{ padding: '10px' }}>
                  <button onClick={e => { e.stopPropagation(); deleteContact(c.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function DealsTab() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [stageFilter, setStageFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [dealClients, setDealClients] = useState([]);
  const [form, setForm] = useState({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [editDeal, setEditDeal] = useState(null);
  const [editDealSaving, setEditDealSaving] = useState(false);
  const [noteDeal, setNoteDeal] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/deals?';
      if (stageFilter) url += `stage=${stageFilter}&`;
      const r = await api.get(url);
      setDeals(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load deals', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadFormData() {
    try {
      const [cr, clr] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/clients')]);
      setContacts(cr.data.data || []);
      setDealClients(clr.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/deals', { ...form, value: parseFloat(form.value) || 0 });
      pushToast({ title: 'Deal created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function updateStage(dealId, stage) {
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { stage });
      pushToast({ title: `Deal moved to ${stage}`, type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not update deal stage', type: 'error' }); }
  }

  async function createInvoice(dealId) {
    try {
      const r = await api.post(`/v1/ganit/invoices/from-deal/${dealId}`);
      if (r.data.status === 'exists') {
        pushToast({ title: 'Invoice already exists for this deal', type: 'info' });
      } else {
        pushToast({ title: `Draft invoice ${r.data.invoice_number} created`, type: 'success' });
      }
      navigate(`/ganit`);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed to create invoice', type: 'error' }); }
  }

  function startEditDeal(d) {
    setEditDeal({
      id: d.id, title: d.title || '', value: d.value || '', stage: d.stage || 'New',
      probability: d.probability ?? 20, expected_close_date: d.expected_close_date || '',
      notes: d.notes || '',
    });
  }

  async function saveEditDeal() {
    if (!editDeal) return;
    setEditDealSaving(true);
    try {
      const { id, ...fields } = editDeal;
      await api.patch(`/v1/graha/deals/${id}`, { ...fields, value: parseFloat(fields.value) || 0 });
      pushToast({ title: 'Deal updated', type: 'success' });
      setEditDeal(null);
      load();
    } catch { pushToast({ title: 'Could not update deal', type: 'error' }); }
    finally { setEditDealSaving(false); }
  }

  async function saveNote(dealId) {
    setNoteSaving(true);
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { notes: noteText });
      pushToast({ title: 'Notes updated', type: 'success' });
      setNoteDeal(null);
      load();
    } catch { pushToast({ title: 'Could not update notes', type: 'error' }); }
    finally { setNoteSaving(false); }
  }

  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 150 }} value={stageFilter} onChange={e => { setStageFilter(e.target.value); }}>
          <option value="">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadFormData(); }}>+ New Deal</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Deal</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Client / Company</span>
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {dealClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value (₹)</span>
              <input className="k-input" type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Stage</span>
              <select className="k-input" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Probability (%)</span>
              <input className="k-input" type="number" min="0" max="100" value={form.probability} onChange={e => setForm({ ...form, probability: parseInt(e.target.value) || 0 })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Expected Close</span>
              <input className="k-input" type="date" value={form.expected_close_date} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Deal'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        deals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💼</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No deals yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Track your sales pipeline here. Click "+ New Deal" above to add your first opportunity.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {deals.map(d => (
            <div key={d.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px' }}>
              {editDeal?.id === d.id ? (
                <div>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Edit Deal</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
                      <input className="k-input" value={editDeal.title} onChange={e => setEditDeal({ ...editDeal, title: e.target.value })} /></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value (₹)</span>
                      <input className="k-input" type="number" value={editDeal.value} onChange={e => setEditDeal({ ...editDeal, value: e.target.value })} /></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Stage</span>
                      <select className="k-input" value={editDeal.stage} onChange={e => setEditDeal({ ...editDeal, stage: e.target.value })}>
                        {stages.map(s => <option key={s} value={s}>{s}</option>)}
                      </select></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Probability (%)</span>
                      <input className="k-input" type="number" min="0" max="100" value={editDeal.probability} onChange={e => setEditDeal({ ...editDeal, probability: parseInt(e.target.value) || 0 })} /></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Expected Close</span>
                      <input className="k-input" type="date" value={editDeal.expected_close_date} onChange={e => setEditDeal({ ...editDeal, expected_close_date: e.target.value })} /></label>
                  </div>
                  <label style={{ fontSize: 13, display: 'block', marginTop: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                    <textarea className="k-input" rows={3} style={{ resize: 'vertical' }} value={editDeal.notes} onChange={e => setEditDeal({ ...editDeal, notes: e.target.value })} /></label>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditDeal(null)}>Cancel</button>
                    <button type="button" className="k-btn k-btn--primary" disabled={editDealSaving} onClick={saveEditDeal}>{editDealSaving ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--rule-soft)' }}
                        onClick={() => startEditDeal(d)}>{d.title}</span>
                      {d.client_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--k-primary)', fontWeight: 600 }}>{d.client_name}</span>}
                      {d.contact_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--ink-3)' }}>{d.contact_name} {d.contact_company && `· ${d.contact_company}`}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>₹{Number(d.value).toLocaleString('en-IN')}</span>
                      <Badge text={d.stage} color={STAGE_COLORS[d.stage] || '#6E7B91'} />
                      {d.stage !== 'Won' && d.stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--ink-3)', alignItems: 'center' }}>
                    <span>Probability: {d.probability}%</span>
                    {d.expected_close_date && <span>Close: {d.expected_close_date}</span>}
                    <div style={{ flex: 1 }} />
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => startEditDeal(d)}>Edit</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => { setNoteDeal(d.id); setNoteText(d.notes || ''); }}>Notes</button>
                    {d.stage === 'Won' && (
                      <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 10px' }}
                        onClick={() => createInvoice(d.id)}>Create Invoice</button>
                    )}
                    {stages.filter(s => s !== d.stage && s !== 'Lost').map(s => (
                      <button key={s} className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => updateStage(d.id, s)}>{s}</button>
                    ))}
                  </div>
                  {/* Inline notes section */}
                  {noteDeal === d.id && (
                    <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px solid var(--rule-soft)' }}>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                        <textarea className="k-input" rows={3} style={{ resize: 'vertical' }} value={noteText} onChange={e => setNoteText(e.target.value)} /></label>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => setNoteDeal(null)}>Cancel</button>
                        <button type="button" className="k-btn k-btn--primary" style={{ fontSize: 12 }} disabled={noteSaving} onClick={() => saveNote(d.id)}>{noteSaving ? 'Saving...' : 'Save Notes'}</button>
                      </div>
                    </div>
                  )}
                  {noteDeal !== d.id && d.notes && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--rule-soft)', paddingTop: 6 }}>
                      {d.notes}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function KanbanTab() {
  const { pushToast } = useToast();
  const [kanban, setKanban] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/deals/kanban');
      setKanban(r.data.columns || {});
      if (r.data.stages?.length) setStageList(r.data.stages);
    } catch { pushToast({ title: 'Failed to load kanban', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function moveStage(dealId, newStage) {
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { stage: newStage });
      pushToast({ title: `Moved to ${newStage}`, type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not move deal', type: 'error' }); }
  }

  const [stageList, setStageList] = useState(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
  const stages = stageList;

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
      {stages.map(stage => {
        const deals = kanban[stage] || [];
        const total = deals.reduce((s, d) => s + Number(d.value || 0), 0);
        return (
          <div key={stage} style={{ minWidth: 220, flex: '1 0 220px', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Badge text={stage} color={STAGE_COLORS[stage] || '#6E7B91'} />
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{deals.length}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>₹{total.toLocaleString('en-IN')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deals.map(d => {
                const rot = (stage !== 'Won' && stage !== 'Lost') ? dealStaleness(d.updated_at) : null;
                return (
                <div key={d.id} style={{
                  background: rot?.level === 'critical' ? 'color-mix(in srgb, #dc2626 4%, var(--bg))' : 'var(--bg)',
                  border: `1px solid ${rot?.level === 'critical' ? '#dc262630' : rot?.level === 'warning' ? '#d9770625' : 'var(--rule-soft)'}`,
                  borderRadius: 10, padding: 10,
                  boxShadow: '0 1px 3px rgba(0,0,0,.04), 0 0 0 0.5px rgba(0,0,0,.03)',
                  transition: 'box-shadow 150ms, border-color 150ms',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{d.title}</div>
                  {d.client_name && <div style={{ fontSize: 11, color: 'var(--k-primary)', fontWeight: 600, marginBottom: 2 }}>{d.client_name}</div>}
                  {d.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>{d.contact_name}</div>}
                  {d.owner_id && <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 4 }}>Owner: {d.owner_id.substring(0, 8)}…</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>₹{Number(d.value || 0).toLocaleString('en-IN')}</span>
                    {stage !== 'Won' && stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {stages.filter(s => s !== stage).map(s => (
                      <button key={s} onClick={() => moveStage(d.id, s)}
                        style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${STAGE_COLORS[s]}18`,
                          color: STAGE_COLORS[s], border: 'none', cursor: 'pointer', fontWeight: 600 }}>{s}</button>
                    ))}
                  </div>
                </div>
                );
              })}
              {deals.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 12 }}>No deals</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function PipelineTab() {
  const { pushToast } = useToast();
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/pipeline-summary');
      setSummary(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load pipeline', type: 'error' }); }
    finally { setLoading(false); }
  }

  const total = summary.reduce((s, r) => s + Number(r.total_value), 0);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatTile label="Total Pipeline" value={`₹${total.toLocaleString('en-IN')}`} />
        <StatTile label="Active Deals" value={summary.reduce((s, r) => s + Number(r.count), 0)} />
      </div>

      {summary.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No deals yet. Create deals to see your pipeline.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {summary.map(s => (
            <div key={s.stage} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <Badge text={s.stage} color={STAGE_COLORS[s.stage] || '#6E7B91'} />
              <div style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 4px', color: 'var(--ink-1)' }}>{Number(s.count)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>₹{Number(s.total_value).toLocaleString('en-IN')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function FollowUpsTab() {
  const { pushToast } = useToast();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [form, setForm] = useState({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/follow-ups?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setFollowUps(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load follow-ups', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadOptions() {
    try {
      const [c, d] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/deals')]);
      setContacts(c.data.data || []);
      setDeals(d.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/follow-ups', form);
      pushToast({ title: 'Follow-up created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function complete(id) {
    try {
      await api.patch(`/v1/graha/follow-ups/${id}/complete`);
      pushToast({ title: 'Marked complete', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not complete follow-up', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/follow-ups/${id}`);
      pushToast({ title: 'Follow-up deleted', type: 'success' });
      setFollowUps(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete follow-up', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadOptions(); }}>+ New Follow-up</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Follow-up</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Due Date *</span>
              <input className="k-input" type="datetime-local" required value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Remind At</span>
              <input className="k-input" type="datetime-local" value={form.remind_at} onChange={e => setForm({ ...form, remind_at: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        followUps.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No follow-ups found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {followUps.map(f => {
            const overdue = !f.is_completed && new Date(f.due_at) < new Date();
            return (
              <div key={f.id} style={{ background: 'var(--surface-1)', border: `1px solid ${overdue ? '#ef444440' : 'var(--rule-soft)'}`, borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, textDecoration: f.is_completed ? 'line-through' : 'none' }}>{f.title}</span>
                  <Badge text={f.is_completed ? 'Done' : overdue ? 'Overdue' : 'Pending'}
                    color={f.is_completed ? '#10b981' : overdue ? '#ef4444' : '#f59e0b'} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 6 }}>
                  {f.contact_name && <span>{f.contact_name} · </span>}
                  {f.deal_title && <span>{f.deal_title} · </span>}
                  <span>Due: {new Date(f.due_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {f.description && <span> · {f.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!f.is_completed && (
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => complete(f.id)}>Complete</button>
                  )}
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '3px 10px', color: '#ef4444' }} onClick={() => remove(f.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function LabelsTab() {
  const { pushToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', color: '#6366f1' });
  const [saving, setSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({ contact_id: '', label_id: '' });
  const [showAssign, setShowAssign] = useState(false);
  const [contacts, setContacts] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/labels');
      setLabels(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load labels', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/labels', form);
      pushToast({ title: 'Label created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', color: '#6366f1' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/labels/${id}`);
      pushToast({ title: 'Label deleted', type: 'success' });
      setLabels(prev => prev.filter(l => l.id !== id));
    } catch { pushToast({ title: 'Could not delete label', type: 'error' }); }
  }

  async function loadContacts() {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(r.data.data || []);
    } catch {}
  }

  async function assignLabel(e) {
    e.preventDefault();
    try {
      await api.post(`/v1/graha/contacts/${assignForm.contact_id}/labels/${assignForm.label_id}`);
      pushToast({ title: 'Label assigned', type: 'success' });
      setShowAssign(false);
      setAssignForm({ contact_id: '', label_id: '' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ New Label</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => { setShowAssign(true); loadContacts(); }}>Assign to Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Label</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 13, flex: 1 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Color</span>
              <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })}
                style={{ width: 48, height: 36, border: '1px solid var(--rule-soft)', borderRadius: 6, cursor: 'pointer' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {showAssign && (
        <form onSubmit={assignLabel} style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Assign Label to Contact</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact *</span>
              <select className="k-input" required value={assignForm.contact_id} onChange={e => setAssignForm({ ...assignForm, contact_id: e.target.value })}>
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Label *</span>
              <select className="k-input" required value={assignForm.label_id} onChange={e => setAssignForm({ ...assignForm, label_id: e.target.value })}>
                <option value="">Select…</option>
                {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowAssign(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Assign</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        labels.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No labels yet.</p> : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {labels.map(l => (
            <div key={l.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: l.color || '#6366f1' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</span>
              <button onClick={() => remove(l.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11, marginLeft: 8 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function ActivitiesTab() {
  const { pushToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
  const [saving, setSaving] = useState(false);
  const [deals, setDeals] = useState([]);
  const [contacts, setContacts] = useState([]);

  async function loadOptions() {
    try {
      const [d, c] = await Promise.all([
        api.get('/v1/graha/deals'), api.get('/v1/graha/contacts'),
      ]);
      setDeals(d.data.data || []);
      setContacts(c.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/activities', form);
      pushToast({ title: 'Activity logged', type: 'success' });
      setShowForm(false);
      setForm({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => { setShowForm(true); loadOptions(); }}>
        + Log Activity
      </button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Log Activity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={3} value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Log Activity'}</button>
          </div>
        </form>
      )}

      {!showForm && (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>
          Activities are logged against contacts and deals. Open a contact or deal to see its full activity history.
        </p>
      )}
    </div>
  );
}


// ── Reports Tab ──────────────────────────────────────────────

function ReportsTab() {
  const [conversion, setConversion] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [sources, setSources] = useState(null);
  const [reps, setReps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/v1/graha/reports/conversion?days=${days}`),
      api.get('/v1/graha/reports/forecast'),
      api.get(`/v1/graha/reports/pipeline-velocity?days=${days}`),
      api.get(`/v1/graha/reports/source-analysis?days=${days}`),
      api.get(`/v1/graha/reports/rep-performance?days=${days}`).catch(() => ({ data: null })),
    ]).then(([c, f, v, s, r]) => {
      setConversion(c.data);
      setForecast(f.data);
      setVelocity(v.data);
      setSources(s.data);
      setReps(r.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading reports...</p>;

  const fmt = v => v != null ? formatINR(v) : '—';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Period:</span>
        {[30, 60, 90, 180].map(d => (
          <button key={d} className={`k-btn ${days === d ? 'k-btn--primary' : 'k-btn--ghost'}`}
            style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => setDays(d)}>{d}d</button>
        ))}
      </div>

      {conversion && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatTile label="Total Deals" value={conversion.total_deals} />
          <StatTile label="Won" value={conversion.won} />
          <StatTile label="Lost" value={conversion.lost} />
          <StatTile label="Open" value={conversion.open} />
          <StatTile label="Win Rate" value={`${conversion.conversion_rate}%`} />
          <StatTile label="Won Value" value={fmt(conversion.won_value)} />
          <StatTile label="Avg Cycle" value={`${conversion.avg_cycle_days}d`} />
        </div>
      )}

      {forecast && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Revenue Forecast</h4>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Pipeline</div><div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(forecast.total_pipeline)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Weighted</div><div style={{ fontSize: 18, fontWeight: 600, color: '#10b981' }}>{fmt(forecast.weighted_forecast)}</div></div>
          </div>
          {forecast.stages?.map(s => (
            <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <Badge text={s.stage} color={STAGE_COLORS[s.stage] || '#6b7280'} />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{s.count} deals</span>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 100, textAlign: 'right' }}>{fmt(s.total_value)}</span>
              <span style={{ fontSize: 11, color: '#10b981', minWidth: 90, textAlign: 'right' }}>≈ {fmt(s.weighted_value)}</span>
            </div>
          ))}
        </div>
      )}

      {velocity?.data?.length > 0 && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Pipeline Velocity</h4>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Stage', 'Count', 'Total Value', 'Avg Value', 'Avg Days'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{velocity.data.map(r => (
              <tr key={r.stage} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '6px 8px' }}><Badge text={r.stage} color={STAGE_COLORS[r.stage] || '#6b7280'} /></td>
                <td style={{ padding: '6px 8px' }}>{r.count}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.total_value)}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.avg_value)}</td>
                <td style={{ padding: '6px 8px' }}>{r.avg_days_in_stage ?? '—'}d</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {sources?.data?.length > 0 && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Lead Source Analysis</h4>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Source', 'Leads', 'Deals', 'Won', 'Won Value'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{sources.data.map(r => (
              <tr key={r.source} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '6px 8px' }}><Badge text={r.source} color={SOURCE_COLORS[r.source] || '#6b7280'} /></td>
                <td style={{ padding: '6px 8px' }}>{r.leads}</td>
                <td style={{ padding: '6px 8px' }}>{r.deals}</td>
                <td style={{ padding: '6px 8px' }}>{r.won}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.won_value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {reps?.data?.length > 0 && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Rep Performance</h4>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Rep', 'Total', 'Won', 'Lost', 'Won Value', 'Avg Deal'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{reps.data.map(r => (
              <tr key={r.assigned_to} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '6px 8px', fontSize: 11, fontFamily: 'var(--mono)' }}>{r.assigned_to?.slice(0, 12) || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{r.total_deals}</td>
                <td style={{ padding: '6px 8px', color: '#10b981' }}>{r.won}</td>
                <td style={{ padding: '6px 8px', color: '#ef4444' }}>{r.lost}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.won_value)}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.avg_deal_value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Automations Tab ──────────────────────────────────────────

function AutomationsTab() {
  const { pushToast } = useToast();
  const [automations, setAutomations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', trigger_type: 'lead_created', action_type: 'create_followup', conditions: {}, action_data: {} });

  useEffect(() => {
    Promise.all([
      api.get('/v1/graha/automations'),
      api.get('/v1/graha/automation-logs').catch(() => ({ data: { data: [] } })),
    ]).then(([a, l]) => {
      setAutomations(a.data.data || []);
      setLogs(l.data.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/automations', form);
      pushToast({ title: 'Automation created', type: 'success' });
      setShowForm(false);
      const r = await api.get('/v1/graha/automations');
      setAutomations(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function toggle(id) {
    try {
      await api.patch(`/v1/graha/automations/${id}/toggle`);
      setAutomations(prev => prev.map(a => a.id === id ? { ...a, is_active: !a.is_active } : a));
    } catch { pushToast({ title: 'Could not toggle automation', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/automations/${id}`);
      setAutomations(prev => prev.filter(a => a.id !== id));
    } catch { pushToast({ title: 'Could not delete automation', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  const TRIGGERS = ['lead_created', 'deal_stage_changed', 'deal_created', 'activity_created', 'contact_updated', 'deal_stale', 'followup_overdue'];
  const ACTIONS = ['assign_to', 'create_followup', 'create_activity', 'update_score', 'change_stage', 'send_notification', 'add_label'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Sales Automations ({automations.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowForm(!showForm)}>+ New Rule</button>
      </div>

      {showForm && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</span>
              <input className="k-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Trigger</span>
              <select className="k-input" value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })}>
                {TRIGGERS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Action</span>
              <select className="k-input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {automations.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: a.is_active ? '#10b981' : '#6b7280', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              When: <Badge text={a.trigger_type.replace(/_/g, ' ')} color="#6366f1" /> → <Badge text={a.action_type.replace(/_/g, ' ')} color="#0082c6" />
              {a.run_count > 0 && <span style={{ marginLeft: 8 }}>· Ran {a.run_count}×</span>}
            </div>
          </div>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => toggle(a.id)}>{a.is_active ? 'Disable' : 'Enable'}</button>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(a.id)}>Delete</button>
        </div>
      ))}

      {logs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Recent Logs</h4>
          {logs.slice(0, 20).map(l => (
            <div key={l.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', gap: 8 }}>
              <Badge text={l.result} color={l.result === 'success' ? '#10b981' : l.result === 'error' ? '#ef4444' : '#6b7280'} />
              <span style={{ color: 'var(--ink-2)' }}>{l.automation_name}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{new Date(l.created_at).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Territories Tab ──────────────────────────────────────────

function TerritoriesTab() {
  const { pushToast } = useToast();
  const [territories, setTerritories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', assigned_users: [] });
  const [userInput, setUserInput] = useState('');

  useEffect(() => {
    api.get('/v1/graha/territories')
      .then(r => setTerritories(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/territories', form);
      pushToast({ title: 'Territory created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', description: '', assigned_users: [] });
      const r = await api.get('/v1/graha/territories');
      setTerritories(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/territories/${id}`);
      setTerritories(prev => prev.filter(t => t.id !== id));
    } catch { pushToast({ title: 'Could not delete territory', type: 'error' }); }
  }

  function addUser() {
    const u = userInput.trim();
    if (u && !form.assigned_users.includes(u)) {
      setForm({ ...form, assigned_users: [...form.assigned_users, u] });
      setUserInput('');
    }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Territories ({territories.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowForm(!showForm)}>+ New Territory</button>
      </div>

      {showForm && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</span>
              <input className="k-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4, fontSize: 13 }}>Assigned Users</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {form.assigned_users.map(u => (
                <span key={u} style={{ fontSize: 11, background: 'var(--bg-raised)', padding: '2px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {u.slice(0, 12)}
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#ef4444' }}
                    onClick={() => setForm({ ...form, assigned_users: form.assigned_users.filter(x => x !== u) })}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="k-input" placeholder="User ID" value={userInput} onChange={e => setUserInput(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="k-btn k-btn--ghost" onClick={addUser}>Add</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {territories.map(t => (
        <div key={t.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
              {t.description && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.description}</div>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.assigned_users?.length || 0} users</span>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(t.id)}>Delete</button>
          </div>
          {t.assigned_users?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {t.assigned_users.map(u => <Badge key={u} text={u.slice(0, 12)} color="#6366f1" />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// ── Custom Fields Tab ────────────────────────────────────────

function CustomFieldsTab() {
  const { pushToast } = useToast();
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ entity_type: 'contact', field_name: '', field_type: 'text', options: [], is_required: false, sort_order: 0 });

  useEffect(() => {
    api.get('/v1/graha/custom-fields')
      .then(r => setFields(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/custom-fields', form);
      pushToast({ title: 'Field created', type: 'success' });
      setShowForm(false);
      const r = await api.get('/v1/graha/custom-fields');
      setFields(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/custom-fields/${id}`);
      setFields(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete field', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url', 'email', 'phone'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Custom Fields ({fields.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowForm(!showForm)}>+ New Field</button>
      </div>

      {showForm && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Entity</span>
              <select className="k-input" value={form.entity_type} onChange={e => setForm({ ...form, entity_type: e.target.value })}>
                <option value="contact">Contact</option><option value="deal">Deal</option></select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Field Name</span>
              <input className="k-input" value={form.field_name} onChange={e => setForm({ ...form, field_name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.field_type} onChange={e => setForm({ ...form, field_type: e.target.value })}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.is_required} onChange={e => setForm({ ...form, is_required: e.target.checked })} />
              Required</label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, marginRight: 4 }}>Order:</span>
              <input type="number" className="k-input" style={{ width: 60 }} value={form.sort_order}
                onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {['contact', 'deal'].map(entity => {
        const ef = fields.filter(f => f.entity_type === entity);
        if (!ef.length) return null;
        return (
          <div key={entity} style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>
              {entity} fields
            </h4>
            {ef.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{f.field_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 8 }}>{f.field_type}</span>
                  {f.is_required && <Badge text="required" color="#ef4444" />}
                </div>
                <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(f.id)}>Delete</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}


// ── Web Forms Tab ────────────────────────────────────────────

function WebFormsTab() {
  const { pushToast } = useToast();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', auto_source: 'web_form' });
  const [submissions, setSubmissions] = useState({});
  const [openSubs, setOpenSubs] = useState(null);

  useEffect(() => {
    api.get('/v1/graha/web-forms')
      .then(r => setForms(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/web-forms', form);
      pushToast({ title: 'Form created', type: 'success' });
      setShowCreate(false);
      const r = await api.get('/v1/graha/web-forms');
      setForms(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/web-forms/${id}`);
      setForms(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete web form', type: 'error' }); }
  }

  async function loadSubs(formId) {
    if (openSubs === formId) { setOpenSubs(null); return; }
    try {
      const r = await api.get(`/v1/graha/web-forms/${formId}/submissions`);
      setSubmissions(prev => ({ ...prev, [formId]: r.data.data || [] }));
      setOpenSubs(formId);
    } catch { pushToast({ title: 'Failed to load submissions', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Web-to-Lead Forms ({forms.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowCreate(!showCreate)}>+ New Form</button>
      </div>

      {showCreate && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Form Name</span>
              <input className="k-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Slug (URL path)</span>
              <input className="k-input" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required placeholder="e.g. contact-us" /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source Tag</span>
              <input className="k-input" value={form.auto_source} onChange={e => setForm({ ...form, auto_source: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {forms.map(f => (
        <div key={f.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                /api/v1/graha/f/{f.slug} · {f.submission_count} submissions · source: {f.auto_source}
              </div>
            </div>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => loadSubs(f.id)}>
              {openSubs === f.id ? 'Hide' : 'Submissions'}
            </button>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(f.id)}>Delete</button>
          </div>
          {openSubs === f.id && submissions[f.id] && (
            <div style={{ marginTop: 8, paddingLeft: 12 }}>
              {submissions[f.id].length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No submissions yet.</p>
              ) : submissions[f.id].map(s => (
                <div key={s.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                  <Badge text={s.status} color={s.status === 'processed' ? '#10b981' : '#6b7280'} />
                  <span style={{ marginLeft: 8, color: 'var(--ink-2)' }}>
                    {Object.entries(s.data || {}).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')}
                  </span>
                  <span style={{ float: 'right', fontSize: 11, color: 'var(--ink-3)' }}>
                    {new Date(s.created_at).toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {forms.length > 0 && (
        <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-raised)', borderRadius: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <strong>Embed code:</strong> POST your form data as JSON to <code>/api/v1/graha/f/{'<slug>'}</code> — fields: name, email, phone, company, message. No auth required.
        </div>
      )}
    </div>
  );
}


// ── Approvals Tab ────────────────────────────────────────────

function ApprovalsTab() {
  const { pushToast } = useToast();
  const [rules, setRules] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ruleEntityFilter, setRuleEntityFilter] = useState('');
  const [requestStatus, setRequestStatus] = useState('pending');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ entity_type: 'deal', threshold_amount: '', approver_role: '' });

  const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
  const ENTITY_TYPES = ['deal', 'vendor_bill', 'expense_claim'];
  const STATUS_COLORS = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444' };

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const params = ruleEntityFilter ? `?entity_type=${ruleEntityFilter}` : '';
      const [rulesR, reqR] = await Promise.all([
        api.get(`/v1/graha/approval-rules${params}`),
        api.get(`/v1/graha/approval-requests?status=${requestStatus}`),
      ]);
      setRules(rulesR.data.data || []);
      setRequests(reqR.data.data || []);
    } catch { pushToast({ title: 'Failed to load approvals', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function createRule(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/approval-rules', { ...ruleForm, threshold_amount: parseFloat(ruleForm.threshold_amount) || 0 });
      pushToast({ title: 'Approval rule created', type: 'success' });
      setShowRuleForm(false);
      setRuleForm({ entity_type: 'deal', threshold_amount: '', approver_role: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function deleteRule(id) {
    try {
      await api.delete(`/v1/graha/approval-rules/${id}`);
      pushToast({ title: 'Rule deleted', type: 'success' });
      setRules(prev => prev.filter(r => r.id !== id));
    } catch { pushToast({ title: 'Could not delete approval rule', type: 'error' }); }
  }

  async function approveRequest(id) {
    try {
      await api.post(`/v1/graha/approval-requests/${id}/approve`);
      pushToast({ title: 'Request approved', type: 'success' });
      load();
    } catch { pushToast({ title: 'Approve failed', type: 'error' }); }
  }

  async function rejectRequest(id) {
    try {
      await api.post(`/v1/graha/approval-requests/${id}/reject`);
      pushToast({ title: 'Request rejected', type: 'success' });
      load();
    } catch { pushToast({ title: 'Reject failed', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      {/* ── Approval Rules ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Approval Rules ({rules.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="k-input" style={{ width: 150 }} value={ruleEntityFilter} onChange={e => setRuleEntityFilter(e.target.value)}>
            <option value="">All Entities</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
          <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowRuleForm(!showRuleForm)}>+ New Rule</button>
        </div>
      </div>

      {showRuleForm && (
        <form onSubmit={createRule} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Entity Type</span>
              <select className="k-input" value={ruleForm.entity_type} onChange={e => setRuleForm({ ...ruleForm, entity_type: e.target.value })}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Threshold Amount</span>
              <input className="k-input" type="number" value={ruleForm.threshold_amount} onChange={e => setRuleForm({ ...ruleForm, threshold_amount: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Approver Role</span>
              <input className="k-input" value={ruleForm.approver_role} onChange={e => setRuleForm({ ...ruleForm, approver_role: e.target.value })} required /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowRuleForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create Rule</button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 32 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            {['Entity Type', 'Threshold', 'Approver Role', 'Status', 'Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '10px', textTransform: 'capitalize' }}>{r.entity_type.replace(/_/g, ' ')}</td>
              <td style={{ padding: '10px', fontWeight: 600 }}>{FMT(r.threshold_amount)}</td>
              <td style={{ padding: '10px' }}>{r.approver_role}</td>
              <td style={{ padding: '10px' }}><Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? '#10b981' : '#6b7280'} /></td>
              <td style={{ padding: '10px' }}>
                <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => deleteRule(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No approval rules defined.</td></tr>
          )}
        </tbody>
      </table>

      {/* ── Pending Requests ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Approval Requests</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="k-input" style={{ width: 130 }} value={requestStatus} onChange={e => setRequestStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            {['Entity Type', 'Amount', 'Status', 'Requested By', 'Approver Role', 'Created', 'Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '10px', textTransform: 'capitalize' }}>{r.entity_type.replace(/_/g, ' ')}</td>
              <td style={{ padding: '10px', fontWeight: 600 }}>{FMT(r.amount)}</td>
              <td style={{ padding: '10px' }}><Badge text={r.status} color={STATUS_COLORS[r.status] || '#6b7280'} /></td>
              <td style={{ padding: '10px', fontSize: 11, fontFamily: 'var(--mono)' }}>{r.requested_by?.slice(0, 12) || '—'}</td>
              <td style={{ padding: '10px' }}>{r.approver_role || '—'}</td>
              <td style={{ padding: '10px', fontSize: 11, color: 'var(--ink-3)' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}</td>
              <td style={{ padding: '10px' }}>
                {r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => approveRequest(r.id)}>Approve</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 10px', color: '#ef4444' }} onClick={() => rejectRequest(r.id)}>Reject</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No {requestStatus} requests.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}


// ── Documents Tab ────────────────────────────────────────────

function DocumentsTab() {
  const { pushToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderFilter, setFolderFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', file_url: '', folder: '', description: '', tags: '' });
  const [saving, setSaving] = useState(false);

  const fmtSize = bytes => {
    if (!bytes) return '—';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  };

  useEffect(() => { load(); loadFolders(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/documents?';
      if (folderFilter) url += `folder=${encodeURIComponent(folderFilter)}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      const r = await api.get(url);
      setDocuments(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load documents', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadFolders() {
    try {
      const r = await api.get('/v1/graha/documents/folders');
      setFolders(r.data.data || []);
    } catch {}
  }

  async function createDocument(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [] };
      await api.post('/v1/graha/documents', payload);
      pushToast({ title: 'Document added', type: 'success' });
      setShowForm(false);
      setForm({ name: '', file_url: '', folder: '', description: '', tags: '' });
      load();
      loadFolders();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteDoc(id) {
    try {
      await api.delete(`/v1/graha/documents/${id}`);
      pushToast({ title: 'Document deleted', type: 'success' });
      setDocuments(prev => prev.filter(d => d.id !== id));
      loadFolders();
    } catch { pushToast({ title: 'Could not delete document', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 160 }} value={folderFilter} onChange={e => setFolderFilter(e.target.value)}>
          <option value="">All Folders</option>
          {folders.map(f => <option key={f.folder} value={f.folder}>{f.folder} ({f.count})</option>)}
        </select>
        <input className="k-input" style={{ flex: 1, maxWidth: 260 }} placeholder="Search documents..." value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Search</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Document</button>
      </div>

      {showForm && (
        <form onSubmit={createDocument} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add Document</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>File URL *</span>
              <input className="k-input" required value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Folder</span>
              <input className="k-input" value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })} placeholder="e.g. contracts, invoices" /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tags (comma-separated)</span>
              <input className="k-input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="e.g. legal, signed, 2026" /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving...' : 'Add Document'}</button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            {['Name', 'Folder', 'Size', 'Type', 'Uploaded', 'Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {documents.map(d => (
            <tr key={d.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '10px' }}>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                {d.description && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{d.description}</div>}
                {d.tags?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {d.tags.map(t => <Badge key={t} text={t} color="#6366f1" />)}
                  </div>
                )}
              </td>
              <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{d.folder || '—'}</td>
              <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{fmtSize(d.file_size)}</td>
              <td style={{ padding: '10px', color: 'var(--ink-2)', fontSize: 11 }}>{d.mime_type || '—'}</td>
              <td style={{ padding: '10px', fontSize: 11, color: 'var(--ink-3)' }}>{d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN') : '—'}</td>
              <td style={{ padding: '10px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {d.file_url && (
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: 'var(--k-primary)', textDecoration: 'none' }}>Open</a>
                  )}
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => deleteDoc(d.id)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
          {documents.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No documents found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
