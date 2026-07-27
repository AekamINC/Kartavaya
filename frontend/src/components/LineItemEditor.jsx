import React from 'react';
import { inr } from '../lib/inr';
import { emptyLine, lineAmount } from '../pages/vikray/_shared';

/**
 * LineItemEditor — the one line-item grid, per 27-vikray.md §4.
 *
 * `OrdersTab` contained two independent implementations of the same seven
 * fields, and they had drifted apart in every respect that mattered:
 *
 *   |                  | create form                  | edit form            |
 *   |------------------|------------------------------|----------------------|
 *   | grid             | 7 columns                    | 6 columns            |
 *   | product picker   | yes                          | NO                   |
 *   | live line amount | yes                          | NO                   |
 *   | input class      | .k-formpanel__input          | .k-input             |
 *   | mutators         | add/remove/updateLine        | editAdd/editRemove/… |
 *
 * So editing an order silently lost the product picker and the running total —
 * and losing the picker lost `product_id`, which is what moves stock. One
 * component, six functions deleted, and the edit form gains both.
 *
 * ── Mobile ────────────────────────────────────────────────────────────────
 * Seven columns at .8fr on a 393px screen is unusable, and there was no mobile
 * form at all. Below 768px each line becomes a card: description across the
 * top, a 3-up row of qty/rate/GST, amount right-aligned in the footer. That is
 * `.vk-li` in module.css — the layout is CSS, not a second JSX branch, so the
 * two can never say different things.
 */
export default function LineItemEditor({ value, onChange, products = [], disabled }) {
  const items = value?.length ? value : [emptyLine()];

  const update = (idx, patch) =>
    onChange(items.map((li, i) => (i === idx ? { ...li, ...patch } : li)));

  const remove = idx => onChange(items.filter((_, i) => i !== idx));

  const add = () => onChange([...items, emptyLine()]);

  /**
   * Autofill from the catalogue. `product_id` is written FIRST and is the whole
   * point: the backend moves stock only for lines that carry one
   * (`_apply_stock_moves`), and the previous implementation copied the five
   * display fields and dropped it — so every order looked catalogued and moved
   * nothing.
   */
  const fromProduct = (idx, productId) => {
    const p = products.find(x => String(x.id) === String(productId));
    if (!p) { update(idx, { product_id: '' }); return; }
    update(idx, {
      product_id: p.id,
      description: p.name,
      hsn_code: p.hsn_code || p.sac_code || '',
      rate: Number(p.price) || 0,
      gst_rate: Number(p.gst_rate) || 0,
      unit: p.unit || 'NOS',
    });
  };

  return (
    <div className="vk-lis">
      <div className="vk-li vk-li__head" aria-hidden="true">
        <span className="vk-li__desc">Description</span>
        <span>HSN</span>
        <span>Qty</span>
        <span>Rate</span>
        <span>GST %</span>
        <span className="vk-li__amt">Amount</span>
        <span />
      </div>

      {items.map((li, idx) => (
        <div className="vk-li" key={idx}>
          <div className="vk-li__desc">
            {products.length > 0 && (
              <select
                className="inp vk-li__pick"
                value={li.product_id || ''}
                disabled={disabled}
                aria-label={`Line ${idx + 1} — pick from catalogue`}
                onChange={e => fromProduct(idx, e.target.value)}
              >
                <option value="">From catalogue…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <input
              className="inp"
              placeholder="Description"
              value={li.description || ''}
              disabled={disabled}
              aria-label={`Line ${idx + 1} description`}
              onChange={e => update(idx, { description: e.target.value })}
            />
          </div>

          <input
            className="inp" placeholder="HSN" value={li.hsn_code || ''} disabled={disabled}
            aria-label={`Line ${idx + 1} HSN code`}
            onChange={e => update(idx, { hsn_code: e.target.value })}
          />
          <input
            className="inp" type="number" min="0" step="any" value={li.quantity ?? 1} disabled={disabled}
            aria-label={`Line ${idx + 1} quantity`}
            onChange={e => update(idx, { quantity: Number(e.target.value) })}
          />
          <input
            className="inp" type="number" min="0" step="any" value={li.rate ?? 0} disabled={disabled}
            aria-label={`Line ${idx + 1} rate`}
            onChange={e => update(idx, { rate: Number(e.target.value) })}
          />
          <input
            className="inp" type="number" min="0" max="100" step="any" value={li.gst_rate ?? 18} disabled={disabled}
            aria-label={`Line ${idx + 1} GST rate`}
            onChange={e => update(idx, { gst_rate: Number(e.target.value) })}
          />

          <span className="vk-li__amt">{inr(lineAmount(li))}</span>

          {items.length > 1 ? (
            <button
              type="button" className="vk-li__x" disabled={disabled}
              aria-label={`Remove line ${idx + 1}`}
              onClick={() => remove(idx)}
            >
              ×
            </button>
          ) : <span />}
        </div>
      ))}

      <button type="button" className="btn btn--text btn--sm" disabled={disabled} onClick={add}>
        + Add line item
      </button>
    </div>
  );
}
