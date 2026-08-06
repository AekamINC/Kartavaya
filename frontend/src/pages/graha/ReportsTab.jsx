// Graha · reports — conversion, forecast, velocity, sources, reps.
//
// 51 inline styles are now `gr__*` classes.
//
// ── The defect this tab had ────────────────────────────────────────────────
// The whole load was `.catch(() => {})`. Every panel below is rendered behind a
// truthiness check on its own state, so a failed fetch left all five null and
// the tab painted the period buttons over an empty page — no message, no retry,
// nothing to distinguish "these reports failed" from "this org has no deals".
// On a revenue screen that is not a blank state, it is a wrong answer about the
// business. The four core reports now share one error state with a retry.
//
// `rep-performance` keeps its own soft catch on purpose: it is the one report
// that can 403 for a non-admin, and a member who cannot see per-rep numbers
// should still get the other four rather than an error page.
import React, { useState, useEffect, useCallback } from 'react';
import { api, body } from '../../lib/api';
import { StatTile } from '../../components/editorial';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../lib/utils';
import { Badge, stageColor, SOURCE_COLORS } from './_shared';

export default function ReportsTab() {
  const [conversion, setConversion] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [sources, setSources] = useState(null);
  const [reps, setReps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState(90);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      api.get(`/v1/graha/reports/conversion?days=${days}`),
      api.get('/v1/graha/reports/forecast'),
      api.get(`/v1/graha/reports/pipeline-velocity?days=${days}`),
      api.get(`/v1/graha/reports/source-analysis?days=${days}`),
      api.get(`/v1/graha/reports/rep-performance?days=${days}`).catch(() => null),
    ]).then(([c, f, v, s, r]) => {
      setConversion(body(c));
      setForecast(body(f));
      setVelocity(body(v));
      setSources(body(s));
      setReps(r ? body(r) : null);
    }).catch(e => {
      setErr(e);
      setConversion(null); setForecast(null); setVelocity(null); setSources(null); setReps(null);
    }).finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const fmt = v => (v != null ? formatINR(v) : '—');

  const period = (
    <div className="gr__rperiod">
      <span className="gr__rperiod-l">Period:</span>
      {[30, 60, 90, 180].map(d => (
        <button
          key={d}
          className={`k-btn ${days === d ? 'k-btn--primary' : 'k-btn--ghost'}`}
          aria-pressed={days === d}
          onClick={() => setDays(d)}
        >{d}d</button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div>
        {period}
        <SkeletonRegion label="Loading reports"><SkeletonList rows={6} /></SkeletonRegion>
      </div>
    );
  }

  if (err) {
    return (
      <div>
        {period}
        <ErrorState kind={errorKind(err)} onRetry={load} />
      </div>
    );
  }

  const hasAny = conversion?.total_deals > 0 || forecast?.stages?.length > 0
    || velocity?.data?.length > 0 || sources?.data?.length > 0;

  return (
    <div>
      {period}

      {!hasAny ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'Nothing to report yet', hi: 'अभी कोई रिपोर्ट नहीं' }}
          description={`No deals were opened or closed in the last ${days} days. Reports fill in as your pipeline moves.`}
        />
      ) : (<>
        {conversion && (
          <div className="gr__rtiles">
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
          <div className="gr__rcard">
            <h4 className="gr__rt">Revenue Forecast</h4>
            <div className="gr__rbig">
              <div>
                <div className="gr__rl">Pipeline</div>
                <div className="gr__rv">{fmt(forecast.total_pipeline)}</div>
              </div>
              <div>
                <div className="gr__rl">Weighted</div>
                <div className="gr__rv gr__rv--ok">{fmt(forecast.weighted_forecast)}</div>
              </div>
            </div>
            {forecast.stages?.map(s => (
              <div key={s.stage} className="gr__rrow">
                <Badge text={s.stage} color={stageColor(s.stage)} />
                <span className="gr__spacer" />
                <span className="gr__rn">{s.count} deals</span>
                <span className="gr__rsum">{fmt(s.total_value)}</span>
                <span className="gr__rw">≈ {fmt(s.weighted_value)}</span>
              </div>
            ))}
          </div>
        )}

        {velocity?.data?.length > 0 && (
          <div className="gr__rcard">
            <h4 className="gr__rt">Pipeline Velocity</h4>
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>{['Stage', 'Count', 'Total Value', 'Avg Value', 'Avg Days'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {velocity.data.map(r => (
                    <tr key={r.stage}>
                      <td><Badge text={r.stage} color={stageColor(r.stage)} /></td>
                      <td>{r.count}</td>
                      <td>{fmt(r.total_value)}</td>
                      <td>{fmt(r.avg_value)}</td>
                      <td>{r.avg_days_in_stage ?? '—'}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sources?.data?.length > 0 && (
          <div className="gr__rcard">
            <h4 className="gr__rt">Lead Source Analysis</h4>
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>{['Source', 'Leads', 'Deals', 'Won', 'Won Value'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sources.data.map(r => (
                    <tr key={r.source}>
                      <td><Badge text={r.source} color={SOURCE_COLORS[r.source] || 'var(--on-surface-3)'} /></td>
                      <td>{r.leads}</td>
                      <td>{r.deals}</td>
                      <td>{r.won}</td>
                      <td>{fmt(r.won_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reps?.data?.length > 0 && (
          <div className="gr__rcard">
            <h4 className="gr__rt">Rep Performance</h4>
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>{['Rep', 'Total', 'Won', 'Lost', 'Won Value', 'Avg Deal'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {reps.data.map(r => (
                    <tr key={r.assigned_to}>
                      <td className="gr__td--id">{r.assigned_to?.slice(0, 12) || '—'}</td>
                      <td>{r.total_deals}</td>
                      <td className="gr__td--ok">{r.won}</td>
                      <td className="gr__td--bad">{r.lost}</td>
                      <td>{fmt(r.won_value)}</td>
                      <td>{fmt(r.avg_deal_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}
