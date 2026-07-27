// Ads — paid performance, pulled from connected social accounts.
//
// The single-file version read the axios RESPONSE where it wanted the body:
// `api.get('/v1/prachar/ads/overview').then(([ov]) => setOverview(ov))` set
// state to the axios object, so `overview?.total_spend` was undefined and every
// figure on the tab rendered `0` — on a screen whose entire purpose is to show
// how much money went where. `accounts`/`campaigns`/`insights` used
// `r.data || r`, which on a `{"data": […]}` body yields the wrapper again, so
// `.map` threw.
//
// It also refetched on every sub-view change with no cache and no error state,
// so switching Overview → Campaigns → Overview issued the same two calls again
// and a failure on any of them left an empty table that read as "no ad spend".
import React, { useState } from 'react';
import { Badge, DataTable, Td } from '../../components/editorial';
import { useToast } from '../../components/ui/toast';
import { inr } from '../../lib/inr';
import {
  api, rows, body, Panel, Bar, useResource, useMutate,
  CAMPAIGN_COLORS, humanise, plural, pct, fmtDate,
} from './_shared';

const VIEWS = [['overview', 'Overview'], ['campaigns', 'Campaigns'], ['insights', 'Insights'], ['analysis', 'AI analysis']];

export default function AdsTab() {
  const [view, setView] = useState('overview');

  return (
    <div>
      <Bar title="Ads" hi="विज्ञापन">
        <div className="seg" role="group" aria-label="Ads view">
          {VIEWS.map(([id, l]) => (
            <button
              key={id}
              type="button"
              className={`seg__b${view === id ? ' on' : ''}`}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {l}
            </button>
          ))}
        </div>
      </Bar>

      {view === 'overview' && <Overview />}
      {view === 'campaigns' && <AdCampaigns />}
      {view === 'insights' && <Insights />}
      {view === 'analysis' && <Analysis />}
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────── */

function Overview() {
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);

  // Two resources, not one Promise.all. The old version failed both if either
  // failed, so a broken accounts call blanked the spend figures too.
  const ov = useResource(() => api.get('/v1/prachar/ads/overview').then(body), []);
  const acc = useResource(() => api.get('/v1/prachar/ads/accounts').then(rows), []);

  const o = ov.data || {};
  const spend = Number(o.total_spend || 0);
  const impressions = Number(o.total_impressions || 0);
  const clicks = Number(o.total_clicks || 0);
  const conversions = Number(o.total_conversions || 0);

  const sync = async (id) => {
    const r = await go(
      () => api.post('/v1/prachar/ads/accounts/sync', { social_account_id: id }),
      'Sync started — figures update once the platform answers',
    );
    if (r.ok) { ov.reload(); acc.reload(); }
  };

  return (
    <>
      <Panel
        loading={ov.loading}
        error={ov.error}
        onRetry={ov.reload}
        empty={!ov.loading && !ov.error && spend === 0 && impressions === 0}
        emptyProps={{
          icon: '📊',
          title: 'No ad spend recorded',
          sub: 'Connect an ad account below and sync it. Spend, impressions and conversions appear here once the platform answers.',
        }}
        count={4}
      >
        <DataTable columns={['Measure', { label: 'Value', align: 'right' }, 'Read as']}>
          <tr>
            <td>Spend</td>
            <Td align="right" mono bold>{inr(spend)}</Td>
            <td className="pr__step-when">across {plural(Number(o.active_campaigns || 0), 'active campaign')}</td>
          </tr>
          <tr>
            <td>Impressions</td>
            <Td align="right" mono>{impressions.toLocaleString('en-IN')}</Td>
            <td className="pr__step-when">times an ad was shown</td>
          </tr>
          <tr>
            <td>Clicks</td>
            <Td align="right" mono>{clicks.toLocaleString('en-IN')}</Td>
            <td className="pr__step-when">{pct(clicks, impressions)} of impressions</td>
          </tr>
          <tr>
            <td>Conversions</td>
            <Td align="right" mono>{conversions.toLocaleString('en-IN')}</Td>
            <td className="pr__step-when">{pct(conversions, clicks)} of clicks</td>
          </tr>
          <tr>
            <td>Cost per click</td>
            <Td align="right" mono>{clicks ? inr(spend / clicks) : '—'}</Td>
            <td className="pr__step-when">{clicks ? 'spend ÷ clicks' : 'no clicks to divide by'}</td>
          </tr>
          <tr>
            <td>Cost per conversion</td>
            <Td align="right" mono>{conversions ? inr(spend / conversions) : '—'}</Td>
            <td className="pr__step-when">{conversions ? 'spend ÷ conversions' : 'no conversions yet'}</td>
          </tr>
        </DataTable>
      </Panel>

      <Bar title="Ad accounts" hi="खाते" />
      <Panel
        loading={acc.loading}
        error={acc.error}
        onRetry={acc.reload}
        empty={(acc.data || []).length === 0}
        emptyProps={{
          icon: '🔗',
          title: 'No ad accounts connected',
          sub: 'Connect a social account in settings, then sync it here to pull campaigns and spend.',
        }}
        count={2}
      >
        <DataTable columns={['Platform', 'Account', 'Last synced', '']}>
          {(acc.data || []).map((a) => (
            <tr key={a.id}>
              <Td bold>{humanise(a.platform) || 'Unknown'}</Td>
              <td className="pr__mono">{a.account_id || a.id}</td>
              <td>{a.last_synced_at ? fmtDate(a.last_synced_at) : 'Never'}</td>
              <td>
                <button
                  type="button"
                  className="k-btn k-btn--ghost k-btn--sm"
                  onClick={() => sync(a.social_account_id || a.id)}
                  disabled={busy}
                >
                  Sync
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}

/* ── Campaigns ────────────────────────────────────────────────────────── */

function AdCampaigns() {
  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/ads/campaigns').then(rows), [],
  );
  const list = data || [];

  return (
    <Panel
      loading={loading}
      error={error}
      onRetry={reload}
      empty={list.length === 0}
      emptyProps={{
        icon: '📣',
        title: 'No ad campaigns',
        sub: 'Sync a connected ad account and the campaigns it holds are listed here.',
      }}
      count={4}
    >
      <DataTable columns={['Name', 'Objective', 'Status', { label: 'Daily budget', align: 'right' }]}>
        {list.map((c) => (
          <tr key={c.id}>
            <Td bold>{c.name}</Td>
            <td>{humanise(c.objective)}</td>
            <td><Badge text={humanise(c.status)} color={CAMPAIGN_COLORS[c.status] || 'var(--on-surface-3)'} /></td>
            <Td align="right" mono>{c.daily_budget ? inr(c.daily_budget) : '—'}</Td>
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}

/* ── Insights ─────────────────────────────────────────────────────────── */

function Insights() {
  const { data, loading, error, reload } = useResource(
    () => api.get('/v1/prachar/ads/insights').then(rows), [],
  );
  const list = data || [];

  return (
    <Panel
      loading={loading}
      error={error}
      onRetry={reload}
      empty={list.length === 0}
      emptyProps={{
        icon: '📈',
        title: 'No performance rows yet',
        sub: 'Insights are per campaign per day. Run a sync and they appear here.',
      }}
      count={4}
    >
      <DataTable columns={[
        'Campaign', 'Date',
        { label: 'Spend', align: 'right' },
        { label: 'Impressions', align: 'right' },
        { label: 'Clicks', align: 'right' },
        { label: 'Conversions', align: 'right' },
        { label: 'CTR', align: 'right' },
        { label: 'CPC', align: 'right' },
      ]}>
        {list.map((r, i) => (
          <tr key={r.id || `${r.campaign_name}-${r.date}-${i}`}>
            <Td bold>{r.campaign_name}</Td>
            <td>{fmtDate(r.date)}</td>
            <Td align="right" mono>{inr(Number(r.spend || 0))}</Td>
            <Td align="right" mono>{Number(r.impressions || 0).toLocaleString('en-IN')}</Td>
            <Td align="right" mono>{Number(r.clicks || 0).toLocaleString('en-IN')}</Td>
            <Td align="right" mono>{Number(r.conversions || 0)}</Td>
            <Td align="right" mono>{Number(r.ctr || 0).toFixed(2)}%</Td>
            <Td align="right" mono>{r.cpc ? inr(Number(r.cpc)) : '—'}</Td>
          </tr>
        ))}
      </DataTable>
    </Panel>
  );
}

/* ── AI analysis ──────────────────────────────────────────────────────── */

function Analysis() {
  const { pushToast } = useToast();
  const { busy, go } = useMutate(pushToast);
  const [brief, setBrief] = useState('');
  const [out, setOut] = useState('');

  const run = async () => {
    if (!brief.trim()) return pushToast({ type: 'error', title: 'Say what you want analysed.' });
    const r = await go(() => api.post('/v1/prachar/ads/analyse', { brief: brief.trim() }).then(body), null);
    // The route's response key is not guaranteed, so the fallback is the whole
    // body rather than an empty panel that looks like a successful no-op.
    if (r.ok) setOut(r.out?.analysis || r.out?.result || JSON.stringify(r.out, null, 2));
    return undefined;
  };

  return (
    <>
      <div className="pr__inline">
        <input
          className="k-formpanel__input pr__grow"
          placeholder="e.g. Which campaign wasted the most spend last month?"
          aria-label="Analysis brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
        />
        <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={run} disabled={busy}>
          {busy ? 'Analysing…' : 'Analyse'}
        </button>
      </div>

      {busy && <p className="pr__step-when">Reading your ad insights and writing an answer. This takes a few seconds.</p>}
      {!busy && !out && (
        <p className="pr__step-when">
          The answer is written from the insight rows on the previous tab — if a sync has not run, there is nothing to read.
        </p>
      )}
      {out && <pre className="pr__pre">{out}</pre>}
    </>
  );
}
