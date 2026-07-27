import React from 'react';
import { inr } from '../../lib/inr';
import { Shimmer } from '../editorial';

/**
 * KpiStrip — the shared module KPI row (13-module-pages.md §1).
 *
 * `items` is [{ label, value, delta?, money?, hi?, sub? }]. A `money` item is
 * formatted with Indian digit grouping; every value gets tabular-nums from
 * .mk__v so a column of figures stays aligned.
 *
 * `tone` is the reference's `kind` (`app.css:170-174`) — `p`, `ok`, `warn`,
 * `danger`. It tints the figure only, never the tile, so a row of five stays
 * one object. It is semantic, not decorative: overdue receivables in --danger
 * is the difference between a number and a number you have to act on. Colour is
 * never the only carrier — the caption under each figure says the same thing in
 * words, per 00 §12.
 *
 * `hi` and `sub` complete the reference's tile (`Data.jsx:18`, `Stat`): the
 * Devanagari sits at the trailing edge of the label row, and the caption under
 * the number is what makes the number mean something — "9 deals",
 * "target 28d", "GSTR-3B · 20 Aug". Without it a tile is a figure with no unit.
 *
 * `loading` and `error` belong to this component rather than to each caller on
 * purpose. Every page that fetched its own KPIs rendered the failure case as an
 * empty row, which reads as "your pipeline is worth nothing" rather than "this
 * did not load" — the most repeated defect on these pages. A strip that cannot
 * say it failed will eventually lie.
 */
export default function KpiStrip({ items, loading, error, count = 4 }) {
  if (loading) return <div className="mk-load"><Shimmer count={count} /></div>;
  if (error) {
    return (
      <div className="note note--warn mk-err" role="status">
        <b>These figures did not load.</b> {error}
      </div>
    );
  }
  if (!items?.length) return null;
  return (
    <div className="mk">
      {items.map(({ label, value, delta, money, hi, sub, tone }) => (
        <div className="mk__c" key={label}>
          <div className="mk__l">
            {label}
            {hi && <span className="mk__hi" lang="hi" aria-hidden="true">{hi}</span>}
          </div>
          <div className={`mk__v${tone ? ` mk__v--${tone}` : ''}`}>{money ? inr(value) : (value ?? '—')}</div>
          {delta != null && delta !== '' && (
            <div className={`mk__d ${Number(delta) < 0 ? 'mk__d--dn' : 'mk__d--up'}`}>
              {Number(delta) < 0 ? '▾' : '▴'} {Math.abs(Number(delta))}%
            </div>
          )}
          {sub && <div className="mk__s">{sub}</div>}
        </div>
      ))}
    </div>
  );
}
