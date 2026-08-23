// Metric alerts — D7's missing screen (proposal 62).
//
// The row decides WHEN (which metric, which line); the shipped Niyam template
// decides WHO HEARS — evaluation happens in the Niyam sweep against the
// metric's own registry SQL, so the alert and the dashboard can never
// disagree about what DSO is. This file is only the surface for those rows:
//
//   · `AlertForm` is the inline mini-form a KPI widget's bell opens
//     ("Alert when this crosses…"). The operators are the backend's own pair
//     (gt/lt — routers/analytics.py refuses anything else) and window_days
//     starts at the server's default of 30.
//   · `AlertsPanel` lists the org's alerts for ONE module, filtered here by
//     metric prefix because GET /alerts has no module parameter. Each row is
//     the metric's LABEL — resolved through the catalogue, falling back to
//     the label the server sends (which names a retired metric honestly) —
//     never the key and never a uuid. Alert ids exist only in React keys and
//     the DELETE url.
//
// Managing alerts is org administration, so a 403 here is an ORDINARY answer,
// not a fault — it gets the folder's quiet note, never a red card
// (_shared.jsx's header has the whole argument). A real failure keeps its
// Retry.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Shimmer } from '../../components/editorial';
import { Bi, DataTable, Td, MONEY, NUM, PCT } from './_shared';

/** The backend's accepted operators — routers/analytics.py: ("gt", "lt"). */
const OPERATORS = [
  ['gt', 'goes above'],
  ['lt', 'falls below'],
];
const opLabel = (op) => (OPERATORS.find(([k]) => k === op)?.[1] || op);

/** The server's own default for AlertCreate.window_days. */
const DEFAULT_WINDOW_DAYS = 30;

/** A threshold printed in the metric's unit, the way the tiles print values. */
function fmtThreshold(v, unit) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  if (unit === 'inr') return MONEY(v);
  if (unit === 'pct') return PCT(v);
  if (unit === 'days') return `${NUM(v)} days`;
  if (unit === 'hours') return `${NUM(v)} hrs`;
  return NUM(v);
}

/**
 * The inline mini-form a KPI widget's bell opens. POSTs the exact shape
 * AlertCreate declares; a 403 surfaces the server's org-admin message as a
 * toast and closes nothing — the user may want to read the line they typed.
 */
export function AlertForm({ meta, onClose }) {
  const { pushToast } = useToast();
  const [operator, setOperator] = useState('gt');
  const [threshold, setThreshold] = useState('');
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/v1/analytics/alerts', {
        metric: meta.key,
        operator,
        threshold: Number(threshold),
        window_days: Number(windowDays),
      });
      pushToast({ type: 'success', title: `Alert set on ${meta.label || meta.key}.` });
      onClose();
    } catch (e) {
      const detail = e.response?.data?.detail;
      pushToast({
        type: 'error',
        title: (typeof detail === 'string' && detail) || 'The alert was not set.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="anx-af"
      onSubmit={(e) => { e.preventDefault(); save(); }}
    >
      <span>Alert when this</span>
      <select
        className="k-select"
        value={operator}
        onChange={(e) => setOperator(e.target.value)}
        aria-label="Direction"
      >
        {OPERATORS.map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <input
        className="k-input anx-af__n"
        type="number"
        step="any"
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        placeholder="Threshold"
        aria-label="Threshold"
      />
      <span>over</span>
      <input
        className="k-input anx-af__d"
        type="number"
        min="1"
        max="366"
        value={windowDays}
        onChange={(e) => setWindowDays(e.target.value)}
        aria-label="Window in days"
      />
      <span>days</span>
      <button
        type="submit"
        className="k-btn k-btn--primary k-btn--sm"
        disabled={busy || threshold === ''}
      >
        {busy ? 'Setting…' : 'Set alert'}
      </button>
      <button
        type="button"
        className="k-btn k-btn--ghost k-btn--sm"
        onClick={onClose}
        disabled={busy}
      >
        Cancel
      </button>
    </form>
  );
}

/**
 * This module's alerts, at the bottom of the analytics surface. The list is
 * org-wide on the wire (GET /alerts takes no module), cut here to the metrics
 * whose key starts `${module}.` so Graha's page never shows finance lines.
 */
export default function AlertsPanel({ module, byKey }) {
  const { pushToast } = useToast();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ loading: true, restricted: '', err: '', alerts: null });

  useEffect(() => {
    let on = true;
    setState({ loading: true, restricted: '', err: '', alerts: null });
    api.get('/v1/analytics/alerts').then(
      (r) => {
        if (on) setState({ loading: false, restricted: '', err: '', alerts: r.data?.alerts || [] });
      },
      (e) => {
        if (!on) return;
        const detail = typeof e.response?.data?.detail === 'string' ? e.response.data.detail : '';
        if (e.response?.status === 403) {
          // Ordinary, not broken: alerts are org administration. Quiet note.
          setState({
            loading: false,
            restricted: detail || 'Alerts are managed by an org admin.',
            err: '',
            alerts: null,
          });
        } else {
          setState({
            loading: false,
            restricted: '',
            err: detail || 'Retry, or check your connection.',
            alerts: null,
          });
        }
      },
    );
    return () => { on = false; };
  }, [nonce]);

  const del = async (alert) => {
    try {
      await api.delete(`/v1/analytics/alerts/${alert.id}`);
      setState((s) => ({ ...s, alerts: (s.alerts || []).filter((a) => a.id !== alert.id) }));
    } catch (e) {
      const detail = e.response?.data?.detail;
      pushToast({
        type: 'error',
        title: (typeof detail === 'string' && detail) || 'The alert was not removed.',
      });
    }
  };

  const mine = (state.alerts || []).filter((a) => String(a.metric || '').startsWith(`${module}.`));

  return (
    <section className="anx-card">
      <header className="anx-card__h">
        <Bi en="Alerts" hi="चेतावनियाँ" />
      </header>
      <div className="anx-card__b">
        {state.loading ? (
          <Shimmer count={2} />
        ) : state.restricted ? (
          <p className="dnone">{state.restricted}</p>
        ) : state.err ? (
          <div className="note note--warn" role="status">
            <span><b>This did not load.</b> {state.err}</span>
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm dret"
              onClick={() => setNonce((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        ) : !mine.length ? (
          <p className="dnone">
            No alerts here yet. A crossed line raises a Niyam event,
            delivered to the org&rsquo;s admins.
          </p>
        ) : (
          <DataTable arrange="dristi.metric_alerts" columns={['Metric', 'Condition', { label: 'Window', align: 'right' }, { label: '' }]}>
            {mine.map((a) => {
              // Label through the catalogue first; the server's label second
              // (it names a retired metric honestly). Never the bare key.
              const label = byKey?.[a.metric]?.label || a.label || 'Unknown metric';
              const unit = byKey?.[a.metric]?.unit ?? a.unit;
              return (
                <tr key={a.id}>
                  <td>{label}</td>
                  <td>{opLabel(a.operator)} {fmtThreshold(a.threshold, unit)}</td>
                  <Td align="right" mono>{NUM(a.window_days)} days</Td>
                  <Td align="right">
                    <button
                      type="button"
                      className="k-btn k-btn--ghost k-btn--sm"
                      aria-label={`Delete the alert on ${label}`}
                      onClick={() => del(a)}
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </div>
    </section>
  );
}
