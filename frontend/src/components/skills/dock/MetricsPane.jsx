/**
 * MetricsPane — the numbers this page is about, read in place.
 *
 * The list is `GET /v1/analytics/catalogue`, filtered to the page's registry
 * modules. Nothing is gated here: `_reachable()` already intersects the
 * registry with `held_level` per module before answering, so a metric the
 * caller may not read never arrives. The catalogue IS the entitlement signal —
 * the same thing `DristiPage` relies on to decide whether its analytics tab
 * exists at all.
 *
 * ── Why only STOCK metrics show a figure ────────────────────────────────────
 *
 * `/v1/analytics/run` has two contracts and they are not the same shape:
 *
 *   stock   as-at-today. Bounds are IGNORED and the response says so. One
 *           question, one answer, no window to get wrong.
 *   flow    `date_from` and `date_to` are REQUIRED — the endpoint 400s without
 *           them — and the answer depends entirely on which window you chose,
 *           on the bucket, and, for a rate, on recomputing from the carried
 *           numerator and denominator rather than averaging the buckets.
 *           `AnalyticsTab` carries all of that and a WindowBar to drive it.
 *
 * A corner popover has no window bar, and inventing a default here would put a
 * second copy of that contract in the product — the drift this codebase has
 * already paid for with a duplicated price list and two catalogs quoting
 * different credits for one template. Worse, an unlabelled figure over an
 * unstated period is a number nobody can check.
 *
 * So the dock answers the question it can answer honestly and says so for the
 * rest: a flow metric's row reads "needs a period" and opens Analytics, where
 * the period is a control rather than a guess.
 *
 * A DECLARED-ABSENT metric is listed with its reason and never with a zero.
 * Proposal 62 §10: a withheld figure drawn as ₹0 is indistinguishable from a
 * company nobody owes.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { errText } from '../../../pages/hub/_shared';
import { MONEY, NUM, PCT } from '../../../pages/dristi/_shared';
import DockRow, { DockEmpty } from './DockRow';

/** The product's own formatters — `lib/inr.js` through dristi's barrel. */
function formatValue(v, unit) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  if (unit === 'inr') return MONEY(v);
  if (unit === 'pct') return PCT(v);
  if (unit === 'days') return `${NUM(Math.round(Number(v)))} days`;
  if (unit === 'hours') return `${NUM(Math.round(Number(v)))} hrs`;
  return NUM(v);
}

function metricReason(m) {
  if (m.absent) return 'The schema cannot answer this yet';
  if (m.grain !== 'stock') return 'Needs a period — opens in Analytics';
  return '';
}

export default function MetricsPane({ page, metrics, listId, cursor, onCursor, onGo }) {
  const [open, setOpen] = useState(null);
  const [state, setState] = useState({ loading: false, value: null, at: '', rows: 0, error: '' });

  if (!metrics.length) {
    return <DockEmpty
      title="No metric is declared for this page."
      body={page.note || `The registry has nothing under ${page.label}.`}
      hint="Try Skills or Automations — the empty tab is rarely the same tab twice." />;
  }

  const selected = metrics.find(m => m.key === open);

  if (selected) {
    return (
      <div className="k-dock__detail">
        <button type="button" className="k-dock__back"
          onClick={() => { setOpen(null); setState({ loading: false, value: null, at: '', rows: 0, error: '' }); }}>
          ← back
        </button>
        <h4 className="k-dock__dh">{selected.name}</h4>
        {selected.description && <p className="k-dock__why">{selected.description}</p>}

        {selected.absent ? (
          // The stated absence, in the registry's own words. Never a zero.
          <p className="k-dock__flag">{selected.absent}</p>
        ) : selected.grain === 'stock' ? (
          <div className="k-dock__out" role="status">
            {state.loading && <span className="k-dock__outline">Reading…</span>}
            {state.error && <span className="k-dock__outline">{state.error}</span>}
            {state.value != null && (
              <>
                <b>{formatValue(state.value, selected.unit)}</b>
                {/* The reference date, always. A figure with an invisible
                    as-at is a figure nobody can check. */}
                <span className="k-dock__outline">as at {state.at}</span>
              </>
            )}
            {state.rows > 1 && (
              <span className="k-dock__outline">
                {state.rows} rows behind this — open it in Analytics.
              </span>
            )}
            {!state.loading && state.value == null && !state.error && state.rows === 0 && (
              <span className="k-dock__outline">Not read yet.</span>
            )}
          </div>
        ) : (
          <p className="k-dock__fine">
            This measures a flow, so it needs a period. The endpoint refuses the
            question without one, and a default chosen here would be a period
            nobody picked.
          </p>
        )}

        <div className="k-dock__act">
          {!selected.absent && selected.grain === 'stock' && (
            <button type="button" className="k-btn k-btn--primary"
              disabled={state.loading}
              onClick={async () => {
                setState({ loading: true, value: null, at: '', rows: 0, error: '' });
                try {
                  // No date bounds. A stock takes none, and sending them would
                  // imply an authority the answer does not have.
                  const r = await api.get(
                    `/v1/analytics/run?metric=${encodeURIComponent(selected.key)}`);
                  const list = r.data?.data || [];
                  setState({
                    loading: false,
                    // Exactly one row is exactly one answer. More than one is a
                    // breakdown, and summing or picking from it here would be a
                    // second copy of AnalyticsTab's rules — and, for a metric
                    // dimensioned by client, would put a record id on screen.
                    value: list.length === 1 ? Number(list[0].value) : null,
                    at: r.data?.window?.as_at || '',
                    rows: list.length,
                    error: '',
                  });
                } catch (err) {
                  setState({
                    loading: false, value: null, at: '', rows: 0,
                    // 422 is the stated absence arriving at run time. It is an
                    // answer, and `errText` surfaces the server's own detail.
                    error: errText(err, 'That metric did not answer.'),
                  });
                }
              }}>
              {state.loading ? 'Reading…' : 'Read it'}
            </button>
          )}
          <button type="button" className="k-dock__footlink"
            onClick={() => onGo('/dristi?tab=analytics')}>
            Open in Analytics
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="k-dock__list" role="listbox" id={listId}
      aria-label={`Numbers for ${page.label}`}>
      {metrics.map((m, i) => (
        <DockRow
          key={m.key}
          id={`${listId}-${i}`}
          tone="metric"
          name={m.name}
          meta={`${m.grain} · ${m.unit}`}
          go="Read"
          reason={metricReason(m)}
          selected={cursor === i}
          onSelect={() => { onCursor(i); setOpen(m.key); }}
        />
      ))}
    </div>
  );
}
