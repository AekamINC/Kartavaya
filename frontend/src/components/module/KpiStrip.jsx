import React from 'react';
import { inr } from '../../lib/inr';

/**
 * KpiStrip — the shared module KPI row (13-module-pages.md §1).
 *
 * `items` is [{ label, value, delta?, money? }]. A `money` item is formatted
 * with Indian digit grouping; every value gets tabular-nums from .mk__v so a
 * column of figures stays aligned.
 */
export default function KpiStrip({ items }) {
  if (!items?.length) return null;
  return (
    <div className="mk">
      {items.map(({ label, value, delta, money }) => (
        <div className="mk__c" key={label}>
          <div className="mk__l">{label}</div>
          <div className="mk__v">{money ? inr(value) : (value ?? '—')}</div>
          {delta != null && delta !== '' && (
            <div className={`mk__d ${Number(delta) < 0 ? 'mk__d--dn' : 'mk__d--up'}`}>
              {Number(delta) < 0 ? '▾' : '▴'} {Math.abs(Number(delta))}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
