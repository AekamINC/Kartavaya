/**
 * AdminCostDashboardPage.jsx — Platform admin: cost analytics across all orgs.
 * k-* design system.
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

function fmtUSD(v) { return `$${(v || 0).toFixed(2)}`; }
function fmtINR(v) { return `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }
function fmtNum(v) { return (v || 0).toLocaleString('en-IN'); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Period Selector ────────────────────────────────────────

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

  return (
    <>
      <div className="k-stats">
        <StatTile label="Total Orgs" value={fmtNum(data.total_orgs)} />
        <StatTile label="Total Users" value={fmtNum(data.total_users)} />
        <StatTile label="Revenue" value={fmtINR(data.total_revenue_inr)} />
        <StatTile label="AI Cost" value={fmtUSD(data.total_ai_cost_usd)} />
        <StatTile label="Scraper Cost" value={fmtUSD(data.total_scraper_cost_usd)} />
        <StatTile label="Total AI Calls" value={fmtNum(data.total_ai_calls)} />
      </div>

      <Section title="Cost by Provider">
        <DataTable heads={['Provider', 'Cost (USD)', 'Calls']}>
          {data.ai_cost_by_provider.map((r, i) => (
            <tr key={i}>
              <Td>{r.provider}</Td>
              <Td mono>{fmtUSD(r.cost_usd)}</Td>
              <Td mono>{fmtNum(r.call_count)}</Td>
            </tr>
          ))}
          {data.ai_cost_by_provider.length === 0 && (
            <tr><Td colSpan={3} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No AI usage in this period.</Td></tr>
          )}
        </DataTable>
      </Section>

      <Section title="Top Spenders">
        <DataTable heads={['Organisation', 'AI Cost', 'Scraper Cost', 'Total']}>
          {data.top_orgs_by_spend.map((r, i) => (
            <tr key={i}>
              <Td>{r.org_name}</Td>
              <Td mono>{fmtUSD(r.ai_cost_usd)}</Td>
              <Td mono>{fmtUSD(r.scraper_cost_usd)}</Td>
              <Td mono bold>{fmtUSD(r.total_cost_usd)}</Td>
            </tr>
          ))}
          {data.top_orgs_by_spend.length === 0 && (
            <tr><Td colSpan={4} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No spend data in this period.</Td></tr>
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
      <DataTable heads={['Org Name', 'Plan', 'AI Cost ($)', 'Scraper Cost ($)', 'Total ($)', 'AI Calls', 'Last Active']}>
        {data.map(r => (
          <tr key={r.org_id} onClick={() => onSelectOrg(r.org_id, r.org_name)}
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Td bold>{r.org_name}</Td>
            <Td>{r.plan_name || 'Free'}</Td>
            <Td mono>{fmtUSD(r.ai_cost_usd)}</Td>
            <Td mono>{fmtUSD(r.scraper_cost_usd)}</Td>
            <Td mono bold>{fmtUSD(r.total_cost_usd)}</Td>
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
    ...data.daily_trend.map(d => d.ai_cost + d.scraper_cost),
    0.01
  );

  return (
    <>
      <BackButton onClick={onBack} label={`Back to All Orgs`} />

      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', margin: '0 0 16px' }}>
        {orgName || 'Organisation'} — Cost Breakdown
      </div>

      <div className="k-stats">
        <StatTile label="Total AI" value={fmtUSD(data.total_ai_cost_usd)} />
        <StatTile label="Total Scraper" value={fmtUSD(data.total_scraper_cost_usd)} />
        <StatTile label="Total" value={fmtUSD(data.total_cost_usd)} />
        <StatTile label="Credit Balance" value={fmtNum(data.credit_balance)} />
      </div>

      <Section title="AI Costs by Model">
        <DataTable heads={['Provider', 'Model', 'Cost (USD)', 'Calls', 'Prompt Tokens', 'Completion Tokens']}>
          {data.ai_costs.map((r, i) => (
            <tr key={i}>
              <Td>{r.provider}</Td>
              <Td mono>{r.model}</Td>
              <Td mono>{fmtUSD(r.cost_usd)}</Td>
              <Td mono>{fmtNum(r.call_count)}</Td>
              <Td mono>{fmtNum(r.prompt_tokens)}</Td>
              <Td mono>{fmtNum(r.completion_tokens)}</Td>
            </tr>
          ))}
          {data.ai_costs.length === 0 && (
            <tr><Td colSpan={6} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No AI usage in this period.</Td></tr>
          )}
        </DataTable>
      </Section>

      <Section title="Scraper Costs">
        <DataTable heads={['Scraper', 'Cost (USD)', 'Billed (INR)', 'Runs']}>
          {data.scraper_costs.map((r, i) => (
            <tr key={i}>
              <Td>{r.scraper_id}</Td>
              <Td mono>{fmtUSD(r.cost_usd)}</Td>
              <Td mono>{fmtINR(r.billed_inr)}</Td>
              <Td mono>{fmtNum(r.run_count)}</Td>
            </tr>
          ))}
          {data.scraper_costs.length === 0 && (
            <tr><Td colSpan={4} style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>No scraper usage in this period.</Td></tr>
          )}
        </DataTable>
      </Section>

      <Section title="Daily Trend">
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, minHeight: 120, padding: '8px 0' }}>
            {data.daily_trend.map((d, i) => {
              const aiH = (d.ai_cost / maxDayCost) * 100;
              const scH = (d.scraper_cost / maxDayCost) * 100;
              const dayLabel = new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 18, maxWidth: 40 }}
                  title={`${dayLabel}\nAI: ${fmtUSD(d.ai_cost)}\nScraper: ${fmtUSD(d.scraper_cost)}`}>
                  <div style={{ width: '80%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ height: Math.max(aiH, 1), background: 'var(--k-primary)', borderRadius: '3px 3px 0 0', opacity: 0.8 }} />
                    <div style={{ height: Math.max(scH, 0.5), background: '#f59e0b', borderRadius: '0 0 3px 3px', opacity: 0.8 }} />
                  </div>
                  {data.daily_trend.length <= 31 && (
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

const TABS = [
  { id: 'overview', label: 'Platform Overview' },
  { id: 'orgs', label: 'All Orgs' },
];

export default function AdminCostDashboardPage() {
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState('30d');
  const [selectedOrg, setSelectedOrg] = useState(null); // { id, name }

  const handleSelectOrg = (orgId, orgName) => {
    setSelectedOrg({ id: orgId, name: orgName });
  };

  const handleBack = () => {
    setSelectedOrg(null);
  };

  return (
    <div className="k-screen">
      <PageHeader kicker="ADMIN · COSTS" title="Cost Dashboard" sanskrit="लागत" lede="Platform-wide cost analytics across all organisations." />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)', flexWrap: 'wrap', gap: 12 }}>
        {!selectedOrg && <TabBar tabs={TABS} active={tab} onChange={setTab} />}
        {selectedOrg && <div />}
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {selectedOrg ? (
        <OrgDetail orgId={selectedOrg.id} orgName={selectedOrg.name} period={period} onBack={handleBack} />
      ) : tab === 'overview' ? (
        <PlatformOverview period={period} />
      ) : (
        <AllOrgs period={period} onSelectOrg={handleSelectOrg} />
      )}
    </div>
  );
}
