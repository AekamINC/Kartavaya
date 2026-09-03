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
import { inrShort } from '../../lib/inr';
import { Badge, stageColor, SOURCE_COLORS } from './_shared';
import { useDocumentDownload } from '../../lib/documents';
import { HeadCell } from '../../components/ui/Table';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * Three tables on this tab, three keys — never `graha.reports_1..3`. They are
 * three different reports that happen to share a card stack, and a key is a
 * database row identity for ever: a positional name would silently re-point at
 * a different report the day the cards are reordered.
 *
 * None of the three is sortable (each is a server-ordered report), so no column
 * carries a `sortKey`; the arrangement is order, visibility and width only, and
 * none has an actions column because a report row has no verbs. The first
 * column of each is `fixed` — Stage, Source and Rep are the dimension the whole
 * row's numbers are ABOUT, and a table of figures with the dimension hidden is
 * not a shorter report, it is an unreadable one.
 */
const VELOCITY_COLUMNS = [
  { id: 'stage', label: 'Stage', fixed: true },
  { id: 'count', label: 'Count' },
  { id: 'total_value', label: 'Total Value' },
  { id: 'avg_value', label: 'Avg Value' },
  { id: 'avg_days_in_stage', label: 'Avg Days' },
];

const SOURCE_COLUMNS = [
  { id: 'source', label: 'Source', fixed: true },
  { id: 'leads', label: 'Leads' },
  { id: 'deals', label: 'Deals' },
  { id: 'won', label: 'Won' },
  { id: 'won_value', label: 'Won Value' },
];

const REP_COLUMNS = [
  { id: 'assigned_to', label: 'Rep', fixed: true },
  { id: 'total_deals', label: 'Total' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'won_value', label: 'Won Value' },
  { id: 'avg_deal_value', label: 'Avg Deal' },
];

export default function ReportsTab() {
  const [conversion, setConversion] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [sources, setSources] = useState(null);
  const [reps, setReps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [days, setDays] = useState(90);
  /* The five reports were computed and could not leave the screen. The download
     obeys the period selected above — a file that ignores the filters on screen
     is a bug report waiting to happen. Rep performance is admin-only, and the
     server simply omits that section rather than refusing the whole file. */
  const { busy, error: dlError, run: download, clear: clearDl } = useDocumentDownload();

  // ABOVE the loading and error returns below — this component returns early
  // twice, and a render that called three fewer hooks than the loaded one is
  // the "rendered fewer hooks than expected" crash.
  const velCols = useColumnPrefs('graha.reports_velocity', VELOCITY_COLUMNS);
  const srcCols = useColumnPrefs('graha.reports_sources', SOURCE_COLUMNS);
  const repCols = useColumnPrefs('graha.reports_reps', REP_COLUMNS);

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

  const fmt = v => (v != null ? inrShort(v) : '—');

  const grab = (format) => download(format, {
    url: '/v1/graha/reports/download',
    params: { days, fmt: format },
    fallback: 'Could not generate the report',
  });

  const period = (
    <div>
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
        <span className="gr__spacer" />
        <span className="gr__rperiod-l">Download:</span>
        {[['pdf', 'PDF'], ['excel', 'Excel'], ['csv', 'CSV']].map(([f, label]) => (
          <button
            key={f}
            className="k-btn k-btn--ghost"
            disabled={!!busy}
            onClick={() => grab(f)}
          >{busy === f ? 'Generating…' : label}</button>
        ))}
      </div>
      {dlError && (
        <div className="note note--warn" role="status">
          {dlError.message}
          {' '}
          <button type="button" className="k-btn k-btn--ghost" onClick={clearDl}>Dismiss</button>
        </div>
      )}
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
            {/* Two cohorts, and the captions say which. `total_deals`,
                `cohort_won`, `cohort_lost`, `open` and the win rate count
                deals OPENED in the window; `won`, `lost`, `won_value` and the
                cycle count deals CLOSED in it, on `won_at`/`lost_at`. They are
                different deals, and "Won" over a figure windowed on the
                creation date was 39% short on a real org (proposal 73, #5).
                The server sends `basis` naming both halves. */}
            <StatTile label="Opened in period" value={conversion.total_deals} />
            <StatTile label="Won in period" value={conversion.won} />
            <StatTile label="Lost in period" value={conversion.lost} />
            <StatTile label="Opened & still open" value={conversion.open} />
            <StatTile label="Win rate of opened" value={`${conversion.conversion_rate}%`} />
            <StatTile label="Won value in period" value={fmt(conversion.won_value)} />
            <StatTile label="Avg cycle to win" value={`${conversion.avg_cycle_days}d`} />
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
            {/* These cards carry no TableToolbar, so the control gets the
                house trailing-aligned unframed row — an edge above the table
                would read as a second card header. */}
            <div className="tbl__abar"><ColumnsButton cols={velCols} /></div>
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {velCols.columns.map(c => (
                      <HeadCell key={c.id} width={c.width} onResize={w => velCols.setWidth(c.id, w)}>
                        {c.label}
                      </HeadCell>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {velocity.data.map(r => (
                    <tr key={r.stage}>
                      {velCols.cells({
                        stage: <td><Badge text={r.stage} color={stageColor(r.stage)} /></td>,
                        count: <td>{r.count}</td>,
                        total_value: <td>{fmt(r.total_value)}</td>,
                        avg_value: <td>{fmt(r.avg_value)}</td>,
                        avg_days_in_stage: <td>{r.avg_days_in_stage ?? '—'}d</td>,
                      })}
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
            <div className="tbl__abar"><ColumnsButton cols={srcCols} /></div>
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {srcCols.columns.map(c => (
                      <HeadCell key={c.id} width={c.width} onResize={w => srcCols.setWidth(c.id, w)}>
                        {c.label}
                      </HeadCell>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sources.data.map(r => (
                    <tr key={r.source}>
                      {srcCols.cells({
                        source: <td><Badge text={r.source} color={SOURCE_COLORS[r.source] || 'var(--on-surface-3)'} /></td>,
                        leads: <td>{r.leads}</td>,
                        deals: <td>{r.deals}</td>,
                        won: <td>{r.won}</td>,
                        won_value: <td>{fmt(r.won_value)}</td>,
                      })}
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
            <div className="tbl__abar"><ColumnsButton cols={repCols} /></div>
            <div className="tbl__wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {repCols.columns.map(c => (
                      <HeadCell key={c.id} width={c.width} onResize={w => repCols.setWidth(c.id, w)}>
                        {c.label}
                      </HeadCell>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reps.data.map(r => (
                    <tr key={r.assigned_to}>
                      {repCols.cells({
                        /* Twelve characters of a `users.user_id` until
                           2026-08-27, on the one report whose whole point is
                           that "these figures sit against a person" — the
                           endpoint's own words. `services/crm_report.py` had
                           joined `users` for the DOWNLOADABLE version of this
                           same report since it was written, so the file a
                           customer sends to their partner carried names while
                           the screen they read it off did not. */
                        assigned_to: <td>{r.assigned_to_name || '—'}</td>,
                        total_deals: <td>{r.total_deals}</td>,
                        won: <td className="gr__td--ok">{r.won}</td>,
                        lost: <td className="gr__td--bad">{r.lost}</td>,
                        won_value: <td>{fmt(r.won_value)}</td>,
                        avg_deal_value: <td>{fmt(r.avg_deal_value)}</td>,
                      })}
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
