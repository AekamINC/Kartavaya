import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';
import { billingColor, billingLabel, mixAlpha } from '../lib/statusColors';
import { inr } from '../lib/inr';
import { formatDate, formatPeriod } from '../lib/timeFormat';

/**
 * Billing — plan, credits, modules and invoices.
 *
 * The page fetched /v1/subscription/plans on every mount, stored the result in
 * `plans` and `availableModules`, and rendered neither. So there was no plan
 * comparison and no upgrade path anywhere in the product, despite the data
 * arriving on every load. Both are rendered now.
 *
 * That dead state also hid a backend crash: /plans raised NameError for any org
 * with an active add-on module, and because the four requests are awaited
 * together it took the whole page down. Fixed in routers/subscription.py.
 */

function Badge({ status }) {
  const c = billingColor(status);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99,
      // color-mix, not `${c}18`. The old form appended hex alpha by string
      // concatenation, which worked only while `c` was a 6-digit literal —
      // "var(--ok)18" is not a colour and the badge loses its background with
      // no error anywhere.
      background: mixAlpha(c, 14), color: c,
    }}>
      {billingLabel(status)}
    </span>
  );
}

function Card({ title, children, style }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--outline-variant)',
      borderRadius: 'var(--r-md)', padding: 24, ...style,
    }}>
      {title && <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--on-surface)' }}>{title}</h3>}
      {children}
    </div>
  );
}

const Metric = ({ label, value, tone }) => (
  <div>
    <div style={{ fontSize: 10, fontWeight: 700, color: tone || 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: tone || 'var(--on-surface)', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
  </div>
);

function CreditUsage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/v1/subscription/cost-report?period=30d')
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // A failed request used to `return null`, so the entire credit block vanished
  // with no message — someone checking whether they were near their limit got a
  // page that simply did not mention credits, which reads as "no limit exists".
  if (failed) {
    return (
      <Card title="Credit Usage — This Month" style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--on-surface-3)', fontSize: 13, margin: 0 }}>
          Couldn’t load credit usage. Your credits are unaffected — this is a display
          problem. Reload to try again.
        </p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title="Credit Usage — This Month" style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--on-surface-3)', fontSize: 13, margin: 0 }}>Loading…</p>
      </Card>
    );
  }

  const pct = data.plan_credits > 0
    ? Math.min(100, Math.round((data.total_credits_used / data.plan_credits) * 100))
    : 0;
  const over = pct >= 100;

  return (
    <Card title="Credit Usage — This Month" style={{ marginBottom: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Metric label="Plan Credits" value={data.plan_credits} />
        <Metric label="Used" value={data.total_credits_used} tone={data.is_over_plan ? 'var(--danger)' : undefined} />
        <Metric label="Balance" value={data.current_balance} tone={data.current_balance <= 0 ? 'var(--danger)' : 'var(--ok)'} />
        {data.overage_credits > 0 && (
          <Metric label="Overage (Chargeable)" value={data.overage_credits} tone="var(--danger)" />
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        aria-label="Plan credits used"
        style={{ background: 'var(--s-container)', borderRadius: 6, height: 8, overflow: 'hidden' }}
      >
        <div style={{
          height: '100%', width: `${pct}%`,
          background: over ? 'var(--danger)' : 'var(--primary)',
          borderRadius: 6, transition: 'width calc(.3s * var(--ix))',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--on-surface-3)', marginTop: 6 }}>
        <span>AI: {data.ai_credits_used} · Scraper: {data.scraper_credits_used}</span>
        <span>{pct}% used</span>
      </div>
    </Card>
  );
}

/**
 * Plan comparison. Pricing is stripped server-side for non-staff, so a missing
 * price is the normal case for most users, not an error — the card says "Talk
 * to your admin" rather than rendering ₹0 or an empty gap.
 */
function PlanComparison({ plans, currentPlanName }) {
  if (!plans.length) return null;
  return (
    <Card title="Plans" style={{ marginBottom: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {plans.map(p => {
          const current = p.name === currentPlanName;
          return (
            <div key={p.id || p.name} style={{
              padding: 16, borderRadius: 'var(--r-sm)',
              border: `1px solid ${current ? 'var(--primary)' : 'var(--outline-variant)'}`,
              background: current ? mixAlpha('var(--primary)', 6) : 'var(--s-lowest)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)' }}>{p.name}</span>
                {current && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '.08em', padding: '2px 7px',
                    borderRadius: 99, background: 'var(--primary-container)', color: 'var(--on-primary-container)',
                  }}>
                    CURRENT
                  </span>
                )}
              </div>
              <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--on-surface)', fontVariantNumeric: 'tabular-nums' }}>
                {p.price_monthly != null
                  ? <>{inr(p.price_monthly)}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--on-surface-3)' }}>/mo</span></>
                  : <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--on-surface-3)' }}>Talk to your admin</span>}
              </div>
              {p.max_users != null && (
                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 6 }}>
                  Up to {p.max_users} users
                </div>
              )}
              {p.description && (
                <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 6, lineHeight: 1.5 }}>
                  {p.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function AvailableModules({ available, active }) {
  const inactive = available.filter(m => !active.includes(m.code || m.name));
  if (!inactive.length) return null;
  return (
    <Card title="Available Modules" style={{ marginBottom: 24 }}>
      <p style={{ color: 'var(--on-surface-3)', fontSize: 13, margin: '0 0 12px' }}>
        Not currently on your subscription. Your admin can enable these.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {inactive.map(m => (
          <div key={m.code || m.name} style={{
            padding: 13, borderRadius: 'var(--r-sm)',
            border: '1px solid var(--outline-variant)', background: 'var(--s-lowest)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>
              {m.name || titleCase(m.code)}
            </div>
            {m.price_per_user_monthly != null && (
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                {inr(m.price_per_user_monthly)}/user/mo
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function BillingPage() {
  const { pushToast } = useToast();
  const [sub, setSub] = useState(null);
  const [modules, setModules] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [usage, setUsage] = useState(null);
  const [plans, setPlans] = useState([]);
  const [availableModules, setAvailableModules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [cur, inv, usg, catalog] = await Promise.all([
        api.get('/v1/subscription/current'),
        api.get('/v1/subscription/invoices'),
        api.get('/v1/subscription/usage'),
        api.get('/v1/subscription/plans'),
      ]);
      setSub(cur.data.subscription);
      setModules(cur.data.active_modules || []);
      setInvoices(inv.data.data || []);
      setUsage(usg.data);
      setPlans(catalog.data.plans || []);
      setAvailableModules(catalog.data.modules || []);
    } catch (e) {
      pushToast({ title: 'Failed to load billing data', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--on-surface-3)' }}>Loading…</div>;

  const planName = sub?.plan_name || 'Free';
  const maxUsers = sub?.max_users || 5;
  const userCount = usage?.user_count || 0;

  const downloadReport = async (p) => {
    try {
      const res = await api.get(`/v1/subscription/cost-report/pdf?period=${p}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `UsageReport-${p}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { pushToast({ title: 'Report generation failed', type: 'error' }); }
  };

  const th = {
    textAlign: 'left', padding: '8px 12px', fontWeight: 600,
    color: 'var(--on-surface-3)', fontSize: 11, textTransform: 'uppercase',
  };
  const td = { padding: '10px 12px' };
  const tdNum = { ...td, fontWeight: 600, fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Billing & Subscription" sanskrit="शुल्क" lede="Manage your plan, modules, and invoices" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatTile label="Current Plan" value={planName} />
        <StatTile label="Users" value={`${userCount} / ${maxUsers}`} />
        {/* billingLabel, not the raw enum — this printed a lowercase "active". */}
        <StatTile label="Status" value={billingLabel(sub?.status || 'active')} />
        <StatTile label="Active Modules" value={modules.length} />
      </div>

      <Card title="Active Modules" style={{ marginBottom: 24 }}>
        {modules.length === 0 ? (
          <p style={{ color: 'var(--on-surface-3)', fontSize: 13 }}>No add-on modules activated. Contact your admin to enable modules.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {modules.map(m => (
              <span key={m} style={{
                fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 99,
                background: mixAlpha('var(--primary)', 12), color: 'var(--primary)',
              }}>
                {titleCase(m)}
              </span>
            ))}
          </div>
        )}
      </Card>

      <CreditUsage />

      <PlanComparison plans={plans} currentPlanName={planName} />
      <AvailableModules available={availableModules} active={modules} />

      <Card title="Usage Report" style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--on-surface-3)', fontSize: 13, margin: '0 0 12px' }}>
          Download a detailed credit usage report for your records.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            ['7d', 'Last 7 days'], ['30d', 'Last 30 days'],
            ['90d', 'Last 90 days'], ['ytd', 'Year to Date'],
          ].map(([p, label]) => (
            <button key={p} className="k-btn k-btn--sm k-btn--ghost" onClick={() => downloadReport(p)}>
              ↓ {label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Invoice History">
        {invoices.length === 0 ? (
          <p style={{ color: 'var(--on-surface-3)', fontSize: 13 }}>No invoices yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--outline-variant)' }}>
                  {['Invoice #', 'Period', 'Total', 'GST', 'Status', 'Due Date'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--outline-variant)' }}>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoice_number}</td>
                    {/* "Jul 2026", not "2026-07-01 → 2026-07-31". */}
                    <td style={td}>{formatPeriod(inv.period_start, inv.period_end)}</td>
                    <td style={tdNum}>{inr(inv.total)}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{inr(inv.gst)}</td>
                    <td style={td}><Badge status={inv.payment_status} /></td>
                    <td style={td}>{formatDate(inv.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
