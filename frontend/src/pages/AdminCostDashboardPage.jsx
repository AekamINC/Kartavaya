/**
 * AdminCostDashboardPage — per-model, per-org, margin, trend.
 * 11-platform-admin.md §1 "Margin, and where it may appear" and §5.
 *
 * 11 §5: "Keep period + currency selectors. Add margin with visible FX and
 * markup, per-org profitability, trend."
 *
 *  · **Period — held.** Four periods, kept.
 *  · **Currency — stale as written.** There was no currency selector to keep;
 *    the page rendered USD and INR side by side in fixed columns. One is added,
 *    and it is a DISPLAY control: `/platform-analytics` and `/cost-summary`
 *    already return both figures plus the rate, so switching does not refetch
 *    and cannot show a number converted at a different rate from the one
 *    printed beside it.
 *  · **Margin — held.** It was a bare `margin_inr` in a green cell with nothing
 *    to check it against. Every margin figure now shows its derivation through
 *    `MarginCell`: metered USD × the FX rate used × the org's markup = the INR
 *    charged. 11: "A margin number with no visible derivation is unauditable,
 *    and this is the number the business runs on."
 *  · **Per-org profitability — held.** `/cost-summary` returns cost and charge
 *    but no margin, so margin is derived here from the same `usd_to_inr` the
 *    platform view reports rather than from a second rate lookup.
 *
 * ── The containment rule ─────────────────────────────────────────────────────
 *
 * 11 §1: platform cost, margin and markup "do not belong in any tenant
 * response, export, PDF or support-agent view… A CSS-level or component-level
 * guard is not sufficient." `canSeeCost` below mirrors the server guard so an
 * operator who will be refused is told rather than shown four spinners and a
 * 403; `MarginCell` refuses to paint outside the platform surface. Neither is
 * the enforcement — the serializer is, and it is still outstanding.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import {
  Button, Card, CardHead, CardBody, Tabs,
  EmptyState, ErrorState, errorKind, SkeletonPage,
  Table, TableHead, TableBody, Row, Cell, HeadCell,
  StatTile, useToast,
} from '../components/ui';
import { currentUser } from '../lib/auth';
import { inr } from '../lib/inr';
import MarginCell from './admin/MarginCell';
import { canSeeCost } from './admin/platformRoles';
import '../styles/admin.css';
import { Secondary } from '../components/Bilingual';
import useColumnPrefs from '../hooks/useColumnPrefs';
import { ColumnsButton } from '../components/ui/CustomizeColumns';

/**
 * The six record lists on this console, each declared once — the floor a saved
 * arrangement resolves against. They are separate keys and not one shared one:
 * "cost by provider" and "cost by model" happen to share four labels, and a
 * single key would mean hiding Calls on the platform roll-up also hid it on the
 * per-org breakdown, which is not what anyone asked for.
 *
 * `fixed` marks the column that says WHICH row this is — the category, the
 * provider, the model, the org. Every other column here is a money figure, and
 * a table of unattributed money is worse than no table. None of these lists has
 * an actions column; the row itself is the affordance on the two that drill.
 */
const CATEGORY_COLUMNS = [
  { id: 'category', label: 'Category', fixed: true },
  { id: 'cost', label: 'Aekam cost', num: true },
  { id: 'charge', label: 'Client charge', num: true },
];

const PROVIDER_COLUMNS = [
  { id: 'provider', label: 'Provider', fixed: true },
  { id: 'cost', label: 'Cost', num: true },
  { id: 'charged', label: 'Charged', num: true },
  { id: 'calls', label: 'Calls', num: true },
];

const TOP_ORG_COLUMNS = [
  { id: 'org', label: 'Organisation', fixed: true },
  { id: 'markup', label: 'Markup', num: true },
  { id: 'cost', label: 'Cost', num: true },
  { id: 'charged', label: 'Charged', num: true },
  { id: 'margin', label: 'Margin', num: true },
];

const ORG_COST_COLUMNS = [
  { id: 'org', label: 'Organisation', fixed: true },
  { id: 'plan', label: 'Plan' },
  { id: 'markup', label: 'Markup', num: true },
  { id: 'cost', label: 'Cost', num: true },
  { id: 'charged', label: 'Charged', num: true },
  { id: 'margin', label: 'Margin', num: true },
  { id: 'calls', label: 'AI calls', num: true },
  { id: 'last_active', label: 'Last active' },
];

const MODEL_COLUMNS = [
  { id: 'provider', label: 'Provider' },
  { id: 'model', label: 'Model', fixed: true },
  { id: 'cost', label: 'Cost', num: true },
  { id: 'charged', label: 'Charged', num: true },
  { id: 'calls', label: 'Calls', num: true },
  { id: 'tokens', label: 'Tokens in / out', num: true },
];

const SCRAPER_COLUMNS = [
  { id: 'scraper', label: 'Scraper', fixed: true },
  { id: 'cost', label: 'Cost', num: true },
  { id: 'charged', label: 'Charged', num: true },
  { id: 'billed', label: 'Billed', num: true },
  { id: 'runs', label: 'Runs', num: true },
];

/**
 * The head every table on this page renders. Six call sites otherwise repeat
 * the same eight props, and the one that got them wrong would be the one whose
 * dividers quietly stopped saving.
 */
function ArrangedHead({ cols }) {
  return (
    <TableHead>
      {cols.columns.map(c => (
        <HeadCell
          key={c.id}
          num={c.num}
          width={c.width}
          onResize={w => cols.setWidth(c.id, w)}
        >
          {c.label}
        </HeadCell>
      ))}
    </TableHead>
  );
}

const PERIODS = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'ytd', label: 'YTD' },
];

const CURRENCIES = [
  { id: 'inr', label: '₹ INR' },
  { id: 'usd', label: '$ USD' },
];

const usd = (v, dp = 2) => `$${(Number(v) || 0).toFixed(dp)}`;
const count = v => (Number(v) || 0).toLocaleString('en-IN');
const pct = v => `${Math.round((Number(v) || 0) * 100)}%`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="adm-seg" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={value === o.id ? 'on' : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Platform ──────────────────────────────────────────────────────────────── */

function PlatformView({ period, currency }) {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => api
    .get(`/v1/admin/orgs/platform-analytics?period=${period}`)
    .then(r => { setData(r.data); setErr(null); })
    .catch(e => { setErr(e); pushToast({ type: 'error', title: 'Could not load platform analytics' }); }),
  [period, pushToast]);

  useEffect(() => { setData(null); load(); }, [load]);

  /* Above the `err` and `!data` returns: a first paint that is still loading
     must render the same hooks as the landed page or React throws. */
  const categoryCols = useColumnPrefs('admin.cost_by_category', CATEGORY_COLUMNS);
  const providerCols = useColumnPrefs('admin.cost_by_provider', PROVIDER_COLUMNS);
  const topOrgCols = useColumnPrefs('admin.cost_top_orgs', TOP_ORG_COLUMNS);

  if (err) return <ErrorState kind={errorKind(err)} grant="finance access to platform cost" onRetry={load} />;
  if (!data) return <SkeletonPage withStats withTable />;

  const fx = data.usd_to_inr;
  const markup = data.default_markup_pct ?? data.markup_pct;
  const money = currency === 'usd'
    ? { total: usd(data.total_cost?.usd), ai: usd(data.ai_cost?.usd), scr: usd(data.scraper_cost?.usd) }
    : { total: inr(data.total_cost?.inr, { decimals: 2 }), ai: inr(data.ai_cost?.inr, { decimals: 2 }), scr: inr(data.scraper_cost?.inr, { decimals: 2 }) };

  return (
    <div className="apg__sec">
      <div className="apg__grid">
        <StatTile label="Organisations" sanskrit="संस्थाएँ" value={count(data.total_orgs)} />
        <StatTile label="Users" sanskrit="सदस्य" value={count(data.total_users)} />
        <StatTile label="Usage revenue" value={inr(data.total_revenue_inr)} variant="ok" />
        <StatTile label="Aekam cost" value={inr(data.total_cost_inr)} />
        <StatTile label="AI calls" value={count(data.total_ai_calls)} />
      </div>

      <Card>
        <CardHead
          title="Margin"
          sanskrit="लाभ"
          actions={<span className="apg__secn">rate ₹{fx ? Number(fx).toFixed(2) : '—'}/USD · markup {pct(markup)}</span>}
        />
        <CardBody>
          {/* The one number the business runs on, with its working beside it. */}
          <MarginCell
            marginInr={data.margin_inr}
            costUsd={data.total_cost?.usd}
            fxRate={fx}
            markupPct={markup}
            chargedInr={data.total_cost?.charged_inr}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Cost by category"
          actions={(
            <>
              <span className="apg__secn">{money.total}</span>
              <ColumnsButton cols={categoryCols} />
            </>
          )}
        />
        <CardBody flush>
          <Table>
            <ArrangedHead cols={categoryCols} />
            <TableBody>
              {/* Three authored rows rather than a list, and they still go
                  through `cells()`: the Total row has to keep step with the two
                  above it, and a hand-ordered totals row under a rearranged
                  header is the exact way a money table comes to lie. */}
              <Row>
                {categoryCols.cells({
                  category: <Cell>AI services</Cell>,
                  cost: <Cell num>{money.ai}</Cell>,
                  charge: <Cell num>{inr(data.ai_cost?.charged_inr, { decimals: 2 })}</Cell>,
                })}
              </Row>
              <Row>
                {categoryCols.cells({
                  category: <Cell>Scraper and data</Cell>,
                  cost: <Cell num>{money.scr}</Cell>,
                  charge: <Cell num>{inr(data.scraper_cost?.charged_inr, { decimals: 2 })}</Cell>,
                })}
              </Row>
              <Row>
                {categoryCols.cells({
                  category: <Cell><b>Total</b></Cell>,
                  cost: <Cell num><b>{money.total}</b></Cell>,
                  charge: <Cell num><b>{inr(data.total_cost?.charged_inr, { decimals: 2 })}</b></Cell>,
                })}
              </Row>
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="By provider" actions={<ColumnsButton cols={providerCols} />} />
        <CardBody flush>
          {(data.ai_cost_by_provider || []).length === 0 ? (
            <EmptyState title={{ en: 'No AI usage in this period', hi: 'कोई उपयोग नहीं' }} description="Nothing has been metered yet in the selected window." />
          ) : (
            <Table>
              <ArrangedHead cols={providerCols} />
              <TableBody>
                {data.ai_cost_by_provider.map(r => (
                  <Row key={r.provider}>
                    {providerCols.cells({
                      provider: <Cell>{r.provider}</Cell>,
                      cost: <Cell num>{currency === 'usd' ? usd(r.cost_usd, 4) : inr(r.cost?.inr, { decimals: 2 })}</Cell>,
                      charged: <Cell num>{inr(r.cost?.charged_inr, { decimals: 2 })}</Cell>,
                      calls: <Cell num>{count(r.call_count)}</Cell>,
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Most profitable organisations"
          sanskrit="लाभप्रदता"
          actions={<ColumnsButton cols={topOrgCols} />}
        />
        <CardBody flush>
          {(data.top_orgs_by_spend || []).length === 0 ? (
            <EmptyState title={{ en: 'No spend in this period', hi: 'कोई व्यय नहीं' }} description="Per-org profitability appears once metered usage lands." />
          ) : (
            <Table>
              <ArrangedHead cols={topOrgCols} />
              <TableBody>
                {data.top_orgs_by_spend.map(r => (
                  <Row key={r.org_id || r.org_name}>
                    {topOrgCols.cells({
                      org: <Cell>{r.org_name}</Cell>,
                      markup: <Cell num>{pct(r.markup_pct)}</Cell>,
                      cost: <Cell num>{currency === 'usd' ? usd(r.total_cost_usd) : inr((Number(r.total_cost_usd) || 0) * (Number(fx) || 0), { decimals: 2 })}</Cell>,
                      charged: <Cell num>{inr(r.charged_inr, { decimals: 2 })}</Cell>,
                      margin: (
                        <Cell num>
                          <MarginCell
                            compact
                            marginInr={r.margin_inr}
                            costUsd={r.total_cost_usd}
                            fxRate={fx}
                            markupPct={r.markup_pct}
                            chargedInr={r.charged_inr}
                          />
                        </Cell>
                      ),
                    })}
                  </Row>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ── All orgs ──────────────────────────────────────────────────────────────── */

function OrgsView({ period, currency, fx, onSelect }) {
  const { pushToast } = useToast();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => api
    .get(`/v1/admin/orgs/cost-summary?period=${period}`)
    .then(r => { setRows(r.data?.data || r.data || []); setErr(null); })
    .catch(e => { setErr(e); pushToast({ type: 'error', title: 'Could not load the cost summary' }); }),
  [period, pushToast]);

  useEffect(() => { setRows(null); load(); }, [load]);

  /* `/cost-summary` returns cost and charge but no margin. It is derived here
     from the SAME rate the platform view reports, rather than from a second
     lookup that could resolve a minute later and disagree by a rupee. */
  const withMargin = useMemo(() => (rows || []).map(r => {
    const costInr = (Number(r.total_cost_usd) || 0) * (Number(fx) || 0);
    return { ...r, margin_inr: (Number(r.charged_inr) || 0) - costInr, cost_inr: costInr };
  }), [rows, fx]);

  // Above the three returns below — an empty cost summary must render the same
  // hooks as a populated one.
  const cols = useColumnPrefs('admin.cost_orgs', ORG_COST_COLUMNS);

  if (err) return <ErrorState kind={errorKind(err)} grant="finance access to platform cost" onRetry={load} />;
  if (!rows) return <SkeletonPage withTable />;
  if (rows.length === 0) {
    return <EmptyState title={{ en: 'No organisation has metered usage', hi: 'कोई उपयोग नहीं' }} description="Nothing has been billed against a provider in this window." />;
  }

  return (
    <>
      {/* This card carries no head, so the control gets the trailing action bar
          above it rather than being folded into a row the user is meant to
          click through to an org. */}
      <div className="tbl__abar">
        <ColumnsButton cols={cols} />
      </div>
      <Card>
        <CardBody flush>
          <Table className="adm-rows">
            <ArrangedHead cols={cols} />
            <TableBody>
              {withMargin.map(r => (
                <Row
                  key={r.org_id}
                  tabIndex={0}
                  onClick={() => onSelect(r)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } }}
                >
                  {cols.cells({
                    org: <Cell><b>{r.org_name}</b></Cell>,
                    plan: <Cell>{r.plan_name || 'Free'}</Cell>,
                    markup: <Cell num>{r.markup_pct != null ? pct(r.markup_pct) : '—'}</Cell>,
                    cost: <Cell num>{currency === 'usd' ? usd(r.total_cost_usd) : inr(r.cost_inr, { decimals: 2 })}</Cell>,
                    charged: <Cell num>{inr(r.charged_inr, { decimals: 2 })}</Cell>,
                    margin: (
                      <Cell num>
                        <MarginCell
                          compact
                          marginInr={r.margin_inr}
                          costUsd={r.total_cost_usd}
                          fxRate={fx}
                          markupPct={r.markup_pct}
                          chargedInr={r.charged_inr}
                        />
                      </Cell>
                    ),
                    calls: <Cell num>{count(r.ai_calls)}</Cell>,
                    last_active: <Cell>{fmtDate(r.last_active)}</Cell>,
                  })}
                </Row>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── One org ───────────────────────────────────────────────────────────────── */

function OrgView({ org, period, currency, onBack }) {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [dl, setDl] = useState(false);

  const load = useCallback(() => api
    .get(`/v1/admin/orgs/${org.org_id}/cost-breakdown?period=${period}`)
    .then(r => { setData(r.data); setErr(null); })
    .catch(e => { setErr(e); pushToast({ type: 'error', title: 'Could not load the breakdown' }); }),
  [org.org_id, period, pushToast]);

  useEffect(() => { setData(null); load(); }, [load]);

  const modelCols = useColumnPrefs('admin.cost_by_model', MODEL_COLUMNS);
  const scraperCols = useColumnPrefs('admin.cost_scrapers', SCRAPER_COLUMNS);

  const download = async () => {
    setDl(true);
    try {
      const res = await api.get(`/v1/admin/orgs/${org.org_id}/cost-report-pdf?period=${period}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CostReport-${org.org_name}-${period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      pushToast({ type: 'error', title: 'The report did not generate' });
    } finally { setDl(false); }
  };

  const trend = data?.daily_trend || [];
  const peak = Math.max(...trend.map(d => (d.ai_cost || 0) + (d.scraper_cost || 0)), 0.01);

  return (
    <div className="apg__sec">
      <div className="apg__tools">
        <Button variant="ghost" size="sm" onClick={onBack}>← All organisations</Button>
        <span className="apg__spacer" />
        <Button variant="out" size="sm" disabled={dl || !data} onClick={download}>
          {dl ? 'Generating…' : 'Download client report'}
        </Button>
      </div>

      <header className="apg__head">
        <div className="apg__titles">
          <h2 className="apg__t">{org.org_name}</h2>
          <p className="apg__lede">
            {/* The report the customer receives is the CHARGED column only. The
                cost and margin columns on this page are the ones 11 §1 forbids
                from reaching any tenant surface. */}
            Aekam cost and margin are on this screen only. The downloadable report shows
            the charged figures.
          </p>
        </div>
      </header>

      {err && <ErrorState kind={errorKind(err)} grant="finance access to platform cost" onRetry={load} />}
      {!err && !data && <SkeletonPage withStats withTable />}

      {!err && data && (
        <>
          <div className="apg__grid">
            <StatTile label="Credit balance" value={count(data.org_credits_balance)} />
            <StatTile label="Used this period" value={count(data.credits_used_period)} />
            <StatTile label="Monthly credits" value={count(data.monthly_credits)} />
            <StatTile label="Monthly price" value={inr(data.monthly_price)} />
          </div>

          <Card>
            <CardHead
              title="Margin"
              actions={<span className="apg__secn">rate ₹{data.usd_to_inr ? Number(data.usd_to_inr).toFixed(2) : '—'}/USD · markup {pct(data.markup_pct)}</span>}
            />
            <CardBody>
              <MarginCell
                marginInr={(Number(data.total?.charged_inr) || 0) - (Number(data.total?.inr) || 0)}
                costUsd={data.total?.usd}
                fxRate={data.usd_to_inr}
                markupPct={data.markup_pct}
                chargedInr={data.total?.charged_inr}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHead title="By model" actions={<ColumnsButton cols={modelCols} />} />
            <CardBody flush>
              {(data.ai_costs || []).length === 0 ? (
                <EmptyState title={{ en: 'No AI usage in this period', hi: 'कोई उपयोग नहीं' }} description="Per-model cost appears once a call is metered." />
              ) : (
                <Table>
                  <ArrangedHead cols={modelCols} />
                  <TableBody>
                    {data.ai_costs.map((r, i) => (
                      <Row key={`${r.provider}-${r.model}-${i}`}>
                        {modelCols.cells({
                          provider: <Cell>{r.provider}</Cell>,
                          model: <Cell><span className="adm-kv__v is-mono">{r.model}</span></Cell>,
                          cost: <Cell num>{currency === 'usd' ? usd(r.cost_usd, 4) : inr(r.cost?.inr, { decimals: 2 })}</Cell>,
                          charged: <Cell num>{inr(r.cost?.charged_inr, { decimals: 2 })}</Cell>,
                          calls: <Cell num>{count(r.call_count)}</Cell>,
                          tokens: <Cell num>{count(r.prompt_tokens)} / {count(r.completion_tokens)}</Cell>,
                        })}
                      </Row>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {(data.scraper_costs || []).length > 0 && (
            <Card>
              <CardHead title="Scrapers" actions={<ColumnsButton cols={scraperCols} />} />
              <CardBody flush>
                <Table>
                  <ArrangedHead cols={scraperCols} />
                  <TableBody>
                    {data.scraper_costs.map((r, i) => (
                      <Row key={`${r.scraper_id}-${i}`}>
                        {scraperCols.cells({
                          scraper: <Cell><span className="adm-kv__v is-mono">{r.scraper_id}</span></Cell>,
                          cost: <Cell num>{currency === 'usd' ? usd(r.cost_usd, 4) : inr(r.cost?.inr, { decimals: 2 })}</Cell>,
                          charged: <Cell num>{inr(r.cost?.charged_inr, { decimals: 2 })}</Cell>,
                          billed: <Cell num>{inr(r.billed_inr, { decimals: 2 })}</Cell>,
                          runs: <Cell num>{count(r.run_count)}</Cell>,
                        })}
                      </Row>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHead title="Daily trend" actions={<span className="apg__secn">{trend.length} days</span>} />
            <CardBody>
              {trend.length === 0 ? (
                <EmptyState title={{ en: 'No daily activity', hi: 'कोई गतिविधि नहीं' }} description="A trend needs at least one metered day." />
              ) : (
                <>
                  <div className="adm-trend">
                    {trend.map(d => {
                      const ai = ((d.ai_cost || 0) / peak) * 100;
                      const sc = ((d.scraper_cost || 0) / peak) * 100;
                      const label = new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                      return (
                        <div
                          className="adm-trend__c"
                          key={d.date}
                          title={`${label} · AI ${usd(d.ai_cost)} · scraper ${usd(d.scraper_cost)}`}
                        >
                          <span className="adm-trend__a" style={{ height: `${Math.max(ai, 1)}%` }} />
                          <span className="adm-trend__b" style={{ height: `${Math.max(sc, 0.5)}%` }} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="adm-legend">
                    <span><i className="adm-trend__a" />AI</span>
                    <span><i className="adm-trend__b" />Scraper</span>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function AdminCostDashboardPage() {
  const [period, setPeriod] = useState('30d');
  const [currency, setCurrency] = useState('inr');
  const [selected, setSelected] = useState(null);
  const [fx, setFx] = useState(null);

  const me = currentUser();
  const allowed = canSeeCost(me?.platform_roles);

  /* One rate for the whole screen, fetched once per period. Two views deriving
     margin from two lookups is how the same org shows two margins. */
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    api.get(`/v1/admin/orgs/platform-analytics?period=${period}`)
      .then(r => { if (live) setFx(r.data?.usd_to_inr ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [period, allowed]);

  const header = (
    <header className="apg__head">
      <div className="apg__titles">
        <h1 className="apg__t">
          Cost
          <Secondary className="apg__hi" value="लागत" />
        </h1>
        <p className="apg__lede">
          What Aekam pays, what the customer is charged, and the difference — with the
          rate and the markup that produced it.
        </p>
      </div>
      <div className="apg__acts">
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        <Segmented label="Currency" options={CURRENCIES} value={currency} onChange={setCurrency} />
      </div>
    </header>
  );

  /* The server guards /platform-analytics, /cost-summary and /provider-costs on
     ("platform_admin", "account_finance"). Saying so beats four spinners
     resolving into four 403 toasts. */
  if (!allowed) {
    return (
      <div className="apg">
        {header}
        <ErrorState kind="denied" grant="platform owner or account/finance access" />
      </div>
    );
  }

  return (
    <div className="apg">
      {header}

      {selected ? (
        <OrgView org={selected} period={period} currency={currency} onBack={() => setSelected(null)} />
      ) : (
        <Tabs
          tabs={[
            { value: 'platform', label: 'Platform', content: <PlatformView period={period} currency={currency} /> },
            {
              value: 'orgs',
              label: 'By organisation',
              content: <OrgsView period={period} currency={currency} fx={fx} onSelect={setSelected} />,
            },
          ]}
        />
      )}
    </div>
  );
}
