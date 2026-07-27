import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/editorial';
import { SkeletonText } from '../../components/ui/Skeleton';
import { errorKind } from '../../components/ui/ErrorState';
import { api } from '../../lib/api';
import { inrShort } from '../../lib/inr';

/**
 * Cash position — the second card in the reference dashboard's left column
 * (`ScreensCore.jsx::ScreenDash`, `Card title="Cash position" hi="नकदी"`): twelve
 * stacked bars, a `30d` / `Quarter` toggle, and an Inflow / Outflow / Net footer.
 *
 * The build had nothing equivalent. It also had no endpoint to build it from, so
 * `GET /api/v1/ganit/cash-position` is new (`backend/routers/ganit.py`) and reads
 * money that actually MOVED — `ganit_payments` in, `ganit_expenses` plus
 * `ganit_vendor_payments` out. Invoices and unpaid vendor bills are excluded on
 * purpose: a card called "cash position" that counted invoiced-but-unpaid money
 * would tell a receivables-heavy firm it is liquid when it is not.
 *
 * GATED THE SAME WAY `ReceivablesKPI` IS, and for the same reason: there is no
 * client-side module/grant registry in this bundle, so the only honest gate is
 * the server's. A 403 or 404 renders NOTHING — a member without a Ganit grant
 * must not learn the org's cash position from an error message on their home
 * screen. A 5xx or a network failure DOES render, because that is a fault the
 * reader should see rather than a permission they lack.
 */

const RANGES = [
  { id: '30d',     label: '30d' },
  { id: 'quarter', label: 'Quarter' },
];

export default function CashPosition() {
  const [range,   setRange]   = useState('30d');
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  /** A grant failure hides the card for good; it is not a retryable error. */
  const [hidden,  setHidden]  = useState(false);

  const load = useCallback(signal => {
    setLoading(true);
    setError(null);
    api.get('/v1/ganit/cash-position', { params: { range }, signal })
      .then(r => setData(r.data))
      .catch(err => {
        if (err?.code === 'ERR_CANCELED') return;
        const kind = errorKind(err);
        if (kind === 'denied' || kind === 'missing') { setHidden(true); return; }
        setError(err);
      })
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (hidden) return null;

  const series = Array.isArray(data?.series) ? data.series : [];
  // One denominator for both directions, so a tall outflow bar means more money
  // than a short inflow bar. Scaling each independently is the commonest way a
  // two-series bar chart ends up lying.
  const peak = series.reduce((m, b) => Math.max(m, b.inflow + b.outflow), 0);
  const moved = peak > 0;

  const toggle = (
    <div className="k-cash__seg" role="group" aria-label="Range">
      {RANGES.map(r => (
        <button
          key={r.id}
          type="button"
          className={'k-cash__segbtn' + (range === r.id ? ' is-active' : '')}
          aria-pressed={range === r.id}
          onClick={() => setRange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  return (
    <Card title="Cash position" sanskrit="नकदी" right={toggle}>
      {loading && !data ? (
        <div className="k-cash" aria-busy="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="k-cash__col">
              <SkeletonText width="100%" height={40 + ((i * 13) % 55)} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="k-cash__failed" role="alert">
          <p className="k-today__quiet">
            {errorKind(error) === 'offline'
              ? 'We could not reach the server, so this is not a picture of your cash.'
              : 'Cash position did not load. The figures below are missing, not zero.'}
          </p>
          <button className="k-link" onClick={() => load()}>Try again</button>
        </div>
      ) : !moved ? (
        <p className="k-today__quiet">
          No payments in or out in this window.
        </p>
      ) : (
        <>
          <div
            className="k-cash"
            role="img"
            aria-label={`Cash over the ${range === '30d' ? 'last 30 days' : 'last quarter'}: `
              + `${inrShort(data.inflow)} in, ${inrShort(data.outflow)} out, net ${inrShort(data.net)}`}
          >
            {series.map((b, i) => (
              <div key={b.start} className="k-cash__col" title={`${b.start} · in ${inrShort(b.inflow)} · out ${inrShort(b.outflow)}`}>
                <div
                  className={'k-cash__in' + (i === series.length - 1 ? ' is-current' : '')}
                  style={{ height: `${(b.inflow / peak) * 100}%` }}
                />
                <div
                  className="k-cash__out"
                  style={{ height: `${(b.outflow / peak) * 100}%` }}
                />
              </div>
            ))}
          </div>

          <div className="k-cash__legend">
            <span className="k-cash__key">
              <i className="k-cash__dot k-cash__dot--in" /> Inflow
              <b className="k-cash__num">{inrShort(data.inflow)}</b>
            </span>
            <span className="k-cash__key">
              <i className="k-cash__dot k-cash__dot--out" /> Outflow
              <b className="k-cash__num">{inrShort(data.outflow)}</b>
            </span>
            <span className="k-cash__key k-cash__key--net">
              Net
              <b className={'k-cash__num' + (data.net < 0 ? ' k-cash__num--down' : ' k-cash__num--up')}>
                {data.net >= 0 ? '+' : ''}{inrShort(data.net)}
              </b>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
