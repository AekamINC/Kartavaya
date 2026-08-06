// Vikray · pipeline — where the money is sitting, and what it is waiting on.
//
// ── Why this tab exists ───────────────────────────────────────────────────
// `design-reference/Kartavaya Redesign/Data.jsx:125` lists six Vikray tabs and
// this is one of them; `ScreenVikray` (`ScreensBiz.jsx:142`) OPENS the module on
// it. It was dropped from the build on the reading that pipeline belongs to
// Graha. That reading is wrong: Graha's pipeline is a CRM deal board, and the
// one drawn here is `FLOW = ['Quote','Sent','Signed','Invoiced','Paid']` over
// `QUOTES` — a sales document moving to cash, which is this module's object and
// no other's. `Data.jsx:119` also records the tab set as "lifted from staging
// pages — nothing dropped", and `TAB_HI` carries प्रवाह for it. It is specified.
//
// ── What it shows that the other tabs do not ──────────────────────────────
// Dashboard answers "what needs me" — a status COUNT that jumps to the Orders
// tab, plus the stalled list. Orders is the list and its CRUD. Neither answers
// "how much is in each stage", which is the question a sales lead opens a
// pipeline for, and which is the one the reference's five-segment bar draws.
// So the board here is VALUE per stage, it stays on this tab rather than
// navigating away, and it includes `closed` — money that has landed is part of
// the shape of the funnel even though nothing is pending on it.
//
// The rows are `OrderRows`, the same component the Dashboard and Orders tabs
// render, so the three can never disagree about what an order looks like.
//
// ── Three states, not two ─────────────────────────────────────────────────
// A failed request must never reach the empty branch. "No orders in the
// pipeline" printed over a 500 is not a blank screen, it is a false statement
// about the customer's order book — and on the tab whose entire purpose is
// showing money in flight, it is the most expensive false statement in the
// module. `data` stays `null` until a load SUCCEEDS; `err` is its own state.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inrShort } from '../../lib/inr';
import { ORDER_LABELS, orderColor } from '../../lib/statusColors';
import OrderRows from './OrderRows';
import { Secondary } from '../../components/Bilingual';

export default function PipelineTab({ onOpenOrder }) {
  const [orders, setOrders] = useState(null);   // null until a load succeeds
  const [stages, setStages] = useState(null);
  const [err, setErr] = useState(null);
  const [stage, setStage] = useState('');       // '' = every stage

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get('/v1/vikray/pipeline');
      setOrders(rows(r));
      setStages(Array.isArray(r.data?.stages) ? r.data.stages : []);
    } catch (e) {
      // Both cleared, so no stale board survives beside an error.
      setErr(e);
      setOrders(null);
      setStages(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = stage ? (orders || []).filter(o => o.status === stage) : (orders || []);
  const live = (stages || []).filter(s => s.stage !== 'closed');
  const openValue = live.reduce((n, s) => n + (Number(s.value) || 0), 0);
  const openCount = live.reduce((n, s) => n + (Number(s.count) || 0), 0);

  if (err) {
    return (
      <div className="vk-pl">
        <ErrorState kind={errorKind(err)} onRetry={load} />
      </div>
    );
  }

  if (!orders || !stages) {
    return (
      <div className="vk-pl">
        <SkeletonRegion label="Loading the pipeline">
          <SkeletonList rows={6} showAvatar={false} />
        </SkeletonRegion>
      </div>
    );
  }

  return (
    <div className="vk-pl">
      <p className="vk-pl__lede">
        Every order on its way to cash. <b>{inrShort(openValue)}</b> across {openCount}
        {openCount === 1 ? ' order' : ' orders'} has not closed yet.
      </p>

      {/* The board. Each stage is a filter for the list below rather than a
          link off the tab — the question "how much is in Dispatched" and the
          question "which ones" are the same question, asked half a second
          apart. `--c` is a custom property feeding a rule in vikray.css; the
          colour itself never reaches the markup. */}
      <div className="vk-pl__board" role="group" aria-label="Filter by stage">
        <button
          type="button"
          className={`vk-pl__st${stage === '' ? ' is-on' : ''}`}
          aria-pressed={stage === ''}
          onClick={() => setStage('')}
        >
          <span className="vk-pl__stn">{orders.length}</span>
          <span className="vk-pl__stl">All stages</span>
          <span className="vk-pl__stv">{inrShort(stages.reduce((n, s) => n + (Number(s.value) || 0), 0))}</span>
        </button>

        {stages.map(s => (
          <button
            key={s.stage}
            type="button"
            className={`vk-pl__st${stage === s.stage ? ' is-on' : ''}`}
            style={{ '--c': orderColor(s.stage) }}
            aria-pressed={stage === s.stage}
            onClick={() => setStage(stage === s.stage ? '' : s.stage)}
          >
            <span className="vk-pl__stn">{s.count}</span>
            <span className="vk-pl__stl">{ORDER_LABELS[s.stage] || s.stage}</span>
            <span className="vk-pl__stv">{inrShort(s.value)}</span>
          </button>
        ))}
      </div>

      <section className="card vk-card">
        <header className="card__head">
          <div className="card__titles">
            <h3 className="card__title">
              {stage ? `${ORDER_LABELS[stage] || stage} orders` : 'Order to cash'}
            </h3>
            <Secondary className="card__hi" value="आदेश से भुगतान" />
          </div>
          {stage && (
            <button type="button" className="btn btn--text btn--sm" onClick={() => setStage('')}>
              Show all
            </button>
          )}
        </header>
        <div className="card__body card__body--flush">
          {orders.length === 0 ? (
            <Empty
              icon="invoice"
              title="No orders in the pipeline"
              sub="Once an order is raised it appears here and moves along the line as it is confirmed, dispatched, delivered and closed."
            />
          ) : shown.length === 0 ? (
            <Empty
              icon="invoice"
              title={`Nothing is at ${(ORDER_LABELS[stage] || stage).toLowerCase()}`}
              sub="No order is sitting at this stage right now."
              cta="Show every stage"
              onCta={() => setStage('')}
            />
          ) : (
            <OrderRows orders={shown} onOpen={onOpenOrder} />
          )}
        </div>
      </section>
    </div>
  );
}
