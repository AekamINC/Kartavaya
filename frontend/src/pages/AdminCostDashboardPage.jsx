/**
 * AdminCostDashboardPage.jsx — Platform admin: cost analytics across all orgs.
 * Shows both Aekam actual cost (USD) and client-charged amount (INR with markup).
 */
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';
import { TabBar, Section, DataTable, Td, BackButton, Shimmer } from '../components/editorial';

const PERIODS = [
  { code: '7d', label: '7 days' },
  { code: '30d', label: '30 days' },
  { code: '90d', label: '90 days' },
  { code: 'ytd', label: 'YTD' },
];

function fmtUSD(v) { return `$${(v || 0).toFixed(4)}`; }
function fmtUSD2(v) { return `$${(v || 0).toFixed(2)}`; }
function fmtINR(v) { return `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtNum(v) { return (v || 0).toLocaleString('en-IN'); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPct(v) { return `${((v || 0) * 100).toFixed(0)}%`; }

function DualCost({ usd, inr, charged }) {
  return (
    <div style={{ lineHeight: 1.4 }}>
      <div style={{ fontWeight: 600 }}>{fmtINR(charged)}</div>
      <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{fmtUSD2(usd)} · ₹{(inr || 0).toFixed(2)}</div>
    </div>
  );
}

function PeriodSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {PERIODS.map(p => (
        <button key={p.code} className={`k-btn k-btn--sm ${value === p.code ? 'k-btn--primary' : 'k-btn--ghost'}`}
          onClick={() => onChange(p.code)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Tab: Platform Overview ─────────────────────────────────

function PlatformOverview({ period }) {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/v1/admin/orgs/platform-analytics?period=${period}`)
      .then(r => setData(r.data))
      .catch(() => pushToast({ type: 'error', title: 'Could not load platform analytics' }))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <Shimmer lines={8} />;
  if (!data) return null;

  const tc = data.total_cost || {};
  const ac = data.ai_cost || {};
  const sc = data.scraper_cost || {};

  return (
    <>
      <div className="k-stats">
        <StatTile label="Total Orgs" value={fmtNum(data.total_orgs)} />
        <StatTile label="Total Users" value={fmtNum(data.total_users)} />
        <StatTile label="Usage Revenue" value={fmtINR(data.total_revenue_inr)} />
        <StatTile label="Aekam Cost" value={fmtINR(data.total_cost_inr)} />
        <StatTile label="Margin" value={fmtINR(data.margin_inr)} />
        <StatTile label="Total AI Calls" value={fmtNum(data.total_ai_calls)} />
      </div>

      <Section title={`Cost Summary · Default Markup ${fmtPct(data.default_markup_pct || data.markup_pct)} · Live Rate ₹${data.usd_to_inr ? data.usd_to_inr.toFixed(2) : '—'}/USD`}>
        <DataTable columns={['Category', 'Aekam Cost (USD)', 'Aekam Cost (INR)', 'Client Charge (INR)']}>
          <tr>
            <Td bold>AI Services</Td>
            <Td mono>{fmtUSD2(ac.usd)}</Td>
            <Td mono>{fmtINR(ac.inr)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(ac.charged_inr)}</Td>
          </tr>
          <tr>
            <Td bold>Scraper / Data</Td>
            <Td mono>{fmtUSD2(sc.usd)}</Td>
            <Td mono>{fmtINR(sc.inr)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(sc.charged_inr)}</Td>
          </tr>
          <tr style={{ borderTop: '2px solid var(--rule)' }}>
            <Td bold>Total</Td>
            <Td mono bold>{fmtUSD2(tc.usd)}</Td>
            <Td mono bold>{fmtINR(tc.inr)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)', fontSize: 14 }}>{fmtINR(tc.charged_inr)}</Td>
          </tr>
        </DataTable>
      </Section>

      <Section title="Cost by Provider">
        <DataTable columns={['Provider', 'Cost (USD)', 'Charge (INR)', 'Calls']}>
          {(data.ai_cost_by_provider || []).map((r, i) => (
            <tr key={i}>
              <Td>{r.provider}</Td>
              <Td mono>{fmtUSD(r.cost_usd)}</Td>
              <Td mono>{fmtINR(r.cost?.charged_inr)}</Td>
              <Td mono>{fmtNum(r.call_count)}</Td>
            </tr>
          ))}
          {(data.ai_cost_by_provider || []).length === 0 && (
            <tr><Td colSpan={4} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No AI usage in this period.</Td></tr>
          )}
        </DataTable>
      </Section>

      <Section title="Top Spenders">
        <DataTable columns={['Organisation', 'Markup', 'Aekam Cost (USD)', 'Client Charge (INR)', 'Margin (INR)', 'AI', 'Scraper']}>
          {(data.top_orgs_by_spend || []).map((r, i) => (
            <tr key={i}>
              <Td bold>{r.org_name}</Td>
              <Td mono>{fmtPct(r.markup_pct)}</Td>
              <Td mono>{fmtUSD2(r.total_cost_usd)}</Td>
              <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(r.charged_inr)}</Td>
              <Td mono style={{ color: '#10b981', fontWeight: 600 }}>{fmtINR(r.margin_inr)}</Td>
              <Td mono>{fmtUSD2(r.ai_cost_usd)}</Td>
              <Td mono>{fmtUSD2(r.scraper_cost_usd)}</Td>
            </tr>
          ))}
          {(data.top_orgs_by_spend || []).length === 0 && (
            <tr><Td colSpan={7} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No spend data in this period.</Td></tr>
          )}
        </DataTable>
      </Section>
    </>
  );
}

// ── Tab: All Orgs ──────────────────────────────────────────

function AllOrgs({ period, onSelectOrg }) {
  const { pushToast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/v1/admin/orgs/cost-summary?period=${period}`)
      .then(r => setData(r.data.data || r.data || []))
      .catch(() => pushToast({ type: 'error', title: 'Could not load cost summary' }))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <Shimmer lines={10} />;

  return (
    <Section title="All Organisations">
      <DataTable columns={['Org Name', 'Plan', 'Markup', 'Cost (USD)', 'Charge (INR)', 'AI Calls', 'Last Active']}>
        {data.map(r => (
          <tr key={r.org_id} onClick={() => onSelectOrg(r.org_id, r.org_name)}
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Td bold>{r.org_name}</Td>
            <Td>{r.plan_name || 'Free'}</Td>
            <Td mono>{r.markup_pct != null ? `${Math.round(r.markup_pct * 100)}%` : '30%'}</Td>
            <Td mono>{fmtUSD2(r.total_cost_usd)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(r.charged_inr)}</Td>
            <Td mono>{fmtNum(r.ai_calls)}</Td>
            <Td>{fmtDate(r.last_active)}</Td>
          </tr>
        ))}
        {data.length === 0 && (
          <tr><Td colSpan={7} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No organisations found.</Td></tr>
        )}
      </DataTable>
    </Section>
  );
}

// ── Tab: Org Detail ────────────────────────────────────────

function OrgDetail({ orgId, orgName, period, onBack }) {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dlLoading, setDlLoading] = useState(false);
  const [editMarkup, setEditMarkup] = useState(null);
  const [savingMarkup, setSavingMarkup] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/v1/admin/orgs/${orgId}/cost-breakdown?period=${period}`)
      .then(r => setData(r.data))
      .catch(() => pushToast({ type: 'error', title: 'Could not load cost breakdown' }))
      .finally(() => setLoading(false));
  }, [orgId, period]);

  if (loading) return <><BackButton onClick={onBack} /><Shimmer lines={8} /></>;
  if (!data) return <BackButton onClick={onBack} />;

  const maxDayCost = Math.max(
    ...(data.daily_trend || []).map(d => d.ai_cost + d.scraper_cost),
    0.01
  );

  const t = data.total || {};
  const a = data.ai || {};
  const s = data.scraper || {};

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <BackButton onClick={onBack} label="Back to All Orgs" />
        <button className="k-btn k-btn--sm k-btn--ghost"
          disabled={dlLoading}
          onClick={async () => {
            setDlLoading(true);
            try {
              const res = await api.get(`/v1/admin/orgs/${orgId}/cost-report-pdf?period=${period}`, { responseType: 'blob' });
              const url = URL.createObjectURL(res.data);
              const a = document.createElement('a');
              a.href = url;
              a.download = `CostReport-${orgName}-${period}.pdf`;
              a.click();
              URL.revokeObjectURL(url);
            } catch { pushToast({ type: 'error', title: 'PDF generation failed' }); }
            finally { setDlLoading(false); }
          }}>
          {dlLoading ? 'Generating…' : '↓ Download Client Report'}
        </button>
      </div>

      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', margin: '8px 0 16px' }}>
        {orgName || 'Organisation'} — Cost Breakdown
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Markup:</span>
        <input className="k-input" type="number" min="0" max="100" step="1"
          style={{ width: 64, textAlign: 'center' }}
          value={editMarkup != null ? editMarkup : Math.round((data.markup_pct || 0.3) * 100)}
          onChange={e => setEditMarkup(Number(e.target.value))} />
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>%</span>
        {editMarkup != null && editMarkup !== Math.round((data.markup_pct || 0.3) * 100) && (
          <button className="k-btn k-btn--sm k-btn--primary" disabled={savingMarkup}
            onClick={async () => {
              setSavingMarkup(true);
              try {
                await api.patch(`/v1/admin/orgs/${orgId}/markup`, { markup_pct: editMarkup / 100 });
                pushToast({ type: 'success', title: `Markup updated to ${editMarkup}%` });
                setData(d => ({ ...d, markup_pct: editMarkup / 100 }));
                setEditMarkup(null);
              } catch { pushToast({ type: 'error', title: 'Failed to update markup' }); }
              finally { setSavingMarkup(false); }
            }}>
            {savingMarkup ? 'Saving…' : 'Save'}
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 'auto' }}>
          Live Rate: ₹{data.usd_to_inr ? data.usd_to_inr.toFixed(2) : '—'}/USD
        </span>
      </div>

      <Section title={`Summary · Markup ${fmtPct(data.markup_pct)} · Live Rate ₹${data.usd_to_inr ? data.usd_to_inr.toFixed(2) : '—'}/USD`}>
        <DataTable columns={['Category', 'Aekam Cost (USD)', 'Aekam Cost (INR)', 'Client Charge (INR)']}>
          <tr>
            <Td bold>AI Services</Td>
            <Td mono>{fmtUSD2(a.usd)}</Td>
            <Td mono>{fmtINR(a.inr)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(a.charged_inr)}</Td>
          </tr>
          <tr>
            <Td bold>Scraper / Data</Td>
            <Td mono>{fmtUSD2(s.usd)}</Td>
            <Td mono>{fmtINR(s.inr)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(s.charged_inr)}</Td>
          </tr>
          <tr style={{ borderTop: '2px solid var(--rule)' }}>
            <Td bold>Total</Td>
            <Td mono bold>{fmtUSD2(t.usd)}</Td>
            <Td mono bold>{fmtINR(t.inr)}</Td>
            <Td mono bold style={{ color: 'var(--k-primary)', fontSize: 14 }}>{fmtINR(t.charged_inr)}</Td>
          </tr>
        </DataTable>
      </Section>

      <Section title="Credits">
        <div className="k-stats" style={{ marginBottom: 16 }}>
          <StatTile label="Current Balance" value={fmtNum(data.org_credits_balance)} />
          <StatTile label="Used This Period" value={fmtNum(data.credits_used_period)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Top Up:</span>
          {[100, 200, 500, 1000].map(amt => (
            <button key={amt} className="k-btn k-btn--sm k-btn--ghost"
              onClick={async () => {
                try {
                  const res = await api.post(`/v1/admin/orgs/${orgId}/credits/topup`, { amount: amt });
                  pushToast({ type: 'success', title: `+${amt} credits added. Balance: ${res.data.balance}` });
                  setData(d => ({ ...d, org_credits_balance: res.data.balance }));
                } catch (e) { pushToast({ type: 'error', title: e?.response?.data?.detail || 'Top-up failed' }); }
              }}>
              +{amt}
            </button>
          ))}
          <input className="k-input" type="number" min="1" placeholder="Custom"
            style={{ width: 80, fontSize: 12 }}
            onKeyDown={async e => {
              if (e.key === 'Enter' && e.target.value > 0) {
                try {
                  const res = await api.post(`/v1/admin/orgs/${orgId}/credits/topup`, { amount: Number(e.target.value) });
                  pushToast({ type: 'success', title: `+${e.target.value} credits. Balance: ${res.data.balance}` });
                  setData(d => ({ ...d, org_credits_balance: res.data.balance }));
                  e.target.value = '';
                } catch (err) { pushToast({ type: 'error', title: err?.response?.data?.detail || 'Top-up failed' }); }
              }
            }} />
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Enter + press Enter</span>
        </div>
      </Section>

      {(data.per_client || []).length > 0 && (
        <Section title="Per-Client Breakdown">
          <DataTable columns={['Client', 'AI Cost (USD)', 'Client Charge (INR)', 'AI Calls']}>
            {data.per_client.map((r, i) => (
              <tr key={i}>
                <Td bold>{r.client_name}</Td>
                <Td mono>{fmtUSD(r.ai_cost_usd)}</Td>
                <Td mono bold style={{ color: 'var(--k-primary)' }}>{fmtINR(r.ai_cost?.charged_inr)}</Td>
                <Td mono>{fmtNum(r.ai_calls)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      <Section title="AI Costs by Model">
        <DataTable columns={['Provider', 'Model', 'Cost (USD)', 'Charge (INR)', 'Calls', 'Tokens']}>
          {(data.ai_costs || []).map((r, i) => (
            <tr key={i}>
              <Td>{r.provider}</Td>
              <Td mono>{r.model}</Td>
              <Td mono>{fmtUSD(r.cost_usd)}</Td>
              <Td mono>{fmtINR(r.cost?.charged_inr)}</Td>
              <Td mono>{fmtNum(r.call_count)}</Td>
              <Td mono style={{ fontSize: 10 }}>{fmtNum(r.prompt_tokens)} / {fmtNum(r.completion_tokens)}</Td>
            </tr>
          ))}
          {(data.ai_costs || []).length === 0 && (
            <tr><Td colSpan={6} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No AI usage in this period.</Td></tr>
          )}
        </DataTable>
      </Section>

      <Section title="Scraper Costs">
        <DataTable columns={['Scraper', 'Cost (USD)', 'Charge (INR)', 'Billed (INR)', 'Runs']}>
          {(data.scraper_costs || []).map((r, i) => (
            <tr key={i}>
              <Td>{r.scraper_id}</Td>
              <Td mono>{fmtUSD(r.cost_usd)}</Td>
              <Td mono>{fmtINR(r.cost?.charged_inr)}</Td>
              <Td mono>{fmtINR(r.billed_inr)}</Td>
              <Td mono>{fmtNum(r.run_count)}</Td>
            </tr>
          ))}
          {(data.scraper_costs || []).length === 0 && (
            <tr><Td colSpan={5} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No scraper usage in this period.</Td></tr>
          )}
        </DataTable>
      </Section>

      <Section title="Daily Trend">
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, minHeight: 120, padding: '8px 0' }}>
            {(data.daily_trend || []).map((d, i) => {
              const aiH = (d.ai_cost / maxDayCost) * 100;
              const scH = (d.scraper_cost / maxDayCost) * 100;
              const dayLabel = new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 18, maxWidth: 40 }}
                  title={`${dayLabel}\nAI: ${fmtUSD2(d.ai_cost)}\nScraper: ${fmtUSD2(d.scraper_cost)}`}>
                  <div style={{ width: '80%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ height: Math.max(aiH, 1), background: 'var(--k-primary)', borderRadius: '3px 3px 0 0', opacity: 0.8 }} />
                    <div style={{ height: Math.max(scH, 0.5), background: '#f59e0b', borderRadius: '0 0 3px 3px', opacity: 0.8 }} />
                  </div>
                  {(data.daily_trend || []).length <= 31 && (
                    <div style={{ fontSize: 8, color: 'var(--ink-faint)', marginTop: 4, transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>
                      {dayLabel}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--k-primary)', marginRight: 4, verticalAlign: 'middle' }} /> AI Cost</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f59e0b', marginRight: 4, verticalAlign: 'middle' }} /> Scraper Cost</span>
          </div>
        </div>
      </Section>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────

const TABS = ['Platform Overview', 'All Orgs'];
const TAB_KEY = { 'Platform Overview': 'overview', 'All Orgs': 'orgs' };

export default function AdminCostDashboardPage() {
  const [tab, setTab] = useState('Platform Overview');
  const [period, setPeriod] = useState('30d');
  const [selectedOrg, setSelectedOrg] = useState(null);

  return (
    <div className="k-screen">
      <PageHeader kicker="ADMIN · COSTS" title="Cost Dashboard" sanskrit="लागत" lede="Platform-wide cost analytics — Aekam actual vs client-charged amounts." />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)', flexWrap: 'wrap', gap: 12 }}>
        {!selectedOrg && <TabBar tabs={TABS} active={tab} onChange={setTab} />}
        {selectedOrg && <div />}
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {selectedOrg ? (
        <OrgDetail orgId={selectedOrg.id} orgName={selectedOrg.name} period={period}
          onBack={() => setSelectedOrg(null)} />
      ) : TAB_KEY[tab] === 'overview' ? (
        <PlatformOverview period={period} />
      ) : (
        <AllOrgs period={period} onSelectOrg={(id, name) => setSelectedOrg({ id, name })} />
      )}
    </div>
  );
}
