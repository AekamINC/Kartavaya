// Vikray · stock — the ledger.
//
// Three things 27-vikray.md §8 asks for, all of them about the same idea: an
// inventory screen is scanned for "which rows need me", not read row by row.
//
//  1 · Low stock marks the ROW, not just a badge beside the name.
//  2 · Threshold saved on blur with no feedback — a PATCH fired silently and a
//      failure surfaced as a toast that named no row. The field now shows its
//      own saving/saved state.
//  3 · `+1` / `−1` only. Reconciling a delivery of forty units was forty
//      clicks, and `reason` — which the API takes and the stock_moves table
//      records — was never surfaced. There is a real adjustment dialog now.
//
// And one the spec could not have known: `GET /v1/vikray/stock/{id}/moves` has
// existed since migration 036 and had NO caller. Every adjustment was written
// to an audit trail nobody could read. Expanding a row reads it.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/modal';
import Tag from '../../components/ui/Tag';
import { grouped } from '../../lib/inr';

const REASONS = [
  ['restock', 'Restock — goods received'],
  ['manual_adjustment', 'Correction — count did not match'],
  ['damage', 'Damage or loss'],
  ['return', 'Customer return'],
];

const REASON_LABEL = Object.fromEntries(REASONS);
// The backend writes two reasons this list does not offer, because they are not
// things a person chooses: `order_confirmed` and `order_cancelled` are stamped
// by the order lifecycle. They still have to READ as sentences in the history —
// a raw enum reaching the user is the defect, not the missing option.
const reasonLabel = r => REASON_LABEL[r]
  || (r ? String(r).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Adjustment');

/** The threshold cell: an input that says whether it saved. §8, point 2. */
function Threshold({ row, onSaved }) {
  const { pushToast } = useToast();
  const [value, setValue] = useState(String(row.low_stock_threshold ?? 0));
  const [state, setState] = useState('');   // '' | 'saving' | 'saved' | 'failed'

  useEffect(() => { setValue(String(row.low_stock_threshold ?? 0)); }, [row.low_stock_threshold]);

  async function commit() {
    const n = Number(value);
    if (!Number.isFinite(n) || n === Number(row.low_stock_threshold)) { setState(''); return; }
    setState('saving');
    try {
      await api.patch(`/v1/vikray/stock/${row.product_id}`, { low_stock_threshold: n });
      setState('saved');
      onSaved?.();
      setTimeout(() => setState(s => (s === 'saved' ? '' : s)), 1800);
    } catch (e) {
      setState('failed');
      setValue(String(row.low_stock_threshold ?? 0));
      pushToast({ title: `Could not set the threshold for ${row.name}`, type: 'error' });
    }
  }

  return (
    <span className={`vk-th vk-th--${state || 'idle'}`}>
      <input
        type="number" min="0" className="inp vk-th__in" value={value}
        aria-label={`Low-stock threshold for ${row.name}`}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      <span className="vk-th__s" role="status">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'failed' ? 'Failed' : ''}
      </span>
    </span>
  );
}

/** The real adjustment: a quantity and a reason, both of which the API takes. */
function AdjustDialog({ row, onClose, onDone }) {
  const { pushToast } = useToast();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('restock');
  const [saving, setSaving] = useState(false);

  const n = Number(delta);
  const valid = Number.isFinite(n) && n !== 0;
  const after = Number(row.quantity_on_hand) + (valid ? n : 0);

  async function submit(e) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await api.patch(`/v1/vikray/stock/${row.product_id}`, { quantity_delta: n, reason });
      pushToast({ title: `${row.name} — ${n > 0 ? '+' : ''}${n} ${row.unit || ''}`.trim(), type: 'success' });
      onDone();
      onClose();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Could not adjust the stock', type: 'error' });
    } finally { setSaving(false); }
  }

  // The actions sit in the Modal's own footer, and the submit button reaches
  // the form through `form="…"` rather than being nested inside it. That keeps
  // the shared scrim, focus trap, Escape handler and exit animation instead of
  // hand-rolling a twelfth dialog that has none of them.
  return (
    <Modal
      open
      onOpenChange={v => { if (!v) onClose(); }}
      title="Adjust stock"
      dataTestId="vk-adjust"
      footer={<>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="vk-adjust-form" className="btn btn--fill" disabled={!valid || saving}>
          {saving ? 'Saving…' : 'Record adjustment'}
        </button>
      </>}
    >
      <form id="vk-adjust-form" onSubmit={submit}>
        <p className="vk-adj__p">
          <b>{row.name}</b> — {grouped(row.quantity_on_hand)} {row.unit} on hand.
        </p>
        <div className="row2">
          <label className="fld">
            <span className="fld__l">Change</span>
            <input
              type="number" step="any" className="inp" value={delta} autoFocus
              placeholder="e.g. 40 or -6"
              onChange={e => setDelta(e.target.value)}
            />
            <span className="fld__hint">Positive adds, negative removes.</span>
          </label>
          <label className="fld">
            <span className="fld__l">Reason</span>
            <select className="inp" value={reason} onChange={e => setReason(e.target.value)}>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="fld__hint">Recorded against this movement.</span>
          </label>
        </div>
        {valid && (
          <p className="vk-adj__after">
            On hand after this change: <b>{grouped(after)} {row.unit}</b>
            {after < 0 && <span className="vk-adj__neg"> — this takes the ledger below zero.</span>}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** The movement history for one product — the endpoint that had no caller. */
function Moves({ productId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let dead = false;
    api.get(`/v1/vikray/stock/${productId}/moves`)
      .then(r => { if (!dead) setRows(r.data?.data || []); })
      .catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; };
  }, [productId]);

  if (err) return <p className="vk-mv__none">The movement history did not load.</p>;
  if (!rows) return <p className="vk-mv__none">Loading movements…</p>;
  if (rows.length === 0) return <p className="vk-mv__none">No movements recorded for this product yet.</p>;

  return (
    <ol className="vk-mv">
      {rows.slice(0, 12).map(m => (
        <li key={m.id} className="vk-mv__i">
          <span className={`vk-mv__d${Number(m.quantity_delta) < 0 ? ' vk-mv__d--out' : ''}`}>
            {Number(m.quantity_delta) > 0 ? '+' : ''}{grouped(m.quantity_delta)}
          </span>
          <span className="vk-mv__r">{reasonLabel(m.reason)}</span>
          <span className="vk-mv__t">{String(m.created_at || '').slice(0, 10)}</span>
        </li>
      ))}
    </ol>
  );
}

export default function StockTab() {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [adjusting, setAdjusting] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/vikray/stock', { params: lowOnly ? { low_stock: true } : undefined });
      setStock(r.data?.data || []);
    } catch (e) {
      // "No stock records" on a failed load reads as "you hold no stock", which
      // on an inventory screen is a number somebody may reorder against.
      setErr(e);
      setStock([]);
    } finally { setLoading(false); }
  }, [lowOnly]);

  useEffect(() => { load(); }, [load]);

  const isLow = s =>
    Number(s.low_stock_threshold) > 0 && Number(s.quantity_on_hand) <= Number(s.low_stock_threshold);
  const lowCount = stock.filter(isLow).length;

  return (
    <div>
      <div className="vk-bar">
        <label className="vk-bar__chk">
          <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />
          <span>Low stock only{lowCount > 0 && !lowOnly && <b className="vk-bar__n"> {lowCount}</b>}</span>
        </label>
      </div>

      {loading ? (
        <SkeletonRegion label="Loading the stock ledger"><SkeletonTable rows={6} columns={4} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : stock.length === 0 ? (
        <Empty
          icon="generic"
          title={lowOnly ? 'Nothing is running low' : 'No products to track'}
          sub={lowOnly
            ? 'Every product with a threshold set is above it.'
            : 'Stock is kept per product from the Finance catalogue. Add a product there and it appears here; confirming an order that uses it moves the quantity.'}
          cta={lowOnly ? 'Show everything' : undefined}
          onCta={lowOnly ? () => setLowOnly(false) : undefined}
        />
      ) : (
        <div className="tbl__wrap">
          <table className="tbl vk-stk">
            <thead>
              <tr>
                <th>Product</th>
                <th className="tbl__num">On hand</th>
                <th className="tbl__num">Low at</th>
                <th className="vk-stk__acts">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {stock.map(s => {
                const low = isLow(s);
                const open = expanded === s.product_id;
                return (
                  <React.Fragment key={s.product_id}>
                    <tr className={low ? 'is-low' : undefined}>
                      <td>
                        <button type="button" className="vk-stk__name"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : s.product_id)}>
                          {s.name}
                        </button>
                        {low && <Tag color="var(--warn)">Low</Tag>}
                      </td>
                      <td className="tbl__num vk-stk__qty">{grouped(s.quantity_on_hand)} {s.unit}</td>
                      <td className="tbl__num"><Threshold row={s} onSaved={load} /></td>
                      <td className="vk-stk__acts">
                        <button type="button" className="btn btn--ghost btn--sm"
                          aria-label={`Remove one ${s.name}`}
                          onClick={() => api.patch(`/v1/vikray/stock/${s.product_id}`, { quantity_delta: -1, reason: 'manual_adjustment' }).then(load)}>−1</button>
                        <button type="button" className="btn btn--ghost btn--sm"
                          aria-label={`Add one ${s.name}`}
                          onClick={() => api.patch(`/v1/vikray/stock/${s.product_id}`, { quantity_delta: 1, reason: 'restock' }).then(load)}>+1</button>
                        <button type="button" className="btn btn--out btn--sm" onClick={() => setAdjusting(s)}>Adjust…</button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="vk-stk__exp">
                        <td colSpan={4}><Moves productId={s.product_id} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adjusting && (
        <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} onDone={load} />
      )}
    </div>
  );
}
