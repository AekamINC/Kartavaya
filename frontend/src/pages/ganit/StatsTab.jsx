// Ganit · stats — the figures behind the ledger.
//
// Was five tiles and `if (!stats) return null`, so a failed fetch rendered an
// EMPTY PANEL: no figures, no error, nothing to retry. On a finance screen that
// reads as "your books are empty".
//
// It now carries the whole page the reference implies — the invoice totals AND
// the money that actually moved — because both endpoints already exist and are
// already gated. `/cash-position` is deliberately paired with `/stats` here:
// `/stats` counts what has been INVOICED, `/cash-position` counts what has been
// RECEIVED and SPENT, and a receivables-heavy business reading only the first
// number is the specific mistake that endpoint's docstring warns about.
import React, { useCallback, useEffect, useState } from 'react';
import { api, body } from '../../lib/api';
import { StatTile } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonCardGrid, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr, inrShort } from '../../lib/inr';

/** `2026-07-14` → `14 Jul`. A raw ISO date in a 60px column identifies nothing. */
function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function StatsTab() {
  const [stats, setStats] = useState(null);
  const [cash, setCash] = useState(null);
  const [err, setErr] = useState(null);
  const [cashErr, setCashErr] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    setCashErr(false);
    setLoading(true);
    // Two endpoints, settled independently. The invoice totals are the panel's
    // subject, so their failure is the panel's error; the cash chart is a
    // second reading and its failure says so in place of the chart rather than
    // taking the figures down with it.
    const [s, c] = await Promise.allSettled([
      api.get('/v1/ganit/stats'),
      api.get('/v1/ganit/cash-position', { params: { range: '30d' } }),
    ]);
    if (s.status === 'fulfilled') setStats(body(s.value));
    else { setErr(s.reason); setStats(null); }
    if (c.status === 'fulfilled') setCash(body(c.value));
    else { setCash(null); setCashErr(true); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SkeletonRegion label="Loading finance figures">
        <SkeletonCardGrid count={5} columns={5} lines={2} />
      </SkeletonRegion>
    );
  }
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;
  if (!stats) return <ErrorState kind="server" onRetry={load} />;

  const series = Array.isArray(cash?.series) ? cash.series : [];
  const peak = series.reduce((m, b) => Math.max(m, b.inflow || 0, b.outflow || 0), 0);
  const pct = v => (peak > 0 ? `${Math.round((v / peak) * 100)}%` : '0%');

  return (
    <div>
      <div className="gn-stats">
        <StatTile label="Total invoices" sanskrit="बीजक" value={stats.total_invoices} />
        <StatTile label="Outstanding" sanskrit="बकाया" value={inr(Number(stats.total_outstanding))} variant="warn" />
        <StatTile label="Collected" sanskrit="प्राप्त" value={inr(Number(stats.total_collected))} variant="ok" />
        <StatTile label="Unpaid" value={stats.unpaid_count} />
        <StatTile
          label="Overdue"
          value={stats.overdue_count}
          variant={Number(stats.overdue_count) > 0 ? 'danger' : 'neutral'}
          /* 43B(h) disallows the deduction when an MSME supplier is paid late,
             so an overdue count is a tax exposure here, not a chasing list. */
          sub={Number(stats.overdue_count) > 0 ? 'MSME rule 43B(h) applies' : 'nothing past due'}
        />
      </div>

      <div className="gn-panel">
        <div className="gn-panel__head">
          <h3 className="gn-panel__h">Cash position<span className="dr__lbl-hi" lang="hi">रोकड़</span></h3>
          {cash && (
            <span className="gn-facts__v">
              In {inrShort(cash.inflow)} · Out {inrShort(cash.outflow)} · Net {inrShort(cash.net)}
            </span>
          )}
        </div>

        {cashErr ? (
          // Named as a gap, not drawn as a flat line. A chart of zeros is a
          // claim that no money moved.
          <p className="dchart__err">The cash chart could not be loaded. The invoice figures above are unaffected.</p>
        ) : series.length === 0 ? (
          <p className="dchart__err">No payments or expenses fall in the last 30 days.</p>
        ) : (
          <>
            <div className="dbars">
              {series.map((b, n) => (
                <div className="dbars__c" key={b.start}>
                  <span className="dbars__v">{inrShort(b.inflow)}</span>
                  <span className="dbars__t">
                    <span
                      className={`dbars__b${n === series.length - 1 ? ' dbars__b--now' : ''}`}
                      style={{ '--h': pct(b.inflow) }}
                    />
                  </span>
                  <span className="dbars__x" title={b.start}>{dayLabel(b.start)}</span>
                </div>
              ))}
            </div>
            <p className="gn-est__note">
              Money received, not invoiced — an unpaid invoice is not cash.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
