/**
 * Vikray · pipeline and customers — loading, empty and ERROR are three states.
 *
 * These two tabs were restored from the approved design
 * (`design-reference/Kartavaya Redesign/Data.jsx:125`), and both render money.
 * The defect this file exists to prevent is the one `grahaTabStates.test.jsx`
 * documents as the most common in the codebase: `catch {}` followed by
 * `length === 0 ? <empty>`, so a failed request prints "No orders in the
 * pipeline" or "No customers yet".
 *
 * On a sales pipeline that is not a blank screen. It is a false statement about
 * the customer's order book — and the two accounting firms taking delivery read
 * these numbers as fact. A 500 must look broken, not empty.
 *
 * Rendered with react-dom directly rather than @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws. Same
 * constraint `grahaTabStates.test.jsx` and `kanbanTab.test.jsx` record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Only the transport is mocked; `rows()` stays real, because both tabs unwrap
// their response through it and a bare factory would leave it undefined.
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';

import PipelineTab from '../PipelineTab';
import CustomersTab from '../CustomersTab';

/** The exact empty-state sentences. A regression fails here, not quietly. */
const EMPTY_COPY = {
  PipelineTab: 'No orders in the pipeline',
  CustomersTab: 'No customers yet',
};

/** A successful but genuinely empty payload, per tab. */
const EMPTY_BODY = {
  PipelineTab: { data: { data: [], stages: [] } },
  CustomersTab: { data: { data: [] } },
};

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { vi.runOnlyPendingTimers(); });
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  container = null;
});

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async (Tab) => {
  await act(async () => {
    root.render(
      <MemoryRouter><ToastProvider><Tab onOpenOrder={() => {}} /></ToastProvider></MemoryRouter>,
    );
  });
};

const httpError = status => Object.assign(new Error('boom'), {
  isAxiosError: true,
  response: { status, data: { detail: 'boom' } },
});

const TABS = [['PipelineTab', PipelineTab], ['CustomersTab', CustomersTab]];

describe('Vikray tabs · a failed load is never an empty state', () => {
  TABS.forEach(([name, Tab]) => {
    it(`${name} renders an error with a retry on 500, and never claims to be empty`, async () => {
      api.get.mockRejectedValue(httpError(500));

      await mount(Tab);
      await settle();

      const text = container.textContent;

      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      expect(text).toContain('Try again');
      // The whole point.
      expect(text).not.toContain(EMPTY_COPY[name]);
    });

    it(`${name} renders a denial on 403, and never claims to be empty`, async () => {
      api.get.mockRejectedValue(httpError(403));

      await mount(Tab);
      await settle();

      const text = container.textContent;

      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      // `errorKind` maps 403 to `denied`, which offers access rather than retry.
      expect(text).toContain('Request access');
      expect(text).not.toContain(EMPTY_COPY[name]);
    });

    it(`${name} shows a loading region while the request is in flight`, async () => {
      // Never settles: the tab must be in its loading state, not its empty one.
      api.get.mockReturnValue(new Promise(() => {}));

      await mount(Tab);
      await settle();

      const text = container.textContent;

      expect(container.querySelector('[role="status"][aria-busy="true"]')).toBeTruthy();
      expect(container.querySelector('[role="alert"]')).toBeFalsy();
      expect(text).not.toContain(EMPTY_COPY[name]);
    });

    it(`${name} shows its empty state only when the request SUCCEEDED with nothing`, async () => {
      api.get.mockResolvedValue(EMPTY_BODY[name]);

      await mount(Tab);
      await settle();

      const text = container.textContent;

      expect(text).toContain(EMPTY_COPY[name]);
      expect(container.querySelector('[role="alert"]')).toBeFalsy();
    });
  });
});

describe('Vikray · pipeline reads its stage board from the server', () => {
  it('sums only the open stages into the lede and lists every stage', async () => {
    api.get.mockResolvedValue({
      data: {
        data: [
          {
            id: 'o1', order_number: 'SO-001', status: 'confirmed', total: 1,
            order_date: '2026-07-01', contact_name: 'Test Party',
          },
        ],
        stages: [
          { stage: 'draft', count: 1, value: 1 },
          { stage: 'confirmed', count: 1, value: 1 },
          { stage: 'dispatched', count: 0, value: 0 },
          { stage: 'delivered', count: 0, value: 0 },
          // `closed` is money that has landed — it belongs on the board but must
          // NOT be counted as "has not closed yet" in the lede.
          { stage: 'closed', count: 9, value: 9 },
        ],
      },
    });

    await mount(PipelineTab);
    await settle();

    const text = container.textContent;

    expect(text).toContain('Draft');
    expect(text).toContain('Closed');
    // Two open orders across draft + confirmed; the nine closed are excluded.
    expect(text).toContain('2 orders');
    expect(text).not.toContain('11 orders');
  });
});

describe('Vikray · customers is built from orders, not from the CRM', () => {
  it('requests the vikray customers endpoint and no Graha route', async () => {
    api.get.mockResolvedValue({ data: { data: [] } });

    await mount(CustomersTab);
    await settle();

    const urls = api.get.mock.calls.map(c => c[0]);
    expect(urls).toContain('/v1/vikray/customers');
    expect(urls.some(u => String(u).includes('/graha'))).toBe(false);
  });
});
