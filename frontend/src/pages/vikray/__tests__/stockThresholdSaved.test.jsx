/**
 * Vikray · stock — the threshold field must be able to SAY it saved.
 *
 * ── The defect this file exists to prevent ──────────────────────────────────
 *
 * `StockTab.jsx` opens with three things "27-vikray.md §8" asks for, and point
 * 2 is: "Threshold saved on blur with no feedback — a PATCH fired silently and
 * a failure surfaced as a toast that named no row. The field now shows its own
 * saving/saved state."
 *
 * It did not. `Threshold.commit()` sets its state to 'saved' and then calls
 * `onSaved()`, which is the tab's `load()` — and `load()` called
 * `setLoading(true)` on every invocation, including that one. React batches the
 * two updates, the whole table is replaced by a skeleton before a paint, the
 * `Threshold` component UNMOUNTS, and it comes back from the refetch with its
 * state reset to ''. The confirmation the field was written to give could never
 * reach a person.
 *
 * Measured against staging on 2026-08-29 by Suite 10 test 10.02 (proposal 93):
 * the PATCH answered 200 and `.vk-th__s` was empty on fifteen polls across
 * fifteen seconds. The value HAD saved — which is what makes this the expensive
 * shape: the write works and the only thing that tells the user so is destroyed
 * by the write's own refresh.
 *
 * The same tear-down blanked an eighteen-row ledger on every `−1` / `+1`, which
 * is the second assertion below.
 *
 * Rendered with react-dom directly rather than @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws. Same
 * constraint `vikrayTabStates.test.jsx` records.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import StockTab from '../StockTab';

const LEDGER = {
  data: {
    data: [
      {
        product_id: 'p-1', name: 'S05 Product 01', unit: 'NOS',
        quantity_on_hand: 40, low_stock_threshold: 0,
      },
      {
        product_id: 'p-2', name: 'S05 Product 02', unit: 'NOS',
        quantity_on_hand: 12, low_stock_threshold: 0,
      },
    ],
  },
};

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockResolvedValue(LEDGER);
  api.patch.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

/**
 * A request that is IN FLIGHT until the test says otherwise.
 *
 * ⚠ THIS IS WHAT MAKES THE PROOF BITE, and the first version of this file did
 * not have it. With `api.get` resolving on an already-settled promise, React
 * folds the whole `setLoading(true) → fetch → setStock/setLoading(false)`
 * sequence into one commit and the skeleton is never painted — so the test
 * passed against the ORIGINAL, broken component too. A refetch on a real
 * network is a round trip, and the tear-down happens in the gap. The gap has
 * to be in the test or the test is measuring nothing.
 */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const mount = async () => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider><StockTab /></ToastProvider></MemoryRouter>);
  });
  await settle();
};

/** Type into a CONTROLLED React input the way the DOM does it. */
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const thresholdOf = name => container.querySelector(
  `input[aria-label="Low-stock threshold for ${name}"]`);

/** The status region the field owns — `<span class="vk-th__s" role="status">`. */
const statusOf = input => input.closest('.vk-th').querySelector('.vk-th__s');

describe('Vikray stock · the threshold field says whether it saved', () => {
  it('shows "Saved" while the refresh its own save triggers is still in flight', async () => {
    await mount();

    const input = thresholdOf('S05 Product 01');
    expect(input, 'the threshold field is not on the ledger').toBeTruthy();

    // The refetch `onSaved` fires stays OPEN, which is what a network is.
    const refresh = deferred();
    api.get.mockReturnValue(refresh.promise);

    await act(async () => { typeInto(input, '6'); });
    await act(async () => {
      // React 18 implements `onBlur` on the native `focusout`, which bubbles.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await settle();

    expect(api.patch).toHaveBeenCalledWith('/v1/vikray/stock/p-1', { low_stock_threshold: 6 });

    // THE WHOLE POINT. Not "the request fired" — a person cannot see a request.
    const held = thresholdOf('S05 Product 01');
    expect(
      held,
      'the threshold field is gone while its own save is refreshing — the ledger was ' +
      'replaced by a skeleton, so the confirmation had nothing to render into',
    ).toBeTruthy();
    const status = statusOf(held);
    expect(
      status && status.textContent,
      'the threshold saved and the field never said so — the refresh it triggers ' +
      'unmounted the component that was holding the confirmation',
    ).toMatch(/Saved|Saving/);

    // And it survives the answer landing, because the row is keyed on the
    // product and the component instance is not replaced.
    await act(async () => { refresh.resolve(LEDGER); });
    await settle();
    expect(statusOf(thresholdOf('S05 Product 01')).textContent).toMatch(/Saved|Saving/);
  });

  it('keeps the ledger on screen through a refresh instead of blanking it', async () => {
    await mount();

    expect(container.querySelectorAll('table.vk-stk tbody tr').length).toBe(2);

    // `+1` is `api.patch(...).then(load)` with no toast and nothing awaited, so
    // the refresh is the only thing that happens on screen. It must not be a
    // full tear-down: a reader scanning an eighteen-row ledger loses their
    // place, and while the answer is in flight the rows are simply gone.
    const refresh = deferred();
    api.get.mockReturnValue(refresh.promise);

    const plus = container.querySelector('button[aria-label="Add one S05 Product 01"]');
    expect(plus, 'the +1 control is missing').toBeTruthy();
    await act(async () => { plus.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await settle();

    expect(
      container.querySelectorAll('table.vk-stk tbody tr').length,
      'the ledger was replaced by a skeleton while a one-unit adjustment refreshed it',
    ).toBe(2);

    await act(async () => { refresh.resolve(LEDGER); });
    await settle();
    expect(container.querySelectorAll('table.vk-stk tbody tr').length).toBe(2);
  });
});
