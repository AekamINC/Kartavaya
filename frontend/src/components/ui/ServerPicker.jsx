import React, { useEffect, useRef } from 'react';
import Picker from './Picker';

/**
 * A `Picker` whose options are fetched from the SERVER for whatever is typed
 * into its search box.
 *
 * ── Why the array cannot just be handed over whole ──────────────────────────
 * `GET /v1/graha/contacts` and `GET /v1/graha/clients` are both `LIMIT 200`,
 * and this product already has orgs past that: 292 live contacts against a
 * 200-row window. `Picker` filters the array it is given, so filtering a
 * truncated array hides the other 92 people SILENTLY — and a user who cannot
 * find a customer creates a second copy of them, which is the exact duplicate
 * both the invoice form and the order form exist to prevent.
 *
 * ── The seam ────────────────────────────────────────────────────────────────
 * `Picker` draws and owns its own search box and publishes what is typed there
 * only to `onCreate`. It is a shared component used by several surfaces and no
 * caller may change it for this. But a DOM `input` event BUBBLES, and this
 * wrapper contains the picker and nothing else — so the single `<input>` under
 * it is that search box, and listening here reads the query without a second
 * search field competing with the one the picker already draws.
 *
 * `onSearch` is debounced, and asked only when the text actually changed: React
 * re-renders replay no input events, but a stray focus/blur must not spend a
 * request.
 *
 * Written for Ganit's `InvoiceForm` on 2026-08-20 and lifted here on 2026-08-21
 * when Vikray's `OrderForm` needed the same control. One copy: the debounce,
 * the changed-text guard and the bubbling seam are three things that have to
 * stay identical, and two copies is how they stop being.
 */
export default function ServerPicker({ onSearch, ...pickerProps }) {
  const timer = useRef(null);
  const last = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div
      style={{ minWidth: 0 }}
      onInput={(e) => {
        if (e.target.tagName !== 'INPUT') return;
        const q = e.target.value || '';
        if (q === last.current) return;
        last.current = q;
        clearTimeout(timer.current);
        // 250ms: long enough that typing a company name is one request, short
        // enough that the list has moved before the user reaches for the
        // "create" row underneath it.
        timer.current = setTimeout(() => onSearch(q), 250);
      }}
    >
      <Picker {...pickerProps} />
    </div>
  );
}
